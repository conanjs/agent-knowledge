---
schema: knowledge-doc/v1
type: concept
topic: go/data-types
status: verified
applies-to: ["Go 1.27 (go1.27.4)", "new(expr): Go ≥ 1.26", "promoted-field keys in struct literals: Go ≥ 1.27"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [go, golang, struct, pointer, composite-literal, new, zero-value, padding, alignment, struct-tags, comparable, escape-analysis]
ranked-sources: true
---

# Structs and pointers: literals, copying, new, comparison and layout

## Summary
**TL;DR:** A struct is a value made of named fields; assigning or passing it copies every field, but fields that are slices, maps or pointers still share what they point to. Build structs with keyed literals (`T{Name: "a"}`), take a pointer with `&T{…}` or `new`, and let the zero value be useful. Pointers have no arithmetic, `p.f` dereferences automatically, and returning the address of a local variable is safe because the compiler moves it to the heap. Structs are comparable (and usable as map keys) only when all their fields are. Since Go 1.26 `new(expr)` allocates an initialized variable, and since Go 1.27 a literal key may name a promoted field.
**Use this when:** you design a data type, choose between passing a value or a pointer, need a struct as a map key, wonder why a struct is bigger than its fields, or meet `new(42)` or `Point3D{name: …}` in newer code.
**Not this doc:** methods and embedding as composition → `go/methods-interfaces/methods-and-embedding.md`; struct tags in JSON (JavaScript Object Notation) → `go/standard-library/io-and-encoding-json.md`; `unsafe.Pointer` → `go/low-level/unsafe-and-cgo.md`; where variables live → `go/runtime/memory-allocation-and-gc.md`.

## Problem
Programmers bring habits from other languages: they expect assignment to share an object (it copies), fear returning `&local` (it is safe), write positional literals that break when a field is added, try `p++` on a pointer (it does not compile), put a struct with a slice field in a map key (it does not compile), and lay out fields in an order that wastes a third of the memory.

## Mental model
**Analogy:** a struct is a **printed form** with labelled boxes. Copying the struct photocopies the form: each box is copied, but a box that holds an address ("see locker 12") still points to the same locker. A pointer is a **note with the form's location**; following it lets several people fill in one form. The compiler may leave blank spaces between boxes so that each box starts at a position its size likes (alignment); reordering the boxes can remove the gaps.

**Artifact:** a field order that adds 8 bytes of padding, measured on Go 1.27.4, linux/arm64 ✅[^1]:
```go
type Loose struct { a bool; b int64; c bool } // size 24: a@0, b@8, c@16
type Tight struct { b int64; a bool; c bool } // size 16: b@0, a@8, c@9
```

## How it works
1. **Struct types.** A struct is a sequence of named fields with types; non-blank field names must be unique ✅[^2]. A field with a type but no name is an embedded field, and its fields and methods are promoted ✅[^2]. A struct may not contain itself through arrays and structs alone; containing itself through a pointer, slice or function type is fine ✅[^2].
2. **Literals.** Without keys, a struct literal lists every field in declaration order; with keys, fields may be omitted and get their zero value ✅[^2] ✅[^3]. Since Go 1.27 a key may be any valid field selector, including a promoted field of an embedded struct, as long as no embedded pointer is crossed and the embedded struct is not also set by another key ✅[^2] ✅[^5]. In a module whose `go.mod` says `go 1.26`, the compiler rejects it: `use of promoted field Object.name in struct literal of type Point3D requires go1.27 or later` ✅[^1].
3. **Anonymous structs and tags.** `struct{ Host string; Port int }{"localhost", 8080}` declares and fills a type in one expression ✅[^1]. A field may carry a string tag; tags are visible through reflection and take part in type identity, but are otherwise ignored ✅[^2]. By convention a tag is a list of `key:"value"` pairs read with `reflect.StructTag.Get` ✅[^7]; `` `json:"email,omitempty"` `` returned `email,omitempty` for the key `json` ✅[^1].
4. **Copying.** Assigning a struct copies its fields. In the lab, changing `b.Owner` after `b := a` left `a.Owner` alone, while `b.Tags[0] = "shared!"` changed `a.Tags` too, because both copies hold the same slice header ✅[^1].
5. **Pointers.** A pointer type `*T` points to variables of type `T`; its zero value is `nil` ✅[^2]. `&x` needs an addressable operand, with one exception: `&T{…}` on a composite literal, which creates a new variable each time it is evaluated ✅[^2]. For a pointer to a struct, `p.f` is shorthand for `(*p).f` ✅[^2]; reading or writing `p.f` through a nil `p` panics ✅[^2], with `invalid memory address or nil pointer dereference` ✅[^1]. Go has no pointer arithmetic, for safety and a simpler garbage collector ✅[^6]; `p++` fails with `invalid operation: p++ (non-numeric type *int)` ✅[^1].
6. **`new`.** `new(T)` allocates a zeroed variable of type `T` and returns `*T`; `new(File)` and `&File{}` are equivalent ✅[^3]. Since Go 1.26 the argument may be an expression: `new(123)` returns a `*int` to a variable holding 123, and an untyped constant takes its default type ✅[^2] ✅[^4]. The release notes show it filling optional pointer fields such as `Age *int` in one expression ✅[^4].
7. **Useful zero values.** Since `new` and `var` zero memory, design types whose zero value works without setup, as `bytes.Buffer` and `sync.Mutex` do ✅[^3].
8. **Returning `&local` is safe.** The storage of a local survives the return ✅[^3]. If the compiler cannot prove a variable is unused after the function returns, it allocates it on the garbage-collected heap ✅[^6]; `go build -gcflags=-m` reported `moved to heap: n` for `n := 0; return &n` ✅[^1].
9. **Comparison.** A struct type is comparable if all its field types are; two values are equal when their non-blank fields are, compared in source order ✅[^2]. A comparable struct works as a map key ✅[^1]. A struct with a `[]string` field fails with `struct containing []string cannot be compared` and `invalid map key type T` ✅[^1].
10. **Size and alignment.** A struct's alignment is the largest alignment of its fields ✅[^2], and `unsafe.Sizeof` of a struct includes the padding that alignment adds ✅[^9]. A struct or array with no fields of non-zero size has size zero, and two distinct zero-size variables may share an address ✅[^2]; `struct{}` and `[0]int` both measured 0 bytes ✅[^1].

## Worked example
Shrinking a slice of 1000 records by reordering fields, measured with `unsafe` on Go 1.27.4, linux/arm64 ✅[^1]:

| Step | `Loose {a bool; b int64; c bool}` | `Tight {b int64; a bool; c bool}` |
|---|---|---|
| Alignment of the struct | 8 (from `int64`) | 8 |
| Field offsets | `a`@0, `b`@8, `c`@16 | `b`@0, `a`@8, `c`@9 |
| Padding | 7 bytes after `a`, 7 after `c` | 6 bytes after `c` |
| `unsafe.Sizeof` | 24 | 16 |
| `[1000]` of them | 24000 bytes | 16000 bytes |

Reading the measurements: `int64` has alignment 8, so `b` starts at offset 8 and the 1-byte `a` before it leaves a 7-byte gap; both struct sizes are multiples of 8, and an array of 1000 is exactly 1000 times the struct size ✅[^1]. Putting the largest field first lets the two `bool` fields share one 8-byte word.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `T{1, 2}` after a third field is added to `T` | Compile error `too few values in struct literal of type T` ✅[^1] | Unkeyed literals must list every field in order ✅[^2]; prefer keys |
| `Line{Object: obj, name: "x"}` | Invalid | Keys may not overlap a field set by another key ✅[^2] |
| Value receiver or parameter | `incValue(c)` left `c.n` at 0, `incPointer(&c)` made it 1 ✅[^1] | The function got a copy |
| `p := new([]int)` vs `p := &[]int{}` | The first points to a nil slice, the second to an empty initialized slice ✅[^2] | Zero value differs from an empty literal |
| `&z1 == &z2` for two `struct{}` variables | `false` in this run ✅[^1] | Pointers to distinct zero-size variables may or may not be equal ✅[^2]; never rely on either |
| `new(nil)` | Not allowed ✅[^2] | The spec excludes `nil` as an argument to `new` |
| Struct holding a `sync.Mutex` passed by value | `go vet` reports `show passes lock by value: lab.Cache contains sync.Mutex` ✅[^1] | The call copies every field, lock included; pass such structs by pointer |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Pass struct by value | No sharing; the callee cannot change the caller's copy | Copies every field on each call |
| Pass by pointer | No copy; callee can update | Shared mutable state; nil checks |
| Keyed literals | Survive added fields; readable | Longer |
| Unkeyed literals | Short for tiny types (`Point{1, 2}`) | Break when fields change |
| Order fields by size | Less padding ✅[^1] | Order no longer follows meaning |
| `map[T]struct{}` set | Zero-size values ✅[^1] | Needs the comma-ok form to test membership |

## Takeaways
- Use keyed struct literals for any type that is not a tiny value pair. [rule-candidate]
- Make the zero value of your types ready to use, so `var x T` and `new(T)` just work. [rule-candidate]
- Pass a struct by pointer when the callee must modify it or when it contains a lock; pass small, read-only structs by value. [rule-candidate]
- Returning `&local` is safe; check `-gcflags=-m` only when allocation cost matters.
- On large slices of small structs, order fields from largest to smallest alignment to cut padding.

## Verification status
- Verified: 49 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `go/lab-setup.md` — the Go 1.27.4 lab (`golang:1.27.4`) where every behaviour marked with this note ran on 2026-11-24. [^1]
- [The Go Programming Language Specification](https://go.dev/ref/spec) — Go team, living. Rank 1. Backs: Struct types, Pointer types, Composite literals and Struct literals (Go 1.27 field-selector keys), Selectors, Address operators, Comparison operators, Allocation (`new` with a type or an expression), Size and alignment guarantees. [^2]
- [Effective Go](https://go.dev/doc/effective_go) — Go team, living. Rank 1. Backs: Allocation with new (zeroing, Go 1.26 expression form, useful zero values), Constructors and composite literals (returning the address of a local, `new(File)` equals `&File{}`). [^3]
- [Go 1.26 Release Notes](https://go.dev/doc/go1.26) — Go team, 2026. Rank 1. Backs: `new` accepts an expression; optional pointer fields example. [^4]
- [Go 1.27 Release Notes](https://go.dev/doc/go1.27) — Go team, 2026. Rank 1. Backs: struct literal keys may be any valid field selector. [^5]
- [Frequently Asked Questions (FAQ)](https://go.dev/doc/faq) — Go team, living. Rank 1. Backs: "Why is there no pointer arithmetic?" (safety, simpler garbage collector); "How do I know whether a variable is allocated on the heap or the stack?" (heap allocation when a variable may outlive its function). [^6]
- [Package reflect: StructTag](https://pkg.go.dev/reflect) — Go team, living. Rank 1. Backs: the `key:"value"` tag convention and `Get`. [^7]
- [Package unsafe](https://pkg.go.dev/unsafe) — Go team, living. Rank 1. Backs: `Sizeof` includes padding; `Alignof`, `Offsetof`. [^9]

## Related
- `go/methods-interfaces/methods-and-embedding.md` — methods on structs, pointer receivers and embedding.
- `go/data-types/maps.md` — struct keys and map values that are structs.
- `go/standard-library/io-and-encoding-json.md` — struct tags in `encoding/json`.
- `go/low-level/unsafe-and-cgo.md` — `unsafe.Pointer` and the rules that replace pointer arithmetic.
- `go/runtime/memory-allocation-and-gc.md` — escape analysis in depth.
- `software-design/oop/composition-over-inheritance.md` — composition as a design principle.
- `go/learning-path.md` — where this doc sits in the learning order.
