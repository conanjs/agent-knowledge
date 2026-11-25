---
schema: topic-index/v1
kind: subtopic
topic: machine-learning/generative-models
last-updated: 2026-11-24
---

# Generative models

Models that learn a data distribution and sample from it: how the deep families differ (explicit vs implicit densities, with normalizing flows covered in the families doc), variational autoencoders, generative adversarial networks, diffusion models and energy-based models. Every doc has a CPU-sized lab run on 2-D toy data or the 8×8 digits, with the full script inline. Not covered: autoregressive language models (see `machine-learning/transformers/`), and classical density models such as Gaussian mixtures (see `machine-learning/unsupervised-learning/`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [generative-model-families.md](generative-model-families.md) | concept | Explicit vs implicit densities; autoregressive, flow, VAE, GAN, diffusion compared; how a real NVP flow computes an exact likelihood | verified |
| [variational-autoencoders.md](variational-autoencoders.md) | concept | Encoder/decoder with a Gaussian latent, the ELBO's reconstruction and KL terms, the reparameterization trick, posterior collapse | verified |
| [generative-adversarial-networks.md](generative-adversarial-networks.md) | concept | The minimax game, optimal discriminator, non-saturating generator loss, non-convergence, mode collapse, Wasserstein GAN | verified |
| [diffusion-models.md](diffusion-models.md) | concept | Forward noising in closed form, noise-prediction training, DDPM vs DDIM sampling, classifier-free guidance, latent diffusion | verified |
| [energy-based-models.md](energy-based-models.md) | concept | exp(−E)/Z and why Z is intractable; positive and negative phase, Langevin sampling, contrastive divergence vs persistent chains (a spurious mode CD misses), score matching and denoising score matching (the diffusion link), RBMs with an exact-Z check | verified |

## References
- [Deep Learning, chapter 20: Deep Generative Models](https://www.deeplearningbook.org/contents/generative_models.html) — Goodfellow, Bengio, Courville, 2016. Backs: topic scope.
- [Probability distributions – torch.distributions (PyTorch 2.15)](https://docs.pytorch.org/docs/2.15/distributions.html) — PyTorch contributors, 2026. Backs: the sampling and gradient-estimator API the lab scripts use.

## Related
- `machine-learning/learning-path.md` — where this subtopic sits in the reading order.
- `machine-learning/lab-setup.md` — the lab every experiment ran in.
- `machine-learning/transformers/pretraining-and-scaling-laws.md` — autoregressive language models, the fifth family.
- `machine-learning/deep-learning/neural-networks-and-backpropagation.md` — the networks and autograd every family is built from.
- `machine-learning/unsupervised-learning/gaussian-mixtures-and-em.md` — a classical explicit density model.
