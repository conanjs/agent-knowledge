---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/ml-systems
status: verified
applies-to: ["any", "PyTorch 2.15 (torch.amp, quantization status)"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, ml-systems, quantization, int8, per-channel, post-training-quantization, quantization-aware-training, mixed-precision, fp16, bf16, loss-scaling, torchao]
---

# Model compression: int8 quantization, fp16 and bf16

## Summary
**TL;DR:** Two ways to store a trained network's numbers in fewer bits. **Quantization** stores numbers as 8-bit integers plus a scale (`r = S·(q − Z)`), a quarter of fp32's (32-bit float's) bytes; each weight moves by at most half a step, but one outlier stretches the step for the whole tensor, so per-channel scales or keeping outliers in 16-bit are needed. **16-bit floats** halve fp32's bytes instead. Mixed precision computes in fp16 (half precision in IEEE 754, the Institute of Electrical and Electronics Engineers floating-point standard) or bf16 (bfloat16): fp16 overflows above 65,504 and flushes tiny gradients to zero, so it needs loss scaling; bf16 keeps fp32's range with far less precision. Pruning and knowledge distillation, which remove weights or train a smaller model instead, have their own doc.
**Use this when:** a model is too large or slow for its target, you choose between int8 (8-bit integers), fp16 and bf16, accuracy dropped after quantizing, or fp16 training produces `inf` (infinity) or `NaN` (not a number) or stalls.
**Not this doc:** pruning and knowledge distillation → `machine-learning/ml-systems/pruning-and-knowledge-distillation.md`; `torch.autocast`'s per-op precision lists, where autocast and `GradScaler` go in a training loop (with clipping and gradient accumulation) → `machine-learning/deep-learning/mixed-precision-and-memory-saving.md`; the IEEE 754 binary16 and binary32 formats themselves → `floating-point/binary-formats.md`; 4-bit NF4 (NormalFloat) weights for fine-tuning (QLoRA, quantized low-rank adaptation) → `machine-learning/transformers/fine-tuning-and-lora.md`; the KV-cache (key–value cache) memory of a served LLM (large language model) → `machine-learning/transformers/decoding-and-kv-cache.md`.

## Problem
A float32 weight takes 4 bytes (lab: 8,192 weights = 32,768 bytes ✅[^8]), so model size and memory bandwidth limit where a model can run. Reduced precision lowers memory-bandwidth pressure and, on hardware with faster low-precision math, arithmetic time ✅[^2]. Deep Compression shrank AlexNet's storage 35 times, from 240 MB to 6.9 MB, without loss of accuracy ✅[^5]. But naive compression breaks models: in the lab, one outlier weight dropped an int8 model's accuracy from 0.976 to 0.459 ✅[^8].

## Mental model
**Analogy:** a ruler with 255 tick marks. Quantizing a tensor means choosing how long the ruler is (the scale) and rounding every value to the nearest tick. If one value is 50 times longer than the rest, the ruler must be 50 times longer, the ticks move far apart, and every small value rounds to the 0 tick. Per-channel quantization gives each row its own ruler.

**Artifact:** symmetric int8 quantization of a trained layer's weights by hand, `s = max|W| / 127`, `q = clamp(round(W / s), −127, 127)`, `W ≈ q · s`. Lab run (`machine-learning/lab-setup.md`), 2026-11-25, PyTorch 2.15.0 on the CPU (central processing unit) ✅[^8]:

```text
max|W| = 2.0632 -> s = 0.016246; W[0,1:4] = [-0.3024, -0.2928, 0.218] -> q = [-19, -18, 13] -> q*s = [-0.3087, -0.2924, 0.2112]
max|q*s - W| = 0.008121 <= s/2 = 0.008123; equals torch.quantize_per_tensor: True
```
Worked numbers: `2.0632 / 127 = 0.016246`; `−0.3024 / 0.016246 = −18.61`, rounded to `−19`, back to `−19 × 0.016246 = −0.3087`. Rounding to the nearest step moves each weight by at most half a step, `s/2 = 0.008123`. The full script is in the Worked example.

## How it works

### 1. Integer quantization
1. **The affine scheme.** `r = S·(q − Z)` maps an integer code `q` to a real value `r` with a positive real scale `S` and an integer zero-point `Z`, the code that represents real 0 exactly, which zero-padding needs ✅[^1]. One `(S, Z)` pair covers a whole weight or activation array ✅[^1]. Example from the PyTorch docs: with `S = 0.1`, `Z = 10`, the values `[−1, 0, 1, 2]` become the codes `[0, 10, 20, 30]` ✅[^7].
2. **Symmetric (absmax) int8.** `Z = 0` and the scale is set by the largest magnitude: LLM.int8() scales inputs into `[−127, 127]` by `127 / max|X|` ✅[^4], and Jacob et al. keep int8 weights in `[−127, 127]`, never −128 ✅[^1].
3. **Integer-only inference.** Products of 8-bit values are summed in a 32-bit integer accumulator; the bias is stored as int32 with scale `S_weights · S_inputs`; the result is rescaled by a fixed-point multiplier and saturated back to 8 bits ✅[^1].
4. **Granularity.** Jacob et al. list two common failure modes of simple post-training quantization with one scale per array: output channels whose weight ranges differ by more than 100 times, and outlier weights that make all remaining weights less precise ✅[^1]. Finer scales confine an outlier: LLM.int8()'s vector-wise quantization uses one constant per row of the inputs and per column of the weights ✅[^4]; the lab's per-channel version uses one per output row ✅[^8].
5. **Outlier features in large transformers.** Features up to 20 times larger than other dimensions appear and, at about 6.7B (billion) parameters, affect all layers, so 8-bit methods that ignore them fail; LLM.int8() multiplies those few outlier dimensions (about 0.1%) in 16-bit and the other 99.9% of values in 8-bit, with no degradation up to 175B parameters ✅[^4].
6. **Post-training vs quantization-aware.** Jacob et al. found that training in float and then quantizing works well enough for large models but causes significant accuracy drops for small ones ✅[^1]. Quantization-aware training (QAT) simulates quantization in the forward pass ("fake quantization" of weights before use and of activations where inference would quantize them), while back-propagation and the stored weights stay in float ✅[^1]. Activation ranges come from exponential moving averages of the ranges seen in training ✅[^1].
7. **Where it lives in PyTorch 2.15.** The quantization page says development is centralized in torchao; eager-mode and FX graph-mode `torch.ao.quantization` users should migrate to torchao's `quantize_` and PT2E (PyTorch 2 export) flows, and it plans to delete `torch.ao.quantization` "in 2.10 if there are no blockers", or otherwise in the earliest version once the blockers are cleared ✅[^6]. In the lab, PyTorch 2.15.0 still ships `torch.ao.quantization` (`find_spec` finds the module), and `torch.quantize_per_tensor` prints a `UserWarning` that quantized-tensor creation functions are deprecated ✅[^8]. torchao documents QAT and int4 weight-only quantization ✅[^10]; it was not installed in the lab ✅[^8].

### 2. Mixed precision: fp16 and bf16
This section covers the two formats' limits and the original fp16 training recipe. How `torch.autocast` picks a precision per op, where it should wrap a training step, and how `GradScaler` is used with clipping and gradient accumulation are explained, with a lab run, in `machine-learning/deep-learning/mixed-precision-and-memory-saving.md`.

1. **Per-op precision, in one line.** `torch.amp` runs some operations (linear layers, convolutions) in float16 or bfloat16, which are much faster there, and keeps others, such as reductions, in float32 for its range ✅[^3]. Do not call `.half()` or `.bfloat16()` on the model while using autocast ✅[^3].
2. **The three techniques for fp16 training** (Micikevicius et al.): keep an fp32 master copy of the weights that receives each update; scale the loss so small gradients survive; accumulate fp16 products into fp32 ✅[^2]. They state that any magnitude below `2⁻²⁴` becomes zero in fp16, and about 5% of one speech model's weight gradients were that small ✅[^2].
3. **Loss scaling.** Multiply the loss by `s` so that every fp16 gradient is `s` times larger, and divide by `s` before the step ✅[^3] (mechanism and lab run: the deep-learning doc above). `scaler.step` skips the update when the unscaled gradients contain `inf` or `NaN` ✅[^9]. Micikevicius et al. used factors from 8 to 32K and suggest choosing one so that `s × max|gradient|` stays below 65,504 ✅[^2].
4. **fp16 vs bf16.** fp16 training ordinarily pairs autocast with `GradScaler`, while CPU bf16 uses autocast alone ✅[^3] (why, and the training loop: the deep-learning doc above). Most bf16-pretrained models cannot run within fp16's maximum of 65,504 and overflow ✅[^3]. The lab numbers below show both sides: bf16 keeps fp32's range (70,000 survives where fp16 gives `inf`), but its step near 1 is 8 times fp16's (`0.0078125 / 0.0009766 = 8`) ✅[^8].

Lab run (`machine-learning/lab-setup.md`), 2026-11-25, PyTorch 2.15.0 (CPU), two runs identical ✅[^8]:

```text
torch.float32   bits=32 max=3.403e+38 smallest normal=1.175e-38 eps=1.192e-07
torch.float16   bits=16 max=6.55e+04 smallest normal=6.104e-05 eps=0.0009766
torch.bfloat16  bits=16 max=3.39e+38 smallest normal=1.175e-38 eps=0.007812
fp32     ['70000', '1.001', '3.1415927', '1e-06', '9.9999999e-09']
fp16     ['inf', '1.0009766', '3.140625', '1.013279e-06', '0']
bf16     ['70144', '1', '3.140625', '9.983778e-07', '1.0011718e-08']
grad fp32            ['1e-08', '3e-07', '2e-05']
grad cast to fp16    ['0', '2.98e-07', '2e-05']
scaled x65536 fp16   ['0.000655', '0.0197', '1.31']
unscaled in fp32     ['1e-08', '3e-07', '2e-05']
big grad 2.0 x65536 in fp16 -> inf
GradScaler defaults: {'init_scale': 65536.0, 'growth_factor': 2.0, 'backoff_factor': 0.5, 'growth_interval': 2000}
```

<details><summary>Full script (prints the output above)</summary>

```python
# fp16 vs bf16 on the same values, and why loss scaling rescues small fp16 gradients.
import inspect
import torch

for dt in (torch.float32, torch.float16, torch.bfloat16):
    f = torch.finfo(dt)
    print(f"{str(dt):<15} bits={f.bits} max={f.max:.4g} smallest normal={f.tiny:.4g} eps={f.eps:.4g}")
vals = torch.tensor([70000.0, 1.001, 3.14159265, 1e-6, 1e-8])
print("fp32    ", [f"{v:.8g}" for v in vals.tolist()])
print("fp16    ", [f"{v:.8g}" for v in vals.half().float().tolist()])
print("bf16    ", [f"{v:.8g}" for v in vals.bfloat16().float().tolist()])

grad = torch.tensor([1e-8, 3e-7, 2e-5])           # small gradients, as computed in fp32
scale = 65536.0                                     # torch.amp.GradScaler's default init_scale
print("grad fp32           ", [f"{v:.3g}" for v in grad.tolist()])
print("grad cast to fp16   ", [f"{v:.3g}" for v in grad.half().float().tolist()])
print("scaled x65536 fp16  ", [f"{v:.3g}" for v in (grad * scale).half().float().tolist()])
print("unscaled in fp32    ", [f"{v:.3g}" for v in ((grad * scale).half().float() / scale).tolist()])
print("big grad 2.0 x65536 in fp16 ->", (torch.tensor(2.0) * scale).half().item())
defaults = inspect.signature(torch.amp.GradScaler.__init__).parameters
print("GradScaler defaults:", {k: defaults[k].default for k in ("init_scale", "growth_factor", "backoff_factor", "growth_interval")})
```
</details>

Reading it: `eps` is the gap above 1.0 (`torch.finfo`'s definition ✅[^11]). bf16 has fp32's smallest normal and almost its max (3.39e+38 vs 3.403e+38), so 70,000 survives (as 70,144) where fp16 gives `inf`; but its `eps` is 0.0078, so 1.001 rounds to exactly 1. fp16 flushes the `1e-8` gradient to 0 and keeps `3e-7` only approximately (2.98e-07, a subnormal: `floating-point/special-values-and-exceptions.md`); multiplied by 65,536 all three fit, and dividing in fp32 recovers them to the 3 printed digits. A gradient of 2.0 times the same scale is 131,072, above 65,504, so it overflows; that is the case where `GradScaler` skips the step and multiplies the scale by the 0.5 backoff factor ✅[^12].

## Worked example
One trained network, quantized four ways. A 64-128-10 MLP (multi-layer perceptron) is trained on scikit-learn's bundled 8 × 8 digit images (1,257 training, 540 test). Its first-layer weights (128 × 64) are then quantized to int8 per tensor and per channel, first as trained, then with one outlier weight 50 times the maximum placed on pixel 0, which is 0 in every image, so the float model's predictions do not change. Core lines:

```python
amax = W.abs().amax(dim=1, keepdim=True) if per_channel else W.abs().max()
s = amax / 127
q = torch.clamp(torch.round(W / s), -127, 127).to(torch.int8)
W_out[5, 0] = 50 * W.abs().max()             # outlier on an input that is always 0
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-25, PyTorch 2.15.0 (CPU), scikit-learn 1.9.1, two runs identical; stderr also printed the `UserWarning` about deprecated quantized-tensor functions ✅[^8]:

```text
torch 2.15.0; torch.ao.quantization importable: True; torchao installed: False
W: (128, 64) fp32 = 32768 bytes; int8 = 8192 bytes + 1 scale
max|W| = 2.0632 -> s = 0.016246; W[0,1:4] = [-0.3024, -0.2928, 0.218] -> q = [-19, -18, 13] -> q*s = [-0.3087, -0.2924, 0.2112]
max|q*s - W| = 0.008121 <= s/2 = 0.008123; equals torch.quantize_per_tensor: True
pixel 0 always 0: True; fp32 accuracy clean 0.9759, with outlier 0.9759
clean    per-tensor  codes equal to 0:  2.3% | mean|error| 0.00404 | int8 accuracy 0.9759
clean    per-channel codes equal to 0:  0.7% | mean|error| 0.00178 | int8 accuracy 0.9759
outlier  per-tensor  codes equal to 0: 90.6% | mean|error| 0.19142 | int8 accuracy 0.4593
outlier  per-channel codes equal to 0:  1.4% | mean|error| 0.00336 | int8 accuracy 0.9759
```

<details><summary>Full script (prints the output above)</summary>

```python
# int8 weight quantization by hand: scale, round, clamp; per-tensor vs per-channel; one outlier weight.
import importlib.util
import torch
from sklearn.datasets import load_digits
from sklearn.model_selection import train_test_split

torch.manual_seed(0)
X, y = load_digits(return_X_y=True)
Xtr, Xte, ytr, yte = (torch.tensor(a) for a in train_test_split(X / 16.0, y, test_size=0.3, random_state=0))
Xtr, Xte = Xtr.float(), Xte.float()
net = torch.nn.Sequential(torch.nn.Linear(64, 128), torch.nn.ReLU(), torch.nn.Linear(128, 10))
opt = torch.optim.Adam(net.parameters(), lr=1e-2)
for _ in range(200):
    opt.zero_grad(); torch.nn.functional.cross_entropy(net(Xtr), ytr).backward(); opt.step()

def quantize(W, per_channel):                      # symmetric int8: s = max|W| / 127, q = clamp(round(W / s))
    amax = W.abs().amax(dim=1, keepdim=True) if per_channel else W.abs().max()
    s = amax / 127
    return torch.clamp(torch.round(W / s), -127, 127).to(torch.int8), s

def accuracy(W1):                                  # run the net with layer-1 weights replaced by W1
    with torch.no_grad():
        return (net[2](torch.relu(Xte @ W1.T + net[0].bias)).argmax(1) == yte).float().mean().item()

print(f"torch {torch.__version__}; torch.ao.quantization importable: {importlib.util.find_spec('torch.ao.quantization') is not None}; "
      f"torchao installed: {importlib.util.find_spec('torchao') is not None}")
W = net[0].weight.detach().clone()                 # 128 x 64, float32
q, s = quantize(W, per_channel=False)
print(f"W: {tuple(W.shape)} fp32 = {W.numel() * 4} bytes; int8 = {W.numel()} bytes + 1 scale")
print(f"max|W| = {W.abs().max():.4f} -> s = {s.item():.6f}; W[0,1:4] = {[round(v, 4) for v in W[0, 1:4].tolist()]}"
      f" -> q = {q[0, 1:4].tolist()} -> q*s = {[round(v, 4) for v in (q[0, 1:4] * s).tolist()]}")
print(f"max|q*s - W| = {(q * s - W).abs().max():.6f} <= s/2 = {s.item() / 2:.6f}; "
      f"equals torch.quantize_per_tensor: {torch.equal(q, torch.quantize_per_tensor(W, s.item(), 0, torch.qint8).int_repr())}")
W_out = W.clone(); W_out[5, 0] = 50 * W.abs().max()   # outlier on pixel 0, which is 0 in every image
print(f"pixel 0 always 0: {bool((X[:, 0] == 0).all())}; fp32 accuracy clean {accuracy(W):.4f}, with outlier {accuracy(W_out):.4f}")
for name, Wx in (("clean", W), ("outlier", W_out)):
    for pc in (False, True):
        q, s = quantize(Wx, pc)
        err = (q * s - Wx).abs(); err[5, 0] = 0      # error on the other 8191 weights
        print(f"{name:<8} {'per-channel' if pc else 'per-tensor':<11} codes equal to 0: {(q == 0).float().mean():5.1%}"
              f" | mean|error| {err.mean():.5f} | int8 accuracy {accuracy(q * s):.4f}")
```
</details>

Reading it line by line:
- **Size:** 32,768 bytes of fp32 become 8,192 bytes of int8 plus one scale: 4 times smaller.
- **Clean weights:** int8 per tensor keeps the float accuracy exactly (0.9759); per-channel cuts the mean error to less than half (0.00404 → 0.00178), with no accuracy left to gain here.
- **One outlier, per tensor:** the scale grows 50 times, so 90.6% of the 8,191 other weights round to code 0, their mean error rises from 0.00404 to 0.19142 (47 times), and accuracy falls from 0.9759 to 0.4593, although the float model with the outlier still scores 0.9759.
- **One outlier, per channel:** only row 5 gets the big scale; 1.4% of codes are 0 and accuracy stays at 0.9759.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| One outlier weight, per-tensor int8 | Most other weights round to 0; accuracy collapses | Outliers make all remaining weights less precise ✅[^1]; lab: 90.6% zero codes, 0.9759 → 0.4593 ✅[^8] |
| Output channels with ranges 100 times apart | Small-range channels get large relative error | One scale per array ✅[^1]; use per-channel or vector-wise scales ✅[^4] |
| Transformers at about 6.7B parameters and larger | Standard 8-bit quantization degrades | Systematic outlier features in all layers ✅[^4] |
| Post-training quantization of a small model | Significant accuracy drop | ✅[^1]; quantization-aware training simulates the rounding during training ✅[^1] |
| Value 0 (zero padding) | Must map to an exact code | The zero-point is the code of real 0 ✅[^1] |
| fp16 value well above 65,504 | `inf` | Lab: 70,000 → `inf` ✅[^8]; most bf16-pretrained models overflow fp16 ✅[^3] |
| Tiny fp16 gradient (Micikevicius et al.: below `2⁻²⁴`) | Flushed to 0, update lost | ✅[^2] ✅[^3]; lab: `1e-8` → 0 ✅[^8] |
| Loss scale too large | Gradients overflow, step skipped | `scaler.step` skips on `inf`/`NaN` ✅[^9]; then the scale is multiplied by `backoff_factor`, and by `growth_factor` after `growth_interval` consecutive clean steps ✅[^12]; defaults 0.5, 2.0 and 2,000, starting at 65,536 ✅[^8] |
| bf16 for values that need 3+ digits | Rounded away (1.001 → 1) | `eps` 0.0078 ✅[^8] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Post-training int8 | 4 times smaller weights than fp32 (lab) ✅[^8]; no retraining | Accuracy drops on small models ✅[^1]; sensitive to outliers ✅[^8] |
| Quantization-aware training | Designed to preserve end-to-end accuracy after quantization ✅[^1] | A training run with fake quantization |
| Per-channel or vector-wise scales | Outliers confined to their row ✅[^8] ✅[^4] | One scale per row or column to store and apply |
| LLM.int8() mixed-precision decomposition | No degradation up to 175B ✅[^4] | About 0.1% of dimensions stay 16-bit ✅[^4] |
| fp16 mixed precision | Nearly half the memory ✅[^2] | Loss scaling, master weights, overflow risk ✅[^2] |
| bf16 mixed precision | fp32's range, no scaler on CPU ✅[^3] ✅[^8] | 8 times coarser than fp16 near 1 ✅[^8] |

## Takeaways
- Quantize with per-channel (or finer) scales by default and check the largest weight magnitudes first: one outlier sets the step for its whole group. [rule-candidate]
- Measure accuracy on held-out data after every compression step: in the lab, per-tensor int8 kept the float accuracy on the clean weights and collapsed after one outlier.
- Before running a model pretrained in bf16 in fp16, check its magnitudes against fp16's 65,504 maximum. The general bf16-or-fp16 rule for training is in `machine-learning/deep-learning/mixed-precision-and-memory-saving.md`.
- In PyTorch 2.15, start new quantization work in torchao, not `torch.ao.quantization`.

## Verification status
- Verified: 66 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [Quantization and Training of Neural Networks for Efficient Integer-Arithmetic-Only Inference](https://arxiv.org/html/1712.05877v1) — Jacob et al., 2017. Backs: `r = S(q − Z)`, zero-point, one parameter set per array, int8 weights in [−127, 127], int32 accumulation and bias, post-training failure modes, simulated (fake) quantization, EMA activation ranges. [^1]
- [Mixed Precision Training](https://arxiv.org/html/1710.03740v3) — Micikevicius et al., 2018. Backs: reduced precision lowers bandwidth and arithmetic time, nearly halves memory; fp32 master weights, loss scaling, fp32 accumulation; `2⁻²⁴` flush; 5% of gradients; scale factors 8 to 32K, keep below 65,504. [^2]
- [Automatic Mixed Precision package - torch.amp](https://docs.pytorch.org/docs/2.15/amp.html) — PyTorch Foundation, PyTorch 2.15 docs. Backs: per-op precision, no `.half()` with autocast, gradient scaling, fp16 ordinarily with `GradScaler` and CPU bf16 with autocast only, bf16-pretrained models overflow fp16. [^3]
- [LLM.int8(): 8-bit Matrix Multiplication for Transformers at Scale](https://arxiv.org/html/2208.07339v2) — Dettmers, Lewis, Belkada, Zettlemoyer, 2022. Backs: absmax scaling by 127, one outlier hurts a per-tensor scale, vector-wise quantization, outlier features (20 times, 6.7B), mixed-precision decomposition (0.1% in 16-bit), no degradation to 175B. [^4]
- [Deep Compression: Compressing Deep Neural Networks with Pruning, Trained Quantization and Huffman Coding](https://arxiv.org/html/1510.00149v5) — Han, Mao, Dally, 2016. Backs: 35 times, 240 MB → 6.9 MB without loss of accuracy. [^5]
- [Quantization](https://docs.pytorch.org/docs/2.15/quantization.html) — PyTorch Foundation, PyTorch 2.15 docs. Backs: development centralized in torchao, migration paths, planned deletion of `torch.ao.quantization`. [^6]
- [torch.quantize_per_tensor](https://docs.pytorch.org/docs/2.15/generated/torch.quantize_per_tensor.html) — PyTorch Foundation, PyTorch 2.15 docs. Backs: scale and zero-point, the `[−1, 0, 1, 2]` → `[0, 10, 20, 30]` example. [^7]
- `machine-learning/lab-setup.md` — the lab where the int8 per-tensor/per-channel run and the fp16/bf16 and loss-scaling run ran on 2026-11-24 and again, with identical output, on 2026-11-25. [^8]
- [Automatic Mixed Precision examples](https://docs.pytorch.org/docs/2.15/notes/amp_examples.html) — PyTorch Foundation, PyTorch 2.15 docs. Backs: `scaler.step` skips the update on `inf`/`NaN` gradients. [^9]
- [torchao documentation](https://docs.pytorch.org/ao/stable/index.html) — PyTorch Foundation, torchao 0.17 docs. Backs: QAT and int4 weight-only quantization workflows. [^10]
- [Type Info (torch.finfo)](https://docs.pytorch.org/docs/2.15/type_info.html) — PyTorch Foundation, PyTorch 2.15 docs. Backs: `eps`, `max`, `tiny` definitions. [^11]
- [torch/amp/grad_scaler.py at v2.15.0](https://github.com/pytorch/pytorch/blob/v2.15.0/torch/amp/grad_scaler.py) — PyTorch source, tag v2.15.0. Backs: on `inf`/`NaN` the step is skipped and `update()` multiplies the scale by `backoff_factor`; after `growth_interval` consecutive unskipped steps, by `growth_factor`. [^12]

## Related
- `machine-learning/ml-systems/pruning-and-knowledge-distillation.md` — the other two ways to shrink a network: remove weights, or train a smaller model on a teacher's outputs.
- `machine-learning/deep-learning/mixed-precision-and-memory-saving.md` — autocast and `GradScaler` in a training loop, and where training memory goes.
- `floating-point/binary-formats.md` — binary16 (fp16) and binary32 (fp32) field widths, precision and range.
- `floating-point/special-values-and-exceptions.md` — `inf`, `NaN` and subnormals, which fp16 training runs into.
- `machine-learning/transformers/fine-tuning-and-lora.md` — QLoRA: 4-bit NF4 weights with bf16 compute.
- `machine-learning/transformers/decoding-and-kv-cache.md` — the serving-time memory that compression targets in LLMs.
- `machine-learning/deep-learning/optimizers-and-learning-rate-schedules.md` — the optimizer step that fp32 master weights feed.
