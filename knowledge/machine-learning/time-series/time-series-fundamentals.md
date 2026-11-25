---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/time-series
status: verified
applies-to: ["any"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, time-series, trend, seasonality, decomposition, moving-average, stationarity, differencing, random-walk, white-noise, autocorrelation, acf, pacf]
---

# Time-series fundamentals: trend, seasonality, stationarity and autocorrelation

## Summary
**TL;DR:** A time series is one quantity measured at regular steps, and its values depend on each other: today is close to yesterday, and this December looks like last December. A decomposition splits a series into a trend (long-term rise or fall), a seasonal pattern (fixed, known period) and a remainder. The ACF (autocorrelation function) measures how strongly the series correlates with its own past at each lag; white noise has no autocorrelation, so about 95 % of its ACF values fall inside ±1.96/√T (T = the series length). A stationary series looks statistically the same whenever you observe it; a random walk is not stationary, and differencing (`y_t − y_{t−1}`) turns it into white noise. Because neighbouring values are not independent, formulas and random splits that assume i.i.d. (independent and identically distributed) rows give answers that are too optimistic.
**Use this when:** you look at a new series before forecasting it, read an ACF or PACF (partial autocorrelation function) plot, decide whether and how to difference, or need to explain why a standard error or a shuffled train/test split misleads on time-ordered data.
**Not this doc:** forecasting methods built on these ideas → `machine-learning/time-series/classical-forecasting-models.md` and `machine-learning/time-series/forecasting-with-machine-learning.md`; how a shuffled split leaks the future into training → `machine-learning/evaluation/data-leakage.md`.

## Problem
Most machine-learning recipes assume rows are independent draws from one fixed distribution. A time series breaks both halves of that assumption: each value is correlated with its neighbours, and the distribution itself can move (a trend lifts the mean, a season repeats every year). Treated as an ordinary table, three things go wrong. A yearly pattern sits on top of the trend and has to be separated from it before either can be read. Statistics computed with i.i.d. formulas are too confident: in the lab, the real spread of the mean of an autocorrelated series was 2.40 times the textbook standard error `s/√T` ✅[^6]. And a shuffled split lets the model train on the future, so its score is too optimistic ✅[^5].

## Mental model
**Analogy:** a city's daily temperature. Tomorrow is usually close to today (autocorrelation); July is warmer than January every year (seasonality); over decades the climate may warm (trend). Today's reading tells you a lot about tomorrow, less about next week, and almost nothing about a day ten years away. White noise is a dice roll each morning: today's roll says nothing about tomorrow's. A random walk is a bank balance that changes each day by a dice roll: tomorrow is today plus a roll, so the balance wanders and never settles around a fixed mean, yet its daily changes are just the dice rolls again.

**Artifact:** the first 24 autocorrelations of four series of length 240 (20 years of monthly values), printed by the full script in the Worked example; lab run (`machine-learning/lab-setup.md`), 2026-11-25, numpy 2.5.5 ✅[^6]:

```text
T = 240, white-noise band = +-0.127
white noise        r_k at lags [1, 2, 3, 6, 12, 24]: [ 0.07  0.06 -0.02  0.02 -0.08  0.13]  outside band: 2/24
random walk        r_k at lags [1, 2, 3, 6, 12, 24]: [0.98 0.96 0.94 0.89 0.75 0.41]  outside band: 24/24
seasonal           r_k at lags [1, 2, 3, 6, 12, 24]: [ 0.81  0.46  0.01 -0.92  0.89  0.84]  outside band: 20/24
diff(random walk)  r_k at lags [1, 2, 3, 6, 12, 24]: [-0.09 -0.03 -0.09  0.05  0.02 -0.02]  outside band: 0/24
```

White noise stays inside the band at 22 of 24 lags ✅[^6]. The random walk's autocorrelations are large, positive and fade slowly, the signature of a trended or otherwise non-stationary series ✅[^1] ✅[^3] ✅[^6]. The seasonal series (period 12) swings to −0.92 at lag 6, half a period, where peaks meet troughs, and back to +0.89 at lag 12 ✅[^1] ✅[^6]. The differences of the same random walk have no autocorrelation left: 0 of 24 lags outside the band ✅[^6].

## How it works
### Components and decomposition
1. **Patterns.** A *trend* is a long-term increase or decrease, not necessarily linear. A *seasonal* pattern comes from calendar factors (time of year, day of week) and always has a fixed, known period; one series can have several. A *cycle* rises and falls without a fixed frequency, in economic data usually over at least 2 years ✅[^1].
2. **Additive or multiplicative.** Additive `y_t = S_t + T_t + R_t` (seasonal, trend-cycle and remainder at period `t`) fits when the seasonal swing does not grow with the level; multiplicative `y_t = S_t × T_t × R_t` fits when it grows in proportion; taking logs turns a multiplicative series into an additive one ✅[^2]. Example: trend 120, July effect +9, remainder −1.2 give `y = 127.8`.
3. **Moving-average trend.** An m-MA (moving average of order m, `m = 2k + 1`) averages the `k` values on each side of `t` and `y_t` itself ✅[^2]. For an even period m, a 2×m-MA (an m-MA followed by a 2-MA) is a weighted average of `m + 1` values with weight `1/m` each, except `1/(2m)` on the two ends; every season then gets the same total weight, so the seasonal pattern averages out ✅[^2]. Monthly data: weights `1/24, 1/12 (×11), 1/24`.
4. **Classical additive decomposition** (from the 1920s) ✅[^2]:
   1. Estimate the trend `T̂_t` with a 2×m-MA (an m-MA if m is odd).
   2. Detrend: `y_t − T̂_t`. Average the detrended values of each season (all Marches together), then shift the m averages so they sum to zero: that is `Ŝ_t`, repeated every year.
   3. Remainder: `R̂_t = y_t − T̂_t − Ŝ_t`.
5. **Its limits.** No trend (and so no remainder) for the first and last m/2 points; rapid rises and falls get over-smoothed; the seasonal pattern is forced to repeat identically every year; unusual values distort it. Hyndman and Athanasopoulos do not recommend it, since much better methods now exist ✅[^2]. STL (Seasonal and Trend decomposition using Loess) handles any period, lets the seasonal pattern change at a rate you set, can be made robust to outliers, and is additive only, so take logs first for multiplicative data ✅[^2].

### Autocorrelation and white noise
6. **The ACF.** `r_k = Σ_{t=k+1..T} (y_t − ȳ)(y_{t−k} − ȳ) / Σ_{t=1..T} (y_t − ȳ)²`, where `T` is the series length, `ȳ` its mean and `k` the lag ✅[^1]. Example: `y = [1, 3, 2, 4]`, `ȳ = 2.5`, deviations `[−1.5, 0.5, −0.5, 1.5]`, denominator `5`, lag-1 numerator `(0.5)(−1.5) + (−0.5)(0.5) + (1.5)(−0.5) = −1.75`, so `r_1 = −0.35`.
7. **Reading it.** A trend gives large positive values that decrease slowly; seasonality gives larger values at multiples of the period; trend plus season gives a slow decay with a scalloped shape ✅[^1].
8. **White noise and the band.** For white noise, expect 95 % of the spikes within `±1.96/√T`. One or more large spikes outside, or clearly more than 5 % of them, suggest the series is not white noise ✅[^1]. Example: `T = 50` gives `±0.28` ✅[^1]; the lab's `T = 240` gives `±0.127` ✅[^6].
9. **Many lags at once.** Checking each spike is many hypothesis tests, so a false alarm or two is expected; a portmanteau test such as Ljung-Box tests the first ℓ autocorrelations as a group; the suggested ℓ is 10 for non-seasonal data and 2m for seasonal data, capped at T/5 ✅[^4].
10. **The PACF.** The k-th partial autocorrelation measures the link between `y_t` and `y_{t−k}` after removing the effect of lags 1 to k−1. It equals the last coefficient of an AR(k) (autoregressive model of order k) fitted to the series, and it uses the same `±1.96/√T` bounds ✅[^3]. Data from an AR(p) model may show an ACF that decays exponentially or like a sine wave, and a PACF with a significant spike at lag p and none beyond ✅[^3]; the lab's AR(1) with coefficient 0.7 gives exactly that shape ✅[^6].

### Stationarity and differencing
11. **Stationary** means the statistical properties do not depend on the time at which you observe the series: trend or seasonality rule it out, white noise is stationary, and a series with only aperiodic cycles is stationary too, because you cannot know in advance where its peaks will fall ✅[^3]. A stationary series' ACF drops to zero quickly; a non-stationary one decays slowly, often with a large positive `r_1` ✅[^3].
12. **Differencing** `y'_t = y_t − y_{t−1}` (T − 1 values) stabilises the mean by removing changes in level; a log transform stabilises the variance ✅[^3]. With the backshift operator `B y_t = y_{t−1}`, a first difference is `(1 − B) y_t` ✅[^3].
13. **Random walk.** If the differences are white noise, `y_t = y_{t−1} + ε_t` (ε, epsilon, white noise): long apparent trends and sudden, unpredictable turns. With drift `c`, `y_t = c + y_{t−1} + ε_t` drifts up for `c > 0` ✅[^3]. In the lab, the variance across 2,000 walks grows with time (10.4, 100.0, 398.6 at t = 10, 100, 400) while the variance of their differences stays near 1 ✅[^6].
14. **Seasonal differences** `y_t − y_{t−m}` remove a seasonal pattern; when both kinds are needed, the order does not change the result, but for strongly seasonal data take the seasonal one first, since it is sometimes enough on its own. Each difference you do not need adds false autocorrelation, so take as few as possible ✅[^3]. The KPSS (Kwiatkowski–Phillips–Schmidt–Shin) unit-root test has "the series is stationary" as its null hypothesis: a small p-value (below 0.05) suggests differencing ✅[^3].

### Why i.i.d. assumptions fail
15. **Neighbours are not independent.** Time-ordered rows are not i.i.d.; in scikit-learn's lagged-features example, a shuffled split scored MAPE (mean absolute percentage error) 0.396 against 0.458 on the first fold of a time-based split, too optimistic ✅[^5]. The mechanism and the fix are in `machine-learning/evaluation/data-leakage.md`.
16. **Standard errors shrink too much.** In the lab, 200 values from an AR(1) with coefficient 0.7 pinned the mean down about as well as `200 × (0.0974 / 0.2335)² ≈ 35` independent values would ✅[^6].
17. **Residuals should be uncorrelated.** A good forecasting method leaves residuals that are uncorrelated and have zero mean; correlation left in the residuals is information the forecasts did not use ✅[^4].

## Worked example
A synthetic monthly series of 240 values with a known trend `100 + 0.5·t`, a known seasonal pattern of 12 values summing to zero, and noise with standard deviation 2, split back into its parts by the classical additive decomposition; the same run also prints the random-walk variance, the AR(1) ACF and PACF, and the standard-error check quoted above. The decomposition's core lines:

```python
w = np.r_[0.5, np.ones(11), 0.5] / 12                 # 2x12-MA weights
trend[6:T - 6] = np.convolve(y, w, mode="valid")     # no estimate for 6 points at each end
s = np.array([np.nanmean((y - trend)[m::12]) for m in range(12)])
s -= s.mean()                                         # the 12 seasonal values sum to zero
remainder = y - trend - s[t % 12]
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-25, Python 3.13.7, numpy 2.5.5, two runs identical; the first five lines are the Mental model artifact ✅[^6]:

```text
== variance of a random walk grows with t (2000 simulated walks) ==
var(y_t) at t = 10, 100, 400: [ 10.4 100.  398.6]
var(diff) at t = 10, 100, 400: [1.02 1.02 0.93]
== AR(1), phi = 0.7: ACF decays, PACF cuts off after lag 1 ==
ACF  lags 1-4: [0.717 0.514 0.366 0.24 ]
PACF lags 1-4: [ 0.717  0.001 -0.006 -0.043]
== classical additive decomposition of a synthetic monthly series ==
trend NaN at the ends: 6 + 6
max |trend error| (middle): 1.356
estimated seasonal: [-7.13 -6.57 -2.37  0.63  4.04  6.82  9.01  5.75  2.38 -2.22 -4.6  -5.74]
true seasonal:      [-8. -6. -2.  1.  4.  7.  9.  6.  2. -2. -5. -6.]
max |seasonal error|: 0.871  remainder std: 1.836 (noise sd 2)
== i.i.d. standard error of the mean vs the real spread, AR(1) phi = 0.7, T = 200 ==
i.i.d. formula s/sqrt(T): 0.0974  real sd of the sample mean: 0.2335  ratio 2.40
```

<details><summary>Full script (prints the output above)</summary>

```python
# Time-series fundamentals in numpy: ACF of white noise, a random walk and a seasonal series
# with the +-1.96/sqrt(T) band; differencing; PACF as the last AR(k) coefficient; a classical
# additive decomposition recovering a known trend and seasonal pattern; why i.i.d. formulas fail.
import numpy as np
rng = np.random.default_rng(0)

def acf(y, nlags):                                 # r_k = sum (y_t - ybar)(y_{t-k} - ybar) / sum (y_t - ybar)^2
    d = y - y.mean()
    return np.array([np.sum(d[k:] * d[:len(y) - k]) for k in range(1, nlags + 1)]) / np.sum(d * d)

def pacf(y, nlags):                                # k-th partial autocorrelation = last coefficient of an AR(k)
    out = []
    for k in range(1, nlags + 1):
        X = np.column_stack([np.ones(len(y) - k)] + [y[k - j:len(y) - j] for j in range(1, k + 1)])
        out.append(np.linalg.lstsq(X, y[k:], rcond=None)[0][-1])
    return np.array(out)

T = 240                                            # 20 years of monthly data
t = np.arange(T)
noise = rng.normal(0, 1, T)
walk = np.cumsum(rng.normal(0, 1, T))
season = 5 * np.sin(2 * np.pi * t / 12) + rng.normal(0, 1, T)
band = 1.96 / np.sqrt(T)
print(f"T = {T}, white-noise band = +-{band:.3f}")
lags = [1, 2, 3, 6, 12, 24]
for name, y in [("white noise", noise), ("random walk", walk), ("seasonal", season),
                ("diff(random walk)", np.diff(walk))]:
    r = acf(y, 24)
    out = int(np.sum(np.abs(r) > band))
    print(f"{name:<18} r_k at lags {lags}: {np.round(r[np.array(lags) - 1], 2)}  outside band: {out}/24")

print("== variance of a random walk grows with t (2000 simulated walks) ==")
walks = np.cumsum(rng.normal(0, 1, (2000, 400)), axis=1)
print("var(y_t) at t = 10, 100, 400:", np.round(walks[:, [9, 99, 399]].var(axis=0), 1))
print("var(diff) at t = 10, 100, 400:", np.round(np.diff(walks, axis=1)[:, [8, 98, 398]].var(axis=0), 2))

print("== AR(1), phi = 0.7: ACF decays, PACF cuts off after lag 1 ==")
ar = np.zeros(2000)
for i in range(1, 2000):
    ar[i] = 0.7 * ar[i - 1] + rng.normal()
print("ACF  lags 1-4:", np.round(acf(ar, 4), 3))
print("PACF lags 1-4:", np.round(pacf(ar, 4), 3))

print("== classical additive decomposition of a synthetic monthly series ==")
true_trend = 100 + 0.5 * t
true_season = np.array([-8, -6, -2, 1, 4, 7, 9, 6, 2, -2, -5, -6], float)   # sums to 0
y = true_trend + true_season[t % 12] + rng.normal(0, 2, T)
w = np.r_[0.5, np.ones(11), 0.5] / 12              # 2x12-MA = weights 1/24, 1/12 (x11), 1/24
trend = np.full(T, np.nan)
trend[6:T - 6] = np.convolve(y, w, mode="valid")
detr = y - trend
s = np.array([np.nanmean(detr[m::12]) for m in range(12)])
s -= s.mean()                                      # adjust so the 12 values sum to zero
remainder = y - trend - s[t % 12]
print("trend NaN at the ends:", int(np.isnan(trend[:6]).sum()), "+", int(np.isnan(trend[-6:]).sum()))
print("max |trend error| (middle):", round(float(np.nanmax(np.abs(trend - true_trend))), 3))
print("estimated seasonal:", np.round(s, 2))
print("true seasonal:     ", true_season)
print("max |seasonal error|:", round(float(np.max(np.abs(s - true_season))), 3),
      " remainder std:", round(float(np.nanstd(remainder)), 3), "(noise sd 2)")

print("== i.i.d. standard error of the mean vs the real spread, AR(1) phi = 0.7, T = 200 ==")
sims = np.zeros((4000, 200))
e = rng.normal(0, 1, (4000, 200))
sims[:, 0] = e[:, 0] / np.sqrt(1 - 0.7 ** 2)       # start in the stationary distribution
for i in range(1, 200):
    sims[:, i] = 0.7 * sims[:, i - 1] + e[:, i]
naive_se = np.mean(sims.std(axis=1, ddof=1) / np.sqrt(200))
real_sd = sims.mean(axis=1).std()
print(f"i.i.d. formula s/sqrt(T): {naive_se:.4f}  real sd of the sample mean: {real_sd:.4f}  ratio {real_sd / naive_se:.2f}")
```

</details>

Reading it, line by line:
- **Random walk variance:** 10.4, 100.0 and 398.6 at t = 10, 100 and 400, close to `t` itself (the steps have variance 1), so the walk has no fixed spread to settle into; its differences stay near 1 at every t, which is what stationary means here.
- **AR(1):** the ACF falls 0.717, 0.514, 0.366, 0.240, while the PACF is 0.717 and then within ±0.05 at lags 2–4: only lag 1 carries direct information, the rest of the ACF is lag 1 passed along.
- **Decomposition, trend:** six missing values at each end, as the 2×12-MA needs six neighbours on each side; elsewhere the estimate is at most 1.356 from the true line.
- **Decomposition, seasonal:** every estimated monthly effect is at most 0.871 from the truth (July `9.01` against `9`), recovered from 19 detrended years of each month.
- **Remainder:** standard deviation 1.84 for noise generated at 2: the remainder is the noise minus whatever the moving average absorbed.
- **i.i.d. standard error:** `s/√T` claims 0.0974, the 4,000 simulated means actually spread with standard deviation 0.2335. A confidence interval built with the i.i.d. formula would be 2.4 times too narrow.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Seasonal swing grows with the level | An additive decomposition is the wrong form | Multiplicative structure; use a multiplicative decomposition or take logs ✅[^2] |
| Aperiodic cycles (business cycle) mistaken for seasonality | The two are often confused | Cycles have no fixed frequency; a season has a fixed calendar period ✅[^1] |
| Trend needed at the last month | Classical decomposition has none for the last m/2 points (lab: 6 + 6 missing) | The centred moving average needs future neighbours ✅[^2] ✅[^6] |
| Seasonal shape changes over decades (winter-peak to summer-peak electricity demand) | Classical decomposition forces one shape on every year | It assumes a constant seasonal component; STL lets it evolve ✅[^2] |
| One ACF spike of white noise outside the band | Can be pure chance (lab: 2 of 24) | 95 % inside means about 1 in 20 outside ✅[^1] ✅[^6] |
| Differenced more than needed | Spurious autocorrelation appears | Extra differences induce false dynamics ✅[^3] |
| Wavy series with no trend or season (lynx counts) | Stationary despite the waves | The cycle timing is not predictable in the long term ✅[^3] |
| Variance grows with the level | Differencing alone leaves the growing spread | Differencing stabilises the mean, logs stabilise the variance ✅[^3] |
| Shuffled split on lagged rows | Score too optimistic | Rows are not i.i.d. ✅[^5] |

## Takeaways
- Plot the series and its ACF before choosing a model; name the trend, seasonal period and cycles you see. [rule-candidate]
- Difference as little as needed: seasonal difference first, re-check the ACF, then a first difference only if still non-stationary.
- Never use i.i.d. standard errors or shuffled splits on time-ordered data. [rule-candidate]
- After fitting, check the residual ACF: a large spike, or clearly more than 1 in 20 spikes, outside ±1.96/√T means the model left information unused.

## Verification status
- Verified: 49 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [Forecasting: Principles and Practice, 3rd ed., chapter 2: Time series graphics](https://otexts.com/fpp3/graphics.html) — Hyndman, Athanasopoulos, OTexts, living. Backs: trend, seasonal and cyclic patterns; the ACF formula; trend and seasonal ACF shapes; white noise and the ±1.96/√T band. [^1]
- [Forecasting: Principles and Practice, 3rd ed., chapter 3: Time series decomposition](https://otexts.com/fpp3/decomposition.html) — Hyndman, Athanasopoulos, OTexts, living. Backs: additive and multiplicative decomposition, moving averages and the 2×m-MA weights, classical decomposition steps and limits, STL. [^2]
- [Forecasting: Principles and Practice, 3rd ed., chapter 9: ARIMA models](https://otexts.com/fpp3/arima.html) — Hyndman, Athanasopoulos, OTexts, living. Backs: stationarity, differencing, random walk, seasonal differences, backshift notation, KPSS, the PACF and AR(p) identification. [^3]
- [Forecasting: Principles and Practice, 3rd ed., chapter 5: The forecaster's toolbox](https://otexts.com/fpp3/toolbox.html) — Hyndman, Athanasopoulos, OTexts, living. Backs: residual properties, portmanteau and Ljung-Box tests. [^4]
- [Lagged features for time series forecasting](https://scikit-learn.org/stable/auto_examples/applications/plot_time_series_lagged_features.html) — scikit-learn developers, 2026 (1.9.1). Backs: i.i.d. assumption failing for time series, shuffled vs time-based MAPE. [^5]
- `machine-learning/lab-setup.md` — the lab where the ACF, random-walk, AR(1), decomposition and standard-error script ran on 2026-11-25. [^6]

## Related
- `machine-learning/time-series/classical-forecasting-models.md` — exponential smoothing and ARIMA, built on these components and on differencing.
- `machine-learning/time-series/forecasting-with-machine-learning.md` — lag features, multi-step strategies and honest backtests.
- `machine-learning/evaluation/data-leakage.md` — temporal leakage from shuffled splits.
- `machine-learning/evaluation/cross-validation-and-hyperparameter-search.md` — `TimeSeriesSplit` and other splitters.
- `machine-learning/supervised-learning/linear-regression.md` — the least squares behind the PACF and AR fits.
- `machine-learning/deep-learning/recurrent-networks.md` — neural networks that read sequences step by step.
