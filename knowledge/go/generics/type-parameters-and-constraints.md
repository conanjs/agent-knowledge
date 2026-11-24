---
schema: knowledge-doc/v1
type: concept
topic: go/generics
status: verified
applies-to: ["Go 1.27 (go1.27.4)", "generics since Go 1.18", "comparable satisfied by interfaces since Go 1.20", "core types removed from the spec in Go 1.25"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [go, golang, generics, type-parameters, constraints, type-sets, comparable, cmp-ordered, underlying-type, core-types]
ranked-sources: true
---

# Type parameters, constraints and type sets

## Summary
**TL;DR:** A generic function declares type parameters in square brackets, `func Sum[T Number](xs []T) T`, and each type parameter has a *constraint*, which is an interface. Since Go 1.18 an interface defines a *type set*, and besides methods it may list types, unions (`int | string`) and underlying-type terms (`~int`, meaning "any type whose underlying type is `int`"). Inside the function you may only use operations that every type in the set supports, so `a > b` needs `cmp.Ordered`, not `any`. `comparable` allows `==`; since Go 1.20 interface types satisfy it too, which means a comparison can still panic at run time.
**Use this when:** writing or reading a generic function, choosing or writing a constraint, decoding an error such as "type parameter T cannot use operator >" or "cannot use type … outside a type constraint", or deciding whether generics, an interface or plain code fits.
**Not this doc:** generic types, methods on them, Go 1.27 generic methods, aliases and the full inference rules → `go/generics/generic-types-methods-and-inference.md`; ordinary interfaces as values → `go/methods-interfaces/interfaces.md`.

## Problem
Before Go 1.18, a function that summed a slice had to be written once per element type, or take `interface{}` and give up compile-time checking. With generics the naïve version still fails: `func Max[T any](a, b T) T { if a > b … }` does not compile, a constraint such as `interface{ ~int | ~float64 }` cannot be used as a variable's type, and a function constrained by `comparable` can still panic. Each of these follows from what a type set is.

## Mental model
**Analogy:** a constraint is a job posting that lists who may apply ("anyone whose underlying type is `int` or `float64`"). The function body may only ask an applicant to do what *every* allowed applicant can do: if one allowed type cannot use `>`, the body may not use `>`. A type argument is the person hired for one call.

**Artifact:** a constraint with a union of underlying-type terms, run in Go 1.27.4 ✅[^1]:
```go
// The type set of Number: every type whose underlying type is int or float64.
type Number interface {
	~int | ~float64
}

func Sum[T Number](xs []T) T {
	var total T // the zero value of T
	for _, x := range xs {
		total += x // allowed: + works for every type in the set
	}
	return total
}

type Celsius float64

fmt.Println(Sum([]int{1, 2, 3}))       // 6     (T inferred as int)
fmt.Println(Sum([]Celsius{20.5, 1.5})) // 22    (~float64 admits Celsius)
fmt.Println(Sum[float64](nil))         // 0     (explicit type argument)
```

## How it works
1. **What generics added.** Go 1.18 introduced generics ✅[^3], with three additions: type parameters for functions and types, interfaces that define sets of types (including types without methods), and type inference, which lets most calls omit the type arguments ✅[^7].
2. **Type parameter lists.** A type parameter list is written in square brackets like an ordinary parameter list, but every name must be present; each type parameter is a new named type that stands for a type not known yet, and it is replaced by a type argument when the function is instantiated ✅[^2]. Each type parameter has a constraint, its "meta-type" ✅[^2].
3. **A constraint is an interface.** It defines the permissible type arguments and controls the operations allowed on values of that type parameter ✅[^2]. When the constraint is only a type element, the surrounding `interface{ }` may be dropped: `[T ~int]` means `[T interface{ ~int }]` ✅[^2].
4. **Type sets.** The type set of an interface is the intersection of its elements' type sets: a method element gives all types that have that method; a type term `T` gives just `T`; `~T` gives every type whose underlying type is `T`; a union `t1 | t2` gives the union of the sets; the empty interface gives all non-interface types ✅[^2]. In `~T`, `T` must be its own underlying type and not an interface; non-interface terms of a union must not overlap ✅[^2].
5. **Operations in the body.** An operation on a value of type parameter type is permitted only if it is permitted for all types in the constraint's type set ✅[^7]. With `T any`, `a > b` fails with "type parameter T cannot use operator >" ✅[^1]; `cmp.Ordered` permits any type that supports `<`, `<=`, `>=`, `>` ✅[^6].
6. **Constraint-only interfaces.** An interface that is not basic (it has type elements) may only be used as a constraint or inside other constraints, never as the type of a value, variable or field ✅[^2]; `var n Number` fails with "cannot use type Number outside a type constraint" ✅[^1]. A union with more than one term cannot contain `comparable` or interfaces with methods ✅[^2].
7. **`comparable`.** The predeclared `comparable` is the set of all strictly comparable non-interface types; ordinary interface types are comparable but not strictly, so they do not *implement* `comparable` ✅[^2]. Since Go 1.20 they still *satisfy* it as a type argument, which is why comparisons inside such a function may panic at run time ✅[^2] ✅[^4].
8. **Satisfying a constraint.** A type argument satisfies a constraint when it is in the constraint's type set, with the `comparable` exception above ✅[^2]. Instantiation substitutes the type arguments, checks each against its constraint, and yields an ordinary non-generic function ✅[^2].
9. **Core types are gone from the spec (Go 1.25).** Go 1.18 had added the notion of a *core type* (roughly, the single underlying type shared by a type set) to state rules for generic operands ✅[^9]. Go 1.25 removed that notion from the specification in favour of specific prose per operation; no behaviour changed, and compiler messages no longer mention "core type" ✅[^5] ✅[^9].
10. **When to use type parameters.** Write functions first and add type parameters when it becomes clear they help ✅[^8]. They fit functions on the built-in containers (slices, maps, channels) that make no assumption about the element type, and general-purpose data structures such as lists and trees ✅[^8]. Do not replace an interface with a type parameter when all you do is call a method on the value, as with `io.Reader`; do not use them when each type needs a different implementation; and consider reflection when the operation differs per type and the types have no methods ✅[^8]. The short form: reach for a type parameter when you are about to write the exact same code a second time with only the types changed ✅[^8].

## Worked example
Three generic functions and their calls, all from one Go 1.27.4 run ✅[^1]:
```go
func Map[T, U any](xs []T, f func(T) U) []U {
	out := make([]U, 0, len(xs))
	for _, x := range xs {
		out = append(out, f(x))
	}
	return out
}

func Index[T comparable](xs []T, v T) int {
	for i, x := range xs {
		if x == v {
			return i
		}
	}
	return -1
}

// Scale keeps the caller's named slice type.
func Scale[S ~[]E, E Number](s S, c E) S {
	r := make(S, len(s))
	for i, v := range s {
		r[i] = v * c
	}
	return r
}

type Point []int

func (p Point) String() string { return fmt.Sprintf("Point%v", []int(p)) }
```
| Call | Result | What it shows |
|---|---|---|
| `Map([]int{1, 2}, func(i int) string { return fmt.Sprint(i * 10) })` | `[10 20]` | Both `T` and `U` inferred from the arguments ✅[^1] |
| `Index([]string{"a", "b"}, "b")` | `1` | `string` is strictly comparable ✅[^1] ✅[^2] |
| `p := Scale(Point{1, 2}, 3)` | `Point[3 6]`, `%T` is `main.Point` | `S` is inferred as `Point`, not `[]int`, so the result keeps its methods ✅[^1] |
| `Zero[string](), Zero[*int](), Zero[[]int]() == nil` with `func Zero[T any]() T { var z T; return z }` | `"" <nil> true` | `var z T` is the zero value of whatever `T` is ✅[^1] |
| `Index([]any{1, "x"}, any("x"))` | `1` | `any` satisfies `comparable` (Go 1.20 rule) ✅[^1] ✅[^4] |
| `Index([]any{[]int{1}}, any([]int{1}))` | Panic `runtime error: comparing uncomparable type []int` | The exception lets comparisons panic ✅[^1] ✅[^2] |
| `Max("apple", "banana")`, `Max(3, 7)` with `func Max[T cmp.Ordered](a, b T) T` | `banana`, `7` | `cmp.Ordered` allows `>` ✅[^1] ✅[^6] |

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `[T any]` and `a > b` in the body | Compile error `type parameter T cannot use operator >` ✅[^1] | Not every type in the set of `any` supports `>` ✅[^7] |
| `var n Number` where `Number` is `~int \| ~float64` | Compile error `cannot use type Number outside a type constraint: interface contains type constraints` ✅[^1] | Non-basic interfaces are constraints only ✅[^2] |
| `~MyInt` where `type MyInt int` | Illegal | The `T` in `~T` must be its own underlying type ✅[^2] |
| `~int \| MyInt` in one union | Illegal | The two terms' type sets overlap ✅[^2] |
| `interface{ int; string }` | An empty type set: nothing can satisfy it | Intersection of two disjoint sets ✅[^2] |
| `[]byte` as a type argument for `comparable` | Not satisfied | Slices are not comparable ✅[^2] |
| A one-type constraint such as `[P *C]` in a generic *type* declaration | May parse as an array length expression | Write `[P interface{ *C }]` or add a trailing comma `[P *C,]` ✅[^2] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Type parameter with a constraint | Compile-time type checking; one copy of the code for many types ✅[^8] | More syntax; constraints to design |
| Interface parameter (`io.Reader`) | Simple; fits when you only call methods ✅[^8] | Getting the concrete type back needs a type assertion, which is checked only at run time ✅[^2] |
| `comparable` constraint | `==` and map keys inside generic code ✅[^2] | Interface type arguments can still panic on comparison ✅[^2] |
| Copy-paste per type | No generics to learn | The same code maintained N times; the blog's own trigger for generics ✅[^8] |

## Takeaways
- Use the narrowest constraint the body needs (`any`, `comparable`, `cmp.Ordered`, or a union with `~`), and prefer `~T` terms so named types such as `Celsius` are accepted. [rule-candidate]
- If a generic function only calls methods on its argument, take an interface parameter instead of a type parameter. [rule-candidate]
- Treat `comparable` with interface type arguments as able to panic, just like `==` on `any` values.
- Add type parameters when the second identical copy of a function appears, not before.

## Verification status
- Verified: 54 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `go/lab-setup.md` — the Go 1.27.4 lab (`golang:1.27.4`) where every behaviour marked with this note ran on 2026-11-24. [^1]
- [The Go Programming Language Specification](https://go.dev/ref/spec) — Go team, living. Rank 1. Backs: §Type parameter declarations, §Type constraints, §Satisfying a type constraint, §General interfaces (type sets, `~T`, unions, constraint-only interfaces), §Instantiations, §Type assertions. [^2]
- [Go 1.18 Release Notes](https://go.dev/doc/go1.18) — Go team, 2022. Rank 1. Backs: generics introduced in Go 1.18. [^3]
- [Go 1.20 Release Notes](https://go.dev/doc/go1.20) — Go team, 2023. Rank 1. Backs: comparable types such as interfaces satisfy `comparable`. [^4]
- [Go 1.25 Release Notes](https://go.dev/doc/go1.25) — Go team, 2025. Rank 1. Backs: core types removed from the spec, no language change. [^5]
- [Package cmp](https://pkg.go.dev/cmp) — Go team, living. Rank 1. Backs: `cmp.Ordered`. [^6]
- [An Introduction To Generics](https://go.dev/blog/intro-generics) — Go team, 2022. Rank 4. Backs: the three additions; operations permitted by all types in the type set. [^7]
- [When To Use Generics](https://go.dev/blog/when-generics) — Go team, 2022. Rank 4. Backs: when type parameters help and when not. [^8]
- [Goodbye core types - Hello Go as we know and love it!](https://go.dev/blog/coretypes) — Go team, 2025. Rank 4. Backs: what core types were and why they were removed. [^9]

## Related
- `go/generics/generic-types-methods-and-inference.md` — generic types, methods, Go 1.27 generic methods, aliases, inference.
- `go/methods-interfaces/interfaces.md` — interfaces as values, and comparison panics.
- `go/data-types/arrays-and-slices.md` — the slices that most generic helpers operate on.
- `go/standard-library/iterators.md` — generic iterator types `iter.Seq` and `iter.Seq2`.
- `go/learning-path.md`
