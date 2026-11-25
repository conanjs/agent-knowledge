---
schema: topic-index/v1
kind: topic
topic: machine-learning
last-updated: 2026-11-25
---

# Machine learning

Machine learning from the basics to advanced use, written in our own words: what learning from data means and the core training loop, the classical supervised and unsupervised models, preparing data and evaluating models honestly, deep learning, transformers and large language models (pretraining, fine-tuning, alignment, decoding), generative models, reinforcement learning, probabilistic models, learning theory, running models in production, and the applied problem families: time-series forecasting, recommender systems, causal inference, and privacy-preserving machine learning. Every mechanism is explained with an analogy, a concrete artifact, the step-by-step mechanism and an edge-case table, with claims checked against official library docs, the originators' papers and free textbooks, and behaviours run in the Python lab described in `lab-setup.md` (scikit-learn 1.9.1, PyTorch 2.15.0). Start with `learning-path.md`. Not covered: specific cloud ML platforms, data engineering pipelines, and building agents on top of LLMs (see `ai-agents/`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [learning-path.md](learning-path.md) | reference | Eleven stages from foundations to LLMs, generative models, theory and applied problem families (time series, recommenders, causal inference, privacy), plus production alongside; docs to read in order, a lab exercise and a self-check per stage, free resources, and topics not covered yet | verified |
| [lab-setup.md](lab-setup.md) | how-to | A uv virtual environment with pinned numpy, scipy, scikit-learn, PyTorch (CPU) and pandas; seeded, download-free experiments; the source of every lab output | verified |

## Subtopics
| Subtopic | Summary |
|---|---|
| [foundations/](foundations/index.md) | Kinds of learning, generalization and overfitting, loss functions and maximum likelihood, gradient descent, regularization, notation reference |
| [supervised-learning/](supervised-learning/index.md) | Linear and logistic regression, k-nearest neighbours, decision trees, random forests and gradient boosting, support vector machines |
| [unsupervised-learning/](unsupervised-learning/index.md) | k-means, Gaussian mixtures and EM, DBSCAN and hierarchical clustering, PCA, t-SNE and UMAP |
| [data-and-features/](data-and-features/index.md) | Scaling and pipelines, categorical encodings and missing values, feature importance and selection |
| [evaluation/](evaluation/index.md) | Classification metrics and thresholds, metrics catalog, cross-validation and hyperparameter search, data leakage, class imbalance, calibration |
| [deep-learning/](deep-learning/index.md) | Backpropagation and autograd, the training loop and debugging, activations and initialization, optimizers and schedules, normalization and dropout, augmentation and transfer learning, CNNs and modern CNN architectures, RNNs and LSTMs, embeddings and self-supervised learning, graph neural networks, mixed precision and distributed training, interpretability, adversarial robustness, loss landscapes |
| [transformers/](transformers/index.md) | Tokenization, attention and the transformer block, pretraining and scaling laws, fine-tuning and LoRA, RLHF and DPO, decoding and the KV cache, vision transformers, mixture of experts, efficient attention and state-space models |
| [generative-models/](generative-models/index.md) | Generative model families compared, VAEs, GANs, diffusion models |
| [reinforcement-learning/](reinforcement-learning/index.md) | MDPs and Bellman equations, bandits, TD learning and Q-learning, deep Q-networks, policy gradients and PPO |
| [probabilistic-ml/](probabilistic-ml/index.md) | Bayesian inference (MLE, MAP, posteriors), naive Bayes, Gaussian processes |
| [learning-theory/](learning-theory/index.md) | PAC learning and VC dimension, double descent, no-free-lunch and inductive bias |
| [ml-systems/](ml-systems/index.md) | Hidden technical debt, data drift and monitoring, reproducibility and determinism, compression and quantization |
| [recommender-systems/](recommender-systems/index.md) | Collaborative filtering and matrix factorization, implicit feedback and ranking losses, ranking metrics, two-stage retrieval and ranking, cold start and feedback loops |
| [time-series/](time-series/index.md) | Trend, seasonality, stationarity and autocorrelation; naive baselines, exponential smoothing and ARIMA; lag-feature forecasters, multi-step strategies, backtesting and prediction intervals |
| [causal-inference/](causal-inference/index.md) | Potential outcomes and A/B tests, causal graphs and confounding, propensity scores, doubly robust and double machine learning, heterogeneous effects and uplift |
| [privacy-preserving-ml/](privacy-preserving-ml/index.md) | Differential privacy and its mechanisms, DP-SGD, federated learning, membership inference and memorization |

## References
- [scikit-learn User Guide](https://scikit-learn.org/stable/user_guide.html) — scikit-learn developers, living. Backs: topic scope (classical ML).
- [Dive into Deep Learning](https://d2l.ai/) — Aston Zhang, Zachary C. Lipton, Mu Li, Alexander J. Smola, living. Backs: topic scope (deep learning).
- [PyTorch documentation](https://docs.pytorch.org/docs/2.15/) — PyTorch Foundation, 2026. Backs: topic scope (deep learning lab).

## Related
- `algorithms/vector-search-evaluation.md` — evaluating nearest-neighbour search over embeddings.
- `floating-point/` — the number formats (fp16, bf16) that mixed-precision training uses.
- `ai-agents/` — agents built on large language models.
