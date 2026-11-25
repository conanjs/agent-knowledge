---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/deep-learning
status: verified
applies-to: ["PyTorch 2.15.0"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [machine-learning, deep-learning, training-memory, mixed-precision, autocast, bfloat16, fp16, gradscaler, loss-scaling, gradient-accumulation, activation-checkpointing, gradient-checkpointing, saved-tensors-hooks, torch-compile]
---

# Mixed precision and memory saving in training

## Summary
**TL;DR:** Training memory goes to four things: the parameters, their gradients, the optimizer state (Adam keeps two extra numbers per parameter) and the activations saved for the backward pass. Mixed precision (`torch.autocast`) runs matrix multiplications and convolutions in a 16-bit float while keeping the weights, the loss and the gradients in float32; with fp16 it needs `GradScaler`, which multiplies the loss so that small gradients do not round to zero. Gradient accumulation adds the gradients of `k` small batches before one optimizer step, which equals one batch `k` times larger as long as each loss is divided by `k` and no layer (such as batch norm) looks across the batch. Activation checkpointing stores only a block's input and recomputes the rest during backward: less memory, one extra forward pass.
**Use this when:** a model does not fit in memory during training, you turn on `torch.autocast` or `GradScaler`, gradients become zero or `inf` in fp16, you want a larger effective batch than fits, or you consider `torch.utils.checkpoint`.
**Not this doc:** the fp16 and bf16 formats themselves and why fp16 overflows above 65,504 → `machine-learning/ml-systems/model-compression-and-quantization.md` (mixed precision section) and `floating-point/binary-formats.md`; what Adam's two moments are → `machine-learning/deep-learning/optimizers-and-learning-rate-schedules.md`; splitting training across several devices → `machine-learning/deep-learning/distributed-training.md`.

## Problem
A model's parameter count says little about the memory it needs to train. With Adam, each float32 parameter brings a float32 gradient and two float32 moment estimates: in the lab, a model of 1,025,024 parameters held 4.1 MB of parameters, 4.1 MB of gradients and 8.2 MB of Adam state, four times the weights before a single activation is stored ✅[^9]. With mixed-precision Adam, ZeRO's authors count 16 bytes per parameter, so a 7.5-billion-parameter model needs about 120 GB for model state alone ✅[^3], and the saved activations can be as large again: about 60 GB for a 1.5-billion-parameter GPT-2 at sequence length 1,024 and batch size 32 ✅[^3]. The fixes each trade something: precision, time or batch semantics.

## Mental model
**Analogy:** packing for a long trip in a small car. Parameters are the passengers (they must come). Gradients and optimizer state are their luggage. Activations are the snacks bought along the way and kept until the return journey (the backward pass) needs them. Mixed precision packs some things in smaller bags; gradient accumulation makes several short trips instead of one long one; checkpointing throws most snacks away and buys them again on the way back.

**Artifact:** where the memory goes, and what checkpointing saves; printed by the full script in the Worked example; lab run (`machine-learning/lab-setup.md`), 2026-11-24, PyTorch 2.15.0 ✅[^9]:

```text
parameters 1025024 | param bytes 4100096 | grad bytes 4100096 | Adam state bytes 8200192 | state keys ['exp_avg', 'exp_avg_sq', 'step']
no checkpoint: saved tensors 24 | activation bytes 1048576 | block forwards 8
checkpointed:  saved tensors 8 | activation bytes 524288 | block forwards 16
```

## How it works
### 1. The four memory consumers
1. **Parameters and gradients:** one gradient per parameter, same shape and, without mixed precision, same dtype ✅[^9].
2. **Optimizer state:** Adam keeps a first moment and a second moment, both initialized to zero ✅[^7], stored per parameter ✅[^7]; PyTorch names them `exp_avg` and `exp_avg_sq` (lab) ✅[^9]. In mixed-precision training ZeRO counts 2 bytes (fp16 parameters) + 2 bytes (fp16 gradients) + 12 bytes (an fp32 copy of the parameters, the fp32 momentum and the fp32 variance) = 16 bytes per parameter ✅[^3]. Plain float32 training with Adam also comes to 16 bytes per parameter (4 + 4 + 8), the lab's 4.1 + 4.1 + 8.2 MB ✅[^9].
3. **Activations:** autograd saves some forward-pass tensors for the backward pass; `torch.autograd.graph.saved_tensors_hooks(pack, unpack)` intercepts every tensor saved inside its context ✅[^6]. A saved input tensor is a reference to the same storage, not a copy ✅[^6], so the weights the lab's linear layers save cost no new memory; their inputs and the GELU inputs do.

### 2. Autocast: which ops run in lower precision
1. **Per-op lists:** inside `torch.autocast(device_type="cpu", dtype=torch.bfloat16)`, ops on the CPU lower-precision list (among them `linear`, `matmul`, `mm`, `bmm`, `conv1d/2d/3d` and `scaled_dot_product_attention`) run in bf16; ops on the CPU float32 list (losses such as `mse_loss`, `nll_loss`, `cross_entropy_loss`, `binary_cross_entropy_with_logits`, plus `prod`, FFTs and linear-algebra solvers) run in float32 ✅[^1]. float16 on CPU shares the bf16 lists ✅[^1].
2. **Unlisted ops** do not go through autocast and run in the dtype of their inputs ✅[^1]. In the lab, `relu` after a bf16 `linear` returned bf16, while `mse_loss` returned float32 ✅[^9]. On CPU, `softmax` is on neither list, so it follows its input; it is on the CUDA float32 list ✅[^1].
3. **Weights stay float32:** autocast casts inputs per op; the lab's weight and its gradient stayed float32 ✅[^9]. Autocast should wrap only the forward pass and the loss; backward under autocast is not recommended ✅[^1].
4. **fp16 vs bf16:** CPU bf16 mixed precision uses only `torch.autocast`; fp16 uses `autocast` together with `GradScaler` ✅[^1]. The reason is range: bf16 keeps float32's exponent range, fp16 does not (format details: `machine-learning/ml-systems/model-compression-and-quantization.md`).

### 3. Loss scaling and `GradScaler`
1. **Why fp16 gradients vanish:** small gradient values may not be representable in float16, flush to zero ("underflow"), and the update for those parameters is lost ✅[^1]. In the lab, a true gradient of `0.01 × 2⁻²⁰ = 9.54e-09`, below fp16's smallest subnormal `2⁻²⁴ ≈ 6.0e-08`, came out as exactly `0.0` ✅[^9].
2. **The fix:** multiply the loss by a scale factor and run backward on the scaled loss ✅[^1]; every gradient is scaled by the same factor. Lab: with the loss times 65,536 the same fp16 gradient was `0.0006251`, and dividing by 65,536 in float32 gave back `9.54e-09` ✅[^9]. Keep the scale out of fp16 itself: 65,536 is above fp16's maximum of 65,504.
3. **The dynamic schedule:** `GradScaler` skips `optimizer.step()` when the unscaled gradients contain `inf` or `NaN` and multiplies the scale by `backoff_factor`, and raises it by `growth_factor` after `growth_interval` clean steps (details and source: `machine-learning/ml-systems/model-compression-and-quantization.md`). Lab, `growth_interval=2`: the `inf` step left the parameter at 0.90 and halved the scale to 32,768; two clean steps later it was back at 65,536 ✅[^9].
4. **With clipping or accumulation:** call `scaler.unscale_(optimizer)` before clipping, so that the clip threshold applies to true gradients ✅[^2]; when accumulating, unscale and call `update` only at the end of an iteration that calls `step` for a full effective batch ✅[^2].

### 4. Gradient accumulation
1. **Mechanism:** gradient accumulation adds gradients over an effective batch of size `batch_per_iter × iters_to_accumulate` ✅[^2]: call `backward()` on each micro-batch (gradients add up in `.grad`), then `step()` and `zero_grad()` once.
2. **Equivalence:** with a mean loss over `k` equal micro-batches, `mean over all = (1/k) · Σ micro-batch means`, so divide each micro-batch loss by `k`. Lab, 32 rows in 4 chunks: largest gradient difference `1.19e-07` (float32 rounding), and without the `/ k` every gradient was exactly 4 times too large ✅[^9]. Unequal micro-batches (a short last chunk) break the equal weighting.
3. **The batch-norm caveat:** batch norm normalizes with the statistics of the batch it sees (`machine-learning/deep-learning/normalization-and-dropout.md`), so 4 batches of 8 are not one batch of 32. Lab: the same network with a `BatchNorm1d` layer gave first-layer gradients up to `0.2273` apart ✅[^9]. Layer norm has no such dependence.
4. **Under DDP:** wrap all but the last micro-batch in `model.no_sync()`, which disables gradient synchronization; gradients accumulate and are synchronized on the first backward after the context exits ✅[^10].

### 5. Activation checkpointing
1. **Mechanism:** `torch.utils.checkpoint.checkpoint(fn, x, use_reentrant=False)` does not keep the tensors produced inside `fn` for backward; it re-runs `fn` during backward to recompute them ✅[^4]. It "trades compute for memory" ✅[^4].
2. **Lab:** 8 blocks of `Linear(256, 256)` + `GELU` on a 64 × 256 input: autograd saved 24 tensors (1,048,576 bytes of activations) without checkpointing and 8 tensors (524,288 bytes, one input per block) with it; the blocks ran 16 times instead of 8, and the gradients were identical ✅[^9].
3. **How much it can save:** Chen et al. give an `O(√n)` memory schedule for an `n`-layer network at the cost of one extra forward pass per mini-batch ✅[^5], and cut a 1,000-layer residual network from 48 GB to 7 GB ✅[^5]; ZeRO's GPT-2 example drops from about 60 GB to about 8 GB ✅[^3]. Selective recomputation, which recomputes only the memory-heavy but cheap parts of a transformer layer, combined with sequence parallelism, cut the execution-time overhead of recomputation by over 90 % compared with full recomputation ✅[^11].
4. **Options:** pass `use_reentrant=False`, which is recommended, and pass it explicitly because a future release will raise if it is missing ✅[^4]. RNG (random number generator) state is stashed and restored by default so that dropout recomputes the same mask; `preserve_rng_state=False` skips that ✅[^4].

### 6. `torch.compile`
`torch.compile` optimizes a model or function with TorchDynamo and a backend, by default Inductor ✅[^8]. It is a speed tool rather than a memory tool, and combines with autocast and checkpointing; its `mode` options (`default`, `reduce-overhead`, `max-autotune`, `max-autotune-no-cudagraphs`) trade compile time and overhead, and `reduce-overhead` relies on CUDA graphs ✅[^8].

## Worked example
One script, five checks: Adam's memory, CPU autocast, fp16 underflow and `GradScaler`, gradient accumulation (with and without batch norm), and checkpointing measured with `saved_tensors_hooks`. Lab run (`machine-learning/lab-setup.md`), 2026-11-24, PyTorch 2.15.0 (CPU), two runs identical ✅[^9]:

```text
== 1. Where training memory goes: Adam state for a 1M-parameter model ==
parameters 1025024 | param bytes 4100096 | grad bytes 4100096 | Adam state bytes 8200192 | state keys ['exp_avg', 'exp_avg_sq', 'step']
== 2. torch.autocast(device_type='cpu', dtype=torch.bfloat16) ==
weight torch.float32 | linear out torch.bfloat16 | relu out torch.bfloat16 | mse_loss out torch.float32
weight grad torch.float32 | max |bf16 - fp32| of linear out 0.0068
== 3. fp16 gradient underflow and loss scaling ==
true grad 9.54e-09 | fp16 grad, no scaling: 0.0
fp16 grad with loss x65536: 0.0006251 | unscaled in fp32: 9.54e-09
GradScaler step 0: grad 1.0 -> param 1.00 -> 0.90, next scale 65536
GradScaler step 1: grad inf -> param 0.90 -> 0.90, next scale 32768
GradScaler step 2: grad 1.0 -> param 0.90 -> 0.80, next scale 32768
GradScaler step 3: grad 1.0 -> param 0.80 -> 0.70, next scale 65536
== 4. Gradient accumulation == one big batch (sum of means / k) ==
max |full - accumulated| weight grad: 1.19e-07 | allclose: True
without / k: ratio accumulated/full = 4.0
with BatchNorm: max |full - accumulated| first-layer grad: 0.2273
== 5. Activation checkpointing: tensors saved for backward ==
no checkpoint: saved tensors 24 | activation bytes 1048576 | block forwards 8
checkpointed:  saved tensors 8 | activation bytes 524288 | block forwards 16
same gradients: True
```

<details><summary>Full script (prints the output above)</summary>

```python
# Mixed precision, loss scaling, gradient accumulation and activation checkpointing (PyTorch, CPU).
import torch
from torch import nn
from torch.utils.checkpoint import checkpoint
torch.manual_seed(0)

print("== 1. Where training memory goes: Adam state for a 1M-parameter model ==")
model = nn.Sequential(nn.Linear(1000, 1000), nn.Linear(1000, 24))
opt = torch.optim.Adam(model.parameters())
model(torch.randn(4, 1000)).sum().backward(); opt.step()
nbytes = lambda ts: sum(t.numel() * t.element_size() for t in ts)
params = list(model.parameters())
state = [v for s in opt.state.values() for v in s.values() if torch.is_tensor(v) and v.dim() > 0]
print("parameters", sum(p.numel() for p in params), "| param bytes", nbytes(params),
      "| grad bytes", nbytes([p.grad for p in params]), "| Adam state bytes", nbytes(state),
      "| state keys", sorted(opt.state[params[0]].keys()))

print("== 2. torch.autocast(device_type='cpu', dtype=torch.bfloat16) ==")
lin = nn.Linear(8, 8); x = torch.randn(4, 8); target = torch.randn(4, 8)
with torch.autocast(device_type="cpu", dtype=torch.bfloat16):
    h = lin(x)                                   # linear: on the CPU lower-precision list
    r = torch.relu(h)                            # relu: on no list, runs in its input's dtype
    l = nn.functional.mse_loss(r, target)        # mse_loss: on the CPU float32 list
print("weight", lin.weight.dtype, "| linear out", h.dtype, "| relu out", r.dtype, "| mse_loss out", l.dtype)
l.backward()                                     # backward outside the autocast block
print("weight grad", lin.weight.grad.dtype, "| max |bf16 - fp32| of linear out",
      f"{(h.float() - lin(x)).abs().max().item():.4f}")

print("== 3. fp16 gradient underflow and loss scaling ==")
w = torch.tensor([1.0], dtype=torch.float16, requires_grad=True)
c = torch.tensor([2.0**-20], dtype=torch.float16)          # fp16 activation, 9.5e-07
def loss_fn(): return (w * c).float().sum() * 0.01           # fp32 loss; true dloss/dw = 0.01 * 2^-20 = 9.5e-09
loss_fn().backward()                                         # 9.5e-09 is below fp16's smallest subnormal 2^-24 = 6.0e-08
print("true grad", f"{0.01 * 2**-20:.3g}", "| fp16 grad, no scaling:", w.grad.item())
w.grad = None
S = 65536.0
(loss_fn() * S).backward()                                   # scale the fp32 loss: fp16 grad = 6.25e-04
print("fp16 grad with loss x65536:", f"{w.grad.item():.4g}", "| unscaled in fp32:", f"{w.grad.float().item() / S:.3g}")
gs = torch.amp.GradScaler("cpu", init_scale=2.0**16, growth_interval=2)
p = nn.Parameter(torch.ones(1)); o = torch.optim.SGD([p], lr=0.1)
for step, g in enumerate([1.0, float("inf"), 1.0, 1.0]):
    o.zero_grad(); gs.scale((p * g).sum()).backward()
    before = p.item(); gs.step(o); gs.update()
    print(f"GradScaler step {step}: grad {g} -> param {before:.2f} -> {p.item():.2f}, next scale {gs.get_scale():.0f}")

print("== 4. Gradient accumulation == one big batch (sum of means / k) ==")
torch.manual_seed(1)
X, Y = torch.randn(32, 10), torch.randn(32, 1)
def fresh():
    torch.manual_seed(2); return nn.Linear(10, 1)
full = fresh(); nn.functional.mse_loss(full(X), Y).backward()
acc = fresh(); k = 4
for xb, yb in zip(X.chunk(k), Y.chunk(k)):
    (nn.functional.mse_loss(acc(xb), yb) / k).backward()   # grads add up in .grad
diff = (full.weight.grad - acc.weight.grad).abs().max().item()
print(f"max |full - accumulated| weight grad: {diff:.2e} | allclose: {torch.allclose(full.weight.grad, acc.weight.grad, atol=1e-6)}")
bad = fresh()
for xb, yb in zip(X.chunk(k), Y.chunk(k)):
    nn.functional.mse_loss(bad(xb), yb).backward()          # forgot / k
print("without / k: ratio accumulated/full =", round((bad.weight.grad / full.weight.grad).mean().item(), 4))
def bn_net():
    torch.manual_seed(3); return nn.Sequential(nn.Linear(10, 4), nn.BatchNorm1d(4), nn.Linear(4, 1))
f2 = bn_net(); nn.functional.mse_loss(f2(X), Y).backward()
a2 = bn_net()
for xb, yb in zip(X.chunk(k), Y.chunk(k)):
    (nn.functional.mse_loss(a2(xb), yb) / k).backward()
print("with BatchNorm: max |full - accumulated| first-layer grad:",
      f"{(f2[0].weight.grad - a2[0].weight.grad).abs().max().item():.4f}")

print("== 5. Activation checkpointing: tensors saved for backward ==")
torch.manual_seed(4)
blocks = nn.ModuleList([nn.Sequential(nn.Linear(256, 256), nn.GELU()) for _ in range(8)])
inp = torch.randn(64, 256, requires_grad=True)
param_ptrs = {p.data_ptr() for p in blocks.parameters()}
calls = {"n": 0}
def counted(b):
    def f(x):
        calls["n"] += 1; return b(x)               # counts every run of a block, recomputation included
    return f
def run(use_ckpt):
    saved = {"n": 0, "act_bytes": 0}; calls["n"] = 0
    def pack(t):
        saved["n"] += 1
        if t.data_ptr() not in param_ptrs:          # weights are saved by reference: no new memory
            saved["act_bytes"] += t.numel() * t.element_size()
        return t
    with torch.autograd.graph.saved_tensors_hooks(pack, lambda t: t):
        h = inp
        for b in blocks:
            h = checkpoint(counted(b), h, use_reentrant=False) if use_ckpt else counted(b)(h)
        loss = h.sum()
    grads = torch.autograd.grad(loss, [inp, blocks[0][0].weight])
    return saved, calls["n"], grads
s0, c0, g0 = run(False); s1, c1, g1 = run(True)
print("no checkpoint: saved tensors", s0["n"], "| activation bytes", s0["act_bytes"], "| block forwards", c0)
print("checkpointed:  saved tensors", s1["n"], "| activation bytes", s1["act_bytes"], "| block forwards", c1)
print("same gradients:", all(torch.allclose(a, b) for a, b in zip(g0, g1)))
```

</details>

Reading it, block by block:
- **Memory:** Adam's state is exactly twice the parameter bytes (8,200,192 = 2 × 4,100,096); `step` is a scalar and is left out of the count.
- **Autocast:** `linear` ran in bf16 and differed from the float32 result by up to `0.0068`; `relu` stayed bf16 because it is unlisted; `mse_loss` came back float32.
- **Loss scaling:** the unscaled fp16 gradient was lost entirely; scaling by `2¹⁶` moved it to `6.25e-04`, well inside fp16's range, and unscaling in float32 recovered the true value.
- **Accumulation:** four quarter-batches with `/ 4` reproduced the full-batch gradient to float32 rounding; batch norm broke the equivalence because each quarter was normalized with its own mean and variance.
- **Checkpointing:** without it, each block saved its linear input, its weight (by reference) and its GELU input, 3 × 8 = 24 tensors; with it, only the 8 block inputs (64 × 256 × 4 bytes = 65,536 bytes each), paid for with 8 recomputed block forwards.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `backward()` inside the `autocast` block | Not recommended | Autocast should wrap only the forward pass and the loss ✅[^1] |
| fp16 training without `GradScaler` | Small gradients become 0 and their updates are lost | Underflow ✅[^1]; lab ✅[^9] |
| Gradient clipping with `GradScaler` | Clips the scaled gradients by mistake | Call `scaler.unscale_` first ✅[^2] |
| Accumulating without dividing the loss by `k` | Gradients `k` times too large, like a learning rate `k` times larger | Sum instead of mean; lab ratio 4.0 ✅[^9] |
| Accumulation with batch norm | Not equivalent to the big batch | Statistics per micro-batch; lab difference 0.2273 ✅[^9] |
| Accumulation under DDP without `no_sync()` | An all-reduce after every micro-batch: correct, but wasted communication | `no_sync` disables synchronization until the last micro-batch ✅[^10] |
| Checkpointed function behaves differently on recomputation (global flag, device move) | Error or silently wrong gradients | Recomputation must match the forward ✅[^4] |
| Dropout inside a checkpointed block | Same mask on recomputation by default | RNG state is stashed and restored ✅[^4] |
| Counting forward calls with a module forward hook | The hook missed the recomputation in the lab (8 instead of 16), so a wrapper function was used | Observed on PyTorch 2.15.0 ✅[^9] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| bf16 autocast | Lower-precision matmuls, no loss scaling on CPU ✅[^1] | Fewer mantissa bits: `0.0068` error on one lab layer ✅[^9] |
| fp16 autocast + `GradScaler` | 16-bit compute | Underflow handling, skipped steps on `inf` ✅[^1] ✅[^9] |
| Gradient accumulation | Large effective batch in the memory of a small one ✅[^2] | `k` sequential passes per step; breaks with batch norm ✅[^9] |
| Activation checkpointing | Lab: half the activation bytes ✅[^9]; 48 GB → 7 GB in Chen et al. ✅[^5] | One extra forward per checkpointed block ✅[^5] ✅[^9] |
| Sharding optimizer state, gradients and parameters (ZeRO, FSDP) | Model-state memory divided across devices ✅[^3] | Needs several devices and more communication; see `machine-learning/deep-learning/distributed-training.md` |

## Takeaways
- Budget about 16 bytes per parameter for Adam training (fp32, or mixed precision with fp32 master weights), plus activations, before choosing hardware. [rule-candidate]
- Use bf16 autocast where the hardware supports it; with fp16 always pair autocast with `GradScaler`, and `unscale_` before clipping. [rule-candidate]
- When accumulating gradients, divide each micro-batch loss by the number of micro-batches and do not expect batch norm to behave like the large batch. [rule-candidate]
- Reach for activation checkpointing when activations, not model state, are the largest memory item; pass `use_reentrant=False`.

## Verification status
- Verified: 64 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- [Automatic Mixed Precision package - torch.amp](https://docs.pytorch.org/docs/2.15/amp.html) — PyTorch, 2026 (2.15). Backs: CPU lower-precision and float32 op lists, float16 shares the bf16 lists, unlisted ops, softmax on the CUDA list, autocast scope and backward, underflow and gradient scaling, CPU bf16 uses only autocast. [^1]
- [Automatic Mixed Precision examples](https://docs.pytorch.org/docs/2.15/notes/amp_examples.html) — PyTorch, 2026 (2.15). Backs: `unscale_` before clipping, accumulation's effective batch size, when to call `unscale_` and `update` with accumulation. [^2]
- [ZeRO: Memory Optimizations Toward Training Trillion Parameter Models](https://arxiv.org/abs/1910.02054) — Rajbhandari, Rasley, Ruwase, He, 2020 (full text read on ar5iv). Backs: 16 bytes per parameter and its parts, 7.5B → 120 GB, GPT-2 1.5B activations 60 GB → 8 GB with checkpointing. [^3]
- [torch.utils.checkpoint](https://docs.pytorch.org/docs/2.15/checkpoint.html) — PyTorch, 2026 (2.15). Backs: tensors not kept and recomputed, compute-for-memory trade, `use_reentrant=False`, RNG stashing, recomputation must match. [^4]
- [Training Deep Nets with Sublinear Memory Cost](https://arxiv.org/abs/1604.06174) — Chen, Xu, Zhang, Guestrin, 2016. Backs: `O(√n)` memory, one extra forward pass, 48 GB → 7 GB. [^5]
- [Autograd mechanics: Hooks for saved tensors](https://docs.pytorch.org/docs/2.15/notes/autograd.html) — PyTorch, 2026 (2.15). Backs: `saved_tensors_hooks` applies to all tensors saved in its context, saved tensors share storage. [^6]
- [torch.optim.Adam](https://docs.pytorch.org/docs/2.15/generated/torch.optim.Adam.html) — PyTorch, 2026 (2.15). Backs: first and second moments initialized to zero, state per parameter. [^7]
- [torch.compile](https://docs.pytorch.org/docs/2.15/generated/torch.compile.html) — PyTorch, 2026 (2.15). Backs: TorchDynamo plus a backend, default Inductor, modes, CUDA graphs. [^8]
- `machine-learning/lab-setup.md` — the lab where the memory, autocast, loss-scaling, accumulation and checkpointing script ran on 2026-11-24. [^9]
- [torch.nn.parallel.DistributedDataParallel](https://docs.pytorch.org/docs/2.15/generated/torch.nn.parallel.DistributedDataParallel.html) — PyTorch, 2026 (2.15). Backs: `no_sync()` for accumulation. [^10]
- [Reducing Activation Recomputation in Large Transformer Models](https://arxiv.org/abs/2205.05198) — Korthikanti et al., 2022 (full text read on ar5iv). Backs: selective recomputation, over 90 % less recomputation overhead. [^11]

## Related
- `machine-learning/ml-systems/model-compression-and-quantization.md` — fp16 and bf16 ranges, loss-scaling factors, the `GradScaler` source.
- `floating-point/binary-formats.md` — binary16 (fp16) and binary32 field widths and limits.
- `machine-learning/deep-learning/optimizers-and-learning-rate-schedules.md` — what Adam's two moments do.
- `machine-learning/deep-learning/normalization-and-dropout.md` — why batch norm depends on the batch.
- `machine-learning/deep-learning/distributed-training.md` — sharding the same memory across devices.
- `machine-learning/ml-systems/reproducibility-and-determinism.md` — why reduced precision and reduction order change the last digits.
- `performance/accelerator-data-and-cost.md` — measuring time to quality, not throughput alone.
- `machine-learning/transformers/pretraining-and-scaling-laws.md` — the compute budget these techniques stretch.
