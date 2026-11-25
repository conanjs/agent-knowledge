---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/deep-learning
status: verified
applies-to: ["PyTorch 2.15.0 (lab, plain torch without a graph library)", "any"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, deep-learning, graph-neural-networks, gnn, message-passing, gcn, graphsage, gat, gin, permutation-equivariance, readout, over-smoothing, weisfeiler-lehman]
---

# Graph neural networks

## Summary
**TL;DR:** A graph neural network (GNN) learns on data made of nodes and edges. Each layer is one round of message passing: every node gathers its neighbours' vectors, combines them with an order-independent function (sum, mean, max or attention-weighted sum) and updates its own vector with a small learned network. Because the node numbering is arbitrary, a layer must be permutation-equivariant (renumber the nodes and the outputs are renumbered the same way), and a graph-level prediction must be permutation-invariant. GCN (graph convolutional network) uses fixed degree-based weights `D̃^-1/2 (A + I) D̃^-1/2`, GraphSAGE samples neighbours and concatenates, GAT (graph attention network) learns per-neighbour weights. Stacking many layers blurs all nodes into the same vector (over-smoothing), and no message-passing GNN can tell apart graphs that the 1-WL (Weisfeiler–Lehman) test confuses; GIN (graph isomorphism network) reaches that limit by using sum plus an MLP (multilayer perceptron).
**Use this when:** your data is a molecule, a social or citation network, a road map or any set of related entities; you choose between GCN, GraphSAGE, GAT and GIN; a deeper GNN gets worse; or you need to write a GNN layer without a graph library.
**Not this doc:** backpropagation and autograd → `machine-learning/deep-learning/neural-networks-and-backpropagation.md`; attention over sequences, the idea GAT borrows → `machine-learning/transformers/attention-and-the-transformer.md`; convolution on image grids → `machine-learning/deep-learning/convolutional-networks.md`.

## Problem
A graph has no natural order for its nodes. The same connectivity can be written as many different adjacency matrices, one per numbering, and nothing guarantees that an ordinary network fed those matrices gives the same answer ✅[^1]. In the lab, a linear layer applied to the flattened adjacency matrix of a 5-node graph gives a different output after the nodes are renumbered ✅[^7]. Graphs also differ in size and in how many neighbours each node has, so a fixed-size input layer does not fit. A GNN solves both by computing only with neighbourhoods and order-independent aggregations; its two known limits, over-smoothing and the 1-WL ceiling, decide how deep and how expressive a model can be.

## Mental model
**Analogy:** a village rumour mill. Each morning every villager listens to what their neighbours said yesterday, forms a summary (a total, an average, or "who sounded most trustworthy"), and revises their own opinion. After one morning you know your friends' views; after two, your friends' friends'. After many mornings everyone in the village holds the same opinion, and you can no longer tell who started where: that is over-smoothing. Renaming the villagers changes nothing about what each one ends up believing: that is equivariance.

**Artifact:** one GCN layer is one line of plain PyTorch on a dense adjacency matrix `A` (`n × n`), node features `H` (`n × f`) and weights `W` (`f × f'`):

```python
A_hat = (A + I) / sqrt(deg[:, None] * deg[None, :])   # deg = row sums of A + I
H_next = relu(A_hat @ H @ W)
```

## How it works
### Graphs as data
1. **What a graph carries:** information on nodes, on edges, on the graph as a whole (global context), and the connectivity itself ✅[^1]. Example: a molecule has atom types (node features), bond types (edge features), a label such as "toxic" (graph level), and which atoms are bonded (connectivity).
2. **Connectivity:** the adjacency matrix `A` has `A[i, j] = 1` when nodes `i` and `j` are linked; for large sparse graphs an adjacency list (the list of edges) is the memory-efficient form ✅[^1].
3. **Permutation:** renumbering the nodes is a permutation matrix `P` (the identity matrix with its rows reordered): features become `P·X` and the adjacency `P·A·Pᵀ`. A layer `f` is **equivariant** when `f(P·A·Pᵀ, P·X) = P·f(A, X)`, and a readout `g` is **invariant** when `g(P·A·Pᵀ, P·X) = g(A, X)`. Sum, mean and max are the simple permutation-invariant aggregations ✅[^1].

### Message passing
4. **One layer, three steps:** for each node, gather the neighbouring embeddings (messages), aggregate them with a function such as sum, and pass the result through a learned update function ✅[^1]. Xu et al. write this as `a_v = AGGREGATE({h_u : u ∈ N(v)})`, then `h_v' = COMBINE(h_v, a_v)` ✅[^5].
5. **Receptive field:** after `k` layers a node has information from nodes up to `k` hops away; the effective context grows with each layer ✅[^2].
6. **Graph-level readout:** for a prediction about the whole graph, all node vectors are pooled with a permutation-invariant READOUT such as a sum ✅[^1] ✅[^5].

### GCN: fixed, degree-normalized weights (Kipf and Welling)
7. **Rule:** `H' = σ(D̃^-1/2 · Ã · D̃^-1/2 · H · W)` with `Ã = A + I` (each node also keeps its own vector, a self-loop) and `D̃` the diagonal matrix of `Ã`'s row sums ✅[^2]. Example from the lab: node 0 has 3 neighbours, so `D̃₀₀ = 4`; a neighbour with one link has `D̃ = 2`, giving the weight `1/√(4·2) = 0.3536`, and node 0's own weight is `1/√(4·4) = 0.25` ✅[^7].
8. **Why this normalization ("renormalization trick"):** the earlier operator `I + D^-1/2 A D^-1/2` has eigenvalues in `[0, 2]`, so applying it repeatedly can cause numerical instability and exploding or vanishing gradients ✅[^2]. In the lab the renormalized matrix has largest eigenvalue `1.0` ✅[^7].
9. **Scale and depth:** the cost grows linearly with the number of edges ✅[^2]. The paper's model has two layers, `Z = softmax(Â·ReLU(Â·X·W⁰)·W¹)` (ReLU, rectified linear unit); in its depth study (1 to 10 layers, 5-fold cross-validation with all labels on Cora, Citeseer and Pubmed), 2 or 3 layers were best, and beyond 7 layers training without residual connections can become difficult ✅[^2].

### GraphSAGE: sample, aggregate, concatenate
10. **Rule:** `h_N(v) = AGGREGATE({h_u : u ∈ N(v)})`, then `h_v = σ(W · CONCAT(h_v, h_N(v)))`, then divide by the L2 norm ✅[^3]. Keeping the node's own vector separate (the concatenation) instead of mixing it into the average is the main difference from GCN; the mean aggregator is "nearly equivalent" to GCN's rule ✅[^3].
11. **Sampling:** each node uses a fixed-size uniform sample of neighbours instead of all of them, 25 at the first hop and 10 at the second in the paper's experiments (`K = 2`) ✅[^3], so the cost per node does not depend on its degree.
12. **Inductive:** the model learns a function of a node's features and neighbourhood, so it embeds nodes and even whole graphs never seen in training ✅[^3]. Aggregators: mean, LSTM (long short-term memory) applied to a random order of neighbours (it is not order-invariant on its own), and max-pooling after a fully connected layer ✅[^3].

### GAT: learned weights per neighbour
13. **Scores:** `e_ij = LeakyReLU(aᵀ [W·h_i ‖ W·h_j])` with negative slope 0.2, computed only for `j` in the neighbourhood of `i`, which includes `i` itself (masked attention) ✅[^4].
14. **Weights:** `α_ij = softmax_j(e_ij)` over that neighbourhood, and the new vector is `σ(Σ_j α_ij·W·h_j)` ✅[^4]. Unlike GCN, two neighbours of equal degree can get different weights. In the lab, node 0 gives its 4 inputs the GAT weights `(0.10, 0.40, 0.47, 0.02)` where GCN fixes `(0.25, 0.35, 0.35, 0.29)` ✅[^7].
15. **Multi-head:** hidden layers concatenate `K` heads, the output layer averages them; on Cora the paper used 8 heads of 8 features, then a single output head ✅[^4]. One head costs `O(|V|·F·F' + |E|·F')`, on par with GCN ✅[^4].

### Limits: over-smoothing and the 1-WL ceiling
16. **Over-smoothing:** a GCN layer is a special form of Laplacian smoothing (each node moves towards its neighbours' average), and stacking many layers risks over-smoothing ✅[^6]: node vectors become indistinguishable. Repeated smoothing makes the features within each connected component converge to values proportional to the square root of each node's degree; the theorem needs a graph without bipartite components, which the self-loops guarantee ✅[^6]. In the Distill authors' sweep of GNN designs on a molecule-odour task (test AUC, the area under the receiver operating characteristic curve), mean performance rose with the number of layers, but the best models had two layers, not three or four, and four layers gave the lowest worst case; they link this to node representations being "diluted" over many rounds ✅[^1].
17. **1-WL test (colour refinement):** start with every node's label; in each round, replace each label by a new one hashed from the pair (own label, multiset of neighbours' labels); if the two graphs' label collections ever differ, they are not isomorphic, otherwise the test cannot decide ✅[^5].
18. **The ceiling:** any aggregation-based GNN is at most as powerful as the WL test at telling graphs apart; it reaches that power when the aggregation, update and readout are injective on multisets (a multiset is a set that keeps repeats) ✅[^5]. Mean captures only the proportions of a multiset, max only its underlying set; sum keeps the whole multiset ✅[^5]. GCN and GraphSAGE therefore cannot distinguish some simple structures ✅[^5].
19. **GIN:** `h_v' = MLP((1 + ε)·h_v + Σ_{u∈N(v)} h_u)`, with `ε` learned or fixed at 0, and a readout that concatenates the pooled vectors of every layer ✅[^5]. An MLP is needed because a single-layer perceptron is not a universal approximator of multiset functions ✅[^5].

## Worked example
A dense GCN in plain torch: the normalization on a 5-node graph, a numerical check of equivariance under the renumbering `[3, 0, 4, 1, 2]`, the spread of node directions as the propagation step is stacked on a 30-node random graph, the 1-WL blind spot and a GAT weight row. Lab run (`machine-learning/lab-setup.md`), 2026-11-24, PyTorch 2.15.0, two runs identical ✅[^7]:

```text
== 1. one GCN layer on a 5-node graph ==
degrees + 1: [4.0, 2.0, 2.0, 3.0, 2.0]
A_hat row 0: [0.25, 0.3536, 0.3536, 0.2887, 0.0] (1/sqrt(4*2)=0.3536, 1/sqrt(4*4)=0.25)
output shape: (5, 3) | largest eigenvalue of A_hat: 1.0
== 2. permutation: relabel the nodes ==
equivariant  GCN(PAP^T, PX) == P GCN(A, X): max |diff| = 2.4e-07
invariant    sum readout same: 2.4e-07
flattened-A MLP same output after relabel: False
== 3. over-smoothing: stack the propagation step k times (30-node random graph) ==
depth  0: mean distance between node directions 1.3731
depth  1: mean distance between node directions 1.2269
depth  2: mean distance between node directions 1.0231
depth  4: mean distance between node directions 0.5722
depth  8: mean distance between node directions 0.1275
depth 16: mean distance between node directions 0.0063
depth 32: mean distance between node directions 0.0001
depth 64: mean distance between node directions 0.0000
with W and ReLU, depth  2: 0.6785 | mean row norm 4.40e-01
with W and ReLU, depth  4: 0.1987 | mean row norm 2.03e-01
with W and ReLU, depth  8: 0.0079 | mean row norm 6.99e-03
with W and ReLU, depth 16: 0.0001 | mean row norm 6.94e-05
== 4. expressiveness: 6-cycle vs two triangles, all node features equal ==
GCN readouts equal: True | GIN readouts equal: True | connected? 1 vs 2 components
mean of neighbours {a} vs {a, a}: [1.0, 0.0] [1.0, 0.0]
 max of neighbours {a} vs {a, a}: [1.0, 0.0] [1.0, 0.0]
 sum of neighbours {a} vs {a, a}: [1.0, 0.0] [2.0, 0.0]
== 5. GAT: attention weights of node 0 over itself and its neighbours ==
alpha_0j for j in [0, 1, 2, 3] : [0.1022, 0.4003, 0.4749, 0.0227] | sum: 1.0
GCN fixed weights for the same row: [0.25, 0.3536, 0.3536, 0.2887]
```

<details><summary>Full script (prints the output above)</summary>

```python
# GCN layer in plain torch: normalization, permutation equivariance, over-smoothing, 1-WL limit, GAT weights.
import torch
torch.manual_seed(0)

def gcn_norm(A):                                   # Kipf & Welling: D~^-1/2 (A + I) D~^-1/2
    At = A + torch.eye(A.shape[0])
    d = At.sum(1)
    return At / torch.sqrt(d[:, None] * d[None, :])

def gcn_layer(A, H, W):                            # H' = ReLU(A_hat H W)
    return torch.relu(gcn_norm(A) @ H @ W)

def undirected(n, edges):
    A = torch.zeros(n, n)
    for i, j in edges:
        A[i, j] = A[j, i] = 1.0
    return A

print("== 1. one GCN layer on a 5-node graph ==")
A = undirected(5, [(0, 1), (0, 2), (0, 3), (3, 4)])   # node 0 has 3 neighbours, node 4 has 1
A_hat = gcn_norm(A)
print("degrees + 1:", (A + torch.eye(5)).sum(1).tolist())
print("A_hat row 0:", [round(v, 4) for v in A_hat[0].tolist()], "(1/sqrt(4*2)=0.3536, 1/sqrt(4*4)=0.25)")
X = torch.randn(5, 4); W = torch.randn(4, 3)
H = gcn_layer(A, X, W)
print("output shape:", tuple(H.shape), "| largest eigenvalue of A_hat:", round(torch.linalg.eigvalsh(A_hat).max().item(), 4))

print("== 2. permutation: relabel the nodes ==")
perm = torch.tensor([3, 0, 4, 1, 2]); P = torch.eye(5)[perm]       # P @ X reorders rows
H_perm = gcn_layer(P @ A @ P.T, P @ X, W)
print("equivariant  GCN(PAP^T, PX) == P GCN(A, X): max |diff| =", f"{(H_perm - P @ H).abs().max().item():.1e}")
print("invariant    sum readout same:", f"{(H_perm.sum(0) - H.sum(0)).abs().max().item():.1e}")
mlp = torch.nn.Linear(25, 3)                                       # naive: flatten the adjacency matrix
print("flattened-A MLP same output after relabel:", torch.allclose(mlp(A.flatten()), mlp((P @ A @ P.T).flatten())))

print("== 3. over-smoothing: stack the propagation step k times (30-node random graph) ==")
n = 30
Ar = (torch.rand(n, n) < 0.12).float(); Ar = torch.triu(Ar, 1); Ar = Ar + Ar.T
for i in range(n - 1): Ar[i, i + 1] = Ar[i + 1, i] = 1.0           # add a path so the graph is connected
Ah = gcn_norm(Ar); Xr = torch.randn(n, 8)
def spread(Hk):                                                    # mean pairwise distance of unit-length rows
    U = Hk / Hk.norm(dim=1, keepdim=True); m = U.shape[0]
    return torch.cdist(U, U).sum().item() / (m * (m - 1))
Hk = Xr.clone(); k = 0
for depth in [0, 1, 2, 4, 8, 16, 32, 64]:
    while k < depth: Hk = Ah @ Hk; k += 1
    print(f"depth {depth:>2}: mean distance between node directions {spread(Hk):.4f}")
Wd = [torch.randn(8, 8) / 8 ** 0.5 for _ in range(64)]              # same with random weights + ReLU
for depth in [2, 4, 8, 16]:
    Hk = Xr.clone()
    for l in range(depth): Hk = torch.relu(Ah @ Hk @ Wd[l])
    print(f"with W and ReLU, depth {depth:>2}: {spread(Hk):.4f} | mean row norm {Hk.norm(dim=1).mean().item():.2e}")

print("== 4. expressiveness: 6-cycle vs two triangles, all node features equal ==")
C6 = undirected(6, [(i, (i + 1) % 6) for i in range(6)])
T2 = undirected(6, [(0, 1), (1, 2), (2, 0), (3, 4), (4, 5), (5, 3)])
ones = torch.ones(6, 4); W1, W2 = torch.randn(4, 4), torch.randn(4, 4)
def gcn2_readout(A): return gcn_layer(A, gcn_layer(A, ones, W1), W2).sum(0)
def gin_readout(A, eps=0.0):                                       # GIN: MLP((1+eps) h_v + sum of neighbours)
    h = ones
    for Wl in (W1, W2): h = torch.relu(((1 + eps) * h + A @ h) @ Wl)
    return h.sum(0)
print("GCN readouts equal:", torch.allclose(gcn2_readout(C6), gcn2_readout(T2)),
      "| GIN readouts equal:", torch.allclose(gin_readout(C6), gin_readout(T2)), "| connected? 1 vs 2 components")
a = torch.tensor([[1.0, 0.0]])
for name, agg in [("mean", lambda m: m.mean(0)), ("max", lambda m: m.max(0).values), ("sum", lambda m: m.sum(0))]:
    print(f"{name:>4} of neighbours {{a}} vs {{a, a}}:", agg(a).tolist(), agg(torch.cat([a, a])).tolist())

print("== 5. GAT: attention weights of node 0 over itself and its neighbours ==")
Wg = torch.randn(4, 3); att = torch.randn(6)                       # e_ij = LeakyReLU(a^T [W h_i || W h_j])
Z = X @ Wg
nbrs = [0, 1, 2, 3]
e = torch.stack([torch.nn.functional.leaky_relu(att @ torch.cat([Z[0], Z[j]]), 0.2) for j in nbrs])
alpha = torch.softmax(e, 0)
print("alpha_0j for j in", nbrs, ":", [round(v, 4) for v in alpha.tolist()], "| sum:", round(alpha.sum().item(), 4))
print("GCN fixed weights for the same row:", [round(A_hat[0, j].item(), 4) for j in nbrs])
```

</details>

Reading it:
- **Equivariance is exact up to float32 rounding** (`2.4e-07`): the layer only uses `Â`, which is renumbered together with `X`. The flattened-matrix linear layer is not equivariant, which is the Problem in one line.
- **Over-smoothing:** "distance between node directions" is the mean distance between the unit-length node vectors; `1.37` is roughly what unrelated random directions give. Repeated smoothing alone drops it to `0.13` at depth 8 and to `0.0000` at 64. Adding random weights and ReLU does not prevent it here (`0.0001` at depth 16), and the vectors also shrink (mean norm `6.94e-05`).
- **1-WL blind spot:** a 6-cycle and two separate triangles both give every node exactly 2 neighbours, so colour refinement never separates them, and neither GCN nor GIN does, although one graph is connected and the other is not. GIN is as strong as 1-WL, not stronger.
- **Mean vs sum:** a node with one neighbour of feature `a` and a node with two such neighbours look the same to mean and max, and differ only under sum, the multiset argument of step 18.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Feeding the raw adjacency matrix to an MLP | Output changes when nodes are renumbered (lab: `False`) | Many matrices encode one graph ✅[^1]; lab ✅[^7] |
| GCN without self-loops (`A` instead of `A + I`) | A node's own features are dropped from its update | `Ã = A + I` adds the self-connection ✅[^2] |
| Stacking 8–16 GCN layers | Node vectors converge (lab spread `0.13` → `0.006`) | Laplacian smoothing ✅[^6]; lab ✅[^7] |
| Deeper GCN for a wider receptive field | Best at 2–3 layers; can become hard to train beyond 7 without residuals | Kipf and Welling's depth study ✅[^2] |
| A high-degree "hub" node in full-neighbourhood models | Its update touches every neighbour | GraphSAGE samples a fixed number instead ✅[^3] |
| Nodes unseen in training (new users, new molecules) | Transductive embeddings cannot embed them | GraphSAGE learns an inductive function of features ✅[^3] |
| Regular graphs with identical features (6-cycle vs two triangles) | Same readout from GCN and GIN | Bounded by 1-WL ✅[^5]; lab ✅[^7] |
| Mean or max aggregation when counts matter | `{a}` and `{a, a}` look identical | Only sum is injective on multisets ✅[^5]; lab ✅[^7] |
| LSTM aggregator | Result depends on neighbour order | Applied to a random permutation ✅[^3] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| GCN | One fixed matrix `Â`, linear in edges ✅[^2] | Fixed degree weights; mean-like aggregation loses counts ✅[^5] |
| GraphSAGE | Inductive; fixed cost per node via sampling ✅[^3] | Sampling noise; mean or max aggregator still below 1-WL ✅[^5] |
| GAT | Learned weight per neighbour, cost on par with GCN ✅[^4] | `K` heads multiply storage and parameters ✅[^4] |
| GIN | As powerful as 1-WL; graph classification ✅[^5] | Still cannot exceed 1-WL ✅[^5] |
| More layers | Larger receptive field ✅[^2] | Over-smoothing ✅[^6]; training trouble ✅[^2] |

## Takeaways
- Test a new GNN layer by renumbering the nodes (`P·A·Pᵀ`, `P·X`) and checking that the output is `P` times the old output; a graph-level readout must not change at all. [rule-candidate]
- Start with 2 layers; add depth only with residual connections and a measured gain.
- Use sum aggregation (GIN) when counts of neighbour types matter, e.g. graph classification of molecules; mean or attention when degrees vary widely and only proportions matter.
- If two different graphs must be told apart and they look alike to colour refinement, add features (node identifiers, cycle counts); a different message-passing layer will not help.

## Verification status
- Verified: 60 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [A Gentle Introduction to Graph Neural Networks](https://distill.pub/2021/gnn-intro/) — Sanchez-Lengeling, Reif, Pearce, Wiltschko, Distill, 2021. Backs: the four kinds of graph information, many adjacency matrices per graph, adjacency lists, sum/mean/max invariance, gather–aggregate–update, readout, the layer-count observation (mean test AUC up with depth, best models at two layers, its interactive figure checked). [^1]
- [Semi-Supervised Classification with Graph Convolutional Networks](https://ar5iv.labs.arxiv.org/html/1609.02907) — Kipf, Welling, 2016 (ICLR 2017). Backs: propagation rule, `Ã` and `D̃`, renormalization trick and its eigenvalue reason, linear cost in edges, two-layer model, depth study (1 to 10 layers, 5-fold cross-validation with all labels, residuals, beyond 7 layers; Figure 5 checked). [^2]
- [Inductive Representation Learning on Large Graphs](https://ar5iv.labs.arxiv.org/html/1706.02216) — Hamilton, Ying, Leskovec, 2017. Backs: GraphSAGE algorithm, concatenation and L2 normalization, mean ≈ GCN, aggregators, fixed-size sampling (`K = 2`, 25 and 10), inductive embeddings. [^3]
- [Graph Attention Networks](https://ar5iv.labs.arxiv.org/html/1710.10903) — Veličković et al., 2017 (ICLR 2018). Backs: attention scores, LeakyReLU 0.2, masked attention including self, softmax weights, multi-head concatenation and averaging, Cora heads, time complexity. [^4]
- [How Powerful are Graph Neural Networks?](https://ar5iv.labs.arxiv.org/html/1810.00826) — Xu, Hu, Leskovec, Jegelka, 2018 (ICLR 2019). Backs: AGGREGATE/COMBINE, READOUT, the WL test, Lemma 2 and the injectivity condition, mean/max/sum, GCN and GraphSAGE limits, GIN update and readout, 1-layer perceptron note. [^5]
- [Deeper Insights into Graph Convolutional Networks for Semi-Supervised Learning](https://arxiv.org/abs/1801.07606) — Li, Han, Wu, 2018 (AAAI 2018; full text read on ar5iv). Backs: GCN as symmetric Laplacian smoothing, over-smoothing with many layers, convergence to values proportional to the square root of the degree in each connected component (no bipartite components). [^6]
- `machine-learning/lab-setup.md` — the lab where the script in the Worked example ran on 2026-11-24 (GCN normalization, equivariance, over-smoothing, 1-WL blind spot, GAT weights). [^7]

## Related
- `machine-learning/deep-learning/neural-networks-and-backpropagation.md` — the MLP inside the update function and how its gradients are computed.
- `machine-learning/transformers/attention-and-the-transformer.md` — softmax attention over all tokens; GAT restricts it to graph neighbours.
- `machine-learning/deep-learning/convolutional-networks.md` — convolution on a regular image grid, the other way of aggregating an element's neighbours.
- `machine-learning/deep-learning/normalization-and-dropout.md` — normalization and dropout layers also used inside GNNs.
