---
schema: topic-index/v1
kind: subtopic
topic: machine-learning/recommender-systems
last-updated: 2026-11-25
---

# Recommender systems

Predicting what a user will want from past interactions. The docs cover collaborative filtering and matrix factorization on explicit ratings; learning from implicit feedback with confidence weighting and ranking losses, and evaluating a ranked list offline without the sampled-metric trap; the multi-stage retrieval-and-ranking pipeline, with two-tower models, the popularity bias of in-batch negatives and cold start; and the feedback loop that forms when a recommender is retrained on the clicks its own lists produced. Every experiment runs on simulated users and items whose ground truth is known. Not covered: approximate nearest-neighbour search itself (see `algorithms/vector-search-evaluation.md`), sequence-aware and session-based recommenders, and click-through-rate models for the ranking stage.

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [collaborative-filtering-and-matrix-factorization.md](collaborative-filtering-and-matrix-factorization.md) | concept | The sparse user–item matrix, item-kNN, matrix factorization with biases trained by SGD vs ALS, rank and regularization, RMSE against a noise floor | verified |
| [implicit-feedback-and-ranking.md](implicit-feedback-and-ranking.md) | concept | Clicks and plays as implicit feedback, confidence-weighted ALS (iALS), BPR with negative sampling, leave-one-out recall@k and NDCG, why sampled metrics can reverse model order, the popularity baseline | verified |
| [retrieval-and-ranking-pipelines.md](retrieval-and-ranking-pipelines.md) | concept | Candidate generation, scoring and re-ranking; two-tower models with in-batch negatives and the logQ correction against a full softmax; cold start from content features | verified |
| [feedback-loops-and-popularity-bias.md](feedback-loops-and-popularity-bias.md) | concept | Algorithmic confounding when a recommender retrains on its own logs: homogenized users, concentrated exposure (Gini, distinct items), biased offline evaluation; a 30-round simulation with exploration slots and a randomly collected log | verified |

## References
- [Introduction (Recommendation Systems course)](https://developers.google.com/machine-learning/recommendation?hl=en) — Google for Developers, living. Backs: topic scope (candidate generation, matrix factorization, deep models, retrieval, scoring, re-ranking).
- [Recommender Systems (Dive into Deep Learning, chapter 21)](https://d2l.ai/chapter_recommender-systems/index.html) — Zhang, Lipton, Li, Smola, living. Backs: topic scope (explicit and implicit feedback, matrix factorization, personalized ranking).

## Related
- `machine-learning/learning-path.md` — where this subtopic sits in the reading order.
- `machine-learning/lab-setup.md` — the lab every experiment ran in.
- `machine-learning/evaluation/metrics-catalog.md` — NDCG and the other ranking metrics.
- `machine-learning/deep-learning/embeddings-and-self-supervised-learning.md` — embeddings and in-batch contrastive losses.
- `machine-learning/ml-systems/hidden-technical-debt.md` — feedback loops as system debt.
- `algorithms/vector-search-evaluation.md` — approximate nearest-neighbour search for the retrieval stage.
