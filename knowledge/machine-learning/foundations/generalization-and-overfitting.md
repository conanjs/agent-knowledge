---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/foundations
status: verified
applies-to: ["any", "scikit-learn 1.9.1"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [machine-learning, basics, generalization, overfitting, underfitting, bias-variance, train-validation-test, learning-curve, capacity, model-selection]
---

# Generalization and overfitting: train, validation and test error

## Summary
**TL;DR:** A model is only useful if it does well on data it has not seen, which is called **generalizing**. Training error alone cannot tell you that: a flexible enough model can drive it to zero by memorizing noise, which is **overfitting**; a too-simple model does badly even on its training data, which is **underfitting**. So the data is split three ways: a **training set** to fit parameters, a **validation set** to choose hyperparameters, and a **test set** touched once at the end. For squared error, the expected test error splits into **bias²** (systematic miss) + **variance** (sensitivity to which training set you drew) + **noise** (the floor no model can beat).
**Use this when:** a model scores far better in training than in validation or production, you need to decide between a simpler and a more complex model, or you are setting up train/validation/test splits.
**Not this doc:** how to split with k-fold, stratified or time-series splits → `machine-learning/evaluation/cross-validation-and-hyperparameter-search.md`; ways to fight overfitting → `machine-learning/foundations/regularization.md`; test scores that are too good because information leaked → `machine-learning/evaluation/data-leakage.md`; why very large models can break the U-curve → `machine-learning/learning-theory/double-descent.md`.

## Problem
Training minimizes the loss on the training examples, so the training score measures how well the model fits data it has already seen. With 20 noisy points, a degree-15 polynomial reaches a training MSE (mean squared error) of 0.0004, the best of all degrees tried, and a test MSE of 9.81, the worst by far ✅[^8]. A team that reports the training score, or that keeps tuning against one test set until it looks good, ships a model whose real error is unknown and usually higher ✅[^2] ✅[^7].

## Mental model
**Analogy:** a tailor making a suit from one photo of you. Tracing every wrinkle and shadow in the photo gives a perfect fit *to the photo* (overfitting: training error near zero) but not to you on another day, when the wrinkles are elsewhere. A one-size poncho fits no photo and no day well (underfitting). A good suit follows your real shape and ignores the wrinkles. The photo is the training set, the wrinkles are noise, your real shape is the pattern, and "you on another day" is new data.

**Artifact:** polynomial fits of increasing degree to 20 noisy points from `y = cos(1.5πx) + noise`; lab run (`machine-learning/lab-setup.md`), 2026-11-24, scikit-learn 1.9.1 ✅[^8]:

```text
degree  train_MSE  valid_MSE    test_MSE
     1     0.1807     0.2279      0.1899
     4     0.0030     0.0136      0.0130
    15     0.0004     9.6619      9.8098
```

Degree 1 underfits (bad on every split), degree 4 has the best validation score, and degree 15 overfits (best training score, worst test score) ✅[^8].

## How it works

### Training error vs generalization error
- **Training error** (also *empirical risk*): `R_emp = (1/n) · Σᵢ l(yᵢ, f(xᵢ))`, the average loss over the `n` training examples, where `f(xᵢ)` is the model's prediction for example `i`, `yᵢ` its label and `l` the per-example loss ✅[^1]. Example: squared errors of 0.25, 1 and 4 on three examples give `R_emp = 5.25 / 3 = 1.75`.
- **Generalization error** `R`: the expected loss over the whole data distribution, what you would see on an infinite stream of new examples ✅[^1]. It can never be computed exactly, so it is estimated by the same average on a **test set** of examples withheld from training ✅[^1].
- The training error is a biased (optimistic) estimate of `R`, because the model was chosen to fit those very examples ✅[^1].
- All of this assumes the training and test data are drawn independently from the same distribution, the IID (independent and identically distributed) assumption; without some such assumption nothing can be said about generalization ✅[^1] ✅[^6].

### Capacity, underfitting and overfitting
**Capacity** is a model's ability to fit a wide variety of functions: low capacity struggles to fit the training set, high capacity can overfit by memorizing properties of the training set that do not hold on the test set ✅[^2]. A polynomial's degree is one capacity knob: on a fixed training set a higher degree never gives a higher training error ✅[^1]. As capacity grows, training error falls while the gap to generalization error grows, so generalization error traces a U-shaped curve with an optimal capacity in between ✅[^2]. Comparing the two errors gives the diagnosis:

| Training error | Validation error | Diagnosis | Next move |
|---|---|---|---|
| High | High, small gap | Underfitting: model too simple ✅[^1] ✅[^3] | More capacity (more features, higher degree) ✅[^1] |
| Low | Much higher | Overfitting ✅[^1] ✅[^3] | More data, less capacity, regularization ✅[^1] |
| Low | Low, similar | Working well ✅[^3] | Confirm once on the test set ✅[^7] |
| High | Low | "Usually not possible" (check for a bug or leak) ✅[^3] | — |

A rising validation loss while the training loss keeps falling, over training iterations, is the same signal seen on a loss curve ✅[^6].

### Three splits, three jobs
| Split | Job | Never use it to |
|---|---|---|
| Training set | Fit the parameters ✅[^2] | Judge generalization: the model was fitted to it ✅[^1] |
| Validation set (carved out of the training data; about 80 % / 20 % is typical) ✅[^2] | Choose hyperparameters and compare models ✅[^2] ✅[^7] | Report the final score: tuning on it makes it optimistic ✅[^2] ✅[^3] |
| Test set | One final, honest estimate after all choices are made ✅[^2] | Make any choice about the model, including hyperparameters ✅[^2] |

Test and validation sets "wear out": the more decisions are made against the same set, the less its score predicts new data ✅[^7]. A good test set is large enough for a statistically meaningful result, representative of the data and of real-world use, and shares no duplicates with the training set ✅[^7]. With little data, k-fold cross-validation (train on `K − 1` parts, validate on the remaining one, rotate, average) replaces the single validation split ✅[^1].

### Bias, variance and noise
Imagine drawing many training sets of the same size from the same source and fitting the same model to each. At an input `x`, with `f*(x)` the true function (the average label at `x`), `ŷ(x)` one fitted model's prediction and `y` a fresh noisy label at `x`, the "expected squared error" is `(y − ŷ(x))²` averaged over both the training sets and the fresh labels:

```text
expected squared error at x  =  bias²  +  variance  +  noise
bias²    = (average of ŷ(x) over training sets − f*(x))²   how far the average model misses
variance = average of (ŷ(x) − average ŷ(x))²              how much ŷ(x) moves with the training set
noise    = variance of y around f*(x)                      the part no model can remove
```

scikit-learn describes the expected MSE as decomposing into bias, variance and noise, with noise "the irreducible part of the error" ✅[^5] ✅[^3]; the Deep Learning book gives the parameter-estimation form, `MSE = Bias² + Var` ✅[^2]. As capacity grows, bias tends to fall and variance to rise, which is another view of the same U-shaped generalization curve ✅[^2]. Even an oracle that knows the true distribution still makes errors because of the noise; that error is called the **Bayes error** ✅[^2]. Numeric example from the lab, each term averaged over 200 inputs `x`: a straight line (degree 1) fitted to 20 points has `bias² 0.1406 + variance 0.0253 + noise 0.0100 = 0.1758`, against a directly measured 0.1762 ✅[^8].

### Learning curves
A **learning curve** plots training and validation scores against the number of training examples; it shows whether more data would help and whether the error is mostly bias or mostly variance ✅[^3]. For a fixed model, fewer training examples make overfitting more likely and more severe ✅[^1]. If training and validation scores converge to a poor value, more data will not help much (bias); if a large gap remains, more data likely will (variance) ✅[^3].

## Worked example
One script, three measurements on `y = cos(1.5πx) + ε` with `x` uniform in `[0, 1)` and Gaussian noise `ε` of standard deviation 0.1 (the scikit-learn "Underfitting vs. Overfitting" setup ✅[^4], with 20 training points instead of its 30), polynomial features plus least squares. Core lines of the bias–variance part:

```python
preds = np.array([fit(deg, *sample(rng, 20)).predict(x_grid[:, None]) for _ in range(500)])
bias2 = np.mean((preds.mean(axis=0) - true_fun(x_grid)) ** 2)   # average model vs truth
var = np.mean(preds.var(axis=0))                                # spread across training sets
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-24, Python 3.13.7, numpy 2.5.5, scikit-learn 1.9.1, two runs identical ✅[^8]:

```text
degree  train_MSE  valid_MSE    test_MSE
     1     0.1807     0.2279      0.1899
     2     0.0418     0.0483      0.0535
     3     0.0050     0.0211      0.0189
     4     0.0030     0.0136      0.0130
     5     0.0029     0.0158      0.0153
     6     0.0025     0.0237      0.0217
     8     0.0021     0.0582      0.0508
    10     0.0013     0.0481      0.0436
    12     0.0012     0.1044      0.0959
    15     0.0004     9.6619      9.8098

degree  bias^2   variance  noise   sum      measured_MSE
     1  0.1406    0.0253  0.0100   0.1758   0.1762
     3  0.0016    0.0046  0.0100   0.0162   0.0163
     4  0.0001    0.0078  0.0100   0.0179   0.0179
     6  0.0006    0.1726  0.0100   0.1832   0.1832
     9  1.4738  612.5845  0.0100  614.0682  614.0590
degree 9: 41 of 500 fits predict |y| > 10 somewhere (true |y| <= 1); bias^2 without them 0.0008

n_train  deg9_train_MSE  deg9_test_MSE
     20          0.0037     13810.5647
    100          0.0074         0.0113
   1000          0.0099         0.0099
```

<details><summary>Full script (prints the output above)</summary>

```python
# Polynomial-degree sweep (the scikit-learn "Underfitting vs. Overfitting" setup),
# then bias^2 / variance / noise estimated over many resampled training sets.
import numpy as np
from sklearn.linear_model import LinearRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import PolynomialFeatures

def true_fun(x):
    return np.cos(1.5 * np.pi * x)

NOISE_SD = 0.1                       # y = true_fun(x) + Gaussian noise with sd 0.1

def sample(rng, n):
    x = np.sort(rng.random(n))       # x uniform in [0, 1)
    return x, true_fun(x) + rng.normal(0, NOISE_SD, n)

def fit(deg, x, y):
    model = make_pipeline(PolynomialFeatures(deg, include_bias=False),
                          LinearRegression(tol=np.finfo(float).eps))
    return model.fit(x[:, None], y)

def mse(model, x, y):
    return np.mean((model.predict(x[:, None]) - y) ** 2)

rng = np.random.default_rng(0)
x_tr, y_tr = sample(rng, 20)         # training set: 20 points
x_va, y_va = sample(rng, 200)        # validation set: 200 other points
x_te, y_te = sample(rng, 10_000)     # large test set: a stand-in for "new data"
print("degree  train_MSE  valid_MSE    test_MSE")
for deg in [1, 2, 3, 4, 5, 6, 8, 10, 12, 15]:
    m = fit(deg, x_tr, y_tr)
    print(f"{deg:6d}  {mse(m, x_tr, y_tr):9.4f}  {mse(m, x_va, y_va):9.4f}  {mse(m, x_te, y_te):10.4f}")

# Bias-variance: refit on 500 fresh training sets of 20 points, predict at 200 fixed x.
x_grid = np.linspace(0.05, 0.95, 200)
print("\ndegree  bias^2   variance  noise   sum      measured_MSE")
for deg in [1, 3, 4, 6, 9]:
    preds = np.array([fit(deg, *sample(rng, 20)).predict(x_grid[:, None]) for _ in range(500)])
    bias2 = np.mean((preds.mean(axis=0) - true_fun(x_grid)) ** 2)
    var = np.mean(preds.var(axis=0))
    noise = NOISE_SD ** 2
    y_new = true_fun(x_grid) + rng.normal(0, NOISE_SD, preds.shape)   # fresh noisy labels
    measured = np.mean((preds - y_new) ** 2)
    print(f"{deg:6d}  {bias2:.4f}  {var:8.4f}  {noise:.4f}  {bias2 + var + noise:7.4f}  {measured:7.4f}")
wild = np.abs(preds).max(axis=1) > 10            # preds now holds the 500 degree-9 fits
print(f"degree 9: {wild.sum()} of 500 fits predict |y| > 10 somewhere (true |y| <= 1); "
      f"bias^2 without them {np.mean((preds[~wild].mean(axis=0) - true_fun(x_grid)) ** 2):.4f}")

# Learning curve for the degree-9 model: more data shrinks the variance part.
print("\nn_train  deg9_train_MSE  deg9_test_MSE")
for n in [20, 100, 1000]:
    x_n, y_n = sample(rng, n)
    m = fit(9, x_n, y_n)
    print(f"{n:7d}  {mse(m, x_n, y_n):14.4f}  {mse(m, x_te, y_te):13.4f}")
```

</details>

Reading it:
- **The sweep.** Training MSE falls at every step, from 0.1807 at degree 1 to 0.0004 at degree 15 ✅[^8], as theory says it must ✅[^1]. Test MSE falls to 0.0130 at degree 4, then rises, not quite smoothly, to 9.81: the U-curve ✅[^8] ✅[^2]. Validation, measured on 200 separate points, picks degree 4 as well (0.0136), and its numbers track the 10,000-point test set closely ✅[^8]. Degree 1 is underfit (training 0.18, test 0.19), degree 15 is overfit (training 0.0004, test 9.81) ✅[^8], the same three regimes as the scikit-learn example ✅[^4].
- **The decomposition.** For degrees 1 to 6, bias² + variance + noise matches the measured error to within 0.0004, and for degree 9 to within 0.01 of 614 ✅[^8]. Degree 1 is mostly bias (0.1406 of 0.1758); degree 6 is mostly variance (0.1726 of 0.1832) ✅[^8]. Degrees 3 and 4 have the lowest totals, and here, averaged over training sets, degree 3 (0.0162) edges out degree 4 (0.0179), although degree 4 won on the one training set of the sweep ✅[^8]: one split is one draw.
- **Degree 9's bias² of 1.47** does not mean degree 9 is too simple: 41 of the 500 fits predict values above 10 in size somewhere, where the true curve never leaves −1…1, and those swings drag the average prediction too; without them bias² is 0.0008 ✅[^8].
- **The learning curve.** The same degree-9 model goes from a test MSE of 13,810 with 20 points to 0.0113 with 100 and 0.0099 with 1,000, while its training MSE rises toward the noise level 0.01 ✅[^8]. More data cut the variance, and the error approached the floor that the noise sets, the Bayes error ✅[^2].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Polynomial degree close to the number of points (all `x` distinct) | Training error near zero, test error large | At degree = number of points the fit is perfect ✅[^1]; lab: degree 15 on 20 points, training 0.0004, test 9.81 ✅[^8] |
| Hyperparameters tuned on the test set | Test score becomes optimistic and you cannot tell | The test set must not inform any choice ✅[^2]; "if we overfit the test data, how would we ever know?" ✅[^1] |
| Same benchmark test set reused for years | Published scores drift above real-world performance | Repeated use makes test evaluations optimistic ✅[^2] |
| Duplicates of training examples in the test set | Test loss "staggeringly low" | The model has effectively trained on test data ✅[^7] |
| Data that changes over time (not stationary) | Low validation and test loss, poor real-world predictions | Generalization needs stationary data and same-distribution splits ✅[^6] |
| Small validation or test set | Noisy scores; model comparisons become unreliable | A small test set means statistical uncertainty in the estimated error ✅[^2] |
| One training set, one score | The ranking of two close models can flip on another draw | Variance across training sets; lab: degree 4 won the single split, degree 3 won on average ✅[^8] |
| Deep networks with far lower training than validation error | Can still be the best available model | Overfitting "is not always a bad thing"; what matters is the validation error itself ✅[^1] |
| Validation score of the tuned model | Biased upward | Optimizing on it uses it up; estimate generalization on another test set ✅[^3] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| One train/validation/test split | Simple; trains each model once | Every example used for testing is one fewer for training ✅[^7]; one draw can mislead ✅[^8] |
| k-fold cross-validation | Uses all training data for both fitting and validating ✅[^1] ✅[^2] | `K` fits instead of one, more computation ✅[^2] |
| Higher-capacity model | Lower bias ✅[^2] | Higher variance; needs more data ✅[^2] ✅[^1] |
| More training data | Lowers variance ✅[^3]; "more data never hurts" in general ✅[^1] | Costs collection; does not fix an underfitting model whose curves have already converged ✅[^3] |

## Takeaways
- Never report the training score as the model's quality; report the score on data the model and its tuning never saw. [rule-candidate]
- Split three ways before the first experiment, and touch the test set once, at the end. [rule-candidate]
- Read the two errors together: both high means add capacity, a large gap means add data or regularize.
- Repeat a comparison over several splits or folds before trusting a small difference between two models.

## Verification status
- Verified: 82 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- [Dive into Deep Learning, 3.6 Generalization](https://d2l.ai/chapter_linear-regression/generalization.html) — Aston Zhang, Zachary C. Lipton, Mu Li, Alexander J. Smola, living. Backs: training vs generalization error formulas, IID assumption, estimating with a test set, training error biased, underfitting and overfitting diagnosis, polynomial training error never rises with degree and interpolates at degree = number of points, dataset size, model selection and test-set misuse, k-fold cross-validation, overfitting not always bad, "more data never hurts". [^1]
- [Deep Learning, chapter 5: Machine Learning Basics](https://www.deeplearningbook.org/contents/ml.html) — Ian Goodfellow, Yoshua Bengio, Aaron Courville, 2016. Backs: capacity, U-shaped generalization curve, Bayes error, validation set from the training data (80/20), validation error underestimates generalization error, test set never used for choices, stale benchmarks, small test sets, cross-validation cost, `MSE = Bias² + Var`, bias falls and variance rises with capacity. [^2]
- [Validation curves: plotting scores to evaluate models](https://scikit-learn.org/stable/modules/learning_curve.html) — scikit-learn developers, living (1.9.1). Backs: bias, variance and noise decomposition, diagnosis from training and validation scores, low-train-high-validation "usually not possible", tuned validation score is biased, learning curves. [^3]
- [Underfitting vs. Overfitting (example)](https://scikit-learn.org/stable/auto_examples/model_selection/plot_underfitting_overfitting.html) — scikit-learn developers, living (1.9.1). Backs: the `cos(1.5πx)` setup and degrees 1, 4 and 15 as underfit, good and overfit. [^4]
- [Single estimator versus bagging: bias-variance decomposition](https://scikit-learn.org/stable/auto_examples/ensemble/plot_bias_variance.html) — scikit-learn developers, living (1.9.1). Backs: expected MSE = bias² + variance + noise, definitions of each term, noise as the irreducible part. [^5]
- [Overfitting (Machine Learning Crash Course)](https://developers.google.com/machine-learning/crash-course/overfitting/overfitting?hl=en) — Google for Developers, living. Backs: loss curves diverging signal overfitting; generalization conditions (IID, stationary, same-distribution partitions). [^6]
- [Datasets: Dividing the original dataset (Machine Learning Crash Course)](https://developers.google.com/machine-learning/crash-course/overfitting/dividing-datasets?hl=en) — Google for Developers, living. Backs: three-way split workflow, test sets wear out, duplicates between splits, criteria for a good test set, the zero-sum split. [^7]
- `machine-learning/lab-setup.md` — the lab where the polynomial-degree sweep, the bias–variance estimate over 500 training sets and the degree-9 learning curve ran on 2026-11-24. [^8]

## Related
- `machine-learning/foundations/what-is-machine-learning.md` — training, evaluation and inference in the end-to-end workflow.
- `machine-learning/foundations/regularization.md` — penalties and early stopping that trade a little bias for less variance.
- `machine-learning/foundations/loss-functions-and-maximum-likelihood.md` — the loss `l` that both errors average.
- `machine-learning/evaluation/cross-validation-and-hyperparameter-search.md` — k-fold, stratified, grouped and time-series splits; nested cross-validation.
- `machine-learning/evaluation/data-leakage.md` — test scores that are good for the wrong reason.
- `machine-learning/learning-theory/double-descent.md` — when test error falls again past the interpolation point.
- `machine-learning/learning-theory/pac-learning-and-vc-dimension.md` — bounds on the gap between training and generalization error.
- `machine-learning/supervised-learning/tree-ensembles.md` — bagging as a variance-reduction method.
