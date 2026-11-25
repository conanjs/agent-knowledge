---
schema: topic-index/v1
kind: subtopic
topic: machine-learning/reinforcement-learning
last-updated: 2026-11-24
---

# Reinforcement learning

Learning from rewards through interaction: the Markov decision process (MDP) and its Bellman equations, multi-armed bandits and exploration, temporal-difference (TD) learning with SARSA and Q-learning, deep Q-networks, policy gradients up to PPO (proximal policy optimization), and learning with a model (model-based RL) or from a fixed dataset (offline RL). Read them in table order: each doc builds on the ones above it. Every mechanism is checked against a small environment written by hand in numpy, or a small PyTorch network, in the lab. Not covered: RLHF (reinforcement learning from human feedback) for language models (see `machine-learning/transformers/alignment-rlhf-and-dpo.md`), and multi-agent RL.

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [markov-decision-processes.md](markov-decision-processes.md) | concept | States, actions, transitions, rewards and the discount; value functions, Bellman equations and value iteration on a 4×4 gridworld; terminated vs truncated | verified |
| [multi-armed-bandits.md](multi-armed-bandits.md) | concept | Exploration vs exploitation and regret; ε-greedy, UCB1 and Thompson sampling compared on 500 ten-armed bandits | verified |
| [temporal-difference-and-q-learning.md](temporal-difference-and-q-learning.md) | concept | Monte Carlo vs TD(0) on the random walk; SARSA (on-policy) vs Q-learning (off-policy) on cliff walking | verified |
| [deep-q-networks.md](deep-q-networks.md) | concept | Q-learning with a neural network: experience replay, target networks, the deadly triad, overestimation and double DQN | verified |
| [policy-gradients-and-ppo.md](policy-gradients-and-ppo.md) | concept | REINFORCE, reward-to-go, baselines and advantages, actor-critic, GAE, and PPO's clipped objective | verified |
| [model-based-reinforcement-learning.md](model-based-reinforcement-learning.md) | concept | Learned dynamics models; Dyna-Q with 0/5/50 planning steps on the Dyna maze; MPC by random shooting with a learned point-mass model; compounding and out-of-distribution model error and MBPO's short rollouts; MuZero, World Models and Dreamer in outline | verified |
| [offline-reinforcement-learning.md](offline-reinforcement-learning.md) | concept | Learning from a fixed dataset: distribution shift and extrapolation error; behaviour cloning, BCQ-style constraints, CQL-style penalties and IQL compared on random/medium/expert gridworld data; Decision Transformer and D4RL in outline | verified |

## References
- [Spinning Up in Deep RL](https://spinningup.openai.com/en/latest/) — OpenAI, 2018. Backs: topic scope (key concepts, algorithm families, policy optimization).
- [Chapter 17: Reinforcement Learning](https://d2l.ai/chapter_reinforcement-learning/index.html) — Dive into Deep Learning, living. Backs: topic scope (MDPs, value iteration, Q-learning).
- [Reinforcement Learning: An Introduction](http://incompleteideas.net/book/the-book-2nd.html) — Sutton & Barto, 2nd ed. 2018 (book page; the docs cite the 1st edition's HTML sections). Backs: topic scope.
- [Gymnasium documentation](https://gymnasium.farama.org/) — Farama Foundation, living. Backs: the environment interface vocabulary (`reset`, `step`, `terminated`, `truncated`).

## Related
- `machine-learning/learning-path.md` — where this subtopic sits in the reading order.
- `machine-learning/lab-setup.md` — the lab every experiment ran in.
- `machine-learning/transformers/alignment-rlhf-and-dpo.md` — PPO applied to language models.
- `machine-learning/deep-learning/neural-networks-and-backpropagation.md` — the networks used by DQN and policy gradients.
