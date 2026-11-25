---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/deep-learning
status: verified
applies-to: ["PyTorch 2.15.0", "scikit-learn 1.9.1"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, deep-learning, loss-landscape, saddle-points, sharp-minima, flat-minima, batch-size, hessian, sharpness, mode-connectivity, filter-normalization, grokking, lottery-ticket-hypothesis, implicit-regularization]
---

# Loss landscapes and generalization in deep networks

## Summary
**TL;DR:** A deep network's loss, seen as a function of its millions of weights, is not convex, yet training usually finds good solutions: in high dimension most bad critical points are saddle points, not traps, and the straight line from initialization to the trained weights often goes downhill all the way. Small-batch SGD (stochastic gradient descent) tends to end in flatter minima than large-batch training, and flatness has been linked to better generalization, but sharpness is not a well-defined property of the function: rescaling a ReLU (rectified linear unit) network's layers changes the curvature as much as you like without changing a single prediction. Three surprises frame the topic: separately trained solutions are joined by low-loss paths (mode connectivity), a network can generalize long after it has memorized its training set (grokking), and a dense network contains a sparse subnetwork that trains as well on its own (lottery tickets).
**Use this when:** you compare batch sizes and see different test accuracy, read "flat minima generalize better", plot or interpolate a loss surface, measure sharpness with the Hessian (the matrix of second derivatives), see validation accuracy jump long after training accuracy hit 100 %, or prune a network and wonder why its initialization matters.
**Not this doc:** the gradient-descent update, learning rate and batch vs mini-batch → `machine-learning/foundations/gradient-descent.md`; momentum, Adam, AdamW and schedules → `machine-learning/deep-learning/optimizers-and-learning-rate-schedules.md`; the U-curve and train/validation/test splits → `machine-learning/foundations/generalization-and-overfitting.md`; test error that rises and falls again with size → `machine-learning/learning-theory/double-descent.md`; why VC (Vapnik–Chervonenkis) bounds say little here → `machine-learning/learning-theory/pac-learning-and-vc-dimension.md`; pruning for deployment → `machine-learning/ml-systems/model-compression-and-quantization.md`.

## Problem
Classical intuition says a non-convex loss is full of bad local minima that trap gradient descent, and that a model able to memorize its training set will overfit. Neither describes deep networks well: they can fit random labels, and explicit regularization does not change that qualitatively ✅[^1], yet they generalize on real labels. Practitioners then reach for "flat minima generalize" to explain choices like batch size. In the lab, three runs stopped at the same training loss give top Hessian eigenvalues of 3.6, 5.3 and 5.7 but test accuracies of 92.1 %, 91.3 % and 91.6 %, and rescaling two layers of the flattest one raises its eigenvalue to 1,167 with identical outputs ✅[^9]. Sharpness numbers need care before they explain anything.

## Mental model
**Analogy:** hiking in fog across a mountain range with a million directions. A spot where the ground is level is almost never a true valley floor with walls on every side: in some of the million directions it still slopes down, so it is a mountain pass (a saddle point), and a hiker who keeps walking downhill escapes. Valleys come in shapes: a wide meadow, where stepping a little sideways keeps you low (flat minimum), or a narrow gorge (sharp minimum). If tomorrow's map is a little shifted from today's (test data vs training data), the meadow is the safer camp. But the map's scale is arbitrary: redraw it with one axis stretched by 25 and the meadow looks like a gorge, though the terrain is the same.

**Artifact:** training loss along the straight line `θ(a) = (1 − a)·θ_init + a·θ_trained`; printed by the first script in the Worked example; lab run (`machine-learning/lab-setup.md`), 2026-11-25, PyTorch 2.15.0 ✅[^9]:

```text
a = -0.25: train loss 0.6936
a =  0.00: train loss 0.6914
a =  0.50: train loss 0.2525
a =  1.00: train loss 0.0320
a =  1.10: train loss 0.0266
a =  1.50: train loss 0.2418
```

From the initialization (`a = 0`) to the trained weights (`a = 1`) the loss only falls: no barrier on this line.

## How it works
### Critical points in high dimension
1. **Saddles outnumber bad minima.** Dauphin et al. argue the main difficulty is the proliferation of saddle points, not local minima, and that saddles are surrounded by high-error plateaus that slow learning ✅[^2].
2. **Why:** for random Gaussian error functions, critical points with error much above the global minimum are exponentially likely to be saddles, the fraction of downhill directions grows with the error, and local minima have error close to the global minimum; this is Bray and Dean's 2007 result, which Dauphin et al. build on ✅[^2]. Their experiment with a small MLP on down-sampled MNIST and CIFAR-10 confirms it qualitatively for neural networks ✅[^2].
3. **Straight-line probes.** Goodfellow, Vinyals and Saxe interpolate between initialization and solution and find that a variety of state-of-the-art networks never meet significant obstacles on that line ✅[^3]. The lab line above is one such run.

### Flat vs sharp minima and batch size
1. **Keskar et al.'s claim:** large-batch methods tend to converge to sharp minimizers and small-batch methods to flat ones, and the sharp ones generalize worse (the generalization gap) ✅[^4]. Their small batch was 256 examples and their large batch 10 % of the training set, both with Adam ✅[^4].
2. **Their sharpness measure:** the largest loss increase in a box around the solution, `max (f(w + d) − f(w)) / (1 + f(w)) × 100` over `|d_i| ≤ ε(|w_i| + 1)`, with `ε = 10⁻³` or `5·10⁻⁴`; they call it a heuristic related to the largest Hessian eigenvalue ✅[^4]. Example: a loss of 0.10 that rises to 0.112 in the box gives `100 × 0.012/1.10 ≈ 1.1 %`.
3. **Why small batches:** their experiments support the view that the inherent noise in small-batch gradient estimates steers away from sharp minima ✅[^4]. Smith and Le make the noise explicit: treating SGD as a stochastic differential equation, the noise scale is about the learning rate times training-set size divided by batch size, and the test-optimal batch size is proportional to the learning rate and the training-set size ✅[^5]. This is the sense in which SGD noise acts as an implicit regularizer.
4. **Remedies are partial:** Keskar et al. tried data augmentation, conservative training and robust (adversarial) training and summarize that such strategies improve large-batch generalization but still lead to relatively sharp minima; in their appendix, robust training did not improve generalization at all ✅[^4]. Warm-starting large-batch training from small-batch iterates helps ✅[^4].

### The reparameterization critique
1. Dinh et al. show that the symmetries of rectifier networks let you build equivalent models at arbitrarily sharper minima, and that reparameterizing changes the geometry without changing generalization ✅[^6].
2. **Mechanism:** `ReLU(c·z) = c·ReLU(z)` for `c > 0`, so multiplying one layer's weights and bias by `c` and the next layer's weights by `1/c` leaves every output unchanged, while the curvature with respect to the first layer's weights scales roughly like `1/c²` and with respect to the second like `c²`. Lab: `c = 25` takes the top eigenvalue from 3.6 to 1,167 with the same loss ✅[^9].
3. **Consequence:** any sharpness measure must be invariant to such rescalings before it can be compared across models.

### Visualizing landscapes: filter normalization
1. **1-D interpolation** between two weight vectors (init and solution, or two solutions) is simple, but non-convexities are hard to see in 1-D plots and the method ignores batch normalization and network invariances ✅[^7].
2. **Filter normalization:** pick a random direction `d` in weight space and rescale each filter of it to the norm of the matching trained filter, `d_ij ← d_ij/‖d_ij‖ · ‖θ_ij‖`; then plot `L(θ + a·d₁ + b·d₂)` ✅[^7]. It is needed because scale invariance otherwise prevents meaningful comparisons between plots ✅[^7].
3. **Findings:** with filter normalization, sharpness correlates well with generalization error, and small batches generalized better in all their experiments ✅[^7]. Skip connections keep the landscape smooth; deep networks without them turn from nearly convex to chaotic, together with worse trainability ✅[^7].

### Mode connectivity
1. Garipov et al. find that optima of deep-network losses are connected by simple curves along which training and test accuracy stay nearly constant, and use this for Fast Geometric Ensembling ✅[^8].
2. Draxler et al. build paths between minima that are essentially flat in both training and test loss: essentially no barriers ✅[^10].
3. **Linear** connectivity is stricter: Frankle et al. test whether two copies trained from the same point with different SGD noise (data order) end in linearly connected minima; standard vision models become stable in this sense early in training ✅[^11].

### Grokking
1. **Definition:** validation accuracy rises from chance to near-perfect generalization well past the point of overfitting ✅[^12]. Power et al. use small algorithmic tables `a ∘ b = c` with `p = 97`, including `x + y mod p` ✅[^12].
2. **Data and steps:** smaller training fractions need much more optimization before they generalize ✅[^12]; near 25–30 % of the data, one percentage point less data raised the median time to generalize by 40–50 % ✅[^12].
3. **Weight decay:** of the interventions tried, adding weight decay had a very large effect on data efficiency; most runs used AdamW, learning rate `10⁻³`, weight decay 1 ✅[^12].

### Lottery tickets
1. **Hypothesis:** dense, randomly initialized networks contain subnetworks ("winning tickets") that, trained in isolation, reach comparable test accuracy in a similar number of iterations; they were found at less than 10–20 % of the original size on MNIST and CIFAR-10 ✅[^13].
2. **Finding one:** initialize `θ₀`, train `j` iterations, prune the `p %` smallest-magnitude weights, reset the survivors to their values in `θ₀`; iteratively, prune `p^(1/n) %` per round over `n` rounds ✅[^13].
3. **The initialization matters:** the same mask with fresh random weights no longer matches the original network and learns more slowly ✅[^13]. Deeper networks (VGG-19, ResNet-18) needed learning-rate warmup ✅[^13]; at ImageNet scale the subnetworks reach full accuracy only when stable to SGD noise, which happens early in training rather than at initialization ✅[^11].

## Worked example
Two scripts. **Landscape:** `make_classification` with 3,000 points, 20 features (8 informative), 5 % flipped labels, standardized; 2,000 for training, 1,000 for test; an MLP 20 → 64 → 64 → 2 (ReLU) with the same initial weights in every run; plain SGD, learning rate 0.05. It interpolates between init and a batch-32 solution, trains batch 16, 128 and 2,000 (full batch) until the first epoch with training loss ≤ 0.10, measures the top Hessian eigenvalue by power iteration on Hessian-vector products (double back-propagation with `create_graph=True` ✅[^14]) and Keskar's box sharpness (20 projected sign-gradient steps), then applies Dinh's rescaling. **Grokking:** `(a + b) mod 97`, 40 % of the 9,409 pairs for training, embeddings of size 128 for `a` and `b`, one hidden layer of 256, full-batch AdamW at learning rate `10⁻³`, with weight decay 1.0 and 0.

Lab run (`machine-learning/lab-setup.md`), 2026-11-25, PyTorch 2.15.0, scikit-learn 1.9.1, two runs of each script identical apart from timings; the full interpolation is the Mental model artifact plus `a = −0.5, 0.25, 0.75, 0.9, 1.25` ✅[^9]:

```text
== small vs large batch, same lr 0.05, each stopped at the first epoch with train loss <= 0.10 ==
batch  epochs  updates  train loss  test acc  top Hessian eigenvalue  Keskar sharpness (eps=1e-3, %)
   16      35     4375  0.0971      0.921        3.576                1.194
  128     199     3184  0.0997      0.913        5.292                0.913
 2000    3112     3112  0.1000      0.916        5.721                0.731
batch 16 trained on to 100 epochs: train loss 0.0027, test acc 0.910, top Hessian eigenvalue 1.420
== Dinh et al.: rescale a ReLU layer by c and the next by 1/c (same function, same loss) ==
c =  1.0: same outputs True, train loss 0.0971, top Hessian eigenvalue     3.576
c =  5.0: same outputs True, train loss 0.0971, top Hessian eigenvalue    47.259
c = 25.0: same outputs True, train loss 0.0971, top Hessian eigenvalue  1167.345
```

```text
p=97, 3763 training pairs (40%), 5646 held-out pairs
== AdamW, weight_decay=1.0 ==
step   300: train acc 1.000  test acc 0.000  weight norm  108.0  (2s)
step  1000: train acc 1.000  test acc 0.000  weight norm   86.8  (5s)
step  2000: train acc 1.000  test acc 0.023  weight norm   78.4  (11s)
step  3000: train acc 1.000  test acc 0.294  weight norm   74.2  (17s)
step  4000: train acc 1.000  test acc 0.719  weight norm   71.1  (23s)
step  5000: train acc 1.000  test acc 0.937  weight norm   68.7  (28s)
step  6000: train acc 1.000  test acc 0.995  weight norm   66.8  (34s)
== AdamW, weight_decay=0 (control) ==
step   300: train acc 1.000  test acc 0.000  weight norm  134.2  (2s)
step  6000: train acc 1.000  test acc 0.000  weight norm  148.0  (33s)
```

(The grokking script also prints steps 100 and, for the control, every step listed for the first run; all control rows have test accuracy 0.000.)

<details><summary>Landscape script</summary>

```python
# Loss along the straight line from init to trained weights, sharpness of small- vs large-batch
# solutions (top Hessian eigenvalue and Keskar's box sharpness), and Dinh et al.'s rescaling (PyTorch, CPU).
import copy, torch
from torch import nn
from torch.func import functional_call
from sklearn.datasets import make_classification
torch.manual_seed(0)

X, y = make_classification(n_samples=3000, n_features=20, n_informative=8, flip_y=0.05, random_state=0)
X = torch.tensor(X, dtype=torch.float32); X = (X - X.mean(0)) / X.std(0); y = torch.tensor(y)
Xtr, ytr, Xte, yte = X[:2000], y[:2000], X[2000:], y[2000:]
lossf = nn.CrossEntropyLoss()

def mlp():
    torch.manual_seed(1)                        # same initial weights for every run
    return nn.Sequential(nn.Linear(20, 64), nn.ReLU(), nn.Linear(64, 64), nn.ReLU(), nn.Linear(64, 2))
def train_loss(m):
    with torch.no_grad():
        return lossf(m(Xtr), ytr).item()
def test_acc(m):
    with torch.no_grad():
        return (m(Xte).argmax(1) == yte).float().mean().item()
def train(batch, epochs, lr=0.05, stop_at=None):   # stop_at: end at the first epoch with train loss <= it
    m = mlp(); opt = torch.optim.SGD(m.parameters(), lr=lr)
    g = torch.Generator().manual_seed(2)
    for ep in range(1, epochs + 1):
        for idx in torch.randperm(2000, generator=g).split(batch):
            opt.zero_grad(); lossf(m(Xtr[idx]), ytr[idx]).backward(); opt.step()
        if stop_at is not None and train_loss(m) <= stop_at:
            break
    m.epochs = ep
    return m

def top_hessian_eig(m, iters=100):              # power iteration with Hessian-vector products
    ps = [p for p in m.parameters()]
    loss = lossf(m(Xtr), ytr)
    grads = torch.autograd.grad(loss, ps, create_graph=True)
    v = [torch.randn_like(p) for p in ps]
    for _ in range(iters):
        n = torch.sqrt(sum((x * x).sum() for x in v)); v = [x / n for x in v]
        hv = torch.autograd.grad(grads, ps, grad_outputs=v, retain_graph=True)
        lam = sum((a * b).sum() for a, b in zip(hv, v)).item()
        v = [h.detach() for h in hv]
    return lam

def keskar_sharpness(m, eps=1e-3, steps=20):     # max relative loss rise in the box |d_i| <= eps(|w_i|+1), in %
    base = {k: v.detach() for k, v in m.named_parameters()}
    box = {k: eps * (v.abs() + 1) for k, v in base.items()}
    d = {k: torch.zeros_like(v, requires_grad=True) for k, v in base.items()}
    f0 = train_loss(m)
    for _ in range(steps):                      # projected gradient ascent inside the box
        l = lossf(functional_call(m, {k: base[k] + d[k] for k in base}, (Xtr,)), ytr)
        gs = torch.autograd.grad(l, list(d.values()))
        with torch.no_grad():
            for (k, t), gk in zip(d.items(), gs):
                t.add_(box[k] * gk.sign() * 0.25).clamp_(-box[k], box[k])
    with torch.no_grad():
        f1 = lossf(functional_call(m, {k: base[k] + d[k] for k in base}, (Xtr,)), ytr).item()
    return 100 * (f1 - f0) / (1 + f0)

print("== 1-D linear interpolation: theta(a) = (1-a)*theta_init + a*theta_trained, batch 32, 100 epochs ==")
init, trained = mlp(), train(32, 100)
probe = copy.deepcopy(init)
for a_ in (-0.5, -0.25, 0.0, 0.25, 0.5, 0.75, 0.9, 1.0, 1.1, 1.25, 1.5):
    with torch.no_grad():
        for p, p0, p1 in zip(probe.parameters(), init.parameters(), trained.parameters()):
            p.copy_((1 - a_) * p0 + a_ * p1)
    print(f"a = {a_:5.2f}: train loss {train_loss(probe):.4f}")

print("== small vs large batch, same lr 0.05, each stopped at the first epoch with train loss <= 0.10 ==")
print("batch  epochs  updates  train loss  test acc  top Hessian eigenvalue  Keskar sharpness (eps=1e-3, %)")
models = {}
for bs in (16, 128, 2000):
    m = train(bs, 10000, stop_at=0.10); models[bs] = m
    print(f"{bs:5d}  {m.epochs:6d}  {m.epochs * -(-2000 // bs):7d}  {train_loss(m):.4f}      {test_acc(m):.3f}     "
          f"{top_hessian_eig(m):8.3f}                {keskar_sharpness(m):.3f}")
m = train(16, 100)
print(f"batch 16 trained on to 100 epochs: train loss {train_loss(m):.4f}, test acc {test_acc(m):.3f}, "
      f"top Hessian eigenvalue {top_hessian_eig(m):.3f}")

print("== Dinh et al.: rescale a ReLU layer by c and the next by 1/c (same function, same loss) ==")
m = models[16]   # batch 16, stopped at train loss 0.10
for c in (1.0, 5.0, 25.0):
    r = copy.deepcopy(m)
    with torch.no_grad():
        r[0].weight.mul_(c); r[0].bias.mul_(c); r[2].weight.div_(c)   # relu(c*z) = c*relu(z)
    same = torch.allclose(r(Xte), m(Xte), atol=1e-4)
    print(f"c = {c:4.1f}: same outputs {same}, train loss {train_loss(r):.4f}, top Hessian eigenvalue {top_hessian_eig(r):9.3f}")
```

</details>

<details><summary>Grokking script (about 70 seconds on the reference machine)</summary>

```python
# Grokking on modular addition: (a + b) mod 97 with 40% of all pairs as training data (PyTorch, CPU).
import time, torch
from torch import nn
torch.manual_seed(0)
P, FRAC = 97, 0.4
a, b = torch.cartesian_prod(torch.arange(P), torch.arange(P)).T
y = (a + b) % P
perm = torch.randperm(P * P); ntr = int(FRAC * P * P)
tr, te = perm[:ntr], perm[ntr:]

class Net(nn.Module):
    def __init__(self, d=128, h=256):
        super().__init__()
        self.emb = nn.Embedding(P, d)
        self.mlp = nn.Sequential(nn.Linear(2 * d, h), nn.ReLU(), nn.Linear(h, P))
    def forward(self, a, b):
        return self.mlp(torch.cat([self.emb(a), self.emb(b)], 1))
def run(wd, steps=6000):
    torch.manual_seed(1)
    m = Net(); opt = torch.optim.AdamW(m.parameters(), lr=1e-3, weight_decay=wd)
    def acc(idx):
        with torch.no_grad():
            return (m(a[idx], b[idx]).argmax(1) == y[idx]).float().mean().item()
    t0 = time.time()
    for step in range(1, steps + 1):          # full batch: all training pairs every step
        opt.zero_grad()
        nn.functional.cross_entropy(m(a[tr], b[tr]), y[tr]).backward(); opt.step()
        if step in (100, 300, 1000, 2000, 3000, 4000, 5000, 6000):
            w = torch.sqrt(sum((p ** 2).sum() for p in m.parameters())).item()
            print(f"step {step:5d}: train acc {acc(tr):.3f}  test acc {acc(te):.3f}  weight norm {w:6.1f}  ({time.time() - t0:.0f}s)")

print(f"p={P}, {ntr} training pairs ({FRAC:.0%}), {len(te)} held-out pairs")
print("== AdamW, weight_decay=1.0 ==")
run(1.0)
print("== AdamW, weight_decay=0 (control) ==")
run(0.0)
```

</details>

Reading it, line by line:
- **Interpolation:** the loss falls monotonically from 0.69 (chance for two classes) at init to 0.032 at the solution. It keeps falling a little past it (0.027 at `a = 1.1`), because scaling up the weights of a nearly separating network makes it more confident on the training set, then rises (0.24 at `a = 1.5`).
- **Batch size at matched loss:** stopped at the same training loss of about 0.10, batch 16 has the smallest top Hessian eigenvalue (3.6 against 5.3 and 5.7), the direction Keskar et al. report. Keskar's box measure ranks them the other way (1.19 % against 0.91 % and 0.73 %): two sharpness measures disagree on the same three models.
- **Generalization barely differs:** test accuracy is 92.1 %, 91.3 % and 91.6 %, within the noise of a 1,000-point test set; on this toy problem flatness does not buy a visible generalization gain.
- **Training on lowers curvature:** the same batch-16 run continued to 100 epochs reaches loss 0.0027 and eigenvalue 1.4, flatter by this measure, yet test accuracy is slightly lower (91.0 %). With cross-entropy, confident fits shrink the Hessian, so compare sharpness only at matched loss.
- **Dinh rescaling:** `c = 5` and `c = 25` give the same outputs and loss with eigenvalues 13 and 326 times larger, below the `c²` factors of 25 and 625 because the top direction is not entirely in the second layer.
- **Grokking:** with weight decay 1.0, training accuracy is 100 % by step 300 while held-out accuracy stays at 0 until step 1,000, then climbs to 99.5 % by step 6,000 as the weight norm shrinks from 108 to 67. Without weight decay the network memorizes just as fast, its weight norm grows, and held-out accuracy is still 0.000 at step 6,000. Held-out accuracy of 0, below the 1/97 of guessing, means the memorizing network gets almost no unseen pair right (0.000 to three decimals is at most 2 of the 5,646 held-out pairs).

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Training stalls at a plateau | Looks like a bad local minimum, often a saddle | Saddles surrounded by plateaus ✅[^2] |
| Comparing sharpness at different training losses | Lower loss looks flatter (lab 1.4 vs 3.6 for one run) | Confident fits shrink curvature; lab ✅[^9] |
| Rescaled ReLU layers | Any Hessian sharpness you want, same function | Positive homogeneity ✅[^6]; lab ✅[^9] |
| Raw random-direction plots of two models | Misleading sharpness comparison | Scale invariance; use filter normalization ✅[^7] |
| Two sharpness measures | Can rank the same models in opposite order | Eigenvalue vs box measure; lab ✅[^9]; Keskar's is a heuristic ✅[^4] |
| Large batch at the same learning rate | Less gradient noise | Noise scale ∝ learning rate × N / B ✅[^5] |
| 1-D line looks convex | Says nothing about other directions | 1-D plots hide non-convexity ✅[^7] |
| Deep network without skip connections | Chaotic landscape, harder to train | Li et al.'s finding ✅[^7] |
| Validation accuracy 0 after 100 % train accuracy (algorithmic data) | May still generalize with more steps and weight decay | Grokking ✅[^12]; lab ✅[^9] |
| Grokking without weight decay | Much slower or absent (lab: none by 6,000 steps) | Weight decay's large effect ✅[^12]; lab ✅[^9] |
| Winning-ticket mask with new random weights | Loses its advantage | Initialization matters ✅[^13] |
| Lottery ticket at large scale | Reset to iteration 0 fails | Stability to SGD noise arrives early in training ✅[^11] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Small batches | Gradient noise, flatter minima ✅[^4]; more updates per epoch | Less parallel hardware use; noise scale tied to learning rate ✅[^5] |
| Large batches | Hardware efficiency | Sharper minima, generalization gap in Keskar et al. ✅[^4]; partial remedies only ✅[^4] |
| Top Hessian eigenvalue as sharpness | Cheap with Hessian-vector products ✅[^14] | Not reparameterization-invariant ✅[^6] |
| Filter-normalized plots | Comparable across models; correlate with generalization ✅[^7] | Only 1 or 2 random directions |
| Strong weight decay on small algorithmic data | Grokking within budget ✅[^12]; lab 99.5 % ✅[^9] | Long phase of zero validation progress |
| Iterative magnitude pruning with rewinding | Sparse subnetwork that trains as well ✅[^13] | Several full training rounds ✅[^13] |

## Takeaways
- Compare sharpness only at matched training loss and with a reparameterization-aware measure (filter-normalized directions); never across architectures with raw Hessian eigenvalues. [rule-candidate]
- When changing the batch size, change the learning rate with it to keep the SGD noise scale, rather than reading the accuracy change as a property of the batch size alone.
- On small algorithmic or structured datasets, a validation curve flat at chance after training accuracy saturates is not proof of failure; keep training with weight decay before giving up.
- Treat "flat minima generalize better" as a tendency with known counterexamples, not a law.

## Verification status
- Verified: 63 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [Understanding deep learning requires rethinking generalization](https://arxiv.org/abs/1611.03530) — Zhang, Bengio, Hardt, Recht, Vinyals, 2016. Backs: networks fit random labels; explicit regularization does not change that qualitatively. [^1]
- [Identifying and attacking the saddle point problem in high-dimensional non-convex optimization](https://ar5iv.labs.arxiv.org/html/1406.2572) — Dauphin, Pascanu, Gulcehre, Cho, Ganguli, Bengio, 2014 (ar5iv HTML). Backs: proliferation of saddles, plateaus, error vs index, minima near the global minimum. [^2]
- [Qualitatively characterizing neural network optimization problems](https://arxiv.org/abs/1412.6544) — Goodfellow, Vinyals, Saxe, 2014. Backs: no significant obstacles on the init-to-solution line. [^3]
- [On Large-Batch Training for Deep Learning: Generalization Gap and Sharp Minima](https://ar5iv.labs.arxiv.org/html/1609.04836) — Keskar, Mudigere, Nocedal, Smelyanskiy, Tang, 2016 (ar5iv HTML). Backs: sharp vs flat claim, batch sizes, box sharpness metric, gradient noise, remedies, warm-starting. [^4]
- [A Bayesian Perspective on Generalization and Stochastic Gradient Descent](https://arxiv.org/abs/1710.06451) — Smith, Le, 2017. Backs: SGD noise scale, optimal batch size ∝ learning rate and training-set size. [^5]
- [Sharp Minima Can Generalize For Deep Nets](https://arxiv.org/abs/1703.04933) — Dinh, Pascanu, Bengio, Bengio, 2017. Backs: equivalent models at arbitrarily sharper minima, reparameterization. [^6]
- [Visualizing the Loss Landscape of Neural Nets](https://ar5iv.labs.arxiv.org/html/1712.09913) — Li, Xu, Taylor, Studer, Goldstein, 2018 (ar5iv HTML). Backs: 1-D interpolation limits, filter normalization, scale invariance, sharpness–generalization correlation, skip connections. [^7]
- [Loss Surfaces, Mode Connectivity, and Fast Ensembling of DNNs](https://arxiv.org/abs/1802.10026) — Garipov, Izmailov, Podoprikhin, Vetrov, Wilson, 2018. Backs: optima connected by simple curves, Fast Geometric Ensembling. [^8]
- `machine-learning/lab-setup.md` — the lab where the interpolation, sharpness, rescaling and grokking scripts ran on 2026-11-25. [^9]
- [Essentially No Barriers in Neural Network Energy Landscape](https://arxiv.org/abs/1803.00885) — Draxler, Veschgini, Salmhofer, Hamprecht, 2018. Backs: essentially flat paths between minima. [^10]
- [Linear Mode Connectivity and the Lottery Ticket Hypothesis](https://arxiv.org/abs/1912.05671) — Frankle, Dziugaite, Roy, Carbin, 2019. Backs: linear mode connectivity, stability to SGD noise early in training, subnetworks at ImageNet scale. [^11]
- [Grokking: Generalization Beyond Overfitting on Small Algorithmic Datasets](https://ar5iv.labs.arxiv.org/html/2201.02177) — Power, Burda, Edwards, Babuschkin, Misra, 2022 (ar5iv HTML). Backs: definition, `p = 97` tables including `x + y`, data fraction, weight decay, AdamW settings. [^12]
- [The Lottery Ticket Hypothesis: Finding Sparse, Trainable Neural Networks](https://ar5iv.labs.arxiv.org/html/1803.03635) — Frankle, Carbin, 2018 (ar5iv HTML). Backs: hypothesis, 10–20 % size, pruning-and-reset procedure, random reinitialization, warmup. [^13]
- [torch.autograd.grad](https://docs.pytorch.org/docs/2.15/generated/torch.autograd.grad.html) — PyTorch, 2026 (2.15). Backs: `create_graph=True` for higher-order derivatives, `grad_outputs` as the vector of the product. [^14]

## Related
- `machine-learning/foundations/gradient-descent.md` — the update rule, learning rate and batch size basics.
- `machine-learning/deep-learning/optimizers-and-learning-rate-schedules.md` — AdamW's decoupled weight decay and the linear scaling rule for batch size.
- `machine-learning/foundations/generalization-and-overfitting.md` — the classical picture this doc complicates.
- `machine-learning/learning-theory/double-descent.md` — test error versus size, epochs and samples.
- `machine-learning/learning-theory/pac-learning-and-vc-dimension.md` — capacity-based bounds and their limits for deep networks.
- `machine-learning/ml-systems/model-compression-and-quantization.md` — magnitude pruning for deployment.
- `machine-learning/deep-learning/adversarial-robustness.md` — sensitivity in input space rather than weight space.
