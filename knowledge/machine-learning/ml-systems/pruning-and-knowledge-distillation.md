---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/ml-systems
status: verified
applies-to: ["any", "PyTorch 2.15 (torch.nn.utils.prune)"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, ml-systems, model-compression, pruning, magnitude-pruning, global-pruning, sparsity, csr, knowledge-distillation, soft-targets, temperature, teacher-student]
---

# Pruning and knowledge distillation

## Summary
**TL;DR:** Two ways to get a smaller network from a large trained one. **Pruning** removes the connections with the smallest weights and retrains the ones left. The zeros save memory only when the weights are stored in a sparse format, which needs `2a + n + 1` numbers for `a` non-zeros in `n` rows (CSR, compressed sparse row). They save time mainly when inference cannot batch, so the layer is a matrix–vector product. **Knowledge distillation** trains a small student to match a large teacher's class probabilities, softened by a softmax at temperature `T`, plus a lightly weighted loss on the true labels. The soft term is multiplied by `T²`. The small, wrong-class probabilities tell the student how the teacher generalizes, so the student can learn from far fewer examples. In the lab, pruning 80 % of a digit classifier's weights dropped accuracy to 0.52 until retraining restored 0.97, and a 16-unit student trained on 100 images gained 7.8 to 9.1 accuracy points from the teacher's soft targets.
**Use this when:** a trained model is too large for its target, you choose a sparsity level or between per-layer and global pruning, a pruned model lost accuracy or did not get smaller or faster, you read `weight_orig` and `weight_mask` in a PyTorch state dict, or a small model must learn from little labelled data.
**Not this doc:** int8 (8-bit integer) quantization and fp16 or bf16 (16-bit floating-point) storage → `machine-learning/ml-systems/model-compression-and-quantization.md`; lottery tickets, pruning to find a sparse subnetwork that trains well from its original initialization → `machine-learning/deep-learning/loss-landscapes-and-generalization.md`; L1 penalties that drive weights to exactly zero during training → `machine-learning/foundations/regularization.md`; softmax and cross-entropy themselves → `machine-learning/foundations/loss-functions-and-maximum-likelihood.md`.

## Problem
State-of-the-art networks are over-parametrized and hard to deploy ✅[^6], and their size costs energy as well as memory. In 45 nm CMOS (complementary metal–oxide–semiconductor) technology, a 32-bit floating-point add costs 0.9 pJ (picojoules), a 32-bit access to on-chip SRAM (static random-access memory) 5 pJ, and a 32-bit access to off-chip DRAM (dynamic random-access memory) 640 pJ. Large networks do not fit on the chip, so they pay the DRAM price ✅[^1]. Serving a whole ensemble may be too expensive for a large number of users, especially when its members are large networks ✅[^2]. The two remedies here are removing the weights a network barely uses, and training a small network to imitate the large one. Both fail when done naively. In the lab, pruning 95 % of a digit classifier's weights without retraining dropped its accuracy from 0.9796 to 0.0796. A 16-unit network trained on 100 labelled images reached only 0.84 to 0.85 ✅[^3].

## Mental model
**Analogy:** pruning is editing a long draft. You strike out the weakest words, then reread and rework the rest so that it still says everything (retraining). The struck-out words save paper only if the page is reprinted without the gaps (sparse storage). Distillation is an apprentice who learns from a master's graded hunches, such as "this 9 looks a little like a 7 and a 4", not only from the answer key. Hinton et al. give a biological analogy: many insects have a larval form built for taking in energy and nutrients and a completely different adult form built for travel and reproduction. In the same way, the model that learns and the model that is deployed can be different ✅[^2].

**Artifact:** four lines printed by the full script in the Worked example. Lab run (`machine-learning/lab-setup.md`), 2026-11-25, PyTorch 2.15.0 ✅[^3]:

```text
pruned 80%: weights at zero 80.0% (after retraining 80.0%) | accuracy 0.5222, after retraining 0.9667
teacher soft targets for image 0 (label 9), T=1: [0. 0. 0. 0. 0. 0. 0. 0. 0. 1.]
                                               T=4: [0.003 0.036 0.    0.002 0.076 0.019 0.001 0.078 0.033 0.751]
student 64-16-10, seed 1: hard labels 0.8537 | distilled (T=4) 0.9352
```

Cutting 80 % of the weights broke the network until the remaining 20 % were retrained. At `T = 1` the teacher's answer rounds to a one-hot "9". At `T = 4` it also says how much the image resembles a 7 (0.078) and a 4 (0.076). A 16-unit student trained on those soft targets beat the same student trained on the labels alone.

## How it works
### 1. Magnitude pruning
1. **Train, prune, retrain.** Han et al. first train the network normally to learn which connections matter. They then remove every connection whose weight is below a threshold, and retrain the remaining sparse connections. This cut the parameters 9 times for AlexNet and 13 times for VGG-16 ✅[^1]. In their implementation, a mask stops the pruned connections from being updated ✅[^1].
2. **Per layer or global.** Local pruning compares each weight only with the other weights of its own tensor. Global pruning removes, for example, the lowest 20 % of connections across the whole model, which is likely to give each layer a different pruning percentage ✅[^6]. In the lab, a global 50 % cut took 51.5 % of the first layer's weights and 40.7 % of the second's ✅[^3].
3. **Storage.** A pruned tensor kept dense has the same shape and bytes as before. The savings need a sparse format. CSR or CSC (compressed sparse column) storage needs `2a + n + 1` numbers, where `a` is the number of non-zero weights and `n` the number of rows or columns ✅[^1]. Example: a 256 × 64 layer at exactly 95 % sparsity keeps `a = 819` weights, so CSR needs `2·819 + 256 + 1 = 1,895` numbers instead of 16,384. Lab: after the 95 % global cut, the 256 × 64 first layer kept `a = 881` weights, so `2·881 + 256 + 1 = 2,019` numbers. PyTorch's own CSR tensor of that layer holds exactly 2,019 values and indices ✅[^3]. Han et al. compress further by storing the difference between positions instead of the absolute position, in 8 bits for convolutional layers and 5 bits for fully connected ones ✅[^1].
4. **Where the speed comes from.** At batch size 1, pruned fully connected layers ran 3 to 4 times faster than dense ones on average, because they need less memory and move less data. With batching, the dense matrix–matrix product reuses weights from the cache, and the pruned network no longer showed its advantage ✅[^1].
5. **In PyTorch.** `prune.l1_unstructured` removes the given amount of entries with the lowest absolute value (L1 norm). A float `amount` is a fraction and an int is a count. It adds a `weight_mask` buffer and keeps the unpruned values as a parameter `weight_orig` ✅[^4]. `prune.global_unstructured` pools all listed tensors before choosing which entries to cut ✅[^5]. The mask is applied before each forward pass by a forward pre-hook ✅[^6]. `prune.remove` makes the pruning permanent by writing the pruned tensor back as `weight` ✅[^6]. `prune.ln_structured` removes whole slices instead. The tutorial's example zeroes 3 of a convolution's 6 output channels by their L2 norm (the square root of the sum of a channel's squared weights) ✅[^6].
6. **With quantization.** Deep Compression chains pruning, trained quantization and Huffman coding, and cut storage 35 to 49 times without affecting accuracy ✅[^1]. Pruning alone and quantization alone each began to lose accuracy significantly below 8 % of the original size. Combined, the network reached 3 % with no loss of accuracy ✅[^1]. Integer quantization is in `machine-learning/ml-systems/model-compression-and-quantization.md`.

### 2. Knowledge distillation
1. **What is transferred.** Hinton et al. view a trained model's knowledge as a learned mapping from inputs to outputs rather than as particular weight values ✅[^2]. A trained classifier also gives probabilities to every wrong class, and their ratios show how it generalizes. Their example is an image of a BMW: it has only a small chance of being mistaken for a garbage truck, but that is still far more likely than being mistaken for a carrot ✅[^2]. Soft targets are the class probabilities of the large ("cumbersome") model or ensemble, used as targets for the small model on the same training set or on a separate transfer set ✅[^2].
2. **Why plain probabilities are not enough.** When the teacher is almost always confidently right, as on MNIST (a handwritten-digit dataset), much of what it learned sits in the ratios of tiny probabilities. An example is a "2" that is `10⁻⁶` likely a "3" and `10⁻⁹` a "7". Such values barely affect a normal cross-entropy ✅[^2].
3. **Temperature.** `q_i = exp(z_i / T) / Σ_j exp(z_j / T)`, where `z_i` is the logit (pre-softmax score) of class `i`, `q_i` its probability and `T` the temperature. `T = 1` is the normal softmax, and a higher `T` gives a softer distribution ✅[^2]. Worked numbers for logits `[2, 1, 0]`: `T = 1` gives `[0.665, 0.245, 0.090]`, and `T = 4` gives `[0.419, 0.326, 0.254]` ✅[^3].
4. **The loss.** Train the student at the same high `T` on the soft targets, plus a cross-entropy on the true labels at `T = 1` with a considerably lower weight. Multiply the soft term by `T²`, because its gradients scale as `1/T²` ✅[^2]. The `T²` factor keeps the relative weight of the two terms roughly unchanged when `T` changes ✅[^2]. After training, the student runs at `T = 1` ✅[^2]. Lab numbers: with soft-term weight 0.9 and `T = 4`, the loss is `0.9 · 16 · CE_soft + 0.1 · CE_hard`, where `CE` is cross-entropy.
5. **Why it helps with little data.** High-entropy soft targets carry much more information per example than hard labels, and their gradients vary less between examples. So the student can often learn from much less data and with a much higher learning rate ✅[^2]. In Hinton et al.'s MNIST run, a large regularized network made 67 test errors and a smaller network trained without regularization made 146. The same smaller network trained also to match the large one's soft targets at `T = 20` made 74 ✅[^2].
6. **Choosing T.** With 300 or more units per hidden layer, all temperatures above 8 gave fairly similar results. With 30 units per layer, temperatures from 2.5 to 4 worked significantly better than higher or lower ones ✅[^2].
7. **Matching logits is a special case.** At a temperature high compared with the logits, and with logits zero-meaned for each example, distillation is equivalent to minimizing `½ (z_i − v_i)²`, the squared difference between student logits `z_i` and teacher logits `v_i` ✅[^2].

## Worked example
One teacher, compressed two ways. A 64-256-10 MLP (multilayer perceptron) teacher is trained for 300 Adam steps on scikit-learn's bundled 8 × 8 digit images (1,257 training, 540 test). It is then pruned globally by weight magnitude over both weight matrices at 50, 80 and 95 %, and retrained 300 steps with the masks kept. The script prints the overall and per-layer sparsity, and at 95 % converts the first layer to CSR. Separately, a 64-16-10 student is trained on only 100 training images, once on hard labels and once on the teacher's `T = 4` soft targets (soft-term weight 0.9, hard-term weight 0.1), for three seeds. Core lines:

```python
prune.global_unstructured(params, pruning_method=prune.L1Unstructured, amount=amount)
soft = F.softmax(teacher(Xs) / T, dim=1)                                    # teacher at temperature T
soft_term = -(soft * F.log_softmax(out / T, dim=1)).sum(1).mean() * T * T   # soft cross-entropy, times T^2
loss = ALPHA * soft_term + (1 - ALPHA) * F.cross_entropy(out, ys)           # plus a small hard-label term
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-25, PyTorch 2.15.0 (CPU), scikit-learn 1.9.1, two runs identical. stderr also printed a `UserWarning` that sparse CSR tensor support is in beta ✅[^3]:

```text
dense teacher (64-256-10): accuracy 0.9796
pruned 50%: weights at zero 50.0% (after retraining 50.0%) | accuracy 0.9667, after retraining 0.9722
    global pruning per layer: layer 1 (256x64) 51.5% zero, layer 2 (10x256) 40.7% zero
pruned 80%: weights at zero 80.0% (after retraining 80.0%) | accuracy 0.5222, after retraining 0.9667
    global pruning per layer: layer 1 (256x64) 79.9% zero, layer 2 (10x256) 80.8% zero
pruned 95%: weights at zero 95.0% (after retraining 95.0%) | accuracy 0.0796, after retraining 0.8130
    global pruning per layer: layer 1 (256x64) 94.6% zero, layer 2 (10x256) 97.4% zero
    layer 1 as CSR: a = 881 non-zeros, n = 256 rows -> 2a+n+1 = 2019; torch CSR values + col_indices + crow_indices = 2019; dense 16384
softmax([2,1,0] / T): {1.0: [0.665, 0.245, 0.09], 4.0: [0.419, 0.326, 0.254]}
teacher soft targets for image 0 (label 9), T=1: [0. 0. 0. 0. 0. 0. 0. 0. 0. 1.]
                                               T=4: [0.003 0.036 0.    0.002 0.076 0.019 0.001 0.078 0.033 0.751]
student 64-16-10, seed 1: hard labels 0.8537 | distilled (T=4) 0.9352
student 64-16-10, seed 2: hard labels 0.8444 | distilled (T=4) 0.9222
student 64-16-10, seed 3: hard labels 0.8519 | distilled (T=4) 0.9426
```

<details><summary>Full script (prints the output above)</summary>

```python
# Magnitude pruning at 50/80/95% sparsity (global, with per-layer sparsity and CSR storage), and knowledge
# distillation with temperature T, on one teacher trained on the bundled digits data.
import copy
import torch
import torch.nn.functional as F
from torch.nn.utils import prune
from sklearn.datasets import load_digits
from sklearn.model_selection import train_test_split

X, y = load_digits(return_X_y=True)
Xtr, Xte, ytr, yte = (torch.tensor(a) for a in train_test_split(X / 16.0, y, test_size=0.3, random_state=0))
Xtr, Xte = Xtr.float(), Xte.float()

def mlp(hidden, seed):
    torch.manual_seed(seed)
    return torch.nn.Sequential(torch.nn.Linear(64, hidden), torch.nn.ReLU(), torch.nn.Linear(hidden, 10))

def train(net, X, loss_fn, steps=300, lr=1e-2):
    opt = torch.optim.Adam(net.parameters(), lr=lr)
    for _ in range(steps):
        opt.zero_grad(); loss_fn(net(X)).backward(); opt.step()
    return net

acc = lambda net: (net(Xte).argmax(1) == yte).float().mean().item()
teacher = train(mlp(256, 0), Xtr, lambda out: F.cross_entropy(out, ytr))
print(f"dense teacher (64-256-10): accuracy {acc(teacher):.4f}")

for amount in (0.5, 0.8, 0.95):                    # global magnitude pruning over both weight matrices
    net = copy.deepcopy(teacher)
    params = [(net[0], "weight"), (net[2], "weight")]
    prune.global_unstructured(params, pruning_method=prune.L1Unstructured, amount=amount)
    zeros = sum((m.weight == 0).sum().item() for m, _ in params) / sum(m.weight.numel() for m, _ in params)
    before = acc(net)
    train(net, Xtr, lambda out: F.cross_entropy(out, ytr))   # retrain 300 steps; the masks stay applied
    still = sum((m.weight == 0).sum().item() for m, _ in params) / sum(m.weight.numel() for m, _ in params)
    print(f"pruned {amount:.0%}: weights at zero {zeros:.1%} (after retraining {still:.1%}) | accuracy {before:.4f}, after retraining {acc(net):.4f}")
    per_layer = [(m.weight == 0).float().mean().item() for m, _ in params]
    print(f"    global pruning per layer: layer 1 (256x64) {per_layer[0]:.1%} zero, layer 2 (10x256) {per_layer[1]:.1%} zero")
    if amount == 0.95:                             # CSR storage of layer 1: Han et al. count 2a + n + 1 numbers
        W1 = net[0].weight.detach()
        a, n = int((W1 != 0).sum()), W1.shape[0]
        csr = W1.to_sparse_csr()
        print(f"    layer 1 as CSR: a = {a} non-zeros, n = {n} rows -> 2a+n+1 = {2 * a + n + 1}; "
              f"torch CSR values + col_indices + crow_indices = {csr.values().numel() + csr.col_indices().numel() + csr.crow_indices().numel()}; dense {W1.numel()}")

T, ALPHA, n_small = 4.0, 0.9, 100                  # student sees only 100 training images
z = torch.tensor([2.0, 1.0, 0.0])
print("softmax([2,1,0] / T):", {t: [round(v, 3) for v in F.softmax(z / t, 0).tolist()] for t in (1.0, 4.0)})
Xs, ys = Xtr[:n_small], ytr[:n_small]
with torch.no_grad():
    soft = F.softmax(teacher(Xs) / T, dim=1)
print(f"teacher soft targets for image 0 (label {ys[0].item()}), T=1: {F.softmax(teacher(Xs[:1]), 1)[0].detach().numpy().round(3)}")
print(f"                                               T={T:g}: {soft[0].numpy().round(3)}")
def kd_loss(out):                                   # Hinton et al.: T^2-weighted soft term + hard term
    soft_term = -(soft * F.log_softmax(out / T, dim=1)).sum(1).mean() * T * T   # cross-entropy with soft targets
    return ALPHA * soft_term + (1 - ALPHA) * F.cross_entropy(out, ys)
for seed in (1, 2, 3):
    hard = train(mlp(16, seed), Xs, lambda out: F.cross_entropy(out, ys))
    dist = train(mlp(16, seed), Xs, kd_loss)
    print(f"student 64-16-10, seed {seed}: hard labels {acc(hard):.4f} | distilled (T={T:g}) {acc(dist):.4f}")
```

</details>

Reading it:
- **Pruning:** at 50 % the network barely notices (0.9796 → 0.9667, 0.9722 after retraining). At 80 % it collapses to 0.5222 until retraining brings it back to 0.9667. At 95 % retraining recovers only to 0.8130. The sparsity stays exactly at the target after retraining, because the mask is applied before every forward pass ✅[^6].
- **Global, not per layer:** the same overall cut lands unevenly. At 50 % it took 51.5 % of the first layer and 40.7 % of the second; at 95 % the order flips (94.6 % and 97.4 %).
- **Storage:** at 95 % the first layer keeps 881 of its 16,384 weights. Its CSR form holds 2,019 numbers, the same count as `2a + n + 1`. The count is of numbers, not bytes.
- **Soft targets:** at `T = 1` the teacher's output for this "9" rounds to a one-hot vector; at `T = 4` it shows which other digits resemble it (0.078 for "7", 0.076 for "4").
- **Distillation:** with the same 100 images, architecture and seed, the soft-target student beats the hard-label student in each of the three seeds, by 7.8 to 9.1 points (0.8537 → 0.9352, 0.8444 → 0.9222, 0.8519 → 0.9426). The teacher had seen all 1,257 training images, so the soft targets carry what it learned from them.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `torch.nn.utils.prune` before `prune.remove` | The module holds `weight_orig` and a `weight_mask` as well as the pruned `weight` | Pruning is a re-parametrization ✅[^4]; `remove` makes it permanent ✅[^6] |
| Pruned dense tensor | Same shape and bytes; only zeros changed | Savings need sparse storage such as CSR ✅[^1]; lab: 2,019 CSR numbers vs 16,384 dense ✅[^3] |
| 95 % sparsity without retraining | Accuracy near chance | Lab: 0.0796, 0.8130 after retraining ✅[^3]; Han et al. retrain after pruning ✅[^1] |
| Global pruning | Some layers lose more than the target share, others less | It ranks all weights together ✅[^5] ✅[^6]; lab 51.5 % vs 40.7 % at a 50 % target ✅[^3] |
| Sparse layer in batched inference | The pruned network's speed advantage disappeared | Batched matrix–matrix products reuse weights from cache ✅[^1] |
| Student cannot match the soft targets | A small hard-label term helps | Erring towards the correct answer helps ✅[^2] |
| Very small student | Intermediate temperatures work best | 30 units per layer: `T` from 2.5 to 4 beat higher and lower values ✅[^2] |
| Teacher confidently right at `T = 1` | Its soft targets are nearly one-hot | Lab image 0 rounds to one-hot at `T = 1` ✅[^3]; the information sits in ratios of tiny probabilities ✅[^2] |
| Changing `T` without the `T²` factor | The soft term's share of the gradient changes with `T` | Soft-target gradients scale as `1/T²` ✅[^2] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Magnitude pruning + retraining | 9–13 times fewer parameters ✅[^1] | Needs retraining and sparse storage ✅[^1] |
| Global instead of per-layer pruning | The tutorial calls it common and perhaps more powerful ✅[^6] | Each layer's sparsity is likely to differ from the target ✅[^6]; lab 40.7 % to 97.4 % across layers and targets ✅[^3] |
| Pruning combined with quantization | 3 % of the original size with no accuracy loss, where each alone lost accuracy significantly below 8 % ✅[^1] | Two compression stages to tune |
| Distillation | On little data, a small student beat hard-label training by 7.8 to 9.1 points in three seeds (lab) ✅[^3]; soft targets let a student learn from much less data ✅[^2] | A teacher to train and run |

## Takeaways
- Retrain after pruning and measure held-out accuracy at each sparsity level. In the lab, 50 % was harmless, 80 % collapsed until retraining, and 95 % never fully recovered.
- Do not expect a smaller file or faster inference from zeros alone. Store pruned weights in a sparse format, and measure speed at the batch size you serve.
- When a small model must learn from little labelled data, try distilling from a larger model before collecting more labels.
- Multiply the soft-target term by `T²`, so that a change of temperature does not silently reweight the two losses. [rule-candidate]

## Verification status
- Verified: 59 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [Deep Compression: Compressing Deep Neural Networks with Pruning, Trained Quantization and Huffman Coding](https://arxiv.org/html/1510.00149v5) — Han, Mao, Dally, 2016. Backs: energy per operation in 45 nm CMOS and the DRAM cost of large networks; train-prune-retrain; masks on pruned connections; 9 and 13 times fewer parameters; CSR/CSC `2a + n + 1`; relative indices in 8 and 5 bits; 3–4 times speedup at batch size 1 and none with batching; the three-stage pipeline, 35 to 49 times; pruning and quantization together to 3 %. [^1]
- [Distilling the Knowledge in a Neural Network](https://arxiv.org/html/1503.02531v1) — Hinton, Vinyals, Dean, 2015. Backs: cumbersome models are expensive to deploy, the insect analogy, knowledge as an input–output mapping, the BMW example, soft targets and transfer sets, information in small probabilities, temperature softmax, weighted soft and hard losses, `T²` factor and its purpose, `T = 1` after training, less data and a higher learning rate, MNIST 67/146/74 errors, temperature choice by student size, matching logits as a special case, erring towards the correct answer. [^2]
- `machine-learning/lab-setup.md` — the lab where the pruning (overall and per-layer sparsity, CSR storage) and distillation run ran on 2026-11-25; its pruning and distillation lines first ran, with the same values, on 2026-11-24. [^3]
- [torch.nn.utils.prune.l1_unstructured](https://docs.pytorch.org/docs/2.15/generated/torch.nn.utils.prune.l1_unstructured.html) — PyTorch Foundation, PyTorch 2.15 docs. Backs: lowest-L1 removal, `amount` as fraction or count, `weight_mask` buffer, `weight_orig` parameter. [^4]
- [torch.nn.utils.prune.global_unstructured](https://docs.pytorch.org/docs/2.15/generated/torch.nn.utils.prune.global_unstructured.html) — PyTorch Foundation, PyTorch 2.15 docs. Backs: global pruning pools all tensors before choosing. [^5]
- [Pruning Tutorial](https://docs.pytorch.org/tutorials/intermediate/pruning_tutorial.html) — PyTorch Foundation, PyTorch Tutorials 2.15.0. Backs: local vs global pruning and uneven per-layer percentages, global pruning as common and perhaps more powerful, the mask applied by a forward pre-hook, `prune.remove` makes pruning permanent, structured pruning of whole channels. [^6]

## Related
- `machine-learning/ml-systems/model-compression-and-quantization.md` — int8 quantization, the step Deep Compression combines with pruning, and fp16/bf16 storage.
- `machine-learning/deep-learning/loss-landscapes-and-generalization.md` — lottery tickets: magnitude pruning with rewinding to find sparse subnetworks that train well.
- `machine-learning/foundations/regularization.md` — the L1 penalty, which makes weights exactly zero during training instead of after it.
- `machine-learning/foundations/loss-functions-and-maximum-likelihood.md` — cross-entropy, the loss both distillation terms use.
- `machine-learning/deep-learning/modern-cnn-architectures.md` — networks designed small from the start (depthwise-separable convolutions).
