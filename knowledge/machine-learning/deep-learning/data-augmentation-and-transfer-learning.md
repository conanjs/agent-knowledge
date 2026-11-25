---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/deep-learning
status: verified
applies-to: ["PyTorch 2.15.0", "torchvision transforms v2 (docs only; not installed in the lab)"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, deep-learning, data-augmentation, mixup, cutmix, test-time-augmentation, transfer-learning, fine-tuning, feature-extraction, freezing, requires-grad, param-groups, catastrophic-forgetting, domain-shift]
---

# Data augmentation and transfer learning

## Summary
**TL;DR:** Two ways to train a good network with little data. **Data augmentation** makes new training examples by applying random changes that keep the label (a small shift, a left-right flip of a cat photo), so the model cannot memorize exact pixels and generalizes better; mixup and CutMix go further and blend two examples and their labels. **Transfer learning** starts from a network trained on a large source task: either freeze its layers and train only a new output layer (feature extraction), or update every layer with a smaller learning rate for the pretrained part (fine-tuning). Fine-tuning changes the pretrained weights, so the network forgets part of the source task (catastrophic forgetting), and all of it helps less when the target data looks different from the source data (domain shift).
**Use this when:** a model overfits a small dataset, you choose which augmentations are safe for your labels, you reuse a pretrained network, or you decide between freezing and fine-tuning and set per-layer learning rates.
**Not this doc:** the training loop, loss curves and how to spot overfitting → `machine-learning/deep-learning/training-loop-and-debugging.md`; penalties and early stopping → `machine-learning/foundations/regularization.md`; dropout → `machine-learning/deep-learning/normalization-and-dropout.md`; fine-tuning large language models and LoRA (low-rank adaptation) → `machine-learning/transformers/fine-tuning-and-lora.md`; drift in production data → `machine-learning/ml-systems/data-drift-and-monitoring.md`.

## Problem
With a few examples per class, a network memorizes its training set and fails on new data. In the lab below, a small convolutional network trained from scratch on 8 images per class reaches training accuracy 1.000 and test accuracy 0.347 on 4 classes ✅[^16]. Collecting more labelled data is the real fix but is often impossible. Augmentation and transfer learning are the two standard substitutes, and both have traps: a transform that changes the label teaches the model wrong answers, and an aggressive fine-tune erases what the pretrained network knew.

## Mental model
**Analogy:** learning to recognize a friend's handwriting. Augmentation is seeing the same note photographed slightly shifted, rotated or in different light: still the same letters, so you learn the letters, not the photo. But mirroring the note turns a `b` into a `d`: that change alters the answer and must not be used. Transfer learning is that you already read printed text: you only need to learn this person's quirks (fine-tuning), or you keep your reading skills fixed and learn a small lookup on top (feature extraction). Practise only this handwriting for months with no printed text, and printed text gets harder (forgetting).

**Artifact:** the three transfer set-ups in PyTorch, each starting from the pretrained `backbone` with a new `head`:

```python
model.backbone.load_state_dict(pretrained.backbone.state_dict())   # copy all layers except the output layer
# 1. feature extraction: freeze the backbone
for p in model.backbone.parameters(): p.requires_grad = False
opt = torch.optim.Adam([p for p in model.parameters() if p.requires_grad], lr=1e-3)
# 2. fine-tuning with parameter groups: backbone at a 10x lower learning rate
opt = torch.optim.Adam([{"params": model.backbone.parameters(), "lr": 1e-4},
                        {"params": model.head.parameters()}], lr=1e-3)   # head uses the default 1e-3
# 3. from scratch: no load_state_dict, every layer random
```

## How it works
### Data augmentation
1. **What it does:** random changes generate similar but distinct training examples, enlarging the training set, and let the model rely less on particular attributes, which improves generalization ✅[^1]. It acts as a regularizer: it attacks overfitting without changing the model.
2. **Label-preserving transforms only.** A left-right flip usually keeps the category of an object; random crops make objects appear in different positions so the model depends less on position; colour changes vary brightness, contrast, saturation and hue ✅[^1]. Whether a transform preserves the label depends on the task: d2l notes that an up-down flip is less common than a left-right one and does not hinder recognition for its example image ✅[^1], and in the lab a left-right flip merges two classes that are mirror images of each other ✅[^16].
3. **Training only.** Augmentation is usually applied to training examples only, so that predictions are deterministic; d2l's test pipeline only converts the image to a tensor ✅[^1].
4. **Mixup** trains on convex combinations of pairs of examples and of their labels: `x̃ = λ·x_i + (1 − λ)·x_j`, `ỹ = λ·y_i + (1 − λ)·y_j` with one-hot labels and `λ ~ Beta(α, α)` ✅[^2]. Example: `λ = 0.7` gives an image that is 70 % a "2" and 30 % a "7", with target `(0.7 for class 2, 0.3 for class 7)`. Its paper reports less memorization of corrupt labels and more robustness to adversarial examples, and it takes a few lines of code ✅[^2]. `CrossEntropyLoss` accepts such class-probability targets ("soft labels"), of the same shape as the input ✅[^14].
5. **CutMix** cuts a patch from one training image, pastes it onto another, and mixes the labels in proportion to the patch area ✅[^3]. It keeps the regularization of regional dropout (blanking out patches) without throwing away informative pixels ✅[^3].
6. **Test-time augmentation (TTA):** predict on several transformed copies of each test input and average. GoogLeNet averaged softmax probabilities over 144 crops per image, and its authors noted that such aggressive cropping may not be necessary and that extra crops bring marginal benefit after a reasonable number ✅[^4].
7. **In torchvision:** the docs recommend the `torchvision.transforms.v2` transforms over the older `torchvision.transforms`; v2 also transforms bounding boxes, masks, videos and keypoints together with the image ✅[^5]. Their classification example chains `v2.RandomResizedCrop(size=(224, 224), antialias=True)` and `v2.RandomHorizontalFlip(p=0.5)` ✅[^5]. `v2.MixUp` and `v2.CutMix` work on batches, after the `DataLoader` ✅[^5]; `MixUp`'s `alpha` (default 1.0) is the Beta parameter and it one-hot encodes `(batch_size,)` labels to `(batch_size, num_classes)` ✅[^6]. The lab does not install torchvision and writes the same ideas with plain tensor operations.

### Transfer learning
1. **Definition:** transfer learning moves knowledge learned on a source dataset to a target dataset ✅[^7]. Example: ImageNet, with more than 10 million images and 1,000 object classes, is the usual source ✅[^7].
2. **Why it works:** first-layer features look like Gabor filters and colour blobs on many datasets, so they are general; features turn specific to the task towards the top layers ✅[^11]. Transfer helps less as the source and target tasks grow apart ✅[^11].
3. **Fine-tuning recipe:** pretrain a source model; copy all its layers except the output layer, which is tied to the source labels; add a new randomly initialized output layer with one output per target class; train on the target data ✅[^7].
4. **Two scenarios:** fine-tuning initializes from the pretrained network and trains as usual; the fixed feature extractor freezes everything except the final layer ✅[^8].
5. **Freezing:** `requires_grad_(False)` on parameters freezes them: operations on them are not recorded in the backward graph, so their `.grad` is not updated ✅[^9]. Pass only the trainable parameters to the optimizer, as the tutorial does ✅[^8]. The tutorial expects the frozen version to take about half the time on CPU ✅[^8].
6. **Lower learning rate for the backbone:** pretrained parameters need only a small learning rate; d2l gives the new output layer a learning rate ten times greater ✅[^7]. In PyTorch each dict passed to the optimizer is a parameter group with its own options, and a group without `lr` uses the default ✅[^10].
7. **Lingering benefit:** initializing with transferred features improves generalization, and the boost lingers even after fine-tuning on the target ✅[^11]; d2l's fine-tuned model reached about 0.94 test accuracy against 0.85 from scratch ✅[^7].

### Two failure modes
1. **Catastrophic forgetting:** a network trained on tasks one after another loses the earlier ones. Kirkpatrick et al. note it has been widely thought inevitable in such models, and their method remembers old tasks by slowing learning on the weights important for them ✅[^12]. A frozen backbone cannot forget; a lower backbone learning rate forgets less (lab, section 4) ✅[^16].
2. **Domain shift:** under covariate shift the input distribution changes while `P(y | x)`, the labelling rule, stays fixed; example: a cat-vs-dog classifier trained on photos and tested on cartoons ✅[^13]. Label shift changes `P(y)`, concept shift changes what the labels mean ✅[^13]. A model tuned on one domain loses accuracy on another (lab, section 5) ✅[^16].

## Worked example
Synthetic 12 × 12 grey images: each class is a random 5 × 5 binary "glyph" placed at a random position, plus Gaussian noise (standard deviation 0.3). **Source task:** 10 glyphs, 500 training images each, used to "pretrain" a two-convolution network for 3,000 steps with shift augmentation. **Target task:** 4 different glyphs, class 3 being the mirror image of class 2, only **8 training images per class**, 250 test images per class; every target run is 600 Adam steps, batch 32. Lab run (`machine-learning/lab-setup.md`), 2026-11-25, PyTorch 2.15.0, two runs identical, about 60 seconds on CPU ✅[^16]:

```text
== 1. Pretrain on the source task (10 classes x 500 images) ==
source test accuracy 0.941
== 2. Augmentation on the target task, from scratch (4 classes x 8 images, 600 steps) ==
none            : train acc 1.000 test acc 0.347 | classes 2 vs 3 test acc 0.356 | with TTA 0.363
shift +-2 px    : train acc 1.000 test acc 0.609 | classes 2 vs 3 test acc 0.534 | with TTA 0.638
shift + mixup   : train acc 1.000 test acc 0.635 | classes 2 vs 3 test acc 0.624 | with TTA 0.634
horizontal flip : train acc 1.000 test acc 0.387 | classes 2 vs 3 test acc 0.264 | with TTA 0.411
== 3. Transfer to the target task: scratch vs frozen vs fine-tuned (600 steps, seeds 1-3) ==
from scratch               : trainable params  5956 | target test acc 0.347 0.372 0.312 | mean 0.344
frozen backbone            : trainable params  1156 | target test acc 0.526 0.522 0.508 | mean 0.519
fine-tune, 1e-4/1e-3       : trainable params  5956 | target test acc 0.502 0.504 0.500 | mean 0.502
fine-tune, all 1e-3        : trainable params  5956 | target test acc 0.484 0.491 0.491 | mean 0.489
scratch + shift            : trainable params  5956 | target test acc 0.609 0.662 0.586 | mean 0.619
fine-tune 1e-4/1e-3 + shift: trainable params  5956 | target test acc 0.688 0.685 0.680 | mean 0.684
== 4. Catastrophic forgetting: put the source head back on each backbone ==
frozen backbone      : source test acc 0.941 (before transfer 0.941)
fine-tune, 1e-4/1e-3 : source test acc 0.654 (before transfer 0.941)
fine-tune, all 1e-3  : source test acc 0.370 (before transfer 0.941)
== 5. Domain shift: same target classes, test images twice as noisy ==
from scratch         : clean test 0.347 | noisy test 0.284
fine-tune, 1e-4/1e-3 : clean test 0.502 | noisy test 0.312
```

<details><summary>Full script (prints the output above)</summary>

```python
# Data augmentation and transfer learning on synthetic 12x12 "glyph" images (PyTorch, CPU, no downloads).
import torch
from torch import nn
import torch.nn.functional as F
S, G = 12, 5                                            # canvas size, glyph size

def glyphs(k, seed):                                    # k random 5x5 binary patterns ("letters")
    g = torch.Generator().manual_seed(seed)
    return (torch.rand(k, G, G, generator=g) < 0.45).float()

def render(T, n_per, seed, noise=0.3):                  # place each glyph at a random position, add noise
    g = torch.Generator().manual_seed(seed); X, y = [], []
    for c, t in enumerate(T):
        for _ in range(n_per):
            img = torch.zeros(S, S); r, q = torch.randint(0, S - G + 1, (2,), generator=g).tolist()
            img[r:r + G, q:q + G] = t
            X.append(img + noise * torch.randn(S, S, generator=g)); y.append(c)
    return torch.stack(X).unsqueeze(1), torch.tensor(y)

src_T = glyphs(10, seed=0)                              # source task: 10 classes, lots of data
tgt_T = glyphs(4, seed=1); tgt_T[3] = tgt_T[2].flip(-1) # target task: 4 new classes; class 3 = mirror of class 2
Xs, ys = render(src_T, 500, seed=10); Xs_te, ys_te = render(src_T, 100, seed=11)
Xt, yt = render(tgt_T, 8, seed=20); Xt_te, yt_te = render(tgt_T, 250, seed=21)  # only 8 training images per class

class Net(nn.Module):
    def __init__(self, n_out):
        super().__init__()
        self.backbone = nn.Sequential(nn.Conv2d(1, 16, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2),
                                      nn.Conv2d(16, 32, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2), nn.Flatten())
        self.head = nn.Linear(32 * 3 * 3, n_out)
    def forward(self, x): return self.head(self.backbone(x))

def shift(x, g, m=2):                                   # random translation by up to m pixels (label-preserving here)
    dr, dc = torch.randint(-m, m + 1, (2,), generator=g).tolist()
    return torch.roll(x, (dr, dc), dims=(2, 3))

def fit(model, X, y, steps, groups=None, aug=None, mix=False, seed=0):
    g = torch.Generator().manual_seed(seed)
    opt = torch.optim.Adam(groups or [p for p in model.parameters() if p.requires_grad], lr=1e-3)
    for _ in range(steps):
        model.train(); i = torch.randint(0, len(y), (32,), generator=g); xb, yb = X[i], F.one_hot(y[i], model.head.out_features).float()
        if aug == "shift": xb = shift(xb, g)
        if aug == "hflip" and torch.rand(1, generator=g) < 0.5: xb = xb.flip(-1)   # NOT label-preserving for classes 2/3
        if mix:                                         # mixup: convex combination of pairs and their labels
            lam = torch.distributions.Beta(0.4, 0.4).sample(); j = torch.randperm(len(xb), generator=g)
            xb, yb = lam * xb + (1 - lam) * xb[j], lam * yb + (1 - lam) * yb[j]
        loss = F.cross_entropy(model(xb), yb)           # soft (probability) targets are accepted
        opt.zero_grad(); loss.backward(); opt.step()
    return model

@torch.no_grad()
def acc(model, X, y, tta=False):
    model.eval()
    if not tta: return (model(X).argmax(1) == y).float().mean().item()
    p = sum(model(torch.roll(X, (dr, dc), dims=(2, 3))).softmax(1) for dr in (-1, 0, 1) for dc in (-1, 0, 1))
    return (p.argmax(1) == y).float().mean().item()     # average predicted probabilities over 9 shifted copies

torch.manual_seed(0)
print("== 1. Pretrain on the source task (10 classes x 500 images) ==")
src = fit(Net(10), Xs, ys, steps=3000, aug="shift")
print(f"source test accuracy {acc(src, Xs_te, ys_te):.3f}")
src_state = {k: v.clone() for k, v in src.state_dict().items()}

print("== 2. Augmentation on the target task, from scratch (4 classes x 8 images, 600 steps) ==")
for name, kw in [("none", {}), ("shift +-2 px", {"aug": "shift"}), ("shift + mixup", {"aug": "shift", "mix": True}),
                 ("horizontal flip", {"aug": "hflip"})]:
    torch.manual_seed(1); m = fit(Net(4), Xt, yt, 600, seed=1, **kw)
    print(f"{name:16s}: train acc {acc(m, Xt, yt):.3f} test acc {acc(m, Xt_te, yt_te):.3f}"
          f" | classes 2 vs 3 test acc {acc(m, Xt_te[yt_te >= 2], yt_te[yt_te >= 2]):.3f} | with TTA {acc(m, Xt_te, yt_te, tta=True):.3f}")

print("== 3. Transfer to the target task: scratch vs frozen vs fine-tuned (600 steps, seeds 1-3) ==")
def transfer(kind, seed, aug=None):
    torch.manual_seed(seed); m = Net(4)                                  # fresh random head (and backbone)
    if kind == "scratch": return fit(m, Xt, yt, 600, aug=aug, seed=seed)
    m.backbone.load_state_dict(src.backbone.state_dict())                # copy pretrained layers, not the head
    if kind == "frozen":
        for p in m.backbone.parameters(): p.requires_grad = False        # feature extraction
        return fit(m, Xt, yt, 600, aug=aug, seed=seed)
    if kind == "ft_low":                                                 # param groups: backbone 10x lower LR
        return fit(m, Xt, yt, 600, aug=aug, seed=seed,
                   groups=[{"params": m.backbone.parameters(), "lr": 1e-4}, {"params": m.head.parameters()}])
    return fit(m, Xt, yt, 600, aug=aug, seed=seed)                       # "ft_all": every layer at 1e-3
n_train = lambda m: sum(p.numel() for p in m.parameters() if p.requires_grad)
models = {}
for name, kind, aug in [("from scratch", "scratch", None), ("frozen backbone", "frozen", None),
                        ("fine-tune, 1e-4/1e-3", "ft_low", None), ("fine-tune, all 1e-3", "ft_all", None),
                        ("scratch + shift", "scratch", "shift"), ("fine-tune 1e-4/1e-3 + shift", "ft_low", "shift")]:
    runs = [transfer(kind, s, aug) for s in (1, 2, 3)]; models[name] = runs[0]
    accs = [acc(m, Xt_te, yt_te) for m in runs]
    print(f"{name:27s}: trainable params {n_train(runs[0]):5d} | target test acc " + " ".join(f"{a:.3f}" for a in accs)
          + f" | mean {sum(accs) / 3:.3f}")
scratch, frozen, ft, ft_hi = (models[k] for k in ("from scratch", "frozen backbone", "fine-tune, 1e-4/1e-3", "fine-tune, all 1e-3"))

print("== 4. Catastrophic forgetting: put the source head back on each backbone ==")
for name, m in [("frozen backbone", frozen), ("fine-tune, 1e-4/1e-3", ft), ("fine-tune, all 1e-3", ft_hi)]:
    probe = Net(10); probe.load_state_dict(src_state); probe.backbone.load_state_dict(m.backbone.state_dict())
    print(f"{name:21s}: source test acc {acc(probe, Xs_te, ys_te):.3f} (before transfer {acc(src, Xs_te, ys_te):.3f})")

print("== 5. Domain shift: same target classes, test images twice as noisy ==")
Xt_sh, yt_sh = render(tgt_T, 250, seed=22, noise=0.8)
for name, m in [("from scratch", scratch), ("fine-tune, 1e-4/1e-3", ft)]:
    print(f"{name:21s}: clean test {acc(m, Xt_te, yt_te):.3f} | noisy test {acc(m, Xt_sh, yt_sh):.3f}")
```

</details>

Reading it:
- **Section 2, augmentation:** without it the network memorizes (train 1.000, test 0.347). Random shifts of up to 2 pixels, which keep every label here, raise test accuracy to 0.609; adding mixup gives 0.635 in this single seed. The left-right flip is not label-preserving for classes 2 and 3: on their test images accuracy falls from 0.356 to 0.264, below the no-augmentation run.
- **TTA:** averaging probabilities over 9 shifted copies of each test image adds 0.029 to the shift-trained model (0.609 → 0.638) and nothing to the mixup one (0.635 → 0.634).
- **Section 3, transfer (mean of 3 seeds):** from scratch 0.344; a frozen pretrained backbone, training only 1,156 of 5,956 parameters, 0.519; fine-tuning with the backbone at 1e-4, 0.502; fine-tuning everything at 1e-3, 0.489. With 32 labelled images, the frozen features beat updating 5,956 parameters. Transfer and augmentation add up: fine-tuning plus shifts gives 0.684, the best row, and is stable across seeds (0.680–0.688).
- **Section 4, forgetting:** putting the original source head back on each tuned backbone, the frozen one still scores 0.941 on the source task, the 1e-4 backbone 0.654, the 1e-3 backbone 0.370. The higher the backbone learning rate, the more of the source task is lost.
- **Section 5, domain shift:** test images with twice the noise cut the fine-tuned model from 0.502 to 0.312, only 0.028 above the from-scratch model on the same noisy images (0.284): most of its 0.155 gain on clean images is gone.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Transform that changes the label (mirror for `b`/`d`, mirrored glyph pair) | Accuracy on those classes drops (0.356 → 0.264) | The model is taught that both classes look alike; lab ✅[^16]. Flips preserve the label only "usually" ✅[^1] |
| Augmenting validation or test data by accident | Noisy, non-deterministic metrics | Augmentation belongs to training only ✅[^1] |
| `torch.roll` for shifts | Pixels leaving one edge come back on the other | Documented `roll` behaviour ✅[^15]; harmless here because the glyph has a blank margin, not in general |
| Mixup with class-index targets | Not possible: labels must be mixed too | Mixup combines one-hot labels ✅[^2]; pass probabilities to `CrossEntropyLoss` ✅[^14] |
| `v2.MixUp` / `v2.CutMix` inside a per-image pipeline | They need a batch | Designed for batches, after the `DataLoader` ✅[^5] |
| Frozen parameters still given to the optimizer | No update, but they take a place in the optimizer | Frozen tensors get no `.grad` ✅[^9]; the tutorial passes only the trainable ones ✅[^8] |
| Backbone at the same learning rate as the new head | Forgets more of the source (0.370 vs 0.654) and here also scores lower on the target (0.489 vs 0.502) | Pretrained weights need a small rate ✅[^7]; lab ✅[^16] |
| Source and target tasks very different | Smaller gain from transfer | Transferability falls with task distance ✅[^11] |
| Target inputs from a shifted distribution | Accuracy drops (0.502 → 0.312 in the lab) | Covariate shift ✅[^13]; lab ✅[^16] |
| Batch norm layers in a frozen backbone | `requires_grad=False` does not stop running statistics from updating in `train()` mode | Batch norm keeps running estimates during training ✅[^17]; switch those layers to `eval()` to keep them fixed (see `normalization-and-dropout.md`) |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Feature extraction (frozen backbone) | Fewest trainable parameters (1,156 of 5,956 in the lab); no forgetting; faster ✅[^8] ✅[^16] | Cannot adapt the features to the target; weaker when the tasks differ ✅[^11] |
| Fine-tuning, low backbone learning rate | Adapts every layer; best with augmentation in the lab (0.684) ✅[^16] | Forgets part of the source task ✅[^16]; one more hyperparameter |
| From scratch | No dependency on a source model | Needs much more data; lowest accuracy in the lab (0.344) ✅[^16] |
| Simple augmentation (shift, flip, crop) | Large gain on small data (0.347 → 0.609) ✅[^16] | Must be checked for label preservation per task ✅[^1] |
| Mixup / CutMix | Regularization from mixed examples and labels ✅[^2] ✅[^3] | Training images no longer look like test images; single-seed gain in the lab was small (0.609 → 0.635) ✅[^16] |
| TTA | Small accuracy gain without retraining ✅[^4] ✅[^16] | Inference cost times the number of copies; gains fade after a few copies ✅[^4] |

## Takeaways
- For each augmentation, ask "could this change the correct label?" before using it; check the classes that are mirror images or rotations of each other. [rule-candidate]
- Apply random augmentation only in the training pipeline; keep validation and test inputs untransformed. [rule-candidate]
- With very little target data, start from a frozen pretrained backbone; when you fine-tune, give the backbone a smaller learning rate than the new head through parameter groups. [rule-candidate]
- Pass only parameters with `requires_grad=True` to the optimizer when freezing.
- Measure the source task after fine-tuning if the model must still do it; a higher backbone learning rate forgets more.

## Verification status
- Verified: 64 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [Image Augmentation (Dive into Deep Learning, 14.1)](https://d2l.ai/chapter_computer-vision/image-augmentation.html) — Zhang, Lipton, Li, Smola, living. Backs: similar but distinct examples, less reliance on attributes, flips, crops, colour changes, up-down flip caveat, training-only augmentation. [^1]
- [mixup: Beyond Empirical Risk Minimization](https://ar5iv.labs.arxiv.org/html/1710.09412) — Zhang, Cisse, Dauphin, Lopez-Paz, 2017 (ar5iv HTML of arXiv:1710.09412). Backs: convex combinations of inputs and one-hot labels, `λ ~ Beta(α, α)`, reported benefits, a few lines of code. [^2]
- [CutMix: Regularization Strategy to Train Strong Classifiers with Localizable Features](https://arxiv.org/abs/1905.04899) — Yun et al., 2019. Backs: cut-and-paste patches, labels mixed by area, regional dropout comparison. [^3]
- [Going Deeper with Convolutions](https://ar5iv.labs.arxiv.org/html/1409.4842) — Szegedy et al., 2014 (ar5iv HTML of arXiv:1409.4842). Backs: 144 test crops, averaged softmax probabilities, marginal benefit of more crops. [^4]
- [Transforming and augmenting images](https://docs.pytorch.org/vision/stable/transforms.html) — torchvision, living (stable). Backs: v2 recommended, boxes/masks/videos/keypoints, classification example, MixUp/CutMix on batches. [^5]
- [torchvision.transforms.v2.MixUp](https://docs.pytorch.org/vision/stable/generated/torchvision.transforms.v2.MixUp.html) — torchvision, living (stable). Backs: `alpha=1.0` Beta parameter, one-hot labels, batches only. [^6]
- [Fine-Tuning (Dive into Deep Learning, 14.2)](https://d2l.ai/chapter_computer-vision/fine-tuning.html) — Zhang, Lipton, Li, Smola, living. Backs: transfer-learning definition, ImageNet size, four fine-tuning steps, small learning rate for pretrained layers and 10x for the output layer, 0.94 vs 0.85. [^7]
- [Transfer Learning for Computer Vision Tutorial](https://docs.pytorch.org/tutorials/beginner/transfer_learning_tutorial.html) — PyTorch tutorials, living. Backs: fine-tuning vs fixed feature extractor, `requires_grad = False`, optimizing only the final layer, about half the time on CPU. [^8]
- [Autograd mechanics: Setting requires_grad](https://docs.pytorch.org/docs/2.15/notes/autograd.html) — PyTorch, 2026 (2.15). Backs: freezing with `requires_grad_(False)`, not recorded, `.grad` not updated. [^9]
- [torch.optim: per-parameter options](https://docs.pytorch.org/docs/2.15/optim.html) — PyTorch, 2026 (2.15). Backs: parameter groups, groups without `lr` use the default. [^10]
- [How transferable are features in deep neural networks?](https://arxiv.org/abs/1411.1792) — Yosinski, Clune, Bengio, Lipson, 2014. Backs: general first-layer features, specific top layers, transferability vs task distance, lingering boost after fine-tuning. [^11]
- [Overcoming catastrophic forgetting in neural networks](https://arxiv.org/abs/1612.00796) — Kirkpatrick et al., 2016. Backs: catastrophic forgetting in sequential learning, slowing learning on important weights. [^12]
- [Environment and Distribution Shift (Dive into Deep Learning, 4.7)](https://d2l.ai/chapter_linear-classification/environment-and-distribution-shift.html) — Zhang, Lipton, Li, Smola, living. Backs: covariate, label and concept shift; photos vs cartoons. [^13]
- [torch.nn.CrossEntropyLoss](https://docs.pytorch.org/docs/2.15/generated/torch.nn.CrossEntropyLoss.html) — PyTorch, 2026 (2.15). Backs: class-probability (soft) targets for blended labels, same shape as input. [^14]
- [torch.roll](https://docs.pytorch.org/docs/2.15/generated/torch.roll.html) — PyTorch, 2026 (2.15). Backs: shifted elements re-introduced at the first position. [^15]
- [torch.nn.BatchNorm2d](https://docs.pytorch.org/docs/2.15/generated/torch.nn.BatchNorm2d.html) — PyTorch, 2026 (2.15). Backs: running estimates kept during training, used in evaluation. [^17]
- `machine-learning/lab-setup.md` — the lab where the augmentation and transfer script ran on 2026-11-25 (PyTorch 2.15.0, CPU); script at `mllab/data-augmentation-and-transfer-learning/lab.py`. [^16]

## Related
- `machine-learning/deep-learning/training-loop-and-debugging.md` — the loop, checkpoints and the loss curves that show overfitting.
- `machine-learning/foundations/generalization-and-overfitting.md` — why small training sets overfit.
- `machine-learning/foundations/regularization.md` — penalties and early stopping, the other regularizers.
- `machine-learning/deep-learning/normalization-and-dropout.md` — dropout, and batch norm statistics in a frozen backbone.
- `machine-learning/deep-learning/optimizers-and-learning-rate-schedules.md` — learning rates and schedules for fine-tuning.
- `machine-learning/deep-learning/convolutional-networks.md` — the layers a vision backbone is made of.
- `machine-learning/transformers/fine-tuning-and-lora.md` — fine-tuning large pretrained transformers cheaply.
- `machine-learning/ml-systems/data-drift-and-monitoring.md` — detecting domain shift after deployment.
- `machine-learning/ml-systems/reproducibility-and-determinism.md` — seeding the random augmentations.
- `machine-learning/evaluation/cross-validation-and-hyperparameter-search.md` — choosing augmentation strength and learning rates on validation data.
