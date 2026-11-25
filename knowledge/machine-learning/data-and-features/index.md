---
schema: topic-index/v1
kind: subtopic
topic: machine-learning/data-and-features
last-updated: 2026-11-25
---

# Data preparation and features

Turning raw columns into model inputs without leaking information: scaling and the `Pipeline` / `ColumnTransformer` objects that learn preprocessing from training rows only, encoding categories (one-hot, ordinal, cross-fitted target encoding) and handling missing values (imputation, missing indicators, native `NaN` support), measuring and selecting features (impurity vs permutation importance, univariate, recursive and L1 selection), and explaining a fitted model's predictions (partial dependence, ICE (individual conditional expectation) curves, ALE (accumulated local effects) and Shapley values). Every doc quotes scikit-learn 1.9.1 runs from the lab. Not covered: data leakage as an evaluation failure (see `machine-learning/evaluation/data-leakage.md`), and how the models themselves work (see `machine-learning/supervised-learning/`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [preprocessing-and-pipelines.md](preprocessing-and-pipelines.md) | concept | Why scale (wine KNN 0.722 → 0.963), statistics learned on train rows only, `Pipeline` and `ColumnTransformer` end to end, `step__param` tuning | verified |
| [categorical-and-missing-data.md](categorical-and-missing-data.md) | concept | One-hot, ordinal and target encoding with cross-fitting (no cross-fit: train 0.894, test 0.607), imputers, missing indicators, native `NaN` and categories in `HistGradientBoosting` | verified |
| [feature-importance-and-selection.md](feature-importance-and-selection.md) | concept | MDI vs permutation importance (noise column 0.087 vs 0.002), correlated twins, univariate, RFE and L1 selection, selection inside CV | verified |
| [partial-dependence-and-shapley-values.md](partial-dependence-and-shapley-values.md) | concept | PDP (partial dependence plot) and ICE (a flat PDP hiding ICE slopes of ±2.2), ALE under correlated features, exact Shapley values and their axioms, the SHAP (SHapley Additive exPlanations) estimators KernelSHAP and TreeSHAP, interventional vs observational values (0.000 vs 0.449 for an unused feature), and why none is causal | verified |

## References
- [scikit-learn User Guide](https://scikit-learn.org/stable/user_guide.html) — scikit-learn developers, living. Backs: topic scope.
- [Dataset transformations (User Guide 8)](https://scikit-learn.org/stable/data_transforms.html) — scikit-learn developers, living (1.9.1). Backs: pipelines, preprocessing and imputation as one family of transformers.
- [Common pitfalls and recommended practices](https://scikit-learn.org/stable/common_pitfalls.html) — scikit-learn developers, living (1.9.1). Backs: inconsistent preprocessing and leakage, the problems this subtopic guards against.
- [Inspection (User Guide 5)](https://scikit-learn.org/stable/inspection.html) — scikit-learn developers, living (1.9.1). Backs: partial dependence, ICE and permutation importance as the library's inspection tools.
- [Interpretable Machine Learning](https://christophm.github.io/interpretable-ml-book/) — Christoph Molnar, living. Backs: PDP, ICE, ALE, Shapley values and SHAP as one family of model-agnostic methods.

## Related
- `machine-learning/learning-path.md` — where this subtopic sits in the reading order.
- `machine-learning/lab-setup.md` — the lab every experiment ran in.
- `machine-learning/evaluation/data-leakage.md` — leakage from preprocessing, targets, time and duplicates.
- `machine-learning/supervised-learning/tree-ensembles.md` — the forests and boosting models whose importances and native `NaN` support appear here.
- `machine-learning/deep-learning/interpretability-and-attribution.md` — gradient-based attributions for neural networks.
