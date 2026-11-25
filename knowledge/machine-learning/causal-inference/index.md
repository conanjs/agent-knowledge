---
schema: topic-index/v1
kind: subtopic
topic: machine-learning/causal-inference
last-updated: 2026-11-25
---

# Causal inference

Estimating what an action does, not just what it predicts: potential outcomes and randomized experiments (A/B tests), causal graphs and confounding, estimating effects from observational data (regression adjustment, propensity scores, doubly robust and double machine learning), effects that differ between people (meta-learners, uplift), and causal discovery, learning the graph itself from data (the PC algorithm, GES, LiNGAM, NOTEARS, FCI). Every experiment simulates data from a known structural model, so the true effect or graph is known; the estimators and search algorithms are written in numpy, scipy and scikit-learn. Not covered: instrumental variables, regression discontinuity and difference-in-differences.

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [potential-outcomes-and-experiments.md](potential-outcomes-and-experiments.md) | concept | Potential outcomes, ATE/ATT, why randomization removes selection bias; A/B test standard error, confidence interval, power and sample size; peeking inflates false positives (24.3 % vs 5 % in the lab) | verified |
| [causal-graphs-and-confounding.md](causal-graphs-and-confounding.md) | concept | DAGs, confounders, mediators, colliders; d-separation and the backdoor criterion; Simpson's paradox; why "control for everything" adds mediator and collider bias | verified |
| [estimating-effects-from-observational-data.md](estimating-effects-from-observational-data.md) | concept | Consistency, unconfoundedness, positivity; regression adjustment, IPW, matching, doubly robust AIPW; extreme propensities; double ML with cross-fitting | verified |
| [heterogeneous-treatment-effects.md](heterogeneous-treatment-effects.md) | concept | CATE; S-, T- and X-learners; uplift modeling and the Qini curve; why the best outcome predictor can rank effects worst | verified |
| [causal-discovery.md](causal-discovery.md) | concept | Markov and faithfulness assumptions, Markov equivalence classes and CPDAGs; the PC algorithm with Fisher-z tests, GES with BIC, LiNGAM's non-Gaussian orientation, NOTEARS's acyclicity function, FCI with hidden confounders; what discovery cannot do | verified |

## References
- [Causal Inference: The Remix](https://mixtape.scunning.com/) — Scott Cunningham, living (free online textbook). Backs: topic scope: potential outcomes, DAGs, unconfoundedness.
- [Double/Debiased Machine Learning for Treatment and Structural Parameters](https://ar5iv.labs.arxiv.org/html/1608.00060) — Chernozhukov et al., 2016. Backs: the machine-learning side of effect estimation.
- [DoWhy documentation](https://www.pywhy.org/dowhy/v0.14/user_guide/index.html) — PyWhy contributors, living. Backs: vocabulary of modeling, identification, estimation and refutation.
- [EconML documentation](https://www.pywhy.org/EconML/) — PyWhy / EconML contributors, living. Backs: vocabulary of CATE estimators.
- [causal-learn documentation](https://causal-learn.readthedocs.io/) — causal-learn developers (CLeaR), living. Backs: vocabulary of causal discovery methods (PC, FCI, GES, LiNGAM) and independence tests.
- [scikit-learn User Guide](https://scikit-learn.org/stable/user_guide.html) — scikit-learn developers, living. Backs: topic scope (the models used as propensity, outcome and base learners).

## Related
- `machine-learning/learning-path.md` — where this subtopic sits in the reading order.
- `machine-learning/lab-setup.md` — the lab every experiment ran in.
- `machine-learning/reinforcement-learning/multi-armed-bandits.md` — adaptive experiments that trade testing for earning.
- `machine-learning/data-and-features/partial-dependence-and-shapley-values.md` — explanations of predictive models, which are not causal effects.
- `machine-learning/evaluation/data-leakage.md` — the predictive-modelling cousin of post-treatment bias.
