---
schema: topic-index/v1
kind: subtopic
topic: machine-learning/learning-theory
last-updated: 2026-11-24
---

# Learning theory

Why and when learning from finite data works: the PAC (probably approximately correct) definition, sample complexity and VC (Vapnik–Chervonenkis) dimension, and what such bounds do and do not promise; double descent in over-parameterized models; the no-free-lunch theorems and the inductive bias every model family brings. Each doc has a CPU-sized lab run (a shattering search, a bound checked by simulation, a random-features sweep, an exhaustive enumeration), with the full script inline. Not covered: the practical bias–variance trade-off and learning curves (see `machine-learning/foundations/generalization-and-overfitting.md`), and proofs beyond the short ones the docs sketch.

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [pac-learning-and-vc-dimension.md](pac-learning-and-vc-dimension.md) | concept | The ε–δ PAC definition, finite-class and VC sample complexity, shattering, why bounds are loose and blind to label quality | verified |
| [double-descent.md](double-descent.md) | concept | U-curve vs double descent, the interpolation threshold, minimum-norm interpolation, deep (model-, epoch-, sample-wise) double descent | verified |
| [no-free-lunch-and-inductive-bias.md](no-free-lunch-and-inductive-bias.md) | concept | All learners tie on off-training-set error averaged over all targets; inductive bias per model family; cross-validation as an assumption | verified |

## References
- [Deep Learning, chapter 5: Machine Learning Basics](https://www.deeplearningbook.org/contents/ml.html) — Goodfellow, Bengio, Courville, 2016. Backs: topic scope (capacity, VC dimension, no free lunch).
- [Generalization (Patterns, Predictions, and Actions)](https://mlstory.org/generalization.html) — Hardt, Recht, living. Backs: topic scope (uniform convergence, overparameterization).

## Related
- `machine-learning/learning-path.md` — where this subtopic sits in the reading order.
- `machine-learning/lab-setup.md` — the lab every experiment ran in.
- `machine-learning/foundations/generalization-and-overfitting.md` — the practical side of generalization.
- `machine-learning/foundations/regularization.md` — preferences written into the objective.
- `machine-learning/evaluation/cross-validation-and-hyperparameter-search.md` — estimating generalization from data.
