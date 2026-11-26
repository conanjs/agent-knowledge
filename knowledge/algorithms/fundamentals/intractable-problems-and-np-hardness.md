---
schema: knowledge-doc/v1
type: concept
topic: algorithms/fundamentals
status: verified
applies-to: ["any language", "measurements: CPython 3.15.2 (arm64)"]
last-verified: 2026-11-25
last-updated: 2026-11-26
tags: [algorithms, complexity, np-hard, np-complete, p-vs-np, exponential, travelling-salesman, knapsack, approximation, lower-bound]
ranked-sources: true
---

# Intractable problems: exponential growth, P, NP and NP-hardness for practitioners

## Summary
**TL;DR:** Some requirements ("the shortest route through all stops", "the fewest boxes", "the best set of items under a budget") are NP-hard: nobody knows an algorithm that solves every instance in polynomial time, and most researchers believe none exists. That does not make them impossible; it means exact answers cost exponential time, so they work for small n only. In the lab (Python 3.15.2), a brute-force search over all 2ⁿ subsets cost about 0.14 µs per subset and stayed under 1 second only up to n = 22; Held–Karp dynamic programming solved a 17-city tour in 0.8 s where brute force would have tried 2.1 × 10¹³ tours. For larger n, use pseudo-polynomial algorithms, approximation algorithms with a proven guarantee, heuristics, or a solver.
**Use this when:** a feature asks for the "best" assignment, route, packing, schedule or selection; code that is fine at 10 items dies at 30; or someone says "that's NP-hard" and you need to know what follows.
**Not this doc:** growth classes in general and what each allows at a given n → `growth-classes-and-feasible-input-sizes.md`; the notation → `asymptotic-notation-and-cases.md`; dynamic programming technique → `techniques/dynamic-programming-and-greedy.md`; recursion costs → `recurrences-and-the-master-theorem.md`.

## Problem
A requirement sounds like ordinary code: "assign 100 dormitory places among 400 students so that no two incompatible students share", "visit every customer once with the shortest drive". A first version tries every combination and passes its tests at 10 items. Production has 40, and the same code would run for days. Each item added multiplies the work instead of adding to it. Without the vocabulary, teams either keep tuning constant factors on a search that cannot finish, or give up on a problem that has good approximate answers. The dormitory example is the Clay Mathematics Institute's own: checking a proposed list is easy, but the number of ways to choose 100 students from 400 is greater than the number of atoms in the known universe ✅[^clay].

## Mental model
**Analogy:** a combination lock. Checking whether one code opens it takes a second. Finding the code without knowing it means trying codes, and each extra digit multiplies the number of codes by 10. NP-hard problems are like that: a proposed answer is quick to check, but no known method finds one without, in the worst case, a search whose size multiplies with every extra item.

**Artifact: what exponential growth means in numbers.** 2ⁿ is the number of subsets of n items (each item is in or out); n! ("n factorial", 1 × 2 × … × n) is the number of orders of n items. Assuming a fast loop of 10⁹ simple steps per second:

| n | 2ⁿ | n! |
|---|---|---|
| 10 | 1,024 | 3.6 × 10⁶ |
| 20 | 1.0 × 10⁶ | 2.4 × 10¹⁸ |
| 30 | 1.1 × 10⁹ | 2.7 × 10³² |
| 40 | 1.1 × 10¹² | 8.2 × 10⁴⁷ |
| 60 | 1.2 × 10¹⁸ | 8.3 × 10⁸¹ |

- Largest n within 1 second at 10⁹ steps per second: 2²⁹ = 536,870,912 fits, 2³⁰ = 1,073,741,824 does not, so n = 29 for 2ⁿ; 12! = 479,001,600 fits, 13! = 6,227,020,800 does not, so n = 12 for n!.
- A computer 1,000 times faster adds only about 10 to n for 2ⁿ, because 2¹⁰ = 1,024. For n² code the same speed-up multiplies n by about 32 (√1,000 ≈ 31.6).
- The measured version of this table, with a real loop in Python, is in the Worked example: there the 1-second limits were n = 22 and n = 10.

## How it works
**Actors:** a *problem* (for example "is there a tour shorter than k?"), an *algorithm* that solves it, a *checker* that verifies a proposed answer (a "certificate"), and a *reduction* that turns one problem into another.

1. **Decision versus optimization.** Complexity classes are defined for yes/no questions. "Is there a tour of length less than k?" is a decision problem; "what is the shortest tour?" is the optimization version. When the decision version is NP-complete, the optimization version is NP-hard ✅[^nist-nphard].

2. **P: solvable in polynomial time.** Informally, P is the class of decision problems that some algorithm solves within a number of steps bounded by a fixed polynomial in the input length ✅[^cook]: n², n³ or n¹⁰⁰, but not 2ⁿ. Example: "is this number a perfect square?" is in P ✅[^cook].

3. **NP: answers checkable in polynomial time.** NP is the class of decision problems whose "yes" answers can be checked by a polynomial-time algorithm given a certificate; it does not require that an answer can be found quickly ✅[^nist-np]. Example: given a proposed tour, it is quick to check that it starts and ends at the same city, visits every other city once and uses real roads ✅[^nist-np]. The name comes from "nondeterministic polynomial time" ✅[^cook]. Every problem in P is in NP ✅[^cook].

4. **Reductions: "if I could solve B, I could solve A".** A is polynomial-time reducible to B when a polynomial-time function turns every instance of A into an instance of B with the same answer ✅[^cook]. Analogy: if you can convert any recipe in grams to one in cups in a minute, a cook who handles cups handles grams too. Then B is at least as hard as A.

5. **NP-complete: the hardest problems in NP.** A problem is NP-complete if it is in NP and every problem in NP reduces to it ✅[^cook]. Cook showed in 1971 that satisfiability (SAT: can the variables of a Boolean formula be set so that it is true?) is NP-complete, and a year later Karp showed 20 more natural problems are ✅[^cook]. A polynomial algorithm for one NP-complete problem would give one for all of them ✅[^erickson-np].

6. **NP-hard: at least as hard, not necessarily in NP.** A problem is NP-hard if a polynomial-time algorithm for it would imply a polynomial-time algorithm for every problem in NP ✅[^erickson-np]. Optimization problems such as "the shortest tour" are NP-hard rather than NP-complete because a claimed optimum has no quick check ✅[^nist-nphard].

7. **The open question.** "Does P = NP?" is unsolved ✅[^cook]; the Clay Mathematics Institute lists it as one of its seven Millennium Prize Problems ✅[^erickson-np]. Most complexity theorists believe P ≠ NP ✅[^cook]. So "NP-hard" in practice means: no polynomial algorithm is known, and one is not expected. It does not mean unsolvable. Exact algorithms exist, just not polynomial ones ✅[^eppstein]; the best proven upper bound for 3-SAT stated in Cook's description is about 1.5ⁿ (the number of variables is n) ✅[^cook], far below 2ⁿ but still exponential.

8. **Pseudo-polynomial time.** Subset sum (is there a subset of n numbers that adds up to T?) has a dynamic-programming algorithm in O(nT) time. That is polynomial in the value T, not in the input's length: T written in binary takes only about log₂ T bits, so T can be exponentially larger than the input ✅[^erickson-np]. Such algorithms are called pseudo-polynomial, and problems that have one are weakly NP-hard; problems that stay NP-hard even when all numbers are small are strongly NP-hard ✅[^erickson-np]. Example: with n = 100 amounts in cents and a budget of T = 50,000 cents, O(nT) is about 5 × 10⁶ steps, cheap; the same algorithm with amounts of 10¹⁵ is hopeless.

9. **A proven lower bound, for contrast.** For most problems we only know upper bounds (an algorithm). Sorting by comparisons is one of the few with a proven lower bound: a comparison sort can be drawn as a binary decision tree, it needs at least n! leaves (one per possible order), so its height, the worst-case number of comparisons, is at least log₂ n!, which is Ω(n log n) ✅[^mit-sort]. Merge sort and heap sort are therefore optimal in this model ✅[^mit-sort]. The bound applies only to comparisons: integers in a small range can be sorted in O(n) with counting or radix sort ✅[^mit-sort]. Nothing comparable is proven for NP-hard problems; that missing proof is the P versus NP question.

**Recognising hard problems in requirements:**

| Requirement sounds like | Named problem | Status |
|---|---|---|
| "Visit every stop once, shortest total route" | Travelling salesman ✅[^nist-tsp] | NP-hard (optimization); strongly NP-hard ✅[^erickson-np] |
| "Choose items with the most value that fit a weight or budget limit" | 0-1 knapsack ✅[^nist-knapsack] | Decision version NP-complete ✅[^nist-knapsack] |
| "Pack items into the fewest fixed-size boxes, trucks or machines" | Bin packing ✅[^nist-binpacking] | NP-complete decision version ✅[^nist-npc] |
| "Fewest teams, sites or features that together cover every requirement" | Set cover ✅[^nist-setcover] | NP-hard (it generalizes vertex cover, which is NP-hard) ✅[^erickson-approx] |
| "Give conflicting meetings, exams or radio channels different slots, using as few as possible" | Graph colouring ✅[^erickson-np] | NP-hard, even "can 3 slots suffice?" ✅[^erickson-np] |
| "Find settings that satisfy all these rules at once" | Satisfiability (SAT) ✅[^cook] | NP-complete ✅[^cook] |
| "Assign jobs to machines so the last one finishes as early as possible" | Load balancing (makespan scheduling) ✅[^erickson-approx] | NP-hard, strongly ✅[^erickson-approx] |
| "Longest route without repeating a place" | Longest simple path ✅[^erickson-np] | NP-hard, while the shortest path is polynomial ✅[^erickson-np] |

## Worked example
**Run 1: the wall.** A brute-force subset-sum search over n even numbers with an odd target, so no subset matches and the search must try all 2ⁿ subsets. Gray-code order makes each subset cost one addition. Median of 3 timed runs after a warm-up ✅[^lab]:

```text
n, subsets tried, median s (3 runs), ns per subset
  16       65,536    0.010  147.9
  18      262,144    0.036  136.5
  20    1,048,576    0.130  123.8
  22    4,194,304    0.585  139.6
  24   16,777,216    2.159  128.7
projected with 136.5 ns per subset:
  n = 30: 2^n = 1.07e+09 subsets, 2.4 minutes
  n = 40: 2^n = 1.10e+12 subsets, 1.7 days
  n = 50: 2^n = 1.13e+15 subsets, 4.9 years
  n = 60: 2^n = 1.15e+18 subsets, 4,988.2 years
largest n within 1 s at this rate: 2^n -> n = 22, n! -> n = 10
```

<details><summary>Script: subset_wall.py</summary>

```python
# Brute-force subset search: is there a subset of n weights that sums exactly to the target?
# The target is odd and every weight is even, so no subset matches and the search must try all 2^n subsets.
# Gray-code order: each step adds or removes one weight, so one subset costs one addition.
import math, random, statistics, time

def search(ws, target):
    n = len(ws); total = 0; tried = 1
    if total == target: return True, tried
    for k in range(1, 1 << n):
        bit = (k & -k).bit_length() - 1          # the weight that flips at step k
        if (k ^ (k >> 1)) >> bit & 1: total += ws[bit]
        else:                         total -= ws[bit]
        tried += 1
        if total == target: return True, tried
    return False, tried

rnd = random.Random(1)
print("n, subsets tried, median s (3 runs), ns per subset")
rate = []
for n in [16, 18, 20, 22, 24]:
    ws = [2 * rnd.randrange(1, 10**6) for _ in range(n)]
    target = sum(ws) // 2 | 1
    search(ws, target)                            # warm-up
    runs = []
    for _ in range(3):
        t0 = time.perf_counter(); found, tried = search(ws, target); runs.append(time.perf_counter() - t0)
    t = statistics.median(runs); rate.append(t / tried)
    print(f"  {n:>2} {tried:>12,} {t:8.3f} {t / tried * 1e9:6.1f}")
per = statistics.median(rate)

def human(sec):
    for unit, size in [("years", 365.25 * 86400), ("days", 86400), ("hours", 3600), ("minutes", 60)]:
        if sec >= size: return f"{sec / size:,.1f} {unit}"
    return f"{sec:,.2f} s"

print(f"projected with {per * 1e9:.1f} ns per subset:")
for n in [30, 40, 50, 60]:
    print(f"  n = {n}: 2^n = {2 ** n:.2e} subsets, {human(2 ** n * per)}")
best2 = max(n for n in range(1, 80) if 2 ** n * per <= 1)
bestf = max(n for n in range(1, 30) if math.factorial(n) * per <= 1)
print(f"largest n within 1 s at this rate: 2^n -> n = {best2}, n! -> n = {bestf}")
```

</details>

- Each +2 to n multiplies the subsets by 4 and the time by about 4 (0.585 s at n = 22, 2.159 s at n = 24).
- The cost per subset stayed near 0.14 µs, so the time is set by 2ⁿ alone. At this rate 1 second covers n = 22 for 2ⁿ and n = 10 for n!, below the 29 and 12 of the 10⁹-steps table, because one Python step costs about 0.14 µs instead of 1 ns.
- Projected: 2.4 minutes at n = 30, 1.7 days at n = 40, 4.9 years at n = 50. A 100× faster language moves the 1-second limit from 22 to about 28 (2⁶ = 64, 2⁷ = 128), not to 2,200.

**Run 2: exact but smarter.** The shortest tour through n random points, by brute force over all (n − 1)! orders and by Held–Karp dynamic programming. Held–Karp computes, for every subset A of cities and every city v in A, the shortest path from the start through all of A ending at v, and extends it one city at a time ✅[^eppstein]. Both methods must give the same length ✅[^lab]:

```text
n, method, steps, seconds, shortest tour
   8 brute force        5,040    0.002 2.808508
   8 Held-Karp          1,344    0.000 2.808508
   9 brute force       40,320    0.017 2.849347
   9 Held-Karp          3,584    0.001 2.849347
  10 brute force      362,880    0.226 3.059293
  10 Held-Karp          9,216    0.003 3.059293
  11 brute force    3,628,800    1.951 3.577777
  11 Held-Karp         23,040    0.005 3.577777
  14 Held-Karp        319,488    0.100 3.013169   (brute force would try 6,227,020,800 tours)
  17 Held-Karp      3,932,160    0.783 3.601544   (brute force would try 20,922,789,888,000 tours)
```

<details><summary>Script: tsp_exact.py</summary>

```python
# Exact travelling salesman: brute force over all tours versus Held-Karp dynamic programming.
# Both return the length of the shortest tour; the script checks they agree and counts the steps.
import itertools, math, random, time

def points(n, seed):
    rnd = random.Random(seed)
    return [(rnd.random(), rnd.random()) for _ in range(n)]

def dist_matrix(p):
    return [[math.dist(a, b) for b in p] for a in p]

def brute(d):                                    # fix city 0, try every order of the other n-1
    n = len(d); best = math.inf; tours = 0
    for perm in itertools.permutations(range(1, n)):
        tours += 1
        length = d[0][perm[0]] + d[perm[-1]][0]
        for a, b in zip(perm, perm[1:]): length += d[a][b]
        if length < best: best = length
    return best, tours

def held_karp(d):                                # L[A][v]: shortest path 0 -> ... -> v covering set A
    n = len(d); full = 1 << (n - 1); steps = 0
    L = [[math.inf] * (n - 1) for _ in range(full)]
    for v in range(n - 1): L[1 << v][v] = d[0][v + 1]
    for A in range(1, full):
        for v in range(n - 1):
            if not (A >> v) & 1 or L[A][v] == math.inf: continue
            for u in range(n - 1):
                if (A >> u) & 1: continue
                steps += 1
                B = A | (1 << u); c = L[A][v] + d[v + 1][u + 1]
                if c < L[B][u]: L[B][u] = c
    best = min(L[full - 1][v] + d[v + 1][0] for v in range(n - 1))
    return best, steps

print("n, method, steps, seconds, shortest tour")
for n in [8, 9, 10, 11]:
    d = dist_matrix(points(n, n))
    t0 = time.perf_counter(); b1, tours = brute(d); t1 = time.perf_counter()
    b2, steps = held_karp(d); t2 = time.perf_counter()
    assert abs(b1 - b2) < 1e-9
    print(f"  {n:>2} brute force  {tours:>11,} {t1 - t0:8.3f} {b1:.6f}")
    print(f"  {n:>2} Held-Karp    {steps:>11,} {t2 - t1:8.3f} {b2:.6f}")
for n in [14, 17]:
    d = dist_matrix(points(n, n))
    t0 = time.perf_counter(); b2, steps = held_karp(d); t1 = time.perf_counter()
    print(f"  {n:>2} Held-Karp    {steps:>11,} {t1 - t0:8.3f} {b2:.6f}   (brute force would try {math.factorial(n - 1):,} tours)")
```

</details>

- Same answers at n = 8 to 11; the script stops if they differ.
- Brute force grew ×9 then ×10 per added city ((n − 1)! tours) and took 1.95 s at n = 11. Held–Karp's step count is (n − 1)(n − 2)·2ⁿ⁻³: at n = 10, 9 × 8 × 128 = 9,216, as printed; that is O(n²·2ⁿ) ✅[^eppstein].
- Held–Karp solved n = 17 in 0.78 s with 3.9 million steps (about 0.2 µs per step); brute force would need 16! ≈ 2.1 × 10¹³ tours. It is still exponential: each extra city roughly doubles it. At n = 25 the formula gives 24 × 23 × 2²² ≈ 2.3 × 10⁹ steps, about 2.3 × 10⁹ × 0.2 µs ≈ 460 s, and a table of 2²⁴ × 24 entries.

**Run 3: a proven lower bound, observed.** Python's `sorted()` on shuffled input, with comparisons counted, against log₂ n! ✅[^lab]:

```text
n, comparisons made, log2(n!), n*log2(n), comparisons / log2(n!)
    1,000       8,630       8,529       9,966  1.012
   10,000     120,104     118,458     132,877  1.014
  100,000   1,531,693   1,516,704   1,660,964  1.010
```

<details><summary>Script: sort_lower_bound.py</summary>

```python
# Comparison-sort lower bound: any comparison sort needs at least log2(n!) comparisons in the worst case.
# Count the comparisons Python's sorted() makes on shuffled input and compare with log2(n!).
import math, random
from functools import cmp_to_key

def count_compares(xs):
    c = 0
    def cmp(a, b):
        nonlocal c; c += 1
        return (a > b) - (a < b)
    sorted(xs, key=cmp_to_key(cmp))
    return c

print("n, comparisons made, log2(n!), n*log2(n), comparisons / log2(n!)")
for n in [1000, 10000, 100000]:
    xs = list(range(n)); random.Random(n).shuffle(xs)
    c = count_compares(xs); lb = math.lgamma(n + 1) / math.log(2)
    print(f"  {n:>7,} {c:>11,} {lb:>11,.0f} {n * math.log2(n):>11,.0f}  {c / lb:.3f}")
```

</details>

- At every size the count is just above log₂ n! (1.010 to 1.014 times it), as the lower bound requires: no comparison sort can do better in the worst case ✅[^mit-sort]. log₂ n! is below n·log₂ n by about 1.44·n (8,529 versus 9,966 at n = 1,000).

## Edge cases
| Case | What happens | Why |
|---|---|---|
| n is small and fixed (under about 20 items) | Brute force or Held–Karp is fine | 2²⁰ ≈ 10⁶; run 2 solved 17 cities in under a second ✅[^lab] |
| The numbers are small integers (cents, minutes, units) | Pseudo-polynomial dynamic programming, O(nT) for subset sum, is fast | The cost grows with the value T, not exponentially in n ✅[^erickson-np] |
| Distances obey the triangle inequality (going direct is never longer) | A minimum spanning tree gives a tour within 2× the optimum; Christofides' algorithm within 1.5× ✅[^erickson-approx] | Without the triangle inequality, no polynomial algorithm guarantees a near-optimal tour unless P = NP ✅[^nist-tsp] |
| You only need to check an answer, not find one | Polynomial | That is what NP means ✅[^nist-np] |
| Most real instances | Solvers often find optimal or good answers fast | Polynomial time is defined on the worst-case run time ✅[^cook]; OR-Tools' routing solver "sometimes returns solutions that are good, but not optimal" ✅[^ortools-routing] |
| Integer keys in a known range | Sorting in O(n), beating n log n | The comparison lower bound does not apply to non-comparison sorts ✅[^mit-sort] |
| "NP-hard" confused with "undecidable" | NP-hard problems are solvable; slowly | Exponential algorithms exist ✅[^eppstein] |

## Trade-offs
What to do when the requirement is NP-hard:

| Option | Gains | Costs |
|---|---|---|
| Exact exponential algorithm (brute force with pruning, Held–Karp O(n²·2ⁿ) ✅[^eppstein]) | The true optimum | Works only up to small n: in run 2, 17 cities took 0.78 s and each extra city about doubles it ✅[^lab] |
| Pseudo-polynomial dynamic programming (knapsack, subset sum, O(nT)) | Exact and fast when the numbers are small | Useless when T is huge; only for weakly NP-hard problems ✅[^erickson-np] |
| Approximation algorithm with a proven guarantee: greedy load balancing within 2× the best makespan, sorted greedy within 1.5× ✅[^erickson-approx]; greedy set cover within a logarithmic factor of the smallest cover, the best ratio possible, up to lower-order terms, unless P = NP ✅[^erickson-approx] | Polynomial time and a promise on quality | Not optimal; the guarantee can be loose |
| Approximation scheme with an accuracy parameter ε; it is an FPTAS (fully polynomial-time approximation scheme) when its running time also grows only polynomially as ε shrinks, for example O(n²/ε²); Erickson gives one for subset sum ✅[^erickson-approx] | Choose your own accuracy | Slower as ε shrinks |
| Heuristics and local search (greedy first, then improve by swaps), branch and bound | Fast, often very good in practice | No guaranteed time bound ✅[^eppstein]; no guarantee on quality unless one is proven |
| Constraint or integer solver (for example OR-Tools CP-SAT) | Model the rules, let a mature search find answers; status `OPTIMAL` means proven optimal, `FEASIBLE` means a solution "but we don't know if it's optimal" ✅[^ortools-cpsat] | Run time is unpredictable; set a time limit and accept `FEASIBLE` |

## Takeaways
- When a requirement says "best", "fewest" or "shortest" over combinations, check it against the recognition table before coding a search. [rule-candidate]
- NP-hard means "no known polynomial algorithm", not "impossible": exact for small n, approximate or solver-based for large n.
- A faster machine adds only a little to n for 2ⁿ: 1,000× faster adds about 10.
- Prefer an algorithm with a stated guarantee (2×, 1.5×, O(log n)) over an unbounded heuristic when quality must be defended. [rule-candidate]
- Small integer values make knapsack-like problems tractable via pseudo-polynomial dynamic programming.
- Comparison sorting cannot beat log₂ n! comparisons; non-comparison sorts can.

## Verification status
- Verified: 63 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [The P versus NP Problem](https://www.claymath.org/wp-content/uploads/2022/06/pvsnp.pdf) — Stephen Cook, official problem description for the Clay Mathematics Institute. Rank 1. Backs: definitions of P (via worst-case run time), NP, p-reducibility and NP-complete; P ⊆ NP; perfect squares in P; Cook 1971 and Karp's 20 problems; most theorists believe P ≠ NP; 3-SAT bound about 1.5ⁿ; SAT. [^cook]
- [P vs NP](https://www.claymath.org/millennium/p-vs-np/) — Clay Mathematics Institute, living. Rank 1. Backs: the dormitory example. [^clay]
- [CP-SAT Solver](https://developers.google.com/optimization/cp/cp_solver) — Google OR-Tools documentation, living. Rank 1. Backs: CP-SAT status values `OPTIMAL` and `FEASIBLE`. [^ortools-cpsat]
- [Vehicle Routing](https://developers.google.com/optimization/routing) — Google OR-Tools documentation, living. Rank 1. Backs: routing solver may return good but not optimal solutions. [^ortools-routing]
- [NP](https://xlinux.nist.gov/dads/HTML/np.html) — NIST Dictionary of Algorithms and Data Structures, modified 2021-01-05. Rank 3. Backs: definition of NP and the tour-checking example. [^nist-np]
- [NP-complete](https://xlinux.nist.gov/dads/HTML/npcomplete.html) — NIST DADS, modified 2021-04-26. Rank 3. Backs: bin packing (decision version) is NP-complete. [^nist-npc]
- [NP-hard](https://xlinux.nist.gov/dads/HTML/nphard.html) — NIST DADS (CRC-A), modified 2021-01-05. Rank 3. Backs: decision NP-complete implies optimization NP-hard; the shortest tour is NP-hard. [^nist-nphard]
- [traveling salesman](https://xlinux.nist.gov/dads/HTML/travelingSalesman.html) — NIST DADS, modified 2021-07-26. Rank 3. Backs: definition; no guaranteed near-optimal polynomial algorithm without the triangle inequality unless P = NP. [^nist-tsp]
- [knapsack problem](https://xlinux.nist.gov/dads/HTML/knapsackProblem.html) — NIST DADS, modified 2021-07-26. Rank 3. Backs: definition; decision problem NP-complete. [^nist-knapsack]
- [bin packing problem](https://xlinux.nist.gov/dads/HTML/binpacking.html) — NIST DADS, modified 2020-11-02. Rank 3. Backs: definition. [^nist-binpacking]
- [set cover](https://xlinux.nist.gov/dads/HTML/setcover.html) — NIST DADS, modified 2020-11-02. Rank 3. Backs: definition. [^nist-setcover]
- [Algorithms, chapter 12: NP-Hardness](https://jeffe.cs.illinois.edu/teaching/algorithms/book/12-nphard.pdf) — Jeff Erickson, University of Illinois, 2019. Rank 3. Backs: NP-hard definition; one NP-complete solved implies all; P vs NP among the seven Millennium Prize Problems; subset sum O(nT), pseudo-polynomial, weakly and strongly NP-hard; travelling salesman strongly NP-hard; graph colouring and 3-colouring NP-hard; longest path NP-hard. [^erickson-np]
- [Algorithms, extended notes J: Approximation Algorithms](https://jeffe.cs.illinois.edu/teaching/algorithms/notes/J-approx.pdf) — Jeff Erickson, University of Illinois. Rank 3. Backs: load balancing strongly NP-hard; set cover generalizes vertex cover, which is NP-hard; greedy 2× and sorted greedy 1.5×; MST tour 2× and Christofides 1.5×; greedy set cover O(log) as best possible unless P = NP; FPTAS for subset sum. [^erickson-approx]
- [Lecture 7: Linear-Time Sorting](https://ocw.mit.edu/courses/6-006-introduction-to-algorithms-fall-2011/bf7d79105762bf79bbc0925438e1468a_MIT6_006F11_lec07.pdf) — MIT OpenCourseWare 6.006, Fall 2011. Rank 3. Backs: comparison model, decision tree, n! leaves, Ω(n lg n), optimal sorts, counting and radix sort beat it for small integers. [^mit-sort]
- [Exact TSP algorithm (CS 163/265, lecture 5b)](https://www.ics.uci.edu/~eppstein/163/lecture5b.pdf) — David Eppstein, University of California, Irvine. Rank 3. Backs: exact algorithms exist but not polynomial ones; the O(n²·2ⁿ) dynamic program [Bellman 1962; Held and Karp 1962] and its subproblem; practical methods without guaranteed time bounds. [^eppstein]
- Lab run, 2026-11-25: Docker image `python:3.15.2-slim` (CPython 3.15.2, Debian 13, arm64) run with `--network none` and `python -I` on an Apple M2, macOS 26.1, Docker under OrbStack. The three scripts are embedded above; counts and tour lengths are deterministic, timings change from run to run. [^lab]

## Related
- `algorithms/fundamentals/growth-classes-and-feasible-input-sizes.md` — the full catalog of growth classes and affordable n.
- `algorithms/fundamentals/asymptotic-notation-and-cases.md` — what O, Ω and Θ claim; worst case versus typical case.
- `algorithms/fundamentals/recurrences-and-the-master-theorem.md` — why naive recursion can be exponential.
- `algorithms/techniques/dynamic-programming-and-greedy.md` — memoization and greedy choices, the tools behind Held–Karp and the approximations.
- `algorithms/fundamentals/measuring-complexity-empirically.md` — measuring growth by doubling.
- `algorithms/fundamentals/complexity-and-big-o.md` — the growth classes, measured.
