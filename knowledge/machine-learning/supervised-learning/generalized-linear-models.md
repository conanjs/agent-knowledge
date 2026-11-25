---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/supervised-learning
status: verified
applies-to: ["scikit-learn 1.9.1", "statsmodels 0.15 docs (not run)"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, supervised-learning, generalized-linear-models, glm, poisson-regression, gamma-regression, tweedie, deviance, link-function, exposure, offset, irls]
---

# Generalized linear models: Poisson, Gamma and Tweedie regression

## Summary
**TL;DR:** A GLM (generalized linear model) keeps linear regression's weighted sum `η = b + w·x` but changes two things. An inverse link turns `η` into the predicted mean, `μ = exp(η)` for the log link, so a count or an amount can never be predicted negative. And squared error is replaced by the deviance of a distribution chosen for the target: Normal (plain linear regression), Bernoulli (logistic regression), Poisson for counts, Gamma for positive skewed amounts, Tweedie for totals that are often exactly 0. The distribution fixes how the noise grows with the mean (its variance function), and the deviance measures each miss against that noise. With a log link a coefficient is multiplicative (`exp(b)` is a rate ratio), and time at risk enters as an offset `log(exposure)`; in scikit-learn that means fitting `y / exposure` with `sample_weight=exposure`.
**Use this when:** the target is a count, a rate, a positive amount or a total with many zeros; least squares predicts negative values or misses the total; you need rate ratios; you pick between `PoissonRegressor`, `GammaRegressor` and `TweedieRegressor`, or read a deviance or a D² score.
**Not this doc:** least squares itself → `machine-learning/supervised-learning/linear-regression.md`; the Bernoulli GLM in detail → `machine-learning/supervised-learning/logistic-regression.md`; losses as maximum likelihood → `machine-learning/foundations/loss-functions-and-maximum-likelihood.md`; the L2 penalty (on the sum of squared weights) `alpha` → `machine-learning/foundations/regularization.md`; deviance metrics next to all the others → `machine-learning/evaluation/metrics-catalog.md`.

## Problem
Counts and amounts break least squares. In the lab, ordinary least squares (OLS) on claim counts predicted a negative count for 507 of 5,000 test policies; least squares on `log(y + 1)`, the usual patch, predicted 382.5 claims where 514 happened; and least squares on the log of claim sizes got the slope right but predicted an average claim of 870.9 where the real average was 1,155.7 ✅[^8]. The scikit-learn gallery reports the same failure on a real motor-insurance dataset: least squares seems to make a Ridge model badly calibrated; it tends to underestimate the risk and can even predict invalid negative frequencies ✅[^4]. A second problem is unequal observation time: a policy watched for one month and one watched for a year should not be compared by their raw claim counts.

## Mental model
**Analogy:** a linear model with an adapter on each end. On the output side, a unit converter (the link) turns an unbounded score into a valid mean: `exp` turns any score into a positive rate. On the error side, a ruler chosen for the data (the deviance) judges each miss by how noisy that size of target is expected to be: missing by 50 is nothing when the mean is 1,000 and the target is a claim amount, and a lot when the mean is 2 claims.

**Artifact:** the families, with each one's variance function `v(μ)` (the noise variance is proportional to it) and unit deviance `d(y, μ)` for one target `y` and predicted mean `μ` ✅[^2] ✅[^1]; the last column is `d(3, 2)` from the lab's `mean_tweedie_deviance` ✅[^8]:

| Distribution | Target | `v(μ)` | scikit-learn estimator (link) | `d(y, μ)` | `d(3, 2)` |
|---|---|---|---|---|---|
| Normal | any real | `1` | `LinearRegression`, `Ridge` (identity) | `(y − μ)²` | 1.0000 |
| Bernoulli | 0 or 1 | `μ(1 − μ)` | `LogisticRegression` (logit) | `2(y log(y/μ) + (1−y) log((1−y)/(1−μ)))` | — |
| Poisson | counts ≥ 0 | `μ` | `PoissonRegressor` (log) | `2(y log(y/μ) − y + μ)` | 0.4328 |
| Tweedie, `1 < p < 2` | ≥ 0 with exact zeros | `μ^p` | `TweedieRegressor(power=p)` (log) | see the metric docs ✅[^7] | 0.2857 (`p = 1.5`) |
| Gamma | > 0 | `μ²` | `GammaRegressor` (log) | `2(log(μ/y) + y/μ − 1)` | 0.1891 |

The same miss of 1 costs less as the variance function grows faster: the Gamma deviance only sees the ratio `y/μ`.

## How it works
### The three parts
1. **Linear predictor.** `η = b + w₁x₁ + … + w_m x_m` for `m` features, exactly as in linear regression. Example: `b = −2`, `w = (0.5, 0.7)`, `x = (1, 1)` gives `η = −0.8`.
2. **A distribution from the exponential dispersion family.** statsmodels writes the density as `f(y | θ, φ, w) = c(y, φ, w) · exp(w · (y·θ − b(θ)) / φ)`, with natural parameter `θ`, scale (dispersion) `φ`, an observation weight `w` (not the coefficients), a function `b(θ)` (not the intercept) and a normalizing term `c`; then the mean is `μ = b′(θ)` and the variance is `(φ/w) · v(μ)` ✅[^2]. So a GLM is determined by its link and its variance function alone ✅[^2]. The lab checks two variance functions: simulated Poisson data have variance/mean `0.999` and `1.001` at means 0.5 and 5, and Gamma (shape 2) data have variance/mean² `0.503` and `0.499` at means 500 and 5,000 ✅[^8].
3. **Link.** `μ = g⁻¹(η)`, where `g` is the link ✅[^2]; scikit-learn writes the prediction as `ŷ = h(Xw)` with `h` the inverse link ✅[^1]. Poisson, Gamma and inverse Gaussian do not support negative values, so they need an inverse link that keeps the mean positive, such as `h(Xw) = exp(Xw)` for `link='log'` ✅[^1]. Example: `η = −0.8` gives `μ = exp(−0.8) = 0.449` claims per year.
4. **Familiar special cases.** Logistic regression is the GLM with a Bernoulli distribution and a logit link ✅[^1]; Tweedie power 0 is the Normal distribution, for which `Ridge` or `ElasticNet` are generally more appropriate ✅[^1].

### Fitting
1. **Objective.** scikit-learn minimizes `(1/(2n)) · Σᵢ d(yᵢ, ŷᵢ) + (α/2) · ‖w‖²`, where `n` is the number of samples and `α` the L2 penalty strength; with sample weights the average becomes a weighted average ✅[^1].
2. **The penalty is on by default.** `PoissonRegressor`, `GammaRegressor` and `TweedieRegressor` all default to `alpha=1.0`; `alpha=0` is the unpenalized GLM and then the design matrix must have full column rank ✅[^5] ✅[^6] ✅[^9]. Standardize features first, so that the penalty treats them equally ✅[^1].
3. **Solvers.** The default `lbfgs` calls SciPy's L-BFGS-B (limited-memory Broyden–Fletcher–Goldfarb–Shanno with bounds); `newton-cholesky` takes Newton–Raphson steps (in arbitrary-precision arithmetic equivalent to iterated reweighted least squares), suits `n_samples ≫ n_features`, and needs memory quadratic in the number of features because it builds the Hessian ✅[^5]. statsmodels reports its fitting method as IRLS (iteratively reweighted least squares) ✅[^2].
4. **IRLS by hand (Poisson, log link).** Repeat: compute `η` and `μ = exp(η)`; form the working response `z = η + (y − μ)/μ`; solve a weighted least-squares problem for the coefficients with weights `μ`. statsmodels gives the general IRLS weight as `1 / (g′(μ)² · v(μ))` ✅[^10]; the log link has `g′(μ) = 1/μ`, so the Poisson weight is `μ² / μ = μ`. It equals the variance only for this pair: Gamma with a log link gets `μ² / μ² = 1`. The lab's 25-iteration loop gives the same coefficients as `PoissonRegressor` to four decimals ✅[^8].

### Exposure and offsets
1. **Model the rate, not the count.** Claims are modelled as events at a constant rate over the insured time, the exposure ✅[^4]: a policy insured for `e` years with yearly claim rate `λ` has expected count `e · λ = exp(log e + η)`. The term `log e` is an offset: added to the linear predictor with its coefficient fixed to 1. statsmodels' `GLM` takes `offset` directly, or `exposure`, whose log it adds to the linear prediction; `exposure` is only valid with the log link ✅[^3].
2. **scikit-learn has no offset.** The estimators' `fit(X, y, sample_weight=None)` takes none ✅[^5] ✅[^6] ✅[^9]. For counts per exposure it recommends a Poisson model with target `y = counts / exposure` and `sample_weight = exposure` ✅[^1], which the gallery example does ✅[^4]. The two are the same fit: `e · d(y/e, μ/e) = 2(y log(y/μ) − y + μ) = d(y, μ)` for the Poisson deviance. Lab: both sums are `2126.2062`, and the hand IRLS with the offset matches `PoissonRegressor` with weights ✅[^8].
3. **Reading coefficients.** With a log link, `exp(w_j)` multiplies the rate per unit of `x_j`. Lab: `exp(0.7056) = 2.025`, so urban policies have about twice the claim rate (true 2.014) ✅[^8].

### Choosing the distribution
1. **scikit-learn's guide:** counts or relative frequencies → Poisson with a log link; positive, skewed values → Gamma with a log link; heavier tails than Gamma → inverse Gaussian or higher Tweedie powers; probabilities → Bernoulli ✅[^1]. Its insurance example: claims per policyholder per year (Poisson), cost per claim (Gamma), total cost per policyholder per year (Tweedie, compound Poisson–Gamma) ✅[^1].
2. **Tweedie powers.** `TweedieRegressor(power=p)`: 0 Normal, 1 Poisson, between 1 and 2 compound Poisson–Gamma, 2 Gamma, 3 inverse Gaussian; no distribution exists for `0 < p < 1` ✅[^6]. `link='auto'` picks identity for `p ≤ 0` and log for `p > 0` ✅[^6]. `PoissonRegressor` is strictly equivalent to `TweedieRegressor(power=1, link='log')`, and `GammaRegressor` to `power=2` ✅[^1].
3. **Zeros.** Poisson and Tweedie with `p = 1.5` have a point mass at `y = 0`; Gamma does not, its target domain being strictly positive ✅[^1]. The lab's total cost per policy is exactly 0 for 90.2 % of policies ✅[^8].
4. **How the power weighs errors.** The Tweedie deviance is homogeneous of degree `2 − p`: scaling `y` and `ŷ` together leaves the Gamma deviance unchanged, scales the Poisson deviance linearly and the Normal one quadratically, so a higher power gives less weight to large absolute deviations ✅[^7]. scikit-learn's example: predictions 50 % too high (1.5 for 1, 150 for 100) cost 0.25 and 2500 at power 0, 0.189 and 18.9 at power 1, and 0.144 and 0.144 at power 2 ✅[^7].

### Evaluating
1. **Mean deviance.** `mean_tweedie_deviance` with power 0, 1 and 2 equals the mean squared error, `mean_poisson_deviance` and `mean_gamma_deviance` ✅[^7]. The gallery example notes that the Poisson deviance reflects both calibration and ranking, while MSE (mean squared error) and MAE (mean absolute error) are hard to interpret on counts with many zeros ✅[^4].
2. **`score()` is D².** It returns `D² = 1 − D(y, ŷ)/D_null`, the fraction of deviance explained, where `D_null` is the deviance of an intercept-only model; best 1.0, and it can be negative ✅[^5]. When cross-validating the Tweedie `power`, pass an explicit scorer, because the default score depends on the power itself ✅[^1].

## Worked example
20,000 simulated insurance policies: a risk score `x1 ~ N(0, 1)`, an urban flag `x2` (30 % urban), exposure uniform between 0.1 and 1 year, and claims `~ Poisson(exposure · exp(−2 + 0.5·x1 + 0.7·x2))`. The first 15,000 train, the last 5,000 test. Then claim sizes from a Gamma distribution with mean `exp(7 + 0.3·x1)`, and total cost per policy (the sum of its claim sizes). Core lines:

```python
z = (eta - off) + (y - mu) / mu                                    # IRLS working response
beta = np.linalg.solve(A.T @ (mu[:, None] * A), A.T @ (mu * z))    # weights = Poisson variance mu
glm = PoissonRegressor(alpha=0.0, solver="newton-cholesky", tol=1e-10, max_iter=1000)
glm.fit(X[tr], counts[tr] / exposure[tr], sample_weight=exposure[tr])
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-25, numpy 2.5.5, scikit-learn 1.9.1, two runs identical ✅[^8]:

```text
policies 20000, share with zero claims 0.902, mean claims per policy 0.1072
true coefs      b0=-2.0000 b1=0.5000 b2=0.7000
IRLS by hand    b0=-2.0095 b1=0.5044 b2=0.7056
PoissonRegressor b0=-2.0095 b1=0.5044 b2=0.7056
rate ratio for urban: exp(b2) = 2.025 (true 2.014)
unit deviance d(y=3, mu=2): normal 1.0000  poisson 0.4328  tweedie 1.5 0.2857  gamma 0.1891
mean Poisson deviance on test counts: by hand 0.425241  sklearn 0.425241
sum of deviances on counts 2126.2062 = exposure-weighted sum on frequencies 2126.2062
test: actual total claims 514
Poisson GLM, offset  predicted total    548.0  negative predictions    0  mean Poisson deviance 0.4252
OLS on counts        predicted total    540.8  negative predictions  507  mean Poisson deviance 0.4665
OLS on log(y+1)      predicted total    382.5  negative predictions  495  mean Poisson deviance 0.4664
train totals: actual 1631  Poisson GLM 1631.0000  OLS on log(y+1) 1152.7
Poisson at mean    0.5: variance / mean   = 0.999
Poisson at mean    5.0: variance / mean   = 1.001
Gamma(shape 2) at mean    500: variance / mean^2 = 0.503
Gamma(shape 2) at mean   5000: variance / mean^2 = 0.499
Gamma GLM b1=0.2961  OLS on log(y) b1=0.2985  (true 0.3000)
test mean claim size 1155.7  Gamma GLM 1141.3  exp(OLS on log y) 870.9
total cost: share of zeros 0.902; Tweedie(power=1.5) b1=0.8428 b2=0.6893  (true b1 0.5+0.3=0.8, b2 0.7)
total cost, train: actual 2,170,889  Tweedie 2,183,975 | test: actual 681,471  Tweedie 736,580
```

<details><summary>Full script (prints the output above)</summary>

```python
# Generalized linear models: Poisson regression with an exposure offset (by hand with IRLS and with
# scikit-learn) vs least squares; deviance by hand; Gamma for positive skewed targets; Tweedie for totals.
import numpy as np
from sklearn.linear_model import GammaRegressor, LinearRegression, PoissonRegressor, TweedieRegressor
from sklearn.metrics import mean_poisson_deviance, mean_tweedie_deviance

rng = np.random.default_rng(0)
n = 20_000
X = np.column_stack([rng.normal(size=n), rng.binomial(1, 0.3, size=n)])   # x1: risk score, x2: urban (0/1)
exposure = rng.uniform(0.1, 1.0, size=n)                                  # years insured
rate = np.exp(-2.0 + 0.5 * X[:, 0] + 0.7 * X[:, 1])                       # true claims per year
counts = rng.poisson(exposure * rate)
tr, te = np.arange(15_000), np.arange(15_000, n)
print(f"policies {n}, share with zero claims {np.mean(counts == 0):.3f}, mean claims per policy {counts.mean():.4f}")

# 1. IRLS (iteratively reweighted least squares) by hand, log link, offset = log(exposure)
A = np.column_stack([np.ones(n), X])[tr]; off = np.log(exposure[tr]); y = counts[tr]
beta = np.array([np.log(y.mean() / exposure[tr].mean()), 0.0, 0.0])
for _ in range(25):
    eta = A @ beta + off; mu = np.exp(eta)
    z = (eta - off) + (y - mu) / mu                                       # working response
    beta = np.linalg.solve(A.T @ (mu[:, None] * A), A.T @ (mu * z))       # weights = mu (Poisson variance)
glm = PoissonRegressor(alpha=0.0, solver="newton-cholesky", tol=1e-10, max_iter=1000)
glm.fit(X[tr], counts[tr] / exposure[tr], sample_weight=exposure[tr])  # frequency target, exposure weights
print("true coefs      b0=-2.0000 b1=0.5000 b2=0.7000")
print("IRLS by hand    b0={:.4f} b1={:.4f} b2={:.4f}".format(*beta))
print("PoissonRegressor b0={:.4f} b1={:.4f} b2={:.4f}".format(glm.intercept_, *glm.coef_))
print(f"rate ratio for urban: exp(b2) = {np.exp(glm.coef_[1]):.3f} (true {np.exp(0.7):.3f})")

def poisson_dev(y, mu):                               # unit deviance 2(y log(y/mu) - y + mu), y log y = 0 at y = 0
    t = np.where(y > 0, y * np.log(np.where(y > 0, y, 1) / mu), 0.0)
    return 2 * (t - y + mu)
print("unit deviance d(y=3, mu=2): " + "  ".join(f"{k} {mean_tweedie_deviance([3.0], [2.0], power=p):.4f}"
      for k, p in [("normal", 0), ("poisson", 1), ("tweedie 1.5", 1.5), ("gamma", 2)]))
mu_te = exposure[te] * glm.predict(X[te])
print(f"mean Poisson deviance on test counts: by hand {poisson_dev(counts[te], mu_te).mean():.6f}"
      f"  sklearn {mean_poisson_deviance(counts[te], mu_te):.6f}")
f_te = counts[te] / exposure[te]                      # same fit seen as frequencies with exposure weights
print(f"sum of deviances on counts {poisson_dev(counts[te], mu_te).sum():.4f}"
      f" = exposure-weighted sum on frequencies {np.sum(exposure[te] * poisson_dev(f_te, glm.predict(X[te]))):.4f}")

# 2. Least squares alternatives on the same counts
B = np.column_stack([X, exposure])
ols = LinearRegression().fit(B[tr], counts[tr])
logols = LinearRegression().fit(np.column_stack([X, np.log(exposure)])[tr], np.log1p(counts[tr]))
preds = {"Poisson GLM, offset": mu_te,
         "OLS on counts": ols.predict(B[te]),
         "OLS on log(y+1)": np.expm1(logols.predict(np.column_stack([X, np.log(exposure)])[te]))}
print(f"test: actual total claims {counts[te].sum()}")
for name, p in preds.items():
    ok = p > 0
    print(f"{name:<20} predicted total {p.sum():8.1f}  negative predictions {np.sum(~ok):4d}"
          f"  mean Poisson deviance {mean_poisson_deviance(counts[te][ok], p[ok]):.4f}")
print(f"train totals: actual {counts[tr].sum()}  Poisson GLM {np.sum(exposure[tr] * glm.predict(X[tr])):.4f}"
      f"  OLS on log(y+1) {np.expm1(logols.predict(np.column_stack([X, np.log(exposure)])[tr])).sum():.1f}")

# 3. Gamma: positive, right-skewed claim sizes with constant coefficient of variation
sev_mu = np.exp(7.0 + 0.3 * X[:, 0])                  # mean claim size, about 1,100
sev = rng.gamma(shape=2.0, scale=sev_mu / 2.0)        # shape 2: variance = mean^2 / 2
for m in (0.5, 5.0):                                  # variance functions: Poisson v(mu) = mu, Gamma v(mu) = mu^2
    s = rng.poisson(m, size=200_000)
    print(f"Poisson at mean {m:6.1f}: variance / mean   = {s.var() / s.mean():.3f}")
for m in (500.0, 5000.0):
    s = rng.gamma(2.0, m / 2.0, size=200_000)
    print(f"Gamma(shape 2) at mean {m:6.0f}: variance / mean^2 = {s.var() / s.mean() ** 2:.3f}")
gam = GammaRegressor(alpha=0.0, solver="newton-cholesky").fit(X[tr], sev[tr])
lg = LinearRegression().fit(X[tr], np.log(sev[tr]))
print(f"Gamma GLM b1={gam.coef_[0]:.4f}  OLS on log(y) b1={lg.coef_[0]:.4f}  (true 0.3000)")
print(f"test mean claim size {sev[te].mean():.1f}  Gamma GLM {gam.predict(X[te]).mean():.1f}"
      f"  exp(OLS on log y) {np.exp(lg.predict(X[te])).mean():.1f}")

# 4. Tweedie (1 < power < 2): total cost per policy, a point mass at 0 plus a positive skewed part
total = np.array([rng.gamma(2.0, sev_mu[i] / 2.0, size=k).sum() for i, k in enumerate(counts)])
tw = TweedieRegressor(power=1.5, link="log", alpha=0.0, solver="newton-cholesky", max_iter=1000)
tw.fit(X[tr], total[tr] / exposure[tr], sample_weight=exposure[tr])
print(f"total cost: share of zeros {np.mean(total == 0):.3f}; Tweedie(power=1.5) b1={tw.coef_[0]:.4f} b2={tw.coef_[1]:.4f}"
      f"  (true b1 0.5+0.3=0.8, b2 0.7)")
print(f"total cost, train: actual {total[tr].sum():,.0f}  Tweedie {np.sum(exposure[tr] * tw.predict(X[tr])):,.0f}"
      f" | test: actual {total[te].sum():,.0f}  Tweedie {np.sum(exposure[te] * tw.predict(X[te])):,.0f}")
```

</details>

Reading it, line by line:
- **Lines 2–5, the fit:** 25 hand-written IRLS steps and `PoissonRegressor` agree to four decimals, and both recover the true coefficients within about 0.01. The urban rate ratio `exp(b2) = 2.025` reads as "twice the claims per year" ✅[^8].
- **Line 6, unit deviances:** the same miss (`y = 3`, `μ = 2`) costs 1 under Normal, 0.43 under Poisson, 0.29 under Tweedie 1.5 and 0.19 under Gamma: the faster the variance grows with the mean, the cheaper an absolute miss ✅[^8].
- **Lines 7–8, deviance by hand:** the formula with `y log y = 0` at `y = 0` reproduces `mean_poisson_deviance` to six decimals, and the deviance of counts equals the exposure-weighted deviance of frequencies: this is why `sample_weight=exposure` is the offset ✅[^8].
- **Lines 9–12, least squares:** OLS on counts gets the test total roughly right (540.8) but predicts 507 negative counts and has a worse deviance (0.4665 against 0.4252, computed only where its predictions are positive). OLS on `log(y + 1)` under-predicts the total by a quarter: it fits the average of `log(y + 1)`, and `exp` of an average log is below the average ✅[^8].
- **Line 13, totals:** on the training data the Poisson GLM's predicted total equals the actual 1,631 exactly. With a log link and an intercept, the derivative of the Poisson deviance with respect to the intercept is proportional to `Σ(μᵢ − yᵢ)`, so at the optimum the predictions sum to the observations. The test total (548.0 against 514) comes from different policies and is not forced to match ✅[^8].
- **Lines 14–17, variance functions:** Poisson variance tracks the mean (ratio about 1 at means 0.5 and 5) and Gamma variance tracks the mean squared (ratio about 0.5 at means 500 and 5,000), as `v(μ) = μ` and `v(μ) = μ²` say ✅[^8] ✅[^2].
- **Lines 18–19, Gamma:** both the Gamma GLM and OLS on `log y` find the slope 0.3, but only the GLM predicts the mean claim size (1,141.3 against 1,155.7); `exp(OLS on log y)` predicts 870.9, 25 % low, because it estimates `exp(E[log y])`, not `E[y]` ✅[^8].
- **Lines 20–21, Tweedie:** one model on totals with 90.2 % zeros recovers the combined effect of `x1` on frequency and size (0.84 against `0.5 + 0.3 = 0.8`) and of `x2` (0.69 against 0.7). Its training total is close (2,183,975 against 2,170,889) but not exact: for `p = 1.5` the intercept derivative weights each `μᵢ − yᵢ` by `μᵢ^(1−p)`. The test total is 8 % high in this run ✅[^8].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Least squares on counts | Negative predictions; lab 507 of 5,000 ✅[^8]; gallery Ridge: 595 of 223,745 non-positive ✅[^4] | The identity link puts no floor at 0 |
| Least squares judged only by its total | The total can look right while groups are miscalibrated: the gallery's Ridge predicts 11,933.4 claims for 11,935 actual ✅[^4]. Its text says Ridge under-estimates the total by more than 3 %, which those printed totals contradict (1.9.1 page) ✅[^4] | Calibration is checked by comparing mean observed and mean predicted values in groups binned by predicted risk ✅[^4] |
| Least squares on `log(y + 1)` or `log y`, then `exp` back | Positive predictions, but totals and means too low; lab −26 % claims, −25 % mean claim size | Fits the mean of the log, not the log of the mean ✅[^8] |
| Default `alpha=1.0` | Coefficients shrunk toward 0 even when you wanted an unpenalized fit | L2 penalty on by default ✅[^5] ✅[^6] ✅[^9] |
| `alpha=0` with collinear features (for example a full one-hot set plus intercept) | No unique solution | Needs full column rank ✅[^5] |
| Gamma target with exact zeros | Outside the domain | Gamma needs `y > 0` ✅[^1]; use Poisson or Tweedie `1 < p < 2` |
| Deviance of a model that predicts `≤ 0` | Undefined for those rows; dropping them makes the score approximate | Gallery ignores non-positive predictions ✅[^4]; lab masked them too ✅[^8] |
| Counts observed over different times | Raw counts mislead | Offset `log(exposure)` ✅[^3], or `y/exposure` with exposure weights in scikit-learn ✅[^1] |
| `exposure` argument with a non-log link (statsmodels) | Not allowed | Exposure is only valid with the log link ✅[^3] |
| Cross-validating Tweedie `power` with `.score` | Scores of different powers are not comparable | Default score depends on `power`; pass an explicit scorer ✅[^1] |
| Many features, `newton-cholesky` | Memory grows with the square of the feature count | It builds the Hessian ✅[^5] |
| Counts more variable than their mean | A Poisson model's `v(μ) = μ` is too small | The negative binomial family has `v(μ) = μ + αμ²` in statsmodels ✅[^2] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Least squares on the raw target | Simple; closed form | Assumes constant variance; negative predictions; badly calibrated on counts ✅[^4] |
| Least squares on `log y` | Positive predictions; slope recovered in the lab ✅[^8] | Biased mean (lab −25 %) ✅[^8]; `log 0` needs a patch |
| Poisson GLM | Valid counts, rate ratios, exposure handled ✅[^1]; training total exact (lab) ✅[^8] | Assumes variance = mean ✅[^2] |
| Gamma GLM | Judges relative errors; scale-free deviance ✅[^7] | No zeros allowed ✅[^1] |
| Tweedie, `1 < p < 2` | Zeros and positive amounts in one model ✅[^1] | One more choice (`power`) and an explicit scorer to tune it ✅[^1] |
| Gradient-boosted trees with a Poisson loss | Better ranking and lower deviance in the gallery (0.575 against 0.594) ✅[^4] | Less interpretable than `exp(w)` rate ratios; see `machine-learning/supervised-learning/tree-ensembles.md` |

## Takeaways
- For counts, use a Poisson GLM with a log link and an exposure offset before reaching for least squares on transformed targets. [rule-candidate]
- In scikit-learn, express exposure as `y = counts / exposure` with `sample_weight = exposure`; there is no offset argument.
- Set `alpha` explicitly: the GLM estimators are penalized unless you pass `alpha=0`. [rule-candidate]
- Check predicted totals against actual totals; a log-transformed least-squares model fails this check even when its slopes look right.
- Compare GLMs with a deviance metric at a fixed power, not with each estimator's own `score`.

## Verification status
- Verified: 85 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [1.1. Linear Models, section 1.1.12 Generalized Linear Models (User Guide)](https://scikit-learn.org/stable/modules/linear_model.html) — scikit-learn developers, living (1.9.1). Backs: inverse link `h(Xw)`, unit deviances, the objective with `α/2 ‖w‖²`, weighted average, choice of distribution, insurance examples, point mass at zero, Tweedie power equivalences, standardize features, log link for positivity, `y/exposure` with exposure weights, explicit scorer for `power`, logistic regression as a Bernoulli GLM. [^1]
- [Generalized Linear Models (statsmodels User Guide)](https://www.statsmodels.org/stable/glm.html) — statsmodels developers, living (0.15 docs; cited as documentation, not run). Backs: exponential dispersion density, mean `b′(θ)`, variance `(φ/w)·v(μ)`, a GLM determined by link and variance function, the table of `v(μ)` per family including negative binomial and Tweedie, IRLS in the example output. [^2]
- [statsmodels.genmod.generalized_linear_model.GLM](https://www.statsmodels.org/stable/generated/statsmodels.genmod.generalized_linear_model.GLM.html) — statsmodels developers, living (0.15 docs; not run). Backs: `offset` and `exposure` arguments, log of exposure added with coefficient 1, exposure only with the log link. [^3]
- [Poisson regression and non-normal loss (scikit-learn gallery)](https://scikit-learn.org/stable/auto_examples/linear_model/plot_poisson_regression_non_normal_loss.html) — scikit-learn developers, living (1.9.1). Backs: frequency target with exposure weights, Ridge's non-positive predictions (595 of 223,745) and poor calibration ("seems to cause"), the printed claim totals (11,935 actual, Ridge 11,933.4) against the text's "more than 3 %", calibration checked in bins of predicted risk, deviance ignoring invalid predictions, Poisson deviance reflects calibration and ranking, MSE/MAE hard to interpret, gradient boosting deviance 0.575 vs 0.594. [^4]
- [sklearn.linear_model.PoissonRegressor](https://scikit-learn.org/stable/modules/generated/sklearn.linear_model.PoissonRegressor.html) — scikit-learn developers, living (1.9.1). Backs: log link, `alpha=1.0` default and full rank at `alpha=0`, `lbfgs` and `newton-cholesky` (IRLS-equivalent, Hessian memory), `score` = D², `fit(X, y, sample_weight=None)`. [^5]
- [sklearn.linear_model.TweedieRegressor](https://scikit-learn.org/stable/modules/generated/sklearn.linear_model.TweedieRegressor.html) — scikit-learn developers, living (1.9.1). Backs: power table, no distribution for `0 < p < 1`, `link='auto'`, `alpha=1.0` default, `fit` signature. [^6]
- [3.4. Metrics and scoring, Mean Poisson, Gamma, and Tweedie deviances (User Guide)](https://scikit-learn.org/stable/modules/model_evaluation.html) — scikit-learn developers, living (1.9.1). Backs: Tweedie deviance formula and special cases, homogeneity of degree `2 − p`, the 1.5-vs-1 and 150-vs-100 example. [^7]
- `machine-learning/lab-setup.md` — the lab where the IRLS, Poisson, least-squares, Gamma and Tweedie script ran on 2026-11-25. [^8]
- [sklearn.linear_model.GammaRegressor](https://scikit-learn.org/stable/modules/generated/sklearn.linear_model.GammaRegressor.html) — scikit-learn developers, living (1.9.1). Backs: log link, `alpha=1.0` default, `fit` signature. [^9]
- [statsmodels.genmod.families.family.Family.weights](https://www.statsmodels.org/stable/generated/statsmodels.genmod.families.family.Family.weights.html) — statsmodels developers, living (0.15 docs; not run). Backs: the IRLS weight `1 / (g′(μ)² · Var(μ))`. [^10]

## Related
- `machine-learning/supervised-learning/linear-regression.md` — the Normal, identity-link special case.
- `machine-learning/supervised-learning/logistic-regression.md` — the Bernoulli, logit-link special case.
- `machine-learning/foundations/loss-functions-and-maximum-likelihood.md` — why squared error and log loss are likelihoods.
- `machine-learning/foundations/regularization.md` — what the `alpha` penalty does.
- `machine-learning/evaluation/metrics-catalog.md` — deviance and D² metrics next to the others.
- `machine-learning/supervised-learning/tree-ensembles.md` — gradient boosting with a Poisson loss.
- `machine-learning/supervised-learning/survival-analysis.md` — exponential survival as a Poisson fit with exposure, and the Cox model.
