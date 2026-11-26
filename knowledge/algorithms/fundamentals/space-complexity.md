---
schema: knowledge-doc/v1
type: concept
topic: algorithms/fundamentals
status: verified
applies-to: ["any language", "measurements: CPython 3.15.2 (python:3.15.2-slim) and Node.js 24.22.1 (node:24.22.1-alpine), arm64"]
last-verified: 2026-11-25
last-updated: 2026-11-26
tags: [algorithms, complexity, space-complexity, memory, auxiliary-space, in-place, recursion, call-stack, recursion-limit, tracemalloc, memoization]
ranked-sources: true
---

# Space complexity: memory as the second cost

## Summary
**TL;DR:** Space complexity is how an algorithm's memory use grows with the input size n, written with the same Big-O notation as time. Count **auxiliary space** (what the algorithm adds on top of its input): new lists, hash tables, copies, caches and the **recursion stack**, one frame per pending call. In the lab, `sorted()` on 400,000 floats peaked at 12 bytes per item (a new list plus a merge buffer) while `list.sort()` in place peaked at 4 bytes per item; Python's `tracemalloc` reported 0 bytes for a 40,000-deep recursion, because it does not see stack frames; Python's default recursion limit was 1,000 and Node.js 24 stopped at about 10,400 levels of a small function ✅[^lab].
**Use this when:** a job runs out of memory, a recursive function raises `RecursionError` or `RangeError: Maximum call stack size exceeded`, you trade memory for speed (a set, a cache), or you need to say whether an algorithm is "in place".
**Not this doc:** time complexity and Big-O → `complexity-and-big-o.md`; why memory access speed varies → `../../performance/hardware/memory-hierarchy-and-caches.md`; how a dynamic array grows → `amortized-analysis.md`.

## Problem
Two functions with the same time complexity can differ by a factor of n in memory. A deduplication step that is O(n) in time may hold a hash set as large as its input; a recursive tree walk that is fine on a test tree of depth 50 crashes on a production list of 100,000 linked items. Memory problems also show up late: in an out-of-memory kill, a swap storm, or a recursion error, not in a slower benchmark.

Symbols and terms used in this doc:

| Term | Meaning | Worked example |
|---|---|---|
| n | Input size | A list of 40,000 numbers: n = 40,000 |
| S(n) | Memory the algorithm uses for input size n | Building a list of 40,000 ints: S(40,000) ≈ 1,627,040 bytes traced in the lab ✅[^lab] |
| Total space | Input plus everything the algorithm adds | Summing a 40,000-item list: the list itself plus one accumulator |
| Auxiliary space | Only what the algorithm adds; the usual meaning of "uses O(1) extra space" | Summing the same list: one accumulator, O(1) |
| Stack frame | The memory one pending function call holds (arguments, locals, where to return) | `rsum(50,000)` has 50,001 frames pending at its deepest point ✅[^lab] |
| log₂ n | How many times n can be halved before reaching 1 | log₂ 50,000 ≈ 15.6 |

## Mental model
**Analogy:** cooking. The ingredients are the input. Auxiliary space is the extra bowls and counter space the recipe needs. Whisking eggs in the bowl they came in is "in place" (O(1) extra). Pouring each ingredient into its own bowl first is O(n) extra. A recipe that says "first make the sauce, which needs the stock, which needs the broth…" keeps every half-finished step on the counter until the deepest one is done: that pile is the recursion stack.

**Artifact:** three ways to reverse a list, with their auxiliary space:

```python
def reverse_in_place(a):           # O(1) auxiliary: two indexes
    i, j = 0, len(a) - 1
    while i < j:
        a[i], a[j] = a[j], a[i]
        i, j = i + 1, j - 1

def reverse_copy(a):               # O(n) auxiliary: a second list of n slots
    return a[::-1]

def reverse_recursive(a, i=0):     # O(n) auxiliary: n/2 pending stack frames
    j = len(a) - 1 - i
    if i < j:
        a[i], a[j] = a[j], a[i]
        reverse_recursive(a, i + 1)
```

All three take O(n) time. Only the first is O(1) in space; the third looks in place but holds n/2 frames, and in Python it fails above the recursion limit.

## How it works

### 1. What space complexity measures
Asymptotic space complexity is the limiting behaviour of an algorithm's memory use as the problem size goes to infinity, usually written in Big-O notation ✅[^nist-space]. The rules for costing are the ones for time (`complexity-and-big-o.md`): drop constants and smaller terms. What differs is what you count.

### 2. What counts
| Allocation | Space | Example |
|---|---|---|
| Scalars (counters, indexes, one accumulator) | O(1) | `total += x` over a list |
| A copy or slice of the input | O(n) | `a[::-1]`, `sorted(a)` |
| A hash set or dictionary of the items | O(n), larger constant than a list | `seen = set(a)` |
| A table of all pairs | O(n²) | An n × n distance matrix |
| A memo cache | O(number of distinct subproblems) ✅[^erickson-dp] | Memoized Fibonacci: n entries |
| The recursion stack | O(maximum depth of pending calls) | Recursive binary search: O(log n) frames; recursive sum: O(n) frames ✅[^lab] |

The Python docs describe the recursion limit as the maximum depth of the Python interpreter stack, which exists to keep infinite recursion from overflowing the C stack and crashing Python ✅[^py-sys]. So stack depth is memory, and it has its own ceiling, far below the heap's.

### 3. In-place algorithms
An in-place sort leaves the sorted items in the storage that held the original items, keeping at most a constant number of items in auxiliary memory at any time ✅[^nist-inplace]. Quicksort is called in place, using "only a small auxiliary stack" ✅[^algs4-quick]. Mergesort's main disadvantage is extra space proportional to N, for its auxiliary array ✅[^algs4-merge]. CPython's sort (Timsort, a merge-based sort) can need a temporary array of up to N//2 pointers, and can be expected to need that much on random data ✅[^listsort].

### 4. O(1), O(log n) and O(n) space, counted
The deepest number of pending calls in three recursive functions (lab) ✅[^lab]:

| n | Recursive binary search | Merge sort call pattern | Recursive sum |
|---|---|---|---|
| 1,000 | 11 | 11 | 1,001 |
| 10,000 | 15 | 15 | 10,001 |
| 50,000 | 17 | 17 | 50,001 |

Binary search and merge sort halve the range per level, so depth is about log₂ n + 1 (log₂ 50,000 ≈ 15.6 → 17 levels including the top call and the base case). The recursive sum makes one call per item: n + 1 levels. An iterative loop over the same items uses O(1): the `running_sum` column in the Worked example traced 0 bytes ✅[^lab].

### 5. Time–space trade-offs
- **A hash set buys time with memory.** Membership in a list is O(n) per test; in a set it is O(1) on average (`../data-structures/data-structure-catalog.md`). The price: at n = 40,000, the set traced 3,373,400 bytes against 1,627,040 for a list of the same ints, about 2.1 times as much ✅[^lab].
- **Memoization buys time with memory.** Caching every distinct subproblem makes the space equal to the number of distinct subproblems ✅[^erickson-dp]; see `../techniques/dynamic-programming-and-greedy.md` for the call counts. When only the last few results are needed, keep only those: Fibonacci needs just the two newest values ✅[^erickson-dp], O(1) instead of O(n).
- **A copy buys simplicity with memory.** `sorted(a)` keeps the original and allocates a new list; `a.sort()` reuses it (Worked example: 12 versus 4 bytes per item) ✅[^lab].

### 6. Recursion depth limits: Python and JavaScript
**Python.** `sys.getrecursionlimit()` returns the current limit and `sys.setrecursionlimit()` changes it; the highest possible limit is platform-dependent and a too-high limit can crash the interpreter ✅[^py-sys]. Exceeding the limit raises `RecursionError` ✅[^py-exc]. In the lab, the default limit was 1,000, and with the limit raised to 10,000,000, a plain recursive function ran 2,000,000 levels deep, growing the process's peak resident memory by about 150 bytes per level at 1,000,000 and 2,000,000 levels ✅[^lab]:

```text
python 3.15.2
default recursion limit: 1000
deepest call under the default limit: 999 | maximum recursion depth exceeded
depth, outcome, peak RSS growth, bytes per level (limit set to 10,000,000)
  100,000 ok 8 MiB 87
1,000,000 ok 147 MiB 153
2,000,000 ok 300 MiB 157
```

<details><summary>Script: recursion_depth.py (run with <code>docker run --rm --network none -v "$PWD:/work" -w /work python:3.15.2-slim python -I recursion_depth.py</code>)</summary>

```python
import subprocess
import sys

CHILD = """
import resource, sys
sys.setrecursionlimit(10_000_000)
def down(n):
    return 0 if n == 0 else 1 + down(n - 1)
before = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
depth = int(sys.argv[1])
try:
    down(depth)
    outcome = "ok"
except RecursionError as e:
    outcome = "RecursionError: " + str(e)
after = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
grown = (after - before) * 1024
print(outcome, f"{grown / 2**20:.0f} MiB", grown // depth)
"""

print("python", sys.version.split()[0])
print("default recursion limit:", sys.getrecursionlimit())

reached = 0
def probe(n):
    global reached
    reached = n
    probe(n + 1)
try:
    probe(1)
except RecursionError as e:
    print("deepest call under the default limit:", reached, "|", e)

print("depth, outcome, peak RSS growth, bytes per level (limit set to 10,000,000)")
for depth in (100_000, 1_000_000, 2_000_000):
    run = subprocess.run([sys.executable, "-I", "-c", CHILD, str(depth)],
                         capture_output=True, text=True)
    line = run.stdout.strip() or f"process died, exit code {run.returncode}"
    print(f"{depth:>9,} {line}")
```

</details>

**JavaScript (Node.js).** Too deep a recursion throws `RangeError: Maximum call stack size exceeded`, the message MDN lists for Chrome ✅[^mdn-recursion]; Node.js printed the same message in the lab ✅[^lab]. The limit is a stack size in bytes, not a count of calls, so the depth depends on the frame size. In the lab, a function with one argument reached about 10,400 levels and one with eight extra local variables about 6,240 ✅[^lab]. V8's own options, such as `--stack-size`, are passed through by `node`, but they carry no stability guarantee ✅[^node-cli]. With `--stack-size=4000` the depths rose about four times ✅[^lab]:

```text
node v24.22.1, default flags, small frame: deepest 10393, 10393, 10393 | RangeError: Maximum call stack size exceeded
node v24.22.1, default flags, large frame: deepest 6236, 6236, 6236 | RangeError: Maximum call stack size exceeded
node v24.22.1, --stack-size=4000, small frame: deepest 42562, 42562, 42562 | RangeError: Maximum call stack size exceeded
node v24.22.1, --stack-size=4000, large frame: deepest 25537, 25537, 25537 | RangeError: Maximum call stack size exceeded
```

<details><summary>Script: recursion_depth.mjs (run with <code>docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node recursion_depth.mjs</code>, then again with <code>node --stack-size=4000 recursion_depth.mjs</code>)</summary>

```javascript
// Deepest recursion Node.js reaches before it throws, for a small and a larger frame.
function depthOf(kind) {
  let deepest = 0;
  function small(n) {
    deepest = n;
    return small(n + 1) + 1;
  }
  function large(n) {
    deepest = n;
    const a = n + 1, b = n + 2, c = n + 3, d = n + 4, e = n + 5, f = n + 6, g = n + 7, h = n + 8;
    return large(n + 1) + a + b + c + d + e + f + g + h;
  }
  let message = "";
  try {
    (kind === "small" ? small : large)(1);
  } catch (err) {
    message = `${err.constructor.name}: ${err.message}`;
  }
  return [deepest, message];
}

const flags = process.execArgv.join(" ") || "default flags";
for (const kind of ["small", "large"]) {
  const runs = [];
  for (let i = 0; i < 3; i++) runs.push(depthOf(kind));
  console.log(`node ${process.version}, ${flags}, ${kind} frame: deepest ${runs.map((r) => r[0]).join(", ")} | ${runs[0][1]}`);
}
```

</details>

Raising `--stack-size` past the real thread stack does not raise the limit; it crashes. In the same container, one shell command (`echo "ulimit -s: $(ulimit -s)"; node --stack-size=65500 recursion_depth.mjs; echo "exit code with --stack-size=65500: $?"`) printed `ulimit -s: 8192`, then `Segmentation fault`, then `exit code with --stack-size=65500: 139`: the thread stack limit is 8192 KB, and Node.js died before printing anything of its own ✅[^lab].

## Worked example
Prediction, then measurement with `tracemalloc`, which traces memory blocks allocated by Python ✅[^py-tm]. `tracemalloc.start()` installs hooks on Python's memory allocators, `get_traced_memory()` returns the current and peak traced size, and `reset_peak()` sets the peak to the current size ✅[^py-tm].

**Prediction** for a list of n ints from 1,000 upward: `sys.getsizeof` says 8 bytes per list slot and 28 bytes per int object, so 36 bytes per item, 360,056 bytes for n = 10,000 (including the list header) ✅[^lab]. A set should cost more per item than a list. A sort into a new list should cost the new list (8 bytes per item) plus Timsort's buffer of up to n/2 pointers (4 bytes per item) ✅[^listsort].

```text
python 3.15.2
n, running_sum, list, predicted list, set, rec_sum, frames_only (bytes traced at peak)
10000 0 401184 360056 840536 284064 0
20000 0 808992 720056 3246840 604064 0
40000 0 1627040 1440056 3373400 1244064 0
sys.getsizeof: list 8.0014 bytes per slot, 28 bytes per int object
tracemalloc: list comprehension 8.7752 bytes per slot, 31.9008 bytes per int object
n, sorted(copy) peak, list.sort() peak, n * 8 bytes
100000 1199992 399992 800000
200000 2400000 800000 1600000
400000 4800000 1600000 3200000
n, deepest stack: recursive binary search, merge sort, recursive sum
1000 11 11 1001
10000 15 15 10001
50000 17 17 50001
```

<details><summary>Script: space_tracemalloc.py (run with <code>docker run --rm --network none -v "$PWD:/work" -w /work python:3.15.2-slim python -I space_tracemalloc.py</code>)</summary>

```python
import random
import sys
import tracemalloc

def peak_bytes(fn):
    """Run fn() and return the peak traced bytes allocated while it ran."""
    tracemalloc.start()
    tracemalloc.reset_peak()
    base, _ = tracemalloc.get_traced_memory()
    result = fn()
    _, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    del result
    return peak - base

def running_sum(n):            # O(1) auxiliary space: one accumulator
    total = 0
    for i in range(n):
        total += i
    return total

def build_list(n):             # O(n): n pointers plus n int objects
    return [i + 1000 for i in range(n)]

def build_set(n):              # O(n), with a bigger constant than a list
    return {i + 1000 for i in range(n)}

def rec_sum(n):                # O(n) stack: one frame per pending call
    return 0 if n == 0 else n + rec_sum(n - 1)

remaining = 0
def frames_only():             # O(n) stack, but allocates no objects
    global remaining
    if remaining == 0:
        return
    remaining -= 1
    frames_only()

def deep_frames(n):
    global remaining
    remaining = n
    frames_only()

sys.setrecursionlimit(100_000)
print("python", sys.version.split()[0])
print("n, running_sum, list, predicted list, set, rec_sum, frames_only (bytes traced at peak)")
for n in (10_000, 20_000, 40_000):
    predicted = sys.getsizeof([None] * n) + n * sys.getsizeof(10**6)
    print(n,
          peak_bytes(lambda: running_sum(n)),
          peak_bytes(lambda: build_list(n)),
          predicted,
          peak_bytes(lambda: build_set(n)),
          peak_bytes(lambda: rec_sum(n)),
          peak_bytes(lambda: deep_frames(n)))

print("sys.getsizeof: list", sys.getsizeof([None] * 40_000) / 40_000, "bytes per slot,",
      sys.getsizeof(10**6), "bytes per int object")
slots = [None] * 40_000
def fill():
    for i in range(40_000):
        slots[i] = i + 1000
print("tracemalloc: list comprehension", peak_bytes(lambda: [None for _ in range(40_000)]) / 40_000,
      "bytes per slot,", peak_bytes(fill) / 40_000, "bytes per int object")

# Sorting: a new sorted copy versus sorting in place.
random.seed(3)
print("n, sorted(copy) peak, list.sort() peak, n * 8 bytes")
for n in (100_000, 200_000, 400_000):
    data = [random.random() for _ in range(n)]
    copy_peak = peak_bytes(lambda: sorted(data))
    inplace = data[:]
    inplace_peak = peak_bytes(lambda: inplace.sort())
    print(n, copy_peak, inplace_peak, n * 8)

# Stack depth: how many calls are pending at the deepest point.
deepest = 0
def track(depth):
    global deepest
    deepest = max(deepest, depth)

def bsearch(a, key, lo, hi, depth=1):      # O(log n) stack
    track(depth)
    if lo >= hi:
        return lo
    mid = (lo + hi) // 2
    if a[mid] < key:
        return bsearch(a, key, mid + 1, hi, depth + 1)
    return bsearch(a, key, lo, mid, depth + 1)

def msort_depth(lo, hi, depth=1):          # merge sort's call pattern, O(log n) stack
    track(depth)
    if hi - lo > 1:
        mid = (lo + hi) // 2
        msort_depth(lo, mid, depth + 1)
        msort_depth(mid, hi, depth + 1)

def rsum(n, depth=1):                      # O(n) stack
    track(depth)
    return 0 if n == 0 else n + rsum(n - 1, depth + 1)

print("n, deepest stack: recursive binary search, merge sort, recursive sum")
for n in (1_000, 10_000, 50_000):
    row = [n]
    for run in (lambda: bsearch(range(n), -1, 0, n), lambda: msort_depth(0, n), lambda: rsum(n)):
        deepest = 0
        run()
        row.append(deepest)
    print(*row)
```

</details>

**Measured against predicted** ✅[^lab]:

| What | Predicted | Traced | Why they differ |
|---|---|---|---|
| `running_sum` (loop, one accumulator) | O(1) | 0 bytes at every n | Nothing accumulates: each new total replaces the old one |
| List of n ints | 36 bytes per item, O(n) | 40.7 bytes per item (1,627,040 / 40,000), doubling with n | Allocations are 31.9 bytes per int, not 28, and a growing list over-allocates (8.78 bytes per slot, see `amortized-analysis.md`) |
| Set of n ints | O(n), more than a list | 840,536 → 3,246,840 → 3,373,400 | The hash table resizes in jumps, so per-item cost swings between about 84 and 162 bytes |
| `sorted()` copy | 8 + 4 = 12 bytes per item | 1,199,992 at n = 100,000: 12.0 bytes per item | Matches |
| `list.sort()` in place | Up to 4 bytes per item | 399,992 at n = 100,000: 4.0 bytes per item | Matches the N//2-pointer buffer: in place for the items, not O(1) |
| `rec_sum` (O(n) stack) | O(n) | 28 to 31 bytes per level | Only the int arguments are traced |
| `frames_only` (O(n) stack, no objects) | O(n) | 0 bytes | `tracemalloc` does not see stack frames; the process's resident memory did grow, about 150 bytes per level (section 6) |

So the growth class was right in every row, and the constants were off by 10 to 20 percent wherever the prediction used `sys.getsizeof`.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| "In-place" sort with a buffer | `list.sort()` traced n/2 pointers of extra memory ✅[^lab] | Timsort's merge buffer ✅[^listsort]; "in place" in everyday usage is not always O(1) auxiliary space |
| Recursion that only moves indexes | Still O(depth) memory | Each pending call keeps a frame until it returns |
| Code whose recursive call is the last statement (tail call) | CPython still grows the stack: the lab's `probe` ends with its recursive call and hit the limit at 999 ✅[^lab] | Rewrite as a loop when depth can reach n |
| Generators and iterators | O(1) instead of O(n) for a pipeline that never builds a list | Each item is produced and dropped |
| `tracemalloc` on code that recurses or calls C libraries | Under-reports | It traces blocks from Python's allocators ✅[^py-tm]; frames were not counted in the lab ✅[^lab] |
| Raising Python's recursion limit | Works until memory or the platform runs out | The highest possible limit is platform-dependent and too high can crash ✅[^py-sys] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Hash set or dict for lookups | O(1) average membership | About 2× to 4× the memory of a list of the same items in the lab ✅[^lab] |
| Memoize all subproblems | Each subproblem computed once | Memory for every distinct subproblem ✅[^erickson-dp] |
| Keep only the last k results (rolling table) | O(k) memory | Cannot answer earlier subproblems again |
| Recursion | Code mirrors the problem | O(depth) stack and a hard depth limit |
| Explicit stack or loop | Depth limited only by heap memory | More code |

## Takeaways
- State space next to time when you give an algorithm's cost, and count the recursion stack and caches. [rule-candidate]
- Any recursion whose depth can grow with n (linked lists, unbalanced trees, recursive sum) should be a loop in Python and JavaScript. [rule-candidate]
- Measure Python memory with `tracemalloc` for objects, and with the process's resident memory when recursion or C code is involved.
- When a cache or set is the speed-up, estimate its memory at production n before shipping it.

## Verification status
- Verified: 39 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [sys — System-specific parameters and functions: getrecursionlimit, setrecursionlimit](https://docs.python.org/3/library/sys.html#sys.setrecursionlimit) — Python Software Foundation, Python 3.15.2 docs, living. Rank 1. Backs: the limit is the maximum depth of the interpreter stack and guards the C stack; the highest limit is platform-dependent and too high can crash. [^py-sys]
- [Built-in Exceptions: RecursionError](https://docs.python.org/3/library/exceptions.html#RecursionError) — Python Software Foundation, Python 3.15.2 docs, living. Rank 1. Backs: raised when the maximum recursion depth is exceeded. [^py-exc]
- [tracemalloc — Trace memory allocations](https://docs.python.org/3/library/tracemalloc.html) — Python Software Foundation, Python 3.15.2 docs, living. Rank 1. Backs: traces memory blocks allocated by Python; `start`, `get_traced_memory`, `reset_peak`. [^py-tm]
- [Command-line API: Useful V8 options](https://nodejs.org/docs/latest-v24.x/api/cli.html#useful-v8-options) — Node.js project, v24 docs, living. Rank 1. Backs: V8 options given to `node` are passed to V8 and have no stability guarantee. [^node-cli]
- [Objects/listsort.txt](https://github.com/python/cpython/blob/main/Objects/listsort.txt) — CPython project, living. Rank 1. Backs: Timsort can need a temp array of up to N//2 pointers, expected on random data. [^listsort]
- [asymptotic space complexity](https://xlinux.nist.gov/dads/HTML/asymptoticSpaceComplexity.html) — NIST Dictionary of Algorithms and Data Structures, living. Rank 3. Backs: definition of space complexity. [^nist-space]
- [in-place sort](https://xlinux.nist.gov/dads/HTML/inplacesort.html) — NIST Dictionary of Algorithms and Data Structures, living. Rank 3. Backs: definition of in-place. [^nist-inplace]
- [2.2 Mergesort](https://algs4.cs.princeton.edu/22mergesort/) — Sedgewick and Wayne, Algorithms 4th edition site, living. Rank 3. Backs: mergesort uses extra space proportional to N. [^algs4-merge]
- [2.3 Quicksort](https://algs4.cs.princeton.edu/23quicksort/) — Sedgewick and Wayne, Algorithms 4th edition site, living. Rank 3. Backs: quicksort is in place with a small auxiliary stack. [^algs4-quick]
- [Algorithms, Chapter 3: Dynamic Programming](https://jeffe.cs.illinois.edu/teaching/algorithms/book/03-dynprog.pdf) — Jeff Erickson, 1st edition, 2019. Rank 3. Backs: memoized space equals the number of distinct subproblems; Fibonacci needs only the two newest values. [^erickson-dp]
- [RangeError: Maximum call stack size exceeded / too much recursion](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Errors/Too_much_recursion) — MDN Web Docs, living. Rank 3. Backs: the error message and type listed for Chrome. [^mdn-recursion]
- Lab run, 2026-11-25: Docker images `python:3.15.2-slim` (CPython 3.15.2, Debian 13, arm64) and `node:24.22.1-alpine` (Node.js 24.22.1) on an Apple M2 host with OrbStack, no network. Scripts and outputs are embedded in How it works §6 and Worked example. [^lab]

## Related
- `algorithms/fundamentals/complexity-and-big-o.md` — Big-O applies to memory as well as time.
- `algorithms/fundamentals/amortized-analysis.md` — why a growing list holds spare capacity.
- `algorithms/fundamentals/recurrences-and-the-master-theorem.md` — the depth of a recursion tree is its stack depth.
- `algorithms/techniques/dynamic-programming-and-greedy.md` — memoization, the classic time–space trade.
- `algorithms/data-structures/data-structure-catalog.md` — time costs of the structures whose memory is measured here.
- `performance/hardware/memory-hierarchy-and-caches.md` — why using less memory often also runs faster.
