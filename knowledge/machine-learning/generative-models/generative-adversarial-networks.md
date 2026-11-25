---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/generative-models
status: verified
applies-to: ["any"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [machine-learning, generative-models, gan, generative-adversarial-network, discriminator, minimax, non-saturating-loss, mode-collapse, wasserstein-gan, wgan]
---

# Generative adversarial networks: the minimax game, saturation and mode collapse

## Summary
**TL;DR:** A GAN (generative adversarial network) trains two networks against each other: a generator `G` turns random noise into samples, and a discriminator `D` estimates the probability that a sample is real rather than generated. `D` is a binary classifier; `G` is trained to make `D` wrong. At the game's ideal end point the generated distribution equals the data distribution and `D` outputs ½ everywhere. In practice the generator uses the "non-saturating" loss `−log D(G(z))`, because the original `log(1 − D(G(z)))` gives almost no gradient while `D` easily rejects fakes; training can oscillate instead of converging, and the generator can collapse many noise values onto a few outputs (mode collapse). WGAN (Wasserstein GAN) replaces the classifier with a "critic" that estimates an optimal-transport distance, which keeps giving useful gradients.
**Use this when:** writing or debugging a GAN training loop, choosing a generator loss, seeing generated samples with little variety, or reading about WGAN's critic and weight clipping.
**Not this doc:** why a GAN has no likelihood and how it compares with other families → `machine-learning/generative-models/generative-model-families.md`; the cross-entropy loss itself → `machine-learning/foundations/loss-functions-and-maximum-likelihood.md`; the Adam optimizer → `machine-learning/deep-learning/optimizers-and-learning-rate-schedules.md`.

## Problem
A GAN's loss curve does not behave like an ordinary training loss. The two players' costs pull against each other, and simultaneous gradient steps are not guaranteed to reach an equilibrium ✅[^3]; how much this non-convergence affects GANs is not known ✅[^3]. Implemented literally from the paper's value function, the generator barely learns at the start ✅[^1]; trained too long against a fixed discriminator, it collapses to a few outputs ✅[^1]. Stabilizing GAN learning is described as an open problem, with good results depending on carefully selected architectures and hyperparameters ✅[^3].

## Mental model
**Analogy:** a forger and an art inspector. The inspector is shown a mix of real paintings and forgeries and learns to tell them apart; the forger never sees a real painting, only the inspector's verdict on each forgery, and changes technique to fool her. If the forger always paints the one picture the current inspector likes best, he wins this round but has learned nothing about variety: that is mode collapse.

**Artifact:** why the original generator loss stalls, lab run (`machine-learning/lab-setup.md`), 2026-11-24, PyTorch 2.15.0 ✅[^5]. After the discriminator trained alone for 300 steps against an untrained generator, it rejected fakes with `D(G(z)) ≈ 0.01`; the gradient each generator loss sends back to the generator's parameters:

```text
D(G(z)) = 0.0096 | saturating log(1-D)    |grad wrt G params| = 0.02519
D(G(z)) = 0.0096 | non-saturating -log D  |grad wrt G params| = 1.79735
```

Same discriminator, same samples: the non-saturating loss sent a gradient 71 times larger (`1.79735 / 0.02519 = 71.4`) ✅[^5]. With `D = sigmoid(a)` for a logit `a`, the slope of `log(1 − sigmoid(a))` is `−sigmoid(a)` (here about −0.01) while the slope of `−log sigmoid(a)` is `−(1 − sigmoid(a))` (about −0.99).

## How it works
**2 actors:**
- **Generator `G`** — its job: turn noise `z ~ p_z` (for example a standard normal) into a sample `x' = G(z)`, via a neural network ✅[^2].
- **Discriminator `D`** — its job: output the probability that its input is real data, via a network ending in a sigmoid and trained with cross-entropy as a binary classifier (label 1 = real, 0 = generated) ✅[^2].

```
z ~ N(0, I) ──► G ──► x' ──┐
                           ├──► D ──► D(·) ∈ (0, 1) ──► D's loss: −log D(x) − log(1 − D(x'))
real x ────────────────────┘                     └────► G's loss: −log D(x')   (non-saturating)
G only ever sees the data through D's gradient.
```

1. **The game.** `D` and `G` play `min_G max_D V(D, G) = E_x[log D(x)] + E_z[log(1 − D(G(z)))]` ✅[^1]. `E_x` averages over real data, `E_z` over noise. The idea is a two-sample test (are these two sets from the same distribution?) used constructively, as a training signal for the generator ✅[^2].
2. **The best discriminator.** For a fixed `G` with sample density `p_g`, the optimal discriminator is `D*(x) = p_data(x) / (p_data(x) + p_g(x))` ✅[^1]. Worked number: where `p_data(x) = 0.3` and `p_g(x) = 0.1`, `D*(x) = 0.3 / 0.4 = 0.75`.
3. **What `G` minimizes.** Plugging in `D*`, the generator's cost becomes `C(G) = −log 4 + 2·JSD(p_data ‖ p_g)` (JSD = Jensen–Shannon divergence, a symmetric distance between distributions that is zero only when they are equal), so the global minimum `−log 4 ≈ −1.386` is reached only at `p_g = p_data`, where `D* = ½` ✅[^1].
4. **Alternating updates.** Each iteration takes `k` gradient steps on `D` and one on `G`; `k` is a hyperparameter and the original experiments used `k = 1` ✅[^1].
5. **The non-saturating generator loss.** Early in training `D` rejects generated samples with high confidence, `log(1 − D(G(z)))` saturates, and `G` gets little gradient; maximizing `log D(G(z))` instead has the same fixed point but much stronger gradients early on ✅[^1]. In code this is the same cross-entropy loss with the generated batch labelled 1 ✅[^2]. It is a heuristic: the game is then neither zero-sum nor equivalent to maximum likelihood, and it was motivated only by keeping the derivative with respect to `D`'s logits large when `D` confidently rejects every sample ✅[^3].
6. **Why it can fail to converge.** Equilibria of a minimax game are saddle points, not minima ✅[^3]. In the toy game `v(a, b) = a·b`, where one player minimizes `ab` and the other `−ab`, small simultaneous gradient steps orbit the equilibrium at the origin forever instead of reaching it ✅[^3].
7. **Mode collapse.** If `G` is trained too much without updating `D`, it collapses too many values of `z` to the same `x` to model the data's diversity ("the Helvetica scenario") ✅[^1]. The reason: for a fixed discriminator, the best generator puts all its mass on the points `D` scores highest ✅[^4].

**Wasserstein GAN.** The EM (Earth Mover) or Wasserstein-1 distance is the cost of the cheapest plan for moving probability "mass" to turn one distribution into the other ✅[^4]. It keeps changing smoothly where JSD is flat: for two parallel line segments a distance `θ` apart, the Wasserstein distance is `W = |θ|` while `JSD = log 2` for every `θ ≠ 0` ✅[^4], so at `θ = 0.5` or `θ = 0.1` JSD is 0.693 either way and gives no direction to move. WGAN uses the dual form `W = sup over 1-Lipschitz f of E_real[f(x)] − E_gen[f(x)]` (a function is 1-Lipschitz if its output changes at most as fast as its input) ✅[^4]. A network `f_w`, the critic, approximates the best `f`; clamping its weights to a box such as `[−0.01, 0.01]` after each update keeps it Lipschitz up to a constant ✅[^4]. The authors call clipping "a clearly terrible way to enforce a Lipschitz constraint" ✅[^4], and their default settings were learning rate 0.00005, clip `c = 0.01`, batch 64 and 5 critic steps per generator step, with RMSProp (root mean square propagation) ✅[^4]. Because the critic cannot saturate, it can be trained to optimality, which the authors argue makes mode collapse impossible, and they report a loss that correlates with sample quality and more stable training ✅[^4].

## Worked example
The same 1-D setup as the artifact: real data is an even mix of `N(−2, 0.3²)` and `N(+2, 0.3²)`; `G` and `D` are 2-hidden-layer MLPs (multilayer perceptrons) of width 32, trained with Adam (learning rate 0.001, `β₁ = 0.5`), batch 256, `k = 1`, non-saturating loss. Phase 2 trains normally for 3,000 steps; phase 3 then freezes `D` and trains `G` alone for 2,000 steps. Each report draws 5,000 samples and gives, per side of 0, the median and the IQR (interquartile range: the width of the middle 50 % of samples). Lab run (`machine-learning/lab-setup.md`), 2026-11-24, PyTorch 2.15.0, two runs identical ✅[^5]:

```text
real data (exact)            share x<0 = 0.50  left: median -2.00 IQR 0.405  right: median +2.00 IQR 0.405
alternating, step 1000       share x<0 = 0.64  left: median -2.00 IQR 0.448  right: median +2.00 IQR 0.187
alternating, step 3000       share x<0 = 0.51  left: median -2.03 IQR 0.315  right: median +1.79 IQR 0.183
frozen D's highest score: left of 0 at x = -3.06, right of 0 at x = +2.88
G only, D frozen, step 200   share x<0 = 0.51  left: median -2.96 IQR 0.121  right: median +2.88 IQR 0.043
G only, D frozen, step 2000  share x<0 = 0.54  left: median -3.07 IQR 0.096  right: median +2.70 IQR 0.181
```

<details><summary>Full script (prints the output above and the artifact's two lines)</summary>

```python
# A tiny GAN on a 1-D two-mode Gaussian mixture: saturation of log(1 - D), normal training, and mode collapse
# when the generator is trained against a frozen discriminator.
import torch
import torch.nn as nn
import torch.nn.functional as F

torch.set_num_threads(1); torch.manual_seed(0)
EVAL = torch.Generator().manual_seed(123)            # separate noise for evaluation, so it never shifts training
def real_batch(n):                                   # p_data: 0.5*N(-2, 0.3^2) + 0.5*N(+2, 0.3^2)
    return (torch.randint(0, 2, (n, 1)) * 4.0 - 2.0) + 0.3 * torch.randn(n, 1)
def mlp():
    return nn.Sequential(nn.Linear(1, 32), nn.ReLU(), nn.Linear(32, 32), nn.ReLU(), nn.Linear(32, 1))
G, D = mlp(), mlp()                                  # D outputs a logit a; D(x) = sigmoid(a)
oG = torch.optim.Adam(G.parameters(), lr=1e-3, betas=(0.5, 0.999))
oD = torch.optim.Adam(D.parameters(), lr=1e-3, betas=(0.5, 0.999))

def d_step():                                        # D maximizes log D(x) + log(1 - D(G(z)))
    loss = F.softplus(-D(real_batch(256))).mean() + F.softplus(D(G(torch.randn(256, 1)).detach())).mean()
    oD.zero_grad(); loss.backward(); oD.step()
def g_step():                                        # non-saturating: G minimizes -log D(G(z)) = softplus(-a)
    loss = F.softplus(-D(G(torch.randn(256, 1)))).mean()
    oG.zero_grad(); loss.backward(); oG.step()
def report(tag):
    with torch.no_grad():
        s = G(torch.randn(5000, 1, generator=EVAL)).squeeze()
    l, r = s[s < 0], s[s >= 0]
    iqr = lambda v: (torch.quantile(v, 0.75) - torch.quantile(v, 0.25)).item()     # interquartile range
    print(f"{tag:28s} share x<0 = {len(l) / len(s):.2f}  left: median {l.median():+.2f} IQR {iqr(l):.3f}"
          f"  right: median {r.median():+.2f} IQR {iqr(r):.3f}")

# 1. Saturation: train D alone against the untrained G, then compare the generator's gradients.
for _ in range(300):
    d_step()
a = D(G(torch.randn(1000, 1)))
for name, loss in [("saturating log(1-D)", -F.softplus(a).mean()), ("non-saturating -log D", F.softplus(-a).mean())]:
    gnorm = torch.cat([g.flatten() for g in torch.autograd.grad(loss, list(G.parameters()), retain_graph=True)]).norm()
    print(f"D(G(z)) = {torch.sigmoid(a).mean():.4f} | {name:22s} |grad wrt G params| = {gnorm:.5f}")

# 2. Normal alternating training (k = 1 discriminator step per generator step).
print(f"{'real data (exact)':28s} share x<0 = 0.50  left: median -2.00 IQR 0.405  right: median +2.00 IQR 0.405")
for step in range(1, 3001):
    d_step(); g_step()
    if step in (1000, 3000):
        report(f"alternating, step {step}")

# 3. Freeze D and keep training G: G moves its mass to where the frozen D scores highest.
grid = torch.linspace(-4, 4, 801)[:, None]
with torch.no_grad():
    logit = D(grid).squeeze()
print(f"frozen D's highest score: left of 0 at x = {grid[:400][logit[:400].argmax()].item():+.2f}, "
      f"right of 0 at x = {grid[400:][logit[400:].argmax()].item():+.2f}")
for step in range(1, 2001):
    g_step()
    if step in (200, 2000):
        report(f"G only, D frozen, step {step}")
```
</details>

Reading it:
- **Row "real data (exact)":** the target: half the mass on each side, medians at ±2, IQR `1.349 × 0.3 = 0.405` for each Gaussian.
- **Alternating training:** by step 3,000 the generator covers both modes in the right proportion (0.51), with medians −2.03 and +1.79 and IQRs somewhat narrower than the data's (0.315 and 0.183). This run did not collapse.
- **Frozen discriminator:** within 200 generator-only steps the samples leave the data's modes and pile up where the frozen `D` scores highest: medians −2.96 and +2.88 against `D`'s peaks at −3.06 and +2.88, while the IQRs shrink to 0.121 and 0.043, a tenth of the data's spread on the right. Many `z` values now map to nearly the same `x`, the Helvetica scenario of step 7, and the samples are worse than before, although every step was a gradient step on `G`'s own loss against this `D`.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Generator loss `log(1 − D(G(z)))` with a confident `D` | Generator gradients near zero | The loss saturates early in training ✅[^1]; lab: gradient 71× smaller than the non-saturating loss ✅[^5] |
| Two sources explain the switch differently | The Deep Learning book and the original paper: the old loss stalls when `D` confidently rejects fakes (`D(G(z)) ≈ 0`); d2l motivates it with the case `D(G(z)) ≈ 1` | Follow the originator ✅[^1] ✅[^3]; d2l's wording ✅[^2]; the lab gradient matches the originator's case ✅[^5] |
| `G` trained many steps without updating `D` | Many `z` collapse to the same `x`; diversity lost | Helvetica scenario ✅[^1]; best `G` for a fixed `D` sits on `D`'s highest points ✅[^4]; lab IQR 0.405 → 0.043 ✅[^5] |
| Loss values oscillate instead of decreasing | Can be normal for a game | Simultaneous gradient steps can orbit a saddle point ✅[^3] |
| Discriminator trained to optimality (standard GAN) | Its gradients vanish | JSD is locally saturated; shown for two Gaussians ✅[^4] |
| WGAN critic with momentum optimizers (Adam) or high learning rates | Training became unstable at times in the authors' experiments | The critic's loss is non-stationary; they used RMSProp ✅[^4] |
| WGAN clip value too large or too small | Slow critic training, or vanishing gradients in deep critics | Stated limits of weight clipping ✅[^4] |
| Comparing WGAN losses across critic architectures | Not comparable | The scale factor depends on the critic's architecture ✅[^4] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Original minimax loss | Clean theory: minimum only at `p_g = p_data` ✅[^1] | Saturates early in training ✅[^1] |
| Non-saturating generator loss | Much stronger early gradients, same fixed point ✅[^1] | Heuristic: neither zero-sum nor maximum likelihood ✅[^3] |
| More `D` steps per `G` step (`k > 1`) | `D` stays near optimal for the current `G` ✅[^1] | Costlier iterations; a standard GAN's `D` near optimal gives vanishing gradients ✅[^4] |
| WGAN critic + weight clipping | Gradients that do not saturate; loss tracks sample quality ✅[^4] | Clipping is a crude Lipschitz constraint ✅[^4]; small learning rate, 5 critic steps per `G` step ✅[^4] |

## Takeaways
- Use the non-saturating generator loss (generated batch labelled "real" in the cross-entropy), not the literal `log(1 − D)`. [rule-candidate]
- Judge a GAN by its samples (and their diversity), not by its loss curve, which is the state of a game.
- Keep `D` and `G` updates interleaved; never train `G` for long against a frozen `D`. [rule-candidate]
- Monitor sample spread per mode or class: a falling spread with a falling generator loss is mode collapse.

## Verification status
- Verified: 52 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- [Generative Adversarial Nets](https://arxiv.org/html/1406.2661v1) — Goodfellow et al., 2014. Backs: the minimax value function, optimal discriminator, `−log 4 + 2·JSD`, `k` steps with `k = 1`, saturation and the `log D(G(z))` fix, the Helvetica scenario. [^1]
- [Generative Adversarial Networks (Dive into Deep Learning, 20.1)](https://d2l.ai/chapter_generative-adversarial-networks/gan.html) — Dive into Deep Learning (d2l.ai), living. Backs: two-sample-test idea, generator and discriminator roles, sigmoid binary classifier with cross-entropy, generator loss as label 1, d2l's motivation for the switch. [^2]
- [Deep Learning, chapter 20: Deep Generative Models](https://www.deeplearningbook.org/contents/generative_models.html) — Goodfellow, Bengio, Courville, 2016. Backs: non-convergence, the `v(a, b) = ab` orbit, saddle-point equilibria, the heuristic non-saturating game, stabilization as an open problem. [^3]
- [Wasserstein GAN](https://arxiv.org/html/1701.07875v3) — Arjovsky, Chintala, Bottou, 2017. Backs: EM distance as mass transport, parallel-lines example, dual form over 1-Lipschitz functions, critic and weight clipping, default hyperparameters and RMSProp, saturating discriminator vs non-saturating critic, mode collapse from a fixed discriminator, claimed benefits and limits. [^4]
- `machine-learning/lab-setup.md` — the lab where the saturating vs non-saturating gradients and the 1-D GAN with a frozen discriminator ran on 2026-11-24. [^5]

## Related
- `machine-learning/generative-models/generative-model-families.md` — GANs as the implicit-density family.
- `machine-learning/generative-models/diffusion-models.md` — high sample quality without adversarial training.
- `machine-learning/foundations/loss-functions-and-maximum-likelihood.md` — the cross-entropy loss both players use.
- `machine-learning/deep-learning/optimizers-and-learning-rate-schedules.md` — Adam, RMSProp and momentum, which matter for GAN stability.
- `machine-learning/supervised-learning/logistic-regression.md` — the discriminator is a sigmoid classifier.
