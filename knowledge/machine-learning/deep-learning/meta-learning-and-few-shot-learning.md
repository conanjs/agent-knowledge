---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/deep-learning
status: verified
applies-to: ["PyTorch 2.15.0", "scikit-learn 1.9.1"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, deep-learning, meta-learning, learning-to-learn, few-shot-learning, n-way-k-shot, episodes, support-set, query-set, prototypical-networks, maml, first-order-maml, reptile, linear-probe, in-context-learning]
---

# Meta-learning and few-shot learning

## Summary
**TL;DR:** Few-shot learning means learning a new task from very few labelled examples: an N-way K-shot task gives K examples of each of N new classes. Meta-learning ("learning to learn") prepares a model by training it on many small tasks, called episodes, each with a support set to learn from and a query set to be scored on, drawn from classes kept apart from the test classes. **Metric-based** methods learn an embedding: a prototypical network averages each class's support embeddings into a prototype and labels a query by the nearest prototype. **Optimization-based** methods learn a starting point: MAML (model-agnostic meta-learning) trains the initial weights so that one or a few gradient steps on a new task's support set already fit it, which needs gradients of gradients; first-order MAML drops the second derivatives, and Reptile simply moves the start towards the weights each task trained to. A plain baseline is strong: train an ordinary classifier on all training classes and fit a linear classifier on its features. Large language models do few-shot learning in context: demonstrations go into the prompt and no weight changes.
**Use this when:** a new class or task comes with a handful of labelled examples, you read few-shot benchmark numbers, you choose between a prototypical network, MAML and a pretrained embedding, or you meet "N-way K-shot", "support set", "episode" or "inner loop".
**Not this doc:** reusing a pretrained network in general → `machine-learning/deep-learning/data-augmentation-and-transfer-learning.md`; learning embeddings without labels → `machine-learning/deep-learning/embeddings-and-self-supervised-learning.md`; how a language model is pretrained (the next-token objective, scaling laws) → `machine-learning/transformers/pretraining-and-scaling-laws.md`; nearest-neighbour classification itself → `machine-learning/supervised-learning/k-nearest-neighbors.md`; learning tasks one after another without forgetting → `machine-learning/deep-learning/continual-learning.md`; how in-context learning works inside a transformer → `machine-learning/transformers/in-context-learning-and-prompting.md`.

## Problem
A new class arrives with five labelled images. Re-training a network on them would severely overfit ✅[^2]. Comparing the new images with the five examples directly works only when examples of a class look alike pixel by pixel: in the lab, symbols drawn at random positions give a 5-way 1-shot accuracy of 0.209 from raw pixels, against 0.200 for guessing ✅[^9]. Pretraining one model on all the old tasks and fine-tuning it can fail too: when the tasks give different outputs for the same input, such a model learns the average output and may learn very little about the domain ✅[^1]; for Nichol et al.'s sine waves, whose phase is drawn from the full period [0, 2π], the average is zero everywhere, so the expected loss is minimized by the zero function ✅[^3]. MAML and the lab draw the phase from [0, π] ✅[^1], half a period, so the average is not zero (the mean of `sin(x + b)` over `b` in [0, π] is `(2/π)·cos x`) but it is still one fixed curve for every task. In the lab a pretrained sine model's error after one adaptation step is 2.310, against 0.658 for MAML ✅[^9]. On top of this, few-shot results are hard to compare, because implementation details differ and baselines can be significantly under-estimated ✅[^4].

## Mental model
**Analogy:** a translation agency that trains new hires with hundreds of short drills. Each drill shows one example sentence for each of five unfamiliar terms (the support set), then asks for fifteen more sentences with those terms (the query set), and only the fifteen are graded. Hires who pass many drills on different term lists get good at learning terms fast. A prototypical network is the hire who builds a mental map where examples of the same term cluster, and files each new sentence under the nearest cluster centre. MAML is the hire who learns a state of mind from which a few minutes of practice on any new list is enough. The pretrained baseline is the hire who simply studied a large general dictionary well. In-context learning is the hire who reads the examples in the request itself and answers without studying at all.

**Artifact:** the Worked example script's prototype rule, written out for one 5-way 1-shot test episode:

```python
s, q = episode(Xnovel, 5, 1, 15, g)                  # support (5, 1, 1, 12, 12), query (5, 15, 1, 12, 12)
c = f(flat(s)).reshape(5, 1, -1).mean(1)             # one prototype per class: mean of its embedded support images
scores = -torch.cdist(f(flat(q)), c) ** 2            # (75, 5): minus the squared Euclidean distance
pred = scores.argmax(1)                              # nearest prototype; softmax(scores) is the training loss's input
```

In numbers, with a 2-D embedding: class A's support points `(1, 0)` and `(3, 0)` give the prototype `c_A = (2, 0)`, class B's single point gives `c_B = (0, 2)`. A query at `(2, 1)` is at squared distance 1 from `c_A` and 5 from `c_B`, so `p(A) = e^(−1) / (e^(−1) + e^(−5)) = 0.982`.

## How it works
### Tasks, episodes and the two loops
1. **N-way K-shot:** a task gives K examples of each of N classes, NK points in all; the model sees them and must classify new instances of the same N classes, which were not seen in training ✅[^1].
2. **Support and query:** the labelled examples to learn from form the support set, the points to classify the query set ✅[^2]; the survey by Hospedales et al. notes these are the per-task training and validation sets of meta-training ✅[^6].
3. **Episodes:** training mini-batches that mimic the few-shot test by subsampling classes and points, which makes training more faithful to the test ✅[^2]. In MAML's terms, the test error on sampled tasks is the training error of the meta-learner, and the tasks used for meta-testing are generally held out of meta-training ✅[^1].
4. **Learning to learn:** an inner (base) learner solves each task; an outer (meta) learner changes the inner learner so that it does better on an outer objective, such as generalization or learning speed ✅[^6]. Written as bilevel optimization, the outer problem picks the meta-knowledge `ω` that minimizes the query-set loss of the inner solution `θ*(ω)`, and the inner problem fits `θ` on the support set given `ω` ✅[^6]. The conventional taxonomy, which the survey reports before proposing a finer one, splits methods three ways: optimization-based (the inner problem is solved by optimization, as in MAML), model-based or black-box (a network absorbs the support set into its activations and predicts in one forward pass) and metric-based (compare queries with support points in a learned feature space) ✅[^6].
5. **Benchmarks:** Omniglot has 1,623 characters from 50 alphabets, 20 drawings each by different people; miniImageNet, proposed by Vinyals et al., has 100 classes of 600 images of 84 × 84 pixels, and the split by Ravi and Larochelle uses a different set of 100 classes, 64 / 16 / 20 for training, validation and test; miniImageNet accuracy is averaged over 600 test episodes with 95 % confidence intervals ✅[^2].

```text
meta-training (outer loop, many iterations)
 ├─ sample a batch of tasks from p(T)                      lab: 25 sine waves, K = 10 points each
 ├─ inner loop on each task's support set                  MAML: theta'_i = theta - alpha * grad L_support(theta)
 ├─ score each adapted model on the task's query set       L_query(theta'_i)
 └─ update what is shared (theta, or the embedding f)      Adam on the mean query loss
meta-test: a new task → the same inner loop from what was learned → score on its query set
```

### Metric-based: prototypical networks
```text
c_k = (1/|S_k|) · Σ_{(x_i, y_i) ∈ S_k} f_φ(x_i)                   prototype of class k
p(y = k | x) = exp(−d(f_φ(x), c_k)) / Σ_k' exp(−d(f_φ(x), c_k'))   d = squared Euclidean distance
J(φ) = −log p(y = true class | x)                                  averaged over the episode's query points
```
`f_φ` is the embedding network with weights `φ`, `S_k` the support examples of class `k`, `x` a query point.
1. **Prototypes and loss:** each prototype is the mean embedded support point of its class; queries get a softmax over negative distances, and training minimizes the negative log-probability of the true class with SGD (stochastic gradient descent) over episodes ✅[^2]. Short name used below: ProtoNet. The Mental model artifact computes one episode.
2. **Why the mean:** for a Bregman divergence such as squared Euclidean distance, the mean is the cluster representative closest to its points, and the model equals mixture density estimation with an exponential-family density ✅[^2]. Squared Euclidean distance greatly outperformed cosine distance, which the authors conjecture is mainly because cosine is not a Bregman divergence ✅[^2].
3. **It is a linear classifier on the embedding:** expanding `−‖f(x) − c_k‖²` gives weights `w_k = 2·c_k` and bias `b_k = −c_kᵀc_k`, so the non-linearity lives entirely in `f_φ` ✅[^2].
4. **Episode design:** training with more classes per episode ("way") than the test uses helped, and the number of shots was best matched between training and test ✅[^2]. In the one-shot case a prototypical network equals a matching network ✅[^2].
5. **Reported scale:** 5-way miniImageNet accuracy of 49.42 % (1-shot) and 68.20 % (5-shot) with a four-block convolutional embedding ✅[^2].

### Optimization-based: MAML, first-order MAML and Reptile
```text
θ'_i = θ − α · ∇_θ L_Ti(f_θ)                   inner step: SGD on task i's K support points
θ    ← θ − β · ∇_θ Σ_i L_Ti(f_θ'_i)            outer step: loss of each adapted model on fresh points of its task
```
`θ` are the shared initial weights, `α` the inner step size (0.01 in the sine experiment), `β` the meta step size, `L_Ti` task `i`'s loss and `θ'_i` its adapted weights ✅[^1].
1. **MAML** learns only an initialization: it adds no parameters and fits any model trained by gradient descent ✅[^1]. Because the outer loss is evaluated at `θ'_i`, which depends on a gradient of `θ`, the meta-gradient passes through a gradient: it needs Hessian-vector products (the Hessian is the matrix of second derivatives) from an additional backward pass ✅[^1]. In PyTorch, `torch.autograd.grad(..., create_graph=True)` builds the graph of the derivative so that higher-order derivative products can be taken ✅[^8].
2. **First-order MAML (FOMAML)** treats the inner gradients as constants, replacing the Jacobian of the update (its matrix of derivatives with respect to the start) by the identity, so the outer gradient is just the query-loss gradient at the adapted weights ✅[^3]. Worked numbers on a 1-D task with loss `(θ − 3)²`, `α = 0.25` and `θ = 1`: the inner step gives `θ' = 1 − 0.25 · 2 · (1 − 3) = 2`; the query loss `(θ' − 3)²` has gradient `−2` at `θ'`, which FOMAML uses; the exact meta-gradient multiplies it by `dθ'/dθ = 1 − 2α = 0.5`, giving `−1`. On miniImageNet the approximation lost almost nothing (48.07 % vs 48.70 % 1-shot, 63.15 % vs 63.11 % 5-shot) and ran about 33 % faster ✅[^1]; its authors relate this to ReLU (rectified linear unit) networks being locally almost linear, which suggests the second derivatives may be close to zero in most cases ✅[^1].
3. **Reptile:** sample a task, run `k` steps of SGD or Adam from `φ` to reach `φ̃`, then move the start: `φ ← φ + ε · (φ̃ − φ)`, or average `φ̃ − φ` over a batch of tasks ✅[^3]. Example: from `φ = 1` towards a task optimum 3, two steps reach `φ̃ = 2.5`, and `ε = 0.5` moves the start to 1.75. With `k = 1` this is ordinary SGD on the expected loss, that is joint training; with `k > 1` the update contains second- and higher-derivative terms and converges elsewhere ✅[^3]. It needs no split of each task into training and test points ✅[^3]. A Taylor expansion shows that MAML, FOMAML and Reptile share the same leading terms: one that minimizes the expected loss and one that maximizes the inner product between gradients of different minibatches of the same task, that is within-task generalization ✅[^3].
4. **Cost:** differentiating through many inner steps is expensive in time and memory, which is one reason meta-learning concentrated on the few-shot regime ✅[^6]; MAML is a poor match when many gradient steps are needed at test time ✅[^3].

### The baseline that keeps winning: a good embedding and a simple classifier
1. **Pretrain, then fit a new head:** Chen et al.'s Baseline trains a feature extractor and classifier on the base classes with cross-entropy, then freezes the extractor and trains a new classifier on the novel classes' support set; Baseline++ replaces the linear classifier by cosine similarities to class weight vectors, which reduces intra-class variation ✅[^4].
2. **Fair comparison changes the ranking:** with shallow backbones, methods that reduce intra-class variation look better; deeper backbones shrink the gaps between methods when base and novel classes come from similar domains ✅[^4]. Under a domain shift from miniImageNet to CUB (Caltech–University of California San Diego Birds, a fine-grained bird-species dataset), with a ResNet-18 (an 18-layer residual network), the Baseline reached 65.57 % 5-shot accuracy against 62.02 % for ProtoNet and 51.34 % for MAML ✅[^4].
3. **A linear probe matches or beats the meta-learners on standard benchmarks:** Tian et al. merge all meta-training classes into one classification task, freeze the trained network and fit logistic regression on each test task's support embeddings; with a ResNet-12 (a 12-layer residual network) this was comparable with the best earlier method on miniImageNet and beat all previous work by at least 3 % on tieredImageNet, self-distillation added 2–3 %, and self-supervised embeddings did about as well as supervised ones ✅[^5]. Logistic regression beat nearest neighbour unless the features were ℓ2-normalized at 1-shot, and stayed clearly better at 5-shot ✅[^5]. Fine-tuning the network on the support set did worse than the frozen embedding in their comparison (57.73 % vs 61.1 %) ✅[^5]. They do not dismiss meta-learning: methods like MAML may still be favourable in other domains such as meta-reinforcement learning ✅[^5].
4. **Transfer learning versus meta-learning:** transfer learning extracts its prior by ordinary training on the source task, without a meta-objective; meta-learning chooses the prior by how well it helps a new task learn ✅[^6]. The fine-tuning mechanics are in `machine-learning/deep-learning/data-augmentation-and-transfer-learning.md`.

### In-context learning in large language models
GPT-3 (Generative Pre-trained Transformer 3) frames language-model pretraining as the outer loop and in-context learning as the inner loop, which happens within the forward pass over each sequence ✅[^7]. The few-shot, one-shot and zero-shot settings are defined in `machine-learning/transformers/in-context-learning-and-prompting.md`. Seen as meta-learning, the result that matters here is that performance rose with the number of demonstrations and with model size for most tasks studied ✅[^7], and that GPT-3's few-shot results were sometimes competitive with fine-tuned models ✅[^7]. How pretraining works is in `machine-learning/transformers/pretraining-and-scaling-laws.md`; fine-tuning a language model instead is in `machine-learning/transformers/fine-tuning-and-lora.md`.

How a transformer does this inside its forward pass (induction heads, in-context regression, what the demonstrations contribute) is the subject of `machine-learning/transformers/in-context-learning-and-prompting.md`.

## Worked example
One script, three parts, all measuring how well a model does on a task it has never seen after learning from K examples:
1. **Classification on synthetic glyphs:** 100 random 5 × 5 binary symbols, each drawn 40 times at a random place on a 12 × 12 canvas with Gaussian noise (standard deviation 0.2); 80 base classes for training, 20 novel classes for 600 test episodes (5-way, 15 queries per class). A small CNN (convolutional neural network: two 3 × 3 convolutions, 64-dimensional output) is trained three ways: as a prototypical network on 1,500 20-way episodes per shot setting; as an ordinary 80-way classifier for 3,000 steps of batch 128, whose embedding then feeds prototypes or a logistic-regression linear probe; or not at all (random weights).
2. **The same prototypical-network recipe on `load_digits`** with only 5 base classes (digits 0–4) and digits 5–9 as novel classes.
3. **Sine-wave regression**, the MAML paper's toy problem: amplitude in [0.1, 5], phase in [0, π], `x` in [−5, 5], K = 10 points, a 1-40-40-1 ReLU MLP (multilayer perceptron), inner step `α = 0.01`, Adam as the meta-optimizer ✅[^1]; 4,000 meta-iterations of 25 tasks for MAML and first-order MAML (one inner step each) and Reptile (10 inner steps, outer step 1.0 annealed to 0), and a model pretrained on all tasks whose fine-tuning step size is picked from {0.005, 0.01, 0.02} on other tasks. Each model is then adapted to 200 new tasks with n plain SGD steps on their 10 points and scored by MSE (mean squared error) on 100 fresh points.

The core of MAML's inner loop, shared by all four sine models:

```python
th = [p.expand(x.shape[0], *p.shape[1:]) for p in ps]          # one copy of the weights per task
grads = torch.autograd.grad(task_mse(th, x, y).sum(), th, create_graph=second_order)
th = [w - alpha * gr for w, gr in zip(th, grads)]               # without create_graph the grads are constants
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-25, PyTorch 2.15.0, scikit-learn 1.9.1, CPU (central processing unit) with one thread, two runs identical, about 2 minutes (111 seconds in the re-run) ✅[^9]:

```text
== (1) glyphs: 80 base classes to train on, 20 novel classes for 600 test episodes (5-way, 15 queries) ==
5-way 1-shot | raw pixels 0.209 +- 0.004 | random CNN 0.222 +- 0.004 | ProtoNet 0.690 +- 0.010
             | supervised CNN + prototypes 0.468 +- 0.008 | supervised CNN + linear probe 0.472 +- 0.008
5-way 5-shot | raw pixels 0.221 +- 0.004 | random CNN 0.239 +- 0.004 | ProtoNet 0.905 +- 0.004
             | supervised CNN + prototypes 0.662 +- 0.008 | supervised CNN + linear probe 0.788 +- 0.007
== (2) digits: ProtoNet trained on only 5 base classes (0-4), tested on 5-9 ==
5-way 1-shot | raw pixels 0.721 +- 0.006 | ProtoNet 0.444 +- 0.008
5-way 5-shot | raw pixels 0.885 +- 0.004 | ProtoNet 0.543 +- 0.006
== (3) sine waves, K=10: mean MSE on 200 new tasks after n SGD steps on their 10 points ==
n steps                          0      1      2      5     10
pretrained, step size 0.01       3.223  2.310  1.991  1.696  1.486
MAML (second order), step 0.01   3.255  0.658  0.423  0.293  0.245
first-order MAML, step 0.01      3.680  0.813  0.511  0.376  0.306
Reptile, step 0.01               3.222  0.951  0.556  0.346  0.251
meta-gradient at the MAML weights: cosine(second order, first order) = 0.454, norms 1.665 vs 1.887
Reptile again, PyTorch's default nonzero bias init: weights first non-finite at iteration 2756
```

<details><summary>Full script (prints the output above)</summary>

```python
# Few-shot learning, three ways (PyTorch, CPU, no downloads):
# (1) N-way K-shot episodes on synthetic glyph classes: raw pixels vs a prototypical network vs a supervised
#     embedding (prototypes or a linear probe), all tested on classes never seen in training;
# (2) the same prototypical-network recipe on load_digits with only 5 training classes;
# (3) sine-wave regression: MAML (second order), first-order MAML and Reptile vs a model pretrained on all tasks.
import math
import torch
from torch import nn
import torch.nn.functional as F
from sklearn.datasets import load_digits
from sklearn.linear_model import LogisticRegression
torch.set_num_threads(1); torch.use_deterministic_algorithms(True)

def episode(Xc, way, shot, query, g):                   # Xc: (classes, examples per class, ...)
    cls = torch.randperm(Xc.shape[0], generator=g)[:way]
    idx = torch.stack([torch.randperm(Xc.shape[1], generator=g)[:shot + query] for _ in range(way)])
    ex = Xc[cls[:, None], idx]
    return ex[:, :shot], ex[:, shot:]                   # support (way, shot, ...), query (way, query, ...)
flat = lambda x: x.reshape(-1, *x.shape[2:])
def proto_scores(f, s, q):                              # -squared distance from each query to each class mean
    c = f(flat(s)).reshape(s.shape[0], s.shape[1], -1).mean(1)
    return -torch.cdist(f(flat(q)), c) ** 2
nearest_proto = lambda f: (lambda s, q: proto_scores(f, s, q).argmax(1))
def linear_probe(f):                                    # logistic regression fitted on the support embeddings
    def predict(s, q):
        lab = torch.arange(s.shape[0]).repeat_interleave(s.shape[1]).numpy()
        clf = LogisticRegression(max_iter=1000).fit(f(flat(s)).numpy(), lab)
        return torch.tensor(clf.predict(f(flat(q)).numpy()))
    return predict
@torch.no_grad()
def test(Xnovel, predict, shot, n=600, seed=7):         # mean accuracy over n 5-way episodes, 15 queries per class
    g = torch.Generator().manual_seed(seed); accs = []
    for _ in range(n):
        s, q = episode(Xnovel, 5, shot, 15, g)
        accs.append((predict(s, q) == torch.arange(5).repeat_interleave(15)).float().mean().item())
    a = torch.tensor(accs)
    return f"{a.mean().item():.3f} +- {1.96 * a.std().item() / n ** 0.5:.3f}"
def train_protonet(f, Xbase, way, shot, episodes, query=5):
    g = torch.Generator().manual_seed(0); opt = torch.optim.Adam(f.parameters(), lr=1e-3)
    for _ in range(episodes):
        s, q = episode(Xbase, way, shot, query, g)
        loss = F.cross_entropy(proto_scores(f, s, q), torch.arange(way).repeat_interleave(query))
        opt.zero_grad(); loss.backward(); opt.step()
    return f

# (1) 100 random 5x5 binary glyphs, each drawn at a random place on a 12x12 canvas plus noise; 80 base, 20 novel
S, G, N_PER = 12, 5, 40
glyphs = (torch.rand(100, G, G, generator=torch.Generator().manual_seed(0)) < 0.45).float()
def render(gl, seed, noise=0.2):
    g = torch.Generator().manual_seed(seed); X = torch.zeros(len(gl), N_PER, 1, S, S)
    for c, t in enumerate(gl):
        for k in range(N_PER):
            r, col = torch.randint(0, S - G + 1, (2,), generator=g).tolist()
            X[c, k, 0, r:r + G, col:col + G] = t
    return X + noise * torch.randn(X.shape, generator=g)
Xbase, Xnovel = render(glyphs[:80], 1), render(glyphs[80:], 2)
def cnn():
    return nn.Sequential(nn.Conv2d(1, 32, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2), nn.Conv2d(32, 32, 3, padding=1),
                         nn.ReLU(), nn.MaxPool2d(2), nn.Flatten(), nn.Linear(288, 64))
protonets = {}
for shot in (1, 5):                                     # train with 20-way episodes, test with 5-way
    torch.manual_seed(0); protonets[shot] = train_protonet(cnn(), Xbase, 20, shot, 1500)
torch.manual_seed(0); sup, head = cnn(), nn.Linear(64, 80)   # supervised: ordinary 80-way classification
opt = torch.optim.Adam(list(sup.parameters()) + list(head.parameters()), lr=1e-3)
g = torch.Generator().manual_seed(0); Xall, yall = flat(Xbase), torch.arange(80).repeat_interleave(N_PER)
for _ in range(3000):
    i = torch.randint(len(yall), (128,), generator=g)
    loss = F.cross_entropy(head(F.relu(sup(Xall[i]))), yall[i]); opt.zero_grad(); loss.backward(); opt.step()
torch.manual_seed(0); rand_cnn = cnn()
raw = lambda x: x.reshape(x.shape[0], -1)
print("== (1) glyphs: 80 base classes to train on, 20 novel classes for 600 test episodes (5-way, 15 queries) ==")
for shot in (1, 5):
    print(f"5-way {shot}-shot | raw pixels {test(Xnovel, nearest_proto(raw), shot)} | random CNN {test(Xnovel, nearest_proto(rand_cnn), shot)}"
          f" | ProtoNet {test(Xnovel, nearest_proto(protonets[shot]), shot)}")
    print(f"             | supervised CNN + prototypes {test(Xnovel, nearest_proto(sup), shot)}"
          f" | supervised CNN + linear probe {test(Xnovel, linear_probe(sup), shot)}")

# (2) load_digits: train on digits 0-4 only (5 classes), test on digits 5-9
X, y = load_digits(return_X_y=True)
X, y = torch.tensor(X / 16.0, dtype=torch.float32), torch.tensor(y)
by_class = torch.stack([X[y == c][:170] for c in range(10)])  # (10, 170, 64)
print("== (2) digits: ProtoNet trained on only 5 base classes (0-4), tested on 5-9 ==")
for shot in (1, 5):
    torch.manual_seed(0)
    f = train_protonet(nn.Sequential(nn.Linear(64, 128), nn.ReLU(), nn.Linear(128, 64)), by_class[:5], 5, shot, 1000)
    print(f"5-way {shot}-shot | raw pixels {test(by_class[5:], nearest_proto(raw), shot)} | ProtoNet {test(by_class[5:], nearest_proto(f), shot)}")

# (3) sine regression (Finn et al.): amplitude in [0.1, 5], phase in [0, pi], x in [-5, 5]; K = 10 points per task
K, ALPHA, TB, ITERS = 10, 0.01, 25, 4000
def tasks(n, g):
    return 0.1 + 4.9 * torch.rand(n, 1, 1, generator=g), math.pi * torch.rand(n, 1, 1, generator=g)
def points(amp, ph, m, g):
    x = -5 + 10 * torch.rand(amp.shape[0], m, 1, generator=g)
    return x, amp * torch.sin(x + ph)
def init_params(zero_bias=True):                        # 1-40-40-1 ReLU MLP, kept as tensors for batched tasks
    torch.manual_seed(0); ps = []
    for i, o in [(1, 40), (40, 40), (40, 1)]:
        lin = nn.Linear(i, o)
        b = torch.zeros(1, 1, o) if zero_bias else lin.bias.detach()[None, None].clone()
        ps += [lin.weight.detach().T[None].clone().requires_grad_(), b.requires_grad_()]
    return ps
def mlp(ps, x):                                         # ps may carry one copy of the weights per task
    h = torch.relu(x @ ps[0] + ps[1]); h = torch.relu(h @ ps[2] + ps[3]); return h @ ps[4] + ps[5]
def task_mse(ps, x, y):
    return ((mlp(ps, x) - y) ** 2).mean(dim=(1, 2))     # one mean squared error per task
def adapt(ps, x, y, steps, alpha=ALPHA, second_order=False):   # inner loop: plain SGD on each task's K points
    th = [p.expand(x.shape[0], *p.shape[1:]) for p in ps]
    for _ in range(steps):
        grads = torch.autograd.grad(task_mse(th, x, y).sum(), th, create_graph=second_order)
        th = [w - alpha * gr for w, gr in zip(th, grads)]   # without create_graph the grads are constants
    return th
def meta_train(kind, zero_bias=True):                   # returns the weights and the first non-finite iteration
    ps, g, broken = init_params(zero_bias), torch.Generator().manual_seed(1), None
    opt = torch.optim.Adam(ps, lr=1e-3)
    for it in range(ITERS):
        amp, ph = tasks(TB, g); xs, ys = points(amp, ph, K, g); xq, yq = points(amp, ph, K, g)
        if kind == "reptile":                           # 10 SGD steps per task, then move the start towards the result
            th = adapt([p.detach().requires_grad_() for p in ps], xs, ys, 10)
            with torch.no_grad():
                for p, w in zip(ps, th):
                    p += (1 - it / ITERS) * (w.mean(0, keepdim=True) - p)   # outer step size 1.0, annealed to 0
            if broken is None and not all(torch.isfinite(p).all() for p in ps):
                broken = it
            continue
        if kind == "pretrain":                          # joint training: fit all tasks with one function
            loss = task_mse(ps, xs, ys).mean()
        else:                                           # MAML / FOMAML: loss on fresh points after one inner step
            loss = task_mse(adapt(ps, xs, ys, 1, second_order=(kind == "maml")), xq, yq).mean()
        opt.zero_grad(); loss.backward(); opt.step()
    return ps, broken
def after_steps(ps, alpha=ALPHA, seed=999, steps=(0, 1, 2, 5, 10)):   # 200 new tasks, MSE on 100 fresh points
    g = torch.Generator().manual_seed(seed)
    amp, ph = tasks(200, g); xs, ys = points(amp, ph, K, g); xq, yq = points(amp, ph, 100, g)
    return [task_mse(adapt(ps, xs, ys, s, alpha), xq, yq).mean().item() for s in steps]
models = {k: meta_train(k)[0] for k in ("pretrain", "maml", "fomaml", "reptile")}
best = min((0.005, 0.01, 0.02), key=lambda a: after_steps(models["pretrain"], a, seed=555)[-1])  # tuned on other tasks
print(f"== (3) sine waves, K={K}: mean MSE on 200 new tasks after n SGD steps on their {K} points ==")
print("n steps                          0      1      2      5     10")
rows = [("pretrained, step size %g" % best, models["pretrain"], best), ("MAML (second order), step 0.01", models["maml"], ALPHA),
        ("first-order MAML, step 0.01", models["fomaml"], ALPHA), ("Reptile, step 0.01", models["reptile"], ALPHA)]
for name, ps, a in rows:
    print(f"{name:31s}" + "".join(f"{v:7.3f}" for v in after_steps(ps, a)))
g = torch.Generator().manual_seed(3); amp, ph = tasks(TB, g); xs, ys = points(amp, ph, K, g); xq, yq = points(amp, ph, K, g)
ps = models["maml"]
g2 = torch.autograd.grad(task_mse(adapt(ps, xs, ys, 1, second_order=True), xq, yq).mean(), ps)
g1 = torch.autograd.grad(task_mse(adapt(ps, xs, ys, 1, second_order=False), xq, yq).mean(), ps)
v2, v1 = torch.cat([t.flatten() for t in g2]), torch.cat([t.flatten() for t in g1])
print(f"meta-gradient at the MAML weights: cosine(second order, first order) = {F.cosine_similarity(v2, v1, 0).item():.3f}"
      f", norms {v2.norm().item():.3f} vs {v1.norm().item():.3f}")
print(f"Reptile again, PyTorch's default nonzero bias init: weights first non-finite at iteration {meta_train('reptile', zero_bias=False)[1]}")
```

</details>

Reading it:
- **Raw pixels cannot do it.** With symbols at random positions, nearest prototype on raw pixels scores 0.209 (1-shot) and 0.221 (5-shot), next to chance at 0.200; a random CNN adds little (0.222, 0.239).
- **Episodic training learns a metric that transfers.** The prototypical network reaches 0.690 and 0.905 on 20 classes it never saw: the embedding learned what makes two drawings the same symbol, wherever it sits.
- **Here the supervised baseline trails.** The 80-way classifier's embedding gives 0.468 / 0.662 with prototypes and 0.472 / 0.788 with a linear probe. This small two-convolution backbone is the shallow case in which Chen et al. saw methods that reduce intra-class variation do better ✅[^4]; with their four-layer backbone, ProtoNet also beat their Baseline on miniImageNet 5-shot (64.24 % vs 62.53 %) ✅[^4]. The linear probe gains most at 5-shot (+0.126 over prototypes), where it has 25 points to fit.
- **Too few training classes reverse the result.** On digits with 5 base classes the prototypical network falls to 0.444 / 0.543, far below raw pixels (0.721 / 0.885): the embedding fits its 5 training classes and does not transfer. Hospedales et al. name the cause in general: the number of tasks available for meta-training is typically low, which makes generalizing to new tasks hard ✅[^6].
- **Pretraining on all sine tasks learns the average.** All models start near an MSE of 3.2 before adaptation (FOMAML 3.680), but only the pretrained one stays high: 2.310 after one step, 1.486 after ten.
- **MAML trains for one step and keeps improving with more.** 0.658 after one step and 0.245 after ten, the behaviour the MAML paper reports ✅[^1]. Reptile starts slower (0.951 after one step) and catches up by ten (0.251); first-order MAML ends in between (0.306).
- **Dropping second derivatives changes the direction here.** At the MAML weights the exact and first-order meta-gradients have a cosine of only 0.454, yet first-order MAML still learns an initialization about five times better after ten steps than pretraining (0.306 vs 1.486).
- **An inner loop can blow up.** Reptile from PyTorch's default nonzero biases reached non-finite weights at iteration 2,756: an inner loop that diverges is averaged straight into the shared start. The runs above start from zero biases and stay finite.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Few distinct training classes | The learned embedding loses to raw pixels (lab digits 0.444 vs 0.721) ✅[^9] | Few meta-training tasks make generalization to new tasks hard ✅[^6] |
| Test classes from another domain | Meta-learners fall behind a plain fine-tuned baseline (65.57 % vs 62.02 % ProtoNet, 51.34 % MAML) | They learned to learn within one dataset's classes ✅[^4] |
| Tasks solvable without the support set | Meta-test fails although meta-training looked fine | Memorisation, a form of meta-overfitting ✅[^6] |
| Cosine instead of squared Euclidean in a prototypical network | Clearly worse accuracy | The authors conjecture the main reason is that cosine is not a Bregman divergence, so the equivalence to mixture density estimation no longer holds ✅[^2] |
| Training way and shot differ from the test | More way in training helped; mismatched shot usually hurt | Prototypical networks' episode-composition results ✅[^2] |
| Batch norm shared across all test queries (transduction) | A boost in every case Nichol et al. measured | Information flows between test samples via batch-norm statistics; MAML was evaluated this way ✅[^3] |
| Same benchmark name, different class split | Numbers not directly comparable; Chen et al. say so of their results against Vinyals et al.'s original miniImageNet ✅[^4] | Two versions exist; the Ravi–Larochelle split is 64 / 16 / 20 classes ✅[^2] ✅[^4], and MAML's text gives 64 / 12 / 24 although it cites Ravi and Larochelle ✅[^1]; name the split's source next to every number |
| Pretraining on tasks whose outputs conflict | The model learns the average output and adapts poorly | MAML's multi-task baseline discussion ✅[^1]; zero average when the phase spans the full period [0, 2π] ✅[^3]; lab 1.486 after 10 steps ✅[^9] |
| Inner loop of fixed-size steps | Can diverge and poison the shared start (lab: non-finite at iteration 2,756) ✅[^9] | The outer update averages the adapted weights |
| Momentum in Reptile's inner optimizer | Lower performance across the board | It mixes consecutive minibatches, which Reptile relies on being separate ✅[^3] |
| Many inner steps with second-order MAML | Time and memory grow with the steps | Reverse-mode differentiation stores every inner state ✅[^6] |
| Fine-tuning the whole network on the support set | Worse than a frozen embedding plus logistic regression (57.73 % vs 61.1 %) | Fine-tuning on a small set of samples made performance worse ✅[^5] |
| Nearest neighbour on unnormalized features | Worse than logistic regression | Feature scale; normalizing closes the gap at 1-shot only ✅[^5] |
| In-context few-shot instead of fine-tuning | Usually behind state-of-the-art fine-tuned models, sometimes competitive; `K` capped by the context window | GPT-3's stated main disadvantage, its results and its 10–100 demonstrations ✅[^7] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Prototypical network | Simpler and more efficient than the meta-learners it was compared with ✅[^2]; no inner-loop optimization ✅[^5]; best in the lab's glyph run (0.905 5-shot) ✅[^9] | Metric methods are hard to extend beyond classification, for example to reinforcement learning ✅[^1]; needs many base classes (lab digits 0.543) ✅[^9] |
| MAML (second order) | Any model and loss, including regression and reinforcement learning ✅[^1]; best 1-step error in the lab (0.658) ✅[^9] | Hessian-vector products and an extra backward pass ✅[^1] |
| First-order MAML | Nearly MAML's miniImageNet accuracy, about 33 % faster ✅[^1] | Drops the Jacobian of the inner update ✅[^3]; lab 0.813 vs 0.658 after one step ✅[^9] |
| Reptile | Only first-order steps, no per-task split ✅[^3]; lab matched MAML at 10 steps (0.251 vs 0.245) ✅[^9] | Slower first step in the lab (0.951) ✅[^9]; inner loop must stay stable ✅[^9] |
| Pretrained embedding + linear probe | Simple; matched or beat meta-learning on standard benchmarks with a ResNet-12 ✅[^5]; less affected by domain shift ✅[^4] | Weaker with a shallow backbone in the lab (0.788 vs 0.905) ✅[^9] |
| In-context learning (large language model) | No weight updates; far less task-specific data ✅[^7] | Usually behind fine-tuned models; bounded by the context window ✅[^7] |

## Takeaways
- Before claiming a meta-learning gain, report a pretrained-embedding baseline (linear probe and fine-tuning) with the same backbone, data augmentation and test episodes. [rule-candidate]
- Meta-test only on classes held out of meta-training, average over hundreds of episodes with a 95 % confidence interval, and state way, shot, queries per class and whether batch norm is transductive. [rule-candidate]
- Episodic training needs many distinct training classes; with only a handful, start from a pretrained embedding instead.
- For gradient-based meta-learning, try first-order MAML or Reptile before second-order MAML, and stop training on the first non-finite weight.

## Verification status
- Verified: 93 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [Model-Agnostic Meta-Learning for Fast Adaptation of Deep Networks](https://arxiv.org/html/1703.03400v3) — Finn, Abbeel, Levine, 2017. Backs: N-way K-shot set-up, test error as meta-training error, held-out meta-test tasks, the inner and outer updates, no added parameters, Hessian-vector products, the sine-wave set-up and its continued improvement with more steps, first-order results and 33 % speed-up, the ReLU remark, the miniImageNet class counts in its text, the averaging pretrained baseline. [^1]
- [Prototypical Networks for Few-shot Learning](https://arxiv.org/html/1703.05175v2) — Snell, Swersky, Zemel, 2017. Backs: overfitting when re-training on few examples, support and query sets, episodes, prototypes, the softmax over distances and the loss, Bregman divergences and mixture density estimation, Euclidean vs cosine and the authors' conjecture why, the linear-model view, way and shot in training, the one-shot equivalence with matching networks, Omniglot and miniImageNet facts (Vinyals et al.'s version and the Ravi–Larochelle split) and results. [^2]
- [On First-Order Meta-Learning Algorithms](https://arxiv.org/html/1803.02999v3) — Nichol, Achiam, Schulman, 2018. Backs: the [0, 2π] phase range and the zero average of random-phase sines, FOMAML as identity Jacobian, the Reptile update and batch version, `k = 1` equals joint training, no per-task split, the shared leading-order terms, momentum hurting, transduction via batch norm, MAML and many test-time steps. [^3]
- [A Closer Look at Few-shot Classification](https://arxiv.org/html/1904.04232v2) — Chen, Liu, Kira, Wang, Huang, 2019 (ICLR 2019; v2, 2020). Backs: under-estimated baselines, Baseline and Baseline++, backbone depth and intra-class variation, the Conv-4 miniImageNet table, the miniImageNet → CUB table, the 64 / 16 / 20 split and results not directly comparable across miniImageNet versions. [^4]
- [Rethinking Few-Shot Image Classification: a Good Embedding Is All You Need?](https://arxiv.org/html/2003.11539v2) — Tian, Wang, Krishnan, Tenenbaum, Isola, 2020. Backs: the merged-classification embedding with a logistic-regression probe, comparable on miniImageNet and at least 3 % better on tieredImageNet, no inner-loop optimization for metric methods, self-distillation gain, self-supervised embeddings, logistic regression vs nearest neighbour, fine-tuning on the support set worse, MAML possibly favourable elsewhere. [^5]
- [Meta-Learning in Neural Networks: A Survey](https://arxiv.org/html/2004.05439v2) — Hospedales, Antoniou, Micaelli, Storkey, 2020 (v2). Backs: learning-to-learn definition, inner and outer learners, support and query naming, bilevel optimization, the conventional three-way taxonomy, transfer vs meta-learning, few meta-training tasks and memorisation, computation and memory cost. [^6]
- [Language Models are Few-Shot Learners](https://arxiv.org/html/2005.14165v4) — Brown et al., 2020. Backs: in-context learning as the inner loop in the forward pass, few-, one- and zero-shot definitions, `K` of 10 to 100 in a 2,048-token window, agnostic terms, gains with demonstrations and model size, worse than fine-tuned models. [^7]
- [torch.autograd.grad](https://docs.pytorch.org/docs/2.15/generated/torch.autograd.grad.html) — PyTorch, 2026 (2.15). Backs: `create_graph=True` builds the derivative's graph for higher-order derivative products. [^8]
- `machine-learning/lab-setup.md` — the lab where the few-shot glyph, digits and sine-wave meta-learning script ran on 2026-11-25 (PyTorch 2.15.0, scikit-learn 1.9.1, CPU). [^9]

## Related
- `machine-learning/deep-learning/data-augmentation-and-transfer-learning.md` — freezing and fine-tuning a pretrained network, the mechanics behind the baseline.
- `machine-learning/deep-learning/embeddings-and-self-supervised-learning.md` — learning the embedding a prototype or probe sits on, also without labels.
- `machine-learning/transformers/pretraining-and-scaling-laws.md` — the pretraining objective and scaling of the language models that learn in context.
- `machine-learning/transformers/fine-tuning-and-lora.md` — adapting a language model's weights instead of prompting it.
- `machine-learning/supervised-learning/k-nearest-neighbors.md` — nearest-neighbour classification and why the distance decides everything.
- `machine-learning/deep-learning/continual-learning.md` — learning tasks in sequence without forgetting the old ones.
- `machine-learning/deep-learning/neural-networks-and-backpropagation.md` — the autograd machinery MAML differentiates through twice.
