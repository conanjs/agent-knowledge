---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/generative-models
status: verified
applies-to: ["any"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [machine-learning, generative-models, diffusion, ddpm, ddim, noise-prediction, classifier-free-guidance, latent-diffusion, sampling]
---

# Diffusion models: noising, noise prediction, DDPM and DDIM sampling, guidance

## Summary
**TL;DR:** A diffusion model destroys data with a fixed recipe, many small steps of Gaussian noise until only noise is left, and trains a network to undo one step at a time. Training is plain regression: noise a clean example to a random level `t` in one shot with `x_t = √ᾱ_t·x_0 + √(1−ᾱ_t)·ε` and ask the network to predict the noise `ε`. Sampling starts from pure noise and applies the learned denoiser repeatedly: DDPM (denoising diffusion probabilistic models) uses all `T = 1000` steps; DDIM (denoising diffusion implicit models) reuses the same trained network with a deterministic update on a short sub-sequence of steps. Classifier-free guidance mixes a conditional and an unconditional prediction to trade diversity for fidelity, and latent diffusion runs the whole process in a pretrained autoencoder's compressed latent space.
**Use this when:** implementing or reading a diffusion training loop or sampler, choosing the number of sampling steps, setting a guidance scale, or wondering why image models work in a latent space.
**Not this doc:** how diffusion compares with other families → `machine-learning/generative-models/generative-model-families.md`; the variational bound idea it builds on → `machine-learning/generative-models/variational-autoencoders.md`; the attention layers used for text conditioning → `machine-learning/transformers/attention-and-the-transformer.md`.

## Problem
GANs (generative adversarial networks) produce sharp samples but train as an unstable game (`machine-learning/generative-models/generative-adversarial-networks.md`); DDPM reached high image quality without adversarial training ✅[^2], with an FID (Fréchet Inception Distance) of 3.17 on unconditional CIFAR10, a dataset of 32×32 images ✅[^1]. The price is speed: sampling simulates a Markov chain for many steps ✅[^2], around 20 hours for 50,000 32×32 images where a GAN needs less than a minute on the same GPU (graphics processing unit) ✅[^2], and pixel-space models can consume hundreds of GPU days of training ✅[^4]. Practitioners therefore meet three knobs whose meaning is not obvious from the code: the number of sampling steps, the stochasticity `η` of the sampler, and the guidance scale `w`.

## Mental model
**Analogy:** a drop of ink spreading in a glass of water, filmed. Running the film forward is easy and needs no learning. The model learns to run it backwards one frame at a time: given a cloudy frame and how far along the film it is, guess which way the ink came from. Generation starts from a fully cloudy glass and plays the learned reverse film. DDIM is the same reverse film watched with frames skipped.

**Artifact:** the forward process, run two ways for one fixed point `x_0 = (1.0, 0.5)` and 200,000 noise draws: `t` small steps `x_t = √(1−β_t)·x_{t−1} + √β_t·ε`, against the one-shot closed form. Lab run (`machine-learning/lab-setup.md`), 2026-11-24, PyTorch 2.15.0, two runs identical ✅[^5]:

```text
t=  10 iterated: mean [0.999 0.5  ] sd [0.044 0.044] | closed form: mean [0.999 0.5  ] sd 0.044
t= 100 iterated: mean [0.947 0.472] sd [0.32  0.321] | closed form: mean [0.947 0.474] sd 0.321
t=1000 iterated: mean [0.004 0.002] sd [1.003 1.003] | closed form: mean [0.006 0.003] sd 1.000
```

The iterated chain and the formula agree to sampling error at every `t`, and at `t = 1000` the point has become a standard Gaussian: its starting position is forgotten. (Full script after the worked example.)

## How it works
**3 actors:**
- **Forward process `q`** — its job: add Gaussian noise on a schedule `β_1 … β_T`, via the fixed Markov chain `q(x_t | x_{t−1}) = N(√(1−β_t)·x_{t−1}, β_t·I)`; DDPM held the `β_t` constant rather than learning them ✅[^1].
- **Denoiser `ε_θ(x_t, t)`** — its job: predict the noise inside a noisy input, via a neural network that also receives the step `t` ✅[^1].
- **Sampler** — its job: turn noise into data, via repeated reverse updates that call the denoiser ✅[^1] ✅[^2].

```
training:  x_0 ──(t ~ U{1..T}, ε ~ N(0,I))──► x_t = √ᾱ_t·x_0 + √(1−ᾱ_t)·ε ──► ε_θ(x_t, t) ──► loss ‖ε − ε_θ‖²
sampling:  x_T ~ N(0, I) ──► x_{T−1} ──► … ──► x_0        (each arrow: one call of ε_θ)
           DDPM: all T arrows, fresh noise each time · DDIM: S ≪ T arrows, no fresh noise (η = 0)
```

1. **Schedule and closed form.** Write `α_t = 1 − β_t` and `ᾱ_t = α_1 · α_2 · … · α_t`. Then `x_t` can be drawn directly from `x_0`: `q(x_t | x_0) = N(√ᾱ_t·x_0, (1 − ᾱ_t)·I)` ✅[^1]. DDPM used `T = 1000` and `β` rising linearly from `10⁻⁴` to `0.02` ✅[^1], on data scaled to `[−1, 1]` ✅[^1]. Worked numbers from the artifact: at `t = 100`, `√(1 − ᾱ_100) = 0.321`, so `ᾱ_100 = 0.897` and `√ᾱ_100 = 0.947`: `x_100 = 0.947·x_0 + 0.321·ε`. At `t = T` the signal is almost gone: the KL (Kullback–Leibler) divergence between `q(x_T | x_0)` and `N(0, I)` was about `10⁻⁵` bits per dimension in the paper ✅[^1].
2. **Training objective.** The model is a latent-variable model trained on a variational bound on `−log p(x_0)` ✅[^1]. Parameterizing the reverse mean through a noise predictor and dropping the bound's weights gives `L_simple = E_{t, x_0, ε} ‖ε − ε_θ(√ᾱ_t·x_0 + √(1−ᾱ_t)·ε, t)‖²`, with `t` uniform in `1..T` ✅[^1]; one training step is: pick a data point, a step `t`, a noise `ε`, take a gradient step on that squared error ✅[^1]. Dropping the weights down-weights the easy small-`t` terms, which helped sample quality ✅[^1]. Predicting `ε` links diffusion to denoising score matching ✅[^1].
3. **DDPM sampling (ancestral).** Start from `x_T ~ N(0, I)`; for `t = T … 1`: `x_{t−1} = (1/√α_t)·(x_t − (β_t/√(1−ᾱ_t))·ε_θ(x_t, t)) + σ_t·z`, with fresh `z ~ N(0, I)` except at the last step ✅[^1]. Both `σ_t² = β_t` and the posterior variance `σ_t² = β̃_t` gave similar results ✅[^1]. That is `T = 1000` network calls per sample.
4. **DDIM: same network, shorter path.** DDIM keeps DDPM's training procedure and objective ✅[^2] but writes the update as "predicted `x_0`" plus "direction pointing to `x_t`" plus optional noise ✅[^2]. In DDPM's notation:
   ```text
   x̂_0      = (x_t − √(1−ᾱ_t)·ε_θ(x_t, t)) / √ᾱ_t                      predicted clean point
   x_prev   = √ᾱ_prev·x̂_0 + √(1−ᾱ_prev−σ²)·ε_θ(x_t, t) + σ·z
   σ        = η · √((1−ᾱ_prev)/(1−ᾱ_t)) · √(1 − ᾱ_t/ᾱ_prev)
   ```
   `η = 1` gives a DDPM; `η = 0` removes the noise term, so the sampler is deterministic and the model is an implicit model ✅[^2]. Because the objective depends only on the marginals `q(x_t | x_0)`, the update can jump along any increasing sub-sequence `τ` of the steps, with no retraining ✅[^2]. DDIM had the best quality when the sub-sequence was short, and matched 1000-step quality in 20 to 100 steps, a 10× to 50× speed-up ✅[^2]. The DDIM paper writes `α_t` for what DDPM calls `ᾱ_t` ✅[^2], a frequent source of bugs when combining the two papers' formulas.
5. **Classifier-free guidance (CFG).** One network learns both a conditional noise prediction `ε_θ(x_t, c)` (`c` = the condition, for example a class label) and an unconditional one `ε_θ(x_t)`: during training the condition `c` is replaced by a null token with probability `p_uncond` ✅[^3]. At sampling time the two predictions are combined as `ε̃ = (1 + w)·ε_θ(x_t, c) − w·ε_θ(x_t)`, where `w ≥ 0` is the guidance scale ✅[^3] (the paper writes `z_λ` for the noisy input `x_t`). Worked number: with `w = 1`, a conditional prediction 0.8 and an unconditional 0.5 give `2·0.8 − 0.5 = 1.1`, pushed further away from the unconditional value. Raising `w` trades diversity for fidelity: on class-conditional ImageNet the best FID came with small guidance (`w = 0.1` or `0.3`) and the best Inception score (IS) with strong guidance (`w ≥ 4`) ✅[^3]. It replaces classifier guidance, which needed an extra classifier trained on noisy data ✅[^3], but each sampling step needs two forward passes of the model ✅[^3].
6. **Latent diffusion.** Train an autoencoder once (perceptual loss plus a patch-based adversarial objective), whose encoder downsamples an `H × W` image by a factor `f` (the latent is `H/f × W/f`), then run the diffusion model on the latents ✅[^4]. In the paper's comparison a factor of 1 (pixel space) needed much longer training than factors 4 to 16, a factor of 32 compressed so much that it limited sample quality, and factors 4 and 8 performed strongly ✅[^4]. Cross-attention layers let text or bounding boxes condition the denoiser ✅[^4].

## Worked example
One MLP (multilayer perceptron) denoiser with 3 hidden layers of 256 units, trained for 8,000 Adam steps on standardized 2-D two-moons with `T = 1000` and DDPM's linear schedule. The network also takes a class input `c`: moon 0, moon 1, or the null token (used 20 % of the time, `p_uncond = 0.2`). Steps are 0-based in the code (`t = 0 … 999`). Quality is measured with two distances on 2,000 samples against 5,000 real points: **sample→data** (how far a sample is from the nearest real point: are samples on the moons?) and **data→sample** (how far a real point is from the nearest sample: are all parts of the moons covered?). Lab run (`machine-learning/lab-setup.md`), 2026-11-24, PyTorch 2.15.0, scikit-learn 1.9.1, two runs identical ✅[^5]:

```text
final training loss 0.182
sampler                       net evals  sample->data  data->sample
(held-out real points)            -        0.013         0.021
DDPM, all 1000 steps           1000        0.023         0.024
DDIM eta=0, 100 steps           100        0.027         0.026
DDIM eta=0, 20 steps             20        0.032         0.030
stochastic eta=1, 20 steps       20        0.036         0.028
DDIM eta=0, 5 steps               5        0.107         0.155
guidance, class c = moon 0 (DDIM, 50 steps); real moon-0 points: sd = [0.815 0.614]
  w=0.0  share on moon 0 = 0.999  sd = [0.776 0.604]  sample->moon0 = 0.014  moon0->sample = 0.019
  w=1.0  share on moon 0 = 1.000  sd = [0.641 0.514]  sample->moon0 = 0.012  moon0->sample = 0.069
  w=4.0  share on moon 0 = 1.000  sd = [0.555 0.466]  sample->moon0 = 0.017  moon0->sample = 0.312
```

<details><summary>Full script (prints the artifact and the output above)</summary>

```python
# DDPM on 2-D two-moons: closed-form forward process, noise-prediction training, DDPM vs DDIM sampling,
# and classifier-free guidance, with one small MLP on the CPU.
import torch
import torch.nn as nn
from sklearn.datasets import make_moons

torch.manual_seed(0); torch.set_num_threads(1)
T = 1000
beta = torch.linspace(1e-4, 0.02, T)                 # DDPM's linear schedule, beta_1 .. beta_T
alpha_bar = torch.cumprod(1 - beta, dim=0)           # alpha_bar_t = prod_{s<=t} (1 - beta_s)

# 1. Forward process: T small noising steps vs the one-shot closed form, for one fixed x0.
x0 = torch.tensor([1.0, 0.5]); x = x0.repeat(200_000, 1)
for t in range(T):
    x = torch.sqrt(1 - beta[t]) * x + torch.sqrt(beta[t]) * torch.randn_like(x)
    if t + 1 in (10, 100, 1000):
        print(f"t={t+1:4d} iterated: mean {x.mean(0).numpy().round(3)} sd {x.std(0).numpy().round(3)} | "
              f"closed form: mean {(alpha_bar[t].sqrt() * x0).numpy().round(3)} sd {(1 - alpha_bar[t]).sqrt():.3f}")

# 2. Train eps_theta(x_t, t, c) on moons; c = moon label 0/1, or 2 = "no condition" (null token).
X, y = make_moons(20_000, noise=0.05, random_state=0)
X = torch.tensor((X - X.mean(0)) / X.std(0), dtype=torch.float32); y = torch.tensor(y)
net = nn.Sequential(nn.Linear(2 + 1 + 3, 256), nn.SiLU(), nn.Linear(256, 256), nn.SiLU(),
                    nn.Linear(256, 256), nn.SiLU(), nn.Linear(256, 2))
def eps_theta(xt, t, c):                              # t: integer step 0..T-1, c: 0, 1 or 2
    return net(torch.cat([xt, (t.float() / T)[:, None], nn.functional.one_hot(c, 3).float()], 1))
opt = torch.optim.Adam(net.parameters(), lr=1e-3)
for step in range(8000):
    i = torch.randint(0, len(X), (512,)); x0b, c = X[i], y[i].clone()
    c[torch.rand(512) < 0.2] = 2                      # p_uncond = 0.2: drop the label 20% of the time
    t = torch.randint(0, T, (512,)); eps = torch.randn_like(x0b)
    ab = alpha_bar[t][:, None]
    loss = ((eps - eps_theta(ab.sqrt() * x0b + (1 - ab).sqrt() * eps, t, c)) ** 2).mean()   # L_simple
    opt.zero_grad(); loss.backward(); opt.step()
print(f"final training loss {loss.item():.3f}")

@torch.no_grad()
def sample(n, steps, eta, c=2, w=0.0):
    ts = torch.linspace(T - 1, 0, steps).round().long()       # the sub-sequence tau, from T-1 down to 0
    x = torch.randn(n, 2); cc = torch.full((n,), c)
    for k, t in enumerate(ts):
        tt = torch.full((n,), int(t))
        e = eps_theta(x, tt, cc)
        if w:                                                 # classifier-free guidance
            e = (1 + w) * e - w * eps_theta(x, tt, torch.full((n,), 2))
        ab = alpha_bar[t]; ab_prev = alpha_bar[ts[k + 1]] if k + 1 < steps else torch.tensor(1.0)
        x0_hat = (x - (1 - ab).sqrt() * e) / ab.sqrt()               # "predicted x0"
        sigma = eta * ((1 - ab_prev) / (1 - ab) * (1 - ab / ab_prev)).sqrt()
        x = ab_prev.sqrt() * x0_hat + (1 - ab_prev - sigma ** 2).sqrt() * e + sigma * torch.randn_like(x)
    return x

ref, ref_y = X[:5000], y[:5000]
def quality(s):                                   # mean distance sample -> nearest real point, and real -> sample
    d = torch.cdist(s, ref)
    return d.min(1).values.mean().item(), d.min(0).values.mean().item()

print("sampler                       net evals  sample->data  data->sample")
p, r = quality(X[5000:7000])
print(f"{'(held-out real points)':28s} {'-':>6s} {p:12.3f} {r:13.3f}")
for name, steps, eta in [("DDPM, all 1000 steps", 1000, 1.0), ("DDIM eta=0, 100 steps", 100, 0.0),
                         ("DDIM eta=0, 20 steps", 20, 0.0), ("stochastic eta=1, 20 steps", 20, 1.0),
                         ("DDIM eta=0, 5 steps", 5, 0.0)]:
    torch.manual_seed(1)
    p, r = quality(sample(2000, steps, eta))
    print(f"{name:28s} {steps:6d} {p:12.3f} {r:13.3f}")

moon0 = ref[ref_y == 0]
print(f"guidance, class c = moon 0 (DDIM, 50 steps); real moon-0 points: sd = {moon0.std(0).numpy().round(3)}")
for w in [0.0, 1.0, 4.0]:
    torch.manual_seed(1)
    s = sample(2000, 50, 0.0, c=0, w=w)
    nearest = ref_y[torch.cdist(s, ref).argmin(1)]
    d = torch.cdist(s, moon0)
    print(f"  w={w:3.1f}  share on moon 0 = {(nearest == 0).float().mean():.3f}  sd = {s.std(0).numpy().round(3)}  "
          f"sample->moon0 = {d.min(1).values.mean():.3f}  moon0->sample = {d.min(0).values.mean():.3f}")
```
</details>

Reading it:
- **Held-out real points** set the floor: two independent real samples are 0.013 and 0.021 apart by these measures.
- **DDPM, 1000 steps** gets closest (0.023 / 0.024). **DDIM with 100 and 20 steps** loses little (0.027 and 0.032 sample→data) for 10× and 50× fewer network calls. At 20 steps the deterministic sampler put samples closer to the moons than the stochastic one (0.032 vs 0.036), while the stochastic one covered slightly better (0.028 vs 0.030). **5 steps** is too few: 0.107 / 0.155.
- **Guidance:** the conditional model alone (`w = 0`) already puts 99.9 % of samples on moon 0 with nearly the real spread (sd 0.776 vs 0.815 in the first coordinate). Raising `w` to 4 keeps samples on the moon (0.017) but shrinks their spread (0.555) and leaves parts of the moon empty: moon0→sample grows from 0.019 to 0.312. That is the diversity cost of guidance, in two dimensions.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Mixing DDPM and DDIM formulas | Wrong noise levels | DDIM's `α_t` is DDPM's `ᾱ_t` ✅[^2] |
| Very few DDIM steps (5 in the lab) | Samples drift off the data | Each jump crosses a large noise gap; lab sample→data 0.107 vs 0.023 at 1000 steps ✅[^5] |
| Stochastic sampler (`η = 1`) on a short sub-sequence | Worse than `η = 0` at the same step count in the DDIM paper | DDIM is best when `dim(τ)` is small ✅[^2]; lab at 20 steps: 0.036 vs 0.032 ✅[^5] |
| Same starting noise, different step counts (DDIM) | Samples share high-level features | DDIM's "consistency" property, which DDPM lacks ✅[^2] |
| Training only the conditional model, then guiding | No unconditional prediction to subtract | CFG needs the jointly trained null-token model ✅[^3] |
| `p_uncond` too large (0.5) | Worse than 0.1 or 0.2 across the whole IS/FID range in the paper's 64×64 ImageNet runs ✅[^3] | Only a small share of model capacity needs to go to the unconditional task ✅[^3] |
| Large guidance scale | Higher fidelity, less diversity | Trade-off measured as IS vs FID ✅[^3]; lab coverage 0.019 → 0.312 at `w = 4` ✅[^5] |
| Judging a diffusion model by its likelihood | Sample quality and likelihood disagree | DDPM's log-likelihoods were not competitive despite its samples ✅[^1] |
| Latent diffusion with too little or too much compression | Slow training (f = 1) or capped quality (f = 32) | Measured in the paper; f = 4 and 8 performed strongly ✅[^4] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| DDPM, all `T` steps | Highest quality in the lab (0.023) ✅[^5] | `T = 1000` network calls per sample ✅[^1] |
| DDIM, `S ≪ T` steps, `η = 0` | 10× to 50× faster at comparable quality, same trained model ✅[^2]; deterministic, so noise → sample is repeatable ✅[^2] | Quality falls when `S` gets very small (lab, 5 steps) ✅[^5] |
| Classifier-free guidance, larger `w` | Better fidelity, no extra classifier ✅[^3] | Less diversity ✅[^3]; two model calls per step ✅[^3] |
| Latent diffusion | Much less compute than pixel-space models ✅[^4] | Needs a pretrained autoencoder; quality capped by its compression ✅[^4] |

## Takeaways
- Train on `L_simple` with the one-shot closed form; never loop the forward process during training. [rule-candidate]
- Use a deterministic DDIM sampler with tens of steps as the default and raise the step count only when quality checks demand it.
- Tune the guidance scale on a quality-and-diversity pair of metrics, not on fidelity alone. [rule-candidate]
- When porting a formula between papers, check whether `α` means `α_t` or `ᾱ_t`.

## Verification status
- Verified: 58 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- [Denoising Diffusion Probabilistic Models](https://arxiv.org/html/2006.11239v2) — Ho, Jain, Abbeel, 2020. Backs: forward process and closed form, `α_t` and `ᾱ_t`, variational bound, `L_simple`, training and sampling algorithms, `σ_t²` choices, `T = 1000` and the linear schedule, data scaling, `L_T ≈ 10⁻⁵`, score-matching link, small-`t` down-weighting, FID 3.17, non-competitive likelihoods. [^1]
- [Denoising Diffusion Implicit Models](https://arxiv.org/html/2010.02502v4) — Song, Meng, Ermon, 2020. Backs: slow DDPM sampling and the 20-hour figure, same training objective, the predicted-`x_0` update and `σ`, `η = 0` as an implicit model, sub-sequences without retraining, best quality at short trajectories, 10× to 50× speed-up, notation `α_t = ᾱ_t`, consistency. [^2]
- [Classifier-Free Diffusion Guidance](https://arxiv.org/html/2207.12598v1) — Ho, Salimans, 2022. Backs: single network with a null token, `p_uncond`, the `(1 + w)` mixing formula, FID vs IS trade-off and best `w` values, classifier guidance needing a noisy-data classifier, two forward passes, `p_uncond = 0.5` worse. [^3]
- [High-Resolution Image Synthesis with Latent Diffusion Models](https://arxiv.org/html/2112.10752v2) — Rombach et al., 2021. Backs: compute cost of pixel-space models, autoencoder with perceptual and adversarial losses, factor `f`, LDM-1 vs LDM-4…16 vs LDM-32, cross-attention conditioning. [^4]
- `machine-learning/lab-setup.md` — the lab where the forward-process check, the two-moons denoiser, the DDPM/DDIM comparison and the guidance sweep ran on 2026-11-24. [^5]

## Related
- `machine-learning/generative-models/generative-model-families.md` — diffusion among the likelihood-based and implicit families.
- `machine-learning/generative-models/variational-autoencoders.md` — the variational bound and the autoencoder that latent diffusion builds on.
- `machine-learning/generative-models/generative-adversarial-networks.md` — the adversarial alternative diffusion replaced for image quality.
- `machine-learning/transformers/attention-and-the-transformer.md` — cross-attention, used for text conditioning.
- `machine-learning/deep-learning/optimizers-and-learning-rate-schedules.md` — the Adam optimizer used to train the denoiser.
