---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/recommender-systems
status: verified
applies-to: ["any"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, recommender-systems, collaborative-filtering, matrix-factorization, latent-factors, als, sgd, neighbourhood-methods, item-knn, rmse, sparsity, explicit-feedback]
---

# Collaborative filtering and matrix factorization

## Summary
**TL;DR:** A recommender starts from a user × item matrix in which almost every cell is empty. Collaborative filtering fills the empty cells from the behaviour of other users. Neighbourhood methods average a user's ratings of the most similar items (or the ratings of the most similar users). Matrix factorization gives every user and every item a short vector of hidden factors plus a bias, and predicts `r̂ = μ + b_u + b_i + p_u·q_i`. You can train it with SGD (stochastic gradient descent, one rating at a time) or with ALS (alternating least squares: fix the items and solve every user exactly as a small ridge regression, then swap). Regularization is what stops thousands of free factors from memorizing a few ratings per user.
**Use this when:** you predict star ratings from a sparse rating matrix, choose between a neighbourhood method and matrix factorization, pick the rank and the regularization of a factorization model, or must choose between SGD and ALS.
**Not this doc:** clicks and plays instead of ratings, ranking losses and ranked-list evaluation → `machine-learning/recommender-systems/implicit-feedback-and-ranking.md`; serving, two-tower models and cold start at scale → `machine-learning/recommender-systems/retrieval-and-ranking-pipelines.md`; penalties in general → `machine-learning/foundations/regularization.md`.

## Problem
Most users rate few items, so the rating matrix is mostly empty. MovieLens 100K has 943 users and 1,682 movies, and 93.695 % of the matrix is empty ✅[^2]. You cannot learn a separate number for each empty cell: there is nothing to learn it from. Two naive fixes fail. With binary feedback, fitting only the observed cells is minimized by a matrix of all ones, which recommends nothing useful. Treating every empty cell as a zero gives predictions close to zero almost everywhere, which generalizes poorly ✅[^4]. Similarity between users or items breaks down too, because two items often share few or no raters. In the lab, 22 % of item pairs had no rater in common ✅[^12]. The model needs a structure that lets the ratings of other users and other items inform a cell that nobody has filled.

## Mental model
**Analogy:** a wine club. Every wine has a hidden profile on a few axes (oaky, sweet, tannic), and every member has a hidden taste on the same axes. A member's score is "how well my taste matches this profile", plus how generous the member is in general, plus how good the wine is in general. Nobody ever writes the axes down. You infer them because members who agreed in the past tend to agree again. Matrix factorization learns those axes (the factors) and the two kinds of generosity (the biases) from the scores alone.

**Artifact:** one held-out prediction from the rank-5 model in the Worked example, split into its four parts. Lab run (`machine-learning/lab-setup.md`), 2026-11-25, numpy 2.5.5 ✅[^12]:

```text
one test prediction (user 0, item 142): mu 3.46 + b_u -0.08 + b_i +0.19 + p.q +0.19 = 3.76; noise-free truth 3.73, observed 4.25
```

The global mean `μ` is 3.46, this user rates 0.08 below average, this item gets 0.19 above average, and the taste match `p_u·q_i` adds 0.19. The sum, 3.76, is close to the noise-free truth of 3.73. The observed rating was 4.25, because each rating carries noise.

## How it works
### The user–item matrix
- **Rows, columns, cells:** `m` users × `n` items. A cell holds a rating, and most cells are unknown ✅[^3]. Sparsity is `1 − (number of known cells) / (users × items)` ✅[^2]. Example: 28,722 ratings from 800 users on 500 items give `1 − 28,722 / 400,000 = 0.928` ✅[^12].
- **Explicit or implicit:** explicit feedback is a rating the user chose to give, such as one to ten stars. Implicit feedback is behaviour such as clicks, purchases or watches. It is plentiful but noisy: a watched movie is not necessarily a liked one ✅[^1]. This doc covers explicit ratings. Implicit feedback needs different losses (`implicit-feedback-and-ranking.md`).
- **Collaborative filtering (CF):** CF predicts from the interaction data alone. Memory-based CF covers nearest-neighbour methods (user-based and item-based CF). Model-based CF covers latent-factor models such as matrix factorization ✅[^1]. Content-based methods use descriptions of the items instead ✅[^1].

### Neighbourhood methods (memory-based CF)
1. **Similarity:** compute a weight `w` between pairs of users, or between pairs of items, from their past ratings. Pearson correlation, cosine similarity and Spearman rank correlation are common choices ✅[^7].
2. **Neighbours:** keep only the `K` most similar users or items, and optionally normalize the weights ✅[^7].
3. **Predict:** the lab's item-based version predicts `r̂_ui = baseline_ui + Σ_j w_ij·(r_uj − baseline_uj) / Σ_j |w_ij|`. The sum runs over the 30 items `j` that user `u` has rated and that have the largest absolute similarity `|w_ij|` to item `i`. The baseline is `μ + b_u + b_i` ✅[^12].
4. **Limit:** similarities come from co-rated items, so memory-based CF struggles with sparse and large data ✅[^1]. In the lab, only 24 % of item pairs had five or more raters in common ✅[^12].

### Matrix factorization with biases
Matrix factorization (MF) factorizes the rating matrix `R` (`m × n`) into a user matrix `P` (`m × k`) and an item matrix `Q` (`n × k`), where `k`, the number of latent factors (the rank), is much smaller than `m` and `n` ✅[^3]:

```text
r̂_ui = μ + b_u + b_i + p_u · q_i
```

- `r̂_ui`: the predicted rating of user `u` for item `i`.
- `μ`: the global mean rating. The Dive into Deep Learning (d2l) formula has only the two biases. The lab adds `μ` so that the biases become deviations from it ✅[^12].
- `b_u`, `b_i`: user and item biases. They capture that some users rate everything high and some items get low ratings everywhere ✅[^3].
- `p_u`, `q_i`: row `u` of `P` and row `i` of `Q`. Each element of `q_i` measures how much the item has some characteristic, and each element of `p_u` measures the user's interest in it. The factors may be interpretable (genre, language) or not ✅[^3].
- Example: `3.46 + (−0.08) + 0.19 + 0.19 = 3.76` (the Mental model artifact).

Training minimizes the squared error on the known cells `K` plus a penalty ✅[^3]:

```text
Σ_(u,i)∈K (r_ui − r̂_ui)²  +  λ · (‖P‖²_F + ‖Q‖²_F + b_u² + b_i²)
```

`λ` is the regularization rate, which penalizes large parameters to avoid overfitting ✅[^3]. `‖P‖²_F` is the squared Frobenius norm, the sum of all squared entries of `P`. The model is compact. The full matrix has `O(nm)` entries, the factors only `O((n+m)·k)` ✅[^4]. For the lab, that is 400,000 cells against `(800 + 500) × 5 = 6,500` factors plus 1,300 biases.

Matrix factorization became widely known through the Netflix Prize, a contest held in 2006 to beat the Netflix baseline by 10 %. The winning team's solution was an ensemble of many algorithms in which matrix factorization played a critical role ✅[^3].

### Training: SGD or ALS
- **SGD:** loop over the known ratings in random order. For each rating, compute the error `e = r_ui − r̂_ui` and nudge the parameters, for example `p_u ← p_u + η·(e·q_i − λ·p_u)` with learning rate `η` ✅[^8]. Because the penalty is applied once per rating, a user with 50 ratings is regularized 50 times as hard as a user with one. In effect, SGD optimizes a frequency-weighted penalty `λ·|I(u)|·‖p_u‖²`, where `|I(u)|` is the number of ratings of user `u` ✅[^8].
- **Why alternating works:** with the item vectors fixed, each user vector can be learned to best explain that user's feedback, so users with similar preferences end up close together. The same holds for items with the user vectors fixed ✅[^5].
- **ALS:** the objective is quadratic in `P` when `Q` is fixed, and quadratic in `Q` when `P` is fixed, but it is not jointly convex ✅[^4]. So alternate between the two. Fix `Q` and solve every user exactly, then fix `P` and solve every item. Each step can only lower the loss, so the procedure converges, and each half-step parallelizes over users or items ✅[^4].
- **One ALS step, by hand:** for user `u`, stack the item vectors of the items `u` rated as rows of a matrix `A`, and set `y` to the ratings minus the other terms. Then `p_u = (AᵀA + λI)⁻¹ Aᵀ y`, which is the ridge-regression solution. Each update needs the inverse of a `k × k` matrix, usually taken as `O(k³)` ✅[^10]. The bias fits in the same solve: append a constant column of 1s to `A` and one more unknown to `p_u` ✅[^10]. The lab solves it with `np.linalg.lstsq` on `A` stacked over `√(λ·n_u)·I`, where `n_u` is the user's number of ratings. That gives the same answer with `λ·n_u` in place of `λ` (the next bullet says why), and with `λ = 0` and too few ratings, lstsq returns the minimum-norm solution among the many exact fits ✅[^11].
- **Same objective for both:** Spark multiplies the ALS penalty by the number of ratings of each user or item, so that `λ` depends less on the size of the dataset ✅[^9]. That is the same frequency-weighted penalty SGD applies implicitly, and the lab uses it so that one `λ` means the same thing for both optimizers ✅[^8] ✅[^9].
- **Speed:** Google's course lists WALS (weighted ALS) as converging faster than SGD, while SGD is more flexible about the loss function ✅[^4]. In the lab, ALS reached a test RMSE (root-mean-square error) of 0.635 after 5 passes, and SGD reached 0.680 after 40 epochs ✅[^12].

### Rank, regularization and RMSE
- **RMSE:** `RMSE = √( (1/|T|) Σ_(u,i)∈T (r_ui − r̂_ui)² )` over a test set `T` of known cells ✅[^3]. Example: errors of 0.5, −0.3 and 0.8 give `√((0.25 + 0.09 + 0.64)/3) = 0.572`. Noise sets a floor: if ratings are truth plus noise with standard deviation σ, even the true model scores about σ. That was 0.502 in the lab ✅[^12].
- **Rank `k`:** too small cannot express the tastes, too large has spare capacity to fit noise. The lab's true rank was 5, and with `λ = 0.05` the test RMSE was lowest at rank 5 ✅[^12].
- **Regularization `λ`:** without it, a user with 28 training ratings and a rank-20 model (21 unknowns with the bias) is fitted closely. In the lab, the train RMSE was 0.181 and the test RMSE exploded to 31.7 ✅[^12]. With too much regularization, every factor and bias shrinks toward 0 and the model falls back toward the global mean: 0.993 at `λ = 1`, worse than the biases alone ✅[^12]. Tune `λ` and `k` together on held-out ratings (`machine-learning/evaluation/cross-validation-and-hyperparameter-search.md`).

## Worked example
800 users and 500 items. The true ratings are `3.5 + b_u + b_i + p_u·q_i` with true rank 5, plus Gaussian noise with σ = 0.5. Item popularity is long-tailed, so some items have many ratings and most have few. Each user gives 8 to 200 ratings, and 10 % of each user's ratings are held out for the test. The script compares the global mean, the biases alone, item-kNN (k-nearest neighbours, cosine similarity on residuals) and matrix factorization with biases trained by ALS and by SGD. The core ALS step:

```python
A = np.c_[Q[cols[idx]], np.ones(len(idx))]          # rated items' factors + a column for b_u
y = vals[idx] - gm - bi_[cols[idx]]                  # what p_u . q_i + b_u must explain
x = np.linalg.lstsq(np.r_[A, np.sqrt(lam * len(idx)) * np.eye(k + 1)],
                    np.r_[y, np.zeros(k + 1)], rcond=None)[0]   # ridge regression, solved exactly
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-25, numpy 2.5.5. Two runs gave identical output ✅[^12]:

```text
users 800 items 500 ratings 28,722 sparsity 0.928 noise floor (sigma) 0.500
items: top 10% hold 0.44 of ratings, median item has 31 ratings; median user has 31
model                              train RMSE test RMSE
global mean                             1.126     1.107
oracle (noise-free truth)               0.498     0.502
user + item biases                      0.942     0.963
item-kNN (k=30, cosine, residuals)      0.571     0.768
item pairs with 0 common raters: 0.22, with >= 5: 0.24
== MF with biases, ALS, rank sweep (15 iterations) ==
rank  1 | lambda 0.0 : train 0.828 test 0.912 | lambda 0.05: train 0.831 test 0.900
rank  2 | lambda 0.0 : train 0.722 test 0.877 | lambda 0.05: train 0.726 test 0.837
rank  5 | lambda 0.0 : train 0.419 test 3.161 | lambda 0.05: train 0.436 test 0.611
rank 10 | lambda 0.0 : train 0.319 test 11.652 | lambda 0.05: train 0.363 test 0.654
rank 20 | lambda 0.0 : train 0.181 test 31.669 | lambda 0.05: train 0.286 test 0.679
rank 50 | lambda 0.0 : train 0.004 test 4.772 | lambda 0.05: train 0.237 test 0.671
== regularization sweep at rank 10 (ALS) ==
lambda 0.0  : train 0.319  test 11.652
lambda 0.01 : train 0.310  test 0.785
lambda 0.05 : train 0.363  test 0.654
lambda 0.2  : train 0.619  test 0.726
lambda 1.0  : train 0.989  test 0.993
== SGD vs ALS, rank 5, lambda 0.05: test RMSE as training proceeds ==
  ALS iteration  1: train 0.813  test 0.969
  ALS iteration  2: train 0.627  test 0.858
  ALS iteration  3: train 0.550  test 0.778
  ALS iteration  4: train 0.502  test 0.715
  ALS iteration  5: train 0.452  test 0.635
  SGD epoch  1: train 1.005  test 1.005
  SGD epoch  5: train 0.943  test 0.963
  SGD epoch 10: train 0.909  test 0.946
  SGD epoch 20: train 0.727  test 0.838
  SGD epoch 40: train 0.510  test 0.680
one test prediction (user 0, item 142): mu 3.46 + b_u -0.08 + b_i +0.19 + p.q +0.19 = 3.76; noise-free truth 3.73, observed 4.25
```

<details><summary>Full script (prints the output above)</summary>

```python
# Explicit ratings: biases, item-kNN, and matrix factorization with biases trained by SGD and by ALS
# on a simulated rating matrix whose true rank, biases and noise are known (numpy only).
import numpy as np

rng = np.random.default_rng(0)
U, I, K_TRUE, SIGMA = 800, 500, 5, 0.5
mu = 3.5
b_user, b_item = rng.normal(0, 0.3, U), rng.normal(0, 0.5, I)
P_true, Q_true = rng.normal(0, 0.6, (U, K_TRUE)), rng.normal(0, 0.6, (I, K_TRUE))
true_r = mu + b_user[:, None] + b_item[None, :] + P_true @ Q_true.T      # what each user would rate

pop = 1.0 / np.arange(1, I + 1) ** 0.9                                    # long-tail chance of being rated
pop = rng.permutation(pop / pop.sum())
n_u = np.clip(rng.lognormal(np.log(30), 0.6, U).astype(int), 8, 200)     # long-tail user activity
rows, cols = [], []
for u in range(U):
    items = rng.choice(I, size=n_u[u], replace=False, p=pop)
    rows += [u] * len(items); cols += list(items)
rows, cols = np.array(rows), np.array(cols)
vals = true_r[rows, cols] + rng.normal(0, SIGMA, len(rows))              # observed rating = truth + noise
test = np.zeros(len(rows), bool)                                          # hold out 10 % of each user's ratings
for u in range(U):
    idx = np.flatnonzero(rows == u)
    test[rng.choice(idx, size=max(1, len(idx) // 10), replace=False)] = True
tr, te = ~test, test
cnt = np.bincount(cols, minlength=I)
print(f"users {U} items {I} ratings {len(rows):,} sparsity {1 - len(rows) / (U * I):.3f} "
      f"noise floor (sigma) {SIGMA:.3f}")
print(f"items: top 10% hold {np.sort(cnt)[::-1][:I // 10].sum() / cnt.sum():.2f} of ratings, "
      f"median item has {int(np.median(cnt))} ratings; median user has {int(np.median(n_u))}")

def rmse(pred, m):
    return np.sqrt(np.mean((vals[m] - pred[m]) ** 2))

# Baselines ------------------------------------------------------------------------------------------
gm = vals[tr].mean()
print(f"{'model':<34}{'train RMSE':>11}{'test RMSE':>10}")
print(f"{'global mean':<34}{rmse(np.full(len(vals), gm), tr):>11.3f}{rmse(np.full(len(vals), gm), te):>10.3f}")
bu, bi = np.zeros(U), np.zeros(I)
for _ in range(10):                                                       # ridge-regularized biases, alternating
    bi = np.bincount(cols[tr], vals[tr] - gm - bu[rows[tr]], I) / (np.bincount(cols[tr], minlength=I) + 5)
    bu = np.bincount(rows[tr], vals[tr] - gm - bi[cols[tr]], U) / (np.bincount(rows[tr], minlength=U) + 5)
base = gm + bu[rows] + bi[cols]
print(f"{'oracle (noise-free truth)':<34}{rmse(true_r[rows, cols], tr):>11.3f}{rmse(true_r[rows, cols], te):>10.3f}")
print(f"{'user + item biases':<34}{rmse(base, tr):>11.3f}{rmse(base, te):>10.3f}")

R = np.zeros((U, I)); M = np.zeros((U, I))                                # residual matrix, 0 where unknown
R[rows[tr], cols[tr]] = vals[tr] - base[tr]; M[rows[tr], cols[tr]] = 1
norms = np.sqrt((R ** 2).sum(0)) + 1e-9
S = (R.T @ R) / np.outer(norms, norms)                                    # item-item cosine on residuals
np.fill_diagonal(S, 0)
common = M.T @ M                                                          # users who rated both items
def knn_predict(u, i, k=30):                                               # k most similar items u has rated
    rated = np.flatnonzero(M[u]); sims = S[i, rated]
    top = np.argsort(-np.abs(sims))[:k]
    w = sims[top]
    return gm + bu[u] + bi[i] + (w @ R[u, rated[top]]) / (np.abs(w).sum() + 1e-9)
knn = np.array([knn_predict(u, i) for u, i in zip(rows, cols)])
print(f"{'item-kNN (k=30, cosine, residuals)':<34}{rmse(knn, tr):>11.3f}{rmse(knn, te):>10.3f}")
off = common[np.triu_indices(I, 1)]
print(f"item pairs with 0 common raters: {np.mean(off == 0):.2f}, with >= 5: {np.mean(off >= 5):.2f}")

# Matrix factorization with biases: r_hat = mu + b_u + b_i + p_u . q_i -----------------------------
def als(k, lam, iters=15, trace=False):
    """Each user (item) solves a ridge regression on its own ratings, penalty lam * n_ratings."""
    r_ = np.random.default_rng(1)
    P, Q = r_.normal(0, 0.1, (U, k)), r_.normal(0, 0.1, (I, k))
    bu_, bi_ = np.zeros(U), np.zeros(I)
    by_u = [np.flatnonzero(tr & (rows == u)) for u in range(U)]
    by_i = [np.flatnonzero(tr & (cols == i)) for i in range(I)]
    for it in range(iters):
        for u in range(U):                                                # fix items, solve every user exactly
            idx = by_u[u]; A = np.c_[Q[cols[idx]], np.ones(len(idx))]
            y = vals[idx] - gm - bi_[cols[idx]]
            x = np.linalg.lstsq(np.r_[A, np.sqrt(lam * len(idx)) * np.eye(k + 1)],
                                np.r_[y, np.zeros(k + 1)], rcond=None)[0]
            P[u], bu_[u] = x[:k], x[k]
        for i in range(I):                                                # fix users, solve every item exactly
            idx = by_i[i]
            if len(idx) == 0: continue
            A = np.c_[P[rows[idx]], np.ones(len(idx))]
            y = vals[idx] - gm - bu_[rows[idx]]
            x = np.linalg.lstsq(np.r_[A, np.sqrt(lam * len(idx)) * np.eye(k + 1)],
                                np.r_[y, np.zeros(k + 1)], rcond=None)[0]
            Q[i], bi_[i] = x[:k], x[k]
        pred = gm + bu_[rows] + bi_[cols] + (P[rows] * Q[cols]).sum(1)
        if trace: print(f"  ALS iteration {it + 1:2d}: train {rmse(pred, tr):.3f}  test {rmse(pred, te):.3f}")
    return pred, (P, Q, bu_, bi_)

def sgd(k, lam, lr=0.01, epochs=40, trace_at=()):
    r_ = np.random.default_rng(1)
    P, Q = r_.normal(0, 0.1, (U, k)), r_.normal(0, 0.1, (I, k))
    bu_, bi_ = np.zeros(U), np.zeros(I)
    idx_tr = np.flatnonzero(tr)
    for ep in range(epochs):
        for n in r_.permutation(idx_tr):                                  # one update per observed rating
            u, i = rows[n], cols[n]
            e = vals[n] - (gm + bu_[u] + bi_[i] + P[u] @ Q[i])
            bu_[u] += lr * (e - lam * bu_[u]); bi_[i] += lr * (e - lam * bi_[i])
            P[u], Q[i] = P[u] + lr * (e * Q[i] - lam * P[u]), Q[i] + lr * (e * P[u] - lam * Q[i])
        if ep + 1 in trace_at:
            pred = gm + bu_[rows] + bi_[cols] + (P[rows] * Q[cols]).sum(1)
            print(f"  SGD epoch {ep + 1:2d}: train {rmse(pred, tr):.3f}  test {rmse(pred, te):.3f}")
    return gm + bu_[rows] + bi_[cols] + (P[rows] * Q[cols]).sum(1)

print("== MF with biases, ALS, rank sweep (15 iterations) ==")
for k in (1, 2, 5, 10, 20, 50):
    line = f"rank {k:2d}"
    for lam in (0.0, 0.05):
        p, _ = als(k, lam)
        line += f" | lambda {lam:<4}: train {rmse(p, tr):.3f} test {rmse(p, te):.3f}"
    print(line)
print("== regularization sweep at rank 10 (ALS) ==")
for lam in (0.0, 0.01, 0.05, 0.2, 1.0):
    p, _ = als(10, lam)
    print(f"lambda {lam:<5}: train {rmse(p, tr):.3f}  test {rmse(p, te):.3f}")
print("== SGD vs ALS, rank 5, lambda 0.05: test RMSE as training proceeds ==")
p_als, (P, Q, bu_a, bi_a) = als(5, 0.05, iters=5, trace=True)
p_sgd = sgd(5, 0.05, trace_at=(1, 5, 10, 20, 40))
n = np.flatnonzero(te)[0]; u, i = rows[n], cols[n]
print(f"one test prediction (user {u}, item {i}): mu {gm:.2f} + b_u {bu_a[u]:+.2f} + b_i {bi_a[i]:+.2f} "
      f"+ p.q {P[u] @ Q[i]:+.2f} = {p_als[n]:.2f}; noise-free truth {true_r[u, i]:.2f}, observed {vals[n]:.2f}")
```

</details>

Reading it:
- **Baselines:** the global mean scores 1.107. The biases alone reach 0.963, because generous users and good items explain part of the spread. Item-kNN reaches 0.768, using similar items the user has rated.
- **Matrix factorization:** rank 5 with `λ = 0.05` reaches 0.611, the best result, against an oracle floor of 0.502. The ranks around it score worse (0.837 at rank 2, 0.654 at rank 10).
- **No regularization:** with `λ = 0`, the train error falls as the rank grows (0.828 down to 0.004), but the test error explodes: 3.16 at rank 5 and 31.7 at rank 20. At rank 50 it is 4.77, lower than at rank 20: most users' and items' systems are then underdetermined (a median of 31 ratings against 51 unknowns), and lstsq picks the smallest-norm exact fit. That is the interpolation-threshold peak described in `machine-learning/learning-theory/double-descent.md`, and it is still far worse than a regularized model.
- **The λ sweep at rank 10** is U-shaped: 0.785 at `λ = 0.01`, 0.654 at 0.05, 0.726 at 0.2, and 0.993 at 1.0, where the model is shrunk to below the bias-only baseline.
- **SGD vs ALS:** ALS solves each user and item exactly per pass and gets to 0.635 in 5 passes. SGD with `η = 0.01` is still improving at 40 epochs (0.680).

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Binary feedback fitted on observed cells only, or empty cells treated as zeros | An all-ones matrix minimizes the first loss; near-zero predictions come out of the second | Empty cells are unknown, not zero: both models generalize poorly ✅[^4] |
| Two items with no common raters | Their similarity is undefined or 0; kNN has nothing to average | Lab: 22 % of item pairs ✅[^12]; memory-based CF struggles with sparsity ✅[^1] |
| Rank larger than a user's number of ratings, `λ = 0` | Exact fit of the training ratings, wild test predictions | Underdetermined least squares; lab test RMSE 31.7 at rank 20 ✅[^12]; lstsq returns the minimum-norm solution ✅[^11] |
| Same `λ` in SGD and in plain ALS | Different amounts of regularization | SGD penalizes per rating, which is frequency-weighted ✅[^8]; Spark scales the ALS penalty by rating counts to match ✅[^9] |
| New user or item, never seen in training | No factor vector, no prediction | Spark returns NaN (not a number) by default and offers `coldStartStrategy="drop"` for evaluation ✅[^9]; for a new item that already has a few interactions, solve one ALS half-step against the fixed user factors ✅[^6] |
| Ratings are missing because of taste, not at random | Training on the observed ratings only is biased toward what users chose to rate | Non-observed pairs mix real negatives with missing values ✅[^13] |
| Features beyond IDs (identifiers), such as age, country or genre | Hard to include in plain MF | A generalization of WALS augments the matrix with feature blocks ✅[^6]; feature-based neural models are in `retrieval-and-ranking-pipelines.md` |
| Random train/test split of the ratings | Some test users or items are missing from training | Spark notes this happens with simple random splits ✅[^9]; the lab holds out 10 % per user so that every user stays in training ✅[^12] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Item-based or user-based kNN | Simple to implement and to interpret ("because you rated X") ✅[^7] | Struggles with sparse, large data ✅[^1]; lab 0.768 vs 0.611 for MF ✅[^12] |
| MF trained by SGD | Other loss functions possible ✅[^4]; one cheap update per rating | Slower convergence ✅[^4]; a learning rate to tune; lab 0.680 after 40 epochs ✅[^12] |
| MF trained by ALS | Exact per-row solves, faster convergence than SGD, parallel ✅[^4] | Squared loss only ✅[^4]; a `k × k` solve per row, `O(k³)` ✅[^10] |
| Higher rank `k` | Can represent more tastes | Overfits without `λ` (lab) ✅[^12] |

## Takeaways
- Always report the biases-only baseline next to a factorization model. The biases alone took the lab from 1.107 to 0.963 RMSE. [rule-candidate]
- Tune the rank and the regularization together on held-out ratings, and never train factorization without a penalty. [rule-candidate]
- When you compare SGD and ALS results, check how each one scales `λ`. The same number can mean different penalties.
- Know your noise floor: an RMSE close to the rating noise is as good as it gets, and the remaining differences are small.
- Ratings say how much a user liked what they chose to rate. Ranking what to show next is a different problem, covered in `implicit-feedback-and-ranking.md`.

## Verification status
- Verified: 65 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [Overview of Recommender Systems (Dive into Deep Learning, 21.1)](https://d2l.ai/chapter_recommender-systems/recsys-intro.html) — Zhang, Lipton, Li, Smola, living. Backs: memory-based vs model-based CF, user- and item-based CF, sparsity limits of memory-based CF, explicit vs implicit feedback, content-based methods. [^1]
- [The MovieLens Dataset (Dive into Deep Learning, 21.2)](https://d2l.ai/chapter_recommender-systems/movielens.html) — Zhang, Lipton, Li, Smola, living. Backs: sparsity definition, MovieLens 100K sizes and 93.695 % sparsity. [^2]
- [Matrix Factorization (Dive into Deep Learning, 21.3)](https://d2l.ai/chapter_recommender-systems/mf.html) — Zhang, Lipton, Li, Smola, living. Backs: the factorization `PQᵀ`, user and item biases, the regularized objective, the meaning of `λ`, RMSE, the Netflix Prize history. [^3]
- [Matrix factorization (Recommendation Systems course)](https://developers.google.com/machine-learning/recommendation/collaborative/matrix?hl=en) — Google for Developers, living. Backs: observed-only and all-zeros objectives fail, `O(nm)` vs `O((n+m)d)`, not jointly convex, WALS alternation and convergence, SGD vs WALS comparison. [^4]
- [Collaborative filtering (Recommendation Systems course)](https://developers.google.com/machine-learning/recommendation/collaborative/basics?hl=en) — Google for Developers, living. Backs: learning user vectors with item vectors fixed (and the reverse), similar users ending up close. [^5]
- [Collaborative filtering advantages & disadvantages (Recommendation Systems course)](https://developers.google.com/machine-learning/recommendation/collaborative/summary?hl=en) — Google for Developers, living. Backs: cold start and projection in WALS, side features via a generalized WALS. [^6]
- [How Algorithmic Confounding in Recommendation Systems Increases Homogeneity and Decreases Utility](https://ar5iv.labs.arxiv.org/html/1710.11214) — Chaney, Stewart, Engelhardt, 2018 (ar5iv HTML of arXiv:1710.11214). Backs: neighbourhood methods, the similarity measures used and the top-K neighbours. [^7]
- [Revisiting the Performance of iALS on Item Recommendation Benchmarks](https://ar5iv.labs.arxiv.org/html/2110.14037) — Rendle, Krichene, Zhang, Koren, 2021 (ar5iv HTML of arXiv:2110.14037). Backs: the SGD update rules for matrix factorization, SGD's implicit frequency-weighted regularization. [^8]
- [Collaborative Filtering (Spark 4.3.0 MLlib guide)](https://spark.apache.org/docs/latest/ml-collaborative-filtering.html) — Apache Spark, living (4.3.0 when read). Backs: the penalty scaled by rating counts, cold-start NaN predictions and `coldStartStrategy`, unseen users or items after random splits. [^9]
- [Fast Matrix Factorization for Online Recommendation with Implicit Feedback](https://ar5iv.labs.arxiv.org/html/1708.05024) — He, Zhang, Kan, Chua, 2016 (ar5iv HTML of arXiv:1708.05024). Backs: the closed-form ALS update as ridge regression, the `O(K³)` solve, folding biases into the factor vectors. [^10]
- [numpy.linalg.lstsq](https://numpy.org/doc/2.5/reference/generated/numpy.linalg.lstsq.html) — NumPy, 2026 (2.5 manual). Backs: under-determined systems, the minimum-norm solution. [^11]
- `machine-learning/lab-setup.md` — the lab where the rating-matrix simulation, baselines, item-kNN, ALS and SGD sweeps ran on 2026-11-25. [^12]
- [Personalized Ranking for Recommender Systems (Dive into Deep Learning, 21.5)](https://d2l.ai/chapter_recommender-systems/ranking.html) — Zhang, Lipton, Li, Smola, living. Backs: ratings missing not at random, non-observed pairs mixing negatives and missing values. [^13]

## Related
- `machine-learning/recommender-systems/implicit-feedback-and-ranking.md` — clicks instead of ratings, confidence-weighted ALS, BPR and ranked-list evaluation.
- `machine-learning/recommender-systems/retrieval-and-ranking-pipelines.md` — how the factor vectors are served and what happens to new items.
- `machine-learning/foundations/regularization.md` — the L2 (ridge) penalty that `λ` applies.
- `machine-learning/supervised-learning/linear-regression.md` — least squares, the problem each ALS half-step solves.
- `machine-learning/supervised-learning/k-nearest-neighbors.md` — the neighbour idea behind item-kNN.
- `machine-learning/learning-theory/double-descent.md` — why the unregularized error peaks near "unknowns ≈ ratings".
- `machine-learning/deep-learning/embeddings-and-self-supervised-learning.md` — factor vectors as learned embeddings.
