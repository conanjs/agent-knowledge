---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/probabilistic-ml
status: verified
applies-to: ["any"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, probabilistic-ml, graphical-models, bayesian-network, markov-random-field, factor-graph, conditional-independence, variable-elimination, belief-propagation, sum-product, junction-tree, loopy-belief-propagation, partition-function]
---

# Probabilistic graphical models: Bayesian networks, Markov random fields and inference

## Summary
**TL;DR:** A probabilistic graphical model writes a joint distribution over many variables as a product of small factors, one per direct interaction, and draws that product as a graph. A Bayesian network (a directed acyclic graph) has one conditional probability table per variable given its parents; a Markov random field (an undirected graph) has non-negative factors over cliques, divided by a normalizing constant `Z`. The graph shows which variables are independent given which others, and the factorization makes inference cheap on a tree: variable elimination pushes each sum inside the product, and belief propagation passes the same partial sums as messages, two per edge, to get every marginal at once. With loops, exact inference costs time exponential in the largest cluster it must form and is NP-hard (nondeterministic-polynomial-time hard: no polynomial-time algorithm is known) in general; loopy belief propagation runs the tree updates anyway and gives answers that are often close but not guaranteed to be exact.
**Use this when:** you design or read a model of many interacting variables (diagnosis, sensor fusion, image labelling), need `p(some variables | evidence)` from such a model, choose between exact and approximate inference, or meet the words factor, clique, partition function, message passing or junction tree.
**Not this doc:** d-separation used causally (backdoor paths, what to adjust for) → `machine-learning/causal-inference/causal-graphs-and-confounding.md`; chains over time (hidden Markov models and Kalman filters) → `machine-learning/probabilistic-ml/hidden-markov-models-and-kalman-filters.md`; approximate inference by sampling → `machine-learning/probabilistic-ml/markov-chain-monte-carlo.md`, by optimization → `machine-learning/probabilistic-ml/variational-inference.md`; learned message passing in neural networks → `machine-learning/deep-learning/graph-neural-networks.md`; EM (expectation–maximization) for hidden variables → `machine-learning/unsupervised-learning/gaussian-mixtures-and-em.md`.

## Problem
A joint distribution stored as one table needs one number per combination of values, so `n` variables with `k` values each need `k^n` entries. That table is too big to store, too big to estimate from any realistic training set, and too slow to use, because a marginal or a conditional must sum across the whole table and a sample may have to scan all of it ✅[^7]. Even the five-variable model of the worked example needs 47 free numbers as a table against 15 as a graphical model, and a query on a chain of 16 binary variables took 1,048,574 arithmetic operations by enumeration against 90 by variable elimination ✅[^9]. Most variables influence each other only through others ✅[^7]; a graphical model writes that down, and the open questions are which independences the graph implies and how to compute with it.

## Mental model
**Analogy:** a head count in a large company done through the org chart. Nobody lists every employee in one place: each team lead adds up their own team, passes one number to their manager, and the manager adds the numbers they receive. One sweep up gives the total at the top; one sweep back down tells every lead the numbers from the rest of the company, so every local total is known after two messages per reporting line. That is belief propagation on a tree. If some people report to two leads (a loop), their numbers reach the top along two paths and are counted twice; loopy belief propagation is running the same procedure anyway and hoping the double counting stays small.

**Artifact:** the student network (variables and structure from the Stanford CS228 notes ✅[^1]; the probability tables are the lab's own), drawn by hand from the `FACTORS` list of the full script in the Worked example:

```text
 d difficulty      i intelligence
        \           /        \
         v         v          v
          g grade (3 values)   s SAT (admissions test) score
             |
             v
          l reference letter          p(d,i,g,s,l) = p(d) p(i) p(g|i,d) p(s|i) p(l|g)
```

Four of the lines printed by that full script (from sections 1–3 of its output), where a CPD is a conditional probability distribution, `e` is the evidence `l=0, s=1`, VE is variable elimination and BP belief propagation; lab run (`machine-learning/lab-setup.md`), 2026-11-25, numpy 2.5.5 ✅[^9]:

```text
full joint table: 48 entries, 47 free parameters; the five CPDs: 15 free parameters
brute force        p(i=1|e) = 0.722618  multiplications  48  additions  10
VE, order d then g p(i=1|e) = 0.722618  multiplications  22  additions  10
BP p(i=1|e) = 0.722618; max |BP - brute force| over the marginals of d, i, g: 1.1e-16
```

Three methods, one answer: after a weak letter and a high SAT score, the probability of high intelligence is 0.7226.

## How it works
### Bayesian networks: one table per variable
1. **Factorization.** The chain rule writes any joint as `p(x_1) p(x_2 | x_1) … p(x_n | x_1, …, x_{n−1})`; a Bayesian network keeps in each factor only a few variables, the node's parents in a DAG (directed acyclic graph) ✅[^1]. Each factor is a CPD (conditional probability distribution), a table with one row per parent assignment ✅[^1].
2. **Size.** With `n` variables of `d` values and at most `k` parents each, the tables hold `O(n·d^(k+1))` entries instead of `O(d^n)` ✅[^1]. The student network: `p(g | i, d)` has 4 parent rows × (3 − 1) free values = 8, the four other CPDs 1 + 1 + 2 + 3, total 15, against 2·2·3·2·2 − 1 = 47 ✅[^9].
3. **A generative story.** Sample the parentless variables, then each child given its sampled parents (ancestral or forward sampling); that draws one joint sample in `O(n)` time ✅[^11]. A graph with a directed cycle is not allowed: its product of tables may not sum to one ✅[^1].
4. **Learning from complete data.** The log-likelihood splits into one term per CPD, and the maximum-likelihood estimate of each entry is a normalized count, `θ(x_i | parents) = #(x_i, parents) / #(parents)` ✅[^5]. Example: if 80 of 100 students with high intelligence scored high on the SAT, `p(s=1 | i=1) = 80/100 = 0.8`. With hidden variables, EM (expectation–maximization) replaces the counts by expected counts (`machine-learning/unsupervised-learning/gaussian-mixtures-and-em.md`).

### Markov random fields and factor graphs
5. **Definition.** An MRF (Markov random field) is `p(x) = (1/Z) · Π_c φ_c(x_c)`: `c` runs over cliques (fully connected subsets) of an undirected graph, each factor `φ_c ≥ 0` scores the values of its clique, and the partition function `Z = Σ_x Π_c φ_c(x_c)` makes the total one ✅[^2]. Example with CS228's voting factor, `φ(A,B) = 10` if both vote 1, `5` if both vote 0, `1` otherwise ✅[^2]: for two friends alone, `Z = 10 + 5 + 1 + 1 = 17` and `p(A=1, B=1) = 10/17 = 0.588`.
6. **Directed to undirected.** A Bayesian network is an MRF whose factors are its CPDs and whose `Z` is 1; to draw it undirected, connect every pair of parents of a common child and drop the arrows (moralization) ✅[^2]. The student network's moral graph gains the edge `d – i`.
7. **Factor graphs.** A bipartite graph with one node per variable and one per factor, an edge wherever a factor uses a variable ✅[^2]. It removes the ambiguity of an undirected graph: one factor over three variables and three pairwise factors draw the same triangle but are different models ✅[^7].
8. **Conditional random fields.** A CRF (conditional random field) is an MRF over outputs `y` given inputs `x`, with a normalizer `Z(x)` that depends on the input, used for structured prediction such as reading a word letter by letter ✅[^2].
9. **Learning an MRF** is harder than counting: the gradient of `log Z` is an expectation under the model, so each gradient step needs inference, which is intractable in general ✅[^6].

### Conditional independence from the graph
10. **Three junctions.** In a cascade `X → Z → Y` and a common parent `X ← Z → Y`, observing `Z` makes `X` and `Y` independent; in a v-structure `X → Z ← Y` they are independent until `Z` (or a descendant of `Z`) is observed, which couples them ("explaining away") ✅[^1]. Lab: `i` and `d` are independent (`p(i=1) = p(i=1 | d=1) = 0.300`); after a grade C, `p(i=1 | g=C) = 0.079`, and learning that the exam was hard raises it to `0.109`, because difficulty explains the bad grade ✅[^9].
11. **d-separation** extends the three cases to whole paths: two sets are d-separated given the observed set when no path between them is active ✅[^1]. It is sound but not complete: every d-separation holds in any distribution that factorizes over the graph, but such a distribution may have extra independences the graph does not show ✅[^1]. The full blocking rules and their causal use are in `machine-learning/causal-inference/causal-graphs-and-confounding.md`.
12. **In an MRF** the rule is plain separation: a variable is independent of all others given its neighbours, its Markov blanket ✅[^2]. Neither family covers the other: a v-structure has no undirected equivalent, and a four-person friendship cycle has no directed one ✅[^2].

### Exact inference: variable elimination and belief propagation
13. **The two queries.** Marginal inference sums everything else out (`p(y)`); MAP (maximum a posteriori) inference finds the most likely joint assignment ✅[^3].
14. **Variable elimination (VE).** Pick an order; for each variable, multiply all factors that mention it and sum it out, leaving a new factor `τ` over its neighbours ✅[^3]. With `n` variables of `k` values each (here `k` counts values, not parents as in step 2), each step on a chain costs `O(k²)`, so the marginal costs `O(n·k²)` instead of `O(k^n)` ✅[^3]. Evidence is handled by fixing the observed values in every factor, running VE, and dividing by `p(e)` ✅[^3]. The cost is `O(n·k^(M+1))`, `M` being the number of variables in the largest factor created ✅[^3], so the order matters: eliminating the hub of a 12-child star first created a factor over 12 variables and cost 106,494 operations, against 72 for eliminating the children first ✅[^9]. Finding the best order is NP-hard; min-neighbours, min-weight and min-fill are the usual heuristics ✅[^3].
15. **Belief propagation (BP) on a tree.** The factors VE passes up a tree are messages, and they are the same whichever node is the root, so caching them answers every marginal ✅[^4]. Sum-product: `m_{i→j}(x_j) = Σ_{x_i} φ(x_i) · φ(x_i, x_j) · Π_{l ∈ N(i)\j} m_{l→i}(x_i)`, where `N(i)\j` is `i`'s neighbours except `j`; a node sends to `j` once it has heard from all other neighbours, and the procedure ends after `2|E|` messages, two per edge ✅[^4]. Then `p(x_i) ∝ φ(x_i) · Π_{l ∈ N(i)} m_{l→i}(x_i)` ✅[^4]. Example with no other neighbours: `φ(x_1) = (0.6, 0.4)`, `φ(x_1, x_2)` with rows `(0.9, 0.1)` and `(0.2, 0.8)` gives `m_{1→2} = (0.6·0.9 + 0.4·0.2, 0.6·0.1 + 0.4·0.8) = (0.62, 0.38)`. The lab's factor tree has 11 edges and sent 22 messages ✅[^9].
16. **Max-product.** Replacing sums by maxima (both distribute over products of non-negative factors) gives MAP inference; back-pointers recover the best assignment ✅[^4]. On a chain this is the Viterbi algorithm of `machine-learning/probabilistic-ml/hidden-markov-models-and-kalman-filters.md`.
17. **Junction tree.** For a graph with loops, group variables into clusters that form a tree in which every factor fits inside one cluster and every variable shared by two clusters appears on the whole path between them (running intersection), then pass messages between clusters ✅[^4]. The cost is exponential in the largest cluster, and finding the best tree is NP-hard ✅[^4]; for a grid, clusters of two adjacent rows are the natural choice ✅[^4].

### Why exact inference is hard in general
18. **Worst case.** Computing a marginal in a general graphical model is #P-hard, #P being the class of counting problems, a generalization of NP (nondeterministic polynomial time): a model with a uniform distribution over the variables of a 3-SAT formula (a Boolean satisfiability problem with three-literal clauses), with one variable per clause and a tree of "all satisfied" variables, has a root marginal equal to the fraction of satisfying assignments ✅[^7]. MAP inference is NP-hard too, though some models allow it in polynomial time where marginals do not ✅[^10].
19. **In practice.** The partition function of an MRF sums over every joint state and is often intractable ✅[^7]: the lab's 4×4 grid of 16 binary spins already has 65,536 states to sum ✅[^9]. Deep models connect each visible unit to many hidden units, so their graphs are too dense for exact inference or loopy BP, and they are built so that Gibbs sampling or variational inference is efficient instead ✅[^7].

### Loopy belief propagation
20. **The idea.** On a graph with loops, run the same message update anyway: compute round `t + 1`'s messages from round `t`'s, usually starting from uniform messages, for a fixed number of steps or until the messages stop changing ✅[^4]. It provably converges on trees and on graphs with at most one cycle; elsewhere it may not converge, and when it converges its beliefs are often close to, but not necessarily equal to, the true marginals ✅[^4].
21. **Evidence.** Murphy, Weiss and Jordan compared loopy beliefs with exact marginals on four network architectures: the beliefs often converged and then approximated the posteriors well, but on the QMR network (the abstract names it only by these letters), one of the two real-world networks, they oscillated and bore no obvious relation to the correct posteriors ✅[^8].

## Worked example
Six checks in numpy: the parameter count of the student network; the query `p(i | l=0, s=1)` by enumeration and by VE with every multiplication and addition counted; sum-product BP on the network's factor tree; two independence statements read off the graph; then the cost of enumeration vs VE on growing chains and on a star with a good and a bad elimination order; and loopy BP on a 4×4 grid MRF, `p(s) ∝ exp(Σ_i h_i s_i + J Σ_edges s_i s_j)` with spins `s_i = ±1`, fields `h_i` drawn from `N(0, 0.5²)` (a normal distribution with mean 0 and standard deviation 0.5) and coupling `J`, against exact marginals by enumerating all 65,536 states. Core of VE:

```python
for v in order:                                 # multiply the factors that mention v, then sum v out
    tau = sum_out(product([f for f in fs if v in f.vars]), v)
    fs = [f for f in fs if v not in f.vars] + [tau]
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-25, Python 3.13.7, numpy 2.5.5, two runs identical ✅[^9]:

```text
== 1. student network: p(d,i,g,s,l) = p(d) p(i) p(g|i,d) p(s|i) p(l|g) ==
full joint table: 48 entries, 47 free parameters; the five CPDs: 15 free parameters
== 2. query p(i | l=0, s=1): letter weak, SAT high ==
brute force        p(i=1|e) = 0.722618  multiplications  48  additions  10
VE, order d then g p(i=1|e) = 0.722618  multiplications  22  additions  10
== 3. sum-product belief propagation on the factor tree, same evidence ==
factor graph: 7 factors (2 of them evidence), 11 edges, 22 messages
BP p(i=1|e) = 0.722618; max |BP - brute force| over the marginals of d, i, g: 1.1e-16
p(g | e) = [0.2393 0.2708 0.49  ]  p(d=1 | e) = 0.6028
== 4. conditional independence read off the graph ==
v-structure d -> g <- i: p(i=1) = 0.300  p(i=1|d=1) = 0.300  p(i=1|g=C) = 0.079  p(i=1|g=C,d=1) = 0.109
fork s <- i -> g:        p(s=1|i=1) = 0.800  p(s=1|i=1,g=C) = 0.800
== 5. cost as the model grows: a chain x1 -> ... -> xn, and a hub h with n children ==
chain n= 4  brute force       62 operations   VE  18 operations   p(xn=1): 0.304000 vs 0.304000
chain n= 8  brute force     2046 operations   VE  42 operations   p(xn=1): 0.256998 vs 0.256998
chain n=12  brute force    49150 operations   VE  66 operations   p(xn=1): 0.250907 vs 0.250907
chain n=16  brute force  1048574 operations   VE  90 operations   p(xn=1): 0.250118 vs 0.250118
hub, 12 children, children first: VE     72 operations, largest new factor has  1 variable
hub, 12 children, hub first     : VE 106494 operations, largest new factor has 12 variables
== 6. loopy BP on a 4x4 grid MRF (spins +-1, fields h ~ N(0, 0.5^2)) vs exact marginals ==
grid: 16 variables, 24 edges, 65536 joint states for the exact answer
    J  sweeps  max|loopy-exact|  mean|loopy-exact|  mean|p-0.5| exact  mean|p-0.5| loopy
 0.10      12            0.0001             0.0000              0.177              0.177
 0.50      65            0.0311             0.0184              0.249              0.268
 0.75      56            0.1450             0.0759              0.369              0.445
 1.00      29            0.0409             0.0273              0.463              0.491
 2.00      15            0.0140             0.0140              0.486              0.500
```

<details><summary>Full script (prints the output above)</summary>

```python
# A Bayesian network answered three ways (brute-force enumeration, variable elimination, belief
# propagation on its factor tree), with operation counts; then loopy BP on a grid MRF vs exact marginals.
import itertools
import numpy as np

CARD = {"d": 2, "i": 2, "g": 3, "s": 2, "l": 2}      # d difficulty, i intelligence, g grade, s SAT, l letter
OPS = {"mul": 0, "add": 0}

class Factor:                                       # a table over named variables
    def __init__(self, vars_, table):
        self.vars, self.t = list(vars_), np.asarray(table, dtype=float)

def product(fs):                                    # factor product: one multiply per extra factor per entry
    scope = sorted({v for f in fs for v in f.vars})
    let = {v: chr(97 + k) for k, v in enumerate(scope)}
    out = np.einsum(",".join("".join(let[v] for v in f.vars) for f in fs) + "->" + "".join(let[v] for v in scope),
                    *[f.t for f in fs])
    OPS["mul"] += out.size * (len(fs) - 1)
    return Factor(scope, out)

def sum_out(f, v):                                  # marginalize v; counts the additions
    out = f.t.sum(axis=f.vars.index(v))
    OPS["add"] += f.t.size - out.size
    return Factor([u for u in f.vars if u != v], out)

def reduce(f, ev):                                  # fix evidence values (no arithmetic)
    return Factor([v for v in f.vars if v not in ev], f.t[tuple(ev.get(v, slice(None)) for v in f.vars)])

FACTORS = [Factor(["d"], [0.6, 0.4]), Factor(["i"], [0.7, 0.3]),
           Factor(["i", "d", "g"], [[[0.3, 0.4, 0.3], [0.05, 0.25, 0.7]],      # p(g | i=0, d=0), p(g | i=0, d=1)
                                    [[0.9, 0.08, 0.02], [0.5, 0.3, 0.2]]]),    # p(g | i=1, d=0), p(g | i=1, d=1)
           Factor(["i", "s"], [[0.95, 0.05], [0.2, 0.8]]),
           Factor(["g", "l"], [[0.1, 0.9], [0.4, 0.6], [0.99, 0.01]])]

def brute_force(query, ev, factors=FACTORS, card=CARD):   # enumerate every full assignment
    totals, rows = np.zeros(card[query]), 0
    for vals in itertools.product(*[range(k) for k in card.values()]):
        a = dict(zip(card, vals))
        if all(a[v] == x for v, x in ev.items()):
            totals[a[query]] += np.prod([f.t[tuple(a[v] for v in f.vars)] for f in factors])
            OPS["mul"] += len(factors) - 1; rows += 1
    OPS["add"] += rows - card[query]
    return totals / totals.sum()

def variable_elimination(query, ev, order, factors=FACTORS):
    fs, largest = [reduce(f, ev) for f in factors], 0
    for v in order:                                 # multiply the factors that mention v, then sum v out
        tau = sum_out(product([f for f in fs if v in f.vars]), v)
        fs = [f for f in fs if v not in f.vars] + [tau]
        largest = max(largest, len(tau.vars))
    res = product(fs).t
    return res / res.sum(), largest

def counted(fn):                                    # run fn, return (result, multiplications, additions)
    OPS["mul"] = OPS["add"] = 0
    out = fn()
    return out, OPS["mul"], OPS["add"]

print("== 1. student network: p(d,i,g,s,l) = p(d) p(i) p(g|i,d) p(s|i) p(l|g) ==")
full = int(np.prod(list(CARD.values())))
cpd_free = sum(int(np.prod([CARD[v] for v in f.vars[:-1]])) * (CARD[f.vars[-1]] - 1) for f in FACTORS)
print(f"full joint table: {full} entries, {full - 1} free parameters; the five CPDs: {cpd_free} free parameters")

print("== 2. query p(i | l=0, s=1): letter weak, SAT high ==")
ev = {"l": 0, "s": 1}
p_bf, m, a = counted(lambda: brute_force("i", ev))
print(f"brute force        p(i=1|e) = {p_bf[1]:.6f}  multiplications {m:3d}  additions {a:3d}")
(p_ve, _), m, a = counted(lambda: variable_elimination("i", ev, ["d", "g"]))
print(f"VE, order d then g p(i=1|e) = {p_ve[1]:.6f}  multiplications {m:3d}  additions {a:3d}")

print("== 3. sum-product belief propagation on the factor tree, same evidence ==")
def bp_marginals(factors, card, ev):
    fs = list(factors) + [Factor([v], np.eye(card[v])[x]) for v, x in ev.items()]   # evidence as indicator factors
    nbr = {("f", k): [("v", v) for v in f.vars] for k, f in enumerate(fs)}
    nbr.update({("v", v): [("f", k) for k, f in enumerate(fs) if v in f.vars] for v in card})
    msgs = {}
    def msg(src, dst):                              # a message needs every incoming message except dst's
        if (src, dst) not in msgs:
            if src[0] == "v":                       # variable -> factor: product of the other incoming messages
                out = np.prod([msg(f, src) for f in nbr[src] if f != dst] or [np.ones(card[src[1]])], axis=0)
            else:                                   # factor -> variable: multiply in messages, sum out the rest
                f = fs[src[1]]; t = f.t.copy()
                for ax, u in enumerate(f.vars):
                    if ("v", u) != dst:
                        shape = [1] * t.ndim; shape[ax] = card[u]
                        t = t * msg(("v", u), src).reshape(shape)
                out = t.sum(axis=tuple(ax for ax, u in enumerate(f.vars) if ("v", u) != dst))
            msgs[(src, dst)] = out
        return msgs[(src, dst)]
    for a in list(nbr):                             # send every message, both directions of every edge
        for b in nbr[a]:
            msg(a, b)
    marg = {v: np.prod([msg(f, ("v", v)) for f in nbr[("v", v)]], axis=0) for v in card}
    return {v: b / b.sum() for v, b in marg.items()}, len(msgs), sum(len(f.vars) for f in fs)
marg, n_msgs, n_edges = bp_marginals(FACTORS, CARD, ev)
gap = max(np.abs(marg[v] - brute_force(v, ev)).max() for v in CARD if v not in ev)
print(f"factor graph: {len(FACTORS) + len(ev)} factors (2 of them evidence), {n_edges} edges, {n_msgs} messages")
print(f"BP p(i=1|e) = {marg['i'][1]:.6f}; max |BP - brute force| over the marginals of d, i, g: {gap:.1e}")
print("p(g | e) =", np.round(marg["g"], 4), " p(d=1 | e) =", round(marg["d"][1], 4))

print("== 4. conditional independence read off the graph ==")
q = lambda var, e: brute_force(var, e)[1]
print(f"v-structure d -> g <- i: p(i=1) = {q('i', {}):.3f}  p(i=1|d=1) = {q('i', {'d': 1}):.3f}"
      f"  p(i=1|g=C) = {q('i', {'g': 2}):.3f}  p(i=1|g=C,d=1) = {q('i', {'g': 2, 'd': 1}):.3f}")
print(f"fork s <- i -> g:        p(s=1|i=1) = {q('s', {'i': 1}):.3f}  p(s=1|i=1,g=C) = {q('s', {'i': 1, 'g': 2}):.3f}")

print("== 5. cost as the model grows: a chain x1 -> ... -> xn, and a hub h with n children ==")
T = np.array([[0.9, 0.1], [0.3, 0.7]])
for n in (4, 8, 12, 16):
    card = {f"x{k}": 2 for k in range(1, n + 1)}
    fs = [Factor(["x1"], [0.5, 0.5])] + [Factor([f"x{k-1}", f"x{k}"], T) for k in range(2, n + 1)]
    p_bf, mb, ab = counted(lambda: brute_force(f"x{n}", {}, fs, card))
    (p_ve, _), mv, av = counted(lambda: variable_elimination(f"x{n}", {}, [f"x{k}" for k in range(1, n)], fs))
    print(f"chain n={n:2d}  brute force {mb + ab:8d} operations   VE {mv + av:3d} operations   "
          f"p(xn=1): {p_bf[1]:.6f} vs {p_ve[1]:.6f}")
n = 12                                              # query p(x1): eliminate the children first, or the hub first
fs = [Factor(["h"], [0.5, 0.5])] + [Factor(["h", f"x{k}"], T) for k in range(1, n + 1)]
for name, order in (("children first", [f"x{k}" for k in range(2, n + 1)] + ["h"]),
                    ("hub first     ", ["h"] + [f"x{k}" for k in range(2, n + 1)])):
    (p_ve, largest), mv, av = counted(lambda: variable_elimination("x1", {}, order, fs))
    print(f"hub, {n} children, {name}: VE {mv + av:6d} operations, largest new factor has {largest:2d} "
          f"variable{'s' if largest > 1 else ''}")

print("== 6. loopy BP on a 4x4 grid MRF (spins +-1, fields h ~ N(0, 0.5^2)) vs exact marginals ==")
rng = np.random.default_rng(0)
side = 4; n = side * side
h = rng.normal(0, 0.5, n)
edges = [(r * side + c, r * side + c + 1) for r in range(side) for c in range(side - 1)] + \
        [(r * side + c, (r + 1) * side + c) for r in range(side - 1) for c in range(side)]
spins = np.array([-1.0, 1.0])
states = np.array(list(itertools.product([-1.0, 1.0], repeat=n)))       # 65,536 x 16
nb = {k: [b for a, b in edges if a == k] + [a for a, b in edges if b == k] for k in range(n)}
def exact(J):                                       # p(s) proportional to exp(sum h_i s_i + J sum_edges s_i s_j)
    logp = states @ h + J * sum(states[:, a] * states[:, b] for a, b in edges)
    p = np.exp(logp - logp.max()); p /= p.sum()
    return p @ (states > 0)                         # P(s_i = +1) for every node
def loopy_bp(J, iters=500, tol=1e-10):
    m = {(a, b): np.ones(2) / 2 for a in range(n) for b in nb[a]}       # uniform initial messages
    psi = np.exp(J * np.outer(spins, spins))
    for it in range(1, iters + 1):                  # synchronous update of every message
        new = {}
        for (a, b) in m:
            out = psi.T @ (np.exp(h[a] * spins) * np.prod([m[(c, a)] for c in nb[a] if c != b], axis=0))
            new[(a, b)] = out / out.sum()
        delta = max(np.abs(new[k] - m[k]).max() for k in m)
        m = new
        if delta < tol:
            break
    bel = np.array([np.exp(h[a] * spins) * np.prod([m[(c, a)] for c in nb[a]], axis=0) for a in range(n)])
    return bel[:, 1] / bel.sum(1), it
print(f"grid: {n} variables, {len(edges)} edges, {len(states)} joint states for the exact answer")
print("    J  sweeps  max|loopy-exact|  mean|loopy-exact|  mean|p-0.5| exact  mean|p-0.5| loopy")
for J in (0.1, 0.5, 0.75, 1.0, 2.0):
    ex = exact(J)
    lb, it = loopy_bp(J)
    print(f"{J:5.2f}  {it:6d}  {np.abs(lb - ex).max():16.4f}  {np.abs(lb - ex).mean():17.4f}"
          f"  {np.abs(ex - 0.5).mean():17.3f}  {np.abs(lb - 0.5).mean():17.3f}")
```

</details>

Reading it, section by section:
- **2, the query.** With `l` and `s` observed, enumeration visits the 2·2·3 = 12 remaining assignments, 4 multiplications each (48). VE eliminates `d` (a 12-entry product, then 6 additions), then `g` (6 products, 4 additions), then multiplies three 2-entry factors over `i` (4 products): 22 multiplications for the same 0.722618.
- **3, BP.** The 5 CPDs plus 2 evidence indicators make a factor graph with 11 edges and no loop; 22 messages, two per edge, give every marginal, equal to enumeration up to rounding (`1.1e-16`).
- **4, independence.** `d` and `i` do not move each other until the grade is seen; given a C, a hard exam raises `p(i=1)` from 0.079 to 0.109. Given `i`, the grade tells nothing about the SAT score (0.800 both times).
- **5, cost.** Enumeration grows 21× to 33× per 4 extra chain variables (62 → 2,046 → 49,150 → 1,048,574 operations: 16× more assignments, each with more factors to multiply), VE by 24 operations. On the star, eliminating the hub first couples all 12 children into one factor: 106,494 operations against 72.
- **6, loopy BP.** Converged at every coupling `J`, with small errors at weak coupling (0.0001) and the largest error, 0.145, at `J = 0.75`. In every row the loopy beliefs were on average at least as far from 0.5 as the exact marginals (mean 0.445 against 0.369 at `J = 0.75`): in this run, averaged over the 16 nodes, loopy BP was over-confident, never under-confident.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Graph with a directed cycle | Not a valid Bayesian network | The product of CPDs may not sum to one ✅[^1] |
| `Z = X xor Y`, `X, Y` fair coins | No DAG shows exactly its independences | Every pair is independent but the three are not; `X → Z ← Y` is only an I-map (independence map) ✅[^1] |
| A descendant of a v-structure's middle node is observed | The two parents become dependent | Observing `Z` or any descendant activates the path ✅[^1] |
| Bad elimination order | A huge intermediate factor; cost exponential in its size | Cost `O(n·k^(M+1))` ✅[^3]; lab: hub first 106,494 operations vs 72 ✅[^9] |
| Intermediate factor `τ` read as a probability | Wrong numbers | `τ` need not be a distribution even when built from CPDs ✅[^3] |
| A second query after VE | VE starts from scratch | BP and the junction tree cache the messages instead ✅[^4] |
| MRF with continuous variables | `Z` may not exist | The integral can diverge, e.g. one factor `φ(x) = x²` on the real line ✅[^7] |
| Loopy BP on a hard network | Beliefs oscillate, unrelated to the truth | Seen on the QMR network; simple fixes that stopped the oscillation gave wrong results ✅[^8] |
| Loopy BP converges | Beliefs still not exact | Converged beliefs need not equal marginals ✅[^4]; lab error up to 0.145 ✅[^9] |
| Dense model, as in deep learning | Neither exact inference nor loopy BP is practical | Graphs not sparse enough; Gibbs sampling or variational inference instead ✅[^7] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Bayesian network | Closed-form maximum-likelihood fit from counts ✅[^5]; `O(n)` ancestral sampling ✅[^11] | Some independence structures (a friendship cycle) cannot be drawn ✅[^2] |
| Markov random field | No direction needed; represents cycles of mutual influence ✅[^2] | `Z` NP-hard in general; harder to interpret and to sample from ✅[^2]; learning needs inference at every step ✅[^6] |
| Variable elimination | Exact, for directed and undirected models alike ✅[^4] | One query per run; exponential in the largest factor formed ✅[^3] ✅[^4] |
| BP on a tree / junction tree | Every marginal after two passes ✅[^4] | Junction tree exponential in its largest cluster; best tree NP-hard ✅[^4] |
| Loopy BP | Cheap; often close in practice ✅[^4] ✅[^8] | No convergence guarantee with loops; approximate even when it converges ✅[^4] |
| Sampling or variational inference | Usable on models too dense for exact inference ✅[^7] | Approximate; see the Markov chain Monte Carlo and variational inference docs in Related |

## Takeaways
- Write the factorization down before you write code: the largest factor (or cluster) you must form decides whether exact inference is feasible. [rule-candidate]
- When the graph is a tree, use belief propagation and get every marginal at once; for a single query on a small model, variable elimination is enough.
- Choose the elimination order deliberately (min-fill or a similar heuristic); a bad order can turn a linear computation into an exponential one.
- Treat loopy BP output as an approximation: check it against exact inference on a small instance before trusting it, and watch for non-convergence. [rule-candidate]
- An independence the graph implies always holds; an independence the graph does not show may still hold.

## Verification status
- Verified: 76 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [Bayesian networks (CS228 notes)](https://ermongroup.github.io/cs228-notes/representation/directed/) — Kuleshov, Ermon, Stanford CS228, living. Backs: chain-rule factorization, CPDs, `O(n·d^(k+1))` size, the student network, cycles, the three junctions and explaining away, d-separation, soundness without completeness, noisy XOR. [^1]
- [Markov random fields (CS228 notes)](https://ermongroup.github.io/cs228-notes/representation/undirected/) — Kuleshov, Ermon, Stanford CS228, living. Backs: MRF definition, cliques, partition function, the voting factor, moralization, factor graphs, CRFs, Markov blanket, what each family cannot express, drawbacks of MRFs. [^2]
- [Variable elimination (CS228 notes)](https://ermongroup.github.io/cs228-notes/inference/ve/) — Kuleshov, Ermon, Stanford CS228, living. Backs: marginal and MAP queries, the elimination steps, `O(n·k²)` chain, evidence, `O(n·k^(M+1))`, NP-hard ordering and its heuristics, `τ` not a probability. [^3]
- [Junction tree algorithm (CS228 notes)](https://ermongroup.github.io/cs228-notes/inference/jt/) — Kuleshov, Ermon, Stanford CS228, living. Backs: BP as cached VE, the sum-product message and marginal, `2|E|` messages, max-product and back-pointers, junction tree properties and cost, grid clusters, loopy BP and its convergence. [^4]
- [Learning in directed models (CS228 notes)](https://ermongroup.github.io/cs228-notes/learning/directed/) — Kuleshov, Ermon, Stanford CS228, living. Backs: maximum-likelihood CPDs as normalized counts. [^5]
- [Learning in undirected models (CS228 notes)](https://ermongroup.github.io/cs228-notes/learning/undirected/) — Kuleshov, Ermon, Stanford CS228, living. Backs: the gradient of `log Z` needs inference. [^6]
- [Deep Learning, chapter 16: Structured Probabilistic Models for Deep Learning](https://www.deeplearningbook.org/contents/graphical_models.html) — Goodfellow, Bengio, Courville, MIT Press, 2016. Backs: the cost of a full table, indirect influence, factor graphs resolving ambiguity, the partition function and its intractability, `Z` that does not exist, #P-hardness by 3-SAT, loopy BP rarely used in deep learning. [^7]
- [Loopy Belief Propagation for Approximate Inference: An Empirical Study](https://arxiv.org/abs/1301.6725) — Murphy, Weiss, Jordan, 1999 (abstract; no HTML full text). Backs: loopy beliefs often converge and approximate well; oscillation on QMR; simple fixes give wrong results. [^8]
- `machine-learning/lab-setup.md` — the lab where the student-network queries, operation counts, BP, cost scaling and loopy BP on the grid ran on 2026-11-25. [^9]
- [MAP inference (CS228 notes)](https://ermongroup.github.io/cs228-notes/inference/map/) — Kuleshov, Ermon, Stanford CS228, living. Backs: MAP inference NP-hard in general, easier than marginals in some models. [^10]
- [Sampling methods (CS228 notes)](https://ermongroup.github.io/cs228-notes/inference/sampling/) — Kuleshov, Ermon, Stanford CS228, living. Backs: ancestral (forward) sampling in `O(n)`. [^11]

## Related
- `machine-learning/causal-inference/causal-graphs-and-confounding.md` — d-separation's blocking rules and how a DAG decides what to adjust for.
- `machine-learning/probabilistic-ml/hidden-markov-models-and-kalman-filters.md` — the chain-structured case: forward–backward is BP and Viterbi is max-product.
- `machine-learning/probabilistic-ml/naive-bayes.md` — the simplest Bayesian network: one class node with every feature as its child.
- `machine-learning/probabilistic-ml/markov-chain-monte-carlo.md` — sampling-based inference when exact inference is too costly.
- `machine-learning/probabilistic-ml/variational-inference.md` — inference as optimization, the other approximate route.
- `machine-learning/unsupervised-learning/gaussian-mixtures-and-em.md` — fitting a model with hidden variables by EM.
- `machine-learning/deep-learning/graph-neural-networks.md` — neural networks that pass learned messages along a graph's edges.
