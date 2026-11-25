---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/time-series
status: verified
applies-to: ["scikit-learn 1.9.1", "numpy 2.5.5"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, time-series, forecasting, lag-features, calendar-features, recursive-forecasting, direct-forecasting, backtesting, rolling-origin, mase, smape, pinball-loss, quantile-regression, global-models, m4]
---

# Forecasting with machine learning: lag features, multi-step strategies, backtests and intervals

## Summary
**TL;DR:** A regression model can forecast once the series is turned into a supervised table: each row holds lagged values, rolling statistics and calendar features known at the forecast origin, and the target is a value h steps later. Multi-step forecasts come from one one-step model fed its own predictions (recursive) or from one model per horizon (direct). Judge them only with rolling-origin backtests, which train on the past and test on the future, with a scale-free metric such as MASE (mean absolute scaled error; below 1 means better than the average in-sample one-step seasonal naive forecast) next to RMSE (root mean squared error). Quantile (pinball) loss turns the same learner into prediction intervals, whose coverage must be measured, not assumed. A global model fitted to many related series can afford a longer memory than one model per series; in the M4 competition (the fourth Makridakis forecasting competition), combinations and a statistical/ML (machine learning) hybrid won and the pure ML entries did poorly.
**Use this when:** you build a gradient-boosting or neural forecaster, choose between recursive and direct multi-step forecasting, set up a backtest, pick a forecast metric, build intervals by quantile regression, or decide between one model per series and one model for all.
**Not this doc:** baselines, exponential smoothing and ARIMA (autoregressive integrated moving average) → `machine-learning/time-series/classical-forecasting-models.md`; trend, stationarity and the ACF (autocorrelation function) → `machine-learning/time-series/time-series-fundamentals.md`; the splitters themselves (`TimeSeriesSplit`) → `machine-learning/evaluation/cross-validation-and-hyperparameter-search.md`; why a shuffled split leaks → `machine-learning/evaluation/data-leakage.md`; every metric's scikit-learn function → `machine-learning/evaluation/metrics-catalog.md`.

## Problem
A regression learner needs rows `(X, y)`; a forecast has only a history. The obvious conversions fail without an error message. Shuffled cross-validation trains on the future: in the lab, one gradient-boosting model scored MAE (mean absolute error) 2.51 under shuffled 5-fold and 4.15 when tested only on later data ✅[^16]. Percentage metrics blow up near zero ✅[^3]. An interval from two quantile models covered 57 % of test values where 80 % was intended ✅[^16]. And flexible learners do not win by default: in the M4 competition the six pure ML methods performed poorly, with only one more accurate than Naive2, a seasonally adjusted naive forecast ✅[^9] ✅[^11].

## Mental model
**Analogy:** turning a diary into flashcards. The front of each card shows what was known on one day: the last two weeks of entries, the weekly and monthly averages, the weekday. The back shows what happened h days later. A regression model studies the cards. *Recursive:* learn only "tomorrow" cards and chain them, using each answer as the newest diary entry. *Direct:* a separate deck for every h. A fair exam uses only cards from days after the study period.

**Artifact:** the first row of the one-step table built from a daily series (weekly season, trend, autocorrelated noise), printed by the full script in the Worked example; lab run (`machine-learning/lab-setup.md`), 2026-11-25, scikit-learn 1.9.1 ✅[^16]:

```text
supervised table: 674 rows x 17 columns (13 lags - last, 3 means - last, weekday)
first row, lags - last: [ -9.8 -11.5 -13.5 -14.6 -10.6  -5.2   0.2 -16.  -11.7  -8.3 -12.4 -10.8  -1.7]
first row, means - last: [ -8.7  -9.8 -10.6] weekday 0 target -8.95
```

Every feature is computed from values at or before the origin and expressed relative to the last value, so the model learns changes, not levels: 12 of the 13 lags sit 1.7 to 16 below the last value (the origin is a weekend peak), the target day's weekday is 0, and the target is the next day's change, −8.95.

## How it works
### Building the table
1. **Lag and window features:** shifted copies of the target (1, 2, 3 hours, 1 day, 7 days back) and rolling mean, max and min over windows that end one step before the target; the first rows have undefined values because their own past is missing ✅[^1].
2. **Calendar features** such as hour, weekday and month ✅[^2] can be computed for any future date, so they are known at the origin: the lab script derives the target day's weekday from its index ✅[^16]. A linear model cannot use a raw hour number whose effect rises in the morning and falls in the evening; one-hot columns, a sine/cosine pair or periodic splines encode it, and a sine/cosine pair maps the 24 hours onto a circle so hour 23 sits next to hour 0 ✅[^2]. Example: hour 6 → `(sin 2π·6/24, cos 2π·6/24) = (1, 0)`, hour 18 → `(−1, 0)`. `HistGradientBoostingRegressor` handles categorical columns natively ✅[^2].
3. **Levels vs changes:** decision trees predict piecewise constants and are not good at extrapolation ✅[^17]. In the lab, boosted trees on raw levels of a trending series scored MAE 4.15 on later data, against 2.26 with lags and rolling means expressed relative to the last value and a target of change ✅[^16]. Another fix is to deseasonalize before the ML model: it improved accuracy uniformly in a study on the 111 daily cash-withdrawal series of the NN5 forecasting competition ✅[^8], and a comparison on monthly series from the earlier M3 competition recommends it ✅[^14].

### Multi-step strategies
4. **Recursive:** iterate a one-step model H times, feeding each forecast back as an input ✅[^8]; the neural network autoregression of FPP3 (Forecasting: Principles and Practice, 3rd edition) forecasts this way ✅[^15]. Errors accumulate with the horizon, worst once h exceeds the number of lags and every input is a forecast ✅[^8].
5. **Direct:** train one model per horizon h on targets h steps ahead. Nothing is fed back, so errors do not accumulate, but the H models are fitted independently, forecasts can form a broken curve, and the cost is H fits ✅[^8].
6. **Others:** DirRec (direct models that also take earlier-step forecasts as inputs) and MIMO (multi-input multi-output: one model outputs the whole H-vector) ✅[^8]. Published comparisons of recursive and direct disagree; in the NN5 study multiple-output strategies were best ✅[^8].

### Backtesting on a rolling origin
7. **Rolling forecasting origin:** many test sets, each forecast from a training set made only of earlier observations, with accuracy averaged over them; the multi-step version scores h-step-ahead errors ✅[^3]. A single test set should ideally be at least as long as the longest horizon needed ✅[^3]. Residual-based accuracy looks better than this, because in-sample fitted values are not true forecasts ✅[^3].
8. **In scikit-learn,** `TimeSeriesSplit` builds such folds (details in the cross-validation doc); the lagged-features example sets a 2-day `gap` between training and test data, caps the training size and fixes the test size ✅[^1].

### Metrics
9. **Scale-dependent:** MAE and RMSE use the data's units, so they cannot compare series measured in different units; minimizing MAE leads to median forecasts, minimizing RMSE to mean forecasts ✅[^3].
10. **Percentage errors:** MAPE (mean absolute percentage error) is infinite or undefined when an actual value is 0, extreme near 0, and meaningless without a true zero (temperature in °C) ✅[^3]. sMAPE (symmetric MAPE) `= mean(200·|y_t − ŷ_t| / (y_t + ŷ_t))` is still unstable near zero and can be negative; Hyndman and Koehler recommend not using it ✅[^3]. The N-BEATS (neural basis expansion analysis for time series) paper, reporting M4 results, defines sMAPE with `|y_t| + |ŷ_t|` in the denominator ✅[^11]. Lab: for an actual of 100, forecasting 150 costs 40.0 but forecasting 50 costs 66.7 ✅[^16].
11. **MASE:** scale each test error by the in-sample MAE of the one-step seasonal naive forecast, `q_j = e_j / ((1/(T − m)) Σ_{t=m+1..T} |y_t − y_{t−m}|)`, where `T` is the training length and `m` the period, then `MASE = mean(|q_j|)` ✅[^3]. With the naive scale, a scaled error below 1 means a better forecast than the average one-step naive forecast on the training data ✅[^3]; with the seasonal scale, the yardstick is the one-step seasonal naive forecast. Example: the lab's scale is 4.257, so a test MAE of 3.62 is MASE 0.850 ✅[^16].
12. **OWA (overall weighted average),** M4's ranking metric: `½(sMAPE/sMAPE_Naive2 + MASE/MASE_Naive2)`, normalized so the seasonally adjusted naive forecast (Naive2) scores 1.0 ✅[^11]. M4 ranked point forecasts by OWA and 95 % intervals by MSIS ✅[^10]. MSIS (mean scaled interval score) is a Winkler-type interval score (interval width plus a penalty of 2/α times the miss) ✅[^3], averaged over the horizon and divided by the in-sample seasonal naive MAE, as MASE does for point errors ✅[^18].

### Prediction intervals from quantile loss
13. **Pinball loss:** `(1/n) Σ_i [α·max(y_i − ŷ_i, 0) + (1 − α)·max(ŷ_i − y_i, 0)]`, where α is the target quantile and n the number of points; at α = 0.5 it is half the MAE ✅[^5]. It is non-negative with best value 0, and α = 0.95 is minimized by estimators of the 95th percentile ✅[^4]. FPP3's quantile score doubles it so that p = 0.5 equals the absolute error ✅[^3]. Example: α = 0.9, actual 10: forecasting 8 costs `0.9 × 2 = 1.8`, forecasting 12 costs `0.1 × 2 = 0.2`, so a high quantile is pushed up.
14. **Fitting:** `HistGradientBoostingRegressor(loss="quantile", quantile=α)` boosts on the pinball loss (since 1.1) ✅[^6]; train and score with the same loss, `mean_pinball_loss(..., alpha=α)`, noting the different argument names ✅[^5].
15. **An interval is two quantiles:** the 5 % and 95 % models give a 90 % interval ✅[^7]. In scikit-learn's example the tuned interval covered 0.903 of the training set but 0.796 of the test set, and the hyperparameters that suit the median need not suit the 5th percentile ✅[^7]. The Winkler score and CRPS (continuous ranked probability score) score intervals and whole distributions ✅[^3]; simulation with bootstrapped residuals is the alternative for models without a stochastic form ✅[^15].

### Global models
16. **Local vs global:** a local approach fits one function per series; a global approach fits one function to all series in the set ✅[^13]. Montero-Manso and Hyndman show global methods are not more restrictive than local ones, that the complexity of local methods grows with the number of series while a global one's stays constant, and that this allows much longer memory; global linear models fitted by least squares were competitive with far fewer parameters ✅[^13].
17. **DeepAR** trains one autoregressive RNN (recurrent neural network) on many related series, divides each series' inputs by an item-dependent scale (`ν_i = 1 +` the series' mean) to cope with magnitudes spread over orders of magnitude, returns Monte Carlo sample paths from which quantiles follow, and can forecast items with little or no history ✅[^12]. Its abstract reports accuracy improvements of around 15 % over the state of the art on several datasets ✅[^12].
18. **Lab, local vs global:** 40 short monthly series (60 training months, scales from 11 to 1031), each divided by its mean, forecast 12 months recursively with a linear AR(p) (autoregression on p lags) ✅[^16]:

```text
40 series, 60 training months each, scales 11 to 1031
seasonal naive          MASE 0.944
AR(12) rows per series 48, parameters 13:  local MASE    0.612  global MASE 0.956
AR(24) rows per series 36, parameters 25:  local MASE    1.024  global MASE 0.730
AR(36) rows per series 24, parameters 37:  local MASE    0.936  global MASE 0.561
```

<details><summary>Full script (prints the output above)</summary>

```python
# Local vs global linear autoregressions on 40 short related monthly series (numpy least squares):
# one AR(p) per series vs one AR(p) fitted to all series at once after scaling each by its mean.
import numpy as np
rng = np.random.default_rng(3)
N, T, m, H = 40, 72, 12, 12                        # 40 series, 6 years monthly, forecast the last year
t = np.arange(T)
shape = np.sin(2 * np.pi * t / m) + 0.5 * np.cos(4 * np.pi * t / m)
Y = np.zeros((N, T))
for i in range(N):
    e = np.zeros(T)
    for k in range(1, T):
        e[k] = 0.5 * e[k - 1] + rng.normal(0, 0.03)
    Y[i] = 10 ** rng.uniform(1, 3) * (1 + rng.uniform(-0.005, 0.015) * t + rng.uniform(0.1, 0.3) * shape + e)
train, test = Y[:, :T - H], Y[:, T - H:]
scale_i = train.mean(1, keepdims=True)             # per-series scale, so all series share one model
Z = train / scale_i
mase_den = np.mean(np.abs(train[:, m:] - train[:, :-m]), axis=1)   # in-sample seasonal naive MAE

def rows(z, p):                                    # lag matrix [1, z_{t-1}, ..., z_{t-p}] -> z_t
    X = np.column_stack([np.ones(len(z) - p)] + [z[p - j:len(z) - j] for j in range(1, p + 1)])
    return X, z[p:]
def forecast(z, coef, p):                          # recursive H-step forecast
    hist = list(z)
    for _ in range(H):
        hist.append(coef[0] + coef[1:] @ np.array(hist[-1:-p - 1:-1]))
    return np.array(hist[-H:])
def mase(F):
    return np.mean(np.mean(np.abs(F - test), axis=1) / mase_den)

print(f"{N} series, {T - H} training months each, scales {train.mean(1).min():.0f} to {train.mean(1).max():.0f}")
print(f"seasonal naive          MASE {mase(train[:, -m:]):.3f}")
for p in (12, 24, 36):
    local = np.stack([forecast(Z[i], np.linalg.lstsq(*rows(Z[i], p), rcond=None)[0], p) for i in range(N)])
    Xs, zs = zip(*[rows(Z[i], p) for i in range(N)])
    g = np.linalg.lstsq(np.vstack(Xs), np.concatenate(zs), rcond=None)[0]
    glob = np.stack([forecast(Z[i], g, p) for i in range(N)])
    print(f"AR({p:2d}) rows per series {T - H - p:2d}, parameters {p + 1:2d}:"
          f"  local MASE {mase(local * scale_i):8.3f}  global MASE {mase(glob * scale_i):.3f}")
```

</details>

   Local AR models are best at 12 lags (MASE 0.612) and get worse with more: 36 rows for 25 parameters overfit, and 24 rows cannot even determine 37. The global model improves as lags are added and reaches 0.561 with 36 lags, a memory no single series here could support. With 12 lags it is worse than the local models (0.956); it needs the longer memory to match them, the pattern Montero-Manso and Hyndman describe ✅[^13].

### What the competitions found
19. **M4** used 100,000 real series and included ML and statistical methods ✅[^10]. Its five findings: 12 of the 17 most accurate methods were combinations of mostly statistical approaches; the most accurate was a hybrid of statistical and ML features whose sMAPE was close to 10 % better than the combination benchmark ✅[^9] ✅[^11]; the second combined seven statistical methods and one ML method, with weights set by an ML algorithm; the two best also specified 95 % intervals well; the six pure ML methods performed poorly ✅[^9]. The winner combined a residual dilated LSTM (long short-term memory) stack with a Holt-Winters model, and the pure ML entries ranked 23, 37, 38, 48, 54 and 57 of 60 ✅[^11].
20. **Afterwards,** N-BEATS, a deep stack of fully connected layers whose generic configuration uses no time-series-specific components, reported 3 % better accuracy than the M4 winner ✅[^11]. On 1,045 monthly M3 series, popular ML methods were dominated by eight statistical ones on both accuracy measures and all horizons, at greater computational cost ✅[^14].

## Worked example
A daily series of 1,100 days: trend `0.05` per day, a weekly pattern (`+9` and `+11` at the weekend), AR(1) noise with coefficient 0.8. Gradient-boosting models train on the first 730 days; 356 rolling origins in the last year each forecast 14 days, using data up to the origin only. Recursive and direct forecasts are compared with seasonal naive, then scored with MAE, RMSE, MASE and sMAPE; quantile models give a 7-day-ahead 80 % interval; last, the same one-step model is scored by shuffled and by time-ordered folds. The recursive loop:

```python
for k in range(H):                       # feed each prediction back as the newest value
    nxt = win[:, -1] + one_step.predict(feats(win, (origins + k + 1) % m))
    rec[:, k] = nxt
    win = np.column_stack([win[:, 1:], nxt])
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-25, Python 3.13.7, scikit-learn 1.9.1, numpy 2.5.5, two runs identical; lines 1–3 are the Mental model artifact ✅[^16]:

```text
MASE scale (training MAE of seasonal naive): 4.257
== MAE by horizon, 356 rolling origins ==
h                1      2      3      7     14
recursive     2.33   3.06   3.48   3.76   3.69
direct        2.33   3.10   3.52   3.86   3.81
seas.naive    4.45   4.45   4.43   4.40   4.89
== all horizons: MAE, RMSE, MASE, sMAPE (%) ==
direct      MAE  3.62  RMSE  4.50  MASE 0.850  sMAPE  2.42
seas.naive  MAE  4.67  RMSE  5.75  MASE 1.096  sMAPE  3.13
naive       MAE  6.33  RMSE  7.90  MASE 1.488  sMAPE  4.23
sMAPE one point, actual 100: forecast 150 -> 40.0  forecast 50 -> 66.7
== quantile models, 7 days ahead: interval [q0.1, q0.9] ==
default trees: share of actuals below q0.1 0.242, q0.5 0.537, q0.9 0.812
  coverage test 0.570  train 0.750  mean width 7.42  pinball q0.1 0.953 q0.9 0.933
shallow trees: share of actuals below q0.1 0.157, q0.5 0.514, q0.9 0.860
  coverage test 0.702  train 0.780  mean width 9.87  pinball q0.1 0.828 q0.9 0.833
shallow median: pinball(alpha=0.5) 1.8590 = MAE/2 1.8590
== same one-step model scored two ways (whole series) ==
raw-level lags,   shuffled 5-fold    MAE 2.51
raw-level lags,   TimeSeriesSplit(5) MAE 4.15
lags minus last,  TimeSeriesSplit(5) MAE 2.26
```

<details><summary>Full script (prints the output above)</summary>

```python
# Forecasting with gradient boosting on lag and calendar features (scikit-learn): a supervised
# table built from one series, recursive vs direct multi-step forecasts, a rolling-origin
# backtest scored with MAE, RMSE, MASE and sMAPE, quantile models and their coverage, and a
# shuffled k-fold score compared with a time-ordered one.
import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor as HGB
from sklearn.metrics import mean_pinball_loss
from sklearn.model_selection import KFold, TimeSeriesSplit, cross_val_score
np.set_printoptions(linewidth=120)
rng = np.random.default_rng(2)
T, m, L, H, CUT = 1100, 7, 56, 14, 730             # days, weekly season, window, horizon, train end
weekly = np.array([0, 1, 2, 2, 3, 9, 11], float)  # day-of-week effect
ar = np.zeros(T)
for i in range(1, T):
    ar[i] = 0.8 * ar[i - 1] + rng.normal(0, 2.5)  # AR(1) noise: recent values carry information
t = np.arange(T)
y = 100 + 0.05 * t + weekly[t % m] + ar

def feats(win, dow):                               # win: last L values up to the origin; dow: target weekday
    last = win[:, -1:]
    means = [win[:, -k:].mean(1, keepdims=True) - last for k in (7, 28, 56)]
    return np.column_stack([win[:, -14:-1] - last] + means + [dow])
def table(h, origins):                             # rows: features at origin o, target y[o+h] - y[o]
    win = np.stack([y[o - L + 1:o + 1] for o in origins])
    return feats(win, (origins + h) % m), y[origins + h] - y[origins]
model = lambda **kw: HGB(categorical_features=[16], random_state=0, **kw)

X1, z1 = table(1, np.arange(L - 1, CUT - 1))
print("supervised table:", X1.shape[0], "rows x", X1.shape[1], "columns (13 lags - last, 3 means - last, weekday)")
print("first row, lags - last:", np.round(X1[0, :13], 1))
print("first row, means - last:", np.round(X1[0, 13:16], 1), "weekday", int(X1[0, 16]), "target", round(float(z1[0]), 2))
one_step = model().fit(X1, z1)
direct = {h: model().fit(*table(h, np.arange(L - 1, CUT - h))) for h in range(1, H + 1)}

origins = np.arange(CUT, T - H)                    # rolling origins in the last year; models never see them
win = np.stack([y[o - L + 1:o + 1] for o in origins])
rec = np.zeros((len(origins), H))
for k in range(H):                                 # recursive: feed each prediction back as the newest value
    nxt = win[:, -1] + one_step.predict(feats(win, (origins + k + 1) % m))
    rec[:, k] = nxt
    win = np.column_stack([win[:, 1:], nxt])
dirf = np.column_stack([y[origins] + direct[h].predict(table(h, origins)[0]) for h in range(1, H + 1)])
truth = np.stack([y[o + 1:o + H + 1] for o in origins])
hh = np.arange(1, H + 1)
snaive = np.stack([y[o + hh - m * (1 + (hh - 1) // m)] for o in origins])
naive = np.repeat(y[origins][:, None], H, axis=1)
scale = np.mean(np.abs(y[m:CUT] - y[:CUT - m]))   # in-sample MAE of the one-step seasonal naive forecast
print(f"MASE scale (training MAE of seasonal naive): {scale:.3f}")
print(f"== MAE by horizon, {len(origins)} rolling origins ==")
print("h          " + "".join(f"{h:>7d}" for h in [1, 2, 3, 7, 14]))
for name, f in [("recursive", rec), ("direct", dirf), ("seas.naive", snaive)]:
    print(f"{name:<11}" + "".join(f"{np.mean(np.abs(f - truth)[:, h - 1]):7.2f}" for h in [1, 2, 3, 7, 14]))
print("== all horizons: MAE, RMSE, MASE, sMAPE (%) ==")
for name, f in [("direct", dirf), ("seas.naive", snaive), ("naive", naive)]:
    e = f - truth
    smape = np.mean(200 * np.abs(e) / (np.abs(truth) + np.abs(f)))
    print(f"{name:<11} MAE {np.mean(np.abs(e)):5.2f}  RMSE {np.sqrt(np.mean(e ** 2)):5.2f}  "
          f"MASE {np.mean(np.abs(e)) / scale:5.3f}  sMAPE {smape:5.2f}")
print("sMAPE one point, actual 100: forecast 150 ->", round(200 * 50 / 250, 1), " forecast 50 ->", round(200 * 50 / 150, 1))

print("== quantile models, 7 days ahead: interval [q0.1, q0.9] ==")
Xq, zq = table(7, np.arange(L - 1, CUT - 7))
Xt, zt = table(7, origins)
yt = y[origins + 7]
for label, kw in [("default trees", {}),
                  ("shallow trees", dict(max_depth=3, min_samples_leaf=40, learning_rate=0.05, max_iter=200))]:
    fits = {a: model(loss="quantile", quantile=a, **kw).fit(Xq, zq) for a in (0.1, 0.5, 0.9)}
    q = {a: y[origins] + f.predict(Xt) for a, f in fits.items()}
    tr = {a: f.predict(Xq) for a, f in fits.items()}
    print(f"{label}: share of actuals below q0.1 {np.mean(yt < q[0.1]):.3f}, q0.5 {np.mean(yt < q[0.5]):.3f},"
          f" q0.9 {np.mean(yt < q[0.9]):.3f}")
    print(f"  coverage test {np.mean((yt >= q[0.1]) & (yt <= q[0.9])):.3f}  train {np.mean((zq >= tr[0.1]) & (zq <= tr[0.9])):.3f}"
          f"  mean width {np.mean(q[0.9] - q[0.1]):.2f}  pinball q0.1 {mean_pinball_loss(yt, q[0.1], alpha=0.1):.3f}"
          f" q0.9 {mean_pinball_loss(yt, q[0.9], alpha=0.9):.3f}")
print(f"shallow median: pinball(alpha=0.5) {mean_pinball_loss(yt, q[0.5], alpha=0.5):.4f} = MAE/2 {np.mean(np.abs(yt - q[0.5])) / 2:.4f}")

print("== same one-step model scored two ways (whole series) ==")
o_all = np.arange(L - 1, T - 1)
Xraw = np.column_stack([np.stack([y[o - 15:o + 1] for o in o_all]), (o_all + 1) % m])  # 16 raw levels + weekday
yraw = y[o_all + 1]
Xrel, zrel = table(1, o_all)
mae = lambda X, z, cv: -cross_val_score(model(), X, z, cv=cv, scoring="neg_mean_absolute_error").mean()
print(f"raw-level lags,   shuffled 5-fold    MAE {mae(Xraw, yraw, KFold(5, shuffle=True, random_state=0)):.2f}")
print(f"raw-level lags,   TimeSeriesSplit(5) MAE {mae(Xraw, yraw, TimeSeriesSplit(5)):.2f}")
print(f"lags minus last,  TimeSeriesSplit(5) MAE {mae(Xrel, zrel, TimeSeriesSplit(5)):.2f}")
```

</details>

Reading it, line by line:
- **Horizon:** both strategies use the same model at h = 1 (MAE 2.33); error then grows with h up to h = 7 (3.76 recursive, 3.86 direct) and levels off (3.69, 3.81 at h = 14), because the noise's memory fades. Seasonal naive stays near 4.4 up to h = 7 and rises to 4.89 at h = 14, when it reaches two weeks back. In this run recursive edged out direct at every printed h > 1.
- **MASE:** the direct model's 0.850 is below 1. Seasonal naive scores 1.096, above 1 although it defines the scale: the scale is its one-step training error, and the test averages horizons up to 14. Naive (repeat the last value) ignores the weekday and scores 1.488. RMSE and sMAPE rank the three the same way here.
- **sMAPE asymmetry:** the same error of 50 costs 40.0 when over-forecasting and 66.7 when under-forecasting.
- **Quantiles:** with default trees, 24.2 % of actuals fall below q0.1 and 18.8 % above q0.9, so the "80 %" interval covers 57.0 % of test values, against 75.0 % of training rows: it is too narrow out of sample. Shallower trees widen it (9.87 against 7.42) and lift test coverage to 70.2 %, still short of 80 %. The shallow settings were picked by hand, not tuned.
- **Pinball check:** for the median, the pinball loss 1.8590 equals half the MAE, as scikit-learn's formula says.
- **Scoring:** the raw-level model looks good under shuffled folds (2.51) and poor on later data (4.15), where the trend has carried the level beyond the training range; relative lags under the same time-ordered folds score 2.26.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Boosted trees on raw levels of a trending series | Poor forecasts once the level leaves the training range (lab 4.15 vs 2.26) | Trees are piecewise constant ✅[^17]; lab ✅[^16] |
| Shuffled k-fold on lag features | Score too optimistic (lab 2.51 vs 4.15; scikit-learn MAPE 0.396 vs 0.458 on its first time-based fold) | Training rows come from after the test rows ✅[^1] ✅[^16] |
| Window feature computed without shifting by one step | The feature contains the value it should predict | The example builds every window on shifted, past values, leaving the first rows undefined ✅[^1] |
| Multi-step MASE above 1 for a reasonable model | Looks worse than seasonal naive | The scale is a one-step in-sample error ✅[^3]; lab seasonal naive itself 1.096 ✅[^16] |
| MAPE or sMAPE with actuals near 0 | Huge or undefined scores | Division by values close to zero ✅[^3] |
| `mean_pinball_loss` at `alpha=0.5` | Half the MAE in scikit-learn, although the function's own page calls it "equivalent to Mean absolute error" ✅[^4]; equal to the MAE in FPP3's quantile score | The factor 2 in FPP3 ✅[^3] ✅[^5]; lab 1.8590 ✅[^16] |
| Quantile models trained with median-tuned settings | Under-cover on new data | Per-quantile tuning needed ✅[^7]; lab 0.570 for 80 % ✅[^16] |
| Direct strategy on a smooth trend | Forecasts can form a broken curve | Horizons are fitted independently ✅[^8] |
| Recursive strategy, horizon longer than the lag window | All inputs are earlier forecasts | Errors accumulate ✅[^8] |
| Global model over series of very different sizes | The network must learn to rescale inputs and outputs that differ by orders of magnitude | DeepAR divides by a per-series scale instead ✅[^12] |
| New series with little history | Single-series methods fail | A global model learned from similar series can still forecast it ✅[^12] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Recursive | One model; one fit ✅[^8] | Errors accumulate with the horizon ✅[^8] |
| Direct | No accumulation ✅[^8] | H models and H fits; independent forecasts ✅[^8] |
| MIMO | Keeps the dependency between horizons ✅[^8] | One multiple-output learner needed ✅[^8] |
| Local models (one per series) | Fewest assumptions: each series may differ ✅[^13] | Complexity grows with the number of series; short series overfit ✅[^13]; lab AR(24) 1.024 ✅[^16] |
| Global model | Constant complexity, long memory ✅[^13]; forecasts for new items ✅[^12] | Needs per-series scaling ✅[^12]; lab AR(12) 0.956 ✅[^16] |
| Pure ML forecaster | Gradient boosting handles mixed numerical and categorical features when samples are plentiful ✅[^2] | Poor M4 results ✅[^9]; dominated on M3 monthly ✅[^14] |
| Combinations and hybrids | 12 of M4's 17 best; the winner ✅[^9] | Several methods to fit and run per series, by construction |

## Takeaways
- Build every feature from data available at the forecast origin, and backtest on rolling origins only. [rule-candidate]
- Report MASE next to RMSE, and always include seasonal naive in the same table. [rule-candidate]
- Model changes or deseasonalized values, not raw levels, when a tree model must forecast a trending series.
- Measure the empirical coverage of every quantile interval on the backtest before trusting its nominal level. [rule-candidate]
- With many related short series, try one global model with long memory before one model per series.

## Verification status
- Verified: 95 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [Lagged features for time series forecasting](https://scikit-learn.org/stable/auto_examples/applications/plot_time_series_lagged_features.html) — scikit-learn developers, 2026 (1.9.1). Backs: lag and rolling-window features, undefined first rows, shuffled vs time-based MAPE, `TimeSeriesSplit` with `gap`, quantile gradient boosting. [^1]
- [Time-related feature engineering](https://scikit-learn.org/stable/auto_examples/applications/plot_cyclical_feature_engineering.html) — scikit-learn developers, 2026 (1.9.1). Backs: calendar features, one-hot, sine/cosine and periodic spline encodings, native categorical support. [^2]
- [Forecasting: Principles and Practice, 3rd ed., chapter 5: The forecaster's toolbox](https://otexts.com/fpp3/toolbox.html) — Hyndman, Athanasopoulos, OTexts, living. Backs: rolling forecasting origin, test-set size, MAE/RMSE, MAPE and sMAPE problems, MASE, quantile score, Winkler score, CRPS. [^3]
- [sklearn.metrics.mean_pinball_loss](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.mean_pinball_loss.html) — scikit-learn developers, 2026 (1.9.1). Backs: best value 0, α = 0.95 minimized by the 95th percentile, its "equivalent to Mean absolute error" wording at α = 0.5. [^4]
- [Metrics and scoring (User Guide 3.4)](https://scikit-learn.org/stable/modules/model_evaluation.html) — scikit-learn developers, 2026 (1.9.1). Backs: pinball formula, half the MAE at 0.5, same loss for training and scoring, `quantile` vs `alpha`. [^5]
- [sklearn.ensemble.HistGradientBoostingRegressor](https://scikit-learn.org/stable/modules/generated/sklearn.ensemble.HistGradientBoostingRegressor.html) — scikit-learn developers, 2026 (1.9.1). Backs: `loss="quantile"` uses the pinball loss, the `quantile` parameter, added in 1.1. [^6]
- [Prediction Intervals for Gradient Boosting Regression](https://scikit-learn.org/stable/auto_examples/ensemble/plot_gradient_boosting_quantile.html) — scikit-learn developers, 2026 (1.9.1). Backs: 5 %/95 % quantiles as a 90 % interval, train 0.903 vs test 0.796 coverage, per-quantile tuning. [^7]
- [A review and comparison of strategies for multi-step ahead time series forecasting based on the NN5 forecasting competition](https://ar5iv.labs.arxiv.org/html/1108.3259) — Ben Taieb, Bontempi, Atiya, Sorjamaa, 2012 (ar5iv HTML of arXiv:1108.3259). Backs: recursive, direct, DirRec and MIMO strategies, error accumulation, inconclusive comparisons, NN5 findings, deseasonalization. [^8]
- [The M4 Competition: Results, findings, conclusion and way forward](https://pure.unic.ac.cy/en/publications/the-m4-competition-results-findings-conclusion-and-way-forward/) — Makridakis, Spiliotis, Assimakopoulos, International Journal of Forecasting, 2018 (abstract on the University of Nicosia research portal). Backs: the five major findings. [^9]
- [M4 Competition](https://mofc.unic.ac.cy/m4/) — University of Nicosia, Institute For the Future, living. Backs: 100,000 series, ML and statistical methods, OWA for point forecasts, MSIS for intervals. [^10]
- [N-BEATS: Neural basis expansion analysis for interpretable time series forecasting](https://ar5iv.labs.arxiv.org/html/1905.10437) — Oreshkin, Carpov, Chapados, Bengio, 2019 (ar5iv HTML of arXiv:1905.10437). Backs: sMAPE and OWA definitions, the M4 winner's design, pure ML ranks, 3 % over the winner. [^11]
- [DeepAR: Probabilistic Forecasting with Autoregressive Recurrent Networks](https://ar5iv.labs.arxiv.org/html/1704.04110) — Salinas, Flunkert, Gasthaus, 2017 (ar5iv HTML of arXiv:1704.04110). Backs: global RNN over related series, scale handling, sample paths, items with little history, ~15 % improvement. [^12]
- [Principles and Algorithms for Forecasting Groups of Time Series: Locality and Globality](https://ar5iv.labs.arxiv.org/html/2008.00444) — Montero-Manso, Hyndman, 2020 (ar5iv HTML of arXiv:2008.00444). Backs: local vs global definitions, complexity, long memory, global linear models. [^13]
- [Statistical and Machine Learning forecasting methods: Concerns and ways forward](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0194889) — Makridakis, Spiliotis, Assimakopoulos, PLOS ONE, 2018. Backs: ML vs statistical methods on 1,045 M3 monthly series, deseasonalize before ML. [^14]
- [Forecasting: Principles and Practice, 3rd ed., chapter 12: Advanced forecasting methods](https://otexts.com/fpp3/advanced.html) — Hyndman, Athanasopoulos, OTexts, living. Backs: neural network autoregression forecast iteratively, intervals by simulating bootstrapped sample paths. [^15]
- `machine-learning/lab-setup.md` — the lab where the gradient-boosting backtest, quantile, scoring and local-vs-global scripts ran on 2026-11-25. [^16]
- [Decision Trees (User Guide 1.10)](https://scikit-learn.org/stable/modules/tree.html) — scikit-learn developers, 2026 (1.9.1). Backs: piecewise-constant predictions, poor extrapolation. [^17]
- [Déjà vu: A data-centric forecasting approach through time series cross-similarity](https://ar5iv.labs.arxiv.org/html/1909.00221) — Kang, Spiliotis, Petropoulos, Athiniotis, Li, Assimakopoulos, 2019 (ar5iv HTML of arXiv:1909.00221). Backs: the MSIS name and formula. [^18]

## Related
- `machine-learning/time-series/classical-forecasting-models.md` — the baselines and statistical models every ML forecaster should be compared with.
- `machine-learning/time-series/time-series-fundamentals.md` — trend, seasonality and autocorrelation, which the lag features encode.
- `machine-learning/evaluation/cross-validation-and-hyperparameter-search.md` — `TimeSeriesSplit` and nested search.
- `machine-learning/evaluation/data-leakage.md` — temporal leakage, the mechanism behind the shuffled-fold gap.
- `machine-learning/evaluation/metrics-catalog.md` — MAE, RMSE, MAPE and pinball loss in scikit-learn.
- `machine-learning/supervised-learning/tree-ensembles.md` — how histogram gradient boosting works.
- `machine-learning/deep-learning/recurrent-networks.md` — the LSTM behind DeepAR and the M4 winner.
- `machine-learning/foundations/loss-functions-and-maximum-likelihood.md` — the pinball loss as a loss function.
- `machine-learning/evaluation/conformal-prediction.md` — turning quantile forecasts into intervals with valid coverage.
