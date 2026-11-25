---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/evaluation
status: verified
applies-to: ["any"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, evaluation, fairness, demographic-parity, equalized-odds, equal-opportunity, calibration-within-groups, predictive-parity, impossibility-theorem, threshold-optimizer, fairlearn, proxy-features]
---

# Algorithmic fairness: group criteria, impossibility results and mitigations

## Summary
**TL;DR:** Group fairness compares how a model treats groups defined by a sensitive attribute. Three families of criteria exist: independence (demographic parity: equal selection rates), separation (equalized odds: equal true and false positive rates; equal opportunity: equal true positive rates only) and sufficiency (a score means the same in every group: calibration within groups, equal precision). When the groups' base rates differ and prediction is imperfect, they cannot all hold: a score calibrated within groups cannot also give equal average scores to the positives and to the negatives of both groups (Kleinberg et al.), and a classifier with equal precision across groups cannot have equal false positive and false negative rates unless it makes no false positives at all (Chouldechova). Mitigations act before training (transform the data), during training (a constraint in the objective) or after it (per-group thresholds). Dropping the group column does not remove a disparity that other features still encode. A metric measures a gap; it cannot say which criterion is right or why the gap exists.
**Use this when:** you audit a model's error rates or selection rates by group, someone claims a model is fair because it is calibrated (or unfair because its error rates differ), you choose between demographic parity, equalized odds and equal opportunity, consider per-group thresholds, or plan to "remove the protected attribute".
**Not this doc:** the confusion matrix, true positive rate and precision themselves → `machine-learning/evaluation/classification-metrics.md`; picking one threshold for cost or imbalance → `machine-learning/evaluation/class-imbalance.md`; calibration methods and reliability curves → `machine-learning/evaluation/probability-calibration.md`; why a gap exists (causal paths, confounders) → `machine-learning/causal-inference/causal-graphs-and-confounding.md`; coverage that holds per group for prediction sets → `machine-learning/evaluation/conformal-prediction.md`.

## Problem
A model can score well overall and still treat two groups differently, and the obvious checks disagree. In the lab, a score calibrated within each group (every score bin within 0.006 of the observed rate in both groups) selected 59.9 % of group A and 28.2 % of group B at one threshold, and wrongly flagged 33.2 % of A's negatives against 13.1 % of B's ✅[^11]. One reviewer calls it fair (the scores mean the same thing in both groups), another unfair (A's negatives are flagged 2.5 times as often): both read the numbers correctly. With unequal base rates and imperfect prediction, the papers below prove that a score calibrated within groups cannot also give the negatives (and the positives) of both groups the same average score ✅[^2], and that a yes/no decision with equal precision in both groups cannot have equal false positive and false negative rates ✅[^3]. The usual quick fix, deleting the group column, leaves the disparity in place when other features encode the group ✅[^1].

## Mental model
**Analogy:** one entrance exam for two schools whose students pass the course at different rates. You can ask the exam for three promises: the same admission rate in both schools; among students who would pass, the same chance of admission (and among those who would fail, the same chance of being wrongly admitted); and an admission meaning the same chance of passing in both schools. Unless the pass rates are equal or the exam never admits a student who would fail, it cannot keep the last two promises together, and the first promise rules out even a perfect exam. Fairness work is choosing which promise to keep, and saying so.

**Artifact:** the criteria for a binary decision `Ŷ` (1 = selected) made from a score `R`, the true outcome `Y` and the group `G` (the literature writes the attribute as `A`). TPR is the true positive rate, FPR the false positive rate, FNR = 1 − TPR the false negative rate, and PPV the positive predictive value (precision); `classification-metrics.md` defines them. Lab values for one threshold of 0.5 on the calibrated score, printed by the full script in the Worked example ✅[^11]:

| Criterion (family) | Condition, for all groups g | Plain question | Lab, A vs B |
|---|---|---|---|
| Demographic parity (independence) | `P(Ŷ=1 \| G=g)` equal | Same selection rate? | 0.599 vs 0.282 |
| Equal opportunity (relaxed separation) | `P(Ŷ=1 \| Y=1, G=g)` equal | Positives selected equally often (TPR)? | 0.803 vs 0.564 |
| Equalized odds (separation) | TPR and `P(Ŷ=1 \| Y=0, G=g)` (FPR) equal | Both error rates equal? | FPR 0.332 vs 0.131 |
| Predictive parity (part of sufficiency, for `Ŷ`) | `P(Y=1 \| Ŷ=1, G=g)` (PPV) equal | Does a "selected" mean the same? | 0.759 vs 0.697 |
| Calibration within groups (sufficiency, for `R`) | `P(Y=1 \| R=r, G=g) = r` | Does a score of r mean r in each group? | max bin gap 0.006 vs 0.005 |

## How it works
### Groups and the three families
1. **The sensitive attribute.** `G` is a discrete variable whose values split the population into disjoint groups; several attributes can be merged into one variable, but that formal step does not capture intersectionality, the particular disadvantage of people in several protected categories at once ✅[^1]. Seemingly neutral features can together predict `G` with high accuracy, so features do not split cleanly into "neutral" and "sensitive" ✅[^1].
2. **Three statistics to equalize.** Barocas, Hardt and Narayanan reduce the many proposed criteria to three that each equalize one statistic across groups: the acceptance rate (independence, `R ⊥ G`), the error rates (separation, `R ⊥ G | Y`) and the outcome frequency at a given score (sufficiency, `Y ⊥ G | R`); `⊥` reads "is independent of" and `| Y` "within each value of Y" ✅[^1]. All three are properties of the joint distribution of score, group and outcome, so they can be checked from data alone ✅[^1].
3. **Independence = demographic parity.** Also called statistical parity, group fairness or disparate impact ✅[^1]. A ratio relaxation `P(Ŷ=1|G=a) / P(Ŷ=1|G=b) ≥ 1 − ε` with `ε = 0.2` has been linked by some authors to the "80 percent rule" ✅[^1] (lab ratio: `0.282 / 0.599 = 0.47`). Fairlearn's documentation calls that four-fifths rule often misapplied: it comes from one area of US employment law, and using it as a pass mark can conflate fairness with legality ✅[^6]. Its flaws: it allows accepting qualified people in one group and unqualified ones in another at the same rate, and it forbids the perfect predictor `Ŷ = Y` whenever `Y` depends on the group ✅[^4]; Google's course adds that it ignores how many people in each group are qualified ✅[^8].
4. **Separation = equalized odds; equal opportunity.** Equalized odds asks `Ŷ` and `G` to be independent given `Y`: equal TPR and equal FPR ✅[^4]. It always allows the perfect predictor, and it penalizes models that are accurate only on the majority ✅[^4]. Equal opportunity keeps only the TPR condition for the "advantaged" outcome `Y = 1` (repaying a loan, being admitted) ✅[^4]; Google's course notes it fits only cases with a clear-cut preferred label ✅[^9]. When the positive label is the harmful one (high risk), false positives and false negatives swap meanings, a frequent source of confusion ✅[^1].
5. **Sufficiency = calibration within groups.** A score calibrated in each group satisfies sufficiency, and a score that satisfies sufficiency can be relabelled to be calibrated in each group ✅[^1]. Unconstrained learning often delivers it for free: the optimal score `E[Y | X]` is calibrated for every group, but only when group membership is encoded in or predictable from the features; otherwise group calibration generally fails ✅[^1]. Turning a calibrated score into a yes/no decision can still give different PPVs per group ✅[^1] ✅[^3].

### Why the criteria conflict
1. **Kleinberg, Mullainathan and Raghavan.** Their three conditions for a risk score are (A) calibration within groups, (B) balance for the negative class (negatives get the same average score in both groups) and (C) balance for the positive class ✅[^2]. Theorem 1.1: if a score satisfies all three, the instance has perfect prediction (every outcome is certain) or equal base rates ✅[^2]. The result holds however the score is computed, by an algorithm or by people, and an approximate version holds for approximately satisfied conditions ✅[^2].
2. **The proof in one line.** Calibration makes the scores in group t add up to its number of positives. Write `x` for the average score of negatives, `y` for that of positives (the same in both groups by B and C), `p_t` for the base rate (share of positives) of group t; dividing by the group size gives `(1 − p_t)·x + p_t·y = p_t` ✅[^2]. Two groups give two lines in `(x, y)`; with `p_1 ≠ p_2` they cross only at `(0, 1)`, perfect prediction ✅[^2]. Lab, group A: `p = 0.566`, `x = 0.396`, `y = 0.698`, so `0.434·0.396 + 0.566·0.698 = 0.567` ✅[^11]. Group B has `x = 0.246`, `y = 0.540`: balance fails for both classes.
3. **Chouldechova.** For a yes/no decision, prevalence (base rate) `p`, PPV, FPR and FNR are tied by `FPR = p/(1−p) · (1−PPV)/PPV · (1−FNR)` ✅[^3]. With equal PPV and unequal `p`, the groups cannot have both equal FPR and equal FNR; the higher-prevalence group generally gets the higher FPR and the lower FNR ✅[^3]. Example, lab group B: `p = 0.348`, PPV 0.697, FNR 0.436 give `0.534 · 0.435 · 0.564 = 0.131`, its FPR ✅[^11].
4. **Pairs of criteria.** Each result assumes `G` and `Y` are dependent (unequal base rates). Then independence and sufficiency cannot both hold; if also `Y` is binary and the score is informative about `Y`, independence and separation cannot both hold; and if every combination of group, score and outcome has positive probability, separation and sufficiency cannot both hold, so optimal (calibrated) scores generally violate separation ✅[^1]. All of them pair two criteria on the same variable (the score, or the decision); separation of a thresholded decision together with sufficiency of the score behind it is not covered ✅[^1], which is why per-group thresholds on a calibrated score can bring both error rates close together (Worked example, block 3: TPR 0.803 vs 0.789, FPR 0.332 vs 0.316) ✅[^11].

### Mitigation: before, during or after training
1. **Pre-processing** transforms the features so they are independent of the group; any deterministic training on them afterwards inherits that independence ✅[^1]. Fairlearn's `CorrelationRemover` removes correlation between sensitive and other features through linear transformations ✅[^7].
2. **In-training** puts the constraint into the optimization; it can reach the best utility but needs the raw data and the training pipeline and usually suits only some model classes ✅[^1]. Fairlearn's reductions `ExponentiatedGradient` and `GridSearch` wrap an estimator this way ✅[^7]; Google's course describes loss terms such as MinDiff, which penalizes differences between the two groups' prediction distributions ✅[^10].
3. **Post-processing** adjusts a trained score, possibly using the group and randomness ✅[^1]. Hardt et al.'s derived predictor is a (possibly randomized) function of the score and the group only; building it needs the joint distribution of score, group and outcome, applying it needs only the score and the group ✅[^4]. Post-processing the Bayes-optimal score gives the optimal classifier among those satisfying separation ✅[^1]. Equal opportunity needs only per-group thresholds; equalized odds may need randomized ones, because only the trade-offs under both groups' ROC (receiver operating characteristic) curves are reachable ✅[^4] ✅[^1]. Fairlearn's `ThresholdOptimizer` implements this ✅[^7]. The common objection: the rule uses group membership explicitly ✅[^1].
4. **Guarantees are about the metric.** Fairlearn's mitigations guarantee how close they drive an unfairness metric to zero, which does not mean the results are fair, and they may return randomized predictions ✅[^7].

### Measuring, and what the numbers cannot settle
1. **Disparity metrics.** `demographic_parity_difference` is the largest minus the smallest selection rate across groups and `demographic_parity_ratio` the smallest over the largest; `equalized_odds_difference` is the larger of the TPR difference and the FPR difference ✅[^6] ✅[^5]. Lab, one threshold: `0.599 − 0.282 = 0.317` and `max(0.239, 0.201) = 0.239` ✅[^11].
2. **Disaggregate, carefully.** A gap can shrink or reverse inside finer categories (Simpson's paradox), but finer groups are smaller, so their gaps are noisier and checking many of them invites multiple-comparison errors ✅[^6].
3. **No fairness through unawareness.** With many features slightly correlated with the group, a model trained without the group column finds a redundant encoding of it and can implement an essentially equivalent classifier ✅[^1].
4. **Observational limits.** These criteria hide the mechanism: the same selection-rate gap may come from a decision maker's prejudice or from an inequality outside the decision maker's control ✅[^1]. Hardt et al. show that different dependency structures, with different intuitive verdicts, cannot be told apart by any test that uses only the joint statistics ✅[^4]. Causal questions → `machine-learning/causal-inference/causal-graphs-and-confounding.md`.
5. **The target itself.** Separation treats `Y` as merit; if `Y` reflects existing inequality, matching error rates on it does no good ✅[^1]. Fairlearn defines unfair behaviour by its harms to people, not by causes or intent, calls deployed ML (machine learning) systems inherently sociotechnical, and lists stereotyping and erasure harms besides the allocation and quality-of-service harms the library targets because they are the easiest to measure ✅[^5].

## Worked example
200,000 synthetic people, half in group A and half in group B, three features with the same distribution in both groups, and a label rule with a group term, so base rates differ (0.566 vs 0.348). Five extra "proxy" columns each shift by 0.8 standard deviations in group B. A logistic regression is fitted on one half and evaluated on the other. Core lines:

```python
logit = 1.2 * x[:, 0] + 0.8 * x[:, 1] - 0.6 * x[:, 2] + np.where(g == 0, 0.4, -0.9)
y = rng.random(n) < 1 / (1 + np.exp(-logit))
proxy = 0.8 * (g == 1)[:, None] + rng.normal(0, 1, (n, 5))
t = per_group(lambda k: np.quantile(s_tr[(g[tr] == k) & y[tr]], 1 - tpr))   # equal opportunity
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-25, numpy 2.5.5, scikit-learn 1.9.1, two runs identical ✅[^11]:

```text
== 1. a score calibrated within each group ==
group A: base rate 0.566  mean score 0.567  max bin gap 0.006  mean score of negatives 0.396  of positives 0.698  (1-p)*neg + p*pos = 0.567
group B: base rate 0.348  mean score 0.348  max bin gap 0.005  mean score of negatives 0.246  of positives 0.540  (1-p)*neg + p*pos = 0.348
== 2. one threshold for everyone ==
single threshold 0.5   t_A 0.500 t_B 0.500 acc 0.754 | A: sel 0.599 TPR 0.803 FPR 0.332 PPV 0.759 | B: sel 0.282 TPR 0.564 FPR 0.131 PPV 0.697
group A: FPR 0.3323 = p/(1-p) * (1-PPV)/PPV * (1-FNR) = 0.3323
group B: FPR 0.1307 = p/(1-p) * (1-PPV)/PPV * (1-FNR) = 0.1307
== 3. per-group thresholds, chosen on the training half ==
equal opportunity 0.70 t_A 0.604 t_B 0.393 acc 0.742 | A: sel 0.493 TPR 0.699 FPR 0.225 PPV 0.802 | B: sel 0.382 TPR 0.691 FPR 0.217 PPV 0.630
equal opportunity 0.80 t_A 0.501 t_B 0.306 acc 0.733 | A: sel 0.598 TPR 0.803 FPR 0.332 PPV 0.760 | B: sel 0.480 TPR 0.789 FPR 0.316 PPV 0.572
equal opportunity 0.90 t_A 0.367 t_B 0.197 acc 0.686 | A: sel 0.725 TPR 0.899 FPR 0.497 PPV 0.702 | B: sel 0.628 TPR 0.893 FPR 0.486 PPV 0.495
demographic parity     t_A 0.653 t_B 0.340 acc 0.727 | A: sel 0.441 TPR 0.640 FPR 0.181 PPV 0.822 | B: sel 0.440 TPR 0.753 FPR 0.274 PPV 0.595
== 4. drop the group column: the proxies still carry it ==
group predicted from proxy 1 alone: ROC-AUC 0.714
group predicted from the 5 proxies: ROC-AUC 0.897
with group              acc 0.754  selection A 0.599 B 0.282  gap 0.317  mean score - base rate: A +0.001 B +0.000
no group, proxies kept  acc 0.738  selection A 0.510 B 0.364  gap 0.146  mean score - base rate: A -0.060 B +0.061
no group, no proxies    acc 0.727  selection A 0.436 B 0.436  gap 0.000  mean score - base rate: A -0.109 B +0.110
```

<details><summary>Full script (prints the output above)</summary>

```python
# Group fairness metrics on synthetic data with two groups A and B whose base rates differ:
# a calibrated score, the Chouldechova and Kleinberg identities, per-group thresholds
# (equal opportunity, demographic parity) and their accuracy cost, and a proxy feature.
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score

rng = np.random.default_rng(0)
n = 200_000
g = rng.integers(0, 2, n)                       # 0 = group A, 1 = group B
x = rng.normal(0, 1, (n, 3))                    # three ordinary features, same for both groups
logit = 1.2 * x[:, 0] + 0.8 * x[:, 1] - 0.6 * x[:, 2] + np.where(g == 0, 0.4, -0.9)
y = rng.random(n) < 1 / (1 + np.exp(-logit))    # label rule depends on the group
proxy = 0.8 * (g == 1)[:, None] + rng.normal(0, 1, (n, 5))   # five weak stand-ins for the group
tr, te = np.arange(n) < n // 2, np.arange(n) >= n // 2

def fit(X):
    m = LogisticRegression(max_iter=1000).fit(X[tr], y[tr])
    return m.predict_proba(X[te])[:, 1]

def rates(s, t, label):                          # t: a threshold per test row
    yt, gt, yhat = y[te], g[te], s >= t
    tA, tB = np.broadcast_to(t, s.shape)[gt == 0][0], np.broadcast_to(t, s.shape)[gt == 1][0]
    print(f"{label:<22} t_A {tA:.3f} t_B {tB:.3f} acc {np.mean(yhat == yt):.3f}", end="")
    for k, name in ((0, "A"), (1, "B")):
        m = gt == k
        tp = np.sum(yhat & yt & m); fp = np.sum(yhat & ~yt & m)
        fn = np.sum(~yhat & yt & m); tn = np.sum(~yhat & ~yt & m)
        print(f" | {name}: sel {(tp + fp) / m.sum():.3f} TPR {tp / (tp + fn):.3f}"
              f" FPR {fp / (fp + tn):.3f} PPV {tp / (tp + fp):.3f}", end="")
    print()

s = fit(np.column_stack([x, g]))                 # the score is allowed to see the group
yt, gt = y[te], g[te]
print("== 1. a score calibrated within each group ==")
for k, name in ((0, "A"), (1, "B")):
    m = gt == k
    p, xm, ym = yt[m].mean(), s[m & ~yt].mean(), s[m & yt].mean()
    bins = np.digitize(s[m], [0.2, 0.4, 0.6, 0.8])
    gap = max(abs(s[m][bins == b].mean() - yt[m][bins == b].mean()) for b in range(5))
    print(f"group {name}: base rate {p:.3f}  mean score {s[m].mean():.3f}  max bin gap {gap:.3f}"
          f"  mean score of negatives {xm:.3f}  of positives {ym:.3f}"
          f"  (1-p)*neg + p*pos = {(1 - p) * xm + p * ym:.3f}")
print("== 2. one threshold for everyone ==")
rates(s, 0.5, "single threshold 0.5")
for k, name in ((0, "A"), (1, "B")):
    m = gt == k
    yhat = s[m] >= 0.5; tp = np.sum(yhat & yt[m]); fp = np.sum(yhat & ~yt[m])
    fn = np.sum(~yhat & yt[m]); tn = np.sum(~yhat & ~yt[m]); p = yt[m].mean()
    ppv, fnr = tp / (tp + fp), fn / (tp + fn)
    print(f"group {name}: FPR {fp / (fp + tn):.4f} = p/(1-p) * (1-PPV)/PPV * (1-FNR) = "
          f"{p / (1 - p) * (1 - ppv) / ppv * (1 - fnr):.4f}")
print("== 3. per-group thresholds, chosen on the training half ==")
s_tr = LogisticRegression(max_iter=1000).fit(np.column_stack([x, g])[tr], y[tr]).predict_proba(
    np.column_stack([x, g])[tr])[:, 1]
def per_group(stat):                             # threshold per group from training scores
    return np.where(gt == 0, stat(0), stat(1))
for tpr in (0.70, 0.80, 0.90):
    t = per_group(lambda k: np.quantile(s_tr[(g[tr] == k) & y[tr]], 1 - tpr))
    rates(s, t, f"equal opportunity {tpr:.2f}")
t = per_group(lambda k: np.quantile(s_tr[g[tr] == k], 1 - np.mean(s_tr >= 0.5)))
rates(s, t, "demographic parity")
print("== 4. drop the group column: the proxies still carry it ==")
print(f"group predicted from proxy 1 alone: ROC-AUC {roc_auc_score(g[te], proxy[te, 0]):.3f}")
print(f"group predicted from the 5 proxies: ROC-AUC "
      f"{roc_auc_score(g[te], LogisticRegression().fit(proxy[tr], g[tr]).predict_proba(proxy[te])[:, 1]):.3f}")
for label, X in (("with group", np.column_stack([x, g])),
                 ("no group, proxies kept", np.column_stack([x, proxy])),
                 ("no group, no proxies", x)):
    sc = fit(X)
    sel = [np.mean(sc[gt == k] >= 0.5) for k in (0, 1)]
    over = [sc[gt == k].mean() - yt[gt == k].mean() for k in (0, 1)]
    print(f"{label:<23} acc {np.mean((sc >= 0.5) == yt):.3f}  selection A {sel[0]:.3f} B {sel[1]:.3f}"
          f"  gap {sel[0] - sel[1]:.3f}  mean score - base rate: A {over[0]:+.3f} B {over[1]:+.3f}")
```

</details>

Reading it:
- **Block 1:** the score is calibrated in both groups (bin gaps ≤ 0.006) and its mean equals each base rate, so Kleinberg's line `(1 − p)·x + p·y = p` holds in each group. The negatives' average score differs (0.396 vs 0.246), and so does the positives' (0.698 vs 0.540): conditions B and C fail, as the theorem says they must.
- **Block 2:** one threshold gives A, the higher-base-rate group, the higher FPR (0.332 vs 0.131) and the lower FNR (0.197 vs 0.436), the pattern Chouldechova predicts. Her identity reproduces each group's FPR to four digits. PPV is not equal either (0.759 vs 0.697): thresholding a calibrated score does not give predictive parity.
- **Block 3:** per-group thresholds chosen on the training half reach equal opportunity on the test half within 0.014 (0.803 vs 0.789 at the 0.80 target), at an accuracy cost of 0.021 (0.754 → 0.733); the cost grows to 0.068 at a 0.90 target. Equal TPR here came with nearly equal FPR, but PPV moved further apart (0.760 vs 0.572), the trade Chouldechova's identity forces. Equalizing selection rates (0.441 vs 0.440) reversed the TPR gap (0.640 vs 0.753).
- **Block 4:** each proxy alone predicts the group weakly (ROC-AUC, the area under the ROC curve, 0.714), the five together well (0.897). Without the group column but with the proxies, the selection gap is 0.146, still 46 % of 0.317. Without the proxies the gap is 0.000, but the score is no longer calibrated within groups: it overstates B's rate by 0.110 and understates A's by 0.109.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Base rates equal | Calibration and both balance conditions can hold together (one bin with the shared rate does it) | One of Kleinberg's two exceptions; that score is uninformative ✅[^2] |
| Perfect prediction (every outcome certain from the features) | Calibration and both balance conditions hold, and `Ŷ = Y` meets equalized odds; demographic parity still fails when base rates differ | Kleinberg's other exception ✅[^2]; demographic parity forbids `Ŷ = Y` when `Y` depends on the group ✅[^4] |
| Classifier with no false positives | Equal PPV (1), equal FPR (0) and equal FNR can hold together despite unequal base rates | Chouldechova's identity gives FPR = 0 for any `p` when PPV = 1 ✅[^3]; fairmlbook's version of the result assumes a nonzero FPR ✅[^1] |
| Calibrated score, one threshold | PPV can still differ by group (lab 0.759 vs 0.697) | The groups' score distributions differ ✅[^1] ✅[^3] ✅[^11] |
| Group not predictable from the features | Group calibration generally fails | The model cannot condition on what it cannot see ✅[^1]; lab −0.109 / +0.110 ✅[^11] |
| Group column dropped, correlated features kept | Disparity persists (lab gap 0.146 of 0.317) | Redundant encoding of the group ✅[^1] ✅[^11] |
| Equalized odds, groups with different ROC curves | Needs randomized decisions for some target rates | Only points under both curves are reachable, inside the curve by randomizing ✅[^1] ✅[^4] |
| Positive label is the harmful outcome (high risk) | "False positive" now means wrongly flagged | The labels' meaning flips ✅[^1] |
| Target `Y` with more than two values | The independence-versus-separation conflict need not hold | That proposition needs a binary `Y` ✅[^1] |
| Four-fifths (80 %) demographic parity ratio as a pass mark | Often wrong outside its legal origin | Fairness is not the same as legally allowable ✅[^6] |
| Many small subgroups or intersections | Noisy gaps, false alarms from many comparisons | Smaller samples; multiple comparisons ✅[^6] |
| Thresholds tuned on one sample | Equalized rates drift on new data (lab TPR 0.803 vs 0.789) | The thresholds are quantiles of the training half, not of the test half ✅[^11] |
| Per-group thresholds in production | The group must be known at decision time | The derived predictor is a function of score and group ✅[^4] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Demographic parity | Equal selection rates; can be the easiest to implement ✅[^6] | Ignores qualification; rules out `Ŷ = Y` when base rates differ ✅[^4]; lab reversed the TPR gap ✅[^11] |
| Equal opportunity | Positives treated alike; no randomization needed ✅[^4] | Says nothing about FPR ✅[^6]; lab accuracy 0.754 → 0.733 at TPR 0.80 ✅[^11] |
| Equalized odds | Both error rates equal; allows `Ŷ = Y` ✅[^4] | May need randomized thresholds ✅[^4]; a score calibrated within groups generally fails its score-level version ✅[^2] ✅[^4] |
| Calibration within groups | Scores mean the same everywhere; often free from good models ✅[^1] | Unequal error rates whenever base rates differ and prediction is imperfect ✅[^2] ✅[^3] |
| Pre-processing | Model-agnostic downstream ✅[^1] | Fairlearn's `CorrelationRemover` works only through linear transformations ✅[^7] |
| In-training constraint | Highest utility for the chosen criterion ✅[^1] | Needs the data and pipeline; model-specific ✅[^1] |
| Post-processing thresholds | Any black box, no retraining ✅[^1] | Uses the group explicitly ✅[^1] |

## Takeaways
- Report selection rate, TPR, FPR and PPV per group side by side; a single fairness number hides which criterion it chose. [rule-candidate]
- When base rates differ, decide and write down which criterion the use case needs before tuning anything: calibration and equal error rates cannot both hold.
- Removing the sensitive attribute is not a mitigation; check how well the remaining features predict the group. [rule-candidate]
- Choose per-group thresholds on one sample and check them on another; equalized rates drift.
- A metric gap starts an investigation of causes, the target and the harms; it does not end one.

## Verification status
- Verified: 97 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [Fairness and Machine Learning, chapter 3: Classification](https://fairmlbook.org/classification.html) — Barocas, Hardt, Narayanan, living. Backs: sensitive attribute and intersectionality, no fairness through unawareness and redundant encodings, independence/separation/sufficiency, demographic parity names and the 80 % relaxation, error-rate meaning flips, calibration by group and sufficiency, free group calibration and its failure when the group is undetectable, thresholding loses calibration, pre-/in-/post-processing, post-processing optimality, randomization under ROC curves, pairwise incompatibility propositions, observational limits, target as merit. [^1]
- [Inherent Trade-Offs in the Fair Determination of Risk Scores](https://arxiv.org/html/1609.05807v2) — Kleinberg, Mullainathan, Raghavan, 2016. Backs: conditions A–C, Theorem 1.1, its approximate version, independence from how the score is computed, the `(N − μ)x + μy = μ` proof line. [^2]
- [Fair prediction with disparate impact: A study of bias in recidivism prediction instruments](https://ar5iv.labs.arxiv.org/html/1703.00056) — Chouldechova, 2017. Backs: the FPR–PPV–FNR–prevalence identity, predictive parity incompatible with error-rate balance, higher-prevalence group gets higher FPR and lower FNR, calibrated scores can fail predictive parity. [^3]
- [Equality of Opportunity in Supervised Learning](https://ar5iv.labs.arxiv.org/html/1610.02413) — Hardt, Price, Srebro, 2016. Backs: flaws of demographic parity, equalized odds and equal opportunity definitions, perfect predictor allowed, derived predictors and per-group (randomized) thresholds, oblivious tests and non-identifiability. [^4]
- [Fairness in Machine Learning (Fairlearn user guide)](https://fairlearn.org/main/user_guide/fairness_in_machine_learning.html) — Fairlearn contributors, living (0.16.0.dev0 docs). Backs: unfairness defined by harms, not causes or intent; types of harms and which ones the library targets; ML systems inherently sociotechnical; parity constraints; disparity metric definitions. [^5]
- [Common fairness metrics (Fairlearn user guide)](https://fairlearn.org/main/user_guide/assessment/common_fairness_metrics.html) — Fairlearn contributors, living. Backs: `demographic_parity_difference`/`ratio`, `equalized_odds_difference`, equal opportunity ignores FPR, Simpson's paradox and small subgroups, the four-fifths rule misapplied, demographic parity easiest to implement. [^6]
- [Mitigations (Fairlearn user guide)](https://fairlearn.org/main/user_guide/mitigation/index.html) — Fairlearn contributors, living. Backs: `CorrelationRemover`, `ExponentiatedGradient`, `GridSearch`, `ThresholdOptimizer`, guarantees about metrics not fairness, randomized predictors. [^7]
- [Fairness: Demographic parity (Machine Learning Crash Course)](https://developers.google.com/machine-learning/crash-course/fairness/demographic-parity?hl=en) — Google for Developers, living. Backs: demographic parity ignores how many in each group are qualified. [^8]
- [Fairness: Equality of opportunity (Machine Learning Crash Course)](https://developers.google.com/machine-learning/crash-course/fairness/equality-of-opportunity?hl=en) — Google for Developers, living. Backs: needs a clear-cut preferred label. [^9]
- [Fairness: Mitigating bias (Machine Learning Crash Course)](https://developers.google.com/machine-learning/crash-course/fairness/mitigating-bias?hl=en) — Google for Developers, living. Backs: MinDiff and counterfactual logit pairing as loss adjustments. [^10]
- `machine-learning/lab-setup.md` — the lab where the two-group calibration, threshold and proxy experiment ran on 2026-11-25. [^11]

## Related
- `machine-learning/evaluation/classification-metrics.md` — TPR, FPR, PPV and ROC curves, computed here per group.
- `machine-learning/evaluation/probability-calibration.md` — how to calibrate a score, the sufficiency criterion's tool.
- `machine-learning/evaluation/class-imbalance.md` — choosing a single threshold; base rates.
- `machine-learning/evaluation/conformal-prediction.md` — coverage guarantees that hold on average, not per group.
- `machine-learning/causal-inference/causal-graphs-and-confounding.md` — the causal questions these metrics cannot answer.
- `machine-learning/ml-systems/data-drift-and-monitoring.md` — tracking per-group metrics after deployment.
- `machine-learning/recommender-systems/feedback-loops-and-popularity-bias.md` — decisions that shape their own future training data.
