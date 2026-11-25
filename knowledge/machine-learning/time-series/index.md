---
schema: topic-index/v1
kind: subtopic
topic: machine-learning/time-series
last-updated: 2026-11-25
---

# Time-series forecasting

Predicting the future of a series from its past: trend, seasonality, stationarity and autocorrelation; classical models (naive baselines, exponential smoothing, ARIMA); and machine-learning forecasters with lag features, multi-step strategies, honest backtesting and prediction intervals. Every doc pairs the mechanism with a reproducible lab run (numpy 2.5.5, scipy 1.18.1, scikit-learn 1.9.1) whose full script is embedded; exponential smoothing, AR fits and decomposition are implemented by hand. Not covered: time-series classification and anomaly detection on streams (see `machine-learning/unsupervised-learning/anomaly-detection.md`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [time-series-fundamentals.md](time-series-fundamentals.md) | concept | Trend, seasonality and cycles; classical decomposition by moving averages; ACF, PACF and the white-noise band; stationarity, random walks and differencing; why i.i.d. formulas fail | verified |
| [classical-forecasting-models.md](classical-forecasting-models.md) | concept | Mean, naive, seasonal naive and drift baselines; simple, Holt and Holt-Winters exponential smoothing; AR, MA, ARIMA and seasonal ARIMA; prediction intervals and their coverage | verified |
| [forecasting-with-machine-learning.md](forecasting-with-machine-learning.md) | concept | Lag and calendar features, recursive vs direct multi-step, rolling-origin backtests, MASE and sMAPE vs RMSE, quantile (pinball) intervals, global models, what M4 found | verified |

## References
- [Forecasting: Principles and Practice, 3rd ed.](https://otexts.com/fpp3/) — Hyndman, Athanasopoulos, OTexts, living. Backs: topic scope, the classical methods and evaluation.
- [Lagged features for time series forecasting](https://scikit-learn.org/stable/auto_examples/applications/plot_time_series_lagged_features.html) — scikit-learn developers, living. Backs: lag features and time-based evaluation in scikit-learn.
- [Time-related feature engineering](https://scikit-learn.org/stable/auto_examples/applications/plot_cyclical_feature_engineering.html) — scikit-learn developers, living. Backs: calendar features in scikit-learn.
- [scikit-learn User Guide](https://scikit-learn.org/stable/user_guide.html) — scikit-learn developers, living. Backs: topic scope.

## Related
- `machine-learning/learning-path.md` — where this subtopic sits in the reading order.
- `machine-learning/lab-setup.md` — the lab every experiment ran in.
- `machine-learning/evaluation/cross-validation-and-hyperparameter-search.md` — `TimeSeriesSplit` and other splitters.
- `machine-learning/evaluation/data-leakage.md` — temporal leakage from shuffled splits.
- `machine-learning/evaluation/metrics-catalog.md` — regression and quantile metrics in scikit-learn.
- `machine-learning/deep-learning/recurrent-networks.md` — sequence models used by deep forecasters.
