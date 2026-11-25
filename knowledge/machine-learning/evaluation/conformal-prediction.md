---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/evaluation
status: verified
applies-to: ["any"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, evaluation, conformal-prediction, split-conformal, prediction-intervals, prediction-sets, coverage, exchangeability, conformalized-quantile-regression, adaptive-prediction-sets, covariate-shift, mapie]
---

# Conformal prediction: prediction sets with a coverage guarantee

## Summary
**TL;DR:** Conformal prediction turns any trained model's output into a set of labels or an interval that contains the true answer with probability at least `1 − α`, for any model and any data distribution, as long as the calibration points and the new point are exchangeable (for example i.i.d., independent and identically distributed). Split conformal scores `n` held-out calibration points with a nonconformity score (how badly a candidate answer fits), takes the `k`-th smallest score with `k = ⌈(n+1)(1−α)⌉`, and keeps every answer that scores no worse. The guarantee is marginal: an average over all inputs, not a promise for each input, region or group. The score decides how useful the sets are: absolute residuals give one interval width everywhere, too wide where noise is low and too narrow where it is high; conformalized quantile regression (CQR) adapts the width; for classes, LAC (least ambiguous set-valued classifier) gives the smallest sets and APS (adaptive prediction sets) spreads coverage more evenly between easy and hard inputs. If the test inputs shift, coverage breaks; weighting the calibration points by a known density ratio restores it.
**Use this when:** you need an interval or a label set with a stated coverage around a model's prediction, pick a conformity score (absolute residual, CQR, LAC, APS), size the calibration set, implement the quantile, or must explain why "90 % coverage" failed for one region, group or month.
**Not this doc:** quantile regression and the pinball loss → `machine-learning/time-series/forecasting-with-machine-learning.md`; whether predicted probabilities are calibrated (reliability curves, temperature scaling) → `machine-learning/evaluation/probability-calibration.md`; model-based uncertainty (ensembles, Monte Carlo dropout, Laplace) → `machine-learning/deep-learning/uncertainty-in-deep-learning.md`; detecting a shift in production → `machine-learning/ml-systems/data-drift-and-monitoring.md`; equal treatment of groups → `machine-learning/evaluation/algorithmic-fairness.md`.

## Problem
A point prediction carries no error bar, and the error bars models do offer carry no guarantee. In the lab, a gradient-boosting quantile model trained for a 90 % interval covered 82.9 % of new points; the plain 90 % quantile of 20 calibration residuals covered 86.4 %; and an interval that covered 90.2 % overall covered 99.9 % of the low-noise inputs and 77.1 % of the high-noise ones ✅[^8]. Softmax outputs are a heuristic that may be overfit or untrustworthy, and fitted quantiles may be inaccurate ✅[^1]; quantile regression alone has no finite-sample coverage guarantee ✅[^2].

## Mental model
**Analogy:** a tailor who promises "this off-the-rack sleeve fits 9 out of 10 customers". She takes 500 past customers she did not use to design the pattern, writes down how far each one was from the pattern, sorts the 500 numbers and cuts at the 451st. A new customer is just as likely to land in any of the 501 gaps between the sorted numbers, so the chance of fitting is 451/501 ≥ 0.9. The promise is about customers on average; it says nothing about tall customers in particular, and it breaks if a basketball team walks in.

**Artifact:** split conformal for regression in four lines, the coverage it reached over 1,000 calibration sets and its theory; printed by the full script in the Worked example; lab run (`machine-learning/lab-setup.md`), 2026-11-25, numpy 2.5.5, scikit-learn 1.9.1 ✅[^8]:

```python
scores = np.abs(y_cal - model.predict(X_cal))           # nonconformity: absolute residual
k = int(np.ceil((n + 1) * (1 - alpha)))                 # n = 500, alpha = 0.1 -> k = 451
q_hat = np.sort(scores)[k - 1]                          # the k-th smallest score
lower, upper = model.predict(X_new) - q_hat, model.predict(X_new) + q_hat
```

```text
k = 451  empirical coverage: mean 0.8994 sd 0.0136 min 0.8542 max 0.9365
theory Beta(451, 50): mean 0.9002 sd 0.0134
```

## How it works
### Split conformal, step by step
1. **Split.** Fit the model on a proper training set; keep `n` fresh calibration points it never saw ✅[^1] ✅[^2]. Scores computed on the training points are biased small, because training minimized them ✅[^2].
2. **Score.** A conformity score `s(x, y)` is any function where a larger value means worse agreement between input and answer ✅[^1] ✅[^5]. Regression: `|y − μ̂(x)|` for a point model `μ̂` ✅[^5]. Classification (LAC): `1 − f̂(x)_y`, one minus the predicted probability of the true class ✅[^1].
3. **Quantile.** `q̂` is the `⌈(n+1)(1−α)⌉/n` empirical quantile of the `n` scores, which for distinct scores is the `k`-th smallest with `k = ⌈(n+1)(1−α)⌉` ✅[^1]. Example: `n = 500`, `α = 0.1`: `(501)(0.9) = 450.9`, so `k = 451`.
4. **Set.** `C(x) = {y : s(x, y) ≤ q̂}`; for the absolute residual that is `[μ̂(x) − q̂, μ̂(x) + q̂]`, for LAC every class with `f̂(x)_y ≥ 1 − q̂` ✅[^1] ✅[^5].
5. **Guarantee.** For i.i.d. data, `1 − α ≤ P(Y ∈ C(X)) ≤ 1 − α + 1/(n+1)`, the upper bound needing continuous scores (no ties) ✅[^1]. It holds whatever the model and whatever the unknown distribution ✅[^1], and also under the weaker condition of exchangeability: the joint distribution of the `n + 1` points is the same under any reordering ✅[^1] ✅[^2] ✅[^4]. Example: `n = 500`, `α = 0.1` gives coverage between 0.900 and 0.902.
6. **Why it works.** By exchangeability the test score is equally likely to fall into any of the `n + 1` rank positions among the calibration scores, so `P(s_test ≤ s_(k)) = k/(n+1) ≥ 1 − α`, where `s_(k)` is the `k`-th smallest calibration score ✅[^1]. The `+1` is the test point itself; that is the finite-sample correction.
7. **One calibration set is a draw.** Coverage given a fixed calibration set is random: it follows `Beta(n+1−l, l)` with `l = ⌊(n+1)α⌋` ✅[^1]. With `n = 1000` it typically lands between 0.88 and 0.92, so the authors suggest about 1,000 calibration points ✅[^1]. Lab, `n = 500`: mean 0.8994, standard deviation 0.0136, against the Beta's 0.9002 and 0.0134 ✅[^8].
8. **Validity is free, usefulness is not.** Random scores still give valid sets, just useless ones; the score function decides how informative the sets are ✅[^1]. Conformal prediction does not make a weak model more accurate; better models generally give narrower outputs at the same coverage ✅[^9].

### Regression scores: one width, or a width per input
1. **Absolute residual.** The interval's length is fixed at `2q̂`, independent of the input ✅[^2] ✅[^5]. On heteroscedastic data (noise that changes with `x`) it is too wide where the noise is small and too narrow where it is large; lab: 99.9 % vs 77.1 % coverage at the same width 3.35 ✅[^8].
2. **Normalized residual.** Divide by an uncertainty estimate `u(x)` (a predicted standard deviation, an ensemble's or dropout's spread, a model of `|y − μ̂(x)|`): `s = |y − μ̂(x)| / u(x)`, giving `μ̂(x) ± q̂·u(x)` ✅[^1]; MAPIE (Model Agnostic Prediction Interval Estimator, a Python library) calls it the residual normalized score ✅[^5].
3. **CQR (conformalized quantile regression).** Fit a lower and an upper quantile model `q̂_lo` and `q̂_hi` (for α = 0.1 the 5 % and 95 % quantiles; pinball loss, as in `machine-learning/time-series/forecasting-with-machine-learning.md`), score `E = max(q̂_lo(x) − y, y − q̂_hi(x))`, and output `[q̂_lo(x) − Q, q̂_hi(x) + Q]` with `Q` the conformal quantile of `E` ✅[^2]. `E` is the distance outside the fitted band (negative inside), so `Q` widens or narrows the band by one constant ✅[^1] ✅[^2]. With exchangeable data its coverage is at least `1 − α`, and at most `1 − α + 1/(n+1)` for distinct scores ✅[^2]. Its authors report shorter intervals on average than standard and locally adaptive split conformal, and better results than both on ten of eleven datasets ✅[^2]. In scikit-learn, `HistGradientBoostingRegressor(loss="quantile", quantile=…)` fits a quantile model with the pinball loss ✅[^6].

### Classification sets: LAC and APS
1. **LAC.** Keep every class whose probability reaches `1 − q̂`. It gives the smallest average sets, but tends to under-cover hard inputs and over-cover easy ones ✅[^1], and it can return an empty set when the model is uncertain ✅[^5].
2. **APS.** Sort the classes by predicted probability; the score of the true label is the total probability of all classes down to and including it ✅[^1] ✅[^5]. At test time, add classes from most to least likely until their total reaches `q̂` ✅[^1]. Romano et al. built it to imitate an oracle that knows the true class probabilities, because one probability threshold for every input treats easy and hard inputs alike and gives poor conditional coverage ✅[^3].
3. **Randomized APS.** Always including the class that crosses `q̂` makes sets larger than needed; including it only with a probability (a uniform random number `U` per input) tightens coverage to its target ✅[^3] ✅[^5]. Lab: the deterministic version covered 0.997 with sets of 4.36 classes, the randomized one 0.899 with 1.18 ✅[^8].
4. MAPIE also implements Top-K (the same set size for every input) and RAPS (regularized APS, which penalizes large sets) ✅[^5].

### What the guarantee does not promise
1. **Conditional coverage.** `P(Y ∈ C(X) | X = x) ≥ 1 − α` for every `x` is stronger than the marginal guarantee and in general impossible to achieve ✅[^1] ✅[^3]; MAPIE's documentation states the same limit ✅[^9] ✅[^10]. Example from Angelopoulos and Bates: if group A is 90 % of the data and always covered, group B 10 % and never covered, marginal coverage is still 90 % ✅[^1]. Check it with feature-stratified coverage (the minimum coverage over groups or binned features) and size-stratified coverage (the minimum over set-size bins) ✅[^1].
2. **Shifted inputs.** The guarantee assumes the test point comes from the calibration distribution ✅[^1]. Under covariate shift (the input distribution changes, `P(Y | X)` does not), weighted conformal prediction gives calibration point `i` the weight `w(X_i) / (Σ_j w(X_j) + w(x))`, with `x` the test input, the sum over the calibration points and `w(x) = p_test(x) / p_cal(x)` the likelihood ratio of the two input densities, and takes the weighted `1 − α` quantile; with a known ratio, coverage is again at least `1 − α` ✅[^1] ✅[^4]. In practice the ratio can be estimated accurately when a large set of unlabelled test inputs is available ✅[^4].
3. **Drift and time series.** Neighbouring time points are correlated, which violates exchangeability ✅[^1]. Weighting recent scores more (a rolling window or a decay such as `0.99^(n−i+1)`) keeps coverage at least `1 − α − 2·Σ w̃_i·ε_i`, where `w̃_i` is point i's normalized weight and `ε_i` the total variation distance between its distribution and the test point's: old points that drifted far must get small weights ✅[^1].
4. **Each set is a population promise.** The probability is over the calibration and test draws, not about one fixed input; a single calibration set can sit anywhere in the Beta spread (lab minimum 0.854 over 1,000 sets) ✅[^1] ✅[^8].

## Worked example
One synthetic regression problem: `x` uniform on [0, 5], `y = 2·sin(x) + 0.5·x + noise` with noise standard deviation `0.1 + 0.3·x` (0.1 at the left, 1.6 at the right), α = 0.1. Three histogram gradient-boosting models (mean, 5 % and 95 % quantiles) are trained once on 2,000 points; every calibration set is drawn fresh; coverage is measured on 200,000 test points. Then prediction sets for the 10-class `load_digits` images (1,797 images of 8×8 pixels ✅[^7]) from a logistic regression trained on 200 of them. Lab run (`machine-learning/lab-setup.md`), 2026-11-25, numpy 2.5.5, scipy 1.18.1, scikit-learn 1.9.1, two runs identical ✅[^8]:

```text
== 1. absolute-residual split conformal, 1,000 calibration sets of n = 500, alpha = 0.1 ==
k = 451  empirical coverage: mean 0.8994 sd 0.0136 min 0.8542 max 0.9365
theory Beta(451, 50): mean 0.9002 sd 0.0134
== 2. n = 20: which calibration score becomes q-hat ==
np.quantile(s, 0.9) linear      mean coverage 0.8643
k-th smallest, k = 19           mean coverage 0.9067
np.quantile(s, k/n, 'higher')   mean coverage 0.9529
k/(n+1) = 0.9048  (k+1)/(n+1) = 0.9524
== 3. fixed width vs CQR on one calibration set (n = 1,000), by region of x ==
absolute residual    all: cov 0.902 width 3.35 | x<1.67: cov 0.999 width 3.35 | middle: cov 0.937 width 3.35 | x>3.33: cov 0.771 width 3.35
quantile regression  all: cov 0.829 width 2.51 | x<1.67: cov 0.829 width 1.03 | middle: cov 0.819 width 2.43 | x>3.33: cov 0.839 width 4.07
CQR                  all: cov 0.907 width 2.96 | x<1.67: cov 0.953 width 1.48 | middle: cov 0.888 width 2.88 | x>3.33: cov 0.881 width 4.52
q-hat: absolute residual 1.675  CQR +0.228
== 4. covariate shift: test x ~ 5*Beta(5, 1.5), n = 1,000, 200 calibration sets ==
absolute residual, plain 0.799 | absolute residual, weighted 0.902 (median width 4.40) | CQR, plain 0.879
== 5. prediction sets on load_digits, alpha = 0.1, 200 random calibration/test splits ==
model accuracy 0.929  hard points (top probability < 0.8) 0.188
LAC             coverage 0.901  mean size 0.94  empty 0.060  coverage easy 0.985 hard 0.536
APS             coverage 0.997  mean size 4.36  empty 0.000  coverage easy 0.997 hard 1.000
APS randomized  coverage 0.899  mean size 1.18  empty 0.077  coverage easy 0.893 hard 0.928
```

<details><summary>Full script (prints the output above)</summary>

```python
# Split conformal prediction: coverage over 1,000 calibration sets, the finite-sample rank,
# fixed-width vs conformalized quantile regression (CQR), covariate shift and weighted conformal,
# then prediction sets (LAC, APS) on load_digits. numpy + scikit-learn only.
import numpy as np
from scipy.stats import beta
from sklearn.ensemble import HistGradientBoostingRegressor as HGB
from sklearn.datasets import load_digits
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

rng = np.random.default_rng(0)
alpha = 0.1
def draw(n, shifted=False):                      # noise sd grows from 0.1 at x=0 to 1.6 at x=5
    x = 5 * (rng.beta(5, 1.5, n) if shifted else rng.random(n))
    return x[:, None], 2 * np.sin(x) + 0.5 * x + (0.1 + 0.3 * x) * rng.normal(size=n)
Xtr, ytr = draw(2000)
mean = HGB(random_state=0).fit(Xtr, ytr)
lo = HGB(loss="quantile", quantile=alpha / 2, random_state=0).fit(Xtr, ytr)
hi = HGB(loss="quantile", quantile=1 - alpha / 2, random_state=0).fit(Xtr, ytr)
def abs_score(X, y): return np.abs(y - mean.predict(X))
def cqr_score(X, y): return np.maximum(lo.predict(X) - y, y - hi.predict(X))
def kth(s, k): return np.sort(s)[k - 1]             # the k-th smallest calibration score
Xte, yte = draw(200_000)
s_te = np.sort(abs_score(Xte, yte))               # a large fixed test set
def coverage(q): return np.searchsorted(s_te, q, side="right") / len(s_te)

print("== 1. absolute-residual split conformal, 1,000 calibration sets of n = 500, alpha = 0.1 ==")
n = 500; k = int(np.ceil((n + 1) * (1 - alpha))); l = int(np.floor((n + 1) * alpha))
cov = np.array([coverage(kth(abs_score(*draw(n)), k)) for _ in range(1000)])
print(f"k = {k}  empirical coverage: mean {cov.mean():.4f} sd {cov.std():.4f} "
      f"min {cov.min():.4f} max {cov.max():.4f}")
print(f"theory Beta({n + 1 - l}, {l}): mean {beta.mean(n + 1 - l, l):.4f} sd {beta.std(n + 1 - l, l):.4f}")

print("== 2. n = 20: which calibration score becomes q-hat ==")
n = 20; k = int(np.ceil((n + 1) * (1 - alpha)))
rules = {"np.quantile(s, 0.9) linear": lambda s: np.quantile(s, 0.9),
         f"k-th smallest, k = {k}": lambda s: kth(s, k),
         "np.quantile(s, k/n, 'higher')": lambda s: np.quantile(s, k / n, method="higher")}
cal20 = [abs_score(*draw(n)) for _ in range(1000)]
for name, rule in rules.items():
    print(f"{name:<31} mean coverage {np.mean([coverage(rule(s)) for s in cal20]):.4f}")
print(f"k/(n+1) = {k / (n + 1):.4f}  (k+1)/(n+1) = {(k + 1) / (n + 1):.4f}")

print("== 3. fixed width vs CQR on one calibration set (n = 1,000), by region of x ==")
n = 1000; k = int(np.ceil((n + 1) * (1 - alpha)))
Xc, yc = draw(n)
qa, qc = kth(abs_score(Xc, yc), k), kth(cqr_score(Xc, yc), k)
m, L, H = mean.predict(Xte), lo.predict(Xte), hi.predict(Xte)
ints = {"absolute residual": (m - qa, m + qa), "quantile regression": (L, H), "CQR": (L - qc, H + qc)}
x = Xte[:, 0]
for name, (a, b) in ints.items():
    inside = (yte >= a) & (yte <= b)
    row = " | ".join(f"{lab}: cov {inside[(x >= r0) & (x < r1)].mean():.3f} "
                     f"width {(b - a)[(x >= r0) & (x < r1)].mean():.2f}"
                     for r0, r1, lab in ((0, 5 / 3, "x<1.67"), (5 / 3, 10 / 3, "middle"), (10 / 3, 6, "x>3.33")))
    print(f"{name:<20} all: cov {inside.mean():.3f} width {(b - a).mean():.2f} | {row}")
print(f"q-hat: absolute residual {qa:.3f}  CQR {qc:+.3f}")

print("== 4. covariate shift: test x ~ 5*Beta(5, 1.5), n = 1,000, 200 calibration sets ==")
Xs, ys = draw(200_000, shifted=True)
ss, sc = abs_score(Xs, ys), cqr_score(Xs, ys)
w_te = beta.pdf(Xs[:, 0] / 5, 5, 1.5)            # likelihood ratio p_test(x) / p_train(x)
res = []
for _ in range(200):
    Xc, yc = draw(n)
    a, c = abs_score(Xc, yc), cqr_score(Xc, yc)
    o = np.argsort(a); a_sorted, cw = a[o], np.cumsum(beta.pdf(Xc[o, 0] / 5, 5, 1.5))
    j = np.searchsorted(cw, (1 - alpha) * (cw[-1] + w_te))   # weighted (1 - alpha) quantile
    q_w = np.where(j < n, a_sorted[np.minimum(j, n - 1)], np.inf)
    res.append([np.mean(ss <= kth(a, k)), np.mean(ss <= q_w), np.mean(sc <= kth(c, k)),
                2 * np.median(q_w)])
r = np.mean(res, 0)
print(f"absolute residual, plain {r[0]:.3f} | absolute residual, weighted {r[1]:.3f} "
      f"(median width {r[3]:.2f}) | CQR, plain {r[2]:.3f}")

print("== 5. prediction sets on load_digits, alpha = 0.1, 200 random calibration/test splits ==")
Xd, yd = load_digits(return_X_y=True)
idx = rng.permutation(len(yd)); tr, rest = idx[:200], idx[200:]
clf = make_pipeline(StandardScaler(), LogisticRegression(max_iter=2000)).fit(Xd[tr], yd[tr])
P, yr = clf.predict_proba(Xd[rest]), yd[rest]
order = np.argsort(-P, 1); rank = np.argsort(order, 1)
cum = np.take_along_axis(np.cumsum(np.take_along_axis(P, order, 1), 1), rank, 1)  # mass up to each label
hard = P.max(1) < 0.8
print(f"model accuracy {np.mean(P.argmax(1) == yr):.3f}  hard points (top probability < 0.8) {hard.mean():.3f}")
out = {"LAC": [], "APS": [], "APS randomized": []}
for _ in range(200):
    p = rng.permutation(len(yr)); c, t = p[:700], p[700:]
    u = rng.random(len(yr)); k = int(np.ceil((len(c) + 1) * (1 - alpha)))
    true = lambda M, i: M[i, yr[i]]
    sets = {"LAC": P[t] >= 1 - kth(1 - true(P, c), k),
            "APS": cum[t] - P[t] < kth(true(cum, c), k),          # keep the label that crosses q-hat
            "APS randomized": cum[t] - u[t, None] * P[t] <= kth(true(cum, c) - u[c] * true(P, c), k)}
    for name, S in sets.items():
        hit = S[np.arange(len(t)), yr[t]]
        out[name].append([hit.mean(), S.sum(1).mean(), np.mean(S.sum(1) == 0),
                          hit[~hard[t]].mean(), hit[hard[t]].mean()])
for name, v in out.items():
    v = np.mean(v, 0)
    print(f"{name:<15} coverage {v[0]:.3f}  mean size {v[1]:.2f}  empty {v[2]:.3f}  "
          f"coverage easy {v[3]:.3f} hard {v[4]:.3f}")
```

</details>

Reading it:
- **Block 1:** over 1,000 fresh calibration sets the average coverage is 0.8994, within its own noise of the promised 0.9 (the Beta mean 0.9002), and the spread matches the Beta formula (0.0136 vs 0.0134). One unlucky calibration set covered only 0.854.
- **Block 2:** with 20 calibration points the rank matters. The plain 90 % quantile with interpolation under-covers (0.8643). The 19th smallest score, as the theory says, covers 0.9067 against the predicted 19/21 = 0.9048. Calling `np.quantile` at level `k/n` with `method="higher"`, the call in Angelopoulos and Bates's code snippets ✅[^1], picks the 20th smallest and covers 0.9529 = 20/21: valid, but one rank above the paper's own definition (the 19th) and above its upper bound `1 − α + 1/21 = 0.948`. The extra coverage is `1/(n+1)`, so at the ~1,000 calibration points the paper recommends it is 0.001.
- **Block 3:** the absolute-residual interval meets 90 % overall (0.902) with one width, 3.35, everywhere: 99.9 % on the quiet left, 77.1 % on the noisy right. The raw 5 %–95 % quantile models adapt their width (1.03 to 4.07) but cover only 0.829. CQR widens their band by 0.228 on each side, reaches 0.907 overall, stays between 0.881 and 0.953 in every region, and is narrower on average (2.96 vs 3.35).
- **Block 4:** when test inputs move toward the noisy right, the plain absolute-residual interval falls to 0.799. Weighting the calibration scores by the known density ratio brings it back to 0.902, with wider intervals (median 4.40). CQR, unweighted, degrades less (0.879) because its width already follows the noise, but nothing guarantees that.
- **Block 5:** LAC hits 0.901 with the smallest sets (0.94 classes on average, 6.0 % of them empty), but covers only 53.6 % of the 18.8 % hard images. Deterministic APS over-covers (0.997) with 4.36 classes per set. Randomized APS lands on target (0.899) and covers hard images at 0.928, at the price of larger sets (1.18) and 7.7 % empty sets when the random draw drops even the top class.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `α < 1/(n+1)` (`n = 20`, `α = 0.04`: `k = 21 > n`) | `q̂ = ∞`: the set is every possible answer | Too few calibration points for that level ✅[^1] |
| Quantile with linear interpolation at `1 − α` | Under-covers on small `n` (lab 0.8643 at `n = 20`) | Misses the `+1` for the test point ✅[^1] ✅[^8] |
| `np.quantile(s, k/n, method="higher")`, as in the Gentle Introduction's code snippets ✅[^1] | Returns the (k+1)-th smallest whenever `k < n`; lab coverage 0.9529 = 20/21 at `n = 20`, above the 0.948 upper bound | `"higher"` takes the sorted element just after 0-based position `q·(n−1)` ✅[^11]; at `q = k/n` that position is `k − k/n` (18.05 for `n = 20`, `k = 19`), so the 20th smallest comes back (lab, numpy 2.5.5) ✅[^8]. The paper's formal definition is the k-th smallest ✅[^1], which `np.sort(s)[k-1]` gives |
| Calibration points reused from training | Intervals too narrow, coverage lost | Training residuals are biased small ✅[^2] |
| Ties or discrete scores | Only the lower bound `1 − α` holds | The upper bound needs continuous scores ✅[^1] ✅[^2]; add tiny noise or randomize ✅[^1] |
| Small calibration set | Valid on average, but any one set may cover far less | Coverage per set follows `Beta(n+1−l, l)` ✅[^1]; lab min 0.854 at `n = 500` ✅[^8] |
| LAC on an uncertain input | Empty set (lab 6.0 % of sets) | No class reaches `1 − q̂` ✅[^5] ✅[^8] |
| Deterministic APS on a confident model | Large sets, coverage near 1 (lab 0.997, 4.36 classes) | Always keeping the crossing class is conservative; randomizing it tightens coverage ✅[^5] ✅[^8] |
| Group or region with a different error level | Marginal 90 % hides 77 % in one region | The guarantee is marginal only ✅[^1]; lab ✅[^8] |
| Covariate shift | Coverage drops (lab 0.799) | Test and calibration points are no longer exchangeable ✅[^1]; weighted conformal restores it with a known ratio ✅[^4] |
| Shift in `P(Y \| X)` (concept shift) or labels | The covariate-shift guarantee no longer applies | Weighted conformal assumes `P(Y \| X)` is unchanged ✅[^1] ✅[^4] |
| Time-ordered data | No exchangeability, no exact guarantee | Neighbouring points are correlated ✅[^1] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Absolute residual score | Simplest; any point model ✅[^5] | One width for all inputs ✅[^2]; lab 99.9 % vs 77.1 % by region ✅[^8] |
| Normalized residual `\|y − μ̂\|/u(x)` | Width follows an uncertainty estimate ✅[^1] | Needs a second model or an uncertainty output ✅[^5] |
| CQR | Adaptive widths, often shorter intervals ✅[^2]; lab 0.881–0.953 by region ✅[^8] | Two quantile models to fit ✅[^2] |
| LAC | Smallest average sets ✅[^1] | Under-covers hard inputs ✅[^1]; empty sets ✅[^5] |
| APS, randomized | Coverage spread more evenly between easy and hard inputs ✅[^3]; exact coverage ✅[^5] | Larger sets; random empty sets (lab 7.7 %) ✅[^8] |
| Split conformal | One model fit; cheap ✅[^2] | Spends data on calibration ✅[^2] |
| Full or cross-conformal | No separate held-out calibration set ✅[^9] | Full conformal refits the model for every candidate answer, infinitely often for a continuous target ✅[^2]; MAPIE's classification module offers cross-conformal only for LAC and APS ✅[^10] |
| Weighted conformal | Valid under a known covariate shift ✅[^4] | Needs the density ratio; wider intervals (lab median 4.40 vs 3.35) ✅[^8] |

## Takeaways
- Compute `q̂` as the `⌈(n+1)(1−α)⌉`-th smallest calibration score, on points the model never trained on. [rule-candidate]
- Report coverage per region, group or set size next to the overall number; the guarantee covers only the overall number. [rule-candidate]
- Pick the score for usefulness: CQR or a normalized residual when noise varies, APS when easy and hard inputs must both be covered.
- Use about 1,000 calibration points, and remember that one calibration set's coverage is a draw from a Beta distribution.
- Re-check coverage whenever the input distribution moves; reweight only if the shift is in the inputs and the ratio is known or well estimated.

## Verification status
- Verified: 108 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [A Gentle Introduction to Conformal Prediction and Distribution-Free Uncertainty Quantification](https://arxiv.org/html/2107.07511v6) — Angelopoulos, Bates, 2021 (v6). Backs: split-conformal steps, the `⌈(n+1)(1−α)⌉/n` quantile and its snippets' `np.quantile(..., method='higher')` call, the coverage bounds and their proof, exchangeability, `q̂ = ∞` for small `n`, the Beta distribution of coverage and the ~1,000 guideline, score choice and usefulness, normalized residuals, CQR's adjustment, LAC under/over-coverage, APS score and set, conditional coverage and its metrics, covariate-shift weights, drift and time series. [^1]
- [Conformalized Quantile Regression](https://ar5iv.labs.arxiv.org/html/1905.03222) — Romano, Patterson, Candès, 2019. Backs: proper training and calibration split, training residuals biased small, constant-length split intervals, CQR score and interval, its coverage theorem, shorter intervals on ten of eleven datasets, no finite-sample guarantee for plain quantile regression, full conformal's refitting cost. [^2]
- [Classification with Valid and Adaptive Coverage](https://ar5iv.labs.arxiv.org/html/2006.02544) — Romano, Sesia, Candès, 2020. Backs: the oracle and randomized prediction sets, homogeneous thresholds give poor conditional coverage, conditional coverage impossible without strong assumptions. [^3]
- [Conformal Prediction Under Covariate Shift](https://ar5iv.labs.arxiv.org/html/1904.06019) — Tibshirani, Foygel Barber, Candès, Ramdas, 2019. Backs: weighted conformal with a known likelihood ratio, or one estimated from unlabelled test inputs. [^4]
- [Conformity Scores — Theory (MAPIE docs)](https://mapie.readthedocs.io/en/stable/content/conformal-prediction/conformity-scores/) — MAPIE team, living. Backs: score definition, absolute residual (simplest, constant intervals), residual normalized score and its extra model, LAC empty sets, APS score and the crossing label, randomization for exact coverage, Top-K and RAPS. [^5]
- [sklearn.ensemble.HistGradientBoostingRegressor](https://scikit-learn.org/stable/modules/generated/sklearn.ensemble.HistGradientBoostingRegressor.html) — scikit-learn developers, living (1.9.1). Backs: `loss="quantile"` uses the pinball loss. [^6]
- [sklearn.datasets.load_digits](https://scikit-learn.org/stable/modules/generated/sklearn.datasets.load_digits.html) — scikit-learn developers, living (1.9.1). Backs: 1,797 8×8 images, 10 classes. [^7]
- `machine-learning/lab-setup.md` — the lab where the coverage, finite-sample, CQR, covariate-shift and digits prediction-set experiments ran on 2026-11-25. [^8]
- [Conformal Prediction — Theory (MAPIE docs)](https://mapie.readthedocs.io/en/stable/content/conformal-prediction/theory/) — MAPIE team, living. Backs: marginal (not subgroup) guarantee, exchangeability required, held-out or cross-validated conformalization data, no accuracy gain from conformalizing. [^9]
- [Classification — Theory (MAPIE docs)](https://mapie.readthedocs.io/en/stable/content/conformal-prediction/classification/) — MAPIE team, living. Backs: marginal-only guarantee for prediction sets, split and cross-conformal for LAC and APS only. [^10]
- [numpy.quantile](https://numpy.org/doc/stable/reference/generated/numpy.quantile.html) — NumPy developers, living (v2.5 manual). Backs: the `"higher"` method's index `j = q·(n−1) // 1` with `g = 1`. [^11]

## Related
- `machine-learning/time-series/forecasting-with-machine-learning.md` — quantile (pinball) loss and measuring interval coverage on backtests.
- `machine-learning/evaluation/probability-calibration.md` — calibrated probabilities, a different promise from coverage.
- `machine-learning/deep-learning/uncertainty-in-deep-learning.md` — ensembles and MC dropout as uncertainty scores to conformalize.
- `machine-learning/ml-systems/data-drift-and-monitoring.md` — detecting the shifts that break coverage.
- `machine-learning/evaluation/algorithmic-fairness.md` — per-group checks, which marginal coverage does not replace.
- `machine-learning/evaluation/cross-validation-and-hyperparameter-search.md` — splitting data, and time-ordered splits.
