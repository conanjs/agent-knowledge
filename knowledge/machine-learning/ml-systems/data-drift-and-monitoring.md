---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/ml-systems
status: verified
applies-to: ["any", "scipy 1.18 (ks_2samp)"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [machine-learning, ml-systems, monitoring, data-drift, dataset-shift, covariate-shift, label-shift, concept-shift, training-serving-skew, kolmogorov-smirnov, bonferroni]
---

# Data drift and monitoring: covariate, label and concept shift

## Summary
**TL;DR:** A deployed model silently assumes that serving data comes from the same distribution as its training data. That breaks in three ways: **covariate shift** (the inputs change, the labelling rule does not), **label shift** (the class mix changes, what each class looks like does not) and **concept shift** (the labelling rule itself changes). **Training–serving skew** is a fourth, self-inflicted cause: your own serving pipeline produces different inputs than training did. Label-free monitors (schema checks, a two-sample test per feature, a test on the model's scores) catch changes in the inputs, but a concept shift with unchanged inputs is invisible to them; only labels (delayed ground truth, human raters, real-world metrics) reveal it.
**Use this when:** you decide what to monitor for a model in production, a drift alert fired and you must judge whether it matters, or accuracy dropped while every input dashboard looks normal.
**Not this doc:** why such changes are so costly in an entangled system → `machine-learning/ml-systems/hidden-technical-debt.md`; the metrics to compute once labels arrive → `machine-learning/evaluation/metrics-catalog.md`; labels leaking into features → `machine-learning/evaluation/data-leakage.md`.

## Problem
Well-designed software is expected to warn when it meets unexpected input; ML (machine learning) systems, which depend strongly on properties of their inputs such as the i.i.d. (independent and identically distributed) assumption, tend to fail silently instead ✅[^1]. If serving data changes over time and the model is not retrained, its quality declines ✅[^2], and testing quality in serving is hard because real-world data is not always labeled ✅[^2]. So the team learns about the problem from users, weeks late, unless it monitors the right things: and "the right things" differ by kind of shift.

## Mental model
**Analogy:** a doorman trained on last year's crowd to spot troublemakers. *Covariate shift:* a different crowd arrives (more students), but what makes someone trouble is unchanged. *Label shift:* the same kinds of people, but a much larger share of troublemakers. *Concept shift:* the venue changes its rules, so yesterday's fine behaviour is now trouble; the crowd looks exactly the same, so watching the crowd cannot tell you. *Training–serving skew:* the doorman trained on sharp photos but works from a blurry camera.

**Artifact:** the training joint distribution factors two ways, `p(x, y) = p(x) · p(y|x) = p(y) · p(x|y)`, where `x` is the input, `y` the label, `p(x)` how often each input appears, `p(y|x)` the labelling rule, `p(y)` the class mix and `p(x|y)` what each class looks like. Each shift changes one factor and holds another ✅[^3]:

| Shift | Changes | Held fixed | Example ✅[^3] | Visible without labels? |
|---|---|---|---|---|
| Covariate | `p(x)` | `p(y|x)` | Trained on photos of cats and dogs, tested on cartoons | Yes: the inputs move |
| Label | `p(y)` | `p(x|y)` | Diagnosis from symptoms while disease prevalence changes | Yes, through the mix: `p(x) = Σ_y p(y)·p(x|y)` moves when `p(y)` does, as long as the classes look different (lab below ✅[^7]) |
| Concept | `p(y|x)` | (inputs may stay the same) | Which name a region uses for soft drinks; diagnostic criteria | No, if `p(x)` is unchanged ✅[^3] |

## How it works

### The shifts, precisely
1. **Covariate shift:** the input distribution changes while `P(y|x)` stays; the natural assumption when `x` causes `y` ✅[^3].
2. **Label shift:** `P(y)` changes while `P(x|y)` stays; the natural assumption when `y` causes `x`, as diseases cause symptoms ✅[^3]. Lipton et al.'s BBSE (Black Box Shift Estimation) estimates the new `p(y)` from any trained classifier, even a biased or uncalibrated one, as long as its confusion matrix is invertible ✅[^4].
3. **Concept shift:** the meaning of the labels changes ✅[^3]. In the extreme case the inputs keep the same distribution and every label flips; that is indistinguishable from no change at all without labels ✅[^3]. Usually the change is gradual (new products, wearing camera lenses), and a few update steps on new labelled data adapt the model ✅[^3].
4. **Nonstationarity:** a distribution that changes slowly while the model is not updated, such as a recommender still showing Santa hats after Christmas ✅[^3].

### Training–serving skew
Rules of ML lists three causes: different data handling in the training and serving pipelines, data that changed between training and serving, and a feedback loop between model and algorithm ✅[^5]. The Machine Learning Crash Course (MLCC) names two important types: **schema skew** (training and serving data do not follow the same schema) and **feature skew** (feature-engineering code differs, so engineered values differ) ✅[^2]. A subtle form: training on a feature that is not available at prediction time, such as the number of customers when predicting the same day's revenue ✅[^2]. Rules of ML's fix is to log the features at serving time and train on those logs ✅[^5].

### Detecting a change without labels
1. **Validate against a data schema:** ranges (ratings always 1–5), allowed categorical values, expected distributions; and unit-test the engineered features, since they can differ from the raw input ✅[^2].
2. **Compare a serving window with a reference window, per feature.** The two-sample Kolmogorov–Smirnov (KS) test compares two samples' distributions. Its statistic is the largest gap between their empirical CDFs (cumulative distribution functions, `F(z)` = fraction of values ≤ `z`): `D = max_z |F_ref(z) − F_new(z)|`; the null hypothesis is that both distributions are identical, and a large `D` gives a small p-value ✅[^6]. Worked numbers: for `[1,2,3]` vs `[2,3,4]`, at `z = 1` the CDFs are `1/3` and `0`, at `z = 2` `2/3` and `1/3`, at `z = 3` `1` and `2/3`: every gap is `1/3`, so `D = 0.3333` ✅[^7]. In SciPy 1.18, `ks_2samp` assumes continuous data and, with the default `method='auto'`, attempts an exact p-value when both samples have fewer than 10,000 values and uses the asymptotic one otherwise ✅[^6].
3. **Correct for testing many features.** With `K` features each tested at level `α` (the accepted false-alarm rate), Rabanser et al. use the Bonferroni correction: alarm if the smallest p-value is below `α/K` ✅[^1]. Example: `α = 0.05`, `K = 2` → threshold `0.025`.
4. **Test the model's outputs too.** Rabanser et al. found that a two-sample test on a pre-trained classifier's outputs (BBSD, black box shift detection) worked best across the shifts they studied, and that univariate tests run on each dimension and aggregated gave detection comparable to multivariate tests ✅[^1].
5. **Get labels where you can:** human raters, real-world metrics (compare spam predictions with user-reported spam), and serving a new model on a fraction of queries before switching all traffic ✅[^2].

### What to monitor
| Signal | Why | Source |
|---|---|---|
| Schema violations, feature-engineering unit tests | Catch broken inputs early | ✅[^2] |
| Per-feature distribution tests (with `α/K`) | Covariate and label shift, skew | ✅[^1] |
| Score or prediction distribution | One test that follows what the model uses | ✅[^1] |
| Metrics per data slice | A good overall metric can hide a bad region | ✅[^2] |
| Model age, also along the pipeline | Stale models; stalled pipelines | ✅[^2] |
| NaN (not a number) and Inf in weights and layer outputs | Numerical breakage | ✅[^2] |
| Training steps per second, memory, latency percentiles, queries per second | Cost and serving health, by code, model and data version | ✅[^2] |
| Labelled quality (delayed labels, raters, real-world metrics) | The only signal for concept shift | ✅[^2] ✅[^3] |

## Worked example
One synthetic world, four serving windows. Inputs `x1, x2 ~ N(0, 1)` (each drawn from a standard normal distribution: mean 0, standard deviation 1); the true rule labels a point positive when `x2 > x1² − 1` (plus noise). A logistic regression (a straight-line boundary, so it cannot follow the curve) is trained on a 2,000-row reference window. Each serving window has 2,000 rows; every feature is KS-tested against the reference with Bonferroni `α/K = 0.05/2`, and the model's scores are KS-tested too (BBSD-style). Accuracy uses labels the monitor would not have yet. Core lines:

```python
p1 = ks_2samp(X_ref[:, 0], X[:, 0]).pvalue                    # per feature
alarm = "ALARM" if min(p1, p2) < ALPHA / 2 else "quiet"        # Bonferroni
ps = ks_2samp(s_ref, model.predict_proba(X)[:, 1]).pvalue      # the model's scores
"concept shift (same x, labels flip)": (X_new, 1 - y_new)      # identical inputs, inverted rule
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-24, numpy 2.5.5, scipy 1.18.1, scikit-learn 1.9.1, two runs identical ✅[^7]:

```text
weights w1=+0.05 w2=+1.65; train positive rate 0.56; alarm if min p < alpha/K = 0.05/2
no shift                             KS p(x1)=4.2e-02 p(x2)=2.0e-01 -> quiet | KS p(score)=2.4e-01 | accuracy=0.749
covariate shift (x1 mean 0 -> 1.5)   KS p(x1)=5.4e-293 p(x2)=7.2e-01 -> ALARM | KS p(score)=9.5e-02 | accuracy=0.580
label shift (positives -> 15%)       KS p(x1)=6.2e-12 p(x2)=2.1e-35 -> ALARM | KS p(score)=2.4e-34 | accuracy=0.707
concept shift (same x, labels flip)  KS p(x1)=4.2e-02 p(x2)=2.0e-01 -> quiet | KS p(score)=2.4e-01 | accuracy=0.252
toy KS: ks_2samp([1,2,3], [2,3,4]).statistic = 0.3333
tiny shift, window   2,000: KS p(x1) = 2.7e-01
tiny shift, window 200,000: KS p(x1) = 3.4e-07
```

<details><summary>Full script (prints the output above)</summary>

```python
# Covariate, label and concept shift: what a per-feature KS test sees vs what accuracy does.
import numpy as np
from scipy.stats import ks_2samp
from sklearn.linear_model import LogisticRegression

rng = np.random.default_rng(0)
N, ALPHA = 2000, 0.05

def inputs(n, mean=(0.0, 0.0)):
    return rng.normal(loc=mean, scale=1.0, size=(n, 2))

def labels(X):                                    # the true rule p(y|x): positive above x2 = x1^2 - 1
    return (X[:, 1] > X[:, 0] ** 2 - 1 + 0.3 * rng.normal(size=len(X))).astype(int)

def label_shift(n, pos_rate):                     # resample by class: p(x|y) unchanged, p(y) changes
    X = inputs(20 * n); y = labels(X)
    pos, neg = np.flatnonzero(y == 1), np.flatnonzero(y == 0)
    k = int(n * pos_rate)
    idx = np.concatenate([rng.choice(pos, k, replace=False), rng.choice(neg, n - k, replace=False)])
    return X[idx], y[idx]

X_ref = inputs(N); y_ref = labels(X_ref)          # training data = the monitoring reference window
model = LogisticRegression().fit(X_ref, y_ref)
s_ref = model.predict_proba(X_ref)[:, 1]
print(f"weights w1={model.coef_[0, 0]:+.2f} w2={model.coef_[0, 1]:+.2f}; train positive rate {y_ref.mean():.2f}; "
      f"alarm if min p < alpha/K = {ALPHA}/2")

X_new = inputs(N); y_new = labels(X_new)
X_cov = inputs(N, mean=(1.5, 0.0))
scenarios = {
    "no shift":                           (X_new, y_new),
    "covariate shift (x1 mean 0 -> 1.5)": (X_cov, labels(X_cov)),
    "label shift (positives -> 15%)":     label_shift(N, 0.15),
    "concept shift (same x, labels flip)": (X_new, 1 - y_new),
}
for name, (X, y) in scenarios.items():
    p1 = ks_2samp(X_ref[:, 0], X[:, 0]).pvalue
    p2 = ks_2samp(X_ref[:, 1], X[:, 1]).pvalue
    ps = ks_2samp(s_ref, model.predict_proba(X)[:, 1]).pvalue
    alarm = "ALARM" if min(p1, p2) < ALPHA / 2 else "quiet"
    acc = (model.predict(X) == y).mean()
    print(f"{name:<36} KS p(x1)={p1:.1e} p(x2)={p2:.1e} -> {alarm} | KS p(score)={ps:.1e} | accuracy={acc:.3f}")

print("toy KS: ks_2samp([1,2,3], [2,3,4]).statistic =", round(ks_2samp([1, 2, 3], [2, 3, 4]).statistic, 4))
for n in (2_000, 200_000):                        # the same tiny shift (x1 mean +0.02) at two window sizes
    print(f"tiny shift, window {n:>7,}: KS p(x1) = {ks_2samp(inputs(n)[:, 0], inputs(n, mean=(0.02, 0.0))[:, 0]).pvalue:.1e}")
```
</details>

Reading it line by line:
- **Weights:** the model leans on `x2` (+1.65) and almost ignores `x1` (+0.05): on a symmetric parabola a straight line can only use `x2`. Accuracy without shift is 0.749.
- **Covariate shift:** `x1`'s p-value is `5.4e-293`, far below 0.025, so the per-feature monitor alarms. Accuracy falls to 0.580, because the model extrapolates its straight line into a region where the true curve is far higher. The score test stays quiet (`p = 0.095`): the shifted feature is one the model ignores, so its outputs barely moved.
- **Label shift:** with positives cut from 56% to 15%, both features move (positives sit at small `|x1|` and large `x2`), so both monitors alarm; accuracy dips to 0.707.
- **Concept shift:** the inputs are byte-for-byte those of the "no shift" window, so every p-value is identical (0.042, 0.20, 0.24) and nothing alarms, while accuracy collapses to 0.252, below a coin flip.
- **Window size:** the same tiny `+0.02` mean shift is invisible with 2,000 rows (`p = 0.27`) and "highly significant" with 200,000 (`p = 3.4e-07`).

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Labels change, inputs do not | Every label-free monitor stays quiet; accuracy collapses | Indistinguishable from no shift without labels ✅[^3]; lab: 0.749 → 0.252 with identical p-values ✅[^7] |
| Input shift in a feature the model ignores | Score-based test quiet, per-feature test alarms, accuracy still drops | Lab: `w1 = +0.05`, score `p = 0.095`, accuracy 0.580 ✅[^7] |
| Very large monitoring windows | Tiny, harmless differences become significant | Lab: `p` from 0.27 to 3.4e-07 for the same `+0.02` shift ✅[^7]; judge effect size (`D`) and harm, not the p-value alone |
| A significant shift that does not matter | Alarm without damage | Rabanser et al. found a significant but not worrisome shift between the standard splits of MNIST (a handwritten-digit dataset) ✅[^1] |
| Many features each tested at 0.05 | Frequent false alarms | Use `α/K` (Bonferroni) ✅[^1] |
| Categorical or discrete feature | KS's assumption fails | `ks_2samp` assumes continuous data ✅[^6]; Rabanser et al. use a chi-squared test on categorical predictions ✅[^1] |
| Feature not available at prediction time | Great offline metrics, poor serving | Train only on features you will have when serving ✅[^2] |
| Joined table updated between training and serving | Same example, different prediction | Rules #31; log features at serving time ✅[^5] |
| Slow drift over many model versions | Each new version looks fine against the last one | Test also against a fixed threshold ✅[^8] |
| Known label shift | Can be estimated and corrected | BBSE, given an invertible confusion matrix ✅[^4] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Schema and range checks | Catch anomalies, unexpected categorical values and unexpected distributions ✅[^2] | Only as good as the rules someone wrote into the schema |
| Per-feature KS + Bonferroni | Label-free ✅[^1]; points at the feature that moved (lab: `x1` alone under covariate shift) ✅[^7] | One test per feature; blind to concept shift (lab) ✅[^7] |
| Test on model scores (BBSD) | One test; best detector in Rabanser et al.'s study ✅[^1] | Misses shifts in features the model ignores (lab) ✅[^7] |
| Delayed labels, human raters | The only view of concept shift ✅[^2] | Slow and costly |
| Serve the new model to a fraction of queries first | Validates on live data before full switch ✅[^2] | Two models to run and compare |

## Takeaways
- Monitor inputs and outputs without labels, but never treat a quiet input dashboard as proof the model still works: concept shift needs labels. [rule-candidate]
- Correct for the number of features tested (`α/K`), and size alert thresholds by effect size, not by p-value alone, when windows are large.
- Compute serving features with the training code, or log them at serving and train on the logs. [rule-candidate]
- Track the model's age and retrain on a schedule matched to how fast the data changes.

## Verification status
- Verified: 55 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- [Failing Loudly: An Empirical Study of Methods for Detecting Dataset Shift](https://arxiv.org/html/1810.11953v4) — Rabanser, Günnemann, Lipton, 2019. Backs: ML systems fail silently; per-dimension KS tests with Bonferroni (`α/K`); BBSD on classifier outputs worked best; univariate tests matched multivariate; chi-squared for categorical outputs; the MNIST split shift. [^1]
- [Production ML systems: Monitoring pipelines](https://developers.google.com/machine-learning/crash-course/production-ml-systems/monitoring?hl=en) — Google Machine Learning Crash Course, living. Backs: data schema, feature unit tests, data slices, schema and feature skew, feature unavailable at prediction time, model age, NaN/Inf checks, performance monitoring, live quality tests (raters, real-world metrics, fraction of queries). [^2]
- [Environment and Distribution Shift (Dive into Deep Learning, 4.7)](https://d2l.ai/chapter_linear-classification/environment-and-distribution-shift.html) — Dive into Deep Learning authors, living. Backs: covariate, label and concept shift definitions and examples, the label-flip case, nonstationary distributions, gradual concept shift and adaptation. [^3]
- [Detecting and Correcting for Label Shift with Black Box Predictors](https://arxiv.org/html/1802.03916v3) — Lipton, Wang, Smola, 2018. Backs: label shift definition, BBSE works with biased or uncalibrated predictors if the confusion matrix is invertible. [^4]
- [Rules of Machine Learning](https://developers.google.com/machine-learning/guides/rules-of-ml) — Martin Zinkevich, Google for Developers, living. Backs: three causes of training–serving skew, Rule #29 (log features at serving), Rule #31 (joined tables change). [^5]
- [scipy.stats.ks_2samp](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.ks_2samp.html) — SciPy developers, SciPy 1.18 manual. Backs: KS statistic as the largest gap between empirical CDFs, null hypothesis, continuous-data assumption, exact vs asymptotic p-value at 10,000. [^6]
- `machine-learning/lab-setup.md` — the lab where the four-window shift experiment, the toy KS statistic and the window-size check ran on 2026-11-24. [^7]
- [Production ML systems: Deployment testing](https://developers.google.com/machine-learning/crash-course/production-ml-systems/deployment-testing?hl=en) — Google Machine Learning Crash Course, living. Backs: slow degradation needs a fixed quality threshold, not only a comparison with the previous version. [^8]

## Related
- `machine-learning/ml-systems/hidden-technical-debt.md` — unstable data dependencies and feedback loops, the usual sources of drift.
- `machine-learning/ml-systems/reproducibility-and-determinism.md` — versioning data and models so a drift alert can be traced to a cause.
- `machine-learning/evaluation/metrics-catalog.md` — which metric to compute when labels arrive.
- `machine-learning/evaluation/class-imbalance.md` — base rates, which label shift changes.
- `machine-learning/evaluation/probability-calibration.md` — calibrated scores, which shift can break.
- `machine-learning/ml-systems/domain-adaptation.md` — correcting a shift once it is detected.
- `machine-learning/evaluation/conformal-prediction.md` — coverage under shift, and weighted conformal prediction.
- `machine-learning/deep-learning/uncertainty-in-deep-learning.md` — model uncertainty on shifted and out-of-distribution inputs.
- `machine-learning/reinforcement-learning/offline-reinforcement-learning.md` — distribution shift when learning a policy from logged data.
- `machine-learning/learning-theory/online-learning.md` — online learners that track a drifting stream.
