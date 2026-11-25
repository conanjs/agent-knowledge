---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/transformers
status: verified
applies-to: ["any", "Hugging Face DPO trainer docs (main branch, latest stable v1.18.2) read 2026-11-24 for DPOConfig defaults"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [machine-learning, transformers, alignment, rlhf, reward-model, bradley-terry, ppo, kl-penalty, dpo, preference-learning]
---

# Alignment: reward models, RLHF and DPO

## Summary
**TL;DR:** After SFT (supervised fine-tuning), a model is tuned toward what people prefer. People compare two answers and pick the better one. A reward model is fitted to those comparisons with the Bradley–Terry loss `−log σ(r(y_w) − r(y_l))`. RLHF (reinforcement learning from human feedback) then maximizes that reward with PPO (proximal policy optimization) minus a KL (Kullback–Leibler) penalty that keeps the policy near the SFT model. The optimum of that objective has a closed form, `π*(y) ∝ π_ref(y) · exp(r(y)/β)`. DPO (direct preference optimization) uses it to train the policy straight from the preference pairs with one classification loss: no separate reward model, no sampling, no reinforcement-learning loop.
**Use this when:** you need to understand preference data, read a reward-model or DPO loss, choose `β`, or decide between RLHF with PPO and DPO.
**Not this doc:** the PPO algorithm itself → `machine-learning/reinforcement-learning/policy-gradients-and-ppo.md`; SFT and LoRA (low-rank adaptation) → `machine-learning/transformers/fine-tuning-and-lora.md`.

## Problem
A model trained only to predict text, or only to imitate demonstrations, does not know which of two plausible answers people prefer. Writing the ideal answer is costly, while comparing two answers is often easier ✅[^2]. Three hazards come with optimizing a learned judge of quality. It is an imperfect stand-in for people: pushed too far, its scores become anti-correlated with human preferences ✅[^4]. The policy can collapse onto one kind of answer ✅[^4] ✅[^2]. Alignment can also cost ability on other tasks, the "alignment tax" ✅[^1].

## Mental model
**Analogy:** a cooking contest with a judge who only says "dish A beats dish B". From many such verdicts you can infer a score per dish (the reward model). Then a cook can be trained to maximize the score (RLHF), held on a leash to their original style so they do not chase a quirk of the judge (the KL penalty). DPO skips the score sheet: it adjusts the cook's own habits directly from the verdicts, knowing in advance where the leashed cook would end up.

**Artifact:** the closed-form KL-regularized optimum on a toy prompt with 5 possible responses, for three leash strengths `β` (printed by the Worked example's full script; lab run, `machine-learning/lab-setup.md`, 2026-11-24, PyTorch 2.15.0 on the CPU (central processing unit)) ✅[^6]:

```text
beta=10.0: pi*=[0.272, 0.301, 0.222, 0.143, 0.061]  E[r]=1.000  KL=0.004
beta= 1.0: pi*=[0.078, 0.212, 0.384, 0.064, 0.261]  E[r]=1.797  KL=0.450
beta= 0.1: pi*=[0.0, 0.0, 0.0, 0.0, 1.0]  E[r]=3.000  KL=2.994
pi_ref     : E[r]=0.925
```

A loose leash (`β = 0.1`) puts all probability on the single highest-reward answer; a tight one (`β = 10`) barely moves from the reference.

## How it works
**Symbols:** `x` = a prompt; `y` = a response; `y_w`, `y_l` = the preferred ("winner") and dispreferred ("loser") response of a pair; `π_θ` = the policy being trained; `π_ref` = the reference policy, normally the SFT model; `r(x, y)` = a reward; `σ(z) = 1 / (1 + e^(−z))`; `β` = KL strength.

### RLHF in three steps (the InstructGPT recipe)
1. **SFT:** fine-tune the pretrained model on human demonstrations ✅[^1].
2. **Reward model (RM):** labelers rank 4 to 9 responses per prompt, giving `K·(K−1)/2` comparisons ✅[^1]. The RM is the SFT model with its output layer replaced by a scalar head ✅[^1]. It is trained with `loss = −log σ(r(x, y_w) − r(x, y_l))`, averaged over the comparisons ✅[^1].
   - This is the Bradley–Terry model: `P(y_1 ≻ y_2) = exp(r_1) / (exp(r_1) + exp(r_2)) = σ(r_1 − r_2)`, so the reward difference is the log-odds that one answer is preferred ✅[^2] ✅[^1]. Christiano et al. used the same form for preferences between trajectory segments in RL ✅[^5].
   - Worked number: if `r(y_w) = 1.2` and `r(y_l) = 0.2`, then `σ(1.0) = 0.731` and the loss is `−ln 0.731 = 0.313`.
3. **RL with PPO:** maximize `E[r(x, y)] − β · KL(π_θ ‖ π_ref)`. InstructGPT implements the penalty as a per-token KL term against the SFT model, "to mitigate over-optimization of the reward model", with `β = 0.02` ✅[^1]. The PPO-ptx (PPO with a pretraining mix) variant adds `γ · log π(x)` on pretraining data to reduce the alignment tax ✅[^1]. How PPO itself updates the policy: `machine-learning/reinforcement-learning/policy-gradients-and-ppo.md`.

**Why the KL term.** It keeps the policy where the reward model is accurate, and it preserves diversity instead of mode collapse ✅[^2]. Stiennon et al. describe it as both an entropy bonus and a guard against outputs unlike those the reward model saw ✅[^4]. Results: outputs of the 1.3B InstructGPT model were preferred to those of 175B GPT-3 (Generative Pre-trained Transformer 3) ✅[^1].

### DPO (direct preference optimization)
1. **Closed-form optimum.** For any reward `r`, the KL-constrained objective is maximized by `π_r(y | x) = π_ref(y | x) · exp(r(x, y) / β) / Z(x)`, where `Z(x)` sums the numerator over all `y` ✅[^2]. `Z` is expensive to compute ✅[^2].
2. **Invert it.** `r(x, y) = β · log(π_r(y | x) / π_ref(y | x)) + β · log Z(x)` ✅[^2].
3. **Cancel `Z`.** Bradley–Terry depends only on reward differences, so `β · log Z(x)` cancels between `y_w` and `y_l` ✅[^2].
4. **The loss:** `L_DPO = −E[ log σ( β·log(π_θ(y_w)/π_ref(y_w)) − β·log(π_θ(y_l)/π_ref(y_l)) ) ]` ✅[^2]. The quantity `r̂(y) = β · log(π_θ(y)/π_ref(y))` is the implicit reward: "your language model is secretly a reward model" ✅[^2].
5. **What the gradient does:** it raises `log π(y_w)` and lowers `log π(y_l)`. Each pair is weighted by `σ(r̂(y_l) − r̂(y_w))`, which is large when the implicit reward orders the pair wrongly ✅[^2]. Without that weighting the model can degenerate ✅[^2].
6. **Data and reference:** sample pairs from `π_ref`, label them, then minimize `L_DPO`. When `π_SFT` exists, set `π_ref = π_SFT`, since public preference data was sampled from an SFT model ✅[^2].

In Hugging Face's DPO trainer, `beta` defaults to 0.1; a higher `β` means less deviation from the reference model, and the default loss type is this sigmoid loss ✅[^3].

## Worked example
One prompt, 5 possible responses with a hidden reward `r = [0, 1, 2, 0.5, 3]` and a reference policy `π_ref = [0.30, 0.30, 0.20, 0.15, 0.05]`. Part 1 fits a Bradley–Terry reward model from sampled preferences. Part 2 (the artifact) computes the KL-regularized optimum. Part 3 evaluates the DPO loss on one pair. Part 4 trains a policy with DPO on the preference distribution and compares it with the optimum. Lab run (`machine-learning/lab-setup.md`), 2026-11-24, PyTorch 2.15.0 CPU, float64, two runs identical ✅[^6]:

```text
== 1. reward model from 4,000 Bradley-Terry preference pairs ==
pairs used: 2996  final loss: 0.5333
true reward minus its mean   : [-1.3, -0.3, 0.7, -0.8, 1.7]
learned reward minus its mean: [-1.26, -0.36, 0.69, -0.71, 1.64]
same loss after adding 5 to every reward: 0.5333

== 3. DPO loss on one pair (y_w = y4, y_l = y0), beta = 0.1 ==
policy = reference         : 0.6931 (= ln 2 = 0.6931 )
policy raised y_w by +2 nats: 0.5981
policy raised y_l by +2 nats: 0.7981

== 4. DPO on the expected preference data (pairs from pi_ref, labels by Bradley-Terry), beta = 1 ==
pi_DPO: [0.078, 0.2121, 0.3844, 0.0643, 0.2612]
pi*   : [0.078, 0.2121, 0.3844, 0.0643, 0.2612]  max |diff| = 3.8e-11
implicit reward differences h - h[0]: [0.0, 1.0, 2.0, 0.5, 3.0]  true r - r[0]: [0.0, 1.0, 2.0, 0.5, 3.0]
```

<details><summary>Full script (prints the output above)</summary>

```python
# Toy alignment on one prompt with 5 possible responses (float64):
# (1) Bradley-Terry reward model fitted from sampled preference pairs; (2) the KL-regularized optimum
# pi*(y) = pi_ref(y) exp(r(y)/beta) / Z for several beta; (3) the DPO loss on one pair; (4) DPO trained on
# preferences reaches the same pi* without a reward model or RL.
import torch, torch.nn.functional as F
torch.manual_seed(0); torch.set_default_dtype(torch.float64)

r_true = torch.tensor([0.0, 1.0, 2.0, 0.5, 3.0])           # hidden "human" reward of responses y0..y4
pi_ref = torch.tensor([0.30, 0.30, 0.20, 0.15, 0.05])       # the SFT model's probabilities
K = len(r_true)

print("== 1. reward model from 4,000 Bradley-Terry preference pairs ==")
i, j = torch.multinomial(pi_ref, 4000, replacement=True), torch.multinomial(pi_ref, 4000, replacement=True)
keep = i != j; i, j = i[keep], j[keep]
i_wins = torch.rand(len(i)) < torch.sigmoid(r_true[i] - r_true[j])   # P(i preferred) = sigma(r_i - r_j)
yw, yl = torch.where(i_wins, i, j), torch.where(i_wins, j, i)
r_hat = torch.zeros(K, requires_grad=True)                  # one learned score per response
opt = torch.optim.Adam([r_hat], lr=0.05)
for _ in range(2000):
    loss = -F.logsigmoid(r_hat[yw] - r_hat[yl]).mean()         # loss = -log sigma(r(y_w) - r(y_l))
    opt.zero_grad(); loss.backward(); opt.step()
print("pairs used:", len(yw), " final loss:", round(loss.item(), 4))
print("true reward minus its mean   :", [round(v, 2) for v in (r_true - r_true.mean()).tolist()])
print("learned reward minus its mean:", [round(v, 2) for v in (r_hat - r_hat.mean()).tolist()])
shift = -F.logsigmoid((r_hat + 5.0)[yw] - (r_hat + 5.0)[yl]).mean()
print("same loss after adding 5 to every reward:", round(shift.item(), 4))

print("\n== 2. KL-regularized optimum pi* = pi_ref * exp(r / beta) / Z ==")
def optimum(beta):
    w = pi_ref * torch.exp(r_true / beta); return w / w.sum()
kl = lambda p, q: (p * (p / q).log()).sum().item()
for beta in [10.0, 1.0, 0.1]:
    p = optimum(beta)
    print(f"beta={beta:4}: pi*={[round(v, 3) for v in p.tolist()]}  E[r]={(p * r_true).sum():.3f}  KL={kl(p, pi_ref):.3f}")
print(f"pi_ref     : E[r]={(pi_ref * r_true).sum():.3f}")

print("\n== 3. DPO loss on one pair (y_w = y4, y_l = y0), beta = 0.1 ==")
beta = 0.1
def dpo_loss(logp_w, logp_l, ref_w, ref_l):
    return -F.logsigmoid(beta * ((logp_w - ref_w) - (logp_l - ref_l)))
lw, ll = pi_ref[4].log(), pi_ref[0].log()
print("policy = reference         :", round(dpo_loss(lw, ll, lw, ll).item(), 4), "(= ln 2 =", round(torch.log(torch.tensor(2.0)).item(), 4), ")")
print("policy raised y_w by +2 nats:", round(dpo_loss(lw + 2, ll, lw, ll).item(), 4))
print("policy raised y_l by +2 nats:", round(dpo_loss(lw, ll + 2, lw, ll).item(), 4))

print("\n== 4. DPO on the expected preference data (pairs from pi_ref, labels by Bradley-Terry), beta = 1 ==")
beta = 1.0
logits = pi_ref.log().clone().requires_grad_(True)          # the policy starts as the reference
P_pair = pi_ref[:, None] * pi_ref[None, :] * torch.sigmoid(r_true[:, None] - r_true[None, :])  # P(pair, i wins)
P_pair.fill_diagonal_(0)
opt = torch.optim.LBFGS([logits], max_iter=500, tolerance_grad=1e-12, tolerance_change=1e-15)
def closure():
    opt.zero_grad()
    h = beta * (F.log_softmax(logits, 0) - pi_ref.log())    # implicit reward  beta * log(pi_theta / pi_ref)
    loss = -(P_pair * F.logsigmoid(h[:, None] - h[None, :])).sum() / P_pair.sum()
    loss.backward(); return loss
opt.step(closure)
pi_dpo = F.softmax(logits, 0).detach()
print("pi_DPO:", [round(v, 4) for v in pi_dpo.tolist()])
print("pi*   :", [round(v, 4) for v in optimum(beta).tolist()], " max |diff| =", f"{(pi_dpo - optimum(beta)).abs().max():.1e}")
h = beta * (pi_dpo.log() - pi_ref.log())
print("implicit reward differences h - h[0]:", [round(v, 3) for v in (h - h[0]).tolist()], " true r - r[0]:", (r_true - r_true[0]).tolist())
```

</details>

Reading it line by line:
- **The reward model recovers the judge, up to a constant.** From 2,996 usable pairs (pairs of identical responses dropped), the learned scores match the hidden reward within 0.09 after centring ✅[^6]. Adding 5 to every score leaves the loss at exactly 0.5333 ✅[^6]. Only differences are identifiable: rewards that differ by a function of the prompt alone give the same preferences ✅[^2].
- **The DPO loss on one pair.** When the policy equals the reference, both log-ratios are 0 and the loss is `−log σ(0) = ln 2 = 0.6931` ✅[^6]. Raising the winner's log-probability by 2 nats (natural-log units) gives `β · 2 = 0.2` inside the sigmoid and lowers the loss to 0.5981. Raising the loser's raises it to 0.7981 ✅[^6].
- **DPO lands on the RLHF optimum.** Trained only on preference pairs drawn from `π_ref` and labelled by Bradley–Terry, the DPO policy equals `π_ref · exp(r/β) / Z` to `3.8e-11` ✅[^6]. That is the paper's claim that DPO optimizes the same KL-constrained objective ✅[^2]. Its implicit rewards `β · log(π_θ/π_ref)` reproduce the hidden reward differences exactly (0, 1, 2, 0.5, 3) ✅[^6].
- **`β` is the leash (artifact).** `β = 1` raised expected reward from 0.925 to 1.797 at a KL of 0.450 nats. `β = 0.1` reached the maximum reward 3.0 by putting all mass on one response, with KL 2.994 ≈ `−ln 0.05`, the reference's negative log-probability of that response ✅[^6].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Optimizing a reward model too hard | Human-judged quality rises, then falls; the RM can become anti-correlated with people | Over-optimization of a learned proxy ✅[^4] |
| `β` very small | Policy collapses onto the top-scored response; KL grows to `−log π_ref(y)` | Optimum `∝ π_ref · exp(r/β)` ✅[^2]; lab `β = 0.1`: KL 2.994 ✅[^6] |
| Raising the KL coefficient to fix lost NLP (natural language processing) scores | Did not fully remove the regressions in InstructGPT | They added pretraining gradients (PPO-ptx) instead ✅[^1] |
| Shuffling all `K·(K−1)/2` comparisons of a prompt into one dataset | The RM overfit after one pass | Comparisons from one prompt are correlated; InstructGPT batches them per prompt ✅[^1] |
| Reward shifted by a constant | Same loss, same preferences | Bradley–Terry sees only differences ✅[^2]; lab 0.5333 both ways ✅[^6] |
| DPO with a reference that did not generate the data | Distribution shift between data and `π_ref` | DPO sets `π_ref = π_SFT` when it exists for this reason ✅[^2] |
| DPO without its per-pair weighting | Can degenerate | Ablation in the DPO paper ✅[^2] |
| Very large RM (175B) as PPO's value function | Training was unstable in InstructGPT; they used a 6B RM | ✅[^1] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| RLHF with PPO | Trains on the policy's own fresh responses to prompts ✅[^1] | Four models during training (policy, SFT model for the KL term, RM, value function) ✅[^1]; sampling during training ✅[^2] |
| DPO | One classification loss, no sampling during fine-tuning, little hyperparameter tuning ✅[^2]; the best reward-vs-KL frontier in the paper's sentiment test ✅[^2] | Needs the reference model's log-probabilities; offline data only ✅[^2] |
| Larger `β` | Stays close to the SFT model, keeps diversity ✅[^2] ✅[^3] | Smaller reward gain (lab: 1.000 at `β = 10` vs 1.797 at `β = 1`) ✅[^6] |
| PPO-ptx (pretraining mix) | Mitigates the alignment tax ✅[^1] | Does not remove all regressions ✅[^1] |

## Takeaways
- Treat a reward model as a proxy: watch human (or held-out) evaluations as you optimize, and stop before they turn down. [rule-candidate]
- Always keep a KL anchor to the SFT model (RLHF's `β`, DPO's `β`); `β` is the main knob between reward and drift.
- For offline preference data, DPO reaches the same optimum as KL-regularized RLHF without training a reward model; start there unless you need on-policy sampling.
- Log the implicit reward margin `r̂(y_w) − r̂(y_l)` during DPO; a pair stuck at a negative margin is still being ordered wrongly.

## Verification status
- Verified: 59 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- [Training language models to follow instructions with human feedback](https://arxiv.org/html/2203.02155v1) — Ouyang et al., 2022. Backs: the three steps, K = 4–9 rankings, RM loss and scalar head, per-token KL with `β = 0.02`, PPO-ptx, alignment tax, 1.3B vs 175B, RM overfitting and batching, 6B vs 175B RM. [^1]
- [Direct Preference Optimization: Your Language Model is Secretly a Reward Model](https://arxiv.org/html/2305.18290v3) — Rafailov et al., 2023. Backs: Bradley–Terry form, the KL-constrained objective and why the constraint matters, closed-form optimum and `Z(x)`, the inversion, the DPO loss and gradient weighting, implicit reward, `π_ref = π_SFT`, reward normalization, comparisons easier than demonstrations, the reward–KL frontier. [^2]
- [DPO Trainer (Hugging Face TRL docs)](https://huggingface.co/docs/trl/main/en/dpo_trainer) — Hugging Face, living (main branch). Backs: `beta` default 0.1 and its meaning, sigmoid loss as default. [^3]
- [Learning to summarize from human feedback](https://arxiv.org/html/2009.01325v3) — Stiennon et al., 2020. Backs: KL term as entropy bonus and guard, over-optimization becoming anti-correlated with humans. [^4]
- [Deep Reinforcement Learning from Human Preferences](https://arxiv.org/html/1706.03741v4) — Christiano et al., 2017. Backs: Bradley–Terry preferences over trajectory segments. [^5]
- `machine-learning/lab-setup.md` — the lab where the Bradley–Terry fit, the KL-regularized optimum, the DPO loss and DPO training ran on 2026-11-24. [^6]

## Related
- `machine-learning/reinforcement-learning/policy-gradients-and-ppo.md` — PPO's clipped objective, advantages and the value function.
- `machine-learning/transformers/fine-tuning-and-lora.md` — the SFT model that becomes `π_ref`.
- `machine-learning/supervised-learning/logistic-regression.md` — the reward-model loss is logistic regression on reward differences.
- `machine-learning/foundations/loss-functions-and-maximum-likelihood.md` — log loss as maximum likelihood.
- `machine-learning/transformers/decoding-and-kv-cache.md` — how the tuned policy is sampled.
