---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/foundations
status: verified
applies-to: ["any", "scipy 1.18.1", "scikit-learn 1.9.1", "PyTorch 2.15.0"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, basics, information-theory, entropy, cross-entropy, kl-divergence, kullback-leibler, mutual-information, bits, nats, log-loss, huffman]
---

# Information theory for machine learning: entropy, cross-entropy, KL divergence and mutual information

## Summary
**TL;DR:** The surprise of an outcome with probability `p` is `−log p`: a sure thing surprises you 0, a coin flip 1 bit. Entropy is the average surprise of a distribution, and also a floor on the bits per symbol any code can average. Cross-entropy `H(P, Q)` is the average surprise when the data come from `P` but you expected `Q`. KL (Kullback–Leibler) divergence is the gap, `KL(P‖Q) = H(P, Q) − H(P)`: never negative, zero only when `Q = P`, not symmetric, and infinite when `Q` gives probability 0 to something `P` produces. Mutual information is how much knowing `X` cuts the uncertainty about `Y`. A classifier's log loss is the cross-entropy between the labels and its predictions, so minimizing it minimizes a KL divergence to the data.
**Use this when:** you meet bits, nats, entropy, cross-entropy, a KL term or "information gain" in a loss, a paper or another doc (a VAE (variational autoencoder), RLHF (reinforcement learning from human feedback), t-SNE (t-distributed stochastic neighbor embedding), PPO (proximal policy optimization), EM (expectation–maximization)); you call `scipy.stats.entropy` or `torch.nn.KLDivLoss`; or a log-loss value needs a baseline.
**Not this doc:** log loss and cross-entropy derived as maximum likelihood, and the other losses → `machine-learning/foundations/loss-functions-and-maximum-likelihood.md`; the symbols `log`, `Σ`, `E[·]` and softmax with numbers → `machine-learning/foundations/math-notation-reference.md`; entropy as a decision-tree split criterion → `machine-learning/supervised-learning/decision-trees.md`; mutual information for comparing clusterings → `machine-learning/evaluation/metrics-catalog.md`.

## Problem
Machine-learning texts use these quantities without defining them: in this knowledge base alone, the VAE, RLHF, t-SNE, PPO and EM docs all carry a KL term (listed in How it works §3), and every classifier doc trains on cross-entropy. Without the definitions three mistakes are easy. The direction of KL matters: in the lab, `KL(P‖Q) = 0.3219` bits while `KL(Q‖P)` is infinite for the same pair ✅[^7]. Library conventions differ: PyTorch's KL loss takes the model's log-probabilities first, and the `reduction='mean'` that `KLDivLoss` uses by default printed `0.1073` bits where the true value is `0.3219` ✅[^7] ✅[^6]. And units differ: the same log loss is `0.5946` nats or `0.8578` bits ✅[^7], so two numbers from two tools may not be comparable.

## Mental model
**Analogy:** compression. You send a stream of symbols (die rolls, words, labels) and pay per bit. A good codebook gives frequent symbols short codes and rare ones long codes. **Entropy** is the average cost per symbol with the best possible codebook for the true frequencies. **Cross-entropy** is the average cost when the codebook was built for the wrong frequencies. **KL divergence** is the waste: how many extra bits per symbol the wrong codebook costs. **Mutual information** is how many bits you save sending `Y` when the receiver already has `X`.

**Artifact:** a loaded die (`P`: face 1 has probability 0.5, faces 2–6 have 0.1 each) and a fair die (`Q`: 1/6 each), printed by the full script in the Worked example; lab run (`machine-learning/lab-setup.md`), 2026-11-25, scipy 1.18.1 ✅[^7]:

```text
fair   die: 2.5850 bits = 1.7918 nats  scipy 2.5850 bits
loaded die: 2.1610 bits = 1.4979 nats  scipy 2.1610 bits
Huffman code lengths for the loaded die: [1, 4, 4, 3, 3, 3]  expected 2.2000 bits/roll  measured on 100,000 rolls 2.1979
data loaded, code for fair  H(P)=2.1610  H(P,Q)=2.5850  KL(P||Q)=0.4240  scipy KL=0.4240
data fair, code for loaded  H(P)=2.5850  H(P,Q)=2.9349  KL(P||Q)=0.3500  scipy KL=0.3500
```

A Huffman code, built by the script's `huffman_lengths` by repeatedly merging the two least likely symbols into one, gives the loaded die 1 bit for face 1 and 3 or 4 bits for the others; it averages 2.2 bits per roll, just above the 2.161-bit entropy floor. Coding loaded rolls as if the die were fair costs 0.424 bits more per roll; the reverse mistake costs 0.350, a different number.

## How it works
### 1. Surprise (self-information)
1. **Definition.** The information in an outcome `x` of probability `P(x)` is `I(x) = −log P(x)` ✅[^2]. It is built to satisfy three wishes: a certain event carries no information, a less likely event carries more, and independent events add up (two heads carry twice the information of one) ✅[^2].
2. **Units.** With `log₂` the unit is the bit; with the natural log `ln` it is the nat; a bit count is just a rescaled nat count ✅[^2]. One nat is the information of an event with probability `1/e` ✅[^2]. Convert with `bits = nats / ln 2`: `0.5946` nats `= 0.5946 / 0.6931 = 0.8578` bits ✅[^7].
3. **Numbers.** A fair coin's heads: `−log₂(1/2) = 1` bit. "The card is a heart": `−log₂(1/4) = 2` bits. "The 3 of spades": `log₂ 52 = 5.7` bits. One whole shuffled deck order: `log₂ 52! ≈ 225.6` bits ✅[^1] ✅[^7].

### 2. Entropy: average surprise
1. **Definition.** `H(P) = −Σᵢ pᵢ · log pᵢ`, the expected surprise of one draw from `P`, where `pᵢ` is the probability of outcome `i` and `Σᵢ` sums over all outcomes ✅[^1] ✅[^2]. Terms with `pᵢ = 0` count as 0, by the convention `0 · log 0 = 0` ✅[^2]. Loaded die: `−(0.5 · log₂ 0.5 + 5 · 0.1 · log₂ 0.1) = 0.5 + 1.661 = 2.161` bits ✅[^7].
2. **Range.** For a discrete variable `H ≥ 0`; with `k` outcomes `H ≤ log k`, reached only by the uniform distribution ✅[^1]. The fair die is the maximum for six faces, `log₂ 6 = 2.585` bits ✅[^7]. Near-certain distributions have low entropy, near-uniform ones high ✅[^2].
3. **Coding meaning.** Entropy is a lower bound on the average number of bits needed to encode symbols drawn from `P` ✅[^2]; SciPy calls it a tight lower bound for a noiseless channel ✅[^3]. The lab's Huffman code reached 2.2 bits per roll against the 2.161 floor ✅[^7].
4. **Continuous variables.** The same formula with an integral is the differential entropy ✅[^1]; it can be negative, unlike the discrete case ✅[^1]. Lab: a normal distribution with standard deviation 0.1 has `−0.8836` nats ✅[^7].

### 3. Cross-entropy and KL divergence
1. **Cross-entropy.** `H(P, Q) = −Σᵢ pᵢ · log qᵢ`: the outcomes follow `P`, the surprise is measured with `Q` ✅[^1] ✅[^2]. In coding terms, the average bits per symbol when the code is optimized for `Q` but the true distribution is `P` ✅[^3]. Loaded rolls, fair code: every face costs `log₂ 6`, so `H(P, Q) = 2.585` bits ✅[^7].
2. **KL divergence.** `KL(P‖Q) = Σᵢ pᵢ · log(pᵢ / qᵢ) = H(P, Q) − H(P)` ✅[^1] ✅[^3]; the double bar `‖` only separates the two distributions, and their order matters (item 3). It is the extra information needed when a code designed for `Q` sends symbols drawn from `P` ✅[^2]: `2.585 − 2.161 = 0.424` bits per roll ✅[^7].
3. **Properties.** `KL(P‖Q) ≥ 0`, with equality only when `P = Q` ✅[^1]. If some `x` has `p(x) > 0` and `q(x) = 0`, `KL(P‖Q) = ∞` ✅[^1]. It is not symmetric, so it is not a true distance ✅[^2]: lab `KL(loaded‖fair) = 0.424` but `KL(fair‖loaded) = 0.350` bits ✅[^7].
4. **Which direction to minimize.** When fitting an approximation `q` to a target `p`, minimizing `KL(p‖q)` picks a `q` with high probability wherever `p` has it, and blurs several modes into one; minimizing `KL(q‖p)` picks a `q` with low probability wherever `p` has low probability, and for well-separated modes settles on one mode ✅[^2]. Lab, a single Gaussian fitted to two bumps at −3 and +3: forward KL gives mean 0, standard deviation 3.162 (covering both bumps, and putting mass in the empty middle); reverse KL gives mean +2.984, standard deviation 1.023 (one bump only) ✅[^7].
5. **Where it appears in this knowledge base.** The VAE's KL term between the encoder's distribution and the prior (`machine-learning/generative-models/variational-autoencoders.md`), RLHF's KL penalty to the reference model (`machine-learning/transformers/alignment-rlhf-and-dpo.md`), t-SNE's `KL(P‖Q)` between neighbour distributions (`machine-learning/unsupervised-learning/t-sne-and-umap.md`), the ELBO (evidence lower bound) in EM (`machine-learning/unsupervised-learning/gaussian-mixtures-and-em.md`), PPO's per-epoch KL check (`machine-learning/reinforcement-learning/policy-gradients-and-ppo.md`), and the infinite KL of low-dimensional supports (`machine-learning/generative-models/generative-model-families.md`).

### 4. Joint, conditional and mutual information
1. **Joint entropy** `H(X, Y)` is the entropy of the pair; it is at least each variable's entropy and at most their sum, with the sum reached when `X` and `Y` are independent ✅[^1].
2. **Conditional entropy** `H(Y | X) = H(X, Y) − H(X)`: what is left uncertain about `Y` once `X` is known ✅[^1].
3. **Mutual information** `I(X; Y) = H(X) + H(Y) − H(X, Y) = H(Y) − H(Y | X)` ✅[^1]. Equivalently `I(X; Y) = KL(P(X, Y) ‖ P(X)·P(Y))`, how far the joint table is from the table independence would predict ✅[^1].
4. **Properties.** Symmetric, never negative, and zero exactly when `X` and `Y` are independent ✅[^1]. Unlike a correlation coefficient it is not limited to linear relationships ✅[^1].
5. **Numbers.** "Rain / no rain" against "umbrella / none" with the joint table `[[0.4, 0.1], [0.1, 0.4]]` (both marginals 0.5): `I = 2 · 0.4 · log₂(0.4/0.25) + 2 · 0.1 · log₂(0.1/0.25) = 0.5425 − 0.2644 = 0.2781` bits; a table that is an outer product of its marginals gives 0 ✅[^7]. scikit-learn's `mutual_info_score` computes it from two label arrays, in nats ✅[^4].

### 5. Why log loss is cross-entropy
1. For one example, the true label is a distribution `P` that puts probability 1 on the true class (one-hot); the model's prediction is `Q` ✅[^1]. Then `H(P, Q) = −log q(true class)`, and the average over examples is the log loss ✅[^1] ✅[^5].
2. `H(P, Q) = H(P) + KL(P‖Q)` and `H(P)` does not depend on the model, so maximizing the predicted probability of the data, minimizing cross-entropy and minimizing `KL(P‖Q)` are the same problem ✅[^1] ✅[^2]. The maximum-likelihood derivation is in `machine-learning/foundations/loss-functions-and-maximum-likelihood.md`.
3. **The baseline to beat.** A model that always predicts the training class frequencies scores `H(test labels) + KL(test frequencies ‖ training frequencies)`; in the lab `0.69281 + 0.00065 = 0.69346` nats, against `0.5946` for a logistic regression ✅[^7]. A log loss is only meaningful next to that number.
4. **Library conventions.** scikit-learn's `log_loss` uses the natural log and clips probabilities to `[eps, 1 − eps]` ✅[^5]. PyTorch's `CrossEntropyLoss` takes unnormalized logits (raw scores, before a softmax turns them into probabilities) and accepts either class indices or class probabilities as the target ✅[^8].

## Worked example
One script computes each quantity by hand and checks it against SciPy, scikit-learn or PyTorch: surprise values, die entropies and a Huffman code, cross-entropy and KL in both directions, a KL that is infinite, PyTorch's `kl_div` reductions, a single Gaussian fitted to two bumps by each direction of KL, mutual information of two joint tables, and the log loss of a classifier. The core definitions:

```python
def H(p, base=2):                       # entropy, with 0 * log 0 = 0
    p = p[p > 0]; return -np.sum(p * np.log(p)) / np.log(base)
def CE(p, q, base=2):                   # cross-entropy, sum over outcomes P can produce
    m = p > 0; return -np.sum(p[m] * np.log(q[m])) / np.log(base)
def KL(p, q, base=2):
    return CE(p, q, base) - H(p, base)
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-25, Python 3.13.7, numpy 2.5.5, scipy 1.18.1, scikit-learn 1.9.1, PyTorch 2.15.0, two runs identical ✅[^7]:

```text
== 1. surprise -log2 p ==
fair coin heads          p=0.5000  surprise 1.000 bits
card is a heart          p=0.2500  surprise 2.000 bits
card is the 3 of spades  p=0.0192  surprise 5.700 bits
one order of a 52-card deck p=1.2e-68 surprise 225.6 bits
== 2. entropy of a die ==
fair   die: 2.5850 bits = 1.7918 nats  scipy 2.5850 bits
loaded die: 2.1610 bits = 1.4979 nats  scipy 2.1610 bits
Huffman code lengths for the loaded die: [1, 4, 4, 3, 3, 3]  expected 2.2000 bits/roll  measured on 100,000 rolls 2.1979
== 3. cross-entropy = entropy + KL (bits) ==
data loaded, code for fair  H(P)=2.1610  H(P,Q)=2.5850  KL(P||Q)=0.4240  scipy KL=0.4240
data fair, code for loaded  H(P)=2.5850  H(P,Q)=2.9349  KL(P||Q)=0.3500  scipy KL=0.3500
== 4. KL is not symmetric; it is infinite where Q has a zero that P does not ==
P=[0.5, 0.5, 0.0] Q=[0.4, 0.4, 0.2]  KL(P||Q)=0.3219 bits  KL(Q||P)=inf
torch kl_div(log Q, P, reduction='batchmean') = 0.2231 nats = 0.3219 bits
torch kl_div(log Q, P, reduction='mean'     ) = 0.0744 nats = 0.1073 bits
  warning: reduction: 'mean' divides the total loss by both the batch size and the support size
== 4b. fit one Gaussian q to a two-bump p by minimizing each direction of KL ==
forward KL(p||q): q = N(mean +0.000, sd 3.162)  KL 0.4620 nats
reverse KL(q||p): q = N(mean +2.984, sd 1.023)  KL 0.6888 nats
== 5. mutual information from a joint table (bits) ==
dependent   I=0.2781  H(X)+H(Y)-H(X,Y)=0.2781  KL(joint||product)=0.2781  sklearn on 20,000 samples=0.2805
independent I=0.0000  H(X)+H(Y)-H(X,Y)=0.0000  KL(joint||product)=0.0000  sklearn on 20,000 samples=0.0000
== 6. log loss of a classifier is a cross-entropy (nats) ==
model:     by hand 0.5946  sklearn log_loss 0.5946  = 0.8578 bits
base rate: log loss 0.69346 = entropy of the test labels 0.69281 + KL(test freq || train freq) 0.00065
torch CrossEntropyLoss with soft target = softmax(logits): 0.6216  H(target) 0.6216 nats
differential entropy of N(0, 0.1^2): -0.8836 nats
```

<details><summary>Full script (prints the output above)</summary>

```python
# Surprise, entropy, cross-entropy, KL divergence and mutual information, by hand and with
# scipy / scikit-learn / PyTorch; a Huffman code shows what "bits" means.
import heapq, math, warnings
import numpy as np
import torch
from scipy.optimize import minimize
from scipy.stats import entropy, norm
from sklearn.datasets import make_classification
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import log_loss, mutual_info_score

def H(p, base=2):                                   # entropy, with 0 * log 0 = 0
    p = np.asarray(p, float); p = p[p > 0]
    return -np.sum(p * np.log(p)) / np.log(base)
def CE(p, q, base=2):                               # cross-entropy H(P, Q) = -sum p log q
    p, q = np.asarray(p, float), np.asarray(q, float); m = p > 0
    with np.errstate(divide="ignore"):
        return -np.sum(p[m] * np.log(q[m])) / np.log(base)
def KL(p, q, base=2):
    return CE(p, q, base) - H(p, base)

print("== 1. surprise -log2 p ==")
for name, p in [("fair coin heads", 1/2), ("card is a heart", 1/4), ("card is the 3 of spades", 1/52)]:
    print(f"{name:<24} p={p:.4f}  surprise {-math.log2(p):.3f} bits")
print(f"{'one order of a 52-card deck':<24} p={math.exp(-math.lgamma(53)):.1e} surprise {math.lgamma(53) / math.log(2):.1f} bits")

print("== 2. entropy of a die ==")
fair, loaded = np.full(6, 1/6), np.array([0.5, 0.1, 0.1, 0.1, 0.1, 0.1])
for name, p in [("fair", fair), ("loaded", loaded)]:
    print(f"{name:<6} die: {H(p):.4f} bits = {H(p, math.e):.4f} nats  scipy {entropy(p, base=2):.4f} bits")

def huffman_lengths(p):                              # code length (bits) per symbol of a Huffman code
    heap = [(pi, i, (i,)) for i, pi in enumerate(p)]; heapq.heapify(heap)
    length = [0] * len(p); k = len(p)
    while len(heap) > 1:
        p1, _, s1 = heapq.heappop(heap); p2, _, s2 = heapq.heappop(heap)
        for s in s1 + s2: length[s] += 1
        heapq.heappush(heap, (p1 + p2, k, s1 + s2)); k += 1
    return np.array(length)
L = huffman_lengths(loaded)
rolls = np.random.default_rng(0).choice(6, size=100_000, p=loaded)
print(f"Huffman code lengths for the loaded die: {L.tolist()}  expected {np.dot(loaded, L):.4f} bits/roll"
      f"  measured on 100,000 rolls {L[rolls].mean():.4f}")

print("== 3. cross-entropy = entropy + KL (bits) ==")
for p, q, label in [(loaded, fair, "data loaded, code for fair"), (fair, loaded, "data fair, code for loaded")]:
    print(f"{label:<27} H(P)={H(p):.4f}  H(P,Q)={CE(p, q):.4f}  KL(P||Q)={KL(p, q):.4f}"
          f"  scipy KL={entropy(p, q, base=2):.4f}")

print("== 4. KL is not symmetric; it is infinite where Q has a zero that P does not ==")
P, Q = np.array([0.5, 0.5, 0.0]), np.array([0.4, 0.4, 0.2])
print(f"P={P.tolist()} Q={Q.tolist()}  KL(P||Q)={entropy(P, Q, base=2):.4f} bits  KL(Q||P)={entropy(Q, P, base=2)}")
logq, p_t = torch.log(torch.tensor([[0.4, 0.4, 0.2]])), torch.tensor([[0.5, 0.5, 0.0]])
for red in ("batchmean", "mean"):                   # input = log Q (the model), target = P (the data)
    with warnings.catch_warnings(record=True) as w:
        warnings.simplefilter("always")
        v = torch.nn.functional.kl_div(logq, p_t, reduction=red).item()
    print(f"torch kl_div(log Q, P, reduction={red!r:<11}) = {v:.4f} nats = {v / math.log(2):.4f} bits")
    if w: print("  warning:", str(w[0].message).split(".")[0])

print("== 4b. fit one Gaussian q to a two-bump p by minimizing each direction of KL ==")
x = np.linspace(-12, 12, 4801); dx = x[1] - x[0]
p_mix = 0.5 * norm.pdf(x, -3, 1) + 0.5 * norm.pdf(x, 3, 1)
def kl_grid(a, b):                                   # numerical integral of a * log(a / b)
    return np.sum(a * (np.log(a) - np.log(b))) * dx
for name, obj in [("forward KL(p||q)", lambda t: kl_grid(p_mix, norm.pdf(x, t[0], np.exp(t[1])))),
                  ("reverse KL(q||p)", lambda t: kl_grid(norm.pdf(x, t[0], np.exp(t[1])), p_mix))]:
    t = minimize(obj, x0=[0.5, 0.0], method="Nelder-Mead", options={"xatol": 1e-6, "fatol": 1e-9}).x
    print(f"{name}: q = N(mean {np.round(t[0], 3) + 0.0:+.3f}, sd {np.exp(t[1]):.3f})  KL {obj(t):.4f} nats")

print("== 5. mutual information from a joint table (bits) ==")
tables = {"dependent  ": np.array([[0.4, 0.1], [0.1, 0.4]]),
          "independent": np.outer([0.7, 0.3], [0.2, 0.8])}
rng = np.random.default_rng(1)
for name, J in tables.items():
    px, py = J.sum(1), J.sum(0)
    mi = np.sum(J * np.log2(J / np.outer(px, py)))
    via_h = H(px) + H(py) - H(J.ravel())
    cells = rng.choice(4, size=20_000, p=J.ravel())   # sample (x, y) pairs from the table
    est = mutual_info_score(cells // 2, cells % 2) / math.log(2)
    print(f"{name} I={mi:.4f}  H(X)+H(Y)-H(X,Y)={via_h:.4f}  KL(joint||product)={np.round(entropy(J.ravel(), np.outer(px, py).ravel(), base=2), 10) + 0.0:.4f}"
          f"  sklearn on 20,000 samples={est:.4f}")

print("== 6. log loss of a classifier is a cross-entropy (nats) ==")
X, y = make_classification(n_samples=4000, n_features=5, n_informative=3, random_state=0)
clf = LogisticRegression().fit(X[:3000], y[:3000])
p_te = clf.predict_proba(X[3000:]); y_te = y[3000:]
by_hand = -np.mean(np.log(p_te[np.arange(len(y_te)), y_te]))
print(f"model:     by hand {by_hand:.4f}  sklearn log_loss {log_loss(y_te, p_te):.4f}  = {by_hand / math.log(2):.4f} bits")
base = np.bincount(y[:3000]) / 3000                  # always predict the training class frequencies
freq_te = np.bincount(y_te) / len(y_te)
print(f"base rate: log loss {log_loss(y_te, np.tile(base, (len(y_te), 1))):.5f} = entropy of the test labels {H(freq_te, math.e):.5f}"
      f" + KL(test freq || train freq) {KL(freq_te, base, math.e):.5f}")
logits = torch.tensor([[2.0, 0.5, -1.0]]); soft = torch.softmax(logits, dim=1)   # a soft target = the model's own output
print(f"torch CrossEntropyLoss with soft target = softmax(logits): {torch.nn.CrossEntropyLoss()(logits, soft).item():.4f}"
      f"  H(target) {H(soft[0].numpy(), math.e):.4f} nats")
print(f"differential entropy of N(0, 0.1^2): {norm(scale=0.1).entropy():.4f} nats")
```

</details>

Reading it, block by block:
- **Surprise (1):** 2, 5.7 and 225.6 bits match the values Dive into Deep Learning gives for the suit, the card and the deck order, and 1 bit is its unit, the information of one fair coin flip ✅[^1] ✅[^7].
- **Entropy (2):** the loaded die is more predictable than the fair one, 2.161 against 2.585 bits. Huffman's 2.2 bits per roll is 0.039 above the floor, and 100,000 simulated rolls cost 2.1979 bits each ✅[^7].
- **Cross-entropy and KL (3):** each `H(P, Q)` equals `H(P) + KL(P‖Q)` to four decimals, and SciPy's two-argument `entropy` gives the same KL ✅[^7] ✅[^3]. The two directions differ (0.424 against 0.350).
- **Infinite KL (4):** `Q` gives 0.2 to the third outcome, which `P` never produces, so `KL(P‖Q)` is finite; `P` gives 0 to an outcome `Q` produces, so `KL(Q‖P)` is infinite ✅[^7] ✅[^1]. PyTorch's `kl_div(log Q, P)` computes `KL(P‖Q)`: `batchmean` gives the true value, while `mean` (the default of `KLDivLoss`) divided by all 3 elements instead of the batch size of 1 and warned about it ✅[^7] ✅[^6].
- **Direction of fit (4b):** `N(mean, sd)` is a normal distribution with that mean and standard deviation. Forward KL's answer has mean 0 and standard deviation `√10 = 3.162`, which are the two-bump mixture's own mean and standard deviation (variance `1 + 3² = 10`): it covers both bumps at the price of mass in the empty middle. Reverse KL keeps one bump, and its KL of `0.6888` nats is close to `ln 2 = 0.693`, the cost of ignoring half the mass ✅[^7].
- **Mutual information (5):** three formulas agree; scikit-learn's estimate from 20,000 samples is `0.0024` bits above the exact value for the dependent table and 0 for the independent one ✅[^7].
- **Log loss (6):** the hand-written `−mean log q(true class)` equals `log_loss`; the base-rate predictor's loss is the test labels' entropy plus the small KL between test and training class frequencies. With a soft target equal to the model's own output, PyTorch's cross-entropy is `0.6216`, the target's entropy, not 0 ✅[^7].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Outcome with `p = 0` inside `Σ p log p` | Counts as 0 | Convention `0 log 0 = 0` ✅[^2] |
| `q = 0` where `p > 0` | `KL(P‖Q) = ∞`; lab `KL(Q‖P) = inf` | Infinite surprise for an outcome declared impossible ✅[^1] ✅[^7] |
| Confidently wrong classifier (`q = 0` for the true class) | scikit-learn returns a large finite log loss | `log_loss` clips probabilities to `[eps, 1 − eps]` ✅[^5] |
| Swapping the arguments of KL | A different number | Not symmetric ✅[^2]; lab 0.424 vs 0.350 bits ✅[^7] |
| `torch.nn.KLDivLoss(input, target)` | Computes `KL(target‖Q)` for `input = log Q`; `input` must be log-probabilities | Model output first, data second, the reverse of the math notation ✅[^6] |
| `KLDivLoss` with the default `reduction='mean'` | Not the KL value; lab 0.1073 instead of 0.3219 bits | `mean` averages over every element; `batchmean` matches the definition ✅[^6] ✅[^7] |
| Inputs to `scipy.stats.entropy` that do not sum to 1 | Silently normalized first | Documented behaviour ✅[^3] |
| Comparing numbers from two tools | Bits vs nats | SciPy defaults to base `e` ✅[^3]; `log_loss` and `mutual_info_score` use the natural log ✅[^5] ✅[^4] |
| Soft targets (the target spreads probability over several classes, as in label smoothing or distillation) | The best possible cross-entropy is `H(target) > 0`, not 0 | `H(P, Q) = H(P) + KL(P‖Q)` ✅[^1]; lab 0.6216 ✅[^7] |
| Continuous variable | Differential entropy can be negative; lab `−0.8836` nats | No lower bound of 0 for densities ✅[^1] ✅[^7]; an event of unit density carries zero information ✅[^2] |
| Mutual information estimated from samples | Small error even for exact tables; lab +0.0024 bits | A finite sample's frequencies differ from the table ✅[^7] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Minimize `KL(p‖q)` (forward) | `q` puts high probability wherever `p` does ✅[^2]; lab covered both bumps ✅[^7] | Blurs separate modes together, mass where `p` has little ✅[^2] |
| Minimize `KL(q‖p)` (reverse) | `q` avoids regions where `p` is low ✅[^2] | Can lock onto one mode of several ✅[^2]; lab kept one bump ✅[^7] |
| Report in bits | Reads as a length in binary digits ✅[^1] | Libraries default to nats ✅[^3] ✅[^5] |
| Mutual information instead of correlation | Any kind of dependence, zero only for independence ✅[^1] | Needs the joint distribution; estimated from 20,000 samples, the lab value was still 0.0024 bits off ✅[^7] |

## Takeaways
- Write the direction of every KL you use (`KL(data‖model)` or `KL(model‖data)`); the two answer different questions. [rule-candidate]
- In PyTorch, pass log-probabilities of the model first and use `reduction='batchmean'` when you need the KL value. [rule-candidate]
- Report a log loss next to the base-rate predictor's loss (the label entropy); below it, the model has learned something.
- Never give a model probability exactly 0 for something that can happen: one such event makes cross-entropy and KL infinite.

## Verification status
- Verified: 98 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [Information Theory (Dive into Deep Learning, 22.11)](https://d2l.ai/chapter_appendix-mathematics-for-deep-learning/information-theory.html) — Aston Zhang, Zachary C. Lipton, Mu Li, Alexander J. Smola, living. Backs: the coin, suit, card and deck numbers; entropy, its range and maximum; differential entropy can be negative; joint and conditional entropy; mutual information, its identities, properties and the correlation comparison; KL definition, non-negativity, infinite case; cross-entropy = entropy + KL; log loss as cross-entropy and the equivalent objectives. [^1]
- [Deep Learning, chapter 3: Probability and Information Theory](https://www.deeplearningbook.org/contents/prob.html) — Ian Goodfellow, Yoshua Bengio, Aaron Courville, 2016. Backs: self-information and its three properties, nats and bits, entropy as a lower bound on code length, KL as extra message length, asymmetry and not a true distance, the two KL directions (Figure 3.6), minimizing cross-entropy = minimizing KL, `0 log 0 = 0`, unit-density events. [^2]
- [scipy.stats.entropy](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.entropy.html) — SciPy developers, SciPy 1.18 manual. Backs: entropy and relative entropy formulas, normalization of inputs, base `e` default, tight coding bound, cross-entropy as optimized-for-`qk` code length, `CE = H + D`. [^3]
- [sklearn.metrics.mutual_info_score](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.mutual_info_score.html) — scikit-learn developers, living (1.9.1). Backs: mutual information from two labelings, natural log, nats. [^4]
- [sklearn.metrics.log_loss](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.log_loss.html) — scikit-learn developers, living (1.9.1). Backs: log loss = cross-entropy loss, natural log, clipping to `[eps, 1 − eps]`. [^5]
- [torch.nn.KLDivLoss](https://docs.pytorch.org/docs/2.15/generated/torch.nn.KLDivLoss.html) — PyTorch Foundation, 2026 (2.15). Backs: pointwise `target · (log target − input)`, input in log space, argument order vs `KL(P‖Q)`, `mean` vs `batchmean`. [^6]
- `machine-learning/lab-setup.md` — the lab where the entropy, Huffman, KL, mutual-information and log-loss script ran on 2026-11-25. [^7]
- [torch.nn.CrossEntropyLoss](https://docs.pytorch.org/docs/2.15/generated/torch.nn.CrossEntropyLoss.html) — PyTorch Foundation, 2026 (2.15). Backs: input is unnormalized logits; target as class indices or class probabilities. [^8]

## Related
- `machine-learning/foundations/loss-functions-and-maximum-likelihood.md` — cross-entropy derived as the negative log-likelihood, and the other losses.
- `machine-learning/foundations/math-notation-reference.md` — `log`, `exp`, softmax and the `D_KL` symbol with numbers.
- `machine-learning/supervised-learning/decision-trees.md` — entropy as an impurity measure for splits.
- `machine-learning/generative-models/variational-autoencoders.md` — the ELBO's KL term in closed form.
- `machine-learning/transformers/alignment-rlhf-and-dpo.md` — the KL penalty that keeps a tuned model near its reference.
- `machine-learning/unsupervised-learning/t-sne-and-umap.md` — an embedding fitted by minimizing `KL(P‖Q)`.
- `machine-learning/transformers/pretraining-and-scaling-laws.md` — next-token cross-entropy and perplexity.
- `machine-learning/probabilistic-ml/variational-inference.md` — minimizing a reverse KL divergence to approximate a posterior.
