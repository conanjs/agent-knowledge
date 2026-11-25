---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/probabilistic-ml
status: verified
applies-to: ["any"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [machine-learning, bayesian-inference, prior, likelihood, posterior, mle, map, beta-binomial, conjugate-prior, posterior-predictive]
---

# Bayesian inference: prior, likelihood, posterior; MLE vs MAP vs the full posterior

## Summary
**TL;DR:** Bayesian inference treats an unknown parameter as a random variable: a prior distribution states what is believed before the data, the likelihood says how probable the data are under each parameter value, and Bayes' rule multiplies the two and normalizes to give the posterior. MLE (maximum likelihood estimation) keeps only the likelihood's peak, MAP (maximum a posteriori) keeps the posterior's peak, and full Bayesian inference keeps the whole posterior and averages predictions over it. With a Beta prior on a coin's bias, the posterior is again a Beta whose parameters are the prior's plus the counted heads and tails.
**Use this when:** an estimate from little data looks too extreme (3 heads in 3 flips, so "tails is impossible"), you need an uncertainty range for a parameter, or you want to see why L2 regularization is a Gaussian prior.
**Not this doc:** MLE and why common losses are negative log-likelihoods → `machine-learning/foundations/loss-functions-and-maximum-likelihood.md`; the penalty view of ridge and lasso → `machine-learning/foundations/regularization.md`; Bayesian models of whole functions → `machine-learning/probabilistic-ml/gaussian-processes.md`.

## Problem
A point estimate from small data can be absurdly confident, and it hides how much data stood behind it. Three heads in three flips and thirty heads in thirty flips both give the MLE `P(heads) = 1.000`, a coin that can never land tails; yet with a uniform prior the central 95 % posterior interval is `[0.398, 0.994]` after 3 flips and `[0.888, 0.999]` after 30 ✅[^6]. A model that predicts with the single best parameter value throws that difference away; the Bayesian approach predicts with a full distribution over the parameter instead ✅[^1].

## Mental model
**Analogy:** a detective's board of suspects. Before any clue, each suspect has a pin of some size (the prior). Each clue scales every pin by how well that suspect explains the clue (the likelihood), and the pins are then resized to add up to 100 % (dividing by the evidence). The board after the clues is the posterior. MLE looks only at which suspect best explains the clues; MAP names the suspect with the biggest pin; full Bayesian inference keeps the board and bets in proportion to the pins. A suspect whose pin was removed before the investigation can never come back, whatever the clues.

**Artifact:** Bayes' rule by hand on three candidate coin biases after 3 heads in 3 flips. Lab run (`machine-learning/lab-setup.md`), 2026-11-24, numpy 2.5.5, two runs identical ✅[^6]:

```text
theta=0.25  prior=0.333  likelihood=0.0156  posterior=0.028
theta=0.50  prior=0.333  likelihood=0.1250  posterior=0.222
theta=0.75  prior=0.333  likelihood=0.4219  posterior=0.750
evidence P(data) = 0.1875
P(next flip is heads | data) = 0.681  (MLE would say 0.75)
prior ruling out 0.75 -> posterior [0.111, 0.889, 0.0]
```

<details><summary>Full script (prints the output above)</summary>

```python
import numpy as np

theta = np.array([0.25, 0.50, 0.75])          # three candidate coin biases, P(heads)
prior = np.array([1 / 3, 1 / 3, 1 / 3])       # no preference before any flip
likelihood = theta**3                          # P(3 heads in 3 flips | theta)
evidence = (prior * likelihood).sum()          # P(3 heads), averaged over the candidates
posterior = prior * likelihood / evidence      # Bayes' rule
for t, p, l, q in zip(theta, prior, likelihood, posterior):
    print(f"theta={t:.2f}  prior={p:.3f}  likelihood={l:.4f}  posterior={q:.3f}")
print(f"evidence P(data) = {evidence:.4f}")
print(f"P(next flip is heads | data) = {(posterior * theta).sum():.3f}  (MLE would say {theta[np.argmax(likelihood)]:.2f})")
zero = np.array([0.5, 0.5, 0.0])               # a prior that rules out theta = 0.75
print("prior ruling out 0.75 -> posterior", (zero * likelihood / (zero * likelihood).sum()).round(3).tolist())
```
</details>

## How it works
**Bayes' rule.** For data `D` and parameter `θ` ✅[^1]:

```text
p(θ | D) = p(D | θ) · p(θ) / p(D)
```

`p(θ)` is the prior, `p(D | θ)` the likelihood, `p(D)` the evidence (the likelihood averaged over the prior, a constant that makes the posterior sum or integrate to 1), and `p(θ | D)` the posterior. Worked numbers from the artifact, for `θ = 0.75`: `0.4219 · 0.333 / 0.1875 = 0.750` ✅[^6].

```
prior p(θ) ──┐
             ├─ multiply ─► p(D|θ)·p(θ) ─ divide by p(D) ─► posterior p(θ|D)
likelihood ──┘                                               │
p(D|θ)                                ┌──────────────────────┼─────────────────────┐
                                      ▼                      ▼                     ▼
                               MAP: its peak        posterior mean        predictive: average
                                                                          p(x_new|θ) over p(θ|D)
```

1. **Two views of θ:** a frequentist treats the true `θ` as fixed but unknown and the estimate as random, because it depends on the sampled data; a Bayesian treats the observed data as fixed and `θ` as uncertain, so it gets a probability distribution ✅[^1].
2. **Prior:** practitioners usually pick a broad, high-entropy prior, or one that prefers simpler solutions such as small coefficients ✅[^1]. As data arrive, the posterior usually loses entropy and concentrates on a few likely values ✅[^1].
3. **MLE:** `θ_MLE = argmax_θ p(D | θ)`. It is what maximizing the posterior gives when the prior is the same for every `θ` (a uniform prior), because then `p(θ)` and `p(D)` drop out of the argmax ✅[^2]. For a coin with `n_H` heads and `n_T` tails, `p(D | θ) = θ^n_H · (1 − θ)^n_T`, maximized at `n_H / (n_H + n_T)`: 9 heads in 13 flips gives `9/13` ✅[^2].
4. **MAP:** `θ_MAP = argmax_θ [log p(D | θ) + log p(θ)]`, the log-likelihood plus the log-prior ✅[^1]. It keeps a single point, which is tractable when the full posterior is not, and the prior's information lowers the estimate's variance at the price of more bias ✅[^1].
5. **Full posterior and prediction:** the predictive distribution of a new sample averages the model over the posterior, `p(x_new | D) = ∫ p(x_new | θ) · p(θ | D) dθ`, so remaining uncertainty about `θ` flows into the prediction ✅[^1]. In the artifact this gives `P(next heads) = 0.681`, below the 0.75 of the single most likely candidate ✅[^6].

### Beta–Binomial conjugacy
A prior is conjugate to a likelihood when the posterior has the prior's form, so updating means changing a few numbers ✅[^3]. The Beta distribution lives on `[0, 1]`, has density `f(x; a, b) = Γ(a + b) · x^(a−1) · (1 − x)^(b−1) / (Γ(a) · Γ(b))` for `a > 0, b > 0`, where `Γ` is the gamma function ✅[^4], and is the conjugate prior of the binomial ✅[^3]:

1. **Multiply:** prior `θ^(a−1) (1 − θ)^(b−1)` times binomial likelihood `θ^k (1 − θ)^(n−k)` (k heads in n flips) gives `θ^(a−1+k) (1 − θ)^(b−1+n−k)`, an unnormalized `Beta(a + k, b + n − k)` ✅[^3].
2. **Read the parameters as counts:** `a` relates to observed successes and `b` to failures ✅[^3]; `Beta(1, 1)` is the uniform prior ✅[^3]. Example: prior `Beta(2, 2)` and 7 heads in 10 flips give `Beta(9, 5)` ✅[^6].
3. **Summaries** of a posterior `Beta(a', b')`, checked numerically in the worked example ✅[^6]:
   ```text
   mean = a' / (a' + b')          MAP (mode) = (a' − 1) / (a' + b' − 2)          MLE = k / n
   ```
   For `Beta(9, 5)`: mean `9/14 = 0.643`, MAP `8/12 = 0.667`, against MLE `7/10 = 0.700`. For a coin, the posterior predictive `P(next heads)` equals the posterior mean ✅[^6]. The mode formula needs `a' ≥ 1` and `b' ≥ 1`, not both equal to 1: with a parameter below 1 the density grows without bound at 0 or 1, and `Beta(1, 1)` is flat with no single peak. Every posterior in the worked example meets this, including `Beta(4, 1)`, whose peak is at the edge `θ = 1`.

### MAP with a Gaussian prior is ridge regression
For linear regression with Gaussian noise of standard deviation `σ` and a Gaussian prior `w ~ N(0, τ² I)` on the weights, the negative log-posterior is, up to constants, `‖y − Xw‖² / (2σ²) + ‖w‖² / (2τ²)`. Multiplying by `2σ²` gives `‖y − Xw‖² + (σ²/τ²) · ‖w‖²`, the ridge objective `‖y − Xw‖² + alpha · ‖w‖²` ✅[^5] with `alpha = σ²/τ²`: a narrower prior (smaller `τ`) means a stronger penalty. The Deep Learning book states the same result: a Gaussian weight prior makes MAP equal to weight decay ✅[^1]. The penalty mechanics are in `machine-learning/foundations/regularization.md`. Lab run (`machine-learning/lab-setup.md`), 2026-11-24, scipy 1.18.1, scikit-learn 1.9.1, `σ = 1`, `τ = 0.5`, 20 rows, two runs identical ✅[^6]:

```text
MLE (least squares): [ 1.8477 -1.8716 -0.103 ]
MAP (optimizer)    : [ 1.541  -1.3268 -0.0804]
Ridge alpha=4       : [ 1.541  -1.3268 -0.0804]
```

<details><summary>Full script (prints the output above)</summary>

```python
import numpy as np
from scipy import optimize
from sklearn.linear_model import LinearRegression, Ridge

# MAP for linear regression with a Gaussian prior on the weights equals ridge
rng = np.random.default_rng(0)
n, sigma, tau = 20, 1.0, 0.5                 # noise std sigma, prior std tau
X = rng.normal(size=(n, 3))
y = X @ np.array([1.5, -2.0, 0.5]) + rng.normal(scale=sigma, size=n)

def neg_log_posterior(w):                    # -log p(y|X,w) - log p(w), constants dropped
    return ((y - X @ w) ** 2).sum() / (2 * sigma**2) + (w**2).sum() / (2 * tau**2)

w_map = optimize.minimize(neg_log_posterior, np.zeros(3), method="BFGS", options={"gtol": 1e-10}).x
w_ridge = Ridge(alpha=sigma**2 / tau**2, fit_intercept=False).fit(X, y).coef_
w_mle = LinearRegression(fit_intercept=False).fit(X, y).coef_
print("MLE (least squares):", w_mle.round(4))
print("MAP (optimizer)    :", w_map.round(4))
print(f"Ridge alpha={sigma**2 / tau**2:.0f}       :", w_ridge.round(4))
```
</details>

## Worked example
A coin, two priors (uniform `Beta(1, 1)` and a mild "probably fair" `Beta(2, 2)`), three datasets (3/3, 30/30 and 7/10 heads). Each posterior is computed twice: by the conjugate update, and by brute force on a grid of 200,001 values of `θ` (prior × likelihood, divided by its integral). Core lines:

```python
unnorm = stats.beta(a, b).pdf(grid) * grid**h * (1 - grid) ** (n - h)  # prior x likelihood
grid_post = unnorm / np.trapezoid(unnorm, grid)                         # divide by the evidence
post = stats.beta(a + h, b + n - h)                                     # conjugate update
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-24, scipy 1.18.1, numpy 2.5.5, two runs identical ✅[^6]:

```text
prior      data   posterior   MLE    MAP    mean   predictive  95% interval
Beta(1,1)   3/3   Beta(4,1)    1.000  1.000  0.800  0.800       [0.398, 0.994]
Beta(1,1)  30/30  Beta(31,1)   1.000  1.000  0.969  0.969       [0.888, 0.999]
Beta(1,1)   7/10  Beta(8,4)    0.700  0.700  0.667  0.667       [0.390, 0.891]
Beta(2,2)   3/3   Beta(5,2)    1.000  0.800  0.714  0.714       [0.359, 0.957]
Beta(2,2)  30/30  Beta(32,2)   1.000  0.969  0.941  0.941       [0.842, 0.993]
Beta(2,2)   7/10  Beta(9,5)    0.700  0.667  0.643  0.643       [0.386, 0.861]
grid posterior vs conjugate Beta: max gap 6.0e-08; grid argmax vs MAP formula: max gap 1.7e-06
```

Reading it:
- **Conjugacy holds:** the brute-force posterior matches `Beta(a + h, b + n − h)` to within `6.0e-08` everywhere, and the grid's peak matches the MAP formula to within the grid spacing.
- **Uniform prior:** MAP equals MLE in every row, as step 3 of How it works says; the mean and the predictive are `(h + 1)/(n + 2)`, so 3 heads in 3 flips predict heads with 0.800, not 1.000.
- **Mild prior after 3/3:** MLE 1.000, MAP 0.800, mean 0.714: the prior acts like extra flips, one pseudo-head and one pseudo-tail in the MAP (`(3 + 1)/(3 + 2) = 0.800`) and two of each in the mean (`(3 + 2)/(3 + 4) = 0.714`), almost as many as or more than the three real flips.
- **After 30/30:** the same prior moves the MAP only to 0.969 and the mean to 0.941; with more data all three estimates move towards each other and the interval narrows (`[0.842, 0.993]` vs `[0.359, 0.957]`).
- **Predictive = mean:** the numerically integrated `P(next heads | data)` equals the posterior mean in all six rows.

<details><summary>Full script (prints the output above)</summary>

```python
import numpy as np
from scipy import stats

# Coin bias theta. Prior Beta(a, b); data: h heads in n flips.
grid = np.linspace(0, 1, 200_001)
print("prior      data   posterior   MLE    MAP    mean   predictive  95% interval")
gaps, map_gaps = [], []
for a, b in [(1, 1), (2, 2)]:
    for h, n in [(3, 3), (30, 30), (7, 10)]:
        unnorm = stats.beta(a, b).pdf(grid) * grid**h * (1 - grid) ** (n - h)  # prior x likelihood
        grid_post = unnorm / np.trapezoid(unnorm, grid)          # divide by the evidence p(data)
        post = stats.beta(a + h, b + n - h)                       # conjugate update
        gaps.append(np.abs(grid_post - post.pdf(grid)).max())
        map_formula = (a + h - 1) / (a + b + n - 2)
        map_gaps.append(abs(grid[np.argmax(unnorm)] - map_formula))
        pred = np.trapezoid(grid * post.pdf(grid), grid)          # P(next flip = heads | data)
        lo, hi = post.interval(0.95)
        post_name = f"Beta({a + h},{b + n - h})"
        print(f"Beta({a},{b})  {h:2d}/{n:<2d}  {post_name:<11s}  {h / n:.3f}  {map_formula:.3f}"
              f"  {post.mean():.3f}  {pred:.3f}       [{lo:.3f}, {hi:.3f}]")
print(f"grid posterior vs conjugate Beta: max gap {max(gaps):.1e}; grid argmax vs MAP formula: max gap {max(map_gaps):.1e}")
```
</details>

The interval column is scipy's `interval(0.95)`, the range with equal probability mass on each side of the median ✅[^4].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Uniform prior | MAP = MLE | A constant prior drops out of the argmax ✅[^2]; lab rows 1–3 ✅[^6] |
| Prior gives zero probability to a value | Posterior stays zero there whatever the data | Posterior ∝ prior × likelihood; lab: `[0.111, 0.889, 0.0]` ✅[^6] |
| Few data points | Prior dominates (3/3 with `Beta(2, 2)`: MAP 0.800 instead of 1.000) | Pseudo-counts as large as the data ✅[^6] |
| Many data points | MLE, MAP and mean converge; the posterior narrows | The posterior concentrates as data arrive ✅[^1]; lab 30/30 rows ✅[^6] |
| Posterior has no closed form (most models) | Use MAP or an approximation | Most posterior operations are intractable for interesting models ✅[^1] |
| A regularizer that is not a log-prior (for example one that depends on the data) | No MAP interpretation | Not every penalty is the log of a probability distribution, and a prior may not depend on the data ✅[^1] |
| Multiplying many small likelihoods | Underflows to `0.0` in floating point | Work with log-likelihoods instead: `log` turns the product into a sum ✅[^2] |
| Choice of prior disputed | Results depend on a subjective input | The main criticism of the Bayesian approach ✅[^1] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| MLE | No prior to choose; consistent under appropriate conditions (the true distribution is in the model family and matches exactly one `θ`), and for many samples no consistent estimator has a lower parameter MSE (mean squared error) ✅[^1] | Overfits when examples are few, which regularization trades for bias ✅[^1]; lab: 3/3 → 1.000 ✅[^6] |
| MAP | Prior knowledge and lower variance from a single point estimate ✅[^1] | More bias ✅[^1]; no uncertainty about `θ` in the prediction ✅[^1] |
| Full posterior | Uncertainty flows into predictions; tends to protect against overfitting; often better with little data ✅[^1] | Usually high computational cost on large datasets ✅[^1] |
| Conjugate prior (Beta–Binomial) | Exact update by adding counts ✅[^3] | Only for matching prior–likelihood pairs (Beta with binomial, gamma with Poisson) ✅[^3] |

## Takeaways
- Read a prior `Beta(a, b)` as `a` imaginary heads and `b` imaginary tails added to the data (for the posterior mean; the MAP counts `a − 1` and `b − 1`); choose them as consciously as the data.
- Report an interval, not only a point, when the estimate rests on few observations. [rule-candidate]
- An L2 penalty is a Gaussian prior with `alpha = σ²/τ²`; choosing `alpha` is choosing how far the weights are believed to stray from zero.
- Never give a plausible value zero prior probability: no amount of data can bring it back.

## Verification status
- Verified: 48 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- [Deep Learning, chapter 5: Machine Learning Basics (sections 5.5.2 Properties of Maximum Likelihood, 5.6 Bayesian Statistics, 5.6.1 MAP)](https://www.deeplearningbook.org/contents/ml.html) — Goodfellow, Bengio, Courville, MIT Press, 2016. Backs: MLE consistency conditions and efficiency (Cramér-Rao), Bayes' rule over parameters, frequentist vs Bayesian views, broad priors, posterior concentration, posterior predictive integral, MAP formula, variance–bias trade, Gaussian prior = weight decay, non-MAP regularizers, criticism and cost. [^1]
- [Maximum Likelihood (Dive into Deep Learning, appendix 22.7)](https://d2l.ai/chapter_appendix-mathematics-for-deep-learning/maximum-likelihood.html) — Zhang, Lipton, Li, Smola, living. Backs: uniform prior turns MAP into MLE, coin likelihood and 9/13, log-likelihood against underflow. [^2]
- [Conjugate Priors (Think Bayes 2, chapter 18)](https://allendowney.github.io/ThinkBayes2/chap18.html) — Allen B. Downey, living. Backs: conjugacy, Beta as conjugate of the binomial, the update `a + k`, `b + n − k`, parameters as success and failure counts, `Beta(1, 1)` uniform. [^3]
- [scipy.stats.beta](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.beta.html) — SciPy developers, living (1.18). Backs: Beta density formula and parameter ranges, `interval` with equal areas around the median. [^4]
- [Ridge (API reference)](https://scikit-learn.org/stable/modules/generated/sklearn.linear_model.Ridge.html) — scikit-learn developers, living (1.9.1). Backs: ridge objective `‖y − Xw‖² + alpha · ‖w‖²`. [^5]
- `machine-learning/lab-setup.md` — the lab where the three-candidate update, the Beta–Binomial grid check and the MAP-equals-ridge fit ran on 2026-11-24. [^6]

## Related
- `machine-learning/foundations/loss-functions-and-maximum-likelihood.md` — MLE as the source of MSE and cross-entropy.
- `machine-learning/foundations/regularization.md` — L2 and L1 penalties, the MAP view's other side.
- `machine-learning/probabilistic-ml/naive-bayes.md` — Bayes' rule as a classifier; Laplace smoothing as pseudo-counts.
- `machine-learning/probabilistic-ml/gaussian-processes.md` — a prior over functions with an exact posterior.
- `machine-learning/reinforcement-learning/multi-armed-bandits.md` — Thompson sampling draws from Beta posteriors like these.
- `machine-learning/foundations/math-notation-reference.md` — notation for argmax, expectations and integrals.
- `machine-learning/probabilistic-ml/markov-chain-monte-carlo.md` — sampling a posterior with no closed form.
- `machine-learning/probabilistic-ml/variational-inference.md` — approximating a posterior with no closed form by optimization.
