---
schema: topic-index/v1
kind: subtopic
topic: machine-learning/supervised-learning
last-updated: 2026-11-24
---

# Classical supervised learning

The classical models that learn from labelled examples: linear and logistic regression, generalized linear models (Poisson, Gamma, Tweedie), linear and quadratic discriminant analysis, survival analysis for censored time-to-event data, k-nearest neighbours, decision trees, tree ensembles (random forests, gradient boosting) and support vector machines, each with its mechanism, its knobs in scikit-learn 1.9.1, its failure modes, and a lab experiment that shows the mechanism with real numbers. Read them in table order: each doc builds on the one before (the linear score, then trees, then ensembles of trees). Not covered: the shared foundations these docs link to instead of repeating (loss functions, gradient descent, regularization, overfitting: see `machine-learning/foundations/`), neural networks (see `machine-learning/deep-learning/`), naive Bayes and Gaussian processes (see `machine-learning/probabilistic-ml/`), and how to evaluate models (see `machine-learning/evaluation/`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [linear-regression.md](linear-regression.md) | concept | Least squares, the normal equation and its geometry, R², collinearity and the other assumptions; normal equation vs `LinearRegression` vs gradient descent in the lab | verified |
| [logistic-regression.md](logistic-regression.md) | concept | Sigmoid and log-odds, the linear decision boundary, multinomial softmax, scikit-learn's `C` and `l1_ratio`, separable data and XOR | verified |
| [k-nearest-neighbors.md](k-nearest-neighbors.md) | concept | Distances, majority vote vs distance weights, choosing k, why scaling matters, irrelevant features and distance concentration in high dimensions | verified |
| [decision-trees.md](decision-trees.md) | concept | CART's greedy split search, Gini and entropy by hand, depth and leaf limits, cost-complexity pruning, why trees overfit and do not extrapolate | verified |
| [tree-ensembles.md](tree-ensembles.md) | concept | Bagging and random forests (variance, out-of-bag), gradient boosting as trees fitted to negative gradients, shrinkage, histogram gradient boosting | verified |
| [support-vector-machines.md](support-vector-machines.md) | concept | Maximum margin, hinge loss and the soft-margin `C`, support vectors and the dual, the kernel trick, RBF `gamma` from under- to overfitting | verified |
| [generalized-linear-models.md](generalized-linear-models.md) | concept | Link and variance functions, deviance, Poisson regression with an exposure offset (IRLS by hand = PoissonRegressor), Gamma and Tweedie for positive targets, why least squares on counts or logs fails | verified |
| [discriminant-analysis.md](discriminant-analysis.md) | concept | Gaussian class models and Bayes' rule, LDA by hand vs scikit-learn, QDA vs LDA, Ledoit–Wolf shrinkage with few samples, LDA as a supervised projection, links to logistic regression and naive Bayes | verified |
| [survival-analysis.md](survival-analysis.md) | concept | Censoring, survival and hazard functions, Kaplan–Meier, the log-rank test, the Cox model by partial likelihood (Breslow/Efron ties) and its proportional-hazards check, Harrell's C-index; numpy code reproduces the published Gehan results; why dropping censored rows biases | verified |

## References
- [scikit-learn User Guide](https://scikit-learn.org/stable/user_guide.html) — scikit-learn developers, living. Backs: topic scope.
- [1.1. Linear Models](https://scikit-learn.org/stable/modules/linear_model.html), [1.4. Support Vector Machines](https://scikit-learn.org/stable/modules/svm.html), [1.6. Nearest Neighbors](https://scikit-learn.org/stable/modules/neighbors.html), [1.10. Decision Trees](https://scikit-learn.org/stable/modules/tree.html), [1.11. Ensembles](https://scikit-learn.org/stable/modules/ensemble.html) — scikit-learn developers, living (1.9.1 docs). Backs: the mechanisms and parameters of each model in this subtopic.
- [Dive into Deep Learning, chapters 3 and 4](https://d2l.ai/chapter_linear-regression/linear-regression.html) — Zhang, Lipton, Li, Smola, living. Backs: linear and softmax regression derivations.

## Related
- `machine-learning/learning-path.md` — where this subtopic sits in the reading order.
- `machine-learning/lab-setup.md` — the lab every experiment ran in.
- `machine-learning/foundations/` — loss functions, gradient descent, regularization and overfitting, which every doc here links to.
- `machine-learning/evaluation/` — metrics, cross-validation and calibration for the models here.
- `machine-learning/data-and-features/` — scaling, encoding and feature importance for these models.
