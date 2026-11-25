---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/reinforcement-learning
status: verified
applies-to: ["any"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [machine-learning, reinforcement-learning, temporal-difference, td-learning, monte-carlo, bootstrapping, sarsa, q-learning, on-policy, off-policy, cliff-walking]
---

# Temporal-difference learning: TD(0), SARSA and Q-learning

## Summary
**TL;DR:** Temporal-difference (TD) methods learn values from sampled transitions, without the environment's transition probabilities: after every step they move `V(s)` toward `r + γ·V(s')`, a target built from their own estimate of the next state (bootstrapping). Monte Carlo (MC) methods wait for the episode's actual return instead. SARSA (state–action–reward–state–action) learns the action values of the ε-greedy policy it actually follows (on-policy); Q-learning bootstraps from the greedy action and learns the optimal values while it explores (off-policy). On cliff walking the difference is visible: Q-learning learns the shortest path along the cliff edge, SARSA a safer path one row up, and SARSA earns more while it is still exploring.
**Use this when:** an agent must learn from experience without a model, you choose between SARSA and Q-learning, or a tabular TD update misbehaves (terminal handling, step size, exploration).
**Not this doc:** the Markov decision process (MDP), `V`, `Q` and the Bellman equations → `machine-learning/reinforcement-learning/markov-decision-processes.md`; Q-learning with a neural network → `machine-learning/reinforcement-learning/deep-q-networks.md`.

## Problem
Value iteration needs `P(s'|s,a)`, and real environments (a robot, a game, a user) do not hand it over. Monte Carlo learning avoids the model by averaging actual returns, but it must wait until each episode ends, which is slow for long episodes and impossible for tasks that never end. And an agent that explores while it learns faces a second choice: learn the value of what it really does, exploration included, or the value of the best possible behaviour. On cliff walking those two answers are two different paths, and two different amounts of reward collected while learning.

## Mental model
**Analogy:** predicting your drive home. A Monte Carlo learner corrects the morning's 30-minute estimate only after arriving home. A TD learner corrects each estimate toward the next one as soon as it is made: stuck in a jam 25 minutes in and now expecting 25 more, it already knows the 30-minute guess was too optimistic ✅[^1]. For control, picture a hiker on a cliff trail who stumbles one step in ten. SARSA learns "how this trail goes for me, stumbles included" and keeps away from the edge; Q-learning learns "how it would go if I never stumbled" and takes the edge, even while it still stumbles.

**Artifact:** the four update rules, as they appear in the lab scripts (`γ = 1` in both tasks, so no discount factor shows):

```python
V[s] += alpha * (G - V[s])                 # constant-alpha Monte Carlo: target = actual return G
V[s] += alpha * (r + V[s2] - V[s])         # TD(0): target = r + gamma * V(s')
target = r + Q[s2][a2]                     # SARSA: a2 = the action the agent will really take next
target = r + Q[s2].max()                   # Q-learning: the greedy action, whatever is taken next
```

## How it works
**3 actors:**
- **Behaviour policy** — its job: pick the next action, via ε-greedy over the current `Q` (random with probability `ε`).
- **Environment** — its job: return a reward and the next state, via sampling (its probabilities stay hidden).
- **Learner** — its job: correct one table entry per step, via the TD error `target − estimate`.

```text
[Behaviour policy] a = ε-greedy(Q[s]) ──► [Environment] r, s' ──► [Learner] target = r + γ·(value of s')
        ▲                                                                Q[s][a] += α·(target − Q[s][a])
        └────────────────────────── s ← s' (next step) ◄──────────────────────┘
value of s':  SARSA → Q[s'][a'] for the a' the policy picks next   ·   Q-learning → max over a' of Q[s'][a']
```

1. **Monte Carlo prediction.** After visiting `s`, wait until the return `G` that followed is known and use it as the target: `V(s) ← V(s) + α·(G − V(s))`, with `α` a constant step size ("constant-α MC") ✅[^1]. Example: `V(s) = 0.5`, `G = 1`, `α = 0.1` gives `0.55`.
2. **TD(0) prediction.** Update at the very next step instead: the target is the immediate reward plus the discounted value of the next state, `r + γ·V(s')` ✅[^11]. Example: `V(s) = 0.5`, `r = 0`, `V(s') = 0.6`, `γ = 1`, `α = 0.1`: TD error `0 + 0.6 − 0.5 = 0.1`, new `V(s) = 0.51`. Because the target contains the learner's own estimate, TD bootstraps; it combines MC's sampling with dynamic programming's bootstrapping ✅[^1]. It needs no model and learns online, one step at a time ✅[^2]. For a fixed policy, TD(0) converges to `V^π`, in the mean for a small enough constant `α` and with probability 1 for an `α` that decreases under the usual stochastic-approximation conditions ✅[^2]. No proof says TD learns faster than MC, but in practice it usually does on stochastic tasks, as on the random walk below ✅[^2].
3. **Random walk check.** Five states in a row, every episode starts in the middle, each step goes left or right with probability 0.5, exiting right pays +1 and exiting left 0, undiscounted, so a state's true value is its probability of exiting right ✅[^2]: `1/6, 2/6, …, 5/6`. Lab run (`machine-learning/lab-setup.md`), 2026-11-24, Python 3.13.7, numpy 2.5.5, two runs identical ✅[^10]:

   ```text
   Random walk, RMS error vs true values (mean of 100 runs)
   method            ep 1   ep 10   ep 25  ep 100
   TD(0) a=0.15     0.216   0.097   0.060   0.073
   TD(0) a=0.05     0.229   0.175   0.110   0.036
   MC a=0.04        0.231   0.184   0.140   0.109
   MC a=0.01        0.234   0.213   0.183   0.097
   ```

   <details><summary>Full script (prints the output above)</summary>

   ```python
   # Monte Carlo vs TD(0) prediction on the 5-state random walk.
   import numpy as np

   # States 1..5 are non-terminal, 0 and 6 are terminal; every episode starts at 3.
   TRUE_V = np.arange(1, 6) / 6                        # P(exit right) from each state
   def episode(rng):
       s, states = 3, [3]
       while s not in (0, 6):
           s += 1 if rng.random() < 0.5 else -1
           states.append(s)
       return states, (1.0 if s == 6 else 0.0)          # only reward: +1 on exiting right

   def rms_curve(method, alpha, runs=100, n_ep=100):
       errs = np.zeros(n_ep)
       for run in range(runs):
           rng = np.random.default_rng(run)
           V = np.full(7, 0.5); V[0] = V[6] = 0.0
           for ep in range(n_ep):
               states, G = episode(rng)
               if method == "TD(0)":                    # update after every step, bootstrapping on V(s')
                   for s, s2 in zip(states, states[1:]):
                       r = 1.0 if s2 == 6 else 0.0
                       V[s] += alpha * (r + V[s2] - V[s])
               else:                                    # constant-alpha MC: wait for the return G
                   for s in states[:-1]:
                       V[s] += alpha * (G - V[s])
               errs[ep] += np.sqrt(np.mean((V[1:6] - TRUE_V) ** 2))
       return errs / runs

   print("Random walk, RMS error vs true values (mean of 100 runs)")
   print(f"{'method':14s}{'ep 1':>8s}{'ep 10':>8s}{'ep 25':>8s}{'ep 100':>8s}")
   for method, alpha in [("TD(0)", 0.15), ("TD(0)", 0.05), ("MC", 0.04), ("MC", 0.01)]:
       c = rms_curve(method, alpha)
       print(f"{method + ' a=' + str(alpha):14s}" + "".join(f"{c[i]:8.3f}" for i in (0, 9, 24, 99)))
   ```

   </details>

   After 10 episodes TD(0) with `α = 0.15` is at 0.097 root-mean-square (RMS) error, against 0.184 for the best MC setting. With that large constant `α` its error then rises again (0.060 at episode 25, 0.073 at 100): a constant step size never lets estimates settle, they keep reacting to the latest samples ✅[^8]. The smaller `α = 0.05` is slower but reaches 0.036.
4. **SARSA: on-policy control.** To choose actions the learner needs action values. SARSA estimates `Q^π` for the policy it is following, updating after every transition from the quintuple `(s, a, r, s', a')` that gives it its name, with `Q(terminal, ·) = 0` ✅[^3]. Its target is `r + γ·Q(s', a')`, where `a'` is the action actually taken in `s'` ✅[^6]. The same `Q` drives an ε-greedy policy, so the policy grows greedier as `Q` improves ✅[^3]. Sutton & Barto (1998) report, from a then-unpublished personal communication, that SARSA converges to an optimal policy with probability 1 if every pair is visited infinitely often and the policy becomes greedy in the limit ✅[^3].
5. **Q-learning: off-policy control.** The target is `r + γ·max_a' Q(s', a')` ✅[^6]. The learned `Q` approximates `Q*` directly, whichever policy generates the data; correct convergence only needs every state–action pair to keep being updated, plus the usual step-size conditions ✅[^4]. Seen from value iteration, Q-learning replaces the sum over all next states with the next states actually visited ✅[^5], and uses an exploration policy such as ε-greedy to make sure varied pairs are visited ✅[^5].
6. **On-policy vs off-policy.** An on-policy method learns from data collected by the current version of its own policy; an off-policy method can learn from data collected at any time, whatever the exploration ✅[^7]. SARSA is the on-policy case and Q-learning the off-policy one ✅[^4].
7. **Episode ends.** If `s'` is terminal, its value term is zero, written as a `(1 − terminal)` factor on the bootstrap term ✅[^5]. If the episode was only truncated (a time limit), the target must still bootstrap ✅[^9].

## Worked example
Cliff walking, as in Sutton & Barto's Example 6.6 ✅[^4]: a 4 × 12 grid, start at the bottom-left, goal at the bottom-right, and the ten cells between them along the bottom are the cliff. In the lab's version every move costs −1, stepping into the cliff costs −100 and sends the agent back to the start, and the task is undiscounted. Both methods use ε-greedy with `ε = 0.1`, `α = 0.5`, 500 episodes, 50 seeds. Lab run (`machine-learning/lab-setup.md`), 2026-11-24, Python 3.13.7, numpy 2.5.5, two runs identical ✅[^10]:

```text
Cliff walking, eps=0.1, alpha=0.5, 500 episodes, 50 seeds
SARSA     : mean return per episode while learning (episodes 401-500) =  -25.74
            greedy-policy return after training -> number of seeds: {-17.0: 38, -19.0: 4, -100.0: 8}
            greedy path, seed 1 (C = cliff, * = visited), return -17:
              ************
              *..........*
              *..........*
              *CCCCCCCCCC*
Q-learning: mean return per episode while learning (episodes 401-500) =  -48.52
            greedy-policy return after training -> number of seeds: {-13.0: 50}
            greedy path, seed 1 (C = cliff, * = visited), return -13:
              ............
              ............
              ************
              *CCCCCCCCCC*
```

<details><summary>Full script (prints the output above)</summary>

```python
# SARSA vs Q-learning on cliff walking (4 x 12 grid), epsilon-greedy behaviour, gamma = 1.
import numpy as np

ROWS, COLS, START, GOAL = 4, 12, (3, 0), (3, 11)
MOVES = [(-1, 0), (0, 1), (1, 0), (0, -1)]           # up, right, down, left
def env_step(s, a):
    r, c = min(max(s[0] + MOVES[a][0], 0), ROWS - 1), min(max(s[1] + MOVES[a][1], 0), COLS - 1)
    if r == 3 and 0 < c < 11:
        return START, -100.0                         # fell off the cliff: back to start
    return (r, c), -1.0

def eps_greedy(Q, s, eps, rng):
    return int(rng.integers(4)) if rng.random() < eps else int(np.argmax(Q[s]))

def train(method, seed, episodes=500, alpha=0.5, eps=0.1):
    rng = np.random.default_rng(seed)
    Q = np.zeros((ROWS, COLS, 4))
    returns = []
    for _ in range(episodes):
        s, G = START, 0.0
        a = eps_greedy(Q, s, eps, rng)
        while s != GOAL:
            s2, r = env_step(s, a)
            G += r
            a2 = eps_greedy(Q, s2, eps, rng)
            if method == "SARSA":                    # target uses the action actually taken next
                target = r + (0.0 if s2 == GOAL else Q[s2][a2])
            else:                                    # Q-learning: target uses the greedy action
                target = r + (0.0 if s2 == GOAL else Q[s2].max())
            Q[s][a] += alpha * (target - Q[s][a])
            s, a = s2, a2
        returns.append(G)
    return Q, returns

def greedy_path(Q):
    grid = [["." for _ in range(COLS)] for _ in range(ROWS)]
    for c in range(1, 11):
        grid[3][c] = "C"
    s, G = START, 0.0
    for _ in range(100):                             # at most 100 moves: -100 means the policy loops
        grid[s[0]][s[1]] = "*"
        if s == GOAL:
            break
        s, r = env_step(s, int(np.argmax(Q[s])))
        G += r
    return ["".join(row) for row in grid], G

print("Cliff walking, eps=0.1, alpha=0.5, 500 episodes, 50 seeds")
for method in ("SARSA", "Q-learning"):
    runs = [train(method, seed) for seed in range(50)]
    online = np.mean([np.mean(ret[400:]) for _, ret in runs])
    greedy = [greedy_path(Q)[1] for Q, _ in runs]
    counts = {g: greedy.count(g) for g in sorted(set(greedy), reverse=True)}
    path, G = greedy_path(runs[1][0])
    print(f"{method:10s}: mean return per episode while learning (episodes 401-500) = {online:7.2f}")
    print(f"{'':12s}greedy-policy return after training -> number of seeds: {counts}")
    print(f"{'':12s}greedy path, seed 1 (C = cliff, * = visited), return {G:.0f}:")
    for row in path:
        print(f"{'':14s}{row}")
```

</details>

Reading it:
- **Q-learning learned the optimal path.** In all 50 seeds its greedy policy walks the row next to the cliff: 13 moves, return −13. Its target uses `max Q(s', ·)`, the value of never stumbling, so the edge looks safe.
- **SARSA learned the safe path.** In 38 seeds its greedy policy climbs to the top row and back down, 17 moves, return −17 (4 more in another 4 seeds). Its target uses the action really taken next, which is random one time in ten, so cells next to the cliff carry the cost of occasional falls and it keeps a distance.
- **While exploring, SARSA earns more:** −25.74 per episode against −48.52 for Q-learning, whose ε-greedy random steps on the edge path sometimes fall in for −100. Sutton & Barto describe the same pattern: Q-learning learns the optimal policy's values but performs worse online than SARSA ✅[^4].
- **The −100 entries are not falls.** The path printer stops after 100 moves, so a return of exactly −100 means that seed's greedy policy loops (for example into a wall). With a constant `α = 0.5`, values of rarely visited cells stay noisy, and in 8 SARSA seeds the greedy choice in one such cell led nowhere; the ε-greedy policy that was actually trained still reached the goal.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Next state is terminal | Target is just `r` | `Q(terminal, ·)` is defined as 0 ✅[^3]; a `(1 − terminal)` factor removes the bootstrap term ✅[^5] |
| Episode stopped by a time limit | Target must still bootstrap | Truncation is not termination ✅[^9] |
| Constant step size `α` | Estimates keep moving; lab TD(0) error rose from 0.060 to 0.073 with `α = 0.15` | A constant `α` never satisfies the conditions for settling ✅[^8]; lab ✅[^10] |
| Episodes that might never end | MC cannot learn until an end that may not come | TD learns during the episode and abandons a looping policy ✅[^3] |
| Exploration that misses some state–action pairs | Q-learning's guarantee is lost; the estimate can be poor even in visited states | Convergence needs every pair to keep being updated ✅[^4]; all values are tied together by the update ✅[^5] |
| `ε` kept fixed after learning | Q-learning keeps falling off the edge | Its policy is optimal but its behaviour still explores; with `ε` reduced gradually both methods approach the optimal policy ✅[^4] |
| Greedy policy read from a noisy table | It can loop (8 of 50 SARSA seeds in the lab) | Rarely visited cells keep noisy values under `α = 0.5` ✅[^10] |
| Too many states for a table | Tabular TD is impractical | Replace the table by a network: `deep-q-networks.md` |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Monte Carlo | Target is the actual return; no bootstrapping ✅[^1] | Waits for the episode end ✅[^2]; slower than TD(0) on the lab random walk ✅[^10] |
| TD(0) | No model; learns every step, online ✅[^2] | Target leans on its own current estimate ✅[^1]; step size must be tuned (lab) ✅[^10] |
| SARSA (on-policy) | Values include its own exploration: safer path, −25.74 online in the lab ✅[^10] | Learns the ε-greedy policy's values, not the optimal ones, unless `ε` decays ✅[^4] |
| Q-learning (off-policy) | Learns `Q*` whatever the behaviour ✅[^4]; can use data from any time ✅[^7] | Worse online return while exploring (−48.52 in the lab) ✅[^10]; with function approximation, part of the deadly triad (`deep-q-networks.md`) |

## Takeaways
- Use TD when episodes are long or endless; use MC targets when you need targets free of your own estimates.
- Pick SARSA when exploration mistakes are costly during learning, Q-learning when only the final greedy policy matters. [rule-candidate]
- Zero the bootstrap term on termination only, never on truncation. [rule-candidate]
- A constant step size buys tracking at the price of noise: check the final greedy policy, not only the learning curve.

## Verification status
- Verified: 46 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- [6.1 TD Prediction](http://incompleteideas.net/book/first/ebook/node61.html) — Sutton & Barto, Reinforcement Learning: An Introduction (1st ed., HTML), 1998. Backs: constant-α MC uses the actual return as target; TD updates at the next step; bootstrapping; TD = MC sampling + DP bootstrapping; the driving-home example. [^1]
- [6.2 Advantages of TD Prediction Methods](http://incompleteideas.net/book/first/ebook/node62.html) — Sutton & Barto (1st ed., HTML), 1998. Backs: no model needed, online and incremental, convergence for a fixed policy, no proof of which is faster, TD usually faster in practice, the random-walk task. [^2]
- [6.4 Sarsa: On-Policy TD Control](http://incompleteideas.net/book/first/ebook/node64.html) — Sutton & Barto (1st ed., HTML), 1998. Backs: SARSA learns `Q^π` from `(s, a, r, s', a')`, terminal value 0, policy grows greedy, reported convergence conditions, MC's problem with episodes that may not end. [^3]
- [6.5 Q-Learning: Off-Policy TD Control](http://incompleteideas.net/book/first/ebook/node65.html) — Sutton & Barto (1st ed., HTML), 1998. Backs: Q-learning approximates `Q*` whatever the policy, needs every pair updated, cliff-walking results (edge path, worse online performance, decaying ε). [^4]
- [17.3 Q-Learning](https://d2l.ai/chapter_reinforcement-learning/qlearning.html) — Dive into Deep Learning, living. Backs: sampled next states replace the sum over `s'`, the terminal indicator, ε-greedy exploration policy, values tied together across states. [^5]
- [Asynchronous Methods for Deep Reinforcement Learning](https://arxiv.org/html/1602.01783v2) — Mnih et al., 2016. Backs: the one-step Q-learning target `r + γ·max Q(s', a')` and the one-step SARSA target `r + γ·Q(s', a')` with `a'` the action taken. [^6]
- [Part 2: Kinds of RL Algorithms](https://spinningup.openai.com/en/latest/spinningup/rl_intro2.html) — OpenAI Spinning Up, 2018. Backs: on-policy vs off-policy data use. [^7]
- [2.6 Tracking a Nonstationary Problem](http://incompleteideas.net/book/first/ebook/node20.html) — Sutton & Barto (1st ed., HTML), 1998. Backs: with a constant step size, estimates never completely converge. [^8]
- [Handling Time Limits](https://gymnasium.farama.org/tutorials/gymnasium_basics/handling_time_limits/) — Gymnasium (Farama Foundation), living. Backs: bootstrap on truncation, not on termination. [^9]
- `machine-learning/lab-setup.md` — the lab where the random-walk MC vs TD(0) comparison and the cliff-walking SARSA vs Q-learning runs ran on 2026-11-24. [^10]
- [Deep Reinforcement Learning and the Deadly Triad](https://arxiv.org/html/1812.02648v1) — van Hasselt et al., 2018. Backs: the TD target is the reward plus the discounted value of the next state. [^11]

## Related
- `machine-learning/reinforcement-learning/markov-decision-processes.md` — `V`, `Q`, the Bellman equations and value iteration, which TD samples.
- `machine-learning/reinforcement-learning/multi-armed-bandits.md` — ε-greedy and exploration in the one-state case.
- `machine-learning/reinforcement-learning/deep-q-networks.md` — Q-learning with a neural network, and why off-policy bootstrapping can diverge.
- `machine-learning/reinforcement-learning/policy-gradients-and-ppo.md` — actor-critic methods reuse the TD error as their learning signal.
