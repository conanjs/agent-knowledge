---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/ml-systems
status: verified
applies-to: ["any", "scikit-learn 1.9.1", "PyTorch 2.15.0"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, ml-systems, domain-adaptation, covariate-shift, label-shift, importance-weighting, density-ratio, bbse, dann, gradient-reversal, h-divergence, distribution-shift]
---

# Domain adaptation: correcting covariate shift, label shift and domain gaps

## Summary
**TL;DR:** Domain adaptation trains on labelled data from a source distribution and uses unlabelled data from a target distribution to do well on the target. It works only under an assumption about what stayed the same. Under **covariate shift** (the inputs move, the labelling rule `p(y|x)` does not), weight each training example by `p_target(x) / p_source(x)`; a classifier trained to tell source from target estimates that ratio as `p/(1−p)`, and clipping the largest weights trades some bias for less variance. Under **label shift** (the class mix moves, what each class looks like does not), BBSE (black box shift estimation) recovers the new class mix from a classifier's confusion matrix, which must be invertible, and its predictions on the target, and the classes are then reweighted. **Domain-adversarial training** learns features a domain classifier cannot tell apart, through a gradient reversal layer. Theory bounds the target error by the source error plus a domain divergence plus the error of the best single model on both domains; when no such model exists, or the domains do not overlap, no method without target labels is guaranteed to succeed.
**Use this when:** a model meets data that differ from its training data, you have unlabelled examples of the new data, and you must choose between reweighting, re-estimating class priors, adversarial features or new labels; or you meet importance weights, BBSE, DANN (domain-adversarial neural networks) or the H-divergence.
**Not this doc:** detecting and monitoring the shift → `machine-learning/ml-systems/data-drift-and-monitoring.md`; inputs crafted by an attacker → `machine-learning/deep-learning/adversarial-robustness.md`; fine-tuning a pretrained network on a little labelled target data → `machine-learning/deep-learning/data-augmentation-and-transfer-learning.md`; skewed classes without a shift → `machine-learning/evaluation/class-imbalance.md`; KL (Kullback–Leibler) divergence and other ways to compare distributions → `machine-learning/foundations/information-theory.md`.

## Problem
A monitor that flags a shift does not say what to do about it. In the lab, the labelling rule never changes, yet moving where the inputs fall drops a source-trained classifier's target accuracy to 0.514, or to 0.100 for a far shift; and for a reweighted model the usual check, accuracy on held-out source data, misjudges the target accuracy by about 0.2 ✅[^10]. When only the class mix changes from (1/3, 1/3, 1/3) to (0.7, 0.2, 0.1), the model scores 0.743 where 0.821 is reachable, and the share of its own predictions per class (0.562 for class 0) underestimates the new prior of 0.7 ✅[^10]. Without target labels, every fix rests on an assumption: with no assumption on how `p(x, y)` changes, the task is impossible ✅[^2].

## Mental model
**Analogy:** an opinion poll. The survey (source) reached too many young people; to forecast the election (target), each respondent is reweighted by how much more common people like them are among voters than in the sample (covariate shift). If one respondent ends up standing for 300 voters, the forecast swings on that one answer (exploding weights), so pollsters cap the weights. A different case: a doctor knows how a disease shows up in tests, but this winter it is more common; from the test's known error rates and the share of positive tests, the new prevalence can be solved for (label shift). Domain-adversarial training is like teaching interviewers to describe people only in words that do not reveal which town they came from.

**Artifact:** what each correction assumes and needs, with this doc's lab results ✅[^10]:

| Shift | Held fixed | Correction | Needs | Lab |
|---|---|---|---|---|
| Covariate | `p(y|x)` ✅[^1] | Weight examples by `p_T(x)/p_S(x)` ✅[^1] | Unlabelled target inputs ✅[^1] | Target accuracy 0.514 → 0.934 |
| Label | `p(x|y)` ✅[^2] | Estimate `q(y)` with BBSE, weight classes by `q(y)/p(y)` ✅[^2] | A classifier with an invertible confusion matrix ✅[^2] | 0.743 → 0.821 |
| Unknown, features differ | (a representation shared by both) | Domain-adversarial features ✅[^3] | Unlabelled target inputs ✅[^3] | 0.669 → 0.847 (mean of 5 seeds) |
| Concept (`p(y|x)` itself) | nothing | New target labels, a few update steps ✅[^1] | Labels | — |

## How it works
### The identity behind reweighting
Training minimizes the average loss on source data, an estimate of the expected loss on the source distribution ✅[^1]. If `p_S` is the source density and `p_T` the target density, the target's expected loss equals the source's expected loss with each example multiplied by `p_T(x, y) / p_S(x, y)`, and importance-weighted ERM (empirical risk minimization) minimizes `Σᵢ wᵢ · ℓ(yᵢ, xᵢ)` with those weights ✅[^1] ✅[^2]. Example: a training point twice as likely under the target as under the source counts twice in the loss.

### Covariate shift: importance weights
1. **Assumption and weight.** `p(y|x)` is the same in both domains, so the weight reduces to `β(x) = p_T(x) / p_S(x)`; only unlabelled target inputs are needed to estimate it ✅[^1]. Shimodaira proposed weighting examples in ERM this way ✅[^2].
2. **Density ratio from a domain classifier.** Pool source inputs (label `z = 0`) and target inputs (`z = 1`) in equal numbers and train a classifier. Then `P(z = 1 | x) / P(z = 0 | x) = p_T(x) / p_S(x)` ✅[^1], so `w = p/(1 − p)` with `p` the predicted probability of "target": `p = 0.8` gives `w = 4`. With a logistic classifier of score `h(x)` this is `w = exp(h(x))` ✅[^1]. Bickel et al. solve covariate shift discriminatively in this spirit, modelling neither density explicitly ✅[^9]. With unequal pool sizes, multiply by `n_source / n_target` (Bayes' rule with the pool's class sizes).
3. **Algorithm.** (a) Build the source-versus-target dataset; (b) train the domain classifier; (c) weight each training example by `exp(h(xᵢ))`, or better by `min(exp(h(xᵢ)), c)` for a constant `c`; (d) train the real model with those weights ✅[^1].
4. **Overlap is required.** Every target input must have had a nonzero chance in training: where `p_T(x) > 0` but `p_S(x) = 0` the weight is infinite ✅[^1].
5. **Variance.** Cortes et al. point out simple cases where importance weighting can fail, and give learning guarantees for unbounded weights under the weak assumption that their second moment is bounded, a condition related to the Rényi divergence (one more measure of how far apart two distributions are) between training and test distributions ✅[^8]. Lipton et al. warn that estimated weights can bring large variance, and that a biased unweighted fit can be preferable to a high-variance weighted one ✅[^2]. Lab: the mean of the squared normalized weights is 7.2 for a moderate shift and 174.3 for a far one; across 40 runs the weighted model's accuracy has standard deviation 0.010 and 0.082 ✅[^10].
6. **Model selection needs weights too.** Under covariate shift, ordinary cross-validation loses its unbiasedness; importance-weighted cross-validation (IWCV) is unbiased even under covariate shift ✅[^7]. Lab: plain source validation is off by −0.196, the weighted estimate by −0.001 ✅[^10].

### Label shift: black box shift estimation
1. **Assumption.** `p(x|y)` is unchanged while `p(y)` moves; Lipton et al. call it the anticausal case, as when diseases cause symptoms ✅[^2]. The weight per class is `w(y) = q(y) / p(y)`, target prior over source prior ✅[^2].
2. **Key fact.** For a fixed classifier `f` with prediction `ŷ = f(x)`, label shift implies `q(ŷ | y) = p(ŷ | y)`: its error rates per true class are the same in both domains ✅[^2].
3. **Solve a linear system.** With `C[i, j] = p_S(f(x) = i, y = j)`, the joint confusion matrix measured on held-out source data, and `μ̂[i]` the share of target inputs predicted as class `i`: `μ̂ = C · w`, so `ŵ = C⁻¹ μ̂`, and the new priors are `q̂(y) = p̂_S(y) · ŵ(y)` ✅[^2]. Worked numbers: two balanced classes, a classifier right 80 % of the time, so `C = [[0.4, 0.1], [0.1, 0.4]]`; on the target it predicts class 0 for 62 %. Solving `0.4·w₀ + 0.1·w₁ = 0.62` and `0.1·w₀ + 0.4·w₁ = 0.38` gives `w = (1.4, 0.6)` and `q̂ = 0.5 · w = (0.7, 0.3)`: the true prevalence is 70 %, not the 62 % the classifier predicts.
4. **What it needs.** An invertible expected confusion matrix; the classifier may be biased, inaccurate or uncalibrated ✅[^2]. Every class seen in the target must appear in training ✅[^2]. The estimator is consistent ✅[^2], and Lipton et al. suggest choosing the black box by the smallest singular value of its confusion matrix, which source data alone can measure ✅[^2].
5. **Correction (BBSC, black box shift correction).** Split the labelled data: train `f` on one half, estimate `C` on the other; if the smallest singular value of `C` is at most a threshold `δ`, use `ŵ = 1`, otherwise `ŵ = C⁻¹ μ̂`; then retrain with weights `max(ŵ, 0)`, since rare target classes can get negative estimates ✅[^2].
6. **Two forms of the same system.** Lipton et al. write it both ways: `μ̂ = C_{ŷ|y} · q(y)` with the conditional matrix `C_{ŷ|y}[i, j] = p_S(f(x) = i | y = j)`, and `μ̂ = C · w` with the joint matrix `C` above ✅[^2]. Dive into Deep Learning (which writes `p` for the target and `q` for the source, the reverse of this section) solves, in this section's notation, `C · q(y) = μ̂` for the target label distribution directly, but defines each cell of `C` as a joint fraction (true label `j` and prediction `i`, over all validation predictions) ✅[^1]; with that joint matrix the solution is `w`, not `q(y)`. In the worked numbers above, the joint `C` gives `(1.4, 0.6)`, which does not sum to 1; the conditional matrix `[[0.8, 0.2], [0.2, 0.8]]` gives `q(y) = (0.7, 0.3)` directly.

### Domain-adversarial training (in outline)
1. **Idea.** Domain-adaptation theory suggests making predictions from features that cannot discriminate between source and target ✅[^3].
2. **Three parts.** A feature extractor `G_f`, a label predictor `G_y` on source examples, and a domain classifier `G_d` on all examples; training seeks a saddle point of `E = L_y − λ · L_d`, where `L_y` is the label loss on source examples, `L_d` the domain-classification loss on all examples and `λ` the weight between them; the label and feature parts minimize `E` and the domain classifier maximizes it ✅[^3].
3. **Gradient reversal layer.** Placed between `G_f` and `G_d`, it is the identity in the forward pass and multiplies the gradient by −1 in the backward pass, with no parameters; ordinary SGD (stochastic gradient descent) on the network then performs the saddle-point updates ✅[^3]. The features are thus pushed to make the domain classifier fail, while the domain classifier itself still learns to succeed. Lab: forward `[1.0, 2.0]` unchanged, gradient `[−0.5, −0.5]` at `λ = 0.5` ✅[^10].
4. **Schedule.** Ganin et al. raise `λ` from 0 toward 1 as `λ_p = 2 / (1 + exp(−10 · p)) − 1`, with `p` the training progress from 0 to 1, so the domain signal, noisy early on, matters less at first ✅[^3]. Example: `p = 0.1` gives `λ = 0.46`; `p = 0.5` gives `0.99`.
5. **Their toy problem.** Two interleaved moons as the source and the same moons rotated by 35° as the unlabelled target, 300 points each; the standard network classifies the source but is not fully adapted to the target, while DANN's boundary classifies both ✅[^3]. The lab repeats this setup (Worked example, part 3).

### The bound: source error, divergence and joint error
1. **H-divergence.** For a class `H` of binary classifiers, `d_H(S, T) = 2 · sup_{η ∈ H} |Pr_S[η(x) = 1] − Pr_T[η(x) = 1]|`: how well classifiers from `H` can tell the domains apart ✅[^3].
2. **Proxy A-distance (PAD).** Train a domain classifier and measure its test error `ε`; then `d̂_A = 2 · (1 − 2ε)` ✅[^3]. A classifier at chance (`ε = 0.5`) gives 0; one with `ε = 0.1` gives 1.6.
3. **The bound.** With probability at least `1 − δ`, for every `h` in a class of VC (Vapnik–Chervonenkis) dimension `d` and samples of size `n`: `ε_T(h) ≤ ε̂_S(h) + ½ · d_HΔH(D̂_S, D̂_T) + λ* + O(√((d · log n + log(1/δ)) / n))`, where `ε_T` is the target error, `ε̂_S` the empirical source error, `d_HΔH` the divergence measured with the symmetric-difference class, and `λ* = min_h [ε_S(h) + ε_T(h)]` the best joint error any single classifier achieves ✅[^6]. Ganin et al. state the same idea with the empirical H-divergence and a term `β ≥ inf [R_S + R_T]` ✅[^3]. Ben-David et al. introduced it as a generalization bound for domain adaptation that illustrates the trade-offs in designing a representation ✅[^4].
4. **Reading it.** The bound promises a small target error only when one classifier does well on both domains; and with the hypothesis class fixed, a learner should trade off low source error against a small divergence, for example by finding a representation in which the domains are indistinguishable ✅[^3].

### When adaptation is impossible
1. **No overlap, or no good joint model.** Without either similar unlabelled distributions or a classifier with low error on both domains, the remaining assumptions, covariate shift included, do not guarantee success for any algorithm without target labels ✅[^5].
2. **Reweighting can mislead.** Some domain-adaptation tasks look identical in their input data, yet reweighting improves one and badly damages the other ✅[^5].
3. **Invariant features are not enough.** Zhao et al. build a counterexample in which features are perfectly aligned and the source error is small, yet the target error is large; they prove a lower bound on the joint error of invariant-representation methods when the label distributions of the domains differ ✅[^6]. Methods of this kind have failed on closely related pairs such as MNIST (handwritten digits) to SVHN (house-number photos) ✅[^6].
4. **Concept shift.** When the labelling rule itself changes, collect new labels; for gradual change, a few update steps on new data from the existing weights ✅[^1].

## Worked example
One script, three parts. **Part 1:** a fixed rule, label 1 when `x2 > x1² − 1` (plus noise); source inputs from a standard normal; target inputs centred at (1.5, 0.5) or, farther, at (2.5, 2.0). A linear logistic regression is fitted unweighted, with the true density ratio, with domain-classifier weights (logistic regression on degree-2 features), and with weights clipped at 20 and at 5; 40 runs each, then the target accuracy of the clipped-at-20 model is estimated from source validation data, plainly and with weights. **Part 2:** three Gaussian classes, priors moving from uniform to (0.7, 0.2, 0.1), once well apart and once with classes 1 and 2 overlapping; BBSE, then weighted retraining. **Part 3:** DANN on the rotated moons, 5 seeds, against the same network with the domain head trained on detached features (it watches but cannot push back). In the output, IW means importance-weighted and sd standard deviation. Core lines:

```python
p = dom.predict_proba(poly.transform(XS))[:, 1]; w = p / (1 - p)      # density ratio, equal pool sizes
np.add.at(C, (f.predict(X2), y2), 1 / len(y2))                      # C[i, j] = p_S(f(x) = i, y = j)
w = np.linalg.solve(C, mu); q_hat = np.bincount(y2, minlength=3) / len(y2) * w   # BBSE
def backward(ctx, g): return -ctx.lam * g, None                     # gradient reversal
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-25, numpy 2.5.5, scipy 1.18.1, scikit-learn 1.9.1, PyTorch 2.15.0 on the CPU (central processing unit), two runs identical ✅[^10]:

```text
== 1. covariate shift: source x ~ N(0, I); 40 runs, 1,000 labelled source + 1,000 unlabelled target points ==
target x centred at (1.5, 0.5): mean of squared normalized weights 7.2 (median of runs)
  target accuracy source-only               mean 0.514  sd 0.025  worst 0.461
  target accuracy IW, true density ratio    mean 0.935  sd 0.010  worst 0.915
  target accuracy IW, domain classifier     mean 0.934  sd 0.010  worst 0.908
  target accuracy IW, clipped at 20         mean 0.936  sd 0.009  worst 0.916
  target accuracy IW, clipped at 5          mean 0.933  sd 0.009  worst 0.910
  target accuracy trained on target labels  mean 0.941  sd 0.005  worst 0.931
  target-accuracy estimate from source validation, error mean/sd: plain -0.196/0.021  IW -0.001/0.023  IW clipped at 5 +0.004/0.016
target x centred at (2.5, 2.0): mean of squared normalized weights 174.3 (median of runs)
  target accuracy source-only               mean 0.100  sd 0.011  worst 0.080
  target accuracy IW, true density ratio    mean 0.907  sd 0.084  worst 0.646
  target accuracy IW, domain classifier     mean 0.906  sd 0.082  worst 0.641
  target accuracy IW, clipped at 20         mean 0.918  sd 0.070  worst 0.699
  target accuracy IW, clipped at 5          mean 0.918  sd 0.065  worst 0.723
  target accuracy trained on target labels  mean 0.976  sd 0.004  worst 0.968
  target-accuracy estimate from source validation, error mean/sd: plain -0.202/0.067  IW +0.033/0.081  IW clipped at 5 +0.039/0.076
== 2. label shift: p(x|y) fixed, class priors (1/3, 1/3, 1/3) -> (0.7, 0.2, 0.1) ==
classes apart: smallest singular value of C 0.2042
  target priors true [0.7 0.2 0.1]  share of predictions [0.562 0.243 0.195]  BBSE [0.711 0.195 0.093]
  target accuracy: unweighted 0.743  BBSE-weighted retrain 0.821  trained with target priors 0.821
classes 1 and 2 overlap: smallest singular value of C 0.0138
  target priors true [0.7 0.2 0.1]  share of predictions [0.628 0.155 0.217]  BBSE [0.687 0.102 0.21 ]
  target accuracy: unweighted 0.712  BBSE-weighted retrain 0.730  trained with target priors 0.795
== 3. domain-adversarial training on two moons, target rotated 35 degrees ==
gradient reversal: forward [1.0, 2.0], gradient of sum [-0.5, -0.5] at lambda 0.5
seed | source-only: source acc, target acc, domain-head acc | DANN: source acc, target acc, domain-head acc
   0 | 1.000 0.707 0.893 | 0.993 0.970 0.630
   1 | 1.000 0.660 0.888 | 1.000 0.907 0.630
   2 | 1.000 0.667 0.867 | 0.997 0.707 0.727
   3 | 1.000 0.673 0.875 | 1.000 0.687 0.680
   4 | 1.000 0.637 0.880 | 0.997 0.963 0.713
mean target accuracy over 5 seeds: source-only 0.669  DANN 0.847
```

<details><summary>Full script (prints the output above)</summary>

```python
# Correcting a known shift: (1) covariate shift with importance weights from a domain classifier,
# clipping, importance-weighted validation; (2) label shift with black-box shift estimation (BBSE);
# (3) domain-adversarial training with a gradient reversal layer on rotated two moons.
import math
import numpy as np
import torch
from scipy.stats import multivariate_normal as mvn
from sklearn.datasets import make_moons
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import PolynomialFeatures

rng = np.random.default_rng(0)
def label(X):                                        # the same rule p(y|x) in every domain
    return (X[:, 1] > X[:, 0] ** 2 - 1 + 0.3 * rng.normal(size=len(X))).astype(int)
def fit(X, y, w=None):                               # weights rescaled to mean 1 so the default penalty is comparable
    return LogisticRegression().fit(X, y, sample_weight=None if w is None else w / w.mean())

print("== 1. covariate shift: source x ~ N(0, I); 40 runs, 1,000 labelled source + 1,000 unlabelled target points ==")
mS, cS, cT = np.zeros(2), np.eye(2), np.diag([0.25, 1.0])
for mT in (np.array([1.5, 0.5]), np.array([2.5, 2.0])):
    acc = {k: [] for k in ["source-only", "IW, true density ratio", "IW, domain classifier",
                           "IW, clipped at 20", "IW, clipped at 5", "trained on target labels"]}
    err = {k: [] for k in ["plain", "IW", "IW clipped at 5"]}; m2 = []
    for _ in range(40):
        XS, XV, XT = rng.multivariate_normal(mS, cS, 1000), rng.multivariate_normal(mS, cS, 1000), rng.multivariate_normal(mT, cT, 1000)
        yS, yV, yT = label(XS), label(XV), label(XT)
        Xte = rng.multivariate_normal(mT, cT, 2000); yte = label(Xte)
        poly = PolynomialFeatures(2, include_bias=False)           # domain classifier: source = 0, target = 1
        dom = LogisticRegression(C=1e4, max_iter=5000).fit(poly.fit_transform(np.vstack([XS, XT])), np.r_[np.zeros(1000), np.ones(1000)])
        def weight(A):                                              # p/(1-p) = p_target(x) / p_source(x) for equal sample sizes
            p = dom.predict_proba(poly.transform(A))[:, 1]; return p / (1 - p)
        w = weight(XS); m2.append(np.mean((w / w.mean()) ** 2))
        w_true = mvn(mT, cT).pdf(XS) / mvn(mS, cS).pdf(XS)
        for k, model in [("source-only", fit(XS, yS)), ("IW, true density ratio", fit(XS, yS, w_true)),
                         ("IW, domain classifier", fit(XS, yS, w)), ("IW, clipped at 20", fit(XS, yS, np.minimum(w, 20))),
                         ("IW, clipped at 5", fit(XS, yS, np.minimum(w, 5))), ("trained on target labels", fit(XT, yT))]:
            acc[k].append(model.score(Xte, yte))
        model = fit(XS, yS, np.minimum(w, 20))                      # estimate its target accuracy from source validation data
        ok, wv = model.predict(XV) == yV, weight(XV); truth = model.score(Xte, yte)
        err["plain"].append(ok.mean() - truth)
        err["IW"].append(np.sum(wv * ok) / wv.sum() - truth)
        err["IW clipped at 5"].append(np.sum(np.minimum(wv, 5) * ok) / np.minimum(wv, 5).sum() - truth)
    print(f"target x centred at ({mT[0]}, {mT[1]}): mean of squared normalized weights {np.median(m2):.1f} (median of runs)")
    for k, v in acc.items():
        print(f"  target accuracy {k:<25} mean {np.mean(v):.3f}  sd {np.std(v):.3f}  worst {np.min(v):.3f}")
    print("  target-accuracy estimate from source validation, error mean/sd: "
          + "  ".join(f"{k} {np.mean(v):+.3f}/{np.std(v):.3f}" for k, v in err.items()))

print("== 2. label shift: p(x|y) fixed, class priors (1/3, 1/3, 1/3) -> (0.7, 0.2, 0.1) ==")
p_src, q_tgt = np.full(3, 1 / 3), np.array([0.7, 0.2, 0.1])
def sample(n, prior, means):
    y = rng.choice(3, size=n, p=prior); return means[y] + rng.normal(size=(n, 2)), y
for name, means in [("classes apart", np.array([[0.0, 0.0], [2.0, 0.0], [1.0, 1.7]])),
                    ("classes 1 and 2 overlap", np.array([[0.0, 0.0], [2.0, 0.0], [2.0, 0.1]]))]:
    X1, y1 = sample(3000, p_src, means); X2, y2 = sample(3000, p_src, means); XT, yT = sample(5000, q_tgt, means)
    f = LogisticRegression().fit(X1, y1)                           # the black box, trained on source split 1
    C = np.zeros((3, 3)); np.add.at(C, (f.predict(X2), y2), 1 / len(y2))   # C[i, j] = p_source(f(x) = i, y = j), split 2
    mu = np.bincount(f.predict(XT), minlength=3) / len(XT)        # share of target points predicted as each class
    w = np.linalg.solve(C, mu)                                     # w = q(y) / p(y)
    q_hat = np.bincount(y2, minlength=3) / len(y2) * w
    retrained = LogisticRegression().fit(X1, y1, sample_weight=np.maximum(w, 0)[y1])
    oracle = LogisticRegression().fit(*sample(3000, q_tgt, means))
    print(f"{name}: smallest singular value of C {np.linalg.svd(C, compute_uv=False).min():.4f}")
    print(f"  target priors true {q_tgt}  share of predictions {np.round(mu, 3)}  BBSE {np.round(q_hat, 3)}")
    print(f"  target accuracy: unweighted {f.score(XT, yT):.3f}  BBSE-weighted retrain {retrained.score(XT, yT):.3f}"
          f"  trained with target priors {oracle.score(XT, yT):.3f}")

print("== 3. domain-adversarial training on two moons, target rotated 35 degrees ==")
class GradReverse(torch.autograd.Function):          # identity forward, gradient times -lambda backward
    @staticmethod
    def forward(ctx, x, lam): ctx.lam = lam; return x.view_as(x)
    @staticmethod
    def backward(ctx, g): return -ctx.lam * g, None
x = torch.tensor([1.0, 2.0], requires_grad=True); out = GradReverse.apply(x, 0.5); out.sum().backward()
print(f"gradient reversal: forward {out.tolist()}, gradient of sum {x.grad.tolist()} at lambda 0.5")
Xs, ys = make_moons(300, noise=0.1, random_state=0); centre = Xs.mean(0)
Xt, yt = make_moons(300, noise=0.1, random_state=1); t = math.radians(35)
Xt = (Xt - centre) @ np.array([[math.cos(t), -math.sin(t)], [math.sin(t), math.cos(t)]]).T + centre
m, s = Xs.mean(0), Xs.std(0)
S, T = (torch.tensor((A - m) / s, dtype=torch.float32) for A in (Xs, Xt)); Ys = torch.tensor(ys, dtype=torch.float32)
d = torch.cat([torch.zeros(300), torch.ones(300)])
bce = torch.nn.functional.binary_cross_entropy_with_logits
def train(adapt, seed, steps=2000):
    torch.manual_seed(seed)
    F = torch.nn.Sequential(torch.nn.Linear(2, 32), torch.nn.ReLU(), torch.nn.Linear(32, 32), torch.nn.ReLU())
    Gy = torch.nn.Linear(32, 1)
    Gd = torch.nn.Sequential(torch.nn.Linear(32, 32), torch.nn.ReLU(), torch.nn.Linear(32, 1))
    opt = torch.optim.Adam([*F.parameters(), *Gy.parameters(), *Gd.parameters()], lr=3e-3)
    for step in range(steps):
        lam = 2 / (1 + math.exp(-10 * step / steps)) - 1    # Ganin et al.'s schedule from 0 towards 1
        fs, ft = F(S), F(T); h = torch.cat([fs, ft])
        h = GradReverse.apply(h, lam) if adapt else h.detach()  # source-only: domain head watches, cannot push back
        loss = bce(Gy(fs).squeeze(1), Ys) + bce(Gd(h).squeeze(1), d)
        opt.zero_grad(); loss.backward(); opt.step()
    with torch.no_grad():
        acc_s = ((Gy(F(S)).squeeze(1) > 0).numpy() == ys).mean()
        acc_t = ((Gy(F(T)).squeeze(1) > 0).numpy() == yt).mean()
        acc_d = ((Gd(torch.cat([F(S), F(T)])).squeeze(1) > 0).float() == d).float().mean().item()
    return acc_s, acc_t, acc_d
print("seed | source-only: source acc, target acc, domain-head acc | DANN: source acc, target acc, domain-head acc")
res = {False: [], True: []}
for seed in range(5):
    for adapt in (False, True):
        res[adapt].append(train(adapt, seed))
    print(f"{seed:4d} | {res[False][-1][0]:.3f} {res[False][-1][1]:.3f} {res[False][-1][2]:.3f}"
          f" | {res[True][-1][0]:.3f} {res[True][-1][1]:.3f} {res[True][-1][2]:.3f}")
print(f"mean target accuracy over 5 seeds: source-only {np.mean([r[1] for r in res[False]]):.3f}"
      f"  DANN {np.mean([r[1] for r in res[True]]):.3f}")
```

</details>

Reading it, block by block:
- **Moderate covariate shift:** a linear model cannot follow the curved rule everywhere, so where its training points sit decides which part of the curve it fits. Unweighted, it fits the source region and scores 0.514 on the target; weighted by the domain classifier it scores 0.934, as good as the true density ratio (0.935) and close to a model trained on target labels (0.941) ✅[^10]. Weights are tame (mean square 7.2) and clipping changes almost nothing.
- **Far covariate shift:** the mean squared weight jumps to 174.3: a few source points carry most of the weight. The weighted model still averages 0.906, but varies from run to run (standard deviation 0.082, worst 0.641). Clipping at 5 gives a slightly higher mean (0.918) and a better worst run (0.723), the bias–variance trade clipping is for ✅[^10].
- **Estimating target accuracy:** plain source validation underestimates by about 0.2 in both settings, because the weighted model was tuned for the target region. Weighting the validation points removes that error at the moderate shift (−0.001); at the far shift the weighted estimate is noisy (standard deviation 0.081) ✅[^10].
- **Label shift, classes apart:** BBSE recovers the new priors, (0.711, 0.195, 0.093) for (0.7, 0.2, 0.1), while the raw share of predictions says 0.562 for class 0; retraining with the BBSE weights reaches 0.821, the accuracy of a model trained with the true target priors ✅[^10].
- **Label shift, overlapping classes:** the classifier can barely tell classes 1 and 2 apart, the smallest singular value of `C` falls from 0.204 to 0.014, and BBSE mixes up their priors (0.102 and 0.21 for 0.2 and 0.1); the retrain gains little (0.730 against 0.795) ✅[^10].
- **DANN:** the reversed gradient is `−λ` times the incoming one. Without adaptation the domain head separates source from target features 87–89 % of the time and target accuracy stays at 0.637–0.707; with gradient reversal the domain head drops to 63–73 % and the mean target accuracy rises to 0.847. Seeds 2 and 3 barely improved (0.707, 0.687): adversarial training is unstable from run to run in this toy ✅[^10].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Target inputs where the source has none | Infinite weight; no reweighting can help | Overlap assumption ✅[^1]; without similar input distributions, no guarantee ✅[^5] |
| A few huge weights | High variance (lab worst run 0.641 at mean square weight 174.3) | Cortes et al.'s guarantees assume a bounded second moment ✅[^8] ✅[^10] |
| Clipping weights at `c` | Lower variance, some bias (lab worst run 0.641 → 0.723) | `min(exp(h), c)` ✅[^1]; lab ✅[^10] |
| Choosing hyperparameters with plain source validation | Wrong target estimate (lab −0.196) | Cross-validation loses its unbiasedness under covariate shift; use IWCV ✅[^7] ✅[^10] |
| Domain classifier trained on pools of unequal size | Ratio off by `n_target/n_source` | `p/(1−p)` = density ratio only for equal pools ✅[^1] |
| Logistic-regression weights taken as exact | No guarantee they are correct | Lipton et al. note the heuristic lacks such justification ✅[^2] |
| Near-singular confusion matrix in BBSE | Wild prior estimates (lab 0.102/0.21 for 0.2/0.1) | Needs an invertible `C` ✅[^2]; fall back to `ŵ = 1` below a threshold ✅[^2] |
| BBSE gives a negative weight | Weighted loss would be maximized | Clip to 0 ✅[^2] |
| A target class absent from training | Cannot be estimated | Target label support must lie within the source's ✅[^2] |
| Both covariate and label assumptions fail (a hidden cause of `x` and `y`) | Neither correction is valid | Lipton et al. propose a kernel two-sample check of the label-shift assumption ✅[^2] |
| Aligned features, different class mix across domains | Target error can grow as alignment improves | Lower bound for invariant representations ✅[^6] |
| DANN run to run | Large spread (lab 0.687–0.970 over 5 seeds) | Training seeks a saddle point, not a minimum ✅[^3]; the spread is this lab's observation ✅[^10] |
| Labelling rule changed (concept shift) | Reweighting cannot help | New labels needed ✅[^1] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Importance weighting | Unlabelled target inputs suffice ✅[^1]; lab 0.514 → 0.934 ✅[^10] | Needs overlap ✅[^1]; estimated weights can bring large variance ✅[^2]; lab sd 0.082 at the far shift ✅[^10] |
| Clipped weights | Lower variance; better worst run (lab) ✅[^10] | Bias; one more constant `c` ✅[^1] |
| BBSE / BBSC | Any black-box classifier; accuracy does not depend on input dimension ✅[^2] | Only for label shift; needs an invertible confusion matrix ✅[^2] |
| Domain-adversarial training | No labelled target data; fits almost any feed-forward network ✅[^3] | Unstable (lab) ✅[^10]; can hurt when the class mix differs ✅[^6] |
| Collect target labels | Handles every shift, concept shift included ✅[^1]; lab 0.976 at the far shift ✅[^10] | Labelling cost and delay |

## Takeaways
- Name the assumption first (covariate, label or concept shift); each correction is valid only under its own. [rule-candidate]
- When reweighting, report the largest weights or their mean square, and clip or stop when a few points carry most of the weight. [rule-candidate]
- Validate under covariate shift with importance-weighted validation, never plain source validation.
- For label shift, estimate the new priors with BBSE instead of reading them off the model's predicted class shares.
- Run domain-adversarial training with several seeds, and keep a small labelled target set to check it.

## Verification status
- Verified: 96 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [Environment and Distribution Shift (Dive into Deep Learning, 4.7)](https://d2l.ai/chapter_linear-classification/environment-and-distribution-shift.html) — Aston Zhang, Zachary C. Lipton, Mu Li, Alexander J. Smola, living. Backs: empirical risk and risk, the reweighting identity, `β = p/q`, unlabelled target inputs suffice, the logistic domain classifier and `exp(h)`, the four-step algorithm with `min(exp(h), c)`, the overlap requirement, label-shift weights and its confusion-matrix system `C p(y) = μ(ŷ)` with joint-fraction cells, concept-shift handling. [^1]
- [Detecting and Correcting for Label Shift with Black Box Predictors](https://arxiv.org/html/1802.03916v3) — Zachary C. Lipton, Yu-Xiang Wang, Alexander J. Smola, 2018. Backs: impossibility without assumptions, label shift and anticausal learning, `w(y) = q(y)/p(y)`, importance-weighted ERM, Lemma 1, the BBSE estimator and its conditional and joint matrix forms, assumptions A.1–A.3, consistency, smallest singular value, Algorithm 1 (BBSC) with the threshold and clipping, Shimodaira's weighting, the weak justification and variance of logistic-regression weights, the kernel check. [^2]
- [Domain-Adversarial Training of Neural Networks](https://arxiv.org/html/1505.07818v4) — Yaroslav Ganin et al., JMLR 2016 (arXiv HTML v4). Backs: invariant-feature idea, `G_f`/`G_y`/`G_d` and the saddle-point objective, the gradient reversal layer, the `λ_p` schedule, the rotated-moons toy, H-divergence, proxy A-distance, Theorem 2 and its reading. [^3]
- [Analysis of Representations for Domain Adaptation](https://papers.nips.cc/paper/2006/hash/b1b0432ceafb0ce714426e9114852ac7-Abstract.html) — Shai Ben-David, John Blitzer, Koby Crammer, Fernando Pereira, NIPS 2006 (abstract page). Backs: a generalization bound for domain adaptation showing the representation trade-offs. [^4]
- [Impossibility Theorems for Domain Adaptation](https://proceedings.mlr.press/v9/david10a.html) — Shai Ben-David, Tyler Lu, Teresa Luu, Dávid Pál, AISTATS 2010 (abstract page). Backs: covariate shift without similar input distributions or a good joint classifier is not sufficient; reweighting helps one indistinguishable task and hurts another. [^5]
- [On Learning Invariant Representation for Domain Adaptation](https://ar5iv.labs.arxiv.org/html/1901.09453) — Han Zhao, Remi Tachet des Combes, Kun Zhang, Geoffrey J. Gordon, 2019 (ar5iv HTML). Backs: the bound with `½ d_HΔH` and `λ*` (Ben-David et al.), the aligned-features counterexample, the lower bound when label distributions differ, MNIST-to-SVHN failures. [^6]
- [Covariate Shift Adaptation by Importance Weighted Cross Validation](https://www.jmlr.org/papers/v8/sugiyama07a.html) — Masashi Sugiyama, Matthias Krauledat, Klaus-Robert Müller, JMLR 2007 (abstract page). Backs: cross-validation loses unbiasedness under covariate shift; IWCV is unbiased. [^7]
- [Learning Bounds for Importance Weighting](https://papers.nips.cc/paper/2010/hash/59c33016884a62116be975a9bb8257e3-Abstract.html) — Corinna Cortes, Yishay Mansour, Mehryar Mohri, NIPS 2010 (abstract page). Backs: simple failure cases, guarantees for unbounded weights with a bounded second moment, the Rényi-divergence link. [^8]
- [Discriminative Learning Under Covariate Shift](https://www.jmlr.org/papers/v10/bickel09a.html) — Steffen Bickel, Michael Brückner, Tobias Scheffer, JMLR 2009 (abstract page). Backs: a purely discriminative solution that models neither distribution. [^9]
- `machine-learning/lab-setup.md` — the lab where the importance-weighting, BBSE and DANN script ran on 2026-11-25. [^10]

## Related
- `machine-learning/ml-systems/data-drift-and-monitoring.md` — detecting covariate, label and concept shift before correcting them.
- `machine-learning/deep-learning/data-augmentation-and-transfer-learning.md` — adapting with a little labelled target data instead.
- `machine-learning/evaluation/cross-validation-and-hyperparameter-search.md` — the validation that covariate shift biases.
- `machine-learning/evaluation/class-imbalance.md` — class weights, the same mechanism BBSC uses.
- `machine-learning/supervised-learning/discriminant-analysis.md` — a generative classifier whose priors can be reset for a new class mix.
- `machine-learning/learning-theory/pac-learning-and-vc-dimension.md` — the VC dimension in the bound.
- `machine-learning/foundations/information-theory.md` — KL divergence, another measure of how far two distributions are.
