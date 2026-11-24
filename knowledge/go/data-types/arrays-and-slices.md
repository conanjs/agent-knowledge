---
schema: knowledge-doc/v1
type: concept
topic: go/data-types
status: verified
applies-to: ["Go 1.27 (go1.27.4)", "slices package and clear: Go ≥ 1.21", "slice-to-array conversion: Go ≥ 1.20"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [go, golang, arrays, slices, append, capacity, aliasing, copy, nil-slice, slices-package, clear]
ranked-sources: true
---

# Arrays and slices: values, headers, capacity and aliasing

## Summary
**TL;DR:** A Go **array** is a fixed-size value: assigning or passing it copies every element. A **slice** is a small header (pointer, length, capacity) that looks into an array; copying a slice copies only the header, so both copies see the same elements. `append` writes into the existing array while capacity lasts and moves to a new, larger array when it runs out, which is why you must always use its result and why two slices built from one base can overwrite each other.
**Use this when:** a slice changes "by itself", `append` results look shared, you choose between an array and a slice, you need to preallocate, or you want to know what the `slices` package and `clear` do.
**Not this doc:** strings and `[]byte` → `go/data-types/strings-bytes-and-runes.md`; iterating with `range` and iterator functions → `go/standard-library/iterators.md`; where the backing array lives (stack or heap) → `go/runtime/memory-allocation-and-gc.md`.

## Problem
Code that treats a slice like a list object in other languages goes wrong in quiet ways: a function appends to a slice and the caller does not see the new element; two results of `append` on the same base end up equal; a tiny sub-slice keeps a huge buffer alive; `slices.Delete` leaves zeros behind in the original array. Each follows from the header-plus-array design.

## Mental model
**Analogy:** an array is a shelf with a fixed number of boxes. A slice is a **window frame** held up to that shelf: the frame records where it starts (pointer), how many boxes you can see (length) and how many boxes remain on the shelf from the start of the frame (capacity). Copying a slice copies the frame, not the boxes. `append` puts the next item in the first box past the frame if the shelf has room; if not, it builds a bigger shelf, moves the items, and hands you a frame on the new shelf.

**Artifact:** the runtime's own slice header in `runtime/slice.go` (Go 1.27.4) ✅[^4]:
```go
type slice struct {
	array unsafe.Pointer // first element the slice can see
	len   int            // elements visible now
	cap   int            // elements available from array to the end of the backing array
}
```
On 64-bit Linux, `unsafe.Sizeof` of any `[]int` is 24 bytes, the size of these three words, whatever the slice holds ✅[^1] ✅[^6].

## How it works
1. **Arrays are values.** The length is part of the type, so `[3]int` and `[4]int` are different types ✅[^2]. Assigning an array copies all elements, and a function that takes an array receives a copy ✅[^3]. Arrays are comparable when their element type is ✅[^2].
2. **A slice describes a segment of an array.** It has a length and a capacity; capacity is the length plus the part of the array beyond the slice ✅[^2]. The zero value is `nil`, and `len`/`cap` of a nil slice are 0 ✅[^2]. Slices are not comparable, except with `nil` ✅[^2].
3. **`make` allocates a hidden array.** `make([]int, 50, 100)` gives the same slice as `new([100]int)[0:50]`; leaving out the capacity sets it to the length ✅[^2].
4. **Slicing shares storage.** `a[low:high]` has length `high-low` and shares the operand's array; for a slice operand, `high` may go up to the capacity, not just the length ✅[^2]. The full form `a[low:high:max]` also sets the capacity to `max-low` ✅[^2].
5. **`append` reuses or reallocates.** If the capacity is large enough, `append` writes into the existing array; otherwise it allocates a new, large enough array ✅[^2]. The header is passed by value, so the caller must take the returned slice: `s = append(s, x)` ✅[^3]. `append(b, str...)` appends the bytes of a string to a `[]byte` ✅[^2].
6. **Growth rule (runtime, not language).** `nextslicecap` in Go 1.27.4 returns the needed length when it exceeds double the old capacity; below a threshold of 256 elements it doubles; above it, it adds `(newcap + 3*256) / 4` repeatedly, a smooth move from 2× growth to about 1.25× ✅[^4]. The result is then rounded up to a memory-allocator size class (`roundupsize`) ✅[^4]. Measured `[]int` capacities after each reallocation: 256 → 512 → 848 → 1280 → 1792 → 2560 ✅[^1]. For a `[]byte` that escapes to the heap, the first one-element `append` gave capacity 8 (the smallest size class); one that never leaves its function got 32, and 8 again once `-gcflags=all=-d=variablemakehash=n` turned off the compiler's newer stack allocations (see Edge cases) ✅[^1].
7. **`copy` copies the overlap.** It copies `min(len(dst), len(src))` elements, returns that count, and works when the two ranges overlap ✅[^2].
8. **`clear` and the `slices` package (Go 1.21).** `clear(s)` sets every element up to `len(s)` to the zero value; the length does not change ✅[^2] ✅[^7]. The `slices` package adds generic helpers for any element type ✅[^7]: `Sort`, `Contains`, `Index`, `Insert`, `Delete`, `Compact`, `Clone` (a shallow copy), `Clip` (returns `s[:len(s):len(s)]`) and `Grow` (room for `n` more elements without another allocation) ✅[^5].
9. **Slices of slices.** Inner slices may have different lengths and must each be initialized ✅[^2]. Allocate rows one by one when they may grow, or carve all rows from one big slice when they will not ✅[^3].
10. **Slice to array (Go 1.20) or array pointer (Go 1.17).** `[N]T(s)` copies the first `N` elements into a new array; `(*[N]T)(s)` gives a pointer into the same array; both panic if `len(s) < N` ✅[^2].

## Worked example
A helper adds a path part to a shared prefix. The prefix has spare capacity, so both calls write into the same array slot.

```go
func withSuffix(prefix []string, s string) []string { return append(prefix, s) }

base := make([]string, 0, 4)
base = append(base, "GET", "/users")        // len 2, cap 4
a := withSuffix(base, "v1")                  // writes slot 2
b := withSuffix(base, "v2")                  // overwrites slot 2
fmt.Println(a, b)                            // [GET /users v2] [GET /users v2]

fixed := base[:len(base):len(base)]          // cap 2: append must reallocate
fmt.Println(withSuffix(fixed, "v1"), withSuffix(fixed, "v2"))
// [GET /users v1] [GET /users v2]
```

| Step | Header of the slice passed in | What `append` does | Result |
|---|---|---|---|
| 1 | `base`: len 2, cap 4 | Room for slot 2: writes `"v1"` there | `a` sees slot 2 = `"v1"` |
| 2 | `base`: len 2, cap 4 (unchanged) | Writes `"v2"` into the same slot 2 | `a` and `b` both print `v2` ✅[^1] |
| 3 | `fixed`: len 2, cap 2 | No room: allocates a new array each call | Independent results ✅[^1] ✅[^2] |
| 4 | `slices.Clone(base)` | A fresh copy per call | Independent results ✅[^1] ✅[^5] |

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `s[5]` on a slice of length 3 | Panic: `index out of range [5] with length 3` ✅[^1] | Out-of-range indexes panic at run time ✅[^2] |
| `p := arr[1:3]; p = append(p, 99)` | `arr[3]` becomes 99 ✅[^1] | `p` had capacity 4, so `append` wrote into `arr` |
| `q := arr[1:3:3]; q = append(q, 77)` | `arr` is untouched ✅[^1] | Capacity 2: `append` had to copy ✅[^2] |
| A small slice of a large buffer is kept | The whole buffer stays in memory ✅[^8] | The garbage collector cannot free an array a slice still points to ✅[^8]; copy the bytes you keep |
| `slices.Delete(d, 1, 3)` | `d` shrinks; the freed tail of the original array is zeroed: `[0 3 4 0 0]` ✅[^1] | `Delete` zeroes `s[len(s)-(j-i):len(s)]` ✅[^5] |
| `var s []int` vs `s := []int{}` | Both have len 0 and append the same; only the first is `== nil`; `%#v` prints `[]int(nil)` vs `[]int{}` ✅[^1] | A slice literal is initialized, the zero value is not ✅[^2] |
| `range` over a nil slice | Zero iterations ✅[^2] | Length is 0 |
| Function appends to its slice parameter | The caller's slice keeps its old length ✅[^3] | The header was passed by value; return the new slice |
| `[4]byte(s)` with `len(s) == 2` | Run-time panic ✅[^2] | The array is longer than the slice |
| Appending in a loop to a slice that never leaves the function | Observed `[]int` capacities 4, 8, 16 (and 32 for a `[]byte`) instead of 1, 2, 4, 8, 16; with `-gcflags=all=-d=variablemakehash=n` the classic 1, 2, 4, 8, 16 returns, after many lines of `variablemake` bisect output ✅[^1] | Go 1.25 and 1.26 let the compiler put slice backing arrays on the stack in more cases ✅[^9] ✅[^10]; exact capacities are an implementation detail |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Array `[N]T` | Fixed layout, comparable, no header, may avoid an allocation ✅[^3] | Size fixed at compile time; copied on every assignment |
| Pointer to array `*[N]T` | No copy when passed | Not idiomatic; slices do the same job ✅[^3] |
| Slice `[]T` with `append` | Grows on demand | Reallocation and copying; aliasing between slices of one array |
| `make([]T, 0, n)` or `slices.Grow` | One allocation when `n` is known | Wasted space if `n` is overestimated |
| Full slice expression `s[:n:n]` | Forces the next `append` to copy, no extra allocation now | Easy to forget; readers must know the 3-index form |
| `slices.Clone` | Clear intent, independent copy | Always allocates |

## Takeaways
- Always assign the result of `append` back (`s = append(s, x)`); never rely on the argument changing. [rule-candidate]
- Before appending to a slice you did not create, cap it (`s[:len(s):len(s)]`) or clone it, so you cannot overwrite the owner's data. [rule-candidate]
- When you keep a small part of a big buffer, copy it out (`slices.Clone` or `append([]T(nil), part...)`). [rule-candidate]
- Test for emptiness with `len(s) == 0`, not `s == nil`; nil and empty slices behave the same for `len`, `range` and `append`.
- Do not write tests that depend on exact capacities: they come from the runtime and compiler, and changed in recent releases.

## Verification status
- Verified: 51 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `go/lab-setup.md` — the Go 1.27.4 lab (`golang:1.27.4`) where every behaviour marked with this note ran on 2026-11-24. [^1]
- [The Go Programming Language Specification](https://go.dev/ref/spec) — Go team, living. Rank 1. Backs: Array types, Slice types, Comparison operators, Slice expressions (simple and full), Appending to and copying slices, Clear, Making slices, Index expressions, Conversions from slice to array, For statements with range clause. [^2]
- [Effective Go](https://go.dev/doc/effective_go) — Go team, living. Rank 1. Backs: Arrays (values, pointer to array not idiomatic), Slices (header passed by value, return the slice), Two-dimensional slices, Append. [^3]
- [runtime/slice.go (go1.27.4)](https://github.com/golang/go/blob/go1.27.4/src/runtime/slice.go) — Go team, 2026. Rank 1. Backs: the `slice` struct, `nextslicecap` growth rule, `roundupsize` rounding. [^4]
- [Package slices](https://pkg.go.dev/slices) — Go team, living. Rank 1. Backs: `Delete` zeroing, `Clone`, `Clip`, `Grow`, `Compact`, `Insert`. [^5]
- [Package unsafe](https://pkg.go.dev/unsafe) — Go team, living. Rank 1. Backs: `Sizeof` of a slice is the size of the descriptor only. [^6]
- [Go 1.21 Release Notes](https://go.dev/doc/go1.21) — Go team, 2023. Rank 1. Backs: new `clear` built-in and `slices` package. [^7]
- [Go 1.25 Release Notes](https://go.dev/doc/go1.25) — Go team, 2025. Rank 1. Backs: slice backing stores on the stack in more situations; `-d=variablemakehash=n`. [^9]
- [Go 1.26 Release Notes](https://go.dev/doc/go1.26) — Go team, 2026. Rank 1. Backs: further stack allocation of slice backing stores. [^10]
- [Go Slices: usage and internals](https://go.dev/blog/slices-intro) — Andrew Gerrand, Go blog, 2011. Rank 4. Backs: nil slice acts like a zero-length slice for `append`; the sub-slice retention gotcha. [^8]

## Related
- `go/data-types/maps.md` — the other built-in reference-like type.
- `go/data-types/strings-bytes-and-runes.md` — `[]byte`, strings and conversions.
- `go/standard-library/iterators.md` — `slices.All`, `slices.Values`, `slices.Sorted` and range-over-func.
- `go/runtime/memory-allocation-and-gc.md` — escape analysis and why a backing array may live on the stack.
- `algorithms/fundamentals/amortized-analysis.md` — why doubling makes `append` cheap on average.
- `go/learning-path.md` — where this doc sits in the learning order.
