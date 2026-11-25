---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/transformers
status: verified
applies-to: ["any", "PyTorch 2.15.0 (the scaled_dot_product_attention and MultiheadAttention details)"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [machine-learning, transformers, attention, self-attention, multi-head-attention, causal-mask, positional-encoding, rope, layer-norm, pre-ln]
---

# Attention and the transformer block

## Summary
**TL;DR:** Attention lets every token build its new representation as a weighted average of other tokens' "values", with weights from how well its "query" matches their "keys": `softmax(Q·Kᵀ / √d_k)·V`. Dividing by `√d_k` keeps the scores at unit spread so the softmax does not saturate. A transformer block is multi-head attention plus a per-token feed-forward network, each wrapped in a residual connection and a layer normalization; decoders add a causal mask so a token cannot see later tokens. Attention itself ignores order, so positions are injected, by adding sinusoids or by rotating queries and keys (RoPE, rotary position embedding).
**Use this when:** you need to read or write attention code, check a mask, count a model's parameters, or understand why √d_k, multi-head, pre-LN (layer normalization before each sub-layer) or RoPE exist.
**Not this doc:** how text becomes token ids → `machine-learning/transformers/tokenization.md`; layer normalization itself → `machine-learning/deep-learning/normalization-and-dropout.md`; the KV (key–value) cache used at generation time → `machine-learning/transformers/decoding-and-kv-cache.md`.

## Problem
A recurrent network reads a sentence one token at a time, so a layer needs `O(n)` sequential steps for `n` tokens and information from far-away tokens travels through many steps; a self-attention layer connects all positions with a constant number of sequential operations ✅[^1]. The price is that the plain mechanism has sharp edges: unscaled scores saturate the softmax, a decoder trained without a mask can read the answer it is supposed to predict, the mechanism cannot tell word order, and the original placement of layer normalization makes training depend on a learning-rate warm-up. Each part of the block exists to fix one of these.

## Mental model
**Analogy:** a library lookup. Each token writes a question (query), every token also puts a label on its shelf (key) and has some content (value). A token compares its question with every label, turns the match scores into percentages, and leaves with that blend of contents. A causal mask is a rule that you may only read shelves to your left. Multi-head attention is several librarians asking differently phrased questions at once.

**Artifact:** the causal attention weights for 4 tokens, one head, width 8 (printed by the full script in the Worked example); lab run (`machine-learning/lab-setup.md`), 2026-11-24, PyTorch 2.15.0 on the CPU (central processing unit) ✅[^9]:

```text
causal attention weights (row = query, column = key):
 tensor([[1.000, 0.000, 0.000, 0.000],     # token 0 can only see itself
        [0.402, 0.598, 0.000, 0.000],
        [0.377, 0.588, 0.035, 0.000],
        [0.088, 0.131, 0.684, 0.098]])     # each row sums to 1; zeros above the diagonal
```

## How it works
**Symbols:** `n` = number of tokens; `d_model` = width of each token vector (512 in the original model); `h` = number of heads; `d_k` = width of one query/key (`d_model / h` = 64 in the original); `Q`, `K`, `V` = matrices with one query, key, value row per token ✅[^1].

### Scaled dot-product attention, step by step
1. **Project:** each token vector `x` is multiplied by learned matrices to give its query `q = x·W_Q`, key `k = x·W_K` and value `v = x·W_V` ✅[^1].
2. **Score:** the dot product of each query with every key, divided by `√d_k`: `scores = Q·Kᵀ / √d_k`, an `n × n` table ✅[^1].
3. **Mask (decoders):** set the scores of forbidden pairs to `−∞`; for a causal mask, every key to the right of the query ✅[^1]. PyTorch's reference code builds it as a lower-triangular `ones(L, S).tril()` boolean matrix ✅[^4].
4. **Normalize:** softmax along each row turns scores into weights that sum to 1 (`−∞` becomes weight 0) ✅[^1].
5. **Mix:** the output for each token is its weights times `V`: `Attention(Q, K, V) = softmax(Q·Kᵀ / √d_k)·V` ✅[^1].

**Why `√d_k`.** If the entries of `q` and `k` are independent with mean 0 and variance 1, then `q·k` (a sum of `d_k` products) has mean 0 and variance `d_k`; the authors suspected that large dot products push the softmax into regions with extremely small gradients, and scale by `1/√d_k` to counteract it ✅[^1]. Lab run (same script), 10,000 random queries against 16 keys each; "mean |Jacobian|" is the average size of the softmax's derivative, the signal the scores get during training ✅[^9]:

```text
d_k=  4 unscaled score std=  2.00  mean max weight=0.428  mean |Jacobian|=0.3226
d_k=  4 scaled   score std=  1.00  mean max weight=0.236  mean |Jacobian|=0.2973
d_k= 64 unscaled score std=  8.01  mean max weight=0.850  mean |Jacobian|=0.1716
d_k= 64 scaled   score std=  1.00  mean max weight=0.248  mean |Jacobian|=0.3047
d_k=512 unscaled score std= 22.67  mean max weight=0.946  mean |Jacobian|=0.0722
d_k=512 scaled   score std=  1.00  mean max weight=0.247  mean |Jacobian|=0.3055
```

The unscaled spread grows as `√d_k` (2, 8, 22.7); at `d_k = 512` one key takes 94.6 % of the weight on average and the derivative shrinks to a quarter of the scaled value. At `d_k = 4` scaling changes little ✅[^9], consistent with the paper's note that for small `d_k` unscaled dot-product attention performs similarly to additive attention and falls behind it only for larger `d_k` ✅[^1].

### Multi-head attention
Instead of one attention over `d_model`-wide vectors, project `h` times with different learned matrices to width `d_k`, run attention on each head in parallel, concatenate the `h` outputs and multiply by `W_O` ✅[^1]. The paper's reason: different heads can attend to different representation subspaces, which one averaged head cannot ✅[^1]. Because each head is `d_model / h` wide, the total cost is similar to one full-width head ✅[^1]. In PyTorch, `nn.MultiheadAttention` splits `embed_dim` across `num_heads` (each head `embed_dim // num_heads` wide) ✅[^5].

### The block: residuals, layer normalization, feed-forward network
- **FFN (feed-forward network):** two linear layers with a ReLU (rectified linear unit) between, `FFN(x) = max(0, x·W1 + b1)·W2 + b2`, applied to each position separately; inner width `d_ff = 2048` in the original ✅[^1].
- **Post-LN (original):** each sub-layer's output is `LayerNorm(x + Sublayer(x))` ✅[^1].
- **Pre-LN:** the normalization moves inside the residual branch, `x + Sublayer(LayerNorm(x))`, plus one final LayerNorm before the output ✅[^3]. Xiong et al. show that with Post-LN the expected gradients near the output layer are large at initialization, so a large learning rate makes training unstable and a warm-up helps; with Pre-LN gradients are well-behaved and the warm-up could be removed in their experiments ✅[^3]. GPT-2 (Generative Pre-trained Transformer 2) adopted pre-normalization ✅[^7]. PyTorch exposes the choice as `norm_first=True` in `nn.TransformerEncoderLayer` ✅[^6].

### Positions
Without a position signal, self-attention gives the same outputs, permuted, for a permuted input (lab: difference `5.96e-08`, float rounding) ✅[^9]. Two ways to add order:
- **Sinusoidal (added):** `PE(pos, 2i) = sin(pos / 10000^(2i/d_model))`, `PE(pos, 2i+1) = cos(…)`, added to the input embeddings; `PE` is the positional encoding, `pos` the position, `i` the dimension pair. Learned position embeddings gave nearly identical results in the paper ✅[^1].
- **RoPE (rotary position embedding, multiplied):** rotate each 2-D pair `(2i, 2i+1)` of the query and key by angle `position × θ_i`, with `θ_i = 10000^(−2(i−1)/d)` for `i = 1 … d/2`; the dot product of a rotated query and key then depends on the content and the offset `m − n` only ✅[^2]. Lab, width 64 ✅[^9]:

```text
q at    5, k at    3 (offset 2): score = -19.808741
q at   12, k at   10 (offset 2): score = -19.808741
q at 1005, k at 1003 (offset 2): score = -19.808741
q at    5, k at    1 (offset 4): score = -17.232870
```

### Three layouts
The original transformer is an encoder (self-attention over the whole input) plus a decoder (causal self-attention, then cross-attention whose queries come from the decoder and keys and values from the encoder output) ✅[^1]. Encoder-only models (BERT, Bidirectional Encoder Representations from Transformers) let all tokens see each other; decoder-only models drop the encoder and the cross-attention and are the usual design for large language models ✅[^7].

## Worked example
One attention head computed by hand, then compared with PyTorch; then two heads by hand against `nn.MultiheadAttention`; then a block's parameters counted by formula. Core lines:

```python
scores = q @ k.T / math.sqrt(d)
causal = torch.ones(L, L, dtype=torch.bool).tril()
w = torch.softmax(scores.masked_fill(~causal, float("-inf")), dim=-1)
hand_c = w @ v
sdpa_c = F.scaled_dot_product_attention(q[None], k[None], v[None], is_causal=True)[0]
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-24, PyTorch 2.15.0 CPU, two runs identical ✅[^9]:

```text
max |hand - sdpa|  causal: 5.960464477539063e-08  full: 1.1920928955078125e-07
causal: change token 3 -> rows 0..2 change by 0.0  row 3 by 0.765
max |hand - nn.MultiheadAttention|: 0.0
formula: 1050624 + 2099712 + 2048 = 3152384 | sum(p.numel()): 3152384
```

<details><summary>Full script (prints the output above)</summary>

```python
# Attention by hand vs PyTorch, the sqrt(d_k) scaling, multi-head by hand, a block's parameter count, RoPE.
import math, torch, torch.nn as nn, torch.nn.functional as F
torch.manual_seed(0)
torch.set_printoptions(precision=3, sci_mode=False)

print("== 1. one head by hand vs F.scaled_dot_product_attention ==")
L, d = 4, 8                                   # 4 tokens, width 8
x = torch.randn(L, d)
Wq, Wk, Wv = (torch.randn(d, d) / math.sqrt(d) for _ in range(3))
q, k, v = x @ Wq, x @ Wk, x @ Wv
scores = q @ k.T / math.sqrt(d)               # (L, L): row i = how well query i matches each key
causal = torch.ones(L, L, dtype=torch.bool).tril()
w = torch.softmax(scores.masked_fill(~causal, float("-inf")), dim=-1)
print("causal attention weights (row = query, column = key):\n", w)
hand_c = w @ v
sdpa_c = F.scaled_dot_product_attention(q[None], k[None], v[None], is_causal=True)[0]
hand_f = torch.softmax(scores, dim=-1) @ v
sdpa_f = F.scaled_dot_product_attention(q[None], k[None], v[None])[0]
print("max |hand - sdpa|  causal:", (hand_c - sdpa_c).abs().max().item(), " full:", (hand_f - sdpa_f).abs().max().item())
x2 = x.clone(); x2[3] += 10.0                 # change only the LAST token
q2, k2, v2 = x2 @ Wq, x2 @ Wk, x2 @ Wv
out2 = F.scaled_dot_product_attention(q2[None], k2[None], v2[None], is_causal=True)[0]
print("causal: change token 3 -> rows 0..2 change by", (out2[:3] - sdpa_c[:3]).abs().max().item(),
      " row 3 by", round((out2[3] - sdpa_c[3]).abs().max().item(), 3))

print("\n== 2. why divide by sqrt(d_k): 10,000 queries x 16 keys, unit-variance entries ==")
for dk in [4, 64, 512]:
    qq, kk = torch.randn(10000, dk), torch.randn(10000, 16, dk)
    s = torch.einsum("nd,nkd->nk", qq, kk)
    for name, sc in [("unscaled", s), ("scaled  ", s / math.sqrt(dk))]:
        p = torch.softmax(sc, dim=-1)
        jac = torch.diag_embed(p) - p[:, :, None] * p[:, None, :]   # d softmax / d scores
        print(f"d_k={dk:3d} {name} score std={sc.std().item():6.2f}  mean max weight={p.max(-1).values.mean().item():.3f}"
              f"  mean |Jacobian|={jac.flatten(1).norm(dim=1).mean().item():.4f}")

print("\n== 3. multi-head attention by hand vs nn.MultiheadAttention ==")
E, H = 8, 2
mha = nn.MultiheadAttention(E, H, batch_first=True)
xb = torch.randn(1, L, E)
ref, _ = mha(xb, xb, xb, need_weights=False)
Wq3, Wk3, Wv3 = mha.in_proj_weight.chunk(3); bq, bk, bv = mha.in_proj_bias.chunk(3)
split = lambda t: t.view(1, L, H, E // H).transpose(1, 2)          # (batch, heads, L, d_head)
heads = F.scaled_dot_product_attention(split(xb @ Wq3.T + bq), split(xb @ Wk3.T + bk), split(xb @ Wv3.T + bv))
mine = mha.out_proj(heads.transpose(1, 2).reshape(1, L, E))         # concat heads, then W_O
print("max |hand - nn.MultiheadAttention|:", (mine - ref).abs().max().item())

print("\n== 4. parameters of one pre-LN encoder block, d_model=512, 8 heads, d_ff=2048 ==")
dm, dff = 512, 2048
block = nn.TransformerEncoderLayer(dm, 8, dff, norm_first=True, batch_first=True)
attn = 4 * dm * dm + 4 * dm                   # W_Q, W_K, W_V, W_O and their biases
ffn = dm * dff + dff + dff * dm + dm          # two linear layers with biases
norms = 2 * 2 * dm                            # two LayerNorms, gamma and beta each
print("formula:", attn, "+", ffn, "+", norms, "=", attn + ffn + norms,
      "| sum(p.numel()):", sum(p.numel() for p in block.parameters()))

print("\n== 5. RoPE: rotated q.k depends only on the offset m - n (float64) ==")
def rope(t, pos):                             # rotate pair (2i, 2i+1) by angle pos * theta_i
    dd = t.shape[-1]
    theta = 10000.0 ** (-torch.arange(0, dd, 2, dtype=torch.float64) / dd)
    c, s_ = torch.cos(pos * theta), torch.sin(pos * theta)
    a, b = t[0::2], t[1::2]
    return torch.stack([a * c - b * s_, a * s_ + b * c], -1).flatten()
qv, kv = torch.randn(64, dtype=torch.float64), torch.randn(64, dtype=torch.float64)
for m, n in [(5, 3), (12, 10), (1005, 1003), (5, 1)]:
    print(f"q at {m:4d}, k at {n:4d} (offset {m - n}): score = {rope(qv, m) @ rope(kv, n):.6f}")
print("norm kept:", round(qv.norm().item(), 6), round(rope(qv, 1005).norm().item(), 6))

print("\n== 6. no positions: self-attention ignores order (permute in -> permute out) ==")
perm = torch.tensor([2, 0, 3, 1])
xp = x[perm]
outp = F.scaled_dot_product_attention((xp @ Wq)[None], (xp @ Wk)[None], (xp @ Wv)[None])[0]
print("max |out(permuted x) - permuted out(x)|:", (outp - sdpa_f[perm]).abs().max().item())

print("\n== 7. a query row whose keys are ALL masked ==")
allowed = causal.clone(); allowed[2] = False  # query 2 may attend to nothing
print(F.scaled_dot_product_attention(q[None], k[None], v[None], attn_mask=allowed)[0][2])
print("by hand (softmax of a row of -inf):", torch.softmax(scores.masked_fill(~allowed, float("-inf")), dim=-1)[2])
```

</details>

Reading it line by line:
- **Hand = PyTorch.** The hand-written formula and `F.scaled_dot_product_attention` agree to `6e-08` (causal) and `1.2e-07` (no mask), float32 rounding; PyTorch documents its reference code as the same five steps ✅[^4] ✅[^9].
- **The causal mask works.** Changing only the last token moves the last output row by 0.765 and the first three rows by exactly 0.0: earlier tokens never saw it ✅[^9].
- **Multi-head = split, attend, concatenate, project.** Slicing `nn.MultiheadAttention`'s packed `in_proj_weight` into `W_Q`, `W_K`, `W_V`, running two 4-wide heads and applying `out_proj` reproduces the module's output exactly ✅[^9].
- **Parameter count.** With `d_model = 512`, `d_ff = 2048`: attention `4·d² + 4·d = 1,050,624` (four `d × d` matrices plus biases), FFN `2·d·d_ff + d_ff + d = 2,099,712`, two LayerNorms `2 × 2·d = 2,048` (a scale γ and shift β per feature ✅[^8]); total 3,152,384, equal to `sum(p.numel())` ✅[^9]. The FFN holds two thirds of the block.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Boolean mask moved from `nn.MultiheadAttention` to `F.scaled_dot_product_attention` | Mask meaning flips: in SDPA (scaled dot-product attention) `True` = may attend; in MHA (multi-head attention) `True` = masked out | Opposite conventions; invert with `~mask` ✅[^4] ✅[^5] |
| `is_causal=True` with fewer queries than keys | The mask is `ones(L, S).tril()`, aligned to the top-left: query 0 sees only key 0 | Reference code builds it that way ✅[^4]; matters when decoding with a cache (`machine-learning/transformers/decoding-and-kv-cache.md`) |
| A query whose keys are all masked | Hand-written softmax gives `nan`; PyTorch 2.15 SDPA on CPU returned zeros in the lab | Softmax of a row of `−∞` is 0/0 ✅[^9] |
| `dropout_p > 0` at evaluation time | SDPA still drops attention weights | It always applies `dropout_p`; pass `0.0` when not training ✅[^4] |
| `nn.MultiheadAttention` fed `(batch, seq, feature)` | Wrong axes silently | `batch_first` defaults to `False` ✅[^5] |
| Same inputs, different backend kernel | Outputs differ slightly | Fused kernels round differently ✅[^4] |
| Small `d_k` | Scaling barely matters | Score spread is only `√d_k` ✅[^1]; lab `d_k = 4`: Jacobian 0.32 vs 0.30 ✅[^9] |
| Post-LN trained without warm-up | Training can be unstable | Large gradients near the output at initialization ✅[^3] |
| No positional signal | Word order invisible | Permutation-equivariant (lab `6e-08`) ✅[^9] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Post-LN (original) | The paper's published results ✅[^1] | Needs a warm-up stage, sensitive to its length ✅[^3] |
| Pre-LN | Well-behaved gradients at initialization; warm-up removable in Xiong et al.'s runs ✅[^3] | An extra final LayerNorm ✅[^3] |
| Sinusoidal positions | No parameters; may extrapolate to longer sequences (the authors' hope) ✅[^1] | Added to the embedding, so position and meaning share one vector of the same width ✅[^1] |
| Learned positions | Nearly identical results to sinusoids in the paper ✅[^1] | Lacks the extrapolation hope that made the authors pick sinusoids ✅[^1] |
| RoPE | Scores depend on relative offset ✅[^2] ✅[^9]; decays with distance ✅[^2] | Applied to queries and keys inside self-attention, not once at the input ✅[^2] |
| More heads at fixed `d_model` | More subspaces ✅[^1] | Each head narrower (`d_model / h`) ✅[^1] |

## Takeaways
- Write attention once by hand and compare it with `F.scaled_dot_product_attention` before trusting a custom mask. [rule-candidate]
- Check the mask convention (`True` = attend or `True` = block) every time you move code between APIs (application programming interfaces). [rule-candidate]
- Count parameters per block as `4·d² + 2·d·d_ff` plus small bias and norm terms; the FFN dominates.
- Prefer Pre-LN for new models trained from scratch; keep a short warm-up if you must use Post-LN.

## Verification status
- Verified: 61 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- [Attention Is All You Need](https://arxiv.org/html/1706.03762v7) — Vaswani et al., 2017. Backs: scaled dot-product attention, the `√d_k` variance argument, multi-head attention, the causal mask, FFN, Post-LN, sinusoidal and learned positions, encoder–decoder, `O(n)` sequential steps for recurrent layers. [^1]
- [RoFormer: Enhanced Transformer with Rotary Position Embedding](https://arxiv.org/html/2104.09864v5) — Su et al., 2021. Backs: rotation of query and key pairs, `θ_i`, relative-offset dependence, long-term decay. [^2]
- [On Layer Normalization in the Transformer Architecture](https://arxiv.org/html/2002.04745v2) — Xiong et al., 2020. Backs: Post-LN vs Pre-LN, large gradients at initialization, warm-up removal, final LayerNorm. [^3]
- [torch.nn.functional.scaled_dot_product_attention](https://docs.pytorch.org/docs/2.15/generated/torch.nn.functional.scaled_dot_product_attention.html) — PyTorch 2.15 docs. Backs: reference code, top-left `tril` causal mask, boolean mask meaning, dropout always applied, backend differences. [^4]
- [torch.nn.MultiheadAttention](https://docs.pytorch.org/docs/2.15/generated/torch.nn.MultiheadAttention.html) — PyTorch 2.15 docs. Backs: per-head width, `batch_first=False` default, `True` masks out. [^5]
- [torch.nn.TransformerEncoderLayer](https://docs.pytorch.org/docs/2.15/generated/torch.nn.TransformerEncoderLayer.html) — PyTorch 2.15 docs. Backs: `norm_first`. [^6]
- [Large-Scale Pretraining with Transformers (Dive into Deep Learning, 11.9)](https://d2l.ai/chapter_attention-mechanisms-and-transformers/large-pretraining-transformers.html) — Zhang, Lipton, Li, Smola, living. Backs: encoder-only, encoder–decoder and decoder-only layouts; GPT-2 adopted pre-normalization. [^7]
- [torch.nn.LayerNorm](https://docs.pytorch.org/docs/2.15/generated/torch.nn.LayerNorm.html) — PyTorch 2.15 docs. Backs: per-element γ and β. [^8]
- `machine-learning/lab-setup.md` — the lab where attention by hand vs PyTorch, the `√d_k` saturation table, multi-head by hand, the parameter count, RoPE and the mask checks ran on 2026-11-24. [^9]

## Related
- `machine-learning/deep-learning/normalization-and-dropout.md` — what LayerNorm computes.
- `machine-learning/deep-learning/optimizers-and-learning-rate-schedules.md` — warm-up and the optimizers it pairs with.
- `machine-learning/deep-learning/recurrent-networks.md` — the sequential models attention replaced.
- `machine-learning/deep-learning/activations-and-initialization.md` — saturation and vanishing gradients in general.
- `machine-learning/foundations/math-notation-reference.md` — softmax and dot product.
- `machine-learning/transformers/tokenization.md` — where the token ids come from.
- `machine-learning/transformers/decoding-and-kv-cache.md` — caching keys and values at generation time.
