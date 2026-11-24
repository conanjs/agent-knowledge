---
schema: knowledge-doc/v1
type: concept
topic: go/standard-library
status: verified
applies-to: ["Go 1.27 (go1.27.4)", "range over functions: Go ≥ 1.23", "strings/bytes iterator functions: Go ≥ 1.24"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [go, golang, iterators, range-over-func, iter, yield, iter-pull, slices, maps, strings-lines]
ranked-sources: true
---

# Iterators and range over functions

## Summary
**TL;DR:** Since Go 1.23 a `for … range` loop can range over a function that takes a `yield` callback: the function *pushes* each value by calling `yield(v)`, and `yield` returns `false` once the loop has stopped early (for example by `break`). The `iter` package names these function types `iter.Seq[V]` and `iter.Seq2[K, V]`, and `iter.Pull` turns one into a *pull* iterator (`next`, `stop`) for the rare loop that must step two sequences at once. An iterator must check every `yield` result: calling `yield` again after it returned `false` panics.
**Use this when:** you give a collection type a way to be looped over, wrap a paginated or streamed source in a `for range` loop, use `slices.Collect`, `slices.Sorted(maps.Keys(m))` or `strings.Lines`, or debug the panic "range function continued iteration".
**Not this doc:** `range` over slices, maps, strings, channels and integers → `go/fundamentals/control-flow-and-functions.md`; the type-parameter syntax in `iter.Seq[V]` → `go/generics/type-parameters-and-constraints.md`; goroutine leaks from channel-based iterators → `go/concurrency/patterns-and-goroutine-leaks.md`.

## Problem
Before Go 1.23 the language could `range` only over its built-in containers, so every library invented its own loop shape. The standard library alone had several push-style callbacks (`sync.Map.Range`, `flag.Visit`, `filepath.Walk`), and none of them work quite the same way ✅[^8]. A hand-written *pull* iterator built on a goroutine and channels also needs a separate stop function, or the goroutine is left running when the caller quits early ✅[^8]. Callers had to learn a new mechanism for each container, and no generic helper could work across containers ✅[^8].

## Mental model
**Analogy:** a push iterator is a tour guide who walks you through a museum and, at each exhibit, asks "shall we go on?". You answer by returning `true` or `false`; on `false` the guide stops, tidies up and leaves — and must never ask again. A pull iterator is a ticket machine: you press *next* for each item, and if you walk away early you must press *cancel* (`stop`) so the machine can reset.

**Artifact:** the two iterator types and the smallest useful iterator ✅[^3]:
```go
// Declared in package iter:
type Seq[V any] func(yield func(V) bool)        // one value per step
type Seq2[K, V any] func(yield func(K, V) bool) // a pair per step (key/value, index/value)

// In your own package (which imports "iter"):
// Countdown is an iter.Seq[int]: it pushes n, n-1, …, 1 and stops as soon as yield says so.
func Countdown(n int) iter.Seq[int] {
	return func(yield func(int) bool) {
		for i := n; i > 0; i-- {
			if !yield(i) {
				return
			}
		}
	}
}
// for v := range Countdown(3) { fmt.Println(v) }   // 3, 2, 1
```

## How it works
1. **What `range` accepts.** Since Go 1.23 the range clause accepts functions of type `func(yield func() bool)`, `func(yield func(V) bool)` and `func(yield func(K, V) bool)`; `yield` cannot be variadic ✅[^2] ✅[^4].
2. **The loop becomes a `yield` function.** For `for v := range f`, the compiler calls `f` with a new, synthesized `yield`. Each call `yield(v)` runs the loop body once with `v`. After each iteration `yield` returns `true`; when the body terminates (for example with `break`), `yield` returns `false` and must not be called again ✅[^2].
3. **The iterator owns cleanup.** When `yield` returns `false`, the iterator just returns and does any cleanup it needs; for/range guarantees `yield` returns `false` however the loop exits early ✅[^8]. In the lab, a `defer` inside the iterator function ran both after a full walk and right after a `break` ✅[^1].
4. **Breaking the contract panics.** The `iter` package states that `yield` panics if called after it returned `false` ✅[^3]. On Go 1.27.4 the message is `panic: runtime error: range function continued iteration after function for loop body returned false` ✅[^1].
5. **Naming conventions.** A collection's iterator method is conventionally `All`; a type with several sequences names each one (`Cities`, `Languages`); an iterator that needs arguments is a constructor that returns a `Seq` (`Scan(min, max)`, `Split(s, sep)`); a reverse order gets its own name such as `Backward` ✅[^3]. Functions that accept or return iterators should use `iter.Seq` or `iter.Seq2` so they work with range loops and adapters ✅[^3].
6. **Recursive containers are easy.** A tree iterator can recurse and let the goroutine's own call stack remember the position, returning `false` "all the way up the stack" once `yield` refuses a value ✅[^8]:
   ```go
   func (t *Tree) push(yield func(int) bool) bool {
   	if t == nil {
   		return true
   	}
   	return t.left.push(yield) && yield(t.val) && t.right.push(yield)
   }
   // tree 50,30,70,20,40,60,80 → 20 30 40 50 60 70 80; with break at 40 → 20 30 40, then cleanup runs
   ```
   The in-order output and the early stop were observed in the lab ✅[^1].
7. **Single-use iterators.** Most iterators walk the whole sequence again each time they are called. Some, typically over a stream that cannot rewind, are single-use: calling them again after the end yields nothing, and their doc comment should say so ✅[^3]. `strings.Lines` is documented as single-use ✅[^6]; ranging the same `strings.Lines` value twice over three lines produced 3 lines in total, not 6 ✅[^1].
8. **Pull iterators.** `iter.Pull(seq)` returns `next` and `stop`. `next()` returns the next value and `true`, or the zero value and `false` at the end, and keeps returning that after the end or after `stop` ✅[^3]. If the caller does not read to the end it must call `stop`, which lets the iterator function finish; `stop` may be called more than once, so `defer stop()` is the usual form ✅[^3]. `next` and `stop` must not be called from several goroutines at the same time, and a panic inside the iterator re-panics from `next` or `stop` ✅[^3].
9. **Standard iterator functions.**
   - Go 1.23, `slices`: `All` (index, value), `Values`, `Backward`, `Collect`, `AppendSeq`, `Sorted`, `SortedFunc`, `SortedStableFunc`, `Chunk` ✅[^4].
   - Go 1.23, `maps`: `All`, `Keys`, `Values`, `Insert`, `Collect` ✅[^4]. `maps.Keys` yields keys in an unspecified order that may differ between calls ✅[^7], so the idiom for sorted keys is `slices.Sorted(maps.Keys(m))` ✅[^3].
   - Go 1.24, `strings` and `bytes`: `Lines`, `SplitSeq`, `SplitAfterSeq`, `FieldsSeq`, `FieldsFuncSeq` ✅[^5]. `strings.Lines` keeps each line's terminating newline, and a last line without one comes out without one ✅[^6].
10. **Iterators do not mutate.** An iterator gives only values. To let callers delete or replace items during a walk, the `iter` docs suggest iterating over a position type that has methods such as `Delete` and `Set` ✅[^3].

## Worked example
A paginated source (an API — application programming interface — that returns two items per page and has three pages) wrapped as an `iter.Seq2[string, error]`, so callers write one `for range` loop and never see the paging:

```go
func Items(failAt int) iter.Seq2[string, error] {
	return func(yield func(string, error) bool) {
		for page := 1; ; page++ {
			fmt.Println("  fetching page", page)
			items, more, err := fetchPage(page, failAt) // fake API: 2 items per page, 3 pages
			if err != nil {
				yield("", err) // report the error as the last pair
				return
			}
			for _, it := range items {
				if !yield(it, nil) {
					return // the caller broke out: fetch nothing more
				}
			}
			if !more {
				return
			}
		}
	}
}
```

| Step | Caller code | Observed output ✅[^1] |
|---|---|---|
| 1 | `for it, err := range Items(0)` | `fetching page 1`, then `p1-a`, `p1-b` |
| 2 | loop continues | `fetching page 2`, then `p2-a` |
| 3 | `if it == "p2-a" { break }` | `yield` returns `false`; the iterator returns; page 3 is never fetched |
| 4 | `range Items(2)` (page 2 fails) | `p1-a`, `p1-b`, `fetching page 2`, then `error: page 2: connection reset` |

The early `break` saved a network call without the caller knowing pages exist, which is the point of the push model: the iterator decides how to fetch, the loop decides when to stop.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| The iterator ignores `yield`'s result and keeps calling it after a `break` | Runtime panic: `range function continued iteration after function for loop body returned false` ✅[^1] | `yield` must not be called after it returned `false` ✅[^2] ✅[^3] |
| Ranging the same single-use iterator twice | The second loop sees no values ✅[^1] | Single-use iterators report a stream that cannot rewind ✅[^3] |
| `for k := range maps.Keys(m)` printed in a test | Order changes between runs | Key order is not specified and may differ per call ✅[^7] |
| `iter.Pull` read halfway, `stop` never called | The iterator function never gets to finish and return | Callers that stop early must call `stop` ✅[^3] |
| `next()` after `stop()` | Returns the zero value and `false` (`"" false` for strings) ✅[^1] | Documented behaviour of `next` ✅[^3] |
| Two pull iterators stepped in lockstep (`EqSeq`) | Each `defer stop()` ran when the function returned, the last one first ✅[^1] | `defer` order is last-in, first-out; `stop` lets each iterator clean up ✅[^3] |
| Iterator needs to report an error | No standard type; one convention is `iter.Seq2[T, error]` with the error as the last pair, as in the worked example | `iter` defines only `Seq` and `Seq2` ✅[^3] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Push iterator (`iter.Seq`) | Works with `for range`; simple to write, even recursively; the iterator controls setup and cleanup ✅[^8] | Every `yield` result must be checked |
| Pull iterator (`iter.Pull`) | Step two sequences in parallel, or consume one value at a time ✅[^8] | Must call `stop`; not for concurrent use ✅[^3] |
| Return a slice | Can be indexed, ranged many times | Builds every element before the caller sees the first one |
| Channel fed by a goroutine | Familiar | Needs a stop channel or the goroutine stays blocked when the caller quits early ✅[^8] |

## Takeaways
- Give every collection type an `All() iter.Seq[T]` (or `iter.Seq2[K, V]`) method, and accept and return the standard `iter` types ✅[^3]. [rule-candidate]
- In an iterator, write `if !yield(v) { return }` for every value; never call `yield` again after it returned `false`. [rule-candidate]
- Write `defer stop()` on the line after `iter.Pull`. [rule-candidate]
- Say "single-use" in the doc comment of an iterator over a stream ✅[^3].
- Sort map keys explicitly with `slices.Sorted(maps.Keys(m))` before printing or comparing them.

## Verification status
- Verified: 47 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `go/lab-setup.md` — the Go 1.27.4 lab (`golang:1.27.4`) where every behaviour marked with this note ran on 2026-11-24: the tree walk with `break`, the `yield`-after-false panic, `iter.Pull` with `EqSeq`, `strings.Lines` ranged twice, `slices`/`maps`/`strings` iterator output and the paginated source. [^1]
- [The Go Programming Language Specification](https://go.dev/ref/spec) — Go team, living. Rank 1. Backs: §For statements with range clause (function range expressions, the synthesized `yield`, `yield` returns false and must not be called again). [^2]
- [iter package](https://pkg.go.dev/iter) — Go team, living. Rank 1. Backs: `Seq`/`Seq2`, `yield` panics after false, naming conventions, single-use iterators, `Pull`/`Pull2` and `stop`, the sorted-keys idiom, mutation through position types. [^3]
- [Go 1.23 Release Notes](https://go.dev/doc/go1.23) — Go team, 2024. Rank 1. Backs: range over function types; the new `slices` and `maps` iterator functions. [^4]
- [Go 1.24 Release Notes](https://go.dev/doc/go1.24) — Go team, 2025. Rank 1. Backs: `Lines`, `SplitSeq`, `SplitAfterSeq`, `FieldsSeq`, `FieldsFuncSeq` in `strings` and `bytes`. [^5]
- [strings package](https://pkg.go.dev/strings) — Go team, living. Rank 1. Backs: `strings.Lines` keeps newlines and is single-use. [^6]
- [maps package](https://pkg.go.dev/maps) — Go team, living. Rank 1. Backs: `maps.Keys` iteration order is not specified. [^7]
- [Range Over Function Types](https://go.dev/blog/range-functions) — Ian Lance Taylor, Go team, 2024. Rank 4. Backs: the problem before Go 1.23, push versus pull, the channel-based pull iterator and its stop function, cleanup on early exit, the recursive tree iterator. [^8]

## Related
- `go/fundamentals/control-flow-and-functions.md` — `range` over the built-in types and closures, which iterators are made of.
- `go/generics/type-parameters-and-constraints.md` — the type parameters in `iter.Seq[V]`.
- `go/data-types/maps.md` — why map order is random.
- `go/concurrency/patterns-and-goroutine-leaks.md` — channel pipelines, the older way to stream values.
- `javascript/generators-iterators/generators-and-async-iteration.md` — JavaScript's pull-style `next()` iterators, for comparison.
- `go/learning-path.md`
