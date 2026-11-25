---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/deep-learning
status: verified
applies-to: ["PyTorch 2.15.0"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, deep-learning, uncertainty, aleatoric, epistemic, deep-ensembles, mc-dropout, laplace-approximation, gaussian-nll, predictive-uncertainty, dataset-shift, out-of-distribution]
---

# Uncertainty in deep learning: aleatoric vs epistemic, ensembles, MC dropout and Laplace

## Summary
**TL;DR:** A network can be unsure for two reasons. Aleatoric uncertainty is noise in the data at that input; more data does not remove it, and a network learns it by predicting a variance next to its mean and training on the Gaussian NLL (negative log-likelihood). Epistemic uncertainty is the model's ignorance where it saw little data; more data removes it, and estimating it needs several plausible networks: a deep ensemble (several networks from different random starts), MC (Monte Carlo) dropout (dropout left on at prediction time, many passes averaged) or a Laplace approximation (a Gaussian around the trained weights, shaped by the loss curvature). Score the result with NLL and calibration, not accuracy. Under dataset shift every method's uncertainty gets worse; ensembles usually degrade least, and temperature scaling fitted on in-distribution data does not carry over. In the lab, all four methods matched the noise inside the training range (90 % intervals covered 0.90–0.92) and all were overconfident in a gap in the data and far outside it; far outside, the variance-only network's NLL was 27.70 and the last-layer Laplace's 5.98.
**Use this when:** you need error bars from a neural network, choose between ensembles, MC dropout and Laplace, want to tell input noise from model ignorance, evaluate predictive uncertainty (NLL, coverage, calibration), or expect inputs unlike the training data.
**Not this doc:** calibrating classifier probabilities and temperature scaling → `machine-learning/evaluation/probability-calibration.md`; intervals with a distribution-free coverage guarantee → `machine-learning/evaluation/conformal-prediction.md`; priors, posteriors and Bayes' rule → `machine-learning/probabilistic-ml/bayesian-inference.md`; exact posterior variance for small data → `machine-learning/probabilistic-ml/gaussian-processes.md`; dropout as a regularizer and its train/eval modes → `machine-learning/deep-learning/normalization-and-dropout.md`; detecting drift in production → `machine-learning/ml-systems/data-drift-and-monitoring.md`.

## Problem
Standard deep-learning regression and classification do not capture model uncertainty ✅[^3]. A point estimate passed through a softmax can give unjustified high confidence far from the training data ✅[^3]. Adding a variance output fixes only half of it: in the lab, a network with a learned variance head predicted a standard deviation of 0.44 where its actual error was 3.17, and its 90 % interval covered 0.3 % of the points ✅[^9]. A decision that relies on "the model says ± 0.4" then fails exactly on the inputs where care matters most.

## Mental model
**Analogy:** a panel of weather forecasters. Even a perfect forecaster cannot say whether it rains tomorrow in a showery climate: that spread is aleatoric, a property of the weather. Ask five forecasters who each learned from a different random slice of experience: for cities they all know, they agree; for a city none of them has records for, they diverge, and that disagreement is epistemic. A deep ensemble is the panel; MC dropout asks one forecaster many times while hiding a random part of their notes; a Laplace approximation asks one forecaster how sharply their accuracy would drop if each learned rule were nudged.

**Artifact:** the ensemble's split of its predictive variance into the two kinds, by region, for 1-D data trained only on `1.5 ≤ |x| ≤ 4.5`; header and ensemble rows of the Worked example's output; lab run (`machine-learning/lab-setup.md`), 2026-11-25, PyTorch 2.15.0 ✅[^9]:

```text
method         region           noise sd  |error|  pred sd     NLL  90% cov  aleatoric  epistemic
deep ensemble  inside 1.5-4.5      0.400    0.330    0.428    0.52    0.904      0.424      0.060
deep ensemble  gap 0-1.5           0.176    0.766    0.353    2.69    0.364      0.313      0.153
deep ensemble  far 6-8             0.800    3.252    0.570   17.81    0.005      0.556      0.117
```

Inside the data the aleatoric part (0.424) matches the true noise (0.400) and the members agree (0.060); in the gap the members disagree 2.5 times as much (0.153), but still far less than the error (0.766).

## How it works
### Two kinds of uncertainty
1. **Aleatoric** uncertainty is noise inherent in the observations, such as sensor noise; it cannot be reduced by collecting more data ✅[^1]. It is homoscedastic when it is the same for every input and heteroscedastic when it depends on the input ✅[^1].
2. **Epistemic** uncertainty is uncertainty in the model parameters, ignorance about which model generated the data; it can be explained away with enough data and is also called model uncertainty ✅[^1]. In Kendall and Gal's experiments, epistemic uncertainty fell as the training set grew while aleatoric uncertainty stayed roughly constant ✅[^1].
3. **Only epistemic flags unfamiliar inputs.** Out-of-data examples can be identified with epistemic uncertainty but not with aleatoric uncertainty alone, and aleatoric uncertainty does not increase for them ✅[^1].

### Learning aleatoric uncertainty: a variance head
1. **Two outputs.** The network outputs a mean `μ(x)` and a variance `σ²(x)`; positivity comes from a softplus plus a small minimum such as `10⁻⁶` ✅[^2].
2. **The loss.** Minimize the Gaussian NLL `log σ²(x)/2 + (y − μ(x))²/(2σ²(x)) + constant` ✅[^2]. PyTorch's `nn.GaussianNLLLoss` computes `½(log max(var, eps) + (input − target)²/max(var, eps))`, clamps the variance at `eps = 1e-6` by default and adds the constant `½ log 2π` only with `full=True` ✅[^7]. Example: target 1.0, mean 0.6, variance 0.25 gives `½(log 0.25 + 0.16/0.25) = ½(−1.386 + 0.640) = −0.373`, and `−0.373 + ½ log 2π = −0.373 + 0.919 = 0.546` with the constant.
3. **Learned loss attenuation.** A large predicted variance down-weights that point's squared error, so noisy points pull less on the mean; the `log σ²` term stops the network from declaring infinite uncertainty everywhere ✅[^1]. Kendall and Gal predict `s = log σ²` instead of `σ²` for numerical stability ✅[^1].

### Estimating epistemic uncertainty: several plausible networks
1. **Deep ensembles.** Train `M` networks with a proper scoring rule such as the NLL; random initialization plus random shuffling of the data was enough, and bagging made results worse ✅[^2]. Treat them as an equal-weight mixture: mean `μ* = (1/M) Σ μ_m` and variance `σ*² = (1/M) Σ (σ_m² + μ_m²) − μ*²` ✅[^2], which equals the average member variance (aleatoric) plus the variance of the member means (epistemic). Example with two members, means 0.2 and 0.6, variances 0.09 each: `μ* = 0.4`, `σ*² = 0.09 + 0.04 = 0.13`. Adversarial training of the members is an optional extra ✅[^2]. Ovadia et al. used `M = 10` and found `M = 5` may be enough ✅[^5].
2. **MC dropout.** Gal and Ghahramani show that a network with dropout before every weight layer approximates a deep Gaussian process ✅[^3]. At prediction time, run `T` stochastic forward passes with dropout on and average them; the predictive variance is the sample variance of the passes plus the inverse of a model precision `τ` that the paper links to weight decay, a prior length-scale and the dropout probability ✅[^3]. With a variance head too, Kendall and Gal estimate `Var(y) ≈ (1/T) Σ ŷ_t² − ((1/T) Σ ŷ_t)² + (1/T) Σ σ̂_t²` ✅[^1]. PyTorch's `nn.Dropout` computes the identity in evaluation mode, so `model.eval()` turns MC dropout off ✅[^8] ✅[^9].
3. **Laplace approximation.** Approximate the weight posterior by a Gaussian centred at the trained (MAP, maximum a posteriori) weights, with covariance equal to the inverse Hessian of the regularized training loss there ✅[^4]. It can be fitted after training, even to a downloaded network ✅[^4]. The full Hessian grows quadratically with the number of parameters, so practice uses positive semi-definite approximations (the GGN, generalized Gauss–Newton, or Fisher matrix; KFAC, Kronecker-factored; diagonal) or treats only part of the network probabilistically, such as the last layer ✅[^4]. For a Gaussian likelihood the linearized network gives a closed-form predictive `N(f_MAP(x), J(x)ᵀ Σ J(x) + σ²)`, with `J` the Jacobian of the output with respect to the weights and `Σ` the posterior covariance; for a last-layer Laplace the Hessian equals the GGN and this predictive is exact ✅[^4]. The `laplace` library's default is a post-hoc last-layer Laplace with a KFAC GGN ✅[^4], and the prior precision can be tuned after training ✅[^4].
4. **Weight-space alternatives** (variational inference, MCMC, Markov chain Monte Carlo) → `machine-learning/probabilistic-ml/variational-inference.md` and `machine-learning/probabilistic-ml/markov-chain-monte-carlo.md`. Foong et al. found that mean-field variational inference fails to give calibrated uncertainty between separated clusters of data, and that the linearized Laplace approximation handled that "in-between" region much better for small networks ✅[^6].

### Scoring the uncertainty
1. **NLL** is a proper scoring rule that depends on the predictive uncertainty, and is the usual metric for it; for classification the Brier score is another ✅[^2]. A proper scoring rule is one whose expected value is best when the predicted distribution equals the true one ✅[^2].
2. **Calibration is a separate axis from accuracy:** predictions can be accurate and miscalibrated, or the reverse ✅[^2]. For classifiers, reliability curves and ECE (expected calibration error) → `machine-learning/evaluation/probability-calibration.md`; for regression, check how often a central interval (here `μ ± 1.645σ`, nominally 90 %) contains the target.

### Under dataset shift and on out-of-distribution inputs
1. **Everything degrades.** Across image, text, online-ad and genomics benchmarks, the quality of uncertainty fell with increasing shift for every method, and better calibration on the i.i.d. (independent and identically distributed) test set did not usually mean better calibration under shift ✅[^5].
2. **Temperature scaling** fitted on an i.i.d. validation set was well calibrated on the i.i.d. test set and under small shift, but methods that model epistemic uncertainty beat it as the shift grew ✅[^5].
3. **Ensembles** seemed to perform best across most metrics and to be more robust to shift; last-layer dropout showed less uncertainty on shifted and OOD (out-of-distribution) data than full dropout ✅[^5]. On images of classes never seen in training, the ensemble's predictive entropy rose faster with `M` than MC dropout's ✅[^2].
4. **None of this is a guarantee.** To turn any of these uncertainty scores into an interval with stated coverage on exchangeable data, conformalize it (`machine-learning/evaluation/conformal-prediction.md`).

## Worked example
A 1-D regression with a hole: `y = cos(1.5x) + noise`, noise standard deviation `0.1 + 0.1·|x|`, 400 training points with `1.5 ≤ |x| ≤ 4.5`. Test points come from three regions: inside that range, the gap `|x| < 1.5`, and far outside, `6 ≤ |x| ≤ 8`. Every network is an MLP (multilayer perceptron) 1 → 64 → 64 with ReLU (rectified linear unit) activations and two heads (mean, variance), trained 300 epochs with Adam on `GaussianNLLLoss`. Methods: one network; a 5-member ensemble (seeds 0–4); one network with dropout 0.1, 100 passes; a last-layer Laplace approximation (LA) on network 0's mean head with prior precision 1 (not tuned). The core of the Laplace step:

```python
phi = lambda x: torch.cat([nets[0].body(x), torch.ones(len(x), 1)], 1)    # last-layer features
H = (phi(x_tr) / nets[0](x_tr)[1]).T @ phi(x_tr) + 1.0 * torch.eye(65)    # GGN + prior precision
Sigma = torch.linalg.inv(H)
epistemic_var = ((phi(x) @ Sigma) * phi(x)).sum(1, keepdim=True)          # phi^T Sigma phi
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-25, PyTorch 2.15.0 on the CPU (central processing unit), two runs identical ✅[^9]:

```text
method         region           noise sd  |error|  pred sd     NLL  90% cov  aleatoric  epistemic
single net     inside 1.5-4.5      0.400    0.332    0.421    0.52    0.902      0.421      0.000
single net     gap 0-1.5           0.176    0.688    0.311    2.93    0.371      0.311      0.000
single net     far 6-8             0.800    3.172    0.441   27.70    0.003      0.441      0.000
deep ensemble  inside 1.5-4.5      0.400    0.330    0.428    0.52    0.904      0.424      0.060
deep ensemble  gap 0-1.5           0.176    0.766    0.353    2.69    0.364      0.313      0.153
deep ensemble  far 6-8             0.800    3.252    0.570   17.81    0.005      0.556      0.117
MC dropout     inside 1.5-4.5      0.400    0.331    0.442    0.52    0.919      0.428      0.107
MC dropout     gap 0-1.5           0.176    1.001    0.314    6.23    0.237      0.301      0.091
MC dropout     far 6-8             0.800    3.323    0.644   15.16    0.008      0.497      0.405
last-layer LA  inside 1.5-4.5      0.400    0.332    0.428    0.52    0.909      0.421      0.076
last-layer LA  gap 0-1.5           0.176    0.688    0.441    1.47    0.511      0.311      0.305
last-layer LA  far 6-8             0.800    3.172    1.115    5.98    0.098      0.441      1.017
mc.train(): two forward passes give the same output = False
mc.eval(): two forward passes give the same output = True
```

<details><summary>Full script (prints the output above)</summary>

```python
# Predictive uncertainty on 1-D regression with a gap in the training data: one network with a
# learned variance head, a 5-member deep ensemble, MC dropout and a last-layer Laplace approximation.
# Error, predicted sd, NLL and 90 % coverage inside the data, in the gap and far outside (PyTorch, CPU).
import math
import torch
from torch import nn
torch.manual_seed(0)
torch.set_num_threads(1)

def f(x): return torch.cos(1.5 * x)
def noise_sd(x): return 0.1 + 0.1 * x.abs()         # aleatoric noise grows with |x|
def sample(x): return f(x) + noise_sd(x) * torch.randn_like(x)
def two_sided(lo, hi, n):                              # |x| uniform in [lo, hi], random sign
    a = torch.rand(n, 1) * (hi - lo) + lo
    return torch.where(torch.rand(n, 1) < 0.5, -a, a)
x_tr = two_sided(1.5, 4.5, 400); y_tr = sample(x_tr)   # no training data for |x| < 1.5
regions = {}
for name, lo, hi in (("inside 1.5-4.5", 1.5, 4.5), ("gap 0-1.5", 0, 1.5), ("far 6-8", 6, 8)):
    x = two_sided(lo, hi, 2000); regions[name] = (x, sample(x))

class Net(nn.Module):                                  # outputs a mean and a variance
    def __init__(self, p_drop=0.0):
        super().__init__()
        self.body = nn.Sequential(nn.Linear(1, 64), nn.ReLU(), nn.Dropout(p_drop),
                                  nn.Linear(64, 64), nn.ReLU(), nn.Dropout(p_drop))
        self.mu, self.var = nn.Linear(64, 1), nn.Linear(64, 1)
    def forward(self, x):
        h = self.body(x)
        return self.mu(h), nn.functional.softplus(self.var(h)) + 1e-6

def train(seed, p_drop=0.0):
    torch.manual_seed(seed)                            # seed sets the initial weights and the shuffles
    net = Net(p_drop); opt = torch.optim.Adam(net.parameters(), lr=3e-3)
    loss_fn = nn.GaussianNLLLoss()
    for _ in range(300):
        for idx in torch.randperm(400).split(32):
            mu, var = net(x_tr[idx])
            opt.zero_grad(); loss_fn(mu, y_tr[idx], var).backward(); opt.step()
    return net

nets = [train(s) for s in range(5)]
mc = train(10, p_drop=0.1)

# every method returns (mean, aleatoric variance, epistemic variance)
def single(x):
    with torch.no_grad(): mu, var = nets[0](x)
    return mu, var, torch.zeros_like(var)
def ensemble(x):                                       # mixture mean and variance of 5 members
    with torch.no_grad(): out = [n(x) for n in nets]
    mus, vars_ = torch.stack([o[0] for o in out]), torch.stack([o[1] for o in out])
    return mus.mean(0), vars_.mean(0), mus.var(0, unbiased=False)
def mc_dropout(x, T=100):                              # dropout stays ON at prediction time
    mc.train(); torch.manual_seed(123)
    with torch.no_grad(): out = [mc(x) for _ in range(T)]
    mus, vars_ = torch.stack([o[0] for o in out]), torch.stack([o[1] for o in out])
    return mus.mean(0), vars_.mean(0), mus.var(0, unbiased=False)
with torch.no_grad():                                  # last-layer Laplace on the mean head of nets[0]
    phi = lambda x: torch.cat([nets[0].body(x), torch.ones(len(x), 1)], 1)
    H = (phi(x_tr) / nets[0](x_tr)[1]).T @ phi(x_tr) + 1.0 * torch.eye(65)   # GGN + prior precision 1
    Sigma = torch.linalg.inv(H)
def laplace(x):
    with torch.no_grad():
        mu, var = nets[0](x); p = phi(x)
        return mu, var, ((p @ Sigma) * p).sum(1, keepdim=True)

methods = {"single net": single, "deep ensemble": ensemble, "MC dropout": mc_dropout, "last-layer LA": laplace}
print(f"{'method':<15}{'region':<16}{'noise sd':>9}{'|error|':>9}{'pred sd':>9}{'NLL':>8}{'90% cov':>9}"
      f"{'aleatoric':>11}{'epistemic':>11}")
for name, fn in methods.items():
    for rname, (x, y) in regions.items():
        mu, alea, epi = fn(x); var = alea + epi; sd = var.sqrt()
        nll = (0.5 * torch.log(2 * math.pi * var) + (y - mu) ** 2 / (2 * var)).mean().item()
        cov = ((y - mu).abs() <= 1.645 * sd).float().mean().item()
        print(f"{name:<15}{rname:<16}{noise_sd(x).mean().item():9.3f}{(y - mu).abs().mean().item():9.3f}"
              f"{sd.mean().item():9.3f}{nll:8.2f}{cov:9.3f}{alea.sqrt().mean().item():11.3f}"
              f"{epi.sqrt().mean().item():11.3f}")
x5 = regions["gap 0-1.5"][0][:5]
for mode in ("train", "eval"):
    getattr(mc, mode)()
    with torch.no_grad(): same = torch.equal(mc(x5)[0], mc(x5)[0])
    print(f"mc.{mode}(): two forward passes give the same output = {same}")
```

</details>

Columns: `noise sd` is the true noise standard deviation, `|error|` the mean absolute error of the predicted mean, `pred sd` the mean predicted standard deviation, `NLL` the Gaussian NLL with its constant, `90% cov` the share of targets inside `μ ± 1.645σ`, and the last two columns the square roots of the two variance parts.

Reading it:
- **Inside the data** the four methods are indistinguishable: predicted sd 0.421–0.442 against a true 0.400, NLL 0.52, coverage 0.902–0.919. Here the variance head does the work and the epistemic part is small (0.000–0.107).
- **In the gap** the true curve rises to a peak the training data never showed, and every method misses it (mean error 0.688–1.001) while predicting sd 0.311–0.441: coverage falls to 0.237–0.511. The ensemble members disagree more than inside (0.153 vs 0.060), but they make the same wrong guess, so the disagreement understates the error. The last-layer Laplace adds the most epistemic variance (0.305) and has the best NLL (1.47).
- **Far outside** the errors exceed 3 for everyone. The variance-only network is the worst calibrated (NLL 27.70, coverage 0.003); the ensemble (17.81) and MC dropout (15.16) are less wrong, and the Laplace's epistemic part grows to 1.017 (NLL 5.98), yet even it covers only 9.8 %.
- **The variance head extrapolates.** Its aleatoric estimate is 0.311 in the gap, where the true noise is 0.176, and 0.441 far out, where it is 0.800: off the data, the "noise" output is a guess like any other output.
- **The mode switch matters.** In `train()` mode two passes differ (dropout is sampling masks); in `eval()` mode they are identical, so MC dropout silently becomes a single network.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `model.eval()` before MC dropout | All `T` passes are identical; no epistemic estimate | `nn.Dropout` is the identity in evaluation mode ✅[^8]; lab ✅[^9] |
| Variance head only | Confident far from data (lab NLL 27.70, coverage 0.003) | Aleatoric uncertainty does not rise on out-of-data inputs ✅[^1] ✅[^9] |
| Ensemble of networks trained on MSE (mean squared error), spread used as uncertainty | Worse uncertainty than members that learn a variance with NLL | Lakshminarayanan et al.'s toy comparison ✅[^2] |
| Ensemble members trained on bootstrap samples (bagging) | Worse than training each on all data | Their experiments ✅[^2] |
| Members agree on a wrong interpolation | Small spread, large error (lab gap: 0.153 vs 0.766) ✅[^9] | Spread measures only how differently the members guess; the region between data clusters is a known failure of some approximate posteriors ✅[^6] |
| Temperature scaling tuned in-distribution, deployed under shift | Calibration degrades as shift grows | Calibration on i.i.d. validation data does not transfer ✅[^5] |
| Full-network Hessian for Laplace | Infeasible memory; may be indefinite | Quadratic in parameters; use GGN, KFAC, diagonal or last layer ✅[^4] |
| Laplace prior precision left at a default | Epistemic scale is arbitrary (lab used 1) | It is a hyperparameter; tune it post hoc ✅[^4] ✅[^9] |
| `GaussianNLLLoss` with tiny predicted variances | Variance clamped at `eps`; loss lacks the constant | `eps = 1e-6`, `full=False` by default ✅[^7] |
| Comparing NLL across tools | Values differ by `½ log 2π ≈ 0.919` per point | `GaussianNLLLoss` omits the constant unless `full=True` ✅[^7]; the lab's NLL column includes it |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Variance head (Gaussian NLL) | Input-dependent noise, robust to noisy labels ✅[^1] | No epistemic part ✅[^1]; overconfident off data ✅[^9] |
| Deep ensemble | Best across most metrics under shift ✅[^5]; simple, parallel ✅[^2] | `M` times the training and prediction cost |
| MC dropout | Reuses a trained dropout network ✅[^3] | `T` forward passes per prediction ✅[^3]; last-layer dropout shows less uncertainty on shifted and OOD data than full dropout ✅[^5] |
| Last-layer Laplace | Post hoc on a trained network; closed-form predictive ✅[^4] | Covers only last-layer uncertainty; needs a tuned prior precision ✅[^4] |
| Temperature scaling (`machine-learning/evaluation/probability-calibration.md`) | One parameter, calibrated in-distribution ✅[^5] | Outperformed by epistemic methods as shift grows ✅[^5] |
| Conformal wrapper (`machine-learning/evaluation/conformal-prediction.md`) | Coverage guarantee on exchangeable data | No guarantee under shift; needs held-out calibration data |

## Takeaways
- Report which uncertainty a number is: a variance head measures noise only, and says nothing about inputs unlike the training data. [rule-candidate]
- Evaluate uncertainty with NLL and interval coverage on held-out and on shifted data, not with accuracy. [rule-candidate]
- Start with a small deep ensemble (about 5 members, NLL-trained); add a last-layer Laplace when retraining is too expensive.
- Keep dropout layers in training mode for MC dropout, and only those layers.
- Expect every method to be overconfident far from the data; detect or refuse such inputs instead of trusting their error bars.

## Verification status
- Verified: 64 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [What Uncertainties Do We Need in Bayesian Deep Learning for Computer Vision?](https://ar5iv.labs.arxiv.org/html/1703.04977) — Kendall, Gal, 2017. Backs: aleatoric and epistemic definitions, homoscedastic vs heteroscedastic, epistemic falls with data and aleatoric does not, only epistemic flags out-of-data inputs, learned loss attenuation, log-variance output, the combined variance formula. [^1]
- [Simple and Scalable Predictive Uncertainty Estimation using Deep Ensembles](https://ar5iv.labs.arxiv.org/html/1612.01474) — Lakshminarayanan, Pritzel, Blundell, 2017. Backs: mean and variance outputs with softplus, Gaussian NLL, proper scoring rules, random initialization and shuffling, bagging worse, mixture mean and variance, adversarial training optional, NLL and Brier as metrics, calibration orthogonal to accuracy, MSE-ensemble spread inferior, entropy on unseen classes. [^2]
- [Dropout as a Bayesian Approximation: Representing Model Uncertainty in Deep Learning](https://ar5iv.labs.arxiv.org/html/1506.02142) — Gal, Ghahramani, 2016. Backs: standard models lack model uncertainty, overconfident softmax extrapolation, dropout as approximate deep Gaussian process, MC dropout averaging and its variance with the model precision. [^3]
- [Laplace Redux – Effortless Bayesian Deep Learning](https://arxiv.org/html/2106.14806v3) — Daxberger, Kristiadi, Immer, Eschenhagen, Bauer, Hennig, 2021 (v3 2022). Backs: Gaussian at the MAP with inverse-Hessian covariance, post-hoc use, Hessian cost and its approximations, last-layer and subnetwork Laplace, the linearized predictive and its exactness for the last layer, the library default, post-hoc prior-precision tuning. [^4]
- [Can You Trust Your Model's Uncertainty? Evaluating Predictive Uncertainty Under Dataset Shift](https://ar5iv.labs.arxiv.org/html/1906.02530) — Ovadia et al., 2019. Backs: uncertainty degrades with shift for every method, i.i.d. calibration does not transfer, temperature scaling vs epistemic methods, ensembles best and `M = 5` may suffice, last-layer dropout less uncertain. [^5]
- ['In-Between' Uncertainty in Bayesian Neural Networks](https://ar5iv.labs.arxiv.org/html/1906.11537) — Foong, Li, Hernández-Lobato, Turner, 2019. Backs: mean-field variational inference fails between data clusters; linearized Laplace handles it better for small networks. [^6]
- [torch.nn.GaussianNLLLoss](https://docs.pytorch.org/docs/2.15/generated/torch.nn.GaussianNLLLoss.html) — PyTorch contributors, 2.15. Backs: the loss formula, `eps = 1e-6` clamp, constant only with `full=True`. [^7]
- [torch.nn.Dropout](https://docs.pytorch.org/docs/2.15/generated/torch.nn.Dropout.html) — PyTorch contributors, 2.15. Backs: identity in evaluation mode. [^8]
- `machine-learning/lab-setup.md` — the lab where the single-network, ensemble, MC dropout and last-layer Laplace comparison ran on 2026-11-25. [^9]

## Related
- `machine-learning/evaluation/probability-calibration.md` — reliability curves, ECE and temperature scaling for classifiers.
- `machine-learning/evaluation/conformal-prediction.md` — turning an uncertainty score into intervals with a coverage guarantee.
- `machine-learning/deep-learning/normalization-and-dropout.md` — dropout's masks, scaling and train/eval modes.
- `machine-learning/probabilistic-ml/bayesian-inference.md` — posteriors and posterior predictive distributions.
- `machine-learning/probabilistic-ml/gaussian-processes.md` — exact predictive variance that grows away from the data.
- `machine-learning/probabilistic-ml/variational-inference.md` — approximate posteriors by optimization.
- `machine-learning/unsupervised-learning/active-learning.md` — MC dropout and BALD (Bayesian active learning by disagreement) to choose what to label.
- `machine-learning/ml-systems/data-drift-and-monitoring.md` — detecting the shifts that break these estimates.
- `machine-learning/foundations/loss-functions-and-maximum-likelihood.md` — the Gaussian NLL and its link to mean squared error.
