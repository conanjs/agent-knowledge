---
schema: knowledge-doc/v1
type: reference
topic: machine-learning/evaluation
status: verified
applies-to: ["scikit-learn 1.9.1"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [machine-learning, evaluation, metrics, scoring, classification-metrics, regression-metrics, ranking-metrics, clustering-metrics, scikit-learn]
---

# Metrics catalog: classification, regression, ranking and clustering

## Summary
**TL;DR:** One table per task listing each common metric with its scikit-learn function, its `scoring=` string, its range and best value, and when it fits. Every `scoring=` string follows "higher is better", so error metrics appear negated (`neg_mean_squared_error`). Pick the score that matches what you predict: squared error, Brier score or log loss for a mean or a probability, absolute error for a median, pinball loss for a quantile.
**Use this when:** you need the exact function or scorer name, a metric's range or best value, or a quick choice between similar metrics.
**Not this doc:** how precision, recall, ROC and PR curves work → `machine-learning/evaluation/classification-metrics.md`; reliability curves and calibration → `machine-learning/evaluation/probability-calibration.md`; recall@k and latency for vector search → `algorithms/vector-search-evaluation.md`.

## Scope
The metrics in `sklearn.metrics` for classification, regression, multilabel ranking and clustering, as documented for scikit-learn 1.9.1 and checked in the lab with that version. Notation: `TP, FP, FN, TN` are the confusion-matrix counts, `y` the true value, `ŷ` the prediction, `p̂` a predicted probability, "intercept-only model" a model that ignores the features. Pairwise distances, biclustering and survival metrics are out of scope.

## Catalog

### Choosing by what you predict (strictly consistent scores)
| You predict | Score that rewards predicting it truthfully | Function | Target |
|---|---|---|---|
| Class probabilities (mean of a one-hot target) | Brier score ✅[^1] | `brier_score_loss` | multiclass, `predict_proba` ✅[^1] |
| Class probabilities | Log loss ✅[^1] | `log_loss` | multiclass, `predict_proba` ✅[^1] |
| Most likely class (mode) | Zero-one loss; consistent but not strictly ✅[^1] | `zero_one_loss` | `predict` ✅[^1] |
| Mean | Squared error; R² gives the same ranking ✅[^1] | `mean_squared_error` | all reals ✅[^1] |
| Mean of counts / positive amounts | Poisson, Gamma, Tweedie deviance ✅[^1] | `mean_poisson_deviance`, `mean_gamma_deviance`, `mean_tweedie_deviance` | non-negative / strictly positive ✅[^1] |
| Median | Absolute error ✅[^1] | `mean_absolute_error` | all reals ✅[^1] |
| Quantile α | Pinball loss ✅[^1] | `mean_pinball_loss` | all reals ✅[^1] |

### Classification from labels (`predict`)
| Metric | Function | `scoring=` | Range · best | Use when / note |
|---|---|---|---|---|
| Accuracy | `accuracy_score` | `'accuracy'` | [0, 1] · 1 | Balanced classes; share of correct predictions ✅[^1] |
| Balanced accuracy | `balanced_accuracy_score` | `'balanced_accuracy'` | [0, 1] · 1; `adjusted=True`: [1/(1 − n_classes), 1], random = 0 ✅[^1] | Imbalanced classes: mean of per-class recall; equals accuracy on balanced data ✅[^1] |
| Precision | `precision_score` | `'precision'`, plus `_micro`, `_macro`, `_weighted`, `_samples` ✅[^1] | [0, 1] · 1 | `TP / (TP + FP)`: the ability not to flag negatives ✅[^1] |
| Recall (sensitivity, TPR: true positive rate) | `recall_score` | `'recall'` + suffixes ✅[^1] | [0, 1] · 1 | `TP / (TP + FN)`: the ability to find all positives ✅[^1] |
| F1, Fβ | `f1_score`, `fbeta_score` | `'f1'` + suffixes; Fβ has no string, use `make_scorer(fbeta_score, beta=2)` ✅[^1] | [0, 1] · 1 ✅[^1] | Weighted harmonic mean of precision and recall; β > 1 favours recall ✅[^1] |
| MCC (Matthews correlation coefficient) | `matthews_corrcoef` | `'matthews_corrcoef'` ✅[^5] | binary [−1, 1] · +1, 0 = random; multiclass minimum between −1 and 0 ✅[^1] | Uses all four counts; usable when class sizes differ a lot ✅[^1] |
| Cohen's kappa | `cohen_kappa_score` | — | [−1, 1]; above 0.8 = good agreement ✅[^1] | Agreement between human annotators, not classifier vs truth ✅[^1] |
| Jaccard | `jaccard_score` | `'jaccard'` + suffixes ✅[^1] | `|y ∩ ŷ| / |y ∪ ŷ|`, so [0, 1] · 1 ✅[^1] | Overlap of label sets; multilabel ✅[^1] |
| Hamming loss | `hamming_loss` | — | lower is better | Average share of wrong labels, multilabel ✅[^1] |
| Zero-one loss | `zero_one_loss` | — | `1 − accuracy` ✅[^1] | Same ranking as accuracy ✅[^1] |
| Top-k accuracy | `top_k_accuracy_score` | `'top_k_accuracy'` ✅[^1] | [0, 1] · 1 | True label among the k highest scores; k = 1 is accuracy ✅[^1] |

### Classification from scores (`predict_proba`, `decision_function`)
| Metric | Function | `scoring=` | Range · best | Use when / note |
|---|---|---|---|---|
| ROC-AUC (receiver operating characteristic, area under the curve) | `roc_auc_score` | `'roc_auc'`, `'roc_auc_ovr'`, `'roc_auc_ovo'`, `_weighted` variants ✅[^1] | [0, 1] · 1; 0.5 = random ✅[^6] | Ranking quality; chance that a random positive outranks a random negative ✅[^6]; multiclass needs `multi_class='ovr'` or `'ovo'` ✅[^7] |
| AP (average precision), the step-wise summary of the PR (precision-recall) curve often reported as PR-AUC | `average_precision_score` | `'average_precision'` ✅[^1] | [0, 1] · 1; random = share of positives ✅[^1] | Rare positives; not interpolated, unlike the trapezoid area `auc(recall, precision)`, whose linear interpolation is overly optimistic ✅[^1] |
| Log loss (cross-entropy) | `log_loss` | `'neg_log_loss'` ✅[^1] | [0, ∞) · 0 (non-negative) ✅[^1] | Probability quality; punishes confident errors |
| Brier score | `brier_score_loss` | `'neg_brier_score'` ✅[^1] | binary [0, 1], multiclass [0, 2] with `scale_by_half='auto'` · 0 ✅[^4] | Probability quality; mixes calibration and discrimination ✅[^1] |
| D² log loss, D² Brier (Brier skill score) | `d2_log_loss_score`, `d2_brier_score` | same names ✅[^1] | (−∞, 1] · 1; intercept-only model = 0 ✅[^1] | Log loss or Brier relative to predicting class proportions ✅[^1] |

### Regression
| Metric | Function | `scoring=` | Range · best | Use when / note |
|---|---|---|---|---|
| R² (coefficient of determination) | `r2_score` | `'r2'` ✅[^1] | (−∞, 1] · 1; predicting the mean = 0 ✅[^1] | Share of variance explained; not comparable across datasets ✅[^1]; constant target returns 1.0 or 0.0 unless `force_finite=False` ✅[^1] |
| Explained variance | `explained_variance_score` | `'explained_variance'` ✅[^1] | best 1 ✅[^1] | Ignores a systematic offset; R² is preferred in general ✅[^1] |
| MAE (mean absolute error) | `mean_absolute_error` | `'neg_mean_absolute_error'` ✅[^1] | [0, ∞) · 0 | Median target ✅[^1] |
| MSE, RMSE (mean squared error, root MSE) | `mean_squared_error`, `root_mean_squared_error` | `'neg_mean_squared_error'`, `'neg_root_mean_squared_error'` ✅[^1] | [0, ∞) · 0 | Mean target; RMSE is in target units ✅[^1] |
| MSLE, RMSLE (mean squared log error, root MSLE) | `mean_squared_log_error`, `root_mean_squared_log_error` | `'neg_mean_squared_log_error'`, `'neg_root_mean_squared_log_error'` ✅[^1] | [0, ∞) · 0 | Exponentially growing targets; penalizes under-prediction more than over-prediction ✅[^1] |
| MAPE (mean absolute percentage error) | `mean_absolute_percentage_error` | `'neg_mean_absolute_percentage_error'` ✅[^1] | [0, ∞) · 0, as a fraction: 0.1 means 10% ✅[^1] | Relative errors; unchanged by global scaling of the target ✅[^1] |
| Median absolute error | `median_absolute_error` | `'neg_median_absolute_error'` ✅[^1] | [0, ∞) · 0 | Robust to outliers; no multioutput ✅[^1] |
| Max error | `max_error` | `'neg_max_error'` ✅[^1] | [0, ∞) · 0 | Worst-case residual ✅[^1] |
| Poisson, Gamma, Tweedie deviance | `mean_poisson_deviance`, `mean_gamma_deviance`, `mean_tweedie_deviance` | `'neg_mean_poisson_deviance'`, `'neg_mean_gamma_deviance'` ✅[^1] | lower is better | Tweedie `power` 0 = MSE, 1 = Poisson, 2 = Gamma; higher power gives less weight to extreme deviations; Gamma sees only relative errors ✅[^1] |
| Pinball loss | `mean_pinball_loss` | build with `make_scorer` ✅[^1] | lower is better | Quantile regression; at `alpha=0.5` it is half the MAE ✅[^1] |
| D² absolute error, pinball, Tweedie | `d2_absolute_error_score`, `d2_pinball_score`, `d2_tweedie_score` | `'d2_absolute_error_score'` ✅[^1] | (−∞, 1] · 1; intercept-only model = 0 ✅[^1] | R²-like skill score for other deviances; `d2_tweedie_score` with power 0 equals R² ✅[^1] |

### Ranking (multilabel and relevance scores)
| Metric | Function | Range · best | Use when / note |
|---|---|---|---|
| NDCG (normalized discounted cumulative gain) | `ndcg_score` | [0, 1] · 1 for non-negative relevance; negative true scores can fall outside ✅[^3] | Graded relevance; DCG divided by the DCG of a perfect ranking; usually preferred to DCG; `k=` truncates ✅[^1] ✅[^3] |
| DCG | `dcg_score` | unnormalized | Logarithmically discounted sum of true relevance in predicted order ✅[^1] |
| LRAP (label ranking average precision) | `label_ranking_average_precision_score` | (0, 1] · 1 ✅[^1] | Equals MRR (mean reciprocal rank) when each sample has one relevant label ✅[^1] |
| Coverage error | `coverage_error` | best = average number of true labels ✅[^1] | How deep in the ranking to go to cover all true labels ✅[^1] |
| Ranking loss | `label_ranking_loss` | [0, …) · 0 ✅[^1] | Share of wrongly ordered (true, false) label pairs ✅[^1] |

### Clustering
| Metric | Function | `scoring=` | Needs true labels | Range · best | Note |
|---|---|---|---|---|---|
| ARI (adjusted Rand index) | `adjusted_rand_score` | `'adjusted_rand_score'` ✅[^1] | yes ✅[^2] | [−0.5, 1] · 1; random ≈ 0 ✅[^2] | Invariant to renaming clusters ✅[^5] |
| Rand index | `rand_score` | `'rand_score'` ✅[^1] | yes ✅[^2] | [0, 1] · 1 ✅[^2] | Random labelings are not necessarily near 0 ✅[^2] |
| AMI (adjusted mutual information) | `adjusted_mutual_info_score` | `'adjusted_mutual_info_score'` ✅[^1] | yes ✅[^2] | upper bound 1; random ≈ 0 ✅[^2] | Normalized against chance ✅[^2] |
| NMI, MI (normalized / raw mutual information) | `normalized_mutual_info_score`, `mutual_info_score` | same names ✅[^1] | yes ✅[^2] | — | Not adjusted for chance; tend to grow with the number of labels ✅[^2] |
| Homogeneity, completeness, V-measure | `homogeneity_score`, `completeness_score`, `v_measure_score` | same names ✅[^1] | yes ✅[^2] | [0, 1] · 1 ✅[^2] | Random labelings do not score 0 ✅[^2] |
| Fowlkes–Mallows | `fowlkes_mallows_score` | `'fowlkes_mallows_score'` ✅[^1] | yes ✅[^2] | [0, 1] · 1; random ≈ 0 ✅[^2] | — |
| Silhouette coefficient | `silhouette_score` | — | no ✅[^2] | [−1, 1] · 1; ≈ 0 = overlapping clusters ✅[^2] | Higher for convex clusters than for density-based ones such as DBSCAN (density-based spatial clustering of applications with noise) ✅[^2] |
| Calinski–Harabasz | `calinski_harabasz_score` | — | no ✅[^2] | higher is better ✅[^2] | Same convexity bias ✅[^2] |
| Davies–Bouldin | `davies_bouldin_score` | — | no ✅[^2] | [0, …) · 0 ✅[^2] | The guide lists the same convexity drawback ("generally higher for convex clusters") although lower is better here; centroid distances limit it to Euclidean space ✅[^2] |

## Lookup notes
- **Sign of scorers.** Every scorer returns "higher is better", so distance metrics are exposed negated: `'neg_mean_squared_error'` returns −MSE ✅[^1]. A wrong name raises `InvalidParameterError`, and `get_scorer_names()` lists the valid ones ✅[^1]; 1.9.1 has 58, including `'matthews_corrcoef'` ✅[^5].
- **Ranges checked in the lab.** Lab run (`machine-learning/lab-setup.md`), 2026-11-24, scikit-learn 1.9.1, two runs identical ✅[^5]:

```text
always-negative: accuracy 0.95 | balanced_accuracy 0.5 | MCC 0.0 | F1 0.0
random scores: ROC-AUC 0.514 | AP 0.043 (base rate 0.05)
constant p=0.05: log_loss 0.1985 | Brier 0.0475
multiclass all-wrong Brier 2.0 | binary all-wrong Brier 1.0
multiclass: accuracy 0.3767 | micro-F1 0.3767
R2 of mean predictor 0.0 | R2 of a worse model -3.0
MAPE for 10% errors 0.1
scoring='neg_mean_squared_error' folds [-2779.9 -3028.8] ... (higher is better)
random vs random: rand_score 0.82 | adjusted_rand_score -0.0002 | AMI -0.0003
renamed copy: ARI 1.0 | worst ARI example -0.5
58 scorer names; ['matthews_corrcoef', 'neg_log_loss', 'average_precision', 'neg_brier_score']
```

<details><summary>Full script (prints the output above)</summary>

```python
import numpy as np
from sklearn import metrics as M
from sklearn.datasets import load_diabetes
from sklearn.linear_model import LinearRegression
from sklearn.metrics import get_scorer_names
from sklearn.model_selection import cross_val_score

rng = np.random.default_rng(0)
# Classification: an "always negative" model on a 95:5 label vector
y = np.r_[np.zeros(950, int), np.ones(50, int)]
none = np.zeros_like(y)
print("always-negative: accuracy", M.accuracy_score(y, none),
      "| balanced_accuracy", M.balanced_accuracy_score(y, none),
      "| MCC", M.matthews_corrcoef(y, none),
      "| F1", M.f1_score(y, none, zero_division=0))
print("random scores: ROC-AUC", round(M.roc_auc_score(y, rng.random(1000)), 3),
      "| AP", round(M.average_precision_score(y, rng.random(1000)), 3), "(base rate 0.05)")
prior = np.full(1000, 0.05)
print("constant p=0.05: log_loss", round(M.log_loss(y, prior), 4),
      "| Brier", round(M.brier_score_loss(y, prior), 4))
y3, p3 = np.array([0, 1, 2]), np.eye(3)[[1, 2, 0]]           # 3 classes, all confidently wrong
print("multiclass all-wrong Brier", M.brier_score_loss(y3, p3, labels=[0, 1, 2]),
      "| binary all-wrong Brier", M.brier_score_loss([0, 1], [1.0, 0.0]))
yt, yp = rng.integers(0, 3, 300), rng.integers(0, 3, 300)
print("multiclass: accuracy", round(M.accuracy_score(yt, yp), 4),
      "| micro-F1", round(M.f1_score(yt, yp, average="micro"), 4))

# Regression
yr = np.array([100.0, 200.0, 300.0])
print("R2 of mean predictor", M.r2_score(yr, np.full(3, yr.mean())),
      "| R2 of a worse model", round(M.r2_score(yr, [300.0, 200.0, 100.0]), 3))
print("MAPE for 10% errors", round(M.mean_absolute_percentage_error(yr, yr * 1.1), 4))
X, t = load_diabetes(return_X_y=True)
neg = cross_val_score(LinearRegression(), X, t, cv=5, scoring="neg_mean_squared_error")
print("scoring='neg_mean_squared_error' folds", np.round(neg[:2], 1), "... (higher is better)")

# Clustering: label agreement, invariant to renaming the clusters
a = rng.integers(0, 10, 2000)
b = rng.integers(0, 10, 2000)
print("random vs random: rand_score", round(M.rand_score(a, b), 3),
      "| adjusted_rand_score", round(M.adjusted_rand_score(a, b), 4),
      "| AMI", round(M.adjusted_mutual_info_score(a, b), 4))
print("renamed copy: ARI", M.adjusted_rand_score(a, (a + 3) % 10),
      "| worst ARI example", M.adjusted_rand_score([0, 0, 1, 1], [0, 1, 0, 1]))

# Scorer strings available for scoring= in this version
names = get_scorer_names()
print(len(names), "scorer names;", [n for n in ("matthews_corrcoef", "neg_log_loss", "average_precision",
      "neg_brier_score", "silhouette_score", "ndcg_score") if n in names])
```
</details>

- **Reading the lab lines.** A useless "always negative" model gets 0.95 accuracy but 0.5 balanced accuracy, MCC 0 and F1 0. Random scores give ROC-AUC near 0.5 and AP near the 0.05 base rate. A constant prediction equal to the base rate costs log loss 0.1985 and Brier 0.0475 (`0.05 · 0.95`). The Brier score's binary and multiclass maxima differ (1.0 vs 2.0). Micro-averaged F1 equals accuracy in multiclass ✅[^1] (0.3767 both). R² is 0 for the mean predictor and can go far below 0. MAPE is a fraction, not a percentage. The unadjusted Rand index of two unrelated random clusterings is 0.82, the adjusted one about 0.
- **Multiclass averaging.** `average='macro'` takes the plain mean of per-class scores, `'weighted'` weights by class support and can give an F-score outside the precision–recall range, `'micro'` pools all decisions ✅[^1].
- **Undefined ratios.** An F-score with no true positives, false positives or false negatives is undefined; scikit-learn returns 0 and the `zero_division` parameter changes that ✅[^1]. The lab script sets it explicitly.
- **Baselines.** `DummyClassifier` (`most_frequent`, `prior`, `stratified`, `uniform`, `constant`) and `DummyRegressor` (`mean`, `median`, `quantile`, `constant`) give the score of a model that ignores the input ✅[^1]; report it next to any metric.

## Takeaways
- Match the metric to what is predicted: a mean, a median, a quantile or a probability each has its own consistent score. [rule-candidate]
- Remember that every `scoring=` string is "higher is better": an MSE of 2,800 shows up as −2,800.
- For clustering, compare against chance with the adjusted scores (ARI, AMI), not the raw Rand index or mutual information.
- Always report a dummy baseline's score beside the model's. [rule-candidate]

## Verification status
- Verified: 128 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- [Metrics and scoring: quantifying the quality of predictions (User Guide 3.4)](https://scikit-learn.org/stable/modules/model_evaluation.html) — scikit-learn developers, living (1.9.1 docs). Backs: strictly consistent scores, scorer strings and sign convention, every classification, regression and ranking row except where another source is named, averaging, `zero_division`, dummy estimators. [^1]
- [Clustering performance evaluation (User Guide 2.3.11)](https://scikit-learn.org/stable/modules/clustering.html) — scikit-learn developers, living. Backs: clustering ranges, chance adjustment, need for ground truth, convexity bias. [^2]
- [sklearn.metrics.ndcg_score](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.ndcg_score.html) — scikit-learn developers, living. Backs: NDCG in [0, 1] unless true scores are negative, ideal-DCG normalization. [^3]
- [sklearn.metrics.brier_score_loss](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.brier_score_loss.html) — scikit-learn developers, living. Backs: `scale_by_half='auto'` ranges. [^4]
- `machine-learning/lab-setup.md` — the lab where the metric ranges, the ARI renaming check and the scorer-name list were checked on 2026-11-24. [^5]
- [Classification: ROC and AUC](https://developers.google.com/machine-learning/crash-course/classification/roc-and-auc) — Google Machine Learning Crash Course, living. Backs: AUC as a ranking probability, 0.5 for random. [^6]
- [sklearn.metrics.roc_auc_score](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.roc_auc_score.html) — scikit-learn developers, living. Backs: `multi_class` must be set for multiclass. [^7]

## Related
- `machine-learning/evaluation/classification-metrics.md` — the mechanism behind the classification rows.
- `machine-learning/evaluation/probability-calibration.md` — Brier score and log loss in use.
- `machine-learning/evaluation/cross-validation-and-hyperparameter-search.md` — where `scoring=` strings are used.
- `machine-learning/foundations/loss-functions-and-maximum-likelihood.md` — the same quantities as training losses.
- `machine-learning/unsupervised-learning/k-means-clustering.md` — clustering scores in use.
- `algorithms/vector-search-evaluation.md` — recall and latency for nearest-neighbour retrieval.
