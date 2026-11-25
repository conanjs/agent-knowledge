---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/recommender-systems
status: verified
applies-to: ["any"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, recommender-systems, feedback-loops, algorithmic-confounding, popularity-bias, homogenization, exposure, gini, jaccard, exploration, offline-evaluation]
---

# Feedback loops and popularity bias in recommenders

## Summary
**TL;DR:** A recommender is retrained on clicks, but users can only click what the previous model showed them. The log therefore mixes what users like with what the model chose to show, and the next model learns both. Chaney et al. call this algorithmic confounding. In their simulations, retraining again and again homogenized user behaviour beyond what the best possible recommendations need, without a matching gain in utility, and users with lower utility tended to be more homogenized. The loop also amplified each recommender's effect on how item consumption was distributed, measured by the Gini coefficient. In the lab's 30-round simulation, matrix factorization retrained on its own clicks narrowed exposure from 189 to 88 distinct items and kept utility near 0.2. The same model trained on a randomly collected log reached 0.516. Counter it by logging what was shown, keeping some randomized or explored traffic, weighting, and tracking exposure next to accuracy.
**Use this when:** you retrain a recommender on its own interaction logs, see exposure concentrate on fewer items release after release, compare recommenders offline on data one of them collected, or decide how much randomized or exploration traffic to keep.
**Not this doc:** hidden feedback loops as system-level technical debt (the book-recommender and two-stock-model examples) → `machine-learning/ml-systems/hidden-technical-debt.md`; the popularity bias of in-batch negatives, a bias of the training loss rather than of the log, and the retrieval pipeline that produces the shown lists → `machine-learning/recommender-systems/retrieval-and-ranking-pipelines.md`; the implicit ALS (alternating least squares) model used in the lab → `machine-learning/recommender-systems/implicit-feedback-and-ranking.md`; exploration algorithms → `machine-learning/reinforcement-learning/multi-armed-bandits.md`; confounders in general → `machine-learning/causal-inference/causal-graphs-and-confounding.md`.

## Problem
Live recommenders are retrained regularly on new data that the recommender itself influenced, which forms a feedback loop ✅[^1]. From such a log it is hard to tell which interactions come from users' true preferences and which were caused by the recommendations ✅[^1]. Held-out accuracy, which many researchers and practitioners still focus on, cannot capture the full effects of the loop ✅[^1]. Worse, when held-out data were collected under one recommender, the evaluation favours recommenders similar to it ✅[^1]. So a team can retrain, see accuracy hold, and not notice that users are being steered into a narrower set of items. In the lab, the same matrix factorization (MF) model reached a mean true click chance of 0.206 when retrained on the clicks its own lists produced, against 0.516 when trained on a log collected by random exposure ✅[^2].

## Mental model
**Analogy:** a restaurant whose menu lists only last month's best-sellers. A dish that is not on the menu cannot be ordered, so it can never become a best-seller, and next month's menu is the same list again. The customers' tastes have not changed; the menu has narrowed what they can reveal. The Gini coefficient measures how unequally the orders spread over the dishes.

**Artifact:** the same MF model retrained each round, once on the clicks its own lists produced and once on a log collected by random exposure, next to an oracle that knows the true click chances. Columns: exposure Gini, distinct items shown, mean true click chance of the shown lists (utility). Printed by the full script in the Worked example; lab run (`machine-learning/lab-setup.md`), 2026-11-25, numpy 2.5.5 ✅[^2]:

```text
policy               | round  1: gini items utility | round  5: gini items utility | round 30: gini items utility
oracle               |           0.670   263   0.626 |           0.670   263   0.626 |           0.670   263   0.626
MF retrained         |           0.772   189   0.188 |           0.837    96   0.203 |           0.835    88   0.206
MF on random log     |           0.772   189   0.188 |           0.688   248   0.242 |           0.508   339   0.516
```

Both MF rows start identical. Only the data differ afterwards, and only the model fed with randomly collected data moves towards the oracle's utility.

## How it works
### 1. Why the log is confounded
```text
                     user preferences (true taste)
        │                                                     │
        ▼                                                     ▼
past interactions ──► model ──► recommendations ──► current interactions ──► next training log
```
1. **Preferences drive both sides.** User preferences influence what is recommended (through past interactions) and what is clicked now, so they act as confounders. Confounding happens when the platform models user behaviour without accounting for its recommendations ✅[^1].
2. **The target is the selection itself.** With implicit feedback (views, reads, clicks) the observations are the selections, and the quantity to estimate is the probability that a user selects an item. Chaney et al. therefore want to predict that selection, not correct it away ✅[^1].
3. **Rank shapes the choice.** In Chaney et al.'s interaction model, the utility of user `u` for item `i` is `V_ui = P_ui + Q_ui`: `P` is the part the user knows and `Q` the part the user does not; the platform knows neither ✅[^1]. In their simulations the known share averages 0.98 ✅[^1]. At each time step each user picks exactly one item, the one that maximizes `f(rank) · P_ui`, with `f(n) = n^(−0.8)` approximating the observed effect of rank on click-through rate ✅[^1]. Worked numbers: `f(1) = 1`, `f(2) = 0.574`, `f(10) = 0.158`. An item at rank 10 needs `1 / 0.158 ≈ 6.3` times the known utility of the rank-1 item to be chosen over it, so the ranking itself decides much of what gets clicked.

### 2. What the loop did in Chaney et al.'s simulations
1. **Setup:** six recommenders (popularity, content filtering, MF, social filtering, random, and an ideal one that ranks by each user's true utility); communities of 100 users, ten new items per time interval, ten random seeds per setting ✅[^1]. Single training: 50 start-up iterations with new items only, one training, then 50 iterations of confounded behaviour. Repeated training: 10 start-up iterations, then retraining every iteration for the remaining 90 on all previous data ✅[^1].
2. **Homogenization with repeated training:** after a single training, users became slightly more homogenized and then returned to the ideal level. With repeated training, every recommender except random homogenized behaviour beyond what ideal utility needs, and the effect grew with the number of cycles without a matching rise in utility ✅[^1].
3. **Population level:** with users paired at random, popularity homogenized users the most, then MF and social filtering about equally, and content filtering least, but still more than ideal ✅[^1].
4. **Unequal losses:** for every algorithm, users with lower utility generally had higher homogenization with their nearest neighbour ✅[^1]. Users whose tastes a low-dimensional representation captures badly may be hit hardest ✅[^1].
5. **Item consumption:** the loop amplified the recommender's effect on the distribution of item consumption, independently of homogenization. MF and content filtering homogenized users about equally, but MF made consumption more unequal ✅[^1].
6. **How to read it:** some homogenization is expected, because the models learn patterns from the data ✅[^1]. The problem is over-exploitation: pushing users to behave more alike than their own preferences call for. Chaney et al. suggest that the "tyranny of majority" and niche echo chambers may both be forms of it ✅[^1].

### 3. Measuring it: Jaccard homogenization and the Gini coefficient
- **Homogenization:** pair each user with the user most similar to them in the recommender's own representation (cosine similarity of the user vectors `θ`). Then compare their item sets with the Jaccard index `J_uv = |D_u ∩ D_v| / |D_u ∪ D_v|`, where `D_u` is the set of items user `u` has interacted with. The result is compared with the same pair under ideal recommendations ✅[^1]. Example: `D_u = {1, 2, 3, 4}` and `D_v = {3, 4, 5}` share 2 of 5 distinct items, so `J = 2/5 = 0.4`.
- **Gini coefficient of consumption or exposure:** 0 when all items are consumed equally, approaching 1 at maximal inequality ✅[^1]. Chaney et al. weight each item by its rank in relative popularity ✅[^1]. The lab uses the equivalent sorted-count form: sort the per-item counts `x₁ ≤ … ≤ x_n`, then `G = Σ_i (2i − n − 1)·x_i / (n·Σ_i x_i)`, where `n` is the number of items and `i` the position in sorted order. Example: counts `[0, 0, 1, 3]` give `(−3·0 − 1·0 + 1·1 + 3·3) / (4·4) = 10/16 = 0.625`. With all exposure on one item of `n`, `G = (n−1)/n`, so 0.998 for 400 items ✅[^2].
- **Distinct items shown:** a cruder count, printed next to the Gini in the lab, of how many items reached anyone at all ✅[^2].

### 4. What helps
1. **Weighting.** Chaney et al. point to weighting techniques for offline evaluation. In a preliminary exploration, weighting in the repeated-training case both raised utility and reduced homogenization ✅[^1].
2. **Log the recommender, not only the behaviour.** At a minimum, log what the deployed recommender did alongside the observed behaviour, so that its influence can later be separated from true preference ✅[^1]. Formal causal-inference methods in system design would likely reduce the effects, but need more study ✅[^1].
3. **Explore.** Recommendation is naturally connected to the explore/exploit trade-off: recommend what the current model rates highest, or items with a low predicted probability to learn more about the user ✅[^1]. Bandit algorithms are in `machine-learning/reinforcement-learning/multi-armed-bandits.md`.
4. **Judge more than accuracy.** Chaney et al. ask practitioners to also assess diversity, serendipity, novelty and coverage ✅[^1].

## Worked example
600 users and 400 items. The true click probability is `σ(θ_u·φ_i − 2)`, where `σ(z) = 1/(1+e^(−z))` is the logistic sigmoid and `θ_u`, `φ_i` are 6-dimensional taste and item vectors. Example: a user with `θ_u·φ_i = 0` clicks with `σ(−2) = 0.119`. In round 0 every user is shown 10 random items. In each of 30 rounds, the policy shows 10 items per user, users click with their true probability, and the click log grows. Items are not filtered by past clicks, so an item can be shown and clicked again. Five policies: an oracle that ranks by the true probability; popularity (total clicks so far); MF (implicit ALS, 8 factors) retrained every round on the whole log; the same MF with 2 of the 10 slots filled at random; and a control MF trained on a log collected by random exposure, whose own lists are scored but not logged. Exposure Gini, the number of distinct items shown, and the mean true click probability of the shown lists (utility) are printed for rounds 1, 5 and 30. Lab run (`machine-learning/lab-setup.md`), 2026-11-25, numpy 2.5.5. Two runs gave identical output ✅[^2]:

```text
mean click chance 0.166; best item per user 0.748
gini check: equal 0.000, all on one item 0.998 = (n-1)/n
policy               | round  1: gini items utility | round  5: gini items utility | round 30: gini items utility
oracle               |           0.670   263   0.626 |           0.670   263   0.626 |           0.670   263   0.626
popularity           |           0.970    14   0.172 |           0.975    10   0.178 |           0.975    10   0.178
MF retrained         |           0.772   189   0.188 |           0.837    96   0.203 |           0.835    88   0.206
MF + 2 random slots  |           0.659   390   0.183 |           0.734   383   0.207 |           0.724   385   0.214
MF on random log     |           0.772   189   0.188 |           0.688   248   0.242 |           0.508   339   0.516
```

<details><summary>Full script (prints the output above)</summary>

```python
# Feedback loop: a recommender retrained each round on the clicks its own recommendations produced.
# Exposure inequality (Gini) and true utility per round, for popularity, matrix factorization (MF),
# MF with 2 random exploration slots, an oracle that knows the true click probabilities, and a control
# MF trained on a log collected by random exposure (its users see random items; we report its lists).
import numpy as np

rng = np.random.default_rng(0)
U, I, D, K, ROUNDS = 600, 400, 6, 10, 30
theta, phi = rng.normal(0, 0.7, (U, D)), rng.normal(0, 0.7, (I, D))
p_click = 1 / (1 + np.exp(-(theta @ phi.T - 2.0)))                   # true chance u clicks i when shown
print(f"mean click chance {p_click.mean():.3f}; best item per user {p_click.max(1).mean():.3f}")

def gini(x):                                                          # 0 = equal exposure, -> 1 = one item gets all
    x = np.sort(x); n = len(x); r = np.arange(1, n + 1)
    return np.sum((2 * r - n - 1) * x) / (n * x.sum())
print(f"gini check: equal {gini(np.ones(I)):.3f}, all on one item {gini(np.eye(I)[0]):.3f} = (n-1)/n")

def mf_scores(C, k=8, lam=5.0, alpha=5.0, iters=6):                  # implicit ALS on the click log
    r_ = np.random.default_rng(1)
    X, Y = r_.normal(0, 0.1, (U, k)), r_.normal(0, 0.1, (I, k))
    def solve(F, Cm):
        G = F.T @ F; out = np.empty((Cm.shape[0], k))
        for r in range(Cm.shape[0]):
            S = np.flatnonzero(Cm[r]); Fs = F[S]; c = 1 + alpha * Cm[r, S]
            out[r] = np.linalg.solve(G + (Fs.T * (c - 1)) @ Fs + lam * np.eye(k), Fs.T @ c)
        return out
    for _ in range(iters):
        X = solve(Y, C); Y = solve(X, C.T)
    return X @ Y.T

def run(policy, seed=1):
    r = np.random.default_rng(seed)
    clicks = np.zeros((U, I))
    shown0 = np.array([r.choice(I, K, replace=False) for _ in range(U)])  # round 0: random exposure
    clicks[np.arange(U)[:, None], shown0] += r.random((U, K)) < p_click[np.arange(U)[:, None], shown0]
    out = []
    for t in range(1, ROUNDS + 1):
        if policy == "popularity":
            S = np.tile(clicks.sum(0), (U, 1)) + 1e-6 * r.random((U, I))
        elif policy == "oracle":
            S = p_click.copy()
        else:
            S = mf_scores(clicks)
        shown = np.argsort(-S, 1)[:, :K]
        if policy == "MF + 2 random slots":
            shown[:, K - 2:] = np.array([r.choice(np.setdiff1d(np.arange(I), shown[u, :K - 2]), 2, replace=False)
                                         for u in range(U)])
        logged = shown
        if policy == "MF on random log":                                # control: log comes from random exposure
            logged = np.array([r.choice(I, K, replace=False) for _ in range(U)])
        clicked = r.random((U, K)) < p_click[np.arange(U)[:, None], logged]
        clicks[np.arange(U)[:, None], logged] += clicked                # only shown items can be clicked
        exposure = np.bincount(shown.ravel(), minlength=I)
        out.append((gini(exposure), (exposure > 0).sum(), p_click[np.arange(U)[:, None], shown].mean()))
    return out

print(f"{'policy':<20}" + "".join(f" | round {t:2d}: gini items utility" for t in (1, 5, 30)))
for policy in ("oracle", "popularity", "MF retrained", "MF + 2 random slots", "MF on random log"):
    res = run(policy)
    cells = (res[t - 1] for t in (1, 5, 30))
    print(f"{policy:<20}" + "".join(f" |           {g:.3f} {n:5d} {v:7.3f}" for g, n, v in cells))
```

</details>

Reading it:
- **Popularity policy:** from round 1 it shows almost the same 10 items to everyone (Gini 0.970, 14 distinct items). Utility is 0.172, barely above the 0.166 average click chance.
- **MF retrained on its own clicks:** the number of items shown falls from 189 to 88 and the Gini rises from 0.772 to 0.835, while utility stays near 0.2. The oracle reaches 0.626 with a Gini of 0.670, so users' true tastes call for less concentrated exposure than MF ends up with.
- **The same MF on a randomly collected log** (same number of impressions, users see random items) improves to utility 0.516 with Gini 0.508 by round 30. In this simulation, the gap between the two MF rows comes from the data alone: the same model, but one log was shaped by the model's own choices.
- **Two random slots out of 10** keep about 385 items in circulation, and utility ends slightly higher than without exploration (0.214 vs 0.206). Too little exploration, too slowly, to undo the bias in 30 rounds here.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Retraining only on logs of your own recommendations | Exposure concentrates; utility does not follow | Algorithmic confounding, in Chaney et al.'s simulations ✅[^1]; lab Gini 0.835 vs 0.508 with a random log ✅[^2] |
| Offline accuracy on held-out data from the same loop | Favours models similar to the one that collected the data; the loop's other effects stay hidden | Held-out accuracy cannot capture the full effects of the loop ✅[^1] |
| A public dataset from a site that recommends with collaborative filtering (MovieLens) | Collaborative-filtering models will likely score better on it | Confounded held-out data favour the collecting algorithm ✅[^1] |
| One training instead of repeated retraining | Mild homogenization that fades back to the ideal level | One cycle of the loop, in Chaney et al.'s single-training case ✅[^1] |
| Popularity recommender | The same few items for everyone; most global homogenization | Represents all users the same way ✅[^1]; lab 14 distinct items, utility 0.172 vs 0.166 random ✅[^2] |
| Two recommenders with the same homogenization | Different inequality of item consumption | MF and content filtering homogenized alike, MF was more unequal ✅[^1] |
| Users the model represents badly | Lower utility, more homogenized with their neighbour | Observed for every algorithm in the simulations ✅[^1] |
| Too little exploration | Items stay in circulation, but utility barely moves | Lab: 2 random slots kept ~385 items; utility 0.214 vs 0.206 after 30 rounds ✅[^2] |
| Utility valued per collection, not per item | Effects would likely be larger than simulated | Chaney et al. assumed fixed per-pair utility; a set of similar items is probably less useful than a diverse one ✅[^1] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Exploration slots | Keeps items in circulation (lab ~385 vs 88 items) ✅[^2] | Shows items the model rates lower today; lab utility rose only from 0.206 to 0.214 in 30 rounds ✅[^2] |
| Randomized exposure for the training log | The same MF reached utility 0.516 at Gini 0.508 by round 30 (lab) ✅[^2] | The users who produce that log see random items: average click chance 0.166 in this simulation ✅[^2] |
| Weighting in training and offline evaluation | Raised utility and reduced homogenization in a preliminary exploration ✅[^1] | Not yet fully explored; Chaney et al. leave it for future work ✅[^1] |
| Logging the deployed recommender with each interaction | Lets its influence be separated from true preference later ✅[^1] | More to store per event |

## Takeaways
- Log what was shown, not only what was clicked, and keep some randomized or explored traffic. Without it, every retrain learns from the previous model's choices. [rule-candidate]
- Track exposure concentration (Gini, distinct items shown) next to accuracy. In the lab, MF retrained on its own clicks kept utility near 0.2 while the number of distinct items shown fell from 189 to 88.
- Do not rank candidate recommenders offline on a log that one of them collected: the held-out data favour the model that resembles the collector. Use randomized traffic or weighting for that comparison.
- Expect the effect to grow with every retraining cycle and possibly to fall hardest on the users the model represents worst, so look at per-user utility, not only the average.

## Verification status
- Verified: 49 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [How Algorithmic Confounding in Recommendation Systems Increases Homogeneity and Decreases Utility](https://ar5iv.labs.arxiv.org/html/1710.11214) — Chaney, Stewart, Engelhardt, 2018 (ar5iv HTML of arXiv:1710.11214). Backs: the feedback loop and confounding, the implicit-feedback estimand, the interaction model (`V = P + Q`, known share 0.98, one item per step, `f(n) = n^(−0.8)`), the simulation setup, homogenization with single and repeated training, global homogenization by algorithm, unequal utility loss, Gini of item consumption, MF vs content filtering, over-exploitation, Jaccard pairing, weighting, logging the recommender, causal inference, held-out accuracy limits and bias, MovieLens, explore/exploit connection, diversity and coverage objectives, fixed per-pair utility. [^1]
- `machine-learning/lab-setup.md` — the lab where the 30-round feedback-loop simulation (oracle, popularity, MF retrained, MF with random slots, MF on a random log) ran on 2026-11-25. [^2]

## Related
- `machine-learning/ml-systems/hidden-technical-debt.md` — feedback loops as system-level debt, with the general loop diagram.
- `machine-learning/recommender-systems/retrieval-and-ranking-pipelines.md` — the pipeline whose shown lists become the next log, and the separate popularity bias of in-batch negatives.
- `machine-learning/recommender-systems/implicit-feedback-and-ranking.md` — implicit ALS, the MF model in the simulation, and the popularity baseline.
- `machine-learning/reinforcement-learning/multi-armed-bandits.md` — exploration policies that keep collecting information about uncertain items.
- `machine-learning/causal-inference/causal-graphs-and-confounding.md` — confounders and why conditioning on the right variables matters.
- `machine-learning/ml-systems/data-drift-and-monitoring.md` — monitoring what the model serves over time.
- `machine-learning/recommender-systems/learning-to-rank.md` — inverse propensity scoring for position-biased clicks.
