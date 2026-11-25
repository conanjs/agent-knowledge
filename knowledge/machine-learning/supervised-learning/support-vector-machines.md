---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/supervised-learning
status: verified
applies-to: ["scikit-learn 1.9.1", "NumPy 2.5.5"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [machine-learning, supervised-learning, svm, support-vector-machine, maximum-margin, hinge-loss, soft-margin, kernel-trick, rbf, gamma, scikit-learn]
---

# Support vector machines: maximum margin, hinge loss, C and the RBF kernel

## Summary
**TL;DR:** A linear SVM (support vector machine) separates two classes with the line or plane that leaves the widest empty band, the margin, between them. The margin is `2/‖w‖` wide, so maximizing it means making the weights small. The soft-margin version lets points sit inside the band or on the wrong side and charges each one a hinge loss, `max(0, 1 − y·f(x))`. `C` sets the price: a small `C` gives a wide band with many violations, a large `C` a narrow one with few. Only the points on their margin edge or violating it (inside the band or on the wrong side), the support vectors, define the model. The kernel trick replaces dot products with a similarity `K(x, x')`. With the RBF (radial basis function) kernel, `gamma` sets how far each support vector's influence reaches, from almost linear (small `gamma`) to memorizing each point (large `gamma`).
**Use this when:** you train `SVC`, `LinearSVC` or `SVR` (support vector regression), tune `C` and `gamma`, wonder why scaling changed an SVM's accuracy completely, or need to read `support_vectors_` and `dual_coef_`.
**Not this doc:** hinge loss next to the other losses → `machine-learning/foundations/loss-functions-and-maximum-likelihood.md`; searching `C` and `gamma` on a grid → `machine-learning/evaluation/cross-validation-and-hyperparameter-search.md`; turning SVM scores into calibrated probabilities → `machine-learning/evaluation/probability-calibration.md`; kernels as covariance functions → `machine-learning/probabilistic-ml/gaussian-processes.md`.

## Problem
Many lines can separate two classes perfectly, and they generalize differently: the one that barely clears some training points leaves new points little room, and in general a larger margin means a lower generalization error ✅[^1]. Real classes overlap, so some violations must be allowed, and someone has to decide how many. Non-linear boundaries seem to need hand-made features. And an RBF SVM is very sensitive to its two knobs and to feature scale. In the lab, the same `SVC()` scored 0.648 on raw wine features and 1.000 after standardizing ✅[^5], and `gamma=1000` gave 1.000 training but 0.575 test accuracy ✅[^5].

## Mental model
**Analogy:** building the widest possible road between two neighbourhoods. The road's edges must not cut through houses, so only the houses right on the kerb decide where it can go: those are the support vectors. Houses deeper in either neighbourhood could move anywhere on their own side, away from the kerb, without changing the road. If the neighbourhoods overlap, you allow some houses on the road or across it, and pay a fine per metre of intrusion: `C` is the fine. For a curved border, imagine lifting the map into 3-D so that a flat sheet separates the two sides. The kernel computes "how similar are these two houses" as if in that lifted space, without ever building it.

**Artifact:** a hard-margin linear SVM on 40 separable points, from the lab script in the Worked example ✅[^5]. `f(x) = w·x + b` is the decision function and `y = ±1` the label:

```text
w=[0.528  0.5026] b=-0.1034 |w|=0.7289 margin half-width 1/|w|=1.3719 full width 2/|w|=2.7437
support vectors: 3  y*f(x) on them: [1. 1. 1.]
min y*f(x) over all 40 points: 1.0000
```

Three of the 40 points define the model; each sits exactly on its margin edge (`y·f(x) = 1`), and no point is closer to the separating line than that.

## How it works
Symbols: `n` training rows `x_i` with labels `y_i ∈ {−1, +1}`; `f(x) = w·x + b` (`decision_function`); `‖w‖` is the length of the weight vector; `ζ_i` (zeta) is how far row `i` is on the wrong side of its margin edge; `α_i` are the dual coefficients.

1. **Prediction.** The class is the sign of `f(x) = wᵀφ(x) + b`, where `φ` maps the input into another feature space (`φ(x) = x` for a linear SVM) ✅[^1].
2. **Margin.** The margin edges are where `f(x) = ±1`. Each edge lies `1/‖w‖` from the separating line ✅[^2], so the band is `2/‖w‖` wide. A larger margin generally means lower generalization error ✅[^1]. Artifact: `‖w‖ = 0.7289`, so the band is `2/0.7289 = 2.744` wide.
3. **Soft-margin objective.** `SVC` solves: minimize `½·wᵀw + C·Σ ζ_i`, subject to `y_i·f(x_i) ≥ 1 − ζ_i` and `ζ_i ≥ 0` ✅[^1]. Small `wᵀw` means a wide margin; each violation `ζ_i` costs `C`. So `C` acts as an inverse regularization strength ✅[^1].
4. **Hinge loss.** The same objective written without constraints is `½·wᵀw + C·Σ max(0, 1 − y_i·f(x_i))`, using the hinge loss; this is the form `LinearSVC` optimizes directly ✅[^1], although `LinearSVC`'s default loss is the squared hinge ✅[^1] (see Edge cases). Examples with `y = +1`: `f = 1.5` → loss 0 (beyond the margin); `f = 0.3` → 0.7 (inside the band, still correct); `f = −0.5` → 1.5 (misclassified). Unlike log loss, the hinge loss is exactly zero for points safely beyond the margin.
5. **Dual and support vectors.** The equivalent dual problem has one coefficient `α_i` per training row: minimize `½·Σ_i Σ_j α_i·α_j·y_i·y_j·K(x_i, x_j) − Σ_i α_i`, subject to `Σ_i y_i·α_i = 0` and `0 ≤ α_i ≤ C` ✅[^1], where `K(x_i, x_j) = φ(x_i)ᵀφ(x_j)` (step 6). Only rows on their margin edge or violating it (`y_i·f(x_i) ≤ 1`, misclassified rows included) get `α_i > 0`; they are the support vectors ✅[^1]. In the lab at `C = 1`, 68 of the 71 support vectors sat at the upper bound `α_i = C` ✅[^5].
6. **Kernel trick.** The dual depends on the data only through `K(x_i, x_j) = φ(x_i)ᵀφ(x_j)`. After training, `f(x) = Σ_{i∈SV} y_i·α_i·K(x_i, x) + b`, where SV is the set of support vectors ✅[^1]. scikit-learn stores `y_i·α_i` in `dual_coef_`, the support vectors in `support_vectors_` and `b` in `intercept_` ✅[^1]. Lab: rebuilding `f` by hand from those three attributes matched `decision_function` to `1.4e-14`, using 69 of 200 training rows ✅[^5].
7. **Kernels.** Linear `⟨x, x'⟩`; polynomial `(γ⟨x, x'⟩ + r)^d`; RBF `exp(−γ‖x − x'‖²)` with `γ > 0`; sigmoid `tanh(γ⟨x, x'⟩ + r)` ✅[^1]. RBF example, `γ = 1`: two points at distance 1 have `K = e^(−1) = 0.37`; at distance 3, `K = e^(−9) = 0.0001`.
8. **`gamma`.** `gamma` sets how far one training example's influence reaches: low values mean far, high values mean close. It acts as the inverse of the support vectors' radius of influence ✅[^3]. The default `gamma='scale'` is `1 / (n_features · X.var())` ✅[^4] (0.887 on the lab's moons data ✅[^5]).
9. **`C` with the RBF kernel.** A low `C` makes the decision surface smooth; a high `C` tries to classify every training example correctly ✅[^1]. Lower `C` generally means more support vectors ✅[^3].
10. **Multi-class.** `SVC` trains one-vs-one: `K·(K − 1)/2` binary classifiers for `K` classes. By default `decision_function` still returns one column per class (`decision_function_shape="ovr"`) ✅[^1].
11. **Cost.** Training is a quadratic program that scales between `O(p·n²)` and `O(p·n³)`; `LinearSVC` (liblinear) scales almost linearly to millions of rows ✅[^1].

## Worked example
Five experiments: the hard margin of the Artifact; a `C` sweep with a linear kernel on overlapping classes; the RBF decision function rebuilt by hand; a `gamma` sweep on noisy two-moons data (two interleaved half-circles); and scaling on wine. The core of the kernel check:

```python
K = np.exp(-1.0 * ((Xte[:, None, :] - rbf.support_vectors_[None, :, :]) ** 2).sum(axis=2))  # K(sv, x), gamma = 1
f_hand = K @ rbf.dual_coef_[0] + rbf.intercept_[0]       # Σ y_i α_i K(x_i, x) + b
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-24, scikit-learn 1.9.1, NumPy 2.5.5, two runs identical ✅[^5]:

```text
w=[0.528  0.5026] b=-0.1034 |w|=0.7289 margin half-width 1/|w|=1.3719 full width 2/|w|=2.7437
support vectors: 3  y*f(x) on them: [1. 1. 1.]
min y*f(x) over all 40 points: 1.0000
C=0.001  SVs=198 (at bound C: 198) width 2/|w|=10.583  sum of hinge losses=162.3  train=0.640 test=0.635
C=0.01   SVs=140 (at bound C: 137) width 2/|w|=2.892  sum of hinge losses=91.0  train=0.865 test=0.860
C=0.1    SVs=87  (at bound C: 84 ) width 2/|w|=1.631  sum of hinge losses=70.6  train=0.860 test=0.865
C=1      SVs=71  (at bound C: 68 ) width 2/|w|=1.127  sum of hinge losses=66.7  train=0.875 test=0.860
C=10     SVs=68  (at bound C: 65 ) width 2/|w|=1.032  sum of hinge losses=66.6  train=0.870 test=0.860
C=100    SVs=68  (at bound C: 65 ) width 2/|w|=1.032  sum of hinge losses=66.6  train=0.870 test=0.860
RBF decision function by hand vs sklearn: max |diff| = 1.4e-14 (SVs used: 69 of 200)
gamma='scale' would be 0.887 here
gamma=0.01  SVs=148 train acc=0.820 test acc=0.865
gamma=0.1   SVs=95  train acc=0.860 test acc=0.870
gamma=1     SVs=69  train acc=0.905 test acc=0.910
gamma=10    SVs=112 train acc=0.910 test acc=0.905
gamma=100   SVs=187 train acc=0.975 test acc=0.820
gamma=1000  SVs=200 train acc=1.000 test acc=0.575
wine SVC(rbf) test acc: raw=0.648  standardized=1.000
```

<details><summary>Full script (prints the output above)</summary>

```python
# SVM: margin = 1/|w|, decision function rebuilt from support vectors, C vs support vectors, RBF gamma sweep.
import numpy as np
from sklearn.datasets import make_classification, make_moons, load_wine
from sklearn.model_selection import train_test_split
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC

# 1. Separable data, (almost) hard margin
rng = np.random.default_rng(0)
X = np.r_[rng.normal(size=(20, 2)) - 2, rng.normal(size=(20, 2)) + 2]; y = np.r_[-np.ones(20), np.ones(20)]
svm = SVC(kernel="linear", C=1e6).fit(X, y)
w, b = svm.coef_[0], svm.intercept_[0]
f = X @ w + b                                         # decision function by hand
print("w=%s b=%.4f |w|=%.4f margin half-width 1/|w|=%.4f full width 2/|w|=%.4f"
      % (np.round(w, 4), b, np.linalg.norm(w), 1 / np.linalg.norm(w), 2 / np.linalg.norm(w)))
print("support vectors:", len(svm.support_), " y*f(x) on them:", np.round(y[svm.support_] * f[svm.support_], 4))
print("min y*f(x) over all 40 points: %.4f" % (y * f).min())

# 2. Overlapping classes: C trades margin width against margin violations (hinge loss)
X, y = make_classification(n_samples=400, n_features=2, n_redundant=0, n_informative=2,
                           n_clusters_per_class=1, class_sep=1.0, random_state=0)
y = 2 * y - 1
Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.5, random_state=0)
for C in [0.001, 0.01, 0.1, 1, 10, 100]:
    m = SVC(kernel="linear", C=C).fit(Xtr, ytr)
    wn = np.linalg.norm(m.coef_); fm = m.decision_function(Xtr)
    hinge = np.maximum(0, 1 - ytr * fm).sum()
    at_bound = (np.abs(m.dual_coef_[0]) > C * (1 - 1e-6)).sum()
    print("C=%-6g SVs=%-3d (at bound C: %-3d) width 2/|w|=%.3f  sum of hinge losses=%.1f  train=%.3f test=%.3f"
          % (C, m.n_support_.sum(), at_bound, 2 / wn, hinge, m.score(Xtr, ytr), m.score(Xte, yte)))

# 3. Kernel trick: rebuild the RBF decision function from dual_coef_ (= y_i * alpha_i) and support vectors
X, y = make_moons(n_samples=400, noise=0.3, random_state=0)
Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.5, random_state=0)
rbf = SVC(kernel="rbf", gamma=1.0, C=1.0).fit(Xtr, ytr)
K = np.exp(-1.0 * ((Xte[:, None, :] - rbf.support_vectors_[None, :, :]) ** 2).sum(axis=2))
f_hand = K @ rbf.dual_coef_[0] + rbf.intercept_[0]
print("RBF decision function by hand vs sklearn: max |diff| = %.1e (SVs used: %d of %d)"
      % (abs(f_hand - rbf.decision_function(Xte)).max(), len(rbf.support_), len(Xtr)))

# 4. gamma: from underfitting to overfitting (C=1)
print("gamma='scale' would be %.3f here" % (1 / (Xtr.shape[1] * Xtr.var())))
for gamma in [0.01, 0.1, 1, 10, 100, 1000]:
    m = SVC(kernel="rbf", gamma=gamma, C=1.0).fit(Xtr, ytr)
    print("gamma=%-5g SVs=%-3d train acc=%.3f test acc=%.3f" % (gamma, len(m.support_), m.score(Xtr, ytr), m.score(Xte, yte)))

# 5. Scaling: the RBF kernel uses distances, so a large-range feature dominates (wine)
Xw, yw = load_wine(return_X_y=True)
Xtr, Xte, ytr, yte = train_test_split(Xw, yw, test_size=0.3, random_state=0, stratify=yw)
print("wine SVC(rbf) test acc: raw=%.3f  standardized=%.3f"
      % (SVC().fit(Xtr, ytr).score(Xte, yte), make_pipeline(StandardScaler(), SVC()).fit(Xtr, ytr).score(Xte, yte)))
```

</details>

Reading it line by line:
- **Lines 1–3:** the Artifact. With `C = 10⁶` (practically a hard margin), three support vectors sit exactly at `y·f(x) = 1`, and every other point is at least as far out.
- **Lines 4–9:** as `C` grows from 0.001 to 100, the band narrows from 10.58 to 1.03, the support vectors drop from 198 (almost every training row) to 68, and the total hinge loss falls from 162 to 67. Test accuracy is 0.635 at `C = 0.001`, where the band is so wide that the model underfits, and flat at about 0.86 from `C = 0.01` up. The last two rows are identical: beyond `C = 10`, the solution no longer changes. Nearly all support vectors sit at the bound `α_i = C` (at `C = 1`, only 3 of 71 are strictly between 0 and `C`).
- **Line 10:** `Σ dual_coef_ · K(support_vectors_, x) + intercept_` is the decision function; only 69 of the 200 training rows are needed to predict.
- **Line 11:** the default `gamma='scale'` would pick 0.887 for these features.
- **Lines 12–17:** `gamma` from 0.01 to 1000: test accuracy rises to 0.910 at `gamma = 1`, then falls to 0.575 while training accuracy reaches 1.000 and every training row becomes a support vector (200 of 200). Small `gamma` underfits (0.820 train), and both extremes need many support vectors.
- **Line 18:** the default RBF `SVC()` scores 0.648 on raw wine features and 1.000 after `StandardScaler`.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Unscaled features | Accuracy collapses (wine 0.648 raw vs 1.000 standardized) ✅[^5] | SVMs are not scale invariant; scale to [0, 1], [−1, +1] or mean 0, variance 1, and apply the same scaling to test data ✅[^1] |
| Very large `gamma` | Training 1.000, test 0.575; every row is a support vector ✅[^5] | Each support vector's influence covers only itself, and no `C` can prevent overfitting ✅[^3] |
| Very small `gamma` | Close to a linear model; underfits (0.820 train at 0.01) ✅[^5] | Each support vector's influence covers the whole training set ✅[^3] |
| Increasing `C` past a point | No change (`C = 10` and `C = 100` identical in the lab) ✅[^5] | The RBF-parameters example sees the same plateau and says it is likely because no training points are left in violation, or no better solution can be found ✅[^3]; here 65 rows still sit at the bound, so it is the second case. Very high `C` typically increases fitting time ✅[^3] |
| Noisy labels | A large `C` chases them | Decrease `C`: lower `C` means more regularization ✅[^1] |
| `SVC(probability=True)` | Probabilities come from Platt scaling with an internal 5-fold cross-validation: expensive, and `predict` can disagree with `predict_proba` > 0.5 ✅[^1] | A separate logistic model is fitted on the scores; use `decision_function` if scores are enough ✅[^1] |
| `LinearSVC` vs `SVC(kernel="linear")` | Results can differ ✅[^1] | `LinearSVC` uses the squared hinge loss and also regularizes the intercept ✅[^1] |
| Many more features than rows | Overfitting risk | Choosing the kernel and regularization becomes crucial ✅[^1] |
| Unbalanced classes | The minority class is under-weighted | Set `class_weight='balanced'` and/or try different `C` ✅[^1] |
| Large `n` with a kernel | Training time grows between `n²` and `n³` ✅[^1] | Use `LinearSVC`, or a kernel approximation ✅[^1] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Small `C` | Wide margin, smooth boundary ✅[^1] | More support vectors, slower prediction ✅[^3]; underfits at the extreme (0.635 at `C = 0.001`) ✅[^5] |
| Large `C` | Fits the training data more closely ✅[^1] | Narrow margin; longer fitting ✅[^3] |
| Linear kernel / `LinearSVC` | Scales almost linearly to millions of rows ✅[^1] | Only linear boundaries; the kernel trick does not apply to the primal form ✅[^1] |
| RBF kernel | Non-linear boundaries from two knobs, `C` and `gamma` ✅[^1] | Must tune both, ideally on an exponential grid with `GridSearchCV` ✅[^1]; `O(n²)`–`O(n³)` training ✅[^1] |
| SVM vs logistic regression | Sparse model: only support vectors matter ✅[^1]; effective with many dimensions ✅[^1] | No native probabilities; the Platt step is costly ✅[^1] |

## Takeaways
- Always scale features before an SVM, inside a pipeline. [rule-candidate]
- Tune `C` and `gamma` together on a log-spaced grid (for example `10⁻³ … 10³`); the good models lie on a diagonal of the two. [rule-candidate]
- Use `decision_function` for ranking; turn on `probability=True` only when you need probabilities and can afford the extra cross-validation.
- For large `n`, prefer `LinearSVC` (or a linear model trained by SGD, stochastic gradient descent) over a kernel SVM.
- The support vectors are the model: points far from the boundary can be removed without changing it.

## Verification status
- Verified: 57 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- [1.4. Support Vector Machines (scikit-learn User Guide)](https://scikit-learn.org/stable/modules/svm.html) — scikit-learn developers, living (1.9.1 docs). Backs: the sign of `wᵀφ(x) + b`, larger margin and generalization, the primal and dual problems, `0 ≤ α_i ≤ C`, support vectors, the decision function `Σ y_i α_i K(x_i, x) + b` and its attributes, the hinge-loss form of `LinearSVC`, the kernels, `C` as inverse regularization, one-vs-one multi-class, QP complexity, scaling advice, Platt scaling, `LinearSVC` differences, unbalanced classes, many features, kernel approximation, grid search over `C` and `gamma`. [^1]
- [SVM Margins Example (scikit-learn example)](https://scikit-learn.org/stable/auto_examples/svm/plot_svm_margin.html) — scikit-learn developers, living (1.9.1 docs). Backs: the margin edge lies `1/‖w‖` from the separating hyperplane (`margin = 1 / np.sqrt(np.sum(clf.coef_**2))`). [^2]
- [RBF SVM parameters (scikit-learn example)](https://scikit-learn.org/stable/auto_examples/svm/plot_rbf_parameters.html) — scikit-learn developers, living (1.9.1 docs). Backs: `gamma` as the inverse radius of influence, too large and too small `gamma`, large `C` stops changing the support vectors and costs fitting time, lower `C` gives more support vectors, the `C`–`gamma` diagonal. [^3]
- [SVC (scikit-learn API)](https://scikit-learn.org/stable/modules/generated/sklearn.svm.SVC.html) — scikit-learn developers, living (1.9.1 docs). Backs: `gamma='scale'` = `1 / (n_features · X.var())`. [^4]
- `machine-learning/lab-setup.md` — the lab where the hard-margin, `C` sweep, kernel-reconstruction, `gamma` sweep and scaling experiments ran on 2026-11-24. [^5]

## Related
- `machine-learning/supervised-learning/logistic-regression.md` — the other linear classifier: log loss and probabilities instead of hinge loss and margins.
- `machine-learning/foundations/loss-functions-and-maximum-likelihood.md` — the hinge loss next to log loss and squared error.
- `machine-learning/foundations/regularization.md` — why a small `‖w‖` is a penalty, and how `C` relates to `alpha`.
- `machine-learning/data-and-features/preprocessing-and-pipelines.md` — scaling inside a pipeline before an SVM.
- `machine-learning/supervised-learning/k-nearest-neighbors.md` — another distance-based model with the same scaling sensitivity.
- `machine-learning/probabilistic-ml/gaussian-processes.md` — kernels used as covariance functions.
