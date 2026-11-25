---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/data-and-features
status: verified
applies-to: ["scikit-learn 1.9.1"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [machine-learning, preprocessing, feature-scaling, standardscaler, pipeline, columntransformer, scikit-learn, data-leakage]
---

# Preprocessing and pipelines: scaling, fit on train only, Pipeline and ColumnTransformer

## Summary
**TL;DR:** Many models compare raw numbers across features, so a feature measured in thousands drowns one measured in units; standardizing each feature (subtract its mean, divide by its standard deviation) fixes that. The statistics used for scaling are learned parameters: learn them from the training rows only, then apply the same stored numbers to every later row. A scikit-learn `Pipeline` chains the preprocessing and the model so that `fit` learns every step from the training data and `predict` re-applies them; a `ColumnTransformer` sends each group of columns to its own preprocessing step and glues the outputs side by side.
**Use this when:** a KNN (k-nearest neighbours), SVM (support vector machine), linear or PCA (principal component analysis) model behaves badly on unscaled data, you prepare a table with mixed numeric and text columns, or you need preprocessing to run identically in cross-validation, tuning and production.
**Not this doc:** encoding categories and filling missing values → `machine-learning/data-and-features/categorical-and-missing-data.md`; leakage as an evaluation failure in general → `machine-learning/evaluation/data-leakage.md`; why scaling speeds up gradient descent → `machine-learning/foundations/gradient-descent.md`.

## Problem
Three things go wrong without this knowledge:
- **Scale decides instead of signal.** In the wine dataset bundled with scikit-learn, the feature `proline` has a standard deviation of 314.0 and the smallest one 0.124, so Euclidean distances are almost entirely proline differences; a KNN classifier scores 0.722 on raw features and 0.963 after standardization ✅[^4].
- **Statistics learned from the wrong rows.** A scaler fitted on all rows has already seen the test rows; the test score then measures a model that peeked ✅[^3].
- **Forgotten or mismatched steps.** Scaling the training data but not the test data changes the feature space: the scikit-learn pitfalls page shows a linear regression whose test MSE (mean squared error) is 62.80 with an unscaled test set and 0.90 when the test set gets the same transform ✅[^3]. Hand-written glue code for many column types makes such mismatches likely.

## Mental model
**Analogy:** a factory line of measuring machines. Each machine is calibrated once, on the training batch (a scaler notes each feature's mean and spread), and the calibration is then locked. Every later batch, test rows or live requests, passes through the same machines with the same settings. A `Pipeline` is the line; a `ColumnTransformer` is a sorting belt at its start that sends number columns to one machine and text columns to another, then stacks the results into one row.

**Artifact:** the effect of the calibration, and what changes when it is done on the wrong rows. Lab run (`machine-learning/lab-setup.md`), 2026-11-24, scikit-learn 1.9.1, wine data (178 rows, 13 features), two runs identical ✅[^4]:

```text
feature std: min 0.124, max 314.0 (proline)
KNN k=5: test accuracy raw=0.722 scaled=0.963
SVC rbf: test accuracy raw=0.648 scaled=1.000
proline mean: train-only 754.8, all rows 746.9
5-fold CV accuracy: scaled before CV=0.9551, scaler inside pipeline=0.9494
```

Reading it: the SVC (support vector classifier) with an RBF (radial basis function) kernel goes from 0.648 to 1.000 on the same 54 test wines once features are standardized ✅[^4]. A scaler fitted on all rows learns a proline mean of 746.9 instead of the training rows' 754.8, and scaling before cross-validation (CV) reports 0.9551 against 0.9494 with the scaler refitted inside each fold: for a plain scaler the optimism is small, but it is the same mistake that makes feature selection or target encoding report large fake gains (`machine-learning/evaluation/data-leakage.md`).

<details><summary>Full script (prints the output above)</summary>

```python
from sklearn.datasets import load_wine
from sklearn.model_selection import cross_val_score, train_test_split
from sklearn.neighbors import KNeighborsClassifier
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC

X, y = load_wine(return_X_y=True)                       # 178 wines, 13 numeric features
print(f"feature std: min {X.std(0).min():.3f}, max {X.std(0).max():.1f} (proline)")
Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.3, random_state=0, stratify=y)
for name, clf in [("KNN k=5", KNeighborsClassifier()), ("SVC rbf", SVC())]:
    raw = clf.fit(Xtr, ytr).score(Xte, yte)
    scaled = make_pipeline(StandardScaler(), clf).fit(Xtr, ytr).score(Xte, yte)
    print(f"{name}: test accuracy raw={raw:.3f} scaled={scaled:.3f}")

# what a scaler learns from train rows only vs from all rows
print(f"proline mean: train-only {StandardScaler().fit(Xtr).mean_[12]:.1f}, "
      f"all rows {StandardScaler().fit(X).mean_[12]:.1f}")
knn = KNeighborsClassifier()
leaky = cross_val_score(knn, StandardScaler().fit_transform(X), y, cv=5).mean()
clean = cross_val_score(make_pipeline(StandardScaler(), knn), X, y, cv=5).mean()
print(f"5-fold CV accuracy: scaled before CV={leaky:.4f}, scaler inside pipeline={clean:.4f}")
```
</details>

## How it works
**Why scale at all.** Objective terms such as the RBF kernel of an SVM or the L1 and L2 penalties of linear models may assume that features are centred on zero or have variances of the same order; a feature whose variance is orders of magnitude larger might dominate the objective ✅[^1]. In the wine data, proline (values up to about 1,000) dominates the KNN distance while hue (about 1 to 10) is almost ignored ✅[^5]. Tree-based models are almost unaffected by scaling ✅[^5].

**4 actors:**
- **Transformer** (for example `StandardScaler`) — its job: learn statistics from data and re-apply them, via `fit` and `transform`.
- **ColumnTransformer** — its job: route column groups to their own transformers and concatenate the outputs, via a list of `(name, transformer, columns)` entries.
- **Pipeline** — its job: chain the steps and pass each step's output to the next, via `fit`, `predict` and `score` on the whole chain.
- **Final estimator** (the model) — its job: learn from and predict on the transformed features, via its own `fit` and `predict`.

```
fit(X_train, y_train)                         predict(X_new)
   │                                             │
   ▼                                             ▼
ColumnTransformer.fit_transform               ColumnTransformer.transform
 ├─ numeric cols → StandardScaler: learn       ├─ numeric cols → (x − mean_) / scale_
 │     mean_, scale_ from TRAIN rows           │     with the stored train numbers
 └─ text cols → OneHotEncoder: learn           └─ text cols → stored categories_
       categories_ from TRAIN rows             │
   │  stacked columns                          │  same columns, same order
   ▼                                           ▼
model.fit(Z_train, y_train)                   model.predict(Z_new)
```

1. **Standardize:** `StandardScaler` stores each feature's mean (`mean_`) and standard deviation (`scale_`) from the rows it is fitted on and maps `z = (x − mean_) / scale_`, where `x` is a raw value and `z` its standardized value ✅[^1]. Worked numbers from the scikit-learn guide: a column `[1, 2, 0]` has mean 1 and standard deviation `√(2/3) ≈ 0.816` (the guide prints 0.81), so `x = 2` becomes `z = (2 − 1) / 0.816 = 1.22` ✅[^1].
2. **Re-apply, never refit:** the fitted scaler applies the same shift and scale to new data unseen during `fit` ✅[^1]; with `MinMaxScaler` a test value outside the training range maps outside `[0, 1]` (the guide's example gives −1.5) ✅[^1].
3. **Chain:** every `Pipeline` step except the last must be a transformer; calling `fit` on the pipeline fits each step in turn, transforms the data and passes it on, and the pipeline exposes the last step's methods such as `predict` ✅[^2].
4. **Route columns:** a `ColumnTransformer` applies a different transformer to each column group; columns not named are dropped by default (`remainder='drop'`), kept with `remainder='passthrough'`, or sent to a transformer given as `remainder` ✅[^2]. `get_feature_names_out()` lists the output columns ✅[^2].
5. **Tune through the chain:** a step's parameter is addressed as `<step>__<parameter>` (for example `clf__C`), so a grid search can tune preprocessing and model together ✅[^2].
6. **Keep folds clean:** inside `cross_val_score` or a grid search, the whole pipeline is refitted on each training fold, so the held-out fold never contributes to a scaler's mean or an encoder's categories ✅[^3]. The scikit-learn rule is: split first, and never call `fit` or `fit_transform` on test data ✅[^3].

## Worked example
A table with two numeric columns and one text column goes through one `ColumnTransformer` and a logistic regression, inside one `Pipeline`. Core lines:

```python
pre = ColumnTransformer([
    ("num", StandardScaler(), ["age", "income"]),
    ("cat", OneHotEncoder(handle_unknown="ignore"), ["region"]),
])
model = Pipeline([("pre", pre), ("clf", LogisticRegression())]).fit(Xtr, ytr)
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-24, scikit-learn 1.9.1, pandas 3.1.1, 300 synthetic rows (225 train, 75 test), two runs identical ✅[^4]:

```text
output columns: ['num__age', 'num__income', 'cat__region_east', 'cat__region_north', 'cat__region_south']
scaler mean_ : [   51.2 50259.1]
scaler scale_: [   18.1 15499.3]
train means  : [   51.2 50259.1]
transformed new rows:
 [[-0.621  0.951  0.     0.     1.   ]
 [-0.621 -1.307  0.     0.     0.   ]]
test accuracy: 0.987
best clf__C: 100 cv score 0.987
```

Reading it line by line:
- **Columns:** 2 scaled numbers plus 3 one-hot columns, one per region seen in training; the `num__` and `cat__` prefixes are the transformer names.
- **Stored statistics:** the scaler's `mean_` equals the training rows' means exactly; the test rows never entered it.
- **A new row:** income 65,000 becomes `(65000 − 50259.1) / 15499.3 = 0.951`; age 40 becomes about `(40 − 51.2) / 18.1 = −0.62` (−0.621 before rounding the stored numbers). Region `south` lights the third one-hot column.
- **An unseen category:** region `west` never appeared in training; with `handle_unknown="ignore"` its three one-hot columns are all zeros instead of an error ✅[^4].
- **Tuning:** `GridSearchCV` reached the model's `C` through the name `clf__C` and refitted the scaler and encoder in each of the 5 folds.

<details><summary>Full script (prints the output above)</summary>

```python
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GridSearchCV, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

rng = np.random.default_rng(0)
n = 300
df = pd.DataFrame({
    "age": rng.integers(18, 80, n),
    "income": rng.normal(50_000, 15_000, n).round(),
    "region": rng.choice(["north", "south", "east"], n),
})
target = ((df["income"] > 50_000) | (df["region"] == "east")).astype(int)
Xtr, Xte, ytr, yte = train_test_split(df, target, test_size=0.25, random_state=0)

pre = ColumnTransformer([
    ("num", StandardScaler(), ["age", "income"]),
    ("cat", OneHotEncoder(handle_unknown="ignore"), ["region"]),
])
model = Pipeline([("pre", pre), ("clf", LogisticRegression())]).fit(Xtr, ytr)

print("output columns:", list(model[:-1].get_feature_names_out()))
print("scaler mean_ :", model.named_steps["pre"].named_transformers_["num"].mean_.round(1))
print("scaler scale_:", model.named_steps["pre"].named_transformers_["num"].scale_.round(1))
print("train means  :", Xtr[["age", "income"]].mean().round(1).to_numpy())
new = pd.DataFrame({"age": [40, 40], "income": [65_000, 30_000], "region": ["south", "west"]})
print("transformed new rows:\n", model[:-1].transform(new).round(3))
print(f"test accuracy: {model.score(Xte, yte):.3f}")
search = GridSearchCV(model, {"clf__C": [0.01, 1, 100]}, cv=5).fit(Xtr, ytr)
print("best clf__C:", search.best_params_["clf__C"], f"cv score {search.best_score_:.3f}")
```
</details>

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Training data scaled, test data passed raw | Predictions in a different feature space; test MSE 62.80 instead of 0.90 in the scikit-learn example | The transform must be applied to every later dataset ✅[^3] |
| Scaler fitted on all rows before splitting or CV | Slightly optimistic score (lab: 0.9551 vs 0.9494) | Test rows shaped the stored mean ✅[^4]; never fit on test data ✅[^3] |
| Features with heavy outliers | Mean and standard deviation are pulled by the outliers | `RobustScaler` uses more robust estimates of centre and range ✅[^1] |
| Test value outside the training range with `MinMaxScaler` | Maps outside `[0, 1]` (−1.5 in the guide's example) | The stored min and max are reused, not recomputed ✅[^1] |
| Tree models (decision trees, random forests, boosting) | Scaling makes almost no difference | Tree-based models are almost unaffected by scaling ✅[^5] |
| A column not listed in the `ColumnTransformer` | Silently dropped | Default `remainder='drop'` ✅[^2] |
| New category at predict time with `OneHotEncoder(handle_unknown="ignore")` | All-zero one-hot columns | Lab: region `west` → `0, 0, 0` ✅[^4] |
| DataFrame with string column names | Columns are selected by name at transform time, so extra columns are ignored | `ColumnTransformer` uses the names when fitted on such a frame ✅[^2] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `StandardScaler` (mean 0, variance 1) | Many estimators, such as linear models, benefit from it ✅[^1] | Sensitive to outliers ✅[^1] |
| `MinMaxScaler` / `MaxAbsScaler` | The guide's stated motivations: robustness to very small standard deviations, and preserving zero entries in sparse data ✅[^1] | New values can leave the target range ✅[^1] |
| `RobustScaler` | Centre and range less affected by outliers ✅[^1] | Cannot be fitted to sparse inputs ✅[^1] |
| Preprocess by hand (for example in pandas) before scikit-learn | Familiar tools | Easy to leak test statistics and to forget a step at serving time; preprocessing parameters cannot be tuned in the same search ✅[^2] |
| `Pipeline` + `ColumnTransformer` | One object to fit, tune, cross-validate and ship ✅[^2] | Step names become part of parameter names (`pre__num__with_mean`) |

## Takeaways
- Treat every preprocessing statistic as a model parameter: learn it on training rows only. [rule-candidate]
- Put preprocessing and model in one `Pipeline` and pass that pipeline, not pre-transformed arrays, to cross-validation and grid search. [rule-candidate]
- Standardize before distance-, kernel- or penalty-based models; skip it for tree models.
- Check `get_feature_names_out()` once: it shows exactly which columns the model sees and which ones were dropped.

## Verification status
- Verified: 37 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- [Preprocessing data (User Guide 8.3)](https://scikit-learn.org/stable/modules/preprocessing.html) — scikit-learn developers, living (1.9.1). Backs: why standardize (RBF kernel, L1/L2 penalties, dominating feature), `StandardScaler` statistics and worked numbers, re-applying to test data, `MinMaxScaler`, `MaxAbsScaler`, `RobustScaler`. [^1]
- [Pipelines and composite estimators (User Guide 8.1)](https://scikit-learn.org/stable/modules/compose.html) — scikit-learn developers, living (1.9.1). Backs: Pipeline step rules and purposes, `<step>__<parameter>`, `ColumnTransformer`, `remainder`, `get_feature_names_out`, selection by column name, the problems of preprocessing outside scikit-learn. [^2]
- [Common pitfalls and recommended practices](https://scikit-learn.org/stable/common_pitfalls.html) — scikit-learn developers, living (1.9.1). Backs: inconsistent preprocessing example (MSE 62.80 vs 0.90), never fit on test data, split first, pipelines in cross-validation. [^3]
- `machine-learning/lab-setup.md` — the lab where the wine scaling comparison, the train-only vs all-rows scaler and the `ColumnTransformer` pipeline ran on 2026-11-24. [^4]
- [Importance of Feature Scaling (example)](https://scikit-learn.org/stable/auto_examples/preprocessing/plot_scaling_importance.html) — scikit-learn developers, living (1.9.1). Backs: trees almost unaffected by scaling, proline vs hue dominating KNN distances. [^5]

## Related
- `machine-learning/data-and-features/categorical-and-missing-data.md` — the encoders and imputers that go inside the `ColumnTransformer`.
- `machine-learning/evaluation/data-leakage.md` — preprocessing, target and temporal leakage in general.
- `machine-learning/evaluation/cross-validation-and-hyperparameter-search.md` — the CV splitters and searches a pipeline is passed to.
- `machine-learning/supervised-learning/k-nearest-neighbors.md` — why distances need comparable scales.
- `machine-learning/foundations/gradient-descent.md` — feature scaling and the conditioning of the loss surface.
- `machine-learning/unsupervised-learning/principal-component-analysis.md` — PCA's sensitivity to feature scale.
