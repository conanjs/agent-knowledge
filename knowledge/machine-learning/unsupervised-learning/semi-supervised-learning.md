---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/unsupervised-learning
status: verified
applies-to: ["scikit-learn 1.9.1", "PyTorch 2.15.0"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, semi-supervised-learning, self-training, pseudo-labels, confirmation-bias, label-propagation, label-spreading, graph, consistency-regularization, fixmatch, scikit-learn, pytorch]
---

# Semi-supervised learning: self-training, label spreading and pseudo-labels

## Summary
**TL;DR:** Semi-supervised learning trains on a few labelled rows plus many unlabelled ones, and the unlabelled rows help only through an assumption: points in the same dense cluster, or on the same smooth manifold, share a label, so the decision boundary should pass through empty space. Self-training lets a classifier label the unlabelled rows it is confident about and retrains on them; its own mistakes become training data, which can snowball (confirmation bias). Label propagation and label spreading pass labels along a similarity graph of all rows. Deep methods combine pseudo-labels with consistency regularization: FixMatch keeps a confident prediction on a weakly perturbed input and trains the model to make it on a strongly perturbed one. Unlabelled data can also hurt, so always compare with a well-tuned model trained on the labelled rows alone.
**Use this when:** you have a few hundred labels and many unlabelled rows, use `SelfTrainingClassifier`, `LabelPropagation` or `LabelSpreading`, pick a pseudo-label threshold, or read a semi-supervised result and want to know whether the baseline was fair.
**Not this doc:** pretraining on unlabelled data and contrastive learning → `machine-learning/deep-learning/embeddings-and-self-supervised-learning.md`; fine-tuning a pretrained network → `machine-learning/deep-learning/data-augmentation-and-transfer-learning.md`; learning on graph-structured inputs → `machine-learning/deep-learning/graph-neural-networks.md`; anomaly detection, sometimes called semi-supervised when fitted on clean data → `machine-learning/unsupervised-learning/anomaly-detection.md`.

## Problem
Labels cost money or expert time; unlabelled rows are often free. A model trained on 25 labelled digits reached 0.750 test accuracy in the lab, and the 1,232 unlabelled training images sitting next to them could carry the shape of each digit class ✅[^11]. But naive use of them backfires: in the same run, self-training with scikit-learn's default threshold of 0.75 dropped mean test accuracy from 0.750 to 0.246, because the model labelled the unlabelled images with its own errors and then learned from them ✅[^11]. Published comparisons mislead too: with the same tuning budget for every method, Oliver et al. found the gap between semi-supervised and labelled-only training smaller than usually reported, and unlabelled data from classes missing from the labelled set could make results worse than using no unlabelled data at all ✅[^8].

## Mental model
**Analogy:** a new clerk sorting a mailroom with only two letters labelled "north office" and "south office". Looking at the unlabelled pile, she sees the letters fall into two long heaps, so she labels each heap after the one labelled letter in it: that is the cluster assumption, and label spreading is passing the label from letter to nearest letter along each heap. Self-training is a different habit: she files the letters she feels sure about, then treats her own filing as ground truth for the rest. If her early guesses are good and cover both offices, the pile gets sorted; if her first sure guesses all go to one office, every later decision leans further that way.

**Artifact:** two interleaved half-moons, 600 points, one label per class; logistic regression on the two labelled points against label spreading on the graph of all 600 points, and the spreading fixed point computed by hand; printed by the full script in the Worked example, lab run (`machine-learning/lab-setup.md`), 2026-11-25, scikit-learn 1.9.1 ✅[^11]:

```text
== 1. two moons, one label per class ==
logistic regression on the 2 labelled points: test accuracy 0.865
LabelSpreading rbf alpha=0.2: labels given to the 598 unlabelled points 0.890 correct, test accuracy 0.885
LabelSpreading rbf alpha=0.99: labels given to the 598 unlabelled points 0.997 correct, test accuracy 0.998
closed form vs sklearn label_distributions_: max |diff| = 4.0e-11
```

Two labels and a straight line give 0.865; the same two labels spread along the moons give 0.998, but only when `alpha` lets a label travel many hops.

## How it works
### When unlabelled data can help
1. **An assumption is required.** scikit-learn's guide states that semi-supervised algorithms need assumptions about the data distribution to gain anything, and use the unlabelled rows to better capture the shape of that distribution ✅[^1]. Unlabelled rows are marked with the label `-1` in `y` ✅[^1].
2. **Low-density separation (cluster assumption):** many methods assume the decision boundary should not pass through high-density regions of the input distribution ✅[^7].
3. **Smoothness on the data's structure (manifold assumption):** the classifier should be smooth with respect to the structure that labelled and unlabelled points reveal together ✅[^6]; unlabelled data hints at the shape of the data manifold and so at a better boundary ✅[^8].

### Self-training
1. **Fit** the base classifier, any estimator with `predict_proba`, on the labelled rows ✅[^1].
2. **Predict** class probabilities for the unlabelled rows and **select** a subset: those whose top probability is above `threshold` (default 0.75), or the `k_best` most confident (default 10) ✅[^2].
3. **Add** the selected rows with their predicted labels (pseudo-labels) to the labelled set and refit; repeat until `max_iter` (default 10) rounds, no new pseudo-label, or every row labelled ✅[^2]. The method is based on Yarowsky's algorithm ✅[^1].
4. **Inspect** `labeled_iter_` (round in which each row was labelled, 0 for original labels, −1 for never), `transduction_` (the labels of the final fit) and `termination_condition_` ✅[^2].
5. **Calibration matters:** the guide calls the base classifier's calibration important ✅[^1], and the class reference page asks for a well-calibrated classifier with the threshold criterion ✅[^2] (`machine-learning/evaluation/probability-calibration.md`). A threshold is a promise about probabilities; an over- or under-confident model breaks it.
6. **Confirmation bias:** training on incorrect pseudo-labels raises the model's confidence in them, and the model then resists correction ✅[^9]. Arazo et al. reduce it in deep pseudo-labelling with soft pseudo-labels, mixup and a minimum number of labelled samples in every mini-batch ✅[^9].

### Graph methods: label propagation and label spreading
1. **Graph:** both build a similarity graph over all rows, labelled and unlabelled ✅[^1], with weight `W_ij = exp(−γ·‖x_i − x_j‖²)` (the RBF, radial basis function, kernel: `kernel='rbf'`, default `gamma=20`) or `1` when `x_j` is one of `x_i`'s `n_neighbors` nearest points (the kNN, k-nearest-neighbour, kernel: `kernel='knn'`, default 7) ✅[^1] ✅[^3]. Example: two points 0.2 apart with `γ = 20` get `W = exp(−20·0.04) = exp(−0.8) = 0.449`. The RBF graph is a dense `n × n` matrix; the kNN graph is sparse and much cheaper ✅[^1].
2. **Label propagation (hard clamping):** with `T` the row-normalized `W`, each iteration computes `F ← T·F`, renormalizes each row of `F` (one probability per class) and resets the labelled rows to their one-hot labels ✅[^5]; the guide calls this hard clamping, `α = 0` ✅[^1]. Default `max_iter=1000` ✅[^3].
3. **Label spreading (soft clamping):** with `S` the negated normalized graph Laplacian with its diagonal set to zero, and `Y` the one-hot labels (zero rows for unlabelled points), each iteration computes `F ← α·S·F + (1 − α)·Y` ✅[^5]. Off the diagonal that `S` is `D^(−1/2)·W·D^(−1/2)`, with `D` the diagonal matrix of the row sums of `W` (its own diagonal set to zero); the hand computation below uses exactly that ✅[^11]. `α` in `(0, 1)` is the share a point takes from its neighbours rather than its initial label; `α = 0.2` (the default) keeps 80 % of the original label distribution ✅[^1] ✅[^4]. The guide calls label spreading regularized and often more robust to noise ✅[^1]. Default `max_iter=30` ✅[^4].
4. **Fixed point:** solving `F = α·S·F + (1 − α)·Y` gives `F* = (1 − α)(I − α·S)⁻¹·Y`, with `I` the identity matrix; after normalizing each row, in the lab this matched `label_distributions_` to `4.0e-11` ✅[^11]. Unrolled, `F* = (1 − α)·Σ_k (α·S)^k·Y`: a label `k` hops away arrives scaled by `α^k`, for example `0.2³ = 0.008` but `0.99³ = 0.970`. Since each row is normalized at the end, what counts is how much the long paths along a moon weigh against the short direct links across the gap. That is why `α = 0.2` labelled only 0.890 of the moon points correctly and `α = 0.99` 0.997 ✅[^11].
5. **Transductive and inductive:** `transduction_` holds the labels assigned to the training rows ✅[^3]; for a new row, `predict_proba` weights the training rows' label distributions by the kernel between the new row and them, then normalizes ✅[^5].

### Deep semi-supervised learning: pseudo-labels and consistency
1. **Pseudo-labelling:** predictions whose class probability exceeds a threshold become targets for a standard supervised loss on the unlabelled data ✅[^8]. Hard one-hot pseudo-labels from confident predictions act as implicit entropy minimization ✅[^7].
2. **Consistency regularization:** realistic perturbations of an unlabelled input should not change the output much ✅[^8]. In its simplest form the loss is `‖p(y | Augment(x)) − p(y | Augment(x))‖²`, two random augmentations of the same `x` ✅[^7]. Variants: the Π-model compares two stochastic passes; Mean Teacher takes the target from an exponential moving average of past weights; VAT (virtual adversarial training) uses the small perturbation that changes the output most ✅[^8].
3. **Entropy minimization:** a loss term that pushes predictions on unlabelled data to be confident, whatever the class ✅[^8].
4. **FixMatch** combines the two: it pseudo-labels an unlabelled image from the model's prediction on a weakly augmented copy, keeps the pseudo-label only when the prediction is confident, and trains the model to predict it on a strongly augmented copy ✅[^10]. Its abstract reports 94.93 % accuracy on CIFAR-10 (a 10-class image benchmark from the Canadian Institute for Advanced Research) with 250 labels and 88.61 % with 40 ✅[^10]. The toy in the Worked example implements those three steps in an MLP (multilayer perceptron) with Gaussian noise as the augmentations: loss = cross-entropy on the labelled points + mean over unlabelled points of `1[max p(weak) ≥ 0.95] · cross-entropy(p(strong), argmax p(weak))`, where `p(weak)` and `p(strong)` are the predicted class probabilities on the weak and strong copies and `1[·]` is 1 when the condition holds and 0 otherwise ✅[^11].

### When it hurts
- **Class mismatch:** unlabelled data from classes absent from the labelled set can perform worse than no unlabelled data ✅[^8].
- **Unfair baselines:** with a labelled-only model given the same tuning budget, the gap is smaller than typically reported, and fine-tuning a model pretrained on a related labelled dataset beat every semi-supervised method Oliver et al. tested on CIFAR-10 with 4,000 labels (12.09 % error against 13.13 % for the best) ✅[^8].
- **Small validation sets:** a validation set of realistic size (10 % of the labelled training set) could not tell the methods apart ✅[^8].
- **Too few or badly placed labels and early mistakes:** self-training on digits and the FixMatch-style toy with one label per class both ended below their supervised baselines in the lab ✅[^11].

## Worked example
`load_digits` (8 × 8 pixel images of handwritten digits, pixel values scaled to [0, 1]), 30 % held out for testing, and 1 %, 2 % or 5 % of the 1,257 training rows labelled (stratified, five draws each). Compared: logistic regression on the labelled rows only, self-training of the same model at thresholds 0.75 and 0.95, and label spreading on a 7-nearest-neighbour graph with `α = 0.99`. Then one 2 % draw traced round by round, and the FixMatch-style toy on half-moons. The self-training trace comes from scikit-learn's own bookkeeping:

```python
st = SelfTrainingClassifier(LogisticRegression(max_iter=2000), threshold=0.75).fit(Xtr, ys)   # ys = -1 if unlabelled
for it in range(1, st.n_iter_ + 1):
    m = st.labeled_iter_ == it                     # rows pseudo-labelled in round `it`
    print(it, m.sum(), np.mean(st.transduction_[m] == ytr[m]))
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-25, scikit-learn 1.9.1, PyTorch 2.15.0, two runs identical; part 1 is the Mental model artifact ✅[^11]:

```text
== 2. load_digits, 30 % test; mean test accuracy over 5 draws of the labelled subset ==
1% labels (12 of 1257): supervised LR 0.576 | self-training t=0.75 0.576 | self-training t=0.95 0.576 | LabelSpreading knn 0.741
    pseudo-labels added (mean of 5): t=0.75 0, t=0.95 0
2% labels (25 of 1257): supervised LR 0.750 | self-training t=0.75 0.246 | self-training t=0.95 0.750 | LabelSpreading knn 0.880
    pseudo-labels added (mean of 5): t=0.75 1025, t=0.95 0
5% labels (62 of 1257): supervised LR 0.873 | self-training t=0.75 0.887 | self-training t=0.95 0.873 | LabelSpreading knn 0.925
    pseudo-labels added (mean of 5): t=0.75 995, t=0.95 0
== 3. confirmation bias: self-training, 2 % labels (draw 0), threshold 0.75 ==
supervised test accuracy 0.735 | largest predicted probability on an unlabelled point 0.785
iteration  1: added   7 pseudo-labels, 1.000 correct, per class [0, 1, 0, 0, 2, 0, 4, 0, 0, 0]
iteration  2: added  80 pseudo-labels, 1.000 correct, per class [0, 5, 0, 0, 12, 0, 63, 0, 0, 0]
iteration  3: added  97 pseudo-labels, 0.948 correct, per class [0, 16, 0, 0, 26, 0, 55, 0, 0, 0]
iteration  4: added  87 pseudo-labels, 0.701 correct, per class [0, 17, 0, 0, 45, 0, 25, 0, 0, 0]
iteration  5: added  89 pseudo-labels, 0.427 correct, per class [0, 11, 0, 0, 37, 0, 41, 0, 0, 0]
iteration  6: added 119 pseudo-labels, 0.134 correct, per class [0, 8, 0, 0, 35, 0, 76, 0, 0, 0]
iteration  7: added 180 pseudo-labels, 0.044 correct, per class [0, 6, 0, 0, 43, 0, 131, 0, 0, 0]
iteration  8: added 198 pseudo-labels, 0.025 correct, per class [0, 4, 0, 0, 42, 0, 152, 0, 0, 0]
iteration  9: added 140 pseudo-labels, 0.043 correct, per class [0, 6, 0, 0, 15, 0, 119, 0, 0, 0]
iteration 10: added  78 pseudo-labels, 0.051 correct, per class [0, 4, 0, 0, 3, 0, 71, 0, 0, 0]
self-training test accuracy 0.263 | stopped by max_iter
== 4. FixMatch-style toy (MLP, PyTorch): pseudo-label from a weak view, train on a strong view ==
noise 0.08, 1 label(s)/class: supervised vs FixMatch-style test accuracy per seed 0.851->0.837  0.751->0.706  0.692->0.489
noise 0.08, 5 label(s)/class: supervised vs FixMatch-style test accuracy per seed 0.854->0.997  0.899->1.000  0.781->0.999
noise 0.3, 5 label(s)/class: supervised vs FixMatch-style test accuracy per seed 0.700->0.738  0.787->0.883  0.717->0.688
```

<details><summary>Full script (prints the output above)</summary>

```python
# Semi-supervised learning: label spreading by hand on two moons, self-training vs label spreading
# on load_digits with 1-5 % labels (and a confirmation-bias trace), and a FixMatch-style toy in PyTorch.
import warnings
import numpy as np
import torch
from torch import nn
from sklearn.datasets import load_digits, make_moons
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split
from sklearn.semi_supervised import LabelSpreading, SelfTrainingClassifier
warnings.filterwarnings("ignore")                # ConvergenceWarning from short label-spreading runs

print("== 1. two moons, one label per class ==")
X, y = make_moons(n_samples=600, noise=0.08, random_state=0)
Xte, yte = make_moons(n_samples=1000, noise=0.08, random_state=1)
lab = np.array([np.flatnonzero(y == 0)[0], np.flatnonzero(y == 1)[0]])
ys = np.full(len(y), -1); ys[lab] = y[lab]       # -1 marks "unlabelled"
print("logistic regression on the 2 labelled points: test accuracy", LogisticRegression().fit(X[lab], y[lab]).score(Xte, yte))
for a in [0.2, 0.99]:
    ls = LabelSpreading(kernel="rbf", gamma=20, alpha=a).fit(X, ys)
    print(f"LabelSpreading rbf alpha={a}: labels given to the 598 unlabelled points {np.mean((ls.transduction_ == y)[ys == -1]):.3f} correct,"
          f" test accuracy {ls.score(Xte, yte):.3f}")
g, a = 20, 0.99                                  # the fixed point F* = (1 - a)(I - a S)^-1 Y, by hand
W = np.exp(-g * ((X[:, None] - X[None]) ** 2).sum(-1)); np.fill_diagonal(W, 0)
d = W.sum(1); S = W / np.sqrt(np.outer(d, d))    # S = D^-1/2 W D^-1/2
Y = np.zeros((len(y), 2)); Y[lab, y[lab]] = 1
F = (1 - a) * np.linalg.solve(np.eye(len(y)) - a * S, Y)
F /= F.sum(1, keepdims=True)
ls = LabelSpreading(kernel="rbf", gamma=g, alpha=a, max_iter=5000, tol=1e-12).fit(X, ys)
print(f"closed form vs sklearn label_distributions_: max |diff| = {np.abs(F - ls.label_distributions_).max():.1e}")

print("== 2. load_digits, 30 % test; mean test accuracy over 5 draws of the labelled subset ==")
Xd, yd = load_digits(return_X_y=True); Xd = Xd / 16.0
Xtr, Xts, ytr, yts = train_test_split(Xd, yd, test_size=0.3, random_state=0, stratify=yd)
for frac in [0.01, 0.02, 0.05]:
    acc = {"supervised LR": [], "self-training t=0.75": [], "self-training t=0.95": [], "LabelSpreading knn": []}
    added = {0.75: [], 0.95: []}
    for seed in range(5):
        lab, _ = train_test_split(np.arange(len(ytr)), train_size=frac, random_state=seed, stratify=ytr)
        ys = np.full(len(ytr), -1); ys[lab] = ytr[lab]
        acc["supervised LR"].append(LogisticRegression(max_iter=2000).fit(Xtr[lab], ytr[lab]).score(Xts, yts))
        for t in [0.75, 0.95]:
            st = SelfTrainingClassifier(LogisticRegression(max_iter=2000), threshold=t).fit(Xtr, ys)
            acc[f"self-training t={t}"].append(st.score(Xts, yts))
            added[t].append((st.labeled_iter_ > 0).sum())   # pseudo-labels added during fit
        acc["LabelSpreading knn"].append(LabelSpreading(kernel="knn", n_neighbors=7, alpha=0.99).fit(Xtr, ys).score(Xts, yts))
    print(f"{frac:.0%} labels ({len(lab)} of {len(ytr)}): " + " | ".join(f"{k} {np.mean(v):.3f}" for k, v in acc.items()))
    print(f"    pseudo-labels added (mean of 5): t=0.75 {np.mean(added[0.75]):.0f}, t=0.95 {np.mean(added[0.95]):.0f}")

print("== 3. confirmation bias: self-training, 2 % labels (draw 0), threshold 0.75 ==")
lab, _ = train_test_split(np.arange(len(ytr)), train_size=0.02, random_state=0, stratify=ytr)
ys = np.full(len(ytr), -1); ys[lab] = ytr[lab]
base = LogisticRegression(max_iter=2000).fit(Xtr[lab], ytr[lab])
print("supervised test accuracy", round(base.score(Xts, yts), 3),
      "| largest predicted probability on an unlabelled point", round(base.predict_proba(Xtr[ys == -1]).max(), 3))
st = SelfTrainingClassifier(LogisticRegression(max_iter=2000), threshold=0.75).fit(Xtr, ys)
for it in range(1, st.n_iter_ + 1):
    m = st.labeled_iter_ == it
    print(f"iteration {it:2d}: added {m.sum():3d} pseudo-labels, {np.mean(st.transduction_[m] == ytr[m]):.3f} correct,"
          f" per class {np.bincount(st.transduction_[m], minlength=10).tolist()}")
print("self-training test accuracy", round(st.score(Xts, yts), 3), "| stopped by", st.termination_condition_)

print("== 4. FixMatch-style toy (MLP, PyTorch): pseudo-label from a weak view, train on a strong view ==")
def moons(noise, per_class, seed):
    X, y = make_moons(n_samples=600, noise=noise, random_state=0)
    Xt, yt = make_moons(n_samples=1000, noise=noise, random_state=1)
    rng = np.random.default_rng(seed)
    lab = np.r_[rng.choice(np.flatnonzero(y == 0), per_class, replace=False), rng.choice(np.flatnonzero(y == 1), per_class, replace=False)]
    t = lambda a: torch.tensor(a, dtype=torch.float32)
    return t(X[lab]), torch.tensor(y[lab]), t(X), t(Xt), torch.tensor(yt)

def train(data, semi, seed, tau=0.95, weak=0.03, strong=0.15, steps=1000):
    Xl, yl, Xu, Xt, yt = data
    torch.manual_seed(seed)
    net = nn.Sequential(nn.Linear(2, 64), nn.ReLU(), nn.Linear(64, 64), nn.ReLU(), nn.Linear(64, 2))
    opt = torch.optim.Adam(net.parameters(), lr=1e-2)
    for _ in range(steps):
        loss = nn.functional.cross_entropy(net(Xl + weak * torch.randn_like(Xl)), yl)
        if semi:
            with torch.no_grad():                # pseudo-label = argmax on the weakly perturbed copy
                conf, pseudo = net(Xu + weak * torch.randn_like(Xu)).softmax(1).max(1)
            keep = (conf >= tau).float()         # only confident pseudo-labels count
            lu = nn.functional.cross_entropy(net(Xu + strong * torch.randn_like(Xu)), pseudo, reduction="none")
            loss = loss + (lu * keep).mean()
        opt.zero_grad(); loss.backward(); opt.step()
    with torch.no_grad():
        return (net(Xt).argmax(1) == yt).float().mean().item()

for noise, per_class in [(0.08, 1), (0.08, 5), (0.3, 5)]:
    rows = [(train(moons(noise, per_class, s), False, s), train(moons(noise, per_class, s), True, s)) for s in range(3)]
    print(f"noise {noise}, {per_class} label(s)/class: supervised vs FixMatch-style test accuracy per seed "
          + "  ".join(f"{a:.3f}->{b:.3f}" for a, b in rows))
```

</details>

Reading it, line by line:
- **Label spreading wins at every budget:** 0.741, 0.880 and 0.925 against 0.576, 0.750 and 0.873 for the labelled-only model, consistent with images of one digit lying close together in pixel space so that labels can travel along the 7-neighbour graph.
- **Threshold 0.95 never fires:** the labelled-only model's largest probability on any unlabelled image is 0.785 (2 % draw 0), so at 0.95 no pseudo-label is added at any budget and self-training returns the supervised model unchanged. At 1 % even 0.75 is never reached. A threshold has to be read against the model's own probability range, which in that draw never went above 0.785.
- **Confirmation bias at 2 %:** the first two rounds add 87 pseudo-labels, all correct, but only for digits 1, 4 and 6, the classes the small model happened to be sure about. Refitted on that tilted set, the model grows sure of "6" everywhere: by round 7 it adds 180 labels of which 4.4 % are right, 131 of them "6". Test accuracy ends at 0.263 against 0.735 for the same model without unlabelled data, and the fit stops only because `max_iter=10` is reached.
- **The same threshold helps at 5 %:** 995 pseudo-labels lift accuracy from 0.873 to 0.887. One setting both helps and collapses depending on the labelled sample, so log the rounds as in part 3 rather than trusting the final score.
- **FixMatch-style toy:** with five labels per class on clean moons, confident pseudo-labels on perturbed copies take the MLP from 0.78–0.90 to 0.997–1.000 in all three seeds. With one random label per class the same recipe is worse in all three seeds (down to 0.489), the pattern confirmation bias predicts when the first confident pseudo-labels are wrong ✅[^9]. On noisy, overlapping moons (noise 0.3) the low-density gap is weak, and the result moves either way (0.717 → 0.688, 0.787 → 0.883).

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Threshold above the model's top probabilities | Nothing is added; the result equals the supervised model (lab: t=0.95, all budgets) | Only rows above `threshold` are added ✅[^2]; lab top probability 0.785 ✅[^11] |
| Underconfident or overconfident base model | The threshold selects the wrong rows | A well-calibrated classifier should be used with the threshold criterion ✅[^2] |
| First confident pseudo-labels cover few classes | Snowball towards those classes (lab: 0.735 → 0.263) | Confirmation bias: errors become training targets ✅[^9]; lab ✅[^11] |
| Small `alpha` in `LabelSpreading` | Labels stay near the labelled points (lab α=0.2: 0.890 vs α=0.99: 0.997) | Each hop scales a label by `α` ✅[^5]; lab ✅[^11] |
| `LabelPropagation` with a wrong label | The wrong label is kept on that point | Hard clamping resets labelled rows every iteration ✅[^5] ✅[^1] |
| RBF kernel on many rows | Dense `n × n` matrix, long run times | Fully connected graph; use `kernel='knn'` for a sparse one ✅[^1] |
| String class labels | `-1` cannot sit in a string array | Use `dtype=object` for `y` ✅[^1] |
| Unlabelled data from extra classes | Can be worse than ignoring the unlabelled data | Class distribution mismatch ✅[^8] |
| Very few labels for a deep pseudo-labelling run | Errors get fitted; few clean labels per mini-batch | Arazo et al. oversample labelled rows to a minimum per mini-batch ✅[^9]; lab 1 label/class ✅[^11] |
| Tuning on a small validation set | Methods cannot be told apart | Oliver et al.'s small-validation experiment ✅[^8] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Labelled-only model, well tuned | The baseline every semi-supervised result must beat; with equal tuning the gap to it is smaller than typically reported ✅[^8] | Ignores the unlabelled rows |
| Transfer from a related labelled dataset | Beat all semi-supervised methods on CIFAR-10 in Oliver et al. ✅[^8] | Needs a related dataset; did not transfer to SVHN (Street View House Numbers) there ✅[^8] |
| Self-training | Wraps any classifier with `predict_proba` ✅[^1] | Needs calibrated probabilities ✅[^2]; confirmation bias ✅[^9] |
| Label propagation / spreading | Uses the graph of all rows; strong when the cluster assumption holds (lab digits 0.925 at 5 %) ✅[^11] | Kernel and `alpha` choices; dense RBF graph memory ✅[^1] |
| FixMatch-style pseudo-labels + consistency | State-of-the-art results with very few labels in its paper ✅[^10] | Needs a weak and a strong augmentation of every unlabelled input ✅[^10]; hurt in the lab with one label per class ✅[^11] |

## Takeaways
- Before any semi-supervised method, train and tune the same model on the labelled rows alone, with the same budget, and report that number next to the semi-supervised one. [rule-candidate]
- For self-training, check the base model's probability range and calibration first, then log how many pseudo-labels each round adds, their class counts, and (on a labelled hold-out) their accuracy. [rule-candidate]
- In `LabelSpreading`, the default `alpha=0.2` keeps labels local; with very few labels try values close to 1.
- Do not add unlabelled data that may contain classes missing from the labelled set without testing for harm.

## Verification status
- Verified: 76 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [Semi-supervised learning (User Guide §1.14)](https://scikit-learn.org/stable/modules/semi_supervised.html) — scikit-learn developers, living (1.9.1). Backs: the need for assumptions, `-1` for unlabelled rows and `dtype=object`, self-training based on Yarowsky with any `predict_proba` estimator and calibration, the similarity graph, RBF and kNN kernels and their memory, hard vs soft clamping, `alpha=0.2` keeping 80 %, label spreading's regularization and noise robustness. [^1]
- [sklearn.semi_supervised.SelfTrainingClassifier](https://scikit-learn.org/stable/modules/generated/sklearn.semi_supervised.SelfTrainingClassifier.html) — scikit-learn developers, living (1.9.1). Backs: `threshold=0.75`, `criterion`, `k_best=10`, `max_iter=10`, stopping rules, `labeled_iter_`, `transduction_`, `termination_condition_`, calibrated classifier. [^2]
- [sklearn.semi_supervised.LabelPropagation](https://scikit-learn.org/stable/modules/generated/sklearn.semi_supervised.LabelPropagation.html) — scikit-learn developers, living (1.9.1). Backs: kernels, `gamma=20`, `n_neighbors=7`, `max_iter=1000`, `transduction_`. [^3]
- [sklearn.semi_supervised.LabelSpreading](https://scikit-learn.org/stable/modules/generated/sklearn.semi_supervised.LabelSpreading.html) — scikit-learn developers, living (1.9.1). Backs: `alpha` meaning and default 0.2, `max_iter=30`, normalized graph Laplacian and soft clamping. [^4]
- [sklearn/semi_supervised/_label_propagation.py at 1.9.1](https://github.com/scikit-learn/scikit-learn/blob/1.9.1/sklearn/semi_supervised/_label_propagation.py) — scikit-learn source code, 2026. Backs: the propagation update with row normalization and reset of labelled rows, the spreading update `α·S·F + (1 − α)·Y`, the Laplacian-based `S`. [^5]
- [Learning with Local and Global Consistency](https://papers.nips.cc/paper/2003/hash/87682805257e619d49b8e0dfdc14affa-Abstract.html) — Zhou, Bousquet, Lal, Weston, Schölkopf, NIPS 2003 (abstract). Backs: a classifier smooth with respect to the structure revealed by labelled and unlabelled points. [^6]
- [MixMatch: A Holistic Approach to Semi-Supervised Learning](https://arxiv.org/html/1905.02249) — Berthelot, Carlini, Goodfellow, Papernot, Oliver, Raffel, 2019. Backs: the low-density assumption, the consistency loss, Pseudo-Label as implicit entropy minimization. [^7]
- [Realistic Evaluation of Deep Semi-Supervised Learning Algorithms](https://arxiv.org/html/1804.09170) — Oliver, Odena, Raffel, Cubuk, Goodfellow, 2018. Backs: manifold hint, Π-model, Mean Teacher, VAT, entropy minimization, pseudo-labelling, smaller gap with equal tuning, transfer learning 12.09 % vs 13.13 %, no transfer to SVHN, class mismatch hurting, small validation sets. [^8]
- [Pseudo-Labeling and Confirmation Bias in Deep Semi-Supervised Learning](https://arxiv.org/html/1908.02983) — Arazo, Ortego, Albert, O'Connor, McGuinness, 2019. Backs: definition and cause of confirmation bias, soft pseudo-labels, mixup, minimum labelled samples per mini-batch. [^9]
- [FixMatch: Simplifying Semi-Supervised Learning with Consistency and Confidence](https://arxiv.org/abs/2001.07685) — Sohn et al., 2020 (abstract; the HTML full text was not available). Backs: weak-view pseudo-label kept when confident, strong-view training, 94.93 % with 250 labels and 88.61 % with 40 on CIFAR-10. [^10]
- `machine-learning/lab-setup.md` — the lab where the two-moons label spreading, the digits comparison, the self-training trace and the FixMatch-style toy ran on 2026-11-25. [^11]

## Related
- `machine-learning/evaluation/probability-calibration.md` — making the self-training threshold mean what it says.
- `machine-learning/supervised-learning/logistic-regression.md` — the base classifier used for self-training here.
- `machine-learning/supervised-learning/k-nearest-neighbors.md` — the neighbourhood graph behind `kernel='knn'`.
- `machine-learning/unsupervised-learning/density-and-hierarchical-clustering.md` — the dense regions the cluster assumption relies on.
- `machine-learning/deep-learning/embeddings-and-self-supervised-learning.md` — learning from unlabelled data without any labels.
- `machine-learning/deep-learning/data-augmentation-and-transfer-learning.md` — the augmentations consistency methods need, and the transfer-learning baseline.
- `machine-learning/evaluation/cross-validation-and-hyperparameter-search.md` — tuning with few labelled rows.
