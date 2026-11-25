---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/deep-learning
status: verified
applies-to: ["PyTorch 2.15.0"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, deep-learning, optimizers, sgd, momentum, nesterov, rmsprop, adam, adamw, weight-decay, l2-regularization, learning-rate, warmup, cosine-annealing, lr-scheduler]
---

# Optimizers and learning-rate schedules

## Summary
**TL;DR:** An optimizer turns gradients into weight updates. SGD (stochastic gradient descent) steps against the gradient; momentum keeps a running sum of past gradients, so steady directions speed up and zig-zags cancel; RMSprop (root mean square propagation) divides each coordinate's step by a running root-mean-square of its gradients; Adam combines both, with a bias correction for the first steps. In PyTorch, `weight_decay` in `SGD` and `Adam` is an L2 (squared-norm) penalty added to the gradient, which Adam then rescales; `AdamW` shrinks the weights directly, outside the adaptive step, and ends at different weights. A schedule changes the learning rate during training: warmup ramps it up from a small value, cosine decay lowers it smoothly to a minimum.
**Use this when:** you choose or tune an optimizer, see training diverge or crawl, switch between `Adam(weight_decay=…)` and `AdamW`, or set up warmup and decay with `torch.optim.lr_scheduler`.
**Not this doc:** the gradient-descent idea, batch vs mini-batch and the learning rate itself → `machine-learning/foundations/gradient-descent.md`; what L2 regularization does to a model → `machine-learning/foundations/regularization.md`; getting a usable gradient in the first place → `machine-learning/deep-learning/activations-and-initialization.md`.

## Problem
A loss surface is rarely a round bowl. When it is steep in one direction and flat in another (ill-conditioned), every learning rate is wrong for one of them: on `f(x) = 0.1·x1² + 2·x2²`, SGD with learning rate 0.4 is still at `x1 = −0.94` after 20 steps, and with 0.6 it diverges to `x2 = −1673` ✅[^1] ✅[^9]. Adaptive optimizers fix much of this, but they also change what "weight decay" means: the same `weight_decay=0.1` gives a weight of 0.091 with `Adam` and 0.992 with `AdamW` in the worked example ✅[^9]. Schedules add a third set of knobs whose call order and units (steps vs epochs) are easy to get wrong.

## Mental model
**Analogy:** a ball rolling down a long, narrow canyon. Plain SGD is a ball with no mass: it goes straight down the steep walls, bounces from wall to wall and barely moves along the floor. Momentum gives the ball mass: the bounces cancel out and the slow slope along the floor adds up, step after step ✅[^1]. Adam is a hiker who measures each direction separately and takes short steps where the ground has been steep and long steps where it has been flat. The learning-rate schedule is the hiker's pace over the day: a slow start on cold legs (warmup), full speed, then shorter steps near the goal (decay).

**Artifact:** six optimizers on that canyon, `f(x) = 0.1·x1² + 2·x2²` from `(−5, −2)`, all `torch.optim` classes; printed by the full script in the Worked example; lab run (`machine-learning/lab-setup.md`), 2026-11-24, PyTorch 2.15.0 ✅[^9]:

```text
== (1) f(x) = 0.1*x1^2 + 2*x2^2 ==
SGD lr=0.4               steps= 20  x=(-0.943467, -7.31232e-05)  f=8.90e-02
SGD lr=0.4               steps=100  x=(-0.00119606, -1.30664e-22)  f=1.43e-07
SGD lr=0.6               steps= 20  x=(-0.387814, -1673.37)  f=5.60e+06
SGD lr=0.6               steps=100  x=(-1.40358e-05, -8.20037e+14)  f=1.34e+30
SGD lr=0.6 momentum=0.5  steps= 20  x=(0.00718787, 0.00255327)  f=1.82e-05
SGD lr=0.6 momentum=0.5  steps=100  x=(4.70863e-15, -2.17188e-15)  f=1.17e-29
SGD lr=0.6 nesterov 0.5  steps= 20  x=(-0.00240798, -8.14043e+07)  f=1.33e+16
SGD lr=0.6 nesterov 0.5  steps=100  x=(1.61889e-17, -1.65902e+38)  f=5.50e+76
RMSprop lr=0.1           steps= 20  x=(-0.359015, -1.10629e-05)  f=1.29e-02
RMSprop lr=0.1           steps=100  x=(-1.84784e-06, -2.39213e-36)  f=3.41e-13
Adam lr=0.1              steps= 20  x=(-3.06034, -0.222452)  f=1.04e+00
Adam lr=0.1              steps=100  x=(0.039004, 0.0084228)  f=2.94e-04
```

The SGD rows reproduce Dive into Deep Learning's own trace to every digit printed (`x1: −0.943467` at learning rate 0.4, `x2: −1673.365109` at 0.6) ✅[^1]. Momentum 0.5 converges at the learning rate where plain SGD diverges ✅[^1] ✅[^9]. RMSprop's per-coordinate scaling moves much faster than SGD along the flat axis (`x1 = −1.8e-06` after 100 steps, against `−0.0012` for SGD at 0.4); Adam, at `lr=0.1` with its default betas, is the slowest of the converging runs on this noise-free bowl ✅[^9].

## How it works
Notation: `θ` the parameters, `g` the gradient of the loss at the current `θ`, `η` (PyTorch's `lr`) the learning rate, `t` the step number, `⊙` element-wise multiplication.

### SGD and momentum
1. **SGD:** `θ ← θ − η·g` ✅[^3]; PyTorch's default `lr` is `1e-3` ✅[^3].
2. **Momentum (heavy ball):** `v_t = β·v_{t−1} + g_t`, `θ_t = θ_{t−1} − η·v_t`; `β = 0` gives back gradient descent ✅[^1]. Over many steps the weights `β^τ` add up to `1/(1 − β)`, so the effective step is `η/(1 − β)`: with `β = 0.9`, ten times `η` along a steady direction ✅[^1]. Momentum is much more effective on ill-conditioned problems, where progress is much slower in some directions than in others, like a narrow canyon ✅[^1]; it was proposed by Polyak in 1964 ✅[^1].
3. **PyTorch's form:** `v ← μ·v + g`, `p ← p − lr·v` (`μ` is the `momentum` argument, `p` the parameters), where Sutskever et al. and some other frameworks use `v ← μ·v + lr·g`, `p ← p − v`; PyTorch also starts the buffer at the first gradient, where some other frameworks start it at zeros, so `dampening` applies only from step 2 ✅[^3].
4. **Nesterov:** with `nesterov=True`, PyTorch steps along `g + μ·b` (gradient plus the momentum buffer `b`) instead of `b` ✅[^3].

### Per-coordinate step sizes: RMSprop
Adagrad divides by the square root of a sum of all past squared gradients, `s_t = s_{t−1} + g_t²`, which keeps growing ✅[^4]. RMSprop (Tieleman and Hinton, 2012) uses a leaky average instead: `s_t = γ·s_{t−1} + (1 − γ)·g_t²` and `θ_t = θ_{t−1} − η/√(s_t + ε) ⊙ g_t` ✅[^4]. PyTorch's `RMSprop` defaults are `lr=0.01`, `alpha=0.99` (the `γ` above), `eps=1e-8` ✅[^5].

### Adam
1. **Two leaky averages:** `v_t = β1·v_{t−1} + (1 − β1)·g_t` (the mean, like momentum) and `s_t = β2·s_{t−1} + (1 − β2)·g_t²` (the second moment, like RMSprop); common choices are `β1 = 0.9`, `β2 = 0.999` ✅[^2].
2. **Bias correction:** both start at 0, so early values are too small; dividing gives `v̂_t = v_t/(1 − β1^t)` and `ŝ_t = s_t/(1 − β2^t)` ✅[^2]. Example at `t = 1`: `v_1 = 0.1·g`, `v̂_1 = 0.1·g/0.1 = g`, and `ŝ_1 = g²`, so the first step is `η·g/|g|`: size `η` in every coordinate, whatever the gradient's scale.
3. **Update:** `θ_t = θ_{t−1} − η·v̂_t/(√ŝ_t + ε)` ✅[^2]; PyTorch defaults `lr=1e-3`, `betas=(0.9, 0.999)`, `eps=1e-8`, `weight_decay=0` ✅[^6].
4. **What its authors claim:** Adam is invariant to a diagonal rescaling of the gradients; their derivation sets `ε = 0`, so that multiplying the gradients by `c` multiplies `v̂_t` by `c` and `ŝ_t` by `c²`, which cancel in the step ✅[^7]. Its hyperparameters typically need little tuning, though the paper's own experiments still searched hyperparameters such as the learning rate and momentum over a dense grid and reported the best setting ✅[^7]. Reddi et al. showed cases where Adam diverges ✅[^2].

### Weight decay: L2 in the gradient vs decoupled (AdamW)
1. **`SGD` and `Adam` in PyTorch:** `weight_decay=λ` adds `λ·θ` to the gradient before anything else, which is the gradient of an L2 term `λ/2·‖θ‖²` in the loss ✅[^3] ✅[^6].
2. **`AdamW`:** first `θ ← θ − η·λ·θ`, then the Adam step from the loss gradient alone; the decay "does not accumulate in the momentum nor variance" ✅[^8]. Its default `weight_decay` is `1e-2` ✅[^8], and `Adam(decoupled_weight_decay=True)` is equivalent to AdamW ✅[^6].
3. **Why it matters:** L2 regularization and weight decay are equivalent for SGD once rescaled by the learning rate, but not for adaptive methods such as Adam, where L2 regularizes weights with large past gradients less than weight decay would ✅[^10]. Decoupling also made the best weight decay and the best learning rate much more independent of each other in the AdamW paper's experiments ✅[^10].

### Learning-rate schedules
1. **Why schedule:** too large a rate diverges, too small is slow; the rate should decay; and early large steps may not help while the parameters are still random ✅[^11].
2. **Cosine decay:** `η_t = η_T + (η_0 − η_T)/2 · (1 + cos(π·t/T))` for `t` in `[0, T]`, from the initial rate `η_0` to the final `η_T` ✅[^11], proposed by Loshchilov and Hutter ✅[^11]. PyTorch's `CosineAnnealingLR(T_max, eta_min)` approximates this closed form recursively and, unlike SGDR (SGD with warm restarts), never restarts ✅[^12].
3. **Gradual warmup:** Goyal et al., training with a batch `k` times larger than a baseline that uses rate `η`, raise the rate by a constant amount each iteration from `η` to `k·η` over the first 5 epochs; with a large `k`, a constant low-rate warmup followed by a jump could make the training error spike ✅[^13]. In their ImageNet runs with batches of 8,192 images, the training error spiked right after constant warmup and training never fully recovered; top-1 validation error was 25.88 % with constant warmup, worse than no warmup's 24.84 %, while gradual warmup reached 23.74 % against 23.60 % for the 256-image baseline ✅[^13]. PyTorch's `LinearLR(start_factor, total_iters)` multiplies the base rate by a factor that moves linearly to `end_factor` ✅[^14], and `SequentialLR` hands over between schedulers at `milestones` ✅[^15].
4. **Call order:** call `scheduler.step()` after `optimizer.step()`; the other order skips the first value of the schedule ✅[^16].

Warmup then cosine, peak rate 1.0, from the same lab run ✅[^9]:

```text
== (3) peak lr 1.0: 5 warmup steps (LinearLR from 0.2) then CosineAnnealingLR(T_max=15) ==
lr per step: 0.200 0.360 0.520 0.680 0.840 1.000 0.989 0.957 0.905 0.835 0.750 0.655 0.552 0.448 0.345 0.250 0.165 0.095 0.043 0.011 0.000
closed form 0.5*(1+cos(pi*t/15)) for t=0..15: 1.000 0.989 0.957 0.905 0.835 0.750 0.655 0.552 0.448 0.345 0.250 0.165 0.095 0.043 0.011 0.000
```

The first five values climb by `0.8/5 = 0.16` per step from `0.2`; from step 5 on, the values equal the closed form with `η_0 = 1`, `η_T = 0`, `T = 15`.

## Worked example
L2 in the loss vs `weight_decay` vs `AdamW` on a two-feature linear regression: 256 rows, feature 1 with scale 10, feature 2 with scale 0.1, true weights `(1, 1)`, `λ = 0.1`, `lr = 0.01`, 2000 full-batch steps, float64. The core of the fit:

```python
loss = ((X @ w - y) ** 2).mean() / 2 + (lam / 2 * (w ** 2).sum() if l2_in_loss else 0)
loss.backward(); opt.step()          # opt: SGD, Adam or AdamW, with or without weight_decay
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-24, PyTorch 2.15.0, two runs identical ✅[^9]:

```text
== (2) decay lambda=0.1, lr=0.01, 2000 steps; feature scales 10 and 0.1, true w = (1, 1) ==
SGD,  L2 term in loss         w = (0.999054, 0.080628)
SGD,  weight_decay=0.1        w = (0.999054, 0.080628)
Adam, no decay                w = (1.000000, 1.000000)
Adam, L2 term in loss         w = (0.999054, 0.090663)
Adam, weight_decay=0.1        w = (0.999054, 0.090663)
AdamW, weight_decay=0.1       w = (0.991854, 0.991854)
closed-form minimum of loss + L2 w = (0.999054, 0.090663)
```

<details><summary>Full script (prints the output above)</summary>

```python
# (1) Optimizers on the ill-conditioned quadratic f(x) = 0.1*x1^2 + 2*x2^2, start (-5, -2).
# (2) L2 penalty in the loss vs weight_decay vs AdamW on a 2-feature linear regression.
# (3) Linear warmup then cosine decay with PyTorch schedulers.
import math, torch
f = lambda x: 0.1 * x[0] ** 2 + 2 * x[1] ** 2
def run(make, steps):
    x = torch.tensor([-5.0, -2.0], dtype=torch.float64, requires_grad=True)
    opt = make([x])
    for _ in range(steps):
        opt.zero_grad(); f(x).backward(); opt.step()
    return x.detach().tolist(), f(x).item()
print("== (1) f(x) = 0.1*x1^2 + 2*x2^2 ==")
for name, mk in [("SGD lr=0.4", lambda p: torch.optim.SGD(p, lr=0.4)),
                 ("SGD lr=0.6", lambda p: torch.optim.SGD(p, lr=0.6)),
                 ("SGD lr=0.6 momentum=0.5", lambda p: torch.optim.SGD(p, lr=0.6, momentum=0.5)),
                 ("SGD lr=0.6 nesterov 0.5", lambda p: torch.optim.SGD(p, lr=0.6, momentum=0.5, nesterov=True)),
                 ("RMSprop lr=0.1", lambda p: torch.optim.RMSprop(p, lr=0.1)),
                 ("Adam lr=0.1", lambda p: torch.optim.Adam(p, lr=0.1))]:
    for steps in (20, 100):
        x, fx = run(mk, steps)
        print(f"{name:24} steps={steps:3}  x=({x[0]:.6g}, {x[1]:.6g})  f={fx:.2e}")

print("== (2) decay lambda=0.1, lr=0.01, 2000 steps; feature scales 10 and 0.1, true w = (1, 1) ==")
g = torch.Generator().manual_seed(0)
X = torch.randn(256, 2, generator=g, dtype=torch.float64) * torch.tensor([10.0, 0.1], dtype=torch.float64)
y = X @ torch.tensor([1.0, 1.0], dtype=torch.float64)
lam = 0.1
def fit(opt_cls, l2_in_loss=False, **kw):
    w = torch.zeros(2, dtype=torch.float64, requires_grad=True)
    opt = opt_cls([w], lr=0.01, **kw)
    for _ in range(2000):
        opt.zero_grad()
        loss = ((X @ w - y) ** 2).mean() / 2 + (lam / 2 * (w ** 2).sum() if l2_in_loss else 0)
        loss.backward(); opt.step()
    return "(%.6f, %.6f)" % tuple(w.detach().tolist())
print("SGD,  L2 term in loss         w =", fit(torch.optim.SGD, l2_in_loss=True))
print("SGD,  weight_decay=0.1        w =", fit(torch.optim.SGD, weight_decay=lam))
print("Adam, no decay                w =", fit(torch.optim.Adam))
print("Adam, L2 term in loss         w =", fit(torch.optim.Adam, l2_in_loss=True))
print("Adam, weight_decay=0.1        w =", fit(torch.optim.Adam, weight_decay=lam))
print("AdamW, weight_decay=0.1       w =", fit(torch.optim.AdamW, weight_decay=lam))
ridge = torch.linalg.solve(X.T @ X / len(X) + lam * torch.eye(2, dtype=torch.float64), X.T @ y / len(X))
print("closed-form minimum of loss + L2 w = (%.6f, %.6f)" % tuple(ridge.tolist()))

print("== (3) peak lr 1.0: 5 warmup steps (LinearLR from 0.2) then CosineAnnealingLR(T_max=15) ==")
opt = torch.optim.SGD([torch.zeros(1, requires_grad=True)], lr=1.0)
warm = torch.optim.lr_scheduler.LinearLR(opt, start_factor=0.2, total_iters=5)
cos = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=15, eta_min=0.0)
sched = torch.optim.lr_scheduler.SequentialLR(opt, [warm, cos], milestones=[5])
lrs = []
for step in range(21):
    lrs.append(opt.param_groups[0]["lr"]); opt.step(); sched.step()
print("lr per step:", " ".join(f"{v:.3f}" for v in lrs))
print("closed form 0.5*(1+cos(pi*t/15)) for t=0..15:",
      " ".join(f"{0.5 * (1 + math.cos(math.pi * t / 15)):.3f}" for t in range(16)))
```

</details>

Reading it, line by line:
- **SGD, two ways:** an L2 term in the loss and `weight_decay=0.1` give the same weights to 6 decimals: for SGD they are one mechanism. SGD's second weight (0.0806) is still short of the minimum, because its curvature is only about `0.01 + 0.1 = 0.11`: each step closes `0.01 × 0.11 = 0.0011` of the gap, and `(1 − 0.0011)^2000 ≈ 0.11` of the gap is left.
- **Adam, two ways:** L2 in the loss and `Adam(weight_decay=0.1)` are also identical, which confirms that `Adam`'s `weight_decay` is L2. Both reach the closed-form minimum of `loss + λ/2·‖w‖²`, `(0.999054, 0.090663)`: the weight on the large-scale feature shrinks by 0.1 %, the one on the small-scale feature by 91 %.
- **AdamW:** both weights end at `0.991854`. Each coordinate's Adam step ignores the scale of its gradient, and the decay removes the same fraction `η·λ = 0.001` of each weight per step, so the two coordinates follow the same path. This is the decoupling the AdamW paper describes: how strongly a weight is decayed no longer depends on the size of its gradients ✅[^10].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `torch.optim.Adam(weight_decay=λ)` used as "AdamW" | Different weights (0.091 vs 0.992 in the lab) | `Adam` adds `λ·θ` to the gradient ✅[^6]; AdamW decays outside the adaptive step ✅[^8]; lab ✅[^9] |
| Switching `Adam` → `AdamW` without setting `weight_decay` | Decay turns on at 0.01 | Defaults: `Adam` 0, `AdamW` `1e-2` ✅[^6] ✅[^8] |
| Nesterov at the momentum run's settings (`lr=0.6`, `μ=0.5`) | Diverges (`x2 = −8.1e7` after 20 steps) while plain momentum converges | A different step, `g + μ·b` instead of `b` ✅[^3], overshoots on the steep axis at this rate ✅[^9] |
| `scheduler.step()` before `optimizer.step()` | The first value of the schedule is skipped | Order changed in PyTorch 1.1.0 ✅[^16] |
| Momentum hyperparameters copied from another framework | Same steps at a constant `lr` without `dampening`; different ones once a schedule changes `lr` or `dampening` is set | PyTorch multiplies the buffer, not each gradient, by `lr`, and starts the buffer at the first gradient, so the first step escapes `dampening` ✅[^3] |
| `CosineAnnealingLR` stepped past `T_max` | No stop at `eta_min`: the rate climbs back along the cosine and is at the peak again at `2·T_max` (lab, `T_max=4`, `eta_min=0.1`: 1.0, 0.868, 0.55, 0.232, 0.1, 0.232, 0.55, 0.868, 1.0) ✅[^9] | No SGDR restarts, and `T_cur = t` keeps growing, so `cos(π·T_cur/T_max)` rises again after `T_max` ✅[^12] |
| Batch size multiplied by `k` | Multiply the rate by `k` (linear scaling rule) and warm up | Goyal et al.'s rule and gradual warmup ✅[^13] |
| Adam on some problems | Can fail to converge | Reddi et al.'s counter-examples ✅[^2] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| SGD + momentum | One state buffer `b` ✅[^3]; converges on the canyon where plain SGD diverges ✅[^1] ✅[^9] | The rate has to be adjusted: too large diverges, too small trains slowly or ends at a worse result ✅[^11] |
| Adam | Per-coordinate scaling, invariant to diagonal rescaling of the gradients, little tuning ✅[^7] | Two state buffers, first and second moment ✅[^6]; L2 interacts with the scaling ✅[^10]; can diverge ✅[^2] |
| AdamW | Decay independent of gradient size; generalized substantially better than Adam with L2 in the AdamW paper, about 15 % relative test-error improvement on its image tasks ✅[^10] | Another default to know (`weight_decay=0.01`) ✅[^8] |
| Warmup | Avoids the error spike of a sudden large rate ✅[^13] | One more hyperparameter (length) |
| Cosine decay | Smooth decay to `η_T` with two parameters besides the peak rate, `η_T` and `T` ✅[^11] | `T_max`, the maximum number of iterations, is a required argument, so the decay's length is fixed when the scheduler is built ✅[^12] |

## Takeaways
- Use `AdamW` when you mean weight decay with an adaptive optimizer; `Adam(weight_decay=…)` is L2 regularization. [rule-candidate]
- When SGD diverges at a rate that is still too slow in other directions, the problem is conditioning: add momentum or use a per-coordinate optimizer before shrinking the rate.
- Call `optimizer.step()` then `scheduler.step()`, and decide whether the schedule counts steps or epochs. [rule-candidate]
- Print the schedule's learning rates for the whole run before training; the lab printout makes an off-by-one or a wrong `T_max` visible.

## Verification status
- Verified: 72 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [Momentum (Dive into Deep Learning, 12.6)](https://d2l.ai/chapter_optimization/momentum.html) — Zhang, Lipton, Li, Smola, living. Backs: the ill-conditioned quadratic and its traces at 0.4 and 0.6, heavy-ball update, `η/(1−β)`, narrow canyon, Polyak 1964. [^1]
- [Adam (Dive into Deep Learning, 12.10)](https://d2l.ai/chapter_optimization/adam.html) — Zhang, Lipton, Li, Smola, living. Backs: Adam's two averages, common betas, bias correction, update, Reddi et al.'s divergence cases. [^2]
- [torch.optim.SGD](https://docs.pytorch.org/docs/2.15/generated/torch.optim.SGD.html) — PyTorch, 2026 (2.15). Backs: SGD algorithm, default `lr`, weight decay as `λθ`, PyTorch vs Sutskever momentum form, first-step buffer, Nesterov. [^3]
- [RMSProp (Dive into Deep Learning, 12.8)](https://d2l.ai/chapter_optimization/rmsprop.html) — Zhang, Lipton, Li, Smola, living. Backs: Adagrad's growing sum, RMSprop's leaky average and update, Tieleman and Hinton. [^4]
- [torch.optim.RMSprop](https://docs.pytorch.org/docs/2.15/generated/torch.optim.RMSprop.html) — PyTorch, 2026 (2.15). Backs: defaults. [^5]
- [torch.optim.Adam](https://docs.pytorch.org/docs/2.15/generated/torch.optim.Adam.html) — PyTorch, 2026 (2.15). Backs: defaults, `weight_decay` as L2, `decoupled_weight_decay`. [^6]
- [Adam: A Method for Stochastic Optimization](https://arxiv.org/abs/1412.6980) — Kingma, Ba, 2014 (v9, 2017; full text read, PDF). Backs: invariance to diagonal rescaling and its `ε = 0` derivation (§2.1), little tuning, grid-searched hyperparameters in its experiments (§6). [^7]
- [torch.optim.AdamW](https://docs.pytorch.org/docs/2.15/generated/torch.optim.AdamW.html) — PyTorch, 2026 (2.15). Backs: decoupled decay step, default `weight_decay=1e-2`. [^8]
- `machine-learning/lab-setup.md` — the lab where the six optimizers on the quadratic, the L2-vs-AdamW fits and the warmup-cosine schedule ran on 2026-11-24 (re-run 2026-11-25, same output), and `CosineAnnealingLR` past `T_max` was checked on 2026-11-25. [^9]
- [Decoupled Weight Decay Regularization](https://arxiv.org/html/1711.05101v3) — Loshchilov, Hutter, 2019 (v3; full text read on ar5iv). Backs: L2 and weight decay equivalent for SGD, not for Adam; large-gradient weights regularized less; decoupled hyperparameters; 15 % relative improvement. [^10]
- [Learning Rate Scheduling (Dive into Deep Learning, 12.11)](https://d2l.ai/chapter_optimization/lr-scheduler.html) — Zhang, Lipton, Li, Smola, living. Backs: why schedule, cosine formula, Loshchilov and Hutter, warmup motivation. [^11]
- [torch.optim.lr_scheduler.CosineAnnealingLR](https://docs.pytorch.org/docs/2.15/generated/torch.optim.lr_scheduler.CosineAnnealingLR.html) — PyTorch, 2026 (2.15). Backs: recursive approximation of the closed form, no restarts, `T_max` required. [^12]
- [Accurate, Large Minibatch SGD: Training ImageNet in 1 Hour](https://arxiv.org/html/1706.02677v2) — Goyal et al., 2017 (v2; full text read on ar5iv). Backs: gradual warmup over 5 epochs, constant-warmup error spike (§2.2; §5.2, Figure 2 and Table 1), linear scaling rule. [^13]
- [torch.optim.lr_scheduler.LinearLR](https://docs.pytorch.org/docs/2.15/generated/torch.optim.lr_scheduler.LinearLR.html) — PyTorch, 2026 (2.15). Backs: `start_factor`, `end_factor`, `total_iters`. [^14]
- [torch.optim.lr_scheduler.SequentialLR](https://docs.pytorch.org/docs/2.15/generated/torch.optim.lr_scheduler.SequentialLR.html) — PyTorch, 2026 (2.15). Backs: chaining schedulers at milestones. [^15]
- [torch.optim](https://docs.pytorch.org/docs/2.15/optim.html) — PyTorch, 2026 (2.15). Backs: scheduler after optimizer; the 1.1.0 order change. [^16]

## Related
- `machine-learning/foundations/gradient-descent.md` — the learning rate, conditioning and divergence in their basic form.
- `machine-learning/foundations/regularization.md` — L2 regularization and weight decay as regularizers.
- `machine-learning/deep-learning/neural-networks-and-backpropagation.md` — where `g` comes from.
- `machine-learning/deep-learning/normalization-and-dropout.md` — normalization lets higher learning rates work.
- `machine-learning/transformers/pretraining-and-scaling-laws.md` — the large-scale training runs these schedules are used in.
