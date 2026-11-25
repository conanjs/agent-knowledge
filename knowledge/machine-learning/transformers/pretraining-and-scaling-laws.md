---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/transformers
status: verified
applies-to: ["any"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [machine-learning, transformers, pretraining, language-modeling, next-token-prediction, masked-language-model, perplexity, scaling-laws, chinchilla, compute-optimal]
---

# Pretraining objectives and scaling laws

## Summary
**TL;DR:** A language model is pretrained by self-supervision: hide part of the text and train the network to predict it, scoring with cross-entropy. Decoder models predict the next token (the targets are the inputs shifted by one); BERT-style (Bidirectional Encoder Representations from Transformers) encoders predict 15 % of tokens that were masked. Perplexity is `exp(mean cross-entropy)`, the effective number of choices per token. Test loss falls as a power law in parameters `N`, data `D` and compute `C ≈ 6·N·D`. Kaplan et al. (2020) concluded most extra compute should go into a bigger model; Hoffmann et al. (2022, "Chinchilla") found `N` and `D` should grow equally, about 20 tokens per parameter in their Table 3.
**Use this when:** reading a loss or perplexity curve, estimating the compute or the data a model size needs, or judging whether a model is "undertrained".
**Not this doc:** the network being trained → `machine-learning/transformers/attention-and-the-transformer.md`; cross-entropy as maximum likelihood → `machine-learning/foundations/loss-functions-and-maximum-likelihood.md`; adapting a pretrained model → `machine-learning/transformers/fine-tuning-and-lora.md`.

## Problem
Labeled data is scarce, while raw text needs no manual labels ✅[^5], so the label has to come from the text itself. Then a budget question follows: with a fixed amount of compute, should you train a bigger model on less data, or a smaller one on more? Two influential papers gave different answers, and models built on the first answer turned out to be "significantly undertrained" by the second paper's measure ✅[^3]. Without the arithmetic, a loss of 1.7 or a perplexity of 5 carries no meaning, and a training plan cannot be sized.

## Mental model
**Analogy:** a cloze test given billions of times. A decoder model reads a sentence one word at a time and must guess the next word before seeing it; a masked model gets a sentence with holes and fills them in. Scaling laws are the student's grade curve: each doubling of study hours (compute) improves the grade by a predictable, shrinking amount, and the question is whether to spend those hours on a bigger brain or on more books.

**Artifact:** the next-token objective in four lines, where the target is the input shifted by one position (from the Worked example's full script):

```python
def loss_on(m, data):                                 # inputs = tokens 0..T-1, targets = tokens 1..T (shift by one)
    logits = m(data[:, :-1])
    return F.cross_entropy(logits.reshape(-1, V), data[:, 1:].reshape(-1)).item()
# perplexity = math.exp(loss)
```

## How it works
### Objectives
1. **Next-token (causal) language modeling.** The probability of a text factorizes as `P(x_1 … x_T) = Π_t P(x_t | x_1 … x_(t−1))`, the product over positions of each token's probability given the ones before it ✅[^4]. A decoder with a causal mask predicts every position at once, and the target sequence is the input shifted by one token; GPT (generative pre-training) trains this way ✅[^5].
2. **Masked language modeling (MLM).** BERT (Bidirectional Encoder Representations from Transformers) picks 15 % of token positions at random; a chosen token is replaced by `[MASK]` 80 % of the time, by a random token 10 %, and left unchanged 10 %, and the model predicts the original with cross-entropy ✅[^2]. Only the chosen tokens are predicted, not the whole input ✅[^2]. The 80/10/10 split exists because `[MASK]` never appears during fine-tuning ✅[^2]. Masking is needed because bidirectional attention would otherwise let each word "see itself" ✅[^2].
3. **Span corruption (encoder–decoder).** T5 (Text-to-Text Transfer Transformer) replaces random spans with sentinel tokens and trains the decoder to output the missing spans ✅[^5].

### Perplexity
`loss = (1/n) · Σ_t −log P(x_t | x_<t)`, the mean cross-entropy over `n` tokens in nats (natural log); `perplexity = exp(loss)` ✅[^4]. A perfect model has perplexity 1; a model that predicts uniformly over a vocabulary of `V` tokens has perplexity `V`, the bar any useful model must beat ✅[^4]. Example: loss 1.673 → `exp(1.673) = 5.33`, as if choosing among about 5 equally likely tokens ✅[^6]. The average runs over the tokenizer's own tokens ✅[^4], so the tokenization procedure directly affects perplexity and must be taken into account when comparing models ✅[^7] (`machine-learning/transformers/tokenization.md`).

### Kaplan et al. (2020): power laws
- Test cross-entropy follows a power law in each of `N`, `D` and compute when the other two do not limit it, with some trends over more than seven orders of magnitude; width versus depth matters little within a wide range ✅[^1].
- `N` counts non-embedding parameters, `N ≈ 12 · n_layer · d_model²` for the standard shape (`d_ff = 4·d_model`), leaving out biases and other small terms ✅[^1]. Training compute is `C ≈ 6·N` floating-point operations (FLOPs) per token: 2 for the forward pass, about twice that for the backward pass ✅[^1]. Over `D` training tokens, `C ≈ 6·N·D` ✅[^3].
- Fits: `L(N) = (N_c / N)^0.076` with `N_c ≈ 8.8 × 10^13`, and `L(D) = (D_c / D)^0.095` with `D_c ≈ 5.4 × 10^13` tokens; `L` is cross-entropy in nats ✅[^1].
- Allocation: compute-efficient training uses very large models stopped well short of convergence; the optimal model size grows as `N ∝ C^0.73` while data grows only as `D ∝ C^0.27` ✅[^1].

### Hoffmann et al. (2022, "Chinchilla"): compute-optimal
- Over 400 models (70 million to over 16 billion parameters, 5 to 500 billion tokens): for compute-optimal training, `N` and `D` should be scaled equally, so doubling the model doubles the tokens ✅[^3]. The three fitting approaches give exponents `a` (for `N`) and `b` (for `D`) between 0.46 and 0.54 ✅[^3].
- Fitted loss (Approach 3): `L(N, D) = E + A / N^α + B / D^β` with `E = 1.69`, `A = 406.4`, `B = 410.7`, `α = 0.34`, `β = 0.28`. `E` is the irreducible loss (the entropy of text), the `A` term the penalty for a finite model, the `B` term for finite data ✅[^3].
- Why it differs from Kaplan: Kaplan's runs used a fixed number of training tokens and one learning-rate schedule for every model; Chinchilla found that matching the schedule to the number of training tokens gives the best final loss. The intermediate losses of a schedule fixed at 130 billion tokens overstate the loss of shorter runs, which underestimates training on less data and contributed to Kaplan's conclusion that model size should grow faster than data ✅[^3].
- The test: for Gopher's compute budget the analysis predicted a model 4 times smaller trained on 4 times more tokens; Chinchilla (70 billion parameters, 1.4 trillion tokens) outperformed Gopher (280 billion parameters, 300 billion tokens) ✅[^3].

## Worked example
Pretraining a 1-layer causal transformer (width 32, 2 heads) on a synthetic "language": a Markov chain over 16 tokens where each token has two likely successors. Because the true process is known, its entropy rate is the best loss any model can reach, the `E` of the Chinchilla formula in miniature. Then the scaling-law arithmetic. Lab run (`machine-learning/lab-setup.md`), 2026-11-24, PyTorch 2.15.0 on the CPU (central processing unit), deterministic algorithms, two runs identical ✅[^6]:

```text
uniform baseline: loss ln(V) = 2.773, perplexity = 16
true process floor: loss = 1.639, perplexity = 5.15
step    0  val loss 2.857  perplexity  17.42
step   50  val loss 1.699  perplexity   5.47
step  100  val loss 1.676  perplexity   5.34
step  400  val loss 1.673  perplexity   5.33

== BERT-style masking of 100,000 token positions ==
chosen 0.1484; of chosen: [MASK] 0.796, random 0.105, unchanged 0.099

== Kaplan: N = 12 * n_layer * d_model^2 (no biases, norms, embeddings) ==
d_model=512, 1 layer: 3145728 vs exact block with biases and norms: 3152384

== Chinchilla Table 3 rows: tokens per parameter and 6*N*D ==
N= 4.0e+08 D= 8.0e+09  D/N= 20.0  6ND=1.92e+19  table=1.92e+19
N= 1.0e+09 D= 2.0e+10  D/N= 20.2  6ND=1.21e+20  table=1.21e+20
N= 1.0e+10 D= 2.1e+11  D/N= 20.5  6ND=1.23e+22  table=1.23e+22
N= 6.7e+10 D= 1.5e+12  D/N= 22.4  6ND=6.03e+23  table=5.76e+23
N= 1.8e+11 D= 3.7e+12  D/N= 21.1  6ND=3.88e+24  table=3.85e+24
Gopher     N=3e+11 D=3.0e+11  C=6ND=5.04e+23  fitted loss=1.993
Chinchilla N=7e+10 D=1.4e+12  C=6ND=5.88e+23  fitted loss=1.937
optimum for C=5.76e+23: N=3.22e+10  D=2.98e+12  D/N=92.6
```

<details><summary>Full script (prints the output above)</summary>

```python
# (1) next-token pretraining of a 1-layer causal transformer on a synthetic Markov-chain "language",
#     with loss and perplexity against the uniform baseline and the true process's floor;
# (2) BERT-style 15% / 80-10-10 masking counts; (3) Kaplan and Chinchilla arithmetic.
import math, torch, torch.nn as nn, torch.nn.functional as F
torch.manual_seed(0); torch.set_num_threads(1); torch.use_deterministic_algorithms(True)

V, T = 16, 32                                         # vocabulary size, context length
P = torch.full((V, V), 0.02)                          # Markov chain: each token has 2 likely successors
for i in range(V):
    P[i, (3 * i + 1) % V] += 0.6; P[i, (5 * i + 2) % V] += 0.3
P = P / P.sum(1, keepdim=True)
pi = torch.ones(V) / V
for _ in range(1000): pi = pi @ P                     # stationary distribution
floor = -(pi[:, None] * P * P.log()).sum().item()     # entropy rate (nats/token): best possible loss
def sample(n):                                        # n sequences of T+1 tokens
    x = torch.empty(n, T + 1, dtype=torch.long); x[:, 0] = torch.randint(V, (n,))
    for t in range(T): x[:, t + 1] = torch.multinomial(P[x[:, t]], 1).squeeze(1)
    return x
train, val = sample(2000), sample(200)

class TinyLM(nn.Module):                              # token + position embedding, 1 pre-LN causal block, output head
    def __init__(s, d=32):
        super().__init__()
        s.tok, s.pos = nn.Embedding(V, d), nn.Embedding(T, d)
        s.block = nn.TransformerEncoderLayer(d, 2, 4 * d, dropout=0.0, batch_first=True, norm_first=True)
        s.norm, s.head = nn.LayerNorm(d), nn.Linear(d, V)
    def forward(s, x):
        h = s.tok(x) + s.pos(torch.arange(x.shape[1]))
        mask = nn.Transformer.generate_square_subsequent_mask(x.shape[1])
        return s.head(s.norm(s.block(h, src_mask=mask, is_causal=True)))
def loss_on(m, data):                                 # inputs = tokens 0..T-1, targets = tokens 1..T (shift by one)
    logits = m(data[:, :-1])
    return F.cross_entropy(logits.reshape(-1, V), data[:, 1:].reshape(-1)).item()

m = TinyLM(); opt = torch.optim.AdamW(m.parameters(), lr=3e-3)
print(f"uniform baseline: loss ln(V) = {math.log(V):.3f}, perplexity = {V}")
print(f"true process floor: loss = {floor:.3f}, perplexity = {math.exp(floor):.2f}")
with torch.no_grad(): l0 = loss_on(m, val)
print(f"step    0  val loss {l0:.3f}  perplexity {math.exp(l0):6.2f}")
for step in range(1, 401):
    xb = train[torch.randint(len(train), (64,))]
    loss = F.cross_entropy(m(xb[:, :-1]).reshape(-1, V), xb[:, 1:].reshape(-1))
    opt.zero_grad(); loss.backward(); opt.step()
    if step in (50, 100, 400):
        with torch.no_grad(): l = loss_on(m, val)
        print(f"step {step:4d}  val loss {l:.3f}  perplexity {math.exp(l):6.2f}")

print("\n== BERT-style masking of 100,000 token positions ==")
g = torch.Generator().manual_seed(1)
chosen = torch.rand(100000, generator=g) < 0.15
r = torch.rand(100000, generator=g)
print(f"chosen {chosen.float().mean():.4f}; of chosen: [MASK] {(r[chosen] < 0.8).float().mean():.3f}, "
      f"random {((r[chosen] >= 0.8) & (r[chosen] < 0.9)).float().mean():.3f}, unchanged {(r[chosen] >= 0.9).float().mean():.3f}")

print("\n== Kaplan: N = 12 * n_layer * d_model^2 (no biases, norms, embeddings) ==")
print("d_model=512, 1 layer:", 12 * 512 ** 2, "vs exact block with biases and norms: 3152384")

print("\n== Chinchilla Table 3 rows: tokens per parameter and 6*N*D ==")
for N, D, flops in [(400e6, 8.0e9, 1.92e19), (1e9, 20.2e9, 1.21e20), (10e9, 205.1e9, 1.23e22),
                    (67e9, 1.5e12, 5.76e23), (175e9, 3.7e12, 3.85e24)]:
    print(f"N={N:8.1e} D={D:8.1e}  D/N={D / N:5.1f}  6ND={6 * N * D:.2e}  table={flops:.2e}")
L = lambda N, D: 1.69 + 406.4 / N ** 0.34 + 410.7 / D ** 0.28   # Chinchilla's fitted loss, Approach 3
for name, N, D in [("Gopher    ", 280e9, 300e9), ("Chinchilla", 70e9, 1.4e12)]:
    print(f"{name} N={N:.0e} D={D:.1e}  C=6ND={6 * N * D:.2e}  fitted loss={L(N, D):.3f}")
a, b, A, B = 0.34, 0.28, 406.4, 410.7                  # closed-form optimum under 6ND = C
G = (a * A / (b * B)) ** (1 / (a + b))
C = 5.76e23
Nopt = G * (C / 6) ** (b / (a + b)); Dopt = (C / 6) / Nopt
print(f"optimum for C={C:.2e}: N={Nopt:.2e}  D={Dopt:.2e}  D/N={Dopt / Nopt:.1f}")
```

</details>

Reading it line by line:
- **Training.** The untrained model starts at perplexity 17.42, slightly worse than guessing uniformly (16): random weights are not exactly uniform. After 400 steps it reaches 5.33, within 0.18 of the floor 5.15 set by the process's own randomness. No model can go below the floor, just as `E = 1.69` bounds the Chinchilla fit ✅[^6] ✅[^3].
- **Masking.** 14.84 % of 100,000 positions were chosen, and of those 79.6 / 10.5 / 9.9 % became `[MASK]` / random / unchanged: the BERT recipe, sampled ✅[^6] ✅[^2].
- **Kaplan's count.** `12 · d_model²` for one 512-wide layer gives 3,145,728, within 0.2 % of the exact 3,152,384 counted in `machine-learning/transformers/attention-and-the-transformer.md`; the gap is the biases and norms the formula leaves out ✅[^6] ✅[^1].
- **The "20 tokens per parameter" rule.** Chinchilla's Table 3 (Approach 1) gives 20.0 to 22.4 tokens per parameter for 400 million to 175 billion parameters, and its FLOPs column is `6·N·D` ✅[^6] ✅[^3]. The exception is the 67-billion row, whose FLOPs entry is exactly Gopher's budget: `6·N·D` from its printed `N` and `D` is 5 % higher, and rounding the token column cannot explain it, since `5.76 × 10^23 / (6 × 67 × 10^9)` is 1.43 trillion tokens, not 1.5.
- **Same compute, different split.** By `6·N·D`, Gopher and Chinchilla used 5.0 and 5.9 × 10^23 FLOPs; the fitted law gives Chinchilla the lower loss, 1.937 against 1.993 ✅[^6].
- **Approach 3 is not Approach 1.** Solving the fitted law for Gopher's budget with the rounded published constants gives `N = 32` billion and 93 tokens per parameter, while the paper projects 40 billion from the same approach ✅[^6] ✅[^3]: the optimum is sensitive to the third digit of `α` and `β`, and the 20-to-1 ratio comes from Approach 1's table, not from this formula.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Compare perplexity of two models with different tokenizers | Misleading | The average runs over each tokenizer's own tokens ✅[^4], and tokenization directly affects perplexity ✅[^7]; the same text has a different number of tokens (`machine-learning/transformers/tokenization.md`) |
| Loss below the data's entropy | Should not happen on held-out data beyond sampling noise; suspect leakage | Lab floor 1.639 was never crossed (best 1.673) ✅[^6]; the `E` term is the entropy of text ✅[^3] |
| `6·N·D` for long contexts | Undercounts | It drops the context term, `2·n_layer·n_ctx·d_model` per token in the forward pass, which is a relatively small fraction when `d_model > n_ctx / 12` ✅[^1] |
| `6·N·D` for Gopher (5.04 × 10^23) vs the paper's 5.76 × 10^23 FLOPs | 13 % apart | The rule is an approximation ✅[^6] ✅[^3] |
| Counting `N` with embeddings | Scaling fits get noisier | Kaplan excludes embedding parameters for "significantly cleaner" laws ✅[^1] |
| Scaling `N` while holding `D` fixed | Diminishing returns | Kaplan: the penalty depends on `N^0.74 / D`; 8× the model needs roughly 5× the data ✅[^1] |
| Fixed learning-rate schedule across runs of different length | Short runs look worse than they are | The schedule should match the token count ✅[^3] |
| MLM model asked to generate text | Not trained to continue text left to right | It predicts masked positions using both sides ✅[^2] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Kaplan-style allocation (`N ∝ C^0.73`) | Fewer tokens needed ✅[^1] | By Chinchilla's measure, oversized and undertrained ✅[^3] |
| Chinchilla-style allocation (`N`, `D` equal) | Lowest training loss for the compute ✅[^3]; smaller model, cheaper inference ✅[^3] | Needs about 20 tokens per parameter ✅[^3] |
| Next-token objective | Every position is a training target; the model can generate ✅[^5] | Each token sees only its left context ✅[^2] |
| Masked objective | Bidirectional context ✅[^2] | Only 15 % of positions are targets; pretrain/fine-tune mismatch handled by 80/10/10 ✅[^2] |

## Takeaways
- Report loss in nats and perplexity together, with the tokenizer named; compare models only on the same tokenizer and data. [rule-candidate]
- Estimate training compute as `6 × parameters × tokens` before planning a run; add the attention term for long contexts.
- For a compute-optimal pretraining run, budget roughly 20 tokens per parameter (Chinchilla Approach 1); a model trained on far fewer tokens is likely undertrained.
- Test a new training loop on synthetic data whose entropy is known: it should approach that floor and never cross it.

## Verification status
- Verified: 57 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- [Scaling Laws for Neural Language Models](https://arxiv.org/html/2001.08361v1) — Kaplan et al., 2020. Backs: power laws over seven orders of magnitude, weak shape dependence, `N ≈ 12·n_layer·d_model²` without embeddings, `C ≈ 6N` per token, the fitted constants, `N ∝ C^0.73`, `D ∝ C^0.27`, the `N^0.74/D` overfitting ratio, the context term. [^1]
- [BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding](https://arxiv.org/html/1810.04805v2) — Devlin et al., 2019. Backs: masked LM, 15 % and 80/10/10, predict only masked tokens, why masking is needed, the fine-tuning mismatch. [^2]
- [Training Compute-Optimal Large Language Models](https://arxiv.org/html/2203.15556v1) — Hoffmann et al., 2022. Backs: 400 models, equal scaling of `N` and `D`, "significantly undertrained", Chinchilla vs Gopher outcome, exponents of the three approaches, fitted `L(N, D)` and its terms, Table 3, the Kaplan differences, the 40-billion projection, Gopher's 300 billion tokens and 5.76 × 10^23 FLOPs, Chinchilla's 1.4 trillion tokens, smaller inference cost. [^3]
- [Language Models (Dive into Deep Learning, 9.3)](https://d2l.ai/chapter_recurrent-neural-networks/language-model.html) — Zhang, Lipton, Li, Smola, living. Backs: chain-rule factorization, mean cross-entropy, perplexity and its best, worst and uniform cases. [^4]
- [Large-Scale Pretraining with Transformers (Dive into Deep Learning, 11.9)](https://d2l.ai/chapter_attention-mechanisms-and-transformers/large-pretraining-transformers.html) — Zhang, Lipton, Li, Smola, living. Backs: GPT's shifted-by-one targets, T5 span corruption. [^5]
- `machine-learning/lab-setup.md` — the lab where the tiny causal language model was pretrained and the masking and scaling arithmetic ran on 2026-11-24. [^6]
- [Perplexity of fixed-length models (Transformers docs)](https://huggingface.co/docs/transformers/main/en/perplexity) — Hugging Face, living (main branch). Backs: the tokenization procedure directly affects perplexity and must be considered when comparing models. [^7]

## Related
- `machine-learning/foundations/loss-functions-and-maximum-likelihood.md` — cross-entropy as maximum likelihood.
- `machine-learning/foundations/what-is-machine-learning.md` — self-supervised learning among the other kinds.
- `machine-learning/transformers/attention-and-the-transformer.md` — the network and its exact parameter count.
- `machine-learning/transformers/tokenization.md` — what a "token" in `D` is.
- `machine-learning/transformers/fine-tuning-and-lora.md` — the next stage after pretraining.
- `machine-learning/deep-learning/optimizers-and-learning-rate-schedules.md` — the cosine schedule whose length Chinchilla matched to the data.
