---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/deep-learning
status: verified
applies-to: ["PyTorch 2.15.0", "torchvision model table (living page, read 2026-11-24)"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, deep-learning, cnn, architectures, lenet, alexnet, vgg, googlenet, inception, resnet, bottleneck, densenet, mobilenet, depthwise-separable, efficientnet, compound-scaling, convnext, flops, multiply-adds, parameter-count]
---

# Modern CNN architectures: from LeNet to ConvNeXt

## Summary
**TL;DR:** Each landmark CNN (convolutional neural network) changed one main thing: AlexNet scaled LeNet up with ReLU, dropout and GPUs; VGG used only stacked 3 × 3 convolutions; GoogLeNet ran parallel branches and used 1 × 1 convolutions to cut channels; ResNet added identity shortcuts and a 1×1–3×3–1×1 bottleneck; DenseNet concatenated instead of adding; MobileNet split each convolution into a per-channel (depthwise) and a 1 × 1 (pointwise) part; EfficientNet scaled depth, width and resolution together; ConvNeXt rebuilt a ResNet with transformer-era choices. A depthwise-separable 3 × 3 convolution costs `1/N + 1/9` of a standard one (8.4× fewer multiply-adds for 128 channels in the lab), and a bottleneck block on 256 channels costs about as much as a basic block on 64.
**Use this when:** you pick a backbone, read a model table with parameter and FLOP (floating-point operation) columns, estimate a layer's cost by hand, or wonder why a design choice (1 × 1 convolutions, bottlenecks, depthwise convolutions) exists.
**Not this doc:** convolution itself, output sizes, pooling, receptive field and the basic residual block → `machine-learning/deep-learning/convolutional-networks.md`; batch normalization inside these blocks → `machine-learning/deep-learning/normalization-and-dropout.md`; transformers for images → `machine-learning/transformers/vision-transformers.md`; reusing a pretrained backbone → `machine-learning/deep-learning/data-augmentation-and-transfer-learning.md`.

## Problem
Model tables list names, accuracy, parameters and GFLOPS (billions of FLOPs), but not why VGG-16 needs 138.4 M parameters and 15.47 GFLOPS while ResNet-50 is more accurate with 25.6 M and 4.09 ✅[^14]. Without the per-layer arithmetic you cannot tell where a network's cost goes (in the lab, 89.4 % of VGG-16's parameters sit in its three dense layers ✅[^16]), why MobileNet is cheap, or why a cheaper layer is not always proportionally faster (8.4× fewer multiply-adds ran 5.5–7.5× faster on this CPU ✅[^16]). Papers also count cost differently: the ResNet paper's "FLOPs" are multiply-adds ✅[^7].

## Mental model
**Analogy:** a kitchen redesigned over 25 years. LeNet is a home kitchen; AlexNet the same kitchen scaled to a restaurant with better tools (ReLU, GPUs). VGG standardizes on one small knife used many times. GoogLeNet sets up parallel stations and makes everyone pass through a narrow prep counter (1 × 1 convolutions) first. ResNet adds a pass-through hatch so a dish can skip a station. MobileNet splits "chop and mix" into chopping each ingredient alone (depthwise) and then one mixing step (pointwise), far less work. EfficientNet asks how to grow the kitchen: more stations, wider stations and bigger plates, in a fixed ratio.

**Artifact:** one 3 × 3 layer, 128 → 128 channels on a 56 × 56 map, both ways; printed by the full script in the Worked example; lab run (`machine-learning/lab-setup.md`), 2026-11-24, PyTorch 2.15.0 ✅[^16]:

```text
== (1) 3x3 conv, 128 -> 128 channels, 56x56 map: standard vs depthwise-separable ==
standard : params 147,456 | MACs 462,422,016 | output (1, 128, 56, 56)
separable: params  17,536 | MACs  54,992,896 | output (1, 128, 56, 56)
formula: standard DK*DK*M*N*DF*DF = 462,422,016; separable DK*DK*M*DF*DF + M*N*DF*DF = 54,992,896
ratio separable/standard 0.1189 = 1/N + 1/DK^2 = 0.1189
```

MACs are multiply-accumulates (multiply-adds). Same output shape, 8.4 times fewer parameters and multiply-adds.

## How it works
### Counting cost
For a convolution with kernel `D_K × D_K`, `M` input and `N` output channels on a `D_F × D_F` map (stride 1 with padding, so the output map is also `D_F × D_F`), a standard layer costs `D_K·D_K·M·N·D_F·D_F` multiply-adds and its weight has `D_K·D_K·M·N` entries ✅[^10]. The lab's counter (output elements × kernel area × input channels per group) reproduces the formula exactly and the full-network counts in the torchvision table ✅[^16]. Parameter counting and the output-size formula are in `machine-learning/deep-learning/convolutional-networks.md`.

### The lineage
| Model (arXiv year) | What changed | Why | Params / GFLOPS (torchvision) ✅[^14] |
|---|---|---|---|
| LeNet-5 | Two 5 × 5 conv layers with sigmoid and average pooling, then dense 120–84–10 ✅[^1] | Read handwritten digits; later used for ATM deposits ✅[^1] | — |
| AlexNet (2012) | 5 conv + 3 dense layers, 11 × 11 stride-4 first conv, ReLU instead of sigmoid, dropout, heavy augmentation, split over two GPUs ✅[^2] | Won ImageNet 2012 by a large margin ✅[^2] | 61.1 M / 0.71 |
| VGG (2014) | Only 3 × 3 convolutions (stride 1, padding 1) in blocks ending in 2 × 2 max pooling ✅[^3], depth 16–19 weight layers ✅[^4]; the paper's configurations span 11 to 19 weight layers, and one 16-layer variant also uses 1 × 1 convolutions ✅[^4] | Deep and narrow beat shallow ✅[^3]: a deep net of 3 × 3 filters beat a shallow one of 5 × 5 filters ✅[^4] | VGG-16: 138.4 M / 15.47 |
| GoogLeNet / Inception (2014) | Four parallel branches (1 × 1; 1 × 1→3 × 3; 1 × 1→5 × 5; pool→1 × 1) concatenated on channels; 9 blocks; global average pooling head ✅[^5] | Grow depth and width at a fixed compute budget (1.5 billion multiply-adds) ✅[^6] | 6.6 M / 1.5 |
| ResNet (2015) | Identity shortcuts; for 50+ layers, a 1 × 1 → 3 × 3 → 1 × 1 bottleneck ✅[^7] | Train much deeper networks (basics in the convolutional-networks doc) | ResNet-50: 25.6 M / 4.09 |
| DenseNet (2016) | Each layer gets all earlier feature maps, concatenated: `L(L+1)/2` connections ✅[^9] | Feature reuse, fewer parameters, better gradient flow ✅[^9] | DenseNet-121: 8.0 M / 2.83 |
| MobileNet (2017) | Depthwise conv (one filter per input channel) + 1 × 1 pointwise conv ✅[^10] | 8–9× less computation for a small accuracy loss ✅[^10] | v2: 3.5 M / 0.3 |
| EfficientNet (2019) | Searched base network (B0) of MBConv blocks, scaled by one coefficient ✅[^12] | Balanced scaling of depth, width and resolution ✅[^12] | B0: 5.3 M / 0.39; B7: 66.3 M / 37.75 |
| ConvNeXt (2022) | ResNet-50 modernized step by step with ViT-era choices ✅[^13] | Pure ConvNet that beat Swin-T (82.0 vs 81.3 %) ✅[^13] | Tiny: 28.6 M / 4.46 |

### What each step means in detail
1. **AlexNet's cost sits in the dense layers:** in d2l's version, its last two hidden layers alone are a 6400 × 4096 and a 4096 × 4096 weight matrix, 164 MB of memory ✅[^2]. VGG-16 has the same problem: 89.4 % of its 138,357,544 parameters are in the three `Linear` layers (lab) ✅[^16].
2. **VGG's 3 × 3 rule:** two stacked 3 × 3 convolutions touch the same pixels as one 5 × 5 ✅[^3], and three 3 × 3 layers (`3·9·c²` parameters) have about as many parameters as one 5 × 5 (`25·c²`) ✅[^3].
3. **1 × 1 convolutions as reducers:** GoogLeNet uses them mainly as dimension-reduction modules to remove computational bottlenecks ✅[^6], applied to the input in the 3 × 3 and 5 × 5 branches, before the larger convolutions ✅[^5]; the result uses 12 times fewer parameters than AlexNet ✅[^6]. It was arguably the first network with a clear split into stem (first convolutions on the raw image), body (the blocks) and head (task output), a layout that has persisted since ✅[^5].
4. **ResNet's bottleneck:** the first 1 × 1 layer reduces the channels, the 3 × 3 works on the reduced width, the last 1 × 1 restores them; it has a time complexity similar to the two-layer basic block ✅[^7]. ResNet-50 has 3.8 billion FLOPs (multiply-adds), and even ResNet-152 (11.3 billion) is cheaper than VGG-16/19 (15.3/19.6 billion) ✅[^7].
5. **DenseNet's growth rate `k`:** layer `ℓ` receives `k_0 + k·(ℓ − 1)` channels ✅[^9]; each block adds channels, so transition layers (1 × 1 convolution plus stride-2 average pooling) shrink the channels and halve the height and width ✅[^8]. DenseNet-B puts a 1 × 1 producing `4k` maps before each 3 × 3, and DenseNet-BC compresses by `θ = 0.5` in the transitions ✅[^9].
6. **Depthwise-separable cost:** `D_K·D_K·M·D_F·D_F + M·N·D_F·D_F`, a ratio of `1/N + 1/D_K²` to the standard layer ✅[^10]. MobileNet puts batch norm and ReLU after both parts ✅[^10], and offers a width multiplier `α` that thins every layer and a resolution multiplier `ρ` that cuts the cost by about `ρ²` ✅[^10]. MobileNet 1.0-224 reached 70.6 % with 569 M multiply-adds and 4.2 M parameters, against VGG-16's 71.5 % at 15,300 M and 138 M ✅[^10]. In PyTorch, `groups=in_channels` gives each input channel its own filters, a depthwise convolution ✅[^17].
7. **MobileNetV2's inverted residual:** expand with a 1 × 1 (factor 6), filter with a 3 × 3 depthwise, project back with a *linear* 1 × 1; the shortcut joins the thin ends ✅[^11]. The block's last layer is linear because, when the features of interest lie in a low-dimensional subspace, a non-linearity in the narrow layer destroys too much information ✅[^11].
8. **EfficientNet's compound scaling:** depth `d = α^φ`, width `w = β^φ`, resolution `r = γ^φ` with `α·β²·γ² ≈ 2`, so total FLOPs grow by about `2^φ`; a grid search on B0 found `α = 1.2`, `β = 1.1`, `γ = 1.15` ✅[^12]. B0 has 5.3 M parameters and 0.39 B FLOPs at 77.1 % top-1; B7 reached 84.3 %, 8.4× smaller and 6.1× faster at inference than the best earlier ConvNet ✅[^12]. EfficientNets came out of a neural architecture search ✅[^15].
9. **ConvNeXt's recipe:** a modern training recipe alone (AdamW, 300 instead of 90 epochs, augmentation) raised ResNet-50 from 76.1 % to 78.8 % ✅[^13]; then stage block counts (3, 4, 6, 3) → (3, 3, 9, 3), a 4 × 4 stride-4 "patchify" stem, depthwise convolution with width 96, an inverted bottleneck four times wider, a 7 × 7 depthwise kernel moved up, GELU (Gaussian error linear unit) instead of ReLU, fewer activations and norms, LayerNorm instead of BatchNorm, and separate downsampling layers ✅[^13]. It is built entirely from standard ConvNet modules ✅[^13].

## Worked example
Two residual blocks on a 56 × 56 map, and three whole networks at 224 × 224 built with their weights on the `meta` device (shapes only, no memory). Lab run (`machine-learning/lab-setup.md`), 2026-11-24, PyTorch 2.15.0, two runs identical except the timings; output lines 6–15 (lines 1–5 are the Mental model artifact) ✅[^16]:

```text
standard : CPU time per batch of 8 32.22 ms
separable: CPU time per batch of 8 5.87 ms
== (2) residual blocks on a 56x56 map ==
basic, 64 ch (3x3, 3x3)          : params    73,728 | MACs   231,211,008
bottleneck, 256 ch (1x1, 3x3, 1x1): params    69,632 | MACs   218,365,952
basic, 256 ch (3x3, 3x3)         : params 1,179,648 | MACs 3,699,376,128
== (3) whole networks at 224x224 (weights on the meta device: shapes only) ==
VGG-16      : params 138,357,544 (89.4 % in Linear layers) | MACs 15.47 G
ResNet-50   : params  25,557,032 ( 8.0 % in Linear layers) | MACs  4.09 G
MobileNet v1: params   4,231,976 (24.2 % in Linear layers) | MACs  0.57 G
```

<details><summary>Full script (prints the output above)</summary>

```python
# Parameters and multiply-adds (MACs) of a standard vs a depthwise-separable convolution, a basic vs a
# bottleneck residual block, and whole VGG-16 / ResNet-50 / MobileNet v1 built on the meta device (PyTorch, CPU).
import time
import torch
from torch import nn
torch.manual_seed(0)

def params(m):
    return sum(p.numel() for p in m.parameters())

def macs(model, shape):
    """Multiply-adds of every Conv2d and Linear in one forward pass (bias and BN ignored)."""
    total = []
    def hook(mod, inp, out):
        if isinstance(mod, nn.Conv2d):
            k = mod.kernel_size[0] * mod.kernel_size[1] * mod.in_channels // mod.groups
            total.append(out.numel() // out.shape[0] * k)
        elif isinstance(mod, nn.Linear):
            total.append(mod.in_features * mod.out_features)
    hs = [m.register_forward_hook(hook) for m in model.modules() if isinstance(m, (nn.Conv2d, nn.Linear))]
    with torch.no_grad():
        model(torch.zeros(1, *shape, device=next(model.parameters()).device))
    for h in hs: h.remove()
    return sum(total)

print("== (1) 3x3 conv, 128 -> 128 channels, 56x56 map: standard vs depthwise-separable ==")
M, N, DK, DF = 128, 128, 3, 56
std = nn.Conv2d(M, N, DK, padding=1, bias=False)
sep = nn.Sequential(nn.Conv2d(M, M, DK, padding=1, groups=M, bias=False),   # depthwise: 1 filter per channel
                    nn.Conv2d(M, N, 1, bias=False))                          # pointwise: 1x1 mixes channels
for name, m in [("standard ", std), ("separable", sep)]:
    print(f"{name}: params {params(m):>7,} | MACs {macs(m, (M, DF, DF)):>11,} | output {tuple(m(torch.zeros(1, M, DF, DF)).shape)}")
print(f"formula: standard DK*DK*M*N*DF*DF = {DK*DK*M*N*DF*DF:,}; separable DK*DK*M*DF*DF + M*N*DF*DF = {DK*DK*M*DF*DF + M*N*DF*DF:,}")
print(f"ratio separable/standard {macs(sep, (M, DF, DF)) / macs(std, (M, DF, DF)):.4f} = 1/N + 1/DK^2 = {1/N + 1/DK**2:.4f}")
x = torch.randn(8, M, DF, DF)
for name, m in [("standard ", std), ("separable", sep)]:
    with torch.no_grad():
        m(x); t = time.perf_counter()
        for _ in range(20): m(x)
    print(f"{name}: CPU time per batch of 8 {1000 * (time.perf_counter() - t) / 20:.2f} ms")

print("== (2) residual blocks on a 56x56 map ==")
basic = nn.Sequential(nn.Conv2d(64, 64, 3, padding=1, bias=False), nn.Conv2d(64, 64, 3, padding=1, bias=False))
bottle = nn.Sequential(nn.Conv2d(256, 64, 1, bias=False), nn.Conv2d(64, 64, 3, padding=1, bias=False),
                       nn.Conv2d(64, 256, 1, bias=False))
basic256 = nn.Sequential(nn.Conv2d(256, 256, 3, padding=1, bias=False), nn.Conv2d(256, 256, 3, padding=1, bias=False))
for name, m, c in [("basic, 64 ch (3x3, 3x3)          ", basic, 64),
                   ("bottleneck, 256 ch (1x1, 3x3, 1x1)", bottle, 256),
                   ("basic, 256 ch (3x3, 3x3)         ", basic256, 256)]:
    print(f"{name}: params {params(m):>9,} | MACs {macs(m, (c, 56, 56)):>13,}")

print("== (3) whole networks at 224x224 (weights on the meta device: shapes only) ==")
def vgg16():
    layers, c = [], 3
    for v in [64, 64, "M", 128, 128, "M", 256, 256, 256, "M", 512, 512, 512, "M", 512, 512, 512, "M"]:
        if v == "M": layers.append(nn.MaxPool2d(2))
        else: layers += [nn.Conv2d(c, v, 3, padding=1), nn.ReLU()]; c = v
    return nn.Sequential(*layers, nn.Flatten(), nn.Linear(512 * 7 * 7, 4096), nn.ReLU(), nn.Linear(4096, 4096),
                         nn.ReLU(), nn.Linear(4096, 1000))

class Bottleneck(nn.Module):
    def __init__(self, cin, mid, stride):
        super().__init__()
        cout = 4 * mid
        self.body = nn.Sequential(nn.Conv2d(cin, mid, 1, bias=False), nn.BatchNorm2d(mid), nn.ReLU(),
                                  nn.Conv2d(mid, mid, 3, stride, 1, bias=False), nn.BatchNorm2d(mid), nn.ReLU(),
                                  nn.Conv2d(mid, cout, 1, bias=False), nn.BatchNorm2d(cout))
        self.short = (nn.Sequential(nn.Conv2d(cin, cout, 1, stride, bias=False), nn.BatchNorm2d(cout))
                      if stride != 1 or cin != cout else nn.Identity())
    def forward(self, x):
        return torch.relu(self.body(x) + self.short(x))

def resnet50():
    layers, cin = [nn.Conv2d(3, 64, 7, 2, 3, bias=False), nn.BatchNorm2d(64), nn.ReLU(), nn.MaxPool2d(3, 2, 1)], 64
    for mid, n, stride in [(64, 3, 1), (128, 4, 2), (256, 6, 2), (512, 3, 2)]:
        for i in range(n):
            layers.append(Bottleneck(cin, mid, stride if i == 0 else 1)); cin = 4 * mid
    return nn.Sequential(*layers, nn.AdaptiveAvgPool2d(1), nn.Flatten(), nn.Linear(2048, 1000))

def mobilenet_v1():
    def dw(cin, cout, s):
        return [nn.Conv2d(cin, cin, 3, s, 1, groups=cin, bias=False), nn.BatchNorm2d(cin), nn.ReLU(),
                nn.Conv2d(cin, cout, 1, bias=False), nn.BatchNorm2d(cout), nn.ReLU()]
    cfg = [(32, 64, 1), (64, 128, 2), (128, 128, 1), (128, 256, 2), (256, 256, 1), (256, 512, 2)] + \
          [(512, 512, 1)] * 5 + [(512, 1024, 2), (1024, 1024, 1)]
    layers = [nn.Conv2d(3, 32, 3, 2, 1, bias=False), nn.BatchNorm2d(32), nn.ReLU()]
    for cin, cout, s in cfg: layers += dw(cin, cout, s)
    return nn.Sequential(*layers, nn.AdaptiveAvgPool2d(1), nn.Flatten(), nn.Linear(1024, 1000))

with torch.device("meta"):
    nets = [("VGG-16      ", vgg16()), ("ResNet-50   ", resnet50()), ("MobileNet v1", mobilenet_v1())]
for name, net in nets:
    net.eval()
    fc = sum(m.weight.numel() + m.bias.numel() for m in net.modules() if isinstance(m, nn.Linear))
    print(f"{name}: params {params(net):>11,} ({100 * fc / params(net):4.1f} % in Linear layers) | "
          f"MACs {macs(net, (3, 224, 224)) / 1e9:5.2f} G")
```

</details>

Reading it, block by block:
- **Timing:** 8.4× fewer multiply-adds gave 5.5× (this run) and 7.5× (the second run: 32.78 vs 4.35 ms) less CPU time. Multiply-adds predict cost only roughly; measure latency on the target hardware.
- **Bottleneck vs basic:** a bottleneck block on 256 channels (`256·64 + 9·64·64 + 64·256 = 69,632` weights) costs about the same as a basic block on 64 channels (73,728), as the ResNet paper says ✅[^7]; a basic block on 256 channels would cost 17 times more. That is why ResNet-50 can carry 256- to 2048-channel features.
- **Whole networks:** the counts match the torchvision table (138.4 M / 15.47 GFLOPS for VGG-16, 25.6 M / 4.09 for ResNet-50) ✅[^14] and the MobileNet paper (4.2 M, 569 M multiply-adds) ✅[^10], so torchvision's GFLOPS column counts one multiply-add as one operation. ResNet-50's 4.09 G is the 3.8 billion of the paper up to counting details ✅[^7].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Comparing FLOPs across papers | Numbers differ by convention | The ResNet paper counts multiply-adds as FLOPs ✅[^7]; torchvision's column matches multiply-adds (lab) ✅[^16] |
| Fewer multiply-adds, not proportionally faster | 8.4× fewer MACs, 5.5–7.5× faster on CPU | Lab, two runs ✅[^16] |
| Same architecture, new training recipe | ResNet-50 76.13 % (V1 weights) vs 80.858 % (V2) | torchvision table ✅[^14]; ConvNeXt's +2.7 points from the recipe alone ✅[^13] |
| `groups=in_channels` with `out_channels = K·in_channels` | Depthwise convolution with multiplier `K` | Documented ✅[^17] |
| Dense head on a big feature map | Most parameters end up there (VGG-16: 89.4 %) | Lab ✅[^16]; AlexNet's last two dense layers 164 MB ✅[^2]; GoogLeNet's head instead uses global average pooling, shrinking each channel to 1 × 1 before one dense layer ✅[^5] |
| DenseNet without transition layers | Channel count keeps growing | Every block adds `k` per layer ✅[^8] ✅[^9] |
| ReLU after the narrow projection in an inverted residual | Information is lost | Hence the linear bottleneck ✅[^11] |
| Scaling only depth, or only width | Not what EfficientNet recommends | Compound scaling ties the three ✅[^12] |
| Bottleneck ratio in a design-space search | RegNet found ratio 1 (no bottleneck) best | d2l's design-space chapter ✅[^15] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| VGG-style plain 3 × 3 stacks | Reusable blocks; a whole family of similarly parametrized models ✅[^3] | 138.4 M params, 15.47 GFLOPS ✅[^14] |
| Bottleneck blocks | Wide features at basic-block cost ✅[^7]; lab ✅[^16] | More layers per block |
| Depthwise-separable convolutions | `1/N + 1/D_K²` of the cost ✅[^10] | Small accuracy loss ✅[^10]; speedup below the MAC ratio on CPU ✅[^16] |
| DenseNet concatenation | Feature reuse, fewer parameters ✅[^9] | Channels grow; needs transitions ✅[^8] |
| Compound scaling | B7 8.4× smaller than GPipe at 84.3 % ✅[^12] | B7 costs 37.75 GFLOPS ✅[^14] |
| ConvNeXt vs a vision transformer | Standard conv modules, 82.0 vs Swin-T's 81.3 % ✅[^13] | Ported transformer ideas into CNNs at higher compute, per d2l ✅[^15] |

## Takeaways
- Before choosing a backbone, read its parameter and GFLOPS columns side by side with accuracy, and check which weights (training recipe) the accuracy belongs to. [rule-candidate]
- Estimate a convolution's cost as `D_K²·M·N·D_F²` multiply-adds; replace it by depthwise + pointwise for a `1/N + 1/D_K²` share when compute is tight.
- Count a model's parameters and MACs with weights on `device="meta"` and forward hooks; it costs no memory.
- Benchmark latency on the target device: multiply-adds are only a proxy. [rule-candidate]

## Verification status
- Verified: 86 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [Convolutional Neural Networks (LeNet) (Dive into Deep Learning, 7.6)](https://d2l.ai/chapter_convolutional-neural-networks/lenet.html) — Zhang, Lipton, Li, Smola, living. Backs: LeNet-5 layout, handwritten digits, ATM use. [^1]
- [Deep Convolutional Neural Networks (AlexNet) (Dive into Deep Learning, 8.1)](https://d2l.ai/chapter_convolutional-modern/alexnet.html) — Zhang, Lipton, Li, Smola, living. Backs: ImageNet 2012 win, 8 layers, 11 × 11 stride 4, ReLU, dropout, augmentation, two GPUs, 164 MB in the last two hidden layers. [^2]
- [Networks Using Blocks (VGG) (Dive into Deep Learning, 8.2)](https://d2l.ai/chapter_convolutional-modern/vgg.html) — Zhang, Lipton, Li, Smola, living. Backs: VGG block, deep and narrow, two 3 × 3 vs one 5 × 5, parameter comparison, a family of similarly parametrized models. [^3]
- [Very Deep Convolutional Networks for Large-Scale Image Recognition](https://arxiv.org/abs/1409.1556) — Simonyan, Zisserman, 2014 (full text read on ar5iv). Backs: 3 × 3 filters with stride 1 and padding 1, 2 × 2 max pooling, configurations of 11–19 weight layers (C with 1 × 1 layers), 16–19 layers best, deep 3 × 3 net beating a shallow 5 × 5 one. [^4]
- [Multi-Branch Networks (GoogLeNet) (Dive into Deep Learning, 8.4)](https://d2l.ai/chapter_convolutional-modern/googlenet.html) — Zhang, Lipton, Li, Smola, living. Backs: Inception branches, channel concatenation, 9 blocks, global average pooling to 1 × 1 per channel before the dense output layer, stem/body/head. [^5]
- [Going Deeper with Convolutions](https://ar5iv.labs.arxiv.org/html/1409.4842) — Szegedy et al., 2014. Backs: 1 × 1 convolutions as dimension reduction, 1.5 billion multiply-adds budget, 12 times fewer parameters than AlexNet. [^6]
- [Deep Residual Learning for Image Recognition](https://ar5iv.labs.arxiv.org/html/1512.03385) — He, Zhang, Ren, Sun, 2015. Backs: bottleneck design and its similar complexity, ResNet-50 3.8 billion and ResNet-152 11.3 billion FLOPs vs VGG, FLOPs as multiply-adds. [^7]
- [Densely Connected Networks (DenseNet) (Dive into Deep Learning, 8.7)](https://d2l.ai/chapter_convolutional-modern/densenet.html) — Zhang, Lipton, Li, Smola, living. Backs: concatenation, dense blocks, transition layers, growing channels. [^8]
- [Densely Connected Convolutional Networks](https://ar5iv.labs.arxiv.org/html/1608.06993) — Huang, Liu, van der Maaten, Weinberger, 2016. Backs: `L(L+1)/2` connections, advantages, growth rate, DenseNet-B and -BC. [^9]
- [MobileNets: Efficient Convolutional Neural Networks for Mobile Vision Applications](https://ar5iv.labs.arxiv.org/html/1704.04861) — Howard et al., 2017. Backs: depthwise-separable definition and cost formulas, 8–9× saving, BN and ReLU, width and resolution multipliers, 70.6 % / 569 M / 4.2 M vs VGG-16. [^10]
- [MobileNetV2: Inverted Residuals and Linear Bottlenecks](https://ar5iv.labs.arxiv.org/html/1801.04381) — Sandler et al., 2018. Backs: inverted residual, expansion factor 6, linear bottleneck reason. [^11]
- [EfficientNet: Rethinking Model Scaling for Convolutional Neural Networks](https://ar5iv.labs.arxiv.org/html/1905.11946) — Tan, Le, 2019. Backs: compound scaling equations, `α`, `β`, `γ`, MBConv B0, B0 and B7 numbers. [^12]
- [A ConvNet for the 2020s](https://ar5iv.labs.arxiv.org/html/2201.03545) — Liu et al., 2022. Backs: training recipe gain, every modernization step, 82.0 vs 81.3 %, standard modules. [^13]
- [Models and pre-trained weights (torchvision)](https://docs.pytorch.org/vision/stable/models.html) — PyTorch, living (read 2026-11-24). Backs: Acc@1, Params and GFLOPS of every model in the lineage table, ResNet-50 V1 vs V2 weights. [^14]
- [Designing Convolution Network Architectures (Dive into Deep Learning, 8.8)](https://d2l.ai/chapter_convolutional-modern/cnn-design.html) — Zhang, Lipton, Li, Smola, living. Backs: EfficientNet from architecture search, RegNet bottleneck ratio 1, ViT ideas backported at higher cost. [^15]
- `machine-learning/lab-setup.md` — the lab where the standard vs depthwise-separable layer, the residual blocks and the VGG-16 / ResNet-50 / MobileNet v1 counts ran on 2026-11-24 (script: `mllab/modern-cnn-architectures/lab.py`). [^16]
- [Conv2d](https://docs.pytorch.org/docs/2.15/generated/torch.nn.Conv2d.html) — PyTorch, 2026 (2.15). Backs: `groups=in_channels` and depthwise convolution with multiplier `K`. [^17]

## Related
- `machine-learning/deep-learning/convolutional-networks.md` — convolution, output sizes, pooling, receptive field and the basic residual block this lineage builds on.
- `machine-learning/deep-learning/normalization-and-dropout.md` — BatchNorm and LayerNorm in these blocks, dropout in AlexNet.
- `machine-learning/transformers/vision-transformers.md` — the patchify stem and the transformer models ConvNeXt was compared with.
- `machine-learning/deep-learning/data-augmentation-and-transfer-learning.md` — fine-tuning these backbones.
- `machine-learning/learning-theory/no-free-lunch-and-inductive-bias.md` — the locality assumption every CNN makes.
- `machine-learning/ml-systems/model-compression-and-quantization.md` — making a chosen backbone smaller still.
- `machine-learning/deep-learning/neural-architecture-search-and-automl.md` — architectures found by search.
