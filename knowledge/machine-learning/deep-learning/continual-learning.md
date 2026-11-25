---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/deep-learning
status: verified
applies-to: ["PyTorch 2.15.0", "scikit-learn 1.9.1", "Avalanche 0.6 (docs only; not installed in the lab)"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, deep-learning, continual-learning, lifelong-learning, catastrophic-forgetting, task-incremental, domain-incremental, class-incremental, ewc, fisher-information, experience-replay, generative-replay, gem, parameter-isolation, backward-transfer, forward-transfer, stability-plasticity]
---

# Continual learning and catastrophic forgetting

## Summary
**TL;DR:** Continual learning trains one model on a sequence of tasks while only the current task's data is available. Plain fine-tuning overwrites what earlier tasks needed (catastrophic forgetting). Three families fight it: **regularization** (EWC, elastic weight consolidation, pulls each weight back to its old value with a stiffness given by the Fisher information), **replay** (mix stored or generated old examples into new training) and **parameter isolation** (give each task its own weights). How hard the problem is depends on the scenario: being told the task at test time (task-incremental) is far easier than having to name the class among all classes seen (class-incremental), where regularization alone failed in published comparisons and only replay-based methods worked. Score a run with the accuracy matrix: average accuracy, backward transfer (negative = forgetting) and forward transfer, against joint training on all data as the upper bound.
**Use this when:** a model must learn new classes, domains or tasks after deployment without retraining on everything, you compare continual-learning numbers from different papers, or you choose between EWC, a replay buffer and per-task heads.
**Not this doc:** forgetting the source task during a single fine-tune → `machine-learning/deep-learning/data-augmentation-and-transfer-learning.md`; replay buffers that decorrelate reinforcement-learning updates → `machine-learning/reinforcement-learning/deep-q-networks.md`; detecting that production data has shifted → `machine-learning/ml-systems/data-drift-and-monitoring.md`; learning to learn from a few examples → `machine-learning/deep-learning/meta-learning-and-few-shot-learning.md`.

## Problem
Data keeps arriving: new product classes, new sensors, new users. Replaying all past data needs a memory that grows with the number of tasks ✅[^1], and storing it may be impossible for privacy or memory reasons ✅[^2]. Training only on the new data destroys the old skills: catastrophic forgetting happens when a network is trained sequentially because the weights that task A needed are changed to meet the objectives of task B ✅[^1]. In the lab, a small network trained on five digit pairs in sequence answers its last pair perfectly and never again names a digit from the first four pairs correctly ✅[^12]. Comparing remedies is a second trap: the same method on the same benchmark can look solved or useless depending on how it is scored. Elastic weight consolidation reaches 98.64 % on split MNIST (the MNIST, Modified National Institute of Standards and Technology, handwritten digits cut into five tasks of two digits) when the task is given at test time and 20.01 % when the model must pick among all ten digits ✅[^2].

## Mental model
**Analogy:** a student with one notebook who takes one course per term and keeps no other notes. Writing the new course over the old pages is fine-tuning: the newest course is perfect, the old ones are gone. EWC is writing the key lines of each old course in ink, so they resist being overwritten, while the rest stays in pencil. Replay is a small box of flashcards from past courses, reviewed every day next to the new material. Parameter isolation is reserving separate pages per course, which only works if the exam says which course it is about. The exam format is the scenario: "this is the biology exam, answer the biology question" (task-incremental) versus "here is a question, from any course" (class-incremental).

**Artifact:** the accuracy matrix of plain fine-tuning on five digit pairs, scored both ways; row `i` is the model after task `i`, column `j` is task `j`; printed by the full script in the Worked example; lab run (`machine-learning/lab-setup.md`), 2026-11-25, PyTorch 2.15.0 ✅[^12]:

```text
== fine-tune, class-incremental: R[i][j] = accuracy on task j after training task i ==
after task 1: 1.000 0.000 0.000 0.000 0.000
after task 2: 0.000 1.000 0.000 0.000 0.000
after task 3: 0.000 0.000 1.000 0.000 0.000
after task 4: 0.000 0.000 0.000 1.000 0.000
after task 5: 0.000 0.000 0.000 0.000 1.000
== fine-tune, task-incremental: R[i][j] = accuracy on task j after training task i ==
after task 1: 1.000 0.509 0.440 0.500 0.509
after task 2: 0.908 1.000 0.486 0.824 0.302
after task 3: 0.495 0.898 1.000 0.389 0.491
after task 4: 0.514 0.509 0.633 1.000 0.557
after task 5: 0.505 0.620 0.761 0.991 1.000
```

Scored class-incrementally the matrix is the identity: each task is perfect right after training and at 0.000 one task later. Scored task-incrementally, with the same weights, old tasks keep part of their accuracy (task 4 still at 0.991 after task 5).

## How it works
### The setting and the three scenarios
1. **Protocol:** one network learns a series of tasks; during training only the current task's data is available, and the tasks have clear boundaries ✅[^2]. Without such boundaries, for example when tasks change gradually, the scenarios below no longer apply and the problem may become a lot harder ✅[^2].
2. **The scenarios** differ only in what the test asks ✅[^2]:

   | Scenario | At test time | Split MNIST example (5 tasks of 2 digits) |
   |---|---|---|
   | Task-incremental (Task-IL) | Solve the tasks so far; the task id is given | "Task 2: is it the first or the second digit of the pair?" |
   | Domain-incremental (Domain-IL) | Solve the tasks so far; task id not given, need not be inferred | "First or second digit of whichever pair it is?" (even or odd) |
   | Class-incremental (Class-IL) | Solve the tasks so far and infer the task | "Which digit, 0 to 9?" |

   Task-IL allows task-specific parts, typically a "multi-headed" output layer with one set of output units per task ✅[^2]. Any task sequence can be run under all three scenarios ✅[^2], so a reported number means little without its scenario.
3. **Forgetting is not interference.** Interference is two tasks being incompatible within one model even when trained together; forgetting is a task's performance dropping because training on a second task overwrote it ✅[^4]. Across three tasks in DMLab, a suite of 3-D game environments, separate and simultaneous training scored almost the same while sequential training forgot ✅[^4].
4. **Stability versus plasticity:** a continual learner needs plasticity (acquire new knowledge) and stability (keep old knowledge); catastrophic forgetting is the failure of stability ✅[^4]. Methods typically carry extra hyperparameters that set the balance between the two ✅[^6].

### Scoring: the accuracy matrix
After finishing task `i`, evaluate on the test set of every task `j` and store the accuracy as `R[i, j]` in a `T × T` matrix, `T` the number of tasks; `b̄_j` is the accuracy on task `j` of the randomly initialized model ✅[^3]:

```text
ACC = (1/T)     · Σ_{i=1..T}   R[T, i]                    average accuracy at the end
BWT = (1/(T−1)) · Σ_{i=1..T−1} (R[T, i] − R[i, i])        backward transfer: later learning's effect on old tasks
FWT = (1/(T−1)) · Σ_{i=2..T}   (R[i−1, i] − b̄_i)           forward transfer: earlier learning's effect on a new task
```

A large negative BWT is catastrophic forgetting; between two models with similar ACC, prefer the one with larger BWT and FWT ✅[^3]. Counted by the task being learned, backward transfer is meaningless for the first task and forward transfer for the last ✅[^3]. The sums above count by the task being scored, so BWT stops at task `T−1` (nothing is learned after task `T`) and FWT starts at task 2 (nothing is learned before task 1). Worked numbers from the lab's task-incremental fine-tuning (last row `0.505 0.620 0.761 0.991 1.000`, diagonal all `1.000`): `ACC = 3.877 / 5 = 0.775`, `BWT = (−0.495 − 0.380 − 0.239 − 0.009) / 4 = −0.281` ✅[^12]. The reference points are fine-tuning as the lower bound and joint training, the model always trained on the data of all tasks so far, as the upper bound ✅[^2]; joint training breaks the continual-learning rule, so it is a target, not a competitor ✅[^6].

### Three families of remedies
The survey by De Lange et al. groups methods into replay, regularization-based and parameter isolation methods ✅[^6].

**Regularization: elastic weight consolidation (EWC).**
1. **Why a penalty:** many weight settings give the same performance, so a solution for task B probably exists close to task A's solution `θ*_A`; EWC keeps the weights in task A's low-error region with a quadratic penalty, a spring whose stiffness is larger for the weights that matter most to task A ✅[^1].
2. **Where the stiffness comes from:** by Bayes' rule, everything about task A sits in the posterior `p(θ | D_A)`, which becomes the prior for task B. EWC approximates it by a Gaussian centred on `θ*_A` whose precision is the diagonal of the Fisher information matrix `F` ✅[^1]. `F` equals the second derivative of the loss near a minimum, needs only first derivatives, and is positive semi-definite ✅[^1]. The prior-as-posterior idea is the one in `machine-learning/probabilistic-ml/bayesian-inference.md`.
3. **The loss:** `L(θ) = L_B(θ) + Σ_i (λ/2) · F_i · (θ_i − θ*_A,i)²`, where `L_B` is task B's loss, `i` runs over the weights and `λ` sets how important the old task is against the new one ✅[^1]. Example: `F_i = 0.5`, a drift `θ_i − θ*_A,i = 0.2` and `λ = 100` cost `50 · 0.5 · 0.04 = 1.0`; a weight with `F_i = 0` may move freely. For a third task, keep one penalty per old task or merge them, since a sum of quadratic penalties is one quadratic penalty ✅[^1].
4. **Computing `F_i`:** Kirkpatrick et al. do not spell out the computation ✅[^2]; van de Ven and Tolias give it as the mean over the task's training inputs of the squared gradient of `log p(ŷ | x)`, the log-probability of the label the trained model predicts; sampling labels from the model or using the observed labels (the "empirical Fisher") are alternatives, and van de Ven and Tolias found their results did not depend much on the choice ✅[^2]. Online EWC keeps a single penalty anchored at the latest weights, with a running sum of the tasks' Fisher diagonals decayed by `γ ≤ 1`, so the cost no longer grows with the number of tasks ✅[^2].
5. **Why not plain L2:** a fixed quadratic pull with the same coefficient for every weight protects task A but leaves too little spare capacity to learn task B ✅[^1] (`machine-learning/foundations/regularization.md` covers L2 towards zero).
6. **Cost and limits:** run time linear in both the number of parameters and of training examples ✅[^1]; the point estimate of the posterior variance is a significant weakness, and the authors' perturbation test suggests it under-estimates parameter uncertainty ✅[^1].

**Replay.**
1. **Exact replay (rehearsal):** store a few old training examples and retrain on them while learning the new task; its performance is bounded by joint training and it may overfit the stored subset ✅[^6]. It is not always allowed, for example for privacy or memory reasons ✅[^2].
2. **Experience replay with a fixed budget (CLEAR, Continual Learning with Experience And Replay):** a multi-task reinforcement-learning method that learns off-policy from replayed experience, adds behavioural cloning towards the past policy, and learns on-policy from new experience ✅[^4]. It trains on a 50-50 mixture of new and replayed experience; once the buffer is full, reservoir sampling keeps a uniform random sample of all past experience ✅[^4]. It needs neither task identities nor task boundaries ✅[^4]. Training only on replay resisted forgetting but slowed learning of a new task as its share of the buffer shrank, which is why new data stays in the mix ✅[^4].
3. **Generative replay (DGR, deep generative replay):** a generator learns the inputs of all tasks so far and a solver learns the task; old inputs are generated, labelled by the previous solver, and mixed with real new data at a ratio `r` ✅[^5]. If the generator recovers the input distribution, this equals joint training on the accumulated real data ✅[^5]; replaying Gaussian noise with recorded responses did not help ✅[^5]. The generators themselves are covered in `machine-learning/generative-models/generative-model-families.md`.
4. **Constrained replay (GEM, gradient episodic memory):** keep an episodic memory per task and accept a gradient step `g` only if it does not raise the loss on any old task's memory, tested as `⟨g, g_k⟩ ≥ 0` against each old task's gradient `g_k`; a violating `g` is projected to the closest `g̃` that satisfies all constraints, a quadratic program solved in its dual with one variable per old task ✅[^3]. Unlike distillation-style replay this allows positive backward transfer, at the price of one backward pass per old task at every step ✅[^3].
5. **Distillation on new inputs (LwF, Learning without Forgetting):** label the current task's inputs with the soft outputs of the model saved after the previous task and train the new model to match them ✅[^2]. Distillation itself is explained in `machine-learning/ml-systems/pruning-and-knowledge-distillation.md`.

**Parameter isolation.** Dedicate different parameters to each task so that nothing can be forgotten: grow a new branch per task and freeze the old ones, or keep a fixed network and mask the parts that belong to earlier tasks ✅[^6]. Progressive networks add a new column per task with lateral connections to the frozen old columns; they are immune to forgetting, but the parameter count grows quadratically with the number of columns and choosing the column at test time needs the task label ✅[^7]. PackNet prunes a trained network to free weights for the next task, keeps the surviving weights fixed and applies a task-specific mask at test time ✅[^8]. Methods of this family typically need a task oracle, which restricts them to a multi-head set-up ✅[^6] and to the task-incremental scenario ✅[^2].

### Which family survives which scenario
In van de Ven and Tolias' comparison on split MNIST (20 seeds, an MLP, multilayer perceptron, with two hidden layers of 400 units), every method did well in Task-IL, while EWC, online EWC and SI (synaptic intelligence, another weight-importance penalty) scored 19.96–20.01 % in Class-IL, the level of plain fine-tuning (19.90 %) ✅[^2]. Only replay methods passed 90 % in Domain-IL and Class-IL: DGR 90.79 %, iCaRL (incremental classifier and representation learning: stored exemplars plus nearest-class-mean classification, 2,000 stored images) 94.57 %, joint training 97.94 % ✅[^2]. Storing even one example per class let exact replay beat every regularization method in Class-IL ✅[^2]. They also warn that grid-searching a method's hyperparameters on all tasks' validation data breaks the rule of visiting each task once, in sequence ✅[^2]; De Lange et al. propose a framework that sets them from new-task data only ✅[^6].

### Tooling vocabulary
The Avalanche library (v0.6 docs; not installed in the lab) calls a benchmark a collection of streams, a stream a sequence of experiences, and an experience all the information available at one time step ✅[^9]. It ships strategies such as `Naive`, `Replay`, `EWC`, `GEM`, `LwF` and `Cumulative`, and implements most of them as plugins, so replay and EWC can be combined in one strategy ✅[^10]. Its metrics include `forgetting_metrics` and `bwt_metrics` ✅[^11].

## Worked example
`load_digits` (1,797 grey 8 × 8 images, split 70/30 into 1,257 training and 540 test images) cut into five tasks of two digits: 0/1, 2/3, 4/5, 6/7, 8/9, about 250 training images each. One MLP (64 → 100 → 100 → 10, ReLU, rectified linear unit, activations) with a single 10-way output layer learns them in order, 300 Adam steps of batch 32 per task. Every run is scored task-incrementally (argmax over the task's two digits) and class-incrementally (argmax over all ten). Methods: fine-tuning; a uniform L2 pull towards the previous tasks' weights (`F_i = 1` for every weight); EWC with one penalty per finished task and the Fisher diagonal of the predicted label; a replay buffer of 1, 5 or 20 random training images per digit, giving half the loss to a batch of stored images; joint training on all tasks so far. The core of the EWC and replay losses:

```python
if method == "replay" and buf_x:                       # half the loss from a batch of stored old examples
    loss = 0.5 * loss + 0.5 * F.cross_entropy(net(bx[j]), by[j])
if method in ("ewc", "l2"):                            # (lam / 2) * sum_i F_i (theta_i - theta*_i)^2, per old task
    for fis, old in anchors:
        loss = loss + lam / 2 * sum((f * (p - o) ** 2).sum() for f, p, o in zip(fis, net.parameters(), old))
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-25, PyTorch 2.15.0, scikit-learn 1.9.1, CPU (central processing unit), two runs identical, about 10 seconds; lines 2–13 hold the Mental model artifact ✅[^12]:

```text
== split digits: 5 tasks [(0, 1), (2, 3), (4, 5), (6, 7), (8, 9)], 1257 train / 540 test images ==
== fine-tune, class-incremental: R[i][j] = accuracy on task j after training task i ==
after task 1: 1.000 0.000 0.000 0.000 0.000
after task 2: 0.000 1.000 0.000 0.000 0.000
after task 3: 0.000 0.000 1.000 0.000 0.000
after task 4: 0.000 0.000 0.000 1.000 0.000
after task 5: 0.000 0.000 0.000 0.000 1.000
== fine-tune, task-incremental: R[i][j] = accuracy on task j after training task i ==
after task 1: 1.000 0.509 0.440 0.500 0.509
after task 2: 0.908 1.000 0.486 0.824 0.302
after task 3: 0.495 0.898 1.000 0.389 0.491
after task 4: 0.514 0.509 0.633 1.000 0.557
after task 5: 0.505 0.620 0.761 0.991 1.000
== summary: ACC = mean of last row, BWT = mean of (last row - diagonal), FWT vs random init ==
fine-tune           | task-IL ACC 0.775 BWT -0.281 FWT +0.011 | class-IL ACC 0.200 BWT -1.000 FWT -0.124 | just-learned 1.000
L2 to old, lam=1    | task-IL ACC 0.667 BWT -0.224 FWT -0.007 | class-IL ACC 0.254 BWT -0.733 FWT -0.124 | just-learned 0.846
L2 to old, lam=10   | task-IL ACC 0.584 BWT -0.053 FWT -0.005 | class-IL ACC 0.200 BWT +0.000 FWT -0.124 | just-learned 0.627
EWC lam=100         | task-IL ACC 0.786 BWT -0.267 FWT -0.007 | class-IL ACC 0.200 BWT -1.000 FWT -0.124 | just-learned 1.000
EWC lam=10000       | task-IL ACC 0.958 BWT -0.048 FWT +0.011 | class-IL ACC 0.198 BWT -0.998 FWT -0.124 | just-learned 0.996
EWC lam=1e+06       | task-IL ACC 0.991 BWT +0.002 FWT +0.044 | class-IL ACC 0.192 BWT -0.995 FWT -0.124 | just-learned 0.989
EWC lam=1e+08       | task-IL ACC 0.963 BWT -0.014 FWT +0.027 | class-IL ACC 0.177 BWT -0.995 FWT -0.124 | just-learned 0.974
replay 1/class      | task-IL ACC 0.976 BWT -0.025 FWT -0.078 | class-IL ACC 0.642 BWT -0.443 FWT -0.124 | just-learned 0.996
replay 5/class      | task-IL ACC 0.996 BWT +0.000 FWT -0.054 | class-IL ACC 0.886 BWT -0.133 FWT -0.124 | just-learned 0.996
replay 20/class     | task-IL ACC 0.994 BWT +0.000 FWT -0.040 | class-IL ACC 0.928 BWT -0.071 FWT -0.124 | just-learned 0.994
joint (upper bound) | task-IL ACC 0.996 BWT +0.002 FWT -0.165 | class-IL ACC 0.974 BWT -0.007 FWT -0.124 | just-learned 0.994
```

<details><summary>Full script (prints the output above)</summary>

```python
# Continual learning on split digits: 5 two-class tasks learned in sequence by one MLP (PyTorch, CPU).
# Fine-tuning vs a uniform L2 pull to the old weights vs EWC (diagonal Fisher) vs a small replay buffer
# vs joint training, each scored task-incrementally (task id given) and class-incrementally (any of 10 digits).
import torch
from torch import nn
import torch.nn.functional as F
from sklearn.datasets import load_digits
from sklearn.model_selection import train_test_split
torch.set_num_threads(1); torch.use_deterministic_algorithms(True)

X, y = load_digits(return_X_y=True)                     # 1,797 images of 8x8 pixels, values 0..16
Xtr, Xte, ytr, yte = train_test_split(X / 16.0, y, test_size=0.3, stratify=y, random_state=0)
Xtr, Xte = torch.tensor(Xtr, dtype=torch.float32), torch.tensor(Xte, dtype=torch.float32)
ytr, yte = torch.tensor(ytr), torch.tensor(yte)
TASKS = [(0, 1), (2, 3), (4, 5), (6, 7), (8, 9)]
T = len(TASKS)
def part(Xs, ys, tasks):                                # the examples whose label belongs to `tasks`
    m = torch.isin(ys, torch.tensor([c for t in tasks for c in TASKS[t]]))
    return Xs[m], ys[m]

def make_net():                                         # one shared network, one 10-way output layer
    return nn.Sequential(nn.Linear(64, 100), nn.ReLU(), nn.Linear(100, 100), nn.ReLU(), nn.Linear(100, 10))

@torch.no_grad()
def accuracy(net, t, mode):
    Xt, yt = part(Xte, yte, [t])
    logits = net(Xt)
    if mode == "task":                                  # task-incremental: told the task, pick 1 of its 2 digits
        pred = torch.tensor(TASKS[t])[logits[:, list(TASKS[t])].argmax(1)]
    else:                                               # class-incremental: pick 1 of all 10 digits
        pred = logits.argmax(1)
    return (pred == yt).float().mean().item()

def fisher_diagonal(net, Xt):                           # mean of (d log p(predicted label | x) / d theta)^2
    fis = [torch.zeros_like(p) for p in net.parameters()]
    for x in Xt:
        net.zero_grad()
        logp = F.log_softmax(net(x[None]), 1)[0]
        logp[logp.argmax()].backward()
        for f, p in zip(fis, net.parameters()):
            f += p.grad ** 2 / len(Xt)
    return fis

def run(method, lam=0.0, per_class=0, steps=300, seed=0):
    torch.manual_seed(seed); g = torch.Generator().manual_seed(seed)
    net = make_net(); opt = torch.optim.Adam(net.parameters(), lr=1e-3)
    b = {m: [accuracy(net, j, m) for j in range(T)] for m in ("task", "class")}   # random-init accuracy
    R = {m: torch.zeros(T, T) for m in ("task", "class")}                         # R[i, j]: task j after task i
    anchors, buf_x, buf_y = [], [], []
    for t in range(T):
        Xt, yt = part(Xtr, ytr, range(t + 1) if method == "joint" else [t])
        for _ in range(steps):
            i = torch.randint(len(yt), (32,), generator=g)
            loss = F.cross_entropy(net(Xt[i]), yt[i])
            if method == "replay" and buf_x:            # half the loss from a batch of stored old examples
                bx, by = torch.cat(buf_x), torch.cat(buf_y)
                j = torch.randint(len(by), (32,), generator=g)
                loss = 0.5 * loss + 0.5 * F.cross_entropy(net(bx[j]), by[j])
            if method in ("ewc", "l2"):                 # (lam / 2) * sum_i F_i (theta_i - theta*_i)^2, per old task
                for fis, old in anchors:
                    loss = loss + lam / 2 * sum((f * (p - o) ** 2).sum() for f, p, o in zip(fis, net.parameters(), old))
            opt.zero_grad(); loss.backward(); opt.step()
        if method in ("ewc", "l2"):                     # l2: every weight equally important (F_i = 1)
            fis = fisher_diagonal(net, Xt) if method == "ewc" else [torch.ones_like(p) for p in net.parameters()]
            anchors.append((fis, [p.detach().clone() for p in net.parameters()]))
        if method == "replay":                          # keep `per_class` random training images of each new digit
            for c in TASKS[t]:
                idx = (yt == c).nonzero().squeeze(1)
                keep = idx[torch.randperm(len(idx), generator=g)[:per_class]]
                buf_x.append(Xt[keep]); buf_y.append(yt[keep])
        for m in R:
            R[m][t] = torch.tensor([accuracy(net, j, m) for j in range(T)])
    return R, b

def metrics(R, b):                                      # GEM's ACC, BWT, FWT, plus mean accuracy just after learning
    acc = R[T - 1].mean().item()
    bwt = sum(R[T - 1, i] - R[i, i] for i in range(T - 1)).item() / (T - 1)
    fwt = sum(R[i - 1, i] - b[i] for i in range(1, T)).item() / (T - 1)
    return acc, bwt, fwt, R.diagonal().mean().item()

print(f"== split digits: {T} tasks {TASKS}, {len(ytr)} train / {len(yte)} test images ==")
runs = [("fine-tune", dict(method="finetune"))]
runs += [(f"L2 to old, lam={lam:g}", dict(method="l2", lam=lam)) for lam in (1, 10)]
runs += [(f"EWC lam={lam:g}", dict(method="ewc", lam=lam)) for lam in (1e2, 1e4, 1e6, 1e8)]
runs += [(f"replay {k}/class", dict(method="replay", per_class=k)) for k in (1, 5, 20)]
runs += [("joint (upper bound)", dict(method="joint"))]
results = {name: run(**kw) for name, kw in runs}
R, _ = results["fine-tune"]
for m in ("class", "task"):
    print(f"== fine-tune, {m}-incremental: R[i][j] = accuracy on task j after training task i ==")
    for i in range(T):
        print(f"after task {i + 1}: " + " ".join(f"{v:.3f}" for v in R[m][i].tolist()))
print("== summary: ACC = mean of last row, BWT = mean of (last row - diagonal), FWT vs random init ==")
for name, (R, b) in results.items():
    (ta, tb, tf, learn), (ca, cb, cf, _) = metrics(R["task"], b["task"]), metrics(R["class"], b["class"])
    print(f"{name:19s} | task-IL ACC {ta:.3f} BWT {tb:+.3f} FWT {tf:+.3f} | class-IL ACC {ca:.3f} BWT {cb:+.3f}"
          f" FWT {cf:+.3f} | just-learned {learn:.3f}")
```

</details>

Reading it (just-learned is the mean of the task-incremental diagonal, the accuracy on each task right after training it: a measure of plasticity):
- **The scenario decides the number.** Fine-tuning scores ACC 0.775 task-incrementally and 0.200 class-incrementally with the same weights; in class-IL the network never names a digit from an earlier task correctly (BWT −1.000).
- **Uniform stiffness trades learning for memory.** The L2 pull reduces forgetting as `λ` grows (BWT −0.224 at `λ = 1`, −0.053 at `λ = 10`) but the network can no longer learn new tasks (just-learned 0.846, then 0.627), so ACC falls below fine-tuning (0.584).
- **Fisher-weighted stiffness keeps both.** EWC at `λ = 10⁶` reaches task-IL ACC 0.991 with BWT +0.002 and still learns each new task (0.989). At `λ = 100` it is indistinguishable from fine-tuning (0.786), so `λ` has to be very large; van de Ven and Tolias chose values orders of magnitude above the usual ones for split MNIST and explain it by tiny gradients, hence tiny Fisher values, after easy two-way tasks ✅[^2]. At `λ = 10⁸` plasticity starts to drop (0.974).
- **EWC does nothing for class-IL.** At every `λ` class-IL ACC stays at 0.177–0.200, the fine-tuning level, matching the published result ✅[^2].
- **A tiny replay buffer does.** One stored image per digit (10 images in the end) lifts class-IL ACC from 0.200 to 0.642; 5 per digit reach 0.886 and 20 per digit 0.928, against 0.974 for joint training on all the data.
- **No forward transfer here.** FWT stays between −0.165 and +0.044 task-incrementally; class-incrementally it is −0.124 in every run, because a task's digits are never predicted before that task is trained (`R[i−1, i] = 0`), so FWT is minus the random-init accuracy. With integer task labels, significant positive forward transfer cannot be expected ✅[^3].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Same method, different scenario | Lab fine-tuning ACC 0.775 (task-IL) vs 0.200 (class-IL) ✅[^12]; EWC 98.64 % vs 20.01 % on split MNIST ✅[^2] | Test-time task identity changes the problem ✅[^2] |
| Regularization in class-incremental learning | Fails at every `λ` (lab 0.177–0.200) ✅[^12] | Regularization-based methods fail when task identity must be inferred ✅[^2] |
| `λ` too small | EWC behaves like fine-tuning (lab 0.786 vs 0.775 at `λ = 100`) ✅[^12] | Fisher is small after easy tasks; the selected values were orders of magnitude larger than usual ✅[^2] |
| Penalty too stiff, or equal for all weights | New tasks are not learned (lab L2 just-learned 0.627) ✅[^12] | Protecting all weights equally leaves little spare capacity ✅[^1] |
| `λ` or buffer size chosen on every task's validation data | Over-optimistic, non-reproducible results | Violates the visit-each-task-once rule ✅[^2] ✅[^6] |
| Very small replay buffer | Slightly less robust to forgetting (CLEAR's 5-million-frame buffer) ✅[^4] | Possibly overfitting the few stored examples ✅[^4]; rehearsal is prone to that ✅[^6] |
| Training on replay only | New tasks learned slowly as the buffer fills | The new task is a shrinking share of the replayed data ✅[^4] |
| Old data may not be stored | Exact replay is ruled out | Privacy or memory constraints ✅[^2]; generative replay needs no real past data ✅[^5] |
| Generative replay on complex inputs | Open question | MNIST images are relatively easy to generate ✅[^2]; DGR equals joint training only with a perfect generator ✅[^5] |
| Replaying random noise | No help against forgetting | Accuracy rose as the replayed inputs better resembled real data ✅[^5] |
| Tasks without clear boundaries | The three scenarios stop applying | They assume clear task boundaries ✅[^2]; CLEAR needs no boundaries ✅[^4] |
| Many tasks with EWC | One quadratic term per task, cost grows linearly | Online EWC keeps a single running penalty ✅[^2] |
| Parameter isolation without a task id | Cannot choose the mask or column | Needs a task oracle ✅[^6] ✅[^7] |
| Expecting forward transfer from task ids | FWT near zero (lab −0.165 … +0.044) ✅[^12] | Integer task descriptors allow no significant positive forward (zero-shot) transfer ✅[^3] |
| LwF in two surveys | Called replay by van de Ven and Tolias, data-focused regularization by De Lange et al. | It replays current inputs with old soft targets ✅[^2]; it distils the previous model ✅[^6] |
| Several passes over each task | Forgetting gets worse for memory-less methods | GEM's MNIST-rotations table: BWT −0.08 at 1 epoch, −0.40 at 5 epochs for plain training ✅[^3] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| EWC / online EWC / SI | No stored data; one network ✅[^1] ✅[^6] | Fails class-IL ✅[^2]; `λ` needs very large values and careful choice ✅[^2] |
| Exact replay buffer | Can work in every scenario; even 1 example per class helps ✅[^2]; lab 0.642 → 0.928 ✅[^12] | Stores real data ✅[^2]; may overfit the buffer ✅[^6] |
| Generative replay | No real past data ✅[^5]; strong on MNIST (90.79 % class-IL) ✅[^2] | A generator to train continually, with care to avoid mode collapse ✅[^6]; an open question on complex inputs ✅[^2] |
| GEM | Allows positive backward transfer ✅[^3] | One backward pass per old task per step ✅[^3] |
| Parameter isolation (progressive nets, PackNet) | No forgetting by design ✅[^7] ✅[^8] | Task id required; model grows (quadratically for progressive nets) ✅[^7] |
| Joint retraining | Best accuracy (lab class-IL 0.974) ✅[^12] | Needs all past data; not continual ✅[^6] |

## Takeaways
- State the scenario (task-, domain- or class-incremental) with every continual-learning number, and never compare numbers across scenarios. [rule-candidate]
- Report the full accuracy matrix with ACC and BWT, next to fine-tuning and joint training on the same tasks. [rule-candidate]
- If the model must pick among all classes seen so far, budget a replay buffer, or a generator if raw data cannot be kept; a weight penalty alone will not do.
- Sweep EWC's `λ` over many orders of magnitude, and choose it without peeking at old tasks' validation data.

## Verification status
- Verified: 111 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [Overcoming catastrophic forgetting in neural networks](https://arxiv.org/html/1612.00796v2) — Kirkpatrick et al., 2017 (arXiv:1612.00796v2). Backs: catastrophic forgetting definition, nearby solutions, the spring analogy, the Bayesian derivation, the Fisher's three properties, the EWC loss and `λ`, multiple tasks, plain L2 too stiff, linear run time, under-estimated uncertainty. [^1]
- [Three scenarios for continual learning](https://arxiv.org/html/1904.07734v1) — van de Ven, Tolias, 2019. Backs: protocol and task boundaries, Task-/Domain-/Class-IL and the split MNIST questions, multi-headed outputs, fine-tuning and joint training as bounds, privacy and memory limits on stored data, LwF, how the Fisher is computed and that Kirkpatrick et al. do not specify it, online EWC, Tables 4 and 5, one stored example per class, extreme `λ` values, hyperparameter-search warning, MNIST easy to generate. [^2]
- [Gradient Episodic Memory for Continual Learning](https://arxiv.org/html/1706.08840v6) — Lopez-Paz, Ranzato, 2017 (v6, 2022). Backs: the accuracy matrix, ACC, BWT, FWT and how to read them, no forward transfer from integer task descriptors, the GEM constraint, projection and dual quadratic program, one backward pass per task, the epochs-per-task table. [^3]
- [Experience Replay for Continual Learning](https://arxiv.org/html/1811.11682v2) — Rolnick, Ahuja, Schwarz, Lillicrap, Wayne, 2019. Backs: stability and plasticity, interference vs forgetting on DMLab, CLEAR's off-policy replay, behavioural cloning and on-policy learning, 50-50 mixing, reservoir sampling, no task boundaries needed, 100 % replay slows new tasks, small-buffer result. [^4]
- [Continual Learning with Deep Generative Replay](https://arxiv.org/html/1705.08690v3) — Shin, Lee, Kim, Kim, 2017. Backs: generator and solver, replayed targets from the previous solver, mixing ratio `r`, equivalence to joint training with a perfect generator, noise replay does not help, no real past data. [^5]
- [A continual learning survey: Defying forgetting in classification tasks](https://arxiv.org/html/1909.08383v3) — De Lange et al., 2021 (arXiv:1909.08383v3). Backs: the three families, stability-plasticity hyperparameters and their framework, rehearsal bounded by joint training and prone to overfitting, LwF as data-focused regularization, prior-focused methods, parameter isolation and its task oracle, joint training as reference. [^6]
- [Progressive Neural Networks](https://arxiv.org/html/1606.04671v4) — Rusu et al., 2016 (v4, 2022). Backs: one column per task with lateral connections, immune to forgetting, quadratic parameter growth, task label needed at test time. [^7]
- [PackNet: Adding Multiple Tasks to a Single Network by Iterative Pruning](https://arxiv.org/html/1711.05769v2) — Mallya, Lazebnik, 2018. Backs: pruning to free weights, fixed surviving weights, task-specific masks at test time. [^8]
- [Benchmarks (Avalanche, From Zero to Hero tutorial)](https://avalanche.continualai.org/from-zero-to-hero-tutorial/03_benchmarks) — ContinualAI, living (v0.6.0 docs). Backs: benchmark, stream and experience vocabulary. [^9]
- [Training (Avalanche, From Zero to Hero tutorial)](https://avalanche.continualai.org/from-zero-to-hero-tutorial/04_training) — ContinualAI, living (v0.6.0 docs). Backs: strategy names, plugins, combining replay and EWC. [^10]
- [Evaluation (Avalanche, From Zero to Hero tutorial)](https://avalanche.continualai.org/from-zero-to-hero-tutorial/05_evaluation) — ContinualAI, living (v0.6.0 docs). Backs: `forgetting_metrics`, `bwt_metrics`. [^11]
- `machine-learning/lab-setup.md` — the lab where the split-digits continual-learning script ran on 2026-11-25 (PyTorch 2.15.0, scikit-learn 1.9.1, CPU). [^12]

## Related
- `machine-learning/deep-learning/data-augmentation-and-transfer-learning.md` — one fine-tune and how much of the source task it forgets.
- `machine-learning/deep-learning/meta-learning-and-few-shot-learning.md` — training a model to learn new tasks from a few examples.
- `machine-learning/probabilistic-ml/bayesian-inference.md` — the posterior-becomes-prior idea behind EWC.
- `machine-learning/foundations/regularization.md` — L2 penalties and their strength.
- `machine-learning/reinforcement-learning/deep-q-networks.md` — experience replay in single-task reinforcement learning.
- `machine-learning/generative-models/generative-model-families.md` — the generators generative replay relies on.
- `machine-learning/ml-systems/pruning-and-knowledge-distillation.md` — distillation, the mechanism behind LwF.
- `machine-learning/ml-systems/data-drift-and-monitoring.md` — noticing that the data has moved on.
- `machine-learning/learning-theory/online-learning.md` — the regret view of learning from a stream.
