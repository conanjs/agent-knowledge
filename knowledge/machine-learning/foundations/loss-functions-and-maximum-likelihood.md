---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/foundations
status: verified
applies-to: ["any", "scikit-learn 1.9.1", "PyTorch 2.15.0"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [machine-learning, basics, loss-function, empirical-risk-minimization, mse, mae, huber, log-loss, cross-entropy, hinge, maximum-likelihood, map]
---

# Loss functions and maximum likelihood

## Summary
**TL;DR:** A loss function turns "how wrong is this prediction" into one number, and training minimizes the average of that number over the training set, which is called empirical risk minimization. MSE (mean squared error) punishes large errors hardest, so one outlier can dominate it; MAE (mean absolute error) grows only linearly; Huber is squared near zero and linear beyond a threshold; log loss (cross-entropy) scores predicted probabilities; hinge loss scores classification margins. The common losses are not arbitrary: minimizing MSE gives the maximum-likelihood fit when the noise is Gaussian, and minimizing cross-entropy gives the maximum-likelihood fit of a softmax (categorical) model. Adding a penalty on the weights is the same as adding a prior, which is maximum a posteriori (MAP) estimation.
**Use this when:** choosing a loss for a regression or classification model, wondering why a model chases outliers, why cross-entropy is used instead of accuracy, or what "negative log-likelihood" means.
**Not this doc:** how the loss is minimized → `machine-learning/foundations/gradient-descent.md`; metrics for judging a finished model (precision, recall, ROC-AUC, the area under the receiver operating characteristic curve) → `machine-learning/evaluation/metrics-catalog.md`; the penalty terms in detail → `machine-learning/foundations/regularization.md`; full Bayesian inference → `machine-learning/probabilistic-ml/bayesian-inference.md`.

## Problem
The loss is the only thing training looks at, so it decides what "good" means. With MSE, one residual of 6 among residuals of 0.5, 0 and −1 supplies 96.6 % of the total loss, and a single corrupted label moved a fitted slope from 2.079 to 2.743 ✅[^15]. The quantity people care about in classification, the error rate, cannot be minimized directly by gradient methods: it has no useful derivatives, its derivative being zero or undefined everywhere ✅[^4] ✅[^3]. Without the probabilistic view, the menu of losses looks arbitrary and the choice is made by habit.

## Mental model
**Analogy:** a penalty schedule for late deliveries. **MSE** fines the square of the lateness, so one delivery 6 hours late costs more than thirty that are each an hour late. **MAE** fines each hour the same. **Huber** fines small delays by their square and big delays by the hour, so one disaster cannot dominate. **Log loss** fines a forecaster by how surprised they were: saying "1 % chance of rain" on a day it pours costs a lot. **Hinge** fines nothing for a delivery that arrived with time to spare, and starts fining as the margin shrinks.

**Artifact:** four residuals `r = y − ŷ` (truth minus prediction), one of them an outlier, scored by three regression losses; lab run (`machine-learning/lab-setup.md`), 2026-11-24, scikit-learn 1.9.1, PyTorch 2.15.0 ✅[^15]:

```text
residuals [ 0.5  0.  -1.   6. ]
MSE   by hand 9.3125  sklearn 9.3125
MAE   by hand 1.8750  sklearn 1.8750
Huber by hand 1.5312  torch 1.5312
share of total from the outlier: squared 0.966  absolute 0.8
```

## How it works

### Empirical risk minimization
What we want to minimize is the **risk**: the expected loss over the true data distribution ✅[^4]. That distribution is unknown, so training minimizes the **empirical risk** instead, the average loss over the `m` training examples, `(1/m) · Σᵢ L(f(xᵢ; θ), yᵢ)`, where `f(xᵢ; θ)` is the model's prediction for example `i` with parameters `θ`, `yᵢ` its label and `L` the per-example loss ✅[^4]. Training by minimizing this average is **empirical risk minimization**; it is prone to overfitting, because a high-capacity model can memorize the training set ✅[^4]. During optimization the loss is treated as a function of the parameters, with the training data held constant ✅[^3]. When the loss we care about cannot be optimized efficiently, a **surrogate loss** is minimized in its place: the negative log-likelihood of the correct class is the usual surrogate for the 0-1 loss (1 for a wrong class, 0 for a right one) ✅[^4]. A penalty term can be added to the average: scikit-learn's SGD (stochastic gradient descent) models minimize `E(w, b) = (1/n) · Σᵢ L(yᵢ, f(xᵢ)) + α · R(w)`, where `R` penalizes model complexity and `α > 0` sets its strength ✅[^8].

### Regression losses
For one example with residual `r = y − ŷ`:

| Loss | Per example | Numbers (`r = [0.5, 0, −1, 6]`) | Behaviour |
|---|---|---|---|
| Squared (L2); its mean is MSE | `r²` ✅[^1] | `(0.25 + 0 + 1 + 36) / 4 = 9.3125` ✅[^15] | Squaring makes large errors larger and errors below 1 smaller ✅[^1]; moves the model toward outliers ✅[^1] |
| Absolute (L1); its mean is MAE | `\|r\|` ✅[^1] | `7.5 / 4 = 1.875` ✅[^15] | More robust to outliers; same units as the label ✅[^1] |
| RMSE (root mean squared error) | `√MSE` over the set ✅[^1] | `√9.3125 = 3.05` | Back in the label's units, still skewed by large errors ✅[^1] |
| Huber, threshold `δ` | `½ r²` if `\|r\| ≤ δ`, else `δ · (\|r\| − ½ δ)` ✅[^8] ✅[^9] | `δ = 1`: `(0.125 + 0 + 0.5 + 5.5) / 4 = 1.53125` ✅[^15] | Less sensitive to outliers than MSE, smooth near 0 unlike L1 ✅[^9] |

Quantile regression at `q = 0.5`, whose pinball loss is half the absolute error, estimates the conditional **median** of `y`, while least squares estimates the conditional **mean** ✅[^13]; because that loss grows only linearly with the residual, it is much more robust to outliers ✅[^13].

### Classification losses
- **Log loss** (binary cross-entropy) for a label `y ∈ {0, 1}` and a predicted probability `p = P(y = 1)`: `−(y · log p + (1 − y) · log(1 − p))`, averaged over examples ✅[^2] ✅[^11]. Example: `p = 0.9` for a true 1 costs `−log 0.9 = 0.105`; `p = 0.6` for a true 0 costs `−log 0.4 = 0.916`.
- **Cross-entropy** for `q` classes: a **softmax** turns raw scores (logits) `o` into probabilities `ŷⱼ = exp(oⱼ) / Σₖ exp(oₖ)`, and the loss is `−Σⱼ yⱼ · log ŷⱼ` with `y` a one-hot vector (1 for the true class, 0 elsewhere), so only `−log ŷ_true` remains ✅[^6]. It is never below 0, and reaches 0 only for a certain, correct prediction ✅[^6]. Its gradient with respect to each logit is simply `softmax(o)ⱼ − yⱼ`, predicted probability minus the label ✅[^6]. Example: logits `[2.0, 0.5, −1.0]` with true class 0 give `ŷ₀ = 0.786` and a loss of `0.241`.
- **Hinge** for a label `y ∈ {−1, +1}` and a raw score `f(x)`: `max(0, 1 − y · f(x))` ✅[^8]. Correct predictions with a margin `y · f(x) ≥ 1` cost nothing; every mistake costs more than 1, so the summed hinge loss is an upper bound on the number of mistakes ✅[^12]. It is the loss of a linear support vector machine (SVM) ✅[^8].

### Maximum likelihood: where MSE and cross-entropy come from
The **likelihood** of parameters `θ` is the probability the model assigns to the observed data; **maximum likelihood estimation** (MLE) picks the `θ` that makes the data most probable ✅[^7].
1. **Write a probabilistic model.** For regression: `y = w·x + b + ε` with noise `ε ~ N(0, σ²)`, a Gaussian with mean 0 and variance `σ²` ✅[^5]. Each label then has the density `p(y | x) = exp(−(y − w·x − b)² / (2σ²)) / √(2πσ²)` ✅[^5]; with `w·x + b = 3`, `σ = 1` and an observed `y = 4`, that is `exp(−0.5) / √(2π) = 0.242`.
2. **Multiply over examples.** With examples drawn independently, the likelihood of the dataset is the product of the per-example probabilities ✅[^5] ✅[^7].
3. **Take the log and negate.** The log turns the product into a sum without moving the arg max, and avoids the numerical underflow of multiplying many small probabilities; minimizing the negative log-likelihood (NLL) is then the same problem ✅[^7].
4. **Read off the loss.** For the Gaussian model the NLL is `Σᵢ [½ log(2πσ²) + (yᵢ − w·xᵢ − b)² / (2σ²)]`. For a fixed `σ` the first term is a constant and the second is the squared error times `1/(2σ²)`, so the minimizing `w` and `b` do not depend on `σ`: minimizing MSE is maximum-likelihood estimation under additive Gaussian noise ✅[^5].
5. **The same recipe for classes.** A softmax model gives `P(y = j | x) = ŷⱼ`; the NLL of the dataset is `Σᵢ −log ŷ_true(i)`, which is exactly the cross-entropy loss above ✅[^6].
The Deep Learning book puts it generally: "Any loss consisting of a negative log-likelihood is a cross-entropy between the empirical distribution defined by the training set and the probability distribution defined by model." ✅[^7] MSE is the case of a Gaussian model ✅[^7].

### MAP: a prior becomes a penalty
**Maximum a posteriori** (MAP) estimation keeps a prior belief `p(θ)` about the parameters and maximizes `log p(data | θ) + log p(θ)` ✅[^7]. With a Gaussian prior on the weights, the `log p(θ)` term is proportional to the L2 penalty `λ·wᵀw` (weight decay), so MAP with a Gaussian prior is weight decay ✅[^7]; a Laplace prior gives the L1 penalty ✅[^16]. The prior lowers the variance of the estimate at the price of some bias ✅[^7]. How the penalties behave: `machine-learning/foundations/regularization.md`; priors and posteriors: `machine-learning/probabilistic-ml/bayesian-inference.md`.

## Worked example
One script checks every loss by hand against the library, then fits the same 50 points `y = 2x + 1 + ε`, `ε ~ N(0, 1.5²)`, twice: by least squares, and by maximizing the Gaussian likelihood with `σ` as a free third parameter, using SciPy's general-purpose minimizer (BFGS, the Broyden–Fletcher–Goldfarb–Shanno method). Core lines of the likelihood fit:

```python
def gaussian_nll(theta):                          # theta = (w, b, log sigma)
    w, b, log_s = theta; s2 = np.exp(2 * log_s)
    return np.sum(0.5 * np.log(2 * np.pi * s2) + (yv - w * x - b) ** 2 / (2 * s2))
mle = minimize(gaussian_nll, x0=[0.0, 0.0, 0.0], method="BFGS")
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-24, Python 3.13.7, numpy 2.5.5, scipy 1.18.1, scikit-learn 1.9.1, PyTorch 2.15.0 (on the CPU, the central processing unit), two runs identical ✅[^15]:

```text
residuals [ 0.5  0.  -1.   6. ]
MSE   by hand 9.3125  sklearn 9.3125
MAE   by hand 1.8750  sklearn 1.8750
Huber by hand 1.5312  torch 1.5312
share of total from the outlier: squared 0.966  absolute 0.8
log loss by hand 0.4149  sklearn 0.4149
confidently wrong (p=0 for a true 1): sklearn log loss 18.0218 (clipped, not inf)
hinge by hand 0.6000  sklearn 0.6000
cross-entropy as NLL 1.5755  torch CrossEntropyLoss 1.5755
least squares: w=2.078504 b=0.636207  MSE=2.235090
Gaussian MLE : w=2.078504 b=0.636207  sigma^2=2.235090
MSE (LinearRegression)    slope 2.743  (clean-data least squares slope 2.079)
Huber (HuberRegressor)    slope 2.123  (clean-data least squares slope 2.079)
MAE (QuantileRegressor)   slope 2.159  (clean-data least squares slope 2.079)
```

<details><summary>Full script (prints the output above)</summary>

```python
# Losses by hand vs library functions; MSE fit = Gaussian maximum-likelihood fit;
# cross-entropy = negative log-likelihood of a softmax model; outliers vs MSE/MAE/Huber.
import numpy as np
import torch
from scipy.optimize import minimize
from sklearn.linear_model import HuberRegressor, LinearRegression, QuantileRegressor
from sklearn.metrics import hinge_loss, log_loss, mean_absolute_error, mean_squared_error

# 1. Regression losses on four residuals r = y - y_hat (one of them an outlier).
y = np.array([3.0, 5.0, 2.0, 10.0]); y_hat = np.array([2.5, 5.0, 3.0, 4.0])
r = y - y_hat
d = 1.0                                           # Huber threshold delta
huber = np.where(np.abs(r) <= d, 0.5 * r**2, d * (np.abs(r) - 0.5 * d))
print("residuals", r)
print(f"MSE   by hand {np.mean(r**2):.4f}  sklearn {mean_squared_error(y, y_hat):.4f}")
print(f"MAE   by hand {np.mean(np.abs(r)):.4f}  sklearn {mean_absolute_error(y, y_hat):.4f}")
print(f"Huber by hand {huber.mean():.4f}  torch {torch.nn.HuberLoss(delta=d)(torch.tensor(y_hat), torch.tensor(y)).item():.4f}")
print("share of total from the outlier: squared", round(36 / np.sum(r**2), 3), " absolute", round(6 / np.sum(np.abs(r)), 3))

# 2. Classification losses on three examples.
p = np.array([0.9, 0.2, 0.6]); t = np.array([1, 0, 0])           # predicted P(y=1), true label
ll = -np.mean(t * np.log(p) + (1 - t) * np.log(1 - p))
print(f"log loss by hand {ll:.4f}  sklearn {log_loss(t, p):.4f}")
print(f"confidently wrong (p=0 for a true 1): sklearn log loss {log_loss([1, 0], [0.0, 0.0]):.4f} (clipped, not inf)")
s = np.array([2.0, -0.5, 0.3]); ypm = 2 * t - 1                  # raw scores, labels in {-1,+1}
print(f"hinge by hand {np.mean(np.maximum(0, 1 - ypm * s)):.4f}  sklearn {hinge_loss(ypm, s):.4f}")
logits = torch.tensor([[2.0, 0.5, -1.0], [0.1, 0.2, 3.0]]); cls = torch.tensor([0, 1])
nll = -torch.log_softmax(logits, dim=1)[torch.arange(2), cls].mean()
print(f"cross-entropy as NLL {nll.item():.4f}  torch CrossEntropyLoss {torch.nn.CrossEntropyLoss()(logits, cls).item():.4f}")

# 3. Least squares vs Gaussian maximum likelihood on the same data.
rng = np.random.default_rng(0)
x = rng.uniform(0, 10, 50); yv = 2.0 * x + 1.0 + rng.normal(0, 1.5, 50)
ols = LinearRegression().fit(x[:, None], yv)
def gaussian_nll(theta):                          # theta = (w, b, log sigma)
    w, b, log_s = theta; s2 = np.exp(2 * log_s)
    return np.sum(0.5 * np.log(2 * np.pi * s2) + (yv - w * x - b) ** 2 / (2 * s2))
mle = minimize(gaussian_nll, x0=[0.0, 0.0, 0.0], method="BFGS")
w, b, log_s = mle.x
print(f"least squares: w={ols.coef_[0]:.6f} b={ols.intercept_:.6f}  MSE={np.mean((yv - ols.predict(x[:, None]))**2):.6f}")
print(f"Gaussian MLE : w={w:.6f} b={b:.6f}  sigma^2={np.exp(2 * log_s):.6f}")

# 4. One gross outlier: which loss lets it move the fitted line?
y_out = yv.copy(); y_out[np.argmax(x)] += 60                     # corrupt one label by +60
for name, est in [("MSE (LinearRegression)", LinearRegression()),
                  ("Huber (HuberRegressor)", HuberRegressor()),
                  ("MAE (QuantileRegressor)", QuantileRegressor(quantile=0.5, alpha=0.0))]:
    est.fit(x[:, None], y_out)
    print(f"{name:25s} slope {est.coef_[0]:.3f}  (clean-data least squares slope {ols.coef_[0]:.3f})")
```

</details>

Reading it:
- **Lines 2–9:** every loss computed from its formula equals the library's value to 4 decimals ✅[^15], so the formulas in How it works are the ones scikit-learn and PyTorch implement. The cross-entropy line takes `−log_softmax` of the true class and gets PyTorch's `CrossEntropyLoss` exactly: cross-entropy is the softmax NLL ✅[^15] ✅[^10].
- **The two fit lines** are the heart of it: least squares and the Gaussian likelihood fit agree on `w = 2.078504` and `b = 0.636207` to all six printed decimals ✅[^15]. In this run the fitted noise variance `σ² = 2.235090` also equals the training MSE, the mean squared residual, to six decimals ✅[^15].
- **The last three lines** corrupt one label by +60. Least squares lets it pull the slope from 2.079 to 2.743; the Huber fit (default settings) stays at 2.123, and the median fit at 2.159 ✅[^15]. That is the outlier behaviour of the three losses ✅[^1] ✅[^13].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Predicted probability 0 for the true class | Loss is `−log 0 = ∞` by the formula ✅[^6]; scikit-learn's `log_loss` returns 18.0218 instead | It clips probabilities to `[eps, 1 − eps]` ✅[^11]; lab ✅[^15] |
| Softmax computed, then `log` taken separately | Can overflow or underflow for large logits | Exponentiating and taking logs of large numbers is the risk ✅[^6]; `CrossEntropyLoss` takes raw logits ✅[^10], `BCEWithLogitsLoss` fuses sigmoid and loss with the log-sum-exp trick for stability ✅[^14] |
| Hinge loss with labels 0/1 | Wrong values | The binary formula assumes labels `+1` and `−1` ✅[^12] |
| Huber or epsilon-insensitive threshold on a rescaled target | Robustness changes | With `SGDRegressor` the threshold depends on the target's scale ✅[^8]; `HuberRegressor` is scale-invariant ✅[^13] |
| Same loss name, different constants | Squared error written as `r²` ✅[^1] or `½ r²` ✅[^5]; Huber's `½ r²` ✅[^9] vs scikit-learn `HuberRegressor`'s `z²` ✅[^13] | A constant factor does not move the minimizer ✅[^7], but loss values and gradients scale with it |
| Sum instead of mean over a batch | Loss and gradient scale with batch size | Averaging decouples batch size from learning rate ✅[^2]; PyTorch's default `reduction` is `'mean'` ✅[^9] |
| NLL of a continuous `y` | Can be negative | Happens when the variable is real-valued ✅[^7] |
| Optimizing accuracy directly | No gradient signal | 0-1 loss has no useful derivatives; use a surrogate ✅[^4] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| MSE | Smooth optimization ✅[^1]; maximum likelihood under Gaussian noise ✅[^5] | One outlier can dominate: 96.6 % of the total in the lab ✅[^15] |
| MAE | Robust to outliers; interpretable as average error ✅[^1] | Estimates the median, not the mean ✅[^13] |
| Huber | Robust beyond `δ`, smooth near 0 ✅[^9] | One more hyperparameter, scale-dependent in some implementations ✅[^8] |
| Log loss / cross-entropy | Maximum likelihood; gradient is prediction minus label ✅[^6] | Unbounded for confident mistakes ✅[^6] |
| Hinge | Zero loss beyond the margin; the linear-SVM loss ✅[^8] | Works on decision scores, not probabilities ✅[^12] |

## Takeaways
- Choose the loss from the noise you expect: Gaussian-like noise → MSE, heavy outliers → Huber or MAE, class labels → cross-entropy. [rule-candidate]
- Pass raw logits to the framework's combined loss (`CrossEntropyLoss`, `BCEWithLogitsLoss`); never take `log` of a softmax you computed yourself. [rule-candidate]
- Read "minimize negative log-likelihood" as "pick the parameters that make the observed data most probable".
- A weight penalty is a prior: say which prior you mean when you add one.

## Verification status
- Verified: 85 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- [Linear regression: Loss (Machine Learning Crash Course)](https://developers.google.com/machine-learning/crash-course/linear-regression/loss?hl=en) — Google for Developers, 2026. Backs: L1, MAE, L2, MSE, RMSE definitions; squaring amplifies large errors; MSE vs MAE and outliers; when to choose each. [^1]
- [Logistic regression: Loss and regularization (Machine Learning Crash Course)](https://developers.google.com/machine-learning/crash-course/logistic-regression/loss-regularization?hl=en) — Google for Developers, living. Backs: log loss formula; mean log loss decouples batch size and learning rate. [^2]
- [Dive into Deep Learning, chapter 1: Introduction](https://d2l.ai/chapter_introduction/index.html) — Aston Zhang, Zachary C. Lipton, Mu Li, Alexander J. Smola, living. Backs: loss as a function of the parameters with the data fixed; error rate hard to optimize, surrogate objectives. [^3]
- [Deep Learning, chapter 8: Optimization for Training Deep Models](https://www.deeplearningbook.org/contents/optimization.html) — Ian Goodfellow, Yoshua Bengio, Aaron Courville, 2016. Backs: risk, empirical risk, empirical risk minimization and its overfitting, surrogate losses, 0-1 loss without useful derivatives. [^4]
- [Dive into Deep Learning, 3.1 Linear Regression](https://d2l.ai/chapter_linear-regression/linear-regression.html) — Aston Zhang et al., living. Backs: squared error with the ½ factor; Gaussian noise model; MSE minimization = maximum likelihood under additive Gaussian noise. [^5]
- [Dive into Deep Learning, 4.1 Softmax Regression](https://d2l.ai/chapter_linear-classification/softmax-regression.html) — Aston Zhang et al., living. Backs: softmax, one-hot labels, cross-entropy as NLL, loss bounded below by 0, `−log 0 = ∞`, gradient `softmax − y`, overflow warning. [^6]
- [Deep Learning, chapter 5: Machine Learning Basics](https://www.deeplearningbook.org/contents/ml.html) — Ian Goodfellow, Yoshua Bengio, Aaron Courville, 2016. Backs: MLE definition, log likelihood and underflow, NLL as cross-entropy (quoted), MSE as Gaussian cross-entropy, negative NLL for continuous data, MAP estimation, Gaussian prior = weight decay, variance-for-bias trade. [^7]
- [Stochastic Gradient Descent (User Guide 1.5)](https://scikit-learn.org/stable/modules/sgd.html) — scikit-learn developers, living (1.9.1). Backs: regularized training error `E(w, b)`, hinge, log, squared, Huber and epsilon-insensitive losses, losses as upper bounds on the 0-1 loss, threshold depends on target scale. [^8]
- [torch.nn.HuberLoss](https://docs.pytorch.org/docs/2.15/generated/torch.nn.HuberLoss.html) — PyTorch Foundation, 2026 (2.15). Backs: Huber formula with `delta`, less outlier-sensitive than MSE and smoother than L1, `reduction='mean'` default. [^9]
- [torch.nn.CrossEntropyLoss](https://docs.pytorch.org/docs/2.15/generated/torch.nn.CrossEntropyLoss.html) — PyTorch Foundation, 2026 (2.15). Backs: input is unnormalized logits; equivalent to `LogSoftmax` then `NLLLoss`. [^10]
- [sklearn.metrics.log_loss](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.log_loss.html) — scikit-learn developers, living (1.9.1). Backs: log loss as the NLL of a logistic model, the binary formula, clipping to `[eps, 1 − eps]`. [^11]
- [sklearn.metrics.hinge_loss](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.hinge_loss.html) — scikit-learn developers, living (1.9.1). Backs: labels `+1`/`−1`, margin, cumulated hinge loss bounds the number of mistakes. [^12]
- [Linear Models (User Guide 1.1)](https://scikit-learn.org/stable/modules/linear_model.html) — scikit-learn developers, living (1.9.1). Backs: `HuberRegressor` loss and scale invariance, quantile regression estimates the median and is robust to outliers. [^13]
- [torch.nn.BCEWithLogitsLoss](https://docs.pytorch.org/docs/2.15/generated/torch.nn.BCEWithLogitsLoss.html) — PyTorch Foundation, 2026 (2.15). Backs: sigmoid fused with binary cross-entropy is more numerically stable, via the log-sum-exp trick. [^14]
- `machine-learning/lab-setup.md` — the lab where the losses were checked against scikit-learn and PyTorch, the least-squares and Gaussian maximum-likelihood fits were compared, and the outlier fits ran on 2026-11-24. [^15]
- [Deep Learning, chapter 7: Regularization for Deep Learning](https://www.deeplearningbook.org/contents/regularization.html) — Ian Goodfellow, Yoshua Bengio, Aaron Courville, 2016. Backs: the L1 penalty as the log-prior of an isotropic Laplace distribution. [^16]

## Related
- `machine-learning/foundations/gradient-descent.md` — how the loss's gradient moves the parameters.
- `machine-learning/foundations/regularization.md` — the penalty term `α·R(w)` and its MAP reading.
- `machine-learning/foundations/generalization-and-overfitting.md` — why low training loss is not the goal.
- `machine-learning/foundations/math-notation-reference.md` — `log`, `exp`, softmax and log-sum-exp with numbers.
- `machine-learning/supervised-learning/logistic-regression.md` — the model that log loss trains.
- `machine-learning/supervised-learning/support-vector-machines.md` — the model that hinge loss trains.
- `machine-learning/probabilistic-ml/bayesian-inference.md` — MLE vs MAP vs the full posterior.
- `machine-learning/evaluation/probability-calibration.md` — whether predicted probabilities can be trusted.
- `machine-learning/transformers/pretraining-and-scaling-laws.md` — next-token cross-entropy and perplexity.
