---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/evaluation
status: verified
applies-to: ["scikit-learn 1.9.1", "scipy 1.18.1", "Optuna 5.1.0"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, evaluation, hyperparameter-optimization, bayesian-optimization, gaussian-process, surrogate-model, acquisition-function, expected-improvement, upper-confidence-bound, probability-of-improvement, tpe, optuna, multi-fidelity, scikit-learn]
---

# Bayesian optimization: surrogate models and acquisition functions for hyperparameter search

## Summary
**TL;DR:** Bayesian optimization (BO) tunes an expensive black-box function, such as a model's validation score as a function of its hyperparameters, with few evaluations. It fits a surrogate model to the evaluations so far, usually a Gaussian process (GP) that gives a mean and an uncertainty at every untried point, and evaluates next where an acquisition function is highest. Expected improvement (EI) and the upper confidence bound (UCB) both reward a high mean (exploitation) and a high uncertainty (exploration); probability of improvement (PI) leans towards the mean and can get stuck. Unlike grid and random search, BO uses past results, so it spends more of its budget near good settings; whether that beats random search on a given budget depends on how well the surrogate fits the objective. TPE (tree-structured Parzen estimator) replaces the GP with two densities, over good and bad settings, and is the default sampler of Optuna.
**Use this when:** each training run is expensive and you can afford tens to a few hundred evaluations, you choose between grid, random and model-based search, you tune an acquisition function or read an Optuna or BO log, or BO does worse than random search and you need to know why.
**Not this doc:** GP regression itself (kernels, posterior mean and variance, marginal likelihood) → `machine-learning/probabilistic-ml/gaussian-processes.md`; grid search, random search, successive halving and nested cross-validation → `machine-learning/evaluation/cross-validation-and-hyperparameter-search.md`; UCB for multi-armed bandits → `machine-learning/reinforcement-learning/multi-armed-bandits.md`.

## Problem
A hyperparameter setting is scored by training a model and validating it, which takes minutes to hours, so the number of evaluations is limited, typically to a few hundred, and the score gives no gradient ✅[^1]. Grid and random search ignore what earlier evaluations showed: random search does not adapt its sampling distribution, so it is as likely to try a poor setting as a good one ✅[^8]. In the lab's table of 441 settings of an SVM's (support vector machine's) `C` and `gamma` on the digits data, 47 % score below 0.5 accuracy and only 22 % reach 0.95; random search spent 20.1 of its 25 evaluations below 0.95, where BO with a GP modelling `−log(error)` spent 10.8 ✅[^13]. The difficulty is deciding where to look next with a model that can be wrong.

## Mental model
**Analogy:** prospecting for oil with a costly drill. After each well, a geologist redraws the map: an estimated depth to oil everywhere (the surrogate's mean) and how sure she is (its standard deviation), certain next to existing wells and vague far from them. The next well goes where the chance of beating the best well so far, weighted by how much it could beat it, is highest. That spot is either next to the best well (exploit) or in an unmapped valley that could hide a bigger field (explore). Expected improvement is that weighted chance.

**Artifact:** five iterations of GP + EI written by hand, maximizing `f(x) = −(6x − 2)² · sin(12x − 4)` on `[0, 1]` from three starting points `x = 0, 0.5, 1`; printed by the full script in the Worked example; lab run (`machine-learning/lab-setup.md`), 2026-11-25, scikit-learn 1.9.1, scipy 1.18.1 ✅[^13]:

```text
true maximum on the grid: f(0.757) = 6.021
iter  x_next  mean   std    EI     f(x_next)  best so far
   1   0.403  -3.04   5.15  1.162    -0.130    -0.130
   2   0.262  -3.41   5.73  1.011     0.138     0.138
   3   0.153  -1.72   4.56  1.040     0.971     0.971
   4   0.687  -3.06   5.68  0.798     4.018     4.018
   5   0.752   2.45   3.40  0.714     6.006     6.006
```

In all five iterations the chosen point's predicted mean is below the best value found so far; EI picks it for its spread (standard deviations 3.40 to 5.73). Five evaluations reach 6.006 against a true maximum of 6.021.

## How it works
### The loop
Frazier's Algorithm 1 ✅[^1]:
1. Place a GP prior on the objective `f`.
2. Evaluate `f` at `n₀` points of an initial space-filling design, often chosen uniformly at random.
3. Update the posterior on `f` with all evaluations so far.
4. Evaluate next at a maximizer of the acquisition function computed from that posterior. Expected improvement, unlike the objective, is cheap to evaluate and has derivatives, so it can be maximized with a quasi-Newton method such as L-BFGS-B (limited-memory Broyden–Fletcher–Goldfarb–Shanno with bounds) ✅[^1]; the lab instead takes the best of a dense set of candidates.
5. Repeat 3–4 until the budget of `N` evaluations is used; return the best evaluated point or the point with the largest posterior mean.

BO suits continuous inputs of not too many dimensions, typically `d ≤ 20` in its successful applications ✅[^1].

### The surrogate
The GP gives, at each candidate `x`, a normal posterior with mean `μ(x)` and standard deviation `σ(x)`, which interpolates the evaluated points and widens away from them ✅[^1]; how it is computed: `machine-learning/probabilistic-ml/gaussian-processes.md`. Choices specific to BO:
- **Kernel:** Snoek et al. find the squared exponential (RBF, radial basis function) kernel's sample functions unrealistically smooth for practical problems and use the Matérn 5/2 kernel, whose sample functions are twice differentiable ✅[^2].
- **Its hyperparameters:** with `D` inputs there are typically `D + 3` GP hyperparameters: `D` length-scales, an amplitude, the observation noise and a constant mean ✅[^2]. They can be point estimates (maximum likelihood, or MAP (maximum a posteriori) with a prior that keeps length-scales reasonable) or integrated out by sampling, which Snoek et al. do with slice sampling to get an integrated acquisition function ✅[^1] ✅[^2].
- **In scikit-learn:** `GaussianProcessRegressor` defaults to `ConstantKernel() * RBF()`, `alpha=1e-10`, `normalize_y=False` and `n_restarts_optimizer=0`, fitting the kernel with L-BFGS-B ✅[^12]; the lab passes a Matérn 5/2 plus a `WhiteKernel` noise term and `normalize_y=True` ✅[^13].

### Acquisition functions
Write `f*` for the best value observed so far, `Δ(x) = μ(x) − f*`, `z = Δ(x) / σ(x)`, `Φ` the standard normal cumulative distribution function and `φ` its density; all three below are written for maximization (Snoek et al. write them for minimization). Example point: `μ = 1.2`, `σ = 0.5`, `f* = 1.0`, so `Δ = 0.2`, `z = 0.4`.
1. **Probability of improvement:** `PI(x) = Φ(z)`, after Kushner (1964) ✅[^2]. Example: `Φ(0.4) = 0.655`. It counts how likely an improvement is, not how large, and inclines towards exploitation ✅[^5].
2. **Expected improvement:** `EI(x) = E[max(f(x) − f*, 0)]`, the expected amount by which `f(x)` beats `f*` ✅[^1], with the closed form `Δ · Φ(z) + σ · φ(z)` under the GP (Snoek et al.'s equation 2) ✅[^2]. Example: `0.2 × 0.6554 + 0.5 × 0.3683 = 0.1311 + 0.1841 = 0.3152`; a Monte Carlo estimate from 1,000,000 normal draws gives 0.3157 ✅[^13]. EI grows with both `Δ` and `σ`, which is how it trades exploitation against exploration, and with noise-free evaluations it is 0 at points already evaluated ✅[^1]. Močkus proposed it in 1975 and Jones et al. popularized it in 1998 as EGO (efficient global optimization) ✅[^1]. Snoek et al. prefer it because it behaves better than PI and, unlike UCB, needs no tuning parameter ✅[^2].
3. **Upper confidence bound:** `UCB(x) = μ(x) + κ · σ(x)`, with `κ` a tunable weight on exploration (Snoek et al. write the minimizing form `μ − κσ`) ✅[^2]. Example with `κ = 2`: `1.2 + 2 × 0.5 = 2.2`. Srinivas et al. cast GP optimization as a multi-armed bandit and bound GP-UCB's cumulative regret ✅[^3]; the bandit version: `machine-learning/reinforcement-learning/multi-armed-bandits.md`.
4. **Others, in outline:** the knowledge gradient values an evaluation by how much it would raise the maximum of the posterior mean; entropy search and predictive entropy search value the information it gives about the location of the global maximum ✅[^1].

### Against grid and random search, same budget
Lab run (`machine-learning/lab-setup.md`), 2026-11-25, scikit-learn 1.9.1, two runs identical. Every searcher picks from the same table: an RBF `SVC` (support vector classifier) scored by 3-fold cross-validation accuracy on `load_digits`, at 21 × 21 values of `log10 C` in `[−2, 4]` and `log10 gamma` in `[−6, 0]`. Random search and BO get 25 evaluations over 10 seeds; BO starts from random search's first 5 points, then fits a GP (Matérn 5/2 plus noise, refitted each step) to either the accuracy or `−log(1 − accuracy)` and takes the EI maximizer. The two grids are 5 × 5: every fifth table value, and a second one starting one table step later with steps of four ✅[^13]:

```text
table: 441 settings, best accuracy 0.9761 at log10 C=0.4, log10 gamma=-3.0; 22% of settings >= 0.95, 47% below 0.5
accuracy along log10 gamma -6.0 ... 0.0 at log10 C = 1.0: 0.88 0.91 0.92 0.94 0.95 0.95 0.95 0.96 0.97 0.97 0.98 0.97 0.92 0.75 0.45 0.15 0.10 0.10 0.10 0.10 0.14
best accuracy after n evaluations (mean of 10 seeds), n = [5, 10, 15, 20, 25] | evaluations >= 0.95 | seeds reaching the best
random search          0.9612 0.9696 0.9716 0.9723 0.9742 |  4.9 of 25 | 7/10
BO, GP on accuracy     0.9612 0.9659 0.9697 0.9699 0.9726 | 10.3 of 25 | 6/10
BO, GP on -log(error)  0.9612 0.9686 0.9747 0.9761 0.9761 | 14.2 of 25 | 10/10
grid, every 5th value  after all 25: 0.9761 |    5 of 25 | gamma values -6.0 -4.5 -3.0 -1.5 0.0
grid, shifted by one   after all 25: 0.9727 |    6 of 25 | gamma values -5.7 -4.5 -3.3 -2.1 -0.9
```

- **BO concentrates.** Both BO variants spend two to three times as many evaluations above 0.95 accuracy as random search (10.3 and 14.2 of 25 against 4.9).
- **The surrogate decides.** Modelling `−log(error)`, BO reaches the table's best accuracy in all 10 seeds by 20 evaluations. Modelling raw accuracy, whose surface falls from 0.98 to 0.15 over five steps of `log10 gamma` (second line of the output), it ends slightly below random search (0.9726 against 0.9742).
- **A grid is a bet on alignment.** The grid that happens to contain `gamma = 10⁻³` ties the best; the shifted one misses it (0.9727). The margins here are a few thousandths because 22 % of the table is already above 0.95. In the 50-seed comparison of Dive into Deep Learning (d2l) on a feed-forward network, BO and random search are roughly level at first and BO pulls ahead later ✅[^9]; the `−log(error)` variant here does the same (0.9686 against 0.9696 at 10 evaluations, ahead from 15).

<details><summary>Full script (prints the output above)</summary>

```python
# Bayesian optimization (GP + expected improvement) against random search and 5x5 grids, 25 evaluations
# each, for an RBF SVM's C and gamma on the digits data (3-fold CV accuracy); random and BO over 10 seeds.
import warnings
import numpy as np
from scipy.stats import norm
from sklearn.datasets import load_digits
from sklearn.exceptions import ConvergenceWarning
from sklearn.gaussian_process import GaussianProcessRegressor
from sklearn.gaussian_process.kernels import ConstantKernel, Matern, WhiteKernel
from sklearn.model_selection import cross_val_score
from sklearn.svm import SVC
warnings.filterwarnings("ignore", category=ConvergenceWarning)

X, y = load_digits(return_X_y=True)
logC = np.linspace(-2, 4, 21)                    # log10 C in [-2, 4], steps of 0.3
logG = np.linspace(-6, 0, 21)                    # log10 gamma in [-6, 0]
pts = np.array([(c, g) for c in logC for g in logG])            # 441 candidate settings
score = np.array([cross_val_score(SVC(C=10 ** c, gamma=10 ** g), X, y, cv=3).mean() for c, g in pts])
U = (pts - pts.min(0)) / (pts.max(0) - pts.min(0))              # GP inputs scaled to [0, 1]^2
BUDGET, N_INIT, CHECK = 25, 5, [5, 10, 15, 20, 25]
best = score.max()
print(f"table: 441 settings, best accuracy {best:.4f} at log10 C={pts[score.argmax()][0]:.1f}, log10 gamma="
      f"{pts[score.argmax()][1]:.1f}; {(score >= 0.95).mean():.0%} of settings >= 0.95, "
      f"{(score < 0.5).mean():.0%} below 0.5")

print("accuracy along log10 gamma -6.0 ... 0.0 at log10 C = 1.0:", " ".join(f"{v:.2f}" for v in score.reshape(21, 21)[10]))

def ei(mu, sd, incumbent):
    z = (mu - incumbent) / sd
    return (mu - incumbent) * norm.cdf(z) + sd * norm.pdf(z)

def bayes_opt(seed, target):                     # target: the values the GP models (higher = better)
    seen = list(np.random.default_rng(seed).choice(len(pts), BUDGET, replace=False)[:N_INIT])
    while len(seen) < BUDGET:
        kernel = (ConstantKernel(1.0) * Matern([0.3, 0.3], length_scale_bounds=(0.05, 5), nu=2.5)
                  + WhiteKernel(1e-3, noise_level_bounds=(1e-6, 1e-1)))
        gp = GaussianProcessRegressor(kernel, normalize_y=True, n_restarts_optimizer=3, random_state=seed)
        gp.fit(U[seen], target[seen])
        rest = np.setdiff1d(np.arange(len(pts)), seen)
        mu, sd = gp.predict(U[rest], return_std=True)
        seen.append(rest[int(np.argmax(ei(mu, np.maximum(sd, 1e-9), target[seen].max())))])
    return np.array(seen)

runs = {"random search": [np.random.default_rng(s).choice(len(pts), BUDGET, replace=False) for s in range(10)],
        "BO, GP on accuracy": [bayes_opt(s, score) for s in range(10)],
        "BO, GP on -log(error)": [bayes_opt(s, -np.log(1 - score)) for s in range(10)]}
print("best accuracy after n evaluations (mean of 10 seeds), n =", CHECK, "| evaluations >= 0.95 | seeds reaching the best")
for name, idx in runs.items():
    curve = np.array([np.maximum.accumulate(score[i]) for i in idx])
    good = np.mean([(score[i] >= 0.95).sum() for i in idx])
    print(f"{name:<22}", " ".join(f"{curve[:, n - 1].mean():.4f}" for n in CHECK),
          f"| {good:4.1f} of 25 | {(curve[:, -1] == best).sum()}/10")
for name, sl in [("grid, every 5th value", slice(0, None, 5)), ("grid, shifted by one", slice(1, None, 4))]:
    gi = [i for i, (c, g) in enumerate(pts) if c in logC[sl] and g in logG[sl]]
    print(f"{name:<22} after all 25: {score[gi].max():.4f} | {(score[gi] >= 0.95).sum():4d} of 25 | "
          f"gamma values {' '.join(f'{v:.1f}' for v in logG[sl])}")
```

</details>

### TPE (tree-structured Parzen estimator), in outline
Bergstra et al. introduced two sequential methods based on expected improvement for tuning neural networks and deep belief networks; TPE is the one built on density estimates ✅[^4] ✅[^11]. Instead of modelling the score `y` given a setting `x`, it models settings given the score ✅[^5]:
1. Sort the `N` evaluations and split them at the top `γ` quantile into a better group of `⌈γN⌉` evaluations and a worse group ✅[^5]. Example: `γ = 0.2` and `N = 30` give 6 good evaluations and 24 bad ones.
2. Fit a Parzen estimator (kernel density estimate) to each group: `l(x)` to the settings of the better group, `g(x)` to the rest ✅[^5].
3. Draw candidates from `l(x)` and evaluate the one with the largest ratio `l(x) / g(x)` ✅[^5]. Bergstra et al. showed that maximizing this ratio is equivalent to maximizing EI ✅[^11], and Watanabe notes that in this formulation it is also equivalent in ranking to PI, so TPE tends to search locally ✅[^5]. Example: a candidate with `l = 0.8`, `g = 0.2` (ratio 4) beats one with `l = 0.5`, `g = 0.5` (ratio 1).
4. "Tree-structured" means the search space may contain conditional parameters, such as the dropout rate of a third layer that exists only when the network has three layers ✅[^5].

`optuna.create_study` uses `TPESampler` when no sampler is given ✅[^14]. In it, one Gaussian mixture `l(x)` is fitted per parameter to the values of the best trials and another, `g(x)`, to the rest, and the value maximizing `l(x)/g(x)` is chosen ✅[^6]. Its signature in the Optuna 5.1.0 docs, read on 2026-11-25, has `n_startup_trials=10` (random sampling until that many trials finish), `n_ei_candidates=24`, `multivariate=None` and `constant_liar=True`; `multivariate=None` resolves to `True` for single-objective studies ✅[^6]. Optuna's sampler table gives TPE a per-trial cost of `O(d·n·log n)` and a recommended budget of 100–1000 trials, against `O(n³)` and up to 500 trials for its GP sampler, where `d` is the number of dimensions and `n` the number of finished trials ✅[^7]. Model construction in TPE scales linearly in the number of data points, against the cubic cost of GPs ✅[^11].

### Noise, parallel suggestions, costs and fidelities
- **Noisy scores:** training is stochastic, so the observed score is `y = f(x) + ε`, with the noise `ε` usually assumed Gaussian ✅[^8] ✅[^11]. A GP handles independent Gaussian noise by adding its variance to the diagonal, usually as a hyperparameter shared by all points ✅[^1]. EI is no longer well defined because `f(x)` is never observed exactly; common heuristics replace `f*` with the largest posterior mean at the evaluated points, and with substantial noise the knowledge gradient can outperform EI substantially ✅[^1].
- **Parallel suggestions:** running the same acquisition again while evaluations are pending would repeat a pending experiment ✅[^2]. Remedies: multipoint EI over a set of `q` points, the constant liar heuristic, which pretends each pending point has already returned a constant value ✅[^1], and Snoek et al.'s Monte Carlo average of EI over "fantasized" outcomes of the pending points ✅[^2]. Optuna's `constant_liar` penalizes running trials so that nearby settings are not suggested ✅[^6].
- **Uneven costs:** settings can differ greatly in training time, so Snoek et al. maximize EI per second, with a second GP modelling the log of the duration ✅[^2].
- **Multi-fidelity:** cheaper approximations of the objective (fewer epochs, a training subset, fewer cross-validation folds) can screen settings before full evaluation ✅[^10]. Applying EI directly to a low-fidelity observation gives 0, because such an observation never improves the best full-fidelity value, so methods pick the fidelity separately or use knowledge gradient or entropy search ✅[^1]. Successive halving and Hyperband allocate the fidelities to randomly drawn settings ✅[^11] (how: `machine-learning/evaluation/cross-validation-and-hyperparameter-search.md`); BOHB, which combines Bayesian optimization with Hyperband, keeps Hyperband's budgets and replaces its random sampling with a TPE-like model ✅[^11].

## Worked example
GP + EI written by hand in numpy, end to end: the GP has a fixed RBF kernel (amplitude 1, length-scale 0.1) on standardized targets and is checked against scikit-learn on 1,001 grid points; EI in closed form is checked against Monte Carlo, both with `Δ > 0` and `Δ < 0`; then five EI iterations from `x = 0, 0.5, 1` (the Mental model artifact), and ten iterations each of EI, PI and UCB from the same start. The acquisition is maximized over the 1,001-point grid. Core lines:

```python
mu, sd = gp_posterior(xo, f(xo), grid)                 # GP mean and std at every candidate
d = mu - f(xo).max()                                   # Δ = μ − f*
a = d * norm.cdf(d / sd) + sd * norm.pdf(d / sd)       # expected improvement
xo = np.append(xo, grid[a.argmax()])                   # evaluate where EI is largest
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-25, scikit-learn 1.9.1, scipy 1.18.1, two runs identical; lines 4–10 are the Mental model artifact ✅[^13]:

```text
GP by hand vs scikit-learn on 1001 points: max |mean diff| 1.1e-14, max |std diff| 2.4e-14
mu=1.2 sd=0.5 best=1.0: EI closed form 0.3152  Monte Carlo 0.3157  with Phi(d/sd) in the last term 0.2531  with Phi(-|d|/sd) 0.3152
mu=0.7 sd=0.5 best=1.0: EI closed form 0.0843  Monte Carlo 0.0842  with Phi(d/sd) in the last term 0.0843  with Phi(-|d|/sd) 0.0843
true maximum on the grid: f(0.757) = 6.021
iter  x_next  mean   std    EI     f(x_next)  best so far
   1   0.403  -3.04   5.15  1.162    -0.130    -0.130
   2   0.262  -3.41   5.73  1.011     0.138     0.138
   3   0.153  -1.72   4.56  1.040     0.971     0.971
   4   0.687  -3.06   5.68  0.798     4.018     4.018
   5   0.752   2.45   3.40  0.714     6.006     6.006
PI's first pick: x=0.500  mean - best -5.7e-06  std 0.0066  PI 0.4997  largest mean - best on the grid -5.7e-06
== 10 iterations from the same 3 points: where each acquisition samples ==
EI         best  6.021  x sampled: 0.40 0.26 0.15 0.69 0.75 0.80 0.76 0.76 0.76 0.76
PI         best -0.909  x sampled: 0.50 0.50 0.50 0.50 0.50 0.50 0.50 0.50 0.50 0.50
UCB k=0.5  best  0.986  x sampled: 0.45 0.39 0.30 0.21 0.15 0.16 0.14 0.14 0.14 0.14
UCB k=2    best  6.021  x sampled: 0.36 0.20 0.68 0.78 0.74 0.11 0.76 0.76 0.76 0.76
UCB k=5    best  6.020  x sampled: 0.31 0.70 0.16 0.82 0.60 0.40 0.76 0.08 0.74 0.76
```

<details><summary>Full script (prints the output above)</summary>

```python
# Bayesian optimization by hand on a 1-D function: GP posterior (checked against scikit-learn),
# expected improvement in closed form (checked against Monte Carlo), five iterations, then EI vs PI vs UCB.
import numpy as np
from scipy.stats import norm
from sklearn.gaussian_process import GaussianProcessRegressor
from sklearn.gaussian_process.kernels import RBF, ConstantKernel

def f(x):                                        # objective to MAXIMIZE on [0, 1]
    return -(6 * x - 2) ** 2 * np.sin(12 * x - 4)
grid = np.linspace(0, 1, 1001)                   # candidate points for the acquisition
ELL, JITTER = 0.1, 1e-6                          # fixed RBF length-scale; diagonal jitter

def rbf(a, b):
    return np.exp(-(a[:, None] - b[None, :]) ** 2 / (2 * ELL ** 2))

def gp_posterior(xo, yo, xs):                    # zero-mean GP on standardized y, amplitude 1
    m, s = yo.mean(), yo.std()
    L = np.linalg.cholesky(rbf(xo, xo) + JITTER * np.eye(len(xo)))
    alpha = np.linalg.solve(L.T, np.linalg.solve(L, (yo - m) / s))
    Ks = rbf(xs, xo)
    v = np.linalg.solve(L, Ks.T)
    var = np.clip(1 - (v ** 2).sum(axis=0), 0, None)
    return m + s * Ks @ alpha, s * np.sqrt(var)

def ei(mu, sd, best):                            # E[max(f - best, 0)] for f ~ N(mu, sd^2)
    d = mu - best
    z = d / np.maximum(sd, 1e-12)
    return np.where(sd > 1e-12, d * norm.cdf(z) + sd * norm.pdf(z), np.maximum(d, 0))

def acquisition(name, mu, sd, best):
    if name == "EI":
        return ei(mu, sd, best)
    if name == "PI":
        return norm.cdf((mu - best) / np.maximum(sd, 1e-12))
    return mu + float(name.split("=")[1]) * sd   # "UCB k=<kappa>"

x0 = np.array([0.0, 0.5, 1.0])                   # initial design: both ends and the middle
mu, sd = gp_posterior(x0, f(x0), grid)
sk = GaussianProcessRegressor(ConstantKernel(1.0, "fixed") * RBF(ELL, "fixed"), alpha=JITTER,
                              normalize_y=True, optimizer=None).fit(x0[:, None], f(x0))
mu_sk, sd_sk = sk.predict(grid[:, None], return_std=True)
print(f"GP by hand vs scikit-learn on 1001 points: max |mean diff| {np.abs(mu - mu_sk).max():.1e}, "
      f"max |std diff| {np.abs(sd - sd_sk).max():.1e}")

rng = np.random.default_rng(0)
for m_, s_, b_ in [(1.2, 0.5, 1.0), (0.7, 0.5, 1.0)]:
    d = m_ - b_
    mc = np.maximum(rng.normal(m_, s_, 1_000_000) - b_, 0).mean()
    printed = max(d, 0) + s_ * norm.pdf(d / s_) - abs(d) * norm.cdf(d / s_)
    print(f"mu={m_} sd={s_} best={b_}: EI closed form {float(ei(m_, s_, b_)):.4f}  Monte Carlo {mc:.4f}"
          f"  with Phi(d/sd) in the last term {printed:.4f}  with Phi(-|d|/sd) "
          f"{max(d, 0) + s_ * norm.pdf(d / s_) - abs(d) * norm.cdf(-abs(d) / s_):.4f}")

print(f"true maximum on the grid: f({grid[f(grid).argmax()]:.3f}) = {f(grid).max():.3f}")
xo = x0.copy()
print("iter  x_next  mean   std    EI     f(x_next)  best so far")
for it in range(1, 6):
    yo = f(xo)
    mu, sd = gp_posterior(xo, yo, grid)
    a = ei(mu, sd, yo.max())
    i = int(a.argmax())
    xo = np.append(xo, grid[i])
    print(f"{it:4d}  {grid[i]:6.3f}  {mu[i]:5.2f}  {sd[i]:5.2f}  {a[i]:5.3f}  {f(grid[i]):8.3f}  {f(xo).max():8.3f}")

mu, sd = gp_posterior(x0, f(x0), grid)
i = int(acquisition("PI", mu, sd, f(x0).max()).argmax())
print(f"PI's first pick: x={grid[i]:.3f}  mean - best {mu[i] - f(x0).max():.1e}  std {sd[i]:.4f}  "
      f"PI {acquisition('PI', mu, sd, f(x0).max())[i]:.4f}  largest mean - best on the grid {(mu - f(x0).max()).max():.1e}")
print("== 10 iterations from the same 3 points: where each acquisition samples ==")
for name in ["EI", "PI", "UCB k=0.5", "UCB k=2", "UCB k=5"]:
    xo = x0.copy()
    for it in range(10):
        mu, sd = gp_posterior(xo, f(xo), grid)
        xo = np.append(xo, grid[int(acquisition(name, mu, sd, f(xo).max()).argmax())])
    print(f"{name:<10} best {f(xo).max():6.3f}  x sampled: {' '.join(f'{v:.2f}' for v in xo[3:])}")
```

</details>

Reading it:
- **The GP is right.** The hand-written posterior matches scikit-learn's to `1e-14`, so the rest of the run is the textbook algorithm, not a bug.
- **The EI formula is right in its standard form.** For `Δ = +0.2` the closed form gives 0.3152 and Monte Carlo 0.3157. Frazier's tutorial (arXiv v1, equation 8) writes EI as `[Δ]⁺ + σ·φ(Δ/σ) − |Δ|·Φ(Δ/σ)` ✅[^1]; that expression gives 0.2531 at `Δ = +0.2` and agrees at `Δ = −0.3` (0.0843), and with `Φ(−|Δ|/σ)` in the last term it equals the standard form at both points ✅[^13]. For `Δ ≤ 0`, `−|Δ|/σ = Δ/σ`, so the two only differ when the mean is above the incumbent; there, `Δ − Δ·Φ(−z) = Δ·Φ(z)` gives back the standard form, while `Δ − Δ·Φ(z) = Δ·Φ(−z)` does not.
- **Explore, then exploit.** The starting points' best is `f(0.5) = −0.909`. EI first explores left of it (0.403, 0.262, 0.153, finding the local maximum near 0.15), then jumps into the unexplored right half (0.687) and climbs to 6.006 at 0.752; later iterations sit on the optimum.
- **The acquisition decides where the budget goes.** PI re-evaluates `x = 0.50`, the incumbent, ten times: there the mean sits `5.7e-06` below `f*` with a standard deviation of 0.0066, so PI is 0.4997, about `Φ(0) = 0.5`; no grid point has a mean above `f*`, so no point's PI reaches 0.5, and this one has the largest. UCB with `κ = 0.5` exploits the local maximum at 0.14 (best 0.986) and never finds the global one; `κ = 2` moves into the right half at its third sample (0.68) and ends at 6.021; `κ = 5` samples all over `[0.08, 0.82]` and still finds 6.020.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| PI with no margin | Re-evaluates the incumbent every time (lab: `x = 0.50` ten times, best stuck at −0.909) | PI counts the chance, not the size, of an improvement and inclines to exploit ✅[^5]; EI behaves better ✅[^2]; lab ✅[^13] |
| UCB with a small `κ` | Locks onto a local optimum (lab, `κ = 0.5`: 0.986 at `x = 0.14` against the global 6.021) | `κ` sets the balance between exploitation and exploration ✅[^2]; lab ✅[^13] |
| EI at an already evaluated point, no noise | 0 | Re-evaluating gives no new information; posterior standard deviation is 0 and the mean at most `f*` ✅[^1] |
| Implementing EI from Frazier's tutorial v1, equation 8 | Wrong value when the mean is above the incumbent (lab, `Δ = +0.2`: 0.2531 against 0.3152) | The last term needs `Φ(−|Δ|/σ)`; lab check against Monte Carlo ✅[^13] |
| Noisy objective | "Improvement" over `f*` is ill-defined | `f(x)` is not observed; use the best posterior mean at evaluated points, or knowledge gradient ✅[^1] |
| Objective with a cliff (lab: accuracy falls from 0.98 to 0.15 over 1.5 decades of `gamma`) | GP on raw accuracy: BO ended below random search (0.9726 against 0.9742); GP on `−log(error)`: table best in all 10 seeds | The surrogate must fit the surface; lab ✅[^13] |
| Grid that happens to contain the optimum | Looks as good as BO (lab: 0.9761); a shifted grid gives 0.9727 | Lab ✅[^13]; why grids lose when few parameters matter → `machine-learning/evaluation/cross-validation-and-hyperparameter-search.md` |
| More than about 20 dimensions | Few successful applications | Typical successful BO has `d ≤ 20` ✅[^1] |
| Conditional hyperparameters (layer 3 exists only with 3 layers) | A fixed-length GP input does not fit | TPE handles tree-structured spaces ✅[^5] |
| Several workers ask for suggestions at once | Repeated suggestions | The same acquisition picks the same point; handle pending points (fantasies, constant liar) ✅[^2] ✅[^1] |
| Settings with very different training times | Budget spent on slow settings | Optimize EI per second ✅[^2] |
| GP hyperparameters by maximum likelihood | Sometimes unreasonable values: a function that varies too quickly or too slowly | A MAP prior that favours reasonable values helps ✅[^1] |
| Hundreds to thousands of trials | GP step cost grows as `n³` | Optuna: GP sampler `O(n³)` per trial, TPE `O(d·n·log n)` ✅[^7] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Grid search | Simple; Cartesian product of fixed values ✅[^8] | Evaluates a fixed set whatever the results; random search can be far more efficient when a few hyperparameters matter most ✅[^8] |
| Random search | Any space with a distribution per parameter; trials run in parallel ✅[^8] | Does not adapt; same resources for every setting ✅[^8]; lab: 4.9 of 25 evaluations above 0.95 ✅[^13] |
| GP-based BO (EI) | Uses every past result; no tuning parameter in EI ✅[^2]; lab: 14.2 of 25 above 0.95 ✅[^13] | `O(n³)` per step ✅[^7]; a few hundred evaluations, `d ≤ 20` ✅[^1]; sensitive to surrogate fit (lab) ✅[^13] |
| GP-based BO (UCB) | Regret bounds ✅[^3] | `κ` to tune ✅[^2]; lab: `κ = 0.5` stuck ✅[^13] |
| TPE | Mixed and conditional spaces; model cost linear in data ✅[^11] ✅[^5] | Tends to search locally ✅[^5] |
| Successive halving, Hyperband | Strong performance at small and medium total budgets ✅[^11] | Random configurations limit convergence at large budgets ✅[^11] |
| BOHB | Hyperband's anytime speed plus model-based sampling ✅[^11] | Needs a cheap budget parameter (epochs, data size) that defines the fidelities ✅[^11] |

## Takeaways
- Use BO when one evaluation costs minutes or more and you can afford tens to a few hundred; for cheap evaluations, random search with more trials is simpler. [rule-candidate]
- Prefer EI, or UCB with a moderate `κ` (2 worked in the lab, 0.5 got stuck), over plain PI; PI without a margin re-samples the incumbent.
- Model a transformed score (for example `−log(error)`) when the raw score has plateaus or cliffs, and compare against random search on the same budget and seeds before trusting BO. [rule-candidate]
- Search in log space for scale parameters such as `C`, `gamma` and learning rates, and do not trust a grid's result to its alignment.
- With parallel workers, use an implementation that accounts for pending trials (constant liar, fantasies).

## Verification status
- Verified: 94 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [A Tutorial on Bayesian Optimization](https://arxiv.org/html/1807.02811v1) — Peter I. Frazier, 2018. Backs: problem characteristics (`d ≤ 20`, a few hundred evaluations, derivative-free), Algorithm 1, GP posterior widening away from data, L-BFGS-B for the acquisition, EI definition, equation 8 as printed, EI increasing in `Δ` and `σ` and 0 at evaluated points, Močkus and Jones et al., knowledge gradient and entropy search, MLE/MAP/fully Bayesian hyperparameters, noisy, parallel (multipoint EI, constant liar) and multi-fidelity extensions. [^1]
- [Practical Bayesian Optimization of Machine Learning Algorithms](https://arxiv.org/html/1206.2944v2) — Snoek, Larochelle, Adams, 2012. Backs: PI (Kushner), EI closed form, GP-UCB/LCB with `κ`, EI preferred over PI and needs no tuning parameter, Matérn 5/2 over squared exponential, `D + 3` GP hyperparameters, slice sampling and integrated acquisition, EI per second, pending evaluations and fantasies. [^2]
- [Gaussian Process Optimization in the Bandit Setting: No Regret and Experimental Design](https://arxiv.org/abs/0912.3995) — Srinivas, Krause, Kakade, Seeger, 2010 (abstract). Backs: GP optimization as a multi-armed bandit, regret bounds for GP-UCB. [^3]
- [Algorithms for Hyper-Parameter Optimization](https://proceedings.neurips.cc/paper_files/paper/2011/hash/86e8f7ab32cfd12577bc2619bc635690-Abstract.html) — Bergstra, Bardenet, Bengio, Kégl, NeurIPS 2011 (abstract). Backs: two sequential methods based on expected improvement for neural networks and deep belief networks. [^4]
- [Tree-Structured Parzen Estimator: Understanding Its Algorithm Components and Their Roles for Better Empirical Performance](https://arxiv.org/html/2304.11127v3) — Shuhei Watanabe, 2023. Backs: TPE's split at the top `γ` quantile, `⌈γN⌉`, KDEs for better and worse groups, the density-ratio acquisition, PI inclines to exploit and TPE's equivalence to PI (local search), conditional parameters. [^5]
- [optuna.samplers.TPESampler](https://optuna.readthedocs.io/en/stable/reference/samplers/generated/optuna.samplers.TPESampler.html) — Optuna developers, living (Optuna 5.1.0 docs, read 2026-11-25). Backs: one GMM (Gaussian mixture model) `l(x)` and `g(x)` per parameter and the ratio, signature defaults `n_startup_trials=10`, `n_ei_candidates=24`, `multivariate=None` and its resolution, `constant_liar=True` and what it does. [^6]
- [optuna.samplers](https://optuna.readthedocs.io/en/stable/reference/samplers/index.html) — Optuna developers, living (read 2026-11-25). Backs: per-trial time complexity and recommended budgets of TPESampler and GPSampler. [^7]
- [19.1 What Is Hyperparameter Optimization? (Dive into Deep Learning)](https://d2l.ai/chapter_hyperparameter-optimization/hyperopt-intro.html) — Zhang, Lipton, Li, Smola, living. Backs: noisy observations, random search does not adapt and spends the same resources on every configuration, runs in parallel, grid search as a Cartesian product, random search more efficient when a few hyperparameters matter. [^8]
- [19.2 Hyperparameter Optimization API (Dive into Deep Learning)](https://d2l.ai/chapter_hyperparameter-optimization/hyperopt-api.html) — Zhang, Lipton, Li, Smola, living. Backs: BO and random search level at first, BO ahead later, in d2l's 50-seed comparison. [^9]
- [19.4 Multi-Fidelity Hyperparameter Optimization (Dive into Deep Learning)](https://d2l.ai/chapter_hyperparameter-optimization/sh-intro.html) — Zhang, Lipton, Li, Smola, living. Backs: resources as epochs, training-subset size or number of folds. [^10]
- [BOHB: Robust and Efficient Hyperparameter Optimization at Scale](https://arxiv.org/html/1807.01774v1) — Falkner, Klein, Hutter, 2018. Backs: noisy observations, TPE models good and bad densities and the ratio is equivalent to EI (Bergstra et al.), linear model construction against cubic GPs, mixed spaces, Hyperband's strengths and limits, BOHB replaces Hyperband's random sampling. [^11]
- [sklearn.gaussian_process.GaussianProcessRegressor](https://scikit-learn.org/stable/modules/generated/sklearn.gaussian_process.GaussianProcessRegressor.html) — scikit-learn developers, living (1.9.1). Backs: default kernel, `alpha`, `normalize_y`, `n_restarts_optimizer`, L-BFGS-B optimizer. [^12]
- [optuna.create_study](https://optuna.readthedocs.io/en/stable/reference/generated/optuna.create_study.html) — Optuna developers, living (read 2026-11-25). Backs: `TPESampler` is the default sampler. [^14]
- `machine-learning/lab-setup.md` — the lab where the hand-written GP and EI, the Monte Carlo check, the five iterations, the EI/PI/UCB comparison and the SVM search comparison ran on 2026-11-25. [^13]

## Related
- `machine-learning/probabilistic-ml/gaussian-processes.md` — the surrogate: posterior mean and variance, kernels, marginal likelihood.
- `machine-learning/evaluation/cross-validation-and-hyperparameter-search.md` — the score BO optimizes, and grid, random and successive-halving search.
- `machine-learning/reinforcement-learning/multi-armed-bandits.md` — UCB and the exploration–exploitation trade-off in bandits.
- `machine-learning/unsupervised-learning/active-learning.md` — the same pick-the-most-informative-query loop, for labels.
- `machine-learning/supervised-learning/support-vector-machines.md` — what `C` and `gamma` do in the lab's search.
- `machine-learning/probabilistic-ml/bayesian-inference.md` — priors, posteriors and MAP estimates.
