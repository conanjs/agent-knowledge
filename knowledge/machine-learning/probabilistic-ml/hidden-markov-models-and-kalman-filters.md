---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/probabilistic-ml
status: verified
applies-to: ["any"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, probabilistic-ml, state-space-model, hidden-markov-model, hmm, forward-backward, viterbi, baum-welch, kalman-filter, kalman-gain, extended-kalman-filter, particle-filter, sequential-monte-carlo, effective-sample-size]
---

# Hidden Markov models and Kalman filters: inference in state-space models

## Summary
**TL;DR:** A state-space model has a hidden state that moves as a Markov chain and one observation per step that depends only on the current state. With a discrete state it is an HMM (hidden Markov model): the forward algorithm gives the likelihood in time linear in the sequence length instead of summing over every hidden path, forward–backward gives each step's state probabilities given the whole sequence, Viterbi gives the single most probable path, and Baum–Welch (EM, expectation–maximization) learns the matrices from observations alone. With a continuous state, linear dynamics and Gaussian noise, the same forward pass is the Kalman filter: predict the mean and covariance through the dynamics, then move the prediction toward the measurement by the Kalman gain, which is large when the prediction is uncertain and small when the measurement is noisy. Nonlinear models need approximations: the extended Kalman filter linearizes; the particle filter tracks weighted samples and resamples them before their weights collapse.
**Use this when:** you track something you cannot see from noisy measurements (a position, a hidden regime, which die is in play), need the likelihood of a sequence under a latent-state model, fit an HMM, or tune or debug a Kalman, extended Kalman or particle filter.
**Not this doc:** S4 and Mamba, the "state-space models" of deep learning (deterministic linear recurrences used as network layers, with no noise model and no posterior) → `machine-learning/transformers/efficient-attention-and-state-space-models.md`; inference on general graphs → `machine-learning/probabilistic-ml/probabilistic-graphical-models.md`; EM in general → `machine-learning/unsupervised-learning/gaussian-mixtures-and-em.md`; ARIMA (autoregressive integrated moving average) and exponential-smoothing forecasts → `machine-learning/time-series/classical-forecasting-models.md`.

## Problem
Many signals are noisy views of a quantity that cannot be observed directly: which die a casino is rolling, or where a vehicle is and how fast it moves. Taking each observation alone ignores that the hidden quantity changes slowly; reasoning about the whole hidden history by brute force means summing over `k^T` paths for `k` states and `T` steps ✅[^5], 2^2000 for 2000 rolls of two dice. In the lab, labelling every roll "fair" was right 71.3 % of the time and forward–backward 81.7 %; a Kalman filter cut the position error from 2.052 (raw measurements) to 1.360 and estimated a velocity that was never measured to within 0.336 RMSE (root-mean-square error) ✅[^13]. The same model also fails in instructive ways: probabilities underflow on long sequences, EM stalls, and the extended Kalman filter lost track on 9 of 20 nonlinear runs ✅[^13].

## Mental model
**Analogy:** a ship's navigator without satellite positioning. Between landmarks she moves her pencil mark forward by the known speed and heading, and draws the uncertainty circle a little wider (predict). When a noisy landmark sighting arrives she moves the mark part of the way toward it: most of the way if her circle is wide, a little if the sighting is known to be poor (update; the fraction is the gain). At the end of the voyage she can redraw the whole track with hindsight, using later sightings to correct earlier marks (smoothing). The casino version is a pit boss who keeps a running belief "the loaded die is in play", nudged up by every six.

**Artifact:** the graph every model in this doc shares, drawn by hand from the model definition in step 1 of How it works (F is the fair die, L the loaded one):

```text
 z1 ──▶ z2 ──▶ z3 ──▶ … ──▶ zT      hidden state: die (F/L), or (position, velocity)
 │      │      │             │
 ▼      ▼      ▼             ▼
 x1     x2     x3            xT      observation: a roll, or a noisy position
 p(z, x) = p(z1) p(x1|z1) · Π_{t≥2} p(zt|zt-1) p(xt|zt)
```

Then four rows of the gain table printed by the full script in the Worked example: the Kalman gain settles to a constant as the filter's uncertainty (`sd`, standard deviation, of the position estimate) stops shrinking; lab run (`machine-learning/lab-setup.md`), 2026-11-25, numpy 2.5.5 ✅[^13]:

```text
    t  K_position  K_velocity  sd(position)
    1       0.980       0.490         1.980
    5       0.594       0.198         1.541
   20       0.313       0.059         1.119
  100       0.313       0.059         1.119
```

## How it works
### The state-space model
1. **Definition.** A transition density `f(z_t | z_{t−1})`, an observation density `g(x_t | z_t)` and a prior `p(z_1)` give the joint `p(z_1) g(x_1 | z_1) Π_{t≥2} f(z_t | z_{t−1}) g(x_t | z_t)`; Naesseth, Lindsten and Schön call this the state space model "(or hidden Markov model)" ✅[^1]. An HMM as hmmlearn implements it has a start vector `π`, a transition matrix `A` between hidden states and an emission distribution per state ✅[^2].
2. **The casino.** hmmlearn's dishonest-casino example swaps a fair die for one that rolls a six half the time: stay fair with probability 0.95, stay loaded with 0.90 ✅[^4]. The lab uses those numbers.
3. **Three questions.** Given the parameters, the likelihood of the observations and the best hidden-state sequence; given only observations, the parameters ✅[^2]. Filtering estimates the current state from data up to now; smoothing estimates past states using later data too ✅[^11].

### HMM inference: forward, forward–backward, Viterbi
4. **Forward.** Sum out one hidden state at a time ✅[^5]. The lab's form is `α_t(j) = B(j, x_t) · Σ_i α_{t−1}(i) · A(i, j)` with `α_1(j) = π(j) · B(j, x_1)`, where `A(i, j)` is the probability of moving from state `i` to `j`, `B(j, v)` that of emitting `v` in state `j`, and `α_t(j) = p(x_1..x_t, z_t = j)`; Dive into Deep Learning (d2l) writes the same recursion with the emission applied one step later ✅[^5]. This is variable elimination along a chain, `O(T·k²)` instead of `O(k^T)` ✅[^6]. Example with the first two rolls `2, 1`: `α_1 = (1 · 1/6, 0) = (0.1667, 0)`; `α_2 = (0.1667 · 0.95 · 1/6, 0.1667 · 0.05 · 0.1) = (0.02639, 0.00083)`, so `p(2, 1) = 0.02722`. On 10 rolls the forward recursion needs 56 multiplications against 19,456 for enumeration (counts the lab script derives from its loops), with the same `1.398155e-08` ✅[^13].
5. **Scaling.** The product of hundreds of probabilities underflows: the unscaled forward pass over 2000 rolls returned exactly `0.0` ✅[^13]. Normalize each `α_t` and keep the normalizers `c_t`; then `log p(x) = Σ_t log c_t` (lab: `−3518.57`) ✅[^13]. hmmlearn's forward–backward works with logarithms or with scaling ✅[^3].
6. **Backward and posteriors.** The backward recursion `β_{t−1}(i) = Σ_j A(i, j) · B(j, x_t) · β_t(j)`, with `β_T = 1` and `β_t(i) = p(x_{t+1}..x_T | z_t = i)`, sums out the future the same way ✅[^5], and `p(z_t | x_1..x_T) ∝ α_t · β_t`: the lab's forward–backward matched enumeration over 1024 paths to `1.9e-15` ✅[^13]. d2l calls forward–backward a very special instance of general message passing, here belief propagation on the chain ✅[^5]; the forward recursion even looks like a recurrent network's state update ✅[^5].
7. **Viterbi.** Replace the sum by a maximum and keep back-pointers to recover the single most probable path, the max-product algorithm on a chain ✅[^7] ✅[^2]. It answers a different question from picking each step's most probable state, and hmmlearn's `predict` offers both decoders ✅[^2]. Lab, 2000 rolls: filtering (forward only) 78.2 % correct, Viterbi 79.2 %, forward–backward 81.7 % ✅[^13].

### Learning an HMM: Baum–Welch
8. **EM for HMMs.** Baum–Welch is the EM algorithm for the third question ✅[^2]. E-step: compute the posterior over the hidden states under the current parameters ✅[^8]; the lab script takes from forward–backward each step's state probabilities (`gamma`) and each adjacent pair's (`xi`). M-step: with complete data the maximum-likelihood tables would be normalized counts ✅[^9], and EM maximizes the expected log-likelihood, which splits into the same per-table terms ✅[^8], so the new `A(i, j)` is the expected number of `i → j` transitions divided by the expected number of transitions out of `i`.
9. **What it guarantees.** The likelihood never decreases, but EM converges to a local optimum that depends on the starting point, so restarts are standard ✅[^8] ✅[^2]. The learned states come out in an arbitrary order ✅[^2]. Lab, 10,000 rolls: from a random start it recovered stay probabilities 0.957 and 0.891 (true 0.95, 0.90) and `p(six | loaded)` 0.530 (true 0.500) after 225 iterations ✅[^13].

### The linear-Gaussian case: the Kalman filter
10. **The model.** `x_t = F x_{t−1} + B u_t + w_t` and `z_t = H x_t + v_t`: `F` moves the state one step, `u_t` is a known control input and `B` maps it into the state (a different `B` from the HMM's emission matrix), `H` maps the state to what is measured, and the noises `w_t`, `v_t` are zero-mean with covariances `Q` and `R`, uncorrelated over time ✅[^10]. (Here `x` is the hidden state and `z` the measurement, the usual Kalman letters.)
11. **Exact Bayes in closed form.** Filtering alternates a prediction, an integral of the transition over the previous belief, and an update by Bayes' rule with the new measurement; with linear functions and Gaussian noise every belief stays Gaussian and both steps have closed forms ✅[^11].
12. **Predict.** `x̂_{t|t−1} = F x̂_{t−1|t−1} + B u_t` ✅[^10] and `P_{t|t−1} = F P_{t−1|t−1} Fᵀ + Q` ✅[^11], where `x̂_{t|t−1}` is the a priori estimate and `P` its covariance ✅[^10].
13. **Update.** Innovation `y_t = z_t − H x̂_{t|t−1}` ✅[^10], its covariance `S = H P Hᵀ + R` ✅[^12], gain `K = P_{t|t−1} Hᵀ S⁻¹`, then `x̂_{t|t} = x̂_{t|t−1} + K y_t` and `P_{t|t} = (I − K H) P_{t|t−1}`, `I` being the identity matrix ✅[^10] ✅[^11]. In one dimension, fusing a prediction `x₁` of variance `σ₁²` with a measurement `x₂` of variance `σ₂²`, `K = σ₁² / (σ₁² + σ₂²)`, prediction variance over total variance, and the fused value is `x₁ + K (x₂ − x₁)` with variance `(1 − K) σ₁²` ✅[^10]: a prediction of 20.0 with variance 3 and a measurement of 22.0 with variance 1 give `K = 0.75`, an estimate of 21.5 and variance 0.75. Lab, first step: the prior position variance is `100 + 100 + 0.005 = 200.005` (from `P₀ = 100·I` and `Q`), so `K_position = 200.005 / (200.005 + 4) = 0.980`, as printed ✅[^13].
14. **Steady state.** For a linear time-invariant system the gain and covariance converge to fixed values, which FilterPy lets you precompute ✅[^12]; lab: `(0.313, 0.059)` from step 20 on ✅[^13]. For a random walk observed with noise (`F = H = 1`), the update `x̂_t = x̂_{t−1} + K (z_t − x̂_{t−1})` ✅[^10] with a settled `K` rearranges to `x̂_t = K z_t + (1 − K) x̂_{t−1}`, simple exponential smoothing with `α = K`. In the lab, with a gain settled at `0.3904`, the two differed by at most `6.8e-05` after step 20 ✅[^13].
15. **Optimality without Gaussians.** The filter is the best linear unbiased estimator whatever the noise distribution; with Gaussian noise no unbiased nonlinear estimator does better, without it one may ✅[^10]. Smoothing has its own backward pass, the Rauch–Tung–Striebel smoother over the filter's means and covariances ✅[^12].

### Nonlinear models: the extended Kalman filter and particle filters
16. **EKF (extended Kalman filter).** For `x_t = f(x_{t−1}, u_t) + w_t`, `z_t = h(x_t) + v_t`, predict the mean with `f` itself and use the Jacobians of `f` and `h` (matrices of first partial derivatives) in place of `F` and `H` ✅[^10]. Pei et al. call the EKF and the UKF (unscented Kalman filter, which propagates approximations of the distributions instead) heuristics ✅[^10].
17. **Particle filters (sequential Monte Carlo).** Conceived for online inference in nonlinear state-space models ✅[^1]. Each step resamples particles in proportion to their weights, propagates each through a proposal, and re-weights ✅[^1]. The bootstrap filter proposes from the dynamics themselves ✅[^1]; since a weight is target over proposal ✅[^1], the transition density cancels and the weight is the likelihood of the new observation given the particle's state (`g` in step 1).
18. **Degeneracy and the effective sample size.** Without resampling, the largest normalized weight quickly approaches one, so one particle carries the whole approximation ✅[^1]. The effective sample size `ESS = 1 / Σ_i w_i²`, `w_i` being the normalized weights of the `N` particles, lies between 1 and `N`; weights `(0.7, 0.1, 0.1, 0.1)` give `1 / 0.52 = 1.92` ✅[^1]. Resampling adds variance by duplicating heavy particles and dropping light ones, so a common rule resamples only when ESS falls below `N/2` ✅[^1]. Lab, 1000 particles without resampling: ESS 146.6 after one step, 1.0 from step 20; with resampling at every step, mean ESS 532.1 before each resampling and only 454 distinct particles after it ✅[^13].
19. **Dimension.** Weight degeneracy returns for high-dimensional states: asymptotic results for Gaussian targets say the number of particles must grow at least exponentially with the variance of the log-weights, which in simple examples is proportional to the dimension ✅[^1].

## Worked example
Three parts, numpy only. **A:** the casino HMM: likelihood of 10 rolls by enumeration vs the forward algorithm, forward–backward and Viterbi checked against enumeration, underflow on 2000 rolls, decoding accuracy, Baum–Welch on 10,000 rolls. **B:** a constant-velocity Kalman filter (`F = [[1, 1], [0, 1]]`, position measured with standard deviation 2), a random-walk filter against exponential smoothing, and a bootstrap particle filter (PF in the output) on the same data. **C:** `x_t = x_{t−1} + 0.1 + noise`, `y_t = sin(x_t) + noise` (the output writes the noise as `N(0, v)`, Gaussian with mean 0 and variance `v`), EKF vs particle filter over 20 runs, and ESS with and without resampling. The Kalman step:

```python
m, P = F @ m, F @ P @ F.T + Q                                  # predict
S = H @ P @ H.T + R; K = P @ H.T @ np.linalg.inv(S)            # gain
m = m + K @ (zs[t] - H @ m); P = (np.eye(2) - K @ H) @ P       # update
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-25, Python 3.13.7, numpy 2.5.5, two runs identical ✅[^13]:

```text
== A. HMM: the dishonest casino (fair die F, loaded die L) ==
first 10 rolls: 2 1 6 5 6 1 1 2 4 3 | hidden: FFFFFFFFFF
brute force over 1024 paths: p(rolls) = 1.398155e-08  (19456 multiplications, 1023 additions)
forward algorithm          : p(rolls) = 1.398155e-08  (56 multiplications, 19 additions)
max |forward-backward - enumeration| over p(z_t | 10 rolls): 1.9e-15; Viterbi path = most probable of the 1024: True
2000 rolls: unscaled forward p = 0.0; scaled forward log p = -3518.57
share of the 2000 steps labelled correctly: always fair 0.713 | filtering 0.782 | forward-backward 0.817 | Viterbi 0.792
rolls   2261645335114123545663466265164352166656656611566665554452365146421666
truth   LLLLLLFFFFFFFFFFFFFFFFFFFFLLLLLLLLLLLLLLLLLLLLLLLLLFFFLLLLLLLLLLLLLLLL
Viterbi FFFFFFFFFFFFFFFFFFFLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLFFFFFFFFFFFFFFFFFFF
P(L)>.5 FFFFFFFFFFFFFFFFFFFLLLLLLLLLLLFFFFLLLLLLLLLLLLLLLLLFFFFFFFFFFFFFFFFLLL
Baum-Welch (EM) on 10,000 rolls from a random start:
  iteration   1: log-likelihood -22586.66
  iteration   2: log-likelihood -17567.40
  iteration   5: log-likelihood -17566.02
  iteration  10: log-likelihood -17562.55
  iteration  50: log-likelihood -17459.27
  iteration 100: log-likelihood -17431.02
  iteration 200: log-likelihood -17425.10
  stopped at iteration 225: log-likelihood -17425.10; the true parameters give -17435.33
  learned stay probabilities: F 0.957 (true 0.95), L 0.891 (true 0.90)
  learned p(six): F 0.170 (true 0.167), L 0.530 (true 0.500)
  start with identical dice and uniform transitions: after 50 iterations p(six) = 0.271 and 0.271, log-likelihood -17570.69
== B. Kalman filter: state (position, velocity), measured position with sd 2.0 ==
    t  K_position  K_velocity  sd(position)
    1       0.980       0.490         1.980
    2       0.936       0.843         1.935
    3       0.808       0.467         1.798
    5       0.594       0.198         1.541
   10       0.368       0.071         1.213
   20       0.313       0.059         1.119
   50       0.313       0.059         1.119
  100       0.313       0.059         1.119
RMSE position: raw measurements 2.052, Kalman 1.360; RMSE velocity (never measured): 0.336
local level (q=1, r=4): gain settles at 0.3904; Kalman vs exponential smoothing with alpha = gain: max gap after step 20 = 6.8e-05
bootstrap particle filter, 1000 particles, same data: mean |PF mean - Kalman mean| = 0.061 (Kalman posterior sd 1.250)
== C. nonlinear model: x_t = x_t-1 + 0.1 + N(0, 0.05), y_t = sin(x_t) + N(0, 0.01) ==
20 runs of 100 steps: median RMSE EKF 0.427, particle filter 0.231; runs with RMSE > 1: EKF 9, particle filter 0
ESS of 1000 particles without resampling: t=1 146.6, t=2 25.6, t=5 4.0, t=10 1.6, t=20 1.0, t=50 1.0
with resampling every step: mean ESS before resampling 532.1; after resampling all weights are 1/N (ESS 1000), but only 454 distinct particles on average
```

<details><summary>Full script (prints the output above)</summary>

```python
# State-space models by hand (numpy): an HMM (forward, forward-backward, Viterbi, Baum-Welch),
# a Kalman filter, and an extended Kalman filter vs a bootstrap particle filter.
import itertools
import numpy as np
rng = np.random.default_rng(0)

# ---------- A. the dishonest casino HMM: state 0 = fair die F, state 1 = loaded die L ----------
PI = np.array([1.0, 0.0])                               # start with the fair die
A = np.array([[0.95, 0.05], [0.10, 0.90]])              # A[i, j] = p(z_t = j | z_t-1 = i)
B = np.array([[1 / 6] * 6, [0.1] * 5 + [0.5]])          # B[i, v] = p(roll v+1 | die i)

def sample(T):
    z, x = np.zeros(T, int), np.zeros(T, int)
    for t in range(T):
        z[t] = rng.choice(2, p=PI if t == 0 else A[z[t - 1]])
        x[t] = rng.choice(6, p=B[z[t]])
    return z, x

def forward(x, pi, A, B):                               # scaled: each alpha_t sums to 1, c_t = p(x_t | x_1..t-1)
    alpha, c = np.zeros((len(x), 2)), np.zeros(len(x))
    a = pi * B[:, x[0]]
    for t in range(len(x)):
        if t > 0:
            a = (alpha[t - 1] @ A) * B[:, x[t]]
        c[t] = a.sum(); alpha[t] = a / c[t]
    return alpha, c                                     # log p(x_1..T) = sum(log c)

def backward(x, A, B, c):                               # scaled with the same c_t, so alpha * beta = p(z_t | x)
    beta = np.ones((len(x), 2))
    for t in range(len(x) - 2, -1, -1):
        beta[t] = A @ (B[:, x[t + 1]] * beta[t + 1]) / c[t + 1]
    return beta

def viterbi(x, pi, A, B):                               # max-product in log space, with back-pointers
    with np.errstate(divide="ignore"):
        lp, lA, lB = np.log(pi), np.log(A), np.log(B)
    d, back = lp + lB[:, x[0]], np.zeros((len(x), 2), int)
    for t in range(1, len(x)):
        s = d[:, None] + lA
        back[t] = s.argmax(0); d = s.max(0) + lB[:, x[t]]
    path = [int(d.argmax())]
    for t in range(len(x) - 1, 0, -1):
        path.append(int(back[t][path[-1]]))
    return np.array(path[::-1])

print("== A. HMM: the dishonest casino (fair die F, loaded die L) ==")
z, x = sample(2000)
x10, post_bf, best, p_best, p_bf = x[:10], np.zeros((10, 2)), None, -1.0, 0.0
for path in itertools.product([0, 1], repeat=10):       # brute force: all 2^10 hidden paths, 19 products each
    p = PI[path[0]] * B[path[0], x10[0]]
    for t in range(1, 10):
        p *= A[path[t - 1], path[t]] * B[path[t], x10[t]]
    p_bf += p; post_bf[np.arange(10), path] += p
    if p > p_best:
        best, p_best = path, p
a10, c10 = forward(x10, PI, A, B)
print("first 10 rolls:", " ".join(str(v + 1) for v in x10), "| hidden:", "".join("FL"[s] for s in z[:10]))
print(f"brute force over 1024 paths: p(rolls) = {p_bf:.6e}  ({1024 * 19} multiplications, 1023 additions)")
# forward cost, counted from its loop: alpha_1 takes 2 products; each later step takes, per state,
# 2 products and 1 sum for (alpha @ A) plus 1 product by the emission; one final sum gives p(rolls)
print(f"forward algorithm          : p(rolls) = {np.prod(c10):.6e}  ({2 + 9 * 2 * 3} multiplications, {9 * 2 + 1} additions)")
print(f"max |forward-backward - enumeration| over p(z_t | 10 rolls): "
      f"{np.abs(a10 * backward(x10, A, B, c10) - post_bf / p_bf).max():.1e}; "
      f"Viterbi path = most probable of the 1024: {list(viterbi(x10, PI, A, B)) == list(best)}")
a = PI * B[:, x[0]]
for t in range(1, len(x)):
    a = (a @ A) * B[:, x[t]]                            # unscaled forward
alpha, c = forward(x, PI, A, B)
print(f"2000 rolls: unscaled forward p = {a.sum()}; scaled forward log p = {np.log(c).sum():.2f}")
post = alpha * backward(x, A, B, c)                     # p(z_t | all rolls)
vit = viterbi(x, PI, A, B)
acc = lambda guess: np.mean(guess == z)
print(f"share of the 2000 steps labelled correctly: always fair {acc(np.zeros(2000, int)):.3f} | "
      f"filtering {acc(alpha.argmax(1)):.3f} | forward-backward {acc(post.argmax(1)):.3f} | Viterbi {acc(vit):.3f}")
for name, row in (("rolls  ", "".join(str(v + 1) for v in x)), ("truth  ", "".join("FL"[s] for s in z)),
                  ("Viterbi", "".join("FL"[s] for s in vit)), ("P(L)>.5", "".join("FL"[s] for s in post.argmax(1)))):
    print(name, row[100:170])

def baum_welch(x, A0, B0, iters, tol=1e-6, report=()):
    pi, A_, B_, prev = np.array([0.5, 0.5]), A0.copy(), B0.copy(), -np.inf
    for it in range(1, iters + 1):
        alpha, c = forward(x, pi, A_, B_)
        beta = backward(x, A_, B_, c)
        ll = np.log(c).sum()
        if it in report:
            print(f"  iteration {it:3d}: log-likelihood {ll:.2f}")
        if ll - prev < tol:
            break
        prev = ll
        gamma = alpha * beta                                       # E-step: p(z_t = i | x)
        xi = (alpha[:-1, :, None] * A_[None] * (B_[:, x[1:]].T * beta[1:])[:, None, :]) / c[1:, None, None]
        pi = gamma[0]                                              # M-step: normalized expected counts
        A_ = xi.sum(0) / xi.sum((0, 2))[:, None]
        B_ = np.stack([gamma[x == v].sum(0) for v in range(6)], 1) / gamma.sum(0)[:, None]
    return A_, B_, ll, it

print("Baum-Welch (EM) on 10,000 rolls from a random start:")
zt, xt = sample(10000)
A0 = rng.dirichlet([5, 5], 2); B0 = rng.dirichlet(np.ones(6), 2)
Ah, Bh, ll, it = baum_welch(xt, A0, B0, 1000, report=(1, 2, 5, 10, 50, 100, 200, 300))
o = np.argsort(Bh[:, 5])                                           # name the state with more sixes "L"
Ah, Bh = Ah[o][:, o], Bh[o]
print(f"  stopped at iteration {it}: log-likelihood {ll:.2f}; the true parameters give {np.log(forward(xt, PI, A, B)[1]).sum():.2f}")
print(f"  learned stay probabilities: F {Ah[0, 0]:.3f} (true 0.95), L {Ah[1, 1]:.3f} (true 0.90)")
print(f"  learned p(six): F {Bh[0, 5]:.3f} (true 0.167), L {Bh[1, 5]:.3f} (true 0.500)")
_, Bs, lls, _ = baum_welch(xt, np.full((2, 2), 0.5), np.tile(B0[0], (2, 1)), 50)
print(f"  start with identical dice and uniform transitions: after 50 iterations p(six) = {Bs[0, 5]:.3f} and {Bs[1, 5]:.3f}, log-likelihood {lls:.2f}")

# ---------- B. Kalman filter: constant velocity, only the position is measured ----------
print("== B. Kalman filter: state (position, velocity), measured position with sd 2.0 ==")
F = np.array([[1.0, 1.0], [0.0, 1.0]]); H = np.array([[1.0, 0.0]])
Q = 0.02 * np.array([[0.25, 0.5], [0.5, 1.0]]); R = np.array([[4.0]])
s, truth, zs = np.array([0.0, 1.0]), [], []
for t in range(100):
    s = F @ s + rng.multivariate_normal([0, 0], Q); truth.append(s)
    zs.append(H @ s + rng.normal(0, 2.0, 1))
truth, zs = np.array(truth), np.array(zs)
m, P, est = np.array([0.0, 0.0]), 100.0 * np.eye(2), []
print("    t  K_position  K_velocity  sd(position)")
for t in range(100):
    m, P = F @ m, F @ P @ F.T + Q                                  # predict
    S = H @ P @ H.T + R; K = P @ H.T @ np.linalg.inv(S)            # gain
    m = m + K @ (zs[t] - H @ m); P = (np.eye(2) - K @ H) @ P       # update
    est.append(m)
    if t + 1 in (1, 2, 3, 5, 10, 20, 50, 100):
        print(f"  {t + 1:3d}  {K[0, 0]:10.3f}  {K[1, 0]:10.3f}  {np.sqrt(P[0, 0]):12.3f}")
est = np.array(est)
rmse = lambda e, tr: np.sqrt(np.mean((e - tr) ** 2))
print(f"RMSE position: raw measurements {rmse(zs[:, 0], truth[:, 0]):.3f}, Kalman {rmse(est[:, 0], truth[:, 0]):.3f}; "
      f"RMSE velocity (never measured): {rmse(est[:, 1], truth[:, 1]):.3f}")
q, r = 1.0, 4.0                                                    # local level: random walk + noise
lv = np.cumsum(rng.normal(0, np.sqrt(q), 200)); y = lv + rng.normal(0, np.sqrt(r), 200)
m, Pv, kf, gains = 0.0, 100.0, [], []
for t in range(200):
    Pv += q; k = Pv / (Pv + r); m += k * (y[t] - m); Pv *= 1 - k; kf.append(m); gains.append(k)
ses, l = [], 0.0
for t in range(200):
    l = gains[-1] * y[t] + (1 - gains[-1]) * l; ses.append(l)            # simple exponential smoothing
print(f"local level (q=1, r=4): gain settles at {gains[-1]:.4f}; Kalman vs exponential smoothing with alpha = gain: "
      f"max gap after step 20 = {np.abs(np.array(kf) - np.array(ses))[20:].max():.1e}")
N = 1000
p = rng.normal(0, 10, N); pf = []
for t in range(200):                                               # bootstrap particle filter, same data
    p = p + rng.normal(0, np.sqrt(q), N)
    w = np.exp(-0.5 * (y[t] - p) ** 2 / r); w /= w.sum()
    pf.append(w @ p); p = p[rng.choice(N, N, p=w)]
print(f"bootstrap particle filter, {N} particles, same data: mean |PF mean - Kalman mean| = {np.mean(np.abs(np.array(pf) - kf)):.3f} "
      f"(Kalman posterior sd {np.sqrt(Pv):.3f})")

# ---------- C. nonlinear: x_t = x_t-1 + 0.1 + noise, y_t = sin(x_t) + noise ----------
print("== C. nonlinear model: x_t = x_t-1 + 0.1 + N(0, 0.05), y_t = sin(x_t) + N(0, 0.01) ==")
q, r, T = 0.05, 0.01, 100
def simulate():
    xs = np.cumsum(0.1 + rng.normal(0, np.sqrt(q), T))
    return xs, np.sin(xs) + rng.normal(0, np.sqrt(r), T)
def ekf(ys):
    m, P, out = 0.0, 1.0, []
    for yt in ys:
        m, P = m + 0.1, P + q                                      # predict (the dynamics are linear)
        Hj = np.cos(m); k = P * Hj / (Hj * P * Hj + r)             # linearize sin at the prediction
        m, P = m + k * (yt - np.sin(m)), (1 - k * Hj) * P; out.append(m)
    return np.array(out)
def particle_filter(ys, N=1000, resample=True):
    p, logw, out, ess, distinct = rng.normal(0, 1, N), np.zeros(N), [], [], []
    for yt in ys:
        p = p + 0.1 + rng.normal(0, np.sqrt(q), N)                 # propose from the dynamics (bootstrap)
        logw = logw - 0.5 * (yt - np.sin(p)) ** 2 / r              # weight by the observation likelihood
        w = np.exp(logw - logw.max()); w /= w.sum()
        out.append(w @ p); ess.append(1 / np.sum(w ** 2))
        if resample:
            idx = rng.choice(N, N, p=w); p, logw = p[idx], np.zeros(N); distinct.append(len(np.unique(idx)))
    return np.array(out), np.array(ess), np.array(distinct)
res = []
for run in range(20):
    xs, ys = simulate()
    res.append((rmse(ekf(ys), xs), rmse(particle_filter(ys)[0], xs)))
res = np.array(res)
print(f"20 runs of {T} steps: median RMSE EKF {np.median(res[:, 0]):.3f}, particle filter {np.median(res[:, 1]):.3f}; "
      f"runs with RMSE > 1: EKF {int((res[:, 0] > 1).sum())}, particle filter {int((res[:, 1] > 1).sum())}")
xs, ys = simulate()
_, ess_sis, _ = particle_filter(ys, resample=False)
_, ess_sir, distinct = particle_filter(ys)
print("ESS of 1000 particles without resampling: " + ", ".join(f"t={t} {ess_sis[t - 1]:.1f}" for t in (1, 2, 5, 10, 20, 50)))
print(f"with resampling every step: mean ESS before resampling {ess_sir.mean():.1f}; after resampling all weights are 1/N "
      f"(ESS {N}), but only {distinct.mean():.0f} distinct particles on average")
```

</details>

Reading it, part by part:
- **A, inference.** Forward and enumeration agree on `1.398155e-08` at 56 against 19,456 multiplications, and forward–backward and Viterbi agree with enumeration on the 10-roll prefix. In the window of rolls 101–170, both decoders mark rolls 120–151 as loaded (the truth is 127–151) and miss the loaded stretches 101–106 (2 sixes in 6 rolls) and 155–170 (5 sixes in 16). The per-step posterior also flips to fair for rolls 131–134, inside a loaded stretch, where Viterbi stays loaded, and catches rolls 168–170, three sixes in a row.
- **A, learning.** Baum–Welch jumped from −22,586.66 to −17,567.40 in one iteration, crawled (+4.9 between iterations 2 and 10), then climbed to −17,459.27 by iteration 50 and −17,425.10 at iteration 225, above the true parameters' −17,435.33: a fit to these 10,000 rolls that scores higher than the truth, as a maximum-likelihood fit to a finite sample can. Started with two identical dice and uniform transitions, it never separated them: both states kept `p(six) = 0.271`, the overall share of sixes.
- **B, Kalman.** The position gain starts near 1 (trust the first measurement, the prior is vague) and settles at 0.313 by step 20; the velocity, never measured, is inferred from successive positions. On a random walk, the particle filter's mean is on average 0.061 from the exact Kalman mean, against a posterior sd of 1.25.
- **C, nonlinear.** The EKF's median RMSE was 0.427 against the particle filter's 0.231, and it lost track (RMSE > 1) in 9 of 20 runs, the particle filter in none. The model's form suggests why: near the peaks of `sin` the slope `cos(x)` is close to 0, so the linearized measurement says almost nothing about which way `x` moved, and `sin(x)` takes the same value on the wrong branch. A particle cloud can cover both branches until the drift of +0.1 per step makes the wrong one inconsistent with later measurements.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| A forward–backward cost quoted as `O(kT)` | Underestimates the work for many states | d2l's classic edition writes `O(kT)` ✅[^5]; each step sums over `k` previous states for each of `k` states, `O(T·k²)` as in CS228's chain count ✅[^6]; lab: 6 multiplications per step for `k = 2`, that is `k² + k` ✅[^13] |
| Long sequence, unscaled forward pass | Probability becomes exactly 0.0 (lab, 2000 rolls) | Products of many small numbers underflow ✅[^13]; use logs or scaling ✅[^3] |
| Baum–Welch from different starts | Different answers | EM finds a local optimum; run several starts and keep the best score ✅[^2] ✅[^8] |
| States that start identical | They stay identical (lab `p(six)` 0.271 and 0.271) | Equal states get equal posteriors, hence equal updates ✅[^13] |
| Learned state 0 is the "loaded" die | Labels permuted | State order is arbitrary ✅[^2] |
| EM slows on a plateau | Little gain for several iterations, then a climb (lab: +4.9 from iteration 2 to 10, then +103 by iteration 50) ✅[^13] | Training stops at `n_iter` or when the gain falls below `tol`, and may stop before converging ✅[^2] |
| Viterbi path vs per-step posterior | Different labels at some steps | Most probable path vs most probable state per step ✅[^2]; lab 79.2 % vs 81.7 % ✅[^13] |
| Non-Gaussian noise in a Kalman filter | Still the best linear unbiased estimate, not the best overall | A nonlinear estimator can have lower error ✅[^10] |
| Steady-state gain on a time-varying system | Wrong uncertainty | The shortcut assumes a time-invariant system; FilterPy warns `P` grows without bound if the steady-state calls are mixed with the normal predict ✅[^12] |
| Strong nonlinearity, EKF | Can lose track (lab: RMSE > 1) | The linearization is a heuristic ✅[^10]; lab 9 of 20 runs ✅[^13] |
| Particle filter without resampling | One particle holds all the weight (lab ESS 1.0) | Weight degeneracy ✅[^1] ✅[^13] |
| Resampling every step | Many duplicates (lab 454 distinct of 1000) | Resampling adds variance; resample when ESS < `N/2` ✅[^1] ✅[^13] |
| High-dimensional state, particle filter | Weights collapse even with resampling | Particles needed grow exponentially with dimension in simple examples ✅[^1] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Forward–backward (posterior decoding) | Per-step probabilities; highest per-step accuracy in the lab (81.7 %) ✅[^13] | Needs the later data too ✅[^11]; per-step labels can flicker (lab window: `…LLLFFFFLLL…` where Viterbi stays `L`) ✅[^13] |
| Viterbi | One consistent most-probable path ✅[^7] | Lower per-step accuracy than forward–backward in the lab (79.2 % vs 81.7 %) ✅[^13] |
| Kalman filter | Exact, closed form for linear-Gaussian models ✅[^11]; constant gain once settled ✅[^12] | Linear dynamics and measurements only ✅[^10] |
| Extended Kalman filter | Nonlinear `f` and `h` with the Kalman equations, via Jacobians ✅[^10] | Jacobians; heuristic; lost track in the lab ✅[^10] ✅[^13] |
| Particle filter | Any transition and observation model ✅[^1]; held track in all 20 lab runs ✅[^13] | `N` simulations per step; degeneracy; poor in high dimension ✅[^1] |

## Takeaways
- Run HMM recursions in log space or with per-step scaling; an unscaled forward pass silently returns 0 on long sequences. [rule-candidate]
- Fit Baum–Welch from several random starts and keep the best likelihood; never start with identical states. [rule-candidate]
- Read the Kalman gain as prediction variance over total variance: a larger `Q` or a smaller `R` makes the filter follow the measurements more closely, the reverse smooths more.
- Use the EKF only where the model is close to linear over the filter's uncertainty; otherwise use a particle filter and monitor its ESS. [rule-candidate]
- A random-walk Kalman filter in steady state is simple exponential smoothing, so each can be used to check the other.

## Verification status
- Verified: 97 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [Elements of Sequential Monte Carlo](https://ar5iv.labs.arxiv.org/html/1903.04797) — Naesseth, Lindsten, Schön, 2019 (ar5iv HTML of arXiv:1903.04797). Backs: the state-space model and its joint, particle filters' origin, resample–propagate–weight, the bootstrap filter, weight degeneracy, ESS and the `N/2` rule, resampling variance, high-dimensional degeneracy. [^1]
- [Tutorial (hmmlearn docs)](https://hmmlearn.readthedocs.io/en/latest/tutorial.html) — hmmlearn developers, living (0.3.3 docs). Backs: HMM parameters, the three problems, Viterbi, forward–backward, Baum–Welch as EM, local optima and restarts, state order, `viterbi` and `map` decoders, `n_iter` and `tol`. [^2]
- [API reference (hmmlearn docs)](https://hmmlearn.readthedocs.io/en/latest/api.html) — hmmlearn developers, living. Backs: forward–backward with logarithms or scaling. [^3]
- [Dishonest Casino Example (hmmlearn docs)](https://hmmlearn.readthedocs.io/en/latest/auto_examples/plot_casino.html) — hmmlearn developers, living. Backs: the casino model's transition and emission probabilities. [^4]
- [Dive into Deep Learning, 9.4.1 Dynamic Programming in Hidden Markov Models](https://classic.d2l.ai/chapter_recurrent-modern/bi-rnn.html) — Zhang, Lipton, Li, Smola, classic edition. Backs: the HMM joint, `k^T` terms, forward and backward recursions, message passing, resemblance to an RNN update. [^5]
- [Variable elimination (CS228 notes)](https://ermongroup.github.io/cs228-notes/inference/ve/) — Kuleshov, Ermon, Stanford CS228, living. Backs: chain marginal in `O(n·k²)` vs `O(k^n)`. [^6]
- [Junction tree algorithm (CS228 notes)](https://ermongroup.github.io/cs228-notes/inference/jt/) — Kuleshov, Ermon, Stanford CS228, living. Backs: max-product with back-pointers on a chain. [^7]
- [Learning in latent variable models (CS228 notes)](https://ermongroup.github.io/cs228-notes/learning/latent/) — Kuleshov, Ermon, Stanford CS228, living. Backs: E-step and M-step, expected log-likelihood splitting into CPD terms, monotone likelihood, local optima, restarts. [^8]
- [Learning in directed models (CS228 notes)](https://ermongroup.github.io/cs228-notes/learning/directed/) — Kuleshov, Ermon, Stanford CS228, living. Backs: maximum-likelihood CPDs as normalized counts. [^9]
- [An Elementary Introduction to Kalman Filtering](https://ar5iv.labs.arxiv.org/html/1710.04055) — Pei, Biswas, Fussell, Pingali, 2017 (ar5iv HTML of arXiv:1710.04055). Backs: the linear model and its noise assumptions, a priori and a posteriori estimates, mean prediction, innovation, gain and update, scalar fusion, best linear unbiased without Gaussians, EKF Jacobians, EKF and UKF as heuristics. [^10]
- [A Step by Step Mathematical Derivation and Tutorial on Kalman Filters](https://ar5iv.labs.arxiv.org/html/1910.03558) — Masnadi-Shirazi, Masnadi-Shirazi, Dastgheib, 2019 (ar5iv HTML of arXiv:1910.03558). Backs: filtering and smoothing, the Bayesian prediction–update recursion, closed form for linear-Gaussian models, covariance prediction, update equations. [^11]
- [KalmanFilter (FilterPy docs)](https://filterpy.readthedocs.io/en/latest/kalman/KalmanFilter.html) — Labbe, FilterPy 2.0.0 docs, living. Backs: `S = HPHᵀ + R`, converged gain for time-invariant systems and the steady-state warning, the Rauch–Tung–Striebel smoother. [^12]
- `machine-learning/lab-setup.md` — the lab where the casino HMM, Baum–Welch, Kalman, exponential-smoothing, EKF and particle-filter runs took place on 2026-11-25. [^13]

## Related
- `machine-learning/probabilistic-ml/probabilistic-graphical-models.md` — variable elimination and belief propagation, of which forward–backward and Viterbi are the chain case.
- `machine-learning/unsupervised-learning/gaussian-mixtures-and-em.md` — EM on a model without time structure.
- `machine-learning/time-series/classical-forecasting-models.md` — exponential smoothing and ETS (error, trend, seasonal) state-space models for forecasting.
- `machine-learning/probabilistic-ml/markov-chain-monte-carlo.md` — the other family of Monte Carlo inference methods.
- `machine-learning/deep-learning/recurrent-networks.md` — learned sequence models whose state update resembles the forward recursion.
- `machine-learning/transformers/efficient-attention-and-state-space-models.md` — S4 and Mamba, which share the name but not the probabilistic model.
