---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/evaluation
status: verified
applies-to: ["scikit-learn 1.9.1"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [machine-learning, evaluation, data-leakage, target-leakage, temporal-leakage, duplicates, pipeline, cross-validation, feature-selection]
---

# Data leakage: preprocessing, target, temporal and duplicate leaks

## Summary
**TL;DR:** Data leakage is using, while building a model, information that will not exist when the model makes real predictions. The evaluation then reports a score the model can never reach in production. Four doors let it in: a preprocessing step fitted on rows that include the test rows; a feature that is a proxy for the target or is recorded after it; test rows from before the training rows on time-ordered data; and the same record or unit on both sides of the split. In the lab, each door turned a near-chance model into a star: 0.50 → 0.84 accuracy on pure noise, R² (coefficient of determination, 1 = perfect, 0 = no better than predicting the mean) −0.54 → 0.997 on a random walk.
**Use this when:** a validation score looks too good, cross-validation beats the later holdout or production, you preprocess before splitting, the data has timestamps, repeated records or several rows per person, or you review someone's evaluation code.
**Not this doc:** how to build a `Pipeline` → `machine-learning/data-and-features/preprocessing-and-pipelines.md`; choosing splitters and nested search → `machine-learning/evaluation/cross-validation-and-hyperparameter-search.md`; target encoding with cross-fitting → `machine-learning/data-and-features/categorical-and-missing-data.md`.

## Problem
Leakage gives overly optimistic performance estimates, for example from cross-validation, and then poorer performance on genuinely new data in production ✅[^1]. It is not a beginner's mistake only: a survey of machine-learning-based (ML-based) science found 20 papers across 17 fields that identified pitfalls, with leakage in every one of those fields, collectively affecting 329 papers ✅[^2]. The code that leaks usually looks correct (one `fit_transform` on the whole table, one shuffled split), so nothing fails; the only symptom is a number that is too good.

## Mental model
**Analogy:** an exam whose teacher wrote the study guide after reading the exam paper. The student never sees the questions, yet scores far above what she knows, because the guide covered exactly what was asked. Fitting a feature selector, scaler or resampler on all rows is writing the study guide from the exam: no single line "trains on the test set", but the test set shaped what the model was taught.

**Artifact:** the classic case, 200 samples of 10,000 pure-noise features with random labels, so honest accuracy is 0.5. The leaky and the clean version differ in one place:

```python
X_sel = SelectKBest(k=25).fit_transform(X, y)   # chooses 25 columns using ALL rows' labels
leaky = cross_val_score(LogisticRegression(), X_sel, y, cv=cv)
clean = cross_val_score(make_pipeline(SelectKBest(k=25), LogisticRegression()), X, y, cv=cv)
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-24, scikit-learn 1.9.1 ✅[^7] (the full script is in the worked example):

```text
1 select-then-CV   accuracy 0.840 +/- 0.058
1 select-inside-CV accuracy 0.500 +/- 0.050   (chance = 0.5)
```

The first line picked, from 10,000 random columns, the 25 that happen to correlate with the labels of every row, the future test folds included. The pipeline repeats the selection inside each training fold, so the test fold never votes.

## How it works
**The test for every feature and every step:** "at the moment of a real prediction, would this information exist?" Leakage is information that would not be available at prediction time used while building the model ✅[^1]. Kapoor & Narayanan group the errors into three families: no clean train/test separation, illegitimate features, and a test set not drawn from the distribution the claim is about ✅[^2]. The four doors below map onto them.

1. **Preprocessing leakage (no clean separation).**
   - *Mechanism:* any step with a `fit` learns statistics: a scaler learns means, an imputer fills values, a selector ranks features by their link to `y`, an oversampler creates rows. Fitted on all rows, it carries test information into training. The risk holds for almost every transformation, `StandardScaler`, `SimpleImputer` and `PCA` (principal component analysis) included ✅[^1].
   - *Rule:* split first, never call `fit` or `fit_transform` on test data, and `transform` both sides with the training-fitted step ✅[^1]. Resampling counts: oversampling before the split puts generated copies of training rows in the test set ✅[^2], and resampling the whole dataset also makes the test set balanced, unlike the real use case ✅[^6].
   - *Tool:* a `Pipeline` makes sure each method runs on the right subset, and suits cross-validation and hyperparameter search ✅[^1], so every fitted step is refitted on each training fold (`machine-learning/data-and-features/preprocessing-and-pipelines.md`).
2. **Target leakage (illegitimate features).**
   - *Mechanism:* a column is a proxy for the outcome or is recorded only after it. Kapoor & Narayanan's example: anti-hypertensive drug use as a feature for predicting hypertension, information a model would not have for a new patient ✅[^2].
   - *Rule:* deciding whether a feature is legitimate requires domain knowledge and can be highly problem specific ✅[^2], so check, for each feature, when and by whom it is recorded.
3. **Temporal leakage (wrong test distribution).**
   - *Mechanism:* when the model will predict the future, a test row dated before training rows lets the model learn "from the future" ✅[^2]. K-fold and shuffle-split assume independent, identically distributed samples; on autocorrelated time series they create unreasonable correlation between training and test rows and give poor estimates of generalization error ✅[^4]. Shuffling news articles ordered by publication time is the guide's own example of an inflated score ✅[^4].
   - *Rule:* validate on the future: `TimeSeriesSplit` trains on the first k folds and tests on fold k + 1, and its `gap` drops samples between train and test ✅[^5].
4. **Duplicate and group leakage (no clean separation, non-independent samples).**
   - *Mechanism:* the same record, or several records of the same person or device, land in train and test. Duplicates let a model be tested on rows it trained on ✅[^2] ✅[^3]; non-independent samples from the same units measure performance on old units, not new ones ✅[^2].
   - *Rule:* delete validation and test rows that duplicate training rows ✅[^3], and split by unit with a group splitter such as `GroupKFold` so that no group is in both training and test ✅[^4].

**Detection signals:** a score far above what the problem allows (the Google course's example: 99% precision on both train and test traced back to duplicated spam emails ✅[^3]); cross-validation better than a later untouched holdout (imbalanced-learn's demonstration: balanced accuracy 0.724 in leaky cross-validation, 0.698 on the left-out set ✅[^6]); one feature carrying almost all the importance.

## Worked example
One script, one door per part. Every model is honest except for the leak, and every "clean" number is computed on the same data. The core lines of parts 3 and 4:

```python
ids = np.repeat(np.arange(len(y2)), 3)                       # every row stored 3 times
cross_val_score(knn, X2[ids], y2[ids], cv=GroupKFold(5), groups=ids)   # copies stay together
cross_val_score(rf, t, walk, cv=TimeSeriesSplit(n_splits=5), scoring="r2")  # test is the future
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-24, scikit-learn 1.9.1, numpy 2.5.5, two runs identical ✅[^7]:

```text
1 select-then-CV   accuracy 0.840 +/- 0.058
1 select-inside-CV accuracy 0.500 +/- 0.050   (chance = 0.5)
2 legitimate features 0.640   + post-outcome column 0.950
3 1-NN: duplicates across folds 0.988   grouped by id 0.714   de-duplicated 0.710
4 R^2 shuffled KFold 0.997   TimeSeriesSplit -0.538  folds [-0.06 -0.01 -0.04 -2.49 -0.09]
```

<details><summary>Full script (prints the output above)</summary>

```python
import numpy as np
from sklearn.datasets import make_classification
from sklearn.ensemble import RandomForestRegressor
from sklearn.feature_selection import SelectKBest
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GroupKFold, KFold, TimeSeriesSplit, cross_val_score
from sklearn.neighbors import KNeighborsClassifier
from sklearn.pipeline import make_pipeline

cv = KFold(n_splits=5, shuffle=True, random_state=0)

# 1. Preprocessing leakage: 200 samples, 10,000 pure-noise features, random labels
rng = np.random.default_rng(42)
X = rng.standard_normal((200, 10_000))
y = rng.integers(0, 2, 200)
X_sel = SelectKBest(k=25).fit_transform(X, y)                # sees every row, test folds too
leaky = cross_val_score(LogisticRegression(), X_sel, y, cv=cv)
clean = cross_val_score(make_pipeline(SelectKBest(k=25), LogisticRegression()), X, y, cv=cv)
print(f"1 select-then-CV   accuracy {leaky.mean():.3f} +/- {leaky.std():.3f}")
print(f"1 select-inside-CV accuracy {clean.mean():.3f} +/- {clean.std():.3f}   (chance = 0.5)")

# 2. Target leakage: one extra column recorded after the outcome (a noisy copy of y)
X2, y2 = make_classification(n_samples=2_000, n_features=10, n_informative=3,
                             flip_y=0.2, random_state=0)
proxy = y2 + rng.normal(0, 0.3, len(y2))
base = cross_val_score(LogisticRegression(), X2, y2, cv=cv).mean()
with_proxy = cross_val_score(LogisticRegression(), np.c_[X2, proxy], y2, cv=cv).mean()
print(f"2 legitimate features {base:.3f}   + post-outcome column {with_proxy:.3f}")

# 3. Duplicate leakage: every row stored 3 times (same id), 1-nearest-neighbour model
ids = np.repeat(np.arange(len(y2)), 3)
X3, y3 = X2[ids], y2[ids]
knn = KNeighborsClassifier(n_neighbors=1)
dup = cross_val_score(knn, X3, y3, cv=cv).mean()
grp = cross_val_score(knn, X3, y3, cv=GroupKFold(n_splits=5), groups=ids).mean()
uniq = cross_val_score(knn, X2, y2, cv=cv).mean()
print(f"3 1-NN: duplicates across folds {dup:.3f}   grouped by id {grp:.3f}   de-duplicated {uniq:.3f}")

# 4. Temporal leakage: a random walk, the only feature is the time index
t = np.arange(1_000).reshape(-1, 1)
walk = np.cumsum(rng.normal(0, 1, 1_000))
rf = RandomForestRegressor(n_estimators=100, random_state=0)
shuf = cross_val_score(rf, t, walk, cv=cv, scoring="r2")
fwd = cross_val_score(rf, t, walk, cv=TimeSeriesSplit(n_splits=5), scoring="r2")
print(f"4 R^2 shuffled KFold {shuf.mean():.3f}   TimeSeriesSplit {fwd.mean():.3f}  folds {np.round(fwd, 2)}")
```
</details>

Reading it line by line:
1. **Preprocessing.** Labels are coin flips, so no method can beat 0.5 on new data. Selecting features before cross-validation reports 0.840; the same selector inside the pipeline reports 0.500. scikit-learn's own version of this demo (a single split, a gradient-boosting model) shows 0.76 versus 0.5 ✅[^1].
2. **Target.** Ten legitimate features reach 0.640 (the labels carry 20% noise). A column that is the label plus noise, the stand-in for "recorded after the outcome", lifts that to 0.950. At prediction time the column does not exist yet, so 0.950 is unreachable.
3. **Duplicates.** A 1-nearest-neighbour model on triplicated rows scores 0.988, because almost every test row has an identical twin in training and copies the twin's label, noise included. Keeping the three copies in one fold (`GroupKFold`) gives 0.714, the same as on the de-duplicated table (0.710): the honest number.
4. **Time.** On a random walk the time index alone "predicts" the value with R² 0.997 under shuffled K-fold: every test day sits between two training days with almost the same value. Tested on the future, R² is −0.538 (worse than predicting the mean), and the fourth fold reaches −2.49 when the walk moves outside the range seen in training. Trees give piecewise-constant predictions and so are poor at extrapolation ✅[^8].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Scaling, imputation or PCA (principal component analysis) on all rows before the split | Leak: test-row statistics shape the training features | The leakage risk applies to almost all transformations, `StandardScaler`, `SimpleImputer` and `PCA` included ✅[^1] |
| Oversampling (for example SMOTE, Synthetic Minority Over-sampling Technique) before the split | Synthetic copies of training rows sit in the test set; the test set no longer has the real class ratio | ✅[^2] ✅[^6]; fix inside the pipeline (`machine-learning/evaluation/class-imbalance.md`) |
| Hyperparameters tuned on the test set | The test score is optimistic: knowledge of the test set leaks into the model | ✅[^4]; nested search in `machine-learning/evaluation/cross-validation-and-hyperparameter-search.md` |
| The same test set reused for many decisions | It "wears out": confidence in the score drops with each use | ✅[^3]; refresh it with new data ✅[^3] |
| Several rows per patient, user or device | Shuffled K-fold measures performance on known units, not new ones | Non-independence ✅[^2]; group splitters ✅[^4] |
| Test data from one site, claim about all sites | Overoptimistic: sampling bias, the third family | Pneumonia models trained on one hospital's images did not generalize to another hospital's (Zech et al., cited by Kapoor & Narayanan) ✅[^2] |
| Mean target per category computed on all rows | Target leakage through an encoder | Cross-fitting in `machine-learning/data-and-features/categorical-and-missing-data.md` |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `Pipeline` for every fitted step | Each cross-validation (CV) fold refits the whole chain on its own training rows ✅[^1] | Custom steps must follow the fit/transform interface |
| Manual "split first, fit on train only" | No framework needed ✅[^1] | One forgotten `fit_transform` leaks; does not extend to CV folds by itself |
| Forward-chaining time splits | Tests the real task, predicting the future ✅[^5] | Early folds train on little data: each training set only grows by one fold ✅[^5] |
| Group splits | Tests generalization to unseen units ✅[^4] | Needs a reliable unit id; folds can differ in size ✅[^4] |

## Takeaways
- Split before any `fit`; put every fitted step (scaling, imputation, selection, resampling, encoding) inside a `Pipeline` that cross-validation refits. [rule-candidate]
- For each feature, write down when it becomes known; drop any that only exist after the outcome. [rule-candidate]
- Time-ordered data gets time-ordered validation; repeated units get group splits; duplicates are removed before splitting. [rule-candidate]
- Treat a surprisingly good score as a leak until shown otherwise, and confirm it on data collected later.

## Verification status
- Verified: 41 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- [Common pitfalls and recommended practices (User Guide 12)](https://scikit-learn.org/stable/common_pitfalls.html) — scikit-learn developers, living (1.9.1 docs). Backs: leakage definition and consequence, never fit on test data, split first, the transformations at risk, the feature-selection demo (0.76 vs 0.5), pipelines refit per fold. [^1]
- [Leakage and the Reproducibility Crisis in ML-based Science](https://arxiv.org/html/2207.07048v1) — Kapoor & Narayanan, 2022 (v1). Backs: survey numbers, leakage taxonomy (clean separation, illegitimate features, test distribution), oversampling before the split, duplicates, the hypertension proxy, temporal leakage, non-independence, sampling bias example. [^2]
- [Datasets: Dividing the original dataset](https://developers.google.com/machine-learning/crash-course/overfitting/dividing-datasets?hl=en) — Google Machine Learning Crash Course, living. Backs: delete duplicates of training rows from validation and test sets, the 99%-precision duplicate example, test sets wear out. [^3]
- [Cross-validation: evaluating estimator performance (User Guide 3.1)](https://scikit-learn.org/stable/modules/cross_validation.html) — scikit-learn developers, living. Backs: tuning on the test set leaks, KFold assumes independent, identically distributed data, shuffling time-ordered news inflates scores, group splitters. [^4]
- [sklearn.model_selection.TimeSeriesSplit](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html) — scikit-learn developers, living. Backs: first k folds train, fold k + 1 tests, `gap`, growing training sets. [^5]
- [Common pitfalls and recommended practices (imbalanced-learn)](https://imbalanced-learn.org/stable/common_pitfalls.html) — imbalanced-learn developers, living. Backs: resampling before the split leaks and balances the test set; leaky CV 0.724 vs left-out 0.698. [^6]
- `machine-learning/lab-setup.md` — the lab where the four leakage demonstrations ran on 2026-11-24. [^7]
- [Decision Trees (User Guide 1.10)](https://scikit-learn.org/stable/modules/tree.html) — scikit-learn developers, living. Backs: piecewise-constant predictions, poor extrapolation. [^8]

## Related
- `machine-learning/evaluation/cross-validation-and-hyperparameter-search.md` — splitters, group and time-series folds, nested search.
- `machine-learning/data-and-features/preprocessing-and-pipelines.md` — fit on train only with `Pipeline` and `ColumnTransformer`.
- `machine-learning/data-and-features/categorical-and-missing-data.md` — target encoding without leaking the target.
- `machine-learning/foundations/generalization-and-overfitting.md` — train, validation and test sets.
- `machine-learning/ml-systems/data-drift-and-monitoring.md` — training–serving skew, the production cousin of leakage.
