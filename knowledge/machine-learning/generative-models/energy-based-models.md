---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/generative-models
status: verified
applies-to: ["PyTorch 2.15.0", "scikit-learn 1.9.1", "numpy 2.5.5"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, generative-models, energy-based-models, ebm, partition-function, contrastive-divergence, persistent-contrastive-divergence, langevin-dynamics, score-matching, denoising-score-matching, restricted-boltzmann-machine, rbm, scikit-learn, pytorch]
---

# Energy-based models: the partition function, contrastive divergence and score matching

## Summary
**TL;DR:** An energy-based model (EBM) gives every input a number, its energy `E(x)` (low means likely), and defines `p(x) = exp(−E(x)) / Z`, where the partition function `Z` adds up `exp(−E)` over every possible input. Any network can be the energy, but `Z` is an integral over every input and intractable for most interesting models, so neither the likelihood nor exact samples come for free. Maximum-likelihood training lowers the energy of data and raises the energy of the model's own samples, drawn by MCMC (Markov chain Monte Carlo), often a few Langevin steps started at the data (contrastive divergence) or from persistent chains. Score matching skips `Z` and sampling by fitting the slope `∇ₓ log p = −∇ₓ E`; its denoising form, at several noise levels, is the objective behind score-based and diffusion models. The restricted Boltzmann machine (RBM) is the classic EBM.
**Use this when:** you meet an energy, a partition function, negative samples or "fantasy particles", contrastive divergence (CD), persistent CD, Langevin dynamics, score matching or an RBM; you train a network whose output is an unnormalized log-density; or you need to explain why diffusion models are trained by denoising.
**Not this doc:** how the generative families compare → `machine-learning/generative-models/generative-model-families.md`; Metropolis–Hastings, Gibbs, HMC (Hamiltonian Monte Carlo) and convergence diagnostics → `machine-learning/probabilistic-ml/markov-chain-monte-carlo.md`; the DDPM (denoising diffusion probabilistic model) mechanism → `machine-learning/generative-models/diffusion-models.md`; Markov random fields and their factors → `machine-learning/probabilistic-ml/probabilistic-graphical-models.md`; KL (Kullback–Leibler) divergence → `machine-learning/foundations/information-theory.md`; the InfoNCE (information noise-contrastive estimation) loss of contrastive representation learning → `machine-learning/deep-learning/embeddings-and-self-supervised-learning.md`.

## Problem
Models with a tractable likelihood, or a tractable lower bound on it, pay for it with a fixed form: a product of conditionals (autoregressive), an invertible map (flows) or a directed latent-variable model (VAEs, variational autoencoders, which optimize the bound) ✅[^1]. An EBM only specifies the energy, which can be any nonlinear regression function as long as it is normalizable in principle ✅[^1]. The bill arrives as `Z`: an integral or sum over all states that is intractable for many interesting models ✅[^2], so exact likelihood and exact sampling are generally intractable ✅[^1]. In the lab a 401-point grid per axis computes `Z` of a 2-D energy with `10^5.2` energy evaluations; the same grid needs `10^26` in 10 dimensions ✅[^11]. Even the gradient of the log-likelihood needs samples from the model itself ✅[^1], so a trainer who ignores this either cannot train the model or trains it with a biased sampler without noticing.

## Mental model
**Analogy:** a landscape where altitude is energy and rain collects in proportion to `exp(−altitude)`; the probability of a spot is its share of all the water, and `Z` is the total water in the whole landscape. Training digs valleys under the data (positive phase) and fills in valleys where the model's own walkers settle but no data lives (negative phase). Langevin dynamics is a walker who slides downhill while being jostled at random. Contrastive divergence drops walkers at the data and lets them take only a few steps, so a deep valley over the far ridge is never found. Score matching fits the slope of the ground where the data lies and never measures the total water.

**Artifact:** a ring energy `E(x) = (‖x‖ − 2)² / (2 · 0.25²)` (zero on the circle of radius 2): its `Z` by brute force, Langevin sampling at three step sizes, and two separated modes. Lab run (`machine-learning/lab-setup.md`), 2026-11-25, numpy 2.5.5, two runs identical ✅[^11]:

```text
== 1. Z = integral of exp(-E(x)) dx, by brute force on a grid over [-4, 4]^2 ==
grid Z = 7.8748  (ring approximation 2*pi*R0*S0*sqrt(2*pi) = 7.8748)
p(x) at the ring = 0.1270, at the centre = 1.608e-15
under p: mean radius 2.0312, std radius 0.2480
same grid in D =   2 dimensions: 401^2 = 10^5.2 energy evaluations
same grid in D =  10 dimensions: 401^10 = 10^26.0 energy evaluations
same grid in D = 100 dimensions: 401^100 = 10^260.3 energy evaluations
== 2. Langevin: x <- x + (eps^2 / 2) * score(x) + eps * z, 2000 chains from uniform noise ==
eps=0.05 K=  10: mean r 2.868 std r 0.943 | K= 100: mean r 2.168 std r 0.294 | K=1000: mean r 2.039 std r 0.256
eps=0.1  K=  10: mean r 2.489 std r 0.540 | K= 100: mean r 2.033 std r 0.254 | K=1000: mean r 2.035 std r 0.253
eps=0.3  K=  10: mean r 2.029 std r 0.316 | K= 100: mean r 2.021 std r 0.309 | K=1000: mean r 2.029 std r 0.309
== 3. two modes, weights 0.2 at (-5,-5) and 0.8 at (5,5), unit variance, exact scores ==
start: share of chains nearer (5,5) 0.497 | plain Langevin, 1000 steps: 0.508  (target 0.800)
annealed Langevin, 10 levels x 100 steps: share nearer (5,5) 0.786  (target 0.800)
```

<details><summary>Full script (prints the output above)</summary>

```python
# An energy E(x) on 2-D: its partition function Z on a grid, Langevin sampling with the
# score -dE/dx, and why plain Langevin misjudges two separated modes (annealed Langevin does not).
import numpy as np

rng = np.random.default_rng(0)
R0, S0 = 2.0, 0.25                                   # ring energy: radius 2, width 0.25
E = lambda x: (np.linalg.norm(x, axis=-1) - R0) ** 2 / (2 * S0 ** 2)
def score(x):                                        # -dE/dx = grad log p(x); Z drops out
    r = np.linalg.norm(x, axis=-1, keepdims=True)
    return -(r - R0) / S0 ** 2 * x / r

print("== 1. Z = integral of exp(-E(x)) dx, by brute force on a grid over [-4, 4]^2 ==")
g = np.linspace(-4, 4, 401)
h = g[1] - g[0]
xx = np.stack(np.meshgrid(g, g), axis=-1).reshape(-1, 2)
w = np.exp(-E(xx))
Z = w.sum() * h * h
r_grid = np.linalg.norm(xx, axis=1)
print(f"grid Z = {Z:.4f}  (ring approximation 2*pi*R0*S0*sqrt(2*pi) = {2 * np.pi * R0 * S0 * np.sqrt(2 * np.pi):.4f})")
print(f"p(x) at the ring = {np.exp(-0.0) / Z:.4f}, at the centre = {np.exp(-E(np.zeros(2))) / Z:.3e}")
print(f"under p: mean radius {(w * r_grid).sum() / w.sum():.4f}, std radius "
      f"{np.sqrt((w * (r_grid - (w * r_grid).sum() / w.sum()) ** 2).sum() / w.sum()):.4f}")
for D in (2, 10, 100):
    print(f"same grid in D = {D:3d} dimensions: 401^{D} = 10^{D * np.log10(401):.1f} energy evaluations")

print("== 2. Langevin: x <- x + (eps^2 / 2) * score(x) + eps * z, 2000 chains from uniform noise ==")
for eps in (0.05, 0.1, 0.3):
    x = rng.uniform(-4, 4, (2000, 2))
    line = []
    for k in range(1, 1001):
        x = x + eps ** 2 / 2 * score(x) + eps * rng.standard_normal(x.shape)
        if k in (10, 100, 1000):
            r = np.linalg.norm(x, axis=1)
            line.append(f"K={k:4d}: mean r {r.mean():.3f} std r {r.std():.3f}")
    print(f"eps={eps:<4} " + " | ".join(line))

print("== 3. two modes, weights 0.2 at (-5,-5) and 0.8 at (5,5), unit variance, exact scores ==")
MU, PI = np.array([[-5.0, -5.0], [5.0, 5.0]]), np.array([0.2, 0.8])
def mix_score(x, s2):                                # score of the mixture with variance s2 per axis
    logw = np.log(PI) - ((x[:, None, :] - MU) ** 2).sum(-1) / (2 * s2)
    resp = np.exp(logw - logw.max(1, keepdims=True))
    resp /= resp.sum(1, keepdims=True)
    return (resp[:, :, None] * (MU - x[:, None, :])).sum(1) / s2
x0 = rng.uniform(-8, 8, (4000, 2))
x = x0.copy()
for _ in range(1000):                                # plain Langevin on the data score
    x = x + 0.1 ** 2 / 2 * mix_score(x, 1.0) + 0.1 * rng.standard_normal(x.shape)
print(f"start: share of chains nearer (5,5) {np.mean(x0.sum(1) > 0):.3f} | "
      f"plain Langevin, 1000 steps: {np.mean(x.sum(1) > 0):.3f}  (target 0.800)")
x = x0.copy()
sigmas = np.geomspace(10, 0.1, 10)                   # noise levels, largest first
for s in sigmas:                                     # annealed: score of data + N(0, s^2 I) noise
    eps = 0.5 * s                                    # step size proportional to the noise level
    for _ in range(100):
        x = x + eps ** 2 / 2 * mix_score(x, 1.0 + s ** 2) + eps * rng.standard_normal(x.shape)
print(f"annealed Langevin, 10 levels x 100 steps: share nearer (5,5) {np.mean(x.sum(1) > 0):.3f}  (target 0.800)")
```

</details>

Reading it: the grid `Z` matches the closed-form ring approximation; on the ring `E = 0` and `p = 1/Z = 0.1270`, while the centre has `E = 32` and `p = 1.6e-15`. Langevin with `ε = 0.1` reaches the grid's radius spread (`0.248`) within 100 steps; `ε = 0.3` gets there in 10 steps but to a spread of `0.309`, a discretization bias; `ε = 0.05` is still drifting at 100 steps. Part 3 is the score's blind spot, explained in How it works §5.

## How it works
### 1. Energy, probability and the partition function
1. **Definition.** `p_θ(x) = exp(−E_θ(x)) / Z_θ` with `Z_θ = ∫ exp(−E_θ(x)) dx`: `E_θ` is the energy with parameters `θ`, and `Z_θ` is constant in `x` but a function of `θ` ✅[^1]; for discrete `x` the integral is a sum ✅[^2]. Du and Mordatch call this the Boltzmann distribution ✅[^4]. Example: the ring energy is 0 on the circle and 32 at the centre, so with `Z = 7.8748` the centre is `e^(−32)` times as likely as a point on the ring ✅[^11].
2. **The score.** `∇ₓ log p_θ(x) = −∇ₓ E_θ(x)`: `Z_θ` does not depend on `x`, so its gradient is 0 ✅[^1]. Example: at `x = (2.5, 0)` the ring's score is `−(2.5 − 2) / 0.25² = −8` along the x-axis, pointing back to the circle.

### 2. Maximum likelihood: the positive and the negative phase
1. **The gradient splits in two.** `∇_θ log p_θ(x) = −∇_θ E_θ(x) − ∇_θ log Z_θ`, and `∇_θ log Z_θ = E_{x~p_θ}[−∇_θ E_θ(x)]`, so one sample from the model gives an unbiased estimate of the second term ✅[^1].
2. **Push down, push up.** The negative log-likelihood's gradient is `E_data[∇_θ E(x⁺)] − E_model[∇_θ E(x⁻)]`: lower the energy of data `x⁺`, raise the energy of model samples `x⁻` ✅[^4]. The two terms are the positive and the negative phase, and the negative samples are called hallucinations or fantasy particles ✅[^2]. When the model equals the data distribution the phases balance and the expected gradient is zero ✅[^2].
3. **In code.** Du and Mordatch minimize `mean E(x⁺) − mean E(x⁻)` plus a regularizer, with the samples treated as constants (no gradient through the sampler) ✅[^4]. Everything rests on drawing `x⁻ ~ p_θ`, which is MCMC.

### 3. Langevin dynamics: sampling with the score
1. **Update.** `x^(k+1) = x^k + (ε²/2) · ∇ₓ log p_θ(x^k) + ε · z^k`, `z^k ~ N(0, I)`, from a simple initial distribution ✅[^1]. With `ε = 0.1` the drift is `0.005 ×` the score and the noise has standard deviation 0.1.
2. **Exactness.** The samples follow `p_θ` as `ε → 0` and `K → ∞` under regularity conditions; with a finite `ε` the error is typically negligible or corrected by a Metropolis–Hastings step (MALA, the Metropolis-adjusted Langevin algorithm) ✅[^1]. The lab's `ε = 0.3` shows the bias: radius spread `0.309` against `0.248` ✅[^11].
3. **Only the score is needed**, so a network that outputs the score, with no energy at all, can be sampled ✅[^5].
4. **Notation varies.** Song and Ermon write `x_t = x_(t−1) + (ε/2) ∇ₓ log p + √ε · z` ✅[^5]; Du and Mordatch write `−(λ/2) ∇ₓ E` plus noise `N(0, λ)` ✅[^4]: the same update with `ε²` renamed.

### 4. Contrastive divergence and persistent chains
1. **The naive loop** burns in fresh chains from a random start at every gradient step (perhaps 100 Gibbs steps for an RBM on small image patches) and is infeasible ✅[^2].
2. **CD-k** (Hinton) starts each chain at a training example and runs `k` steps, perhaps 1–20 for such an RBM ✅[^2], typically fewer than convergence needs ✅[^1]. Early on the negative phase is inaccurate, but the positive phase still raises the data's probability and the negative phase improves as the model nears the data ✅[^2].
3. **Its failure mode: spurious modes.** CD fails to suppress regions of high model probability far from the training examples, because chains started at data and run for a few steps rarely visit them ✅[^2]. Experiments on RBMs and fully visible Boltzmann machines showed CD is biased (it converges to different points than maximum likelihood), and its update is not the gradient of any function ✅[^2]; truncated MCMC in general can bias the gradient updates ✅[^1].
4. **Persistent CD (PCD), also called SML (stochastic maximum likelihood),** starts each step's chains from the previous step's states, so the chains can wander far enough to find all the model's modes and resist spurious ones better ✅[^2] ✅[^1]. Du and Mordatch keep a replay buffer of past samples and start 95 % of chains from it, 5 % from uniform noise; spectral normalization and a weak L2 penalty (on the squared energies) keep sampling stable and `Z` integrable ✅[^4].

### 5. Score matching: no `Z`, no sampling
1. **Idea.** Two log-densities with equal gradients everywhere differ by a constant, and normalization forces the constant to 0; so fit the score ✅[^1]. The objective is the Fisher divergence `½ E_{p_data} ‖∇ₓ log p_data(x) − ∇ₓ log p_θ(x)‖²` ✅[^1] ✅[^2], in which `Z` never appears ✅[^2].
2. **Hyvärinen's trick.** The data's score is unknown, but integration by parts turns the objective into a sample average of derivatives of the model's log-density alone ✅[^1] ✅[^6]: per dimension, its second derivative plus half its squared first derivative ✅[^2]. The estimator is consistent under regularity conditions ✅[^1]; the second derivatives cost time quadratic in the dimension ✅[^1], and the basic method needs continuous data ✅[^2] (generalizations to discrete or bounded data exist ✅[^1]).
3. **Denoising score matching (DSM).** Add noise, `x̃ = x + noise`, and fit the score of `q(x̃ | x)` instead: Vincent showed this equals the Fisher divergence to the noisy distribution up to a constant ✅[^1]. For Gaussian noise the target is `−(x̃ − x)/σ²` and the loss is `½ E ‖s_θ(x̃) + (x̃ − x)/σ²‖²` ✅[^5]. Example: `x = 2.0`, `x̃ = 2.3`, `σ = 0.5` gives target `−0.3 / 0.25 = −1.2`. DSM learns the noisy distribution, not the data distribution, and a very small `σ` makes the objective high-variance ✅[^1]. Sliced score matching is a consistent alternative whose cost is linear in the dimension ✅[^1].
4. **The blind spot.** Within each of two separated modes the score does not depend on the mixing weight, so score matching cannot learn the weights, and Langevin dynamics does not recover them in reasonable time ✅[^1] ✅[^5]. The fix: perturb the data with noise levels `σ₁ > … > σ_L`, learn one noise-conditional score network, and sample with annealed Langevin dynamics, step size `∝ σ_i²` ✅[^5] (in the notation above, `ε ∝ σ_i`). Lab (artifact, part 3, Song and Ermon's toy mixture and the 10 levels from 10 to 0.1 given in their §4.3 ✅[^5]; their appendix lists 20 to 1 for the same figure ✅[^5]): plain Langevin keeps the starting split (`0.508` against a target `0.800`), annealed Langevin reaches `0.786` ✅[^11].
5. **Link to diffusion.** Score-based generative models skip the energy and model the score directly ✅[^1]. DDPM's noise-prediction parameterization reveals an equivalence with DSM over several noise levels during training and with annealed Langevin dynamics during sampling ✅[^7]. Score matching is itself a form of CD with a Langevin-like chain in the limit of small steps ✅[^1] ✅[^2].

### 6. Restricted Boltzmann machines
1. **Structure.** A Boltzmann machine is an EBM over binary vectors with `E(x) = −xᵀUx − bᵀx` ✅[^3]. An RBM restricts it to a bipartite graph of visible units `v` and hidden units `h`, no links within a layer, energy `E(v, h) = −bᵀv − cᵀh − vᵀWh` ✅[^3] ✅[^8]. Long and Servedio proved its `Z` intractable ✅[^3].
2. **Easy conditionals.** `P(h_j = 1 | v) = σ(c_j + vᵀW_:,j)` and `P(v | h)` is factorial too, so block Gibbs sampling alternates whole layers ✅[^3] ✅[^8]. Summing out `h` gives the free energy `F(v) = −bᵀv − Σ_j log(1 + exp(c_j + W_j·v))`, with `p(v) = exp(−F(v))/Z` ✅[^10].
3. **scikit-learn's `BernoulliRBM`** takes binary or `[0, 1]` inputs ✅[^8] and trains by SML/PCD ✅[^9]: each update takes the positive phase from `P(h | v_data)` and the negative phase from one Gibbs step of persistent hidden samples ✅[^10]. `score_samples` is a pseudo-likelihood that flips one random pixel per row and returns `n_features · log σ(F(v′) − F(v))` ✅[^9] ✅[^10]. The user guide calls the model usually not useful for density estimation and suggests its features for linear classifiers ✅[^8].

Lab run (`machine-learning/lab-setup.md`), 2026-11-25, scikit-learn 1.9.1, two runs identical: with 16 hidden units `Z` is still a sum over `2^16` hidden states, so the exact test log-likelihood can be computed ✅[^11]:

```text
independent-pixel baseline: test mean log-likelihood -25.209 nats
epoch  1: exact test log-likelihood  -25.620  log Z  46.549  pseudo-likelihood (score_samples)  -21.879
epoch  5: exact test log-likelihood  -24.172  log Z  46.491  pseudo-likelihood (score_samples)  -19.730
epoch 10: exact test log-likelihood  -21.643  log Z  54.062  pseudo-likelihood (score_samples)  -17.628
epoch 30: exact test log-likelihood  -19.789  log Z  67.769  pseudo-likelihood (score_samples)  -13.263
P(h=1|v) = sigmoid(c + W v) equals transform(): True
one Gibbs step v -> h -> v': 0.144 of pixels flipped
states summed for Z here: 2^16 = 65,536; with the default 256 hidden units: 2^256 = 1.16e+77
```

<details><summary>Full script (prints the output above)</summary>

```python
# scikit-learn's BernoulliRBM on binarized 8x8 digits. With 16 hidden units the partition function
# can still be summed exactly over 2^16 hidden states, which gives the true test log-likelihood.
import itertools
import numpy as np
from scipy.special import expit, logsumexp
from sklearn.datasets import load_digits
from sklearn.neural_network import BernoulliRBM

X = (load_digits().data > 7).astype(float)            # 1797 images, 64 binary pixels
rng = np.random.default_rng(0)
perm = rng.permutation(len(X))
Xtr, Xte = X[perm[:1500]], X[perm[1500:]]
H = np.array(list(itertools.product([0, 1], repeat=16)), dtype=float)   # all 65,536 hidden states

def free_energy(rbm, v):                              # F(v) = -b.v - sum_j log(1 + exp(c_j + W_j.v))
    return -v @ rbm.intercept_visible_ - np.logaddexp(0, v @ rbm.components_.T + rbm.intercept_hidden_).sum(1)
def log_z(rbm):                                       # sum over h: exp(c.h) * prod_i (1 + exp(b_i + (W^T h)_i))
    return logsumexp(H @ rbm.intercept_hidden_ + np.logaddexp(0, H @ rbm.components_ + rbm.intercept_visible_).sum(1))
def exact_ll(rbm, v):
    return (-free_energy(rbm, v) - log_z(rbm)).mean()

p = (Xtr.sum(0) + 1) / (len(Xtr) + 2)                 # baseline: independent pixels
print(f"independent-pixel baseline: test mean log-likelihood {(Xte @ np.log(p) + (1 - Xte) @ np.log(1 - p)).mean():.3f} nats")
rbm = BernoulliRBM(n_components=16, learning_rate=0.05, batch_size=10, random_state=0)
for epoch in range(1, 31):
    for i in range(0, len(Xtr), 10):
        rbm.partial_fit(Xtr[i:i + 10])                # one SML/PCD update per mini-batch
    if epoch in (1, 5, 10, 30):
        print(f"epoch {epoch:2d}: exact test log-likelihood {exact_ll(rbm, Xte):8.3f}  log Z {log_z(rbm):7.3f}"
              f"  pseudo-likelihood (score_samples) {rbm.score_samples(Xte).mean():8.3f}")
print(f"P(h=1|v) = sigmoid(c + W v) equals transform(): "
      f"{np.allclose(expit(Xte @ rbm.components_.T + rbm.intercept_hidden_), rbm.transform(Xte))}")
v1 = rbm.gibbs(Xte)
print(f"one Gibbs step v -> h -> v': {np.mean(v1 != Xte):.3f} of pixels flipped")
print(f"states summed for Z here: 2^16 = {2 ** 16:,}; with the default 256 hidden units: 2^256 = {2.0 ** 256:.2e}")
```

</details>

After 30 epochs the RBM beats independent pixels by 5.4 nats per image (`−19.789` against `−25.209`). The pseudo-likelihood (`−13.263`) is a different, larger number: a proxy, not the log-likelihood. The exact sum works only because `2^16` is small; scikit-learn's default of 256 hidden units would need `1.16e77` terms.

## Worked example
Three training approaches on toy data, all checked against an exactly computed answer. (1) Contrastive divergence: a 2 → 64 → 64 → 1 network with SiLU (sigmoid linear unit) activations trained on two-moons data (4,000 points) with 20 Langevin steps (`ε = 0.05`) started at the data, scored by the test log-likelihood with `Z` summed on a 301 × 226 grid over the box `[−2.5, 3.5] × [−2.0, 2.5]`. (2) A spurious mode: an energy made of local Gaussian bumps first learns moons plus an extra blob at `(2.8, 1.8)`, then trains on moons only, with negatives from the data (CD) or from a replay buffer. (3) DSM on a 1-D Gaussian mixture. The core of every training step:

```python
neg = langevin(E, start, steps=20, eps=0.05)               # x <- x - (eps^2/2) dE/dx + eps z
loss = E(pos).mean() - E(neg).mean() + 0.1 * (E(pos) ** 2 + E(neg) ** 2).mean()
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-25, PyTorch 2.15.0, scikit-learn 1.9.1, two runs identical ✅[^11]:

```text
baseline, one Gaussian fitted to the data: test mean log-likelihood -1.896
CD from scratch step    1: E(data) - E(negatives) -0.000  log Z  3.306  test mean log-likelihood -3.308
CD from scratch step  200: E(data) - E(negatives) -0.039  log Z  2.142  test mean log-likelihood -2.163
CD from scratch step 1000: E(data) - E(negatives) -0.166  log Z  1.531  test mean log-likelihood -1.466
CD from scratch step 2000: E(data) - E(negatives) -0.182  log Z  1.263  test mean log-likelihood -1.160
== a spurious mode: a local-bump energy that also learned a blob at (2.8, 1.8), then trained on moons only ==
start model: mass near the blob 0.190  test mean log-likelihood -1.159
after 1000 steps, negatives from data  : mass near the blob 0.308  test mean log-likelihood -1.273
after 1000 steps, negatives from buffer: mass near the blob 0.000  test mean log-likelihood -0.915
== denoising score matching: data 0.5 N(-2, 0.5^2) + 0.5 N(2, 0.5^2), noise sigma = 0.5 ==
DSM loss on 20000 noisy points: trained net 1.0582  exact score of q_sigma 1.0557  zero function 1.9848
x             [-3.0, -2.0, -1.0, 0.0, 1.0, 2.0, 3.0]
trained s(x)  [2.0, 0.01, -2.07, -0.02, 2.0, -0.05, -2.06]
exact score   [2.0, 0.0, -2.0, 0.0, 2.0, -0.0, -2.0]
```

<details><summary>Full script (prints the output above)</summary>

```python
# Train a small neural energy E_theta(x) on 2-D two-moons data with short-run Langevin negatives
# started at the data (contrastive divergence), checked with Z computed on a grid; show that such
# negatives miss a spurious mode that a replay buffer finds; then denoising score matching
# recovers the exact score of a noise-perturbed Gaussian mixture.
import torch
from torch import nn
from sklearn.datasets import make_moons

torch.manual_seed(0)
Xtr = torch.tensor(make_moons(4000, noise=0.08, random_state=0)[0], dtype=torch.float32)
Xte = torch.tensor(make_moons(1000, noise=0.08, random_state=1)[0], dtype=torch.float32)
LO, HI = torch.tensor([-2.5, -2.0]), torch.tensor([3.5, 2.5])        # the box where Z is computed
gx, gy = torch.linspace(-2.5, 3.5, 301), torch.linspace(-2.0, 2.5, 226)
grid = torch.stack(torch.meshgrid(gx, gy, indexing="ij"), -1).reshape(-1, 2)
cell = (gx[1] - gx[0]) * (gy[1] - gy[0])

def mlp():
    return nn.Sequential(nn.Linear(2, 64), nn.SiLU(), nn.Linear(64, 64), nn.SiLU(), nn.Linear(64, 1))
def test_loglik(E):                                   # log p(x) = -E(x) - log Z, Z summed on the grid
    with torch.no_grad():
        logZ = torch.logsumexp(-E(grid).squeeze(1), 0) + torch.log(cell)
        return (-E(Xte).squeeze(1) - logZ).mean().item(), logZ.item()
def langevin(E, x, steps, eps):                       # x <- x - (eps^2/2) dE/dx + eps z
    for _ in range(steps):
        x = x.detach().requires_grad_(True)
        g = torch.autograd.grad(E(x).sum(), x)[0]
        x = x - eps ** 2 / 2 * g + eps * torch.randn_like(x)
    return x.detach()

def train(E, data, steps, init, log_at=(), name="", lr=1e-3):
    opt = torch.optim.Adam(E.parameters(), lr=lr)
    buffer = LO + (HI - LO) * torch.rand(4096, 2)                 # replay buffer of past negatives
    for step in range(1, steps + 1):
        pos = data[torch.randint(0, len(data), (256,))]
        if init == "data":
            start = pos                                           # CD: chains start at the data
        else:                                                     # 95% from the buffer, 5% uniform noise
            idx = torch.randint(0, len(buffer), (256,))
            start = torch.where(torch.rand(256, 1) < 0.95, buffer[idx], LO + (HI - LO) * torch.rand(256, 2))
        neg = langevin(E, start, steps=20, eps=0.05)              # short-run Langevin negatives
        if init != "data":
            buffer[idx] = neg
        e_pos, e_neg = E(pos), E(neg)
        loss = e_pos.mean() - e_neg.mean() + 0.1 * (e_pos ** 2 + e_neg ** 2).mean()
        opt.zero_grad(); loss.backward(); opt.step()
        if step in log_at:
            ll, logZ = test_loglik(E)
            print(f"{name} step {step:4d}: E(data) - E(negatives) {(e_pos.mean() - e_neg.mean()).item():6.3f}"
                  f"  log Z {logZ:6.3f}  test mean log-likelihood {ll:.3f}")
def mass_near(E, c, rad=0.5):                                 # model probability within rad of point c
    with torch.no_grad():
        p = torch.softmax(-E(grid).squeeze(1), 0)
    return p[(grid - torch.tensor(c)).norm(dim=1) < rad].sum().item()

gauss = torch.distributions.MultivariateNormal(Xtr.mean(0), torch.cov(Xtr.T))
print(f"baseline, one Gaussian fitted to the data: test mean log-likelihood {gauss.log_prob(Xte).mean().item():.3f}")
torch.manual_seed(1)
E = mlp()
train(E, Xtr, 2000, "data", log_at=(1, 200, 1000, 2000), name="CD from scratch")

class Bumps(nn.Module):                              # E(x) = sum_k a_k exp(-|x - c_k|^2 / (2 * 0.25^2)):
    def __init__(self):                               # each weight a_k only acts near its own centre c_k
        super().__init__()
        cx, cy = torch.meshgrid(torch.arange(-2.5, 3.51, 0.25), torch.arange(-2.0, 2.51, 0.25), indexing="ij")
        self.c = torch.stack([cx, cy], -1).reshape(-1, 2)
        self.a = nn.Parameter(torch.zeros(len(self.c)))
    def forward(self, x):
        return (torch.exp(-torch.cdist(x, self.c) ** 2 / (2 * 0.25 ** 2)) @ self.a)[:, None]

print("== a spurious mode: a local-bump energy that also learned a blob at (2.8, 1.8), then trained on moons only ==")
torch.manual_seed(3)
blob = torch.tensor([2.8, 1.8]) + 0.15 * torch.randn(1000, 2)
E0 = Bumps()
train(E0, torch.cat([Xtr, blob]), 1500, "buffer", lr=1e-2)
state = {k: v.clone() for k, v in E0.state_dict().items()}
print(f"start model: mass near the blob {mass_near(E0, [2.8, 1.8]):.3f}  test mean log-likelihood {test_loglik(E0)[0]:.3f}")
for init in ("data", "buffer"):
    torch.manual_seed(4)
    E1 = Bumps(); E1.load_state_dict(state)
    train(E1, Xtr, 1000, init, lr=1e-2)
    print(f"after 1000 steps, negatives from {init:<6}: mass near the blob {mass_near(E1, [2.8, 1.8]):.3f}"
          f"  test mean log-likelihood {test_loglik(E1)[0]:.3f}")

print("== denoising score matching: data 0.5 N(-2, 0.5^2) + 0.5 N(2, 0.5^2), noise sigma = 0.5 ==")
torch.manual_seed(2)
sig = 0.5
x = torch.where(torch.rand(20000, 1) < 0.5, -2.0, 2.0) + 0.5 * torch.randn(20000, 1)
def exact_score(xt):                                  # q_sigma: same mixture, variance 0.25 + sig^2
    v = 0.25 + sig ** 2
    lw = torch.stack([-(xt + 2) ** 2, -(xt - 2) ** 2], -1) / (2 * v)
    r = torch.softmax(lw, -1)
    return (r[..., 0] * (-2 - xt) + r[..., 1] * (2 - xt)) / v
s = nn.Sequential(nn.Linear(1, 64), nn.SiLU(), nn.Linear(64, 64), nn.SiLU(), nn.Linear(64, 1))
opt = torch.optim.Adam(s.parameters(), lr=3e-3)
dsm = lambda f, xb, xt: 0.5 * ((f(xt) + (xt - xb) / sig ** 2) ** 2).mean()
for step in range(3000):
    xb = x[torch.randint(0, len(x), (512,))]
    xt = xb + sig * torch.randn_like(xb)               # the noisy copy
    loss = dsm(s, xb, xt)
    opt.zero_grad(); loss.backward(); opt.step()
with torch.no_grad():
    xt = x + sig * torch.randn_like(x)
    print(f"DSM loss on 20000 noisy points: trained net {dsm(s, x, xt).item():.4f}  exact score of q_sigma "
          f"{dsm(exact_score, x, xt).item():.4f}  zero function {dsm(lambda z: 0 * z, x, xt).item():.4f}")
    pts = torch.tensor([[-3.0], [-2.0], [-1.0], [0.0], [1.0], [2.0], [3.0]])
    print("x            ", [round(v, 2) for v in pts.squeeze(1).tolist()])
    print("trained s(x) ", [round(v, 2) for v in s(pts).squeeze(1).tolist()])
    print("exact score  ", [round(v, 2) for v in exact_score(pts).squeeze(1).tolist()])
```

</details>

Reading it, line by line:
- **CD from scratch:** at step 1 the energy is nearly flat, so the model is uniform over the 6 × 4.5 box (area 27, `−log 27 = −3.296`, printed `−3.308`). After 2,000 steps the test log-likelihood is `−1.160`, 0.74 nats per point above the single Gaussian, and `log Z` has fallen from `3.306` to `1.263` as the mass concentrated on the moons. The printed energy gap only drifts from `−0.000` to `−0.182` while the log-likelihood climbs by 2.1 nats, because CD's negatives start at the data and stay close: the gap is not a measure of progress.
- **Spurious mode:** the bump energy starts with 19 % of its mass in the blob. CD's negatives never travel there (20 steps of `ε = 0.05` move a chain about `0.05 · √20 ≈ 0.22`), so the blob's bumps never get pushed up; as the moons' energy changes, the blob's share even grows to 31 % and the test log-likelihood falls to `−1.273`. The replay buffer's uniform restarts can land near the blob and slide into it, so the negative phase pushes its energy up: its mass drops to 0 and the log-likelihood rises to `−0.915`. This is the spurious-mode failure of CD and the persistent-chain fix ✅[^2].
- **DSM:** the trained network reaches a loss of `1.0582`, just above the `1.0557` of the exact score of the noisy distribution and far below the zero function's `1.9848`; the loss never reaches 0 because the target `−(x̃ − x)/σ²` is noisy. At the seven test points the learned score is within 0.07 of the exact one: zero at the mode centres `±2` and at the midpoint 0, and `±2` one unit from each centre, pointing back towards it.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Model mass far from the data, negatives started at the data | Never pushed up; lab blob share 0.190 → 0.308 | Short chains from data rarely visit far modes ✅[^2]; lab ✅[^11] |
| Same model, replay buffer with 5 % uniform restarts | The far mode is found and removed (lab 0.000) | Persistent chains wander far ✅[^2]; buffer recipe ✅[^4]; lab ✅[^11] |
| Langevin step too large | Samples too spread (lab radius std 0.309 against 0.248) | Discretization error; a Metropolis–Hastings step corrects it ✅[^1]; lab ✅[^11] |
| Langevin step too small | Chains still drifting (lab `ε = 0.05`, 100 steps: mean radius 2.168 against 2.031) | ✅[^11] |
| Modes separated by low density | Plain Langevin keeps the starting split; score matching cannot learn the weights | The score ignores the mixing weight ✅[^5] ✅[^1]; lab 0.508 against 0.800 ✅[^11] |
| Data on a low-dimensional manifold | Score undefined in the ambient space | Song and Ermon's motivation for adding noise ✅[^5] |
| Discrete or bounded data (pixels 0–255) | Score matching's regularity conditions fail | Add noise first (DSM) ✅[^1]; score matching needs continuous `x` ✅[^2] |
| Energies drift to huge values during training | Numerical instability | Weak L2 penalty on the energies ✅[^4] |
| Reporting or comparing EBMs by likelihood | Impossible without `Z` | `Z` is needed to evaluate, monitor and compare models, so estimate it ✅[^2]; exact in tiny cases (lab: 2-D grid, 16-unit RBM) ✅[^11] |
| RBM `score_samples` read as log-likelihood | A random pseudo-likelihood (lab `−13.263` against exact `−19.789`) | One random pixel flipped per call ✅[^9] ✅[^10]; lab ✅[^11] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| MCMC maximum likelihood (CD, PCD, replay buffer) | Any energy; fits the KL divergence ✅[^1] | Samples at every step; truncated chains can bias the gradient ✅[^1]; CD leaves spurious modes ✅[^2] |
| Score matching | No `Z`, no sampling, consistent ✅[^1] | Second derivatives, quadratic in the dimension ✅[^1]; the basic form needs continuous data ✅[^2] |
| Denoising score matching | No second derivatives ✅[^1]; at many noise levels it trains score-based and diffusion models ✅[^5] ✅[^7] | Learns the noisy distribution ✅[^1]; needs several noise levels to weigh separated modes ✅[^5] |
| NCE (noise-contrastive estimation) | Yields `Z` as a by-product of training ✅[^1] | The noise distribution is critical, especially for high-dimensional data; it works best close to the data ✅[^1] |
| RBM | Factorial conditionals, block Gibbs ✅[^3] ✅[^8] | `Z` intractable ✅[^3]; scikit-learn's version is usually not useful for density estimation ✅[^8] |

## Takeaways
- Never report an EBM's likelihood from energies alone: compute `Z` (a grid in 2-D, enumeration for a tiny RBM) or estimate it, or say it is not available. [rule-candidate]
- When negatives come from short-run MCMC, keep persistent chains with some fresh noise restarts; chains started at the data leave far-away modes untouched. [rule-candidate]
- Denoising score matching learns the noisy density; with separated modes, train and sample across several noise levels.

## Verification status
- Verified: 111 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [How to Train Your Energy-Based Models](https://arxiv.org/html/2101.03288v2) — Song, Kingma, 2021. Backs: the EBM definition, intractable likelihood and sampling, the gradient of `log Z`, the score, Langevin MCMC and MALA, CD and persistent CD, biased truncated MCMC, score matching, DSM, sliced score matching, the mode-weight blind spot, score-based models, SM–CD link, NCE. [^1]
- [Deep Learning, chapter 18: Confronting the Partition Function](https://www.deeplearningbook.org/contents/partition.html) — Goodfellow, Bengio, Courville, 2016. Backs: the partition function, positive and negative phase, fantasy particles, the naive MCMC loop, CD-k, spurious modes, CD's bias, SML/PCD, score matching's objective and limits, why `Z` is needed for evaluation. [^2]
- [Deep Learning, chapter 20: Deep Generative Models](https://www.deeplearningbook.org/contents/generative_models.html) — Goodfellow, Bengio, Courville, 2016. Backs: Boltzmann machine energy, RBM structure and energy, intractable `Z` (Long and Servedio), factorial conditionals. [^3]
- [Implicit Generation and Modeling with Energy-Based Models](https://ar5iv.labs.arxiv.org/html/1903.08689) — Du, Mordatch, 2019 (ar5iv HTML of arXiv:1903.08689). Backs: the Boltzmann distribution, the ML gradient as push-down/push-up, their Langevin notation, replay buffer with 95 % reuse, spectral normalization and L2 on energies. [^4]
- [Generative Modeling by Estimating Gradients of the Data Distribution](https://ar5iv.labs.arxiv.org/html/1907.05600) — Song, Ermon, 2019 (ar5iv HTML of arXiv:1907.05600). Backs: Langevin with only the score, their notation, the manifold and low-density problems, slow mixing between modes, the DSM target for Gaussian noise, noise-conditional score networks, annealed Langevin with step `∝ σ²`. [^5]
- [Estimation of Non-Normalized Statistical Models by Score Matching](https://jmlr.org/papers/v6/hyvarinen05a.html) — Hyvärinen, JMLR 6, 2005 (abstract page). Backs: score matching's objective reduces to a sample average of model derivatives. [^6]
- [Denoising Diffusion Probabilistic Models](https://arxiv.org/html/2006.11239v2) — Ho, Jain, Abbeel, 2020. Backs: the noise-prediction parameterization's equivalence with multi-level DSM in training and annealed Langevin dynamics in sampling. [^7]
- [Neural network models (unsupervised), §2.9.1 Restricted Boltzmann machines (scikit-learn User Guide)](https://scikit-learn.org/stable/modules/neural_networks_unsupervised.html) — scikit-learn developers, living (1.9.1). Backs: RBM energy and conditionals, block Gibbs, Bernoulli inputs, not useful for density estimation, features for linear classifiers. [^8]
- [sklearn.neural_network.BernoulliRBM](https://scikit-learn.org/stable/modules/generated/sklearn.neural_network.BernoulliRBM.html) — scikit-learn developers, living (1.9.1). Backs: SML/PCD training, `score_samples` as a non-deterministic pseudo-likelihood. [^9]
- [sklearn/neural_network/_rbm.py at 1.9.1](https://raw.githubusercontent.com/scikit-learn/scikit-learn/1.9.1/sklearn/neural_network/_rbm.py) — scikit-learn source code, 2026. Backs: the free energy, the PCD update with one Gibbs step, the pseudo-likelihood formula. [^10]
- `machine-learning/lab-setup.md` — the lab where the ring-energy, Langevin, two-mode, RBM exact-`Z`, contrastive-divergence, spurious-mode and DSM scripts ran on 2026-11-25. [^11]

## Related
- `machine-learning/generative-models/generative-model-families.md` — where EBMs sit among explicit and implicit densities.
- `machine-learning/generative-models/diffusion-models.md` — the multi-noise-level denoising objective in its DDPM form.
- `machine-learning/probabilistic-ml/markov-chain-monte-carlo.md` — the MCMC samplers and diagnostics behind the negative phase.
- `machine-learning/probabilistic-ml/probabilistic-graphical-models.md` — Markov random fields, whose partition function has the same problem.
- `machine-learning/unsupervised-learning/factor-analysis-and-ica.md` — factor analysis and ICA, linear latent-variable models.
