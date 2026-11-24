---
schema: knowledge-doc/v1
type: concept
topic: go/fundamentals
status: verified
applies-to: ["Go 1.27 (go1.27.4)", "min and max: Go 1.21 and later"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [go, golang, var, short-variable-declaration, zero-value, basic-types, conversions, constants, untyped-constants, iota, overflow, shadowing, blank-identifier, min, max]
ranked-sources: true
---

# Declarations, basic types and constants

## Summary
**TL;DR:** Go declares variables with `var` (anywhere) or `:=` (inside functions), and every variable starts at its type's zero value: `0`, `false`, `""` or `nil`. Numeric types never mix silently: `int` and `int32` are different types, so every conversion is written out. Constants are different from variables: they are exact, arbitrary-precision values computed at compile time, usually *untyped* until they are used, and `iota` numbers them in a `const` block. A constant that does not fit its type is a compile error; a variable that overflows at run time wraps around without any error.
**Use this when:** declaring variables or enumerations, choosing an integer type, reading a `mismatched types` or `overflows` compiler error, or wondering why `:=` did or did not create a new variable.
**Not this doc:** strings, bytes and runes in depth → `go/data-types/strings-bytes-and-runes.md`; `if`, `for`, `switch` and functions → `go/fundamentals/control-flow-and-functions.md`; how floating-point values round → `floating-point/`.

## Problem
A Go newcomer meets compile errors that other languages would accept: `invalid operation: a + b (mismatched types int and int32)`, `no new variables on left side of :=`, `cannot use 200 (untyped int constant) as int8 value`. Meanwhile, code that the compiler *does* accept can still surprise: an `int8` counter goes from 127 to -128 with no error, an inner `x := 2` leaves the outer `x` unchanged, and `int` is 64 bits on one machine and 32 bits on another. Each follows one rule about declarations, types or constants.

## Mental model
**Analogy:** a typed variable is a box of a fixed size: an `int8` box holds -128 to 127, and a `uint8` box holds 0 to 255. Pouring more in makes the value wrap around inside the box. An untyped constant is a number written on paper: it is exact, it can be as large as you like, and it only has to fit when you finally pour it into a box. If it does not fit, the compiler stops you before the program ever runs.

**Artifact:** declarations and the values they produced in Go 1.27.4 ✅[^1]:
```go
var count int            // 0: the zero value
name := "gopher"         // string, type taken from the value
const Huge = 1 << 100    // exact, untyped: fine on paper
fmt.Println(Huge >> 98)  // 4: still exact when shifted back down
var i8 int8 = 127
i8++                     // -128: run-time wrap-around, no error
x := Huge                // compile error: ... as int value in assignment (overflows)
```

## How it works
1. **Variable declarations.**
   - `var name Type`, `var name = value` and `var name Type = value` all create variables; without an initializer each variable gets its zero value ✅[^2].
   - Without a type, the variable takes the type of its initializer; an untyped constant initializer is converted to its default type first, and `var n = nil` is illegal because `nil` has no type ✅[^2]. Go 1.27.4 reports `use of untyped nil in variable declaration` ✅[^1].
   - `x := value` is short for `var x = value` and is allowed only inside functions; it is also how `if`, `for` and `switch` declare their temporary variables ✅[^2].
2. **Zero values.** A variable or value created without an explicit initializer is set to `false` for booleans, `0` for numbers, `""` for strings and `nil` for pointers, functions, interfaces, slices, channels and maps, recursively through arrays and structs ✅[^2]. Printing each kind in the lab gave `0 0 false "" <nil>`, `true` for the nil checks of a slice, a map and a function, and `<nil>` for an `error` ✅[^1].
3. **Basic types.**
   - Sized integers `int8`…`int64` and `uint8`…`uint64`, `float32`, `float64`, `complex64`, `complex128`, `bool` and `string` are predeclared; signed integers use two's complement ✅[^2].
   - `byte` is an alias for `uint8` and `rune` an alias for `int32`; every other numeric type is distinct, so `int32` and `int` differ even when they have the same size ✅[^2]. In the lab, `fmt.Printf("%T", byte('A'))` printed `uint8` and a rune literal printed `int32` ✅[^1].
   - `int` and `uint` are 32 or 64 bits, depending on the implementation, and `uintptr` is large enough to hold a pointer ✅[^2]. The same program printed `strconv.IntSize` as `64` on linux/arm64 and `32` when built with `GOARCH=arm` or `GOARCH=386` ✅[^1].
4. **Conversions are explicit.** Mixing numeric types in an expression or assignment needs an explicit conversion `T(x)` ✅[^2]; without it Go 1.27.4 reports `mismatched types int and int32` ✅[^1].
   - Integer to integer: the value is sign- or zero-extended, then truncated to the new size, with no overflow indication ✅[^2].
   - Floating-point to integer: the fraction is discarded, rounding toward zero ✅[^2]; `int(-2.7)` on a variable gave `-2` ✅[^1].
5. **Constants.**
   - Constants are booleans, runes, integers, floating-point numbers, complex numbers or strings, created at compile time, and their defining expression must be a constant expression (`1<<3` is one, `math.Sin(math.Pi/4)` is not) ✅[^3].
   - Numeric constants are exact, arbitrary-precision values that never overflow; compilers must represent integer constants with at least 256 bits ✅[^2]. `1 << 100` is a legal untyped constant, and `Huge >> 98` printed `4` ✅[^2] ✅[^1].
   - A constant is *untyped* unless a declaration or conversion gives it a type. An untyped constant has a default type, used when a typed value is needed and nothing else decides: `bool`, `rune`, `int`, `float64`, `complex128` or `string` ✅[^2]. `a, c, r, z, st, t := 1, 1.0, 'x', 1i, "s", true` printed the types `int float64 int32 complex128 string bool` ✅[^1].
   - Passing an untyped constant to a parameter of interface type (such as `fmt.Println`'s `...any`) stores its default type in the interface value ✅[^6].
   - It is an error when a constant's value cannot be represented in the type it is given ✅[^2]: `const f int8 = 200` fails with `cannot use 200 (untyped int constant) as int8 value in constant declaration (overflows)` ✅[^1].
6. **`iota`.** Inside one `const` block, `iota` is the index of each constant spec, starting at 0; a spec with no expression repeats the previous expression, so `iota` gives a sequence ✅[^2]. Effective Go's `ByteSize` example skips 0 with `_ = iota` and computes `1 << (10 * iota)` ✅[^3].
7. **Run-time overflow.** For unsigned integers, `+`, `-`, `*` and `<<` work modulo 2ⁿ (the bits that do not fit are dropped); signed overflow is also defined by two's complement, never panics, and the compiler may not assume it cannot happen ✅[^2]. In the lab, `int8(127) + 1` gave `-128` and `uint8(0) - 1` gave `255` ✅[^1].
8. **Scope, shadowing and redeclaration.**
   - Go scopes are blocks; a name declared in an inner block hides (shadows) the same name from an outer block while it is in scope ✅[^2].
   - `:=` may reuse a name declared earlier *in the same scope*, if at least one other name on the left is new; the reused name is only assigned, not redeclared ✅[^2] ✅[^3]. With no new name, Go 1.27.4 reports `no new variables on left side of :=` ✅[^1].
   - In an inner scope, `:=` always creates a new variable, even when an outer one has the same name ✅[^3].
9. **The blank identifier `_`** takes a value without binding a name, for example `_, found := entries[name]` ✅[^2].
10. **`min` and `max`** (built-ins since Go 1.21) return the smallest or largest of one or more ordered arguments; the result type follows the operator rules, all-constant arguments give a constant, and any NaN (not-a-number) argument gives NaN ✅[^2] ✅[^4]. `min(3, 1, 2)` gave `1`, `max(1, 2.0, 10)` gave `10` of type `float64`, and `min("b", "a", "c")` gave `a` ✅[^1].
11. **Names.** Go uses MixedCaps (`maxLength`, `MaxLength`) rather than underscores ✅[^3]; a package-level name, field or method that starts with an upper-case letter is exported ✅[^2].

## Worked example
Defining byte-size constants with `iota` and using them, as run in the lab ✅[^1]:
```go
type ByteSize float64

const (
	_           = iota // iota 0 is thrown away
	KB ByteSize = 1 << (10 * iota)
	MB
	GB
)
```

| Step | What the compiler does | Value printed |
|---|---|---|
| 1 | `_ = iota`: iota is 0, the value is discarded | — |
| 2 | `KB`: iota is 1, `1 << 10` = 1024, typed `ByteSize` | `1024` ✅[^1] |
| 3 | `MB`: no expression, so it repeats `ByteSize(1 << (10 * iota))` with iota 2 | `1.048576e+06` ✅[^1] |
| 4 | `GB`: same expression with iota 3 | `1.073741824e+09` ✅[^1] |
| 5 | `fmt.Println(KB, MB, GB)`: `ByteSize` is a float64, so `%v` uses float formatting for large values | `1024 1.048576e+06 1.073741824e+09` ✅[^1] |

Effective Go adds a `String` method to `ByteSize`, after which `YB` prints as `1.00YB` and `ByteSize(1e13)` as `9.09TB` ✅[^3]; methods are covered in `go/methods-interfaces/methods-and-embedding.md`.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `x := Huge` where `Huge = 1 << 100` | Compile error: `cannot use Huge (untyped int constant 1267650600228229401496703205376) as int value in assignment (overflows)` ✅[^1] | The default type `int` cannot hold the exact value ✅[^2] |
| `uint32(int8(v))` with `v := uint16(0x10F0)` | `0xFFFFFFF0` ✅[^1] | `int8` keeps the low byte `0xF0` (-16), which is then sign-extended ✅[^2] |
| Float to int where the value does not fit, on variables | Succeeds with an implementation-dependent value ✅[^2] | No run-time check exists for non-constant conversions |
| `return` with no values when an inner `err :=` shadows the named result `err` | Compile error: `result parameter err not in scope at return` ✅[^1] | Implementations may reject a bare return while a result name is shadowed ✅[^2] |
| Unused local variable | Compile error: `declared and not used: x` ✅[^1] | The compiler rejects unused variables ✅[^5] |
| `const zero = 0.0`, then `var i int = zero` | Compiles and prints `0` ✅[^1] | An untyped constant only has to be representable in the target type ✅[^2] |
| `const half = 0.5`, then `var i int = half` | Compile error: `cannot use half (untyped float constant 0.5) as int value in variable declaration (truncated)` ✅[^1] | 0.5 has no exact `int` value ✅[^2] |
| `const c = 3/2` versus `const d = 3/2.` | `1` versus `1.5` ✅[^2] | Integer division when both operands are integer constants |
| `max(0.5, math.NaN())` | `NaN` ✅[^1] | Any NaN argument makes the result NaN ✅[^2] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `int` for counts and indexes | Matches `len`, slice indexes and most application programming interfaces (APIs) | Size depends on the platform (32 or 64 bits) |
| Sized types (`int32`, `uint64`) | Fixed range, needed for file formats and wire protocols | Explicit conversions everywhere they meet `int` |
| Untyped constants (`const timeout = 5`) | Usable with any compatible numeric type | The type is decided at each use, which can hide where it is fixed |
| Typed constants (`const timeout time.Duration = 5`) | Only usable as that type: the compiler catches misuse | Need conversions to mix with other types |
| `var x T` | Makes the zero value explicit | Longer than `:=` |
| `x := expr` | Short; the type comes from the value | Easy to shadow an outer variable by accident in an inner block |

## Takeaways
- Rely on zero values instead of writing `= 0` or `= ""`; design types so their zero value is usable. [rule-candidate]
- Use `int` unless a size is required by a format, protocol or memory budget; convert explicitly at the boundary.
- Write enumerations as a typed `const` block with `iota`, and start the useful values at 1 when the zero value should mean "unset". [rule-candidate]
- Check for shadowed `err` variables inside `if` and `for` blocks: an inner `:=` creates a new variable. [rule-candidate]
- Range-check values from outside before converting them to a smaller integer type: run-time conversions and arithmetic wrap without any error.

## Verification status
- Verified: 63 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `go/lab-setup.md` — the Go 1.27.4 lab (`golang:1.27.4`) where every behaviour marked with this note ran on 2026-11-24. [^1]
- [The Go Programming Language Specification](https://go.dev/ref/spec) — Go team, living. Rank 1. Backs: §Constants, §Variables, §Numeric types, §Declarations and scope, §Blank identifier, §Exported identifiers, §Constant declarations, §Iota, §Variable declarations, §Short variable declarations, §Return statements, §Integer overflow, §Conversions, §Constant expressions, §Min and max, §The zero value. [^2]
- [Effective Go](https://go.dev/doc/effective_go) — Go team, living. Rank 1. Backs: §Names (MixedCaps), §Redeclaration and reassignment, §Constants (`ByteSize`). [^3]
- [Go 1.21 Release Notes](https://go.dev/doc/go1.21) — Go team, 2023. Rank 1. Backs: `min`, `max` and `clear` added in Go 1.21. [^4]
- [Frequently Asked Questions (FAQ)](https://go.dev/doc/faq) — Go team, living. Rank 1. Backs: unused variables are compile errors. [^5]
- [Constants](https://go.dev/blog/constants) — Rob Pike, Go blog, 2014. Rank 4. Backs: an untyped constant passed as an interface value takes its default type. [^6]

## Related
- `go/learning-path.md` — where this doc sits in the learning order.
- `go/fundamentals/control-flow-and-functions.md` — `if`, `for`, `switch`, functions and `defer`.
- `go/data-types/strings-bytes-and-runes.md` — strings, UTF-8, `byte` and `rune` in depth.
- `go/data-types/structs-and-pointers.md` — composite literals and `new`.
- `go/introduction/toolchain-and-compatibility.md` — the `go` command and why unused imports fail the build.
- `floating-point/` — how `float32` and `float64` values are stored and rounded.
