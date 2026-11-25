---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/evaluation
status: verified
applies-to: ["scikit-learn 1.9.1"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [machine-learning, evaluation, calibration, reliability-diagram, brier-score, log-loss, platt-scaling, isotonic-regression, temperature-scaling, calibratedclassifiercv]
---

# Probability calibration: reliability curves, Brier score, sigmoid and isotonic

## Summary
**TL;DR:** A classifier is calibrated when its probabilities mean what they say: of the samples it scores near 0.8, about 80% are positive. Many models rank well but are miscalibrated, naive Bayes pushes scores to 0 and 1, and modern neural networks are overconfident. A reliability curve bins the predictions and plots the fraction of positives against the mean predicted probability; the Brier score and log loss sum calibration and ranking quality into one number. Calibration fits a small monotonic map from scores to probabilities on data the model did not train on: sigmoid (Platt) scaling with two parameters, isotonic regression with a free step function, or temperature scaling for multiclass logits. `CalibratedClassifierCV` does it with cross-validation (CV). In the lab, isotonic calibration cut naive Bayes's log loss from 1.093 to 0.276 with ROC-AUC (area under the receiver operating characteristic curve) unchanged.
**Use this when:** a model's probabilities feed a decision (expected cost, risk scores, thresholds shared across models, combining models), you see predictions piled at 0 and 1, or a model was trained with class weights or resampling.
**Not this doc:** choosing a decision threshold → `machine-learning/evaluation/classification-metrics.md` and `machine-learning/evaluation/class-imbalance.md`; why naive Bayes is miscalibrated → `machine-learning/probabilistic-ml/naive-bayes.md`; log loss as a training loss → `machine-learning/foundations/loss-functions-and-maximum-likelihood.md`.

## Problem
`predict_proba` returns numbers between 0 and 1, so they look like probabilities, but some models give poor estimates of the class probabilities ✅[^1]. Teams then multiply them by costs, compare them across models or report "92% risk" to users. Ranking metrics cannot catch this: in the lab, naive Bayes kept ROC-AUC 0.944 while 10,245 test rows it scored near 0.00 were in fact 13% positive ✅[^7]. Guo et al. found that modern neural networks, unlike those of a decade earlier, are poorly calibrated ✅[^6].

## Mental model
**Analogy:** a weather forecaster. A calibrated forecaster's "70% chance of rain" days are rainy about 70% of the time. A forecaster can be excellent at ordering days by rain risk and still say "99%" when he means "70%". Calibration does not retrain the forecaster; it hands him a conversion table learned from past forecasts and what actually happened ("when you say 99%, it rains 93% of the time").

**Artifact:** reliability bins for naive Bayes before and after isotonic calibration, each `[mean predicted -> fraction positive n=count]`; lab run (`machine-learning/lab-setup.md`), 2026-11-24, scikit-learn 1.9.1 ✅[^7] (full script in the worked example):

```text
  GaussianNB uncalibrated [0.00->0.13 n=10245] [0.29->0.38 n=203] [0.50->0.41 n=160] [0.71->0.36 n=181] [1.00->0.93 n=9211]
  GaussianNB isotonic    [0.09->0.09 n=7610] [0.27->0.25 n=3108] [0.53->0.50 n=687] [0.71->0.70 n=698] [0.98->0.98 n=7897]
```

A calibrated model has the two numbers in each bracket equal: the points lie on the diagonal of a reliability diagram.

## How it works
1. **Definition.** A well-calibrated binary classifier's `predict_proba` can be read as a confidence level: among samples given about 0.8, about 80% are positive ✅[^1]. Guo et al. state it the same way: of 100 predictions at confidence 0.8, 80 should be correct ✅[^6].
2. **Measure it with a reliability curve.** Bin the predictions; per bin, plot the mean predicted probability (x) against the fraction of positives (y) ✅[^1]. `calibration_curve` defaults to 5 equal-width bins (`strategy="uniform"`), offers `"quantile"` bins with equal counts, needs more data for more bins, and drops empty bins ✅[^3]. A reliability diagram does not show how many samples each bin holds ✅[^6], so print or plot the counts too.
3. **Summarize it.**
   - **ECE** (expected calibration error): `ECE = Σ_m (|B_m| / n) · |acc(B_m) − conf(B_m)|`, where `B_m` is the set of predictions in bin m, n the number of predictions, `acc` the accuracy and `conf` the mean confidence in the bin: a count-weighted average gap ✅[^6]. For a binary model's positive class, use the fraction of positives and the mean predicted probability. Worked on the 5-bin artifact above, the first uncalibrated bin alone contributes `(10245 / 20000) · |0.13 − 0.00| ≈ 0.067` (the worked example's ECE column uses 10 bins).
   - **Brier score**: for binary labels `y_i` in {0, 1} and predicted probabilities `p̂_i`, `BS = (1/N) · Σ (y_i − p̂_i)²`, the mean squared error of the probabilities; lower is better ✅[^5]. Example: labels (0, 1, 1, 0) with probabilities (0.1, 0.9, 0.8, 0.4) give `(0.01 + 0.01 + 0.04 + 0.16) / 4 = 0.055` ✅[^5]. In 1.9.1, `scale_by_half="auto"` gives the [0, 1] range for binary and [0, 2] for multiclass ✅[^4].
   - **Log loss**: `−(y · log(p̂) + (1 − y) · log(1 − p̂))` per sample, the negative log-likelihood ✅[^5]. A confident mistake is punished without limit: a positive given `p̂ = 0.001` costs `−ln(0.001) = 6.9`, while Brier charges it at most 1.
   - Both are strictly proper scoring rules, so they mix calibration with discrimination (resolution) and the data's own uncertainty; a lower Brier score does not necessarily mean a better-calibrated model ✅[^1].
4. **Why models drift off the diagonal.**
   - Logistic regression tends to be well calibrated because its log loss uses the canonical (logit) link ✅[^1].
   - Gaussian naive Bayes tends to push probabilities to 0 or 1, mainly because its feature-independence assumption fails on redundant features ✅[^1].
   - Random forests and other averaging ensembles can have difficulty predicting near 0 and 1, because variance in the trees biases the average away from the extremes; their curve is sigmoid-shaped ✅[^1]. Maximum-margin models such as `LinearSVC` show an even stronger sigmoid shape ✅[^1].
   - Deep networks: depth, width, weight decay and batch normalization affect calibration, and a 110-layer ResNet (residual network) was overconfident where a 5-layer LeNet was not ✅[^6].
5. **Fix it with a calibrator.** A calibrator is a regressor that maps the classifier's output `f_i` (from `decision_function` or `predict_proba`) to `P(y_i = 1 | f_i)`; it should be fitted on data independent of the classifier's training data, or it learns the classifier's over-confidence on its own training set ✅[^1].
   - **Sigmoid (Platt):** `p = 1 / (1 + exp(A · f + B))`, with A and B fitted by maximum likelihood ✅[^1]. Example: `A = −2, B = 1, f = 0.8` gives `1 / (1 + exp(−0.6)) = 0.646`. It assumes a sigmoid-shaped distortion, works best when calibration errors are symmetric, which can fail on highly imbalanced data, and is most effective with small calibration sets or under-confident models ✅[^1].
   - **Isotonic:** fits a non-decreasing step function minimizing `Σ (y_i − f̂_i)²` ✅[^1]. It can correct any monotonic distortion but overfits more easily; it performs as well as or better than sigmoid with more than about 1,000 samples ✅[^1].
   - **Temperature scaling:** `softmax(z / T)` with one parameter T learned by minimizing log loss on held-out data, for multiclass logits z; T > 1 softens the probabilities, and since the arg-max does not move, accuracy is unchanged ✅[^1] ✅[^6]. Guo et al. found it surprisingly effective on most datasets ✅[^6]; scikit-learn 1.9.1 offers it as `method="temperature"` ✅[^2].
6. **`CalibratedClassifierCV`** wraps the procedure: `method="sigmoid"` by default, 5-fold CV by default ✅[^2]. With `ensemble=True` (what the default `"auto"` means unless the estimator is a `FrozenEstimator` ✅[^2]), each fold fits a clone of the classifier on the training part and a calibrator on its predictions for the held-out part, and `predict_proba` averages the k pairs ✅[^1]. With `ensemble=False`, `cross_val_predict` produces out-of-fold predictions for one calibrator and the classifier is refit on all data ✅[^1]. An already fitted model is wrapped as `CalibratedClassifierCV(FrozenEstimator(model))`, and the caller must keep the calibration data disjoint from the training data ✅[^1].

## Worked example
40,000 synthetic rows with 2 informative, 10 redundant and 8 noise features (the redundancy breaks naive Bayes's independence assumption), split 50/50. Gaussian naive Bayes and a 100-tree random forest, each uncalibrated and wrapped in `CalibratedClassifierCV(…, cv=5)` with sigmoid and isotonic, scored on the 20,000 test rows. ECE uses 10 bins. The core lines:

```python
variants = {"uncalibrated": est,
            "sigmoid": CalibratedClassifierCV(est, method="sigmoid", cv=5),
            "isotonic": CalibratedClassifierCV(est, method="isotonic", cv=5)}
p = m.fit(Xtr, ytr).predict_proba(Xte)[:, 1]
frac, mean_p = calibration_curve(yte, p, n_bins=5)
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-24, scikit-learn 1.9.1, numpy 2.5.5, two runs identical ✅[^7]:

```text
model                       Brier logloss ROC-AUC    ECE
GaussianNB uncalibrated    0.1021  1.0933  0.9438 0.0978
GaussianNB sigmoid         0.0942  0.3296  0.9438 0.0186
GaussianNB isotonic        0.0823  0.2758  0.9437 0.0113
RandomForest uncalibrated  0.0292  0.2229  0.9884 0.0100
RandomForest sigmoid       0.0297  0.1149  0.9888 0.0074
RandomForest isotonic      0.0284  0.1080  0.9889 0.0023
reliability bins [mean predicted -> fraction positive, count], 5 uniform bins:
  GaussianNB uncalibrated [0.00->0.13 n=10245] [0.29->0.38 n=203] [0.50->0.41 n=160] [0.71->0.36 n=181] [1.00->0.93 n=9211]
  GaussianNB isotonic    [0.09->0.09 n=7610] [0.27->0.25 n=3108] [0.53->0.50 n=687] [0.71->0.70 n=698] [0.98->0.98 n=7897]
  RandomForest uncalibrated [0.01->0.01 n=9332] [0.30->0.37 n=243] [0.51->0.61 n=318] [0.72->0.80 n=745] [0.97->0.97 n=9362]
  RandomForest isotonic  [0.01->0.01 n=9339] [0.30->0.35 n=165] [0.50->0.54 n=280] [0.72->0.73 n=404] [0.96->0.96 n=9812]
RandomForest uncalibrated: mean row loss 0.2229; 74 rows gave the true class p = 0 and carry 60% of the log loss
```

<details><summary>Full script (prints the output above)</summary>

```python
import numpy as np
from sklearn.calibration import CalibratedClassifierCV, calibration_curve
from sklearn.datasets import make_classification
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import brier_score_loss, log_loss, roc_auc_score
from sklearn.model_selection import train_test_split
from sklearn.naive_bayes import GaussianNB

X, y = make_classification(n_samples=40_000, n_features=20, n_informative=2, n_redundant=10,
                           random_state=42)
Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.5, random_state=42)

def bin_ids(p, bins):
    """Bin index per prediction, bins ((m-1)/M, m/M] as in calibration_curve(strategy='uniform')."""
    return np.searchsorted(np.linspace(0, 1, bins + 1)[1:-1], p)

def ece(y_true, p, bins=10):
    """Expected calibration error for the positive class: weighted |fraction positive - mean p|."""
    idx = bin_ids(p, bins)
    return sum((idx == b).mean() * abs(y_true[idx == b].mean() - p[idx == b].mean())
               for b in range(bins) if (idx == b).any())

def show_bins(name, p):
    frac, mean_p = calibration_curve(yte, p, n_bins=5)
    counts = np.bincount(bin_ids(p, 5), minlength=5)
    print(f"  {name:<22}", " ".join(f"[{m:.2f}->{f:.2f} n={c}]" for m, f, c in
                                    zip(mean_p, frac, counts[counts > 0])))

base = {"GaussianNB": GaussianNB(),
        "RandomForest": RandomForestClassifier(n_estimators=100, random_state=0)}
print(f"{'model':<26} {'Brier':>6} {'logloss':>7} {'ROC-AUC':>7} {'ECE':>6}")
probs = {}
for bname, est in base.items():
    variants = {"uncalibrated": est,
                "sigmoid": CalibratedClassifierCV(est, method="sigmoid", cv=5),
                "isotonic": CalibratedClassifierCV(est, method="isotonic", cv=5)}
    for vname, m in variants.items():
        p = m.fit(Xtr, ytr).predict_proba(Xte)[:, 1]
        probs[f"{bname} {vname}"] = p
        print(f"{bname + ' ' + vname:<26} {brier_score_loss(yte, p):6.4f} {log_loss(yte, p):7.4f} "
              f"{roc_auc_score(yte, p):7.4f} {ece(yte, p):6.4f}")

print("reliability bins [mean predicted -> fraction positive, count], 5 uniform bins:")
for key in ("GaussianNB uncalibrated", "GaussianNB isotonic",
            "RandomForest uncalibrated", "RandomForest isotonic"):
    show_bins(key, probs[key])
p = probs["RandomForest uncalibrated"]
eps = np.finfo(float).eps
p_true = np.clip(np.where(yte == 1, p, 1 - p), eps, 1)   # probability given to the true class
row_loss = -np.log(p_true)
sure_wrong = p_true <= eps
print(f"RandomForest uncalibrated: mean row loss {row_loss.mean():.4f}; {int(sure_wrong.sum())} rows "
      f"gave the true class p = 0 and carry {row_loss[sure_wrong].sum() / row_loss.sum():.0%} of the log loss")
```
</details>

Reading it:
- **Naive Bayes is overconfident.** Uncalibrated, 19,456 of 20,000 test rows sit in the two extreme bins; the "0.00" bin is 13% positive and the "1.00" bin only 93%. Middle bins are inverted (mean 0.71, fraction 0.36). ECE 0.098 and log loss 1.093.
- **Isotonic fixes it most.** Every bin lands on the diagonal within 0.03; log loss drops to 0.276, Brier from 0.102 to 0.082, ECE to 0.011. Sigmoid helps less (log loss 0.330, ECE 0.019). The guide expects isotonic to match or beat sigmoid once there are more than about 1,000 samples ✅[^1]; here each of the 5 calibrators is fitted on the 4,000 held-out rows of its fold.
- **Ranking is untouched.** ROC-AUC stays 0.9438 with sigmoid and moves by 0.0001 with isotonic; calibration maps scores monotonically, and isotonic's steps create ties ✅[^1].
- **The forest was already close.** ECE 0.010 uncalibrated, with the three middle bins predicting a little less than the observed fraction (0.30 → 0.37, 0.51 → 0.61, 0.72 → 0.80). Its log loss of 0.223 is dominated by 74 rows (0.4% of the test set) where it gave the true class probability 0: they carry 60% of the loss. Both calibrators halve the log loss (0.223 → 0.115 and 0.108), the score that punishes confident mistakes without limit (step 3). Sigmoid made the Brier score slightly worse (0.0292 → 0.0297) while improving ECE and log loss: the metrics need not agree ✅[^1].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Calibrator fitted on the classifier's own training predictions | Probabilities still pushed toward 0 and 1 | The classifier does better on its training data than on new data ✅[^1] |
| Small calibration set with isotonic | Overfits; noisy steps | Isotonic is more prone to overfitting on small datasets ✅[^1]; use sigmoid |
| Highly imbalanced data with sigmoid | Correction can be off | Sigmoid works best with symmetric calibration errors, which imbalance can break ✅[^1] |
| ROC-AUC changes slightly after isotonic | Expected | Isotonic introduces ties; sigmoid is strictly monotonic and keeps the ranking ✅[^1] |
| Multiclass with sigmoid or isotonic | One-vs-rest per class, then renormalized to sum to 1 | Both calibrators are 1-dimensional ✅[^1] |
| A class missing from a CV fold | That fold's pair predicts 0 for the class or fits a useless calibrator | Choose `cv` so every class is in every train and test part ✅[^1] |
| Model trained with class weights or resampling | Probabilities inflated for the rare class | `machine-learning/evaluation/class-imbalance.md`; recalibrate on data with the real class ratio |
| Comparing calibration by Brier score alone | A better-discriminating but worse-calibrated model can win | Brier mixes calibration, resolution and uncertainty ✅[^1] |
| `calibration_curve` with many bins and little data | Fewer points returned than bins; noisy fractions | More bins need more data; empty bins are dropped ✅[^3] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Sigmoid (Platt) | Two parameters, stable on small sets; keeps ranking ✅[^1] | Assumes a sigmoid-shaped distortion ✅[^1]; lab: weaker than isotonic on naive Bayes ✅[^7] |
| Isotonic | Corrects any monotonic distortion ✅[^1]; best ECE in the lab ✅[^7] | Overfits small sets; adds ties ✅[^1] |
| Temperature scaling | One parameter for all classes; accuracy unchanged ✅[^1] ✅[^6] | Rescales logits only; one shape for all classes |
| `ensemble=True` | Ensembling effect: well calibrated and slightly more accurate ✅[^1] | k classifiers to store and run ✅[^1] |
| `ensemble=False` | One classifier: faster fit and prediction, smaller model ✅[^1] | No ensembling gain ✅[^1] |

## Takeaways
- Check a reliability curve with bin counts before using any `predict_proba` output as a probability. [rule-candidate]
- Calibrate on data the classifier did not train on: `CalibratedClassifierCV` with CV, or a frozen model plus a separate calibration set. [rule-candidate]
- Use sigmoid for small calibration sets and isotonic when there are more than about a thousand calibration samples; use temperature scaling for multiclass neural-network logits.
- Report Brier score or log loss together with a calibration measure (ECE or the curve), since a proper score alone mixes calibration and ranking.

## Verification status
- Verified: 58 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- [Probability calibration (User Guide 1.16)](https://scikit-learn.org/stable/modules/calibration.html) — scikit-learn developers, living (1.9.1 docs). Backs: definition, reliability curves, proper scores mix terms, per-model behaviour (logistic regression, naive Bayes, random forest, `LinearSVC`), calibrator on independent data, `CalibratedClassifierCV` ensemble modes and `FrozenEstimator`, sigmoid formula and assumptions, isotonic objective and the ~1,000-sample guidance, AUC and ties, multiclass, temperature scaling. [^1]
- [sklearn.calibration.CalibratedClassifierCV](https://scikit-learn.org/stable/modules/generated/sklearn.calibration.CalibratedClassifierCV.html) — scikit-learn developers, living. Backs: `method="sigmoid"` default, `"temperature"` option, 5-fold default, `ensemble="auto"` (False only for a `FrozenEstimator`). [^2]
- [sklearn.calibration.calibration_curve](https://scikit-learn.org/stable/modules/generated/sklearn.calibration.calibration_curve.html) — scikit-learn developers, living. Backs: `n_bins=5`, uniform vs quantile, empty bins dropped. [^3]
- [sklearn.metrics.brier_score_loss](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.brier_score_loss.html) — scikit-learn developers, living. Backs: `scale_by_half="auto"` ranges. [^4]
- [Metrics and scoring (User Guide 3.4)](https://scikit-learn.org/stable/modules/model_evaluation.html) — scikit-learn developers, living. Backs: Brier score formula and its 0.055 example, log loss formula. [^5]
- [On Calibration of Modern Neural Networks](https://arxiv.org/html/1706.04599v2) — Guo, Pleiss, Sun, Weinberger, 2017. Backs: modern networks poorly calibrated, perfect-calibration definition, reliability diagrams hide counts, ECE formula, LeNet vs ResNet, factors affecting calibration, temperature scaling and its effectiveness. [^6]
- `machine-learning/lab-setup.md` — the lab where the naive Bayes and random-forest calibration comparison ran on 2026-11-24. [^7]

## Related
- `machine-learning/evaluation/classification-metrics.md` — thresholds and ranking metrics, which calibration does not change.
- `machine-learning/evaluation/class-imbalance.md` — weights and resampling distort probabilities.
- `machine-learning/probabilistic-ml/naive-bayes.md` — the independence assumption behind its overconfidence.
- `machine-learning/supervised-learning/tree-ensembles.md` — random forests and why averaging avoids 0 and 1.
- `machine-learning/foundations/loss-functions-and-maximum-likelihood.md` — log loss as negative log-likelihood.
