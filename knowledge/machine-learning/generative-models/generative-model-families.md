---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/generative-models
status: verified
applies-to: ["any"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [machine-learning, generative-models, density-estimation, likelihood, autoregressive, normalizing-flows, real-nvp, vae, gan, diffusion]
---

# Generative model families: explicit and implicit densities

## Summary
**TL;DR:** A generative model learns a probability distribution `p(x)` from examples so it can produce new examples like them. The five deep families split on one question: can the model tell you how likely a given `x` is? Autoregressive models and normalizing flows compute `log p(x)` exactly; VAEs (variational autoencoders) and diffusion models compute a lower bound on it; GANs (generative adversarial networks) define `p(x)` only implicitly, through a sampler, and give no number at all. That one property drives the rest of the trade-offs: training objective, sample sharpness and sampling speed.
**Use this when:** choosing a family for a task (sampling, scoring, compression, anomaly detection), reading a paper's claim of "exact log-likelihood", or learning how a normalizing flow works (this doc owns flows).
**Not this doc:** the VAE mechanism → `machine-learning/generative-models/variational-autoencoders.md`; GAN training → `machine-learning/generative-models/generative-adversarial-networks.md`; diffusion → `machine-learning/generative-models/diffusion-models.md`; autoregressive language models → `machine-learning/transformers/pretraining-and-scaling-laws.md`; a classical explicit density (mixtures of Gaussians) → `machine-learning/unsupervised-learning/gaussian-mixtures-and-em.md`.

## Problem
"Train a model that generates images" can mean five different machines with different guarantees. Some let you evaluate the probability function directly; others only let you draw samples from it ✅[^1]. Picking the wrong one shows up late: a GAN has no explicit representation of the distribution it learned ✅[^3], so it cannot score a test point for anomaly detection; an autoregressive model samples one dimension after another, which cannot be parallelized ✅[^2]; a DDPM (denoising diffusion probabilistic model) took around 20 hours to sample 50,000 32×32 images where a GAN took under a minute on the same GPU (graphics processing unit) ✅[^6]. And a good likelihood does not promise good-looking samples: DDPM has excellent sample quality but log-likelihoods that are not competitive with other likelihood-based models ✅[^5].

## Mental model
**Analogy:** a vending machine for new examples. Every family can dispense one. Only some can also answer the clerk's question "how likely is this item, which someone just handed me?": the autoregressive machine adds up a score for each part in order, the flow machine runs the item backwards to the simple shape it was made from and reads the score off exactly, the VAE and diffusion machines can only promise "at least this likely", and the GAN machine has no counter for that question at all.

**Artifact:** what each family defines and what it can compute for a given `x` (`z` = latent noise, `D` = number of data dimensions):

| Family | How `p(x)` is defined | `log p(x)` for a given `x` |
|---|---|---|
| Autoregressive | `p(x_1) · p(x_2 \| x_1) · … · p(x_D \| x_1..x_{D−1})` | exact: a sum of `D` terms |
| Normalizing flow | `p_Z(f(x)) · \|det ∂f(x)/∂x\|`, `f` invertible | exact: one pass through `f` |
| VAE | `∫ p(x \| z) p(z) dz` | a lower bound (the ELBO, evidence lower bound) |
| Diffusion | `∫ p(x_T) Π_t p(x_{t−1} \| x_t) dx_1..x_T` | a lower bound (variational bound) |
| GAN | `x = G(z)`, `z ~ p(z)` | none: no explicit `p_g(x)` |

Sources per row: autoregressive models use the chain rule of probability ✅[^1] ✅[^2]; flows use the change-of-variable formula for exact log-likelihood ✅[^2]; the VAE maximizes a lower bound on the marginal likelihood ✅[^4]; DDPM trains on a variational bound on the negative log-likelihood ✅[^5]; a GAN has no explicit representation of `p_g(x)` ✅[^3].

## How it works
**Explicit density** families write down `p(x)` and train by maximum likelihood, the classical way to learn a distribution: pick a parametric family of densities and maximize the average `log P_θ(x_i)` over the data ✅[^7]. **Implicit** families only describe a procedure that produces samples ✅[^1].

1. **Autoregressive.** Split `x` into dimensions in a fixed order and model each conditional `p(x_d | x_1 … x_{d−1})` with a neural network; the product of conditionals is the joint ✅[^1]. Log-likelihood and sampling are simple, but sampling is sequential and there is no latent representation ✅[^2], and the chosen order of dimensions can matter a lot for training ✅[^2]. By 2016 the family already included state-of-the-art image and language models ✅[^2]; for language models see `machine-learning/transformers/pretraining-and-scaling-laws.md`.
2. **Normalizing flow.** Choose an invertible function `f` from data `x` to a latent `z` with a simple prior `p_Z` (usually a standard Gaussian), and use the change-of-variable formula ✅[^2]:
   ```text
   log p_X(x) = log p_Z(f(x)) + log |det( ∂f(x)/∂x )|
   ```
   `∂f(x)/∂x` is the Jacobian, the `D × D` matrix of partial derivatives; `|det(·)|` measures how much `f` stretches volume around `x`. Worked numbers in 1-D: `f(x) = 2x`, `p_Z = N(0, 1)`, `x = 0.5`: `z = 1`, `log p_Z(1) = −0.5 − 0.5·log(2π) = −1.419`, `log |det| = log 2 = 0.693`, so `log p_X(0.5) = −0.726`, which is exactly the log-density of `N(0, 0.5²)` at 0.5. Sampling runs the inverse: draw `z ~ p_Z`, return `x = f⁻¹(z)` ✅[^2].
3. **How real NVP (real-valued non-volume preserving) flows keep this cheap.** A determinant of a general `D × D` matrix is expensive, but the determinant of a triangular matrix is the product of its diagonal ✅[^2]. An affine coupling layer copies the first part of the input and transforms the rest conditioned on it ✅[^2]:
   ```text
   y_1:d   = x_1:d
   y_d+1:D = x_d+1:D ⊙ exp(s(x_1:d)) + t(x_1:d)        s, t: any neural networks
   ```
   Its Jacobian is triangular, so `log |det| = Σ s(x_1:d)`, and it inverts exactly without inverting `s` or `t` (subtract `t`, multiply by `exp(−s)`); stacking layers that alternate which part is copied makes the whole map flexible ✅[^2]. The result is exact log-likelihood, exact sampling and exact inference of the latent ✅[^2].
4. **VAE.** A latent-variable model `p(x | z) p(z)` whose posterior is intractable ✅[^4], trained by maximizing a lower bound with a learned encoder; details in `machine-learning/generative-models/variational-autoencoders.md`. The approximation in inference limits what it learns ✅[^2], and its image samples tend to be somewhat blurry ✅[^1].
5. **GAN.** A generator `G(z)` is trained against a discriminator that tells real from generated samples, so no likelihood is ever computed ✅[^2]; details in `machine-learning/generative-models/generative-adversarial-networks.md`. GANs can represent very sharp, even degenerate distributions ✅[^3], but training is unstable and needs careful tuning, and metrics of sample diversity were intractable when real NVP was published ✅[^2].
6. **Diffusion.** A fixed process adds Gaussian noise over many steps and a network learns to reverse it; training uses a variational bound ✅[^5], and the original sampler takes `T = 1000` network evaluations ✅[^5]. Details in `machine-learning/generative-models/diffusion-models.md`.

## Worked example
A real NVP flow with 8 affine coupling layers (alternating which coordinate is copied; `s` squashed with `tanh` for stability), trained by maximum likelihood on standardized 2-D two-moons, then compared with two classical explicit densities. Core lines, the change-of-variable formula as code:

```python
def log_prob(x):                       # log p_X(x) = log p_Z(f(x)) + log|det df/dx|
    logdet = torch.zeros(len(x))
    for layer in layers:               # each layer: y_b = x_b * exp(s(x_a)) + t(x_a)
        x, ld = layer(x); logdet = logdet + ld          # ld = s(x_a): triangular Jacobian
    return -0.5 * (x ** 2).sum(1) - math.log(2 * math.pi) + logdet
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-24, PyTorch 2.15.0, scikit-learn 1.9.1, two runs identical ✅[^8]:

```text
test negative log-likelihood (nats/point): one Gaussian 2.728 | 8-component GMM 1.261 | real NVP flow 1.166
flow density summed over the grid [-4,4]^2 x cell area = 1.0000
invertibility: max |f(f^-1(z)) - z| = 1.70e-05; mean log p(sample) = -1.160
```

<details><summary>Full script (prints the output above)</summary>

```python
# An explicit-density model you can check: a small real NVP flow (affine coupling layers) on 2-D two-moons.
import math
import torch
import torch.nn as nn
from sklearn.datasets import make_moons
from sklearn.mixture import GaussianMixture

torch.manual_seed(0); torch.set_num_threads(1)
X, _ = make_moons(12_000, noise=0.05, random_state=0)
X = torch.tensor((X - X.mean(0)) / X.std(0), dtype=torch.float32)
Xtr, Xte = X[:10_000], X[10_000:]

class Coupling(nn.Module):                      # y_a = x_a ; y_b = x_b * exp(s(x_a)) + t(x_a)
    def __init__(self, a):
        super().__init__(); self.a, self.b = a, 1 - a
        self.st = nn.Sequential(nn.Linear(1, 64), nn.ReLU(), nn.Linear(64, 64), nn.ReLU(), nn.Linear(64, 2))
    def forward(self, x):                       # data -> latent, returns y and log|det Jacobian|
        s, t = self.st(x[:, [self.a]]).chunk(2, 1); s = torch.tanh(s)
        y = x.clone(); y[:, [self.b]] = x[:, [self.b]] * torch.exp(s) + t
        return y, s.squeeze(1)                  # the Jacobian is triangular: log det = s
    def inverse(self, y):
        s, t = self.st(y[:, [self.a]]).chunk(2, 1); s = torch.tanh(s)
        x = y.clone(); x[:, [self.b]] = (y[:, [self.b]] - t) * torch.exp(-s)
        return x

layers = nn.ModuleList([Coupling(i % 2) for i in range(8)])
def log_prob(x):                                # change of variables: log p_X(x) = log p_Z(f(x)) + log|det df/dx|
    logdet = torch.zeros(len(x))
    for layer in layers:
        x, ld = layer(x); logdet = logdet + ld
    return -0.5 * (x ** 2).sum(1) - math.log(2 * math.pi) + logdet

opt = torch.optim.Adam(layers.parameters(), lr=1e-3)
for step in range(4000):
    loss = -log_prob(Xtr[torch.randint(0, len(Xtr), (512,))]).mean()   # maximum likelihood
    opt.zero_grad(); loss.backward(); opt.step()

with torch.no_grad():
    gauss = torch.distributions.MultivariateNormal(Xtr.mean(0), torch.cov(Xtr.T))
    gmm = GaussianMixture(8, random_state=0).fit(Xtr.numpy())
    print(f"test negative log-likelihood (nats/point): one Gaussian {-gauss.log_prob(Xte).mean():.3f} | "
          f"8-component GMM {-gmm.score(Xte.numpy()):.3f} | real NVP flow {-log_prob(Xte).mean():.3f}")
    g = torch.linspace(-4, 4, 401); xx, yy = torch.meshgrid(g, g, indexing="ij")
    pts = torch.stack([xx.flatten(), yy.flatten()], 1)
    print(f"flow density summed over the grid [-4,4]^2 x cell area = {(log_prob(pts).exp().sum() * (g[1] - g[0]) ** 2):.4f}")
    z = torch.randn(5000, 2); x = z
    for layer in reversed(layers):
        x = layer.inverse(x)                    # sampling: z ~ N(0, I), then x = f^-1(z)
    y = x
    for layer in layers:
        y, _ = layer(y)
    print(f"invertibility: max |f(f^-1(z)) - z| = {(y - z).abs().max():.2e}; "
          f"mean log p(sample) = {log_prob(x).mean():.3f}")
```
</details>

Reading it line by line:
- **Line 1:** NLL (negative log-likelihood) on 2,000 held-out points, in nats (natural-log units). A single Gaussian cannot bend around the moons (2.728); a GMM (Gaussian mixture model) with 8 components does much better (1.261); the flow is best (1.166). All three are explicit densities, so this comparison is possible at all; a GAN trained on the same data could not enter it.
- **Line 2:** the flow's density, evaluated on a 401 × 401 grid and multiplied by the cell area, sums to 1.0000. The formula really produces a normalized probability density, with no normalizing constant to estimate.
- **Line 3:** running the inverse and then the forward pass returns the starting latent to within `1.7e-05` (float32 rounding over 8 layers), so sampling and scoring use the same exact map; generated samples score about as well as test data (−1.160 vs −1.166).

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Flow built from general invertible layers | Naive change-of-variable models are expensive and poorly conditioned | The Jacobian determinant of a general map is costly; flows restrict `f` to triangular-Jacobian layers ✅[^2] |
| A flow needs a latent of the same size as `x` | No compression: `z` has as many dimensions as the data | `f` must be a bijection between data and latent space ✅[^2] |
| A generator maps a low-dimensional `z` onto a higher-dimensional `x` | Its samples lie on a thin surface; if the data's support barely overlaps it, the KL (Kullback–Leibler) divergence is undefined or `+∞` | Low-dimensional supports rarely overlap enough ✅[^7]; for two parallel lines in the plane KL is `+∞` for any offset `θ ≠ 0` ✅[^7] |
| High likelihood, judged by eye | Not the same thing as sample quality | DDPM: excellent samples, non-competitive log-likelihood; most of its codelength describes imperceptible details ✅[^5] |
| Autoregressive model on images or audio | Slow generation | Sampling is sequential and cannot be parallelized ✅[^2] |
| Density check over a finite grid | Sums to slightly less than 1 if mass lies outside the grid | Lab: the `[−4, 4]²` grid caught all of it to 4 decimals for standardized data ✅[^8] |
| Diffusion sampling cost | Many network calls per sample | DDPM uses `T = 1000` steps ✅[^5]; DDIM (denoising diffusion implicit models) reduces this ✅[^6] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Autoregressive | Exact, simple log-likelihood and sampling ✅[^2] | Sequential sampling; no latent code; order of dimensions matters ✅[^2] |
| Normalizing flow (real NVP) | Exact log-likelihood, exact sampling, exact latent inference ✅[^2] | Architecture limited to invertible, triangular-Jacobian layers; latent as large as the data ✅[^2] |
| VAE | Learned latent code and a matched encoder ✅[^2] | Only a bound; approximate inference limits it ✅[^2]; image samples tend to be blurry ✅[^1] |
| GAN | Sharp, even degenerate distributions ✅[^3]; no Markov chains, only backpropagation ✅[^3] | No explicit `p_g(x)` ✅[^3]; unstable training, hard-to-measure diversity ✅[^2] |
| Diffusion (DDPM) | High sample quality without adversarial training ✅[^6] | Slow sampling ✅[^6]; non-competitive log-likelihood ✅[^5] |

## Takeaways
- First ask whether the task needs `log p(x)` (scoring, compression, anomaly detection): if yes, rule out GANs; if it must be exact, use an autoregressive model or a flow. [rule-candidate]
- Compare families by the metric the task needs: likelihood and sample quality can disagree.
- A flow's density can be checked directly: it must integrate to 1 and invert exactly; run both checks after writing a new layer.
- Sampling cost is part of the choice: count network evaluations per sample, not just training time.

## Verification status
- Verified: 55 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- [Deep Learning, chapter 20: Deep Generative Models](https://www.deeplearningbook.org/contents/generative_models.html) — Goodfellow, Bengio, Courville, 2016. Backs: explicit vs implicit densities, auto-regressive networks and the chain rule, VAE samples tend to be blurry. [^1]
- [Density estimation using Real NVP](https://arxiv.org/html/1605.08803v3) — Dinh, Sohl-Dickstein, Bengio, 2016. Backs: change-of-variable formula, affine coupling layers, triangular Jacobian, exact likelihood/sampling/inference, related-work comparison of autoregressive models, VAEs and GANs. [^2]
- [Generative Adversarial Nets](https://arxiv.org/html/1406.2661v1) — Goodfellow et al., 2014. Backs: no explicit representation of `p_g(x)`, sharp or degenerate distributions, no Markov chains needed. [^3]
- [Auto-Encoding Variational Bayes](https://arxiv.org/html/1312.6114v11) — Kingma, Welling, 2013. Backs: the VAE maximizes a lower bound on the marginal likelihood. [^4]
- [Denoising Diffusion Probabilistic Models](https://arxiv.org/html/2006.11239v2) — Ho, Jain, Abbeel, 2020. Backs: training on a variational bound, `T = 1000`, sample quality vs non-competitive log-likelihoods, codelength on imperceptible details. [^5]
- [Denoising Diffusion Implicit Models](https://arxiv.org/html/2010.02502v4) — Song, Meng, Ermon, 2020. Backs: DDPM's slow sampling (20 hours vs under a minute for a GAN), high quality without adversarial training. [^6]
- [Wasserstein GAN](https://arxiv.org/html/1701.07875v3) — Arjovsky, Chintala, Bottou, 2017. Backs: maximum likelihood as the classical way to learn a density; KL undefined or infinite for low-dimensional supports; parallel-lines example with infinite KL. [^7]
- `machine-learning/lab-setup.md` — the lab where the real NVP flow, Gaussian and GMM likelihoods, grid integral and inversion check ran on 2026-11-24. [^8]

## Related
- `machine-learning/generative-models/variational-autoencoders.md` — the ELBO and the reparameterization trick.
- `machine-learning/generative-models/generative-adversarial-networks.md` — the implicit-density family in detail.
- `machine-learning/generative-models/diffusion-models.md` — noising, denoising and fast samplers.
- `machine-learning/transformers/pretraining-and-scaling-laws.md` — autoregressive language models and perplexity.
- `machine-learning/foundations/loss-functions-and-maximum-likelihood.md` — maximum likelihood, the objective of the explicit families.
- `machine-learning/unsupervised-learning/gaussian-mixtures-and-em.md` — the GMM baseline in the worked example.
- `machine-learning/foundations/information-theory.md` — KL divergence, likelihood and bits per dimension.
