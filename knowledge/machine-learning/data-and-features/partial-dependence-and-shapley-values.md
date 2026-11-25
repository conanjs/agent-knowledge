---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/data-and-features
status: verified
applies-to: ["scikit-learn 1.9.1"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, interpretability, partial-dependence, pdp, ice, accumulated-local-effects, ale, shapley-values, shap, kernelshap, treeshap, interventional, observational, correlated-features, scikit-learn]
---

# Partial dependence, ICE, ALE and Shapley values

## Summary
**TL;DR:** A partial dependence plot (PDP) shows the model's average prediction as one feature is forced to each value across all rows; ICE (individual conditional expectation) curves show the same what-if for each row, so they reveal interactions a flat average hides. Both evaluate the model on combinations that may never occur when features are correlated; ALE (accumulated local effects) avoids this by averaging small local changes only over rows that really have nearby values. Shapley values split one prediction minus a baseline among the features, as the average extra value each feature adds over all coalitions of the others; they add up exactly (efficiency). SHAP (SHapley Additive exPlanations) is the family of fast estimators: KernelSHAP by weighted regression, TreeSHAP exactly for trees. The answer depends on the value function: "interventional" fills absent features from their marginal distribution and gives a feature the model ignores zero; "observational" conditions on the present features and can credit an ignored feature that is correlated with a used one. None of these is a causal effect in the world.
**Use this when:** you draw a PDP or ICE plot with `sklearn.inspection`, explain a single prediction with SHAP values, choose a background dataset or the interventional vs conditional option, or must explain why two correlated features share or do not share credit.
**Not this doc:** permutation and impurity importance for the whole model → `machine-learning/data-and-features/feature-importance-and-selection.md`; gradient saliency and integrated gradients for neural networks → `machine-learning/deep-learning/interpretability-and-attribution.md`; what a real-world causal effect is → `machine-learning/causal-inference/potential-outcomes-and-experiments.md`.

## Problem
"How does the model use feature `x0`?" and "why is this prediction 3.53 above the average?" have plausible but wrong answers. In the lab, a model of `y = 3·x0·x1 + x2` had a nearly flat PDP for `x0` (slope −0.11) even though the rows' ICE curves had mean slopes of +2.16 or −2.28 and shuffling `x0` cost 1.066 of R² (the coefficient of determination) ✅[^14]. With two nearly identical features, the PDP of the first rose by 4.14 over its range while the function's slope on the data was 1, because the PDP averaged over impossible rows where the model did something else ✅[^14]. And a model that never reads `x2` gave `x2` a Shapley value of 0.449 out of 0.999 under the observational value function, but 0.000 under the interventional one ✅[^14]. A team that reads any of these as "what would happen if we changed `x0`" acts on a property of the model and of the averaging, not of the world.

## Mental model
**Analogy:** splitting a shared taxi bill. Friends join the ride one at a time and each pays the extra cost their detour adds; that extra depends on who is already in the car, so the Shapley value averages it over every possible joining order, and the shares always add up to the whole fare (efficiency). The value function is the rule for "what if this friend had not come": put a random stranger from the city in their seat (interventional), or a stranger who looks like the friends already in the car (observational). The PDP is a different question: "what would the average fare be if everyone in the city lived at address `v`?", and ICE draws that what-if for each person separately.

**Artifact:** a model that reads only `x1`, `f(x) = x1`, with `corr(x1, x2) = 0.9`, explained at `x = (1, 1)` under both value functions; printed by the full script in the Worked example, lab run (`machine-learning/lab-setup.md`), 2026-11-25, scikit-learn 1.9.1 ✅[^14]:

```text
== 4. f(x) = x1 only, corr(x1, x2) = 0.9, explain x = (1, 1) ==
interventional: phi_x1 = 0.999  phi_x2 = 0.000  sum = 0.999
observational : phi_x1 = 0.550  phi_x2 = 0.449  sum = 0.999
```

By hand with two features, `φ1 = ½·[v({1}) − v(∅)] + ½·[v({1,2}) − v({2})]`. Observationally `v(∅) = 0`, `v({1}) = 1`, `v({2}) = E[X1 | X2 = 1] = 0.9`, `v({1,2}) = 1`, so `φ1 = ½·1 + ½·0.1 = 0.55` and `φ2 = ½·0.9 + ½·0 = 0.45`. Interventionally `v({2}) = E[X1] = 0`, so `φ2 = 0`.

## How it works
### Partial dependence and ICE
1. **Definition:** for features of interest `S` and the rest `C`, `pd_S(x_S) = E_{X_C}[f(x_S, X_C)]`, the expected prediction with `x_S` fixed and the other features drawn from their own distribution ✅[^1].
2. **Estimate ("brute"):** `pd_S(x_S) ≈ (1/n)·Σ_i f(x_S, x_C^(i))`, with `x_C^(i)` the other features of row `i` of `n`: copy the dataset, overwrite the feature with the grid value, predict, average ✅[^1]. Example: `f = 3·x0·x1` at `x0 = 0.5` over three rows with `x1 = +1, −1, +1` gives `(1.5 − 1.5 + 1.5)/3 = 0.5`.
3. **ICE:** each term `f(x_S, x_C^(i))`, drawn as a curve over the grid, is one row's ICE line; the PDP is the average of the ICE lines ✅[^1]. ICE supports one feature at a time and only the brute method ✅[^1]; centring every curve at its left end (c-ICE) makes differences between rows easier to see ✅[^10].
4. **Grid:** `partial_dependence` uses `grid_resolution=100` points between the 5th and 95th percentiles by default, or `custom_values` ✅[^2].
5. **"recursion":** for some tree models a weighted tree traversal replaces the brute average: follow the branch for a split on `x_S`, otherwise both branches weighted by the fraction of training samples that went each way ✅[^1]. It is faster, supports only `kind='average'`, and returns the decision function for classifiers ✅[^2]; for `GradientBoosting*` it ignores the `init` predictor ✅[^2].
6. **What it shows:** the average marginal effect, which represents the feature's influence exactly when the feature is not correlated with the others ✅[^9]; with correlated features it averages over unrealistic data points ✅[^1] ✅[^9]. Heterogeneous effects can cancel into a flat line, and a feature can be important by permutation importance while its PDP is flat ✅[^9].

### Accumulated local effects (ALE)
1. **Idea:** PDPs extrapolate to predictor values far outside the training data's envelope when predictors are strongly correlated; ALE does not need that extrapolation and is cheaper to compute ✅[^6].
2. **Steps** ✅[^11]:
   - Split the feature's range into intervals at its quantiles, so each interval holds the same number of rows.
   - For the rows in interval `k` with edges `z_(k−1)` and `z_k`, compute `f(z_k, x_C^(i)) − f(z_(k−1), x_C^(i))` with their own other features, and average.
   - Add up (accumulate) the averages interval by interval, then subtract a constant so the mean effect over the data is zero.
3. **Example:** if the intervals up to `x1 = 0.2` add 0.2 and those from 0.2 to 0.41 add 0.22, the uncentred ALE at 0.41 is `0.2 + 0.22 = 0.42` (the lab's "ALE − ALE[0]" row).
4. **Versus M-plots:** averaging predictions (not differences) over the conditional distribution, a "marginal plot", avoids unrealistic rows but mixes in the effects of correlated features; ALE's differences remove them ✅[^11]. ALE has no per-row curves like ICE ✅[^11].

### Shapley values
1. **The game:** each feature is a player, the value function `v(S)` says what the prediction is when only the features in `S` are "known", and `v(all features) = f(x)` ✅[^8].
2. **Formula:** `φ_i = Σ_{S ⊆ F∖{i}} |S|!·(M − |S| − 1)!/M! · [v(S ∪ {i}) − v(S)]`, with `F` the set of all `M` features and `S` a coalition without `i`; the weight is the share of feature orderings in which exactly the features in `S` come before `i` ✅[^3] ✅[^8]. Example for `M = 2`: both weights are `0!·1!/2! = ½` (artifact).
3. **Axioms:** efficiency (the values add up to the prediction minus the average prediction), symmetry, dummy (a feature that never changes any coalition's value gets 0) and additivity; the Shapley value is the only attribution with all four ✅[^12]. Lundberg and Lee's version for explanation models uses local accuracy, missingness and consistency, and proves only one additive attribution satisfies all three ✅[^3].
4. **Cost:** exact computation needs every coalition, a number that grows exponentially with the number of features (32 coalitions for 5 features in the lab), so it is usually approximated from a sample of coalitions ✅[^12] ✅[^14].

### Value functions: interventional vs observational
- **Observational (conditional):** `v(S) = E[f(X) | X_S = x_S]`, the definition behind SHAP values ✅[^3] ✅[^8].
- **Interventional (marginal):** `v(S) = E_D[f(x_S, X_S̄)]`, with the absent features `X_S̄` drawn from a distribution `D` that ignores `x_S` (for KernelSHAP, their joint distribution in the background data), which breaks their correlation with the present ones; KernelSHAP's sampling, QII (quantitative input influence) and interventional TreeSHAP estimate this ✅[^8]. Janzing et al. argue from causality that this unconditional expectation is the right notion of "dropping" a feature, because it equals `E[Y | do(X_S = x_S)]` for the model's output `Y`, the expected output when `X_S` is set to `x_S` by an intervention (Pearl's do-operator) rather than merely observed ✅[^7].
- **The catch-22:** conditional values can credit a feature the model never uses when it is correlated with a used one (in Janzing's example, `f(x1, x2) = x1` with two binary features that are always equal, the irrelevant `x2` gets `φ2 = x1/2 − 1/4`, not 0) ✅[^7] ✅[^8]; interventional values evaluate the model on out-of-distribution inputs, which Slack et al. exploited to hide a model's use of a protected feature from KernelSHAP ✅[^8].

### SHAP estimators
1. **KernelSHAP:** a weighted linear regression over coalitions recovers the Shapley values when the weight is `π(z') = (M − 1) / (C(M, |z'|)·|z'|·(M − |z'|))`, with `z'` a coalition written as a 0/1 vector, `|z'|` its number of present features and `C(M, k)` the number of ways to choose `k` of `M`; the empty and the full coalition get infinite weight, which forces `φ0 = v(∅)` and efficiency ✅[^3]. Example for `M = 5`: one present feature weighs `4/(5·1·4) = 0.2`, two `4/(10·2·3) = 0.067`. Exact regression costs `O(2^M + M³)` ✅[^3].
2. **Linear SHAP:** for `f(x) = Σ w_j·x_j + b` (weights `w_j`, intercept `b`) and independent features, `φ_j = w_j·(x_j − E[x_j])` ✅[^3].
3. **TreeSHAP:** exact SHAP values for tree ensembles in `O(T·L·D²)` time instead of `O(T·L·2^M)`, for `T` trees, at most `L` leaves and depth `D` ✅[^4]. The path-dependent version estimates `E[f(x) | x_S]` by following `x`'s branch at splits on features in `S` and weighting both branches by their training-sample cover otherwise ✅[^5]; the interventional version computes the classic marginal values ✅[^13]. Since `shap` 0.47, `TreeExplainer`'s default `feature_perturbation='auto'` uses the interventional version when a background dataset is passed and the path-dependent one otherwise ✅[^15]. Path-dependent TreeSHAP can give a non-zero value to a feature with no influence on the prediction ✅[^13]. Independent Tree SHAP averages exact values over `R` background samples in `O(T·R·L)` ✅[^5].
4. **Why trees needed this:** gain, split-count and Saabas attributions are inconsistent: a model can rely more on a feature while its attribution falls ✅[^4].

### What these explanations do not tell you
- **Not real-world causation:** a PDP is causal for the model, not necessarily for the world ✅[^9].
- **Not a recipe for action:** for `f(x) = 2 − (x − 1)²` with `X ~ N(0, 1)`, a person at `x = 1` has `φ = 2`, yet raising `x` lowers the score ✅[^8].
- **Not "the drop without this feature":** a Shapley value is not the change in prediction from retraining without the feature ✅[^12].
- **Depends on who counts as a player:** under the conditional value function, adding an exact copy of a feature as another player changes the other features' attributions too ✅[^8].

## Worked example
One script, scikit-learn 1.9.1: (1) a gradient-boosting model of `y = 3·x0·x1 + x2` (with `x1` equal to −1 or +1), PDP and ICE for `x0` by hand and from `partial_dependence`; (2) PDP vs ALE for a function that equals `x1 + x2` on data where `x2 ≈ x1`, and has a large extra term only where `x1 − x2 > 0.2`, a region with no data; (3) exact Shapley values for a gradient-boosting model on the 5-feature Friedman #1 data, then KernelSHAP over all 32 coalitions and linear SHAP for a ridge model. The heart of part 3:

```python
def v(S, predict):   # mean prediction with features in S fixed to x, the others from the background rows
    Z = bg.copy(); Z[:, list(S)] = x[list(S)]
    return predict(Z).mean()
# phi_i = sum over S without i of |S|! (M-|S|-1)! / M! * (v(S + {i}) - v(S))
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-25, scikit-learn 1.9.1, two runs identical; part 4 is the Mental model artifact ✅[^14]:

```text
== 1. PDP and ICE: y = 3*x0*x1 + x2, x1 is -1 or +1 ==
PDP by hand    [ 0.137  0.066  0.028  0.069  0.06   0.01  -0.059]
sklearn brute  [ 0.137  0.066  0.028  0.069  0.06   0.01  -0.059] | max |diff| ICE: 0.0e+00
sklearn recursion [ 0.042  0.054  0.022  0.062  0.051 -0.056 -0.15 ] | max |brute - recursion|: 0.095
ICE slopes: x1=+1 mean +2.16, x1=-1 mean -2.28; PDP slope -0.11
permutation importance (R^2 drop) x0, x1, x2: [1.066 1.008 0.496]
== 2. PDP vs ALE when x2 is nearly a copy of x1 ==
share of data with x1 - x2 > 0.2: 0.0
x1 grid    [0.   0.2  0.41 0.61 0.8  1.  ]
PDP - PDP[0] [0.   0.21 0.65 1.45 2.56 4.14]
ALE - ALE[0] [0.   0.2  0.42 0.61 0.8  1.  ]
== 3. exact Shapley values by enumeration (interventional, background = 200 rows) ==
phi         [ 1.947 -1.388 -0.186  1.291  1.869]
sum(phi) = 3.5322  f(x) - E[f(bg)] = 3.5322
KernelSHAP over all 32 coalitions: max |diff| to exact = 4.4e-16
linear model: max |exact - w_i (x_i - mean_i)| = 3.1e-15
```

<details><summary>Full script (prints the output above)</summary>

```python
# PDP and ICE by hand vs sklearn, a flat PDP hiding an interaction, PDP vs ALE off the data,
# exact Shapley values by enumeration (efficiency, KernelSHAP, linear SHAP), and
# interventional vs observational Shapley values with correlated features.
from itertools import combinations
from math import comb, factorial
import numpy as np
from sklearn.datasets import make_friedman1
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.inspection import partial_dependence, permutation_importance
from sklearn.linear_model import Ridge

rng = np.random.default_rng(0)
print("== 1. PDP and ICE: y = 3*x0*x1 + x2, x1 is -1 or +1 ==")
n = 2000
X = np.c_[rng.uniform(-1, 1, n), rng.choice([-1.0, 1.0], n), rng.normal(size=n)]
y = 3 * X[:, 0] * X[:, 1] + X[:, 2] + rng.normal(0, 0.1, n)
gb = GradientBoostingRegressor(random_state=0).fit(X, y)
grid = np.linspace(-0.9, 0.9, 7)
ice = np.array([gb.predict(np.c_[np.full(n, g), X[:, 1:]]) for g in grid]).T   # one row per sample
pdp_hand = ice.mean(axis=0)                                                    # PDP = mean of the ICE curves
pd = partial_dependence(gb, X, [0], grid_resolution=7, percentiles=(0.05, 0.95), method="brute",
                        kind="both", custom_values={0: grid})
print("PDP by hand   ", np.round(pdp_hand, 3))
print("sklearn brute ", np.round(pd["average"][0], 3), "| max |diff| ICE:", f"{np.abs(pd['individual'][0] - ice).max():.1e}")
rec = partial_dependence(gb, X, [0], method="recursion", custom_values={0: grid})["average"][0]
print("sklearn recursion", np.round(rec, 3), "| max |brute - recursion|:", round(float(np.abs(pdp_hand - rec).max()), 3))
slope = (ice[:, -1] - ice[:, 0]) / (grid[-1] - grid[0])
print(f"ICE slopes: x1=+1 mean {slope[X[:, 1] > 0].mean():+.2f}, x1=-1 mean {slope[X[:, 1] < 0].mean():+.2f}; "
      f"PDP slope {(pdp_hand[-1] - pdp_hand[0]) / (grid[-1] - grid[0]):+.2f}")
pi = permutation_importance(gb, X, y, n_repeats=5, random_state=0).importances_mean
print("permutation importance (R^2 drop) x0, x1, x2:", np.round(pi, 3))

print("== 2. PDP vs ALE when x2 is nearly a copy of x1 ==")
x1 = rng.uniform(0, 1, n); x2 = x1 + rng.normal(0, 0.05, n)
Xc = np.c_[x1, x2]
def f(Z):            # equals x1 + x2 on the data; a large term only where x1 - x2 > 0.2, a region with no data
    return Z[:, 0] + Z[:, 1] + 10 * np.maximum(0, Z[:, 0] - Z[:, 1] - 0.2)
print("share of data with x1 - x2 > 0.2:", np.mean(x1 - x2 > 0.2))
edges = np.quantile(x1, np.linspace(0, 1, 11))                      # 10 intervals with equal counts
pdp = np.array([f(np.c_[np.full(n, e), x2]).mean() for e in edges])
k = np.clip(np.searchsorted(edges, x1, side="right") - 1, 0, 9)     # interval of each point
local = [np.mean(f(np.c_[np.full((k == j).sum(), edges[j + 1]), x2[k == j]]) -
                 f(np.c_[np.full((k == j).sum(), edges[j]), x2[k == j]])) for j in range(10)]
ale = np.r_[0, np.cumsum(local)]
ale -= np.average((ale[:-1] + ale[1:]) / 2, weights=np.bincount(k, minlength=10))   # centre: mean effect 0
print("x1 grid   ", np.round(edges[::2], 2))
print("PDP - PDP[0]", np.round((pdp - pdp[0])[::2], 2))
print("ALE - ALE[0]", np.round((ale - ale[0])[::2], 2))

print("== 3. exact Shapley values by enumeration (interventional, background = 200 rows) ==")
Xf, yf = make_friedman1(n_samples=1000, n_features=5, noise=0.5, random_state=0)
model = GradientBoostingRegressor(random_state=0).fit(Xf, yf)
bg, x = Xf[:200], Xf[500]
M = 5
def v(S, predict):   # value of coalition S: mean prediction with features in S fixed to x, the rest from bg
    Z = bg.copy(); Z[:, list(S)] = x[list(S)]
    return predict(Z).mean()
def shapley(predict):
    vals = {S: v(S, predict) for r in range(M + 1) for S in combinations(range(M), r)}
    phi = np.zeros(M)
    for i in range(M):
        for S, vS in vals.items():
            if i not in S:
                phi[i] += factorial(len(S)) * factorial(M - len(S) - 1) / factorial(M) * (vals[tuple(sorted(S + (i,)))] - vS)
    return phi, vals
phi, vals = shapley(model.predict)
print("phi        ", np.round(phi, 3))
print(f"sum(phi) = {phi.sum():.4f}  f(x) - E[f(bg)] = {model.predict(x[None])[0] - model.predict(bg).mean():.4f}")
rows, w, t = [], [], []                                             # KernelSHAP: weighted least squares
for S in vals:
    if 0 < len(S) < M:
        z = np.isin(np.arange(M), S).astype(float)
        rows.append(z); t.append(vals[S] - vals[()])
        w.append((M - 1) / (comb(M, len(S)) * len(S) * (M - len(S))))  # the Shapley kernel
Z, w, t = np.array(rows), np.array(w), np.array(t)
total = vals[tuple(range(M))] - vals[()]                             # efficiency constraint: sum(phi) = total
A = Z[:, :-1] - Z[:, [-1]]; b = t - Z[:, -1] * total                 # substitute phi_M = total - sum(others)
coef = np.linalg.solve(A.T @ (w[:, None] * A), A.T @ (w * b))
kernel = np.r_[coef, total - coef.sum()]
print(f"KernelSHAP over all {len(vals)} coalitions: max |diff| to exact = {np.abs(kernel - phi).max():.1e}")
lin = Ridge(alpha=1.0).fit(Xf, yf)
print("linear model: max |exact - w_i (x_i - mean_i)| =", f"{np.abs(shapley(lin.predict)[0] - lin.coef_ * (x - bg.mean(0))).max():.1e}")

print("== 4. f(x) = x1 only, corr(x1, x2) = 0.9, explain x = (1, 1) ==")
rho, N = 0.9, 200_000
B = rng.multivariate_normal([0, 0], [[1, rho], [rho, 1]], size=N)
g = lambda Z: Z[:, 0]                                                # the model ignores x2
xx = np.array([1.0, 1.0])
def v_int(S):        # interventional: absent features drawn from their marginal (the background data)
    Z = B.copy(); Z[:, list(S)] = xx[list(S)]; return g(Z).mean()
def v_obs(S):        # observational: absent features drawn from their distribution given the present ones
    if len(S) in (0, 2): return v_int(S)
    j, o = S[0], 1 - S[0]
    Z = np.empty((N, 2)); Z[:, j] = xx[j]
    Z[:, o] = rho * xx[j] + np.sqrt(1 - rho ** 2) * rng.standard_normal(N)   # Gaussian X_o | X_j = x_j
    return g(Z).mean()
for name, val in [("interventional", v_int), ("observational ", v_obs)]:
    V = {S: val(S) for S in [(), (0,), (1,), (0, 1)]}
    p1 = 0.5 * ((V[(0,)] - V[()]) + (V[(0, 1)] - V[(1,)]))
    p2 = 0.5 * ((V[(1,)] - V[()]) + (V[(0, 1)] - V[(0,)]))
    print(f"{name}: phi_x1 = {p1:.3f}  phi_x2 = {p2:.3f}  sum = {p1 + p2:.3f}")
```

</details>

Reading it, line by line:
- **PDP = mean of ICE:** the hand average of 2,000 what-if predictions equals `partial_dependence(method="brute")` exactly, and so do all 2,000 ICE curves (`max |diff| 0.0`). The `recursion` method gives a similar but not identical curve, up to 0.095 away here, and the gap is not a constant. The API page's warning predicts only a constant offset for `GradientBoosting*` with the default constant `init` ✅[^2], so it does not explain this run; the User Guide says the two methods should be close in general but may differ in some settings, such as correlated features ✅[^1]. Here `X` is the training data and the features are independent by construction, so the gap is unexplained by either page: when the exact numbers matter, use `brute`.
- **The flat PDP hides the interaction:** rows with `x1 = +1` have ICE slope +2.16 and rows with `x1 = −1` slope −2.28; the average is −0.11. Permutation importance (R² drop 1.066) shows `x0` is the model's most important feature. Read a PDP with its ICE curves.
- **PDP vs ALE:** no row has `x1 − x2 > 0.2`, yet the PDP of `x1` climbs by 4.14 across the range, because forcing `x1 = 1` on a row with `x2 = 0.1` lands in the region where the function adds `10·(x1 − x2 − 0.2)`. ALE only moves each row within its own small interval, so it sees the on-data slope of 1 (0.2, 0.42, 0.61, 0.8, 1.0). A trained model has learned little about such regions either ✅[^8]: the PDP reports what it does there, ALE does not.
- **Efficiency:** the five Shapley values add up to 3.5322, exactly `f(x) − E[f(background)]`. Feature 1 (index 0) pushes the prediction up by 1.947, feature 2 down by 1.388.
- **KernelSHAP and linear SHAP:** weighted least squares with the Shapley kernel over all 32 coalitions reproduces the enumeration to `4.4e-16`, and for a ridge model the enumeration equals `w_i·(x_i − mean_i)` to `3.1e-15`, which is Theorem 2 and Corollary 1 of Lundberg and Lee ✅[^3]. In practice KernelSHAP samples coalitions instead of enumerating all `2^M` ✅[^13].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Interaction with opposite signs | PDP near flat while the feature matters (lab slope −0.11, permutation 1.066) | Heterogeneous effects cancel in the average ✅[^9]; lab ✅[^14] |
| Strongly correlated features in a PDP or ICE | Curves driven by impossible rows (lab PDP +4.14 vs ALE +1.0) | Independence assumption ✅[^1]; extrapolation ✅[^6]; lab ✅[^14] |
| `method='recursion'` vs `'brute'` | Similar but different values (lab up to 0.095) | Different computation; both should be close in general but may disagree ✅[^1] |
| ICE requested with `method='recursion'` | Not supported | Recursion computes only the average ✅[^1] ✅[^2] |
| PDP of a `GradientBoostingRegressor` with a non-constant `init` | Wrong values with `recursion` | Recursion ignores the `init` predictor; use `brute` ✅[^2] |
| More than two features in one PDP | Cannot be drawn meaningfully | Usually one or two features ✅[^1] ✅[^9] |
| Too many ALE intervals | Shaky curve; too few, inaccurate | No perfect number of intervals ✅[^11] |
| Reading an ALE curve across intervals with strong correlation | Misleading "change x and keep the rest" story | Effects are local to each interval ✅[^11] |
| Observational Shapley on correlated features | Credit for a feature the model ignores (lab 0.449) | Conditional expectation ✅[^7] ✅[^13]; lab ✅[^14] |
| Interventional Shapley | Model evaluated on out-of-distribution inputs; can be gamed | Slack et al. via Kumar et al. ✅[^8] |
| A copy of a feature added as another player | With the conditional value function, the other features' attributions change too | Choice of players changes the game ✅[^8] |
| Many features, exact Shapley | `2^M` coalitions | Exponential cost; sampling or TreeSHAP ✅[^12] ✅[^4] |
| Positive Shapley value read as "raise x" | Can be wrong (`2 − (x − 1)²` example) | Shapley values do not correspond to actions ✅[^8] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| PDP | Intuitive average what-if; causal for the model ✅[^9] | Hides heterogeneity; unrealistic rows under correlation ✅[^9] |
| ICE | Shows per-row effects and interactions ✅[^1] ✅[^10] | One feature at a time ✅[^1]; same correlation problem ✅[^10] |
| ALE | Works with correlated features; faster than PDP, `O(n)` ✅[^11] ✅[^6] | Interval choice; no per-row curves ✅[^11] |
| KernelSHAP (model-agnostic) | Any model; joint regression is more sample-efficient than classic sampling ✅[^3] | Slow; ignores feature dependence ✅[^13] |
| TreeSHAP | Exact and polynomial for tree ensembles ✅[^4] | Path-dependent version can credit unused features ✅[^13] |
| Permutation importance | One global number per feature (`machine-learning/data-and-features/feature-importance-and-selection.md`) | No per-prediction explanation; same off-distribution issue under correlation ✅[^8] |

## Takeaways
- Plot ICE curves together with every PDP, and check feature correlations before trusting either; switch to ALE when features are strongly correlated. [rule-candidate]
- State the value function (interventional or conditional) and the background dataset with every SHAP result; they change the numbers. [rule-candidate]
- Check efficiency: the SHAP values of a prediction must add up to `f(x)` minus the background mean prediction.
- Never present a PDP or a Shapley value as the effect of changing a feature in the real world; that needs causal inference.

## Verification status
- Verified: 90 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [Partial Dependence and Individual Conditional Expectation plots (User Guide §5.1)](https://scikit-learn.org/stable/modules/partial_dependence.html) — scikit-learn developers, living (1.9.1). Backs: PDP definition and brute estimate, ICE as its terms, one or two features, independence assumption and unrealistic points, recursion method, brute vs recursion may differ, ICE only with brute. [^1]
- [sklearn.inspection.partial_dependence](https://scikit-learn.org/stable/modules/generated/sklearn.inspection.partial_dependence.html) — scikit-learn developers, living (1.9.1). Backs: grid defaults, `custom_values`, recursion limits, `init` warning. [^2]
- [A Unified Approach to Interpreting Model Predictions](https://arxiv.org/html/1705.07874) — Lundberg, Lee, 2017. Backs: Shapley formula, local accuracy, missingness, consistency and uniqueness, SHAP as Shapley values of `E[f(z) | z_S]`, the Shapley kernel and its infinite end weights, `O(2^M + M³)`, linear SHAP, sample efficiency of the regression. [^3]
- [Consistent Individualized Feature Attribution for Tree Ensembles](https://arxiv.org/html/1802.03888) — Lundberg, Erion, Lee, 2018. Backs: inconsistency of gain, split count and Saabas; `O(TLD²)` vs `O(TL2^M)`. [^4]
- [Explainable AI for Trees: From Local Explanations to Global Understanding](https://arxiv.org/html/1905.04610) — Lundberg et al., 2019. Backs: path-dependent expectation by tree traversal with cover weights, Independent Tree SHAP in `O(TRL)`. [^5]
- [Visualizing the Effects of Predictor Variables in Black Box Supervised Learning Models](https://arxiv.org/html/1612.08468) — Apley, Zhu, 2016. Backs: PD extrapolation under correlation, ALE avoids it and is cheaper. [^6]
- [Feature relevance quantification in explainable AI: A causal problem](https://arxiv.org/html/1910.13413) — Janzing, Minorics, Blöbaum, 2019. Backs: observational vs interventional, the irrelevant-feature example, marginal expectation equals the interventional one. [^7]
- [Problems with Shapley-value-based explanations as feature importance measures](https://arxiv.org/html/2002.11097) — Kumar, Venkatasubramanian, Scheidegger, Friedler, 2020. Backs: the game and `v(all) = f(x)`, the two value functions and which methods estimate which, the catch-22, Slack et al., redundant players, the `2 − (x − 1)²` example. [^8]
- [Interpretable Machine Learning: Partial Dependence Plot (PDP)](https://christophm.github.io/interpretable-ml-book/pdp.html) — Christoph Molnar, living. Backs: independence assumption, hidden heterogeneity, flat PDP vs permutation importance, causal for the model only, two-feature limit. [^9]
- [Interpretable Machine Learning: Individual Conditional Expectation (ICE)](https://christophm.github.io/interpretable-ml-book/ice.html) — Christoph Molnar, living. Backs: centred ICE, heterogeneity, correlation problem. [^10]
- [Interpretable Machine Learning: Accumulated Local Effects (ALE)](https://christophm.github.io/interpretable-ml-book/ale.html) — Christoph Molnar, living. Backs: ALE steps with quantile intervals, accumulation and centring, M-plots, `O(n)`, interval choice, no ICE, local interpretation. [^11]
- [Interpretable Machine Learning: Shapley Values](https://christophm.github.io/interpretable-ml-book/shapley.html) — Christoph Molnar, living. Backs: efficiency, symmetry, dummy, additivity, exponential cost, not the retrain-without-feature difference. [^12]
- [Interpretable Machine Learning: SHAP](https://christophm.github.io/interpretable-ml-book/shap.html) — Christoph Molnar, living. Backs: interventional and path-dependent TreeSHAP, non-zero values for unused features, KernelSHAP ignoring dependence. [^13]
- `machine-learning/lab-setup.md` — the lab where the PDP/ICE check, PDP vs ALE, exact Shapley enumeration with KernelSHAP and linear SHAP, and the interventional vs observational comparison ran on 2026-11-25. [^14]
- [shap.TreeExplainer](https://shap.readthedocs.io/en/latest/generated/shap.TreeExplainer.html) — SHAP developers, living. Backs: `feature_perturbation='auto'` default choosing interventional with a background dataset and tree-path-dependent without one. [^15]

## Related
- `machine-learning/data-and-features/feature-importance-and-selection.md` — permutation and impurity importance, the global counterpart.
- `machine-learning/deep-learning/interpretability-and-attribution.md` — integrated gradients, whose completeness plays the role of efficiency for networks.
- `machine-learning/supervised-learning/tree-ensembles.md` — the gradient-boosting and forest models explained here.
- `machine-learning/causal-inference/potential-outcomes-and-experiments.md` — what a causal effect is, which these plots do not measure.
- `machine-learning/causal-inference/causal-graphs-and-confounding.md` — why correlated features make "the effect of one feature" ambiguous.
