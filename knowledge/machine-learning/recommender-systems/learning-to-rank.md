---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/recommender-systems
status: verified
applies-to: ["PyTorch 2.15.0", "scikit-learn 1.9.1", "LightGBM 4.7.0 (docs)", "XGBoost 3.4.2 (docs)"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, recommender-systems, search, learning-to-rank, ranknet, lambdarank, lambdamart, listnet, listmle, ndcg, query-groups, position-bias, click-models, inverse-propensity-scoring, unbiased-learning-to-rank]
---

# Learning to rank: pointwise, pairwise and listwise losses, LambdaMART and click bias

## Summary
**TL;DR:** Learning to rank (LTR) learns a function that scores each (query, document) pair; the system sorts by score and is judged by a ranking metric such as NDCG@k (normalized discounted cumulative gain over the top k), which cares mostly about the first few positions. The metric depends on the scores only through the sort, so it gives no usable gradient, and training uses a surrogate loss: pointwise (regress each grade), pairwise (RankNet: a logistic loss on every pair of documents with different grades in the same query) or listwise (ListNet: a cross-entropy between softmaxes of the labels and of the scores). LambdaRank keeps RankNet's pair gradient but multiplies it by how much NDCG would change if the two documents swapped places, so training effort goes to the top of the list; LambdaMART fits gradient-boosted trees to those gradients and is the default ranking objective of XGBoost. Rows come in query groups, and pairs never cross groups. Clicks are not relevance labels: users rarely look far down the list, and inverse propensity scoring (IPS) weights each click by one over the probability that its position was examined.
**Use this when:** you train a ranker for search results or recommendations; you choose between a pointwise, pairwise or listwise objective, or set `objective="lambdarank"` (LightGBM) or `rank:ndcg` (XGBoost) with query groups; a model's pairwise accuracy rises while NDCG@10 does not; or you train on click logs and the model learns to agree with the ranking that produced them.
**Not this doc:** the definitions of NDCG, MAP (mean average precision) and other ranking metrics → `machine-learning/evaluation/metrics-catalog.md`; BPR (Bayesian personalized ranking) and ranking losses for implicit-feedback recommenders, and the sampled-metrics trap → `machine-learning/recommender-systems/implicit-feedback-and-ranking.md`; where the ranker sits after candidate retrieval → `machine-learning/recommender-systems/retrieval-and-ranking-pipelines.md`; gradient boosting itself → `machine-learning/supervised-learning/tree-ensembles.md`; what retraining on a system's own logs does over many rounds → `machine-learning/recommender-systems/feedback-loops-and-popularity-bias.md`.

## Problem
A ranked list is not a set of independent predictions. Ranking metrics such as NDCG, MRR (mean reciprocal rank) and MAP are designed to emphasize the items ranked highest ✅[^1], so an error at position 1 costs far more than an error at position 33. A model fitted to minimize its errors everywhere can be the wrong model: in the lab, a linear scorer trained with the pairwise RankNet loss ordered the most document pairs correctly (pairwise accuracy 0.9155) and still had the lowest NDCG@10 of the four linear rankers (0.8473, against 0.8709 for LambdaRank) ✅[^12]. The obvious fix, optimizing NDCG directly, does not work with gradient methods: the metric depends on the scores only through the sorted order, so its derivatives with respect to the model parameters are zero or undefined ✅[^3]. Finally, labels are expensive, so many systems learn from clicks, and clicks are biased: users click documents at higher positions more often ✅[^6]. In the lab, a ranker trained naively on clicks gave a feature that only the old ranker used a weight 0.339 times its weight on the main relevance feature, and scored 0.8156 NDCG@10 against 0.8697 with inverse propensity weights ✅[^12].

## Mental model
**Analogy:** a hiring panel ranking 40 applicants for 10 interview slots. A pointwise panel gives each applicant an absolute grade and sorts. A pairwise panel goes through pairs ("is Ana better than Ben?") and counts every pair it gets wrong the same, whether it is about places 1 and 2 or 33 and 34. A LambdaRank panel asks, for each wrong pair, "how much would the shortlist get worse if these two traded places?", and spends its time on the pairs that decide who gets interviewed. Clicks are like learning from which applicants a busy recruiter phoned: she reads the pile from the top and stops early, so "not phoned" mostly means "not read", not "rejected".

**Artifact:** printed by the full script in the Worked example; lab run (`machine-learning/lab-setup.md`), 2026-11-25, PyTorch 2.15.0 ✅[^12]. One query with five documents shown in this order, grades 3, 2, 0, 1, 0 (higher is more relevant); swapping two documents changes NDCG by very different amounts, and the LambdaRank gradient follows that:

```text
swap ranks 1 and 5: NDCG 0.9926 -> 0.5357, |delta| recomputed 0.4569, formula 0.4569
swap ranks 3 and 4: NDCG 0.9926 -> 1.0000, |delta| recomputed 0.0074, formula 0.0074
…
RankNet    ranks 1-5 0.104 | 6-10 0.163 | 11-20 0.354 | 21-40 0.379
LambdaRank ranks 1-5 0.540 | 6-10 0.223 | 11-20 0.175 | 21-40 0.061
```

The first swap matters 62 times more than the second. Of all the gradient RankNet sends to documents, 10.4 % lands on the current top 5; LambdaRank sends 54.0 % there.

## How it works
### The setup: score and sort, in query groups
1. **Data:** as TF-Ranking (TensorFlow Ranking) sets the problem up, for each query, a list of candidate documents, each a (query, document) pair turned into a feature vector, with a relevance label: a human grade such as 0 ("not relevant") to 5, or 1/0 for clicked/not clicked ✅[^1].
2. **Model:** a scoring function `g(x) → ℝ` (one real-valued score per document) applied to each document; ranking = sorting by score. Learning a permutation directly is hard because the space of permutations is exponentially large, so most LTR methods use this score-and-sort approach instead ✅[^1] ✅[^2]. The function can be linear, a neural network or gradient-boosted trees ✅[^1].
3. **Query groups:** pairs are formed only between documents of the same query group ✅[^7]. XGBoost needs a query id array `qid`, with the rows sorted by query id ✅[^7]; LightGBM takes group sizes, so `group = [27, 18, 67]` on a 112-row dataset means rows 1–27, 28–45 and 46–112 are three queries, and the data must be ordered by query ✅[^8]. Split cross-validation folds by query as well: XGBoost's example passes `groups=qid` to `StratifiedGroupKFold` ✅[^7] (splitters: `machine-learning/evaluation/cross-validation-and-hyperparameter-search.md`).
4. **Metric:** NDCG@k, defined in `machine-learning/evaluation/metrics-catalog.md`. Here it uses the gain `2^y − 1` for grade `y` and the discount `1/log₂(1 + rank)`, as TF-Ranking defines DCG (discounted cumulative gain) ✅[^1]; LightGBM's default `label_gain` is the same `0, 1, 3, 7, 15, …` ✅[^8]. scikit-learn's `ndcg_score` sums the true scores themselves ✅[^10], so pass `2**y − 1` to get this gain; the lab check printed `0.7988` from both ✅[^12].

### Three families of surrogate loss
Most LTR methods differ in the differentiable surrogate loss they put in place of the metric, and fall into three classes ✅[^1]:
- **Pointwise:** treat each document alone as regression or classification of its label ✅[^1] ✅[^2]. Example: squared error `(s − y)²`; a document of grade 3 scored 2.5 costs 0.25 wherever it sits in the list.
- **Pairwise:** learn which document of a pair should come first ✅[^2]. The RankNet loss is the pairwise logistic loss ✅[^7]: for each pair in a query with `y_i > y_j`, `log(1 + exp(−(s_i − s_j)))` ✅[^1]. Here `s_i` and `s_j` are the two scores. Example: `s_i = 1.2`, `s_j = 0.4` gives `log(1 + e^(−0.8)) = 0.371`; the same pair in the wrong order (`s_i = 0.4`, `s_j = 1.2`) costs `log(1 + e^(0.8)) = 1.171`. Because `log(1 + e^(−x)) = −log sigmoid(x)`, with `sigmoid(x) = 1/(1 + e^(−x))`, this is the cross-entropy of predicting "i above j" with probability `sigmoid(s_i − s_j)` (`sigmoid(0.8) = 0.690` and `−log 0.690 = 0.371` in the example): RankNet optimizes a probabilistic loss ✅[^5], of the same form as one term of BPR (`machine-learning/recommender-systems/implicit-feedback-and-ranking.md`).
- **Listwise:** define the loss over the whole list ✅[^1]. ListNet turns the labels and the scores into "top-one" distributions with a softmax, `φ(y_i) = e^(y_i) / Σ_j e^(y_j)` and `ρ(s_i) = e^(s_i) / Σ_j e^(s_j)`, and minimizes the cross-entropy `−Σ_i φ(y_i) log ρ(s_i)` ✅[^5]. ListMLE (MLE: maximum likelihood estimation) maximizes the likelihood of the correct order under the Plackett–Luce model ✅[^5] (a list is drawn by picking the first document with softmax probabilities of the scores, then the next from those left, and so on). Both losses are only loosely related to ranking metrics ✅[^5].

Pairwise and listwise methods are more closely aligned with the ranking task than pointwise ones ✅[^1]; in TF-Ranking's two production experiments (email search and document recommendation, trained on clicks) a listwise loss beat a pairwise loss, which beat a pointwise loss ✅[^1].

### LambdaRank: put the metric into the gradient
LambdaRank never writes down a loss: it works with an implicit cost ✅[^3], and it applies to any differentiable function class ✅[^3]. Bruch describes LambdaMART, which uses the same gradients, as forgoing the loss and formulating the gradients heuristically ✅[^5]. For a pair with `y_i > y_j` ✅[^6]:

```text
λ_ij = −σ / (1 + e^(σ·(s_i − s_j))) · |ΔZ_ij|        λ_i = Σ_j λ_ij − Σ_j λ_ji
```

- `σ` is a constant (2 by default in Hu et al.'s description) ✅[^6]; the lab uses 1 ✅[^12].
- `|ΔZ_ij|` is the change in NDCG if documents `i` and `j` swapped places in the current ranking ✅[^6] ✅[^5]. Only their two terms of DCG change, so `|ΔNDCG_ij| = |G_i − G_j| · |D_i − D_j| / IDCG`, with `G = 2^y − 1` the gains, `D = 1/log₂(1 + rank)` the discounts at their current ranks and IDCG the DCG of the ideal order. Artifact query: swapping rank 1 (gain 7) with rank 5 (gain 0) gives `7 × (1 − 0.3869) / 9.3928 = 0.4569`; swapping ranks 3 and 4 gives `1 × (0.5 − 0.4307) / 9.3928 = 0.0074`. The script recomputed both from the swapped lists ✅[^12].
- `λ_i` sums over every pair document `i` belongs to: pairs where it should be higher push it up, pairs where it should be lower push it down ✅[^6]. Worked numbers with `σ = 1` and the RankNet pair above: the RankNet gradient magnitude is `1 / (1 + e^(0.8)) = 0.310`; LambdaRank scales it to `0.310 × 0.4569 = 0.142` if the pair sits at ranks 1 and 5, and to `0.002` at ranks 3 and 4.
- The same gradient comes from the loss `log(1 + e^(−σ(s_i − s_j))) · |ΔZ_ij|` with `|ΔZ_ij|` held constant ✅[^6], which is how the lab trains it in PyTorch. With `|ΔZ_ij| = 1` it is the RankNet loss; XGBoost's `rank:pairwise` is exactly that unscaled version, and its docs note that whether scaling by a metric helps is still debated ✅[^7].

### LambdaMART: boosted trees fitted to the lambdas
1. LambdaMART is the boosted-tree version of LambdaRank, which is based on RankNet; an ensemble of LambdaMART rankers won Track 1 of the 2010 Yahoo! Learning to Rank Challenge ✅[^4]. MART stands for multiple additive regression trees, an ensemble of boosted regression trees ✅[^11]: gradient boosting (`machine-learning/supervised-learning/tree-ensembles.md`).
2. LambdaMART combines gradient boosting with the lambda gradients ✅[^6]: each round computes `λ_i` for every document from the current scores and fits the next regression tree to them, where squared-error boosting would fit the residuals. Most gradient-boosted tree learners take second-order (Newton) steps ✅[^5]; the lab sets each leaf to the sum of the lambdas over the sum of the second derivatives in that leaf ✅[^12].
3. In the libraries: XGBoost's default ranking objective `rank:ndcg` is based on LambdaMART; `rank:map` is for 0/1 labels ✅[^7]. LightGBM's `lambdarank` objective takes integer labels, larger meaning more relevant ✅[^8]. Its `lambdarank_truncation_level` (default 30) sets how many top results training focuses on, and the docs suggest slightly more than the `k` of the target NDCG@k, for example `k + 3`. `lambdarank_norm` (default true) normalizes the lambdas across queries ✅[^8]. LightGBM's `rank_xendcg` objective is faster than `lambdarank` with similar performance ✅[^8]. Its full name is the XE_NDCG_MART objective ✅[^8]: XE_NDCG (cross-entropy NDCG) is a ListNet-like cross-entropy that Bruch proves is a convex bound on NDCG, and Bruch implemented it in LightGBM ✅[^5].
4. Pair construction: XGBoost samples `lambdarank_num_pair_per_sample` pairs per document (`mean`), or builds pairs for the top `k` documents (`topk`, the default since 2.0). Only "effective" pairs with a non-zero gradient help, so with little data the docs suggest NDCG or `rank:pairwise` with the `mean` strategy ✅[^7]. With MRR as the target metric, a pair has a non-zero lambda only when a non-relevant document sits above the top relevant one; that gives so few effective pairs that XGBoost does not implement it ✅[^7].

### Clicks: position bias, click models and inverse propensity scoring
1. **Bias:** click data are cheap and current but noisy, and users click higher positions more often ✅[^6] ✅[^7]. Click models describe the behaviour: the position-based model (a click depends only on the position and the relevance), the cascade model (the user's browsing of the results as a sequence of actions), the user browsing model and the dynamic Bayesian network model ✅[^6].
2. **Examination model:** `P(click) = P(examined | rank) · P(click | relevant, examined)`, where examination depends only on the rank, so it is a vector `p_r`, one probability per rank `r` ✅[^9]. With noise-free clicks, a user clicks if and only if the result is examined and relevant ✅[^9]. Joachims et al.'s simulations use `p_r = (1/r)^η`, with `η` the severity of the bias (default 1) ✅[^9]. Example with `η = 1`: a relevant document shown at rank 4 is clicked with probability `1/4 = 0.25`.
3. **IPS (inverse propensity scoring):** weight each click by `1/p_r` of the rank it was shown at. Then `(1/n) Σ_clicks rank(y | S) / p_rank(y)`, summed over the clicks of `n` logged queries, with `p_rank(y)` the propensity of the rank where `y` was shown, is an unbiased estimate of the average sum of the ranks of relevant documents under a new ranking `S`, provided `p_r > 0` at every rank ✅[^9]. An unclicked document needs no negative label: the estimator only uses clicked results ✅[^9]. Example: a click at rank 4 counts 4 times; a click at rank 1 counts once.
4. **Training:** Propensity SVM-Rank (support vector machine) turns each click into its own training example, weights it by `1/q` with `q` its propensity, and asks the clicked result to score above every other candidate of that query, with a hinge loss ✅[^9]. TF-Ranking supports such inverse propensity weights in its losses and metrics ✅[^1], and its authors report that these corrections work well with pairwise or listwise losses but not with pointwise ones ✅[^1]; Hu et al., by contrast, describe the earlier IPW (inverse propensity weighting) objectives as unbiased estimates of a pointwise risk ✅[^6]. Unbiased LambdaMART instead divides each `λ_ij` by estimated position biases for the clicked and the unclicked position, which it learns jointly with the ranker ✅[^6]; XGBoost exposes it as `lambdarank_unbiased`, an experimental feature added in 2.0.0 ✅[^7].
5. **Estimating `p_r`:** in a randomized intervention (7 days in Joachims et al.'s live test), swap the top result with the result at a uniformly random rank `j` before showing the list. The click-through rate (CTR) of the moved document at rank `j`, divided by its CTR at rank 1, estimates `p_j / p_1`. Propensities are only needed up to a constant factor ✅[^9].

## Worked example
400 training and 200 test queries, 40 documents each, 6 standard normal features per document. A hidden utility `u = x0 + 0.6·x1 + 0.8·max(x2, 0)·x0 − 0.3·x1² + noise` sets the grades within each query: the top 2 documents get grade 4, the next 3 grade 3, then 5 of grade 2, 10 of grade 1 and 20 of grade 0. The interaction and square terms mean a linear scorer cannot fit `u` exactly and must choose which pairs to get wrong. Four linear scorers are trained (300 full-batch Adam steps each), then pointwise and LambdaMART-style boosted trees (100 trees of 16 leaves, learning rate 0.1). Part (4) generates 3,000 more queries as a click log: the logging ranker sorts by `x0 + x3`, where `x3` has nothing to do with relevance, the top 5 documents of each query count as relevant, and a relevant document at rank `r` is clicked with probability `1/r`. The core of the pairwise losses:

```python
w = (y[:, :, None] > y[:, None, :]).float()               # pairs within each query, i better than j
if lam:
    w = w * delta_ndcg(s.detach(), y)                     # LambdaRank: |delta NDCG| at the current ranking
loss = (w * softplus(-(s[:, :, None] - s[:, None, :]))).sum() / w.sum()   # log(1 + e^-(s_i - s_j))
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-25, PyTorch 2.15.0, scikit-learn 1.9.1, two runs identical ✅[^12]:

```text
== (1) one query, documents in ranked order with grades [3, 2, 0, 1, 0] ==
swap ranks 1 and 5: NDCG 0.9926 -> 0.5357, |delta| recomputed 0.4569, formula 0.4569
swap ranks 3 and 4: NDCG 0.9926 -> 1.0000, |delta| recomputed 0.0074, formula 0.0074
== (2) 400 training and 200 test queries, 40 documents each ==
check: sklearn ndcg_score(2**y - 1, s, k=10) = 0.7988, ours = 0.7988  (score = feature 0 alone)
linear, pointwise   test NDCG@10 0.8606  pairwise accuracy 0.9137
linear, RankNet     test NDCG@10 0.8473  pairwise accuracy 0.9155
linear, LambdaRank  test NDCG@10 0.8709  pairwise accuracy 0.8990
linear, ListNet     test NDCG@10 0.8712  pairwise accuracy 0.9003
trees,  pointwise   test NDCG@10 0.9100  pairwise accuracy 0.9381
trees,  LambdaMART  test NDCG@10 0.9096  pairwise accuracy 0.9298
== (3) share of total |gradient| by current rank, at the RankNet model's training scores ==
RankNet    ranks 1-5 0.104 | 6-10 0.163 | 11-20 0.354 | 21-40 0.379
LambdaRank ranks 1-5 0.540 | 6-10 0.223 | 11-20 0.175 | 21-40 0.061
== (4) clicks: logger ranks by x0 + x3 (x3 is noise), user examines rank r with p = 1/r ==
query instances 3000, relevant docs 15000, clicks 3895
logger x0+x3: mean sum of relevant ranks (lower is better): true 49.04 | naive clicks 4.94 | IPS 49.50
x0+0.6*x1  : mean sum of relevant ranks (lower is better): true 26.12 | naive clicks 5.22 | IPS 25.57
naive (weight 1)                 test NDCG@10 0.8156  weight on x3 / x0 +0.339
IPS (weight 1/p = r)             test NDCG@10 0.8697  weight on x3 / x0 -0.017
skyline (all relevant, no bias)  test NDCG@10 0.8692  weight on x3 / x0 +0.000
```

<details><summary>Full script (prints the output above)</summary>

```python
# Learning to rank on synthetic queries with graded relevance (PyTorch, scikit-learn, CPU):
# (1) |delta NDCG| of a swap by hand; (2) pointwise vs RankNet vs LambdaRank vs ListNet linear scorers and
# pointwise vs LambdaMART-style boosted trees; (3) where the lambdas go; (4) position-biased clicks and
# inverse propensity scoring (IPS).
import numpy as np, torch
from torch.nn.functional import softplus
from sklearn.tree import DecisionTreeRegressor
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.metrics import ndcg_score
torch.manual_seed(0); rng = np.random.default_rng(0)
N, D = 40, 6                                    # documents per query, features per document
disc = 1 / torch.log2(torch.arange(N) + 2.0)    # discount 1/log2(1 + rank), rank = 1..N

def make_queries(q):                            # features x; hidden utility u; grades 0-4 per query
    X = rng.normal(size=(q, N, D))
    u = (X[..., 0] + 0.6 * X[..., 1] + 0.8 * np.maximum(X[..., 2], 0) * X[..., 0]
         - 0.3 * X[..., 1] ** 2 + 0.5 * rng.normal(size=(q, N)))
    r = u.argsort(1).argsort(1)                 # 0 = lowest utility in its query
    y = np.select([r >= N - 2, r >= N - 5, r >= N - 10, r >= N - 20], [4, 3, 2, 1], 0)
    return torch.tensor(X, dtype=torch.float32), torch.tensor(y, dtype=torch.float32)

def ndcg(s, y, k=10):                           # gain 2^y - 1, mean over queries
    g = 2 ** y - 1
    dcg = (g.gather(1, s.argsort(1, descending=True))[:, :k] * disc[:k]).sum(1)
    return (dcg / (g.sort(1, descending=True).values[:, :k] * disc[:k]).sum(1)).mean().item()

def pair_acc(s, y):                             # share of pairs with different grades ordered right
    m = y[:, :, None] > y[:, None, :]
    return ((s[:, :, None] > s[:, None, :]) & m).sum().item() / m.sum().item()

def delta_ndcg(s, y):                           # |NDCG change| if docs i and j swapped positions
    g, d = 2 ** y - 1, disc[s.argsort(1, descending=True).argsort(1)]
    idcg = (g.sort(1, descending=True).values * disc[:s.shape[1]]).sum(1)
    return (g[:, :, None] - g[:, None, :]).abs() * (d[:, :, None] - d[:, None, :]).abs() / idcg[:, None, None]

def pair_loss(s, y, lam):                       # RankNet (lam=False) or LambdaRank-weighted logistic loss
    w = (y[:, :, None] > y[:, None, :]).float()
    if lam:
        w = w * delta_ndcg(s.detach(), y)       # weights from the current ranking, held constant
    return (w * softplus(-(s[:, :, None] - s[:, None, :]))).sum() / w.sum()

print("== (1) one query, documents in ranked order with grades [3, 2, 0, 1, 0] ==")
y1, s1 = torch.tensor([[3., 2, 0, 1, 0]]), torch.tensor([[5., 4, 3, 2, 1]])
base = ndcg(s1, y1, k=5)
for i, j in [(0, 4), (2, 3)]:
    s2 = s1.clone(); s2[0, [i, j]] = s2[0, [j, i]]
    print(f"swap ranks {i+1} and {j+1}: NDCG {base:.4f} -> {ndcg(s2, y1, k=5):.4f}, "
          f"|delta| recomputed {abs(ndcg(s2, y1, k=5) - base):.4f}, formula {delta_ndcg(s1, y1)[0, i, j].item():.4f}")

print("== (2) 400 training and 200 test queries, 40 documents each ==")
Xtr, ytr = make_queries(400); Xte, yte = make_queries(200)
def train_linear(kind, X, y, steps=300):
    w = torch.zeros(D, requires_grad=True); opt = torch.optim.Adam([w], lr=0.05)
    for _ in range(steps):
        s = X @ w
        loss = {"pointwise": lambda: ((s - y) ** 2).mean(),
                "RankNet": lambda: pair_loss(s, y, False), "LambdaRank": lambda: pair_loss(s, y, True),
                "ListNet": lambda: -(torch.softmax(y, 1) * torch.log_softmax(s, 1)).sum(1).mean()}[kind]()
        opt.zero_grad(); loss.backward(); opt.step()
    return w.detach()
Xf, Xtef = Xtr.reshape(-1, D).numpy(), Xte.reshape(-1, D).numpy()
print(f"check: sklearn ndcg_score(2**y - 1, s, k=10) = {ndcg_score((2 ** yte - 1).numpy(), Xte[..., 0].numpy(), k=10):.4f}"
      f", ours = {ndcg(Xte[..., 0], yte):.4f}  (score = feature 0 alone)")
models = {}
for kind in ["pointwise", "RankNet", "LambdaRank", "ListNet"]:
    models[kind] = train_linear(kind, Xtr, ytr)
    s = Xte @ models[kind]
    print(f"linear, {kind:<11} test NDCG@10 {ndcg(s, yte):.4f}  pairwise accuracy {pair_acc(s, yte):.4f}")
gbm = GradientBoostingRegressor(n_estimators=100, max_leaf_nodes=16, random_state=0).fit(Xf, ytr.reshape(-1).numpy())
s = torch.tensor(gbm.predict(Xtef), dtype=torch.float32).reshape(200, N)
print(f"trees,  pointwise   test NDCG@10 {ndcg(s, yte):.4f}  pairwise accuracy {pair_acc(s, yte):.4f}")
F, Fte = np.zeros(len(Xf)), np.zeros(len(Xtef))  # LambdaMART-style: each tree fits the lambdas
for m in range(100):
    s = torch.tensor(F, dtype=torch.float32).reshape(400, N)
    rho = torch.sigmoid(-(s[:, :, None] - s[:, None, :]))           # sigma = 1
    w = (ytr[:, :, None] > ytr[:, None, :]).float() * delta_ndcg(s, ytr)
    lam = ((w * rho).sum(2) - (w * rho).sum(1)).reshape(-1).numpy()  # -dLoss/ds per document
    hes = ((w * rho * (1 - rho)).sum(2) + (w * rho * (1 - rho)).sum(1)).reshape(-1).numpy()
    tree = DecisionTreeRegressor(max_leaf_nodes=16, random_state=0).fit(Xf, lam)
    leaf, leafte = tree.apply(Xf), tree.apply(Xtef)
    gamma = np.bincount(leaf, lam, leaf.max() + 1) / (np.bincount(leaf, hes, leaf.max() + 1) + 1e-9)  # Newton step
    F += 0.1 * gamma[leaf]; Fte += 0.1 * gamma[leafte]
s = torch.tensor(Fte, dtype=torch.float32).reshape(200, N)
print(f"trees,  LambdaMART  test NDCG@10 {ndcg(s, yte):.4f}  pairwise accuracy {pair_acc(s, yte):.4f}")

print("== (3) share of total |gradient| by current rank, at the RankNet model's training scores ==")
s = (Xtr @ models["RankNet"]).requires_grad_(True)
rank = s.detach().argsort(1, descending=True).argsort(1)
for lam in (False, True):
    g, = torch.autograd.grad(pair_loss(s, ytr, lam), s)
    tot = g.abs().sum()
    sh = [(g.abs()[(rank >= a) & (rank < b)].sum() / tot).item() for a, b in [(0, 5), (5, 10), (10, 20), (20, 40)]]
    print(f"{'LambdaRank' if lam else 'RankNet   '} ranks 1-5 {sh[0]:.3f} | 6-10 {sh[1]:.3f} | 11-20 {sh[2]:.3f} | 21-40 {sh[3]:.3f}")

print("== (4) clicks: logger ranks by x0 + x3 (x3 is noise), user examines rank r with p = 1/r ==")
Xc, yc = make_queries(3000)
rel = (yc >= 3).float()                                  # binary relevance: the top 5 of each query
logger = Xc[..., 0] + Xc[..., 3]
r_log = logger.argsort(1, descending=True).argsort(1) + 1  # displayed rank, 1..40
click = (torch.rand(rel.shape) < 1 / r_log) & (rel > 0)    # examined and relevant
q_idx, d_idx = click.nonzero(as_tuple=True)
print(f"query instances 3000, relevant docs {int(rel.sum())}, clicks {len(q_idx)}")
def risk(scores):                                         # true: mean sum of ranks of relevant docs
    rk = (scores.argsort(1, descending=True).argsort(1) + 1).float()
    naive = rk[q_idx, d_idx].sum() / 3000
    ips = (rk[q_idx, d_idx] * r_log[q_idx, d_idx]).sum() / 3000   # each click weighted by 1/p = r
    return (rk * rel).sum(1).mean().item(), naive.item(), ips.item()
for name, sc in [("logger x0+x3", logger), ("x0+0.6*x1  ", Xc[..., 0] + 0.6 * Xc[..., 1])]:
    print("{}: mean sum of relevant ranks (lower is better): true {:.2f} | naive clicks {:.2f} | IPS {:.2f}".format(name, *risk(sc)))
def train_clicks(weight, qi, di, steps=300):            # propensity-weighted SVM-Rank objective
    w = torch.zeros(D, requires_grad=True); opt = torch.optim.Adam([w], lr=0.05)
    for _ in range(steps):
        s = Xc[qi] @ w                                     # all 40 candidates of each clicked query
        hinge = torch.relu(1 - (s[torch.arange(len(qi)), di][:, None] - s)).sum(1) - 1  # minus self-pair
        loss = (weight * hinge).mean() + 0.01 * (w ** 2).sum()
        opt.zero_grad(); loss.backward(); opt.step()
    return w.detach()
qa, da = rel.nonzero(as_tuple=True)
for name, w in [("naive (weight 1)", train_clicks(torch.ones(len(q_idx)), q_idx, d_idx)),
                ("IPS (weight 1/p = r)", train_clicks(r_log[q_idx, d_idx].float(), q_idx, d_idx)),
                ("skyline (all relevant, no bias)", train_clicks(torch.ones(len(qa)), qa, da))]:
    print(f"{name:<32} test NDCG@10 {ndcg(Xte @ w, yte):.4f}  weight on x3 / x0 {w[3] / w[0]:+.3f}")
```

</details>

Reading it:
- **(1) Swap costs:** the two swaps recompute to exactly the formula's values, `0.4569` and `0.0074`. A swap near the top of the list moves NDCG 62 times more than a swap of the same "size" further down.
- **(2) Pairwise accuracy is not NDCG:** among the linear scorers, RankNet orders the most pairs correctly (0.9155) but has the lowest NDCG@10 (0.8473). LambdaRank and ListNet give up 1.5 to 1.7 points of pairwise accuracy and gain 2.4 points of NDCG@10: the pairs they get wrong are low in the list, where NDCG barely looks. The pointwise regressor sits in between.
- **(2) Trees:** both tree models beat every linear scorer (0.91 against at most 0.87), trees can represent the interaction and square terms of the utility, a linear scorer cannot. Between them the loss made no difference here (0.9100 pointwise, 0.9096 LambdaMART-style): when the model is flexible enough to fit the utility, a good regression fit already ranks well. The choice of surrogate mattered when the model had to compromise. This is one synthetic dataset, a hand-written LambdaMART without truncation or normalization, and settings that were not tuned; on the Web30K and Yahoo! benchmark datasets, Bruch found statistically significant differences between boosted-tree rankers trained with different losses ✅[^5].
- **(3) Where the gradient goes:** at the same scores, RankNet spends 73 % of its gradient on ranks 11–40, while LambdaRank spends 76 % on ranks 1–10. The `|ΔNDCG|` weights behind that shift are the only difference between the two losses in (2).
- **(4) Click estimates:** the true average sum of the ranks of the 5 relevant documents (the best possible is `1 + 2 + 3 + 4 + 5 = 15`) is 49.04 for the logger and 26.12 for the other ranker. Raw clicks rank them the wrong way round (4.94 for the logger, 5.22 for the better ranker), because the logger's relevant documents got clicks precisely where the logger put them. The IPS estimates are 49.50 and 25.57, close to the truth.
- **(4) Training on clicks:** the naive model learns to agree with the logger. Its weight on the noise feature `x3` is 0.339 times its weight on `x0`, and its test NDCG@10 is 0.8156. With weights `1/p = r`, the IPS model puts almost no weight on `x3` (−0.017) and reaches 0.8697. That equals the skyline trained on all 15,000 true relevant documents without bias (0.8692), although IPS saw only 3,895 clicks.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Pairwise accuracy improves, NDCG@10 does not | RankNet 0.9155 pairwise, lowest NDCG@10 (0.8473) in the lab | Every pair counts the same in RankNet; lab ✅[^12] |
| Rows of one query split across workers | Fewer pairs per group and different normalizers such as IDCG; if every group is shuffled across workers, "disastrous" | Pairs and IDCG are computed per query group ✅[^7] |
| `qid` or group array not sorted by query | Wrong groups | XGBoost expects rows sorted by query id; LightGBM expects data ordered by query ✅[^7] ✅[^8] |
| scikit-learn utilities on a ranker | Its `ndcg_score` and AUC (area under the ROC, receiver operating characteristic, curve) scorers know nothing of query groups or the pairwise loss | scikit-learn has no learning-to-rank interface ✅[^7] |
| Gain convention differs between tools | `ndcg_score` uses the grade as gain; LightGBM defaults to `2^y − 1` | ✅[^10] ✅[^8]; lab check with `2**y − 1` ✅[^12] |
| Query with all labels equal | No pair, so no pairwise or lambda gradient | Pairs need `y_i > y_j` ✅[^1]; XGBoost skips same-label pairs ✅[^7] |
| Target metric MRR | Few effective pairs; XGBoost does not implement a LambdaMART-MRR objective | Non-zero lambda only when a non-relevant document is above the top relevant one ✅[^7] |
| Training on raw clicks | Model learns the old ranker's preferences (lab: weight +0.339 on a noise feature) | Position bias ✅[^6]; lab ✅[^12] |
| IPS with tiny propensities, small data | High variance; naive can beat IPS on small datasets | Clipping propensities at a floor `τ` (any propensity below `τ` counts as `τ`) trades bias for variance ✅[^9] |
| Misspecified propensities | Overestimating small propensities is tolerable, underestimating them can hurt | Joachims et al.'s misspecification experiment ✅[^9] |
| Document never shown at a rank with `p_r > 0` | IPS cannot recover its relevance | Unbiasedness needs `p_r > 0` for every rank ✅[^9] |
| Pointwise loss with propensity weights | TF-Ranking's authors report the correction does not work well | They say unbiased-LTR techniques work well with pairwise or listwise losses, not pointwise ✅[^1]; Hu et al. frame earlier IPW objectives as a pointwise risk ✅[^6], so the sources disagree |
| Flexible model (trees) | In the lab, pointwise and lambda gradients gave the same NDCG@10 (0.9100 vs 0.9096) | Lab ✅[^12], one synthetic run with untuned settings; on Web30K and Yahoo!, boosted trees with different losses differed significantly ✅[^5] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Pointwise regression or classification | Simplest; any regressor | Ignores interactions between items ✅[^2]; lab NDCG@10 0.8606 vs 0.8709 for LambdaRank (linear) ✅[^12] |
| RankNet (pairwise logistic) | Simple, probabilistic ✅[^5]; XGBoost's `rank:pairwise` ✅[^7] | Misaligned with position-weighted metrics ✅[^5]; lab: best pairwise accuracy, worst NDCG@10 ✅[^12] |
| LambdaRank / LambdaMART | Metric in the gradient; default in XGBoost ✅[^7]; `lambdarank` in LightGBM ✅[^8] | Its loss is unknown, which makes a theoretical analysis difficult ✅[^5]; extra knobs (truncation, normalization) ✅[^8] |
| ListNet / softmax cross-entropy | Listwise; best of TF-Ranking's three in its experiments ✅[^1] | Only loosely related to NDCG ✅[^5]; ListNet was significantly worse than LambdaMART on the Web30K and Yahoo! benchmark datasets in Bruch's study ✅[^5] |
| XE_NDCG (`rank_xendcg`) | Convex bound on NDCG ✅[^5]; faster than `lambdarank` ✅[^8] | Similar performance to `lambdarank`, so mostly a speed gain ✅[^8] |
| IPS on clicks | Unbiased with correct propensities ✅[^9]; lab matched the bias-free skyline ✅[^12] | Needs propensities from an intervention ✅[^9]; variance ✅[^9] |

## Takeaways
- Report NDCG@k (or the metric the product uses) next to any pairwise accuracy or loss; a better pairwise number is not a better top of the list. [rule-candidate]
- Keep every query's documents together: sort by query id, pass `qid`/`group`, and split cross-validation folds by query. [rule-candidate]
- Before trusting a ranker trained on clicks, compare it with one trained with inverse propensity weights; agreement with the logging ranker is a symptom, not a success.
- Try a flexible model before a clever loss: in the lab, trees with a plain regression loss beat every linear ranker whatever its loss.

## Verification status
- Verified: 113 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [TF-Ranking: Scalable TensorFlow Library for Learning-to-Rank](https://ar5iv.labs.arxiv.org/html/1812.00073) — Pasumarthi et al., 2019 (ar5iv HTML of arXiv:1812.00073). Backs: score-and-sort setup, labels and (query, document) features, metrics emphasizing the top, DCG/NDCG with gain `2^y − 1`, pointwise/pairwise/listwise classes and their formulas, listwise > pairwise > pointwise in their experiments, inverse propensity weights, unbiased LTR not working with pointwise losses. [^1]
- [NeuralNDCG: Direct Optimisation of a Ranking Metric via Differentiable Relaxation of Sorting](https://ar5iv.labs.arxiv.org/html/2102.07831) — Pobrotyn, Białobrzeski, 2021 (ar5iv HTML of arXiv:2102.07831). Backs: score and sort, the three loss categories, pointwise losses forgo item interactions, pairwise methods learn the preference within a pair. [^2]
- [Learning to Rank with Nonsmooth Cost Functions](https://papers.nips.cc/paper_files/paper/2006/hash/af44c4c56f385c43f2529f9b1b018f6a-Abstract.html) — Burges, Ragno, Le, NeurIPS 2006 (abstract page). Backs: retrieval quality measures depend on scores only through the sort, zero or undefined derivatives, LambdaRank's implicit cost, any differentiable function class. [^3]
- [From RankNet to LambdaRank to LambdaMART: An Overview](https://www.microsoft.com/en-us/research/publication/from-ranknet-to-lambdarank-to-lambdamart-an-overview/) — Burges, Microsoft Research technical report MSR-TR-2010-82, 2010 (abstract page; the full text is a PDF only). Backs: LambdaMART as boosted-tree LambdaRank based on RankNet, the 2010 Yahoo! challenge win. [^4]
- [An Alternative Cross Entropy Loss for Learning-to-Rank](https://ar5iv.labs.arxiv.org/html/1911.09798) — Bruch, The Web Conference 2021 (ar5iv HTML of arXiv:1911.09798). Backs: RankNet's probabilistic loss, ListNet's top-one distributions and loss, ListMLE and Plackett–Luce, losses loosely related to metrics, LambdaMART's heuristic gradients with ΔNDCG and its unknown loss hindering analysis, XE_NDCG as a convex bound implemented in LightGBM, Newton steps in boosted trees, significant differences between ListNet, LambdaMART and XE_NDCG trees on Web30K and Yahoo!. [^5]
- [Unbiased LambdaMART: An Unbiased Pairwise Learning-to-Rank Algorithm](https://ar5iv.labs.arxiv.org/html/1809.05818) — Hu, Wang, Peng, Li, 2019 (ar5iv HTML of arXiv:1809.05818). Backs: λ_ij formula, σ default 2, ΔZ as the NDCG swap difference, λ_i sum, the LambdaMART loss form, LambdaMART as gradient boosting on lambdas, position bias in clicks, click models (position-based, cascade, user browsing, dynamic Bayesian network), earlier IPW framed as a pointwise risk, lambda debiasing. [^6]
- [Learning to Rank (XGBoost tutorial)](https://xgboost.readthedocs.io/en/stable/tutorials/learning_to_rank.html) — XGBoost developers, living (3.4.2 docs). Backs: `qid` sorted by query, `rank:ndcg`/`rank:map`/`rank:pairwise`, RankNet = pairwise logistic loss, scaling debated, pair methods `mean` and `topk`, effective pairs, MRR not implemented, `lambdarank_unbiased`, click noise and position bias, distributed query groups, scikit-learn has no LTR interface. [^7]
- [Parameters (LightGBM docs)](https://lightgbm.readthedocs.io/en/stable/Parameters.html) — LightGBM developers, living (4.7.0 docs). Backs: `lambdarank` and `rank_xendcg` objectives, integer labels, `label_gain` default, `lambdarank_truncation_level`, `lambdarank_norm`, query data and `group`. [^8]
- [Unbiased Learning-to-Rank with Biased Feedback](https://ar5iv.labs.arxiv.org/html/1608.04468) — Joachims, Swaminathan, Schnabel, 2017 (ar5iv HTML of arXiv:1608.04468). Backs: examination model, `p_r` per rank, noise-free clicks, the IPS estimator and its condition `p_r > 0`, no negative judgments needed, `(1/r)^η` simulation, Propensity SVM-Rank, clipping and variance, misspecified propensities, swap intervention. [^9]
- [sklearn.metrics.ndcg_score](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.ndcg_score.html) — scikit-learn developers, living (1.9.1 docs). Backs: NDCG sums the true scores with a logarithmic discount. [^10]
- [DART: Dropouts meet Multiple Additive Regression Trees](https://arxiv.org/abs/1505.01866) — Rashmi, Gilad-Bachrach, 2015 (abstract page). Backs: MART = multiple additive regression trees, an ensemble of boosted regression trees. [^11]
- `machine-learning/lab-setup.md` — the lab where the swap calculation, the eight rankers, the gradient shares and the click simulation ran on 2026-11-25. [^12]

## Related
- `machine-learning/evaluation/metrics-catalog.md` — NDCG, DCG, MAP and MRR definitions and their scikit-learn functions.
- `machine-learning/recommender-systems/implicit-feedback-and-ranking.md` — BPR, pairwise ranking from implicit feedback, and full vs sampled ranking metrics.
- `machine-learning/recommender-systems/retrieval-and-ranking-pipelines.md` — the candidate-generation stage that feeds the ranker.
- `machine-learning/recommender-systems/feedback-loops-and-popularity-bias.md` — what happens over many rounds when a ranker retrains on its own clicks.
- `machine-learning/supervised-learning/tree-ensembles.md` — gradient boosting and histogram boosting, the "MART" in LambdaMART.
- `machine-learning/evaluation/cross-validation-and-hyperparameter-search.md` — group-aware splits for query-grouped data.
- `machine-learning/reinforcement-learning/multi-armed-bandits.md` — exploration, which also produces less biased click data.
