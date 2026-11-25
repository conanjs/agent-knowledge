---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/evaluation
status: verified
applies-to: ["scikit-learn 1.9.1"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [machine-learning, evaluation, confusion-matrix, accuracy, precision, recall, f1, threshold, roc-auc, pr-auc, average-precision]
---

# Classification metrics: confusion matrix, precision, recall, ROC and PR curves

## Summary
**TL;DR:** A classifier outputs a score; a threshold turns the score into a yes/no label; the four counts of the confusion matrix at that threshold (TP, FP, FN, TN: true positives, false positives, false negatives, true negatives) define accuracy, precision, recall and F1. On rare positives accuracy is close to useless: "always say no" scores 99% on a 99:1 test set while finding no positive. Threshold-free summaries rank the scores instead: ROC-AUC (receiver operating characteristic, area under the curve) is the chance that a random positive outscores a random negative and ignores the class ratio; PR-AUC (precision-recall area, computed as average precision) has the positive rate as its random baseline and drops as positives get rarer.
**Use this when:** you pick a metric for a binary classifier, read a confusion matrix, choose a decision threshold, or see a high accuracy or ROC-AUC on rare-event data and wonder whether it means anything.
**Not this doc:** what to do about rare classes (weights, resampling) → `machine-learning/evaluation/class-imbalance.md`; whether the scores are trustworthy probabilities → `machine-learning/evaluation/probability-calibration.md`; every metric with its function name and range → `machine-learning/evaluation/metrics-catalog.md`.

## Problem
A fraud, disease or defect model is judged by one number, and the default number misleads. Accuracy rewards the model for the common class, so a model that never flags anything looks excellent ✅[^3]. The default decision rule (positive when the predicted probability is above 0.5) is not ideal for most use cases ✅[^2]. And ROC-AUC, the usual "threshold-free" fix, can stay high while most of the alarms the model raises are false ✅[^5]. Without the confusion matrix and the threshold in view, a team ships a model whose real hit rate nobody computed.

## Mental model
**Analogy:** an airport scanner with a sensitivity dial. Each bag gets a suspicion score; the dial is the threshold. Turn it down and the guards open more bags: they catch more real threats (recall up) but open more innocent bags for each threat found (precision down). The confusion matrix is the guard's logbook at one dial setting. ROC-AUC asks "is a dangerous bag usually more suspicious than a safe one?", which does not depend on how few dangerous bags there are. PR-AUC asks "when the scanner beeps, how often is it right?", which does.

**Artifact:** a logistic regression on a 99:1 test set at the default threshold, next to a model that always says "negative"; lab run (`machine-learning/lab-setup.md`), 2026-11-24, scikit-learn 1.9.1 ✅[^6] (the full script is in the worked example):

```text
always-negative  accuracy=0.9900  recall=0.0000
t=0.5  TN=9897 FP=3   FN=78 TP=22 acc=0.9919 P=0.880 R=0.220 F1=0.352  hand==sklearn: True
```

The same four counts as a confusion matrix, laid out as scikit-learn does (rows = true class, columns = predicted class ✅[^1]):

| | predicted 0 | predicted 1 |
|---|---|---|
| **true 0** (9,900 rows) | TN = 9,897 | FP = 3 |
| **true 1** (100 rows) | FN = 78 | TP = 22 |

## How it works
1. **Score, then threshold.** A classifier produces a score per sample (`predict_proba` for a probability, `decision_function` for a raw margin) and `predict` applies a fixed cut-off: positive when the probability is above 0.5 or the decision score is above 0 ✅[^2]. In the lab, `predict()` equalled `proba > 0.5` on all 10,000 test rows ✅[^6].
2. **Count the four outcomes.** At one threshold every sample lands in one cell: TP (true positive: positive, flagged), FP (false positive: negative, flagged), FN (false negative: positive, missed), TN (true negative: negative, not flagged) ✅[^1]. `confusion_matrix(y_true, y_pred)` puts true classes on rows and predicted classes on columns, and `.ravel()` returns `tn, fp, fn, tp` for binary labels ✅[^1].
3. **Derive the rates** (numbers from the artifact):
   - `accuracy = (TP + TN) / (TP + TN + FP + FN)`: the share of all predictions that are right ✅[^3]; `(22 + 9897) / 10000 = 0.9919`.
   - `precision = TP / (TP + FP)`: of the samples flagged, the share that are positive ✅[^1]; `22 / 25 = 0.880`.
   - `recall = TP / (TP + FN)`, also called sensitivity or TPR (true positive rate): of the positives, the share flagged ✅[^1]; `22 / 100 = 0.220`.
   - `FPR = FP / (FP + TN)`, the false positive rate or false-alarm rate: of the negatives, the share flagged ✅[^3]; `3 / 9900 = 0.0003`.
   - `F_β = (1 + β²) · precision · recall / (β² · precision + recall)`, a weighted harmonic mean; β = 1 gives F1, β > 1 leans toward recall and β < 1 toward precision (the guide's example: precision 1.0 and recall 0.5 give F0.5 = 0.83 and F2 = 0.55) ✅[^1]; here `F1 = 2 · 0.880 · 0.220 / (0.880 + 0.220) = 0.352`. F1 sits near the worse of the two when they are far apart ✅[^3].
4. **Move the threshold, move the trade-off.** Raising the threshold tends to cut false positives and add false negatives, so precision and recall often move in opposite directions ✅[^3]. Every metric in step 3 belongs to one threshold and changes when it changes ✅[^3].
5. **Summarize all thresholds at once.**
   - The **ROC curve** plots TPR against FPR over every threshold; ROC-AUC is its area ✅[^1]. It equals the probability that the model ranks a randomly chosen positive above a randomly chosen negative: 1.0 is perfect, 0.5 is random guessing ✅[^4].
   - The **PR curve** plots precision against recall over every threshold ✅[^1]. scikit-learn summarizes it as AP (average precision), `AP = Σ_n (R_n − R_{n−1}) · P_n`, where `P_n` and `R_n` are precision and recall at the n-th threshold: each precision is weighted by the recall gained since the previous threshold ✅[^1]. AP is not interpolated, unlike a trapezoid area under the PR curve, which can be too optimistic ✅[^7].
   - **Baselines differ.** A random classifier's ROC curve is the diagonal for any class ratio, while the PR baseline is the positive share `P / (P + N)`, with P the number of positives and N the number of negatives: 0.5 at 1:1, 0.09 at 1:10 ✅[^5]. With random predictions, AP equals the fraction of positives ✅[^1].
6. **Pick by cost.** Recall matters when a missed positive is expensive, FPR when a false alarm is, precision when flagged items must be right ✅[^3]. On imbalanced data a PR curve may compare models better than a ROC curve ✅[^4], and only the PR curve changes when the positive-to-negative ratio changes ✅[^5].

## Worked example
Two parts, one script. Part 1: the 99:1 test set from the artifact, a model at three thresholds, each metric computed by hand from the confusion matrix and compared with scikit-learn. Part 2: a scorer whose score distributions per class never change (positives `N(1.5, 1)`, negatives `N(0, 1)`, where `N(μ, σ)` is a normal distribution with mean μ and standard deviation σ), with more and more negatives added. The core lines:

```python
pred = (proba > t).astype(int)                       # one threshold
tn, fp, fn, tp = confusion_matrix(yte, pred).ravel().tolist()
P, R = tp / (tp + fp), tp / (tp + fn)                # by hand, then checked against sklearn
pairs = (pos[:, None] > neg_all[None, :1_000]).mean()   # ROC-AUC as a ranking probability
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-24, scikit-learn 1.9.1, numpy 2.5.5, two runs identical ✅[^6]:

```text
test set: 10000 samples, 100 positives
always-negative  accuracy=0.9900  recall=0.0000
predict() == (proba > 0.5): True
t=0.5  TN=9897 FP=3   FN=78 TP=22 acc=0.9919 P=0.880 R=0.220 F1=0.352  hand==sklearn: True
t=0.2  TN=9880 FP=20  FN=45 TP=55 acc=0.9935 P=0.733 R=0.550 F1=0.629  hand==sklearn: True
t=0.05 TN=9707 FP=193 FN=41 TP=59 acc=0.9766 P=0.234 R=0.590 F1=0.335  hand==sklearn: True
threshold-free: ROC-AUC=0.784  AP=0.507
P(random positive scores above random negative), 1:1 = 0.8498
P:N = 1:1    base rate=0.5000  ROC-AUC=0.8498  PR-AUC (AP)=0.8464
P:N = 1:10   base rate=0.0909  ROC-AUC=0.8506  PR-AUC (AP)=0.4373
P:N = 1:100  base rate=0.0099  ROC-AUC=0.8525  PR-AUC (AP)=0.0980
```

<details><summary>Full script (prints the output above)</summary>

```python
import numpy as np
from sklearn.datasets import make_classification
from sklearn.dummy import DummyClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (accuracy_score, average_precision_score, confusion_matrix,
                             f1_score, precision_score, recall_score, roc_auc_score)
from sklearn.model_selection import train_test_split

# Part 1: a 99:1 dataset, the "always negative" model, then a real model at three thresholds
X, y = make_classification(n_samples=20_000, n_features=10, n_informative=4,
                           weights=[0.99], flip_y=0, class_sep=1.5, random_state=0)
Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.5, stratify=y, random_state=0)
print("test set:", len(yte), "samples,", int(yte.sum()), "positives")
p0 = DummyClassifier(strategy="most_frequent").fit(Xtr, ytr).predict(Xte)
print(f"always-negative  accuracy={accuracy_score(yte, p0):.4f}  recall={recall_score(yte, p0):.4f}")

clf = LogisticRegression(max_iter=1000).fit(Xtr, ytr)
proba = clf.predict_proba(Xte)[:, 1]
print("predict() == (proba > 0.5):", np.array_equal(clf.predict(Xte), (proba > 0.5).astype(int)))
for t in (0.5, 0.2, 0.05):
    pred = (proba > t).astype(int)
    tn, fp, fn, tp = confusion_matrix(yte, pred).ravel().tolist()
    acc, P, R = (tp + tn) / len(yte), tp / (tp + fp), tp / (tp + fn)
    F1 = 2 * P * R / (P + R)
    same = np.allclose([acc, P, R, F1], [accuracy_score(yte, pred), precision_score(yte, pred),
                                         recall_score(yte, pred), f1_score(yte, pred)])
    print(f"t={t:<4} TN={tn} FP={fp:<3} FN={fn:<2} TP={tp:<2} acc={acc:.4f} "
          f"P={P:.3f} R={R:.3f} F1={F1:.3f}  hand==sklearn: {same}")
print(f"threshold-free: ROC-AUC={roc_auc_score(yte, proba):.3f}  AP={average_precision_score(yte, proba):.3f}")

# Part 2: same score distributions per class, more and more negatives
rng = np.random.default_rng(0)
pos = rng.normal(1.5, 1.0, 1_000)            # scores of the 1,000 positives
neg_all = rng.normal(0.0, 1.0, 100_000)      # scores of up to 100,000 negatives
pairs = (pos[:, None] > neg_all[None, :1_000]).mean()
print(f"P(random positive scores above random negative), 1:1 = {pairs:.4f}")
for n_neg in (1_000, 10_000, 100_000):
    s = np.r_[pos, neg_all[:n_neg]]
    yy = np.r_[np.ones(1_000), np.zeros(n_neg)]
    print(f"P:N = 1:{n_neg // 1_000:<3}  base rate={1_000 / (1_000 + n_neg):.4f}  "
          f"ROC-AUC={roc_auc_score(yy, s):.4f}  PR-AUC (AP)={average_precision_score(yy, s):.4f}")
```
</details>

Reading it:
- **The accuracy paradox.** "Always negative" scores 0.9900 and finds nothing. The real model at the default threshold scores 0.9919, only 0.0019 better, while its recall of 0.220 means it misses 78 of 100 positives.
- **The threshold is a product decision.** Going from 0.5 to 0.2 more than doubles recall (0.220 → 0.550) at a precision cost (0.880 → 0.733); F1 is best of the three at 0.2. Going on to 0.05 buys 4 more true positives for 173 more false alarms, and accuracy drops below the "always negative" model (0.9766).
- **Hand formulas match the library** on every row (`hand==sklearn: True`).
- **ROC-AUC is a ranking probability.** The fraction of (positive, negative) pairs ranked correctly, 0.8498, equals `roc_auc_score` at 1:1.
- **Only PR-AUC sees the prevalence.** With the same scorer, ROC-AUC stays at 0.85 from 1:1 to 1:100, while AP falls from 0.846 to 0.098, close to ten times the 0.0099 base rate: at 1:100, most of what the scorer flags is a false alarm.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Model never predicts positive | Precision is 0/0, undefined ✅[^3]; `precision_score` then returns 0 with a warning by default, and its `zero_division` parameter sets another value ✅[^9] | No flagged samples, so the precision denominator `TP + FP` is 0 ✅[^3] |
| Only a handful of actual negatives | FPR jumps in big steps (4 negatives: one mistake = 25%) | Small denominator ✅[^3] |
| Only 1–2 actual positives | Precision becomes less meaningful and less useful ✅[^3] | Tiny counts; stratified folds can also hide the spread (`machine-learning/evaluation/cross-validation-and-hyperparameter-search.md`) |
| Score is a margin (SVM (support vector machine), `decision_function`), not a probability | ROC-AUC still works; the default threshold is 0, not 0.5 | `roc_curve` accepts probabilities or non-thresholded decision values ✅[^1]; `predict` cuts decision scores at 0 ✅[^2] |
| Multiclass `roc_auc_score` without `multi_class` | Error; pass `'ovr'` or `'ovo'` | The default is `'raise'` ✅[^8] |
| Macro-averaged F1 in multiclass | Mean of per-class F1, not F1 of mean precision and mean recall; micro-averaging over all classes equals accuracy | scikit-learn's averaging definitions ✅[^1] |
| Two ROC curves cross, or only the top of the ranking matters | Equal ROC-AUC can hide very different early-retrieval behaviour | Crossing curves make AUC comparisons unfair; in Saito & Rehmsmeier's simulation two classifiers both score AUC 0.8, one clearly better in the early-retrieval area ✅[^5] |
| Trapezoid area under the PR curve (`auc(recall, precision)`) | Can overstate performance compared with AP | Linear interpolation between PR points is overly optimistic ✅[^1] ✅[^7] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Accuracy | Simple; a coarse measure on balanced data ✅[^3] | Rewards the majority class on imbalanced data ✅[^3]; lab: 0.99 for a useless model ✅[^6] |
| Precision / recall at a chosen threshold | Maps to operational cost (missed positives vs false alarms) ✅[^3] | Valid for one threshold only ✅[^3]; two numbers to trade off |
| F1 (or Fβ) | Balances precision and recall in one number ✅[^3] | Ignores true negatives: `F1 = 2TP / (2TP + FP + FN)` ✅[^3]; still threshold-bound; β is a judgment call |
| ROC-AUC | Threshold-free; 0.5 baseline at any class ratio ✅[^5] | Can look strong on rare positives while precision is poor ✅[^5]; lab: 0.85 at 1:100 with AP 0.098 ✅[^6] |
| PR-AUC (average precision) | Tracks what flagged items are worth on imbalanced data ✅[^5] | Baseline moves with prevalence, so the area changes with the P:N ratio ✅[^5]; compare values only at the same positive rate |

## Takeaways
- Always report the confusion matrix and the base rate next to any single-number metric. [rule-candidate]
- On imbalanced data, report PR-AUC (average precision) beside ROC-AUC and compare it with the positive rate, its random baseline. [rule-candidate]
- Choose the threshold from the cost of a miss versus a false alarm, never by leaving the 0.5 default; tune it on validation data (`machine-learning/evaluation/class-imbalance.md`).
- A model must beat `DummyClassifier` on the metric you report, not only on accuracy.

## Verification status
- Verified: 52 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- [Metrics and scoring: quantifying the quality of predictions (User Guide 3.4)](https://scikit-learn.org/stable/modules/model_evaluation.html) — scikit-learn developers, living (1.9.1 docs). Backs: confusion-matrix layout and `ravel()` order, precision/recall/Fβ formulas, ROC curve, AP formula and random-AP baseline, macro/micro averaging, trapezoid optimism. [^1]
- [Tuning the decision threshold for class prediction (User Guide 3.3)](https://scikit-learn.org/stable/modules/classification_threshold.html) — scikit-learn developers, living. Backs: `predict` cut-offs 0.5 and 0, the default rule is rarely ideal. [^2]
- [Classification: Accuracy, recall, precision, and related metrics](https://developers.google.com/machine-learning/crash-course/classification/accuracy-precision-recall) — Google Machine Learning Crash Course, living. Backs: accuracy and FPR formulas, the 99% "always negative" example, metrics are per threshold, precision–recall inverse relationship, F1 near the worse value, small-denominator volatility, metric guidance. [^3]
- [Classification: ROC and AUC](https://developers.google.com/machine-learning/crash-course/classification/roc-and-auc) — Google Machine Learning Crash Course, living. Backs: AUC as the probability of ranking a random positive above a random negative, 0.5 for random, PR curves for imbalanced data. [^4]
- [The Precision-Recall Plot Is More Informative than the ROC Plot When Evaluating Binary Classifiers on Imbalanced Datasets](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0118432) — Saito & Rehmsmeier, PLoS ONE, 2015. Backs: ROC baseline fixed, PR baseline `P / (P + N)`, only PRC changes with the class ratio, equal AUC hiding early-retrieval differences. [^5]
- `machine-learning/lab-setup.md` — the lab where the 99:1 threshold sweep, the hand-vs-library check and the prevalence sweep ran on 2026-11-24. [^6]
- [sklearn.metrics.average_precision_score](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.average_precision_score.html) — scikit-learn developers, living. Backs: AP is not interpolated; trapezoid PR area can be too optimistic. [^7]
- [sklearn.metrics.roc_auc_score](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.roc_auc_score.html) — scikit-learn developers, living. Backs: `multi_class='raise'` default. [^8]
- [sklearn.metrics.precision_score](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.precision_score.html) — scikit-learn developers, living. Backs: `zero_division="warn"` acts like 0 and warns. [^9]

## Related
- `machine-learning/evaluation/metrics-catalog.md` — every metric with its scikit-learn function, range and best value.
- `machine-learning/evaluation/class-imbalance.md` — weights, resampling and threshold moving on rare classes.
- `machine-learning/evaluation/probability-calibration.md` — when a score of 0.8 really means 80%.
- `machine-learning/supervised-learning/logistic-regression.md` — where the probability scores come from.
- `machine-learning/foundations/generalization-and-overfitting.md` — why metrics are measured on held-out data.
- `machine-learning/evaluation/algorithmic-fairness.md` — the same metrics computed per group, and why group criteria conflict.
