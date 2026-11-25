---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/probabilistic-ml
status: verified
applies-to: ["any"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, mcmc, markov-chain-monte-carlo, metropolis-hastings, gibbs-sampling, hamiltonian-monte-carlo, nuts, effective-sample-size, r-hat, convergence-diagnostics, bayesian-inference]
---

# Markov chain Monte Carlo: Metropolis–Hastings, Gibbs, HMC and convergence diagnostics

## Summary
**TL;DR:** MCMC (Markov chain Monte Carlo) draws samples from a distribution known only up to a constant, such as a Bayesian posterior, by running a random walk whose long-run visiting frequencies equal that distribution; averages over the visited points then estimate expectations. Metropolis–Hastings proposes a move and accepts it with probability `min(1, p(new)/p(old))` (for a symmetric proposal), so the unknown constant cancels; Gibbs sampling redraws one variable at a time from its exact conditional; HMC (Hamiltonian Monte Carlo) and its self-tuning variant NUTS (No-U-Turn Sampler) use the gradient to make long moves that are still accepted. The draws are correlated, so their worth is the ESS (effective sample size), not their count, and convergence is checked with several chains and R-hat (the potential scale reduction factor); chains stuck in separate modes, or all in the same wrong mode, are the classic failure.
**Use this when:** a posterior has no closed form, you read a sampler's output (acceptance rate, divergences, ESS, R-hat), or you must choose between random-walk Metropolis, Gibbs and HMC/NUTS.
**Not this doc:** priors, likelihoods and conjugate posteriors → `machine-learning/probabilistic-ml/bayesian-inference.md`; approximating the posterior by optimization instead of sampling → `machine-learning/probabilistic-ml/variational-inference.md`; Gibbs updates and message passing on graph-structured models → `machine-learning/probabilistic-ml/probabilistic-graphical-models.md`; sequential Monte Carlo (particle filters) → `machine-learning/probabilistic-ml/hidden-markov-models-and-kalman-filters.md`.

## Problem
Bayes' rule gives a posterior as `prior × likelihood / evidence`, but the evidence is an integral over every parameter value, and for most models neither it nor the expectations we want (a posterior mean, an interval) have a closed form. A grid does not rescue us: `N` points per axis in `D` dimensions is `N^D` evaluations, and in high dimensions almost none of them land where the probability mass is ✅[^2]. Plain Monte Carlo would work, since the average of `n` independent draws is an unbiased estimate whose variance is `Var[f]/n` ✅[^1], but drawing independent samples from such a posterior is exactly what we cannot do ✅[^1]. MCMC gets around it with dependent draws, and that introduces two new questions plain Monte Carlo never had: has the chain reached its target yet, and how much information do correlated draws carry ✅[^7]. A sampler answers neither on its own; in the lab, a chain that accepted 95 % of its moves reported a mean of −1.350 for a quantity whose true mean is 0 ✅[^8].

## Mental model
**Analogy:** a hiker in thick fog on a hilly landscape, where height stands for probability. She cannot see the map, but her altimeter reads the height where she stands and where a trial step would take her. Her rule: always take a step that goes up; take a step that goes down only sometimes, with probability (new height ÷ old height); otherwise stay put and count the spot again. Because only the ratio of two heights matters, she never needs the total area of the map (the normalizing constant). After a long walk, the time she has spent in each region is proportional to its probability. Her consecutive positions are close to each other, so a thousand steps are worth far fewer than a thousand independent snapshots: that discount is the ESS. And if two hills are separated by a deep valley, she may spend the whole walk on one of them and never know the other exists.

**Artifact:** the Metropolis rule on three states with target probabilities `0.2, 0.3, 0.5`. The transition matrix it builds leaves the target unchanged, and a chain started in state 0 forgets its start at the rate of the matrix's second-largest eigenvalue. Lab run (`machine-learning/lab-setup.md`), 2026-11-25, numpy 2.5.5, two runs identical ✅[^8]:

```text
transition matrix A (column = current state):
[[0.    0.333 0.2  ]
 [0.5   0.167 0.3  ]
 [0.5   0.5   0.5  ]]
A @ target = [0.2 0.3 0.5] (equals the target: the chain leaves it unchanged)
t= 0  P(state) = [1. 0. 0.]  max error = 0.8000
t= 1  P(state) = [0.  0.5 0.5]  max error = 0.2000
t= 2  P(state) = [0.2667 0.2333 0.5   ]  max error = 0.0667
t= 5  P(state) = [0.1975 0.3025 0.5   ]  max error = 0.0025
t=10  P(state) = [0.2 0.3 0.5]  max error = 0.0000
t=20  P(state) = [0.2 0.3 0.5]  max error = 0.0000
|eigenvalues| = [1.     0.3333 0.    ] -> error shrinks by about x0.333 per step
```

<details><summary>Full script (prints the output above)</summary>

```python
# A Metropolis chain on 3 states: build its transition matrix, check it leaves the target unchanged,
# and watch a point mass converge to the target at the rate of the second-largest eigenvalue.
import numpy as np

target = np.array([0.2, 0.3, 0.5])
A = np.zeros((3, 3))                     # A[i, j] = P(next = i | current = j); columns sum to 1
for j in range(3):
    for i in range(3):
        if i != j:                       # propose one of the 2 other states, prob 1/2 each
            A[i, j] = 0.5 * min(1.0, target[i] / target[j])   # ... and accept with min(1, p'/p)
    A[j, j] = 1.0 - A[:, j].sum()        # rejected proposals stay put
print("transition matrix A (column = current state):")
print(A.round(3))
print("A @ target =", (A @ target).round(3), "(equals the target: the chain leaves it unchanged)")
v = np.array([1.0, 0.0, 0.0])            # every chain starts in state 0
for t in range(0, 21):
    if t in (0, 1, 2, 5, 10, 20):
        print(f"t={t:2d}  P(state) = {v.round(4)}  max error = {np.abs(v - target).max():.4f}")
    v = A @ v
lam = np.sort(np.abs(np.linalg.eigvals(A)))[::-1]
print("|eigenvalues| =", lam.round(4), f"-> error shrinks by about x{lam[1]:.3f} per step")
```
</details>

Reading it: from state 2 (probability 0.5) a proposal to state 0 (0.2) is accepted with `min(1, 0.2/0.5) = 0.4`, and proposed half the time, so `A[0, 2] = 0.2`. The error falls from 0.2 to 0.0667 to 0.0025 by `t = 5`, a factor of 0.333 per step, the second-largest eigenvalue ✅[^8], as the matrix view of a Markov chain predicts ✅[^1].

## How it works
**The Markov chain.** A Markov chain is a sequence of states in which each new state is drawn from a transition distribution `T(x' | x)` that depends only on the current state ✅[^1]. If the transition preserves the target, that is `p(x) = ∫ p(x') T(x | x') dx'` (a batch of exact samples stays exactly distributed after one step), then a chain started anywhere drifts towards and then through the region holding the probability mass ✅[^2]. For a finite state space, `T` is a matrix `A` whose columns sum to 1; under mild conditions it has a single eigenvector with eigenvalue 1 (the stationary, or equilibrium, distribution) and the magnitude of the second-largest eigenvalue sets the mixing time ✅[^1]. Running the chain until it reaches equilibrium is called burning in ✅[^1]; the first stretch, thrown away before computing estimates, is also called warm-up ✅[^2].

**The estimate and its error.** Average `f` over the kept draws: `f̂ = (1/N) Σ f(x_n)`. Once the chain is exploring well, `f̂` follows a CLT (central limit theorem) with MCSE (Monte Carlo standard error) `√(Var[f] / ESS)` ✅[^2], where `ESS = N / (1 + 2 Σ_{t≥1} ρ_t)` and `ρ_t` is the autocorrelation of `f` between draws `t` steps apart ✅[^2] ✅[^5]. Example: an AR(1) (first-order autoregressive) series with `ρ_t = 0.9^t` has `1 + 2·0.9/0.1 = 19`, so `N = 100,000` draws are worth `5,263`; the lab's estimator gave `5263 ± 259` over 20 such series ✅[^8]. With a standard deviation (sd) of 1 and `ESS = 400`, the MCSE is `1/20 = 0.05`.

### Metropolis–Hastings and random-walk Metropolis
1. **Propose** `x'` from a proposal density `Q(x' | x)`, any random perturbation of the current state ✅[^2].
2. **Accept** with probability `a = min(1, Q(x | x') · p(x') / (Q(x' | x) · p(x)))` ✅[^2]; on rejection the chain stays at `x`, and `x` is counted again ✅[^3]. Because `p` appears only as a ratio, its normalizing constant cancels.
3. **Random-walk Metropolis** uses a Gaussian proposal centred on `x`; it is symmetric, so `a = min(1, p(x') / p(x))` ✅[^2]. The rule makes the chain reversible with respect to the target ("detailed balance": `p(x)·T(x' | x) = p(x')·T(x | x')`, as much probability flows from `x` to `x'` as back), which implies the target is left unchanged ✅[^3]. The acceptance rule is what balances the flow: `p(x)·Q(x' | x)·a = min(p(x)·Q(x' | x), p(x')·Q(x | x'))`, the same value read from either side. In the three-state artifact, `0.2 × A[2, 0] = 0.2 × 0.5 = 0.1` and `0.5 × A[0, 2] = 0.5 × 0.2 = 0.1` ✅[^8].
4. **The step-size dilemma.** In high dimensions most of the volume lies outside the high-probability region, so large proposals are nearly always rejected and small ones move the chain extremely slowly ✅[^2]. Proposals must be about as small as the standard deviation in the most constrained direction, and because accepted moves wander in random directions, crossing a direction 10 times wider takes about 10² = 100 accepted moves, not 10 ✅[^3]. For a target made of `d` independent copies of one distribution, the work to reach a nearly independent point grows as `d²`, and the optimal acceptance rate is about 23 % ✅[^3].

### Gibbs sampling
Update one variable at a time by drawing it from its conditional distribution given all the others (in a graphical model, given its neighbours), and sweep over the variables ✅[^1]. Variables that are conditionally independent given the rest can be drawn together, block Gibbs sampling ✅[^1]. Basic Gibbs sampling can be read as Metropolis–Hastings, as the algebra here shows: the proposal for `x_j` is its conditional `p(x_j' | x_−j)` with the other variables `x_−j` unchanged, and since `p(x) = p(x_j | x_−j)·p(x_−j)`, the acceptance ratio `Q(x | x')·p(x') / (Q(x' | x)·p(x))` is exactly 1. So no draw is ever rejected (the lab run's acceptance is 1.000 ✅[^8]), and there is nothing to tune when the conditionals can be sampled directly ✅[^3]. For a 2-D Gaussian with unit variances and correlation `ρ`, the conditional is `x1 | x2 ~ N(ρ·x2, 1 − ρ²)`: with `ρ = 0.98` and `x2 = 1`, mean 0.98 and standard deviation `√0.0396 = 0.199`, so each move is about the size of the narrow direction, and strong correlation makes Gibbs mix slowly ✅[^1] ✅[^3].

### Hamiltonian Monte Carlo
HMC renames the parameters the position `q`, adds a momentum `p` of the same dimension, and treats `H(q, p) = U(q) + K(p)` as an energy, with potential `U(q) = −log π(q)` (`π` is the target density, written `p(x)` above; up to a constant) and kinetic `K(p) = pᵀp / 2` for a unit mass matrix ✅[^2] ✅[^3]. One iteration ✅[^3]:
1. Draw a fresh momentum `p ~ N(0, I)`.
2. Simulate Hamilton's equations for `L` leapfrog steps of size `ε`: `p ← p − (ε/2)·∇U(q)`, `q ← q + ε·p`, `p ← p − (ε/2)·∇U(q)` ✅[^2]. The gradient steers the trajectory along the high-probability region instead of off it ✅[^2].
3. Negate the momentum (which makes the proposal symmetric) and accept the end point `(q*, p*)` with probability `min(1, exp(H(q, p) − H(q*, p*)))` ✅[^3]. Exact dynamics conserve `H` and would always be accepted ✅[^3]; the leapfrog integrator preserves volume, so its energy error stays bounded instead of drifting ✅[^2]. Example: an energy error `ΔH = 0.1` is accepted with probability `e^(−0.1) = 0.905`.
4. **Step size limit.** For a Gaussian direction with standard deviation `σ`, the leapfrog map is stable only if `ε < 2σ`; above it the trajectory's energy grows without bound ✅[^3]. In the lab target the narrowest direction has `σ = √(1 − 0.98) = 0.141`, so `ε < 0.283`: `ε = 0.25` accepted 72.6 % of trajectories, `ε = 0.30` accepted none and all 2,000 diverged ✅[^8].
5. **Scaling.** For `d` replicated independent variables, the leapfrog error forces `ε ∝ d^(−1/4)`, the work to an independent point grows as `d^(5/4)` (against `d²` for random-walk Metropolis), and the optimal acceptance rate is about 65 % ✅[^3]. Leapfrog error is of order `ε³` per step and `ε²` over a trajectory ✅[^6].

**NUTS in outline.** HMC is highly sensitive to `ε` and `L`: too few steps give random-walk behaviour, too many waste work ✅[^4]. NUTS removes `L`: it repeatedly doubles the trajectory, forwards or backwards in time at random, and stops when the trajectory starts to turn back on itself (a U-turn) ✅[^4] ✅[^6]. The next state is drawn from the points along the trajectory with probability proportional to their density, not taken from its end ✅[^6]. Stan caps the doubling at a tree depth of 10 by default, at most `2^10 − 1 = 1023` leapfrog steps ✅[^6], adapts `ε` during warm-up to a target acceptance `δ` (default 0.8) ✅[^6] by the dual-averaging scheme of the NUTS paper ✅[^4] ✅[^6], and estimates the mass matrix from warm-up draws ✅[^6]. In the NUTS paper's experiments it was at least as efficient as well-tuned HMC without hand tuning ✅[^4].

### Convergence diagnostics: R-hat and multi-chain ESS
Run `M ≥ 4` chains from dispersed starting points ✅[^5]. With `N` draws per chain, chain means `θ̄_m`, overall mean `θ̄` and chain variances `s_m²` ✅[^5]:

```text
B = N/(M−1) · Σ_m (θ̄_m − θ̄)²        between-chain variance
W = (1/M) · Σ_m s_m²                 within-chain variance
var⁺ = (N−1)/N · W + B/N             estimate of the target variance
R-hat = √(var⁺ / W)
```

Example: two chains of 100 draws with means −4 and +4 and within-chain variance 0.25 give `B = 100·32 = 3200`, `var⁺ = 0.2475 + 32 = 32.25`, `R-hat = √129 = 11.4`. Each chain is split in half first, so a chain that drifts (first half unlike the second) also raises R-hat ✅[^7]. The current version replaces draws by rank-based normal scores `Φ⁻¹((r − 3/8)/(S + 1/4))` (`r` the draw's rank among all `S` draws, `Φ⁻¹` the inverse of the standard normal cumulative distribution function; with `S = 20,000` the smallest draw maps to `Φ⁻¹(0.0000312) = −4.00` and the median to 0) so heavy tails cannot break it, repeats the computation on the folded draws `|θ − median|` to catch chains with different spreads, and reports the larger value ✅[^5]. The Stan Reference Manual prints the denominator of the normal score as `S − 1/4` ✅[^7]; the paper's `S + 1/4` is the one used here, and for `S = 20,000` the two differ by about 1 part in 40,000.

Use the draws only if R-hat `< 1.01` (tighter than the 1.1 of the original proposal, which in practice could dip below 1.1 before convergence) and the rank-normalized ESS exceeds 400 ✅[^5]. The multi-chain ESS combines each chain's autocorrelations with `W` and `var⁺`, and truncates the sum with Geyer's initial monotone sequence, summing pairs `ρ_2k + ρ_2k+1` while they stay positive and decreasing ✅[^5] ✅[^7].

Lab run (`machine-learning/lab-setup.md`), 2026-11-25, numpy 2.5.5, scipy 1.18.1, two runs identical: 4 random-walk Metropolis chains per case, on `N(0, 1)` and on a bimodal mixture `0.5·N(−4, 0.5²) + 0.5·N(4, 0.5²)` (true mean 0, sd 4.03) ✅[^8]:

```text
unimodal, warm-up kept           chain means [-7.7  -0.51  0.44  6.93]  one-chain ESS [9, 52, 52, 10]
                                 pooled mean  -0.21  sd 15.95  ESS    40  R-hat 1.063  (bulk 1.063, folded 1.037, classic 1.142)
unimodal, first half dropped     chain means [-0.02 -0.05 -0.01  0.04]  one-chain ESS [138, 173, 163, 120]
                                 pooled mean  -0.01  sd  0.99  ESS   575  R-hat 1.003  (bulk 1.003, folded 1.003, classic 1.003)
bimodal, starts on both sides    chain means [-4.02 -3.96  4.01  3.98]  one-chain ESS [484, 633, 600, 549]
                                 pooled mean   0.00  sd  4.02  ESS     6  R-hat 1.736  (bulk 1.736, folded 1.003, classic 8.559)
bimodal, all starts on one side  chain means [3.97 4.02 4.02 3.98]  one-chain ESS [661, 576, 662, 588]
                                 pooled mean   4.00  sd  0.50  ESS  2517  R-hat 1.002  (bulk 1.002, folded 1.002, classic 1.002)
bimodal, step 8 jumps the gap    chain means [ 0.13 -0.04  0.09  0.4 ]  one-chain ESS [274, 291, 296, 232]
                                 pooled mean   0.15  sd  4.04  ESS  1326  R-hat 1.003  (bulk 1.002, folded 1.003, classic 1.003)
```

<details><summary>Full script (prints the output above)</summary>

```python
# Split, rank-normalized R-hat and multi-chain ESS (Vehtari et al. 2021) by hand, on 4 random-walk
# Metropolis chains: a unimodal target, and a bimodal target whose chains get stuck.
import numpy as np
from scipy import stats

def rank_normalize(x):                           # pooled ranks -> normal scores (eq. 14)
    r = stats.rankdata(x, method="average").reshape(x.shape)
    return stats.norm.ppf((r - 3 / 8) / (x.size + 1 / 4))

def split(x):                                    # (M, N) -> (2M, N/2): each half is its own chain
    h = x.shape[1] // 2
    return np.concatenate([x[:, :h], x[:, h:2 * h]])

def rhat(x, rank=True):                          # eqs. 1-4 on split (rank-normalized) chains
    z = rank_normalize(split(x)) if rank else split(x); M, N = z.shape
    B = N * z.mean(1).var(ddof=1)                # between-chain variance
    W = z.var(1, ddof=1).mean()                  # within-chain variance
    return np.sqrt(((N - 1) / N * W + B / N) / W)

def rhat_max(x):                                 # report max of bulk and folded (eq. 15) R-hat
    return max(rhat(x), rhat(np.abs(x - np.median(x))))

def ess(x):                                      # eqs. 10-13; one chain (M=1) or several
    z = rank_normalize(split(x)) if x.shape[0] > 1 else x - x.mean()
    M, N = z.shape; zc = z - z.mean(1, keepdims=True)
    f = np.fft.rfft(zc, 2 * N, axis=1)
    acov = np.fft.irfft(f * np.conj(f), axis=1)[:, :N] / N        # biased autocovariance
    s2 = z.var(1, ddof=1)
    W = s2.mean(); var_plus = (N - 1) / N * W + (z.mean(1).var(ddof=1) if M > 1 else 0.0)
    r = 1 - (W - (s2[:, None] * acov / acov[:, :1]).mean(0)) / var_plus
    pairs = r[0:N - 1:2] + r[1:N:2]
    k = np.argmax(pairs <= 0) if np.any(pairs <= 0) else len(pairs)
    return M * N / (-1 + 2 * np.minimum.accumulate(pairs[:k]).sum())

def rwm(logp, starts, step, n, rng):             # one random-walk Metropolis chain per start
    out = np.empty((len(starts), n))
    for c, x in enumerate(starts):
        for i in range(n):
            y = x + step * rng.standard_normal()
            if np.log(rng.uniform()) < logp(y) - logp(x):
                x = y
            out[c, i] = x
    return out

unimodal = lambda x: -0.5 * x**2                                    # N(0, 1)
bimodal = lambda x: np.logaddexp(-0.5 * ((x + 4) / 0.5) ** 2,       # 0.5 N(-4, 0.5^2) + 0.5 N(4, 0.5^2)
                                 -0.5 * ((x - 4) / 0.5) ** 2)       # true mean 0, sd 4.03
rng = np.random.default_rng(1)

def report(name, x):
    print(f"{name:32s} chain means {np.round(x.mean(1), 2)}  one-chain ESS {[round(ess(c[None])) for c in x]}")
    print(f"{'':32s} pooled mean {x.mean():6.2f}  sd {x.std():5.2f}  ESS {ess(x):5.0f}  R-hat {rhat_max(x):5.3f}"
          f"  (bulk {rhat(x):5.3f}, folded {rhat(np.abs(x - np.median(x))):5.3f}, classic {rhat(x, rank=False):5.3f})")

x = rwm(unimodal, [-100, -30, 30, 100], 1.0, 2_000, rng)          # 4 chains started far out
report("unimodal, warm-up kept", x)
report("unimodal, first half dropped", x[:, 1_000:])
for name, starts, step in [("bimodal, starts on both sides", [-6, -2, 2, 6], 0.5),
                           ("bimodal, all starts on one side", [2, 3, 5, 6], 0.5),
                           ("bimodal, step 8 jumps the gap", [-6, -2, 2, 6], 8.0)]:
    report(name, rwm(bimodal, starts, step, 10_000, rng)[:, 5_000:])  # first half dropped
```
</details>

The script omits two refinements of the paper's ESS estimator (averaging the truncated sums at an odd and the next even lag, and capping the estimate at `S·log10(S)`) ✅[^5]. Reading the five cases:
- **Warm-up kept:** chains started at ±100 and ±30 still carry their approach in the first draws: pooled sd 15.95 for a target with sd 1, R-hat 1.063. Dropping the first half gives sd 0.99 and R-hat 1.003 from the same chains ✅[^8].
- **Stuck in separate modes:** each chain alone looks healthy (one-chain ESS 484 to 633, mean ±4.0 with a tiny apparent error), yet R-hat is 1.736 and the pooled ESS collapses to 6 of 20,000 draws ✅[^8]. The paper expects this ESS to fall to about the number of distinct modes found when chains do not mix at all ✅[^5]; 6 for 2 modes is of that order. Rank normalization caps R-hat here (1.736 against the classic 8.559), but both fail the 1.01 threshold ✅[^8].
- **All chains in one mode:** R-hat 1.002 and ESS 2517 pass every check while the pooled mean is 4.00 instead of 0 ✅[^8]. R-hat compares chains with each other; it cannot see a mode none of them visited.
- **A proposal that jumps the gap** (step 8) moves between the modes: mean 0.15, sd 4.04, R-hat 1.003 ✅[^8]. The fix was the sampler, not the diagnostic.

## Worked example
Five samplers on Neal's test target, a 2-D Gaussian with means 0, unit variances and correlation 0.98 ✅[^3], whose narrow direction has standard deviation `√0.02 = 0.141` and wide direction `√1.98 = 1.41` (Neal's 0.14 and 1.41) ✅[^3]. Each sampler gets the same work budget of 40,000 units: a proposal (random-walk Metropolis), one conditional draw (Gibbs: 20,000 scans of 2), or one leapfrog step (HMC: 2,000 trajectories of `L = 20` steps with Neal's `ε = 0.18` ✅[^3]). ESS is computed by hand for `x1` and for `x1²` (the quantity a variance estimate averages); the estimator is first checked on AR(1) series of known ESS, and the HMC value is checked against 500 independent chains. The core HMC step:

```python
p = rng.standard_normal((chains, 2)); H0 = U(x) + 0.5 * (p * p).sum(1)
q = x.copy(); p = p - 0.5 * eps * grad_U(q)            # half step for the momentum
for j in range(L):
    q = q + eps * p                                      # full step for the position
    if j < L - 1: p = p - eps * grad_U(q)
p = p - 0.5 * eps * grad_U(q)
dH = U(q) + 0.5 * (p * p).sum(1) - H0                  # energy error decides acceptance
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-25, numpy 2.5.5, scipy 1.18.1, two runs identical ✅[^8]:

```text
ess() on 20 AR(1) series (phi=0.9, n=100000): 5263 +- 259, theory 5263
sampler        setting          work  accept   lag1   ESS(x1)  ESS per 1k work  mean(x1)  sd(x1)  ESS(x1^2)
RW Metropolis  step=0.02       40000   0.953   1.000        8              0.2    -1.350   0.662          8
RW Metropolis  step=0.15       40000   0.686   0.994       68              1.7     0.026   1.023        211
RW Metropolis  step=1.5        40000   0.096   0.960      788             19.7    -0.019   0.962       1332
Gibbs          2 updates/scan  40000   1.000   0.960      423             10.6     0.115   0.992        730
HMC            eps=0.18 L=20   40000   0.890  -0.627    11160            279.0    -0.006   0.956        395
HMC check: Var(x1) / Var(500 chain means) = 9643 effective draws per chain
HMC eps=0.25 (leapfrog stability limit 2*sqrt(1-rho) = 0.283): accept 0.726, divergent iterations 0 of 2000
HMC eps=0.3 (leapfrog stability limit 2*sqrt(1-rho) = 0.283): accept 0.000, divergent iterations 2000 of 2000
```

<details><summary>Full script (prints the output above)</summary>

```python
# Random-walk Metropolis (three step sizes), Gibbs and HMC on a 2-D Gaussian with correlation 0.98,
# each given the same work budget (40,000 proposals, conditional draws or leapfrog steps);
# ESS computed by hand and checked two ways.
import numpy as np
from scipy.signal import lfilter

rho = 0.98
S = np.array([[1.0, rho], [rho, 1.0]])           # target covariance; target mean is (0, 0)
P = np.linalg.inv(S)                              # precision matrix
U = lambda x: 0.5 * np.einsum("ci,ij,cj->c", x, P, x)   # U(x) = -log p(x) + const, per chain
grad_U = lambda x: x @ P                          # its gradient, per chain

def ess(x):                                       # Geyer's initial monotone sequence, one chain
    n = len(x); x = x - x.mean()
    f = np.fft.rfft(x, 2 * n)
    acov = np.fft.irfft(f * np.conj(f))[:n] / n   # biased autocovariance (divisor n)
    r = acov / acov[0]                            # autocorrelation at lags 0..n-1
    pairs = r[0:n - 1:2] + r[1:n:2]               # P_k = rho_2k + rho_2k+1
    k = np.argmax(pairs <= 0) if np.any(pairs <= 0) else len(pairs)
    pairs = np.minimum.accumulate(pairs[:k])      # keep the positive, monotone part
    return n / (-1 + 2 * pairs.sum())

def rwm(step, n, rng):                            # random-walk Metropolis, isotropic proposal
    x, out, acc = np.zeros((1, 2)), np.empty((n, 2)), 0
    for i in range(n):
        y = x + step * rng.standard_normal((1, 2))
        if np.log(rng.uniform()) < U(x)[0] - U(y)[0]:   # accept with prob min(1, p(y)/p(x))
            x, acc = y, acc + 1
        out[i] = x[0]
    return out, acc / n

def gibbs(n, rng):                                # one scan = two exact conditional draws
    x, out = np.zeros(2), np.empty((n, 2))
    for i in range(n):
        x[0] = rho * x[1] + np.sqrt(1 - rho**2) * rng.standard_normal()
        x[1] = rho * x[0] + np.sqrt(1 - rho**2) * rng.standard_normal()
        out[i] = x
    return out, 1.0

def hmc(eps, L, n, rng, chains=1):                # L leapfrog steps per iteration, identity mass
    x, out, acc, div = np.zeros((chains, 2)), np.empty((n, chains, 2)), 0, 0
    for i in range(n):
        p = rng.standard_normal((chains, 2))      # fresh momentum
        H0 = U(x) + 0.5 * (p * p).sum(1)
        q = x.copy(); p = p - 0.5 * eps * grad_U(q)
        for j in range(L):
            q = q + eps * p
            if j < L - 1: p = p - eps * grad_U(q)
        p = p - 0.5 * eps * grad_U(q)
        dH = U(q) + 0.5 * (p * p).sum(1) - H0      # energy error of the simulated trajectory
        div += int((np.abs(dH) > 1000).sum())      # Stan's divergence threshold
        ok = np.log(rng.uniform(size=chains)) < -dH
        x[ok] = q[ok]; acc += int(ok.sum())
        out[i] = x
    return out, acc / (n * chains), div

rng = np.random.default_rng(0)
checks = [ess(lfilter([1], [1, -0.9], np.sqrt(1 - 0.81) * rng.standard_normal(100_000)))
          for _ in range(20)]                     # AR(1) series, phi = 0.9: ESS = n(1-phi)/(1+phi)
print(f"ess() on 20 AR(1) series (phi=0.9, n=100000): {np.mean(checks):.0f} +- {np.std(checks):.0f}, "
      f"theory {100_000 * 0.1 / 1.9:.0f}")
print("sampler        setting          work  accept   lag1   ESS(x1)  ESS per 1k work  mean(x1)  sd(x1)  ESS(x1^2)")
runs = []
for step in [0.02, 0.15, 1.5]:
    d, a = rwm(step, 40_000, rng); runs.append(("RW Metropolis", f"step={step}", a, d))
d, a = gibbs(20_000, rng); runs.append(("Gibbs", "2 updates/scan", a, d))
d, a, _ = hmc(0.18, 20, 2_000, rng); runs.append(("HMC", "eps=0.18 L=20", a, d[:, 0]))
for name, setting, a, d in runs:
    x1 = d[:, 0]; e = ess(x1)
    print(f"{name:15s}{setting:15s}{40_000:6d}  {a:6.3f}  {np.corrcoef(x1[:-1], x1[1:])[0, 1]:6.3f}"
          f"  {e:7.0f}  {1000 * e / 40_000:15.1f}  {x1.mean():8.3f}  {x1.std():6.3f}  {ess(x1**2):9.0f}")
d, _, _ = hmc(0.18, 20, 2_000, rng, chains=500)    # 500 independent chains, same settings
print(f"HMC check: Var(x1) / Var(500 chain means) = {1 / d[:, :, 0].mean(0).var():.0f} effective draws per chain")
for eps in [0.25, 0.30]:
    _, a, div = hmc(eps, 20, 2_000, rng)
    print(f"HMC eps={eps} (leapfrog stability limit 2*sqrt(1-rho) = {2 * np.sqrt(1 - rho):.3f}): "
          f"accept {a:.3f}, divergent iterations {div} of 2000")
```
</details>

Reading it line by line ✅[^8]:
- **The ESS estimator is right:** on AR(1) series of known ESS 5,263 it returns 5263 ± 259.
- **Tiny random-walk steps (0.02):** 95.3 % accepted and a lag-1 autocorrelation of 1.000; 40,000 draws are worth 8, and the chain reports mean −1.350 and sd 0.662 for a target with mean 0 and sd 1. A high acceptance rate is not a sign of health.
- **Steps near the narrow scale (0.15)** accept 68.6 % but still give only 68 effective draws: each move is small against the 1.41-wide direction. **Large steps (1.5)** accept only 9.6 % yet are the best random walk here (788): the rare accepted move is long.
- **Gibbs** accepts everything and lands between the random walks (423): its moves are capped by the conditional standard deviation 0.199. Its mean of 0.115 is about 2 MCSE (`0.992/√423 = 0.048`) from 0.
- **HMC** gets 11,160 effective draws for the mean of `x1` from 2,000 iterations, 279 per 1,000 work units against 19.7 for the best random walk, 14 times more. ESS above the number of draws is possible when successive draws are anticorrelated ✅[^7], and the lag-1 autocorrelation here is −0.627: each 20-step trajectory tends to carry the chain to the far side of the ellipse. The 500-chain check (9,643) confirms the order of magnitude.
- **The same HMC run falls behind on `x1²`:** ESS 395, against 730 for Gibbs and 1,332 for the large-step random walk. Jumping to the far side flips the sign of `x1` but keeps its size, so `x1²` stays correlated from one draw to the next. Super-efficiency (ESS above the number of draws) for a mean rarely comes with super-efficiency for the variance ✅[^5], and Neal found a random walk with proposal standard deviation 2.0 about as efficient as HMC on this target, a trick that works only because it is narrow in a single direction ✅[^3].
- **Divergences:** below the stability limit (`ε = 0.25 < 0.283`) HMC still accepts 72.6 % with no divergence; just above it (`ε = 0.30`) every trajectory's energy error passes 1,000 and nothing is accepted.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Separated modes | A chain stays in one mode for its whole run | Moving between modes means crossing a low-probability barrier, exponentially unlikely in the barrier's height ✅[^1]; HMC has the same problem as other local methods ✅[^3]; lab: 4 chains never crossed between ±4 ✅[^8] |
| All chains start in the same mode | R-hat 1.002 and a confident, wrong mean (4.00 vs 0) | R-hat compares chains only with each other ✅[^8]; a small R-hat is not enough to make a sample useful ✅[^5] |
| Strongly correlated parameters | Random-walk Metropolis and Gibbs take steps the size of the narrowest direction | Neal's 0.98 example ✅[^3]; lab, same work: ESS for the mean of `x1` Gibbs 423, HMC 11,160; for `x1²` Gibbs 730, HMC 395 ✅[^8] |
| Divergent transitions in HMC/NUTS | Stan flags iterations whose energy error exceeds a factor `10^3` ✅[^6] | Regions of high curvature (common in hierarchical models) defeat the integrator, and estimates may be biased ✅[^2]; try a smaller step (higher `δ`) or reparameterize, for example non-centred instead of centred ✅[^2] ✅[^6] |
| NUTS hits the maximum tree depth | Trajectories cut short, random-walk-like behaviour | Usually a step size adapted to high curvature that is too small elsewhere ✅[^6] |
| Tree depth 0 | First leapfrog step rejected | Step size too large for the local curvature ✅[^6] |
| Heavy-tailed target | Classic R-hat and ESS are undefined without a finite mean and variance; HMC with an ill-suited kinetic energy may explore the tails too slowly | Rank-normalized versions fix the diagnostics ✅[^5]; an E-BFMI (energy Bayesian fraction of missing information) below 0.3 has proven problematic ✅[^2] |
| Thinning (keeping every k-th draw) | The Deep Learning book suggests it to reduce correlation ✅[^1]; Stan's manual says keeping all draws usually gives a higher ESS, so the only reason to thin is memory ✅[^7] | Thinning throws information away; for anticorrelated draws it even lowers ESS ✅[^7] |
| Draws anticorrelated | ESS larger than the number of draws | Possible with HMC/NUTS on near-Gaussian targets ✅[^7]; lab: 11,160 from 2,000 for `x1`, yet 395 for `x1²` from the same draws ✅[^8] |
| Warm-up not discarded | Estimates biased by the approach from the start point | Early draws come from the transient phase ✅[^2]; lab: sd 15.95 instead of 1 ✅[^8] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Random-walk Metropolis | Needs only `log p` up to a constant; simple ✅[^2] | Work grows as `d²`; an isotropic step must fit the narrowest direction ✅[^3]; lab ESS ≤ 788 of 40,000 ✅[^8] |
| Gibbs sampling | Nothing to tune when the conditionals can be sampled directly ✅[^3]; every draw kept (lab acceptance 1.000) ✅[^8] | Needs samplable conditionals; slow when variables are correlated ✅[^1] |
| HMC (fixed `ε`, `L`) | Long, accepted moves; work grows as `d^(5/4)` ✅[^3]; divergences as a built-in diagnostic ✅[^2] | Needs gradients ✅[^4] and continuous parameters ✅[^3]; very sensitive to `ε` and `L` ✅[^4] |
| NUTS (as in Stan) | Chooses the trajectory length and adapts `ε` and the mass matrix in warm-up ✅[^4] ✅[^6] | Up to 1,023 gradients per iteration at the default depth ✅[^6] |
| Variational inference (VI) instead (`machine-learning/probabilistic-ml/variational-inference.md`) | An optimization; tends to be faster than MCMC ✅[^9] | No guarantee of asymptotically exact samples; generally under-estimates the posterior variance ✅[^9] |

## Takeaways
- Run at least 4 chains from dispersed starts, drop the warm-up, and require R-hat < 1.01 and ESS > 400 before trusting a summary. [rule-candidate]
- Report the MCSE `sd/√ESS` for each quantity you report, not the number of draws; correlated draws are worth far fewer, and one run's ESS can differ 28 times between a mean and a variance.
- A high acceptance rate means small steps, not good mixing.
- Treat any divergence as a warning about the estimates: shrink the step or reparameterize before reading results. [rule-candidate]
- Passing diagnostics shows the chains agree, not that they found every mode: start chains in different basins when multimodality is plausible.

## Verification status
- Verified: 116 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [Deep Learning, chapter 17: Monte Carlo Methods](https://www.deeplearningbook.org/contents/monte_carlo.html) — Goodfellow, Bengio, Courville, MIT Press, 2016. Backs: unbiased Monte Carlo average and its `Var/n` variance, when exact sampling is infeasible, Markov chain and transition distribution, stationary distribution and the second eigenvalue, burn-in, thinning suggestion, Gibbs and block Gibbs, mixing between separated modes and correlated variables. [^1]
- [A Conceptual Introduction to Hamiltonian Monte Carlo](https://arxiv.org/html/1701.02434v2) — Michael Betancourt, 2017. Backs: `N^D` grid cost and the typical set, target-preserving transitions, warm-up, MCMC CLT, MCSE and ESS, Metropolis–Hastings acceptance, random-walk Metropolis in high dimensions, momentum and Hamiltonian, leapfrog, volume preservation, divergences and high curvature, reparameterization, E-BFMI below 0.3. [^2]
- [MCMC using Hamiltonian dynamics](https://arxiv.org/html/1206.1901v1) — Radford M. Neal, 2011. Backs: the HMC algorithm and its acceptance probability, momentum negation, detailed balance, counting rejected states again, the 0.98-correlated test target with `L = 20`, `ε = 0.18`, the random-walk argument, Gibbs move size and tuning, stability limit `ε < 2σ`, `d²` vs `d^(5/4)`, 23 % and 65 % acceptance, isolated modes, a random walk with proposal sd 2.0 about as efficient as HMC on the 0.98 target. [^3]
- [The No-U-Turn Sampler: Adaptively Setting Path Lengths in Hamiltonian Monte Carlo](https://arxiv.org/html/1111.4246v1) — Hoffman, Gelman, 2011. Backs: HMC's sensitivity to `ε` and `L`, trajectory doubling until a U-turn, dual-averaging step-size adaptation, efficiency at least that of tuned HMC. [^4]
- [Rank-normalization, folding, and localization: An improved R-hat for assessing convergence of MCMC](https://arxiv.org/html/1903.08008v5) — Vehtari, Gelman, Simpson, Carpenter, Bürkner, 2021. Backs: `B`, `W`, `var⁺` and R-hat, rank normalization and folding, the 1.01 and 400 thresholds, at least four chains, the ESS definition and Geyer truncation, the omitted refinements, ESS for chains stuck in separate modes, a small R-hat not being enough, super-efficiency rarely holding for mean and variance at once. [^5]
- [MCMC Sampling (Stan Reference Manual 2.40)](https://mc-stan.org/docs/reference-manual/mcmc.html) — Stan Development Team, living. Backs: leapfrog error order, NUTS doubling and U-turn, the next state drawn along the trajectory in proportion to density, maximum tree depth 10 and 1023 steps, target acceptance `δ` default 0.8, mass matrix from warm-up, divergence threshold `10^3`, causes and fixes of divergences, tree-depth diagnostics. [^6]
- [Posterior Analysis (Stan Reference Manual 2.40)](https://mc-stan.org/docs/reference-manual/analysis.html) — Stan Development Team, living. Backs: the two MCMC difficulties, split chains, Geyer's initial monotone sequence, ESS above `N` for anticorrelated draws, thinning only for memory, the rank-normalization denominator printed as `S − 1/4`. [^7]
- `machine-learning/lab-setup.md` — the lab where the three-state Metropolis chain, the R-hat and multi-chain ESS cases, and the five-sampler comparison ran on 2026-11-25. [^8]
- [Variational Inference: A Review for Statisticians](https://arxiv.org/html/1601.00670v9) — Blei, Kucukelbir, McAuliffe, 2017. Backs: MCMC's asymptotic exactness against VI's speed, VI under-estimating the posterior variance. [^9]

## Related
- `machine-learning/probabilistic-ml/bayesian-inference.md` — the posterior that MCMC samples, and the conjugate cases that need no sampler.
- `machine-learning/probabilistic-ml/variational-inference.md` — the optimization alternative, compared against an HMC posterior.
- `machine-learning/probabilistic-ml/probabilistic-graphical-models.md` — the graph structure that Gibbs updates follow.
- `machine-learning/probabilistic-ml/hidden-markov-models-and-kalman-filters.md` — particle filters, a sequential Monte Carlo method.
- `machine-learning/probabilistic-ml/gaussian-processes.md` — a Bayesian model whose regression posterior needs no sampling.
- `machine-learning/foundations/gradient-descent.md` — the gradients HMC reuses, and step-size divergence in optimization.
