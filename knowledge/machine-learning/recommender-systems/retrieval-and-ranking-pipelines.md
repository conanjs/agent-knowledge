---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/recommender-systems
status: verified
applies-to: ["any"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, recommender-systems, candidate-generation, retrieval, ranking, re-ranking, two-tower, in-batch-negatives, sampled-softmax, logq-correction, cold-start, popularity-bias]
---

# Retrieval and ranking pipelines: two towers, the logQ correction and cold start

## Summary
**TL;DR:** A large recommender works in stages. Candidate generation (retrieval) cuts a corpus of millions or billions of items down to hundreds, using cheap embedding similarity. A scoring model ranks those few with richer features, and re-ranking applies filters, freshness and diversity. A two-tower model embeds the user with one network and the item with another, and scores the pair by a dot product. That makes retrieval a nearest-neighbour search. Training it with the other items in the batch as negatives samples negatives in proportion to popularity, so popular items get pushed down unless each logit has `log Q(item)` subtracted (the logQ correction). An item tower built on content features can score items that have no interactions yet (cold start). The shown lists also become the next training log, a feedback loop with its own doc.
**Use this when:** you design or debug a retrieval stage, train a two-tower model with in-batch negatives, see popular items vanish from (or flood) the recommendations, or need to recommend new items.
**Not this doc:** matrix factorization and ALS (alternating least squares) → `machine-learning/recommender-systems/collaborative-filtering-and-matrix-factorization.md`; BPR (Bayesian personalized ranking) and ranked-list metrics → `machine-learning/recommender-systems/implicit-feedback-and-ranking.md`; approximate nearest-neighbour search → `algorithms/vector-search-evaluation.md`; contrastive losses and InfoNCE (information noise-contrastive estimation) in general → `machine-learning/deep-learning/embeddings-and-self-supervised-learning.md`; exploration algorithms → `machine-learning/reinforcement-learning/multi-armed-bandits.md`; what retraining on the pipeline's own logs does to exposure and utility, and the Gini coefficient → `machine-learning/recommender-systems/feedback-loops-and-popularity-bias.md`.

## Problem
No single model can score every item with every feature for every request. The candidate generator of one large video service reduces billions of videos to hundreds or thousands before anything else runs ✅[^1]. Training a softmax over a whole catalog of millions of items is infeasible too, so the loss is approximated with sampled negatives ✅[^10]. The cheapest source of negatives, the other items in the same mini-batch, follows item popularity, so popular items appear as negatives more often and are over-penalized ✅[^10]. In the lab, that bias alone halved recall@10 ✅[^16]. Two more problems come from how data arrive. A model keyed on item IDs (identifiers) cannot score an item it never saw in training ✅[^12]. And the training data come from users who were shown the previous model's recommendations, a feedback loop that in Chaney et al.'s simulations homogenized user behaviour without increasing utility ✅[^14]; it has its own doc, `machine-learning/recommender-systems/feedback-loops-and-popularity-bias.md`.

## Mental model
**Analogy:** hiring. A keyword filter (cheap, tuned for recall) cuts 10,000 applications to 200. Interviews (expensive, precise) rank the 200. A final pass applies constraints, such as not hiring everyone from one team. If the filter drops the best applicant, no interview can bring them back, so the retrieval stage caps the whole system. In-batch negatives are like judging each applicant against whoever else happened to apply that day. A very common profile turns up in every day's pile, so it is the competitor beaten most often, and it gets marked down unless you discount it by how often it appears.

**Artifact:** the same two-tower model trained three ways, next to the true model (oracle). Lab run (`machine-learning/lab-setup.md`), 2026-11-25, PyTorch 2.15.0 ✅[^16]:

```text
oracle (true logits)     recall@10 0.363 recall@100 0.688 | head share of top-10 lists 0.88 | most frequent item's mean rank   56.8
in-batch, no correction  recall@10 0.183 recall@100 0.474 | head share of top-10 lists 0.20 | most frequent item's mean rank  989.6
in-batch + logQ          recall@10 0.348 recall@100 0.668 | head share of top-10 lists 0.88 | most frequent item's mean rank   96.1
full softmax             recall@10 0.346 recall@100 0.670 | head share of top-10 lists 0.87 | most frequent item's mean rank  100.6
```

Without the correction, the most frequent item is ranked about 990th on average among 1,800 warm items (items that do appear in training). Only 20 % of the top-10 slots go to the head of the catalog (its 10 % most frequent items), against 88 % for the true model. Subtracting `log Q` restores both, and it matches a full softmax over every item.

## How it works
### The stages: who does what
**4 actors:**
- **Candidate generators** — their job: nominate a few hundred items from the whole corpus, via embedding similarity (a two-tower model with approximate nearest-neighbour (ANN) search, or matrix factorization (MF)) or via simple sources such as popular items or a social graph ✅[^1] ✅[^5].
- **Scoring model (ranker)** — its job: order the pooled candidates, via one model that sees query and item features together ✅[^5].
- **Re-ranker** — its job: enforce constraints, via filters and score adjustments for freshness, diversity and fairness ✅[^1] ✅[^6].
- **Logging and training** — its job: turn what users did with the shown items into the next training set, via the interaction log ✅[^14].

```text
corpus (millions) ──► candidate generators ──► ~hundreds ──► scoring model ──► ~10 ranked ──► re-ranker ──► shown
       ▲                 (two-tower ANN, MF,                    (rich features,                (filters,       │
       │                  popular, social)                       one comparable score)          freshness,     │
       │                                                                                         diversity)    ▼
       └──────────────── next training set ◄── log of what users clicked among the shown items ◄─────────────┘
```

1. **Candidate generators:** given the query (the user and context), each generator returns candidates. One system may run several generators that nominate different subsets ✅[^1]. Content-based filtering finds items similar to what the user liked. Collaborative filtering uses similarities between queries and items at the same time ✅[^3].
2. **Retrieval inside a generator:** look up (for MF) or compute (for a neural model) the query embedding `q`, then return the `k` items with the highest similarity `s(q, V_j)`. That is a nearest-neighbour problem. For a static query embedding the top items can be precomputed, and ANN search avoids scoring every item ✅[^4]. A dot product allows efficient maximum inner product search, but an MLP (multilayer perceptron) similarity does not, and it costs `O(d²)` per pair instead of `O(d)` ✅[^11].
3. **Scoring model:** pools all candidates and scores them with one model. Scores from different generators might not be comparable, and a small pool lets the ranker afford more features and a bigger model ✅[^5]. The objective decides what wins. Optimizing clicks can surface click-bait, and optimizing watch time can surface overly long videos ✅[^5]. Lower positions get fewer clicks, so Google's course suggests scoring every candidate as if it were in the top position ✅[^5].
4. **Re-ranker:** removes items (a separate click-bait classifier, items the user disliked) or transforms scores (boost fresh content). It re-ranks by genre or other metadata for diversity, and tracks metrics per demographic for fairness ✅[^1] ✅[^6].
5. **Logging and training:** the clicks on the shown items become the next training data, which closes a feedback loop ✅[^14] (its effects: `machine-learning/recommender-systems/feedback-loops-and-popularity-bias.md`).

The two-stage split (deep candidate generation, then a separate deep ranking model) is how Covington et al. describe a production video recommender ✅[^2].

### Two-tower models
1. **Softmax view:** a softmax DNN (deep neural network) treats recommendation as multiclass prediction. A network `ψ(x)` maps query features to a `d`-dimensional vector, and `p̂_j = exp(⟨ψ(x), V_j⟩) / Z`. So each row `V_j` of the output layer is item `j`'s embedding, and the dot product is the similarity ✅[^7]. With `ψ` replaced by a per-user lookup, this is matrix factorization ✅[^7].
2. **Two towers:** replace the item lookup by a second network `φ(x_item)` over item features. The score is `⟨ψ(x_query), φ(x_item)⟩`, one value per (query, item) pair ✅[^7]. The item tower can then encode a wide variety of item features, which helps with sparse data and power-law popularity ✅[^9].
3. **Similarity choice:** with a dot product, embeddings with a large norm score higher. Frequent items tend to get large norms, so popular items can dominate. Google's course suggests `‖q‖^α·‖x‖^α·cos(q, x)` with `0 < α < 1` to soften this ✅[^3].

### In-batch negatives and the logQ correction
1. **Full softmax loss:** `L = −log( exp(s(u,p)) / Σ_(d∈catalog) exp(s(u,d)) )`, where `s` is the model score and `p` the positive item. Over a catalog of millions of items, the denominator is too costly ✅[^10].
2. **Sampled softmax with in-batch negatives:** keep in the denominator only the positive and the batch's other positives. This is cheap, but the negatives then follow the unigram (popularity) distribution of the training data, so popular items are over-represented among the negatives and over-penalized ✅[^10]. Yi et al. call this the sampling bias of the batch loss, and say it can severely limit model quality under a power-law item distribution ✅[^9].
3. **The correction:** subtract the log of each item's sampling probability from its logit, `s(u,d) − log Q(d)`. The derivation is weighted importance sampling, following Bengio and Senecal ✅[^10]. Worked numbers: in the lab the most frequent item fills `Q = 0.0585` of the batch slots and a median warm item `Q = 0.00023`. The correction adds `−log 0.0585 = 2.84` to the first logit and `−log 0.00023 = 8.38` to the second. The rare item gains 5.5 logits on the popular one, a factor of `0.0585 / 0.00023 ≈ 254` in odds, which offsets how much more often the popular item serves as a negative ✅[^16].
4. **Estimating Q:** in a stream with no fixed vocabulary, Yi et al. estimate item frequencies with a sketch updated by gradient descent ✅[^9]. Khrylchenko et al. use a count-min sketch ✅[^10]. They also note that the positive item is not sampled at all, and refine the correction accordingly ✅[^10]. The lab knows `Q` exactly and also masks in-batch copies of the positive item, so a duplicate is not counted as a negative ✅[^16].
5. **Other negatives:** Google's course also lists sampling hard negatives, items with a high current score. Without any negatives, embeddings of unrelated groups can fold onto each other ✅[^8].

### Cold start
- **What it is:** recommending for new users, or recommending new items to existing users ✅[^15]. An ID-based model has no embedding for an item it has not seen ✅[^12]. Spark returns NaN (not a number) for an unknown user or item, which a production system can use as a signal to fall back to something else ✅[^17].
- **A few interactions:** solve one ALS half-step for the new item against the fixed user factors (projection in WALS, weighted ALS), without retraining ✅[^12].
- **None yet:** average the embeddings of items in the same category or from the same uploader ✅[^12]. Use a model whose input is features, such as a two-tower or softmax DNN, which can run on an item or query not seen in training ✅[^6] ✅[^8]. Add the item's age as a feature ✅[^6]. Content-based scoring needs no data about other users and can reach niche items, but it is only as good as the hand-engineered features ✅[^13].
- **New users:** an "average" user, or one per cluster of user features, for MF ✅[^6]. Popular or trending items are one of the standard candidate sources ✅[^5], and they need no history of the user.
- **Exploration:** a new item that is never shown never collects interactions. The systematic answer is an explore–exploit policy (`machine-learning/reinforcement-learning/multi-armed-bandits.md`), and Chaney et al. note the natural connection between recommendation and the explore/exploit trade-off ✅[^14].

### Feedback loops
Each retrain learns from clicks on what the previous model chose to show, so the log mixes users' preferences with the model's own choices ✅[^14]. How that homogenizes users and concentrates exposure, how to measure it with the Gini coefficient, a 30-round lab simulation and what helps are in `machine-learning/recommender-systems/feedback-loops-and-popularity-bias.md`.

## Worked example
2,000 users and 2,000 items. The true click distribution is `p(i | u) ∝ exp(θ_u·φ_i + b_i)`, with 8 taste dimensions and a long-tail popularity `b_i`. Users and items come with 16 noisy features derived from `θ` and `φ`. Each tower is an MLP from 16 to 64 to 32 units, and each item also gets a learned score offset. Training uses 100,000 sampled clicks, 6 epochs and batches of 256, three ways: in-batch negatives, in-batch with `−log Q`, and a full softmax over every warm item. 200 items are held out of training entirely, as new items. The core of the in-batch loss:

```python
logits = q @ it(X[items]).T + bias[items]            # B x B: row = user, column = batch item
if mode == "in-batch + logQ":
    logits = logits - LOGQ[items][None, :]            # s(u, i) - log Q(i), column by column
same = items[None, :] == items[:, None]               # mask copies of the positive (accidental hits)
logits = logits.masked_fill(same & ~torch.eye(len(idx), dtype=torch.bool), -torch.inf)
loss = nn.functional.cross_entropy(logits, torch.arange(len(idx)))   # positive on the diagonal
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-25, PyTorch 2.15.0. Two runs gave identical output ✅[^16]:

```text
train pairs 100,000; top 10% items = 0.58 of training clicks; most frequent item 0.0585, median warm item 0.00023
head share of test clicks 0.58
oracle (true logits)     recall@10 0.363 recall@100 0.688 | head share of top-10 lists 0.88 | most frequent item's mean rank   56.8
in-batch, no correction  recall@10 0.183 recall@100 0.474 | head share of top-10 lists 0.20 | most frequent item's mean rank  989.6
in-batch + logQ          recall@10 0.348 recall@100 0.668 | head share of top-10 lists 0.88 | most frequent item's mean rank   96.1
full softmax             recall@10 0.346 recall@100 0.670 | head share of top-10 lists 0.87 | most frequent item's mean rank  100.6
corr(learned item offset, log frequency): no correction -0.24, logQ +0.73
== cold start: rank each held-out new item among the 200 new items (never seen in training) ==
test clicks on new items 2467; random order recall@10 = 10/200 = 0.050
content two-tower (logQ model, no item offset): recall@10 0.448
oracle taste only (theta . phi, popularity unknown): recall@10 0.553
oracle with popularity (true logits): recall@10 0.716
```

<details><summary>Full script (prints the output above)</summary>

```python
# Two-tower retrieval trained with in-batch negatives, with and without the logQ correction, against a
# full-softmax reference; then cold-start items scored from content features alone (PyTorch, CPU).
import numpy as np, torch
from torch import nn

rng = np.random.default_rng(0)
U, I, D, F = 2000, 2000, 8, 16
theta, phi = rng.normal(0, 0.8, (U, D)), rng.normal(0, 0.8, (I, D))
b = 0.8 * np.log(1.0 / np.arange(1, I + 1)); b = rng.permutation(b - b.mean())  # long-tail popularity
zu = theta @ rng.normal(0, 1, (D, F)) + rng.normal(0, 0.3, (U, F))          # user features (noisy view of taste)
xi = phi @ rng.normal(0, 1, (D, F)) + rng.normal(0, 0.3, (I, F))            # item content features
logit_true = theta @ phi.T + b                                              # true p(i | u) = softmax over items
NEW = rng.choice(I, 200, replace=False)                                     # cold-start items: never in training
warm = np.setdiff1d(np.arange(I), NEW)

def sample_pairs(n, seed):
    r = np.random.default_rng(seed)
    u = r.integers(0, U, n)
    g = logit_true[u] + r.gumbel(size=(n, I))                               # Gumbel-max = one softmax draw
    return u, g.argmax(1)
u_all, i_all = sample_pairs(120_000, 1)
keep = ~np.isin(i_all, NEW)
u_tr, i_tr = u_all[keep][:100_000], i_all[keep][:100_000]
u_te, i_te = sample_pairs(20_000, 2)
freq = np.bincount(i_tr, minlength=I) / len(i_tr)                           # Q(i): chance item i is in a batch slot
head = np.argsort(-freq)[:I // 10]                                          # the 10 % most frequent items
print(f"train pairs {len(i_tr):,}; top 10% items = {freq[head].sum():.2f} of training clicks; "
      f"most frequent item {freq.max():.4f}, median warm item {np.median(freq[warm]):.5f}")

class Tower(nn.Module):
    def __init__(self):
        super().__init__()
        self.net = nn.Sequential(nn.Linear(F, 64), nn.ReLU(), nn.Linear(64, 32))
    def forward(self, x):
        return self.net(x)
Z, X = torch.tensor(zu, dtype=torch.float32), torch.tensor(xi, dtype=torch.float32)
LOGQ = torch.tensor(np.log(np.maximum(freq, 1e-12)), dtype=torch.float32)

def train(mode, epochs=6, batch=256):
    torch.manual_seed(0)
    qt, it = Tower(), Tower()
    bias = nn.Parameter(torch.zeros(I))                                     # per-item score offset (warm items)
    opt = torch.optim.Adam(list(qt.parameters()) + list(it.parameters()) + [bias], lr=3e-3)
    ut, itr = torch.tensor(u_tr), torch.tensor(i_tr)
    g = torch.Generator().manual_seed(0)
    for _ in range(epochs):
        for idx in torch.randperm(len(ut), generator=g).split(batch):
            q, items = qt(Z[ut[idx]]), itr[idx]
            if mode == "full softmax":                                      # every warm item is a negative
                logits = q @ it(X).T + bias
                logits[:, torch.tensor(NEW)] = -torch.inf
                target = items
            else:                                                           # the batch's own items are the negatives
                logits = q @ it(X[items]).T + bias[items]
                if mode == "in-batch + logQ":
                    logits = logits - LOGQ[items][None, :]                  # s(u, i) - log Q(i), column by column
                same = items[None, :] == items[:, None]
                logits = logits.masked_fill(same & ~torch.eye(len(idx), dtype=torch.bool), -torch.inf)
                target = torch.arange(len(idx))
            loss = nn.functional.cross_entropy(logits, target)
            opt.zero_grad(); loss.backward(); opt.step()
    with torch.no_grad():
        return (qt(Z) @ it(X).T).numpy(), bias.detach().numpy()

def report(name, S):
    s = S[u_te].copy(); s[:, NEW] = -np.inf                                 # retrieve from the warm corpus
    test = ~np.isin(i_te, NEW)
    rank = 1 + (s[test] > s[test, i_te[test]][:, None]).sum(1)
    top10 = np.argsort(-s[:2000], 1)[:, :10]
    print(f"{name:<24} recall@10 {np.mean(rank <= 10):.3f} recall@100 {np.mean(rank <= 100):.3f} | "
          f"head share of top-10 lists {np.isin(top10, head).mean():.2f} | "
          f"most frequent item's mean rank {np.mean(rank_of(s, head[0])):6.1f}")
def rank_of(s, item):
    return 1 + (s > s[:, [item]]).sum(1)

print(f"head share of test clicks {np.isin(i_te[~np.isin(i_te, NEW)], head).mean():.2f}")
report("oracle (true logits)", logit_true)
models = {}
for mode in ("in-batch, no correction", "in-batch + logQ", "full softmax"):
    dot, bias = train(mode)
    models[mode] = (dot, bias)
    report(mode, dot + bias)
corr = np.corrcoef(models["in-batch, no correction"][1][warm], np.log(freq[warm]))[0, 1]
corr_q = np.corrcoef(models["in-batch + logQ"][1][warm], np.log(freq[warm]))[0, 1]
print(f"corr(learned item offset, log frequency): no correction {corr:+.2f}, logQ {corr_q:+.2f}")

print("== cold start: rank each held-out new item among the 200 new items (never seen in training) ==")
test_new = np.isin(i_te, NEW)
def new_recall(S, k=10):
    s = S[u_te[test_new]][:, NEW]
    r = 1 + (s > S[u_te[test_new], i_te[test_new]][:, None]).sum(1)
    return np.mean(r <= k)
print(f"test clicks on new items {test_new.sum()}; random order recall@10 = 10/200 = {10 / 200:.3f}")
print(f"content two-tower (logQ model, no item offset): recall@10 {new_recall(models['in-batch + logQ'][0]):.3f}")
print(f"oracle taste only (theta . phi, popularity unknown): recall@10 {new_recall(theta @ phi.T):.3f}")
print(f"oracle with popularity (true logits): recall@10 {new_recall(logit_true):.3f}")
```

</details>

Reading it:
- **Popularity bias of in-batch negatives:** without the correction, recall@10 is 0.183 against 0.363 for the true model. The learned item offsets correlate negatively with log frequency (−0.24): the model has learned "popular means negative". With `−log Q`, recall@10 is 0.348, close to the full softmax (0.346), and the offsets track popularity (+0.73).
- **The retrieval ceiling:** recall@100 of the corrected model is 0.668. A ranker that re-orders those 100 candidates can find at most 66.8 % of the clicked items in this run.
- **Cold start:** scored from content features alone (no item offset, no interactions), the corrected model reaches recall@10 0.448 among the 200 new items in this run. Random order gets 0.050, and an oracle that knows the true taste but not the popularity gets 0.553.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| In-batch negatives, no correction | Popular items ranked far down; recall halved in the lab | Negatives follow popularity, so popular items are over-penalized ✅[^10]; lab 0.183 vs 0.348 ✅[^16] |
| Same item twice in a batch | Counted as a negative for its own positive | Mask duplicates: in Khrylchenko et al.'s refined correction the positive is not sampled, and negatives come from the catalog without it ✅[^10]; lab masks them ✅[^16] |
| Dot product with unnormalized embeddings | Frequent items, with large norms, dominate | Norm enters the score ✅[^3] |
| Rare items initialized with a large norm | Recommended over more relevant items | They get few updates; use careful initialization and regularization ✅[^3] |
| Ranking with each generator's own score | Scores from different generators might not be comparable | Use one scoring model over the pooled candidates ✅[^5] |
| Item listed lower on the screen | Less likely to be clicked than items higher up | Positional bias; score as if in the top position ✅[^5] |
| Brand-new item, ID-based model | No embedding, no score (Spark: NaN) | Cold start ✅[^12] ✅[^17] |
| Softmax/two-tower model with no negatives | Folding: spurious cross-group recommendations | Negatives push groups apart ✅[^8] |
| Always the closest items to the query | Monotonous lists (only owl videos) | Fixes: several candidate generators or rankers, re-ranking by genre or other metadata ✅[^6] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| MF as candidate generator | Easy to scale, cheap to query, less prone to folding ✅[^8] | Hard to add features; does not easily handle new IDs ✅[^8] |
| Two-tower / softmax DNN | Uses query and item features; handles new queries ✅[^8]; content tower scores new items (lab 0.448 vs 0.050 random) ✅[^16] | Query embedding computed per request; harder to train and scale; prone to folding ✅[^8] |
| In-batch negatives | Free negatives, harder than uniform ones ✅[^10] | Popularity bias without logQ ✅[^10] |
| Full softmax | Exact gradient | Infeasible for very large catalogs ✅[^10] |
| Dot-product scoring | Fast nearest-neighbour retrieval ✅[^4] ✅[^11] | Norm-driven popularity bias ✅[^3] |

## Takeaways
- If you train a two-tower model with in-batch or popularity-based negatives, subtract `log Q(item)` from the logits, and check where the most popular items land in the ranking. [rule-candidate]
- Judge the retrieval stage by recall@K at the size the ranker receives (recall@100 or more), not by recall@10. The ranker cannot recover what retrieval dropped.
- Put item features in the item tower whenever new items arrive faster than you retrain. ID-only models cannot score them.

## Verification status
- Verified: 76 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [Recommendation systems overview (Recommendation Systems course)](https://developers.google.com/machine-learning/recommendation/overview/types?hl=en) — Google for Developers, living. Backs: candidate generation, scoring and re-ranking; billions to hundreds or thousands; about 10 items shown; several generators; re-ranking for freshness, diversity, fairness. [^1]
- [Deep Neural Networks for YouTube Recommendations](https://research.google/pubs/pub45530/) — Covington, Adams, Sargin, RecSys 2016, the ACM (Association for Computing Machinery) Conference on Recommender Systems (publication page with abstract). Backs: the two-stage split into candidate generation and ranking. [^2]
- [Candidate generation overview (Recommendation Systems course)](https://developers.google.com/machine-learning/recommendation/overview/candidate-generation?hl=en) — Google for Developers, living. Backs: content-based vs collaborative candidates, similarity measures, norm and popularity, the `α` variant, rare items with large initial norms. [^3]
- [Retrieval (Recommendation Systems course)](https://developers.google.com/machine-learning/recommendation/dnn/retrieval?hl=en) — Google for Developers, living. Backs: query embedding lookup vs computation, nearest-neighbour retrieval, precomputation, approximate nearest neighbours. [^4]
- [Scoring (Recommendation Systems course)](https://developers.google.com/machine-learning/recommendation/dnn/scoring?hl=en) — Google for Developers, living. Backs: candidate sources, one scoring model, incomparable generator scores, objective choice, positional bias. [^5]
- [Re-ranking (Recommendation Systems course)](https://developers.google.com/machine-learning/recommendation/dnn/re-ranking?hl=en) — Google for Developers, living. Backs: filters and score transforms, freshness (average user, feature-based models, item age), diversity, fairness. [^6]
- [Deep neural network models (Recommendation Systems course)](https://developers.google.com/machine-learning/recommendation/dnn/softmax?hl=en) — Google for Developers, living. Backs: softmax DNN, item embeddings as output weights, MF as a special case, the two-tower definition. [^7]
- [Softmax training (Recommendation Systems course)](https://developers.google.com/machine-learning/recommendation/dnn/training?hl=en) — Google for Developers, living. Backs: negative sampling, hard negatives, folding, the MF vs softmax DNN comparison. [^8]
- [Sampling-Bias-Corrected Neural Modeling for Large Corpus Item Recommendations](https://research.google/pubs/pub48840/) — Yi, Yang, Hong, Cheng, Heldt, Kumthekar, Zhao et al., RecSys 2019 (publication page with abstract). Backs: the item tower for content features, in-batch negatives, sampling bias under power-law popularity, streaming frequency estimation. [^9]
- [Correcting the LogQ Correction: Revisiting Sampled Softmax for Large-Scale Retrieval](https://arxiv.org/html/2507.09331v1) — Khrylchenko, Baikalov, Makeev, Matveev, Liamaev, RecSys 2025 (arXiv HTML). Backs: full and sampled softmax, popularity bias of in-batch negatives, the logQ formula and its importance-sampling derivation, the positive not being sampled, count-min sketch. [^10]
- [Neural Collaborative Filtering vs. Matrix Factorization Revisited](https://ar5iv.labs.arxiv.org/html/2005.09683) — Rendle, Krichene, Zhang, Anderson, 2020 (ar5iv HTML of arXiv:2005.09683). Backs: dot product enables maximum inner product search; MLP similarity costs `O(d²)`. [^11]
- [Collaborative filtering advantages & disadvantages (Recommendation Systems course)](https://developers.google.com/machine-learning/recommendation/collaborative/summary?hl=en) — Google for Developers, living. Backs: the cold-start problem for ID embeddings, projection in WALS, averaged embeddings for fresh items. [^12]
- [Content-based filtering advantages & disadvantages (Recommendation Systems course)](https://developers.google.com/machine-learning/recommendation/content-based/summary?hl=en) — Google for Developers, living. Backs: no data about other users needed, niche items, dependence on hand-engineered features. [^13]
- [How Algorithmic Confounding in Recommendation Systems Increases Homogeneity and Decreases Utility](https://ar5iv.labs.arxiv.org/html/1710.11214) — Chaney, Stewart, Engelhardt, 2018 (ar5iv HTML of arXiv:1710.11214). Backs: the feedback loop and confounding, homogenization without utility, explore/exploit connection. [^14]
- [Overview of Recommender Systems (Dive into Deep Learning, 21.1)](https://d2l.ai/chapter_recommender-systems/recsys-intro.html) — Zhang, Lipton, Li, Smola, living. Backs: the cold-start definition. [^15]
- `machine-learning/lab-setup.md` — the lab where the two-tower simulation (in-batch, logQ, full softmax, cold start) ran on 2026-11-25. [^16]
- [Collaborative Filtering (Spark 4.3.0 MLlib guide)](https://spark.apache.org/docs/latest/ml-collaborative-filtering.html) — Apache Spark, living (4.3.0 when read). Backs: NaN predictions for unknown users or items, used as a fallback signal. [^17]

## Related
- `machine-learning/recommender-systems/collaborative-filtering-and-matrix-factorization.md` — MF, the classic candidate generator, and the ALS half-step used for projection.
- `machine-learning/recommender-systems/implicit-feedback-and-ranking.md` — negatives, BPR and how to evaluate retrieval offline.
- `algorithms/vector-search-evaluation.md` — measuring approximate nearest-neighbour search, the serving side of two towers.
- `machine-learning/deep-learning/embeddings-and-self-supervised-learning.md` — InfoNCE, the same in-batch softmax outside recommendation.
- `machine-learning/recommender-systems/feedback-loops-and-popularity-bias.md` — what retraining on the pipeline's own logs does to exposure and utility.
- `machine-learning/ml-systems/data-drift-and-monitoring.md` — monitoring what the model is shown and serves over time.
- `machine-learning/reinforcement-learning/multi-armed-bandits.md` — exploration for new and uncertain items.
- `machine-learning/recommender-systems/learning-to-rank.md` — training the scoring model with ranking losses.
