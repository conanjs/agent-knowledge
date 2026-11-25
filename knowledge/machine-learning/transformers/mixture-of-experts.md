---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/transformers
status: verified
applies-to: ["PyTorch 2.15.0 (lab, plain torch)", "any"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [machine-learning, transformers, mixture-of-experts, moe, sparse-moe, top-k-gating, router, load-balancing, auxiliary-loss, switch-transformer, capacity-factor, expert-parallelism, mixtral]
---

# Mixture of experts

## Summary
**TL;DR:** A sparse mixture-of-experts (MoE) layer replaces one feed-forward network with many ("experts") plus a small router. The router scores the experts for each token, only the top `k` run (1 in Switch Transformer, 2 in Mixtral), and their outputs are summed with the router's weights. Parameters grow with the number of experts while the compute per token grows only with `k`: Mixtral has 47B (billion) parameters in total but uses 13B per token. Left alone, the router collapses onto a few experts, so training adds an auxiliary load-balancing loss, `α·N·Σ fᵢ·Pᵢ` in Switch Transformer. Each expert also has a fixed capacity (tokens per batch ÷ experts × capacity factor); tokens beyond it are dropped and skip the layer through the residual connection.
**Use this when:** you read a model card that gives "total" and "active" parameters, implement or debug an MoE layer, see some experts starved and others overloaded, tune the capacity factor or the auxiliary-loss weight, or size memory for an MoE model.
**Not this doc:** the dense feed-forward network an expert replaces → `machine-learning/transformers/attention-and-the-transformer.md`; how parameters and compute relate to loss → `machine-learning/transformers/pretraining-and-scaling-laws.md`; spreading experts over devices in detail → `machine-learning/deep-learning/distributed-training.md`.

## Problem
In a dense transformer every token passes through every parameter, so doubling the parameters doubles the compute per token. An MoE layer breaks that link, which is how its paper reached greater than 1000× more model capacity with only minor losses in computational efficiency ✅[^1]. The price is a new failure mode: the router tends to converge to always giving large weights to the same few experts, and the imbalance is self-reinforcing, because favoured experts train faster and get chosen even more ✅[^1]. In the lab, a top-2 layer trained without a balancing loss sent 92 % of its assignments to 2 of its 8 experts, and with a capacity factor of 1.25 it would have dropped 61 % of them ✅[^4]. An engineer has to read "47B total, 13B active" correctly and keep the router balanced.

## Mental model
**Analogy:** a hospital triage desk. Each patient (token) is seen by a nurse (the router) who sends them to the two most suitable specialists (experts) out of eight, and the final opinion blends the two specialists' reports by the nurse's confidence. The hospital employs eight specialists (total parameters), but each patient costs only two consultations (active parameters). If the nurse sends everyone to the cardiologist, the queue overflows: each specialist sees at most a fixed number of patients per hour (capacity), and the rest are sent home untreated (dropped tokens). Management therefore pays the nurse a bonus for spreading patients evenly (the auxiliary loss).

**Artifact:** the forward pass of a top-2 MoE layer, from the lab script:

```python
probs = F.softmax(self.router(x), dim=-1)          # (tokens, experts)
top_p, top_i = probs.topk(2, dim=-1)               # 2 experts per token
gates = top_p / top_p.sum(-1, keepdim=True)        # their weights sum to 1
for e in range(E):                                 # expert e sees only its tokens
    tok, slot = (top_i == e).nonzero(as_tuple=True)
    y.index_add_(0, tok, gates[tok, slot, None] * self.experts[e](x[tok]))
```

## How it works
### The sparse MoE layer (Shazeer et al., 2017)
1. **Output:** `y = Σᵢ G(x)ᵢ · Eᵢ(x)` over the `n` experts, where `G(x)` is the gate (router) output and `Eᵢ` the `i`-th expert network ✅[^1]. When `G(x)ᵢ = 0`, expert `i` is not computed at all; that is what makes the layer sparse.
2. **Noisy top-k gating:** `H(x)ᵢ = (x·W_g)ᵢ + StandardNormal() · Softplus((x·W_noise)ᵢ)`, then `KeepTopK` sets every score outside the top `k` to `−∞`, then `G(x) = Softmax(KeepTopK(H(x), k))` ✅[^1]. The `−∞` scores get probability exactly 0. Example: scores `(2.0, 0.5, 1.0, −1.0)` with `k = 2` keep experts 1 and 3, `softmax(2.0, 1.0) = (0.73, 0.27)`.
3. **Scale in the paper:** up to thousands of experts, and an MoE with up to 137 billion parameters placed between stacked LSTM (long short-term memory) layers; 4 experts were active per input in its language-model experiments ✅[^1].
4. **Shrinking batch:** with `k` of `n` experts per example, each expert sees only about `k·b/n` of a batch of `b` examples, too few for efficient GPU (graphics processing unit) work; the paper grows the expert batches by combining data and model parallelism ✅[^1].
5. **Balancing in the original paper:** an importance loss, a tuned weight times the squared coefficient of variation (standard deviation ÷ mean) of each expert's summed gate values over the batch, plus a load loss on a smooth estimate of how many examples each expert receives, because equal importance does not guarantee equal load ✅[^1].

### Switch Transformer: top-1 routing, capacity, a simpler balance loss
6. **One expert per token:** the Switch layer routes each token to a single expert, which the authors report keeps quality while cutting router computation and communication ✅[^2].
7. **Expert capacity:** `capacity = (tokens per batch ÷ number of experts) × capacity factor`; a factor above 1.0 leaves a buffer for uneven routing ✅[^2]. Example: 8,192 assignments, 8 experts, factor 1.25 → 1,280 slots per expert. The paper found Switch models do better at low factors (1.0, 1.25) ✅[^2].
8. **Dropped tokens:** a token routed to a full expert is not computed by it and is passed directly to the next layer through the residual connection ✅[^2]; for that layer the token simply keeps its input vector.
9. **Auxiliary load-balancing loss:** `loss_aux = α · N · Σᵢ fᵢ · Pᵢ`, where `fᵢ` is the fraction of tokens dispatched to expert `i`, `Pᵢ` the fraction of router probability given to expert `i` over the batch, `N` the number of experts, and `α = 10⁻²` ✅[^2]. It is minimized under uniform routing ✅[^2]: with `fᵢ = Pᵢ = 1/N` the sum is `N · N · (1/N²) = 1`, the value the balanced lab runs print. `fᵢ` is a count and has no gradient; the gradient reaches the router through `Pᵢ`, pushing probability away from experts that already get many tokens.
10. **Stability and scale:** the router is computed in float32 while the rest of the model uses bfloat16 ✅[^2]. The paper reports up to 7× faster pre-training than T5 models for the same compute, and models up to 1.6 trillion parameters with 2,048 experts ✅[^2].

### Total vs active parameters (Mixtral)
11. **Where the experts sit:** in Mixtral each layer has 8 feed-forward blocks (SwiGLU experts), the MoE layer replaces the feed-forward sub-block of each transformer block, and a router picks 2 experts per token at every layer ✅[^3]. The gate is a softmax over the top-2 router logits ✅[^3], which equals the lab's softmax over all logits renormalized over the top 2.
12. **The two numbers:** each token has access to 47B parameters but uses only 13B active ones during inference ✅[^3], so compute per token is that of a 13B dense model while memory must hold all 47B. 13/47 is 28 %, more than `2/8`, because some layers run for every token: in the lab the shared router alone lifts the active share from 25 % to 25.6 % ✅[^4], and in a transformer the attention layers are shared the same way.
13. **What experts learn:** Mixtral's authors saw no obvious assignment of experts by topic, but did see syntax-related patterns and repeated choices for consecutive tokens ✅[^3].

### Expert parallelism (briefly)
14. With expert parallelism, each device holds some of the experts and tokens are sent to the device of their expert ✅[^3]; Switch Transformer gives each core its own expert and moves tokens between cores with all-to-all communication ✅[^2]. Imbalance then becomes a device-load problem too ✅[^3]. The communication pattern and its cost are in `machine-learning/deep-learning/distributed-training.md`.

## Worked example
A top-2 MoE layer (8 experts, each `16 → 64 → 16` with ReLU) learns to imitate a fixed random teacher network on inputs that share a common offset, for 400 Adam steps of 512 tokens, three times: without the auxiliary loss (`α = 0`), with `α = 0.01` (the Switch value) and with `α = 0.1`, from the same seed. "Share" is each expert's fraction of the 8,192 top-2 assignments of 4,096 held-out tokens; the lab only counts the tokens that a capacity factor of 1.25 would drop and does not drop them during training. Lab run (`machine-learning/lab-setup.md`), 2026-11-24, PyTorch 2.15.0, two runs identical ✅[^4]:

```text
at init           : share per expert [0.023, 0.117, 0.297, 0.175, 0.067, 0.075, 0.109, 0.138] | max/mean 2.37 | dropped at capacity factor 1.25: 1305/8192 (15.9 %)
trained, alpha=0.0 : share per expert [0.485, 0.045, 0.007, 0.005, 0.002, 0.004, 0.439, 0.014] | max/mean 3.88 | dropped at capacity factor 1.25: 5006/8192 (61.1 %) | task MSE 0.0009 | aux 2.632
trained, alpha=0.01: share per expert [0.13, 0.123, 0.125, 0.125, 0.121, 0.131, 0.118, 0.127] | max/mean 1.05 | dropped at capacity factor 1.25: 0/8192 (0.0 %) | task MSE 0.0014 | aux 1.000
trained, alpha=0.1 : share per expert [0.124, 0.119, 0.125, 0.13, 0.115, 0.122, 0.136, 0.129] | max/mean 1.09 | dropped at capacity factor 1.25: 0/8192 (0.0 %) | task MSE 0.0014 | aux 1.001
parameters: total 17152 = router 128 + 8 experts x 2128
active per token: router 128 + 2 x 2128 = 4384 (25.6 % of total)
```

<details><summary>Full script (prints the output above)</summary>

```python
# Top-2 mixture-of-experts layer in plain torch: routing balance with and without the auxiliary loss,
# expert capacity and dropped tokens, total vs active parameters.
import torch
from torch import nn
import torch.nn.functional as F

D, H, E, K = 16, 64, 8, 2                      # model width, expert hidden width, experts, experts per token

class Top2MoE(nn.Module):
    def __init__(self):
        super().__init__()
        self.router = nn.Linear(D, E, bias=False)
        self.experts = nn.ModuleList(nn.Sequential(nn.Linear(D, H), nn.ReLU(), nn.Linear(H, D)) for _ in range(E))

    def forward(self, x):                                        # x: (tokens, D)
        probs = F.softmax(self.router(x), dim=-1)                # router probability per expert
        top_p, top_i = probs.topk(K, dim=-1)                     # keep the 2 best experts per token
        gates = top_p / top_p.sum(-1, keepdim=True)              # renormalize the 2 weights to sum to 1
        y = torch.zeros_like(x)
        for e in range(E):                                       # each expert runs only on its own tokens
            tok, slot = (top_i == e).nonzero(as_tuple=True)
            if tok.numel():
                y.index_add_(0, tok, gates[tok, slot, None] * self.experts[e](x[tok]))
        # Switch-style balance loss  N * sum_i f_i * P_i  (f: share of assignments, P: mean router probability)
        f = torch.bincount(top_i.flatten(), minlength=E).float() / top_i.numel()
        aux = E * (f * probs.mean(0)).sum()
        return y, aux, top_i

def load_report(top_i, cf=1.25):
    counts = torch.bincount(top_i.flatten(), minlength=E)
    capacity = int(cf * top_i.numel() / E)                       # slots per expert = cf * assignments / experts
    dropped = (counts - capacity).clamp(min=0).sum().item()
    share = counts.float() / counts.sum()
    return (f"share per expert {[round(s, 3) for s in share.tolist()]} | max/mean {share.max().item() * E:.2f}"
            f" | dropped at capacity factor {cf}: {dropped}/{top_i.numel()} ({100 * dropped / top_i.numel():.1f} %)")

torch.manual_seed(0)
offset = 3 * torch.randn(D) / D ** 0.5                          # inputs share a common direction
teacher = nn.Sequential(nn.Linear(D, 32), nn.Tanh(), nn.Linear(32, D))
def batch(n=512):
    x = torch.randn(n, D) + offset
    with torch.no_grad():
        return x, teacher(x)

for alpha in [0.0, 0.01, 0.1]:
    torch.manual_seed(1)                                         # same init and data for every alpha
    moe = Top2MoE()
    opt = torch.optim.Adam(moe.parameters(), lr=3e-3)
    x_eval, y_eval = batch(4096)
    if alpha == 0.0:
        with torch.no_grad(): print("at init           :", load_report(moe(x_eval)[2]))
    for step in range(400):
        x, y = batch()
        out, aux, _ = moe(x)
        loss = F.mse_loss(out, y) + alpha * aux
        opt.zero_grad(); loss.backward(); opt.step()
    with torch.no_grad():
        out, aux, top_i = moe(x_eval)
        print(f"trained, alpha={alpha:<4}: {load_report(top_i)} | task MSE {F.mse_loss(out, y_eval).item():.4f}"
              f" | aux {aux.item():.3f}")

total = sum(p.numel() for p in moe.parameters())
per_expert = sum(p.numel() for p in moe.experts[0].parameters())
router = moe.router.weight.numel()
print(f"parameters: total {total} = router {router} + {E} experts x {per_expert}")
print(f"active per token: router {router} + {K} x {per_expert} = {router + K * per_expert} "
      f"({100 * (router + K * per_expert) / total:.1f} % of total)")
```

</details>

Reading it:
- **Collapse without the loss:** at initialization the shares already range from 2.3 % to 29.7 % because the shared input offset favours some experts. After training without the loss, experts 0 and 6 take 48.5 % and 43.9 % of all assignments; with 2 picks per token and at most one per expert, 0.5 is the maximum share, so expert 0 serves 97 % of the tokens. The auxiliary loss reads `2.632` against the balanced value 1.
- **Dropped tokens:** with 1,280 slots per expert, that routing would drop 5,006 of 8,192 assignments (61.1 %), against 15.9 % at initialization.
- **With the loss:** `α = 0.01` brings every share to 11.8–13.1 % (ideal 12.5 %), the busiest expert to 1.05× the mean and the drops to 0; `α = 0.1` gives almost the same picture.
- **Quality cost:** the task error is `0.0009` without the loss and `0.0014` with it. This toy task is easy and the lab does not enforce capacity, so the collapsed model loses nothing for its imbalance; in a real model the overflowing tokens would skip the layer and the starved experts' devices would sit idle.
- **Parameters:** each expert has `16·64 + 64 + 64·16 + 16 = 2,128` parameters; 8 experts and the 128-weight router give 17,152 in total, and a token uses the router and 2 experts, 4,384 parameters, 25.6 % of the total.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| No balancing loss | A few experts win almost every token (lab: 2 of 8 take 92 %) | Self-reinforcing imbalance ✅[^1]; lab ✅[^4] |
| Capacity factor too small | Tokens overflow and skip the layer | Dropped tokens use the residual path ✅[^2] |
| Capacity factor large | Fewer drops, but more computation, memory and communication, with empty slots padded | Switch paper's Figure 3 and §2.2 ✅[^2] |
| Balance loss weight too large | Balance starts to override the task loss | `α = 10⁻²` was chosen to balance without overwhelming the main objective ✅[^2] |
| Router in bfloat16 | Training instability | Switch casts the router to float32 ✅[^2] |
| Many experts, small batch | Each expert gets about `k·b/n` examples | Shrinking batch problem ✅[^1] |
| Reading "47B" as compute | Per-token compute matches the 13B active parameters, memory the 47B | Mixtral's figures ✅[^3] |
| Expecting topic experts | Mixtral's experts show no clear topic pattern | Its routing analysis ✅[^3] |
| `fᵢ` used as the only balance term | No gradient reaches the router from a count | The loss multiplies by the differentiable `Pᵢ` ✅[^2] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Dense FFN | Every parameter trained on every token; no routing | Compute grows with every added parameter |
| Sparse MoE | Capacity grows with experts at near-constant compute per token ✅[^1] | All experts must sit in memory ✅[^3]; balancing and capacity to tune ✅[^2] |
| Top-1 (Switch) | Less router compute and communication ✅[^2] | Each token gets one expert's view |
| Top-2 (Mixtral) | Two experts combined per token ✅[^3] | Twice the expert compute of top-1 |
| Capacity factor 1.0–1.25 | Better results in Switch's experiments ✅[^2] | More dropped tokens if routing is uneven ✅[^2] |
| Expert parallelism | Experts spread over devices ✅[^2] | All-to-all traffic and device-level imbalance ✅[^3] |

## Takeaways
- Log the per-expert token share and the dropped-token fraction every few hundred steps; a share far above `1/N` or rising drops mean the router is collapsing. [rule-candidate]
- Start the Switch balance loss at `α = 0.01`, compute the router in float32, and a capacity factor of 1.0–1.25.
- Size memory by total parameters and throughput by active parameters; quote both.
- When implementing top-k gating, take the softmax over the selected logits (or renormalize the selected probabilities) so the `k` weights sum to 1.

## Verification status
- Verified: 44 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- [Outrageously Large Neural Networks: The Sparsely-Gated Mixture-of-Experts Layer](https://ar5iv.labs.arxiv.org/html/1701.06538) — Shazeer, Mirhoseini, Maziarz, Davis, Le, Hinton, Dean, 2017. Backs: MoE output, noisy top-k gating, 1000× capacity, thousands of experts, 137B parameters, 4 active experts, self-reinforcing imbalance, importance and load losses, shrinking batch. [^1]
- [Switch Transformers: Scaling to Trillion Parameter Models with Simple and Efficient Sparsity](https://ar5iv.labs.arxiv.org/html/2101.03961) — Fedus, Zoph, Shazeer, 2021. Backs: top-1 routing, capacity formula and factors, dropped tokens via the residual, auxiliary loss and `α`, uniform minimum, float32 router, cost of a large capacity factor, 7× speed-up, 1.6T parameters and 2,048 experts, expert parallelism with all-to-all. [^2]
- [Mixtral of Experts](https://ar5iv.labs.arxiv.org/html/2401.04088) — Jiang et al., 2024. Backs: 8 SwiGLU experts, top-2, MoE replaces the FFN sub-block, softmax over top-2 logits, 47B total vs 13B active, expert parallelism and load balance, routing analysis. [^3]
- `machine-learning/lab-setup.md` — the lab where the top-2 MoE script in the Worked example ran on 2026-11-24 (routing balance with and without the auxiliary loss, capacity counts, parameter counts). [^4]

## Related
- `machine-learning/transformers/attention-and-the-transformer.md` — the transformer block and the feed-forward sub-block that experts replace.
- `machine-learning/transformers/pretraining-and-scaling-laws.md` — parameters, data and compute; MoE separates parameters from compute per token.
- `machine-learning/deep-learning/distributed-training.md` — data, model and expert parallelism and their communication.
- `machine-learning/transformers/efficient-attention-and-state-space-models.md` — the other main route to cheaper transformers: cheaper attention instead of a cheaper FFN.
