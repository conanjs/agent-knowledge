---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/unsupervised-learning
status: verified
applies-to: ["scikit-learn 1.9.1"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [machine-learning, unsupervised-learning, clustering, gaussian-mixture, gmm, em, expectation-maximization, responsibilities, bic, covariance-type, scikit-learn]
---

# Gaussian mixture models and the EM algorithm

## Summary
**TL;DR:** A Gaussian mixture model (GMM) assumes every point was drawn from one of k Gaussian "bells", bell k being picked with probability `w_k`. Because nobody tells you which bell produced which point, it is fitted with EM (expectation-maximization): the E-step computes, for every point, the probability that each bell produced it (its responsibilities); the M-step refits every bell to all points, weighted by those probabilities. The likelihood never goes down, and the fit stops at a local optimum. `covariance_type` sets the bells' allowed shapes, and BIC (Bayesian information criterion) picks the number of components and the shape.
**Use this when:** clusters overlap or are elliptical, you want a probability per cluster instead of a hard label, or you fit scikit-learn's `GaussianMixture` and must choose `n_components` and `covariance_type`.
**Not this doc:** the hard-assignment special case → `machine-learning/unsupervised-learning/k-means-clustering.md`; maximum likelihood itself → `machine-learning/foundations/loss-functions-and-maximum-likelihood.md`; priors and posteriors in general → `machine-learning/probabilistic-ml/bayesian-inference.md`.

## Problem
k-means gives every point exactly one cluster and treats every cluster as the same round shape. A point halfway between two groups gets a confident label, and an elongated or wide group is cut in the wrong place. In the lab, a point at x = 0.2 between a narrow group (mean −2.0) and a wide one (mean 2.6) is nearer the narrow group's mean, yet the fitted mixture gives it a 64 % probability of belonging to the wide one ✅[^7]. A mixture also brings its own trap: it always uses every component it is given, so the number of components must be chosen with held-out data or an information criterion ✅[^1].

## Mental model
**Analogy:** a jar of coins from two mints that you cannot tell apart by eye, only by weight. Guess each mint's average weight and spread. For every coin, ask "how likely is this weight under mint A, and under mint B?" and split the coin between them, say 70/30 (E-step). Then recompute each mint's average and spread, counting each coin by its share (M-step). Repeat until the guesses stop changing. A coin in the overlap stays split; a coin far in one mint's range goes fully to it.

**Artifact:** the model, and the E-step on one point. A mixture models the density ✅[^1]:
```text
p(x) = Σ_k w_k · N(x | μ_k, Σ_k)

w_k              mixing weight: share of points from component k (w_k ≥ 0, Σ_k w_k = 1)
μ_k, Σ_k         mean and covariance matrix of component k (in 1-D: mean μ_k, variance σ_k²)
N(x | μ, σ²)     Gaussian density, in 1-D: exp(−(x − μ)² / (2σ²)) / √(2πσ²)
r_k(x)           responsibility of component k for x = w_k·N(x | μ_k, Σ_k) / p(x)

x = 0.2 with the fitted parameters of the worked example
  component 1: w=0.649, μ=−2.018, σ=0.951   N=0.0276   w·N=0.0179
  component 2: w=0.351, μ= 2.609, σ=1.813   N=0.0910   w·N=0.0319
  r = 0.0179 / (0.0179 + 0.0319) = 0.36,  0.0319 / 0.0498 = 0.64
```
The arithmetic ran in the lab on 2026-11-24 ✅[^7]: the wide component wins although its mean is farther away, because its density falls off more slowly.

## How it works
### The EM loop in scikit-learn's `GaussianMixture`
1. **Initialize.** The default `init_params='kmeans'` sets the first responsibilities from a k-means run; `'k-means++'`, `'random'` and `'random_from_data'` are the alternatives ✅[^2]. `n_init=1` start by default; with more, the best result is kept ✅[^2].
2. **E-step (expectation).** For every sample and component, compute `log w_k + log N(x_i | μ_k, Σ_k)`, then subtract the log-sum-exp over components, which gives the log-responsibilities, so each point's responsibilities sum to 1 ✅[^3].
3. **M-step (maximization).** With `r_ik` the responsibility of component k for sample i, scikit-learn sets ✅[^4]:
   ```text
   N_k = Σ_i r_ik                                   soft count of component k
   w_k = N_k / Σ_j N_j                              new mixing weight
   μ_k = Σ_i r_ik · x_i / N_k                       responsibility-weighted mean
   Σ_k = Σ_i r_ik (x_i − μ_k)(x_i − μ_k)ᵀ / N_k + reg_covar · I   (full covariance)
   ```
   `reg_covar` (default `1e-6`) is added to the diagonal to keep covariances positive ✅[^2] ✅[^4].
4. **Check convergence.** The quantity tracked is the mean log-likelihood per sample, computed in the E-step; the loop stops when it changes by less than `tol=1e-3`, or after `max_iter=100` iterations with a `ConvergenceWarning` ✅[^2] ✅[^3] ✅[^4].
5. **Final E-step.** After the loop, one more E-step makes `fit_predict(X)` agree with `fit(X).predict(X)` ✅[^3]. `predict` returns the most probable component, `predict_proba` the responsibilities ✅[^1] ✅[^3].

### Why alternating works
EM maximizes a lower bound on the log-likelihood, the ELBO (evidence lower bound): `L = log p(v; θ) − KL(q(h|v) ‖ p(h|v; θ))`, where `v` is the observed data (the points), `h` the hidden variables (which component made each point), `θ` the parameters, `q` any distribution over `h`, and KL (Kullback–Leibler divergence) a non-negative measure of how far `q` is from the true posterior ✅[^5]. The E-step sets `q` to the posterior under the current parameters, which closes the gap; the M-step then maximizes `L` over `θ` with `q` held fixed. It is coordinate ascent on `L` ✅[^5]. Some model families allow an analytic M-step that jumps straight to the optimal `θ` for the current `q` ✅[^5]; the Gaussian mixture's M-step above is such a closed-form computation, not a gradient step ✅[^4]. Repeating is guaranteed to converge to a local optimum ✅[^1]. k-means is equivalent to EM with a small, all-equal, diagonal covariance ✅[^6].

### Covariance types and BIC
`covariance_type` constrains each component's shape ✅[^2]; the number of free parameters, which BIC charges for, follows from it, counted for k components in d dimensions ✅[^4]:

| `covariance_type` | Shape per component | Covariance parameters | k = 3, d = 2: total with means and weights |
|---|---|---|---|
| `full` (default) | Own general ellipse | `k·d(d+1)/2` | 9 + 6 + 2 = 17 |
| `tied` | One ellipse shared by all | `d(d+1)/2` | 3 + 6 + 2 = 11 |
| `diag` | Own axis-aligned ellipse | `k·d` | 6 + 6 + 2 = 14 |
| `spherical` | Own circle (one variance) | `k` | 3 + 6 + 2 = 11 |

Means add `k·d` and weights `k − 1` ✅[^4]. scikit-learn computes `BIC = −2·log L̂ + d_p·ln N`, where `L̂` is the maximized likelihood, `d_p` the number of free parameters and `N` the number of samples; lower is better ✅[^8] ✅[^2]. In code it is `-2 * score(X) * n + n_parameters * ln(n)`, with `score` the mean log-likelihood per sample ✅[^4]. BIC recovers the true number of components only asymptotically, with much data drawn i.i.d. (independent and identically distributed) from a Gaussian mixture ✅[^1].

Lab run (`machine-learning/lab-setup.md`), 2026-11-24, scikit-learn 1.9.1: 600 points, three elongated groups that share one stretch-and-rotate matrix, so the true model is `tied` with k = 3; BIC for k = 1..6 and every type, two runs identical ✅[^7]:
```text
k    spherical       diag       tied       full
1       6142.2     6074.1     6078.1     6078.1
2       5886.4     5320.9     4919.9     4750.6
3       5709.2     4646.8     4488.6     4509.9
4       5552.1     4600.3     4494.3     4542.5
5       5431.9     4585.2     4505.1     4575.1
6       5296.2     4596.3     4526.4     4605.7
lowest BIC: 4488.6 with k = 3 and covariance_type = tied
check, full k=3: -2*n*mean_loglik + p*ln(n) = 4509.9  (p = 17 free parameters, n = 600)  bic() = 4509.9
```
BIC chose the generating model: k = 3, `tied`. `full` at k = 3 fits as well but pays for 6 more parameters (4509.9 vs 4488.6). `spherical` is still falling at k = 6: circles can only cover ellipses by using more of them. The last line rebuilds `bic()` from its formula.

<details><summary>Full script (prints the output above)</summary>

```python
import numpy as np
from sklearn.mixture import GaussianMixture

rng = np.random.default_rng(1)
# three elongated 2-D groups: one shared stretch-and-rotate matrix, 200 points each
A = np.array([[2.0, 0.0], [1.2, 0.4]])
X = np.vstack([rng.normal(size=(200, 2)) @ A + c for c in ([0, 0], [6, 2], [0, 6])])

types = ("spherical", "diag", "tied", "full")
print("k  " + "".join(f"{t:>11s}" for t in types))
best = None
for k in range(1, 7):
    row = []
    for t in types:
        gm = GaussianMixture(k, covariance_type=t, n_init=3, random_state=0).fit(X)
        bic = gm.bic(X)
        row.append(bic)
        if best is None or bic < best[0]:
            best = (bic, k, t)
    print(f"{k}  " + "".join(f"{b:11.1f}" for b in row))
print("lowest BIC:", round(best[0], 1), "with k =", best[1], "and covariance_type =", best[2])

gm = GaussianMixture(3, covariance_type="full", n_init=3, random_state=0).fit(X)
n, k, d = X.shape[0], 3, 2
p = k * d * (d + 1) // 2 + k * d + (k - 1)   # covariances + means + free weights
print(f"check, full k=3: -2*n*mean_loglik + p*ln(n) = {-2 * n * gm.score(X) + p * np.log(n):.1f}"
      f"  (p = {p} free parameters, n = {n})  bic() = {gm.bic(X):.1f}")
```
</details>

## Worked example
EM written out in numpy for 300 one-dimensional points: 200 from N(−2, 1²) and 100 from N(3, 1.5²), starting from a poor guess (`w = (0.5, 0.5)`, `μ = (−1, 1)`, `σ = (1, 1)`), then `GaussianMixture` from the same start. Core loop:
```python
r, ll = e_step(x, w, mu, sd)              # responsibilities r[i, k] and mean log-likelihood
nk = r.sum(axis=0)                        # M-step: soft counts
w = nk / len(x)
mu = (r * x[:, None]).sum(axis=0) / nk
sd = np.sqrt((r * (x[:, None] - mu) ** 2).sum(axis=0) / nk)
```
Lab run (`machine-learning/lab-setup.md`), 2026-11-24, scikit-learn 1.9.1, scipy 1.18.1, two runs identical ✅[^7]:
```text
iter   1: mean log-lik=-3.165020  w=[0.642 0.358]  mu=[-2.007  2.503]  sd=[1.002 1.908]
iter   2: mean log-lik=-2.144804  w=[0.644 0.356]  mu=[-2.018  2.548]  sd=[0.958 1.875]
iter   3: mean log-lik=-2.142916  w=[0.644 0.356]  mu=[-2.023  2.563]  sd=[0.95  1.853]
iter   5: mean log-lik=-2.142731  w=[0.646 0.354]  mu=[-2.023  2.58 ]  sd=[0.949 1.836]
iter  10: mean log-lik=-2.142691  w=[0.648 0.352]  mu=[-2.02  2.6 ]  sd=[0.95 1.82]
iter  23: mean log-lik=-2.142687  w=[0.649 0.351]  mu=[-2.018  2.609]  sd=[0.951 1.813]
scikit-learn:  w = [0.649 0.351]  mu = [-2.018  2.609]  sd = [0.951 1.813]
x=-2.0: resp. by hand=[0.989 0.011]  predict_proba=[0.989 0.011]  nearest mean=0
x= 0.0: resp. by hand=[0.511 0.489]  predict_proba=[0.511 0.489]  nearest mean=0
x= 0.2: resp. by hand=[0.36 0.64]  predict_proba=[0.36 0.64]  nearest mean=0
x= 3.0: resp. by hand=[0. 1.]  predict_proba=[0. 1.]  nearest mean=1
```
Reading it:
- **Each line** shows the log-likelihood measured in that iteration's E-step (with the previous line's parameters), then the parameters after its M-step.
- **Iteration 1** does most of the work: one E-step and one M-step move the means from (−1, 1) to (−2.007, 2.503) and the weights from 50/50 to 64/36. The likelihood measured at the next E-step jumps from −3.165 to −2.145.
- **Iterations 2–23** only polish; the log-likelihood rises at every iteration and stops changing (below 1e-8) at iteration 23. The fitted second component (mean 2.609, spread 1.813) is near, not equal to, the recipe it was drawn from (mean 3, spread 1.5).
- **scikit-learn** from the same start reaches the same weights, means and spreads to three decimals, and its `predict_proba` equals the hand-written E-step.
- **The probe points:** x = 0.0 is split almost evenly (0.511 / 0.489). At x = 0.2 the nearest mean is still component 0, yet component 1 already has 64 %: the wider bell reaches farther. A hard nearest-mean rule (k-means) would have labelled it 0 with certainty.

<details><summary>Full script (prints the output above)</summary>

```python
import numpy as np
from scipy.stats import norm
from sklearn.mixture import GaussianMixture

rng = np.random.default_rng(0)
x = np.concatenate([rng.normal(-2, 1.0, 200), rng.normal(3, 1.5, 100)])   # 1-D, two groups
w, mu, sd = np.array([0.5, 0.5]), np.array([-1.0, 1.0]), np.array([1.0, 1.0])  # initial guess

def e_step(x, w, mu, sd):
    dens = w * norm.pdf(x[:, None], mu, sd)        # w_k * N(x_i | mu_k, sd_k^2), shape (n, 2)
    resp = dens / dens.sum(axis=1, keepdims=True)  # responsibilities: each row sums to 1
    return resp, np.log(dens.sum(axis=1)).mean()   # mean log-likelihood of the data

prev = -np.inf
for it in range(1, 500):
    r, ll = e_step(x, w, mu, sd)                   # E-step with the current parameters
    nk = r.sum(axis=0)                             # M-step: soft counts per component
    w = nk / len(x)
    mu = (r * x[:, None]).sum(axis=0) / nk
    sd = np.sqrt((r * (x[:, None] - mu) ** 2).sum(axis=0) / nk)
    if it in (1, 2, 3, 5, 10) or ll - prev < 1e-8:
        print(f"iter {it:3d}: mean log-lik={ll:.6f}  w={w.round(3)}  mu={mu.round(3)}  sd={sd.round(3)}")
    if ll - prev < 1e-8:
        break
    prev = ll

gm = GaussianMixture(2, weights_init=[0.5, 0.5], means_init=[[-1.0], [1.0]],
                     precisions_init=[[[1.0]], [[1.0]]], tol=1e-8, max_iter=500).fit(x[:, None])
print("scikit-learn:  w =", gm.weights_.round(3), " mu =", gm.means_.ravel().round(3),
      " sd =", np.sqrt(gm.covariances_.ravel()).round(3))
for x0 in (-2.0, 0.0, 0.2, 3.0):
    mine = e_step(np.array([x0]), w, mu, sd)[0][0]
    print(f"x={x0:4.1f}: resp. by hand={mine.round(3)}  predict_proba={gm.predict_proba([[x0]])[0].round(3)}"
          f"  nearest mean={np.abs(x0 - mu).argmin()}")
```
</details>

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Too few points for a component | Covariance estimation becomes difficult; EM can diverge to a solution of infinite likelihood | Documented limitation unless covariances are regularized ✅[^1]; `reg_covar` adds `1e-6` to the diagonal ✅[^2] |
| Too many components requested | All of them are used anyway | Plain EM always uses every component it has ✅[^1]; use BIC, held-out likelihood or `BayesianGaussianMixture` |
| `spherical` on elongated data | BIC keeps preferring more components | Lab: still falling at k = 6 ✅[^7] |
| Different starts, different answers | A local optimum, not the global one | EM converges to a local optimum ✅[^1]; raise `n_init`, the best lower bound is kept ✅[^2] |
| `max_iter` reached | `ConvergenceWarning`, `converged_ = False` | Raised when the best initialization did not converge ✅[^3] ✅[^2] |
| `warm_start=True` | `n_init` is ignored; each `fit` continues from the last solution | Documented behaviour ✅[^2] |
| `predict` vs `predict_proba` | Hard label vs responsibilities | `predict` takes the most probable component ✅[^1]; `predict_proba` returns exp of the log-responsibilities ✅[^3] |
| BIC on small samples | May not recover the true k | The guarantee is asymptotic and assumes the data really is a Gaussian mixture ✅[^1] |
| Weights pushed to zero wanted | Use `BayesianGaussianMixture` | A low `weight_concentration_prior` puts the weight on few components; only an upper bound on k is needed ✅[^1] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `full` covariance | Own general covariance per component ✅[^2] | Most parameters: `k·d(d+1)/2` for covariances ✅[^4] |
| `tied` | `d(d+1)/2` covariance parameters whatever k ✅[^4] | All components share one covariance matrix ✅[^2] |
| `diag` / `spherical` | `k·d` or `k` covariance parameters ✅[^4] | Diagonal or single-variance shapes only ✅[^2]; elongated data needs extra components (lab, `spherical`) ✅[^7] |
| `GaussianMixture` (EM) | Fastest algorithm for mixture models; does not bias means toward zero ✅[^1] | Uses every component it is given; singularities without regularization ✅[^1] |
| `BayesianGaussianMixture` (variational) | Switches off unneeded components; regularized ✅[^1] | Slower, one more hyperparameter, implicit biases ✅[^1] |

## Takeaways
- Use a mixture when membership is uncertain: `predict_proba` tells you which points are ambiguous; k-means cannot. [rule-candidate]
- Choose `n_components` and `covariance_type` together, by the lowest BIC over a grid, not by the highest likelihood. [rule-candidate]
- Run several starts (`n_init`) and check `converged_`; EM only promises a local optimum.
- The E-step is just Bayes' rule per point; the M-step is weighted means and covariances.

## Verification status
- Verified: 55 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- [Gaussian mixture models (User Guide §2.1)](https://scikit-learn.org/stable/modules/mixture.html) — scikit-learn developers, living (1.9.1 docs). Backs: mixture definition, EM guaranteed to converge to a local optimum, singularities, all components used, BIC asymptotic recovery, initialization methods, variational Bayesian mixture pros and cons. [^1]
- [sklearn.mixture.GaussianMixture](https://scikit-learn.org/stable/modules/generated/sklearn.mixture.GaussianMixture.html) — scikit-learn developers, living (1.9.1). Backs: covariance types, defaults (`tol`, `reg_covar`, `max_iter`, `n_init`, `init_params`), `warm_start`, `converged_`, lower bound, `bic()`. [^2]
- [sklearn/mixture/_base.py at 1.9.1](https://raw.githubusercontent.com/scikit-learn/scikit-learn/1.9.1/sklearn/mixture/_base.py) — scikit-learn source code, 2026. Backs: E-step in log space with log-sum-exp, the fit loop and its stopping test, the final E-step, `predict_proba`, `ConvergenceWarning`. [^3]
- [sklearn/mixture/_gaussian_mixture.py at 1.9.1](https://raw.githubusercontent.com/scikit-learn/scikit-learn/1.9.1/sklearn/mixture/_gaussian_mixture.py) — scikit-learn source code, 2026. Backs: M-step formulas, `reg_covar` on the diagonal, parameter counts per covariance type, `bic()` formula. [^4]
- [Approximate Inference (Deep Learning, chapter 19)](https://www.deeplearningbook.org/contents/inference.html) — Goodfellow, Bengio, Courville, 2016. Backs: ELBO definition, EM's E-step and M-step as coordinate ascent, analytic M-steps. [^5]
- [Clustering (User Guide §2.3)](https://scikit-learn.org/stable/modules/clustering.html) — scikit-learn developers, living. Backs: k-means as EM with a small, all-equal, diagonal covariance. [^6]
- `machine-learning/lab-setup.md` — the lab where EM ran by hand against `GaussianMixture`, the responsibilities at x = 0.2 were computed, and the BIC grid over k and covariance type ran on 2026-11-24. [^7]
- [Linear Models: AIC and BIC criteria (User Guide §1.1.3)](https://scikit-learn.org/stable/modules/linear_model.html) — scikit-learn developers, living. Backs: the BIC formula used by scikit-learn. [^8]

## Related
- `machine-learning/unsupervised-learning/k-means-clustering.md` — the hard-assignment, equal-spherical special case.
- `machine-learning/foundations/loss-functions-and-maximum-likelihood.md` — maximum likelihood, the objective EM climbs.
- `machine-learning/probabilistic-ml/bayesian-inference.md` — posteriors, the quantity the E-step computes.
- `machine-learning/generative-models/variational-autoencoders.md` — the same ELBO, optimized by gradient descent instead of closed-form steps.
- `machine-learning/unsupervised-learning/density-and-hierarchical-clustering.md` — when clusters are not Gaussian at all.
- `machine-learning/foundations/math-notation-reference.md` — log-sum-exp, Σ and E[·] used above.
- `machine-learning/probabilistic-ml/hidden-markov-models-and-kalman-filters.md` — EM for sequences: Baum–Welch for hidden Markov models.
- `machine-learning/probabilistic-ml/variational-inference.md` — variational inference, the general form of EM's E-step bound.
- `machine-learning/foundations/information-theory.md` — KL divergence and the ELBO's gap.
