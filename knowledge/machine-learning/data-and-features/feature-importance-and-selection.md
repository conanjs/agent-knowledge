---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/data-and-features
status: verified
applies-to: ["scikit-learn 1.9.1"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [machine-learning, feature-importance, permutation-importance, mdi, gini-importance, random-forest, feature-selection, rfe, lasso, scikit-learn]
---

# Feature importance and selection: impurity vs permutation importance, correlated features, univariate, RFE and L1 selection

## Summary
**TL;DR:** A tree model's built-in `feature_importances_` (MDI, mean decrease in impurity) counts how much each feature reduced impurity while the trees were being grown on the training data, so it can rank pure noise highly, especially noise with many distinct values. Permutation importance shuffles one column of a held-out set and measures how much the model's score drops; it works for any model, and a noise feature scores near zero. Both mislead on correlated features, because the model can lean on the twin. Feature selection (univariate tests, RFE (recursive feature elimination), L1 sparsity) is a learned step too and must be fitted inside cross-validation.
**Use this when:** you report "the most important features" of a model, decide which columns to drop, or see a random-looking column near the top of an importance plot.
**Not this doc:** how trees and forests are grown → `machine-learning/supervised-learning/decision-trees.md`, `machine-learning/supervised-learning/tree-ensembles.md`; how L1 produces zero weights → `machine-learning/foundations/regularization.md`; selection leakage in evaluation → `machine-learning/evaluation/data-leakage.md`.

## Problem
"Which features matter?" has three common wrong answers:
- **Reading `feature_importances_` off a forest.** In the lab, a random forest gives a pure-noise numeric column an MDI of 0.087, about 4.6 times the 0.019 of a 3-valued noise column, while both are useless on test data ✅[^7]. The scikit-learn guide warns that impurity importances come from training-set statistics and favour high-cardinality features ✅[^2].
- **Trusting importance on correlated features.** Adding a near-copy of a feature cuts its MDI from 0.212 to 0.126 and its permutation importance from 0.126 to 0.052, though the information in the data is unchanged ✅[^7].
- **Selecting features on all the data, then evaluating.** On random labels, selecting the 25 best features before the train/test split gave 0.76 test accuracy in the scikit-learn pitfalls example, against the expected 0.5 when selection was fitted on training data only ✅[^6].

## Mental model
**Analogy:** two ways to judge which witnesses a jury relied on. MDI counts how much each witness talked during the trial, including those who only made things up, and talkative witnesses with many stories (many distinct values) get more chances to sound useful. Permutation importance re-runs the verdict with one witness's statements shuffled into nonsense and measures how much worse the verdict gets on new cases. If two witnesses tell the same story, silencing either one changes little, so both look unimportant.

**Artifact:** permutation importance computed by hand on a held-out set, next to scikit-learn's `permutation_importance`; the shuffles differ, so the numbers agree only up to their spread. Lab run (`machine-learning/lab-setup.md`), 2026-11-24, scikit-learn 1.9.1, random forest on 3 informative features, two runs identical ✅[^7]:

```text
x0: by hand 0.127 ± 0.013   sklearn 0.126 ± 0.006
x1: by hand 0.090 ± 0.006   sklearn 0.094 ± 0.008
x2: by hand 0.293 ± 0.015   sklearn 0.283 ± 0.015
reference accuracy s = 0.891
```

<details><summary>Full script (prints the output above)</summary>

```python
import numpy as np
from sklearn.datasets import make_classification
from sklearn.ensemble import RandomForestClassifier
from sklearn.inspection import permutation_importance
from sklearn.model_selection import train_test_split

X, y = make_classification(n_samples=2000, n_features=3, n_informative=3, n_redundant=0,
                           n_clusters_per_class=1, flip_y=0.1, random_state=0)
Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.5, random_state=0)
rf = RandomForestClassifier(n_estimators=200, random_state=0).fit(Xtr, ytr)

rng = np.random.default_rng(0)
s = rf.score(Xte, yte)                                   # reference score on held-out rows
r = permutation_importance(rf, Xte, yte, n_repeats=10, random_state=0)
for j in range(3):
    drops = []
    for _ in range(10):                                  # K = 10 repetitions
        Xp = Xte.copy()
        Xp[:, j] = rng.permutation(Xp[:, j])             # break the link between column j and y
        drops.append(s - rf.score(Xp, yte))
    print(f"x{j}: by hand {np.mean(drops):.3f} ± {np.std(drops):.3f}", end="   ")
    print(f"sklearn {r.importances_mean[j]:.3f} ± {r.importances_std[j]:.3f}")
print(f"reference accuracy s = {s:.3f}")
```
</details>

## How it works
### Impurity importance (MDI)
1. **Collect:** each split in a tree reduces the impurity criterion (Gini, log loss or MSE (mean squared error)) ✅[^1]. scikit-learn combines the fraction of samples a feature's splits reach with the impurity decrease they produce, averages over the trees of the forest, and stores the result in `feature_importances_`, positive values that sum to 1.0 ✅[^2].
2. **Flaw 1, training data:** the statistics come from the training set, so a feature the model used to overfit still gets credit ✅[^2]; in the scikit-learn example, a forest with training accuracy 1.000 gives a random column non-zero importance ✅[^3].
3. **Flaw 2, cardinality:** a feature with many unique values offers many split points, and impurity importance favours such features ✅[^2]. Strobl et al. found, simulating R's `randomForest` with random features that carry no signal, that Gini importance strongly prefers continuous variables and categorical variables with many categories, and traced this to biased split selection in the trees and to bootstrap sampling with replacement ✅[^4].

### Permutation importance
1. **Reference:** score the fitted model `m` on a dataset `D` (ideally held out): `s` ✅[^1]. In the artifact, `s = 0.891` accuracy.
2. **Corrupt one column:** for each feature `j` and each repetition `k = 1…K`, shuffle column `j` of `D` and score again: `s_kj` ✅[^1].
3. **Importance:** `i_j = s − (1/K) · Σ_k s_kj`, the reference score minus the mean corrupted score ✅[^1]. In the artifact, shuffling `x2` drops accuracy by 0.293 on average, so the mean shuffled score is `0.891 − 0.293 = 0.598` ✅[^7].
4. **What it answers:** how much this model relies on the feature for this metric; it is model-agnostic, the repetitions give a spread, and the value depends on the chosen `scoring` ✅[^1]. A feature unimportant for a bad model can matter for a good one, so check the model's held-out score first ✅[^1].
5. **Train vs held-out:** the guide warns that a feature important on the training set but not on held-out data might cause the model to overfit ✅[^1].
6. **Correlated features:** with two correlated features, shuffling one leaves the model the other, so both report lower importance though they may matter ✅[^1]. One remedy is to cluster correlated features and keep one per cluster ✅[^1].

### Selecting features
1. **Variance filter:** `VarianceThreshold` drops features whose variance is below a threshold, by default only constant features ✅[^5].
2. **Univariate tests:** `SelectKBest` and `SelectPercentile` keep the best-scoring features under a test such as `f_classif` (an F-test, linear dependency only), `chi2` (only for non-negative features such as counts) or `mutual_info_classif` (any dependency, but needs more samples) ✅[^5]. Each feature is judged alone ✅[^5], so a feature useful only in combination can be missed (lab below: column 3) ✅[^7].
3. **RFE:** fit the model, rank features by `coef_` or `feature_importances_`, drop the weakest, refit, until the requested number remains; `RFECV` picks that number by cross-validation ✅[^5].
4. **Model-based:** `SelectFromModel` keeps features whose importance is above a threshold such as `"mean"` or `"median"` ✅[^5]. With an L1-penalized model many coefficients are exactly zero; for logistic regression and linear SVMs (support vector machines) a smaller `C` selects fewer features, for Lasso a larger `alpha` does ✅[^5]. In scikit-learn 1.9.1, `LogisticRegression` takes the L1 penalty as `l1_ratio=1`; its `penalty` parameter was deprecated in 1.8 ✅[^8].
5. **Sequential:** `SequentialFeatureSelector` adds (forward) or removes (backward) one feature at a time, greedily, by cross-validated score ✅[^5].
6. **Fit it like a model:** selection learns from `y`, so it belongs inside a `Pipeline` that cross-validation refits per fold ✅[^6].

Lab run (`machine-learning/lab-setup.md`), 2026-11-24, scikit-learn 1.9.1, 500 rows, 20 features of which columns 0–3 are informative, two runs identical ✅[^7]:

```text
SelectKBest(f_classif, k=4)            keeps columns [0, 1, 2, 6]
RFE(logistic, 4 features)              keeps columns [0, 1, 2, 3]
SelectFromModel(L1 logistic, C=0.05)   keeps columns [0, 1, 2, 3, 6]
F-test score: col 3 = 0.01 p = 0.91 | col 6 = 6.33 p = 0.012
```

Informative column 3 has no linear relation with `y` on its own (F = 0.01), so the univariate filter swaps it for noise column 6, which happens to score 6.33 in this sample; the two model-based selectors, which judge features jointly, keep column 3.

<details><summary>Full script (prints the output above)</summary>

```python
import numpy as np
from sklearn.datasets import make_classification
from sklearn.feature_selection import RFE, SelectFromModel, SelectKBest, f_classif
from sklearn.linear_model import LogisticRegression

# 20 features; with shuffle=False the informative ones are columns 0-3, the rest are noise
X, y = make_classification(n_samples=500, n_features=20, n_informative=4, n_redundant=0,
                           shuffle=False, random_state=0)
selectors = {
    "SelectKBest(f_classif, k=4)": SelectKBest(f_classif, k=4),
    "RFE(logistic, 4 features)": RFE(LogisticRegression(), n_features_to_select=4),
    "SelectFromModel(L1 logistic, C=0.05)": SelectFromModel(
        LogisticRegression(l1_ratio=1.0, solver="liblinear", C=0.05)),
}
for name, sel in selectors.items():
    print(f"{name:38s} keeps columns {np.flatnonzero(sel.fit(X, y).get_support()).tolist()}")
F, p = f_classif(X, y)
print("F-test score: col 3 =", F[3].round(2), "p =", p[3].round(3), "| col 6 =", F[6].round(2), "p =", p[6].round(3))
```
</details>

## Worked example
Three informative features plus two noise columns, `random_num` (a fresh normal value per row) and `random_cat` (0, 1 or 2), like the scikit-learn gallery example but on synthetic data; a 200-tree random forest on 1,000 training rows, scored on 1,000 test rows. Then `x0` gets a near-copy `x0_copy = x0 + noise(0.01)`. Lab run (`machine-learning/lab-setup.md`), 2026-11-24, scikit-learn 1.9.1, two runs identical ✅[^7]:

```text
RF accuracy: train=1.000 test=0.895
feature        MDI  perm(train)       perm(test)
x0           0.166        0.166     0.106 ± 0.006
x1           0.175        0.156     0.072 ± 0.007
x2           0.553        0.382     0.304 ± 0.012
random_num   0.087        0.054     0.002 ± 0.003
random_cat   0.019        0.025     0.003 ± 0.002
without copy: MDI x0 0.212 perm x0 0.126
with copy   : MDI x0 0.126 x0_copy 0.125 | perm x0 0.052 x0_copy 0.051
```

Reading it:
- **The model memorized the training set** (accuracy 1.000) but still generalizes (0.895), the same situation as the gallery example (1.000 and 0.814) ✅[^3].
- **MDI:** `random_num` gets 0.087, half of `x0`'s 0.166 and 4.6 times `random_cat`'s 0.019: same uselessness, more distinct values, more credit, as in the gallery example where `random_num` ranks among the most important features ✅[^3].
- **Permutation on training rows:** `random_num` still gets 0.054, because the forest used it to memorize those rows; on test rows it drops to 0.002 ± 0.003, indistinguishable from zero, as do both random features in the gallery example ✅[^3].
- **The ranking of real features shifts too:** MDI puts `x1` (0.175) above `x0` (0.166); held-out permutation puts `x0` (0.106) clearly above `x1` (0.072).
- **Correlated copy:** the twins share `x0`'s MDI almost equally (0.126 and 0.125), and each twin's permutation importance falls to about 0.05: shuffling one twin costs little while the other remains ✅[^1]. Neither sum gives back `x0`'s original value: the MDIs add up to 0.251 (more than 0.212), the permutation importances to 0.103 (less than 0.126).

<details><summary>Full script (prints the output above)</summary>

```python
import numpy as np
import pandas as pd
from sklearn.datasets import make_classification
from sklearn.ensemble import RandomForestClassifier
from sklearn.inspection import permutation_importance
from sklearn.model_selection import train_test_split

X, y = make_classification(n_samples=2000, n_features=3, n_informative=3, n_redundant=0,
                           n_clusters_per_class=1, flip_y=0.1, random_state=0)
rng = np.random.default_rng(0)
df = pd.DataFrame(X, columns=["x0", "x1", "x2"])
df["random_num"] = rng.normal(size=len(df))          # noise, ~every value unique
df["random_cat"] = rng.integers(0, 3, len(df))       # noise, 3 values
Xtr, Xte, ytr, yte = train_test_split(df, y, test_size=0.5, random_state=0)
rf = RandomForestClassifier(n_estimators=200, random_state=0).fit(Xtr, ytr)
print(f"RF accuracy: train={rf.score(Xtr, ytr):.3f} test={rf.score(Xte, yte):.3f}")
p_tr = permutation_importance(rf, Xtr, ytr, n_repeats=10, random_state=0)
p_te = permutation_importance(rf, Xte, yte, n_repeats=10, random_state=0)
print(f"{'feature':11s} {'MDI':>6s} {'perm(train)':>12s} {'perm(test)':>16s}")
for i, col in enumerate(df.columns):
    print(f"{col:11s} {rf.feature_importances_[i]:6.3f} {p_tr.importances_mean[i]:12.3f} "
          f"{p_te.importances_mean[i]:9.3f} ± {p_te.importances_std[i]:.3f}")

# a near-copy of x0 splits its importance
df2 = df[["x0", "x1", "x2"]].copy()
df2["x0_copy"] = df2["x0"] + rng.normal(scale=0.01, size=len(df2))
Xtr2, Xte2 = df2.iloc[Xtr.index], df2.iloc[Xte.index]
base = RandomForestClassifier(n_estimators=200, random_state=0).fit(Xtr2[["x0", "x1", "x2"]], ytr)
rf2 = RandomForestClassifier(n_estimators=200, random_state=0).fit(Xtr2, ytr)
pb = permutation_importance(base, Xte2[["x0", "x1", "x2"]], yte, n_repeats=10, random_state=0)
p2 = permutation_importance(rf2, Xte2, yte, n_repeats=10, random_state=0)
print("without copy: MDI x0", round(base.feature_importances_[0], 3), "perm x0", round(pb.importances_mean[0], 3))
print("with copy   : MDI x0", round(rf2.feature_importances_[0], 3), "x0_copy", round(rf2.feature_importances_[3], 3),
      "| perm x0", round(p2.importances_mean[0], 3), "x0_copy", round(p2.importances_mean[3], 3))
```
</details>

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Noise column with many unique values, MDI | Ranked well above zero (lab: 0.087) | Impurity importance favours high cardinality ✅[^2] ✅[^7] |
| Any noise column, MDI | Non-zero importance | Computed on training statistics ✅[^2] ✅[^3] |
| Permutation importance on training rows | Overfitted features look useful (lab: `random_num` 0.054) | A feature important on train but not on held-out data might cause the model to overfit ✅[^1] ✅[^7] |
| Two strongly correlated features | Both look less important; on the breast cancer data, all features look unimportant | The model still sees the twin ✅[^1] |
| Model with a low held-out score | Its importances say little about the data | Importance is relative to a model; check the score first ✅[^1] |
| Different metrics (R² (coefficient of determination), MAPE (mean absolute percentage error), MSE) | Approximately the same ranking in the guide's diabetes example, but not guaranteed, especially for imbalanced classification | Importance depends on `scoring` ✅[^1] |
| Permutation importance with features of different cardinality (R `randomForest`) | Mean close to zero for noise, but larger spread for variables with more categories | Strobl et al.'s null-case simulations ✅[^4] |
| Univariate selection, feature useful only jointly | Dropped (lab: column 3, F = 0.01) | Each feature is tested alone ✅[^5] ✅[^7] |
| `chi2` on negative-valued features | Not valid | Only for non-negative features such as frequencies ✅[^5] |
| Selection fitted before the split, random labels | 0.76 accuracy instead of about 0.5 | The selector saw the test rows ✅[^6] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| MDI (`feature_importances_`) | Free after training | Training-set statistics; cardinality bias ✅[^2] |
| Permutation importance on held-out data | Any model, any metric, near zero for noise ✅[^1] | One re-scoring per feature per repeat; split credit on correlated features ✅[^1] |
| Univariate selection (`SelectKBest`) | One statistical test per feature ✅[^5] | Misses joint effects; mutual information needs more samples ✅[^5] |
| RFE / `RFECV` | Uses the model's own weights; `RFECV` picks the count ✅[^5] | Refits the model once per elimination round ✅[^5] |
| L1 (`SelectFromModel` on Lasso or L1 logistic) | Selection and fitting in one; `C` or `alpha` sets sparsity ✅[^5] | Recovering the exact true set needs enough samples and not-too-correlated features ✅[^5] |

## Takeaways
- Report permutation importance on held-out data, with its spread, not `feature_importances_`. [rule-candidate]
- Before reading importances, check the model's held-out score; before trusting a low importance, check for correlated twins.
- Fit every feature-selection step inside the cross-validated `Pipeline`. [rule-candidate]
- Importance describes one fitted model, not a causal effect of the feature.

## Verification status
- Verified: 59 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- [Permutation feature importance (User Guide 5.2)](https://scikit-learn.org/stable/modules/permutation_importance.html) — scikit-learn developers, living (1.9.1). Backs: the algorithm and `i_j` formula, model-agnostic, depends on scoring, train vs held-out, bad-model warning, correlated features and clustering, impurity criterion names. [^1]
- [Ensembles: feature importance evaluation (User Guide 1.11.2.5)](https://scikit-learn.org/stable/modules/ensemble.html) — scikit-learn developers, living (1.9.1). Backs: how MDI is computed and normalized, its two flaws. [^2]
- [Permutation Importance vs Random Forest Feature Importance (MDI) (example)](https://scikit-learn.org/stable/auto_examples/inspection/plot_permutation_importance.html) — scikit-learn developers, living (1.9.1). Backs: `random_num` ranked high by MDI, near zero by test-set permutation, higher on the training set; accuracies 1.000 and 0.814. [^3]
- [Bias in random forest variable importance measures: Illustrations, sources and a solution](https://pmc.ncbi.nlm.nih.gov/articles/PMC1796903/) — Strobl, Boulesteix, Zeileis, Hothorn, BMC Bioinformatics, 2007. Backs: Gini importance bias towards continuous and many-category variables, its sources, larger permutation-importance spread for many-category variables. [^4]
- [Feature selection (User Guide 1.13)](https://scikit-learn.org/stable/modules/feature_selection.html) — scikit-learn developers, living (1.9.1). Backs: `VarianceThreshold`, univariate tests, RFE and `RFECV`, `SelectFromModel`, L1 sparsity and `C` / `alpha`, L1 recovery conditions, sequential selection. [^5]
- [Common pitfalls and recommended practices](https://scikit-learn.org/stable/common_pitfalls.html) — scikit-learn developers, living (1.9.1). Backs: feature selection before the split (0.76 vs 0.5), selection inside a pipeline. [^6]
- `machine-learning/lab-setup.md` — the lab where the by-hand permutation importance, the MDI vs permutation comparison, the correlated copy and the three selectors ran on 2026-11-24. [^7]
- [LogisticRegression (API reference)](https://scikit-learn.org/stable/modules/generated/sklearn.linear_model.LogisticRegression.html) — scikit-learn developers, living (1.9.1). Backs: `penalty` deprecated in 1.8, `l1_ratio=1` is a pure L1 penalty. [^8]

## Related
- `machine-learning/supervised-learning/tree-ensembles.md` — random forests and boosting, whose importances this doc reads.
- `machine-learning/foundations/regularization.md` — why L1 sets weights exactly to zero.
- `machine-learning/evaluation/data-leakage.md` — selection and preprocessing leakage.
- `machine-learning/evaluation/cross-validation-and-hyperparameter-search.md` — refitting a selector per fold.
- `machine-learning/data-and-features/categorical-and-missing-data.md` — high-cardinality categories and how to encode them.
