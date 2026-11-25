---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/transformers
status: verified
applies-to: ["any", "Hugging Face PEFT docs (main branch, latest stable v0.22.0) read 2026-11-24 for LoraConfig names and defaults"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [machine-learning, transformers, fine-tuning, instruction-tuning, sft, peft, lora, qlora, rank, lora-alpha, merging, quantization]
---

# Fine-tuning, instruction tuning and LoRA

## Summary
**TL;DR:** Fine-tuning continues training a pretrained model on task data. Full fine-tuning updates every weight, so it needs optimizer state for all of them and stores a full copy per task. Instruction tuning, or SFT (supervised fine-tuning), is fine-tuning on (instruction, desired answer) pairs. LoRA (low-rank adaptation) freezes the pretrained weight `W0` and learns only a low-rank update `ΔW = B·A`, scaled by `α/r`. That cuts trainable parameters by orders of magnitude, and merging `W0 + (α/r)·B·A` afterwards removes any inference cost. QLoRA (quantized LoRA) keeps the frozen weights in 4-bit and trains LoRA adapters on top.
**Use this when:** choosing between full fine-tuning and LoRA, picking `r`, `lora_alpha` and target modules, merging an adapter, or estimating fine-tuning memory.
**Not this doc:** the pretraining that comes first → `machine-learning/transformers/pretraining-and-scaling-laws.md`; preference tuning after SFT → `machine-learning/transformers/alignment-rlhf-and-dpo.md`; quantization in general → `machine-learning/ml-systems/model-compression-and-quantization.md`.

## Problem
A pretrained model predicts text in general, not your task's format, and few-shot prompting leaves quality on the table: fine-tuning boosts GPT-3 (Generative Pre-trained Transformer 3) 175B "significantly" over few-shot ✅[^1]. Full fine-tuning at that size is a hardware problem. It has the same memory footprint as pretraining ✅[^1]. Fine-tuning a 65-billion-parameter model in 16-bit needs more than 780 GB (gigabytes) of GPU (graphics processing unit) memory ✅[^2]. Every task also produces another full-size checkpoint ✅[^1]. An engineer needs to know which parts of the model must change and how cheaply that change can be stored and served.

## Mental model
**Analogy:** a printed encyclopedia plus a thin sheet of sticky notes. Full fine-tuning reprints the whole book for each customer. LoRA leaves the book untouched and writes corrections on a few sticky notes per page. Customers share one book and each gets their own small pad of notes. Merging glues the notes into the pages for one customer, so reading is as fast as before.

**Artifact:** a LoRA linear layer in 12 lines (from the Worked example's full script):

```python
class LoRALinear(nn.Module):
    def __init__(self, W0, r, alpha):
        super().__init__()
        self.register_buffer("W0", W0.clone())             # frozen: a buffer gets no gradient
        self.A = nn.Parameter(torch.randn(r, W0.shape[1]) / math.sqrt(W0.shape[1]))  # random Gaussian
        self.B = nn.Parameter(torch.zeros(W0.shape[0], r))  # zero, so B @ A = 0 at the start
        self.scale = alpha / r
    def forward(self, x):
        return x @ self.W0.T + self.scale * (x @ self.A.T) @ self.B.T
    def merged(self):
        return self.W0 + self.scale * self.B @ self.A
```

## How it works
### Full fine-tuning and instruction tuning
1. **Full fine-tuning:** start from the pretrained weights, add task layers if needed, and update all parameters on labeled task data with the usual loss ✅[^6]. With Adam, every trainable weight also carries optimizer state, which is why freezing most weights saves memory ✅[^1] (optimizers: `machine-learning/deep-learning/optimizers-and-learning-rate-schedules.md`).
2. **Instruction tuning:** fine-tune on many datasets rewritten as natural-language instructions. FLAN (Finetuned Language Net) instruction-tuned a 137B model on over 60 NLP (natural language processing) datasets. It improved zero-shot performance on unseen task types and beat zero-shot 175B GPT-3 on 20 of 25 datasets ✅[^3].
3. **SFT on demonstrations:** InstructGPT's first step fine-tunes GPT-3 with supervised learning on labeler-written demonstrations of the desired answer ✅[^4]. Its SFT models overfit validation loss after 1 epoch, yet training 16 epochs still improved reward-model score and human preference ✅[^4]. SFT is the usual starting point for the preference stage in `machine-learning/transformers/alignment-rlhf-and-dpo.md`.

### LoRA (low-rank adaptation), step by step
**Symbols:** `W0` = a pretrained weight matrix, `d × k` (outputs × inputs); `r` = the rank, much smaller than `d` and `k`; `B` = `d × r`; `A` = `r × k`; `α` (`lora_alpha`) = a constant scale; `x` = the layer input.
1. **Hypothesis:** the weight change needed for adaptation has a low "intrinsic rank", so write `W0 + ΔW = W0 + B·A` ✅[^1].
2. **Freeze and add:** `W0` gets no gradient; the layer computes `h = W0·x + (α/r)·B·A·x`, the two outputs summed coordinate-wise ✅[^1].
3. **Initialize:** `A` random Gaussian, `B` zero, so `B·A = 0` and the model starts exactly at the pretrained function ✅[^1]. PEFT's (Hugging Face's parameter-efficient fine-tuning library) default init likewise sets `B` to 0, with `A` Kaiming-uniform rather than Gaussian ✅[^5].
4. **Scale:** multiply the update by `α/r`. With Adam, tuning `α` is roughly like tuning the learning rate, if the initialization is scaled appropriately ✅[^1]. PEFT's `use_rslora=True` (rsLoRA, rank-stabilized LoRA) uses `α/√r` instead ✅[^5].
5. **Choose where:** LoRA can go on any weight matrix, but the paper studied only attention weights, and in most experiments only `W_q` and `W_v` ✅[^1]. PEFT's guide says it is typically applied to attention blocks ✅[^7].
6. **Deploy:** compute `W = W0 + (α/r)·B·A` once, so inference costs exactly what the base model costs. To switch tasks, subtract `B·A` and add another task's `B'·A'` ✅[^1]. In PEFT, `merge_and_unload()` returns the merged model (it is not in-place); `merge_adapter()` / `unmerge_adapter()` keep the adapter removable ✅[^5].

**Parameter count:** one adapted `d × k` matrix adds `r·(d + k)` trainable parameters instead of `d·k`. Example: `d = k = 64`, `r = 4` → `4 × 128 = 512` instead of 4,096.

**What the paper measured.** On GPT-3 175B, LoRA cut trainable parameters 10,000 times and GPU memory 3 times compared with Adam fine-tuning, matching or beating fine-tuning quality ✅[^1]. Training VRAM (GPU memory) fell from 1.2 TB (terabytes) to 350 GB. With `r = 4` on `W_q` and `W_v`, the checkpoint shrank from 350 GB to 35 MB (megabytes) ✅[^1]. A rank of 1 or 2 already sufficed when the full rank is 12,288 ✅[^1]. For a fixed budget of 18M parameters, putting it all into `W_q` or `W_k` alone (`r = 8`) did significantly worse, while adapting both `W_q` and `W_v` (`r = 4`) gave the best result ✅[^1].

### QLoRA (quantized LoRA)
- Back-propagate through a frozen 4-bit quantized model into LoRA adapters. This fine-tunes a 65B model on one 48 GB GPU while preserving 16-bit fine-tuning task performance ✅[^2].
- Weights are stored in NF4 (4-bit NormalFloat), a data type built for normally distributed weights. Compute happens in BF16 (bfloat16): each weight tensor is dequantized when used. Only the LoRA parameters get weight gradients ✅[^2] (formats: `floating-point/binary-formats.md`).
- **Double quantization** quantizes the quantization constants too: 0.5 bits per parameter becomes 0.127 bits ✅[^2]. **Paged optimizers** move optimizer state to CPU (central processing unit) memory during memory spikes ✅[^2].
- QLoRA's finding, for LLaMA 7B fine-tuned on Alpaca: the most important LoRA setting was how many adapters are used. LoRA on all linear layers of each transformer block was required to match full fine-tuning, and `r` did not affect performance ✅[^2].

## Worked example
A frozen 64 × 64 "pretrained" weight `W0`. The new task needs `W0 + ΔW_true`, where `ΔW_true` has rank 2. Full fine-tuning (`full FT` in the output) is compared with LoRA at `r` = 1, 2, 4, 8 (`α = 2r`, so the scale is 2). Each runs 500 full-batch Adam steps on 2,048 examples and is scored by MSE (mean squared error) on 512 held-out ones. Then a merge check and the sizing arithmetic. Lab run (`machine-learning/lab-setup.md`), 2026-11-24, PyTorch 2.15.0 CPU, deterministic, two runs identical ✅[^8]:

```text
method     trainable  val MSE step 0  val MSE step 500
full FT         4096        0.454318          2.23e-10
LoRA r=1         128        0.454318          1.72e-01
LoRA r=2         256        0.454318          8.29e-07
LoRA r=4         512        0.454318          1.77e-06
LoRA r=8        1024        0.454318          6.93e-07

fresh adapter (B = 0): max |output - base output| = 0.0
merged vs adapter path: max |diff| = 2.86102294921875e-06
unmerge (Wm - scale*B@A) vs W0: max |diff| = 2.9802322387695312e-08
top singular values of learned B@A (r = 4): [2.0751, 1.6619, 0.0007, 0.0004]
top singular values of the true change     : [4.1504, 3.3237, 0.0, 0.0]

== trainable parameters: LoRA on W_q and W_v of every layer ==
illustrative d_model=4096, 32 layers, r=8: W_q+W_v = 1,073,741,824  LoRA = 4,194,304 (0.391%), fp16 = 8.0 MiB
GPT-3 175B shape: d_model=12288, 96 layers, r=4: W_q+W_v = 28,991,029,248  LoRA = 18,874,368 (0.065%), fp16 = 36.0 MiB

== QLoRA memory arithmetic ==
quantization constants per weight: 32/64 = 0.5 bits; double-quantized: 8/64 + 32/(64*256) = 0.127 bits
65B weights: 16-bit = 130 GB, 4-bit + 0.127-bit constants = 33.5 GB
r= 4 alpha=16: LoRA scale alpha/r = 4.000   rsLoRA alpha/sqrt(r) = 8.000
r=16 alpha=16: LoRA scale alpha/r = 1.000   rsLoRA alpha/sqrt(r) = 4.000
r=64 alpha=16: LoRA scale alpha/r = 0.250   rsLoRA alpha/sqrt(r) = 2.000
```

<details><summary>Full script (prints the output above)</summary>

```python
# A tiny LoRA layer: W0 frozen, update = (alpha/r) * B @ A. Fit a task that needs a rank-2 weight change,
# compare ranks with full fine-tuning, check B=0 at start, merging and unmerging; then parameter and memory arithmetic.
import math, torch, torch.nn as nn
torch.manual_seed(0); torch.set_num_threads(1); torch.use_deterministic_algorithms(True)

d = 64
W0 = torch.randn(d, d) / math.sqrt(d)                     # the "pretrained" weight (out x in), frozen
dW_true = 0.5 * torch.randn(d, 2) @ torch.randn(2, d) / math.sqrt(d)   # the task needs a rank-2 change
X, Xv = torch.randn(2048, d), torch.randn(512, d)
Y, Yv = X @ (W0 + dW_true).T, Xv @ (W0 + dW_true).T

class LoRALinear(nn.Module):
    def __init__(self, W0, r, alpha):
        super().__init__()
        self.register_buffer("W0", W0.clone())             # frozen: a buffer gets no gradient
        self.A = nn.Parameter(torch.randn(r, W0.shape[1]) / math.sqrt(W0.shape[1]))  # random Gaussian
        self.B = nn.Parameter(torch.zeros(W0.shape[0], r))  # zero, so B @ A = 0 at the start
        self.scale = alpha / r
    def forward(self, x):
        return x @ self.W0.T + self.scale * (x @ self.A.T) @ self.B.T
    def merged(self):
        return self.W0 + self.scale * self.B @ self.A

class Full(nn.Module):                                     # full fine-tuning: every weight trainable
    def __init__(self, W0):
        super().__init__(); self.W = nn.Parameter(W0.clone())
    def forward(self, x): return x @ self.W.T

mse = lambda m, x, y: ((m(x) - y) ** 2).mean().item()
models = {"full FT": Full(W0)} | {f"LoRA r={r}": LoRALinear(W0, r, alpha=2 * r) for r in (1, 2, 4, 8)}
print(f"{'method':<10} {'trainable':>9}  {'val MSE step 0':>14}  {'val MSE step 500':>16}")
for name, m in models.items():
    n = sum(p.numel() for p in m.parameters() if p.requires_grad)
    start = mse(m, Xv, Yv)
    opt = torch.optim.Adam(m.parameters(), lr=1e-2)
    for _ in range(500):
        loss = ((m(X) - Y) ** 2).mean(); opt.zero_grad(); loss.backward(); opt.step()
    print(f"{name:<10} {n:>9}  {start:>14.6f}  {mse(m, Xv, Yv):>16.2e}")

lora = models["LoRA r=4"]
with torch.no_grad():
    base_out = Xv @ W0.T
    fresh = LoRALinear(W0, 4, 8)
    print("\nfresh adapter (B = 0): max |output - base output| =", (fresh(Xv) - base_out).abs().max().item())
    Wm = lora.merged()                                     # deploy: one plain matrix, no extra matmuls
    print("merged vs adapter path: max |diff| =", (Xv @ Wm.T - lora(Xv)).abs().max().item())
    print("unmerge (Wm - scale*B@A) vs W0: max |diff| =", (Wm - lora.scale * lora.B @ lora.A - W0).abs().max().item())
    print("top singular values of learned B@A (r = 4):", [round(v, 4) for v in torch.linalg.svdvals(lora.B @ lora.A)[:4].tolist()])
    print("top singular values of the true change     :", [round(v, 4) for v in torch.linalg.svdvals(dW_true)[:4].tolist()])

print("\n== trainable parameters: LoRA on W_q and W_v of every layer ==")
for label, dm, layers, r in [("illustrative d_model=4096, 32 layers, r=8", 4096, 32, 8),
                             ("GPT-3 175B shape: d_model=12288, 96 layers, r=4", 12288, 96, 4)]:
    full = 2 * layers * dm * dm                            # the two d x d matrices themselves
    lo = 2 * layers * r * (dm + dm)                         # A (r x d) + B (d x r) per matrix
    print(f"{label}: W_q+W_v = {full:,}  LoRA = {lo:,} ({100 * lo / full:.3f}%), fp16 = {lo * 2 / 2**20:.1f} MiB")

print("\n== QLoRA memory arithmetic ==")
print("quantization constants per weight: 32/64 =", 32 / 64, "bits; double-quantized: 8/64 + 32/(64*256) =",
      round(8 / 64 + 32 / (64 * 256), 3), "bits")
N = 65e9
print(f"65B weights: 16-bit = {N * 2 / 1e9:.0f} GB, 4-bit + {8/64 + 32/(64*256):.3f}-bit constants = {N * (4 + 0.127) / 8 / 1e9:.1f} GB")
for r, alpha in [(4, 16), (16, 16), (64, 16)]:
    print(f"r={r:2d} alpha={alpha}: LoRA scale alpha/r = {alpha / r:.3f}   rsLoRA alpha/sqrt(r) = {alpha / math.sqrt(r):.3f}")
```

</details>

Reading it line by line:
- **Rank must cover the change.** Every method starts at the same error (0.454), because `B = 0` makes every adapter start as the base model ✅[^8]. `r = 1` cannot express a rank-2 change and stalls at 0.172. `r = 2`, 4 and 8 reach about `1e-6` with 256 to 1,024 trainable parameters, against 4,096 for full fine-tuning ✅[^8]. More rank than the change needs bought nothing here.
- **What the adapter learned.** The `r = 4` adapter's `B·A` has two large singular values and two near zero. Times the scale `α/r = 2`, the large ones are 4.150 and 3.324, the true change: the extra rank went unused ✅[^8].
- **Merging is exact up to rounding.** The merged matrix gives the same outputs as the two-path layer (`2.9e-06`, float32). Subtracting `scale·B·A` recovers `W0` (`3e-08`) ✅[^8]. That is the paper's "no additional inference latency" and task-switching claim, in miniature ✅[^1].
- **Sizing.** For GPT-3's shape (`d_model = 12,288`, 96 layers), LoRA at `r = 4` on `W_q` and `W_v` has 18,874,368 parameters. That is the paper's "18M" budget, 36 MiB (mebibytes, 2^20 bytes) in fp16 (16-bit floating point), near its "roughly 35MB" ✅[^8] ✅[^1].
- **QLoRA arithmetic.** Double quantization gives 0.127 bits of constants per weight, as the paper states ✅[^2] ✅[^8]. Storing 65B weights then takes 33.5 GB instead of 130 GB in 16-bit. Adapters, activations and optimizer state come on top, which is why the paper needs a 48 GB card ✅[^8] ✅[^2].
- **Scale.** At fixed `α = 16`, raising `r` from 4 to 64 shrinks `α/r` 16-fold but `α/√r` only 4-fold ✅[^8]. Changing `r` without changing `α` therefore also changes the effective step size.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `r` below the rank the task needs | Error plateaus (lab: `r = 1` stuck at 0.172) | `B·A` cannot express the change ✅[^8] |
| Raising `r` but keeping `lora_alpha` | Update shrinks as `α/r` | The scale depends on `r` ✅[^1]; rsLoRA's `α/√r` shrinks less ✅[^5] ✅[^8] |
| `merge_and_unload()` called without using its return value | The merged model is lost | It is not in-place ✅[^5] |
| Many tasks in one batch with merged weights | Not straightforward | Each task's `B·A` is folded into `W` ✅[^1]; keep adapters unmerged to mix tasks ✅[^1] |
| LoRA with `bias="all"` or `"lora_only"` | Disabling the adapter no longer gives the base model's outputs | Base biases were trained ✅[^5] |
| QLoRA with LoRA on attention only | Below 16-bit fine-tuning quality in the QLoRA study | Adapters on all linear layers were required ✅[^2]; PEFT's guide notes attention-only as the typical choice ✅[^7] |
| SFT validation loss rising after epoch 1 | Can still improve the downstream metric | InstructGPT observed exactly this ✅[^4] |
| GPT-2-style `Conv1D` layers | Weights stored `(fan_in, fan_out)`; set `fan_in_fan_out=True` | PEFT `LoraConfig` note ✅[^5] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Full fine-tuning | Every weight can change; lowest error in the lab (`2e-10`) ✅[^8] | Pretraining-sized memory and a full checkpoint per task ✅[^1] |
| LoRA, unmerged | One base model in memory, adapters swapped per request ✅[^1] | Some inference latency from the separate adapter path ✅[^5] ✅[^1] |
| LoRA, merged | Base-model inference cost ✅[^1] | One task per merged copy ✅[^1] |
| QLoRA | 65B fine-tuning on one 48 GB GPU at 16-bit quality ✅[^2] | Dequantize on every use ✅[^2]; needs adapters on all linear layers ✅[^2] |
| Instruction tuning on many tasks | Zero-shot gains on unseen task types, growing with the number of task clusters ✅[^3] | Benefits appear only at sufficient model scale; less effective on tasks posed as completing a sentence ✅[^3] |

## Takeaways
- Start from LoRA on all linear layers with a small `r` (4–16); raise `r` only if the training loss plateaus. [rule-candidate]
- When you change `r`, decide whether `lora_alpha` changes too; the effective update is `α/r · B·A`.
- Merge for single-task serving; keep adapters separate when many tasks share one base model.
- Budget fine-tuning memory as frozen weights + gradients and optimizer state for the *trainable* part only; with LoRA that part is small (0.065 % of the adapted matrices for GPT-3's shape in the lab).

## Verification status
- Verified: 65 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- [LoRA: Low-Rank Adaptation of Large Language Models](https://arxiv.org/html/2106.09685v2) — Hu et al., 2021. Backs: intrinsic-rank hypothesis, `B·A` with `A` Gaussian and `B` zero, `α/r`, `W_q`/`W_v`, merging and task switching, GPT-3 numbers (10,000×, 3×, 1.2 TB → 350 GB, 35 MB, 18M budget, ranks 1–2), batching limitation, few-shot vs fine-tuning, pretraining-sized memory. [^1]
- [QLoRA: Efficient Finetuning of Quantized LLMs](https://arxiv.org/html/2305.14314v1) — Dettmers et al., 2023. Backs: 65B on one 48 GB GPU, more than 780 GB in 16-bit, NF4, BF16 compute, double quantization (0.5 → 0.127 bits), paged optimizers, LoRA on all linear layers. [^2]
- [Finetuned Language Models Are Zero-Shot Learners](https://arxiv.org/html/2109.01652v5) — Wei et al., 2022. Backs: instruction tuning definition, 137B on over 60 datasets, 20 of 25 against zero-shot GPT-3. [^3]
- [Training language models to follow instructions with human feedback](https://arxiv.org/html/2203.02155v1) — Ouyang et al., 2022. Backs: SFT on labeler demonstrations, 16 epochs, overfitting after 1 epoch. [^4]
- [LoRA developer guide and LoraConfig reference (PEFT)](https://huggingface.co/docs/peft/main/en/developer_guides/lora) — Hugging Face, living (main branch). Backs: `B` initialized to 0 and `A` Kaiming-uniform by default, `use_rslora` and `α/√r`, `merge_and_unload()` not in-place, `merge_adapter()`/`unmerge_adapter()`, `bias` caveat, `fan_in_fan_out`. [^5]
- [Large-Scale Pretraining with Transformers (Dive into Deep Learning, 11.9)](https://d2l.ai/chapter_attention-mechanisms-and-transformers/large-pretraining-transformers.html) — Zhang, Lipton, Li, Smola, living. Backs: fine-tuning updates pretrained parameters plus new task layers. [^6]
- [LoRA conceptual guide (PEFT)](https://huggingface.co/docs/peft/main/en/conceptual_guides/lora) — Hugging Face, living. Backs: LoRA typically applied to attention blocks in transformers. [^7]
- `machine-learning/lab-setup.md` — the lab where the LoRA rank sweep, merge check and sizing arithmetic ran on 2026-11-24. [^8]

## Related
- `machine-learning/transformers/pretraining-and-scaling-laws.md` — what the frozen weights learned first.
- `machine-learning/transformers/alignment-rlhf-and-dpo.md` — the preference stage that starts from the SFT model.
- `machine-learning/deep-learning/optimizers-and-learning-rate-schedules.md` — Adam's per-weight state, the memory LoRA avoids.
- `machine-learning/ml-systems/model-compression-and-quantization.md` — int8 and 4-bit quantization in general.
- `floating-point/binary-formats.md` — fp16 and bf16.
- `machine-learning/unsupervised-learning/principal-component-analysis.md` — singular values and low-rank structure.
