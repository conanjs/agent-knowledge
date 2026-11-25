---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/reinforcement-learning
status: verified
applies-to: ["any"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, reinforcement-learning, model-based, dyna, dyna-q, planning, model-predictive-control, random-shooting, compounding-error, mbpo, pets, world-models, muzero, dreamer]
---

# Model-based reinforcement learning: Dyna, planning with a learned model, and compounding model error

## Summary
**TL;DR:** A model-based agent learns a model of its environment, a function that predicts the next state and reward from a state and an action, and uses it to plan or to generate simulated experience, so that it needs fewer real interactions. Dyna-Q does both kinds of learning at every real step: it updates its Q-values from the real transition, stores that transition in the model, then replays `n` stored transitions as extra Q-learning updates; in the lab, `n = 50` found the optimal 14-step path of a 47-state maze after 13.3 episodes on average, against 42.5 for plain Q-learning. Decision-time planning uses the model when acting: MPC (model-predictive control) optimizes a short action sequence inside the model, executes only its first action and plans again; MuZero runs a tree search inside a learned latent model. The price is model error: a model fed its own predictions accumulates error with the rollout length, and an agent optimizing against the model drifts to where the model is wrong, which is why MBPO (model-based policy optimization) uses short model rollouts that start from real states.
**Use this when:** real interactions are expensive and you consider learning a dynamics model; you tune Dyna's planning steps, an MPC horizon or a model-rollout length; or a policy that looks good inside its model fails in the real environment.
**Not this doc:** planning with known transition probabilities (value iteration) → `machine-learning/reinforcement-learning/markov-decision-processes.md`; the Q-learning update itself → `machine-learning/reinforcement-learning/temporal-difference-and-q-learning.md`; learning from a fixed dataset with no interaction at all → `machine-learning/reinforcement-learning/offline-reinforcement-learning.md`.

## Problem
Model-free reinforcement learning (RL) improves a policy only from real experience, so it pays for every lesson with a real interaction. In the lab, plain Q-learning on a 47-state maze needed 983 steps in its first episode and 42.5 episodes on average before its greedy path was the 14-step optimum ✅[^11]. For real-world physical systems data collection can be arduous, and that is where model-based methods appeal, for their comparatively fast learning ✅[^6]. A learned model brings its own failure: an agent can exploit the model's bias and do well inside the model while behaving sub-optimally, or very badly, in the real environment ✅[^1], and model accuracy is a bottleneck that often leaves model-based methods behind model-free ones in final (asymptotic) performance ✅[^6] ✅[^7].

## Mental model
**Analogy:** a flight simulator. Each real flight gives the simulator's builders a little more data about how the plane behaves (model learning); between flights the trainee can practise for free in the simulator (planning). The more simulator hours per real flight, the faster the trainee improves, as long as the simulator is right. Where the simulator is wrong, for example about how the plane stalls at speeds no real flight has reached yet, a trainee who optimizes for the simulator learns a manoeuvre that would crash the real plane.

**Artifact:** Dyna-Q on the 47-state Dyna maze, `n` simulated updates per real step, mean of 30 runs; printed by the full script in the Worked example; lab run (`machine-learning/lab-setup.md`), 2026-11-25, numpy 2.5.5 ✅[^11]:

```text
== (1) Dyna-Q on the 47-state Dyna maze, shortest path 14 steps, mean of 30 runs ==
 n | steps per episode: ep 1 | ep 2 | ep 3 | ep 5 | ep 10 | ep 50 | greedy path = 14 steps from episode
 0 |                    983 |  861 |  494 |  228 | 119.5 |  17.5 |  42.5
 5 |                    983 |  148 |   76 |   23 |  16.7 |  16.2 |  20.2
50 |                    983 |   39 |   17 |   17 |  16.4 |  16.6 |  13.3
```

The first episode is the same for every `n` (nothing is known until the goal is first reached); after it, 50 replayed updates per step cut the second episode from 861 steps to 39.

## How it works
### What a model is and how it is learned
- **A model** is anything the agent can use to predict how the environment responds to an action: given a state and an action it predicts the next state and reward ✅[^2]. A **distribution model** gives every possible next state with its probability; a **sample model** draws one; Sutton and Barto note that in many applications sample models are much easier to obtain ✅[^2].
- **Learning the model is supervised learning.** MBPO fits `p_θ(s', r | s, a)` (the probability of next state `s'` and reward `r` given state `s` and action `a`, with network weights `θ`) by maximum likelihood on the collected transitions ✅[^6]. PETS (probabilistic ensembles with trajectory sampling) separates two kinds of uncertainty: a network that outputs a Gaussian mean and variance captures **aleatoric** uncertainty (noise inherent in the system), and an ensemble of such networks trained on bootstrap resamples of the data captures **epistemic** uncertainty (uncertainty from too little data); it used 5 networks ✅[^7]. Ensembles and uncertainty are explained in `machine-learning/deep-learning/uncertainty-in-deep-learning.md`.
- **Planning** is any computation that takes a model and produces or improves a policy; it uses simulated experience where learning uses real experience, so in many cases the same update rule can do both ✅[^2]. Spinning Up gives four examples of using a model, and calls its list far from exhaustive: pure planning (MPC), expert iteration (a tree search proposes better actions and the policy learns to imitate them, as in AlphaZero), extra or purely imagined training data for a model-free learner, and a planning loop embedded inside the policy ✅[^1].

### Dyna-Q: learning and planning from the same update
**4 actors:**
- **Environment** — its job: return the real next state and reward, via `step(s, a)`.
- **Q-table (direct RL)** — its job: improve the action values from real experience, via one Q-learning update.
- **Model** — its job: remember what each tried action did, via a table `(s, a) → (r, s')`.
- **Planner** — its job: generate simulated experience, via replaying `n` randomly chosen remembered pairs through the same Q-learning update.

Diagram of one Dyna-Q time step (drawn by hand, not program output):

```
 real step:  Environment --(s, a, r, s')--> Q-table update (direct RL)
                     \--------------------> Model[(s, a)] = (r, s')       (model learning)
 then n times:  Planner picks a seen (s, a) at random -> Model -> (r, s') -> Q-table update (planning)
```

1. **Acting:** the agent picks `a` ε-greedily (random with probability ε) from its Q-values and the environment returns `(r, s')`.
2. **Direct RL:** one Q-learning update `Q(s,a) ← Q(s,a) + α·[r + γ·max_a' Q(s',a') − Q(s,a)]` (`α` the step size, `γ` the discount; full explanation in the temporal-difference doc). Example with `α = 0.1`, `γ = 0.95`: the first step into the goal (`r = 1`, terminal) moves `Q` from 0 to `0.1`.
3. **Model learning:** Dyna-Q's table model assumes a deterministic world and simply records the last observed `(r, s')` for `(s, a)` ✅[^3].
4. **Planning:** `n` times, pick a previously experienced pair at random, so the model is never asked about a pair it knows nothing about, look up its `(r, s')` and apply the same update ✅[^3]. Without the model-learning and planning steps the algorithm is plain one-step Q-learning ✅[^3].

Why it helps: without planning, each episode extends the learned path back from the goal by only one step; with planning, the value of the goal is propagated backward through the remembered transitions while the agent is still wandering near the start ✅[^3]. Real experience is used twice, directly and through the model; Sutton and Barto note that indirect (model-based) methods often make fuller use of limited experience, while direct methods are simpler and unaffected by biases in the model ✅[^3]. Which pairs the planner replays is a choice of its own (search control) ✅[^3]: uniform choice wastes most early updates on transitions between zero-valued states, and prioritized sweeping, which backs up first the pairs whose values would change most, often found optimal maze solutions 5 to 10 times faster ✅[^5].

### Planning at decision time: MPC and tree search
1. **MPC:** each time the agent observes the state, it computes the plan that is best according to the model over a fixed window of future steps, executes the first action and discards the rest, then plans again at the next step ✅[^1]. A learned value function can account for rewards beyond the window ✅[^1].
2. **Random shooting:** a simple way to find that plan: sample many random action sequences, score each by its predicted reward in the model, keep the best ✅[^7]. PETS replaced it with CEM (the cross-entropy method), which samples new sequences near the previous good ones ✅[^7]. In the lab, 500 random sequences of 15 steps, planned with a learned point-mass model, reached the target nearly as well as planning with the true equations (final distance 0.019 against 0.014, Worked example) ✅[^11].
3. **Tree search in a learned latent model (MuZero):** a representation function `h` encodes past observations into a hidden state, a dynamics function `g` maps a hidden state and a candidate action to a reward and the next hidden state, and a prediction function `f` outputs a policy and a value from a hidden state; MCTS (Monte Carlo tree search) runs over these hidden states ✅[^9]. The model is trained only to predict the reward, the search policy and the value; the hidden state need not reconstruct the observation or match the true state ✅[^9]. Without being given the rules, MuZero matched AlphaZero in Go, chess and shogi and set a new state of the art on 57 Atari games ✅[^9].

### Model error: compounding, exploitation, short rollouts
1. **Compounding:** a multi-step prediction feeds each predicted state back into the model, so one step's error becomes the next step's input error. In the lab, the one-step error stayed at `0.00043` while the 20-step open-loop error grew to `0.00412`, about 10 times larger ✅[^11].
2. **Exploitation:** a policy or planner that maximizes predicted return can be drawn to the states and actions where the model's bias errs in its favour ✅[^1]. World Models' controller, trained entirely inside its learned model, found an adversarial policy that looked good in the model and failed in the real game, usually by visiting states away from the training data ✅[^8].
3. **The bound (MBPO):** if the model's expected one-step error on the states the data-collecting policy visits is at most `ε_m` at every time step, measured as total variation distance (the largest gap between the probabilities two distributions give the same event: 0 when they agree, 1 when they never overlap), and the new policy differs from the data-collecting one by at most `ε_π`, the true return `η[π]` is at least the model return `η̂[π]` minus `C = 2γ·r_max·(ε_m + 2ε_π)/(1−γ)² + 4·r_max·ε_π/(1−γ)`, where `r_max` is the largest reward ✅[^6]. Example: `γ = 0.99`, `r_max = 1`, `ε_m = 0.01`, `ε_π = 0` gives `C = 0.0198 / 0.0001 = 198`, more than the largest possible return of 100, so the guarantee says nothing; the authors call this analysis overly pessimistic and attribute the `1/(1−γ)²` factor to errors compounding over full rollouts ✅[^6].
4. **Branched short rollouts:** MBPO starts `k`-step model rollouts from states sampled from the real replay buffer instead of from the start of an episode, which decouples the model horizon from the task horizon; Dyna is the special case `k = 1` ✅[^6]. In the bound the paper proves for branched rollouts, the model-error term grows in proportion to `k`; taken literally that bound is best at `k = 0`, no model at all ✅[^6]. The case for short rollouts rests on a measurement: model error grew with the policy's distance from the data-collecting policy, but more slowly when the model had more data, and a bound that uses the measured error has its optimum at some `k > 0` when that error is low enough ✅[^6]. In practice MBPO used a bootstrap ensemble of probabilistic networks, 20 to 40 policy updates per real step, and matched at 300 thousand steps on the Ant task what SAC (soft actor-critic), a model-free method, reached at 3 million ✅[^6]. On the Hopper task, fixing `k = 1` kept much of the benefit; 200-step rollouts were worse and 500-step rollouts too inaccurate to learn from ✅[^6].

### World models in outline
- **World Models (Ha and Schmidhuber):** V, a VAE (variational autoencoder), compresses each frame into a small latent vector `z`; M, an MDN-RNN (a recurrent network with a mixture-density output), predicts the distribution of the next `z` from the current `z`, the action and its hidden state; C, a single linear layer with 867 parameters in the car-racing task, maps `z` and the hidden state to an action and is trained with CMA-ES (covariance-matrix adaptation evolution strategy) ✅[^8]. The agent can be trained entirely inside the "dream" that M generates ✅[^8]. Raising M's sampling temperature `τ` made the dream harder to exploit: in the VizDoom Take Cover task, trained at `τ = 0.10`, the agent scored 2086 in the dream but 193 in the real game, below a random policy's 210; at `τ = 1.15` it scored 1092 in the real game ✅[^8].
- **Dreamer:** learns a latent dynamics model (representation, transition and reward models) and trains an actor and a critic purely on trajectories imagined in that latent space, propagating analytic gradients of the predicted values back through the learned dynamics; predicting values addresses the short-sightedness of a fixed imagination horizon, and it was evaluated on 20 visual control tasks ✅[^10].

## Worked example
Three experiments in one script, all deterministic: (1) the Dyna-Q maze above; (2) a two-hidden-layer MLP (multilayer perceptron) learns the one-step dynamics of a 2-D point mass with drag, `v' = v + Δt·(a − 0.5·v·|v|)` and `p' = p + Δt·v'` (`p` position, `v` velocity, `a` force in `[−1, 1]` per axis, `Δt = 0.1`; for `v = 1`, `a = 1`: `v' = 1 + 0.1·(1 − 0.5) = 1.05`), from 10,000 random-action transitions; (3) MPC with random shooting drives the point mass from `(−1.5, −1.0)` to the target `(1.5, 1.0)`, with the reward `−distance − 0.01·|a|²` per step. The core of the planner:

```python
seqs = r.uniform(-1, 1, (n_seq, horizon, 2))   # 500 candidate action sequences of 15 steps
for k in range(horizon):                        # imagined rollouts in the model
    sim = predict(sim, seqs[:, k]); total += reward(sim, seqs[:, k])
a = seqs[total.argmax(), 0]                     # execute only the first action, then replan
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-25, numpy 2.5.5, PyTorch 2.15.0, two runs identical; lines 1–5 are the Mental model artifact ✅[^11]:

```text
== (1) Dyna-Q on the 47-state Dyna maze, shortest path 14 steps, mean of 30 runs ==
 n | steps per episode: ep 1 | ep 2 | ep 3 | ep 5 | ep 10 | ep 50 | greedy path = 14 steps from episode
 0 |                    983 |  861 |  494 |  228 | 119.5 |  17.5 |  42.5
 5 |                    983 |  148 |   76 |   23 |  16.7 |  16.2 |  20.2
50 |                    983 |   39 |   17 |   17 |  16.4 |  16.6 |  13.3
== (2) learned point-mass model, trained on 10,000 transitions with |v| <= 0.92: one-step error by speed ==
|v| in [0.0, 0.5]: mean one-step state error 0.00043
|v| in [0.5, 1.0]: mean one-step state error 0.00585
|v| in [1.5, 2.0]: mean one-step state error 0.12435
|v| in [2.5, 3.0]: mean one-step state error 0.42249
== (2b) open-loop rollout: the model is fed its own predictions (500 start states, |v| <= 0.5) ==
h= 1  one-step error from the true state 0.00043  |  h-step rollout error 0.00043
h= 5  one-step error from the true state 0.00042  |  h-step rollout error 0.00135
h=10  one-step error from the true state 0.00044  |  h-step rollout error 0.00230
h=20  one-step error from the true state 0.00042  |  h-step rollout error 0.00412
== (3) MPC random shooting (500 sequences x 15 steps), 60 real steps, 5 seeds ==
true model   : mean return  -82.73  final distance to target 0.014  top speed reached 1.20
learned model: mean return  -82.91  final distance to target 0.019  top speed reached 1.15
random actions: return -172.88  final distance to target 2.054
```

<details><summary>Full script (prints the output above)</summary>

```python
# Model-based RL in three small experiments (numpy + PyTorch, CPU):
# (1) Dyna-Q with n = 0, 5, 50 planning steps per real step on Sutton & Barto's Dyna maze;
# (2) a learned one-step dynamics model of a 2-D point mass, rolled out open-loop: error vs horizon;
# (3) model-predictive control (MPC) by random shooting, planning with the true vs the learned model.
import numpy as np
import torch
from torch import nn

# ---------- (1) Dyna-Q on the Dyna maze: 6 x 9 grid, 7 walls, 47 free cells ----------
ROWS, COLS, START, GOAL = 6, 9, (2, 0), (0, 8)
WALLS = {(1, 2), (2, 2), (3, 2), (4, 5), (0, 7), (1, 7), (2, 7)}
MOVES = [(-1, 0), (1, 0), (0, 1), (0, -1)]               # up, down, right, left

def step(s, a):
    r, c = s[0] + MOVES[a][0], s[1] + MOVES[a][1]
    if not (0 <= r < ROWS and 0 <= c < COLS) or (r, c) in WALLS:
        r, c = s                                         # blocked: stay in place
    return (r, c), (1.0 if (r, c) == GOAL else 0.0), (r, c) == GOAL

def greedy(Q, s, rng):                                   # argmax with random tie-breaking
    q = Q[s]
    return int(rng.choice(np.flatnonzero(q == q.max())))

def greedy_path_len(Q):                                  # steps the greedy policy needs (cap 100)
    s, rng = START, np.random.default_rng(0)
    for t in range(1, 101):
        s, _, done = step(s, greedy(Q, s, rng))
        if done:
            return t
    return 100

def dyna_q(n_plan, seed, episodes=50, alpha=0.1, gamma=0.95, eps=0.1):
    act_rng, plan_rng = np.random.default_rng(seed), np.random.default_rng(seed + 1000)
    Q = np.zeros((ROWS, COLS, 4))
    model = {}                                           # (s, a) -> (r, s'): deterministic table model
    lengths, solved_at = [], None
    for ep in range(1, episodes + 1):
        s, t, done = START, 0, False
        while not done:
            a = int(act_rng.integers(4)) if act_rng.random() < eps else greedy(Q, s, act_rng)
            s2, r, done = step(s, a)
            Q[s][a] += alpha * (r + gamma * (0 if done else Q[s2].max()) - Q[s][a])   # direct RL
            model[(s, a)] = (r, s2)                                                    # model learning
            keys = list(model)
            for _ in range(n_plan):                                                    # planning
                ps, pa = keys[plan_rng.integers(len(keys))]
                pr, ps2 = model[(ps, pa)]
                Q[ps][pa] += alpha * (pr + gamma * (0 if ps2 == GOAL else Q[ps2].max()) - Q[ps][pa])
            s, t = s2, t + 1
        lengths.append(t)
        if solved_at is None and greedy_path_len(Q) == 14:
            solved_at = ep
    return np.array(lengths), solved_at

print("== (1) Dyna-Q on the 47-state Dyna maze, shortest path 14 steps, mean of 30 runs ==")
print(" n | steps per episode: ep 1 | ep 2 | ep 3 | ep 5 | ep 10 | ep 50 | greedy path = 14 steps from episode")
for n in (0, 5, 50):
    runs = [dyna_q(n, seed) for seed in range(30)]
    L = np.mean([r[0] for r in runs], axis=0)
    solved = np.mean([r[1] if r[1] is not None else 51 for r in runs])
    print(f"{n:2d} | {L[0]:22.0f} | {L[1]:4.0f} | {L[2]:4.0f} | {L[4]:4.0f} | {L[9]:5.1f} | {L[49]:5.1f} | {solved:5.1f}")

# ---------- (2) a learned dynamics model of a 2-D point mass with quadratic drag ----------
DT = 0.1
def env_step(s, a):                                      # s = [x, y, vx, vy], a = force in [-1, 1]^2
    v = s[..., 2:] + DT * (a - 0.5 * s[..., 2:] * np.abs(s[..., 2:]))
    return np.concatenate([s[..., :2] + DT * v, v], axis=-1)

rng = np.random.default_rng(0)
S, A, S2 = [], [], []
for _ in range(200):                                     # 200 random-action episodes of 50 steps
    s = np.concatenate([rng.uniform(-2, 2, 2), np.zeros(2)])
    for _ in range(50):
        a = rng.uniform(-1, 1, 2)
        s2 = env_step(s, a)
        S.append(s); A.append(a); S2.append(s2); s = s2
S, A, S2 = map(np.array, (S, A, S2))

torch.manual_seed(0)
net = nn.Sequential(nn.Linear(6, 64), nn.Tanh(), nn.Linear(64, 64), nn.Tanh(), nn.Linear(64, 4))
X = torch.tensor(np.hstack([S, A]), dtype=torch.float32)
Y = torch.tensor((S2 - S) / DT, dtype=torch.float32)    # predict the scaled change of state
opt = torch.optim.Adam(net.parameters(), lr=3e-3)
for it in range(3000):                                   # full-batch regression, 10,000 transitions
    opt.zero_grad()
    loss = ((net(X) - Y) ** 2).mean()
    loss.backward(); opt.step()
def model_step(s, a):
    with torch.no_grad():
        x = torch.tensor(np.hstack([s, a]), dtype=torch.float32)
        return s + DT * net(x).numpy().astype(np.float64)

print(f"== (2) learned point-mass model, trained on 10,000 transitions with |v| <= {np.abs(S[:, 2:]).max():.2f}: one-step error by speed ==")
check = np.random.default_rng(3)
for lo, hi in ((0.0, 0.5), (0.5, 1.0), (1.5, 2.0), (2.5, 3.0)):
    s = np.concatenate([check.uniform(-2, 2, (1000, 2)),
                        check.choice([-1, 1], (1000, 2)) * check.uniform(lo, hi, (1000, 2))], axis=1)
    a = check.uniform(-1, 1, (1000, 2))
    print(f"|v| in [{lo}, {hi}]: mean one-step state error {np.linalg.norm(model_step(s, a) - env_step(s, a), axis=1).mean():.5f}")
print("== (2b) open-loop rollout: the model is fed its own predictions (500 start states, |v| <= 0.5) ==")
test_rng = np.random.default_rng(1)
s_true = np.concatenate([test_rng.uniform(-2, 2, (500, 2)), test_rng.uniform(-0.5, 0.5, (500, 2))], axis=1)
s_model = s_true.copy()
for h in range(1, 21):
    a = test_rng.uniform(-1, 1, (500, 2))
    one = np.linalg.norm(model_step(s_true, a) - env_step(s_true, a), axis=1).mean()  # from the TRUE state
    s_true, s_model = env_step(s_true, a), model_step(s_model, a)
    if h in (1, 5, 10, 20):
        print(f"h={h:2d}  one-step error from the true state {one:.5f}  |  "
              f"h-step rollout error {np.linalg.norm(s_model - s_true, axis=1).mean():.5f}")

# ---------- (3) MPC with random shooting: plan with a model, execute only the first action ----------
TARGET = np.array([1.5, 1.0])
def reward(s, a):
    return -np.linalg.norm(s[..., :2] - TARGET, axis=-1) - 0.01 * (a ** 2).sum(-1)

def mpc_episode(predict, seed, horizon=15, n_seq=500, steps=60):
    r = np.random.default_rng(seed)
    s, ret, vmax = np.array([-1.5, -1.0, 0.0, 0.0]), 0.0, 0.0
    for _ in range(steps):
        seqs = r.uniform(-1, 1, (n_seq, horizon, 2))   # candidate action sequences
        sim, total = np.repeat(s[None], n_seq, 0), np.zeros(n_seq)
        for k in range(horizon):                          # imagined rollouts in the model
            sim = predict(sim, seqs[:, k])
            total += reward(sim, seqs[:, k])
        a = seqs[total.argmax(), 0]                       # first action of the best sequence
        s = env_step(s, a)                                # the REAL environment moves
        ret, vmax = ret + reward(s, a), max(vmax, np.abs(s[2:]).max())
    return ret, np.linalg.norm(s[:2] - TARGET), vmax

print("== (3) MPC random shooting (500 sequences x 15 steps), 60 real steps, 5 seeds ==")
for name, predict in (("true model   ", env_step), ("learned model", model_step)):
    res = np.array([mpc_episode(predict, seed) for seed in range(5)])
    print(f"{name}: mean return {res[:, 0].mean():7.2f}  final distance to target {res[:, 1].mean():.3f}"
          f"  top speed reached {res[:, 2].max():.2f}")
rand = np.random.default_rng(9)
s, ret = np.array([-1.5, -1.0, 0.0, 0.0]), 0.0
for _ in range(60):
    a = rand.uniform(-1, 1, 2); s = env_step(s, a); ret += reward(s, a)
print(f"random actions: return {ret:7.2f}  final distance to target {np.linalg.norm(s[:2] - TARGET):.3f}")
```

</details>

Reading it, line by line:
- **Dyna-Q:** episode 1 is 983 steps for every `n`, because all values stay 0 until the goal is found and the acting random numbers are shared. From episode 2 the planning budget dominates: 861, 148 and 39 steps for `n = 0, 5, 50`. By episode 50 all three take about 16–17 steps, the 14-step path plus ε-greedy detours. The last column averages the first episode after which the greedy path is exactly 14 steps (a run that never got there within 50 episodes counts as 51). The cost is compute: `n = 50` makes 51 value updates per real step instead of 1. Sutton and Barto report the same ordering on this maze: about 25 episodes for the non-planning agent to reach near-optimal performance, about five and three for their two planning agents ✅[^3].
- **Where the model is right:** the network saw speeds up to 0.92. Its one-step error is `0.00043` below speed 0.5, but `0.124` at speeds 1.5–2.0 and `0.422` at 2.5–3.0: about 290 and 980 times larger (`0.124 / 0.00043`, `0.422 / 0.00043`) outside the data, although the physics is the same smooth formula.
- **Compounding:** started from true states, the one-step error stays near `0.00043` at every step; fed its own predictions, the rollout error is `0.00135` after 5 steps and `0.00412` after 20. In this damped system the error grew roughly in proportion to the horizon, like the `k`-proportional term of MBPO's bound.
- **MPC:** planning with the learned model ends `0.019` from the target with return `−82.91`, against `0.014` and `−82.73` with the true equations; random actions end `2.05` away. The planner pushed the point mass to a top speed of 1.15, a little beyond the 0.92 in the training data but far from the speeds of 1.5–3.0 where the one-step error reached 0.12–0.42 (the drag caps the speed under a unit force at `√2 ≈ 1.41` per axis), so the model's large errors never came into play.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Planner or policy reaches states the data never covered | Predictions there can be badly wrong (lab: one-step error about 980 times larger at speeds 2.5–3.0 than below 0.5) | The model generalizes poorly outside its training distribution; lab ✅[^11]; MBPO measured model error rising as the policy moves away from the data-collecting one ✅[^6] |
| Agent optimizes purely inside the model | Finds actions the model overrates: high imagined return, low real return | Model bias is exploitable ✅[^1]; World Models at `τ = 0.10`: 2086 in the dream, 193 in the real game ✅[^8] |
| Long model rollouts | Error accumulates with every predicted step | Each prediction becomes the next input; lab ×10 at 20 steps ✅[^11]; MBPO's 500-step rollouts too inaccurate to learn from ✅[^6] |
| Model too optimistic (a path is blocked) | Agent tries the promised path, sees it fail, corrects the model | Acting on an optimistic error reveals it ✅[^4] |
| Environment improves (a shortcut opens) | Dyna-Q may never find it; the more it plans, the less it explores there | Its model says the shortcut does not exist; Dyna-Q+ adds a bonus reward for pairs untried for a long time ✅[^4] (exploration in general: `machine-learning/reinforcement-learning/multi-armed-bandits.md`) |
| Stochastic environment, Dyna-Q's table model | The model replays only the last outcome seen for each pair | The table model assumes a deterministic world ✅[^3]; sampling error is one of the reasons models are wrong ✅[^4] |
| Uniform choice of pairs to replay | Many planning updates change nothing early on | Most transitions connect zero-valued states; prioritized sweeping focuses updates, often 5 to 10 times faster on mazes ✅[^5] |
| Planning window shorter than the task | Plans ignore rewards beyond the window | MPC can add a learned value function for the rest ✅[^1]; Dreamer learns values for the same reason ✅[^10] |
| Small dataset, neural network model | Poor predictions far into the future | Networks tend to overfit small datasets; PETS adds ensembles ✅[^7] |
| Probabilistic network asked about an unfamiliar input | Its predicted variance can take arbitrary values | PETS flags this as able to disrupt planning ✅[^7] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Model-free (Q-learning, policy gradients) | Simpler; not affected by model bias ✅[^3]; easier to implement and tune ✅[^1] | More real interaction: 42.5 episodes in the lab maze ✅[^11] |
| Dyna (learn a model, replay it) | Fuller use of limited experience ✅[^3]; 13.3 episodes with `n = 50` in the lab ✅[^11] | `n + 1` updates per real step; inherits model bias ✅[^3] |
| MPC with a learned model | No policy network; replans from each real state ✅[^1]; no gradients and no fixed task horizon needed ✅[^7] | Planning compute at every real step; results limited by the window and the model |
| Policy trained on imagined data (World Models, Dreamer, MBPO) | Cheap imagined experience: training without running the real game engine ✅[^8], thousands of latent trajectories in parallel ✅[^10] | Exploitation of model errors ✅[^8]; needs short rollouts from real states ✅[^6] |
| Latent model trained only for reward, value and policy (MuZero) | Need not reconstruct observations, which drastically reduces what it must predict ✅[^9] | Needs a search at each decision; the published dynamics function is deterministic ✅[^9] |

## Takeaways
- Measure the model's error on the states your planner or policy actually visits, not only on held-out data from the training distribution. [rule-candidate]
- Prefer many short model rollouts started from real states over long rollouts from the episode start.
- An optimistic model error corrects itself when the agent acts on it; a pessimistic one can hide a better path forever, so keep some exploration.
- Compare a model-based agent with a model-free one at equal real interactions and report the extra compute.

## Verification status
- Verified: 72 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [Part 2: Kinds of RL Algorithms](https://spinningup.openai.com/en/latest/spinningup/rl_intro2.html) — OpenAI Spinning Up, 2018. Backs: model as a predictor of transitions and rewards, sample-efficiency upside, exploitable model bias, model-free methods easier to implement and tune, MPC (execute the first action, discard the rest, replan; value function beyond the window), expert iteration, imagined data, planning loops inside policies. [^1]
- [9.1 Models and Planning](http://incompleteideas.net/book/first/ebook/node95.html) — Sutton & Barto, 1998 (1st-edition HTML). Backs: what a model is, distribution vs sample models, planning as producing a policy from a model, simulated vs real experience with the same update. [^2]
- [9.2 Integrating Planning, Acting, and Learning](http://incompleteideas.net/book/first/ebook/node96.html) — Sutton & Barto, 1998 (1st-edition HTML). Backs: Dyna-Q's direct RL, model learning and planning, the deterministic table model, planning only from experienced pairs, `n = 0` is Q-learning, indirect vs direct methods, search control, the Dyna maze (47 states, about 25 vs about five and three episodes, values propagated back from the goal). [^3]
- [9.3 When the Model Is Wrong](http://incompleteideas.net/book/first/ebook/node97.html) — Sutton & Barto, 1998 (1st-edition HTML). Backs: why models are wrong, optimistic errors corrected, the shortcut maze, Dyna-Q+'s bonus for long-untried actions. [^4]
- [9.4 Prioritized Sweeping](http://incompleteideas.net/book/first/ebook/node98.html) — Sutton & Barto, 1998 (1st-edition HTML). Backs: wasted uniform backups, prioritizing by the size of the value change, 5 to 10 times faster on mazes. [^5]
- [When to Trust Your Model: Model-Based Policy Optimization](https://ar5iv.labs.arxiv.org/html/1906.08253) — Janner, Fu, Zhang, Levine, 2019 (ar5iv HTML of arXiv:1906.08253). Backs: fast learning on physical systems, model accuracy as the bottleneck, maximum-likelihood model, the return bound and its `C`, pessimism and compounding, branched `k`-step rollouts, Dyna as `k = 1`, the term proportional to `k`, the branched bound's literal optimum at `k = 0`, the measured-error bound with an optimum at `k > 0`, model error rising with policy shift and more slowly with more data, ensemble, 20–40 updates per step, Ant at 300 thousand vs 3 million steps, `k = 1`, 200- and 500-step rollouts. [^6]
- [Deep Reinforcement Learning in a Handful of Trials using Probabilistic Dynamics Models](https://ar5iv.labs.arxiv.org/html/1805.12114) — Chua, Calandra, McAllister, Levine, 2018 (ar5iv HTML of arXiv:1805.12114). Backs: the asymptotic-performance gap, aleatoric vs epistemic uncertainty, probabilistic ensembles of 5 networks, MPC without gradients or a fixed task horizon, random shooting and CEM, overfitting on small datasets, arbitrary variance on unfamiliar inputs. [^7]
- [World Models](https://ar5iv.labs.arxiv.org/html/1803.10122) — Ha, Schmidhuber, 2018 (ar5iv HTML of arXiv:1803.10122). Backs: V, M and C, 867 controller parameters, CMA-ES, training inside the dream, adversarial policies away from the training data, the temperature table (2086 vs 193, 1092, random 210). [^8]
- [Mastering Atari, Go, Chess and Shogi by Planning with a Learned Model](https://ar5iv.labs.arxiv.org/html/1911.08265) — Schrittwieser et al., 2019 (ar5iv HTML of arXiv:1911.08265). Backs: representation, dynamics and prediction functions, MCTS over hidden states, training targets (reward, search policy, value), no reconstruction requirement, deterministic dynamics, the Go/chess/shogi and 57-game Atari results. [^9]
- [Dream to Control: Learning Behaviors by Latent Imagination](https://ar5iv.labs.arxiv.org/html/1912.01603) — Hafner, Lillicrap, Ba, Norouzi, 2019 (ar5iv HTML of arXiv:1912.01603). Backs: latent representation, transition and reward models, actor-critic trained in imagination with analytic value gradients, short-sighted fixed horizons, 20 visual control tasks. [^10]
- `machine-learning/lab-setup.md` — the lab where the Dyna-Q maze, the learned point-mass model and the MPC experiment ran on 2026-11-25. [^11]

## Related
- `machine-learning/reinforcement-learning/markov-decision-processes.md` — value iteration, planning when the model is given exactly.
- `machine-learning/reinforcement-learning/temporal-difference-and-q-learning.md` — the Q-learning update Dyna-Q uses for both learning and planning.
- `machine-learning/reinforcement-learning/policy-gradients-and-ppo.md` — the model-free policy learners model-based agents are compared with.
- `machine-learning/reinforcement-learning/offline-reinforcement-learning.md` — learning from a fixed dataset, where model exploitation and distribution shift are the central problem.
- `machine-learning/deep-learning/uncertainty-in-deep-learning.md` — aleatoric vs epistemic uncertainty and deep ensembles, as used by PETS and MBPO.
- `machine-learning/generative-models/variational-autoencoders.md` — the VAE that World Models uses as its vision component.
