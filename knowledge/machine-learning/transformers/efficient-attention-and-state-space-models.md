---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/transformers
status: verified
applies-to: ["PyTorch 2.15.0 (scaled_dot_product_attention and its backends; lab on CPU)", "any"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, transformers, attention, efficient-attention, flashattention, online-softmax, tiling, io-aware, scaled-dot-product-attention, sdpa, sliding-window, linear-attention, state-space-models, s4, mamba, selective-scan]
---

# Efficient attention and state-space models

## Summary
**TL;DR:** Plain attention builds an `N × N` score matrix for `N` tokens, so its time and memory grow with the square of the sequence length. FlashAttention computes exactly the same result without ever storing that matrix: it walks over blocks of keys and keeps a running maximum, a running softmax denominator and a running output per query (the "online softmax"), so memory grows linearly and far fewer bytes move to and from slow GPU memory. In PyTorch, `F.scaled_dot_product_attention` (SDPA) picks such a fused kernel automatically. The alternatives change the model instead: sliding-window attention lets each token see only `w` neighbours, linear attention replaces the softmax with a kernel feature map so causal attention becomes an RNN (recurrent neural network) with a fixed-size state, and state-space models (S4, Mamba) are linear recurrences that can also be run in parallel, as a convolution (S4) or a parallel scan (Mamba's selective version).
**Use this when:** long sequences run out of memory, you wonder whether to write attention by hand or call SDPA, which SDPA backend runs on your hardware, or you compare transformers with windowed, linear-attention or Mamba-style models.
**Not this doc:** the attention formula, masks and heads → `machine-learning/transformers/attention-and-the-transformer.md`; the KV (key–value) cache and per-step cost during generation → `machine-learning/transformers/decoding-and-kv-cache.md`; why RNNs lost to attention → `machine-learning/deep-learning/recurrent-networks.md`; why moving data costs more than computing on it → `performance/hardware/memory-hierarchy-and-caches.md`.

## Problem
Standard attention needs memory quadratic in the sequence length, and FlashAttention's authors trace the slowness to reads and writes between GPU (graphics processing unit) high-bandwidth memory (HBM) and on-chip SRAM (static random-access memory), not to arithmetic ✅[^1]. In their GPT-2 medium benchmark on an A100 GPU, FlashAttention does more arithmetic than standard attention (75.2 against 66.6 GFLOPs, billions of floating-point operations) yet runs in 7.3 ms instead of 41.7 ms, because it moves 4.4 GB to and from HBM instead of 40.3 GB ✅[^1]. In the lab, on one head of width 64 on a CPU, the naive formula's peak memory grew from 233 MiB (mebibytes) at 2,048 tokens to 2,120 MiB at 16,384 tokens, while `F.scaled_dot_product_attention` stayed between 202 and 217 MiB ✅[^9]. Approximate fixes (windows, linear attention) change what the model computes, and state-space models change the architecture; choosing among them needs to know which are exact and which trade quality for length.

## Mental model
**Analogy:** marking an exam with a running leaderboard. The naive way pins every candidate's score on a huge wall (the `N × N` matrix), then reads the wall to normalize. The tiled way reads one stack of papers at a time and keeps only three numbers per question: the best score so far, the running total of `exp(score − best)`, and a running weighted answer. When a new stack has a higher best score, everything kept so far is shrunk by `exp(old best − new best)`. At the end the result is identical, and the wall was never needed.

**Artifact:** the inner loop of the lab's tiled attention, for one block of queries `qi` (already divided by `√d`):

```python
for j in range(0, N, bk):                                  # one block of keys and values at a time
    s = qi @ k[j:j + bk].T
    m_new = torch.maximum(m, s.max(-1, keepdim=True).values)
    p, scale = torch.exp(s - m_new), torch.exp(m - m_new)  # rescale the old partial sums
    l = scale * l + p.sum(-1, keepdim=True)
    acc = scale * acc + p @ v[j:j + bk]
    m = m_new
out = acc / l                                              # exact softmax(q kᵀ / √d) v
```

## How it works
### The quadratic cost
1. Attention computes `softmax(Q·Kᵀ/√d)·V` (`machine-learning/transformers/attention-and-the-transformer.md`); the scores `Q·Kᵀ` form an `N × N` matrix per head, and standard implementations need memory quadratic in `N` ✅[^1]. Example: `N = 16,384` in float32 is `16,384² × 4` bytes = 1 GiB per head; the lab's naive run peaked at 2,120 MiB, about 1.9 GiB above the 1,024-token run's 207 MiB: the scores plus the softmax output ✅[^9].

### FlashAttention: tiling and online softmax, exact
2. **Online softmax:** the softmax normalizer can be computed in one pass instead of two, which cuts the memory accesses per vector element from 4 to 3; its paper measured up to 1.3× faster softmax than the usual "safe" (maximum-subtracting) version on a V100 GPU ✅[^2]. Each block keeps a running maximum `m` and a running sum `l`, and blocks are merged by rescaling with `exp` of the difference of maxima ✅[^1].
3. **Tiling:** FlashAttention splits `Q`, `K` and `V` into blocks, loads them into on-chip SRAM, and computes the output block by block, so fewer reads and writes go to HBM ✅[^1]. It is exact attention, not an approximation ✅[^1].
4. **Backward pass:** instead of saving the `N × N` matrix, it saves the output and the softmax statistics and recomputes attention on chip when gradients are needed ✅[^1]. Memory becomes linear in sequence length ✅[^1].
5. **IO complexity (input/output, here bytes moved to and from HBM):** `O(N²·d²/M)` HBM accesses for FlashAttention, with head dimension `d` and SRAM size `M`, against `Θ(N·d + N²)` for standard attention ✅[^1]. The reference GPU in the paper, an A100, has 40–80 GB of HBM and 192 KB of SRAM in each of 108 streaming multiprocessors ✅[^1].
6. **Reported gains:** 15 % faster than the MLPerf 1.1 BERT-large training record, up to 3× faster GPT-2 training, 2.4× on the Long-Range Arena benchmark; a block-sparse variant is 2–4× faster again and reaches 64K tokens ✅[^1].

### `F.scaled_dot_product_attention` and its backends (PyTorch 2.15)
7. **Backends:** FlashAttention-2, Memory-Efficient Attention, and a C++ implementation of the plain formula ("math"); all are enabled by default and the function tries to pick the best one for the inputs ✅[^3]. The page documents the plain-PyTorch code it is equivalent to ✅[^3], and the default scale is `1/√E` for query/key width `E` ✅[^3]. The function is beta ✅[^3].
8. **Choosing one:** `torch.nn.attention.sdpa_kernel(backends, set_priority=False)` takes one `SDPBackend` or a list, and restores the previous flags on exit ✅[^4]; disabling the math backend forces a fused kernel, with a warning that says why when none can run ✅[^3].
9. **On a CPU (lab):** `MATH` and `FLASH_ATTENTION` ran and matched the manual causal formula within `4.2e-07`; `EFFICIENT_ATTENTION` and `CUDNN_ATTENTION` alone failed with "No viable backend for scaled_dot_product_attention was found" ✅[^9].

### Changing the model: sparse, windowed and linear attention
10. **Sliding window:** each token attends to a fixed window of `w` tokens around it, cost `O(n × w)`; after `ℓ` layers the receptive field is about `ℓ × w`; dilated windows widen it for free, and a few global tokens attend to and are attended by everything; the pattern scales linearly with length ✅[^5]. In SDPA it is a boolean band mask (`True` = may attend); the lab's 16-token, 4-wide causal band keeps 58 of 256 pairs ✅[^9].
11. **Linear attention:** write attention with a feature map `φ`: `V'ᵢ = φ(Qᵢ)ᵀ Σⱼ φ(Kⱼ)Vⱼᵀ / (φ(Qᵢ)ᵀ Σⱼ φ(Kⱼ))`, with `φ(x) = elu(x) + 1`; the sums are shared by all queries, so time and memory drop from `O(N²)` to `O(N)` ✅[^6]. It is a different model from softmax attention, not a faster way to compute it.
12. **Transformers as RNNs:** with a causal mask the two sums become running states `Sᵢ` and `Zᵢ` updated in constant time per token, so a causal linear-attention layer is an RNN; the paper reports up to 4,000× faster autoregressive prediction on very long sequences ✅[^6]. That number is throughput, images generated per second on CIFAR-10, a dataset of 32 × 32 colour images (17.85 against 0.004); generating one image at a time (batch size 1), the gain was 4.9× on a GPU and 192× on a CPU ✅[^6]. In the lab, the recurrent form matches the parallel form within `2.4e-07`, with a state of `d² + d = 272` numbers whatever the length ✅[^9].

### State-space models: S4 and Mamba
13. **The model:** a continuous linear system `h'(t) = A·h(t) + B·x(t)`, `y(t) = C·h(t)` ✅[^8]; discretized with step `Δ` (zero-order hold: `Ā = exp(ΔA)`) it becomes the recurrence `h_t = Ā·h_{t−1} + B̄·x_t`, `y_t = C·h_t` ✅[^8].
14. **Two forms of the same computation:** because `Ā, B̄, C` are the same at every step (linear time-invariant, LTI), the output is also a convolution `y = x * K̄` with kernel `K̄ = (C·B̄, C·Ā·B̄, C·Ā²·B̄, …)` ✅[^8]. S4 uses the convolution for parallel training and the recurrence for generation ✅[^7]. In the lab both forms agree within `1.9e-06` ✅[^9].
15. **S4:** its contribution is an efficient way to compute that kernel, with matrices initialized from HiPPO theory so the state remembers long histories ✅[^7]; it solved the Path-X task of length 16K on which all prior work failed, and generates about 60× faster than a vanilla transformer ✅[^7].
16. **Why LTI is not enough:** the same dynamics apply to every token, which limits content-based reasoning on discrete, information-dense data such as text ✅[^8].
17. **Mamba's selection:** `Δ`, `B` and `C` become functions of the input, so the model can keep or forget information depending on the current token ✅[^8]. That breaks the convolution form (lab: an input-dependent step gives outputs up to 21.79 away from the fixed kernel's ✅[^9]), so Mamba uses a hardware-aware selective scan: a parallel scan, fused kernels and recomputation in the backward pass, with the expanded state kept in SRAM ✅[^8].
18. **Reported results:** linear scaling in sequence length, 4–5× the inference throughput of a transformer of similar size (with no KV cache, Mamba fits much larger batches), and Mamba-3B matching transformers twice its size in language modelling; the block drops attention and MLP (multilayer perceptron) blocks entirely ✅[^8].

## Worked example
Six checks on a CPU: tiled online-softmax attention against the naive formula (non-causal and causal, plus scores large enough to overflow `exp`), SDPA against the manual formula with each backend forced, naive attention vs SDPA time and peak memory (resident set size, RSS, of a fresh process per run) from 1,024 to 16,384 tokens, a sliding-window mask, causal linear attention in both forms, and a diagonal SSM in both forms. Lab run (`machine-learning/lab-setup.md`), 2026-11-25, PyTorch 2.15.0, Apple M2, 4 threads; two runs identical except the timings and the naive formula's peak RSS at 8,192 and 16,384 tokens, which varied by up to 7 % ✅[^9]:

```text
== 1. tiled online-softmax attention vs naive (N=1000, d=64, blocks 64) ==
causal=False: max |tiled - naive| = 4.0e-07
causal=True : max |tiled - naive| = 3.6e-07
scores up to 12733 | exp overflows: True | tiled finite: True
== 2. SDPA vs the manual formula, and which backends run on CPU ==
default SDPA vs manual: max |diff| = 5.4e-07
MATH                 runs  | causal, max |diff| vs manual 2.7e-07
FLASH_ATTENTION      runs  | causal, max |diff| vs manual 4.2e-07
EFFICIENT_ATTENTION  fails | No viable backend for scaled_dot_product_attention was fou
CUDNN_ATTENTION      fails | No viable backend for scaled_dot_product_attention was fou
== 3. naive attention cost vs sequence length (one head, d=64, float32, CPU) ==
N= 1024: score matrix      4 MiB | naive      1.2 ms, peak RSS    207 MiB | sdpa      0.9 ms, peak RSS    202 MiB
N= 2048: score matrix     16 MiB | naive      4.9 ms, peak RSS    233 MiB | sdpa      2.3 ms, peak RSS    203 MiB
N= 4096: score matrix     64 MiB | naive     17.8 ms, peak RSS    332 MiB | sdpa      8.3 ms, peak RSS    205 MiB
N= 8192: score matrix    256 MiB | naive     69.6 ms, peak RSS    670 MiB | sdpa     33.2 ms, peak RSS    209 MiB
N=16384: score matrix   1024 MiB | naive    300.1 ms, peak RSS   2120 MiB | sdpa    128.1 ms, peak RSS    217 MiB
== 4. sliding-window attention (window 4 back, N=16) ==
allowed pairs 58 of 256 | SDPA with band mask vs manual: 1.8e-07
== 5. causal linear attention: parallel form == recurrent form (phi = elu + 1) ==
max |parallel - recurrent| = 2.4e-07 | state size 272 numbers, independent of N
== 6. diagonal SSM (state 4): recurrence == convolution; input-dependent step breaks it ==
LTI: max |recurrent - convolution| = 1.9e-06
selective (step from the input): output differs from the fixed-kernel output by up to 21.79
```

<details><summary>Full script (prints the output above)</summary>

```python
# Efficient attention on CPU: tiled online-softmax attention, naive cost vs length, SDPA backends,
# sliding-window mask, linear attention as an RNN, and an SSM in recurrent vs convolutional form.
import subprocess, sys, time
import torch
import torch.nn.functional as F
from torch.nn.attention import SDPBackend, sdpa_kernel
torch.manual_seed(0)

def naive(q, k, v, causal=False):                       # materializes the full N x N score matrix
    s = q @ k.T / q.shape[-1] ** 0.5
    if causal:
        s = s.masked_fill(~torch.ones_like(s, dtype=torch.bool).tril(), float("-inf"))
    return torch.softmax(s, -1) @ v

def tiled(q, k, v, bq=64, bk=64, causal=False):       # FlashAttention-style forward: never holds N x N
    N, d = q.shape; out = torch.empty_like(q)
    for i in range(0, N, bq):
        qi = q[i:i + bq] / d ** 0.5
        m = torch.full((qi.shape[0], 1), float("-inf"))  # running row max
        l = torch.zeros(qi.shape[0], 1)                  # running softmax denominator
        acc = torch.zeros(qi.shape[0], d)                # running un-normalized output
        for j in range(0, N, bk):
            if causal and j > i + qi.shape[0] - 1: break  # block entirely in the future
            s = qi @ k[j:j + bk].T
            if causal:
                rows = torch.arange(i, i + qi.shape[0])[:, None]; cols = torch.arange(j, j + s.shape[1])[None]
                s = s.masked_fill(cols > rows, float("-inf"))
            m_new = torch.maximum(m, s.max(-1, keepdim=True).values)
            p = torch.exp(s - m_new); scale = torch.exp(m - m_new)   # rescale what was summed so far
            l = scale * l + p.sum(-1, keepdim=True)
            acc = scale * acc + p @ v[j:j + bk]
            m = m_new
        out[i:i + bq] = acc / l
    return out

print("== 1. tiled online-softmax attention vs naive (N=1000, d=64, blocks 64) ==")
q, k, v = (torch.randn(1000, 64) for _ in range(3))
for causal in (False, True):
    print(f"causal={causal!s:<5}: max |tiled - naive| = {(tiled(q, k, v, causal=causal) - naive(q, k, v, causal)).abs().max().item():.1e}")
big = torch.randn(4, 64) * 40                          # large scores: exp() overflows without the max trick
print("scores up to", round((big @ big.T / 8).max().item()), "| exp overflows:", torch.isinf(torch.exp(big @ big.T / 8)).any().item(),
      "| tiled finite:", torch.isfinite(tiled(big, big, big, bq=2, bk=2)).all().item())

print("== 2. SDPA vs the manual formula, and which backends run on CPU ==")
qb, kb, vb = (torch.randn(2, 4, 256, 64) for _ in range(3))   # (batch, heads, tokens, head dim)
man = torch.softmax(qb @ kb.transpose(-2, -1) / 8, -1) @ vb
print("default SDPA vs manual: max |diff| =", f"{(F.scaled_dot_product_attention(qb, kb, vb) - man).abs().max().item():.1e}")
for be in [SDPBackend.MATH, SDPBackend.FLASH_ATTENTION, SDPBackend.EFFICIENT_ATTENTION, SDPBackend.CUDNN_ATTENTION]:
    try:
        with sdpa_kernel(be):
            o = F.scaled_dot_product_attention(qb, kb, vb, is_causal=True)
        mc = naive(qb[0, 0], kb[0, 0], vb[0, 0], causal=True)
        print(f"{be.name:<20} runs  | causal, max |diff| vs manual {(o[0, 0] - mc).abs().max().item():.1e}")
    except RuntimeError as e:
        print(f"{be.name:<20} fails | {str(e).splitlines()[0][:58]}")

print("== 3. naive attention cost vs sequence length (one head, d=64, float32, CPU) ==")
CHILD = """
import resource, sys, time, torch, torch.nn.functional as F
torch.manual_seed(0); N, mode = int(sys.argv[1]), sys.argv[2]
q, k, v = (torch.randn(N, 64) for _ in range(3))
def run():
    if mode == "naive": return torch.softmax(q @ k.T / 8, -1) @ v
    return F.scaled_dot_product_attention(q[None, None], k[None, None], v[None, None])[0, 0]
run(); base = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
ts = []
for _ in range(5):
    t = time.perf_counter(); run(); ts.append(time.perf_counter() - t)
peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
print(sorted(ts)[2] * 1000, peak / 2**20)
"""
for N in [1024, 2048, 4096, 8192, 16384]:
    row = []
    for mode in ("naive", "sdpa"):
        ms, peak = map(float, subprocess.run([sys.executable, "-c", CHILD, str(N), mode], capture_output=True, text=True).stdout.split())
        row.append(f"{mode} {ms:8.1f} ms, peak RSS {peak:6.0f} MiB")
    print(f"N={N:>5}: score matrix {N * N * 4 / 2**20:6.0f} MiB | " + " | ".join(row))

print("== 4. sliding-window attention (window 4 back, N=16) ==")
N, w = 16, 4
i, j = torch.arange(N)[:, None], torch.arange(N)[None]
allowed = (j <= i) & (j > i - w)                           # causal band: self + 3 previous tokens
qs, ks, vs = (torch.randn(1, 1, N, 8) for _ in range(3))
o = F.scaled_dot_product_attention(qs, ks, vs, attn_mask=allowed)
s = (qs @ ks.transpose(-2, -1) / 8 ** 0.5).masked_fill(~allowed, float("-inf"))
print("allowed pairs", allowed.sum().item(), "of", N * N, "| SDPA with band mask vs manual:",
      f"{(o - torch.softmax(s, -1) @ vs).abs().max().item():.1e}")

print("== 5. causal linear attention: parallel form == recurrent form (phi = elu + 1) ==")
phi = lambda x: F.elu(x) + 1
N, d = 200, 16
ql, kl, vl = phi(torch.randn(N, d)), phi(torch.randn(N, d)), torch.randn(N, d)
par = (torch.tril(ql @ kl.T) @ vl) / (torch.tril(ql @ kl.T).sum(-1, keepdim=True))   # O(N^2) parallel form
S, Z, rec = torch.zeros(d, d), torch.zeros(d), []
for t in range(N):                                           # RNN form: state S (d x d) and Z (d), O(1) per token
    S = S + torch.outer(kl[t], vl[t]); Z = Z + kl[t]
    rec.append(ql[t] @ S / (ql[t] @ Z))
print("max |parallel - recurrent| =", f"{(par - torch.stack(rec)).abs().max().item():.1e}", "| state size", d * d + d, "numbers, independent of N")

print("== 6. diagonal SSM (state 4): recurrence == convolution; input-dependent step breaks it ==")
L, n = 64, 4
A_bar = torch.rand(n) * 0.9                                 # discretized diagonal A, |a| < 1 (stable)
B_bar, C = torch.randn(n), torch.randn(n)
x = torch.randn(L)
h, y_rec = torch.zeros(n), []
for t in range(L):
    h = A_bar * h + B_bar * x[t]; y_rec.append(C @ h)       # h_t = A h_{t-1} + B x_t ; y_t = C h_t
K = torch.stack([C @ (A_bar ** t * B_bar) for t in range(L)])  # kernel (CB, CAB, CA^2B, ...)
y_conv = torch.stack([(K[:t + 1].flip(0) * x[:t + 1]).sum() for t in range(L)])
print("LTI: max |recurrent - convolution| =", f"{(torch.stack(y_rec) - y_conv).abs().max().item():.1e}")
delta = torch.sigmoid(3 * x)                                 # selective: step size depends on the input
h, y_sel = torch.zeros(n), []
for t in range(L):
    a_t = A_bar ** delta[t]; h = a_t * h + delta[t] * B_bar * x[t]; y_sel.append(C @ h)
print("selective (step from the input): output differs from the fixed-kernel output by up to",
      f"{(torch.stack(y_sel) - y_conv).abs().max().item():.2f}")
```

</details>

Reading it:
- **Tiled = naive:** the block-by-block result differs from the full softmax only by float32 rounding (`4.0e-07`), causal or not, which is what "exact" means. With scores up to 12,733, `exp` alone overflows to infinity; subtracting the running maximum keeps every exponent at or below 0.
- **SDPA = formula:** the default call and the forced `MATH` and `FLASH_ATTENTION` backends all agree with the manual formula. On this CPU the memory-efficient and cuDNN (CUDA Deep Neural Network library) kernels are not available, so forcing either one leaves no backend.
- **Quadratic growth:** from 2,048 to 16,384 tokens (8× longer) the naive time grew about 60× (4.9 → 300.1 ms) and its peak memory by about 1.8 GiB (233 → 2,120 MiB), close to two 1 GiB `N × N` matrices; SDPA's peak memory barely moved (203 → 217 MiB) and it ran 2.1–2.3× faster than the naive formula from 2,048 tokens on. Timings vary from run to run, most at small `N`.
- **Window:** 58 of 256 pairs (16 + 15 + 14 + 13: each token sees itself and up to 3 earlier tokens) grows as `N·w`, not `N²`.
- **Linear attention and SSM:** both run as a recurrence with a fixed-size state and give the same numbers as their parallel form, as long as the SSM's parameters do not depend on the input; Mamba's selective step removes the single kernel, which is why it needs a scan.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Long sequence with naive attention | Memory grows with `N²` (lab: 2,120 MiB at 16,384 tokens) | Standard attention is quadratic in memory ✅[^1]; lab ✅[^9] |
| Hand-written softmax over huge scores | `exp` overflows to `inf` | Online softmax subtracts the running max ✅[^1]; lab ✅[^9] |
| Forcing `EFFICIENT_ATTENTION` on CPU | `RuntimeError: No viable backend …` | Lab, PyTorch 2.15.0 ✅[^9] |
| Passing both `attn_mask` and `is_causal=True` | Error | SDPA documentation ✅[^3] |
| Expecting identical bits across backends | Small differences (more in `machine-learning/transformers/attention-and-the-transformer.md`) | Output can vary by backend ✅[^3]; lab within `4.2e-07` ✅[^9] |
| `dropout_p > 0` at evaluation | Dropout still applied (explained in `machine-learning/transformers/attention-and-the-transformer.md`) | SDPA always applies `dropout_p`; pass 0.0 when evaluating ✅[^3] |
| Window attention for a far-away dependency | Needs about `distance / w` layers to connect | Receptive field `ℓ × w` ✅[^5] |
| Linear attention as a drop-in for softmax attention | Different outputs; retraining needed | Softmax replaced by a feature map ✅[^6] |
| Selective SSM trained with an FFT convolution | Not possible | Input-dependent parameters break the convolution form ✅[^8]; lab ✅[^9] |
| LTI SSM on text | Weaker content-based reasoning | Same dynamics for every token ✅[^8] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| FlashAttention / fused SDPA | Exact; linear memory; fewer HBM accesses ✅[^1] | Needs a fused kernel for the hardware (lab: 2 of 4 backends on CPU ✅[^9]) |
| Sliding window (+ global tokens) | `O(n × w)`, linear in length ✅[^5] | Distant tokens connect only through depth ✅[^5] |
| Linear attention | `O(N)` time and memory; constant-time recurrent decoding ✅[^6] | Not softmax attention ✅[^6] |
| S4 (LTI SSM) | Parallel convolution for training, recurrence for generation ✅[^7]; long-range tasks ✅[^7] | Fixed dynamics limit content-based reasoning ✅[^8] |
| Mamba (selective SSM) | Linear scaling, 4–5× the inference throughput of a similar-size transformer ✅[^8] | Needs a hardware-aware scan instead of a convolution ✅[^8] |

## Takeaways
- Call `F.scaled_dot_product_attention` instead of writing `softmax(q @ k.T) @ v`; it gives the same numbers and, with a fused backend, does not store the `N × N` matrix. [rule-candidate]
- To check which backend runs, wrap one call in `sdpa_kernel(SDPBackend.X)` and catch the error; do it on the target hardware, not your laptop.
- Classify every "efficient attention" method as exact (FlashAttention, fused SDPA) or a different model (windows, linear attention, SSMs) before comparing quality numbers.
- When writing any softmax over a long axis in blocks, carry the running max and rescale with `exp(m_old − m_new)`.

## Verification status
- Verified: 65 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [FlashAttention: Fast and Memory-Efficient Exact Attention with IO-Awareness](https://ar5iv.labs.arxiv.org/html/2205.14135) — Dao, Fu, Ermon, Rudra, Ré, 2022. Backs: quadratic memory and HBM traffic of standard attention, the GPT-2 medium FLOPs, HBM and runtime comparison (Figure 2, left), exactness, tiling, online-softmax merge, recomputation, linear memory, IO complexity, A100 figures, reported speed-ups, block-sparse variant. [^1]
- [Online normalizer calculation for softmax](https://arxiv.org/abs/1805.02867) — Milakov, Gimelshein, 2018 (full text read on ar5iv). Backs: one-pass softmax normalizer, 4 → 3 memory accesses per element, 1.3× speed-up over safe softmax on a V100. [^2]
- [torch.nn.functional.scaled_dot_product_attention](https://docs.pytorch.org/docs/2.15/generated/torch.nn.functional.scaled_dot_product_attention.html) — PyTorch 2.15 docs. Backs: the three backends, automatic selection, reference code, default scale, beta status, forcing a fused kernel, `attn_mask` with `is_causal`, backend numeric differences, dropout always applied. [^3]
- [torch.nn.attention.sdpa_kernel](https://docs.pytorch.org/docs/2.15/generated/torch.nn.attention.sdpa_kernel.html) — PyTorch 2.15 docs. Backs: signature, list of backends, `set_priority`, flags restored on exit. [^4]
- [Longformer: The Long-Document Transformer](https://ar5iv.labs.arxiv.org/html/2004.05150) — Beltagy, Peters, Cohan, 2020. Backs: sliding window `O(n × w)`, receptive field `ℓ × w`, dilation, global attention, linear scaling. [^5]
- [Transformers are RNNs: Fast Autoregressive Transformers with Linear Attention](https://ar5iv.labs.arxiv.org/html/2006.16236) — Katharopoulos, Vyas, Pappas, Fleuret, 2020. Backs: kernel formulation, `elu + 1`, `O(N)`, causal RNN form, 4,000× faster prediction as CIFAR-10 throughput (Table 2) and the batch-size-1 timings (appendix C.2, Table 5). [^6]
- [Efficiently Modeling Long Sequences with Structured State Spaces](https://ar5iv.labs.arxiv.org/html/2111.00396) — Gu, Goel, Ré, 2021. Backs: convolution for training and recurrence for inference, efficient kernel, HiPPO, Path-X 16K, 60× faster generation. [^7]
- [Mamba: Linear-Time Sequence Modeling with Selective State Spaces](https://ar5iv.labs.arxiv.org/html/2312.00752) — Gu, Dao, 2023. Backs: continuous SSM, zero-order hold, recurrence and convolution forms, LTI and its limit, selection, selective scan, reported results including 4–5× inference throughput (§4.5, Figure 8), attention-free block. [^8]
- `machine-learning/lab-setup.md` — the lab where the script in the Worked example ran on 2026-11-25 (tiled vs naive, SDPA backends on CPU, cost vs length, window mask, linear attention, SSM forms). [^9]

## Related
- `machine-learning/transformers/attention-and-the-transformer.md` — the attention formula, masks and SDPA's mask conventions.
- `machine-learning/transformers/decoding-and-kv-cache.md` — the per-step cost of generation and the KV cache that linear attention and SSMs replace with a fixed state.
- `machine-learning/deep-learning/recurrent-networks.md` — RNNs, the recurrence that linear attention and SSMs bring back in a parallelizable form.
- `machine-learning/transformers/mixture-of-experts.md` — making the feed-forward half of the block cheaper instead.
- `performance/hardware/memory-hierarchy-and-caches.md` — why moving data between memory levels, not arithmetic, sets the speed.
