---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/unsupervised-learning
status: verified
applies-to: ["scikit-learn 1.9.1", "umap-learn 0.6.0 docs"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [machine-learning, unsupervised-learning, dimensionality-reduction, visualization, t-sne, umap, perplexity, n-neighbors, min-dist, manifold-learning, scikit-learn]
---

# t-SNE and UMAP: neighbour embeddings for visualization

## Summary
**TL;DR:** t-SNE (t-distributed stochastic neighbor embedding) and UMAP (uniform manifold approximation and projection) draw high-dimensional data as a 2-D or 3-D map in which points that were near neighbours stay near. Both first measure, for every point, how strongly it is tied to its neighbours (t-SNE: a Gaussian whose width is set by `perplexity`; UMAP: a k-nearest-neighbour graph of size `n_neighbors`), then move points in the map until the map's ties match. What a map keeps is who sits next to whom. What it does not keep: cluster sizes, distances between clusters, density, or a unique layout; low settings can even draw clumps in pure noise.
**Use this when:** you make or read a t-SNE or UMAP plot, choose `perplexity`, `n_neighbors` or `min_dist`, or want to cluster or measure on an embedding.
**Not this doc:** linear reduction with meaningful axes → `machine-learning/unsupervised-learning/principal-component-analysis.md`; clustering in the original space → `machine-learning/unsupervised-learning/density-and-hierarchical-clustering.md`; gradient descent itself → `machine-learning/foundations/gradient-descent.md`.

## Problem
A t-SNE or UMAP plot looks like a scatter plot of real coordinates, so people read sizes, gaps and shapes off it as facts about the data. They are not. In the lab, two groups whose spreads differ by a factor of 10 came out the same size at perplexity 5, 30 and 100 (size ratio 1.00–1.03), and their gap, 71 times the small group's radius in the data, was drawn at 2.2 to 14 radii depending only on the perplexity ✅[^10]. Decisions built on such readings ("cluster A is more diverse", "B and C are close") can be artefacts of the method.

## Mental model
**Analogy:** a metro map. It keeps which stations are next to each other on a line, so it is excellent for "what is near what". It does not keep true distances, the true size of districts, or the space between far-apart lines; a dense downtown gets as much room as a sparse suburb. A t-SNE or UMAP map is drawn by the same rule: neighbourhoods are faithful, the rest is layout.

**Artifact:** perplexity, t-SNE's main knob, made concrete. For each point `i`, t-SNE picks a Gaussian width `σ_i` so that the perplexity `2^H` of the point's neighbour probabilities, where `H` is their Shannon entropy in bits, equals the value you set; the perplexity of a fair k-sided die is k, so perplexity acts as an effective number of neighbours ✅[^1]. Bisection on `σ_0` for one point of a 400-point set, lab run (`machine-learning/lab-setup.md`), 2026-11-24, numpy 2.5.5, two runs identical ✅[^10]:
```text
perplexity   5: sigma_0=0.095  2^H=5.00  neighbours holding 90% of p(.|0)=4
perplexity  30: sigma_0=0.251  2^H=30.00  neighbours holding 90% of p(.|0)=27
perplexity 100: sigma_0=0.550  2^H=100.00  neighbours holding 90% of p(.|0)=83
```
A larger perplexity widens the Gaussian, and the number of neighbours that carry 90 % of the probability grows with it: 4, 27, 83.

<details><summary>Full script (prints the output above)</summary>

```python
import numpy as np

rng = np.random.default_rng(0)
tight = rng.normal(0, 1, size=(200, 2))                    # spread (std) 1
wide = rng.normal(0, 10, size=(200, 2)) + [100, 0]         # spread 10, centre 100 away
X = np.vstack([tight, wide])

# Perplexity -> one Gaussian width sigma_i per point, found by bisection (point 0, tight group)
d2 = ((X[0] - X) ** 2).sum(axis=1)[1:]                      # squared distances to the 399 others
def p_given_0(sigma):
    v = np.exp(-(d2 - d2.min()) / (2 * sigma**2))           # shift by d2.min() only for numerical safety
    return v / v.sum()
for perp in (5, 30, 100):
    lo, hi = 1e-3, 1e3
    for _ in range(100):                                    # bisection on sigma until 2^H = perplexity
        sigma = (lo + hi) / 2
        p = p_given_0(sigma)
        H = -(p[p > 0] * np.log2(p[p > 0])).sum()           # Shannon entropy in bits
        lo, hi = (sigma, hi) if 2**H < perp else (lo, sigma)
    mass90 = np.searchsorted(np.cumsum(np.sort(p)[::-1]), 0.9) + 1
    print(f"perplexity {perp:3d}: sigma_0={sigma:.3f}  2^H={2**H:.2f}  neighbours holding 90% of p(.|0)={mass90}")
```
</details>

## How it works
### t-SNE
The equations below follow the UMAP paper's restatement of t-SNE (Appendix C) ✅[^4]; `x_i` is point `i` in the input space, `y_i` its position in the map, `N` the number of points.
1. **Input similarities.** `v_{j|i} = exp(−‖x_i − x_j‖² / 2σ_i²)`, normalized per point: `p_{j|i} = v_{j|i} / Σ_{k≠i} v_{k|i}` ✅[^4].
2. **Calibrate `σ_i`.** Search for the `σ_i` that makes the perplexity of `p_{·|i}` equal the user's value (the artifact above) ✅[^4] ✅[^1].
3. **Symmetrize.** `p_ij = (p_{j|i} + p_{i|j}) / 2N`, one joint distribution over all pairs ✅[^4].
4. **Map similarities.** `w_ij = (1 + ‖y_i − y_j‖²)⁻¹`, a Student t-distribution with one degree of freedom, normalized over all pairs: `q_ij = w_ij / Σ_{k≠l} w_kl` ✅[^4]. scikit-learn lists reducing the tendency to crowd points together in the centre among the advantages of using Student's t-distributions in the map ✅[^1]; the original paper's abstract credits t-SNE as a whole with it ✅[^9]. (scikit-learn uses `max(n_components − 1, 1)` degrees of freedom, so 1 for a 2-D map ✅[^3].)
5. **Minimize KL.** Move the `y_i` by gradient descent to minimize the Kullback–Leibler divergence `KL(P‖Q) = Σ_{i≠j} p_ij · log(p_ij / q_ij)` ✅[^4] ✅[^1]. It is not convex: different initializations reach different local minima, and keeping the run with the lowest KL is legitimate ✅[^1].
6. **Optimize in two phases.** In scikit-learn, the first 250 iterations multiply `P` by `early_exaggeration=12` (with momentum 0.5), which pulls natural clusters tight and widens the gaps between them; then exaggeration is removed and optimization continues up to `max_iter=1000` ✅[^3] ✅[^2] ✅[^1]. `learning_rate='auto'` sets `max(N / early_exaggeration / 4, 50)` ✅[^2]. `init='pca'` (start the map from PCA, principal component analysis) is the default and is usually more globally stable than random ✅[^2].
7. **Approximate for speed.** The default Barnes-Hut method costs `O(d·N·log N)` per gradient instead of `O(d·N²)`, for map dimension `d ≤ 3` only ✅[^1]; it computes input similarities only for the `min(N − 1, 3·perplexity + 1)` nearest neighbours ✅[^3].

### UMAP
UMAP is not installed in this lab; this section follows the paper and the umap-learn docs.
1. **Neighbour graph.** Find each point's `n_neighbors` (k) nearest neighbours, approximately, with nearest-neighbour descent ✅[^4] ✅[^7].
2. **Local distance scale.** `ρ_i` is the distance to the nearest neighbour; `σ_i` is set so that `Σ_j exp(−max(0, d(x_i, x_ij) − ρ_i) / σ_i) = log₂(k)`, where `x_ij` is the j-th neighbour ✅[^4]. Subtracting `ρ_i` guarantees every point at least one edge of weight 1 (local connectivity), which the paper says helps on very high-dimensional data ✅[^4].
3. **Edge weights.** `w(x_i, x_ij) = exp(−max(0, d(x_i, x_ij) − ρ_i) / σ_i)`, read as the probability that the edge exists ✅[^4].
4. **Symmetrize by fuzzy union.** Two directed weights `a` and `b` become `a + b − a·b`, the probability that at least one of the two edges exists; there is no normalization over all pairs ✅[^4] ✅[^7].
5. **Map similarities.** `1 / (1 + a·‖y_i − y_j‖^(2b))`, where `a` and `b` are positive shape constants fitted by non-linear least squares to a curve that is 1 up to distance `min_dist` and decays exponentially beyond it ✅[^4]; with the default settings `a ≈ 1.929` and `b ≈ 0.7915`, and `a = b = 1` gives t-SNE's Student t ✅[^4]. `min_dist` (default 0.1) is literally the minimum distance points may have in the map: low values give clumpier maps, high values a broader view ✅[^6].
6. **Minimize cross-entropy.** The objective, summed over edges, has an attractive term that pulls together points with strong input edges and a repulsive term that pushes apart points with weak ones ✅[^7]. It is optimized by stochastic gradient descent with negative sampling (repulsion from a few sampled points), starting from a spectral layout of the graph ✅[^7] ✅[^4]. In current umap-learn the default `init='auto'` still selects the spectral layout while the default compatibility layout is in use; `init='recursive'` and Adam or momentum optimizers are newer options ✅[^6].

Because UMAP needs no normalization over all pairs, it avoids the space-partitioning trees t-SNE uses, and its run time scales well with the map dimension, so a 10-dimensional embedding for clustering costs little ✅[^4] ✅[^8].

### `perplexity` and `n_neighbors`
Both set how many neighbours count as "local". In scikit-learn, `perplexity` defaults to 30, values between 5 and 50 are suggested, larger datasets usually need larger values, and it must be less than the number of samples ✅[^2]. A larger perplexity is less sensitive to small structure, a smaller one ignores more global information ✅[^1]. For UMAP, a low `n_neighbors` (default 15) concentrates on very local structure, possibly losing the big picture, and a high one looks at larger neighbourhoods ✅[^6].

## Worked example
The 400 points of the artifact: a tight group (spread 1) and a wide group (spread 10) whose centres are 100 apart, embedded by scikit-learn's `TSNE` at three perplexities. Measured: the ratio of the two groups' sizes (root-mean-square radius) in the map, their centre gap in units of the tight group's radius, the final KL, and trustworthiness, a 0–1 score that penalizes map neighbours that were not input neighbours, by their input rank ✅[^11]. Lab run (`machine-learning/lab-setup.md`), 2026-11-24, scikit-learn 1.9.1, two runs identical ✅[^10]:
```text
input: wide/tight radius ratio=10.12
perplexity   5: wide/tight radius ratio=1.01  centre gap / tight radius=  2.2  KL=0.374  trustworthiness(k=10)=0.991
perplexity  30: wide/tight radius ratio=1.03  centre gap / tight radius=  6.7  KL=0.267  trustworthiness(k=10)=0.997
perplexity 100: wide/tight radius ratio=1.00  centre gap / tight radius= 14.0  KL=0.065  trustworthiness(k=10)=0.998
input: centre gap / tight radius=71.2
```
Reading it:
- **Size:** the wide group is 10.12 times the tight one in the data and about 1.0 times in every map. t-SNE calibrates a separate `σ_i` per point, so a sparse group gets wide Gaussians and a dense group narrow ones: it expands dense clusters and contracts sparse ones ✅[^5]. Distill's authors found the same with a 10-times-more-dispersed Gaussian and concluded that relative cluster sizes cannot be seen in a t-SNE plot ✅[^5].
- **Gap:** 71.2 radii in the data, drawn as 2.2, 6.7 or 14.0 radii: in this run the gap follows the perplexity, not the data. Distill's authors likewise saw the global geometry at some perplexities and equidistant-looking clusters at others ✅[^5].
- **Neighbours:** trustworthiness is 0.991–0.998 in all three: the local neighbourhoods, the thing t-SNE optimizes, are kept every time.
- **KL:** it falls from 0.374 to 0.065, but each run measures KL against a different `P` (step 1 depends on the perplexity), so the three numbers do not rank the maps; compare KL only between runs with the same settings.

<details><summary>Full script (prints the output above)</summary>

```python
import numpy as np
from sklearn.manifold import TSNE, trustworthiness

rng = np.random.default_rng(0)
tight = rng.normal(0, 1, size=(200, 2))                    # spread (std) 1
wide = rng.normal(0, 10, size=(200, 2)) + [100, 0]         # spread 10, centre 100 away
X = np.vstack([tight, wide])

# Same data, three perplexities: the 10x difference in spread is not kept
def rms_radius(Z):
    return np.sqrt(((Z - Z.mean(axis=0)) ** 2).sum(axis=1).mean())
print(f"input: wide/tight radius ratio={rms_radius(wide) / rms_radius(tight):.2f}")
for perp in (5, 30, 100):
    ts = TSNE(perplexity=perp, random_state=0).fit(X)
    Y = ts.embedding_
    ratio = rms_radius(Y[200:]) / rms_radius(Y[:200])
    gap = np.linalg.norm(Y[200:].mean(axis=0) - Y[:200].mean(axis=0)) / rms_radius(Y[:200])
    print(f"perplexity {perp:3d}: wide/tight radius ratio={ratio:.2f}  centre gap / tight radius={gap:5.1f}"
          f"  KL={ts.kl_divergence_:.3f}  trustworthiness(k=10)={trustworthiness(X, Y, n_neighbors=10):.3f}")
print(f"input: centre gap / tight radius={100 / rms_radius(tight):.1f}")
```
</details>

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Comparing cluster sizes in the map | Meaningless: dense clusters are expanded, sparse ones contracted (lab: 10× spread drawn as 1×) ✅[^5] ✅[^10] | Per-point `σ_i` adapts the notion of distance to local density ✅[^5] |
| Reading distances between clusters | May mean nothing; depends on the perplexity and on how many points each cluster has ✅[^5] (lab: gap 2.2–14 radii for 71) ✅[^10] | No single perplexity may capture distances across all clusters ✅[^5] |
| Pure noise at low perplexity | Dramatic-looking clumps ✅[^5] | Distill's 100-dimensional Gaussian noise at perplexity 2 ✅[^5] |
| "Pinched" or one-dimensional-looking clusters | The optimization was stopped too early ✅[^5] | No fixed number of steps guarantees stability ✅[^5] |
| Perplexity close to or above the number of points | Merged clusters, unexpected behaviour ✅[^5] | scikit-learn requires perplexity below the number of samples ✅[^2] |
| Another seed or init | A different map ✅[^1] | Non-convex objective ✅[^1]; UMAP is also stochastic: approximate neighbours and negative sampling ✅[^4] |
| Learning rate copied from another implementation | Off by a factor of 4 | scikit-learn's `learning_rate=200` equals 800 in bhtsne, FIt-SNE or openTSNE ✅[^2] |
| New points after fitting | scikit-learn's `TSNE` has `fit` and `fit_transform` only, no `transform` ✅[^2] | It embeds the given set; umap-learn's docs list transforming new data ✅[^6] |
| Clustering the map's coordinates | Possible with care: UMAP, like t-SNE, does not fully preserve density and can create false tears ✅[^8] | For clustering, the umap-learn docs use larger `n_neighbors` (30) and `min_dist=0` ✅[^8] |
| Features on different scales | Poor neighbourhoods | Manifold methods rely on nearest-neighbour search: use the same scale for all features ✅[^1] |
| Many input features | Slow, noisy distances | Reduce to about 50 dimensions with PCA first ✅[^2] |
| Classes not separated in a 2-D t-SNE map | Does not prove a classifier would fail | Two dimensions may be too few for the structure ✅[^1] |
| Global layout wanted | t-SNE does not explicitly preserve it; `init='pca'` mitigates ✅[^1] | The UMAP paper names its spectral initialization as a significant contributor to its global structure (the cross-entropy objective is another) and cites work where t-SNE with a similar init matched UMAP on one global measure ✅[^4] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| t-SNE (scikit-learn) | Strong local structure; reveals structure at many scales ✅[^1] | Hours on a million samples; Barnes-Hut limited to 2–3 dimensions ✅[^1] |
| UMAP (umap-learn) | Competitive visual quality, arguably more global structure, faster; any embedding dimension ✅[^4] | Map dimensions have no meaning and no loadings ✅[^4]; mainly local, so it may not be the best choice when global structure is the main interest ✅[^4] |
| PCA | Axes are directions of greatest variance, with loadings ✅[^4] | Linear; label regions overlapped in the digits example where t-SNE separated them ✅[^1] |

## Takeaways
- Read a t-SNE or UMAP map for neighbourhoods only: never for cluster sizes, gaps or densities. [rule-candidate]
- Before trusting a structure, re-run with several perplexities (or `n_neighbors`) and seeds; keep what survives. [rule-candidate]
- Scale features and reduce to about 50 PCA dimensions before t-SNE on wide data.
- Cluster in the original or a PCA space when you can; cluster on a UMAP embedding only with tuned parameters and a check of the result.

## Verification status
- Verified: 78 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- [Manifold learning (User Guide §2.2)](https://scikit-learn.org/stable/modules/manifold.html) — scikit-learn developers, living (1.9.1 docs). Backs: t-SNE overview, crowding, KL by gradient descent, non-convexity and restarts, perplexity definition and effect, early exaggeration, learning rate, Barnes-Hut costs and limits, PCA init, digits comparison, scaling tip. [^1]
- [sklearn.manifold.TSNE](https://scikit-learn.org/stable/modules/generated/sklearn.manifold.TSNE.html) — scikit-learn developers, living (1.9.1). Backs: defaults (`perplexity`, `early_exaggeration`, `learning_rate='auto'` formula, `max_iter`, `init='pca'`), perplexity range and limit, 4× learning-rate convention, PCA to about 50 dimensions, methods. [^2]
- [sklearn/manifold/_t_sne.py at 1.9.1](https://raw.githubusercontent.com/scikit-learn/scikit-learn/1.9.1/sklearn/manifold/_t_sne.py) — scikit-learn source code, 2026. Backs: 250 exaggerated iterations with momentum 0.5, degrees of freedom `max(n_components − 1, 1)`, `3·perplexity + 1` neighbours. [^3]
- [UMAP: Uniform Manifold Approximation and Projection for Dimension Reduction](https://arxiv.org/html/1802.03426v3) — McInnes, Healy, Melville, 2018 (v3 2020). Backs: t-SNE equations (Appendix C), UMAP graph construction, `ρ_i`, `σ_i` and `log₂(k)`, fuzzy union, `a` and `b` and how they are fitted, spectral init, scaling with dimension, stochasticity, interpretability and global-structure limits. [^4]
- [How to Use t-SNE Effectively](https://distill.pub/2016/misread-tsne/) — Wattenberg, Viégas, Johnson (Distill), 2016. Backs: cluster sizes and distances between clusters may mean nothing, clumps in noise, pinched shapes, perplexity vs number of points. [^5]
- [Basic UMAP Parameters](https://umap-learn.readthedocs.io/en/latest/parameters.html) — umap-learn docs, living. Backs: `n_neighbors` (default 15) and `min_dist` (default 0.1) effects; transforming new data is documented; `init='auto'` selecting the spectral layout under the compatibility layout, `init='recursive'`, Adam and momentum optimizers. [^6]
- [How UMAP Works](https://umap-learn.readthedocs.io/en/latest/how_umap_works.html) — umap-learn docs, living. Backs: fuzzy union `a + b − a·b`, cross-entropy with attraction and repulsion, nearest-neighbour descent, negative sampling, spectral initialization. [^7]
- [Using UMAP for Clustering](https://umap-learn.readthedocs.io/en/latest/clustering.html) — umap-learn docs, living. Backs: clustering on UMAP output is controversial, density not fully preserved, false tears, `n_neighbors=30` and `min_dist=0` for clustering, embedding to 10 dimensions. [^8]
- [Visualizing Data using t-SNE](https://jmlr.org/papers/v9/vandermaaten08a.html) — van der Maaten, Hinton, JMLR 2008 (abstract page). Backs: t-SNE reduces the tendency to crowd points in the centre of the map. [^9]
- `machine-learning/lab-setup.md` — the lab where the perplexity calibration and the three-perplexity t-SNE of two groups with 10× different spread ran on 2026-11-24. [^10]
- [sklearn.manifold.trustworthiness](https://scikit-learn.org/stable/modules/generated/sklearn.manifold.trustworthiness.html) — scikit-learn developers, living (1.9.1). Backs: trustworthiness definition and range. [^11]

## Related
- `machine-learning/unsupervised-learning/principal-component-analysis.md` — the linear method to run first and to compare with.
- `machine-learning/unsupervised-learning/density-and-hierarchical-clustering.md` — HDBSCAN, often paired with UMAP for clustering.
- `machine-learning/foundations/gradient-descent.md` — the optimizer behind both maps; learning rate and divergence.
- `machine-learning/supervised-learning/k-nearest-neighbors.md` — neighbourhoods and the curse of dimensionality.
- `algorithms/vector-search-evaluation.md` — evaluating nearest-neighbour results, the input both methods depend on.
- `machine-learning/foundations/information-theory.md` — the KL divergence t-SNE minimizes.
