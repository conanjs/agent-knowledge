---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/transformers
status: verified
applies-to: ["any", "PyTorch 2.15.0", "Hugging Face Transformers docs (main branch, latest stable v5.24.0) read 2026-11-24 for generation defaults and cache classes"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [machine-learning, transformers, decoding, generation, greedy, beam-search, temperature, top-k, top-p, nucleus-sampling, kv-cache, gqa, mqa]
---

# Decoding strategies and the KV cache

## Summary
**TL;DR:** A language model outputs one probability distribution over the vocabulary per step. Decoding is the rule that turns it into a token: greedy takes the most likely token, beam search keeps the `k` best partial sequences, and sampling draws at random. Temperature reshapes the distribution first, top-k keeps the `k` most likely tokens, and top-p keeps the smallest set whose probability reaches `p`. Generating token by token would recompute every earlier token's keys and values at every step. The KV (key–value) cache stores them per layer, so each step processes only the new token. The price is memory, `2 × layers × kv_heads × d_head × tokens × batch × bytes`, which grouped-query and multi-query attention shrink.
**Use this when:** choosing generation settings, debugging repetitive or incoherent output, writing your own generation loop, or sizing GPU (graphics processing unit) memory for long contexts.
**Not this doc:** attention and masks in general → `machine-learning/transformers/attention-and-the-transformer.md`; how the model was trained → `machine-learning/transformers/pretraining-and-scaling-laws.md`.

## Problem
The highest-probability text is not the best text. Beam search and other maximization-based decoding produce output that is "bland, incoherent, or gets stuck in repetitive loops", while pure sampling from the full distribution produces incoherent text ✅[^1]. Generation is also slow, because each new token depends on all previous ones ✅[^4]. Incremental decoding is limited by the memory bandwidth of reloading the large key and value tensors ✅[^5]. A naive loop recomputes everything at every step, a cached loop needs memory that grows with context, and a wrong mask in a hand-written cached loop silently changes the output.

## Mental model
**Analogy:** writing a story one word at a time while consulting a crowd. Greedy always takes the crowd's top vote. Beam search follows the two or three best drafts in parallel. Sampling draws a vote at random; temperature makes the crowd more or less unanimous, and top-k or top-p ignores the fringe voters. The KV cache is the notebook where you wrote down what every earlier word meant, so you never re-read the whole story to add one word.

**Artifact:** one next-token distribution under each knob (printed by the Worked example's full script; lab run, `machine-learning/lab-setup.md`, 2026-11-24, PyTorch 2.15.0 on the CPU (central processing unit)) ✅[^8]:

```text
T=0.5: the:0.692 a:0.254 cat:0.034 dog:0.013 sat:0.005 ran:0.002 on:0.000 .:0.000  entropy=0.813
T=1.0: the:0.471 a:0.286 cat:0.105 dog:0.064 sat:0.039 ran:0.023 on:0.009 .:0.003  entropy=1.398
T=2.0: the:0.299 a:0.233 cat:0.141 dog:0.110 sat:0.086 ran:0.067 on:0.040 .:0.025  entropy=1.831
greedy picks: the
top-k=3  : the:0.547 a:0.331 cat:0.122 dog:0.000 sat:0.000 ran:0.000 on:0.000 .:0.000
top-p=0.9: the:0.509 a:0.309 cat:0.114 dog:0.069 sat:0.000 ran:0.000 on:0.000 .:0.000
```

## How it works
**Symbols:** `u_l` = the logit (unnormalized score) of vocabulary token `l`; `t` = temperature; `P(x | x_1 … x_(i−1))` = the model's next-token probability given the text so far; `|V|` = vocabulary size; `T'` = output length.

### Decoding rules
1. **Greedy:** take the most likely token each step; it is the default in Hugging Face Transformers ✅[^2]. Cost is `O(|V| · T')`, but it can miss the most likely sequence ✅[^3]. On long outputs it tends to repeat itself ✅[^2].
2. **Beam search (beam size `k`):** at every step keep the `k` highest-probability partial sequences out of `k · |V|` extensions ✅[^3]. Rank finished candidates by `(1/L^α) · log P(y_1 … y_L)` with `α` usually 0.75, which stops longer sequences being punished for having more log terms ✅[^3]. Cost is `O(k · |V| · T')`; `k = 1` is greedy ✅[^3]. It suits input-grounded tasks ✅[^2]. In Hugging Face, `num_beams > 1` enables it ✅[^2].
3. **Sampling:** draw from the whole distribution, so every token with non-zero probability can appear; in Hugging Face, `do_sample=True, num_beams=1` ✅[^2].
4. **Temperature:** `p_l = exp(u_l / t) / Σ exp(u_l' / t)`. With `t < 1` the distribution skews toward likely tokens and the tail loses mass ✅[^1]. Lower temperature improved generation quality but cut diversity in the work the nucleus paper cites ✅[^1].
5. **Top-k:** keep the `k` most probable tokens, renormalize, sample ✅[^1]. A fixed `k` fits badly across contexts: too small is bland in flat distributions, too large lets in poor candidates in peaked ones ✅[^1].
6. **Top-p (nucleus):** keep the smallest set `V^(p)` of most probable tokens with total probability `≥ p`, divide their probabilities by that total `p'`, sample ✅[^1]. The set grows and shrinks with the model's confidence ✅[^1].

Hugging Face defaults when a model's `generation_config.json` does not set them: `temperature = 1.0`, `top_k = 50`, `top_p = 1.0` ✅[^9].

### The KV cache, step by step
Four actors: the **prompt**, the **per-layer cache** (a key tensor and a value tensor per layer), the **attention layer**, and the **generation loop**.
1. **Prefill:** run the whole prompt once. Each layer computes keys and values for every prompt token and stores them, shape `[batch, heads, seq_len, d_head]` ✅[^4].
2. **Why it is safe:** with a causal mask, a token's keys and values never change when later tokens arrive, so they can be reused ✅[^4].
3. **Decode step:** feed only the newest token. Each layer computes that token's query, key and value, appends the key and value to its cache, and attends with that one query over all cached keys ✅[^4]. The attention scores have shape `(new_tokens, past + new)`, and the mask must cover past plus new tokens ✅[^4].
4. **Cost:** without a cache, each step recomputes all previous keys and values and its attention cost is quadratic in length. With a cache, each step computes only the current key and value, and attention per step is linear in length, while memory grows linearly ✅[^4].
5. **Training:** caching is for inference only; enabling it during training can cause errors ✅[^4].

**Memory formula:** `bytes = 2 × n_layers × n_kv_heads × d_head × seq_len × batch × bytes_per_element`. The 2 counts keys and values. `n_kv_heads` is the number of key/value heads, which equals the query heads in standard MHA (multi-head attention). Example: 32 layers, 32 KV heads of width 128, 4,096 tokens, batch 1, fp16 (16-bit floating point, 2 bytes) → `2 × 32 × 32 × 128 × 4,096 × 1 × 2 = 2,147,483,648` bytes = 2 GiB (gibibytes, 2^30 bytes), the same again for every extra sequence in the batch.

**Shrinking it.** MQA (multi-query attention) shares one key and value head across all query heads, which cuts the cache and the bandwidth by the number of heads with "only minor quality degradation" ✅[^5] ✅[^6]. GQA (grouped-query attention) uses an intermediate number of key/value heads, one per group of query heads, and reaches quality close to MHA at speed comparable to MQA ✅[^6]. PyTorch's `scaled_dot_product_attention(..., enable_gqa=True)` (experimental in 2.15) repeats each key/value head across its query group, and requires the query head count to be divisible by the KV head count ✅[^7]. Hugging Face also offers offloaded caches (all layers but the current one in CPU memory) and quantized caches ✅[^10].

## Worked example
The full script below runs four parts. Part 1 is the artifact above. Part 2 is greedy vs beam search on a two-step toy model. Part 3 builds a tiny 2-layer causal decoder (width 32, 4 heads, random weights) and generates 10 tokens greedily from a 5-token prompt, once by recomputing the whole sequence each step and once with a KV cache; it then makes one step with the wrong mask. Part 4 is the memory formula. Lab run (`machine-learning/lab-setup.md`), 2026-11-24, PyTorch 2.15.0 CPU, deterministic, two runs identical ✅[^8]:

```text
top-p=0.9 keeps 4 tokens of the peaked distribution, 7 of a flat one
10,000 top-p draws, counts: [5045, 3111, 1134, 710, 0, 0, 0, 0]

== 2. greedy vs beam search (beam size 2), two steps ==
greedy: AA P=0.20
beam  : BA P=0.36, AA P=0.20

== 3. a tiny causal decoder: greedy generation with and without a KV cache ==
generated (no cache): [29, 6, 6, 47, 23, 17, 47, 29, 13, 45]
generated (cache)   : [29, 6, 6, 47, 23, 17, 47, 29, 13, 45]
max |logit diff| over 10 steps: 3.5762786865234375e-07
token positions through the layers: no cache 95 | cache 14
cache after 14 positions: (1, 4, 14, 8) per K per layer; 7168 bytes = formula 7168
1-token step with is_causal=True vs correct mask: max |logit diff| = 0.558

== 4. KV-cache memory = 2 * layers * kv_heads * d_head * seq_len * batch * bytes ==
32 layers, d_head 128, 4,096 tokens, batch 1, fp16, MHA (32 KV heads): 2,147,483,648 bytes = 2,048 MiB
32 layers, d_head 128, 4,096 tokens, batch 1, fp16, GQA (8 KV heads): 536,870,912 bytes = 512 MiB
32 layers, d_head 128, 4,096 tokens, batch 1, fp16, MQA (1 KV head): 67,108,864 bytes = 64 MiB
```

<details><summary>Full script (prints the output above)</summary>

```python
# (1) temperature, top-k and top-p on a fixed logit vector; (2) greedy vs beam search on a toy model;
# (3) a tiny 2-layer causal decoder generating with and without a KV cache; (4) the KV-cache memory formula.
import math, torch, torch.nn as nn, torch.nn.functional as F
torch.manual_seed(0); torch.set_num_threads(1); torch.use_deterministic_algorithms(True)

print("== 1. one next-token distribution ==")
words = ["the", "a", "cat", "dog", "sat", "ran", "on", "."]
logits = torch.tensor([3.0, 2.5, 1.5, 1.0, 0.5, 0.0, -1.0, -2.0])
fmt = lambda p: " ".join(f"{w}:{v:.3f}" for w, v in zip(words, p.tolist()))
for T in [0.5, 1.0, 2.0]:
    p = F.softmax(logits / T, -1)
    print(f"T={T}: {fmt(p)}  entropy={-(p * p.log()).sum():.3f}")
def top_k(p, k):
    keep = torch.zeros_like(p, dtype=torch.bool); keep[p.topk(k).indices] = True
    q = torch.where(keep, p, torch.zeros_like(p)); return q / q.sum()
def top_p(p, thr):                                   # smallest set of most-probable tokens with mass >= thr
    sp, idx = p.sort(descending=True)
    n = int((sp.cumsum(0) < thr).sum()) + 1
    q = torch.zeros_like(p); q[idx[:n]] = p[idx[:n]]; return q / q.sum()
p1 = F.softmax(logits, -1)
print("greedy picks:", words[p1.argmax()])
print("top-k=3  :", fmt(top_k(p1, 3)))
print("top-p=0.9:", fmt(top_p(p1, 0.9)))
flat = F.softmax(torch.tensor([1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3]), -1)
print("top-p=0.9 keeps", int((top_p(p1, 0.9) > 0).sum()), "tokens of the peaked distribution,",
      int((top_p(flat, 0.9) > 0).sum()), "of a flat one")
g = torch.Generator().manual_seed(0)
draws = torch.multinomial(top_p(p1, 0.9), 10000, replacement=True, generator=g)
print("10,000 top-p draws, counts:", torch.bincount(draws, minlength=8).tolist())

print("\n== 2. greedy vs beam search (beam size 2), two steps ==")
P = {(): {"A": 0.5, "B": 0.4, "C": 0.1},
     ("A",): {"A": 0.4, "B": 0.3, "C": 0.3}, ("B",): {"A": 0.9, "B": 0.05, "C": 0.05}, ("C",): {"A": 1.0}}
seq, prob = (), 1.0
for _ in range(2):
    w, pw = max(P[seq].items(), key=lambda kv: kv[1]); seq, prob = seq + (w,), prob * pw
print("greedy:", "".join(seq), f"P={prob:.2f}")
beams = [((), 1.0)]
for _ in range(2):
    cands = [(s + (w,), ps * pw) for s, ps in beams for w, pw in P[s].items()]
    beams = sorted(cands, key=lambda c: -c[1])[:2]
print("beam  :", ", ".join(f"{''.join(s)} P={ps:.2f}" for s, ps in beams))

print("\n== 3. a tiny causal decoder: greedy generation with and without a KV cache ==")
V, D, H, NL, MAXLEN = 50, 32, 4, 2, 64
class Layer(nn.Module):
    def __init__(s):
        super().__init__()
        s.ln1, s.ln2, s.qkv, s.o = nn.LayerNorm(D), nn.LayerNorm(D), nn.Linear(D, 3 * D), nn.Linear(D, D)
        s.ff = nn.Sequential(nn.Linear(D, 4 * D), nn.GELU(), nn.Linear(4 * D, D))
    def forward(s, x, cache, is_causal_flag=False):
        B, T, _ = x.shape
        q, k, v = (t.view(B, T, H, D // H).transpose(1, 2) for t in s.qkv(s.ln1(x)).split(D, -1))
        if cache is not None:                        # append this step's keys/values to the cache
            if "k" in cache: k, v = torch.cat([cache["k"], k], 2), torch.cat([cache["v"], v], 2)
            cache["k"], cache["v"] = k, v
        S = k.shape[2]
        if is_causal_flag:                           # PyTorch's is_causal: tril aligned to the top-left
            a = F.scaled_dot_product_attention(q, k, v, is_causal=True)
        else:                                        # query i sits at absolute position S - T + i
            a = F.scaled_dot_product_attention(q, k, v, attn_mask=torch.ones(T, S, dtype=torch.bool).tril(S - T))
        x = x + s.o(a.transpose(1, 2).reshape(B, T, D))
        return x + s.ff(s.ln2(x))
class TinyDecoder(nn.Module):
    def __init__(s):
        super().__init__()
        s.tok, s.pos = nn.Embedding(V, D), nn.Embedding(MAXLEN, D)
        s.layers, s.ln, s.head = nn.ModuleList(Layer() for _ in range(NL)), nn.LayerNorm(D), nn.Linear(D, V)
        s.rows = 0                                   # how many token positions went through the layers
    def forward(s, ids, start=0, caches=None, is_causal_flag=False):
        s.rows += ids.shape[1]
        x = s.tok(ids) + s.pos(torch.arange(start, start + ids.shape[1]))
        for i, layer in enumerate(s.layers):
            x = layer(x, None if caches is None else caches[i], is_causal_flag)
        return s.head(s.ln(x))[:, -1]                # logits for the next token
m = TinyDecoder().eval()
prompt = torch.randint(V, (1, 5))
with torch.no_grad():
    ids, out_full = prompt.clone(), []               # (a) recompute the whole sequence every step
    for _ in range(10):
        lg = m(ids); out_full.append(lg); ids = torch.cat([ids, lg.argmax(-1, keepdim=True)], 1)
    rows_full, m.rows = m.rows, 0
    caches, out_c = [dict() for _ in range(NL)], []  # (b) prefill once, then one token per step
    lg = m(prompt, 0, caches); out_c.append(lg); ids_c = torch.cat([prompt, lg.argmax(-1, keepdim=True)], 1)
    for _ in range(9):
        lg = m(ids_c[:, -1:], ids_c.shape[1] - 1, caches); out_c.append(lg)
        ids_c = torch.cat([ids_c, lg.argmax(-1, keepdim=True)], 1)
    rows_cache = m.rows
    print("generated (no cache):", ids[0, 5:].tolist())
    print("generated (cache)   :", ids_c[0, 5:].tolist())
    print("max |logit diff| over 10 steps:", max((a - b).abs().max().item() for a, b in zip(out_full, out_c)))
    print("token positions through the layers: no cache", rows_full, "| cache", rows_cache)
    cache_bytes = sum(c["k"].numel() + c["v"].numel() for c in caches) * 4
    print("cache after 14 positions:", tuple(caches[0]["k"].shape), "per K per layer;", cache_bytes, "bytes = formula",
          2 * NL * H * (D // H) * 14 * 1 * 4)
    caches2 = [dict() for _ in range(NL)]; m(ids_c[:, :14], 0, caches2)          # wrong mask on a 1-token step
    wrong = m(ids_c[:, 14:15], 14, caches2, is_causal_flag=True)
    right = m(ids_c[:, 14:15], 14, [dict(k=c["k"][:, :, :14], v=c["v"][:, :, :14]) for c in caches2])
    print("1-token step with is_causal=True vs correct mask: max |logit diff| =", round((wrong - right).abs().max().item(), 3))

print("\n== 4. KV-cache memory = 2 * layers * kv_heads * d_head * seq_len * batch * bytes ==")
for name, kvh in [("MHA (32 KV heads)", 32), ("GQA (8 KV heads)", 8), ("MQA (1 KV head)", 1)]:
    b = 2 * 32 * kvh * 128 * 4096 * 1 * 2
    print(f"32 layers, d_head 128, 4,096 tokens, batch 1, fp16, {name}: {b:,} bytes = {b / 2**20:,.0f} MiB")
```

</details>

Reading it line by line:
- **Knobs (artifact).** Halving the temperature raised `the` from 0.471 to 0.692 and cut entropy from 1.398 to 0.813 nats (natural-log units); doubling it flattened the distribution (entropy 1.831) ✅[^8]. Top-k=3 renormalized the top three to sum to 1 (0.547 + 0.331 + 0.122). Top-p=0.9 kept 4 tokens here (cumulative 0.471, 0.757, 0.862, 0.926), but 7 for a flatter distribution: the nucleus adapts, a fixed `k` does not ✅[^8] ✅[^1]. In 10,000 top-p draws the four excluded tokens never appeared ✅[^8].
- **Greedy is short-sighted.** Greedy takes `A` (0.5), then the best follow-up (0.4): `P(AA) = 0.20`. Beam size 2 also keeps `B` (0.4), whose follow-up `A` has 0.9, and finds `BA` with 0.36 ✅[^8]. That is the "look ahead" beam search offers ✅[^2].
- **Cache = same answer, less work.** Both loops generate the identical 10 tokens, and the logits agree to `3.6e-07` (float32 rounding) ✅[^8]. Without a cache the layers processed 5 + 6 + … + 14 = 95 token positions; with it, 5 for the prefill plus 9 single tokens = 14 ✅[^8].
- **Formula = tensor sizes.** After 14 positions each layer's key cache is `(batch 1, 4 heads, 14 tokens, 8 wide)`. Keys and values of both layers in float32 total 7,168 bytes, exactly `2 × 2 × 4 × 8 × 14 × 1 × 4` ✅[^8].
- **The mask trap.** Passing `is_causal=True` for a 1-token step over 15 cached keys moved the logits by up to 0.558. PyTorch builds that mask as `ones(L, S).tril()` aligned to the top-left, so the single query may see only key 0 ✅[^8] ✅[^7]. The correct mask for new tokens at the end is `tril(diagonal=S − L)`, or no mask at all for one query.
- **Sizing (Part 4).** For the illustrative 32-layer shape at 4,096 tokens in fp16, the cache is 2,048 MiB (mebibytes) with 32 KV heads, 512 MiB with 8 (GQA), and 64 MiB with 1 (MQA) ✅[^8]. That is the reduction by the number of heads that the GQA paper describes ✅[^6].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Greedy or large-beam decoding of long open-ended text | Repetition loops | Maximization-based decoding degenerates ✅[^1]; greedy repeats on long outputs ✅[^2]; a repeated phrase becomes more probable each time ✅[^1] |
| Pure sampling (`top_p = 1`, no top-k, `t = 1`) | Incoherent text | The unreliable low-probability tail gets sampled ✅[^1] |
| Hugging Face sampling with no explicit `top_k` | `top_k = 50` still applies | Default when the model's generation config does not set it ✅[^9] |
| `num_beams=1` with `do_sample=False` | Greedy decoding | `num_beams=1` means no beam search ✅[^9] |
| Custom cached loop with `is_causal=True` | Wrong attention (lab: logits off by 0.558) | Top-left `tril(L, S)` ✅[^7] ✅[^8] |
| Custom cached loop, attention mask shorter than past + new | Mismatched attention | The mask must cover past + new tokens ✅[^4] |
| Cache left on during training | Can error | Caching is for inference only ✅[^4] |
| Sliding-window attention layers | Cache stops growing at the window size | Hugging Face cache behaviour for those layers ✅[^10] |
| Batch of 8 long requests | 8 × the single-sequence cache | `batch` is a factor in the formula ✅[^4] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Greedy | Cheapest, deterministic ✅[^3] | Misses better sequences (lab: 0.20 vs 0.36) ✅[^8]; repeats ✅[^2] |
| Beam search | Higher-probability sequences; good for input-grounded tasks ✅[^2] | `k ×` the work ✅[^3]; degenerate in open-ended generation ✅[^1] |
| Low temperature | Better quality ✅[^1] | Less diversity ✅[^1] |
| Top-k | Cuts the tail ✅[^1] | One `k` fits few contexts ✅[^1] |
| Top-p | Candidate set adapts to confidence ✅[^1] ✅[^8] | Still random: the lab fixed the generator's seed to repeat its draws ✅[^8] |
| KV cache, dynamic (Hugging Face default) | Grows as needed ✅[^10] | Blocks most just-in-time compilation ✅[^10] |
| KV cache, static | Works with `torch.compile` ✅[^10] | Pre-allocates the maximum size ✅[^10] |
| GQA / MQA | Smaller cache, faster decoding ✅[^5] ✅[^6] | MQA can lose quality; GQA is the middle ground ✅[^6] |

## Takeaways
- For open-ended text, sample with top-p (for example 0.9) and a moderate temperature; keep beam search for input-grounded tasks such as translation or summarization. [rule-candidate]
- Size serving memory as weights + `2 × layers × kv_heads × d_head × max_tokens × batch × bytes` for the cache; at long contexts the cache can take a significant share of memory ✅[^10].
- In a hand-written cached loop, build the mask for queries at the end (`tril(diagonal=S − L)`), never `is_causal=True`; test that cached and uncached generation give the same tokens. [rule-candidate]
- Read a model's `generation_config.json` before comparing outputs: library defaults (`top_k = 50`) apply silently.

## Verification status
- Verified: 78 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- [The Curious Case of Neural Text Degeneration](https://arxiv.org/html/1904.09751v2) — Holtzman et al., 2020. Backs: degeneration of maximization-based decoding and of pure sampling, top-k definition and its fixed-`k` problem, temperature formula and its quality–diversity effect, the top-p definition and renormalization, the repetition feedback loop. [^1]
- [Generation strategies (Transformers docs)](https://huggingface.co/docs/transformers/main/en/generation_strategies) — Hugging Face, living (main branch). Backs: greedy as default and its repetition, sampling and `do_sample=True, num_beams=1`, beam search "look ahead" and input-grounded tasks, `num_beams > 1`. [^2]
- [Beam Search (Dive into Deep Learning, 10.8)](https://d2l.ai/chapter_recurrent-modern/beam-search.html) — Zhang, Lipton, Li, Smola, living. Backs: greedy, exhaustive and beam-search costs, the length-normalized score with `α = 0.75`, greedy as beam size 1. [^3]
- [How caching works (Transformers docs)](https://huggingface.co/docs/transformers/main/en/cache_explanation) — Hugging Face, living (main branch). Backs: why caching is valid under a causal mask, the per-step update, cache tensor shape, quadratic vs linear cost, mask length, inference only. [^4]
- [Fast Transformer Decoding: One Write-Head is All You Need](https://arxiv.org/html/1911.02150v1) — Shazeer, 2019. Backs: incremental decoding limited by reloading keys and values, multi-query attention, minor quality loss. [^5]
- [GQA: Training Generalized Multi-Query Transformer Models from Multi-Head Checkpoints](https://arxiv.org/html/2305.13245v3) — Ainslie et al., 2023. Backs: MQA's quality risk, GQA groups, cache reduction by a factor of the head count, GQA quality close to MHA at MQA-like speed. [^6]
- [torch.nn.functional.scaled_dot_product_attention](https://docs.pytorch.org/docs/2.15/generated/torch.nn.functional.scaled_dot_product_attention.html) — PyTorch 2.15 docs. Backs: top-left `tril` causal mask, `enable_gqa` and its divisibility constraint. [^7]
- `machine-learning/lab-setup.md` — the lab where the decoding knobs, greedy vs beam, cached vs uncached generation, the mask trap and the cache-size formula ran on 2026-11-24. [^8]
- [Generation (Transformers API reference)](https://huggingface.co/docs/transformers/main/en/main_classes/text_generation) — Hugging Face, living (main branch). Backs: `temperature`, `top_k`, `top_p` defaults, `num_beams=1` means no beam search. [^9]
- [Cache strategies (Transformers docs)](https://huggingface.co/docs/transformers/main/en/kv_cache) — Hugging Face, living (main branch). Backs: dynamic cache default, static cache and compilation, offloading, quantized cache, sliding-window layers. [^10]

## Related
- `machine-learning/transformers/attention-and-the-transformer.md` — attention, the causal mask and the `is_causal` alignment.
- `machine-learning/transformers/tokenization.md` — what one generated token is.
- `machine-learning/transformers/alignment-rlhf-and-dpo.md` — the tuned policy that is being decoded.
- `machine-learning/ml-systems/model-compression-and-quantization.md` — quantizing weights and caches.
- `ai-agents/agent-token-accounting.md` — how generated and cached tokens are counted in agent sessions.
