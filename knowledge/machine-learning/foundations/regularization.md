---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/foundations
status: verified
applies-to: ["any", "scikit-learn 1.9.1"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [machine-learning, basics, regularization, ridge, lasso, elastic-net, l1, l2, weight-decay, early-stopping, sparsity, shrinkage]
---

# Regularization: ridge, lasso, elastic net and early stopping

## Summary
**TL;DR:** Regularization fights overfitting by making the training objective prefer simpler models: `loss + α · penalty`, where `α ≥ 0` sets the strength. The **L2** penalty (sum of squared weights; ridge regression, also called weight decay) shrinks every weight toward zero but leaves none exactly at zero. The **L1** penalty (sum of absolute weights; the lasso) pushes small weights to **exactly** zero, so it also selects features. **Elastic net** mixes the two and shares weight among correlated features instead of picking one. **Early stopping** halts training when the validation error stops improving and needs no penalty at all. All of them trade a little bias for less variance, and `α` (or the stopping step) must be chosen on validation data.
**Use this when:** a model overfits, you need a sparse model or a feature selection, you choose between `Ridge`, `Lasso` and `ElasticNet`, or you set `alpha`, `l1_ratio` or an early-stopping patience.
**Not this doc:** why overfitting happens and how to detect it → `machine-learning/foundations/generalization-and-overfitting.md`; decoupled weight decay in Adam (AdamW) → `machine-learning/deep-learning/optimizers-and-learning-rate-schedules.md`; dropout → `machine-learning/deep-learning/normalization-and-dropout.md`; L1-based feature selection in a pipeline → `machine-learning/data-and-features/feature-importance-and-selection.md`.

## Problem
A model with enough capacity fits the noise in its training data. Lowering capacity by removing features or lowering a polynomial's degree is a blunt tool: with many input variables the number of possible terms (monomials) explodes with the degree, so each step changes the model a lot ✅[^2]. In the lab, a degree-12 polynomial fitted to 20 points with almost no penalty (ridge `α = 1e-8`) has a validation MSE (mean squared error) of 0.0812, six times the 0.0138 it reaches at `α = 0.01` with the same features ✅[^8]. A finer, continuous knob is needed.

## Mental model
**Analogy:** a tax on the model's weights. **Ridge** taxes the *square* of each weight: big weights pay a lot, small ones almost nothing, so every feature trims its weight but none quits. **Lasso** charges a *flat rate per unit* of weight: for a feature that contributes little, the fee outweighs its benefit and it is cheaper to drop out entirely, so its weight becomes exactly 0. **Elastic net** charges both. **Early stopping** taxes time instead: you stop the training clock before the model has had long enough to memorize the noise.

**Artifact:** coefficients of a linear model of disease progression (scikit-learn's bundled diabetes data: 442 patients, 10 standardized features) as the penalty grows; lab run (`machine-learning/lab-setup.md`), 2026-11-24, scikit-learn 1.9.1 ✅[^8]:

```text
ridge alpha=0.1    zeros=0  smallest |w|=0.471  largest |w|= 36.74
ridge alpha=10000  zeros=0  smallest |w|=0.057  largest |w|=  1.78
lasso alpha=1      zeros=3  largest |w|= 24.83
lasso alpha=30     zeros=8  largest |w|= 11.37
```

Ridge at `alpha=10000` has shrunk every weight yet left none at zero; lasso at `alpha=30` has dropped 8 of the 10 features ✅[^8].

## How it works

### The penalized objective
Most penalties add a term to the training objective: `J̃(θ) = J(θ) + α · Ω(θ)`, where `J` is the unregularized loss, `Ω` measures the size of the parameters `θ`, and `α ∈ [0, ∞)` weights it; `α = 0` means no regularization and larger `α` means more ✅[^3]. Usually only the weights are penalized and the bias (intercept) is left free: a bias needs little data to fit, and penalizing it can cause underfitting ✅[^3] ✅[^2]. A regularizer works by trading increased bias for reduced variance; a good one makes a profitable trade ✅[^3]. In scikit-learn the strength is called `alpha`; in Google's course it is the regularization rate `λ` (lambda) ✅[^4].

### L2: ridge regression and weight decay
- **Penalty:** `‖w‖₂² = w₁² + w₂² + … + wₙ²`. Example: weights `[0.2, −0.5, 5.0, −1.2, 0.3, −0.1]` give `0.04 + 0.25 + 25.0 + 1.44 + 0.09 + 0.01 = 26.83`, of which the single weight 5.0 contributes about 93 % ✅[^4]. Large weights dominate the penalty; near-zero weights barely count ✅[^4].
- **scikit-learn `Ridge`** minimizes `‖y − Xw‖₂² + α · ‖w‖₂²` ✅[^1]; larger `α` means more shrinkage and coefficients more robust to collinearity ✅[^1]. Ridge is also known as Tikhonov regularization ✅[^10] ✅[^3].
- **Closed form:** for centred data, `w = (XᵀX + α·I)⁻¹ Xᵀ y`, where `I` is the identity matrix; in the lab this formula agreed with `Ridge` to `5.0e-14` ✅[^8].
- **Why "weight decay":** with the penalty `(λ/2)·‖w‖²` and learning rate `η`, a gradient step becomes `w ← (1 − ηλ)·w − η·∇L(w)`: every step first multiplies the weights by `1 − ηλ`, then takes the usual gradient step ✅[^2]. Example: `η = 0.1`, `λ = 0.01` shrinks every weight by 0.1 % per step before the data has its say.
- **No zeros:** L2 moves weights toward 0 but never all the way, so every feature keeps some influence ✅[^4] ✅[^3]. It spreads weight across many features, which can make the model robust to measurement error in one of them ✅[^2].

### L1: the lasso and exact zeros
- **Penalty:** `‖w‖₁ = |w₁| + … + |wₙ|`, the sum of absolute values ✅[^3].
- **scikit-learn `Lasso`** minimizes `(1 / (2·n_samples)) · ‖Xw − y‖₂² + α · ‖w‖₁` ✅[^1]; note the `1/(2n)` factor that `Ridge` does not have.
- **Why zeros appear:** the penalty's (sub)gradient is `α · sign(w)`, a push of constant size toward 0 however small the weight already is, instead of a push proportional to the weight as with L2 ✅[^3]. The coordinate-descent solver updates one weight at a time with the **soft-thresholding** function `S(z, α) = sign(z) · max(0, |z| − α)`, which is exactly zero whenever `α ≥ |z|` ✅[^1]. Example with `α = 0.5`: `S(2.0) = 1.5`, `S(−0.8) = −0.3`, `S(0.3) = 0`.
- **Side by side** (one weight, the quadratic loss `½·(w − w*)²` whose unpenalized best is `w*`, plus the penalty `α·|w|` or `(α/2)·w²`): L1 gives `sign(w*) · max(|w*| − α, 0)` and L2 gives `w* / (1 + α)` ✅[^3]. With `α = 0.5`, `w* = 0.3` becomes 0 under L1 but 0.2 under L2.
- **Feature selection:** because some weights are exactly zero, the lasso uses fewer features, and those can be dropped ✅[^1] ✅[^3].

### Elastic net
`ElasticNet` minimizes `(1 / (2n)) · ‖Xw − y‖₂² + α·ρ·‖w‖₁ + (α·(1 − ρ) / 2) · ‖w‖₂²`, where `ρ` is the `l1_ratio` parameter ✅[^1]; `l1_ratio = 1` is the lasso ✅[^9]. It keeps the lasso's sparsity and some of ridge's stability, and with several correlated features "Lasso is likely to pick one of these at random, while elastic-net is likely to pick both" ✅[^1].

### Early stopping
1. Train, and every `n` steps measure the validation error ✅[^3].
2. Whenever it improves, store a copy of the parameters ✅[^3].
3. Stop after the error has failed to improve `p` times in a row (the **patience**), and return the stored best parameters, not the last ones ✅[^3].
It is probably the most used regularizer in deep learning, because it is effective and needs almost no change to the training procedure ✅[^3]. It treats the number of training steps as a hyperparameter whose values one training run tries out in order ✅[^3]. For a linear model with a quadratic loss and plain gradient descent, early stopping is equivalent to L2 regularization, with the learning rate times the number of steps, `η·τ`, behaving like the inverse of the weight-decay coefficient ✅[^3]. It usually increases training loss but can decrease test loss; Google's course calls it quick but rarely optimal ✅[^4]. In scikit-learn's SGD (stochastic gradient descent) models, `early_stopping=True` holds out `validation_fraction` of the data and stops after `n_iter_no_change` epochs without improvement ✅[^5].

### Choosing the strength
`α` (or the stopping step) is a hyperparameter chosen on a validation set or by cross-validation, never on the training set: a penalty of 0 always fits the training set best, so it would always win there ✅[^6]. Too large a penalty underfits; with very large weight decay a model can be forced to an almost constant function ✅[^6]. The ideal value depends on the data and must be tuned ✅[^4].

### The probabilistic reading
An L2 penalty is a Gaussian prior on the weights and an L1 penalty a Laplace prior, in MAP (maximum a posteriori) estimation ✅[^3] ✅[^6]; the details are in `machine-learning/foundations/loss-functions-and-maximum-likelihood.md`.

## Worked example
One script: ridge and lasso paths on the diabetes data, the ridge closed form, two nearly identical features under lasso and elastic net, then a degree-12 polynomial on 20 noisy points (`y = cos(1.5πx)` plus noise of standard deviation 0.1) regularized two ways, by a ridge `α` sweep and by early-stopped gradient descent. Core lines of the early-stopping loop:

```python
theta -= eta * 2 * A_tr.T @ (A_tr @ theta - y_tr) / 20     # one full-batch gradient step
if k % 1000 == 0:                                          # every 1000 steps ...
    va = np.mean((A_va @ theta - y_va) ** 2)               # ... measure validation MSE
    best = min(best, (va, k))                              # ... and remember the best step
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-24, Python 3.13.7, numpy 2.5.5, scikit-learn 1.9.1, two runs identical ✅[^8]:

```text
ridge alpha=0.1    zeros=0  smallest |w|=0.471  largest |w|= 36.74
ridge alpha=10     zeros=0  smallest |w|=0.258  largest |w|= 25.33
ridge alpha=100    zeros=0  smallest |w|=0.436  largest |w|= 21.38
ridge alpha=1000   zeros=0  smallest |w|=0.043  largest |w|=  9.93
ridge alpha=10000  zeros=0  smallest |w|=0.057  largest |w|=  1.78
lasso alpha=0.01   zeros=0  largest |w|= 36.05
lasso alpha=1      zeros=3  largest |w|= 24.83
lasso alpha=5      zeros=5  largest |w|= 24.22
lasso alpha=10     zeros=6  largest |w|= 22.60
lasso alpha=30     zeros=8  largest |w|= 11.37
lasso alpha=10 coefficients: [ 0.   -0.   22.6   6.8  -0.   -0.   -3.09  0.   19.59  0.  ]
same, feature 3 scaled x0.01: [ 0.   -0.    0.   12.37  0.    0.   -7.94  0.   25.2   0.74]
ridge closed form == sklearn: True  max diff 5.0e-14
correlation of features 1 and 2: 0.99995
lasso       coef: [0.    1.911 0.   ]
elastic net coef: [0.955 0.958 0.   ]
lasso, default max_iter: [1.612 0.3   0.   ] warning: ConvergenceWarning

ridge alpha   train_MSE  valid_MSE
      1e-08     0.0022     0.0812
      1e-04     0.0025     0.0380
      1e-03     0.0028     0.0306
      1e-02     0.0054     0.0138
      1e-01     0.0080     0.0162
      1e+00     0.0232     0.0544
      1e+01     0.1260     0.1188

GD step  train_MSE  valid_MSE
    100     0.0303     0.1020
   1000     0.0080     0.0153
  10000     0.0062     0.0136
  30000     0.0046     0.0145
 100000     0.0028     0.0318
 300000     0.0026     0.0462
early stopping would keep step 16000 (valid MSE 0.0132)
```

<details><summary>Full script (prints the output above)</summary>

```python
# Ridge shrinks, lasso zeroes, elastic net shares; ridge closed form; early stopping.
import warnings

import numpy as np
from sklearn.datasets import load_diabetes
from sklearn.linear_model import ElasticNet, Lasso, Ridge
from sklearn.preprocessing import PolynomialFeatures, StandardScaler

# 1. Diabetes data (442 patients, 10 features), features standardized.
X, y = load_diabetes(return_X_y=True)
X = StandardScaler().fit_transform(X)
for alpha in [0.1, 10, 100, 1000, 10000]:
    w = Ridge(alpha=alpha).fit(X, y).coef_
    print(f"ridge alpha={alpha:<6} zeros={np.sum(w == 0)}  smallest |w|={np.abs(w).min():.3f}  largest |w|={np.abs(w).max():6.2f}")
for alpha in [0.01, 1, 5, 10, 30]:                       # lasso's loss is scaled by 1/(2n): other alphas
    w = Lasso(alpha=alpha, max_iter=100_000).fit(X, y).coef_
    print(f"lasso alpha={alpha:<6} zeros={np.sum(w == 0)}  largest |w|={np.abs(w).max():6.2f}")
print("lasso alpha=10 coefficients:", np.round(Lasso(alpha=10).fit(X, y).coef_, 2))
Xs = X.copy(); Xs[:, 2] *= 0.01                      # same information, feature 3 in other units
print("same, feature 3 scaled x0.01:", np.round(Lasso(alpha=10).fit(Xs, y).coef_, 2))

# 2. Ridge by the closed form w = (X^T X + alpha I)^-1 X^T y (centred data, no intercept).
Xc, yc = X - X.mean(0), y - y.mean()
w_closed = np.linalg.solve(Xc.T @ Xc + 10 * np.eye(10), Xc.T @ yc)
w_sk = Ridge(alpha=10, fit_intercept=False).fit(Xc, yc).coef_
print("ridge closed form == sklearn:", np.allclose(w_closed, w_sk), " max diff", f"{np.abs(w_closed - w_sk).max():.1e}")

# 3. Two nearly identical features: lasso picks one, elastic net shares the weight.
rng = np.random.default_rng(0)
z = rng.normal(size=300)
X2 = np.column_stack([z, z + rng.normal(0, 0.01, 300), rng.normal(size=300)])
y2 = 2 * z + rng.normal(0, 0.5, 300)
print("correlation of features 1 and 2:", np.round(np.corrcoef(X2[:, 0], X2[:, 1])[0, 1], 5))
print("lasso       coef:", np.round(Lasso(alpha=0.1, max_iter=1_000_000, tol=1e-10).fit(X2, y2).coef_, 3))
print("elastic net coef:", np.round(ElasticNet(alpha=0.1, l1_ratio=0.5).fit(X2, y2).coef_, 3))
with warnings.catch_warnings(record=True) as caught:      # same lasso, default max_iter=1000
    warnings.simplefilter("always")
    w_default = Lasso(alpha=0.1).fit(X2, y2).coef_
print("lasso, default max_iter:", np.round(w_default, 3), "warning:", caught[0].category.__name__ if caught else None)

# 4. Degree-12 polynomial on 20 noisy points: ridge alpha sweep and early stopping.
def true_fun(x):
    return np.cos(1.5 * np.pi * x)
def sample(rng, n):
    x = np.sort(rng.random(n))
    return x, true_fun(x) + rng.normal(0, 0.1, n)
rng = np.random.default_rng(0)
x_tr, y_tr = sample(rng, 20); x_va, y_va = sample(rng, 200)
pf, sc = PolynomialFeatures(12, include_bias=False), StandardScaler()
P_tr = sc.fit_transform(pf.fit_transform(x_tr[:, None])); P_va = sc.transform(pf.transform(x_va[:, None]))
print("\nridge alpha   train_MSE  valid_MSE")
for alpha in [1e-8, 1e-4, 1e-3, 1e-2, 1e-1, 1, 10]:
    m = Ridge(alpha=alpha).fit(P_tr, y_tr)
    print(f"{alpha:11.0e}  {np.mean((m.predict(P_tr) - y_tr)**2):9.4f}  {np.mean((m.predict(P_va) - y_va)**2):9.4f}")

A_tr, A_va = np.column_stack([np.ones(20), P_tr]), np.column_stack([np.ones(200), P_va])
eta = 1 / np.linalg.eigvalsh(2 * A_tr.T @ A_tr / 20).max()
theta, best = np.zeros(A_tr.shape[1]), (np.inf, 0)
print("\nGD step  train_MSE  valid_MSE")
for k in range(1, 300_001):
    theta -= eta * 2 * A_tr.T @ (A_tr @ theta - y_tr) / 20
    if k % 1000 == 0:
        va = np.mean((A_va @ theta - y_va) ** 2)
        best = min(best, (va, k))
    if k in (100, 1000, 10_000, 30_000, 100_000, 300_000):
        print(f"{k:7d}  {np.mean((A_tr @ theta - y_tr)**2):9.4f}  {np.mean((A_va @ theta - y_va)**2):9.4f}")
print(f"early stopping would keep step {best[1]} (valid MSE {best[0]:.4f})")
```

</details>

Reading it:
- **Ridge rows:** as `α` grows from 0.1 to 10,000, the largest coefficient shrinks from 36.74 to 1.78, yet no coefficient is ever exactly zero ✅[^8].
- **Lasso rows:** the count of exact zeros climbs 0 → 3 → 5 → 6 → 8 ✅[^8]. At `α = 10` only four features remain (columns 3, 4, 7 and 9); the lasso has done feature selection ✅[^8].
- **`feature 3 scaled x0.01`:** the same data with one column in different units (each value divided by 100) loses that feature entirely, and the others change to compensate ✅[^8]. To keep its effect, the rescaled feature would need a coefficient 100 times larger, which the L1 penalty prices out. The penalty depends on feature scale, so standardize first.
- **Correlated pair (correlation 0.99995):** the fully converged lasso puts all the weight (1.911) on one of the two copies and 0 on the other, here the second; elastic net splits it evenly (0.955, 0.958) ✅[^8], as the scikit-learn guide describes ✅[^1].
- **`default max_iter`:** the same lasso with its default 1,000 iterations stops early with a `ConvergenceWarning`, and its unfinished answer (1.612, 0.3) looks like sharing ✅[^8].
- **Ridge sweep on the polynomial:** validation MSE falls from 0.0812 (`α = 1e-8`, overfit) to 0.0138 (`α = 0.01`), then rises to 0.1188 (`α = 10`, underfit), while training MSE rises at every step ✅[^8]: the U-curve, driven by `α` instead of the degree.
- **Early stopping:** with the same features and no penalty, gradient descent's validation MSE is lowest around step 16,000 (0.0132, close to the best ridge value 0.0138) and then climbs to 0.0462 by step 300,000 while training MSE keeps falling ✅[^8]. Keeping step 16,000 is the early-stopping answer.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Features on different scales | The penalty hits them unequally; lab: rescaling one diabetes feature by 0.01 made the lasso drop it | A unit-sized penalty costs more for a feature that needs a large coefficient ✅[^8]; standardize first |
| Strongly correlated features under lasso | One is kept, the others zeroed; which one is arbitrary | "Likely to pick one of these at random" ✅[^1]; lab ✅[^8]; use elastic net to keep both |
| Lasso stops at `max_iter` | Coefficients are not the lasso solution; looks like sharing | Default `max_iter=1000` ✅[^9]; lab: `ConvergenceWarning`, (1.612, 0.3) instead of (0, 1.911) ✅[^8] |
| `Ridge` and `Lasso` given the same `alpha` | Different strengths | Lasso's loss is scaled by `1/(2n)`, Ridge's is not ✅[^1] |
| `alpha = 0` on `Ridge` or `Lasso` | Equivalent to ordinary least squares but numerically not advised | Use `LinearRegression` instead ✅[^9] ✅[^10] |
| `α` tuned on the training set | Always chooses no penalty | `α = 0` always fits the training data best ✅[^6] |
| Penalty far too strong | Underfitting; in the limit, an almost constant model | Very large weight decay removes the slope ✅[^6]; lab: `α = 10`, validation 0.1188 ✅[^8] |
| Unregularized logistic regression with many features | Loss keeps being driven toward 0 | Its asymptotic nature; use L2 or early stopping ✅[^7] |
| L2 penalty with an adaptive optimizer (Adam) | Not the same as decaying the weights | `ℓ2` and weight decay are equivalent for SGD but may not be for other optimizers ✅[^2]; see AdamW in `machine-learning/deep-learning/optimizers-and-learning-rate-schedules.md` |
| Early stopping without stored parameters | The final model is the overfit one | Return the best stored parameters, not the last ✅[^3] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| L2 (ridge, weight decay) | Shrinks smoothly; robust to collinearity ✅[^1]; closed form for linear models ✅[^8] | Keeps every feature ✅[^4] |
| L1 (lasso) | Exact zeros, built-in feature selection ✅[^1] | Arbitrary choice among correlated features ✅[^1]; iterative solver that must converge ✅[^8] |
| Elastic net | Sparse and stable with correlated features ✅[^1] | Two hyperparameters (`alpha`, `l1_ratio`) to tune ✅[^1] |
| Early stopping | Almost free: no change to the objective ✅[^3] | Needs a validation set and a stored copy of the best parameters ✅[^3]; rarely optimal ✅[^4] |

## Takeaways
- Standardize features before any L1 or L2 penalty, with the scaler fitted on the training split. [rule-candidate]
- Tune `alpha` by validation or cross-validation over a log-spaced grid; never pick it on training error. [rule-candidate]
- Want a sparse model? Lasso, or elastic net when features are correlated; want every feature kept? Ridge.
- Treat a `ConvergenceWarning` from `Lasso` or `ElasticNet` as a wrong answer, not a cosmetic warning.

## Verification status
- Verified: 78 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- [Linear Models (User Guide 1.1)](https://scikit-learn.org/stable/modules/linear_model.html) — scikit-learn developers, living (1.9.1). Backs: `Ridge`, `Lasso` and `ElasticNet` objectives, shrinkage and collinearity, sparse lasso coefficients and feature selection, soft-thresholding in coordinate descent, lasso vs elastic net on correlated features (quoted). [^1]
- [Dive into Deep Learning, 3.7 Weight Decay](https://d2l.ai/chapter_linear-regression/weight-decay.html) — Aston Zhang, Zachary C. Lipton, Mu Li, Alexander J. Smola, living. Backs: monomial count makes dropping features blunt, `(λ/2)‖w‖²` penalty, the `(1 − ηλ)` update, L2 spreads weight while L1 clears weights to zero, bias often not regularized, `ℓ2` vs weight decay for other optimizers. [^2]
- [Deep Learning, chapter 7: Regularization for Deep Learning](https://www.deeplearningbook.org/contents/regularization.html) — Ian Goodfellow, Yoshua Bengio, Aaron Courville, 2016. Backs: penalized objective `J + αΩ`, biases unpenalized, bias-for-variance trade, L2 as Tikhonov, L1 subgradient, closed-form L1 and L2 solutions for a diagonal Hessian, sparsity and LASSO feature selection, Laplace prior, early stopping algorithm and patience, equivalence with L2 for quadratic losses. [^3]
- [Overfitting: L2 regularization (Machine Learning Crash Course)](https://developers.google.com/machine-learning/crash-course/overfitting/regularization?hl=en) — Google for Developers, living. Backs: the six-weight example (26.83, 93 %), L2 never reaches zero, regularization rate `λ`, early stopping quick but rarely optimal, value is data-dependent. [^4]
- [Stochastic Gradient Descent (User Guide 1.5)](https://scikit-learn.org/stable/modules/sgd.html) — scikit-learn developers, living (1.9.1). Backs: `early_stopping`, `validation_fraction`, `n_iter_no_change`. [^5]
- [Deep Learning, chapter 5: Machine Learning Basics](https://www.deeplearningbook.org/contents/ml.html) — Ian Goodfellow, Yoshua Bengio, Aaron Courville, 2016. Backs: weight decay `λ` as a hyperparameter not learnable on the training set, very large `λ` gives a function with no slope, MAP with a Gaussian prior = weight decay. [^6]
- [Logistic regression: Loss and regularization (Machine Learning Crash Course)](https://developers.google.com/machine-learning/crash-course/logistic-regression/loss-regularization?hl=en) — Google for Developers, living. Backs: unregularized logistic regression drives loss toward 0 with many features; L2 or early stopping. [^7]
- `machine-learning/lab-setup.md` — the lab where the ridge and lasso paths, the rescaled-feature lasso, the ridge closed form, the correlated-feature lasso and elastic net, the ridge `α` sweep and early-stopped gradient descent ran on 2026-11-24. [^8]
- [sklearn.linear_model.Lasso](https://scikit-learn.org/stable/modules/generated/sklearn.linear_model.Lasso.html) — scikit-learn developers, living (1.9.1). Backs: default `max_iter=1000`, `alpha = 0` not advised, lasso = elastic net with `l1_ratio = 1`. [^9]
- [sklearn.linear_model.Ridge](https://scikit-learn.org/stable/modules/generated/sklearn.linear_model.Ridge.html) — scikit-learn developers, living (1.9.1). Backs: Ridge objective, also known as Tikhonov regularization, `alpha = 0` not advised. [^10]

## Related
- `machine-learning/foundations/generalization-and-overfitting.md` — the bias–variance trade that regularization buys.
- `machine-learning/foundations/loss-functions-and-maximum-likelihood.md` — penalties as priors (MAP).
- `machine-learning/foundations/gradient-descent.md` — the optimizer that early stopping halts.
- `machine-learning/deep-learning/optimizers-and-learning-rate-schedules.md` — weight decay in Adam and AdamW.
- `machine-learning/deep-learning/normalization-and-dropout.md` — dropout, another regularizer for networks.
- `machine-learning/data-and-features/preprocessing-and-pipelines.md` — standardizing inside a pipeline before the penalty.
- `machine-learning/data-and-features/feature-importance-and-selection.md` — L1-based feature selection.
- `machine-learning/evaluation/cross-validation-and-hyperparameter-search.md` — tuning `alpha` and `l1_ratio`.
- `machine-learning/supervised-learning/linear-regression.md` — the unpenalized least-squares model.
