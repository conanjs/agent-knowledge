---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/deep-learning
status: verified
applies-to: ["PyTorch 2.15.0", "scikit-learn 1.9.1"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, deep-learning, metric-learning, deep-metric-learning, siamese-networks, contrastive-loss, triplet-loss, margin, hard-negative-mining, semi-hard-negatives, batch-hard, proxy-loss, normalized-softmax, recall-at-1, map-at-r, open-set-retrieval]
---

# Metric learning: contrastive and triplet losses, mining and the reality check

## Summary
**TL;DR:** Metric learning trains a network so that the distance between two embeddings says how similar the inputs are, and keeps saying so for classes the network never saw: a new face, product or digit is handled by nearest-neighbour search or by a distance threshold, without retraining. The contrastive loss pulls same-class pairs together and pushes different-class pairs beyond a margin; the triplet loss only asks an anchor to be closer to a same-class positive than to a different-class negative, by a margin. Most randomly drawn triplets soon meet the margin and teach nothing, so training mines informative ones. Semi-hard negatives (farther than the positive but inside the margin) keep a training signal; always taking the hardest negative can collapse every embedding onto one point. Classification losses with L2-normalized (unit-length) class weights act as learned class "proxies" and are strong baselines. A careful re-evaluation found that most reported gains over the 2006 contrastive loss and the triplet loss shrink to marginal under a fair comparison.
**Use this when:** you build image or product search, face or signature verification, re-identification or deduplication, where the classes at test time differ from those in training; you choose a margin or a mining strategy; a triplet loss stalls at zero or every input maps to the same vector; or you read a paper's claimed improvement in Recall@1.
**Not this doc:** InfoNCE (information noise-contrastive estimation), NT-Xent (normalized temperature-scaled cross-entropy), the temperature, and CLIP (contrastive language–image pre-training), where the positive pairs come from augmentations or captions → `machine-learning/deep-learning/embeddings-and-self-supervised-learning.md`; few-shot episodes and prototypical networks → `machine-learning/deep-learning/meta-learning-and-few-shot-learning.md`; nearest-neighbour search at scale → `algorithms/vector-search-evaluation.md`; the k-NN (k-nearest neighbours) classifier itself → `machine-learning/supervised-learning/k-nearest-neighbors.md`; ranking documents for a query → `machine-learning/recommender-systems/learning-to-rank.md`.

## Problem
A classifier has a fixed list of outputs, so it cannot name a class that appears after training. Retrieval and verification need a distance instead: the query is matched to its nearest references, or two inputs are declared the same if they are close enough ✅[^1]. The distance on the raw input usually measures the wrong thing. In the lab, digits with a random shift of at most 1 pixel and random lighting found an image of the same digit as their nearest raw-pixel neighbour only 42.3 % of the time; a learned embedding raised that to 69.5 % on digits it had never seen ✅[^10]. The training signal is fragile. With random triplets, the share that cost nothing rose from 14 % to 64 % over 30 epochs, and always taking the hardest negative collapsed the embeddings: the 714 unseen images ended up a mean distance of 0.03 apart on the unit sphere ✅[^10]. Published progress is fragile too: re-run with good implementations and the same setup, losses from 2006 to 2019 performed about the same ✅[^1].

## Mental model
**Analogy:** arranging guests in a hall so that anyone can find their own group by walking to the nearest people. The contrastive rule is absolute: classmates stand together, and any two strangers stand at least 5 m apart. The triplet rule is relative: each guest must be nearer to a classmate than to a stranger, by at least one step. An organiser who checks random trios soon finds almost all of them already fine, so he fixes nothing (easy triplets). One who only ever fixes the worst-placed trio can end up herding everyone into one corner (collapse). A class that arrives late finds its place by the same rules, which is why the hall learns distances, not a list of class names.

**Artifact:** printed by the full script in the Worked example; lab run (`machine-learning/lab-setup.md`), 2026-11-25, PyTorch 2.15.0 ✅[^10]. Digits 0–5 train the embedding; digits 6–9 are only seen at test time. R@1 (recall@1) is the share of test images whose nearest neighbour shows the same digit; MAP@R (mean average precision at R) also scores the rest of the list, as defined under How it works; spread is the mean distance between the unit-length embeddings of the unseen images:

```text
raw pixels         seen R@1 0.203 | unseen R@1 0.423        MAP@R 0.075        | spread 1.31
…
triplet random     seen R@1 0.756 | unseen R@1 0.692±0.010  MAP@R 0.183±0.003 | spread 0.72 | seed 0, zero-loss share at epochs 1/10/20/30: 0.14/0.32/0.53/0.64
triplet semi-hard  seen R@1 0.760 | unseen R@1 0.695±0.021  MAP@R 0.194±0.009 | spread 1.25 | seed 0, zero-loss share at epochs 1/10/20/30: 0.00/0.02/0.05/0.19
triplet hard       seen R@1 0.275 | unseen R@1 0.468±0.024  MAP@R 0.087±0.001 | spread 0.03 | seed 0, zero-loss share at epochs 1/10/20/30: 0.00/0.00/0.00/0.00
```

The same loss, three ways of picking the negative: random negatives run out of work (64 % of triplets at zero loss), semi-hard negatives keep finding it, and the hardest negatives squeeze everything to one point.

## How it works
### What is learned, and how it is used
1. **The embedding:** a network `f` maps an input `x` to a vector `f(x)`, and a distance `d` compares two vectors. Metric learning aims for an embedding space where similar data are close and dissimilar data are far ✅[^1]. FaceNet constrains `f(x)` to the unit hypersphere, `‖f(x)‖₂ = 1` ✅[^2], and the reality-check protocol L2-normalizes embeddings both for the loss and for evaluation ✅[^1]. On the unit sphere, cosine similarity and Euclidean distance give the same order: `d² = 2 − 2·cos`, so `cos = 0.5` is `d = 1.0`.
2. **Use:** information retrieval (return the most similar items to a query) and open-set classification, where training and test classes are disjoint and a query is labelled by a nearest-neighbour vote or verified by thresholding a distance; face verification and person re-identification are examples ✅[^1].
3. **Siamese networks:** one network with shared weights embeds every member of a pair or triplet and is trained end to end; it was first used for signature verification, later for face verification and dimensionality reduction ✅[^3].
4. **Two loss families:** embedding losses use the relations between the samples in a batch; classification losses add a weight matrix that turns an embedding into class logits ✅[^1]. Embedding losses still work when only "these two are similar" relations exist and no class labels do ✅[^1].

### The contrastive loss: absolute thresholds on pairs
`L = [d_p − m_pos]₊ + [m_neg − d_n]₊`, where `d_p` is the distance of a positive (same-class) pair, `d_n` that of a negative pair, `m_pos` and `m_neg` are thresholds and `[z]₊ = max(z, 0)`; many implementations set `m_pos = 0` ✅[^1]. This is Musgrave et al.'s general form of the classic pair loss of Hadsell, Chopra and LeCun (2006) ✅[^1]. Example with `m_pos = 0` and `m_neg = 0.5` (the lab's values): a positive pair at distance 0.3 costs 0.3; a negative pair at 0.2 costs `0.5 − 0.2 = 0.3`; a negative pair at 0.8 costs 0. Its weakness: the same threshold applies to every pair, however much the similarities vary ✅[^1], so it cannot directly take relative distances between classes into account ✅[^5].

### The triplet loss: a relative margin
`L = [d_ap − d_an + m]₊`, with `d_ap` the anchor–positive distance, `d_an` the anchor–negative distance and `m` the margin ✅[^1]. FaceNet uses squared L2 distances, a 128-dimensional embedding and `m = 0.2` ✅[^2]; Musgrave et al. found the best margin tends to be around 0.1 ✅[^1]. In theory, the triplet loss places fewer restrictions on the embedding space than the contrastive loss and allows for variance in how far apart classes are ✅[^1]. Example with `d_ap = 0.3` and `m = 0.2`, sorted by the negative's distance:

| Negative at `d_an` | Loss `[0.3 − d_an + 0.2]₊` | Name |
|---|---|---|
| 1.0 | 0 | easy: already beyond the margin |
| 0.4 | 0.1 | semi-hard: farther than the positive, inside the margin ✅[^2] |
| 0.1 | 0.4 | hard: closer than the positive |

### Mining: which pairs and triplets to train on
1. **Why mine:** with all possible triplets, many are easily satisfied, contribute nothing and slow convergence ✅[^2]. Using every pair or triplet also costs memory and tends to plateau quickly because of the many easy ones ✅[^1]. Sampling negatives at random gives mostly easy ones: on a high-dimensional unit sphere, distances between uniformly scattered points concentrate near `√2 ≈ 1.41`, which induces no loss for thresholds below `√2` ✅[^3].
2. **Online or offline:** offline mining recomputes hard examples every n steps on a subset, using a recent checkpoint; online mining picks them inside each mini-batch ✅[^2]. FaceNet mines online in batches of about 1,800 images, with about 40 faces per identity so that each batch holds enough positives ✅[^2].
3. **Semi-hard negatives:** FaceNet keeps negatives that are farther from the anchor than the positive but still inside the margin ✅[^2]. Wu et al. write the pick as `n* = argmin_{n : d(a,n) > d(a,p)} d(a,n)` within a batch: the closest negative that is still farther than the positive ✅[^3], which is the lab's rule.
4. **Hardest negatives:** they can lead to bad local minima early in training, specifically a collapsed model with `f(x) = 0` ✅[^2]. With the squared-distance triplet loss, the gradient on a close negative approaches zero: hard positives pull with large gradients while hard negatives push with small ones, so all points eventually gather at one point ✅[^3]. Picked over the whole training set, the hardest positives and negatives would also be dominated by mislabelled and poorly imaged faces ✅[^2].
5. **P×K batches:** sample `P` classes and `K` images of each. **Batch hard** takes, for each anchor, the hardest positive and the hardest negative in the batch; **batch all** uses all `PK(PK − K)(K − 1)` triplets ✅[^4]. In batch all, the many zero terms wash out the few useful ones in the average, and averaging only the non-zero terms works much better ✅[^4]. Batch hard consistently beat batch all in Hermans et al.'s person re-identification experiments ✅[^4].
6. **Spreading the picks:** Wu et al.'s distance-weighted sampling draws negatives over the whole range of distances ✅[^3]; they found semi-hard mining makes little progress once semi-hard negatives become rare ✅[^1].

### Classification and proxy losses
1. **Normalized softmax:** cross-entropy over class logits with the columns of the weight matrix L2-normalized ✅[^1]. Zhai and Wu also drop the bias and normalize the embedding, so the logits are cosine similarities, divided by a temperature `σ` of 0.05: `L = −log( exp(xᵀp_y/σ) / Σ_z exp(xᵀp_z/σ) )`, where `x` is the embedding, `p_z` the normalized weight of class `z` and `y` the true class ✅[^7]. Example: cosines 0.9 to the true class and 0.5 to two others give logits 18, 10 and 10, and a loss of `log(1 + 2·e^(−8)) = 0.00067`. Each class weight acts as a proxy for its class ✅[^7], and classification is a strong baseline for retrieval ✅[^7].
2. **Proxy losses:** ProxyNCA, named after the NCA (neighbourhood component analysis) loss it uses ✅[^5], learns proxies along with the network and applies the triplet idea to an anchor and proxies instead of other data points; the proxy loss upper-bounds the original one ✅[^5]. On the Cars196 dataset it converged about three times as fast as the baseline methods ✅[^5]. Proxy Anchor makes each proxy an anchor associated with every embedding in the batch ✅[^6]. Its authors' framing: pair losses cost `O(M²)` or `O(M³)` over `M` training samples (computation that grows with the square or the cube of `M`: for `M = 1,000`, about 10⁶ pairs or 10⁹ triplets) and converge slowly, while proxy losses converge fast but miss data-to-data relations ✅[^6].
3. **Angular margins:** the face-verification losses SphereFace, CosFace and ArcFace add multiplicative-angular, additive-cosine and additive-angular margins to the softmax; metric-learning papers have consistently left them out of their experiments ✅[^1].
4. **N-pair loss:** a softmax over each positive pair against all other pairs, also known as InfoNCE and NT-Xent ✅[^1]; its temperature and its use without labels are in `machine-learning/deep-learning/embeddings-and-self-supervised-learning.md`.
5. **Vocabulary in code:** in pytorch-metric-learning (not installed in the lab), every loss takes embeddings and labels, and a miner's output can be passed as a third argument ✅[^9]. Its `TripletMarginMiner(margin=0.2, type_of_triplets="all")` returns "all" margin-violating triplets or the "hard" subset (negative at least as close as the positive), the "semihard" subset (negative farther than the positive) or the "easy" triplets that do not violate the margin ✅[^8].

### Evaluating: class-disjoint splits, R@1 and MAP@R
1. **Split by class:** the usual benchmarks train on the first 50 % of classes and test on the rest; most papers had no validation set and tuned against the test set ✅[^1].
2. **R@1 hides a lot:** in these papers "Recall@1" is the precision of the first retrieval ✅[^1]. Ten results of which only the first is correct still score 100 % ✅[^1].
3. **MAP@R:** R-precision is the share of a query's `R` nearest results that are correct, where `R` is its number of same-class references; it ignores their order ✅[^1]. MAP@R adds the order: `MAP@R = (1/R) Σ_{i=1..R} P(i)`, with `P(i)` the precision at `i` when the `i`-th retrieval is correct and 0 otherwise ✅[^1]. Example with `R = 10`, correct results at positions 1 and 10: `(1 + 2/10) / 10 = 0.12` ✅[^1].
4. **The reality check:** Musgrave, Belongie and Lim list unfair comparisons as the first flaw: changes in network architecture, embedding size, augmentation and optimizer, plus omitted details such as frozen BatchNorm parameters worth 2 points on the CUB200 bird dataset, and no confidence intervals ✅[^1]. They fixed these: the same BN-Inception (Inception with batch normalization) trunk with 128-dimensional embeddings, hyperparameters from 50 rounds of Bayesian optimization with 4-fold cross-validation over class-disjoint partitions, and 10 runs with confidence intervals ✅[^1]. The trend over 2006–2019 methods was then a relatively flat line, and state-of-the-art losses were marginally better than, or on par with, the classic ones ✅[^1]. Papers had reported relative gains above 100 % over the contrastive loss and near 50 % over the triplet loss, because the baseline numbers they quoted were very low: many seem to come from the 2016 lifted-structure-loss paper, whose implementation sampled only `N/2` pairs and `N/3` triplets per batch of `N` and set the triplet margin to 1, and later papers kept citing those numbers ✅[^1].

## Worked example
`load_digits` (1,797 grayscale 8×8 images), with every image given a random shift of at most 1 pixel and random "lighting": a brightness offset plus a left-to-right and a top-to-bottom brightness ramp, each with a standard normal coefficient. Training images get a fresh shift and lighting in every batch; test images get one fixed draw. The embedding network is an MLP (multilayer perceptron) from 64 to 128 to 32 units, trained for 30 epochs with Adam on digits 0–5 in P×K batches of 6 digits × 10 images. Scores use the 714 images of digits 6–9, which training never sees, and the 217 held-out images of digits 0–5 ("seen"); each image queries all the others, by cosine similarity. Each method runs with 3 seeds (mean ± standard deviation). The losses use unsquared distances between unit-length embeddings. Margins (0.2 for triplets, 0.5 for the contrastive negatives) and the temperature (0.05) were set once and not tuned. The nuisance was chosen so that raw pixel distance is a weak baseline. The core of the three triplet variants:

```python
a, p = pos.nonzero(as_tuple=True)                     # every anchor-positive pair in the batch
n_random = torch.multinomial(neg[a].float(), 1).squeeze(1)            # random: any negative
farther = d[a].masked_fill(~neg[a] | (d[a] <= d[a, p][:, None]), float("inf"))
n_semi = farther.argmin(1)                  # semi-hard: closest negative still farther than the positive
loss = F.relu(d[a, p] - d[a, n_semi] + margin).mean()  # the same loss, whichever negative is picked
# batch hard instead takes, per anchor, the farthest positive and the closest negative
```
The full script drops anchor–positive pairs that have no negative farther than the positive.

Lab run (`machine-learning/lab-setup.md`), 2026-11-25, PyTorch 2.15.0, scikit-learn 1.9.1, two runs identical ✅[^10]:

```text
train 866 images (digits 0-5) | seen-digit test 217 | unseen-digit test 714 (digits 6-9)
raw pixels         seen R@1 0.203 | unseen R@1 0.423        MAP@R 0.075        | spread 1.31
untrained          seen R@1 0.229 | unseen R@1 0.388±0.014  MAP@R 0.074±0.000 | spread 1.05
softmax            seen R@1 0.705 | unseen R@1 0.636±0.013  MAP@R 0.197±0.003 | spread 1.15
norm-softmax       seen R@1 0.641 | unseen R@1 0.639±0.013  MAP@R 0.130±0.005 | spread 0.89
contrastive        seen R@1 0.619 | unseen R@1 0.591±0.022  MAP@R 0.157±0.007 | spread 0.30 | seed 0, zero-loss share at epochs 1/10/20/30: 0.40/0.02/0.20/0.32
triplet random     seen R@1 0.756 | unseen R@1 0.692±0.010  MAP@R 0.183±0.003 | spread 0.72 | seed 0, zero-loss share at epochs 1/10/20/30: 0.14/0.32/0.53/0.64
triplet semi-hard  seen R@1 0.760 | unseen R@1 0.695±0.021  MAP@R 0.194±0.009 | spread 1.25 | seed 0, zero-loss share at epochs 1/10/20/30: 0.00/0.02/0.05/0.19
triplet hard       seen R@1 0.275 | unseen R@1 0.468±0.024  MAP@R 0.087±0.001 | spread 0.03 | seed 0, zero-loss share at epochs 1/10/20/30: 0.00/0.00/0.00/0.00
```

<details><summary>Full script (prints the output above)</summary>

```python
# Metric learning on load_digits, digits 6-9 held out of training (PyTorch, scikit-learn, CPU).
# Each image gets a random 1-pixel shift and random "lighting" (a brightness offset and two ramps).
# Losses: contrastive; triplet with random, semi-hard and batch-hard negatives; two classification
# baselines. Scored by recall@1 and MAP@R (mean average precision at R) on the unseen digits.
import numpy as np, torch
from torch import nn
import torch.nn.functional as F
from sklearn.datasets import load_digits
from sklearn.model_selection import train_test_split
torch.set_num_threads(1)

X, y = load_digits(return_X_y=True)
img = np.pad(X.reshape(-1, 8, 8) / 16, ((0, 0), (1, 1), (1, 1)))   # 10x10: room to move 1 pixel
S = torch.tensor(np.stack([img[:, i:i + 8, j:j + 8].reshape(-1, 64) for i in range(3) for j in range(3)], 1),
                 dtype=torch.float32)                                  # 9 shifted copies of each image
ramp = torch.linspace(-1, 1, 8)
LIGHT = torch.stack([torch.ones(64), ramp.repeat(8), ramp.repeat_interleave(8)])  # offset, left-right, top-bottom
def view(idx, g):                                    # random shift + random lighting, one per image
    return S[idx, torch.randint(0, 9, (len(idx),), generator=g)] + torch.randn(len(idx), 3, generator=g) @ LIGHT
y = torch.tensor(y); seen = y < 6                    # train on digits 0-5 only
tr, te = train_test_split(torch.nonzero(seen).flatten(), test_size=0.2, stratify=y[seen], random_state=0)
un = torch.nonzero(~seen).flatten()                  # digits 6-9: never seen in training
ys = y[tr]; g0 = torch.Generator().manual_seed(0)
Xte, yte, Xun, yun = view(te, g0), y[te], view(un, g0), y[un]    # fixed views of the test images
print(f"train {len(tr)} images (digits 0-5) | seen-digit test {len(te)} | unseen-digit test {len(un)} (digits 6-9)")

def scores(E, lab):                                  # recall@1 and MAP@R, every image queries the rest
    E = F.normalize(E, dim=1); sim = E @ E.T; sim.fill_diagonal_(-9)
    hit = (lab[sim.argsort(1, descending=True)] == lab[:, None]).float()
    R = (lab[:, None] == lab[None, :]).sum(1) - 1   # number of same-class references per query
    prec = hit.cumsum(1) / torch.arange(1, len(lab) + 1)
    mapr = torch.stack([(prec[i, :R[i]] * hit[i, :R[i]]).sum() / R[i] for i in range(len(lab))])
    return hit[:, 0].mean().item(), mapr.mean().item(), torch.pdist(E).mean().item()

def batches(g):                                      # P x K batches: the 6 classes, K = 10 images each
    idx = [torch.nonzero(ys == c).flatten() for c in range(6)]
    for _ in range(len(ys) // 60):
        yield torch.cat([i[torch.randperm(len(i), generator=g)[:10]] for i in idx])

def triplets(d, pos, neg, mode, g):                  # indices of anchor, positive, negative
    if mode == "hard":                               # batch hard: hardest positive and negative per anchor
        return (torch.arange(len(d)), d.masked_fill(~pos, -1).argmax(1),
                d.masked_fill(~neg, float("inf")).argmin(1))
    a, p = pos.nonzero(as_tuple=True)                # every anchor-positive pair in the batch
    if mode == "random":
        return a, p, torch.multinomial(neg[a].float(), 1, generator=g).squeeze(1)
    dn = d[a].masked_fill(~neg[a], float("inf"))     # semi-hard: closest negative farther than the positive
    dn = dn.masked_fill(dn <= d[a, p][:, None], float("inf"))
    keep = torch.isfinite(dn.min(1).values)
    return a[keep], p[keep], dn[keep].argmin(1)

def run(method, seed, margin=0.2, epochs=30):
    torch.manual_seed(seed); g = torch.Generator().manual_seed(seed)
    net = nn.Sequential(nn.Linear(64, 128), nn.ReLU(), nn.Linear(128, 32))   # the embedding network
    head = nn.Linear(32, 6, bias=method != "norm-softmax")                   # used by the classifiers only
    opt = torch.optim.Adam(list(net.parameters()) + list(head.parameters()), lr=1e-3)
    easy = []                                        # per epoch: share of terms with zero loss
    for ep in range(0 if method == "untrained" else epochs):
        zs = []
        for b in batches(g):
            E, lab = net(view(tr[b], g)), ys[b]
            if method == "softmax":
                loss = F.cross_entropy(head(E), lab)
            elif method == "norm-softmax":           # cosine logits, temperature 0.05
                loss = F.cross_entropy(F.normalize(E) @ F.normalize(head.weight).T / 0.05, lab)
            else:
                Z = F.normalize(E); d = torch.cdist(Z, Z)
                same = lab[:, None] == lab[None, :]; pos = same & ~torch.eye(len(lab), dtype=torch.bool)
                if method == "contrastive":          # [d_p - 0]+ + [0.5 - d_n]+ over all pairs in the batch
                    t = F.relu(0.5 - d[~same]); loss = d[pos].mean() + t.mean()
                else:
                    a, p, n = triplets(d, pos, ~same, method.split()[1], g)
                    t = F.relu(d[a, p] - d[a, n] + margin); loss = t.mean()
                zs.append((t == 0).float().mean().item())
            opt.zero_grad(); loss.backward(); opt.step()
        easy.append(np.mean(zs) if zs else None)
    with torch.no_grad():
        return scores(net(Xte), yte)[:1] + scores(net(Xun), yun), easy

r0, r1 = scores(Xte, yte), scores(Xun, yun)
print(f"{'raw pixels':<18} seen R@1 {r0[0]:.3f} | unseen R@1 {r1[0]:.3f}        MAP@R {r1[1]:.3f}        | spread {r1[2]:.2f}")
for method in ["untrained", "softmax", "norm-softmax", "contrastive", "triplet random", "triplet semi-hard", "triplet hard"]:
    res = [run(method, seed) for seed in range(3)]   # 3 seeds: mean and standard deviation
    r = np.array([x[0] for x in res]); e = res[0][1]
    line = (f"{method:<18} seen R@1 {r[:, 0].mean():.3f} | unseen R@1 {r[:, 1].mean():.3f}±{r[:, 1].std():.3f}"
            f"  MAP@R {r[:, 2].mean():.3f}±{r[:, 2].std():.3f} | spread {r[:, 3].mean():.2f}")
    if e and e[0] is not None:
        line += f" | seed 0, zero-loss share at epochs 1/10/20/30: {e[0]:.2f}/{e[9]:.2f}/{e[19]:.2f}/{e[29]:.2f}"
    print(line)
```

</details>

Reading it, line by line:
- **Baselines:** on unseen digits, raw pixels find the same digit as nearest neighbour 42.3 % of the time, and an untrained network does slightly worse (38.8 %). The lighting changes dominate pixel distances.
- **Every trained embedding transfers:** trained only on digits 0–5, all non-collapsed methods reach 59–70 % on digits 6–9, and MAP@R rises from 0.075 to 0.13–0.20. Lighting and small shifts are the same nuisance for every digit, so learning to ignore them carries over to new digits.
- **Easy triplets:** with random negatives, the share of triplets at zero loss climbs 0.14 → 0.32 → 0.53 → 0.64, so by the end two thirds of each batch does nothing. Semi-hard mining keeps that share at 0.19 or below. The final scores are nevertheless the same within one standard deviation (R@1 0.692 ± 0.010 vs 0.695 ± 0.021).
- **Collapse:** in seed 0, no batch-hard triplet ever reaches zero loss, yet over the 3 seeds its unseen embeddings sit a mean 0.03 apart, against 0.72–1.25 for the other triplet runs, and its R@1 (0.468) is barely above raw pixels. Every input maps to nearly the same point, the failure FaceNet and Wu et al. warn about ✅[^2] ✅[^3]. The lab already uses unsquared distances, which Wu et al. suggest as a simple remedy for that instability ✅[^3]; in this run it was not enough.
- **Contrastive:** with `m_pos = 0` it pulls every positive pair to distance 0, and the unseen embeddings are the least spread of the working methods (0.30). Its R@1 (0.591) is the lowest of the non-collapsed trained methods, with untuned thresholds. Its zero-loss share counts the negative pairs already beyond 0.5.
- **The reality check in miniature:** the plain softmax classifier has the best MAP@R (0.197), semi-hard triplets the best R@1 (0.695), and the order of methods changes with the metric. Most gaps are a few points with standard deviations of 0.01–0.02 over 3 seeds, no hyperparameter was tuned, and the task is one small dataset whose difficulty comes from a lighting nuisance chosen to defeat raw pixels, so this order says nothing about the methods in general. That is the situation in which Musgrave et al. found published orderings unreliable ✅[^1].
- **Seen vs unseen R@1:** raw pixels score 0.203 on the 217-image seen gallery and 0.423 on the 714-image unseen gallery. The unseen gallery holds about 178 images per digit and 4 digits, the seen one about 36 per digit and 6 digits, so a query has many more same-class neighbours and fewer wrong classes in the first; R@1 values from galleries of different sizes and class counts are not comparable.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Always the hardest negative | Embeddings collapse to one point (lab spread 0.03, R@1 0.468) | Bad local minimum `f(x) = 0` ✅[^2]; with squared distances, large attracting and small repelling gradients ✅[^3]; lab (unsquared distances, untuned margin) ✅[^10] |
| Random negatives, long training | Most triplets cost nothing (lab: 64 % at epoch 30) | Easy triplets contribute nothing ✅[^2]; random distances concentrate near `√2` ✅[^3]; lab ✅[^10] |
| Averaging over all triplets of a batch | Few useful terms washed out by zeros | Average the non-zero terms only ✅[^4] |
| Batch with too few positives per class | Anchor–positive distances not meaningful | FaceNet ensures about 40 faces per identity per batch ✅[^2]; P×K sampling ✅[^4] |
| Semi-hard negatives run out | Little progress | Semi-hard negatives become rare as training proceeds ✅[^1] |
| "Hard" means different things | pytorch-metric-learning's `"hard"` triplets are all margin violators whose negative is at least as close as the positive; batch hard keeps one hardest negative per anchor | ✅[^8] ✅[^4] |
| Mislabelled training data | Hardest positives and negatives picked over the whole training set would be dominated by label errors and bad images | FaceNet's reason to mine inside mini-batches ✅[^2] |
| Reporting R@1 only | Retrieval lists with 1 and with 10 correct results out of 10 both score 100 % | MAP@R and R-precision separate them ✅[^1] |
| NMI (normalized mutual information) on many classes | High scores even for a randomly initialized network (81.2 on SOP, Stanford Online Products, with about 20,000 classes) | NMI favours many classes ✅[^1] |
| Tuning against the test classes | Overfits the test set; reported progress inflated | No validation set in most papers ✅[^1] |
| Comparing against a paper's quoted baseline | Gains of over 100 % that a fair re-run does not reproduce | Weak baseline numbers cited from paper to paper (few pairs, margin 1) ✅[^1] |
| Different architecture or embedding size | Accuracy differs before any loss is changed | Pretrained trunks differ (Recall@1 41.1 to 51.1 on CUB200); bigger embeddings score higher ✅[^1] |
| R@1 from galleries of different sizes | Not comparable (lab raw pixels 0.203 vs 0.423) | Lab ✅[^10] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Contrastive loss | Needs only pairs; classic and, when well tuned, competitive ✅[^1] | One threshold for all pairs ✅[^1]; lab: least spread, lowest R@1 of the working methods, untuned ✅[^10] |
| Triplet loss, random negatives | Simple; relative margin ✅[^1] | Signal dies out as triplets become easy ✅[^2]; lab 64 % zero loss ✅[^10] |
| Triplet loss, semi-hard negatives | Keeps informative triplets ✅[^2] | Batch size is set by the mining: FaceNet used about 1,800 ✅[^2]; little progress once semi-hard negatives are rare ✅[^1] |
| Batch hard | Strong in Hermans et al.'s person re-identification experiments ✅[^4] | Collapse risk ✅[^2] ✅[^3]; lab collapse with an untuned margin and learning rate ✅[^10] |
| Normalized softmax / proxies | No mining; strong baseline ✅[^7]; ProxyNCA converged about 3× faster on Cars196 ✅[^5] | A weight per class limits scaling to very many classes, which Zhai and Wu address by subsampling classes ✅[^7]; misses data-to-data relations ✅[^6] |
| Proxy Anchor | Its authors report fast convergence with data-to-data relations through the gradients ✅[^6] | One more loss whose gain needs a fair comparison ✅[^1] |

## Takeaways
- Hold whole classes out of training, tune on a separate class-disjoint validation split, and report results on classes neither split touched. [rule-candidate]
- Report MAP@R (or R-precision) next to Recall@1, as a mean with its spread over several seeds. [rule-candidate]
- Log the share of zero-loss triplets and the spread of the embeddings during training: a spread near 0 is collapse, not convergence.
- Train a normalized-softmax classifier as the baseline before building a custom pair or triplet pipeline.

## Verification status
- Verified: 102 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [A Metric Learning Reality Check](https://ar5iv.labs.arxiv.org/html/2003.08505) — Musgrave, Belongie, Lim, 2020 (ar5iv HTML of arXiv:2003.08505). Backs: metric-learning goal and uses, embedding vs classification losses, contrastive and triplet formulas, `m_pos = 0`, margin around 0.1, normalized softmax, ProxyNCA, angular margins, N-pairs = InfoNCE = NT-Xent, mining overview, flaws, MAP@R and its example, NMI table, the fixed protocol, the flat trend and overstated gains. [^1]
- [FaceNet: A Unified Embedding for Face Recognition and Clustering](https://ar5iv.labs.arxiv.org/html/1503.03832) — Schroff, Kalenichenko, Philbin, 2015 (ar5iv HTML of arXiv:1503.03832). Backs: unit-hypersphere embedding, squared-distance triplet loss, 128 dimensions, margin 0.2, easy triplets, online and offline mining, semi-hard negatives, collapse with hardest negatives, mislabelled faces, batch of about 1,800 with about 40 per identity. [^2]
- [Sampling Matters in Deep Embedding Learning](https://ar5iv.labs.arxiv.org/html/1706.07567) — Wu, Manmatha, Smola, Krähenbühl, 2017 (ar5iv HTML of arXiv:1706.07567). Backs: Siamese networks with shared weights, collapse under hard negative mining and its gradient explanation, the semi-hard formula, distance concentration near `√2`, distance-weighted sampling. [^3]
- [In Defense of the Triplet Loss for Person Re-Identification](https://ar5iv.labs.arxiv.org/html/1703.07737) — Hermans, Beyer, Leibe, 2017 (ar5iv HTML of arXiv:1703.07737). Backs: P×K batches, batch hard and batch all, averaging only non-zero terms, batch hard beating batch all. [^4]
- [No Fuss Distance Metric Learning using Proxies](https://ar5iv.labs.arxiv.org/html/1703.07464) — Movshovitz-Attias, Toshev, Leung, Ioffe, Singh, 2017 (ar5iv HTML of arXiv:1703.07464). Backs: contrastive loss cannot use relative distances, learned proxies, the upper bound, three times faster convergence on Cars196. [^5]
- [Proxy Anchor Loss for Deep Metric Learning](https://ar5iv.labs.arxiv.org/html/2003.13911) — Kim, Kim, Cho, Kwak, 2020 (ar5iv HTML of arXiv:2003.13911). Backs: pair-based vs proxy-based losses and their complexity, each proxy as an anchor over the batch. [^6]
- [Classification is a Strong Baseline for Deep Metric Learning](https://ar5iv.labs.arxiv.org/html/1811.12649) — Zhai, Wu, 2019 (ar5iv HTML of arXiv:1811.12649). Backs: normalized softmax formula, no bias, temperature 0.05, class weights as proxies, classification as a strong baseline, class subsampling for many classes. [^7]
- [Miners (PyTorch Metric Learning docs)](https://kevinmusgrave.github.io/pytorch-metric-learning/miners/) — Musgrave, living. Backs: `TripletMarginMiner` signature, margin default 0.2 and the four `type_of_triplets` values. [^8]
- [Losses (PyTorch Metric Learning docs)](https://kevinmusgrave.github.io/pytorch-metric-learning/losses/) — Musgrave, living. Backs: losses take embeddings and labels; miner output as third argument. [^9]
- `machine-learning/lab-setup.md` — the lab where the digits metric-learning comparison ran on 2026-11-25. [^10]

## Related
- `machine-learning/deep-learning/embeddings-and-self-supervised-learning.md` — InfoNCE, temperature, SimCLR (a simple framework for contrastive learning of visual representations), CLIP and collapse without negatives.
- `machine-learning/deep-learning/meta-learning-and-few-shot-learning.md` — prototypical networks, a metric-based few-shot method.
- `algorithms/vector-search-evaluation.md` — serving nearest-neighbour search over the learned embeddings.
- `machine-learning/supervised-learning/k-nearest-neighbors.md` — classification by neighbours, the use the embedding is built for.
- `machine-learning/evaluation/metrics-catalog.md` — average precision and the other ranking metrics.
- `machine-learning/recommender-systems/learning-to-rank.md` — pairwise and listwise ranking losses for queries and documents.
