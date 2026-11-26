---
schema: knowledge-doc/v1
type: how-to
topic: algorithms/fundamentals
status: verified
applies-to: ["any language", "measurements: CPython 3.15.2 and Node.js 24.22.1 (arm64)"]
last-verified: 2026-11-25
last-updated: 2026-11-26
tags: [algorithms, complexity, doubling-experiment, power-law, log-log, benchmarking, scaling, caches, empirical]
ranked-sources: true
---

# Measure the growth rate of code empirically: the doubling experiment

## Summary
**TL;DR:** Run the code at sizes n, 2n, 4n, … and model the running time as T(n) ≈ a·nᵇ, a "power law". The exponent b is the slope on a log-log plot; from two sizes it is b = log(t₂/t₁) / log(n₂/n₁), so with doubling it is log₂ of the time ratio. Textbooks call this the doubling hypothesis. In the lab, counts gave b = 1.000 for a single loop and 2.000 for a pair loop, and n log n came out as 1.14 because the method cannot see a log factor. Timings agree only when each run is long enough and the data fits the same cache level: whole-process timings of a quadratic loop fitted 0.20 at small sizes, and a "linear" hash-map workload fitted 1.42.
**Use this when:** you want to know how code scales before production does it for you, you need to confirm a hand derivation, or a benchmark "slope" looks wrong.
**Not this doc:** deriving the cost from the code → `calculating-complexity-from-code.md`; what O, Ω and Θ promise → `asymptotic-notation-and-cases.md`; which classes are affordable at which n → `growth-classes-and-feasible-input-sizes.md`; running a fair benchmark in general → `performance/measurement/benchmarking-methodology.md`.

## Goal & prerequisites
**End state:** for one function, a measured exponent b (for example "b ≈ 2.0 between n = 2,000 and 16,000"), a prediction for a larger n that a further run confirms, and a check that the number is not distorted by fixed costs or caches.

**Symbols used below:**
- **n**: the input size you vary, for example the number of items in a list. Example: n = 4,000.
- **T(n)** or **t**: the measured running time (or count of steps) at size n. Example: T(4,000) = 138.3 ms.
- **a** and **b**: the two numbers of the model T(n) ≈ a·nᵇ. **b** (the exponent) says how fast cost grows; **a** (the constant) says how expensive one unit of work is on this machine. Example: a = 3·10⁻⁵ ms and b = 2 give T(4,000) ≈ 3·10⁻⁵ × 16,000,000 = 480 ms.
- **log**: the logarithm. Any base works in the exponent formula as long as top and bottom use the same one; **log₂ x** asks "2 to which power gives x?". Example: log₂ 4 = 2, log₂ 8 = 3, log₂ 2.2 ≈ 1.14.
- **Ratio**: T(2n) / T(n), the factor by which time grows when n doubles. Example: 1,999,000 / 499,500 ≈ 4.00.

**Analogy:** you want to know how a recipe's preparation time grows with the number of guests. You do not read the recipe line by line; you cook for 4, then 8, then 16 guests and look at the factor. If time doubles each time, the work is per guest (linear). If it quadruples, something is done for every pair of guests (quadratic).

**The model is a standard, named method.** Sedgewick and Wayne teach it as the "doubling hypothesis": a quick way to estimate b in a power-law relationship by running the program while doubling the input size ✅[^algs4-slides]. Goldsmith, Aiken and Wilkerson call the practice "empirical computational complexity": run on workloads whose sizes span orders of magnitude and fit a line or a power law y = a·xᵇ to the measurements ✅[^trend-prof]. McGeoch's textbook on experimental algorithmics indexes the "doubling experiment" and the "ratio test" ✅[^mcgeoch].

**You need:** a function you can call with a chosen n, a clock with high resolution (in Python `time.perf_counter`, made for short durations, where only the difference of two calls is meaningful ✅[^py-time]), and a way to make inputs of any size with the same distribution (a seeded random generator). The runs below used CPython 3.15.2 and Node.js 24.22.1 in Docker (see References).

## Steps
1. **Decide what to measure: a count or a time.** A count (a counter variable in the inner loop) is exact and repeatable; trend-prof counts basic-block executions for that reason, which removes timer-resolution problems ✅[^trend-prof]. Count when the question is "what is the growth class?". Time when the question is "how long will it take?", because only time includes the machine's costs.

2. **Choose sizes that grow by a factor of 2 and span at least an order of magnitude.** For example 1,000 to 16,000. Doubling makes each ratio directly comparable with the class table in step 7 ✅[^algs4-slides]; a wide span matters because the model only describes the sizes it was fitted on ✅[^trend-prof].

3. **Make every run long enough.** For timings, pick sizes where each run takes several times its fixed cost. Fixed costs per run (start-up, compilation, timer overhead) can be larger than the work. In the two labs here the fixed cost was about 1–2 ms (inside a Node.js process) and about 6 ms (a whole Python process), so about 10 ms per run was a workable floor for timing inside a process; the scaling harness in `performance/code-review/perf-reviewer-calibration.md` §7.1 warns under 10 ms for that reason ✅[^lab-cal]. Check 3 in Verify shows the effect.

4. **Keep everything except n fixed.** Same input distribution and seed, same machine, nothing else heavy running. The algorithm and the input data decide the exponent b; the hardware (processor, memory, cache), the software (compiler, interpreter, garbage collector) and the system (operating system, other programs) change the constant a ✅[^algs4-slides]. A model fitted on one kind of input describes only that kind ✅[^trend-prof].

5. **Warm up, repeat, take the median.** Run once and discard it (caches and just-in-time compilers settle), then run at least 5 times and keep the median, as `performance/measurement/benchmarking-methodology.md` describes. Report the spread if the runs differ much.

6. **Compute the ratio and the exponent for each pair of neighbouring sizes.** If T(n) = a·nᵇ, then T(2n) / T(n) = a·(2n)ᵇ / (a·nᵇ) = 2ᵇ, so b = log₂(ratio) ✅[^algs4-slides]. For sizes that are not a factor of 2 apart, b = log(t₂/t₁) / log(n₂/n₁). Worked example from the quadratic timing row below: t₁ = 505.0 ms at n₁ = 8,000 and t₂ = 2,091.4 ms at n₂ = 16,000. Ratio = 2,091.4 / 505.0 ≈ 4.14; b = log₂ 4.14 ≈ 2.05 ✅[^lab].

7. **Fit one slope over all sizes and read it against the class table.** On a log-log plot (both axes logarithmic) a power law is a straight line whose slope is b ✅[^trend-prof]; fitting that straight line by least squares on (log n, log t) gives one b from all sizes, which is steadier than any single pair ✅[^algs4-slides] ✅[^trend-prof]. Expected doubling ratios ✅[^algs4-slides]:

   | Growth class | Ratio T(2n)/T(n) | Exponent b |
   |---|---|---|
   | 1 (constant) | 1 | 0 |
   | log n | about 1 | about 0 |
   | n (linear) | 2 | 1 |
   | n log n | about 2 (a little more) | a little above 1 |
   | n² (quadratic) | 4 | 2 |
   | n³ (cubic) | 8 | 3 |
   | 2ⁿ (exponential) | 2ⁿ (it grows itself) | no fixed b |

   **The n log n row needs care.** Doubling cannot identify logarithmic factors ✅[^algs4-slides]. For n·log₂ n the ratio is 2 × log₂(2n) / log₂ n = 2 × (1 + 1/log₂ n). At n = 1,000: log₂ 1,000 ≈ 9.97, so the ratio is 2 × 1.100 = 2.20 and b = log₂ 2.20 ≈ 1.14. At n = 1,000,000: 2 × (1 + 1/19.93) = 2.10, b ≈ 1.07. So "b ≈ 1.1–1.2" usually means n log n, not n^1.15. trend-prof met the same thing: a power law fitted to the comparisons of C's `qsort` gave an exponent of 1.16, and only the hump-shaped residuals revealed the log factor ✅[^trend-prof].

8. **Predict a larger size, then run it.** With b known, solve for a from one large run: a = T(n) / nᵇ ✅[^algs4-slides]. Then predict. Example from the quadratic timings: a = 505.0 / 8,000² ≈ 7.9·10⁻⁶ ms, so T(16,000) ≈ 7.9·10⁻⁶ × 256,000,000 ≈ 2,020 ms; the run took 2,091.4 ms, 3.5 % more ✅[^lab].

9. **Optional: let a benchmark library fit the class.** Google Benchmark computes, for a family of benchmarks at several sizes, "the coefficient for the high-order term in the running time" and a normalized root-mean-square error; you report n with `state.SetComplexityN(n)` and ask for a class with `->Complexity(benchmark::oN)`, or call `->Complexity()` with no argument to have it chosen automatically ✅[^gbench-guide]. The automatic choice tries constant, log n, n, n log n, n² and n³ and keeps the one with the lowest error, and needs at least two sizes ✅[^gbench-src]. It picks from that fixed list only, so it cannot report n^1.4; use the slope from step 7 when the true growth may lie between classes.

### Worked run 1: counts for linear, n log n and quadratic code
The three functions are a single pass (count additions), Python's `sorted()` (count comparisons), and a loop over every pair i < j (count comparisons, n(n − 1)/2 of them). Sizes 1,000 to 16,000, random floats with a fixed seed ✅[^lab]:

```text
linear: n, count, ratio to previous, exponent b = log(c2/c1)/log(n2/n1)
    1000        1,000
    2000        2,000   2.00  1.000
    4000        4,000   2.00  1.000
    8000        8,000   2.00  1.000
   16000       16,000   2.00  1.000
  least-squares slope over all sizes: 1.000
n log n: n, count, ratio to previous, exponent b = log(c2/c1)/log(n2/n1)
    1000        8,659
    2000       19,310   2.23  1.157
    4000       42,608   2.21  1.142
    8000       93,156   2.19  1.129
   16000      202,417   2.17  1.120
  least-squares slope over all sizes: 1.136
quadratic: n, count, ratio to previous, exponent b = log(c2/c1)/log(n2/n1)
    1000      499,500
    2000    1,999,000   4.00  2.001
    4000    7,998,000   4.00  2.000
    8000   31,996,000   4.00  2.000
   16000  127,992,000   4.00  2.000
  least-squares slope over all sizes: 2.000
```

<details><summary>Script: doubling_counts.py</summary>

```python
# Doubling experiment on operation COUNTS (deterministic): linear, n log n, quadratic.
import math, random
from functools import cmp_to_key

def linear(xs):                      # one pass: n additions
    ops = 0; total = 0
    for x in xs:
        total += x; ops += 1
    return ops

def nlogn(xs):                       # sorted(): count the comparisons it makes
    ops = 0
    def cmp(a, b):
        nonlocal ops; ops += 1
        return (a > b) - (a < b)
    sorted(xs, key=cmp_to_key(cmp))
    return ops

def quadratic(xs):                   # every pair (i < j): n(n-1)/2 comparisons
    ops = 0; n = len(xs); dup = 0
    for i in range(n):
        for j in range(i + 1, n):
            ops += 1
            if xs[i] == xs[j]: dup += 1
    return ops

def slope(ns, ys):                   # least-squares slope of log y on log n
    lx = [math.log(n) for n in ns]; ly = [math.log(y) for y in ys]
    mx = sum(lx) / len(lx); my = sum(ly) / len(ly)
    return sum((a - mx) * (b - my) for a, b in zip(lx, ly)) / sum((a - mx) ** 2 for a in lx)

for name, fn, ns in [("linear", linear, [1000, 2000, 4000, 8000, 16000]),
                     ("n log n", nlogn, [1000, 2000, 4000, 8000, 16000]),
                     ("quadratic", quadratic, [1000, 2000, 4000, 8000, 16000])]:
    rnd = random.Random(42)
    counts = []
    print(f"{name}: n, count, ratio to previous, exponent b = log(c2/c1)/log(n2/n1)")
    for n in ns:
        xs = [rnd.random() for _ in range(n)]
        c = fn(xs); counts.append(c)
        if len(counts) == 1:
            print(f"  {n:>6} {c:>12,}")
        else:
            r = c / counts[-2]
            print(f"  {n:>6} {c:>12,}  {r:5.2f}  {math.log(r) / math.log(2):.3f}")
    print(f"  least-squares slope over all sizes: {slope(ns, counts):.3f}")
```

</details>

- Linear: every ratio is exactly 2.00, b = 1.000.
- Quadratic: 1,999,000 / 499,500 ≈ 4.002, b = 2.001; the 0.001 is the − n/2 term of n(n − 1)/2, which fades as n grows.
- n log n: b falls from 1.157 to 1.120 as n grows, just as the arithmetic in step 7 predicts (2.20 at n = 1,000 gives 1.14). The slope over all sizes is 1.136.

### Worked run 2: timings for the same three shapes
Same shapes, timed: one warm-up run, then the median of 5. Sizes are larger so that every run takes more than 10 ms ✅[^lab]:

```text
linear: n, median ms, ratio to previous, exponent b
  1,000,000      11.6
  2,000,000      22.8   1.97  0.98
  4,000,000      45.4   1.99  1.00
  8,000,000      92.2   2.03  1.02
  least-squares slope over all sizes: 1.00
n log n: n, median ms, ratio to previous, exponent b
    250,000      35.4
    500,000      81.5   2.30  1.20
  1,000,000     182.4   2.24  1.16
  2,000,000     398.2   2.18  1.13
  4,000,000    1004.1   2.52  1.33
  least-squares slope over all sizes: 1.19
quadratic: n, median ms, ratio to previous, exponent b
      2,000      28.7
      4,000     138.3   4.82  2.27
      8,000     505.0   3.65  1.87
     16,000    2091.4   4.14  2.05
  least-squares slope over all sizes: 2.04
```

<details><summary>Script: doubling_times.py</summary>

```python
# Doubling experiment on TIME: linear, n log n, quadratic. 1 warm-up run, then median of 5.
import math, random, statistics, time

def linear(xs):
    total = 0.0
    for x in xs:
        total += x
    return total

def nlogn(xs):
    return sorted(xs)[0]

def quadratic(xs):
    n = len(xs); dup = 0
    for i in range(n):
        a = xs[i]
        for j in range(i + 1, n):
            if a == xs[j]: dup += 1
    return dup

def median_ms(fn, xs, repeats=5):
    fn(xs)                                       # warm-up, discarded
    runs = []
    for _ in range(repeats):
        t0 = time.perf_counter(); fn(xs); runs.append((time.perf_counter() - t0) * 1000)
    return statistics.median(runs)

def slope(ns, ys):
    lx = [math.log(n) for n in ns]; ly = [math.log(y) for y in ys]
    mx = sum(lx) / len(lx); my = sum(ly) / len(ly)
    return sum((a - mx) * (b - my) for a, b in zip(lx, ly)) / sum((a - mx) ** 2 for a in lx)

for name, fn, ns in [("linear", linear, [1_000_000, 2_000_000, 4_000_000, 8_000_000]),
                     ("n log n", nlogn, [250_000, 500_000, 1_000_000, 2_000_000, 4_000_000]),
                     ("quadratic", quadratic, [2000, 4000, 8000, 16000])]:
    rnd = random.Random(7)
    ts = []
    print(f"{name}: n, median ms, ratio to previous, exponent b")
    for n in ns:
        xs = [rnd.random() for _ in range(n)]
        t = median_ms(fn, xs); ts.append(t)
        if len(ts) == 1:
            print(f"  {n:>9,} {t:9.1f}")
        else:
            r = t / ts[-2]
            print(f"  {n:>9,} {t:9.1f}  {r:5.2f}  {math.log(r) / math.log(2):.2f}")
    print(f"  least-squares slope over all sizes: {slope(ns, ts):.2f}")
```

</details>

- Linear and quadratic land on 1.00 and 2.04, as the counts did.
- Single pairs are noisy: the quadratic pairs were 2.27, 1.87 and 2.05, and the n log n pairs ranged from 1.13 to 1.33. Read the slope over all sizes, never one pair.
- n log n timed at 1.19, a little above the counted 1.14. A likely cause, inferred and not measured for the sort itself, is that the larger sorts no longer fit in the processor caches (Check 4 shows that effect on a hash map).

## Verify
**Check 1, prediction:** extrapolate to the next size with step 8 and run it. Expected: the measured time within about 10–20 % of the prediction. In worked run 2 the prediction was 3.5 % low.

**Check 2, counts and time agree:** count the inner step at the same sizes. Expected: the time slope within about 0.1–0.2 of the count slope (worked runs 1 and 2: 2.000 and 2.04; 1.000 and 1.00). A larger gap means the cost of one step changes with n: see Checks 3 and 4.

**Check 3, rule out fixed costs at small sizes.** Here the whole command was timed: start a Python process, run the quadratic pair loop, exit. This is what a harness does when it launches a program per size. A least-squares fit of t = c + q·n² separates the fixed part c from the quadratic part ✅[^lab]:

```text
whole command: n, median ms, exponent b to previous size
     125       6.7  
     250       6.4  -0.06
     500       8.8  0.46
   1,000      12.0  0.44
   2,000      35.9  1.59
   4,000     137.9  1.94
   8,000     516.7  1.91
slope, small sizes 125-500:    0.20
slope, large sizes 2,000-8,000: 1.92
fit t = c + q*n^2: c = 6.1 ms fixed, q = 7.99 ms per 1,000,000 of n^2
n, measured ms, quadratic part q*n^2 ms, share of the run that is fixed cost
     125       6.7       0.1     98 %
     250       6.4       0.5     92 %
     500       8.8       2.0     77 %
   1,000      12.0       8.0     33 %
   2,000      35.9      32.0     11 %
   4,000     137.9     127.9      7 %
   8,000     516.7     511.5      1 %
```

<details><summary>Script: fixed_cost.py</summary>

```python
# Too-small sizes: time a WHOLE command (start Python, run the quadratic pair loop, exit), as a
# harness that runs a program per size would. Process start-up is a fixed cost that hides the n^2 part.
import math, statistics, subprocess, sys, time

CHILD = """
import sys
def pairs(xs):
    n = len(xs); dup = 0
    for i in range(n):
        a = xs[i]
        for j in range(i + 1, n):
            if a == xs[j]: dup += 1
    return dup
pairs(list(range(int(sys.argv[1]))))
"""

def median_ms(n, repeats=5):
    cmd = [sys.executable, "-I", "-c", CHILD, str(n)]
    subprocess.run(cmd, check=True)                              # warm-up, discarded
    runs = []
    for _ in range(repeats):
        t0 = time.perf_counter(); subprocess.run(cmd, check=True)
        runs.append((time.perf_counter() - t0) * 1000)
    return statistics.median(runs)

def slope(ns, ys):
    lx = [math.log(n) for n in ns]; ly = [math.log(y) for y in ys]
    mx = sum(lx) / len(lx); my = sum(ly) / len(ly)
    return sum((a - mx) * (b - my) for a, b in zip(lx, ly)) / sum((a - mx) ** 2 for a in lx)

ns = [125, 250, 500, 1000, 2000, 4000, 8000]
ts = [median_ms(n) for n in ns]
print("whole command: n, median ms, exponent b to previous size")
for k, (n, t) in enumerate(zip(ns, ts)):
    b = "" if k == 0 else f"{math.log(t / ts[k - 1]) / math.log(2):.2f}"
    print(f"  {n:>6,} {t:9.1f}  {b}")
print(f"slope, small sizes 125-500:    {slope(ns[:3], ts[:3]):.2f}")
print(f"slope, large sizes 2,000-8,000: {slope(ns[4:], ts[4:]):.2f}")
x = [n * n for n in ns]                                        # fit t = c + q*n^2 by least squares
mx = sum(x) / len(x); my = sum(ts) / len(ts)
q = sum((a - mx) * (b - my) for a, b in zip(x, ts)) / sum((a - mx) ** 2 for a in x); c = my - q * mx
print(f"fit t = c + q*n^2: c = {c:.1f} ms fixed, q = {q * 1e6:.2f} ms per 1,000,000 of n^2")
print("n, measured ms, quadratic part q*n^2 ms, share of the run that is fixed cost")
for n, t in zip(ns, ts):
    print(f"  {n:>6,} {t:9.1f} {q * n * n:9.1f} {100 * (1 - q * n * n / t):6.0f} %")
```

</details>

- At 125–500 the slope is 0.20 for code that is quadratic: about 6 ms of every run is process start-up, which does not depend on n, and it is 77–98 % of those runs.
- From 2,000 up, where the fixed part is 11 % or less, the slope is 1.92.
- Expected result of this check: when you add or remove the fixed part (time inside the process, or use larger sizes), b should not change. If it jumps, the small sizes were measuring overhead.
- **Compared with the earlier lab:** `performance/code-review/perf-reviewer-calibration.md` §7.1 found the same shape in Node.js, a quadratic fixture fitting 0.94 at runs of 2–8 ms with about 1–2 ms of fixed cost per run, attributed there to the just-in-time compiler ✅[^lab-cal]. This run reproduces the effect with a different fixed cost (process start-up, about 6 ms).

**Check 4, rule out memory effects at large sizes.** A hash-map lookup is O(1) on average, so n lookups should scale linearly. Part 1 makes 4n lookups (random key order) into a `Map` of n entries; part 2 keeps the number of lookups fixed at 2,000,000 and changes only the size of the `Map` ✅[^lab]:

```text
part 1: 4n lookups into a Map of n entries: n, median ms, exponent b to previous size
    125,000     13.4  
    250,000     26.9  1.01
    500,000     66.2  1.30
  1,000,000    305.1  2.20
  2,000,000    597.9  0.97
  4,000,000   1534.9  1.36
  least-squares slope over all sizes: 1.42
part 2: 2,000,000 lookups into a Map of m entries: m, ns per lookup
      1,000     8.4
     10,000    16.5
    100,000    23.1
  1,000,000    68.1
  4,000,000    85.8
```

<details><summary>Script: map_scaling.mjs</summary>

```javascript
// A "linear" hash-map workload at growing sizes. Node.js, Map with integer keys.
// Part 1: 4n lookups (each key 4 times) into a Map of n entries: operation count 4n, so the count model says b = 1.
// Part 2: a fixed 2,000,000 lookups into Maps of different sizes, to see the cost of ONE lookup.
function shuffled(n, seed) {               // keys 0..n-1 in a random order (xorshift, fixed seed)
  const a = new Int32Array(n); for (let i = 0; i < n; i++) a[i] = i;
  let s = seed >>> 0;
  for (let i = n - 1; i > 0; i--) {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    const j = s % (i + 1); const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}
function build(n) { const m = new Map(); for (let i = 0; i < n; i++) m.set(i, i); return m; }
function lookups(m, keys, count) {
  let sum = 0; const k = keys.length;
  for (let i = 0; i < count; i++) sum += m.get(keys[i % k]);
  return sum;
}
function medianMs(fn, repeats = 5) {
  fn();                                   // warm-up, discarded
  const runs = [];
  for (let r = 0; r < repeats; r++) {
    const t0 = process.hrtime.bigint(); fn(); runs.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  runs.sort((a, b) => a - b); return runs[Math.floor(repeats / 2)];
}
function slope(ns, ys) {
  const lx = ns.map(Math.log), ly = ys.map(Math.log);
  const mx = lx.reduce((a, b) => a + b) / lx.length, my = ly.reduce((a, b) => a + b) / ly.length;
  let num = 0, den = 0;
  for (let i = 0; i < lx.length; i++) { num += (lx[i] - mx) * (ly[i] - my); den += (lx[i] - mx) ** 2; }
  return num / den;
}
const ns = [125000, 250000, 500000, 1000000, 2000000, 4000000];
const ts = [];
console.log("part 1: 4n lookups into a Map of n entries: n, median ms, exponent b to previous size");
for (const n of ns) {
  const m = build(n), keys = shuffled(n, 12345);
  const t = medianMs(() => lookups(m, keys, 4 * n)); ts.push(t);
  const b = ts.length === 1 ? "" : (Math.log(t / ts[ts.length - 2]) / Math.log(2)).toFixed(2);
  console.log(`  ${n.toLocaleString("en-US").padStart(9)} ${t.toFixed(1).padStart(8)}  ${b}`);
}
console.log(`  least-squares slope over all sizes: ${slope(ns, ts).toFixed(2)}`);
console.log("part 2: 2,000,000 lookups into a Map of m entries: m, ns per lookup");
for (const m of [1000, 10000, 100000, 1000000, 4000000]) {
  const map = build(m), keys = shuffled(m, 999);
  const t = medianMs(() => lookups(map, keys, 2000000));
  console.log(`  ${m.toLocaleString("en-US").padStart(9)} ${(t * 1e6 / 2000000).toFixed(1).padStart(7)}`);
}
```

</details>

- The operation count is exactly 4n, but the slope is 1.42, and the pair from 500,000 to 1,000,000 alone is 2.20.
- Part 2 shows why: one lookup costs about 8 ns in a `Map` of 1,000 entries and about 86 ns in one of 4,000,000, roughly 10 times more, while the count per lookup is the same. A small table stays in the processor's caches; a large one does not, so most lookups wait for main memory (`performance/hardware/memory-hierarchy-and-caches.md`). Sedgewick and Wayne list caching among the system effects their mathematical model leaves out ✅[^algs4-14].
- Expected result of this check: if the cost per operation (time ÷ count) is flat across your sizes, the slope is the algorithm's. If it rises, part of the slope is the memory hierarchy, and the algorithm may still be linear.
- **Compared with the earlier lab:** §7.3 of the calibration doc measured 23.4 ns per lookup at 1,000 entries and 216.6 ns at 1,000,000, and linear fixes fitting 1.43–1.59 at millions of items ✅[^lab-cal]. This run shows the same effect: a rise of about 10× per lookup and a slope of 1.42. The absolute nanoseconds differ because the loops differ.

## Troubleshooting
| Symptom | Cause | Fix |
|---|---|---|
| Quadratic code fits b well below 2 (or near 0) | Fixed cost per run dominates at small sizes: 77–98 % of the run in Check 3 ✅[^lab] | Make each run at least about 10 ms ✅[^lab-cal]; time inside the process; fit t = c + q·nᵇ |
| Linear code fits 1.3–1.6 at millions of items | The cost of one operation grows as data leaves the caches: about 8 → 86 ns per `Map` lookup ✅[^lab] | Measure time per operation across sizes; compare only sizes that fit the same cache level, or accept the higher slope as the real cost at that size |
| b ≈ 1.1–1.2 and you cannot tell n log n from n^1.15 | Doubling cannot identify logarithmic factors ✅[^algs4-slides] | Compare the ratio with 2 × (1 + 1/log₂ n) (step 7), or divide the times by n·log₂ n and check that the result is flat. A hump-shaped residual plot on a power-law fit also signals a log factor ✅[^trend-prof] |
| Neighbouring pairs disagree (2.27 then 1.87 in worked run 2) | Noise between runs; likely sources are other processes, processor frequency changes and garbage collection (not separated here) | Least-squares slope over 4 or more sizes; repeat the whole experiment |
| The exponent changes from one size range to another | The power law holds only locally; the log-log line is curved ✅[^wiki-aoa] | Report b with its size range ("2.0 between 2,000 and 16,000"); extrapolate only nearby |
| Slope changes when the input changes (sorted versus random, many duplicates) | The input data decides the exponent ✅[^algs4-slides]; a model fits only the workloads it was built from ✅[^trend-prof] | Measure each input shape you care about, including the worst case |
| Two sizes grow together (rows and columns, users and items) | One n hides two parameters | Vary one size at a time and fit an exponent for each |
| Python's `timeit` docs say take the minimum, this doc says the median | `timeit` treats higher values as interference from other processes and keeps the minimum ✅[^py-timeit] | For a scaling slope either is fine if used for every size; keep the same statistic throughout |
| Google Benchmark reports "N" for code you know is n^1.5 | Automatic fitting chooses only among 1, log n, n, n log n, n², n³ ✅[^gbench-src] | Read its RMS error and fit your own slope (step 7) |
| Times jump at one size only | A resize, a garbage collection or the start of compilation fell in that run | Larger repeats; check the per-run spread |

## Takeaways
- Measure growth with doubling: sizes n, 2n, 4n, …; b = log₂ of the ratio; one least-squares slope over all sizes. [rule-candidate]
- Count operations to find the class; time them to find the cost. When the two slopes disagree, the cost per operation is changing.
- A timing run not much longer than its fixed cost measures overhead, not growth; in these labs that meant runs under about 10 ms. [rule-candidate]
- b ≈ 1.1–1.2 is usually n log n; check against 2 × (1 + 1/log₂ n).
- At millions of items, a linear hash-table workload can fit 1.4: the algorithm is linear, the memory hierarchy is not.
- State every measured exponent with its size range and input shape.

## Verification status
- Verified: 39 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [Google Benchmark user guide: Calculating Asymptotic Complexity (Big O)](https://github.com/google/benchmark/blob/main/docs/user_guide.md) — Google Benchmark project, living, read 2026-11-25. Rank 1. Backs: step 9, `SetComplexityN`, `Complexity(benchmark::oN)`, automatic `Complexity()`, the BigO coefficient and RMS rows. [^gbench-guide]
- [src/complexity.cc](https://github.com/google/benchmark/blob/main/src/complexity.cc) — Google Benchmark project, living, read 2026-11-25. Rank 1. Backs: step 9, automatic fitting tries o1, log n, n, n log n, n², n³ and keeps the lowest RMS; at least two sizes. [^gbench-src]
- [time: perf_counter](https://docs.python.org/3/library/time.html) — Python Software Foundation, living. Rank 1. Backs: prerequisites, the clock for short durations; only differences are valid. [^py-time]
- [timeit: Timer.repeat note](https://docs.python.org/3/library/timeit.html) — Python Software Foundation, living. Rank 1. Backs: Troubleshooting, minimum of repeats. [^py-timeit]
- [Measuring Empirical Computational Complexity](https://web.stanford.edu/class/archive/cs/cs295/cs295.1086/papers/trend-prof.pdf) — Simon F. Goldsmith, Alex Aiken, Daniel S. Wilkerson, ESEC/FSE 2007 (doi:10.1145/1287624.1287681). Rank 2. Backs: the named practice, power-law fit by regression in log-log space, counting basic blocks avoids timer resolution, the qsort fit of 1.16 and the log-factor residuals, workloads must span the inputs. [^trend-prof]
- [Analysis of Algorithms, lecture slides 1.4](https://www.cs.princeton.edu/courses/archive/fall15/cos226/lectures/14AnalysisOfAlgorithms.pdf) — Robert Sedgewick and Kevin Wayne, Princeton University, 2015. Rank 3. Backs: doubling hypothesis, b = lg ratio, cannot identify log factors, log-log plot and regression, solving for a, system-independent versus system-dependent effects, the T(2N)/T(N) table. [^algs4-slides]
- [1.4 Analysis of Algorithms](https://algs4.cs.princeton.edu/14analysis/) — Robert Sedgewick and Kevin Wayne, Algorithms 4th edition site, living. Rank 3. Backs: Check 4, the model leaves out system effects such as caching, garbage collection and just-in-time compilation. [^algs4-14]
- [A Guide to Experimental Algorithmics, index](https://assets.cambridge.org/97811070/01732/index/9781107001732_index.pdf) — Catherine C. McGeoch, Cambridge University Press, 2012. Rank 3. Backs: "doubling experiment" and "ratio test" are textbook terms (index entries only; the pages were not read). [^mcgeoch]
- [Analysis of algorithms: Empirical orders of growth](https://en.wikipedia.org/wiki/Analysis_of_algorithms) — Wikipedia, living, read 2026-11-25. Rank 5. Backs: Troubleshooting, the local exponent changes across ranges (curved log-log line). [^wiki-aoa]
- Lab run, 2026-11-25: Docker images `python:3.15.2-slim` (CPython 3.15.2, Debian 13, arm64; run with `--network none` and `python -I`) and `node:24.22.1-alpine` (Node.js 24.22.1; `--network none`) on an Apple M2, macOS 26.1, Docker under OrbStack. The four scripts are embedded above; counts are deterministic, timings change from run to run. [^lab]
- `performance/code-review/perf-reviewer-calibration.md` §7.1 and §7.3 — the scaling harness, its 10 ms warning, and the earlier measurements of the fixed-cost and `Map` effects (Node.js 24.22.1, 2026-11-25). [^lab-cal]

## Related
- `algorithms/fundamentals/calculating-complexity-from-code.md` — derive the formula that this doc confirms by running.
- `algorithms/fundamentals/asymptotic-notation-and-cases.md` — what the measured class does and does not promise.
- `algorithms/fundamentals/growth-classes-and-feasible-input-sizes.md` — what each class allows at a given n.
- `algorithms/fundamentals/complexity-and-big-o.md` — the growth classes, measured.
- `performance/measurement/benchmarking-methodology.md` — fair benchmarks: warm-up, repeats, environment.
- `performance/hardware/memory-hierarchy-and-caches.md` — why one memory access costs more in a large table.
- `performance/code-review/perf-reviewer-calibration.md` — a scaling harness built on this method, and its measured pitfalls.
