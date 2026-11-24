---
schema: knowledge-doc/v1
type: concept
topic: go/data-types
status: verified
applies-to: ["Go 1.27 (go1.27.4)", "Swiss-table maps: Go ≥ 1.24", "maps package and clear: Go ≥ 1.21; iterator functions in maps: Go ≥ 1.23"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [go, golang, map, hash-table, swiss-table, comma-ok, iteration-order, concurrent-map-writes, maps-package, clear, nan]
ranked-sources: true
---

# Maps: nil maps, comma-ok, iteration order and Swiss tables

## Summary
**TL;DR:** A Go map is a reference to a runtime hash table: passing it to a function lets the function change the caller's entries. A nil map can be read like an empty map but panics on write. Looking up a missing key returns the zero value, so use the two-value "comma ok" form to tell "missing" from "zero". Iteration order is unspecified and changes from loop to loop, map elements are not addressable, keys must be comparable, and concurrent writes crash the whole program. Since Go 1.24 the table is a Swiss table.
**Use this when:** you see `assignment to entry in nil map` or `concurrent map writes`, need a stable order, want a set type, update a struct stored in a map, or wonder what changed in maps in Go 1.24.
**Not this doc:** hash tables in general (hashing, collisions, load factor) → `algorithms/data-structures/hash-tables.md`; locks and `sync.Map` → `go/concurrency/sync-and-atomics.md`; data races across languages → `concurrency/shared-state-and-data-races.md`.

## Problem
Maps look simple and fail in ways that surprise people coming from other languages: a `var m map[string]int` crashes on the first write; `m["x"] == 0` cannot tell an absent key from a stored zero; tests that print a map pass once and fail the next run; `m[k].field = v` does not compile; and two goroutines writing one map kill the process with a fatal error that `recover` cannot catch.

## Mental model
**Analogy:** a map variable is a **library card** that names a library (the hash table). Copying the card gives a second card for the same library, so books added through one card are visible through the other. A nil map is a blank card: asking for a book returns "nothing there", but trying to shelve one fails because no library exists.

Inside a Go 1.24+ library, shelves hold **8 slots** each, and every shelf has an **index card** listing a 7-bit fingerprint of the key in each slot. To find a key you read the index card first and only open the slots whose fingerprint matches ✅[^9].

**Artifact:** reads on a nil map work, the write does not ✅[^1]:
```go
var m map[string]int
fmt.Println(m["missing"], len(m)) // 0 0
v, ok := m["missing"]              // 0 false
delete(m, "x")                     // no-op
m["a"] = 1                         // panic: assignment to entry in nil map
```

## How it works
1. **Map type and keys.** A map is an unordered group of elements indexed by unique keys; `==` and `!=` must be fully defined for the key type, so keys cannot be functions, maps or slices ✅[^2]. Structs and arrays made of comparable types work as keys ✅[^3]. With an interface key type, a dynamic key that is not comparable causes a run-time panic ✅[^2].
2. **Reference semantics.** Maps hold references to an underlying data structure; a function that changes a map it was passed changes the caller's map ✅[^3]. A map variable measured 8 bytes with `unsafe.Sizeof` on 64-bit Linux ✅[^1].
3. **Creating.** The zero value is `nil` ✅[^2]. `make(map[K]V)` or `make(map[K]V, n)` creates an empty map; `n` is a hint of initial space for about `n` elements and does not bound the size ✅[^2]. A map literal needs a key for every element ✅[^2].
4. **Lookup.** `m[k]` returns the element, or the zero value of the element type if the map is nil or has no such key ✅[^2]. The special form `v, ok := m[k]` adds an untyped boolean that is `true` only when the key is present ✅[^2]; Effective Go calls this the "comma ok" idiom ✅[^3]. A `map[T]bool` works as a set because missing keys read as `false` ✅[^3].
5. **Writing and deleting.** Assigning to an element of a nil map panics ✅[^2]. `delete(m, k)` removes the entry and is a no-op for a nil map or a missing key ✅[^2]. `clear(m)` (Go 1.21) deletes all entries ✅[^2] ✅[^6].
6. **Iteration.** The order of a `range` over a map is not specified and may differ from one iteration to the next ✅[^2]. An entry removed before the loop reaches it is not produced; an entry added during the loop may or may not be produced ✅[^2]. A nil map gives zero iterations ✅[^2]. For a stable order, keep the keys in a separate sorted structure ✅[^8], for example `slices.Sorted(maps.Keys(m))` ✅[^1] ✅[^5].
7. **Not addressable.** Map index expressions are not in the spec's list of addressable operands ✅[^2], so `&m[k]` and `m[k].x = 1` do not compile ✅[^1]. Read the struct, change the copy, store it back, or store pointers.
8. **The `maps` package.** Added in Go 1.21 ✅[^6]; in Go 1.27 it offers `All`, `Keys`, `Values` (iterators), `Collect`, `Insert`, `Clone`, `Copy`, `DeleteFunc`, `Equal` and `EqualFunc` ✅[^5]. The iterator functions came with Go 1.23 ✅[^10].
9. **Concurrency.** Map operations are not atomic: the Go team judged that most uses do not need it and that a mutex on every operation would slow down most programs ✅[^4]. Concurrent reads with no writer are safe ✅[^4]. Some implementations check at run time for unsafe concurrent modification ✅[^4]; in Go 1.27.4 four goroutines writing one map ended the program with `fatal error: concurrent map writes` on every run, and a deferred `recover` in each goroutine did not catch it ✅[^1]. Guard shared maps with `sync.RWMutex` ✅[^8], or use `sync.Map` for its narrower use cases ✅[^4].
10. **Implementation since Go 1.24: Swiss tables.** Go 1.24 replaced the built-in map with one based on the Swiss Table design ✅[^7]. It is an open-addressed table: slots are in groups of 8, each group has a 64-bit control word, and each control byte holds the low 7 bits of the key's hash (h2) while the upper 57 bits (h1) pick the first group to probe ✅[^9]. To bound the cost of growing, a Go map is split into independent tables of at most 1024 entries, chosen by upper hash bits (extendible hashing), so one insertion copies at most 1024 entries ✅[^9]. The Go team measured map operations up to 60% faster than Go 1.23 in microbenchmarks and about 1.5% less CPU (central processing unit) time (geometric mean) in full applications ✅[^9]. Go 1.24 offered `GOEXPERIMENT=noswissmap` to opt out ✅[^7]; Go 1.27.4 rejects it with `unknown GOEXPERIMENT swissmap` ✅[^1].

## Worked example
Counting words, then printing them in a stable order:

```go
counts := map[string]int{}                 // initialized, not nil
for _, w := range strings.Fields("b a b c a b") {
	counts[w]++                            // missing key reads as 0, then stores 1
}
if n, ok := counts["z"]; !ok {             // comma ok: absent, n == 0
	fmt.Println("z absent", n)
}
for _, k := range slices.Sorted(maps.Keys(counts)) {
	fmt.Print(k, "=", counts[k], " ")      // a=2 b=3 c=1
}
```

| Step | Map state | Why |
|---|---|---|
| `counts["b"]++` (first) | `{b:1}` | The read of a missing key gives 0 ✅[^2] |
| After the loop | `{a:2, b:3, c:1}`; the sorted print is `a=2 b=3 c=1` ✅[^1] | Each `++` reads, adds 1, stores |
| `counts["z"]` with comma ok | `ok == false`, `n == 0` | Presence test ✅[^2] |
| Three `range` loops over an 8-key map `{0: 0, …, 7: 7}` (a separate map, so the order is easier to see) | Observed key orders `[0 1 2 … 7]`, `[4 5 6 7 0 1 2 3]`, `[7 0 1 …]` in one run ✅[^1] | Order is unspecified ✅[^2] |
| `slices.Sorted(maps.Keys(counts))` | `[a b c]` every run | Sorting the keys fixes the order ✅[^5] |

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Write to `var m map[K]V` | `panic: assignment to entry in nil map` ✅[^1] | No table exists ✅[^2] |
| `map[[]int]string{}` | Compile error `invalid map key type []int` ✅[^1] | Slices are not comparable ✅[^2] |
| `map[any]int{}` with a `[]int` key | Run-time panic `hash of unhashable type []int` ✅[^1] | Interface keys are checked at run time ✅[^2] |
| Two `math.NaN()` ("not a number") keys | Two separate entries, and a lookup with `NaN` finds neither ✅[^1] | Floating-point `==` follows IEEE 754 (the Institute of Electrical and Electronics Engineers floating-point standard), where NaN equals nothing ✅[^2] |
| `m["p"].x = 2` | Compile error `cannot assign to struct field m["p"].x in map` ✅[^1] | Map elements are not addressable ✅[^2] |
| Delete during `range` | Allowed; deleted entries not yet reached are skipped ✅[^2] | Spec permits modification during iteration; the Swiss-table iterator was built to keep that promise ✅[^9] |
| Concurrent writes | `fatal error: concurrent map writes`, not a panic; `recover` does not stop it ✅[^1] | Run-time check for unsafe concurrent use ✅[^4] |
| Comparing two maps with `==` | Compile error `map can only be compared to nil` ✅[^1]; use `maps.Equal` ✅[^5] | Map types are not comparable, except with `nil` ✅[^2] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `map[K]bool` as a set | Reads naturally: `if set[k]` ✅[^3] | One byte per value |
| `map[K]struct{}` as a set | Zero-size values ✅[^1] | Needs comma ok to test membership |
| Map of struct values | No extra allocation per entry | Update means read, modify, write back |
| Map of pointers | `m[k].x = 1` works | One allocation per entry; shared mutable state |
| Map plus `sync.RWMutex` | Works for any access pattern ✅[^8] | Lock contention under heavy writes |
| `sync.Map` | Suits caches that are written once and read often ✅[^4] | Not a general replacement for the built-in map ✅[^4] |

## Takeaways
- Initialize maps with `make` or a literal before writing; a nil map is only safe to read. [rule-candidate]
- Use `v, ok := m[k]` whenever the zero value is also a valid stored value. [rule-candidate]
- Never depend on map iteration order, in code or in tests; sort the keys when order matters. [rule-candidate]
- Protect every map that one goroutine writes while others read or write it; a crash from `concurrent map writes` cannot be recovered. [rule-candidate]

## Verification status
- Verified: 69 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `go/lab-setup.md` — the Go 1.27.4 lab (`golang:1.27.4`) where every behaviour marked with this note ran on 2026-11-24. [^1]
- [The Go Programming Language Specification](https://go.dev/ref/spec) — Go team, living. Rank 1. Backs: Map types, Index expressions (comma ok, nil map), Deletion of map elements, Clear, For statements with range clause (map order and modification), Comparison operators, Address operators, Making maps, Composite literals. [^2]
- [Effective Go](https://go.dev/doc/effective_go) — Go team, living. Rank 1. Backs: Maps (key types, references, comma ok, sets, delete). [^3]
- [Frequently Asked Questions (FAQ)](https://go.dev/doc/faq) — Go team, living. Rank 1. Backs: "Why are map operations not defined to be atomic?": non-atomic maps, safe concurrent reads, run-time check, `sync.Map`. [^4]
- [Package maps](https://pkg.go.dev/maps) — Go team, living. Rank 1. Backs: the function list, `Keys` returns an iterator. [^5]
- [Go 1.21 Release Notes](https://go.dev/doc/go1.21) — Go team, 2023. Rank 1. Backs: `clear` built-in, new `maps` package. [^6]
- [Go 1.23 Release Notes](https://go.dev/doc/go1.23) — Go team, 2024. Rank 1. Backs: `maps` functions that work with iterators. [^10]
- [Go 1.24 Release Notes](https://go.dev/doc/go1.24) — Go team, 2025. Rank 1. Backs: Swiss-table map implementation, `GOEXPERIMENT=noswissmap`. [^7]
- [Go maps in action](https://go.dev/blog/maps) — Andrew Gerrand, Go blog, 2013. Rank 4. Backs: separate sorted keys for stable order, `sync.RWMutex` guard. [^8]
- [Faster Go maps with Swiss Tables](https://go.dev/blog/swisstable) — Michael Pratt, Go blog, 2025. Rank 4. Backs: groups of 8 slots, control word, h1/h2, 1024-entry tables, iteration during modification, benchmark numbers. [^9]

## Related
- `algorithms/data-structures/hash-tables.md` — hashing, collisions, open addressing and load factor in general.
- `floating-point/special-values-and-exceptions.md` — why NaN never equals itself.
- `go/data-types/structs-and-pointers.md` — struct keys and comparability.
- `go/concurrency/sync-and-atomics.md` — `sync.RWMutex` and `sync.Map`.
- `concurrency/shared-state-and-data-races.md` — shared maps as a race pattern across languages.
- `go/standard-library/iterators.md` — `maps.Keys`, `maps.All` and range-over-func.
- `go/learning-path.md` — where this doc sits in the learning order.
