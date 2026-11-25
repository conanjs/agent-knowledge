---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/deep-learning
status: verified
applies-to: ["PyTorch 2.15.0", "scikit-learn 1.9.1", "scipy 1.18.1"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, deep-learning, neural-architecture-search, nas, automl, cash, search-space, random-search, regularized-evolution, successive-halving, weight-sharing, enas, darts, nas-bench-101, auto-sklearn, nested-cross-validation]
---

# Neural architecture search and AutoML

## Summary
**TL;DR:** Neural architecture search (NAS) automates the choice of a network's layers and connections. Every method has three parts: a search space (which architectures can be expressed), a search strategy (which one to try next: random, evolution, reinforcement learning, Bayesian optimization or gradients) and a performance estimate (how to score a candidate cheaply: shorter training, or weights shared by all candidates as in ENAS (efficient neural architecture search) and DARTS (differentiable architecture search)). Random search is a strong baseline because a well-designed space is mostly good architectures, and cheap estimates change the ranking at the top, so a fair comparison fixes the space, the training recipe and the budget and reports several seeds. AutoML (automated machine learning) for tabular data is the same problem one level up: choose the preprocessing, the algorithm and its hyperparameters together (CASH, combined algorithm selection and hyperparameter optimization), and score the whole search with nested cross-validation.
**Use this when:** you consider NAS or an AutoML tool, read a paper that claims a searched architecture beats a baseline, choose between random search, evolution, successive halving and weight sharing, or need an honest score for a model an automated search picked.
**Not this doc:** grid search, random search, successive halving, Hyperband and nested cross-validation themselves → `machine-learning/evaluation/cross-validation-and-hyperparameter-search.md`; model-based search with a Gaussian process or TPE (tree-structured Parzen estimator) → `machine-learning/evaluation/bayesian-optimization.md`; the hand-designed CNN (convolutional neural network) lineage, including EfficientNet, which came out of a search → `machine-learning/deep-learning/modern-cnn-architectures.md`; REINFORCE and policy gradients → `machine-learning/reinforcement-learning/policy-gradients-and-ppo.md`.

## Problem
An architecture is many coupled choices (depth, widths, operations, connections), each candidate costs a training run to score, and the score is noisy. The landmark searches were enormous: Zoph and Le's reinforcement-learning search ran on 800 GPUs (graphics processing units) for three to four weeks ✅[^1] and trained 12,800 architectures ✅[^2], and later searches were reported at 2,000 GPU days with reinforcement learning and 3,150 with evolution ✅[^4]. Yet simple baselines come close: Li and Talwalkar found random search with early stopping at least as good as ENAS, a leading NAS method, on both standard benchmarks, against ENAS's published results ✅[^5], and many NAS methods struggle to significantly beat the average randomly sampled architecture of their own search space ✅[^9]. In the lab's space of 310 small networks, the median scores 0.940 test accuracy and the best 0.973, the top validation pick scores only 0.952 on test, and a 3-epoch ranking shares just 2 of its top 10 with the 27-epoch ranking ✅[^17]. Without a fair baseline and an honest score, the gain of a search method cannot be told apart from the search space, the training recipe and luck.

## Mental model
**Analogy:** hiring a head chef. The job advert decides who may apply (the search space): an advert that already asks for years in good kitchens makes almost every applicant decent, which is why picking applicants at random works surprisingly well. The hiring method decides whom to audition next (the search strategy): at random, by tweaking the profile of the best so far (evolution), or through a recruiter who learns what wins (reinforcement learning). The audition is the performance estimate: a full evening of service is accurate but costly, a ten-minute tasting is cheap but can rank chefs differently, and letting every applicant cook from one shared set of prepared ingredients (weight sharing) is cheaper still and skews the ranking more. A chef who shone at one audition may have had a lucky night, so the best audition score flatters the winner.

**Artifact:** the three parts as they appear in the lab's search over multilayer perceptrons (MLPs) on the 8 × 8 digits, and the spread of the space they define; printed by the full script in the Worked example; lab run (`machine-learning/lab-setup.md`), 2026-11-25, PyTorch 2.15.0 ✅[^17]:

```python
WIDTHS, ACTS = (8, 16, 32, 64, 128), ("relu", "tanh")                              # 1. search space
SPACE = [(w, a) for d in (1, 2, 3) for w in itertools.product(WIDTHS, repeat=d) for a in ACTS]
TABLE = {a: train(a, i) for i, a in enumerate(SPACE)}   # 3. performance estimate: val/test at 3, 9, 27 epochs
def random_search(r):                                   # 2. search strategy: best validation of 30 random nets
    return max((SPACE[i] for i in r.choice(len(SPACE), 30, replace=False)), key=val)
```

```text
310 architectures, test accuracy after 27 epochs: worst 0.650, median 0.940, 95th percentile 0.967, best 0.973
```

## How it works
Three actors repeat one loop until the budget runs out ✅[^1]:
- **Search space** — its job: define which architectures exist, via a list of choices (layer types, widths, connections).
- **Search strategy** — its job: propose the next architecture, via the scores seen so far.
- **Performance estimator** — its job: score a proposal, via (partial) training and a validation set.

```text
search space ──▶ search strategy ──propose architecture A──▶ performance estimator
                        ▲                                      (train A, or inherit shared weights;
                        └──────── validation score of A ◀─────── score on the validation set)
     budget spent ──▶ retrain the best A in full ──▶ report its score on a test set the loop never saw
```

### 1. The search space
- **Chain-structured** spaces stack layers one after another, each with its own type and hyperparameters; **multi-branch** spaces add skip connections like hand-designed residual networks ✅[^1].
- **Cells:** search for a small repeated block, a normal cell that keeps the input size and a reduction cell that shrinks it, then stack cells; this shrinks the space (Zoph et al. estimated a seven-times speed-up over Zoph and Le) and cells found on CIFAR-10 (a 10-class image benchmark from the Canadian Institute for Advanced Research) transferred to ImageNet ✅[^1].
- Prior knowledge in the space makes the search easier but adds a human bias that can block genuinely new building blocks ✅[^1]. DARTS's authors read random search's competitiveness as a sign of how much the space design matters ✅[^4]. Lab: the 310 chain-structured MLPs have depth 1 to 3, a width per layer from {8, 16, 32, 64, 128} and one activation, ReLU (rectified linear unit) or tanh ✅[^17].

### 2. Search strategies
1. **Random search** draws architectures uniformly from the space, as in NAS-Bench-101's implementation ✅[^6]. Li and Talwalkar treat NAS as a specialized hyperparameter-optimization problem; with about DARTS's compute, random search with early stopping averaged 3.03 ± 0.13 % test error on CIFAR-10 over 10 training seeds, its best seed reached 2.85 % against ENAS's published 2.89 %, and DARTS still did better; random search with weight sharing averaged 2.85 ± 0.08 %, comparable to DARTS ✅[^5]. They propose reporting a new method as a multiple of random search: how much more compute random search would need to match it ✅[^5].
2. **Reinforcement learning (RL):** Zoph and Le's controller, a recurrent neural network (RNN), writes an architecture as a string of tokens (filter height, width, stride, number of filters, layer by layer); the child network is trained, and its validation accuracy is the reward for a REINFORCE update of the controller, with an exponential moving average of past accuracies as the baseline ✅[^2]. Their CIFAR-10 model reached 3.65 % test error ✅[^2].
3. **Evolution:** regularized (aging) evolution keeps a population, samples S members, mutates the best of them into a child, trains it, adds it, and removes the oldest member rather than the worst ✅[^7]. S = 1 reduces it to a kind of random search ✅[^7]; its authors speculate that aging helps against noisy training, since a model that scored high by luck cannot stay in the population for long ✅[^7]. In their comparison RL and evolution reached about 3.5 % CIFAR-10 test error and random search about 4 % after the found models were enlarged (a gap of about 2 % in the smaller space actually searched), and evolution had better anytime performance and found smaller models ✅[^1].
4. **Bayesian optimization** fits a model of score against architecture (`machine-learning/evaluation/bayesian-optimization.md`); typical Gaussian-process tools target low-dimensional continuous spaces, so NAS work either derives kernels for architectures or uses tree-based models (TPE, random forests) that handle high-dimensional conditional spaces ✅[^1]. On NAS-Bench-101, regularized evolution, SMAC (sequential model-based algorithm configuration, a random-forest-based optimizer) and BOHB (Bayesian optimization plus Hyperband) overtook random search after about 25 evaluated architectures and reached its final result about 5 times faster; TPE fell back to random search ✅[^6].
5. **Successive halving and Hyperband** start many candidates on a small budget and train only the best further (`machine-learning/evaluation/cross-validation-and-hyperparameter-search.md`). On NAS-Bench-101, Hyperband and BOHB did not give the speed-ups multi-fidelity methods are often seen to give over random search or Bayesian optimization, which its authors attribute to the relatively low rank correlation between budgets ✅[^6].

### 3. Performance estimation
1. **Full training** on the training set and scoring on a validation set is the simplest estimate and the most expensive ✅[^1].
2. **Lower fidelity:** fewer epochs, a data subset, lower-resolution images, or fewer filters and cells ✅[^1]. These estimates are biased low, which is harmless only while the ranking stays stable; the ranking can change sharply when the cheap and the full setting are far apart, hence the case for raising the budget gradually ✅[^1]. Zela et al. argue that the usual jump from 20 search epochs to 600 final epochs leaves little rank correlation, and measured a Spearman correlation of 0.87 between neighbouring training-time budgets (400 s and 1,200 s) that fell to 0.05 between 400 s and 3 h ✅[^10]; NAS-Bench-101 reports a Spearman correlation of 0.365 between 36 and 108 epochs within its top 10 % of architectures ✅[^6].
3. **Weight sharing (one-shot):** every architecture is a subgraph of one supergraph whose weights are trained once, so a candidate is scored with inherited weights and no training of its own; this cut NAS from thousands of GPU days to a few ✅[^1]. ENAS trains the shared weights and an RNN controller that picks subgraphs by policy gradient, at more than 1000 times fewer GPU hours than standard NAS and 2.89 % CIFAR-10 test error ✅[^3]. The shared-weight score underestimates the best architectures badly, and whether it ranks them correctly is unclear ✅[^1]; Yu et al. found that weight sharing degrades the ranking until it no longer reflects true performance, and that leading NAS search policies did about as well as random selection on average ✅[^8].
4. **DARTS** relaxes each choice of operation into a softmax-weighted mix of all candidates, `ō(x) = Σ_o softmax(α)_o · o(x)`, including a zero operation for "no connection" ✅[^4]. Here `α` is a vector of architecture weights per edge and `o(x)` a candidate operation applied to input `x`. Example: `α = (1, 0, −1)` over (3 × 3 convolution, max pooling, zero) gives weights e¹ / (e¹ + e⁰ + e⁻¹) = 0.665, 0.245 and 0.090. Training alternates a gradient step on `α` for the validation loss and a step on the network weights for the training loss, an approximation of the bilevel problem `min_α L_val(w*(α), α)` with `w*(α) = argmin_w L_train(w, α)` ✅[^4]. The first-order variant treats the current weights as if they were already `w*(α)`, which is faster and, in their results, worse; the final architecture keeps the argmax operation per edge, here the convolution ✅[^4]. On CIFAR-10: 3.00 ± 0.14 % test error in 1.5 GPU days (first order), 2.76 ± 0.09 % in 4 (second order), against 3.29 ± 0.15 % for their random-search baseline ✅[^4].
5. **Limits of one-shot methods:** the supergraph confines the search to its subgraphs, and a method that must hold it in GPU memory is limited to small supergraphs; a sampler that favours some regions early also trains their weights better, which can reinforce the bias ✅[^1].

### 4. Benchmarks and reproducibility
- **NAS-Bench-101** trained about 423,000 unique cell architectures 3 times each at 4 budgets (4, 12, 36 and 108 epochs), about 5 million models, so a search strategy can be evaluated by table lookups that take milliseconds ✅[^6]. It trained each budget as its own run, because checkpoints taken while the learning rate is still high give noisy accuracies ✅[^6]; the lab instead uses a constant learning rate, so its 3- and 9-epoch checkpoints equal shorter runs. At 108 epochs its validation and test accuracies correlate at r = 0.999, and run-to-run noise falls with longer training ✅[^6].
- Li and Talwalkar found none of 12 NAS papers from NeurIPS (Neural Information Processing Systems), ICML (International Conference on Machine Learning) and ICLR (International Conference on Learning Representations) since 2018 exactly reproducible, and recommend reporting several independent runs, as hyperparameter-optimization papers report 10 ✅[^5].
- Reported gains mix many factors: on CIFAR-10, cosine learning-rate annealing, cutout, mixup or shake-shake regularization substantially improve results, and Elsken et al. consider it conceivable that such ingredients move reported numbers more than the architectures NAS finds ✅[^1]. Yang et al. compared 8 methods on 5 datasets against the average randomly sampled architecture: many struggled to significantly beat it, the evaluation protocol's tricks dominated reported performance, and in the narrow accuracy range of the DARTS space the seed changed the ranking considerably ✅[^9].

### 5. AutoML for tabular pipelines
- **CASH:** Auto-WEKA's formulation treats the choice of algorithm as one more, root-level hyperparameter, with each algorithm's hyperparameters active only when it is chosen, so the whole problem is one hierarchical hyperparameter search ✅[^11].
- **Auto-sklearn** searches a space of 15 classifiers, 14 feature-preprocessing and 4 data-preprocessing methods (110 hyperparameters), takes past performance on similar datasets into account, and builds an ensemble from the models it evaluated; it won the first phase of the ChaLearn AutoML challenge ✅[^12]. Version 1.0 warm-starts Bayesian optimization with pipelines that did well on the nearest datasets ✅[^13]. Its documentation presents it as a drop-in scikit-learn estimator built on Bayesian optimization, meta-learning and ensembles, whose example runs for one hour on the digits ✅[^14]. Auto-sklearn 2.0 replaces the similar-dataset warm start with a fixed portfolio of complementary pipelines and adds successive halving, reducing relative error by up to a factor of 4.5 and doing better in 10 minutes than version 1.0 did in an hour ✅[^13].
- **The same in plain scikit-learn:** a `Pipeline` step can itself be a searched parameter, and a non-final step can be switched off with `'passthrough'` ✅[^15]; `RandomizedSearchCV` given a list of dicts first picks a dict uniformly, then samples its parameters ✅[^16], so one dict per algorithm gives a random CASH search. The score of "search, then refit" must come from nested cross-validation or an untouched test set (`machine-learning/evaluation/cross-validation-and-hyperparameter-search.md`).

**Lab: AutoML as CASH.** One `RandomizedSearchCV` with 40 candidates and 3-fold inner cross-validation over {standard scaling, min–max scaling, none} × {logistic regression, SVC (support vector classifier), random forest, k-nearest neighbours} × each model's hyperparameters, on the 569-row breast-cancer dataset; then the same search repeated inside each of 5 outer folds (nested cross-validation). Lab run (`machine-learning/lab-setup.md`), 2026-11-25, scikit-learn 1.9.1, two runs identical ✅[^17]:

```text
candidates per algorithm: {'LogisticRegression': 9, 'KNeighborsClassifier': 13, 'RandomForestClassifier': 10, 'SVC': 8}
search on all rows: best LogisticRegression + StandardScaler, best_score_ 0.9754
== nested CV: the search is re-run inside each outer training fold ==
fold 0: picked KNeighborsClassifier + MinMaxScaler          inner best 0.9692  outer test 0.9561
fold 1: picked LogisticRegression + StandardScaler          inner best 0.9715  outer test 0.9649
fold 2: picked LogisticRegression + StandardScaler          inner best 0.9714  outer test 0.9737
fold 3: picked LogisticRegression + StandardScaler          inner best 0.9649  outer test 0.9561
fold 4: picked LogisticRegression + StandardScaler          inner best 0.9737  outer test 0.9912
mean inner best_score_ 0.9701  vs  nested estimate 0.9684 (std 0.0131)
```

<details><summary>Full script (prints the output above)</summary>

```python
# AutoML as CASH (combined algorithm selection and hyperparameter optimization) in plain scikit-learn:
# one random search over scaler x model x hyperparameters, scored honestly with nested cross-validation.
import collections, warnings
import numpy as np
from scipy.stats import loguniform, randint
from sklearn.datasets import load_breast_cancer
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import RandomizedSearchCV, StratifiedKFold
from sklearn.neighbors import KNeighborsClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import MinMaxScaler, StandardScaler
from sklearn.svm import SVC
from sklearn.exceptions import ConvergenceWarning
warnings.filterwarnings("ignore", category=ConvergenceWarning)  # unscaled LogisticRegression candidates

X, y = load_breast_cancer(return_X_y=True)
pipe = Pipeline([("scale", StandardScaler()), ("model", LogisticRegression())])
scalers = [StandardScaler(), MinMaxScaler(), "passthrough"]               # the step itself is a choice
space = [                                                                   # one dict per algorithm
    {"scale": scalers, "model": [LogisticRegression(max_iter=5000)], "model__C": loguniform(1e-3, 1e3)},
    {"scale": scalers, "model": [SVC()], "model__C": loguniform(1e-2, 1e3), "model__gamma": loguniform(1e-4, 1e0)},
    {"scale": scalers, "model": [RandomForestClassifier(n_estimators=100, random_state=0)],
     "model__max_depth": [3, 6, None], "model__max_features": [.2, .5, "sqrt"]},
    {"scale": scalers, "model": [KNeighborsClassifier()], "model__n_neighbors": randint(1, 30)}]
inner, outer = StratifiedKFold(3, shuffle=True, random_state=0), StratifiedKFold(5, shuffle=True, random_state=1)
search = lambda: RandomizedSearchCV(pipe, space, n_iter=40, cv=inner, random_state=0)

def name(est):
    s = est.named_steps["scale"]
    return f"{type(est.named_steps['model']).__name__} + {s if s == 'passthrough' else type(s).__name__}"
s = search().fit(X, y)
fam = collections.Counter(type(p["model"]).__name__ for p in s.cv_results_["params"])
print("candidates per algorithm:", dict(fam))
print(f"search on all rows: best {name(s.best_estimator_)}, best_score_ {s.best_score_:.4f}")
print("== nested CV: the search is re-run inside each outer training fold ==")
inner_best, outer_score = [], []
for k, (tr, te) in enumerate(outer.split(X, y)):
    s = search().fit(X[tr], y[tr])
    inner_best.append(s.best_score_); outer_score.append(s.score(X[te], y[te]))
    print(f"fold {k}: picked {name(s.best_estimator_):<44} inner best {s.best_score_:.4f}  outer test {outer_score[-1]:.4f}")
print(f"mean inner best_score_ {np.mean(inner_best):.4f}  vs  nested estimate {np.mean(outer_score):.4f}"
      f" (std {np.std(outer_score):.4f})")
```

</details>

Reading it: Logistic regression with standard scaling wins on all rows and in 4 of the 5 outer folds; in fold 0 the search picks k-nearest neighbours with min–max scaling. The best inner score of the search on all rows (0.9754) is above the nested estimate (0.9684 ± 0.0131): the expected optimism of reporting the selection score, here smaller than the spread across outer folds.

## Worked example
A tabular NAS benchmark. Every MLP of the 310-architecture space is trained once on 1,000 digit images with Adam (learning rate 0.002, batches of 100) and scored on a 397-image validation set and a 400-image test set after 3, 9 and 27 epochs. A second seed re-trains every fifth architecture. Four strategies then query only the table, each with a budget of 810 training epochs: a grid of the 30 same-width networks, 30 random networks, successive halving (90 networks for 3 epochs, the best 30 for 9, the best 10 for 27) and aging evolution (population 10, sample size 3, 30 networks in all). Each strategy returns its best-validation network; the table reports that network's test accuracy, averaged over 200 runs. In the output, `val@e` is validation accuracy after e epochs, `P(top 5%)` the share of runs whose pick is in the space's top 5 % by test accuracy, and the last column the pick's validation minus test accuracy. Core lines:

```python
def successive_halving(r):            # 90 at 3 epochs -> best 30 at 9 -> best 10 at 27 (270 epochs each)
    c = [SPACE[i] for i in r.choice(len(SPACE), 90, replace=False)]
    for e, keep in ((3, 30), (9, 10)):
        c = sorted(c, key=lambda a: val(a, e))[-keep:]
    return max(c, key=val)
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-25, PyTorch 2.15.0, scipy 1.18.1, CPU with one thread, two runs identical; the first line is the Mental model artifact ✅[^17]:

```text
310 architectures, test accuracy after 27 epochs: worst 0.650, median 0.940, 95th percentile 0.967, best 0.973
best 3 by validation: [(((128, 128, 128), 'relu'), 0.975, 0.952), (((128, 32, 128), 'tanh'), 0.975, 0.96), (((128, 32, 128), 'relu'), 0.972, 0.965)]
Spearman(val@3, val@27) = 0.823, top-10 overlap 2/10
Spearman(val@9, val@27) = 0.911, top-10 overlap 2/10
Spearman(seed A, seed B) at 27 epochs, 62 architectures = 0.859
== search strategies, budget 810 epochs each, 200 runs (grid is deterministic) ==
strategy             mean test P(top 5%) val - test of pick
grid (30 nets)          0.9525      0.00             0.0223
random (30 nets)        0.9618      0.27             0.0079
successive halving      0.9588      0.12             0.0135
aging evolution         0.9620      0.26             0.0085
mean val - test over the whole space: 0.0026
```

<details><summary>Full script (prints the output above)</summary>

```python
# A tiny tabular NAS benchmark on load_digits: train every MLP in a 310-architecture search space once,
# record validation and test accuracy after 3, 9 and 27 epochs, then compare search strategies that
# only query the table (grid, random, successive halving, regularized evolution) at the same budget.
import itertools, collections
import numpy as np, torch
from torch import nn
from scipy.stats import spearmanr
from sklearn.datasets import load_digits
from sklearn.model_selection import train_test_split
torch.set_num_threads(1)

X, y = load_digits(return_X_y=True); X = (X / 16.0).astype(np.float32)
Xtr, Xr, ytr, yr = train_test_split(X, y, train_size=1000, stratify=y, random_state=0)
Xva, Xte, yva, yte = train_test_split(Xr, yr, test_size=400, stratify=yr, random_state=0)
Xtr, Xva, Xte, ytr, yva, yte = map(torch.tensor, (Xtr, Xva, Xte, ytr, yva, yte))
WIDTHS, ACTS, EPOCHS = (8, 16, 32, 64, 128), ("relu", "tanh"), (3, 9, 27)
SPACE = [(w, a) for d in (1, 2, 3) for w in itertools.product(WIDTHS, repeat=d) for a in ACTS]

def build(widths, act):
    layers, d = [], 64
    for w in widths:
        layers += [nn.Linear(d, w), nn.ReLU() if act == "relu" else nn.Tanh()]; d = w
    return nn.Sequential(*layers, nn.Linear(d, 10))
def train(arch, seed):                 # constant learning rate, so the 3- and 9-epoch checkpoints
    torch.manual_seed(seed); net = build(*arch)  # equal a shorter training run
    opt, out = torch.optim.Adam(net.parameters(), 2e-3), {}
    for ep in range(1, EPOCHS[-1] + 1):
        for idx in torch.randperm(1000).split(100):
            opt.zero_grad(); nn.functional.cross_entropy(net(Xtr[idx]), ytr[idx]).backward(); opt.step()
        if ep in EPOCHS:
            with torch.no_grad():
                out[ep] = tuple((net(A).argmax(1) == b).float().mean().item() for A, b in ((Xva, yva), (Xte, yte)))
    return out
TABLE = {a: train(a, i) for i, a in enumerate(SPACE)}                     # the benchmark: one run each
val = lambda a, e=27: TABLE[a][e][0]
test = lambda a: TABLE[a][27][1]

T = np.array([test(a) for a in SPACE]); top5 = np.quantile(T, .95)
print(f"{len(SPACE)} architectures, test accuracy after 27 epochs: worst {T.min():.3f}, median {np.median(T):.3f},"
      f" 95th percentile {top5:.3f}, best {T.max():.3f}")
print("best 3 by validation:", [(a, round(val(a), 3), round(test(a), 3)) for a in sorted(SPACE, key=val)[-3:][::-1]])
v = {e: [val(a, e) for a in SPACE] for e in EPOCHS}
top10 = lambda e: set(np.argsort(v[e])[-10:])
for e in (3, 9):
    print(f"Spearman(val@{e}, val@27) = {spearmanr(v[e], v[27]).statistic:.3f}, top-10 overlap {len(top10(e) & top10(27))}/10")
sub = SPACE[::5]                                                          # 62 architectures, second seed
rerun = [train(a, 10_000 + i)[27][0] for i, a in enumerate(sub)]
print(f"Spearman(seed A, seed B) at 27 epochs, {len(sub)} architectures = {spearmanr([val(a) for a in sub], rerun).statistic:.3f}")

BUDGET = 30 * 27                                                          # epochs: 30 full trainings
def random_search(r):
    return max((SPACE[i] for i in r.choice(len(SPACE), 30, replace=False)), key=val)
def grid(r):                                                              # same width in every layer
    return max([((w,) * d, a) for d in (1, 2, 3) for w in WIDTHS for a in ACTS], key=val)
def successive_halving(r):            # 90 at 3 epochs -> best 30 at 9 -> best 10 at 27 (270 epochs each)
    c = [SPACE[i] for i in r.choice(len(SPACE), 90, replace=False)]
    for e, keep in ((3, 30), (9, 10)):
        c = sorted(c, key=lambda a: val(a, e))[-keep:]
    return max(c, key=val)
def mutate(arch, r):
    w, a = list(arch[0]), arch[1]
    move = r.choice(["width", "add", "remove", "act"])
    i = int(r.integers(len(w)))
    if move == "width": w[i] = int(r.choice([x for x in WIDTHS if x != w[i]]))
    elif move == "add" and len(w) < 3: w.insert(r.integers(len(w) + 1), int(r.choice(WIDTHS)))
    elif move == "remove" and len(w) > 1: w.pop(i)
    else: a = "tanh" if a == "relu" else "relu"          # also when add/remove is impossible
    return tuple(w), a
def evolution(r, P=10, S=3):          # regularized (aging) evolution: the oldest member dies
    pop = collections.deque(SPACE[i] for i in r.choice(len(SPACE), P, replace=False)); hist = list(pop)
    while len(hist) < 30:
        parent = max((pop[i] for i in r.integers(len(pop), size=S)), key=val)
        child = mutate(parent, r); pop.append(child); pop.popleft(); hist.append(child)
    return max(hist, key=val)

print(f"== search strategies, budget {BUDGET} epochs each, 200 runs (grid is deterministic) ==")
print(f"{'strategy':<20}{'mean test':>10}{'P(top 5%)':>10}{'val - test of pick':>19}")
for name, f in [("grid (30 nets)", grid), ("random (30 nets)", random_search),
                ("successive halving", successive_halving), ("aging evolution", evolution)]:
    picks = [f(np.random.default_rng(s)) for s in range(200)]
    t = np.array([test(a) for a in picks]); gap = np.mean([val(a) - test(a) for a in picks])
    print(f"{name:<20}{t.mean():10.4f}{(t >= top5).mean():10.2f}{gap:19.4f}")
print(f"mean val - test over the whole space: {np.mean([val(a) - test(a) for a in SPACE]):.4f}")
```

</details>

Reading it:
- **The space does most of the work.** Half of the 310 networks reach 0.940, the top 5 % reach 0.967 and the best 0.973; the worst scores 0.650.
- **Random search is hard to beat in this run.** Random search and aging evolution tie (0.9618 and 0.9620 mean test accuracy; 27 % and 26 % of runs end in the top 5 %). With 30 evaluations evolution has little room to pull ahead: on NAS-Bench-101 it overtook random search only after about 25 evaluated architectures and kept improving beyond ✅[^6].
- **Cheap estimates mislead at the top here.** Rankings after 3 and 27 epochs correlate at 0.823 overall but share only 2 of their top 10, and in this run successive halving ends below random search (0.9588, 12 % in the top 5 %), consistent with it discarding candidates on a ranking that changes at the top. Two seeds of the same full training correlate at only 0.859, so the full estimate is noisy too.
- **The winner is flattered.** Over the whole space, validation exceeds test accuracy by 0.0026 on average; for the networks the strategies pick, by 0.0079 to 0.0223. The grid's pick, (128, 128, 128) with ReLU, is one of the two networks with the best validation score in the space (0.975) and scores only 0.952 on test, so the grid lands in the top 5 % in no run.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Reporting the best validation score of a search | Optimistic: lab gap 0.0223 for the grid's pick against 0.0026 on average | The maximum of noisy estimates is biased upwards ✅[^17] |
| Low-fidelity ranking | Overall correlation fine (lab 0.823) but the top changes (2 of 10 shared); in the lab, successive halving ends below random search | Ranking can change sharply between far-apart budgets ✅[^1] ✅[^10]; 0.365 within NAS-Bench-101's top 10 % ✅[^6]; lab ✅[^17] |
| Seed noise at full training | Rank correlation 0.859 between two seeds in the lab | Run-to-run noise ✅[^17]; falls with longer training ✅[^6]; the seed reorders the DARTS space ✅[^9] |
| Checkpoints of one long run as low fidelities | Noisy scores while the learning rate is still high | Why NAS-Bench-101 trained each budget separately ✅[^6] |
| Weight-sharing scores | Poor ranking of the true performance | Shared weights favour some subgraphs ✅[^1] ✅[^8] |
| DARTS zero operation | Excluded when the architecture is derived | With batch normalization its strength is underdetermined ✅[^4] |
| Comparing NAS papers | Training and evaluation tricks can outweigh the search | Cosine schedules, cutout, mixup ✅[^1]; evaluation protocol dominates ✅[^9] |
| Published NAS result with code | Often not exactly reproducible | Missing seeds, non-deterministic code ✅[^5] |
| CASH hyperparameters | Meaningful only for the chosen algorithm | Conditional, hierarchical space ✅[^11] |
| AutoML pick scored on its own search | Optimistic (lab 0.9754 vs nested 0.9684) | The search is part of the model; nested cross-validation ✅[^17] |
| The search picks different models per fold | Lab: k-nearest neighbours once, logistic regression 4 times | Several pipelines score within noise ✅[^17] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Random search | Trivial, parallel, a strong baseline ✅[^5] | Ignores earlier results |
| Aging evolution | Better anytime performance, smaller models than RL ✅[^1] | Population size P and sample size S to set ✅[^7]; needs enough evaluations (lab: tied with random at 30) ✅[^17] |
| RL controller | The competitive CIFAR-10 and Penn Treebank results that made NAS mainstream ✅[^1] | 800 GPUs for weeks ✅[^1] |
| Successive halving, Hyperband | Many candidates on a small budget | Only as good as the low-fidelity ranking ✅[^6]; lab: below random ✅[^17] |
| Weight sharing (ENAS, DARTS) | GPU days instead of thousands ✅[^1] ✅[^3] ✅[^4] | Biased ranking, search limited to one supergraph ✅[^1] ✅[^8] |
| Tabular benchmark | Strategy comparisons in milliseconds, many seeds ✅[^6] | One fixed space and one fixed set of training hyperparameters ✅[^6] |
| AutoML system (Auto-sklearn) | CASH, warm starts and ensembles handled ✅[^12] ✅[^13] | Its documented example runs for an hour ✅[^14]; the result still needs an honest test |

## Takeaways
- Compare every NAS method with random search on the same space, training recipe and budget, and report several seeds. [rule-candidate]
- Before relying on successive halving or another low-fidelity method, measure the rank correlation between the cheap and the full score on a sample of the space.
- Spend effort on the search space and the training recipe first; they often move the result more than the strategy does.
- Score the output of any automated search on data the search never saw: nested cross-validation or a held-out test set. [rule-candidate]

## Verification status
- Verified: 91 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [Neural Architecture Search: A Survey](https://ar5iv.labs.arxiv.org/html/1808.05377) — Elsken, Metzen, Hutter, 2019 (JMLR; ar5iv HTML of arXiv:1808.05377). Backs: the three dimensions, chain, multi-branch and cell spaces, human bias, the strategy families, 800 GPUs, the RL vs evolution vs random comparison, Gaussian-process limits, low-fidelity bias and ranking, one-shot models and their limits, training-pipeline confounders. [^1]
- [Neural Architecture Search with Reinforcement Learning](https://ar5iv.labs.arxiv.org/html/1611.01578) — Zoph, Le, 2016 (ICLR 2017; ar5iv HTML of arXiv:1611.01578). Backs: the RNN controller and its token string, REINFORCE with validation accuracy as reward, moving-average baseline, 12,800 architectures, 3.65 % error. [^2]
- [Efficient Neural Architecture Search via Parameter Sharing](https://ar5iv.labs.arxiv.org/html/1802.03268) — Pham, Guan, Zoph, Le, Dean, 2018 (ar5iv HTML of arXiv:1802.03268). Backs: shared weights in one large graph, a controller trained by policy gradient, 1000 times fewer GPU hours, 2.89 % error. [^3]
- [DARTS: Differentiable Architecture Search](https://ar5iv.labs.arxiv.org/html/1806.09055) — Liu, Simonyan, Yang, 2018 (ICLR 2019; ar5iv HTML of arXiv:1806.09055). Backs: 2,000 and 3,150 GPU days of earlier searches, the softmax relaxation and zero operation, the bilevel problem, first- and second-order updates, argmax discretization, CIFAR-10 errors and costs, random search and search-space design. [^4]
- [Random Search and Reproducibility for Neural Architecture Search](https://ar5iv.labs.arxiv.org/html/1902.07638) — Li, Talwalkar, 2019 (ar5iv HTML of arXiv:1902.07638). Backs: NAS as hyperparameter optimization, random search with early stopping vs ENAS (3.03 ± 0.13 % average, 2.85 % best seed, vs 2.89 %), random search with weight sharing (2.85 ± 0.08 %), multiple of random search, 12 papers not exactly reproducible, several runs. [^5]
- [NAS-Bench-101: Towards Reproducible Neural Architecture Search](https://ar5iv.labs.arxiv.org/html/1902.09635) — Ying, Klein, Real, Christiansen, Murphy, Hutter, 2019 (ar5iv HTML of arXiv:1902.09635). Backs: 423k cells, 3 runs, 4 budgets, millisecond queries, separate runs per budget, r = 0.999, noise vs epochs, uniform random search, strategy comparison and the 25-architecture mark, Hyperband and BOHB without the usual multi-fidelity speed-up, 0.365 rank correlation. [^6]
- [Regularized Evolution for Image Classifier Architecture Search](https://ar5iv.labs.arxiv.org/html/1802.01548) — Real, Aggarwal, Huang, Le, 2018 (AAAI 2019; ar5iv HTML of arXiv:1802.01548). Backs: aging evolution's cycle, S = 1 as random search, the noise argument. [^7]
- [Evaluating The Search Phase of Neural Architecture Search](https://ar5iv.labs.arxiv.org/html/1902.08142) — Yu, Sciuto, Jaggi, Musat, Salzmann, 2019 (ar5iv HTML of arXiv:1902.08142). Backs: search policies close to random on average, weight sharing degrading the ranking. [^8]
- [NAS evaluation is frustratingly hard](https://ar5iv.labs.arxiv.org/html/1912.12522) — Yang, Esperança, Carlucci, 2019 (ar5iv HTML of arXiv:1912.12522). Backs: 8 methods on 5 datasets against the average sampled architecture, evaluation tricks, narrow accuracy range and seed effects. [^9]
- [Towards Automated Deep Learning: Efficient Joint Neural Architecture and Hyperparameter Search](https://ar5iv.labs.arxiv.org/html/1807.06906) — Zela, Klein, Falkner, Hutter, 2018 (ar5iv HTML of arXiv:1807.06906). Backs: the argument about 20 vs 600 epochs, Table 1's rank correlations between time budgets (0.87 neighbouring, 0.05 from 400 s to 3 h). [^10]
- [Auto-WEKA: Combined Selection and Hyperparameter Optimization of Classification Algorithms](https://ar5iv.labs.arxiv.org/html/1208.3719) — Thornton, Hutter, Hoos, Leyton-Brown, 2012 (ar5iv HTML of arXiv:1208.3719). Backs: CASH, algorithm choice as a root-level hyperparameter, conditional hyperparameters. [^11]
- [Efficient and Robust Automated Machine Learning](https://papers.nips.cc/paper_files/paper/2015/hash/11d0e6287202fced83f79975ec59a3a6-Abstract.html) — Feurer, Klein, Eggensperger, Springenberg, Blum, Hutter, NeurIPS 2015 (abstract page). Backs: Auto-sklearn's space (15, 14, 4, 110), past performance on similar datasets, ensembles, the ChaLearn result. [^12]
- [Auto-Sklearn 2.0: Hands-free AutoML via Meta-Learning](https://ar5iv.labs.arxiv.org/html/2007.04074) — Feurer, Eggensperger, Falkner, Lindauer, Hutter, 2020 (ar5iv HTML of arXiv:2007.04074). Backs: version 1.0's nearest-dataset warm start of Bayesian optimization, portfolio and successive halving, factor 4.5, 10 minutes vs an hour. [^13]
- [auto-sklearn documentation](https://automl.github.io/auto-sklearn/master/) — Machine Learning Professorship Freiburg, living (0.15.0). Backs: drop-in scikit-learn estimator, Bayesian optimization, meta-learning and ensembles, the one-hour digits example. [^14]
- [Pipelines and composite estimators (User Guide 8.1)](https://scikit-learn.org/stable/modules/compose.html) — scikit-learn developers, living (1.9.1). Backs: steps replaced as parameters, `'passthrough'`. [^15]
- [RandomizedSearchCV](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.RandomizedSearchCV.html) — scikit-learn developers, living (1.9.1). Backs: a list of dicts is sampled dict first, then parameters. [^16]
- `machine-learning/lab-setup.md` — the lab where the 310-architecture benchmark, the four search strategies and the nested CASH search ran on 2026-11-25. [^17]

## Related
- `machine-learning/evaluation/cross-validation-and-hyperparameter-search.md` — grid, random, successive halving and nested cross-validation, which NAS and AutoML reuse.
- `machine-learning/evaluation/bayesian-optimization.md` — the model-based strategy and BOHB.
- `machine-learning/deep-learning/modern-cnn-architectures.md` — the hand-designed architectures NAS competes with, and EfficientNet's searched baseline.
- `machine-learning/deep-learning/training-loop-and-debugging.md` — the training recipe every candidate runs through.
- `machine-learning/reinforcement-learning/policy-gradients-and-ppo.md` — REINFORCE, which trains the NAS and ENAS controllers.
- `machine-learning/ml-systems/reproducibility-and-determinism.md` — seeds and deterministic training, the basis of reproducible search results.
