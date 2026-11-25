---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/privacy-preserving-ml
status: verified
applies-to: ["PyTorch 2.15.0"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, privacy, differential-privacy, dp-sgd, gradient-clipping, per-example-gradients, torch-func, vmap, privacy-accounting, renyi-differential-privacy, moments-accountant, opacus]
---

# Differentially private training: DP-SGD and privacy accounting

## Summary
**TL;DR:** DP-SGD (differentially private stochastic gradient descent) makes training satisfy differential privacy (DP) by changing one step of SGD: compute each example's gradient separately, clip each to L2 norm (Euclidean length) at most `C`, sum them, add Gaussian noise of standard deviation `σC`, and divide by the expected lot size. Clipping bounds what one example can contribute; the noise hides it; sampling each example with probability `q` per step makes each step cheaper in privacy. An accountant (the moments accountant, or Rényi DP for the sampled Gaussian mechanism) adds up the cost over thousands of steps and reports one `(ε, δ)` at the end. The price is accuracy: in the lab, test accuracy fell from 0.969 to 0.942 at `ε = 8.1` and to 0.729 at `ε = 1.25`.
**Use this when:** you train or fine-tune a model on personal data and must state a privacy guarantee, choose a noise multiplier, clipping norm, batch size or number of epochs for a target `ε`, read what a DP library's `get_epsilon` means, or implement per-example gradients in PyTorch.
**Not this doc:** the definitions of `ε`, `δ`, sensitivity, the Gaussian mechanism and composition → `machine-learning/privacy-preserving-ml/differential-privacy.md`; what an attacker can still learn from a trained model → `machine-learning/privacy-preserving-ml/membership-inference-and-memorization.md`; plain SGD → `machine-learning/foundations/gradient-descent.md`.

## Problem
A trained model can encode facts about single training examples, such as one patient's diagnosis, not only general patterns, and publishing the model can reveal them ✅[^4]. Good test accuracy does not prevent this: generalization is an average over the data, while privacy must hold for every person, outliers included ✅[^4]. Ordinary SGD gives no bound on any one example's influence: a mini-batch gradient is an average, and one example's gradient has no a-priori size limit ✅[^1]. Making SGD private therefore needs per-example gradients, which stock PyTorch cannot compute efficiently ✅[^7], plus a way to count the privacy cost of thousands of noisy steps without the bound exploding.

## Mental model
**Analogy:** a committee decides each step by summing members' votes. To protect members, each vote is capped in strength (clipping), a fixed amount of random murmur is added to the total (noise), and each member attends a given meeting only with probability `q` (sampling), so an observer of one meeting usually cannot tell whether a member was even present. An auditor (the accountant) keeps a running tally of how much the minutes could reveal about any one member, meeting after meeting, and signs off on one total at the end.

**Artifact:** per-example gradient norms of a small network on the digits data, and what DP-SGD's noise does to accuracy, printed by the full script in the Worked example; lab run (`machine-learning/lab-setup.md`), 2026-11-25, PyTorch 2.15.0 ✅[^14]:

```text
 setting                     steps  train acc  test acc  epsilon
 non-private SGD               420   1.000     0.969     inf
…
 DP-SGD sigma 1.0              420   0.970     0.942     8.11
 DP-SGD sigma 2.0              420   0.921     0.887     2.79
 DP-SGD sigma 4.0              420   0.786     0.729     1.25
…
after non-private training: norm quantiles (min, median, 90%, max) before [0.001, 0.034, 0.639, 6.811] after [0.001, 0.034, 0.639, 1.0] clipped 6.9%
```

After ordinary training, the median example's gradient has norm 0.034 and only 6.9 % exceed `C = 1`, but the largest is 6.8: clipping caps exactly the examples that would dominate a step.

## How it works
### One DP-SGD step (Abadi et al., Algorithm 1)
1. **Sample a lot.** Each of the `N` examples joins this step's group, called a lot, independently with probability `q = L/N`, where `L` is the expected lot size ✅[^1]. Example: `L = 64`, `N = 1,347` gives `q = 0.0475`. A lot is the unit at which noise is added; it can be processed in smaller batches to save memory ✅[^1].
2. **Per-example gradients** `g_i = ∇θ L(θ, x_i)` for every example in the lot ✅[^1].
3. **Clip** each to L2 norm at most `C`: `ḡ_i = g_i / max(1, ‖g_i‖₂ / C)`; a gradient of norm 4 at `C = 1` is scaled by 1/4, one of norm 0.5 is kept ✅[^1]. Adding or removing one example now changes the sum by a vector of length at most `C`, so the sum's L2 sensitivity is `C` ✅[^12]. Gradient clipping used for non-privacy reasons usually clips after averaging ✅[^1]; that caps the size of the step, not any one example's share of it.
4. **Add noise and average:** `g̃ = (Σ ḡ_i + N(0, σ²C²I)) / L` ✅[^1]. `σ` is the noise multiplier, the ratio of the noise standard deviation to the L2 sensitivity ✅[^6]. Example: `σ = 1`, `C = 1`, `L = 64` adds noise of standard deviation `1/64 = 0.016` to every coordinate of the averaged gradient.
5. **Descend:** `θ ← θ − η g̃` ✅[^1].
6. **Account:** after training, compute the overall `(ε, δ)` from `q`, `σ` and the number of steps `T` ✅[^1].

Clipping and noise can be set per layer and can vary with the step ✅[^1]; Opacus offers flat (one norm over all parameters), per-layer and adaptive clipping, and calls flat clipping usually preferred ✅[^6].

### Per-example gradients with `torch.func`
`torch.func` provides composable function transforms: `grad(f)` returns a function computing the gradient of `f`, `vmap(f)` returns a function computing `f` over a batch, and `vmap(grad(f))` computes per-sample gradients, which stock PyTorch cannot compute efficiently ✅[^7]. The recipe:
1. Write the loss of **one** example as a pure function of the parameters: `functional_call(model, params, (x,))` runs the module with the given parameter tensors in place of its own ✅[^10].
2. `grad(loss_one)` differentiates with respect to the first argument by default, here the parameter dictionary ✅[^9].
3. `vmap(..., in_dims=(None, 0, 0))` maps over dimension 0 of the inputs and targets while sharing the parameters (`None` means not batched) ✅[^8] ✅[^11]. The tutorial checks the result against a loop of per-example backward passes ✅[^11]; in the lab the two agree to `3.58e-07` ✅[^14].

The transformed function should be pure (outputs depend only on inputs, no side effects) ✅[^11]. Memory grows with the lot: per-sample gradients keep one gradient copy per example, which is why Opacus separates physical batches from logical (noise-adding) steps ✅[^5].

### Privacy accounting
1. **Why ordinary composition is too loose.** Each step touches the data, and `T` is in the thousands. Sampling helps: a step that is `(ε, δ)`-DP on its lot is `(O(qε), qδ)`-DP on the whole dataset (privacy amplification by sampling), but composing `T` such steps with the strong composition theorem is still loose ✅[^1].
2. **Moments accountant.** Abadi et al. track the moments of the privacy loss instead and prove DP-SGD is `(O(qε√T), δ)`-DP for suitable `σ` ✅[^1]. Their example: `q = 0.01`, `σ = 4`, `δ = 10⁻⁵`, `T = 10,000` (100 epochs) gives `ε ≈ 1.26` with the moments accountant against `ε ≈ 9.34` with strong composition ✅[^1].
3. **Rényi DP (RDP) of the sampled Gaussian mechanism (SGM).** The SGM adds `N(0, σ²I)` to a function of a Poisson subsample, each element kept with probability `q` ✅[^3]. For sensitivity 1 and an integer order `α`, its Rényi DP is `ε_α = ln(A_α)/(α − 1)` with `A_α = Σ_{k=0..α} C(α,k) · (1−q)^(α−k) · q^k · exp((k² − k)/(2σ²))`, where `C(α,k)` is the binomial coefficient "α choose k" (not the clipping norm) ✅[^3]. Example: `α = 2`, `q = 0.0475`, `σ = 1`: `A₂ = 0.9072 + 0.0905 + 0.00226·e¹ = 1.0039`, so one step costs `ε₂ = 0.0039`.
4. **Compose and convert.** RDP at a fixed `α` adds over the `T` steps, and `(α, ε)`-RDP implies `(ε + ln(1/δ)/(α − 1), δ)`-DP, so `ε = min over α of (T·ε_α + ln(1/δ)/(α − 1))` ✅[^2]. The lab's 15-line accountant reproduces Abadi's example: `ε = 1.259` at the best order `α = 20` ✅[^14] ✅[^1].
5. **In libraries.** Opacus tracks RDP over a list of orders `alphas`, suggests orders from 1.1 to 63, and advises widening the list if the best order is at its edge ✅[^5]; its `PrivacyEngine` defaults to the accountant named `prv` (`PRVAccountant`) and also offers `rdp` (`RDPAccountant`) and `gdp` (`GaussianAccountant`) ✅[^6]. `make_private_with_epsilon` works backwards: given `target_epsilon`, `target_delta` and `epochs`, it picks the noise multiplier ✅[^6].
6. **Reading the result.** `ε` and `δ` are computed after the run; for each `δ` there is an `ε` ✅[^5]. Opacus's rule of thumb is `δ` below `1/N` (here `1/1,347 = 7.4·10⁻⁴`, the lab uses `10⁻⁵`) ✅[^5]. The guarantee covers the released model and everything done with it later (inference, fine-tuning, distillation), and it is a conservative upper bound: the loss observed in attacks can be much smaller ✅[^5].

### What it costs
- **Accuracy.** On MNIST (handwritten digits), Abadi et al. reach 90 %, 95 % and 97 % test accuracy at `ε = 0.5`, 2 and 8 (`δ = 10⁻⁵`), with a small train–test gap ✅[^1]. Rare groups suffer most: DP limits learning patterns few examples share ✅[^4].
- **Steps.** For a fixed guarantee the noise needed grows with the number of training steps, so the step count is a privacy hyperparameter ✅[^4]; a larger batch raises the sampling rate and so the budget spent ✅[^5].
- **Tuning.** Opacus suggests a noise multiplier typically between 0.1 and 2, a smaller learning rate than non-private training, and care with `max_grad_norm`, which can badly hurt linear models if set wrong ✅[^5]. Choosing hyperparameters by repeated runs on the private data must itself be accounted ✅[^4]. Architectures that are best without privacy are not always best with it, and the parameter count matters ✅[^4].
- **Compute.** Per-example gradients are harder to accelerate than averaged ones ✅[^4].
- **An alternative.** PATE (private aggregation of teacher ensembles) trains non-private teachers on disjoint data and releases only the label with the largest noisy vote count ✅[^4].

## Worked example
Digits (`load_digits`, 1,347 training and 450 test images of 8×8 pixels, 10 classes), a 64-32-10 network with tanh, SGD with learning rate 0.5, expected lot 64 (`q = 0.0475`), 20 epochs (420 steps), `C = 1`, `δ = 10⁻⁵`. The core step:

```python
idx = torch.nonzero(torch.rand(N) < q).squeeze(1)              # Poisson lot
g = clip(per_example_grads(p, Xtr[idx], ytr[idx]), C)           # vmap(grad(loss_one)), then clip
p[k] = p[k] - lr * (g[k].sum(0) + sigma * C * torch.randn_like(p[k])) / lot
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-25, PyTorch 2.15.0, scikit-learn 1.9.1, one CPU (central processing unit) thread, two runs identical ✅[^14]:

```text
accountant check, q=0.01 sigma=4 T=10000 delta=1e-5: epsilon = 1.259 (order 20)
per-example grads: shapes [(32, 32, 64), (32, 32), (32, 10, 32), (32, 10)]; max |vmap - loop| = 3.58e-07
at initialization: norm quantiles (min, median, 90%, max) before [2.801, 3.931, 5.064, 10.508] after [1.0, 1.0, 1.0, 1.0] clipped 100.0%

DP-SGD on digits (1347 train / 450 test), C = 1, expected lot 64, 20 epochs, delta = 1e-5
 setting                     steps  train acc  test acc  epsilon
 non-private SGD               420   1.000     0.969     inf
 clip only (sigma 0)           420   0.979     0.956     inf
 DP-SGD sigma 0.5              420   0.978     0.951     59.48
 DP-SGD sigma 1.0              420   0.970     0.942     8.11
 DP-SGD sigma 2.0              420   0.921     0.887     2.79
 DP-SGD sigma 4.0              420   0.786     0.729     1.25
 sampling rate q = 0.0475
after non-private training: norm quantiles (min, median, 90%, max) before [0.001, 0.034, 0.639, 6.811] after [0.001, 0.034, 0.639, 1.0] clipped 6.9%
 sigma 1.0,  5 epochs: epsilon 4.59 (order 5)
 sigma 1.0, 20 epochs: epsilon 8.11 (order 4)
 sigma 1.0, 80 epochs: epsilon 16.73 (order 3)
```

<details><summary>Full script (prints the output above)</summary>

```python
# DP-SGD by hand in PyTorch: per-example gradients with torch.func (vmap + grad), per-example clipping,
# Gaussian noise, Poisson-sampled lots, and an RDP accountant for the sampled Gaussian mechanism
# (integer orders, Mironov-Talwar-Zhang 2019, Section 3.3), on scikit-learn's bundled digits data.
import math
import torch
from torch import nn
from torch.func import functional_call, grad, vmap
from sklearn.datasets import load_digits
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
torch.manual_seed(0); torch.set_num_threads(1)

# ---- privacy accountant: RDP of the sampled Gaussian mechanism, integer orders ----
def log_A(q, sigma, alpha):                # ln sum_k C(alpha,k) (1-q)^(alpha-k) q^k exp((k^2-k)/(2 sigma^2))
    terms = [math.lgamma(alpha + 1) - math.lgamma(k + 1) - math.lgamma(alpha - k + 1)
             + (alpha - k) * math.log1p(-q) + k * math.log(q) + (k * k - k) / (2 * sigma**2)
             for k in range(alpha + 1)]
    m = max(terms)
    return m + math.log(sum(math.exp(t - m) for t in terms))
def epsilon(q, sigma, steps, delta, orders=range(2, 257)):
    if sigma == 0:
        return float("inf"), None
    best = min((steps * log_A(q, sigma, a) / (a - 1) + math.log(1 / delta) / (a - 1), a) for a in orders)
    return best                            # (epsilon, best order alpha)
e, a = epsilon(0.01, 4.0, 10_000, 1e-5)
print(f"accountant check, q=0.01 sigma=4 T=10000 delta=1e-5: epsilon = {e:.3f} (order {a})")

# ---- data and model ----
X, y = load_digits(return_X_y=True)
Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.25, random_state=0, stratify=y)
sc = StandardScaler().fit(Xtr)
Xtr, Xte = (torch.tensor(sc.transform(a), dtype=torch.float32) for a in (Xtr, Xte))
ytr, yte = torch.tensor(ytr), torch.tensor(yte)
N = len(Xtr)
def make_model():
    return nn.Sequential(nn.Linear(64, 32), nn.Tanh(), nn.Linear(32, 10))
model = make_model()
params = {k: v.detach() for k, v in model.named_parameters()}

def loss_one(p, x, t):                     # loss of ONE example: add a batch dimension of 1
    out = functional_call(model, p, (x.unsqueeze(0),))
    return nn.functional.cross_entropy(out, t.unsqueeze(0))
per_example_grads = vmap(grad(loss_one), in_dims=(None, 0, 0))

# ---- 1. vmap(grad) equals a loop of single-example backward passes ----
xb, tb = Xtr[:32], ytr[:32]
g_vmap = per_example_grads(params, xb, tb)
max_diff = 0.0
for i in range(32):
    model.zero_grad()
    nn.functional.cross_entropy(model(xb[i:i+1]), tb[i:i+1]).backward()
    for k, p in model.named_parameters():
        max_diff = max(max_diff, (p.grad - g_vmap[k][i]).abs().max().item())
print(f"per-example grads: shapes {[tuple(v.shape) for v in g_vmap.values()]}; max |vmap - loop| = {max_diff:.2e}")

# ---- 2. per-example gradient norms before and after clipping at C = 1 ----
def flat_norms(g):
    return torch.sqrt(sum((v.reshape(v.shape[0], -1) ** 2).sum(1) for v in g.values()))
def clip(g, C):
    factor = torch.clamp(C / (flat_norms(g) + 1e-12), max=1.0)   # g / max(1, ||g|| / C)
    return {k: v * factor.view(-1, *[1] * (v.dim() - 1)) for k, v in g.items()}
qs = torch.tensor([0.0, 0.5, 0.9, 1.0])
def show_norms(name, p):
    g_all = per_example_grads(p, Xtr, ytr)
    n0, n1 = flat_norms(g_all), flat_norms(clip(g_all, 1.0))
    print(f"{name}: norm quantiles (min, median, 90%, max) before", [round(v, 3) for v in torch.quantile(n0, qs).tolist()],
          "after", [round(v, 3) for v in torch.quantile(n1, qs).tolist()], f"clipped {(n0 > 1).float().mean():.1%}")
show_norms("at initialization", params)

# ---- 3. DP-SGD: Poisson lots, clip, sum, add N(0, sigma^2 C^2), divide by expected lot size ----
def train(sigma, C=1.0, lot=64, epochs=20, lr=0.5, private=True, seed=1):
    torch.manual_seed(seed)
    m = make_model()
    p = {k: v.detach().clone() for k, v in m.named_parameters()}
    q = lot / N
    steps = int(epochs / q)
    for _ in range(steps):
        idx = torch.nonzero(torch.rand(N) < q).squeeze(1)       # each example joins with probability q
        if private:
            g = clip(per_example_grads(p, Xtr[idx], ytr[idx]), C) if len(idx) else None
            for k in p:
                s = g[k].sum(0) if g is not None else torch.zeros_like(p[k])
                p[k] = p[k] - lr * (s + sigma * C * torch.randn_like(p[k])) / lot
        else:
            g = per_example_grads(p, Xtr[idx], ytr[idx])
            for k in p:
                p[k] = p[k] - lr * g[k].mean(0)
    acc = lambda Xs, ys: (functional_call(m, p, (Xs,)).argmax(1) == ys).float().mean().item()
    eps, _ = epsilon(q, sigma, steps, 1e-5) if private else (float("inf"), None)
    return acc(Xtr, ytr), acc(Xte, yte), eps, steps, q, p

print("\nDP-SGD on digits (1347 train / 450 test), C = 1, expected lot 64, 20 epochs, delta = 1e-5")
print(" setting                     steps  train acc  test acc  epsilon")
tr, te, eps, steps, q, p_np = train(0.0, private=False)
print(f" non-private SGD             {steps:5d}   {tr:.3f}     {te:.3f}     {eps}")
for sigma in [0.0, 0.5, 1.0, 2.0, 4.0]:
    tr, te, eps, steps, q, _ = train(sigma)
    label = "clip only (sigma 0)" if sigma == 0 else f"DP-SGD sigma {sigma}"
    print(f" {label:<27} {steps:5d}   {tr:.3f}     {te:.3f}     {eps:.2f}" if eps != float("inf") else
          f" {label:<27} {steps:5d}   {tr:.3f}     {te:.3f}     inf")
print(f" sampling rate q = {q:.4f}")
show_norms("after non-private training", p_np)
for epochs in [5, 20, 80]:
    e, a = epsilon(64 / N, 1.0, int(epochs * N / 64), 1e-5)
    print(f" sigma 1.0, {epochs:2d} epochs: epsilon {e:.2f} (order {a})")
```

</details>

Reading it, line by line:
- **Accountant check:** `1.259` against Abadi et al.'s published `1.26` for the same `q`, `σ`, `T` and `δ` ✅[^1], so the accountant implements the RDP bound correctly enough to trust the rest.
- **vmap vs loop:** the two disagree only at float32 rounding (`3.58e-07`), for gradient tensors of shapes 32×64, 32, 10×32 and 10 per example.
- **Norms:** at initialization every example's gradient exceeds `C = 1` (norms 2.8 to 10.5), so early DP-SGD steps are fully clipped; after non-private training only 6.9 % exceed it.
- **Clipping alone** costs 1.3 points of test accuracy (0.969 → 0.956) and gives no guarantee (`ε = ∞`): without noise, clipping bounds sensitivity but hides nothing.
- **Noise:** `σ = 0.5` gives `ε = 59`, a number too large to mean much ✅[^13]; `σ = 1` gives `ε = 8.1` for 2.7 points; `σ = 4` gives `ε = 1.25` for 24 points (0.729). Train and test accuracy stay close in every private row.
- **Epochs:** at fixed `σ = 1`, training 5, 20 or 80 epochs costs `ε` = 4.6, 8.1 and 16.7: the budget grows sublinearly with steps, but it grows.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Batch normalization in the model | Rejected by Opacus (`IncompatibleModuleException`); its FAQ suggests `ModuleValidator.fix(model)` ✅[^5] | Batch norm computes its mean and standard deviation over the mini-batch ✅[^15], so one example's output and gradient depend on the others; Opacus names it the most prominent incompatible module ✅[^5] |
| Shuffle-and-partition batches instead of Poisson sampling | Common in practice; the accountant's assumption no longer holds exactly | Analysis assumes Poisson sampling ✅[^1] ✅[^4]; Opacus calls `poisson_sampling=False` an approximation ✅[^6] |
| A Poisson lot comes out empty | Possible at small `q`; the lab script still adds the noise and counts the step ✅[^14] | Opacus has a `rand_on_empty` option for empty Poisson batches ✅[^6] |
| Clipping norm `C` far below typical norms | Every gradient is scaled to `C`; the step is a noisy average of directions | Lab: 100 % clipped at initialization ✅[^14]; badly set `max_grad_norm` hurts linear models most ✅[^5] |
| `ε` in the tens | Guarantee nearly empty though accuracy looks fine | Lab `ε = 59` at `σ = 0.5` ✅[^14]; above 10 probably protects little ✅[^13] |
| One user contributes many examples | Example-level `ε` does not cover the user | Neighbours differ in one example (one image–label pair) ✅[^1] |
| Hyperparameters tuned by many private runs | Extra privacy cost not in the reported `ε` | Tuning must itself preserve DP ✅[^4] |
| Best RDP order at the edge of the `alphas` list | `ε` is looser than necessary | Widen the list ✅[^5] |
| Pseudo-random noise from `torch.randn` | Fine for experiments, not for a cryptographic guarantee | Opacus `secure_mode` uses a secure generator and blocks some floating-point attacks ✅[^6] |
| Lipschitz loss (such as logistic regression's) with bounded inputs | Clip the inputs once instead of every gradient | A Lipschitz loss bounds the gradient by the input norm ✅[^12] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Larger noise multiplier `σ` | Smaller `ε` ✅[^14] | Lower accuracy: 0.942 → 0.729 from `σ = 1` to 4 in the lab ✅[^14] |
| More epochs | More optimization steps ✅[^12] | `ε` grows: 4.6 → 16.7 from 5 to 80 epochs ✅[^14]; at a fixed `ε`, more iterations mean more noise per step and can make the model worse ✅[^12] |
| Larger lot `L` | Less noise per averaged gradient (`σC/L` per coordinate) ✅[^1] | Higher sampling rate, more budget per step ✅[^5]; more memory ✅[^5] |
| By-hand DP-SGD (`torch.func`) | Every step visible and testable; the lab checks vmap against a loop ✅[^14] | You own the sampling, accounting and random-number-generator choices ✅[^6] |
| Opacus `PrivacyEngine` | Poisson sampling, clipping modes, accountants, target-`ε` mode built in ✅[^6] | Module restrictions (batch norm) ✅[^5] |
| PATE instead of DP-SGD | Model-agnostic; small privacy cost when teachers agree ✅[^4] | Trains many teacher models instead of one ✅[^4] |

## Takeaways
- Report `ε`, `δ`, the unit of privacy, `q`, `σ`, `C` and the number of steps together; `ε` alone is not reproducible. [rule-candidate]
- Clip per example, never after averaging, and add noise to the sum; check per-example gradients against a loop once. [rule-candidate]
- Fix the privacy budget first, then search `σ`, epochs and lot size inside it, counting the tuning runs.
- Test an accountant against a published number (Abadi et al.: `ε ≈ 1.26` for `q = 0.01`, `σ = 4`, `T = 10,000`, `δ = 10⁻⁵`) before trusting it.

## Verification status
- Verified: 83 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [Deep Learning with Differential Privacy](https://arxiv.org/html/1607.00133v2) — Abadi, Chu, Goodfellow, McMahan, Mironov, Talwar, Zhang, 2016 (arXiv HTML). Backs: Algorithm 1, per-example clipping, lots and Poisson sampling, per-layer parameters, amplification, the moments accountant and the 1.26 vs 9.34 example, MNIST results, adjacency by one example. [^1]
- [Rényi Differential Privacy](https://ar5iv.labs.arxiv.org/html/1702.07476) — Mironov, 2017 (ar5iv HTML of arXiv:1702.07476). Backs: RDP composition and the conversion to (ε, δ). [^2]
- [Rényi Differential Privacy of the Sampled Gaussian Mechanism](https://ar5iv.labs.arxiv.org/html/1908.10530) — Mironov, Talwar, Zhang, 2019 (ar5iv HTML of arXiv:1908.10530). Backs: the SGM definition and the integer-order formula for its RDP. [^3]
- [How to deploy machine learning with differential privacy](https://www.nist.gov/blogs/cybersecurity-insights/how-deploy-machine-learning-differential-privacy) — Papernot, Thakurta, NIST (National Institute of Standards and Technology), 2021. Backs: memorization risk, generalization is not privacy, DP-SGD steps, sampling in practice, noise vs steps, accuracy on heavy tails, compute, tuning, architecture, PATE releases the top noisy vote. [^4]
- [Opacus FAQ](https://opacus.ai/docs/faq) — Opacus, living. Backs: noise multiplier range, learning rate and clipping advice, batch norm, memory and virtual batches, meaning of ε and δ, δ < 1/N, conservative bound, batch size and budget, alphas. [^5]
- [Privacy Engine (Opacus API)](https://opacus.ai/api/privacy_engine.html) — Opacus, living. Backs: noise_multiplier definition, Poisson sampling default, clipping modes, accountants (prv default, rdp, gdp), make_private_with_epsilon, rand_on_empty, secure_mode. [^6]
- [torch.func](https://docs.pytorch.org/docs/2.15/func.html) — PyTorch, 2026 (2.15). Backs: function transforms, vmap(grad(f)) per-sample gradients that stock PyTorch cannot compute efficiently. [^7]
- [torch.func.vmap](https://docs.pytorch.org/docs/2.15/generated/torch.func.vmap.html) — PyTorch, 2026 (2.15). Backs: vectorizing map over a dimension, in_dims with None. [^8]
- [torch.func.grad](https://docs.pytorch.org/docs/2.15/generated/torch.func.grad.html) — PyTorch, 2026 (2.15). Backs: gradient with respect to argnums, default 0. [^9]
- [torch.func.functional_call](https://docs.pytorch.org/docs/2.15/generated/torch.func.functional_call.html) — PyTorch, 2026 (2.15). Backs: calling a module with replacement parameters. [^10]
- [Per-sample-gradients (PyTorch tutorial)](https://docs.pytorch.org/tutorials/intermediate/per_sample_grads.html) — PyTorch, 2025. Backs: use in differential privacy, the functional_call + grad + vmap recipe, in_dims, check against a loop, pure functions. [^11]
- [Machine Learning (Programming Differential Privacy, chapter 12)](https://programming-dp.com/chapter12/) — Near, Abuah, living. Backs: clipping bounds L2 sensitivity by the clip norm, clipping inputs for Lipschitz losses. [^12]
- [Differential Privacy (Programming Differential Privacy, chapter 3)](https://programming-dp.com/chapter3/) — Near, Abuah, living. Backs: ε above 10 probably protects little. [^13]
- `machine-learning/lab-setup.md` — the lab where the DP-SGD, per-example gradient and accountant script ran on 2026-11-25. [^14]
- [BatchNorm1d](https://docs.pytorch.org/docs/2.15/generated/torch.nn.BatchNorm1d.html) — PyTorch, 2026 (2.15). Backs: batch norm's mean and standard deviation are computed over the mini-batch. [^15]

## Related
- `machine-learning/privacy-preserving-ml/differential-privacy.md` — the Gaussian mechanism, sensitivity and Rényi DP this doc builds on.
- `machine-learning/privacy-preserving-ml/membership-inference-and-memorization.md` — measuring what a DP-SGD model still leaks.
- `machine-learning/privacy-preserving-ml/federated-learning.md` — clipping and noising whole client updates instead of examples.
- `machine-learning/deep-learning/training-loop-and-debugging.md` — the ordinary training loop DP-SGD modifies.
- `machine-learning/deep-learning/normalization-and-dropout.md` — batch norm, the layer DP-SGD cannot use.
