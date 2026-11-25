---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/deep-learning
status: verified
applies-to: ["PyTorch 2.15.0"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, deep-learning, cnn, convolution, cross-correlation, conv2d, padding, stride, output-shape, pooling, max-pooling, parameter-sharing, receptive-field, residual-connections, resnet]
---

# Convolutional networks

## Summary
**TL;DR:** A convolutional layer slides one small kernel of weights over the whole image and, at each position, outputs the sum of the element-wise products: the same few weights are reused everywhere (parameter sharing), and each output depends only on a small neighbourhood (locality). Without dilation, the output size along each axis is `floor((n + 2·p − k)/s) + 1` for input size `n`, kernel `k`, padding `p` per side and stride `s`. Pooling shrinks feature maps with a fixed max or mean and has no weights. Stacking layers widens the receptive field (the input area one output can see), and residual connections `x + F(x)` let gradients pass through very deep stacks.
**Use this when:** you compute layer shapes for `nn.Conv2d` and `nn.MaxPool2d`, count the parameters of a CNN (convolutional neural network), wonder why an image model uses convolutions instead of dense layers, size the receptive field, or add skip connections to a deep network.
**Not this doc:** batch normalization inside a residual block → `machine-learning/deep-learning/normalization-and-dropout.md`; why plain deep stacks lose their gradient → `machine-learning/deep-learning/activations-and-initialization.md`; attention as the alternative to convolution for sequences → `machine-learning/transformers/attention-and-the-transformer.md`.

## Problem
A fully connected layer treats an image as an unordered list of numbers. For a one-megapixel photo, even 1,000 hidden units need `10^6 × 10^3 = 10^9` weights ✅[^1], and nothing in the layer says that a pattern means the same thing wherever it appears, the translation invariance that convolutions build in ✅[^1]. Convolutions fix both problems, but bring their own arithmetic: shapes that shrink at every layer, strides that silently drop pixels, and an output whose view of the image depends on depth.

## Mental model
**Analogy:** a rubber stamp checked against a picture. You press one small stamp (the kernel) on every position of the picture and write down how well it matches there; the list of scores is a new, smaller picture (a feature map). Because it is the same stamp everywhere, a pattern is found wherever it is, and the stamp has only as many weights as it has cells. A second stamp applied to the score picture looks at scores that each summarized a patch, so it sees a larger part of the original: that is the growing receptive field. A residual connection is a bypass road: the layer only has to learn a correction, and the original picture always gets through.

**Artifact:** the stamp on a 3 × 3 picture, and the parameter bill of the two layer types; printed by the full script in the Worked example; lab run (`machine-learning/lab-setup.md`), 2026-11-24, PyTorch 2.15.0 ✅[^8]:

```text
== (1) 2-D cross-correlation by hand vs F.conv2d ==
hand: [[19.0, 25.0], [37.0, 43.0]]  F.conv2d: [[19.0, 25.0], [37.0, 43.0]]
== (3) parameters: 3x32x32 image -> 64 feature maps of 32x32 ==
Conv2d(3, 64, 3): 1,792 = 64*3*3*3 + 64 | Linear(3072, 65536): 201,392,128
```

The input is `[[0, 1, 2], [3, 4, 5], [6, 7, 8]]` and the kernel `[[0, 1], [2, 3]]`; the first output is `0·0 + 1·1 + 3·2 + 4·3 = 19`, the example Dive into Deep Learning (d2l) uses ✅[^2]. Mapping a 3 × 32 × 32 image to 64 maps of 32 × 32 costs 1,792 parameters as a convolution and 201,392,128 as a dense layer.

## How it works
### From dense layers to convolutions
1. **Translation invariance:** if shifting the input should only shift the hidden representation, the weights cannot depend on the position `(i, j)`; one shared set of weights remains, and the layer becomes a convolution ✅[^1].
2. **Locality:** setting the weights to 0 outside a window `|a|, |b| ≤ Δ` cuts a 1000 × 1000 layer's parameters from `4 × 10^6` to `4·Δ²` ✅[^1].
3. **The price:** features become translation invariant and local by construction; if the data does not have that structure, the model can struggle even to fit the training data ✅[^1].

### The operation: cross-correlation, channels, parameters
1. **Slide and sum:** the kernel window starts at the top-left corner, moves left to right and top to bottom, and at each position the window's elements times the kernel's are summed into one output value ✅[^2].
2. **Not flipped:** deep-learning "convolution" is really cross-correlation; a true convolution flips the kernel, but since kernels are learned, the outputs are the same either way ✅[^2]. PyTorch's `Conv2d` is defined with "the valid 2D cross-correlation operator" ✅[^3].
3. **Channels:** each output channel sums one kernel per input channel, `out(N_i, C_out_j) = bias(C_out_j) + Σ_k weight(C_out_j, k) ⋆ input(N_i, k)` ✅[^3]; the weight tensor has shape `(out_channels, in_channels/groups, kH, kW)` ✅[^3], so a layer has `c_out·c_in·kH·kW + c_out` parameters with bias (`64·3·3·3 + 64 = 1,792` above) ✅[^8].
4. **1 × 1 convolution:** a fully connected layer applied at every pixel, mixing channels only, with `c_out × c_in` weights plus bias ✅[^4].

### Output size: padding and stride
1. **No padding, stride 1:** the output is `n − k + 1` along each axis ✅[^5]; ten 5 × 5 layers shrink a 240 × 240 image to 200 × 200 ✅[^5].
2. **PyTorch's formula:** `H_out = floor((H_in + 2·padding − dilation·(kernel_size − 1) − 1)/stride + 1)` ✅[^3]; with `dilation = 1` this is `floor((n + 2p − k)/s) + 1`. Example: `n = 32`, `k = 3`, `p = 1`, `s = 2` gives `floor(31/2) + 1 = 16`.
3. **Same-size padding:** with an odd kernel, `p = (k − 1)/2` on each side keeps the size at stride 1 ✅[^5]; PyTorch's `padding='same'` does this but does not support a stride other than 1 ✅[^3].
4. **Two conventions:** d2l's `p_h` is the total padding over both sides, `floor((n − k + p_h + s)/s)` ✅[^5]; PyTorch's `padding` is the amount added to each side ✅[^3].

### Pooling
Pooling slides a fixed window like a convolution but has no parameters; it outputs the maximum or the average of each window ✅[^6]. It pools each channel separately, so the number of channels does not change ✅[^6], and frameworks default the stride to the window size ✅[^6]; in PyTorch, `MaxPool2d`'s `stride` defaults to `kernel_size` ✅[^7]. Pooling gives some invariance to small shifts and, by reducing the resolution, makes later kernels cover a larger part of the input ✅[^6].

### Receptive field
The receptive field of an element is every element, in all previous layers, that can affect it in the forward pass; it grows with depth and can be larger than the input itself ✅[^2]. In the lab, each extra 3 × 3 layer at stride 1 widens it by 2 pixels, and putting a stride-2 layer first makes every later layer widen it twice as fast ✅[^8].

### Residual connections
1. **The degradation problem:** beyond some depth, adding layers to a plain network raises the **training** error, so it is not overfitting ✅[^9].
2. **Learn the residual:** a block outputs `F(x) + x`, so its layers learn `F(x) = f(x) − x`; if the best mapping is the identity, pushing `F`'s weights to zero is enough ✅[^10] ✅[^9].
3. **Free shortcut:** identity shortcuts add no parameters and no computation; when shapes differ, the paper either pads the identity with zeros (no parameters) or uses a projection (a 1 × 1 convolution) to match them ✅[^9].
4. **The ResNet (residual network) block:** two 3 × 3 convolutions with the same number of channels, each followed by batch norm, with a ReLU (rectified linear unit) after the first and the input added before the final ReLU ✅[^10]. With residual blocks, ResNet went up to 152 layers, 8 times deeper than the earlier VGG (Visual Geometry Group) networks ✅[^9]; its 50- to 152-layer models use a "bottleneck" block of 1 × 1, 3 × 3 and 1 × 1 convolutions instead of two 3 × 3 ones ✅[^9].

## Worked example
Shapes, receptive fields and gradient flow, each checked against PyTorch on the CPU (central processing unit). The receptive field is measured by backpropagating from one centre output pixel and counting the input pixels with a nonzero gradient:

```python
x = torch.zeros(1, 1, 21, 21, requires_grad=True); h = x
for k, s in layers:
    h = F.conv2d(h, torch.ones(1, 1, k, k), stride=s, padding=k // 2)
c = h.shape[-1] // 2; h[0, 0, c, c].backward()
rows = (x.grad[0, 0].abs().sum(1) > 0).sum().item()      # side of the receptive field
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-24, PyTorch 2.15.0, two runs identical; output lines 3–11 and 14–23 (lines 1–2 and 12–13 are the Mental model artifact) ✅[^8]:

```text
== (2) output size: floor((n + 2p - k) / s) + 1 ==
n=32 k=3 p=0 s=1: Conv2d -> 30   formula -> 30
n=32 k=3 p=1 s=1: Conv2d -> 32   formula -> 32
n=32 k=3 p=1 s=2: Conv2d -> 16   formula -> 16
n=32 k=5 p=2 s=2: Conv2d -> 16   formula -> 16
n=28 k=5 p=0 s=1: Conv2d -> 24   formula -> 24
n= 7 k=3 p=0 s=2: Conv2d ->  3   formula ->  3
n= 8 k=3 p=0 s=3: Conv2d ->  2   formula ->  2
MaxPool2d(2) on 32x32 -> (16, 16) | parameters: 0
== (4) receptive field: input pixels that reach one centre output ==
3x3/s1                                         field 3x3
3x3/s1 -> 3x3/s1                               field 5x5
3x3/s1 -> 3x3/s1 -> 3x3/s1                     field 7x7
3x3/s1 -> 3x3/s1 -> 3x3/s1 -> 3x3/s1 -> 3x3/s1 field 11x11
3x3/s2 -> 3x3/s1                               field 7x7
3x3/s2 -> 3x3/s2 -> 3x3/s1                     field 15x15
== (5) gradient reaching the input of 30 conv layers (default init, ReLU) ==
plain    h = relu(conv(h))    : output std 2.24e-02  |grad wrt input| 4.05e-17
residual h = h + conv(relu(h)): output std 6.48e+00  |grad wrt input| 1.03e+01
```

<details><summary>Full script (prints the output above)</summary>

```python
# Convolution as cross-correlation, the output-size formula, parameter sharing, receptive field
# growth, and the gradient through a plain vs a residual stack (PyTorch, CPU).
import torch
from torch import nn
import torch.nn.functional as F
torch.manual_seed(0)

print("== (1) 2-D cross-correlation by hand vs F.conv2d ==")
X = torch.arange(9.0).reshape(3, 3); K = torch.tensor([[0.0, 1.0], [2.0, 3.0]])
hand = torch.tensor([[(X[i:i + 2, j:j + 2] * K).sum() for j in range(2)] for i in range(2)])
print("hand:", hand.tolist(), " F.conv2d:", F.conv2d(X[None, None], K[None, None])[0, 0].tolist())

print("== (2) output size: floor((n + 2p - k) / s) + 1 ==")
for n, k, p, s in [(32, 3, 0, 1), (32, 3, 1, 1), (32, 3, 1, 2), (32, 5, 2, 2), (28, 5, 0, 1), (7, 3, 0, 2), (8, 3, 0, 3)]:
    out = nn.Conv2d(1, 1, k, stride=s, padding=p)(torch.zeros(1, 1, n, n)).shape[-1]
    print(f"n={n:2} k={k} p={p} s={s}: Conv2d -> {out:2}   formula -> {(n + 2 * p - k) // s + 1:2}")
print("MaxPool2d(2) on 32x32 ->", tuple(nn.MaxPool2d(2)(torch.zeros(1, 1, 32, 32)).shape[-2:]),
      "| parameters:", sum(p.numel() for p in nn.MaxPool2d(2).parameters()))

print("== (3) parameters: 3x32x32 image -> 64 feature maps of 32x32 ==")
conv = nn.Conv2d(3, 64, kernel_size=3, padding=1)
dense = nn.Linear(3 * 32 * 32, 64 * 32 * 32, device="meta")     # meta: shapes only, no memory
count = lambda m: sum(p.numel() for p in m.parameters())
print(f"Conv2d(3, 64, 3): {count(conv):,} = 64*3*3*3 + 64 | Linear(3072, 65536): {count(dense):,}")

print("== (4) receptive field: input pixels that reach one centre output ==")
def field(layers):
    x = torch.zeros(1, 1, 21, 21, requires_grad=True); h = x
    for k, s in layers:
        h = F.conv2d(h, torch.ones(1, 1, k, k), stride=s, padding=k // 2)
    c = h.shape[-1] // 2; h[0, 0, c, c].backward()
    rows = (x.grad[0, 0].abs().sum(1) > 0).sum().item(); return f"{rows}x{rows}"
for layers in [[(3, 1)], [(3, 1)] * 2, [(3, 1)] * 3, [(3, 1)] * 5, [(3, 2), (3, 1)], [(3, 2), (3, 2), (3, 1)]]:
    print(f"{' -> '.join(f'{k}x{k}/s{s}' for k, s in layers):46} field {field(layers)}")

print("== (5) gradient reaching the input of 30 conv layers (default init, ReLU) ==")
convs = nn.ModuleList(nn.Conv2d(8, 8, 3, padding=1) for _ in range(30))
for name, residual in [("plain    h = relu(conv(h))    ", False), ("residual h = h + conv(relu(h))", True)]:
    x = torch.randn(1, 8, 16, 16, requires_grad=True); h = x
    for c in convs:
        h = h + c(F.relu(h)) if residual else F.relu(c(h))
    h.pow(2).mean().backward()
    print(f"{name}: output std {h.std().item():.2e}  |grad wrt input| {x.grad.norm().item():.2e}")
```

</details>

Reading it, block by block:
- **Output sizes:** `nn.Conv2d` agrees with `floor((n + 2p − k)/s) + 1` in all seven cases. `n = 8`, `k = 3`, `s = 3` gives 2: the windows start at columns 0 and 3, and columns 6 and 7 are never read, because the formula rounds down. `MaxPool2d(2)` halves 32 × 32 to 16 × 16 with zero parameters.
- **Receptive field:** one 3 × 3 layer sees 3 × 3 pixels, two see 5 × 5, three 7 × 7, five 11 × 11: `1 + 2·L` for `L` stride-1 layers. With a stride-2 layer first, two layers already see 7 × 7, and `s2 → s2 → s1` sees 15 × 15: downsampling early lets few layers see much of the image.
- **Gradient through 30 layers:** with PyTorch's default init and ReLU, the plain stack shrinks the output to a standard deviation (std) of 0.022 and the gradient reaching the input to `4e-17`, which is useless. The residual stack keeps the gradient at 10.3, because every block's derivative contains the identity from the `+ h`. Its output std grows to 6.5; real ResNet blocks also put batch normalization after each convolution ✅[^10].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Stride does not divide `n + 2p − k` (`n = 8`, `k = 3`, `s = 3`) | Output 2; the last 2 columns are never used | The formula floors ✅[^3]; lab ✅[^8] |
| `padding='same'` with `stride=2` | Not supported | Documented restriction ✅[^3] |
| Formula copied from d2l into PyTorch code | Off by a factor of 2 in `p` | d2l's `p_h` is total padding ✅[^5]; PyTorch's is per side ✅[^3] |
| Even kernel size | Cannot pad the same amount on both sides; d2l pads `ceil(p_h/2)` on top, `floor(p_h/2)` at the bottom | Odd kernels allow symmetric padding ✅[^5] |
| A hand-designed filter from signal processing | Applied flipped compared with its textbook definition | `Conv2d` computes cross-correlation ✅[^3]; true convolution flips the kernel ✅[^2] |
| `MaxPool2d(..., ceil_mode=True)` | Output size rounds up instead of down | Documented option ✅[^7] |
| Residual add when channels or size change | Shape mismatch error | Needs a projection shortcut (a 1 × 1 convolution) or a zero-padded identity ✅[^9] |
| Data without translation structure | The convolution's built-in assumption can make even fitting the training set hard | Inductive bias ✅[^1] |
| Very deep plain network | Higher training error than a shallower one | Degradation ✅[^9]; lab gradient `4e-17` after 30 layers ✅[^8] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Convolution instead of dense | Parameters per layer independent of image size (1,792 vs 201,392,128 in the lab) ✅[^8] | Locality and translation invariance are assumed ✅[^1] |
| Two stacked 3 × 3 layers vs one 5 × 5 | Same 5 × 5 receptive field ✅[^8] with `2·9 = 18` instead of 25 weights per channel pair, and a nonlinearity between | One more layer of activations to store ✅[^11] |
| Stride or pooling early | Receptive field grows faster ✅[^6] ✅[^8]; smaller maps | Coarser maps ✅[^6]; a stride that does not fit the size skips edge pixels ✅[^3] |
| Max vs average pooling | Average combines adjacent pixels for a better signal-to-noise ratio ✅[^6] | d2l finds max pooling preferable in almost all cases, for its invariance ✅[^6] |
| Residual connections | Train 152-layer networks; no extra parameters for identity shortcuts ✅[^9] | Shapes must match, or a projection or zero-padded shortcut is needed ✅[^9] |

## Takeaways
- Compute every layer's output size with `floor((n + 2p − k)/s) + 1` (PyTorch padding is per side) before writing the model, and check it with one dummy forward pass. [rule-candidate]
- Use odd kernels with `padding = k // 2` to keep sizes at stride 1; downsample on purpose with stride or pooling.
- Count parameters with `sum(p.numel() for p in model.parameters())`; construct huge layers on `device="meta"` to count without allocating memory.
- For networks deeper than a few tens of layers, add residual connections (with normalization) instead of stacking plain layers. [rule-candidate]

## Verification status
- Verified: 62 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [From Fully Connected Layers to Convolutions (Dive into Deep Learning, 7.1)](https://d2l.ai/chapter_convolutional-neural-networks/why-conv.html) — Zhang, Lipton, Li, Smola, living. Backs: `10^9` parameters for a dense layer, translation invariance, locality and `4·Δ²`, the inductive-bias price. [^1]
- [Convolutions for Images (Dive into Deep Learning, 7.2)](https://d2l.ai/chapter_convolutional-neural-networks/conv-layer.html) — Zhang, Lipton, Li, Smola, living. Backs: sliding-window cross-correlation and the 19/25/37/43 example, cross-correlation vs flipped convolution, receptive-field definition. [^2]
- [torch.nn.Conv2d](https://docs.pytorch.org/docs/2.15/generated/torch.nn.Conv2d.html) — PyTorch, 2026 (2.15). Backs: cross-correlation definition, channel sum, weight shape, output-size formula, per-side padding, `padding='same'` stride restriction. [^3]
- [Multiple Input and Multiple Output Channels (Dive into Deep Learning, 7.4)](https://d2l.ai/chapter_convolutional-neural-networks/channels.html) — Zhang, Lipton, Li, Smola, living. Backs: 1 × 1 convolution as a per-pixel dense layer. [^4]
- [Padding and Stride (Dive into Deep Learning, 7.3)](https://d2l.ai/chapter_convolutional-neural-networks/padding-and-strides.html) — Zhang, Lipton, Li, Smola, living. Backs: `n − k + 1`, 240 → 200, total-padding formula, odd kernels and symmetric padding, even-kernel rule. [^5]
- [Pooling (Dive into Deep Learning, 7.5)](https://d2l.ai/chapter_convolutional-neural-networks/pooling.html) — Zhang, Lipton, Li, Smola, living. Backs: no parameters, max and average, per-channel pooling, default stride equals window, shift invariance, faster receptive-field growth. [^6]
- [torch.nn.MaxPool2d](https://docs.pytorch.org/docs/2.15/generated/torch.nn.MaxPool2d.html) — PyTorch, 2026 (2.15). Backs: `stride` defaults to `kernel_size`, `ceil_mode`. [^7]
- `machine-learning/lab-setup.md` — the lab where the cross-correlation, output sizes, parameter counts, receptive fields and plain-vs-residual gradients ran on 2026-11-24. [^8]
- [Deep Residual Learning for Image Recognition](https://arxiv.org/html/1512.03385v1) — He, Zhang, Ren, Sun, 2015. Backs: degradation problem, residual formulation, parameter-free identity shortcuts, zero-padding and projection shortcuts, 152 layers, bottleneck blocks for ResNet-50/101/152. [^9]
- [Residual Networks (ResNet) and ResNeXt (Dive into Deep Learning, 8.6)](https://d2l.ai/chapter_convolutional-modern/resnet.html) — Zhang, Lipton, Li, Smola, living. Backs: residual mapping `f(x) − x`, identity by zero weights, ResNet block layout with batch norm. [^10]
- [Forward Propagation, Backward Propagation, and Computational Graphs (Dive into Deep Learning, 5.3)](https://d2l.ai/chapter_multilayer-perceptrons/backprop.html) — Zhang, Lipton, Li, Smola, living. Backs: stored intermediates grow with the number of layers. [^11]

## Related
- `machine-learning/deep-learning/neural-networks-and-backpropagation.md` — dense layers and the backward pass that convolutions specialize.
- `machine-learning/deep-learning/activations-and-initialization.md` — why the plain stack's gradient vanished.
- `machine-learning/deep-learning/normalization-and-dropout.md` — batch norm per channel, used in every ResNet block.
- `machine-learning/deep-learning/recurrent-networks.md` — parameter sharing over time instead of space.
- `machine-learning/transformers/attention-and-the-transformer.md` — residual connections reused in the transformer block.
