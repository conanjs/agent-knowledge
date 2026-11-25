---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/supervised-learning
status: verified
applies-to: ["scikit-learn 1.9.1", "NumPy 2.5.5"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [machine-learning, supervised-learning, k-nearest-neighbors, knn, distance, euclidean, feature-scaling, curse-of-dimensionality, scikit-learn]
---

# k-nearest neighbours: distances, choosing k, scaling and the curse of dimensionality

## Summary
**TL;DR:** k-NN (k-nearest neighbours) learns nothing at fit time: it stores the training set. To predict, it finds the `k` stored points closest to the query and takes a majority vote (classification) or the mean of their labels (regression). Everything depends on the distance. Small `k` follows noise and large `k` blurs the boundary. A feature with a large numeric range dominates the distance unless the features are scaled. In many dimensions all points become almost equally far apart, so "nearest" stops meaning much.
**Use this when:** you use `KNeighborsClassifier` / `KNeighborsRegressor`, pick `k` or a metric, see k-NN accuracy jump after scaling, or wonder why k-NN fails on wide data.
**Not this doc:** scaling inside a pipeline without leakage → `machine-learning/data-and-features/preprocessing-and-pipelines.md`; nearest-neighbour search at scale (approximate indexes, recall) → `algorithms/vector-search-evaluation.md`; choosing `k` by cross-validation → `machine-learning/evaluation/cross-validation-and-hyperparameter-search.md`.

## Problem
k-NN looks like the one model with nothing to tune. In practice its accuracy depends on things that are not in its constructor. On the wine data, the same 5-NN classifier (k-NN with `k = 5`) scored 0.722 on raw features and 0.963 after standardizing them ✅[^4]. Adding 50 irrelevant noise columns to a 2-feature problem dropped accuracy from 0.860 to 0.610 ✅[^4]. And all the work happens at prediction time, so a model that "trained" instantly can be slow to serve.

## Mental model
**Analogy:** estimating a house's price by asking the neighbours. Take the `k` nearest houses and average what they sold for. With `k = 1`, one odd sale decides everything. With `k` = the whole city, every house gets the city average. If "nearest" is measured in a mix of units, say floor area in square metres plus number of bathrooms, the area dominates and the bathrooms are ignored. In a city with 1,000 attributes per house, every house is about equally "near", and asking the neighbours tells you little.

**Artifact:** one prediction computed by hand and by scikit-learn: six training points, query `q = (3, 2)`, Euclidean distance, `k = 3` (the first two lines of the Worked example output) ✅[^4]:

```text
distances: [2.236 1.414 1.414 2.828 2.    4.243]  3 nearest idx: [1 2 4]  their labels: [0 1 0]
uniform : predict [0]  predict_proba [[0.667 0.333]]
```

Point 1 is `(2, 1)`, at distance `√((3−2)² + (2−1)²) = √2 = 1.414`. The three nearest labels are 0, 1, 0, so the vote is 2 to 1 for class 0, and `predict_proba` reports those shares.

## How it works
**3 actors:**
- **The fitted estimator** — its job: store the training rows and labels, via `fit` (optionally indexed in a tree) ✅[^1].
- **The neighbour search** — its job: find the `k` stored rows closest to each query, via brute force, a KD tree (k-dimensional tree) or a ball tree ✅[^1].
- **The aggregator** — its job: turn the neighbours' labels into a prediction, via a vote or a mean ✅[^1].

```text
fit(X, y) ──► store rows (or build a KD / ball tree)            nothing is learned here
                                  │
predict(q) ─► distance from q to stored rows ─► k smallest ─► vote (class) / mean (regression)
                    Minkowski p=2 (Euclidean)                     uniform or 1/distance weights
```

1. **Fit (estimator).** k-NN is instance-based, "non-generalizing" learning: it builds no general internal model and only stores the training instances ✅[^1].
2. **Distance (search).** The default metric is Minkowski with `p = 2`, the Euclidean distance `d(a, b) = √(Σᵢ (aᵢ − bᵢ)²)`; `p = 1` is the Manhattan distance `Σᵢ |aᵢ − bᵢ|` ✅[^2]. In the Artifact, the Manhattan distance from `q = (3, 2)` to point 1 `(2, 1)` would be `1 + 1 = 2` instead of `1.414`.
3. **Search cost (search).** Brute force over all pairs costs `O[D·N²]` for `N` samples in `D` dimensions. Tree structures cut a query to about `O[log N]` distance computations, but a KD tree loses that advantage as `D` grows, roughly beyond `D ≈ 20` ✅[^1].
4. **Vote (aggregator).** With `weights='uniform'` (the default), each of the `k` neighbours gets one vote; with `weights='distance'`, each vote is weighted by `1/distance` ✅[^1]. Artifact query with distance weights: class 0 gets `0.707 + 0.5 = 1.207`, class 1 gets `0.707`, so `predict_proba = 1.207/1.914 = 0.631` ✅[^4].
5. **Regression (aggregator).** `KNeighborsRegressor` predicts the mean of the neighbours' labels (or a distance-weighted mean) ✅[^1].
6. **`k` (the only real knob).** The default is `n_neighbors=5` ✅[^2]. The best `k` depends on the data: a larger `k` suppresses noise but makes the class boundary less distinct ✅[^1].
7. **Scale.** The distance adds raw differences, so a feature that varies over thousands outweighs one that varies over units. On wine, proline (0 to about 1,000) drowns out hue (about 1 to 10) until both are standardized ✅[^3].
8. **Dimension.** As the number of dimensions grows, the farthest and the nearest points end up at similar distances. In the lab, with 1,000 uniform random points and 50 queries, the farthest point was on average 73 times farther than the nearest in 2-D (72.74), but only 1.12 times farther in 1,000-D ✅[^4]. scikit-learn's guide uses the name "curse of dimensionality" for the related failures in high dimensions: KD trees become inefficient and radius-based neighbours become less effective ✅[^1].

## Worked example
Five experiments: the hand-computed vote with uniform and distance weights; a `k` sweep on noisy two-moons data (two interleaved half-circles); irrelevant noise features; scaling on wine; and distance concentration on uniform random points. The core of the last one:

```python
P = rng.uniform(size=(1000, dim)); Q = rng.uniform(size=(50, dim))
D = np.sqrt(((Q[:, None, :] - P[None, :, :]) ** 2).sum(axis=2))   # 50 × 1000 distances
ratio = D.max(axis=1) / D.min(axis=1)                                 # farthest / nearest, per query
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-24, scikit-learn 1.9.1, NumPy 2.5.5, two runs identical ✅[^4]:

```text
distances: [2.236 1.414 1.414 2.828 2.    4.243]  3 nearest idx: [1 2 4]  their labels: [0 1 0]
uniform : predict [0]  predict_proba [[0.667 0.333]]
distance: predict [0]  predict_proba [[0.631 0.369]]  (weights 1/d = [0.707 0.707 0.5  ] )
k=2, one neighbor per class: predict [0]  predict_proba [[0.5 0.5]]
k=1   train acc=1.000 test acc=0.840
k=5   train acc=0.920 test acc=0.857
k=15  train acc=0.910 test acc=0.860
k=51  train acc=0.897 test acc=0.853
k=151 train acc=0.853 test acc=0.827
k=299 train acc=0.507 test acc=0.493
k=15, weights='distance': train acc=1.000 test acc=0.857; nearest neighbour of training row 0: row 0 at distance 0.0
moons + 0  noise features: test acc=0.860
moons + 2  noise features: test acc=0.810
moons + 10 noise features: test acc=0.770
moons + 50 noise features: test acc=0.610
wine feature std, min=0.121 max=325.4
wine k=5 test acc: raw=0.722  standardized=0.963
d=1     mean nearest=0.000 mean farthest=0.768 mean farthest/nearest=5118.21
d=2     mean nearest=0.018 mean farthest=1.075 mean farthest/nearest=72.74
d=10    mean nearest=0.514 mean farthest=1.935 mean farthest/nearest=3.84
d=100   mean nearest=3.297 mean farthest=4.726 mean farthest/nearest=1.43
d=1000  mean nearest=12.179 mean farthest=13.630 mean farthest/nearest=1.12
```

<details><summary>Full script (prints the output above)</summary>

```python
# k-NN: one prediction by hand, the effect of k, feature scaling, irrelevant features, distance concentration.
import numpy as np
from sklearn.datasets import load_wine, make_moons
from sklearn.model_selection import train_test_split
from sklearn.neighbors import KNeighborsClassifier
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

# 1. One prediction by hand: 6 training points, query q, k=3, Euclidean distance
Xt = np.array([[1, 1], [2, 1], [4, 3], [5, 4], [1, 2], [6, 5]], float); yt = np.array([0, 0, 1, 1, 0, 1])
q = np.array([3, 2])
d = np.sqrt(((Xt - q) ** 2).sum(axis=1))
order = np.argsort(d, kind="stable")
print("distances:", np.round(d, 3), " 3 nearest idx:", order[:3], " their labels:", yt[order[:3]])
knn = KNeighborsClassifier(n_neighbors=3).fit(Xt, yt)
print("uniform : predict", knn.predict([q]), " predict_proba", np.round(knn.predict_proba([q]), 3))
knd = KNeighborsClassifier(n_neighbors=3, weights="distance").fit(Xt, yt)
print("distance: predict", knd.predict([q]), " predict_proba", np.round(knd.predict_proba([q]), 3),
      " (weights 1/d =", np.round(1 / d[order[:3]], 3), ")")
k2 = KNeighborsClassifier(n_neighbors=2).fit(Xt, yt)
print("k=2, one neighbor per class: predict", k2.predict([q]), " predict_proba", k2.predict_proba([q]))

# 2. Choosing k: train vs test accuracy on noisy two-moons
X, y = make_moons(n_samples=600, noise=0.35, random_state=0)
Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.5, random_state=0)
for k in [1, 5, 15, 51, 151, 299]:
    m = KNeighborsClassifier(n_neighbors=k).fit(Xtr, ytr)
    print("k=%-3d train acc=%.3f test acc=%.3f" % (k, m.score(Xtr, ytr), m.score(Xte, yte)))
md = KNeighborsClassifier(n_neighbors=15, weights="distance").fit(Xtr, ytr)
dist0, idx0 = md.kneighbors(Xtr[:1], n_neighbors=1)
print("k=15, weights='distance': train acc=%.3f test acc=%.3f; nearest neighbour of training row 0: row %d at distance %.1f"
      % (md.score(Xtr, ytr), md.score(Xte, yte), idx0[0, 0], dist0[0, 0]))

# 3. Irrelevant features: append standard-normal noise columns to the same moons data (k=15)
rng = np.random.default_rng(0)
for extra in [0, 2, 10, 50]:
    N = rng.normal(size=(len(X), extra))
    Xa, Xb, ya, yb = train_test_split(np.c_[X, N], y, test_size=0.5, random_state=0)   # same split as above
    print("moons + %-2d noise features: test acc=%.3f" % (extra, KNeighborsClassifier(n_neighbors=15).fit(Xa, ya).score(Xb, yb)))

# 4. Scaling: wine features range from ~0.1 (hue) to ~1000s (proline)
Xw, yw = load_wine(return_X_y=True)
Xtr, Xte, ytr, yte = train_test_split(Xw, yw, test_size=0.3, random_state=0, stratify=yw)
print("wine feature std, min=%.3f max=%.1f" % (Xtr.std(axis=0).min(), Xtr.std(axis=0).max()))
raw = KNeighborsClassifier(n_neighbors=5).fit(Xtr, ytr)
scaled = make_pipeline(StandardScaler(), KNeighborsClassifier(n_neighbors=5)).fit(Xtr, ytr)
print("wine k=5 test acc: raw=%.3f  standardized=%.3f" % (raw.score(Xte, yte), scaled.score(Xte, yte)))

# 5. Distance concentration: 1000 uniform points in [0,1]^d, 50 queries, farthest/nearest distance
for dim in [1, 2, 10, 100, 1000]:
    P = rng.uniform(size=(1000, dim)); Q = rng.uniform(size=(50, dim))
    D = np.sqrt(((Q[:, None, :] - P[None, :, :]) ** 2).sum(axis=2))
    ratio = D.max(axis=1) / D.min(axis=1)
    print("d=%-5d mean nearest=%.3f mean farthest=%.3f mean farthest/nearest=%.2f"
          % (dim, D.min(axis=1).mean(), D.max(axis=1).mean(), ratio.mean()))
```

</details>

Reading it line by line:
- **Lines 1–3:** the Artifact query. Uniform votes give `[0.667, 0.333]`. Distance weights `1/1.414 = 0.707` (twice) and `1/2 = 0.5` give `[0.631, 0.369]`.
- **Line 4:** with `k = 2` and one neighbour of each class, the vote ties at `[0.5, 0.5]`, and scikit-learn 1.9.1 returned class 0, the lower label, in this run.
- **Lines 5–10:** `k = 1` memorizes (training accuracy 1.000) but scores 0.840 on the test set. `k = 15` is best here (0.860). `k = 299`, almost the whole training set, predicts nearly one class everywhere (0.493).
- **Line 11:** with `weights='distance'`, training accuracy is 1.000: training row 0's nearest neighbour is itself, at distance 0, so under `1/distance` weighting its own label dominates. Test accuracy (0.857) is about the same as uniform weights.
- **Lines 12–15:** the same 2-feature moons with 0, 2, 10 and 50 extra noise columns: test accuracy 0.860 → 0.810 → 0.770 → 0.610. The noise columns add to every distance and drown out the two that carry the signal.
- **Lines 16–17:** wine feature standard deviations range from 0.121 to 325.4; standardizing lifts 5-NN test accuracy from 0.722 to 0.963.
- **Lines 18–22:** the mean nearest distance rises from 0.000 to 12.2 while the farthest/nearest ratio falls from thousands to 1.12. In 1,000 dimensions, the farthest of 1,000 random points is only 12 % farther away than the nearest.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Features on very different scales | The large-range feature decides the neighbours (wine: 0.722 raw vs 0.963 standardized) ✅[^4] | Distances are dominated by the feature with the largest values ✅[^3] |
| Many irrelevant features | Accuracy falls as noise columns are added (0.860 → 0.610 with 50) ✅[^4] | Each column adds to every distance, signal or not |
| High-dimensional data | Nearest and farthest neighbours end up at similar distances (ratio 1.12 at 1,000-D) ✅[^4]; KD trees become inefficient ✅[^1] | The curse of dimensionality ✅[^1] |
| Neighbours `k` and `k+1` at the same distance with different labels | The result depends on the order of the training data ✅[^2] | Ties are broken by the rows' position in the training data ✅[^2] |
| Even `k`, two classes | Votes can tie; scikit-learn 1.9.1 returned the lower label in the lab ✅[^4] | Use an odd `k` for two classes, or `weights='distance'` |
| `k` close to the training-set size | Predicts nearly the majority class everywhere (0.493 at `k = 299` of 300) ✅[^4] | Every query sees almost the same neighbours |
| Unevenly sampled data | `RadiusNeighborsClassifier` (all neighbours within radius `r`) can be a better choice ✅[^1] | Sparse regions get fewer neighbours instead of far-away ones ✅[^1] |
| Large training set at prediction time | Prediction is the expensive step | All work is a neighbour search; brute force costs `O[D·N²]` ✅[^1] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Small `k` | Keeps class boundaries distinct (a larger `k` blurs them) ✅[^1] | Follows noise: `k = 1` gave 1.000 train vs 0.840 test ✅[^4] |
| Large `k` | Suppresses noise ✅[^1] | Boundary less distinct ✅[^1]; at the extreme, a constant prediction ✅[^4] |
| `weights='distance'` | Nearer neighbours count more ✅[^1] | Training accuracy becomes meaningless: 1.000 in the lab, where a training row's nearest neighbour is itself at distance 0 ✅[^4] |
| Brute force | Competitive for small data ✅[^1] | `O[D·N²]` for all pairs ✅[^1] |
| KD tree / ball tree | About `O[log N]` distance computations per query for low `D` ✅[^1] | KD tree degrades as `D` grows; a ball tree costs more to build but can stay efficient on highly structured data even in very high dimensions ✅[^1] |

## Takeaways
- Always put a scaler in front of k-NN (in a pipeline, fitted on the training data only). [rule-candidate]
- Choose `k` by cross-validation; with two classes, prefer an odd `k`. [rule-candidate]
- Drop or reduce irrelevant features before k-NN: every extra column adds noise to every distance.
- k-NN is cheap to fit and expensive to predict. Budget the prediction cost, not the training cost.
- On wide data (hundreds of features or more), expect "nearest" to carry little information; reduce the dimensions or pick another model.

## Verification status
- Verified: 42 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- [1.6. Nearest Neighbors (scikit-learn User Guide)](https://scikit-learn.org/stable/modules/neighbors.html) — scikit-learn developers, living (1.9.1 docs). Backs: instance-based, non-generalizing learning; majority vote and uniform vs distance weights; regression as the mean of neighbours; choice of `k` and noise; radius neighbours for unevenly sampled data; brute-force `O[D·N²]`; KD tree `O[log N]` and its degradation beyond about 20 dimensions; ball trees; the curse of dimensionality. [^1]
- [KNeighborsClassifier (scikit-learn API)](https://scikit-learn.org/stable/modules/generated/sklearn.neighbors.KNeighborsClassifier.html) — scikit-learn developers, living (1.9.1 docs). Backs: `n_neighbors=5` default, Minkowski metric with `p=2` (Euclidean) and `p=1` (Manhattan), the warning that equal-distance ties depend on training-data order. [^2]
- [Importance of Feature Scaling (scikit-learn example)](https://scikit-learn.org/stable/auto_examples/preprocessing/plot_scaling_importance.html) — scikit-learn developers, living (1.9.1 docs). Backs: on wine, proline's range dominates the distances until features are standardized. [^3]
- `machine-learning/lab-setup.md` — the lab where the hand-computed vote, the `k` sweep, the noise-feature, scaling and distance-concentration experiments ran on 2026-11-24. [^4]

## Related
- `machine-learning/data-and-features/preprocessing-and-pipelines.md` — scaling inside a pipeline, fitted on training data only.
- `machine-learning/foundations/generalization-and-overfitting.md` — `k = 1` as an example of a model that memorizes.
- `machine-learning/evaluation/cross-validation-and-hyperparameter-search.md` — picking `k` without touching the test set.
- `machine-learning/unsupervised-learning/principal-component-analysis.md` — reducing dimensions before a distance-based model.
- `algorithms/vector-search-evaluation.md` — nearest-neighbour search at scale and how its recall is measured.
- `machine-learning/supervised-learning/support-vector-machines.md` — the RBF kernel, another model built on distances between points.
- `machine-learning/deep-learning/metric-learning.md` — learning the distance that k-NN uses.
