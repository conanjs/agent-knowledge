---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/unsupervised-learning
status: verified
applies-to: ["scikit-learn 1.9.1", "scipy 1.18.1"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, unsupervised-learning, factor-analysis, ica, independent-component-analysis, fastica, blind-source-separation, cocktail-party, loadings, varimax, rotation, kurtosis, negentropy, whitening, scikit-learn]
---

# Factor analysis and independent component analysis (ICA)

## Summary
**TL;DR:** Both models explain the observed features as linear mixtures of a few hidden factors. Factor analysis (FA) assumes Gaussian factors plus a separate noise variance for every feature, so it splits each feature's variance into a shared part (the loadings) and its own noise, which PCA (principal component analysis) cannot; but Gaussian factors fix the loadings only up to a rotation, so FA solutions are often rotated (varimax) to make them readable. ICA (independent component analysis) assumes independent, non-Gaussian sources and no noise: because a mixture of independent signals is closer to Gaussian than the signals themselves, the least Gaussian directions of the data are the sources, recovered up to order, sign and scale. FastICA finds them by whitening the data and running a fixed-point iteration.
**Use this when:** features share hidden causes and you want per-feature loadings and noise levels; you must separate mixed signals (microphones, EEG (electroencephalography) electrodes); you choose between scikit-learn's `PCA`, `FactorAnalysis` and `FastICA`; or you read `components_`, `noise_variance_`, `mixing_` or `rotation="varimax"`.
**Not this doc:** PCA itself, SVD (singular value decomposition) and whitening with `PCA(whiten=True)` → `machine-learning/unsupervised-learning/principal-component-analysis.md`; the EM (expectation-maximization) algorithm for latent-variable models → `machine-learning/unsupervised-learning/gaussian-mixtures-and-em.md`; ICA used to orient causal edges (LiNGAM, linear non-Gaussian acyclic model) → `machine-learning/causal-inference/causal-discovery.md`; entropy and differential entropy → `machine-learning/foundations/information-theory.md`.

## Problem
PCA's first component is the direction of largest variance, and that variance mixes two things: variation that features share and variation that belongs to one feature alone. A single very noisy feature drags the component towards itself. In the lab, one of six features has noise variance 4.0 (the others 0.1) and the smallest true loading, yet it takes weight 0.864 in PCA's first component; the cosine between PCA's direction and the true loading direction is 0.7148, against 0.9994 for factor analysis ✅[^21]. PCA fails a second way on mixed signals: its components are uncorrelated, not independent. Three microphones recording a sine, a square wave and a sawtooth give PCA components that still mix the signals (best correlation with a true source 0.67 to 0.78), while FastICA recovers each source with correlation 0.997 or better ✅[^21]. scikit-learn's own example blames PCA's failure on the signals reflecting non-Gaussian processes ✅[^6].

## Mental model
**Analogy:** a room with a few hidden speakers and several microphones. Each microphone records a weighted mix of the speakers (the weights are the loadings, or the mixing matrix) plus its own hiss. Factor analysis asks "how strongly does each speaker reach each microphone, and how much hiss does each microphone add?". It treats the speakers as featureless Gaussian hum, so it can tell shared sound from hiss but not which way the speakers are turned: any rotation of the speakers explains the recordings equally well. ICA asks "what did each speaker say?". It needs speech with structure (non-Gaussian) and assumes no hiss; then only the true speakers unmix the room, though it cannot know who is "speaker 1" or how loud each one really was.

**Artifact:** the linear factor model family. Every member samples hidden factors `h` and produces `x = W h + μ + noise` (`W` = loading or mixing matrix, `μ` = offset vector); the members differ only in the prior on `h` and the form of the noise ✅[^8] ✅[^1]:

| Model | Prior on factors `h` | Noise | Identified only up to | scikit-learn |
|---|---|---|---|---|
| Probabilistic PCA | Gaussian `N(0, I)` | isotropic `σ²I`: one variance for all features ✅[^1] | (not covered here: see the PCA doc) | `PCA` (its `score` uses this model ✅[^1]) |
| Factor analysis | Gaussian `N(0, I)` ✅[^8] | diagonal `Ψ = diag(ψ₁ … ψ_d)`: one variance per feature ✅[^1] | a rotation of `W` (lab: same log-likelihood after a 30° rotation ✅[^21]) | `FactorAnalysis` |
| ICA | independent, non-Gaussian ✅[^8] | none in the basic model ✅[^9] (some variants add it ✅[^8]) | order, sign and scale of the sources ✅[^10] | `FastICA` |

## How it works
### Factor analysis
1. **Model.** `x = W h + μ + ε` with `h ~ N(0, I)` (`k` factors) and `ε ~ N(0, Ψ)`, `Ψ` diagonal ✅[^1] ✅[^8]. `W` (`d × k`, `d` = number of features) is the factor loading matrix ✅[^1]; `ψ_i` is feature `i`'s own noise variance. Example, from the lab data: feature 0 has loading 1.0 and `ψ₀ = 0.1`, so `var(x₀) = 1.0² + 0.1 = 1.1`; feature 5 has loading 0.5 and `ψ₅ = 4.0`, so `var(x₅) = 0.25 + 4.0 = 4.25`.
2. **What it implies.** `x ~ N(μ, W Wᵀ + Ψ)`: a Gaussian whose covariance is low rank plus diagonal ✅[^1] ✅[^8]. Given `h`, the features are independent, so the factors are what carry the dependencies between features ✅[^8].
3. **Fitting.** scikit-learn estimates the loadings by maximum likelihood with an SVD-based approach ✅[^2]. Each iteration divides every feature by `√ψ_i`, takes a truncated SVD to get `W`, then sets `ψ_i = var(x_i) − Σ_k W_ik²`; it stops when the log-likelihood rises by less than `tol` (default `1e-2`) or after `max_iter` (default 1000) iterations ✅[^4] ✅[^2]. Probabilistic PCA can also be fitted with an iterative EM algorithm (Tipping and Bishop) ✅[^8]; the E-step/M-step idea is the one in the Gaussian-mixture doc.
4. **Using the fit.** `transform` returns the expected (mean) latent factors of each row; `get_covariance` returns `components_ᵀ components_ + diag(noise_variance_)`; `score` is the average log-likelihood ✅[^2].
5. **PCA as a special case.** Forcing `Ψ = σ²I` gives probabilistic PCA ✅[^1], which has a closed-form fit and is therefore faster ✅[^2], and which becomes ordinary PCA as `σ → 0` ✅[^8]. FA's advantage is that it models the variance of every input direction separately (heteroscedastic noise), which also gives better model selection than probabilistic PCA when the noise differs per feature ✅[^1]. Its components can look like PCA's, but nothing general can be said about them, not even that they are orthogonal ✅[^1].

### The rotation ambiguity and varimax
1. **Why it exists.** For any rotation matrix `R` (`R Rᵀ = I`), the loadings `W R` give `(W R)(W R)ᵀ + Ψ = W Wᵀ + Ψ`: the same covariance, so the same likelihood. In the lab a 30° rotation leaves the mean log-likelihood at exactly `−6.058497` ✅[^21].
2. **What people do about it.** FA is often followed by a rotation chosen for interpretability; varimax maximizes the sum of the variances of the squared loadings, which tends to give sparse factors, each driven by a few features ("simple structure") ✅[^1]. `FactorAnalysis(rotation="varimax")` or `"quartimax"` applies it (added in 0.24; varimax is Kaiser's 1958 criterion) ✅[^2], and the rotation it applies is orthogonal ✅[^4].
3. **What it does not do.** A rotation does not make the latent space more predictive; it helps to read its structure ✅[^7]. In the lab, varimax raises the number of loadings below 0.1 from 0 of 12 to 6 of 12 ✅[^21].

### ICA: model, independence and the ambiguities
1. **Model.** `x = A s`: the observed vector `x` is a mixing matrix `A` (unknown, assumed square) times a vector `s` of `n` independent components, both zero-mean; once `A` is estimated, its inverse `W` gives the sources `s = W x` ✅[^9]. ICA is perhaps the most widely used method for blind source separation, "blind" because little is known about `A` or the sources ✅[^9]. The model has no noise term ✅[^9] ✅[^1].
2. **Independent is more than uncorrelated.** Independence means the joint density factorizes; uncorrelated only means zero covariance. The pair `(y₁, y₂)` taking `(0,1)`, `(0,−1)`, `(1,0)`, `(−1,0)` with probability 1/4 each is uncorrelated but not independent ✅[^11]: knowing `y₁ = 1` forces `y₂ = 0`. PCA's components are only uncorrelated.
3. **Ambiguities.** The variance (scale) of each source cannot be determined, so methods fix it to 1, leaving the sign free; and the order cannot be determined ✅[^10]. In the lab FastICA returned the three sources as components `[0 2 1]`, each with standard deviation 1.000 ✅[^21].
4. **Why Gaussian sources are forbidden.** With Gaussian sources and an orthogonal mixing matrix, the mixtures are Gaussian, uncorrelated and of unit variance, and their joint density is completely symmetric, so it holds no information about the directions of `A`; any orthogonal transformation has the same distribution, and `A` is identifiable only up to that transformation ✅[^12]. With exactly one Gaussian component the model can still be estimated ✅[^12]. Every ICA variant needs non-Gaussian factors, unlike FA and probabilistic PCA, which assume Gaussian ones for closed-form operations ✅[^8].

### ICA: non-Gaussian means independent
1. **The central limit theorem (CLT) argument.** A sum of independent variables tends towards a Gaussian, so, assuming for simplicity identically distributed sources as the tutorial does, a projection `y = wᵀx = qᵀs` (with `q = Aᵀw`, the weight the projection gives each source) is more Gaussian than any single source and least Gaussian when it equals one source; maximizing the non-Gaussianity of `wᵀx` therefore finds a source, and the landscape has `2n` local maxima, one pair `±s_i` per source ✅[^13]. Lab: the sources' excess kurtosis is `−1.365`, `−1.991`, `−1.200`; the three microphones' is `−0.484`, `−1.194`, `−0.418`, nearer the Gaussian value 0 ✅[^21].
2. **Kurtosis.** scipy defines it as the fourth central moment divided by the squared variance, minus 3 in Fisher's convention so that a normal distribution scores 0 ✅[^20]. Negative kurtosis is sub-Gaussian (flat, such as the uniform; lab `−1.18`), positive is super-Gaussian (spiky with heavy tails, such as the Laplace) ✅[^14] ✅[^21]. It is simple to estimate but sensitive to outliers, because a few tail observations can decide its value ✅[^14].
3. **Negentropy.** Among variables of equal variance the Gaussian has the largest differential entropy; negentropy is the entropy of a Gaussian with the same covariance minus the entropy of `y`, so it is never negative and is zero only for a Gaussian ✅[^15]. It is statistically well justified but hard to compute, because it needs an estimate of the density ✅[^15].
4. **Approximations.** Hyvärinen's approximations compare `E{G(y)}` for a non-quadratic function `G` of the standardized projection with `E{G(ν)}` for a standard Gaussian `ν`; choosing `G(y) = y⁴` gives back a kurtosis-based measure, while a `G` that grows slowly gives a robust one ✅[^16]. The lab squares that gap with `G = log cosh`: `0.00341` for the square wave against at most `0.00076` for a microphone ✅[^21].

### Whitening and the FastICA iteration
1. **Centre, then whiten.** Subtract the mean, then transform `x` linearly into `z` whose components are uncorrelated with unit variance, for example from the eigendecomposition of the covariance matrix ✅[^17]; the lab uses `z = E D^(−1/2) Eᵀ x`, with `E` the eigenvectors and `D` the diagonal matrix of eigenvalues ✅[^21]. The new mixing matrix is orthogonal, which leaves `n(n−1)/2` parameters instead of `n²` (one angle for `n = 2`, 3 instead of 9 for `n = 3`), so whitening "solves half of the problem"; dropping small eigenvalues at the same time often reduces noise ✅[^17]. Lab: the whitened covariance has diagonal `1.000` and largest off-diagonal entry `2.3e-14` ✅[^21].
2. **One unit.** Start from a random unit vector `w`; set `w⁺ = mean(z · g(wᵀz)) − mean(g′(wᵀz)) · w`, where `g` is the derivative of `G` and the means run over the samples; normalize `w = w⁺ / ‖w⁺‖`; repeat until the old and new `w` point the same way, `|w_oldᵀ w_new| ≈ 1`, a sign flip counting as converged ✅[^18] ✅[^5]. The update is an approximate Newton iteration ✅[^18]. For `fun="logcosh"`, `g(u) = tanh(αu)` and `g′(u) = α(1 − tanh²(αu))`; `"exp"` uses `g(u) = u·exp(−u²/2)`; `"cube"` uses `g(u) = u³` ✅[^5]. Lab: 5, 5 and 2 iterations for the three components ✅[^21].
3. **Several units.** To stop units converging to the same source, either deflate (Gram–Schmidt: subtract the projections on the vectors already found, then renormalize) or decorrelate symmetrically, `W ← (W Wᵀ)^(−1/2) W`, so no unit is privileged ✅[^19] ✅[^5]. scikit-learn's `algorithm="parallel"` (default) is the symmetric version, `"deflation"` the other ✅[^3] ✅[^5].
4. **scikit-learn's `FastICA`.** Defaults: `whiten="unit-variance"` (since 1.3), `fun="logcosh"` with `alpha = 1.0`, `max_iter=200`, `tol=1e-4`; `components_` maps data to sources, `mixing_` is its pseudo-inverse ✅[^3]. The user guide notes ICA is typically used to separate superimposed signals rather than to reduce dimensionality, and that whitening is needed because the model has no noise term ✅[^1].

## Worked example
One script: (1) one factor and six features with one very noisy feature, FA against PCA; (2) two factors, the 30° rotation and varimax; (3) the cocktail party with scikit-learn's three-signal mixture, FastICA against PCA; (4) FastICA written by hand; (5) uniform against Gaussian sources. The core of the by-hand FastICA:

```python
Z = Xc @ E @ np.diag(d ** -0.5) @ E.T                      # whiten
w_new = (Z * np.tanh(y)[:, None]).mean(0) - (1 - np.tanh(y) ** 2).mean() * w
w_new = unit(w_new - W[:j].T @ (W[:j] @ w_new))            # deflation
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-25, scikit-learn 1.9.1, scipy 1.18.1, numpy 2.5.5, two runs identical ✅[^21]:

```text
== 1. one factor, six features; feature 5 has noise variance 4.0, the others 0.1 ==
true loadings       [1.000 0.900 0.800 0.700 0.600 0.500]
FA loadings         [0.986 0.905 0.801 0.696 0.600 0.434]
FA noise variances  [0.102 0.096 0.099 0.101 0.099 4.080]
true direction      [0.531 0.478 0.425 0.372 0.318 0.265]
PCA component       [0.276 0.249 0.223 0.196 0.166 0.864]
cosine with true direction: FA 0.9994  PCA 0.7148
held-out mean log-likelihood: FA -5.2887  probabilistic PCA -8.3167
== 2. two factors: rotating the loadings leaves the likelihood unchanged ==
unrotated       mean log-lik -6.058497  |loading| < 0.1: 0 of 12  rows: [[-0.87, 0.26], [-0.77, 0.23], [-0.68, 0.2], [0.26, 0.84], [0.23, 0.75], [0.2, 0.68]]
rotated 30 deg  mean log-lik -6.058497  |loading| < 0.1: 0 of 12  rows: [[-0.62, 0.66], [-0.55, 0.58], [-0.49, 0.52], [0.65, 0.6], [0.58, 0.53], [0.51, 0.49]]
varimax         mean log-lik -6.058497  |loading| < 0.1: 6 of 12  rows: [[-0.91, 0.0], [-0.8, 0.0], [-0.71, 0.0], [0.01, 0.88], [0.01, 0.78], [-0.01, 0.71]]
== 3. cocktail party: 3 sources, 3 microphones, X = S A^T ==
excess kurtosis, sources (sine, square, sawtooth): [-1.365 -1.991 -1.200]
excess kurtosis, the 3 microphones:                [-0.484 -1.194 -0.418]
FastICA  best corr per source [0.997 0.999 0.997]  found as component [0 2 1]
PCA      best corr per source [ 0.753  0.782 -0.669]  found as component [2 1 2]
FastICA iterations: 3  source std: [1.000 1.000 1.000]
== 4. FastICA by hand: centre, whiten, fixed-point update with g = tanh, deflation ==
component 0: 5 iterations
component 1: 5 iterations
component 2: 2 iterations
covariance of whitened data, diagonal: [1.000 1.000 1.000]  max off-diagonal: 2.3e-14
by-hand best corr per source [ 0.996  1.000 -0.999]
negentropy proxy (E G(y) - E G(nu))^2, G = log cosh: sources 0.00104 0.00341 0.00069 | microphones 0.00007 0.00076 0.00003
== 5. Gaussian sources: no direction is special ==
uniform  kurtosis of whitened projection at 0,30,..,150 deg: [-1.180 -0.640 -0.850 -1.180 -0.700 -0.900]
uniform  FastICA on data sets 10,11,12, worst-source |corr|: [1.0, 1.0, 1.0]
gaussian kurtosis of whitened projection at 0,30,..,150 deg: [ 0.040 -0.020 -0.120 -0.100  0.050  0.100]
gaussian FastICA on data sets 10,11,12, worst-source |corr|: [0.802, 0.86, 0.922]
```

<details><summary>Full script (prints the output above)</summary>

```python
# Factor analysis vs PCA under per-feature noise, the rotation ambiguity and varimax,
# and ICA on a cocktail-party mixture: scikit-learn's FastICA, FastICA by hand, Gaussian sources.
import numpy as np
from scipy import signal
from scipy.stats import kurtosis
from sklearn.decomposition import PCA, FactorAnalysis, FastICA

np.set_printoptions(precision=3, suppress=True, floatmode="fixed")
rng = np.random.default_rng(0)
unit = lambda v: v / np.linalg.norm(v)

print("== 1. one factor, six features; feature 5 has noise variance 4.0, the others 0.1 ==")
w_true = np.array([1.0, 0.9, 0.8, 0.7, 0.6, 0.5])
psi_true = np.array([0.1, 0.1, 0.1, 0.1, 0.1, 4.0])
X = rng.standard_normal((6000, 1)) * w_true + rng.standard_normal((6000, 6)) * np.sqrt(psi_true)
Xtr, Xte = X[:5000], X[5000:]
fa = FactorAnalysis(n_components=1, random_state=0).fit(Xtr)
pca = PCA(n_components=1).fit(Xtr)
w_fa = fa.components_[0] * np.sign(fa.components_[0, 0])
d_pca = pca.components_[0] * np.sign(pca.components_[0, 0])
print("true loadings      ", w_true)
print("FA loadings        ", w_fa)
print("FA noise variances ", fa.noise_variance_)
print("true direction     ", unit(w_true))
print("PCA component      ", d_pca)
print(f"cosine with true direction: FA {unit(w_fa) @ unit(w_true):.4f}  PCA {d_pca @ unit(w_true):.4f}")
print(f"held-out mean log-likelihood: FA {fa.score(Xte):.4f}  probabilistic PCA {pca.score(Xte):.4f}")

print("== 2. two factors: rotating the loadings leaves the likelihood unchanged ==")
W2 = np.array([[0.9, 0], [0.8, 0], [0.7, 0], [0, 0.9], [0, 0.8], [0, 0.7]])
X2 = rng.standard_normal((5000, 2)) @ W2.T + np.sqrt(0.2) * rng.standard_normal((5000, 6))
fa2 = FactorAnalysis(n_components=2, random_state=0).fit(X2)
L = fa2.components_.T.copy()                        # loadings, one row per feature
a = np.deg2rad(30)
R = np.array([[np.cos(a), -np.sin(a)], [np.sin(a), np.cos(a)]])
fav = FactorAnalysis(n_components=2, rotation="varimax", random_state=0).fit(X2)
for name, M in (("unrotated", L), ("rotated 30 deg", L @ R), ("varimax", fav.components_.T)):
    fa2.components_ = M.T                           # same noise variances, other loadings
    print(f"{name:<15} mean log-lik {fa2.score(X2):.6f}  |loading| < 0.1: {int((abs(M) < 0.1).sum())} of 12  "
          f"rows: {(np.round(M, 2) + 0.0).tolist()}")

print("== 3. cocktail party: 3 sources, 3 microphones, X = S A^T ==")
t = np.linspace(0, 8, 2000)
S = np.c_[np.sin(2 * t), np.sign(np.sin(3 * t)), signal.sawtooth(2 * np.pi * t)]
S /= S.std(axis=0)
A = np.array([[1, 1, 1], [0.5, 2, 1.0], [1.5, 1.0, 2.0]])
Xm = S @ A.T
print("excess kurtosis, sources (sine, square, sawtooth):", kurtosis(S))
print("excess kurtosis, the 3 microphones:               ", kurtosis(Xm))
def match(S_est):                                   # best-matching estimate for each true source
    C = np.corrcoef(S.T, S_est.T)[:3, 3:]
    idx = np.abs(C).argmax(axis=1)
    return C[np.arange(3), idx], idx
ica = FastICA(n_components=3, whiten="unit-variance", random_state=0)
S_ica = ica.fit_transform(Xm)
S_pca = PCA(n_components=3, whiten=True).fit_transform(Xm)
for name, Se in (("FastICA", S_ica), ("PCA", S_pca)):
    best, idx = match(Se)
    print(f"{name:<8} best corr per source {best}  found as component {idx}")
print("FastICA iterations:", ica.n_iter_, " source std:", S_ica.std(axis=0))

print("== 4. FastICA by hand: centre, whiten, fixed-point update with g = tanh, deflation ==")
Xc = Xm - Xm.mean(axis=0)
d, E = np.linalg.eigh(np.cov(Xc.T))
Z = Xc @ E @ np.diag(d ** -0.5) @ E.T              # whitened: covariance = identity
W = np.zeros((3, 3))
for j in range(3):
    w = unit(rng.standard_normal(3))
    for it in range(1, 201):
        y = Z @ w
        w_new = (Z * np.tanh(y)[:, None]).mean(axis=0) - (1 - np.tanh(y) ** 2).mean() * w
        w_new = unit(w_new - W[:j].T @ (W[:j] @ w_new))  # remove directions already found
        converged = abs(abs(w_new @ w) - 1) < 1e-10
        w = w_new
        if converged:
            break
    W[j] = w
    print(f"component {j}: {it} iterations")
print("covariance of whitened data, diagonal:", np.diag(np.cov(Z.T)), " max off-diagonal:",
      f"{np.abs(np.cov(Z.T) - np.eye(3)).max():.1e}")
print("by-hand best corr per source", match(Z @ W.T)[0])
G = lambda u: np.log(np.cosh(u))
EG_gauss = G(rng.standard_normal(1_000_000)).mean()
J = lambda y: (G((y - y.mean()) / y.std()).mean() - EG_gauss) ** 2
print("negentropy proxy (E G(y) - E G(nu))^2, G = log cosh: sources", " ".join(f"{J(s):.5f}" for s in S.T),
      "| microphones", " ".join(f"{J(x):.5f}" for x in Xm.T))

print("== 5. Gaussian sources: no direction is special ==")
for kind in ("uniform", "gaussian"):
    worst = []
    for seed in (10, 11, 12):                       # three fresh data sets of 5000 rows
        r = np.random.default_rng(seed)
        src = r.uniform(-np.sqrt(3), np.sqrt(3), (5000, 2)) if kind == "uniform" else r.standard_normal((5000, 2))
        mix = src @ np.array([[1.0, 0.6], [0.4, 1.0]]).T
        est = FastICA(n_components=2, whiten="unit-variance", random_state=0).fit_transform(mix)
        worst.append(round(float(np.abs(np.corrcoef(src.T, est.T)[:2, 2:]).max(axis=1).min()), 3))
    mc = mix - mix.mean(axis=0)
    dd, EE = np.linalg.eigh(np.cov(mc.T))
    zz = mc @ EE @ np.diag(dd ** -0.5) @ EE.T     # whitened mixture of the last data set
    k = [kurtosis(zz @ [np.cos(np.deg2rad(g)), np.sin(np.deg2rad(g))]) for g in range(0, 180, 30)]
    print(f"{kind:<8} kurtosis of whitened projection at 0,30,..,150 deg: {np.round(k, 2)}")
    print(f"{kind:<8} FastICA on data sets 10,11,12, worst-source |corr|: {worst}")
```

</details>

Reading it, part by part:
- **Part 1, FA against PCA:** FA's loadings land within 0.07 of the truth and its noise variances find the noisy feature (`4.080` against a true 4.0). PCA's first component puts `0.864` on feature 5, the noisiest and least shared feature, because PCA has no place to put feature-specific variance. On held-out rows FA's log-likelihood is `−5.29` per row against probabilistic PCA's `−8.32`: one shared noise level is a poor model of this data.
- **Part 2, rotation:** three loading matrices with the same noise variances score exactly `−6.058497`; the data cannot choose between them. The unrotated fit mixes both factors into every feature (`0.26` cross-loadings); the 30° rotation mixes them further; varimax gives back the planted simple structure, features 0–2 on one factor and 3–5 on the other, with the first factor's sign flipped.
- **Part 3, cocktail party:** every microphone's kurtosis is nearer 0 than the sources', as the CLT argument predicts. FastICA matches each source at `0.997` or better, in a permuted order; PCA's best matches are `0.67` to `0.78` and its component 2 is the best match for two different sources, so it has not separated them.
- **Part 4, by hand:** the deflation loop converges in a few iterations and matches the sources as well as scikit-learn, one of them with its sign flipped (`−0.999`). The negentropy proxy ranks only roughly: the square wave (`0.00341`) is far above every microphone, but the sawtooth (`0.00069`) scores just below the second microphone (`0.00076`), whose row of `A` gives the square wave its largest weight (2).
- **Part 5, Gaussian sources:** for uniform sources the kurtosis of a whitened projection swings between `−1.18` (near a source direction) and `−0.64`, and FastICA recovers both sources on all three data sets. For Gaussian sources the curve is flat noise around 0 and FastICA returns a different, arbitrary rotation each time (worst-source correlation `0.80`, `0.86`, `0.92`).

## Edge cases
| Case | What happens | Why |
|---|---|---|
| One feature with a much larger own noise | PCA's component swings towards it; FA puts it in `noise_variance_` | FA models per-feature noise ✅[^1]; lab `0.864` weight vs `ψ₅ = 4.080` ✅[^21] |
| Reading meaning into unrotated FA loadings | Another rotation fits exactly as well | `W R` leaves `W Wᵀ + Ψ` unchanged; lab identical log-likelihood ✅[^21]; rotate for interpretability ✅[^1] |
| Two or more Gaussian sources | ICA returns an arbitrary rotation of them | Symmetric joint density, `A` identifiable only up to an orthogonal transform ✅[^12]; lab 0.80–0.92 ✅[^21] |
| Exactly one Gaussian source | Still separable | Stated in the tutorial ✅[^12] |
| Recovered source upside down, rescaled or reordered | Inherent; match by correlation, not by index | Scale, sign and order are not identifiable ✅[^10]; lab order `[0 2 1]`, sign `−0.999` ✅[^21] |
| Outliers in the data | A kurtosis-based contrast can be decided by a few points | Kurtosis is not robust ✅[^14]; slowly growing `G` (log cosh) is ✅[^16] |
| Noisy measurements | The basic ICA model has no noise term | ✅[^9]; keep fewer components while whitening, which often reduces noise ✅[^17] |
| More sensors than sources | Set `n_components` below the number of features | Whitening can drop small eigenvalues at the same time ✅[^17]; `whitening_` projects on the first principal components ✅[^3] |
| `ConvergenceWarning` from `FastICA` | Iterations stopped at `max_iter` | The message suggests raising `tol` or `max_iter`; only the parallel loop warns, the deflation loop stops silently ✅[^5] |
| Need a likelihood or new samples | FA has `score`; many ICA variants do not represent `p(h)` at all | ✅[^2] ✅[^8] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `PCA` | Closed form, faster than FA ✅[^2] | One noise level for every feature (probabilistic PCA) ✅[^1]; a noisy feature captures a component ✅[^21] |
| `FactorAnalysis` | Per-feature noise, better likelihood under heteroscedastic noise ✅[^1]; posterior factor means from `transform` ✅[^2] | Iterative fit ✅[^4]; loadings only up to rotation (pick one with `rotation`) ✅[^1] ✅[^21] |
| `FastICA` | Recovers non-Gaussian independent sources that PCA cannot ✅[^6] ✅[^21]; 3 iterations in the lab after whitening ✅[^21] | Needs non-Gaussian sources ✅[^12]; no noise model ✅[^9]; order, sign and scale lost ✅[^10] |
| Kurtosis-like contrast (`fun="cube"`, `g(u) = u³` ✅[^5]) | Simple, cheap ✅[^14] ✅[^16] | Sensitive to outliers ✅[^14] |
| Log cosh contrast (the default `G` ✅[^3]) | Grows slowly, so it is robust ✅[^16] | An approximation, not negentropy itself ✅[^16] |

## Takeaways
- If features have very different noise levels, compare `FactorAnalysis` and `PCA` by held-out `score` before trusting PCA's components. [rule-candidate]
- Never interpret unrotated FA loadings as "the" factors; state the rotation used. [rule-candidate]
- Use ICA to unmix signals, not to compress data; check that the sources are plausibly non-Gaussian (kurtosis far from 0) first.
- Match ICA outputs to anything by correlation, allowing any order and sign.

## Verification status
- Verified: 111 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [Decomposing signals in components, §2.5.5 Factor Analysis and §2.5.6 ICA (scikit-learn User Guide)](https://scikit-learn.org/stable/modules/decomposition.html) — scikit-learn developers, living (1.9.1). Backs: the FA model, `Ψ` choices, probabilistic PCA, low-rank Gaussian, heteroscedastic noise, no general statements on components, varimax, ICA usage and whitening. [^1]
- [sklearn.decomposition.FactorAnalysis](https://scikit-learn.org/stable/modules/generated/sklearn.decomposition.FactorAnalysis.html) — scikit-learn developers, living (1.9.1). Backs: SVD-based maximum likelihood, `tol`, `max_iter`, `rotation`, Kaiser 1958, `transform`, `get_covariance`, `score`, probabilistic PCA's closed form. [^2]
- [sklearn.decomposition.FastICA](https://scikit-learn.org/stable/modules/generated/sklearn.decomposition.FastICA.html) — scikit-learn developers, living (1.9.1). Backs: defaults, `algorithm`, `fun`, `components_`, `mixing_`, `whitening_`. [^3]
- [sklearn/decomposition/_factor_analysis.py at 1.9.1](https://raw.githubusercontent.com/scikit-learn/scikit-learn/1.9.1/sklearn/decomposition/_factor_analysis.py) — scikit-learn source code, 2026. Backs: the fit iteration, the noise-variance update, the orthogonal rotation. [^4]
- [sklearn/decomposition/_fastica.py at 1.9.1](https://raw.githubusercontent.com/scikit-learn/scikit-learn/1.9.1/sklearn/decomposition/_fastica.py) — scikit-learn source code, 2026. Backs: the fixed-point update, convergence test, deflation and symmetric decorrelation, the `g` functions, the convergence warning. [^5]
- [Blind source separation using FastICA](https://scikit-learn.org/stable/auto_examples/decomposition/plot_ica_blind_source_separation.html) — scikit-learn developers, living. Backs: PCA fails on non-Gaussian sources; the three signals and mixing matrix reused in the lab. [^6]
- [Factor Analysis (with rotation) to visualize patterns](https://scikit-learn.org/stable/auto_examples/decomposition/plot_varimax_fa.html) — scikit-learn developers, living. Backs: rotation helps reading, not prediction. [^7]
- [Deep Learning, chapter 13: Linear Factor Models](https://www.deeplearningbook.org/contents/linear_factors.html) — Goodfellow, Bengio, Courville, 2016. Backs: the model family, FA prior and marginal, EM for probabilistic PCA, `σ → 0` limit, ICA needs non-Gaussian factors, ICA variants without `p(h)`. [^8]
- [Independent Component Analysis: A Tutorial — Definition of ICA](https://web.archive.org/web/20191227172652/http://cis.legacy.ics.tkk.fi/aapo/papers/IJCNN99_tutorialweb/node3.html) — Hyvärinen, Oja, 1999 (archived web version; revised as "Independent Component Analysis: Algorithms and Applications", Neural Networks 13(4–5), 2000). Backs: `x = A s`, square `A`, `s = W x`, blind source separation, no noise term. [^9]
- [ICA tutorial — Ambiguities of ICA](https://web.archive.org/web/20191227172652/http://cis.legacy.ics.tkk.fi/aapo/papers/IJCNN99_tutorialweb/node4.html) — Hyvärinen, Oja, 1999 (archived). Backs: scale, sign and order ambiguities. [^10]
- [ICA tutorial — Uncorrelated variables are only partly independent](https://web.archive.org/web/20191227172652/http://cis.legacy.ics.tkk.fi/aapo/papers/IJCNN99_tutorialweb/node8.html) — Hyvärinen, Oja, 1999 (archived). Backs: the four-point example. [^11]
- [ICA tutorial — Why Gaussian variables are forbidden](https://web.archive.org/web/20191227172652/http://cis.legacy.ics.tkk.fi/aapo/papers/IJCNN99_tutorialweb/node9.html) — Hyvärinen, Oja, 1999 (archived). Backs: symmetric Gaussian density, identifiable only up to an orthogonal transform, one Gaussian allowed. [^12]
- [ICA tutorial — "Nongaussian is independent"](https://web.archive.org/web/20191227172652/http://cis.legacy.ics.tkk.fi/aapo/papers/IJCNN99_tutorialweb/node11.html) — Hyvärinen, Oja, 1999 (archived). Backs: the CLT argument, `2n` local maxima. [^13]
- [ICA tutorial — Kurtosis](https://web.archive.org/web/20191227172652/http://cis.legacy.ics.tkk.fi/aapo/papers/IJCNN99_tutorialweb/node13.html) — Hyvärinen, Oja, 1999 (archived). Backs: zero for a Gaussian, sub- and super-Gaussian, uniform and Laplace, outlier sensitivity, simplicity. [^14]
- [ICA tutorial — Negentropy](https://web.archive.org/web/20191227172652/http://cis.legacy.ics.tkk.fi/aapo/papers/IJCNN99_tutorialweb/node14.html) — Hyvärinen, Oja, 1999 (archived). Backs: Gaussian has maximum entropy, the definition, non-negativity, cost of estimation. [^15]
- [ICA tutorial — Approximations of negentropy](https://web.archive.org/web/20191227172652/http://cis.legacy.ics.tkk.fi/aapo/papers/IJCNN99_tutorialweb/node15.html) — Hyvärinen, Oja, 1999 (archived). Backs: comparing `E{G(y)}` with a standard Gaussian, `G(y) = y⁴`, slowly growing `G` is robust. [^16]
- [ICA tutorial — Whitening](https://web.archive.org/web/20191227172652/http://cis.legacy.ics.tkk.fi/aapo/papers/IJCNN99_tutorialweb/node26.html) — Hyvärinen, Oja, 1999 (archived). Backs: the whitening transform, orthogonal new mixing matrix, `n(n−1)/2` parameters, dimension reduction. [^17]
- [ICA tutorial — FastICA for one unit](https://web.archive.org/web/20191227172652/http://cis.legacy.ics.tkk.fi/aapo/papers/IJCNN99_tutorialweb/node29.html) — Hyvärinen, Oja, 1999 (archived). Backs: the iteration steps, convergence by direction, approximate Newton. [^18]
- [ICA tutorial — FastICA for several units](https://web.archive.org/web/20191227172652/http://cis.legacy.ics.tkk.fi/aapo/papers/IJCNN99_tutorialweb/node30.html) — Hyvärinen, Oja, 1999 (archived). Backs: deflation and symmetric decorrelation. [^19]
- [scipy.stats.kurtosis](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.kurtosis.html) — SciPy developers, living. Backs: the kurtosis definition and Fisher's convention. [^20]
- `machine-learning/lab-setup.md` — the lab where the FA, rotation, cocktail-party, by-hand FastICA and Gaussian-source script ran on 2026-11-25. [^21]

## Related
- `machine-learning/unsupervised-learning/principal-component-analysis.md` — the variance-maximizing decomposition FA is compared with, and PCA whitening.
- `machine-learning/unsupervised-learning/gaussian-mixtures-and-em.md` — EM, the other classic way to fit latent-variable models such as probabilistic PCA.
- `machine-learning/causal-inference/causal-discovery.md` — LiNGAM, which uses ICA's non-Gaussianity to orient causal edges.
- `machine-learning/foundations/information-theory.md` — differential entropy, the basis of negentropy.
- `machine-learning/generative-models/variational-autoencoders.md` — a non-linear latent-variable model.
- `machine-learning/speech-and-audio/audio-signals-and-features.md` — the signals a cocktail-party separation works on.
