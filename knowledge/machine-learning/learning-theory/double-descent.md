---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/learning-theory
status: verified
applies-to: ["any"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [machine-learning, learning-theory, double-descent, interpolation-threshold, overparameterization, minimum-norm, random-features, bias-variance, effective-model-complexity]
---

# Double descent: test error past the interpolation threshold

## Summary
**TL;DR:** The textbook picture says test error falls and then rises as model capacity grows (a U-curve). For many modern models, if you keep growing capacity past the point where the model fits the training data exactly, the interpolation threshold, test error peaks there and then falls again, often below the bottom of the U: double descent. The peak comes from a model that can only just fit the data and so has to fit the noise; beyond it, many exact fits exist and the training procedure picks a smooth, small-norm one. In deep networks the same shape appears as a function of size, of training epochs and even of the number of training samples, strongest with label noise. It is not universal, and regularization can remove the peak.
**Use this when:** a bigger model or longer training unexpectedly hurt test error, you are sizing a model near "parameters ≈ examples", or you read that "more data can hurt".
**Not this doc:** the classical bias–variance decomposition and learning curves → `machine-learning/foundations/generalization-and-overfitting.md`; why class-capacity bounds cannot explain this → `machine-learning/learning-theory/pac-learning-and-vc-dimension.md`; ridge and early stopping as tools → `machine-learning/foundations/regularization.md`.

## Problem
The classical advice is to stop adding capacity when test error starts to rise, because the gap between training and test error then outweighs the falling training error ✅[^5]. But very rich models such as neural networks are trained to fit the data exactly and still often obtain high accuracy on test data, which that picture calls over-fit ✅[^1]. Following the U-curve can stop exactly at the worst size: the model that interpolates with the fewest parameters gave the least accurate predictor in Belkin et al.'s random-feature experiment ✅[^1]. And the rule "more data is always better" can fail: with a fixed architecture and training procedure, more samples sometimes made test error worse ✅[^2].

## Mental model
**Analogy:** threading a flexible wire through `n` fixed pegs on a board. With fewer adjustable bends than pegs, the wire cannot pass every peg and you settle for close. With exactly as many bends as pegs there is one way through all of them, and if some pegs are slightly misplaced (noise) that one way zig-zags wildly. With far more bends than pegs there are endless ways through every peg, and if you always choose the one using the least wire (the smallest norm), the result is smooth again.

**Artifact:** the two curves, schematic (shape from Belkin et al.'s Figure 1, not data) ✅[^1]:

```
test error
   │\                  classical regime    │   interpolating regime
   │ \        ___                          │
   │  \      /   \                         │ peak at the interpolation threshold
   │   \____/     \                        │\
   │   sweet spot  \_______________________│ \
   │                                       │  \______________________  (often below the sweet spot)
   └───────────────────────────────────────┴──────────────────────────► capacity (e.g. features N)
                                       N ≈ n: training error reaches 0
```

## How it works
1. **The classical regime.** Below the threshold, training error falls as capacity grows while the train–test gap widens, producing the U-curve with underfitting on the left and overfitting on the right ✅[^5] ✅[^3]. It is often justified with the bias–variance trade-off, motivated by a least-squares regression analysis ✅[^3].
2. **The interpolation threshold.** The capacity at which the model can fit the training data exactly ✅[^3]; models to its right have zero training risk ✅[^1]. For one output it takes about as many parameters as data points; with `K` outputs (for example `K` classes), about `n·K` ✅[^1]. Worked number: 4,000 handwritten digits from MNIST (the Modified National Institute of Standards and Technology dataset) with 10 classes put the threshold near 40,000 parameters in Belkin et al.'s two-layer networks ✅[^1].
3. **Why the peak.** Approaching the threshold, features weakly present in the data are forced to fit the training data nearly perfectly, which is classical over-fitting at its worst exactly where the fit becomes exact ✅[^1]. Nakkiran et al. put it as: at the threshold there is effectively only one model that fits, and it is very sensitive to noise and model mis-specification ✅[^2]. The coefficients' norm is largest there ✅[^1].
4. **Why the second descent.** When the minimizer is not unique (`N > n`), Belkin et al. pick the solution with the smallest ℓ2 norm of the coefficients ✅[^1]. Adding features gives progressively better approximations of the smoothest function that fits the data, so the norm falls and test risk falls with it ✅[^1]. Favouring small-norm interpolators is a strong inductive bias on MNIST and other data ✅[^1]; SGD (stochastic gradient descent) on neural networks is conjectured to have a similar small-norm bias ✅[^1].
5. **Deep double descent.** Nakkiran et al. define the EMC (effective model complexity) of a training procedure as the largest number of samples on which it reaches about zero training error ✅[^2]. Their hypothesis: well below or well above `EMC ≈ n`, anything that raises the effective complexity lowers test error; near `EMC ≈ n` it may raise or lower it ✅[^2]. Because training longer raises the EMC, the same shape appears over epochs (epoch-wise double descent) ✅[^2]; because more samples move the peak to the right, more data can hurt near the threshold (sample-wise) ✅[^2]. A corollary they state: early stopping helps only in the narrow regime of critically parameterized models ✅[^2].
6. **Not universal.** The double descent curve appears in the absence of regularization and for certain model families; often practice shows a single descent, and sometimes several bumps ✅[^3]. All forms were strongest with label noise in the training set; without noise the critical regime often shows a plateau instead of a peak ✅[^2].
7. **Where large real models sit.** Interpolating a dataset with about 10⁶ examples and 10³ classes could need about 10⁹ parameters, more than many networks used for it, so there the classical regime may be the right lens ✅[^1].

## Worked example
Random ReLU (rectified linear unit) features, as in Belkin et al. but toy-sized: `n = 100` training points in 5 dimensions, target `sin(2·w·x)` plus noise with standard deviation 0.05, `N` features `max(0, v_k·x)` with random, fixed `v_k`, and only the output weights `a` fitted by least squares. Core lines:

```python
V = np.random.default_rng(seed).normal(size=(d, N)) / np.sqrt(d)   # fixed random first layer
Ftr = np.maximum(Xtr @ V, 0)                                        # N ReLU random features
a = np.linalg.lstsq(Ftr, ytr, rcond=None)[0]                        # smallest-norm solution once N >= n
```

NumPy's `lstsq` returns, among several minimizers, the one with the smallest 2-norm ✅[^6]. Each row is the median over 20 random feature draws; the last column refits with a ridge penalty `λ = 0.1`. Lab run (`machine-learning/lab-setup.md`), 2026-11-24, NumPy 2.5.5, two runs identical ✅[^4]:

```text
n_train=100 d=5 noise sd=0.05; predict-0 test MSE=0.348; median of 20 draws
    N   train MSE   test MSE     ||a||   ridge test MSE
    5     0.1861      0.174       1.2      0.174
   10     0.0659      0.080       1.3      0.080
   20     0.0217      0.034       1.6      0.032
   40     0.0098      0.031       2.0      0.026
   60     0.0056      0.047       3.4      0.027
   80     0.0022      0.097       5.8      0.028
   90     0.0009      0.165       9.1      0.030
  100     0.0000      2.457      32.6      0.030
  110     0.0000      0.172       8.4      0.030
  120     0.0000      0.134       6.3      0.031
  200     0.0000      0.046       2.3      0.031
  400     0.0000      0.036       1.2      0.031
 1000     0.0000      0.031       0.7      0.030
 4000     0.0000      0.029       0.3      0.029
16000     0.0000      0.029       0.2      0.029
```

<details><summary>Full script (prints the output above)</summary>

```python
# Model-wise double descent: random ReLU features + minimum-norm least squares (Belkin et al. setup, toy size).
import numpy as np

rng = np.random.default_rng(0)
d, n_train, n_test, noise = 5, 100, 2000, 0.05
w_true = rng.normal(size=d) / np.sqrt(d)
def target(X):
    return np.sin(2 * X @ w_true)

Xtr = rng.normal(size=(n_train, d)); ytr = target(Xtr) + noise * rng.normal(size=n_train)
Xte = rng.normal(size=(n_test, d));  yte = target(Xte)              # noiseless test targets

def fit_predict(N, seed):
    V = np.random.default_rng(seed).normal(size=(d, N)) / np.sqrt(d)  # fixed random first layer
    Ftr, Fte = np.maximum(Xtr @ V, 0), np.maximum(Xte @ V, 0)         # N ReLU random features
    a = np.linalg.lstsq(Ftr, ytr, rcond=None)[0]   # least squares; smallest-norm solution once N >= n
    r = Ftr.T @ np.linalg.solve(Ftr @ Ftr.T + 0.1 * np.eye(n_train), ytr)   # ridge, lambda = 0.1
    return (np.mean((Ftr @ a - ytr) ** 2), np.mean((Fte @ a - yte) ** 2), np.linalg.norm(a),
            np.mean((Fte @ r - yte) ** 2))

print(f"n_train={n_train} d={d} noise sd={noise}; predict-0 test MSE={np.mean(yte**2):.3f}; median of 20 draws")
print("    N   train MSE   test MSE     ||a||   ridge test MSE")
for N in [5, 10, 20, 40, 60, 80, 90, 100, 110, 120, 200, 400, 1000, 4000, 16000]:
    r = np.array([fit_predict(N, s) for s in range(20)])
    tr, te, nrm, rte = np.median(r, axis=0)
    print(f"{N:5d} {tr:10.4f} {te:10.3f} {nrm:9.1f} {rte:10.3f}")
```
</details>

Reading it (MSE = mean squared error; predicting 0 everywhere scores 0.348):
- **First descent and the U (N = 5 to 90):** test MSE falls to 0.031 at `N = 40`, the classical sweet spot, then rises (0.097 at 80, 0.165 at 90) while training MSE keeps falling: textbook overfitting.
- **The peak (N = 100 = n):** training MSE hits 0.0000 and test MSE jumps to 2.457, seven times worse than predicting 0, with the largest coefficient norm (32.6).
- **Second descent (N > 100):** every model fits the training set exactly, yet test MSE falls (0.172, 0.046, 0.031) together with the norm, reaching 0.029 at 4,000 and 16,000 features, slightly below the classical sweet spot.
- **Ridge column:** with `λ = 0.1` the peak disappears: test MSE stays between 0.026 and 0.031 from `N = 40` on. In this run the double descent was a property of exact, unregularized interpolation.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Model sized at `parameters ≈ samples × outputs` | Worst test error of the range | The interpolation threshold, `n·K` for `K` outputs ✅[^1]; lab peak 2.457 at `N = n` ✅[^4] |
| Adding training data to a model near the threshold | Test error can get worse | More samples shift the peak right ✅[^2] |
| Training longer | Test error can fall, rise, then fall again | Epoch-wise double descent: training time raises the EMC ✅[^2] |
| Clean labels | Often a plateau instead of a peak | Double descent was strongest with label noise ✅[^2] |
| Explicit regularization | The peak can shrink or vanish | The curve is described for the unregularized case ✅[^3]; lab ridge `λ = 0.1`: no peak ✅[^4] |
| Ensembling models in the critical regime | Helps significantly there | The single interpolating model is noise-sensitive ✅[^2] |
| SGD on networks below the threshold | Noisy, initialization-dependent risks that can hide the curve | Non-convex ERM (empirical risk minimization) gets suboptimal solutions ✅[^1] |
| Expecting double descent everywhere | Many problems show a single descent, some several bumps | Not universal ✅[^3] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Stay well below the threshold (classical) | Training risk close to test risk ✅[^1] | Sweet spot needs tuning; lab best 0.031 at `N = 40` ✅[^4] |
| Go far past it, minimum-norm interpolation | Test risk can drop below the classical optimum ✅[^1]; lab 0.029 ✅[^4] | Many more parameters; poor near the threshold ✅[^1] |
| Ridge / explicit regularization | Removes the peak in the lab run ✅[^4] | One more hyperparameter (`λ`) to tune |
| Early stopping | Helps for critically parameterized models ✅[^2] | Little benefit elsewhere ✅[^2] |

## Takeaways
- Sweep model size past the point where training error reaches zero before concluding that bigger is worse. [rule-candidate]
- Avoid sizing a model so that it can only just fit the training set; that is where test error peaks.
- When more data or longer training hurts, check whether the model sits near its interpolation threshold, and expect label noise to make it worse.
- Regularization (ridge, weight decay) is the cheap insurance against the peak.

## Verification status
- Verified: 47 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- [Reconciling modern machine learning practice and the bias-variance trade-off](https://arxiv.org/html/1812.11118v2) — Belkin, Hsu, Ma, Mandal, 2018. Backs: interpolating models with high test accuracy, the double descent curve and interpolation threshold, random Fourier features with minimum-norm fits, peak at `N = n`, norm largest at the threshold, small-norm inductive bias, `n·K` threshold for networks, SGD masking, the 10⁹-parameter estimate. [^1]
- [Deep Double Descent: Where Bigger Models and More Data Hurt](https://arxiv.org/html/1912.02292v1) — Nakkiran et al., 2019. Backs: EMC definition and hypothesis, epoch-wise and sample-wise double descent, more data can hurt, early stopping only for critical models, label noise strongest, plateau without noise, one noise-sensitive model at the threshold, ensembling. [^2]
- [Generalization (Patterns, Predictions, and Actions)](https://mlstory.org/generalization.html) — Hardt, Recht, living. Backs: textbook U-curve and its bias–variance justification, interpolation threshold and regimes, double descent without regularization for certain families, single descent and multiple bumps. [^3]
- `machine-learning/lab-setup.md` — the lab where the random-ReLU-feature sweep with minimum-norm and ridge fits ran on 2026-11-24. [^4]
- [Deep Learning, chapter 5: Machine Learning Basics](https://www.deeplearningbook.org/contents/ml.html) — Goodfellow, Bengio, Courville, 2016. Backs: the classical capacity–error curve, underfitting and overfitting zones, the generalization gap. [^5]
- [numpy.linalg.lstsq](https://numpy.org/doc/stable/reference/generated/numpy.linalg.lstsq.html) — NumPy developers, living (v2.5 manual). Backs: the smallest-2-norm solution among several minimizers. [^6]

## Related
- `machine-learning/foundations/generalization-and-overfitting.md` — the classical bias–variance trade-off this curve extends.
- `machine-learning/foundations/regularization.md` — ridge and early stopping, which tame the peak.
- `machine-learning/learning-theory/pac-learning-and-vc-dimension.md` — why capacity-based bounds miss this behaviour.
- `machine-learning/learning-theory/no-free-lunch-and-inductive-bias.md` — the small-norm preference as an inductive bias.
- `machine-learning/supervised-learning/linear-regression.md` — least squares, the fit used in the worked example.
- `machine-learning/transformers/pretraining-and-scaling-laws.md` — how large models are sized in practice.
