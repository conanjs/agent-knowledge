---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/supervised-learning
status: verified
applies-to: ["numpy 2.5.5", "scipy 1.18.1", "scikit-survival 0.28.0 docs (not run)", "lifelines 0.30.3 docs (not run)"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, supervised-learning, survival-analysis, time-to-event, censoring, kaplan-meier, log-rank, cox-model, proportional-hazards, hazard-ratio, partial-likelihood, concordance-index]
---

# Survival analysis: censoring, Kaplan–Meier, the log-rank test and the Cox model

## Summary
**TL;DR:** Survival analysis predicts the time until an event (death, failure, churn) when some rows are censored: the event had not happened by the time the row was last seen, so all you know is "later than this". The survival function `S(t)` is the chance of lasting past `t`; the hazard `h(t)` is the event rate among those still at risk. Kaplan–Meier (KM) estimates `S(t)` as a product of "share at risk who did not have the event" over the event times, letting censored rows leave the risk set without causing a drop. The log-rank test compares observed with expected events between groups. The Cox proportional-hazards (PH) model makes the hazard `h₀(t)·exp(x·β)`, so `exp(β)` is a hazard ratio (HR), fitted by a partial likelihood that never needs `h₀(t)`; it assumes the HR is constant over time. Harrell's concordance index (C-index) scores how well a risk score ranks who fails first. Dropping censored rows or calling them events biases survival times toward shorter values and weakens estimated effects.
**Use this when:** your target is a duration that is still running for some rows (time to churn, failure, readmission, conversion); you meet a KM curve, a log-rank p-value, a hazard ratio or a C-index; or you must decide what to do with rows whose event has not happened yet.
**Not this doc:** Poisson regression with an exposure offset, which gives the same fit as a constant-hazard survival model → `machine-learning/supervised-learning/generalized-linear-models.md`; likelihoods and loss functions in general → `machine-learning/foundations/loss-functions-and-maximum-likelihood.md`; metrics for uncensored targets → `machine-learning/evaluation/metrics-catalog.md`; forecasting a series over calendar time → `machine-learning/time-series/time-series-fundamentals.md`.

## Problem
The objective resembles regression (predict a continuous time from covariates), but part of the training data is only partially observed: censored ✅[^1]. A customer still subscribed today has a tenure that is a lower bound, not a value. Two easy fixes both fail. Ignoring the right-censored rows is a common mistake that underestimates lifetimes, and averaging all observed times, censored ones included, still underestimates them ✅[^7]. In the lab, with a true median of 6.93 and 53 % of rows censored, dropping the censored rows gave a median of 3.04 and treating censoring times as events gave 3.97; in a Cox model the same two shortcuts shrank a true log hazard ratio of 0.69 to 0.36 and 0.44 ✅[^21]. Root mean squared error and correlation are unsuitable for scoring such models, because the test data are censored too ✅[^1].

## Mental model
**Analogy:** a relay of monthly hurdles for subscribers. To still be subscribed after month 3 you must clear month 1, then month 2 given you cleared 1, then month 3 given you cleared 2. KM estimates each conditional chance only among the people still in the race at that month: someone whose record stops while still subscribed (censored) counted as "in the race" up to their last month and simply leaves; they never count as a cancellation. The hazard is the hurdle's height: the cancellation rate among those who reached it.

**Artifact:** the KM table for the 21 treated patients of the Gehan leukemia remission data (weeks in remission; 9 relapses, 12 censored), the data Cox analysed in his original paper ✅[^18], computed by the full script in the Worked example. Lab run (`machine-learning/lab-setup.md`), 2026-11-25, numpy 2.5.5, scipy 1.18.1 ✅[^21]:

```text
treated  time  at_risk  deaths  S(t)
            6       21       3  0.8571
            7       17       1  0.8067
           10       15       1  0.7529
           13       12       1  0.6902
           16       11       1  0.6275
           22        7       1  0.5378
           23        6       1  0.4482
```

At week 6, 3 of 21 relapse: `S = 18/21 = 0.8571`. One patient censored at week 6 leaves, so week 7 starts with 17 at risk, not 18: `S = 0.8571 × 16/17 = 0.8067`. Every number matches the published R and Stata output for these data ✅[^17]. The curve stops at 0.4482: the last 5 patients are censored, and a KM curve is usually treated as undefined after a final censored time ✅[^17].

## How it works
### Time-to-event data and censoring
1. **The record.** Each row has covariates `x`, an observed time `y = min(T, C)` (event time `T` or censoring time `C`) and an event indicator `δ = 1` if the event was seen, `0` if censored ✅[^1]. Example: a customer who cancelled after 4 months is `(y=4, δ=1)`; one still subscribed after 7 months is `(y=7, δ=0)`.
2. **Kinds of censoring.** Right censoring (the event is later than `y`) is the most common; left censoring (it happened before `y`) and interval censoring (it happened between two inspections) also occur ✅[^20] ✅[^8]. In reliability testing, stopping at a fixed time `T` is Type I censoring and stopping after a fixed number of failures is Type II ✅[^12].
3. **The assumption everything rests on.** Censoring must be non-informative: a row censored at `t` tells us only that its lifetime exceeds `t`, nothing about its prospects ✅[^15]. Informative censoring biases the analysis like non-ignorable missing data, and there is no definitive test for it; best- and worst-case sensitivity analyses can quantify its effect ✅[^19].
4. **Late entry.** A row that entered observation after its start time (left truncation) needs an entry time; ignoring it makes early survival look too good, because people who failed before they could enter are missing ✅[^8].

### Survival, hazard and cumulative hazard
1. **Survival function:** `S(t) = P(T > t)`, the chance the event has not happened by `t`; it lies between 0 and 1 and never increases ✅[^7], starting from `S(0) = 1` ✅[^14].
2. **Hazard:** `h(t) = lim_{Δt→0} P(t ≤ T ≤ t + Δt | T > t) / Δt`, the event rate at `t` among those still at risk; it equals `−S′(t)/S(t)` ✅[^7], i.e. the density `f(t)` divided by `S(t)` ✅[^14].
3. **Cumulative hazard:** `H(t) = ∫₀ᵗ h(z) dz` and `S(t) = exp(−H(t))`, so `S`, `h` and `H` carry the same information ✅[^7] ✅[^14].
4. **Example, constant hazard (exponential):** `h(t) = λ`, `S(t) = exp(−λt)`, mean `1/λ` ✅[^14]. With `λ = 0.1` per month: `S(5) = exp(−0.5) = 0.6065`, `H(5) = 0.5`, mean 10 months, median `ln 2 / λ = 6.93` (the `t` with `S(t) = 0.5`). The mean is also the area under `S(t)` ✅[^14].
5. **Weibull:** `S(t) = exp(−(t/λ)^ρ)` with scale `λ > 0` and shape `ρ > 0`, cumulative hazard `(t/λ)^ρ` ✅[^8]. Its derivative, the hazard `h(t) = (ρ/λ)(t/λ)^(ρ−1)`, rises over time for `ρ > 1`, and `ρ = 1` is the exponential's constant hazard ✅[^16]; for `ρ < 1` the exponent `ρ − 1` is negative, so the hazard falls. Example: `λ = 5/(ln 2)^(1/ρ)` puts the median at 5 for any shape, the lab's crossing-hazards setup.
6. **Likelihood with censoring:** an event at `tᵢ` contributes the density `S(tᵢ)·h(tᵢ)`, a censored row only `S(tᵢ)`, so `log L = Σᵢ (δᵢ log h(tᵢ) − H(tᵢ))` ✅[^15]. For the exponential this gives `λ̂ = D / Σᵢ tᵢ`, deaths over total exposure time, and the same estimate as a Poisson model for the death count with exposure as an offset ✅[^15]: the bridge to `machine-learning/supervised-learning/generalized-linear-models.md`. In the lab's 53 %-censored sample, `λ̂ = 0.0985`, a mean of 10.15 against the true 10 ✅[^21].

### The Kaplan–Meier estimator
1. **Formula:** `Ŝ(t) = Π_{tᵢ ≤ t} (nᵢ − dᵢ)/nᵢ`, the product over distinct event times `tᵢ`, where `dᵢ` is the number of events at `tᵢ` and `nᵢ` the number at risk just before `tᵢ` ✅[^8]. Sources differ on whether the step at `tᵢ` already counts at `t = tᵢ`: lifelines writes `tᵢ < t`, the NIST (National Institute of Standards and Technology) e-Handbook `≤` ✅[^8] ✅[^13]. R lists the survival just after each time ✅[^17], which is the `≤` form the Gehan table uses ✅[^21].
2. **Who is at risk:** a censored row counts in `nᵢ` up to and including the last event time before it left, not after ✅[^13]; the at-risk count drops by the events and the censorings of the previous interval ✅[^20]. When an event and a censoring tie, the event is taken to happen first ✅[^17].
3. **No model:** KM assumes no distribution (it is non-parametric) but needs exact event times ✅[^13]; beyond non-informative censoring it assumes subjects have the same survival chances whatever the date they entered the study ✅[^19].
4. **Median survival:** the time by which half the group has had the event, read where `Ŝ(t)` reaches 0.5 ✅[^8]. The cumulative hazard has its own non-parametric estimator, Nelson–Aalen: `Ĥ(t) = Σ_{tᵢ ≤ t} dᵢ/nᵢ` ✅[^8].
5. **Uncertainty (Greenwood):** the standard error is `se(Ŝ(t)) = Ŝ(t) · √(Σ_{tᵢ ≤ t} dᵢ/(nᵢ(nᵢ − dᵢ)))`, with `dᵢ` and `nᵢ` as in the KM formula. The sum is the term lifelines accumulates for its exponential Greenwood ("log-log") confidence intervals ✅[^23], and Greenwood's is the most common confidence-interval method in the literature ✅[^19]. Gehan, treated: week 6 gives `0.8571 × √(3/(21 × 18)) = 0.0764`; week 7 adds `1/(17 × 16)`, giving `0.8067 × √(0.007937 + 0.003676) = 0.0869`; both are the published standard errors ✅[^17].

### The log-rank test
1. **Idea:** at each distinct event time, compare the events observed in a group with the number expected if all groups shared one survival curve, then sum over times ✅[^19]. The null hypothesis is identical survival functions; the statistic is approximately chi-squared with `K − 1` degrees of freedom for `K` groups ✅[^6].
2. **Arithmetic:** at each event time with `n` subjects at risk, `n₁` of them in group 1, and `d` deaths, the expected events in group 1 are `d · n₁/n` (the deaths shared out in proportion to the numbers at risk), and the variance adds `d · (n₁/n)(1 − n₁/n)(n − d)/(n − 1)`; these are the per-time terms scikit-survival's `compare_survival` source accumulates ✅[^22]. With `O` the observed and `E` the expected group-1 events summed over the event times and `V` the summed variance, the statistic is `(O − E)²/V`. The R/Stata page cited below prints `O`, `E` and the statistic but not `V`. Gehan, week 1: 42 at risk, 21 of them controls, 2 deaths, so the controls expect `2 × 21/42 = 1.0`. Summed, the controls had 21 relapses against 10.75 expected, `χ² = 16.79`, the published values ✅[^17] ✅[^21].
3. **Weights:** the log-rank test weights every event time equally; Wilcoxon (Gehan–Breslow) weights by the number at risk `nᵢ` and so stresses early differences ✅[^19] ✅[^17]. Tarone–Ware uses `√nᵢ`, Peto–Peto–Prentice `S(tᵢ)` and Fleming–Harrington `S(tᵢ)^p (1 − S(tᵢ))^q` ✅[^17].
4. **When it is strong and weak:** it has maximum power when hazards are proportional, and if the survival curves cross it can misjudge the difference ✅[^11]. It assumes censoring is independent of group, gives a p-value but no effect size, and its p-value matches the one for a categorical factor in a one-variable Cox model ✅[^19].

### The Cox proportional-hazards model
1. **The model:** `h(t | x) = h₀(t) · exp(x·β)`, a baseline hazard `h₀(t)` shared by everyone times a factor that does not depend on time ✅[^16] ✅[^9]. There is no intercept: `h₀(t)` plays that role ✅[^9]. The model is semi-parametric: `h₀(t)` is left unspecified and is not needed to estimate the HR ✅[^19].
2. **Reading `β`:** each coefficient is a log hazard ratio ✅[^1]. For two subjects the HR is `exp((x₁ − x₂)·β)`, the same at every `t` ✅[^20]; one more unit of a covariate with `β = 0.09` multiplies the hazard by `exp(0.09) = 1.10` ✅[^9]. Survival curves follow by powers: `S(t | x) = S₀(t)^exp(x·β)` ✅[^16]; with HR 2, the chance of being alive at `t` is the square of the baseline group's ✅[^16].
3. **Partial likelihood:** given that one subject of the risk set `R_j` (everyone still under observation) fails at event time `T_j`, the chance that it is the subject `j` who actually failed is `exp(x_j·β) / Σ_{i∈R_j} exp(x_i·β)`; `h₀` cancels ✅[^20]. The partial likelihood is the product of these terms over the events, censored rows contributing only through the risk sets ✅[^20]. Gehan, week 1, at `β = −1.509` for "treated": each control has weight 1, each treated `exp(−1.509) = 0.221`, so a control death contributes `1/(21 + 21 × 0.221) = 0.039`.
4. **Fitting:** Newton–Raphson on the log partial likelihood ✅[^20] ✅[^4]; the lab's loop gives `β = −1.5091914` for Gehan, the published Stata/R value ✅[^18] ✅[^21].
5. **Tied event times:** Breslow's method treats tied events as distinct (scikit-survival's default); Efron's is more accurate when ties are many, and the two are close when ties are few ✅[^4]. Rodríguez recommends Efron ✅[^18]. Gehan (17 distinct times for 30 relapses ✅[^18]): Breslow −1.509, Efron −1.572, the exact partial likelihood −1.628 ✅[^18]; the lab reproduces the first two ✅[^21].
6. **Baseline afterwards:** Breslow's estimator `Ĥ₀(t) = Σ_{tᵢ ≤ t} 1/Σ_{j∈Rᵢ} exp(x_j·β)`, one term per observed event (tied events each add one), gives the baseline cumulative hazard and hence survival curves ✅[^20].
7. **Many features:** with many correlated features the Newton step needs a matrix that becomes singular; an L2 (ridge, sum of squared coefficients) penalty, maximizing `log PL(β) − (α/2) Σ β_j²` with `PL` the partial likelihood and `α ≥ 0` the amount of shrinkage, fixes it ✅[^5]. Regularization in general: `machine-learning/foundations/regularization.md`.

### Checking proportional hazards
1. **What is assumed:** each subject's hazard is one shared curve times its own constant, so the ratio of two hazards is constant over time ✅[^10]; hazard curves of groups should then be proportional and not cross ✅[^19].
2. **Scaled Schoenfeld residuals:** Therneau and Grambsch showed that their expectation plus `β̂_j` equals a time-varying coefficient `β_j(t)`; under PH the expectation is 0, so a flat smoothed line over time is good and a trend is a violation ✅[^10]. lifelines' `check_assumptions` tests this against four transforms of time ✅[^10].
3. **Time interaction:** add `x · t` as a covariate; a non-zero coefficient is evidence that the HR changes with time ✅[^19]. Here `t` is the time of each risk set, not a row's own final time: Rodríguez builds it by splitting the data at every failure time or with Stata's `tvc()` ✅[^18], and the script evaluates the covariates at each event time. Cox tried a linear interaction (with `t − 10`) in his original paper; with `t` itself the Gehan coefficient is 0.0008651, no evidence of a change ✅[^18], and the lab reproduces it ✅[^21].
4. **Fixes:** stratify on the offending variable (a separate baseline hazard per stratum, shared coefficients), add non-linear terms, or let the HR differ by time period ✅[^19] ✅[^10].
5. **When it matters:** if the goal is prediction rather than an interpretable HR, PH violations matter less, and with enough data even tiny violations show up as significant ✅[^10]. Under non-proportional hazards the fitted HR is some sort of weighted average of period-specific HRs and can depend critically on the length of follow-up ✅[^9].

### The concordance index (C-index)
1. **Definition (Harrell):** the share of comparable pairs that the risk score orders correctly. A pair is comparable if the subject with the shorter observed time had the event; it is concordant if that subject has the higher predicted risk ✅[^2]. Pairs where both are censored or both failed at the same time are not comparable, and a tie in predicted risk counts 0.5 ✅[^3].
2. **Reading it:** 0.5 is random, 1.0 perfect, 0.0 perfectly wrong, like an AUC (area under the receiver operating characteristic, ROC, curve) ✅[^1]; fitted survival models typically score 0.55–0.75 ✅[^9]. It only ranks: multiplying the scores by a positive constant or adding a constant leaves it unchanged, and a model good at ranking may still predict poor times ✅[^9]. It expects risk scores (higher = sooner), not survival probabilities ✅[^3].
3. **Its limits:** Harrell's estimator gets too optimistic as censoring grows, which Uno's inverse probability of censoring weighting (IPCW) estimator corrects, and it does not focus on a time window of interest, which the time-dependent AUC and the Brier score address ✅[^2]. Example: in a pair where A fails at month 3 and B is censored at month 5, the pair is comparable, and a model that gives A the higher risk scores 1 for it; if B were censored at month 2, nobody knows who failed first and the pair is skipped.

## Worked example
Four simulations and the Gehan checks, all in numpy and scipy (no survival library). Event times are drawn by inverting the survival function, `T = −log(U) / (λ₀ · exp(x·β))` with `U` uniform, the method scikit-survival's simulation study uses ✅[^2]; censoring times are independent of everything. The heart of the Cox fit, for one event time:

```python
# Breslow form of the inner loop (the full script also handles Efron's correction)
w = np.exp(Z @ beta)                                   # every subject's hazard factor
S0, S1, S2 = w[at].sum(), w[at] @ Z[at], (Z[at] * w[at, None]).T @ Z[at]   # sums over the risk set
ll += (Z[dead] @ beta).sum() - d * np.log(S0)          # Breslow: d tied deaths share one denominator
g += Z[dead].sum(0) - d * S1 / S0                      # score; Newton step = information⁻¹ · score
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-25, numpy 2.5.5, scipy 1.18.1, two runs identical; part A's KM rows are the Mental model artifact ✅[^21]:

```text
== A. Gehan leukemia data (Cox 1972): checks against published R/Stata output ==
…
log-rank: control observed 21, expected 10.75, chi2 16.79
Cox breslow: beta -1.5091914  HR 0.2211  se 0.4096  loglik -86.379622 (beta=0: -93.98505)
Cox efron  : beta -1.5721251  HR 0.2076  se 0.4124  loglik -85.008425 (beta=0: -93.18427)
Cox efron + treated x t: beta -1.5813338, 0.0008651  loglik -85.008326
Harrell's C, risk = beta x treated: 0.6898

== B1. one group, exponential hazard 0.1 (true mean 10, median 6.93), censoring ~ Uniform(0, 15) ==
censored share 0.532; MLE rate D/sum(y) = 0.0985 -> mean 10.15
method                    S(5)    S(10)   median  mean of times
truth                     0.6065  0.3679    6.93
Kaplan-Meier              0.6085  0.3782    6.90
drop censored rows        0.2941  0.0535    3.04    3.81
censoring = event         0.4055  0.1115    3.97    4.74

== B2. log-rank rejection rate at alpha 0.05, 400 trials, 100 per group, censoring ~ Uniform(0, 15) ==
true hazard ratio 1.0: rejected in 0.055 of trials
true hazard ratio 1.5: rejected in 0.565 of trials
true hazard ratio 2.0: rejected in 0.975 of trials

== B3. Cox model, true log hazard ratios (0.6931, 0.5000), 2000 train + 1000 test ==
censored share 0.422
partial likelihood, all rows  : beta [0.7198 0.5121]  se [0.0603 0.0324]
drop censored rows            : beta [0.3647 0.2848]
censoring treated as an event : beta [0.4413 0.3265]
with treat x t term           : beta [ 0.776   0.5113 -0.0174]  z of the x t term -0.82
test Harrell's C, fitted Cox           : 0.6503
test Harrell's C, true betas           : 0.6504
test Harrell's C, treatment only       : 0.5809
test Harrell's C, fitted, sign flipped : 0.3497

== B4. crossing hazards: Weibull shape 0.5 vs 2, both medians 5; 1000 per group ==
follow-up  2: Cox HR 0.275  log-rank p 2.70e-35  group x t coef 1.779 (z 8.0)  S0(tau) 0.676  S1(tau) 0.893
follow-up  5: Cox HR 0.960  log-rank p 5.25e-01  group x t coef 0.858 (z 15.4)  S0(tau) 0.539  S1(tau) 0.484
follow-up 20: Cox HR 2.177  log-rank p 9.71e-49  group x t coef 0.349 (z 25.2)  S0(tau) 0.282  S1(tau) 0.000
```

<details><summary>Full script (prints the output above)</summary>

```python
# Survival analysis from scratch (numpy + scipy): Kaplan-Meier, the log-rank test, a Cox model fitted by
# Newton-Raphson on the partial likelihood (Breslow or Efron ties, optional covariate x time), Harrell's C.
# Part A checks the code on the Gehan leukemia data against published R/Stata output; part B is a simulation.
import numpy as np
from scipy.stats import chi2

def km(time, event):                                   # distinct event times, at risk, deaths, S(t)
    ts = np.unique(time[event == 1])
    n = np.array([(time >= t).sum() for t in ts])
    d = np.array([((time == t) & (event == 1)).sum() for t in ts])
    return ts, n, d, np.cumprod(1 - d / n)

def km_at(time, event, t):                             # the step function S(t), right-continuous
    ts, _, _, S = km(time, event)
    i = np.searchsorted(ts, t, side="right") - 1
    return 1.0 if i < 0 else S[i]

def km_median(time, event):                            # first time S(t) <= 0.5
    ts, _, _, S = km(time, event)
    return ts[np.argmax(S <= 0.5)] if (S <= 0.5).any() else np.inf

def logrank(time, event, group):                       # observed and expected events of group 1, chi-square
    O = E = V = 0.0
    for t in np.unique(time[event == 1]):
        at = time >= t
        n, n1 = at.sum(), (at & (group == 1)).sum()
        dead = (time == t) & (event == 1)
        d = dead.sum()
        O += (dead & (group == 1)).sum()
        E += d * n1 / n                                # deaths shared out in proportion to the numbers at risk
        if n > 1:
            V += d * (n1 / n) * (1 - n1 / n) * (n - d) / (n - 1)
    return O, E, (O - E) ** 2 / V

def cox(time, event, cov, ties="breslow", iters=50):
    """Newton-Raphson on the log partial likelihood; cov(t) gives every subject's covariates at time t."""
    ts = np.unique(time[event == 1])
    beta = np.zeros(cov(ts[0]).shape[1])
    for it in range(iters):
        ll, g, I = 0.0, np.zeros_like(beta), np.zeros((beta.size, beta.size))
        for t in ts:
            Z = cov(t)
            at, dead = time >= t, (time == t) & (event == 1)
            d = dead.sum()
            w = np.exp(Z @ beta)
            S0, S1, S2 = w[at].sum(), w[at] @ Z[at], (Z[at] * w[at, None]).T @ Z[at]
            D0, D1, D2 = w[dead].sum(), w[dead] @ Z[dead], (Z[dead] * w[dead, None]).T @ Z[dead]
            ll += (Z[dead] @ beta).sum()
            g += Z[dead].sum(0)
            for l in range(d):                         # Efron removes a share l/d of the tied deaths
                f = l / d if ties == "efron" else 0.0
                s0, s1, s2 = S0 - f * D0, S1 - f * D1, S2 - f * D2
                ll -= np.log(s0)
                g -= s1 / s0
                I += s2 / s0 - np.outer(s1, s1) / s0 ** 2
        if it == 0:
            ll0 = ll
        step = np.linalg.solve(I, g)                   # Newton: information matrix \ score
        if np.abs(step).max() < 1e-10:
            break
        beta = beta + step
    return beta, np.sqrt(np.diag(np.linalg.inv(I))), ll, ll0

def cindex(time, event, risk):                         # Harrell: comparable if the shorter time is an event
    comp = (time[:, None] < time[None, :]) & (event[:, None] == 1)
    conc = comp & (risk[:, None] > risk[None, :])
    tied = comp & (risk[:, None] == risk[None, :])
    return (conc.sum() + 0.5 * tied.sum()) / comp.sum()

print("== A. Gehan leukemia data (Cox 1972): checks against published R/Stata output ==")
ctrl = [1, 1, 2, 2, 3, 4, 4, 5, 5, 8, 8, 8, 8, 11, 11, 12, 12, 15, 17, 22, 23]
trt_t = [6, 6, 6, 6, 7, 9, 10, 10, 11, 13, 16, 17, 19, 20, 22, 23, 25, 32, 32, 34, 35]
trt_e = [1, 1, 1, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0]
time = np.array(ctrl + trt_t, float)
event = np.array([1] * 21 + trt_e)
treated = np.array([0] * 21 + [1] * 21)
ts, n, d, S = km(time[treated == 1], event[treated == 1])
print("treated  time  at_risk  deaths  S(t)")
for row in zip(ts, n, d, S):
    print(f"         {row[0]:4.0f}  {row[1]:7d}  {row[2]:6d}  {row[3]:.4f}")
O, E, X2 = logrank(time, event, 1 - treated)
print(f"log-rank: control observed {O:.0f}, expected {E:.2f}, chi2 {X2:.2f}")
X = treated[:, None].astype(float)
for ties in ("breslow", "efron"):
    b, se, ll, ll0 = cox(time, event, lambda t: X, ties)
    print(f"Cox {ties:7s}: beta {b[0]:.7f}  HR {np.exp(b[0]):.4f}  se {se[0]:.4f}  loglik {ll:.6f} (beta=0: {ll0:.5f})")
b, se, ll, _ = cox(time, event, lambda t: np.column_stack([X, X * t]), "efron")
print(f"Cox efron + treated x t: beta {b[0]:.7f}, {b[1]:.7f}  loglik {ll:.6f}")
b = cox(time, event, lambda t: X, "breslow")[0]
print(f"Harrell's C, risk = beta x treated: {cindex(time, event, X @ b):.4f}")

rng = np.random.default_rng(0)
print("\n== B1. one group, exponential hazard 0.1 (true mean 10, median 6.93), censoring ~ Uniform(0, 15) ==")
T = rng.exponential(10, 2000)
C = rng.uniform(0, 15, 2000)
y, e = np.minimum(T, C), (T <= C).astype(int)
print(f"censored share {1 - e.mean():.3f}; MLE rate D/sum(y) = {e.sum() / y.sum():.4f} -> mean {y.sum() / e.sum():.2f}")
print("method                    S(5)    S(10)   median  mean of times")
print(f"truth                     {np.exp(-0.5):.4f}  {np.exp(-1):.4f}  {10 * np.log(2):6.2f}")
print(f"Kaplan-Meier              {km_at(y, e, 5):.4f}  {km_at(y, e, 10):.4f}  {km_median(y, e):6.2f}")
for name, tt in (("drop censored rows", y[e == 1]), ("censoring = event", y)):
    print(f"{name:25s} {(tt > 5).mean():.4f}  {(tt > 10).mean():.4f}  {np.median(tt):6.2f}  {tt.mean():6.2f}")

print("\n== B2. log-rank rejection rate at alpha 0.05, 400 trials, 100 per group, censoring ~ Uniform(0, 15) ==")
for hr in (1.0, 1.5, 2.0):
    rej = 0
    for _ in range(400):
        g = np.repeat([0, 1], 100)
        T = rng.exponential(10, 200) / np.where(g == 1, hr, 1.0)
        C = rng.uniform(0, 15, 200)
        rej += logrank(np.minimum(T, C), (T <= C).astype(int), g)[2] > chi2.ppf(0.95, 1)
    print(f"true hazard ratio {hr:.1f}: rejected in {rej / 400:.3f} of trials")

print("\n== B3. Cox model, true log hazard ratios (0.6931, 0.5000), 2000 train + 1000 test ==")
def cohort(m, cmax=15):
    Xc = np.column_stack([rng.integers(0, 2, m), rng.normal(size=m)]).astype(float)
    T = -np.log(rng.uniform(size=m)) / (0.1 * np.exp(Xc @ [np.log(2), 0.5]))  # inverse-CDF draw
    C = rng.uniform(0, cmax, m)
    return Xc, np.minimum(T, C), (T <= C).astype(int)
Xtr, ytr, etr = cohort(2000)
Xte, yte, ete = cohort(1000)
print(f"censored share {1 - etr.mean():.3f}")
b, se, _, _ = cox(ytr, etr, lambda t: Xtr)
print(f"partial likelihood, all rows  : beta {b.round(4)}  se {se.round(4)}")
k = etr == 1
print(f"drop censored rows            : beta {cox(ytr[k], etr[k], lambda t: Xtr[k])[0].round(4)}")
print(f"censoring treated as an event : beta {cox(ytr, np.ones_like(etr), lambda t: Xtr)[0].round(4)}")
bt = cox(ytr, etr, lambda t: np.column_stack([Xtr, Xtr[:, :1] * t]))[0:2]
print(f"with treat x t term           : beta {bt[0].round(4)}  z of the x t term {bt[0][2] / bt[1][2]:.2f}")
for name, r in (("fitted Cox", Xte @ b), ("true betas", Xte @ [np.log(2), 0.5]),
                ("treatment only", Xte[:, 0]), ("fitted, sign flipped", -(Xte @ b))):
    print(f"test Harrell's C, {name:21s}: {cindex(yte, ete, r):.4f}")

print("\n== B4. crossing hazards: Weibull shape 0.5 vs 2, both medians 5; 1000 per group ==")
g = np.repeat([0, 1], 1000)
shape = np.where(g == 1, 2.0, 0.5)
T = 5 / np.log(2) ** (1 / shape) * (-np.log(rng.uniform(size=2000))) ** (1 / shape)
Xg = g[:, None].astype(float)
for tau in (2, 5, 20):                                 # administrative end of follow-up
    y, e = np.minimum(T, tau), (T <= tau).astype(int)
    b, se, _, _ = cox(y, e, lambda t: Xg)
    bx = cox(y, e, lambda t: np.column_stack([Xg, Xg * t]))
    p = chi2.sf(logrank(y, e, g)[2], 1)
    print(f"follow-up {tau:2d}: Cox HR {np.exp(b[0]):.3f}  log-rank p {p:.2e}  "
          f"group x t coef {bx[0][1]:.3f} (z {bx[0][1] / bx[1][1]:.1f})  S0(tau) {km_at(y[g == 0], e[g == 0], tau):.3f}  "
          f"S1(tau) {km_at(y[g == 1], e[g == 1], tau):.3f}")
```

</details>

Reading it:
- **A, the code is right.** The log-rank `O`, `E` and `χ²`, the Breslow coefficient and log-likelihoods (−86.379622 at the fit, −93.98505 at `β = 0`), the Efron coefficient and the time-interaction model match the published R/Stata output to every digit printed there ✅[^17] ✅[^18]. The Breslow HR of 0.221 means treatment cut the relapse risk by almost 80 % at any week ✅[^18].
- **B1, censoring handled vs ignored.** With 53 % censored, KM is within 0.011 of the true curve at 5 and 10 months and its median is 6.90 against 6.93. Dropping censored rows keeps only the short times that happened to be observed (median 3.04, `S(10) = 0.05` against 0.37); counting censoring times as events is less wrong but still cuts the median to 3.97. The censored-exponential MLE (maximum likelihood estimate) recovers the mean (10.15 against 10).
- **B2, the log-rank test behaves.** With no real difference it rejects in 5.5 % of 400 trials, close to the nominal 5 %; with HR 1.5 and 100 per group it detects the difference only 56.5 % of the time, with HR 2 in 97.5 %.
- **B3, Cox recovers the truth.** Estimates 0.720 and 0.512 against 0.693 and 0.500, both within half a standard error. The two shortcuts shrink the coefficients by 36–49 % relative to the all-rows fit. The time-interaction `z = −0.82` correctly finds no PH violation. On held-out data the fitted model's C-index (0.6503) matches that of the true coefficients (0.6504): even a perfect model faces noise in the event times that can make a high score impossible ✅[^9]. Treatment alone ranks worse (0.581), and flipping the sign gives exactly `1 − C`.
- **B4, PH violated.** One group's hazard falls over time (shape 0.5), the other's rises (shape 2), with the same median. The single Cox HR is 0.28 with 2 time units of follow-up, 0.96 with 5 and 2.18 with 20: three opposite answers to one question, the dependence on follow-up that lifelines warns about ✅[^9]. At follow-up 5 the log-rank test sees nothing (p = 0.53) although the hazards differ strongly: the survival curves cross at 5, where rank tests have little power ✅[^19]. The time-interaction term flags the problem in all three cases (`z` from 8 to 25).

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Censoring linked to outcome (sicker users stop logging in) | KM and Cox estimates are biased | Non-informative censoring is assumed, and no test can prove it ✅[^19] |
| Rows dropped or censored times used as event times | Times too short, effects shrunk toward zero | Lab: median 3.04 / 3.97 vs 6.93; Cox 0.36 / 0.44 vs 0.69 ✅[^21] |
| Late entry ignored | Early survival overestimated | Those who failed before entry are missing ✅[^8] |
| Last observation censored | KM never reaches 0; usually undefined after that time | No event after the last censoring ✅[^17] |
| Many tied event times | Breslow and Efron differ | Efron more accurate with many ties ✅[^4]; lab Gehan −1.509 vs −1.572 ✅[^21] |
| Survival curves cross | Log-rank loses power; one Cox HR depends on follow-up | ✅[^11] ✅[^19]; lab HR 0.28 → 0.96 → 2.18 ✅[^21] |
| Heavy censoring in test data | Harrell's C becomes too optimistic | Use Uno's IPCW C ✅[^2] |
| Column of ones in the Cox design | Warnings, convergence errors | No intercept in a Cox model ✅[^9] |
| Several failure modes | Analyse one mode, treat others as censoring | Valid for independent modes ✅[^12] |
| Many correlated features | Newton matrix singular | Add a ridge or elastic-net penalty ✅[^5] ✅[^9] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Kaplan–Meier + log-rank | No distributional assumption ✅[^13]; simple group comparison ✅[^6] | Categorical factors only, no effect size ✅[^19]; subgroups get small fast ✅[^1] |
| Cox PH model | HR per covariate without modelling `h₀(t)` ✅[^19] | PH assumption ✅[^10]; HR averages over time if violated ✅[^9] |
| Parametric (exponential, Weibull) | Extrapolates past the last observed time ✅[^8] | Wrong distribution, wrong answers; choose by QQ (quantile–quantile) plots or AIC (Akaike information criterion) ✅[^8] |
| Model trained for C-index | Good rankings ✅[^9] | Not necessarily good predicted times ✅[^9] |

## Takeaways
- Never drop or relabel censored rows; keep `(time, event)` pairs and use a method built for censoring. [rule-candidate]
- Report a KM curve with the numbers at risk and confidence intervals; compare groups with a test, not by eye ✅[^1] ✅[^8].
- Before quoting a Cox hazard ratio, check proportional hazards (time interaction or Schoenfeld residuals); if the hazards cross, report curves or period-specific ratios instead. [rule-candidate]
- The C-index scores ranking only; pair it with a time-specific metric when a horizon matters.

## Verification status
- Verified: 129 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [Introduction to Survival Analysis with scikit-survival](https://scikit-survival.readthedocs.io/en/stable/user_guide/00-introduction.html) — scikit-survival developers, living (0.28.0). Backs: survival analysis as regression with censored targets, `y = min(t, c)` and `δ`, `S(t) = P(T > t)`, coefficients as log hazard ratios, C-index reading and RMSE unsuitability, small subgroups, comparing curves by a test. [^1]
- [Evaluating Survival Models](https://scikit-survival.readthedocs.io/en/stable/user_guide/evaluating-survival-models.html) — scikit-survival developers, living (0.28.0). Backs: comparable and concordant pairs, Harrell's optimism under censoring, Uno's IPCW estimator, time-dependent AUC and Brier score, event-time simulation by inversion. [^2]
- [sksurv.metrics.concordance_index_censored](https://scikit-survival.readthedocs.io/en/stable/api/generated/sksurv.metrics.concordance_index_censored.html) — scikit-survival developers, living (0.28.0). Backs: non-comparable pairs, risk ties count 0.5, risk scores not survival probabilities. [^3]
- [sksurv.linear_model.CoxPHSurvivalAnalysis](https://scikit-survival.readthedocs.io/en/stable/api/generated/sksurv.linear_model.CoxPHSurvivalAnalysis.html) — scikit-survival developers, living (0.28.0). Backs: Newton–Raphson on the partial likelihood, Breslow default, Efron for many ties. [^4]
- [Penalized Cox Models](https://scikit-survival.readthedocs.io/en/stable/user_guide/coxnet.html) — scikit-survival developers, living (0.28.0). Backs: singular matrix with many correlated features, ridge-penalized partial likelihood. [^5]
- [sksurv.compare.compare_survival](https://scikit-survival.readthedocs.io/en/stable/api/generated/sksurv.compare.compare_survival.html) — scikit-survival developers, living (0.28.0). Backs: log-rank null hypothesis, chi-squared with `K − 1` degrees of freedom. [^6]
- [Introduction to survival analysis](https://lifelines.readthedocs.io/en/latest/Survival%20Analysis%20intro.html) — Cam Davidson-Pilon, lifelines 0.30.3, living. Backs: right censoring, ignoring censored rows underestimates, `S`, `h`, `H` definitions and relations. [^7]
- [Estimating univariate models](https://lifelines.readthedocs.io/en/latest/Survival%20analysis%20with%20lifelines.html) — Cam Davidson-Pilon, lifelines 0.30.3, living. Backs: KM and Nelson–Aalen formulas, median, left and interval censoring, left truncation, Weibull form, parametric extrapolation and model selection, confidence intervals and at-risk tables. [^8]
- [Survival regression](https://lifelines.readthedocs.io/en/latest/Survival%20Regression.html) — Cam Davidson-Pilon, lifelines 0.30.3, living. Backs: Cox form and no intercept, HR reading, HR as a follow-up-dependent average, penalties, C-index range, invariance and ranking-only nature. [^9]
- [Testing the proportional hazard assumptions](https://lifelines.readthedocs.io/en/latest/jupyter_notebooks/Proportional%20hazard%20assumption.html) — Cam Davidson-Pilon, lifelines 0.30.3, living. Backs: the PH assumption, scaled Schoenfeld residuals and `β_j(t)`, `check_assumptions`, stratification, when PH matters. [^10]
- [lifelines.statistics](https://lifelines.readthedocs.io/en/latest/lifelines.statistics.html) — Cam Davidson-Pilon, lifelines 0.30.3, living. Backs: log-rank hypotheses, maximum power under PH, crossing curves. [^11]
- [8.1.3.1. Censoring](https://www.itl.nist.gov/div898/handbook/apr/section1/apr131.htm) — NIST/SEMATECH e-Handbook of Statistical Methods, living. Backs: Type I and II censoring, other failure modes as censoring. [^12]
- [8.2.1.5. Kaplan-Meier](https://www.itl.nist.gov/div898/handbook/apr/section2/apr215.htm) — NIST/SEMATECH e-Handbook of Statistical Methods, living. Backs: KM is distribution-free, needs exact times, censored units in the risk set. [^13]
- [7.1 The Hazard and Survival Functions](https://grodri.github.io/glms/notes/c7s1) — Germán Rodríguez, Princeton University, living. Backs: `h = f/S`, `S = exp(−Λ)`, exponential survival and mean, mean as area under `S`. [^14]
- [7.2 Censoring and the Likelihood Function](https://grodri.github.io/glms/notes/c7s2) — Germán Rodríguez, Princeton University, living. Backs: non-informative censoring, the censored log-likelihood, `λ̂ = D/T`, the Poisson equivalence. [^15]
- [7.3 Approaches to Survival Modeling](https://grodri.github.io/glms/notes/c7s3) — Germán Rodríguez, Princeton University, living. Backs: the PH model, `S = S₀^exp(xβ)`, HR 2 squares survival, Weibull hazard rising for shape > 1, exponential as shape 1. [^16]
- [Kaplan-Meier and Mantel-Haenzsel](https://grodri.github.io/survival/gehan) — Germán Rodríguez, Princeton University, living. Backs: Gehan KM tables and their standard errors, event-before-censoring convention, undefined KM after a final censoring, log-rank O, E and 16.79, the weight family. [^17]
- [Cox Proportional Hazards with Two Groups](https://grodri.github.io/survival/cox) — Germán Rodríguez, Princeton University, living. Backs: Gehan in Cox 1972, Breslow, Efron and exact coefficients and log-likelihoods, Efron recommended, 17 failure times, the treated × time model built by splitting at failure times or `tvc()`. [^18]
- [Time-To-Event (TTE) Data Analysis](https://www.publichealth.columbia.edu/research/population-health-methods/time-event-data-analysis) — Columbia University Mailman School of Public Health, living. Backs: non-informative censoring and sensitivity analyses, KM assumptions, Greenwood as the usual confidence-interval method, rank-test weights and limits, log-rank = one-factor Cox p-value, Cox semi-parametric, PH checks and fixes, informative censoring. [^19]
- [Machine Learning for Survival Analysis: A Survey](https://ar5iv.labs.arxiv.org/html/1708.04649) — Wang, Li, Reddy, 2017. Backs: censoring types, at-risk counts, the Cox HR and partial likelihood, Newton–Raphson, Breslow's baseline estimator. [^20]
- `machine-learning/lab-setup.md` — the lab where the Kaplan–Meier, log-rank, Cox and C-index script (Gehan checks and simulations) ran on 2026-11-25. [^21]
- [sksurv/compare.py at v0.28.0](https://github.com/sebp/scikit-survival/blob/v0.28.0/sksurv/compare.py) — scikit-survival developers, 2026. Backs: the log-rank expected-events and per-time variance terms. [^22]
- [lifelines/fitters/kaplan_meier_fitter.py at v0.30.3](https://github.com/CamDavidsonPilon/lifelines/blob/v0.30.3/lifelines/fitters/kaplan_meier_fitter.py) — Cam Davidson-Pilon, 2026. Backs: the Greenwood sum `d/(n(n − d))` behind the exponential Greenwood ("log-log") intervals. [^23]

## Related
- `machine-learning/supervised-learning/generalized-linear-models.md` — Poisson regression with an exposure offset, the same fit as a constant-hazard model.
- `machine-learning/foundations/loss-functions-and-maximum-likelihood.md` — why maximizing a (partial) likelihood is a loss function.
- `machine-learning/supervised-learning/logistic-regression.md` — the other model whose coefficients are log ratios (of odds, not hazards).
- `machine-learning/evaluation/metrics-catalog.md` — metrics for uncensored targets; the C-index here generalizes the ROC AUC.
- `machine-learning/evaluation/cross-validation-and-hyperparameter-search.md` — validating a survival model on held-out rows.
- `machine-learning/ml-systems/data-drift-and-monitoring.md` — when the hazard itself changes after deployment.
