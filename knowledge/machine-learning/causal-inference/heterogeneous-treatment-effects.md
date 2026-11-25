---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/causal-inference
status: verified
applies-to: ["scikit-learn 1.9.1", "numpy 2.5.5"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, causal-inference, heterogeneous-treatment-effects, cate, meta-learners, s-learner, t-learner, x-learner, uplift-modeling, qini-curve, targeting]
---

# Heterogeneous treatment effects, meta-learners and uplift

## Summary
**TL;DR:** The CATE (conditional average treatment effect) `τ(x) = E[Y(1) − Y(0) | X = x]` is the average effect for units that look like `x`, and it is what a decision about whom to treat needs. Meta-learners build it from ordinary regression models: the S-learner fits one model with the treatment as a feature and can shrink the effect toward zero, the T-learner fits one model per arm and subtracts, and the X-learner imputes each unit's effect with the other arm's model, regresses on those imputed effects and blends the two results by the propensity score, which helps when one arm is much smaller. Uplift modeling applies the idea to targeting and scores a ranking with a Qini curve on randomized data. Predicting the outcome well is not ranking the effect well: in the lab, the model with the best AUC (area under the ROC, receiver operating characteristic, curve) for predicting a purchase ranked customers worse than random by effect.
**Use this when:** you decide who should get a treatment, offer or nudge; compare CATE estimators; evaluate a targeting model on an experiment; or someone proposes to target "the users most likely to convert".
**Not this doc:** the ATE (average treatment effect) and how to run the experiment → `machine-learning/causal-inference/potential-outcomes-and-experiments.md`; adjusting for confounders in observational data → `machine-learning/causal-inference/estimating-effects-from-observational-data.md`; AUC and other metrics → `machine-learning/evaluation/metrics-catalog.md`; feature attributions of a predictive model, which are not effects → `machine-learning/data-and-features/partial-dependence-and-shapley-values.md`.

## Problem
A campaign that targets the customers most likely to buy spends its budget on people who buy anyway and on people the campaign puts off. In the lab population, 30 % of customers had a negative true uplift, and the "who will buy?" model, the best of four rankings at predicting purchases (AUC 0.706), delivered fewer extra buyers than contacting customers at random ✅[^10]. Learning the effect directly is impossible in the usual supervised way, because no unit's individual effect is ever observed, so there is no label to fit and no held-out error to compute ✅[^1].

## Mental model
**Analogy:** a tutor choosing which students get extra lessons. Ranking by predicted exam score picks the students who would pass anyway. What she needs is the predicted gain from tutoring: the difference between two predictions, one per world, which can be large for an average student and zero, or negative, for the top one. Uplift modeling names four kinds of customers: persuadables buy only if contacted, sure things buy anyway, lost causes never buy, and do-not-disturbs (sleeping dogs) buy only if left alone ✅[^5].

**Artifact:** rankings of 40,000 randomized test customers by four scores; "Qini top 30%" is the joint Qini value `Q(k)` (defined in How it works) at the top 30 % of the ranking: the estimated extra buyers among the treated customers in that slice (about half the slice, since half the test set got the offer); "Qini area" uses this doc's own normalization (oracle 1, random about 0), not scikit-uplift's; printed by the full script in the Worked example; lab run (`machine-learning/lab-setup.md`), 2026-11-25, scikit-learn 1.9.1 ✅[^10]:

```text
uplift test set: 40,000 customers, true mean uplift 0.0351, 30% with a negative true uplift
ranking                AUC for buying  Qini top 10%  Qini top 30%  Qini top 50%  Qini area
random order                    0.508          50.3         134.7         255.3      -0.01
response model                  0.706         -24.9        -173.6        -185.0      -0.79
T-learner uplift                0.360         178.4         447.5         721.2       0.76
true uplift (oracle)            0.331         218.4         587.0         728.2       1.00
```

The true uplift itself is the worst predictor of who buys (AUC 0.331) and the best ranking by effect; the response model is the reverse.

## How it works
### The CATE and why it is hard to learn
1. **Definition.** `τ(x) = E[Y(1) − Y(0) | X = x]`, the average of the individual effects `D_i = Y_i(1) − Y_i(0)` among units with covariates `x` ✅[^1]. Example: in the lab, `τ(x) = 1 + 2·x0`, so a unit with `x0 = 0.5` has CATE 2.0 and one with `x0 = −0.5` has CATE 0.0.
2. **The individual effect is not identifiable** without strong extra assumptions; but the estimator with the smallest mean squared error for the CATE at `x` is also the best estimator of an individual's effect at `x` in that sense ✅[^1].
3. **Assumptions.** No hidden confounders, and a propensity score `e(x) = P(T = 1 | X = x)` bounded away from 0 and 1 for every `x` ✅[^1]. The lab uses randomized assignment, so `e(x)` is the known constant share treated.
4. **Vocabulary.** DoWhy calls the same quantity a CACE (conditional average causal effect), `E[Y | do(A), X]`, and relies on EconML (or plain regression methods) to estimate it ✅[^4].
5. **Evaluation.** Because individual effects are never observed, accuracy against the true CATE (the lab's "RMSE vs true CATE", RMSE = root mean squared error) is only available in simulation ✅[^1]; on real data a targeting model is judged by what its ranking achieves in an experiment, which is what the Qini curve does.

### Meta-learners: CATE from ordinary regressors
A meta-learner combines base learners (any regression method) into a CATE estimate ✅[^1].
1. **S-learner (single model).** Fit `μ̂(x, t)` with the treatment `t` as one more feature; `τ̂(x) = μ̂(x, 1) − μ̂(x, 0)` ✅[^2]. Because the treatment indicator has no special role, learners such as the lasso and random forests can ignore it entirely: helpful when the CATE is zero in many places, but the S-learner can be biased toward zero ✅[^1]. Lab: slope of `τ̂` on the true `τ` 0.685 instead of 1 ✅[^10].
2. **T-learner (two models).** Fit `μ̂₁` on the treated and `μ̂₀` on the controls; `τ̂(x) = μ̂₁(x) − μ̂₀(x)` ✅[^2]. Not pooling the arms makes it hard to reproduce a pattern shared by both response functions, so it struggles when the effect is simple; with a very complicated effect and no common trends it does especially well ✅[^1].
3. **X-learner.** Start from the T-learner's two models, then impute each unit's effect with the other arm's model and regress the imputed effects on `x` ✅[^1]:

   ```text
   D̃¹_i = Y¹_i − μ̂₀(X¹_i)          treated unit: observed outcome minus predicted control outcome
   D̃⁰_i = μ̂₁(X⁰_i) − Y⁰_i          control unit: predicted treated outcome minus observed outcome
   τ̂₁ = regress D̃¹ on X¹,   τ̂₀ = regress D̃⁰ on X⁰
   τ̂(x) = g(x)·τ̂₀(x) + (1 − g(x))·τ̂₁(x),   g(x) = estimated propensity score
   ```

   Example: with 10 % treated, `g = 0.1`, so `τ̂ = 0.1·τ̂₀ + 0.9·τ̂₁`, leaning on the treated units' imputed effects, which use the control model fitted on the large arm ✅[^1]. The X-learner can adapt to structural properties of the CATE such as sparsity or smoothness, and is particularly effective when one arm is much larger than the other ✅[^1].
4. **No winner everywhere.** In Künzel et al.'s simulations each meta-learner is the best in some setting; their rule of thumb favours the X-learner unless the CATE is believed to be mostly zero ✅[^1]. Because the base learners trade bias and variance in unknown ways, EconML's meta-learners typically give no valid confidence intervals ✅[^2].
5. **DR (doubly robust) learner.** A fourth option regresses doubly robust pseudo-outcomes `Y^DR_1 − Y^DR_0` on `x`, built from an outcome model and a propensity model as in AIPW (augmented inverse probability weighting) ✅[^3].

### Uplift modeling and the Qini curve
1. **Uplift vs response model.** A response model predicts the probability of the action after a contact; an uplift model predicts the difference between behaviour with and without the contact, and is worth it when the action often happens without any contact ✅[^6]. Which of the four types a customer is cannot be observed, since nobody is both contacted and not contacted ✅[^5].
2. **The Qini curve (joint version).** Sort the test units by predicted uplift, and for each `k` count, among the top `k`: `N_T(k)` treated and `N_C(k)` control units, `R_T(k)` and `R_C(k)` responders in each. Then

   ```text
   Q(k) = R_T(k) − R_C(k) · N_T(k) / N_C(k)
   ```

   the treated responders minus the control responders rescaled to the treated count ✅[^9] ✅[^7]. Example: in the top 1,000, 300 treated with 60 buyers and 700 controls with 98 buyers give `60 − 98 · 300/700 = 60 − 42 = 18` extra buyers among the 300 treated; contacting all 1,000 would add about `18 · 1000/300 = 60`.
3. **Summaries.** Random targeting is the straight line from the origin to the curve's last point; scikit-uplift's Qini coefficient is the area between the model's curve and that line, divided by the same area for the optimum curve ✅[^8] ✅[^7], which scikit-uplift builds by ranking on the observed outcomes ✅[^7]. The lab's "Qini area" is this doc's own normalization, possible only in simulation: it divides by the area of the ranking by the true uplift instead, so the oracle scores 1.00 and random about 0, and its values are not comparable with `qini_auc_score`.
4. **Curves are not interchangeable.** Published Qini and uplift curves differ in ranking each arm separately or both jointly and in counting absolute or relative numbers; Devriendt et al. found the relative-count versions more robust to unequal group sizes ✅[^9]. Compare models only under one definition.

## Worked example
A CATE of `1 + 2·x0` on a baseline driven by other features (`2·x1 + 2·sin(3·x2) + x3²`), 4,000 randomized training units with 50 % or 10 % treated, gradient-boosted trees as base learners, evaluated on 5,000 test units with known CATE. Then a purchase experiment: the offer helps low-`x1` customers, slightly hurts high-`x1` customers, who also buy most, and four rankings are scored on 40,000 randomized test customers. The X-learner's core:

```python
d1 = Y[T] - mu0.predict(X[T])                  # imputed effects of the treated
d0 = mu1.predict(X[~T]) - Y[~T]                # imputed effects of the controls
tau1, tau0 = gbr().fit(X[T], d1).predict(Xt), gbr().fit(X[~T], d0).predict(Xt)
cate = g * tau0 + (1 - g) * tau1               # g = propensity (share treated)
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-25, scikit-learn 1.9.1, numpy 2.5.5, two runs identical; the last 6 lines are the Mental model artifact ✅[^10]:

```text
CATE = 1 + 2*x0; 4,000 training units; test on 5,000 units
treated share learner    RMSE vs true CATE  slope on true CATE  mean (ATE 1.0)
0.5           S                      0.402               0.685           0.961
0.5           T                      0.385               0.948           1.016
0.5           X                      0.210               0.945           1.014
0.1           S                      0.380               0.765           0.871
0.1           T                      0.577               0.944           0.936
0.1           X                      0.407               0.999           0.983
uplift test set: 40,000 customers, true mean uplift 0.0351, 30% with a negative true uplift
ranking                AUC for buying  Qini top 10%  Qini top 30%  Qini top 50%  Qini area
random order                    0.508          50.3         134.7         255.3      -0.01
response model                  0.706         -24.9        -173.6        -185.0      -0.79
T-learner uplift                0.360         178.4         447.5         721.2       0.76
true uplift (oracle)            0.331         218.4         587.0         728.2       1.00
```

<details><summary>Full script (prints the output above)</summary>

```python
# S-, T- and X-learners recovering a CATE that depends on one feature; then an uplift test:
# the best outcome predictor vs an uplift model, ranked by Qini curve (numpy + scikit-learn).
import numpy as np
from sklearn.ensemble import GradientBoostingClassifier, GradientBoostingRegressor
from sklearn.metrics import roc_auc_score
rng = np.random.default_rng(0)
gbr = lambda: GradientBoostingRegressor(n_estimators=200, max_depth=3, learning_rate=0.05, random_state=0)

def experiment(n, p_treat):                                  # randomized: P(T=1) = p_treat for everyone
    X = rng.uniform(-1, 1, size=(n, 5))
    mu0 = 2 * X[:, 1] + 2 * np.sin(3 * X[:, 2]) + X[:, 3] ** 2   # baseline outcome, ignores X0
    tau = 1 + 2 * X[:, 0]                                    # true CATE, depends on X0 only
    T = rng.random(n) < p_treat
    return X, T, mu0 + tau * T + rng.normal(size=n), tau

def s_learner(X, T, Y, Xt):
    m = gbr().fit(np.column_stack([X, T]), Y)
    return m.predict(np.column_stack([Xt, np.ones(len(Xt))])) - m.predict(np.column_stack([Xt, np.zeros(len(Xt))]))
def t_learner(X, T, Y, Xt):
    return gbr().fit(X[T], Y[T]).predict(Xt) - gbr().fit(X[~T], Y[~T]).predict(Xt)
def x_learner(X, T, Y, Xt, g):
    mu1, mu0 = gbr().fit(X[T], Y[T]), gbr().fit(X[~T], Y[~T])
    d1 = Y[T] - mu0.predict(X[T])                            # imputed effects of the treated
    d0 = mu1.predict(X[~T]) - Y[~T]                          # imputed effects of the controls
    tau1, tau0 = gbr().fit(X[T], d1).predict(Xt), gbr().fit(X[~T], d0).predict(Xt)
    return g * tau0 + (1 - g) * tau1                         # g = propensity score

Xt, _, _, tau_t = experiment(5000, 0.5)                      # test points with known CATE
print("CATE = 1 + 2*x0; 4,000 training units; test on 5,000 units")
print(f"{'treated share':<14}{'learner':<10}{'RMSE vs true CATE':>18}{'slope on true CATE':>20}{'mean (ATE 1.0)':>16}")
for p in (0.5, 0.1):
    X, T, Y, _ = experiment(4000, p)
    for name, est in (("S", s_learner(X, T, Y, Xt)), ("T", t_learner(X, T, Y, Xt)), ("X", x_learner(X, T, Y, Xt, p))):
        rmse = np.sqrt(np.mean((est - tau_t) ** 2))
        slope = np.polyfit(tau_t, est, 1)[0]
        print(f"{p:<14.1f}{name:<10}{rmse:18.3f}{slope:20.3f}{est.mean():16.3f}")

# Uplift: buying probability rises with x1 ("sure things"); the offer helps low-x1 users and
# slightly hurts high-x1 users ("sleeping dogs").
def customers(n):
    X = rng.normal(size=(n, 4))
    p0 = 0.05 + 0.6 / (1 + np.exp(-2 * X[:, 1]))             # baseline purchase probability
    uplift = 0.15 / (1 + np.exp(2 * X[:, 1])) - 0.04 + 0.03 * X[:, 0]   # true effect of the offer
    T = rng.random(n) < 0.5                                  # randomized offer
    Y = rng.random(n) < np.clip(p0 + uplift * T, 0, 1)
    return X, T, Y, uplift
X, T, Y, _ = customers(40_000)
Xv, Tv, Yv, uplift_v = customers(40_000)
gbc = lambda: GradientBoostingClassifier(n_estimators=200, max_depth=3, learning_rate=0.05, random_state=0)
response = gbc().fit(X, Y).predict_proba(Xv)[:, 1]          # "who will buy?" model
t_uplift = gbc().fit(X[T], Y[T]).predict_proba(Xv)[:, 1] - gbc().fit(X[~T], Y[~T]).predict_proba(Xv)[:, 1]

def qini(score):                                             # joint Qini curve: top-k by score
    o = np.argsort(-score, kind="stable")
    t, y = Tv[o], Yv[o]
    n_t, n_c = np.cumsum(t), np.cumsum(~t)
    r_t, r_c = np.cumsum(y & t), np.cumsum(y & ~t)
    return r_t - r_c * n_t / np.maximum(n_c, 1)              # extra buyers vs no offer, treated scale
rankings = {"random order": rng.random(len(Yv)), "response model": response,
            "T-learner uplift": t_uplift, "true uplift (oracle)": uplift_v}
curves = {k: qini(v) for k, v in rankings.items()}
base = np.linspace(0, curves["random order"][-1], len(Yv))   # the random-targeting diagonal
area = {k: np.mean(c - base) for k, c in curves.items()}
print(f"uplift test set: 40,000 customers, true mean uplift {uplift_v.mean():.4f}, {np.mean(uplift_v < 0):.0%} with a negative true uplift")
print(f"{'ranking':<22}{'AUC for buying':>15}" + "".join(f"{'Qini top ' + str(q) + '%':>14}" for q in (10, 30, 50)) + f"{'Qini area':>11}")
for k, c in curves.items():
    auc = roc_auc_score(Yv, rankings[k])
    cells = "".join(f"{c[int(len(c) * q / 100) - 1]:14.1f}" for q in (10, 30, 50))
    print(f"{k:<22}{auc:15.3f}{cells}{area[k] / area['true uplift (oracle)']:11.2f}")
```

</details>

Reading it, line by line:
- **S-learner shrinks:** its slope on the true CATE is 0.685 (balanced) and 0.765 (10 % treated), and with few treated units its average effect drops to 0.871, consistent with the bias toward zero Künzel et al. describe ✅[^1].
- **T-learner is noisy:** unbiased in slope (0.948, 0.944) but its error grows from 0.385 to 0.577 RMSE when only 400 units are treated: the treated-arm model must learn the whole baseline from them, the cost of not pooling the arms ✅[^1].
- **X-learner:** best RMSE with balanced arms (0.210) and the only near-unbiased slope with 10 % treated (0.999). Its RMSE there (0.407) is slightly above the S-learner's (0.380), whose lower error comes with a shrunken slope (0.765) and mean (0.871): no learner wins on every measure ✅[^1].
- **Uplift ranking:** the response model ranks the high-`x1` sure things and sleeping dogs first, so the treated customers in its top 30 % made an estimated 173.6 fewer purchases than they would have without the offer (`Q` = −173.6), and its Qini area is −0.79, below random. The T-learner uplift model predicts purchases worse than chance (AUC 0.360) and recovers 0.76 of the oracle's area.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| CATE zero almost everywhere | The S-learner does well, the T-learner poorly | The S-learner can ignore the treatment column ✅[^1] |
| Very unequal arms (lab: 10 % treated) | T-learner error grows (0.577); X-learner keeps an unbiased slope | X-learner leans on the model of the big arm ✅[^1]; lab ✅[^10] |
| Random-forest S-learner when the treatment strongly predicts the outcome | It splits on the treatment first and from there on behaves like a T-learner | 97.5 % of trees split first on treatment in Künzel et al.'s example ✅[^1] |
| Observational instead of randomized data | Meta-learners need no hidden confounders and bounded propensities | Their identification conditions ✅[^1]; DR pseudo-outcomes add the propensity model ✅[^3] |
| Customers the treatment harms | Targeting by response picks them early (lab Qini −173.6 at 30 %) | Sleeping dogs buy only if not contacted ✅[^5]; lab ✅[^10] |
| Action that rarely happens without treatment | A response model is enough | Uplift modeling is for actions likely to happen without contact ✅[^6] |
| Comparing Qini numbers across tools | Different definitions give different values | Separate vs joint ranking, absolute vs relative counts ✅[^9] |
| Confidence interval for a meta-learner's CATE | Usually not available | Arbitrary base learners ✅[^2] |
| Accuracy against the true CATE on real data | Cannot be computed | Individual effects are never observed ✅[^1] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| S-learner | One model, pools all data; good when the effect is mostly zero ✅[^1] | Biased toward zero (lab slope 0.685) ✅[^1] ✅[^10] |
| T-learner | Simple; good for complicated effects with no shared trends ✅[^1] | Poor when the effect is simple ✅[^1]; error grows when one arm is small (lab 0.577) ✅[^10] |
| X-learner | Adapts to a simple CATE; strong with unbalanced arms ✅[^1] | Four models plus a propensity ✅[^2]; usually worse than S when the CATE is zero ✅[^1] |
| DR-learner | Doubly robust pseudo-outcomes; a meaningful final regression even when misspecified ✅[^3] | Higher variance under small overlap ✅[^3] |
| Response model for targeting | Easy, high AUC for the outcome | Ranks by baseline, not effect (lab Qini area −0.79) ✅[^10] |

## Takeaways
- Target by estimated effect (uplift), not by predicted outcome, whenever the action can happen without the treatment. [rule-candidate]
- Judge a targeting model by its Qini or uplift curve on randomized hold-out data, never by its accuracy at predicting the outcome. [rule-candidate]
- Report which Qini definition and normalization you used when comparing models.
- With unbalanced arms, try the X-learner; if the effect is believed to be near zero almost everywhere, try the S-learner.
- In simulation, check a CATE estimator's slope on the true effect as well as its RMSE: a low error can hide a shrunken effect.

## Verification status
- Verified: 57 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [Metalearners for estimating heterogeneous treatment effects using machine learning](https://ar5iv.labs.arxiv.org/html/1706.03461) — Künzel, Sekhon, Bickel, Yu, 2017 (ar5iv HTML of arXiv:1706.03461). Backs: CATE definition, non-identifiable individual effects, MSE equivalence, identification conditions, S-, T- and X-learners, bias toward zero, the 97.5 % example, unbalanced arms, simulation conclusions. [^1]
- [EconML: Meta-Learners](https://www.pywhy.org/EconML/spec/estimation/metalearners.html) — PyWhy / EconML contributors, living (0.16.0 docs; library not installed in the lab). Backs: S- and T-learner formulas, no valid confidence intervals. [^2]
- [EconML: Doubly Robust Learning](https://www.pywhy.org/EconML/spec/estimation/dr.html) — PyWhy / EconML contributors, living (0.16.0 docs). Backs: DR pseudo-outcomes for the CATE, meaningful projection under misspecification, variance under small overlap. [^3]
- [DoWhy: Estimating conditional average causal effect](https://www.pywhy.org/dowhy/v0.14/user_guide/causal_tasks/estimating_causal_effects/conditional_effect_estimation/index.html) — PyWhy contributors, living (v0.14 docs; library not installed in the lab). Backs: CACE vocabulary, estimation through EconML or regression. [^4]
- [scikit-uplift: Types of customers](https://scikit-uplift.readthedocs.io/en/latest/user_guide/introduction/clients.html) — Maksim Shevchenko and contributors, living (0.5.1 docs). Backs: the four customer types, types are unobservable. [^5]
- [scikit-uplift: Uplift vs other models](https://scikit-uplift.readthedocs.io/en/latest/user_guide/introduction/comparison.html) — Maksim Shevchenko and contributors, living (0.5.1 docs). Backs: response vs uplift model, when uplift modeling is needed. [^6]
- [scikit-uplift source: sklift.metrics.metrics](https://scikit-uplift.readthedocs.io/en/latest/_modules/sklift/metrics/metrics.html) — Maksim Shevchenko and contributors, living (0.5.1). Backs: the joint Qini curve computation, the random baseline and the optimum curve behind `qini_auc_score`. [^7]
- [sklift.metrics.qini_auc_score](https://scikit-uplift.readthedocs.io/en/latest/api/metrics/qini_auc_score.html) — Maksim Shevchenko and contributors, living (0.5.1 docs). Backs: Qini coefficient as the ratio to the optimum curve's area above the diagonal. [^8]
- [Learning to Rank for Uplift Modeling](https://ar5iv.labs.arxiv.org/html/2002.05897) — Devriendt, Guns, Verbeke, 2020 (ar5iv HTML of arXiv:2002.05897). Backs: Qini and uplift curve definitions (separate, joint, absolute, relative), robustness of relative counts. [^9]
- `machine-learning/lab-setup.md` — the lab where the meta-learner and uplift script ran on 2026-11-25. [^10]

## Related
- `machine-learning/causal-inference/estimating-effects-from-observational-data.md` — propensity scores, AIPW and cross-fitting, which the DR-learner reuses.
- `machine-learning/causal-inference/potential-outcomes-and-experiments.md` — the randomized test that produces the data an uplift model is trained and judged on.
- `machine-learning/evaluation/classification-metrics.md` — ROC curves and AUC, the outcome-accuracy measures that do not rank effects.
- `machine-learning/supervised-learning/tree-ensembles.md` — gradient boosting, the base learner of the lab run.
- `machine-learning/reinforcement-learning/multi-armed-bandits.md` — learning whom to treat while treating, instead of from a finished experiment.
