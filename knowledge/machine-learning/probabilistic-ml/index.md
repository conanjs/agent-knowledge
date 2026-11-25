---
schema: topic-index/v1
kind: subtopic
topic: machine-learning/probabilistic-ml
last-updated: 2026-11-24
---

# Probabilistic machine learning

Models that reason with explicit probabilities: Bayesian inference over parameters (prior, likelihood, posterior; MLE vs MAP vs the full posterior; Beta–Binomial conjugacy; MAP with a Gaussian prior as ridge), naive Bayes classifiers (conditional independence, Gaussian, multinomial and Bernoulli variants, smoothing, over-confident probabilities) and Gaussian processes (priors over functions, kernels, closed-form posterior mean and variance, marginal-likelihood fitting, cubic cost). Each mechanism is computed by hand in the lab and checked against scipy or scikit-learn. Not covered: Gaussian mixtures (see `machine-learning/unsupervised-learning/gaussian-mixtures-and-em.md`), MLE as the origin of common losses (see `machine-learning/foundations/loss-functions-and-maximum-likelihood.md`), and variational inference in deep generative models (see `machine-learning/generative-models/variational-autoencoders.md`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [bayesian-inference.md](bayesian-inference.md) | concept | Bayes' rule over parameters; 3/3 heads gives MLE 1.000, MAP 0.800, mean 0.714 under a Beta(2,2) prior; posterior predictive; MAP with a Gaussian prior equals ridge | verified |
| [naive-bayes.md](naive-bayes.md) | concept | Conditional independence, the Gaussian / multinomial / Bernoulli variants, Laplace smoothing by hand, duplicated features pushing probabilities to 0 and 1 | verified |
| [gaussian-processes.md](gaussian-processes.md) | concept | Distributions over functions, RBF kernel, posterior mean and std by hand, marginal likelihood as fit vs complexity, local optima, `O(n³)` fit time | verified |

## References
- [scikit-learn User Guide](https://scikit-learn.org/stable/user_guide.html) — scikit-learn developers, living. Backs: topic scope.
- [Deep Learning, chapter 5: Machine Learning Basics](https://www.deeplearningbook.org/contents/ml.html) — Goodfellow, Bengio, Courville, MIT Press, 2016. Backs: frequentist vs Bayesian estimation, MAP.
- [Dive into Deep Learning, chapter 18: Gaussian Processes](https://d2l.ai/chapter_gaussian-processes/index.html) — Zhang, Lipton, Li, Smola, living. Backs: Gaussian processes in the scope.

## Related
- `machine-learning/learning-path.md` — where this subtopic sits in the reading order.
- `machine-learning/lab-setup.md` — the lab every experiment ran in.
- `machine-learning/evaluation/probability-calibration.md` — checking and fixing predicted probabilities.
- `machine-learning/foundations/regularization.md` — penalties that MAP estimation explains.
