---
schema: knowledge-doc/v1
type: concept
topic: algorithms/fundamentals
status: verified
applies-to: ["any language", "measurements: CPython 3.15.2 (arm64)"]
last-verified: 2026-11-25
last-updated: 2026-11-26
tags: [algorithms, complexity, big-o, omega, theta, little-o, tilde, worst-case, average-case, expected, amortized]
ranked-sources: true
---

# Asymptotic notation (O, Ω, Θ, o, ~) and the cases it describes

## Summary
**TL;DR:** O says "grows at most like", Ω (Omega) says "at least like", Θ (Theta) says "exactly like, up to constant factors", little-o says "grows strictly slower than", and ~ (tilde) keeps the leading constant. Best, worst, average, expected and amortized case are a separate choice: first you pick *which* cost function you describe, then you pick a notation to describe it. Quicksort's worst case is Θ(n²) and its average is ~2n ln n; both are true at once. In the lab (both sorts written in pure Python, CPython 3.15.2, random integers), a Θ(n²) insertion sort beat a Θ(n log n) merge sort up to n = 64.
**Use this when:** you read or write a complexity claim and need to know exactly what it promises, you compare two algorithms by their notation, or a "fast" algorithm loses on small inputs.
**Not this doc:** the growth classes and doubling, measured → `complexity-and-big-o.md`; deriving the cost of your own code → `calculating-complexity-from-code.md`; spreading occasional costs → `amortized-analysis.md`.

## Problem
"This is O(n log n)" is read as "this takes n log n time", "this is the worst case", or "this is faster than any O(n²) code". None of these follow from the notation. Engineers then pick the wrong algorithm for small inputs, miss a worst case that an attacker can trigger, or argue past each other because one means the average and the other the worst case.

## Mental model
**Analogy:** describing a person's height without measuring it exactly. "Shorter than 2 m" is an upper bound (like O). "Taller than 1.5 m" is a lower bound (like Ω). "Between 1.7 m and 1.8 m" pins it down on both sides (like Θ). All three can be true about the same person. Whose height you describe (the shortest player in the team, the tallest, the average) is a different question: that is the "case".

**Symbols used below:**
- **n**: the input size, usually the number of items in an array or the length of a string ✅[^cph]. Example: sorting 1,000 numbers has n = 1,000.
- **f(n)**: the cost being described, for example the number of comparisons at size n. Example: f(n) = 3n² + 10n + 5 gives f(10) = 300 + 100 + 5 = 405.
- **g(n)**: the simple comparison function, such as n² or n log n.
- **c, k**: two fixed numbers that make a bound true: "f(n) ≤ c·g(n) for every n ≥ k".
- **log n**: the logarithm. log₂ n is how many times you can halve n before reaching 1: log₂ 1,024 = 10. ln n is the natural logarithm: ln 1,000 ≈ 6.91.

**Artifact:** one function, f(n) = 3n² + 10n + 5, divided by each candidate g(n) ✅[^lab].

```text
        n             f(n)        f/n    f/n^2      f/n^3  f/(3n^2)
       10              405       40.5   4.0500   0.405000   1.35000
      100           31,005      310.1   3.1005   0.031005   1.03350
    1,000        3,010,005     3010.0   3.0100   0.003010   1.00334
   10,000      300,100,005    30010.0   3.0010   0.000300   1.00033
1,000,000 3,000,010,000,005  3000010.0   3.0000   0.000003   1.00000
O(n^2) with c=4: fails for n = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
Omega(n^2) with c=3: failures in 1..100000 = 0
```

<details><summary>Script: bounds.py</summary>

```python
# Test f(n) = 3n^2 + 10n + 5 against O, Omega, Theta, little-o and tilde.
def f(n):
    return 3 * n * n + 10 * n + 5

print(f"{'n':>9} {'f(n)':>16} {'f/n':>10} {'f/n^2':>8} {'f/n^3':>10} {'f/(3n^2)':>9}")
for n in (10, 100, 1_000, 10_000, 1_000_000):
    v = f(n)
    print(f"{n:>9,} {v:>16,} {v / n:>10.1f} {v / n**2:>8.4f} {v / n**3:>10.6f} {v / (3 * n * n):>9.5f}")

# Check the witnesses c = 4, k = 11 for O(n^2) and c = 3, k = 1 for Omega(n^2).
upper_fails = [n for n in range(1, 100_001) if f(n) > 4 * n * n]
lower_fails = [n for n in range(1, 100_001) if f(n) < 3 * n * n]
print("O(n^2) with c=4: fails for n =", upper_fails)
print("Omega(n^2) with c=3: failures in 1..100000 =", len(lower_fails))
```

</details>

How to read each column:

| Column | Trend as n grows | What it shows |
|---|---|---|
| f/n | Grows without limit | f is **not** O(n): no constant c keeps f below c·n |
| f/n² | Settles at 3 | f is Θ(n²): O(n²) and Ω(n²) both hold |
| f/n³ | Falls toward 0 | f is o(n³), and so also O(n³) |
| f/(3n²) | Goes to 1 | f ~ 3n² (tilde keeps the 3) |

## How it works
**The five notations.** Each is a claim about a function f compared with g, for large n.

| Notation | Read as | Formal claim | Tested on f(n) = 3n² + 10n + 5 |
|---|---|---|---|
| f = O(g) | at most like g | there are fixed c > 0, k with 0 ≤ f(n) ≤ c·g(n) for all n ≥ k ✅[^nist-o] | O(n²) with c = 4, k = 11: at n = 11, 3·121 + 110 + 5 = 478 ≤ 484 = 4·121; at n = 10, 405 > 400, so k cannot be 10 ✅[^lab] |
| f = Ω(g) | at least like g | there are fixed c > 0, k with 0 ≤ c·g(n) ≤ f(n) for all n ≥ k ✅[^nist-omega] | Ω(n²) with c = 3, k = 1: 3n² + 10n + 5 ≥ 3n² for every n ≥ 1 |
| f = Θ(g) | like g, up to constants | there are fixed c₁, c₂ > 0, k with c₁·g(n) ≤ f(n) ≤ c₂·g(n) for all n ≥ k; it is called an asymptotically tight bound ✅[^nist-theta] | Θ(n²) with c₁ = 3, c₂ = 4, k = 11 |
| f = o(g) | strictly slower than g | for **every** c > 0 there is a k with f(n) < c·g(n) for all n ≥ k; k may depend on c ✅[^nist-littleo] | o(n³): f/n³ falls to 0.000003 at n = 1,000,000. Not o(n²): f/n² stays near 3, never below 1 |
| f ~ g | ratio goes to 1 | f(n)/g(n) approaches 1 as n grows ✅[^algs4-14] | f ~ 3n²: the ratio is 1.00334 at n = 1,000 |

Three rules follow from the table:
1. **O is only a ceiling.** 3n + 4 is O(n²) as well as O(n); big-O is often misused to mean "equal to", which is what Θ says ✅[^nist-o]. Example: "binary search is O(n)" is true and useless.
2. **The constants c and k are fixed.** They must not depend on n ✅[^nist-o]. This is why constant factors and lower-order terms vanish: 3n² + 10n + 5 and 0.001n² are both Θ(n²).
3. **Tilde keeps what O throws away.** Tilde approximations drop the lower-order terms but keep the leading coefficient, in the form g(n) ~ a·f(n) ✅[^algs4-14]. "~n²/2 compares" tells you more than "O(n²) compares": it predicts 500,000 at n = 1,000 (1,000² / 2).

**What n is, and two sizes.** Pick n as the size of the input the cost grows with: the array length, the string length ✅[^cph]. When the cost depends on two independent sizes, keep both: a loop over n items with an inner loop over m items is O(nm) ✅[^cph]; breadth-first search over a graph with V vertices and E edges takes time proportional to V + E in the worst case ✅[^algs4-41]. Do not merge them into one n unless you know how they relate. Example: a simple graph has at most V(V − 1)/2 edges, so for V = 1,000 the term E ranges from 0 to 499,500; V + E is "about V" for a sparse graph and "about V²" for a dense one.

**The cases: a separate axis.** Before choosing a notation, choose which cost function you describe:

| Case | Which cost function | Source of the definition |
|---|---|---|
| Best case | The input that takes the least time or resources | ✅[^nist-best] |
| Worst case | The input that forces the most time or resources | ✅[^nist-worst] |
| Average case | The average over all inputs; choosing the inputs and the kind of average is itself a decision | ✅[^nist-avg] |
| Expected case | The average over the algorithm's own random choices, for one fixed input (for example a shuffle first) | Shuffling protects quicksort from its worst case ✅[^algs4-23] |
| Amortized | The worst total of any sequence of n operations, divided by n | O(f(n)) amortized when every sequence of n operations costs at most O(n·f(n)) ✅[^nist-amort] |

Crossing the two axes, with real algorithms:

| Algorithm | Best | Worst | Average or expected | Amortized |
|---|---|---|---|---|
| Quicksort | — | Θ(n²) ✅[^nist-quick]; ~n²/2 compares ✅[^algs4-23] | ~2n ln n compares on average for distinct keys ✅[^algs4-23] | — |
| Python `set` / `dict` membership | — | O(n) when every key hashes to the same value ✅[^py-tc] | O(1) ✅[^py-tc] | — |
| Python `list.append` | — | O(n) for the one append that resizes ✅[^py-tc] | — | O(1) ✅[^py-tc] |
| Python `list.sort` | O(n) comparisons for sorted or reverse-sorted input ✅[^py-tc] | O(n log n) ✅[^py-tc] | — | — |

Every cell is a separate function of n, and each can be stated with O, Ω or Θ. "Quicksort is O(n log n)" with no case named is a claim about the typical case, not a guarantee.

## Worked example
**Question:** insertion sort is Θ(n²) and merge sort is Θ(n log n). Which is faster for n = 8 … 512, written in the same language?

**Prediction from the notation alone:** none. Θ hides the constants c₁ and c₂ and only holds for n ≥ k, so it cannot say where the crossover is.

**Counts first.** Quicksort with the first element as pivot, n = 1,000 ✅[^lab].

```text
quicksort n=1000: sorted input 499,500 compares, shuffled input 11,267 compares
set lookup n=1,000: good hash 1.0 eq calls per lookup, constant hash 607.3 eq calls per lookup
set lookup n=2,000: good hash 1.0 eq calls per lookup, constant hash 1069.0 eq calls per lookup
```

<details><summary>Script: cases.py</summary>

```python
# Best, worst and average case of the same algorithm, counted.
import random

def quicksort_compares(a):
    # First-element pivot, iterative, counts comparisons with the pivot.
    a = list(a); compares = 0; stack = [(0, len(a) - 1)]
    while stack:
        lo, hi = stack.pop()
        if lo >= hi:
            continue
        pivot = a[lo]; i = lo
        for j in range(lo + 1, hi + 1):
            compares += 1
            if a[j] < pivot:
                i += 1; a[i], a[j] = a[j], a[i]
        a[lo], a[i] = a[i], a[lo]
        stack.append((lo, i - 1)); stack.append((i + 1, hi))
    return compares

class Key:
    # An int key whose equality checks are counted; hash is either real or constant.
    eq_calls = 0
    def __init__(self, v, collide):
        self.v = v; self.collide = collide
    def __hash__(self):
        return 42 if self.collide else hash(self.v)
    def __eq__(self, other):
        Key.eq_calls += 1
        return self.v == other.v

def lookup_eq_calls(n, collide):
    s = {Key(v, collide) for v in range(n)}
    Key.eq_calls = 0
    for v in range(n):
        assert Key(v, collide) in s
    return Key.eq_calls / n

random.seed(1)
n = 1_000
shuffled = random.sample(range(n), n)
print(f"quicksort n={n}: sorted input {quicksort_compares(range(n)):,} compares, "
      f"shuffled input {quicksort_compares(shuffled):,} compares")
for n in (1_000, 2_000):
    print(f"set lookup n={n:,}: good hash {lookup_eq_calls(n, False):.1f} eq calls per lookup, "
          f"constant hash {lookup_eq_calls(n, True):.1f} eq calls per lookup")
```

</details>

Reading the counts:
- Sorted input hits the worst case exactly: 999 + 998 + … + 1 = 1,000 × 999 / 2 = 499,500 compares, which is the ~n²/2 of the worst-case row.
- Shuffled input took 11,267 compares. The tilde estimate 2n ln n = 2 × 1,000 × 6.908 ≈ 13,816 is the leading term only; at n = 1,000 the lower-order terms still shift the count by about 18% (11,267 / 13,816 ≈ 0.82). Tilde describes the limit, not the exact count at a given n.
- The same set holds 1,000 keys in both rows; only the hash differs. A good hash needs about 1 equality check per lookup; a constant hash needs about 607, and about 1,069 at n = 2,000. Same code, same n, two cases.

**Then time.** Median of 7 runs, pure Python, microseconds per sort ✅[^lab].

```text
    n  insertion us  merge us     faster
    8           0.9       2.9  insertion
   16           2.7       7.1  insertion
   32           9.2      15.7  insertion
   64          33.2      35.6  insertion
  128         130.3      82.1      merge
  256         506.6     187.0      merge
  512        1956.6     395.9      merge
```

<details><summary>Script: crossover.py</summary>

```python
# Insertion sort (Theta(n^2)) against merge sort (Theta(n log n)), both pure Python.
import random, statistics, time

def insertion_sort(a):
    a = list(a)
    for i in range(1, len(a)):
        x = a[i]; j = i - 1
        while j >= 0 and a[j] > x:
            a[j + 1] = a[j]; j -= 1
        a[j + 1] = x
    return a

def merge_sort(a):
    if len(a) <= 1:
        return list(a)
    mid = len(a) // 2
    left, right = merge_sort(a[:mid]), merge_sort(a[mid:])
    out = []; i = j = 0
    while i < len(left) and j < len(right):
        if left[i] <= right[j]:
            out.append(left[i]); i += 1
        else:
            out.append(right[j]); j += 1
    out.extend(left[i:]); out.extend(right[j:])
    return out

def median_us(sort, inputs, repeats=7):
    sort(inputs[0])  # warm-up
    runs = []
    for _ in range(repeats):
        t = time.perf_counter()
        for a in inputs:
            sort(a)
        runs.append((time.perf_counter() - t) / len(inputs) * 1e6)
    return statistics.median(runs)

random.seed(7)
print(f"{'n':>5} {'insertion us':>13} {'merge us':>9} {'faster':>10}")
for n in (8, 16, 32, 64, 128, 256, 512):
    inputs = [random.sample(range(10 * n), n) for _ in range(max(20, 20_000 // n))]
    ins, mer = median_us(insertion_sort, inputs), median_us(merge_sort, inputs)
    print(f"{n:>5} {ins:>13.1f} {mer:>9.1f} {'insertion' if ins < mer else 'merge':>10}")
```

</details>

**Result:** the quadratic sort wins up to n = 64 and loses from n = 128. The crossover sat between 64 and 128 in all three runs made on 2026-11-25; the times themselves move by a few percent between runs ✅[^lab]. Past the crossover the notation takes over: from 256 to 512 insertion sort grew ×3.9 (1,956.6 / 506.6) and merge sort ×2.1 (395.9 / 187.0), close to the ×4 and ×2.25 that n² and n log₂ n predict (4 and 2 × 9/8).

Production sorts use this: CPython's list sort extends short runs to a minimum length with binary insertion sort ✅[^listsort], and quicksort implementations switch to insertion sort for tiny subarrays, with a cutoff between 5 and 15 likely to work well ✅[^algs4-23].

## Edge cases
Six common misreadings, and two more cases:

| Case | What happens | Why |
|---|---|---|
| "O(n log n) means it takes n log n time" | It does not give a time, or even a count | A complexity shows only the order of magnitude, not how often the loop body runs: 3n, n + 5 and n/2 iterations are all O(n) ✅[^cph] |
| "Big-O means the worst case" | O can bound any of the case functions | The worst case is one choice of input ✅[^nist-worst]; quicksort is "typically O(n log n)" yet Θ(n²) in the worst case ✅[^nist-quick] |
| "Same Big-O, same speed" | Constants can differ many times over | c and k are hidden by definition ✅[^nist-o]; two Θ(n log n) sorts can differ by a constant factor that O never shows |
| "Big-O tells me about my 20-item list" | It says nothing below k | The bound must hold only for n ≥ k ✅[^nist-o]; in the lab, the bound f(n) ≤ 4n² failed for every n from 1 to 10 ✅[^lab] |
| "O(n²) always loses to O(n log n)" | Insertion sort won up to n = 64 in the lab | Small n sits below the crossover ✅[^lab]; libraries switch to insertion sort for short runs ✅[^listsort] |
| "O(n) is the tight bound" | O(n) is also true for O(1) code | Big-O is an upper bound only; Θ is the tight one ✅[^nist-theta] |
| Hash lookup "is O(1)" | Average O(1), worst O(n) | Colliding keys make each lookup scan ✅[^py-tc]; the lab showed 607 equality checks per lookup at n = 1,000 ✅[^lab] |
| Ω used in older mathematics | A weaker meaning: the bound needs to hold only along an unbounded sequence of n | The traditional definition needs the bound only on an unbounded sequence of n, not for all n ≥ k ✅[^nist-omega] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| State Θ with a named case ("worst case Θ(n²)") | Precise; readers know what is promised | Longer; needs both bounds proven |
| State O only | Easy; often all that is known | Can be true and uninformative (binary search is O(n)) |
| State tilde ("~n²/2 compares") | Predicts actual counts at large n | Needs a cost model (what you count) and careful counting ✅[^algs4-14] |
| Measure instead | Shows the real constant and crossover | Holds for one machine, runtime and input set |

## Takeaways
- Always name the case with the notation: "worst case Θ(n²), average ~2n ln n". [rule-candidate]
- Use O for "no worse than", Θ for "exactly this growth", ~ when the constant matters.
- Keep two sizes as two variables (n·m, V + E) until you know how they relate.
- Below a few hundred items, measure; the asymptotically slower algorithm may win.

## Verification status
- Verified: 46 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [Time complexity of operations on built-in types](https://docs.python.org/3/library/time-complexity.html) — Python Software Foundation, Python 3.15 docs, living. Rank 1. Backs: set/dict average O(1) and worst O(n), amortized append, adaptive sort. [^py-tc]
- [listsort.txt](https://github.com/python/cpython/blob/main/Objects/listsort.txt) — CPython project, living. Rank 1. Backs: short runs are extended with binary insertion sort. [^listsort]
- [big-O notation](https://xlinux.nist.gov/dads/HTML/bigOnotation.html) — NIST Dictionary of Algorithms and Data Structures (DADS), living. Rank 3. Backs: definition of O, fixed c and k, misuse as "equal to". [^nist-o]
- [Ω](https://xlinux.nist.gov/dads/HTML/omegaCapital.html) — NIST DADS, living. Rank 3. Backs: definition of Ω and the traditional weaker definition. [^nist-omega]
- [Θ](https://xlinux.nist.gov/dads/HTML/theta.html) — NIST DADS, living. Rank 3. Backs: definition of Θ, asymptotically tight bound. [^nist-theta]
- [little-o notation](https://xlinux.nist.gov/dads/HTML/littleOnotation.html) — NIST DADS, living. Rank 3. Backs: definition of little-o. [^nist-littleo]
- [best case](https://xlinux.nist.gov/dads/HTML/bestcase.html) — NIST DADS, living. Rank 3. Backs: best case definition. [^nist-best]
- [worst case](https://xlinux.nist.gov/dads/HTML/worstcase.html) — NIST DADS, living. Rank 3. Backs: worst case definition. [^nist-worst]
- [average case](https://xlinux.nist.gov/dads/HTML/averagecase.html) — NIST DADS, living. Rank 3. Backs: average case definition and its choice of inputs. [^nist-avg]
- [amortized cost](https://xlinux.nist.gov/dads/HTML/amortizdcost.html) — NIST DADS, 2004. Rank 3. Backs: amortized cost definition. [^nist-amort]
- [quicksort](https://xlinux.nist.gov/dads/HTML/quicksort.html) — NIST DADS, living. Rank 3. Backs: Θ(n²) worst case, typically O(n log n). [^nist-quick]
- [1.4 Analysis of Algorithms](https://algs4.cs.princeton.edu/14analysis/) — Robert Sedgewick and Kevin Wayne, Algorithms 4th edition site, living. Rank 3. Backs: tilde notation and the g(N) ~ a·f(N) form, cost models. [^algs4-14]
- [2.3 Quicksort](https://algs4.cs.princeton.edu/23quicksort/) — Robert Sedgewick and Kevin Wayne, living. Rank 3. Backs: ~2N ln N average and ~N²/2 worst-case compares, shuffling, insertion-sort cutoff 5–15. [^algs4-23]
- [4.1 Undirected Graphs](https://algs4.cs.princeton.edu/41graph/) — Robert Sedgewick and Kevin Wayne, living. Rank 3. Backs: breadth-first search in time proportional to V + E. [^algs4-41]
- [Competitive Programmer's Handbook](https://cses.fi/book/book.pdf) — Antti Laaksonen, 2018, chapter 2. Rank 3. Backs: n as input size, order of magnitude only, several variables O(nm). [^cph]
- Lab run, 2026-11-25: Docker image `python:3.15.2-slim` (CPython 3.15.2, Debian 13, arm64) run with `--network none` and `python -I` on an Apple M2, macOS 26.1, Docker under OrbStack. The three scripts are embedded above; counts are deterministic, timings vary by a few percent per run. [^lab]

## Related
- `algorithms/fundamentals/complexity-and-big-o.md` — growth classes O(1) … O(n²), measured.
- `algorithms/fundamentals/calculating-complexity-from-code.md` — derive the cost function of your own code.
- `algorithms/fundamentals/amortized-analysis.md` — why an occasional expensive step averages out.
- `algorithms/fundamentals/recurrences-and-the-master-theorem.md` — solving the cost of recursive code.
- `algorithms/fundamentals/growth-classes-and-feasible-input-sizes.md` — which classes fit a time budget.
- `algorithms/fundamentals/measuring-complexity-empirically.md` — the doubling experiment.
- `algorithms/data-structures/data-structure-catalog.md` — operation costs of common structures.
- `performance/measurement/benchmarking-methodology.md` — running a fair timing like the crossover above.
