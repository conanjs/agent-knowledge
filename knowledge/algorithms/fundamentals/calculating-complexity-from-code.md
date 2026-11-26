---
schema: knowledge-doc/v1
type: how-to
topic: algorithms/fundamentals
status: verified
applies-to: ["any language; library costs shown for Python 3.15", "measurements: CPython 3.15.2 (arm64)"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [algorithms, complexity, big-o, loops, logarithm, arithmetic-series, counting, doubling, python]
ranked-sources: true
---

# Calculate the time complexity of code by counting

## Summary
**TL;DR:** Pick the size variable, pick one statement to count, then combine: code in sequence adds, nested loops multiply, an inner loop that starts at the outer index gives n(n − 1)/2, a loop that halves or doubles gives about log₂ n, and an early exit splits best from worst case. Library calls count too: `x in list`, slicing and `sorted` inside a loop each hide a loop of their own. In the lab, every formula below matched the counted steps exactly at n = 1,000, 2,000 and 4,000.
**Use this when:** you review a function and want its cost before running it, you suspect a hidden quadratic, or you want to check a derivation with a counter.
**Not this doc:** what O, Ω, Θ and the cases mean → `asymptotic-notation-and-cases.md`; recursive code → `recurrences-and-the-master-theorem.md`; timing-based measurement → `measuring-complexity-empirically.md`; memory → `space-complexity.md`.

## Goal & prerequisites
**End state:** for a function you wrote, a formula for how many times its main step runs as a function of the input size, simplified to a growth class (for example "worst case n(n − 1)/2, so Θ(n²)"), and a counter run that confirms it.

**You need:**
- The code, and the official cost table for any library calls it makes (for Python: "Time complexity of operations on built-in types" ✅[^py-tc]).
- An interpreter to run a counter. The runs here used CPython 3.15.2 in Docker (see References).
- The arithmetic used below:
  - **Arithmetic series:** 0 + 1 + 2 + … + (n − 1) = n(n − 1)/2. Example, n = 4: 0 + 1 + 2 + 3 = 6 = 4 × 3 / 2.
  - **log₂ n:** the number of times n must be divided by 2 to reach 1 ✅[^cph]. Example: 1,024 → 512 → … → 1 takes 10 halvings, so log₂ 1,024 = 10. For 1,000 the answer is 9.97; a loop that halves with integer division runs ⌊log₂ n⌋ = 9 times (⌊x⌋, "floor", rounds down; ⌈x⌉, "ceiling", rounds up).

**Analogy for the whole procedure:** pricing a building job. You do not time every worker; you pick one unit of work (bricks laid), count how many bricks each part of the plan needs, add the parts, and multiply where a part repeats ("10 walls of 500 bricks each").

## Steps
1. **Pick the size variable(s).** Name the input that the work grows with: usually n is the array size or the string length ✅[^cph]. If two inputs grow independently (n orders, m products), keep two letters: a loop over n with an inner loop over m is O(nm) ✅[^cph].

2. **Pick one statement to count.** Total running time is the cost of each statement times how often it runs ✅[^algs4-14], so choose a cost model that names the basic operation the algorithm is about (a comparison, an array access) ✅[^algs4-14]. In a nested loop that is usually the innermost statement. Below, the counted statement is `ops += 1`.

3. **Code in sequence adds.** Two loops one after the other cost n + n = 2n. In growth terms, the slowest phase decides: phases of O(n), O(n²) and O(n) give O(n²) in total ✅[^cph].
```python
for i in range(n): ops += 1
for i in range(n): ops += 1          # predicted: 2n
```

4. **Nested loops multiply.** An inner loop of n steps inside an outer loop of n steps runs n × n = n² times; k nested loops over n give O(nᵏ) ✅[^cph].
```python
for i in range(n):
    for j in range(n): ops += 1      # predicted: n^2
```

5. **An inner bound that depends on the outer index gives a series.** If the inner loop starts at i + 1, it runs n − 1 times, then n − 2, …, then 0. Sum: (n − 1) + (n − 2) + … + 0 = n(n − 1)/2. That is half of n² minus a little, still O(n²) ✅[^cph]. This is the shape of "compare every pair once".
```python
for i in range(n):
    for j in range(i + 1, n): ops += 1   # predicted: n(n-1)/2
```

6. **A loop that halves or doubles runs about log₂ n times.** Halving n until it reaches 1 takes ⌊log₂ n⌋ steps; doubling from 1 until reaching n takes ⌈log₂ n⌉ steps. Algorithms that halve the input at each step are logarithmic for this reason ✅[^cph]. Inside an outer loop over n, it multiplies like any other loop: n·⌊log₂ n⌋.
```python
while n > 1: n //= 2; ops += 1       # predicted: floor(log2 n)
```

7. **An early exit splits the best case from the worst.** A search that stops at the first match runs once if the target is first (best case) and n times if it is missing (worst case). The best case is the input that takes the least time, the worst case the input that takes the most ✅[^nist-best] ✅[^nist-worst]. Report the worst case unless you know the input distribution; say which one you report.

Counted results of steps 3–7, each against its formula ✅[^lab].

```text
sequence     n=1,000 counted=     2,000 2n=     2,000 match
sequence     n=2,000 counted=     4,000 2n=     4,000 match
sequence     n=4,000 counted=     8,000 2n=     8,000 match
nested       n=1,000 counted= 1,000,000 n^2= 1,000,000 match
nested       n=2,000 counted= 4,000,000 n^2= 4,000,000 match
nested       n=4,000 counted=16,000,000 n^2=16,000,000 match
triangle     n=1,000 counted=   499,500 n(n-1)/2=   499,500 match
triangle     n=2,000 counted= 1,999,000 n(n-1)/2= 1,999,000 match
triangle     n=4,000 counted= 7,998,000 n(n-1)/2= 7,998,000 match
halving      n=1,000 counted=         9 floor(log2 n)=         9 match
halving      n=2,000 counted=        10 floor(log2 n)=        10 match
halving      n=4,000 counted=        11 floor(log2 n)=        11 match
doubling     n=1,000 counted=        10 ceil(log2 n)=        10 match
doubling     n=2,000 counted=        11 ceil(log2 n)=        11 match
doubling     n=4,000 counted=        12 ceil(log2 n)=        12 match
n x halving  n=1,000 counted=     9,000 n*floor(log2 n)=     9,000 match
n x halving  n=2,000 counted=    20,000 n*floor(log2 n)=    20,000 match
n x halving  n=4,000 counted=    44,000 n*floor(log2 n)=    44,000 match
search       n=1,000 best (first item)= 1 worst (missing)=1,000
search       n=2,000 best (first item)= 1 worst (missing)=2,000
search       n=4,000 best (first item)= 1 worst (missing)=4,000
```

<details><summary>Script: counts.py</summary>

```python
# Count the basic step of each loop shape and compare with the predicted formula.
import math

def sequence(n):            # two loops, one after the other
    ops = 0
    for i in range(n): ops += 1
    for i in range(n): ops += 1
    return ops

def nested(n):              # a loop inside a loop, both over n
    ops = 0
    for i in range(n):
        for j in range(n): ops += 1
    return ops

def triangle(n):            # inner loop starts after the outer index
    ops = 0
    for i in range(n):
        for j in range(i + 1, n): ops += 1
    return ops

def halving(n):             # how many times can you halve n?
    ops = 0
    while n > 1:
        n //= 2; ops += 1
    return ops

def doubling(n):            # how many doublings from 1 to reach n?
    ops = 0; i = 1
    while i < n:
        i *= 2; ops += 1
    return ops

def loop_times_halving(n):  # an O(log n) loop inside an O(n) loop
    ops = 0
    for i in range(n):
        j = n
        while j > 1:
            j //= 2; ops += 1
    return ops

def linear_search(a, target):  # stops at the first match
    ops = 0
    for x in a:
        ops += 1
        if x == target: break
    return ops

rules = [
    ("sequence", sequence, lambda n: 2 * n, "2n"),
    ("nested", nested, lambda n: n * n, "n^2"),
    ("triangle", triangle, lambda n: n * (n - 1) // 2, "n(n-1)/2"),
    ("halving", halving, lambda n: math.floor(math.log2(n)), "floor(log2 n)"),
    ("doubling", doubling, lambda n: math.ceil(math.log2(n)), "ceil(log2 n)"),
    ("n x halving", loop_times_halving, lambda n: n * math.floor(math.log2(n)), "n*floor(log2 n)"),
]
for name, fn, formula, text in rules:
    for n in (1_000, 2_000, 4_000):
        got, want = fn(n), formula(n)
        print(f"{name:<12} n={n:>5,} counted={got:>10,} {text}={want:>10,} {'match' if got == want else 'DIFF'}")
for n in (1_000, 2_000, 4_000):
    a = list(range(n))
    print(f"{'search':<12} n={n:>5,} best (first item)={linear_search(a, 0):>2} worst (missing)={linear_search(a, -1):>5,}")
```

</details>

Note how the log rows grow: doubling n adds exactly one step (9 → 10 → 11), while the n² rows multiply by 4.

8. **Look up every library call inside a loop.** A call is a loop you cannot see. Replace it with its documented cost, in terms of the sizes it touches:

| Call (Python) | Documented cost | Inside a loop over n items |
|---|---|---|
| `x in some_list` | O(n) ✅[^py-tc] | O(n²) if the list grows to n |
| `some_list[i:j]` | O(j − i) ✅[^py-tc] | `a[i:]` for each i copies n(n + 1)/2 items |
| `some_list.sort()` / `sorted()` | O(n log n) ✅[^py-tc] | m sorts cost O(m·n log n) |
| `some_list.insert(k, x)`, `pop(k)` | O(n − k); index 0 is the worst case ✅[^py-tc] | `pop(0)` in a loop is O(n²) |
| `x in some_set`, `key in some_dict` | O(1) on average ✅[^py-tc] | O(n) on average |
| `s + t` on strings | O(len(s) + len(t)); building a string by repeated concatenation is quadratic in its total length ✅[^py-tc] ✅[^py-stdtypes] | see the measurement below |

Counted with objects that count their own comparisons ✅[^lab].

```text
n=1,000 dedupe list:   499,500 eq calls (n(n-1)/2=  499,500)  dedupe set: 0 eq calls
n=2,000 dedupe list: 1,999,000 eq calls (n(n-1)/2=1,999,000)  dedupe set: 0 eq calls
n=4,000 dedupe list: 7,998,000 eq calls (n(n-1)/2=7,998,000)  dedupe set: 0 eq calls
n=1,000 suffix slices copy   500,500 items (n(n+1)/2=  500,500)
n=2,000 suffix slices copy 2,001,000 items (n(n+1)/2=2,001,000)
n=4,000 suffix slices copy 8,002,000 items (n(n+1)/2=8,002,000)
n=1,000 sorted() x 10 queries:  86,470 lt calls (10*n*log2 n=   99,658)
n=2,000 sorted() x 10 queries: 193,290 lt calls (10*n*log2 n=  219,316)
n=4,000 sorted() x 10 queries: 426,540 lt calls (10*n*log2 n=  478,631)
```

<details><summary>Script: hidden.py</summary>

```python
# Library calls inside a loop: count the work the call does for you.
import math, random

class Item:
    # Wraps an int and counts the comparisons Python makes on it.
    eq = 0; lt = 0
    def __init__(self, v): self.v = v
    def __eq__(self, o): Item.eq += 1; return self.v == o.v
    def __lt__(self, o): Item.lt += 1; return self.v < o.v
    def __hash__(self): return hash(self.v)

def dedupe_list(items):     # `in` on a list scans it
    seen = []
    for x in items:
        if x not in seen: seen.append(x)
    return seen

def dedupe_set(items):      # `in` on a set hashes once
    seen = set(); out = []
    for x in items:
        if x not in seen: seen.add(x); out.append(x)
    return out

def suffix_slices(a):       # a[i:] copies n - i items
    copied = 0
    for i in range(len(a)): copied += len(a[i:])
    return copied

def sort_per_query(a, queries):  # sorted() inside a loop over queries
    for q in range(queries): sorted(a)

random.seed(3)
for n in (1_000, 2_000, 4_000):
    items = [Item(v) for v in random.sample(range(10 * n), n)]
    Item.eq = 0; dedupe_list(items); by_list = Item.eq
    Item.eq = 0; dedupe_set(items); by_set = Item.eq
    print(f"n={n:>5,} dedupe list: {by_list:>9,} eq calls (n(n-1)/2={n*(n-1)//2:>9,})  dedupe set: {by_set} eq calls")
for n in (1_000, 2_000, 4_000):
    print(f"n={n:>5,} suffix slices copy {suffix_slices(list(range(n))):>9,} items (n(n+1)/2={n*(n+1)//2:>9,})")
for n in (1_000, 2_000, 4_000):
    items = [Item(v) for v in random.sample(range(10 * n), n)]
    Item.lt = 0; sort_per_query(items, 10)
    print(f"n={n:>5,} sorted() x 10 queries: {Item.lt:>7,} lt calls (10*n*log2 n={10*n*math.log2(n):>9,.0f})")
```

</details>

Reading it: the list version of "dedupe" is the triangle of step 5 in disguise (0 + 1 + … + (n − 1) comparisons, since all items are distinct). The set version made no equality calls at all, because distinct integers had distinct hashes. `sorted()` used about 0.87–0.89 × n·log₂ n comparisons (86,470 / 99,658 ≈ 0.87): the formula gives the growth, the constant is the library's own.

**String concatenation, timed** (median of 5 runs, milliseconds) ✅[^lab].

```text
       n    s += x  s = x + s     join
  50,000    1.60ms    28.80ms   0.83ms
 100,000    3.21ms   136.64ms   1.67ms
 200,000    6.35ms   590.37ms   3.33ms
 400,000   12.53ms  2007.71ms   6.57ms
```

<details><summary>Script: concat.py</summary>

```python
# Build a string of n pieces three ways; median of 5 timed runs after a warm-up.
import statistics, time

def append_plus(n):
    s = ""
    for _ in range(n): s += "x"
    return s

def prepend_plus(n):
    s = ""
    for _ in range(n): s = "x" + s
    return s

def join_list(n):
    parts = []
    for _ in range(n): parts.append("x")
    return "".join(parts)

def median_ms(fn, n):
    fn(n)
    runs = []
    for _ in range(5):
        t = time.perf_counter(); fn(n); runs.append((time.perf_counter() - t) * 1e3)
    return statistics.median(runs)

print(f"{'n':>8} {'s += x':>9} {'s = x + s':>10} {'join':>8}")
for n in (50_000, 100_000, 200_000, 400_000):
    print(f"{n:>8,} {median_ms(append_plus, n):>7.2f}ms {median_ms(prepend_plus, n):>8.2f}ms {median_ms(join_list, n):>6.2f}ms")
```

</details>

The documented rule says repeated concatenation is quadratic. In this run, prepending (`s = "x" + s`) grew ×3.4 to ×4.7 per doubling (136.64 / 28.80 ≈ 4.7; 2,007.71 / 590.37 ≈ 3.4), as quadratic code should. Appending with `s += "x"` grew ×2.0, the same as `join`. CPython has an in-place optimization for `a += b` on strings, but its own style guide says not to rely on it: it is fragile even in CPython and absent in implementations without reference counting ✅[^pep8]. Derive with the documented cost; treat the fast `+=` as a lucky implementation detail, and use `"".join(parts)` ✅[^py-stdtypes].

9. **Recursion: count calls times work per call.** A recursive function costs (number of calls) × (work in one call) ✅[^cph]. A function that calls itself once on n − 1 makes n calls, so O(n); one that calls itself twice on n − 1 makes 1 + 2 + 4 + … + 2ⁿ⁻¹ = 2ⁿ − 1 calls, so O(2ⁿ) ✅[^cph]. When calls split the input (merge sort, binary search), write the cost as a recurrence and solve it with `recurrences-and-the-master-theorem.md`.

10. **Simplify to a growth class and name the case.** Keep the exact formula for checking, then drop constants and smaller terms for the summary: n(n − 1)/2 = n²/2 − n/2 → Θ(n²); n·⌊log₂ n⌋ → Θ(n log n). The notation and what it promises are in `asymptotic-notation-and-cases.md`.

## Verify
**Check 1, by counting:** add a counter to the statement you chose in step 2, run at n, 2n and 4n, and compare with your formula. It must match exactly for deterministic code, as every row in step 7 did.

**Check 2, by doubling:** divide the count at 2n by the count at n. The base-2 logarithm of that ratio is the exponent b in "grows like nᵇ": ratio 2 → b = 1 (linear), ratio 4 → b = 2 (quadratic), ratio 8 → b = 3 (cubic). Example: 1,999,000 / 499,500 ≈ 4.002, and log₂ 4.002 ≈ 2.001.

**Full run on a new function.** `has_duplicate` slices and searches inside a loop. Derivation: for index i, the slice copies n − i − 1 items and `in` makes up to n − i − 1 comparisons. With no duplicates (the worst case, no early exit), the total is 2 × [(n − 1) + (n − 2) + … + 0] = 2 × n(n − 1)/2 = n(n − 1). Expected output: steps equal to n(n − 1), ratio near 4, exponent near 2 ✅[^lab].

```text
n=1,000 steps=   999,000 predicted n(n-1)=   999,000
n=2,000 steps= 3,998,000 predicted n(n-1)= 3,998,000 ratio=4.002 exponent=2.001
n=4,000 steps=15,996,000 predicted n(n-1)=15,996,000 ratio=4.001 exponent=2.000
```

<details><summary>Script: verify.py</summary>

```python
# Confirm a derivation: count the steps at n, 2n, 4n and read the doubling ratio.
import math

class Item:
    eq = 0
    def __init__(self, v): self.v = v
    def __eq__(self, o): Item.eq += 1; return self.v == o.v

def has_duplicate(a):
    copied = 0
    for i in range(len(a)):
        rest = a[i + 1:]; copied += len(rest)   # slice: copies n - i - 1 items
        if a[i] in rest:                         # `in`: up to n - i - 1 comparisons
            return True, copied
    return False, copied

prev = None
for n in (1_000, 2_000, 4_000):
    Item.eq = 0
    found, copied = has_duplicate([Item(v) for v in range(n)])   # no duplicates: the worst case
    steps = Item.eq + copied
    line = f"n={n:>5,} steps={steps:>10,} predicted n(n-1)={n * (n - 1):>10,}"
    if prev:
        ratio = steps / prev
        line += f" ratio={ratio:.3f} exponent={math.log2(ratio):.3f}"
    print(line); prev = steps
```

</details>

The fix follows from the derivation: a set built once makes the loop O(n) on average.

Counting is exact; timing the same doubling is noisier and has its own pitfalls (fixed costs at small sizes, caches): see `measuring-complexity-empirically.md` and the scaling harness in `performance/code-review/perf-reviewer-calibration.md` §7.

## Troubleshooting
| Symptom | Cause | Fix |
|---|---|---|
| Formula says O(n), timing grows like n² | A library call inside the loop is O(n) (`in` on a list, `pop(0)`, slicing) ✅[^py-tc] | Look up every call in the cost table (step 8) and multiply |
| Count matches at n = 1,000 but the doubling ratio is not 2 or 4 | A log factor: n log n gives about 2.2 per doubling at these sizes | Compare with n·log₂ n, as the `sorted()` rows do (193,290 / 86,470 ≈ 2.24) |
| Two people get different answers for the same code | One reports the best case (early exit taken), the other the worst | Name the case; for searches, test with a missing target |
| "O(n)" for code that loops over orders, then over products | Two sizes merged into one n | Keep both: O(n·m) ✅[^cph] |
| A halving loop counted as n steps | The loop variable is divided, not decremented | Count halvings: ⌊log₂ n⌋ (9 at n = 1,000) |
| Formula and count differ by 1 at each size | Off-by-one in the bounds (`range(i, n)` vs `range(i + 1, n)`, `<` vs `<=`) | Write the series term by term for n = 4 and add it up |
| Fast `s += piece` in testing, slow elsewhere | CPython's in-place string optimization is fragile and not in every implementation ✅[^pep8] | Build a list and `"".join` it ✅[^py-stdtypes] |
| An "O(1)" append is occasionally slow | Amortized cost: a resize is O(n) for that one call ✅[^py-tc] | See `amortized-analysis.md` |
| Recursive function analysed like a loop | Calls branch: two calls per level double the work each level ✅[^cph] | Count calls (step 9) or solve the recurrence |
| Timing doubling shows exponent below 1 for quadratic code | Fixed costs dominate at small sizes ✅[^lab-cal] | Use counts, or larger sizes; see `performance/code-review/perf-reviewer-calibration.md` §7 |

## Takeaways
- Derive with one counted statement and exact formulas first; simplify to O, Θ only at the end. [rule-candidate]
- Every library call inside a loop gets its documented cost multiplied in. [rule-candidate]
- Inner loops starting at the outer index are still quadratic: n(n − 1)/2.
- Confirm a derivation with a counter at n, 2n, 4n: the ratio tells the exponent.
- Do not rely on CPython's fast `s += piece`; use `"".join`. [rule-candidate]

## Verification status
- Verified: 34 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [Time complexity of operations on built-in types](https://docs.python.org/3/library/time-complexity.html) — Python Software Foundation, Python 3.15 docs, living. Rank 1. Backs: costs of `in`, slicing, sort, insert, pop, set/dict membership, `s + t`, amortized append. [^py-tc]
- [Built-in Types: common sequence operations, note 6](https://docs.python.org/3/library/stdtypes.html) — Python Software Foundation, living. Rank 1. Backs: repeated concatenation is quadratic; `str.join` or `io.StringIO` instead. [^py-stdtypes]
- [PEP 8: Style Guide for Python Code, Programming Recommendations](https://peps.python.org/pep-0008/) — Python project, living. Rank 1. Backs: CPython's in-place string concatenation is fragile; use `''.join()`. [^pep8]
- [best case](https://xlinux.nist.gov/dads/HTML/bestcase.html) — NIST Dictionary of Algorithms and Data Structures, living. Rank 3. Backs: best case definition. [^nist-best]
- [worst case](https://xlinux.nist.gov/dads/HTML/worstcase.html) — NIST Dictionary of Algorithms and Data Structures, living. Rank 3. Backs: worst case definition. [^nist-worst]
- [1.4 Analysis of Algorithms](https://algs4.cs.princeton.edu/14analysis/) — Robert Sedgewick and Kevin Wayne, Algorithms 4th edition site, living. Rank 3. Backs: running time as cost × frequency of each statement; cost models. [^algs4-14]
- [Competitive Programmer's Handbook](https://cses.fi/book/book.pdf) — Antti Laaksonen, 2018, chapter 2 "Time complexity". Rank 3. Backs: n as input size, nested loops O(nᵏ), phases, several variables O(nm), log₂ n as halvings, recursion as calls × cost per call. [^cph]
- Lab run, 2026-11-25: Docker image `python:3.15.2-slim` (CPython 3.15.2, Debian 13, arm64) run with `--network none` and `python -I` on an Apple M2, macOS 26.1, Docker under OrbStack. The four scripts are embedded above; counts are deterministic, timings vary by a few percent per run. [^lab]
- `performance/code-review/perf-reviewer-calibration.md` §7.1 — measured run where a quadratic fixture fitted a slope of 0.94 at too-small sizes. [^lab-cal]

## Related
- `algorithms/fundamentals/asymptotic-notation-and-cases.md` — what the resulting O, Ω, Θ and the case mean.
- `algorithms/fundamentals/complexity-and-big-o.md` — the growth classes, measured.
- `algorithms/fundamentals/recurrences-and-the-master-theorem.md` — the cost of recursive code.
- `algorithms/fundamentals/space-complexity.md` — counting memory instead of time.
- `algorithms/fundamentals/measuring-complexity-empirically.md` — doubling experiments with timings.
- `algorithms/fundamentals/amortized-analysis.md` — costs spread over many operations.
- `algorithms/data-structures/data-structure-catalog.md` — operation costs to plug into step 8.
