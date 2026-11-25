---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/causal-inference
status: verified
applies-to: ["any"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, causal-inference, causal-discovery, structure-learning, pc-algorithm, markov-equivalence, faithfulness, cpdag, ges, bic, lingam, notears, fci, latent-confounders]
---

# Causal discovery: learning the graph from observational data

## Summary
**TL;DR:** Causal discovery tries to recover the causal DAG (directed acyclic graph) from data instead of drawing it from prior knowledge. Two assumptions link graph and data: the causal Markov condition (the graph's d-separations show up as conditional independences) and faithfulness (no other independences show up). From conditional independences alone you get at best a Markov equivalence class: the skeleton and the v-structures (colliders whose two causes are not adjacent), drawn as a CPDAG (completed partially directed acyclic graph) whose undirected edges could point either way. The PC (Peter–Clark) algorithm finds it with independence tests, GES (greedy equivalence search) with a score such as BIC (Bayesian information criterion); LiNGAM (linear non-Gaussian acyclic model) orients the remaining edges when the noise is non-Gaussian, NOTEARS (Non-combinatorial Optimization via Trace Exponential and Augmented lagRangian for Structure learning) turns the search into smooth optimization, and FCI (fast causal inference) allows hidden confounders. Every output is only as good as its assumptions and its finite-sample tests.
**Use this when:** you have observational data and no trusted causal graph, must judge a graph that an algorithm produced, choose between PC, GES, LiNGAM, NOTEARS and FCI, or need to say what a discovered graph can and cannot claim.
**Not this doc:** reading a given DAG, d-separation and the backdoor criterion → `machine-learning/causal-inference/causal-graphs-and-confounding.md`; estimating an effect once the graph is fixed → `machine-learning/causal-inference/estimating-effects-from-observational-data.md`; randomized experiments, the alternative to discovery → `machine-learning/causal-inference/potential-outcomes-and-experiments.md`.

## Problem
Choosing what to adjust for needs a causal graph, and that graph is normally drawn from domain knowledge (`machine-learning/causal-inference/causal-graphs-and-confounding.md`). When nobody knows the graph and an experiment is too expensive, too slow, unethical or impossible, the only evidence left is the observational data ✅[^1]. But the same data can fit several graphs: in the lab, data from a chain `X → Y → Z` and from a fork `X ← Y → Z` gave the same independence pattern (`X` and `Z` dependent, independent given `Y`), and the chain, the reversed chain and the fork had exactly the same BIC, 3.553 ✅[^15]. An algorithm that prints one fully directed graph from such data is claiming more than the data holds; one that knows the limits prints the edges it cannot orient as undirected.

## Mental model
**Analogy:** working out a building's plumbing from pressure readings only. If two taps stop moving together once you hold the pressure of a third pipe fixed, they have no direct pipe between them: the third pipe sits in between. Repeating this tells you which pipes touch (the skeleton) but not which way the water flows, because a run `A–B–C` shows the same co-movements whether water flows from `A` to `C`, from `C` to `A`, or from `B` to both. The one junction that betrays direction is where two independent supplies feed one outlet: the supplies are unrelated until you hold the outlet fixed, and then they become related. That junction is a collider, and colliders are what a discovery algorithm orients first.

**Artifact:** three structures simulated with 2,000 rows and coefficient 0.8, then the correlation of `X` and `Z` and their partial correlation given `Y` (the correlation left after removing what `Y` explains), with Fisher-z p-values and what the PC algorithm returns; printed by the full script in the Worked example; lab run (`machine-learning/lab-setup.md`), 2026-11-25, numpy 2.5.5, scipy 1.18.1 ✅[^15]:

```text
structure  r(X,Z)  p(X,Z)  r(X,Z|Y)  p(X,Z|Y)  PC output
chain       0.442   0.000     0.006     0.784  X - Y, Y - Z
fork        0.375   0.000    -0.019     0.392  X - Y, Y - Z
collider   -0.017   0.456    -0.397     0.000  X -> Y, Z -> Y
```

Chain and fork give the same pattern and PC leaves both edges undirected; the collider is the only one whose arrows PC can draw.

## How it works
### The assumptions that connect graph and data
1. **Causal Markov condition:** every variable is independent of its non-descendants given its parents; equivalently, d-separation in the graph implies conditional independence in the data ✅[^1]. How to read d-separation off a graph → `machine-learning/causal-inference/causal-graphs-and-confounding.md`. The condition can fail, for example when variables are defined from overlapping parts (`U = X + Y` and `W = Y + Z` are dependent with no causal link between them) or are too coarse-grained ✅[^2].
2. **Faithfulness:** the converse: every independence in the data is one the Markov condition requires ✅[^2]. It fails when effects cancel exactly: if `X` affects `Z` along two paths whose effects undo each other, `X` and `Z` are independent although `X` causes `Z` ✅[^2]. For a linear SEM (structural equation model) the parameter values that violate faithfulness have Lebesgue measure 0 (zero volume in parameter space), but they are possible, so faithfulness is a methodological preference, not a law ✅[^2]. The lab's `cancel` case (`X → Y → Z` with weights 1 and 1, plus `X → Z` with weight −1) is such a violation ✅[^15].
3. **No hidden confounders:** PC assumes no confounder, that is, no unobserved direct common cause of two measured variables ✅[^1].

### Markov equivalence classes and the CPDAG
- **Markov equivalent** graphs have the same d-separations and therefore imply the same conditional independences; the set of all such DAGs is a Markov equivalence class ✅[^1]. All DAGs in one class have the same skeleton (the undirected version of the graph) and the same v-structures (`a → b ← c` with `a`, `c` not adjacent), and the skeleton plus the v-structures determine the class ✅[^3].
- **Example:** `X` and `Z` independent given `Y`, every other pair dependent: the class is `X → Y → Z`, `X ← Y ← Z` and `X ← Y → Z`. `X` and `Z` independent but dependent given `Y`: the class is the single collider `X → Y ← Z` ✅[^2].
- **CPDAG:** the class is drawn as one graph that mixes directed and undirected edges; an undirected edge means members of the class disagree on its direction ✅[^1]. In the lab's six-variable graph the CPDAG keeps `B - E` undirected: `E → B` gives the same skeleton and the same two v-structures ✅[^15].

### The PC algorithm (constraint-based search)
1. **Start** from the complete undirected graph ✅[^1].
2. **Level 0:** remove the edge between every pair that is unconditionally independent, and remember the conditioning set that separated them (its separating set, empty here) ✅[^1].
3. **Level `ℓ` = 1, 2, …** (`ℓ` = size of the conditioning set): for each pair `A`, `B` still joined, test `A ⫫ B | S` for every set `S` of `ℓ` variables adjacent to `A` (or to `B`); remove the edge at the first independence and store `S`. Stop when no joined pair has `ℓ` other neighbours left ✅[^1]. This rests on the fact that, under Markov and faithfulness with no latent confounder, two variables are adjacent exactly when no subset of the others makes them independent ✅[^1]. causal-learn runs the order-independent ("stable") variant by default ✅[^4], as does the lab code.
4. **V-structures:** for each triple `A − B − C` with `A`, `C` not adjacent, orient `A → B ← C` if `B` is not in the separating set of `A` and `C` ✅[^1].
5. **Propagation (Meek's rules),** applied until nothing changes, as causal-learn implements them ✅[^7]: R1 `A → B − C` with `A`, `C` not adjacent gives `B → C` ✅[^1]; R2 `A → C → B` with `A − B` gives `A → B`; R3 `A − C`, `A − E`, `C → B ← E`, `A − B` with `C`, `E` not adjacent gives `A → B` ✅[^7].
6. **Guarantee:** if the independence decisions are correct, PC converges to the true Markov equivalence class in the large-sample limit, assuming Markov, faithfulness, i.i.d. (independent and identically distributed) samples and no unmeasured confounders ✅[^1]. For sparse graphs it runs on at least tens of thousands of variables when the test is cheap ✅[^1], and Kalisch and Bühlmann prove uniform consistency for sparse Gaussian DAGs whose number of nodes grows with the sample size ✅[^8].

**The CI (conditional independence) test.** For linear-Gaussian data the usual test is Fisher's z, which causal-learn calls optimal for that case ✅[^6]. causal-learn computes the partial correlation `r` of `A` and `B` given `S` from the inverse `P` of their correlation sub-matrix as `r = −P_AB / √(P_AA · P_BB)`, then ✅[^5]:

```text
z = ½ · ln((1 + r) / (1 − r))        Fisher's z-transform of r
T = √(n − |S| − 3) · |z|             n = rows, |S| = size of the conditioning set
p = 2 · (1 − Φ(T))                   Φ = standard normal cumulative distribution
```

Example from the lab's first removal: `r = −0.029`, `n = 2000`, `S = {}` gives `z = −0.0290`, `T = √1997 · 0.0290 = 1.296`, `p = 0.195` (0.192 with the unrounded `r`) ✅[^15]. The algorithm treats `p > α` as independent and removes the edge, so the significance level `α` (alpha) is a knob: a smaller `α` removes more edges (risking missing true ones), a larger `α` keeps more (risking extra ones) ✅[^15].

### Score-based search: GES with BIC (outline)
GES starts from the empty graph, repeatedly adds the edge that most improves a score such as BIC, maps the result to its equivalence class, and when no addition helps removes edges one at a time while that improves the score ✅[^1]. causal-learn's GES uses the BIC score by default ✅[^9]. For a linear-Gaussian model the lab's BIC sums, over the nodes `v`, `n · ln(RSS_v / n) + k_v · ln n`, where `RSS_v` is the residual sum of squares of the least-squares fit of `v` on its parents and `k_v` the number of fitted parameters (intercept, one slope per parent, the noise variance); lower is better ✅[^15]. On the chain data the chain, the reversed chain and the fork all scored 3.553 and the collider 437.533 with the same 8 parameters, because only the collider makes `X` and `Z` independent, while the data have `r(X,Z) = 0.442` ✅[^15]. Markov-equivalent DAGs tied, and GES searches over the equivalence classes directly ✅[^1]. In the large-sample limit PC and GES reach the same class under nearly the same assumptions; on finite samples they can differ, and the 2019 review knew no GES-style algorithm for unknown confounders ✅[^1].

### Functional causal models: LiNGAM orients what independences cannot
A functional causal model writes the effect as `Y = f(X, ε)` with the noise `ε` independent of the cause `X`. Fit the model in both directions and test whether the estimated noise is independent of the presumed cause; the direction with independent noise is the plausible one ✅[^1]. Without restrictions on `f` this fails, since an independent noise can be found in both directions ✅[^1]. LiNGAM restricts `f` to linear and needs at most one of `X` and `ε` Gaussian; then the direction is identifiable, while in the linear-Gaussian case the causal asymmetry leaves no footprint in the data ✅[^1]. With non-Gaussian variables, the backward regression's residual is uncorrelated with the regressor by construction but not independent of it ✅[^1]; the lab measures that dependence as `|corr(regressor², residual²)|`, "does the residual's size change with the regressor's size". With `Y = 0.8 X + e`: uniform noise 0.012 forward vs 0.435 backward, the correct direction picked in 100 of 100 datasets; Gaussian noise 0.027 vs 0.035 and 53 of 100, a coin flip ✅[^15].

The multivariate LiNGAM needs a linear process, no unobserved confounders and non-Gaussian disturbances with non-zero variance, and estimates the graph with ICA (independent component analysis) without a known time order ✅[^10]. DirectLiNGAM instead finds the causal order by repeated regression and residual-independence tests ✅[^1]; causal-learn ships ICA-LiNGAM, DirectLiNGAM and others ✅[^11]. Nonlinear extensions exist (the additive noise model and the post-nonlinear model, identifiable except in five specific cases), but current methods for them handle only dozens of variables ✅[^1].

### Continuous optimization: NOTEARS (outline)
Score-based search over DAGs is NP-hard (NP: nondeterministic polynomial time; no polynomial-time algorithm is known), so exact methods are computationally intractable in general, mainly because of the combinatorial acyclicity constraint, whose number of graphs grows superexponentially with the number of nodes ✅[^12]. NOTEARS replaces the constraint "the graph of `W` is a DAG" with one smooth equation ✅[^12]:

```text
h(W) = tr(e^(W ∘ W)) − d = 0      d = number of variables; W = d × d matrix of edge weights (W_ij ≠ 0 means i → j)
                                  W ∘ W = element-wise square, e^(·) = matrix exponential, tr = trace
```

`h(W) = 0` exactly when `W` is acyclic, `h ≥ 0` always, and its gradient is `(e^(W ∘ W))ᵀ ∘ 2W` ✅[^12]. The trace of the exponential counts closed walks in the graph, each weighted by the product of its squared edge weights divided by `k!` for a walk of length `k` ✅[^12]. Lab example: adding `F → A` with weight 1 to the six-variable DAG closes the cycle `A → C → D → F → A`; four starting nodes times `0.8² · 0.9² · 0.6² · 1² / 4! = 0.0311` matches the printed `h = 0.031107`, and the DAG itself gives 0 ✅[^15]. NOTEARS minimizes a least-squares loss with an L1 penalty (the sum of absolute weights, added for a sparse graph) subject to `h(W) = 0` by an augmented Lagrangian, then removes weights below a threshold `ω`; the problem is nonconvex, so it finds stationary points, not guaranteed global optima ✅[^12]. Its benchmark wins can come from "varsortability": in common simulations the marginal variance grows along the causal order, and on standardized data the same continuous methods failed to recover the true DAG or its equivalence class ✅[^13].

### Hidden confounders: FCI (outline)
FCI tolerates, and sometimes detects, unmeasured confounders, and is asymptotically correct when they are present ✅[^1]. It prunes the skeleton like PC, then orients edges like PC but without assuming that every edge is directed one way or the other; an edge end it cannot decide is marked `o`, and a bidirected edge `↔` means at least one unmeasured confounder of the two variables ✅[^1]. Its output is a PAG (partial ancestral graph) ✅[^14]. Allowing latent variables enlarges the equivalence class: the collider pattern `X → Y ← Z` is then also explained by `X ↔ Y ↔ Z`, among others ✅[^2].

### What discovery cannot do from observational data alone
- **Orient every edge** from conditional independences: in general only the equivalence class is identified ✅[^2], and with linear-Gaussian or with discrete data and no assumption on the functions, nothing more ✅[^2].
- **Give confidence intervals:** search based on faithfulness has only pointwise consistency, with no finite-sample error probabilities or confidence intervals for the graph ✅[^1].
- **Survive violated assumptions:** confounders (PC), selection bias, measurement error, and missing data not missing completely at random can all distort the output ✅[^1]; a faithfulness violation produced the lab's confident wrong collider `X → Y ← Z` ✅[^15].
- **Certify itself:** results stable under bootstrap resampling are not thereby correct, and a test of a whole high-dimensional model seldom makes sense ✅[^1]. Known causal relations (a treatment cannot be caused by its effects) both guide some algorithms and give a gold standard to test them against ✅[^1].

## Worked example
One script, numpy and scipy only: PC (skeleton with Fisher-z tests at `α = 0.01`, v-structures, Meek's rules R1–R3) on the three-variable structures; the BIC of four DAGs on the chain data; PC on a six-variable linear-Gaussian DAG (`A → C ← B`, `C → D → F ← E ← B`, 2,000 rows) against its true CPDAG, which is computed by running the same PC code with exact population independences; a sweep over sample size and `α`, 20 datasets per cell; LiNGAM's two-variable test with uniform, Laplace and Gaussian noise; and NOTEARS's `h(W)`. The core of the skeleton search:

```python
for i, j in itertools.permutations(range(d), 2):
    for S in (itertools.combinations(sorted(frozen[i] - {j}), level) if j in adj[i] else []):
        indep, r, p = test(i, j, S)                      # Fisher-z: independent when p > alpha
        if indep:
            adj[i].discard(j); adj[j].discard(i); sepset[frozenset((i, j))] = set(S)
            break
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-25, numpy 2.5.5, scipy 1.18.1, two runs identical; lines 2–5 are the Mental model artifact ✅[^15]:

```text
== 1. three-variable structures, n = 2000, Fisher-z, alpha = 0.01 ==
structure  r(X,Z)  p(X,Z)  r(X,Z|Y)  p(X,Z|Y)  PC output
chain       0.442   0.000     0.006     0.784  X - Y, Y - Z
fork        0.375   0.000    -0.019     0.392  X - Y, Y - Z
collider   -0.017   0.456    -0.397     0.000  X -> Y, Z -> Y
cancel     -0.017   0.444    -0.579     0.000  X -> Y, Z -> Y

== 2. BIC of four DAGs fitted to the chain data (lower is better) ==
  X -> Y -> Z   BIC =     3.553
  X <- Y <- Z   BIC =     3.553
  X <- Y -> Z   BIC =     3.553
  X -> Y <- Z   BIC =   437.533

== 3. PC on a six-variable linear-Gaussian DAG, n = 2000, alpha = 0.01 ==
true DAG   : A -> C, B -> C, B -> E, C -> D, D -> F, E -> F
true CPDAG : A -> C, B -> C, B - E, C -> D, D -> F, E -> F
removed edges and their separating sets:
  A - B  given {}  partial r = -0.029  p = 0.192
  A - E  given {}  partial r =  0.027  p = 0.231
  A - D  given {C}  partial r = -0.011  p = 0.624
  B - D  given {C}  partial r = -0.019  p = 0.407
  C - E  given {B}  partial r =  0.019  p = 0.402
  D - E  given {B}  partial r =  0.035  p = 0.121
  B - F  given {C,E}  partial r =  0.009  p = 0.680
  C - F  given {B,D}  partial r =  0.031  p = 0.167
  A - F  given {B,C}  partial r = -0.011  p = 0.613
PC CPDAG   : A -> C, B -> C, B - E, C -> D, D -> F, E -> F
missing, extra adjacencies, orientation differences vs true CPDAG: (0, 0, 0)

== 4. errors vs true CPDAG, mean over 20 datasets per cell (missing / extra / misoriented) ==
   n    alpha=0.001        alpha=0.01         alpha=0.05         alpha=0.2
   50    2.95 / 0.00 / 1.80   2.00 / 0.10 / 2.55   1.15 / 0.20 / 2.05   0.50 / 0.25 / 1.70
  200    0.45 / 0.00 / 1.10   0.05 / 0.00 / 0.30   0.05 / 0.15 / 0.30   0.05 / 0.65 / 1.35
 1000    0.00 / 0.00 / 0.00   0.00 / 0.00 / 0.00   0.00 / 0.05 / 0.05   0.00 / 0.35 / 0.70
 5000    0.00 / 0.00 / 0.00   0.00 / 0.05 / 0.05   0.00 / 0.10 / 0.20   0.00 / 0.65 / 0.75

== 5. LiNGAM idea on two variables: X -> Y, Y = 0.8 X + e, n = 2000 ==
noise     dep(X, resid Y~X)  p      dep(Y, resid X~Y)  p      correct direction in 100 datasets
uniform        0.012       0.572       0.435       0.001  100/100
Laplace        0.002       0.950       0.413       0.001  100/100
Gaussian       0.027       0.222       0.035       0.127  53/100

== 6. NOTEARS acyclicity function h(W) = trace(exp(W * W)) - d ==
  true DAG                      h = 0.000000
  plus F -> A (weight 0.1, cycle)  h = 0.000311
  plus F -> A (weight 0.5, cycle)  h = 0.007776
  plus F -> A (weight 1.0, cycle)  h = 0.031107
  two nodes, X -> Y only (weight 1)  h = 0.000000
  two nodes, X -> Y -> X (weights 1) h = 1.086161
```

<details><summary>Full script (prints the output above)</summary>

```python
# Causal discovery on simulated linear SEMs (numpy/scipy only): the PC algorithm (skeleton search with Fisher-z
# partial-correlation tests, v-structures, Meek's rules), Markov equivalence, BIC ties, a faithfulness violation,
# sample size and alpha sweeps, LiNGAM's two-variable direction test, NOTEARS's acyclicity function h(W).
import itertools, math
import numpy as np
from scipy import stats
from scipy.linalg import expm

def simulate(names, coef, n, rng):                        # names in causal order; coef[(u, v)] = weight of u -> v
    X = {}
    for v in names:
        X[v] = sum((w * X[u] for (u, t), w in coef.items() if t == v), np.zeros(n)) + rng.normal(size=n)
    return np.column_stack([X[v] for v in names])

def partial_corr(C, i, j, S):                             # from the inverse of the correlation sub-matrix
    P = np.linalg.inv(C[np.ix_([i, j, *S], [i, j, *S])])
    return -P[0, 1] / math.sqrt(P[0, 0] * P[1, 1])

def fisher_z(data, alpha):                                # CI test: "independent" when p > alpha
    n, C = len(data), np.corrcoef(data.T)
    def test(i, j, S):
        r = partial_corr(C, i, j, S)
        p = 2 * (1 - stats.norm.cdf(math.sqrt(n - len(S) - 3) * abs(0.5 * math.log((1 + r) / (1 - r)))))
        return p > alpha, r, p
    return test

def oracle(names, coef):                                  # infinite data: population covariance, exact zeros
    B = np.zeros((len(names), len(names)))
    for (u, v), w in coef.items():
        B[names.index(v), names.index(u)] = w
    A = np.linalg.inv(np.eye(len(names)) - B); C = A @ A.T
    return lambda i, j, S: (abs(partial_corr(C, i, j, S)) < 1e-9, None, None)

def pc(d, test, log=None):
    adj, sepset, level = {i: set(range(d)) - {i} for i in range(d)}, {}, 0
    while any(len(adj[i]) - 1 >= level for i in range(d)):  # 1. skeleton, conditioning sets of growing size
        frozen = {i: set(adj[i]) for i in range(d)}          # PC-stable: neighbours fixed within a level
        for i, j in itertools.permutations(range(d), 2):
            for S in (itertools.combinations(sorted(frozen[i] - {j}), level) if j in adj[i] else []):
                indep, r, p = test(i, j, S)
                if indep:
                    adj[i].discard(j); adj[j].discard(i); sepset[frozenset((i, j))] = set(S)
                    if log is not None: log.append((i, j, S, r, p))
                    break
        level += 1
    arrows = set()                                        # (u, v): arrowhead at v
    for k in range(d):                                    # 2. v-structures i -> k <- j
        for i, j in itertools.combinations(sorted(adj[k]), 2):
            if j not in adj[i] and k not in sepset[frozenset((i, j))]:
                arrows |= {(i, k), (j, k)}
    und = lambda a, b: b in adj[a] and (a, b) not in arrows and (b, a) not in arrows
    to = lambda a, b: (a, b) in arrows and (b, a) not in arrows
    changed = True
    while changed:                                        # 3. Meek's rules R1-R3 on undirected edges
        changed = False
        for a, b in itertools.permutations(range(d), 2):
            if und(a, b) and (any(to(c, a) and b not in adj[c] for c in adj[a])                   # R1
                              or any(to(a, c) and to(c, b) for c in adj[a] & adj[b])              # R2
                              or any(c not in adj[e] and und(a, c) and und(a, e) and to(c, b) and to(e, b)
                                     for c, e in itertools.combinations(sorted(adj[a] & adj[b]), 2))):  # R3
                arrows.add((a, b)); changed = True
    return adj, arrows

def edges(names, adj, arrows):                            # {frozenset pair: printed edge}
    out = {}
    for i, j in itertools.combinations(range(len(names)), 2):
        if j in adj[i]:
            a, b = (i, j) in arrows, (j, i) in arrows
            out[frozenset((i, j))] = (f"{names[i]} <-> {names[j]}" if a and b else f"{names[i]} -> {names[j]}" if a
                                      else f"{names[j]} -> {names[i]}" if b else f"{names[i]} - {names[j]}")
    return out

def compare(E, T):                                        # missing / extra adjacencies, orientation differences
    return len(T.keys() - E.keys()), len(E.keys() - T.keys()), sum(E[k] != T[k] for k in E.keys() & T.keys())
show = lambda E: ", ".join(E.values())

print("== 1. three-variable structures, n = 2000, Fisher-z, alpha = 0.01 ==")
print("structure  r(X,Z)  p(X,Z)  r(X,Z|Y)  p(X,Z|Y)  PC output")
three = {"chain":    (["X", "Y", "Z"], {("X", "Y"): 0.8, ("Y", "Z"): 0.8}),
         "fork":     (["Y", "X", "Z"], {("Y", "X"): 0.8, ("Y", "Z"): 0.8}),
         "collider": (["X", "Z", "Y"], {("X", "Y"): 0.8, ("Z", "Y"): 0.8}),
         "cancel":   (["X", "Y", "Z"], {("X", "Y"): 1.0, ("Y", "Z"): 1.0, ("X", "Z"): -1.0})}
for name, (order, coef) in three.items():
    data = simulate(order, coef, 2000, np.random.default_rng(0))[:, [order.index(v) for v in "XYZ"]]
    test = fisher_z(data, 0.01)
    _, r0, p0 = test(0, 2, ()); _, r1, p1 = test(0, 2, (1,))
    print(f"{name:<9} {r0:7.3f} {p0:7.3f} {r1:9.3f} {p1:9.3f}  {show(edges('XYZ', *pc(3, test)))}")

print("\n== 2. BIC of four DAGs fitted to the chain data (lower is better) ==")
data = simulate(["X", "Y", "Z"], three["chain"][1], 2000, np.random.default_rng(0))
def bic(parents):                                         # Gaussian BIC: one least-squares fit per node
    total, n = 0.0, len(data)
    for v, ps in parents.items():
        A = np.column_stack([np.ones(n)] + [data[:, "XYZ".index(p)] for p in ps]); y = data[:, "XYZ".index(v)]
        rss = ((y - A @ np.linalg.lstsq(A, y, rcond=None)[0]) ** 2).sum()
        total += n * math.log(rss / n) + (A.shape[1] + 1) * math.log(n)
    return total
for name, par in [("X -> Y -> Z", {"X": "", "Y": "X", "Z": "Y"}), ("X <- Y <- Z", {"Z": "", "Y": "Z", "X": "Y"}),
                  ("X <- Y -> Z", {"Y": "", "X": "Y", "Z": "Y"}), ("X -> Y <- Z", {"X": "", "Z": "", "Y": "XZ"})]:
    print(f"  {name}   BIC = {bic(par):9.3f}")

print("\n== 3. PC on a six-variable linear-Gaussian DAG, n = 2000, alpha = 0.01 ==")
names = list("ABCDEF")
coef = {("A", "C"): 0.8, ("B", "C"): -0.7, ("C", "D"): 0.9, ("B", "E"): 0.8, ("D", "F"): 0.6, ("E", "F"): -0.7}
true_cpdag = edges(names, *pc(6, oracle(names, coef)))
print("true DAG   :", ", ".join(f"{u} -> {v}" for u, v in sorted(coef)))
print("true CPDAG :", show(true_cpdag))
log = []
est = edges(names, *pc(6, fisher_z(simulate(names, coef, 2000, np.random.default_rng(1)), 0.01), log))
print("removed edges and their separating sets:")
for i, j, S, r, p in log:
    a, b = sorted((names[i], names[j]))
    print(f"  {a} - {b}  given {{{','.join(names[s] for s in S)}}}  partial r = {r:6.3f}  p = {p:.3f}")
print("PC CPDAG   :", show(est))
print("missing, extra adjacencies, orientation differences vs true CPDAG:", compare(est, true_cpdag))

print("\n== 4. errors vs true CPDAG, mean over 20 datasets per cell (missing / extra / misoriented) ==")
print("   n    alpha=0.001        alpha=0.01         alpha=0.05         alpha=0.2")
for n in [50, 200, 1000, 5000]:
    cells = []
    for alpha in [0.001, 0.01, 0.05, 0.2]:
        errs = [compare(edges(names, *pc(6, fisher_z(simulate(names, coef, n, np.random.default_rng(s)), alpha))),
                        true_cpdag) for s in range(100, 120)]
        cells.append("{:4.2f} / {:4.2f} / {:4.2f}".format(*np.mean(errs, axis=0)))
    print(f"{n:5d}    " + "   ".join(cells))

print("\n== 5. LiNGAM idea on two variables: X -> Y, Y = 0.8 X + e, n = 2000 ==")
def resid(a, b):                                          # residual of the least-squares regression of b on a
    a0, b0 = a - a.mean(), b - b.mean()
    return b0 - (a0 @ b0 / (a0 @ a0)) * a0
dep = lambda a, r: abs(np.corrcoef(a ** 2, r ** 2)[0, 1])  # does the residual's size depend on the regressor's?
def perm_p(a, r, rng, k=999):                             # share of shuffled (independent) pairs scoring as high
    return (1 + sum(dep(a, rng.permutation(r)) >= dep(a, r) for _ in range(k))) / (k + 1)
noises = {"uniform":  lambda rng, n: rng.uniform(-math.sqrt(3), math.sqrt(3), n),
          "Laplace":  lambda rng, n: rng.laplace(0, 1 / math.sqrt(2), n),
          "Gaussian": lambda rng, n: rng.normal(size=n)}
print("noise     dep(X, resid Y~X)  p      dep(Y, resid X~Y)  p      correct direction in 100 datasets")
for name, draw in noises.items():
    rng = np.random.default_rng(2)
    x = draw(rng, 2000); y = 0.8 * x + draw(rng, 2000)
    f, b = resid(x, y), resid(y, x)
    wins = 0
    for s in range(100):
        r2 = np.random.default_rng(1000 + s)
        xs = draw(r2, 2000); ys = 0.8 * xs + draw(r2, 2000)
        wins += dep(xs, resid(xs, ys)) < dep(ys, resid(ys, xs))
    print(f"{name:<9} {dep(x, f):10.3f}       {perm_p(x, f, rng):.3f}  {dep(y, b):10.3f}       {perm_p(y, b, rng):.3f}  {wins}/100")

print("\n== 6. NOTEARS acyclicity function h(W) = trace(exp(W * W)) - d ==")
W = np.zeros((6, 6))
for (u, v), w in coef.items():
    W[names.index(u), names.index(v)] = w
h = lambda M: np.trace(expm(M * M)) - len(M)
print(f"  true DAG                      h = {h(W):.6f}")
for w in [0.1, 0.5, 1.0]:
    Wc = W.copy(); Wc[names.index("F"), names.index("A")] = w
    print(f"  plus F -> A (weight {w:.1f}, cycle)  h = {h(Wc):.6f}")
print(f"  two nodes, X -> Y only (weight 1)  h = {h(np.array([[0.0, 1.0], [0.0, 0.0]])):.6f}")
print(f"  two nodes, X -> Y -> X (weights 1) h = {h(np.array([[0.0, 1.0], [1.0, 0.0]])):.6f}")
```

</details>

Reading it:
- **Equivalence (sections 1–2):** the chain and the fork both drop `r(X,Z)` to about 0 given `Y` (0.006 and −0.019) and PC returns `X - Y, Y - Z` for both; the collider is the reverse (−0.017 alone, −0.397 given `Y`) and comes out fully oriented. BIC cannot separate the three equivalent DAGs (3.553 each).
- **Faithfulness (section 1, `cancel`):** the true graph has `X → Z`, but its −1 cancels the +1 path through `Y`, so `X` and `Z` test independent (p = 0.444). PC deletes the real edge and orients a collider that does not exist, with full confidence.
- **The six-variable run (section 3):** nine edges removed, each with its separating set: `A - D` given `{C}` (the chain through `C`), `A - F` given `{B,C}` (`C` blocks the chain, `B` blocks the path that conditioning on the collider `C` would open). Two v-structures (`A → C ← B`, `D → F ← E`), then R1 orients `C → D`. The estimate matches the true CPDAG exactly, `B - E` undirected included.
- **Sample size and `α` (section 4):** at `n = 50` the tests lack power and true edges go missing (2.95 of 6 at `α = 0.001`); a larger `α` keeps them (0.50 missing at 0.2) but adds false edges. At `n = 5000` and `α = 0.2`, 0.65 false edges per graph remain: the false-dependence rate is set by `α`, not by `n`. Missing or extra edges also break v-structures, hence the orientation errors.
- **LiNGAM (section 5):** forward residuals look independent of the cause (p 0.572 and 0.950), backward ones do not (p 0.001, the smallest a 999-permutation test can give); with Gaussian noise neither direction shows dependence, and the choice is right 53 times in 100.
- **NOTEARS (section 6):** `h` is 0 for every DAG and grows with the weight of the cycle-closing edge (0.000311, 0.007776, 0.031107); the two-node cycle with weights 1 gives `2·cosh(1) − 2 = 1.086161`.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Effects cancel along two paths | A real edge is removed and a false collider oriented | Faithfulness fails ✅[^2]; lab `cancel` row ✅[^15] |
| Linear-Gaussian data | Only the equivalence class; undirected edges stay | No asymmetry in the joint distribution ✅[^1] ✅[^2]; lab 53/100 with Gaussian noise ✅[^15] |
| Two variables only | Independence tests cannot orient the edge | `X → Y` and `Y → X` have the same skeleton and no v-structure, so they are Markov equivalent ✅[^3] |
| Unmeasured common cause | PC's large-sample guarantee no longer holds | PC assumes no confounder; FCI does not ✅[^1] |
| Small `n` | True edges missing, orientations wrong | Too few rows for the tests to detect weaker dependencies: in the lab 2.95 edges missing at `n = 50` and 0.00 at `n = 1000`, `α = 0.001` ✅[^15] |
| Large `α` | Extra edges even with much data | `α` stays fixed while `n` grows; lab 0.65 extra at `n = 5000` ✅[^15] |
| Conflicting v-structures on finite samples | Two colliders claim one edge from both sides | causal-learn offers rules to resolve the conflict (`uc_priority`) ✅[^4]; the lab code would print `<->` |
| Standardized data fed to NOTEARS | Can miss the DAG and its class | Benchmarks' success relied on variance ordering ✅[^13] |
| Deterministic relation `Y = f(X)` with no noise | Noise-based direction tests have nothing to test | No independent noise term exists ✅[^1] |
| Time order known | Direction comes from time, not from the data | With time-ordered variables, no latent variables, positive probabilities, Markov and minimality, the DAG is unique ✅[^2] |
| Missing values, deletion per test | Spurious edges possible | Shown for test-wise deletion; a modified PC exists ✅[^1] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| PC with Fisher-z | Simple, fast on sparse graphs (tens of thousands of variables) ✅[^1] | Equivalence class only; needs faithfulness and no confounders ✅[^1]; `α` must be chosen ✅[^15] |
| GES with BIC | Searches equivalence classes by score ✅[^1] | Usually assumes linear-Gaussian or multinomial models; no latent-confounder version as of 2019 ✅[^1] |
| FCI | Correct in the large-sample limit with confounders ✅[^1] | Edge ends it cannot decide stay `o` ✅[^1] |
| LiNGAM family | A full DAG, no faithfulness needed ✅[^1] | Needs linear, non-Gaussian, unconfounded data ✅[^10]; scales worse than independence-based search ✅[^1]; no better than a coin flip with Gaussian noise (lab 53/100) ✅[^15] |
| NOTEARS | Smooth optimization, about 50 lines of Python ✅[^12] | Nonconvex; scale-sensitive ✅[^12] ✅[^13] |
| Intervention or randomized experiment | Shows causal relations directly ✅[^1] | Often too expensive, too slow, unethical or impossible ✅[^1] |

## Takeaways
- Report a discovered graph as an equivalence class: keep undirected edges undirected unless an extra assumption (non-Gaussian noise, time order, background knowledge) orients them. [rule-candidate]
- Before running discovery, write down which of Markov, faithfulness and "no hidden confounders" you are willing to defend; if hidden confounders are plausible, use FCI, not PC. [rule-candidate]
- Treat `α` as an error-trade-off knob and check the graph's stability across `α` values and bootstrap samples, remembering that stability is not correctness.
- Test the algorithm on simulated data that mimic your variables' distributions, and on standardized data, before trusting it on the real data.

## Verification status
- Verified: 95 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [Review of Causal Discovery Methods Based on Graphical Models](https://www.frontiersin.org/articles/10.3389/fgene.2019.00524/full) — Clark Glymour, Kun Zhang, Peter Spirtes, Frontiers in Genetics, 2019. Backs: when discovery is needed, the Markov and faithfulness assumptions, Markov equivalence classes and CPDAGs, the PC steps, R1, its guarantee and scale, GES, FCI and its marks, functional causal models and LiNGAM identifiability, DirectLiNGAM, nonlinear models, pointwise consistency, practical issues and guidelines. [^1]
- [Causal Models](https://plato.stanford.edu/entries/causal-models/) — Christopher Hitchcock, Stanford Encyclopedia of Philosophy, 2018 (living). Backs: failures of the Markov condition, faithfulness and its cancellation failure, Lebesgue measure 0, the three-variable equivalence classes, identifiability limits for linear-Gaussian and discrete data, time-order identifiability, latent variables enlarging the class. [^2]
- [A Fixed-Parameter Tractable Algorithm for Counting Markov Equivalence Classes with the same Skeleton](https://arxiv.org/html/2310.04218) — Vidya Sagar Sharma, AAAI 2024 (arXiv:2310.04218). Backs: an equivalence class is determined by its skeleton and v-structures. [^3]
- [PC (causal-learn documentation)](https://causal-learn.readthedocs.io/en/latest/search_methods_index/Constraint-based%20causal%20discovery%20methods/PC.html) — causal-learn developers (CLeaR), living (library not installed in the lab). Backs: PC-stable by default, Fisher-z default test, collider-conflict options. [^4]
- [causal-learn `cit.py`, tag 0.1.4.8](https://github.com/py-why/causal-learn/blob/0.1.4.8/causallearn/utils/cit.py) — py-why / causal-learn, 2026. Backs: the Fisher-z test formula and the partial correlation from the inverse correlation matrix. [^5]
- [Fisher-z test (causal-learn documentation)](https://causal-learn.readthedocs.io/en/latest/independence_tests_index/fisherz.html) — causal-learn developers, living. Backs: Fisher-z is optimal for linear-Gaussian data. [^6]
- [causal-learn `Meek.py`, tag 0.1.4.8](https://github.com/py-why/causal-learn/blob/0.1.4.8/causallearn/utils/PCUtils/Meek.py) and [`GraphClass.py`](https://github.com/py-why/causal-learn/blob/0.1.4.8/causallearn/graph/GraphClass.py) — py-why / causal-learn, 2026. Backs: Meek's rules R1–R3 as implemented, R3's non-adjacent pair (`find_kites`). [^7]
- [Estimating High-Dimensional Directed Acyclic Graphs with the PC-Algorithm](https://www.jmlr.org/papers/v8/kalisch07a.html) — Markus Kalisch, Peter Bühlmann, JMLR 8, 2007 (abstract page). Backs: uniform consistency of PC for sparse high-dimensional Gaussian DAGs. [^8]
- [GES with the BIC score or generalized score (causal-learn documentation)](https://causal-learn.readthedocs.io/en/latest/search_methods_index/Score-based%20causal%20discovery%20methods/GES.html) — causal-learn developers, living. Backs: GES with BIC as the default score. [^9]
- [A Linear Non-Gaussian Acyclic Model for Causal Discovery](https://www.jmlr.org/papers/v7/shimizu06a.html) — Shohei Shimizu, Patrik O. Hoyer, Aapo Hyvärinen, Antti Kerminen, JMLR 7, 2006 (abstract page). Backs: LiNGAM's assumptions, ICA, no time order needed. [^10]
- [LiNGAM-based Methods (causal-learn documentation)](https://causal-learn.readthedocs.io/en/latest/search_methods_index/Causal%20discovery%20methods%20based%20on%20constrained%20functional%20causal%20models/lingam.html) — causal-learn developers, living. Backs: ICA-LiNGAM, DirectLiNGAM and other implementations. [^11]
- [DAGs with NO TEARS: Continuous Optimization for Structure Learning](https://arxiv.org/html/1803.01422) — Xun Zheng, Bryon Aragam, Pradeep Ravikumar, Eric P. Xing, 2018 (arXiv:1803.01422). Backs: NP-hardness and superexponential search space, `h(W)`, its properties and gradient, closed-walk counting, least squares with L1, augmented Lagrangian, thresholding, nonconvexity, about 50 lines of Python. [^12]
- [Beware of the Simulated DAG! Causal Discovery Benchmarks May Be Easy To Game](https://arxiv.org/html/2102.13647) — Alexander G. Reisach, Christof Seiler, Sebastian Weichwald, 2021 (arXiv:2102.13647). Backs: varsortability, failure on standardized data. [^13]
- [FCI (causal-learn documentation)](https://causal-learn.readthedocs.io/en/latest/search_methods_index/Constraint-based%20causal%20discovery%20methods/FCI.html) — causal-learn developers, living. Backs: FCI outputs a PAG. [^14]
- `machine-learning/lab-setup.md` — the lab where the PC, BIC, sweep, LiNGAM and NOTEARS `h(W)` script ran on 2026-11-25. [^15]

## Related
- `machine-learning/causal-inference/causal-graphs-and-confounding.md` — d-separation, colliders and the backdoor criterion that a discovered graph feeds into.
- `machine-learning/causal-inference/estimating-effects-from-observational-data.md` — estimating the effect once an adjustment set is chosen.
- `machine-learning/causal-inference/potential-outcomes-and-experiments.md` — randomized experiments, which settle direction without discovery's assumptions.
- `machine-learning/supervised-learning/linear-regression.md` — the least-squares fits behind the residual tests and the BIC.
- `machine-learning/foundations/regularization.md` — the L1 penalty that NOTEARS uses for sparsity.
