---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/privacy-preserving-ml
status: verified
applies-to: ["any"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, privacy, differential-privacy, laplace-mechanism, gaussian-mechanism, sensitivity, composition, privacy-budget, renyi-differential-privacy, randomized-response, local-differential-privacy]
---

# Differential privacy: the definition, sensitivity, noise mechanisms and the privacy budget

## Summary
**TL;DR:** Differential privacy (DP) is a promise about an algorithm, not about a dataset: its output distribution barely changes when any one person's data is added or removed, by at most a factor `e^ε` (plus a small slack `δ` in the approximate version). You get it by adding noise sized to the query's sensitivity, the most one person can move the answer: Laplace noise of scale `Δ/ε` for pure DP, Gaussian noise for `(ε, δ)`. Every released answer spends budget: the `ε`s of answers on the same data add up, so `k` answers from one fixed budget each get `k` times more Laplace noise; post-processing the answers is free.
**Use this when:** you must pick `ε`, `δ` or a noise scale, compute a query's sensitivity, split a privacy budget across many queries, choose between the Laplace and Gaussian mechanisms, or decide between central and local (randomized-response) collection.
**Not this doc:** training a model with DP (DP-SGD, differentially private stochastic gradient descent, and privacy accounting over thousands of steps) → `machine-learning/privacy-preserving-ml/differentially-private-training.md`; the attacks DP defends against → `machine-learning/privacy-preserving-ml/membership-inference-and-memorization.md`.

## Problem
Removing names does not make data anonymous: de-identified datasets fall to linkage attacks, and aggregate-only answers protect people only when the groups are large, and even then attacks remain ✅[^1]. A counting query such as "how many people in the table earn under 50k and are named X" is an aggregate, yet it returns 0 or 1 and so reveals one row ✅[^2]. Releasing many harmless-looking aggregates is worse: techniques like de-identification are not compositional, and multiple releases can lose privacy catastrophically ✅[^1]. An engineer needs a definition that bounds what any answer, or any collection of answers, can reveal about one person, whatever else the attacker knows.

## Mental model
**Analogy:** a survey taken in a noisy room. Each answer reaches the analyst through static loud enough that nobody can tell whether one particular person spoke, but quiet enough that the crowd's answer still comes through. The volume knob is `ε`: turn it down (small `ε`) and one voice is lost in the static; turn it up and voices become recognizable. Every new question to the same crowd lets the listener average away some static, so the room keeps a running total of how much it has revealed: the privacy budget.

**Artifact:** a count of 100 released with Laplace noise at `ε = 0.5`, next to the same query on a neighbouring dataset whose count is 99, two million draws each; printed by the full script in the Worked example; lab run (`machine-learning/lab-setup.md`), 2026-11-25, numpy 2.5.5, scipy 1.18.1 ✅[^12]:

```text
 bin          P[M(D) in bin] P[M(D') in bin]  ln ratio measured  ln ratio exact
 [ 94.5, 95.5)  0.02076       0.03414         -0.4975           -0.5000
 [ 95.5, 96.5)  0.03415       0.05629         -0.4996           -0.5000
…
 [ 98.5, 99.5)  0.15304       0.22176         -0.3709           -0.3672
 [ 99.5,100.5)  0.22129       0.15327         +0.3673           +0.3672
 [100.5,101.5)  0.15337       0.09285         +0.5019           +0.5000
…
 max |ln ratio| exact = 0.5000 <= epsilon = 0.5
```

In no bin is the exact probability more than `e^0.5 = 1.65` times larger under one dataset than the other, and the measured ratios match the exact ones to within 0.006 (sampling noise). Seeing the output tells an observer little about whether the 100th person is in the data.

## How it works
### The definition and what it promises
1. **Neighbouring datasets.** Two datasets are neighbours if they differ in one individual's data: one row added or removed (add-remove adjacency, sizes differ by one) or one row changed (substitution adjacency, same size) ✅[^2]. The common unit of privacy is "one person"; another unit, such as one person per day, protects less, because a person who submits the same data every day is not protected across days ✅[^2].
2. **ε-DP.** A randomized algorithm `M` (a mechanism) is ε-differentially private if for all neighbours `D`, `D'` and every set `S` of outputs, `Pr[M(D) ∈ S] ≤ e^ε · Pr[M(D') ∈ S]` ✅[^2]. `ε` is the privacy parameter or budget; the probability is over the mechanism's own randomness, not over the data ✅[^2]. Example: `ε = 0.5` means no output becomes more than `e^0.5 = 1.65` times likelier because one person joined. DP is a property of the algorithm, so a dataset is only "DP" through the algorithm that produced it ✅[^2].
3. **(ε, δ)-DP** (approximate DP) adds a slack: `Pr[M(D) ∈ S] ≤ e^ε · Pr[M(D') ∈ S] + δ` ✅[^5]. `δ` acts as a failure probability: with probability `δ` the definition guarantees nothing, so `δ` is usually set to `1/n²` or less for `n` rows (for `n = 10,000`, `δ ≤ 10⁻⁸`) ✅[^5]. This "ε-DP except with probability `δ`" reading is the common one, but Mironov notes that making it formal runs into difficulties ✅[^8].
4. **The promise, informally:** the output is roughly the same whether or not you contribute your data, so an observer cannot tell whether your data was used or what it contained ✅[^1]. It treats all information as identifying and holds against attackers with auxiliary information ✅[^1]. It does not hide population trends: learning those is the goal ✅[^1].
5. **Choosing ε.** No one knows how to set `ε` to prevent bad outcomes in practice; the rough consensus is about 1 or smaller, and values above 10 probably protect little ✅[^2].

### Sensitivity: how much one person can move the answer
- **Global sensitivity** `GS(f) = max |f(D) − f(D')|` over all neighbouring pairs; it does not depend on the actual data ✅[^4].
- **Counts** have sensitivity 1: one row added or removed changes a count by at most 1 ✅[^4] ✅[^13].
- **Sums** have unbounded sensitivity unless values are bounded. Clipping each value into `[L, U]` makes the sensitivity `U − L`: ages clipped to `[0, 125]` give 125 ✅[^4]. Choosing the bounds by looking at the data is not differentially private; use domain knowledge or DP queries to pick them ✅[^4].
- **Averages** are answered as a noisy sum divided by a noisy count, both charged to the budget ✅[^4].
- **Vectors:** for `k` outputs each of sensitivity 1, the L1 sensitivity (sum of absolute changes) is `k` and the L2 sensitivity (Euclidean length of the change) is `√k`; for `k = 10,000` that is 10,000 against 100 ✅[^5].

### The Laplace mechanism (pure ε-DP)
`M(D) = f(D) + Lap(Δ/ε)`, where `Δ` is the sensitivity and `Lap(b)` draws from the Laplace distribution with density `(1/2b)·exp(−|x|/b)` ✅[^2]. Example: a count (`Δ = 1`) at `ε = 0.5` gets noise of scale `b = 2`, whose mean absolute value is 2. OpenDP writes the same guarantee as a privacy map, `ε = Δ / scale` ✅[^9]. Why it holds: the density ratio at any output `y` is `exp((|y − f(D')| − |y − f(D)|)/b)`, and the triangle inequality caps the exponent at `Δ/b = ε`; the lab's exact column above peaks at 0.5000 ✅[^12]. For a vector the noise is drawn per coordinate with `Δ` the L1 sensitivity ✅[^5] ✅[^9].

### The Gaussian mechanism (approximate (ε, δ)-DP)
1. **Classic calibration:** `M(D) = f(D) + N(0, σ²)` with `σ = √(2 ln(1.25/δ)) · Δ / ε` is `(ε, δ)`-DP for `ε, δ ∈ (0, 1)` ✅[^7]. Example: `Δ = 1`, `ε = 1`, `δ = 10⁻⁵` gives `σ = √(2 · 11.736) = 4.84`.
2. **It never gives pure DP:** a Gaussian mechanism cannot satisfy ε-DP for any `ε`, only a continuum of `(ε, δ)` pairs ✅[^8].
3. **Why use it anyway:** a vector Gaussian mechanism can use the L2 sensitivity, which for long vectors such as model gradients is far smaller than L1 ✅[^5], and it composes cleanly under Rényi DP (below) ✅[^8].
4. **Limits of the classic formula:** it is loose for small `ε`, and its `σ ∝ 1/ε` rate cannot be extended beyond `ε ∈ (0, 1)` ✅[^7]. Balle and Wang give the exact condition: the mechanism is `(ε, δ)`-DP if and only if `Φ(Δ/(2σ) − εσ/Δ) − e^ε · Φ(−Δ/(2σ) − εσ/Δ) ≤ δ`, with `Φ` the standard normal cumulative distribution function ✅[^7]. The lab solves it for the smallest valid `σ` (the analytic Gaussian mechanism) ✅[^12].
5. OpenDP measures Gaussian noise in `ρ` (zero-concentrated DP, zCDP) instead: scale 2 at sensitivity 1 reports `ρ = 0.125` ✅[^9].

### Composition: the privacy budget
1. **Sequential composition:** releasing an `ε₁`-DP and an `ε₂`-DP answer on the same data is `(ε₁ + ε₂)`-DP; for approximate DP the `δ`s add too ✅[^3] ✅[^5]. It is an upper bound; the true loss can be smaller ✅[^3]. It is what stops an averaging attack, which asks the same query `k` times and averages the noise away: the bill is `kε` ✅[^5].
2. **Parallel composition:** the same mechanism run on disjoint chunks of the data (histogram bins, contingency-table cells) costs `ε` in total, because each person sits in one chunk ✅[^3].
3. **Advanced composition:** `k` mechanisms, each `(ε, δ)`-DP, are together `(ε', kδ + δ')`-DP for any `δ' > 0`, with `ε' = √(2k ln(1/δ'))·ε + kε(e^ε − 1)`; `ε'` grows like `√k` instead of `k` ✅[^5].
4. **Rényi DP (RDP):** a mechanism is `(α, ε)`-RDP if the Rényi divergence of order `α` between its output distributions on neighbours is at most `ε` ✅[^8]. The Gaussian mechanism with sensitivity 1 is `(α, α/(2σ²))`-RDP for every `α` ✅[^8] (for sensitivity `Δ`, replace `σ` by `σ/Δ`: `αΔ²/(2σ²)`); RDP guarantees at the same `α` add under composition ✅[^8]; and `(α, ε)`-RDP implies `(ε + ln(1/δ)/(α − 1), δ)`-DP ✅[^8]. Example: `k = 100` Gaussian answers with `Δ = 1` and `σ = 49.01` give, at `α = 24.5`, `100·24.5/(2·49.01²) + ln(10⁵)/23.5 = 0.510 + 0.490 = 1.00`, so `(1, 10⁻⁵)`-DP; the lab finds this `σ` by searching over `α` ✅[^12]. This is how DP training is accounted (`machine-learning/privacy-preserving-ml/differentially-private-training.md`).
5. **Post-processing:** any function of a DP output, including one that uses auxiliary information, is just as private; rounding a negative noisy count up to 0 costs nothing ✅[^3].

### Where the noise goes: central and local models
- **Central model:** people send raw data to a trusted curator, who answers queries with noise; this adds the least noise, but the curator must not leak or be breached ✅[^10].
- **Local model:** each person adds noise before sending, so the curator need not be trusted; the cost is accuracy, orders of magnitude worse for the same `ε`, so it suits only strong signals and large populations ✅[^10] ✅[^6].
- **Randomized response** (Warner, 1965) is the classic local mechanism: flip a coin; on heads answer truthfully; on tails answer "yes" or "no" by a second coin ✅[^6]. A true "yes" answers yes with probability `1/2 + 1/4 = 3/4`, a true "no" with `1/4`; the ratio 3 gives `ε = ln 3 = 1.10` ✅[^6]. The analyst inverts it: if a fraction `ŷ` say yes, the estimated true proportion is `p̂ = 2(ŷ − 1/4)`, since a quarter of all answers are random yeses and only half the people answered truthfully ✅[^6].

## Worked example
One script, four parts: (1) the Laplace artifact above; (2) the classic Gaussian `σ` for `δ = 10⁻⁵`, checked against the exact condition; (3) one total budget `ε = 1` split over `k` counting queries under basic composition (Laplace, pure DP), advanced composition (Laplace, `δ' = 10⁻⁵`) and RDP (Gaussian, `δ = 10⁻⁵`); (4) randomized response for 10,000 people, 1,000 repetitions, against the central Laplace count at the same `ε = ln 3`. The core of part 3:

```python
lap_scale = k / eps_total                          # basic composition: each query gets eps_total / k
e = np.min(k * alphas / (2 * sigma**2) + np.log(1 / delta) / (alphas - 1))   # RDP -> (eps, delta)
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-25, numpy 2.5.5, scipy 1.18.1, two runs identical ✅[^12]:

```text
== 2. Gaussian mechanism: classic sigma = sqrt(2 ln(1.25/delta)) * sens / eps, delta = 1e-5 ==
  eps   classic sigma   exact delta at that sigma   holds   smallest valid sigma
   0.1      48.4481         2.636e-09                yes      30.7496
   0.5       9.6896         1.608e-08                yes       7.0318
   1.0       4.8448         4.114e-08                yes       3.7306
   2.0       2.4224         1.336e-07                yes       1.9938
   5.0       0.9690         1.349e-06                yes       0.8919
  10.0       0.4845         2.265e-05                NO        0.4999
  20.0       0.2422         1.527e-03                NO        0.2900

== 3. One budget, k counting queries: error per query ==
     k   Laplace basic: scale  mean |err|   Laplace advanced: scale   Gaussian+RDP: sigma  mean |err|
     1          1.0             1.00             5.0                     4.90           3.91
    10         10.0            10.05            15.8                    15.50          12.37
   100        100.0            99.68            50.0                    49.01          39.04
  1000       1000.0           997.54           158.1                   154.97         123.43

== 4. Randomized response: 'answer truthfully on heads, else answer a second coin' ==
 P[yes | true yes] = 0.75, P[yes | true no] = 0.25, ratio = 3, epsilon = ln 3 = 1.0986
 true proportion 0.3112; yes-fraction in one run 0.4004
 local (randomized response): mean estimate 0.3114, std 0.00853
 central (Laplace on the count): mean estimate 0.3112, std 0.000124
 std ratio local / central = 69
```

<details><summary>Full script (prints the output above and the Mental model artifact)</summary>

```python
# Differential privacy mechanisms in numpy/scipy: the Laplace mechanism on a counting query (measured
# output ratio on neighbouring datasets), the classic Gaussian sigma and where it stops holding, the error
# cost of splitting one budget over k queries, and randomized response.
import numpy as np
from scipy.stats import norm, laplace

rng = np.random.default_rng(0)

print("== 1. Laplace mechanism, counting query, epsilon = 0.5 ==")
eps, sens = 0.5, 1.0                       # a count changes by at most 1 when one row is added/removed
count_D, count_D2 = 100, 99                # D has one more matching row than its neighbour D'
N = 2_000_000
out_D = count_D + rng.laplace(0, sens / eps, N)
out_D2 = count_D2 + rng.laplace(0, sens / eps, N)
edges = np.arange(94.5, 106.0, 1.0)
h_D = np.histogram(out_D, edges)[0] / N
h_D2 = np.histogram(out_D2, edges)[0] / N
def exact(c):                              # exact bin probabilities from the Laplace CDF
    return np.diff(laplace.cdf(edges, loc=c, scale=sens / eps))
print(" bin          P[M(D) in bin] P[M(D') in bin]  ln ratio measured  ln ratio exact")
for i in range(len(edges) - 1):
    print(f" [{edges[i]:5.1f},{edges[i+1]:5.1f})  {h_D[i]:.5f}       {h_D2[i]:.5f}         {np.log(h_D[i] / h_D2[i]):+.4f}"
          f"           {np.log(exact(count_D)[i] / exact(count_D2)[i]):+.4f}")
print(f" max |ln ratio| exact = {np.max(np.abs(np.log(exact(count_D) / exact(count_D2)))):.4f} <= epsilon = {eps}")

print("\n== 2. Gaussian mechanism: classic sigma = sqrt(2 ln(1.25/delta)) * sens / eps, delta = 1e-5 ==")
delta = 1e-5
def exact_delta(eps, sigma, sens=1.0):     # Balle & Wang 2018, Theorem 8: smallest delta for this sigma
    a, b = sens / (2 * sigma), eps * sigma / sens
    return norm.cdf(a - b) - np.exp(eps) * norm.cdf(-a - b)
def analytic_sigma(eps, delta, sens=1.0):  # smallest sigma whose exact delta <= target (bisection)
    lo, hi = 1e-3, 1e3
    for _ in range(200):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if exact_delta(eps, mid, sens) > delta else (lo, mid)
    return hi
print("  eps   classic sigma   exact delta at that sigma   holds   smallest valid sigma")
for e in [0.1, 0.5, 1.0, 2.0, 5.0, 10.0, 20.0]:
    s = np.sqrt(2 * np.log(1.25 / delta)) * sens / e
    d = exact_delta(e, s)
    print(f" {e:5.1f}   {s:10.4f}      {d:12.3e}                {'yes' if d <= delta else 'NO '}     {analytic_sigma(e, delta):8.4f}")

print("\n== 3. One budget, k counting queries: error per query ==")
eps_total, delta = 1.0, 1e-5
alphas = np.linspace(1.01, 500, 50_000)
def rdp_sigma(k):                          # smallest sigma with min_alpha k*alpha/(2 sigma^2) + ln(1/delta)/(alpha-1) <= eps_total
    lo, hi = 1e-2, 1e4
    for _ in range(100):
        mid = (lo + hi) / 2
        e = np.min(k * alphas / (2 * mid**2) + np.log(1 / delta) / (alphas - 1))
        lo, hi = (mid, hi) if e > eps_total else (lo, mid)
    return hi
def advanced_eps0(k, dprime=1e-5):         # per-query eps so that advanced composition totals eps_total
    lo, hi = 1e-6, 1.0
    for _ in range(100):
        mid = (lo + hi) / 2
        tot = np.sqrt(2 * k * np.log(1 / dprime)) * mid + k * mid * (np.exp(mid) - 1)
        lo, hi = (mid, hi) if tot < eps_total else (lo, mid)
    return lo
print("     k   Laplace basic: scale  mean |err|   Laplace advanced: scale   Gaussian+RDP: sigma  mean |err|")
for k in [1, 10, 100, 1000]:
    lap_scale = k / eps_total              # basic composition: each query gets eps_total / k
    err_lap = np.mean(np.abs(rng.laplace(0, lap_scale, 200_000)))
    adv_scale = 1 / advanced_eps0(k)
    sig = rdp_sigma(k)
    err_g = np.mean(np.abs(rng.normal(0, sig, 200_000)))
    print(f" {k:5d}   {lap_scale:10.1f}        {err_lap:9.2f}      {adv_scale:10.1f}               {sig:10.2f}       {err_g:8.2f}")

print("\n== 4. Randomized response: 'answer truthfully on heads, else answer a second coin' ==")
p_yes_if_yes, p_yes_if_no = 0.5 + 0.5 * 0.5, 0.5 * 0.5
print(f" P[yes | true yes] = {p_yes_if_yes}, P[yes | true no] = {p_yes_if_no}, ratio = {p_yes_if_yes / p_yes_if_no:.0f},"
      f" epsilon = ln 3 = {np.log(3):.4f}")
n, p_true, trials = 10_000, 0.30, 1000
truth = rng.random(n) < p_true
est_rr, est_lap = [], []
for _ in range(trials):
    heads = rng.random(n) < 0.5
    answers = np.where(heads, truth, rng.random(n) < 0.5)
    est_rr.append(2 * (answers.mean() - 0.25))                 # invert E[yes fraction] = 0.25 + 0.5 p
    est_lap.append((truth.sum() + rng.laplace(0, 1 / np.log(3))) / n)  # central model, same epsilon
print(f" true proportion {truth.mean():.4f}; yes-fraction in one run {answers.mean():.4f}")
print(f" local (randomized response): mean estimate {np.mean(est_rr):.4f}, std {np.std(est_rr):.5f}")
print(f" central (Laplace on the count): mean estimate {np.mean(est_lap):.4f}, std {np.std(est_lap):.6f}")
print(f" std ratio local / central = {np.std(est_rr) / np.std(est_lap):.0f}")
```

</details>

Reading it:
- **Gaussian table:** the classic `σ` holds for every `ε ≤ 1`, as the theorem says ✅[^7], and with room to spare (exact `δ` 4.1·10⁻⁸ against the target 10⁻⁵ at `ε = 1`), so the smallest valid `σ` is 23 % lower (3.73 against 4.84). Outside the theorem's range it still held at `ε = 2` and `5` for this `δ`, but failed at `ε = 10` (exact `δ` 2.3·10⁻⁵ > 10⁻⁵) and badly at `ε = 20` ✅[^12]. Use the exact condition, not the formula, outside `(0, 1)`.
- **Composition:** with basic composition the Laplace error grows exactly with `k` (1 → 1,000). Advanced composition is worse than basic for one query (scale 5 against 1) but 6 times better at `k = 1,000` (158 against 1,000), at the price of a `δ`. The Gaussian mechanism with RDP accounting loses to basic Laplace up to `k = 10` (12.4 against 10.1) and wins from `k = 100` on, because its error grows like `√k`: 3.9 → 123 over a 1,000-fold increase in `k` ✅[^12].
- **Randomized response:** the local estimate is centred on the truth (mean 0.3114 against the true 0.3112), but its spread, 0.0085, is 69 times the central Laplace estimate's 0.00012 at the same `ε` ✅[^12]. Local DP buys "no trusted curator" with a large accuracy loss, as the sources warn ✅[^6] ✅[^10].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Clipping bounds read off the data | The bounds themselves leak; not DP | They depend on the private values ✅[^4] |
| One person owns many rows | A row-level guarantee does not cover the person | The unit of privacy is the neighbour definition ✅[^2] |
| Same query asked again and again | Averaging the answers removes the noise | Composition charges `kε`; budgets exist to stop this ✅[^5] |
| Counting a group of size 1 | Noise as large as the answer; result useless | Designed: a query on one person must not reveal them ✅[^13] |
| Classic Gaussian formula with `ε > 1` | Outside the theorem; lab: still valid at `ε = 5`, invalid at `ε = 10` for `δ = 10⁻⁵` | `σ ∝ 1/ε` does not extend past 1 ✅[^7]; exact check ✅[^12] |
| `δ` too large | A mechanism can publish the whole dataset with probability `δ` and still be `(ε, δ)`-DP (the "catastrophe mechanism") | `δ` is an unconditional failure probability; the Gaussian fails gracefully, not like this ✅[^5] |
| Wrong sensitivity in code (a 2-sensitive result given scale `1/ε`) | Only `2ε`-DP instead of `ε` (`Δ/scale = 2/(1/ε)`) ✅[^9]; the fix is scale `2/ε` ✅[^11]; single outputs look normal | Privacy bugs show only in output distributions ✅[^11]; the NIST post calls the buggy version `ε/2`-DP, which inverts the privacy map `Δ/scale` ✅[^9] |
| Floating-point arithmetic, weak random-number generators, timing | Privacy failures even with correct maths | Implementation channels ✅[^11]; underestimated sensitivity from rounding ✅[^4] |
| Many small cells under parallel composition | Each count is a weak signal next to the same noise | Splitting the data trades accuracy along another axis ✅[^3] |
| Noisy count below zero | Clamp to 0 at no privacy cost | Post-processing ✅[^3] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Laplace mechanism | Pure `ε`-DP; usable at any `ε`, high or low ✅[^5] ✅[^7] | Needs L1 sensitivity, large for long vectors ✅[^5]; error grows with `k` under basic composition ✅[^12] |
| Gaussian mechanism | L2 sensitivity ✅[^5]; tight composition with RDP ✅[^8]; lab error grows like `√k` ✅[^12] | Only `(ε, δ)` ✅[^8]; for one number at the same `ε`, less accurate than Laplace ✅[^5] |
| Central model | Least noise, best accuracy ✅[^10] | Requires a trusted curator ✅[^10] |
| Local model (randomized response) | No trusted curator; a breach exposes only noisy data ✅[^10] | Orders of magnitude less accurate ✅[^6]; 69 times the spread in the lab ✅[^12] |
| Basic vs advanced composition | Basic: no `δ`, best for few queries ✅[^12] | Basic is linear in `k`; advanced adds `δ'` ✅[^5] |

## Takeaways
- State the unit of privacy, `ε` and `δ` together, and the neighbour definition; a bare "ε = 1" is not a guarantee. [rule-candidate]
- Bound every value before summing (clip), and pick the bounds without looking at the private data. [rule-candidate]
- Keep a budget ledger: every released answer on the same data spends `ε`; post-processing is free.
- Test a DP implementation on output distributions over many runs, never on single outputs ✅[^11].
- For guidance beyond the mechanisms, NIST (National Institute of Standards and Technology) Special Publication 800-226 (March 2025) describes a "differential privacy pyramid" of factors and the privacy hazards that arise when the definition is put into practice ✅[^14].

## Verification status
- Verified: 94 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [Differential Privacy for Privacy-Preserving Data Analysis: An Introduction to our Blog Series](https://www.nist.gov/blogs/cybersecurity-insights/differential-privacy-privacy-preserving-data-analysis-introduction-our) — Near, Darais, Boeckl, NIST, 2020. Backs: failures of de-identification and aggregation, the informal promise, ε as budget, resistance to auxiliary information, compositionality. [^1]
- [Differential Privacy (Programming Differential Privacy, chapter 3)](https://programming-dp.com/chapter3/) — Near, Abuah, living. Backs: ε-DP definition, mechanism, Laplace mechanism and density, counting query sensitivity, neighbouring datasets, unit of privacy, choosing ε. [^2]
- [Properties of Differential Privacy (chapter 4)](https://programming-dp.com/chapter4/) — Near, Abuah, living. Backs: sequential and parallel composition, upper-bound nature, post-processing, small-count accuracy. [^3]
- [Sensitivity (chapter 5)](https://programming-dp.com/chapter5/) — Near, Abuah, living. Backs: global sensitivity, counts, sums and clipping, averages, data-dependent bounds not DP, floating-point underestimation. [^4]
- [Approximate Differential Privacy (chapter 6)](https://programming-dp.com/chapter6/) — Near, Abuah, living. Backs: (ε, δ)-DP, δ ≤ 1/n², Gaussian mechanism, L1 and L2 sensitivity, catastrophe mechanism, advanced composition, averaging attack. [^5]
- [Local Differential Privacy (chapter 13)](https://programming-dp.com/chapter13/) — Near, Abuah, living. Backs: local vs central model, randomized response, ε = ln 3, the estimator, accuracy cost. [^6]
- [Improving the Gaussian Mechanism for Differential Privacy: Analytical Calibration and Optimal Denoising](https://ar5iv.labs.arxiv.org/html/1805.06530) — Balle, Wang, 2018 (ar5iv HTML of arXiv:1805.06530). Backs: classic Gaussian theorem for ε, δ ∈ (0, 1), its limits, the exact (if and only if) condition. [^7]
- [Rényi Differential Privacy](https://ar5iv.labs.arxiv.org/html/1702.07476) — Mironov, 2017 (ar5iv HTML of arXiv:1702.07476). Backs: the "except with probability δ" reading is hard to formalize, Gaussian not pure DP, RDP definition, Gaussian RDP α/(2σ²) at sensitivity 1, composition, conversion to (ε, δ). [^8]
- [Additive Noise Mechanisms (OpenDP User Guide)](https://docs.opendp.org/en/stable/api/user-guide/measurements/additive-noise-mechanisms.html) — OpenDP, living. Backs: Laplace privacy map Δ/scale, Gaussian measured in ρ, L1 for vector Laplace and L2 for vector Gaussian. [^9]
- [Threat Models for Differential Privacy](https://nist.gov/blogs/cybersecurity-insights/threat-models-differential-privacy) — Near, Darais, NIST, 2020. Backs: central and local models, trusted curator, accuracy cost of the local model. [^10]
- [Differential Privacy Bugs and Why They're Hard to Find](https://www.nist.gov/blogs/cybersecurity-insights/differential-privacy-bugs-and-why-theyre-hard-find) — Near, Darais, NIST, 2021. Backs: wrong-sensitivity bug, floating-point, RNG and timing failures, bugs visible only in distributions. [^11]
- `machine-learning/lab-setup.md` — the lab where the Laplace ratio, Gaussian calibration, composition and randomized-response script ran on 2026-11-25. [^12]
- [Counting Queries: Extracting Key Business Metrics from Datasets](https://www.nist.gov/blogs/cybersecurity-insights/counting-queries-extracting-key-business-metrics-datasets) — Darais, Near, NIST, 2020. Backs: counting-query sensitivity 1, group of size 1. [^13]
- [NIST SP 800-226: Guidelines for Evaluating Differential Privacy Guarantees](https://csrc.nist.gov/pubs/sp/800/226/final) — Near, Darais, Lefkovitz, Howarth, NIST, 2025. Backs: the guideline's scope, the differential privacy pyramid and privacy hazards. [^14]

## Related
- `machine-learning/privacy-preserving-ml/differentially-private-training.md` — the Gaussian mechanism and RDP accounting applied to every SGD step.
- `machine-learning/privacy-preserving-ml/membership-inference-and-memorization.md` — what ε bounds in terms of an attacker's success.
- `machine-learning/privacy-preserving-ml/federated-learning.md` — where noise can be added when data stays on devices.
- `machine-learning/probabilistic-ml/bayesian-inference.md` — the probability tools (likelihood ratios, distributions) the definition is written in.
