---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/time-series
status: verified
applies-to: ["any"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, time-series, forecasting, naive, seasonal-naive, drift, exponential-smoothing, holt-winters, ets, autoregression, arima, sarima, prediction-intervals]
---

# Classical forecasting models: baselines, exponential smoothing and ARIMA

## Summary
**TL;DR:** Start every forecast with four baselines: the mean, naive (repeat the last value), seasonal naive (repeat the same season last year) and drift (extend the line from the first to the last point); a method that cannot beat them is not worth using. Exponential smoothing forecasts with a weighted average whose weights shrink geometrically into the past; Holt's method adds a trend and Holt-Winters a seasonal component, each with a smoothing parameter fitted by minimizing one-step squared errors. ARIMA (autoregressive integrated moving average) models describe the autocorrelation instead: p past values, d differences, q past errors, plus the same at the seasonal lag for seasonal ARIMA. Each model gives a forecast distribution whose prediction interval widens with the horizon: without bound for a random walk, towards the series' own spread for a stationary model.
**Use this when:** you choose or explain a statistical forecasting method, read parameters such as α, β*, γ, φ or (p,d,q)(P,D,Q)m, implement exponential smoothing or an AR (autoregressive) fit yourself, or judge whether a prediction interval is believable.
**Not this doc:** trend, seasonality, stationarity and the ACF (autocorrelation function) → `machine-learning/time-series/time-series-fundamentals.md`; machine-learning forecasters, MASE (mean absolute scaled error) and quantile intervals → `machine-learning/time-series/forecasting-with-machine-learning.md`.

## Problem
A series with trend and seasonality needs a forecast, and the temptation is to reach for the most flexible model. Two things go wrong without the classical toolbox. First, there is no yardstick: on many series a one-line rule is hard to beat, and Hyndman and Athanasopoulos compare every new method with simple benchmarks and call one that cannot beat them not worth considering ✅[^1]. Second, the method has to match the patterns: in the lab, Holt's trend method scored worse than simply repeating the last value on a trending seasonal series (MAE (mean absolute error) 8.64 against 7.75), while Holt-Winters, which also models the season, scored 1.74 ✅[^4]. And a point forecast alone hides how uncertain it is; point forecasts can be of almost no value without their prediction intervals ✅[^1].

## Mental model
**Analogy:** predicting where a car on a long road will be. *Naive:* where it is now. *Drift:* where it is now plus its average speed so far. *Simple exponential smoothing:* a navigation unit that blends each new, noisy position reading with its previous estimate, trusting the new reading by a fraction α. *Holt:* the unit also tracks the speed. *Holt-Winters:* it also knows the daily traffic pattern. *ARIMA:* it studies how each position relates to the last few positions and to the last few surprises.

**Artifact:** simple exponential smoothing (SES) with α = 0.3, run as a loop and as an explicit weighted sum of the past 60 values; printed by the full script in the Worked example; lab run (`machine-learning/lab-setup.md`), 2026-11-25, numpy 2.5.5 ✅[^4]:

```text
== SES is a weighted average with geometric weights, alpha = 0.3 ==
first 6 weights: [0.3    0.21   0.147  0.1029 0.072  0.0504]  sum of all 60: 0.9999999995
loop level 70.228276  weighted sum 70.228276  difference 0.0e+00
```

The loop `ℓ_t = α·y_t + (1 − α)·ℓ_{t−1}` and the sum `Σ α(1 − α)^j · y_{T−j}` give the same level ✅[^2] ✅[^4]: the newest value weighs 0.3, the one before 0.21, then 0.147, each 0.7 times the previous. The 60 weights sum to `1 − 0.7^60`, and the tiny rest goes to the starting level.

## How it works
### Baselines
1. **The four benchmark methods** ✅[^1]:
   - *Mean:* `ŷ_{T+h|T} = ȳ`, where `ŷ_{T+h|T}` is the forecast for `h` steps after the last observation `T`.
   - *Naive:* `ŷ_{T+h|T} = y_T`. It is optimal when the data follow a random walk, so it is also called the random-walk forecast.
   - *Seasonal naive:* `ŷ_{T+h|T} = y_{T+h−m(k+1)}`, with `m` the seasonal period and `k` the integer part of `(h − 1)/m`: every future February equals the last observed February.
   - *Drift:* `ŷ_{T+h|T} = y_T + h·(y_T − y_1)/(T − 1)`, the line through the first and last observations. Example: `y_1 = 50`, `y_T = 110`, `T = 121` gives a slope of 0.5 and a 12-step forecast of 116.

### Exponential smoothing
2. **Simple exponential smoothing:** `ŷ_{T+1|T} = α·y_T + α(1 − α)·y_{T−1} + α(1 − α)²·y_{T−2} + …` with `0 ≤ α ≤ 1`. A small α puts more weight on the distant past; `α = 1` gives the naive forecast ✅[^2]. In component form, the level `ℓ_t = α·y_t + (1 − α)·ℓ_{t−1}` is the forecast for every horizon: SES forecasts are flat ✅[^2].
3. **Fitting:** choose α and the initial level `ℓ_0` by minimizing the SSE (sum of squared one-step errors `y_t − ŷ_{t|t−1}`); unlike regression this has no closed form, so an optimizer does it ✅[^2].
4. **Holt's linear trend:** forecast `ℓ_t + h·b_t`, level `ℓ_t = α·y_t + (1 − α)(ℓ_{t−1} + b_{t−1})`, slope `b_t = β*(ℓ_t − ℓ_{t−1}) + (1 − β*)·b_{t−1}` with `0 ≤ β* ≤ 1` ✅[^2]. Example: `ℓ = 100`, `b = 2` forecast 106 three steps ahead.
5. **Damped trend:** forecast `ℓ_t + (φ + φ² + … + φ^h)·b_t` with `0 < φ < 1` flattens towards `ℓ_T + φ·b_T/(1 − φ)`; in practice φ is kept between 0.8 and 0.98 ✅[^2]. Example: `φ = 0.9`, `b = 2` adds at most `0.9·2/0.1 = 18`. Holt's undamped trend tends to over-forecast at long horizons, and damped methods are arguably the most popular individual methods when many series must be forecast automatically ✅[^2].
6. **Holt-Winters, additive seasonality** (period m) ✅[^2]:
   - forecast `ŷ_{t+h|t} = ℓ_t + h·b_t + s_{t+h−m(k+1)}`;
   - level `ℓ_t = α(y_t − s_{t−m}) + (1 − α)(ℓ_{t−1} + b_{t−1})`, a blend of the seasonally adjusted value and the non-seasonal one-step forecast;
   - slope as in Holt;
   - season `s_t = γ(y_t − ℓ_{t−1} − b_{t−1}) + (1 − γ)·s_{t−m}`, with the usual restriction `0 ≤ γ ≤ 1 − α`.
   The multiplicative version divides by the seasonal index instead and fits when the swing grows with the level; additive seasonal values sum to about 0 over a year, multiplicative ones to about m ✅[^2].
7. **ETS (error, trend, seasonal) state-space models** put a probability model under each method: they give the same point forecasts plus prediction intervals, and a likelihood, so AICc (Akaike's information criterion, corrected for small samples) can choose among them ✅[^2]. Each method has an additive-error and a multiplicative-error model with identical point forecasts but different intervals ✅[^2]. Example: ETS(A,N,N) is SES with additive errors; its h-step variance is `σ_h² = σ²[1 + α²(h − 1)]`, with `σ²` the residual variance, so `α = 0.3`, `σ = 2`, `h = 5` gives `σ_h = 2.33` ✅[^2].

### ARIMA
8. **AR(p):** `y_t = c + φ_1·y_{t−1} + … + φ_p·y_{t−p} + ε_t`, a regression of the series on its own past with constant `c` and coefficients `φ_i`, and `ε_t` white noise ✅[^3]. Stationarity needs `−1 < φ_1 < 1` for AR(1), and `−1 < φ_2 < 1`, `φ_1 + φ_2 < 1`, `φ_2 − φ_1 < 1` for AR(2) ✅[^3]. With no differencing, `c = μ(1 − φ_1 − … − φ_p)`, where μ is the mean of `y_t` ✅[^3]. An AR(2) cycles when `φ_1² + 4φ_2 < 0`, with average period `2π / arccos(−φ_1(1 − φ_2)/(4φ_2))` ✅[^3]. Example: `y_t = 8 + 1.3·y_{t−1} − 0.7·y_{t−2} + ε_t` has mean `8/0.4 = 20` and, since `1.69 − 2.8 < 0`, cycles every 9.5 steps on average.
9. **MA(q)** (moving-average model of order q): `y_t = c + ε_t + θ_1·ε_{t−1} + … + θ_q·ε_{t−q}`, a regression on past forecast errors with weights `θ_i`, unrelated to moving-average smoothing ✅[^3]. MA(1) is invertible when `|θ_1| < 1`, and any stationary AR(p) can be written as an MA(∞) ✅[^3].
10. **ARIMA(p,d,q):** an autoregression plus a moving-average part on the series differenced d times, written `(1 − φ_1B − … − φ_pB^p)(1 − B)^d y_t = c + (1 + θ_1B + … + θ_qB^q)ε_t` with the backshift operator `B y_t = y_{t−1}` ✅[^3]. White noise is ARIMA(0,0,0) without a constant, the random walk ARIMA(0,1,0) without a constant, the random walk with drift ARIMA(0,1,0) with one ✅[^3].
11. **Fitting and choosing orders:** the parameters are estimated by MLE (maximum likelihood estimation), and different software gives slightly different answers ✅[^3]. AICc picks p and q but cannot compare different d, because differencing changes the data the likelihood is computed on; choose d another way first, for example with the KPSS (Kwiatkowski–Phillips–Schmidt–Shin) unit-root test ✅[^3].
12. **Long-run behaviour** follows from c and d: with `c ≠ 0`, `d = 0` forecasts go to the mean, `d = 1` follow a straight line; with `c = 0`, `d = 1` they go to a constant ✅[^3].
13. **Seasonal ARIMA** `(p,d,q)(P,D,Q)_m` multiplies seasonal terms in `B^m` by the non-seasonal ones, for example ARIMA(1,1,1)(1,1,1)_4: `(1 − φ_1B)(1 − Φ_1B⁴)(1 − B)(1 − B⁴)y_t = (1 + θ_1B)(1 + Θ_1B⁴)ε_t`, where `Φ_1` and `Θ_1` are the seasonal AR and MA coefficients ✅[^3]. Its seasonal part shows at the seasonal lags of the ACF and PACF (partial autocorrelation function) ✅[^3].
14. **ETS or ARIMA:** linear ETS models are special cases of ARIMA, non-linear ETS models have no ARIMA equivalent, and some ARIMA models are stationary while every ETS model is not ✅[^3].

### Forecast uncertainty
15. **Prediction interval:** `ŷ_{T+h|T} ± c·σ_h`, where `σ_h` is the standard deviation of the h-step forecast distribution and `c = 1.96` for 95 % or `1.28` for 80 % under normal errors; intervals usually widen as h grows ✅[^1].
16. **Benchmarks, uncorrelated residuals with standard deviation σ:** mean `σ√(1 + 1/T)`, naive `σ√h`, seasonal naive `σ√(k + 1)`, drift `σ√(h(1 + h/(T − 1)))` ✅[^1]. Example: naive with `σ = 2`, `h = 4` gives `σ_h = 4`, a 95 % half-width of 7.84.
17. **ARIMA:** the one-step 95 % interval is `ŷ ± 1.96σ` for every ARIMA model; for MA(q), `σ_h² = σ²[1 + Σ_{i=1}^{h−1} θ_i²]`, and the MA(∞) form extends this to AR(1) models ✅[^3]; the lab applies the same idea to an AR(2), with the MA(∞) weights `ψ` in place of θ ✅[^4]. For `d = 0` the intervals converge to a fixed width (the long-run spread of the data); for `d ≥ 1` they keep growing ✅[^3].
18. **Why real intervals are too narrow:** they count only the noise, not the uncertainty in the parameters and the model order, and they assume the past patterns continue ✅[^3]. When residuals are uncorrelated but not normal, bootstrap them: simulate many future paths by resampling past residuals and take percentiles ✅[^1].

## Worked example
Two synthetic monthly series of 144 points: **A** with trend `0.4` per month, a 12-month seasonal pattern and noise (standard deviation 2), and **B** a random walk with drift 0.5. Each method is fitted on `y[:o]` and forecasts the next 12 months from 13 rolling origins `o = 96, 99, …, 132` (the forecast origin rolls forward and the model only sees the past ✅[^1]). The script takes the initial level, slope and seasonal values from the first two years and optimizes only the smoothing parameters (scipy's `minimize`, each parameter bounded to [0, 1]); FPP3 (Forecasting: Principles and Practice, 3rd edition) estimates the initial states too ✅[^2]. Then an AR(2) is fitted by least squares and its intervals are checked by simulation. The Holt-Winters core:

```python
sse += (yt - (l + tr + s[i % m])) ** 2            # one-step forecast error
l_new = a * (yt - s[i % m]) + (1 - a) * (l + tr)   # level
s[i % m] = (1 - a) * g * (yt - l - tr) + (1 - (1 - a) * g) * s[i % m]   # season, gamma = (1 - a) g
tr = b * (l_new - l) + (1 - b) * tr                # slope
l = l_new
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-25, Python 3.13.7, numpy 2.5.5, scipy 1.18.1, two runs identical; lines 11–13 are the Mental model artifact ✅[^4]:

```text
== rolling origin: train on y[:o], forecast 12 months, o = 96, 99, ..., 132 (13 origins) ==
method                 A trend+season   B random walk+drift
mean                            25.11                  7.45
naive                            7.75                  2.40
seasonal naive                   4.70                  2.72
drift                            7.12                  2.26
SES                              7.75                  2.30
Holt                             8.64                  2.59
Holt-Winters                     1.74                  2.15
Holt-Winters on A[:132]: alpha 0.091 beta* 0.000 gamma 0.342
== SES is a weighted average with geometric weights, alpha = 0.3 ==
first 6 weights: [0.3    0.21   0.147  0.1029 0.072  0.0504]  sum of all 60: 0.9999999995
loop level 70.228276  weighted sum 70.228276  difference 0.0e+00
== AR(2) y_t = 8 + 1.3 y_t-1 - 0.7 y_t-2 + e, fitted by least squares ==
estimated c, phi1, phi2: [ 7.842  1.326 -0.718]  residual sd: 1.021
stationary: True  mean c/(1-phi1-phi2): 20.0  cycle period: 9.6
== forecast intervals: AR(2) via MA(inf) weights vs naive on a random walk, 20000 futures ==
h= 1  AR(2) 95% half-width  2.00 coverage 0.956  | random walk half-width  3.92 coverage 0.949
h= 3  AR(2) 95% half-width  3.92 coverage 0.959  | random walk half-width  6.79 coverage 0.948
h=10  AR(2) 95% half-width  4.43 coverage 0.960  | random walk half-width 12.40 coverage 0.950
h=30  AR(2) 95% half-width  4.52 coverage 0.962  | random walk half-width 21.47 coverage 0.951
AR(2) series sd x 1.96: 4.52
```

<details><summary>Full script (prints the output above)</summary>

```python
# Classical forecasting in numpy/scipy: mean, naive, seasonal naive and drift baselines; simple,
# Holt and Holt-Winters exponential smoothing fitted by minimizing SSE; a rolling-origin backtest;
# an AR(2) fitted by least squares; prediction intervals checked by simulation.
import numpy as np
from scipy.optimize import minimize
rng = np.random.default_rng(1)
m, T = 12, 144                                     # monthly data, 12 years
t = np.arange(T)
pattern = np.array([-8, -6, -2, 1, 4, 7, 9, 6, 2, -2, -5, -6], float)
series = {"A trend+season": 50 + 0.4 * t + pattern[t % m] + rng.normal(0, 2, T),
          "B random walk+drift": 50 + np.cumsum(0.5 + rng.normal(0, 2, T))}

def ets(y, a, b=None, g=None, H=12):               # one-step SSE and H forecasts; b, g None = no trend, no season
    l, tr = (y[:m].mean(), (y[m:2 * m].mean() - y[:m].mean()) / m) if g is not None else (y[0], y[1] - y[0])
    tr = tr if b is not None else 0.0
    s = (y[:m] - y[:m].mean()).copy() if g is not None else np.zeros(m)
    sse = 0.0
    for i, yt in enumerate(y):
        sse += (yt - (l + tr + s[i % m])) ** 2     # one-step forecast error
        l_new = a * (yt - s[i % m]) + (1 - a) * (l + tr)
        if g is not None:                          # gamma = (1 - alpha) * g keeps 0 <= gamma <= 1 - alpha
            s[i % m] = (1 - a) * g * (yt - l - tr) + (1 - (1 - a) * g) * s[i % m]
        if b is not None:
            tr = b * (l_new - l) + (1 - b) * tr
        l = l_new
    h = np.arange(1, H + 1)
    return sse, l + h * tr + s[(len(y) + h - 1) % m]

def fit(y, k):                                     # k smoothing parameters, each in [0, 1]
    f = lambda p: ets(y, *p, *[None] * (3 - k))[0]
    p = minimize(f, x0=[0.3] * k, bounds=[(0, 1)] * k, method="L-BFGS-B").x
    return p, ets(y, *p, *[None] * (3 - k))[1]

h = np.arange(1, 13)
methods = {"mean": lambda y: np.full(12, y.mean()),
           "naive": lambda y: np.full(12, y[-1]),
           "seasonal naive": lambda y: y[len(y) - m + (h - 1) % m],
           "drift": lambda y: y[-1] + h * (y[-1] - y[0]) / (len(y) - 1),
           "SES": lambda y: fit(y, 1)[1], "Holt": lambda y: fit(y, 2)[1],
           "Holt-Winters": lambda y: fit(y, 3)[1]}
print("== rolling origin: train on y[:o], forecast 12 months, o = 96, 99, ..., 132 (13 origins) ==")
print(f"{'method':<15}" + "".join(f"{n:>22}" for n in series))
for name, f in methods.items():
    maes = [np.mean([np.mean(np.abs(f(y[:o]) - y[o:o + 12])) for o in range(96, 133, 3)]) for y in series.values()]
    print(f"{name:<15}" + "".join(f"{v:>22.2f}" for v in maes))
yA = series["A trend+season"]
p, _ = fit(yA[:132], 3)
print("Holt-Winters on A[:132]: alpha %.3f beta* %.3f gamma %.3f" % (p[0], p[1], (1 - p[0]) * p[2]))

print("== SES is a weighted average with geometric weights, alpha = 0.3 ==")
y, a = yA[:60], 0.3
l = y[0]
for yt in y:
    l = a * yt + (1 - a) * l                       # level equation
wts = a * (1 - a) ** np.arange(len(y))             # weight on y_T, y_{T-1}, ...
print("first 6 weights:", np.round(wts[:6], 4), " sum of all 60:", round(float(wts.sum()), 10))
direct = np.sum(wts * y[::-1]) + (1 - a) ** len(y) * y[0]
print(f"loop level {l:.6f}  weighted sum {direct:.6f}  difference {abs(l - direct):.1e}")

print("== AR(2) y_t = 8 + 1.3 y_t-1 - 0.7 y_t-2 + e, fitted by least squares ==")
n, c, phi, sig = 2100, 8.0, np.array([1.3, -0.7]), 1.0
y = np.full(n, 20.0)
for i in range(2, n):
    y[i] = c + phi[0] * y[i - 1] + phi[1] * y[i - 2] + rng.normal(0, sig)
y = y[100:]                                        # drop burn-in
X = np.column_stack([np.ones(len(y) - 2), y[1:-1], y[:-2]])
coef, *_ = np.linalg.lstsq(X, y[2:], rcond=None)
res = y[2:] - X @ coef
s_hat = np.sqrt(np.sum(res ** 2) / (len(res) - 3))
print("estimated c, phi1, phi2:", np.round(coef, 3), " residual sd:", round(float(s_hat), 3))
f1, f2 = coef[1:]
print("stationary:", bool(-1 < f2 < 1 and f1 + f2 < 1 and f2 - f1 < 1),
      " mean c/(1-phi1-phi2):", round(float(coef[0] / (1 - f1 - f2)), 2),
      " cycle period:", round(float(2 * np.pi / np.arccos(-f1 * (1 - f2) / (4 * f2))), 1))

print("== forecast intervals: AR(2) via MA(inf) weights vs naive on a random walk, 20000 futures ==")
psi = [1.0, f1]
for j in range(2, 40):
    psi.append(f1 * psi[-1] + f2 * psi[-2])
sd_h = s_hat * np.sqrt(np.cumsum(np.square(psi)))  # sigma_h = sigma * sqrt(sum_{i<h} psi_i^2)
paths = np.zeros((20000, 32)); paths[:, 0], paths[:, 1] = y[-2], y[-1]
for i in range(2, 32):
    paths[:, i] = c + phi[0] * paths[:, i - 1] + phi[1] * paths[:, i - 2] + rng.normal(0, sig, 20000)
point = np.zeros(32); point[:2] = y[-2:]
for i in range(2, 32):
    point[i] = coef[0] + f1 * point[i - 1] + f2 * point[i - 2]
rw = np.cumsum(rng.normal(0, 2, (20000, 30)), axis=1)  # random walk futures from y_T = 0, sigma = 2
for hh in [1, 3, 10, 30]:
    ar_cov = np.mean(np.abs(paths[:, hh + 1] - point[hh + 1]) <= 1.96 * sd_h[hh - 1])
    rw_cov = np.mean(np.abs(rw[:, hh - 1]) <= 1.96 * 2 * np.sqrt(hh))
    print(f"h={hh:2d}  AR(2) 95% half-width {1.96 * sd_h[hh - 1]:5.2f} coverage {ar_cov:.3f}"
          f"  | random walk half-width {1.96 * 2 * np.sqrt(hh):5.2f} coverage {rw_cov:.3f}")
print("AR(2) series sd x 1.96:", round(float(1.96 * y.std()), 2))
```

</details>

Reading it, line by line:
- **Series A, baselines:** seasonal naive (4.70) beats naive, drift and mean, but its error is about one year of trend, `12 × 0.4 = 4.8`, because it repeats last year's value unchanged. The mean (25.11) ignores the trend completely.
- **Series A, smoothing:** SES equals naive here (7.75) and Holt is worse (8.64): neither has a seasonal component, and Holt's slope chases the seasonal rises and falls. Holt-Winters models trend and season and gets 1.74, under half the error of seasonal naive.
- **Fitted parameters:** `β* = 0.000` means the slope never moves from its starting value (the true slope is constant), `α = 0.091` updates the level slowly, `γ = 0.342` lets the seasonal values adapt.
- **Series B:** with no season, seasonal naive (2.72) is worse than naive (2.40); drift (2.26) captures the upward walk, and Holt-Winters (2.15) gains little over it.
- **AR(2):** least squares recovers `7.842, 1.326, −0.718` for the true `8, 1.3, −0.7` from 2,000 points; the implied mean is 20.0 and the cycle 9.6 steps, against 9.5 from the true coefficients.
- **Intervals:** the AR(2) half-width grows from 2.00 to 4.52 and stops, at `1.96 ×` the standard deviation of the series (`d = 0`). The random-walk half-width grows as `√h` without limit (`3.92 × √30 = 21.47`). The random-walk intervals cover 0.948–0.951 of 20,000 simulated futures; the AR(2) ones cover 0.956–0.962, slightly more than 95 % because the estimated σ (1.021) and coefficients came out a little larger than the truth.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Seasonal naive on a trending seasonal series | Error about one year of trend (lab 4.70 against `12 × 0.4`) | It repeats last year's value ✅[^1] ✅[^4] |
| Holt on seasonal data without a seasonal term | Worse than naive (lab 8.64 against 7.75) | The slope absorbs the seasonal swings ✅[^4] |
| Undamped trend, long horizon | Over-forecasts | A constant slope forever; damping fixes it ✅[^2] |
| `α = 1` in SES | Exactly the naive forecast | All weight on the last value ✅[^2] |
| Multiplicative-error ETS on data with zeros or negatives | Not considered for such series | Not numerically stable unless the data are strictly positive ✅[^2] |
| ETS(A,N,M), ETS(A,A,M), ETS(A,A_d,M) | Numerical difficulties | Division by values close to zero in the state equations ✅[^2] |
| AICc compared across different d | Meaningless comparison | Each d changes the data the likelihood uses ✅[^3] |
| In-sample "fitted values" of the mean or drift method | Not true forecasts | Their parameter uses all data, including later points ✅[^1] |
| ARIMA intervals at face value | Usually too narrow | Parameter and order uncertainty are ignored ✅[^3] |
| Non-normal residuals | Normal intervals can be wrong | Use bootstrapped intervals ✅[^1] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Mean, naive, seasonal naive, drift | No or one parameter; naive is optimal for a random walk ✅[^1] | Each captures one pattern only |
| Exponential smoothing (ETS) | Reliable forecasts, quickly, for a wide range of series ✅[^2]; intervals and AICc from the state-space model ✅[^2] | Components must match the data; multiplicative errors need strictly positive data ✅[^2] |
| Damped trend | Holt-Winters with a damped trend and multiplicative season often gives accurate, robust forecasts for seasonal data ✅[^2] | Long-run forecasts flatten by design ✅[^2] |
| ARIMA / seasonal ARIMA | Models the autocorrelation directly; includes stationary models ✅[^3] | Orders need choosing; estimation is harder and differs across software ✅[^3] |

## Takeaways
- Always report the four baselines next to any forecasting model; drop the model if it does not beat them. [rule-candidate]
- Pick exponential-smoothing components from what the plot shows: no trend → SES, trend → (damped) Holt, season → Holt-Winters.
- Choose the differencing order d before using AICc for p and q. [rule-candidate]
- Treat model-based prediction intervals as optimistic; check their coverage on held-out data.

## Verification status
- Verified: 61 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [Forecasting: Principles and Practice, 3rd ed., chapter 5: The forecaster's toolbox](https://otexts.com/fpp3/toolbox.html) — Hyndman, Athanasopoulos, OTexts, living. Backs: the four benchmark methods, benchmarks as a yardstick, fitted values vs forecasts, prediction intervals and multipliers, benchmark forecast standard deviations, bootstrapped intervals, rolling forecasting origin. [^1]
- [Forecasting: Principles and Practice, 3rd ed., chapter 8: Exponential smoothing](https://otexts.com/fpp3/exponential-smoothing.html) — Hyndman, Athanasopoulos, OTexts, living. Backs: SES weights and component form, SSE fitting, Holt, damped trend, Holt-Winters, ETS models, the ETS(A,N,N) variance, numerical restrictions. [^2]
- [Forecasting: Principles and Practice, 3rd ed., chapter 9: ARIMA models](https://otexts.com/fpp3/arima.html) — Hyndman, Athanasopoulos, OTexts, living. Backs: AR, MA and ARIMA equations, stationarity and invertibility conditions, mean and cycle formulas, special cases, MLE and AICc, long-run behaviour, seasonal ARIMA, ARIMA intervals, ETS vs ARIMA. [^3]
- `machine-learning/lab-setup.md` — the lab where the baseline, exponential-smoothing, AR(2) and interval-coverage script ran on 2026-11-25. [^4]

## Related
- `machine-learning/time-series/time-series-fundamentals.md` — trend, seasonality, stationarity, differencing and the ACF/PACF these models rest on.
- `machine-learning/time-series/forecasting-with-machine-learning.md` — lag-feature models, backtesting, MASE and quantile intervals; how classical methods fared in the M4 competition.
- `machine-learning/supervised-learning/linear-regression.md` — the least squares used to fit the AR(2).
- `machine-learning/foundations/loss-functions-and-maximum-likelihood.md` — maximum likelihood, used to fit ETS and ARIMA.
- `machine-learning/probabilistic-ml/hidden-markov-models-and-kalman-filters.md` — the Kalman filter, whose steady state is exponential smoothing.
