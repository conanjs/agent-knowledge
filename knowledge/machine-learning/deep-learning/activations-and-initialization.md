---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/deep-learning
status: verified
applies-to: ["PyTorch 2.15.0"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, deep-learning, activation-functions, sigmoid, tanh, relu, gelu, saturation, vanishing-gradients, exploding-gradients, initialization, xavier, glorot, kaiming, he-init, calculate-gain]
---

# Activations and initialization

## Summary
**TL;DR:** In a deep network the signal going forward and the gradient going backward are each multiplied by a factor at every layer, so a factor slightly below or above 1 becomes a vanishing or exploding number after tens of layers. Saturating activations (sigmoid, tanh: hyperbolic tangent) make the factor small when their inputs are large; weights drawn with the wrong variance make it too small or too large for any activation. Xavier (Glorot) initialization sets the weight variance to `2/(fan_in + fan_out)` for roughly linear activations; He (Kaiming) initialization sets it to `2/fan_in` for ReLU (rectified linear unit), which zeroes half its inputs. ReLU and GELU (Gaussian error linear unit) do not saturate for positive inputs.
**Use this when:** a deep model's loss does not move from step 0, gradients print as 0, `inf` or NaN (not a number), you choose `nn.init` functions or a `gain`, or you choose between sigmoid, tanh, ReLU and GELU for hidden layers.
**Not this doc:** what a layer and backpropagation are → `machine-learning/deep-learning/neural-networks-and-backpropagation.md`; keeping activations in range during training with normalization layers → `machine-learning/deep-learning/normalization-and-dropout.md`; gradients through time in RNNs (recurrent neural networks) → `machine-learning/deep-learning/recurrent-networks.md`.

## Problem
A 50-layer network can be untrainable before it has seen a single example. In the worked example, the same 50-layer, 256-wide network gives NaN outputs with ReLU and weights drawn from `N(0, 1)` (a normal distribution with mean 0 and variance 1), a first-layer gradient of exactly 0 with tanh and `N(0, 0.01²)` weights, and, with sigmoid even under Xavier or He initialization, a first-layer gradient whose norm is only `1e-33` to `3e-27`, so small that float32's `.norm()` prints it as 0 ✅[^7]. The optimizer cannot fix this: a gradient of 0 or `1e-33` gives no useful update, and a NaN or huge one destroys the weights.

## Mental model
**Analogy:** a chain of 50 audio amplifiers, each with its own volume knob. If every knob is at 0.9, the sound that comes out is `0.9^50 = 0.005` of what went in; at 1.1 it is `1.1^50 ≈ 117` times louder. Initialization sets each knob so that one amplifier neither loses nor adds volume on average, and the right setting depends on the activation: ReLU throws away the negative half of the signal, so its knob must be turned up by `√2` in standard deviation compared with a linear stage. A saturating activation is an amplifier that clips: loud input comes out flat, and a flat output passes back almost no gradient.

**Artifact:** the activations and the two standard initializations, as PyTorch computes them; printed by the full script in the Worked example; lab run (`machine-learning/lab-setup.md`), 2026-11-24, PyTorch 2.15.0 ✅[^7]:

```text
z             [-3.0, -1.0, 0.0, 1.0, 3.0]
relu(z)       [0.0, 0.0, 0.0, 1.0, 3.0]
gelu(z)       [-0.004, -0.1587, 0.0, 0.8413, 2.996]
gelu tanh     [-0.0036, -0.1588, 0.0, 0.8412, 2.9964]
sample std: xavier_normal_ 0.0623  kaiming_normal_(relu) 0.0884  calculate_gain('tanh') 1.6667
```

`xavier_normal_` on a 256 × 256 matrix targets a standard deviation (std) of `√(2/(256 + 256)) = 0.0625` and `kaiming_normal_` targets `√2/√256 = 0.0884`; the printed values are the standard deviations of one random sample.

## How it works
### Activations and their derivatives
| Activation | Formula | Derivative | Behaviour |
|---|---|---|---|
| Sigmoid | `σ(z) = 1/(1 + e^(−z))`, range (0, 1) | `σ(z)·(1 − σ(z))`, at most 0.25 at `z = 0` | Gradient vanishes for large positive and negative inputs ✅[^1] |
| tanh | `(1 − e^(−2z))/(1 + e^(−2z))`, range (−1, 1) | `1 − tanh²(z)` | Symmetric about the origin; derivative → 0 away from 0 ✅[^1] |
| ReLU (rectified linear unit) | `max(z, 0)` | 0 for `z < 0`, 1 for `z > 0` | Derivatives either vanish or let the argument through, which mitigated vanishing gradients ✅[^1] |
| GELU (Gaussian error linear unit) | `z·Φ(z)`, `Φ` = standard normal CDF (cumulative distribution function) | smooth everywhere | Weights inputs by their value instead of gating by sign; non-convex, non-monotonic, equal to ReLU asymptotically ✅[^3] |

- Sigmoid has largely been replaced by ReLU in hidden layers; it is still widely used on output units that are read as a binary probability ✅[^1].
- PyTorch's `nn.GELU()` computes `x·Φ(x)`; `approximate='tanh'` uses `0.5·x·(1 + tanh(√(2/π)·(x + 0.044715·x³)))` ✅[^8]. In the artifact, `GELU(1) = 0.8413` (that is `1 × Φ(1)`) and `GELU(−1) = −0.1587`, where ReLU gives 1 and 0; the tanh form differs in the fourth decimal ✅[^7].

### Why the gradient vanishes or explodes
1. **A product of layers:** the gradient with respect to layer `l`'s weights is a product of `L − l` per-layer Jacobian matrices (the matrices of partial derivatives of one layer's output with respect to its input) and one vector, so it can become very large or very small ✅[^2]. In Dive into Deep Learning's run, multiplying 100 random Gaussian 4 × 4 matrices with variance 1 gave entries around `10^23` to `10^25` ✅[^2].
2. **Saturating activations:** a sigmoid's gradient vanishes when its input is large in either direction, and through many layers the overall product is likely to be cut off at some layer ✅[^2]. Glorot and Bengio found the sigmoid unsuited to deep networks with random initialization, because its mean value can drive the top hidden layer into saturation ✅[^4]. In their four-hidden-layer sigmoid network the top layer's outputs were pushed to the sigmoid's lower limit, 0, early in training and escaped only slowly, around epoch 100; a five-hidden-layer network never escaped, and they put forward the cause as a hypothesis ✅[^4].
3. **Large updates or none:** exploding gradients give updates large enough to destroy the model; vanishing ones give updates too small to learn ✅[^2].

### Variance-preserving initialization
Let `n_in` (fan-in) be the number of inputs of a layer and `n_out` (fan-out) its number of outputs.
1. **One linear layer:** for `o_i = Σ_j w_ij·x_j` with independent zero-mean weights of variance `σ²` and inputs of variance `γ²`, `Var[o_i] = n_in·σ²·γ²` ✅[^2]. Example: `n_in = 256`, `σ = 0.01` gives `256 × 0.0001 = 0.0256`, a standard-deviation factor of `√0.0256 = 0.16` per layer; the lab's tanh layer 1 with that init has std `0.157` ✅[^7].
2. **Xavier (Glorot):** the forward pass wants `n_in·σ² = 1`, the backward pass `n_out·σ² = 1`; the compromise is `σ² = 2/(n_in + n_out)`, or the uniform `U(−√(6/(n_in + n_out)), +√(6/(n_in + n_out)))`, since `U(−a, a)` has variance `a²/3` ✅[^2]. The derivation assumes no nonlinearity, yet works well in practice ✅[^2]. PyTorch: `xavier_normal_` uses `std = gain·√(2/(fan_in + fan_out))` and `xavier_uniform_` uses `a = gain·√(6/(fan_in + fan_out))` ✅[^5].
3. **He (Kaiming) for ReLU:** ReLU output is not zero-mean; with symmetric weights `E[x²] = ½·Var[y]`, so each layer multiplies the variance by `½·n_l·Var[w_l]` (`n_l` is layer `l`'s fan-in) and a sufficient condition is `½·n_l·Var[w_l] = 1`, a zero-mean Gaussian with `std = √(2/n_l)` and zero biases ✅[^6]. PyTorch: `kaiming_normal_` uses `std = gain/√fan_mode`; `mode='fan_in'` (default) preserves the forward magnitudes, `'fan_out'` the backward ones ✅[^5].
4. **Xavier under ReLU shrinks geometrically:** with Xavier's linear-case weights (`std = √(1/n_l)`), after `L` ReLU layers the std is `1/√2^L` of what He's init gives ✅[^6]. In the lab, the std ratio from layer 1 to layer 50 is `1.51e-8 / 0.587 = 2.6e-8` with Xavier and `0.508 / 0.831 = 0.61` with He; their quotient, `4.2e-8`, is `(1/√2)^49` to the printed digits, because both runs draw the same matrices and ReLU passes a scaled input through scaled ✅[^7].
5. **The `gain` per activation:** `nn.init.calculate_gain` returns 1 for linear and sigmoid, `5/3` for tanh, `√2` for ReLU, `√(2/(1 + negative_slope²))` for leaky ReLU and `3/4` for SELU (scaled exponential linear unit) ✅[^5].
6. **Random, not constant:** if all weights of a hidden layer start equal, every unit computes the same value and gets the same gradient, so (minibatch) SGD (stochastic gradient descent) never makes them differ; random initialization breaks the symmetry ✅[^2].

## Worked example
A 50-layer, 256-wide MLP (multilayer perceptron) without biases, 512 random inputs with std 1, float32. For each activation and weight standard deviation: the activations' std after layers 1, 10 and 50, and the gradient norm (computed in float64) of the first and last weight matrices for `loss = mean(output²)`. The core loop:

```python
Ws = [(torch.randn(WIDTH, WIDTH, generator=g) * std[i]).requires_grad_() for _ in range(DEPTH)]
h = x
for W in Ws:
    h = act[a](h @ W); stds.append(h.std().item())
(h ** 2).mean().backward()
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-24, PyTorch 2.15.0, two runs identical, re-run 2026-11-25 with the same output; the first 13 lines of the output (the last 5 are the Mental model artifact) ✅[^7]:

```text
act     init            std@1    std@10    std@50  |grad W1| |grad W50|
sigmoid Xavier       2.09e-01  1.26e-01  1.07e-01   1.17e-33   1.22e-01
sigmoid He           2.62e-01  1.70e-01  1.47e-01   2.69e-27   1.20e-01
tanh    N(0,1)       9.75e-01  9.74e-01  9.74e-01   7.30e+20   7.11e-03
tanh    N(0,0.01^2)  1.57e-01  1.08e-08  1.49e-40   0.00e+00   0.00e+00
tanh    Xavier       6.28e-01  2.26e-01  9.43e-02   4.36e-03   7.22e-03
tanh    Xavier*5/3   7.60e-01  6.47e-01  6.49e-01   2.14e+00   3.96e-02
relu    N(0,1)       9.40e+00  2.44e+10       nan        nan        nan
relu    Xavier       5.87e-01  2.22e-02  1.51e-08   3.84e-16   8.79e-16
relu    He           8.31e-01  7.11e-01  5.08e-01   3.06e-01   7.00e-01
same |grad W1| as a float32 .norm(): sigmoid Xavier 0.00e+00  sigmoid He 0.00e+00  tanh N(0,1) inf
largest sigmoid'(z) = 0.25 at z=0; 0.25**50 = 7.9e-31
(1/sqrt(2))**49 = 4.2e-08
```

<details><summary>Full script (prints the output above)</summary>

```python
# Activation scale and gradient scale through a 50-layer, 256-wide MLP (no biases), float32.
# For each (activation, init) pair: std of the activations after layers 1, 10 and 50, and the
# gradient norm (computed in float64) of the first and last weight matrices for loss = mean(output^2).
import math, torch
from torch import nn
torch.manual_seed(0)
DEPTH, WIDTH = 50, 256
x = torch.randn(512, WIDTH)                                    # 512 inputs, std 1
std = {"N(0,1)": 1.0, "N(0,0.01^2)": 0.01,
       "Xavier": math.sqrt(2 / (WIDTH + WIDTH)),               # sqrt(2/(fan_in+fan_out)) = 0.0625
       "Xavier*5/3": 5 / 3 * math.sqrt(2 / (WIDTH + WIDTH)),   # nn.init.calculate_gain('tanh') = 5/3
       "He": math.sqrt(2 / WIDTH)}                             # sqrt(2/fan_in) = 0.0884
act = {"sigmoid": torch.sigmoid, "tanh": torch.tanh, "relu": torch.relu}
runs = [("sigmoid", "Xavier"), ("sigmoid", "He"), ("tanh", "N(0,1)"), ("tanh", "N(0,0.01^2)"),
        ("tanh", "Xavier"), ("tanh", "Xavier*5/3"), ("relu", "N(0,1)"), ("relu", "Xavier"), ("relu", "He")]
f32 = {}
print(f"{'act':7} {'init':11} {'std@1':>9} {'std@10':>9} {'std@50':>9} {'|grad W1|':>10} {'|grad W50|':>10}")
for a, i in runs:
    g = torch.Generator().manual_seed(1)
    Ws = [(torch.randn(WIDTH, WIDTH, generator=g) * std[i]).requires_grad_() for _ in range(DEPTH)]
    h, stds = x, []
    for W in Ws:
        h = act[a](h @ W); stds.append(h.std().item())
    (h ** 2).mean().backward()
    print(f"{a:7} {i:11} {stds[0]:9.2e} {stds[9]:9.2e} {stds[49]:9.2e} "
          f"{Ws[0].grad.double().norm().item():10.2e} {Ws[-1].grad.double().norm().item():10.2e}")
    if (a, i) in [("sigmoid", "Xavier"), ("sigmoid", "He"), ("tanh", "N(0,1)")]: f32[f"{a} {i}"] = Ws[0].grad.norm().item()
print("same |grad W1| as a float32 .norm():", "  ".join(f"{k} {v:.2e}" for k, v in f32.items()))
s = torch.sigmoid(torch.tensor(0.0))
print(f"largest sigmoid'(z) = {(s * (1 - s)).item()} at z=0; 0.25**50 = {0.25 ** 50:.1e}")
print(f"(1/sqrt(2))**49 = {(1 / math.sqrt(2)) ** 49:.1e}")
z = torch.tensor([-3.0, -1.0, 0.0, 1.0, 3.0])
print("z            ", z.tolist())
print("relu(z)      ", torch.relu(z).tolist())
print("gelu(z)      ", [round(v, 4) for v in nn.functional.gelu(z).tolist()])
print("gelu tanh    ", [round(v, 4) for v in nn.functional.gelu(z, approximate="tanh").tolist()])
w = torch.empty(WIDTH, WIDTH)
print(f"sample std: xavier_normal_ {nn.init.xavier_normal_(w).std().item():.4f}  "
      f"kaiming_normal_(relu) {nn.init.kaiming_normal_(w, nonlinearity='relu').std().item():.4f}  "
      f"calculate_gain('tanh') {nn.init.calculate_gain('tanh'):.4f}")
```

</details>

Reading it, row by row:
- **tanh, `N(0, 0.01²)`:** each layer multiplies the std by about 0.16 (step 1 above), so layer 10 is at `1e-8`, layer 50 at `1.5e-40`, and both gradients underflow to exactly 0: vanishing.
- **tanh, `N(0, 1)`:** pre-activations are huge, the outputs sit at ±1 (std 0.974), and the product of 50 backward Jacobians takes the first-layer gradient norm to `7.3e20`, 23 orders of magnitude above the last layer's `7.1e-3`: exploding. The elements themselves are finite (their float64 norm is), yet float32's `.norm()` prints `inf`: it squares them, and the squares overflow float32.
- **tanh, Xavier vs Xavier × 5/3:** plain Xavier still loses signal slowly (0.63 → 0.094), because tanh's slope is below 1 away from 0; the tanh gain of 5/3 holds the std at 0.65 from layer 10 to layer 50.
- **ReLU, `N(0, 1)`:** the std is 9.4 after one layer and `2.4e10` after ten, then overflows to NaN.
- **ReLU, Xavier vs He:** Xavier halves the variance at every layer (std `1.5e-8` at layer 50, gradients near `1e-16`); He keeps the std between 0.83 and 0.51 and both gradients near 0.3–0.7.
- **Sigmoid, Xavier or He:** the activations look fine (std 0.1–0.26), but the first layer's gradient norm is `1.2e-33` with Xavier and `2.7e-27` with He; float32's `.norm()` prints both as `0.00e+00`, because the squares of such small elements underflow. Each layer multiplies the backward signal by `σ'(z) ≤ 0.25`, and `0.25^50 = 7.9e-31` shows how fast that compounds.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| All weights of a layer set to the same constant | Hidden units stay identical; the layer acts as one unit | Same inputs and same gradient for every unit ✅[^2] |
| Sigmoid in every hidden layer of a deep net | First-layer gradient norm `1e-33` (Xavier) to `3e-27` (He) in the lab | Derivative ≤ 0.25 ✅[^1]; its mean value can drive the top hidden layer into saturation ✅[^4]; lab ✅[^7] |
| Gradient norm taken with float32 `.norm()` | Prints `0.00e+00` or `inf` for gradients whose float64 norm is `1.2e-33` or `7.3e20` (lab) | The norm squares the elements, and the squares underflow or overflow float32; call `.double()` before `.norm()` ✅[^7] |
| Xavier with ReLU, very deep | A 30-layer ReLU model stalls with Xavier and converges with He, though it ends less accurate than the paper's 14-layer model ✅[^6] | Variance halves per layer ✅[^6]; lab std `1.5e-8` at layer 50 ✅[^7] |
| Xavier with ReLU, 22 layers | Both converge; He starts reducing the error earlier | The `1/√2^L` loss is not yet fatal ✅[^6] |
| Your code computes `x @ w` with `w.shape = [fan_in, fan_out]` | `nn.init` computes fan-in and fan-out swapped | It assumes `x @ w.T` with `w.shape = [fan_out, fan_in]`; pass `w.T` ✅[^5] |
| SELU self-normalizing network | Use `nonlinearity='linear'`, not `'selu'` | The SELU gain trades the normalization for gradient flow ✅[^5] |
| PyTorch's default `nn.Linear` init | Weights `U(−√k, √k)` with `k = 1/in_features`, variance `1/(3·in_features)`, a std `√(1/6) ≈ 0.41` times He's | Linear docs ✅[^9]; uniform variance `a²/3` ✅[^2]; a default often works for moderate sizes ✅[^2] |
| Input not normalized (pixels in [−128, 128]) | Large activations all the way up; softmax can overflow | Variance-preserving init carries the input's magnitude to the last layer ✅[^6] |
| A ReLU unit whose input is negative for every example | Its weights get zero gradient while that lasts | ReLU's derivative is 0 for negative inputs ✅[^1] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Sigmoid / tanh hidden layers | Bounded outputs; tanh is symmetric about the origin ✅[^1] | Saturate: derivatives near 0 for large inputs ✅[^1]; sigmoid gradients vanish in deep stacks ✅[^2] |
| ReLU | Derivative 0 or 1; mitigated vanishing gradients ✅[^1] | Zero gradient for negative inputs ✅[^1]; a 30-layer ReLU stack stalls with Xavier and converges with He ✅[^6] |
| GELU | Matched or exceeded ReLU and ELU (exponential linear unit) across the vision, language and speech recognition tasks in its paper ✅[^3] | Needs `Φ` or a close approximation, which the authors call important ✅[^3] |
| Xavier init | Balances forward and backward variance for near-linear activations ✅[^2] | Shrinks ReLU signals by `1/√2` per layer ✅[^6] |
| He init | Keeps ReLU variance constant; makes a 30-layer ReLU net converge where Xavier stalls ✅[^6] | Designed for rectifiers; other activations need their own gain ✅[^5] |

## Takeaways
- Pick the initializer for the activation: He (`kaiming_normal_`, `nonlinearity='relu'`) for ReLU-family layers, Xavier with `calculate_gain` for tanh or linear layers. [rule-candidate]
- Before a long training run, print the activation std per layer and the gradient norm of the first and last layer at step 0; values near 0, `inf` or NaN mean the init or activation is wrong, not the optimizer. Compute those norms in float64, or a gradient that is only tiny or huge prints as 0 or `inf`. [rule-candidate]
- Keep sigmoid for outputs that are probabilities, not for the hidden layers of a deep network.
- Depth multiplies small errors in scale: a factor of 0.16 or 2 per layer is fatal over 50 layers, so normalize inputs as well.

## Verification status
- Verified: 55 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [Multilayer Perceptrons (Dive into Deep Learning, 5.1)](https://d2l.ai/chapter_multilayer-perceptrons/mlp.html) — Zhang, Lipton, Li, Smola, living. Backs: sigmoid, tanh, ReLU formulas and derivatives, sigmoid's maximum derivative 0.25, ReLU mitigating vanishing gradients, sigmoid replaced in hidden layers. [^1]
- [Numerical Stability and Initialization (Dive into Deep Learning, 5.4)](https://d2l.ai/chapter_multilayer-perceptrons/numerical-stability-and-init.html) — Zhang, Lipton, Li, Smola, living. Backs: gradient as a product of matrices, 100-matrix explosion, sigmoid vanishing, `Var[o] = n_in·σ²·γ²`, Xavier normal and uniform, symmetry breaking, default init for moderate sizes. [^2]
- [Gaussian Error Linear Units (GELUs)](https://arxiv.org/html/1606.08415v5) — Hendrycks, Gimpel, 2016 (v5, 2023; full text read, arXiv HTML). Backs: `x·Φ(x)`, weighting by value vs gating by sign, non-convex and non-monotonic, asymptotic equality with ReLU, results vs ReLU and ELU, close approximation of `Φ` matters. [^3]
- [Understanding the difficulty of training deep feedforward neural networks](https://proceedings.mlr.press/v9/glorot10a.html) — Glorot, Bengio, 2010 (full text read, PDF). Backs: sigmoid unsuited to deep nets with random init because of its mean value; the top hidden layer's early saturation and slow escape in their four- and five-layer sigmoid networks (§3.1, Figure 2). [^4]
- [torch.nn.init](https://docs.pytorch.org/docs/2.15/nn.init.html) — PyTorch, 2026 (2.15). Backs: `calculate_gain` values, Xavier and Kaiming formulas, `fan_in` vs `fan_out`, transposed-weight note, SELU warning. [^5]
- [Delving Deep into Rectifiers: Surpassing Human-Level Performance on ImageNet Classification](https://arxiv.org/html/1502.01852v1) — He, Zhang, Ren, Sun, 2015 (full text read, PDF). Backs: ReLU variance condition and `√(2/n_l)`, Xavier's `1/√2^L` shrink, 22-layer and 30-layer comparisons (§2.2, Figures 2 and 3), the 30-layer model's accuracy, unnormalized input overflow. [^6]
- `machine-learning/lab-setup.md` — the lab where the 50-layer activation/initialization sweep, the GELU values and the `nn.init` samples ran on 2026-11-24. [^7]
- [torch.nn.GELU](https://docs.pytorch.org/docs/2.15/generated/torch.nn.GELU.html) — PyTorch, 2026 (2.15). Backs: exact and tanh-approximate formulas. [^8]
- [torch.nn.Linear](https://docs.pytorch.org/docs/2.15/generated/torch.nn.Linear.html) — PyTorch, 2026 (2.15). Backs: default weight init `U(−√k, √k)`, `k = 1/in_features`. [^9]

## Related
- `machine-learning/deep-learning/neural-networks-and-backpropagation.md` — the backward pass whose per-layer factors this doc keeps near 1.
- `machine-learning/deep-learning/normalization-and-dropout.md` — batch and layer norm re-scale activations during training.
- `machine-learning/deep-learning/convolutional-networks.md` — residual connections, the other fix for very deep stacks.
- `machine-learning/deep-learning/recurrent-networks.md` — the same products, taken over time steps.
- `floating-point/special-values-and-exceptions.md` — how float32 overflow gives `inf` and NaN, and underflow gives 0.
