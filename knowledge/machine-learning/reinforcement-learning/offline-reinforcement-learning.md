---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/reinforcement-learning
status: verified
applies-to: ["any"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, reinforcement-learning, offline-rl, batch-rl, distribution-shift, extrapolation-error, behaviour-cloning, bcq, cql, iql, decision-transformer, d4rl]
---

# Offline reinforcement learning: learning a policy from a fixed dataset

## Summary
**TL;DR:** Offline RL (reinforcement learning), also called batch RL, learns a policy from a fixed dataset of transitions that some earlier behaviour policy collected, with no further interaction. Its central problem is distribution shift: to beat the data, the learned policy must choose actions the data rarely or never contain, the value function has no evidence about them, the `max` in the Q-learning target picks whichever unseen action happens to look best, and nothing ever corrects it because the agent cannot try it. In the lab, naive offline Q-learning valued a step into lava at `0.00` (true value `−20.00`) and walked straight into the lava. The fixes: behaviour cloning (BC) copies the data and is as good as the data; policy constraints such as BCQ (batch-constrained deep Q-learning) consider only actions the data contain; conservative methods such as CQL (conservative Q-learning) push down the values of actions the data do not support; IQL (implicit Q-learning) never evaluates an unseen action at all; Decision Transformer predicts actions conditioned on a desired return. In the lab, BCQ-, CQL- and IQL-style methods reached the optimal 8-step return `−8.00` (IQL-style: `−8.01` on the random data) from data whose own average return was `−26.84` or `−19.00`, while BC matched each behaviour policy. D4RL (Datasets for Deep Data-Driven Reinforcement Learning) benchmarks these methods on datasets of different quality with a normalized score.
**Use this when:** you have logged interaction data but cannot explore safely or cheaply; you choose between imitating the data and offline RL; a value function trained on logs promises returns its policy never achieves; or you read D4RL results.
**Not this doc:** off-policy learning with fresh interaction (Q-learning, replay buffers) → `machine-learning/reinforcement-learning/temporal-difference-and-q-learning.md` and `machine-learning/reinforcement-learning/deep-q-networks.md`; distribution shift for supervised models in production → `machine-learning/ml-systems/data-drift-and-monitoring.md`; learning and planning with a dynamics model → `machine-learning/reinforcement-learning/model-based-reinforcement-learning.md`.

## Problem
Online RL learns by trying actions, and in domains from robotics to logistics, exploring with an untrained policy is costly or dangerous while prior data is available ✅[^4]. Off-policy algorithms look like the answer, since they can learn from data collected by another policy, but trained on a fixed batch they fail: in Fujimoto et al.'s experiments, off-policy agents performed dramatically worse than the behavioural agent even when trained with the same algorithm on the same dataset ✅[^2]. Kumar et al. observed an "unlearning" effect: the return of offline Q-learning first improves and then falls sharply as training continues, and more data does not prevent it, which suggests it is not ordinary overfitting ✅[^1]. In the lab, the same naive method scored worse than the data it learned from on the medium and expert datasets (`−21.00` against the medium data's own `−19.00`, `−30.00` against the expert's `−8.68`) ✅[^7].

## Mental model
**Analogy:** learning to drive from dashcam recordings of a careful driver. The recordings show what happens after every brake, turn and lane change the driver made. They never show a swerve into the oncoming lane, so any opinion about swerving is a guess. A learner who picks, at each moment, the manoeuvre with the best guessed outcome will choose the swerve whenever its guess happens to be high, and with no way to try it, never learns otherwise. The fixes: drive exactly like the recorded driver (BC); choose only among manoeuvres the recordings show in that situation (BCQ); treat any unrecorded manoeuvre as bad until evidence says otherwise (CQL).

**Artifact:** naive offline Q-learning on a 5×5 gridworld with lava, trained on data from a cautious behaviour policy that never stepped into lava; the row for the cell `(3,0)`, which has lava to its right; printed by the full script in the Worked example; lab run (`machine-learning/lab-setup.md`), 2026-11-25, numpy 2.5.5 ✅[^7]:

```text
== naive offline Q-learning on the medium data, cell (3,0); lava is to its right ==
action            up    down   right    left
in data          yes     yes      no     yes
naive Q        -1.95   -1.95    0.00   -1.00
true Q*        -6.03   -7.40  -20.00   -6.73
naive greedy path when executed: (4, 0) -> (3, 0) -> (3, 1)
```

The one action the data never took keeps the table's initial value `0.00`, higher than every action with evidence, so the greedy policy takes it: one step up from the start, then right into the lava at `(3,1)`.

## How it works
### The setting
1. **Data:** a static dataset `D = {(s, a, s', r)}` of transitions (state, action, next state, reward) collected by a behaviour policy `π_β`; the learner must find the best policy it can from `D` alone, which makes `D` a training set as in supervised learning ✅[^1].
2. **No exploration:** if `D` contains no transitions through the high-reward regions, finding them may be impossible ✅[^1].
3. **Counterfactual questions:** a policy better than the data must act differently from the data, so the learner must answer "what if" questions about actions it did not see, which strains tools built on the assumption that training and test data are i.i.d. (independent and identically distributed) ✅[^1].
4. **Distribution shift:** the policy, value function or model is trained on one distribution and evaluated on another, both because the new policy visits other states and because maximizing return deliberately seeks out other actions ✅[^1]. The supervised-learning version of this problem is in `machine-learning/ml-systems/data-drift-and-monitoring.md`.

### Why naive offline Q-learning fails
1. **The target asks about unseen actions.** The Q-learning target `r + γ·max_a' Q(s', a')` evaluates `Q` at actions `a'` the policy would take, which need not be in `D`; the states are all from the data, but this action distribution shift corrupts training itself ✅[^1].
2. **Those values are guesses.** Fujimoto et al. call the resulting error extrapolation error: unseen state-action pairs get unrealistic value estimates, from absent data, from too few samples of a stochastic transition (model bias) and from data weighted unlike the current policy's distribution (training mismatch) ✅[^2].
3. **The max selects the biggest guess.** The policy is optimized to maximize `Q`, so if some unseen action has an erroneously large value, the policy learns to take it ✅[^1]; combined with maximization, extrapolation error can produce a persistent overestimation bias ✅[^2] (the same `max` bias as in online DQN (deep Q-network), `machine-learning/reinforcement-learning/deep-q-networks.md`).
4. **Nothing corrects it.** Online, the agent would try the over-valued action and see that it is not good; offline it cannot, and the errors accumulate with each iteration ✅[^1].

In a table, an unseen pair simply keeps its initial value; a network outputs whatever its weights extrapolate. In the lab grid every true value is negative (each step costs `−1`), so the initial `0` plays the part of a too-high extrapolation. Even pure imitation suffers from shift: with optimal action labels in the data, a cloned policy's error bound grows quadratically with the horizon `H` offline, against linearly online, because one mistake can take it to states the data never covered ✅[^1].

### The fixes
1. **Behaviour cloning (BC):** supervised learning of `π(a|s)` from the dataset's actions; in a table it is the empirical behaviour policy, each action's count in a state divided by that state's count ✅[^3]. It cannot beat the data: most imitation learning algorithms fail on suboptimal trajectories ✅[^2]. In the lab, BC scored within 0.44 of each behaviour policy's own return ✅[^7].
2. **Policy constraints (BCQ):** a batch-constrained policy only chooses state-action pairs present in the batch ✅[^2]. The tabular version, BCQL (batch-constrained Q-learning), is Q-learning with the `max` restricted to actions seen at the next state: `Q(s,a) ← (1−α)·Q(s,a) + α·(r + γ·max_{a' with (s',a') in B} Q(s',a'))`, where `α` is the step size and `B` the batch ✅[^2]. In a deterministic MDP (Markov decision process) with a coherent batch (every next state in the batch also appears as a state, unless terminal), BCQL converges, under the usual step-size conditions, to the best batch-constrained policy and so matches or beats any behaviour policy from states in the batch ✅[^2]. The deep version samples `n` candidate actions from a conditional VAE (variational autoencoder) trained on the batch's actions, nudges each by a learned perturbation within `[−Φ, Φ]`, and takes the one with the highest Q-value; `Φ = 0, n = 1` resembles BC, and large `Φ` and `n` approach Q-learning ✅[^2]. Constraining only the support (which actions are allowed) rather than the whole action distribution can be enough and still permits the optimal policy, whereas in Kumar's one-dimensional lineworld example matching the distribution forces a highly suboptimal one ✅[^1].
3. **Conservative values (CQL):** learn a Q-function whose expected value under the policy lower-bounds the policy's true value ✅[^3]. The CQL(H) variant, which uses a uniform prior over actions, adds a penalty to the usual Bellman error: `min_Q α·E_s[ log Σ_a exp Q(s,a) − E_{a∼π̂_β} Q(s,a) ] + ½·E[(Q − B̂Q̂)²]`, where `α` is the penalty weight, `π̂_β` the dataset's empirical action frequencies and `B̂Q̂` the usual one-sample Bellman target ✅[^3]. The log-sum-exp term is a soft maximum over all actions and pushes the highest values down; the second term pushes the dataset's actions up ✅[^3]. Example: for `Q(s,·) = (−1, −2, 0, −3)` with the third action unseen, `log Σ exp = log(0.368 + 0.135 + 1 + 0.050) = log 1.553 = 0.440`; its gradient on each action is that action's softmax weight, `1/1.553 = 0.644` for the unseen one, so gradient descent lowers it by `α·0.644` per unit step and it gets no Bellman term to pull it back. The paper's guarantee for this kind of objective bounds the policy's expected value, not each Q-value: Q-values of actions that are frequent in the data may be overestimated ✅[^3]. The bound holds with probability at least `1 − δ` (`δ` a small failure probability) when `α` exceeds a threshold set by sampling error, which shrinks as each state's data count grows; with exact Bellman backups any `α > 0` suffices ✅[^3]. Two further conditions: for evaluating a fixed policy, the push-down distribution must be that policy; for the full learning algorithm, the policy must change slowly relative to the softmax of `Q` ✅[^3]. The practical algorithm is under 20 lines of code on top of SAC (soft actor-critic) or QR-DQN (quantile-regression DQN), and it outperformed prior offline methods by as much as 2–5 times on many benchmark tasks ✅[^3].
4. **In-sample learning (IQL):** never evaluates an action outside the dataset ✅[^4]. It fits `V(s)` to an upper expectile of `Q(s,a)` over the dataset's actions with the asymmetric loss `L₂^τ(u) = |τ − 1(u < 0)|·u²` (`u` the residual `Q − V`, `1(·)` is 1 when its condition holds): with `τ = 0.9` a residual of `+1` costs `0.9` and one of `−1` costs `0.1`, so `V` is pulled toward the better actions and approaches the best in-data value as `τ → 1` ✅[^4]. It then fits `Q(s,a)` to `r + γ·V(s')` and extracts a policy by advantage-weighted behaviour cloning, weighting each dataset action by `exp(β·(Q(s,a) − V(s)))`; small `β` behaves like BC, large `β` approaches the maximum of `Q` ✅[^4].
5. **Decision Transformer:** treats RL as conditional sequence modelling: a causally masked transformer reads the last `K` timesteps as `3K` tokens of return-to-go, state and action, and predicts the action ✅[^5]. The return-to-go is `R̂_t = Σ_{t'≥t} r_{t'}`, the sum of the remaining rewards: for rewards `−1, −1, −1` it is `−3, −2, −1` ✅[^5]. At test time the desired return is a prompt that selects the skill ✅[^5]. It matched or exceeded state-of-the-art model-free offline RL baselines on Atari, OpenAI Gym and Key-to-Door ✅[^5]; behaviour cloning on only the top `X %` of timesteps ranked by episode return, which needs online rollouts to choose `X`, matched or beat other offline RL methods when data were plentiful ✅[^5].
6. **Model-based offline RL:** two offline methods penalize the policy for visiting states where the learned model is likely to be wrong ✅[^1]; the model-exploitation problem they address is in `machine-learning/reinforcement-learning/model-based-reinforcement-learning.md`.

### How offline RL is benchmarked: D4RL
- **Why a dedicated benchmark:** online RL benchmarks are not built for the offline setting, and earlier offline benchmarks used data from partially-trained agents ✅[^6]. D4RL chooses tasks for properties of real data: narrow and biased distributions, undirected and multitask data whose pieces must be stitched together, sparse rewards, suboptimal data, behaviour policies the learner cannot represent, and realistic domains ✅[^6].
- **Dataset quality:** for the Gym-MuJoCo tasks, `random` comes from a randomly initialized policy, `medium` from a SAC policy stopped early (1 million samples), `medium-replay` from the replay buffer up to that point, and `medium-expert` mixes equal amounts of expert and suboptimal data ✅[^6].
- **Normalized score** `= 100 · (score − random score) / (expert score − random score)`, so 0 is a uniform-random policy and 100 a domain-specific expert ✅[^6]. Applied to the lab grid, with the random data's return `−26.84` as the random score and the optimal `−8.00` as the expert score, BC on the medium data (`−19.44`) scores `100 · 7.40 / 18.84 = 39.3`.
- **Tuning:** hyperparameters tuned by online evaluation give over-optimistic expectations, so D4RL splits each domain into tasks for tuning and tasks for final evaluation ✅[^6].
- **Findings:** methods that keep the policy near the data, CQL and BCQ among them, handled biased and narrow data on Flow and Gym-MuJoCo well; undirected data (Maze2D, AntMaze, FrankaKitchen, CARLA) was challenging for existing methods, although the smaller Maze2D and AntMaze instances were within reach, and policy mixtures were challenging for every algorithm evaluated; with `medium-expert` data most algorithms did roughly as well as with `medium`, except on hopper ✅[^6].

## Worked example
A 5×5 grid: start `(4,0)`, goal `(0,4)`, lava at `(1,1)`, `(1,3)`, `(3,1)`, `(3,3)`; each step costs `−1`, lava costs `−20` and ends the episode, episodes stop after 30 steps, `γ = 0.95`. Three datasets of 1,000 transitions: **random** (uniform actions), **medium** (the optimal action with probability 0.4, otherwise a random action that does not enter lava) and **expert** (the same with probability 0.9). Each method sees only its dataset; "naive-Q" is Q-learning iterated on the table to convergence, "BCQ-style" is BCQL, "CQL" minimizes the CQL(H) loss by gradient steps, "IQL-style" uses an expectile `τ = 0.9` and advantage weights with `β = 10`. The three targets, side by side:

```python
nxt = Q[s2].max(1)                                         # naive-Q and CQL: max over ALL actions
nxt = np.where(seen[s2], Q[s2], -np.inf).max(1)            # BCQ-style: max over actions seen at s'
nxt = V[s2]                                                # IQL-style: expectile value, no max at all
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-25, numpy 2.5.5, two runs identical; lines 6–11 are the Mental model artifact ✅[^7]:

```text
== 5x5 grid, 4 lava cells, step -1, lava -20 (ends), time limit 30, gamma 0.95 ==
optimal policy: return -8.0 (8 steps), discounted value of the start -6.73
random data: 1000 transitions, behaviour return -26.84, state-action pairs seen 67/80, transitions into the goal 1
medium data: 1000 transitions, behaviour return -19.00, state-action pairs seen 61/80, transitions into the goal 46
expert data: 1000 transitions, behaviour return  -8.68, state-action pairs seen 33/80, transitions into the goal 116
== naive offline Q-learning on the medium data, cell (3,0); lava is to its right ==
action            up    down   right    left
in data          yes     yes      no     yes
naive Q        -1.95   -1.95    0.00   -1.00
true Q*        -6.03   -7.40  -20.00   -6.73
naive greedy path when executed: (4, 0) -> (3, 0) -> (3, 1)
== return of each policy when executed in the real grid (optimal -8.0) ==
data    behaviour      BC  naive-Q  BCQ-style  CQL(alpha=1)  IQL-style
random   -26.84    -27.05    -25.00     -8.00     -8.00     -8.01
medium   -19.00    -19.44    -21.00     -8.00     -8.00     -8.00
expert    -8.68     -8.71    -30.00     -8.00     -8.00     -8.00
== value at the start each method believes vs discounted return it really gets (true optimum -6.73) ==
random naive-Q believes  -4.52, gets -20.00  |  CQL believes -12.86, gets  -6.73
medium naive-Q believes  -1.00, gets -20.00  |  CQL believes  -6.55, gets  -6.73
expert naive-Q believes   0.00, gets -15.71  |  CQL believes  -6.14, gets  -6.73
CQL start estimate at alpha 0.1 / 1 / 10: random -7.35 -12.86 -19.11 | medium -6.68 -6.55 -6.45 | expert -6.54 -6.14 -5.83
== CQL penalty weight alpha: return when executed (share of visited cells where CQL's greedy action
   is the data's most frequent action, in brackets) ==
data      alpha=0          alpha=0.1        alpha=1          alpha=10
random   -25.00 (0.10)    -8.00 (0.30)    -8.00 (0.35)   -30.00 (0.75)
medium   -21.00 (0.00)    -8.00 (1.00)    -8.00 (1.00)    -8.00 (1.00)
expert   -30.00 (0.00)    -8.00 (1.00)    -8.00 (1.00)    -8.00 (1.00)
== coverage: random data, 200 transitions, five seeds ==
seed 0: transitions into the goal in the data 1 -> BCQ-style  -8.00  CQL  -8.00
seed 1: transitions into the goal in the data 0 -> BCQ-style -30.00  CQL -30.00
seed 2: transitions into the goal in the data 0 -> BCQ-style -30.00  CQL -30.00
seed 3: transitions into the goal in the data 0 -> BCQ-style -30.00  CQL -30.00
seed 4: transitions into the goal in the data 0 -> BCQ-style -30.00  CQL -30.00
```

<details><summary>Full script (prints the output above)</summary>

```python
# Offline RL on a 5 x 5 gridworld with lava (numpy only): datasets from random / medium / expert
# behaviour policies; behaviour cloning (BC), naive offline Q-learning, a BCQ-style action constraint,
# a CQL-style conservative penalty and an IQL-style in-sample method, all on one fixed dataset each.
import numpy as np

N, START, GOAL = 5, (4, 0), (0, 4)
LAVA = {(1, 1), (1, 3), (3, 1), (3, 3)}
MOVES, NAMES = [(-1, 0), (1, 0), (0, 1), (0, -1)], ["up", "down", "right", "left"]
GAMMA, T_MAX = 0.95, 30
CELLS = [(r, c) for r in range(N) for c in range(N)]
ID = {s: i for i, s in enumerate(CELLS)}

def step(s, a):                                    # deterministic; bumping the edge = stay in place
    r, c = s[0] + MOVES[a][0], s[1] + MOVES[a][1]
    s2 = (r, c) if 0 <= r < N and 0 <= c < N else s
    if s2 in LAVA:
        return s2, -20.0, True                     # lava: -20 and the episode ends
    return s2, -1.0, s2 == GOAL                    # every other step costs -1

Qstar = np.zeros((N * N, 4))                       # true optimal Q by value iteration (for reference)
for _ in range(200):
    new = np.zeros_like(Qstar)
    for s in CELLS:
        if s in LAVA or s == GOAL:
            continue
        for a in range(4):
            s2, r, d = step(s, a)
            new[ID[s], a] = r + (0 if d else GAMMA * Qstar[ID[s2]].max())
    Qstar = new
OPT = {s: int(Qstar[ID[s]].argmax()) for s in CELLS}

def behaviour(kind, rng, s):                       # random: any action; medium / expert: the optimal
    if kind == "random":                           # action with prob 0.4 / 0.9, else a random action
        return int(rng.integers(4))                # that does NOT enter lava (a cautious operator)
    if rng.random() < {"medium": 0.4, "expert": 0.9}[kind]:
        return OPT[s]
    safe = [a for a in range(4) if step(s, a)[0] not in LAVA]
    return int(safe[rng.integers(len(safe))])

def collect(kind, n, seed):
    rng, data, rets = np.random.default_rng(seed), [], []
    while len(data) < n:
        s, ret = START, 0.0
        for _ in range(T_MAX):
            a = behaviour(kind, rng, s)
            s2, r, d = step(s, a)
            data.append((ID[s], a, r, ID[s2], float(d))); ret += r; s = s2
            if d:
                break
        rets.append(ret)
    s, a, r, s2, d = map(np.array, zip(*data))
    return (s, a, r, s2, d), np.mean(rets)

def rollout(policy, rng=None):                     # returns (sum of rewards, discounted return, path)
    s, ret, disc, path = START, 0.0, 0.0, [START]
    for t in range(T_MAX):
        s, r, d = step(s, policy(s, rng))
        ret, disc = ret + r, disc + GAMMA ** t * r
        path.append(s)
        if d:
            break
    return ret, disc, path

def fit(D, method, alpha=1.0, tau=0.9, iters=1000):
    s, a, r, s2, d = D
    cnt = np.zeros((N * N, 4)); np.add.at(cnt, (s, a), 1)
    seen = cnt > 0
    n_s = np.maximum(cnt.sum(1, keepdims=True), 1)
    Q, V = np.zeros((N * N, 4)), np.zeros(N * N)    # unseen pairs keep their initial value 0
    for _ in range(iters):
        if method in ("naive", "cql"):
            nxt = Q[s2].max(1)                     # max over ALL actions, seen or not
        elif method == "bcq":                      # max only over actions seen at s' (BCQL)
            nxt = np.where(seen[s2], Q[s2], -np.inf).max(1)
            nxt = np.where(np.isfinite(nxt), nxt, 0.0)
        else:                                      # iql: back up V(s'), never a max over Q
            nxt = V[s2]
        y = r + GAMMA * (1 - d) * nxt
        if method == "cql":                        # gradient steps on the CQL(H) loss for this target
            for _ in range(20):
                g = np.zeros_like(Q)
                np.add.at(g, (s, a), Q[s, a] - y)                  # Bellman error term
                soft = np.exp(Q[s] - Q[s].max(1, keepdims=True))
                np.add.at(g, s, alpha * soft / soft.sum(1, keepdims=True))   # push down: log-sum-exp
                np.add.at(g, (s, a), -alpha)                       # push up: actions in the data
                Q -= 0.5 / (1 + alpha) * g / n_s
        else:
            tot = np.zeros_like(Q); np.add.at(tot, (s, a), y)
            Q = np.where(seen, tot / np.maximum(cnt, 1), Q)       # tabular regression = mean target
        if method == "iql":                        # V(s) = upper expectile of Q(s, a) over data actions
            for _ in range(50):
                u = Q[s, a] - V[s]
                gv = np.zeros(N * N); np.add.at(gv, s, -2 * np.where(u < 0, 1 - tau, tau) * u)
                V -= 0.25 * gv / n_s[:, 0]
    return Q, V, cnt

def greedy(Q, mask=None):
    def pol(st, rng):
        q = Q[ID[st]].copy()
        if mask is not None and mask[ID[st]].any():
            q[~mask[ID[st]]] = -np.inf             # act only among actions seen in that state
        return int(q.argmax())
    return pol

def sampler(probs):                                # stochastic table policy; unseen state -> uniform
    def pol(st, rng):
        p = probs[ID[st]]
        return int(rng.choice(4, p=p / p.sum())) if p.sum() > 0 else int(rng.integers(4))
    return pol

def mean_return(pol, seed=5, n=1000):
    rng = np.random.default_rng(seed)
    return np.mean([rollout(pol, rng)[0] for _ in range(n)])

opt = rollout(lambda st, rng: OPT[st])
print("== 5x5 grid, 4 lava cells, step -1, lava -20 (ends), time limit 30, gamma 0.95 ==")
print(f"optimal policy: return {opt[0]} ({len(opt[2]) - 1} steps), discounted value of the start {Qstar[ID[START]].max():.2f}")
results, data, behs = {}, {}, {}
live = [ID[c] for c in CELLS if c not in LAVA and c != GOAL]      # the 20 non-terminal cells
for kind in ("random", "medium", "expert"):
    D, beh = collect(kind, 1000, 0)
    data[kind], behs[kind] = D, beh
    cnt = np.zeros((N * N, 4)); np.add.at(cnt, (D[0], D[1]), 1)
    print(f"{kind:6s} data: 1000 transitions, behaviour return {beh:6.2f}, "
          f"state-action pairs seen {int((cnt[live] > 0).sum())}/80, transitions into the goal {int((D[3] == ID[GOAL]).sum())}")

print("== naive offline Q-learning on the medium data, cell (3,0); lava is to its right ==")
D = data["medium"]
Qn, _, cnt = fit(D, "naive")
print("action      " + "".join(f"{n:>8s}" for n in NAMES))
print("in data     " + "".join(f"{('yes' if c > 0 else 'no'):>8s}" for c in cnt[ID[(3, 0)]]))
print("naive Q     " + "".join(f"{q:8.2f}" for q in Qn[ID[(3, 0)]]))
print("true Q*     " + "".join(f"{q:8.2f}" for q in Qstar[ID[(3, 0)]]))
print("naive greedy path when executed:", " -> ".join(map(str, rollout(greedy(Qn))[2])))

print("== return of each policy when executed in the real grid (optimal -8.0) ==")
print("data    behaviour      BC  naive-Q  BCQ-style  CQL(alpha=1)  IQL-style")
for kind in ("random", "medium", "expert"):
    D = data[kind]
    Qn, _, cnt = fit(D, "naive")
    Qb, _, _ = fit(D, "bcq")
    Qc, _, _ = fit(D, "cql")
    Qi, Vi, _ = fit(D, "iql")
    awr = cnt * np.exp(np.clip(10.0 * (Qi - Vi[:, None]), -50, 50))   # advantage-weighted BC, beta 10
    row = (behs[kind], mean_return(sampler(cnt)), rollout(greedy(Qn))[0], rollout(greedy(Qb, cnt > 0))[0],
           rollout(greedy(Qc))[0], mean_return(sampler(awr)))
    results[kind] = (Qn, Qc)
    print(f"{kind:6s} " + "  ".join(f"{v:8.2f}" for v in row))

print("== value at the start each method believes vs discounted return it really gets (true optimum -6.73) ==")
for kind in ("random", "medium", "expert"):
    Qn, Qc = results[kind]
    print(f"{kind:6s} naive-Q believes {Qn[ID[START]].max():6.2f}, gets {rollout(greedy(Qn))[1]:6.2f}"
          f"  |  CQL believes {Qc[ID[START]].max():6.2f}, gets {rollout(greedy(Qc))[1]:6.2f}")
print("CQL start estimate at alpha 0.1 / 1 / 10: " + " | ".join(
    kind + " " + " ".join(f"{fit(data[kind], 'cql', alpha=al)[0][ID[START]].max():.2f}" for al in (0.1, 1, 10))
    for kind in ("random", "medium", "expert")))

print("== CQL penalty weight alpha: return when executed (share of visited cells where CQL's greedy action")
print("   is the data's most frequent action, in brackets) ==")
print(("data    " + "".join(f"  alpha={al:<9g}" for al in (0, 0.1, 1, 10))).rstrip())
for kind in ("random", "medium", "expert"):
    cells = []
    for al in (0, 0.1, 1, 10):
        Qc, _, cnt = fit(data[kind], "cql", alpha=al)
        vis = cnt.sum(1) > 0
        agree = (Qc.argmax(1) == cnt.argmax(1))[vis].mean()
        cells.append(f"{rollout(greedy(Qc))[0]:7.2f} ({agree:.2f})")
    print(f"{kind:6s}  " + "  ".join(cells))
print("== coverage: random data, 200 transitions, five seeds ==")
for seed in range(5):
    D, beh = collect("random", 200, seed)
    Qb, _, cnt = fit(D, "bcq")
    print(f"seed {seed}: transitions into the goal in the data {int((D[3] == ID[GOAL]).sum())} -> "
          f"BCQ-style {rollout(greedy(Qb, cnt > 0))[0]:6.2f}  CQL {rollout(greedy(fit(D, 'cql')[0]))[0]:6.2f}")
```

</details>

Reading it, line by line:
- **Datasets:** the expert data cover only 33 of the 80 state-action pairs (20 non-terminal cells × 4 actions), the random data 67; the cautious medium and expert operators never enter lava, so those actions are absent from their data.
- **Naive-Q fails on every dataset,** worst on the best data: with the expert's narrow coverage it believes the start is worth `0.00`, picks an action the expert never took and times out after 30 steps without reaching the goal (`−30.00`, discounted `−15.71`). On the medium data it believes `−1.00` and gets `−20.00`: one step, then lava (`−1 + 0.95 · (−20) = −20.00`). Even the random data leave 13 pairs unseen, enough to send it into lava.
- **BC copies the data:** `−27.05`, `−19.44` and `−8.71` against behaviour returns of `−26.84`, `−19.00` and `−8.68`. With expert data it is within 0.71 of the optimum; with random data it is as bad as random.
- **BCQ-style and CQL reach the optimum `−8.00` from all three datasets, IQL-style `−8.00` or `−8.01`** (its policy samples actions, and each figure is a mean over 1,000 rollouts), including from the random data, which reach the goal exactly once: in a deterministic grid one goal transition plus the transitions that lead to its cell are enough to stitch the optimal path together.
- **What each method believes:** naive-Q's start values (`−4.52`, `−1.00`, `0.00`) are all above the true `−6.73`, and its real returns far below them. CQL's are below the truth on the random data (`−12.86`, too pessimistic) and slightly above it on the medium and expert data (`−6.55`, `−6.14`), while its policy gets the optimal `−6.73` on all three. A larger `α` does not fix this: on the medium and expert data the start estimate rises with `α` (`−6.68`, `−6.55`, `−6.45` and `−6.54`, `−6.14`, `−5.83` at `α = 0.1, 1, 10`), while on the random data it falls. The run is outside the paper's guarantee for a different reason. The grid is deterministic, so there is no sampling error for `α` to outweigh, but the printed value is the maximum over actions (the greedy policy) while CQL(H) pushes down the softmax over actions. Setting the script's CQL gradient to zero gives, for each state-action pair in the data, `Q(s,a) = y(s,a) + α·(1 − w(a|s)/π̂_β(a|s))`, where `y` is the Bellman target and `w(a|s)` the action's softmax weight. So an action that appears in the data more often than its softmax weight sits above its own target, the overestimation of in-data actions the paper warns about ✅[^3].
- **The penalty weight:** `α = 0` is naive-Q. On random data, `α = 10` fails (`−30.00`) and its greedy action matches the data's most frequent action in 75 % of visited cells, against 35 % at `α = 1`: a heavy penalty turns the policy toward copying the data's commonest action, harmless when that action is good (medium, expert) and fatal when the data are random.
- **Coverage:** with 200 random transitions, four of five seeds never reach the goal, and both methods tested on them, BCQ-style and CQL, then fail; the one seed whose data reach it once recovers the optimum.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Data never reach the goal or high-reward region | Finding it may be impossible (lab: BCQ-style and CQL scored `−30.00` on the 4 of 5 small random datasets with no goal transition) | Exploration is outside an offline algorithm's reach ✅[^1]; lab ✅[^7] |
| Expert data with narrow coverage | In the lab, naive Q-learning did worst on it (`−30.00` with 33/80 pairs) and BC was near-optimal | Narrow, biased distributions can make offline RL diverge ✅[^6]; lab ✅[^7] |
| Undirected data containing pieces of good paths | Value-based methods can stitch them (lab: one goal transition sufficed) | Stitching, a D4RL property ✅[^6]; lab ✅[^7] |
| Training longer | Return rises, then falls; more data does not help | The "unlearning" effect: targets grow more erroneous ✅[^1] |
| CQL weight `α` too large | In the lab, the policy moved toward the data's commonest action (random data: 75 % agreement and `−30.00` at `α = 10`, against 35 % and `−8.00` at `α = 1`) | CQL's policy maximizes the return in the data's empirical MDP minus a penalty, scaled by `α`, for differing from the data's action frequencies ✅[^3]; lab ✅[^7] |
| Behaviour policy is a mixture of very different behaviours | A policy constraint built on a unimodal fit of `π_β` may still allow out-of-distribution actions | Averaging across modes misplaces the support ✅[^1]; mixtures were hard for every method in D4RL ✅[^6] |
| Constraint on the action distribution instead of its support | Can force a highly suboptimal policy | Density matching copies the data's preferences; a support constraint does not ✅[^1] |
| Small deviation from the data at each step | Errors compound with a factor of about `1/(1−γ)² ≈ H²`, so constraints must be strong, which limits improvement | Error accumulation over the horizon ✅[^1] |
| Uncertainty estimates instead of constraints | So far they seem to be outperformed in practice by constraint and conservative methods | Offline use needs uncertainty that captures trustworthiness, a higher bar than exploration's ✅[^1] |
| Hyperparameters tuned with online rollouts | Results look better than a truly offline deployment would get | Online evaluation leaks into model selection ✅[^6] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Behaviour cloning | Plain supervised learning; near-optimal on expert data (lab `−8.71`) ✅[^7] | Cannot beat the data; fails on suboptimal trajectories ✅[^2] |
| Naive off-policy Q-learning | Uses every transition | Extrapolation error and overestimation ✅[^2]; worst method in the lab ✅[^7] |
| Policy constraint (BCQ) | Matches or beats the behaviour policy in the tabular deterministic case ✅[^2] | Needs a model of the behaviour policy, hard for multimodal data ✅[^1] |
| Conservative values (CQL) | No behaviour model; under 20 lines on top of SAC or QR-DQN ✅[^3] | `α` to tune (lab: `α = 10` failed on random data) ✅[^7] |
| In-sample (IQL) | Never queries unseen actions; one extra critic with an asymmetric squared-error loss ✅[^4] | Two more knobs, `τ` and `β` ✅[^4] |
| Decision Transformer | No dynamic programming; the target return selects the behaviour ✅[^5] | With plentiful data, cloning the top trajectories can match it ✅[^5] |

## Takeaways
- Never trust a Q-value for an action the dataset does not contain; restrict, penalize or avoid such actions. [rule-candidate]
- Report the dataset's own return, or the normalized score, next to every offline result: improving on the data is the point. [rule-candidate]
- Try behaviour cloning first: it is the baseline offline RL must clear, and in the lab it came within 0.71 of the optimum on expert data.
- Check what the data cover before training: an offline method may be unable to reach a region the data never visit.
- Select hyperparameters without online rollouts, or say that you used them.

## Verification status
- Verified: 74 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [Offline Reinforcement Learning: Tutorial, Review, and Perspectives on Open Problems](https://ar5iv.labs.arxiv.org/html/2005.01643) — Levine, Kumar, Tucker, Fu, 2020 (ar5iv HTML of arXiv:2005.01643). Backs: the problem setting, no exploration, counterfactual queries and the i.i.d. assumption, distribution shift from states and from maximization, action shift in the Bellman target, out-of-distribution actions chosen by the policy, uncorrected errors, the unlearning effect, quadratic vs linear error of cloning, support vs distribution constraints, multimodal behaviour policies, `1/(1−γ)²` error accumulation, uncertainty-based methods, model-based offline penalties. [^1]
- [Off-Policy Deep Reinforcement Learning without Exploration](https://ar5iv.labs.arxiv.org/html/1812.02900) — Fujimoto, Meger, Precup, 2019 (ar5iv HTML of arXiv:1812.02900). Backs: off-policy agents worse than the behavioural agent, extrapolation error and its three sources, overestimation with maximization, imitation failing on suboptimal data, batch-constrained policies, BCQL and its guarantees, coherent batch, the VAE, perturbation, `Φ` and `n`. [^2]
- [Conservative Q-Learning for Offline Reinforcement Learning](https://ar5iv.labs.arxiv.org/html/2006.04779) — Kumar, Zhou, Tucker, Levine, 2020 (ar5iv HTML of arXiv:2006.04779). Backs: lower-bound goal, the CQL(H) objective and its terms, the conditions of the bounds (expected value not pointwise, overestimated in-data actions, probability `1 − δ`, the sampling-error threshold on `α`, any `α > 0` with exact backups, push-down distribution equal to the policy, slowly changing policy), the policy objective's penalty for differing from the data, under 20 lines on SAC and QR-DQN, as much as 2–5 times better than prior methods. [^3]
- [Offline Reinforcement Learning with Implicit Q-Learning](https://ar5iv.labs.arxiv.org/html/2110.06169) — Kostrikov, Nair, Levine, 2021 (ar5iv HTML of arXiv:2110.06169). Backs: costly or dangerous exploration, never evaluating unseen actions, expectile loss and `τ`, the `V` and `Q` losses, advantage-weighted extraction and `β`, one extra critic. [^4]
- [Decision Transformer: Reinforcement Learning via Sequence Modeling](https://ar5iv.labs.arxiv.org/html/2106.01345) — Chen et al., 2021 (ar5iv HTML of arXiv:2106.01345). Backs: causally masked transformer, return-to-go, `3K` tokens, return as prompt, results on Atari, Gym and Key-to-Door, percentile behaviour cloning. [^5]
- [D4RL: Datasets for Deep Data-Driven Reinforcement Learning](https://ar5iv.labs.arxiv.org/html/2004.07219) — Fu, Kumar, Nachum, Tucker, Levine, 2020 (ar5iv HTML of arXiv:2004.07219). Backs: why a dedicated benchmark, dataset properties and stitching, random/medium/medium-replay/medium-expert, normalized score, tuning vs evaluation tasks, the findings. [^6]
- `machine-learning/lab-setup.md` — the lab where the gridworld offline-RL comparison ran on 2026-11-25. [^7]

## Related
- `machine-learning/reinforcement-learning/temporal-difference-and-q-learning.md` — the Q-learning target whose `max` causes the trouble offline.
- `machine-learning/reinforcement-learning/deep-q-networks.md` — overestimation from the `max`, and replay buffers that are offline datasets in all but name.
- `machine-learning/reinforcement-learning/model-based-reinforcement-learning.md` — model exploitation, the model-based face of the same distribution shift.
- `machine-learning/ml-systems/data-drift-and-monitoring.md` — distribution shift for supervised models.
- `machine-learning/generative-models/variational-autoencoders.md` — the conditional VAE that BCQ uses to propose in-data actions.
- `machine-learning/transformers/attention-and-the-transformer.md` — the causally masked transformer behind Decision Transformer.
