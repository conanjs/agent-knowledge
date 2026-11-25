---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/foundations
status: verified
applies-to: ["any", "scikit-learn 1.9.1"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [machine-learning, basics, optimization, gradient-descent, sgd, mini-batch, learning-rate, convergence, divergence, conditioning, feature-scaling]
---

# Gradient descent: learning rate, batches and conditioning

## Summary
**TL;DR:** Gradient descent fits a model by repeatedly computing the **gradient** of the loss (the direction in which the loss rises fastest) and stepping the parameters a small amount the other way: `θ ← θ − η · ∇L(θ)`. The step size `η`, the **learning rate**, decides everything: too small and training crawls, too large and the parameters overshoot, oscillate or diverge. Computing the gradient on all examples (batch), one example (stochastic, SGD) or a small random subset (mini-batch) trades exact steps against cheap, noisy ones. When features have very different scales, the loss surface is a long narrow valley (a high **condition number**), and plain gradient descent becomes very slow; standardizing the features fixes most of it.
**Use this when:** training loss goes up, oscillates, becomes NaN (not a number) or stalls; you choose a learning rate or batch size; or you wonder why scaling the features speeds up training.
**Not this doc:** momentum, Adam, AdamW and learning-rate schedules → `machine-learning/deep-learning/optimizers-and-learning-rate-schedules.md`; computing gradients of deep networks → `machine-learning/deep-learning/neural-networks-and-backpropagation.md`; what loss is being minimized → `machine-learning/foundations/loss-functions-and-maximum-likelihood.md`; the scaling step in a pipeline → `machine-learning/data-and-features/preprocessing-and-pipelines.md`.

## Problem
Most models have no formula for their best parameters, so they are found by iterating, and the iteration can fail quietly. On `f(x) = x²` started at `x = 10`, ten steps with learning rate 0.05 still leave `x = 3.49`, a rate of 1.0 bounces between 10 and −10 forever, and 1.1 ends at 61.9, further away than the start ✅[^11]. On a two-feature linear regression whose second feature is 100 times wider than the first, gradient descent at a safe step of `1/λmax` was still not within 1e-6 of the best MSE (mean squared error) after 200,000 iterations; after standardizing, it took 4 ✅[^11].

## Mental model
**Analogy:** walking down a foggy hillside. You cannot see the valley, only the slope under your feet (the gradient). Each step you face downhill and stride a fixed length (the learning rate). Tiny strides waste the day; huge strides jump over the valley floor onto the opposite slope, possibly higher than where you began. If the valley is a long, narrow ravine (badly scaled features), the steep walls force short strides, and you zig-zag between them while barely moving along the gentle floor toward the exit.

**Artifact:** `x ← x − η·2x` on `f(x) = x²` from `x = 10`, ten steps each; lab run (`machine-learning/lab-setup.md`), 2026-11-24, numpy 2.5.5 ✅[^11]:

```text
eta   factor(1-2eta)  x after 10 steps
0.05  +0.90               3.486784
0.20  +0.60               0.060466
0.50  +0.00               0.000000
0.90  -0.80               1.073742
1.00  -1.00              10.000000
1.10  -1.20              61.917364
```

Read top to bottom: 0.05 is slow, 0.2 converges, 0.5 reaches the minimum in one step, 0.9 oscillates around it but still converges, 1.0 bounces between +10 and −10, and 1.1 diverges ✅[^11].

## How it works

### The gradient and the update
- For a function of several parameters, the **gradient** `∇f(x)` is the vector of its partial derivatives, one per parameter; each says how fast `f` changes when that one parameter moves ✅[^1]. Up to second-order terms, `−∇f(x)` is the direction of steepest descent ✅[^1].
- **The update:** `x ← x − η · ∇f(x)` with a learning rate `η > 0` ✅[^1]. Repeat until the gradient is small enough or an iteration budget runs out ✅[^1].
- **Example** (one parameter): for `f(x) = x²` the derivative is `2x`; at `x = 10` with `η = 0.2` the step is `10 − 0.2 · 20 = 6` ✅[^1].
- **For a model:** the parameters are the weights and bias, `f` is the training loss, and each step moves every weight by `η` times its slope ✅[^5]. A slope of 2.5 with `η = 0.01` changes the weight by 0.025 ✅[^6].

### Why the learning rate has a ceiling
For the one-dimensional quadratic `f(x) = x²`, the update is `x ← x − η·2x = (1 − 2η) · x`: every step multiplies the distance to the minimum by the same factor `1 − 2η`. The factor's size decides the outcome, as the artifact shows: below 1 the iterate converges (with a negative factor it flips sides each step), exactly 0 reaches the minimum in one step, 1 bounces for ever, above 1 diverges ✅[^11]. The curvature (second derivative) of `x²` is 2, so the one-step rate `η = 0.5` is `1 / curvature` and the ceiling `η < 1` is `2 / curvature` ✅[^11]. A small step makes progress because the first-order Taylor approximation `f(x − η f'(x)) ≈ f(x) − η f'(x)²` holds; a step too large makes the neglected second-order term dominate, and the loss can rise ✅[^1]. In several dimensions the curvature along each eigenvector of the **Hessian** (the matrix of second derivatives) is the matching eigenvalue, and to the extent the loss is close to quadratic those eigenvalues set the scale of a usable learning rate; in the worst direction the best step is `1 / λmax`, where `λmax` is the largest eigenvalue ✅[^8].

### Conditioning: why feature scaling matters
The **condition number** of the Hessian is the ratio of its largest to its smallest eigenvalue, `κ = λmax / λmin` ✅[^8]. When it is large, the loss curves steeply in one direction and gently in another; the step must be small enough not to overshoot in the steep direction, which makes it too small to make progress in the gentle one ✅[^8]. Features on very different ranges produce exactly this: gradient descent "bounces" and converges slowly, or fails to converge at all ✅[^7]. The fixes: standardize each feature to mean 0 and variance 1 (or scale to a fixed range), fitting the scaler on the training data only and applying the same transform to test data ✅[^10]; or precondition, which amounts to a separate learning rate per parameter ✅[^1]. Adaptive optimizers such as Adagrad and Adam adjust the effective learning rate over time and protect against this problem ✅[^7].

### Batch, stochastic and mini-batch
The training loss is an average of per-example losses, so its gradient is the average of per-example gradients ✅[^2].

| Variant | Gradient from | Cost per update | Updates per epoch (1,000 examples) |
|---|---|---|---|
| Batch (full-batch) gradient descent | All examples ✅[^9] | Grows with `n`, `O(n)` ✅[^2] | 1 ✅[^6] |
| Stochastic gradient descent (SGD) | One random example ✅[^2] ✅[^6] | Constant, `O(1)` ✅[^2] | 1,000 ✅[^6] |
| Mini-batch SGD | A random subset of size `b` (`1 < b < n`) ✅[^6] | Grows with `b` ✅[^3] | 10 for `b = 100` ✅[^6] |

- An **epoch** is one pass over the whole training set ✅[^6].
- A single example's gradient is an unbiased estimate of the full gradient: right on average ✅[^2], but noisy, so the loss can rise from one update to the next ✅[^6]. Averaging `b` examples keeps the expectation and divides the gradient's standard deviation by `√b` ✅[^3].
- Returns diminish: 10,000 examples cost 100 times more than 100 but cut the standard error only 10 times ✅[^9].
- With a constant learning rate, SGD keeps jittering near the minimum and does not settle; the learning rate is decayed during training to fix that ✅[^2] ✅[^3].
- Mini-batches should be drawn at random; data stored in a meaningful order (sorted, grouped) must be shuffled first ✅[^9] ✅[^10]. A standard way is a random permutation per epoch, which visits each example once per epoch ✅[^3].
- Practical sizes: a mini-batch of 32 to 256 is a good start ✅[^4]; small batches can have a regularizing effect but need a smaller learning rate ✅[^9].
- Measured in wall-clock time, mini-batch SGD usually reaches a lower loss faster than either extreme ✅[^3].

### Convergence
A model has **converged** when more iterations no longer reduce the loss; for linear models the loss surface is convex, so convergence means the global minimum ✅[^5]. Past convergence the loss fluctuates slightly, so watch the loss curve until it has stabilized ✅[^5]. For non-convex losses, where gradient descent ends up depends on the learning rate and on how well conditioned the problem is; it can stop in a poor local minimum ✅[^1].

## Worked example
One script, four experiments: the learning-rate sweep of the artifact; six steps of gradient descent on a seven-car dataset (weight in thousands of pounds → miles per gallon) from Google's Machine Learning Crash Course, MSE loss, `η = 0.01`, starting at weight = bias = 0 ✅[^5]; the same two-feature regression with raw and standardized features, at a safe step of `η = 1/λmax`; and three batch sizes on the standardized data. Core lines of the fuel-efficiency loop:

```python
err = w * xf + b - yf                                  # prediction minus label, per car
w, b = w - 0.01 * np.mean(2 * err * xf), b - 0.01 * np.mean(2 * err)   # dMSE/dw, dMSE/db
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-24, Python 3.13.7, numpy 2.5.5, two runs identical ✅[^11]:

```text
eta   factor(1-2eta)  x after 10 steps
0.05  +0.90               3.486784
0.20  +0.60               0.060466
0.50  +0.00               0.000000
0.90  -0.80               1.073742
1.00  -1.00              10.000000
1.10  -1.20              61.917364

iter  weight  bias   MSE
   1    0.00   0.00  303.71
   2    1.20   0.34  170.84
   3    2.05   0.59  103.17
   4    2.66   0.78   68.70
   5    3.09   0.91   51.13
   6    3.40   1.01   42.17
raw features : condition number   56482.3, eta 1.41e-04, stopped after 200000 iterations, MSE gap 3.0e-04
standardized : condition number       1.1, eta 4.76e-01, stopped after      4 iterations, MSE gap 2.0e-08
batch size 200:    5 updates in 5 epochs, training MSE 7.2684
batch size  20:   50 updates in 5 epochs, training MSE 0.0104
batch size   1: 1000 updates in 5 epochs, training MSE 0.0107
```

<details><summary>Full script (prints the output above)</summary>

```python
# Gradient descent: learning rate on a 1-D quadratic, the fuel-efficiency example,
# feature scaling (conditioning), and batch vs mini-batch vs stochastic updates.
import numpy as np

# 1. f(x) = x^2, f'(x) = 2x, start at x = 10, 10 steps: x <- x - eta * 2x = (1 - 2*eta) * x
print("eta   factor(1-2eta)  x after 10 steps")
for eta in [0.05, 0.2, 0.5, 0.9, 1.0, 1.1]:
    x = 10.0
    for _ in range(10):
        x -= eta * 2 * x
    print(f"{eta:4.2f}  {1 - 2 * eta:+.2f}           {x:12.6f}")

# 2. Fuel efficiency (pounds in 1000s -> miles per gallon), MSE loss, w = b = 0, eta = 0.01.
xf = np.array([3.5, 3.69, 3.44, 3.43, 4.34, 4.42, 2.37]); yf = np.array([18, 15, 18, 16, 15, 14, 24.0])
w = b = 0.0
print("\niter  weight  bias   MSE")
for it in range(1, 7):
    err = w * xf + b - yf
    print(f"{it:4d}  {w:6.2f}  {b:5.2f}  {np.mean(err**2):6.2f}")
    w, b = w - 0.01 * np.mean(2 * err * xf), b - 0.01 * np.mean(2 * err)

# 3. Conditioning: same linear problem, raw vs standardized features, full-batch GD.
rng = np.random.default_rng(0)
n = 200
X_raw = np.column_stack([rng.uniform(0, 1, n), rng.uniform(0, 100, n)])   # feature 2 is 100x wider
y = 3 * X_raw[:, 0] + 0.05 * X_raw[:, 1] + rng.normal(0, 0.1, n)
def gd_steps(X, y, tol=1e-6, max_iter=200_000):
    Xb = np.column_stack([np.ones(len(y)), X])              # prepend a column of 1s for the bias
    H = 2 * Xb.T @ Xb / len(y)                              # Hessian of MSE (constant)
    eig = np.linalg.eigvalsh(H)
    eta = 1.0 / eig.max()                                   # a safe step: below 2 / largest eigenvalue
    theta = np.zeros(Xb.shape[1])
    best = np.linalg.lstsq(Xb, y, rcond=None)[0]
    best_loss = np.mean((Xb @ best - y) ** 2)
    for k in range(1, max_iter + 1):
        theta -= eta * 2 * Xb.T @ (Xb @ theta - y) / len(y)
        gap = np.mean((Xb @ theta - y) ** 2) - best_loss
        if gap < tol:
            break
    return k, eig.max() / eig.min(), eta, gap
X_std = (X_raw - X_raw.mean(axis=0)) / X_raw.std(axis=0)
for name, X in [("raw features", X_raw), ("standardized", X_std)]:
    k, cond, eta, gap = gd_steps(X, y)
    print(f"{name:13s}: condition number {cond:9.1f}, eta {eta:.2e}, stopped after {k:6d} iterations, MSE gap {gap:.1e}")

# 4. Batch size: updates per epoch and loss after 5 epochs (standardized data, eta = 0.05).
Xb = np.column_stack([np.ones(n), X_std])
for bs in [n, 20, 1]:
    rng_b = np.random.default_rng(1)
    theta, updates = np.zeros(3), 0
    for epoch in range(5):
        idx = rng_b.permutation(n)
        for start in range(0, n, bs):
            j = idx[start:start + bs]
            theta -= 0.05 * 2 * Xb[j].T @ (Xb[j] @ theta - y[j]) / len(j)
            updates += 1
    print(f"batch size {bs:3d}: {updates:4d} updates in 5 epochs, training MSE {np.mean((Xb @ theta - y)**2):.4f}")
```

</details>

Reading it:
- **The `eta` table.** The three rows for 0.05, 0.2 and 1.1 print the same values as the gradient-descent chapter of Dive into Deep Learning (3.486784, 0.060466, 61.917364) ✅[^11] ✅[^1]. Each final `x` is `10 · (1 − 2η)¹⁰`: for 0.9, `10 · 0.8¹⁰ = 1.07` ✅[^11].
- **The fuel table.** Iteration 1 at weight = bias = 0 has MSE 303.71; the slopes there are −119.7 for the weight and −34.3 for the bias, so the first step gives weight `0 − 0.01 · (−119.7) = 1.20` and bias `0.34` ✅[^5]. All six rows match the course's table to two decimals ✅[^11] ✅[^5]: the loss falls every step, by less each time (−133, −68, −34, −18, −9).
- **The conditioning pair.** The raw features give a Hessian condition number of 56,482. The step `1/λmax = 1.41e-04` is safe for the steepest direction but far too small for the flattest one ✅[^8], where each iteration removes only about `1/κ` of the remaining error; 200,000 iterations later the loss is still `3.0e-04` above the best possible ✅[^11]. Standardizing brings the condition number to 1.1 and the step to 0.476, and 4 iterations suffice ✅[^11]. Same data, same model, same algorithm; only the feature scales differ.
- **The batch-size rows.** With the same learning rate and 5 epochs, full batch makes 5 updates and is still far off (MSE 7.27); mini-batches of 20 make 50 and reach 0.0104, single examples make 1,000 and reach 0.0107 ✅[^11], near the noise variance of 0.01 the data was generated with. In this run, more frequent noisy steps beat fewer exact ones.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Learning rate too large | Loss rises or bounces ✅[^6] | The step overshoots the minimum ✅[^1]; lab: `η = 1.1` ends at 61.9 from 10 ✅[^11] |
| Learning rate exactly at the limit | Never converges, never diverges | Lab: `η = 1.0` on `x²` returns to 10 every two steps ✅[^11] |
| Learning rate too small | Many iterations for little progress | Lab: `η = 0.05` is still at 3.49 after 10 steps ✅[^11] ✅[^1] |
| Features with very different ranges | Slow or failed convergence; huge values can produce NaN | Poor conditioning ✅[^7] ✅[^8]; lab: 200,000 iterations not enough at `κ = 56,482` ✅[^11] |
| Scaler fitted on all the data | Test information leaks into training | Fit the scaler on the training data only ✅[^10]; `machine-learning/evaluation/data-leakage.md` |
| Training data sorted (by date, by class) and not shuffled | Mini-batches are not representative; gradients are biased | Mini-batches must be drawn at random ✅[^9]; scikit-learn shuffles by default ✅[^10] |
| Constant learning rate with SGD | Loss keeps jittering near the minimum | Gradient noise does not vanish; decay the rate ✅[^2] |
| Non-convex loss | Result depends on the learning rate and conditioning; may be a poor local minimum ✅[^1] | Linear-model losses are convex, so this cannot happen there ✅[^5] |
| Loss fluctuating slightly after many iterations | Normal after convergence | Keep training until the loss curve is flat before declaring convergence ✅[^5] |
| "Batch size" in a paper or API (application programming interface) | Usually means the mini-batch size | "Batch gradient descent" means the full set; "batch size" does not ✅[^9] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Full-batch gradient descent | Exact gradient, smooth loss curve | Cost per step grows with `n` ✅[^2]; impractical for very large datasets ✅[^6] |
| SGD (batch size 1) | Cheapest step ✅[^2]; often the best generalization ✅[^9] | Noisy ✅[^6]; needs a small learning rate, many steps, long runtime ✅[^9] |
| Mini-batch SGD | Best of both in wall-clock time ✅[^3]; uses vectorized hardware well ✅[^3] | Batch size is one more hyperparameter; memory grows with it ✅[^9] |
| Standardizing features | Lower condition number, far fewer iterations ✅[^11] | One preprocessing step that must be fitted on training data and reused at prediction ✅[^10] |

## Takeaways
- Standardize features before any gradient-based training, with the scaler fitted on the training split. [rule-candidate]
- If the training loss rises or turns NaN, lower the learning rate first; if it barely moves, raise it.
- Shuffle the training data before forming mini-batches. [rule-candidate]
- Judge convergence from a flat loss curve, not from a fixed number of iterations.

## Verification status
- Verified: 88 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- [Dive into Deep Learning, 12.3 Gradient Descent](https://d2l.ai/chapter_optimization/gd.html) — Aston Zhang, Zachary C. Lipton, Mu Li, Alexander J. Smola, living. Backs: Taylor-expansion argument, update rule and stop condition, `f(x) = x²` runs (3.486784, 0.060466, 61.917364), gradient as vector of partial derivatives, steepest descent, local minima, preconditioning as a per-parameter learning rate. [^1]
- [Dive into Deep Learning, 12.4 Stochastic Gradient Descent](https://d2l.ai/chapter_optimization/sgd.html) — Aston Zhang et al., living. Backs: objective as an average, `O(n)` vs `O(1)` cost per update, unbiased stochastic gradient, jitter with a constant rate, decaying the rate. [^2]
- [Dive into Deep Learning, 12.5 Minibatch Stochastic Gradient Descent](https://d2l.ai/chapter_optimization/minibatch-sgd.html) — Aston Zhang et al., living. Backs: mini-batch keeps the expectation and cuts the standard deviation by `b^(−½)`, statistical vs computational trade-off, random permutation per epoch, decaying rates, faster in clock time, vectorization. [^3]
- [Dive into Deep Learning, 3.1 Linear Regression](https://d2l.ai/chapter_linear-regression/linear-regression.html) — Aston Zhang et al., living. Backs: mini-batch size of 32 to 256 as a good start. [^4]
- [Linear regression: Gradient descent (Machine Learning Crash Course)](https://developers.google.com/machine-learning/crash-course/linear-regression/gradient-descent?hl=en) — Google for Developers, living. Backs: the procedure, the seven-car dataset and its six-iteration table, slopes −119.7 and −34.3, convergence, loss curves, convex loss for linear models. [^5]
- [Linear regression: Hyperparameters (Machine Learning Crash Course)](https://developers.google.com/machine-learning/crash-course/linear-regression/hyperparameters?hl=en) — Google for Developers, living. Backs: learning rate too low or too high, 2.5 × 0.01 = 0.025, SGD and mini-batch definitions, noise, epochs, updates per epoch. [^6]
- [Numerical data: Normalization (Machine Learning Crash Course)](https://developers.google.com/machine-learning/crash-course/numerical-data/normalization?hl=en) — Google for Developers, living. Backs: different feature ranges make gradient descent bounce and slow or fail to converge, NaN trap, Adagrad and Adam adjust the effective rate. [^7]
- [Deep Learning, chapter 4: Numerical Computation](https://www.deeplearningbook.org/contents/numerical.html) — Ian Goodfellow, Yoshua Bengio, Aaron Courville, 2016. Backs: condition number as the ratio of largest to smallest eigenvalue, poor conditioning slows gradient descent and constrains the step size, Hessian eigenvalues set the learning-rate scale, worst-case step `1/λmax`. [^8]
- [Deep Learning, chapter 8: Optimization for Training Deep Models](https://www.deeplearningbook.org/contents/optimization.html) — Ian Goodfellow, Yoshua Bengio, Aaron Courville, 2016. Backs: batch vs mini-batch terminology, standard error `σ/√n` and the 100 vs 10,000 example, factors in mini-batch size, small batches regularize but need small rates, random selection of mini-batches. [^9]
- [Stochastic Gradient Descent (User Guide 1.5)](https://scikit-learn.org/stable/modules/sgd.html) — scikit-learn developers, living (1.9.1). Backs: SGD is sensitive to feature scaling, standardize, fit the scaler on training data only, shuffle the data (default `shuffle=True`). [^10]
- `machine-learning/lab-setup.md` — the lab where the learning-rate sweep, the seven-car gradient-descent table, the raw vs standardized conditioning run and the batch-size comparison ran on 2026-11-24. [^11]

## Related
- `machine-learning/foundations/loss-functions-and-maximum-likelihood.md` — the function whose gradient is followed.
- `machine-learning/foundations/regularization.md` — early stopping: halting gradient descent on purpose.
- `machine-learning/foundations/math-notation-reference.md` — `∇`, partial derivatives and `argmin` with numbers.
- `machine-learning/deep-learning/optimizers-and-learning-rate-schedules.md` — momentum, Adam, AdamW, warmup and decay.
- `machine-learning/deep-learning/neural-networks-and-backpropagation.md` — how the gradient of a deep network is computed.
- `machine-learning/data-and-features/preprocessing-and-pipelines.md` — scaling inside a `Pipeline`, fitted on training data only.
- `machine-learning/supervised-learning/linear-regression.md` — the closed-form alternative for least squares.
