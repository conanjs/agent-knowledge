---
schema: topic-index/v1
kind: subtopic
topic: algorithms/fundamentals
last-updated: 2026-11-26
---

# Algorithm fundamentals

How cost grows with input size, and how to work it out: Big-O measured from O(1) to O(n²); amortized cost; what O, Ω, Θ and the cases claim; calculating the cost of code by counting; recurrences and the master theorem for recursive code; memory as the second cost; growth classes and the input sizes they allow; measuring a growth rate with the doubling experiment; and problems with no known fast algorithm. Not covered: formal proofs.

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [complexity-and-big-o.md](complexity-and-big-o.md) | concept | Big-O describes how an algorithm's cost **grows** with input size n, ignoring constant factors: O(1) stays flat, O(log n) grows by a step each time n doubles, O(n) doubles when n doubles, O(n log n) slightly more than doubles, O(n²) quadruples | verified |
| [amortized-analysis.md](amortized-analysis.md) | concept | Some operations are usually cheap but occasionally expensive — appending to a growable array copies everything when the array runs out of room | verified |
| [asymptotic-notation-and-cases.md](asymptotic-notation-and-cases.md) | concept | What O, Ω, Θ, little-o and ~ each claim, why best, worst, average, expected and amortized case are a separate axis, and six misreadings, with a measured insertion-sort and merge-sort crossover | verified |
| [calculating-complexity-from-code.md](calculating-complexity-from-code.md) | how-to | A repeatable procedure to derive the cost of code by counting one statement: sequences, nested and triangular loops, halving, early exits, hidden library costs; checked by counters and the doubling ratio | verified |
| [recurrences-and-the-master-theorem.md](recurrences-and-the-master-theorem.md) | concept | The cost of recursive code as a recurrence, solved by a recursion tree or the master theorem, with a table of the recurrences an engineer meets and counted calls | verified |
| [space-complexity.md](space-complexity.md) | concept | Memory as the second cost: auxiliary space, the recursion stack, in-place algorithms and time–space trade-offs, measured with `tracemalloc` | verified |
| [growth-classes-and-feasible-input-sizes.md](growth-classes-and-feasible-input-sizes.md) | reference | Each growth class from O(1) to O(n!): its code shape, what doubling n does, and the largest n measured to finish in about one second in Python and Node.js | verified |
| [measuring-complexity-empirically.md](measuring-complexity-empirically.md) | how-to | The doubling experiment: fit T ≈ a·nᵇ, read b as the log-log slope, and rule out fixed costs and cache effects; measured in Python and Node.js | verified |
| [intractable-problems-and-np-hardness.md](intractable-problems-and-np-hardness.md) | concept | Exponential and factorial growth in numbers; P, NP, NP-complete and NP-hard defined; recognising hard requirements; exact, pseudo-polynomial, approximate and solver options | verified |

## References
- [NIST Dictionary of Algorithms and Data Structures](https://xlinux.nist.gov/dads/) — NIST, living. Backs: topic scope.

## Related
- `algorithms/learning-path.md` — where this subtopic sits in the learning order.
- `performance/` — making real systems fast.
