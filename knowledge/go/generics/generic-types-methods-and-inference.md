---
schema: knowledge-doc/v1
type: concept
topic: go/generics
status: verified
applies-to: ["Go 1.27 (go1.27.4)", "generic type aliases since Go 1.24", "self-referential constraints since Go 1.26", "generic methods since Go 1.27"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [go, golang, generics, generic-types, generic-methods, type-inference, generic-alias, instantiation, go1.27]
ranked-sources: true
---

# Generic types, generic methods and type inference

## Summary
**TL;DR:** A generic type such as `Stack[T any]` must always be instantiated with explicit type arguments (`Stack[int]`), and its methods re-declare the receiver's type parameters (`func (s *Stack[T]) Push(v T)`). Since Go 1.27 a method may also declare its *own* type parameters (`func (s *Stack[T]) MapTo[U any](…)`), but interface methods may not, and a generic method never satisfies an interface method. For functions, type arguments are usually *inferred*: the compiler solves type equations built from the arguments, the assignment target and the constraints. Go 1.21 made inference stronger, Go 1.24 added generic type aliases and Go 1.26 allowed a constraint to refer to the type it constrains.
**Use this when:** writing a generic container or its methods, seeing "cannot use generic type … without instantiation", "generic method requires go1.27", "interface method must have no type parameters" or an inference error, or moving a generic type between packages with an alias.
**Not this doc:** type parameters on functions, constraints and type sets → `go/generics/type-parameters-and-constraints.md`; methods and method sets in general → `go/methods-interfaces/methods-and-embedding.md`.

## Problem
Generic code compiles in one place and not in a similar one. `Stack{}` is rejected though `Map(xs, f)` needs no brackets. Before Go 1.27 a "map to another type" operation on a container had to be a package-level function, because methods could not have type parameters; in Go 1.27 the method compiles, yet the same type still fails to implement an interface with a matching-looking method. A module with `go 1.26` in `go.mod` gets errors for code that compiles in a `go 1.27` module, with the same compiler. Knowing which rules apply to types, to methods and to inference explains all of these.

## Mental model
**Analogy:** a generic type is a mould with a blank label; you cannot sell the mould, only castings with the label filled in (`Stack[int]`). Inference is a crossword: each argument, the variable being assigned and each constraint is a clue, and the compiler fills the blanks (`T = int`) that make every clue true. A generic method is a mould attached to a casting: the casting's label is fixed, the method's own label is filled per call.

**Artifact:** a generic stack with a Go 1.27 generic method, run in Go 1.27.4 ✅[^1]:
```go
type Stack[T any] struct{ items []T }

func (s *Stack[T]) Push(v T) { s.items = append(s.items, v) }

// Go 1.27: the method declares its own type parameter U.
func (s *Stack[T]) MapTo[U any](f func(T) U) *Stack[U] {
	out := &Stack[U]{}
	for _, v := range s.items {
		out.Push(f(v))
	}
	return out
}

var s Stack[int]
s.Push(1)
s.Push(2)
strs := s.MapTo(func(i int) string { return "#" + strconv.Itoa(i) }) // U inferred as string
fmt.Printf("%v %T\n", strs.items, strs) // [#1 #2] *main.Stack[string]
```

## How it works
1. **Generic types.** A type definition with type parameters declares a generic type, which must be instantiated wherever it is used; the given type cannot itself be a type parameter ✅[^2]. Unlike functions, a generic type always needs all its type arguments written out ✅[^2].
2. **Methods on generic types.** The receiver must declare as many type parameters as the type definition has; the names need not match the definition's, and the constraints are implied by it ✅[^2]. Syntactically the receiver looks like an instantiation, for example `func (p Pair[A, B]) Swap() Pair[B, A]` ✅[^2].
3. **Generic methods (Go 1.27).** A method declaration may now list type parameters after the method name, in addition to those of the receiver, which makes it a generic method ✅[^2] ✅[^6]. Like a generic function, it must be instantiated before it is called or used as a value ✅[^2]; in a call the type arguments can be inferred ✅[^1]. Interface methods may not declare type parameters, and interface methods cannot be implemented by generic methods ✅[^6] ✅[^2]. The standard library uses the feature in Go 1.27: `math/rand/v2` gained a generic method `(*Rand) N` next to its generic function `N` ✅[^6].
4. **The `go` line gates new syntax.** In a module whose `go.mod` says `go 1.26`, the Go 1.27.4 compiler rejects a generic method with `generic method requires go1.27 or later (-lang was set to go1.26; check go.mod)` ✅[^1].
5. **Generic type aliases (Go 1.24).** An alias declaration may have type parameters; the name then denotes a generic alias, which must be instantiated when used ✅[^2] ✅[^4]. Because it is an alias, `Set[int]` and the aliased type are identical types, which a defined type would not give ✅[^7]. The alias's constraints need only satisfy the aliased type's constraints, not match them ✅[^7]. The motivation is incremental refactoring: moving a generic type to another package while old import paths keep working ✅[^7].
6. **Self-referential constraints (Go 1.26).** A generic type may now refer to itself in its own type parameter list, so a constraint can say "a type like me": `type Adder[A Adder[A]] interface { Add(A) A }` ✅[^5].
7. **When type arguments may be omitted.** For a generic function or method, the type argument list may be left out when it can be inferred and the function is called with ordinary arguments, assigned to a variable with a known type, passed as an argument to another function, or returned as a result ✅[^2]. A partial list is a prefix: arguments may be omitted from right to left, but the list cannot be empty ✅[^2].
8. **How inference works.** Each explicit type argument, each ordinary argument (it must be assignable to its parameter) and each constraint contributes a type equation; inference solves the system for the missing type parameters ✅[^8] ✅[^2]. Inference ignores the direction of assignment, and it succeeds only if every missing type argument is found and the instantiation then satisfies the constraints ✅[^2].
9. **Go 1.21 improvements.** A generic function may be passed, not fully instantiated, as an argument to another generic function; a generic function assigned to a variable or returned may omit its type arguments when the target fixes them; methods are matched when a value is assigned to an interface; and mixed untyped constants such as `1` and `2.5` are resolved like a constant expression instead of failing ✅[^3]. Typed arguments take precedence over untyped constants for inference ✅[^8].
10. **Go 1.27 generalization.** Function type inference now applies in every context where a generic function is assigned to, or converted to, a matching function type ✅[^6].

## Worked example
Every rule above, from one set of Go 1.27.4 runs ✅[^1]:

| Code | Result | Rule |
|---|---|---|
| `var s Stack` | Compile error `cannot use generic type Stack[T any] without instantiation` | Generic types need explicit type arguments ✅[^2] |
| `f := l.Apply` where `Apply` is a generic method of `List[E]` | Compile error `cannot use generic function l.Apply without instantiation` | A generic method used as a value must be instantiated ✅[^2] |
| `apply := l.Apply[string]; apply(strconv.Itoa)` on `List[int]{1, 2, 3}` | `["1" "2" "3"]` | Explicit instantiation of a generic method ✅[^2] |
| `type Getter interface{ Get() int }` and `var g Getter = Box[int]{}` where `Box` has `func (b Box[T]) Get[U any]() U` | Compile error `Box[int] does not implement Getter (wrong type for method Get)`, `have Get[U any]() U`, `want Get() int` | Generic methods do not implement interface methods ✅[^6] |
| `type Mapper interface { Map[U any](func(int) U) []U }` | Compile error `interface method must have no type parameters` | ✅[^2] |
| `type Set[K comparable] = map[K]struct{}`; `seen := Set[string]{"go": {}}` | `%T` prints `map[string]struct {}` | A generic alias denotes the aliased type itself ✅[^7] |
| `type Money int` with `Add(Money) Money`, and `func SumAll[A Adder[A]](xs ...A) A` | `SumAll(Money(3), Money(4))` prints `7` | Self-referential constraint, Go 1.26 ✅[^5] |
| `v := Pick(1, 2.5)` with `func Pick[T any](a, b T) T` | `2.5 float64` | Untyped int and float constants resolve to `float64` (Go 1.21 rule) ✅[^3] |
| `Convert[string](42, strconv.Itoa)` with `func Convert[To, From any](v From, f func(From) To) To` | `"42"` | Partial list: `To` given, `From` inferred ✅[^2] |
| `var f func(int) int = Identity`; `g := (func(string) string)(Identity)` | `f(7)` is `7`, `g("x")` is `x` | Inferred from the variable's type and from the conversion ✅[^6] |

## Edge cases
| Case | What happens | Why |
|---|---|---|
| A generic method in a module with `go 1.26` | Compile error `generic method requires go1.27 or later` ✅[^1] | The module's `go` line sets the language version, as the message itself says (`-lang was set to go1.26; check go.mod`) ✅[^1] |
| Assigning or converting a generic function to a function type in a module with `go 1.26` | Compiled and ran in Go 1.27.4, both for `var f func(int) int = Identity`, a conversion, a struct field, a slice element, a map value and a channel send ✅[^1] | The lab cannot show what older compilers rejected, because it has no Go 1.26 toolchain; only the Go 1.27 release note describes the change ✅[^6] |
| `x := sum` for a generic `sum` with nothing to infer from | Illegal: the type of `x` is unknown ✅[^2] | No equation fixes the type arguments |
| `apply[]` (empty type argument list) | Illegal ✅[^2] | A partial list must contain at least the first argument |
| A receiver that is a generic alias, or an alias of an instantiated generic type | Illegal ✅[^2] | Receiver base types must be denoted directly |
| A generic alias whose right-hand side is its own type parameter, `type A[P any] = P` | Illegal ✅[^2] | The aliased type cannot be a type parameter of the same declaration |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Generic method (Go 1.27) | Operations such as `MapTo` live in the type's namespace ✅[^6] | Cannot satisfy interface methods; needs `go 1.27` in `go.mod` ✅[^6] ✅[^1] |
| Package-level generic function | No `go 1.27` requirement; usable as a function value after instantiation ✅[^2] | Lives outside the type's method set |
| Generic alias | Callers of the old name keep compiling during a move ✅[^7] | Two names for one type while the migration lasts |
| Generic defined type | A distinct type that can have its own methods ✅[^2] | Not identical to the type it is built from ✅[^7] |

## Takeaways
- Use a generic method only for helpers callers invoke directly; anything an interface must describe still needs a non-generic method. [rule-candidate]
- Set the `go` line in `go.mod` to the oldest Go version you must support, and expect newer syntax such as generic methods to fail below it. [rule-candidate]
- Let inference work: write type arguments only when the compiler asks, or to make an unusual choice (such as `Sum[float64](nil)`) explicit.
- Move a generic type between packages with a generic alias at the old location, then migrate callers gradually.

## Verification status
- Verified: 53 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `go/lab-setup.md` — the Go 1.27.4 lab (`golang:1.27.4`) where every behaviour marked with this note ran on 2026-11-24. [^1]
- [The Go Programming Language Specification](https://go.dev/ref/spec) — Go team, living. Rank 1. Backs: §Type definitions (generic types), §Method declarations (receiver type parameters, generic methods), §Basic interfaces (no type parameters on interface methods), §Alias declarations, §Instantiations, §Type inference. [^2]
- [Go 1.21 Release Notes](https://go.dev/doc/go1.21) — Go team, 2023. Rank 1. Backs: the type inference improvements. [^3]
- [Go 1.24 Release Notes](https://go.dev/doc/go1.24) — Go team, 2025. Rank 1. Backs: generic type aliases. [^4]
- [Go 1.26 Release Notes](https://go.dev/doc/go1.26) — Go team, 2026. Rank 1. Backs: a generic type may refer to itself in its type parameter list. [^5]
- [Go 1.27 Release Notes](https://go.dev/doc/go1.27) — Go team, 2026. Rank 1. Backs: generic methods and their limits, `(*Rand) N`, generalized function type inference. [^6]
- [What's in an (Alias) Name?](https://go.dev/blog/alias-names) — Go team, 2024. Rank 4. Backs: why generic aliases, identity, constraints only need to satisfy. [^7]
- [Everything You Always Wanted to Know About Type Inference - And a Little Bit More](https://go.dev/blog/type-inference) — Go team, 2023. Rank 4. Backs: type equations and their sources; typed arguments before untyped constants. [^8]

## Related
- `go/generics/type-parameters-and-constraints.md` — constraints, type sets, `comparable`, when to use generics.
- `go/methods-interfaces/methods-and-embedding.md` — receivers and method sets.
- `go/methods-interfaces/interfaces.md` — why a generic method cannot stand in for an interface method.
- `go/introduction/toolchain-and-compatibility.md` — the `go` line and language versions.
- `go/learning-path.md`
