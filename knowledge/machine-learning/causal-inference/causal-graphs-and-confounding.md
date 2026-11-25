---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/causal-inference
status: verified
applies-to: ["any"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, causal-inference, dag, causal-graph, confounding, collider, mediator, d-separation, backdoor-criterion, simpsons-paradox, bad-controls]
---

# Causal graphs, confounding and what to adjust for

## Summary
**TL;DR:** A DAG (directed acyclic graph) writes down which variable causes which. Association between a treatment and an outcome flows along every path that joins them: causal paths leave the treatment along the arrows, backdoor paths start with an arrow into the treatment. A chain or a fork passes association unless you condition on its middle node; a collider (two arrows pointing in) blocks it unless you condition on the collider or one of its descendants. The backdoor criterion says: adjust for a set that blocks every backdoor path and contains no descendant of the treatment. "Control for everything" fails because adjusting for a mediator removes part of the effect and adjusting for a collider creates a fake one; Simpson's paradox is the same question in table form, and the graph, not the data, says which table to trust.
**Use this when:** you choose the control variables of a regression or a propensity model, read "after controlling for …", see a trend reverse when the data is split by a third variable, or analyse a sample that was filtered on something the treatment or the outcome affects.
**Not this doc:** potential outcomes, the ATE (average treatment effect) and randomized tests → `machine-learning/causal-inference/potential-outcomes-and-experiments.md`; the estimators once the adjustment set is chosen → `machine-learning/causal-inference/estimating-effects-from-observational-data.md`; learning the graph itself from data (causal discovery) is not covered.

## Problem
Control variables are often picked because they are available: put every column in the regression. In the lab's structural model, where the true total effect of `T` on `Y` is 2.0, the coefficient on `T` was 2.723 with no controls, 1.992 with the confounder, 0.996 after adding a mediator and −0.500 after adding a variable that both `T` and `Y` cause ✅[^9]. All four regressions fit the data; nothing in the data alone says which one answers the causal question, because the same distribution can come from different causal structures ✅[^3].

## Mental model
**Analogy:** plumbing between the treatment and the outcome. Association is water that flows through every pipe connecting them. Causal pipes run downstream from the treatment; backdoor pipes reach the treatment from behind. Conditioning on a variable turns the valve at that junction. At an ordinary junction (a chain or a fork) turning the valve shuts the flow. A collider is a junction where two pipes meet head-on: it is shut by default, and turning its valve (or one further downstream) opens it. The job is to shut every backdoor pipe, keep the causal pipes open and leave the colliders alone.

**Artifact:** the graph used in the lab, drawn by hand from the `edges` set of the full script in the Worked example (the script does not print it), then the three junctions measured on simulated data (`corr(A,B | Z)` is the correlation of `A` and `B` after regressing each on `Z`), whose correlations that script prints; lab run (`machine-learning/lab-setup.md`), 2026-11-25, numpy 2.5.5 ✅[^9]:

```text
X ──▶ T        T ──▶ Y           direct effect 1.0
X ──▶ Y        T ──▶ M ──▶ Y     mediated effect 0.5 × 2.0 = 1.0
               T ──▶ C ◀── Y     C is a collider
```

```text
chain  A -> Z -> B    corr(A,B) =  0.577   corr(A,B | Z) = -0.001
fork   A <- Z -> B    corr(A,B) =  0.501   corr(A,B | Z) =  0.000
collider A -> Z <- B  corr(A,B) = -0.003   corr(A,B | Z) = -0.501
```

Conditioning on the middle node removes the association in a chain and a fork, and creates one (−0.501) between two independent causes of a collider.

## How it works
### Reading a DAG
1. **Nodes and arrows.** Each node is a variable and each arrow a direct causal effect; a missing arrow asserts that there is no direct effect, which is an assumption that must be justified ✅[^1]. The graph has no cycles, so feedback is drawn as a sequence of events over time ✅[^1].
2. **Where the graph comes from.** A DAG is built from prior knowledge (theory, earlier studies, experts) about the specific setting the data describes, not read off the data ✅[^1].
3. **Paths and colliders.** A path is any sequence of adjacent nodes, whatever the arrow directions; a node is a collider on a path when both arrows on that path point into it ✅[^2]. In the lab graph `T → C ← Y` makes `C` a collider, `T → M → Y` makes `M` a mediator, and `T ← X → Y` makes `X` a confounder: it causes both the treatment and the outcome ✅[^1].

### d-separation in plain terms
1. **Blocking rule.** A set `Z` of conditioning variables blocks a path when the path has a node that is either a non-collider in `Z`, or a collider such that neither it nor any of its descendants is in `Z` ✅[^2]. `Z` d-separates two variables when it blocks every path between them ✅[^2].
2. **Why it matters.** Under the causal Markov condition, d-separation implies conditional independence in the data; it is a sufficient condition, not a necessary one ✅[^2]. The three lab junctions show the rule: chain and fork correlations drop to 0 given the middle node, the collider correlation jumps from 0 to −0.501 ✅[^9].
3. **As code.** The lab checks each path with exactly the two blocking rules:

   ```python
   for prev, mid, nxt in zip(p, p[1:], p[2:]):
       collider = (prev, mid) in edges and (nxt, mid) in edges
       if collider and not ({mid} | descendants(mid)) & Z: return False   # collider left alone: blocked
       if not collider and mid in Z: return False                         # non-collider conditioned: blocked
   return True                                                            # path is open
   ```

### The backdoor criterion
1. **Backdoor path:** a path from the treatment to the outcome that starts with an arrow into the treatment, the kind of path the back-door criterion must block ✅[^2], such as `T ← X → Y`; it creates a spurious association driven by `X` ✅[^1]. Cunningham's chapter uses the word more loosely and also lists collider paths that leave the treatment, such as `D → X ← Y`, as backdoor paths ✅[^1]; this doc keeps the stricter definition.
2. **The criterion.** A set `Z` satisfies it for `(T, Y)` when no member of `Z` is a descendant of `T` and every backdoor path is blocked by `Z`; then `P(Y | do(T), Z) = P(Y | T, Z)`, so the intervention can be computed from observed conditional probabilities ✅[^2]. Here `do(T)` means setting `T` by intervention ✅[^2], and `E[Y | do(A)]` is the average causal effect written in that notation ✅[^4].
3. **Identification, then estimation.** Turning an expression with `do(·)` into one over the observed data is called identification ✅[^5]. With a backdoor set `W`, the effect is identified as `Σ_w E[Y | A, W = w] · P(W = w)`: the outcome average within each stratum `w`, weighted by how common the stratum is ✅[^7]. Example: two strata with weights of about 0.5 each and within-stratum differences 0.031 and 0.055 give an adjusted difference of 0.043 (the lab's Simpson table below) ✅[^9].
4. **In regression terms.** Controlling for non-colliders on a backdoor path blocks it, a collider blocks its path as long as you leave it out, and when every backdoor path is closed the remaining association between treatment and outcome is causal ✅[^1].
5. **Several valid sets differ in precision.** In Cunningham's simulation every valid set was unbiased, but the standard deviation of the estimate fell from 22.36 when adjusting only for `X3`, which causes the treatment and has no direct effect on the outcome, to 0.103 when adjusting for `X1` and `X2`, which cause the outcome ✅[^1]. DoWhy can return the maximal valid set, the minimal one, or all of them ✅[^6].
6. **The lab graph.** With `{}` the backdoor `T ← X → Y` is open; `{X}` leaves exactly the two causal paths open (valid); `{M, X}` closes the mediated causal path because `M` is a descendant of `T`; `{C, X}` opens `T → C ← Y` ✅[^9].

### Bad controls
1. **A mediator** carries part of the effect. Adjusting for it leaves only the direct effect: 0.996 instead of the total 2.0 in the lab ✅[^9], where nothing else causes both `M` and `Y`; when something unobserved does, the mediator is also a collider, as in the occupation example below. In Hesslow's example, birth control raises the risk of thrombosis through a blood chemical and lowers it by preventing pregnancy, so the effect of birth control is identified only without conditioning on pregnancy ✅[^3].
2. **A collider** opens a spurious path when adjusted for. In Cunningham's simulation, talent and beauty were drawn independently, yet with "movie star" (caused by both) as a control the coefficient of talent on beauty became −0.276 ✅[^1]. A variable can be both: controlling for occupation closes the mediation path from discrimination to wages and opens a collider path through unobserved ability ✅[^1].
3. **Filtering is conditioning.** Analysing only the movie stars (a sample selected on the collider) already gives a negative talent–beauty correlation ✅[^1].
4. **Without a graph,** Cunningham's emergency rules: include variables you are confident are confounders, include variables that strongly predict the outcome before treatment, and leave out anything that might be an outcome, at least anything measured after the treatment ✅[^8].

### Simpson's paradox
1. **What it is.** An association that holds in every subpopulation reverses or disappears in the aggregate; Pearson (1899) and Yule (1903) described it, and Simpson's 1951 paper gave it its name ✅[^3]. Early COVID-19 (coronavirus disease 2019) data showed a higher case fatality rate in Italy than in China overall, but a higher rate in China within every age group ✅[^3].
2. **Which table to trust** depends on the causal structure, not on the counts: whether to partition by a variable depends on whether doing so identifies the causal relationship; partition by a confounder, not by a mediator ✅[^3]. No statistic can tell the two structures apart, because data generated by one could have been generated by the other ✅[^3].

## Worked example
One script: the four `T`–`Y` paths of the lab graph and their status under four adjustment sets, the graph as a linear structural model with 200,000 units, the three junctions, and a Simpson's-paradox table of 10,000 patients in which severity decides who gets the new drug (80 % of severe and 20 % of mild patients) and the drug adds 6 percentage points to recovery in both groups. Lab run (`machine-learning/lab-setup.md`), 2026-11-25, numpy 2.5.5, two runs identical; lines 11–13 are the Mental model artifact ✅[^9]:

```text
adjust for   T -> Y         T -> C <- Y    T -> M -> Y    T <- X -> Y
{}           open           blocked        open           open
{X}          open           blocked        open           blocked
{M,X}        open           blocked        blocked        blocked
{C,X}        open           open           open           blocked
true total effect 2.0, direct effect 1.0
  Y ~ T           coefficient on T =  2.723
  Y ~ T + X       coefficient on T =  1.992
  Y ~ T + X + M   coefficient on T =  0.996
  Y ~ T + X + C   coefficient on T = -0.500
chain  A -> Z -> B    corr(A,B) =  0.577   corr(A,B | Z) = -0.001
fork   A <- Z -> B    corr(A,B) =  0.501   corr(A,B | Z) =  0.000
collider A -> Z <- B  corr(A,B) = -0.003   corr(A,B | Z) = -0.501
group     drug       patients  recovered   rate
mild      new             986        887   0.900
mild      standard       3960       3346   0.845
severe    new            4038       2233   0.553
severe    standard       1016        530   0.522
all       new            5024       3120   0.621
all       standard       4976       3876   0.779
naive difference -0.158 (SE 0.009)   severity-adjusted (backdoor) difference +0.043 (SE 0.010)   true effect +0.060
```

<details><summary>Full script (prints the output above)</summary>

```python
# Paths and d-separation in a small DAG, regressions that adjust for a confounder, a mediator
# or a collider, the three basic junctions, and Simpson's paradox from a known model (numpy).
import numpy as np
rng = np.random.default_rng(0)

# 1. The DAG: X confounds T and Y, M mediates T -> Y, C is caused by both T and Y.
edges = {("X", "T"), ("X", "Y"), ("T", "M"), ("M", "Y"), ("T", "Y"), ("T", "C"), ("Y", "C")}
nodes = {n for e in edges for n in e}
def children(n): return {b for a, b in edges if a == n}
def descendants(n):
    out, todo = set(), [n]
    while todo:
        for c in children(todo.pop()):
            if c not in out:
                out.add(c); todo.append(c)
    return out
def paths(a, b, seen=()):                              # all simple paths in the skeleton
    if a == b:
        yield (*seen, b); return
    for n in sorted(nodes - set(seen) - {a}):
        if (a, n) in edges or (n, a) in edges:
            yield from paths(n, b, (*seen, a))
def show(p):
    return "".join(p[0] if i == 0 else (" -> " if (p[i - 1], p[i]) in edges else " <- ") + p[i] for i in range(len(p)))
def is_open(p, Z):                                     # d-separation rule for one path
    for prev, mid, nxt in zip(p, p[1:], p[2:]):
        collider = (prev, mid) in edges and (nxt, mid) in edges
        if collider and not ({mid} | descendants(mid)) & Z:
            return False                               # unconditioned collider blocks
        if not collider and mid in Z:
            return False                               # conditioned non-collider blocks
    return True
all_paths = sorted(paths("T", "Y"), key=len)
print(("adjust for   " + "   ".join(f"{show(p):<12}" for p in all_paths)).rstrip())
for Z in [set(), {"X"}, {"X", "M"}, {"X", "C"}]:
    print((f"{'{' + ','.join(sorted(Z)) + '}':<12} " + "   ".join(f"{'open' if is_open(p, Z) else 'blocked':<12}" for p in all_paths)).rstrip())

# 2. The same DAG as a linear structural model; total effect of T on Y = 1.0 + 0.5 * 2.0 = 2.0.
n = 200_000
X = rng.normal(size=n)
T = 0.8 * X + rng.normal(size=n)
M = 0.5 * T + rng.normal(size=n)
Y = 1.0 * T + 2.0 * M + 1.5 * X + rng.normal(size=n)
C = 1.0 * T + 1.0 * Y + rng.normal(size=n)
def coef_on_T(*controls):
    A = np.column_stack([np.ones(n), T, *controls])
    return np.linalg.lstsq(A, Y, rcond=None)[0][1]
print("true total effect 2.0, direct effect 1.0")
for name, ctrl in [("Y ~ T", ()), ("Y ~ T + X", (X,)), ("Y ~ T + X + M", (X, M)), ("Y ~ T + X + C", (X, C))]:
    print(f"  {name:<15} coefficient on T = {coef_on_T(*ctrl):6.3f}")

# 3. The three junctions: correlation of A and B, then partial correlation given the middle node.
def partial_corr(a, b, z):
    ra = a - np.polyval(np.polyfit(z, a, 1), z); rb = b - np.polyval(np.polyfit(z, b, 1), z)
    return np.corrcoef(ra, rb)[0, 1]
A = rng.normal(size=n); chain_mid = A + rng.normal(size=n); chain_B = chain_mid + rng.normal(size=n)
fork_mid = rng.normal(size=n); fork_A = fork_mid + rng.normal(size=n); fork_B = fork_mid + rng.normal(size=n)
B = rng.normal(size=n); coll = A + B + rng.normal(size=n)
for name, a, b, z in [("chain  A -> Z -> B", A, chain_B, chain_mid), ("fork   A <- Z -> B", fork_A, fork_B, fork_mid),
                      ("collider A -> Z <- B", A, B, coll)]:
    print(f"{name:<21} corr(A,B) = {np.corrcoef(a, b)[0, 1]:6.3f}   corr(A,B | Z) = {partial_corr(a, b, z):6.3f}")

# 4. Simpson's paradox: severe patients get the new drug more often; the drug adds +6 points in both groups.
patients = 10_000
severe = rng.random(patients) < 0.5
new_drug = rng.random(patients) < np.where(severe, 0.8, 0.2)
p_recover = np.where(severe, 0.50, 0.85) + 0.06 * new_drug
recovered = rng.random(patients) < p_recover
print("group     drug       patients  recovered   rate")
for g_name, g in [("mild", ~severe), ("severe", severe), ("all", np.ones(patients, bool))]:
    for d_name, d in [("new", new_drug), ("standard", ~new_drug)]:
        k = g & d
        print(f"{g_name:<9} {d_name:<10} {k.sum():8d} {recovered[k].sum():10d}   {recovered[k].mean():.3f}")
rate = lambda k: recovered[k].mean()
var = lambda k: rate(k) * (1 - rate(k)) / k.sum()     # sampling variance of a recovery rate
naive = rate(new_drug) - rate(~new_drug)
naive_se = np.sqrt(var(new_drug) + var(~new_drug))
adjusted = sum(g.mean() * (rate(g & new_drug) - rate(g & ~new_drug)) for g in (severe, ~severe))
adjusted_se = np.sqrt(sum(g.mean() ** 2 * (var(g & new_drug) + var(g & ~new_drug)) for g in (severe, ~severe)))
print(f"naive difference {naive:+.3f} (SE {naive_se:.3f})   severity-adjusted (backdoor) difference"
      f" {adjusted:+.3f} (SE {adjusted_se:.3f})   true effect +0.060")
```

</details>

Reading it, line by line:
- **Path table:** only `{X}` leaves exactly the causal paths (`T -> Y`, `T -> M -> Y`) open and the others blocked; that is the backdoor criterion's answer for the total effect.
- **Regressions agree with the table:** no controls mixes in the open backdoor (2.723); `X` alone recovers 1.992 ≈ 2.0; adding `M` closes the mediated path and leaves the direct effect (0.996 ≈ 1.0); adding `C` opens the collider path and the sign flips (−0.500).
- **Simpson's table:** within mild patients the new drug recovers 0.900 vs 0.845, within severe 0.553 vs 0.522, yet overall 0.621 vs 0.779, because 4,038 of the 5,024 new-drug patients are severe. Severity causes both the drug choice and recovery, so it is a confounder; the stratified estimate `0.5 · 0.031 + 0.5 · 0.055 ≈ +0.043` (SE, standard error, 0.010) is within two standard errors of the true +0.060, the naive −0.158 is 24 standard errors away.
- **The same counts with a mediator:** had the drug itself changed severity (drug → severity → recovery), the aggregate comparison would be the right one and the stratified one wrong; the table cannot tell which story produced it ✅[^3].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Unobserved confounder `U` on a backdoor path | The path stays open; no backdoor adjustment set exists among the observed variables | `T ← U → Y` cannot be blocked without `U` ✅[^1] |
| Controlling for a descendant of a collider | Opens the collider's path, like conditioning on the collider itself | Blocking rule (i) counts descendants ✅[^2] |
| Controlling for a mediator | Estimates the direct effect only (lab 0.996 vs total 2.0) | The criterion forbids descendants of the treatment ✅[^2]; lab ✅[^9] |
| A variable that is mediator and collider at once | Adjusting closes one path and opens another | Occupation in Cunningham's discrimination example ✅[^1] |
| Sample filtered on a common effect (hired, admitted, famous) | Spurious correlation between its causes | Selection on a collider ✅[^1] |
| Post-treatment variable used as a control | Possible mediator or outcome bias | Leave out anything measured after treatment ✅[^8] |
| Extra control that only predicts the outcome | Still unbiased, smaller variance | Lower residual noise ✅[^1] |
| Controlling only for a cause of the treatment | Unbiased if it blocks the backdoors, but noisy (standard deviation 22.36 vs 0.103) | It has no direct effect on the outcome, so much of the outcome's variation stays unexplained ✅[^1] |
| Same table, different causal stories | Opposite correct answers | Statistics alone cannot distinguish them ✅[^3] |
| Feedback loop (A causes B causes A) | Not a DAG | Break the cycle into sequential events ✅[^1] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Draw a DAG and apply the backdoor criterion | Explicit, checkable assumptions; tells you what not to control for ✅[^1] | Missing arrows are assumptions you must defend ✅[^1] |
| DoWhy maximal adjustment set | Usually the fastest way to a valid set ✅[^6] | May include many superfluous variables ✅[^6] |
| DoWhy minimal adjustment set | Fewest variables ✅[^6] | Can take longer and may return no set within its iteration limit ✅[^6] |
| Emergency rules without a DAG | Usable when experts disagree on the graph ✅[^8] | A heuristic: strong outcome predictors are only "probably not colliders" ✅[^8] |
| "Control for everything available" | Nothing to decide | Mediator and collider bias (lab −0.500 vs 2.0) ✅[^9] |

## Takeaways
- Before choosing controls, list every path from treatment to outcome and mark each as causal, backdoor or collider-blocked. [rule-candidate]
- Never add a variable measured after the treatment as a control when the target is the total effect. [rule-candidate]
- Filtering a dataset on a variable the treatment or the outcome affects is conditioning on a collider; check it like a control.
- When a split by a third variable reverses a trend, decide from the causal story whether that variable is a confounder (trust the split) or a mediator (trust the total).
- A valid adjustment set is not unique; among valid sets prefer the one with strong outcome predictors.

## Verification status
- Verified: 57 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [Causal Inference: The Remix, ch. 4 "Directed Acyclic Graphs"](https://mixtape.scunning.com/04-directed_acyclical_graphs) — Scott Cunningham, living (online 2nd edition). Backs: nodes, arrows and missing arrows, graphs from prior knowledge, confounders, backdoor paths, blocking, unobserved confounders, multiple adjustment sets and their precision, the movie-star collider simulation, the discrimination and occupation example. [^1]
- [Causal Models](https://plato.stanford.edu/entries/causal-models/) — Christopher Hitchcock, Stanford Encyclopedia of Philosophy, 2018 (living). Backs: paths and colliders, d-separation and blocking, the Markov condition, the back-door criterion with `do(·)`. [^2]
- [Simpson's Paradox](https://plato.stanford.edu/entries/paradox-simpson/) — Jan Sprenger and Naftali Weinberger, Stanford Encyclopedia of Philosophy, 2021 (revised 2026). Backs: association reversal and its history, the COVID-19 example, the mediator example, partition only when it identifies the causal relationship, structures indistinguishable from statistics. [^3]
- [DoWhy: Estimating Causal Effects](https://www.pywhy.org/dowhy/v0.14/user_guide/causal_tasks/estimating_causal_effects/index.html) — PyWhy contributors, living (v0.14 docs; library not installed in the lab). Backs: `E[Y | do(A)]` as the average causal effect. [^4]
- [DoWhy: Identifying causal effect](https://www.pywhy.org/dowhy/v0.14/user_guide/causal_tasks/estimating_causal_effects/identifying_causal_effect/index.html) — PyWhy contributors, living (v0.14 docs). Backs: identification as removing the do-operator. [^5]
- [DoWhy: Backdoor criterion](https://www.pywhy.org/dowhy/v0.14/user_guide/causal_tasks/estimating_causal_effects/identifying_causal_effect/backdoor.html) — PyWhy contributors, living (v0.14 docs). Backs: maximal, minimal and exhaustive backdoor sets and their costs. [^6]
- [DoWhy: Estimating average causal effect using backdoor](https://www.pywhy.org/dowhy/v0.14/user_guide/causal_tasks/estimating_causal_effects/effect_estimation_with_backdoor/index.html) — PyWhy contributors, living (v0.14 docs). Backs: the backdoor adjustment formula. [^7]
- [Causal Inference: The Remix, ch. 5 "Unconfoundedness"](https://mixtape.scunning.com/05-causal_cross_sectional_designs) — Scott Cunningham, living. Backs: covariate selection without a DAG. [^8]
- `machine-learning/lab-setup.md` — the lab where the path-checker, structural-model, junction and Simpson's-paradox script ran on 2026-11-25. [^9]

## Related
- `machine-learning/causal-inference/potential-outcomes-and-experiments.md` — selection bias in potential-outcome terms, and why randomization removes every backdoor.
- `machine-learning/causal-inference/estimating-effects-from-observational-data.md` — regression, weighting and doubly robust estimators for a chosen adjustment set.
- `machine-learning/data-and-features/partial-dependence-and-shapley-values.md` — why feature attributions of a predictive model are not causal effects.
- `machine-learning/evaluation/data-leakage.md` — post-treatment variables have a predictive-modelling cousin: features computed after the label.
- `machine-learning/supervised-learning/linear-regression.md` — the regressions whose coefficients this doc interprets.
