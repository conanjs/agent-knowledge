---
schema: topic-index/v1
kind: subtopic
topic: machine-learning/data-and-features
last-updated: 2026-11-24
---

# Data preparation and features

Turning raw columns into model inputs without leaking information: scaling and the `Pipeline` / `ColumnTransformer` objects that learn preprocessing from training rows only, encoding categories (one-hot, ordinal, cross-fitted target encoding) and handling missing values (imputation, missing indicators, native `NaN` support), and measuring and selecting features (impurity vs permutation importance, univariate, recursive and L1 selection). Every doc quotes scikit-learn 1.9.1 runs from the lab. Not covered: data leakage as an evaluation failure (see `machine-learning/evaluation/data-leakage.md`), and how the models themselves work (see `machine-learning/supervised-learning/`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [preprocessing-and-pipelines.md](preprocessing-and-pipelines.md) | concept | Why scale (wine KNN 0.722 → 0.963), statistics learned on train rows only, `Pipeline` and `ColumnTransformer` end to end, `step__param` tuning | verified |
| [categorical-and-missing-data.md](categorical-and-missing-data.md) | concept | One-hot, ordinal and target encoding with cross-fitting (no cross-fit: train 0.894, test 0.607), imputers, missing indicators, native `NaN` and categories in `HistGradientBoosting` | verified |
| [feature-importance-and-selection.md](feature-importance-and-selection.md) | concept | MDI vs permutation importance (noise column 0.087 vs 0.002), correlated twins, univariate, RFE and L1 selection, selection inside CV | verified |

## References
- [scikit-learn User Guide](https://scikit-learn.org/stable/user_guide.html) — scikit-learn developers, living. Backs: topic scope.
- [Dataset transformations (User Guide 8)](https://scikit-learn.org/stable/data_transforms.html) — scikit-learn developers, living (1.9.1). Backs: pipelines, preprocessing and imputation as one family of transformers.
- [Common pitfalls and recommended practices](https://scikit-learn.org/stable/common_pitfalls.html) — scikit-learn developers, living (1.9.1). Backs: inconsistent preprocessing and leakage, the problems this subtopic guards against.

## Related
- `machine-learning/learning-path.md` — where this subtopic sits in the reading order.
- `machine-learning/lab-setup.md` — the lab every experiment ran in.
- `machine-learning/evaluation/data-leakage.md` — leakage from preprocessing, targets, time and duplicates.
- `machine-learning/supervised-learning/tree-ensembles.md` — the forests and boosting models whose importances and native `NaN` support appear here.
