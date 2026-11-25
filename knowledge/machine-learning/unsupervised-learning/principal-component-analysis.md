---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/unsupervised-learning
status: verified
applies-to: ["scikit-learn 1.9.1"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [machine-learning, unsupervised-learning, dimensionality-reduction, pca, svd, eigenvectors, explained-variance, standardization, whitening, scikit-learn]
---

# Principal component analysis (PCA): variance, SVD, scaling and whitening

## Summary
**TL;DR:** PCA (principal component analysis) rotates centred data onto new axes, the principal components, ordered so that the first carries the most variance, the second the most of what is left, and so on, all at right angles. Keeping the first few gives the best linear compression in the least-squares sense. In practice the components are the right singular vectors of the centred data matrix (its SVD, singular value decomposition), and each component's variance is its squared singular value divided by `n − 1`. PCA centres but does not scale, so a feature measured in large units takes over the first component unless you standardize first.
**Use this when:** you reduce many correlated features before a model, a clustering or a t-SNE (t-distributed stochastic neighbor embedding) plot, choose `n_components` from explained variance, decide whether to standardize or whiten, or read `components_` and `explained_variance_ratio_` in scikit-learn.
**Not this doc:** non-linear embeddings for plots → `machine-learning/unsupervised-learning/t-sne-and-umap.md`; vectors, matrices, norms and Σ → `machine-learning/foundations/math-notation-reference.md`; scaling inside a pipeline → `machine-learning/data-and-features/preprocessing-and-pipelines.md`.

## Problem
Data often has many features that move together: the 64 pixel intensities of a small digit image, or dozens of sensor readings. Models train slower, distances inflate, and nothing can be plotted. PCA promises "the same data in fewer numbers", but used blindly it misleads: on the raw wine dataset the first component explains 99.8 % of the variance and is almost exactly one feature, `proline`, only because `proline` has a variance of 98,609.6 against 0.052 for a feature like `hue`; after standardizing, the first component explains 36.2 % and mixes many features ✅[^6].

## Mental model
**Analogy:** photographing a long loaf of bread so the photo shows as much of it as possible. You turn the camera until the loaf's long side runs across the picture: that direction is the first principal component. The second component is the loaf's width, at right angles to the length. Its height, seen end-on, adds little; dropping it loses little. If one dimension were measured in millimetres and the others in metres, the "longest" side would be the millimetre one, whatever the loaf looks like: that is the scaling trap.

**Artifact:** five 2-D points that lie almost on a diagonal line. Lab run (`machine-learning/lab-setup.md`), 2026-11-24, scikit-learn 1.9.1 ✅[^6]:
```python
import numpy as np
from sklearn.decomposition import PCA

X = np.array([[3.0, 2.8], [2.0, 2.2], [1.0, 0.9], [0.0, 0.3], [-1.0, -1.2]])  # 5 points, 2 features
pca = PCA().fit(X)
print("mean:", pca.mean_, " components (rows):", pca.components_.round(3).tolist())
print("explained variance:", pca.explained_variance_.round(3), " ratio:", pca.explained_variance_ratio_.round(4))
print("1-D codes z = (x - mean) . PC1:", (PCA(1).fit_transform(X).ravel()).round(3))
print("feature variances:", X.var(axis=0, ddof=1), " total:", X.var(axis=0, ddof=1).sum().round(3))
```
```text
mean: [1. 1.]  components (rows): [[0.707, 0.707], [0.707, -0.707]]
explained variance: [4.978 0.027]  ratio: [0.9945 0.0055]
1-D codes z = (x - mean) . PC1: [ 2.687  1.556 -0.071 -1.202 -2.97 ]
feature variances: [2.5   2.505]  total: 5.005
```
The first component is the diagonal `(0.707, 0.707)` and keeps 99.45 % of the variance; the second, at right angles, keeps 0.55 %. Each point becomes one number: `(3, 2.8)` minus the mean `(1, 1)` is `(2, 1.8)`, and `2 × 0.707 + 1.8 × 0.707 = 2.687`. The rotation keeps the total: the features' own variances, 2.5 and 2.505, sum to 5.005 = 4.978 + 0.027 ✅[^6]. The block above is the full script.

## How it works
### What PCA optimizes
- **Least-squares compression.** Encode each point `x` (with `n` features) as a shorter code `c` (with `l < n` numbers) and decode it back as `D·c`, where `D` is an `n × l` matrix with orthonormal columns (unit length, mutually at right angles). Asking for the smallest total squared reconstruction error leads, for one component, to "the eigenvector of `XᵀX` with the largest eigenvalue", and for `l` components to the `l` eigenvectors with the largest eigenvalues ✅[^3]. `X` is the data matrix with one row per point, assumed centred.
- **Maximum variance.** The same derivation ends with maximizing `dᵀXᵀXd` under `‖d‖ = 1`: the direction `d` along which the projected data spreads most ✅[^3]. scikit-learn describes PCA the same way: successive orthogonal components that explain a maximum amount of the variance ✅[^1].
- **Decorrelation.** The new coordinates `z = Wᵀx` have a diagonal covariance matrix: the principal components are uncorrelated with each other ✅[^4].

### The computation in scikit-learn's `PCA`
1. **Centre:** subtract each feature's mean (`mean_`); no scaling is applied ✅[^1] ✅[^2].
2. **Decompose:** compute the SVD of the centred matrix, `X_c = U·Σ·Wᵀ`, where `U` has one orthonormal column per component (the samples' coordinates, up to scale), `Σ` is the diagonal matrix of singular values `σ_1 ≥ σ_2 ≥ … ≥ 0`, and `W` has one orthonormal column per component in feature space. The columns of `W` (the right singular vectors) are the principal directions, because `X_cᵀX_c = W·Σ²·Wᵀ` ✅[^4]. scikit-learn stores them as the rows of `components_`, sorted by decreasing variance ✅[^2].
3. **Variance per component:** `explained_variance_ = σ_j² / (n − 1)`, with `σ_j` the j-th singular value and `n` the number of samples, which equals the eigenvalues of the covariance matrix ✅[^2] ✅[^4]; `explained_variance_ratio_` divides by the total and sums to 1 when all components are kept ✅[^2].
4. **Project and reconstruct:** `transform` projects data onto the components fitted on the training set; `inverse_transform` maps codes back to the original space ✅[^2].
5. **Choose the solver:** `svd_solver='auto'` picks `covariance_eigh` (eigendecomposition of the covariance) when there are fewer than 1000 features and more than 10 times as many samples, `randomized` (the Halko et al. method) when the data is larger than 500 × 500 and fewer components are kept than 80 % of its smaller dimension, and the exact `full` SVD otherwise ✅[^2].

`n_components` can be an integer, a fraction (with `svd_solver='full'`, keep enough components to explain more than that share of variance) or `'mle'` (Minka's estimate) ✅[^2].

### Whitening
`whiten=True` divides each component by its spread so that every output column has unit variance and they stay uncorrelated ✅[^2]. It throws away the relative scale of the components, but can help downstream models that assume an isotropic signal (the same spread in every direction), such as an SVM (support vector machine) with an RBF (radial basis function) kernel or k-means ✅[^1] ✅[^2].

## Worked example
The 1,797 handwritten-digit images bundled with scikit-learn (64 pixel features each), then the wine data (13 features on very different scales). The script checks that PCA equals the SVD of the centred data, reads explained variance, compares raw and standardized wine, and whitens. Lab run (`machine-learning/lab-setup.md`), 2026-11-24, scikit-learn 1.9.1, numpy 2.5.5, two runs identical ✅[^6]:
```text
max |components_ - V^T| over the 61 non-zero singular values: 8.24137806609837e-12
max |explained_variance_ - S^2/(n-1)|: 4.547473508864641e-13
max |explained_variance_ - eigenvalues of covariance|: 2.5579538487363607e-13
first 5 ratios: [0.149 0.136 0.118 0.084 0.058]  cumulative: [0.149 0.285 0.403 0.487 0.545]
  components for 50% of variance: 5 of 64
  components for 80% of variance: 13 of 64
  components for 90% of variance: 21 of 64
  components for 95% of variance: 29 of 64
  components for 99% of variance: 41 of 64
feature variances: proline 98609.6  hue 0.052
raw         : PC1 explains 0.998;  top weights proline=+1.000, magnesium=+0.018, alcalinity_of_ash=-0.005
standardized: PC1 explains 0.362;  top weights flavanoids=+0.423, total_phenols=+0.395, od280/od315_of_diluted_wines=+0.376
std of whitened components: [1. 1. 1. 1. 1.]  unwhitened: [13.38 12.8  11.91 10.05  8.34]
```
Reading it:
- **Lines 1–3:** `PCA().fit` and a plain `numpy.linalg.svd` of the centred data agree to about 1e-11: the components are the right singular vectors, and the variances are `S²/(n−1)` and the covariance eigenvalues. Only 61 of 64 singular values are non-zero because 3 pixels are 0 in every image; their directions are arbitrary, so the check skips them. A singular vector and its negative are equally valid (flipping both `u_j` and `w_j` leaves `UΣWᵀ` unchanged), so the script aligns signs before comparing.
- **Ratios:** no single direction dominates the digits (the first carries 14.9 %); 21 of 64 components keep 90 % of the variance and 41 keep 99 %.
- **Wine, raw:** `proline` has variance 98,609.6 against 0.052 for `hue`. The first component (PC1 in the output) is `proline` with weight +1.000 and explains 99.8 %: PCA has found the units, not the structure. scikit-learn's own scaling example reports the same dominance, about two orders of magnitude above the other features ✅[^5].
- **Wine, standardized:** the first component explains 36.2 % and spreads its weight over flavanoids, total phenols and the OD280/OD315 ratio (an absorbance measurement): a chemical pattern, not a unit.
- **Whitening:** the first five unwhitened components have spreads 13.38 … 8.34 (square roots of their variances); after `whiten=True` every one is 1.

<details><summary>Full script (prints the output above)</summary>

```python
import numpy as np
from sklearn.datasets import load_digits, load_wine
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler

# 1. PCA is the SVD of the centred data matrix
X = load_digits().data                                   # 1797 images x 64 pixels
pca = PCA().fit(X)
Xc = X - X.mean(axis=0)
U, S, Vt = np.linalg.svd(Xc, full_matrices=False)
k = (S > 1e-8).sum()                                     # 3 pixels are always 0: their directions are arbitrary
signs = np.sign((pca.components_[:k] * Vt[:k]).sum(axis=1))  # singular vectors are defined up to sign
print(f"max |components_ - V^T| over the {k} non-zero singular values:",
      np.abs(pca.components_[:k] - signs[:, None] * Vt[:k]).max())
print("max |explained_variance_ - S^2/(n-1)|:", np.abs(pca.explained_variance_ - S**2 / (len(X) - 1)).max())
print("max |explained_variance_ - eigenvalues of covariance|:",
      np.abs(pca.explained_variance_ - np.sort(np.linalg.eigvalsh(np.cov(X, rowvar=False)))[::-1]).max())

# 2. How much variance the first components keep (digits)
r = pca.explained_variance_ratio_
print("first 5 ratios:", r[:5].round(3), " cumulative:", np.cumsum(r)[:5].round(3))
for target in (0.5, 0.8, 0.9, 0.95, 0.99):
    print(f"  components for {target:.0%} of variance: {np.searchsorted(np.cumsum(r), target) + 1} of 64")

# 3. Scaling changes the first component (wine: 13 features on very different scales)
wine = load_wine()
Xw, names = wine.data, np.array(wine.feature_names)
print("feature variances: proline", round(Xw[:, 12].var(), 1), " hue", round(Xw[:, 10].var(), 3))
for label, data in (("raw", Xw), ("standardized", StandardScaler().fit_transform(Xw))):
    p = PCA(2).fit(data)
    top = np.argsort(-np.abs(p.components_[0]))[:3]
    print(f"{label:12s}: PC1 explains {p.explained_variance_ratio_[0]:.3f};  top weights "
          + ", ".join(f"{names[i]}={p.components_[0][i]:+.3f}" for i in top))

# 4. Whitening rescales every kept component to unit variance
Z = PCA(5, whiten=True).fit_transform(X)
print("std of whitened components:", Z.std(axis=0, ddof=1).round(3),
      " unwhitened:", PCA(5).fit_transform(X).std(axis=0, ddof=1).round(2))
```
</details>

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Features in different units | The largest-unit feature becomes PC1 (wine: `proline`, 99.8 %) ✅[^6] | PCA centres but does not scale ✅[^1]; standardize first when units are arbitrary |
| Constant features | Zero singular values; those directions are arbitrary (digits: 61 of 64 non-zero) ✅[^6] | Lab: 3 pixels are 0 in every image ✅[^6] |
| Non-linear structure (a curved manifold) | PCA cannot unroll it; dropping components destroys it | PCA is linear ✅[^10]; KernelPCA extends PCA with kernels ✅[^1], t-SNE and UMAP (uniform manifold approximation and projection) for plots |
| PCA fitted on all data before a train/test split | Optimistic scores | Any transform must be learnt from the training data only ✅[^8]; see `machine-learning/evaluation/data-leakage.md` |
| Sparse input | Accepted only by some solvers, such as `arpack` and `covariance_eigh` ✅[^2] | `TruncatedSVD` is the documented alternative: it does not centre the data ✅[^2] |
| Data larger than memory | `IncrementalPCA` with `partial_fit` on chunks | It processes mini-batches and almost exactly matches `PCA` ✅[^1] |
| `svd_solver='randomized'` | `inverse_transform` is not the exact inverse of `transform` | Documented approximation ✅[^1] |
| `svd_solver='arpack'` and `n_components=None` | Keeps `min(n_samples, n_features) − 1` components | The `arpack` solver needs strictly fewer than the smaller dimension ✅[^2] |
| `explained_variance_` vs `np.var` | Values differ by a factor `n/(n−1)` | scikit-learn uses `n_samples − 1` degrees of freedom ✅[^2] |
| Reading components as "features that matter" | Dense loadings are hard to interpret | Every component has non-zero weights on all features; SparsePCA gives sparser, more interpretable components ✅[^1] |
| Before t-SNE on many features | Recommended: reduce to about 50 dimensions with PCA first | Suppresses some noise and speeds up distance computations ✅[^9] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `PCA`, exact SVD | Exact components | Time `O(n_max²·n_min)` ✅[^1] |
| `PCA(svd_solver='randomized')` | Time `O(n_max²·n_components)`, memory `2·n_max·n_components` ✅[^1] | Approximate; inexact `inverse_transform` ✅[^1] |
| `whiten=True` | Unit-variance, uncorrelated outputs for isotropy-assuming models ✅[^1] | Loses the relative variance of components ✅[^2] |
| Standardize first | Every feature counts equally, whatever its unit ✅[^5] | The fitted means and scales become part of the model and must be reused on new data ✅[^8] |
| PCA vs UMAP/t-SNE | Axes mean something: directions of greatest variance, with loadings ✅[^7] | Linear only ✅[^10] |

## Takeaways
- Standardize before PCA unless every feature shares one meaningful unit. [rule-candidate]
- Fit PCA inside a pipeline on the training split, never on all the data. [rule-candidate]
- Pick `n_components` from the cumulative explained-variance curve (or a fraction such as 0.95), then check the downstream score.
- Components are defined up to sign; compare them by absolute value or after aligning signs.

## Verification status
- Verified: 46 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- [Decomposing signals in components (User Guide §2.5)](https://scikit-learn.org/stable/modules/decomposition.html) — scikit-learn developers, living (1.9.1 docs). Backs: maximum-variance orthogonal components, centring without scaling, whitening for isotropy-assuming models, IncrementalPCA, randomized SVD costs and inexact inverse, SparsePCA, KernelPCA. [^1]
- [sklearn.decomposition.PCA](https://scikit-learn.org/stable/modules/generated/sklearn.decomposition.PCA.html) — scikit-learn developers, living (1.9.1). Backs: `components_` as right singular vectors, `explained_variance_` with `n − 1` and as covariance eigenvalues, ratio summing to 1, `n_components` options, solver policy, whitening, sparse support, `transform`/`inverse_transform`. [^2]
- [Linear Algebra, §2.12 Example: PCA (Deep Learning)](https://www.deeplearningbook.org/contents/linear_algebra.html) — Goodfellow, Bengio, Courville, 2016. Backs: PCA as least-squares reconstruction with an orthonormal decoder; the top eigenvectors of `XᵀX`. [^3]
- [Machine Learning Basics, §5.8.1 (Deep Learning)](https://www.deeplearningbook.org/contents/ml.html) — Goodfellow, Bengio, Courville, 2016. Backs: principal components as right singular vectors, `XᵀX = WΣ²Wᵀ`, diagonal covariance of the codes. [^4]
- [Importance of Feature Scaling](https://scikit-learn.org/stable/auto_examples/preprocessing/plot_scaling_importance.html) — scikit-learn developers, living. Backs: `proline` dominates the first component of unscaled wine by about two orders of magnitude. [^5]
- `machine-learning/lab-setup.md` — the lab where the five-point PCA, the PCA-equals-SVD check, the digits explained-variance curve, raw vs standardized wine and whitening ran on 2026-11-24. [^6]
- [UMAP: Uniform Manifold Approximation and Projection for Dimension Reduction](https://arxiv.org/html/1802.03426v3) — McInnes, Healy, Melville, 2018 (v3 2020). Backs: PCA dimensions are directions of greatest variance with factor loadings, unlike UMAP's. [^7]
- [Common pitfalls and recommended practices](https://scikit-learn.org/stable/common_pitfalls.html) — scikit-learn developers, living. Backs: transformations learnt from training data only; never fit on test data. [^8]
- [sklearn.manifold.TSNE](https://scikit-learn.org/stable/modules/generated/sklearn.manifold.TSNE.html) — scikit-learn developers, living (1.9.1). Backs: reduce to about 50 dimensions with PCA before t-SNE. [^9]
- [Using UMAP for Clustering](https://umap-learn.readthedocs.io/en/latest/clustering.html) — umap-learn docs, living. Backs: PCA's linear nature limits how far it can reduce manifold data. [^10]

## Related
- `machine-learning/unsupervised-learning/t-sne-and-umap.md` — non-linear embeddings, usually run after PCA.
- `machine-learning/unsupervised-learning/k-means-clustering.md` — clustering after PCA; k-means and whitening.
- `machine-learning/data-and-features/preprocessing-and-pipelines.md` — `StandardScaler` and `Pipeline` so PCA is fitted on the training split.
- `machine-learning/evaluation/data-leakage.md` — why preprocessing must not see the test data.
- `machine-learning/foundations/math-notation-reference.md` — vectors, matrices, dot products and norms used above.
- `machine-learning/supervised-learning/linear-regression.md` — the other least-squares method in this knowledge base.
- `machine-learning/supervised-learning/discriminant-analysis.md` — LDA, the supervised projection.
