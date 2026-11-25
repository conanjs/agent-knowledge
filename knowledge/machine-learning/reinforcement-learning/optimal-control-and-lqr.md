---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/reinforcement-learning
status: verified
applies-to: ["any", "scipy 1.18.1"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, reinforcement-learning, optimal-control, lqr, linear-quadratic-regulator, riccati-equation, dare, system-identification, certainty-equivalence, random-search, policy-gradient, ilqr, ddp, mpc, lqg, kalman-duality, scipy]
---

# Optimal control and the linear–quadratic regulator: the Riccati recursion, LQR as a reinforcement-learning baseline, iLQR and MPC

## Summary
**TL;DR:** Optimal control chooses the inputs `u_t` that steer a dynamical system `x_{t+1} = f(x_t, u_t)` at the lowest summed cost; reinforcement learning (RL) is the same problem with the dynamics unknown. The linear–quadratic regulator (LQR) is the case with linear dynamics `x_{t+1} = A x_t + B u_t` and quadratic cost `Σ xᵀQx + uᵀRu`. Its optimal policy is linear feedback `u_t = −K_t x_t`, and the gains come from the backward Riccati recursion: value iteration on value functions of the form `V(x) = xᵀSx`, stored exactly as one matrix per step. Far from the end of the horizon the gains stop changing; that constant gain comes from the discrete-time algebraic Riccati equation (DARE), which `scipy.linalg.solve_discrete_are` solves. Because the exact answer is known, LQR is where RL methods can be scored: in the lab, least squares on one 10-step rollout followed by the Riccati equation gave gains with a median relative cost gap of 1.4e-5, while random search on the gain needed 10,000 samples to reach 1.9e-4. Iterative LQR (iLQR) reuses the recursion on nonlinear systems by linearizing along a trajectory; model-predictive control (MPC) re-solves a short-horizon problem at every step to respect constraints.
**Use this when:** you design a feedback controller for a system that is close to linear near an operating point, choose the weights `Q` and `R`, call `solve_discrete_are` or `solve_continuous_are`, need a known-optimal baseline to test an RL algorithm against, or meet the words Riccati, certainty equivalence, iLQR, DDP (differential dynamic programming) or LQG (linear–quadratic–Gaussian control).
**Not this doc:** Bellman equations and value iteration for discrete MDPs (Markov decision processes) → `machine-learning/reinforcement-learning/markov-decision-processes.md`; learned neural dynamics models and MPC by random shooting → `machine-learning/reinforcement-learning/model-based-reinforcement-learning.md`; policy-gradient estimators and PPO (proximal policy optimization) → `machine-learning/reinforcement-learning/policy-gradients-and-ppo.md`; the Kalman filter itself → `machine-learning/probabilistic-ml/hidden-markov-models-and-kalman-filters.md`.

## Problem
A controller chooses an input at every step, and each choice changes the states it will face later, so a rule that looks sensible step by step can be far from the best over the whole run. In the lab, hand-tuned PD (proportional–derivative) gains for a sliding mass, `u = −(kp·position + kd·velocity)`, cost 4 % to 70 % more than the optimum, and one plausible-looking pair made the system blow up to a cost of 2.8e13 ✅[^12]. Some systems are unstable on their own: in three coupled heat sources the dominant mode grows by 2.4 % per step without control ✅[^12], and a fitted model that wrongly calls an unstable mode stable leads the controller to put less effort into cooling it ✅[^2]. RL methods that learn the controller from trials alone can pay orders of magnitude more samples than fitting a model first: Recht reports policy gradient needing thousands of times as many samples as nominal control on a double integrator, and model-free methods that fail to be safe on the heat-source system ✅[^2].

## Mental model
**Analogy:** stopping a sliding cart on a floor mark while paying for fuel. Each second you choose a push. You pay for every second the cart is away from the mark or still moving (the state cost `Q`) and for every push (the input cost `R`). Plan backwards from the deadline: in the last second a push can no longer reduce any future bill, so the best push is none. One second earlier you already know what the last second will cost from every position and speed, so you pick the push that minimizes "this second's bill + next second's known bill". With linear physics and quadratic bills, every "bill from here on" is a bowl-shaped quadratic described by one small matrix, and the best push is always "a fixed multiple of position plus a fixed multiple of speed". Far enough from the deadline the multiples stop changing: that constant rule is the LQR gain.

**Artifact:** the backup that turns the bowl one step later into the bowl one step earlier, and the gains it produced on the double integrator (position and velocity of a unit mass, time step 1), from the full script in the Worked example; lab run (`machine-learning/lab-setup.md`), 2026-11-25, numpy 2.5.5, scipy 1.18.1 ✅[^12]:

```python
def riccati_step(S, A, B, Q, R):            # one Bellman backup on V(x) = x'Sx: returns S one step earlier, gain K
    K = np.linalg.solve(R + B.T @ S @ B, B.T @ S @ A)
    return Q + A.T @ S @ A - A.T @ S @ B @ K, K
```

```text
t=29 ( 1 steps to go): K_t = [0. 0.]  max|S_t - P| = 3.6e+00
t=28 ( 2 steps to go): K_t = [0.  0.5]  max|S_t - P| = 2.1e+00
t=27 ( 3 steps to go): K_t = [0.2857 1.    ]  max|S_t - P| = 6.1e-01
…
t=20 (10 steps to go): K_t = [0.4221 1.2439]  max|S_t - P| = 3.9e-06
```

## How it works
### The control problem and the LQR case
1. **Optimal control.** A state `x_t` evolves as `x_{t+1} = f(x_t, u_t, e_t)` under an input `u_t` and a random disturbance `e_t`; a policy picks `u_t` from the states seen so far, and the goal is the best expected sum of per-step rewards ✅[^2]. Recht treats RL as exactly this problem when `f` is unknown and writes `u` for the action; for LQR he switches, as is conventional in control, from maximizing a reward to minimizing a cost ✅[^2]. The RL vocabulary (state, action, return, Bellman equation) is in `markov-decision-processes.md`.
2. **LQR.** Dynamics `x_{t+1} = A x_t + B u_t` (plus noise `e_t` if present) and cost `Σ_t (x_tᵀQ x_t + u_tᵀR u_t)` plus an optional terminal cost `x_Nᵀ Q_f x_N`, with `Q` and `Q_f` positive semidefinite (`xᵀQx ≥ 0` for every `x`) and `R` positive definite (`uᵀRu > 0` for every `u ≠ 0`) ✅[^1]. `x` holds `n` state numbers and `u` holds `p` inputs, so `A` is `n×n` and `B` is `n×p`. The double integrator: `x = [position, velocity]`, `A = [[1, 1], [0, 1]]`, `B = [[0], [1]]` ✅[^2]. From `x = [−1, 0]` with `u = 0.4221`, the next state is `[−1 + 0, 0 + 0.4221] = [−1, 0.4221]`, and with `Q = I`, `R = 1` that step costs `1 + 0.4221² = 1.178`.
3. **Why this case.** Many systems are close to linear over the range they operate in, linear dynamics are the only kind guaranteed to keep the optimization's constraint set convex, and with a quadratic cost the disturbance only adds a constant to the expected cost: it makes the achievable cost worse but does not change which inputs are best ✅[^2].

### The Riccati recursion: value iteration on quadratics
Double integrator, `Q = I`, `R = 1`, horizon `N = 30`, no terminal cost (`S_30 = 0`).
1. **Quadratic cost-to-go.** The optimal cost from state `x` at time `t` (the cost-to-go, a value function with the sign flipped) has the form `V_t(x) = xᵀS_t x` with `S_t` symmetric, and at the end `S_N = Q_f` ✅[^1].
2. **One Bellman backup.** `V_t(x) = min_u [xᵀQx + uᵀRu + V_{t+1}(Ax + Bu)]` ✅[^1]. The bracket is a convex quadratic in `u` because `R` is positive definite; setting its gradient `2Ru + 2BᵀS_{t+1}(Ax + Bu)` to zero gives linear feedback `u = −K_t x` with `K_t = (R + BᵀS_{t+1}B)⁻¹ BᵀS_{t+1}A` ✅[^1].
3. **The Riccati difference equation.** Substituting that `u` back keeps `V_t` quadratic, with `S_t = Q + AᵀS_{t+1}A − AᵀS_{t+1}B (R + BᵀS_{t+1}B)⁻¹ BᵀS_{t+1}A` ✅[^1]. By hand from `S_30 = 0`: `S_29 = Q = I` and `K_29 = 0`, because with no future a push is pure cost. Next, `R + BᵀS_29B = 2` and `BᵀS_29A = [0, 1]`, so `K_28 = [0, 0.5]` and `S_28 = I + AᵀA − [[0, 0], [0, 0.5]] = [[2, 1], [1, 2.5]]`. Then `R + BᵀS_28B = 3.5` and `BᵀS_28A = [1, 3.5]`, so `K_27 = [1/3.5, 1] = [0.2857, 1]`, as the lab printed ✅[^12].
4. **Act forward.** Apply `u_t = −K_t x_t` from `t = 0`; the total cost from `x_0` is `x_0ᵀS_0x_0`. Lab, 3-step horizon: `x_0ᵀS_0x_0 = 2.7143`, equal to the simulated cost of the time-varying gains, while the constant infinite-horizon gain cost 2.8262 over the same 3 steps ✅[^12]: on a short horizon the best gains change with time.
5. **It is value iteration.** The recursion is the dynamic-programming backup of `markov-decision-processes.md` with a value function that is quadratic and therefore stored exactly. Recht writes the finite-horizon Q-function (action-value function) as a quadratic in `(x, u)` built from the next step's matrix, and notes that these matrices converge to the infinite-horizon solution ✅[^2]. Run as an iteration from `P_1 = Q`, it converges to the unique positive semidefinite solution ✅[^4]; in the lab, starting from `S = 0`, 17 backups brought it within `1e-10` ✅[^12].

### The infinite horizon: the DARE and one constant gain
1. **Fixed point.** As the steps to go grow, `S_t` converges to the positive-definite fixed point `P`, the solution of the DARE `P = Q + AᵀPA − AᵀPB (R + BᵀPB)⁻¹ BᵀPA` ✅[^1]. The optimal policy becomes static feedback `u_t = −K x_t` with `K = (R + BᵀPB)⁻¹BᵀPA`, where `P` is the unique solution for which every eigenvalue of `A − BK` has magnitude below 1; for long horizons this static policy is nearly optimal ✅[^2]. Lab: the gain at 10 steps to go equals the DARE gain `[0.4221, 1.2439]` to four decimals ✅[^12].
2. **Solving it with scipy.** `scipy.linalg.solve_discrete_are(a, b, q, r)` returns the `X` that solves `AᴴXA − X − (AᴴXB)(R + BᴴXB)⁻¹(BᴴXA) + Q = 0` (`ᴴ` is the conjugate transpose, plain `ᵀ` for real matrices). It does not return the gain: its own example computes it afterwards with `solve(r + bᵀxb, bᵀxa)` ✅[^5]. It needs every eigenvalue of `A` outside the unit disc to be controllable and the pencil's eigenvalues to stay away from the unit circle, works through a QZ (generalized Schur) decomposition of a symplectic matrix pencil built from `A`, `B`, `Q` and `R`, and raises `LinAlgError` when it cannot isolate the stable subspace ✅[^5]. For continuous time, `ẋ = Ax + Bu`, `solve_continuous_are` solves the CARE (continuous-time algebraic Riccati equation) `XA + AᴴX − XBR⁻¹BᴴX + Q = 0` ✅[^6] and the gain is `K = R⁻¹BᵀS` ✅[^1]. For the continuous double integrator with `Q = I`, `R = 1`, Tedrake gives `K = [1, √3]` and `S = [[√3, 1], [1, √3]]` ✅[^1]; the lab reproduced them (`1.7321 = √3`) ✅[^12].
3. **Value function.** The optimal cost from `x_0` is `x_0ᵀPx_0`: `2.947123` in the lab, and 300 simulated steps of `u = −Kx` summed to `2.947123` ✅[^12].
4. **Stability.** `u = −Kx` stabilizes the system exactly when every eigenvalue of `A − BK` lies inside the unit circle ✅[^2], that is, when the spectral radius `ρ(A − BK)`, the largest eigenvalue magnitude, is below 1. Lab: eigenvalues `0.378 ± 0.1877j`, so `ρ = 0.422` ✅[^12].
5. **Policy iteration.** Evaluate a stabilizing gain by solving the Lyapunov equation `P_K = Q + KᵀRK + (A − BK)ᵀP_K(A − BK)`, which gives its cost `C(K) = E[x_0ᵀP_Kx_0]`, the expectation `E` over random start states `x_0` ✅[^4] (with `E[x_0x_0ᵀ] = I` that is the trace of `P_K`: `2.9471 + 4.6131 = 7.560` for the LQR gain), then improve it greedily with the backup's gain formula, `P_K` in place of `S_{t+1}`. Fazel et al. identify standard policy iteration with a special case of their Gauss–Newton update ✅[^4]. Lab: 4 iterations from the gentle PD gain took the cost gap from `11.6` to `1.8e-15`, against 17 value-iteration backups ✅[^12].
6. **Discounting.** RL often minimizes `Σ_t γᵗ (x_tᵀQx_t + u_tᵀRu_t)` with a discount `0 < γ < 1`; its Riccati equation is the DARE for `(√γ·A, B, Q, R/γ)` ✅[^1], so `γ = 0.9` shrinks `A` by `√0.9 = 0.949`. The gain is then `K = γ(R + γBᵀPB)⁻¹BᵀPA` ✅[^1]; the undiscounted gain formula applied to `(√γ·A, B, Q, R/γ)` returns `√γ` times that, since `(R/γ + BᵀPB)⁻¹BᵀP(√γ·A) = √γ·γ(R + γBᵀPB)⁻¹BᵀPA`. Discounting changes the problem: Dean et al. note it is easy to construct a discounted LQR whose optimal controller does not stabilize the true system ✅[^3], and in the lab `γ = 0.9` on the unstable heat-source system gave `ρ(A − BK) = 1.0108` ✅[^12]. Recht adds that large discount factors make RL methods brittle and turn `γ` into a hyperparameter to tune ✅[^2].
7. **Choosing `Q` and `R`.** The cost is the designer's to pick: in Recht's double-integrator instance, changing the input weight changes the character of the controller, trading energy against speed ✅[^2]. Only the ratio matters for the gain: `Q = 0.001·I, R = I` and `Q = I, R = 1000·I` gave gains equal to within `9.0e-15` ✅[^12]. Lab with `Q = I`: `R = 0.01` pushed with a peak force of 0.614 and stayed within 0.05 of the target from step 5; `R = 100` pushed with 0.079 and got there at step 11 ✅[^12].

### LQR as a baseline for reinforcement learning
All contenders get the same oracle: run a policy on the system for some steps and observe the states and costs; the budget is the number of time steps simulated ✅[^2].
- **Nominal (certainty-equivalent) control** fits `(Â, B̂)` by least squares, `min Σ‖x_{t+1} − A x_t − B u_t‖²`, on rollouts driven by random inputs, then solves the Riccati equation as if the fit were exact ✅[^2] ✅[^3]. Least squares is the one in `machine-learning/supervised-learning/linear-regression.md`.
- **Robust (Coarse-ID) control** also estimates how far the fit may be from the truth, for example by bootstrap, and designs a controller that stays stable for every system within that distance ✅[^3].
- **ADP (approximate dynamic programming)** estimates the quadratic Q-function from data, for example with LSTD (least-squares temporal difference) or LSPI (least-squares policy iteration) ✅[^2].
- **Direct policy search** tunes the gain `K` from measured costs only: policy gradient (REINFORCE) or random search ✅[^2].

1. **Equations per sample.** A model fit gets `n` equations, one per state coordinate, from each time step; ADP gets one, which Recht gives as a reason ADP makes less efficient use of samples ✅[^2]. The bounds point the same way, with the caveat that comparing worst-case upper bounds is only suggestive: Coarse-ID's relative cost gap shrinks like `√((n + p)/T)` after `T` samples (up to log factors and system constants), while the LSTD bound for the value function scales like `√(n²/T)` ✅[^2]. Example: `n = 10`, `p = 1`, `T = 1100` gives `√(11/1100) = 0.10` against `√(100/1100) = 0.30`.
2. **Nominal control can silently fail.** With few samples the fit can estimate an unstable mode as stable, and the controller then under-acts on it ✅[^2]. On a marginally unstable three-node system, Dean et al. found the nominal controller stabilizing in roughly 80 of 100 trials after 60 rollouts, with no warning when it failed, while robust synthesis reports the problem as infeasible when the uncertainty is too large; when it does stabilize, the nominal controller often beats the robust ones ✅[^3]. The lab reproduced 79/100 ✅[^12].
3. **Policy gradient on the gain.** For `u = −Kx` and random start states, `C(K)` has the exact gradient `∇C(K) = 2((R + BᵀP_KB)K − BᵀP_KA)Σ_K`, where `Σ_K = E Σ_t x_t x_tᵀ` sums the state correlation over the run ✅[^4]; the lab's formula matched finite differences, `[−2.1176, −5.5203]` at `K = [0.3, 0.9]` ✅[^12]. `C(K)` is not convex in general (for `n ≥ 3` there are instances where the midpoint of two finite-cost gains has infinite cost) and is infinite wherever `A − BK` is unstable, yet it is gradient dominated, so gradient descent from a stabilizing start converges to the global optimum; Fazel et al. also prove polynomial sample complexity for a model-free version that estimates the gradient from perturbed rollouts ✅[^4]. The step rule itself is plain gradient descent (`machine-learning/foundations/gradient-descent.md`); sampled policy-gradient estimators are in `policy-gradients-and-ppo.md`.
4. **Random search.** Perturb the gain by `σ` along random directions `δ_i`, measure the rollout costs `J(K + σδ_i)` and `J(K − σδ_i)`, and step along the average of `(J(K + σδ_i) − J(K − σδ_i))/(2σ) · δ_i`, a finite-difference gradient estimate ✅[^2]; ARS (augmented random search) V1 also scales each step by the standard deviation of the costs collected for it ✅[^11]. Gradient estimates from random perturbations target a smoothed objective `E[J(K + σδ)]`, which approximates `J` well only for small `σ`, so they are biased for `J` itself ✅[^4]. In the lab, with `σ = 0.1`, the smoothed cost's minimizer had a gap of `1.4e-3`, close to the `1.6e-3` where random search ended after 100,000 samples ✅[^12]. Mania et al. report that ARS is less sample efficient than model-based methods but finds nearly optimal solutions on their LQR instance ✅[^11].
5. **What Recht measured.** On the double integrator, nominal control and LSPI found near-optimal controllers from ten observations, while direct policy search needed many times more samples and policy gradient thousands of times more, and only after adding Adam (an adaptive step-size optimizer) and a baseline ✅[^2]. On the unstable heat-source system (`Q = I`, `R = 1000·I`), model-free methods stayed far from the model-based ones even with 10 times the samples, and LSPI did worse than random search ✅[^2]. Lab version (`Q = I`, where Recht penalizes position only): 10 samples of least squares reached a gap of `1.4e-5`; random search needed 10,000 samples to reach `1.9e-4` ✅[^12].

### Beyond LQR: nonlinear systems, constraints, hidden state
1. **Linearize around a point.** Near an operating point `(x*, u*)` where the system rests (for continuous dynamics `ẋ = f(x, u)`, `f(x*, u*) = 0`), a first-order Taylor expansion gives linear dynamics in the deviations, and the controller becomes `u = u* − K(x − x*)` ✅[^1]. The same derivation balances an acrobot, a cart-pole and a quadrotor ✅[^1]. Around a trajectory instead of a point, the linearization is time-varying, and so are the Riccati solution and the gains (time-varying LQR) ✅[^1].
2. **iLQR (iterative LQR)** (Li and Todorov): from a guessed input and state trajectory, linearize the dynamics and take a quadratic approximation of the cost around it, compute and simulate the time-varying LQR controller to get a new trajectory, and repeat until convergence; one backward Riccati pass and one forward simulation give a second-order update ✅[^7]. Through the Riccati solution it handles only unconstrained problems ✅[^7]. DDP (differential dynamic programming) differs only in using a second-order approximation of the dynamics; Tedrake notes that iLQR usually converges just as quickly and that many papers write DDP when they use iLQR ✅[^7].
3. **MPC.** Measure the state, optimize a trajectory over the next `N` steps from it, execute the first input, let the system move one step, repeat ✅[^7]. With constraints such as `|u| ≤ 1` the closed form is lost, but the finite-horizon problem is convex and can often be solved fast enough at every step ✅[^1]; linear MPC is considered the de-facto generalization of LQR to linear systems with linear constraints ✅[^7]. Replanning from each measured state lets the feedback correct model mismatch and noise ✅[^2]; when stabilizing a fixed point `x*`, a final-value constraint `x[N] = x*` is perhaps the simplest way to guarantee that the next step's problem stays feasible ✅[^7]. MPC with a learned model and random shooting is in `model-based-reinforcement-learning.md`.
4. **LQG (linear–quadratic–Gaussian) and duality.** When only noisy measurements are available, first estimate the state with an observer, then apply state feedback; for linear-Gaussian systems with a quadratic cost this design is optimal (the separation principle), but not in general ✅[^8]. The estimation half is LQR's mirror image: Kalman and Bucy showed that optimal estimation is dual to an optimal control problem, and with the time arrow reversed, LQR's Riccati equation is the Kalman filter's covariance update ✅[^9]. In matrix terms, for measurements `y = Hx + v`: `A ↔ Aᵀ`, `Bᵀ ↔ −H`, and the filter gain is the transposed control gain ✅[^10]; the sign does not matter to the Riccati equation, where `B` appears in pairs ✅[^5]. Lab, process-noise covariance `W`, measurement-noise covariance `V` (the Kalman doc calls them `Q` and `R`): 500 covariance steps agreed with `solve_discrete_are(Aᵀ, Hᵀ, W, V)` to `8.3e-17` ✅[^12].

## Worked example
One script in eight parts, on two systems: the double integrator (`Q = I`, `R = 1`, start `x_0 = [−1, 0]`, one unit left of the target and at rest) and Recht's three-heat-source system `A = [[1.01, 0.01, 0], [0.01, 1.01, 0.01], [0, 0.01, 1.01]]`, `B = I` ✅[^2]. The model-based learner of part 7 is two lines of least squares, and the model-free one is one update line:

```python
Th = np.linalg.lstsq(np.array(Z), np.array(Y), rcond=None)[0].T   # rows of Z: [x_t, u_t]; rows of Y: x_{t+1}
return Th[:, :n], Th[:, n:]                                        # (A_hat, B_hat), then lqr(A_hat, B_hat, Q, R)
K = K - 0.05 * sum((jp - jm) * d[i] for i, (jp, jm) in enumerate(js)) / (4 * js.std())   # random search on K
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-25, numpy 2.5.5, scipy 1.18.1, two runs identical, about 10 seconds ✅[^12]:

```text
== (1) backward Riccati recursion, horizon N = 30, S_N = 0 ==
t=29 ( 1 steps to go): K_t = [0. 0.]  max|S_t - P| = 3.6e+00
t=28 ( 2 steps to go): K_t = [0.  0.5]  max|S_t - P| = 2.1e+00
t=27 ( 3 steps to go): K_t = [0.2857 1.    ]  max|S_t - P| = 6.1e-01
t=25 ( 5 steps to go): K_t = [0.4197 1.2383]  max|S_t - P| = 1.2e-02
t=20 (10 steps to go): K_t = [0.4221 1.2439]  max|S_t - P| = 3.9e-06
t=10 (20 steps to go): K_t = [0.4221 1.2439]  max|S_t - P| = 4.8e-14
t= 0 (30 steps to go): K_t = [0.4221 1.2439]  max|S_t - P| = 7.1e-15
scipy DARE: K = [0.4221 1.2439]  P = [[2.9471, 2.3692], [2.3692, 4.6131]]  eig(A-BK) = [0.378+0.1877j 0.378-0.1877j]
P is a fixed point of the backup: max|backup(P) - P| = 7.1e-15
== (2) value function: predicted cost x0'Px0 vs simulated cost, x0 = [-1, 0] ==
infinite horizon: x0'Px0 = 2.947123  simulated 300 steps of u = -Kx: 2.947123
horizon 3: x0'S_0x0 = 2.7143  time-varying gains 2.7143  static K_inf 2.8262
== (3) LQR vs hand-tuned PD gains u = -(kp*position + kd*velocity), from x0 = [-1, 0] ==
PD gentle    K=[0.1 0.5]  rho(A-BK)=0.775  cost=     4.177  peak|u|=    0.1  in band from step 9
PD medium    K=[0.3 0.9]  rho(A-BK)=0.632  cost=     3.053  peak|u|=    0.3  in band from step 8
PD deadbeat  K=[1. 2.]  rho(A-BK)=0.000  cost=         5  peak|u|=      1  in band from step 2
LQR          K=[0.422 1.244]  rho(A-BK)=0.422  cost=     2.947  peak|u|=  0.422  in band from step 5
PD unstable  K=[0.6 0.5]  rho(A-BK)=1.049  cost= 2.806e+13  peak|u|=8.43e+05  in band from step 301
== (4) the weights: Q = I, R varied ==
R=  0.01  K=[0.614 1.61 ]  rho=0.380  peak|u|=0.614  in band from step  5  sum x'Qx=2.62
R=  1.00  K=[0.422 1.244]  rho=0.422  peak|u|=0.422  in band from step  5  sum x'Qx=2.72
R=100.00  K=[0.079 0.448]  rho=0.795  peak|u|=0.079  in band from step 11  sum x'Qx=4.56
== (5) policy iteration (evaluate K by a Lyapunov equation, then improve it), from PD gentle ==
iteration 0: K = [0.1 0.5]  cost - optimal = 1.16e+01
iteration 1: K = [0.363131 1.300505]  cost - optimal = 1.58e-01
iteration 2: K = [0.423464 1.247782]  cost - optimal = 9.87e-05
iteration 3: K = [0.422081 1.243931]  cost - optimal = 7.39e-11
iteration 4: K = [0.422082 1.243929]  cost - optimal = 1.78e-15
value iteration from S = 0 needs 17 backups to reach max|S - P| < 1e-10
== (6) unstable 'data-center' system (3 heat sources), B = I, Q = I, R = 1000 I ==
rho(A) = 1.0241  LQR: diag(K) = [0.0437 0.045  0.0437]  rho(A-BK) = 0.9685
|x_300| from x0 = [1,1,1]: open loop 2189.4  LQR 2.39e-05
discount gamma=0.99: diag(K) = [0.0378 0.0392 0.0378]  rho(A-BK) on the real system = 0.9736
discount gamma=0.95: diag(K) = [0.0202 0.0213 0.0202]  rho(A-BK) on the real system = 0.9948
discount gamma=0.9: diag(K) = [0.0102 0.0105 0.0102]  rho(A-BK) on the real system = 1.0108
== (7a) nominal control on the same system (Q = 0.001 I, R = I): least squares from N rollouts of 6 steps ==
same gain as Q = I, R = 1000 I: max|K difference| = 9.0e-15
N=  5 rollouts: stabilizes the true system in  20/100 trials, median (cost - optimal)/optimal = 1.818
N= 20 rollouts: stabilizes the true system in  41/100 trials, median (cost - optimal)/optimal = 0.721
N= 60 rollouts: stabilizes the true system in  79/100 trials, median (cost - optimal)/optimal = 0.436
N=200 rollouts: stabilizes the true system in  98/100 trials, median (cost - optimal)/optimal = 0.122
== (7b) double integrator: model-based vs model-free, relative gap (C(K) - C*)/C*, 10 seeds ==
model-based,     10 samples: median gap 1.4e-05  worst 9.8e-05
model-based,    100 samples: median gap 2.2e-06  worst 6.5e-06
random search,    160 samples: stabilizing  3/10  median gap inf
random search,   1040 samples: stabilizing 10/10  median gap 1.3e+00
random search,  10000 samples: stabilizing 10/10  median gap 1.9e-04
random search, 100000 samples: stabilizing 10/10  median gap 1.6e-03
minimizer of the expected 10-step cost         : K = [0.4221 1.2439]  gap 3.9e-09
minimizer of the same cost smoothed by sigma=0.1: K = [0.4437 1.2802]  gap 1.4e-03
== (8) cross-checks ==
continuous-time double integrator (CARE): K = [1.     1.7321]  S = [[1.7321, 1.0], [1.0, 1.7321]]
Kalman covariance after 500 steps vs DARE(A', H', W, V): max diff 8.3e-17  Kalman gain vs dual LQR gain': max diff 5.6e-17
policy gradient at K = [0.3, 0.9]: formula [-2.1176 -5.5203]  finite differences [-2.1176 -5.5203]  |gradient at K_inf| = 1.3e-14
unstable mode the input cannot reach: solve_discrete_are raised LinAlgError: Failed to find a finite solution.
```

<details><summary>Full script (prints the output above)</summary>

```python
# The linear-quadratic regulator (LQR) in numpy + scipy:
# (1) the backward Riccati recursion on a double integrator, checked against scipy's DARE solver;
# (2) the value function x'Px checked by simulation; (3) LQR vs hand-tuned PD gains; (4) the weights Q and R;
# (5) policy iteration; (6) an unstable system, and what discounting does to it;
# (7) model-based (least squares + Riccati) vs model-free (random search on the gain);
# (8) cross-checks: the continuous-time solver, the Kalman-filter duality, the policy-gradient formula, a DARE failure.
import numpy as np
from scipy import linalg, optimize

def riccati_step(S, A, B, Q, R):            # one Bellman backup on V(x) = x'Sx: returns S one step earlier, gain K
    K = np.linalg.solve(R + B.T @ S @ B, B.T @ S @ A)
    return Q + A.T @ S @ A - A.T @ S @ B @ K, K

def lqr(A, B, Q, R):                        # infinite horizon: scipy solves the DARE, the gain follows
    P = linalg.solve_discrete_are(A, B, Q, R)
    return np.linalg.solve(R + B.T @ P @ B, B.T @ P @ A), P

def rho(M):                                 # spectral radius: < 1 means x -> 0
    return max(abs(np.linalg.eigvals(M))) if np.all(np.isfinite(M)) else np.inf

def cost(K, A, B, Q, R, S0):                # infinite-horizon cost of u = -Kx, E[x0 x0'] = S0 (Lyapunov equation)
    if rho(A - B @ K) >= 1:
        return np.inf
    return np.trace(linalg.solve_discrete_lyapunov((A - B @ K).T, Q + K.T @ R @ K) @ S0)

def simulate(K, A, B, Q, R, x0, steps):     # K: one gain, or a list of time-varying gains
    x, J, umax, settle = x0.copy(), 0.0, 0.0, 0
    for t in range(steps):
        u = -(K[t] if isinstance(K, list) else K) @ x
        J += x @ Q @ x + u @ R @ u
        umax = max(umax, abs(u).max())
        x = A @ x + B @ u
        settle = settle if abs(x[0]) < 0.05 else t + 2   # first step from which |position| stays < 0.05
    return J, umax, settle

A = np.array([[1., 1.], [0., 1.]]); B = np.array([[0.], [1.]])   # position, velocity; u = force
Q, R, x0 = np.eye(2), np.eye(1), np.array([-1., 0.])
K_inf, P = lqr(A, B, Q, R)
print("== (1) backward Riccati recursion, horizon N = 30, S_N = 0 ==")
S, gains = np.zeros((2, 2)), []
for t in range(29, -1, -1):
    S, K = riccati_step(S, A, B, Q, R); gains.insert(0, K)
    if t in (29, 28, 27, 25, 20, 10, 0):
        print(f"t={t:2d} ({30 - t:2d} steps to go): K_t = {np.round(K[0], 4)}  max|S_t - P| = {abs(S - P).max():.1e}")
print(f"scipy DARE: K = {np.round(K_inf[0], 4)}  P = {np.round(P, 4).tolist()}  eig(A-BK) = {np.round(np.linalg.eigvals(A - B @ K_inf), 4)}")
print(f"P is a fixed point of the backup: max|backup(P) - P| = {abs(riccati_step(P, A, B, Q, R)[0] - P).max():.1e}")

print("== (2) value function: predicted cost x0'Px0 vs simulated cost, x0 = [-1, 0] ==")
print(f"infinite horizon: x0'Px0 = {x0 @ P @ x0:.6f}  simulated 300 steps of u = -Kx: {simulate(K_inf, A, B, Q, R, x0, 300)[0]:.6f}")
S3, g3 = np.zeros((2, 2)), []
for _ in range(3):
    S3, K = riccati_step(S3, A, B, Q, R); g3.insert(0, K)
print(f"horizon 3: x0'S_0x0 = {x0 @ S3 @ x0:.4f}  time-varying gains {simulate(g3, A, B, Q, R, x0, 3)[0]:.4f}"
      f"  static K_inf {simulate(K_inf, A, B, Q, R, x0, 3)[0]:.4f}")

print("== (3) LQR vs hand-tuned PD gains u = -(kp*position + kd*velocity), from x0 = [-1, 0] ==")
for name, K in (("PD gentle   ", [[0.1, 0.5]]), ("PD medium   ", [[0.3, 0.9]]), ("PD deadbeat ", [[1.0, 2.0]]),
                ("LQR         ", K_inf.tolist()), ("PD unstable ", [[0.6, 0.5]])):
    K = np.array(K); J, umax, settle = simulate(K, A, B, Q, R, x0, 300)
    print(f"{name} K={np.round(K[0], 3)}  rho(A-BK)={rho(A - B @ K):.3f}  cost={J:10.4g}  peak|u|={umax:7.3g}  in band from step {settle}")

print("== (4) the weights: Q = I, R varied ==")
for r in (0.01, 1.0, 100.0):
    K, _ = lqr(A, B, Q, r * np.eye(1)); J, umax, settle = simulate(K, A, B, Q, 0 * R, x0, 300)
    print(f"R={r:6.2f}  K={np.round(K[0], 3)}  rho={rho(A - B @ K):.3f}  peak|u|={umax:.3f}  in band from step {settle:2d}  sum x'Qx={J:.2f}")

print("== (5) policy iteration (evaluate K by a Lyapunov equation, then improve it), from PD gentle ==")
K, C_opt = np.array([[0.1, 0.5]]), cost(K_inf, A, B, Q, R, np.eye(2))
for i in range(5):
    PK = linalg.solve_discrete_lyapunov((A - B @ K).T, Q + K.T @ R @ K)
    print(f"iteration {i}: K = {np.round(K[0], 6)}  cost - optimal = {cost(K, A, B, Q, R, np.eye(2)) - C_opt:.2e}")
    K = np.linalg.solve(R + B.T @ PK @ B, B.T @ PK @ A)
S, k = np.zeros((2, 2)), 0
while abs(S - P).max() > 1e-10:
    S, _ = riccati_step(S, A, B, Q, R); k += 1
print(f"value iteration from S = 0 needs {k} backups to reach max|S - P| < 1e-10")

print("== (6) unstable 'data-center' system (3 heat sources), B = I, Q = I, R = 1000 I ==")
AL = np.array([[1.01, 0.01, 0], [0.01, 1.01, 0.01], [0, 0.01, 1.01]]); BL, QL, RL = np.eye(3), np.eye(3), 1000 * np.eye(3)
KL, _ = lqr(AL, BL, QL, RL)
print(f"rho(A) = {rho(AL):.4f}  LQR: diag(K) = {np.round(np.diag(KL), 4)}  rho(A-BK) = {rho(AL - BL @ KL):.4f}")
print(f"|x_300| from x0 = [1,1,1]: open loop {np.linalg.norm(np.linalg.matrix_power(AL, 300) @ np.ones(3)):.1f}"
      f"  LQR {np.linalg.norm(np.linalg.matrix_power(AL - BL @ KL, 300) @ np.ones(3)):.2e}")
for g in (0.99, 0.95, 0.9):
    Pg = linalg.solve_discrete_are(np.sqrt(g) * AL, BL, QL, RL / g)    # discounted LQR: P from DARE(sqrt(g) A, B, Q, R/g),
    Kg = g * np.linalg.solve(RL + g * BL.T @ Pg @ BL, BL.T @ Pg @ AL)   # but the gain is g (R + g B'PB)^-1 B'PA
    print(f"discount gamma={g}: diag(K) = {np.round(np.diag(Kg), 4)}  rho(A-BK) on the real system = {rho(AL - BL @ Kg):.4f}")

print("== (7a) nominal control on the same system (Q = 0.001 I, R = I): least squares from N rollouts of 6 steps ==")
def sysid(A, B, N, T, sw, rng):              # excite with u ~ N(0, I) from x0 = 0, fit [A B] by least squares
    n, p = B.shape; Z, Y = [], []
    for _ in range(N):
        x = np.zeros(n)
        for _ in range(T):
            u = rng.standard_normal(p); x2 = A @ x + B @ u + sw * rng.standard_normal(n)
            Z.append(np.r_[x, u]); Y.append(x2); x = x2
    Th = np.linalg.lstsq(np.array(Z), np.array(Y), rcond=None)[0].T
    return Th[:, :n], Th[:, n:]
QD, RD = 1e-3 * np.eye(3), np.eye(3)
print(f"same gain as Q = I, R = 1000 I: max|K difference| = {abs(lqr(AL, BL, QD, RD)[0] - KL).max():.1e}")
CD = cost(KL, AL, BL, QD, RD, np.eye(3))
for N in (5, 20, 60, 200):
    c = [cost(lqr(*sysid(AL, BL, N, 6, 1.0, np.random.default_rng(1000 + s)), QD, RD)[0], AL, BL, QD, RD, np.eye(3))
         for s in range(100)]
    ok = [x for x in c if np.isfinite(x)]
    print(f"N={N:3d} rollouts: stabilizes the true system in {len(ok):3d}/100 trials, median (cost - optimal)/optimal = {np.median(ok) / CD - 1:.3f}")

print("== (7b) double integrator: model-based vs model-free, relative gap (C(K) - C*)/C*, 10 seeds ==")
C_opt, L = cost(K_inf, A, B, Q, R, np.eye(2)), 10
for N in (1, 10):
    gaps = [cost(lqr(*sysid(A, B, N, L, 1e-2, np.random.default_rng(s)), Q, R)[0], A, B, Q, R, np.eye(2)) / C_opt - 1
            for s in range(10)]
    print(f"model-based, {N * L:6d} samples: median gap {np.median(gaps):.1e}  worst {max(gaps):.1e}")
def rollout(K, rng):                         # model-free oracle: run the gain for L steps, return the summed cost
    x, J = rng.standard_normal(2), 0.0
    for _ in range(L):
        u = -K @ x; J += x @ x + u @ u; x = A @ x + B @ u + 1e-2 * rng.standard_normal(2)
    return J
budgets, res = (160, 1040, 10000, 100000), {}   # multiples of the 80 samples per iteration
for seed in range(10):                       # random search: 4 directions, step scaled by the std of the costs
    rng, K, n, ci = np.random.default_rng(seed), np.zeros((1, 2)), 0, 0
    while ci < len(budgets):
        d, js = rng.standard_normal((4, 1, 2)), []
        for i in range(4):
            s = rng.integers(1 << 30)        # same start state and noise for the +/- pair
            js.append((rollout(K + 0.1 * d[i], np.random.default_rng(s)), rollout(K - 0.1 * d[i], np.random.default_rng(s))))
        js = np.array(js)
        K = K - 0.05 * sum((jp - jm) * d[i] for i, (jp, jm) in enumerate(js)) / (4 * js.std())
        n += 8 * L
        while ci < len(budgets) and n >= budgets[ci]:
            res.setdefault(budgets[ci], []).append(cost(K, A, B, Q, R, np.eye(2)) / C_opt - 1); ci += 1
for b in budgets:
    g = np.array(res[b]); ok = np.isfinite(g)
    print(f"random search, {b:6d} samples: stabilizing {ok.sum():2d}/10  median gap {np.median(g):.1e}")
def expected_rollout(k):                    # exact expected value of rollout(): the objective random search is given
    K = k.reshape(1, 2); Acl, M, Sx, J = A - B @ K, Q + K.T @ R @ K, np.eye(2), 0.0
    for _ in range(L):
        J += np.trace(M @ Sx); Sx = Acl @ Sx @ Acl.T + 1e-4 * np.eye(2)
    return J
z, w = np.polynomial.hermite_e.hermegauss(20); w = w / w.sum()   # quadrature for E over delta ~ N(0, I)
def smoothed(k):                             # what the +/-0.1 perturbations really follow: E[J(K + 0.1 delta)]
    return sum(w[i] * w[j] * expected_rollout(k + 0.1 * np.array([z[i], z[j]])) for i in range(20) for j in range(20))
for name, f in ((f"expected {L}-step cost         ", expected_rollout), (f"same cost smoothed by sigma=0.1", smoothed)):
    kf = optimize.minimize(f, K_inf[0], method="Nelder-Mead", options={"xatol": 1e-10, "fatol": 1e-12}).x
    print(f"minimizer of the {name}: K = {np.round(kf, 4)}  gap {cost(kf[None], A, B, Q, R, np.eye(2)) / C_opt - 1:.1e}")

print("== (8) cross-checks ==")
Ac = np.array([[0., 1.], [0., 0.]]); Sc = linalg.solve_continuous_are(Ac, B, Q, R)
print(f"continuous-time double integrator (CARE): K = {np.round((B.T @ Sc)[0], 4)}  S = {np.round(Sc, 4).tolist()}")
H, W, V, Sig = np.array([[1., 0.]]), 0.01 * np.eye(2), np.eye(1), np.eye(2)
for _ in range(500):                         # Kalman filter: covariance of the one-step prediction
    Sig = A @ Sig @ A.T - A @ Sig @ H.T @ np.linalg.solve(H @ Sig @ H.T + V, H @ Sig @ A.T) + W
Kd, Pd = lqr(A.T, H.T, W, V)                 # the dual LQR problem: A -> A', B -> H'
print(f"Kalman covariance after 500 steps vs DARE(A', H', W, V): max diff {abs(Sig - Pd).max():.1e}"
      f"  Kalman gain vs dual LQR gain': max diff {abs(A @ Sig @ H.T @ np.linalg.inv(H @ Sig @ H.T + V) - Kd.T).max():.1e}")
def grad(K):                                 # exact policy gradient: 2((R + B'P_K B)K - B'P_K A) Sigma_K
    PK = linalg.solve_discrete_lyapunov((A - B @ K).T, Q + K.T @ R @ K)
    SK = linalg.solve_discrete_lyapunov(A - B @ K, np.eye(2))
    return 2 * ((R + B.T @ PK @ B) @ K - B.T @ PK @ A) @ SK
K, e = np.array([[0.3, 0.9]]), 1e-6
fd = [(cost(K + e * np.eye(2)[[j]], A, B, Q, R, np.eye(2)) - cost(K - e * np.eye(2)[[j]], A, B, Q, R, np.eye(2))) / (2 * e) for j in (0, 1)]
print(f"policy gradient at K = [0.3, 0.9]: formula {np.round(grad(K)[0], 4)}  finite differences {np.round(fd, 4)}"
      f"  |gradient at K_inf| = {np.linalg.norm(grad(K_inf)):.1e}")
try:                                         # an unstable mode (1.1) that the input cannot reach
    linalg.solve_discrete_are(np.diag([1.1, 0.5]), B, Q, R)
except linalg.LinAlgError as err:
    print(f"unstable mode the input cannot reach: solve_discrete_are raised LinAlgError: {err}")
```

</details>

Reading it, part by part:
- **(1)–(2) Recursion and value.** The gains start at zero (no future), pass `[0, 0.5]` and `[0.2857, 1]` as computed by hand, and from 10 steps to go match scipy's DARE gain to four decimals; scipy's `P` is a fixed point of the hand-written backup to `7.1e-15`. The predicted cost `x_0ᵀPx_0 = 2.947123` is what 300 simulated steps cost.
- **(3) PD gains.** LQR has the lowest cost (2.947) without being the fastest. The deadbeat gain `[1, 2]` puts both closed-loop eigenvalues at 0, so the cart is on the mark from step 2, but its push of 1 makes it the most expensive stable gain (5, 70 % more); the gentle gain barely pushes, settles at step 9 and costs 42 % more; the medium gain comes closest (3.053, 3.6 % more). `[0.6, 0.5]` looks like the others but has `kp > kd`, `ρ = 1.049`, and diverges. LQR is optimal only for the cost it was given: rank by time-to-target and deadbeat wins.
- **(4) Weights.** Raising `R` from 0.01 to 100 cut the gain from `[0.614, 1.61]` to `[0.079, 0.448]` and the peak push 8-fold, at the price of a slower closed loop (`ρ` 0.380 → 0.795, on target from step 5 → 11) and 74 % more state cost (2.62 → 4.56).
- **(5) Policy vs value iteration.** Each policy-iteration step did better than squaring the gap (`1.58e-1`, `9.87e-5`, `7.39e-11`), while value iteration from `S = 0` needed 17 backups for `1e-10`.
- **(6) Unstable system.** Without control the state grows to 2189 in 300 steps; small LQR gains (about 0.044 per node) bring `ρ` to 0.9685 and the state to `2.4e-5`. With `γ = 0.9` the discounted problem sees `√0.9 · 1.0241 = 0.972`, a stable system, so the optimal gains drop to about 0.01 and the real system diverges (`ρ = 1.0108`); `γ = 0.95` still stabilizes, barely (0.9948).
- **(7a) Nominal control.** With 5, 20, 60 and 200 rollouts of 6 steps (unit input and noise variance), the nominal gain stabilized the true system in 20, 41, 79 and 98 of 100 trials; the median gap is over the stabilizing trials only.
- **(7b) Model-based vs model-free.** One 10-step rollout of least squares (gap `1.4e-5`) beat random search at 10,000 samples (`1.9e-4`): 1000 times the samples for a 14 times larger gap. Random search started at `K = 0`, which leaves both eigenvalues at 1, so after 160 samples (two iterations of 80) 7 of 10 runs still had infinite true cost. Its gap then rose from `1.9e-4` to `1.6e-3`: the expected 10-step objective is minimized at `K_inf` (gap `3.9e-9`), but the `σ = 0.1` smoothed objective is minimized at `[0.4437, 1.2802]` (gap `1.4e-3`).
- **(8) Cross-checks.** scipy's continuous solver gives Tedrake's `K = [1, √3]`; the Kalman covariance equals the dual DARE solution and the predictor-form Kalman gain equals the transposed dual LQR gain; the policy-gradient formula equals finite differences and vanishes at `K_inf` (`1.3e-14`); a system whose unstable mode (1.1) the input cannot reach makes the DARE solver fail loudly.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Last step with no terminal cost | `K_{N−1} = 0`: the optimal last input is zero | Nothing after the last step rewards a push (`S_N = 0`) ✅[^1]; lab `K_29 = [0, 0]` ✅[^12] |
| Short horizon, constant gain | Suboptimal: 2.8262 vs 2.7143 over 3 steps in the lab | The finite-horizon cost-to-go depends on time ✅[^1]; lab ✅[^12] |
| Gain with `A − BK` unstable | Infinite cost; gradient methods must start from a stabilizing gain | `C(K)` blows up at the stability boundary, and the convergence results assume a finite `C(K_0)` ✅[^4]; lab `[0.6, 0.5]`: 2.8e13 in 300 steps ✅[^12] |
| Random search from `K = 0` on a double integrator | The first iterates have infinite true cost (lab: 7 of 10 after 160 samples) | `K = 0` leaves the open-loop eigenvalues at 1 ✅[^12] |
| Unstable mode the inputs cannot reach | No stabilizing gain; lab: `solve_discrete_are` raised `LinAlgError: Failed to find a finite solution.` ✅[^12] | The solver needs the eigenvalues outside the unit disc to be controllable ✅[^5]; in continuous time a unique positive-definite solution exists exactly when the system is stabilizable ✅[^1] |
| Discount `γ < 1` on an unstable system | The discounted optimum may not stabilize the real system | Dean et al. ✅[^3]; lab `γ = 0.9`: `ρ = 1.0108` ✅[^12] |
| Few samples for system identification | The nominal gain may destabilize, without warning (lab: 20/100 at 5 rollouts) | An unstable mode estimated as stable gets too little control ✅[^2]; nominal synthesis gives no indication ✅[^3]; lab ✅[^12] |
| Other solutions of the Riccati equation | Not positive definite; zero Bellman residual, but unstable controllers | Only the positive-definite solution is a stable fixed point of value iteration ✅[^1] |
| Process noise added | Same gain; the expected cost rises by a constant | With a quadratic cost the noise term does not depend on the inputs ✅[^2] |
| `Q` and `R` scaled by the same factor | Same gain; all costs scale by that factor | Lab: gains equal to `9.0e-15` ✅[^12] |
| Sign convention | Some texts use `u = +Kx` and test `A + BK` | Recht writes `u = −Kx` in his §4 but `A + BK` in his §5.2 stability test ✅[^2]: check the sign before reusing a gain |
| Input limits `|u| ≤ u_max` | The closed-form LQR policy no longer applies | Solve the constrained finite-horizon problem online, as MPC ✅[^1] |
| Fixed smoothing `σ` in random search | Settles at a biased gain (lab: gap `1.4e-3` at `σ = 0.1`) | The estimates target a smoothed cost ✅[^4]; lab ✅[^12] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Riccati with a known model | Exact optimum, closed-form gain, value function `xᵀPx` ✅[^1] | Needs `A` and `B`; linear dynamics, quadratic cost, no constraints |
| Nominal control (least squares + Riccati) | Lab gap `1.4e-5` from 10 samples ✅[^12]; `n` equations per sample ✅[^2] | Can fail to stabilize without warning ✅[^3] |
| Robust Coarse-ID control | Stabilizes whenever the true system is within the estimated error; reports "infeasible" when that error is too large ✅[^3] | Often a higher cost than nominal when nominal stabilizes ✅[^3]; needs an error estimate |
| ADP (LSTD, LSPI) | Near-optimal from ten observations on the double integrator ✅[^2] | One equation per sample; LSPI lost to random search on the unstable system, likely because it needs a stabilizing controller and a tuned discount ✅[^2] |
| Random search on `K` | Trivial to implement ✅[^2]; with whitened states, linear policies reached state-of-the-art results on MuJoCo (a physics simulator) locomotion benchmarks ✅[^2] | Lab: 10,000 samples for gap `1.9e-4` ✅[^12]; alarmingly high variance across seeds ✅[^2] |
| Policy gradient on `K` | Proven to converge globally on LQR ✅[^4] | High-variance gradients and thousands of times the samples of nominal control ✅[^2] |
| MPC | Hard constraints; replanning corrects model errors ✅[^7] ✅[^2] | An optimization at every step; feasibility at the next step must be designed in ✅[^7] |
| iLQR vs DDP | iLQR needs only first-order dynamics and usually converges as fast ✅[^7] | DDP also needs second-order dynamics derivatives ✅[^7] |

## Takeaways
- Before training an RL agent on a continuous-control task, fit a linear model and solve the Riccati equation: it is the baseline to beat, and on LQR it is near-optimal from a handful of samples. [rule-candidate]
- Check `ρ(A − BK) < 1` on the real system, or a robust margin, before deploying a gain computed from an estimated model or a discounted cost. [rule-candidate]
- `solve_discrete_are` returns `P`, not `K`: compute `K = (R + BᵀPB)⁻¹BᵀPA` (for a discounted cost, `γ(R + γBᵀPB)⁻¹BᵀPA`) and confirm the sign convention yourself.
- Tune `Q` against `R` as a ratio: it sets how fast the state settles against how hard the controller pushes.
- For a nonlinear system, try LQR around the operating point or the trajectory (iLQR) first; move to MPC when inputs or states have hard limits.

## Verification status
- Verified: 123 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [Ch. 8 - Linear Quadratic Regulators (Underactuated Robotics)](https://underactuated.mit.edu/lqr.html) — Russ Tedrake, MIT, living (© 2024). Backs: the LQR problem and `Q ⪰ 0`, `R ≻ 0`; quadratic cost-to-go, the Bellman backup and the zero-gradient step; the discrete gain and Riccati difference equation with `S[N] = 0`; the DARE fixed point; continuous gain `R⁻¹BᵀS`, the double-integrator `K = [1, √3]` and `S`; unique solution iff stabilizable; time-dependent finite-horizon cost-to-go; discounted LQR as `DARE(√γA, B, Q, R/γ)` and its gain `γ(R + γBᵀSB)⁻¹BᵀSA`; non-positive-definite Riccati solutions and value iteration; constraints and MPC as a convex problem per step; linearization `u = u_0 − K(x − x_0)` (written `u* − K(x − x*)` here), acrobot, cart-pole, quadrotor; time-varying LQR. [^1]
- [A Tour of Reinforcement Learning: The View from Continuous Control](https://arxiv.org/html/1806.09460v2) — Benjamin Recht, 2018. Backs: the optimal-control problem and RL as unknown dynamics; LQR as a baseline, why linear dynamics and quadratic cost, noise adding a constant; static gain, DARE, eigenvalue condition, quadratic Q-functions converging; the double integrator and heat-source instances; least-squares identification, the misestimated unstable mode; `n` equations vs one per sample, the `√((n+p)/T)` and `√(n²/T)` rates; REINFORCE and random-search estimators, ease of implementation, variance; the experiments (ten observations, thousands of times more samples, Adam and baseline, LSPI vs random search, unsafe); linear policies on MuJoCo; receding-horizon control correcting model mismatch; brittle discount factors; the `u = −Kx` and `A + BK` notation. [^2]
- [On the Sample Complexity of the Linear Quadratic Regulator](https://arxiv.org/html/1710.01688v3) — Dean, Mania, Matni, Recht, Tu, 2017 (v3, 2018). Backs: Coarse-ID control, least squares from Gaussian-excited rollouts, the three-node instance, nominal control stabilizing in roughly 80 of 100 trials at 60 rollouts and failing without warning, robust synthesis reporting infeasibility, nominal often better when stabilizing, discounted LQR that does not stabilize the true system. [^3]
- [Global Convergence of Policy Gradient Methods for the Linear Quadratic Regulator](https://arxiv.org/html/1801.05039v3) — Fazel, Ge, Kakade, Mesbahi, 2018 (v3, 2019). Backs: `C(K)` and the Lyapunov equation for `P_K`; the gradient formula; non-convexity for `n ≥ 3` and infinite cost outside the stable set; gradient domination and global convergence from a finite `C(K_0)`; model-free polynomial sample complexity; convergence of the Riccati recursion from `P_1 = Q`; policy iteration as a Gauss–Newton special case; Gaussian smoothing and biased zeroth-order estimates. [^4]
- [scipy.linalg.solve_discrete_are](https://docs.scipy.org/doc/scipy/reference/generated/scipy.linalg.solve_discrete_are.html) — SciPy community, living (v1.18.0 manual). Backs: the DARE form solved, the existence conditions, the QZ method on the symplectic pencil, `LinAlgError`, the gain computed separately in the example. [^5]
- [scipy.linalg.solve_continuous_are](https://docs.scipy.org/doc/scipy/reference/generated/scipy.linalg.solve_continuous_are.html) — SciPy community, living (v1.18.0 manual). Backs: the CARE (continuous-time algebraic Riccati equation) form solved. [^6]
- [Ch. 10 - Trajectory Optimization (Underactuated Robotics)](https://underactuated.mit.edu/trajopt.html) — Russ Tedrake, MIT, living (© 2024). Backs: the MPC recipe, linear MPC as the generalization of LQR with constraints, receding horizon, recursive feasibility and the final-value constraint; iLQR (Li and Todorov), its second-order update and unconstrained limit; DDP and its relation to iLQR. [^7]
- [Ch. 15 - Output Feedback (aka Pixels-to-Torques), Underactuated Robotics](https://underactuated.mit.edu/output_feedback.html) — Russ Tedrake, MIT, living (© 2024). Backs: observer plus state feedback, optimal for LQG (the separation principle) but not in general. [^8]
- [An Approach to Duality in Nonlinear Filtering](https://ar5iv.labs.arxiv.org/html/1809.10762) — Kim, Taghvaei, Mehta, Meyn, 2018 (ar5iv HTML of arXiv:1809.10762). Backs: Kalman–Bucy duality of estimation and control; LQR's Riccati equation with time reversed is the Kalman covariance update. [^9]
- [Duality-Based Stochastic Policy Optimization for Estimation with Unknown Noise Covariances](https://arxiv.org/html/2210.14878v2) — Talebi, Taghvaei, Mesbahi, 2022 (v2, 2023). Backs: the steady-state correspondence `A ↔ Aᵀ`, `−H ↔ Bᵀ`, filter gain ↔ transposed control gain. [^10]
- [Simple random search provides a competitive approach to reinforcement learning](https://ar5iv.labs.arxiv.org/html/1803.07055) — Mania, Guy, Recht, 2018 (ar5iv HTML of arXiv:1803.07055). Backs: ARS V1 scaling steps by the standard deviation of the rewards; less sample efficient than model-based methods yet nearly optimal on LQR. [^11]
- `machine-learning/lab-setup.md` — the lab where the Riccati recursion, the DARE and CARE checks, the PD and weight comparisons, policy iteration, the unstable and discounted systems, nominal control, random search and the Kalman, policy-gradient and solver-failure cross-checks ran on 2026-11-25. [^12]

## Related
- `machine-learning/reinforcement-learning/markov-decision-processes.md` — Bellman equations and value iteration, of which the Riccati recursion is the quadratic case.
- `machine-learning/reinforcement-learning/model-based-reinforcement-learning.md` — learned nonlinear models, MPC by random shooting, compounding model error.
- `machine-learning/reinforcement-learning/policy-gradients-and-ppo.md` — sampled policy-gradient estimators, baselines and PPO.
- `machine-learning/probabilistic-ml/hidden-markov-models-and-kalman-filters.md` — the Kalman filter, LQR's dual, and the extended Kalman filter for nonlinear systems.
- `machine-learning/foundations/gradient-descent.md` — the step rule behind gradient descent on the gain, and why conditioning matters.
- `machine-learning/supervised-learning/linear-regression.md` — least squares, the system-identification step of nominal control.
