---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/learning-theory
status: verified
applies-to: ["any"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [machine-learning, learning-theory, pac-learning, vc-dimension, shattering, sample-complexity, generalization-bound, capacity]
---

# PAC learning and VC dimension: what a sample-size guarantee says

## Summary
**TL;DR:** PAC (probably approximately correct) learning makes "learning from finite data" precise: a class of models is learnable if, from enough examples drawn from any fixed distribution, an algorithm returns a model whose error is at most `ε` ("approximately correct") with probability at least `1 − δ` ("probably"). The number of examples needed, the sample complexity, grows with `1/ε`, with `log(1/δ)` and with the class's capacity: `log |C|` for a finite class, the VC (Vapnik–Chervonenkis) dimension for an infinite one. The VC dimension is the size of the largest point set the class can label in every possible way; lines in the plane have VC dimension 3. These bounds are distribution-free worst cases, so they are loose, and they depend only on the class, so they cannot explain why one large network generalizes on real labels and not on random ones.
**Use this when:** you meet ε–δ guarantees, "sample complexity" or "VC dimension" in a paper, want to know how many samples a guarantee demands, or wonder why classical bounds say little about deep networks.
**Not this doc:** the practical bias–variance trade-off and learning curves → `machine-learning/foundations/generalization-and-overfitting.md`; why bigger models can generalize better → `machine-learning/learning-theory/double-descent.md`; why no learner wins everywhere → `machine-learning/learning-theory/no-free-lunch-and-inductive-bias.md`.

## Problem
A model can do very well on its training set and badly on new inputs; a guarantee has to cover the whole input space, not only the training sample ✅[^1]. Training error is in general a biased estimate of the true error, because the model was chosen using that same data ✅[^8]. "More data helps" and "simpler models generalize" are intuitions; without a definition, nobody can say how much data a given model class needs, why a class with only two parameters can still be unlearnable, or what a published bound does not promise.

## Mental model
**Analogy:** a quality inspector at a factory. She draws `m` items at random from the production line, whatever its mix of products, and must issue a certificate "at most 5 % of all items are defective" (`ε = 0.05`) that is wrong at most 5 % of the times she issues one (`δ = 0.05`). PAC asks how large `m` must be for that certificate to be honest, for every possible factory. VC dimension measures how many items a rule book can sort "in any way you like": if a set of `d` items can be split every one of the `2^d` ways by some rule, the rule book has VC dimension at least `d`.

**Artifact:** shattering by brute force. For lines in the plane, `sign(w₁·x₁ + w₂·x₂ + b)`, a linear-programming feasibility test decides whether a labelling is realizable (SciPy's `linprog` returns status 0 when it finds a feasible point ✅[^7]). Lab run (`machine-learning/lab-setup.md`), 2026-11-24, SciPy 1.18.1, two runs identical ✅[^6]:

```text
3 points (triangle):   8 of 8 labellings realised
3 points (collinear):  6 of 8, missing ['010', '101']
4 points (square):     14 of 16, missing ['0011', '1100']
4 points, 200 random sets: best = 14 of 16
```

Three points in general position are shattered (all 8 labellings), so the VC dimension is at least 3; three collinear points are not, which is fine, because the definition needs only one shattered set ✅[^1]. Four points fail: the two XOR (exclusive-or) labellings of the square (diagonal corners `(0,0), (1,1)` against `(1,0), (0,1)`) are impossible, and none of 200 random 4-point sets reached 16 ✅[^6]. Proving that no 4-point set works takes an argument, not a search ✅[^1].

<details><summary>Full script (prints the output above)</summary>

```python
# Brute-force shattering: can lines in 2-D (sign(w1*x1 + w2*x2 + b)) produce every labelling?
import itertools
import numpy as np
from scipy.optimize import linprog

def separable(X, y):
    """True if some (w, b) gives y_i * (w.x_i + b) >= 1 for all i (a linear-programming feasibility test)."""
    s = np.where(y == 1, 1.0, -1.0)
    A_ub = -s[:, None] * np.hstack([X, np.ones((len(X), 1))])   # -s_i * [x_i, 1] . [w, b] <= -1
    res = linprog(c=np.zeros(3), A_ub=A_ub, b_ub=-np.ones(len(X)), bounds=[(None, None)] * 3)
    return res.status == 0                                          # 0 = a feasible point was found

def count_labellings(X):
    labs = [np.array(l) for l in itertools.product([0, 1], repeat=len(X))]
    ok = [l for l in labs if separable(X, l)]
    return len(ok), len(labs), ["".join(map(str, l)) for l in labs if not separable(X, l)]

three = np.array([[0, 0], [1, 0], [0, 1]], float)
print("3 points (triangle):   %d of %d labellings realised" % count_labellings(three)[:2])
line3 = np.array([[0, 0], [1, 0], [2, 0]], float)
n, tot, bad = count_labellings(line3)
print("3 points (collinear):  %d of %d, missing %s" % (n, tot, bad))
square = np.array([[0, 0], [1, 1], [1, 0], [0, 1]], float)
n, tot, bad = count_labellings(square)
print("4 points (square):     %d of %d, missing %s" % (n, tot, bad))
rng = np.random.default_rng(0)
best = max(count_labellings(rng.normal(size=(4, 2)))[0] for _ in range(200))
print("4 points, 200 random sets: best =", best, "of 16")
```
</details>

## How it works
**The PAC definition.** The model was introduced by Valiant in 1984 ✅[^1]. It assumes the training examples are drawn independently from a distribution `D` that is unknown and fixed for training and testing ✅[^1].
1. **Error.** For a hypothesis `h` (a candidate model from the class `C`), `err(h)` is the probability that an example drawn from `D` is misclassified ✅[^1].
2. **Accuracy and confidence.** The learner is given `ε` (allowed error) and `δ` (allowed failure probability) and must output `h` with `P(err(h) ≤ ε) ≥ 1 − δ` ✅[^1]. In the realizable case some `h` in `C` has zero error; otherwise the target is `err(h) ≤ Opt(C) + ε`, where `Opt(C)` is the lowest error any `h` in `C` achieves ✅[^1].
3. **Learnable.** `C` is PAC learnable if an algorithm and a sample size `m₀(ε, δ)` exist such that for any `m ≥ m₀` and **any** distribution `D` the guarantee in step 2 holds ✅[^1]. `m₀` may not depend on `D` ✅[^1]; smaller `ε` or `δ` needs more samples ✅[^1]. The notes' first statement of the model also asks the algorithm to be efficient: running time polynomial in `1/ε`, `ln(1/δ)` and the problem size ✅[^1].

**Sample complexity of a finite class.** Any algorithm that outputs a hypothesis consistent with the training set (zero training errors) PAC-learns a finite class in the realizable case with `m ≥ (1/ε)·ln(|C|/δ)` ✅[^1]. The proof: a hypothesis with error above `ε` survives `m` independent examples with probability at most `(1 − ε)^m < e^(−εm)`, and a union bound over the `|C|` hypotheses multiplies that by `|C|` ✅[^1]. Worked numbers: `|C| = 1001`, `ε = δ = 0.05` gives `20 · ln(20,020) = 198.1`, so 199 examples. Without a consistent hypothesis (unrealizable), minimizing the training error needs `(2/ε²)·ln(2|C|/δ)` ✅[^1]: `800 · ln(40,040) = 8,478` for the same numbers, 43 times more, because of the `1/ε²`.

**VC dimension, for infinite classes.**
1. **Shattering.** A set `S` of `m` points is shattered by `C` if the hypotheses in `C` produce all `2^m` labellings of `S` ✅[^1].
2. **VC dimension.** The size of the largest shattered set; infinite if arbitrarily large sets are shattered ✅[^1] ✅[^2]. To show `VC ≥ d` one set of `d` points suffices; to show `VC ≤ d` no set of `d + 1` points may be shattered ✅[^1].
3. **Examples.** Lines in the plane: 3 ✅[^1] ✅[^3]; hyperplanes in `R^n`: `n + 1` ✅[^1]; axis-aligned rectangles: at least 4 ✅[^1]. Parameter count is not the measure: `sign(sin(ω·x + φ))` has only two parameters, a frequency `ω` and a phase `φ`, yet infinite VC dimension, because a large enough `ω` with a suitable phase realizes any labelling of any finite set of points on the line ✅[^1]. For a finite class, `VC ≤ log₂ |C|` ✅[^1].
4. **Why it replaces `|C|`.** Beyond `m = d` the number of labellings a class can produce on `m` points grows only polynomially, at most `(e·m/d)^d`, instead of `2^m` (Sauer's lemma) ✅[^1]. A consistent learner then PAC-learns with `m ≥ c₀ · ((1/ε)·log(1/δ) + (d/ε)·log(1/ε))` for some constant `c₀` ✅[^1], and `Ω(d/ε)` examples are also necessary ✅[^1]. A class with infinite VC dimension is not PAC learnable ✅[^1].
5. **The bound practitioners quote.** With probability at least `1 − δ`, the gap between true and training error is at most about `c·√((VC − log δ)/n)` for `n` examples, a constant `c` set by the loss scale ✅[^3]; other statements add a `ln n` factor ✅[^4]. Worked number without the constant: lines in the plane (`VC = 3`), `δ = 0.05`, `n = 1000`: `√((3 + 3.00)/1000) = 0.077`.

**What the bounds do not say.**
- They are worst cases over all distributions, so they are loose: they "rarely" guide deep learning practice ✅[^2], and they tend to demand far more examples than needed ✅[^3].
- They depend on the class, not on the data or labels. VC dimension tends to grow with the parameter count, so the bound becomes useless once parameters exceed the sample size ✅[^4]. State-of-the-art convolutional networks easily fit a random labelling of their training images ✅[^5], yet such networks generalize on real labels, which class-capacity bounds cannot explain ✅[^3].

Lab run (`machine-learning/lab-setup.md`), 2026-11-24, scikit-learn 1.9.1, 8×8 digits, one hidden layer of 512 units, no weight penalty, two runs identical: one network fit both label sets to 100 % ✅[^6]:

```text
true labels   n_train=898 params=38410 train acc=1.000 test acc=0.978 epochs=3000
random labels n_train=898 params=38410 train acc=1.000 test acc=0.086 epochs=3000
```

Same class, same training accuracy, test accuracy 0.978 versus chance level (about 0.1 for 10 classes). Any bound computed from the class and the training error alone is identical for both rows, so it cannot be tight for both.

<details><summary>Full script (prints the two lines above)</summary>

```python
# Zhang et al.-style randomization test on the 8x8 digits: same network, true labels vs random labels.
import warnings
import numpy as np
from sklearn.exceptions import ConvergenceWarning
from sklearn.datasets import load_digits
from sklearn.model_selection import train_test_split
from sklearn.neural_network import MLPClassifier

warnings.filterwarnings("ignore", category=ConvergenceWarning)   # training runs a fixed 3000 epochs
X, y = load_digits(return_X_y=True)
X = X / 16.0                                              # pixel values 0..16 -> 0..1
Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.5, random_state=0)
rng = np.random.default_rng(0)
labels = {"true labels": ytr, "random labels": rng.integers(0, 10, size=len(ytr))}
for name, yfit in labels.items():
    net = MLPClassifier(hidden_layer_sizes=(512,), alpha=0.0, max_iter=3000, tol=1e-6,
                        n_iter_no_change=3000, random_state=0)
    net.fit(Xtr, yfit)
    print(f"{name:13s} n_train={len(Xtr)} params={sum(w.size for w in net.coefs_ + net.intercepts_)} "
          f"train acc={net.score(Xtr, yfit):.3f} test acc={net.score(Xte, yte):.3f} epochs={net.n_iter_}")
```
</details>

## Worked example
The finite-class bound, checked by simulation. The class is 1001 thresholds `h_k(x) = 1 if x ≥ k/1000`; the target is `k = 300`; `D` is uniform on `[0, 1]`, so the true error of threshold `θ` is `|θ − 0.3|`. The bound says any consistent learner reaches `err ≤ 0.05` with probability at least 0.95 from 199 examples. To test "any consistent learner", the simulation picks the **worst** consistent threshold each time (the one farthest from 0.3), over 20,000 training sets per sample size. Lab run (`machine-learning/lab-setup.md`), 2026-11-24, NumPy 2.5.5, two runs identical ✅[^6]:

```text
|C|=1001 eps=0.05 delta=0.05 -> m0 = ceil(20 * ln(1001/0.05)) = 199
m=  20  P(err > eps) = 0.5879   mean err = 0.0712
m=  40  P(err > eps) = 0.2394   mean err = 0.0363
m=  60  P(err > eps) = 0.0851   mean err = 0.0241
m=  80  P(err > eps) = 0.0306   mean err = 0.0180
m= 199  P(err > eps) = 0.0002   mean err = 0.0071
```

<details><summary>Full script (prints the output above)</summary>

```python
# PAC bound for a finite class, checked by simulation.
# Class C: 1001 thresholds h_k(x) = 1 if x >= k/1000 (k = 0..1000). Target: k = 300. D: uniform on [0, 1].
import math
import numpy as np

K, target, eps, delta = 1001, 300, 0.05, 0.05
m0 = math.ceil((1 / eps) * math.log(K / delta))          # sufficient sample size for any consistent learner
print(f"|C|={K} eps={eps} delta={delta} -> m0 = ceil({1/eps:.0f} * ln({K}/{delta})) = {m0}")

grid = np.arange(K) / 1000                               # threshold of each hypothesis
rng = np.random.default_rng(0)

def worst_consistent_error(m):
    x = rng.uniform(0, 1, m)
    y = x >= target / 1000
    lo = x[~y].max() if (~y).any() else -1.0             # largest negative example
    hi = x[y].min() if y.any() else 2.0                  # smallest positive example
    consistent = grid[(grid > lo) & (grid <= hi)]        # thresholds that label every example correctly
    return np.abs(consistent - target / 1000).max()      # true error under uniform D = |threshold - 0.3|

trials = 20000
for m in [20, 40, 60, 80, m0]:
    errs = np.array([worst_consistent_error(m) for _ in range(trials)])
    print(f"m={m:4d}  P(err > eps) = {np.mean(errs > eps):.4f}   mean err = {errs.mean():.4f}")
```
</details>

Reading it:
- **The guarantee holds:** at `m = 199` the failure rate is 0.0002 (4 of 20,000 training sets), far below `δ = 0.05`.
- **It is loose:** the failure rate already drops below 0.05 between `m = 60` (0.0851) and `m = 80` (0.0306), so this problem needs about 2.5 times fewer examples than the bound demands. The bound pays for the union over all 1001 hypotheses and for every possible `D`; this particular `D` and class are easy.
- **Shape:** the mean error falls roughly like `1/m` (0.0363 at `m = 40`, 0.0180 at `m = 80`), the `1/ε` dependence of the realizable case.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| A class with two parameters, `sign(sin(ω·x + φ))` | Infinite VC dimension; not PAC learnable | VC dimension is not a parameter count ✅[^1]; infinite VC ⇒ not learnable ✅[^1] |
| Collinear points in the plane | Not shattered by lines, yet VC = 3 | The definition needs one shattered set, not all ✅[^1]; lab: 6 of 8 ✅[^6] |
| "Linear models have VC dimension `d`" vs "`d + 1`" | Both appear | Hardt and Recht give `d`, equal to the number of model parameters (so no bias term) ✅[^4]; `d + 1` counts the bias of a general hyperplane ✅[^1] ✅[^3] |
| No hypothesis fits the data (noise) | Bound changes from `1/ε` to `1/ε²` | Unrealizable case: `(2/ε²)·ln(2|C|/δ)` ✅[^1] |
| Deep network with more parameters than examples | VC-style bound is vacuous | It becomes useless once parameters exceed the sample size ✅[^4]; random labels fit too ✅[^5] |
| Explicit regularization on random labels | Still fits them | The randomization result is qualitatively unaffected by explicit regularization ✅[^5] |
| Capacity of a trained network | Smaller than the architecture allows | Effective capacity is limited by the optimizer ✅[^2] |
| Bounds that use the data (margins) | Can be useful where parameter counts are not | A margin bound on hyperplanes has no data-dimension term ✅[^4] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `log |C|` bound (finite classes) | Simple: `(1/ε)·ln(|C|/δ)` ✅[^1] | Meaningless for infinite classes ✅[^1] |
| VC bound | Covers infinite classes; refines the cardinality bound ✅[^4] | Constant `c₀` unspecified ✅[^1]; pessimistic for complex models ✅[^3] |
| Held-out test set | Unbiased estimate converging at `O(1/√n)` ✅[^3] | Says nothing in advance; reuse erodes it ✅[^3] |
| Data-dependent bounds (margins) | Can avoid the parameter count ✅[^4] | Need properties of the data, not just the class ✅[^4] |

## Takeaways
- Read an ε–δ bound as a worst case over all distributions: it is a sufficient sample size, usually far above what a real problem needs.
- Capacity is not parameter count: check shattering, not the number of weights.
- Do not use class-capacity bounds to argue a large network will or will not generalize; measure on held-out data. [rule-candidate]
- The realizable `1/ε` and the noisy `1/ε²` differ by orders of magnitude: label noise is expensive in samples.

## Verification status
- Verified: 64 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- [Introduction to Machine Learning: Class Notes 67577](https://arxiv.org/html/0904.3664v1) — Shashua, 2009. Backs: the PAC model and its assumptions, Valiant 1984, realizable and unrealizable cases, the formal definition, `m₀` independent of `D`, finite-class bounds and proof, shattering, VC dimension and examples, `sin` example, `VC ≤ log₂ |C|`, Sauer's lemma, the VC sample bound, `Ω(d/ε)`, infinite VC not learnable. [^1]
- [Deep Learning, chapter 5: Machine Learning Basics](https://www.deeplearningbook.org/contents/ml.html) — Goodfellow, Bengio, Courville, 2016. Backs: VC dimension as capacity of a binary classifier, bounds rarely used in deep learning, effective capacity limited by optimization. [^2]
- [Generalization in Classification (Dive into Deep Learning, 4.6)](https://d2l.ai/chapter_linear-classification/generalization-classification.html) — Dive into Deep Learning (d2l.ai), living. Backs: the `√((VC − log δ)/n)` bound, `d + 1` for linear models, 3 but not 4 points, pessimism, test sets at `O(1/√n)` and reuse, bounds powerless for deep networks. [^3]
- [Generalization (Patterns, Predictions, and Actions)](https://mlstory.org/generalization.html) — Hardt, Recht, living. Backs: VC inequality with `ln n`, `VC ≤ log|F| + 1`, linear models over `R^d` have VC dimension `d`, bound useless beyond the sample size, margin-based bound. [^4]
- [Understanding deep learning requires rethinking generalization (abstract)](https://arxiv.org/abs/1611.03530v2) — Zhang, Bengio, Hardt, Recht, Vinyals, 2016. Backs: networks fit random labels, unaffected by explicit regularization. [^5]
- `machine-learning/lab-setup.md` — the lab where the shattering search, the threshold PAC simulation and the random-label test ran on 2026-11-24. [^6]
- [scipy.optimize.linprog](https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.linprog.html) — SciPy developers, living. Backs: status 0 = success, 2 = infeasible. [^7]
- [Generalization (Dive into Deep Learning, 3.6)](https://d2l.ai/chapter_linear-regression/generalization.html) — Dive into Deep Learning (d2l.ai), living. Backs: training error is in general a biased estimate of the true error. [^8]

## Related
- `machine-learning/foundations/generalization-and-overfitting.md` — train/test splits, bias–variance and learning curves in practice.
- `machine-learning/learning-theory/double-descent.md` — risk falling again past the interpolation threshold.
- `machine-learning/learning-theory/no-free-lunch-and-inductive-bias.md` — why every guarantee rests on an assumption about the problem.
- `machine-learning/supervised-learning/support-vector-machines.md` — the maximum-margin classifier behind margin bounds.
- `machine-learning/evaluation/cross-validation-and-hyperparameter-search.md` — estimating generalization from data instead of bounds.
- `machine-learning/learning-theory/online-learning.md` — regret bounds for data that arrive one at a time, with no i.i.d. assumption.
