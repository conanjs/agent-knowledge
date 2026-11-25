---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/reinforcement-learning
status: verified
applies-to: ["any"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [machine-learning, reinforcement-learning, dqn, deep-q-network, experience-replay, target-network, deadly-triad, double-dqn, overestimation, huber-loss, pytorch]
---

# Deep Q-networks: experience replay, target networks, the deadly triad and double DQN

## Summary
**TL;DR:** A deep Q-network (DQN) replaces Q-learning's table with a neural network that maps a state to one Q-value per action, trained by regression toward the target `r + γ·max_a' Q(s', a')`. That combines function approximation, bootstrapping and off-policy data, the "deadly triad" under which value estimates can diverge. DQN steadies the regression with experience replay (train on random minibatches of stored transitions) and a target network (a periodically copied network computes the targets). Double DQN reduces the upward bias of the `max` by letting the online network choose the next action and the target network score it.
**Use this when:** you train or debug a value-based deep reinforcement learning (RL) agent, Q-values grow beyond any possible return, or you set replay-buffer and target-network parameters.
**Not this doc:** tabular Q-learning and on- vs off-policy → `machine-learning/reinforcement-learning/temporal-difference-and-q-learning.md`; how the network itself is trained → `machine-learning/deep-learning/neural-networks-and-backpropagation.md`.

## Problem
A Q-table needs one entry per state, and screens of pixels or continuous sensor readings have far too many states, so the values must be generalized by a function ✅[^2]. Plugging a neural network into Q-learning is not just "supervised learning on rewards": consecutive transitions are strongly correlated, the data distribution shifts whenever the policy changes, the regression targets depend on the very weights being trained, and earlier work had shown that Q-learning with nonlinear function approximators could diverge ✅[^1]. Even when training works, the `max` in the target systematically overestimates action values ✅[^2].

## Mental model
**Analogy:** a student grading practice answers against an answer key that the same student keeps rewriting. Rewriting the key after every question (no target network) means each correction moves the reference for the next question; freezing a copy of the key for a hundred questions (target network) gives a stable reference. Studying from a shuffled deck of past questions (replay) instead of today's questions in order keeps the student from over-fitting to whatever came last. And choosing the best of ten noisily graded answers, then trusting that grade, flatters the student every time; double DQN picks with one key and grades with the other.

**Artifact:** the target and loss of one DQN update, from the lab script (`q` = online network, `q_target` = target network, `D` = 1 if the next state is terminal):

```python
with torch.no_grad():                                 # bootstrap target, never back-propagated
    boot = (q_target if target_net else q)(S2).max(dim=1).values
    y = R + GAMMA * (1 - D) * boot
pred = q(S).gather(1, A[:, None]).squeeze(1)          # Q(s, a) for the actions actually taken
loss = nn.functional.smooth_l1_loss(pred, y)          # Huber loss
```

## How it works
**4 actors:**
- **Behaviour policy** — its job: choose actions, via ε-greedy over the online network's Q-values.
- **Replay buffer** — its job: store transitions and hand back random minibatches, via uniform sampling over the last `N` transitions.
- **Online network `Q(s, ·; θ)`** — its job: predict the Q-values of all actions and be trained, via gradient steps on `θ`.
- **Target network `Q(s, ·; θ⁻)`** — its job: compute the bootstrap targets, via a copy of `θ` refreshed every `C` steps.

```text
[Behaviour] a = ε-greedy(Q(s,·;θ)) ──► [Environment] r, s', terminated
                                              │
                                              ▼
                        [Replay buffer] append (s, a, r, s', terminated); keep the last N
                                              │ sample a minibatch at random
                                              ▼
   [Target net θ⁻]  y = r + γ·(1 − terminated)·max_a' Q(s', a'; θ⁻)      (no gradient)
   [Online net θ]   loss = Huber(y − Q(s, a; θ))  ──► gradient step on θ only
                                              │ every C steps
                                              ▼
                       θ⁻ ← θ (hard copy)   or every step θ⁻ ← τ·θ + (1 − τ)·θ⁻ (soft update)
```

1. **The network.** A DQN is a network from an `n`-dimensional state to `m` action values, `Q(s, ·; θ)` ✅[^2], so one forward pass gives the Q-values of every action ✅[^1]. The original DQN was a convolutional network on raw Atari pixels, trained with a variant of Q-learning; on seven games it beat all previous approaches on six and a human expert on three ✅[^1].
2. **The loss.** Iteration `i` minimizes `L_i(θ_i) = E[(y_i − Q(s, a; θ_i))²]` with target `y_i = r + γ·max_a' Q(s', a'; θ_(i−1))`, the previous parameters held fixed; unlike supervised learning, the targets depend on the network's own weights ✅[^1]. Each update moves `Q(s, a; θ)` toward its target, much like stochastic gradient descent ✅[^2] (`machine-learning/foundations/gradient-descent.md`). Example: `r = 0`, `γ = 0.9`, target network's `max_a' Q(s', a') = 0.81`, so `y = 0.729`; the online network predicts 0.60, the error is 0.129.
3. **Huber loss.** Instead of the square, the PyTorch DQN tutorial uses the Huber loss `½·δ²` for `|δ| ≤ 1` and `|δ| − ½` otherwise, where `δ` is the temporal-difference (TD) error, target minus prediction; it behaves like the mean squared error for small errors and like the mean absolute error for large ones, which is more robust when Q estimates are noisy ✅[^4]. PyTorch's tutorial uses `nn.SmoothL1Loss` for it ✅[^4]. For the example error 0.129 it gives `½·0.129² = 0.0083`. More on Huber → `machine-learning/foundations/loss-functions-and-maximum-likelihood.md`.
4. **Experience replay.** Each transition `(s_t, a_t, r_t, s_(t+1))` goes into a replay memory pooled over many episodes, and the updates use minibatches drawn at random from it ✅[^1]. That gives three things: each transition is reused in many updates; random sampling breaks the correlation between consecutive transitions and so reduces the variance of the updates; and it stops the feedback loop in which the current weights choose the next training data (for example, all samples from the left side of the screen), which can trap or diverge the weights ✅[^1]. Because replayed data come from older weights, the learning rule must be off-policy, which is why DQN uses Q-learning ✅[^1]. The original kept the last one million frames, sampled uniformly, used minibatches of 32, and annealed `ε` from 1 to 0.1 over the first million frames ✅[^1]. A buffer of only very recent data over-fits to it; a buffer that keeps too much may slow learning ✅[^5].
5. **Target network.** A second network with parameters `θ⁻` is copied from the online network every `C` steps (van Hasselt et al. call the period `τ`) and frozen in between; the DQN target is `Y = R + γ·max_a Q(S', a; θ⁻)` ✅[^2]. The target network belongs to the DQN of Mnih et al. (2015) ✅[^2]; the 2013 paper had none, its algorithm computes the target with the current parameters `θ` ✅[^1]. Without it, the target depends on the same parameters being trained, which makes the minimization unstable; the target network is a time-delayed copy ✅[^5]. Target network and replay both improved DQN's performance dramatically in the 2015 DQN study ✅[^2]. A soft variant updates `θ⁻ ← τ·θ + (1 − τ)·θ⁻` at every step, with `τ = 0.005` in the PyTorch tutorial ✅[^4]; DDPG-style (deep deterministic policy gradient) algorithms call this polyak averaging ✅[^5].
6. **Why it can still diverge: the deadly triad.** Function approximation, bootstrapping and off-policy learning together can make TD learning diverge, with value estimates growing without bound; DQN combines all three ✅[^3]. With shared weights, updating one state's value also changes others, including the state being bootstrapped on; off-policy updates may not correct those side effects ✅[^3]. Sutton & Barto (1998) note that convergence results for bootstrapping hold only for the on-policy distribution, and that off-policy bootstrapping with function approximation can diverge ✅[^6]. The classic example: two states with one feature each, `φ(s1) = 1` and `φ(s2) = 2`, values `w·φ`, all rewards 0 (so `w* = 0`), and `s1 → s2`. Updating only `s1` gives `Δw ∝ γ·2w − w = (2γ − 1)·w`, which pushes `w` away from 0 for any `γ > 1/2` ✅[^3]. Lab run (`machine-learning/lab-setup.md`), 2026-11-24, Python 3.13.7, numpy 2.5.5, two runs identical ✅[^7]:

   ```text
   Part 1: true Q(s,a) = 0 for every action; estimates = true + N(0, 1) noise
    actions m   E[max_a Q]   E[Q2(argmax_a Q1)]
            2        0.567                0.000
            4        1.030                0.005
           10        1.537               -0.005
          100        2.506                0.006

   Part 2: weight w after 2000 TD updates, starting from w = 1 (alpha = 0.01)
     gamma=0.99  on-policy            w = 0.1945
     gamma=0.99  s1, s2 alternately   w = 1.152e+04
     gamma=0.99  s1 only              w = 2.956e+08
     gamma=0.4   on-policy            w = 9.536e-22
     gamma=0.4   s1, s2 alternately   w = 3.805e-12
     gamma=0.4   s1 only              w = 0.01824
   ```

   <details><summary>Full script (prints the output above)</summary>

   ```python
   # Part 1: max vs double estimator on noisy action values (all true values are 0).
   # Part 2: the Tsitsiklis-Van Roy "w, 2w" example: TD(0) with one shared weight.
   import numpy as np

   rng = np.random.default_rng(0)
   REPS = 100_000
   print("Part 1: true Q(s,a) = 0 for every action; estimates = true + N(0, 1) noise")
   print(f"{'actions m':>10s} {'E[max_a Q]':>12s} {'E[Q2(argmax_a Q1)]':>20s}")
   for m in (2, 4, 10, 100):
       q1 = rng.standard_normal((REPS, m))              # estimate used to select
       q2 = rng.standard_normal((REPS, m))              # independent estimate used to evaluate
       single = q1.max(axis=1).mean()                   # Q-learning target: select and evaluate with q1
       double = q2[np.arange(REPS), q1.argmax(axis=1)].mean()
       print(f"{m:10d} {single:12.3f} {double:20.3f}")

   # s1 -> s2 (reward 0), s2 -> s2 (reward 0, the episode ends with prob 0.01).
   # Features phi(s1)=1, phi(s2)=2, value v(s) = w * phi(s). True values are 0, so w* = 0.
   def td_update(w, phi, phi_next, alpha, gamma, terminal=False):
       target = 0.0 if terminal else gamma * w * phi_next   # reward is always 0
       return w + alpha * (target - w * phi) * phi          # semi-gradient TD(0)

   def run(schedule, gamma, alpha=0.01, w=1.0, updates=2000, seed=0):
       rng = np.random.default_rng(seed)
       n = 0
       while n < updates:
           if schedule == "on-policy":                      # follow the dynamics: one episode
               w = td_update(w, 1, 2, alpha, gamma); n += 1
               while n < updates:
                   end = rng.random() < 0.01
                   w = td_update(w, 2, 2, alpha, gamma, terminal=end); n += 1
                   if end:
                       break
           elif schedule == "s1 only":                      # off-policy: only s1's transition is replayed
               w = td_update(w, 1, 2, alpha, gamma); n += 1
           elif schedule == "s1, s2 alternately":           # off-policy: uniform over the two states
               w = td_update(w, 1, 2, alpha, gamma)
               w = td_update(w, 2, 2, alpha, gamma); n += 2
       return w

   print("\nPart 2: weight w after 2000 TD updates, starting from w = 1 (alpha = 0.01)")
   for gamma in (0.99, 0.4):
       for schedule in ("on-policy", "s1, s2 alternately", "s1 only"):
           print(f"  gamma={gamma:<5} {schedule:20s} w = {run(schedule, gamma):.4g}")
   ```

   </details>

   Part 2 reproduces the example: at `γ = 0.99`, updating states in the proportions the dynamics visit them (on-policy) shrinks `w` toward 0 (0.1945), while the two off-policy schedules blow it up to 1.15·10⁴ and 2.96·10⁸; at `γ = 0.4` every schedule shrinks it. In deep Q-learning on Atari, van Hasselt et al. never saw unbounded divergence (no NaN, not-a-number, values), but "soft divergence", values above the largest possible return of 100, was common: 61 % of runs for plain Q-learning, fewer with a target network or double Q-learning, and fewer with multi-step returns (94 % of one-step Q-learning runs vs 21 % with 10-step returns) ✅[^3].
7. **Overestimation.** The `max` in the target uses the same values to choose and to score an action, so it prefers values that happen to be overestimated ✅[^2]. Even estimates that are right on average push it up: if all `m ≥ 2` actions share the true value `V*(s)` and the estimates' errors average zero with mean square `C > 0`, then `max_a Q(s,a) ≥ V*(s) + sqrt(C/(m − 1))` ✅[^2]. With independent standard-normal errors the bias grows with the number of actions while a double estimator stays unbiased ✅[^2]; lab Part 1 shows it: 0.567 for 2 actions, 1.537 for 10, 2.506 for 100, and about 0 for the double estimator. Bootstrapping then spreads the bias to earlier states, and because it differs across states it distorts which states look better ✅[^2]. It is not optimism in the face of uncertainty but, in the paper's words, "overoptimism in the face of apparent certainty" ✅[^2].
8. **Double DQN.** Double Q-learning learns two value functions and uses one to choose the greedy action and the other to score it ✅[^2]. Double DQN reuses the target network as the second function: `Y = R + γ·Q(S', argmax_a Q(S', a; θ); θ⁻)`, the online network choosing and the target network scoring, with everything else in DQN unchanged ✅[^2].

## Worked example
A tiny DQN on a 10-cell corridor: start in a random cell 1–8, move left or right, entering cell 9 pays +1 and ends the episode, entering cell 0 ends it with 0, `γ = 0.9`. The input is the position scaled to `[0, 1]`, so a 1→32→32→2 network must generalize across cells. True values: `Q*(s, right) = 0.9^(8−s)`. Four variants, 5 seeds each, 4,000 steps, one Adam update of 32 transitions per step: random minibatches from a 2,000-transition replay buffer vs the 32 most recent transitions, and a target network copied every 100 steps vs bootstrapping on the online network. Lab run (`machine-learning/lab-setup.md`), 2026-11-24, Python 3.13.7, PyTorch 2.15.0 (CPU, central processing unit, 1 thread), two runs identical ✅[^7]:

```text
Q*(s,right) for s=1..8: [0.478, 0.531, 0.59, 0.656, 0.729, 0.81, 0.9, 1.0]
variant                      max|Q-Q*| per seed                         mean  greedy-right cells (of 8)
replay=yes target=yes          0.008   0.169   0.084   0.008   0.077   0.069  [8, 8, 8, 8, 8]
replay=yes target=no           0.017   0.273   0.059   0.018   0.238   0.121  [8, 8, 8, 8, 8]
replay=no  target=yes          0.205   0.327   0.280   0.150   0.149   0.222  [8, 8, 8, 8, 8]
replay=no  target=no           0.191   0.326   0.177   0.141   0.165   0.200  [8, 8, 8, 8, 8]
```

<details><summary>Full script (prints the output above)</summary>

```python
# A tiny DQN on a 10-cell corridor, with and without experience replay and a target network.
# Cells 0..9; start in a random cell 1..8; actions 0 = left, 1 = right.
# Entering cell 9 pays +1 and ends the episode; entering cell 0 ends it with 0.
# Input is the scalar position s/9, so the network must generalize across cells.
import numpy as np
import torch
from torch import nn

torch.set_num_threads(1)
N, GAMMA, STEPS = 10, 0.9, 4000
# Q*(s, right) = gamma^(8-s); Q*(s, left) = gamma^(10-s) for s >= 2 and 0 for s = 1.
Q_STAR = np.array([[0.0 if s == 1 else GAMMA ** (10 - s), GAMMA ** (8 - s)] for s in range(1, N - 1)])

def net():
    return nn.Sequential(nn.Linear(1, 32), nn.ReLU(), nn.Linear(32, 32), nn.ReLU(), nn.Linear(32, 2))

def x(s):
    return torch.tensor([[s / (N - 1)]], dtype=torch.float32)

def train(replay, target_net, seed):
    rng = np.random.default_rng(seed)
    torch.manual_seed(seed)
    q = net()
    q_target = net(); q_target.load_state_dict(q.state_dict())
    opt = torch.optim.Adam(q.parameters(), lr=1e-3)
    buffer = []
    s = int(rng.integers(1, N - 1))
    for step in range(STEPS):
        eps = max(0.1, 1.0 - step / 2000)                     # linear decay 1.0 -> 0.1
        with torch.no_grad():
            a = int(rng.integers(2)) if rng.random() < eps else int(q(x(s)).argmax())
        s2 = s + (1 if a == 1 else -1)
        r, done = (1.0, True) if s2 == N - 1 else (0.0, s2 == 0)
        buffer.append((s, a, r, s2, done)); buffer = buffer[-2000:]
        # replay: 32 transitions drawn at random from the last 2000; no replay: the 32 most recent ones
        batch = [buffer[i] for i in rng.integers(len(buffer), size=32)] if replay else buffer[-32:]
        S = torch.tensor([[b[0] / (N - 1)] for b in batch]); A = torch.tensor([b[1] for b in batch])
        R = torch.tensor([b[2] for b in batch]); S2 = torch.tensor([[b[3] / (N - 1)] for b in batch])
        D = torch.tensor([float(b[4]) for b in batch])
        with torch.no_grad():                                 # bootstrap target, never back-propagated
            boot = (q_target if target_net else q)(S2).max(dim=1).values
            y = R + GAMMA * (1 - D) * boot
        pred = q(S).gather(1, A[:, None]).squeeze(1)
        loss = nn.functional.smooth_l1_loss(pred, y)          # Huber loss
        opt.zero_grad(); loss.backward(); opt.step()
        if target_net and step % 100 == 0:
            q_target.load_state_dict(q.state_dict())          # hard copy every 100 steps
        s = int(rng.integers(1, N - 1)) if done else s2
    with torch.no_grad():
        Q = q(torch.tensor([[c / (N - 1)] for c in range(1, N - 1)])).numpy()
    err = np.abs(Q - Q_STAR).max()
    right = int((Q.argmax(axis=1) == 1).sum())
    return err, right

print(f"Q*(s,right) for s=1..8: {np.round(Q_STAR[:, 1], 3).tolist()}")
print(f"{'variant':28s} {'max|Q-Q*| per seed':40s} {'mean':>6s}  greedy-right cells (of 8)")
for replay, target_net in [(True, True), (True, False), (False, True), (False, False)]:
    name = f"replay={'yes' if replay else 'no '} target={'yes' if target_net else 'no '}"
    res = [train(replay, target_net, seed) for seed in range(5)]
    errs = [e for e, _ in res]
    print(f"{name:28s} {' '.join(f'{e:7.3f}' for e in errs):40s} {np.mean(errs):6.3f}  {[r for _, r in res]}")
```

</details>

Reading it:
- **Replay mattered most here.** With random minibatches from the buffer, the largest Q-value error averaged 0.069 (with a target network) and 0.121 (without); training on the 32 most recent, consecutive transitions gave 0.222 and 0.200 with the same number of gradient steps and samples. Consecutive transitions all come from one stretch of one episode, which is the correlation replay is meant to break.
- **The target network helped with replay, on average.** The mean error fell from 0.121 to 0.069, but per seed the picture is mixed: seed 2 (third column) did better without it, 0.059 vs 0.084. Without replay it did not help at all in this run. Five seeds on a 10-cell task are a demonstration, not a benchmark.
- **A right policy can sit on wrong values.** Every variant's greedy policy moved right in all 8 cells, yet errors reached 0.33. If you only watch returns, value errors stay invisible until they change an `argmax`.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Q-values above the largest possible return | "Soft divergence"; it often recovers, but correlates with poor control | With rewards clipped to `[−1, 1]` and `γ = 0.99`, no true value exceeds `1/(1 − γ) = 100` ✅[^3]; check `max |Q|` against that bound |
| Gradient flows through the target | The target moves with every step it is supposed to anchor | DQN holds the previous parameters fixed in the target ✅[^1]; in code, compute it under `torch.no_grad()` ✅[^7] |
| Terminal next state | Target is `r` alone | The PyTorch tutorial stores no next state when `terminated` is true ✅[^4] |
| Rewards on very different scales across tasks | One learning rate does not fit all | DQN clipped rewards to ±1, which limits error derivatives but hides reward magnitudes ✅[^1] |
| Uniform replay | Rare, informative transitions get no extra weight | A stated limitation of uniform sampling ✅[^1]; prioritized replay in turn raised soft divergence from 52 % to 77 % for Q-learning ✅[^3] |
| Bigger network | More soft divergence for Q-learning (67 % vs 53 %) yet better control | Observed in the deadly-triad study ✅[^3] |
| Continuous actions | `max_a' Q(s', a')` has no cheap solution | DDPG learns a target policy network to approximate the maximizing action ✅[^5] |
| Correct greedy policy, wrong values | Returns look fine while values are off | Lab: all policies right, errors up to 0.33 ✅[^7] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Hard target copy every `C` steps | The scheme of the 2015 DQN (Mnih et al.); simple ✅[^2] | The target jumps at each copy |
| Soft (polyak) target update | Target changes smoothly every step ✅[^4] ✅[^5] | One more hyperparameter, `τ` |
| Larger replay buffer | Wider range of experience ✅[^5] | Can slow learning ✅[^5] |
| Double DQN target | Less overestimation and better Atari scores ✅[^2] | Minimal change, little extra computation ✅[^2] |
| Value-based (Q-learning family) vs policy optimization | Reuses data, more sample-efficient when it works ✅[^8] | Optimizes performance only indirectly; less stable ✅[^8] |

## Takeaways
- Never back-propagate through the bootstrap target; compute it from a target network under `no_grad`. [rule-candidate]
- Monitor `max |Q|` against `r_max / (1 − γ)`; values beyond it signal soft divergence before returns do. [rule-candidate]
- Use the double-DQN target by default: it costs one extra `argmax` and reduces overestimation.
- Replay is what makes off-policy reuse possible; size the buffer to hold a wide range of experience, not only recent data.

## Verification status
- Verified: 55 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- [Playing Atari with Deep Reinforcement Learning](https://arxiv.org/html/1312.5602v1) — Mnih et al., 2013. Backs: correlated samples, shifting distribution and moving targets; earlier divergence results; experience replay and its three benefits; off-policy requirement; loss with fixed previous parameters; Algorithm 1's target computed with the current `θ` (no target network); one forward pass for all actions; original settings (1M frames, minibatch 32, ε from 1 to 0.1); uniform-sampling limitation; reward clipping; results on seven games. [^1]
- [Deep Reinforcement Learning with Double Q-learning](https://arxiv.org/html/1509.06461v3) — van Hasselt, Guez, Silver, 2015. Backs: parameterized value functions for large problems; DQN as `R^n → R^m`; target network (an ingredient of the 2015 DQN) and DQN target; replay and target network both improve DQN; `max` overestimation and its lower bound; bias growing with the number of actions; bias spread by bootstrapping; "apparent certainty"; Double Q-learning and the Double DQN target. [^2]
- [Deep Reinforcement Learning and the Deadly Triad](https://arxiv.org/html/1812.02648v1) — van Hasselt et al., 2018. Backs: the triad and divergence; DQN has all three; generalization side effects; the `w, 2w` example and `(2γ − 1)·w`; soft divergence and the 100 bound; 61 %, 94 % vs 21 %, 67 % vs 53 %, 52 % to 77 %. [^3]
- [Reinforcement Learning (DQN) Tutorial](https://docs.pytorch.org/tutorials/intermediate/reinforcement_q_learning.html) — PyTorch, living. Backs: Huber loss definition and robustness, `nn.SmoothL1Loss`, soft target update with `TAU = 0.005`, no next state on termination. [^4]
- [Deep Deterministic Policy Gradient](https://spinningup.openai.com/en/latest/algorithms/ddpg.html) — OpenAI Spinning Up, 2018. Backs: replay-buffer size trade-off, why a target network is needed, hard copies in DQN vs polyak averaging, the target policy network for continuous actions. [^5]
- [8.5 Off-Policy Bootstrapping](http://incompleteideas.net/book/first/ebook/node90.html) — Sutton & Barto, Reinforcement Learning: An Introduction (1st ed., HTML), 1998. Backs: bootstrapping convergence results hold for the on-policy distribution; off-policy bootstrapping with function approximation can diverge. [^6]
- `machine-learning/lab-setup.md` — the lab where the max-vs-double estimator check, the `w, 2w` divergence example and the corridor DQN ablation ran on 2026-11-24. [^7]
- [Part 2: Kinds of RL Algorithms](https://spinningup.openai.com/en/latest/spinningup/rl_intro2.html) — OpenAI Spinning Up, 2018. Backs: Q-learning methods are more sample-efficient but less stable than policy optimization. [^8]

## Related
- `machine-learning/reinforcement-learning/temporal-difference-and-q-learning.md` — tabular Q-learning, the update DQN approximates.
- `machine-learning/reinforcement-learning/policy-gradients-and-ppo.md` — the policy-optimization alternative.
- `machine-learning/deep-learning/neural-networks-and-backpropagation.md` — the network and autograd behind `loss.backward()`.
- `machine-learning/deep-learning/optimizers-and-learning-rate-schedules.md` — Adam and RMSprop, the optimizers used here and in the original DQN.
- `machine-learning/foundations/loss-functions-and-maximum-likelihood.md` — Huber loss among the regression losses.
- `machine-learning/foundations/gradient-descent.md` — the update each regression step performs.
- `machine-learning/reinforcement-learning/offline-reinforcement-learning.md` — over-estimated values on actions a dataset never took.
