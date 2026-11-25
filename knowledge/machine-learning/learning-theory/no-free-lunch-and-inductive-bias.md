---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/learning-theory
status: verified
applies-to: ["any"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [machine-learning, learning-theory, no-free-lunch, inductive-bias, off-training-set-error, cross-validation, prior, model-selection]
---

# No free lunch and inductive bias: why every learner assumes something

## Summary
**TL;DR:** The NFL (no-free-lunch) theorems for supervised learning say that, averaged uniformly over every possible target function, all learning algorithms have the same expected error on inputs they were not trained on (off-training-set error). A deep network, a decision tree, "always predict class 0" and a learner built to be wrong all score the same on that average. Learning works in practice only because real problems are not uniformly random: each algorithm has an inductive bias, a preference for some functions over others, and it does well exactly where that bias matches the problem. The useful reading of NFL is not "learning is impossible" but "name your assumption": even preferring cross-validation over its opposite is an assumption about which problems you face.
**Use this when:** someone claims an algorithm is "best" without saying for which data, you choose a model family for a new problem, or you want the inductive bias of a family in one line.
**Not this doc:** sample-size guarantees for a fixed class → `machine-learning/learning-theory/pac-learning-and-vc-dimension.md`; the small-norm bias behind double descent → `machine-learning/learning-theory/double-descent.md`; how to compare models on your data → `machine-learning/evaluation/cross-validation-and-hyperparameter-search.md`.

## Problem
Inferring a general rule from a limited set of examples is not logically valid ✅[^3]: the examples say nothing about the inputs you have not seen unless you assume something about how those inputs relate to the ones you have. Without that understanding, benchmark wins get read as universal ("method X is better"), when a learning algorithm that generalizes better on data with certain distributions generalizes worse with others ✅[^4]. The NFL theorems make this precise, and they go further: with no assumption about the relationship between the candidate algorithms and the problems, one cannot even justify cross-validation over choosing the model with the *worst* validation score ✅[^1].

## Mental model
**Analogy:** an exam whose unseen questions each have a yes/no answer decided by a fair coin after you hand in your sheet. Whatever you studied and however you reason from the practice questions, you expect half of the unseen answers right. Only if the examiner's answers follow a pattern that your reasoning happens to match do you beat 50 %, and then some other examiner's pattern would make the same reasoning score below 50 %.

**Artifact:** the smallest case, worked by hand. One off-training-set point `q`, two possible targets that agree on the training data and differ only at `q`:

| Target | Label at `q` | Learner predicts 0 | Learner predicts 1 |
|---|---|---|---|
| `f₁` | 0 | right | wrong |
| `f₂` | 1 | wrong | right |
| Average over `f₁, f₂` | | 1/2 | 1/2 |

Whatever a learner predicts at `q`, from whatever training data, it is right for exactly half of the targets. Summing this over every unseen point and every training labelling gives the NFL result; the worked example checks it exhaustively.

## How it works
1. **Origin.** The first NFL theorems, for supervised learning, appeared in Wolpert's 1996 papers on the lack of a priori distinctions between learning algorithms; theorems for search and optimization followed with Macready in 1997 ✅[^1]. They formalize concerns about the legitimacy of inductive inference that date back at least to David Hume ✅[^1].
2. **Off-training-set error.** The theorems score a learner only on inputs that are not in the training set, because counting training points mixes two different abilities: recalling the training set and generalizing to unseen instances ✅[^2]. A standard OTS (off-training-set) cost averages a loss over the inputs outside the training set, weighted by how likely each input is ✅[^2].
3. **The statements.** For a broad class of loss functions ("homogeneous" ones) and any likelihood, the sum over all target functions `f` of the distribution of OTS cost does not depend on the learning algorithm; and if the prior `P(f)` over targets is uniform, the OTS cost given the training data does not depend on the algorithm either ✅[^2]. The Deep Learning book's reading: averaged over all possible data-generating distributions, every classification algorithm has the same error rate on unobserved points, so the most sophisticated algorithm does no better on average than predicting the same class for every point ✅[^3].
4. **Not about a uniform world.** The theorems do not claim the world is governed by a uniform prior ✅[^2]. They also show there are "as many" priors on which algorithm A beats B as the reverse ✅[^2], and merely saying the real-world prior is non-uniform, without naming which one, establishes nothing about which algorithm to use ✅[^2].
5. **Alignment decides performance.** An algorithm's generalization is governed by an inner product: for a symmetric loss function, how well the algorithm is aligned with the posterior distribution of target functions given the training set determines how well it generalizes ✅[^1]. That alignment is the inductive bias doing its job.
6. **Cross-validation is an assumption too.** Choosing among candidate models by the best cross-validation score, or by the worst, are both learning algorithms; over all target functions, anti-cross-validation beats cross-validation as often as the reverse ✅[^1]. Preferring cross-validation therefore corresponds to a bias in favour of some prior over targets ✅[^1].
7. **Where the free lunches are.** NFL compares algorithms considered in isolation; there is a rich set of free-lunch results about the statistical correlations among different algorithms' errors ✅[^2].
8. **The practical consequence.** Machine learning research cannot seek a universally best algorithm; it must understand which distributions matter in the real world and which algorithms do well on them ✅[^3], and build preferences into the learner that align with the task ✅[^3]. There is no best form of regularization either ✅[^3].

**Inductive bias by model family** (what each one assumes about the function it is learning):

| Family | Inductive bias | When it fits |
|---|---|---|
| Linear models | The output is a linear function of the inputs ✅[^3] | Relationships close to linear; poor for something like `sin(x)` ✅[^3] |
| k-NN (k-nearest neighbours) | A new point gets the labels of the training points nearest to it under the chosen distance; the distance metric encodes the bias ✅[^4] | Different metrics give different predictors on finite data ✅[^4] |
| Decision trees | A piecewise constant function built from simple decision rules on the features ✅[^6] | Poor at extrapolation: predictions are neither smooth nor continuous ✅[^6] |
| Deep MLP (multilayer perceptron) | A complicated function built by composing simpler functions ✅[^4] | Targets that are compositions of simpler functions ✅[^4] |
| CNN (convolutional neural network) | Translation invariance and locality: the same detector everywhere, early layers look only at small neighbourhoods ✅[^5] | Images; if images were not translation invariant, such models might struggle even to fit the training data ✅[^5] |
| Minimum-norm interpolation (random features, kernels) | The smoothest, smallest-norm function that fits the data, a form of Occam's razor ✅[^7] | Worked on MNIST (handwritten digits) and other real and synthetic data in Belkin et al. ✅[^7] |

## Worked example
Every target function on a tiny domain, enumerated. The domain is the 8 points of `{0,1}³`; 5 of them are the training inputs and the other 3 are off-training-set. All `2⁸ = 256` labelings are possible targets. For each target, four learners see the 5 training labels and predict the 3 unseen ones: 1-NN with Hamming distance (count of differing bits), majority vote, a scikit-learn decision tree, and anti-1-NN (1-NN's predictions flipped, a learner designed to be wrong). OTS accuracy is averaged over all 256 targets, then separately over the 104 linearly separable targets (a "structured world") and the other 152. Exact fractions come from Python's `Fraction`. Lab run (`machine-learning/lab-setup.md`), 2026-11-24, scikit-learn 1.9.1, SciPy 1.18.1, two runs identical ✅[^8]:

```text
mean off-training-set accuracy
learner             all 256  separable (104)      other (152)
1-NN             1/2 =0.500     33/52 =0.635     31/76 =0.408
majority         1/2 =0.500     31/52 =0.596     33/76 =0.434
tree             1/2 =0.500      9/13 =0.692      7/19 =0.368
anti-1-NN        1/2 =0.500     19/52 =0.365     45/76 =0.592
```

<details><summary>Full script (prints the output above)</summary>

```python
# No free lunch by exhaustive enumeration: every target function on a tiny domain, off-training-set accuracy.
import itertools
from fractions import Fraction
import numpy as np
from scipy.optimize import linprog
from sklearn.tree import DecisionTreeClassifier

X = np.array(list(itertools.product([0, 1], repeat=3)), float)   # the 8 points of {0,1}^3
train, ots = [0, 1, 2, 4, 7], [3, 5, 6]                            # 5 training points, 3 off-training-set (OTS)

def one_nn(ytr):                                                   # Hamming-distance 1-NN, lowest index wins ties
    d = np.abs(X[ots][:, None, :] - X[train][None, :, :]).sum(-1)
    return ytr[d.argmin(axis=1)]
def majority(ytr):
    return np.full(len(ots), int(ytr.sum() * 2 > len(ytr)))
def tree(ytr):
    if len(set(ytr)) == 1:
        return np.full(len(ots), ytr[0])
    return DecisionTreeClassifier(random_state=0).fit(X[train], ytr).predict(X[ots]).astype(int)
def anti_nn(ytr):                                                  # deliberately the opposite of 1-NN
    return 1 - one_nn(ytr)
learners = {"1-NN": one_nn, "majority": majority, "tree": tree, "anti-1-NN": anti_nn}

def linearly_separable(f):                                         # LP feasibility: y_i (w.x_i + b) >= 1
    s = np.where(f == 1, 1.0, -1.0)
    A = -s[:, None] * np.hstack([X, np.ones((8, 1))])
    return linprog(np.zeros(4), A_ub=A, b_ub=-np.ones(8), bounds=[(None, None)] * 4).status == 0

targets = [np.array(f) for f in itertools.product([0, 1], repeat=8)]   # all 2^8 = 256 target functions
sep = [linearly_separable(f) for f in targets]
groups = {"all 256": [True] * 256, f"separable ({sum(sep)})": sep, f"other ({256 - sum(sep)})": [not s for s in sep]}
print("mean off-training-set accuracy")
print(f"{'learner':10s}" + "".join(f"{g:>17s}" for g in groups))
for name, learn in learners.items():
    acc = [Fraction(int((learn(f[train]) == f[ots]).sum()), len(ots)) for f in targets]
    row = [sum(a for a, keep in zip(acc, m) if keep) / sum(m) for m in groups.values()]
    print(f"{name:10s}" + "".join(f"{str(r):>10s} ={float(r):.3f}" for r in row))
```
</details>

Reading it:
- **All 256 targets:** every learner, including the one designed to be wrong, scores exactly `1/2`, not approximately: the NFL statement on a domain small enough to enumerate.
- **Separable targets (104):** labelings a single plane can produce, a world with structure. Here the learners separate: the tree is best (9/13 = 0.692), 1-NN 0.635, majority 0.596, and anti-1-NN falls to 0.365.
- **The other 152:** the order reverses: anti-1-NN 0.592 is now best and the tree worst (0.368).
- **Conservation, as arithmetic:** for 1-NN, `104 × 33/52 + 152 × 31/76 = 66 + 62 = 128 = 256 × 1/2`. Every point of accuracy a learner gains on the structured targets it loses on the rest. The domain decides who wins; which domain you are in is an assumption, not something the training data alone can tell you.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Error measured including training points | A memorizing learner looks better than it is | OTS cost separates recall from generalization ✅[^2] |
| "The real world is not uniform, so NFL doesn't apply" | Not enough on its own | A non-uniform prior that is not specified establishes nothing about which algorithm to use ✅[^2] |
| Choosing models by cross-validation | Justified only by an assumption about the problems | Anti-cross-validation wins as often over all targets ✅[^1] |
| A benchmark win | Holds for that benchmark's distribution | Better on some distributions means worse on others ✅[^4]; lab: tree best on separable targets, worst on the rest ✅[^8] |
| NFL for optimization (search) | A separate set of theorems | Published after the supervised-learning ones ✅[^1] |
| Comparing several algorithms' errors jointly | Free lunches can exist | NFL only compares algorithms in isolation ✅[^2] |
| CNN on data without translation structure | May struggle even to fit training data | Its bias disagrees with reality ✅[^5] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Strong inductive bias (CNN, linear model) | Sample-efficient when the bias agrees with reality ✅[^5]; fewer parameters ✅[^5] | Fails where the assumption is wrong ✅[^5] ✅[^3] |
| Weak bias (very flexible class) | Can fit many kinds of targets | Needs a preference from elsewhere (regularization, training procedure) to generalize ✅[^3] |
| Cross-validation to pick the bias | Uses the data you have | Rests on an implicit prior over problems ✅[^1] |

## Takeaways
- Never claim an algorithm is better without naming the data distribution or benchmark it was better on. [rule-candidate]
- Choose a model family by asking what structure the target has (smoothness, locality, rules, linearity) and matching the bias to it.
- Judge generalization on inputs not in the training set; training-set accuracy measures recall.
- When two families tie on validation data, the tie-breaker is a stated assumption about the problem, not the data.

## Verification status
- Verified: 46 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- [What is important about the No Free Lunch theorems?](https://arxiv.org/html/2007.10928v1) — Wolpert, 2020. Backs: the 1996 origin and the later search theorems, the link to Hume, the inner-product (alignment) formula, anti-cross-validation vs cross-validation, cross-validation as an implicit prior. [^1]
- [The Implications of the No-Free-Lunch Theorems for Meta-induction](https://arxiv.org/html/2103.11956v3) — Wolpert, 2021. Backs: off-training-set cost and why it separates recall from generalization, the two formal NFL statements, "as many priors", non-uniform priors, NFL not assuming a uniform world, free lunches in error correlations. [^2]
- [Deep Learning, chapter 5: Machine Learning Basics](https://www.deeplearningbook.org/contents/ml.html) — Goodfellow, Bengio, Courville, 2016. Backs: induction is not logically valid, the DL-book NFL statement, no universal best algorithm, building preferences into learners, no best regularization, linear hypothesis space and its limits. [^3]
- [Generalization in Deep Learning (Dive into Deep Learning, 5.5)](https://d2l.ai/chapter_multilayer-perceptrons/generalization-deep.html) — Dive into Deep Learning (d2l.ai), living. Backs: better on some distributions and worse on others, inductive bias as a preference, MLP composition bias, distance metric as the bias of 1-NN. [^4]
- [From Fully Connected Layers to Convolutions (Dive into Deep Learning, 7.1)](https://d2l.ai/chapter_convolutional-neural-networks/why-conv.html) — Dive into Deep Learning (d2l.ai), living. Backs: translation invariance and locality, parameter reduction, learning depends on inductive bias, failure when the bias disagrees with reality. [^5]
- [Decision Trees (scikit-learn 1.9.1 User Guide, section 1.10)](https://scikit-learn.org/stable/modules/tree.html) — scikit-learn developers, living. Backs: simple decision rules, piecewise constant approximation, poor extrapolation. [^6]
- [Reconciling modern machine learning practice and the bias-variance trade-off](https://arxiv.org/html/1812.11118v2) — Belkin, Hsu, Ma, Mandal, 2018. Backs: the smallest-norm interpolating function as an Occam's-razor inductive bias, its success on MNIST and other data. [^7]
- `machine-learning/lab-setup.md` — the lab where all 256 target functions on `{0,1}³` were enumerated for four learners on 2026-11-24. [^8]

## Related
- `machine-learning/learning-theory/pac-learning-and-vc-dimension.md` — guarantees once a hypothesis class (a bias) is fixed.
- `machine-learning/learning-theory/double-descent.md` — the small-norm bias at work past the interpolation threshold.
- `machine-learning/foundations/regularization.md` — preferences written into the training objective.
- `machine-learning/supervised-learning/k-nearest-neighbors.md` — distance as the bias of k-NN.
- `machine-learning/supervised-learning/decision-trees.md` — the piecewise constant bias in detail.
- `machine-learning/deep-learning/convolutional-networks.md` — locality and weight sharing as architecture.
- `machine-learning/evaluation/cross-validation-and-hyperparameter-search.md` — the procedure NFL says rests on an assumption.
