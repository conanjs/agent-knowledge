---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/deep-learning
status: verified
applies-to: ["PyTorch 2.15.0"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [machine-learning, deep-learning, neural-networks, mlp, multilayer-perceptron, forward-pass, backpropagation, chain-rule, automatic-differentiation, autograd, gradcheck, pytorch]
---

# Neural networks and backpropagation

## Summary
**TL;DR:** A neural network is a chain of simple steps: each layer multiplies its input by a weight matrix, adds a bias and applies a nonlinear activation; an MLP (multilayer perceptron) stacks such layers. Backpropagation gets the gradient of the loss with respect to every weight in one backward sweep: it applies the chain rule from the loss back towards the input and reuses the values the forward pass saved. PyTorch's autograd does this for you: it records each operation as it runs and walks that record backwards when you call `.backward()`.
**Use this when:** you need to know what `loss.backward()` computes, why `.grad` is `None` or keeps growing, why training needs more memory than inference, why a network without activations is only a linear model, or how to check a hand-written gradient.
**Not this doc:** how the gradient moves the weights → `machine-learning/foundations/gradient-descent.md` and `machine-learning/deep-learning/optimizers-and-learning-rate-schedules.md`; why gradients shrink or blow up in deep stacks → `machine-learning/deep-learning/activations-and-initialization.md`; the loss functions themselves → `machine-learning/foundations/loss-functions-and-maximum-likelihood.md`.

## Problem
Gradient descent needs `∂L/∂w`, the slope of the loss `L` with respect to each weight `w`, for every one of a network's weights. Before automatic differentiation, a small change to a model meant re-deriving its derivatives by hand, and papers spent pages on update rules ✅[^1]. Nudging each weight to measure its slope numerically costs two loss evaluations per weight (the central difference in the worked example uses `L(w+ε)` and `L(w−ε)` ✅[^6]), which is hopeless for millions of weights. And without a picture of what backpropagation does, common symptoms look random: a `.grad` that is `None`, gradients that double on the second step, memory that is fine at inference but runs out in training, or a deep model that fits no better than a straight line.

## Mental model
**Analogy:** currency conversion along a chain. If 1 euro buys 1.1 dollars and 1 dollar buys 25,000 dong, then 1 euro buys 1.1 × 25,000 = 27,500 dong: you multiply the local rates along the path. Backpropagation multiplies local rates of change ("if this value moves by 1, the next one moves by …") from the loss back to each weight, and a weight that feeds several paths adds up what comes back along each. Autograd is the receipt printed while you shop: every operation is written down during the forward pass, and `.backward()` reads the receipt from the bottom up.

**Artifact:** why the nonlinearity matters. XOR (exclusive or: output 1 when exactly one input is 1) fitted by three models with the same training loop and an MSE (mean squared error) loss; lab run (`machine-learning/lab-setup.md`), 2026-11-24, PyTorch 2.15.0 ✅[^6]:

```text
linear  2->1                final MSE=0.2500  outputs for (00,01,10,11)=0.500 0.500 0.500 0.500
2 linear 2->8->1 (no act)   final MSE=0.2500  outputs for (00,01,10,11)=0.500 0.500 0.500 0.500
MLP 2->8->1 with tanh       final MSE=0.0000  outputs for (00,01,10,11)=0.000 1.000 1.000 -0.000
```

<details><summary>Full script (prints the output above)</summary>

```python
# XOR: a linear model cannot fit it; two stacked linear layers cannot either; an MLP with a nonlinearity can.
import torch
from torch import nn
X = torch.tensor([[0., 0.], [0., 1.], [1., 0.], [1., 1.]]); y = torch.tensor([[0.], [1.], [1.], [0.]])

def train(model, steps=2000):
    torch.manual_seed(0)
    for p in model.parameters(): nn.init.normal_(p, std=1.0)
    opt = torch.optim.Adam(model.parameters(), lr=0.05)
    for _ in range(steps):
        opt.zero_grad(); loss = nn.functional.mse_loss(model(X), y); loss.backward(); opt.step()
    return loss.item(), model(X).detach().squeeze().tolist()

models = {
    "linear  2->1":            nn.Linear(2, 1),
    "2 linear 2->8->1 (no act)": nn.Sequential(nn.Linear(2, 8), nn.Linear(8, 1)),
    "MLP 2->8->1 with tanh":   nn.Sequential(nn.Linear(2, 8), nn.Tanh(), nn.Linear(8, 1)),
}
for name, m in models.items():
    loss, pred = train(m)
    print(f"{name:27} final MSE={loss:.4f}  outputs for (00,01,10,11)=" + " ".join(f"{p:.3f}" for p in pred))
```

</details>

The linear model can do no better than 0.5 everywhere, the same answer the Deep Learning book gets for XOR with the normal equations ✅[^3]. Two stacked linear layers do no better, because a linear function of a linear function is still linear ✅[^2]. One `tanh` (hyperbolic tangent) between them is enough to fit XOR exactly.

## How it works
### Neurons, layers and the MLP
- **A layer** computes `h = φ(x·W + b)`: `x` is the input row (one value per feature), `W` the weight matrix (one column per unit), `b` the bias vector (one per unit), `φ` an activation applied to each element ✅[^2]. Example: `x = (1, 2)`, `W = [[0.5, −1], [0.25, 0.2]]`, `b = (0, 0)` gives `x·W = (1·0.5 + 2·0.25, 1·(−1) + 2·0.2) = (1.0, −0.6)`; with `φ` = ReLU (rectified linear unit), `ReLU(z) = max(z, 0)`, the layer outputs `(1.0, 0)`.
- **An MLP** stacks fully connected layers, `H1 = φ1(X·W1 + b1)`, `H2 = φ2(H1·W2 + b2)`, … ✅[^2]. Without `φ`, two layers collapse into one: `(X·W1 + b1)·W2 + b2 = X·(W1·W2) + (b1·W2 + b2)` ✅[^2], which is why the second XOR model failed ✅[^6].
- **Expressive power:** one hidden layer with enough units can in principle represent any function; finding the weights is the hard part, and deeper networks can represent many functions more compactly than wider ones ✅[^2].

### Forward pass and computational graph
The forward pass computes and **stores** every intermediate value, in order from the input layer to the output ✅[^1]. Drawn as a computational graph, variables and operators are nodes and the arrows show the data flow, from the input `x` to the scalar objective ✅[^1].

### Backpropagation: the chain rule in reverse
Backpropagation walks the graph from the output back to the input, applying the chain rule and storing the partial derivatives it needs on the way ✅[^1]. For the one-hidden-layer network of the worked example (`n` rows, `tanh` hidden layer, MSE loss; `⊙` is element-wise multiplication, `ᵀ` is transpose):

```text
forward                          backward (each line uses values computed above it)
Z = X·W1 + b1                    dO  = 2·(O − y) / n               dL/dO
H = tanh(Z)                      dW2 = Hᵀ·dO      db2 = Σrows dO   dL/dW2, dL/db2
O = H·W2 + b2                    dH  = dO·W2ᵀ                      dL/dH
L = mean((O − y)²)               dZ  = dH ⊙ (1 − H²)               tanh'(z) = 1 − tanh(z)²
                                 dW1 = Xᵀ·dZ      db1 = Σrows dZ   dL/dW1, dL/db1
```

1. **Start at the loss:** `dL/dL = 1`; the first step is the loss's own derivative, `dO` ✅[^1].
2. **Matrix product:** a gradient passes back through `H·W2` as `dO·W2ᵀ` to the input and `Hᵀ·dO` to the weight; Dive into Deep Learning (d2l) writes the same rules in column form (`∂J/∂W2 = ∂J/∂o·hᵀ`, plus a term from d2l's L2 (squared-norm) weight penalty, which this network does not have, and `∂J/∂h = W2ᵀ·∂J/∂o`) ✅[^1].
3. **Element-wise activation:** multiply element-wise by the activation's derivative, `dH ⊙ φ'(Z)` ✅[^1]; for `tanh` that is `1 − tanh²` ✅[^2], for ReLU it is 0 for negative inputs and 1 for positive ones ✅[^2].
4. **Shared values add up:** a value used in several places gets the sum of the gradients from each use ✅[^7]. The bias `b1` is added to every row of the batch, so `db1` sums `dZ` over rows; the lab confirms this equals autograd's result ✅[^6].
5. **Reuse, and its memory price:** each step reuses values saved by the forward pass (`H` in `dW2`, `X` in `dW1`), so they must be kept until the backward pass finishes. That is why training needs much more memory than prediction, roughly in proportion to depth and batch size ✅[^1].
6. **Cost:** with one scalar output and constant-cost local derivatives, backpropagation does work of the same order as the forward pass ✅[^3]. This is reverse mode; when a graph has more outputs than inputs, forward-mode differentiation is sometimes the better choice ✅[^3].

### PyTorch autograd
- Autograd is a reverse automatic differentiation system: as the forward pass runs, it records a directed acyclic graph whose leaves are the input tensors and whose roots are the outputs; each result's `.grad_fn` is the entry into that graph ✅[^4].
- The graph is rebuilt from scratch on every iteration, so ordinary Python `if` and `for` can change the model from one step to the next ✅[^4].
- Operations save what their backward step needs; `x.pow(2)` saves `x` ✅[^4].
- `requires_grad` defaults to `False` except for tensors wrapped in `nn.Parameter`; an operation is recorded only if one of its inputs requires grad, and `.backward()` **accumulates** into `.grad` only on leaf tensors with `requires_grad=True` ✅[^4]. Setting `requires_grad_(False)` on parameters freezes them ✅[^4].
- `torch.no_grad()` stops recording, for example during an optimizer's in-place update; inference mode also skips extra tracking, for data processing and evaluation ✅[^4].

## Worked example
The network above, 4 examples × 3 features, 5 `tanh` hidden units, 1 output, in float64. The backward pass by hand, line for line the `text` block above:

```python
dO = 2 * (O - y) / len(X)              # dL/dO
dW2 = H.T @ dO; db2 = dO.sum(0)        # dL/dW2, dL/db2
dH = dO @ W2.T                         # dL/dH
dZ = dH * (1 - H ** 2)                 # tanh'(z) = 1 - tanh(z)^2
dW1 = X.T @ dZ; db1 = dZ.sum(0)        # dL/dW1, dL/db1
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-24, PyTorch 2.15.0 and numpy 2.5.5, two runs identical ✅[^6]:

```text
loss: numpy=2.214582 torch=2.214582  grad_fn=MeanBackward0
W1 (3, 5)  max|hand - autograd| = 2.8e-17
b1 (5,)    max|hand - autograd| = 0.0e+00
W2 (5, 1)  max|hand - autograd| = 1.1e-16
b2 (1,)    max|hand - autograd| = 0.0e+00
dL/dW1[0,0]: hand=-0.096588350 finite-difference=-0.096588350
torch.autograd.gradcheck: True
```

<details><summary>Full script (prints the output above)</summary>

```python
# Manual backprop for a 2-layer network (numpy) vs PyTorch autograd vs finite differences.
import numpy as np, torch
rng = np.random.default_rng(0)
X = rng.normal(size=(4, 3)); y = rng.normal(size=(4, 1))          # 4 examples, 3 features
W1 = rng.normal(size=(3, 5)); b1 = np.zeros(5)                     # hidden layer: 5 units
W2 = rng.normal(size=(5, 1)); b2 = np.zeros(1)                     # output layer: 1 unit

# forward pass, keeping every intermediate value
Z = X @ W1 + b1; H = np.tanh(Z); O = H @ W2 + b2
L = ((O - y) ** 2).mean()                                          # MSE loss
# backward pass by hand: chain rule from the loss back to the input
dO = 2 * (O - y) / len(X)              # dL/dO
dW2 = H.T @ dO; db2 = dO.sum(0)        # dL/dW2, dL/db2
dH = dO @ W2.T                         # dL/dH
dZ = dH * (1 - H ** 2)                 # tanh'(z) = 1 - tanh(z)^2
dW1 = X.T @ dZ; db1 = dZ.sum(0)        # dL/dW1, dL/db1

# the same network in PyTorch; autograd records the graph and walks it backwards
P = [torch.tensor(a, requires_grad=True) for a in (W1, b1, W2, b2)]   # float64
def f(W1_, b1_, W2_, b2_):
    return ((torch.tanh(torch.tensor(X) @ W1_ + b1_) @ W2_ + b2_ - torch.tensor(y)) ** 2).mean()
tL = f(*P); tL.backward()
print(f"loss: numpy={L:.6f} torch={tL.item():.6f}  grad_fn={tL.grad_fn.name()}")
for name, mine, p in zip(("W1", "b1", "W2", "b2"), (dW1, db1, dW2, db2), P):
    print(f"{name} {str(tuple(p.shape)):7} max|hand - autograd| = {np.abs(mine - p.grad.numpy()).max():.1e}")

# central finite difference on one weight: (L(w+eps) - L(w-eps)) / (2*eps)
eps = 1e-6; Wp, Wm = W1.copy(), W1.copy(); Wp[0, 0] += eps; Wm[0, 0] -= eps
num = (f(torch.tensor(Wp), *P[1:]).item() - f(torch.tensor(Wm), *P[1:]).item()) / (2 * eps)
print(f"dL/dW1[0,0]: hand={dW1[0, 0]:.9f} finite-difference={num:.9f}")
print("torch.autograd.gradcheck:", torch.autograd.gradcheck(f, P))
```

</details>

Reading it, line by line:
- `loss` is the same in numpy and PyTorch, and `grad_fn=MeanBackward0` shows the root of the graph autograd recorded: the last operation was the `mean` of the loss.
- The hand gradients and `p.grad` differ by at most `1.1e-16`, which is float64 rounding: the five lines above are exactly what `.backward()` computed.
- The central difference `(L(w+ε) − L(w−ε)) / 2ε` with `ε = 1e-6` agrees with the hand value to 9 decimals, an independent check that needs no chain rule at all.
- `torch.autograd.gradcheck` repeats that comparison for every input element; it compares finite differences with analytical gradients and its default tolerances are designed for double precision ✅[^5].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `.grad` of an intermediate tensor (for example `H`) | `None` | Only leaf tensors with `requires_grad=True` get gradients accumulated into `.grad` ✅[^4] |
| Two `.backward()` calls without `optimizer.zero_grad()` | Gradients add up to twice the true value | Backward accumulates into `.grad` ✅[^4] |
| Layers with no activation between them | The stack is one linear map; XOR stays at 0.5 | Affine of affine is affine ✅[^2]; lab ✅[^6] |
| ReLU input exactly 0 | Gradient 0 | ReLU is not differentiable at 0; d2l takes the left derivative 0 ✅[^2]; autograd uses the minimum-norm subgradient where the function is convex ✅[^4] |
| Masking the result of a division by zero | Gradient is NaN (not a number) even for the masked-out entry: `x.grad` is `[nan, 1]`, not `[0, 1]` | Autograd differentiates the whole recorded graph; mask before dividing ✅[^4] |
| `gradcheck` on float32 tensors | Likely fails though the gradient is right | Defaults are designed for double precision ✅[^5] |
| `gradcheck` at a kink (ReLU at 0) | May fail | Finite differences and the analytical rule disagree at non-differentiable points ✅[^5] |
| `model.eval()` used to "turn off gradients" | Gradients are still recorded | `eval()` only switches modules such as Dropout and BatchNorm; it is unrelated to no-grad mode ✅[^4] |
| Out of memory in training, not in inference | Expected | Saved intermediates grow with depth and batch size ✅[^1] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Gradients derived by hand | No framework; full control | Re-derived on every model change ✅[^1] |
| Finite differences | Works on any black box | Two loss evaluations per weight, and only approximate (9 matching decimals at `ε = 1e-6` in the lab) ✅[^6]; for checking, not training |
| Reverse-mode autodiff (autograd) | Every gradient for work of the order of one forward pass ✅[^3] | Stores intermediates until backward ends ✅[^1] |
| Forward-mode autodiff | Sometimes preferable when there are more outputs than inputs ✅[^3] | Expensive for one scalar loss over many weights ✅[^3] |

## Takeaways
- A network is linear algebra plus element-wise nonlinearities; without the nonlinearity, depth adds nothing.
- `loss.backward()` is the chain rule run backwards over the graph that the forward pass recorded; it fills `.grad` of leaf tensors and adds to what is already there, so zero the gradients every step. [rule-candidate]
- Check any hand-written gradient or custom layer with `torch.autograd.gradcheck` in float64 before training with it. [rule-candidate]
- Training memory is dominated by saved activations: smaller batches or fewer layers are the first levers.

## Verification status
- Verified: 48 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- [Forward Propagation, Backward Propagation, and Computational Graphs (Dive into Deep Learning, 5.3)](https://d2l.ai/chapter_multilayer-perceptrons/backprop.html) — Zhang, Lipton, Li, Smola, living. Backs: hand derivation before autodiff, forward pass stores intermediates, backward pass in reverse order, the gradient formulas, memory proportional to depth and batch. [^1]
- [Multilayer Perceptrons (Dive into Deep Learning, 5.1)](https://d2l.ai/chapter_multilayer-perceptrons/mlp.html) — Zhang, Lipton, Li, Smola, living. Backs: layer formula, collapse of linear layers, universal approximation, ReLU and tanh derivatives, ReLU at 0. [^2]
- [Deep Feedforward Networks (Deep Learning, chapter 6)](https://www.deeplearningbook.org/contents/mlp.html) — Goodfellow, Bengio, Courville, 2016. Backs: linear model outputs 0.5 on XOR, backprop cost of the order of the forward pass, forward vs reverse mode. [^3]
- [Autograd mechanics](https://docs.pytorch.org/docs/2.15/notes/autograd.html) — PyTorch, 2026 (2.15). Backs: reverse-mode graph, `grad_fn`, graph rebuilt each iteration, saved tensors, `requires_grad` and accumulation, no-grad and inference mode, non-differentiable points, masked division, `eval()` is not no-grad. [^4]
- [torch.autograd.gradcheck](https://docs.pytorch.org/docs/2.15/generated/torch.autograd.gradcheck.gradcheck.html) — PyTorch, 2026 (2.15). Backs: finite differences vs analytical gradients, double-precision defaults, failures at non-differentiable points. [^5]
- `machine-learning/lab-setup.md` — the lab where the XOR fits and the hand-vs-autograd-vs-finite-difference gradient check ran on 2026-11-24. [^6]
- [Backpropagation Through Time (Dive into Deep Learning, 9.7)](https://d2l.ai/chapter_recurrent-neural-networks/bptt.html) — Zhang, Lipton, Li, Smola, living. Backs: the gradient of a shared parameter is the sum over every place it occurs. [^7]

## Related
- `machine-learning/foundations/gradient-descent.md` — what the gradient is used for.
- `machine-learning/foundations/loss-functions-and-maximum-likelihood.md` — where `L` comes from.
- `machine-learning/deep-learning/activations-and-initialization.md` — choosing `φ` and the starting weights so gradients survive depth.
- `machine-learning/deep-learning/optimizers-and-learning-rate-schedules.md` — turning gradients into weight updates.
- `machine-learning/deep-learning/recurrent-networks.md` — backpropagation through time, the same mechanism unrolled over a sequence.
- `floating-point/rounding-and-error.md` — why float64 hand and autograd gradients differ by about `1e-16`.
