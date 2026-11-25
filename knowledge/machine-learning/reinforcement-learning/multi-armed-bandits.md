---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/reinforcement-learning
status: verified
applies-to: ["any"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [machine-learning, reinforcement-learning, multi-armed-bandit, exploration, exploitation, regret, epsilon-greedy, ucb, ucb1, thompson-sampling]
---

# Multi-armed bandits: exploration, regret, ε-greedy, UCB and Thompson sampling

## Summary
**TL;DR:** A multi-armed bandit is reinforcement learning (RL) with a single state: each round you pick one of K options ("arms") and see only that arm's random reward. Every pull either exploits (plays the best arm so far) or explores (learns about an uncertain arm), and regret, the reward lost against always playing the best arm, scores how well a rule balances the two. ε-greedy explores at random forever, so with a fixed ε its regret keeps growing at a constant rate; UCB1 (upper confidence bound) adds a bonus that shrinks as an arm is tried; Thompson sampling plays each arm with the probability that it is the best one given the data, and had by far the lowest regret in the lab.
**Use this when:** you choose online between options with unknown payoffs (which variant, ad or treatment to serve next), pick an exploration rule for an RL agent, or read a regret bound.
**Not this doc:** problems where actions also change the next state → `machine-learning/reinforcement-learning/markov-decision-processes.md`; the Beta posterior itself → `machine-learning/probabilistic-ml/bayesian-inference.md`.

## Problem
Always playing the arm with the best average so far looks rational, but one unlucky early streak can make the truly best arm look bad, and a rule that never retries it never finds out. Trying arms at random fixes that but keeps paying for arms already known to be poor. A rule is needed that decides how much to explore, and a number that compares rules. In the lab's 10-armed problem, the purely greedy rule played the best arm in only 70.5 % of 20,000 rounds (averaged over 500 runs) and was still losing 0.026 reward per round at the end ✅[^7].

## Mental model
**Analogy:** choosing a restaurant every evening in a new city. Going back to the best one so far is exploiting; trying an untested place is exploring. Your regret after a month is the sum, over every evening, of how much better the best restaurant in town would have been than the one you picked. A good rule tries new places early, writes off places that were clearly bad, and keeps going back to the winner.

**Artifact:** the three selection rules from the lab script, one line each (`n` = pulls per arm, `s` = total reward per arm, `t` = round):

```python
np.where(rng.random(RUNS) < eps, rng.integers(K, size=RUNS), means.argmax(axis=1))  # ε-greedy
(s / n + np.sqrt(2 * np.log(t) / n)).argmax(axis=1)                                  # UCB1
rng.beta(1 + s, 1 + n - s).argmax(axis=1)                                            # Thompson sampling
```

## How it works
**2 actors:**
- **Agent** — its job: pick an arm each round, via a selection rule over its per-arm counts `n(a)` and reward sums `s(a)`.
- **Environment** — its job: return a reward for the chosen arm only, via that arm's fixed reward distribution.

```text
round t:  [Agent] rule(n, s, t) ── arm a_t ──► [Environment] r_t ~ D(a_t)  (other arms: nothing observed)
              ▲                                         │
              └──── n(a_t) += 1,  s(a_t) += r_t ◄───────┘
```

1. **The problem.** Each of K actions has a fixed reward distribution; the goal is the largest expected total reward over a run of selections ✅[^1]. The standard model adds three assumptions: the agent sees only the chosen arm's reward ("bandit feedback"), each arm's rewards are independent and identically distributed, and rewards are bounded, scaled to `[0, 1]` for simplicity ✅[^5].
2. **Estimate each arm.** The sample average `Q(a) = s(a) / n(a)` converges to the arm's true mean as `n(a)` grows, by the law of large numbers ✅[^2]. It can be kept incrementally: new estimate = old estimate + step size × (reward − old estimate), with step size `1/n` ✅[^3]. Example: 3 successes in 5 pulls give 0.6; a sixth pull paying 1 gives `0.6 + (1/6)·(1 − 0.6) = 0.667`, which is `4/6`.
3. **Explore or exploit.** Playing the arm with the highest estimate exploits; playing any other arm explores, and no single pull can do both ✅[^1].
4. **Regret.** `R(T) = μ*·T − Σ_{t=1..T} μ(a_t)`, where `μ(a)` is arm `a`'s mean reward, `μ*` the best mean, `a_t` the arm played in round `t` and `T` the number of rounds; because `a_t` is random, one usually reports the expected regret `E[R(T)]` ✅[^5]. The gap `Δ(a) = μ* − μ(a)` measures how much worse arm `a` is ✅[^5]. Example: `μ* = 0.9`; playing an arm with `μ = 0.6` for 10 rounds adds `10 × 0.3 = 3.0` to the regret.
5. **ε-greedy.** With probability `ε` play a uniformly random arm, otherwise the greedy one ✅[^2] ✅[^5]. Every arm is then sampled infinitely often, so every estimate converges, but that is only an asymptotic guarantee ✅[^2]. Random exploration also spends as many trials on arms that are almost surely bad as on arms that are merely uncertain ✅[^6]. Letting `ε_t` shrink like `t^(−1/3) · (K log t)^(1/3)` bounds the expected regret by `t^(2/3) · O(K log t)^(1/3)` ✅[^5]; with a fixed `ε`, the lab shows a per-round regret floor of about `ε × (μ* − average arm mean)`, because each explore step picks an average arm (Worked example).
6. **UCB1 (upper confidence bound).** Optimism under uncertainty: score each arm as if it were as good as the data still allow, `UCB_t(a) = μ̄_t(a) + r_t(a)`, where `μ̄_t(a)` is the arm's average so far and `r_t(a)` its confidence radius; try every arm once, then always play the highest score ✅[^5]. The original UCB1 of Auer et al. (2002) uses `r_t(a) = sqrt(2·ln t / n_t(a))`, which needs no horizon `T` ✅[^5]. A score is high because the average is high or because the arm was tried rarely ✅[^5]. Example at `t = 100` (`ln 100 = 4.605`): arm X, average 0.60 from 10 pulls, scores `0.60 + sqrt(9.210/10) = 0.60 + 0.960 = 1.560`; arm Y, average 0.65 from 80 pulls, scores `0.65 + sqrt(9.210/80) = 0.65 + 0.339 = 0.989`, so UCB1 plays the less-tried X. UCB1 satisfies the bounds `E[R(T)] = O(sqrt(K·T·log T))` and `O(log T) · Σ_{suboptimal a} 1/Δ(a)` ✅[^5], which are near-optimal against the known lower bounds ✅[^5].
7. **Thompson sampling.** Keep a posterior belief per arm and act on one random draw from it ✅[^6]. For 0/1 rewards (a Bernoulli bandit) the belief is a Beta distribution: start from `Beta(α=1, β=1)`, which is uniform on `[0, 1]`, and after pulling the arm with reward `r` set `(α, β) ← (α + r, β + 1 − r)`; the belief's mean is `α/(α+β)` ✅[^6]. Example: 3 successes and 2 failures give `Beta(4, 3)`, mean `4/7 = 0.571`. Each round, draw `θ̂_k ~ Beta(α_k, β_k)` for every arm and play the arm with the largest draw; the greedy rule would use the mean instead ✅[^6]. As a result each arm is played with the posterior probability that it is the best: in the tutorial's three-arm example, about 0.82, 0 and 0.18 ✅[^6]. The draw is a plausible success probability, not a plausible reward ✅[^6]. Why the Beta update is exact (conjugacy) → `machine-learning/probabilistic-ml/bayesian-inference.md`.

## Worked example
Six rules on 500 independent 10-armed Bernoulli bandits, each with its own arm means drawn uniformly from `[0, 1]`, 20,000 rounds each; regret is averaged over the 500 runs. Lab run (`machine-learning/lab-setup.md`), 2026-11-24, Python 3.13.7, numpy 2.5.5, two runs identical ✅[^7]:

```text
mean of (mu* - average arm mean) over the runs: 0.413
policy              R@100   R@1000  R@10000  R@20000  regret/step, last 1000  best-arm share
greedy (eps=0)        9.4     33.8    267.3    525.0                  0.0258           0.705
eps-greedy 0.01       9.6     33.9    164.6    244.1                  0.0074           0.822
eps-greedy 0.1       12.8     59.5    447.5    866.6                  0.0418           0.832
eps-greedy 0.3       19.3    135.7   1259.0   2502.3                  0.1243           0.685
UCB1                 27.6    130.1    351.4    440.7                  0.0071           0.770
Thompson             13.7     27.9     45.3     51.6                  0.0005           0.946
```

<details><summary>Full script (prints the output above)</summary>

```python
# 10-armed Bernoulli bandit: regret of greedy, epsilon-greedy, UCB1 and Thompson sampling.
# 500 runs in parallel; each run has its own arm means mu ~ Uniform(0, 1).
# regret(T) = sum over t of (mu* - mu(a_t)), averaged over runs.
import numpy as np

K, T, RUNS = 10, 20_000, 500
CHECKPOINTS = (100, 1_000, 10_000, 20_000)
rows = np.arange(RUNS)

def simulate(choose, seed=0):
    rng = np.random.default_rng(seed)
    mu = rng.uniform(0.0, 1.0, (RUNS, K))           # true means, unknown to the agent
    n = np.zeros((RUNS, K))                          # pulls per arm
    s = np.zeros((RUNS, K))                          # total reward per arm
    regret = np.zeros(RUNS)
    out = {}
    for t in range(1, T + 1):
        a = choose(n, s, t, rng)                     # one arm index per run
        r = (rng.random(RUNS) < mu[rows, a]).astype(float)
        n[rows, a] += 1
        s[rows, a] += r
        regret += mu.max(axis=1) - mu[rows, a]
        if t in CHECKPOINTS or t == T - 1_000:
            out[t] = regret.mean()
    best_share = (n[rows, mu.argmax(axis=1)] / T).mean()
    return out, best_share

def eps_greedy(eps):
    def choose(n, s, t, rng):
        means = np.where(n > 0, s / np.maximum(n, 1), np.inf)   # untried arms look best
        greedy = means.argmax(axis=1)
        explore = rng.random(RUNS) < eps
        return np.where(explore, rng.integers(K, size=RUNS), greedy)
    return choose

def ucb1(n, s, t, rng):
    if t <= K:
        return np.full(RUNS, t - 1)                  # try each arm once
    return (s / n + np.sqrt(2 * np.log(t) / n)).argmax(axis=1)   # mean + confidence radius

def thompson(n, s, t, rng):
    return rng.beta(1 + s, 1 + n - s).argmax(axis=1)  # one draw per Beta(1+wins, 1+losses) posterior

policies = {"greedy (eps=0)": eps_greedy(0.0), "eps-greedy 0.01": eps_greedy(0.01),
            "eps-greedy 0.1": eps_greedy(0.1), "eps-greedy 0.3": eps_greedy(0.3),
            "UCB1": ucb1, "Thompson": thompson}
gap = np.random.default_rng(0).uniform(0.0, 1.0, (RUNS, K))   # the same mu as simulate() draws
print(f"mean of (mu* - average arm mean) over the runs: {(gap.max(axis=1) - gap.mean(axis=1)).mean():.3f}")
print(f"{'policy':16s}" + "".join(f"{'R@' + str(c):>9s}" for c in CHECKPOINTS)
      + "  regret/step, last 1000  best-arm share")
for name, choose in policies.items():
    out, share = simulate(choose)
    slope = (out[T] - out[T - 1_000]) / 1_000
    print(f"{name:16s}" + "".join(f"{out[c]:9.1f}" for c in CHECKPOINTS) + f"  {slope:22.4f}  {share:14.3f}")
```

</details>

Reading it:
- **Greedy locks in.** Its regret is low at first (9.4 at round 100) and then keeps rising at 0.026 per round: in some runs an unlucky start made it settle on a worse arm and it never looked back (best-arm share 0.705).
- **Fixed ε has a floor.** An explore step plays an average arm, which costs `μ* − average arm mean = 0.413` on average here. So the floor is `ε × 0.413`: 0.041 for `ε = 0.1` (measured 0.0418) and 0.124 for `ε = 0.3` (measured 0.1243). Regret grows linearly for ever; `ε = 0.3` ends at 2502. `ε = 0.01` has a tiny floor (0.004) but explores so rarely that some runs stay stuck, so it measured 0.0074.
- **UCB1 pays early, then flattens.** It has the worst regret at round 100 (27.6), because every arm's radius is still wide, but by the end it loses only 0.0071 per round and has overtaken greedy (440.7 vs 525.0 at round 20,000).
- **Thompson sampling** was best from round 1,000 on, ending at 51.6, about a tenth of greedy, still losing only 0.0005 per round, and playing the best arm 94.6 % of the time.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Unlucky first pulls with a greedy rule | The rule can settle on a worse arm for good | A greedy rule is unlikely ever to retry an arm whose estimate looks low ✅[^6]; lab: greedy lost 0.026 per round at round 20,000 ✅[^7] |
| Fixed ε | Regret grows linearly, about `ε × (μ* − average arm mean)` per round | Exploration never stops and ignores what is known; lab: 0.0418 for `ε = 0.1` ✅[^7] |
| Many arms that are clearly bad | ε-greedy keeps spending explore pulls on them | Random exploration does not "write off" hopeless actions ✅[^6] |
| UCB1 in the first rounds | Explores heavily; worst regret at round 100 in the lab | The radius is large while `n(a)` is small ✅[^5]; lab: 27.6 vs 9.4 for greedy ✅[^7] |
| Rewards outside `[0, 1]` | UCB1's radius no longer matches the reward scale | The standard analysis assumes bounded rewards scaled to `[0, 1]` ✅[^5] |
| Horizon `T` not known in advance | Use the `ln t` radius | Auer et al.'s version does not take `T` as input ✅[^5] |
| Arm payoffs drift over time | Sample averages react ever more slowly | A constant step size gives an exponential, recency-weighted average that keeps tracking ✅[^4] |
| Thompson sampling implemented by sampling a reward | Wrong algorithm | The draw must be a plausible success probability, not a plausible outcome ✅[^6] |
| The chosen option changes what happens next | Not a bandit any more | Needs states and transitions: `markov-decision-processes.md` |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| ε-greedy | One parameter, no model of rewards; estimates converge in the limit ✅[^2] | Linear regret with a fixed ε (lab) ✅[^7]; wastes pulls on hopeless arms ✅[^6] |
| UCB1 | Deterministic; logarithmic, near-optimal regret bounds ✅[^5] | Over-explored early in the lab (worst regret at round 100) ✅[^7]; radius tied to the reward scale ✅[^5] |
| Thompson sampling | Explores in proportion to the chance of being best ✅[^6]; lowest regret in the lab ✅[^7] | Needs a prior and a posterior you can sample from (Beta for 0/1 rewards) ✅[^6] |

## Takeaways
- Never ship a purely greedy online choice: add exploration, even a small one. [rule-candidate]
- Compare exploration rules by regret over the horizon you care about, not by the reward of the final arm.
- A fixed ε never stops paying for exploration; decay it or use UCB1 or Thompson sampling for long runs.
- For 0/1 rewards, Thompson sampling with `Beta(1 + wins, 1 + losses)` is a one-line rule and was the strongest in the lab.

## Verification status
- Verified: 43 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- [2.1 An n-Armed Bandit Problem](http://incompleteideas.net/book/first/ebook/node15.html) — Sutton & Barto, Reinforcement Learning: An Introduction (1st ed., HTML), 1998. Backs: the bandit problem; greedy = exploit, non-greedy = explore, not both in one pull. [^1]
- [2.2 Action-Value Methods](http://incompleteideas.net/book/first/ebook/node16.html) — Sutton & Barto (1st ed., HTML), 1998. Backs: sample-average estimate, ε-greedy definition, its asymptotic-only guarantee. [^2]
- [2.5 Incremental Implementation](http://incompleteideas.net/book/first/ebook/node19.html) — Sutton & Barto (1st ed., HTML), 1998. Backs: incremental update toward a target with step size `1/n`. [^3]
- [2.6 Tracking a Nonstationary Problem](http://incompleteideas.net/book/first/ebook/node20.html) — Sutton & Barto (1st ed., HTML), 1998. Backs: constant step size gives an exponential, recency-weighted average for drifting payoffs. [^4]
- [Introduction to Multi-Armed Bandits](https://arxiv.org/html/1904.07272v8) — Aleksandrs Slivkins, 2024 (v8). Backs: model assumptions, regret and gap definitions, ε-greedy and its decaying schedule bound, UCB1 rule, radius `sqrt(2 ln t / n)` from Auer et al. (2002), regret bounds and their near-optimality. [^5]
- [A Tutorial on Thompson Sampling](https://arxiv.org/html/1707.02038v3) — Russo, Van Roy, Kazerouni, Osband, Wen, 2020 (v3). Backs: greedy fails to explore, ε-greedy wastes trials, Beta–Bernoulli Thompson sampling and its update, posterior probability of optimality, the sampling misconception. [^6]
- `machine-learning/lab-setup.md` — the lab where the 10-armed regret comparison of six rules ran on 2026-11-24. [^7]

## Related
- `machine-learning/reinforcement-learning/markov-decision-processes.md` — the general case, where actions change the state.
- `machine-learning/reinforcement-learning/temporal-difference-and-q-learning.md` — ε-greedy reused as the behaviour policy of Q-learning and SARSA.
- `machine-learning/probabilistic-ml/bayesian-inference.md` — Beta–Binomial conjugacy behind the Thompson update.
