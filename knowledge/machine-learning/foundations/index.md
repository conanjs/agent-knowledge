---
schema: topic-index/v1
kind: subtopic
topic: machine-learning/foundations
last-updated: 2026-11-24
---

# Machine learning fundamentals

What learning from data means and the core training loop that every later doc builds on: the kinds of learning and the end-to-end workflow, why training error is not test error (overfitting, the bias–variance decomposition, train/validation/test splits), what a loss function measures and why MSE and cross-entropy are maximum-likelihood losses, how gradient descent fits parameters (learning rate, batches, conditioning), how ridge, lasso, elastic net and early stopping regularize, and a reference card for the notation. Written for a programmer with no ML background; each doc has a lab experiment with its full script. Not covered: specific model families (see `machine-learning/supervised-learning/` and later subtopics), evaluation metrics and cross-validation schemes (see `machine-learning/evaluation/`), and optimizers beyond plain gradient descent (see `machine-learning/deep-learning/`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [what-is-machine-learning.md](what-is-machine-learning.md) | concept | Learning from data vs writing rules; Mitchell's task/experience/performance definition; supervised, unsupervised, self-supervised, reinforcement; parameters vs hyperparameters; training vs inference; the end-to-end workflow | verified |
| [generalization-and-overfitting.md](generalization-and-overfitting.md) | concept | Training vs generalization error, underfitting and overfitting, train/validation/test splits, bias² + variance + noise, learning curves; a polynomial-degree sweep in the lab | verified |
| [loss-functions-and-maximum-likelihood.md](loss-functions-and-maximum-likelihood.md) | concept | Empirical risk minimization; MSE, MAE, Huber, log loss, cross-entropy, hinge; MSE = Gaussian maximum likelihood, cross-entropy = softmax maximum likelihood; MAP and penalties | verified |
| [gradient-descent.md](gradient-descent.md) | concept | Gradient and update rule, learning rate (converge, oscillate, diverge), batch vs stochastic vs mini-batch, convergence, condition number and feature scaling | verified |
| [regularization.md](regularization.md) | concept | L2/ridge and weight decay, L1/lasso and exact zeros, elastic net with correlated features, early stopping, choosing the strength | verified |
| [math-notation-reference.md](math-notation-reference.md) | reference | Every symbol the ML docs use (vectors, norms, Σ, ∇, argmin, E[·], variance, log/exp, sigmoid, softmax, log-sum-exp) with one lab-checked number and the numpy call | verified |

## References
- [scikit-learn User Guide](https://scikit-learn.org/stable/user_guide.html) — scikit-learn developers, living. Backs: topic scope.
- [Deep Learning, chapter 5: Machine Learning Basics](https://www.deeplearningbook.org/contents/ml.html) — Ian Goodfellow, Yoshua Bengio, Aaron Courville, 2016. Backs: topic scope (learning algorithms, capacity, estimators, maximum likelihood).
- [Dive into Deep Learning](https://d2l.ai/) — Aston Zhang, Zachary C. Lipton, Mu Li, Alexander J. Smola, living. Backs: topic scope (preliminaries, linear models, optimization).
- [Machine Learning Crash Course](https://developers.google.com/machine-learning/crash-course?hl=en) — Google for Developers, living. Backs: topic scope (loss, gradient descent, overfitting, regularization).

## Related
- `machine-learning/learning-path.md` — where this subtopic sits in the reading order.
- `machine-learning/lab-setup.md` — the lab every experiment ran in.
- `machine-learning/supervised-learning/` — the first model families built on these foundations.
- `machine-learning/evaluation/` — metrics, cross-validation and leakage in depth.
