---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/deep-learning
status: verified
applies-to: ["PyTorch 2.15.0", "scikit-learn 1.9.1", "scipy 1.18.1"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, deep-learning, interpretability, attribution, saliency, integrated-gradients, smoothgrad, grad-cam, sanity-checks, probing, mechanistic-interpretability, superposition, sparse-autoencoders]
---

# Interpretability and attribution for deep networks

## Summary
**TL;DR:** An attribution method gives each input feature a score for how much it drove one output. The plain gradient says how sensitive the output is right here; it misses features whose effect has saturated and does not add up to anything. Integrated gradients (IG) averages the gradient along a straight path from a baseline input to the real input and multiplies by the distance travelled, so the scores add up to `f(x) − f(baseline)` (completeness); the answer depends on which baseline you pick. A map that looks plausible is not proof: re-run the method on a model with random weights, and if the map barely changes it is explaining the input, not the model. Probes and mechanistic interpretability (features, circuits, superposition, sparse autoencoders) look inside the network instead of at its inputs.
**Use this when:** you show a saliency map or per-feature attribution to someone, pick a baseline for integrated gradients, read that "layer k encodes concept c" because a probe works, or meet the words feature, circuit, polysemantic, superposition or sparse autoencoder.
**Not this doc:** model-agnostic importance for tabular models (permutation importance, impurity importance) → `machine-learning/data-and-features/feature-importance-and-selection.md`; how the gradients themselves are computed → `machine-learning/deep-learning/neural-networks-and-backpropagation.md`; inputs crafted to flip the prediction, which use the same input gradient → `machine-learning/deep-learning/adversarial-robustness.md`.

## Problem
A trained network gives an answer but no reason. The obvious reason, "the pixels or features with the largest gradient", has three flaws. The gradient can be zero for a feature that changed the output, because the function has gone flat at the input: for `f(x) = 1 − ReLU(1 − x)` with baseline 0 and input 2, the output moves from 0 to 1, yet the gradient at `x = 2` is 0 ✅[^1]. Gradient scores do not add up to the output: in the lab, the gradients of one input sum to `7.40` while the logit moved by `22.62` from the baseline ✅[^7]. And a map can look convincing while ignoring the model: some saliency methods are independent of both the model and the data, like an edge detector ✅[^5].

## Mental model
**Analogy:** a bill split after a group dinner. The gradient is asking each friend "if you ate one more bite now, how much would the bill rise?": a friend who is already full answers "nothing", though they ate a lot. Integrated gradients replays the meal from an empty table (the baseline) to the final order and charges each person for what they added along the way, so the shares add up to the whole bill (completeness). The empty table is a choice: start from "everyone already had bread" and the shares change. The sanity check is handing the same bill-splitting rule a random receipt: if it still produces the same shares, it was never reading the receipt.

**Artifact:** one input to an MLP (multilayer perceptron) whose label depends only on feature 0; printed by the full script in the Worked example; lab run (`machine-learning/lab-setup.md`), 2026-11-25, PyTorch 2.15.0 ✅[^7]:

```text
f(x) = 23.1119  f(baseline=0) = 0.4881  difference 22.6238
gradient           [10.908, -1.36, -1.242, 0.423, 1.432, 0.643, -2.3, -1.105] sum 7.3988
gradient x input   [16.361, 1.088, -0.745, 0.508, -1.432, 0.257, 0.69, -0.994] sum 15.7333
integrated grads   [24.42, 0.695, -0.391, 0.113, -1.695, 0.146, 0.449, -1.122] sum 22.6147
```

All three methods put feature 0 first; only integrated gradients sums to the change in the output (`22.6147` against `22.6238`).

## How it works
### Gradient-based attributions
1. **Gradient (saliency map):** the derivative of the class score with respect to the input, one number per input feature or pixel; Simonyan et al. compute an image- and class-specific saliency map this way, from the unnormalized class score with one back-propagation pass, taking for colour images the largest absolute derivative across the colour channels ✅[^2]. It measures local sensitivity, so it fails Sundararajan et al.'s **Sensitivity** axiom: a feature that changes the output can get zero attribution when the function is flat at the input ✅[^1].
2. **Gradient × input:** multiply each gradient by the feature value. IG's authors call this product a reasonable starting point, but it inherits the gradient's Sensitivity problem ✅[^1]. Example: a feature of value 1.5 with gradient 10.9 gets `16.4` (lab row above).
3. **Integrated gradients:** `IG_i(x) = (x_i − x'_i) · ∫₀¹ ∂F(x' + α(x − x'))/∂x_i dα`, the gradient averaged over the straight line from baseline `x'` to `x`, times the distance ✅[^1].
   - **Completeness:** the attributions add up to `F(x) − F(x')` when `F` is differentiable almost everywhere, which networks of ReLUs, sigmoids and pooling are ✅[^1].
   - **Implementation invariance:** two networks with identical outputs for every input get identical attributions; IG keeps this property because it uses only gradients, whereas DeepLift and LRP (layer-wise relevance propagation) use discrete gradients, for which the chain rule fails, and lose it ✅[^1].
   - **In practice:** approximate the integral with a Riemann sum; between 20 and 300 steps usually give the integral to within 5 %, and you should check that the scores add up and raise the step count if not ✅[^1]. Each step is one gradient call (in PyTorch, `torch.autograd.grad` gives the vector–Jacobian product of the output with respect to the input ✅[^13]).
4. **The baseline is a hyperparameter.** IG's paper asks for a baseline with a near-zero score: a black image for images, the all-zero embedding for text ✅[^1]. A constant baseline cannot credit features equal to it: with a black baseline, IG will not highlight black pixels even when they make up the object ✅[^6]. Alternatives are a blurred input, uniform or Gaussian noise, the farthest valid input, or averaging over many baselines drawn from the data (expected gradients); Sturmfels et al. reach no conclusion about which is best ✅[^6].
5. **SmoothGrad:** average the gradient map over `n` copies of the input with Gaussian noise `N(0, σ²)` added ✅[^3]. Its authors conjecture that raw gradients are noisy because the derivative fluctuates sharply at small scales; they suggest noise of 10–20 % of the input range and about 50 samples, and it can wrap IG or Guided BackProp too ✅[^3].
6. **Grad-CAM (gradient-weighted class activation mapping):** for convolutional networks, average the gradient of the class score over each feature map `A^k` of the last convolutional layer to get a weight `α_k`, then take `ReLU(Σ_k α_k A^k)` ✅[^4]. The ReLU keeps features with a positive influence on the class; the map has the feature map's coarse resolution, 14×14 for VGG's last layers ✅[^4]. It needs no change or re-training of the architecture ✅[^4].

### Sanity checks (Adebayo et al.)
1. **Model parameter randomization:** compare the explanation of the trained model with one from a randomly initialized network of the same architecture, either re-initializing layers from the top down (cascading) or one at a time (independent) ✅[^5].
2. **Data randomization:** compare with a model trained on the same data with randomly permuted labels ✅[^5].
3. **Similarity measure:** Spearman rank correlation of the attribution values, with and without taking absolute values, plus SSIM (structural similarity) and HOG (histogram of oriented gradients) similarity ✅[^5].
4. **Results:** plain gradients and Grad-CAM pass; Guided BackProp and Guided Grad-CAM are invariant to higher-layer parameters and fail ✅[^5]. Gradient ⊙ input and IG are dominated by the input's own structure, so their maps keep looking like the input after the weights are randomized ✅[^5].

### Looking inside: probes and mechanistic interpretability
1. **Linear probes:** train a linear classifier on a layer's activations, separately from the model, to see what that layer makes linearly readable; Alain and Bengio found the linear separability of features rising almost monotonically with depth in trained networks, with small exceptions in their plots such as one ResNet-50 layer where probe error ticks up from 0.76 to 0.77 ✅[^8]. A probe that succeeds shows the information is decodable, not that the model uses it. Hewitt and Liang's control tasks map inputs to random outputs that only the probe can memorize; a good probe is **selective** (high accuracy on the real task, low on the control), and popular probes on ELMo (embeddings from language models) were not ✅[^9].
2. **Features and circuits:** Olah et al.'s three speculative claims are that features are the fundamental unit and correspond to directions (linear combinations of neurons) in a layer's activation space; that features connected by weights form circuits (small computational subgraphs); and that analogous features and circuits form across models and tasks (universality) ✅[^10].
3. **Polysemantic neurons and superposition:** many neurons respond to unrelated inputs, such as one InceptionV1 neuron for cat faces, fronts of cars and cat legs ✅[^10]. Elhage et al. call superposition a model representing more features than it has dimensions; with sparse features it compresses beyond what a linear model would do, at the cost of interference that a nonlinearity must filter ✅[^11]. In their toy model with 5 features squeezed into 2 dimensions plus a ReLU, dense features give an orthogonal basis of the 2 most important features and the other 3 are dropped, while at 80 % sparsity the 4 most important fit as antipodal pairs and at 90 % all 5 sit in a pentagon, with interference ✅[^11].
4. **Sparse autoencoders (SAEs):** dictionary learning to undo superposition. Bricken et al. train an autoencoder on the 512-neuron MLP layer of a one-layer transformer, with hidden widths from 512 (1×) to 131,072 (256×), an L2 reconstruction loss plus an L1 penalty on the hidden activations ✅[^12]. A blinded human annotator and two automated methods all found the learned features much more interpretable than the neurons ✅[^12]. Costs: some features die (168 of 4,096 never fired on 100 million examples), and features split into finer ones as the dictionary grows (1 → 3 → many base64 features for 512 → 4,096 → 16,384 features) ✅[^12].

## Worked example
A 3-layer MLP (8 → 32 → 32 → 1, ReLU) trained with Adam for 200 full-batch steps on 4,000 points with 8 standard normal features, label `x₀ > 0`; the attributed output is the logit. Then: the completeness check for one input `x`, the share of each method's absolute attribution that lands on the planted feature, Adebayo's model randomization test, and a linear probe on the first hidden layer. Core lines:

```python
alphas = (torch.arange(steps) + 0.5) / steps          # midpoint Riemann sum
path = baseline + alphas[:, None] * (x - baseline)
ig = (x - baseline) * grad(model, path).mean(0)        # sums to f(x) - f(baseline)
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-25, PyTorch 2.15.0, scikit-learn 1.9.1, two runs identical; lines 2–5 are the Mental model artifact ✅[^7]:

```text
trained MLP: test accuracy 0.992
  IG steps   4: completeness gap |sum - difference| = 0.94470
  IG steps  16: completeness gap |sum - difference| = 0.04916
  IG steps  64: completeness gap |sum - difference| = 0.00913
  IG steps 256: completeness gap |sum - difference| = 0.01802
== share of |attribution| on planted feature 0, mean over 200 test points (1/8 = 0.125 if uniform) ==
gradient 0.779 | gradient x input 0.720 | IG 0.799 | SmoothGrad 0.825
== sanity check: same attributions from a randomly re-initialized copy ==
random model: share on feature 0: gradient 0.126 | IG 0.126
rank correlation trained vs random |attr|: gradient 0.010 | IG 0.345
rank correlation of |attr| with |input| alone: random-model gradient x input 0.655 | random-model gradient 0.057
== linear probe on the first hidden layer (after ReLU): can it read feature 5, which the label ignores? ==
trained net, probe for sign(x0): test accuracy 0.991
trained net, probe for sign(x5): test accuracy 0.920
random  net, probe for sign(x0): test accuracy 0.932
random  net, probe for sign(x5): test accuracy 0.926
```

<details><summary>Full script (prints the output above)</summary>

```python
# Gradient, gradient x input, integrated gradients, SmoothGrad, a randomized-weights sanity check
# and a linear probe, on an MLP trained on data with one planted feature (PyTorch, CPU).
import torch
from torch import nn
from scipy.stats import spearmanr
from sklearn.linear_model import LogisticRegression
torch.manual_seed(0)

D = 8                                           # features 0..7; only feature 0 decides the label
X = torch.randn(4000, D)
y = (X[:, 0] > 0).float()                      # the planted feature
def make_mlp():
    return nn.Sequential(nn.Linear(D, 32), nn.ReLU(), nn.Linear(32, 32), nn.ReLU(), nn.Linear(32, 1))
model = make_mlp()
opt = torch.optim.Adam(model.parameters(), lr=3e-3)
for _ in range(200):                            # full-batch training
    opt.zero_grad()
    loss = nn.functional.binary_cross_entropy_with_logits(model(X).squeeze(1), y)
    loss.backward(); opt.step()
Xte = torch.randn(1000, D)
acc = ((model(Xte).squeeze(1) > 0).float() == (Xte[:, 0] > 0).float()).float().mean().item()
print(f"trained MLP: test accuracy {acc:.3f}")

def f(m, x):                                    # the scalar explained: the logit
    return m(x).squeeze(-1)
def grad(m, x):
    x = x.clone().requires_grad_(True)
    f(m, x).sum().backward()
    return x.grad.detach()
def integrated_gradients(m, x, baseline, steps=64):
    alphas = (torch.arange(steps) + 0.5) / steps    # midpoint Riemann sum over the straight path
    path = baseline + alphas[:, None] * (x - baseline)
    return (x - baseline) * grad(m, path).mean(0)
def smoothgrad(m, x, sigma=0.3, n=64):
    return grad(m, x + sigma * torch.randn(n, D)).mean(0)

x = torch.tensor([1.5, -0.8, 0.6, 1.2, -1.0, 0.4, -0.3, 0.9])
base = torch.zeros(D)
g, ig = grad(model, x[None])[0], integrated_gradients(model, x, base)
gxi = g * x
target = (f(model, x[None]) - f(model, base[None])).item()
print(f"f(x) = {f(model, x[None]).item():.4f}  f(baseline=0) = {f(model, base[None]).item():.4f}  difference {target:.4f}")
print("gradient          ", [round(v, 3) for v in g.tolist()], "sum", round(g.sum().item(), 4))
print("gradient x input  ", [round(v, 3) for v in gxi.tolist()], "sum", round(gxi.sum().item(), 4))
print("integrated grads  ", [round(v, 3) for v in ig.tolist()], "sum", round(ig.sum().item(), 4))
for steps in (4, 16, 64, 256):
    print(f"  IG steps {steps:3d}: completeness gap |sum - difference| = {abs(integrated_gradients(model, x, base, steps).sum().item() - target):.5f}")

def share0(a):                                  # share of total |attribution| on the planted feature
    a = a.abs(); return (a[..., 0] / a.sum(-1)).mean().item()
Xs = Xte[:200]
print("== share of |attribution| on planted feature 0, mean over 200 test points (1/8 = 0.125 if uniform) ==")
G = grad(model, Xs)
IG = torch.stack([integrated_gradients(model, xi, base) for xi in Xs])
SG = torch.stack([smoothgrad(model, xi) for xi in Xs])
print(f"gradient {share0(G):.3f} | gradient x input {share0(G * Xs):.3f} | IG {share0(IG):.3f} | SmoothGrad {share0(SG):.3f}")

print("== sanity check: same attributions from a randomly re-initialized copy ==")
torch.manual_seed(1)
rand = make_mlp()
Gr = grad(rand, Xs)
IGr = torch.stack([integrated_gradients(rand, xi, base) for xi in Xs])
def mean_rank_corr(a, b):
    return sum(spearmanr(a[i].abs(), b[i].abs()).statistic for i in range(len(a))) / len(a)
print(f"random model: share on feature 0: gradient {share0(Gr):.3f} | IG {share0(IGr):.3f}")
print(f"rank correlation trained vs random |attr|: gradient {mean_rank_corr(G, Gr):.3f} | IG {mean_rank_corr(IG, IGr):.3f}")
print(f"rank correlation of |attr| with |input| alone: random-model gradient x input {mean_rank_corr(Gr * Xs, Xs):.3f}"
      f" | random-model gradient {mean_rank_corr(Gr, Xs):.3f}")

print("== linear probe on the first hidden layer (after ReLU): can it read feature 5, which the label ignores? ==")
def hidden(m, x):
    return m[1](m[0](x)).detach().numpy()
for name, m in (("trained", model), ("random ", rand)):
    for feat in (0, 5):
        probe = LogisticRegression(max_iter=2000).fit(hidden(m, X[:2000]), (X[:2000, feat] > 0).numpy())
        print(f"{name} net, probe for sign(x{feat}): test accuracy {probe.score(hidden(m, Xte), (Xte[:, feat] > 0).numpy()):.3f}")
```

</details>

Reading it, line by line:
- **Completeness:** IG's sum `22.6147` matches `f(x) − f(0) = 22.6238`; the gradient sums to `7.40` and gradient × input to `15.73`, neither related to the change in output. The gap falls from `0.94` at 4 steps to `0.009` at 64; at 256 it is `0.018`, so beyond some point float32 rounding and ReLU kinks dominate, which is why the check matters more than the step count.
- **Planted feature:** every method puts 72–83 % of its absolute attribution on feature 0, against 12.5 % for a uniform spread; SmoothGrad (σ = 0.3, 64 samples) is the most concentrated in this run.
- **Sanity check, gradient:** on random weights the share on feature 0 drops to `0.126`, chance level, and the rank correlation with the trained model's map is `0.010`: the gradient depends on the weights, so it passes.
- **Sanity check, IG and gradient × input:** IG on random weights still correlates `0.345` with the trained IG, and random-weight gradient × input correlates `0.655` with `|x|` itself. Both multiply by the input, so part of any such map is the input, not the model, which is Adebayo et al.'s warning ✅[^5].
- **Probe:** a linear probe reads the sign of the unused feature 5 from the trained network's first hidden layer at `0.920`, and both features from a random network at `0.93`. A random ReLU layer keeps most input information linearly decodable, so probe accuracy alone says little about what the model relies on; a control (random network, control task) is the comparison that counts ✅[^9].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Feature whose effect has saturated | Gradient near 0 although the feature mattered | Function flat at the input; IG's ReLU example ✅[^1] |
| Too few IG steps | Scores do not add up (lab gap 0.94 at 4 steps) | Riemann sum too coarse; 20–300 steps usually within 5 % ✅[^1]; lab ✅[^7] |
| Feature equal to the baseline value | Attribution exactly 0 | The `(x_i − x'_i)` factor; black pixels under a black baseline ✅[^6] |
| Different baselines | Different, all "complete", attributions | Completeness is relative to the chosen `F(x')` ✅[^1]; no best baseline ✅[^6] |
| Map unchanged on random weights | Method explains the input or the architecture, not the learned model | Guided BackProp, Guided Grad-CAM fail the test ✅[^5] |
| Gradient × input or IG on sparse inputs | Maps resemble the input | Input structure dominates ✅[^5]; lab correlation 0.655 with `|x|` ✅[^7] |
| Noisy-looking gradient map | Speckle that hides structure | Derivative fluctuates at small scales; SmoothGrad averages it ✅[^3] |
| Grad-CAM where fine detail matters | Coarse map without fine-grained detail | Resolution of the last conv layer, 14×14 for VGG ✅[^4] |
| Probe succeeds | Information is decodable, not necessarily used | Probe capacity; control tasks and selectivity ✅[^9]; lab random-net probe 0.93 ✅[^7] |
| One neuron, several unrelated concepts | Polysemantic neuron; reading it as one concept misleads | Superposition ✅[^10] ✅[^11] |
| Bigger SAE dictionary | Features split into finer ones; some die | Feature splitting and dead features in Bricken et al. ✅[^12] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Plain gradient | One backward pass; depends on the weights (passes the randomization test) ✅[^5] | Breaks Sensitivity; noisy ✅[^1] ✅[^3] |
| Integrated gradients | Completeness, Sensitivity, implementation invariance ✅[^1] | 20–300 gradient calls ✅[^1]; baseline choice ✅[^6]; input-dominated on sparse inputs ✅[^5] |
| SmoothGrad | Cleaner maps; wraps other methods ✅[^3] | About 50 gradient calls; σ is another knob ✅[^3] |
| Grad-CAM | Class-discriminative, no re-training ✅[^4]; passes the randomization test ✅[^5] | Coarse resolution; CNN-specific ✅[^4] |
| Linear probe | Cheap test of what a layer encodes ✅[^8] | Decodable ≠ used; needs controls ✅[^9] |
| Sparse autoencoder | Features more interpretable than neurons ✅[^12] | Training at scale; dead features; dictionary size changes the answer ✅[^12] |

## Takeaways
- Before showing a saliency map, run the model-randomization check: if the map survives random weights, do not present it as an explanation. [rule-candidate]
- For integrated gradients, always print `sum(attributions)` next to `f(x) − f(baseline)` and raise the step count until they agree. [rule-candidate]
- State the baseline with every IG result; a different baseline is a different question.
- Report a probe's accuracy next to the same probe on a random network or a control task.

## Verification status
- Verified: 69 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [Axiomatic Attribution for Deep Networks](https://ar5iv.labs.arxiv.org/html/1703.01365) — Sundararajan, Taly, Yan, 2017 (ar5iv HTML of arXiv:1703.01365). Backs: IG formula, completeness, Sensitivity and the ReLU example, implementation invariance, DeepLift/LRP, gradient × input, baselines, 20–300 steps. [^1]
- [Deep Inside Convolutional Networks: Visualising Image Classification Models and Saliency Maps](https://arxiv.org/abs/1312.6034) — Simonyan, Vedaldi, Zisserman, 2013 (full text read on ar5iv). Backs: gradient-based, image- and class-specific saliency maps, unnormalized score, single back-propagation pass, maximum over colour channels. [^2]
- [SmoothGrad: removing noise by adding noise](https://ar5iv.labs.arxiv.org/html/1706.03825) — Smilkov, Thorat, Kim, Viégas, Wattenberg, 2017 (ar5iv HTML). Backs: averaging noisy gradients, 10–20 % noise, ~50 samples, small-scale fluctuation, combination with IG. [^3]
- [Grad-CAM: Visual Explanations from Deep Networks via Gradient-based Localization](https://ar5iv.labs.arxiv.org/html/1610.02391) — Selvaraju et al., 2016 (ar5iv HTML). Backs: pooled-gradient weights, ReLU of the weighted sum, 14×14 resolution, no fine-grained detail, no re-training. [^4]
- [Sanity Checks for Saliency Maps](https://ar5iv.labs.arxiv.org/html/1810.03292) — Adebayo, Gilmer, Muelly, Goodfellow, Hardt, Kim, 2018 (ar5iv HTML). Backs: model and data randomization tests, Spearman of absolute values, which methods pass and fail, input-dominated maps, edge-detector comparison. [^5]
- [Visualizing the Impact of Feature Attribution Baselines](https://distill.pub/2020/attribution-baselines/) — Sturmfels, Lundberg, Lee, Distill, 2020. Backs: baseline as hyperparameter, black-pixel blindness, alternative baselines, no best one. [^6]
- `machine-learning/lab-setup.md` — the lab where the attribution, sanity-check and probe script ran on 2026-11-25. [^7]
- [Understanding intermediate layers using linear classifier probes](https://arxiv.org/abs/1610.01644) — Alain, Bengio, 2016 (full text read on ar5iv). Backs: probes trained independently of the model, separability rising almost monotonically with depth, the ResNet-50 exception. [^8]
- [Designing and Interpreting Probes with Control Tasks](https://arxiv.org/abs/1909.03368) — Hewitt, Liang, 2019 (full text read on ar5iv). Backs: control tasks, selectivity, non-selective probes on ELMo. [^9]
- [Zoom In: An Introduction to Circuits](https://distill.pub/2020/circuits/zoom-in/) — Olah, Cammarata, Schubert, Goh, Petrov, Carter, Distill, 2020. Backs: features as directions, circuits, universality, polysemantic neurons, superposition as the cause. [^10]
- [Toy Models of Superposition](https://transformer-circuits.pub/2022/toy_model/index.html) — Elhage et al., Transformer Circuits Thread, 2022. Backs: superposition definition, sparsity and interference, the 5-features-in-2-dimensions toy model at 0, 80 and 90 % sparsity. [^11]
- [Towards Monosemanticity: Decomposing Language Models With Dictionary Learning](https://transformer-circuits.pub/2023/monosemantic-features/index.html) — Bricken et al., Transformer Circuits Thread, 2023. Backs: SAE setup, L2 + L1 loss, human and automated interpretability vs neurons, dead features, feature splitting. [^12]
- [torch.autograd.grad](https://docs.pytorch.org/docs/2.15/generated/torch.autograd.grad.html) — PyTorch, 2026 (2.15). Backs: the vector–Jacobian product used for input gradients. [^13]

## Related
- `machine-learning/data-and-features/feature-importance-and-selection.md` — permutation and impurity importance for whole datasets and tabular models.
- `machine-learning/deep-learning/adversarial-robustness.md` — the same input gradient, used to attack instead of explain.
- `machine-learning/deep-learning/neural-networks-and-backpropagation.md` — how the input gradient is computed.
- `machine-learning/deep-learning/convolutional-networks.md` — the feature maps Grad-CAM weights.
- `machine-learning/transformers/attention-and-the-transformer.md` — the MLP layer inside the transformer block that the sparse autoencoder decomposes.
