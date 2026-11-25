---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/causal-inference
status: verified
applies-to: ["numpy 2.5.5", "scipy 1.18.1"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, causal-inference, potential-outcomes, average-treatment-effect, randomization, ab-testing, confidence-interval, power, sample-size, peeking, sequential-testing]
---

# Potential outcomes and randomized experiments (A/B tests)

## Summary
**TL;DR:** A causal effect compares two potential outcomes of the same unit, one with the treatment and one without, and only one of them is ever observed. Averages can still be estimated: when a coin flip decides who is treated, the two groups are alike in everything, so the difference of their means estimates the ATE (average treatment effect); a group that chose the treatment itself adds selection bias. An A/B test reports that difference with a standard error and a confidence interval, its sample size is fixed in advance from the smallest effect worth detecting, and checking the p-value every day and stopping at the first p < 0.05 inflates the false-positive rate (24.3 % instead of 5 % in the lab).
**Use this when:** you design or read an A/B test, need ATE vs ATT (average treatment effect on the treated), compute a confidence interval or a sample size for a difference in means, or someone wants to stop a test early because it "is significant".
**Not this doc:** which variables to adjust for without randomization → `machine-learning/causal-inference/causal-graphs-and-confounding.md`; estimating effects from non-randomized data → `machine-learning/causal-inference/estimating-effects-from-observational-data.md`; effects that differ between users → `machine-learning/causal-inference/heterogeneous-treatment-effects.md`; shifting traffic to the winner while the test runs → `machine-learning/reinforcement-learning/multi-armed-bandits.md`.

## Problem
A predictive model answers "who uses feature F a lot?", but a product decision needs "how many minutes does F add?". The two differ: in the lab population, users who opted into a feature spent 4.824 more minutes a week than the others, while the feature's true average effect was 1.000 minute ✅[^6]. Randomizing fixes that bias, yet randomized tests still go wrong in two common ways: too few users to detect the effect (23.2 % power at 50 users per arm in the lab), and peeking at the p-value until it dips below 0.05 ✅[^6].

## Mental model
**Analogy:** a ledger with two columns per user: minutes in the world where the user got the feature, and minutes in the world where they did not. The effect for that user is the difference of the two columns, but reality erases one column for every user. Randomization is a coin flip deciding which column survives, so the surviving half of each column is a fair sample of the whole column; self-selection lets users pick, and the ones who pick the feature were heavy users in both columns already.

**Artifact:** a simulated population where every user has both columns (`y0` without, `y1` with the feature), printed by the full script in the Worked example; lab run (`machine-learning/lab-setup.md`), 2026-11-25, numpy 2.5.5 ✅[^6]:

```text
user     y0     y1  effect
   0  12.73  14.33    1.60
   1   9.17   8.89   -0.29
   2  11.61  15.11    3.50
   3   9.24  10.60    1.36
true ATE = mean(y1 - y0) over 100,000 users = 1.000
randomized    difference in means = 1.015
self-selected difference in means = 4.824 = ATE 1.000 + selection bias 3.377 + effect-heterogeneity bias 0.448
```

User 1 is worse off with the feature (−0.29), user 2 gains 3.50; the average over all 100,000 is 1.000. A coin-flip comparison lands at 1.015, a self-selected one at 4.824.

## How it works
### Potential outcomes and the quantities to estimate
1. **Notation.** `D_i` is 1 if unit `i` is treated and 0 if not; `Y_i(1)` and `Y_i(0)` are its two potential outcomes (Cunningham writes `Y¹_i`, `Y⁰_i`). The observed outcome follows the switching equation `Y_i = D_i·Y_i(1) + (1 − D_i)·Y_i(0)` ✅[^1]. Example: if user 0 is treated (`D = 1`), the data show `Y = 14.33` and its `Y(0) = 12.73` is never seen.
2. **Individual effect** `δ_i = Y_i(1) − Y_i(0)`. Only one of the two terms is ever observed, which Holland (1986) called the fundamental problem of causal inference; Cunningham frames it as missing data that no sample size can fill, because the missing outcome never happened ✅[^1].
3. **Averages.** `ATE = E[δ] = E[Y(1)] − E[Y(0)]` (`E[·]` is the mean over the population); `ATT = E[δ | D = 1]` averages over the treated only and the ATU (average treatment effect on the untreated) `= E[δ | D = 0]` over the untreated; with heterogeneous effects they can differ, and the research question decides which one matters ✅[^1].
4. **Why a raw comparison misleads.** The SDO (simple difference in outcomes) splits exactly into three terms ✅[^1]:

   ```text
   SDO = E[Y | D=1] − E[Y | D=0]
       = ATE
       + (E[Y(0) | D=1] − E[Y(0) | D=0])      selection bias
       + (1 − π) · (ATT − ATU)                 heterogeneous-effect bias, π = share treated
   ```

   Selection bias means the two groups would differ even without the treatment ✅[^1]. Lab example: `4.824 = 1.000 + 3.377 + 0.448`; engaged users opt in, and they already spend 3.4 more minutes without the feature ✅[^6].
5. **Randomization.** If assignment ignores the potential outcomes, written `(Y(1), Y(0)) ⫫ D` (independent), then in a large sample the selection-bias term is zero and `ATT = ATU`, so `SDO = ATE` ✅[^1]. Physical randomization balances observed and unobserved covariates, the potential outcomes and the effects themselves ✅[^1]. Lab: 1.015 against 1.000 ✅[^6].
6. **SUTVA (stable unit treatment value assumption).** Each unit's potential outcomes depend only on its own assignment (no interference) and the treatment is the same for every treated unit (no hidden variation in treatments) ✅[^1]. Network interference, peer effects and equilibrium effects violate the first ✅[^1].

### The A/B test as an estimator
1. **Estimate:** `diff = ȳ_B − ȳ_A`, the treatment-arm mean minus the control-arm mean.
2. **Standard error:** `SE = sqrt(s_B²/n_B + s_A²/n_A)`, where `s` is a sample standard deviation and `n` an arm size; it is the denominator of the two-sample t statistic in the NIST (National Institute of Standards and Technology) handbook that does not assume equal variances, whose degrees of freedom `ν` come from the Welch–Satterthwaite approximation ✅[^2]. Example: `s_B ≈ 4.41`, `s_A ≈ 3.61`, 1,000 users each → `sqrt(19.45/1000 + 13.03/1000) = 0.180`; the lab's sample values give 0.181 ✅[^6].
3. **Confidence interval:** `diff ± t_(0.975, ν)·SE`. In scipy, `ttest_ind(b, a, equal_var=False)` performs Welch's t-test and its result has `confidence_interval(confidence_level)` (added in 1.11.0) ✅[^4]. With 1,000 users per arm, the hand-made interval with 1.96 matched scipy's to 3 decimals in the lab: `[0.767, 1.475]` ✅[^6].
4. **What 95 % means:** the procedure covers the true value with probability at least 0.95 at a sample size fixed in advance ✅[^5]. In 1,000 repeated lab experiments the interval contained the true ATE 94.8 % of the time ✅[^6].
5. **Binary metrics** (conversion): the large-sample test for two proportions divides `p̂₁ − p̂₂` by `sqrt(p̂(1 − p̂)(1/n₁ + 1/n₂))`, with `p̂` the pooled proportion ✅[^7]. Example: 12 % vs 10 % conversion with 1,000 users each → `p̂ = 0.11`, denominator `sqrt(0.11 · 0.89 · 0.002) = 0.0140`, `z = 0.02/0.0140 = 1.43`, short of the 1.96 needed at 5 %.

### Power and sample size
1. **Two error rates.** `α` is the risk of rejecting a true null hypothesis (a false positive); `β` is the risk of keeping the null when the true shift is `δ` ✅[^3]; power, the probability of detecting that shift, is `1 − β` ✅[^5].
2. **Formula.** For a two-sided test of one mean with known `σ`, `N = (z_(1−α/2) + z_(1−β))² · (σ/δ)²`, where `z_q` is the standard normal quantile; NIST's one-sided example with `α = 0.05`, `β = 0.10` and a one-standard-deviation shift gives `(1.645 + 1.282)² = 8.567 ≈ 9` ✅[^3]. With `σ` estimated, the t version must be iterated because its critical values depend on `N` ✅[^3].
3. **Two arms.** The difference of two means with `n` users per arm has variance `(σ_A² + σ_B²)/n`, so the same formula applies with `σ² = σ_A² + σ_B²`. Example: `(1.960 + 0.842)² · (3.61² + 4.41²) / 1.00² = 7.85 · 32.48 = 255` users per arm for 80 % power at `α = 0.05`; the lab's 1,000 simulated tests at 255 users per arm rejected 79.4 % of the time ✅[^6].
4. **Consequence of the `δ²`:** halving the effect you want to detect multiplies the sample size by 4 (the formula above ✅[^3]); power is a steep function of the true effect, so a good guess of the effect size is needed before the test starts ✅[^5].

### Peeking
1. **Mechanism.** A fixed-horizon p-value is valid at the one sample size chosen in advance. Each extra look is another chance for pure noise to cross the threshold, and stopping at the first crossing keeps that false positive; the lab rate grows with every added look ✅[^6]. Johari, Pekelis and Walsh describe p-values and intervals as unreliable when users set the sample size by continuously monitoring, and report that Type I error (the false-positive rate) "can easily increase fivefold" even with 10,000 samples ✅[^5].
2. **Lab size of the effect.** In 3,000 A/A tests (both arms identical), the false-positive rate grew with the number of looks: 4.5 % with 1 look, 13.2 % with 5, 24.3 % with 20 daily looks ✅[^6].
3. **Fixes.** Fix `n` in advance and look once at the end; or use always-valid p-values and confidence intervals, built from sequential tests such as the mSPRT (mixture sequential probability ratio test), which control Type I error at any data-dependent stopping time ✅[^5].

## Worked example
Experiments on the simulated population above: one A/B test with 1,000 users per arm, the same test repeated 1,000 times, power at six sample sizes, and 3,000 A/A tests that gain 200 new users per arm per day for 20 days and are peeked at daily. The core of the peeking simulation:

```python
for d in range(days):                                   # p-value after each day's data
    m = (d + 1) * per_day
    pvals[:, d] = stats.ttest_ind(b[:, :m], a[:, :m], axis=1, equal_var=False).pvalue
np.mean((pvals[:, days_seen] < 0.05).any(axis=1))      # share stopped at a look with p < 0.05
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-25, numpy 2.5.5, scipy 1.18.1, two runs identical; the script first prints the 8 lines of the Mental model artifact, then ✅[^6]:

```text
A/B test, 1,000 per arm: diff 1.121  SE 0.181  by hand 95% CI [0.767, 1.475]  scipy Welch CI [0.767, 1.475]  p = 6.6e-10
1,000 repeated A/B tests: the 95% CI contains the true ATE in 94.8% of them
sd(y0) = 3.61, sd(y1) = 4.41; users per arm for 80% power: 255
n per arm   simulated power   formula power
       50             0.232           0.236
      100             0.426           0.418
      200             0.690           0.698
      255             0.794           0.800
      400             0.937           0.939
      800             0.999           0.999
A/A tests (no true effect) stopped and declared significant at the first look with p < 0.05:
   1 look(s), one every 20 days -> false-positive rate 4.5%
   2 look(s), one every 10 days -> false-positive rate 7.3%
   5 look(s), one every  4 days -> false-positive rate 13.2%
  10 look(s), one every  2 days -> false-positive rate 18.7%
  20 look(s), one every  1 days -> false-positive rate 24.3%
```

<details><summary>Full script (prints the output above)</summary>

```python
# Potential outcomes for every unit, randomized vs self-selected comparison, an A/B test
# confidence interval and its coverage, power vs sample size, and peeking at A/A tests.
import numpy as np
from scipy import stats
rng = np.random.default_rng(0)

# 1. A population where every user has BOTH potential outcomes (weekly minutes of use).
N = 100_000
engagement = rng.normal(0, 1, N)                       # a trait nobody records
y0 = 10 + 3 * engagement + rng.normal(0, 2, N)        # minutes without the new feature
effect = 1.0 + 0.8 * engagement + rng.normal(0, 1, N) # individual treatment effect
y1 = y0 + effect                                       # minutes with the new feature
print("user     y0     y1  effect")
for i in range(4):
    print(f"{i:4d} {y0[i]:6.2f} {y1[i]:6.2f} {effect[i]:7.2f}")
ate = effect.mean()
print(f"true ATE = mean(y1 - y0) over {N:,} users = {ate:.3f}")

def observed_difference(d):                            # d: 1 = got the feature
    y = np.where(d, y1, y0)                            # switching equation: one outcome is seen
    return y[d].mean() - y[~d].mean()
d_random = rng.random(N) < 0.5                         # coin flip
d_self = engagement + rng.normal(0, 1, N) > 0          # engaged users opt in
print(f"randomized    difference in means = {observed_difference(d_random):.3f}")
sdo = observed_difference(d_self)
pi = d_self.mean()
selection_bias = y0[d_self].mean() - y0[~d_self].mean()
het_bias = (1 - pi) * (effect[d_self].mean() - effect[~d_self].mean())
print(f"self-selected difference in means = {sdo:.3f}"
      f" = ATE {ate:.3f} + selection bias {selection_bias:.3f} + effect-heterogeneity bias {het_bias:.3f}")

# 2. One A/B test: 1,000 users per arm drawn from the population, coin-flip assignment.
def ab_test(n):
    idx = rng.integers(0, N, 2 * n)                    # 2n random users
    return y0[idx[:n]], y1[idx[n:]]                    # control arm sees y0, treatment arm sees y1
a, b = ab_test(1000)
diff = b.mean() - a.mean()
se = np.sqrt(b.var(ddof=1) / len(b) + a.var(ddof=1) / len(a))
res = stats.ttest_ind(b, a, equal_var=False)           # Welch's t-test
ci = res.confidence_interval(0.95)
print(f"A/B test, 1,000 per arm: diff {diff:.3f}  SE {se:.3f}  by hand 95% CI [{diff - 1.96 * se:.3f}, {diff + 1.96 * se:.3f}]"
      f"  scipy Welch CI [{ci.low:.3f}, {ci.high:.3f}]  p = {res.pvalue:.2g}")
covered = 0
for _ in range(1000):
    a, b = ab_test(1000)
    ci = stats.ttest_ind(b, a, equal_var=False).confidence_interval(0.95)
    covered += ci.low <= ate <= ci.high
print(f"1,000 repeated A/B tests: the 95% CI contains the true ATE in {covered / 10:.1f}% of them")

# 3. Power vs sample size for the true effect, simulated and from the normal formula.
s0, s1 = y0.std(), y1.std()
z = stats.norm.ppf
n80 = (z(0.975) + z(0.80)) ** 2 * (s0 ** 2 + s1 ** 2) / ate ** 2
print(f"sd(y0) = {s0:.2f}, sd(y1) = {s1:.2f}; users per arm for 80% power: {n80:.0f}")
print("n per arm   simulated power   formula power")
for n in (50, 100, 200, 255, 400, 800):
    hits = sum(stats.ttest_ind(*ab_test(n)[::-1], equal_var=False).pvalue < 0.05 for _ in range(1000))
    formula = stats.norm.cdf(ate / np.sqrt((s0 ** 2 + s1 ** 2) / n) - z(0.975))
    print(f"{n:9d}   {hits / 1000:15.3f}   {formula:13.3f}")

# 4. Peeking: 3,000 A/A tests (no effect), 200 new users per arm per day for 20 days.
tests, days, per_day = 3000, 20, 200
a = y0[rng.integers(0, N, (tests, days * per_day))]
b = y0[rng.integers(0, N, (tests, days * per_day))]
pvals = np.empty((tests, days))
for d in range(days):
    m = (d + 1) * per_day
    pvals[:, d] = stats.ttest_ind(b[:, :m], a[:, :m], axis=1, equal_var=False).pvalue
print("A/A tests (no true effect) stopped and declared significant at the first look with p < 0.05:")
for looks in (1, 2, 5, 10, 20):
    days_seen = np.linspace(days / looks, days, looks).astype(int) - 1
    print(f"  {looks:2d} look(s), one every {days // looks:2d} days -> false-positive rate {np.mean((pvals[:, days_seen] < 0.05).any(axis=1)):.1%}")
```

</details>

Reading it, line by line:
- **One test:** the estimate 1.121 is 0.12 above the true 1.000, well inside its interval `[0.767, 1.475]`; the interval by hand (±1.96 SE) and scipy's Welch interval agree to 3 decimals.
- **Coverage:** 948 of 1,000 intervals contain 1.000, the 95 % the procedure promises, give or take sampling noise.
- **Power:** at 50 users per arm the test detects the real effect only 23.2 % of the time; at the planned 255 it detects it 79.4 % of the time (formula 0.800); the normal formula tracks the simulation within 0.01 at every size.
- **Peeking:** the same A/A tests, analysed once at day 20, give 4.5 % false positives, close to the nominal 5 %. Looking every day and stopping at the first p < 0.05 gives 24.3 %, about five times the nominal rate, which is the size of inflation Johari et al. warn about ✅[^5].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Users influence each other (shared feeds, marketplaces) | Control users are partly treated; difference in means is biased | Interference violates SUTVA ✅[^1] |
| "Treatment" varies (different doses, versions) | One average hides several treatments | No hidden variation in treatments is part of SUTVA ✅[^1] |
| Users choose the treatment | Selection bias plus heterogeneous-effect bias (lab: 4.824 vs 1.000) | Mean `Y(0)` differs between the groups ✅[^1]; lab ✅[^6] |
| Arms with different variances | Pooled-variance t-test misstates the SE | Use the unequal-variance statistic with Welch–Satterthwaite `ν` ✅[^2]; `equal_var=False` in scipy ✅[^4] |
| Daily peeking, stop at first p < 0.05 | False positives 24.3 % instead of 5 % in the lab | Repeated looks under a fixed-horizon test ✅[^5]; lab ✅[^6] |
| Effect smaller than planned | Test usually misses it | Power falls steeply with the effect size ✅[^5]; 23.2 % at 50 users in the lab ✅[^6] |
| Many variants or metrics tested at once | More chances for a false positive | Needs multiple-testing control (family-wise error, false discovery rate); always-valid p-values plug into such procedures ✅[^5] |
| A/A test (both arms identical) | Analysed once, rejects near the nominal 5 %; monitored continuously, it can cross the 95 % threshold (Johari et al.'s Figure 1) | Both arms are the same, so every rejection is a Type I error ✅[^5]; lab 4.5 % at one look, 24.3 % at 20 ✅[^6] |
| ATT and ATE differ | A targeted rollout and a full rollout have different payoffs | Heterogeneous effects can make `ATT ≠ ATU`; random assignment makes them equal in large samples ✅[^1] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Fixed-horizon test, one look | Type I error controlled at `α` at the planned `n` ✅[^5]; the simplest analysis | Needs the effect size in advance; must wait the full duration ✅[^5] |
| Always-valid (sequential) inference | Stop any time with Type I error controlled ✅[^5] | A different p-value computation, the mSPRT or similar ✅[^5] |
| Bandit allocation | Shifts traffic to the better arm while learning ✅[^5] | Experimenters still want a confidence interval for arms that lose, which hypothesis testing gives ✅[^5]; see `machine-learning/reinforcement-learning/multi-armed-bandits.md` |
| Observational comparison | No experiment needed | Selection bias whenever the groups differ in `Y(0)` ✅[^1]; adjustment methods in `machine-learning/causal-inference/estimating-effects-from-observational-data.md` |

## Takeaways
- Write down the estimand (ATE, ATT) and the minimum effect worth detecting before the test, then compute `n` per arm from `(z_(1−α/2) + z_(1−β))² · (σ_A² + σ_B²) / δ²`. [rule-candidate]
- Report the difference with its 95 % interval, not only a p-value; use the unequal-variance (Welch) form by default. [rule-candidate]
- Do not stop a fixed-horizon test at the first p < 0.05; look once at the planned end, or use a sequential method built for monitoring. [rule-candidate]
- Run an A/A test on new experiment infrastructure; it should be significant about 5 % of the time.
- A comparison of users who chose a feature with users who did not measures selection as much as effect.

## Verification status
- Verified: 55 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [Causal Inference: The Remix, ch. 3 "Potential Outcomes and Randomization"](https://mixtape.scunning.com/03-potential_outcomes_and_randomization) — Scott Cunningham, living (online 2nd edition). Backs: switching equation, individual effect, fundamental problem (Holland 1986), ATE/ATT/ATU, the decomposition of the simple difference in outcomes, randomization and independence, SUTVA. [^1]
- [NIST/SEMATECH e-Handbook, 7.3.1 "Do two processes have the same mean?"](https://www.itl.nist.gov/div898/handbook/prc/section3/prc31.htm) — NIST, living. Backs: two-sample t statistic without equal variances, Welch–Satterthwaite degrees of freedom. [^2]
- [NIST/SEMATECH e-Handbook, 7.2.2.2 "Sample sizes required"](https://www.itl.nist.gov/div898/handbook/prc/section2/prc222.htm) — NIST, living. Backs: α and β, the sample-size formula, the 8.567 ≈ 9 example, iterating with t. [^3]
- [scipy.stats.ttest_ind](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.ttest_ind.html) — SciPy developers, 2026 (v1.18 manual). Backs: `equal_var=False` is Welch's t-test, `confidence_interval` (added in 1.11.0). [^4]
- [Always Valid Inference: Continuous Monitoring of A/B Tests](https://ar5iv.labs.arxiv.org/html/1512.04922) — Johari, Pekelis, Walsh, 2015 (ar5iv HTML of arXiv:1512.04922). Backs: unreliable inference under continuous monitoring, fivefold Type I error, fixed-horizon coverage, power as a steep function of the effect, always-valid p-values and the mSPRT, A/A tests, multiple testing, bandits vs testing. [^5]
- `machine-learning/lab-setup.md` — the lab where the potential-outcomes, A/B test, power and peeking script ran on 2026-11-25. [^6]
- [NIST/SEMATECH e-Handbook, 7.3.3 "Do two processes produce the same proportion of defectives?"](https://www.itl.nist.gov/div898/handbook/prc/section3/prc33.htm) — NIST, living. Backs: the two-proportion z statistic. [^7]

## Related
- `machine-learning/causal-inference/causal-graphs-and-confounding.md` — why the self-selected comparison is biased, in graph form, and what to adjust for.
- `machine-learning/causal-inference/estimating-effects-from-observational-data.md` — estimating the ATE when randomization is not possible.
- `machine-learning/causal-inference/heterogeneous-treatment-effects.md` — when the average hides users who gain and users who lose.
- `machine-learning/reinforcement-learning/multi-armed-bandits.md` — adaptive allocation instead of a fixed split.
- `machine-learning/probabilistic-ml/bayesian-inference.md` — a posterior over the effect instead of a p-value.
