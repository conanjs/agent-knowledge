---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/unsupervised-learning
status: verified
applies-to: ["scikit-learn 1.9.1"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, active-learning, pool-based, uncertainty-sampling, margin-sampling, entropy, query-by-committee, bald, core-set, k-center, batch-active-learning, cold-start, sampling-bias, labeling-budget, scikit-learn]
---

# Active learning: choosing which examples to label

## Summary
**TL;DR:** Active learning (AL) spends a labeling budget on the examples the current model expects to learn most from. In the pool-based loop the model is trained on the labeled set, scores every unlabeled example, an oracle (a human annotator) labels the top-scoring ones, and the loop repeats. Uncertainty sampling scores by how unsure the model is (least confident, margin, entropy); query by committee scores by how much several models disagree; BALD (Bayesian active learning by disagreement) keeps only the disagreement that more data could remove. Picking the top k of a batch by score gives redundant, near-identical picks, so batches need a diversity rule such as the core-set (k-center) selection. The labeled set that results is deliberately not a random sample, is tied to the model that chose it, and at very small budgets can be worse than random; the only fair test is a learning curve against random sampling at the same label counts, averaged over seeds.
**Use this when:** labels are expensive and unlabeled data is plentiful, you pick a query strategy or batch size, an active learning result looks too good or too bad, or you must decide whether a dataset collected actively can train the next model.
**Not this doc:** using the unlabeled rows themselves for training (self-training, label spreading) → `machine-learning/unsupervised-learning/semi-supervised-learning.md`; the same "where to ask next" loop for hyperparameters → `machine-learning/evaluation/bayesian-optimization.md`; exploration against exploitation in general → `machine-learning/reinforcement-learning/multi-armed-bandits.md`.

## Problem
A model trained on randomly chosen labels pays for many easy examples it would have got right anyway. Letting the model choose sounds like a free gain, but three things go wrong. Early on, a model trained on a handful of labels does not know what it does not know: in the lab, 10 random starting labels missed 3.6 of the 10 digit classes on average, and entropy sampling stayed below random sampling up to and including 100 labels (0.741 against 0.780 test accuracy at 50 labels) ✅[^10]. A batch of the top-scoring examples can be nearly the same example many times: in a pool holding 5 near-copies of each image, top-k entropy spent 180 labels on 75.2 distinct images and reached 0.784 accuracy against 0.911 for random labels ✅[^10]. And the gains do not transfer reliably: across text classification tasks, Lowell et al. found that a standard AL strategy beat random (i.i.d., independent and identically distributed) sampling in only 60.9 % of their data points, and that training a different model on an actively acquired set beat i.i.d. data in only 37.5 % ✅[^5].

## Mental model
**Analogy:** a student who pays a tutor per question. Asking about exercises she already gets right wastes money (random labeling). Asking only about the topic that confuses her most, ten times with slightly different numbers, wastes it too (a redundant batch). Asking well means mixing "where am I unsure" with "where have I not looked yet". And the list of questions she asked describes her own weak spots, not the exam: a classmate studying from her question list would be badly prepared (the actively collected set is biased and tied to its model).

**Artifact:** the three uncertainty scores on three predicted class distributions, and the BALD score of two two-member committees; printed by the full script in the Worked example; lab run (`machine-learning/lab-setup.md`), 2026-11-25, scikit-learn 1.9.1 ✅[^10]:

```text
== the scores on three predicted distributions over 3 classes ==
p=[0.5, 0.49, 0.01]  least confident 0.50  margin 0.01  entropy 0.742
p=[0.4, 0.3, 0.3]  least confident 0.60  margin 0.10  entropy 1.089
p=[0.9, 0.05, 0.05]  least confident 0.10  margin 0.85  entropy 0.394
committee [[0.9, 0.1], [0.1, 0.9]]: entropy of the average 0.693  BALD = that minus mean member entropy 0.368
committee [[0.5, 0.5], [0.5, 0.5]]: entropy of the average 0.693  BALD = that minus mean member entropy 0.000
```

The measures disagree: margin asks first about the two-way tie (margin 0.01), least confident and entropy about the three-way spread (0.60, 1.089). The two committees have the same averaged prediction, but only the one whose members confidently contradict each other gets a BALD score.

## How it works
### The pool-based loop
AL has three settings: membership query synthesis (the learner may ask about any input, even one it generates), stream-based selective sampling (decide for each arriving example whether to ask), and pool-based sampling (rank a whole pool of unlabeled examples and ask about the best) ✅[^1]. The pool-based loop ✅[^1] ✅[^5]:
1. **Warm start:** label a few examples drawn at random; training the first model on a modest i.i.d. labeled set is the common convention ✅[^5].
2. **Train** the model on the labeled set `L`.
3. **Score** every example of the unlabeled pool `U` with the query strategy.
4. **Query:** the oracle labels the top-scoring examples (top-k, or sampled in proportion to the scores ✅[^5]); move them from `U` to `L`.
5. **Repeat** from step 2 until the label budget is used or a stopping condition holds ✅[^1].

### Uncertainty sampling
With `P(c | x)` the model's predicted probability of class `c` for pool example `x` ✅[^7] ✅[^1]:
- **Least confident:** `LC(x) = 1 − max_c P(c | x)`; query the largest. `[0.40, 0.30, 0.30]` scores `1 − 0.40 = 0.60`. Gal et al. call the same quantity the variation ratio ✅[^4].
- **Margin:** `M(x) = P(c₁ | x) − P(c₂ | x)`, the gap between the two most probable classes `c₁` and `c₂`; query the smallest. `[0.50, 0.49, 0.01]` scores `0.01`.
- **Entropy:** `H(x) = −Σ_c P(c | x) · ln P(c | x)`; query the largest. `[0.40, 0.30, 0.30]` scores `−(0.40 ln 0.40 + 2 × 0.30 ln 0.30) = 1.089`, close to the 3-class maximum `ln 3 = 1.099`.

All three trust the model's probabilities. Deep networks' softmax outputs tend to be overconfident, and the survey cites a softmax-confidence strategy doing worse than random sampling ✅[^1].

### Query by committee (QBC)
Train `m` models (a committee; the lab bags them, each member fitted on a bootstrap resample of `L`) and query where their predictions disagree ✅[^8]. **Vote entropy** is the entropy of the vote shares: three members voting `[0, 1, 2]` give shares `[1/3, 1/3, 1/3]` and the maximum, `ln 3 = 1.099` ✅[^8]. **Consensus entropy** is the entropy of the members' averaged probabilities, and **max disagreement** is the largest KL (Kullback–Leibler) divergence of any member from that average ✅[^8]. Houlsby et al. describe the original QBC as sampling committee members from the version space and querying the most balanced vote; a vote discards each member's confidence ✅[^3].

### BALD (information-based selection), in outline
BALD queries the `x` whose label would tell the most about the model parameters `θ`, the mutual information between the label and the parameters, which Houlsby et al. rewrite in output space ✅[^3]:

```text
BALD(x) = H[ y | x, D ]  −  E_θ~p(θ|D) [ H[ y | x, θ ] ]
          entropy of the       average entropy of the prediction
          averaged prediction  of one parameter setting
```

`D` is the labeled data and `p(θ | D)` the posterior over parameters. The score is high where the model is unsure on average but individual parameter settings are confident and disagree ✅[^3]. With `T` posterior samples (committee members, or `T` stochastic forward passes with Monte Carlo (MC) dropout ✅[^4]), both terms are averages over the samples: the artifact's `[0.9, 0.1]` and `[0.1, 0.9]` give `0.693 − 0.325 = 0.368`, while two members both saying `[0.5, 0.5]` give `0` ✅[^10]. This is what separates BALD from plain entropy: noise in the labels themselves keeps every member unsure, so it raises the second term too and BALD does not chase it, whereas maximum entropy sampling cannot tell model uncertainty from observation noise ✅[^3]. With a sampled posterior, BALD is query by committee with a probabilistic measure of disagreement ✅[^3]. On MNIST (Modified National Institute of Standards and Technology digits) from 20 balanced starting labels, Gal et al. found BALD, variation ratios and maximum entropy needed far fewer acquisitions than random sampling to reach 5 % and 10 % test error ✅[^4].

### Batches and diversity: the core-set approach
Deep models are retrained in rounds, and one extra label barely moves a network trained by local optimization, so labels are requested in large batches; Sener and Savarese argue that the batch's correlated picks are why uncertainty heuristics failed for CNNs (convolutional neural networks) in their experiments ✅[^2]. They recast AL as core-set selection: choose a subset such that a model trained on it is competitive on the whole pool, which their bound turns into covering the pool with small balls around the labeled points ✅[^2].
1. **k-center greedy** (their Algorithm 1): repeatedly add the pool point farthest from its nearest labeled or already-chosen point, `u = argmax_i min_j Δ(x_i, x_j)`, where `Δ` is a distance (they use the Euclidean distance between activations of the last fully connected layer) ✅[^2]. Example on a line with pool points 1, 5 and 9 and one labeled point at 0: the farthest is 9; after it, 5 is 4 from its nearest chosen point and 1 only 1, so 5 comes next.
2. **Guarantee:** the exact k-center problem is NP-hard (NP: nondeterministic polynomial time; no polynomial-time algorithm for it is known), and the greedy solution's covering radius is at most twice the optimum ✅[^2].
3. **Robust version:** the paper names robustness as a weakness of k-center; a mixed integer program refines the greedy answer and may leave up to a fixed number of outliers uncovered ✅[^2].
4. **Cost:** the method needs a large distance matrix over the pool, which becomes expensive on large pools ✅[^1].

Hybrid strategies combine uncertainty with diversity, since uncertainty alone tends to bias the sample and diversity alone may label many uninformative points ✅[^1]; one simple form filters the pool by uncertainty and then picks for diversity ✅[^2]. modAL's ranked batch mode scores `α · (1 − Φ(x, L)) + (1 − α) · U(x)`, with `Φ` the similarity to the labeled set, `U` the uncertainty and `α = |U_pool| / (|U_pool| + |L|)`, re-scoring after each pick ✅[^9]: with 1,000 unlabeled and 100 labeled rows, `α = 1000/1100 = 0.91`, so early batches are chosen mostly for diversity. BatchBALD scores a whole batch by the joint mutual information of its labels with the parameters ✅[^1].

Lab run (`machine-learning/lab-setup.md`), 2026-11-25, scikit-learn 1.9.1, 20 random labels then 4 batches of 40, 10 seeds, two runs identical; the second pool repeats each of the 1,257 pool images 5 times with Gaussian pixel noise (standard deviation 0.05 on a 0–1 scale) ✅[^10]:

```text
plain pool                 random                 labels 180  distinct images 180.0  test accuracy 0.912
plain pool                 entropy top-k          labels 180  distinct images 180.0  test accuracy 0.911
plain pool                 k-center (core-set)    labels 180  distinct images 180.0  test accuracy 0.941
plain pool                 entropy then k-center  labels 180  distinct images 180.0  test accuracy 0.945
5 near-copies per image    random                 labels 180  distinct images 170.8  test accuracy 0.911
5 near-copies per image    entropy top-k          labels 180  distinct images  75.2  test accuracy 0.784
5 near-copies per image    k-center (core-set)    labels 180  distinct images 179.9  test accuracy 0.938
5 near-copies per image    entropy then k-center  labels 180  distinct images 179.9  test accuracy 0.926
```

Near-copies of an uncertain image are almost equally uncertain, so top-k entropy labels them together: 75.2 distinct images out of 180 labels. k-center takes the point farthest from everything chosen, so a near-copy of a chosen image is almost never next; it labels 179.9 distinct images and loses almost nothing to the copies (0.938 against 0.941 on the plain pool). Even on the plain pool, batches of 40 by entropy alone did no better than random (0.911 against 0.912).

<details><summary>Full script (prints the output above)</summary>

```python
# Batch selection when the pool holds near-duplicates: top-k entropy against k-center greedy (core-set)
# and an entropy shortlist followed by k-center; digits, logistic regression, 10 seeds.
import numpy as np
from sklearn.datasets import load_digits
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split

X, y = load_digits(return_X_y=True)
X = X / 16.0
START, BATCH, ROUNDS, COPIES = 20, 40, 4, 5      # 20 random labels, then 4 batches of 40

def entropy_scores(model, Xp):
    P = model.predict_proba(Xp)
    return -(P * np.log(np.clip(P, 1e-12, 1))).sum(axis=1)

def k_center_greedy(Xc, Xl, b):                  # Sener & Savarese Algorithm 1 on candidate rows Xc
    d = ((Xc ** 2).sum(1)[:, None] + (Xl ** 2).sum(1)[None, :] - 2 * Xc @ Xl.T).min(axis=1)  # to nearest labeled
    chosen = []
    for _ in range(b):
        u = int(np.argmax(d))                    # farthest point from everything chosen so far
        chosen.append(u)
        d = np.minimum(d, ((Xc - Xc[u]) ** 2).sum(-1))
    return np.array(chosen)

def select(name, model, Xl, Xr, rng):
    if name == "random":
        return rng.choice(len(Xr), BATCH, replace=False)
    if name == "entropy top-k":
        return np.argsort(-entropy_scores(model, Xr))[:BATCH]
    if name == "k-center (core-set)":
        return k_center_greedy(Xr, Xl, BATCH)
    short = np.argsort(-entropy_scores(model, Xr))[:10 * BATCH]      # "entropy then k-center"
    return short[k_center_greedy(Xr[short], Xl, BATCH)]

STRATS = ["random", "entropy top-k", "k-center (core-set)", "entropy then k-center"]
for pool_kind in ["plain pool", f"{COPIES} near-copies per image"]:
    for s in STRATS:
        accs, distinct = [], []
        for seed in range(10):
            Xp, Xt, yp, yt = train_test_split(X, y, test_size=0.3, stratify=y, random_state=seed)
            orig = np.arange(len(yp))
            if pool_kind != "plain pool":        # every pool image appears COPIES times, slightly noisy
                noise = np.random.default_rng(seed).normal(0, 0.05, (COPIES * len(yp), X.shape[1]))
                Xp, yp, orig = np.tile(Xp, (COPIES, 1)) + noise, np.tile(yp, COPIES), np.tile(orig, COPIES)
            rng = np.random.default_rng(2000 + seed)
            labeled = list(rng.choice(len(yp), START, replace=False))
            for r in range(ROUNDS):
                model = LogisticRegression(max_iter=2000).fit(Xp[labeled], yp[labeled])
                rest = np.setdiff1d(np.arange(len(yp)), labeled)
                labeled += list(rest[select(s, model, Xp[labeled], Xp[rest], rng)])
            model = LogisticRegression(max_iter=2000).fit(Xp[labeled], yp[labeled])
            accs.append((model.predict(Xt) == yt).mean())
            distinct.append(len(np.unique(orig[labeled])))
        print(f"{pool_kind:<26} {s:<22} labels {len(labeled)}  distinct images {np.mean(distinct):5.1f}"
              f"  test accuracy {np.mean(accs):.3f}")
```

</details>

### Cold start and sampling bias
- **Cold start:** with very few labels, random selection outperforms most query strategies; Hacohen et al. call this the low-budget regime and argue that typical (dense-region) examples should be queried at low budgets and uncertain, atypical ones at high budgets ✅[^6]. Their TypiClust measures typicality as the inverse mean distance to the K nearest neighbours in a self-supervised embedding (neighbours at distances 0.5, 1.0 and 1.5 give `1 / 1.0 = 1.0`) and clusters the pool so the typical picks stay diverse ✅[^6]. For BALD, Houlsby et al. saw poor early picks when a model fitted to little data overfits, and suggest choosing the first few points at random ✅[^3].
- **Sampling bias:** uncertainty sampling alone often produces a labeled set that does not represent the unlabeled data's distribution ✅[^1]; actively chosen training data violates the i.i.d. assumption, so training and test data no longer follow the same distribution ✅[^5]. The total variation distance `TV = ½ · Σ_c |p_L(c) − p(c)|` measures the class part of the drift, with `p_L(c)` the share of class `c` among the labels and `p(c)` its share in the data: shares of 0.17 for one digit and 0.05 for another, instead of 0.10 each, add `½ · (0.07 + 0.05) = 0.06`. Distribution shift between training and deployment data in general: `machine-learning/ml-systems/data-drift-and-monitoring.md`.
- **Coupling to the model:** acquisition functions depend on the model being trained, so the dataset is tied to it; since labeled data often outlives models, a successor model trained on it often did worse than on an equally large i.i.d. sample in Lowell et al.'s text classification experiments, while named-entity recognition fared better ✅[^5].

### How to evaluate a strategy
1. **Simulate on labeled data:** hide the labels of a labeled dataset to form the pool, reveal them as the strategy queries, and score a held-out test set that is not part of the pool ✅[^5].
2. **Compare learning curves** with random sampling at the same number of labels, averaged over several runs with different starting sets (Lowell et al. averaged ten) ✅[^5]. Report the random baseline you ran yourself: reported random-sampling baselines differ between studies, by 13 % on CIFAR-10 (Canadian Institute for Advanced Research, 10 classes) at 20 % of the labels in the survey's example ✅[^1].
3. **Accept the limit:** in production there is no way to check afterwards whether AL beat random without collecting a large i.i.d. labeled sample, which defeats the purpose, and an early lead does not guarantee a later one ✅[^5].

## Worked example
Pool-based AL on the scikit-learn digits (8×8 images, 10 classes): 10 seeds, each with a stratified 70/30 split into a pool of 1,257 images and a test set of 540, 10 random starting labels, then rounds of 5 queries up to 200 labels; logistic regression with scikit-learn defaults except `max_iter=2000` is retrained every round. The committee strategies use 5 members fitted on bootstrap resamples. Core lines:

```python
model = fit(Xp_all[labeled], yp_all[labeled])
sc = scores(s, model, Xp_all[labeled], yp_all[labeled], Xp_all[rest], rng)
labeled += list(rest[np.argsort(-sc)[:STEP]])           # the 5 top-scoring pool images
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-25, scikit-learn 1.9.1, two runs identical; the first 6 lines are the Mental model artifact ✅[^10]:

```text
== the scores on three predicted distributions over 3 classes ==
…
test accuracy, mean over 10 seeds (pool 1257 images, test 540), labels: [10, 20, 30, 50, 100, 200]
random            0.436 0.559 0.659 0.780 0.884 0.921
least confident   0.436 0.568 0.677 0.797 0.900 0.957
margin            0.436 0.622 0.745 0.853 0.926 0.956
entropy           0.436 0.531 0.636 0.741 0.882 0.941
QBC vote entropy  0.436 0.583 0.727 0.849 0.909 0.949
BALD (committee)  0.436 0.458 0.470 0.564 0.697 0.856
== cold start: the 10 random starting labels miss 3.6 of 10 classes on average ==
random            first-round top 50 from unlabeled classes 0.39 | labels until every class is labeled: median 30, still missing at 200: 0
least confident   first-round top 50 from unlabeled classes 0.60 | labels until every class is labeled: median 38, still missing at 200: 0
margin            first-round top 50 from unlabeled classes 0.49 | labels until every class is labeled: median 20, still missing at 200: 0
entropy           first-round top 50 from unlabeled classes 0.58 | labels until every class is labeled: median 45, still missing at 200: 0
QBC vote entropy  first-round top 50 from unlabeled classes 0.44 | labels until every class is labeled: median 25, still missing at 200: 0
BALD (committee)  first-round top 50 from unlabeled classes 0.07 | labels until every class is labeled: median 138, still missing at 200: 1
== sampling bias: class shares of the 200 labels (10 seeds pooled) vs all digits' ~0.10 each ==
random            TV 0.041  min share 0.085 (digit 9)  max share 0.118 (digit 5)
least confident   TV 0.125  min share 0.049 (digit 0)  max share 0.160 (digit 8)
margin            TV 0.146  min share 0.052 (digit 6)  max share 0.164 (digit 8)
entropy           TV 0.135  min share 0.052 (digit 0)  max share 0.171 (digit 8)
QBC vote entropy  TV 0.104  min share 0.055 (digit 0)  max share 0.142 (digit 8)
BALD (committee)  TV 0.092  min share 0.064 (digit 0)  max share 0.155 (digit 1)
```

<details><summary>Full script (prints the output above)</summary>

```python
# Pool-based active learning on the digits data with logistic regression: random sampling against
# least-confident, margin, entropy, query-by-committee and a committee BALD score; 10 seeds.
import numpy as np
from sklearn.datasets import load_digits
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split

X, y = load_digits(return_X_y=True)
X = X / 16.0                                     # pixel values 0..16 -> 0..1
K = 10                                           # classes
START, STEP, END = 10, 5, 200                    # first random labels, labels per round, budget
REPORT = [10, 20, 30, 50, 100, 200]
SEEDS = range(10)

def fit(Xl, yl):
    return LogisticRegression(max_iter=2000).fit(Xl, yl)

def proba_all(model, Xp):                        # columns for all 10 classes, 0 for unseen ones
    P = np.zeros((len(Xp), K))
    P[:, model.classes_] = model.predict_proba(Xp)
    return P

def entropy(P):
    return -(P * np.log(np.clip(P, 1e-12, 1))).sum(axis=1)

def committee(Xl, yl, rng, m=5):                 # bagging: each member sees a bootstrap resample
    members = []
    while len(members) < m:
        idx = rng.integers(0, len(yl), len(yl))
        if len(np.unique(yl[idx])) > 1:
            members.append(fit(Xl[idx], yl[idx]))
    return members

def scores(name, model, Xl, yl, Xp, rng):        # higher score = ask for this label first
    if name == "random":
        return rng.random(len(Xp))
    if name in ("QBC vote entropy", "BALD (committee)"):
        Ps = np.stack([proba_all(c, Xp) for c in committee(Xl, yl, rng)])
        if name == "QBC vote entropy":
            votes = np.stack([np.bincount(row, minlength=K) for row in Ps.argmax(axis=2).T]) / len(Ps)
            return entropy(votes) + 1e-9 * rng.random(len(Xp))      # random tie-break
        return entropy(Ps.mean(axis=0)) - entropy(Ps.reshape(-1, K)).reshape(len(Ps), -1).mean(axis=0)
    P = proba_all(model, Xp)
    top2 = np.sort(P, axis=1)[:, -2:]
    if name == "least confident":
        return 1 - top2[:, 1]
    if name == "margin":
        return -(top2[:, 1] - top2[:, 0])
    return entropy(P)                            # "entropy"

print("== the scores on three predicted distributions over 3 classes ==")
for p in ([0.50, 0.49, 0.01], [0.40, 0.30, 0.30], [0.90, 0.05, 0.05]):
    q = np.sort(p)
    print(f"p={p}  least confident {1 - q[-1]:.2f}  margin {q[-1] - q[-2]:.2f}  entropy {entropy(np.array([p]))[0]:.3f}")
for members in ([[0.9, 0.1], [0.1, 0.9]], [[0.5, 0.5], [0.5, 0.5]]):
    Pm = np.array(members)
    print(f"committee {members}: entropy of the average {entropy(Pm.mean(0, keepdims=True))[0]:.3f}  "
          f"BALD = that minus mean member entropy {entropy(Pm.mean(0, keepdims=True))[0] - entropy(Pm).mean():.3f}")

STRATS = ["random", "least confident", "margin", "entropy", "QBC vote entropy", "BALD (committee)"]
acc = {s: np.zeros((len(SEEDS), len(REPORT))) for s in STRATS}
counts200 = {s: np.zeros(K) for s in STRATS}       # class counts of the 200 labels, summed over seeds
all_seen = {s: [] for s in STRATS}                 # labels needed until every class has one
missing0 = []
top50_new = {s: [] for s in STRATS}                # first round: share of the 50 top scores from unlabeled classes
for si, seed in enumerate(SEEDS):
    Xp_all, Xt, yp_all, yt = train_test_split(X, y, test_size=0.3, stratify=y, random_state=seed)
    start = np.random.default_rng(seed).choice(len(yp_all), START, replace=False)
    missing0.append(K - len(np.unique(yp_all[start])))
    for s in STRATS:
        rng = np.random.default_rng(1000 + seed)
        labeled = list(start)
        while True:
            model = fit(Xp_all[labeled], yp_all[labeled])
            n = len(labeled)
            if n in REPORT:
                acc[s][si, REPORT.index(n)] = (model.predict(Xt) == yt).mean()
            if len(all_seen[s]) == si and len(np.unique(yp_all[labeled])) == K:
                all_seen[s].append(n)
            if n >= END:
                counts200[s] += np.bincount(yp_all[labeled], minlength=K)
                if len(all_seen[s]) == si:
                    all_seen[s].append(np.inf)
                break
            rest = np.setdiff1d(np.arange(len(yp_all)), labeled)
            sc = scores(s, model, Xp_all[labeled], yp_all[labeled], Xp_all[rest], rng)
            if n == START:
                top50_new[s].append((~np.isin(yp_all[rest[np.argsort(-sc)[:50]]], yp_all[start])).mean())
            labeled += list(rest[np.argsort(-sc)[:STEP]])           # top-STEP pool points

print("test accuracy, mean over 10 seeds (pool 1257 images, test 540), labels:", REPORT)
for s in STRATS:
    print(f"{s:<17}", " ".join(f"{v:.3f}" for v in acc[s].mean(axis=0)))
print(f"== cold start: the 10 random starting labels miss {np.mean(missing0):.1f} of 10 classes on average ==")
for s in STRATS:
    v = np.array(all_seen[s])
    print(f"{s:<17} first-round top 50 from unlabeled classes {np.mean(top50_new[s]):.2f} | "
          f"labels until every class is labeled: median {np.median(v):.0f}, still missing at 200: {np.isinf(v).sum()}")
print("== sampling bias: class shares of the 200 labels (10 seeds pooled) vs all digits' ~0.10 each ==")
for s in STRATS:
    d = counts200[s] / counts200[s].sum()
    tv = 0.5 * np.abs(d - np.bincount(y, minlength=K) / len(y)).sum()       # total variation distance
    print(f"{s:<17} TV {tv:.3f}  min share {d.min():.3f} (digit {d.argmin()})  max share {d.max():.3f} (digit {d.argmax()})")
```

</details>

Reading it:
- **Learning curves.** Margin sampling leads at every budget up to 100 labels (0.853 against random's 0.780 at 50). Least confident and QBC also beat random throughout. Entropy sampling trails random up to and including 100 labels (0.882 against 0.884 there) and only pulls ahead at 200 (0.941 against 0.921): the cold-start pattern.
- **Cold start.** The starting sets miss 3.6 classes on average. Entropy and least confident draw more of their first top-50 candidates from those classes than random (0.58 and 0.60 against 0.39) yet need longer to label every class (median 45 and 38 labels against 30): drawing many candidates from unlabeled classes is not the same as covering all of them. The bootstrap-committee BALD score almost never looks at unlabeled classes (0.07). BALD subtracts the members' own average entropy, so an image on which every member is unsure in the same way scores 0 however unsure they are (the artifact's `[0.5, 0.5]` committee); this committee BALD needed a median 138 labels to cover every class and ended last (0.856). That is a result for a crude 5-member bootstrap posterior starting from 10 labels, not a verdict on BALD.
- **Sampling bias.** Random labels keep every class between 0.085 and 0.118 (TV 0.041). Least confident, margin, entropy and QBC all over-sample digit 8 (0.142 to 0.171) and under-sample digit 0 or 6 (0.049 to 0.055), so their TV, 0.104–0.146, is 2.5 to 3.6 times random's: the labeled set describes what confused this model, not the data.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Top-k batch from a pool with near-duplicates | Labels go to copies of the same few examples (lab: 75.2 distinct images of 180, accuracy 0.784 against 0.911 random) | Copies share a score; picks within a batch are correlated ✅[^2]; lab ✅[^10] |
| Large batches on a plain pool | Top-k entropy no better than random (lab: 0.911 against 0.912 with batches of 40); k-center 0.941 | Batch correlation ✅[^2]; lab ✅[^10] |
| Very small budget, classes missing from the seed set | Uncertainty can trail random (lab: entropy 0.741 against 0.780 at 50 labels) | Low-budget regime: random beats most strategies ✅[^6]; lab ✅[^10] |
| BALD on a model fitted to a few points | Poor early queries | Overfitting with little data; start with a few random points ✅[^3] |
| Overconfident softmax probabilities | Uncertainty scores mislead; a softmax-confidence strategy did worse than random in a cited study | ✅[^1]; see `machine-learning/evaluation/probability-calibration.md` |
| Noisy labels in one region | Maximum entropy keeps querying it; BALD does not | Entropy mixes observation noise with model uncertainty; BALD subtracts the noise term ✅[^3] |
| k-center on a pool with outliers | Greedy k-center always takes the point farthest from the labeled set | Algorithm 1; the paper calls robustness a weakness and its robust version lets a fixed number of outliers stay uncovered ✅[^2] |
| k-center on a very large pool | Slow or out of memory | Needs a large pool-wide distance matrix ✅[^1] |
| Actively labeled set reused for a different model | Often worse than an i.i.d. set of the same size (37.5 % of transfer points beat i.i.d.) | The data is tied to the acquisition model ✅[^5] |
| Small design choices | Results change markedly (word2vec against GloVe embeddings changed Lowell et al.'s results) | AL is brittle ✅[^5] |
| Comparing with numbers from another paper | Random baselines differ between studies (13 % in the survey's CIFAR-10 example) | ✅[^1]; run your own baseline |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Random (i.i.d.) labels | Training data follows the data distribution and is not tied to the model that chose it ✅[^5] | Spends labels on easy examples (lab: 0.921 at 200 labels against 0.957 for least confident) ✅[^10] |
| Uncertainty sampling (least confident, margin, entropy) | Simple and cheap ✅[^1]; lab: margin 0.853 against 0.780 at 50 labels ✅[^10] | Sampling bias ✅[^1]; redundant batches ✅[^2]; relies on calibrated probabilities ✅[^1] |
| Query by committee | Measures disagreement between several hypotheses ✅[^8]; lab: 0.849 against 0.780 at 50 labels ✅[^10] | `m` model fits per round (lab: 5); a plain vote discards the members' confidence ✅[^3] |
| BALD | Separates model uncertainty from label noise ✅[^3] | Needs posterior samples (MC dropout or a committee) ✅[^4]; a crude committee failed in the lab ✅[^10] |
| Core-set (k-center) | Diverse batches; unaffected by near-duplicates in the lab (0.938) ✅[^10] | Pool-wide distances ✅[^1]; does not use uncertainty ✅[^2] |
| Uncertainty shortlist, then k-center | Informative and diverse (lab best on the plain pool, 0.945) ✅[^10] | One more setting, the shortlist size (lab: 10 × the batch) ✅[^10] |

## Takeaways
- Always run random sampling with the same budget, model and seeds next to any active learning strategy, and plot both learning curves. [rule-candidate]
- Never take the top k of a batch by uncertainty alone; add a diversity step such as k-center over an uncertainty shortlist. [rule-candidate]
- Start from random labels and switch to uncertainty sampling only once every class has a few labels; uncertainty strategies are weakest when the model is newest.
- Expect the labeled set to over-represent the classes the model found hard; keep a random i.i.d. sample for evaluation and for training future models.
- Deduplicate the pool before active learning; near-copies multiply the cost of a redundant batch.

## Verification status
- Verified: 79 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [A Survey of Deep Active Learning](https://arxiv.org/html/2009.00236v2) — Ren et al., 2021. Backs: membership query, stream-based and pool-based settings, the pool-based cycle and stopping, margin and entropy definitions, overconfident softmax worse than random, sampling bias of uncertainty-only selection and the cost of diversity-only selection, core-set distance-matrix cost, BatchBALD, differing random baselines (13 % on CIFAR-10). [^1]
- [Active Learning for Convolutional Neural Networks: A Core-Set Approach](https://arxiv.org/html/1708.00489v4) — Sener & Savarese, 2018. Backs: batch acquisition and correlated picks, core-set formulation, k-center greedy (Algorithm 1), NP-hardness and the 2× guarantee, robust version with outliers, distance on last fully connected layer activations, filter-by-uncertainty-then-diversity related work, no uncertainty used. [^2]
- [Bayesian Active Learning for Classification and Preference Learning](https://arxiv.org/html/1112.5745v1) — Houlsby, Huszár, Ghahramani, Lengyel, 2011. Backs: BALD objective in output space and its interpretation, model vs observation uncertainty and maximum entropy sampling, QBC as sampled committee with vote, BALD with a sampled posterior, poor early picks and random first points. [^3]
- [Deep Bayesian Active Learning with Image Data](https://arxiv.org/html/1703.02910v1) — Gal, Islam, Ghahramani, 2017. Backs: variation ratio, MC dropout estimator of BALD, MNIST results from 20 balanced labels. [^4]
- [Practical Obstacles to Deploying Active Learning](https://arxiv.org/html/1807.04801v3) — Lowell, Lipton, Wallace, 2019. Backs: warm start, top-k or proportional selection, non-i.i.d. training data, coupling to the acquisition model, 60.9 % and 37.5 % results, NER more favorable, brittleness (word2vec vs GloVe), simulation protocol with ten runs, no way to validate in production. [^5]
- [Active Learning on a Budget: Opposite Strategies Suit High and Low Budgets](https://arxiv.org/html/2202.02794v2) — Hacohen, Dekel, Weinshall, 2022. Backs: low-budget (cold start) regime where random wins, typical vs atypical examples by budget, TypiClust typicality and clustering. [^6]
- [Uncertainty sampling (modAL docs)](https://modal-python.readthedocs.io/en/latest/content/query_strategies/uncertainty_sampling.html) — modAL developers, living. Backs: classification uncertainty, margin and entropy definitions and which end to query. [^7]
- [Disagreement sampling (modAL docs)](https://modal-python.readthedocs.io/en/latest/content/query_strategies/Disagreement-sampling.html) — modAL developers, living. Backs: committees, vote entropy, consensus entropy, max disagreement by KL divergence. [^8]
- [Ranked batch-mode sampling (modAL docs)](https://modal-python.readthedocs.io/en/latest/content/query_strategies/ranked_batch_mode.html) — modAL developers, living. Backs: the ranked batch-mode score, its `α`, and re-scoring after each pick. [^9]
- `machine-learning/lab-setup.md` — the lab where the uncertainty-score artifact, the learning curves, the cold-start and sampling-bias counts, and the near-duplicate batch run ran on 2026-11-25. [^10]

## Related
- `machine-learning/unsupervised-learning/semi-supervised-learning.md` — use the unlabeled pool for training too; often combined with active learning.
- `machine-learning/evaluation/bayesian-optimization.md` — the same score-then-query loop, for hyperparameters.
- `machine-learning/reinforcement-learning/multi-armed-bandits.md` — exploration against exploitation in its simplest form.
- `machine-learning/evaluation/probability-calibration.md` — whether the probabilities behind uncertainty scores can be trusted.
- `machine-learning/supervised-learning/logistic-regression.md` — the model used in the lab runs.
- `machine-learning/ml-systems/data-drift-and-monitoring.md` — training data that does not match the deployment distribution.
- `machine-learning/deep-learning/embeddings-and-self-supervised-learning.md` — the embeddings that typicality and k-center distances are computed in.
- `machine-learning/deep-learning/uncertainty-in-deep-learning.md` — uncertainty estimates that query strategies rely on.
- `machine-learning/foundations/information-theory.md` — entropy and mutual information, the quantities behind entropy sampling and BALD.
