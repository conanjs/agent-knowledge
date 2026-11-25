---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/causal-inference
status: verified
applies-to: ["scikit-learn 1.9.1", "numpy 2.5.5"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, causal-inference, observational-data, unconfoundedness, positivity, regression-adjustment, propensity-score, inverse-probability-weighting, matching, doubly-robust, aipw, double-machine-learning, cross-fitting]
---

# Estimating causal effects from observational data

## Summary
**TL;DR:** Without randomization, an effect can be computed from data only under three assumptions: consistency (the observed outcome is the potential outcome of the treatment actually received), unconfoundedness (given the measured covariates `X`, treatment is as good as random) and positivity (every kind of unit had some chance of either treatment). Then three families estimate the ATE (average treatment effect): regression adjustment models the outcome, IPW (inverse probability weighting) models the treatment through the propensity score, and the doubly robust AIPW (augmented IPW) combines both and stays right if either model is right. Propensities near 0 or 1 make the weights, and the variance, explode. With machine-learning models for those parts, double/debiased machine learning uses an orthogonal score (AIPW for the ATE) and cross-fitting: in the lab, random forests fitted and evaluated on the same rows gave 1.099 for a true ATE of 1.000, and 5-fold cross-fitting gave 0.984.
**Use this when:** you estimate the effect of something that was not randomized (a feature users opted into, a treatment doctors chose, a policy rolled out by region), choose between regression, propensity weighting, matching, doubly robust or double ML (machine learning), see extreme weights, or put a flexible ML model inside an effect estimate.
**Not this doc:** which variables belong in `X` → `machine-learning/causal-inference/causal-graphs-and-confounding.md`; randomized A/B tests → `machine-learning/causal-inference/potential-outcomes-and-experiments.md`; effects that vary with `X` (CATE, conditional average treatment effect) → `machine-learning/causal-inference/heterogeneous-treatment-effects.md`; how k-fold splits work → `machine-learning/evaluation/cross-validation-and-hyperparameter-search.md`.

## Problem
Logged data show who got a treatment and what happened, but the treated differ from the untreated before any treatment. In the lab's simulated data, the naive difference in means was 2.269 for a true ATE of 1.000; a linear regression that "controls for" all three covariates still gave 1.983, because the confounding runs through a squared term the linear model cannot represent; and when the treatment became almost deterministic for some units, even a correctly specified propensity model gave an IPW estimate whose standard deviation across datasets was 6.5 times larger ✅[^11]. Each estimator fails in its own way, and the analyst never sees the true model.

## Mental model
**Analogy:** estimating a town's average answer from a survey that over-sampled some neighbourhoods. One team predicts each household's answer from its features and averages the predictions (regression adjustment): right if the prediction model is right. Another team counts each answer `1/(chance that household was sampled)` times, so under-sampled neighbourhoods get their fair weight (IPW, built on Horvitz and Thompson's survey estimator ✅[^1]): right if the sampling chances are right. A doubly robust team starts from the predictions and adds the weighted average of the prediction errors: if the predictions were right the errors average to zero, and if the weights were right the correction repairs the predictions.

**Artifact:** 200 simulated datasets with a known ATE of 1.000, where treatment depends on `X0²` and the outcome too; "right" models include `X0²`, "wrong" ones are linear in `X`; printed by the full script in the Worked example; lab run (`machine-learning/lab-setup.md`), 2026-11-25, scikit-learn 1.9.1 ✅[^11]:

```text
200 simulated datasets of 2,000 units, true ATE = 1.000
estimator                                mean     sd
naive difference in means               2.269  0.126
regression adj., linear (wrong)         1.983  0.106
regression adj., with X0^2 (right)      1.000  0.052
IPW, propensity with X0^2 (right)       1.019  0.178
IPW, propensity linear (wrong)          1.998  0.118
DR: wrong outcome + right propensity    1.009  0.151
DR: right outcome + wrong propensity    1.000  0.053
DR: wrong outcome + wrong propensity    1.991  0.110
```

Each single-model estimator is right only with its model right; DR (doubly robust) is right when either model is, and wrong (1.991) only when both are.

## How it works
### Identification: the three assumptions
1. **Consistency**, one of the three identifying assumptions Kennedy lists ✅[^3]. The observed outcome is the potential outcome of the treatment received, `Y = T·Y(1) + (1 − T)·Y(0)` (the switching equation) ✅[^2]; Cunningham's framework assumes SUTVA (stable unit treatment value assumption) throughout: no interference between units and no hidden variation in the treatment ✅[^2].
2. **Unconfoundedness** (also called an ignorable treatment assignment, or selection on observables): `(Y(1), Y(0)) ⫫ T | X`, so units with the same `X` were in effect randomized ✅[^1]. It concerns potential outcomes and cannot be tested from data; you must defend it with knowledge of how treatment was assigned ✅[^1]. Cunningham calls these assumptions statistically equivalent to the backdoor criterion, so which variables `X` must contain is a graph question ✅[^1].
3. **Positivity** (common support): `0 < P(T = 1 | X) < 1` for every `X`, so that treated and untreated units exist at every covariate value ✅[^1]. Unlike unconfoundedness, it can be checked by counting units ✅[^1]. The double ML theory for the ATE assumes the stronger `ε ≤ m(X) ≤ 1 − ε` for some fixed `ε > 0` ✅[^5].
4. **Result.** Under consistency, positivity and no unmeasured confounding, `ATE = E[ E[Y | T=1, X] − E[Y | T=0, X] ]`: compare like with like at each `X`, then average over the distribution of `X` ✅[^3]. DoWhy's workflow names the steps model, identify, estimate, refute ✅[^10].

### Regression adjustment (model the outcome)
1. Fit `μ₁(x) = E[Y | T=1, X=x]` and `μ₀(x) = E[Y | T=0, X=x]`, then `ATE = mean_i(μ̂₁(X_i) − μ̂₀(X_i))`. With heterogeneous effects, a single regression needs treatment × covariate interactions ✅[^1]; the lab fits one regression per arm, which lets every coefficient differ between arms.
2. Its weakness is extrapolation: `μ̂₁` is evaluated at untreated units' covariates, which may lie far from any treated unit, and the "similarity" used is the model's ✅[^4]. Lab: linear per-arm models gave 1.983; adding `X0²` gave 1.000 ✅[^11].

### Propensity scores and IPW (model the treatment)
1. **Propensity score** `e(x) = P(T = 1 | X = x)`; Rosenbaum and Rubin (1983) showed that adjusting for `e(X)` alone removes all the bias that comes from differences in `X` (the propensity score theorem) ✅[^1]. Balancing property: `X ⫫ T | e(X)`, which is testable by comparing covariate means within propensity strata ✅[^1].
2. **Estimating it:** logit, probit or other ML classifiers, not ordinary least squares, which can predict outside `[0, 1]` ✅[^1]. scikit-learn's `LogisticRegression` applies regularization by default; `C=np.inf` gives the unpenalized model ✅[^7].
3. **IPW:** `ATE = (1/N) · Σ_i Y_i · (T_i − ê_i) / (ê_i · (1 − ê_i))`, which equals `mean(T·Y/ê − (1−T)·Y/(1−ê))` ✅[^1]. Example: a treated unit with `ê = 0.2` counts 5 times; an untreated unit with `ê = 0.9` counts `1/(1 − 0.9) = 10` times.
4. **Variants and checks.** The normalized (Hájek) estimator divides by the sum of the weights in each group and tends to be more stable ✅[^1]. The bootstrap is fine for IPW's standard error ✅[^1]. Plot the propensity distribution of treated and untreated units separately to see the overlap ✅[^1].
5. **Matching** pairs each treated unit with the control(s) with the nearest propensity; caliper matching drops treated units with no control within the caliper, which changes the target parameter away from the ATT (average treatment effect on the treated) ✅[^1]. King and Nielsen's critique targets propensity-score matching, not weighting, stratification or regression ✅[^1].

### Doubly robust estimation (AIPW)
1. **Formula:**

   ```text
   ATE_DR = mean_i [ μ̂₁(X_i) − μ̂₀(X_i)
                     + T_i · (Y_i − μ̂₁(X_i)) / ê(X_i)
                     − (1 − T_i) · (Y_i − μ̂₀(X_i)) / (1 − ê(X_i)) ]
   ```

   The regression prediction plus an inverse-propensity-weighted average of its residuals; it is the orthogonal score for the ATE in the double ML paper, based on Robins and Rotnitzky (1995) ✅[^5] and the "fit a direct regression, then debias it with inverse propensity weighting of the residual" construction in EconML ✅[^4]. Numeric example for one treated unit: `μ̂₁ = 3.0`, `μ̂₀ = 1.5`, `Y = 4.0`, `ê = 0.5` → `1.5 + (4.0 − 3.0)/0.5 = 3.5`.
2. **Why "doubly":** the error of the final estimate depends on the product of the outcome model's and the propensity model's errors, so the estimate is correct as long as one of the two is accurate ✅[^4]. If neither nuisance error converges slower than `n^(−1/4)`, the estimate reaches the parametric `n^(−1/2)` rate ✅[^4] ✅[^3]. Lab: 1.009 and 1.000 with one model right, 1.991 with both wrong ✅[^11].

### Positivity violations
1. **Mechanism:** a propensity near 0 for a treated unit or near 1 for an untreated one divides by a small number; IPW's variance is high even with the true propensity, especially where some treatment is quite unlikely ✅[^4]. Collapsing `X` into a propensity score does not create common support that the covariates lack ✅[^1].
2. **Lab:** multiplying the propensity coefficients by 4 put 18.8 % of propensities outside `[0.01, 0.99]` and raised the median largest weight from 17.5 to 149.3; the IPW standard deviation across datasets went from 0.178 to 1.157 and the AIPW one (right propensity, wrong linear outcome model, so the weights carry the correction) from 0.151 to 0.973 ✅[^11].
3. **Clipping or trimming** propensities stabilizes the estimate at the cost of bias: clipped to `[0.01, 0.99]`, the lab's IPW had standard deviation 0.350 but mean 1.496 ✅[^11]. The double ML paper trims propensities at 0.01 and 0.99 in its 401(k) application to limit extreme weights ✅[^5]. Under small overlap, EconML notes that its DR (doubly robust) learner has higher variance than its DML (double machine learning, residual-on-residual) estimator ✅[^4].

### Double/debiased machine learning and cross-fitting
1. **Nuisance functions** are the parts you must estimate but do not care about: the outcome regression and the propensity score, `η = (g, m)` ✅[^5]. ML estimates of them carry regularization bias, and plugging them into a naive estimating equation gives an estimate of `θ` (the effect) that converges slower than `1/√n` ✅[^5].
2. **Neyman orthogonality:** use a score whose expectation has zero derivative with respect to the nuisances at their true values, so small nuisance errors enter only through their product ✅[^5]. In the partially linear model `Y = θ·D + g(X) + U`, `D = m(X) + V` (`D` a treatment that may be continuous, `g` and `m` unknown functions, `U` and `V` disturbances with mean zero given the covariates), residualize both (`Ṽ = D − m̂(X)`, `W̃ = Y − ℓ̂(X)` with `ℓ(X) = E[Y | X]`) and regress `W̃` on `Ṽ` ✅[^5] ✅[^6]. Example: a unit with `D = 1.3`, `m̂(X) = 1.0`, `Y = 2.0`, `ℓ̂(X) = 1.85` contributes the residual pair `(0.3, 0.15)`, a point on a line of slope `θ = 0.5`.
3. **Overfitting bias:** when the same observations fit the nuisances and enter the score, the model errors and the estimation errors are correlated; the paper's contrived overfit example makes the remainder grow like `N^ε` without sample splitting ✅[^5]. Kennedy calls it "double-dipping": the same data used twice, for two tasks ✅[^3].
4. **Cross-fitting:** split the data into `K` folds; for each fold, fit the nuisances on the other `K − 1` folds and evaluate the score on the held-out fold; average the `K` estimates, which recovers full-sample efficiency ✅[^5]. That averaging is the paper's DML1; its DML2 solves one equation pooled over the `K` held-out folds, is the variant the authors generally recommend, and makes no difference for the ATE ✅[^5] (the lab pools the out-of-fold predictions). The authors found moderate `K` such as 4 or 5 to work better than `K = 2`; in their 401(k) application 5-fold cross-fitting gave lower standard errors than 2-fold for every method, though they note no general relationship between the number of folds and precision ✅[^5]. EconML's DML defaults to `cv=2` and suggests 5 or 6 for small datasets ✅[^6].
5. **In scikit-learn:** `KFold` yields `(train, test)` index pairs where each fold is used once for validation ✅[^9], and `cross_val_predict` returns, for every sample, the prediction of a model fitted on the folds that exclude it ✅[^8], which is exactly the residual the partially linear model needs.

## Worked example
The full lab script: the 200-dataset comparison above, the same 200 datasets with propensity coefficients ×4, and AIPW with random-forest nuisances (100 trees with the default `max_depth=None`, so nodes are split until the leaves are pure or hold fewer than `min_samples_split` samples ✅[^12]) on 30 more datasets, once with in-sample predictions and once with 5-fold cross-fitting. The cross-fitting loop:

```python
for fit_idx, pred_idx in KFold(5, shuffle=True, random_state=0).split(X):
    m1[pred_idx], m0[pred_idx], e[pred_idx] = nuisances(X, T, Y, fit_idx, pred_idx)
ate = aipw(T, Y, m1, m0, e)                       # every prediction is out-of-fold
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-25, scikit-learn 1.9.1, numpy 2.5.5, two runs identical; the script first prints the 10 lines of the Mental model artifact, then ✅[^11]:

```text
positivity: the same 200 datasets with propensity coefficients x1 and x4 (right models)
  x1: propensities outside [0.01, 0.99] 0.1%, median largest weight     17.5
      IPW                          mean   1.019  sd  0.178
      IPW clipped to [0.01, 0.99]  mean   1.021  sd  0.172
      DR (AIPW)                    mean   1.009  sd  0.151
  x4: propensities outside [0.01, 0.99] 18.8%, median largest weight    149.3
      IPW                          mean   1.289  sd  1.157
      IPW clipped to [0.01, 0.99]  mean   1.496  sd  0.350
      DR (AIPW)                    mean   1.245  sd  0.973
AIPW with random-forest nuisances, 30 datasets of 2,000 units, true ATE = 1.000
  plug-in mean(m1 - m0), in-sample   mean 1.100  sd 0.054
  AIPW, in-sample nuisances          mean 1.099  sd 0.055
  AIPW, 5-fold cross-fitting         mean 0.984  sd 0.116
  mean |Y - outcome model| on the observed arm: in-sample 0.327, out-of-fold 0.889
```

<details><summary>Full script (prints the output above)</summary>

```python
# Naive, regression adjustment, inverse probability weighting (IPW) and doubly robust (AIPW)
# estimates on confounded data with a known ATE; a positivity violation; AIPW with
# random-forest nuisances with and without cross-fitting (numpy + scikit-learn).
import numpy as np
from sklearn.linear_model import LinearRegression, LogisticRegression
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.model_selection import KFold
sigmoid = lambda z: 1 / (1 + np.exp(-z))

def simulate(n, seed, overlap=1.0):                   # same seed -> same units, any overlap
    rng = np.random.default_rng(seed)
    X = rng.normal(size=(n, 3))
    Q = X[:, 0] ** 2                                            # the confounding runs through X0^2
    e = sigmoid(overlap * (-0.4 + 0.4 * Q - 0.6 * X[:, 1] + 0.4 * X[:, 2]))   # true propensity
    T = rng.random(n) < e
    y0 = 1 + 2 * X[:, 0] + 1.5 * Q - X[:, 1] + rng.normal(size=n)
    tau = 1 + 0.5 * X[:, 1]                                     # individual effects; true ATE = 1.0
    return X, T, np.where(T, y0 + tau, y0)

def aipw(T, Y, m1, m0, e):                                      # doubly robust (AIPW) estimate
    return np.mean(m1 - m0 + T * (Y - m1) / e - (~T) * (Y - m0) / (1 - e))

def estimates(X, T, Y):
    lin, good = X, np.column_stack([X, X[:, 0] ** 2])          # wrong and right feature sets
    def mu(F):                                                  # one linear outcome model per arm
        m1 = LinearRegression().fit(F[T], Y[T]); m0 = LinearRegression().fit(F[~T], Y[~T])
        return m1.predict(F), m0.predict(F)
    def ps(F):                                                  # logistic propensity model
        return LogisticRegression(C=np.inf).fit(F, T).predict_proba(F)[:, 1]
    (l1, l0), (g1, g0), e_good, e_lin = mu(lin), mu(good), ps(good), ps(lin)
    return {"naive difference in means": Y[T].mean() - Y[~T].mean(),
            "regression adj., linear (wrong)": np.mean(l1 - l0),
            "regression adj., with X0^2 (right)": np.mean(g1 - g0),
            "IPW, propensity with X0^2 (right)": np.mean(T * Y / e_good - (~T) * Y / (1 - e_good)),
            "IPW, propensity linear (wrong)": np.mean(T * Y / e_lin - (~T) * Y / (1 - e_lin)),
            "DR: wrong outcome + right propensity": aipw(T, Y, l1, l0, e_good),
            "DR: right outcome + wrong propensity": aipw(T, Y, g1, g0, e_lin),
            "DR: wrong outcome + wrong propensity": aipw(T, Y, l1, l0, e_lin)}, e_good

print("200 simulated datasets of 2,000 units, true ATE = 1.000")
print(f"{'estimator':<38} {'mean':>6} {'sd':>6}")
runs = [estimates(*simulate(2000, seed))[0] for seed in range(200)]
for k in runs[0]:
    v = np.array([r[k] for r in runs])
    print(f"{k:<38} {v.mean():6.3f} {v.std():6.3f}")

print("positivity: the same 200 datasets with propensity coefficients x1 and x4 (right models)")
for overlap in (1.0, 4.0):
    ipw, ipw_clip, dr, extreme, wmax = [], [], [], [], []
    for seed in range(200):
        X, T, Y = simulate(2000, seed, overlap)
        est, e = estimates(X, T, Y)
        ec = np.clip(e, 0.01, 0.99)
        ipw.append(est["IPW, propensity with X0^2 (right)"]); dr.append(est["DR: wrong outcome + right propensity"])
        ipw_clip.append(np.mean(T * Y / ec - (~T) * Y / (1 - ec)))
        extreme.append(np.mean((e < 0.01) | (e > 0.99)))
        wmax.append(np.max(np.where(T, 1 / e, 1 / (1 - e))))
    print(f"  x{overlap:.0f}: propensities outside [0.01, 0.99] {np.mean(extreme):.1%}, median largest weight {np.median(wmax):8.1f}")
    for name, v in (("IPW", ipw), ("IPW clipped to [0.01, 0.99]", ipw_clip), ("DR (AIPW)", dr)):
        print(f"      {name:<28} mean {np.mean(v):7.3f}  sd {np.std(v):6.3f}")

print("AIPW with random-forest nuisances, 30 datasets of 2,000 units, true ATE = 1.000")
def nuisances(X, T, Y, fit_idx, pred_idx):
    rf = lambda: RandomForestRegressor(n_estimators=100, random_state=0, n_jobs=-1)
    tr1, tr0 = fit_idx[T[fit_idx]], fit_idx[~T[fit_idx]]
    m1 = rf().fit(X[tr1], Y[tr1]).predict(X[pred_idx])
    m0 = rf().fit(X[tr0], Y[tr0]).predict(X[pred_idx])
    clf = RandomForestClassifier(n_estimators=100, random_state=0, n_jobs=-1).fit(X[fit_idx], T[fit_idx])
    return m1, m0, np.clip(clf.predict_proba(X[pred_idx])[:, 1], 0.01, 0.99)
res = {"plug-in mean(m1 - m0), in-sample": [], "AIPW, in-sample nuisances": [], "AIPW, 5-fold cross-fitting": []}
resid = {"in-sample": [], "out-of-fold": []}                    # mean |Y - m_hat| on the observed arm
for seed in range(1000, 1030):
    X, T, Y = simulate(2000, seed)
    every = np.arange(len(Y))
    m1, m0, e = nuisances(X, T, Y, every, every)                # fit and predict on the same rows
    res["plug-in mean(m1 - m0), in-sample"].append(np.mean(m1 - m0))
    res["AIPW, in-sample nuisances"].append(aipw(T, Y, m1, m0, e))
    resid["in-sample"].append(np.mean(np.abs(np.where(T, Y - m1, Y - m0))))
    m1, m0, e = np.empty(len(Y)), np.empty(len(Y)), np.empty(len(Y))
    for fit_idx, pred_idx in KFold(5, shuffle=True, random_state=0).split(X):
        m1[pred_idx], m0[pred_idx], e[pred_idx] = nuisances(X, T, Y, fit_idx, pred_idx)
    res["AIPW, 5-fold cross-fitting"].append(aipw(T, Y, m1, m0, e))
    resid["out-of-fold"].append(np.mean(np.abs(np.where(T, Y - m1, Y - m0))))
for k, v in res.items():
    print(f"  {k:<34} mean {np.mean(v):.3f}  sd {np.std(v):.3f}")
print(f"  mean |Y - outcome model| on the observed arm: in-sample {np.mean(resid['in-sample']):.3f}, out-of-fold {np.mean(resid['out-of-fold']):.3f}")
```

</details>

Reading it, line by line:
- **Three assumptions hold, models differ:** the naive 2.269 is pure confounding; linear regression and linear-propensity IPW both stay near 2.0 because neither sees `X0²`; adding `X0²` to either model removes the bias.
- **Precision:** with the right features, regression adjustment has standard deviation 0.052 and IPW 0.178: weighting pays for not modelling the outcome. AIPW with a right propensity and a wrong outcome model (0.151) sits between them.
- **Positivity, ×1 vs ×4:** the same units and noise, only steeper treatment assignment. At ×4 almost a fifth of the propensities are extreme, the median dataset has a unit weighted about 149 times, and IPW's and AIPW's means drift (1.289, 1.245) with standard deviations above 0.97; clipping trades that variance for a bias of +0.496.
- **Cross-fitting:** fully grown forests partly memorize their training rows: the in-sample residuals average 0.327 against 0.889 out of fold. With shrunken residuals the AIPW correction almost vanishes (1.099 vs the plug-in 1.100, which carries the forests' smoothing bias of about +0.1). With out-of-fold predictions the correction works: 0.984, with a larger spread across datasets (0.116 vs 0.055).

## Edge cases
| Case | What happens | Why |
|---|---|---|
| A confounder is not measured | Every estimator here is biased, and no diagnostic in the data reveals it | Unconfoundedness is not testable ✅[^1]; DoWhy's refute step exists to probe it ✅[^10] |
| Propensities near 0 or 1 | Huge weights, unstable IPW and AIPW (lab standard deviation 1.157 vs 0.178) | Division by small probabilities ✅[^4]; lab ✅[^11] |
| Propensities clipped or units trimmed | Stable but biased (lab 1.496), or a different target population | Lab ✅[^11]; dropping units changes the estimand ✅[^1] |
| Propensity fitted by least squares | Predictions outside `[0, 1]` | Linear extrapolation ✅[^1] |
| Default `LogisticRegression` | Propensities shrunk by an L2 (squared-coefficient) penalty | Regularization is on by default ✅[^7] |
| Many discrete covariates, exact strata | Empty cells: strata with only treated or only untreated units | The curse of dimensionality breaks common support ✅[^1] |
| ML nuisances evaluated in-sample | AIPW collapses to the biased plug-in (lab 1.099) | Overfitting bias ✅[^5]; lab ✅[^11] |
| Both nuisance models wrong | DR is biased too (lab 1.991) | Its error is the product of two non-zero errors ✅[^4]; lab ✅[^11] |
| Standard error for matching | The bootstrap fails for matching; it is fine for IPW | Abadie and Imbens' result ✅[^1] |
| Target is the ATT, not the ATE | Different weights: untreated units weighted by `ê/(1 − ê)` | ATT form of IPW ✅[^1] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Regression adjustment | Lowest variance when the outcome model is right (lab 0.052) ✅[^11] | Model-based extrapolation; biased if misspecified ✅[^4] |
| IPW | Needs only the treatment model; no outcome model ✅[^1] | High variance, worst with poor overlap ✅[^4] |
| Propensity-score matching | Each treated unit gets comparable controls ✅[^1] | Researcher choices (calipers) change the estimand; criticized by King and Nielsen ✅[^1] |
| Doubly robust (AIPW) | Right if either model is right; product-rate errors ✅[^4] | Higher variance than DML under small overlap ✅[^4] |
| Double ML with cross-fitting | Flexible ML nuisance models with valid `√n` inference, provided their errors shrink fast enough that the product of the two stays below `1/√n` ✅[^5] | `K` times the model fits; still needs unconfoundedness and overlap ✅[^5] |

## Takeaways
- State the three assumptions in writing and defend unconfoundedness from how the treatment was assigned; the data cannot check it. [rule-candidate]
- Plot the propensity distributions of treated and untreated units before any weighting, and report the largest weight. [rule-candidate]
- Prefer a doubly robust estimator over regression alone or IPW alone. [rule-candidate]
- Whenever an ML model estimates an outcome or a propensity inside an effect estimate, cross-fit it (out-of-fold predictions). [rule-candidate]
- Clipping propensities is a bias–variance trade, not a fix; say which population the trimmed estimate describes.

## Verification status
- Verified: 79 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [Causal Inference: The Remix, ch. 5 "Unconfoundedness"](https://mixtape.scunning.com/05-causal_cross_sectional_designs) — Scott Cunningham, living (online 2nd edition). Backs: unconfoundedness and common support, propensity score theorem and balancing property, estimating propensities, IPW formulas, Hájek weights, bootstrap, matching and calipers, King and Nielsen, regression with interactions, curse of dimensionality, ATT weights. [^1]
- [Causal Inference: The Remix, ch. 3 "Potential Outcomes and Randomization"](https://mixtape.scunning.com/03-potential_outcomes_and_randomization) — Scott Cunningham, living. Backs: switching equation and SUTVA behind consistency. [^2]
- [Semiparametric Doubly Robust Targeted Double Machine Learning: A Review](https://ar5iv.labs.arxiv.org/html/2203.06469) — Edward H. Kennedy, 2022 (ar5iv HTML of arXiv:2203.06469). Backs: identification under positivity, consistency and no unmeasured confounding, the `n^(−1/4)` product condition, "double-dipping". [^3]
- [EconML: Doubly Robust Learning](https://www.pywhy.org/EconML/spec/estimation/dr.html) — PyWhy / EconML contributors, living (0.16.0 docs; library not installed in the lab). Backs: direct method extrapolation, IPS variance, the DR construction, product of errors, `n^(−1/4)`, higher variance under small overlap. [^4]
- [Double/Debiased Machine Learning for Treatment and Structural Parameters](https://ar5iv.labs.arxiv.org/html/1608.00060) — Chernozhukov, Chetverikov, Demirer, Duflo, Hansen, Newey, Robins, 2016 (ar5iv HTML of arXiv:1608.00060). Backs: nuisance parameters, regularization and overfitting bias, Neyman orthogonality, partialling out, cross-fitting, the ATE score, overlap condition, trimming at 0.01/0.99, 5-fold vs 2-fold. [^5]
- [EconML: Orthogonal/Double Machine Learning](https://www.pywhy.org/EconML/spec/estimation/dml.html) — PyWhy / EconML contributors, living (0.16.0 docs). Backs: residual-on-residual regression, `cv` default and advice. [^6]
- [sklearn.linear_model.LogisticRegression](https://scikit-learn.org/stable/modules/generated/sklearn.linear_model.LogisticRegression.html) — scikit-learn developers, 2026 (1.9.1 docs). Backs: default regularization, `C=np.inf` for no penalty. [^7]
- [sklearn.model_selection.cross_val_predict](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.cross_val_predict.html) — scikit-learn developers, 2026 (1.9.1 docs). Backs: out-of-fold predictions for every sample. [^8]
- [sklearn.model_selection.KFold](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.KFold.html) — scikit-learn developers, 2026 (1.9.1 docs). Backs: each fold used once for validation. [^9]
- [DoWhy: Estimating Causal Effects](https://www.pywhy.org/dowhy/v0.14/user_guide/causal_tasks/estimating_causal_effects/index.html) — PyWhy contributors, living (v0.14 docs; library not installed in the lab). Backs: model, identify, estimate, refute. [^10]
- `machine-learning/lab-setup.md` — the lab where the estimator comparison, positivity and cross-fitting script ran on 2026-11-25. [^11]
- [sklearn.ensemble.RandomForestRegressor](https://scikit-learn.org/stable/modules/generated/sklearn.ensemble.RandomForestRegressor.html) — scikit-learn developers, 2026 (1.9.1 docs). Backs: `max_depth=None` grows nodes until the leaves are pure or smaller than `min_samples_split`. [^12]

## Related
- `machine-learning/causal-inference/causal-graphs-and-confounding.md` — choosing `X`: the backdoor criterion and bad controls.
- `machine-learning/causal-inference/heterogeneous-treatment-effects.md` — the same nuisance models, used to estimate effects per unit.
- `machine-learning/evaluation/cross-validation-and-hyperparameter-search.md` — k-fold splits, which cross-fitting reuses for a different purpose.
- `machine-learning/evaluation/probability-calibration.md` — propensity scores are probabilities, and miscalibrated ones distort the weights.
- `machine-learning/supervised-learning/logistic-regression.md` — the default propensity model and its `C`.
- `machine-learning/supervised-learning/tree-ensembles.md` — random forests, the nuisance models of the lab run.
