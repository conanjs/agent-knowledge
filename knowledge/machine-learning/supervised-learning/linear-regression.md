---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/supervised-learning
status: verified
applies-to: ["scikit-learn 1.9.1", "NumPy 2.5.5"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [machine-learning, supervised-learning, linear-regression, least-squares, ols, normal-equation, r2, multicollinearity, scikit-learn]
---

# Linear regression: least squares, the normal equation and R²

## Summary
**TL;DR:** Linear regression predicts a number as an intercept plus a weighted sum of the features, `ŷ = b + w₁x₁ + … + w_p x_p`. OLS (ordinary least squares) picks the weights that make the sum of squared errors smallest. That minimum has a closed form, the normal equation `XᵀX w = Xᵀy`; scikit-learn solves it with an SVD-based (singular value decomposition) least-squares routine, and gradient descent reaches the same weights. R² (the coefficient of determination) = `1 − SS_res / SS_tot` tells you what share of the target's spread the model explains. It is 1 at best and can be negative.
**Use this when:** you fit or read a linear model, need to know why two features' coefficients swing wildly, why `np.linalg.solve` says "Singular matrix", or what a given R² means.
**Not this doc:** ridge and lasso penalties → `machine-learning/foundations/regularization.md`; how gradient descent itself works → `machine-learning/foundations/gradient-descent.md`; why squared error is the Gaussian maximum-likelihood loss → `machine-learning/foundations/loss-functions-and-maximum-likelihood.md`; classification with a linear model → `machine-learning/supervised-learning/logistic-regression.md`.

## Problem
A linear model is the first model most engineers fit, and the easiest to misread. Coefficients look like "importance", but they depend on each feature's units ✅[^5]. With two strongly correlated features, two halves of the same dataset gave coefficients `[−9.29, 11.32]` and `[−1.73, 3.71]`, although both fits predict almost the same thing ✅[^6]. A duplicated column makes the textbook formula fail outright ✅[^6]. People also iterate gradient descent when an exact answer is one call away, and they read R² as a percentage that cannot go below zero.

## Mental model
**Analogy:** predicting a restaurant bill from what was ordered: `bill = cover charge + Σ price × quantity`. You have many old receipts but no menu. Fitting means finding the cover charge (intercept) and the prices (weights) that make the predicted bills closest to the real ones, where "closest" means the smallest total of squared differences. With 200 receipts, the 200 real bills form one point `y` in 200-dimensional space. Every bill vector the model can predict, `X·w`, lies on a flat surface built from the menu columns. Least squares picks the point on that surface directly below `y`, so the leftover error (the residual) points straight up, perpendicular to every column.

**Artifact:** the picture, and the lab line that confirms it ✅[^6]. `X1` is the feature matrix with a column of 1s added for the intercept; `r` is the residual vector:

```text
                 y   (observed targets: one point in n-dimensional space)
                 *
                 |
                 |   r = y − X·w*   (residual: perpendicular to the surface)
                 |
   ______________*_______________
  /             X·w*             /   all predictions X·w the model can make
 /______________________________/    (every weighted sum of X's columns)

lab: max |X1ᵀ r| = 2.1e-13    → r is orthogonal to every column (zero up to rounding)
```

## How it works
Symbols: `n` rows (examples), `p` features; `X` is the `n × p` feature matrix; `y` is the vector of `n` targets; `w` holds the `p` weights and `b` the intercept; `ŷ` holds the predictions.

1. **Model.** `ŷ = b + w₁x₁ + … + w_p x_p`; scikit-learn stores `w` in `coef_` and `b` in `intercept_` ✅[^1]. Example: `b = 3`, `w = [2, −1, 0.5]`, `x = [1, 1, 2]` gives `ŷ = 3 + 2 − 1 + 1 = 5`.
2. **Loss.** OLS minimizes the residual sum of squares `‖Xw − y‖²` ✅[^1]; squaring makes large errors count disproportionately, which also makes the fit sensitive to outliers ✅[^2]. The general idea of a loss lives in `machine-learning/foundations/loss-functions-and-maximum-likelihood.md`.
3. **Fold the intercept in.** Append a column of 1s to `X` (call it `X1`); its weight is `b` ✅[^2].
4. **Normal equation.** The gradient of the loss is `2·X1ᵀ(X1·w − y)`. Setting it to zero gives `X1ᵀX1 · w = X1ᵀy`, so `w* = (X1ᵀX1)⁻¹ X1ᵀy`. The solution is unique only when `X1ᵀX1` is invertible, that is, when the columns are linearly independent ✅[^2]. Example, three points `x = 1, 2, 3`, `y = 2, 4, 5`: `X1ᵀX1 = [[3, 6], [6, 14]]`, `X1ᵀy = [11, 25]`, so `[b, w₁] = [0.667, 1.5]` and `ŷ = 0.667 + 1.5x` ✅[^6].
5. **Geometry.** The equation of step 4, `X1ᵀ(X1·w − y) = 0` ✅[^2], says the residual `r = y − X1·w` has a zero dot product with every column: it is perpendicular to the prediction surface (lab: `max |X1ᵀr| = 2.1e-13`) ✅[^6]. Because the column of 1s is one of those columns, the residuals also sum to zero (lab: mean residual `1.1e-15`) ✅[^6].
6. **How scikit-learn solves it.** On dense data, `LinearRegression` wraps `scipy.linalg.lstsq` (and `scipy.sparse.linalg.lsqr` on sparse data) ✅[^3]. The least-squares solution uses the SVD of `X` and costs `O(n·p²)` when `n ≥ p` ✅[^1].
7. **Gradient descent alternative.** Repeat `w ← w − η · (2/n) · X1ᵀ(X1·w − y)`, where `η` (eta) is the learning rate. This matters for models with no closed form, and minibatches help on large datasets, where one full pass per update is slow ✅[^2]. Learning rates, convergence and feature scaling → `machine-learning/foundations/gradient-descent.md`.
8. **R².** `R² = 1 − u/v`, where `u = Σ(y − ŷ)²` is the residual sum of squares (SS_res) and `v = Σ(y − ȳ)²` is the total sum of squares around the mean `ȳ` (SS_tot). The best score is 1.0; a constant model that always predicts the mean gets 0.0; worse models go negative ✅[^3]. Three-point example: residuals `[−0.167, 0.333, −0.167]`, SS_res = `0.1667`, SS_tot = `4.6667`, R² = `1 − 0.1667/4.6667 = 0.9643` ✅[^6].
9. **Assumptions behind the numbers.**
   - **Linear target.** The model assumes the target is a linear combination of the features ✅[^1].
   - **No strong correlation between features.** With near-linear dependence between columns, `X` is close to singular and the estimates react strongly to noise in `y` (large variance) ✅[^1].
   - **Gaussian noise.** If `y = wᵀx + b + ε` with Gaussian noise `ε ~ N(0, σ²)`, minimizing mean squared error is the same as maximum-likelihood estimation ✅[^2].
   - **Coefficients are conditional.** A coefficient describes the target's dependence on that feature with all the other features held constant ✅[^5].

## Worked example
200 rows with three standard-normal features, true `b = 3`, `w = [2, −1, 0.5]`, and noise with standard deviation 0.5, fitted three ways. The core lines:

```python
w_ne = np.linalg.solve(X1.T @ X1, X1.T @ y)            # normal equation
reg  = LinearRegression().fit(X, y)                     # SVD least squares
for step in range(500):                                 # gradient descent, η = 0.1
    w_gd -= 0.1 * (2 / n * X1.T @ (X1 @ w_gd - y))
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-24, scikit-learn 1.9.1, NumPy 2.5.5, two runs identical ✅[^6]:

```text
X1^T X1 = [[3.0, 6.0], [6.0, 14.0]]  X1^T y = [11.0, 25.0]  w = [b, w1] = [0.666667 1.5     ]
residuals = [-0.166667  0.333333 -0.166667]  SS_res=0.1667 SS_tot=4.6667 R2=0.9643
normal eq : [ 2.981931  1.955009 -1.048076  0.526513]
sklearn   : [ 2.981931  1.955009 -1.048076  0.526513]
grad desc : [ 2.981931  1.955009 -1.048076  0.526513]
max |ne-sk| = 1.33e-15   max |ne-gd| = 2.22e-16
max |X1^T r| = 2.1e-13   mean residual = 1.1e-15
SS_res=50.008 SS_tot=1084.792 R2 by hand=0.953901 r2_score=0.953901 reg.score=0.953901
lr=1.1 after 20 steps, |w| = 5.786e+02
half A coef=[-9.28783  11.318691]  coef sum=2.031
half B coef=[-1.732197  3.71453 ]  coef sum=1.982
duplicate column: rank(X1^T X1) = 2 of 3; LinearRegression coef=[0.5 0.5] intercept=0.0
np.linalg.solve on the normal equation: Singular matrix
p > n: rank(X^T X) = 5 of 10
```

<details><summary>Full script (prints the output above)</summary>

```python
# Linear regression: normal equation vs LinearRegression vs gradient descent; residual geometry; R^2; failure modes.
import numpy as np
from sklearn.linear_model import LinearRegression
from sklearn.metrics import r2_score

np.set_printoptions(precision=6, suppress=True)
# 0. Three points by hand: x = 1, 2, 3 and y = 2, 4, 5
X1 = np.array([[1, 1], [1, 2], [1, 3]], float); yt = np.array([2, 4, 5], float)   # column of 1s = intercept
wt = np.linalg.solve(X1.T @ X1, X1.T @ yt)
rt = yt - X1 @ wt
print("X1^T X1 =", (X1.T @ X1).tolist(), " X1^T y =", (X1.T @ yt).tolist(), " w = [b, w1] =", wt)
print("residuals =", rt, " SS_res=%.4f SS_tot=%.4f R2=%.4f" % ((rt ** 2).sum(), ((yt - yt.mean()) ** 2).sum(),
      1 - (rt ** 2).sum() / ((yt - yt.mean()) ** 2).sum()))

# 1. 200 rows, 3 features, true b = 3, w = [2, -1, 0.5], noise sd 0.5
rng = np.random.default_rng(0)
n = 200
X = rng.normal(size=(n, 3))
y = 3.0 + X @ np.array([2.0, -1.0, 0.5]) + rng.normal(scale=0.5, size=n)
X1 = np.hstack([np.ones((n, 1)), X])
w_ne = np.linalg.solve(X1.T @ X1, X1.T @ y)              # normal equation: (X1^T X1) w = X1^T y
reg = LinearRegression().fit(X, y)                        # scikit-learn (SVD-based least squares)
w_sk = np.r_[reg.intercept_, reg.coef_]
w_gd = np.zeros(4)                                        # batch gradient descent on MSE
for step in range(500):
    w_gd -= 0.1 * (2 / n * X1.T @ (X1 @ w_gd - y))
print("normal eq :", w_ne)
print("sklearn   :", w_sk)
print("grad desc :", w_gd)
print("max |ne-sk| = %.2e   max |ne-gd| = %.2e" % (abs(w_ne - w_sk).max(), abs(w_ne - w_gd).max()))

r = y - X1 @ w_ne                                         # residual vector
print("max |X1^T r| = %.1e   mean residual = %.1e" % (abs(X1.T @ r).max(), r.mean()))
ss_res = (r ** 2).sum(); ss_tot = ((y - y.mean()) ** 2).sum()
print("SS_res=%.3f SS_tot=%.3f R2 by hand=%.6f r2_score=%.6f reg.score=%.6f"
      % (ss_res, ss_tot, 1 - ss_res / ss_tot, r2_score(y, reg.predict(X)), reg.score(X, y)))

w_bad = np.zeros(4)                                       # learning rate too large
for step in range(20):
    w_bad -= 1.1 * (2 / n * X1.T @ (X1 @ w_bad - y))
print("lr=1.1 after 20 steps, |w| = %.3e" % np.linalg.norm(w_bad))

# 2. Failure modes
x1 = rng.normal(size=n); x2 = x1 + rng.normal(scale=0.01, size=n)   # near-duplicate feature
yc = 1.0 * x1 + 1.0 * x2 + rng.normal(scale=0.5, size=n)
Xc = np.c_[x1, x2]
for name, idx in [("half A", slice(0, 100)), ("half B", slice(100, 200))]:
    m = LinearRegression().fit(Xc[idx], yc[idx])
    print("%s coef=%s  coef sum=%.3f" % (name, m.coef_, m.coef_.sum()))
Xd = np.array([[0, 0], [1, 1], [2, 2]], float); yd = np.array([0, 1, 2], float)   # exact duplicate column
Xd1 = np.c_[np.ones(3), Xd]
print("duplicate column: rank(X1^T X1) = %d of 3; LinearRegression coef=%s intercept=%.1f"
      % (np.linalg.matrix_rank(Xd1.T @ Xd1), LinearRegression().fit(Xd, yd).coef_, LinearRegression().fit(Xd, yd).intercept_))
try:
    np.linalg.solve(Xd1.T @ Xd1, Xd1.T @ yd)
except np.linalg.LinAlgError as e:
    print("np.linalg.solve on the normal equation:", e)
Xw = rng.normal(size=(5, 10))                             # more features (10) than rows (5)
print("p > n: rank(X^T X) = %d of 10" % np.linalg.matrix_rank(Xw.T @ Xw))
```

</details>

Reading it line by line:
- **Lines 1–2** are the three-point example from How it works steps 4 and 8, computed: `b = 0.667`, `w₁ = 1.5`, R² = 0.9643.
- **Lines 3–6:** the normal equation, `LinearRegression` and 500 gradient-descent steps give the same four numbers, to within `1.3e-15`. The estimates `[2.98, 1.96, −1.05, 0.53]` are close to the true `[3, 2, −1, 0.5]`; the gap is the noise.
- **Line 7:** `X1ᵀr` is zero up to rounding: the residual is perpendicular to every column, as in the Mental model picture.
- **Line 8:** R² by hand, `1 − 50.008/1084.792 = 0.9539`, matches `r2_score` and `reg.score`.
- **Line 9:** the same gradient descent with learning rate 1.1 instead of 0.1 blows up to `|w| = 579` in 20 steps.
- **Lines 10–11:** with two near-copies of one feature, the individual coefficients swing from `[−9.3, 11.3]` to `[−1.7, 3.7]`, but their sum stays near the true `1 + 1 = 2` in both halves. The data only pins down the sum.
- **Lines 12–13:** an exact duplicate column (scikit-learn's own docs example) leaves `X1ᵀX1` with rank 2 of 3. `np.linalg.solve` refuses with "Singular matrix", while `LinearRegression` still returns one valid answer, `[0.5, 0.5]`.
- **Line 14:** with 10 features and only 5 rows, `XᵀX` has rank 5 of 10, so the normal equation has no unique solution.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Two strongly correlated features | Coefficients change a lot between data subsets; their sum is stable (`[−9.3, 11.3]` vs `[−1.7, 3.7]`, sums 2.03 and 1.98) ✅[^6] | The design matrix is close to singular, so the estimate has large variance ✅[^1]; correlated features' effects cannot be teased apart ✅[^5] |
| Exact duplicate column | `np.linalg.solve(XᵀX, Xᵀy)` raises "Singular matrix"; `LinearRegression` returns `[0.5, 0.5]` ✅[^6] | `XᵀX` is not invertible, so there is no unique solution ✅[^2]; scikit-learn's docs show this same `[0.5, 0.5]` output ✅[^1] |
| More features than rows (`p > n`) | `XᵀX` (10 × 10) has rank 5 in the lab ✅[^6]: infinitely many exact fits | The solution is unique only when `XᵀX` is invertible ✅[^2]; add a penalty → `machine-learning/foundations/regularization.md` |
| Comparing raw coefficients as importance | Misleading: a feature measured in large units gets a small coefficient | Multiply each coefficient by its feature's standard deviation (or standardize the features) to compare them ✅[^5] |
| A coefficient's sign is the opposite of the simple correlation | Can happen | Coefficients are conditional on the other features, not marginal ✅[^5] |
| Reading a coefficient as cause and effect | Not supported by the fit | Linear models measure association; unobserved confounders bias causal readings ✅[^5] |
| R² on new data below 0 | Possible | R² can be arbitrarily negative when the model is worse than predicting the mean ✅[^3] |
| Constant target `y` | R² is not finite; scikit-learn reports 1.0 (perfect predictions) or 0.0 (imperfect) unless `force_finite=False` ✅[^4] | `SS_tot = 0` makes `u/v` undefined |
| Outliers in `y` | They pull the line toward themselves | The squared loss gives large errors even larger weight ✅[^2] |
| Gradient descent with too large a learning rate | Diverges (`|w| = 579` after 20 steps at 1.1) ✅[^6] | See `machine-learning/foundations/gradient-descent.md` |
| Coefficients that must not be negative (counts, prices) | `LinearRegression(positive=True)` fits NNLS (non-negative least squares) ✅[^1] | Constrained least squares |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Normal equation via `np.linalg.solve(XᵀX, Xᵀy)` | One line; exact; shows the math | Fails on a singular `XᵀX` (duplicate columns, `p > n`) ✅[^6] |
| `LinearRegression` (SVD least squares) | Exact; returns an answer even for a rank-deficient `X` ✅[^6] | `O(n·p²)` time ✅[^1]; needs all of `X` in memory |
| Gradient descent (batch or minibatch) | Works when no closed form exists, and on data streamed in minibatches ✅[^2] | Approximate; needs a learning rate and step count; diverges if the rate is too large ✅[^6] |

## Takeaways
- For plain least squares, use `LinearRegression` (or `lstsq`), not a hand-written inverse of `XᵀX`. [rule-candidate]
- Before reading coefficients, standardize the features, and check whether any two features are strongly correlated. [rule-candidate]
- Report R² on held-out data. A value near 1 on the training data says little, and a negative test value means "worse than the mean".
- A coefficient answers "what if this feature changed and the others did not", not "what causes the target".

## Verification status
- Verified: 44 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- [1.1. Linear Models (scikit-learn User Guide)](https://scikit-learn.org/stable/modules/linear_model.html) — scikit-learn developers, living (1.9.1 docs). Backs: the model `ŷ = w₀ + Σwᵢxᵢ`, `coef_`/`intercept_`, minimizing `‖Xw − y‖²`, SVD with `O(n·p²)` cost, multicollinearity and large variance, the `[0.5, 0.5]` example, `positive=True` (NNLS). [^1]
- [3.1. Linear Regression (Dive into Deep Learning)](https://d2l.ai/chapter_linear-regression/linear-regression.html) — Zhang, Lipton, Li, Smola, living. Backs: intercept as a column of 1s, the normal-equation derivation and its uniqueness condition, squared loss and outliers, minibatch SGD (stochastic gradient descent) when there is no analytic solution, MSE (mean squared error) = maximum likelihood under Gaussian noise. [^2]
- [LinearRegression (scikit-learn API)](https://scikit-learn.org/stable/modules/generated/sklearn.linear_model.LinearRegression.html) — scikit-learn developers, living (1.9.1 docs). Backs: wraps `scipy.linalg.lstsq` on dense data and `scipy.sparse.linalg.lsqr` on sparse data; `score` defines R² = `1 − u/v`, best 1.0, constant model 0.0, can be negative. [^3]
- [r2_score (scikit-learn API)](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.r2_score.html) — scikit-learn developers, living (1.9.1 docs). Backs: a constant `y_true` gives a non-finite R², replaced by 1.0 or 0.0 unless `force_finite=False`. [^4]
- [Common pitfalls in the interpretation of coefficients of linear models](https://scikit-learn.org/stable/auto_examples/inspection/plot_linear_model_coefficient_interpretation.html) — scikit-learn developers, living (1.9.1 docs). Backs: scaling coefficients by standard deviation, coefficients are conditional dependencies, correlated features make coefficients unstable, caution about causality. [^5]
- `machine-learning/lab-setup.md` — the lab where the three-way fit, the residual check, R², divergence, collinearity and rank experiments ran on 2026-11-24. [^6]

## Related
- `machine-learning/foundations/loss-functions-and-maximum-likelihood.md` — squared error as a loss and as Gaussian maximum likelihood.
- `machine-learning/foundations/gradient-descent.md` — the iterative alternative to the closed form, learning rate and scaling.
- `machine-learning/foundations/regularization.md` — ridge and lasso, the fix for correlated features and `p > n`.
- `machine-learning/foundations/generalization-and-overfitting.md` — why R² must be measured on held-out data.
- `machine-learning/supervised-learning/logistic-regression.md` — the same linear score, turned into a probability for classification.
- `machine-learning/evaluation/metrics-catalog.md` — R² next to the other regression metrics.
- `machine-learning/supervised-learning/generalized-linear-models.md` — the family linear regression belongs to.
