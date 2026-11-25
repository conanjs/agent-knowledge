---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/evaluation
status: verified
applies-to: ["scikit-learn 1.9.1"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [machine-learning, evaluation, class-imbalance, base-rate, class-weight, oversampling, undersampling, smote, threshold-moving, tunedthresholdclassifiercv]
---

# Class imbalance: base rates, class weights, resampling and threshold moving

## Summary
**TL;DR:** When one class is rare, a model fitted to minimize average loss learns that "rare" is almost always the right bet against it, so at the default 0.5 threshold it flags almost nothing. Three families of fixes exist: weight the rare class's loss (`class_weight`), change the training mix (random over- or undersampling, SMOTE), or keep the model and lower the decision threshold. In the lab all three gave the same ranking quality (ROC-AUC, the area under the receiver operating characteristic curve: 0.974); the weighted and resampled models simply moved the cut-off, and in doing so inflated their predicted probabilities (mean 0.093 against a 0.02 base rate), while a tuned threshold on the unweighted model gave the best F1 and kept its probabilities honest.
**Use this when:** positives are a few percent or less (fraud, faults, rare diseases, churn), a model has high accuracy but low recall, or you must choose between `class_weight`, resampling and threshold tuning.
**Not this doc:** the metrics themselves (precision, recall, PR-AUC, the area under the precision-recall curve) → `machine-learning/evaluation/classification-metrics.md`; fixing distorted probabilities → `machine-learning/evaluation/probability-calibration.md`; why resampling before the split leaks → `machine-learning/evaluation/data-leakage.md`.

## Problem
Imbalanced data is the normal case: fraudulent purchases might make up less than 0.1% of card transactions, and a rare virus less than 0.01% of patients ✅[^1]. Training batches may then hold too few minority examples to learn from ✅[^1], accuracy is usually a poor metric ✅[^1], and the default rule predicts positive only above a probability of 0.5 ✅[^4], which a rare class seldom reaches: in the lab, a logistic regression with a 0.974 ROC-AUC found 5% of the positives at the default threshold ✅[^11]. The common fixes are often applied by reflex, all at once, and before the train/test split, which hides what each one does and can leak.

## Mental model
**Analogy:** a mail clerk who sees 49 ordinary letters for every urgent one and is scored on how many letters he labels correctly. He learns to stamp almost everything "ordinary". You can pay him 49 times more for each urgent letter he gets right than for an ordinary one (class weights 25 vs 0.51), train him on a pile with as many urgent as ordinary letters (resampling), or keep his judgment as it is and tell him to flag anything that looks even 11% urgent (threshold moving). All three make him flag more letters; only the last leaves his sense of "how likely is this urgent?" intact.

**Artifact:** the same 2%-positive training set and test set, five treatments; lab run (`machine-learning/lab-setup.md`), 2026-11-24, scikit-learn 1.9.1 ✅[^11]:

```text
method                 recall   prec     F1 bal.acc ROC-AUC     AP mean p
plain, t=0.5            0.050  0.119  0.070   0.521   0.974  0.274  0.021
class_weight=balanced   0.990  0.244  0.391   0.964   0.974  0.256  0.093
random oversampling     1.000  0.247  0.396   0.969   0.974  0.255  0.093
random undersampling    1.000  0.201  0.334   0.959   0.974  0.255  0.117
plain, tuned t (F1)     0.715  0.317  0.439   0.842   0.974  0.274  0.021
```

## How it works
1. **The base rate sets the default behaviour.** The base rate (prior) is the share of positives, here `200 / 10000 = 0.02`. A model needs to learn both what each class looks like and how common each class is, and ordinary training mixes the two goals ✅[^1]. A well-fitted logistic regression's mean predicted probability tracks the base rate (0.021 vs 0.0200 in the lab ✅[^11]), so few samples reach 0.5. For metrics, the PR curve's random baseline is the positive share, while ROC's is fixed ✅[^9], and balanced accuracy, the mean of per-class recall, drops to `1 / n_classes` for a model that only exploits the imbalance ✅[^10].
2. **Class weights scale each sample's loss.** `class_weight="balanced"` sets `w_c = n_samples / (n_classes · count_c)`, where `n_samples` is the training-set size, `n_classes` the number of classes and `count_c` the rows of class `c` ✅[^2] ✅[^3]. Here `10000 / (2 · 9800) = 0.51` for negatives and `10000 / (2 · 200) = 25` for positives, which `compute_class_weight` reproduces ✅[^11]. The weights multiply any `sample_weight` ✅[^2]. For logistic regression, weighting a class by an integer k gave the same fit as repeating each of its rows k times: in the lab (k = 10, default solver) the coefficients differed by at most `3.11e-15` ✅[^11].
3. **Resampling changes the training mix.**
   - *Random oversampling* draws extra minority rows with replacement until the classes match ✅[^7]; by step 2 it behaves like a weight, and in the lab it matched `class_weight="balanced"` closely (F1 0.396 vs 0.391) ✅[^11].
   - *Random undersampling* drops majority rows. The Google course pairs it with *upweighting*: downsample the majority class by a factor (say 25), then multiply its loss by the same factor, so the model sees enough positives per batch and still learns the true class distribution ✅[^1]. The factors are hyperparameters to tune ✅[^1].
   - *SMOTE* (Synthetic Minority Over-sampling Technique) creates new minority rows instead of copies ✅[^6]: for a minority row `x_i`, it picks one of its k nearest neighbours (`k_neighbors`) `x_zi` and generates `x_new = x_i + λ · (x_zi − x_i)`, with λ (lambda) drawn at random in [0, 1], a point on the segment between the two ✅[^7]. Example: `x_i = (1, 2)`, `x_zi = (3, 2)`, `λ = 0.25` gives `(1.5, 2)`. The SMOTE paper reports that combining it with undersampling the majority can achieve better performance in ROC space than undersampling alone, in experiments with C4.5, Ripper and naive Bayes ✅[^6]. Plain SMOTE does not handle categorical features; SMOTE-NC is the variant for mixed data ✅[^7]. (SMOTE lives in the separate `imbalanced-learn` package; the lab here did not run it.)
   - *Where:* on training folds only, inside a pipeline; resampling the whole dataset leaks and balances the test set ✅[^8].
4. **Threshold moving keeps the model and changes the decision.** Scores answer "how likely?"; the threshold answers "act or not?" ✅[^4]. `TunedThresholdClassifierCV` picks the threshold that maximizes a metric by internal cross-validation ✅[^4]: by default balanced accuracy over 100 candidate thresholds ✅[^5], with 5-fold stratified cross-validation (CV) ✅[^4], and then refits the classifier on the whole training set (`refit=True` by default) ✅[^5]. The guide warns to choose a metric that is meaningful for the use case ✅[^4]. In the lab, F1 chose `t = 0.109` ✅[^11].
5. **What each fix does to probabilities.** Downsampling shows the model an artificial world where the classes are more balanced than the real one, which the Google course calls prediction bias ✅[^1]; weights and oversampling change the effective class mix the same way (step 2). In the lab, the mean predicted probability rose from 0.021 to 0.093 (weights, oversampling) and 0.117 (undersampling) for a true rate of 0.02 ✅[^11]. If probabilities are used as probabilities, recalibrate on data with the real class ratio (`machine-learning/evaluation/probability-calibration.md`) or prefer threshold moving.

## Worked example
The run behind the artifact: `make_classification` with 20,000 rows and 2% positives, split 50/50 with stratification; each treatment trains a logistic regression on the training half only and is scored on the untouched test half (100 positives). Oversampling and undersampling are written in numpy:

```python
pos, neg = np.flatnonzero(ytr == 1), np.flatnonzero(ytr == 0)
over = np.r_[neg, pos, rng.choice(pos, n_neg - n_pos, replace=True)]   # copy positives
under = np.r_[rng.choice(neg, n_pos, replace=False), pos]              # drop negatives
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-24, scikit-learn 1.9.1, numpy 2.5.5, two runs identical ✅[^11]:

```text
train: 9800 negatives, 200 positives, base rate 0.0200
balanced weights [ 0.51 25.  ]  by hand n/(2*count): [ 0.51 25.  ]
method                 recall   prec     F1 bal.acc ROC-AUC     AP mean p
plain, t=0.5            0.050  0.119  0.070   0.521   0.974  0.274  0.021
class_weight=balanced   0.990  0.244  0.391   0.964   0.974  0.256  0.093
random oversampling     1.000  0.247  0.396   0.969   0.974  0.255  0.093
random undersampling    1.000  0.201  0.334   0.959   0.974  0.255  0.117
plain, tuned t (F1)     0.715  0.317  0.439   0.842   0.974  0.274  0.021
tuned threshold: 0.109
k=10: max |coef(duplicated) - coef(class_weight)| = 3.11e-15
```

<details><summary>Full script (prints the output above)</summary>

```python
import numpy as np
from sklearn.datasets import make_classification
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (average_precision_score, balanced_accuracy_score, f1_score,
                             precision_score, recall_score, roc_auc_score)
from sklearn.model_selection import TunedThresholdClassifierCV, train_test_split
from sklearn.utils.class_weight import compute_class_weight

X, y = make_classification(n_samples=20_000, n_features=10, n_informative=4, weights=[0.98],
                           flip_y=0, class_sep=1.5, random_state=1)
Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.5, stratify=y, random_state=0)
n_neg, n_pos = np.bincount(ytr)
print(f"train: {n_neg} negatives, {n_pos} positives, base rate {n_pos / len(ytr):.4f}")
w = compute_class_weight("balanced", classes=np.array([0, 1]), y=ytr)
print("balanced weights", np.round(w, 3), " by hand n/(2*count):",
      np.round([len(ytr) / (2 * n_neg), len(ytr) / (2 * n_pos)], 3))

rng = np.random.default_rng(0)
pos, neg = np.flatnonzero(ytr == 1), np.flatnonzero(ytr == 0)
over = np.r_[neg, pos, rng.choice(pos, n_neg - n_pos, replace=True)]   # copy positives
under = np.r_[rng.choice(neg, n_pos, replace=False), pos]              # drop negatives
LR = lambda **kw: LogisticRegression(max_iter=1000, **kw)
models = {
    "plain, t=0.5": LR().fit(Xtr, ytr),
    "class_weight=balanced": LR(class_weight="balanced").fit(Xtr, ytr),
    "random oversampling": LR().fit(Xtr[over], ytr[over]),
    "random undersampling": LR().fit(Xtr[under], ytr[under]),
    "plain, tuned t (F1)": TunedThresholdClassifierCV(LR(), scoring="f1").fit(Xtr, ytr),
}
print(f"{'method':<22} {'recall':>6} {'prec':>6} {'F1':>6} {'bal.acc':>7} {'ROC-AUC':>7} "
      f"{'AP':>6} {'mean p':>6}")
for name, m in models.items():
    pred = m.predict(Xte)
    p = m.predict_proba(Xte)[:, 1]
    print(f"{name:<22} {recall_score(yte, pred):6.3f} {precision_score(yte, pred, zero_division=0):6.3f} "
          f"{f1_score(yte, pred):6.3f} {balanced_accuracy_score(yte, pred):7.3f} "
          f"{roc_auc_score(yte, p):7.3f} {average_precision_score(yte, p):6.3f} {p.mean():6.3f}")
print("tuned threshold:", round(models["plain, tuned t (F1)"].best_threshold_, 3))

# Duplicating each positive k times gives the same fit as weighting positives by k
k = 10
dup = np.r_[neg, np.repeat(pos, k)]
a = LR(tol=1e-10).fit(Xtr[dup], ytr[dup]).coef_
b = LR(tol=1e-10, class_weight={0: 1, 1: k}).fit(Xtr, ytr).coef_
print(f"k={k}: max |coef(duplicated) - coef(class_weight)| = {np.abs(a - b).max():.2e}")
```
</details>

Reading it:
- **Ranking did not change.** ROC-AUC is 0.974 for all five, and AP (average precision) varies only between 0.255 and 0.274. None of the fixes made the model better at telling positives from negatives; they changed where the line is drawn.
- **The default threshold is the problem.** Plain at 0.5: recall 0.050 and balanced accuracy 0.521, barely above the 0.5 a majority-only model gets.
- **Weights and oversampling are the same move.** Their rows are nearly identical, as step 2 predicts, and both land at almost every positive found (recall 0.99–1.00) for one true alarm in four (precision 0.24–0.25). Undersampling, trained on 400 of the 10,000 rows, lands at a lower precision (0.201).
- **The tuned threshold wins on the metric it was tuned for.** Threshold moving on the unweighted model picks 0.109, far below 0.5, and has the best F1 (0.439) and precision (0.317), at a recall of 0.715.
- **Probabilities.** The tuned model's mean probability stays at 0.021, the base rate; the others report four to six times the real rate.
- **Duplication equals weighting.** Repeating each positive 10 times and `class_weight={0: 1, 1: 10}` give coefficients that differ by at most `3.11e-15`, floating-point noise.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Resampling before the train/test split | Optimistic CV, a balanced test set unlike production | Leak and wrong test distribution ✅[^8] |
| Probabilities used downstream (expected cost, ranking across models) after weighting or resampling | Systematically too high for the rare class; lab: 0.093–0.117 vs 0.02 ✅[^11] | Prediction bias from the artificial class mix ✅[^1] |
| Choosing the threshold on the training data | Optimistic threshold | Never use the same data for training the classifier and tuning the threshold ✅[^4] |
| `TunedThresholdClassifierCV` left at its default metric | Optimizes balanced accuracy, which may not be your goal | Default `scoring="balanced_accuracy"` ✅[^5]; pass the metric (and `pos_label`) you care about ✅[^4] |
| SMOTE on mixed numeric and categorical data | Interpolated categories are meaningless | SMOTE assumes numeric features; use SMOTE-NC ✅[^7] |
| SMOTE near outliers | Might connect inliers and outliers, which might lead to a sub-optimal decision function | ✅[^7] |
| Extreme imbalance, a handful of positives | Precision becomes less meaningful and less useful | With 1–2 positives in total ✅[^12] |
| Stratified CV folds on rare classes | Every fold has positives, but fold spread understates uncertainty | `machine-learning/evaluation/cross-validation-and-hyperparameter-search.md` |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `class_weight="balanced"` | One constructor argument ✅[^2] | Shifts probabilities away from the real rate ✅[^11] |
| Random oversampling | Works on heterogeneous data, strings included ✅[^7] | Larger training set; same effect as weights here ✅[^11]; repeated rows |
| Random undersampling + upweighting | Smaller, faster training; batches with enough positives ✅[^1] | Throws data away; factor must be tuned ✅[^1] |
| SMOTE | New minority points by interpolation, not copies ✅[^7] | Extra package; numeric features only ✅[^7]; might connect inliers and outliers ✅[^7] |
| Threshold moving | Leaves `predict_proba` unchanged and is tuned to the metric you pick ✅[^4]; best F1 in the lab ✅[^11] | Needs held-out data or internal CV ✅[^4]; one threshold per deployment condition |

## Takeaways
- First move the threshold on a well-fitted model and measure with a metric that respects the base rate (PR-AUC, recall at a fixed precision); add weights or resampling only if they beat that. [rule-candidate]
- Resample only inside the training folds of a pipeline, never before splitting. [rule-candidate]
- After `class_weight` or resampling, do not read `predict_proba` as a real-world probability without recalibrating. [rule-candidate]
- Report the base rate with every metric; a model that does not beat the majority-class baseline on balanced accuracy or PR-AUC has learned nothing useful.

## Verification status
- Verified: 55 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- [Datasets: Class-imbalanced datasets](https://developers.google.com/machine-learning/crash-course/overfitting/imbalanced-datasets?hl=en) — Google Machine Learning Crash Course, living. Backs: fraud and virus rates, batches without minority examples, accuracy as a poor metric, the two things a model learns, downsampling + upweighting, prediction bias, factors as hyperparameters. [^1]
- [sklearn.linear_model.LogisticRegression](https://scikit-learn.org/stable/modules/generated/sklearn.linear_model.LogisticRegression.html) — scikit-learn developers, living (1.9.1 docs). Backs: `class_weight="balanced"` formula, multiplied with `sample_weight`. [^2]
- [sklearn.utils.class_weight.compute_class_weight](https://scikit-learn.org/stable/modules/generated/sklearn.utils.class_weight.compute_class_weight.html) — scikit-learn developers, living. Backs: the balanced formula. [^3]
- [Tuning the decision threshold for class prediction (User Guide 3.3)](https://scikit-learn.org/stable/modules/classification_threshold.html) — scikit-learn developers, living. Backs: prediction vs decision, `TunedThresholdClassifierCV` by internal CV, 5-fold stratified default, choose the metric, never tune on training data. [^4]
- [sklearn.model_selection.TunedThresholdClassifierCV](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TunedThresholdClassifierCV.html) — scikit-learn developers, living. Backs: default `scoring="balanced_accuracy"`, `thresholds=100`, `refit=True`. [^5]
- [SMOTE: Synthetic Minority Over-sampling Technique](https://arxiv.org/abs/1106.1813) — Chawla, Bowyer, Hall, Kegelmeyer, 2002 (JAIR; arXiv abstract). Backs: synthetic minority examples, SMOTE + undersampling beats undersampling alone in ROC space. [^6]
- [Over-sampling (imbalanced-learn User Guide 2)](https://imbalanced-learn.org/stable/over_sampling.html) — imbalanced-learn developers, living. Backs: random oversampling with replacement, SMOTE interpolation formula, inlier–outlier issue, SMOTE-NC for categorical features. [^7]
- [Common pitfalls and recommended practices (imbalanced-learn)](https://imbalanced-learn.org/stable/common_pitfalls.html) — imbalanced-learn developers, living. Backs: resampling before the split leaks and balances the test set; use a pipeline. [^8]
- [The Precision-Recall Plot Is More Informative than the ROC Plot When Evaluating Binary Classifiers on Imbalanced Datasets](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0118432) — Saito & Rehmsmeier, PLoS ONE, 2015. Backs: PR baseline equals the positive share, ROC baseline fixed. [^9]
- [Metrics and scoring (User Guide 3.4)](https://scikit-learn.org/stable/modules/model_evaluation.html) — scikit-learn developers, living. Backs: balanced accuracy definition and its `1 / n_classes` floor. [^10]
- `machine-learning/lab-setup.md` — the lab where the five treatments, the balanced-weight check and the duplication-equals-weighting check ran on 2026-11-24. [^11]
- [Classification: Accuracy, recall, precision, and related metrics](https://developers.google.com/machine-learning/crash-course/classification/accuracy-precision-recall) — Google Machine Learning Crash Course, living. Backs: precision less meaningful with 1–2 positives. [^12]

## Related
- `machine-learning/evaluation/classification-metrics.md` — precision, recall, PR-AUC and why accuracy misleads.
- `machine-learning/evaluation/probability-calibration.md` — restoring probabilities after weighting or resampling.
- `machine-learning/evaluation/data-leakage.md` — resampling inside the training folds only.
- `machine-learning/supervised-learning/logistic-regression.md` — the model used here and its `class_weight`.
- `machine-learning/supervised-learning/k-nearest-neighbors.md` — the neighbour search SMOTE relies on.
