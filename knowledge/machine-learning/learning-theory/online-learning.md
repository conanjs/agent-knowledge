---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/learning-theory
status: verified
applies-to: ["any"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, learning-theory, online-learning, online-convex-optimization, regret, online-gradient-descent, follow-the-leader, ftrl, experts, hedge, multiplicative-weights, exponentiated-gradient, dynamic-regret]
---

# Online learning: regret, online gradient descent, FTRL and Hedge

## Summary
**TL;DR:** In online learning the data arrive one example at a time and the learner must commit to a prediction before it sees each loss. It is scored by regret: its total loss minus the total loss of the best single fixed decision chosen in hindsight. Regret that grows slower than the number of rounds `T` means the average loss catches up with that best decision, with no assumption about how the data are generated. Online gradient descent (OGD) steps against the latest loss's gradient and projects back into the allowed set; with step `D/(G·√t)` its regret is at most `1.5·G·D·√T`, and no algorithm can do better than order `√T` in the worst case. Follow-the-leader (FTL), "play what would have been best so far", can be wrong every round; adding a regularizer (follow-the-regularized-leader, FTRL) makes it stable, and OGD and Hedge are both FTRL with a particular regularizer. Hedge (multiplicative weights) spreads its bets over `N` experts with weights `exp(−η · cumulative loss)` and, with losses in `[0, 1]` and a tuned `η`, has regret at most `2·√(2T·ln N)`. Bandits are the experts problem where only the chosen arm's loss is seen.
**Use this when:** you train on a stream you cannot store or revisit, combine several models' predictions as data arrive, pick a step-size schedule for a model that must keep learning, read a regret bound, or need a learner that keeps up when the data change.
**Not this doc:** exploration when only the chosen action's reward is seen (ε-greedy, UCB (upper confidence bound), Thompson sampling) → `machine-learning/reinforcement-learning/multi-armed-bandits.md`; gradient descent on a fixed dataset → `machine-learning/foundations/gradient-descent.md`; sample-size guarantees for i.i.d. (independent and identically distributed) data → `machine-learning/learning-theory/pac-learning-and-vc-dimension.md`; detecting that serving data have shifted → `machine-learning/ml-systems/data-drift-and-monitoring.md`; neural networks forgetting old tasks → `machine-learning/deep-learning/continual-learning.md`.

## Problem
Batch learning assumes a dataset you can revisit, drawn from one fixed distribution. Many systems instead see examples one by one (a click, a sensor reading, a price), must act before the outcome is known, and face data that change or even react to their decisions. Without a distribution there is no error rate to promise: with two experts, one always saying A and one always B, an adversary who answers the opposite of a deterministic learner's guess makes it wrong every round, while the better expert is wrong at most half the time ✅[^1]. The obvious strategy, follow the leader, fails the same way: in the lab it lost on all but one of 100,000 rounds of alternating losses, a regret of 99,999.5 ✅[^6]. And every step-size choice is a bet on stationarity: after an abrupt change, OGD with a decaying step still had 14 times the noise-level loss in the next 200 rounds, against 3.4 times for a constant step ✅[^6].

## Mental model
**Analogy:** a commuter who must pick one of `N` routes each morning before seeing the traffic. At the end of the year she compares her total time with the single route that would have been fastest in hindsight; the extra minutes are her regret. Following the leader means taking whichever route has the best total so far, and a nasty traffic pattern can make that the wrong route every day. Hedge keeps a weight per route, multiplies each route's weight by `exp(−η · today's delay)` each evening and picks routes in proportion to their weights: no route is dropped for one bad day, and routes that keep being slow fade out geometrically. The regularizer is inertia: do not jump all the way to the current leader.

**Artifact:** FTL against FTRL on Orabona's counterexample, linear losses `z_t · x` on `[−1, 1]` with `z = −0.5, +1, −1, +1, …`, printed by the full script in the Worked example. Lab run (`machine-learning/lab-setup.md`), 2026-11-25, numpy 2.5.5 ✅[^6]:

```text
== 2. linear losses z_t * x on [-1, 1], z = -0.5, +1, -1, +1, ... ==
T=  1000: FTL regret    999.5 | FTRL (eta=1/sqrt T) regret   16.3 | sqrt(T)   31.6
T= 10000: FTL regret   9999.5 | FTRL (eta=1/sqrt T) regret   50.5 | sqrt(T)  100.0
T=100000: FTL regret  99999.5 | FTRL (eta=1/sqrt T) regret  158.6 | sqrt(T)  316.2
FTL on squared losses (x - y_t)^2 with y = 1, 0, 1, 0, ...:
  T=  1000: regret 3.10, bound 4 + 4 ln T = 31.63
  T=100000: regret 4.25, bound 4 + 4 ln T = 50.05
```

The running sum of past `z` flips between `−0.5` and `+0.5`, so FTL jumps between `x = 1` and `x = −1` and is always on the wrong side: regret `T − 0.5`. FTRL minimizes `S·x + x²/(2η)`, the running sum `S` of past `z` times `x` plus a quadratic regularizer, which keeps its decision at `±0.5·η` near 0, paying about `0.5·η` per round: about `0.5·√T` in total. On squared losses, by contrast, FTL is fine: regret 4.25 after 100,000 rounds.

## How it works
### The protocol and regret
**2 actors:**
- **Learner** — its job: choose a decision `x_t` from the set `K` each round, via its update rule applied to the losses seen so far.
- **Adversary** (the environment) — its job: reveal the round's loss function `f_t` once the choice is made, via any rule at all.

Diagram of one round (drawn by hand, not program output):

```text
round t:  [Learner] x_t = A(f_1, …, f_{t−1}) ──► [Adversary] reveals f_t ──► learner pays f_t(x_t)
              ▲                                                                    │
              └────────────────────── f_t joins the history ◄─────────────────────┘
```

1. **Each round** `t = 1, …, T`: the learner chooses `x_t` from a convex decision set `K`; then a convex loss `f_t` is revealed and the learner pays `f_t(x_t)` ✅[^1]; an algorithm is a map from the history `f_1, …, f_{t−1}` to the next decision ✅[^1]. Zinkevich's 2003 paper motivates it with production decisions whose value is known only after the goods are made ✅[^5]; Hazan credits that paper with first defining the model ✅[^1], McMahan with the name, the setting itself going back to Gordon (1999) ✅[^2]. The losses may be chosen by an adversary and even depend on the learner's action ✅[^1], but the adversary need not be malicious: the losses may also be drawn from a distribution ✅[^2].
2. **Regret:** `Regret_T = Σ_{t=1..T} f_t(x_t) − min_{x∈K} Σ_{t=1..T} f_t(x)`, usually bounded in the worst case over loss sequences; sublinear regret (`o(T)`) means the average loss approaches that of the best fixed decision in hindsight ✅[^1]. Example, Orabona's number-guessing game with loss `(x_t − y_t)²` ✅[^3]: targets `0.2, 0.9, 0.4`, guesses `0.5, 0.2, 0.55` (each guess after the first is the mean of the past targets, which is FTL) cost `0.09 + 0.49 + 0.0225 = 0.6025`; the best fixed guess is the mean 0.5, costing `0.09 + 0.16 + 0.01 = 0.26`; regret `0.3425`.
3. **What must be bounded:** losses must be bounded and the decision set bounded or structured, otherwise no performance measure makes sense ✅[^1]. The bounds use `D`, an upper bound on the diameter of `K` (largest distance between two points), and `G`, an upper bound on the norm of the gradients ✅[^1]. Example: for a ball of radius 2, `D = 4`.
4. **Full information vs bandits:** here the whole loss function is revealed after each round. In the multi-armed bandit (MAB) problem only the loss of the chosen action is seen, which forces an exploration–exploitation trade-off ✅[^1]; the stochastic version, its regret and the UCB rule are in `machine-learning/reinforcement-learning/multi-armed-bandits.md`.

### Online gradient descent (OGD)
1. **Update:** `y_{t+1} = x_t − η_t · ∇f_t(x_t)`, then `x_{t+1} = Π_K(y_{t+1})`, the closest point of `K` ✅[^1]. Example: `x_t = (1.7, 0.9)` (norm 1.92) in the ball of radius 2, gradient `(−1, 0)`, `η_t = 0.5` gives `y = (2.2, 0.9)`, norm 2.38, projected to `(2.2, 0.9) × 2/2.38 = (1.85, 0.76)`.
2. **Regret bound (Zinkevich's algorithm, Hazan's Theorem 3.1):** with `η_t = D/(G·√t)`, `Regret_T ≤ 1.5·G·D·√T` for every `T ≥ 1` ✅[^1]. Example: the lab's `G = 18.62`, `D = 4`, `T = 100,000` give 35,325 ✅[^6]. The proof needs only convexity, the projection and `Σ 1/√t ≤ 2√T`, so the cost functions may change completely from round to round ✅[^1].
3. **It cannot be beaten in general:** any algorithm suffers regret of at least a constant times `D·G·√T` (written `Ω(D·G·√T)`) in the worst case, even when the losses come from a fixed stationary distribution: on the hypercube `K = [−1, 1]^n`, random linear losses `v_t · x` with `v_t` uniform on its corners `{±1}^n` already force it ✅[^1]. Lab: on the same random losses over the ball of radius 2, OGD's regret grew with log-log slope 0.51, at about a third of the bound ✅[^6].
4. **Curvature helps:** for `α`-strongly convex losses (each lies above its tangent by at least `(α/2)·‖y − x‖²`) the attainable regret is `(1/α)·log T`, and for `δ`-exp-concave ones (`exp(−δ·f)` is concave) in `n` dimensions it is `(n/δ)·log T` ✅[^1]. In Orabona's number-guessing game FTL's regret is at most `4 + 4·ln T` ✅[^3]; the lab's 4.25 at `T = 100,000` is below that bound's 50.05 ✅[^6].
5. **OGD vs SGD (stochastic gradient descent):** OGD's losses differ every step and need not come from a fixed distribution ✅[^3]; running OGD on noisy gradients of one fixed function and averaging the iterates gives SGD, so regret bounds turn into convergence rates ✅[^1]. Step-size behaviour on a fixed dataset: `machine-learning/foundations/gradient-descent.md`.
6. **Online-to-batch:** on i.i.d. examples, run an online convex optimization algorithm over a convex set of hypotheses and average its iterates; with probability at least `1 − δ` the average's error is at most the best hypothesis's error `+ Regret_T/T + √(8·log(2/δ)/T)` ✅[^1]. Example: `Regret_T/T = 0.01`, `δ = 0.05`, `T = 10,000` give an excess of at most `0.01 + √(8 × 3.689/10,000) = 0.01 + 0.054 = 0.064`. This is a PAC (probably approximately correct) guarantee: `machine-learning/learning-theory/pac-learning-and-vc-dimension.md`.

### Follow-the-leader and follow-the-regularized-leader
1. **FTL:** `x_{t+1} = argmin_{x∈K} Σ_{τ≤t} f_τ(x)`, the best decision for the past ✅[^1]. On `K = [−1, 1]` with `f_1 = x/2` and then `−x`, `+x`, `−x`, … it alternates between `−1` and `+1`, always wrong, so its regret is linear in `T`; it fails because it is unstable ✅[^1]. Orabona's version (`z_1 = −0.5`, then `+1`, `−1`, …) gives regret at least `T − 3/2` against the fixed `u = 0` ✅[^3].
2. **When FTL works:** it can have sublinear regret for strongly convex losses; general convex losses need extra regularization ✅[^2].
3. **FTRL (Hazan's RFTL, regularized FTL):** `x_{t+1} = argmin_{x∈K} η·Σ_{s≤t} ∇_s·x + R(x)`, with `R` a strongly convex regularizer ✅[^1]. For every `u ∈ K` its regret is at most `2η·Σ_t ‖∇_t‖*² + (R(u) − R(x_1))/η` (the star marks the dual of a local norm set by `R`), and with a known gradient bound the best `η` gives `2·D_R·G_R·√(2T)`, where `D_R = √(max_{x,y∈K} R(x) − R(y))` is the diameter of `K` measured by `R` and `G_R` bounds the gradients' local norms ✅[^1]. McMahan's general template keeps the losses themselves, `x_{t+1} = argmin_x f_{1:t}(x) + r_{0:t}(x)`, where `f_{1:t}` is the sum of the first `t` losses and `r_{0:t}` the sum of incremental regularizers that may be chosen adaptively from the data seen so far ✅[^2].
4. **OGD and Hedge are FTRL:** `R(x) = ½‖x − x_0‖²` gives online gradient descent with Euclidean projection, in the usual "agile" form that steps from the last point and a "lazy" form that projects the running gradient sum, two variants that behave very differently; the regret is at most `2·G·D·√T` ✅[^1]. The negative entropy `R(x) = Σ x_i log x_i` on the probability simplex gives exactly Hedge ✅[^1]. The lab's FTRL row is the first case in one dimension: `x = clip(−η·S, −1, 1)` for the running gradient sum `S`, e.g. `S = 0.5`, `η = 0.01` gives `x = −0.005`.
5. **Why keep the history:** FTRL's next point depends on the whole history of losses, while online mirror descent (OMD) remembers only the current point ✅[^3]. That lets FTRL keep an L1 penalty (sum of absolute weights) in closed form instead of linearizing it, which gives sparser models, and adaptive regularizers give AdaGrad-style (adaptive gradient) bounds in terms of the observed gradients, `√(Σ g_t²)` instead of `G·√T` ✅[^2]. Per-coordinate adaptive step sizes in practice: `machine-learning/deep-learning/optimizers-and-learning-rate-schedules.md`.

### Prediction with expert advice: weighted majority and Hedge
1. **Setting:** `N` experts give advice each round; after the decision, every expert's loss is revealed ✅[^1].
2. **Deterministic is not enough:** no deterministic algorithm can guarantee fewer than `2L` mistakes, `L` being the best expert's (the two-expert adversary in Problem) ✅[^1].
3. **Weighted majority:** all weights start at 1, the prediction follows the heavier side, and each wrong expert's weight is multiplied by `1 − ε`; then mistakes `≤ 2(1 + ε)·M(i) + 2·log N/ε` for every expert `i` with `M(i)` mistakes ✅[^1]. Example: `N = 10`, `ε = 0.1`, best expert 20 mistakes: at most `44 + 46.05 = 90.05`. It is due to Littlestone and Warmuth, one of the first uses of multiplicative updates ✅[^1].
4. **Hedge (Freund and Schapire, 1997 ✅[^1]):** pick expert `i` with probability `x_t(i) = W_t(i)/Σ_j W_t(j)`, then update `W_{t+1}(i) = W_t(i)·exp(−ε·ℓ_t(i))` for non-negative losses `ℓ_t(i)` ✅[^1]. Example: weights `(1, 1)`, losses `(1, 0)`, `ε = 0.5` give weights `(0.607, 1)` and probabilities `(0.378, 0.622)`. Its expected loss satisfies `Σ x_t·ℓ_t ≤ Σ ℓ_t(i*) + ε·Σ x_t·ℓ_t² + log N/ε` for every expert `i*`, with `ℓ_t²` the vector of squared losses ✅[^1].
5. **The tuned bound:** as FTRL with entropy and losses in `[0, 1]`, Hedge's regret is at most `2·√(2T·log N)`; the exponentiated-gradient form takes `η = √(log N / (2T·G_∞²))`, with `G_∞` the largest absolute loss gradient, and has regret at most `2·G_∞·√(2T·log N)` ✅[^1]. Example: `N = 100`, `T = 10,000` give `η = 0.0152` and a bound of 607.0; the dependence on `N` is only logarithmic.
6. **One meta-algorithm:** Arora, Hazan and Kale's survey shows that many algorithms maintain a distribution over a set, update it multiplicatively and are analysed with an exponential potential function ✅[^4].
7. **From experts to bandits:** EXP3 (exponential-weight algorithm for exploration and exploitation) feeds Hedge an unbiased estimate of the whole loss vector built from the one observed loss, and reaches regret `O(√(T·n·log n))` for `n` arms (at most a constant times that), nearly optimal ✅[^1].

### Changing environments
1. **Fixed comparators can be the wrong yardstick:** when the environment changes a lot, regret against one fixed decision may not be the best measure, and the strongly convex and exp-concave algorithms above settle on a fixed solution ✅[^1].
2. **Dynamic regret** compares with a moving sequence `u_1, …, u_T` of path length `P = Σ‖u_t − u_{t+1}‖ + 1`; OGD with a constant step `η ≈ √(P/T)` has dynamic regret `O(√(T·P))` ✅[^1]. Example: one jump of length 2 gives `P = 3`. **Adaptive regret** is the largest regret over any contiguous interval of rounds ✅[^1].

## Worked example
One script (numpy only) runs four experiments on decisions in the ball of radius 2 in 5 dimensions (`D = 4`): (1a) OGD on 100,000 squared losses `½(w·x_t − y_t)²` of an i.i.d. linear-regression stream with bounded features and noise, where `G` is the worst-case gradient norm; (1b) OGD on random linear losses, the lower-bound construction; (2) the Mental model artifact; (3) Hedge with `N` experts whose losses are Bernoulli with means in `[0.3, 0.7]`, at the theoretical `η* = √(ln N / (2T))` (the tuned `η` of the exponentiated-gradient bound with `G_∞ = 1`) and at a tenth and ten times it, plus an adversarial two-expert sequence; (4) a drifting stream whose true weight vector jumps at round 5,000. The OGD step:

```python
r = X[t] @ w - y[t]                                    # residual of the prediction made before seeing y_t
losses[t] = 0.5 * r * r                                # pay the loss
w = project(w - step(t + 1) * r * X[t])                # gradient of 0.5 r^2 is r * x; project into the ball
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-25, numpy 2.5.5, two runs identical ✅[^6]:

```text
== 1a. OGD on 100,000 i.i.d. squared losses, regret against the best fixed w in hindsight ==
G = 18.62, D = 4.0; columns: T = 100, 1,000, 10,000, 100,000, log-log slope 1e3-1e5
eta_t = D/(G sqrt t)           10.8     16.0     17.4     20.7   0.06
constant eta = 0.05            10.9     13.4     30.7    191.6   0.58
Theorem 3.1 bound              1117     3533    11171    35325

== 1b. OGD on random linear losses v_t . w, v_t in {-1, +1}^5, mean of 20 streams ==
OGD regret                     41.3    143.7    449.0   1478.0   0.51
Theorem 3.1 bound               134      424     1342     4243

== 2. linear losses z_t * x on [-1, 1], z = -0.5, +1, -1, +1, ... ==
…

== 3. Hedge, T = 10,000 rounds, losses in [0, 1] ==
N=   2: regret eta*/10  333.5 | eta*  117.4 | 10 eta*   13.4 | bound 2 sqrt(2T ln N)  235.5
N=  10: regret eta*/10  954.9 | eta*  217.2 | 10 eta*   24.9 | bound 2 sqrt(2T ln N)  429.2
N= 100: regret eta*/10 1121.6 | eta*  236.3 | 10 eta*   74.2 | bound 2 sqrt(2T ln N)  607.0
N=1000: regret eta*/10 1091.7 | eta*  269.6 | 10 eta*  124.5 | bound 2 sqrt(2T ln N)  743.4
alternating 2-expert losses, Hedge eta*                : regret     7.6
alternating 2-expert losses, Hedge eta=50 (almost FTL) : regret  4999.7

== 4. drift: the true w changes at round 5,000 of 10,000 ==
mean loss in rounds          4001-5000  5001-5200  5201-6000  9001-10000
batch model, never retrained     0.0448     0.7044     0.7129     0.6622
OGD eta_t = D/(G sqrt t)         0.0450     0.5848     0.2736     0.0427
OGD constant eta = 0.05          0.0468     0.1399     0.0463     0.0439
FTL (refit on all past rounds)   0.0448     0.6749     0.5769     0.2097
noise floor 0.5 * Var(noise) = 0.0417
```

<details><summary>Full script (prints the output above)</summary>

```python
# Online learning from scratch (numpy): regret of online gradient descent (OGD) on squared and on linear losses,
# follow-the-leader (FTL) vs follow-the-regularized-leader (FTRL), Hedge over N experts, and a drifting stream.
import numpy as np
rng = np.random.default_rng(0)
d, R = 5, 2.0                                          # dimension; decision set = ball of radius R
D = 2 * R                                              # its diameter

def project(w):                                        # Euclidean projection onto the ball
    nrm = np.linalg.norm(w)
    return w if nrm <= R else w * (R / nrm)

def stream(T, w_true):                                 # bounded features and noise, so gradients are bounded
    X = rng.uniform(-1, 1, (T, d))
    return X, X @ w_true + rng.uniform(-0.5, 0.5, T)

w_star = rng.normal(size=d)
w_star *= 1.5 / np.linalg.norm(w_star)
G = (R * np.sqrt(d) + 1.5 * np.sqrt(d) + 0.5) * np.sqrt(d)   # bound on |w.x - y| * |x|

def ogd(X, y, step):                                   # play w_t, pay 0.5 (w_t.x_t - y_t)^2, then step
    w, losses = np.zeros(d), np.empty(len(y))
    for t in range(len(y)):
        r = X[t] @ w - y[t]
        losses[t] = 0.5 * r * r
        w = project(w - step(t + 1) * r * X[t])
    return losses

print("== 1a. OGD on 100,000 i.i.d. squared losses, regret against the best fixed w in hindsight ==")
T = 100_000
X, y = stream(T, w_star)
cps = [100, 1_000, 10_000, 100_000]
print(f"G = {G:.2f}, D = {D:.1f}; columns: T = " + ", ".join(f"{n:,}" for n in cps) + ", log-log slope 1e3-1e5")
runs = {"eta_t = D/(G sqrt t)": lambda t: D / (G * np.sqrt(t)), "constant eta = 0.05": lambda t: 0.05}
for name, step in runs.items():
    cum = np.cumsum(ogd(X, y, step))
    reg = []
    for n in cps:
        w_hat = np.linalg.lstsq(X[:n], y[:n], rcond=None)[0]
        assert np.linalg.norm(w_hat) <= R                 # so least squares is also the best point in the ball
        reg.append(cum[n - 1] - 0.5 * np.sum((X[:n] @ w_hat - y[:n]) ** 2))
    slope = np.polyfit(np.log(cps[1:]), np.log(reg[1:]), 1)[0]
    print(f"{name:26s}" + "".join(f"{r:9.1f}" for r in reg) + f"   {slope:.2f}")
print(f"{'Theorem 3.1 bound':26s}" + "".join(f"{1.5 * G * D * np.sqrt(n):9.0f}" for n in cps))

print("\n== 1b. OGD on random linear losses v_t . w, v_t in {-1, +1}^5, mean of 20 streams ==")
V = rng.choice([-1.0, 1.0], size=(20, T, d))
Gl = np.sqrt(d)                                        # gradient norm of a linear loss
W, loss = np.zeros((20, d)), np.zeros((20, T))
for t in range(T):
    loss[:, t] = (V[:, t] * W).sum(1)
    W -= D / (Gl * np.sqrt(t + 1)) * V[:, t]
    W *= np.minimum(1, R / np.linalg.norm(W, axis=1))[:, None]
cum, Vs = loss.cumsum(1), V.cumsum(1)
reg = [np.mean(cum[:, n - 1] + R * np.linalg.norm(Vs[:, n - 1], axis=1)) for n in cps]  # best u = -R v/|v|
slope = np.polyfit(np.log(cps[1:]), np.log(reg[1:]), 1)[0]
print(f"{'OGD regret':26s}" + "".join(f"{r:9.1f}" for r in reg) + f"   {slope:.2f}")
print(f"{'Theorem 3.1 bound':26s}" + "".join(f"{1.5 * Gl * D * np.sqrt(n):9.0f}" for n in cps))

print("\n== 2. linear losses z_t * x on [-1, 1], z = -0.5, +1, -1, +1, ... ==")
for T in (1_000, 10_000, 100_000):
    z = np.where(np.arange(T) % 2 == 1, 1.0, -1.0)
    z[0] = -0.5
    S = np.concatenate([[0.0], np.cumsum(z)[:-1]])     # sum of past z before each round
    eta = 1 / np.sqrt(T)
    best = -abs(z.sum())                               # min over fixed u in [-1, 1] of u * sum(z)
    ftl = -np.sign(S)                                  # minimizer of S * x on [-1, 1] (x_1 = 0)
    ftrl = np.clip(-eta * S, -1, 1)                    # minimizer of S * x + x^2 / (2 eta)
    print(f"T={T:6d}: FTL regret {(z * ftl).sum() - best:8.1f} | FTRL (eta=1/sqrt T) regret "
          f"{(z * ftrl).sum() - best:6.1f} | sqrt(T) {np.sqrt(T):6.1f}")
print("FTL on squared losses (x - y_t)^2 with y = 1, 0, 1, 0, ...:")
for T in (1_000, 100_000):
    yy = (np.arange(T) % 2 == 0).astype(float)
    x = np.concatenate([[0.0], np.cumsum(yy)[:-1] / np.arange(1, T)])   # mean of past targets
    reg = ((x - yy) ** 2).sum() - ((yy.mean() - yy) ** 2).sum()
    print(f"  T={T:6d}: regret {reg:.2f}, bound 4 + 4 ln T = {4 + 4 * np.log(T):.2f}")

print("\n== 3. Hedge, T = 10,000 rounds, losses in [0, 1] ==")
def hedge(L, eta):                                     # L: T x N losses; returns the algorithm's expected loss
    logw, total = np.zeros(L.shape[1]), 0.0
    for l in L:
        p = np.exp(logw - logw.max()); p /= p.sum()
        total += p @ l
        logw -= eta * l
    return total
T = 10_000
for N in (2, 10, 100, 1000):
    mu = rng.uniform(0.3, 0.7, N)
    L = (rng.uniform(size=(T, N)) < mu).astype(float)  # Bernoulli losses with per-expert means
    eta = np.sqrt(np.log(N) / (2 * T))                 # Corollary 5.7 with G_inf = 1
    res = [hedge(L, c * eta) - L.sum(0).min() for c in (0.1, 1, 10)]
    print(f"N={N:4d}: regret eta*/10 {res[0]:6.1f} | eta* {res[1]:6.1f} | 10 eta* {res[2]:6.1f}"
          f" | bound 2 sqrt(2T ln N) {2 * np.sqrt(2 * T * np.log(N)):6.1f}")
L = np.zeros((T, 2)); L[0] = [0.5, 0]; L[1::2, 1] = 1; L[2::2, 0] = 1    # the leader loses every round
for name, eta in (("Hedge eta*", np.sqrt(np.log(2) / (2 * T))), ("Hedge eta=50 (almost FTL)", 50.0)):
    print(f"alternating 2-expert losses, {name:26s}: regret {hedge(L, eta) - L.sum(0).min():7.1f}")

print("\n== 4. drift: the true w changes at round 5,000 of 10,000 ==")
w_b = rng.normal(size=d)
w_b *= 1.5 / np.linalg.norm(w_b)
X1, y1 = stream(5_000, w_star)
X2, y2 = stream(5_000, w_b)
X, y = np.vstack([X1, X2]), np.concatenate([y1, y2])
batch = np.linalg.lstsq(X[:2000], y[:2000], rcond=None)[0]       # trained once on the first 2,000 rounds
learners = {"batch model, never retrained": 0.5 * (X @ batch - y) ** 2,
            "OGD eta_t = D/(G sqrt t)": ogd(X, y, lambda t: D / (G * np.sqrt(t))),
            "OGD constant eta = 0.05": ogd(X, y, lambda t: 0.05)}
w_ftl, A, b = np.zeros(d), 1e-6 * np.eye(d), np.zeros(d)        # FTL = least squares on all past rounds
ftl = np.empty(len(y))
for t in range(len(y)):
    ftl[t] = 0.5 * (X[t] @ w_ftl - y[t]) ** 2
    A += np.outer(X[t], X[t]); b += y[t] * X[t]
    w_ftl = np.linalg.solve(A, b)
learners["FTL (refit on all past rounds)"] = ftl
print("mean loss in rounds          4001-5000  5001-5200  5201-6000  9001-10000")
for name, l in learners.items():
    print(f"{name:30s} {l[4000:5000].mean():8.4f}  {l[5000:5200].mean():9.4f}  {l[5200:6000].mean():9.4f}"
          f"  {l[9000:].mean():9.4f}")
print(f"noise floor 0.5 * Var(noise) = {0.5 / 12:.4f}")
```

</details>

Reading it:
- **1a, the bound is a worst case.** On this i.i.d. stream the theorem's step kept regret at 20.7 after 100,000 rounds, 0.06 % of the bound of 35,325, and it barely grows (slope 0.06). The constant step pays a steady price instead: regret rose from 30.7 to 191.6 over the last 90,000 rounds, about 0.0018 per round, the price of a step that never shrinks and so keeps the weights jittering around the best ones.
- **1b, √T is real.** On random linear losses the best fixed decision in hindsight profits from the random walk of the loss vectors, and no learner can anticipate it: regret 1,478 at `T = 100,000`, slope 0.51, about a third of the bound, as Theorem 3.2 predicts.
- **3, Hedge at `η*`** stays under `2·√(2T·ln N)` for every `N` (236.3 against 607.0 for 100 experts), and multiplying `N` by 500 raised its regret only from 117.4 to 269.6. On these easy stochastic losses a larger step does better (74.2 at `10·η*`) and a smaller one much worse (1,121.6 at `η*/10`): the theoretical `η*` protects against the worst case. On the adversarial two-expert sequence the roles flip: Hedge at `η*` has regret 7.6, while `η = 50`, which puts nearly all weight on the current leader, loses every round, a regret of 4,999.7 (the best expert itself loses half the rounds).
- **4, tracking a change.** Before the jump every learner is near the noise floor (0.045–0.047 against 0.042). In the 200 rounds after it, the batch model trained once has loss 0.704 and never recovers; FTL, which refits least squares on all past rounds, averages the two regimes and still has 0.210 at the end; OGD with the decaying step recovers slowly (0.585, then 0.274) because its steps have shrunk to about `0.003`; the constant step is back near the floor in the next 800 rounds (0.140, then 0.046). This is the dynamic-regret trade-off: the constant step that costs a little on a stationary stream (1a) is what lets the learner follow a moving target.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Unbounded losses or decision set | No meaningful guarantee | An adversary can shrink the loss scale or hide the good decisions ✅[^1] |
| FTL on linear losses | Linear regret | Leader flips every round ✅[^1] ✅[^3]; lab 99,999.5 in 100,000 rounds ✅[^6] |
| FTL on strongly convex losses | Logarithmic regret | ✅[^2] ✅[^3]; lab 4.25 ✅[^6] |
| Hedge with a very large `η` | Behaves like FTL | Lab: regret 4,999.7 vs 7.6 at `η*` ✅[^6] |
| Easy (stochastic) data | Worst-case `η` and `η_t` are cautious | Lab: Hedge regret 74.2 at `10·η*` vs 236.3; OGD regret 0.06 % of its bound ✅[^6] |
| `T` unknown in advance | Hedge's `η*` cannot be set | Adaptive regularizers give bounds that hold on every round ✅[^2]; OGD's `η_t = D/(G·√t)` needs no `T` ✅[^1] |
| Constant step on a stationary stream | Regret keeps growing at a steady rate per round | Lab: about 0.0018 per round ✅[^6] |
| Distribution shift | Best fixed comparator is poor | Use dynamic or adaptive regret ✅[^1]; lab: stale batch model 0.66 vs 0.044 ✅[^6] |
| Only the chosen action's loss is seen | Full-information methods do not apply directly | Bandit setting; EXP3 ✅[^1] |
| Expensive decision set | Projection can dominate the cost of OGD | Projection may take much longer than the linear-time gradient step ✅[^1] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| OGD, `η_t = D/(G·√t)` | `O(√T)` regret for any sequence, no `T` needed ✅[^1] | Slow to adapt after a change (lab 0.585 vs 0.140) ✅[^6] |
| OGD, constant `η` | Tracks a moving target, `O(√(T·P))` dynamic regret ✅[^1] | Steady loss on a stationary stream ✅[^6] |
| FTL | No step size; sublinear regret on strongly convex losses ✅[^2], `4 + 4 ln T` on the squared-loss game ✅[^3] | Linear regret on linear losses ✅[^3] |
| FTRL | Stable; L1 kept exactly, adaptive per-coordinate regularizers ✅[^2] | An argmin per round; keeps the loss history or gradient sums ✅[^3] |
| Hedge / multiplicative weights | Regret grows with `log N`, so many experts are cheap ✅[^1] | Needs every expert's loss each round ✅[^1] |

## Takeaways
- Judge an online learner by its regret over the horizon you care about, against a comparator that fits the problem (fixed for stationary data, moving under drift).
- A decaying step size is a bet that the world is stationary; if it may change, keep a floor under the step or use a constant one. [rule-candidate]
- Never follow the current leader with no regularization when losses are linear (as in choosing among experts): add a regularizer or randomize. [rule-candidate]
- Worst-case step sizes (`η*`, `D/(G·√t)`) are safe but cautious; tune them on held-out stream data when the data are benign.

## Verification status
- Verified: 80 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [Introduction to Online Convex Optimization, 2nd edition](https://arxiv.org/html/1909.05207v3) — Elad Hazan, 2023 (arXiv v3; v1 2019). Backs: the protocol, regret and boundedness, `D` and `G`, the two-expert adversary, weighted majority and Hedge with their bounds, OGD and Theorem 3.1, the `Ω(DG√T)` lower bound, Table 3.1, SGD from OGD, online-to-batch (Theorem 9.5), FTL's failure, RFTL and its bound, OGD and Hedge as RFTL, exponentiated gradient, bandits and EXP3, dynamic and adaptive regret, projection cost, the bibliographic attributions (Zinkevich, Littlestone and Warmuth, Freund and Schapire). [^1]
- [A Survey of Algorithms and Analysis for Adaptive Online Learning](https://ar5iv.labs.arxiv.org/html/1403.3465) — H. Brendan McMahan, 2017. Backs: losses may be drawn from a distribution, the FTRL template with adaptive regularizers, FTL with strongly convex losses, closed-form L1 and data-dependent bounds, bounds on every round. [^2]
- [A Modern Introduction to Online Learning](https://ar5iv.labs.arxiv.org/html/1912.13213) — Francesco Orabona, 2019. Backs: the number-guessing game, FTL's `4 + 4 ln T` bound, the FTL counterexample and its `T − 3/2` regret, OGD vs SGD, FTRL vs OMD memory. [^3]
- [The Multiplicative Weights Update Method: a Meta-Algorithm and Applications](https://theoryofcomputing.org/articles/v008a006/) — Arora, Hazan, Kale, Theory of Computing, 2012 (abstract). Backs: multiplicative weights as one meta-algorithm with an exponential potential. [^4]
- [Online Convex Programming and Generalized Infinitesimal Gradient Ascent](https://aaai.org/papers/icml03-120-online-convex-programming-and-generalized-infinitesimal-gradient-ascent/) — Martin Zinkevich, ICML 2003 (abstract). Backs: online convex programming, choosing a point before the cost is seen, the production motivation. [^5]
- `machine-learning/lab-setup.md` — the lab where the OGD regret, FTL vs FTRL, Hedge and drifting-stream script ran on 2026-11-25. [^6]

## Related
- `machine-learning/reinforcement-learning/multi-armed-bandits.md` — the same regret with bandit feedback, and UCB.
- `machine-learning/foundations/gradient-descent.md` — the offline update OGD is built from.
- `machine-learning/learning-theory/pac-learning-and-vc-dimension.md` — the i.i.d. guarantees online-to-batch conversion connects to.
- `machine-learning/ml-systems/data-drift-and-monitoring.md` — detecting the changes an online learner has to track.
- `machine-learning/deep-learning/continual-learning.md` — learning a sequence of tasks without forgetting the old ones.
- `machine-learning/foundations/regularization.md` — the offline meaning of the regularizer FTRL adds.
