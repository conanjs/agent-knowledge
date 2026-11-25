---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/supervised-learning
status: verified
applies-to: ["scikit-learn 1.9.1", "NumPy 2.5.5"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [machine-learning, supervised-learning, decision-tree, cart, gini, entropy, impurity, overfitting, pruning, scikit-learn]
---

# Decision trees: CART, Gini and entropy, greedy splits and why trees overfit

## Summary
**TL;DR:** A decision tree predicts by asking a chain of yes/no questions of the form "is feature `j` ≤ threshold `t`?" and answering with the class proportions (or the mean value) of the training rows that end up in the same leaf. scikit-learn grows it with CART (Classification and Regression Trees). At each node, CART tries every feature and every midpoint threshold, keeps the split with the lowest size-weighted child impurity (Gini or entropy), and repeats on both halves. Left at its defaults, the tree grows until every leaf is pure, so it memorizes noise. Depth and leaf-size limits, or cost-complexity pruning, are what make it generalize.
**Use this when:** you train or read a `DecisionTreeClassifier` / `DecisionTreeRegressor`, choose `max_depth`, `min_samples_leaf` or `ccp_alpha`, compute an impurity by hand, or need to know why a tree's training accuracy is 1.0 and its test accuracy is not.
**Not this doc:** many trees averaged or boosted → `machine-learning/supervised-learning/tree-ensembles.md`; impurity-based feature importance and its pitfalls → `machine-learning/data-and-features/feature-importance-and-selection.md`; the general train/test gap → `machine-learning/foundations/generalization-and-overfitting.md`.

## Problem
A tree is easy to read and needs almost no preprocessing, so it is often the first non-linear model people try. Grown with the defaults on noisy data, it reached 1.000 training accuracy with 159 leaves and scored 0.723 on the test set. A depth-3 tree scored 0.789 ✅[^3]. Two trees fitted on two halves of the same training set disagreed on 29.3 % of test predictions ✅[^3]. And a regression tree trained on `y = 2x` up to `x = 10` predicts 20 for `x = 100` ✅[^3]. Without knowing how splits are chosen and when growth stops, these look like bugs.

## Mental model
**Analogy:** the game of twenty questions played on a spreadsheet. Each question splits the rows into two piles, and a good question makes each pile as "one-coloured" (pure) as possible. You pick the best question for the current pile without planning ahead, then ask the next question separately in each new pile. Keep asking until every pile is one colour, and you end up with a question for almost every oddball row: perfect on the rows you have, poor on new ones.

**Artifact:** a fitted depth-2 tree on the iris flowers, printed as rules by `export_text` (the first lines the Worked example script prints) ✅[^3]. `weights` are the training rows of each class (setosa, versicolor, virginica) in that leaf:

```text
|--- petal width <= 0.80
|   |--- weights: [50.00, 0.00, 0.00] class: 0
|--- petal width >  0.80
|   |--- petal width <= 1.75
|   |   |--- weights: [0.00, 49.00, 5.00] class: 1
|   |--- petal width >  1.75
|   |   |--- weights: [0.00, 1.00, 45.00] class: 2
```

A flower with petal width 1.5 goes right, then left, and gets class 1 with `predict_proba = [0, 49/54, 5/54] = [0, 0.907, 0.093]`.

## How it works
Symbols: a node `m` holds `n_m` training rows `Q_m`; `p_mk` is the share of class `k` among them; a candidate split `θ = (j, t)` sends rows with `x_j ≤ t` left and the rest right.

1. **Candidate splits.** With the default `splitter='best'`, CART searches every feature `j` and every threshold `t` at a midpoint between sorted distinct values of that feature ✅[^1]. Ten values `1, 2, …, 10` give nine candidates `1.5, 2.5, …, 9.5`.
2. **Impurity of a node.** Gini: `H = Σ_k p_mk·(1 − p_mk)`. Entropy: `H = −Σ_k p_mk·log(p_mk)` ✅[^1]. A node with 4 rows of class 0 and 6 of class 1 has Gini `0.4·0.6 + 0.6·0.4 = 0.48` ✅[^3]. Entropy is the same as minimizing the log loss of the tree's leaf probabilities ✅[^1]. In the lab, scikit-learn's entropy values are in base 2: 0.971 for that node, not the natural-log 0.673 ✅[^3].
3. **Quality of a split.** `G = (n_left/n_m)·H(left) + (n_right/n_m)·H(right)`, the size-weighted impurity of the two children. The chosen split is the `θ` with the smallest `G` ✅[^1]. Split `x ≤ 5.5` in the Worked example: left `[4, 1]` has Gini 0.32, right `[0, 5]` has 0; `G = 0.5·0.32 + 0.5·0 = 0.16`.
4. **Recurse greedily.** The same search runs on each child, until a stop condition holds: `max_depth` reached, fewer than `min_samples_split` rows, or an impurity decrease below `min_impurity_decrease` ✅[^1]. Each split is only locally optimal. Learning the globally optimal tree is known to be NP-complete under several aspects of optimality (NP: nondeterministic polynomial time; no efficient algorithm is known for such problems), so practical learners use this greedy heuristic and cannot guarantee the best tree ✅[^1].
5. **Leaves predict.** A classification leaf's `predict_proba` is its class shares `p_mk` ✅[^1], and `predict` takes the argmax, giving ties to the lowest class index ✅[^2]. A regression leaf predicts the mean of its rows for the squared-error criterion, or the median for absolute error ✅[^1].
6. **Defaults grow fully.** `max_depth=None` expands nodes until all leaves are pure or smaller than `min_samples_split` (default 2), and `min_samples_leaf` defaults to 1 ✅[^2]: fully grown, unpruned trees ✅[^2]. Each extra level needs about twice as many samples to fill ✅[^1].
7. **Controls.** Pre-pruning stops growth early: `max_depth`, `min_samples_leaf` (every leaf keeps at least that many rows) ✅[^2], `min_samples_split` ✅[^1]. Post-pruning grows the tree, then removes branches by minimal cost-complexity pruning: it minimizes `R_α(T) = R(T) + α·|leaves|`, where `R(T)` is the total sample-weighted impurity of the leaves and `α` is `ccp_alpha` ✅[^1].
8. **Cost.** Prediction walks one root-to-leaf path, `O(log n_samples)` for a balanced tree. Splitting one node costs about `O(n_features · n_samples · log n_samples)`, the cost of sorting each feature's values; the guide adds that scikit-learn caches the order of the indices so features need not be re-sorted at each node ✅[^1].

## Worked example
Four experiments: every candidate split of a 10-row, 1-feature problem scored by hand and compared with scikit-learn's stump (a depth-1 tree); a depth sweep on 2,000 rows where 20 % of the labels are random; pre- and post-pruning; and instability plus extrapolation. The core of the hand computation:

```python
for t in (x[:-1] + x[1:]) / 2:                   # midpoints between sorted values
    L, R = y[x <= t], y[x > t]
    w = (len(L) * gini(L) + len(R) * gini(R)) / len(y)   # weighted child impurity G
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-24, scikit-learn 1.9.1, NumPy 2.5.5, two runs identical ✅[^3]:

```text
…                                  (the 7-line iris tree shown in the Mental model)
parent gini = 0.4800
  x <= 1.5  left [1 0] gini=0.0000 | right [3 6] gini=0.4444 | weighted=0.4000
  x <= 2.5  left [2 0] gini=0.0000 | right [2 6] gini=0.3750 | weighted=0.3000
  x <= 3.5  left [3 0] gini=0.0000 | right [1 6] gini=0.2449 | weighted=0.1714
  x <= 4.5  left [3 1] gini=0.3750 | right [1 5] gini=0.2778 | weighted=0.3167
  x <= 5.5  left [4 1] gini=0.3200 | right [0 5] gini=0.0000 | weighted=0.1600
  x <= 6.5  left [4 2] gini=0.4444 | right [0 4] gini=0.0000 | weighted=0.2667
  x <= 7.5  left [4 3] gini=0.4898 | right [0 3] gini=0.0000 | weighted=0.3429
  x <= 8.5  left [4 4] gini=0.5000 | right [0 2] gini=0.0000 | weighted=0.4000
  x <= 9.5  left [4 5] gini=0.4938 | right [0 1] gini=0.0000 | weighted=0.4444
sklearn stump: threshold=5.5  node impurities=[0.48 0.32 0.  ]  node samples=[10  5  5]
entropy stump: threshold=5.5  node impurities=[0.971  0.7219 0.    ]  by hand, log2: parent 0.9710 left 0.7219; natural log: parent 0.6730
max_depth=1    leaves=2   depth=1  train acc=0.710 test acc=0.701
max_depth=2    leaves=4   depth=2  train acc=0.737 test acc=0.751
max_depth=3    leaves=8   depth=3  train acc=0.787 test acc=0.789
max_depth=4    leaves=15  depth=4  train acc=0.827 test acc=0.785
max_depth=5    leaves=27  depth=5  train acc=0.851 test acc=0.782
max_depth=6    leaves=46  depth=6  train acc=0.878 test acc=0.772
max_depth=8    leaves=81  depth=8  train acc=0.923 test acc=0.764
max_depth=12   leaves=126 depth=12 train acc=0.973 test acc=0.739
max_depth=None leaves=159 depth=19 train acc=1.000 test acc=0.723
min_samples_leaf=20  leaves=36  depth=9  train acc=0.823 test acc=0.797
ccp_alpha=0.002     leaves=57  depth=13 train acc=0.917 test acc=0.746
ccp_alpha=0.005     leaves=11  depth=6  train acc=0.833 test acc=0.813
ccp_alpha=0.01      leaves=7   depth=5  train acc=0.816 test acc=0.800
two halves: root feature 8 vs 8; test predictions disagree on 29.3% of rows
regression tree on y=2x: predict at x=5, 10, 20, 100 -> [10. 20. 20. 20.]
```

<details><summary>Full script (prints the output above)</summary>

```python
# Decision trees: Gini of every candidate split by hand vs the split sklearn picks; depth sweep; pruning; extrapolation.
import numpy as np
from sklearn.datasets import make_classification, load_iris
from sklearn.model_selection import train_test_split
from sklearn.tree import DecisionTreeClassifier, DecisionTreeRegressor, export_text

def gini(labels):
    if len(labels) == 0: return 0.0
    p = np.bincount(labels, minlength=2) / len(labels)
    return 1 - (p ** 2).sum()

def entropy(labels, log=np.log2):
    p = np.bincount(labels, minlength=2) / len(labels); p = p[p > 0]
    return -(p * log(p)).sum()

# 0. A fitted tree is a set of nested if/else rules (iris, depth 2)
iris = load_iris()
print(export_text(DecisionTreeClassifier(max_depth=2, random_state=0).fit(iris.data, iris.target),
                  feature_names=[n.replace(" (cm)", "") for n in iris.feature_names], show_weights=True))

# 1. Ten samples, one feature
x = np.arange(1, 11, dtype=float); y = np.array([0, 0, 0, 1, 0, 1, 1, 1, 1, 1])
print("parent gini = %.4f" % gini(y))
for t in (x[:-1] + x[1:]) / 2:                       # midpoints between sorted values
    L, R = y[x <= t], y[x > t]
    w = (len(L) * gini(L) + len(R) * gini(R)) / len(y)
    print("  x <= %.1f  left %s gini=%.4f | right %s gini=%.4f | weighted=%.4f"
          % (t, np.bincount(L, minlength=2), gini(L), np.bincount(R, minlength=2), gini(R), w))
stump = DecisionTreeClassifier(max_depth=1, random_state=0).fit(x.reshape(-1, 1), y)
tr = stump.tree_
print("sklearn stump: threshold=%.1f  node impurities=%s  node samples=%s"
      % (tr.threshold[0], np.round(tr.impurity, 4), tr.n_node_samples))
ent = DecisionTreeClassifier(max_depth=1, criterion="entropy", random_state=0).fit(x.reshape(-1, 1), y).tree_
print("entropy stump: threshold=%.1f  node impurities=%s  by hand, log2: parent %.4f left %.4f; natural log: parent %.4f"
      % (ent.threshold[0], np.round(ent.impurity, 4), entropy(y), entropy(y[x <= 5.5]), entropy(y, np.log)))

# 2. Depth sweep on noisy data (20% of labels set at random)
X, Y = make_classification(n_samples=2000, n_features=10, n_informative=5, flip_y=0.2, random_state=0)
Xtr, Xte, ytr, yte = train_test_split(X, Y, test_size=0.5, random_state=0)
for depth in [1, 2, 3, 4, 5, 6, 8, 12, None]:
    m = DecisionTreeClassifier(max_depth=depth, random_state=0).fit(Xtr, ytr)
    print("max_depth=%-4s leaves=%-3d depth=%-2d train acc=%.3f test acc=%.3f"
          % (depth, m.get_n_leaves(), m.get_depth(), m.score(Xtr, ytr), m.score(Xte, yte)))
m = DecisionTreeClassifier(min_samples_leaf=20, random_state=0).fit(Xtr, ytr)
print("min_samples_leaf=20  leaves=%-3d depth=%-2d train acc=%.3f test acc=%.3f"
      % (m.get_n_leaves(), m.get_depth(), m.score(Xtr, ytr), m.score(Xte, yte)))
for a in [0.002, 0.005, 0.01]:                       # minimal cost-complexity (post-)pruning
    m = DecisionTreeClassifier(ccp_alpha=a, random_state=0).fit(Xtr, ytr)
    print("ccp_alpha=%-5g     leaves=%-3d depth=%-2d train acc=%.3f test acc=%.3f"
          % (a, m.get_n_leaves(), m.get_depth(), m.score(Xtr, ytr), m.score(Xte, yte)))

# 3. Instability: the same depth-unlimited tree fitted on two random halves of the training set
idx = np.random.default_rng(0).permutation(len(Xtr))
a = DecisionTreeClassifier(random_state=0).fit(Xtr[idx[:500]], ytr[idx[:500]])
b = DecisionTreeClassifier(random_state=0).fit(Xtr[idx[500:]], ytr[idx[500:]])
print("two halves: root feature %d vs %d; test predictions disagree on %.1f%% of rows"
      % (a.tree_.feature[0], b.tree_.feature[0], 100 * (a.predict(Xte) != b.predict(Xte)).mean()))

# 4. Extrapolation: a regression tree trained on y = 2x for x in [0, 10] predicts a constant beyond 10
xr = np.linspace(0, 10, 101).reshape(-1, 1)
reg = DecisionTreeRegressor(random_state=0).fit(xr, 2 * xr.ravel())
print("regression tree on y=2x: predict at x=5, 10, 20, 100 ->", reg.predict([[5], [10], [20], [100]]))
```

</details>

Reading it:
- **Gini table:** the parent node (4 × class 0, 6 × class 1) has Gini 0.48. The tempting split `x ≤ 3.5` produces a pure left child, yet its weighted impurity (0.1714) loses to `x ≤ 5.5` (0.1600), whose larger left child is only slightly impure. CART minimizes the weighted sum, not "the purest child".
- **sklearn stump:** threshold 5.5, node impurities `[0.48, 0.32, 0]`, node sizes `[10, 5, 5]`, exactly the hand-computed winner. The entropy stump picks the same split; its impurities (0.971, 0.7219) match base-2 logarithms.
- **Depth sweep:** training accuracy climbs from 0.710 to 1.000. Test accuracy peaks at depth 3 (0.789) and slides to 0.723 at full depth (19 levels, 159 leaves): the extra leaves fit the 20 % random labels.
- **`min_samples_leaf=20`:** 36 leaves, test 0.797. **`ccp_alpha=0.005`:** 11 leaves, test 0.813, the best result in this run. Too little pruning (`0.002`, 57 leaves, test 0.746) is close to the unpruned tree.
- **Two halves:** both trees split on feature 8 at the root, yet disagree on 29.3 % of the test rows. Below the root, small data changes cascade into different subtrees.
- **Extrapolation:** trained on `x ∈ [0, 10]`, the regression tree returns 20 (the last leaf's value) for `x = 20` and `x = 100`.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Default parameters on noisy data | Training accuracy 1.000, test 0.723 (vs 0.789 at depth 3) ✅[^3] | Fully grown, unpruned trees ✅[^2] create over-complex trees that do not generalize ✅[^1] |
| Small change in the training data | A very different tree (29.3 % of test predictions changed) ✅[^3] | Trees are unstable; ensembles mitigate it ✅[^1] |
| Predicting outside the training range | Constant: 20 at `x = 100` for `y = 2x` trained up to 10 ✅[^3] | Predictions are piecewise constant, so trees do not extrapolate ✅[^1] |
| XOR (exclusive or), parity or multiplexer patterns | Hard to learn | Trees do not express these concepts easily ✅[^1] |
| One class dominates | The tree is biased toward it | Balance the dataset (or use class weights) before fitting ✅[^1] |
| Features on very different scales | Almost no effect on the fit | Tree-based models are (almost) not affected by scaling ✅[^4] |
| Categorical features (strings) | Not accepted by scikit-learn's trees; encode them first | The implementation does not support categorical variables for now ✅[^1] → `machine-learning/data-and-features/categorical-and-missing-data.md` |
| Missing values (NaN, "not a number") | Supported with `splitter='best'` ✅[^1] | For each threshold, the splitter evaluates sending all missing values left and right, and keeps the better side ✅[^1] |
| `criterion='entropy'` values look larger than expected | 0.971 instead of 0.673 for a 40/60 node in the lab ✅[^3] | scikit-learn 1.9.1 reports entropy in base 2 (bits) in this run |
| Two runs give different trees on the same data | Possible unless `random_state` is fixed: features are permuted at each split and equal-gain ties are broken at random ✅[^2] | Set `random_state` to an integer for determinism ✅[^2] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `max_depth` (pre-pruning) | Simple to reason about; `max_depth=3` is the guide's suggested starting point ✅[^1] | Too shallow underfits: depth 1 scored 0.701 on the test set ✅[^3] |
| `min_samples_leaf` | Every decision rests on several rows; smoother leaves ✅[^2] | Too large a value prevents learning ✅[^1] |
| `ccp_alpha` (post-pruning) | Prunes the weakest branches after seeing the whole tree; best test score in the lab (0.813) ✅[^3] | Grows the full tree first, then searches its subtrees ✅[^1]; `α` itself must be tuned |
| Gini vs entropy | Picked the same split in the lab ✅[^3]; entropy equals minimizing log loss ✅[^1] | Entropy numbers are in bits in the lab, so they differ from a natural-log calculation ✅[^3] |
| One tree vs an ensemble | A white-box model whose decisions can be explained by boolean logic ✅[^1] | High variance; ensembles reduce it → `machine-learning/supervised-learning/tree-ensembles.md` |

## Takeaways
- Never ship a default `DecisionTreeClassifier` on noisy data: set `max_depth`, `min_samples_leaf` or `ccp_alpha`, chosen by cross-validation. [rule-candidate]
- A training accuracy of 1.0 from a tree is a symptom, not a result.
- Do not use a single tree where inputs can leave the training range; it will predict the edge value.
- Fix `random_state` when you need the same tree twice. [rule-candidate]
- If you need a stable, accurate tree model rather than a readable one, use a forest or gradient boosting.

## Verification status
- Verified: 49 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- [1.10. Decision Trees (scikit-learn User Guide)](https://scikit-learn.org/stable/modules/tree.html) — scikit-learn developers, living (1.9.1 docs). Backs: advantages and disadvantages (overfitting, instability, piecewise constant and no extrapolation, NP-completeness and greedy splits, XOR/parity, class bias, white box), CART, midpoint thresholds, Gini and entropy formulas, entropy = log loss, the weighted split quality `G`, stopping conditions, leaf predictions, missing values, no categorical support, cost-complexity pruning, complexity, tips on `max_depth` and `min_samples_leaf`. [^1]
- [DecisionTreeClassifier (scikit-learn API)](https://scikit-learn.org/stable/modules/generated/sklearn.tree.DecisionTreeClassifier.html) — scikit-learn developers, living (1.9.1 docs). Backs: defaults `max_depth=None`, `min_samples_split=2`, `min_samples_leaf=1`; fully grown unpruned trees by default; `random_state` and feature permutation; argmax ties go to the lowest class index. [^2]
- `machine-learning/lab-setup.md` — the lab where the iris rules, the hand-computed Gini table, the stumps, the depth and pruning sweeps, the instability and extrapolation experiments ran on 2026-11-24. [^3]
- [Importance of Feature Scaling (scikit-learn example)](https://scikit-learn.org/stable/auto_examples/preprocessing/plot_scaling_importance.html) — scikit-learn developers, living (1.9.1 docs). Backs: tree-based models are (almost) not affected by scaling. [^4]

## Related
- `machine-learning/supervised-learning/tree-ensembles.md` — bagging, random forests and gradient boosting, the fix for a single tree's variance.
- `machine-learning/foundations/generalization-and-overfitting.md` — the train/test gap in the depth sweep, in general.
- `machine-learning/data-and-features/feature-importance-and-selection.md` — what impurity-based importances mean and when they mislead.
- `machine-learning/data-and-features/categorical-and-missing-data.md` — encoding categories before a tree, native NaN support.
- `machine-learning/evaluation/cross-validation-and-hyperparameter-search.md` — choosing `max_depth` or `ccp_alpha` without the test set.
- `machine-learning/foundations/information-theory.md` — entropy and information gain.
