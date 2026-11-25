---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/supervised-learning
status: verified
applies-to: ["scikit-learn 1.9.1"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, supervised-learning, discriminant-analysis, lda, qda, generative-classifier, shrinkage, ledoit-wolf, dimensionality-reduction, mahalanobis, naive-bayes]
---

# Discriminant analysis: LDA, QDA and shrinkage

## Summary
**TL;DR:** Discriminant analysis is a generative classifier: it models what each class looks like, a Gaussian with its own mean, and then picks the class with the highest posterior by Bayes' rule. LDA (linear discriminant analysis) gives every class the same covariance matrix, so the quadratic terms cancel and the boundary is linear; QDA (quadratic discriminant analysis) gives each class its own covariance, so the boundary is quadratic and the model needs many more parameters. Both have closed-form fits. When features are many and samples few, the covariance estimate is poor or singular, and shrinking it toward a diagonal (Ledoit–Wolf) helps a lot. LDA also projects the data onto at most `K − 1` directions that separate `K` classes, a supervised alternative to PCA (principal component analysis).
**Use this when:** you need a fast, closed-form multiclass classifier or a baseline, have few samples per feature, want a supervised 2-D view of labelled data, or choose between LDA, QDA, Gaussian naive Bayes and logistic regression.
**Not this doc:** unsupervised projection → `machine-learning/unsupervised-learning/principal-component-analysis.md`; diagonal-covariance Gaussian models and smoothing → `machine-learning/probabilistic-ml/naive-bayes.md`; the discriminative linear classifier → `machine-learning/supervised-learning/logistic-regression.md`; Bayes' rule itself → `machine-learning/probabilistic-ml/bayesian-inference.md`.

## Problem
A linear classifier and a quadratic one make different bets, and the wrong bet costs a lot. In the lab, two classes with almost the same mean but differently shaped spreads are separated at 0.572 accuracy by LDA and 0.706 by QDA; with a shared shape, 10 features and only 15 samples per class, the order flips, 0.625 for LDA against 0.541 for QDA ✅[^8]. With 20 training points and 20 features, the plain covariance estimate is singular and LDA's test accuracy drops to 0.753, while the shrunk estimate keeps 0.952 ✅[^8]. Knowing what each model estimates tells you which one the data can afford.

## Mental model
**Analogy:** sorting fruit by measuring it. For each kind of fruit you record a typical size and weight (the class mean) and how much they vary and move together (the covariance), like a template drawn as an ellipse. A new fruit goes to the template it fits best, adjusted for how common that fruit is (the prior). LDA uses one ellipse shape for all fruit, just moved to each mean, so the borders between templates are straight lines. QDA lets each fruit have its own ellipse: apples round, bananas long, and borders curve. Shrinkage is what you do with only a handful of fruit per kind: you straighten the ellipse toward one with no tilt (no correlations between the measurements) instead of trusting a shape drawn from five points.

**Artifact:** LDA fitted by hand on scikit-learn's wine data (178 wines, 13 features, 3 classes) against the library, printed by the full script in the Worked example; lab run (`machine-learning/lab-setup.md`), 2026-11-25, scikit-learn 1.9.1 ✅[^8]:

```text
LDA by hand vs sklearn lsqr: max |coef diff| 1.22e-12  max |intercept diff| 3.87e-12
same predictions as sklearn svd solver: 1.000  max |proba diff| 4.10e-13
```

The hand fit is four lines: class priors, class means, one pooled covariance, and a linear score per class.

## How it works
### The generative recipe
1. **Model each class.** `P(x | y = k)` is a multivariate Gaussian with mean `μ_k` and covariance `Σ_k`, density `(2π)^(−d/2) |Σ_k|^(−1/2) exp(−½ (x − μ_k)ᵀ Σ_k⁻¹ (x − μ_k))`, where `d` is the number of features and `|Σ_k|` the determinant ✅[^1].
2. **Apply Bayes' rule.** `P(y = k | x) = P(x | y = k) · P(y = k) / Σ_l P(x | y = l) · P(y = l)`, and predict the class with the largest posterior ✅[^1]. The priors `P(y = k)` default to the class proportions in the training data and can be set with `priors` ✅[^2].
3. **Estimate by counting and averaging.** The fit needs only the priors, the class means and the covariance matrices, so it has a closed form; scikit-learn's guide calls the two models inherently multiclass and free of hyperparameters to tune ✅[^1].

### QDA: one covariance per class
4. **Log posterior.** `log P(y = k | x) = −½ log|Σ_k| − ½ (x − μ_k)ᵀ Σ_k⁻¹ (x − μ_k) + log P(y = k) + constant`, quadratic in `x`, so the boundaries are quadratic ✅[^1].
5. **Cost.** Each class needs its own covariance, `d(d + 1)/2` numbers: for wine's 13 features that is 91 per class, 273 in all, from 178 wines. scikit-learn's `covariance_` holds the maximum-likelihood (biased) estimate per class ✅[^3].
6. **Regularizing QDA.** `reg_param` pulls each class's variances along its principal axes (`S2`, the class's `scalings_`) toward 1: `S2 = (1 − reg_param) · S2 + reg_param · I` ✅[^3]; in scikit-learn 1.9.1 QDA also accepts `shrinkage` with the `eigen` solver, meant for classes with few points relative to the number of features ✅[^3].
7. **Naive Bayes is diagonal QDA.** With diagonal covariances the features are conditionally independent within each class, and QDA becomes Gaussian naive Bayes ✅[^1]. Lab: a hand-written diagonal QDA and `GaussianNB(var_smoothing=0)` give the same predictions on all 178 wines ✅[^8].

### LDA: one shared covariance
8. **Log posterior.** With `Σ_k = Σ` for all classes, `log P(y = k | x) = −½ (x − μ_k)ᵀ Σ⁻¹ (x − μ_k) + log P(y = k) + constant` ✅[^1]. The quadratic term `(x − μ_k)ᵀΣ⁻¹(x − μ_k)` is the squared Mahalanobis distance from `x` to the class mean, a distance that accounts for each feature's variance; LDA picks the nearest mean in that distance, adjusted by the prior ✅[^1].
9. **Linear scores.** Expanding gives `log P(y = k | x) = ω_kᵀ x + ω_k0 + constant`, with `ω_k = Σ⁻¹ μ_k` (scikit-learn's `coef_`) and `ω_k0 = −½ μ_kᵀ Σ⁻¹ μ_k + log P(y = k)` (`intercept_`) ✅[^1]. Changing the priors moves only `ω_k0`.
10. **The pooled covariance.** scikit-learn's `covariance_` is `Σ_k prior_k · C_k`, the prior-weighted sum of each class's biased covariance `C_k` ✅[^2]: the within-class scatter divided by `n`. The lab's hand fit with that estimate matches `coef_` to `1.22e-12` ✅[^8].
11. **Solvers.** `svd` (the default) never forms the covariance matrix, so it suits many features, but it cannot shrink; `lsqr` solves `Σ ω = μ_k` for classification only and supports shrinkage and custom covariance estimators; `eigen` maximizes the ratio of between-class to within-class scatter and supports both shrinkage and `transform` ✅[^1].

### Shrinkage
12. **Why.** With few samples per feature, the empirical covariance is a poor estimator, and shrinkage improves generalization ✅[^1]. The maximum-likelihood covariance estimates its eigenvalues badly, so its inverse is inaccurate, and sometimes it cannot be inverted at all ✅[^4].
13. **How.** The basic shrunk estimate is `Σ_shrunk = (1 − α) · Σ̂ + α · (Tr Σ̂ / p) · I`, which narrows the ratio between the smallest and largest eigenvalues; `α` sets a bias–variance trade-off ✅[^4]. Example: `Σ̂ = diag(4, 0.01)` has trace 4.01, so `α = 0.5` gives `diag(3.0025, 1.0075)`, a condition number of 3 instead of 400. Ledoit and Wolf give a formula for the `α` that minimizes the mean squared error between the estimated and the true covariance ✅[^4].
14. **In LDA.** `shrinkage='auto'` picks the Ledoit–Wolf value; a float in `[0, 1]` fixes it, 0 meaning the empirical covariance and 1 the diagonal matrix of variances; shrinkage works only with the `lsqr` and `eigen` solvers ✅[^1] ✅[^2]. When the data really are Gaussian within each class, the OAS (oracle approximating shrinkage) estimator, passed as `covariance_estimator`, gives a lower mean squared error than Ledoit–Wolf and better accuracy ✅[^1].

### LDA as dimensionality reduction
15. **Why at most `K − 1` dimensions.** The `K` class means lie in an affine subspace of dimension at most `K − 1` (2 points on a line, 3 on a plane). LDA amounts to sphering the data so the shared covariance becomes the identity, then taking the nearest mean, and distances to the means can be measured inside that subspace, so the classifier implicitly projects onto it ✅[^1].
16. **Fewer dimensions.** Projecting further onto `L` dimensions keeps the directions along which the sphered class means vary most, a PCA of the means; `L` is `n_components`, which affects only `transform`, never `fit` or `predict` ✅[^1]. It must be at most `min(n_classes − 1, n_features)` ✅[^2].
17. **Against PCA.** PCA keeps the directions with the most total variance and ignores the labels; LDA keeps those with the most variance between classes, using the labels ✅[^6].

### LDA and logistic regression
18. **Same form.** For two classes, LDA's log-odds is `(ω_1 − ω_0)ᵀ x + (ω_10 − ω_00)`, linear in `x`, the same form as logistic regression (`machine-learning/supervised-learning/logistic-regression.md`) ✅[^1]. Lab, Gaussian classes with a shared covariance and 20,000 points per class: LDA `[1.712, 0.733, −0.28]`, logistic regression `[1.719, 0.739, −0.281]`, true `Σ⁻¹(μ_1 − μ_0)` `[1.727, 0.727, −0.273]` ✅[^8].
19. **Different fit.** LDA gets the line from estimated means and a covariance, so every point moves it; logistic regression fits the labels given `x` directly. Lab: when 10 % of class 1 lies 15 units further out on its own side (easy points that do not touch the boundary, in the training and the test set alike), LDA's test accuracy falls from 0.836 to 0.799, while logistic regression scores 0.850 ✅[^8]. That 0.850 is what an unmoved boundary scores on the easier test set (`0.9 · 0.836 + 0.1 · 1 = 0.852`), so logistic regression's line barely moved.
20. **Generative against discriminative.** Comparing naive Bayes with logistic regression, Ng and Jordan found that the discriminative model has the lower asymptotic error, while the generative one can approach its own higher asymptotic error much faster, so there can often be two regimes as the training set grows, one in which each model does better ✅[^7].

## Worked example
One script, five parts: LDA by hand on wine against scikit-learn, and diagonal QDA against `GaussianNB`, plus 5-fold cross-validated accuracy of four classifiers; QDA against LDA on two synthetic problems; LDA with and without Ledoit–Wolf shrinkage on 20 training points as the number of noise features grows (the setup of scikit-learn's shrinkage gallery example ✅[^5]); 2-D projections of wine by PCA and LDA, each scored by a 1-nearest-neighbour classifier inside a cross-validated pipeline; and LDA against logistic regression. In the output, CV means cross-validation. The core of the hand fit:

```python
pri = np.bincount(y) / n
mu = np.array([X[y == k].mean(0) for k in range(K)])
S = sum(((X[y == k] - mu[k]).T @ (X[y == k] - mu[k])) for k in range(K)) / n   # pooled covariance
W = np.linalg.solve(S, mu.T).T                     # omega_k = S^-1 mu_k
w0 = -0.5 * np.sum(W * mu, axis=1) + np.log(pri)   # -1/2 mu_k' S^-1 mu_k + log prior_k
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-25, numpy 2.5.5, scipy 1.18.1, scikit-learn 1.9.1, two runs identical ✅[^8]:

```text
LDA by hand vs sklearn lsqr: max |coef diff| 1.22e-12  max |intercept diff| 3.87e-12
same predictions as sklearn svd solver: 1.000  max |proba diff| 4.10e-13
diagonal-covariance QDA by hand vs GaussianNB(var_smoothing=0): same predictions 1.000
wine 5-fold CV accuracy LDA                0.966
wine 5-fold CV accuracy QDA                0.955
wine 5-fold CV accuracy GaussianNB         0.966
wine 5-fold CV accuracy logistic (scaled)  0.983
different covariances, 2 features:  LDA 0.572  QDA 0.706  logistic 0.571
shared covariance, 10 features, 15 per class (50 runs): LDA 0.625  QDA 0.541
features  no shrinkage  Ledoit-Wolf  (test accuracy, mean of 50 runs, 20 training points)
       1         0.972        0.972
       5         0.954        0.970
      10         0.916        0.965
      20         0.753        0.952
      40         0.781        0.925
      75         0.636        0.893
PCA 2-D: 1-nearest-neighbour 5-fold CV accuracy 0.955
LDA 2-D: 1-nearest-neighbour 5-fold CV accuracy 0.972
LDA explained_variance_ratio_ [0.687 0.313]
n_components=3: n_components cannot be larger than min(n_features, n_classes - 1).
Gaussian classes, 20,000 per class, first 3 log-odds coefs: LDA [ 1.712  0.733 -0.28 ]  logistic [ 1.719  0.739 -0.281]  true [ 1.727  0.727 -0.273]
class 1 with 0% far, easy points: test accuracy LDA 0.836  logistic 0.836
class 1 with 10% far, easy points: test accuracy LDA 0.799  logistic 0.850
class 1 with 20% far, easy points: test accuracy LDA 0.723  logistic 0.863
```

<details><summary>Full script (prints the output above)</summary>

```python
# Linear and quadratic discriminant analysis: LDA by hand vs scikit-learn, QDA vs LDA, shrinkage with
# few samples, LDA as a 2-D projection, and the links to logistic regression and Gaussian naive Bayes.
import numpy as np
from scipy.special import softmax
from sklearn.datasets import load_wine
from sklearn.discriminant_analysis import LinearDiscriminantAnalysis as LDA, QuadraticDiscriminantAnalysis as QDA
from sklearn.decomposition import PCA
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import cross_val_score
from sklearn.naive_bayes import GaussianNB
from sklearn.neighbors import KNeighborsClassifier
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

X, y = load_wine(return_X_y=True)                        # 178 wines, 13 features, 3 classes
K, n = 3, len(y)
# 1. LDA by hand: priors, class means, pooled covariance, linear scores
pri = np.bincount(y) / n
mu = np.array([X[y == k].mean(0) for k in range(K)])
S = sum(((X[y == k] - mu[k]).T @ (X[y == k] - mu[k])) for k in range(K)) / n   # = sum_k prior_k * C_k
W = np.linalg.solve(S, mu.T).T                           # omega_k = S^-1 mu_k
w0 = -0.5 * np.sum(W * mu, axis=1) + np.log(pri)         # -1/2 mu_k' S^-1 mu_k + log prior_k
scores = X @ W.T + w0
lda = LDA(solver="lsqr").fit(X, y)
print(f"LDA by hand vs sklearn lsqr: max |coef diff| {np.abs(W - lda.coef_).max():.2e}"
      f"  max |intercept diff| {np.abs(w0 - lda.intercept_).max():.2e}")
print(f"same predictions as sklearn svd solver: {np.mean(scores.argmax(1) == LDA().fit(X, y).predict(X)):.3f}"
      f"  max |proba diff| {np.abs(softmax(scores, axis=1) - lda.predict_proba(X)).max():.2e}")
# Gaussian naive Bayes = QDA with diagonal covariances
var = np.array([X[y == k].var(0) for k in range(K)])
diag = np.stack([-0.5 * np.sum(np.log(var[k]) + (X - mu[k]) ** 2 / var[k], axis=1) + np.log(pri[k]) for k in range(K)], 1)
print(f"diagonal-covariance QDA by hand vs GaussianNB(var_smoothing=0): same predictions"
      f" {np.mean(diag.argmax(1) == GaussianNB(var_smoothing=0).fit(X, y).predict(X)):.3f}")
for name, m in [("LDA", LDA()), ("QDA", QDA()), ("GaussianNB", GaussianNB()),
                ("logistic (scaled)", make_pipeline(StandardScaler(), LogisticRegression(max_iter=5000)))]:
    print(f"wine 5-fold CV accuracy {name:<18} {cross_val_score(m, X, y, cv=5).mean():.3f}")

rng = np.random.default_rng(0)
def gauss(n, mean, cov):
    return rng.multivariate_normal(mean, cov, size=n)
def two_class(n, m0, m1, c0, c1):
    Xs = np.vstack([gauss(n, m0, c0), gauss(n, m1, c1)]); return Xs, np.repeat([0, 1], n)
# 2. Different class covariances: QDA's quadratic boundary wins
tr = two_class(500, [0, 0], [0.5, 0], np.eye(2), np.diag([4.0, 0.25])); te = two_class(5000, [0, 0], [0.5, 0], np.eye(2), np.diag([4.0, 0.25]))
print("different covariances, 2 features:  " + "  ".join(f"{k} {m.fit(*tr).score(*te):.3f}" for k, m in
      [("LDA", LDA()), ("QDA", QDA()), ("logistic", LogisticRegression())]))
# ... and with a shared covariance, few samples and 10 features, QDA's extra parameters cost
C = 0.5 * np.eye(10) + 0.5; m1 = np.r_[0.8, np.zeros(9)]
acc = {"LDA": [], "QDA": []}
for _ in range(50):
    tr = two_class(15, np.zeros(10), m1, C, C); te = two_class(1000, np.zeros(10), m1, C, C)
    for k, m in [("LDA", LDA()), ("QDA", QDA(reg_param=0.0))]:
        acc[k].append(m.fit(*tr).score(*te))
print(f"shared covariance, 10 features, 15 per class (50 runs): LDA {np.mean(acc['LDA']):.3f}  QDA {np.mean(acc['QDA']):.3f}")

# 3. Shrinkage: 20 training points, one useful feature plus noise features (as in the scikit-learn gallery)
def blobs(n, p):
    yy = np.repeat([0, 1], n // 2); Xs = rng.normal(size=(n, p)); Xs[:, 0] += np.where(yy == 1, 2.0, -2.0); return Xs, yy
print("features  no shrinkage  Ledoit-Wolf  (test accuracy, mean of 50 runs, 20 training points)")
for p in (1, 5, 10, 20, 40, 75):
    a0, a1 = [], []
    for _ in range(50):
        (Xt, yt), (Xv, yv) = blobs(20, p), blobs(200, p)
        a0.append(LDA(solver="lsqr", shrinkage=None).fit(Xt, yt).score(Xv, yv))
        a1.append(LDA(solver="lsqr", shrinkage="auto").fit(Xt, yt).score(Xv, yv))
    print(f"{p:8d}  {np.mean(a0):12.3f}  {np.mean(a1):11.3f}")

# 4. LDA as supervised dimensionality reduction vs PCA (wine, 13 -> 2 dimensions)
for name, red in [("PCA 2-D", PCA(n_components=2)), ("LDA 2-D", LDA(n_components=2))]:
    pipe = make_pipeline(StandardScaler(), red, KNeighborsClassifier(n_neighbors=1))
    print(f"{name}: 1-nearest-neighbour 5-fold CV accuracy {cross_val_score(pipe, X, y, cv=5).mean():.3f}")
print("LDA explained_variance_ratio_", np.round(LDA(n_components=2).fit(StandardScaler().fit_transform(X), y).explained_variance_ratio_, 3))
try:
    LDA(n_components=3).fit(X, y)
except ValueError as e:
    print("n_components=3:", e)

# 5. LDA vs logistic regression: the same linear log-odds, fitted differently
C2 = 0.5 * np.eye(10) + 0.5; mb = np.r_[1.0, 0.5, np.zeros(8)]
big = two_class(20_000, np.zeros(10), mb, C2, C2)
l2, lr2 = LDA().fit(*big), LogisticRegression(C=1e6, max_iter=5000).fit(*big)
print("Gaussian classes, 20,000 per class, first 3 log-odds coefs: LDA", np.round(l2.coef_[0][:3], 3),
      " logistic", np.round(lr2.coef_[0][:3], 3), " true", np.round(np.linalg.solve(C2, mb)[:3], 3))
def far_easy(n, frac):                                   # class 1 = N((2,0), I), a fraction moved 15 further right
    X0, X1 = rng.normal(size=(n, 2)), rng.normal(size=(n, 2)) + [2.0, 0.0]
    X1[: int(frac * n), 0] += 15.0
    return np.vstack([X0, X1]), np.repeat([0, 1], n)
for frac in (0.0, 0.1, 0.2):
    tr, te = far_easy(1000, frac), far_easy(5000, frac)
    print(f"class 1 with {frac:.0%} far, easy points: test accuracy LDA {LDA().fit(*tr).score(*te):.3f}"
          f"  logistic {LogisticRegression().fit(*tr).score(*te):.3f}")
```

</details>

Reading it, line by line:
- **Lines 1–3, the mechanism:** priors, means and the pooled covariance reproduce scikit-learn's `coef_`, `intercept_`, predictions and probabilities to about `1e-12`, and the diagonal version is exactly Gaussian naive Bayes ✅[^8].
- **Lines 4–7, wine:** on real data with 48–71 wines per class, LDA (0.966) edges out QDA (0.955), whose three 91-number covariances are estimated from fewer points each; scaled logistic regression is best here at 0.983 ✅[^8].
- **Line 8:** the classes share a mean along `x2` and differ in spread (variances 1 and 1 against 4 and 0.25). A straight line separates them poorly, so LDA and logistic regression both sit near 0.57; QDA's curved boundary reaches 0.706 ✅[^8].
- **Line 9:** with a truly shared covariance, QDA estimates two 55-number covariances from 15 points each and loses to LDA, 0.541 against 0.625 ✅[^8].
- **Lines 10–16, shrinkage:** with 1 feature the two agree (0.972). From 5 features on, Ledoit–Wolf wins. The plain estimate dips at 20 features, equal to the 20 training points, where its pooled covariance (rank at most 20 − 2 = 18) first becomes singular (0.753 against 0.952), and is worst at 75 features, 1 useful and 74 noise (0.636), where the gap is widest and shrinkage still holds 0.893 ✅[^8].
- **Lines 17–20, projection:** squeezed to 2 dimensions, LDA's view keeps more of the class structure than PCA's (1-nearest-neighbour accuracy 0.972 against 0.955); the first LDA direction carries 68.7 % of the between-class variance. Asking for a third direction with 3 classes raises an error ✅[^8].
- **Lines 21–24, logistic regression:** when the Gaussian model is right, both fits find the true log-odds coefficients to within about 0.015. When 10 or 20 % of class 1 lies far out on its own side, LDA's mean and covariance move with those points and accuracy falls to 0.799 and 0.723. Logistic regression's 0.850 and 0.863 are close to what its unmoved boundary would score on test sets that are 10 and 20 % easy points (`0.852` and `0.8 · 0.836 + 0.2 · 1 = 0.869`): it did not improve, it simply ignored those points ✅[^8].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Features ≥ samples, no shrinkage | Covariance singular or badly estimated; lab LDA 0.753 at 20 features and 20 points | Poor eigenvalue estimates, inverse inaccurate ✅[^4]; lab ✅[^8] |
| `shrinkage` with the default `svd` solver | Not supported | Shrinkage works only with `lsqr` and `eigen` ✅[^1] ✅[^2] |
| `n_components > K − 1` | `ValueError` (lab message) | Means span at most `K − 1` dimensions ✅[^1] ✅[^8] |
| Two classes | LDA's projection is a single direction | Output dimension is below the number of classes ✅[^1] |
| Nearly equal means (0.5 apart), different spreads | LDA near chance (lab 0.572), QDA 0.706 | LDA's boundary is linear ✅[^1]; lab ✅[^8] |
| QDA with few points per class | Worse than LDA (lab 0.541 vs 0.625) | One covariance per class to estimate; `reg_param` or `shrinkage` regularize it ✅[^3] |
| A class with fewer points than features in QDA | Rank-deficient class covariance; a warning, controlled by `tol` | `tol` sets the rank-deficiency warning threshold, without changing predictions ✅[^3] |
| Non-Gaussian classes (far, easy points) | LDA's boundary moves (lab 0.836 → 0.723) | Means and covariance follow every point ✅[^8] |
| Class mix differs at deployment | Posteriors miscalibrated for the new mix | Set `priors` ✅[^2]; priors enter only `ω_k0` ✅[^1]; estimating the new mix: `machine-learning/ml-systems/domain-adaptation.md` |
| LDA projection fitted before cross-validation | Optimistic scores: the projection used the test labels | Fit it inside the pipeline (lab `make_pipeline`); see `machine-learning/evaluation/data-leakage.md` |
| `shrinkage=1` in LDA vs `ShrunkCovariance` | Different targets: the diagonal of variances in LDA ✅[^1], a scaled identity in `ShrunkCovariance` ✅[^4] | Two shrinkage targets in two scikit-learn classes |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| LDA | Closed form, multiclass, no tuning needed ✅[^1]; doubles as a projection ✅[^1] | Linear boundary only ✅[^1]; sensitive to non-Gaussian classes (lab) ✅[^8] |
| QDA | Quadratic boundaries for classes of different shape ✅[^1] | One covariance per class; loses with few samples (lab) ✅[^8] |
| LDA with Ledoit–Wolf shrinkage | Holds up when features ≈ or > samples (lab 0.952 at `p = n`) ✅[^8] | Needs `lsqr` or `eigen` ✅[^1]; OAS can do better on Gaussian data ✅[^1] |
| Gaussian naive Bayes (diagonal QDA) | `d` variances per class instead of `d(d + 1)/2` covariance entries (diagonal QDA ✅[^1]) | Ignores correlations between features; see `machine-learning/probabilistic-ml/naive-bayes.md` |
| Logistic regression | Unmoved by far, easy points that LDA's means follow (lab) ✅[^8]; lower asymptotic error than a generative rival (Ng and Jordan, naive Bayes) ✅[^7] | Needs more data to reach it in that comparison ✅[^7]; iterative fit |

## Takeaways
- Start with LDA as a baseline for small, labelled, roughly Gaussian data; it fits in closed form and needs no tuning.
- When features are many relative to samples, use `LinearDiscriminantAnalysis(solver="lsqr", shrinkage="auto")` instead of the default; in the lab it never lost to the plain estimate. [rule-candidate]
- Prefer QDA only when classes clearly differ in spread and each class has many more samples than features.
- Fit an LDA projection inside the cross-validation pipeline, never on all the data first. [rule-candidate]

## Verification status
- Verified: 72 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [1.2. Linear and Quadratic Discriminant Analysis (User Guide)](https://scikit-learn.org/stable/modules/lda_qda.html) — scikit-learn developers, living (1.9.1). Backs: Gaussian class model and Bayes' rule, closed form and no hyperparameters, QDA and LDA log posteriors, Mahalanobis interpretation, `ω_k` and `ω_k0`, diagonal QDA = Gaussian naive Bayes, `K − 1` subspace and sphering, `n_components` only for `transform`, shrinkage purpose, `'auto'`, 0 and 1, solver restrictions, OAS, the three solvers. [^1]
- [sklearn.discriminant_analysis.LinearDiscriminantAnalysis](https://scikit-learn.org/stable/modules/generated/sklearn.discriminant_analysis.LinearDiscriminantAnalysis.html) — scikit-learn developers, living (1.9.1). Backs: `priors` default, `covariance_` as the prior-weighted biased class covariances, `n_components ≤ min(n_classes − 1, n_features)`, shrinkage only with `lsqr`/`eigen`. [^2]
- [sklearn.discriminant_analysis.QuadraticDiscriminantAnalysis](https://scikit-learn.org/stable/modules/generated/sklearn.discriminant_analysis.QuadraticDiscriminantAnalysis.html) — scikit-learn developers, living (1.9.1). Backs: biased per-class `covariance_`, `reg_param` formula, `shrinkage` with the `eigen` solver, `tol` for rank-deficiency warnings. [^3]
- [2.6. Covariance estimation, Shrunk Covariance (User Guide)](https://scikit-learn.org/stable/modules/covariance.html) — scikit-learn developers, living (1.9.1). Backs: poor eigenvalue estimates of the maximum-likelihood covariance, non-invertible cases, the convex shrinkage formula, Ledoit–Wolf minimizes mean squared error. [^4]
- [Normal, Ledoit-Wolf and OAS Linear Discriminant Analysis for classification (scikit-learn gallery)](https://scikit-learn.org/stable/auto_examples/classification/plot_lda.html) — scikit-learn developers, living (1.9.1). Backs: the shrinkage experiment design (20 training points, one discriminative feature plus noise features). [^5]
- [Comparison of LDA and PCA 2D projection of Iris dataset (scikit-learn gallery)](https://scikit-learn.org/stable/auto_examples/decomposition/plot_pca_vs_lda.html) — scikit-learn developers, living (1.9.1). Backs: PCA keeps directions of most variance, LDA those of most between-class variance, using the labels. [^6]
- [On Discriminative vs. Generative Classifiers: A comparison of logistic regression and naive Bayes](https://papers.nips.cc/paper/2001/hash/7b7a53e239400a13bd6be6c91c4f6c4e-Abstract.html) — Andrew Y. Ng, Michael I. Jordan, NIPS 2001 (abstract page). Backs: lower asymptotic error of the discriminative model, faster approach of the generative one, two regimes. [^7]
- `machine-learning/lab-setup.md` — the lab where the hand-fitted LDA, the QDA, shrinkage and projection comparisons and the LDA-vs-logistic runs ran on 2026-11-25. [^8]

## Related
- `machine-learning/supervised-learning/logistic-regression.md` — the discriminative model with the same linear log-odds.
- `machine-learning/probabilistic-ml/naive-bayes.md` — the diagonal-covariance generative classifier.
- `machine-learning/unsupervised-learning/principal-component-analysis.md` — the unsupervised projection LDA is compared with.
- `machine-learning/unsupervised-learning/gaussian-mixtures-and-em.md` — Gaussian class models when the labels are unknown.
- `machine-learning/foundations/regularization.md` — shrinkage as one more bias-for-variance trade.
- `machine-learning/ml-systems/domain-adaptation.md` — correcting the priors when the class mix shifts.
