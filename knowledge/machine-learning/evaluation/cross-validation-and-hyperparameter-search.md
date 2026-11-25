---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/evaluation
status: verified
applies-to: ["scikit-learn 1.9.1"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [machine-learning, evaluation, cross-validation, k-fold, stratified, groupkfold, timeseriessplit, nested-cv, grid-search, random-search, successive-halving]
---

# Cross-validation and hyperparameter search

## Summary
**TL;DR:** K-fold cross-validation (CV) trains k models, each tested on the one fold it did not see, and averages the k scores, so every sample is tested once without wasting a fixed validation set. The splitter must mirror how the model will meet new data: stratified folds keep the class ratio, group folds keep every row of one patient or user together, time-series folds always test on the future. Picking the best of many hyperparameter candidates by their CV score makes that best score optimistic, so the performance of "model plus search" needs nested CV. Random search beats a grid of the same size when only a few hyperparameters matter, and successive halving spends most of the budget on the few candidates that survive early rounds.
**Use this when:** you estimate how a model will generalize, choose a `cv=` splitter, tune hyperparameters with `GridSearchCV`, `RandomizedSearchCV` or `HalvingGridSearchCV`, or report a tuned model's score.
**Not this doc:** what train, validation and test sets are and why held-out data matters → `machine-learning/foundations/generalization-and-overfitting.md`; leaks other than the split itself → `machine-learning/evaluation/data-leakage.md`; which metric to put in `scoring=` → `machine-learning/evaluation/classification-metrics.md`.

## Problem
One train/validation split gives one noisy number that depends on which rows landed where, and it shrinks the training set ✅[^1]. A shuffled K-fold on data with several rows per patient, or on a time series, quietly measures something easier than the real task: the lab's random forest scored 0.99 under shuffled folds and 0.43 when whole patients were held out ✅[^7]. Then hyperparameter tuning adds a second trap: the best of 20 candidates' CV scores is partly luck, and on pure-noise data the lab's grid search reported 0.579 accuracy where 0.5 is the truth ✅[^7].

## Mental model
**Analogy:** a cooking school grading a chef. One tasting is luck-prone, so the school holds k tastings, each by a jury that did not watch that dish being cooked (k-fold). If the chef also gets to pick, from 20 recipes, the one the juries liked best, the winning score flatters him: the school needs a second, separate jury that tastes only the final pick (nested CV). And if the chef will cook for strangers, no juror may be a regular customer (group folds).

**Artifact:** nested cross-validation as two loops; the outer loop scores the whole procedure "search, then refit" ✅[^5]:

| Loop | Runs | Job |
|---|---|---|
| Outer 5-fold (`cross_val_score`) | 5 times | Hands 4/5 of the data to the search, then scores the refitted best model on the 1/5 the search never saw |
| Inner 5-fold (`GridSearchCV`) | Inside each outer fold, once per candidate | Scores each (C, gamma) by CV on the outer training part, picks the best, refits it on that part |
| Report | Once | The mean of the 5 outer scores: an estimate for "this model family plus this search" |

## How it works
### K-fold and the splitters
1. **K-fold.** Split the training data into k folds; for each fold, train on the other k − 1 and score on it; report the mean of the k scores ✅[^1]. A final test set should still be held out ✅[^1]. With an integer `cv`, `cross_val_score` uses `StratifiedKFold` for classifiers and `KFold` otherwise, and neither shuffles by default ✅[^1].
2. **k.** Leave-one-out (`k = n`) trains n models, often gives a high-variance error estimate, and most authors and empirical evidence favour 5- or 10-fold CV over it ✅[^1].
3. **Pick the splitter by the data's structure.** Lab run (`machine-learning/lab-setup.md`), 2026-11-24, scikit-learn 1.9.1: the test folds each splitter makes for 12 rows (4 positives, 3 groups interleaved as `0,0,1,1,2,2,0,0,1,1,2,2`), with the count of positives `(n+)` per fold ✅[^7]:

```text
KFold(3)            [0, 1, 2, 3] (0+)  [4, 5, 6, 7] (2+)  [8, 9, 10, 11] (2+)
StratifiedKFold(3)  [0, 1, 2, 4] (1+)  [3, 5, 6, 7] (1+)  [8, 9, 10, 11] (2+)
GroupKFold(3)       [4, 5, 10, 11] (4+)  [2, 3, 8, 9] (0+)  [0, 1, 6, 7] (0+)
TimeSeriesSplit(3)  [3, 4, 5] (2+)  [6, 7, 8] (0+)  [9, 10, 11] (2+)
TimeSeriesSplit(3) train sizes: [3, 6, 9]
KFold(5, shuffle)            accuracy 0.993  folds [1.   0.97 1.   1.   1.  ]
StratifiedKFold(5, shuffle)  accuracy 0.990  folds [1.   1.   1.   0.98 0.98]
GroupKFold(5)                accuracy 0.428  folds [0.57 0.4  0.33 0.28 0.56]
```

<details><summary>Full script (prints the output above)</summary>

```python
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import (GroupKFold, KFold, StratifiedKFold, TimeSeriesSplit,
                                     cross_val_score)

# Part 1: which rows each splitter puts in the test fold (12 rows, 3 groups, 1/3 positives)
y = np.array([0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1])
g = np.array([0, 0, 1, 1, 2, 2, 0, 0, 1, 1, 2, 2])
Xs = np.zeros((12, 1))
splitters = {"KFold(3)": KFold(3), "StratifiedKFold(3)": StratifiedKFold(3),
             "GroupKFold(3)": GroupKFold(3), "TimeSeriesSplit(3)": TimeSeriesSplit(3)}
for name, sp in splitters.items():
    args = (Xs, y, g) if "Group" in name else (Xs, y)
    tests = [te.tolist() for _, te in sp.split(*args)]
    print(f"{name:<19}", "  ".join(f"{te} ({int(y[te].sum())}+)" for te in tests))
print("TimeSeriesSplit(3) train sizes:", [len(tr) for tr, _ in TimeSeriesSplit(3).split(Xs)])

# Part 2: 50 patients x 20 samples; label is per patient, features only identify the patient
rng = np.random.default_rng(0)
n_groups, per = 50, 20
groups = np.repeat(np.arange(n_groups), per)
centers = rng.normal(0, 1, (n_groups, 5))
X = centers[groups] + rng.normal(0, 0.1, (n_groups * per, 5))
yg = rng.integers(0, 2, n_groups)[groups]          # no feature -> label rule exists
rf = RandomForestClassifier(n_estimators=100, random_state=0)
for name, cv in {"KFold(5, shuffle)": KFold(5, shuffle=True, random_state=0),
                 "StratifiedKFold(5, shuffle)": StratifiedKFold(5, shuffle=True, random_state=0),
                 "GroupKFold(5)": GroupKFold(5)}.items():
    s = cross_val_score(rf, X, yg, cv=cv, groups=groups if "Group" in name else None)
    print(f"{name:<28} accuracy {s.mean():.3f}  folds {np.round(s, 2)}")
```
</details>

   - **`KFold`** is not affected by classes or groups ✅[^1]; unshuffled, it cut consecutive blocks in the lab, and its first test fold above has no positive at all ✅[^7].
   - **`StratifiedKFold`** keeps each class's share about the same in every fold ✅[^1] (1, 1 and 2 positives above). It exists to avoid folds without a rare class, which make metrics such as ROC-AUC (area under the receiver operating characteristic curve) undefined, and it can shrink the spread of fold scores below the real uncertainty ✅[^1].
   - **`GroupKFold`** never puts one group in both training and test ✅[^1]: rows 4, 5, 10, 11 (group 2) move together. Use it when rows of one subject are dependent and the question is how the model does on new subjects ✅[^1]; `StratifiedGroupKFold` also tries to keep the class ratio ✅[^1]. In part 2 the label belongs to the patient and the features only identify the patient, so there is nothing to learn about new patients: shuffled K-fold and stratified K-fold report 0.99, group folds report 0.43, the honest "no better than chance".
   - **`TimeSeriesSplit`** trains on the first k folds and tests on fold k + 1, so training sets grow (3, 6, 9 rows) and the test fold is always later ✅[^8]. Shuffled K-fold on time-ordered data is a leak (`machine-learning/evaluation/data-leakage.md`).

### Hyperparameter search
4. **A search has five parts:** an estimator, a parameter space, a way to pick candidates, a CV scheme and a score function ✅[^2]. `GridSearchCV` tries every combination of the listed values ✅[^2] and, with the default `refit=True`, refits the best candidate on the whole dataset ✅[^9].
5. **Random search.** `RandomizedSearchCV` samples `n_iter` candidates (default 10 ✅[^10]) from distributions; its budget does not depend on the number of parameters, and adding parameters that do not matter does not reduce its efficiency ✅[^2]. For continuous parameters, pass a continuous distribution such as `loguniform(1e0, 1e3)` instead of a list ✅[^2]. Bergstra and Bengio found that for most datasets only a few hyperparameters really matter, and different ones on different datasets, which makes a grid a poor choice ✅[^3]: a 3 × 3 grid tries only 3 values of the one that matters, 9 random trials try 9 (worked example ✅[^7]).
6. **Successive halving.** Start every candidate with a small resource (by default the number of training samples), keep the best ones, and give the survivors more ✅[^2]. In scikit-learn, iteration i gives each candidate `n_resources_i = factor^i · min_resources` and keeps about `1/factor` of the candidates for the next round; `factor` (default 3) is the knob, and the search stops when the resource per candidate reaches its maximum or when the best candidate is identified ✅[^2] ✅[^11]. Example: `factor = 3`, 24 candidates, `min_resources = 222` samples (the value the default `min_resources='exhaust'` chose for 2,000 samples) gives rounds of (24 candidates × 222 samples), (8 × 666), (3 × 1998) ✅[^7]. Li et al. credit the hyperparameter version to Jamieson and Talwalkar, who analyzed an algorithm first proposed by Karnin et al. for another setting: give a budget to all configurations, drop the worst half, repeat; Hyperband runs several such brackets with different trade-offs between many cheap and few expensive candidates ✅[^6]. The halving estimators are experimental and need `from sklearn.experimental import enable_halving_search_cv` ✅[^2].
7. **Selection bias and nested CV.** A CV estimate has variance, and a model-selection criterion with non-negligible variance can be over-fitted just like a model; the effect is often as large as the differences between learning algorithms, and it makes some common evaluation practices unreliable through selection bias ✅[^4]. Nested CV avoids it: an inner search chooses the hyperparameters, and an outer loop estimates the error of the model together with its search ✅[^5]. The alternative is a development set for the search and a separate evaluation set for the final score ✅[^2].

## Worked example
One script, three parts: (1) nested vs non-nested CV for an SVC (support vector classifier) tuned over 20 candidates on 20 pure-noise datasets (80 rows, 10 features, 40/40 labels), where every honest estimate is 0.5; (2) grid vs random search with 9 trials on a function where only the first parameter `a` matters (peak at `log10(a) = −1.3`, between grid points); (3) successive halving vs a full grid of 24 random-forest candidates. The core lines of part 1:

```python
search = GridSearchCV(SVC(), grid, cv=inner).fit(X, y)
non_nested.append(search.best_score_)                     # selection score reused as the estimate
nested.append(cross_val_score(GridSearchCV(SVC(), grid, cv=inner), X, y, cv=outer).mean())
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-24, scikit-learn 1.9.1, numpy 2.5.5, two runs identical ✅[^7]:

```text
pure noise, 20 datasets: mean candidate 0.504  non-nested best_score_ 0.579  nested 0.509  (chance 0.5)
grid 3x3: 3 distinct a values, best 0.914
random 9: 9 distinct a values, median best 0.987, beats grid in 86.7% of 1,000 repeats
halving: n_candidates_ [24, 8, 3]  n_resources_ [222, 666, 1998]
halving sample budget 16650 (full grid: 48000), best {'max_depth': None, 'max_features': 0.5, 'min_samples_leaf': 1}, score 0.914
full grid best {'max_depth': None, 'max_features': 0.5, 'min_samples_leaf': 5}, score 0.913
```

<details><summary>Full script (prints the output above)</summary>

```python
import numpy as np
from sklearn.datasets import make_classification
from sklearn.ensemble import RandomForestClassifier
from sklearn.experimental import enable_halving_search_cv  # noqa: F401 (required import)
from sklearn.model_selection import (GridSearchCV, HalvingGridSearchCV, StratifiedKFold,
                                     cross_val_score)
from sklearn.svm import SVC

# Part 1: nested vs non-nested CV on pure noise (labels independent of features)
grid = {"C": [0.1, 1, 10, 100], "gamma": [0.001, 0.01, 0.1, 1, 10]}   # 20 candidates
non_nested, nested, typical = [], [], []
for trial in range(20):
    rng = np.random.default_rng(trial)
    X, y = rng.standard_normal((80, 10)), rng.permutation(np.repeat([0, 1], 40))
    inner = StratifiedKFold(5, shuffle=True, random_state=trial)
    outer = StratifiedKFold(5, shuffle=True, random_state=100 + trial)
    search = GridSearchCV(SVC(), grid, cv=inner).fit(X, y)
    non_nested.append(search.best_score_)                  # best of 20 noisy CV means
    typical.append(search.cv_results_["mean_test_score"].mean())  # an average candidate
    nested.append(cross_val_score(GridSearchCV(SVC(), grid, cv=inner), X, y, cv=outer).mean())
print(f"pure noise, 20 datasets: mean candidate {np.mean(typical):.3f}  "
      f"non-nested best_score_ {np.mean(non_nested):.3f}  nested {np.mean(nested):.3f}  (chance 0.5)")

# Part 2: grid vs random search, 9 trials each, only parameter a matters
def score(log_a, b):
    return np.exp(-(log_a + 1.3) ** 2)                     # peak at a = 10**-1.3; b ignored
grid_logs = [(la, b) for la in (-3, -2, -1) for b in (1, 2, 3)]
grid_best = max(score(la, b) for la, b in grid_logs)
rng = np.random.default_rng(0)
rand_best = np.array([max(score(la, b) for la, b in zip(rng.uniform(-3, 0, 9), rng.uniform(1, 3, 9)))
                      for _ in range(1_000)])
print(f"grid 3x3: {len({la for la, _ in grid_logs})} distinct a values, best {grid_best:.3f}")
print(f"random 9: 9 distinct a values, median best {np.median(rand_best):.3f}, "
      f"beats grid in {np.mean(rand_best > grid_best):.1%} of 1,000 repeats")

# Part 3: successive halving schedule vs full grid on 2,000 samples, 24 candidates
X, y = make_classification(n_samples=2_000, n_features=20, n_informative=5, random_state=0)
rf_grid = {"max_depth": [2, 4, 8, None], "min_samples_leaf": [1, 5, 20],
           "max_features": ["sqrt", 0.5]}
sh = HalvingGridSearchCV(RandomForestClassifier(n_estimators=50, random_state=0), rf_grid,
                         factor=3, cv=5, random_state=0).fit(X, y)
print("halving: n_candidates_", sh.n_candidates_, " n_resources_", sh.n_resources_)
units = sum(c * r for c, r in zip(sh.n_candidates_, sh.n_resources_))
print(f"halving sample budget {units} (full grid: {24 * 2_000}), best {sh.best_params_}, score {sh.best_score_:.3f}")
gs = GridSearchCV(RandomForestClassifier(n_estimators=50, random_state=0), rf_grid, cv=5).fit(X, y)
print(f"full grid best {gs.best_params_}, score {gs.best_score_:.3f}")
```
</details>

Reading it:
- **Selection bias, measured.** The average candidate scores 0.504, as it should on noise. The best candidate's `best_score_` averages 0.579: the maximum of 20 noisy estimates is biased upward even though every candidate is useless. The nested estimate is 0.509, back at chance. scikit-learn's own iris example finds a smaller gap, 0.0076 on average, and notes that the size of the effect depends primarily on dataset size and model stability ✅[^5]; 80 noisy rows is a hard case.
- **Grid vs random.** The 3 × 3 grid spends 9 trials on only 3 values of `a` and its best is 0.914. Nine random trials try 9 values of `a`; their median best is 0.987, and random wins in 86.7% of 1,000 repeats. This is a toy function, not a benchmark; it shows Bergstra and Bengio's mechanism, not their measured gains.
- **Halving.** 24 candidates on 222 samples, then 8 on 666, then 3 on 1,998: 16,650 sample-units of training against 48,000 for the full grid, about a third. Both chose `max_depth=None, max_features=0.5`; they disagree on `min_samples_leaf` (1 vs 5) with scores 0.914 vs 0.913, a difference within noise.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Reporting `best_score_` of a search as the model's performance | Optimistic; lab: 0.579 on noise vs 0.509 nested ✅[^7] | Selection bias from optimizing a noisy criterion ✅[^4] ✅[^5] |
| Rows ordered by class and `KFold` without shuffle | Folds missing a class; in the lab the first fold had 0 positives ✅[^7] | No shuffling by default; with contiguous classes, shuffling first may be essential ✅[^1] |
| Shuffling time-ordered data before CV | Overfit model and inflated score | Test rows are artificially similar to training rows ✅[^1] |
| `KFold(shuffle=True)` with `random_state=None` | Different folds on every call; `GridSearchCV` still uses the same folds for all candidates within one `fit` | Splitter randomness ✅[^1] |
| Rare class with stratified folds | Every fold has the class, but the fold-to-fold spread understates the real uncertainty | Stratification makes folds more homogeneous ✅[^1] |
| Successive halving keeps more than `n // factor` candidates | Lab: 8 candidates became 3, not 2 ✅[^7] | The User Guide writes the rule with `//` ✅[^2]; the API documents the count left after the last iteration (`n_remaining_candidates_`) as `ceil(n_candidates[-1] / factor)` ✅[^11], and the lab's 8 → 3 matches ceil, not `//` |
| Halving with multi-metric `scoring` | Not supported | `GridSearchCV`/`RandomizedSearchCV` only ✅[^2] |
| Good and bad candidates only differ with lots of data | First rounds on few samples cannot rank them reliably | A high `min_resources` is recommended when many samples are needed to tell them apart ✅[^2] |
| Score barely above chance on a small, high-dimensional dataset | May be luck | CV can beat chance on structureless data; `permutation_test_score` tests that ✅[^1] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Single validation split | One fit per candidate | Fewer training rows; result depends on the split ✅[^1] |
| 5- or 10-fold CV | Preferred over leave-one-out by most authors ✅[^1] | k fits per candidate |
| Grid search | Exhaustive over the listed values ✅[^2] | Every added parameter multiplies the combinations ✅[^2]; trials go to parameters that do not matter ✅[^3] |
| Random search | Budget set by `n_iter`, not by the number of parameters ✅[^2] | Needs a sensible distribution per parameter, continuous for continuous parameters ✅[^2] |
| Successive halving | Most resources go to promising candidates ✅[^6]; lab: a third of the grid's sample budget ✅[^7] | Experimental API ✅[^2]; the first rounds must tell good from bad on few samples ✅[^2] |
| Nested CV | Honest estimate of model + search ✅[^5] | Outer × inner × candidates fits |

## Takeaways
- Choose the splitter from how new data will arrive: new subjects → `GroupKFold`, the future → `TimeSeriesSplit`, rare classes → stratified. [rule-candidate]
- Never report a search's `best_score_` as the expected performance; use nested CV or an untouched test set. [rule-candidate]
- Prefer `RandomizedSearchCV` with log-uniform distributions over a grid once more than two hyperparameters are in play.
- Put the whole `Pipeline` inside the search so preprocessing is refitted per fold (`machine-learning/data-and-features/preprocessing-and-pipelines.md`).

## Verification status
- Verified: 62 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- [Cross-validation: evaluating estimator performance (User Guide 3.1)](https://scikit-learn.org/stable/modules/cross_validation.html) — scikit-learn developers, living (1.9.1 docs). Backs: k-fold procedure, held-out test set, default splitters and no shuffling, leave-one-out caveats, stratification purpose and its side effect, group splitters, time-series and shuffling notes, splitter randomness, permutation test. [^1]
- [Tuning the hyper-parameters of an estimator (User Guide 3.2)](https://scikit-learn.org/stable/modules/grid_search.html) — scikit-learn developers, living. Backs: parts of a search, grid and randomized search, continuous distributions, successive halving schedule and parameters, experimental import, no multi-metric halving, development vs evaluation set. [^2]
- [Random Search for Hyper-Parameter Optimization](https://jmlr.org/papers/v13/bergstra12a.html) — Bergstra & Bengio, JMLR, 2012. Backs: random beats grid, few hyperparameters matter and differ per dataset (abstract). [^3]
- [On Over-fitting in Model Selection and Subsequent Selection Bias in Performance Evaluation](https://jmlr.org/papers/v11/cawley10a.html) — Cawley & Talbot, JMLR, 2010. Backs: variance of the selection criterion causes over-fitting in model selection and selection bias, of a size comparable to algorithm differences (abstract). [^4]
- [Nested versus non-nested cross-validation](https://scikit-learn.org/stable/auto_examples/model_selection/plot_nested_cross_validation_iris.html) — scikit-learn developers, living. Backs: non-nested is overly optimistic, inner/outer loops, iris difference 0.0076, dependence on dataset size and stability. [^5]
- [Hyperband: A Novel Bandit-Based Approach to Hyperparameter Optimization](https://arxiv.org/html/1603.06560v4) — Li, Jamieson, DeSalvo, Rostamizadeh, Talwalkar, 2018. Backs: successive halving algorithm and its origin (Jamieson and Talwalkar, after Karnin et al.), exponentially more resources to promising configurations, brackets. [^6]
- `machine-learning/lab-setup.md` — the lab where the splitter folds, the grouped-data scores, the nested-vs-non-nested, grid-vs-random and halving runs ran on 2026-11-24. [^7]
- [sklearn.model_selection.TimeSeriesSplit](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html) — scikit-learn developers, living. Backs: first k folds train, fold k + 1 tests, growing training sets. [^8]
- [sklearn.model_selection.GridSearchCV](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.GridSearchCV.html) — scikit-learn developers, living. Backs: `refit=True` refits on the whole dataset. [^9]
- [sklearn.model_selection.RandomizedSearchCV](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.RandomizedSearchCV.html) — scikit-learn developers, living. Backs: `n_iter=10` default. [^10]
- [sklearn.model_selection.HalvingGridSearchCV](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.HalvingGridSearchCV.html) — scikit-learn developers, living. Backs: `factor=3` default, candidates left after the last iteration `ceil(n_candidates[-1] / factor)`. [^11]

## Related
- `machine-learning/foundations/generalization-and-overfitting.md` — train, validation and test sets; why a held-out score matters.
- `machine-learning/evaluation/data-leakage.md` — temporal, duplicate and preprocessing leaks that a splitter alone does not stop.
- `machine-learning/evaluation/classification-metrics.md` — what to pass as `scoring=`.
- `machine-learning/data-and-features/preprocessing-and-pipelines.md` — searching over a whole pipeline.
- `machine-learning/reinforcement-learning/multi-armed-bandits.md` — the bandit view behind successive halving and Hyperband.
- `machine-learning/deep-learning/neural-architecture-search-and-automl.md` — searching over architectures and whole pipelines.
