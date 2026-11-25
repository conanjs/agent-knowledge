---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/generative-models
status: verified
applies-to: ["any"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [machine-learning, generative-models, vae, variational-autoencoder, elbo, kl-divergence, reparameterization-trick, posterior-collapse, latent-space, autoencoder]
---

# Variational autoencoders: the ELBO and the reparameterization trick

## Summary
**TL;DR:** A VAE (variational autoencoder) is an autoencoder whose encoder outputs a probability distribution over codes instead of one code, and whose codes are pushed toward a standard Gaussian prior so that decoding a random code produces a plausible new example. It is trained by maximizing the ELBO (evidence lower bound): reconstruction quality minus the KL (Kullback–Leibler) divergence of the code distribution from the prior. The gradient flows through the random code thanks to the reparameterization trick `z = μ + σ·ε`, which moves the randomness into a noise input `ε`. If the reconstruction term is weak, the encoder can stop using the code entirely: posterior collapse.
**Use this when:** you need a generative model with a latent code, are reading or writing a VAE loss, wonder why `rsample()` differs from `sample()`, or see a KL term near zero and blurry outputs.
**Not this doc:** how VAEs compare with other families → `machine-learning/generative-models/generative-model-families.md`; KL divergence → `machine-learning/foundations/information-theory.md`; maximum likelihood basics → `machine-learning/foundations/loss-functions-and-maximum-likelihood.md`; VAE encoders inside latent diffusion → `machine-learning/generative-models/diffusion-models.md`.

## Problem
A plain autoencoder is trained to copy its input to its output through a code `h = f(x)`, with a decoder `r = g(h)` ✅[^4]; a code smaller than the input forces it to keep the most salient features ✅[^4]. Nothing in that loss says what a code that came from no training image should decode to, so it gives a compressor, not a generator. Making it a proper latent-variable model `p(x) = ∫ p(x | z) p(z) dz` runs into two walls: the true posterior `p(z | x)` is intractable when the decoder is a neural network ✅[^1], and the training objective is an expectation over random `z`, through which gradients cannot be backpropagated directly ✅[^3]. The naive Monte Carlo gradient estimator for that expectation has very high variance and is impractical ✅[^1].

## Mental model
**Analogy:** a library where the librarian (encoder) files each book not at one exact shelf position but as a small cloud of likely positions, and a rule says all the clouds together must look like one standard map of the building (the prior). A second librarian (decoder) fetches a book from any position. Because every region of the map is covered by somebody's cloud, picking a random position still returns a sensible book. The reparameterization trick is the instruction "position = cloud centre + cloud width × a dice roll": the dice roll is random, but how the position depends on the centre and width is plain arithmetic you can differentiate.

**Artifact:** a gradient through a random sample, lab run (`machine-learning/lab-setup.md`), 2026-11-24, PyTorch 2.15.0, two runs identical ✅[^5]. The objective is `E[(z − 3)²]` with `z ~ N(μ, 1)` at `μ = 1`, whose true gradient is `2·(μ − 3) = −4`:

```text
analytic d/dmu E[(z-3)^2] = 2*(mu-3) = -4.0
sample():  requires_grad = False
rsample(): requires_grad = True | gradient estimate = -4.0097
reparameterization  mean =  -4.008   std of one-sample estimate =  2.000
score function      mean =  -4.036   std of one-sample estimate =  9.433
```

`sample()` returns a value autograd treats as a constant; `rsample()` builds `μ + σ·ε` and so carries a gradient ✅[^3] ✅[^5]. Both one-sample estimators are unbiased (means near −4), but the score-function estimator, also called REINFORCE ✅[^2], spread 4.7 times wider (9.433 vs 2.000) in this run ✅[^5].

<details><summary>Full script (prints the output above)</summary>

```python
# Reparameterization trick: a gradient through a random sample, and its variance against the score-function estimator.
import torch
from torch.distributions import Normal

torch.manual_seed(0)
mu = torch.tensor(1.0, requires_grad=True)
q = Normal(mu, torch.tensor(1.0))              # q(z) = N(mu, 1); objective f(z) = (z - 3)^2
print("analytic d/dmu E[(z-3)^2] = 2*(mu-3) =", 2 * (1.0 - 3))

z = q.sample((100_000,))                       # plain sampling: the sample is a constant to autograd
print("sample():  requires_grad =", z.requires_grad)

z = q.rsample((100_000,))                      # z = mu + sigma * eps, eps ~ N(0, 1)
per_sample = torch.autograd.grad(((z - 3) ** 2).sum(), mu)[0] / 100_000
print("rsample(): requires_grad =", z.requires_grad, "| gradient estimate =", round(per_sample.item(), 4))

# One-sample estimators of the same gradient, repeated 100,000 times, to compare their spread.
eps = torch.randn(100_000)
zs = 1.0 + eps
reparam = 2 * (zs - 3)                          # d/dmu f(mu + eps) = f'(z)
score = (zs - 3) ** 2 * (zs - 1.0)              # f(z) * d/dmu log q(z) = f(z) * (z - mu) / sigma^2
for name, g in [("reparameterization", reparam), ("score function", score)]:
    print(f"{name:19s} mean = {g.mean().item():7.3f}   std of one-sample estimate = {g.std().item():6.3f}")
```
</details>

## How it works
**4 actors:**
- **Encoder `q_φ(z | x)`** — its job: map an input to a Gaussian over codes, via a network that outputs a mean `μ` and a standard deviation `σ` per latent dimension ✅[^1].
- **Sampler** — its job: draw a code from that Gaussian, via `z = μ + σ ⊙ ε` with `ε ~ N(0, I)` (⊙ = element-wise product) ✅[^1].
- **Decoder `p_θ(x | z)`** — its job: turn a code into a distribution over inputs, via a network giving a Gaussian (real-valued data) or Bernoulli (binary data) ✅[^1].
- **Prior `p(z)`** — its job: define where codes should live, via the fixed standard Gaussian `N(0, I)` ✅[^1].

```
training:   x ──encoder──► μ, σ ──► z = μ + σ⊙ε ──decoder──► x̂        loss = −ELBO
                              │         ▲ ε ~ N(0, I) (outside the gradient path)
                              └─► KL( N(μ, σ²) ‖ N(0, I) )  closed form
generation: z ~ N(0, I) ──decoder──► new x
```

1. **The bound.** For each data point, `log p(x) = KL(q(z|x) ‖ p(z|x)) + ELBO`; the KL is non-negative, so the ELBO is a lower bound on `log p(x)` ✅[^1] ✅[^2]. The gap is exactly that KL: the better `q` matches the true posterior, the tighter the bound ✅[^2]. Raising the ELBO therefore improves the generative model and the encoder at the same time ✅[^2].
2. **The two terms.** The ELBO splits into `E_q[log p(x | z)] − KL(q(z | x) ‖ p(z))`: the first is a negative reconstruction error, the second acts as a regularizer pulling each code distribution toward the prior ✅[^1].
3. **Closed-form KL.** With a Gaussian `q` and a standard Gaussian prior, the KL needs no sampling ✅[^1]: per latent dimension `KL_j = ½ (μ_j² + σ_j² − 1 − log σ_j²)`. Worked number: `μ = 1, σ = 0.5` gives `½ (1 + 0.25 − 1 − log 0.25) = ½ (0.25 + 1.386) = 0.818` nats (natural-log units); `μ = 0, σ = 1` gives exactly 0.
4. **The reparameterization trick.** Writing `z = μ + σ·ε` turns an expectation over `q_φ` into one over `ε`, so its Monte Carlo estimate is differentiable in the encoder's parameters ✅[^1]. It works for any location–scale family (and for distributions with a tractable inverse CDF (cumulative distribution function) or built by composition) ✅[^1]; it needs continuous latents ✅[^2].
5. **Training loop.** Each step draws a minibatch, draws `ε`, computes the ELBO estimate and its gradient, and updates both networks with SGD (stochastic gradient descent) or a variant; the original paper used one sample of `ε` per data point (`L = 1`) with minibatches of `M = 100` ✅[^1]. One encoder serves every data point, instead of separate variational parameters per point as in classical variational inference ✅[^2].
6. **Generation.** Draw `z` from the prior, run it through the decoder network, and sample `x` from the distribution the decoder outputs ✅[^6].

## Worked example
A VAE with an 8-dimensional latent on the 8×8 digits (pixels scaled to 0..1, 1,437 training and 360 test images), with a Gaussian decoder of fixed variance `var_x`. That variance sets the weight of the reconstruction term: `log p(x | z) = −‖x − x̂‖² / (2·var_x) − (D/2)·log(2π·var_x)` with `D = 64`. Two runs: `var_x = 0.01` (strong reconstruction term) and `var_x = 1.0` (weak). The test set also gets an importance-sampled estimate of the true `log p(x)` (500 samples from `q` per image), to see the bound. Lab run (`machine-learning/lab-setup.md`), 2026-11-24, PyTorch 2.15.0, scikit-learn 1.9.1, two runs identical ✅[^5]:

```text
baseline: pixel MSE of always predicting the mean training image = 0.0737
var_x=0.01  test: ELBO=   26.08 = recon    43.70 - KL  17.61 | log p(x) ~    31.02 | active latent dims 8/8 | pixel MSE 0.0129
var_x=1.0   test: ELBO=  -61.18 = recon   -61.18 - KL   0.00 | log p(x) ~   -61.18 | active latent dims 0/8 | pixel MSE 0.0737
```

<details><summary>Full script (prints the output above)</summary>

```python
# A tiny VAE on the 8x8 digits: the ELBO's two terms, the bound against log p(x), and posterior collapse.
import math
import torch
import torch.nn as nn
from sklearn.datasets import load_digits
from sklearn.model_selection import train_test_split

torch.manual_seed(0); torch.set_num_threads(1)
X, _ = load_digits(return_X_y=True)
Xtr, Xte = train_test_split(torch.tensor(X / 16.0, dtype=torch.float32), test_size=0.2, random_state=0)
D, J = 64, 8                                       # data dimensions, latent dimensions
print(f"baseline: pixel MSE of always predicting the mean training image = {((Xte - Xtr.mean(0)) ** 2).mean():.4f}")

class VAE(nn.Module):
    def __init__(self):
        super().__init__()
        self.enc = nn.Sequential(nn.Linear(D, 128), nn.ReLU(), nn.Linear(128, 2 * J))   # -> mu, log sigma^2
        self.dec = nn.Sequential(nn.Linear(J, 128), nn.ReLU(), nn.Linear(128, D))       # -> mean of p(x|z)
    def terms(self, x, var_x):
        mu, logvar = self.enc(x).chunk(2, dim=1)
        z = mu + torch.exp(0.5 * logvar) * torch.randn_like(mu)                         # reparameterization
        rec = -((x - self.dec(z)) ** 2).sum(1) / (2 * var_x) - 0.5 * D * math.log(2 * math.pi * var_x)
        kl_j = 0.5 * (mu ** 2 + logvar.exp() - 1 - logvar)                             # closed-form KL per dim
        return rec, kl_j, mu, logvar

def log_px(model, x, var_x, K=500):                # importance-sampled estimate of log p(x) with q as proposal
    mu, logvar = model.enc(x).chunk(2, dim=1); sd = torch.exp(0.5 * logvar)
    z = mu + sd * torch.randn(K, *mu.shape)
    log_pz = -0.5 * (z ** 2 + math.log(2 * math.pi)).sum(-1)
    log_q = -0.5 * (((z - mu) / sd) ** 2 + logvar + math.log(2 * math.pi)).sum(-1)
    log_pxz = -((x - model.dec(z)) ** 2).sum(-1) / (2 * var_x) - 0.5 * D * math.log(2 * math.pi * var_x)
    return (torch.logsumexp(log_pxz + log_pz - log_q, dim=0) - math.log(K)).mean()

for var_x in [0.01, 1.0]:                          # decoder variance: a strong vs a weak reconstruction term
    torch.manual_seed(0)
    model = VAE(); opt = torch.optim.Adam(model.parameters(), lr=1e-3)
    for epoch in range(300):
        for idx in torch.randperm(len(Xtr)).split(128):
            rec, kl_j, _, _ = model.terms(Xtr[idx], var_x)
            loss = -(rec - kl_j.sum(1)).mean()      # maximize ELBO = reconstruction - KL
            opt.zero_grad(); loss.backward(); opt.step()
    with torch.no_grad():
        rec, kl_j, _, _ = model.terms(Xte, var_x)
        elbo, kl = (rec - kl_j.sum(1)).mean(), kl_j.sum(1).mean()
        active = int((kl_j.mean(0) > 0.01).sum())
        print(f"var_x={var_x:<5} test: ELBO={elbo:8.2f} = recon {rec.mean():8.2f} - KL {kl:6.2f} | "
              f"log p(x) ~ {log_px(model, Xte, var_x):8.2f} | active latent dims {active}/{J} | "
              f"pixel MSE {((Xte - model.dec(model.enc(Xte).chunk(2, 1)[0])) ** 2).mean():.4f}")
```
</details>

Reading it:
- **Strong reconstruction term (`var_x = 0.01`):** the ELBO 26.08 is the reconstruction 43.70 minus a KL of 17.61 nats, and sits 4.94 nats below the importance-sampled estimate of `log p(x)`, 31.02. That estimate is itself a bound that gets tighter as the number of samples grows (with 1 sample it equals the ELBO) ✅[^2], so 4.94 nats estimates from below the true gap, the KL between the encoder's Gaussian and the true posterior (step 1). All 8 latent dimensions carry information (per-dimension KL above 0.01), and reconstructions have pixel MSE (mean squared error) 0.0129. The numbers are positive because a density with a small variance can exceed 1: the constant `−32·log(2π·0.01)` alone is +88.6.
- **Weak reconstruction term (`var_x = 1.0`):** the KL is 0.00 and 0 of 8 dimensions are active, so `q(z | x) = p(z)` for every image: the code says nothing about the input. The decoder outputs the average image (pixel MSE 0.0737, exactly the mean-image baseline), and the ELBO equals `log p(x)` (−61.18 both), because a posterior that ignores `x` is matched perfectly by the prior. A tight bound here is a symptom, not a success.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Posterior collapse: KL ≈ 0, outputs look like an average | The encoder stops using the code | Early in training the likelihood term is weak, and `q(z|x) ≈ p(z)` is a stable equilibrium that is hard to leave ✅[^2]; lab: `var_x = 1.0` collapsed all 8 dimensions ✅[^5] |
| Fix for collapse: KL annealing | Weight the KL term from 0 up to 1 over many epochs | Proposed remedy for that equilibrium ✅[^2] |
| Fix for collapse: free bits | Each group of latents is charged at least `λ` nats of KL, so using less is not rewarded | Free-bits objective; worked for `λ` from 0.125 to 2 in the cited study ✅[^2] |
| Blurry samples | Typical for image VAEs ✅[^6] | Direction of the KL in the objective spreads model variance wider than the data's ✅[^2]; a more flexible encoder or decoder counters it ✅[^2] |
| Discrete latent variables | The reparameterization trick does not apply | It needs continuous latents ✅[^2]; the score-function estimator (REINFORCE) needs only `f(x)` values ✅[^3] |
| Using `sample()` in a VAE loss | No gradient reaches the encoder through `z` | Random samples cannot be backpropagated; `rsample()` gives the pathwise derivative ✅[^3]; lab: `requires_grad = False` ✅[^5] |
| One sample of `ε` per data point | Enough in practice | With minibatch size 100 the original paper used `L = 1` ✅[^1] |
| ELBO equals `log p(x)` | The encoder matches the true posterior exactly | The gap is `KL(q ‖ p(z|x))` ✅[^2]; in the lab it happened through collapse ✅[^5] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Reparameterization (pathwise) gradient | Unbiased ✅[^2]; lab spread 2.000 vs 9.433 for the score function ✅[^5] | Needs continuous latents and a differentiable `f` ✅[^2] ✅[^3] |
| Score-function (REINFORCE) gradient | Needs only `f(x)` values and `log_prob` ✅[^3] | High variance ✅[^1]; lab spread 4.7× wider ✅[^5] |
| Small decoder variance (strong reconstruction) | Codes are used; sharp reconstructions (lab MSE 0.0129) ✅[^5] | Codes move away from the prior: lab KL 17.61 nats per image ✅[^5] |
| Large decoder variance (weak reconstruction) | KL near zero, codes match the prior | Posterior collapse ✅[^2]; lab: 0/8 dimensions active ✅[^5] |

## Takeaways
- Log the reconstruction term and the KL term separately, and the KL per latent dimension: a total KL near zero means collapse, not a good fit. [rule-candidate]
- Use `rsample()` (or `μ + σ·ε` by hand) wherever a sampled latent feeds a loss you backpropagate. [rule-candidate]
- The ELBO is a bound: compare models with an importance-sampled `log p(x)` when the gap matters.
- If outputs look like the dataset average, strengthen the reconstruction term or anneal the KL weight before adding capacity.

## Verification status
- Verified: 53 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- [Auto-Encoding Variational Bayes](https://arxiv.org/html/1312.6114v11) — Kingma, Welling, 2013. Backs: recognition model as probabilistic encoder, decoder as Gaussian or Bernoulli, the bound and its two terms, high-variance naive estimator, reparameterization and location–scale families, closed-form Gaussian KL, `L = 1` with `M = 100`. [^1]
- [An Introduction to Variational Autoencoders](https://arxiv.org/html/1906.02691v3) — Kingma, Welling, 2019. Backs: the name ELBO, the gap as `KL(q ‖ p(z|x))`, "two for one", one shared encoder, continuous latents for reparameterization, score function = REINFORCE, collapse equilibrium, KL annealing, free bits, blurriness and the KL direction, the importance-sampled `log p(x)` estimate tightening with more samples. [^2]
- [Probability distributions – torch.distributions (PyTorch 2.15)](https://docs.pytorch.org/docs/2.15/distributions.html) — PyTorch contributors, 2026. Backs: no direct backpropagation through random samples, score function vs pathwise derivative, `rsample()`. [^3]
- [Deep Learning, chapter 14: Autoencoders](https://www.deeplearningbook.org/contents/autoencoders.html) — Goodfellow, Bengio, Courville, 2016. Backs: autoencoder as encoder `h = f(x)` and decoder `r = g(h)`, undercomplete codes keep salient features. [^4]
- `machine-learning/lab-setup.md` — the lab where the reparameterization gradient check and the digits VAE with two decoder variances ran on 2026-11-24. [^5]
- [Deep Learning, chapter 20: Deep Generative Models](https://www.deeplearningbook.org/contents/generative_models.html) — Goodfellow, Bengio, Courville, 2016. Backs: VAE generation by sampling the prior and a generator network; image samples tend to be blurry. [^6]

## Related
- `machine-learning/generative-models/generative-model-families.md` — where VAEs sit among explicit and implicit models.
- `machine-learning/generative-models/diffusion-models.md` — a diffusion model is trained on a similar variational bound; latent diffusion runs in an autoencoder's latent space.
- `machine-learning/deep-learning/neural-networks-and-backpropagation.md` — the autograd that the reparameterization trick feeds.
- `machine-learning/foundations/loss-functions-and-maximum-likelihood.md` — maximum likelihood, which the ELBO approximates.
- `machine-learning/unsupervised-learning/principal-component-analysis.md` — what a linear autoencoder reduces to.
- `machine-learning/reinforcement-learning/policy-gradients-and-ppo.md` — where the score-function (REINFORCE) estimator is the main tool.
- `machine-learning/probabilistic-ml/variational-inference.md` — variational inference without an encoder (classical, per-dataset VI).
