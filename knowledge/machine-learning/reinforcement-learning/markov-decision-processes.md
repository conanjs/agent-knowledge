---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/reinforcement-learning
status: verified
applies-to: ["any"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [machine-learning, reinforcement-learning, mdp, markov-decision-process, bellman-equation, value-function, discount-factor, value-iteration, policy]
---

# Markov decision processes, Bellman equations and value iteration

## Summary
**TL;DR:** A Markov decision process (MDP) describes a sequential decision problem as states, actions, transition probabilities and rewards; a policy picks the actions, and the goal is the policy with the highest expected discounted return. A value function gives the expected return from a state, and the Bellman equation writes it as "reward now plus γ times the expected value of the next state". When the transition probabilities are known, value iteration applies the Bellman optimality equation as an update until the values stop changing, and acting greedily on the result is optimal.
**Use this when:** you frame a problem as reinforcement learning (RL), read RL notation (`s`, `a`, `r`, `γ`, `π`, `V`, `Q`), choose a discount factor, or decide how an episode end (terminated or truncated) enters a value target.
**Not this doc:** learning when the transition probabilities are unknown → `machine-learning/reinforcement-learning/temporal-difference-and-q-learning.md`; problems with a single state → `machine-learning/reinforcement-learning/multi-armed-bandits.md`.

## Problem
In supervised learning every example comes with the right answer. A decision-making agent gets only a reward number, often many steps after the action that earned it, and its own actions decide which situations it sees next. Without a formal model "best behaviour" is undefined: the sum of rewards over an endless episode can be infinite, two strategies cannot be compared state by state, and there is nothing to compute. A practical bug follows from the same gap: code that treats "the episode hit its time limit" like "the agent reached a terminal state" learns wrong values (Edge cases).

## Mental model
**Analogy:** a board game with dice. The squares are states, the moves you may choose are actions, the dice decide where a move really lands (transition probabilities), and some squares pay points (rewards). A strategy card that says what to do on each square is a policy. A square's value is the points you expect to collect from there on if you follow the card, with each later point worth a bit less, like money that loses value while you wait (the discount factor γ). The Bellman equation is the bookkeeping rule: a square's value = the points this move earns + γ × the average value of the squares the dice can send you to.

**Artifact:** the 4×4 gridworld used in this doc, and its transition function as code (the full script is in Worked example):

```text
        col 0  col 1  col 2  col 3
row 0   start  A(+1)   .      .      A, B: exits; entering one pays its reward and ends the episode
row 1    .      .      .      .      actions: up, right, down, left
row 2    .      .      .      .      a move goes where intended with probability 0.8 and slips
row 3    .      .      .     B(+10)  to each perpendicular side with 0.1; into a wall = stay put
```

```python
def outcomes(cell, a):                              # P(s'|s,a): 0.8 intended, 0.1 each side
    left, right = MOVES[(a - 1) % 4], MOVES[(a + 1) % 4]
    return [(0.8, step(cell, MOVES[a])), (0.1, step(cell, left)), (0.1, step(cell, right))]
```

## How it works
**2 actors:**
- **Agent** — its job: choose an action in each state, via its policy `π(a|s)`.
- **Environment** — its job: move to a next state and emit a reward, via the transition function `P(s'|s,a)` and the reward function `r(s,a)`.

```text
   ┌──────────────────── next state s_{t+1}, reward r_t ────────────────────┐
   ▼                                                                         │
[Agent]  a_t ~ π(·|s_t)  ── action a_t ──►  [Environment]  s_{t+1} ~ P(·|s_t,a_t), r_t = r(s_t,a_t)
```

1. **The loop.** At each step the agent sees an observation of the state and chooses an action; the environment changes and emits a reward, and the agent's goal is to maximize its cumulative reward, called the return ✅[^1]. A state describes the world completely; an observation may leave parts out ✅[^1].
2. **The MDP.** The formal model is a set of states `S`, a set of actions `A`, a transition function `T(s,a,s') = P(s'|s,a)` whose probabilities over `s'` sum to 1, and a reward function `r(s,a)` that the designer writes with the goal in mind ✅[^2]. Spinning Up's version of the tuple adds the start-state distribution `ρ₀` ✅[^1]. In the artifact, `P(A | start, down) = 0.1`: a move down slips right into exit A one time in ten. "Markov" means the next state depends only on the current state and action, not on earlier history ✅[^1] ✅[^2].
3. **Return and discount.** The discounted return of a trajectory is `G = r_0 + γ·r_1 + γ²·r_2 + … = Σ_t γ^t · r_t`, where `r_t` is the reward at step `t` and `γ < 1` is the discount factor; it keeps the return of an endless trajectory finite ✅[^2]. Example: rewards `0, 0, 10` with `γ = 0.9` give `G = 0 + 0.9·0 + 0.81·10 = 8.1`. A small `γ` discounts far rewards heavily, which favours short paths to a goal ✅[^2]; Spinning Up's intuition is "cash now is better than cash later" ✅[^1].
4. **Policy.** A policy `π(a|s)` is a probability distribution over actions in each state, for example `[0.4, 0.2, 0.1, 0.3]` over four moves; a deterministic policy puts probability 1 on one action ✅[^3]. The RL problem is to find a policy that maximizes expected return ✅[^1].
5. **Value functions.** `V^π(s)` is the expected discounted return when starting in `s` and following `π`; `Q^π(s,a)` is the same with the first action fixed to `a` ✅[^3]. `V*` and `Q*` are the values under an optimal policy ✅[^1]. At least one policy is better than or equal to every other in every state, and all optimal policies share `V*` and `Q*` ✅[^5]. The advantage `A^π(s,a) = Q^π(s,a) − V^π(s)` says how much better action `a` is than the policy's average behaviour ✅[^1]; policy-gradient methods are built on it (`policy-gradients-and-ppo.md`).
6. **Bellman expectation equation.** Splitting a trajectory into "the first step" and "the rest" gives, for every state, `V^π(s) = Σ_a π(a|s) · [ r(s,a) + γ · Σ_s' P(s'|s,a) · V^π(s') ]` ✅[^3]. Spinning Up's one-line version: "The value of your starting point is the reward you expect to get from being there, plus the value of wherever you land next." ✅[^1] The right-hand side is called a Bellman backup ✅[^1].
7. **Bellman optimality equation.** For optimal values the average over the policy becomes a maximum over actions, which is the one difference between the two families of equations ✅[^1]: `V*(s) = max_a [ r(s,a) + γ · Σ_s' P(s'|s,a) · V*(s') ]` ✅[^3], and for action values `Q*(s,a) = r(s,a) + γ · Σ_s' P(s'|s,a) · max_a' Q*(s',a')` ✅[^9]. An optimal action is the one that attains the maximum, `argmax_a Q*(s,a)`, and there is always an optimal policy that is deterministic ✅[^1].
8. **Value iteration.** Start from any `V_0` (zeros here) and repeat, for every state, `V_{k+1}(s) = max_a [ r(s,a) + γ · Σ_s' P(s'|s,a) · V_k(s') ]`; as `k → ∞`, `V_k` converges to `V*` whatever the initialization ✅[^3]. It is the Bellman optimality equation turned into an update rule, the same as policy evaluation stopped after one sweep plus a maximum over actions ✅[^4]; in practice one stops once a sweep changes the values by only a small amount ✅[^4]. Dropping the maximum and averaging over a fixed `π` gives policy evaluation, which converges to `V^π` ✅[^3].
9. **Where episodes end.** An environment step reports `terminated` when the agent reaches a terminal state of the MDP (a goal, a trap) and `truncated` when a condition outside the MDP, typically a time limit, cuts the episode short ✅[^6]. A value target bootstraps from the next state unless the episode terminated, `target = r + γ · (1 − terminated) · V(s')`, so a truncated step still bootstraps ✅[^7].

## Worked example
Value iteration on the artifact gridworld, for `γ = 0.9`, then `0.5` and `0.1`. The core of one sweep, one Bellman optimality backup per cell:

```python
for a in range(4):
    for p, nxt in outcomes(cell, a):
        reward = EXITS.get(nxt, 0.0)                # reward for entering an exit
        q[a] += p * (reward + gamma * (0.0 if nxt in EXITS else V[nxt]))
V_new[r, c] = q.max()
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-24, Python 3.13.7, numpy 2.5.5, two runs identical ✅[^8]:

```text
gamma=0.9, convergence from V=0:
  sweep  1: V(start)=0.8000  max change=8.0000
  sweep  2: V(start)=0.8720  max change=6.4800
  sweep  3: V(start)=0.9368  max change=4.6800
  sweep  5: V(start)=0.9600  max change=2.7781
  sweep 10: V(start)=4.5519  max change=0.2028
  sweep 20: V(start)=4.7116  max change=0.0002
  converged after 27 sweeps (max change < 1e-6)
V* (gamma=0.9):
   4.712  0.000  6.472  7.250
   5.816  6.549  7.439  8.354
   6.532  7.439  8.469  9.629
   7.256  8.354  9.629  0.000
gamma=0.9: 27 sweeps, V(start)=4.712
gamma=0.5: 14 sweeps, V(start)=0.866
gamma=0.1:  7 sweeps, V(start)=0.809
greedy policy   gamma=0.9   gamma=0.5   gamma=0.1
  row 0         vA>v        >A<v        >A<<
  row 1         vvvv        >>vv        ^^<v
  row 2         >>>v        >>>v        >>>v
  row 3         >>>B        >>>B        >>>B
```

<details><summary>Full script (prints the output above)</summary>

```python
# Value iteration on a 4x4 gridworld with slippery moves and two exits.
# Exit A (row 0, col 1) pays +1, exit B (row 3, col 3) pays +10; both end the episode.
import numpy as np

N = 4
A_EXIT, B_EXIT = (0, 1), (3, 3)
EXITS = {A_EXIT: 1.0, B_EXIT: 10.0}
MOVES = [(-1, 0), (0, 1), (1, 0), (0, -1)]          # up, right, down, left
ARROWS = "^>v<"

def step(cell, move):                               # deterministic part: walls keep you in place
    r, c = cell[0] + move[0], cell[1] + move[1]
    return (r, c) if 0 <= r < N and 0 <= c < N else cell

def outcomes(cell, a):                              # P(s'|s,a): 0.8 intended, 0.1 each side
    left, right = MOVES[(a - 1) % 4], MOVES[(a + 1) % 4]
    return [(0.8, step(cell, MOVES[a])), (0.1, step(cell, left)), (0.1, step(cell, right))]

def q_values(V, cell, gamma):                       # r(s,a) + gamma * sum_s' P(s'|s,a) V(s')
    q = np.zeros(4)
    for a in range(4):
        for p, nxt in outcomes(cell, a):
            reward = EXITS.get(nxt, 0.0)            # reward for entering an exit
            q[a] += p * (reward + gamma * (0.0 if nxt in EXITS else V[nxt]))
    return q

def value_iteration(gamma, tol=1e-6, trace=False):
    V = np.zeros((N, N))
    for sweep in range(1, 10_000):
        V_new = np.zeros_like(V)
        for r in range(N):
            for c in range(N):
                if (r, c) not in EXITS:
                    V_new[r, c] = q_values(V, (r, c), gamma).max()
        delta = np.abs(V_new - V).max()
        V = V_new
        if trace and sweep in (1, 2, 3, 5, 10, 20):
            print(f"  sweep {sweep:2d}: V(start)={V[0, 0]:.4f}  max change={delta:.4f}")
        if delta < tol:
            return V, sweep

def greedy_policy(V, gamma):
    rows = []
    for r in range(N):
        row = ""
        for c in range(N):
            row += "A" if (r, c) == A_EXIT else "B" if (r, c) == B_EXIT else ARROWS[q_values(V, (r, c), gamma).argmax()]
        rows.append(row)
    return rows

print("gamma=0.9, convergence from V=0:")
V, sweeps = value_iteration(0.9, trace=True)
print(f"  converged after {sweeps} sweeps (max change < 1e-6)")
print("V* (gamma=0.9):")
for row in V:
    print("  " + " ".join(f"{v:6.3f}" for v in row))
results = {g: value_iteration(g) for g in (0.9, 0.5, 0.1)}
for g, (V, sweeps) in results.items():
    print(f"gamma={g}: {sweeps:2d} sweeps, V(start)={V[0, 0]:.3f}")
print("greedy policy   gamma=0.9   gamma=0.5   gamma=0.1")
policies = [greedy_policy(V, g) for g, (V, _) in results.items()]
for r in range(N):
    print(f"  row {r}         " + "        ".join(p[r] for p in policies))
```

</details>

Reading it:
- **Sweep 1:** `V(start) = 0.8`. The only reward one move away is exit A: moving right enters it with probability 0.8, so the best one-step value is `0.8 × 1`. Exit B's +10 then spreads back at most one cell per sweep; the start is 6 moves from B, so `V(start)` is still 0.96 at sweep 5 and has risen to 4.55 by sweep 10. The largest change per sweep falls from 8.0 to 0.0002, and the run stops after 27 sweeps.
- **The Bellman optimality equation holds at convergence.** Cell (row 2, col 3), action down: 0.8 enters B (+10, episode ends), 0.1 slips left to (2,2) worth 8.469, 0.1 slips right into the wall and stays at (2,3) worth 9.629: `0.8·10 + 0.1·0.9·8.469 + 0.1·0.9·9.629 = 8 + 0.762 + 0.867 = 9.629`, the printed value.
- **γ = 0.9:** the start moves down, away from A, because entering A ends the episode with only +1. Its value 4.712 is below its lower neighbour's 5.816 because that downward move still slips right into A with probability 0.1 and loses the +10.
- **γ = 0.5 and 0.1:** B's +10 is at least 6 moves from the start, so it is worth about `0.5^5 · 10 ≈ 0.31` there, less than A's +1; the start now heads for A (`>A<` in row 0), and at `γ = 0.1` more cells do. Same states, actions and rewards; only `γ` changed, and the optimal policy changed with it. Smaller `γ` also needed fewer sweeps in this run (27, 14, 7).

## Edge cases
| Case | What happens | Why |
|---|---|---|
| The observation leaves out part of the state (position without velocity) | The next state is not predictable from what the agent sees, so the problem is not Markov in that representation | Adding the missing quantity (velocity) to the state restores the Markov property ✅[^2]; an environment seen only through partial observations is "partially observed" ✅[^1] |
| Continuing task with `γ = 1` | The return can be infinite | The discount is what keeps an endless sum finite ✅[^2] |
| Episode stopped by a time limit | Must be treated as truncated: the target still bootstraps `γ·V(s')` | Only termination ends the MDP's future ✅[^7]; Gymnasium 0.26 replaced the single `done` flag with `terminated` and `truncated` for this reason ✅[^6] |
| Two actions tie for the maximum | Either is optimal; the code's tie rule decides which one is printed | All maximizing actions are optimal ✅[^1] |
| Reward that encodes the wrong goal | The agent optimizes what was written, not what was meant | The reward is designed by the person setting up the problem ✅[^2]; in the lab, `γ = 0.1` made a +1 exit preferable to a +10 one ✅[^8] |
| Transition probabilities unknown | Value iteration cannot run | It needs `P(s'|s,a)`; Q-learning replaces the sum over next states with sampled transitions ✅[^9] (`temporal-difference-and-q-learning.md`) |
| Too many states for a table | One value per state is impractical | A parameterized value function is learned instead ✅[^10] (`deep-q-networks.md`) |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| High `γ` (0.9 or more) | Far-sighted: the lab policy finds the +10 exit ✅[^8] | More sweeps to converge in the lab (27 at 0.9 vs 7 at 0.1) ✅[^8] |
| Low `γ` | Fewer sweeps; prefers rewards that come soon ✅[^2] | Myopic: the lab policy settles for +1 ✅[^8] |
| Value iteration | One cheap sweep per iteration; any starting values ✅[^3] | Needs the model; exact convergence only in the limit, so a stop tolerance is needed ✅[^4] |
| Policy iteration (full evaluation, then improvement) | Each policy is evaluated exactly before improving it | Each evaluation can itself take many sweeps ✅[^4] |

## Takeaways
- Write down `S`, `A`, `P`, `r` and `γ` before choosing an algorithm; if the next state depends on hidden history, put that history into the state. [rule-candidate]
- Treat `γ` as part of the problem definition, not only a tuning knob: in the lab, changing it changed the optimal policy.
- Bootstrap through truncations, never through terminations. [rule-candidate]
- When the model is known and small, value iteration gives the reference answer to test a learning algorithm against.

## Verification status
- Verified: 46 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- [Part 1: Key Concepts in RL](https://spinningup.openai.com/en/latest/spinningup/rl_intro.html) — OpenAI Spinning Up, 2018. Backs: agent–environment loop, states vs observations, return and discount intuition, RL objective, `V*`/`Q*`, Bellman equations and backup, optimal action and deterministic optimal policy, advantage, MDP tuple with `ρ₀`, Markov property. [^1]
- [17.1 Markov Decision Process (MDP)](https://d2l.ai/chapter_reinforcement-learning/mdp.html) — Dive into Deep Learning, living. Backs: MDP `(S, A, T, r)`, transition probabilities sum to 1, designer-written reward, discounted return, effect of small `γ`, Markov assumption and the velocity example. [^2]
- [17.2 Value Iteration](https://d2l.ai/chapter_reinforcement-learning/value-iter.html) — Dive into Deep Learning, living. Backs: stochastic policy example, `V^π` and `Q^π`, Bellman expectation equation, value-iteration update and its convergence from any initialization, policy evaluation. [^3]
- [4.4 Value Iteration](http://incompleteideas.net/book/first/ebook/node44.html) — Sutton & Barto, Reinforcement Learning: An Introduction (1st ed., HTML), 1998. Backs: value iteration = Bellman optimality equation as an update = one-sweep policy evaluation; stopping on a small change; policy iteration's costly evaluations. [^4]
- [3.8 Optimal Value Functions](http://incompleteideas.net/book/first/ebook/node35.html) — Sutton & Barto (1st ed., HTML), 1998. Backs: an optimal policy always exists; optimal policies share `V*` and `Q*`. [^5]
- [Env API](https://gymnasium.farama.org/api/env/) — Gymnasium (Farama Foundation), living. Backs: `terminated` vs `truncated` definitions; the 0.26 change from `done`. [^6]
- [Handling Time Limits](https://gymnasium.farama.org/tutorials/gymnasium_basics/handling_time_limits/) — Gymnasium (Farama Foundation), living. Backs: bootstrap on truncation, not on termination; the `(1 − terminated)` target. [^7]
- `machine-learning/lab-setup.md` — the lab where value iteration on the 4×4 gridworld ran for three discount factors on 2026-11-24. [^8]
- [17.3 Q-Learning](https://d2l.ai/chapter_reinforcement-learning/qlearning.html) — Dive into Deep Learning, living. Backs: value iteration for `Q`, which needs `P(s'|s,a)`; Q-learning's sampled replacement. [^9]
- [Deep Reinforcement Learning with Double Q-learning](https://arxiv.org/html/1509.06461v3) — van Hasselt, Guez, Silver, 2015. Backs: large problems learn a parameterized value function instead of one value per state. [^10]

## Related
- `machine-learning/reinforcement-learning/temporal-difference-and-q-learning.md` — learning `V` and `Q` from sampled transitions when `P` is unknown.
- `machine-learning/reinforcement-learning/multi-armed-bandits.md` — the one-state special case: exploration without state transitions.
- `machine-learning/reinforcement-learning/policy-gradients-and-ppo.md` — optimizing the policy directly, using the advantage.
- `machine-learning/foundations/what-is-machine-learning.md` — where reinforcement learning sits among the learning paradigms.
- `machine-learning/reinforcement-learning/model-based-reinforcement-learning.md` — learning the MDP's model and planning with it.
