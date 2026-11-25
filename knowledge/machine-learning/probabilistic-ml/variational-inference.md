---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/probabilistic-ml
status: verified
applies-to: ["any", "PyTorch 2.15.0"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, variational-inference, elbo, kl-divergence, mean-field, cavi, stochastic-variational-inference, black-box-variational-inference, advi, reparameterization, bayesian-inference]
---

# Variational inference: the ELBO, mean-field CAVI and stochastic gradient VI

## Summary
**TL;DR:** VI (variational inference) replaces "compute the posterior" with "find the member of a simple family `q` closest to the posterior", closeness measured by the KL (Kullback–Leibler) divergence `KL(q ‖ p(z | x))`. That KL needs the unknown evidence `log p(x)`, so VI maximizes the ELBO (evidence lower bound) instead, using `log p(x) = ELBO + KL`: raising the ELBO shrinks the gap. Mean-field VI makes `q` a product of one factor per variable, and CAVI (coordinate-ascent VI) updates each factor in closed form; stochastic VI follows noisy gradients from minibatches, and black-box VI and ADVI (automatic differentiation VI) need only the model's log joint density, with score-function or reparameterization gradients. Because this KL direction punishes `q` for putting mass where the posterior has little, VI tends to under-estimate posterior variance: in the lab, mean-field standard deviations of two correlated regression weights came out at 0.47 of an HMC (Hamiltonian Monte Carlo) reference, with the means close.
**Use this when:** MCMC (Markov chain Monte Carlo) is too slow for your data size, you read or write an ELBO-based fit (Stan's ADVI, a VAE (variational autoencoder) encoder), or you need to know how far to trust a variational posterior's uncertainty.
**Not this doc:** amortized VI with an encoder network, the per-example ELBO and the reparameterization trick in depth → `machine-learning/generative-models/variational-autoencoders.md`; what KL divergence is and why its direction matters → `machine-learning/foundations/information-theory.md`; sampling the posterior instead → `machine-learning/probabilistic-ml/markov-chain-monte-carlo.md`; priors, posteriors and conjugacy → `machine-learning/probabilistic-ml/bayesian-inference.md`.

## Problem
Bayesian statistics frames every question about unknowns as a computation on the posterior density, and that density is usually hard to compute ✅[^1]. The obstacle is the evidence `p(x)`, the integral of the joint over every latent value; its being hard to compute is the reason approximate inference exists at all ✅[^1]. MCMC produces asymptotically exact samples but tends to be more computationally intensive ✅[^1]. Classical VI by coordinate ascent re-analyzes every data point before each update of the global parameters, which is inefficient for large datasets ✅[^3], and deriving a variational algorithm for a new model usually takes significant model-specific mathematics ✅[^4]. Practitioners therefore need three things: an objective that does not need `p(x)`, algorithms that scale to millions of data points and arbitrary models, and a clear picture of what the approximation gets wrong.

## Mental model
**Analogy:** fitting a cookie cutter of fixed shape onto an irregular piece of dough. You may move the cutter and resize it, but not change its shape (the variational family). The scoring rule (the reverse KL) charges heavily for any part of the cutter hanging off the dough, and only mildly for dough the cutter misses. For a long, slanted strip of dough and a round cutter, the best score comes from a small circle that stays on the strip: centred correctly, but much narrower than the strip's length. Mean-field VI is that round cutter; the slant is correlation between variables.

**Artifact:** CAVI on a Bayesian linear regression with two strongly correlated features, whose exact posterior is a Gaussian with correlation −0.905, so every quantity is known in closed form. Starting from the wrong means, each sweep raises the ELBO and lowers the KL by the same amount, and their sum stays `log p(y)`; at convergence the means are exact and the standard deviations are 0.42 of the truth. The numerically best diagonal Gaussian under each KL direction confirms which way each one errs. Lab run (`machine-learning/lab-setup.md`), 2026-11-25, numpy 2.5.5, scipy 1.18.1, two runs identical ✅[^6]:

```text
exact posterior: mean [ 0.891 -0.416], sd [0.586 0.598], correlation -0.905;  log p(y) = -32.7661
sweep  0: m = [-3.  3.]  ELBO =  -55.8937  KL(q||p) =  23.1275  ELBO + KL = -32.7661
sweep  1: m = [-2.14   2.385]  ELBO =  -46.9820  KL(q||p) =  14.2159  ELBO + KL = -32.7661
sweep  2: m = [-1.594  1.88 ]  ELBO =  -42.6032  KL(q||p) =   9.8370  ELBO + KL = -32.7661
sweep  5: m = [-0.479  0.849]  ELBO =  -36.3509  KL(q||p) =   3.5848  ELBO + KL = -32.7661
sweep 10: m = [0.384 0.052]  ELBO =  -33.9976  KL(q||p) =   1.2315  ELBO + KL = -32.7661
sweep 20: m = [ 0.821 -0.352]  ELBO =  -33.6303  KL(q||p) =   0.8641  ELBO + KL = -32.7661
sweep 40: m = [ 0.89  -0.415]  ELBO =  -33.6232  KL(q||p) =   0.8571  ELBO + KL = -32.7661
sweep 60: m = [ 0.891 -0.416]  ELBO =  -33.6232  KL(q||p) =   0.8571  ELBO + KL = -32.7661
mean-field sd [0.249 0.254] vs exact sd [0.586 0.598]: ratio [0.424 0.424]
best diagonal q under KL(q||p): mean [ 0.891 -0.416], sd [0.249 0.254];  KL(q||p) = 0.857  KL(p||q) = 3.695
best diagonal q under KL(p||q): mean [ 0.891 -0.416], sd [0.586 0.598];  KL(q||p) = 3.695  KL(p||q) = 0.857
```

<details><summary>Full script (prints the output above)</summary>

```python
# Coordinate-ascent mean-field VI on a Bayesian linear regression whose exact posterior is a
# correlated 2-D Gaussian: the ELBO rises, the KL gap shrinks, ELBO + KL stays equal to log p(y).
import numpy as np
from scipy.optimize import minimize
from scipy.stats import multivariate_normal

rng = np.random.default_rng(0)
n, sigma = 20, 1.0                                   # 20 rows, noise standard deviation 1
x1 = rng.standard_normal(n); x2 = 0.95 * x1 + np.sqrt(1 - 0.95**2) * rng.standard_normal(n)
X = np.column_stack([x1, x2])                        # two strongly correlated features
y = X @ np.array([1.0, -0.5]) + sigma * rng.standard_normal(n)
Lam = X.T @ X / sigma**2 + np.eye(2)                 # posterior precision (prior w ~ N(0, I))
S = np.linalg.inv(Lam); mu = S @ X.T @ y / sigma**2  # exact posterior N(mu, S)
log_evidence = multivariate_normal(np.zeros(n), sigma**2 * np.eye(n) + X @ X.T).logpdf(y)

def elbo(m, s2):                                     # E_q[log p(y|w)] + E_q[log p(w)] + H(q), closed form
    lik = -0.5 * n * np.log(2 * np.pi * sigma**2) - 0.5 / sigma**2 * (
        ((y - X @ m) ** 2).sum() + (s2 * (X**2).sum(0)).sum())
    prior = -np.log(2 * np.pi) - 0.5 * ((m**2).sum() + s2.sum())
    return lik + prior + 0.5 * np.log(2 * np.pi * np.e * s2).sum()

def kl_gauss(m0, S0, m1, S1):                        # KL(N(m0, S0) || N(m1, S1))
    iS1 = np.linalg.inv(S1); d = m1 - m0
    return 0.5 * (np.trace(iS1 @ S0) + d @ iS1 @ d - 2 + np.log(np.linalg.det(S1) / np.linalg.det(S0)))

print(f"exact posterior: mean {mu.round(3)}, sd {np.sqrt(np.diag(S)).round(3)}, "
      f"correlation {S[0, 1] / np.sqrt(S[0, 0] * S[1, 1]):.3f};  log p(y) = {log_evidence:.4f}")
m, s2 = np.array([-3.0, 3.0]), 1 / np.diag(Lam)      # CAVI: q_j = N(m_j, 1/Lam_jj)
for sweep in range(61):
    kl = kl_gauss(m, np.diag(s2), mu, S)
    if sweep in (0, 1, 2, 5, 10, 20, 40, 60):
        print(f"sweep {sweep:2d}: m = {m.round(3)}  ELBO = {elbo(m, s2):9.4f}  KL(q||p) = {kl:8.4f}  "
              f"ELBO + KL = {elbo(m, s2) + kl:.4f}")
    m[0] = X[:, 0] @ (y - X[:, 1] * m[1]) / sigma**2 / Lam[0, 0]   # q_1 from E_q2[log p(y, w)]
    m[1] = X[:, 1] @ (y - X[:, 0] * m[0]) / sigma**2 / Lam[1, 1]   # q_2 from E_q1[log p(y, w)]
print(f"mean-field sd {np.sqrt(s2).round(3)} vs exact sd {np.sqrt(np.diag(S)).round(3)}: "
      f"ratio {(np.sqrt(s2 / np.diag(S))).round(3)}")
for name, kl in [("KL(q||p)", lambda t: kl_gauss(t[:2], np.diag(np.exp(2 * t[2:])), mu, S)),
                 ("KL(p||q)", lambda t: kl_gauss(mu, S, t[:2], np.diag(np.exp(2 * t[2:]))))]:
    t = minimize(kl, np.zeros(4), method="BFGS").x   # best diagonal Gaussian q = N(t[:2], diag(e^2t[2:]))
    qS = np.diag(np.exp(2 * t[2:]))
    print(f"best diagonal q under {name}: mean {t[:2].round(3)}, sd {np.exp(t[2:]).round(3)};  "
          f"KL(q||p) = {kl_gauss(t[:2], qS, mu, S):.3f}  KL(p||q) = {kl_gauss(mu, S, t[:2], qS):.3f}")
```
</details>

## How it works
**Inference as optimization.** Choose a family `Q` of densities over the latent variables `z` and solve `q* = argmin_{q ∈ Q} KL(q(z) ‖ p(z | x))` ✅[^1]; KL is asymmetric, non-negative and smallest when the two densities are equal ✅[^1] (definitions and numbers in `machine-learning/foundations/information-theory.md`). Exact inference is the special case where `Q` contains the true posterior ✅[^2].

### The ELBO and its KL gap
1. **The objective.** Expanding the KL gives `KL(q ‖ p(z | x)) = E_q[log q(z)] − E_q[log p(z, x)] + log p(x)`, which needs the evidence ✅[^1]. Define `ELBO(q) = E_q[log p(z, x)] − E_q[log q(z)]`, an expectation of things we can evaluate. Then `log p(x) = ELBO(q) + KL(q ‖ p(z | x))`, so maximizing the ELBO is the same as minimizing the KL, and `log p(x) ≥ ELBO` for every `q` ✅[^1], with equality exactly when `q` is the posterior ✅[^2]. Worked numbers from the artifact, sweep 0: `−55.8937 + 23.1275 = −32.7661 = log p(y)` ✅[^6].
2. **Two readings.** The same ELBO is `E_q[log p(x, z)] + H(q)`, the expected log joint plus the entropy of `q` ✅[^2], or `E_q[log p(x | z)] − KL(q(z) ‖ p(z))`: an expected log-likelihood that pulls `q` towards latent values that explain the data, minus a pull towards the prior ✅[^1]. A VAE optimizes the second form per data point with an encoder network; see `machine-learning/generative-models/variational-autoencoders.md`.
3. **Why this KL direction.** `KL(q ‖ p)` needs expectations under `q` only, which we choose to be simple; `KL(p ‖ q)` would need expectations under the true posterior, which is what we cannot compute ✅[^2]. The price: the objective penalizes `q` for putting mass where `p` has little, and penalizes the reverse less ✅[^1], so `q` ends up with low probability wherever the posterior has low probability ✅[^2].

### Mean-field VI and CAVI
1. **The family.** Mean-field VI takes `q(z) = Π_j q_j(z_j)`, one independent factor per latent variable ✅[^1]. The family can represent any marginal density but no correlation between variables ✅[^1]; whether the fitted factors match the true marginals is another matter (step 3). The factors' shapes need not be chosen in advance: in the Deep Learning book's example with a Gaussian prior and a Gaussian likelihood, the optimal factor comes out Gaussian from the update rule itself, without being assumed ✅[^2]. Families that keep some dependencies are called structured VI ✅[^1].
2. **The update.** Holding all other factors fixed, the best `q_j` is `q_j*(z_j) ∝ exp(E_{−j}[log p(z_j, z_{−j}, x)])`, the exponentiated expected log joint, the expectation taken over the other factors ✅[^1] ✅[^2]. CAVI cycles through the factors with this update and climbs the ELBO to a local optimum ✅[^1]. It uses the same complete conditional `p(z_j | z_{−j}, x)` as Gibbs sampling: Gibbs draws a sample from it, CAVI takes its expected log ✅[^1].
3. **Gaussian case, worked.** If the posterior is `N(μ, Λ⁻¹)` with precision matrix `Λ`, the expected log joint is quadratic in `z_j`, so `q_j = N(m_j, 1/Λ_jj)` with `m_j = μ_j − (1/Λ_jj)·Σ_{k≠j} Λ_jk·(m_k − μ_k)`. In 2-D, `1/Λ_11 = Σ_11·(1 − ρ²)`, where `Σ_11` is the true marginal variance and `ρ` the posterior correlation, so the mean-field standard deviation is `√(1 − ρ²)` of the true one: with `ρ = −0.905`, `√(1 − 0.819) = 0.425`; the artifact prints 0.424, its means converge to the exact `[0.891, −0.416]`, and a numerical search over all diagonal Gaussians lands on the same CAVI answer ✅[^6]. The means approach the exact ones slowly (sweep 10 is still far off) ✅[^6]: with strongly correlated coordinates, each update can move one coordinate only as far as the other's current value allows.
4. **Local optima.** The ELBO is generally non-convex, CAVI only reaches a local optimum, and that optimum can depend on the initialization ✅[^1].

### Stochastic VI: minibatches and step sizes
1. **Subsample.** SVI (stochastic variational inference) repeatedly samples a data point (or minibatch), computes its local variational parameters, and forms intermediate global parameters `λ̂` as if the sampled point were replicated `N` times, `N` being the dataset size ✅[^3].
2. **Step.** It then moves the current global parameters `λ` part of the way, `λ ← (1 − ρ_t)·λ + ρ_t·λ̂` ✅[^3] (with `ρ_t = 0.616`, `λ = 0` and `λ̂ = 10`, the new `λ` is 6.16); this is a step along a noisy natural gradient of the ELBO, the gradient that accounts for the geometry of probability distributions ✅[^1].
3. **Step sizes.** If `Σ ρ_t = ∞` and `Σ ρ_t² < ∞`, the iterates converge to a local optimum (the optimum, for a convex objective) ✅[^3]. The paper uses `ρ_t = (t + τ)^(−κ)` with forgetting rate `κ ∈ (0.5, 1]` and delay `τ ≥ 0` ✅[^3]: `τ = 1, κ = 0.7` gives `ρ_1 = 2^(−0.7) = 0.616` and `ρ_100 = 101^(−0.7) = 0.040`.
4. **Reach.** As derived, SVI targets the global parameters of conditionally conjugate models ✅[^1], and it analyzed 3.8 million Wikipedia articles in the original study ✅[^3]. The lab's minibatch fit uses the same two ideas, a likelihood scaled by `n/batch = 10` and a `(t + τ)^(−κ)` decay of the learning rate, but takes Adam steps on ordinary gradients instead of natural-gradient steps.

### Black-box gradients: score function and reparameterization
1. **Score-function (BBVI, black-box VI) gradient.** `∇_λ ELBO = E_q[∇_λ log q(z | λ) · (log p(x, z) − log q(z | λ))]`, estimated by averaging over `S` samples from `q` ✅[^4]. `∇_λ log q` is called the score function, and the estimator needs only samples from `q`, its score and the log joint, so no model-specific derivation ✅[^4]. Its variance can be too large to be useful, which the paper reduces with Rao-Blackwellization and control variates ✅[^4].
2. **Reparameterization gradient (ADVI).** ADVI first transforms constrained latent variables (a positive variance, a probability) to unconstrained real coordinates ✅[^5], then uses a Gaussian `q` there: mean-field (a mean and a log standard deviation per variable) or full-rank `N(μ, LLᵀ)` with `L` lower-triangular, `K(K+1)/2` free entries for `K` variables ✅[^5]. Writing a draw as `z = μ + L·ε` with `ε ~ N(0, I)` (one dimension: `μ = 0.6`, `L = 0.158`, `ε = 1.2` give `z = 0.79`), called elliptical standardization and also known as the reparameterization trick ✅[^5], moves the randomness out of the parameters, so automatic differentiation of a Monte Carlo ELBO gives the gradient; the Gaussian entropy is analytic ✅[^5]. Its gradients have lower variance than BBVI's, and in practice a single sample suffices, while BBVI is more general because it needs no gradient of the model ✅[^5]. Why the trick works, with `rsample()`, is in `machine-learning/generative-models/variational-autoencoders.md`.
3. **Automation.** With ADVI the user supplies only a probabilistic model and a dataset; it is integrated into Stan ✅[^5].

### What VI gets wrong, and when to use it
VI generally under-estimates posterior variance, a consequence of its objective ✅[^1]. On a correlated 2-D Gaussian, mean-field ADVI found the right mean with under-estimated marginal variances, and on logistic regression its means were close to NUTS (No-U-Turn Sampler) while most variances were under-estimated; full-rank ADVI matched better ✅[^5]. Whether that matters depends on the task: several studies found VI's posterior predictive accuracy not necessarily worse ✅[^1]. The review's guidance: MCMC for smaller datasets where precise samples justify a heavier cost; VI for large datasets and for exploring many models quickly ✅[^1].

## Worked example
Bayesian logistic regression on 200 synthetic rows, an intercept plus two features with correlation 0.9, prior `w ~ N(0, 2² I)`. The reference posterior comes from a hand-written HMC sampler (4 chains, 1,000 warm-up and 2,000 kept iterations each, 20 leapfrog steps of 0.1; sampler mechanics in `machine-learning/probabilistic-ml/markov-chain-monte-carlo.md`). Three VI fits in PyTorch maximize a reparameterized ELBO with Adam (8 samples per step, 4,000 steps, learning rate decayed as `(1 + t/100)^(−0.7)`): mean-field, mean-field on minibatches of 20 rows, and full-rank. The KL gap is `log p(y) − ELBO`, with `log p(y)` estimated by importance sampling from the full-rank `q`. The core of a VI step:

```python
w = m + torch.randn(S, 3) @ scale(Lraw, full_rank).T     # w = m + L eps: randomness outside the parameters
entropy = torch.diagonal(Lraw).sum() + 1.5 * math.log(2 * math.pi * math.e)   # H(N(m, LL^T)), analytic
elbo = log_joint(w, rows).mean() + entropy                # Monte Carlo E_q[log p(y, w)] + H(q)
opt.zero_grad(); (-elbo).backward(); opt.step(); sched.step()
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-25, PyTorch 2.15.0, numpy 2.5.5, two runs identical ✅[^6]:

```text
HMC: acceptance 0.933, split R-hat (classic) [1.003 1.    1.   ]
  mean-field    step    0: ELBO estimate  -179.588
  mean-field    step   50: ELBO estimate  -140.532
  mean-field    step  200: ELBO estimate  -136.761
  mean-field    step 1000: ELBO estimate  -133.436
  mean-field    step 3999: ELBO estimate  -133.869
  full-rank     step    0: ELBO estimate  -165.685
  full-rank     step   50: ELBO estimate  -143.487
  full-rank     step  200: ELBO estimate  -134.104
  full-rank     step 1000: ELBO estimate  -134.145
  full-rank     step 3999: ELBO estimate  -133.590
log p(y) ~ -133.462 (importance sampling, 200,000 draws)
method                    mean w0, w1, w2        sd w0, w1, w2      corr(w1,w2)  ELBO     KL gap
HMC (8,000 draws)         [-0.675  0.6   -0.813] [0.155 0.333 0.348]  -0.880
VI mean-field             [-0.673  0.604 -0.798] [0.155 0.158 0.164]   0.000      -134.231   0.768
VI mean-field, batch 20   [-0.673  0.566 -0.805] [0.156 0.159 0.16 ]   0.000      -134.242   0.780
VI full-rank              [-0.661  0.601 -0.816] [0.151 0.338 0.35 ]  -0.883      -133.470   0.008
one-sample dELBO/dm std: reparameterization [6.8 8.6 8.3], score function [866.7 847.2 820.2]
```

<details><summary>Full script (prints the output above)</summary>

```python
# Bayesian logistic regression: reparameterized-gradient VI in PyTorch (mean-field, mean-field on
# minibatches, full-rank) against an HMC posterior from a hand-written sampler.
import math
import numpy as np
import torch

torch.set_default_dtype(torch.float64); torch.set_num_threads(1)
rng = np.random.default_rng(0)
n, tau = 200, 2.0                                     # 200 rows, prior w ~ N(0, tau^2 I)
x1 = rng.standard_normal(n); x2 = 0.9 * x1 + np.sqrt(1 - 0.81) * rng.standard_normal(n)
X = np.column_stack([np.ones(n), x1, x2])            # intercept + two correlated features
y = (rng.uniform(size=n) < 1 / (1 + np.exp(-X @ np.array([-0.5, 1.0, -1.0])))).astype(float)
C = -1.5 * math.log(2 * math.pi * tau**2)            # log normalizer of the prior

def log_joint_np(w):                                  # log p(y | w) + log p(w)
    z = X @ w
    return (y * z - np.logaddexp(0, z)).sum() - 0.5 * (w @ w) / tau**2 + C

def grad_np(w):
    return X.T @ (y - 1 / (1 + np.exp(-X @ w))) - w / tau**2

def hmc(start, n_iter, eps, L, rng):                  # leapfrog HMC, identity mass matrix
    w, out, acc = np.array(start, float), np.empty((n_iter, 3)), 0
    for i in range(n_iter):
        p = rng.standard_normal(3); H0 = -log_joint_np(w) + 0.5 * p @ p
        q = w.copy(); p = p + 0.5 * eps * grad_np(q)
        for j in range(L):
            q = q + eps * p
            if j < L - 1: p = p + eps * grad_np(q)
        p = p + 0.5 * eps * grad_np(q)
        if np.log(rng.uniform()) < H0 - (-log_joint_np(q) + 0.5 * p @ p):
            w, acc = q, acc + 1
        out[i] = w
    return out, acc / n_iter

chains = [hmc(s, 3_000, 0.1, 20, rng) for s in ([-2, -2, -2], [2, 2, 2], [-2, 2, -2], [2, -2, 2])]
draws = np.stack([c[0][1_000:] for c in chains])     # 4 chains x 2,000 kept draws x 3 weights
h = draws.shape[1] // 2; sp = np.concatenate([draws[:, :h], draws[:, h:]])   # split chains
W = sp.var(1, ddof=1).mean(0); B = h * sp.mean(1).var(0, ddof=1)
print(f"HMC: acceptance {np.mean([c[1] for c in chains]):.3f}, "
      f"split R-hat (classic) {np.sqrt(((h - 1) / h * W + B / h) / W).round(3)}")
mc = draws.reshape(-1, 3)

torch.manual_seed(0)
Xt, yt = torch.tensor(X), torch.tensor(y)
def log_joint(w, rows):                               # w: (S, 3); minibatch log-likelihood scaled by n/batch
    z = w @ Xt[rows].T
    lik = (yt[rows] * z - torch.nn.functional.softplus(z)).sum(1) * (n / len(rows))
    return lik - 0.5 * (w**2).sum(1) / tau**2 + C

def scale(Lraw, full_rank):                           # lower-triangular L with a positive diagonal
    return torch.tril(Lraw, -1) * full_rank + torch.diag(torch.exp(torch.diagonal(Lraw)))

def fit_vi(name, full_rank, batch, steps=4_000, S=8):
    m = torch.zeros(3, requires_grad=True); Lraw = torch.zeros(3, 3, requires_grad=True)
    opt = torch.optim.Adam([m, Lraw], lr=0.02)
    sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda t: (1 + t / 100) ** -0.7)  # (t + tau)^-kappa
    for t in range(steps):
        w = m + torch.randn(S, 3) @ scale(Lraw, full_rank).T     # reparameterization: w = m + L eps
        rows = torch.randperm(n)[:batch] if batch < n else torch.arange(n)
        entropy = torch.diagonal(Lraw).sum() + 1.5 * math.log(2 * math.pi * math.e)   # H(N(m, LL^T))
        elbo = log_joint(w, rows).mean() + entropy
        opt.zero_grad(); (-elbo).backward(); opt.step(); sched.step()
        if t in (0, 50, 200, 1_000, 3_999) and batch == n:
            print(f"  {name:13s} step {t:4d}: ELBO estimate {elbo.item():9.3f}")
    with torch.no_grad():
        Ls = scale(Lraw, full_rank); w = m + torch.randn(200_000, 3) @ Ls.T
        logq = (-0.5 * (torch.linalg.solve_triangular(Ls, (w - m).T, upper=False) ** 2).sum(0)
                - torch.diagonal(Lraw).sum() - 1.5 * math.log(2 * math.pi))
        lw = log_joint(w, torch.arange(n)) - logq                  # log p(y, w) - log q(w)
        elbo, log_py = lw.mean().item(), (torch.logsumexp(lw, 0) - math.log(len(lw))).item()
    return m.detach().numpy().copy(), (Ls @ Ls.T).numpy(), elbo, log_py

results = {"HMC (8,000 draws)": (mc.mean(0), np.cov(mc.T), None, None)}
for name, fr, b in [("mean-field", 0, n), ("mean-field, batch 20", 0, 20), ("full-rank", 1, n)]:
    results["VI " + name] = fit_vi(name, fr, b)
log_py = results["VI full-rank"][3]                   # importance-sampled log p(y), full-rank q as proposal
print(f"log p(y) ~ {log_py:.3f} (importance sampling, 200,000 draws)")
print("method                    mean w0, w1, w2        sd w0, w1, w2      corr(w1,w2)  ELBO     KL gap")
for name, (mean, cov, elbo, _) in results.items():
    sd = np.sqrt(np.diag(cov)); gap = "" if elbo is None else f"{elbo:8.3f}  {log_py - elbo:6.3f}"
    print(f"{name:25s} {np.array2string(mean, precision=3):22s} {np.array2string(sd, precision=3):18s}"
          f"  {cov[1, 2] / (sd[1] * sd[2]):6.3f}      {gap}".rstrip())

m0, cov0 = results["VI mean-field"][:2]; s0 = np.sqrt(np.diag(cov0))   # gradient noise at the optimum
eps = rng.standard_normal((10_000, 3)); ws = m0 + s0 * eps
path = np.array([grad_np(w) for w in ws])            # pathwise: d/dm log p(y, m + s*eps)
logq = -0.5 * (eps**2).sum(1) - np.log(s0).sum() - 1.5 * math.log(2 * math.pi)
score = eps / s0 * (np.array([log_joint_np(w) for w in ws]) - logq)[:, None]   # BBVI estimator
print(f"one-sample dELBO/dm std: reparameterization {path.std(0).round(1)}, score function {score.std(0).round(1)}")
```
</details>

Reading it ✅[^6]:
- **The reference is sound:** HMC accepted 93.3 % of trajectories and every split R-hat is at most 1.003.
- **The ELBO rises** from about −180 to about −134 within 1,000 steps. Each printed value is a noisy 8-sample estimate, so it wobbles (−133.436 at step 1,000, −133.869 at step 3,999); the 200,000-sample ELBOs in the table are the reliable ones.
- **Means are close for every method:** the full-batch fits are within 0.015 of HMC on every weight; the minibatch fit's `w1` is 0.034 off (0.566 against 0.600).
- **Mean-field spread is too small where the posterior is correlated:** standard deviations (sd) 0.158 and 0.164 against 0.333 and 0.348, a ratio of 0.47, close to the Gaussian rule `√(1 − 0.88²) = 0.475` from How it works. The intercept, barely correlated with the others, keeps its sd (0.155 against 0.155). Mean-field reports correlation 0.000 by construction; HMC finds −0.880.
- **The KL gap measures the miss:** 0.768 nats (natural-log units) for mean-field against 0.008 for full-rank, whose sds (0.338, 0.350) and correlation (−0.883) match HMC. The `log p(y)` behind both gaps is itself an estimate (importance sampling with the full-rank `q` as proposal), so the gaps are estimates too.
- **Minibatches of 20 rows,** with the likelihood scaled by 10, land on nearly the same mean-field solution (ELBO −134.242 against −134.231).
- **Gradient noise:** at the mean-field optimum, a one-sample score-function gradient of the ELBO with respect to the means has a standard deviation of about 850, against about 8 for the reparameterization gradient, roughly 100 times noisier for the same model. This is the plain estimator, without the Rao-Blackwellization and control variates the BBVI paper adds to reduce that variance ✅[^4].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Strongly correlated posterior, mean-field `q` | Right means, standard deviations shrunk by about `√(1 − ρ²)` for two variables with correlation `ρ` (exactly, for a Gaussian posterior) | Mean-field drops off-diagonal terms ✅[^5]; reverse KL avoids mass where `p` is low ✅[^1]; lab: 0.424 and 0.47 of the truth ✅[^6] |
| Weakly correlated variable | Mean-field spread is fine | Lab intercept: 0.155 vs 0.155 ✅[^6] |
| Several well-separated posterior modes | `q` settles on one mode | Minimizing `KL(q ‖ p)` picks a single mode to avoid mass between modes ✅[^7]; measured in `machine-learning/foundations/information-theory.md` |
| Mixture models | One posterior mode per relabelling of the components | Label permutations ✅[^1]; where Gibbs sampling is not an option, VI may beat a general MCMC method such as HMC even on small data ✅[^1] |
| Different initializations | Different local optima of the ELBO | The ELBO is generally non-convex ✅[^1] |
| ELBO curve wobbles during training | Normal for Monte Carlo ELBO estimates | Lab 8-sample estimates moved by 0.4 nats near convergence ✅[^6] |
| Constant step size | No convergence guarantee for the noisy updates | The guarantee needs `Σ ρ_t = ∞` and `Σ ρ_t² < ∞`, which a constant step violates ✅[^3] |
| Minibatch likelihood not rescaled | `q` is fitted as if the dataset had only `batch` rows, so the prior weighs too much | SVI treats the sample as replicated `N` times ✅[^3]; lab scaled by `n/batch` ✅[^6] |
| Discrete latent variables | No reparameterization gradient; score function still works | BBVI needs no model gradient ✅[^5]; reparameterization needs continuous latents (VAE doc) |
| Constrained parameters (variances, probabilities) | A Gaussian `q` on the raw parameter gives impossible values | ADVI maps them to real coordinates first, adding the log-Jacobian of the map to the objective ✅[^5] |
| ELBO compared across models | Differences mix fit and gap | The gap `KL(q ‖ p)` is invisible without `log p(x)`; lab: 0.768 vs 0.008 nats between two `q` families on the same model ✅[^6] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| CAVI (closed-form coordinate updates) | Each update climbs the ELBO ✅[^1] | Model-specific derivations ✅[^4]; a full data pass per update ✅[^3] |
| SVI (minibatch natural gradients) | Scales to millions of documents ✅[^3] | Conditionally conjugate models ✅[^1]; step-size schedule to tune ✅[^3] |
| BBVI (score-function gradient) | Any model with a computable log joint ✅[^4] | High-variance gradients ✅[^4]; lab: about 100 times noisier without variance reduction ✅[^6] |
| ADVI / reparameterization, mean-field | Low-variance gradients, one sample often enough, automatic ✅[^5] | Needs a differentiable model and continuous latents ✅[^5]; under-estimates correlated variances ✅[^5] |
| ADVI, full-rank Gaussian | Captures correlations; lab KL gap 0.008 ✅[^6] | `K(K+1)/2` scale parameters for `K` variables ✅[^5] |
| MCMC instead | Asymptotically exact samples ✅[^1] | Usually more computation ✅[^1] → `machine-learning/probabilistic-ml/markov-chain-monte-carlo.md` |

## Takeaways
- Trust VI means more than VI spreads; check variances against a short MCMC run before reporting intervals. [rule-candidate]
- A rising ELBO says the fit is improving, not that the gap is small: estimate `log p(x)` or compare with a richer family.
- Prefer reparameterization gradients whenever the latents are continuous and the model is differentiable; keep score-function gradients for discrete latents, with variance reduction.
- With minibatches, scale the likelihood by `N/batch` and decay the step size. [rule-candidate]
- If posterior correlations matter (collinear features, hierarchical scales), use a full-rank or structured family instead of mean-field.

## Verification status
- Verified: 83 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [Variational Inference: A Review for Statisticians](https://arxiv.org/html/1601.00670v9) — Blei, Kucukelbir, McAuliffe, 2017. Backs: posterior as the core computation, the evidence as the obstacle, KL objective and its properties, ELBO definition and its two forms, mean-field family and its limits, structured VI, the CAVI update and its local optimum, relation to Gibbs, non-convexity, SVI as natural-gradient stochastic optimization for conditionally conjugate models, variance under-estimation, MCMC vs VI guidance, mixture modes. [^1]
- [Deep Learning, chapter 19: Approximate Inference](https://www.deeplearningbook.org/contents/inference.html) — Goodfellow, Bengio, Courville, MIT Press, 2016. Backs: inference as optimization, equality of the bound only at the true posterior, ELBO as expected log joint plus entropy, computational reason for `KL(q ‖ p)`, low probability where the posterior is low, the mean-field fixed-point update, Gaussian factors derived rather than assumed. [^2]
- [Stochastic Variational Inference](https://arxiv.org/html/1206.7051v3) — Hoffman, Blei, Wang, Paisley, 2013. Backs: inefficiency of batch coordinate ascent, subsampling with `N` replicates, the weighted-average update, Robbins–Monro conditions, the `(t + τ)^(−κ)` schedule, 3.8 million Wikipedia articles. [^3]
- [Black Box Variational Inference](https://arxiv.org/html/1401.0118v1) — Ranganath, Gerrish, Blei, 2014. Backs: model-specific derivation burden, the score-function gradient of the ELBO and its Monte Carlo estimate, its requirements, its variance and the Rao-Blackwellization and control-variate remedies. [^4]
- [Automatic Differentiation Variational Inference](https://arxiv.org/html/1603.00788v1) — Kucukelbir, Tran, Ranganath, Gelman, Blei, 2016. Backs: transformation to real coordinates and the log-Jacobian term, mean-field and full-rank Gaussian families, elliptical standardization as the reparameterization trick, analytic entropy, lower gradient variance than BBVI and single-sample sufficiency, BBVI's generality, model-and-data-only interface and Stan integration, the 2-D Gaussian and logistic regression accuracy results. [^5]
- `machine-learning/lab-setup.md` — the lab where the CAVI linear-regression run and the logistic-regression comparison of HMC with three VI fits ran on 2026-11-25. [^6]
- [Deep Learning, chapter 3: Probability and Information Theory](https://www.deeplearningbook.org/contents/prob.html) — Goodfellow, Bengio, Courville, MIT Press, 2016. Backs: minimizing `KL(q ‖ p)` on a two-mode target picks a single mode (Figure 3.6). [^7]

## Related
- `machine-learning/generative-models/variational-autoencoders.md` — amortized VI: one encoder network outputs `q` for every data point.
- `machine-learning/foundations/information-theory.md` — KL divergence, its two directions, and the one-mode fit measured.
- `machine-learning/probabilistic-ml/markov-chain-monte-carlo.md` — the sampling alternative that served as the reference here.
- `machine-learning/probabilistic-ml/bayesian-inference.md` — the posterior being approximated, and conjugate cases that need no approximation.
- `machine-learning/unsupervised-learning/gaussian-mixtures-and-em.md` — EM, the coordinate ascent on the same bound when the posterior is exact.
- `machine-learning/probabilistic-ml/probabilistic-graphical-models.md` — model structure that mean-field updates follow, and exact inference where it is tractable.
