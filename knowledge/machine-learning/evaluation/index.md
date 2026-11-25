---
schema: topic-index/v1
kind: subtopic
topic: machine-learning/evaluation
last-updated: 2026-11-25
---

# Model evaluation and selection

Measuring how good a model is and choosing between models honestly: classification metrics and thresholds, a catalog of metrics, cross-validation and hyperparameter search, Bayesian optimization of hyperparameters, data leakage, class imbalance, probability calibration, conformal prediction sets and intervals, and group fairness metrics. Every doc pairs the mechanism with a reproducible lab run (scikit-learn 1.9.1) whose full script is embedded. Not covered: what train, validation and test sets are (see `machine-learning/foundations/generalization-and-overfitting.md`), building pipelines (see `machine-learning/data-and-features/preprocessing-and-pipelines.md`), and monitoring a model in production (see `machine-learning/ml-systems/`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [classification-metrics.md](classification-metrics.md) | concept | Confusion matrix, the accuracy paradox, precision/recall/F1 per threshold, ROC-AUC vs PR-AUC as positives get rarer | verified |
| [metrics-catalog.md](metrics-catalog.md) | reference | Classification, regression, ranking and clustering metrics: scikit-learn function, `scoring=` string, range, best value, when to use | verified |
| [cross-validation-and-hyperparameter-search.md](cross-validation-and-hyperparameter-search.md) | concept | K-fold, stratified, group and time-series splitters; nested CV against selection bias; grid vs random search; successive halving | verified |
| [bayesian-optimization.md](bayesian-optimization.md) | concept | A Gaussian-process surrogate plus an acquisition function (expected improvement, upper confidence bound, probability of improvement) written by hand; exploration vs exploitation; Bayesian optimization vs random and grid search on one SVM (support vector machine) budget; TPE (tree-structured Parzen estimator) and Optuna in outline; noise, parallel suggestions, multi-fidelity | verified |
| [data-leakage.md](data-leakage.md) | concept | Preprocessing, target, temporal and duplicate leakage, each shown turning a chance-level model into a star, and the fix for each | verified |
| [class-imbalance.md](class-imbalance.md) | concept | Base rates, class weights, random over/undersampling, SMOTE and threshold moving compared on one dataset, and what each does to probabilities | verified |
| [probability-calibration.md](probability-calibration.md) | concept | Reliability curves, ECE, Brier score and log loss; sigmoid (Platt), isotonic and temperature scaling with `CalibratedClassifierCV` | verified |
| [algorithmic-fairness.md](algorithmic-fairness.md) | concept | Demographic parity, equalized odds, equal opportunity and calibration within groups; why they conflict when base rates differ (Kleinberg, Chouldechova); pre-, in- and post-processing (per-group thresholds); proxies defeat "unawareness"; what metrics cannot settle | verified |
| [conformal-prediction.md](conformal-prediction.md) | concept | Split conformal sets and intervals with marginal coverage under exchangeability; the ⌈(n+1)(1−α)⌉ rank; absolute residual vs CQR; LAC vs APS; conditional coverage and covariate shift (weighted conformal) | verified |

## References
- [scikit-learn User Guide](https://scikit-learn.org/stable/user_guide.html) — scikit-learn developers, living. Backs: topic scope.
- [Model selection and evaluation (User Guide 3)](https://scikit-learn.org/stable/model_selection.html) — scikit-learn developers, living. Backs: cross-validation, tuning, thresholds and metrics chapters.
- [Probability calibration (User Guide 1.16)](https://scikit-learn.org/stable/modules/calibration.html) — scikit-learn developers, living. Backs: calibration scope.
- [Common pitfalls and recommended practices](https://scikit-learn.org/stable/common_pitfalls.html) — scikit-learn developers, living. Backs: leakage scope.
- [A Tutorial on Bayesian Optimization](https://arxiv.org/html/1807.02811v1) — Peter I. Frazier, 2018. Backs: Bayesian optimization scope.

## Related
- `machine-learning/learning-path.md` — where this subtopic sits in the reading order.
- `machine-learning/lab-setup.md` — the lab every experiment ran in.
- `machine-learning/foundations/generalization-and-overfitting.md` — train/validation/test splits and overfitting, the basis of every doc here.
- `machine-learning/data-and-features/preprocessing-and-pipelines.md` — pipelines that keep preprocessing inside each fold.
- `machine-learning/ml-systems/data-drift-and-monitoring.md` — evaluation after deployment.
- `algorithms/vector-search-evaluation.md` — recall and latency for retrieval systems.
