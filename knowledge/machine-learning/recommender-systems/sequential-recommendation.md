---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/recommender-systems
status: verified
applies-to: ["any", "PyTorch 2.15.0 (lab)"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, recommender-systems, sequential-recommendation, session-based-recommendation, next-item-prediction, markov-chain, gru4rec, sasrec, bert4rec, cloze, sampled-metrics, replicability]
---

# Sequential recommendation: predicting the next item

## Summary
**TL;DR:** A sequential recommender ranks items by how likely each is to be the user's next interaction, given the order of what they did before. A first-order Markov chain looks only at the last item and is hard to beat on sparse data. GRU4Rec runs a GRU (gated recurrent unit) over a session. SASRec (self-attentive sequential recommendation) runs causal self-attention over the history and predicts the sequence shifted by one. BERT4Rec (BERT, Bidirectional Encoder Representations from Transformers, for recommendation) uses bidirectional attention, trained by hiding random items and recovering them (the Cloze task), and at test time appends a `[mask]` to the end. Their evaluation is the trap. The SASRec and BERT4Rec papers ranked the held-out item against 100 sampled items, and sampled metrics can reverse model order. In 134 published comparisons BERT4Rec beat SASRec only 64 % of the time. The replicability study behind that count thinks underfitted BERT4Rec runs likely explain it: on MovieLens-1M the original code's default configuration needed up to 30× more training to reach the published numbers.
**Use this when:** you recommend from click streams, sessions or purchase histories where order matters; you choose between a Markov chain, GRU4Rec, SASRec and BERT4Rec; or you read or run a leave-last-out benchmark.
**Not this doc:** order-free collaborative filtering → `machine-learning/recommender-systems/collaborative-filtering-and-matrix-factorization.md`; implicit feedback, BPR (Bayesian personalized ranking) and the mathematics of sampled metrics → `machine-learning/recommender-systems/implicit-feedback-and-ranking.md`; GRU and LSTM (long short-term memory) mechanics → `machine-learning/deep-learning/recurrent-networks.md`; self-attention and masks → `machine-learning/transformers/attention-and-the-transformer.md`; NDCG (normalized discounted cumulative gain) and recall definitions → `machine-learning/evaluation/metrics-catalog.md`.

## Problem
Matrix factorization treats a user's history as an unordered set. Many sites cannot even build that set: small shops and news sites often see only short anonymous sessions. There, factor models are hard to apply, and the usual item-to-item method uses only the last click ✅[^1]. The input space grows exponentially with the number of past actions used as context, so modelling more than the last step must be done compactly ✅[^2]. Then comes evaluation. The same two models, SASRec and BERT4Rec, won and lost against each other across 40 peer-reviewed papers. Implementations of one model differed 3× in NDCG@10 on one dataset ✅[^4]. In the lab, a BERT4Rec-style model looked best of all learned models under 100 sampled negatives (recall@10 0.987), yet trailed the GRU and SASRec-style models under full ranking (0.607 against 0.681–0.685) ✅[^5].

## Mental model
**Analogy:** a shop assistant watching a customer fill a basket. The Markov chain looks only at the item just picked up ("camera, so a memory card"). GRU4Rec keeps a running mental note, updated after each item. SASRec rereads the whole basket every time and weights the items that matter now. BERT4Rec was trained by covering random items in old baskets and guessing them from what lay on both sides, then asked to guess the item after the last one. Sampled evaluation is the assistant's boss testing them with the real next item hidden among 100 random products, most of which are obviously wrong.

**Artifact:** three models on simulated users, scored with full ranking over all 300 items and against 100 sampled negatives (R@10 is recall@10, CE cross-entropy, ep epochs); printed by the full script in the Worked example; lab run (`machine-learning/lab-setup.md`), 2026-11-25, PyTorch 2.15.0 ✅[^5]:

```text
first-order Markov chain        full: R@10 0.655 NDCG@10 0.495 | sampled uniform: R@10 0.796 | sampled by popularity: R@10 0.748
SASRec-style, softmax CE, 20 ep full: R@10 0.681 NDCG@10 0.488 | sampled uniform: R@10 0.885 | sampled by popularity: R@10 0.863
BERT4Rec-style, Cloze, 80 ep    full: R@10 0.607 NDCG@10 0.326 | sampled uniform: R@10 0.987 | sampled by popularity: R@10 0.995
```

## How it works
### The task and the split
1. **Task:** given a user's sequence `i₁, …, i_t`, return `K` items ranked by their probability of being `i_{t+1}` ✅[^4].
2. **Leave-last-out split:** SASRec keeps each user's most recent action for testing, the second most recent for validation and the rest for training. At test time the input holds the training and validation actions ✅[^2]. BERT4Rec uses the same split ✅[^3]. SASRec's preprocessing dropped users and items with fewer than 5 actions ✅[^2].
3. **Session split:** GRU4Rec assigns whole sessions to training or testing, never splitting one mid-session, and tests on the following day's sessions ✅[^1]. Splitting by time is the general rule against temporal leakage (`machine-learning/evaluation/data-leakage.md`).

### Markov-chain baselines
1. **Markov assumption:** the next action depends only on the last one (first order) or the last few (higher order) ✅[^2]. Estimate `P(j | i) = count(i → j) / count(i → ·)`: if item 7 was followed 40 times, 30 of them by item 8, then `P(8 | 7) = 0.75`.
2. **Factorized variants:** FMC (factorized Markov chain) factorizes the item-to-item transition matrix. FPMC (factorized personalized Markov chain) adds a matrix-factorization term for long-term taste ✅[^2].
3. **Where it wins:** SASRec's authors found Markov-chain methods best on extremely sparse data and RNNs (recurrent neural networks) better on denser data ✅[^2]. Higher-order chains do not scale, because the state space grows with every remembered step ✅[^1].

### GRU4Rec
1. **Model:** the input is the current item as a one-hot vector, a GRU layer updates the session state with `h_t = (1 − z_t) ⊙ h_{t−1} + z_t ⊙ ĥ_t` (update gate `z_t`, candidate `ĥ_t`), and the output scores every item as the next one ✅[^1]. The gates are explained in `machine-learning/deep-learning/recurrent-networks.md`.
2. **Session-parallel mini-batches:** sessions vary from 2 events to hundreds, so each mini-batch holds the current event of several sessions side by side, rather than fixed windows ✅[^1].
3. **Negatives from the batch:** scoring all items at every step is too slow. The other examples' target items in the mini-batch serve as negatives, which samples them in proportion to popularity ✅[^1].
4. **Ranking losses:** BPR (Bayesian personalized ranking) and TOP1, a regularized approximation of the target's relative rank, worked best. Cross-entropy was numerically unstable in most runs: 10 of 100 random configurations were stable on RSC15 (the RecSys Challenge 2015 click data) ✅[^1].
5. **Result:** the best baseline was item-KNN (item-based k-nearest neighbours), with recall@20 of 0.5065 on RSC15. With TOP1 and 1,000 hidden units, GRU4Rec reached 0.6206 (+22.5 %), and its MRR@20 (mean reciprocal rank: the true item at rank 4 counts `1/4 = 0.25`, beyond rank 20 it counts 0) was 31.5 % higher ✅[^1].

### SASRec (self-attentive sequential recommendation)
1. **Input:** item embeddings plus a learnable position embedding, because attention alone ignores order ✅[^2]. The history is truncated or padded to a fixed length `n`: 200 for MovieLens-1M and 50 for the sparser datasets ✅[^2].
2. **Causality:** attention links from position `i` to later positions `j > i` are forbidden, so position `t` sees only the first `t` items ✅[^2].
3. **Prediction:** relevance `r_{i,t} = F_t · M_i`, the output at position `t` times the item embedding of item `i`. One item embedding is shared between input and output ✅[^2].
4. **Loss:** binary cross-entropy (BCE) at every position, the true next item against one randomly drawn negative per time step, `−[log σ(r_pos) + log(1 − σ(r_neg))]` ✅[^2]. Example: `r_pos = 2`, `r_neg = −1` give `0.127 + 0.313 = 0.440`.
5. **Behaviour:** it attends to long-range dependencies on dense datasets and to recent items on sparse ones. It ran over ten times faster than RNN- and CNN-based (convolutional) models on GPUs (graphics processing units), since attention needs no step-by-step loop ✅[^2].

### BERT4Rec
1. **Bidirectional attention:** every position may attend to items on both sides. Trained naively on next-item prediction, that leaks the target, because each output could simply copy the next input ✅[^4].
2. **Cloze task:** replace a proportion `ρ` of the items with `[mask]` and predict the original items from their left and right context. The loss is the mean negative log-likelihood over the masked items ✅[^3]. Masking `k` of `n` items gives up to `C(n, k)` training samples per sequence, against `n` for next-item training ✅[^3]. `C(n, k)` counts the ways to choose `k` of `n`: masking 2 of 10 items gives 45.
3. **Test time:** the Cloze objective does not match the final task, so a `[mask]` is appended to the end and the next item is read from its output. Training also adds samples in which only the last item is masked ✅[^3].
4. **Relation to SASRec:** its authors describe SASRec as a left-to-right, single-head, causally masked version of BERT4Rec ✅[^3].

### Evaluation pitfalls and replicability
1. **Sampled negatives:** SASRec ranked the true item against 100 randomly sampled negatives ✅[^2]. BERT4Rec drew its 100 negatives among items the user had not touched, in proportion to popularity. They note this sampling is why the popularity baseline scored so low ✅[^3]. Sampled metrics are not always consistent with full ranking and can give incorrect model comparisons ✅[^4]. One example from their Steam results: the implementation of BERT4Rec in RecBole (a recommendation library) looked 33 % worse than MF-BPR (matrix factorization trained with BPR) by popularity-sampled recall@10 (0.2325 vs 0.3466), and 87 % better by full recall@10 (0.0744 vs 0.0398) ✅[^4]. Why sampling distorts ranks is worked through in `machine-learning/recommender-systems/implicit-feedback-and-ranking.md`.
2. **Names:** with one held-out item per user, Hit Rate@10 equals Recall@10 ✅[^2].
3. **Replicability:** Petrov and Macdonald reviewed 40 peer-reviewed papers with 134 SASRec-vs-BERT4Rec comparisons on 46 datasets. BERT4Rec won 86 (64 %), SASRec 32 (24 %), with 16 ties ✅[^4]. The outcome depended on the dataset: BERT4Rec won 7 of 8 on MovieLens-20M and on Steam, and 0 of 5 on Toys ✅[^4].
4. **Undertraining:** the original BERT4Rec code with its default configuration was underfitted. On MovieLens-1M, replicating the published numbers took 15× more training for sampled recall@10 and 30× for sampled NDCG@10 ✅[^4]. On MovieLens-1M, NDCG@10 ranged from 0.0546 to 0.156 across implementations. Properly trained, BERT4Rec beat SASRec ✅[^4].

## Worked example
A simulator with 300 items in 15 topics of 20 items, Zipf-like popularity inside each topic, and 4,000 users with 2 favourite topics and 30 interactions each. After an item, the next is its successor with probability 0.3, a popular item of the same topic with 0.2, or a popular item of one of the user's favourite topics with 0.5. A first-order Markov chain can learn the first two parts. Only the history reveals the favourite topics. The last interaction of each user is the test item, and the script also scores the simulator's own next-item probabilities (the oracle). The 100 negatives exclude the user's items and are drawn uniformly or by popularity. Neural models: width 64, Adam with learning rate 0.002, transformers with 2 blocks and dropout 0.1, full softmax cross-entropy except where marked BCE. The BERT4Rec-style model masks 20 % of the items, or only the last item in half the sequences. The SASRec-style BCE loss:

```python
logits = model(x[:, :-1])                                  # causal transformer, scores for every item
neg = torch.randint(0, I, x[:, 1:].shape, generator=gen)   # one random negative per position
pos_s, neg_s = logits.gather(2, x[:, 1:, None])[..., 0], logits.gather(2, neg[..., None])[..., 0]
loss = -(F.logsigmoid(pos_s) + F.logsigmoid(-neg_s)).mean()
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-25, PyTorch 2.15.0, two runs identical; lines 4, 7 and 9 are the Mental model artifact ✅[^5]:

```text
4000 users, 300 items, 30 interactions each; test = each user's last item
oracle (true process)           full: R@10 0.759 NDCG@10 0.534 | sampled uniform: R@10 0.997 | sampled by popularity: R@10 0.999
popularity                      full: R@10 0.140 NDCG@10 0.064 | sampled uniform: R@10 0.379 | sampled by popularity: R@10 0.170
first-order Markov chain        full: R@10 0.655 NDCG@10 0.495 | sampled uniform: R@10 0.796 | sampled by popularity: R@10 0.748
GRU, cross-entropy, 20 ep       full: R@10 0.685 NDCG@10 0.476 | sampled uniform: R@10 0.934 | sampled by popularity: R@10 0.921
SASRec-style, BCE, 20 ep        full: R@10 0.681 NDCG@10 0.391 | sampled uniform: R@10 0.928 | sampled by popularity: R@10 0.916
SASRec-style, softmax CE, 20 ep full: R@10 0.681 NDCG@10 0.488 | sampled uniform: R@10 0.885 | sampled by popularity: R@10 0.863
BERT4Rec-style, Cloze, 20 ep    full: R@10 0.550 NDCG@10 0.291 | sampled uniform: R@10 0.865 | sampled by popularity: R@10 0.850
BERT4Rec-style, Cloze, 80 ep    full: R@10 0.607 NDCG@10 0.326 | sampled uniform: R@10 0.987 | sampled by popularity: R@10 0.995
```

<details><summary>Full script (prints the output above)</summary>

```python
# Next-item recommendation on simulated user sequences (PyTorch, CPU): popularity, a first-order Markov chain,
# a GRU (GRU4Rec-style), a causal transformer (SASRec-style) and a masked bidirectional one (BERT4Rec-style);
# leave-last-out evaluation with full ranking vs 100 sampled negatives.
import numpy as np, torch, torch.nn as nn, torch.nn.functional as F
torch.manual_seed(0)
rng = np.random.default_rng(0)
I, TOPICS, U, LEN = 300, 15, 4000, 30              # items, topics (20 items each), users, sequence length
topic_of = np.arange(I) // 20
pop_in_topic = 1.0 / np.arange(1, 21) ** 1.0       # Zipf-like popularity inside each topic
pop_in_topic /= pop_in_topic.sum()
def first_item(t): return t * 20 + rng.choice(20, p=pop_in_topic)
def next_dist(item, favs):                         # the simulator's true next-item distribution
    p, t = np.zeros(I), topic_of[item]
    p[t * 20 + (item % 20 + 1) % 20] += 0.3                            # the item's successor (next episode, matching accessory)
    p[t * 20:(t + 1) * 20] += 0.2 * pop_in_topic                       # another popular item of the same topic
    for t2 in favs:                                                    # a popular item of one of the user's 2 favourite topics
        p[t2 * 20:(t2 + 1) * 20] += 0.5 / 2 * pop_in_topic
    return p
seqs, oracle_p = np.zeros((U, LEN), dtype=np.int64), np.zeros((U, I))
for u in range(U):
    favs = rng.choice(TOPICS, 2, replace=False)
    seqs[u, 0] = first_item(rng.choice(favs))
    for t in range(1, LEN):
        p = next_dist(seqs[u, t - 1], favs)
        if t == LEN - 1: oracle_p[u] = p
        seqs[u, t] = rng.choice(I, p=p / p.sum())
train_seqs, test_items = seqs[:, :-1], seqs[:, -1]  # leave-last-out: the last item of every user is the test item

counts = np.bincount(train_seqs.ravel(), minlength=I).astype(float)
NEG_U, NEG_P = [], []                                # 100 sampled negatives per user: uniform, and popularity-weighted
for u in range(U):
    cand = np.setdiff1d(np.arange(I), seqs[u])
    NEG_U.append(rng.choice(cand, 100, replace=False))
    NEG_P.append(rng.choice(cand, 100, replace=False, p=counts[cand] / counts[cand].sum()))
NEG_U, NEG_P = np.array(NEG_U), np.array(NEG_P)
def evaluate(name, S):                               # S: (U, I) scores for each user's next item
    s_true = S[np.arange(U), test_items][:, None]
    full = 1 + (S > s_true).sum(1)                   # rank among all 300 items
    samp_u = 1 + (np.take_along_axis(S, NEG_U, 1) > s_true).sum(1)
    samp_p = 1 + (np.take_along_axis(S, NEG_P, 1) > s_true).sum(1)
    ndcg = lambda r: np.mean(np.where(r <= 10, 1 / np.log2(r + 1), 0))
    print(f"{name:<31} full: R@10 {np.mean(full <= 10):.3f} NDCG@10 {ndcg(full):.3f} | "
          f"sampled uniform: R@10 {np.mean(samp_u <= 10):.3f} | sampled by popularity: R@10 {np.mean(samp_p <= 10):.3f}")

print(f"{U} users, {I} items, {LEN} interactions each; test = each user's last item")
evaluate("oracle (true process)", oracle_p)
evaluate("popularity", np.tile(counts, (U, 1)))
trans = np.zeros((I, I))
np.add.at(trans, (train_seqs[:, :-1].ravel(), train_seqs[:, 1:].ravel()), 1)
evaluate("first-order Markov chain", trans[train_seqs[:, -1]] + 1e-3 * counts)

X = torch.tensor(train_seqs)                         # model input: items 1..29, targets: items 2..29 at training time
MASK_ID, D = I, 64
class GRURec(nn.Module):                             # GRU4Rec-style: GRU over the item sequence, scores = h . item embeddings
    def __init__(s):
        super().__init__(); s.emb = nn.Embedding(I + 1, D); s.gru = nn.GRU(D, D, batch_first=True)
    def forward(s, x): return s.gru(s.emb(x))[0] @ s.emb.weight[:I].T
class TransRec(nn.Module):                           # SASRec-style (causal=True) or BERT4Rec-style (causal=False)
    def __init__(s, causal):
        super().__init__()
        s.causal, s.emb, s.pos = causal, nn.Embedding(I + 1, D), nn.Parameter(0.02 * torch.randn(LEN, D))
        layer = nn.TransformerEncoderLayer(D, 2, 4 * D, dropout=0.1, batch_first=True, norm_first=True)
        s.tf, s.ln = nn.TransformerEncoder(layer, 2, enable_nested_tensor=False), nn.LayerNorm(D)
    def forward(s, x):
        L = x.shape[1]
        mask = torch.ones(L, L).triu(1).bool() if s.causal else None
        h = s.ln(s.tf(s.emb(x) + s.pos[:L], mask=mask, is_causal=s.causal))
        return h @ s.emb.weight[:I].T
def train(model, kind, epochs):
    opt = torch.optim.Adam(model.parameters(), lr=2e-3)
    gen = torch.Generator().manual_seed(1)
    for ep in range(epochs):
        model.train()
        for idx in torch.randperm(U, generator=gen).split(128):
            x = X[idx]
            if kind == "next_ce":                      # full softmax cross-entropy on every next item
                loss = F.cross_entropy(model(x[:, :-1]).transpose(1, 2), x[:, 1:])
            elif kind == "next_bce":                   # SASRec's loss: positive vs one random negative per position
                logits = model(x[:, :-1])
                neg = torch.randint(0, I, x[:, 1:].shape, generator=gen)
                pos_s, neg_s = logits.gather(2, x[:, 1:, None])[..., 0], logits.gather(2, neg[..., None])[..., 0]
                loss = -(F.logsigmoid(pos_s) + F.logsigmoid(-neg_s)).mean()
            else:                                      # BERT4Rec's Cloze task: mask 20 % of items, or (half the sequences) only the last
                m = torch.rand(x.shape, generator=gen) < 0.2
                last_only = torch.rand(len(x), generator=gen) < 0.5
                m[last_only] = False; m[last_only, -1] = True
                logits = model(torch.where(m, MASK_ID, x))
                loss = F.cross_entropy(logits[m], x[m])
            opt.zero_grad(); loss.backward(); opt.step()
    model.eval()
    with torch.no_grad():                              # score the next item after the 29 training items
        if kind == "cloze":
            x = torch.cat([X[:, 1:], torch.full((U, 1), MASK_ID)], 1)   # drop the oldest item, append [mask]
            return model(x)[:, -1].numpy()
        return model(X)[:, -1].numpy()
evaluate("GRU, cross-entropy, 20 ep", train(GRURec(), "next_ce", 20))
evaluate("SASRec-style, BCE, 20 ep", train(TransRec(True), "next_bce", 20))
evaluate("SASRec-style, softmax CE, 20 ep", train(TransRec(True), "next_ce", 20))
for ep in (20, 80):
    evaluate(f"BERT4Rec-style, Cloze, {ep} ep", train(TransRec(False), "cloze", ep))
```

</details>

Reading it, line by line:
- **Ceiling and floor:** even the true process puts the next item in its top 10 only 0.759 of the time, because half the mass is spread over the favourite topics. Popularity reaches 0.140.
- **Markov vs history:** the GRU and both SASRec-style models reach 0.681–0.685, above the Markov chain's 0.655. That is what knowing the favourite topics buys in this simulator. The Markov chain still has the best NDCG@10 of the learned models (0.495), likely because it ranks the successor, the single most probable next item (0.3), first.
- **BCE with one negative vs softmax:** the two SASRec-style models tie on recall@10 (0.681) but differ in NDCG@10, 0.391 with BCE and 0.488 with full cross-entropy. In this run the one-negative loss found the right top-10 items but ordered them worse.
- **Training budget:** the BERT4Rec-style model improves from 0.550 to 0.607 between 20 and 80 epochs, the direction Petrov and Macdonald found, and is still behind the causal models here ✅[^4]. Its authors themselves flag that the Cloze objective does not match next-item prediction ✅[^3]; this run does not show which cause dominates.
- **Sampled metrics:** with 100 sampled negatives the order changes. The BERT4Rec-style model scores 0.987 by uniform sampling, above every learned model and near the oracle's 0.997, and the Markov chain drops to last among learned models (0.796). Under full ranking the Markov chain beats it (0.655 vs 0.607). Most random negatives come from the 13 topics the user does not favour, so knowing the favourite topics almost guarantees a sampled hit. Full ranking also requires beating the 40 items inside those topics.
- **Sampler choice:** popularity scores 0.379 with uniform negatives and 0.170 with popularity-weighted ones, the effect BERT4Rec's authors noted ✅[^3].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Very sparse data | Markov-chain methods do best | Model parsimony matters most ✅[^2] |
| Anonymous sessions, no user id | Factor models hard to apply; item-to-item uses only the last click | No user profile ✅[^1] |
| Bidirectional model trained on next-item prediction | Trivial copying of the next input | Information leakage ✅[^4] |
| BERT4Rec at default training length | Underfitted; up to 30× more training needed (original code, MovieLens-1M) | Petrov and Macdonald ✅[^4]; lab 0.550 → 0.607 from 20 to 80 epochs ✅[^5] |
| Popularity-sampled negatives | Popularity baseline looks very poor | The negatives are the popular items ✅[^3]; lab 0.379 vs 0.170 ✅[^5] |
| Comparing papers with different negative sampling | Conclusions can flip (33 % worse vs 87 % better) | Sampled and full metrics disagree ✅[^4] |
| Cross-entropy in the original GRU4Rec | Numerically unstable in most runs | Small negative push on other items, per its authors ✅[^1] |
| History longer than `n` | Only the last `n` items are used | Fixed-length truncation ✅[^2] |
| Same model, another implementation | NDCG@10 from 0.0546 to 0.156 on MovieLens-1M | Implementation and configuration differences ✅[^4] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| First-order Markov chain | Counting only; strong on sparse data ✅[^2]; lab: best learned NDCG@10 ✅[^5] | Sees only the last item ✅[^1] |
| GRU4Rec | Uses the whole session; +22.5 % recall@20 over item-KNN on RSC15 (TOP1, 1,000 units) ✅[^1] | Sequential computation: `O(n)` steps, one after another for a history of `n` items ✅[^2] |
| SASRec | Adapts between recent and long-range items; over 10× faster than RNN/CNN models on GPUs ✅[^2] | Fixed maximum length; lab BCE ordering weaker than softmax ✅[^5] |
| BERT4Rec | Bidirectional context, more samples per sequence ✅[^3]; beats SASRec when trained properly ✅[^4] | Training–test mismatch ✅[^3]; long training to converge ✅[^4] |

## Takeaways
- Report full-ranking metrics. If you must sample, give the sampler and never compare numbers across samplers. [rule-candidate]
- Always include a first-order Markov chain and popularity as baselines; on sparse data the Markov chain may win. [rule-candidate]
- Before declaring one sequential model better, train every candidate to convergence; a default configuration may be underfitted.
- Split by time, keeping each user's last interactions for testing, and check the test input never contains the test item.

## Verification status
- Verified: 65 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [Session-based Recommendations with Recurrent Neural Networks](https://arxiv.org/html/1511.06939v4) — Hidasi, Karatzoglou, Baltrunas, Tikk, 2016. Backs: the session problem, item-to-item's last-click limit, Markov state explosion, the GRU update, session-parallel mini-batches, in-batch popularity-proportional negatives, BPR and TOP1, unstable cross-entropy, the RSC15 split and results. [^1]
- [Self-Attentive Sequential Recommendation](https://arxiv.org/html/1808.09781v1) — Kang, McAuley, 2018. Backs: Markov chains vs RNNs by sparsity, FMC and FPMC, the position embedding, the causal mask, shared item embeddings, the BCE loss with one negative, `n` of 50 and 200, the leave-last-out split, 100 sampled negatives, Hit@10 = Recall@10, attention behaviour and speed. [^2]
- [BERT4Rec: Sequential Recommendation with Bidirectional Encoder Representations from Transformer](https://arxiv.org/html/1904.06690v2) — Sun et al., 2019. Backs: bidirectional attention, the Cloze objective and its loss, `C(n, k)` samples, the appended `[mask]` and last-item samples, the mismatch, SASRec as the unidirectional version, popularity-sampled negatives and the low popularity baseline. [^3]
- [A Systematic Review and Replicability Study of BERT4Rec for Sequential Recommendation](https://arxiv.org/html/2207.07483v1) — Petrov, Macdonald, 2022. Backs: the task definition, information leakage, the 134-comparison review and per-dataset results, sampled vs unsampled disagreement, implementation spread, 15× and 30× training. [^4]
- `machine-learning/lab-setup.md` — the lab where the sequence simulator, the Markov chain, GRU, SASRec-style and BERT4Rec-style models and the full vs sampled evaluation ran on 2026-11-25. [^5]

## Related
- `machine-learning/recommender-systems/implicit-feedback-and-ranking.md` — BPR, leave-one-out evaluation and why sampled metrics distort ranks.
- `machine-learning/recommender-systems/collaborative-filtering-and-matrix-factorization.md` — the order-free factor models this extends.
- `machine-learning/recommender-systems/retrieval-and-ranking-pipelines.md` — where a next-item model sits in a retrieval and ranking stack.
- `machine-learning/recommender-systems/feedback-loops-and-popularity-bias.md` — training on logs the recommender produced.
- `machine-learning/deep-learning/recurrent-networks.md` — the GRU inside GRU4Rec.
- `machine-learning/transformers/attention-and-the-transformer.md` — causal and bidirectional self-attention.
- `machine-learning/transformers/pretraining-and-scaling-laws.md` — the masked-language-model objective BERT4Rec borrows.
- `machine-learning/evaluation/data-leakage.md` — temporal leakage when splitting interaction logs.
