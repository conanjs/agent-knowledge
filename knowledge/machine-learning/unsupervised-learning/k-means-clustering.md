---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/unsupervised-learning
status: verified
applies-to: ["scikit-learn 1.9.1"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [machine-learning, unsupervised-learning, clustering, k-means, lloyd, k-means-plus-plus, inertia, elbow, silhouette, scikit-learn]
---

# k-means clustering: Lloyd's algorithm, k-means++ and choosing k

## Summary
**TL;DR:** k-means splits unlabelled points into k groups, each represented by the mean of its points (its centroid). Lloyd's algorithm alternates two steps, assign every point to its nearest centroid and move every centroid to the mean of its points, until the centroids stop moving. It always converges, but to a local minimum that depends on the starting centroids, so the start (k-means++ seeding) and restarts matter. It assumes compact, roughly round clusters of similar spread, and you must choose k yourself.
**Use this when:** you cluster numeric data with scikit-learn's `KMeans`, results change between runs, you need to pick `n_clusters`, or k-means splits data in a way that looks wrong.
**Not this doc:** soft (probabilistic) assignments and elliptical clusters → `machine-learning/unsupervised-learning/gaussian-mixtures-and-em.md`; clusters of any shape, with noise → `machine-learning/unsupervised-learning/density-and-hierarchical-clustering.md`; formulas of the silhouette and the adjusted Rand index → `machine-learning/evaluation/metrics-catalog.md`.

## Problem
Clustering has no labels to check against, so a bad result looks as confident as a good one. Engineers who use k-means as a black box trust a single run although another seed gives a different partition, pick k by eye, feed it features on wildly different scales, or apply it to shapes it cannot represent. In the lab, k-means with k = 2 on two interleaved half-moons agreed with the true groups at an adjusted Rand index (ARI: 1.0 = the same grouping as the truth, close to 0 = no better than random labels ✅[^1]) of only 0.248, while on two round blobs it scored a perfect 1.000 ✅[^6]. Nothing in the output warns you which case you are in.

## Mental model
**Analogy:** placing k post offices in a new town. Every house uses its nearest office (assign). Then every office moves to the average position of the houses it serves (update). Repeat until no office moves. The total squared walking distance can only go down, but if you drop all the first offices into one neighbourhood, you can get stuck with a poor layout: that is why the starting positions matter.

**Artifact:** the quantity k-means minimizes, called inertia or within-cluster sum of squares ✅[^1]:
```text
inertia = Σ_i ‖x_i − μ_c(i)‖²

x_i       one data point (a vector of features)
μ_c(i)    the centroid (mean) of the cluster point i is assigned to
‖a − b‖²  squared Euclidean distance: sum over features of (a_f − b_f)²
Σ_i       sum over all n points

Example: one cluster {(0,0), (2,0), (1,3)} has centroid (1,1);
squared distances 2, 2, 4 → this cluster adds 8 to the inertia.
```
It is not normalized: lower is better and zero is optimal, and that is all the number says ✅[^1].

## How it works
### Lloyd's algorithm
k-means is often called Lloyd's algorithm; scikit-learn's User Guide describes it in three steps plus a stopping test ✅[^1]:
1. **Initialize:** choose k starting centroids. The most basic method picks k samples of the data; scikit-learn's default is k-means++ (below) ✅[^1] ✅[^2].
2. **Assign:** give each sample to its nearest centroid. Geometrically, the centroids cut space into Voronoi cells (the region closer to one centroid than to any other), and each cell is a cluster ✅[^1].
3. **Update:** move each centroid to the mean of the samples assigned to it ✅[^1].
4. **Stop:** repeat 2–3 until the centroids barely move. In scikit-learn the test is the change of the centres between two iterations (Frobenius norm, relative tolerance `tol=1e-4`), not the decrease of inertia, with at most `max_iter=300` iterations ✅[^1] ✅[^2].

Each half-step can only keep or lower inertia: the assign step keeps, for every point, the smallest of its k squared distances, and the update step moves each centroid to its group's mean, the position with the least total squared distance to that group. The lab run below shows inertia falling at every half-step ✅[^6]. Given enough time k-means always converges, but possibly to a local minimum that depends on the initial centroids ✅[^1]. The average cost is `O(k·n·T)` for n samples and T iterations ✅[^2].

k-means is a special case of a Gaussian mixture fitted by EM (expectation-maximization) in which every component has the same small diagonal covariance with all-equal entries, that is a sphere ✅[^1]; `machine-learning/unsupervised-learning/gaussian-mixtures-and-em.md` explains the general case.

### k-means++ seeding
k-means++ spreads the starting centroids apart. scikit-learn's implementation (`_kmeans_plusplus` in 1.9.1) ✅[^3]:
1. Pick the first centre at random from the data.
2. For each next centre, draw candidate points with probability proportional to their squared distance to the closest centre already chosen: far points are likely, points next to a centre are almost never picked.
3. Draw `2 + int(ln k)` candidates (4 for k = 15) and keep the one that lowers inertia most. This "greedy" variant differs from the original k-means++, which draws one candidate; scikit-learn's docstring says the original worked less well in experiments ✅[^3] ✅[^2].

`n_init` sets how many full runs with different seeds are made, keeping the lowest inertia; `n_init='auto'` means 1 run with k-means++ and 10 runs with `init='random'` ✅[^2]. Lab run (`machine-learning/lab-setup.md`), 2026-11-24, scikit-learn 1.9.1, 2,000 points from 15 blobs, one run per seed for 20 seeds ✅[^6]:
```text
best of 20 k-means++ runs (n_init=20): inertia=3788
random   : inertia min=  4871 median=  9091 max= 19272  runs within 0.1% of best: 0/20
k-means++: inertia min=  3788 median=  3788 max=  4873  runs within 0.1% of best: 13/20
```
In this run no random start out of 20 reached the best solution, and the median random start had 2.4 times its inertia; 13 of 20 k-means++ starts reached it.

### Choosing k
Inertia keeps falling as k grows (18,638 at k = 2 down to 749 at k = 8 below ✅[^6]), so its minimum cannot pick k. Two common readings on 600 points from 4 blobs, same lab run ✅[^6]:
```text
k=2: inertia= 18637.9  silhouette=0.591
k=3: inertia=  4178.9  silhouette=0.757
k=4: inertia=  1160.3  silhouette=0.788
k=5: inertia=  1045.8  silhouette=0.691
…
k=8: inertia=   748.7  silhouette=0.333
```
- **Elbow:** the drop in inertia is large up to k = 4 (4179 → 1160) and small after it (1160 → 1046): the curve bends at the true k ✅[^6].
- **Silhouette:** for each sample, `s = (b − a) / max(a, b)`, where `a` is its mean distance to its own cluster and `b` its mean distance to the nearest other cluster; the score is the mean over samples, from −1 to +1, higher for dense, well-separated clusters ✅[^1]. Here it peaks at k = 4 (0.788) ✅[^6].

In real data there is no uniquely defined true number of clusters; k has to come from data-based criteria plus the goal of the analysis ✅[^4].

One script prints the k-means++ output, the choosing-k output and the moons result quoted in Problem; its last two lines are `blobs: adjusted Rand index vs true groups = 1.000` and `moons: adjusted Rand index vs true groups = 0.248`.

<details><summary>Full script (prints the output above)</summary>

```python
import numpy as np
from sklearn.cluster import KMeans
from sklearn.datasets import make_blobs, make_moons
from sklearn.metrics import adjusted_rand_score, silhouette_score

# 1. Random vs k-means++ initialisation: one run (n_init=1) per seed, 20 seeds
X, _ = make_blobs(n_samples=2000, centers=15, cluster_std=1.0, center_box=(-20, 20), random_state=0)
best = KMeans(15, init="k-means++", n_init=20, random_state=0).fit(X).inertia_
print(f"best of 20 k-means++ runs (n_init=20): inertia={best:.0f}")
for init in ("random", "k-means++"):
    inert = np.array([KMeans(15, init=init, n_init=1, random_state=s).fit(X).inertia_ for s in range(20)])
    print(f"{init:9s}: inertia min={inert.min():6.0f} median={np.median(inert):6.0f} max={inert.max():6.0f}"
          f"  runs within 0.1% of best: {(inert <= best * 1.001).sum()}/20")

# 2. Elbow and silhouette for k = 2..8 on 4 blobs
X4, _ = make_blobs(n_samples=600, centers=4, cluster_std=1.0, random_state=42)
for k in range(2, 9):
    km = KMeans(k, n_init=10, random_state=0).fit(X4)
    print(f"k={k}: inertia={km.inertia_:8.1f}  silhouette={silhouette_score(X4, km.labels_):.3f}")

# 3. Same algorithm, two shapes: blobs vs two interleaved half-moons
Xb, yb = make_blobs(n_samples=400, centers=2, random_state=1)
Xm, ym = make_moons(n_samples=400, noise=0.05, random_state=1)
for name, (Xs, ys) in {"blobs": (Xb, yb), "moons": (Xm, ym)}.items():
    labels = KMeans(2, n_init=10, random_state=0).fit_predict(Xs)
    print(f"{name}: adjusted Rand index vs true groups = {adjusted_rand_score(ys, labels):.3f}")
```
</details>

## Worked example
Twelve 2-D points from three blobs, with the first three points as deliberately poor starting centroids, run by hand in numpy and then by `KMeans` from the same start. Core loop:
```python
d2 = ((X[:, None, :] - C[None, :, :]) ** 2).sum(axis=2)            # squared distance to each centroid
labels = d2.argmin(axis=1)                                          # assign step
newC = np.array([X[labels == j].mean(axis=0) for j in range(3)])    # update step
```
Lab run (`machine-learning/lab-setup.md`), 2026-11-24, scikit-learn 1.9.1, two runs identical ✅[^6]:
```text
blob that generated each point: 022021100211
iter 1: labels=012011100101  inertia after assign= 150.31  after update=  74.40  centroid shift=3.641
iter 2: labels=022011100211  inertia after assign=  54.24  after update=  27.59  centroid shift=2.469
iter 3: labels=022021100211  inertia after assign=  13.70  after update=   8.91  centroid shift=1.094
iter 4: labels=022021100211  inertia after assign=   8.91  after update=   8.91  centroid shift=0.000
scikit-learn: inertia_ = 8.91  n_iter_ = 4  same partition as by hand: True  matches the blobs: True
```
Reading it line by line:
- **Iteration 1:** the three starting centroids are three arbitrary samples, so the first assignment mixes the blobs (`012011100101`) and inertia is 150.31. Moving each centroid to its group's mean halves it to 74.40.
- **Iterations 2–3:** with better centroids, three points switch cluster in iteration 2 and one more in iteration 3, and every half-step lowers inertia: 74.40 → 54.24 → 27.59 → 13.70 → 8.91.
- **Iteration 4:** no point changes cluster, so the means do not move (shift 0.000): converged. The final labels equal the generating blobs (here even the cluster numbers happen to match).
- **scikit-learn** started from the same three points reaches the same partition and the same inertia, 8.91, in 4 iterations.

<details><summary>Full script (prints the output above)</summary>

```python
import numpy as np
from sklearn.cluster import KMeans
from sklearn.datasets import make_blobs
from sklearn.metrics import adjusted_rand_score

X, y = make_blobs(n_samples=12, centers=[[0, 0], [6, 0], [3, 5]], cluster_std=0.7, random_state=7)
init = X[[0, 1, 2]]                      # three samples as starting centroids
C = init.copy()
print("blob that generated each point:", ''.join(map(str, y)))

def inertia(X, C, labels):
    return ((X - C[labels]) ** 2).sum()

for it in range(1, 20):
    d2 = ((X[:, None, :] - C[None, :, :]) ** 2).sum(axis=2)   # squared distance to each centroid
    labels = d2.argmin(axis=1)                                 # assignment step
    after_assign = inertia(X, C, labels)
    newC = np.array([X[labels == j].mean(axis=0) for j in range(3)])   # update step
    after_update = inertia(X, newC, labels)
    shift = np.linalg.norm(newC - C)
    print(f"iter {it}: labels={''.join(map(str, labels))}  inertia after assign={after_assign:7.2f}"
          f"  after update={after_update:7.2f}  centroid shift={shift:.3f}")
    C = newC
    if shift < 1e-9:
        break

km = KMeans(n_clusters=3, init=init, n_init=1, algorithm="lloyd").fit(X)
print("scikit-learn: inertia_ =", round(km.inertia_, 2), " n_iter_ =", km.n_iter_,
      " same partition as by hand:", adjusted_rand_score(km.labels_, labels) == 1.0,
      " matches the blobs:", adjusted_rand_score(y, labels) == 1.0)
```
</details>

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Elongated (anisotropic) or non-convex clusters | Wrong split; two half-moons scored ARI 0.248 in the lab ✅[^6] | Inertia assumes convex, isotropic clusters ✅[^1] |
| Clusters with very different spreads | Boundary falls in the wrong place | k-means is the maximum-likelihood fit of a mixture whose Gaussians share one variance ✅[^4] |
| One huge and one tiny cluster | Poor local minima are more likely; more seeds help | The example raises `n_init` to 10 for unevenly sized blobs ✅[^4] |
| Features on very different scales | The largest-scale feature dominates the distances | In scikit-learn's wine example, distances are driven by `proline` (0–1,000) and `hue` (1–10) is comparatively ignored ✅[^5]; scale first (`machine-learning/data-and-features/preprocessing-and-pipelines.md`) |
| Many dimensions | Euclidean distances tend to become inflated | Curse of dimensionality; running PCA (principal component analysis) first can help and speeds things up ✅[^1] |
| `init='random'` with `n_init='auto'` | 10 runs, best kept | `'auto'` means 10 for random, 1 for k-means++ ✅[^2] |
| Fit stopped by `max_iter` or `tol` | `cluster_centers_` may not be the means of the final clusters | Documented: labels are reassigned after the last iteration to agree with `predict` ✅[^2] |
| Centroids as "typical examples" | A centroid is usually not a data point | It is a mean in the same space ✅[^1] |
| `sample_weight=2` on a point | Same as duplicating that point | Weights enter centres and inertia ✅[^1] |
| Over 10k samples | `MiniBatchKMeans` is probably much faster, with slightly worse results | It updates centres from random mini-batches with a streaming mean ✅[^1] ✅[^2] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `KMeans` (Lloyd) | Fast, simple, scales to many samples; assigns new points (`predict`) ✅[^1] | Needs k; round, similar-size clusters; local minima ✅[^1] |
| `MiniBatchKMeans` | Drastically less computation to converge ✅[^1] | Results generally slightly worse ✅[^1] |
| `BisectingKMeans` | Cheaper for large k, no empty clusters, a visible hierarchy ✅[^1] | Cannot use k-means++ by design ✅[^1] |
| `GaussianMixture` (Gaussian mixture model) | Gaussian clusters with no constraint on their variances ✅[^4] | More parameters to fit; see `gaussian-mixtures-and-em.md` |

## Takeaways
- Never trust one k-means run: keep k-means++ and compare a few seeds, or raise `n_init`. [rule-candidate]
- Scale features before clustering; distances are only as fair as the feature scales. [rule-candidate]
- Inertia always falls with k: choose k from the elbow, the silhouette and what the clusters are for.
- If clusters are not round blobs, k-means will still return k groups, confidently wrong: switch to a mixture or a density method.

## Verification status
- Verified: 46 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- [Clustering (User Guide §2.3)](https://scikit-learn.org/stable/modules/clustering.html) — scikit-learn developers, living (1.9.1 docs). Backs: inertia definition and drawbacks, Lloyd's three steps, Voronoi view, stop on centroid movement, convergence to a local minimum, k-means as EM with equal small covariance, PCA before k-means, sample weights, mini-batch and bisecting k-means, silhouette definition. [^1]
- [sklearn.cluster.KMeans](https://scikit-learn.org/stable/modules/generated/sklearn.cluster.KMeans.html) — scikit-learn developers, living (1.9.1). Backs: defaults (`init`, `n_init='auto'`, `max_iter`, `tol`), greedy k-means++, `O(k·n·T)`, labels/centres after early stop, MiniBatchKMeans for large n. [^2]
- [sklearn/cluster/_kmeans.py at 1.9.1](https://raw.githubusercontent.com/scikit-learn/scikit-learn/1.9.1/sklearn/cluster/_kmeans.py) — scikit-learn source code, 2026. Backs: k-means++ steps, sampling proportional to squared distance, `2 + int(log(k))` local trials, vanilla variant worked less well. [^3]
- [Demonstration of k-means assumptions](https://scikit-learn.org/stable/auto_examples/cluster/plot_kmeans_assumptions.html) — scikit-learn developers, living. Backs: no uniquely defined true k, anisotropic blobs, unequal variance as an equal-variance mixture, more inits for uneven sizes, GaussianMixture as the alternative. [^4]
- [Importance of Feature Scaling](https://scikit-learn.org/stable/auto_examples/preprocessing/plot_scaling_importance.html) — scikit-learn developers, living. Backs: distances dominated by the large-scale `proline` feature. [^5]
- `machine-learning/lab-setup.md` — the lab where Lloyd's iterations, the random vs k-means++ seeds, the elbow and silhouette sweep and the moons-vs-blobs comparison ran on 2026-11-24. [^6]

## Related
- `machine-learning/unsupervised-learning/gaussian-mixtures-and-em.md` — the probabilistic generalization: soft assignments, per-cluster covariance.
- `machine-learning/unsupervised-learning/density-and-hierarchical-clustering.md` — DBSCAN, HDBSCAN and linkage for shapes k-means cannot represent.
- `machine-learning/unsupervised-learning/principal-component-analysis.md` — reducing dimensions before clustering.
- `machine-learning/evaluation/metrics-catalog.md` — silhouette, adjusted Rand index and other clustering metrics.
- `machine-learning/data-and-features/preprocessing-and-pipelines.md` — scaling features before distance-based methods.
- `machine-learning/supervised-learning/k-nearest-neighbors.md` — the same distance and curse-of-dimensionality issues in a supervised method.
