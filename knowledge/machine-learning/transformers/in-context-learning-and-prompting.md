---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/transformers
status: verified
applies-to: ["any", "PyTorch 2.15.0 (lab)"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, transformers, in-context-learning, few-shot-prompting, demonstrations, induction-heads, linear-regression, gradient-descent, chain-of-thought, prompt-sensitivity, contextual-calibration]
---

# In-context learning and prompting

## Summary
**TL;DR:** In-context learning (ICL) means a pretrained model performs a task from demonstrations placed in its prompt, with no weight update. What the demonstrations teach is less than it looks: in Min et al.'s tests of 12 language models on 26 classification and multi-choice datasets, random labels in the demonstrations cost nearly all models only 0–5 % absolute, while the format, the kind of inputs and the set of possible answers carried most of the gain. In the lab's toy, a small model that had to learn the input–label rule from the prompt followed wrong labels instead. Two mechanisms are well documented: induction heads, a two-layer attention circuit that completes `[A][B] … [A] → [B]`, and transformers trained on regression prompts that run a learning algorithm in their forward pass. With the right weights, one linear self-attention layer computes exactly one gradient-descent step, and layers trained on regression tasks converge to those weights or closely match gradient descent. Chain-of-thought demonstrations, which show intermediate steps, helped only models of about 100 billion parameters or more in Wei et al.'s tests. Prompts are fragile: the order of the same four demonstrations moved a 2.7-billion-parameter GPT-3 (Generative Pre-trained Transformer 3) from 54.3 % to 93.4 % accuracy.
**Use this when:** you write few-shot prompts and wonder whether label quality, order or count matters; you read "induction head", "in-context learning score" or "transformers learn by gradient descent"; or you choose between prompting, chain-of-thought and fine-tuning.
**Not this doc:** few-shot learning by meta-training a network (MAML, model-agnostic meta-learning; prototypical networks) → `machine-learning/deep-learning/meta-learning-and-few-shot-learning.md`; attention, heads and the causal mask → `machine-learning/transformers/attention-and-the-transformer.md`; how the model was pretrained → `machine-learning/transformers/pretraining-and-scaling-laws.md`; changing the weights instead → `machine-learning/transformers/fine-tuning-and-lora.md`; prompt writing for coding agents → `ai-agents/prompt-engineering-deep-dive.md`.

## Problem
Engineers treat the demonstrations in a prompt like a small training set: more correct examples should help, wrong labels should teach wrong behaviour, and order should not matter. In large models these intuitions fail. Replacing gold labels with random ones barely hurt 12 models up to GPT-3 ✅[^3]. Reordering four examples moved the sentiment accuracy of GPT-3 2.7B (2.7 billion parameters) from 54.3 % to 93.4 % ✅[^8]. Chain-of-thought prompts made small models worse than plain prompts ✅[^7]. Yet a toy transformer that must infer the rule from the prompt does follow wrong labels (lab: 0.869 accuracy with gold labels, 0.130 with flipped ones) ✅[^9]. Without a model of what the prompt contributes, you cannot predict which case you are in.

## Mental model
**Analogy:** a temp worker handed a job ticket with a few filled-in sample sheets. A veteran temp recognizes the kind of job from how the samples look: the layout, the kind of inputs, the set of allowed answers. They then do it the way they learned long ago, barely checking whether each sample answer is right. A newcomer who has never seen this job must work the rule out from the samples, and wrong samples mislead them. The veteran is task recognition, the newcomer is task learning. An induction head is the veteran's habit "if this exact line appeared earlier on the sheet, copy what came after it".

**Artifact:** two tiny transformers trained from scratch on in-context classification, tested with the 14 demonstration labels kept, randomized or flipped. One was pretrained on 4 fixed tasks, each with its own input region; the other on a fresh random task per prompt. Printed by the full script in the Worked example; lab run (`machine-learning/lab-setup.md`), 2026-11-25, PyTorch 2.15.0 ✅[^9]:

```text
== (4) accuracy on the query after 14 demonstrations, 2,000 prompts ==
pretrained on 4 tasks:   gold labels 0.989 | random labels 0.988 | flipped labels 0.988
pretrained on fresh tasks: gold labels 0.869 | random labels 0.488 | flipped labels 0.130
```

The 4-task model recognizes the task from the inputs and ignores the labels. The fresh-task model can only learn the rule from the labels, so flipped labels flip its answers.

## How it works
### The few-shot setting
1. **Definitions:** GPT-3's few-shot setting gives `K` demonstrations of context and completion, then one more context, with no weight updates; `K` is typically 10 to 100, as many as fit the 2,048-token context window ✅[^1]. One-shot allows one demonstration plus a task description; zero-shot only a natural-language instruction ✅[^1]. GPT-3 calls in-context learning the inner loop of meta-learning, run in the forward pass over each sequence, with pretraining as the outer loop. Its authors keep the terms agnostic on whether the model learns the task or recognizes patterns seen in training ✅[^1].
2. **Scoring:** the survey by Dong et al. formalizes it as `ŷ = argmax_j f_M(y_j, C, x)`. Here `x` is the query, `y_j` one candidate answer, `C` an optional instruction plus `k` demonstrations written with a template, and `f_M` the model's score ✅[^2]. Unlike few-shot learning in general, nothing in the model is updated ✅[^2]. Example: after `Input: Subpar acting. Sentiment: Negative` and `Input: Beautiful film. Sentiment: Positive`, the model compares the probabilities of the words `Positive` and `Negative` after `Input: Amazing. Sentiment:` ✅[^8].

### What the demonstrations contribute
Min et al. tested 12 models from 774 million to 175 billion parameters on 26 classification and multi-choice datasets, with `k = 16` demonstrations ✅[^3].
1. **Labels matter little in their setting:** random labels instead of gold ones dropped performance by 0–5 % absolute for nearly all models, and even all-incorrect labels did significantly better than no demonstrations ✅[^3].
2. **Four aspects:** they split a demonstration into the input–label mapping, the distribution of the inputs, the label space (the set of possible answers) and the format (input–label pairs) ✅[^3]. Out-of-distribution inputs, sentences drawn from an external corpus, cost 3–16 % absolute for three of the model variants. Random English words as labels cost 5–16 % for direct models. Removing the format was close to, or worse than, no demonstrations ✅[^3].
3. **Their reading:** the model recovers the input–label correspondence from pretraining, and the demonstrations mostly locate the task ✅[^3]. MetaICL, a GPT-2 (Generative Pre-trained Transformer 2) model meta-trained with an in-context objective, ignored the mapping even more ✅[^3].
4. **Limits:** they warn that synthetic tasks with limited inputs may use the ground-truth labels more ✅[^3]. The survey reports later studies finding that accurate mappings matter significantly, and that flipped or semantically unrelated mappings can be learned. It also cites Pan et al.'s split of ICL into task recognition and task learning ✅[^2]. The lab toy shows both regimes side by side ✅[^9].

### Induction heads
1. **The circuit:** a previous-token head copies information from the previous token into each position. A second head, the induction head, then finds an earlier position where the current token `A` occurred, attends to the token after it (`B`) and raises the logit of `B` ✅[^6]. The rule applies whatever `A` and `B` are, so it is an algorithm, not a table of bigram counts ✅[^6].
2. **Why two layers:** where the head attends must depend on the token before the attended one, and one head sees only the source and destination tokens. So the circuit needs heads in two layers, and induction heads do not occur in one-layer models ✅[^6].
3. **Definition by behaviour:** Olsson et al. call a head an induction head when, on a repeated sequence of random tokens, it attends to tokens that followed the current token earlier (prefix matching) and raises the logit of the attended token (copying) ✅[^6].
4. **The phase change:** their in-context learning score compares the loss at the 50th and the 500th token of the context. Early in training, roughly between 2.5 and 5 billion tokens, it jumps from under 0.15 nats to about 0.4 nats (a nat is a unit of loss measured with the natural logarithm). Induction heads form in the same window, which shows as a bump in the training loss ✅[^6]. The lab's 2-layer toy shows the same kind of abrupt drop: second-copy loss of 4.01 at step 600, then 0.60 at step 700 ✅[^9].

### Transformers that run a learning algorithm in context
1. **The Garg et al. setup:** sample a random linear function `f(x) = w·x` with `w` and the inputs from `N(0, I)`, the standard normal distribution (mean 0, identity covariance), in `d = 20` dimensions. Build the prompt `(x₁, f(x₁), …, x_k, f(x_k), x_query)` and train a model from scratch to predict every `f(x_{i+1})` from the prefix before it ✅[^4]. They used a GPT-2-family decoder with 12 layers, 8 heads and 256 dimensions (9.5 M parameters), trained for 500k steps ✅[^4].
2. **The metric:** normalized squared error `(ŷ − w·x_query)² / d`; a prediction of 1.0 against a true 1.5 in `d = 5` scores `0.25 / 5 = 0.05`.
3. **Result:** error comparable to least squares at every `k`, the optimal estimator here. At `k = d` least squares reaches 0 and the transformer 0.02, then 0.0006 at `k = 2d` ✅[^4]. Baselines were minimum-norm least squares, the mean of the `n` nearest neighbours' outputs, and the averaging estimator `ŵ = (1/k) Σ x_i y_i` ✅[^4]. Memorization cannot explain it: the best of the 32 million training weight vectors would give an error of about 0.2 ✅[^4].
4. **One attention layer = one gradient step:** von Oswald et al. drop the softmax to get linear self-attention (LSA). They construct LSA weights whose update of the query token equals one GD (gradient descent) step on the squared loss `L(W) = 1/(2N) Σ ‖W x_i − y_i‖²` ✅[^5]. LSA layers trained on regression tasks converge to that construction or closely match GD. `K` layers beat `K` plain GD steps and are described by a curvature-corrected variant, GD++ ✅[^5].
5. **The step itself:** from `W₀ = 0`, one step gives `ΔW = (η/N) Σ_i y_i x_iᵀ`, so the prediction is `ŷ = (η/N) Σ_i y_i (x_i · x_q)` ✅[^5]. With `η = 1` this is exactly the averaging estimator above ✅[^4]. Example: `x₁ = (1, 0)`, `y₁ = 2`, `x₂ = (0, 1)`, `y₂ = −1`, `η = 1`, `x_q = (2, 2)` gives `w = (1, −0.5)` and `ŷ = 1`.
6. **Caveat:** the survey notes debate over how far these simplified regression settings carry to real models, and work arguing for higher-order optimization rather than GD ✅[^2].

### Chain-of-thought prompting
1. **Method:** the demonstrations include a chain of thought, a series of intermediate reasoning steps, before the answer ✅[^7]. With eight such exemplars, PaLM (Pathways Language Model) 540B rose on the GSM8K (Grade School Math 8K) benchmark of math word problems from 17.9 % with standard prompting to 56.9 % ✅[^7].
2. **Scale:** gains appeared only with models of about 100 billion parameters; smaller models wrote fluent but illogical chains and did worse than standard prompting ✅[^7].
3. **What it is not:** an equation-only output did not help much on GSM8K. A string of dots as long as the needed equation, which gives extra computation without reasoning, did about as well as the baseline. So did writing the chain after the answer ✅[^7]. Its authors' intuition is that it helps most on multi-step tasks, with large models, where the scaling curve is flat. They note it guarantees no correct reasoning path and does not settle whether the network reasons ✅[^7].

### Prompt sensitivity and contextual calibration
1. **Instability:** the format, the choice of examples and their order each moved GPT-3's accuracy between near chance and near state of the art ✅[^8].
2. **Three biases:** majority label bias, toward answers frequent in the prompt; recency bias, toward answers near its end; and common token bias, toward answers frequent in pretraining ✅[^8]. With 4 sentiment examples ordered `P P P N`, nearly 90 % of predictions were Negative, although 3 of 4 examples were Positive. On DBPedia (a 14-class topic task), GPT-3 predicted "book" 11 times more often than "artist" ✅[^8].
3. **Contextual calibration:** ask the model for its answer probabilities `p_cf` on a content-free input such as `N/A`. Then rescale every prediction by `W = diag(p_cf)⁻¹`, with bias 0, and take the argmax ✅[^8]. Example: `N/A` scores 61.8 % Positive ✅[^8]; a test input scored `(0.55, 0.45)` becomes `(0.55/0.618, 0.45/0.382) = (0.890, 1.178)`, so the label flips to Negative. It raised average accuracy by up to 30.0 % absolute and reduced variance across prompts ✅[^8].
4. **Example choice:** order sensitivity is common across models, and demonstrations whose embeddings are closer to the query's tend to work better ✅[^2].

## Worked example
Four experiments with tiny transformers trained from scratch on a CPU (central processing unit); the script prints everything below, and its part (4) is the Mental model artifact.
1. Attention-only transformers with 1 or 2 layers, trained as language models on sequences that hold 10–30 distinct random tokens, then the same tokens again, then random filler (vocabulary 64).
2. A 4-layer, 64-dimension GPT-style model trained on Garg et al.'s linear-regression prompts with `d = 5` and 15 examples.
3. One linear self-attention layer trained on regression tasks with `N = 10` points, compared with one GD step at the best learning rate.
4. The classification label test from the Mental model.

The LSA layer, whose prediction is the `y` entry of the updated query token:

```python
E = torch.cat([X, y[..., None]], -1)                          # tokens e_j = (x_j, y_j)
q = torch.cat([xq, torch.zeros(len(xq), 1)], -1)              # query token (x_q, 0)
upd = ((E @ s.Wv.T) * ((E @ s.Wk.T) @ (s.Wq @ q[..., None]))).sum(1) / N @ s.P.T
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-25, PyTorch 2.15.0, two runs identical ✅[^9]:

```text
== (1) repeated random tokens: loss in the first copy vs the second copy (ln 64 = 4.16) ==
1-layer step  200: first copy 4.17  second copy 4.16
1-layer step  400: first copy 4.17  second copy 4.15
1-layer step  500: first copy 4.17  second copy 4.15
1-layer step  600: first copy 4.18  second copy 4.12
1-layer step  700: first copy 4.20  second copy 4.07
1-layer step 1000: first copy 4.25  second copy 3.76
2-layer step  200: first copy 4.17  second copy 4.16
2-layer step  400: first copy 4.17  second copy 4.14
2-layer step  500: first copy 4.18  second copy 4.12
2-layer step  600: first copy 4.20  second copy 4.01
2-layer step  700: first copy 4.41  second copy 0.60
2-layer step 1000: first copy 4.31  second copy 0.10
layer 1 heads: previous-token score [0.45, 0.0, 0.0, 0.53]  induction score [0.01, 0.0, 0.0, 0.01]
layer 2 heads: previous-token score [0.0, 0.0, 0.0, 0.0]  induction score [0.95, 0.95, 0.95, 0.95]
== (2) in-context linear regression, d=5: squared error / d, mean over 2,000 prompts ==
 k  transformer  least-squares  averaging  3-NN  zero
 0        0.968          0.966      0.966  0.97  0.97
 1        0.829          0.828      6.009  1.98  1.03
 2        0.586          0.565      3.191  1.49  0.99
 3        0.399          0.367      1.896  1.28  0.93
 4        0.270          0.206      1.563  1.07  1.03
 5        0.143          0.000      1.146  0.93  1.02
 6        0.073          0.000      1.013  0.82  1.03
 8        0.029          0.000      0.827  0.69  1.02
10        0.018          0.000      0.610  0.58  0.97
14        0.014          0.000      0.436  0.49  1.01
== (3) one trained linear self-attention layer vs one GD step from w=0, d=5, N=10 ==
best GD learning rate 0.616; squared error / d: LSA 0.363  GD step 0.362  least squares 0.000
LSA vs GD-step predictions: mean |difference| 0.046 (|prediction| 1.228), correlation 0.9993
== (4) accuracy on the query after 14 demonstrations, 2,000 prompts ==
pretrained on 4 tasks:   gold labels 0.989 | random labels 0.988 | flipped labels 0.988
pretrained on fresh tasks: gold labels 0.869 | random labels 0.488 | flipped labels 0.130
```

<details><summary>Full script (prints the output above)</summary>

```python
# In-context learning in tiny transformers trained from scratch (PyTorch, CPU):
# (1) induction heads on repeated random sequences, 1 vs 2 attention-only layers;
# (2) in-context linear regression (Garg et al. setup, d=5) vs least squares, averaging, 3-NN;
# (3) one linear self-attention layer vs one step of gradient descent (von Oswald et al.);
# (4) gold vs random vs flipped demonstration labels, model pretrained on 4 tasks vs on fresh tasks.
import torch, torch.nn as nn, torch.nn.functional as F
torch.manual_seed(0)
g = torch.Generator().manual_seed(0)

# ---------- (1) induction heads ----------
V, T = 64, 64                                     # vocabulary, sequence length
def repeat_batch(B):                              # r (L distinct random tokens) + r again + random filler
    seq, L = torch.randint(0, V, (B, T), generator=g), torch.randint(10, 31, (B,), generator=g)
    for b in range(B):
        r = torch.randperm(V, generator=g)[:L[b]]
        seq[b, :L[b]], seq[b, L[b]:2 * L[b]] = r, r
    return seq, L
class AttnOnly(nn.Module):                         # attention-only transformer, no MLP, no LayerNorm
    def __init__(s, n_layers, d=64, h=4):
        super().__init__()
        s.emb, s.pos, s.out = nn.Embedding(V, d), nn.Embedding(T, d), nn.Linear(d, V)
        s.att = nn.ModuleList(nn.MultiheadAttention(d, h, batch_first=True) for _ in range(n_layers))
    def forward(s, x):
        h, mask, ws = s.emb(x) + s.pos.weight[:x.shape[1]], torch.ones(T, T).triu(1).bool(), []
        for a in s.att:
            o, w = a(h, h, h, attn_mask=mask, average_attn_weights=False)
            h, ws = h + o, ws + [w]                # w: (batch, head, query position, key position)
        return s.out(h), ws
def copy_losses(logits, seq, L):                   # mean loss in the first copy and in the second copy
    nll = F.cross_entropy(logits[:, :-1].transpose(1, 2), seq[:, 1:], reduction="none")
    t = torch.arange(T - 1)[None]
    first, second = (t < L[:, None] - 1), (t >= L[:, None]) & (t < 2 * L[:, None] - 1)
    return nll[first].mean().item(), nll[second].mean().item()
print("== (1) repeated random tokens: loss in the first copy vs the second copy (ln 64 = 4.16) ==")
ev_seq, ev_L = repeat_batch(256)
for n_layers in (1, 2):
    m = AttnOnly(n_layers); opt = torch.optim.AdamW(m.parameters(), lr=3e-3)
    for step in range(1, 1001):
        seq, _ = repeat_batch(64)
        loss = F.cross_entropy(m(seq)[0][:, :-1].reshape(-1, V), seq[:, 1:].reshape(-1))
        opt.zero_grad(); loss.backward(); opt.step()
        if step in (200, 400, 500, 600, 700, 1000):
            with torch.no_grad():
                f, s = copy_losses(m(ev_seq)[0], ev_seq, ev_L)
            print(f"{n_layers}-layer step {step:4d}: first copy {f:.2f}  second copy {s:.2f}")
with torch.no_grad():                              # score each head of the 2-layer model on the second copy
    ws = m(ev_seq)[1]
    for layer, w in enumerate(ws, 1):
        prev, ind = torch.zeros(4), torch.zeros(4)
        for b in range(256):
            t = torch.arange(ev_L[b], 2 * ev_L[b] - 1)
            prev += w[b][:, t, t - 1].mean(1) / 256          # attention to the previous token
            ind += w[b][:, t, t - ev_L[b] + 1].mean(1) / 256  # to the token after the earlier copy
        print(f"layer {layer} heads: previous-token score {[round(v, 2) for v in prev.tolist()]}"
              f"  induction score {[round(v, 2) for v in ind.tolist()]}")

# ---------- (2) in-context linear regression ----------
D, K = 5, 15                                       # input dimension, examples per prompt
class ICLModel(nn.Module):                         # GPT-style: x and y tokens interleaved, causal mask
    def __init__(s, d=64):
        super().__init__()
        s.inp, s.pos, s.out = nn.Linear(D + 1, d), nn.Parameter(0.02 * torch.randn(2 * K, d)), nn.Linear(d, 1)
        layer = nn.TransformerEncoderLayer(d, 4, 256, dropout=0.0, batch_first=True, norm_first=True)
        s.tf = nn.TransformerEncoder(layer, 4, enable_nested_tensor=False)
    def forward(s, X, y):                         # X (B,K,D), y (B,K) -> prediction for each y_i from x_1..x_i, y_1..y_{i-1}
        B = X.shape[0]
        tok = torch.zeros(B, 2 * K, D + 1)
        tok[:, 0::2, :D], tok[:, 1::2, D] = X, y   # x token = (x, 0); y token = (0, y)
        mask = torch.ones(2 * K, 2 * K).triu(1).bool()
        return s.out(s.tf(s.inp(tok) + s.pos, mask=mask, is_causal=True))[:, 0::2, 0]
def regression_batch(B):
    X, w = torch.randn(B, K, D, generator=g), torch.randn(B, D, generator=g)
    return X, (X @ w[:, :, None])[..., 0]
model = ICLModel(); opt = torch.optim.Adam(model.parameters(), lr=1e-3)
for step in range(4000):
    X, y = regression_batch(64)
    loss = F.mse_loss(model(X, y), y)
    opt.zero_grad(); loss.backward(); opt.step()
Xt, yt = regression_batch(2000)
with torch.no_grad():
    pred = model(Xt, yt)
def baselines(X, y, k):                            # predict y_{k+1} from the first k examples
    xq, yq = X[:, k], y[:, k]
    if k == 0:
        z = torch.zeros_like(yq); return z, z, z
    ls = (torch.linalg.pinv(X[:, :k]) @ y[:, :k, None])[..., 0]           # minimum-norm least squares
    avg = (X[:, :k] * y[:, :k, None]).mean(1)                              # w = mean of y_i x_i
    nn3 = torch.cdist(xq[:, None], X[:, :k])[:, 0].topk(min(3, k), largest=False).indices
    return (ls * xq).sum(1), (avg * xq).sum(1), torch.gather(y[:, :k], 1, nn3).mean(1)
print("== (2) in-context linear regression, d=5: squared error / d, mean over 2,000 prompts ==")
print(" k  transformer  least-squares  averaging  3-NN  zero")
for k in (0, 1, 2, 3, 4, 5, 6, 8, 10, 14):
    ls, avg, nn3 = baselines(Xt, yt, k)
    err = lambda p: ((p - yt[:, k]) ** 2).mean().item() / D
    print(f"{k:2d}  {err(pred[:, k]):11.3f}  {err(ls):13.3f}  {err(avg):9.3f}  {err(nn3):4.2f}  {err(torch.zeros(1)):4.2f}")

# ---------- (3) one linear self-attention layer vs one gradient-descent step ----------
N = 10                                             # context points per task
class LSA(nn.Module):                              # e_j = (x_j, y_j); query e = (x_q, 0); no softmax
    def __init__(s):
        super().__init__()
        s.Wk, s.Wq, s.Wv, s.P = (nn.Parameter(0.01 * torch.randn(D + 1, D + 1)) for _ in range(4))
    def forward(s, X, y, xq):
        E = torch.cat([X, y[..., None]], -1)                          # (B, N, D+1)
        q = torch.cat([xq, torch.zeros(len(xq), 1)], -1)              # (B, D+1)
        upd = ((E @ s.Wv.T) * ((E @ s.Wk.T) @ (s.Wq @ q[..., None]))).sum(1) / N @ s.P.T
        return upd[:, D]                                              # y-entry of the updated query token
def lsa_batch(B):
    X, w, xq = torch.randn(B, N, D, generator=g), torch.randn(B, D, generator=g), torch.randn(B, D, generator=g)
    return X, (X @ w[:, :, None])[..., 0], xq, (xq * w).sum(1)
lsa = LSA(); opt = torch.optim.Adam(lsa.parameters(), lr=1e-3)
for step in range(4000):
    X, y, xq, yq = lsa_batch(256)
    loss = F.mse_loss(lsa(X, y, xq), yq)
    opt.zero_grad(); loss.backward(); opt.step()
gd0 = lambda X, y, xq: ((X * y[..., None]).mean(1) * xq).sum(1)       # one GD step from w=0 with eta=1
X, y, xq, yq = lsa_batch(20000)
eta = ((gd0(X, y, xq) * yq).sum() / (gd0(X, y, xq) ** 2).sum()).item()  # best learning rate, line search in closed form
X, y, xq, yq = lsa_batch(5000)
with torch.no_grad():
    p_lsa, p_gd = lsa(X, y, xq), eta * gd0(X, y, xq)
p_ls = ((torch.linalg.pinv(X) @ y[..., None])[..., 0] * xq).sum(1)
print("== (3) one trained linear self-attention layer vs one GD step from w=0, d=5, N=10 ==")
print(f"best GD learning rate {eta:.3f}; squared error / d: LSA {((p_lsa - yq) ** 2).mean() / D:.3f}"
      f"  GD step {((p_gd - yq) ** 2).mean() / D:.3f}  least squares {((p_ls - yq) ** 2).mean() / D:.3f}")
print(f"LSA vs GD-step predictions: mean |difference| {(p_lsa - p_gd).abs().mean():.3f}"
      f" (|prediction| {p_gd.abs().mean():.3f}), correlation {torch.corrcoef(torch.stack([p_lsa, p_gd]))[0, 1]:.4f}")

# ---------- (4) what the demonstration labels contribute ----------
MU, WT = 3 * F.normalize(torch.randn(4, D, generator=g), dim=1), torch.randn(4, D, generator=g)
def class_batch(B, few_tasks):                     # labels +-1; few_tasks: 4 fixed tasks, each with its own input region
    if few_tasks:
        t = torch.randint(0, 4, (B,), generator=g)
        mu, w = MU[t], WT[t]
    else:
        mu, w = torch.zeros(B, D), torch.randn(B, D, generator=g)
    Z = torch.randn(B, K, D, generator=g)
    return Z + mu[:, None], torch.sign((Z @ w[:, :, None])[..., 0])
print("== (4) accuracy on the query after 14 demonstrations, 2,000 prompts ==")
for few in (True, False):
    m = ICLModel(); opt = torch.optim.Adam(m.parameters(), lr=1e-3)
    for step in range(2000):
        X, y = class_batch(64, few)
        loss = F.binary_cross_entropy_with_logits(m(X, y), (y + 1) / 2)
        opt.zero_grad(); loss.backward(); opt.step()
    X, y = class_batch(2000, few)
    rand = torch.sign(torch.randint(0, 2, y.shape, generator=g) - 0.5)
    accs = []
    for name, demo in (("gold", y), ("random", rand), ("flipped", -y)):
        lab = torch.cat([demo[:, :14], y[:, 14:]], 1)         # demonstrations 1..14 carry the altered labels
        with torch.no_grad():
            accs.append(f"{name} labels {((m(X, lab)[:, 14] > 0).float() * 2 - 1 == y[:, 14]).float().mean():.3f}")
    print(("pretrained on 4 tasks:  " if few else "pretrained on fresh tasks:"), " | ".join(accs))
```

</details>

Reading it, part by part:
- **(1) Induction:** the first copy is unpredictable, so its loss stays near `ln 64 = 4.16`. The 2-layer model's second-copy loss sits at 4.01 at step 600 and falls to 0.60 by step 700, then 0.10: an abrupt change, not a gradual one. Two layer-1 heads attend to the previous token (0.45, 0.53), and all four layer-2 heads put 0.95 of their attention on the token after the earlier copy, the two halves of Olsson et al.'s circuit ✅[^6]. The 1-layer model only falls to 3.76 by step 1000, short even of the about `ln 20 ≈ 3.0` that guessing uniformly among the 20 distinct tokens of an average copy would give. The first-copy loss rises to 4.41 during the jump: in this setup the model now bets on tokens seen earlier, which never come next inside the first copy.
- **(2) Regression:** for `k < d` the transformer tracks least squares (0.586 vs 0.565 at `k = 2`). At `k = d = 5` least squares is exact and this 4,000-step toy still errs 0.143, falling to 0.014 by `k = 14`; Garg et al.'s far larger model reached 0.02 at `k = d` ✅[^4]. Both simple baselines stay far behind, as in the paper.
- **(3) LSA = GD:** the trained layer's error (0.363) nearly equals one GD step's (0.362), and their predictions correlate at 0.9993. Both are far from least squares; in von Oswald et al., stacking layers adds steps and beats plain GD ✅[^5].
- **(4) Labels:** the 4-task model reads which task it is from the input region and keeps 0.988 accuracy whatever the labels say. The fresh-task model must learn `w` from the labels, falls to chance (0.488) with random ones and inverts (0.130) with flipped ones.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Random labels in the demonstrations of a large LM (language model) | Accuracy drops only 0–5 % absolute | The mapping is recovered from pretraining; demonstrations locate the task ✅[^3] |
| Same with a task the model must learn from the prompt | Accuracy follows the labels (lab: flipped 0.130) | Task learning, not recognition ✅[^9]; synthetic tasks may use labels more ✅[^3] |
| Demonstrations from another input distribution | 3–16 % absolute lost for three model variants | Input distribution is one of the four aspects ✅[^3] |
| One-shot worse than zero-shot | The model repeats the single example's class | Majority label bias ✅[^8] |
| Three Positive examples, then one Negative (`P P P N`) | Nearly 90 % of predictions Negative | Recency bias outweighs majority label bias ✅[^8] |
| Adding demonstrations beyond `k = 8` | Little further gain in Min et al.'s runs | Their hypothesis: format, inputs and label space are recovered from few examples ✅[^3] |
| Chain-of-thought with a small model | Worse than standard prompting | Fluent but illogical chains below about 100B parameters ✅[^7] |
| One-layer transformer | No induction heads; lab second-copy loss only falls to 3.76 by step 1000 | The circuit needs heads in two layers ✅[^6]; lab ✅[^9] |
| Regression prompt with exactly `k = d` examples | Least squares exact; the toy model still 0.143 | Needs an exact inverse; Garg's model 0.02 ✅[^4]; lab ✅[^9] |
| Rare label names | The model under-predicts those classes | Common token bias ✅[^8] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Few-shot prompting | No weight updates; far less task-specific data ✅[^1] | Main disadvantage named by GPT-3's authors: results so far much worse than state-of-the-art fine-tuned models; `K` capped by the context window ✅[^1]; order and format sensitivity ✅[^8] |
| Chain-of-thought exemplars | 17.9 % → 56.9 % on GSM8K for PaLM 540B ✅[^7] | Works only at large scale, which is costly to serve; no guarantee the chain is correct ✅[^7] |
| Contextual calibration | Up to 30.0 % absolute, lower variance, no labelled data ✅[^8] | Trivial extra compute (the paper averages three content-free inputs); the choice of content-free input matters ✅[^8] |
| Fine-tuning instead | Supervises a mapping the model has not captured, where Min et al. expect in-context learning may not work ✅[^3] | Training cost and labelled data (`machine-learning/transformers/fine-tuning-and-lora.md`) |

## Takeaways
- Check label quality last and format first: the template, the label words and inputs like the real ones carry most of a large model's few-shot gain. [rule-candidate]
- Before trusting a few-shot result, re-run it with the demonstrations in another order and report the spread. [rule-candidate]
- If the task's rule is not something the model could have learned in pretraining, expect demonstrations to work like training data, wrong labels included.
- Chain-of-thought is a large-model tool; on a small model, measure it against plain prompting before adopting it.

## Verification status
- Verified: 73 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [Language Models are Few-Shot Learners](https://arxiv.org/html/2005.14165v4) — Brown et al., 2020. Backs: few-, one- and zero-shot definitions, `K` of 10–100 in a 2,048-token window, no weight updates, inner and outer loop, agnostic terms, the main disadvantage versus fine-tuning. [^1]
- [A Survey on In-context Learning](https://arxiv.org/html/2301.00234v6) — Dong et al., 2024 (v6). Backs: the formal scoring definition, ICL vs few-shot learning, later findings on label mappings, task recognition vs task learning, the GD-view debate and higher-order optimization, order sensitivity, query-similar demonstrations. [^2]
- [Rethinking the Role of Demonstrations: What Makes In-Context Learning Work?](https://arxiv.org/html/2202.12837v2) — Min et al., 2022. Backs: 12 models, 26 datasets, `k = 16`, the 0–5 % random-label drop, the four aspects and their measured effects, `k ≥ 8`, MetaICL, task location, the synthetic-task caveat. [^3]
- [What Can Transformers Learn In-Context? A Case Study of Simple Function Classes](https://arxiv.org/html/2208.01066v3) — Garg, Tsipras, Liang, Valiant, 2022. Backs: the prompt construction and training objective, the 9.5M-parameter model, normalized error, 0.02 at `k = d` and 0.0006 at `2d`, the baselines, the memorization argument. [^4]
- [Transformers Learn In-Context by Gradient Descent](https://arxiv.org/html/2212.07677v2) — von Oswald et al., 2023. Backs: linear self-attention, the one-step GD construction from `W₀ = 0`, trained LSA matching it, `K` layers and GD++. [^5]
- [In-context Learning and Induction Heads](https://transformer-circuits.pub/2022/in-context-learning-and-induction-heads/index.html) — Olsson et al., Transformer Circuits Thread, 2022. Backs: the previous-token and induction heads, why two layers, prefix matching and copying, the in-context learning score, the phase change between 2.5 and 5 billion tokens, 0.15 and 0.4 nats. [^6]
- [Chain-of-Thought Prompting Elicits Reasoning in Large Language Models](https://arxiv.org/html/2201.11903v6) — Wei et al., 2022. Backs: the method, GSM8K 17.9 % → 56.9 % for PaLM 540B, emergence around 100B parameters, the three ablations, when it helps, its limitations. [^7]
- [Calibrate Before Use: Improving Few-Shot Performance of Language Models](https://arxiv.org/html/2102.09690v2) — Zhao, Wallace, Feng, Klein, Singh, 2021. Backs: the sentiment prompt, 54.3–93.4 % from order alone, the three biases with their numbers, contextual calibration with `W = diag(p_cf)⁻¹`, 61.8 % Positive for `N/A`, up to 30.0 % gains. [^8]
- `machine-learning/lab-setup.md` — the lab where the induction-head, in-context regression, linear-attention and label experiments ran on 2026-11-25. [^9]

## Related
- `machine-learning/transformers/attention-and-the-transformer.md` — the attention heads, causal mask and residual stream these circuits are built from.
- `machine-learning/deep-learning/meta-learning-and-few-shot-learning.md` — few-shot learning with weight updates, which in-context learning replaces with a forward pass.
- `machine-learning/transformers/pretraining-and-scaling-laws.md` — the next-token pretraining from which in-context ability emerges.
- `machine-learning/transformers/fine-tuning-and-lora.md` — instruction tuning and adapters, the alternative to prompting.
- `machine-learning/transformers/multimodal-models.md` — Flamingo's few-shot prompting with interleaved images and text.
- `machine-learning/deep-learning/interpretability-and-attribution.md` — circuits, features and superposition, the framework behind induction heads.
- `machine-learning/evaluation/probability-calibration.md` — calibration in general, of which contextual calibration is a data-free special case.
- `ai-agents/prompt-engineering-deep-dive.md` — practical prompt design for LLM applications.
