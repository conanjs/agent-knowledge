---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/deep-learning
status: verified
applies-to: ["PyTorch 2.15.0"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, deep-learning, adversarial-examples, adversarial-robustness, fgsm, pgd, adversarial-training, threat-model, gradient-masking, obfuscated-gradients, randomized-smoothing, certified-robustness]
---

# Adversarial examples and robustness

## Summary
**TL;DR:** An adversarial example is an input changed by a small, deliberately chosen amount, within a budget such as "no feature moves more than ε" (an L∞ ball), that makes a model misclassify it. FGSM (fast gradient sign method) takes one step of size ε in the sign of the input gradient of the loss; PGD (projected gradient descent) takes many smaller steps and projects back into the ball after each, and is the standard strong attack. Adversarial training trains on PGD examples, which buys robust accuracy, often at a cost in clean accuracy because the robust model must ignore features that are predictive but easy to perturb. A defense that only breaks the attacker's gradients (gradient masking) looks robust and is not; certified defenses such as randomized smoothing prove a radius instead.
**Use this when:** you evaluate or report a model's robustness, choose a threat model and ε, implement FGSM, PGD or adversarial training, or review a defense that claims robustness.
**Not this doc:** the input gradient used to explain rather than attack → `machine-learning/deep-learning/interpretability-and-attribution.md`; ordinary overfitting and the train/test gap → `machine-learning/foundations/generalization-and-overfitting.md`; drift in real input distributions → `machine-learning/ml-systems/data-drift-and-monitoring.md`.

## Problem
A model with high test accuracy can be wrong on almost every test point after a change too small to notice. Szegedy et al. found that an imperceptible perturbation, found by optimizing the input to maximize the network's prediction error (in practice a box-constrained L-BFGS (limited-memory Broyden–Fletcher–Goldfarb–Shanno, a quasi-Newton optimizer) search for the smallest change that gives a chosen wrong label), makes a network misclassify an image, and that such perturbations still fool a network trained on a disjoint half of the MNIST training set, though their effectiveness drops considerably ✅[^1]. In the lab, a classifier with 95.3 % test accuracy drops to 13.0 % when an attacker may move every feature by at most 0.4, while random ±0.4 noise leaves it at 94.4 % ✅[^7]. Testing with random noise, or with a weak attack, therefore says nothing about worst-case behaviour.

## Mental model
**Analogy:** a cheque checked by a clerk who adds up 50 faint watermarks and one clear signature. Each watermark is only weakly reliable, but together they almost always give the right answer, so the clerk relies on them. A forger who can nudge every watermark a little (a small L∞ budget) flips the total without touching the signature. A robust clerk learns to trust only the signature: right a little less often on honest cheques (clean accuracy falls), but no longer fooled by nudges. Adversarial training is the forger working as a sparring partner during training.

**Artifact:** the attack curve for a standard-trained MLP; printed by the full script in the Worked example; lab run (`machine-learning/lab-setup.md`), 2026-11-25, PyTorch 2.15.0 ✅[^7]:

```text
eps    clean/none  random +-eps  FGSM    PGD-20
0.00   0.953       0.953         0.953   0.953
0.10   0.953       0.949         0.844   0.844
0.20   0.953       0.946         0.666   0.654
0.40   0.953       0.944         0.177   0.130
```

Random noise in the same box barely moves accuracy; the gradient-chosen perturbation of the same size removes most of it.

## How it works
### Threat model
1. **What a threat model fixes:** the adversary's goals, knowledge and capabilities, and it is part of the defense itself ✅[^8]. Goal: any misclassification (untargeted) or a chosen wrong class (targeted) ✅[^8].
2. **Capability, the budget:** usually a perturbation `δ` with `‖δ‖_p ≤ ε`; L∞ and L2 are the common norms for images ✅[^8]. L∞ bounds every feature: `ε = 8/255` means no pixel moves more than 8 of 255 levels, a typical CIFAR-10 (Canadian Institute for Advanced Research, 10 classes) and ImageNet budget ✅[^8]. L2 bounds the total Euclidean length, so a few features may move far. The Lp model does not match real-world threats perfectly ✅[^8].
3. **Knowledge:** white-box means the attacker knows the model and its parameters; black-box means it can only query or must transfer ✅[^8]. Assume the attacker knows the defense (Kerckhoffs' principle); white-box robustness implies black-box robustness, not the reverse ✅[^8]. Transfer is why black-box attacks work: an example built for one model is often misclassified by others ✅[^2].

### Why small perturbations work: the linearity explanation
1. Goodfellow et al. argue the main cause is that networks behave too linearly ✅[^2]. For a linear score `wᵀx`, the perturbation `η = ε·sign(w)` raises it by `ε·Σ|w_i|`, which is about `ε·m·n` for `n` features with average weight size `m`: many tiny changes add up to one large change in high dimension ✅[^2].
2. Example: 50 features each with weight 0.2 and `ε = 0.4` shift the score by `50 × 0.2 × 0.4 = 4`, though no single feature moved more than 0.4.
3. Random noise is inefficient: zero-mean noise does not line up with `w`, so its effects mostly cancel ✅[^2]. Lab: random ±0.4 corners cost 0.9 points, the attack 82 points ✅[^7].

### FGSM and PGD
1. **FGSM:** `x_adv = x + ε·sign(∇ₓ J(θ, x, y))`, one gradient computed by back-propagation ✅[^2]. Goodfellow et al. report 99.9 % error for a shallow softmax classifier on MNIST at `ε = 0.25` ✅[^2].
2. **PGD:** repeat `x ← Proj_{x₀+S}(x + α·sign(∇ₓ L))`, a signed gradient step followed by projection back into the allowed set `S` (for L∞, clip each coordinate to `[x₀ − ε, x₀ + ε]`) ✅[^3]. Madry et al. start from a random point in the ball and re-start from many points for evaluation ✅[^3], and argue that PGD is a "universal" first-order adversary: robustness to it should carry over to other first-order attacks ✅[^3].
3. **Reported numbers:** an MNIST model trained against `ε = 0.3` kept 89.3 % under 100-step PGD with 20 restarts; the CIFAR-10 model kept 45.8 % under 20-step PGD at `ε = 8` ✅[^3].

### Adversarial training and the trade-off
1. **Min–max objective:** minimize over `θ` the expected value of `max_{δ∈S} L(θ, x + δ, y)`: an inner attack, an outer training step ✅[^3]. Goodfellow et al.'s earlier version mixed clean and FGSM losses, `α·J(x) + (1 − α)·J(x + ε·sign(∇J))` with `α = 0.5` ✅[^2].
2. **Capacity:** robust classification needs a stronger classifier; Madry et al. found that robust training needs larger networks, and their smallest MNIST networks trained against PGD did not learn at all, always predicting one fixed class ✅[^3].
3. **Robustness vs accuracy:** Tsipras et al. argue there may be an inherent tension between robustness and standard generalization, with robust models learning different features ✅[^4]. Their construction: `x₁ = y` with probability `p`, else `−y`, plus `d` weak features `x_i ~ N(ηy, 1)`; averaging the weak features gives more than 99 % accuracy when `η ≥ 3/√d`, and an L∞ adversary with `ε ≥ 2η` shifts every weak feature to look like the other class ✅[^4]. Their theorem: any classifier with standard accuracy `≥ 1 − δ` has robust accuracy `≤ p/(1 − p)·δ` against that adversary ✅[^4]. With little data, robust training can instead act as data augmentation and raise clean accuracy, clearly on MNIST and much less on CIFAR-10 and Restricted ImageNet ✅[^4]. The lab uses this construction with `p = 0.9`, `η = 0.2`, `d = 50`; that `η` is below `3/√50 ≈ 0.42`, so the 99 % bound does not apply to it.

### Pitfall: gradient masking and obfuscated gradients
1. **Definition:** obfuscated gradients are a kind of gradient masking that makes gradient-based attacks fail without making the model robust ✅[^5]. Three types: shattered (non-differentiable or numerically broken), stochastic (test-time randomness), and vanishing or exploding gradients ✅[^5].
2. **Attacks that see through it:** BPDA (backward pass differentiable approximation) replaces a non-differentiable step with a differentiable approximation in the backward pass; EOT (expectation over transformation) averages gradients over the randomness; reparameterization fixes vanishing and exploding gradients ✅[^5].
3. **Scale of the problem:** 7 of the 9 non-certified white-box defenses accepted at ICLR (International Conference on Learning Representations) 2018 relied on obfuscated gradients; Athalye et al. circumvented 6 completely and 1 partially ✅[^5].
4. **Warning signs:** one-step attacks beat iterative ones; black-box beats white-box; unbounded attacks do not reach 100 % success; random sampling finds adversarial examples the gradient attack missed; a bigger budget does not raise success ✅[^5]. An accuracy-versus-ε curve runs many of these sanity checks at once, and an unbounded attack should eventually reach 100 % success ✅[^8]; an evaluation needs an adaptive attack designed against the specific defense ✅[^8].

### Certified defenses: randomized smoothing
1. **Smoothed classifier:** `g(x)` returns the class the base classifier `f` most likely outputs when `x` gets isotropic Gaussian noise `N(0, σ²I)` ✅[^6].
2. **Certificate:** `g` is constant within L2 radius `R = σ/2·(Φ⁻¹(p_A) − Φ⁻¹(p_B))`, where `p_A`, `p_B` are the top two class probabilities under noise and `Φ⁻¹` is the inverse standard normal CDF (cumulative distribution function) ✅[^6]. Example: `σ = 0.5`, `p_A = 0.9`, `p_B = 0.1` gives `R = 0.25 × (1.28 + 1.28) ≈ 0.64`.
3. **In practice:** Monte Carlo estimates with a chosen failure probability, abstaining when the evidence is weak ✅[^6]; the only certified defense shown feasible on ImageNet at the time, 49 % certified top-1 accuracy within L2 radius 0.5 ✅[^6]. Larger `σ` can certify larger radii but certifies small radii, and clean inputs, at lower accuracy, and the guarantee is for L2 only ✅[^6].

## Worked example
Synthetic data in the robustness-vs-accuracy construction: 6,000 points, label `y = ±1`, feature `x₀ = y` with probability 0.9, and 50 weak features `N(0.2·y, 1)`; 5,000 for training, 1,000 for test. An MLP (51 → 128 → 128 → 2, ReLU), Adam, learning rate 1e-3, batch 100, 30 epochs. Attacks under an L∞ budget; adversarial training replaces each batch with 7-step PGD examples at the training budget. Core lines:

```python
delta = (torch.rand_like(x) * 2 - 1) * eps                      # random start in the ball
for _ in range(steps):
    delta.requires_grad_(True)
    loss_fn(m(x + delta), y).backward()
    delta = (delta + alpha * delta.grad.sign()).clamp(-eps, eps).detach()   # ascend, project
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-25, PyTorch 2.15.0, two runs identical; the Mental model artifact is four rows of the first table ✅[^7]:

```text
== standard training: test accuracy under attack (L-inf budget eps) ==
eps    clean/none  random +-eps  FGSM    PGD-20
0.00   0.953       0.953         0.953   0.953
0.05   0.953       0.947         0.908   0.908
0.10   0.953       0.949         0.844   0.844
0.20   0.953       0.946         0.666   0.654
0.30   0.953       0.937         0.391   0.349
0.40   0.953       0.944         0.177   0.130
one PGD perturbation at eps=0.2: max |delta| = 0.200, L2 norm = 1.414
== PGD adversarial training: sweep the training budget (train eps 0 = the standard model) ==
train eps  clean   PGD eps=0.1  PGD eps=0.2  PGD eps=0.4  weight on x0 / mean |weight| on x1..x50 (input layer)
  0.00     0.953   0.844        0.654        0.126        1.2
  0.10     0.946   0.842        0.655        0.143        1.1
  0.20     0.913   0.900        0.866        0.601        2.9
  0.40     0.899   0.899        0.899        0.899        8.3
train eps 0.4 model, PGD eps=0.4 with 100 steps, worst of 5 random restarts: 0.899
```

<details><summary>Full script (prints the output above)</summary>

```python
# FGSM and PGD attacks under an L-infinity budget, random noise of the same size, and PGD
# adversarial training (Madry et al.) on a small MLP with synthetic data (PyTorch, CPU).
import torch
from torch import nn
torch.manual_seed(0)

# Tsipras et al.'s construction: one robust feature (x0 = label sign, right 90% of the time) and
# 50 "non-robust" features, each only weakly shifted by the label (mean +-0.2, std 1).
N, D, ETA = 6000, 51, 0.2
s_ = torch.randint(0, 2, (N,)) * 2 - 1                      # label as +-1
x0 = s_ * torch.where(torch.rand(N) < 0.9, 1, -1)
X = torch.cat([x0[:, None].float(), ETA * s_[:, None].float() + torch.randn(N, D - 1)], 1)
y = (s_ > 0).long()
Xtr, ytr, Xte, yte = X[:5000], y[:5000], X[5000:], y[5000:]
loss_fn = nn.CrossEntropyLoss()

def mlp():
    return nn.Sequential(nn.Linear(D, 128), nn.ReLU(), nn.Linear(128, 128), nn.ReLU(), nn.Linear(128, 2))

def fgsm(m, x, y, eps):                         # one signed-gradient step of size eps
    x = x.clone().requires_grad_(True)
    loss_fn(m(x), y).backward()
    return (x + eps * x.grad.sign()).detach()

def pgd(m, x, y, eps, steps=20, alpha=None, rand_start=True):   # projected gradient ascent on the loss
    alpha = alpha or 2.5 * eps / steps
    delta = (torch.rand_like(x) * 2 - 1) * eps if rand_start else torch.zeros_like(x)
    for _ in range(steps):
        delta.requires_grad_(True)
        loss_fn(m(x + delta), y).backward()
        delta = (delta + alpha * delta.grad.sign()).clamp(-eps, eps).detach()   # step, then project onto the L-inf ball
    return (x + delta).detach()

def acc(m, x, y):
    with torch.no_grad():
        return (m(x).argmax(1) == y).float().mean().item()

def train(adv_eps=0.0, epochs=30):
    torch.manual_seed(1)
    m = mlp(); opt = torch.optim.Adam(m.parameters(), lr=1e-3)
    for _ in range(epochs):
        for idx in torch.randperm(5000).split(100):
            xb, yb = Xtr[idx], ytr[idx]
            if adv_eps > 0:
                xb = pgd(m, xb, yb, adv_eps, steps=7)   # inner maximization: train on the worst case found
            opt.zero_grad(); loss_fn(m(xb), yb).backward(); opt.step()
    return m

std = train()
print("== standard training: test accuracy under attack (L-inf budget eps) ==")
print("eps    clean/none  random +-eps  FGSM    PGD-20")
for eps in (0.0, 0.05, 0.1, 0.2, 0.3, 0.4):
    rnd = Xte + eps * torch.randint(0, 2, Xte.shape).float().mul(2).sub(1)   # random corner of the same box
    print(f"{eps:4.2f}   {acc(std, Xte, yte):.3f}       {acc(std, rnd, yte):.3f}         "
          f"{acc(std, fgsm(std, Xte, yte, eps), yte):.3f}   {acc(std, pgd(std, Xte, yte, eps), yte):.3f}")

xa = Xte[:1]; d = pgd(std, xa, yte[:1], 0.2) - xa
print(f"one PGD perturbation at eps=0.2: max |delta| = {d.abs().max().item():.3f}, L2 norm = {d.norm().item():.3f}")

print("== PGD adversarial training: sweep the training budget (train eps 0 = the standard model) ==")
print("train eps  clean   PGD eps=0.1  PGD eps=0.2  PGD eps=0.4  weight on x0 / mean |weight| on x1..x50 (input layer)")
models = {0.0: std}
for te in (0.0, 0.1, 0.2, 0.4):
    m = models[te] if te in models else train(adv_eps=te)
    models[te] = m
    w = m[0].weight.detach().abs().sum(0)
    print(f"  {te:4.2f}     {acc(m, Xte, yte):.3f}   {acc(m, pgd(m, Xte, yte, 0.1), yte):.3f}        "
          f"{acc(m, pgd(m, Xte, yte, 0.2), yte):.3f}        {acc(m, pgd(m, Xte, yte, 0.4), yte):.3f}        "
          f"{(w[0] / w[1:].mean()).item():.1f}")
rob = models[0.4]
print(f"train eps 0.4 model, PGD eps=0.4 with 100 steps, worst of 5 random restarts: "
      f"{min(acc(rob, pgd(rob, Xte, yte, 0.4, steps=100), yte) for _ in range(5)):.3f}")
```

</details>

Reading it, line by line:
- **Accuracy vs ε:** accuracy falls steadily as the budget grows, from 95.3 % to 13.0 % under PGD at `ε = 0.4 = 2η`, the budget at which every weak feature can be pushed to the wrong class's mean.
- **FGSM ≈ PGD at small ε:** up to `ε = 0.1` one step is as strong as twenty: the model is nearly linear in a ball that small, Goodfellow et al.'s explanation. At larger ε, PGD is stronger (13.0 % against 17.7 %).
- **Random noise:** the same box filled with random ±ε signs costs at most 1.6 points.
- **The perturbation:** every coordinate is at most 0.2, yet its L2 length is 1.41, close to `0.2·√51 = 1.43`: a small L∞ budget is a large L2 budget in 51 dimensions.
- **Adversarial training:** training at `ε = 0.4` gives 89.9 % against PGD at 0.4 (12.6 % for the standard model) but clean accuracy falls from 95.3 % to 89.9 %. That is the accuracy of the robust feature `x₀` alone (`p = 0.9`); the input-layer weight on `x₀` rises from 1.2 to 8.3 times the average weak-feature weight. The model gave up the weak features, as in Tsipras et al.'s argument ✅[^4].
- **Training budget below the threat:** training at `ε = 0.1` changed almost nothing in this run, and `ε = 0.2` buys partial robustness; the budget used in training has to match the one you evaluate.
- **Stronger evaluation:** 100-step PGD with 5 random restarts gives the same 89.9 %, so the robustness is not an artefact of a weak attack.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Evaluating with random noise only | Looks robust (lab 94.4 % at ε = 0.4) | Noise does not align with the gradient ✅[^2]; lab ✅[^7] |
| FGSM stronger than PGD | Suspect gradient masking | One-step beating iterative is a warning sign ✅[^5] |
| Accuracy stays above 0 at huge ε | Evaluation or defense broken | Unbounded attacks must reach 100 % ✅[^5] ✅[^8] |
| Non-differentiable preprocessing in the defense | Gradient attack fails, model still vulnerable | Shattered gradients; BPDA ✅[^5] |
| Randomized defense | Single-sample gradients mislead | Stochastic gradients; EOT ✅[^5] |
| Black-box only evaluation | Overstates robustness | White-box implies black-box, not the reverse ✅[^8] |
| Same ε number, different norm or scale | Different threat (8/255 on [0, 1] pixels is not 8 on [0, 1]) | Budget is part of the threat model ✅[^8] |
| Small L∞ in high dimension | Large L2 length (lab 1.41 for ε = 0.2, 51 features) | `‖δ‖₂ ≤ ε·√n`; lab ✅[^7] |
| Adversarial training with little data | Clean accuracy can rise, clearly on MNIST | Acts as data augmentation ✅[^4] |
| Small model, PGD adversarial training | May not learn at all (one fixed class), so clean and robust accuracy both stay low | Robustness needs capacity ✅[^3] |
| Randomized smoothing with large σ | Bigger certifiable radius, lower accuracy at small radii and on clean inputs | σ trade-off; L2 only ✅[^6] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| FGSM evaluation | One gradient per input ✅[^2] | Underestimates the threat at larger ε (lab 17.7 % vs 13.0 %) ✅[^7] |
| PGD with restarts | Strong first-order attack ✅[^3] | Steps × restarts gradient calls |
| PGD adversarial training | Empirical robustness at the trained ε ✅[^3]; lab 12.6 % → 89.9 % ✅[^7] | Inner attack multiplies training cost; clean accuracy can fall ✅[^4]; needs capacity ✅[^3] |
| FGSM-mix adversarial training | Cheap ✅[^2] | Weaker inner attack than PGD ✅[^3] |
| Randomized smoothing | Provable L2 radius; scales to ImageNet ✅[^6] | Many noisy forward passes; abstains; L2 only ✅[^6] |

## Takeaways
- Report robustness as an accuracy-versus-ε curve under a stated threat model (norm, ε, input scale, white-box), with PGD and random restarts, not FGSM alone. [rule-candidate]
- Treat "FGSM beats PGD" or "accuracy never reaches 0 at large ε" as a bug in the evaluation until proven otherwise. [rule-candidate]
- Train adversarially at the budget you will be attacked with, and expect to pay clean accuracy for it when the data has predictive but fragile features.
- A defense that only breaks gradients is not a defense; attack it adaptively (BPDA, EOT) before trusting it.

## Verification status
- Verified: 66 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [Intriguing properties of neural networks](https://arxiv.org/abs/1312.6199) — Szegedy, Zaremba, Sutskever, Bruna, Erhan, Goodfellow, Fergus, 2013 (full text read on ar5iv). Backs: imperceptible perturbations found by maximizing error with box-constrained L-BFGS, weaker transfer to a model trained on a disjoint half of MNIST. [^1]
- [Explaining and Harnessing Adversarial Examples](https://ar5iv.labs.arxiv.org/html/1412.6572) — Goodfellow, Shlens, Szegedy, 2014 (ar5iv HTML of arXiv:1412.6572). Backs: linearity explanation, FGSM formula, MNIST 99.9 %, noise inefficiency, transfer, mixed adversarial objective. [^2]
- [Towards Deep Learning Models Resistant to Adversarial Attacks](https://ar5iv.labs.arxiv.org/html/1706.06083) — Mądry, Makelov, Schmidt, Tsipras, Vladu, 2017 (ar5iv HTML). Backs: min–max formulation, PGD update, random starts and restarts, universal first-order adversary, MNIST and CIFAR-10 numbers, capacity and fixed-class collapse of small networks. [^3]
- [Robustness May Be at Odds with Accuracy](https://ar5iv.labs.arxiv.org/html/1805.12152) — Tsipras, Santurkar, Engstrom, Turner, Madry, 2018 (ar5iv HTML). Backs: inherent tension, the `p`/`η` construction, `ε ≥ 2η`, the `p/(1 − p)·δ` theorem, low-data regime mainly on MNIST. [^4]
- [Obfuscated Gradients Give a False Sense of Security](https://ar5iv.labs.arxiv.org/html/1802.00420) — Athalye, Carlini, Wagner, 2018 (ar5iv HTML). Backs: obfuscated-gradient types, BPDA, EOT, reparameterization, 7 of 9 defenses, warning signs. [^5]
- [Certified Adversarial Robustness via Randomized Smoothing](https://ar5iv.labs.arxiv.org/html/1902.02918) — Cohen, Rosenfeld, Kolter, 2019 (ar5iv HTML). Backs: smoothed classifier, certified radius, Monte Carlo and abstention, ImageNet 49 % at 0.5, σ trade-off at small and large radii, L2 only. [^6]
- `machine-learning/lab-setup.md` — the lab where the FGSM, PGD and adversarial-training script ran on 2026-11-25. [^7]
- [On Evaluating Adversarial Robustness](https://ar5iv.labs.arxiv.org/html/1902.06705) — Carlini, Athalye, Papernot, Brendel, Rauber, Tsipras, Goodfellow, Madry, Kurakin, 2019 (ar5iv HTML). Backs: threat-model parts, Lp budgets and 8/255, white- vs black-box, Kerckhoffs, adaptive attacks, accuracy-vs-ε curves and unbounded attacks reaching 100 %. [^8]

## Related
- `machine-learning/deep-learning/interpretability-and-attribution.md` — input gradients used to explain a prediction.
- `machine-learning/deep-learning/loss-landscapes-and-generalization.md` — sharpness in weight space, the parameter-space cousin of input-space sensitivity.
- `machine-learning/foundations/generalization-and-overfitting.md` — average-case generalization, which robustness does not imply.
- `machine-learning/deep-learning/neural-networks-and-backpropagation.md` — computing `∇ₓ` of the loss.
