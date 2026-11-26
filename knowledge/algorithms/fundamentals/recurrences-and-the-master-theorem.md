---
schema: knowledge-doc/v1
type: concept
topic: algorithms/fundamentals
status: verified
applies-to: ["any language", "measurements: CPython 3.15.2 (python:3.15.2-slim, arm64)"]
last-verified: 2026-11-25
last-updated: 2026-11-26
tags: [algorithms, complexity, recurrence, master-theorem, recursion-tree, divide-and-conquer, merge-sort, binary-search, fibonacci, karatsuba, strassen]
ranked-sources: true
---

# Recurrences and the master theorem

## Summary
**TL;DR:** A **recurrence** writes the cost of a recursive function in terms of the cost of the same function on smaller inputs, for example T(n) = 2T(n/2) + n for merge sort. You solve it by drawing the **recursion tree** and adding the work level by level, or, when it has the shape T(n) = a·T(n/b) + f(n), by the **master theorem**, which only asks whether the top of the tree, every level equally, or the bottom (the leaves) does most of the work. In the lab, the counted operations matched the solved formulas: binary search ran at most ⌊log₂ n⌋ + 1 iterations, naive Fibonacci made exactly 2·F(n+1) − 1 calls, and merge sort on random input stayed between ½ n log₂ n and n log₂ n comparisons ✅[^lab].
**Use this when:** you need the cost of a recursive or divide-and-conquer function (search, sort, tree walk, multiplication), you read "by the master theorem" in a library's documentation, or a recursive function is unexpectedly slow.
**Not this doc:** what O, Ω and Θ mean → `asymptotic-notation-and-cases.md`; costing loops and straight-line code → `calculating-complexity-from-code.md`; memory used by the recursion stack → `space-complexity.md`; caching repeated subproblems (memoization) → `../techniques/dynamic-programming-and-greedy.md`.

## Problem
Loops are easy to cost: count the iterations. A recursive function hides its loop. `fib(n)` looks like two additions, yet `fib(25)` makes 242,785 calls ✅[^lab]. Merge sort and a naive "split in half and recurse on both halves" can look the same in code and differ by a factor of n in cost. Without a way to turn "calls itself on smaller pieces" into a formula, people guess, and the guess is often wrong by a whole growth class.

Symbols used in this doc:

| Symbol | Meaning | Worked example |
|---|---|---|
| n | Input size (items in the array, digits in the number) | Sorting 1,000 numbers: n = 1,000 |
| T(n) | Total work for input size n, counted in basic steps | T(1,000) = 8,705 comparisons for one merge sort run in the lab ✅[^lab] |
| a | How many recursive calls one call makes | Merge sort: a = 2 (left half, right half) |
| b | By how much each call shrinks the input | Merge sort: b = 2 (each half has n/2 items) |
| f(n) | Work one call does itself, outside its recursive calls | Merge sort: merging n items, f(n) = n |
| log₂ n | How many times you can halve n before reaching 1 | log₂ 1,024 = 10, because 2¹⁰ = 1,024 |
| log_b a | The power x with bˣ = a | log₂ 7 ≈ 2.807, because 2^2.807 ≈ 7 |
| ⌊x⌋ | x rounded down | ⌊log₂ 1,000⌋ = ⌊9.97⌋ = 9 |
| F(n) | The n-th Fibonacci number: F(0) = 0, F(1) = 1, F(n) = F(n−1) + F(n−2) | F(21) = 10,946 |
| φ | The golden ratio, (√5 + 1)/2 ≈ 1.618 | F(25)/F(24) = 75,025/46,368 ≈ 1.618 |

## Mental model
**Analogy:** a recursive function is a manager who splits a job among a few team leads, each of whom splits it again, down to interns who do one small piece. The total cost is everyone's own work added up, manager to interns. A recurrence is that org chart written as an equation, and the master theorem asks one question: does most of the work happen at the top floor (the manager), spread evenly over every floor, or on the ground floor (the crowd of interns)?

**Artifact:** the recursion tree of merge sort for n = 8. Each box is one call; the number is the work that call does itself (merging its items). Every level adds up to 8, and there are log₂ 8 = 3 levels of merging, so the total is 8 × 3 = 24 = n log₂ n.

```text
level 0:                 [8]                     work 8
level 1:         [4]             [4]             work 4 + 4 = 8
level 2:     [2]     [2]     [2]     [2]         work 2 + 2 + 2 + 2 = 8
level 3:   [1] [1] [1] [1] [1] [1] [1] [1]       leaves: nothing to merge
```

The naive Fibonacci tree is the opposite shape: it is lopsided, each call does constant work, and the number of calls explodes. For `fib(4)`:

```text
                  fib(4)
           /               \
       fib(3)             fib(2)
      /      \            /     \
   fib(2)   fib(1)     fib(1)  fib(0)
   /    \
fib(1) fib(0)
```

That is 9 calls, and 2·F(5) − 1 = 2·5 − 1 = 9.

## How it works

### 1. Write the recurrence
A recurrence relation specifies a sequence of values in terms of earlier values and base values ✅[^nist-rec]. For a recursive function, read it off the code:
1. **Base case:** the input size where the function stops recursing, with its cost (usually a constant).
2. **Recursive calls:** one term T(size) per call, with the size of the input that call receives.
3. **Own work:** everything else the call does, as a function of n.

```python
def merge_sort(a):                 # T(n)
    if len(a) <= 1: return a       # base case: T(1) = constant
    mid = len(a) // 2
    left = merge_sort(a[:mid])     # T(n/2)
    right = merge_sort(a[mid:])    # T(n/2)
    return merge(left, right)      # own work: about n steps
# so T(n) = 2T(n/2) + n
```

### 2. Solve it with a recursion tree
A recursion tree analyses an algorithm by drawing its recursive calls ✅[^nist-tree]. Each node holds the time spent in that call excluding its recursive calls, and the total running time is the sum of all nodes ✅[^erickson-rec]. For T(n) = r·T(n/c) + f(n), level i has rⁱ nodes, each with value f(n/cⁱ), and the tree has log_c n levels ✅[^erickson-rec].

Add the levels. Three shapes are easy ✅[^erickson-rec]:

| Level sums | Who dominates | Solution | Example |
|---|---|---|---|
| Shrink by a constant factor per level | The root | O(f(n)) | T(n) = T(n/2) + n: n + n/2 + n/4 + … < 2n |
| Stay equal | Every level equally | O(f(n) · log n) | Merge sort: n per level, log₂ n levels |
| Grow by a constant factor per level | The leaves | O(n^(log_c r)), the number of leaves | Karatsuba: 3 calls on n/2 |

The tree also works when the shape is irregular. Quicksort with pivots always in the middle third gives T(n) ≤ T(n/3) + T(2n/3) + O(n): every level sums to at most n and the depth is O(log n), so O(n log n) ✅[^erickson-rec].

### 3. Or apply the master theorem
The master theorem solves recurrences of the form T(n) = a·T(n/b) + f(n) with a ≥ 1 and b > 1 ✅[^nist-mt]. In words, every call makes a calls on inputs of size n/b ✅[^mit-r03]. It compares f(n) with n^(log_b a), the number of leaves of the recursion tree ✅[^mit-r03]:

| Case | Condition (plain words) | Solution | Intuition |
|---|---|---|---|
| 1 | f(n) grows polynomially slower than n^(log_b a), that is f(n) = O(n^(log_b a − ε)) for some ε > 0 | Θ(n^(log_b a)) | The leaves dominate |
| 2 | f(n) = Θ(n^(log_b a) · log^k n) for some k ≥ 0 | Θ(n^(log_b a) · log^(k+1) n) | Work is spread evenly over the levels |
| 3 | f(n) grows polynomially faster, f(n) = Ω(n^(log_b a + ε)), **and** a·f(n/b) ≤ c·f(n) for some c < 1 (the "regularity condition") | Θ(f(n)) | The root dominates |

All three rows ✅[^mit-r03]. "Polynomially" means by a factor of at least n^ε for a fixed ε > 0, such as n^0.1; a factor of log n is not enough.

**Simpler form** for f(n) = Θ(nᶜ) ✅[^mit-r03]: compare c with log_b a. If c < log_b a, T(n) = Θ(n^(log_b a)); if c = log_b a, T(n) = Θ(nᶜ log n); if c > log_b a, T(n) = Θ(nᶜ).

Worked use, Strassen's matrix multiplication: 7 recursive multiplications of half-size matrices plus Θ(n²) additions, so T(n) = 7T(n/2) + Θ(n²) ✅[^mit-r01]. Here a = 7, b = 2, log₂ 7 ≈ 2.807 > 2 = c, so case 1: Θ(n^(log₂ 7)) ≈ Θ(n^2.807) ✅[^mit-r01].

### 4. When the master theorem does not apply
- **The input shrinks by subtraction, not division.** T(n) = T(n−1) + O(n) (quicksort with the worst pivot) has no b; the recursion tree is a path of n levels with at most n work each, so O(n²) ✅[^erickson-rec] ✅[^mit-r03].
- **The pieces have different sizes**, such as T(n/3) + T(2n/3) + O(n): use the recursion tree (step 2).
- **The gap is not polynomial.** For T(n) = 2T(n/2) + n/log n, n^(log₂ 2) = n is bigger than f(n) but not polynomially bigger, and the theorem cannot give a precise bound ✅[^mit-r01].
- **The regularity condition fails** in case 3: then case 3 cannot be used ✅[^mit-r03].
- **Two calls on n−1 and n−2** (naive Fibonacci): solve the count directly (Worked example).

### 5. Recurrences an engineer meets

| Algorithm | Recurrence | a, b, f(n) | Solution |
|---|---|---|---|
| Binary search | T(n) = T(n/2) + O(1) | 1, 2, constant: case 2 with log₂ 1 = 0 | O(log n) ✅[^mit-r03] |
| Merge sort | T(n) = 2T(n/2) + O(n) | 2, 2, n: case 2 | O(n log n) ✅[^erickson-rec] |
| Walk every node of a balanced binary tree | T(n) = 2T(n/2) + O(1) | 2, 2, constant: case 1 | O(n) ✅[^mit-r03] |
| Quickselect when every pivot leaves at most αn items (a constant α < 1) | T(n) ≤ T(αn) + O(n); with α = ½, T(n/2) + O(n) | 1, 1/α (2 for α = ½), n: case 3 | O(n) ✅[^mit-r03] ✅[^erickson-rec] |
| Karatsuba multiplication of n-digit numbers | T(n) = 3T(n/2) + O(n) | 3, 2, n: case 1 | O(n^(log₂ 3)) = O(n^1.585) ✅[^erickson-rec] |
| Strassen matrix multiplication | T(n) = 7T(n/2) + Θ(n²) | 7, 2, n²: case 1 | Θ(n^(log₂ 7)) ≈ Θ(n^2.807) ✅[^mit-r01] |
| Quicksort, worst pivot every time | T(n) = T(n−1) + O(n) | not master form | O(n²) ✅[^erickson-rec] |
| Two calls on n−1 (e.g. try "take it / skip it" for each item) | T(n) = 2T(n−1) + O(1) | not master form | O(2ⁿ) ✅[^mit-r03] |
| Naive Fibonacci (number of calls) | T(n) = T(n−1) + T(n−2) + 1 | not master form | 2·F(n+1) − 1 = Θ(φⁿ) ✅[^erickson-dp] |

Quickselect, the "find the k-th smallest by partitioning" algorithm, runs in linear time ✅[^algs4-select] (the page does not say "on average"; the lab used random pivots and averaged 20 runs); with an always-extreme pivot it degrades to T(n) = T(n−1) + O(n) = O(n²) ✅[^erickson-rec].

## Worked example
One script counts the basic operation of each recursive algorithm at several sizes and prints the formula next to the count (lab: CPython 3.15.2, 2026-11-25) ✅[^lab]:

```text
binary search: n, iterations (key above all), iterations (key below all), floor(log2 n) + 1
    1,000   9  10  10
    2,000  10  11  11
    4,000  11  12  12
1,000,000  19  20  20
2,000,000  20  21  21
merge sort: n, compares (random), compares (sorted), n*log2(n)/2, n*log2(n)
 1,000   8,705   4,932     4,983     9,966
 1,024   8,922   5,120     5,120    10,240
 2,000  19,408  10,864    10,966    21,932
 4,000  42,782  23,728    23,932    47,863
 8,000  93,726  51,456    51,863   103,726
merge sort tree, n = 16: level -> elements merged {0: 16, 1: 16, 2: 16, 3: 16}
naive fib: n, calls, 2*F(n+1)-1, calls/previous
 20   21,891   21,891 -
 21   35,421   35,421 1.618
 22   57,313   57,313 1.618
 23   92,735   92,735 1.618
 24  150,049  150,049 1.618
 25  242,785  242,785 1.618
tree traversal: n, calls, 2n + 1
 1,000  2,001  2,001
 2,000  4,001  4,001
 4,000  8,001  8,001
quickselect median: n, mean compares over 20 runs, mean / n
 1,000     3,424 3.42
 2,000     6,421 3.21
 4,000    15,023 3.76
 8,000    26,441 3.31
python 3.15.2
```

<details><summary>Script: count_recurrences.py (run with <code>docker run --rm --network none -v "$PWD:/work" -w /work python:3.15.2-slim python -I count_recurrences.py</code>)</summary>

```python
import math
import random
import sys

# 1. Binary search: count loop iterations (one middle comparison each).
def binary_search(a, key):
    lo, hi, steps = 0, len(a), 0
    while lo < hi:
        steps += 1
        mid = (lo + hi) // 2
        if a[mid] < key:
            lo = mid + 1
        else:
            hi = mid
    return lo, steps

print("binary search: n, iterations (key above all), iterations (key below all), floor(log2 n) + 1")
for n in (1_000, 2_000, 4_000, 1_000_000, 2_000_000):
    _, above = binary_search(range(n), n)
    _, below = binary_search(range(n), -1)
    print(f"{n:>9,} {above:>3} {below:>3} {math.floor(math.log2(n)) + 1:>3}")

# 2. Merge sort: count element comparisons made by merge().
def merge_sort(a, counter):
    if len(a) <= 1:
        return a
    mid = len(a) // 2
    left = merge_sort(a[:mid], counter)
    right = merge_sort(a[mid:], counter)
    out, i, j = [], 0, 0
    while i < len(left) and j < len(right):
        counter[0] += 1
        if left[i] <= right[j]:
            out.append(left[i]); i += 1
        else:
            out.append(right[j]); j += 1
    out.extend(left[i:]); out.extend(right[j:])
    return out

random.seed(1)
print("merge sort: n, compares (random), compares (sorted), n*log2(n)/2, n*log2(n)")
for n in (1_000, 1_024, 2_000, 4_000, 8_000):
    data = random.sample(range(n), n)
    c_rand = [0]; assert merge_sort(data, c_rand) == sorted(data)
    c_sorted = [0]; merge_sort(list(range(n)), c_sorted)
    lg = n * math.log2(n)
    print(f"{n:>6,} {c_rand[0]:>7,} {c_sorted[0]:>7,} {lg / 2:>9,.0f} {lg:>9,.0f}")

# 3. Merge sort recursion tree: total merge work (elements written) per level, n = 16.
level_work = {}
def tree(n, depth):
    if n <= 1:
        return
    level_work[depth] = level_work.get(depth, 0) + n
    tree(n // 2, depth + 1); tree(n - n // 2, depth + 1)
tree(16, 0)
print("merge sort tree, n = 16: level -> elements merged", level_work)

# 4. Naive Fibonacci: count calls and compare with 2*F(n+1) - 1.
calls = 0
def fib(n):
    global calls
    calls += 1
    return n if n < 2 else fib(n - 1) + fib(n - 2)

def fib_iter(n):
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a

print("naive fib: n, calls, 2*F(n+1)-1, calls/previous")
prev = None
for n in (20, 21, 22, 23, 24, 25):
    calls = 0
    fib(n)
    ratio = "-" if prev is None else f"{calls / prev:.3f}"
    print(f"{n:>3} {calls:>8,} {2 * fib_iter(n + 1) - 1:>8,} {ratio}")
    prev = calls

# 5. Tree traversal: visit every node of a balanced tree of n nodes, count calls
#    (including the calls made on empty children).
def build(lo, hi):
    if lo >= hi:
        return None
    mid = (lo + hi) // 2
    return (build(lo, mid), mid, build(mid + 1, hi))

visits = 0
def walk(node):
    global visits
    visits += 1
    if node is not None:
        walk(node[0]); walk(node[2])

print("tree traversal: n, calls, 2n + 1")
for n in (1_000, 2_000, 4_000):
    visits = 0
    walk(build(0, n))
    print(f"{n:>6,} {visits:>6,} {2 * n + 1:>6,}")

# 6. Quickselect (random pivot): count element-vs-pivot comparisons to find the median.
def quickselect(a, k, counter):
    while True:
        if len(a) == 1:
            return a[0]
        pivot = a[random.randrange(len(a))]
        counter[0] += len(a)
        less = [x for x in a if x < pivot]
        equal = len(a) - len(less) - sum(1 for x in a if x > pivot)
        if k < len(less):
            a = less
        elif k < len(less) + equal:
            return pivot
        else:
            k -= len(less) + equal
            a = [x for x in a if x > pivot]

random.seed(2)
print("quickselect median: n, mean compares over 20 runs, mean / n")
for n in (1_000, 2_000, 4_000, 8_000):
    total = 0
    for _ in range(20):
        c = [0]
        data = random.sample(range(n), n)
        assert quickselect(data, n // 2, c) == sorted(data)[n // 2]
        total += c[0]
    print(f"{n:>6,} {total / 20:>9,.0f} {total / 20 / n:.2f}")
print("python", sys.version.split()[0])
```

</details>

How each line matches its recurrence:

| Algorithm | Predicted | Measured | Match |
|---|---|---|---|
| Binary search | At most ⌊log₂ n⌋ + 1 iterations: at n = 1,000,000, ⌊19.93⌋ + 1 = 20 | 20 (key below all), 19 (key above all) ✅[^lab] | Exact for the longer path; doubling n adds 1 |
| Merge sort | Between ½ n log₂ n and n log₂ n | Random input at 8,000: 93,726, inside 51,863 … 103,726 ✅[^lab] | Doubling n multiplies compares by about 2.2 (42,782 → 93,726): 2 × (log₂ 8,000 / log₂ 4,000) = 2 × 12.97/11.97 ≈ 2.17 |
| Recursion tree, n = 16 | n per level, log₂ 16 = 4 levels | 16, 16, 16, 16 ✅[^lab] | The "all levels equal" case |
| Naive Fibonacci | 2·F(n+1) − 1 calls | Equal at every n; each n + 1 multiplies calls by 1.618 ✅[^lab] | Growth factor is φ, so Θ(φⁿ) |
| Tree walk | 2n + 1 calls (n nodes + n + 1 empty children) | 2,001, 4,001, 8,001 ✅[^lab] | Linear: O(n) |
| Quickselect | About c·n for a constant c | 3.21 n … 3.76 n ✅[^lab] | Linear on average; c varies with the random pivots |

## Edge cases
| Case | What happens | Why |
|---|---|---|
| n is odd or not a power of b | The true recurrence has ⌈n/2⌉ and ⌊n/2⌋, yet the solution is the same | Floors and ceilings can be stripped for divide-and-conquer recurrences ✅[^erickson-rec] |
| Merge sort on already sorted input | Fewer compares than the textbook lower bound: 4,932 at n = 1,000, below ½ n log₂ n = 4,983; also below it at 2,000, 4,000 and 8,000 ✅[^lab] | The bound is stated as "between 1/2 N lg N and N lg N compares" for any N ✅[^algs4-merge], but it was met exactly only at n = 1,024 (5,120 = ½ · 1,024 · 10 ✅[^lab]); treat ½ n log₂ n as approximate when n is not a power of 2 |
| f(n) = n log n with a = b = 2 | The simple form (f a polynomial) does not apply; the general case 2 with k = 1 gives Θ(n log² n) | n log n is not a polynomial ✅[^mit-r03] |
| Binary search, key above vs below all items | 19 vs 20 iterations at n = 1,000,000 ✅[^lab] | The halves have sizes ⌊n/2⌋ and ⌈n/2⌉ − 1; O(log n) either way |
| Deep recursion in practice | The runtime's recursion limit can stop a correct O(log n) or O(n) recursion | Stack depth is a memory cost with a limit; see `space-complexity.md` |
| Recursion that repeats subproblems | Exponential calls, as in naive Fibonacci | Memoize: see `../techniques/dynamic-programming-and-greedy.md` |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Master theorem | One comparison gives the answer | Only for T(n) = a·T(n/b) + f(n) with a polynomial gap |
| Recursion tree | Works for uneven splits and paths; shows where the work is | Needs a sum by hand |
| Count operations in a run | Confirms a derivation with real numbers; catches mistakes | Shows the trend only at the sizes tried; see `measuring-complexity-empirically.md` |

## Takeaways
- Write a recursive function's cost as T(n) = (calls × T(smaller size)) + own work before guessing its complexity. [rule-candidate]
- Splitting into a pieces of size n/b is fast only when a is small relative to b: 2 halves with linear merging is n log n, 4 halves with linear work is n².
- A recursion that calls itself twice on n−1 or n−2 is exponential; cache it or rewrite it as a loop. [rule-candidate]
- Confirm a solved recurrence by counting calls or comparisons at two or three sizes.

## Verification status
- Verified: 45 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [recurrence relation](https://xlinux.nist.gov/dads/HTML/recurrence.html) — NIST Dictionary of Algorithms and Data Structures, living. Rank 3. Backs: definition of a recurrence. [^nist-rec]
- [recursion tree](https://xlinux.nist.gov/dads/HTML/recursionTree.html) — NIST Dictionary of Algorithms and Data Structures, living. Rank 3. Backs: definition of a recursion tree. [^nist-tree]
- [master theorem](https://xlinux.nist.gov/dads/HTML/mastertheorm.html) — NIST Dictionary of Algorithms and Data Structures, living. Rank 3. Backs: the form T(n) = aT(n/b) + f(n), a ≥ 1, b > 1. [^nist-mt]
- [Algorithms, Chapter 1: Recursion](https://jeffe.cs.illinois.edu/teaching/algorithms/book/01-recursion.pdf) — Jeff Erickson, 1st edition, 2019. Rank 3. Backs: recursion-tree method and its three cases; merge sort, quicksort (middle-third and worst pivots), quickselect and Karatsuba recurrences; ignoring floors and ceilings. [^erickson-rec]
- [Algorithms, Chapter 3: Dynamic Programming](https://jeffe.cs.illinois.edu/teaching/algorithms/book/03-dynprog.pdf) — Jeff Erickson, 1st edition, 2019. Rank 3. Backs: naive Fibonacci call recurrence, 2F(n+1) − 1 calls, Θ(φⁿ). [^erickson-dp]
- [6.006 Spring 2020, Recitation 3: Sorting](https://ocw.mit.edu/courses/6-006-introduction-to-algorithms-spring-2020/1869dbf640ded6b31f1bd369d2001ef5_MIT6_006S20_r03.pdf) — MIT OpenCourseWare, 2020. Rank 3. Backs: master theorem cases, the simple polynomial form, the exercises (binary search, tree walk, T(n/2) + O(n), 2T(n−1) + O(1), n log n not polynomial). [^mit-r03]
- [6.046J Spring 2015, Recitation 1: Matrix Multiplication and the Master Theorem](https://ocw.mit.edu/courses/6-046j-design-and-analysis-of-algorithms-spring-2015/7c15f31b5a1aa1991313d1b4544cc137_MIT6_046JS15_Recitation1.pdf) — MIT OpenCourseWare (Demaine, Devadas, Lynch), 2015. Rank 3. Backs: Strassen recurrence and solution; the 2T(n/2) + n/log n example the theorem cannot solve. [^mit-r01]
- [2.2 Mergesort](https://algs4.cs.princeton.edu/22mergesort/) — Sedgewick and Wayne, Algorithms 4th edition site, living. Rank 3. Backs: mergesort uses between ½ N lg N and N lg N compares. [^algs4-merge]
- [2.5 Sorting Applications](https://algs4.cs.princeton.edu/25applications/) — Sedgewick and Wayne, Algorithms 4th edition site, living. Rank 3. Backs: partitioning-based selection in linear time. [^algs4-select]
- Lab run, 2026-11-25: Docker image `python:3.15.2-slim` (CPython 3.15.2, Debian 13, arm64) on an Apple M2 host with OrbStack, no network. The script and its output are embedded in Worked example. [^lab]

## Related
- `algorithms/fundamentals/complexity-and-big-o.md` — what each growth class means, measured.
- `algorithms/fundamentals/asymptotic-notation-and-cases.md` — O, Ω, Θ and best/worst/average case.
- `algorithms/fundamentals/calculating-complexity-from-code.md` — costing loops; recursion points here.
- `algorithms/fundamentals/space-complexity.md` — the memory a recursion's stack uses.
- `algorithms/fundamentals/growth-classes-and-feasible-input-sizes.md` — what n log n, n² or 2ⁿ allow in one second.
- `algorithms/techniques/dynamic-programming-and-greedy.md` — memoization turns naive Fibonacci from exponential to linear.
