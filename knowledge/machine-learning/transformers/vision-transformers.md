---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/transformers
status: verified
applies-to: ["PyTorch 2.15.0"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, transformers, vision-transformer, vit, patch-embedding, class-token, position-embeddings, inductive-bias, deit, distillation, swin, windowed-attention, hybrid, unfold]
---

# Vision transformers (ViT): patches as tokens

## Summary
**TL;DR:** A vision transformer cuts an image into fixed-size patches (16 × 16 pixels for ViT-B/16), flattens each patch and maps it linearly to a token vector, which is exactly a convolution whose kernel size and stride both equal the patch size. A learnable class token is prepended, learnable position embeddings are added, and a standard transformer encoder does the rest; the class token's output is classified. A 224 × 224 image becomes 196 patch tokens, and the count grows with the square of the image side. ViT assumes much less about images than a CNN (convolutional neural network), so it needs much more data or strong augmentation and distillation (DeiT) to match one; Swin brings locality back with attention inside small, shifted windows.
**Use this when:** you build or read a ViT patch-embedding layer, compute how many tokens an image size and patch size give, change the input resolution of a pretrained ViT, or choose between a ViT, a CNN, DeiT or Swin for a dataset of a given size.
**Not this doc:** the attention mechanism and the transformer block → `machine-learning/transformers/attention-and-the-transformer.md`; convolutions and their inductive bias → `machine-learning/deep-learning/convolutional-networks.md`; CNN backbones such as ResNet and ConvNeXt → `machine-learning/deep-learning/modern-cnn-architectures.md`; pretraining an encoder without labels (MAE, CLIP) → `machine-learning/deep-learning/embeddings-and-self-supervised-learning.md`.

## Problem
A transformer takes a sequence of token vectors, but an image is a grid of pixels. Treating every pixel as a token makes the sequence huge: self-attention compares every token with every other, so a 224 × 224 image would give over 50,000 tokens. Cutting the image into patches fixes the length (196 tokens, 38,809 attention scores per head in the lab ✅[^7]), but brings its own questions: how patch size and resolution set the cost, what happens to word order (patch order) without position information, and why the same model trails a ResNet when trained on ImageNet alone ✅[^1].

## Mental model
**Analogy:** a jigsaw puzzle read as a sentence. Cut the photo into 196 square pieces, describe each piece with a fixed list of numbers (the patch embedding), write a number on the back of each piece saying where it came from (the position embedding), and add one blank "summary card" that will collect the answer (the class token). The transformer reads the pieces as words of a sentence. Without the numbers on the back, a shuffled puzzle reads the same as the solved one.

**Artifact:** the patch-embedding layer in two equivalent forms; printed by the full script in the Worked example; lab run (`machine-learning/lab-setup.md`), 2026-11-24, PyTorch 2.15.0 ✅[^7]:

```text
== (1) patchify a 3x224x224 image into 16x16 patches ==
patches by reshape: (1, 196, 768) = (batch, N = HW/P^2, P*P*C)
nn.Unfold gives the same tensor: True
== (2) patch embedding: Conv2d(3, 768, kernel=16, stride=16) vs flatten + Linear ==
conv tokens (1, 196, 768) | max |conv - linear| 8.34e-07 | params 590592 = 3*16*16*768 + 768
```

A 16 × 16 patch of 3 channels flattens to `16·16·3 = 768` numbers; `Conv2d` with kernel = stride = 16 and a `Linear` holding the same weights give the same 196 tokens up to float rounding.

## How it works
### From image to tokens
1. **Patches:** an image `H × W × C` is reshaped into `N = HW/P²` flattened patches of `P²·C` values each, and `N` is the effective sequence length of the transformer ✅[^1]. Example: `224·224/16² = 196`.
2. **Linear projection:** each flattened patch is mapped to the model width `D` by a trainable linear projection ✅[^1]. Because the windows of a convolution with kernel = stride = `P` do not overlap, each output is one patch dotted with one filter: d2l implements the patch embedding as a convolution with both kernel size and stride set to the patch size ✅[^2]. PyTorch documents the general form, a convolution equals `Unfold` plus a matrix multiplication ✅[^5]; the lab confirms it for ViT's shapes (difference `8.34e-07`) ✅[^7].
3. **Class token:** a learnable `[class]` embedding is prepended, and its state at the encoder output is the image representation ✅[^1]; it attends to all patches through self-attention ✅[^2]. The classification head is an MLP (multilayer perceptron) with one hidden layer during pretraining and a single linear layer during fine-tuning ✅[^1].
4. **Position embeddings:** learnable 1-D position embeddings are added to the tokens; 2-D-aware variants gave no significant gains ✅[^1] ✅[^2]. Without them, the encoder cannot tell a shuffled image from the original: in the lab the class-token output changed by `3.58e-07` (float rounding) without position embeddings and by `1.55e-02` with them ✅[^7]. Why attention ignores order is explained in `machine-learning/transformers/attention-and-the-transformer.md`.
5. **Encoder:** a standard transformer encoder with normalization applied right before the attention and the MLP (pre-normalization) ✅[^2].

### Sizes and naming
- **Names:** "ViT-L/16" is the Large variant with 16 × 16 patches ✅[^1]. ViT-Base has 12 layers, width 768, about 86 M parameters; Large 24 layers, 1024, 307 M; Huge 32 layers, 1280, 632 M ✅[^1]. torchvision lists `vit_b_16` at 86.6 M parameters and 17.56 GFLOPS (billions of floating-point operations) ✅[^6]; the lab's ViT-B/16 built from PyTorch modules has 86,567,656 ✅[^7].
- **Patch size sets the cost:** the sequence length is inversely proportional to the square of the patch size, so smaller patches are more expensive ✅[^1]: 49 tokens at patch 32, 784 at patch 8 for a 224 × 224 image ✅[^7].
- **Higher resolution:** fine-tuning at a higher resolution keeps the patch size, so the sequence gets longer, and the pretrained position embeddings are interpolated in 2-D to the new grid ✅[^1]: 14 × 14 → 24 × 24 positions, 197 → 577 tokens at 384 × 384 ✅[^7].

### Why ViT needs more data: inductive bias
1. **Less built in:** ViT has much less image-specific inductive bias than a CNN; only the MLP layers are local and translation-equivariant, and apart from cutting patches the architecture adds no image-specific bias ✅[^1]. Transformers lack the translation invariance and locality that convolutions provide ✅[^2]. Inductive bias in general → `machine-learning/learning-theory/no-free-lunch-and-inductive-bias.md`.
2. **The data price:** trained on a mid-sized dataset such as ImageNet without strong regularization, ViT is a few points below ResNets of comparable size; pretrained on ImageNet-21k or JFT-300M it approaches or beats the state of the art: "large scale training trumps inductive bias" ✅[^1]. On ImageNet alone, ViT-Large even underperforms ViT-Base; larger datasets are where the large models shine ✅[^1]. d2l sums the field up as "scalability trumps inductive biases" ✅[^8].
3. **Hybrid:** the patch embedding can instead be applied to patches of a CNN feature map, including 1 × 1 patches ✅[^1]; hybrids slightly beat ViT at small compute budgets, and the difference vanishes for larger models ✅[^1].

### DeiT: a ViT trained on ImageNet only
DeiT (data-efficient image transformers) trains on ImageNet alone, on a single computer in under 3 days, and reaches 83.1 % top-1 (single crop) with the 86 M model ✅[^3]. Two ingredients: strong data augmentation, which the authors find transformers require ✅[^3], and distillation through a **distillation token**, which plays the role of the class token but learns to reproduce the teacher's label, both tokens interacting through attention ✅[^3]. Hard distillation (using the teacher's decision as a true label) works better than soft, and a CNN teacher (RegNetY-16GF) beats a transformer teacher ✅[^3]. The best DeiT model reached 85.2 % ✅[^3].

### Swin: windowed attention and a hierarchy
Swin computes self-attention only inside non-overlapping local windows and shifts the window partition between consecutive layers to connect neighbouring windows ✅[^4]. Global attention costs `Ω(MSA) = 4hwC² + 2(hw)²C` for `h × w` tokens of width `C`, windowed attention `Ω(W-MSA) = 4hwC² + 2M²hwC`, linear in the image size for a fixed window size `M` (7 by default) ✅[^4]. It starts from 4 × 4 patches, and patch-merging layers concatenate each 2 × 2 group of neighbours, giving feature maps at the same resolutions as a typical CNN, so it can replace a CNN backbone in detection and segmentation ✅[^4]. Swin-T reached 81.3 % top-1 on ImageNet-1K ✅[^4]; torchvision lists `swin_t` at 28.3 M parameters and 4.49 GFLOPS ✅[^6].

## Worked example
Token counts, a ViT-B/16 parameter bill, a shuffle test and Swin's formulas, all on the CPU (central processing unit); models are built on the `meta` device when only shapes matter. Lab run (`machine-learning/lab-setup.md`), 2026-11-24, PyTorch 2.15.0, two runs identical; output lines 6–26 (lines 1–5 are the Mental model artifact) ✅[^7]:

```text
== (3) tokens and attention-matrix entries vs image size (patch 16, plus 1 class token) ==
 224x224 :   196 patches, sequence   197, attention scores per head       38,809
 384x384 :   576 patches, sequence   577, attention scores per head      332,929
 512x512 :  1024 patches, sequence  1025, attention scores per head    1,050,625
1024x1024:  4096 patches, sequence  4097, attention scores per head   16,785,409
224x224 with patch 32:   49 patches
224x224 with patch 16:  196 patches
224x224 with patch 14:  256 patches
224x224 with patch  8:  784 patches
not divisible: 230x230, patch 16 -> (14, 14) grid (the last 6 rows and columns are dropped)
== (4) ViT-B/16 parameter count (12 layers, D=768, MLP 3072, 12 heads, 1000 classes) ==
total 86,567,656 | patch embed 590,592 | position 151,296 | per block 7,087,872 | head 769,000
== (5) shuffle the patch order: class-token output with and without position embeddings ==
position embeddings off: max |logits(original) - logits(shuffled)| = 3.58e-07
position embeddings on : max |logits(original) - logits(shuffled)| = 1.55e-02
== (6) fine-tune at 384: interpolate the 14x14 position grid to 24x24 ==
14x14 -> (24, 24) | sequence 197 -> 577
== (7) Swin's cost formulas: global vs 7x7-window attention, C = 96 ==
224x224 image -> 56x56 tokens: global    2.00 G | windowed  0.15 G | ratio  13.8
448x448 image -> 112x112 tokens: global   30.67 G | windowed  0.58 G | ratio  52.8
896x896 image -> 224x224 tokens: global  485.23 G | windowed  2.32 G | ratio 209.0
```

<details><summary>Full script (prints the output above)</summary>

```python
# ViT patch embedding: patchify by reshape, Conv2d(kernel=stride=P) == Unfold + Linear, token counts vs image
# size, ViT-B/16 parameter count, and what position embeddings do for a shuffled patch order (PyTorch, CPU).
import torch
from torch import nn
import torch.nn.functional as F
torch.manual_seed(0)

print("== (1) patchify a 3x224x224 image into 16x16 patches ==")
P, D = 16, 768
img = torch.randn(1, 3, 224, 224)
B, C, H, W = img.shape
patches = img.reshape(B, C, H // P, P, W // P, P).permute(0, 2, 4, 1, 3, 5).reshape(B, (H // P) * (W // P), C * P * P)
print("patches by reshape:", tuple(patches.shape), "= (batch, N = HW/P^2, P*P*C)")
unf = nn.Unfold(kernel_size=P, stride=P)(img).transpose(1, 2)   # (B, L, C*P*P), same (c, i, j) order
print("nn.Unfold gives the same tensor:", torch.equal(unf, patches))

print("== (2) patch embedding: Conv2d(3, 768, kernel=16, stride=16) vs flatten + Linear ==")
conv = nn.Conv2d(3, D, kernel_size=P, stride=P)
lin = nn.Linear(C * P * P, D)
with torch.no_grad():
    lin.weight.copy_(conv.weight.reshape(D, -1)); lin.bias.copy_(conv.bias)
a = conv(img).flatten(2).transpose(1, 2)                        # (B, 196, 768)
b = lin(patches)
print("conv tokens", tuple(a.shape), "| max |conv - linear|", f"{(a - b).abs().max().item():.2e}",
      "| params", sum(p.numel() for p in conv.parameters()), "=", f"{C}*{P}*{P}*{D} + {D}")

print("== (3) tokens and attention-matrix entries vs image size (patch 16, plus 1 class token) ==")
for side in [224, 384, 512, 1024]:
    n = (side // P) ** 2
    print(f"{side:4}x{side:<4}: {n:5} patches, sequence {n + 1:5}, attention scores per head {(n + 1) ** 2:>12,}")
for patch in [32, 16, 14, 8]:
    print(f"224x224 with patch {patch:2}: {(224 // patch) ** 2:4} patches")
print("not divisible: 230x230, patch 16 ->", tuple(conv(torch.zeros(1, 3, 230, 230)).shape[-2:]),
      "grid (the last 6 rows and columns are dropped)")

print("== (4) ViT-B/16 parameter count (12 layers, D=768, MLP 3072, 12 heads, 1000 classes) ==")
class ViT(nn.Module):
    def __init__(self, img=224, patch=16, d=768, depth=12, heads=12, mlp=3072, classes=1000, pos=True):
        super().__init__()
        n = (img // patch) ** 2
        self.embed = nn.Conv2d(3, d, patch, patch)
        self.cls = nn.Parameter(torch.zeros(1, 1, d))
        self.pos = nn.Parameter(torch.randn(1, n + 1, d) * 0.02) if pos else None
        layer = nn.TransformerEncoderLayer(d, heads, mlp, dropout=0.0, activation="gelu", batch_first=True, norm_first=True)
        self.encoder = nn.TransformerEncoder(layer, depth, enable_nested_tensor=False)
        self.norm, self.head = nn.LayerNorm(d), nn.Linear(d, classes)
    def tokens(self, x):
        t = self.embed(x).flatten(2).transpose(1, 2)
        t = torch.cat([self.cls.expand(t.shape[0], -1, -1), t], 1)
        return t + self.pos if self.pos is not None else t
    def forward(self, t):                                       # takes tokens, returns class-token logits
        return self.head(self.norm(self.encoder(t))[:, 0])
with torch.device("meta"):
    vit = ViT()
count = lambda m: sum(p.numel() for p in m.parameters())
print(f"total {count(vit):,} | patch embed {count(vit.embed):,} | position {vit.pos.numel():,} | "
      f"per block {count(vit.encoder.layers[0]):,} | head {count(vit.head):,}")

print("== (5) shuffle the patch order: class-token output with and without position embeddings ==")
for pos in [False, True]:
    torch.manual_seed(0)
    small = ViT(img=32, patch=8, d=64, depth=2, heads=4, mlp=128, classes=10, pos=pos).eval()
    x = torch.randn(1, 3, 32, 32)
    with torch.no_grad():
        t = small.embed(x).flatten(2).transpose(1, 2)           # 16 patch tokens
        perm = torch.randperm(t.shape[1])
        def run(tok):
            tok = torch.cat([small.cls, tok], 1)
            return small(tok + small.pos if pos else tok)
        diff = (run(t) - run(t[:, perm])).abs().max().item()
    print(f"position embeddings {'on ' if pos else 'off'}: max |logits(original) - logits(shuffled)| = {diff:.2e}")

print("== (6) fine-tune at 384: interpolate the 14x14 position grid to 24x24 ==")
grid = torch.randn(1, D, 14, 14)
print("14x14 ->", tuple(F.interpolate(grid, size=(24, 24), mode="bicubic", align_corners=False).shape[-2:]),
      f"| sequence 197 -> {24 * 24 + 1}")

print("== (7) Swin's cost formulas: global vs 7x7-window attention, C = 96 ==")
C_SW, M_W = 96, 7
for side in [224, 448, 896]:
    h = w = side // 4                                          # Swin starts from 4x4 patches
    msa = 4 * h * w * C_SW ** 2 + 2 * (h * w) ** 2 * C_SW      # Omega(MSA)
    wmsa = 4 * h * w * C_SW ** 2 + 2 * M_W ** 2 * h * w * C_SW # Omega(W-MSA)
    print(f"{side}x{side} image -> {h}x{w} tokens: global {msa / 1e9:7.2f} G | windowed {wmsa / 1e9:5.2f} G | ratio {msa / wmsa:5.1f}")
```

</details>

Reading it, block by block:
- **Tokens grow with area:** doubling the side from 512 to 1024 quadruples the patches (1,024 → 4,096) and multiplies the attention scores per head by about 16 (1.05 M → 16.8 M). Halving the patch from 16 to 8 quadruples the tokens (196 → 784).
- **Sizes that do not divide:** 230 × 230 with patch 16 silently gives a 14 × 14 grid, like a 224 × 224 image: `Unfold`'s block count, which the equivalent stride-16 convolution shares, rounds down (`⌊(230 − 16)/16⌋ + 1 = 14`) ✅[^5], and 6 rows and columns of pixels are never seen.
- **Parameter bill:** of ViT-B/16's 86,567,656 parameters, 85.1 M are the 12 encoder blocks (7,087,872 each), the patch embedding is only 590,592 and the 197 position vectors 151,296; the total matches torchvision's 86.6 M ✅[^6].
- **Shuffle test:** without position embeddings the class-token logits are unchanged by shuffling the 16 patches of a small model (difference at float-rounding level); with them they change. Position embeddings are the only place a ViT learns where a patch was.
- **Swin's formulas:** at 224 × 224 (56 × 56 tokens of 4 × 4 pixels, `C = 96`), windowed attention is 13.8× cheaper than global; each doubling of the side makes the global cost about 16× larger and the windowed cost about 4× larger, so the ratio keeps growing.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Image side not divisible by the patch size | Border pixels are dropped silently (lab: 230 → 14 × 14 grid) | `Unfold`'s block count rounds down ✅[^5]; lab ✅[^7] |
| Pretrained ViT fed a larger image | Position embeddings no longer match the token count | Interpolate them in 2-D ✅[^1]; lab 197 → 577 ✅[^7] |
| Position embeddings left out | Shuffled patches give the same class output | Attention is order-blind; lab ✅[^7] |
| ViT trained from scratch on a mid-sized dataset | A few points below a comparable ResNet | Weaker inductive bias ✅[^1] |
| ViT-Large trained on ImageNet only | Worse than ViT-Base | Large models need larger datasets ✅[^1] |
| Smaller patches for finer detail | Quadratically more tokens (784 at patch 8) | `N = HW/P²` ✅[^1]; lab ✅[^7] |
| High-resolution input, global attention | Cost grows with the square of the token count | Swin's `2(hw)²C` term ✅[^4]; lab ✅[^7] |
| DeiT with a transformer teacher | Worse than with a CNN teacher | Reported in DeiT ✅[^3] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Plain ViT | Few image assumptions; scales with data ✅[^1] | Needs large pretraining sets ✅[^1]; 17.56 GFLOPS for B/16 ✅[^6] |
| DeiT | ImageNet only, < 3 days on one machine, 83.1 % ✅[^3] | Strong augmentation and a CNN teacher ✅[^3] |
| Swin | Linear cost in image size; CNN-like feature hierarchy for dense tasks ✅[^4] | Windows and shifting add complexity; locality is built back in ✅[^4] |
| Hybrid CNN + ViT | Slightly better at small budgets ✅[^1] | The gain vanishes for larger models ✅[^1] |
| Smaller patch size | Finer tokens | More tokens and compute ✅[^1] |

## Takeaways
- Implement the patch embedding as `nn.Conv2d(C, D, kernel_size=P, stride=P)` and check that the image side is a multiple of `P`; otherwise border pixels are dropped. [rule-candidate]
- Count tokens as `(H/P)·(W/P) + 1` before choosing a resolution: attention cost grows with its square.
- When changing a pretrained ViT's input resolution, interpolate its position embeddings in 2-D instead of retraining them. [rule-candidate]
- With little data and no large pretrained checkpoint, prefer a CNN or a DeiT-style recipe (strong augmentation, distillation) over training a plain ViT from scratch.

## Verification status
- Verified: 65 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [An Image is Worth 16x16 Words: Transformers for Image Recognition at Scale](https://ar5iv.labs.arxiv.org/html/2010.11929) — Dosovitskiy et al., 2020. Backs: patches and `N = HW/P²`, linear projection, class token and head, 1-D position embeddings, sizes and naming, patch size vs sequence length, 2-D interpolation, inductive bias, data scale, ViT-L vs ViT-B on ImageNet, hybrid. [^1]
- [Transformers for Vision (Dive into Deep Learning, 11.8)](https://d2l.ai/chapter_attention-mechanisms-and-transformers/vision-transformer.html) — Zhang, Lipton, Li, Smola, living. Backs: patch embedding as a convolution with kernel = stride = patch size, `<cls>` token attends to all patches, learnable positional embeddings, pre-normalization, missing translation invariance and locality. [^2]
- [Training data-efficient image transformers & distillation through attention (DeiT)](https://ar5iv.labs.arxiv.org/html/2012.12877) — Touvron et al., 2020. Backs: ImageNet only, < 3 days, 83.1 %, distillation token, hard distillation, CNN teacher, strong augmentation, 85.2 %. [^3]
- [Swin Transformer: Hierarchical Vision Transformer using Shifted Windows](https://ar5iv.labs.arxiv.org/html/2103.14030) — Liu et al., 2021. Backs: shifted non-overlapping windows, complexity formulas and `M = 7`, 4 × 4 patches and patch merging, CNN-like hierarchy, 81.3 %. [^4]
- [torch.nn.Unfold](https://docs.pytorch.org/docs/2.15/generated/torch.nn.Unfold.html) — PyTorch, 2026 (2.15). Backs: sliding blocks, output shape and the floored block count, convolution = Unfold + matrix multiplication. [^5]
- [Models and pre-trained weights (torchvision)](https://docs.pytorch.org/vision/stable/models.html) — PyTorch, living (read 2026-11-24). Backs: `vit_b_16` 86.6 M / 17.56 GFLOPS, `swin_t` 28.3 M / 4.49 GFLOPS. [^6]
- `machine-learning/lab-setup.md` — the lab where patchifying, the conv/linear equivalence, token counts, the ViT-B/16 count, the shuffle test, position interpolation and Swin's formulas ran on 2026-11-24 (script: `mllab/vision-transformers/lab.py`). [^7]
- [Designing Convolution Network Architectures (Dive into Deep Learning, 8.8)](https://d2l.ai/chapter_convolutional-modern/cnn-design.html) — Zhang, Lipton, Li, Smola, living. Backs: "scalability trumps inductive biases". [^8]

## Related
- `machine-learning/transformers/attention-and-the-transformer.md` — the encoder block, attention's cost and why it ignores order.
- `machine-learning/deep-learning/convolutional-networks.md` — locality and translation invariance, the biases ViT gives up.
- `machine-learning/deep-learning/modern-cnn-architectures.md` — ResNet, the patchify stem and ConvNeXt, the CNNs ViT is compared with.
- `machine-learning/learning-theory/no-free-lunch-and-inductive-bias.md` — why less bias means more data.
- `machine-learning/transformers/tokenization.md` — how text is cut into tokens, the counterpart of patches.
- `machine-learning/transformers/pretraining-and-scaling-laws.md` — large-scale pretraining, the regime where ViT shines.
- `machine-learning/deep-learning/embeddings-and-self-supervised-learning.md` — MAE and CLIP, which pretrain ViT encoders without class labels.
- `machine-learning/deep-learning/data-augmentation-and-transfer-learning.md` — the strong augmentation DeiT depends on.
