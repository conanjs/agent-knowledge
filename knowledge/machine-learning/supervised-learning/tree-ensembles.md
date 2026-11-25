---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/supervised-learning
status: verified
applies-to: ["scikit-learn 1.9.1", "NumPy 2.5.5"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [machine-learning, supervised-learning, ensembles, bagging, random-forest, out-of-bag, gradient-boosting, shrinkage, learning-rate, histogram-gradient-boosting, scikit-learn]
---

# Tree ensembles: bagging, random forests and gradient boosting

## Summary
**TL;DR:** Two opposite ways to combine many decision trees. **Bagging and random forests** grow deep trees independently, each on a bootstrap sample (rows drawn with replacement) and, for forests, a random subset of features at each split, then average them. Averaging cancels part of each tree's errors and cuts variance (7.9 → 1.1 in the lab), at the price of a slightly higher bias. The rows a tree never saw, its "out-of-bag" rows, give a free validation score. **Gradient boosting** grows shallow trees one after another. Each new tree is fitted to the negative gradient of the loss at the current prediction (for squared error, the residuals) and added with a small weight, the learning rate. **Histogram gradient boosting** first bins each feature into at most 255 values, which makes split finding much cheaper on large data.
**Use this when:** you pick between `RandomForest*`, `GradientBoosting*` and `HistGradientBoosting*`, tune `n_estimators`, `max_features` or `learning_rate`, read `oob_score_` or `train_score_`, or need to explain why a forest beats a single tree.
**Not this doc:** how one tree is grown (Gini, splits, depth) → `machine-learning/supervised-learning/decision-trees.md`; bias and variance in general → `machine-learning/foundations/generalization-and-overfitting.md`; impurity vs permutation importance → `machine-learning/data-and-features/feature-importance-and-selection.md`; the gradient-descent idea that boosting borrows → `machine-learning/foundations/gradient-descent.md`.

## Problem
A single deep tree is unstable and overfits ✅[^7]. Ensembles fix that, but they fail in their own ways. A forest's out-of-bag score is easy to misread as a training score, or to skip in favour of an extra hold-out set the data cannot spare. A boosted model with `learning_rate=1.0` drove its training loss to 0.000 while its test loss tripled, from 0.494 at stage 2 to 1.566 at stage 300 ✅[^7], although the API (application programming interface) reference calls gradient boosting "fairly robust to over-fitting" ✅[^3]. Knowing which knob controls variance and which controls the step size is what makes these models predictable.

## Mental model
**Analogy:** a **forest** is a panel of independent appraisers. Each one inspected a different random sample of past sales and was allowed to look at only some of the attributes at each decision. Each is erratic on their own, but their errors point in different directions, so the panel's average is steady. **Boosting** is a relay of editors working on one draft. The first writes a rough version; each next editor looks only at what is still wrong and is allowed one small, cautious correction (the learning rate). Many small corrections in a row beat a few large ones, which overshoot.

**Artifact:** the two shapes:

```text
Random forest (parallel, deep trees, average)        Gradient boosting (sequential, shallow trees, sum)

 bootstrap 1 ─► tree 1 (deep) ─┐                      F0 = mean(y) or log-odds
 bootstrap 2 ─► tree 2 (deep) ─┼─► average ─► ŷ       F1 = F0 + ν·h1   h1 fitted to −gradient of loss at F0
   …                           │                      F2 = F1 + ν·h2   h2 fitted to −gradient at F1
 bootstrap M ─► tree M (deep) ─┘                       …
 (random feature subset at every split)               ŷ = F_M          (ν = learning_rate, h = small tree)
```

## How it works
### Bagging and random forests
Symbols: `n` training rows, `M` trees, `p` features.

1. **Bootstrap.** Each tree is built from a sample drawn with replacement from the training set ✅[^1], by default `n` draws ✅[^2]. A given row is missed by one draw with probability `1 − 1/n`, so it appears in a tree's sample with probability `1 − (1 − 1/n)^n ≈ 0.632` for large `n` (lab, `n = 1000`: 0.632 by formula, 0.633 measured) ✅[^7].
2. **Random features.** At each split, only a random subset of `max_features` features is searched ✅[^1]. The classifier's default is `"sqrt"` (√p features) ✅[^2]. `max_features=1.0` (all features) makes the forest the same as bagged trees ✅[^1].
3. **Deep trees.** Good results often come from fully grown trees (`max_depth=None`, `min_samples_split=2`) ✅[^1]. Individual trees have high variance and tend to overfit ✅[^1]; the average does the regularizing.
4. **Combine.** The forest averages the trees' predictions ✅[^1]. scikit-learn's classifier averages the trees' predicted probabilities, unlike the original paper, where each tree votes for one class ✅[^1].
5. **Why it works.** Bootstrapping and random features decouple the trees' errors, so part of them cancel in the average. The forest's variance drops, "sometimes at the cost of a slight increase in bias" ✅[^1]. Lab, 20 independent training sets: variance 7.935 for one tree vs 1.074 for a 200-tree forest; bias² 3.417 vs 3.651 ✅[^7].
6. **How many trees.** More trees are better but slower, and results stop improving significantly beyond a critical number ✅[^1]; the default is 100 ✅[^2]. Fewer features per split means more variance reduction but more bias ✅[^1].

### Out-of-bag (OOB) estimate
7. **Free validation.** About 37 % of the rows (1 − 0.632) are left out of each tree's bootstrap sample. Scoring each row only with the trees that did not see it estimates the generalization error without a separate hold-out set: set `oob_score=True` ✅[^1]. It needs `bootstrap=True` and uses accuracy by default ✅[^2]. Lab: `oob_score_` 0.821 vs held-out test accuracy 0.832 ✅[^7].

### Gradient boosting
Symbols: `F_m(x)` is the ensemble's raw prediction after `m` trees; `h_m` is the `m`-th tree; `ν` (nu) is `learning_rate`; `l(y, F)` is the loss.

8. **Start.** `F_0` is the constant that minimizes the loss: the mean of `y` for squared error, the log odds-ratio for binary log loss ✅[^1].
9. **Fit the negative gradient.** At stage `m`, compute for every row the negative gradient `−∂l/∂F` at `F_{m−1}`, and fit a small regression tree `h_m` to it ✅[^1]. For the squared error `½(y − F)²`, the negative gradient is the residual `y − F`. For some losses, such as absolute error, the tree's leaf values are then reset to minimize the loss directly (the median of each leaf for absolute error) ✅[^1]. In the lab, a hand-written loop "fit a depth-3 tree to `y − F`, add 0.1 × its prediction" reproduced `GradientBoostingRegressor` to `7.1e-15` ✅[^7]. The guide calls this a kind of gradient descent in function space ✅[^1].
10. **Update with shrinkage.** `F_m = F_{m−1} + ν·h_m(x)` ✅[^1]. Smaller `ν` needs more trees for the same training error, and empirical evidence suggests small values give better test error. The guide cites Hastie, Tibshirani and Friedman's recommendation: a small constant such as `ν ≤ 0.1`, with enough trees for early stopping to apply ✅[^1].
11. **Classification.** For log loss, `p(y = 1 | x) = σ(F_M(x))`; even then each `h_m` is a regression tree, because gradients are continuous. With `K` classes, `K` trees are built per stage ✅[^1].
12. **Tree size.** `max_depth=h` builds trees with at most `2^h` leaves that can capture feature interactions of order `h` ✅[^1]; the default is `max_depth=3` ✅[^3].
13. **Subsampling.** `subsample < 1.0` fits each tree on a fraction of the rows (stochastic gradient boosting), reducing variance and increasing bias ✅[^3]. With shrinkage it can improve accuracy; without shrinkage it does poorly ✅[^1].

### Histogram gradient boosting
14. **Bin once.** `HistGradientBoosting*` bins every feature into at most `max_bins=255` integer bins, plus one bin reserved for missing values ✅[^4]. Lab: a feature with 1,000 distinct values used 255 bins ✅[^7].
15. **Cheaper splits.** In the ensemble guide's account, a classic tree (as in `GradientBoosting*`) sorts the samples at each node, `O(p·n·log n)` per node. A histogram is built in `O(n)`, and only `max_bins` split points are scanned ✅[^1]. LightGBM, which inspired these estimators ✅[^1], describes the same split search as `O(#data)` to build a histogram and `O(#bins)` to search it, and builds one child's histogram by subtracting its sibling's from the parent's ✅[^6]. The decision-tree guide words the classic cost differently: it says scikit-learn caches the order of the indices so features need not be re-sorted at each node, for the same `O(n_features · n_samples · log n_samples)` total ✅[^9]. Both pages give that complexity; they differ only on whether a per-node sort happens.
16. **Newton steps.** These estimators also use the loss's second derivative (the Hessian), avoiding the line-search step ✅[^1].
17. **Result.** They can be orders of magnitude faster than `GradientBoosting*` once the data has more than tens of thousands of rows, and they handle missing values and categorical features natively ✅[^1]. Defaults: `max_iter=100`, `max_leaf_nodes=31`, and early stopping switched on automatically above 10,000 rows ✅[^4]. XGBoost, another boosting system, adds a sparsity-aware split algorithm and a weighted quantile sketch for approximate split finding ✅[^5].

## Worked example
Five experiments on synthetic data: tree vs forest variance over 20 training sets of `make_friedman1` (a standard 10-feature regression benchmark); bootstrap coverage and the OOB score; boosting by hand vs scikit-learn; three learning rates; and the bins of a histogram model. The core of the boosting-by-hand check:

```python
F = np.full(len(yr), yr.mean())                              # F0 = mean of y
for m in range(50):
    h = DecisionTreeRegressor(max_depth=3, random_state=0).fit(Xr, yr - F)   # fit the residuals
    F += 0.1 * h.predict(Xr)                                 # shrinkage ν = 0.1
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-24, scikit-learn 1.9.1, NumPy 2.5.5, two runs identical ✅[^7]:

```text
single tree variance=7.935 bias^2=3.417  MSE vs true f=11.352
forest 200  variance=1.074 bias^2=3.651  MSE vs true f=4.725
bootstrap: mean share of distinct rows per tree=0.633 (1-(1-1/n)^n=0.632)
tree test acc=0.723 | forest oob_score_=0.821 test acc=0.832
boosting by hand vs GradientBoostingRegressor: max |diff| = 7.1e-15, train MSE 1.0606 vs 1.0606
lr=1    train loss @1,10,100,300 = [0.483 0.286 0.007 0.   ] | test loss @1,10,100,300 = [0.495 0.564 0.991 1.566] | best test stage=2 (0.494)
lr=0.1  train loss @1,10,100,300 = [0.656 0.482 0.257 0.118] | test loss @1,10,100,300 = [0.657 0.5   0.447 0.498] | best test stage=44 (0.434)
lr=0.01 train loss @1,10,100,300 = [0.689 0.657 0.484 0.374] | test loss @1,10,100,300 = [0.69  0.659 0.504 0.442] | best test stage=300 (0.442)
train_score_[0] / train log loss at stage 1 = 2.000
distinct values in feature 0: 1000; HGB bins used: 255; HGB test acc=0.813, n_iter_=100
```

<details><summary>Full script (prints the output above)</summary>

```python
# Tree ensembles: variance of tree vs forest, out-of-bag vs test, boosting = trees fitted to residuals, shrinkage.
import numpy as np
from sklearn.datasets import make_friedman1, make_classification
from sklearn.ensemble import (RandomForestRegressor, RandomForestClassifier, GradientBoostingRegressor,
                              GradientBoostingClassifier, HistGradientBoostingClassifier)
from sklearn.metrics import log_loss
from sklearn.model_selection import train_test_split
from sklearn.tree import DecisionTreeRegressor, DecisionTreeClassifier

# 1. Variance: refit on 20 independent training sets of 300 rows, predict the same 500 test points
Xte, fte = make_friedman1(n_samples=500, noise=0.0, random_state=999)     # fte = true function, no noise
for name, make in [("single tree", lambda s: DecisionTreeRegressor(random_state=s)),
                   ("forest 200 ", lambda s: RandomForestRegressor(n_estimators=200, random_state=s))]:
    P = np.array([make(s).fit(*make_friedman1(n_samples=300, noise=1.0, random_state=s)).predict(Xte)
                  for s in range(20)])
    var = P.var(axis=0).mean(); bias2 = ((P.mean(axis=0) - fte) ** 2).mean()
    print("%s variance=%.3f bias^2=%.3f  MSE vs true f=%.3f" % (name, var, bias2, ((P - fte) ** 2).mean()))

# 2. Out-of-bag estimate vs a held-out test set
X, y = make_classification(n_samples=2000, n_features=10, n_informative=5, flip_y=0.2, random_state=0)
Xtr, Xte2, ytr, yte = train_test_split(X, y, test_size=0.5, random_state=0)
rf = RandomForestClassifier(n_estimators=300, oob_score=True, random_state=0).fit(Xtr, ytr)
uniq = np.mean([len(np.unique(s)) / len(Xtr) for s in rf.estimators_samples_])
print("bootstrap: mean share of distinct rows per tree=%.3f (1-(1-1/n)^n=%.3f)" % (uniq, 1 - (1 - 1 / len(Xtr)) ** len(Xtr)))
print("tree test acc=%.3f | forest oob_score_=%.3f test acc=%.3f"
      % (DecisionTreeClassifier(random_state=0).fit(Xtr, ytr).score(Xte2, yte), rf.oob_score_, rf.score(Xte2, yte)))

# 3. Boosting by hand for squared error: start at the mean, each tree fits the residuals, step = learning_rate
Xr, yr = make_friedman1(n_samples=300, noise=1.0, random_state=0)
F = np.full(len(yr), yr.mean())
for m in range(50):
    h = DecisionTreeRegressor(max_depth=3, random_state=0).fit(Xr, yr - F)
    F += 0.1 * h.predict(Xr)
gbr = GradientBoostingRegressor(n_estimators=50, learning_rate=0.1, max_depth=3, random_state=0).fit(Xr, yr)
print("boosting by hand vs GradientBoostingRegressor: max |diff| = %.1e, train MSE %.4f vs %.4f"
      % (abs(F - gbr.predict(Xr)).max(), ((yr - F) ** 2).mean(), ((yr - gbr.predict(Xr)) ** 2).mean()))

# 4. Shrinkage: training loss per stage and test log loss, three learning rates
for lr in [1.0, 0.1, 0.01]:
    gb = GradientBoostingClassifier(n_estimators=300, learning_rate=lr, max_depth=3, random_state=0).fit(Xtr, ytr)
    tr = np.array([log_loss(ytr, p) for p in gb.staged_predict_proba(Xtr)])
    te = np.array([log_loss(yte, p) for p in gb.staged_predict_proba(Xte2)])
    print("lr=%-4g train loss @1,10,100,300 = %s | test loss @1,10,100,300 = %s | best test stage=%d (%.3f)"
          % (lr, np.round(tr[[0, 9, 99, 299]], 3), np.round(te[[0, 9, 99, 299]], 3), te.argmin() + 1, te.min()))
print("train_score_[0] / train log loss at stage 1 = %.3f" % (gb.train_score_[0] / tr[0]))

# 5. Histogram GBM: features are binned into at most max_bins=255 integer bins before training
hgb = HistGradientBoostingClassifier(random_state=0).fit(Xtr, ytr)
print("distinct values in feature 0: %d; HGB bins used: %d; HGB test acc=%.3f, n_iter_=%d"
      % (len(np.unique(Xtr[:, 0])), len(np.unique(hgb._bin_mapper.transform(Xtr)[:, 0])), hgb.score(Xte2, yte), hgb.n_iter_))
```

</details>

Reading it line by line:
- **Lines 1–2:** over 20 fresh training sets of 300 rows, a single tree's predictions vary 7.4 times more than a 200-tree forest's (7.935 vs 1.074). The forest's bias² is slightly higher (3.651 vs 3.417), and its MSE (mean squared error) against the true function is less than half (4.725 vs 11.352); in each row, variance + bias² equals that MSE.
- **Line 3:** each tree saw 63.3 % of the distinct rows, matching `1 − (1 − 1/1000)^1000 = 0.632`.
- **Line 4:** on the same noisy 2,000-row classification set as the depth sweep in `machine-learning/supervised-learning/decision-trees.md`, the forest lifts test accuracy from 0.723 (one tree) to 0.832; the out-of-bag estimate, 0.821, is within 0.011 of it, with no extra data spent.
- **Line 5:** 50 trees fitted to residuals by hand give the same predictions as `GradientBoostingRegressor` (difference `7.1e-15`): boosting with squared error is exactly that loop.
- **Lines 6–8:** with `ν = 1.0`, training log loss falls to 0.000 while test log loss is best at stage 2 (0.494) and climbs to 1.566. With `ν = 0.1`, the best test loss (0.434) comes at stage 44 and then rises slowly to 0.498. With `ν = 0.01`, 300 stages are not enough to overfit; the test loss is still falling (0.442). The best stage moves later as `ν` shrinks.
- **Line 9:** `train_score_` holds exactly twice the log loss in this run.
- **Line 10:** 1,000 distinct values became 255 bins. The histogram model (HGB, `HistGradientBoostingClassifier`) reaches 0.813, close to the forest, and ran all 100 iterations because early stopping is off below 10,000 rows.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Boosting with `learning_rate=1.0` and many stages | Training loss → 0, test loss 0.494 → 1.566 ✅[^7] | The learning rate controls overfitting via shrinkage ✅[^1]. The API's "fairly robust to over-fitting" ✅[^3] did not hold here at `ν = 1.0`; the guide cites a recommendation of `ν ≤ 0.1` with early stopping ✅[^1] |
| Reading `GradientBoostingClassifier.train_score_` as log loss | It was exactly 2 × `log_loss` in the lab ✅[^7] | The API calls the loss "binomial and multinomial deviance" ✅[^3] |
| OOB estimate from a gradient-boosting model (`oob_improvement_`) | Usually very pessimistic ✅[^1] | The guide recommends cross-validation instead, and OOB only when cross-validation is too slow ✅[^1] |
| Random forest with few trees and `oob_score=True` | `oob_decision_function_` may contain NaN ("not a number") ✅[^2] | Some rows were never left out of any bootstrap sample ✅[^2] |
| `GradientBoostingClassifier` with many classes | Slow: `n_classes` trees per stage ✅[^1] | The guide recommends `HistGradientBoostingClassifier` instead ✅[^1] |
| Histogram boosting on a small dataset | Split points can be too approximate ✅[^1] | Binning; `GradientBoosting*` may be preferred for small samples ✅[^1] |
| Default random forest on a large dataset | Large model: size grows as `O(M·N·log N)` ✅[^1] | Fully grown trees; limit with `min_samples_leaf`, `max_leaf_nodes` or `max_depth` ✅[^1] |
| `GradientBoosting*(criterion=...)` in new code | Has no effect; deprecated in 1.9, to be removed in 1.11, in the classifier ✅[^3] and the regressor ✅[^8] | Drop the argument |
| Bagging shallow trees, or boosting deep ones | Each method is paired with the base model it suits least | Bagging works best with strong, complex models (fully developed trees); boosting usually works best with weak ones (shallow trees) ✅[^1] |
| Forest training on many cores | `n_jobs=-1` uses all cores; the speedup might not be linear ✅[^1] | Inter-process communication overhead ✅[^1] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Random forest | Few knobs; deep trees in parallel; free OOB estimate ✅[^1] | Deep trees use much compute and memory; exact (unbinned) splits ✅[^1] |
| `GradientBoosting*` (exact splits) | Fine split points on small data ✅[^1]; many losses (squared, absolute, Huber, quantile) ✅[^1] | Sequential; the histogram version can be orders of magnitude faster beyond tens of thousands of rows ✅[^1] |
| `HistGradientBoosting*` | Orders of magnitude faster on large data; native missing values and categories ✅[^1]; early stopping by default above 10,000 rows ✅[^4] | Approximate splits on small data ✅[^1]; some losses not supported ✅[^1] |
| Small learning rate + many stages | Usually better test error ✅[^1]; best test loss 0.434 at `ν = 0.1` vs 0.494 at `ν = 1.0` in the lab ✅[^7] | More trees for the same training error ✅[^1]; longer training |
| Smaller `max_features` | More variance reduction ✅[^1] | More bias ✅[^1] |

## Takeaways
- For tabular data, start with `HistGradientBoostingClassifier` / `Regressor` on large data, and compare it with a random forest. The guide recommends trying both. [rule-candidate]
- Keep `learning_rate ≤ 0.1` and let early stopping (or validation curves) choose the number of stages; never ship `learning_rate=1.0` without checking a test curve. [rule-candidate]
- Use a forest's `oob_score_` as a cheap validation estimate, but cross-validate gradient-boosting models instead of trusting their OOB numbers.
- Adding trees to a forest costs time and levels off in accuracy; adding stages to a boosted model can make its test loss worse (0.494 → 1.566 in the lab).

## Verification status
- Verified: 79 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- [1.11. Ensembles: Gradient boosting, random forests, bagging, voting, stacking (scikit-learn User Guide)](https://scikit-learn.org/stable/modules/ensemble.html) — scikit-learn developers, living (1.9.1 docs). Backs: bootstrap samples and random feature subsets, variance reduction with a slight bias increase, probability averaging vs voting, `max_features` guidance, number of trees, OOB estimates, model size, parallelism, bagging vs boosting base models; the GBRT (gradient-boosted regression trees) formulation (initial model, negative gradients, leaf-value updates for losses such as absolute error, functional gradient descent, sigmoid/softmax, `n_classes` trees per stage), tree size and interaction order, losses, shrinkage and the learning-rate recommendation it cites from Hastie, Tibshirani and Friedman, subsampling, pessimistic OOB for boosting; histogram boosting (binning, `O(n)` histograms, Hessian, speed, missing values and categories, small-data caveat, inspired by LightGBM). [^1]
- [RandomForestClassifier (scikit-learn API)](https://scikit-learn.org/stable/modules/generated/sklearn.ensemble.RandomForestClassifier.html) — scikit-learn developers, living (1.9.1 docs). Backs: `n_estimators=100`, `max_features="sqrt"`, `bootstrap`, `max_samples=None` draws `n` rows, `oob_score` (accuracy, needs bootstrap), NaN in `oob_decision_function_`, `estimators_samples_`. [^2]
- [GradientBoostingClassifier (scikit-learn API)](https://scikit-learn.org/stable/modules/generated/sklearn.ensemble.GradientBoostingClassifier.html) — scikit-learn developers, living (1.9.1 docs). Backs: "fairly robust to over-fitting", `max_depth=3` default, `subsample` reduces variance and increases bias, `train_score_`, `log_loss` as binomial/multinomial deviance, `criterion` deprecated in 1.9. [^3]
- [HistGradientBoostingClassifier (scikit-learn API)](https://scikit-learn.org/stable/modules/generated/sklearn.ensemble.HistGradientBoostingClassifier.html) — scikit-learn developers, living (1.9.1 docs). Backs: `max_bins=255` plus a missing-value bin, `max_iter=100`, `max_leaf_nodes=31`, early stopping `'auto'` above 10,000 samples. [^4]
- [XGBoost: A Scalable Tree Boosting System (abstract)](https://arxiv.org/abs/1603.02754) — Chen, Guestrin, 2016. Backs: sparsity-aware algorithm and weighted quantile sketch for approximate tree learning. [^5]
- [Features (LightGBM documentation)](https://lightgbm.readthedocs.io/en/latest/Features.html) — LightGBM developers, living. Backs: histogram-based split finding, `O(#data)` to build and `O(#bins)` to search, histogram subtraction. [^6]
- `machine-learning/lab-setup.md` — the lab where the variance/bias comparison, bootstrap coverage, OOB vs test, boosting by hand, the learning-rate sweep and the binning check ran on 2026-11-24. [^7]
- [GradientBoostingRegressor (scikit-learn API)](https://scikit-learn.org/stable/modules/generated/sklearn.ensemble.GradientBoostingRegressor.html) — scikit-learn developers, living (1.9.1 docs). Backs: `criterion` has no effect, deprecated in 1.9 and to be removed in 1.11. [^8]
- [1.10. Decision Trees (scikit-learn User Guide)](https://scikit-learn.org/stable/modules/tree.html) — scikit-learn developers, living (1.9.1 docs). Backs: cached index order, no re-sort at each node, `O(n_features · n_samples · log n_samples)`. [^9]

## Related
- `machine-learning/supervised-learning/decision-trees.md` — the base learner: splits, impurity, depth.
- `machine-learning/foundations/generalization-and-overfitting.md` — the bias–variance decomposition behind forests.
- `machine-learning/foundations/gradient-descent.md` — the step-size idea that `learning_rate` borrows.
- `machine-learning/evaluation/cross-validation-and-hyperparameter-search.md` — tuning `learning_rate`, `n_estimators` and `max_features`.
- `machine-learning/data-and-features/feature-importance-and-selection.md` — reading feature importances from forests and boosted models.
- `machine-learning/data-and-features/categorical-and-missing-data.md` — native categorical and NaN support in histogram boosting.
- `machine-learning/recommender-systems/learning-to-rank.md` — boosted trees fitted to ranking gradients (LambdaMART).
