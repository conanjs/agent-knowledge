---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/probabilistic-ml
status: verified
applies-to: ["scikit-learn 1.9.1"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [machine-learning, gaussian-process, kernel, rbf-kernel, posterior-predictive, marginal-likelihood, bayesian-regression, uncertainty, cholesky, scikit-learn]
---

# Gaussian processes: distributions over functions, kernels, posterior mean and variance, marginal likelihood

## Summary
**TL;DR:** A Gaussian process (GP) is a prior over functions: any finite set of function values is jointly Gaussian, with covariances given by a kernel that says how similar the outputs at two inputs should be. Conditioning that joint Gaussian on the training targets gives, in closed form, a predictive mean (a weighted sum of the training targets) and a predictive standard deviation that is small near the data and grows back to the prior's far from it. Kernel hyperparameters such as the length-scale are fitted by maximizing the log marginal likelihood, which balances fit against complexity. The price is an `n × n` matrix factorization: `O(n³)` time and `O(n²)` memory in the number of training points `n`.
**Use this when:** you need a regression model with honest error bars on small to medium data (hundreds to a few thousand points), want to encode smoothness or periodicity as a prior, or must decide where to measure next because uncertainty matters.
**Not this doc:** Bayes' rule, priors and posteriors for ordinary parameters → `machine-learning/probabilistic-ml/bayesian-inference.md`; kernels in support vector machines → `machine-learning/supervised-learning/support-vector-machines.md`; Gaussian mixture clustering → `machine-learning/unsupervised-learning/gaussian-mixtures-and-em.md`.

## Problem
Most regression models return one number per input and say nothing about how much to trust it, and the same model is just as confident far outside the training data as inside it. Fitting a fixed function family also forces a guess about its shape (line, polynomial of some degree) before seeing the data. A GP instead places a distribution over functions, keeps every function consistent with the data, and reports the spread: in the lab, the predictive standard deviation is 0.001 at a training input, 0.539 between two inputs and 1.000, the prior's own value, far away ✅[^7].

## Mental model
**Analogy:** a bedsheet held loosely in the wind. Before any data, it flutters around zero; how stiff it is (how far a tug at one point is felt) is the kernel's length-scale. Each training point is a pin that fixes the sheet's height at that spot. Near a pin the sheet barely moves; between pins it sags and sways a little; far from all pins it flutters exactly as freely as before. The predictive mean is the sheet's average position, and the predictive standard deviation is how much it still sways.

**Artifact:** posterior mean and standard deviation computed by hand with a Cholesky factorization and compared with scikit-learn, for five noise-free samples of `sin(x)` at `x = −4, −2, 0, 1, 3` and an RBF kernel with amplitude 1 and length-scale 1 held fixed. Lab run (`machine-learning/lab-setup.md`), 2026-11-24, scikit-learn 1.9.1, two runs identical ✅[^7]:

```text
x*= 1.0  true sin= 0.841  mean by hand= 0.841 sklearn= 0.841  std by hand=0.001 sklearn=0.001
x*= 2.0  true sin= 0.909  mean by hand= 0.650 sklearn= 0.650  std by hand=0.539 sklearn=0.539
x*= 8.0  true sin= 0.989  mean by hand=-0.000 sklearn=-0.000  std by hand=1.000 sklearn=1.000
```

At the pinned point `x = 1` the mean equals the data and the spread, 0.001, is about `√1e-6`, the square root of the noise term added to the kernel's diagonal. In the gap at `x = 2` the mean (0.650) undershoots the true 0.909 and says so with a spread of 0.539. At `x = 8`, five length-scales from the nearest pin, the GP is back to its prior: mean 0, spread 1.

<details><summary>Full script (prints the output above)</summary>

```python
import numpy as np
from sklearn.gaussian_process import GaussianProcessRegressor
from sklearn.gaussian_process.kernels import RBF, ConstantKernel

def rbf(A, B, amp2, ell):                     # k(x, x') = amp2 * exp(-|x - x'|^2 / (2 ell^2))
    return amp2 * np.exp(-((A[:, None, 0] - B[None, :, 0]) ** 2) / (2 * ell**2))

# posterior mean and std by hand vs scikit-learn, fixed kernel (no fitting of hyperparameters)
X = np.array([[-4.0], [-2.0], [0.0], [1.0], [3.0]])
y = np.sin(X).ravel()
amp2, ell, noise = 1.0, 1.0, 1e-6
Xs = np.array([[1.0], [2.0], [8.0]])          # a training input, a gap between inputs, far away
K = rbf(X, X, amp2, ell) + noise * np.eye(len(X))
L = np.linalg.cholesky(K)                     # K = L L^T, the O(n^3) step
alpha = np.linalg.solve(L.T, np.linalg.solve(L, y))
Ks = rbf(Xs, X, amp2, ell)
mean = Ks @ alpha
v = np.linalg.solve(L, Ks.T)
std = np.sqrt(amp2 - (v**2).sum(axis=0))
gpr = GaussianProcessRegressor(ConstantKernel(amp2, "fixed") * RBF(ell, "fixed"), alpha=noise).fit(X, y)
m_sk, s_sk = gpr.predict(Xs, return_std=True)
for i, x in enumerate(Xs[:, 0]):
    print(f"x*={x:4.1f}  true sin={np.sin(x):6.3f}  mean by hand={mean[i]:6.3f} sklearn={m_sk[i]:6.3f}"
          f"  std by hand={std[i]:.3f} sklearn={s_sk[i]:.3f}")
```
</details>

## How it works
1. **Definition:** a GP is a collection of random variables any finite number of which have a joint Gaussian distribution; `f ~ GP(m, k)` means that `f(x_1), …, f(x_n)` is Gaussian with mean vector `μ_i = m(x_i)` and covariance matrix `K_ij = k(x_i, x_j)` ✅[^5]. A linear model `f(x) = wᵀφ(x)` with Gaussian weights `w` and basis functions `φ` is a GP, and an RBF kernel corresponds to infinitely many basis functions ✅[^5]. The prior mean is usually set to 0 ✅[^3]; scikit-learn uses 0, or the training targets' mean with `normalize_y=True` ✅[^1].
2. **Kernel:** the RBF (radial basis function, or squared exponential) kernel is `k(x, x') = a² · exp(−‖x − x'‖² / (2ℓ²))`, where `a` is the amplitude (vertical scale) and `ℓ` the length-scale (how fast the function varies) ✅[^6]. At distance `‖x − x'‖ = ℓ` the covariance is `a² · e^(−0.5) = 0.61 · a²`, and d2l describes values farther apart than `ℓ` as nearly uncorrelated ✅[^6]; by the same formula the correlation is `e^(−2) = 0.14` at `2ℓ` and `e^(−4.5) = 0.011` at `3ℓ`. It is stationary (depends only on the distance) and infinitely differentiable, so its functions are very smooth; Matérn kernels add a parameter `ν` for rougher functions ✅[^1]. Kernels can be added or multiplied to combine their properties ✅[^1] ✅[^3].
3. **Joint distribution with the data:** observed targets are `y = f(X) + ε` with Gaussian noise of variance `σ²`, so the training targets and the test values `f*` are jointly Gaussian, with `K(X, X) + σ² I` as the training block and `K(X*, X)` as the cross-covariance ✅[^4] ✅[^3].
4. **Condition on the data** (Gaussians stay Gaussian under conditioning ✅[^3]) ✅[^4]:
   ```text
   mean*  = K(X*, X) · [K(X, X) + σ² I]⁻¹ · y
   cov*   = K(X*, X*) − K(X*, X) · [K(X, X) + σ² I]⁻¹ · K(X, X*)
   ```
   `X` are the training inputs, `y` the training targets, `X*` the test inputs, and `K(A, B)` the matrix of kernel values between the rows of `A` and `B`. The mean is a linear combination of the training targets weighted by the kernel; the variance does not use `y` at all, only how far `x*` is from the training inputs (and the hyperparameters, which were fitted on `y`) ✅[^4]. In the artifact, `K(X*, X)` for `x* = 8` is about `exp(−25/2) ≈ 4e-6` for its nearest pin, so the mean is about 0 and the variance stays at the prior's `a² = 1` ✅[^7].
5. **Fit the hyperparameters** `θ` (amplitude, length-scale, noise) by maximizing the log marginal likelihood (LML), the log probability of the targets with `f` integrated out ✅[^4] ✅[^1]:
   ```text
   log p(y | X, θ) = −½ · yᵀ [K_θ + σ² I]⁻¹ y   −   ½ · log det(K_θ + σ² I)   −   (n/2) · log 2π
                      └──── data fit ────┘        └─── complexity penalty ───┘
   ```
   The first term rewards fitting the data, the second penalizes flexible kernels, and the result tends to select the simplest fit consistent with the data (Occam's razor) ✅[^4]. (d2l gives this full form, with `σ² I` inside the determinant, in its derivation (equation 18.3.13); its earlier summary equation 18.3.4 writes the determinant term as `log|K_θ(X, X)|` without `σ² I` and folds the constant into `c` ✅[^4]. The full form reproduced scikit-learn's value to two decimals in the lab ✅[^7].) scikit-learn maximizes the LML with L-BFGS-B (a limited-memory quasi-Newton optimizer that respects bounds) starting from the kernel's initial values; because the LML can have several local optima, `n_restarts_optimizer` adds starts from random values within the bounds ✅[^1] ✅[^2].
6. **Cost:** solving the linear system and the log determinant for an `n × n` matrix, usually through a Cholesky factorization, takes `O(n³)` time and `O(n²)` memory, which historically limited exact GPs to fewer than about 10,000 training points ✅[^4].

Lab run (`machine-learning/lab-setup.md`), 2026-11-24, scikit-learn 1.9.1, Apple M2, exact fit with a fixed kernel (best of 3 timings per `n`; the `n` and kernel-matrix columns are deterministic, the timings are not) ✅[^7]:

```text
    n   kernel matrix   fit seconds (best of 3)   ratio to previous n
 1000        8 MB            0.023
 2000       32 MB            0.097                4.3x
 4000      128 MB            0.538                5.6x
 8000      512 MB            3.390                6.3x
```

The kernel matrix alone (`n × n` float64 values) grows 4× per doubling of `n`, from 8 MB to 512 MB: the `O(n²)` memory. Doubling `n` multiplied the fit time by 4.3 to 6.3 in this run; across six runs on a machine shared with other jobs the ratio per doubling ranged from 4.3× to 12.3×, with a median of 6.2×. Pure `n³` growth predicts 8× per doubling and `n²` growth 4×; the ratios of this run sit between the two, while the largest ratio seen across the six runs, 12.3×, lies above both, a sign of timing noise on a shared machine ✅[^7].

<details><summary>Full script (prints the output above)</summary>

```python
import time

import numpy as np
from sklearn.gaussian_process import GaussianProcessRegressor
from sklearn.gaussian_process.kernels import RBF

rng = np.random.default_rng(0)
prev = None
print("    n   kernel matrix   fit seconds (best of 3)   ratio to previous n")
for n in [1000, 2000, 4000, 8000]:
    X = rng.uniform(-5, 5, (n, 1))
    y = np.sin(X).ravel() + rng.normal(scale=0.1, size=n)
    best = float("inf")
    for _ in range(3):
        t = time.perf_counter()
        GaussianProcessRegressor(RBF(1.0), alpha=1e-2, optimizer=None).fit(X, y)  # one Cholesky, no tuning
        best = min(best, time.perf_counter() - t)
    ratio = "" if prev is None else f"{best / prev:.1f}x"
    print(f"{n:5d}   {n * n * 8 / 1e6:6.0f} MB       {best:10.3f}                {ratio}".rstrip())
    prev = best
```
</details>

## Worked example
Forty noisy samples of `sin(x)` (noise standard deviation 0.2) on `[−5, 5]`. The kernel `ConstantKernel × RBF + WhiteKernel` has three hyperparameters: amplitude `a²`, length-scale `ℓ` and noise level `σ²` (the `WhiteKernel` estimates the noise from the data ✅[^1]). The fit starts once from `ℓ = 0.1`, once from `ℓ = 10`, and once from `ℓ = 10` with 5 random restarts. Then, holding `a²` and `σ²` at their fitted values, the LML is split by hand into its two terms for three length-scales and compared with scikit-learn's `log_marginal_likelihood`. Lab run (`machine-learning/lab-setup.md`), 2026-11-24, scikit-learn 1.9.1, two runs identical ✅[^7]:

```text
start length_scale= 0.1: learned 0.914**2 * RBF(length_scale=1.69) + WhiteKernel(noise_level=0.0489)  LML=-10.45
start length_scale=10.0: learned 0.255**2 * RBF(length_scale=6.68) + WhiteKernel(noise_level=0.646)  LML=-49.03
start 10.0 + 5 restarts : learned 0.914**2 * RBF(length_scale=1.69) + WhiteKernel(noise_level=0.0489)  LML=-10.45
ell     data-fit  complexity  LML by hand  LML sklearn
 0.10    -13.27       11.92       -38.11       -38.11
 1.69    -20.00       46.30       -10.45       -10.45
10.00   -236.65       54.55      -218.85      -218.85
```

Reading it:
- **A good optimum:** from `ℓ = 0.1` the optimizer finds `ℓ = 1.69`, amplitude `0.914² ≈ 0.84` and noise level 0.0489, close to the true noise variance `0.2² = 0.04`.
- **A local optimum:** from `ℓ = 10` it stops at a very smooth function (`ℓ = 6.68`) that explains most of the signal as noise (noise level 0.646); its LML, −49.03, is far worse than −10.45. Five random restarts recover the good optimum.
- **Too wiggly (`ℓ = 0.1`):** best data-fit term (−13.27, it can follow the noise) but the largest complexity penalty (11.92 is the smallest value of `−½ log det`).
- **Too stiff (`ℓ = 10`):** smallest penalty (54.55) but a terrible fit (−236.65).
- **The learned `ℓ = 1.69`** gives up some fit (−20.00) for a much smaller penalty (46.30) and has the highest total, −10.45: Occam's razor in numbers. The by-hand total matches scikit-learn's in every row.

<details><summary>Full script (prints the output above)</summary>

```python
import numpy as np
from sklearn.gaussian_process import GaussianProcessRegressor
from sklearn.gaussian_process.kernels import RBF, ConstantKernel, WhiteKernel

def rbf(A, B, amp2, ell):                     # k(x, x') = amp2 * exp(-|x - x'|^2 / (2 ell^2))
    return amp2 * np.exp(-((A[:, None, 0] - B[None, :, 0]) ** 2) / (2 * ell**2))

# learn amplitude, length-scale and noise by maximizing the log marginal likelihood (LML)
rng = np.random.default_rng(0)
Xn = np.sort(rng.uniform(-5, 5, 40))[:, None]
yn = np.sin(Xn).ravel() + rng.normal(scale=0.2, size=40)
fits = {}
for start in [0.1, 10.0]:
    k0 = ConstantKernel(1.0) * RBF(start) + WhiteKernel(1.0)
    fits[start] = GaussianProcessRegressor(k0, random_state=0).fit(Xn, yn)
    print(f"start length_scale={start:4}: learned {fits[start].kernel_}  LML={fits[start].log_marginal_likelihood_value_:.2f}")
k0 = ConstantKernel(1.0) * RBF(10.0) + WhiteKernel(1.0)
r = GaussianProcessRegressor(k0, n_restarts_optimizer=5, random_state=0).fit(Xn, yn)
print(f"start 10.0 + 5 restarts : learned {r.kernel_}  LML={r.log_marginal_likelihood_value_:.2f}")
g = fits[0.1]
fit = g.kernel_.get_params()
a2, s2 = fit["k1__k1__constant_value"], fit["k2__noise_level"]
n = len(yn)
print("ell     data-fit  complexity  LML by hand  LML sklearn")
for ell_try in [0.1, fit["k1__k2__length_scale"], 10.0]:
    K = rbf(Xn, Xn, a2, ell_try) + s2 * np.eye(n)
    L = np.linalg.cholesky(K)
    a = np.linalg.solve(L.T, np.linalg.solve(L, yn))
    fit_term, complexity = -0.5 * yn @ a, -np.log(np.diag(L)).sum()   # -1/2 log|K| = -sum log diag(L)
    lml = fit_term + complexity - n / 2 * np.log(2 * np.pi)
    theta = np.log([a2, ell_try, s2])
    print(f"{ell_try:5.2f}  {fit_term:8.2f}  {complexity:10.2f}  {lml:11.2f}  {g.log_marginal_likelihood(theta):11.2f}")
```
</details>

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Prediction far from all training inputs | Mean returns to the prior mean (0), standard deviation to the prior's (lab: 1.000 at `x = 8`) | Uncertainty is small near the data and grows away from it ✅[^3]; lab ✅[^7] |
| Data with a trend, stationary kernel such as RBF | Extrapolation falls back to 0 outside the data | A stationary kernel cannot model global trends ✅[^3]; add a linear kernel ✅[^3] |
| Noise-free model (`σ² ≈ 0`) | The mean passes exactly through every training point, which can give needlessly complex fits | Conditioning forces the functions through the points ✅[^3] |
| Kernel matrix nearly singular | Cholesky fails or is unstable | Common for popular kernels; noise or a small "jitter" (about `1e-6`) on the diagonal improves the conditioning ✅[^4]; scikit-learn's `alpha` (default `1e-10`) serves this purpose ✅[^2] |
| `alpha` vs `WhiteKernel` for noise | `alpha` is a fixed noise variance added to the diagonal; `WhiteKernel` learns the noise level | ✅[^1] ✅[^2] |
| Optimizer stuck in a local optimum | Wrong length-scale, signal explained as noise (lab: LML −49.03 vs −10.45) | The LML can have several local optima; use `n_restarts_optimizer` ✅[^1] ✅[^7] |
| More than a few dozen input features | Efficiency drops | GPs lose efficiency in high-dimensional spaces ✅[^1] |
| Tens of thousands of training points | Exact fit too slow and memory-hungry | `O(n³)` time, `O(n²)` memory ✅[^4]; lab: 4.3–12.3× time per doubling across six runs ✅[^7] |
| Classification (`GaussianProcessClassifier`) | Posterior not Gaussian; approximated | Laplace approximation with a logistic link; scales cubically with the data ✅[^1] |
| Hyperparameters in `kernel.theta` | Values are log-transformed | Easier gradient-based optimization ✅[^1] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Exact GP regression | Closed-form posterior, no training loop besides the hyperparameters ✅[^4]; probabilistic predictions with error bars ✅[^1] | `O(n³)` / `O(n²)` ✅[^4]; uses the whole training set at prediction time (not sparse) ✅[^1] |
| RBF kernel | Very smooth functions; one interpretable length-scale ✅[^1] ✅[^6] | Too smooth for rough functions; stationary, no trends ✅[^1] ✅[^3] |
| Matérn kernel (`ν = 3/2` or `5/2`) | Once or twice differentiable functions ✅[^1] | An extra parameter `ν` to choose ✅[^1] |
| Learn the noise (`WhiteKernel`) | Noise level estimated from data ✅[^1] | One more hyperparameter; in the lab, a local optimum explained the signal as noise ✅[^7] |
| Scalable approximations (beyond scikit-learn) | d2l reports GPs scaled to millions of points with advanced methods ✅[^4] | Not covered in this doc |

## Takeaways
- Read a GP's standard deviation, not only its mean: it is the reason to use a GP. [rule-candidate]
- Fit kernel hyperparameters by marginal likelihood with several restarts, and check that the learned noise level is plausible. [rule-candidate]
- Normalize or centre the targets (`normalize_y=True`), because the prior mean is zero and predictions fall back to it away from the data.
- Above a few thousand points, measure fit time before committing: doubling the data multiplied it by 4.3 to 12.3 in the lab runs.

## Verification status
- Verified: 58 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- [Gaussian Processes (User Guide 1.7)](https://scikit-learn.org/stable/modules/gaussian_process.html) — scikit-learn developers, living (1.9.1). Backs: advantages and disadvantages, prior mean and `normalize_y`, LML maximization and restarts, `WhiteKernel`, RBF and Matérn kernels, kernel operators, log-transformed `theta`, classification via the Laplace approximation and its cubic scaling. [^1]
- [GaussianProcessRegressor (API reference)](https://scikit-learn.org/stable/modules/generated/sklearn.gaussian_process.GaussianProcessRegressor.html) — scikit-learn developers, living (1.9.1). Backs: `alpha` default and role, L-BFGS-B optimizer, `n_restarts_optimizer` behaviour. [^2]
- [A Visual Exploration of Gaussian Processes](https://distill.pub/2019/visual-exploration-gaussian-processes/) — Görtler, Kehlbeck, Deussen, Distill, 2019. Backs: closure under conditioning, zero prior mean, noise term, uncertainty growing away from data, functions forced through noise-free points, stationary kernels and trends, combining kernels. [^3]
- [Gaussian Process Inference (Dive into Deep Learning 18.3)](https://d2l.ai/chapter_gaussian-processes/gp-inference.html) — Zhang, Lipton, Li, Smola, living. Backs: joint distribution with noise, posterior mean and covariance, properties of mean and variance, LML and its fit and complexity terms, Occam's razor, `O(n³)` and `O(n²)` cost, 10,000-point history, jitter, scaling to millions. [^4]
- [Gaussian Process Priors (Dive into Deep Learning 18.2)](https://d2l.ai/chapter_gaussian-processes/gp-priors.html) — Zhang, Lipton, Li, Smola, living. Backs: definition of a GP, weight-space view, RBF as infinitely many basis functions. [^5]
- [Introduction to Gaussian Processes (Dive into Deep Learning 18.1)](https://d2l.ai/chapter_gaussian-processes/gp-intro.html) — Zhang, Lipton, Li, Smola, living. Backs: RBF amplitude and length-scale meaning, covariance at distance `ℓ`. [^6]
- `machine-learning/lab-setup.md` — the lab where the by-hand posterior, the marginal-likelihood fits and LML decomposition, and the fit-time scaling ran on 2026-11-24. [^7]

## Related
- `machine-learning/probabilistic-ml/bayesian-inference.md` — priors, posteriors and predictive distributions for parameters.
- `machine-learning/supervised-learning/support-vector-machines.md` — the kernel trick and the RBF kernel in another model.
- `machine-learning/supervised-learning/linear-regression.md` — the weight-space model a GP generalizes.
- `machine-learning/foundations/regularization.md` — scikit-learn's `alpha` noise term acts like a Tikhonov (ridge) penalty.
- `machine-learning/deep-learning/uncertainty-in-deep-learning.md` — uncertainty for neural networks: ensembles, MC dropout, Laplace.
