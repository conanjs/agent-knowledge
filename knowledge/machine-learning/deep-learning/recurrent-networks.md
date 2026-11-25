---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/deep-learning
status: verified
applies-to: ["PyTorch 2.15.0"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, deep-learning, rnn, recurrent-neural-network, backpropagation-through-time, bptt, vanishing-gradients, exploding-gradients, lstm, gru, gates, gradient-clipping, clip-grad-norm, sequence-models]
---

# Recurrent networks: RNN, LSTM and GRU

## Summary
**TL;DR:** A recurrent neural network (RNN) reads a sequence one step at a time and carries a hidden state forward, using the same weights at every step. Training unrolls the loop and runs backpropagation through the unrolled graph (BPTT, backpropagation through time), so the gradient that links step `t` to a later step is a product of one factor per step in between, and over long sequences it vanishes or explodes. The LSTM (long short-term memory) adds a memory cell updated by addition, `c_t = f_t ⊙ c_{t−1} + i_t ⊙ g_t`, so the gradient along the cell is scaled by the forget gate `f_t` and survives when the gate stays near 1; the GRU (gated recurrent unit) does the same with two gates instead of three. Gradient-norm clipping caps exploding gradients; attention replaced recurrence because it needs no step-by-step computation.
**Use this when:** you train or read code that uses `nn.RNN`, `nn.LSTM` or `nn.GRU`, see a sequence model ignore early inputs or produce NaN (not a number) losses, set `clip_grad_norm_`, or need to explain why transformers displaced RNNs.
**Not this doc:** the backpropagation mechanism itself → `machine-learning/deep-learning/neural-networks-and-backpropagation.md`; vanishing gradients in deep feed-forward stacks → `machine-learning/deep-learning/activations-and-initialization.md`; attention and the transformer → `machine-learning/transformers/attention-and-the-transformer.md`.

## Problem
Text, audio and time series have order and variable length, and the answer at one step can depend on an input far back. A vanilla RNN can represent such dependencies, but training it is another matter: in the worked example, the last output of a 100-step tanh (hyperbolic tangent) RNN depends on its first input through a gradient of `2.9e-27`, and on the input 50 steps back through `3.4e-14` ✅[^9]. In the other direction, an occasional massive gradient can destabilize training, which is why gradient clipping is "vital" for RNN training ✅[^1].

## Mental model
**Analogy:** a whisper game along a line of 100 people. In a vanilla RNN, every person rewrites the whole message in their own words before passing it on, so after 50 people the first words are gone, or garbled into shouting. The LSTM adds a notebook passed along beside the whispers: each person may cross out entries (forget gate), add new ones (input gate) and read from it (output gate), but if nobody crosses anything out, what was written at the start arrives unchanged. Gradient clipping is a volume limiter on the backward pass: it caps how loud the correction can be, without changing what it says.

**Artifact:** one LSTM step by hand, from the gate equations, against `nn.LSTM`; printed by the full script in the Worked example; lab run (`machine-learning/lab-setup.md`), 2026-11-24, PyTorch 2.15.0 ✅[^9]:

```python
gates = x[0] @ lstm.weight_ih_l0.T + lstm.bias_ih_l0 + lstm.bias_hh_l0     # h_0 = c_0 = 0
i, f, g, o = gates.chunk(4, dim=-1)                                         # PyTorch's order
c1 = torch.sigmoid(f) * 0 + torch.sigmoid(i) * torch.tanh(g)               # c_t = f*c_{t-1} + i*g
h1 = torch.sigmoid(o) * torch.tanh(c1)                                      # h_t = o*tanh(c_t)
```

```text
== (1) one LSTM step by hand (gate order i, f, g, o) ==
max |hand - nn.LSTM| = 0.0 | mean forget gate at init: 0.526
```

The hand step matches exactly, and with default initialization the forget gate is about 0.5, not 1: an untrained LSTM forgets half its cell at every step.

## How it works
### The recurrent layer
1. **Update:** `h_t = tanh(x_t·W_ihᵀ + b_ih + h_{t−1}·W_hhᵀ + b_hh)`, where `x_t` is the input at step `t`, `h_{t−1}` the previous hidden state (zeros at the start), `W_ih` the input-to-hidden weights and `W_hh` the hidden-to-hidden weights ✅[^2]. Example with one unit, `W_ih = 0.5`, `W_hh = 0.9`, no bias and inputs `(1, 0, 0)`: `h_1 = tanh(0.5) = 0.462`, `h_2 = tanh(0.9 × 0.462) = 0.393`, `h_3 = tanh(0.9 × 0.393) = 0.340`.
2. **Shared weights:** the same parameters are used at every time step, so the parameter count does not grow with the sequence length ✅[^3].

### Backpropagation through time (BPTT)
1. **Unroll:** BPTT expands the RNN one step at a time into a feed-forward network whose layers share the same parameters, applies the chain rule, and sums each parameter's gradient over all the places it appears ✅[^1].
2. **A product per step:** the gradient reaching an earlier hidden state contains powers of `W_hhᵀ`; in the linear case, eigenvalues smaller than 1 vanish and larger than 1 diverge ✅[^1]. In the one-unit example, `∂h_3/∂h_1 = 0.9·(1 − h_2²) × 0.9·(1 − h_3²) = 0.761 × 0.796 = 0.605`: below 1 per step, so 50 steps of such factors are tiny.
3. **The precise condition:** Pascanu et al. show, for the linear case, that a largest eigenvalue of the recurrent matrix below 1 is sufficient for long-term components to vanish, and above 1 is necessary for them to explode; for a nonlinearity whose derivative is at most `γ`, the threshold becomes `1/γ`, which is 1 for tanh (`γ = 1`) and 4 for sigmoid (`γ = 1/4`) ✅[^4]. For explosion this is only a necessary condition ✅[^4], so a large `W_hh` alone does not guarantee one (lab, below) ✅[^9].
4. **Truncation:** stopping the backward sum after `τ` steps (truncated BPTT, done by detaching the gradient) works well in practice and biases the model towards short-term influence ✅[^1]. A 1,000-token text means about 1,000 matrix products forward and as many backward ✅[^1].

### LSTM: an additive memory cell
1. **Gates:** `i_t`, `f_t`, `o_t = σ(W·x_t + b + W_h·h_{t−1} + b_h)` (input, forget and output gates, each in (0, 1)) and the cell input `g_t = tanh(…)` ✅[^5].
2. **Cell and output:** `c_t = f_t ⊙ c_{t−1} + i_t ⊙ g_t`, `h_t = o_t ⊙ tanh(c_t)` ✅[^5]. PyTorch stacks the four blocks as `(W_ii|W_if|W_ig|W_io)` in a `(4·hidden_size, input_size)` matrix ✅[^5], the order the artifact unpacks.
3. **Why gradients survive:** if the forget gate is always 1 and the input gate always 0, the cell state passes unchanged to every later step; letting the model learn when to keep and when to change it alleviates the vanishing gradient problem ✅[^6]. Along the cell, each step multiplies the gradient by `f_t` (from `c_t = f_t ⊙ c_{t−1} + …`), so 99 steps at `f = 0.993` keep `0.993^99 ≈ 0.50` of it, and 99 steps at `f = 0.5` keep `0.5^99 ≈ 1.6e-30`.
4. **Clipping vs gating:** gradient clipping helps with exploding gradients; vanishing gradients needed a more elaborate solution, and the LSTM (Hochreiter and Schmidhuber, 1997) was one of the first and most successful ✅[^6].

### GRU: two gates
- `r_t` (reset) and `z_t` (update) are sigmoid gates; the candidate is `n_t = tanh(W_in·x_t + b_in + r_t ⊙ (W_hn·h_{t−1} + b_hn))` and `h_t = (1 − z_t) ⊙ n_t + z_t ⊙ h_{t−1}` ✅[^7]. With `z_t` near 1 the state is copied forward, like an open forget gate.
- PyTorch stores three blocks, `(3·hidden_size, input_size)` ✅[^7], so a GRU has 3 times the parameters of a vanilla RNN of the same size and an LSTM 4 times (1,344, 4,032 and 5,376 for 8 inputs and 32 units in the lab) ✅[^9].
- The GRU is a streamlined LSTM cell that often performs comparably and is faster to compute ✅[^8]; Chung et al. found both gated units clearly better than plain tanh units on raw speech data, while on polyphonic music all three were close (tanh had the best test score on one of the four music datasets); they could not say whether the GRU or the LSTM is better, because the winner depended on the dataset ✅[^10].

### Gradient-norm clipping
1. **Rule:** if the gradient's norm exceeds a threshold, rescale it to `threshold/‖g‖ · g` ✅[^4]; one heuristic for the threshold is the average norm over many updates, and training was not very sensitive to it in the authors' experiments ✅[^4].
2. **PyTorch:** `clip_grad_norm_(parameters, max_norm)` computes one norm over all parameters' gradients, as if concatenated into a single vector, modifies them in place, and returns that total norm ✅[^11].

### Why attention replaced recurrence
A recurrent layer's step-by-step computation prevents parallelizing within a training example ✅[^12]. Per layer, recurrence needs `O(n)` sequential operations and has an `O(n)` maximum path length between positions, against `O(1)` and `O(1)` for self-attention (big-O notation: `O(n)` grows in proportion to `n`, so doubling `n` doubles it, and `O(1)` stays constant); its cost per layer is `O(n·d²)` against `O(n²·d)`, so self-attention is also faster when the sequence length `n` is smaller than the representation size `d` ✅[^12]. The transformer reached a new state of the art in translation after 12 hours of training on eight GPUs (graphics processing units) ✅[^12].

## Worked example
How much the last output of a 100-step sequence depends on each earlier input: `|∂ sum(out_T) / ∂ x_t|` for a tanh RNN and an LSTM, 8 inputs and 32 units, each at its default initialization and with one change, then gradient clipping on the larger-weight RNN. The measurement:

```python
xs = x.clone().requires_grad_()
out, _ = model(xs)
out[-1].sum().backward()                              # loss = sum of the last output
g = xs.grad.double().norm(dim=(1, 2))                 # |d loss / d x_t| for every t, in float64
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-24, PyTorch 2.15.0, two runs identical ✅[^9]:

```text
== (2) |d out_T / d x_t|, T = 100 ==
RNN  default init        t=100:1.2e+00  t=90:3.0e-03  t=75:1.8e-07  t=50:3.4e-14  t=1:2.9e-27  |grad params| 1.8e+01
RNN  W_hh x 3            t=100:7.4e-01  t=90:1.2e+00  t=75:1.1e-01  t=50:8.6e-02  t=1:2.0e-03  |grad params| 1.1e+02
LSTM default init        t=100:3.8e-01  t=90:1.9e-03  t=75:7.0e-07  t=50:4.3e-12  t=1:3.5e-22  |grad params| 4.9e+00
LSTM forget bias +5      t=100:2.9e-01  t=90:9.6e-02  t=75:9.8e-02  t=50:2.2e-01  t=1:1.6e+00  |grad params| 2.7e+02
== (3) clip_grad_norm_ on the W_hh x 3 RNN ==
returned total norm 114.53 | norm after 1.0000 | cosine(before, after) 1.000000
parameters  RNN: 1344  GRU: 4032  LSTM: 5376
```

<details><summary>Full script (prints the output above)</summary>

```python
# (1) One LSTM step by hand equals nn.LSTM. (2) How much the last output depends on each earlier
# input: |d out_T / d x_t| over 100 steps for a vanilla RNN and an LSTM. (3) Gradient norm clipping.
import torch
from torch import nn
T, D, H = 100, 8, 32
torch.manual_seed(0)
x = torch.randn(T, 1, D)                                  # (seq_len, batch=1, features)

print("== (1) one LSTM step by hand (gate order i, f, g, o) ==")
lstm = nn.LSTM(D, H)
gates = x[0] @ lstm.weight_ih_l0.T + lstm.bias_ih_l0 + lstm.bias_hh_l0     # h_0 = c_0 = 0
i, f, g, o = gates.chunk(4, dim=-1)
c1 = torch.sigmoid(f) * 0 + torch.sigmoid(i) * torch.tanh(g)               # c_t = f*c_{t-1} + i*g
h1 = torch.sigmoid(o) * torch.tanh(c1)                                      # h_t = o*tanh(c_t)
print("max |hand - nn.LSTM| =", (h1 - lstm(x[:1])[0][0]).abs().max().item(),
      "| mean forget gate at init:", round(torch.sigmoid(f).mean().item(), 3))

def grads_through_time(model):
    xs = x.clone().requires_grad_()
    out, _ = model(xs)
    out[-1].sum().backward()                              # loss = sum of the last output
    g = xs.grad.double().norm(dim=(1, 2))                 # |d loss / d x_t| for every t, in float64
    pg = torch.cat([p.grad.flatten() for p in model.parameters()]).norm().item()
    model.zero_grad()
    return "  ".join(f"t={t + 1}:{g[t].item():.1e}" for t in [99, 89, 74, 49, 0]) + f"  |grad params| {pg:.1e}"

print("== (2) |d out_T / d x_t|, T = 100 ==")
torch.manual_seed(1); rnn = nn.RNN(D, H)                  # tanh RNN, default init
print("RNN  default init       ", grads_through_time(rnn))
with torch.no_grad(): rnn.weight_hh_l0.mul_(3.0)          # larger recurrent weights
print("RNN  W_hh x 3           ", grads_through_time(rnn))
torch.manual_seed(1); lstm = nn.LSTM(D, H)
print("LSTM default init       ", grads_through_time(lstm))
with torch.no_grad(): lstm.bias_ih_l0[H:2 * H] += 5.0     # forget-gate bias +5: sigmoid(5) = 0.993
print("LSTM forget bias +5     ", grads_through_time(lstm))

print("== (3) clip_grad_norm_ on the W_hh x 3 RNN ==")
out, _ = rnn(x); out[-1].sum().backward()
before = torch.cat([p.grad.flatten() for p in rnn.parameters()])
total = nn.utils.clip_grad_norm_(rnn.parameters(), max_norm=1.0)
after = torch.cat([p.grad.flatten() for p in rnn.parameters()])
print(f"returned total norm {total.item():.2f} | norm after {after.norm().item():.4f} | "
      f"cosine(before, after) {torch.cosine_similarity(before, after, dim=0).item():.6f}")
print("parameters  RNN:", sum(p.numel() for p in nn.RNN(D, H).parameters()),
      " GRU:", sum(p.numel() for p in nn.GRU(D, H).parameters()),
      " LSTM:", sum(p.numel() for p in nn.LSTM(D, H).parameters()))
```

</details>

Reading it, row by row:
- **RNN, default init:** the dependence falls by about 400 times in the last 10 steps (`1.2` → `3.0e-3`) and reaches `3.4e-14` at 50 steps back and `2.9e-27` at step 1: the loss at step 100 gives training practically no signal about the first input. The norms are taken in float64 on purpose: with float32's `.norm()` the squares of such small elements underflow, and the step-1 value prints as `0.0e+00` ✅[^9].
- **RNN, `W_hh × 3`:** larger recurrent weights stop the decay (`8.6e-2` at 50 steps back) and multiply the total parameter gradient by 6 (18 → 110), but the per-input gradient does not explode, consistent with a large `W_hh` being only a necessary condition for explosion ✅[^4].
- **LSTM, default init:** it vanishes as fast as the RNN (`4.3e-12` at 50 steps), because a forget gate near 0.5 halves the cell's gradient at every step.
- **LSTM, forget bias +5:** with `σ(5) = 0.993`, the dependence on the input 99 steps back is `1.6`, larger than on the last input (`0.29`). This bias was set by hand here to show what a trained LSTM can learn to do; the gates are learned parameters.
- **Clipping:** `clip_grad_norm_` returns the norm before clipping (114.53), leaves a norm of exactly 1.0, and keeps the direction (cosine 1.000000).

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Tensor passed as `(batch, seq, feature)` with defaults | Batch and time are swapped silently | `batch_first=False` by default: input is `(seq, batch, feature)` ✅[^5] |
| `batch_first=True` and the hidden state | `h_0` keeps the shape `(D·num_layers, N, H_out)` and `c_0` the shape `(D·num_layers, N, H_cell)` (`D` = 2 if bidirectional, else 1) | `batch_first` does not apply to hidden or cell states ✅[^5] |
| LSTM straight from initialization | Long-range gradients vanish like a vanilla RNN's | Forget gate ≈ 0.5 at default init (lab) ✅[^9] |
| Clipping used against vanishing gradients | No effect | Clipping helps with exploding gradients; vanishing ones appear to need a more elaborate solution, such as the LSTM's gates ✅[^6] |
| Large recurrent weights | May or may not explode | Largest eigenvalue > 1 is derived only as a necessary condition ✅[^4]; lab: no explosion of the per-input gradient ✅[^9] |
| Truncated BPTT with window `τ` | Dependencies longer than `τ` get no gradient | The sum stops after `τ` steps; the model favours short-term influence ✅[^1] |
| Element-wise clipping (an older alternative) | Each entry is clipped at a threshold | Mikolov's approach, which Pascanu et al. build on ✅[^4] |
| Batch normalization in an RNN | Needs separate statistics for each time step, a problem when a test sequence is longer than every training sequence | Layer norm computes its statistics separately at each time step ✅[^13]; details in `machine-learning/deep-learning/normalization-and-dropout.md` |
| GRU or LSTM? | Often similar results | Comparable in Chung et al., the better one depending on the dataset ✅[^10]; GRU has 3/4 of the LSTM's parameters (lab) ✅[^9] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Vanilla RNN | Fewest parameters (1,344 in the lab) ✅[^9]; weights shared over time ✅[^3] | Gradients vanish or explode over long ranges ✅[^1] |
| LSTM | Additive cell keeps gradients when the forget gate is open ✅[^6] | 4 times the RNN's parameters ✅[^9] |
| GRU | Comparable to LSTM ✅[^10], faster to compute ✅[^8] | 3 times the RNN's parameters ✅[^9] |
| Truncated BPTT | Bounded memory and compute per update ✅[^1] | Long dependencies lose their gradient ✅[^1] |
| Self-attention instead of recurrence | `O(1)` sequential steps and path length; parallel training ✅[^12] | `O(n²·d)` per layer, costly when `n` exceeds `d` ✅[^12] |

## Takeaways
- Clip the total gradient norm in every RNN training loop (`clip_grad_norm_` between `backward()` and `step()`), and log the norm it returns: a rising norm is an early warning. [rule-candidate]
- To check whether a sequence model can use early inputs, measure `|∂ output_T / ∂ x_t|` against `t`, as in the worked example; an untrained LSTM fails this too.
- Pass sequence tensors as `(seq, batch, feature)` or set `batch_first=True` explicitly. [rule-candidate]
- For new sequence work, start from attention; use recurrent layers when step-by-step state is the point (streaming, small memory).

## Verification status
- Verified: 54 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [Backpropagation Through Time (Dive into Deep Learning, 9.7)](https://d2l.ai/chapter_recurrent-neural-networks/bptt.html) — Zhang, Lipton, Li, Smola, living. Backs: clipping is vital, unrolling with shared parameters, summed gradients, powers of `W_hh` and eigenvalues, truncated BPTT, 1,000 matrix products. [^1]
- [torch.nn.RNN](https://docs.pytorch.org/docs/2.15/generated/torch.nn.RNN.html) — PyTorch, 2026 (2.15). Backs: the tanh RNN update. [^2]
- [Recurrent Neural Networks (Dive into Deep Learning, 9.4)](https://d2l.ai/chapter_recurrent-neural-networks/rnn.html) — Zhang, Lipton, Li, Smola, living. Backs: same parameters at every step, parameter cost independent of length. [^3]
- [On the difficulty of training Recurrent Neural Networks](https://arxiv.org/html/1211.5063v2) — Pascanu, Mikolov, Bengio, 2013 (v2). Backs: eigenvalue conditions (sufficient, necessary), norm clipping rule, threshold heuristic, Mikolov's element-wise clipping. [^4]
- [torch.nn.LSTM](https://docs.pytorch.org/docs/2.15/generated/torch.nn.LSTM.html) — PyTorch, 2026 (2.15). Backs: gate equations, gate order and weight shape, `batch_first` and hidden-state layout. [^5]
- [Long Short-Term Memory (LSTM) (Dive into Deep Learning, 10.1)](https://d2l.ai/chapter_recurrent-modern/lstm.html) — Zhang, Lipton, Li, Smola, living. Backs: constant cell with forget 1 and input 0, alleviates vanishing gradients, clipping vs vanishing, Hochreiter and Schmidhuber. [^6]
- [torch.nn.GRU](https://docs.pytorch.org/docs/2.15/generated/torch.nn.GRU.html) — PyTorch, 2026 (2.15). Backs: GRU equations, `(3·hidden_size, …)` weights. [^7]
- [Gated Recurrent Units (GRU) (Dive into Deep Learning, 10.2)](https://d2l.ai/chapter_recurrent-modern/gru.html) — Zhang, Lipton, Li, Smola, living. Backs: streamlined LSTM, comparable performance, faster to compute. [^8]
- `machine-learning/lab-setup.md` — the lab where the hand LSTM step, the gradient-through-time measurements, the clipping check and the parameter counts ran on 2026-11-24. [^9]
- [Empirical Evaluation of Gated Recurrent Neural Networks on Sequence Modeling](https://arxiv.org/html/1412.3555v1) — Chung, Gulcehre, Cho, Bengio, 2014 (full text read, PDF). Backs: gated units clearly better than tanh units on raw speech and close on music (Table 2, Figures 2–3); no clear winner between GRU and LSTM. [^10]
- [torch.nn.utils.clip_grad_norm_](https://docs.pytorch.org/docs/2.15/generated/torch.nn.utils.clip_grad_norm_.html) — PyTorch, 2026 (2.15). Backs: total norm over all gradients, in-place, return value. [^11]
- [Attention Is All You Need](https://arxiv.org/html/1706.03762v7) — Vaswani et al., 2017 (v7). Backs: sequential computation prevents parallelization, Table 1 complexity, sequential operations and path lengths, 12 hours on eight GPUs. [^12]
- [Layer Normalization](https://arxiv.org/html/1607.06450v1) — Ba, Kiros, Hinton, 2016. Backs: batch norm is hard to apply to RNNs; per-time-step statistics. [^13]

## Related
- `machine-learning/deep-learning/neural-networks-and-backpropagation.md` — the chain rule that BPTT unrolls.
- `machine-learning/deep-learning/activations-and-initialization.md` — the same vanishing and exploding products across layers.
- `machine-learning/deep-learning/normalization-and-dropout.md` — layer norm, the normalization that fits recurrent layers.
- `machine-learning/deep-learning/optimizers-and-learning-rate-schedules.md` — the optimizer step that follows clipping.
- `machine-learning/transformers/attention-and-the-transformer.md` — the architecture that replaced recurrence.
- `machine-learning/transformers/tokenization.md` — how text becomes the sequence of ids an RNN or transformer reads.
