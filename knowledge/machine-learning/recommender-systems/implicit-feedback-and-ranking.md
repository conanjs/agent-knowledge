---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/recommender-systems
status: verified
applies-to: ["any"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, recommender-systems, implicit-feedback, ials, weighted-matrix-factorization, confidence-weighting, bpr, negative-sampling, leave-one-out, recall-at-k, ndcg, sampled-metrics, popularity-baseline]
---

# Implicit feedback and learning to rank items

## Summary
**TL;DR:** Clicks, plays and purchases tell you what a user did, never what they disliked. Every item they did not touch is either a real "no" or one they never saw. Two standard ways to learn from such data both contrast the observed items with the unobserved ones. Confidence-weighted ALS (alternating least squares), known as iALS, regresses a 0/1 preference over every cell and trusts a cell more the more often it was observed. BPR (Bayesian personalized ranking) learns only that an observed item should score above a sampled unobserved one. Evaluate by holding out one interaction per user and ranking it against all the items the user has not touched, with recall@k and NDCG@k (normalized discounted cumulative gain). Ranking it against only 100 sampled items looks cheaper, but it changes what the metric measures and can reverse which model wins. Always compare against the popularity baseline.
**Use this when:** your data are clicks, views, plays or purchases rather than ratings; you choose between iALS and BPR; you set up a leave-one-out evaluation; or you read results computed on "1 positive + 100 sampled negatives".
**Not this doc:** explicit ratings, neighbourhood methods and the basic ALS step → `machine-learning/recommender-systems/collaborative-filtering-and-matrix-factorization.md`; the definitions of NDCG, average precision and other ranking metrics → `machine-learning/evaluation/metrics-catalog.md`; serving and in-batch negatives in neural retrieval → `machine-learning/recommender-systems/retrieval-and-ranking-pipelines.md`.

## Problem
Most feedback in real systems is implicit, and explicit ratings can cost more to collect ✅[^2]. Implicit feedback is readily available, because it is simply user behaviour such as clicks, but it is noisy: a user who watched a movie did not necessarily like it ✅[^1]. The data hold only positives. The non-observed pairs mix real negatives (not interested) with missing values (might interact later), and rating-prediction methods that skip them cannot tell observed from non-observed pairs ✅[^2]. Training on the positives alone fails. With only observed cells, a model that predicts 1 everywhere has minimal loss ✅[^7]. Then evaluation must answer "would the item this user picks next be near the top of a list drawn from hundreds of unseen items?" A common shortcut ranks the held-out item against only 100 random ones. That shortcut can rank recommenders in the wrong order, even in expectation ✅[^12].

## Mental model
**Analogy:** a bookshop's sales log. It records who bought which book. It never records who walked past a shelf and decided against a book. Every unbought book is either "not for me" or "never noticed". Weighted factorization treats every unbought book as a weak "probably not", and a book someone bought three times as a strong "yes". BPR never claims to know how much anyone likes a book. It learns only that each customer prefers the books they bought over a random book they did not buy.

**Artifact:** two BPR models from the Worked example. Under full ranking, model A is better at the top of the list. Under the 100-sampled-negatives protocol, model B looks better. Lab run (`machine-learning/lab-setup.md`), 2026-11-25, PyTorch 2.15.0 ✅[^14]:

```text
BPR A: item bias, wd 0.01  full: R@10 0.188 NDCG@10 0.101 R@100 0.499 median rank 101 | sampled: R@10 0.489 NDCG@10 0.310
BPR B: no bias, wd 0.03    full: R@10 0.175 NDCG@10 0.092 R@100 0.530 median rank  86 | sampled: R@10 0.511 NDCG@10 0.318
```

The full ranking puts A ahead at the top of the list (R@10, recall at 10: 0.188 vs 0.175). B is better deeper down (R@100 0.530 vs 0.499), and the sampled R@10 tracks that deeper region, so the sampled protocol reverses the verdict (0.489 vs 0.511). `wd` is the weight decay, the L2 penalty on the embeddings.

## How it works
### From events to preference and confidence
1. **Count:** `r_ui` is the number of times user `u` interacted with item `i` (plays, clicks) ✅[^4].
2. **Preference:** `p_ui = 1` if `r_ui > 0`, else `0` ✅[^4].
3. **Confidence:** `c_ui = 1 + α·r_ui` with `α > 0`, following Hu, Koren and Volinsky ✅[^4]. Cells never observed keep `p = 0` and `c = 1`. That is exactly how the `implicit` library reads an unset cell of its input matrix ✅[^5]. Example: 3 plays with `α = 1` give `c = 4`. An untouched item gives `c = 1`, so it is a weak 0, not a hard negative.
4. **Loss over every cell, not only the observed ones:** `Σ_u Σ_i c_ui·(p_ui − x_u·y_i)² + λ·(Σ_u ‖x_u‖² + Σ_i ‖y_i‖²)`, where `x_u` and `y_i` are the user and item factor vectors and `λ` is the L2 penalty ✅[^4]. Spark's implicit mode describes the same idea: the numbers express the strength of the observed actions, which are turned into confidence in the preferences, and `alpha` sets the baseline confidence ✅[^13].

### Solving it: ALS with the Gramian trick
1. **Per-user ridge regression:** with the item factors `Y` fixed, `x_u = (Yᵀ C^u Y + λI)⁻¹ Yᵀ C^u p_u`, where `C^u` is the diagonal matrix of the user's confidences ✅[^10]. Then swap the roles and solve every item.
2. **The trick:** `Yᵀ C^u Y = YᵀY + Yᵀ(C^u − I)Y`. The Gramian `YᵀY` (the `k × k` matrix of dot products between factor dimensions, summed over all items) is the same for every user and is computed once. `C^u − I` is non-zero only on the user's observed items, so each user costs `O(|R_u|·k²)` for that term instead of a pass over all items ✅[^10].
3. **Cost:** the overall complexity of iALS is then `O(d²·|S| + d³·(|U| + |I|))`, where `|S|` is the number of observed pairs and `d` the embedding dimension. This is independent of the `|U|·|I|` cells it sums over ✅[^6].
4. **The trade-off knob:** Rendle et al. write the loss with a weight `α₀` on a term that pulls the score of every (user, item) pair, observed or not, toward 0, and say that this unobserved weight and `λ` are both crucial and should be searched together. With `α₀ = 0` the solution degenerates to predicting 1 everywhere, and with `α₀ → ∞` it degenerates to predicting 0 ✅[^6]. They suggest an exponential grid such as `α₀ ∈ {1, 0.3, 0.1, …, 0.003}`, smaller for sparser matrices, and report that well-tuned iALS is competitive with much newer models on four benchmarks ✅[^6].

### BPR: learn the order, not the score
1. **Training triples:** `D = {(u, i, j) : i ∈ I_u⁺, j ∈ I \ I_u⁺}`, where `I_u⁺` is the set of items user `u` interacted with. The assumption is that `u` prefers each observed item `i` to every non-observed item `j` ✅[^2].
2. **Objective (BPR-Opt):** maximize `Σ_(u,i,j)∈D ln σ(ŷ_ui − ŷ_uj) − λ_Θ·‖Θ‖²`. Here `ŷ` is the model's score, `σ(x) = 1/(1 + e^(−x))`, and `Θ` are all the parameters. It is the maximum a posteriori estimate under a zero-mean Normal prior ✅[^2]. Worked numbers: with `ŷ_ui = 2.0` and `ŷ_uj = 0.5`, the difference is 1.5, `σ(1.5) = 0.818`, and the loss term `−ln 0.818 = 0.201`. If the order is reversed, the loss is `−ln σ(−1.5) = 1.701`.
3. **Generic:** BPR-Opt is model-agnostic. Its authors train it with SGD (stochastic gradient descent) using bootstrap sampling of triples, and apply it to matrix factorization and to adaptive kNN (k-nearest neighbours) ✅[^3].
4. **Families of ranking losses:** pointwise losses (such as matrix factorization's squared error) score one interaction at a time. Pairwise losses (BPR, or a hinge `max(m − ŷ_ui + ŷ_uj, 0)` with margin `m`) score one pair. Listwise losses target the whole list, for example NDCG directly, and are more complex and compute-intensive ✅[^2].

### Negative sampling
`D` has one triple per (positive, unobserved item) pair, far too many to enumerate. Dive into Deep Learning (d2l) samples each negative at random from the items the user has not interacted with ✅[^9]. Google's course lists uniform sampling, or sampling items with a high current score (hard negatives) because they contribute most to the gradient ✅[^8]. The lab samples `j` uniformly from all 1,000 items, so a sampled "negative" is in fact one of the user's training positives with probability (number of those positives) / 1,000: 2.1 % for the average user (the training density, 0.021), more for heavy users ✅[^14].

### Offline evaluation of a ranked list
1. **Leave-one-out:** for each user, hold out one interaction. The NCF (neural collaborative filtering) protocol holds out each user's last item and trains on the rest ✅[^11]. Without timestamps, the lab holds out a random one ✅[^14].
2. **Rank it:** score every item the user has not interacted with in training (training items are excluded) and find the held-out item's rank `r` ✅[^14].
3. **Recall@k (hit ratio):** with one held-out item, it is 1 if `r ≤ k`, else 0, averaged over users ✅[^11] ✅[^9]. **NDCG@k** with one relevant item is `1/log₂(r + 1)` if `r ≤ k`, else 0 ✅[^11] ✅[^12]. Example: rank 1 scores 1.0, rank 3 scores `1/log₂4 = 0.5`, rank 11 scores 0 at `k = 10`. Rank 1 is worth 1.58 times rank 2 under NDCG, while AUC (area under the ROC, receiver operating characteristic, curve) only decays linearly with the rank ✅[^12]. General definitions and the `sklearn.metrics` functions are in `machine-learning/evaluation/metrics-catalog.md`.

### The sampled-metric pitfall
1. **The shortcut:** rank the held-out item against only `m` random irrelevant items, for example `m = 100` as in the NCF protocol ✅[^11] ✅[^12].
2. **What it does to the rank:** if the item's true rank among `n` items is `r`, its sampled rank is `r̃ ~ Binomial(m, (r−1)/(n−1)) + 1` ✅[^12]. Worked numbers: `r = 50`, `n = 1,000` and `m = 100` give `p = 49/999 = 0.049`, so the expected sampled rank is `1 + 100 × 0.049 = 5.9`. An item at true rank 50 usually counts as a "top-10 hit".
3. **Inconsistency:** Krichene and Rendle show that sampled average precision, NDCG and recall do not preserve "A is better than B", not even in expectation. Only AUC is consistent. For small samples, all metrics converge to a linear, AUC-like function of the rank ✅[^12].
4. **Corrections:** upscale the sampled rank to `r̂ = 1 + (n−1)(r̃−1)/m` before applying the metric, or fit a correction that minimizes bias or a bias–variance trade-off. Corrected metrics identify the true order more often but have higher variance. The authors' advice is to avoid sampling in evaluation ✅[^12].

### The popularity baseline
Score every item by how many users interacted with it in training, and show everyone the same list. It needs no model. In the lab it reached R@10 0.156, eleven times random (0.014), and it took a tuned factorization model to beat it clearly ✅[^14]. Baselines also need tuning. Rendle et al. found that a properly tuned dot-product model beat the MLP-based (multilayer perceptron) similarities it had been compared against in the original NCF experiments ✅[^11].

## Worked example
1,000 users and 1,000 items. True affinity is `θ_u·φ_i + b_i`, with 8 latent dimensions and a long-tail item popularity `b_i`. Each user interacts with 6 to 120 items, drawn without replacement with probability proportional to `exp(affinity)`. The play count is `1 + Poisson(exp(0.5·θ_u·φ_i))`, so users replay items that fit their taste. One interaction per user is held out. Every model is evaluated twice: against all items the user has not touched, and against the same 100 sampled ones. The hyperparameters (rank 16, `λ = 30`, the BPR weight decays) were picked by a few trial runs against these same held-out items, so the learned models' absolute numbers are somewhat optimistic. The core of both learners:

```python
A = G + (Fs.T * (c - 1)) @ Fs + lam * np.eye(k)      # G = F.T @ F shared by all rows (Gramian trick)
out[r] = np.linalg.solve(A, Fs.T @ c)               # iALS: ridge regression with confidences c, p = 1
x_uij = (P(u) * Q(i)).sum(1) - (P(u) * Q(j)).sum(1)  # BPR: score of positive i minus negative j
loss = -torch.nn.functional.logsigmoid(x_uij).mean()
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-25, numpy 2.5.5, PyTorch 2.15.0. Two runs gave identical output ✅[^14]:

```text
users 1000 items 1000 train interactions 20,921 density 0.021; top 10% items hold 0.43 of them
random                     full: R@10 0.014 NDCG@10 0.006 R@100 0.099 median rank 498 | sampled: R@10 0.095 NDCG@10 0.044
popularity (train counts)  full: R@10 0.156 NDCG@10 0.086 R@100 0.451 median rank 126 | sampled: R@10 0.444 NDCG@10 0.272
iALS alpha 1.0  counts     full: R@10 0.231 NDCG@10 0.137 R@100 0.558 median rank  70 | sampled: R@10 0.548 NDCG@10 0.360
iALS alpha 10.0 counts     full: R@10 0.186 NDCG@10 0.102 R@100 0.488 median rank 109 | sampled: R@10 0.477 NDCG@10 0.306
iALS alpha 1.0  binary     full: R@10 0.156 NDCG@10 0.088 R@100 0.462 median rank 122 | sampled: R@10 0.457 NDCG@10 0.279
iALS alpha 10.0 binary     full: R@10 0.213 NDCG@10 0.117 R@100 0.519 median rank  89 | sampled: R@10 0.515 NDCG@10 0.331
ALS, observed cells only   full: R@10 0.154 NDCG@10 0.081 R@100 0.437 median rank 138 | sampled: R@10 0.427 NDCG@10 0.262
  iALS alpha 1 counts  mean score: train positives 0.316, unobserved cells 0.048
  observed cells only  mean score: train positives 0.714, unobserved cells 0.480
  BPR epoch  1: last batch loss 0.6162, share of pairs ranked right 0.757
  BPR epoch 40: last batch loss 0.3065, share of pairs ranked right 0.925
BPR A: item bias, wd 0.01  full: R@10 0.188 NDCG@10 0.101 R@100 0.499 median rank 101 | sampled: R@10 0.489 NDCG@10 0.310
  BPR epoch  1: last batch loss 0.7046, share of pairs ranked right 0.535
  BPR epoch 40: last batch loss 0.5182, share of pairs ranked right 0.907
BPR B: no bias, wd 0.03    full: R@10 0.175 NDCG@10 0.092 R@100 0.530 median rank  86 | sampled: R@10 0.511 NDCG@10 0.318
oracle (true affinity)     full: R@10 0.286 NDCG@10 0.178 R@100 0.663 median rank  42 | sampled: R@10 0.649 NDCG@10 0.439
```

<details><summary>Full script (prints the output above)</summary>

```python
# Implicit feedback: popularity baseline, confidence-weighted ALS (Hu et al.) in numpy, BPR with
# uniform negative sampling in PyTorch; leave-one-out evaluation with full ranking vs 100 sampled negatives.
import numpy as np, torch

rng = np.random.default_rng(0)
U, I, D = 1000, 1000, 8
theta, phi = rng.normal(0, 0.7, (U, D)), rng.normal(0, 0.7, (I, D))
b = np.log(1.0 / np.arange(1, I + 1) ** 0.8); b = rng.permutation(b - b.mean())   # long-tail popularity
aff = theta @ phi.T + b                                                           # true affinity
n_u = np.clip(rng.lognormal(np.log(20), 0.5, U).astype(int), 6, 120)
pos = []                                                                          # (user, item, play count)
for u in range(U):
    g = aff[u] + rng.gumbel(size=I)                                               # Gumbel top-n = sampling
    items = np.argsort(-g)[:n_u[u]]                                               # without replacement ~ exp(aff)
    counts = 1 + rng.poisson(np.exp(0.5 * theta[u] @ phi[items].T))               # more plays when it fits taste
    pos += [(u, i, c) for i, c in zip(items, counts)]
pos = np.array(pos)
held = np.zeros(len(pos), bool)                                                   # leave one out per user
for u in range(U):
    held[rng.choice(np.flatnonzero(pos[:, 0] == u))] = True
trn, tst = pos[~held], pos[held]
Rtr = np.zeros((U, I)); Rtr[trn[:, 0], trn[:, 1]] = trn[:, 2]
cnt = (Rtr > 0).sum(0)
print(f"users {U} items {I} train interactions {len(trn):,} density {len(trn) / (U * I):.3f}; "
      f"top 10% items hold {np.sort(cnt)[::-1][:I // 10].sum() / cnt.sum():.2f} of them")

neg_rng = np.random.default_rng(7)
SAMPLED = []                                                                      # same 100 negatives for every model
for u, i, _ in tst:
    cand = np.flatnonzero((Rtr[u] == 0) & (np.arange(I) != i))
    SAMPLED.append(neg_rng.choice(cand, 100, replace=False))

def evaluate(name, scores):
    s = scores.copy(); s[Rtr > 0] = -np.inf                                       # never re-recommend train items
    full, samp = [], []
    for k, (u, i, _) in enumerate(tst):
        full.append(1 + np.sum(s[u] > s[u, i]))                                   # rank among all unseen items
        samp.append(1 + np.sum(s[u, SAMPLED[k]] > s[u, i]))                       # rank among 100 sampled + held-out
    full, samp = np.array(full), np.array(samp)
    ndcg = lambda r: np.mean(np.where(r <= 10, 1 / np.log2(r + 1), 0))
    print(f"{name:<26} full: R@10 {np.mean(full <= 10):.3f} NDCG@10 {ndcg(full):.3f} "
          f"R@100 {np.mean(full <= 100):.3f} median rank {int(np.median(full)):3d}"
          f" | sampled: R@10 {np.mean(samp <= 10):.3f} NDCG@10 {ndcg(samp):.3f}")

evaluate("random", np.random.default_rng(3).random((U, I)))
evaluate("popularity (train counts)", np.tile(cnt.astype(float), (U, 1)))

def ials(k=16, lam=30.0, alpha=1.0, iters=10, use_counts=True, unobserved=True):
    """Hu et al.: c = 1 + alpha * r on observed cells (p = 1), c = 1 and p = 0 on all others."""
    r_ = np.random.default_rng(1)
    X, Y = r_.normal(0, 0.01, (U, k)), r_.normal(0, 0.01, (I, k))
    C = 1 + alpha * (Rtr if use_counts else (Rtr > 0))
    def solve(F, Rm, Cm):                                                         # one ridge regression per row
        G = F.T @ F if unobserved else np.zeros((k, k))                           # Gramian trick: shared part
        out = np.empty((Rm.shape[0], k))
        for r in range(Rm.shape[0]):
            S = np.flatnonzero(Rm[r]); c = Cm[r, S]; Fs = F[S]
            A = G + (Fs.T * ((c - 1) if unobserved else c)) @ Fs + lam * np.eye(k)
            out[r] = np.linalg.solve(A, Fs.T @ c)                                 # p = 1 on observed cells
        return out
    for _ in range(iters):
        X = solve(Y, Rtr, C); Y = solve(X, Rtr.T, C.T)
    return X @ Y.T

runs = {}
for a, counts in ((1.0, True), (10.0, True), (1.0, False), (10.0, False)):
    runs[a, counts] = ials(alpha=a, use_counts=counts)
    evaluate(f"iALS alpha {a:<4} {'counts' if counts else 'binary'}", runs[a, counts])
S_obs = ials(alpha=1.0, unobserved=False)                                         # no negatives at all
evaluate("ALS, observed cells only", S_obs)
for name, S in (("iALS alpha 1 counts", runs[1.0, True]), ("observed cells only", S_obs)):
    print(f"  {name:<20} mean score: train positives {S[Rtr > 0].mean():.3f}, "
          f"unobserved cells {S[Rtr == 0].mean():.3f}")

def bpr(wd, bias, k=16, epochs=40, lr=0.02, batch=1024):
    torch.manual_seed(0)
    P, Q, B = torch.nn.Embedding(U, k), torch.nn.Embedding(I, k), torch.nn.Embedding(I, 1)
    torch.nn.init.zeros_(B.weight)                                                # B: item bias (popularity)
    torch.nn.init.normal_(P.weight, std=0.1); torch.nn.init.normal_(Q.weight, std=0.1)
    params = list(P.parameters()) + list(Q.parameters()) + (list(B.parameters()) if bias else [])
    opt = torch.optim.Adam(params, lr=lr)
    users, items = torch.tensor(trn[:, 0]), torch.tensor(trn[:, 1])
    g = torch.Generator().manual_seed(0)
    for ep in range(epochs):
        perm = torch.randperm(len(users), generator=g)
        for s in range(0, len(perm), batch):
            idx = perm[s:s + batch]; u, i = users[idx], items[idx]
            j = torch.randint(0, I, (len(idx),), generator=g)                     # uniform negative (may be a positive)
            x_uij = (P(u) * Q(i)).sum(1) - (P(u) * Q(j)).sum(1) + (B(i) - B(j)).squeeze(1) * bias
            loss = -torch.nn.functional.logsigmoid(x_uij).mean() \
                   + wd * (P(u).pow(2).sum() + Q(i).pow(2).sum() + Q(j).pow(2).sum()) / len(idx)
            opt.zero_grad(); loss.backward(); opt.step()
        if ep + 1 in (1, 40):
            print(f"  BPR epoch {ep + 1:2d}: last batch loss {loss.item():.4f}, "
                  f"share of pairs ranked right {(x_uij > 0).float().mean().item():.3f}")
    with torch.no_grad():
        return (P.weight @ Q.weight.T + B.weight.T * bias).numpy().astype(float)

evaluate("BPR A: item bias, wd 0.01", bpr(wd=0.01, bias=True))
evaluate("BPR B: no bias, wd 0.03", bpr(wd=0.03, bias=False))
evaluate("oracle (true affinity)", aff)
```

</details>

Reading it:
- **Popularity is a real baseline:** R@10 0.156 against 0.014 for random, with no model at all. The oracle, which knows the true affinity, reaches only 0.286, because the held-out item is itself a random draw.
- **Confidence weighting:** with `α = 1`, using the play counts lifts iALS from 0.156 (binary) to 0.231, the best learned model. With `α = 10`, counts score 0.186 and binary data 0.213: a large `α` multiplied by large counts gives a few heavily replayed cells far more weight than the rest, which hurt in this run. The lab kept `λ = 30` fixed, while Rendle et al. advise searching the weights and `λ` together.
- **No negatives:** ALS on the observed cells only scores high everywhere (mean 0.714 on positives, 0.480 on unobserved cells, against 0.316 and 0.048 for iALS). Its ranking is no better than popularity (0.154).
- **BPR:** 91–93 % of the training pairs in the last batch end up correctly ordered. Model A, with an item bias that can absorb popularity, beats popularity at the top (0.188).
- **Sampled metrics:** random rises from 0.014 to 0.095, close to `10/101`. Every model's sampled R@10 is within 0.02 of its full R@100 (popularity 0.444 vs 0.451, iALS 0.548 vs 0.558, oracle 0.649 vs 0.663), so "sampled recall at 10" in this setup measures roughly "full recall at 100". The two BPR models swap places for that reason (the Mental model artifact). Here iALS stays first under both protocols, but the BPR pair shows that the order need not survive.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Train on positives only | Model scores everything high; ranking ≈ popularity (lab 0.154 vs 0.156) | All-ones prediction minimizes the observed-only loss ✅[^7] ✅[^6]; lab ✅[^14] |
| Unobserved weight `α₀` too high | Everything is pushed toward 0 | The `α₀ → ∞` degenerate solution ✅[^6] |
| Large `α` with heavy-tailed counts | Heavily replayed cells get far more weight than the rest; lab R@10 drops from 0.231 to 0.186 | Confidence grows linearly with the count ✅[^4]; lab ✅[^14] |
| A "watched" item the user disliked | Counted as a positive | Implicit feedback is noisy ✅[^1] |
| Uniform negatives include real positives | Some triples teach the wrong order | Lab samples from all items: 2.1 % positives for the average user (density 0.021) ✅[^14]; d2l samples from non-interacted items only ✅[^9] |
| Training on positives without negatives in a softmax/DNN (deep neural network) model | Folding: unrelated groups end up close in embedding space | Explained with the two-tower model in `machine-learning/recommender-systems/retrieval-and-ranking-pipelines.md` (How it works, "In-batch negatives and the logQ correction", step 5) |
| Result reported on "1 + 100 sampled negatives" | Inflated values; model order can flip | Sampled metrics are biased and inconsistent ✅[^12]; lab: BPR A and B swap ✅[^14] |
| Two papers sample a different `m` | Not comparable; the order can change with `m` | The bias depends on the recommender and the sample size ✅[^12] |
| Training items left in the ranking | Already-seen items, which the model fits to score high, crowd out the held-out one | The lab sets their scores to `−∞` before ranking ✅[^14] |
| MLP instead of a dot product to combine embeddings | Not better once the dot product is tuned; `O(d²)` instead of `O(d)` per score | Rendle et al. ✅[^11] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| iALS (confidence-weighted, all cells) | Uses every unobserved cell at no `|U|·|I|` cost; competitive when tuned ✅[^6]; best in the lab ✅[^14] | Squared loss only; the unobserved weight `α₀` and `λ` must be searched together ✅[^6] |
| BPR (pairwise, sampled negatives) | Optimizes the order directly; a generic criterion, applied to matrix factorization and adaptive kNN ✅[^3] | Depends on the negative sampler ✅[^8]; trains on a sample of the pairs |
| Popularity | No training; strong on long-tail data (lab 11× random) ✅[^14] | Same list for everyone |
| Full-ranking evaluation | Measures the metric its name says | Scores every item for every test user |
| Sampled evaluation | Cheap | Biased and inconsistent; collapses toward AUC ✅[^12] |

## Takeaways
- Never train an implicit-feedback model on positives alone: weight the unobserved cells (iALS) or sample negatives (BPR). [rule-candidate]
- Evaluate on the full item ranking. If you must sample, say so, and use a corrected metric rerun with several seeds. [rule-candidate]
- Report the popularity baseline with every result. A model that does not beat it clearly is not personalizing.
- Treat confidence `α`, the unobserved weight and `λ` as one joint search, not three independent knobs.
- When reading a paper, check the protocol: "hit ratio at 10 among 100 sampled items" is not recall at 10.

## Verification status
- Verified: 61 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [Overview of Recommender Systems (Dive into Deep Learning, 21.1)](https://d2l.ai/chapter_recommender-systems/recsys-intro.html) — Zhang, Lipton, Li, Smola, living. Backs: implicit feedback is plentiful but noisy. [^1]
- [Personalized Ranking for Recommender Systems (Dive into Deep Learning, 21.5)](https://d2l.ai/chapter_recommender-systems/ranking.html) — Zhang, Lipton, Li, Smola, living. Backs: non-observed pairs as negatives plus missing values; pointwise, pairwise, listwise; the BPR training set, objective and prior; the ranking hinge loss. [^2]
- [BPR: Bayesian Personalized Ranking from Implicit Feedback](https://arxiv.org/abs/1205.2618) — Rendle, Freudenthaler, Gantner, Schmidt-Thieme, 2009 (arXiv abstract). Backs: BPR-Opt as a generic maximum a posteriori criterion, SGD with bootstrap sampling, application to matrix factorization and adaptive kNN. [^3]
- [Collaborative Item Embedding Model for Implicit Feedback Data](https://ar5iv.labs.arxiv.org/html/1805.05005) — Nguyen, Aihara, Takasu, 2018 (ar5iv HTML of arXiv:1805.05005). Backs: Hu et al.'s count, preference and confidence `c = 1 + α·r`, the weighted MF objective. [^4]
- [AlternatingLeastSquares (implicit 0.7.2 docs)](https://benfred.github.io/implicit/api/models/cpu/als.html) — Ben Frederickson, living (0.7.2). Backs: a model based on Hu et al., the input matrix as confidences, unset cells read as `P = 0`, `C = 1`. [^5]
- [Revisiting the Performance of iALS on Item Recommendation Benchmarks](https://ar5iv.labs.arxiv.org/html/2110.14037) — Rendle, Krichene, Zhang, Koren, 2021 (ar5iv HTML of arXiv:2110.14037). Backs: the iALS loss with an unobserved weight, complexity independent of `|U|·|I|`, degenerate solutions, the tuning grid and sparsity advice, well-tuned iALS is competitive. [^6]
- [Matrix factorization (Recommendation Systems course)](https://developers.google.com/machine-learning/recommendation/collaborative/matrix?hl=en) — Google for Developers, living. Backs: an observed-only objective is minimized by all ones. [^7]
- [Softmax training (Recommendation Systems course)](https://developers.google.com/machine-learning/recommendation/dnn/training?hl=en) — Google for Developers, living. Backs: uniform and hard negative sampling. [^8]
- [Neural Collaborative Filtering for Personalized Ranking (Dive into Deep Learning, 21.6)](https://d2l.ai/chapter_recommender-systems/neumf.html) — Zhang, Lipton, Li, Smola, living. Backs: negatives sampled from non-interacted items, the Hit@ℓ definition. [^9]
- [Fast Matrix Factorization for Online Recommendation with Implicit Feedback](https://ar5iv.labs.arxiv.org/html/1708.05024) — He, Zhang, Kan, Chua, 2016 (ar5iv HTML of arXiv:1708.05024). Backs: the weighted ALS closed form, Hu et al.'s uniform-weight memoization `YᵀC^uY = w₀YᵀY + …` and its cost. [^10]
- [Neural Collaborative Filtering vs. Matrix Factorization Revisited](https://ar5iv.labs.arxiv.org/html/2005.09683) — Rendle, Krichene, Zhang, Anderson, 2020 (ar5iv HTML of arXiv:2005.09683). Backs: the leave-last-out protocol with 100 random items, the hit ratio and NDCG definitions, a tuned dot product beating MLP similarities, `O(d)` vs `O(d²)`. [^11]
- [On Sampled Metrics for Item Recommendation (Extended Abstract)](https://www.ijcai.org/proceedings/2021/651) — Krichene, Rendle, IJCAI (International Joint Conference on Artificial Intelligence) 2021; summarizes their KDD (Knowledge Discovery and Data Mining) 2020 paper. Backs: the sampled protocol, the binomial sampled rank, inconsistency of sampled AP, NDCG and recall, consistency of AUC, collapse toward AUC, NDCG `1/log₂(r+1)` and the 1.58 ratio, the rank-upscaling and bias–variance corrections, advice to avoid sampling. [^12]
- [Collaborative Filtering (Spark 4.3.0 MLlib guide)](https://spark.apache.org/docs/latest/ml-collaborative-filtering.html) — Apache Spark, living (4.3.0 when read). Backs: the implicit-preference variant, strength of observations as confidence, `alpha`. [^13]
- `machine-learning/lab-setup.md` — the lab where the implicit-feedback simulation, popularity, iALS, BPR and the full vs sampled evaluation ran on 2026-11-25. [^14]

## Related
- `machine-learning/recommender-systems/collaborative-filtering-and-matrix-factorization.md` — explicit ratings, biases and the plain ALS step this builds on.
- `machine-learning/recommender-systems/retrieval-and-ranking-pipelines.md` — the same contrast of positives and negatives inside a two-tower model, and the popularity bias of in-batch negatives.
- `machine-learning/evaluation/metrics-catalog.md` — NDCG, DCG and average precision as general metrics.
- `machine-learning/evaluation/cross-validation-and-hyperparameter-search.md` — tuning `α`, `λ` and the rank on a validation split.
- `machine-learning/evaluation/data-leakage.md` — holding out by time when timestamps exist.
- `machine-learning/foundations/loss-functions-and-maximum-likelihood.md` — the log loss inside BPR and MAP (maximum a posteriori) estimation as a penalized likelihood.
