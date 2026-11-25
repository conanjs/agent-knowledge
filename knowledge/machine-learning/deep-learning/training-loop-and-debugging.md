---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/deep-learning
status: verified
applies-to: ["PyTorch 2.15.0"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, deep-learning, pytorch, training-loop, dataloader, zero-grad, state-dict, checkpoint, loss-curves, debugging, early-stopping, sanity-checks]
---

# The PyTorch training loop and how to debug it

## Summary
**TL;DR:** A PyTorch training loop repeats five calls per mini-batch: `optimizer.zero_grad()`, a forward pass, the loss, `loss.backward()` and `optimizer.step()`. Around it sit `model.train()` / `model.eval()` (switch dropout and batch norm), `torch.no_grad()` for validation, and checkpoints that save the model's **and** the optimizer's `state_dict`. Most training bugs do not crash: they show up as numbers, so check them in order: the first loss should be about `log(number of classes)`, the model must be able to drive the loss of one small batch to almost zero, and the train and validation curves tell underfitting, overfitting and a wrong learning rate apart.
**Use this when:** you write a training loop, a model trains but "does not learn", validation loss rises while training loss falls, the loss becomes NaN (not a number), or you need to resume training from a file.
**Not this doc:** how `.backward()` computes gradients, and `gradcheck` → `machine-learning/deep-learning/neural-networks-and-backpropagation.md`; choosing the optimizer and learning-rate schedule → `machine-learning/deep-learning/optimizers-and-learning-rate-schedules.md`; what dropout and batch norm do in each mode → `machine-learning/deep-learning/normalization-and-dropout.md`; why early stopping regularizes → `machine-learning/foundations/regularization.md`; overfitting in general → `machine-learning/foundations/generalization-and-overfitting.md`; seeding the data loader → `machine-learning/ml-systems/reproducibility-and-determinism.md`.

## Problem
A training script with a bug usually still runs to the end and prints a loss. Forgetting `zero_grad()`, applying softmax before `CrossEntropyLoss`, validating in training mode, or shuffling inputs without their labels all give a model that is worse, sometimes only slightly, with no error message. In the lab below the correct loop reaches a training loss of 0.327 after 50 epochs; the same loop without `zero_grad()` stops at 0.898, and with misaligned labels the validation accuracy is 0.232, chance level for 4 classes ✅[^10]. Without a checklist, these look like "the model needs tuning".

## Mental model
**Analogy:** a cook tasting a soup. Each round: empty the spoon (`zero_grad`), taste (forward and loss), decide what is wrong (`backward`), adjust the seasoning (`step`). If you never empty the spoon, every taste mixes with the previous ones. The guests' verdict (validation) is collected with the cook's hands off the pot (`eval()` + `no_grad()`), and a recipe card written down mid-way (checkpoint) must include what the cook remembers about recent adjustments (optimizer state), or resuming changes the soup.

**Artifact:** the loop, as the optimizer documentation writes it ✅[^1], plus the validation pass:

```python
for xb, yb in train_loader:          # one epoch = one pass over the DataLoader
    optimizer.zero_grad()            # clear .grad from the previous step
    loss = loss_fn(model(xb), yb)    # forward pass + loss on raw logits
    loss.backward()                  # gradients, accumulated into .grad
    optimizer.step()                 # update the weights
model.eval()                         # dropout off, batch norm uses running statistics
with torch.no_grad():                # no graph is recorded
    val_loss = sum(loss_fn(model(x), y).item() * len(y) for x, y in val_loader) / len(val_loader.dataset)
model.train()
```

## How it works
### 1. Data: `Dataset` and `DataLoader`
1. A map-style dataset is any object with `__getitem__()` and `__len__()` ✅[^3]: `dataset[i]` returns one `(input, label)` pair. Example: `TableDataset(X, y)[5]` returns `(X[5], y[5])`, so input and label can never drift apart.
2. `DataLoader` groups samples into batches; its default `batch_size` is 1, and the default collate function adds a new first dimension, the batch dimension ✅[^3]. Example: 32 samples of shape `(10,)` become one tensor `(32, 10)`.
3. `shuffle` defaults to `False`; with `True` the data is reshuffled every epoch ✅[^3]. Shuffle the training loader, not the validation loader (its order does not matter for an average). The `generator` argument is the random number generator the `RandomSampler` draws its indexes from, so a seeded one fixes the shuffle order ✅[^3].
4. `drop_last=True` drops the last, smaller batch when the dataset size is not divisible by the batch size; the default is `False` ✅[^3].

### 2. One training step
1. **`optimizer.zero_grad()`** resets the gradients. Its default `set_to_none=True` sets each `.grad` to `None` rather than to zeros, which in general has a lower memory footprint; a parameter whose `.grad` is `None` is skipped by the optimizer, while a zero gradient still takes a step ✅[^2].
2. **Forward and loss.** `CrossEntropyLoss` expects unnormalized logits for each class, and for class-index targets it equals `LogSoftmax` followed by `NLLLoss`; targets are class indices in `[0, C)` ✅[^4]. Its default `reduction` is `'mean'` ✅[^4], so the printed loss is a batch average.
3. **`loss.backward()`** adds the new gradients into `.grad`; without step 1 they pile up. In the lab, three `backward()` calls on the same batch give gradient norms 0.0958, 0.1916, 0.2874, exactly 1×, 2× and 3× ✅[^10].
4. **`optimizer.step()`** updates the weights from `.grad` ✅[^1].

### 3. Modes: `train()`, `eval()` and `no_grad()`
1. `model.eval()` is the same as `model.train(False)` and only changes modules that behave differently in the two modes, such as `Dropout` and `BatchNorm` ✅[^5].
2. `torch.no_grad()` stops gradient recording: every result has `requires_grad=False`, which saves memory, and it is meant for inference when you will not call `backward()` ✅[^6].
3. They are independent: `eval()` does not stop gradient recording, and `no_grad()` does not switch dropout off. Validation needs both, and training must switch back with `model.train()` ✅[^11].

### 4. Saving and loading
1. A `state_dict` is a Python dictionary from each layer to its parameter tensors; optimizers have one too, holding their state and hyperparameters ✅[^7]. Saving the model's `state_dict` is the recommended way to save a model for inference ✅[^7].
2. To resume training, save more than the model: the tutorial's general checkpoint holds the epoch, the model `state_dict`, the optimizer `state_dict` and the loss ✅[^7]. The convention is `.pt` or `.pth` for models and `.tar` for checkpoints ✅[^7].
3. `load_state_dict()` takes a dictionary, not a file path ✅[^7]; with its default `strict=True` the keys must match the model's exactly, and it returns the `missing_keys` and `unexpected_keys` ✅[^5].
4. `torch.load` has `weights_only=True` by default, which limits unpickling to tensors, primitive types, dictionaries and explicitly allowed types; the docs warn never to load data from an untrusted source, and `map_location` moves tensors to another device ✅[^8].
5. After loading, call `model.eval()` before inference or `model.train()` before resuming ✅[^7].

### 5. The debugging playbook, in order
1. **Initial loss.** With small random weights a classifier predicts about `1/C` for each class, so cross-entropy starts near `−ln(1/C) = ln C`: 2.302 for 10 classes ✅[^9]. In the lab, `ln 4 = 1.3863` and the untrained model gives 1.4062; scaling the last layer's weights by 30 gives 4.7630, a sign of a bad initialization ✅[^10].
2. **Overfit a tiny subset.** With regularization off, the model should reach zero cost on about 20 examples; if it cannot, do not move on to the full dataset ✅[^9]. In the lab, 16 examples reach loss 0.0000 by step 50 ✅[^10].
3. **Check gradients** of any hand-written layer with the centred finite difference in double precision ✅[^9]; PyTorch's `torch.autograd.gradcheck` does it (see the backpropagation doc).
4. **Read the curves** (next section) and compare the train-validation gap.
5. **Look for silent bugs** (Edge cases table): each has a measurable symptom in the lab.

### 6. Reading loss curves
| Pattern | Diagnosis | First fix |
|---|---|---|
| Train and validation loss both high, close together | Underfitting: capacity too low, CS231n's reading when validation accuracy tracks training accuracy fairly well ✅[^9]. Lab linear model: train 1.001, val 0.923 after 100 epochs ✅[^10] | Bigger model ✅[^9] |
| Train loss keeps falling, validation loss turns up | Overfitting: the gap between training and validation accuracy measures it, and validation accuracy can even start to fall ✅[^9]. Lab MLP: val lowest at epoch 12 (0.540), 1.399 at epoch 300 while train reaches 0.000 ✅[^10] | More regularization or more data ✅[^9]; early stopping (below) |
| Loss falls slowly, in a roughly straight line | Learning rate too low: the improvements are linear ✅[^9]. Lab SGD `lr=1e-4`: 1.396 → 1.393 in 30 epochs, barely moving ✅[^10] | Raise the learning rate |
| Loss drops fast, then stalls at a poor value | Learning rate too high: the parameters bounce around and cannot settle ✅[^9]. Lab SGD `lr=3`: 1.549 → 1.259, accuracy 0.450 vs 0.698 at `lr=0.1` ✅[^10] | Lower it |
| Loss very noisy from one batch to the next | Batch size small: the amount of wiggle in the loss depends on the batch size ✅[^9] | A larger batch |
| Loss becomes huge, `inf` or `nan` | Divergence: in CS231n's cartoon a very high learning rate makes the loss climb, and some settings explode immediately with infinite cost ✅[^9]. Lab SGD `lr=1000`: `nan` from epoch 1 ✅[^10] | Lower the learning rate |

**Early stopping** keeps the parameters from the best validation epoch, not the last: save a checkpoint whenever validation loss improves and stop after `patience` epochs without improvement. With patience 20, the lab run stops at epoch 32 and keeps epoch 12 ✅[^10].

## Worked example
One script on a synthetic 4-class problem (10 features, the class depends on the sign of `x0·x1` and of `x2`, 10 % label noise on 512 training rows, 2,000 clean validation rows) runs every check above. Lab run (`machine-learning/lab-setup.md`), 2026-11-25, PyTorch 2.15.0, two runs identical ✅[^10]:

```text
== 1. Initial loss vs log(C) ==
log(4) = 1.3863 | untrained MLP val loss = 1.4062
last layer weights x30: val loss = 4.7630
== 2. Overfit one batch of 16 ==
step   0: loss 1.4025
step  50: loss 0.0000
step 200: loss 0.0000
== 3. Curves: underfit (linear) vs overfit (wide MLP), early stopping with a checkpoint ==
linear epoch   1: train 1.438 val 1.366
linear epoch 100: train 1.001 val 0.923
MLP-256 epoch   1: train 1.289 val 1.129
MLP-256 epoch  10: train 0.506 val 0.565
MLP-256 epoch  25: train 0.187 val 0.600
MLP-256 epoch  50: train 0.023 val 0.804
MLP-256 epoch 100: train 0.003 val 1.014
MLP-256 epoch 200: train 0.000 val 1.241
MLP-256 epoch 300: train 0.000 val 1.399
early stopping (patience 20) would stop at epoch 32; best epoch 12, val 0.540
load_state_dict: <All keys matched successfully> | reloaded val 0.540 | keys ['epoch', 'model', 'optimizer', 'val_loss']
== 4. Learning rate: SGD for 30 epochs ==
lr 0.0001: epoch 1 1.396  epoch 10 1.395  epoch 30 1.393  val acc 0.249
lr 0.1: epoch 1 1.372  epoch 10 0.939  epoch 30 0.575  val acc 0.698
lr 3: epoch 1 1.549  epoch 10 1.326  epoch 30 1.259  val acc 0.450
lr 1000: epoch 1 nan  epoch 10 nan  epoch 30 nan  val acc 0.234
== 5. Bugs, each after 50 epochs of Adam(lr=1e-3) on the same data ==
correct loop     : train 0.327 val 0.598 acc 0.746
no zero_grad     : train 0.898 val 1.081 acc 0.586
softmax + CE     : train 0.844 acc 0.828 | loss floor -log(e/(e+3)) = 0.7437
labels shuffled  : train 0.807 val 1.727 acc 0.232
dropout 0.5, val in train mode twice: 0.7994 0.8079 | eval mode twice: 0.6683 0.6683
backward x1 without zero_grad: grad norm of first weight 0.0958
backward x2 without zero_grad: grad norm of first weight 0.1916
backward x3 without zero_grad: grad norm of first weight 0.2874
== 6. Resume from a checkpoint: with vs without optimizer state ==
resume with optimizer state=True: max |weight difference| vs uninterrupted run = 0.00e+00
resume with optimizer state=False: max |weight difference| vs uninterrupted run = 1.04e-01
```

<details><summary>Full script (prints the output above, about 8 seconds on CPU)</summary>

```python
# Training-loop anatomy, loss curves and the debugging playbook (PyTorch, CPU, synthetic data).
import copy, math, os, tempfile, torch
from torch import nn
from torch.utils.data import Dataset, DataLoader
C, D = 4, 10                                           # 4 classes, 10 input features

def make(n, seed, noise=0.0):                          # class = XOR of two signs (needs a nonlinearity)
    g = torch.Generator().manual_seed(seed)
    X = torch.randn(n, D, generator=g)
    y = 2 * (X[:, 0] * X[:, 1] > 0).long() + (X[:, 2] > 0).long()
    flip = torch.rand(n, generator=g) < noise          # label noise: replace some labels at random
    y[flip] = torch.randint(0, C, (int(flip.sum()),), generator=g)
    return X, y

class TableDataset(Dataset):                           # map-style: __len__ + __getitem__
    def __init__(self, X, y): self.X, self.y = X, y
    def __len__(self): return len(self.y)
    def __getitem__(self, i): return self.X[i], self.y[i]

Xtr, ytr = make(512, seed=1, noise=0.1); Xva, yva = make(2000, seed=2)
val_loader = DataLoader(TableDataset(Xva, yva), batch_size=500)
loss_fn = nn.CrossEntropyLoss()                        # expects raw logits

def loader(X=Xtr, y=ytr, seed=0):
    return DataLoader(TableDataset(X, y), batch_size=32, shuffle=True, generator=torch.Generator().manual_seed(seed))

def mlp(h=64, p=0.0, seed=0):
    torch.manual_seed(seed)
    return nn.Sequential(nn.Linear(D, h), nn.ReLU(), nn.Dropout(p), nn.Linear(h, h), nn.ReLU(), nn.Linear(h, C))

def evaluate(model, dl=val_loader, mode="eval"):
    model.train(mode == "train")
    tot = correct = n = 0
    with torch.no_grad():                              # no graph: less memory, no accidental backward
        for xb, yb in dl:
            out = model(xb)
            tot += loss_fn(out, yb).item() * len(yb); correct += (out.argmax(1) == yb).sum().item(); n += len(yb)
    return tot / n, correct / n

def train_epoch(model, opt, dl, bug=None):
    model.train(); tot = n = 0
    for xb, yb in dl:
        if bug != "no_zero_grad": opt.zero_grad()      # otherwise .grad keeps adding up
        out = model(xb)
        if bug == "softmax": out = out.softmax(dim=1)  # BUG: CrossEntropyLoss applies log-softmax itself
        loss = loss_fn(out, yb); loss.backward(); opt.step()
        tot += loss.item() * len(yb); n += len(yb)
    return tot / n

print("== 1. Initial loss vs log(C) ==")
print(f"log(4) = {math.log(C):.4f} | untrained MLP val loss = {evaluate(mlp())[0]:.4f}")
bad = mlp(); bad[-1].weight.data *= 30                 # badly scaled last layer
print(f"last layer weights x30: val loss = {evaluate(bad)[0]:.4f}")

print("== 2. Overfit one batch of 16 ==")
m = mlp(); opt = torch.optim.Adam(m.parameters(), lr=1e-2); xb, yb = Xtr[:16], ytr[:16]
for step in range(201):
    opt.zero_grad(); loss = loss_fn(m(xb), yb); loss.backward(); opt.step()
    if step in (0, 50, 200): print(f"step {step:3d}: loss {loss.item():.4f}")

print("== 3. Curves: underfit (linear) vs overfit (wide MLP), early stopping with a checkpoint ==")
torch.manual_seed(0); lin = nn.Linear(D, C); opt = torch.optim.Adam(lin.parameters(), lr=1e-2); dl = loader()
for ep in range(1, 101):
    tr = train_epoch(lin, opt, dl)
    if ep in (1, 100): print(f"linear epoch {ep:3d}: train {tr:.3f} val {evaluate(lin)[0]:.3f}")
m = mlp(h=256); opt = torch.optim.Adam(m.parameters(), lr=1e-3); dl = loader()
best, best_ep, patience, wait, stop_ep = float("inf"), 0, 20, 0, None
ckpt = os.path.join(tempfile.mkdtemp(), "best.pt")
for ep in range(1, 301):
    tr = train_epoch(m, opt, dl); va = evaluate(m)[0]
    if ep in (1, 10, 25, 50, 100, 200, 300): print(f"MLP-256 epoch {ep:3d}: train {tr:.3f} val {va:.3f}")
    if va < best:
        best, best_ep, wait = va, ep, 0
        torch.save({"epoch": ep, "model": m.state_dict(), "optimizer": opt.state_dict(), "val_loss": va}, ckpt)
    else:
        wait += 1
        if wait == patience and stop_ep is None: stop_ep = ep
print(f"early stopping (patience {patience}) would stop at epoch {stop_ep}; best epoch {best_ep}, val {best:.3f}")
state = torch.load(ckpt, weights_only=True)            # weights_only=True: the default in 2.15
m2 = mlp(h=256); print("load_state_dict:", m2.load_state_dict(state["model"]), "| reloaded val",
                       f"{evaluate(m2)[0]:.3f}", "| keys", sorted(state))

print("== 4. Learning rate: SGD for 30 epochs ==")
for lr in (1e-4, 1e-1, 3.0, 1000.0):
    m = mlp(); opt = torch.optim.SGD(m.parameters(), lr=lr); dl = loader(); hist = []
    for ep in range(30): hist.append(train_epoch(m, opt, dl))
    print(f"lr {lr:g}: epoch 1 {hist[0]:.3f}  epoch 10 {hist[9]:.3f}  epoch 30 {hist[29]:.3f}  val acc {evaluate(m)[1]:.3f}")

print("== 5. Bugs, each after 50 epochs of Adam(lr=1e-3) on the same data ==")
def run(bug=None, p=0.0, y=ytr):
    m = mlp(p=p); opt = torch.optim.Adam(m.parameters(), lr=1e-3); dl = loader(y=y)
    for ep in range(50): tr = train_epoch(m, opt, dl, bug)
    return m, tr
m, tr = run(); print(f"correct loop     : train {tr:.3f} val {evaluate(m)[0]:.3f} acc {evaluate(m)[1]:.3f}")
m, tr = run("no_zero_grad"); print(f"no zero_grad     : train {tr:.3f} val {evaluate(m)[0]:.3f} acc {evaluate(m)[1]:.3f}")
m, tr = run("softmax"); print(f"softmax + CE     : train {tr:.3f} acc {evaluate(m)[1]:.3f} | loss floor -log(e/(e+3)) = {-math.log(math.e/(math.e+3)):.4f}")
g = torch.Generator().manual_seed(9)
m, tr = run(y=ytr[torch.randperm(len(ytr), generator=g)]); print(f"labels shuffled  : train {tr:.3f} val {evaluate(m)[0]:.3f} acc {evaluate(m)[1]:.3f}")
m, _ = run(p=0.5)
a, b = evaluate(m, mode="train")[0], evaluate(m, mode="train")[0]
print(f"dropout 0.5, val in train mode twice: {a:.4f} {b:.4f} | eval mode twice: {evaluate(m)[0]:.4f} {evaluate(m)[0]:.4f}")
m = mlp(); dl = loader(); xb, yb = next(iter(dl))
for k in (1, 2, 3):
    loss_fn(m(xb), yb).backward()
    print(f"backward x{k} without zero_grad: grad norm of first weight {m[0].weight.grad.norm():.4f}")

print("== 6. Resume from a checkpoint: with vs without optimizer state ==")
def fresh(): m = mlp(); return m, torch.optim.Adam(m.parameters(), lr=1e-3)
m, opt = fresh(); g = torch.Generator().manual_seed(0)
dl = DataLoader(TableDataset(Xtr, ytr), batch_size=32, shuffle=True, generator=g)
for _ in range(10): train_epoch(m, opt, dl)
ck = copy.deepcopy({"model": m.state_dict(), "optimizer": opt.state_dict(), "rng": g.get_state()})  # = torch.save
for _ in range(10): train_epoch(m, opt, dl)
ref = torch.cat([p.detach().flatten() for p in m.parameters()])
for keep_opt in (True, False):
    m2, opt2 = fresh(); m2.load_state_dict(ck["model"])
    if keep_opt: opt2.load_state_dict(ck["optimizer"])
    g2 = torch.Generator(); g2.set_state(ck["rng"])
    dl2 = DataLoader(TableDataset(Xtr, ytr), batch_size=32, shuffle=True, generator=g2)
    for _ in range(10): train_epoch(m2, opt2, dl2)
    diff = (torch.cat([p.detach().flatten() for p in m2.parameters()]) - ref).abs().max().item()
    print(f"resume with optimizer state={keep_opt}: max |weight difference| vs uninterrupted run = {diff:.2e}")
```

</details>

Reading it:
- **Sections 1–2** pass the two sanity checks: the first loss is within 0.02 of `ln 4`, and the model memorizes 16 examples, so the model, loss and optimizer are wired correctly.
- **Section 3** shows both failure shapes: the linear model cannot represent the sign product, so both losses stay near 1; the 256-unit MLP overfits after epoch 12. The reloaded checkpoint gives the same validation loss, 0.540, as the epoch it was saved at.
- **Section 4:** only `lr=0.1` learns well in 30 epochs; `1e-4` is too slow to see, `3` stalls at a poor value, `1000` is `nan` at once.
- **Section 5, softmax before the loss:** the loss then applies a second softmax to values in `[0, 1]`, so even a perfect prediction `(1, 0, 0, 0)` costs `−ln(e/(e+3)) = 0.7437`; the training loss 0.844 can never go below that floor. Accuracy, 0.828, is higher than the correct loop's 0.746 here: the squashed gradients learn slowly and overfit less in 50 epochs. The loss value, not accuracy, exposes the bug.
- **Section 5, shuffled labels:** the network still fits its training set partly (0.807), but validation accuracy is chance (0.232); a network can memorize labels that carry no signal.
- **Section 5, dropout:** two validation passes in train mode disagree (0.7994, 0.8079) and are worse than eval mode, which repeats exactly (0.6683).
- **Section 6:** resuming with the saved Adam state reproduces the uninterrupted run bit for bit (difference 0); a fresh Adam starts from empty optimizer state and ends 0.104 away on some weight.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `zero_grad()` forgotten | Training loss 0.898 instead of 0.327 in the lab; gradient norm grows 1×, 2×, 3× on repeated `backward()` | `.grad` accumulates ✅[^10] |
| Softmax (or `LogSoftmax`) before `CrossEntropyLoss` | Loss floor 0.7437 for 4 classes; slow learning | The loss expects logits and applies log-softmax itself ✅[^4]; lab ✅[^10] |
| Validation in train mode | Noisy, worse validation loss; batch norm statistics updated with validation data | Modes are manual: calling `eval()` is what avoids updating BatchNorm running statistics on validation data ✅[^11]; lab ✅[^10] |
| Inputs shuffled without labels | Validation accuracy at chance (0.232) | Labels no longer match inputs; lab ✅[^10]. Shuffle with a `Dataset` that returns `(x[i], y[i])` together ✅[^3] |
| Resume without optimizer state | Different weights than an uninterrupted run | Optimizer `state_dict` holds its state ✅[^7]; lab ✅[^10] |
| `load_state_dict` after renaming layers | Loading fails with `strict=True`; with `strict=False` the mismatched keys are not loaded and come back in the returned `missing_keys` / `unexpected_keys` | `strict=True` requires an exact key match and throws an error when either key list is non-empty; the returned key lists ✅[^5] |
| `torch.load` of a checkpoint with custom Python objects | Fails under `weights_only=True` | Unpickler restricted by default ✅[^8] |
| Last batch smaller than the others | Batch-mean losses averaged per batch over-weight it | Use `drop_last=True` ✅[^3], or weight by batch size as the lab does |
| Loss is `nan` | Every later step is `nan` too, and accuracy is meaningless | Lab ✅[^10]; suspect the learning rate first: in CS231n's cartoon a very high one makes the loss climb, and some settings explode with infinite cost ✅[^9] |
| Accuracy improves but loss is odd | A bug can hide behind a fine accuracy (softmax case) | Lab ✅[^10]; always compare the loss with `ln C` and its floor |

## Takeaways
- Write every step as `zero_grad → forward → loss → backward → step`, and validate under `model.eval()` plus `torch.no_grad()`, then call `model.train()`. [rule-candidate]
- Feed `CrossEntropyLoss` raw logits; never a softmax output. [rule-candidate]
- Before a long run, check that the first loss is close to `ln C` and that one small batch can be fitted to almost zero loss. [rule-candidate]
- Save checkpoints as `{epoch, model state_dict, optimizer state_dict, ...}`; a model-only file cannot resume Adam or momentum exactly. [rule-candidate]
- Keep the best-validation checkpoint and stop after a patience window instead of using the last epoch.

## Verification status
- Verified: 58 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [torch.optim](https://docs.pytorch.org/docs/2.15/optim.html) — PyTorch, 2026 (2.15). Backs: the five-call training loop, `step()`. [^1]
- [torch.optim.Optimizer.zero_grad](https://docs.pytorch.org/docs/2.15/generated/torch.optim.Optimizer.zero_grad.html) — PyTorch, 2026 (2.15). Backs: `set_to_none=True` default, `None` vs zero gradients. [^2]
- [torch.utils.data](https://docs.pytorch.org/docs/2.15/data.html) — PyTorch, 2026 (2.15). Backs: map-style dataset, `batch_size`, `shuffle`, `drop_last`, `generator`, default collate. [^3]
- [torch.nn.CrossEntropyLoss](https://docs.pytorch.org/docs/2.15/generated/torch.nn.CrossEntropyLoss.html) — PyTorch, 2026 (2.15). Backs: unnormalized logits, `LogSoftmax` + `NLLLoss`, class-index targets, `reduction='mean'`. [^4]
- [torch.nn.Module](https://docs.pytorch.org/docs/2.15/generated/torch.nn.Module.html) — PyTorch, 2026 (2.15). Backs: `eval()` = `train(False)` and which modules it affects, `load_state_dict` `strict`, the error on non-empty key lists and the returned keys. [^5]
- [torch.no_grad](https://docs.pytorch.org/docs/2.15/generated/torch.no_grad.html) — PyTorch, 2026 (2.15). Backs: disables gradient calculation, memory, `requires_grad=False` results. [^6]
- [Saving and Loading Models](https://docs.pytorch.org/tutorials/beginner/saving_loading_models.html) — Matthew Inkawhich, PyTorch tutorials, living. Backs: `state_dict`, optimizer `state_dict`, recommended save, general checkpoint keys, file extensions, dict not path, `eval()`/`train()` after loading. [^7]
- [torch.load](https://docs.pytorch.org/docs/2.15/generated/torch.load.html) — PyTorch, 2026 (2.15). Backs: `weights_only=True` default, untrusted-source warning, `map_location`. [^8]
- [CS231n: Neural Networks Part 3 (Learning and Evaluation)](https://cs231n.github.io/neural-networks-3/) — Stanford CS231n course notes, living. Backs: initial loss 2.302 for 10 classes, overfit ~20 examples, centred differences in double precision, loss-curve shapes for learning rates (the `learningrates.jpeg` cartoon), train/validation accuracy gap and underfitting (`accuracies.jpeg` and its text), noise vs batch size, explosion. [^9]
- `machine-learning/lab-setup.md` — the lab where the training-loop script ran on 2026-11-25 (PyTorch 2.15.0, CPU); script at `mllab/training-loop-and-debugging/lab.py`. [^10]
- [Autograd mechanics](https://docs.pytorch.org/docs/2.15/notes/autograd.html) — PyTorch, 2026 (2.15). Backs: `eval()` is orthogonal to no-grad mode, calling `model.train()` / `model.eval()` is the user's job, BatchNorm running statistics on validation data. [^11]

## Related
- `machine-learning/deep-learning/neural-networks-and-backpropagation.md` — what `backward()` computes; `gradcheck`.
- `machine-learning/deep-learning/optimizers-and-learning-rate-schedules.md` — what `step()` does, warmup and decay.
- `machine-learning/deep-learning/normalization-and-dropout.md` — what `eval()` changes inside dropout and batch norm.
- `machine-learning/foundations/regularization.md` — early stopping as a regularizer.
- `machine-learning/foundations/generalization-and-overfitting.md` — train, validation and test sets; learning curves.
- `machine-learning/ml-systems/reproducibility-and-determinism.md` — seeding the `DataLoader` and its workers.
- `machine-learning/evaluation/cross-validation-and-hyperparameter-search.md` — choosing the learning rate and patience on validation data.
- `machine-learning/deep-learning/data-augmentation-and-transfer-learning.md` — the next fixes once the loop is correct and the model overfits.
