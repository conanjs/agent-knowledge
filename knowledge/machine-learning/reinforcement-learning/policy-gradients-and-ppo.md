---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/reinforcement-learning
status: verified
applies-to: ["any"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [machine-learning, reinforcement-learning, policy-gradient, reinforce, baseline, advantage, actor-critic, gae, ppo, trpo, clipped-surrogate, pytorch]
---

# Policy gradients: REINFORCE, baselines, actor-critic, GAE and PPO

## Summary
**TL;DR:** Policy-gradient methods improve a stochastic policy `π_θ(a|s)` directly, by gradient ascent on its expected return. The gradient is an average of `∇_θ log π_θ(a_t|s_t)` times a weight `Ψ_t`, so it can be estimated from sampled episodes without a model of the environment; REINFORCE uses the return as the weight. Subtracting a state-dependent baseline, usually a learned value function (the critic), leaves the estimate unbiased and cuts its variance: in the lab, reward-to-go minus a baseline had 117 times less variance than total-return weights. GAE (generalized advantage estimation) builds the weight from temporal-difference (TD) errors, with `λ` trading variance for bias. PPO (proximal policy optimization) reuses each batch for several epochs and clips the probability ratio `π_θ/π_θ_old` inside its objective to `[1 − ε, 1 + ε]`, so a sample's gradient vanishes once the policy has moved far enough in the direction its advantage favours.
**Use this when:** you train a stochastic policy (discrete or continuous actions), tune PPO (`ε`, `γ`, `λ`, epochs, learning rate), or need to know what the reinforcement learning (RL) step of RLHF (reinforcement learning from human feedback) optimizes.
**Not this doc:** the reward model and KL (Kullback–Leibler) penalty of RLHF → `machine-learning/transformers/alignment-rlhf-and-dpo.md`; value-based deep RL → `machine-learning/reinforcement-learning/deep-q-networks.md`.

## Problem
Value-based methods act by taking an `argmax` over Q-values, which has no cheap solution for continuous actions ✅[^11], and they optimize performance only indirectly, by fitting a self-consistency equation ✅[^9]. Optimizing the policy itself needs the gradient of an expectation over trajectories whose distribution depends on the parameters and on dynamics nobody gave you. The obvious estimator is so noisy that its variance grows badly with the horizon ✅[^4], and a step that is too large can wreck a policy that was working ✅[^7]. Reusing a batch for several gradient steps with the plain objective makes it worse: in the lab, 30 steps on one batch pushed one action's probability from 1/3 to 0.956 ✅[^10].

## Mental model
**Analogy:** a coach reviewing match video. Each move the player made gets tagged "do more of this" or "do less of this", in proportion to how much better than expected things went after it (the advantage). Comparing with "expected" rather than with the raw score is the baseline: in an easy match every move led to points, and praising all of them teaches nothing. PPO adds a rule for each review session: once a move's frequency has shifted 20 % in the direction the review favours, stop giving credit for shifting it further (one big correction can still overshoot), then go and play a new match before reviewing again.

**Artifact:** the two losses, as code. Spinning Up's REINFORCE-style loss, whose gradient is the policy gradient ✅[^1], and PPO's clipped version from the lab script:

```python
logp = get_policy(obs).log_prob(act)                 # Spinning Up's loss, adapted: weights = returns
loss = -(logp * weights).mean()                      # (or advantages) for the sampled actions

ratio = torch.exp(torch.log_softmax(logits, 0)[acts] - logp_old)          # pi_theta / pi_theta_old
surr = torch.min(ratio * adv, torch.clamp(ratio, 1 - eps, 1 + eps) * adv)  # PPO-Clip
loss = -surr.mean()
```

## How it works
**3 actors:**
- **Actor (policy network `π_θ`)** — its job: sample actions and be improved, via the gradient of `log π_θ(a|s)`.
- **Critic (value network `V_φ`)** — its job: estimate `V^π(s)` so returns can be turned into advantages, via mean-squared-error regression on returns.
- **Environment** — its job: produce rewards and next states, via sampling.

```text
[Actor π_θ] ── a_t ──► [Environment] ── r_t, s_{t+1} ──► rollout buffer (one batch, current policy only)
     ▲                                                          │
     │                     [Critic V_φ] δ_t = r_t + γ·V_φ(s_{t+1}) − V_φ(s_t);  Â_t = Σ_l (γλ)^l · δ_{t+l}
     │                                                          │
     └─ θ: ascend Σ_t log π_θ(a_t|s_t)·Â_t (PPO: clipped ratio, several epochs)   φ: regress V_φ toward returns
        then discard the batch and collect a new one with the updated π_θ (on-policy)
```

1. **Objective.** Maximize the expected return `J(π_θ)` by gradient ascent, `θ ← θ + α·∇_θ J`; `∇_θ J` is called the policy gradient ✅[^1]. The idea is to push up the probabilities of actions that led to higher return and push down those that led to lower return ✅[^2].
2. **The gradient as an average.** With the log-derivative trick, and because the environment's probabilities do not depend on `θ`, the gradient becomes an expectation that can be estimated by a sample mean over trajectories ✅[^1]: `g = E[ Σ_t Ψ_t · ∇_θ log π_θ(a_t|s_t) ]`, estimated as `ĝ = (1/N) · Σ_n Σ_t Ψ_t^n · ∇_θ log π_θ(a_t^n|s_t^n)` over `N` episodes ✅[^4]. REINFORCE, due to Williams (1992), steps along `∇_θ log π(a_t|s_t; θ) · R_t`, an unbiased estimate of `∇_θ E[R_t]` ✅[^3]. For a softmax policy over logits `θ`, `∇_θ log π(a) = onehot(a) − π`, which the lab checked against autograd ✅[^10]. Example: `θ = [0, 0]`, so `π = [0.5, 0.5]`; for action 1 the gradient is `[−0.5, +0.5]`, and with weight 7 a step of size `α` raises `θ_1` by `3.5·α`.
3. **Reward-to-go.** Only rewards after an action should credit it; the terms for earlier rewards have zero mean but nonzero variance, so dropping them cuts noise without changing the expectation ✅[^1].
4. **Baseline.** Subtracting any function `b(s_t)` of the state alone leaves the expected gradient unchanged (Spinning Up's "expected grad-log-prob" lemma) ✅[^1]. The usual choice, `b = V^π(s_t)`, empirically reduces variance, and it means "if an agent gets what it expected, it should 'feel' neutral about it" ✅[^1]. `V` is approximated by a network fitted with a mean-squared-error objective, updated alongside the policy ✅[^1]. `R_t − b_t` is then an estimate of the advantage `A(s_t, a_t) = Q(s_t, a_t) − V(s_t)` ✅[^3].
5. **Advantage and actor-critic.** Weighting by the advantage gives almost the lowest possible variance, and the step raises the probability of an action exactly when it was better than the policy's average ✅[^4]. With a learned value function as baseline, the policy is the actor and the value function the critic ✅[^3]; Sutton & Barto describe the critic's judgement as a TD error and note that actor-critic learning is on-policy ✅[^5]. Using the critic's estimates instead of actual returns lowers variance at the cost of bias ✅[^4].
6. **GAE.** Define the TD residual `δ_t = r_t + γ·V(s_{t+1}) − V(s_t)`; GAE's advantage estimate is `Â_t = Σ_{l≥0} (γλ)^l · δ_{t+l}` ✅[^4]. `λ = 0` gives `δ_t` alone: low variance, but biased unless `V` is exact; `λ = 1` gives `Σ_l γ^l·r_{t+l} − V(s_t)`, the return minus the baseline: unbiased for any `V` (the paper's "γ-just": no bias beyond what the discount `γ` itself introduces) but high-variance ✅[^4]. `γ < 1` is itself a variance-reduction choice, and in the GAE experiments the best `λ` was much lower than the best `γ` ✅[^4]. Both checks below ran in the lab (`machine-learning/lab-setup.md`), 2026-11-24, Python 3.13.7, numpy 2.5.5, PyTorch 2.15.0, two runs identical ✅[^10]. Part 1 uses 5-step episodes, two actions chosen with probability 0.5 each, and a reward of `1 + action` per step (a constant "alive" reward of 1, as many control tasks have); Part 2 applies GAE to one 4-step trajectory with a given critic:

   ```text
   Part 1: true dJ/dtheta_1 = 1.2500
   weight Psi_t              mean estimate  std per episode  variance ratio
   R(tau) (total return)            1.2529           8.4997            1.0x
   G_t (reward-to-go)               1.2672           5.6031            2.3x
   G_t - V(t) (baseline)            1.2461           0.7850          117.2x
   onehot(a) - pi equals autograd: True

   Part 2: delta_t = [ 0.094  0.192  0.497 -0.3  ]
     GAE lambda=0.0: [ 0.094  0.192  0.497 -0.3  ]
     GAE lambda=0.9: [ 0.4474  0.3967  0.2297 -0.3   ]
     GAE lambda=1.0: [ 0.4801  0.39    0.2    -0.3   ]
     G_t - V(s_t):     [ 0.4801  0.39    0.2    -0.3   ]
   ```

   <details><summary>Full script (prints the output above)</summary>

   ```python
   # Part 1: REINFORCE gradient estimates: total return vs reward-to-go vs reward-to-go minus a baseline.
   # Part 2: GAE on one short trajectory, lambda = 0, 0.9, 1.
   import numpy as np
   import torch

   # ---------- Part 1 ----------
   # 5-step episodes; each step pick action 0 or 1 from pi = softmax(theta), the same at every step.
   # Reward per step = 1 + action (a constant "alive" reward of 1, plus 1 more for action 1).
   T, EPISODES = 5, 100_000
   theta = np.array([0.0, 0.0])
   pi = np.exp(theta) / np.exp(theta).sum()             # [0.5, 0.5]
   rng = np.random.default_rng(0)
   acts = (rng.random((EPISODES, T)) < pi[1]).astype(int)   # a_t for every episode and step
   rews = 1.0 + acts
   grad_logp = np.stack([(acts == 0) - pi[0], (acts == 1) - pi[1]], axis=-1)  # d log pi(a_t) / d theta
   total = rews.sum(axis=1, keepdims=True)                   # R(tau), the same weight for every step
   to_go = np.cumsum(rews[:, ::-1], axis=1)[:, ::-1]         # G_t = r_t + ... + r_{T-1}
   baseline = (T - np.arange(T)) * (1 + pi[1])               # V(t) = steps left * expected reward per step
   true_grad = T * pi[1] * (1 - pi[1])                       # dJ/dtheta_1 for J = T * (1 + pi_1)
   print(f"Part 1: true dJ/dtheta_1 = {true_grad:.4f}")
   print(f"{'weight Psi_t':24s} {'mean estimate':>14s} {'std per episode':>16s} {'variance ratio':>15s}")
   ref = None
   for name, w in [("R(tau) (total return)", np.broadcast_to(total, rews.shape)),
                   ("G_t (reward-to-go)", to_go), ("G_t - V(t) (baseline)", to_go - baseline)]:
       g = (w[..., None] * grad_logp).sum(axis=1)[:, 1]      # one gradient sample per episode
       ref = ref or g.var()
       print(f"{name:24s} {g.mean():14.4f} {g.std():16.4f} {ref / g.var():14.1f}x")

   # check the closed form d log softmax(theta)[a] / d theta = onehot(a) - pi against autograd
   th = torch.tensor([0.3, -0.2], requires_grad=True)
   torch.log_softmax(th, 0)[1].backward()
   p = torch.softmax(th, 0).detach()
   print("onehot(a) - pi equals autograd:", torch.allclose(th.grad, torch.tensor([0.0, 1.0]) - p))

   # ---------- Part 2 ----------
   r = np.array([0.0, 0.0, 1.0, 0.0])                       # rewards r_0..r_3; the episode ends after r_3
   V = np.array([0.5, 0.6, 0.8, 0.3, 0.0])                  # critic's V(s_0)..V(s_4); V(terminal) = 0
   gamma = 0.99
   delta = r + gamma * V[1:] - V[:-1]                       # TD residuals
   def gae(lam):
       A, out = 0.0, np.zeros(len(r))
       for t in reversed(range(len(r))):                    # A_t = delta_t + gamma * lam * A_{t+1}
           A = delta[t] + gamma * lam * A
           out[t] = A
       return out
   G = np.array([sum(gamma ** k * r[t + k] for k in range(len(r) - t)) for t in range(len(r))])
   print("\nPart 2: delta_t =", np.round(delta, 4))
   for lam in (0.0, 0.9, 1.0):
       print(f"  GAE lambda={lam}: {np.round(gae(lam), 4)}")
   print("  G_t - V(s_t):    ", np.round(G - V[:-1], 4))
   ```

   </details>

   All three weights estimate the true gradient 1.25 (1.2529, 1.2672, 1.2461; the standard errors of these means are 0.027, 0.018 and 0.0025). Their noise differs: one episode's estimate has standard deviation 8.50 with the total return, 5.60 with the reward-to-go and 0.785 with the baseline, so the baseline version reaches the same precision with about 117 times fewer episodes than the total-return version (about 51 times fewer than reward-to-go alone, `(5.6031/0.7850)²`). With this baseline the weight is `G_t − V(t) = Σ_{k≥t} (a_k − 0.5)`: the constant alive reward cancels exactly, and with it most of the noise. In Part 2, `λ = 0` reproduces the TD residuals exactly and `λ = 1` reproduces the return minus the baseline; `λ = 0.9` lies between.
7. **PPO.** The question is how to take the biggest improvement step the current data allow without accidentally collapsing performance ✅[^7]. TRPO (trust region policy optimization) maximizes the importance-weighted surrogate `E[(π_θ/π_old)·Â]` under a KL-divergence constraint, with a second-order method ✅[^8] ✅[^7]; PPO is a family of first-order methods for the same goal ✅[^7]. Plain policy-gradient methods take one gradient step per data sample, while PPO's objective allows several epochs of minibatch updates on the same batch ✅[^6]. PPO-Clip maximizes `E[ min( ρ_t·Â_t, clip(ρ_t, 1 − ε, 1 + ε)·Â_t ) ]`, with `ρ_t = π_θ(a_t|s_t) / π_old(a_t|s_t)` the probability ratio between the new and the data-collecting policy ✅[^8]. Per sample, its gradient equals the unclipped surrogate's gradient when the ratio is inside `[1 − ε, 1 + ε]` or when the unclipped term is the smaller one (so the `min` selects it), and is zero otherwise ✅[^8] ✅[^10]. Engstrom et al.'s case formula prints the second condition the other way round (`L^C < L`, clipped term smaller); that contradicts the `min` in their own objective and the lab table below, where `A = +1` at ratio 0.5 still has gradient 1. For a positive advantage the objective rises as the action becomes more likely, but only up to a ceiling; for a negative advantage it rises as the action becomes less likely, again up to a ceiling ✅[^7]. From the formula the ceilings sit at ratios `1 + ε` and `1 − ε` ✅[^8], as the lab table below shows ✅[^10]. Example, `ε = 0.2`, `Â = +1`: at `ρ = 1.3` the objective is `min(1.3, 1.2) = 1.2` and its gradient is 0. All ratios start at 1, so PPO's first step on a batch equals a step on the unclipped surrogate ✅[^8]. PPO is on-policy ✅[^7]; Spinning Up notes that calling it a policy-gradient algorithm is slightly inaccurate ✅[^1]. RLHF runs PPO against a learned reward with a KL penalty to a reference model: `machine-learning/transformers/alignment-rlhf-and-dpo.md`.

## Worked example
The clipped surrogate up close, then one batch reused for 30 epochs. Part 1 evaluates `L = min(ρ·A, clip(ρ, 0.8, 1.2)·A)` and `dL/dρ` with autograd for `A = ±1`. Part 2 samples 300 actions from a uniform 3-action policy, gives action 0 advantage +1, action 1 advantage 0 and action 2 advantage −1, and runs 30 full-batch gradient-ascent steps (stochastic gradient descent with learning rate 0.5) on the plain surrogate `ρ·A` and on the clipped one. Lab run (`machine-learning/lab-setup.md`), 2026-11-24, Python 3.13.7, PyTorch 2.15.0, two runs identical ✅[^10]:

```text
Part 1: L = min(r*A, clip(r, 0.8, 1.2)*A), gradient dL/dr by autograd
 ratio r  L (A=+1)  dL/dr  L (A=-1)  dL/dr
    0.50      0.50    1.0     -0.80    0.0
    0.60      0.60    1.0     -0.80    0.0
    0.70      0.70    1.0     -0.80    0.0
    0.85      0.85    1.0     -0.85   -1.0
    1.00      1.00    1.0     -1.00   -1.0
    1.15      1.15    1.0     -1.15   -1.0
    1.30      1.20    0.0     -1.30   -1.0
    1.40      1.20    0.0     -1.40   -1.0
    1.50      1.20    0.0     -1.50   -1.0

Part 2: ratio pi_new/pi_old for actions [0, 1, 2] while re-using one batch of 300 samples
  plain    epoch  1: ratios [1.168, 0.989, 0.843]
  plain    epoch  2: ratios [1.351, 0.944, 0.705]
  plain    epoch  3: ratios [1.54, 0.873, 0.587]
  plain    epoch  4: ratios [1.726, 0.785, 0.489]
  plain    epoch 30: ratios [2.868, 0.088, 0.044]
  clipped  epoch  1: ratios [1.168, 0.989, 0.843]
  clipped  epoch  2: ratios [1.351, 0.944, 0.705]
  clipped  epoch  3: ratios [1.351, 0.944, 0.705]
  clipped  epoch  4: ratios [1.351, 0.944, 0.705]
  clipped  epoch 30: ratios [1.351, 0.944, 0.705]
```

<details><summary>Full script (prints the output above)</summary>

```python
# Part 1: PPO's clipped surrogate and its gradient for ratios 0.5..1.5.
# Part 2: 30 epochs on one batch: plain surrogate r*A vs PPO's clipped surrogate.
import torch

# ---------- Part 1 ----------
eps = 0.2
print(f"Part 1: L = min(r*A, clip(r, {1-eps}, {1+eps})*A), gradient dL/dr by autograd")
print(f"{'ratio r':>8s} {'L (A=+1)':>9s} {'dL/dr':>6s} {'L (A=-1)':>9s} {'dL/dr':>6s}")
for r0 in (0.5, 0.6, 0.7, 0.85, 1.0, 1.15, 1.3, 1.4, 1.5):
    row = f"{r0:8.2f}"
    for A in (1.0, -1.0):
        r = torch.tensor(r0, requires_grad=True)
        L = torch.min(r * A, torch.clamp(r, 1 - eps, 1 + eps) * A)
        L.backward()
        row += f" {L.item():9.2f} {r.grad.item():6.1f}"
    print(row)

# ---------- Part 2 ----------
torch.manual_seed(0)
old_logits = torch.zeros(3)                              # pi_old = [1/3, 1/3, 1/3]
acts = torch.multinomial(torch.softmax(old_logits, 0), 300, replacement=True)
adv = torch.tensor([1.0, 0.0, -1.0])[acts]               # action 0 good, action 2 bad
logp_old = torch.log_softmax(old_logits, 0)[acts]
print("\nPart 2: ratio pi_new/pi_old for actions [0, 1, 2] while re-using one batch of 300 samples")
for clipped in (False, True):
    logits = old_logits.clone().requires_grad_(True)
    opt = torch.optim.SGD([logits], lr=0.5)
    for epoch in range(1, 31):
        ratio = torch.exp(torch.log_softmax(logits, 0)[acts] - logp_old)
        surr = torch.min(ratio * adv, torch.clamp(ratio, 1 - eps, 1 + eps) * adv) if clipped else ratio * adv
        opt.zero_grad(); (-surr.mean()).backward(); opt.step()
        if epoch in (1, 2, 3, 4, 30):
            with torch.no_grad():
                p_new = torch.softmax(logits, 0)             # pi_old = 1/3, so ratio = 3 * pi_new
                print(f"  {'clipped ' if clipped else 'plain   '} epoch {epoch:2d}: ratios "
                      f"{[round(float(v), 3) for v in p_new * 3]}")
```

</details>

Reading it:
- **The gradient is zero only on the side the advantage favours.** With `A = +1`, ratios of 1.3 and above give a flat objective (1.20) and gradient 0: no further reward for making a good action more likely. Below 0.8 the gradient is still 1, so a good action whose probability fell is pulled back up. With `A = −1` it is the mirror image: gradient 0 at ratios of 0.7 and below, −1 above 1.2.
- **The plain surrogate runs away.** Re-using the batch, it keeps raising action 0's probability: ratio 2.868 after 30 epochs, a probability of 0.956 for a batch collected under probability 1/3. Those samples say little about such a different policy.
- **The clipped surrogate stops.** Epochs 1 and 2 are identical to the plain run, because all ratios start at 1 and stay inside `[0.8, 1.2]` after the first step. After epoch 2 action 0's ratio is 1.351 and action 2's is 0.705, both outside the range on their favoured side, and action 1 has advantage 0, so every sample's gradient is zero and the policy freezes from epoch 3 on.
- **In this run, clipping did not bound the step.** 1.351 is beyond `1 + ε = 1.2`: the second step, taken from inside the range with a large learning rate, overshot it, and clipping only stopped further movement. Engstrom et al. argue the same in general: the step size is set by the steepness of the surrogate and the optimizer, so the policy can move arbitrarily far from the clip range, and in their Humanoid-v2 runs the maximum ratio consistently exceeded `1 + ε` ✅[^8]. Spinning Up likewise notes that a new policy can still end up too far from the old one, which is why its implementation stops the epochs early when the mean KL divergence passes a threshold ✅[^7].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| The surrogate "loss" decreases | Says nothing about performance; can fall while the return collapses | Its data depend on the parameters and it does not measure return; only its gradient at the current parameters means something ✅[^1] |
| A baseline that depends on the action | Can bias the gradient | The lemma covers functions of the state only ✅[^1] |
| Constant per-step reward (alive bonus) | Large variance with return weights | Lab: standard deviation 8.50 without a baseline, 0.785 with one ✅[^10] |
| Inaccurate critic | `λ < 1` advantages are biased | Only `λ = 1` is γ-just (no bias beyond the discount's) whatever `V` ✅[^4] |
| Large learning rate in PPO | A step can leave the clip range before the gradient switches off | Step size is set by the surrogate's landscape, so the policy can move far ✅[^8]; lab: ratio 1.351 for `ε = 0.2` ✅[^10] |
| Ratio below `1 − ε` with positive advantage | Gradient still flows | The `min` keeps the unclipped term there ✅[^8]; lab table ✅[^10] |
| Policy becomes nearly deterministic | Exploration stops; training can stick in a local optimum | On-policy methods explore only by sampling their own policy ✅[^2] ✅[^7] |
| Continuous actions (diagonal Gaussian policy) | `log_prob` returns one value per action dimension | Sum them to get the action's log-probability ✅[^1] |
| Long horizons | Gradient variance grows | Effects of one action are confounded with those of past and future actions ✅[^4]; use `γ < 1`, `λ < 1` ✅[^4] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| REINFORCE with return weights | Unbiased; no critic ✅[^3] | High variance (lab standard deviation 8.50) ✅[^10] |
| Value baseline / advantage weights | Unbiased with far lower variance (117× in the lab) ✅[^3] ✅[^10] | A critic network to train alongside ✅[^1] |
| GAE `λ` between 0 and 1 | Tunes bias against variance ✅[^4] | One more hyperparameter; bias grows as the critic errs ✅[^4] |
| PPO-Clip vs TRPO | First-order and simpler; empirically seems to perform at least as well ✅[^7] | No hard guarantee of staying close to the old policy ✅[^7] ✅[^8] |
| Policy optimization vs Q-learning | Optimizes the objective directly; more stable ✅[^9] | On-policy: fresh data for every update, less sample-efficient ✅[^9] |

## Takeaways
- Always subtract a learned state-value baseline; it costs nothing in bias and buys most of the variance reduction. [rule-candidate]
- Judge policy-gradient training by average return, never by the surrogate loss. [rule-candidate]
- In PPO, watch the KL divergence or the fraction of clipped samples per epoch and stop early; the clip alone need not bound a step (it did not in the lab run, nor in Engstrom et al.'s runs).
- Read `λ` as a dial: 1 = return minus baseline (unbiased, noisy), 0 = one-step TD error (smooth, biased by the critic).

## Verification status
- Verified: 67 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- [Part 3: Intro to Policy Optimization](https://spinningup.openai.com/en/latest/spinningup/rl_intro3.html) — OpenAI Spinning Up, 2018. Backs: policy gradient and gradient ascent, log-derivative derivation and sample estimate, the loss code and why it is not a loss, reward-to-go, baseline lemma and value baseline, learned `V` by mean squared error, `log_prob` summed over action dimensions, calling PPO a policy-gradient algorithm is slightly inaccurate. [^1]
- [Vanilla Policy Gradient](https://spinningup.openai.com/en/latest/algorithms/vpg.html) — OpenAI Spinning Up, 2018. Backs: push up better actions, push down worse ones; exploration by sampling and local optima. [^2]
- [Asynchronous Methods for Deep Reinforcement Learning](https://arxiv.org/html/1602.01783v2) — Mnih et al., 2016. Backs: REINFORCE (Williams, 1992) and its unbiased estimate, baselines keep it unbiased, `R_t − b_t` as an advantage estimate, actor and critic. [^3]
- [High-Dimensional Continuous Control Using Generalized Advantage Estimation](https://arxiv.org/html/1506.02438v6) — Schulman, Moritz, Levine, Jordan, Abbeel, 2018 (v6). Backs: the `Ψ_t` form of the gradient and its estimator, variance growth with horizon, advantage weights' low variance, critic bias vs variance, TD residual, GAE formula and its `λ = 0` / `λ = 1` cases, `γ` as variance reduction, best `λ` below best `γ`. [^4]
- [6.6 Actor-Critic Methods](http://incompleteideas.net/book/first/ebook/node66.html) — Sutton & Barto, Reinforcement Learning: An Introduction (1st ed., HTML), 1998. Backs: the critic's TD error; actor-critic learning is on-policy. [^5]
- [Proximal Policy Optimization Algorithms](https://arxiv.org/abs/1707.06347) — Schulman, Wolski, Dhariwal, Radford, Klimov, 2017 (abstract). Backs: one update per sample in standard policy gradients vs several epochs of minibatch updates in PPO. [^6]
- [Proximal Policy Optimization](https://spinningup.openai.com/en/latest/algorithms/ppo.html) — OpenAI Spinning Up, 2018. Backs: PPO's motivation, first-order vs TRPO's second-order method, the ceilings for positive and negative advantages, on-policy, a clipped update can still end too far from the old policy, early stopping on KL, empirically seems at least as good as TRPO. [^7]
- [Implementation Matters in Deep Policy Gradients: A Case Study on PPO and TRPO](https://arxiv.org/html/2005.12729v1) — Engstrom et al., 2020. Backs: TRPO's KL-constrained surrogate, the PPO-Clip objective and ratio, its per-sample gradient (whose printed case condition is reversed), the first step equals the unclipped one, the step can leave the trust region, PPO's maximum ratio exceeding `1 + ε` on Humanoid-v2. [^8]
- [Part 2: Kinds of RL Algorithms](https://spinningup.openai.com/en/latest/spinningup/rl_intro2.html) — OpenAI Spinning Up, 2018. Backs: policy optimization optimizes directly and is more stable; Q-learning optimizes indirectly and reuses data better. [^9]
- `machine-learning/lab-setup.md` — the lab where the gradient-variance comparison, the GAE check, the clipped-surrogate table and the 30-epoch batch reuse ran on 2026-11-24. [^10]
- [Deep Deterministic Policy Gradient](https://spinningup.openai.com/en/latest/algorithms/ddpg.html) — OpenAI Spinning Up, 2018. Backs: the max over actions is a challenge in continuous action spaces. [^11]

## Related
- `machine-learning/transformers/alignment-rlhf-and-dpo.md` — PPO with a reward model and a KL penalty for language models, and DPO.
- `machine-learning/reinforcement-learning/markov-decision-processes.md` — returns, `V`, `Q` and the advantage.
- `machine-learning/reinforcement-learning/temporal-difference-and-q-learning.md` — the TD error the critic and GAE are built from.
- `machine-learning/reinforcement-learning/deep-q-networks.md` — the value-based alternative.
- `machine-learning/deep-learning/neural-networks-and-backpropagation.md` — autograd behind `loss.backward()`.
- `machine-learning/foundations/gradient-descent.md` — the update rule, here used as ascent.
- `machine-learning/foundations/information-theory.md` — the KL divergence used in trust regions and penalties.
- `machine-learning/reinforcement-learning/optimal-control-and-lqr.md` — policy gradient and random search on an LQR gain.
