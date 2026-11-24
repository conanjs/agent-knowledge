---
schema: knowledge-doc/v1
type: concept
topic: go/methods-interfaces
status: verified
applies-to: ["Go 1.27 (go1.27.4)"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [go, golang, interfaces, type-assertion, type-switch, any, nil-interface, typed-nil, iface, eface, itab]
ranked-sources: true
---

# Interfaces, type assertions and the nil-interface trap

## Summary
**TL;DR:** A Go interface is a set of method requirements; any type whose method set covers them implements it, with no `implements` declaration. An interface *value* is a pair (dynamic type, dynamic value), and it equals `nil` only when both are unset, so returning a nil `*MyErr` as an `error` gives the caller a non-nil error. Type assertions (`x.(T)`) and type switches recover the concrete type; use the two-result `v, ok := x.(T)` form to avoid a panic, and remember that `==` on interface values panics when the dynamic type is not comparable.
**Use this when:** an `err != nil` check is true for a function that "returned nil", you need to branch on the concrete type behind an interface, a comparison of `any` values panics, or you want a compile-time proof that a type implements an interface.
**Not this doc:** method sets and receivers, which decide what implements what → `go/methods-interfaces/methods-and-embedding.md`; interfaces used as constraints for type parameters → `go/generics/type-parameters-and-constraints.md`; why small, consumer-side interfaces → `software-design/design-principles/interface-segregation.md`.

## Problem
Three failures come from not knowing what an interface value holds. A function returns `p` where `p` is a nil `*MyErr`, and the caller's `if err != nil` reports an error that never happened. A single-result type assertion `r.(io.Writer)` crashes the program when the value is not a writer. A map keyed by `any`, or a plain `a == b` on two `any` values, works for months and then panics the day someone stores a slice in it.

## Mental model
**Analogy:** an interface value is a labelled envelope. The label names the concrete type ("`*MyErr`"), and the envelope may hold a value or be empty inside. The envelope counts as "nil" only when it has no label at all; an envelope labelled `*MyErr` with nothing inside is still an envelope, so `err == nil` is false. A type assertion reads the label before opening the envelope.

**Artifact:** the FAQ's schematic view, (T=type, V=value), printed by a Go 1.27.4 program ✅[^1] ✅[^4]:
```go
type MyErr struct{ msg string }

func (e *MyErr) Error() string { return e.msg }

func find(fail bool) error {
	var p *MyErr // nil pointer
	if fail {
		p = &MyErr{"not found"}
	}
	return p // the error holds (T=*MyErr, V=nil)
}

err := find(false)
fmt.Println(err == nil)        // false
fmt.Printf("%T %v\n", err, err) // *main.MyErr <nil>
```

## How it works
1. **An interface type defines a type set.** A variable of interface type can store any value whose type is in that set, and such a type *implements* the interface; an uninitialized interface variable is `nil` ✅[^2]. For a *basic interface* (a list of methods only) the type set is every type that has all those methods ✅[^2]. A non-interface type `T` implements interface `I` when it is in `I`'s type set; an interface type implements `I` when its type set is a subset of `I`'s ✅[^2].
2. **Satisfaction is implicit.** A type implements an interface just by having its methods; most interface conversions are static and the compiler checks them ✅[^3]. One type can implement many interfaces ✅[^2] ✅[^3]. Interfaces with one or two methods are common and are usually named after the method, such as `io.Writer` for `Write` ✅[^3]. `fmt.Stringer` is the interface of any value with a `String() string` method, and `fmt` uses that method for formats that accept a string and for unformatted printing ✅[^8].
3. **`any`.** The empty interface `interface{}` stands for the set of all non-interface types, and since Go 1.18 the predeclared `any` is an alias for it ✅[^2].
4. **The value pair.** Under the covers an interface value has a type `T` and a value `V`; `V` is a concrete value, never an interface; the value is nil only when `T` is unset; and a nil pointer stored inside gives `(T=*int, V=nil)`, which is not nil ✅[^4]. To return "no error", return a literal `nil`, not a nil pointer variable ✅[^4] ✅[^1].
5. **Type assertions.** `x.(T)` asserts that `x` is not nil and that its stored value has type `T`: for a concrete `T` the dynamic type must be identical to `T`; for an interface `T` the dynamic type must implement `T` ✅[^2]. A failed assertion panics, but the two-result form `v, ok := x.(T)` never panics and sets `v` to `T`'s zero value when `ok` is false ✅[^2] ✅[^3].
6. **Type switches.** `switch v := x.(type)` compares the dynamic type of `x` against each case; a case may also be `nil`, chosen when `x` is a nil interface value; in a case that lists exactly one type, `v` has that type, otherwise `v` keeps the type of `x` ✅[^2]. Cases can mix concrete types and interfaces ✅[^3].
7. **Comparing interface values.** Two interface values are equal if their dynamic types are identical and their dynamic values are equal, or if both are nil ✅[^2]. When the dynamic types are identical but not comparable (slices, maps, functions), the comparison panics at run time, also when the interfaces sit inside arrays or struct fields being compared ✅[^2].
8. **Compile-time checks.** Where no ordinary assignment would make the compiler verify an implementation, a package-level declaration such as `var _ json.Marshaler = (*RawMessage)(nil)` does; Effective Go advises it only for that rare case, not for every type ✅[^3].
9. **Runtime representation (briefly).** In Go 1.27.4 the runtime stores a non-empty interface as `iface{tab *itab; data unsafe.Pointer}` and an `any` as `eface{_type *_type; data unsafe.Pointer}` ✅[^5]. An itab records the interface type, the concrete type, a copy of the type's hash used for type switches, and a variable-length table of method addresses ✅[^7]; the runtime keeps itabs in a global hash table keyed by the interface type and the concrete type ✅[^6].
10. **Export the interface, not the type ("Generality").** When a type exists only to implement an interface and has no other exported methods, Effective Go advises leaving the type unexported and having the constructor return the interface; swapping one implementation for another then changes only the constructor call ✅[^3]. The hash packages work this way: `crc32.NewIEEE` and `adler32.New` both return `hash.Hash32` ✅[^3]. In the lab, one `checksum(h hash.Hash32, …)` function served both, and `%T` showed the unexported concrete types behind the interface ✅[^1]:
    ```go
    for _, h := range []hash.Hash32{crc32.NewIEEE(), adler32.New()} {
    	fmt.Printf("%-16T %08x\n", h, checksum(h, "hello"))
    }
    // Output:
    // *crc32.digest    3610a686
    // *adler32.digest  062c0215
    ```

## Worked example
A `describe` function branches on the dynamic type. Run in Go 1.27.4 ✅[^1]:
```go
type Celsius float64

func (c Celsius) String() string { return fmt.Sprintf("%.1f°C", float64(c)) }

var _ fmt.Stringer = Celsius(0)          // compile-time proof
var _ io.Reader = (*strings.Reader)(nil) // the same with a nil pointer

func describe(x any) string {
	switch v := x.(type) {
	case nil:
		return "nil"
	case int, int64:
		return fmt.Sprintf("integer %v (%T)", v, v) // v is still `any` here: two types listed
	case string:
		return "string of length " + fmt.Sprint(len(v)) // v is a string here
	case fmt.Stringer:
		return "Stringer: " + v.String()
	case error:
		return "error: " + v.Error()
	default:
		return fmt.Sprintf("other %T", v)
	}
}
```
| Input | Output | Why |
|---|---|---|
| `nil` | `nil` | The `nil` case matches a nil interface value ✅[^1] ✅[^2] |
| `42`, `int64(7)` | `integer 42 (int)`, `integer 7 (int64)` | Two types in one case; `%T` still shows the real dynamic type ✅[^1] |
| `"héllo"` | `string of length 6` | `len` counts bytes, and `é` is two bytes in UTF-8 (Unicode Transformation Format, 8-bit) ✅[^1] |
| `Celsius(21.5)` | `Stringer: 21.5°C` | No case names `Celsius`; the interface case `fmt.Stringer` matches ✅[^1] |
| `errors.New("boom")` | `error: boom` | Matches the `error` interface case ✅[^1] |
| `3.14` | `other float64` | Falls through to `default` ✅[^1] |

Assertions on an `io.Reader` from the same run ✅[^1]:
```go
var r io.Reader = strings.NewReader("hi")
_, isWriter := r.(io.Writer) // false, no panic
sr := r.(*strings.Reader)    // concrete assertion succeeds; sr.Len() == 2
w := r.(io.Writer)           // panic: interface conversion: *strings.Reader is not io.Writer: missing method Write
```

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Return a nil `*MyErr` variable as `error` | `err == nil` is false; `%v` prints `<nil>`, `%T` prints `*main.MyErr` ✅[^1] | The interface holds (T=`*MyErr`, V=nil) ✅[^4] |
| `var a, b any = 1, "1"`; `a == b` | `false`, no panic ✅[^1] | Dynamic types differ, so the values are unequal ✅[^2] |
| `var x, y any = []int{1}, []int{1}`; `x == y` | Panic `runtime error: comparing uncomparable type []int` ✅[^1] | Identical dynamic types that are not comparable ✅[^2] |
| `m[[]int{1}] = 3` on a `map[any]int` that already holds keys `1` and `"a"` | Panic `runtime error: hash of unhashable type []int` at that insertion ✅[^1] | With an interface key type, `==` must be defined for each dynamic key value, or the map operation panics ✅[^2] |
| `x.(T)` with a single result on the wrong type | Panic `interface conversion: … missing method …` ✅[^1] | A false assertion panics ✅[^2] |
| `y.(string)` where `y` is an interface with a method `m` | Compile error | `string` cannot implement that interface, so the assertion is invalid ✅[^2] |
| Calling a method on a nil interface value | Run-time panic | Spec rule for selectors on a nil interface ✅[^2] |
| Interface method with its own type parameters, `Map[U any](…)` | Compile error `interface method must have no type parameters` ✅[^1] | Interface methods cannot declare type parameters ✅[^2] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Accept a small interface (`io.Reader`) | Any type with the method works, including test fakes ✅[^3] | The method is chosen at run time from the dynamic value ✅[^2] |
| Accept a concrete type | Static call; full application programming interface (API) of the type | Callers cannot substitute another implementation |
| `any` plus a type switch | One function handles unrelated types | Type errors move from compile time to run time; `==` can panic ✅[^2] |
| Type parameter with a constraint | Type checked at compile time | More syntax; see `go/generics/type-parameters-and-constraints.md` |

## Takeaways
- Never return a typed nil pointer through an interface result; write `return nil` explicitly on the success path. [rule-candidate]
- Use the two-result form `v, ok := x.(T)` unless a wrong type is truly a programming error. [rule-candidate]
- Do not compare `any` values or use them as map keys unless every dynamic type that can appear is comparable.
- Add `var _ I = (*T)(nil)` only where nothing else in the package would make the compiler check that `*T` implements `I`.
- When a type exists only to implement an interface, keep it unexported and return the interface from its constructor. [rule-candidate]

## Verification status
- Verified: 54 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `go/lab-setup.md` — the Go 1.27.4 lab (`golang:1.27.4`) where every behaviour marked with this note ran on 2026-11-24. [^1]
- [The Go Programming Language Specification](https://go.dev/ref/spec) — Go team, living. Rank 1. Backs: §Interface types, §Basic interfaces, §Implementing an interface, §Type assertions, §Type switches, §Comparison operators, §Map types (interface keys), §Selectors (nil interface). [^2]
- [Effective Go](https://go.dev/doc/effective_go) — Go team, living. Rank 1. Backs: §Interfaces, §Interface conversions and type assertions, §Generality, §Interface checks. [^3]
- [Frequently Asked Questions (FAQ)](https://go.dev/doc/faq) — Go team, living. Rank 1. Backs: "Why is my nil error value not equal to nil?". [^4]
- [runtime/runtime2.go at go1.27.4](https://github.com/golang/go/blob/go1.27.4/src/runtime/runtime2.go) — Go team, 2026. Rank 1. Backs: the `iface` and `eface` structs. [^5]
- [runtime/iface.go at go1.27.4](https://github.com/golang/go/blob/go1.27.4/src/runtime/iface.go) — Go team, 2026. Rank 1. Backs: the global itab hash table. [^6]
- [internal/abi/iface.go at go1.27.4](https://github.com/golang/go/blob/go1.27.4/src/internal/abi/iface.go) — Go team, 2026. Rank 1. Backs: the fields of an itab. [^7]
- [Package fmt](https://pkg.go.dev/fmt) — Go team, living. Rank 1. Backs: `Stringer` and when `fmt` calls `String`. [^8]

## Related
- `go/methods-interfaces/methods-and-embedding.md` — method sets, which decide what implements an interface.
- `go/errors/errors-and-wrapping.md` — the `error` interface and the typed-nil trap in error returns.
- `go/generics/type-parameters-and-constraints.md` — interfaces as constraints, type sets with `~T` and unions.
- `software-design/design-principles/interface-segregation.md` — small, consumer-side interfaces.
- `software-design/oop/polymorphism.md` — Go interfaces next to TypeScript and Rust abstractions.
- `go/learning-path.md`
