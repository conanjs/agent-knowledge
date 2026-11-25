---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/data-and-features
status: verified
applies-to: ["scikit-learn 1.9.1"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [machine-learning, categorical-features, one-hot-encoding, ordinal-encoding, target-encoding, cross-fitting, missing-values, imputation, missing-indicator, scikit-learn]
---

# Categorical and missing data: one-hot, ordinal and target encoding, imputation and missing indicators

## Summary
**TL;DR:** Most models need every input to be a number. One-hot encoding gives each category its own 0/1 column; ordinal encoding gives each category an integer, which invents an order; target encoding replaces each category by a shrunken average of the target seen with it, and must be cross-fitted on the training data or the model learns from the answers. Missing values are filled in by an imputer (mean, median, a constant, or a model of the other columns), and when the fact that a value is missing carries information, a missing-indicator column keeps it. Tree ensembles such as `HistGradientBoosting` accept missing values and categories natively.
**Use this when:** a table has text categories (city, product id, zip code), a column has many distinct values, a model rejects `NaN` (not a number, the floating-point missing-value marker), or you wonder whether to drop, fill or flag missing values.
**Not this doc:** scaling and how encoders sit inside a `Pipeline` → `machine-learning/data-and-features/preprocessing-and-pipelines.md`; target leakage in general → `machine-learning/evaluation/data-leakage.md`.

## Problem
In one lab dataset (5,000 rows, a 500-level category that drives the target, plus a 2,500-level category of pure noise) ✅[^6]:
- **Integer codes as numbers** score at chance: ordinal codes into a logistic regression reach 0.500 test accuracy ✅[^6]; such a model reads the arbitrary codes as an order ✅[^1].
- **One-hot on many levels** works but builds 2,386 columns from two input columns ✅[^6]; one-hot encoding of high-cardinality features inflates the feature space ✅[^1].
- **Target encoding fitted naively** overfits: 0.894 on training rows, 0.607 on test rows, against 0.722 when cross-fitted ✅[^6].

Missing values add a second trap: most estimators assume every value is a meaningful number, and dropping incomplete rows throws data away ✅[^2]. Filling with the mean also erases the fact that a value was missing; when missingness tracks the target, that fact is the signal (lab: 0.752 accuracy without an indicator, 0.810 with one) ✅[^6].

## Mental model
**Analogy:** a translator turning words into numbers for a calculator. One-hot gives each word its own light switch. Ordinal numbers the words alphabetically, and the calculator then believes `c > b > a`. Target encoding writes next to each word "on average, rows with this word had outcome 0.6", which is like a student building a cheat sheet of answers: honest when it is compiled from other students' tests (other folds), cheating when it comes from his own test. A missing indicator is a sticky note "this box was blank" next to the guess that filled it.

**Artifact:** the same six-row column encoded three ways, with the target encoding recomputed by hand. Lab run (`machine-learning/lab-setup.md`), 2026-11-24, scikit-learn 1.9.1, two runs identical ✅[^6]:

```text
one-hot : [[1.0, 0.0, 0.0], [1.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]]
ordinal : [0.0, 0.0, 0.0, 1.0, 1.0, 2.0]
target  : [0.6, 0.25, 0.6667] by hand: [0.6, 0.25, 0.6667]
unseen category 'z' -> [0.5] = target_mean_ 0.5
```

<details><summary>Full script (prints the output above)</summary>

```python
import numpy as np
import pandas as pd
from sklearn.preprocessing import OneHotEncoder, OrdinalEncoder, TargetEncoder

X = pd.DataFrame({"city": ["a", "a", "a", "b", "b", "c"]})
y = np.array([1, 1, 0, 0, 0, 1])
print("one-hot :", OneHotEncoder(sparse_output=False).fit_transform(X).tolist())
print("ordinal :", OrdinalEncoder().fit_transform(X).ravel().tolist())
te = TargetEncoder(smooth=2.0).fit(X, y)            # fit() learns one encoding per category
m, g = 2.0, y.mean()                                # smoothing m, global mean of y
by_hand = []
for c in ["a", "b", "c"]:
    yc = y[X["city"] == c]
    lam = len(yc) / (m + len(yc))                   # shrinkage: more rows -> trust the category mean more
    by_hand.append(lam * yc.mean() + (1 - lam) * g)
print("target  :", te.encodings_[0].round(4).tolist(), "by hand:", np.round(by_hand, 4).tolist())
print("unseen category 'z' ->", te.transform(pd.DataFrame({"city": ["z"]})).ravel().tolist(),
      "= target_mean_", te.target_mean_)
```
</details>

## How it works
### Encoding categories
1. **Ordinal:** `OrdinalEncoder` maps each category of a feature to one integer from 0 to `n_categories − 1` ✅[^1]. Estimators that expect continuous input then treat the categories as ordered, which is often not wanted ✅[^1]; keep it for categories whose order is real (small < medium < large).
2. **One-hot:** `OneHotEncoder` turns a feature with `n_categories` values into `n_categories` binary columns, exactly one of them 1 ✅[^1]. `drop='first'` keeps `n_categories − 1` columns, which avoids collinearity for an unregularized `LinearRegression` ✅[^1]. `min_frequency` and `max_categories` group rare categories into one "infrequent" column ✅[^1].
3. **Target encoding formula** (binary target), from the scikit-learn guide ✅[^1]:
   ```text
   S_i = λ_i · (n_iY / n_i) + (1 − λ_i) · (n_Y / n)        λ_i = n_i / (m + n_i)
   ```
   `S_i` is the encoding of category `i`; `n_i` its row count; `n_iY` its rows with `y = 1`; `n_Y / n` the global share of `y = 1`; `m` the smoothing factor (`smooth`) ✅[^1]. A larger `m` pulls every category towards the global mean; `smooth="auto"` sets `m` by an empirical Bayes estimate from the category's and the global variance of `y` ✅[^1]. Worked numbers from the artifact: city `a` has `n_i = 3`, category mean `2/3`, `m = 2`, so `λ = 3/5 = 0.6` and `S = 0.6 · 0.667 + 0.4 · 0.5 = 0.6`; city `c` has one row, so `λ = 1/3` and its encoding `0.667` stays close to the global 0.5 ✅[^6].
4. **Cross fitting:** `TargetEncoder.fit_transform` splits the training data into `k` folds (`cv`, default 5) and encodes each fold with encodings learnt on the other `k − 1` folds, so a row's own target never enters its own encoding ✅[^1]. `fit` alone learns one encoding on the whole training set and is discouraged because it can leak ✅[^1]; `fit(X, y).transform(X)` does not equal `fit_transform(X, y)` ✅[^1]. For an integer `cv` the folds are `KFold` for a continuous target and `StratifiedKFold` otherwise; since 1.9 `cv` also accepts a splitter such as `KFold(5, shuffle=True, random_state=0)` (the worked example passes one), and the `shuffle` and `random_state` parameters are deprecated ✅[^3].
5. **At predict time:** `transform(X_test)` uses the encodings learnt on the full training data (`encodings_`) ✅[^1]. Missing values (`np.nan`, `None`) are encoded as one more category, and categories unseen during `fit` get the target mean (`target_mean_`, 0.5 in the artifact) ✅[^1] ✅[^6].

### Filling missing values
1. **Univariate imputation:** `SimpleImputer` fills a column from that column alone, with a constant or its mean, median or most frequent value ✅[^2].
2. **Multivariate imputation:** `IterativeImputer` models each column with missing values as a function of the others, round-robin, for `max_iter` rounds; it is still experimental and needs an explicit `enable_iterative_imputer` import ✅[^2]. `KNNImputer` averages the value from the `n_neighbors` nearest rows that have it ✅[^2].
3. **Keep the "was missing" fact:** `MissingIndicator`, or `add_indicator=True` on `SimpleImputer` and `IterativeImputer`, appends binary missing-value columns ✅[^2]; in the lab run below, one column for the one feature that had missing values ✅[^6].
4. **No imputation at all:** some estimators accept `NaN`, among them decision trees, random forests and `HistGradientBoosting` ✅[^2]. `HistGradientBoosting` learns at each split whether rows with a missing value go to the left or right child, from the gain; a feature with no missing values in training sends them to the child with more samples ✅[^4].

Lab run (`machine-learning/lab-setup.md`), 2026-11-24, scikit-learn 1.9.1, 4,000 rows: `x1` predicts `y`, the values of `x2` are noise, but `x2` is missing in about half of class 1 and a tenth of class 0; two runs identical ✅[^6]:

```text
share missing in x2: class 0 0.10, class 1 0.53
mean impute                      test accuracy=0.752
mean impute + indicator          test accuracy=0.810
HistGradientBoosting, NaN as is  test accuracy=0.792
columns after imputer: ['x1', 'x2', 'missingindicator_x2'] coef: [1.78, 0.07, 2.49]
```

The indicator column gets the largest weight (2.49) while the imputed `x2` gets almost none (0.07): the model learned from the blank, not from the filled-in value.

<details><summary>Full script (prints the output above)</summary>

```python
import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split
from sklearn.pipeline import make_pipeline

rng = np.random.default_rng(1)
n = 4000
x1, x2 = rng.normal(size=n), rng.normal(size=n)
y = (x1 + rng.normal(size=n) > 0).astype(int)
x2[rng.random(n) < np.where(y == 1, 0.5, 0.1)] = np.nan    # x2's values are noise; its absence is not
X = np.c_[x1, x2]
Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.3, random_state=0)
print(f"share missing in x2: class 0 {np.isnan(x2[y == 0]).mean():.2f}, class 1 {np.isnan(x2[y == 1]).mean():.2f}")
for name, model in [("mean impute", make_pipeline(SimpleImputer(), LogisticRegression())),
                    ("mean impute + indicator", make_pipeline(SimpleImputer(add_indicator=True), LogisticRegression())),
                    ("HistGradientBoosting, NaN as is", HistGradientBoostingClassifier(random_state=0))]:
    print(f"{name:32s} test accuracy={model.fit(Xtr, ytr).score(Xte, yte):.3f}")
ind = make_pipeline(SimpleImputer(add_indicator=True), LogisticRegression()).fit(Xtr, ytr)
print("columns after imputer:", ind[0].get_feature_names_out(["x1", "x2"]).tolist(),
      "coef:", ind[-1].coef_.round(2).tolist()[0])
```
</details>

### Native categories in HistGradientBoosting
`categorical_features` (a mask, indices, column names, or `"from_dtype"` for pandas categorical columns) makes the model split on unordered categories directly; this is often better than one-hot, which needs deeper trees for the same split, and than ordinal codes, which impose an order ✅[^4]. Each such feature must have fewer categories than `max_bins` ✅[^4]. It sorts the categories once and then tries only `K − 1` splits instead of `2^(K−1) − 1` partitions ✅[^4]; for `K = 10` categories that is 9 candidate splits instead of 511. The User Guide names the sort key as the variance of the target per category ✅[^4], but the 1.9.1 source sorts by each category's `sum_gradients / (sum_hessians + 10)`, a smoothed mean gradient, and leaves categories with too little support out of the scan ✅[^7].

## Worked example
The 500-level informative category and the 2,500-level noise category from the Problem section, 3,500 training rows and 1,500 test rows, each encoder feeding the same logistic regression. Core lines:

```python
pipe = make_pipeline(TargetEncoder(cv=KFold(5, shuffle=True, random_state=0)), lr).fit(Xtr, ytr)
te = TargetEncoder().fit(Xtr, ytr)                   # no cross fitting: encodes Xtr with its own targets
lr_nocf = LogisticRegression(max_iter=1000).fit(te.transform(Xtr), ytr)
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-24, scikit-learn 1.9.1, pandas 3.1.1, two runs identical ✅[^6]:

```text
one-hot                columns= 2386 train=0.877 test=0.722
ordinal                columns=    2 train=0.536 test=0.500
target, cross-fitted   columns=    2 train=0.752 test=0.722
target, NOT cross-fit  columns=    2 train=0.894 test=0.607
coef [informative, near_unique]: cross-fitted [3.15, -0.25] not cross-fitted [5.61, 7.44]
```

Reading it:
- **One-hot** reaches 0.722 test with 2,386 columns: one per level seen in training, most of them noise levels.
- **Ordinal** stays at chance (0.500): a single slope over arbitrary codes cannot express 500 separate effects.
- **Cross-fitted target encoding** matches one-hot's 0.722 with 2 columns, and gives the noise column a near-zero weight (−0.25).
- **Target encoding without cross fitting** scores highest on training rows (0.894) and lowest on test rows (0.607). A noise level seen in about 2 rows gets an encoding close to those rows' own targets ✅[^1], so the encoding of `near_unique` looks predictive in training; the model puts its largest weight (7.44) on it. The `Pipeline` used `fit_transform` and was protected; calling `fit` then `transform` on the same rows was not ✅[^5].

<details><summary>Full script (prints the output above)</summary>

```python
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import KFold, train_test_split
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import OneHotEncoder, OrdinalEncoder, TargetEncoder

rng = np.random.default_rng(0)
n, k = 5000, 500
effect = rng.normal(0, 1.5, k)                       # each of 500 levels has its own true effect
level = rng.integers(0, k, n)                        # about 10 rows per level
noise = rng.integers(0, 2500, n)                     # about 2 rows per level, unrelated to y
y = (rng.random(n) < 1 / (1 + np.exp(-effect[level]))).astype(int)
df = pd.DataFrame({"informative": level.astype(str), "near_unique": noise.astype(str)})
Xtr, Xte, ytr, yte = train_test_split(df, y, test_size=0.3, random_state=0)

lr = LogisticRegression(max_iter=1000)
for name, enc in [("one-hot", OneHotEncoder(handle_unknown="ignore")),
                  ("ordinal", OrdinalEncoder(handle_unknown="use_encoded_value", unknown_value=-1)),
                  ("target, cross-fitted", TargetEncoder(cv=KFold(5, shuffle=True, random_state=0)))]:
    pipe = make_pipeline(enc, lr).fit(Xtr, ytr)      # Pipeline.fit calls enc.fit_transform
    width = pipe[0].transform(Xtr.head(1)).shape[1]
    print(f"{name:22s} columns={width:5d} train={pipe.score(Xtr, ytr):.3f} test={pipe.score(Xte, yte):.3f}")
te = TargetEncoder().fit(Xtr, ytr)                   # fit() then transform(): no cross fitting
lr_nocf = LogisticRegression(max_iter=1000).fit(te.transform(Xtr), ytr)
print(f"{'target, NOT cross-fit':22s} columns={2:5d} train={lr_nocf.score(te.transform(Xtr), ytr):.3f} "
      f"test={lr_nocf.score(te.transform(Xte), yte):.3f}")
cf = make_pipeline(TargetEncoder(cv=KFold(5, shuffle=True, random_state=0)), lr).fit(Xtr, ytr)
print("coef [informative, near_unique]: cross-fitted", cf[-1].coef_.round(2).tolist()[0],
      "not cross-fitted", lr_nocf.coef_.round(2).tolist()[0])
```
</details>

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Category unseen in training, `TargetEncoder` | Encoded as the training target mean | ✅[^1]; lab: `'z'` → 0.5 ✅[^6] |
| Category unseen in training, `HistGradientBoosting` native categories | Treated as a missing value | ✅[^4] |
| `np.nan` in a column given to `OneHotEncoder` | Becomes its own category; `np.nan` and `None` in one feature are two separate categories | ✅[^1] |
| `np.nan` given to `OrdinalEncoder` | Passed through as `NaN`, or set with `encoded_missing_value=-1` | ✅[^1] |
| Target encoding a near-unique id column without cross fitting | Train score up, test score down (lab: 0.894 / 0.607) | Each id's encoding is mostly its own row's target ✅[^1] ✅[^6] |
| Same mistake in the scikit-learn example | Ridge R² (coefficient of determination, 1 = perfect) 0.86 on train and 0.63 on test, against 0.80 and 0.79 with cross fitting | Weight moved to the uninformative high-cardinality features ✅[^5] |
| Missingness depends on the target | Mean imputation hides the signal; an indicator recovers it (lab: 0.752 → 0.810) | ✅[^6]; preserving which values were missing can be informative ✅[^2] |
| Passing `NaN` to a model not on the NaN-capable list (for example `LogisticRegression`) | Error at `fit` | Only listed estimators accept `NaN` ✅[^2] |
| More categories than `max_bins` with native support | Not allowed | Cardinality must be below `max_bins` ✅[^4] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| One-hot | No invented order; works with any model ✅[^1] | One column per category; wide and sparse on high cardinality ✅[^1] |
| Ordinal | One column; suits categories with a real order | Linear and distance models read a false order ✅[^1]; lab: chance accuracy ✅[^6] |
| Target encoding (cross-fitted) | One column per feature (per class for multiclass) even for zip-code-like features ✅[^1] | Must use `fit_transform` on training data; leaks if misused ✅[^1] |
| `HistGradientBoosting` native categories and `NaN` | No encoder or imputer needed ✅[^4] | Tied to one model family; cardinality capped by `max_bins` ✅[^4] |
| Drop incomplete rows | Simplest | Loses data that may be valuable ✅[^2] |
| Mean or median imputation | Fast, univariate ✅[^2] | Erases the missingness signal unless an indicator is added ✅[^6] |
| `IterativeImputer` | Uses the other columns ✅[^2] | Experimental: defaults may change without deprecation ✅[^2] |

## Takeaways
- Never feed integer category codes to a linear or distance-based model unless the order is real. [rule-candidate]
- Use `TargetEncoder` only through `fit_transform` on training data, ideally inside a `Pipeline`; never `fit` then `transform` the same rows. [rule-candidate]
- When values can be missing for a reason, add a missing indicator next to the imputed column.
- For tree ensembles on tabular data, try `HistGradientBoosting` with native categories and `NaN` before building an encoding pipeline.

## Verification status
- Verified: 66 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- [Preprocessing data (User Guide 8.3)](https://scikit-learn.org/stable/modules/preprocessing.html) — scikit-learn developers, living (1.9.1). Backs: `OrdinalEncoder`, `OneHotEncoder` (drop, infrequent categories, missing values), `TargetEncoder` formula, smoothing, cross fitting, unseen and missing categories, high-cardinality motivation. [^1]
- [Imputation of missing values (User Guide 8.4)](https://scikit-learn.org/stable/modules/impute.html) — scikit-learn developers, living (1.9.1). Backs: discarding rows loses data, `SimpleImputer`, `IterativeImputer` (experimental), `KNNImputer`, `MissingIndicator` and `add_indicator`, the list of estimators that accept `NaN`. [^2]
- [TargetEncoder (API reference)](https://scikit-learn.org/stable/modules/generated/sklearn.preprocessing.TargetEncoder.html) — scikit-learn developers, living (1.9.1). Backs: `cv` default 5, `KFold` vs `StratifiedKFold` for an integer `cv`, splitters accepted since 1.9, `shuffle` and `random_state` deprecated. [^3]
- [Target Encoder's Internal Cross fitting (example)](https://scikit-learn.org/stable/auto_examples/preprocessing/plot_target_encoder_cross_val.html) — scikit-learn developers, living (1.9.1). Backs: pipeline uses `fit_transform`, ridge scores with and without cross fitting. [^5]
- [Ensembles: histogram-based gradient boosting (User Guide 1.11.1)](https://scikit-learn.org/stable/modules/ensemble.html) — scikit-learn developers, living (1.9.1). Backs: native missing-value handling per split, native categorical support, `max_bins` limit, unseen categories as missing, `K − 1` split search. [^4]
- `machine-learning/lab-setup.md` — the lab where the three encodings, the high-cardinality encoder comparison and the missing-indicator comparison ran on 2026-11-24. [^6]
- [sklearn/ensemble/_hist_gradient_boosting/splitting.pyx at tag 1.9.1](https://github.com/scikit-learn/scikit-learn/blob/1.9.1/sklearn/ensemble/_hist_gradient_boosting/splitting.pyx) — scikit-learn developers, living (source file at tag 1.9.1). Backs: categorical split search sorts categories by `sum_gradients / (sum_hessians + MIN_CAT_SUPPORT)` with `MIN_CAT_SUPPORT = 10` and drops low-support categories from the scan. [^7]

## Related
- `machine-learning/data-and-features/preprocessing-and-pipelines.md` — `ColumnTransformer` and `Pipeline`, where these encoders and imputers live.
- `machine-learning/data-and-features/feature-importance-and-selection.md` — how high-cardinality columns also bias impurity importances.
- `machine-learning/evaluation/data-leakage.md` — target leakage beyond encoders.
- `machine-learning/supervised-learning/tree-ensembles.md` — histogram gradient boosting itself.
- `machine-learning/probabilistic-ml/bayesian-inference.md` — shrinkage towards a prior mean, the idea behind the smoothing factor.
