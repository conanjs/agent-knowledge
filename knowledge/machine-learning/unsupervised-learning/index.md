---
schema: topic-index/v1
kind: subtopic
topic: machine-learning/unsupervised-learning
last-updated: 2026-11-25
---

# Unsupervised learning

Finding structure without labels: k-means, Gaussian mixtures and the EM algorithm, density-based and hierarchical clustering, principal component analysis, t-SNE/UMAP embeddings for visualization, anomaly detection, and semi-supervised learning from a few labels plus many unlabelled rows. Not covered: generative models that sample new data (see `machine-learning/generative-models/`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [k-means-clustering.md](k-means-clustering.md) | concept | Lloyd's assign/update loop, inertia, k-means++ seeding and restarts, choosing k with the elbow and silhouette, and the round-cluster assumptions | verified |
| [gaussian-mixtures-and-em.md](gaussian-mixtures-and-em.md) | concept | Gaussian mixtures as soft clustering: E-step responsibilities, M-step weighted refits, the ELBO view of EM, covariance types and BIC | verified |
| [density-and-hierarchical-clustering.md](density-and-hierarchical-clustering.md) | concept | DBSCAN core/border/noise and `eps`, HDBSCAN across all densities, agglomerative linkages and dendrograms | verified |
| [principal-component-analysis.md](principal-component-analysis.md) | concept | PCA as maximum-variance rotation and least-squares compression, computed by SVD; explained variance, scaling and whitening | verified |
| [t-sne-and-umap.md](t-sne-and-umap.md) | concept | Neighbour embeddings for plots: perplexity and `n_neighbors`, how t-SNE and UMAP optimize, and what their maps do not show | verified |
| [anomaly-detection.md](anomaly-detection.md) | concept | Outlier vs novelty detection; isolation-forest path lengths and LOF (local outlier factor) by hand, one-class SVM (support vector machine), elliptic envelope; `contamination` moves the threshold, not the ranking (ROC-AUC, area under the receiver operating characteristic curve, 0.9284 at four settings) | verified |
| [semi-supervised-learning.md](semi-supervised-learning.md) | concept | Cluster and manifold assumptions, self-training and its confirmation bias (digits 0.750 → 0.246), label propagation and spreading on a graph, FixMatch-style pseudo-labels, when unlabelled data hurts | verified |

## References
- [scikit-learn User Guide](https://scikit-learn.org/stable/user_guide.html) — scikit-learn developers, living. Backs: topic scope.
- [Clustering (User Guide §2.3)](https://scikit-learn.org/stable/modules/clustering.html) — scikit-learn developers, living. Backs: the clustering methods and their comparison table.
- [Decomposing signals in components (User Guide §2.5)](https://scikit-learn.org/stable/modules/decomposition.html) — scikit-learn developers, living. Backs: PCA and its variants.
- [Manifold learning (User Guide §2.2)](https://scikit-learn.org/stable/modules/manifold.html) — scikit-learn developers, living. Backs: t-SNE.
- [UMAP documentation](https://umap-learn.readthedocs.io/en/latest/) — umap-learn developers, living. Backs: UMAP.
- [Novelty and Outlier Detection (User Guide §2.7)](https://scikit-learn.org/stable/modules/outlier_detection.html) — scikit-learn developers, living. Backs: the anomaly detectors.
- [Semi-supervised learning (User Guide §1.14)](https://scikit-learn.org/stable/modules/semi_supervised.html) — scikit-learn developers, living. Backs: self-training, label propagation and label spreading.

## Related
- `machine-learning/learning-path.md` — where this subtopic sits in the reading order.
- `machine-learning/lab-setup.md` — the lab every experiment ran in.
- `machine-learning/evaluation/metrics-catalog.md` — clustering metrics (silhouette, adjusted Rand index) used in these docs.
- `machine-learning/data-and-features/preprocessing-and-pipelines.md` — scaling before distance-based methods and PCA.
- `machine-learning/evaluation/classification-metrics.md` — ROC-AUC, precision and recall for scoring anomaly detectors.
