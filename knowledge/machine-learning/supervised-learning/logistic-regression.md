---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/supervised-learning
status: verified
applies-to: ["scikit-learn 1.9.1", "NumPy 2.5.5"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [machine-learning, supervised-learning, logistic-regression, sigmoid, log-odds, softmax, multinomial, decision-boundary, regularization, scikit-learn]
---

# Logistic regression: sigmoid, log-odds and scikit-learn's C

## Summary
**TL;DR:** Logistic regression is a linear classifier. It computes the same score as linear regression, `z = w·x + b`, and turns it into a probability with the sigmoid, `p = σ(z) = 1/(1 + e^(−z))`. The score is the log-odds `log(p/(1−p))`, so `e^(w_j)` is the factor by which one more unit of feature `j` multiplies the odds. The decision boundary `z = 0` (probability 0.5) is a straight line or flat plane. With K classes, the multinomial version uses one score per class and a softmax. scikit-learn adds a penalty by default (`C=np.inf` turns it off): `C` is the inverse of its strength, so a smaller `C` means smaller weights and probabilities pulled toward 0.5.
**Use this when:** you train or read a logistic regression, need to turn its coefficients into odds, choose `C`, or wonder why `predict_proba` and `decision_function` disagree in scale.
**Not this doc:** the log-loss / cross-entropy loss and why it is the maximum-likelihood loss → `machine-learning/foundations/loss-functions-and-maximum-likelihood.md`; what the penalty does in general → `machine-learning/foundations/regularization.md`; whether the probabilities can be trusted → `machine-learning/evaluation/probability-calibration.md`; choosing a threshold other than 0.5 → `machine-learning/evaluation/classification-metrics.md`.

## Problem
Despite its name, logistic regression is a classifier, and its outputs are easy to misread. The raw coefficients are not changes in probability: the same `+2` on the score moves the probability from 0.50 to 0.88, but from 0.88 only to 0.98 ✅[^4]. scikit-learn applies a penalty by default ✅[^1], so the "plain" model differs from the one in a statistics package, and on perfectly separable data an unpenalized fit has no finite answer at all (the lab weights grew from 37 to 180 as the solver's tolerance was tightened ✅[^4]). And a straight boundary cannot separate classes arranged like a checkerboard ✅[^4].

## Mental model
**Analogy:** a points-based score card, like the ones lenders use. Each feature adds or removes points (its weight times its value), plus a fixed starting score (the intercept). A lookup table, the sigmoid, then converts the total into a probability. A score of 0 means 50/50. Every extra point multiplies the odds ("3 to 1") by the same factor, `e ≈ 2.718`, but the change in probability shrinks as you approach 0 % or 100 %.

**Artifact:** that lookup table, printed by the lab script in the Worked example ✅[^4]:

```text
z=-4  sigmoid(z)=0.0180  odds p/(1-p)=  0.018  log-odds=-4.0
z=-2  sigmoid(z)=0.1192  odds p/(1-p)=  0.135  log-odds=-2.0
z=+0  sigmoid(z)=0.5000  odds p/(1-p)=  1.000  log-odds=+0.0
z=+2  sigmoid(z)=0.8808  odds p/(1-p)=  7.389  log-odds=+2.0
z=+4  sigmoid(z)=0.9820  odds p/(1-p)= 54.598  log-odds=+4.0
```

The log-odds column equals `z` on every row: the sigmoid's inverse is the log-odds.

## How it works
Symbols: `x` is one example's feature vector; `w` the weights (`coef_`), `b` the intercept (`intercept_`); `z = w·x + b` is the score that scikit-learn's `decision_function` returns; `p` is the predicted probability of class 1; `y ∈ {0, 1}` is the true label; `n` is the number of training rows.

1. **Score.** `z = w·x + b`, a linear model exactly as in `machine-learning/supervised-learning/linear-regression.md` ✅[^1]. Lab row 0: `x = [1.3654, 1.1985]`, `w = [−2.1258, 2.9971]`, `b = 1.4843` gives `z = −2.9026 + 3.5921 + 1.4843 = 2.1737` ✅[^4].
2. **Probability.** `predict_proba` returns `p = expit(z) = 1/(1 + exp(−z))`, the logistic (sigmoid) function ✅[^1]. Row 0: `σ(2.1737) = 0.8979` ✅[^4].
3. **Log-odds.** Logistic regression is a generalized linear model with a Bernoulli distribution and a logit link ✅[^1]: `log(p/(1 − p)) = z`. So raising feature `j` by 1, with the others fixed, adds `w_j` to the log-odds and multiplies the odds by `e^(w_j)`. Lab: raising `x₁` by 1 multiplied row 0's odds by `0.1193 = e^(−2.1258)` ✅[^4].
4. **Decision.** The probability is turned into a class by a threshold, 0.5 by default ✅[^1]. Since `σ(0) = 0.5`, that is the same as `z > 0`, so the boundary `w·x + b = 0` is a line in 2-D and a flat hyperplane in more dimensions ✅[^4].
5. **Loss.** Training minimizes the average log loss, `−[y·log p + (1 − y)·log(1 − p)]`, plus the penalty divided by `C` (and by the total sample weight, which is `n` when all weights are 1) ✅[^1]. Row 0 has `y = 1` and `p = 0.8979`, so its loss is `−log 0.8979 = 0.108`; the lab's average over 300 rows is `0.239427` ✅[^4]. Why this loss: `machine-learning/foundations/loss-functions-and-maximum-likelihood.md`.
6. **`C` and the penalty.** The default penalty is L2 (`½‖w‖²`, half the sum of squared weights, at `l1_ratio=0`). `l1_ratio=1` gives L1 (`‖w‖₁`, the sum of absolute weights), and values in between give Elastic-Net ✅[^1]. `C` is the inverse of the regularization strength: smaller `C` means stronger regularization, and `C=np.inf` removes the penalty ✅[^2]. Regularization is on by default, common in machine learning but not in statistics ✅[^1].
7. **Multinomial (K classes).** Each class `k` gets its own weight row `W_k` and score `z_k`, and `p_k = exp(z_k) / Σ_l exp(z_l)`, the softmax ✅[^1]. scikit-learn deliberately keeps K weight vectors although K − 1 would suffice ✅[^1]. The softmax keeps the scores' order, so the predicted class is simply the highest score ✅[^3]. The gradient of the loss with respect to each score is `softmax(z)_k − y_k`, predicted probability minus the one-hot label ✅[^3]. Iris (3 classes, 4 features): `coef_` has shape `(3, 4)` ✅[^4].
8. **Solvers.** The default solver is `lbfgs` ✅[^2], a quasi-Newton method that approximates the BFGS (Broyden–Fletcher–Goldfarb–Shanno) algorithm ✅[^1]. For three or more classes, every solver except `liblinear` minimizes the full multinomial loss; `liblinear` raises an error ✅[^2].

## Worked example
A 2-feature, 300-row synthetic problem (`make_classification`), then a `C` sweep, separable data, an XOR pattern (exclusive or: the class flips when exactly one of the two features changes sign; here class 1 means `x₁` and `x₂` have the same sign) and the 3-class iris data. The core checks:

```python
z = clf.decision_function(X)                    # z = X·w + b
p = clf.predict_proba(X)[:, 1]
abs(p - 1 / (1 + np.exp(-z))).max()             # probability = sigmoid(score)
abs(np.log(p / (1 - p)) - z).max()              # score = log-odds
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-24, scikit-learn 1.9.1, NumPy 2.5.5, two runs identical ✅[^4]:

```text
…                                  (the 5-line sigmoid table shown in the Mental model)
w = [-2.1258  2.9971]  b = 1.4843
max |z - (Xw+b)|          = 0.0e+00
max |p - sigmoid(z)|      = 0.0e+00
max |log(p/(1-p)) - z|    = 1.8e-14
predict == (z > 0)        : True
row 0: x=[1.3654 1.1985] z=2.1737 sigmoid=0.8979 predict_proba=0.8979 label=1
odds ratio when x1 rises by 1: 0.1193   exp(w1) = 0.1193
log loss by hand=0.239427 sklearn log_loss=0.239427
C=0.001  |w|=0.1262  train acc=0.867  mean p(max class)=0.536
C=0.01   |w|=0.6851  train acc=0.887  mean p(max class)=0.667
C=0.1    |w|=1.9700  train acc=0.900  mean p(max class)=0.812
C=1      |w|=3.6744  train acc=0.920  mean p(max class)=0.883
C=100    |w|=4.6505  train acc=0.917  mean p(max class)=0.904
C=inf    |w|=4.6671  train acc=0.917  mean p(max class)=0.905
separable, C=1    |w| at tol 1e-4, 1e-8, 1e-12 = [1.76 1.76 1.76]
separable, C=inf  |w| at tol 1e-4, 1e-8, 1e-12 = [ 37.21 107.4  179.99]
XOR train acc, raw features: 0.522   with x1*x2 added: 0.970
iris coef_ shape: (3, 4)  max |proba - softmax(Z)| = 0.0e+00
iris row 0 scores: [  7.335   3.36  -10.696]  softmax: [0.9816 0.0184 0.    ]
```

<details><summary>Full script (prints the output above)</summary>

```python
# Logistic regression: probability = sigmoid(decision function); log-odds are linear; C controls weight size.
import numpy as np
from sklearn.datasets import make_classification, load_iris
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import log_loss

for zv in [-4, -2, 0, 2, 4]:                           # the sigmoid turns a score into a probability
    pv = 1 / (1 + np.exp(-zv))
    print("z=%+d  sigmoid(z)=%.4f  odds p/(1-p)=%7.3f  log-odds=%+.1f" % (zv, pv, pv / (1 - pv), np.log(pv / (1 - pv))))

X, y = make_classification(n_samples=300, n_features=2, n_redundant=0, n_informative=2,
                           n_clusters_per_class=1, class_sep=1.0, random_state=0)
clf = LogisticRegression(C=1.0).fit(X, y)
w, b = clf.coef_[0], clf.intercept_[0]
z = clf.decision_function(X)                          # z = X w + b
p = clf.predict_proba(X)[:, 1]
print("w =", np.round(w, 4), " b = %.4f" % b)
print("max |z - (Xw+b)|          = %.1e" % abs(z - (X @ w + b)).max())
print("max |p - sigmoid(z)|      = %.1e" % abs(p - 1 / (1 + np.exp(-z))).max())
print("max |log(p/(1-p)) - z|    = %.1e" % abs(np.log(p / (1 - p)) - z).max())
print("predict == (z > 0)        :", bool((clf.predict(X) == (z > 0)).all()))
x0 = X[0]; z0 = x0 @ w + b                            # one row by hand
print("row 0: x=%s z=%.4f sigmoid=%.4f predict_proba=%.4f label=%d"
      % (np.round(x0, 4), z0, 1 / (1 + np.exp(-z0)), p[0], y[0]))
odds = lambda v: (lambda q: q / (1 - q))(clf.predict_proba([v])[0, 1])
print("odds ratio when x1 rises by 1: %.4f   exp(w1) = %.4f" % (odds(x0 + [1, 0]) / odds(x0), np.exp(w[0])))
ll = -np.mean(y * np.log(p) + (1 - y) * np.log(1 - p))
print("log loss by hand=%.6f sklearn log_loss=%.6f" % (ll, log_loss(y, p)))

# C = inverse regularization strength: smaller C -> smaller weights, probabilities pulled toward 0.5
for C in [0.001, 0.01, 0.1, 1, 100, np.inf]:
    m = LogisticRegression(C=C).fit(X, y)
    print("C=%-6g |w|=%.4f  train acc=%.3f  mean p(max class)=%.3f"
          % (C, np.linalg.norm(m.coef_), m.score(X, y), m.predict_proba(X).max(axis=1).mean()))

# Separable data: without a penalty there is no finite optimum, |w| depends on where the solver stops
Xs = np.r_[X[y == 0][:20] - 1, X[y == 1][:20] + 1]; ys = np.r_[np.zeros(20), np.ones(20)]
for C in [1.0, np.inf]:
    norms = [np.linalg.norm(LogisticRegression(C=C, tol=t).fit(Xs, ys).coef_) for t in [1e-4, 1e-8, 1e-12]]
    print("separable, C=%-4g |w| at tol 1e-4, 1e-8, 1e-12 = %s" % (C, np.round(norms, 2)))

# A linear boundary cannot solve XOR
Xx = np.random.default_rng(0).uniform(-1, 1, size=(400, 2)); yx = (Xx[:, 0] * Xx[:, 1] > 0).astype(int)
print("XOR train acc, raw features: %.3f   with x1*x2 added: %.3f"
      % (LogisticRegression().fit(Xx, yx).score(Xx, yx),
         LogisticRegression().fit(np.c_[Xx, Xx[:, 0] * Xx[:, 1]], yx).score(np.c_[Xx, Xx[:, 0] * Xx[:, 1]], yx)))

# Multinomial: predict_proba = softmax(decision_function), 3 classes
Xi, yi = load_iris(return_X_y=True)
mi = LogisticRegression(max_iter=1000).fit(Xi, yi)
Z = mi.decision_function(Xi)                            # shape (150, 3)
S = np.exp(Z - Z.max(axis=1, keepdims=True)); S /= S.sum(axis=1, keepdims=True)
print("iris coef_ shape:", mi.coef_.shape, " max |proba - softmax(Z)| = %.1e" % abs(mi.predict_proba(Xi) - S).max())
print("iris row 0 scores:", np.round(Z[0], 3), " softmax:", np.round(S[0], 4))
```

</details>

Reading it line by line:
- **First five lines after the table:** `decision_function` is exactly `X·w + b`, `predict_proba` is exactly the sigmoid of it, its log-odds give back `z` to `1.8e-14`, and `predict` is the same as `z > 0`.
- **Row 0:** by hand: score 2.1737, probability 0.8979, true label 1.
- **Odds ratio:** one unit more of feature 1 multiplies row 0's odds by 0.1193, which is `e^(w₁)`.
- **Log loss:** the value by hand matches `sklearn.metrics.log_loss`.
- **`C` sweep:** as `C` shrinks from ∞ to 0.001, the weight norm falls from 4.67 to 0.13 and the average confidence from 0.905 to 0.536, close to a coin flip. Training accuracy here peaks at `C=1` (0.920); a very small `C` underfits (0.867).
- **Separable data:** `C=1` gives the same `|w| = 1.76` at every solver tolerance. With `C=inf` the weights grow as the tolerance tightens (37 → 107 → 180): the loss keeps falling as the weights grow, so there is no finite optimum and the answer is wherever the solver stops.
- **XOR:** raw features give 0.522 training accuracy, a coin flip. Adding the product feature `x₁·x₂` gives 0.970.
- **Iris:** `predict_proba` is exactly the softmax of the three scores; row 0's scores `[7.3, 3.4, −10.7]` become probabilities `[0.98, 0.02, 0.00]`.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Perfectly separable classes, `C=np.inf` | Weights grow as the solver tolerance tightens (`|w|` 37 → 180 in the lab) ✅[^4] | The log loss keeps falling as `|w|` grows, so there is no finite minimizer; any penalty (`C < ∞`) fixes it (1.76 in the lab) ✅[^4] |
| Classes arranged like XOR | Accuracy near 0.5 (0.522 in the lab) ✅[^4] | The boundary `w·x + b = 0` is linear; add interaction features or use a non-linear model |
| Reading `w_j` as "probability goes up by `w_j`" | Wrong | `w_j` is the change in log-odds; the odds multiply by `e^(w_j)` ✅[^4] |
| Features on very different scales | `sag` (stochastic average gradient) and its variant `saga` are guaranteed to converge fast only when features have about the same scale ✅[^2] | Scale features first → `machine-learning/data-and-features/preprocessing-and-pipelines.md` |
| `class_weight` or `sample_weight` multiplied by a constant `k` | Same as multiplying `C` by `k` ✅[^1] | The penalty is divided by `S·C`, where `S` is the total sample weight ✅[^1] |
| Code that passes `penalty=` | Deprecated since 1.8, to be removed in 1.10: use `l1_ratio` (0 = L2, 1 = L1) and `C=np.inf` for no penalty ✅[^2] | The 1.9.1 API (application programming interface) moved to `C` + `l1_ratio` |
| `solver="liblinear"` with 3+ classes | Raises an error ✅[^2]; wrap it in `OneVsRestClassifier` to use one-vs-rest ✅[^1] | liblinear's coordinate descent cannot learn a true multinomial model ✅[^1] |
| One-vs-rest vs multinomial probabilities | Multinomial is expected to give better-calibrated probabilities ✅[^1] | It fits one joint softmax instead of K separate binary models |
| Unpenalized multinomial model | The solution may not be unique ✅[^1] | scikit-learn uses K weight vectors where K − 1 would suffice ✅[^1] |
| Large scores in a hand-written softmax | `exp` overflows | Subtract the row maximum before exponentiating (the lab script does this); care is needed to avoid overflow ✅[^3] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Small `C` (strong penalty) | Small, stable weights; finite fit on separable data ✅[^4] | Underfits; probabilities pulled toward 0.5 (0.536 at `C=0.001`) ✅[^4] |
| Large `C` or `C=np.inf` | Closest to the statistics textbook model ✅[^1] | No unique answer on separable data ✅[^4]; unpenalized multinomial may not be unique ✅[^1] |
| L1 penalty (`l1_ratio=1`) | Can set weights exactly to zero (a sparse model) ✅[^1] | Not every solver supports it: `lbfgs`, `newton-cg`, `newton-cholesky` and `sag` support only L2 or none ✅[^1] |
| `lbfgs` (default) | Works reasonably well for a wide class of problems ✅[^2] | On large datasets `saga` is usually faster, in particular at low precision (high `tol`) ✅[^1] |

## Takeaways
- Read a coefficient as "multiplies the odds by `e^(w_j)` per unit", never as a change in probability. [rule-candidate]
- Scale the features before fitting; `sag` and `saga` converge fast only on comparable scales. [rule-candidate]
- In scikit-learn 1.9.1, set the penalty with `C` and `l1_ratio`, not `penalty=`.
- Use `decision_function` when you need an unbounded score, and `predict_proba` when you need a probability. They carry the same ranking, `p = σ(z)`.
- If two classes are not linearly separable in the given features, a bigger or smaller `C` will not help; new features or another model will.

## Verification status
- Verified: 51 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- [1.1.11. Logistic regression (scikit-learn User Guide, Linear Models)](https://scikit-learn.org/stable/modules/linear_model.html) — scikit-learn developers, living (1.9.1 docs). Backs: the linear score, `predict_proba = expit(Xw + w₀)`, GLM with logit link, 0.5 threshold, the regularized log-loss objective and the `S·C` scaling, the penalty table, regularization on by default, multinomial softmax with K weight vectors, non-uniqueness without a penalty, solver support for penalties, `lbfgs` as a quasi-Newton BFGS approximation, `saga` usually faster on large data, liblinear and one-vs-rest, calibration of multinomial vs one-vs-rest. [^1]
- [LogisticRegression (scikit-learn API)](https://scikit-learn.org/stable/modules/generated/sklearn.linear_model.LogisticRegression.html) — scikit-learn developers, living (1.9.1 docs). Backs: `C` is the inverse regularization strength, `C=np.inf` unpenalized, `penalty` deprecated in 1.8 and removed in 1.10, `l1_ratio`, default `lbfgs`, multiclass behaviour of solvers, `sag`/`saga` and feature scale. [^2]
- [4.1. Softmax Regression (Dive into Deep Learning)](https://d2l.ai/chapter_linear-classification/softmax-regression.html) — Zhang, Lipton, Li, Smola, living. Backs: softmax preserves the order of scores (argmax), the cross-entropy gradient `softmax(o) − y`, the overflow caution. [^3]
- `machine-learning/lab-setup.md` — the lab where the sigmoid table, the probability and log-odds checks, the odds ratio, the `C` sweep, the separable-data, XOR and iris experiments ran on 2026-11-24. [^4]

## Related
- `machine-learning/supervised-learning/linear-regression.md` — the same linear score, used for numbers instead of classes.
- `machine-learning/foundations/loss-functions-and-maximum-likelihood.md` — log loss as the Bernoulli maximum-likelihood loss.
- `machine-learning/foundations/regularization.md` — what L2, L1 and Elastic-Net penalties do to weights.
- `machine-learning/foundations/math-notation-reference.md` — sigmoid, softmax and log-sum-exp, with numbers.
- `machine-learning/evaluation/probability-calibration.md` — checking whether `predict_proba` values match observed frequencies.
- `machine-learning/supervised-learning/support-vector-machines.md` — another linear classifier, with the hinge loss instead of log loss.
