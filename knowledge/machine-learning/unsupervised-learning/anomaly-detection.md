---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/unsupervised-learning
status: verified
applies-to: ["scikit-learn 1.9.1"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, unsupervised-learning, anomaly-detection, outlier-detection, novelty-detection, isolation-forest, local-outlier-factor, one-class-svm, elliptic-envelope, minimum-covariance-determinant, contamination, scikit-learn]
---

# Anomaly detection: isolation forest, local outlier factor, one-class SVM and robust covariance

## Summary
**TL;DR:** An anomaly detector learns what "normal" looks like from unlabelled data and gives every point a score; a threshold on that score turns it into inlier (`1`) or outlier (`-1`). Outlier detection fits on data that already contains the anomalies; novelty detection fits on clean data and scores new points. Isolation forest isolates points with random splits and calls a point anomalous when few splits suffice; LOF (local outlier factor) compares a point's density with its neighbours' densities; a one-class SVM (support vector machine) draws a boundary around the data; an elliptic envelope fits one robust Gaussian ellipse. `contamination` only moves the threshold: the ranking, and so ROC-AUC (area under the receiver operating characteristic curve), stays the same.
**Use this when:** you pick between `IsolationForest`, `LocalOutlierFactor`, `OneClassSVM` and `EllipticEnvelope`, set `contamination` or `nu`, wonder why `LocalOutlierFactor` has no `predict`, or must judge a detector with only a handful of labelled anomalies.
**Not this doc:** density models whose low likelihood can flag anomalies → `machine-learning/unsupervised-learning/gaussian-mixtures-and-em.md`; the noise label of DBSCAN (density-based spatial clustering of applications with noise) → `machine-learning/unsupervised-learning/density-and-hierarchical-clustering.md`; whole-dataset shift rather than single odd points → `machine-learning/ml-systems/data-drift-and-monitoring.md`; ROC-AUC, precision and recall themselves → `machine-learning/evaluation/classification-metrics.md`.

## Problem
When anomalies (fraud, faults, intrusions) are rare and unlabelled, there is nothing for a classifier to learn from. The unsupervised detectors that remain each encode a different idea of "unusual", and picking the wrong one fails silently. In the lab, on a dense and a sparse cluster plus 20 planted anomalies, the elliptic envelope ranked anomalies with ROC-AUC 0.601, near the 0.5 of random guessing, while LOF reached 1.000 on the same data ✅[^10]. The second trap is the threshold: `contamination` sets how many points get flagged, and a wrong value turned the same isolation forest from 10 flags at precision 1.00 into 119 flags at precision 0.34 ✅[^10]. The third is evaluation: with two to four labelled anomalies per sample, one detector's ROC-AUC ranged from 0.749 to 1.000 across draws ✅[^10].

## Mental model
**Analogy:** a game of twenty questions played at a party. To single out one guest you ask random yes/no questions about height or age ("taller than 1.85 m?"). A guest who stands apart, say the only one over two metres, is isolated after two or three questions; a typical guest in the crowd takes a dozen. Isolation forest plays that game many times and flags the guests who are always singled out quickly. LOF instead asks how crowded your spot is compared with your neighbours' spots: standing one metre from a tight huddle is odd, while the same spacing in a loose crowd is normal.

**Artifact:** the isolation forest's average path length for a centre point and a far point, computed by hand from the fitted trees and compared with scikit-learn; printed by the full script in the Worked example, lab run (`machine-learning/lab-setup.md`), 2026-11-25, scikit-learn 1.9.1 ✅[^10]:

```text
== 1. isolation forest: path length by hand ==
inlier (0,0)   mean path 13.59  2^(-E[h]/c(256)) = 0.3988
outlier (4,4)  mean path  4.12  2^(-E[h]/c(256)) = 0.7565
c(256) = 10.2448  max_samples_ = 256  deepest tree = 8
sklearn -score_samples: [0.3988 0.7565]
offset_ = -0.5  decision_function: [ 0.1012 -0.2565]  predict: [ 1 -1]
```

The far point needs about 4 random splits, the centre point about 14 (counting the expected depth still left in its leaf), and the hand formula reproduces `score_samples` to four decimals.

## How it works
### The shared interface
1. **Outlier vs novelty detection.** In outlier detection the training data contains the outliers and the estimator fits the region where the data is most concentrated; in novelty detection the training data is clean and the question is whether a new point is an outlier (a novelty) ✅[^1]. scikit-learn's guide also calls them unsupervised and semi-supervised anomaly detection ✅[^1].
2. **Scores and threshold.** `fit(X)` learns from unlabelled rows; `predict` returns `1` for inliers and `-1` for outliers by thresholding the raw score from `score_samples`; `decision_function` is shifted so that negative values are outliers; `contamination` controls the threshold ✅[^1]. The relation is `decision_function = score_samples − offset_` ✅[^2]. Example from the artifact: `score_samples = −0.7565`, `offset_ = −0.5`, so `decision_function = −0.2565 < 0` and the point is an outlier.
3. **`contamination`.** It is the expected share of outliers, a float in `(0, 0.5]` or `'auto'` ✅[^2]. With a float, isolation forest sets `offset_` to that percentile of the training scores, so the expected share of training points gets a negative `decision_function` ✅[^2] ✅[^3]; LOF does the same with its training scores ✅[^5]. `EllipticEnvelope` has no `'auto'` and defaults to `0.1` ✅[^7].

### Isolation forest
1. **Random isolation trees.** Each tree repeatedly picks a random feature and a random split value between that feature's minimum and maximum; the number of splits needed to isolate a point is its path length, and random partitioning gives noticeably shorter paths for anomalies ✅[^1].
2. **Subsample and depth limit.** Each tree is grown on `max_samples` points, `'auto'` = `min(256, n_samples)` ✅[^2], and stops at depth `ceil(log2(max_samples))`, 8 for 256 points ✅[^1] ✅[^10].
3. **Path length with an unfinished leaf.** A point that ends in a leaf still holding `n_left` training points gets the leaf's depth plus `c(n_left)`, the average path length of an `n_left`-point tree ✅[^2]. In the source, `c(n) = 2·(ln(n − 1) + 0.5772) − 2·(n − 1)/n` for `n > 2`, `c(2) = 1` and `c(1) = 0`, where 0.5772 is Euler's constant; it equals the average path length of an unsuccessful search in a binary search tree ✅[^3]. Example: `c(256) = 2·(5.5413 + 0.5772) − 2·255/256 = 10.2448` (artifact line 4).
4. **Score.** `s(x) = 2^(−E[h(x)] / c(ψ))`, where `h(x)` is the path length in one tree, `E[h(x)]` its mean over all trees and `ψ = max_samples`; `score_samples` returns `−s(x)` ✅[^3]. Example: `E[h] ≈ 4.12` gives `2^(−4.12/10.2448) ≈ 0.757` (0.7565 in the artifact, from the unrounded mean). With `contamination='auto'`, `offset_ = −0.5`, because the scores of inliers are close to 0 and those of outliers close to −1 ✅[^2].

### Local outlier factor (LOF)
1. **k-distance:** for each point `o`, the distance to its k-th nearest neighbour (`n_neighbors`, default 20) ✅[^4] ✅[^5].
2. **Reachability distance:** `reach-dist(p, o) = max(d(p, o), k-distance(o))`, with `d(p, o)` the distance from `p` to its neighbour `o`, so a point inside a neighbour's dense core counts as being at that neighbour's k-distance ✅[^5].
3. **Local reachability density:** `lrd(p) = 1 / mean over the k neighbours o of reach-dist(p, o)`, plus `1e-10` in the denominator so that more than `k` duplicate points do not produce NaN (not a number) ✅[^5].
4. **LOF:** `LOF(p) = mean over the k neighbours o of lrd(o) / lrd(p)`; scikit-learn stores `−LOF` as `negative_outlier_factor_` ✅[^5]. Inliers score near 1, outliers higher; with `'auto'` the threshold `offset_` is −1.5 ✅[^4]. Example: neighbours with mean `lrd` 4.0 around a point with `lrd` 1.25 give `LOF = 4.0/1.25 = 3.2`.
5. **Why it is local:** the score is a ratio of densities, so a point can be an outlier next to a dense cluster at a spacing that is normal inside a sparse one; the guide notes LOF can perform well when abnormal samples have different underlying densities ✅[^1]. In the lab, inliers of a dense cluster (median k-distance 0.135) and of a sparse one (0.658) both had median LOF ≈ 1.03 ✅[^10].
6. **Two modes.** By default (`novelty=False`) LOF has only `fit_predict` and `negative_outlier_factor_`; with `novelty=True` it gains `predict`, `decision_function` and `score_samples`, which must be used only on new data, and loses `fit_predict` ✅[^1].

### One-class SVM
It estimates the support of a high-dimensional distribution, with an RBF (radial basis function) kernel by default ✅[^6] (kernels: `machine-learning/supervised-learning/support-vector-machines.md`). `nu` is an upper bound on the fraction of training errors and a lower bound on the fraction of support vectors, in `(0, 1]`, default 0.5 ✅[^6]; the guide reads it as the probability of a new regular point falling outside the frontier ✅[^1]. It was designed for novelty detection; on polluted training data it is sensitive to outliers and needs `nu` tuned ✅[^1].

### Elliptic envelope and the minimum covariance determinant
1. **Assumption:** the inliers are Gaussian; the estimator fits a robust location and covariance and calls far-off points outliers ✅[^1].
2. **Distance:** `d²(x) = (x − μ)ᵀ Σ⁻¹ (x − μ)`, the squared Mahalanobis distance, where `μ` is the location and `Σ` the covariance ✅[^9]. `score_samples` returns `−d²(x)`: the source returns `−self.mahalanobis(X)` ✅[^12], and `mahalanobis` computes squared distances ✅[^7], although the `score_samples` docstring says only "negative Mahalanobis distances". Example: with `μ = (0, 0)` and `Σ = diag(4, 1)`, the point `(2, 1)` has `d² = 2²/4 + 1²/1 = 2`.
3. **Robust fit (MCD, minimum covariance determinant):** find the `(n_samples + n_features + 1)/2` observations whose empirical covariance has the smallest determinant and estimate `μ` and `Σ` from them, because the ordinary maximum-likelihood covariance is pulled by outliers ✅[^9]; scikit-learn then rescales and reweights the estimate ✅[^8] and uses the FastMCD algorithm ✅[^7].
4. **Limits:** MCD is meant for Gaussian or at least unimodal, symmetric data, not multi-modal data ✅[^8]; covariance-based detection may break in high dimension, so keep `n_samples > n_features²` ✅[^7].

## Worked example
One script, scikit-learn 1.9.1: (1) the isolation-forest path lengths above; (2) an isolation forest on 950 normal points plus 50 uniform outliers, with four `contamination` values; (3) LOF computed by hand on a dense cluster (400 points, standard deviation 0.3), a sparse cluster (400 points, standard deviation 1.5), 10 "local" anomalies placed about 1.2 from the dense centre and 10 "global" anomalies far from both; (4) every detector scored by ROC-AUC against the held-back labels, overall and per anomaly type; (5) LOF in novelty mode; (6) ROC-AUC from five random samples of 80 labelled points. The LOF core:

```python
reach = np.maximum(d, k_dist[idx])              # reach-dist(p, o) = max(d(p, o), k-distance(o))
lrd = 1 / reach.mean(axis=1)                    # local reachability density
lof_hand = (lrd[idx] / lrd[:, None]).mean(axis=1)
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-25, scikit-learn 1.9.1, two runs identical; part 1 is the Mental model artifact ✅[^10]:

```text
== 2. contamination moves the threshold, not the ranking ==
contamination=auto  offset_=-0.5000 flagged=119 recall=0.82 precision=0.34 ROC-AUC=0.9284
contamination=0.01  offset_=-0.7255 flagged= 10 recall=0.20 precision=1.00 ROC-AUC=0.9284
contamination=0.05  offset_=-0.5646 flagged= 50 recall=0.76 precision=0.76 ROC-AUC=0.9284
contamination=0.1   offset_=-0.5150 flagged=100 recall=0.82 precision=0.41 ROC-AUC=0.9284
== 3. LOF by hand on a dense and a sparse cluster ==
max |LOF by hand - (-negative_outlier_factor_)| = 5.19e-09
dense  points: median k-distance 0.135  median LOF 1.035
sparse points: median k-distance 0.658  median LOF 1.033
local  points: median k-distance 0.891  median LOF 3.211
global points: median k-distance 3.315  median LOF 2.686
== 4. four detectors and a k-distance baseline: ROC-AUC against the held-back labels ==
k-distance (global)   all 0.920 | local only 0.840 | global only 0.999
IsolationForest       all 0.963 | local only 0.936 | global only 0.990
LocalOutlierFactor    all 1.000 | local only 1.000 | global only 1.000
OneClassSVM(nu=0.05)  all 0.874 | local only 0.750 | global only 0.999
EllipticEnvelope      all 0.601 | local only 0.500 | global only 0.702
EllipticEnvelope location_ [-0.02 -0.02] | share of sparse-cluster inliers flagged: 0.195
EllipticEnvelope: local anomalies above every dense inlier True | below every sparse inlier True
== 5. LOF novelty=True: for new points only ==
training points flagged: fit_predict 57 | novelty predict on the same points 50
new points (0.1,0.1) and (1.25,0.1): score_samples [-1.011 -2.651] predict [ 1 -1]
== 6. few labels: ROC-AUC from 5 random draws of 80 labelled points ==
labelled anomalies per draw: [4, 4, 3, 3, 2]
k-distance (global)   0.967 1.000 0.874 0.970 0.936
IsolationForest       0.990 0.984 0.970 0.983 0.994
LocalOutlierFactor    1.000 1.000 1.000 1.000 1.000
OneClassSVM(nu=0.05)  1.000 0.997 1.000 0.749 1.000
EllipticEnvelope      0.618 0.553 0.649 0.675 0.513
```

<details><summary>Full script (prints the output above)</summary>

```python
# Anomaly detection: isolation-forest path lengths and LOF by hand, contamination vs ranking,
# four detectors on clusters of different density, LOF novelty mode, and scoring with few labels.
import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.neighbors import LocalOutlierFactor, NearestNeighbors
from sklearn.svm import OneClassSVM
from sklearn.covariance import EllipticEnvelope
from sklearn.metrics import roc_auc_score

def c(n):                                       # average path length of an unsuccessful BST search
    n = float(n)
    return 0.0 if n <= 1 else 1.0 if n == 2 else 2 * (np.log(n - 1) + np.euler_gamma) - 2 * (n - 1) / n

def path_length(tree, x):                       # depth of x's leaf + c(training points left in that leaf)
    t, node, depth = tree.tree_, 0, 0
    while t.children_left[node] != -1:
        node = t.children_left[node] if x[t.feature[node]] <= t.threshold[node] else t.children_right[node]
        depth += 1
    return depth + c(t.n_node_samples[node])

rng = np.random.default_rng(0)
print("== 1. isolation forest: path length by hand ==")
X = rng.normal(size=(1000, 2))                  # 1,000 standard normal inliers
probe = np.array([[0.0, 0.0], [4.0, 4.0]])      # an inlier at the centre, an outlier far away
iso = IsolationForest(n_estimators=200, random_state=0).fit(X)
for name, x in zip(["inlier (0,0)", "outlier (4,4)"], probe.astype(np.float32)):  # trees split float32
    h = np.array([path_length(t, x) for t in iso.estimators_])
    print(f"{name:14s} mean path {h.mean():5.2f}  2^(-E[h]/c(256)) = {2 ** (-h.mean() / c(iso.max_samples_)):.4f}")
print(f"c(256) = {c(256):.4f}  max_samples_ = {iso.max_samples_}  deepest tree = {max(t.get_depth() for t in iso.estimators_)}")
print("sklearn -score_samples:", np.round(-iso.score_samples(probe), 4))
print("offset_ =", iso.offset_, " decision_function:", np.round(iso.decision_function(probe), 4),
      " predict:", iso.predict(probe))

print("== 2. contamination moves the threshold, not the ranking ==")
Xc = np.vstack([X[:950], rng.uniform(-6, 6, size=(50, 2))])   # 5 % uniform outliers
yc = np.r_[np.zeros(950), np.ones(50)]
for cont in ["auto", 0.01, 0.05, 0.10]:
    m = IsolationForest(n_estimators=200, contamination=cont, random_state=0).fit(Xc)
    flagged = m.predict(Xc) == -1
    print(f"contamination={str(cont):5s} offset_={m.offset_:+.4f} flagged={flagged.sum():3d} "
          f"recall={flagged[yc == 1].mean():.2f} precision={yc[flagged].mean():.2f} "
          f"ROC-AUC={roc_auc_score(yc, -m.score_samples(Xc)):.4f}")

print("== 3. LOF by hand on a dense and a sparse cluster ==")
dense = rng.normal([0, 0], 0.3, size=(400, 2))
sparse = rng.normal([5, 5], 1.5, size=(400, 2))
local = np.array([[1.2, 0.0], [-1.2, 0.3], [0.0, 1.3], [0.5, -1.2], [-0.9, -0.9],
                  [1.0, 1.0], [-0.3, -1.4], [1.3, -0.5], [-1.3, -0.4], [0.8, 1.2]])
glob = rng.uniform(-4, 11, size=(30, 2))
glob = glob[np.linalg.norm(glob - [5, 5], axis=1) > 4.5][:10]   # far from the sparse cluster too
Xd = np.vstack([dense, sparse, local, glob])
group = np.array(["dense"] * 400 + ["sparse"] * 400 + ["local"] * 10 + ["global"] * len(glob))
yd = np.isin(group, ["local", "global"]).astype(int)    # held-back labels, used only for scoring
k = 20
d, idx = NearestNeighbors(n_neighbors=k + 1).fit(Xd).kneighbors(Xd)
d, idx = d[:, 1:], idx[:, 1:]                   # drop each point itself
k_dist = d[:, -1]                               # distance to the k-th neighbour
reach = np.maximum(d, k_dist[idx])              # reach-dist(p, o) = max(d(p, o), k-distance(o))
lrd = 1 / reach.mean(axis=1)                    # local reachability density
lof_hand = (lrd[idx] / lrd[:, None]).mean(axis=1)
lof = LocalOutlierFactor(n_neighbors=k).fit(Xd)
print("max |LOF by hand - (-negative_outlier_factor_)| =", f"{np.abs(lof_hand + lof.negative_outlier_factor_).max():.2e}")
for g in ["dense", "sparse", "local", "global"]:
    print(f"{g:6s} points: median k-distance {np.median(k_dist[group == g]):.3f}  median LOF {np.median(lof_hand[group == g]):.3f}")

print("== 4. four detectors and a k-distance baseline: ROC-AUC against the held-back labels ==")
scores = {                                      # higher = more anomalous
    "k-distance (global)": k_dist,
    "IsolationForest": -IsolationForest(random_state=0).fit(Xd).score_samples(Xd),
    "LocalOutlierFactor": -lof.negative_outlier_factor_,
    "OneClassSVM(nu=0.05)": -OneClassSVM(nu=0.05, gamma="scale").fit(Xd).score_samples(Xd),
    "EllipticEnvelope": -EllipticEnvelope(random_state=0).fit(Xd).score_samples(Xd),
}
loc, glo = group != "global", group != "local"
for name, s in scores.items():
    print(f"{name:21s} all {roc_auc_score(yd, s):.3f} | local only {roc_auc_score(yd[loc], s[loc]):.3f}"
          f" | global only {roc_auc_score(yd[glo], s[glo]):.3f}")
ee = EllipticEnvelope(random_state=0).fit(Xd)
print("EllipticEnvelope location_", np.round(ee.location_, 2), "| share of sparse-cluster inliers flagged:",
      (ee.predict(sparse) == -1).mean())
s_ee = scores["EllipticEnvelope"]
print("EllipticEnvelope: local anomalies above every dense inlier", s_ee[group == "local"].min() > s_ee[group == "dense"].max(),
      "| below every sparse inlier", s_ee[group == "local"].max() < s_ee[group == "sparse"].min())

print("== 5. LOF novelty=True: for new points only ==")
nov = LocalOutlierFactor(n_neighbors=k, novelty=True).fit(Xd)
print("training points flagged: fit_predict", (lof.fit_predict(Xd) == -1).sum(),
      "| novelty predict on the same points", (nov.predict(Xd) == -1).sum())
print("new points (0.1,0.1) and (1.25,0.1): score_samples", np.round(nov.score_samples([[0.1, 0.1], [1.25, 0.1]]), 3),
      "predict", nov.predict([[0.1, 0.1], [1.25, 0.1]]))

print("== 6. few labels: ROC-AUC from 5 random draws of 80 labelled points ==")
draws = [rng.choice(len(yd), 80, replace=False) for _ in range(5)]
print("labelled anomalies per draw:", [int(yd[i].sum()) for i in draws])
for name, s in scores.items():
    print(f"{name:21s} " + " ".join(f"{roc_auc_score(yd[i], s[i]):.3f}" for i in draws))
```

</details>

Reading it, line by line:
- **Contamination (part 2):** `offset_` moves from −0.7255 to −0.5000 and the flag count from 10 to 119, trading precision 1.00 at recall 0.20 for recall 0.82 at precision 0.34; ROC-AUC is 0.9284 every time, because the scores, and so the ranking, do not change. With the true rate (0.05) the 50 flags happened to have precision and recall 0.76.
- **LOF by hand (part 3):** the four-line formula matches `negative_outlier_factor_` to `5e-9`. The sparse cluster's points are five times farther from their 20th neighbour than the dense cluster's (0.658 vs 0.135), yet both score LOF ≈ 1.03; the local anomalies score 3.2.
- **Detectors (part 4):** a plain k-distance ranks the local anomalies at only 0.840, because they are closer to their neighbours than many sparse-cluster inliers are to theirs. LOF separates every type perfectly here. Isolation forest is good on both types (0.936, 0.990). The one-class SVM finds the global anomalies (0.999) but not the local ones (0.750). The elliptic envelope's robust fit locked onto the dense cluster (`location_ ≈ (0, 0)`): MCD keeps the `(820 + 2 + 1)/2 ≈ 411` points with the tightest covariance ✅[^9], and the 400 dense points are the tightest group. Every local anomaly then scores above all dense inliers and below all sparse ones, which is exactly ROC-AUC 0.500, and 19.5 % of the sparse cluster's inliers are flagged.
- **Novelty mode (part 5):** a point new to the model just outside the dense cluster, `(1.25, 0.1)`, scores −2.651 and is flagged, while `(0.1, 0.1)` scores −1.011. Calling `predict` on the training rows themselves flagged 50 points where `fit_predict` flagged 57: the documented wrong use ✅[^1].
- **Few labels (part 6):** with 2–4 labelled anomalies per sample, the one-class SVM looks perfect in 3 of 5 samples and poor (0.749) in one, and in the first sample it outranks isolation forest, the reverse of the full-label ranking (0.874 vs 0.963). Treat a ROC-AUC from a handful of labelled anomalies as a rough check, report its spread, and compare detectors on the same labelled sample; Oliver et al. estimate with Hoeffding's inequality that a validation error known to within 1 % absolute at 95 % confidence needs nearly 20,000 examples ✅[^11].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `contamination` set to a wrong rate | Flag count and precision/recall change; ROC-AUC does not (lab 0.9284 at four settings) | It only sets `offset_`, a percentile of training scores ✅[^3]; lab ✅[^10] |
| Anomalies form their own dense cluster | Outlier detectors miss them | They assume outliers sit in low-density regions; in novelty detection a dense cluster of novelties is fine if it lies where clean training data was sparse ✅[^1] |
| `LocalOutlierFactor().predict(X)` | Not available | Default `novelty=False` offers only `fit_predict` and `negative_outlier_factor_` ✅[^1] |
| `novelty=True`, then `predict` on training rows | Wrong labels (lab: 50 flags vs 57 from `fit_predict`) | Must be used on new data only ✅[^1]; lab ✅[^10] |
| More than `n_neighbors` duplicate points | Scores stay finite instead of NaN | `1e-10` added to the mean reachability distance ✅[^5] |
| Elliptic envelope on multi-modal data | Fits one mode, flags parts of the others (lab: 19.5 % of a whole cluster) | MCD is not meant for multi-modal data ✅[^8]; lab ✅[^10] |
| Elliptic envelope with many features | May break or perform poorly | Keep `n_samples > n_features²` ✅[^7] |
| One-class SVM trained on polluted data | Boundary bends around outliers | Sensitive to outliers; tune `nu` ✅[^1] |
| `OneClassSVM()` with defaults | Up to half the training points may fall outside | `nu` defaults to 0.5, an upper bound on training errors ✅[^6] |
| Unscaled features in LOF or one-class SVM | Large-range features dominate | Both rest on distances: LOF on k-nearest neighbours ✅[^5], the RBF `gamma='scale'` on `X.var()` ✅[^6]; scaling: `machine-learning/supervised-learning/k-nearest-neighbors.md` |
| Very large training set for isolation forest | Each tree still sees 256 rows | `max_samples='auto'` = `min(256, n_samples)` ✅[^2] |
| Few labelled anomalies | Detector comparison flips between samples (lab 0.749–1.000) | Too few positives for a stable ranking metric ✅[^10] ✅[^11] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Isolation forest | Suggested for high-dimensional data ✅[^1]; each tree uses at most 256 rows ✅[^2]; good on local and global anomalies in the lab ✅[^10] | Splits one random feature at a time ✅[^1] |
| LOF | Handles clusters of different density ✅[^1]; lab 1.000 ✅[^10] | Needs `n_neighbors` tuned (20 works well in general, 35 above 10 % outliers in the guide's example) ✅[^1]; new points only with `novelty=True` ✅[^1] |
| One-class SVM | Learns a frontier around clean training data (novelty detection) ✅[^1] | Sensitive to outliers; `nu` and the RBF bandwidth must be chosen, with no exact formula for the bandwidth ✅[^1]; at best quadratic in samples (use `SGDOneClassSVM` to scale) ✅[^1] |
| Elliptic envelope | One robust ellipse and a Mahalanobis distance per point, fitting Gaussian inliers ✅[^1] ✅[^9] | Not for multi-modal data ✅[^8]; lab 0.601 ✅[^10] |

## Takeaways
- Choose the detector by what "unusual" means for your data: isolated (isolation forest), less dense than its neighbourhood (LOF), outside a learned frontier of clean data (one-class SVM), or far from one Gaussian (elliptic envelope).
- Rank with `score_samples` and choose the cut separately: `contamination` is a threshold, not a model setting. [rule-candidate]
- Use `LocalOutlierFactor(novelty=True)` to score new data, and never call its `predict` on the training rows. [rule-candidate]
- Keep any labelled anomalies for evaluation only, report ROC-AUC or average precision with its spread across samples, and do not pick a winner from two or three labelled cases.

## Verification status
- Verified: 79 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [Novelty and Outlier Detection (User Guide §2.7)](https://scikit-learn.org/stable/modules/outlier_detection.html) — scikit-learn developers, living (1.9.1). Backs: outlier vs novelty detection, low-density assumption, the `predict`/`score_samples`/`decision_function`/`contamination` interface, isolation by random splits, depth `ceil(log2 n)`, LOF's local density idea and `n_neighbors` advice, LOF's two modes and the novelty warning, one-class SVM sensitivity and `nu`, elliptic envelope's Gaussian assumption, `SGDOneClassSVM`. [^1]
- [sklearn.ensemble.IsolationForest](https://scikit-learn.org/stable/modules/generated/sklearn.ensemble.IsolationForest.html) — scikit-learn developers, living (1.9.1). Backs: `max_samples='auto'`, `contamination` range, `offset_` and `decision_function = score_samples − offset_`, `'auto'` offset −0.5, leaf path length plus `c(n_left)`. [^2]
- [sklearn/ensemble/_iforest.py at 1.9.1](https://github.com/scikit-learn/scikit-learn/blob/1.9.1/sklearn/ensemble/_iforest.py) — scikit-learn source code, 2026. Backs: the score `2^(−E[h]/c(ψ))`, the `c(n)` formula and its binary-search-tree meaning, `offset_` as a percentile of training scores. [^3]
- [sklearn.neighbors.LocalOutlierFactor](https://scikit-learn.org/stable/modules/generated/sklearn.neighbors.LocalOutlierFactor.html) — scikit-learn developers, living (1.9.1). Backs: `n_neighbors=20`, `novelty`, `negative_outlier_factor_`, inliers near 1, `offset_ = −1.5`. [^4]
- [sklearn/neighbors/_lof.py at 1.9.1](https://github.com/scikit-learn/scikit-learn/blob/1.9.1/sklearn/neighbors/_lof.py) — scikit-learn source code, 2026. Backs: reachability distance, local reachability density with `1e-10`, LOF as the mean density ratio, percentile `offset_`. [^5]
- [sklearn.svm.OneClassSVM](https://scikit-learn.org/stable/modules/generated/sklearn.svm.OneClassSVM.html) — scikit-learn developers, living (1.9.1). Backs: support estimation, RBF default, `nu` bounds and default 0.5, `gamma='scale'`. [^6]
- [sklearn.covariance.EllipticEnvelope](https://scikit-learn.org/stable/modules/generated/sklearn.covariance.EllipticEnvelope.html) — scikit-learn developers, living (1.9.1). Backs: `contamination=0.1` default, `mahalanobis` returning squared distances, FastMCD, `n_samples > n_features²`. [^7]
- [sklearn.covariance.MinCovDet](https://scikit-learn.org/stable/modules/generated/sklearn.covariance.MinCovDet.html) — scikit-learn developers, living (1.9.1). Backs: Gaussian or unimodal symmetric data, not multi-modal, raw then corrected and reweighted estimates. [^8]
- [Robust covariance estimation and Mahalanobis distances relevance](https://scikit-learn.org/stable/auto_examples/covariance/plot_mahalanobis_distances.html) — scikit-learn developers, living (1.9.1). Backs: the Mahalanobis formula, MLE covariance pulled by outliers, MCD's `(n_samples + n_features + 1)/2` subset with the smallest determinant. [^9]
- `machine-learning/lab-setup.md` — the lab where the isolation-forest path lengths, contamination sweep, LOF by hand, five-detector comparison, LOF novelty mode and few-label ROC-AUC ran on 2026-11-25. [^10]
- [Realistic Evaluation of Deep Semi-Supervised Learning Algorithms](https://arxiv.org/html/1804.09170) — Oliver, Odena, Raffel, Cubuk, Goodfellow, 2018. Backs: the Hoeffding estimate of nearly 20,000 validation examples for ±1 % at 95 % confidence. [^11]
- [sklearn/covariance/_elliptic_envelope.py at 1.9.1](https://github.com/scikit-learn/scikit-learn/blob/1.9.1/sklearn/covariance/_elliptic_envelope.py) — scikit-learn source code, 2026. Backs: `score_samples` returning `−self.mahalanobis(X)`. [^12]

## Related
- `machine-learning/unsupervised-learning/gaussian-mixtures-and-em.md` — a density model whose low likelihood is another anomaly score.
- `machine-learning/unsupervised-learning/density-and-hierarchical-clustering.md` — DBSCAN's noise points, a by-product of density clustering.
- `machine-learning/supervised-learning/support-vector-machines.md` — kernels, `gamma` and margins behind the one-class SVM.
- `machine-learning/supervised-learning/tree-ensembles.md` — the random-tree ensembles isolation forest borrows from.
- `machine-learning/evaluation/classification-metrics.md` — ROC-AUC, precision and recall used to score detectors.
- `machine-learning/evaluation/class-imbalance.md` — the rare-positive regime every anomaly evaluation is in.
- `machine-learning/ml-systems/data-drift-and-monitoring.md` — when the whole distribution moves, not single points.
- `machine-learning/unsupervised-learning/semi-supervised-learning.md` — using a few labels together with unlabelled data.
