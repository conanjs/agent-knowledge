---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/deep-learning
status: verified
applies-to: ["PyTorch 2.15.0"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, deep-learning, embeddings, nn-embedding, cosine-similarity, representation-learning, self-supervised-learning, contrastive-learning, infonce, nt-xent, temperature, simclr, clip, byol, simsiam, collapse, stop-gradient]
---

# Embeddings and self-supervised learning

## Summary
**TL;DR:** An embedding is a learned vector for each item, and `nn.Embedding` is literally a trainable table whose row `i` is the vector for id `i`; similar items should end up with a high cosine similarity. Self-supervised learning trains those vectors without labels by making up a task from the data itself: predict a hidden part (masked prediction) or tell which two views come from the same example (contrastive learning). The contrastive loss InfoNCE is a softmax cross-entropy over "one positive among many negatives", and its temperature `τ` decides how hard it pushes on the most similar negatives. Without negatives the trivial answer "map everything to one vector" (collapse) wins, unless an asymmetry such as BYOL's or SimSiam's predictor plus stop-gradient prevents it.
**Use this when:** you build an `nn.Embedding` layer, compare vectors with cosine similarity, implement or debug a SimCLR- or CLIP-style loss, pick a temperature, or see a self-supervised run whose loss looks perfect while the features are useless.
**Not this doc:** masked-token and next-token pretraining of language models → `machine-learning/transformers/pretraining-and-scaling-laws.md`; how text becomes the ids an embedding looks up → `machine-learning/transformers/tokenization.md`; the augmentations themselves and reusing a pretrained backbone → `machine-learning/deep-learning/data-augmentation-and-transfer-learning.md`; linear dimensionality reduction without training a network → `machine-learning/unsupervised-learning/principal-component-analysis.md`.

## Problem
Labels are expensive, raw data is not. A network needs numbers that put similar things close together, but the obvious encoding, one-hot vectors, cannot express any similarity: the cosine similarity between the one-hot vectors of two different words is always 0 ✅[^3]. Learning better vectors without labels requires a made-up task, and the made-up task has failure modes of its own: in the lab, a loss that only pulls two views of an example together reaches its best possible value, −1, while every output has become the same vector (std 0.002 per dimension) ✅[^12]; a temperature that is too high gave a 5-nearest-neighbour accuracy of 0.735 instead of 0.812 on the same data ✅[^12].

## Mental model
**Analogy:** a seating plan drawn by a party host who has no guest list, only photos. Each guest gets a seat (an embedding: a position on the map). The host is shown two photos of the same guest taken in different light (two augmented views) and must seat them together, and seat everyone else elsewhere (contrastive learning). If the host only had to seat matching photos together, putting the whole party on one chair would satisfy the rule perfectly: that is collapse, and the "everyone else elsewhere" part, the negatives, is what forbids it. The temperature is how much the host worries about the guests who look most alike.

**Artifact:** the temperature turns one row of similarities into weights on the negatives; printed by the full script in the Worked example; lab run (`machine-learning/lab-setup.md`), 2026-11-24, PyTorch 2.15.0 ✅[^12]:

```text
== (2) temperature: softmax weight on each negative (positive sim 0.8) ==
tau=0.05: loss 0.127 | weight on negatives (0.7, 0.3, 0.0, -0.3): [0.119, 0.0, 0.0, 0.0]
tau=0.1 : loss 0.318 | weight on negatives (0.7, 0.3, 0.0, -0.3): [0.268, 0.005, 0.0, 0.0]
tau=0.5 : loss 0.916 | weight on negatives (0.7, 0.3, 0.0, -0.3): [0.328, 0.147, 0.081, 0.044]
tau=1.0 : loss 1.192 | weight on negatives (0.7, 0.3, 0.0, -0.3): [0.275, 0.184, 0.136, 0.101]
```

The gradient of the loss with respect to each negative's similarity is that negative's softmax weight divided by `τ`. At `τ = 0.05` the whole push goes to the one negative at 0.7, the "hard" negative; at `τ = 1.0` all four share it.

## How it works
### Embeddings and cosine similarity
1. **A lookup table:** `nn.Embedding(num_embeddings, embedding_dim)` stores a learnable weight of shape `(num_embeddings, embedding_dim)`, initialized from `N(0, 1)`; an input of integer ids of any shape `*` returns shape `(*, embedding_dim)` ✅[^1]. Looking up id `i` equals multiplying its one-hot vector by the weight matrix (lab: `True`) ✅[^12], so an embedding is a linear layer on one-hot inputs that skips the multiplication.
2. **`padding_idx`:** that row starts as zeros and gets no gradient ✅[^1] (lab: row 0 and its gradient both `[0, 0, 0]`) ✅[^12].
3. **Other options:** `max_norm` renormalizes any looked-up row whose norm exceeds it, modifying the weight in place during the forward pass; `sparse=True` returns a sparse gradient, which only some optimizers accept (SGD, SparseAdam, Adagrad on CPU) ✅[^1].
4. **Cosine similarity:** the cosine of the angle between two vectors, `xᵀy / (‖x‖·‖y‖)`, in `[−1, 1]` ✅[^3]. PyTorch's `F.cosine_similarity` floors each norm at `eps = 1e-8` and works along `dim = 1` by default ✅[^2]. It ignores length: `cos(a, 2a) = 1`, `cos(a, −a) = −1` (lab) ✅[^12].
5. **Learned, not designed:** the vectors become meaningful only through training. word2vec's skip-gram (predict the surrounding words from the centre word) and continuous bag of words (predict the centre word from its context) are self-supervised models ✅[^3]; each word gets two `d`-dimensional vectors there, one as centre and one as context word ✅[^3].

### Self-supervised learning: pretext tasks
A pretext task is a task invented only to produce a training signal from unlabeled data. Two families:
- **Masked prediction:** hide part of the input and reconstruct it. Masked autoencoders (MAE) mask random patches of an image and reconstruct the missing pixels with an asymmetric encoder–decoder; masking a high share such as 75 % still gives a meaningful task, and a plain ViT-Huge reached 87.8 % on ImageNet-1K data only ✅[^11]. The text version (BERT's masked tokens) lives in `machine-learning/transformers/pretraining-and-scaling-laws.md`.
- **Contrastive prediction:** instead of reconstructing the hidden part, pick it out from a set of candidates. CPC (contrastive predictive coding) predicts the future in a latent space with a probabilistic contrastive loss, which stays tractable thanks to negative sampling ✅[^4].

### The InfoNCE loss and its temperature
1. **Definition:** InfoNCE is the categorical cross-entropy of picking the one positive sample out of `N` samples, the other `N − 1` being negatives drawn from a proposal distribution; the name comes from NCE, noise-contrastive estimation ✅[^4].
2. **Why more negatives help:** minimizing it maximizes a lower bound on mutual information, `I ≥ log(N) − L_N`, which becomes tighter as `N` grows ✅[^4].
3. **SimCLR's version (NT-Xent, normalized temperature-scaled cross-entropy):** a batch of `N` examples gives `2N` augmented views; for each positive pair the other `2(N − 1)` views are the negatives, `sim` is the dot product of ℓ2-normalized vectors (cosine similarity) and `τ` is a temperature ✅[^5]: `ℓ(i, j) = −log[exp(sim(z_i, z_j)/τ) / Σ_(k≠i) exp(sim(z_i, z_k)/τ)]`.
4. **Hardness-aware:** the contrastive loss automatically weights hard negatives more, and the temperature sets how strongly ✅[^7] (Mental model artifact) ✅[^12]. A small `τ` makes the embeddings more uniform but less tolerant of negatives that are semantically similar to the anchor; a large `τ` is more tolerant but may leave the embeddings not uniform enough: the "uniformity-tolerance dilemma" ✅[^7]. Asymptotically, the loss optimizes two properties: alignment (positives close) and uniformity (normalized features spread over the hypersphere) ✅[^8].
5. **Normalization and `τ` together:** SimCLR found that the contrastive loss benefits from normalized embeddings and an appropriately adjusted temperature; with ℓ2 normalization its linear-evaluation top-1 was 59.7, 64.4, 60.7 and 58.0 % for `τ = 0.05, 0.1, 0.5, 1.0` ✅[^5].

### SimCLR: augmentations and a projection head
1. **Two views per image:** random crop resized back to full size, random colour distortion and random Gaussian blur; composing crop with colour distortion is crucial ✅[^5].
2. **Encoder, then head:** an encoder `f` gives the representation `h`, and a small MLP (multilayer perceptron) with one hidden ReLU layer gives `z = g(h)`, on which the loss is computed ✅[^5]. After training, `g` is thrown away and `h` is used downstream ✅[^5]. A nonlinear head beat a linear one by 3 % and no head by more than 10 %; the paper's explanation is that `g` can remove information that the downstream task needs ✅[^5].
3. **Scale:** batch sizes from 256 to 8192 with the LARS optimizer, 4096 by default; contrastive learning benefits from larger batches and longer training than supervised learning; a linear classifier on SimCLR features of a 4× wider ResNet-50 reached 76.5 % top-1 on ImageNet ✅[^5].

### CLIP: images against texts
1. **Data and objective:** 400 million (image, text) pairs; in a batch of `N` pairs the model predicts which of the `N × N` pairings actually occurred, with a symmetric cross-entropy over the similarity scores ✅[^6]. The rows of the `N × N` matrix are an image-to-text InfoNCE and the columns a text-to-image one.
2. **Details that differ from SimCLR:** only a linear projection into the joint embedding space, no nonlinear head; the temperature is learned, initialized to the equivalent of 0.07 and clipped so the logits are never scaled by more than 100; the minibatch is 32,768 ✅[^6].
3. **Zero-shot classification:** embed prompts such as "A photo of a {label}." and pick the closest; this matched the original ResNet-50 on ImageNet (76.2 %) without its training labels ✅[^6]. The contrastive objective gave a 4× efficiency gain in zero-shot transfer over a predictive one ✅[^6].

### Collapse, and how methods without negatives avoid it
1. **The trivial solution:** a representation that is constant across views always predicts itself perfectly ✅[^9]; for SimSiam's loss and structure, collapsing solutions exist ✅[^10]. With negatives, the constant embedding is not a minimum: all similarities are equal, so the loss sits at `log(2N − 1)` (6.236 for `N = 256` in the lab) ✅[^12].
2. **BYOL (Bootstrap Your Own Latent):** an online network with an extra predictor learns to predict a target network's projection of another view; the target's weights are an exponential moving average of the online ones (`τ_base = 0.996`), the loss is the mean squared error between normalized vectors, equal to `2 − 2·cos`, and no gradient flows into the target ✅[^9]. It uses no negative pairs and reached 74.3 % top-1 on ImageNet ✅[^9]. The predictor is critical to prevent collapse, and the authors' hypothesis is that the slow target keeps the predictor near-optimal ✅[^9].
3. **SimSiam:** BYOL without the momentum encoder: two views through one shared encoder, a prediction MLP on one side, a stop-gradient on the other, and a symmetrized negative cosine similarity ✅[^10]. It needs no negatives, no large batches and no momentum encoder; removing the stop-gradient drops accuracy to 0.1 %, and removing the predictor also collapses ✅[^10]. A healthy, non-collapsed normalized output has a per-channel std of about `1/√d` ✅[^10], 0.177 for `d = 32` ✅[^12].

## Worked example
Synthetic data with 20 classes; each example has 16 "signal" dimensions (class prototype plus noise) and 16 "nuisance" dimensions of large random noise. An augmentation resamples the nuisance dimensions, jitters the signal and zeroes 20 % of the values, so the only thing two views share is the class signal. An MLP encoder (`h`, 64 dimensions) with a BatchNorm projection head (`z`, 32 dimensions) is trained for 400 steps with batch 256 and evaluated by the cosine 5-nearest-neighbour (5-NN) accuracy on 1,000 held-out examples. The core of the loss:

```python
z = F.normalize(torch.cat([z1, z2]), dim=1)       # 2N views on the unit sphere
s = z @ z.T / tau
s.fill_diagonal_(float("-inf"))                   # a view is not its own negative
target = torch.cat([torch.arange(n, 2 * n), torch.arange(0, n)])   # view i's positive
loss = F.cross_entropy(s, target)
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-24, PyTorch 2.15.0, two runs identical; output lines 1–4 and 10–21 (lines 5–9 are the Mental model artifact) ✅[^12]:

```text
== (1) nn.Embedding is a lookup table: row i of the weight ==
emb(ids) == one_hot(ids) @ weight: True | shape (1, 3, 3)
padding row 0: [0.0, 0.0, 0.0] | its grad: [0.0, 0.0, 0.0] | grad row 4: [1.0, 1.0, 1.0]
cos(a, 2a) = 1.0 | cos(a, -a) = -1.0 | one-hot words 1 vs 4: 0.0
== (3) baselines (5-NN, cosine) ==
raw input kNN acc 0.294 | signal dims only 0.861 | chance 0.050 | 1/sqrt(32) = 0.177
== (4) InfoNCE, temperature sweep (400 steps, batch 256) ==
infonce       tau=0.05 final loss   2.187 | kNN acc h 0.795 z 0.828 | pos cos 0.730 neg cos 0.025 | std of normalized z 0.174
infonce       tau=0.1  final loss   2.347 | kNN acc h 0.812 z 0.830 | pos cos 0.708 neg cos 0.002 | std of normalized z 0.176
infonce       tau=0.5  final loss   4.885 | kNN acc h 0.785 z 0.787 | pos cos 0.786 neg cos 0.003 | std of normalized z 0.176
infonce       tau=1.0  final loss   5.501 | kNN acc h 0.735 z 0.738 | pos cos 0.810 neg cos 0.002 | std of normalized z 0.176
constant embedding: InfoNCE loss 6.236 = log(2N - 1) = 6.236
== (5) collapse: no negatives (1500 steps) ==
positive-only tau=-    final loss  -1.000 | kNN acc h 0.594 z 0.449 | pos cos 1.000 neg cos 1.000 | std of normalized z 0.002
simsiam-no-sg tau=-    final loss  -1.000 | kNN acc h 0.480 z 0.320 | pos cos 1.000 neg cos 1.000 | std of normalized z 0.003
simsiam       tau=-    final loss  -0.798 | kNN acc h 0.800 z 0.803 | pos cos 0.806 neg cos 0.004 | std of normalized z 0.176
```

<details><summary>Full script (prints the output above)</summary>

```python
# Embedding lookup, cosine similarity, InfoNCE (NT-Xent) with a temperature sweep, and collapse
# (positive-only loss, SimSiam with and without stop-gradient) on synthetic data (PyTorch, CPU).
import math
import torch
from torch import nn
import torch.nn.functional as F
torch.manual_seed(0)

print("== (1) nn.Embedding is a lookup table: row i of the weight ==")
emb = nn.Embedding(5, 3, padding_idx=0)
ids = torch.tensor([[1, 4, 0]])
one_hot = F.one_hot(ids, 5).float()
print("emb(ids) == one_hot(ids) @ weight:", torch.allclose(emb(ids), one_hot @ emb.weight), "| shape", tuple(emb(ids).shape))
emb(ids).sum().backward()
print("padding row 0:", emb.weight[0].tolist(), "| its grad:", emb.weight.grad[0].tolist(), "| grad row 4:", emb.weight.grad[4].tolist())
a, b = torch.tensor([1.0, 2.0, 3.0]), torch.tensor([2.0, 4.0, 6.0])
print("cos(a, 2a) =", round(F.cosine_similarity(a, b, dim=0).item(), 4), "| cos(a, -a) =",
      round(F.cosine_similarity(a, -a, dim=0).item(), 4), "| one-hot words 1 vs 4:",
      F.cosine_similarity(one_hot[0, 0], one_hot[0, 1], dim=0).item())

print("== (2) temperature: softmax weight on each negative (positive sim 0.8) ==")
sims = torch.tensor([0.8, 0.7, 0.3, 0.0, -0.3])           # index 0 = positive, rest = negatives
for tau in [0.05, 0.1, 0.5, 1.0]:
    p = torch.softmax(sims / tau, 0)
    print(f"tau={tau:<4}: loss {(-torch.log(p[0])).item():.3f} | weight on negatives (0.7, 0.3, 0.0, -0.3):",
          [round(v, 3) for v in p[1:].tolist()])

# Synthetic data: 20 classes; 16 "signal" dims = class prototype + small noise; 16 "nuisance" dims = large
# random noise that carries no class information (think: lighting, colour).
K, D_SIG, D_NUI = 20, 16, 16
protos = torch.randn(K, D_SIG)
def sample(n):
    y = torch.randint(0, K, (n,))
    return torch.cat([protos[y] + 1.0 * torch.randn(n, D_SIG), 3.0 * torch.randn(n, D_NUI)], 1), y
def augment(x):                                             # resample nuisance, jitter signal, drop 20 % of dims
    sig = x[:, :D_SIG] + 0.3 * torch.randn_like(x[:, :D_SIG])
    v = torch.cat([sig, 3.0 * torch.randn(x.shape[0], D_NUI)], 1)
    return v * (torch.rand_like(v) > 0.2)
x_tr, y_tr = sample(2000); x_te, y_te = sample(1000)

def knn_acc(f_tr, f_te, k=5):                               # cosine 5-nearest-neighbour accuracy
    s = F.normalize(f_te, dim=1) @ F.normalize(f_tr, dim=1).T
    votes = y_tr[s.topk(k, dim=1).indices]
    return (votes.mode(1).values == y_te).float().mean().item()

class Net(nn.Module):
    def __init__(self, predictor=False):
        super().__init__()
        self.f = nn.Sequential(nn.Linear(32, 128), nn.ReLU(), nn.Linear(128, 64))             # encoder -> h
        self.g = nn.Sequential(nn.Linear(64, 64), nn.BatchNorm1d(64), nn.ReLU(), nn.Linear(64, 32),
                               nn.BatchNorm1d(32))                                         # projection head -> z
        self.q = (nn.Sequential(nn.Linear(32, 16), nn.BatchNorm1d(16), nn.ReLU(), nn.Linear(16, 32))
                  if predictor else None)                                                  # SimSiam predictor
    def forward(self, x):
        h = self.f(x); return h, self.g(h)

def info_nce(z1, z2, tau):                                  # NT-Xent: 2N views, 2(N-1) negatives per anchor
    z = F.normalize(torch.cat([z1, z2]), dim=1)
    s = z @ z.T / tau
    s.fill_diagonal_(float("-inf"))                         # an example is not its own negative
    n = z1.shape[0]
    target = torch.cat([torch.arange(n, 2 * n), torch.arange(0, n)])
    return F.cross_entropy(s, target)

def train(loss_name, tau=0.1, steps=400, bs=256):
    torch.manual_seed(1)
    net = Net(predictor=loss_name.startswith("simsiam"))
    opt = torch.optim.Adam(net.parameters(), lr=1e-3)
    for _ in range(steps):
        xb = x_tr[torch.randint(0, 2000, (bs,))]
        _, z1 = net(augment(xb)); _, z2 = net(augment(xb))
        if loss_name == "infonce":
            loss = info_nce(z1, z2, tau)
        elif loss_name == "positive-only":                  # pull positives together, no negatives
            loss = -F.cosine_similarity(z1, z2).mean()
        else:                                               # SimSiam: predictor p = q(z), symmetric loss
            p1, p2 = net.q(z1), net.q(z2)
            t1, t2 = (z1.detach(), z2.detach()) if loss_name == "simsiam" else (z1, z2)
            loss = -(F.cosine_similarity(p1, t2).mean() + F.cosine_similarity(p2, t1).mean()) / 2
        opt.zero_grad(); loss.backward(); opt.step()
    net.eval()
    with torch.no_grad():
        h_tr, z_tr = net(x_tr); h_te, z_te = net(x_te)
        zn = F.normalize(z_te, dim=1)
        _, za = net(augment(x_te)); _, zb = net(augment(x_te))
        pos = F.cosine_similarity(za, zb).mean().item()
        neg = (zn @ zn.T).fill_diagonal_(0).sum().item() / (1000 * 999)
        print(f"{loss_name:13} tau={tau if loss_name == 'infonce' else '-':<4} final loss {loss.item():7.3f} | "
              f"kNN acc h {knn_acc(h_tr, h_te):.3f} z {knn_acc(z_tr, z_te):.3f} | pos cos {pos:.3f} "
              f"neg cos {neg:.3f} | std of normalized z {zn.std(0).mean().item():.3f}")

print("== (3) baselines (5-NN, cosine) ==")
print(f"raw input kNN acc {knn_acc(x_tr, x_te):.3f} | signal dims only {knn_acc(x_tr[:, :D_SIG], x_te[:, :D_SIG]):.3f} | "
      f"chance {1 / K:.3f} | 1/sqrt(32) = {1 / math.sqrt(32):.3f}")
print("== (4) InfoNCE, temperature sweep (400 steps, batch 256) ==")
for tau in [0.05, 0.1, 0.5, 1.0]:
    train("infonce", tau)
z_const = torch.ones(256, 32)
print(f"constant embedding: InfoNCE loss {info_nce(z_const, z_const, 0.1).item():.3f} = log(2N - 1) = {math.log(511):.3f}")
print("== (5) collapse: no negatives (1500 steps) ==")
for name in ["positive-only", "simsiam-no-sg", "simsiam"]:
    train(name, steps=1500)
```

</details>

Reading it, block by block:
- **Baselines:** on the raw input, the nuisance dimensions drown the class signal (5-NN 0.294); an oracle that keeps only the 16 signal dimensions reaches 0.861.
- **InfoNCE learned the invariance:** with `τ = 0.1`, the learned `h` reaches 0.812, close to the oracle, without labels and without being told which dimensions are noise: the augmentation defined what to ignore. Negatives end up near-orthogonal (mean cosine 0.002) and the per-dimension std of normalized `z` is 0.176, the `1/√32 = 0.177` of a spread-out embedding.
- **Temperature:** accuracy peaks at `τ = 0.1` and falls to 0.735 at `τ = 1.0`, the same shape as SimCLR's ImageNet table ✅[^5]. At `τ = 0.05` the negatives stay more similar on average (0.025): the loss is dominated by the hardest few. Loss values are not comparable across temperatures: dividing by a larger `τ` caps how far the softmax can be pushed.
- **Collapse:** pulling positives together with no negatives reaches the perfect loss −1.000 with every output pointing the same way (negative cosine 1.000, std 0.002). SimSiam's predictor without stop-gradient collapses the same way; with stop-gradient it keeps std 0.176 and 0.800 accuracy. The collapsed runs still score above chance on 5-NN because cosine similarity ignores the tiny length of what is left: read collapse from the std and the negative cosine, not from the loss.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Loss reaches its minimum but features are useless | Collapse: all outputs equal | Constant outputs satisfy a positive-only objective ✅[^9] ✅[^10]; lab std 0.002 ✅[^12] |
| Same-class examples in one batch | Treated as negatives and pushed apart | Small `τ` is intolerant of semantically similar negatives ✅[^7] |
| Very small batch | Fewer negatives, a looser bound | `log(N) − L_N` tightens with `N` ✅[^4]; SimCLR gains from larger batches ✅[^5] |
| Embeddings not normalized before the dot product | Worse results in SimCLR's table (57.2 % at `τ = 10`) | Normalization and temperature work together ✅[^5] |
| Using `z = g(h)` downstream | Usually worse than `h` | The head can discard useful information ✅[^5] |
| Learned temperature growing without limit | CLIP clips the logit scale at 100 | Documented safeguard ✅[^6] |
| `nn.Embedding(..., max_norm=...)` | The weight is modified in place in the forward pass | Documented ✅[^1] |
| `sparse=True` with Adam | Not one of the supported optimizers | Only SGD, SparseAdam, Adagrad (CPU) ✅[^1] |
| Zero vector in `F.cosine_similarity` | Result 0, not NaN | Norms are floored at `eps = 1e-8` ✅[^2] |
| BYOL with small batches or crop-only augmentation | Degrades less than SimCLR (59.4 vs 40.3 % with crops only) | No negatives needed ✅[^9] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Contrastive with negatives (SimCLR) | Collapse ruled out by the loss itself (lab) ✅[^12] | Wants large batches and long training ✅[^5]; false negatives ✅[^7] |
| No negatives (BYOL, SimSiam) | No large batches; SimSiam needs no momentum encoder either ✅[^10] | Relies on the predictor and stop-gradient to avoid collapse ✅[^9] ✅[^10] |
| Masked prediction (MAE) | 87.8 % with ImageNet-1K only; the encoder sees only visible patches ✅[^11] | Reconstructs pixels, a different target from invariance |
| Image–text contrastive (CLIP) | Zero-shot classifiers from prompts ✅[^6] | 400 M pairs and batches of 32,768 ✅[^6] |
| Low vs high `τ` | Low: uniform, focuses on hard negatives ✅[^7] | Low: intolerant of similar negatives ✅[^7]; high: lab accuracy 0.735 ✅[^12] |

## Takeaways
- Normalize embeddings before the dot product and start from `τ ≈ 0.1` for an InfoNCE loss; sweep it, it changes results by several points. [rule-candidate]
- Monitor the per-dimension std of normalized outputs (healthy ≈ `1/√d`) and the mean negative cosine during self-supervised training; a perfect loss proves nothing. [rule-candidate]
- Throw the projection head away after contrastive pretraining and use the encoder's `h`.
- The augmentations decide what the embedding becomes invariant to; choose them as deliberately as a label.

## Verification status
- Verified: 70 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [torch.nn.Embedding](https://docs.pytorch.org/docs/2.15/generated/torch.nn.Embedding.html) — PyTorch, 2026 (2.15). Backs: lookup table, weight shape and `N(0, 1)` init, input/output shapes, `padding_idx`, `max_norm` in place, `sparse` and its optimizers. [^1]
- [torch.nn.functional.cosine_similarity](https://docs.pytorch.org/docs/2.15/generated/torch.nn.functional.cosine_similarity.html) — PyTorch, 2026 (2.15). Backs: formula with norms floored at `eps = 1e-8`, default `dim = 1`. [^2]
- [Word Embedding (word2vec) (Dive into Deep Learning, 15.1)](https://d2l.ai/chapter_natural-language-processing-pretraining/word2vec.html) — Zhang, Lipton, Li, Smola, living. Backs: one-hot cosine 0, cosine formula, skip-gram and CBOW are self-supervised, two vectors per word. [^3]
- [Representation Learning with Contrastive Predictive Coding](https://ar5iv.labs.arxiv.org/html/1807.03748) — van den Oord, Li, Vinyals, 2018. Backs: InfoNCE definition and name, mutual-information bound tightening with `N`, prediction in latent space, negative sampling. [^4]
- [A Simple Framework for Contrastive Learning of Visual Representations (SimCLR)](https://ar5iv.labs.arxiv.org/html/2002.05709) — Chen, Kornblith, Norouzi, Hinton, 2020. Backs: NT-Xent with `2(N − 1)` negatives, augmentations, projection head and its gains, normalization and temperature table, batch sizes and LARS, 76.5 %. [^5]
- [Learning Transferable Visual Models From Natural Language Supervision (CLIP)](https://ar5iv.labs.arxiv.org/html/2103.00020) — Radford et al., 2021. Backs: 400 M pairs, `N × N` symmetric objective, linear projection, learned temperature 0.07 clipped at 100, batch 32,768, prompt template, 76.2 % zero-shot, 4× efficiency. [^6]
- [Understanding the Behaviour of Contrastive Loss](https://ar5iv.labs.arxiv.org/html/2012.09740) — Wang, Liu, 2020 (arXiv:2012.09740, December 2020; later at CVPR 2021). Backs: hardness-aware loss, temperature controls the penalty on hard negatives, uniformity-tolerance dilemma and its direction (small `τ`: more uniform, less tolerant; large `τ`: more tolerant, less uniform). [^7]
- [Understanding Contrastive Representation Learning through Alignment and Uniformity on the Hypersphere](https://arxiv.org/abs/2005.10242) — Wang, Isola, 2020. Backs: alignment and uniformity, asymptotic optimization by the contrastive loss. [^8]
- [Bootstrap Your Own Latent (BYOL)](https://ar5iv.labs.arxiv.org/html/2006.07733) — Grill et al., 2020. Backs: online/target networks, moving average `τ_base = 0.996`, normalized MSE, stop-gradient, no negatives, 74.3 %, constant-representation collapse, predictor's role, robustness to batch size and augmentations. [^9]
- [Exploring Simple Siamese Representation Learning (SimSiam)](https://ar5iv.labs.arxiv.org/html/2011.10566) — Chen, He, 2020. Backs: architecture, symmetric negative cosine, collapsing solutions exist, stop-gradient essential (0.1 % without), predictor needed, `1/√d` std, BYOL without momentum encoder. [^10]
- [Masked Autoencoders Are Scalable Vision Learners](https://arxiv.org/abs/2111.06377) — He et al., 2021. Backs: random patch masking and pixel reconstruction, asymmetric encoder–decoder, 75 % masking, 87.8 % ViT-Huge. [^11]
- `machine-learning/lab-setup.md` — the lab where the embedding lookup, temperature weights, InfoNCE sweep and collapse runs ran on 2026-11-24 (script: `mllab/embeddings-and-self-supervised-learning/lab.py`). [^12]

## Related
- `machine-learning/transformers/pretraining-and-scaling-laws.md` — masked and next-token prediction as the language-model pretext tasks.
- `machine-learning/transformers/vision-transformers.md` — the patch-based encoder that MAE and CLIP use for images.
- `machine-learning/deep-learning/data-augmentation-and-transfer-learning.md` — the augmentations that define the views, and fine-tuning the learned encoder.
- `machine-learning/deep-learning/normalization-and-dropout.md` — the BatchNorm layers inside the projection head.
- `machine-learning/unsupervised-learning/principal-component-analysis.md` — a linear, closed-form way to get low-dimensional representations.
- `machine-learning/transformers/tokenization.md` — where the ids that `nn.Embedding` looks up come from.
