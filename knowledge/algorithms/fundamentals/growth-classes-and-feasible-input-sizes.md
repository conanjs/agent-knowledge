---
schema: knowledge-doc/v1
type: reference
topic: algorithms/fundamentals
status: verified
applies-to: ["any language", "measurements: CPython 3.15.2 (python:3.15.2-slim) and Node.js 24.22.1 (node:24.22.1-alpine), Apple M2, arm64"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [algorithms, complexity, growth-classes, big-o, input-size, time-budget, feasibility, python, nodejs, constant-factor]
ranked-sources: true
---

# Growth classes and the input sizes they allow in one second

## Summary
**TL;DR:** Each growth class has a typical code shape (one loop, nested loops, halving, all subsets, all orderings) and a typical largest n that fits in a time budget. Measured on one machine with one tiny loop body, about 1 second allowed n ≈ 25 million for O(n), 5,248 for O(n²), 318 for O(n³), 24 for O(2ⁿ) and 10 for O(n!) in Python 3.15, and n ≈ 533 million, 24,576, 824, 29 and 11 in Node.js 24 ✅[^lab]. Node.js ran the same loop body about 21 times faster ✅[^lab], which moves the polynomial limits a lot and the exponential ones by only one to five.
**Use this when:** you know the input size and a time budget and want to rule out approaches before coding, you estimate whether a job will finish, or you compare the cost of the same algorithm in Python and JavaScript.
**Not this doc:** what the notation means → `asymptotic-notation-and-cases.md`; how to derive the class of your code → `calculating-complexity-from-code.md`; how to measure your own code's growth → `measuring-complexity-empirically.md`; why 2ⁿ and n! problems are hard and what to do instead → `intractable-problems-and-np-hardness.md`.

## Scope
Covers the classes O(1), O(log n), O(√n), O(n), O(n log n), O(n²), O(n³), O(2ⁿ) and O(n!). For each: the code shape that produces it, a familiar example, what doubling n does, and the largest n whose loop finished in about 1 second in the lab. The lab ran CPython 3.15.2 and Node.js 24.22.1 in Docker (OrbStack) on an Apple M2 under macOS 26.1, on 2026-11-25.

Terms:
- **n**: the input size, such as the number of items in an array ✅[^cphb]. Example: a list of 5,248 numbers has n = 5,248.
- **Loop body**: the one statement every measured loop runs, `acc = (acc * 31 + x) & 0xFFFF` (multiply, add, bitwise AND with 65,535), identical in both runtimes. Like timing a recipe by how long one stir takes, then counting stirs: each class only changes how many times the body runs.
- **Body runs per second**: body executions divided by the median time. It is the "constant factor" Big-O hides. Example: 5,248² = 27,541,504 runs in a 1.02 s median is 27,541,504 / 1.02 ≈ 27,000,000 per second.
- **√n**: the number that, multiplied by itself, gives n. √1,000,000 = 1,000.
- **log₂ n**: how many times n can be halved before reaching 1 ✅[^cphb]. log₂ 1,048,576 = 20.

## Catalog

### Growth classes
Code shapes and examples from the handbook ✅[^cphb]; "n → 2n" is arithmetic; the last two columns are the lab ✅[^lab].

| Class | Name | Code shape | Familiar example | n → 2n does | Largest n in ~1 s, Python 3.15 | Largest n in ~1 s, Node.js 24 |
|---|---|---|---|---|---|---|
| O(1) | constant | A direct formula; no loop over the input | Lookup in a hash set (on average) | Nothing | No limit from n | No limit from n |
| O(log n) | logarithmic | Halve the input at each step | Binary search | +1 step | No practical limit: 28 million halvings per second would need n = 2^28,000,000 | Same |
| O(√n) | square root | Loop while x·x ≤ n | Test whether n is prime by trial division | × 1.41 | 222,101,348,810,752 (2.2 × 10¹⁴) | Above 2⁵³ ≈ 9.0 × 10¹⁵, where JavaScript numbers stop being exact integers ✅[^mdn-safe] |
| O(n) | linear | One loop, or a fixed number of loops, over the input | Any single pass that reads each item | × 2 | 25,034,752 | 532,676,608 |
| O(n log n) | linearithmic | Sort the input, or n operations on a structure costing log n each | Efficient sorting | × 2 and a bit (× 2.1 at n = 10⁶) | 1,146,880 | 24,772,608 |
| O(n²) | quadratic | Two nested loops; all pairs | Go through all pairs of items | × 4 | 5,248 | 24,576 |
| O(n³) | cubic | Three nested loops; all triples | Floyd–Warshall all-pairs shortest paths | × 8 | 318 | 824 |
| O(2ⁿ) | exponential | Every subset of the input | Go through all subsets | Squares the work; n + 1 doubles it | 24 | 29 |
| O(n!) | factorial | Every ordering of the input | Go through all permutations | n + 1 multiplies it by n + 1 | 10 | 11 |

The handbook gives the shapes, binary search in O(log n), hash sets in O(1) on average, prime testing in O(√n) and Floyd–Warshall in O(n³) ✅[^cphb]; the last two columns are the run below ✅[^lab].

### The run behind the last two columns
Each class wraps the same loop body in its code shape. The script doubles n until a run takes over 1 second, bisects to within 1 % (or steps by 1 for 2ⁿ and n!), then reports the median of 5 runs at the largest n that stayed under 1 second ✅[^lab].

Python 3.15.2:

```text
python 3.15.2
class, largest n in about 1 s, median of 5 runs at that n, loop-body runs per second
O(sqrt n)   n = 222,101,348,810,752  1.03 s     14,513,312
O(n)        n =         25,034,752  0.88 s     28,453,544
O(n log n)  n =          1,146,880  1.07 s     22,553,798
O(n^2)      n =              5,248  1.02 s     27,006,886
O(n^3)      n =                318  0.93 s     34,494,677
O(2^n)      n =                 24  0.56 s     29,922,167
O(n!)       n =                 10  0.22 s     16,349,320
```

<details><summary>Script: feasible_n.py (run with <code>docker run --rm --network none -v "$PWD:/work" -w /work python:3.15.2-slim python -I feasible_n.py</code>; about 2 minutes)</summary>

```python
# Largest n whose loop finishes in about 1 second, per growth class.
# Loop body, the same in every class: acc = (acc * 31 + x) & 0xFFFF
import itertools
import math
import statistics
import sys
import time

def linear(n):
    acc = 0
    for x in range(n):
        acc = (acc * 31 + x) & 0xFFFF
    return acc, n

def n_log_n(n):
    acc = 0
    for _ in range(n):
        x = 1
        while x < n:                  # ceil(log2 n) passes
            acc = (acc * 31 + x) & 0xFFFF
            x *= 2
    return acc, n * math.ceil(math.log2(n)) if n > 1 else 0

def sqrt_n(n):
    acc = 0
    x = 1
    while x * x <= n:                 # floor(sqrt n) passes
        acc = (acc * 31 + x) & 0xFFFF
        x += 1
    return acc, x - 1

def quadratic(n):
    acc = 0
    for _ in range(n):
        for x in range(n):
            acc = (acc * 31 + x) & 0xFFFF
    return acc, n * n

def cubic(n):
    acc = 0
    for _ in range(n):
        for _ in range(n):
            for x in range(n):
                acc = (acc * 31 + x) & 0xFFFF
    return acc, n ** 3

def subsets(n):                       # every bitmask 0 .. 2^n - 1
    acc = 0
    for x in range(1 << n):
        acc = (acc * 31 + x) & 0xFFFF
    return acc, 1 << n

def permutations(n):                  # every ordering of 0 .. n-1
    acc = 0
    for p in itertools.permutations(range(n)):
        acc = (acc * 31 + p[0]) & 0xFFFF
    return acc, math.factorial(n)

def seconds(fn, n):
    t0 = time.perf_counter()
    fn(n)
    return time.perf_counter() - t0

def largest_n(fn, step_by_one):
    fn(5)                              # warm-up
    if step_by_one:                    # exponential classes: n + 1 multiplies the work
        n = 1
        while seconds(fn, n + 1) <= 1.0:
            n += 1
        return n
    lo, hi = 1, 2
    while seconds(fn, hi) <= 1.0:      # double until a run takes over 1 s
        lo, hi = hi, hi * 2
    while hi - lo > max(1, lo // 100): # then bisect to 1 %
        mid = (lo + hi) // 2
        if seconds(fn, mid) <= 1.0:
            lo = mid
        else:
            hi = mid
    return lo

print("python", sys.version.split()[0])
print("class, largest n in about 1 s, median of 5 runs at that n, loop-body runs per second")
for name, fn, by_one in [("O(sqrt n)", sqrt_n, False), ("O(n)", linear, False),
                         ("O(n log n)", n_log_n, False), ("O(n^2)", quadratic, False),
                         ("O(n^3)", cubic, False), ("O(2^n)", subsets, True),
                         ("O(n!)", permutations, True)]:
    n = largest_n(fn, by_one)
    times = [seconds(fn, n) for _ in range(5)]
    med = statistics.median(times)
    body_runs = fn(n)[1]
    print(f"{name:<11} n = {n:>18,}  {med:.2f} s  {body_runs / med:>13,.0f}")
```

</details>

Node.js 24.22.1:

```text
node v24.22.1
class, largest n in about 1 s, median of 5 runs at that n, loop-body runs per second
O(sqrt n)   n = 382,805,968,326,492,160  1.16 s    532,580,702  (n above 2^53: not exact)
O(n)        n =        532,676,608  0.90 s    592,008,596
O(n log n)  n =         24,772,608  1.05 s    589,961,390
O(n^2)      n =             24,576  1.06 s    569,727,397
O(n^3)      n =                824  0.95 s    587,282,183
O(2^n)      n =                 29  0.86 s    623,636,303
O(n!)       n =                 11  0.15 s    260,358,835
```

<details><summary>Script: feasible_n.mjs (run with <code>docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node feasible_n.mjs</code>; about 2 minutes)</summary>

```javascript
// Largest n whose loop finishes in about 1 second, per growth class.
// Loop body, the same in every class: acc = (acc * 31 + x) & 0xFFFF
let sink = 0;

function linear(n) {
  let acc = 0;
  for (let x = 0; x < n; x++) acc = (acc * 31 + x) & 0xFFFF;
  sink ^= acc;
  return n;
}
function nLogN(n) {
  let acc = 0;
  for (let i = 0; i < n; i++) {
    for (let x = 1; x < n; x *= 2) acc = (acc * 31 + x) & 0xFFFF; // ceil(log2 n) passes
  }
  sink ^= acc;
  return n > 1 ? n * Math.ceil(Math.log2(n)) : 0;
}
function sqrtN(n) {
  let acc = 0;
  let x = 1;
  for (; x * x <= n; x++) acc = (acc * 31 + x) & 0xFFFF; // floor(sqrt n) passes
  sink ^= acc;
  return x - 1;
}
function quadratic(n) {
  let acc = 0;
  for (let i = 0; i < n; i++) for (let x = 0; x < n; x++) acc = (acc * 31 + x) & 0xFFFF;
  sink ^= acc;
  return n * n;
}
function cubic(n) {
  let acc = 0;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      for (let x = 0; x < n; x++) acc = (acc * 31 + x) & 0xFFFF;
  sink ^= acc;
  return n ** 3;
}
function subsets(n) { // every bitmask 0 .. 2^n - 1
  let acc = 0;
  const total = 2 ** n;
  for (let x = 0; x < total; x++) acc = (acc * 31 + x) & 0xFFFF;
  sink ^= acc;
  return total;
}
function permutations(n) { // every ordering of 0 .. n-1, Heap's algorithm (iterative)
  const p = Array.from({ length: n }, (_, i) => i);
  const c = new Array(n).fill(0);
  let acc = (0 * 31 + p[0]) & 0xFFFF;
  let count = 1;
  let i = 1;
  while (i < n) {
    if (c[i] < i) {
      const k = i % 2 === 0 ? 0 : c[i];
      [p[k], p[i]] = [p[i], p[k]];
      acc = (acc * 31 + p[0]) & 0xFFFF;
      count++;
      c[i]++;
      i = 1;
    } else {
      c[i] = 0;
      i++;
    }
  }
  sink ^= acc;
  return count;
}

function seconds(fn, n) {
  const t0 = performance.now();
  fn(n);
  return (performance.now() - t0) / 1000;
}
function largestN(fn, stepByOne) {
  for (let i = 0; i < 20; i++) fn(stepByOne ? 8 : 1000); // warm-up so the JIT compiles fn
  if (stepByOne) {
    let n = 1;
    while (seconds(fn, n + 1) <= 1.0) n++;
    return n;
  }
  let lo = 1, hi = 2;
  while (seconds(fn, hi) <= 1.0) { lo = hi; hi *= 2; }
  while (hi - lo > Math.max(1, Math.floor(lo / 100))) {
    const mid = Math.floor((lo + hi) / 2);
    if (seconds(fn, mid) <= 1.0) lo = mid; else hi = mid;
  }
  return lo;
}
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

console.log("node", process.version);
console.log("class, largest n in about 1 s, median of 5 runs at that n, loop-body runs per second");
for (const [name, fn, byOne] of [["O(sqrt n)", sqrtN, false], ["O(n)", linear, false],
  ["O(n log n)", nLogN, false], ["O(n^2)", quadratic, false], ["O(n^3)", cubic, false],
  ["O(2^n)", subsets, true], ["O(n!)", permutations, true]]) {
  const n = largestN(fn, byOne);
  const med = median(Array.from({ length: 5 }, () => seconds(fn, n)));
  const bodyRuns = fn(n);
  console.log(`${name.padEnd(11)} n = ${n.toLocaleString("en-US").padStart(18)}  ${med.toFixed(2)} s  ${Math.round(bodyRuns / med).toLocaleString("en-US").padStart(13)}${n > Number.MAX_SAFE_INTEGER ? "  (n above 2^53: not exact)" : ""}`);
}
if (sink === -1) console.log("unreachable");
```

</details>

### n is about X: which classes are affordable in about 1 second
The handbook's column starts from "some hundreds of millions of operations in a second" (its code is C++) ✅[^cphb]; the other two columns are the largest n measured above ✅[^lab].

| n is about | Handbook estimate (1 s) | Python 3.15, this lab | Node.js 24, this lab |
|---|---|---|---|
| 10 | O(n!) for n ≤ 10 | O(n!) up to 10 | O(n!) up to 11 |
| 20 | O(2ⁿ) for n ≤ 20 | O(2ⁿ) up to 24 | O(2ⁿ) up to 29 |
| 500 | O(n³) for n ≤ 500 | O(n³) only up to 318 | O(n³) up to 824 |
| 5,000 | O(n²) for n ≤ 5,000 | O(n²) up to 5,248 | O(n²) up to 24,576 |
| 10⁶ | O(n log n) or O(n) for n ≤ 10⁶ | O(n log n) up to 1.1 million; O(n) up to 25 million | O(n log n) up to 24.8 million; O(n) up to 533 million |
| Larger | O(1) or O(log n) | O(√n) up to 2.2 × 10¹⁴; O(log n), O(1) | O(√n) beyond exact integers; O(log n), O(1) |

### How much the constant differs between the runtimes
Body runs per second, from the run above ✅[^lab]; the ratio is arithmetic.

| Class | Python 3.15 | Node.js 24 | Node.js ÷ Python |
|---|---|---|---|
| O(n) | 28,453,544 | 592,008,596 | 592.0 / 28.5 ≈ 20.8 |
| O(n log n) | 22,553,798 | 589,961,390 | ≈ 26.2 |
| O(n²) | 27,006,886 | 569,727,397 | ≈ 21.1 |
| O(n³) | 34,494,677 | 587,282,183 | ≈ 17.0 |
| O(2ⁿ) | 29,922,167 | 623,636,303 | ≈ 20.8 |
| O(n!) | 16,349,320 | 260,358,835 | ≈ 15.9 |

What a 21× constant buys in each class (arithmetic): O(n) gets 21× the n; O(n²) gets √21 ≈ 4.6× (5,248 → 24,576 measured is 4.7×); O(n³) gets ∛21 ≈ 2.8× (318 → 824 is 2.6×); O(2ⁿ) gets log₂ 21 ≈ 4.4 more items (24 → 29); O(n!) gets one more item (10 → 11).

## Lookup notes
- **These are measurements on one machine, not constants.** A real loop body (a dictionary update, a string format, an allocation) runs several times slower than this one, so real limits are lower. The handbook makes the same point: an O(n) algorithm may do n/2 or 5n operations, and that changes the running time ✅[^cphb].
- **Run-to-run variation.** The search stops when a run takes about 1 second of measured time, so a second run of the same script lands on slightly different sizes. Treat the last digits as noise.
- **The 2ⁿ and n! rows move in big steps.** n + 1 doubles (2ⁿ) or multiplies (n!) the time, so the largest n's own time lands anywhere from 0.1 s to 1 s: Python's 2²⁴ run took 0.56 s and 10! took 0.22 s ✅[^lab].
- **The n! row is not one loop body per item.** Python's `itertools.permutations` is implemented in C, while the JavaScript version swaps array elements by Heap's algorithm; both run the body once per permutation, which is why that row's rate differs from the others.
- **O(√n) in JavaScript** went past `Number.MAX_SAFE_INTEGER` (9,007,199,254,740,991), above which integers are no longer represented and compared exactly ✅[^mdn-safe], so the script flags that n as not exact. Python integers have no such limit; its √n loop ran at about half the rate of the O(n) loop (14.5 vs 28.5 million per second) ✅[^lab], which suggests that the cost of one body run depends on the size of the numbers in it.
- **Python lands near the handbook's estimates** for O(n²), O(2ⁿ) and O(n!), with this one-statement body; with any heavier body it falls below them, and for O(n³) it already falls short (318 vs ≤ 500) ✅[^lab]. In Python, plan for the next smaller class, or move the inner loop into a library written in C.
- **Polynomial vs exponential:** all classes up to O(n³) are polynomial, O(nᵏ) for a constant k; O(2ⁿ) and O(n!) are not ✅[^cphb]. See `intractable-problems-and-np-hardness.md`.

## Takeaways
- Before choosing an approach, look up n in the "n is about X" table; an approach two classes too slow cannot be tuned into the budget. [rule-candidate]
- In Python, take one class lower than the handbook's rule of thumb for budgets of a second, or move the hot loop into C-implemented library calls.
- A faster runtime or machine multiplies the affordable n for O(n), only roots it for O(n²) and O(n³), and adds a few items for O(2ⁿ) and O(n!).

## Verification status
- Verified: 19 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [Competitive Programmer's Handbook](https://cses.fi/book/book.pdf) — Antti Laaksonen, draft of July 3, 2018. Rank 3. Backs: definition of n; the list of complexity classes with their code shapes and examples; polynomial classes; "hundreds of millions of operations in a second"; the input-size estimate table for a 1-second limit; constant factors; examples in C++. [^cphb]
- [Number.MAX_SAFE_INTEGER](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/MAX_SAFE_INTEGER) — MDN Web Docs, living. Rank 3. Backs: the value 9,007,199,254,740,991 and the meaning of "safe". [^mdn-safe]
- Lab run, 2026-11-25: Docker images `python:3.15.2-slim` (CPython 3.15.2, Debian 13, arm64) and `node:24.22.1-alpine` (Node.js 24.22.1) on an Apple M2 host, macOS 26.1, OrbStack, no network. Scripts and outputs are embedded in Catalog. [^lab]

## Related
- `algorithms/fundamentals/complexity-and-big-o.md` — the classes measured on real data structures.
- `algorithms/fundamentals/asymptotic-notation-and-cases.md` — what O, Ω and Θ claim.
- `algorithms/fundamentals/calculating-complexity-from-code.md` — derive which class your code is in.
- `algorithms/fundamentals/measuring-complexity-empirically.md` — measure your own code's class.
- `algorithms/fundamentals/recurrences-and-the-master-theorem.md` — the class of recursive code.
- `algorithms/fundamentals/intractable-problems-and-np-hardness.md` — what to do when only 2ⁿ or n! algorithms are known.
- `performance/measurement/benchmarking-methodology.md` — how to time code fairly.
