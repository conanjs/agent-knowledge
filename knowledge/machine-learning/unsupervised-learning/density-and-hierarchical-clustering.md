---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/unsupervised-learning
status: verified
applies-to: ["scikit-learn 1.9.1"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [machine-learning, unsupervised-learning, clustering, dbscan, hdbscan, agglomerative, linkage, ward, single-linkage, dendrogram, noise, scikit-learn]
---

# Density-based and hierarchical clustering: DBSCAN, HDBSCAN and linkage

## Summary
**TL;DR:** Density-based clustering calls a cluster a dense region separated from others by sparse space, so clusters can have any shape and isolated points are labelled noise (`-1`). DBSCAN (density-based spatial clustering of applications with noise) uses one density threshold, the radius `eps` plus a count `min_samples`; one threshold cannot fit clusters of different densities. HDBSCAN (hierarchical DBSCAN) tries every radius at once and keeps the clusters that persist longest, so it needs mainly `min_cluster_size`. Agglomerative clustering starts with every point alone and keeps merging the two closest clusters; the linkage rule defines "closest", and the record of merges is a dendrogram you cut to get clusters.
**Use this when:** clusters are not round blobs, the data has outliers that should stay unassigned, you do not know the number of clusters, or you must pick `eps`, `min_samples`, `min_cluster_size` or a `linkage` in scikit-learn.
**Not this doc:** round clusters with a known k → `machine-learning/unsupervised-learning/k-means-clustering.md`; soft, Gaussian-shaped clusters → `machine-learning/unsupervised-learning/gaussian-mixtures-and-em.md`; scoring a clustering → `machine-learning/evaluation/metrics-catalog.md`.

## Problem
k-means and Gaussian mixtures need k in advance and model clusters as blobs; k-means scored an adjusted Rand index (ARI, 1.0 = identical to the true grouping, about 0 = random ✅[^1]) of 0.248 on two interleaved half-moons in the lab ✅[^7] (`machine-learning/unsupervised-learning/k-means-clustering.md`). Density and linkage methods handle such shapes, but their parameters are just as easy to get wrong: in the lab, the same DBSCAN on the same half-moons labelled 263 of 320 points as noise with `eps=0.05`, found the two moons almost perfectly with `eps=0.2`, and merged the two moons into one cluster with `eps=0.3` ✅[^7].

## Mental model
**Analogy:** islands and sea level. Dense regions are land, sparse regions are sea. DBSCAN fixes one sea level: too high (small `eps`) and small islands drown into noise; too low (large `eps`) and separate islands join into one continent. HDBSCAN watches the islands while the water drains from high to low and keeps the ones that stay separate the longest. Agglomerative clustering is a family tree built bottom-up: join the two closest relatives, then the two closest groups, until one family remains.

**Artifact:** DBSCAN's three kinds of point, on six numbers with `eps=0.25`. A core sample has at least `min_samples` samples, itself included, within `eps`; a border sample is within `eps` of a core sample but not core itself; noise is everything else ✅[^1] ✅[^2]. Lab run (`machine-learning/lab-setup.md`), 2026-11-24, scikit-learn 1.9.1 ✅[^7]:
```python
import numpy as np
from sklearn.cluster import DBSCAN

x = np.array([[0.0], [0.1], [0.2], [0.3], [0.4], [5.0]])   # 0.2 has 4 other points within 0.25
for ms in (5, 6):
    db = DBSCAN(eps=0.25, min_samples=ms).fit(x)
    print(f"min_samples={ms}: core={x[db.core_sample_indices_].ravel()}  labels={db.labels_}")
```
```text
min_samples=5: core=[0.2]  labels=[ 0  0  0  0  0 -1]
min_samples=6: core=[]  labels=[-1 -1 -1 -1 -1 -1]
```
With `min_samples=5`, 0.2 is core (4 neighbours + itself), 0.0, 0.1, 0.3 and 0.4 are border points of its cluster, and 5.0 is noise. With 6, nothing is dense enough and every point is noise. The block above is the full script.

## How it works
### DBSCAN
1. **Neighbourhoods:** for each sample, find the samples within distance `eps` (default 0.5) ✅[^2]. scikit-learn uses ball trees or k-d trees for this, not a full distance matrix, when it can ✅[^1].
2. **Core samples:** a sample is core when its neighbourhood holds at least `min_samples` samples (default 5), itself included ✅[^2] ✅[^7].
3. **Grow clusters:** start from a core sample, add its neighbours that are core, then theirs, recursively; the cluster also takes the non-core neighbours of its core samples, which sit on its fringe ✅[^1].
4. **Label noise:** a sample that is not core and is at least `eps` from every core sample is an outlier, label `-1` ✅[^1] ✅[^2].

`eps` is the parameter to tune: too small and most data is noise, too large and close clusters merge, up to one cluster for the whole set; one heuristic looks for a knee in the plot of nearest-neighbour distances ✅[^1]. A higher `min_samples` or a lower `eps` demands more density, and `min_samples` mainly controls how tolerant the algorithm is to noise ✅[^1].

### HDBSCAN
Five steps: 1–3 as scikit-learn's User Guide describes them ✅[^1], 4–5 as the hdbscan authors' docs describe them ✅[^5]:
1. **Core distance** `d_c(x)`: the distance from `x` to its `min_samples`-th nearest neighbour, counting itself (a cheap density estimate: small in dense regions).
2. **Mutual reachability distance** `d_m(p, q) = max{d_c(p), d_c(q), d(p, q)}`, with `d` the original distance. Dense points keep their distances, while sparse points are pushed to at least their core distance from everyone: the hdbscan authors call this lowering the sea level ✅[^5].
3. **Minimum spanning tree** of the graph whose edge weights are mutual reachability distances. Removing its edges from the heaviest down produces every partition DBSCAN* (a slightly modified DBSCAN) would give for every `eps` with this `min_samples` ✅[^1].
4. **Condense the tree:** when a split cuts off fewer than `min_cluster_size` points, treat it as points falling out of the parent cluster rather than a new cluster ✅[^5].
5. **Select clusters:** keep the clusters that persist longest (the most "stable"), never a cluster together with one of its descendants; points outside every selected cluster are noise, `-1` ✅[^5]. scikit-learn's default for this step is `cluster_selection_method='eom'` (excess of mass) ✅[^3].

So `eps` disappears and `min_samples` remains, which the docs say tends to be a more robust hyperparameter ✅[^1]. In scikit-learn `min_cluster_size` defaults to 5 and `min_samples=None` means "same as `min_cluster_size`" ✅[^3]. `probabilities_` gives each point's membership strength, 0 for noise ✅[^3].

### Agglomerative clustering and dendrograms
1. **Start:** every sample is its own cluster ✅[^1].
2. **Merge:** join the pair of clusters that minimizes the linkage criterion, and repeat ✅[^1] ✅[^4]:
   - `single`: the distance between the closest members of the two clusters;
   - `complete`: the distance between the farthest members;
   - `average`: the mean distance over all pairs of members;
   - `ward` (default): the merge that increases the within-cluster sum of squared differences least, like k-means' objective.
3. **Record:** `children_` lists the two nodes merged at each step and `distances_` the merge heights, when `distance_threshold` or `compute_distances=True` is set; together they are the dendrogram (the tree of merges) ✅[^4].
4. **Cut:** stop at `n_clusters` clusters, or let `distance_threshold` stop merges at or above a height ✅[^4].

Lab run (`machine-learning/lab-setup.md`), 2026-11-24, scikit-learn 1.9.1: the full merge record for six points on a line, `0, 1, 2.5, 7, 8, 15` (node numbers 6 and up are merged clusters), then each linkage on chained and on noisy data with 2 clusters requested; two runs identical ✅[^7]:
```text
single  : 0+1->6 @1.00  3+4->7 @1.00  6+2->8 @1.50  8+7->9 @4.50  9+5->10 @7.00
complete: 0+1->6 @1.00  3+4->7 @1.00  2+6->8 @2.50  7+8->9 @8.00  5+9->10 @15.00
ward    : 0+1->6 @1.00  3+4->7 @1.00  2+6->8 @2.31  5+7->9 @8.66  8+9->10 @15.30
ward height of 2+6: sqrt(2 * SSE increase) = sqrt(2 * 2.667) = 2.31
moons
  single  : cluster sizes=[200, 200]  ARI=1.000
  average : cluster sizes=[302, 98]  ARI=0.239
  complete: cluster sizes=[294, 106]  ARI=0.279
  ward    : cluster sizes=[300, 100]  ARI=0.249
blobs + 20 noise points
  single  : cluster sizes=[418, 2]  ARI=0.000
  average : cluster sizes=[9, 411]  ARI=0.000
  complete: cluster sizes=[219, 201]  ARI=0.951
  ward    : cluster sizes=[204, 216]  ARI=0.893
```
- **The merge record:** single linkage joins `{0, 1, 2.5}` to `{7, 8}` at 4.50 (the gap 7 − 2.5) and adds 15 last; Ward instead joins 15 to `{7, 8}` first, at 8.66, because that raises the sum of squares less. Ward's heights are not plain distances: in this run 2.31 equals the square root of twice the increase in within-cluster sum of squares (SSE).
- **Chained shapes:** single linkage follows the chain of close neighbours and recovers both moons exactly; the other three cut each moon.
- **Noise:** single linkage chains through the scattered points and returns one cluster of 418 plus a cluster of 2; average does the same. Complete (0.951) and Ward (0.893) recover the blobs. scikit-learn's own comparison summarizes it: single is fast and handles non-globular data but performs poorly with noise, and Ward is the most effective on noisy data ✅[^6]; in this one run complete edged out Ward.

<details><summary>Full script (prints the output above)</summary>

```python
import numpy as np
from sklearn.cluster import AgglomerativeClustering
from sklearn.datasets import make_blobs, make_moons
from sklearn.metrics import adjusted_rand_score

# 1. The merge sequence (a dendrogram as numbers) for 6 points on a line
x = np.array([[0.0], [1.0], [2.5], [7.0], [8.0], [15.0]])
for linkage in ("single", "complete", "ward"):
    m = AgglomerativeClustering(n_clusters=None, distance_threshold=0, linkage=linkage).fit(x)
    steps = [f"{a}+{b}->{6 + i} @{d:.2f}" for i, ((a, b), d) in enumerate(zip(m.children_, m.distances_))]
    print(f"{linkage:8s}: " + "  ".join(steps))
sse = lambda pts: ((pts - pts.mean()) ** 2).sum()          # within-cluster sum of squares
gain = sse(x[[0, 1, 2]]) - sse(x[[0, 1]]) - sse(x[[2]])
print(f"ward height of 2+6: sqrt(2 * SSE increase) = sqrt(2 * {gain:.3f}) = {np.sqrt(2 * gain):.2f}")

# 2. Linkage choice on two shapes, 2 clusters requested each time
Xm, ym = make_moons(n_samples=400, noise=0.05, random_state=0)            # chained, non-globular
Xb, yb = make_blobs(n_samples=400, centers=[[0, 0], [5, 0]], random_state=0)
rng = np.random.default_rng(0)
Xb_noisy = np.vstack([Xb, rng.uniform(-3, 8, size=(20, 2))])              # 20 scattered points
for name, X, y in (("moons", Xm, ym), ("blobs + 20 noise points", Xb_noisy, yb)):
    print(name)
    for linkage in ("single", "average", "complete", "ward"):
        lab = AgglomerativeClustering(n_clusters=2, linkage=linkage).fit_predict(X)
        print(f"  {linkage:8s}: cluster sizes={np.bincount(lab).tolist()}  ARI={adjusted_rand_score(y, lab[:len(y)]):.3f}")
```
</details>

## Worked example
Part 1: DBSCAN with `min_samples=5` on 300 points of two half-moons plus 20 uniformly scattered points, sweeping `eps`. Part 2: two tight blobs close together (spread 0.15, centres 1.2 apart) and one wide blob far away (spread 1.5), 150 points each, where one `eps` has to serve both densities; then HDBSCAN. Lab run (`machine-learning/lab-setup.md`), 2026-11-24, scikit-learn 1.9.1, two runs identical ✅[^7]:
```text
1. DBSCAN on two moons + 20 noise points, min_samples=5
  eps=0.05: clusters=10  core= 17  border= 40  noise(-1)=263  ARI on moon points=0.009
  eps=0.10: clusters=10  core=238  border= 49  noise(-1)= 33  ARI on moon points=0.339
  eps=0.20: clusters= 2  core=304  border=  4  noise(-1)= 12  ARI on moon points=0.987
  eps=0.30: clusters= 1  core=309  border=  2  noise(-1)=  9  ARI on moon points=0.000
  eps=0.50: clusters= 1  core=314  border=  0  noise(-1)=  6  ARI on moon points=0.000
2. Two tight blobs + one wide blob: one eps for all vs HDBSCAN
  DBSCAN eps=0.2: clusters=3  noise=145  wide-blob points left as noise=145  tight blobs merged=False
  DBSCAN eps=0.4: clusters=10  noise= 71  wide-blob points left as noise= 71  tight blobs merged=False
  DBSCAN eps=0.8: clusters=2  noise= 10  wide-blob points left as noise= 10  tight blobs merged=True
  HDBSCAN min_cluster_size=15: clusters=3  noise=1  wide-blob points left as noise=1  ARI=0.997
```
Reading it:
- **`eps=0.05`:** almost no point has 5 samples within 0.05, so only 17 are core and 263 of 320 are noise; the rest form 10 fragments.
- **`eps=0.10`:** most points are now core, but thin parts of the moons still break, giving 10 clusters.
- **`eps=0.20`:** exactly the two moons (ARI 0.987 on the moon points), and 12 points left as noise: the 20 scattered points minus a few that happened to land near a moon.
- **`eps=0.30` and up:** the gap between the moons is now within reach, so they chain into one cluster (ARI 0.000).
- **Part 2:** with `eps=0.2` the tight blobs are found but 145 of the 150 wide-blob points are noise; with `eps=0.4` the wide blob shatters into fragments; with `eps=0.8` the wide blob is found but the two tight blobs merge. No single `eps` gives three clusters. HDBSCAN, with no `eps`, finds all three and leaves 1 point as noise (ARI 0.997).

<details><summary>Full script (prints the output above)</summary>

```python
import numpy as np
from sklearn.cluster import DBSCAN, HDBSCAN
from sklearn.datasets import make_moons, make_blobs
from sklearn.metrics import adjusted_rand_score

rng = np.random.default_rng(0)
Xm, ym = make_moons(n_samples=300, noise=0.06, random_state=0)
X = np.vstack([Xm, rng.uniform([-1.5, -1.0], [2.5, 1.5], size=(20, 2))])   # 20 scattered noise points
print("1. DBSCAN on two moons + 20 noise points, min_samples=5")
for eps in (0.05, 0.1, 0.2, 0.3, 0.5):
    db = DBSCAN(eps=eps, min_samples=5).fit(X)
    lab = db.labels_
    n_clusters = len(set(lab)) - (-1 in lab)
    core = np.zeros(len(X), bool); core[db.core_sample_indices_] = True
    print(f"  eps={eps:4.2f}: clusters={n_clusters:2d}  core={core.sum():3d}  border={(~core & (lab >= 0)).sum():3d}"
          f"  noise(-1)={(lab == -1).sum():3d}  ARI on moon points={adjusted_rand_score(ym, lab[:300]):.3f}")

# two tight blobs close together (std 0.15) and one wide blob far away (std 1.5), 150 points each
Xd, yd = make_blobs(n_samples=[150, 150, 150], centers=[[0, 0], [1.2, 0], [8, 0]],
                    cluster_std=[0.15, 0.15, 1.5], random_state=0)
print("2. Two tight blobs + one wide blob: one eps for all vs HDBSCAN")
for eps in (0.2, 0.4, 0.8):
    lab = DBSCAN(eps=eps, min_samples=5).fit(Xd).labels_
    print(f"  DBSCAN eps={eps:3.1f}: clusters={len(set(lab)) - (-1 in lab)}  noise={(lab == -1).sum():3d}"
          f"  wide-blob points left as noise={(lab[yd == 2] == -1).sum():3d}"
          f"  tight blobs merged={len(set(lab[yd == 0]) & set(lab[yd == 1]) - {-1}) > 0}")
h = HDBSCAN(min_cluster_size=15, copy=False).fit(Xd)
lab = h.labels_
print(f"  HDBSCAN min_cluster_size=15: clusters={lab.max() + 1}  noise={(lab == -1).sum()}"
      f"  wide-blob points left as noise={(lab[yd == 2] == -1).sum()}"
      f"  ARI={adjusted_rand_score(yd, lab):.3f}")
```
</details>

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Clusters of different densities, one `eps` | Sparse clusters become noise or dense ones merge (lab part 2) ✅[^7] | DBSCAN assumes one global density requirement ✅[^1]; HDBSCAN explores all density scales ✅[^1] |
| A border point within `eps` of two clusters | Its cluster depends on the order of the data | It joins whichever cluster is built first; core points always get the same cluster, only the label numbers change ✅[^1] |
| `min_samples` and the point itself | The count includes the point: 4 neighbours + itself is core at `min_samples=5` (lab) ✅[^7] | The API reference page says it includes the point ✅[^2]; the User Guide's wording "min_samples other samples" ✅[^1] reads as one more |
| HDBSCAN noise rule in the User Guide | The 1.9.1 text says points whose core distance is *less* than ε are marked noise ✅[^1] | Every mutual reachability edge of `p` is at least `d_c(p)` by definition ✅[^1], so cutting edges above ε isolates the points whose core distance is *greater* than ε: read it as "greater". The Guide's own outline agrees: each point gets a self edge weighted by its core distance, and a component left with no edge is noise ✅[^1] |
| Judging DBSCAN with the silhouette score | Scores look worse than they should | The silhouette is generally higher for convex clusters than for density-based ones ✅[^1] |
| New points after fitting | DBSCAN, HDBSCAN and `AgglomerativeClustering` have no `predict` | They are transductive: not designed to be applied to unseen data ✅[^1] |
| DBSCAN on large data with sparse input or large `eps` | Memory can grow to `O(n²)` | Full pairwise similarity when trees cannot be used, or many neighbours ✅[^1] ✅[^2]; OPTICS (ordering points to identify the clustering structure) keeps one row at a time ✅[^1] |
| HDBSCAN on high-dimensional data | Most points can end up as noise: in umap-learn's example on 50-dimensional digit images, under 18 % of points were clustered ✅[^8] | As a density method, HDBSCAN tends to suffer from the curse of dimensionality: high-dimensional data needs more samples to show much density ✅[^8] |
| Single linkage on noisy data | One giant cluster plus crumbs (lab: 418 and 2) ✅[^7] | It is the worst linkage for the "rich get richer" uneven-size effect ✅[^1] |
| Ward with a non-Euclidean metric | Not allowed | Ward accepts only `euclidean`/`l2`; average linkage is a good alternative ✅[^1] ✅[^4] |
| Connectivity constraint with single/average/complete | A few huge clusters and almost empty ones | Constraints can strengthen the rich-get-richer effect; single is the most brittle ✅[^1] |
| HDBSCAN labels `-2` and `-3` | Samples with infinite or missing values | Their own labels, besides `-1` for noise ✅[^3] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| DBSCAN | Any shape, outlier removal, very large n ✅[^1]; no k needed ✅[^2] | One `eps` for all clusters; must be tuned to the data and metric ✅[^1] |
| HDBSCAN | Variable densities, no `eps`, hierarchical ✅[^1] | Medium n_clusters; scales less far than DBSCAN in the method table ✅[^1] |
| OPTICS | A range of `eps` instead of one value; `O(n)` memory ✅[^1] | Still computes the full pairwise matrix, one row at a time ✅[^1] |
| Agglomerative, Ward | Most regular cluster sizes; good with noise ✅[^1] ✅[^6] | Euclidean only; expensive without a connectivity matrix, since every step considers all merges ✅[^1] |
| Agglomerative, single | Fast, follows non-globular chains ✅[^1] ✅[^6] | Not robust to noise ✅[^1] |

## Takeaways
- Pick `eps` from the data (a nearest-neighbour distance plot), never the default 0.5; sweep it and look at how many points become noise. [rule-candidate]
- When cluster densities differ, use HDBSCAN instead of tuning DBSCAN harder. [rule-candidate]
- Treat `-1` as "unassigned", not as a cluster, when you count or score clusters.
- Choose the linkage by the shape you expect: single for chains, Ward for compact groups with noise.

## Verification status
- Verified: 69 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- [Clustering (User Guide §2.3)](https://scikit-learn.org/stable/modules/clustering.html) — scikit-learn developers, living (1.9.1 docs). Backs: DBSCAN core samples, growth, noise, `eps` and `min_samples` effects, knee heuristic, order dependence, trees and memory; HDBSCAN core and mutual reachability distances, MST, DBSCAN* equivalence, the noise sentence; hierarchical clustering, linkages, rich-get-richer, Ward metric limit, connectivity; method table; transductive methods; silhouette drawback; adjusted Rand index. [^1]
- [sklearn.cluster.DBSCAN](https://scikit-learn.org/stable/modules/generated/sklearn.cluster.DBSCAN.html) — scikit-learn developers, living (1.9.1). Backs: `eps` and `min_samples` defaults and meaning, point itself counted, label `-1`, `O(n²)` worst-case memory. [^2]
- [sklearn.cluster.HDBSCAN](https://scikit-learn.org/stable/modules/generated/sklearn.cluster.HDBSCAN.html) — scikit-learn developers, living (1.9.1). Backs: `min_cluster_size`, `min_samples=None`, `eom`, labels `-1/-2/-3`, `probabilities_`. [^3]
- [sklearn.cluster.AgglomerativeClustering](https://scikit-learn.org/stable/modules/generated/sklearn.cluster.AgglomerativeClustering.html) — scikit-learn developers, living (1.9.1). Backs: linkage definitions, default `ward`, Ward's metric limit, `children_`, `distances_`, `distance_threshold`. [^4]
- [How HDBSCAN Works](https://hdbscan.readthedocs.io/en/latest/how_hdbscan_works.html) — McInnes, Healy, Astels (hdbscan docs), living. Backs: "lowering the sea level", condensing by minimum cluster size, selecting the most persistent clusters, noise outside selected clusters. [^5]
- [Comparing different hierarchical linkage methods on toy datasets](https://scikit-learn.org/stable/auto_examples/cluster/plot_linkage_comparison.html) — scikit-learn developers, living. Backs: single is fast and good on non-globular data but poor with noise; Ward most effective on noisy data. [^6]
- `machine-learning/lab-setup.md` — the lab where the k-means moons comparison (script in `k-means-clustering.md`), the core/border/noise example, the DBSCAN `eps` sweep, the varying-density comparison with HDBSCAN and the linkage runs ran on 2026-11-24. [^7]
- [Using UMAP for Clustering](https://umap-learn.readthedocs.io/en/latest/clustering.html) — umap-learn docs, living. Backs: HDBSCAN tends to suffer from the curse of dimensionality; under 18 % of the 50-dimensional digit images clustered. [^8]

## Related
- `machine-learning/unsupervised-learning/k-means-clustering.md` — the centroid method these improve on for odd shapes.
- `machine-learning/unsupervised-learning/t-sne-and-umap.md` — why clustering a t-SNE or UMAP plot needs care.
- `machine-learning/unsupervised-learning/principal-component-analysis.md` — reducing dimensions before density clustering.
- `machine-learning/evaluation/metrics-catalog.md` — adjusted Rand index, silhouette and other clustering scores.
- `machine-learning/supervised-learning/k-nearest-neighbors.md` — neighbourhoods, distances and the curse of dimensionality.
