---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/privacy-preserving-ml
status: verified
applies-to: ["any"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, privacy, federated-learning, fedavg, fedsgd, non-iid, label-skew, communication-cost, secure-aggregation, gradient-leakage, user-level-differential-privacy]
---

# Federated learning: FedAvg, non-IID clients, secure aggregation and what it protects

## Summary
**TL;DR:** Federated learning (FL) trains one shared model while the training data stays on the clients (phones or organizations): each round the server sends the model to a sample of clients, each runs a few epochs of SGD (stochastic gradient descent) on its own data, and the server averages the returned models weighted by data size (FedAvg, federated averaging). More local work per round cuts the number of communication rounds, the scarce resource, but clients whose data is not IID (not independent and identically distributed), for example each holding only two classes, slow it down. FL minimizes data collection; it is not a privacy guarantee: one client's update can reveal its labels or even its examples. Secure aggregation lets the server see only the sum of updates, and clipping plus noise on updates (user-level differential privacy) bounds what that sum reveals.
**Use this when:** you consider training on data that cannot be centralized, choose the client fraction, local epochs or batch size, see FedAvg stall on heterogeneous clients, or must say what a federated system does and does not protect.
**Not this doc:** data-center training across many GPUs (graphics processing units) → `machine-learning/deep-learning/distributed-training.md`; the noise mechanisms and budgets → `machine-learning/privacy-preserving-ml/differential-privacy.md`; per-example DP training → `machine-learning/privacy-preserving-ml/differentially-private-training.md`.

## Problem
Useful training data often sits on devices or inside organizations that should not or may not ship it to one place ✅[^2]. Plain distributed SGD over such clients needs very many rounds, and in this setting communication, not computation, dominates: uploads may be limited to 1 MB/s or less, and clients join only when charged and on unmetered Wi-Fi ✅[^1]. The data is non-IID (each user's data reflects that user), unbalanced, and spread over more clients than there are examples per client ✅[^1]. And "the raw data never leaves the device" is easy to mistake for privacy: the baseline federated model has no formal privacy guarantee, and a client's update can let the server infer its training data ✅[^2].

## Mental model
**Analogy:** a cookbook revised by mail. The editor posts the current recipe to some cooks; each tries it in their own kitchen with their own ingredients, adjusts it a little, and mails back only the adjusted recipe; the editor averages the adjustments. Cooks who only ever cook fish pull the recipe toward fish (non-IID data). The adjustments still say what is in each kitchen: a cook who suddenly adds more salt and lemon is plainly cooking fish. Sealed envelopes that the editor can open only all together, as one summed adjustment, are secure aggregation.

**Artifact:** one round of local training on a client that holds mostly digits 2 and 7, and the change it sends back for the 10 output-layer biases; printed by the full script in the Worked example; lab run (`machine-learning/lab-setup.md`), 2026-11-25, PyTorch 2.15.0 ✅[^6]:

```text
 true label counts      : [0, 0, 34, 0, 0, 0, 0, 31, 2, 0]
 output-bias change x100: [-4.1, -3.5, 14.1, -3.6, -3.6, -3.4, -2.9, 12.2, -2.1, -3.1]
 classes with the 2 largest increases: [2, 7]
```

Without seeing a single image, the server reads the client's two classes off the two biases that rose.

## How it works
### One round of FedAvg
**Two actors:**
- **Server** — its job: hold the global model and combine updates, via a weighted average of the returned weights.
- **Client** — its job: improve the received model on its local data, via `E` epochs of mini-batch SGD.

```
[Server]                                  [Client k, k in the sampled set]
w_t ──── send w_t ═══ network ═══════════▶ w ← w_t
                                           repeat E epochs, mini-batches of B:
                                             w ← w − η ∇F_k(w)
     ◀══════════ network ═══ send w_k ──── w_k
w_{t+1} = Σ_k (n_k / m_t) · w_k
```

1. **Server, select:** pick a random fraction `C` of the `K` clients ✅[^1]. Example: `C = 0.5`, `K = 20` → 10 clients per round.
2. **Server → network → clients:** send the current weights `w_t` ✅[^1].
3. **Client, locally:** run `E` passes over its `n_k` examples with mini-batches of size `B`, starting from `w_t` ✅[^1]. That is about `u = E·n_k/B` local steps ✅[^1]: `5·67/10 ≈ 34` for a client with 67 examples, `E = 5`, `B = 10` (35 in the lab, whose last batch per epoch holds 7).
4. **Client → network → server:** upload the new weights `w_k` (or the change `w_k − w_t`) ✅[^1].
5. **Server, combine:** `w_{t+1} = Σ_k (n_k/m_t) · w_k` over the selected clients, with `m_t = Σ_k n_k` their total data: the average weighted by local data size ✅[^1]. Example: two clients with 30 and 70 examples get weights 0.3 and 0.7.

**FedSGD** is the special case `E = 1`, `B = ∞`: each client computes one gradient on all its data and the server takes one step ✅[^1]. FedAvg adds local computation to save communication; McMahan et al. report 10–100× fewer rounds than synchronized SGD ✅[^1], and on IID MNIST (handwritten digits) more local computation cut the rounds to a target accuracy by 35× for a CNN (convolutional neural network) ✅[^1]. Averaging works because every client starts the round from the same `w_t`: two models trained from the same initialization on different data average well, while models from different initializations can average to an arbitrarily bad model ✅[^1].

### Non-IID clients
- **Label distribution skew** (prior probability shift): clients' label distributions `P_k(y)` differ, as when each region sees different animals ✅[^2]. It is the usual way to build a synthetic non-IID benchmark, by partitioning a dataset on its labels ✅[^2]. McMahan et al.'s pathological partition sorts MNIST by digit, cuts 200 shards of 300 and gives each of 100 clients 2 shards ✅[^1].
- **Effect:** the speedup from local computation drops from 35× to 2.8–3.7× on that partition, yet averaging models trained on entirely different digit pairs still converges ✅[^1]. Separately, very many local epochs made FedAvg plateau or diverge on a character-level LSTM (long short-term memory network) trained on Shakespeare's works, while the MNIST CNN, even on the pathological partition, showed no significant slowdown ✅[^1]. Defining and handling non-IID data remains an open problem ✅[^2].

### What federated learning does and does not protect
1. **What it gives:** focused collection and data minimization: raw data stays local, only focused updates meant for immediate aggregation leave, and the server need keep them only briefly ✅[^2]. An update cannot carry more information than the raw data ✅[^1].
2. **What it does not:** a formal guarantee ✅[^2]. A sparse update can be explicit, for example the non-zero gradients of a bag-of-words model reveal exactly which words the user typed ✅[^1]. With cross-entropy over one-hot labels, the gradient for the true class's logit lies in `(−1, 0)` and for every other class in `(0, 1)`, so a single example's label can be read from the signs of the last layer's gradient with 100 % accuracy ✅[^5]. Gradient matching can reconstruct training images pixel by pixel and text token by token ✅[^4].
3. **Threat models:** an honest-but-curious server follows the protocol but inspects every update it receives; a malicious one may also tamper with training ✅[^2].

### Secure aggregation (Bonawitz et al.)
Secure aggregation lets each client submit a vector so that the server learns only an aggregate, typically the sum ✅[^2]. The core idea, Protocol 0:
1. **Each pair of clients `u`, `v`:** agree on random vectors `s_{u,v}` drawn uniformly from `[0, R)` and form `p_{u,v} = s_{u,v} − s_{v,u} (mod R)`, so `p_{u,v} = −p_{v,u}` ✅[^3].
2. **Each client `u` → server:** sends `y_u = x_u + Σ_v p_{u,v} (mod R)`, which looks uniformly random on its own ✅[^3].
3. **Server:** sums the `y_u`; every mask appears once with each sign and cancels, leaving `Σ x_u (mod R)` ✅[^3].
4. **Dropouts:** a client that vanishes leaves its masks uncancelled, so the full protocol adds secret sharing of the mask seeds (any `t` shares recover a secret, fewer reveal nothing) and double masking against a server that lies about dropouts ✅[^3]. It tolerates up to 1/3 of users failing and, for 16-bit values, costs 1.73× the plain upload for 2¹⁰ users with 2²⁰-dimensional vectors ✅[^3].

Its limits: it assumes a semi-honest server in its key setup, the server still sees each round's sum (which can leak), it is inefficient for sparse vectors, and it cannot check that inputs are well formed ✅[^2]. Because the server sees only the sum, defending against clients that send bad updates becomes harder ✅[^2]. Cryptographic tools like this restrict disclosure to the specified output; deciding how much that output may reveal is differential privacy's job ✅[^7].

### Differential privacy on top
**User-level DP:** neighbouring datasets differ by all the records of one client, which is stronger than one-record DP when a user contributes many examples ✅[^2]. The server clips the L2 norm (Euclidean length) of each client update, aggregates, and adds Gaussian noise to the aggregate, tracking the budget across rounds with advanced composition or a moments accountant; for moderate budgets and without a large enough dataset, that noise can cost a lot of accuracy ✅[^2].

## Worked example
Digits (`load_digits`, 1,347 training and 450 test images, 10 classes) split over `K = 20` clients either at random (IID) or label-skewed (sorted by label, 40 shards, 2 per client); a 64-32-10 ReLU (rectified linear unit) network with 2,410 parameters; `C = 0.5`, `B = 10`, learning rate 0.05 (0.5 for FedSGD); 50 rounds. Then one client's update, and Protocol 0 on 5 clients' bias updates, in integers mod `2³²` with 16 fractional bits. The core of a round:

```python
chosen = r.choice(K, size=int(C * K), replace=False)          # a fraction C of clients
new = [local_train(w, clients[k], E, B, lr, gen) for k in chosen]
w = sum(float(n / n_k.sum()) * wk for n, wk in zip(n_k, new))   # weighted by local data size
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-25, PyTorch 2.15.0, scikit-learn 1.9.1, numpy 2.5.5, two runs identical ✅[^6]:

```text
client 0 labels, IID : [10, 6, 10, 4, 9, 9, 2, 5, 7, 6]
client 0 labels, skew: [0, 0, 34, 0, 0, 0, 0, 31, 2, 0]
model parameters: 2410; one upload = 9640 bytes (float32); per round with C=0.5: 192800 bytes down+up

test accuracy after round t (C = 0.5, B = 10, lr = 0.05)
 partition  algorithm         t=1    t=5    t=10   t=20   t=50   first t >= 0.90
 IID        FedSGD (E=1,B=all) 0.171  0.760  0.860  0.922  0.956   13
 IID        FedAvg E=1         0.136  0.700  0.816  0.909  0.944   18
 IID        FedAvg E=5         0.680  0.916  0.942  0.956  0.976   4
 IID        FedAvg E=20        0.878  0.951  0.960  0.969  0.980   2
 label-skew FedSGD (E=1,B=all) 0.200  0.729  0.827  0.889  0.953   21
 label-skew FedAvg E=1         0.140  0.658  0.800  0.867  0.940   26
 label-skew FedAvg E=5         0.367  0.807  0.887  0.927  0.964   14
 label-skew FedAvg E=20        0.436  0.831  0.907  0.936  0.964   6
 centralized SGD, epoch  1: test accuracy 0.873
 centralized SGD, epoch  5: test accuracy 0.960
 centralized SGD, epoch 20: test accuracy 0.978

== what one client's update reveals (label-skew client 0, one round from the initial model) ==
 true label counts      : [0, 0, 34, 0, 0, 0, 0, 31, 2, 0]
 output-bias change x100: [-4.1, -3.5, 14.1, -3.6, -3.6, -3.4, -2.9, 12.2, -2.1, -3.1]
 classes with the 2 largest increases: [2, 7]

== secure aggregation, pairwise masks (Protocol 0), 5 clients, the 10 bias deltas ==
 client 0 sends (first 4 of 10): [2041239655, 2734074456, 3569105706, 1209479853]
 sum decoded by server x100    : [-3.8, -17.3, 18.5, 15.5, -0.1, -17.4, 1.0, 17.6, 0.2, -14.2]
 true sum of updates x100      : [-3.8, -17.3, 18.5, 15.5, -0.1, -17.4, 1.0, 17.6, 0.2, -14.2]
 max |decoded - true| = 1.3e-05
```

<details><summary>Full script (prints the output above)</summary>

```python
# FedAvg as a loop over simulated clients (scikit-learn's digits split over 20 clients), IID vs
# label-skewed (2 digit classes per client), local epochs E, FedSGD; what one client's update reveals;
# pairwise-mask secure aggregation (Bonawitz et al., Protocol 0) in integer arithmetic mod 2^32.
import numpy as np
import torch
from torch import nn
from sklearn.datasets import load_digits
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
torch.manual_seed(0); torch.set_num_threads(1)
rng = np.random.default_rng(0)

X, y = load_digits(return_X_y=True)
Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.25, random_state=0, stratify=y)
sc = StandardScaler().fit(Xtr)
Xtr, Xte = (torch.tensor(sc.transform(a), dtype=torch.float32) for a in (Xtr, Xte))
ytr, yte = torch.tensor(ytr), torch.tensor(yte)
K = 20
iid = np.array_split(rng.permutation(len(ytr)), K)                  # random equal split
order = np.argsort(ytr.numpy(), kind="stable")                      # sort by label, 40 shards, 2 per client
shards = np.array_split(order, 2 * K)
perm = rng.permutation(2 * K)
skew = [np.concatenate([shards[perm[2 * k]], shards[perm[2 * k + 1]]]) for k in range(K)]
print("client 0 labels, IID :", np.bincount(ytr[iid[0]].numpy(), minlength=10).tolist())
print("client 0 labels, skew:", np.bincount(ytr[skew[0]].numpy(), minlength=10).tolist())

def make_model():
    return nn.Sequential(nn.Linear(64, 32), nn.ReLU(), nn.Linear(32, 10))
def get(m): return torch.cat([p.detach().reshape(-1) for p in m.parameters()])
def put(m, w):
    i = 0
    for p in m.parameters():
        p.data.copy_(w[i:i + p.numel()].view_as(p)); i += p.numel()
def local_train(w, idx, E, B, lr, gen):
    m = make_model(); put(m, w)
    opt = torch.optim.SGD(m.parameters(), lr=lr)
    for _ in range(E):
        perm = idx[torch.randperm(len(idx), generator=gen).numpy()]
        for s in range(0, len(perm), B):
            b = perm[s:s + B]
            opt.zero_grad()
            nn.functional.cross_entropy(m(Xtr[b]), ytr[b]).backward()
            opt.step()
    return get(m)
def test_acc(w):
    m = make_model(); put(m, w)
    with torch.no_grad():
        return (m(Xte).argmax(1) == yte).float().mean().item()

def fedavg(clients, rounds, E, B, lr=0.05, C=0.5, seed=0):
    torch.manual_seed(seed); gen = torch.Generator().manual_seed(seed)
    r = np.random.default_rng(seed)
    w = get(make_model()); hist = {}
    for t in range(1, rounds + 1):
        chosen = r.choice(K, size=int(C * K), replace=False)          # a fraction C of clients per round
        n_k = np.array([len(clients[k]) for k in chosen], dtype=np.float32)
        new = [local_train(w, clients[k], E, B, lr, gen) for k in chosen]
        w = sum(float(n / n_k.sum()) * wk for n, wk in zip(n_k, new))   # weighted by local data size
        hist[t] = test_acc(w)
    return hist

n_params = get(make_model()).numel()
print(f"model parameters: {n_params}; one upload = {n_params * 4} bytes (float32); per round with C=0.5: {10 * n_params * 4 * 2} bytes down+up")
print("\ntest accuracy after round t (C = 0.5, B = 10, lr = 0.05)")
print(" partition  algorithm         t=1    t=5    t=10   t=20   t=50   first t >= 0.90")
show = [1, 5, 10, 20, 50]
for pname, clients in [("IID", iid), ("label-skew", skew)]:
    for aname, E, B in [("FedSGD (E=1,B=all)", 1, 10_000), ("FedAvg E=1", 1, 10), ("FedAvg E=5", 5, 10), ("FedAvg E=20", 20, 10)]:
        lr = 0.5 if B == 10_000 else 0.05
        h = fedavg(clients, 50, E, B, lr=lr)
        first = next((t for t in h if h[t] >= 0.90), None)
        print(f" {pname:<10} {aname:<18}" + "".join(f" {h[t]:.3f} " for t in show) + f"  {first}")

torch.manual_seed(0); gen = torch.Generator().manual_seed(0)
m = make_model(); opt = torch.optim.SGD(m.parameters(), lr=0.05)
idx_all = np.arange(len(ytr))
for ep in range(1, 21):                                             # centralized SGD, same B and lr
    perm = idx_all[torch.randperm(len(idx_all), generator=gen).numpy()]
    for s in range(0, len(perm), 10):
        b = perm[s:s + 10]
        opt.zero_grad(); nn.functional.cross_entropy(m(Xtr[b]), ytr[b]).backward(); opt.step()
    if ep in (1, 5, 20):
        print(f" centralized SGD, epoch {ep:2d}: test accuracy {test_acc(get(m)):.3f}")

print("\n== what one client's update reveals (label-skew client 0, one round from the initial model) ==")
torch.manual_seed(0); gen = torch.Generator().manual_seed(0)
w0 = get(make_model())
delta = local_train(w0, skew[0], 1, 10, 0.05, gen) - w0
bias_delta = delta[-10:]                                           # change of the 10 output-layer biases
print(" true label counts      :", np.bincount(ytr[skew[0]].numpy(), minlength=10).tolist())
print(" output-bias change x100:", [round(v, 1) for v in (100 * bias_delta).tolist()])
print(" classes with the 2 largest increases:", sorted(torch.topk(bias_delta, 2).indices.tolist()))

print("\n== secure aggregation, pairwise masks (Protocol 0), 5 clients, the 10 bias deltas ==")
R, SCALE = 2**32, 2**16                                             # integers mod R, fixed point with 16 fraction bits
ups = [local_train(w0, skew[k], 1, 10, 0.05, gen)[-10:] - w0[-10:] for k in range(5)]
x = [np.round(u.numpy().astype(np.float64) * SCALE).astype(np.int64) % R for u in ups]
s = {(u, v): rng.integers(0, R, 10) for u in range(5) for v in range(5) if u != v}   # s[u,v] agreed by u and v
y_masked = []
for u in range(5):
    p = sum(((s[(u, v)] - s[(v, u)]) % R for v in range(5) if v != u), np.zeros(10, dtype=np.int64)) % R
    y_masked.append((x[u] + p) % R)                                 # what client u sends to the server
total = sum(y_masked, np.zeros(10, dtype=np.int64)) % R
decoded = np.where(total >= R // 2, total - R, total) / SCALE      # back to signed floats
true_sum = sum(ups).numpy()
print(" client 0 sends (first 4 of 10):", y_masked[0][:4].tolist())
print(" sum decoded by server x100    :", [round(v, 1) for v in (100 * decoded).tolist()])
print(" true sum of updates x100      :", [round(v, 1) for v in (100 * true_sum).tolist()])
print(f" max |decoded - true| = {np.abs(decoded - true_sum).max():.1e}")
```

</details>

Reading it:
- **Communication:** one upload is 9,640 bytes; a round moves 192,800 bytes. Rounds, not local compute, are the unit of cost.
- **Local epochs:** on IID clients, rounds to reach 0.90 test accuracy fall from 13 (FedSGD) to 4 (`E = 5`) and 2 (`E = 20`). `E = 1` with `B = 10` was slower than FedSGD here (18 rounds), with the learning rate fixed rather than tuned per setting.
- **Non-IID:** label skew slows every setting: `E = 20` needs 6 rounds instead of 2, FedSGD 21 instead of 13. After 50 rounds, the skewed run stays below the IID one (0.964 against 0.980 at `E = 20`).
- **Centralized baseline:** SGD on all the data reaches 0.978 after 20 epochs; IID FedAvg matches it (0.980) and label-skewed FedAvg comes within 1.4 points.
- **Leakage:** the client's two largest bias increases are exactly its two main classes, 2 and 7 (34 and 31 of its 67 examples), read from one update without any image.
- **Secure aggregation:** client 0's message is uniform-looking integers; the server's decoded sum equals the true sum of the 5 updates to `1.3e-05` (fixed-point rounding). The server never sees one client's update, but the sum still shows which classes the 5 clients hold together.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Very many local epochs `E` | FedAvg can plateau or diverge (seen on the Shakespeare LSTM, not on the MNIST CNN) | The global model only sets each client's starting point, so after long local training further averaging rounds may stop helping ✅[^1] |
| Models averaged from different initializations | The average can be arbitrarily bad | FedAvg relies on a shared starting model `w_t` ✅[^1] |
| Sparse model (bag-of-words) | The update names the words the user typed | Non-zero gradient entries mirror the input ✅[^1] |
| Update from one example | Its label is read from gradient signs | True-class logit gradient is negative ✅[^5]; lab: classes 2 and 7 from one client's update ✅[^6] |
| Defending by adding noise or pruning gradients | Gaussian or Laplace noise of scale above `10⁻²`, or pruning more than 20 % of the gradient, stopped the reconstruction attack; half precision did not | Measured against one attack ✅[^4], not a bound against all attacks like DP ✅[^2] |
| A client drops out under Protocol 0 | The sum is unusable: its masks do not cancel | Fixed by secret-shared seeds in the full protocol ✅[^3] |
| Few clients per round under secure aggregation | The sum can still leak what the group holds, such as its classes | The server still sees per-round aggregates ✅[^2]; lab: classes of 5 clients visible ✅[^6] |
| One user contributes many examples | Record-level DP does not cover the user | User-level adjacency removes all of a client's records ✅[^2] |
| Devices eligible mostly at night local time | Who trains shifts through the day, with a geographic bias | Violates independence across rounds ✅[^2] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| More local epochs `E` (or smaller `B`) | Far fewer rounds: 35× on IID MNIST ✅[^1]; lab 13 → 2 ✅[^6] | Smaller gain on non-IID data ✅[^1]; can plateau or diverge ✅[^1] |
| Larger client fraction `C` | With `B = 10`, `C ≥ 0.1` clearly beats one client per round, especially non-IID ✅[^1] | Diminishing returns beyond a point ✅[^1] |
| Secure aggregation | Server sees only the sum ✅[^2]; survives 1/3 dropouts ✅[^3] | Extra communication (1.73× at 2¹⁰ users) ✅[^3]; harder to reject bad updates ✅[^2] |
| User-level DP on updates | A formal bound per client ✅[^2] | Accuracy loss without many clients ✅[^2] |
| Centralized training | Simplest; lab best accuracy on skewed data ✅[^6] | Requires collecting the raw data ✅[^2] |

## Takeaways
- Treat "data stays on the device" as data minimization, not as privacy: add secure aggregation for the server and DP for the released model. [rule-candidate]
- Tune local epochs and batch size first to cut rounds, then check the result on a label-skewed split, not only an IID one. [rule-candidate]
- Count rounds and bytes per round, not epochs, when comparing federated settings.
- When a round aggregates few clients, assume the sum describes each of them.

## Verification status
- Verified: 66 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [Communication-Efficient Learning of Deep Networks from Decentralized Data](https://ar5iv.labs.arxiv.org/html/1602.05629) — McMahan, Moore, Ramage, Hampson, Agüera y Arcas, 2017 (ar5iv HTML of arXiv:1602.05629). Backs: the federated setting, FedSGD and FedAvg with C, E, B, weighted averaging, u = En/(KB), the pathological non-IID partition, speedups, shared initialization, plateau or divergence, sparse-update leakage, updates never carry more than the data. [^1]
- [Advances and Open Problems in Federated Learning](https://ar5iv.labs.arxiv.org/html/1912.04977) — Kairouz, McMahan et al., 2019 (ar5iv HTML of arXiv:1912.04977). Backs: FL definition, focused collection and data minimization, no formal guarantee, label distribution skew, threat models, secure aggregation definition and limits, user-level DP, independence violations. [^2]
- [Practical Secure Aggregation for Federated Learning on User-Held Data](https://ar5iv.labs.arxiv.org/html/1611.04482) — Bonawitz, Ivanov, Kreuter, Marcedone, McMahan, Patel, Ramage, Segal, Seth, 2016 (ar5iv HTML of arXiv:1611.04482). Backs: Protocol 0 pairwise masks, dropout recovery by secret sharing, double masking, 1/3 dropouts, 1.73× expansion. [^3]
- [Deep Leakage from Gradients](https://ar5iv.labs.arxiv.org/html/1906.08935) — Zhu, Liu, Han, 2019 (ar5iv HTML of arXiv:1906.08935). Backs: reconstruction of images and text from shared gradients, measured defenses. [^4]
- [iDLG: Improved Deep Leakage from Gradients](https://ar5iv.labs.arxiv.org/html/2001.02610) — Zhao, Mopuri, Bilen, 2020 (ar5iv HTML of arXiv:2001.02610). Backs: label extraction from the sign of the last-layer gradient. [^5]
- `machine-learning/lab-setup.md` — the lab where the FedAvg, label-leakage and secure-aggregation script ran on 2026-11-25. [^6]
- [Privacy-Enhancing Cryptography to Complement Differential Privacy](https://www.nist.gov/blogs/cybersecurity-insights/privacy-enhancing-cryptography-complement-differential-privacy) — Brandão, Peralta, NIST (National Institute of Standards and Technology), 2021. Backs: cryptography limits disclosure to the specified output, DP limits what that output reveals. [^7]

## Related
- `machine-learning/deep-learning/distributed-training.md` — data-parallel training inside a data center, where communication is cheap.
- `machine-learning/privacy-preserving-ml/differential-privacy.md` — the Gaussian mechanism and composition behind user-level DP.
- `machine-learning/privacy-preserving-ml/differentially-private-training.md` — clipping and noise per example instead of per client.
- `machine-learning/privacy-preserving-ml/membership-inference-and-memorization.md` — attacks on the final model, which federated training alone does not stop.
- `machine-learning/ml-systems/data-drift-and-monitoring.md` — label (prior) shift, the same phenomenon as label distribution skew across clients.
