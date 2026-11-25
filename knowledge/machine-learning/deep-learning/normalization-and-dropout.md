---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/deep-learning
status: verified
applies-to: ["PyTorch 2.15.0"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, deep-learning, batch-normalization, batchnorm, layer-normalization, layernorm, running-statistics, dropout, inverted-dropout, train-mode, eval-mode, regularization]
---

# Normalization and dropout

## Summary
**TL;DR:** Batch normalization standardizes each feature with the mean and variance of the current mini-batch, then applies a learned scale and shift; it keeps running averages of those statistics and uses them instead in `eval()` mode, so the same input gives different outputs in the two modes. Layer normalization standardizes each example over its own features, so it needs no batch and computes the same thing in training and evaluation. Dropout zeroes each element with probability `p` during training and multiplies the survivors by `1/(1 − p)`, so that in `eval()` mode it can simply pass the input through.
**Use this when:** validation results change when you forget `model.eval()`, a batch of one fails or behaves oddly, you choose between `BatchNorm1d`/`BatchNorm2d` and `LayerNorm`, or you need to know what `momentum`, `eps` and `p` mean in these layers.
**Not this doc:** weight decay and L2 (squared-norm) penalties → `machine-learning/foundations/regularization.md` and `machine-learning/deep-learning/optimizers-and-learning-rate-schedules.md`; choosing initial weights so activations start in range → `machine-learning/deep-learning/activations-and-initialization.md`; layer norm inside the transformer block, including where it is placed (pre-LN) → `machine-learning/transformers/attention-and-the-transformer.md`.

## Problem
Batch norm and dropout are the two common layers whose output depends on a mode switch, and the switch is manual: you are responsible for calling `model.train()` and `model.eval()`, for example so that validation data does not update BatchNorm's running statistics ✅[^1]. Forget it, and dropout keeps deleting half the activations at test time, or BatchNorm normalizes by whatever happens to be in the evaluation batch. In the worked example, one row gets `(0.68, −3.86, 9.45)` in eval mode, `(−1.27, −0.99, −0.32)` in train mode, and `(0.78, −2.56, 2.56)` in train mode with other rows beside it ✅[^7]. A `BatchNorm1d` batch of one row in training mode is an error ✅[^7].

## Mental model
**Analogy:** grading on a curve. Batch norm grades each exam question against the students who sat it today: the same answer earns a different mark in a strong class than in a weak one. For the final report it uses the averages collected over the whole term instead (the running statistics), so every student is marked the same way. Layer norm grades each student against their own answers: no class needed. Dropout is a coach who sends a random half of the team home at each practice, so nobody can rely on one star; on match day the whole team plays, and practice scores were doubled so that the totals stay comparable.

**Artifact:** dropout's two modes on 10,000 ones; printed by the full script in the Worked example; lab run (`machine-learning/lab-setup.md`), 2026-11-24, PyTorch 2.15.0 ✅[^7]:

```text
== Dropout(p=0.5) on 10,000 ones ==
train: fraction zeroed 0.4942 | kept values [2.0] | mean 1.0116
eval: output equals input: True
```

About half the elements are zeroed, every survivor is `1/(1 − 0.5) = 2.0`, so the mean stays close to 1; in eval mode the layer returns its input unchanged.

## How it works
### Batch normalization (BN)
1. **Normalize per feature over the batch:** `y = (x − E[x]) / √(Var[x] + ε) · γ + β`, with mean and variance computed per feature over the mini-batch, and `γ`, `β` learnable vectors initialized to 1 and 0 ✅[^2]. In training mode the variance is the biased one (`correction=0`); the default `ε` is `1e-5` ✅[^2]. After the shift and scale the batch has mean 0 and variance 1, and `γ`, `β` give back the lost degrees of freedom ✅[^3].
2. **For convolutions:** one mean and variance per channel, over all `m·p·q` values of a batch of `m` images of `p × q` positions, and one scalar `γ`, `β` per channel ✅[^3].
3. **Running statistics:** in training mode the layer also updates `running = (1 − momentum)·running + momentum·batch_value`, default `momentum = 0.1`; the stored variance is the unbiased one (`correction=1`) ✅[^2]. This `momentum` is not an optimizer's momentum ✅[^2]. Example from the lab: a fresh layer (`running_mean = 0`, `running_var = 1`) sees a batch with mean `1.9517` and unbiased variance `0.8275` in feature 1, and stores `0.1952` and `0.9 + 0.08275 = 0.9827` ✅[^7].
4. **Eval mode:** normalization uses the running estimates instead of the batch ✅[^2]. Ioffe and Szegedy's reason: at inference the output should depend only on the input, deterministically, so the layer uses population statistics and becomes one fixed linear transform per activation ✅[^4]. With `track_running_stats=False` there are no running estimates and batch statistics are used in both modes ✅[^2].
5. **Where it goes:** the original paper put BN after the affine transform and before the nonlinearity, `h = φ(BN(W·x + b))` ✅[^3].
6. **What it buys:** its paper reports much higher usable learning rates, less care about initialization, a regularizing effect that in some cases removes the need for dropout, and the same accuracy in 14 times fewer training steps on an image model ✅[^4]. The 14 times is for a version that also raised the learning rate 5 times, removed dropout and made other training changes; adding BN alone reached the original model's (Inception's) 72.2 % accuracy in less than half the steps ✅[^4]. The paper's explanation, reducing "internal covariate shift", is disputed (see Edge cases) ✅[^3].

### Layer normalization (LN)
1. **Normalize per example over its features:** the same formula, with mean and biased variance taken over the last `D` dimensions given by `normalized_shape` ✅[^5]; all hidden units of a layer share one mean and variance, and each training case has its own ✅[^6].
2. **Same in both modes:** LN computes exactly the same at training and test time ✅[^6]; PyTorch uses statistics from the input in both modes ✅[^5].
3. **No batch needed:** there is no constraint on the mini-batch size, so it works with a batch of one ✅[^6], and it applies to RNNs (recurrent neural networks) by computing the statistics separately at each time step ✅[^6].
4. **Per-element affine:** LN's `γ` and `β` have the shape of `normalized_shape`, one per element, whereas BN has one per channel ✅[^5]. Ignoring `ε`, the output does not change if the input is multiplied by a constant: `LN(α·x) ≈ LN(x)` ✅[^3]. That holds for `α > 0`; Dive into Deep Learning (d2l) states it for any `α ≠ 0`, but a negative `α` flips the sign of `x − E[x]` and not of the standard deviation, so the output flips sign too.

### Dropout
1. **Training:** each element is zeroed with probability `p`, independently on every forward call, and the outputs are multiplied by `1/(1 − p)` ✅[^8]; the expected value of each element is unchanged, `E[h'] = h` ✅[^9]. Example: `p = 0.2` keeps about 80 % of the elements and multiplies each survivor by `1/0.8 = 1.25`.
2. **Backward:** a dropped unit contributes nothing to the output, so its gradient also vanishes for that step, and the next layer cannot depend too much on any single unit ✅[^9].
3. **Evaluation:** the module computes the identity ✅[^8]. Srivastava et al. describe dropout as sampling from an exponential number of "thinned" networks during training and approximating their average at test time with one unthinned network that has smaller weights ✅[^10]. In their notation `p` is the probability of keeping a unit, the opposite of PyTorch's `p`: a unit kept with probability `p` has its outgoing weights multiplied by `p` at test time, and they note that scaling the kept activations by `1/p` during training instead, leaving the test-time weights alone, is equivalent once the learning rate and initialization are scaled to match ✅[^10]. PyTorch takes that second route and scales by `1/(1 − p)` during training (often called inverted dropout), which keeps the expectation unchanged ✅[^9] and is why eval mode can be the identity ✅[^8].
4. **Why it regularizes:** it prevents units from co-adapting too much, and gave major improvements over other regularization methods in its paper ✅[^10]. Its direct comparison with other regularizers used one network on MNIST (a handwritten-digit dataset): 1.62 % test error with L2, 1.35 % with max-norm alone, 1.25 % with dropout plus L2 and 1.05 % with dropout plus max-norm ✅[^10].

## Worked example
`BatchNorm1d(3)` and `LayerNorm(3)` on one batch of 8 rows × 3 features with very different scales (means 2, −3, 10; standard deviations 1, 5, 0.1), in both modes. The core calls:

```python
bn = nn.BatchNorm1d(3)        # momentum=0.1, running_mean=0, running_var=1
y = bn(x)                     # train mode: this batch's mean and biased variance
bn.eval(); bn(x)              # eval mode: running_mean and running_var
ln = nn.LayerNorm(3); z = ln(x)
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-24, PyTorch 2.15.0, two runs identical; the first 11 lines of the output (the last 3 are the Mental model artifact) ✅[^7]:

```text
== BatchNorm1d(3): statistics per feature, over the 8 rows of the batch ==
train output: mean per feature [-0.0, -0.0, 0.0]  std (biased) [1.0, 1.0, 0.9995]
batch mean       [1.9517, -2.9727, 10.0074]
running_mean     [0.1952, -0.2973, 1.0007] = 0.9*0 + 0.1*batch mean
running_var      [0.9827, 4.8105, 0.9012] = 0.9*1 + 0.1* [0.8275, 39.1051, 0.0116] (unbiased var)
eval output, row 0: [0.6849, -3.8593, 9.4535]  train output, row 0: [-1.2663, -0.9897, -0.3218]
train mode, row 0 with other batch-mates: [0.7761, -2.5625, 2.556]
train mode, batch of 1 -> Expected more than 1 value per channel when training, got input size torch.Size([1, 3])
== LayerNorm(3): statistics per row, over its 3 features ==
row 0 mean / std: -0.0 1.0
same output in eval mode: True | LN(100*x) == LN(x): True
```

<details><summary>Full script (prints the output above)</summary>

```python
# BatchNorm1d, LayerNorm and Dropout: what each computes in train() vs eval() mode (PyTorch, CPU).
import torch
from torch import nn
torch.manual_seed(0)
x = torch.randn(8, 3) * torch.tensor([1.0, 5.0, 0.1]) + torch.tensor([2.0, -3.0, 10.0])  # 8 rows, 3 features

print("== BatchNorm1d(3): statistics per feature, over the 8 rows of the batch ==")
bn = nn.BatchNorm1d(3)                                   # momentum=0.1, running_mean=0, running_var=1
y = bn(x)                                                # train mode: uses this batch's mean / biased var
print("train output: mean per feature", [round(v, 4) for v in y.mean(0).tolist()],
      " std (biased)", [round(v, 4) for v in y.std(0, correction=0).tolist()])
print("batch mean      ", [round(v, 4) for v in x.mean(0).tolist()])
print("running_mean    ", [round(v, 4) for v in bn.running_mean.tolist()], "= 0.9*0 + 0.1*batch mean")
print("running_var     ", [round(v, 4) for v in bn.running_var.tolist()],
      "= 0.9*1 + 0.1*", [round(v, 4) for v in x.var(0, correction=1).tolist()], "(unbiased var)")
bn.eval()
print("eval output, row 0:", [round(v, 4) for v in bn(x)[0].tolist()], " train output, row 0:",
      [round(v, 4) for v in y[0].tolist()])
bn.train()
other = torch.randn(7, 3)                                # same row 0, different batch-mates
print("train mode, row 0 with other batch-mates:", [round(v, 4) for v in bn(torch.cat([x[:1], other]))[0].tolist()])
try:
    bn(x[:1])
except ValueError as e:
    print("train mode, batch of 1 ->", e)

print("== LayerNorm(3): statistics per row, over its 3 features ==")
ln = nn.LayerNorm(3)
z = ln(x)
print("row 0 mean / std:", round(z[0].mean().item(), 4), round(z[0].std(correction=0).item(), 4))
ln.eval(); print("same output in eval mode:", torch.equal(ln(x), z), "| LN(100*x) == LN(x):",
                 torch.allclose(ln(100 * x), z, atol=1e-5))

print("== Dropout(p=0.5) on 10,000 ones ==")
drop, ones = nn.Dropout(p=0.5), torch.ones(10_000)
d = drop(ones)
print("train: fraction zeroed", round((d == 0).float().mean().item(), 4), "| kept values", d[d != 0].unique().tolist(),
      "| mean", round(d.mean().item(), 4))
drop.eval(); print("eval: output equals input:", torch.equal(drop(ones), ones))
```

</details>

Reading it, line by line:
- **Train output:** every feature has mean 0 and standard deviation (std) 1 over the batch, whatever its original scale. Feature 3 shows `0.9995` because its variance (`0.0116 × 7/8 ≈ 0.0102`, biased) is small enough for `ε = 1e-5` to matter: `√(0.0102/(0.0102 + 0.00001)) ≈ 0.9995`.
- **Running statistics:** after one training batch they have moved only 10 % of the way from `(0, 1)` towards the batch values, exactly the update rule in step 3 above.
- **Eval vs train for row 0:** eval mode normalizes with those lagging running statistics and gives `(0.68, −3.86, 9.45)`, far from the train-mode `(−1.27, −0.99, −0.32)`. This is the extreme case of evaluating a model whose running statistics have not settled.
- **Other batch-mates:** the same row 0, batched with 7 different rows in train mode, becomes `(0.78, −2.56, 2.56)`: in training, BN's output for one example depends on the others.
- **Batch of 1:** PyTorch refuses (`Expected more than 1 value per channel when training`); with one value per feature, subtracting the mean would make every unit 0 ✅[^3].
- **LayerNorm:** each row has mean 0 and standard deviation 1 over its own 3 features, the output is identical in eval mode, and multiplying the input by 100 changes nothing.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Validation without `model.eval()` | Dropout keeps dropping; BN normalizes by the validation batch and updates its running statistics with validation data | Modes are switched by hand ✅[^1] |
| Evaluating early, or after changing the data | Eval outputs far from train outputs (lab row 0) | Running statistics move 10 % per batch by default ✅[^2]; lab ✅[^7] |
| Batch of 1 in train mode with one value per channel (`BatchNorm1d` on `(1, C)`) | `ValueError` in PyTorch | Nothing to normalize ✅[^3]; lab ✅[^7]. One image in a convolutional BN still gives `p·q` values per channel, so the statistics are defined there ✅[^3] |
| Small batches | Noisy statistics; BN worked best for mini-batches of about 50–100 in d2l's discussion | Larger batches regularize less, tiny ones destroy signal ✅[^3] |
| Feature with tiny variance | Output std below 1 (0.9995 in the lab) | `ε = 1e-5` added to the variance ✅[^2]; lab ✅[^7] |
| BN in an RNN | Statistics would depend on the sequence length | LN computes them per time step ✅[^6] |
| `momentum=None` in BatchNorm | Cumulative (simple) average instead of exponential | Documented option ✅[^2] |
| Dropout at test time on purpose | Several stochastic predictions; agreement read as confidence | A heuristic some researchers use ✅[^9] |
| Dropout `p = 1` | Every element is 0 | d2l's own example output ✅[^9] |
| "BN works by reducing internal covariate shift" | Disputed | Its paper proposed it ✅[^4]; d2l calls the explanation under-specified and the name a misnomer, cites Santurkar et al. for an opposite finding, and conjectures that regularization through noise, acceleration through rescaling and preprocessing are the guiding principles ✅[^3] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Batch norm | Higher learning rates, less init care, some regularization ✅[^4] | Depends on batch size and mode; different train and eval behaviour ✅[^3] |
| Layer norm | Same in train and eval; any batch size; fits RNNs ✅[^6] | Deterministic, so it lacks the batch-statistics noise behind BN's regularizing effect ✅[^3] |
| Dropout | Major improvements over other regularizers in its paper ✅[^10]; no change at test ✅[^8] | Another hyperparameter `p`; must be switched off with `eval()` ✅[^1] |
| BN instead of dropout | Regularizes as a side effect ✅[^4] | Only "in some cases" removes the need for dropout ✅[^4] |

## Takeaways
- Call `model.train()` before training steps and `model.eval()` before every validation or inference pass, together with `torch.no_grad()` or inference mode; they do different jobs. [rule-candidate]
- If eval-mode metrics are much worse than train-mode metrics on the same data, inspect BatchNorm's `running_mean` and `running_var` before anything else.
- Use layer norm when batches are small, variable-length or of size 1; batch norm when batches are large and examples are independent.
- Dropout in PyTorch is inverted: its training outputs are already scaled by `1/(1 − p)`, so never rescale at test time.

## Verification status
- Verified: 62 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [Autograd mechanics: Evaluation Mode](https://docs.pytorch.org/docs/2.15/notes/autograd.html) — PyTorch, 2026 (2.15). Backs: `train()`/`eval()` are the user's responsibility, running statistics and validation data. [^1]
- [torch.nn.BatchNorm1d](https://docs.pytorch.org/docs/2.15/generated/torch.nn.BatchNorm1d.html) — PyTorch, 2026 (2.15). Backs: formula, `γ`/`β` init, biased vs unbiased variance, running statistics and `momentum`, eval-mode use, `track_running_stats`, `momentum=None`, `eps`. [^2]
- [Batch Normalization (Dive into Deep Learning, 8.5)](https://d2l.ai/chapter_convolutional-modern/batch-norm.html) — Zhang, Lipton, Li, Smola, living. Backs: mean 0 / variance 1 and recovered degrees of freedom, per-channel BN for convolutions, placement, batch of 1, 50–100 batch sizes, LN scale invariance, the internal-covariate-shift dispute. [^3]
- [Batch Normalization: Accelerating Deep Network Training by Reducing Internal Covariate Shift](https://arxiv.org/html/1502.03167v3) — Ioffe, Szegedy, 2015 (v3; full text read on ar5iv). Backs: internal covariate shift, higher learning rates, less init care, regularizer, 14 times fewer steps and the changes behind it (§4.2), population statistics at inference. [^4]
- [torch.nn.LayerNorm](https://docs.pytorch.org/docs/2.15/generated/torch.nn.LayerNorm.html) — PyTorch, 2026 (2.15). Backs: statistics over the last `D` dimensions, biased variance, per-element affine, same statistics in both modes. [^5]
- [Layer Normalization](https://arxiv.org/html/1607.06450v1) — Ba, Kiros, Hinton, 2016 (full text read on ar5iv). Backs: per-case statistics shared across a layer's units, same computation at train and test, no batch-size constraint, per-time-step use in RNNs. [^6]
- `machine-learning/lab-setup.md` — the lab where the BatchNorm1d, LayerNorm and Dropout train/eval comparison ran on 2026-11-24. [^7]
- [torch.nn.Dropout](https://docs.pytorch.org/docs/2.15/generated/torch.nn.Dropout.html) — PyTorch, 2026 (2.15). Backs: Bernoulli zeroing per call, `1/(1 − p)` scaling, identity in eval. [^8]
- [Dropout (Dive into Deep Learning, 5.6)](https://d2l.ai/chapter_multilayer-perceptrons/dropout.html) — Zhang, Lipton, Li, Smola, living. Backs: unchanged expectation, gradients of dropped units vanish, test-time dropout for uncertainty, `p = 1` example. [^9]
- [Dropout: A Simple Way to Prevent Neural Networks from Overfitting](https://jmlr.org/papers/v15/srivastava14a.html) — Srivastava, Hinton, Krizhevsky, Sutskever, Salakhutdinov, 2014 (full text read, PDF). Backs: thinned networks, test-time unthinned network with smaller weights, `p` as the keep probability and the equivalent `1/p` training-time scaling (§1, §4, §10), co-adaptation, improvements over other regularizers and the MNIST comparison (§6.5, Table 9). [^10]

## Related
- `machine-learning/foundations/regularization.md` — L2, L1 and early stopping, the other regularizers.
- `machine-learning/deep-learning/activations-and-initialization.md` — keeping activations in range from the start.
- `machine-learning/deep-learning/convolutional-networks.md` — the residual block, where BN sits after each convolution.
- `machine-learning/deep-learning/recurrent-networks.md` — why per-time-step normalization matters for RNNs.
- `machine-learning/transformers/attention-and-the-transformer.md` — residual + LayerNorm and pre-LN in the transformer block.
- `machine-learning/deep-learning/neural-networks-and-backpropagation.md` — `eval()` vs `no_grad()`: modes vs gradient recording.
