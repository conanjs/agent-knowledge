---
schema: knowledge-doc/v1
type: concept
topic: go/low-level
status: verified
applies-to: ["Go 1.27 (go1.27.4)", "Type.Fields, Value.Fields and the other iterator methods: Go ≥ 1.26", "linux/arm64 lab; benchmark numbers are from one machine"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [go, golang, reflect, reflection, struct-tags, settability, kind, interface, performance]
ranked-sources: true
---

# Reflection in Go: Type, Value, Kind and settability

## Summary
**TL;DR:** Package `reflect` looks inside an interface value at run time: `reflect.TypeOf` gives its dynamic type, `reflect.ValueOf` its value. Three rules ("laws") cover almost everything: reflection goes from an interface value to a reflection object, `Value.Interface` goes back, and a `Value` can be changed only if it is settable, which means it was reached through a pointer and not through an unexported field. Reflection powers struct tags, encoders and dependency injection, but in the lab a reflected field write cost about 18× a direct one and a reflected call about 75×.
**Use this when:** you write or debug code that reads struct tags, walks arbitrary structs (encoders, config loaders, validators), calls methods by name, or panics with `reflect: … using unaddressable value`.
**Not this doc:** interface values and type switches, which solve most "what type is this?" needs without reflection → `go/methods-interfaces/interfaces.md`; generic code, which often replaces reflection → `go/generics/type-parameters-and-constraints.md`; raw memory access → `go/low-level/unsafe-and-cgo.md`.

## Problem
Some code must handle types it has never seen: a JSON encoder, a config loader that fills any struct from environment variables, a test helper that compares deep structures. Go is statically typed, so this needs a run-time view of types. Used without the rules, that view fails in confusing ways: a setter panics on a value that "is clearly a variable", a `Kind` check treats `Celsius` as a plain `float64`, an unexported field silently cannot be set, and hot loops slow down by an order of magnitude.

## Mental model
**Analogy:** an interface value is a sealed parcel with a label (its dynamic type) and contents (its value). `reflect.TypeOf` reads the label, `reflect.ValueOf` opens a **copy** of the parcel so you can inspect the contents. Writing into that copy would change nothing at home, so reflection refuses ("not settable"). To change the original you must send a parcel that holds the address of your variable (a pointer) and then follow it (`Elem`).

**Artifact:** the three laws, run in the lab ✅[^1] ✅[^4], as shown below:
```go
type Celsius float64

var t Celsius = 21.5
v := reflect.ValueOf(t)                         // law 1: interface value -> reflection object
fmt.Println(v.Type(), v.Kind())                 // main.Celsius float64
back := v.Interface().(Celsius)                 // law 2: reflection object -> interface value
fmt.Println(v.CanSet())                         // false: v holds a copy of t
v.SetFloat(30)                                  // panic: reflect: reflect.Value.SetFloat using unaddressable value
p := reflect.ValueOf(&t).Elem()                 // law 3: reach the variable through a pointer
p.SetFloat(30)                                  // t is now 30
```

## How it works
1. **Interface value → reflection object (law 1).** Every interface variable holds a pair: a concrete value and its type. `reflect.TypeOf` and `reflect.ValueOf` take an `any` and return the `reflect.Type` and `reflect.Value` pieces of that pair ✅[^4]. The typical use is to take a value of static type `interface{}` and extract its dynamic type ✅[^2].
2. **Type versus Kind.** `Type` is the exact type (`main.Celsius`); `Kind` is the underlying category (`float64`, `struct`, `slice`, `ptr` …). `Kind` cannot tell `MyInt` from `int`, because both have kind `Int` ✅[^4]; the lab printed type `main.Celsius`, kind `float64` ✅[^1].
3. **Reflection object → interface value (law 2).** `Value.Interface()` packs the type and value back into an `interface{}`, which a type assertion turns into a concrete value again ✅[^4].
4. **Settability (law 3).** A `Value` can be changed only if it is addressable and was not obtained through unexported struct fields; otherwise every setter (`Set`, `SetInt`, `SetFloat` …) panics ✅[^2]. Settability is about whether the reflection object holds the original item: `ValueOf(x)` receives a copy of `x`, so setting it could never update `x` ✅[^4]. Passing `&x` and calling `Elem()` gives a settable `Value` for `x` itself ✅[^4].
5. **Structs and tags.** On a struct `Value`, `NumField`/`Field(i)` and `Type().Field(i)` give each field's value and its `StructField` (name, type, tag) ✅[^4]. A tag is by convention a list of `key:"value"` pairs separated by spaces; `StructField.Tag.Get(key)` returns a value, and `Tag.Lookup` tells an absent key from an empty one ✅[^2]. Since Go 1.26, `Type.Fields`, `Type.Methods`, `Type.Ins`, `Type.Outs`, `Value.Fields` and `Value.Methods` return iterators, so `for f, fv := range v.Fields()` replaces the index loop ✅[^3].
6. **Calling functions and methods.** `Value.Call(in)` calls a function value with `[]reflect.Value` arguments, each of which must be assignable to its parameter; it panics if the kind is not `Func` ✅[^2]. `Value.Method(i)` and `Value.MethodByName(name)` return a function value bound to the receiver, so the arguments to `Call` exclude the receiver; `MethodByName` returns the zero `Value` when no method has that name ✅[^2].

## Worked example
A tiny config loader's first half: read the tags of a struct, fill fields by name, then call a method by name ✅[^1], as shown below:
```go
type Config struct {
	Host   string `env:"APP_HOST" default:"localhost"`
	Port   int    `env:"APP_PORT" default:"8080"`
	secret string // unexported
}
func (c Config) Addr() string { return fmt.Sprintf("%s:%d", c.Host, c.Port) }

cfg := Config{}
cv := reflect.ValueOf(&cfg).Elem()          // settable: reached through a pointer
for f, fv := range cv.Fields() {            // Go 1.26 iterator
	fmt.Printf("field %-6s env=%-9q default=%-11q settable=%v\n",
		f.Name, f.Tag.Get("env"), f.Tag.Get("default"), fv.CanSet())
}
cv.FieldByName("Host").SetString("db.internal")
cv.FieldByName("Port").SetInt(5432)
out := cv.MethodByName("Addr").Call(nil)
fmt.Println("Addr() via reflection:", out[0].String())
```
```console
field Host   env="APP_HOST" default="localhost" settable=true
field Port   env="APP_PORT" default="8080"      settable=true
field secret env=""        default=""          settable=false
Addr() via reflection: db.internal:5432
```
The unexported `secret` field is visible to reflection but not settable ✅[^1] ✅[^2].

**Cost.** Benchmarks with `b.Loop`, three runs each, on the lab machine ✅[^1]:

| Operation | ns/op | allocs/op |
|---|---|---|
| `c.Port = 8080` | 2.5–2.9 | 0 |
| `v.FieldByName("Port").SetInt(8080)` | 44–53 | 0 |
| `add(1, 2)` | 2.3–2.5 | 0 |
| `reflect.ValueOf(add).Call(args)` | 174–202 | 2 (32 B) |

Three later runs under heavier machine load gave 57–66 ns for the reflected write and 207–240 ns for the reflected call, about 20× and 80× the direct versions, with the same allocations ✅[^1]. Treat the ratios as an order of magnitude, not a constant.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `reflect.ValueOf(x).SetInt(1)` | Panic: `using unaddressable value` ✅[^1] | The `Value` holds a copy of `x` ✅[^4] |
| Setting an unexported field, even through a pointer | `CanSet()` is false and the setter panics ✅[^1] ✅[^2] | Values obtained through unexported fields are never settable ✅[^2] |
| `Kind() == reflect.Int` on a `type MyInt int` | True ✅[^1] | Kind is the underlying category, not the named type ✅[^4] |
| A tag that is not in `key:"value"` form | `Tag.Get` returns an unspecified value ✅[^2] | Only the conventional format is parsed ✅[^2] |
| `Tag.Get("env")` on a field without that key | `""`, the same as an explicit empty value ✅[^1] | Use `Tag.Lookup` to tell them apart ✅[^2] |
| `Call` on a function reached through an unexported field | Panic ✅[^2] | The same rule as setters ✅[^2] |
| Using `Value.Method` or `MethodByName` anywhere in a program | The binary may grow ✅[^2] | The linker must keep all exported methods (or all methods with that name) because any could be called ✅[^2] |
| `MethodByName("Missing")` | Zero `Value` (`IsValid()` is false); `Call` on it panics with `call of reflect.Value.Call on zero Value` ✅[^1] | No method was found ✅[^2] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Reflection | Works for any type, including ones written later | About 18× slower field writes and 75× slower calls in the lab, plus allocations ✅[^1]; errors become run-time panics |
| Type switch on an interface | Fast, checked by the compiler | Only the types you list |
| Generics | Compile-time type safety, no run-time type inspection | Cannot read struct tags or field names |
| Code generation (`go generate`) | Plain Go at run time | A build step and generated files to keep in sync |

## Takeaways
- Reach the value through a pointer (`reflect.ValueOf(&x).Elem()`) whenever you intend to modify it. [rule-candidate]
- Check `CanSet()` before calling a setter on fields of types you do not control. [rule-candidate]
- Prefer a type switch or generics when the set of types is known; keep reflection out of hot loops, or cache the `reflect.Type` and field indexes outside them.
- Read tags with `Tag.Lookup` when an empty value must differ from an absent key.

## Verification status
- Verified: 38 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `go/lab-setup.md` — the Go 1.27.4 lab (`golang:1.27.4`) where every behaviour marked with this note ran on 2026-11-24 (OrbStack, 8 logical CPUs, arm64). [^1]
- [Package reflect](https://pkg.go.dev/reflect) — Go team, living. Rank 1. Backs: the package's purpose; `CanSet` rule; tag conventions, `Get` and `Lookup`; `Call`, `Method`, `MethodByName` and their linker cost. [^2]
- [Go 1.26 Release Notes](https://go.dev/doc/go1.26) — Go team, 2026. Rank 1. Backs: the iterator methods `Type.Fields`, `Type.Methods`, `Type.Ins`, `Type.Outs`, `Value.Fields`, `Value.Methods`. [^3]
- [The Laws of Reflection](https://go.dev/blog/laws-of-reflection) — Go team (Rob Pike), 2011. Rank 4. Backs: the interface (value, type) pair; the three laws; Type versus Kind; settability and `Elem`; walking struct fields. [^4]

## Related
- `go/learning-path.md` — where this doc sits in the learning order.
- `go/methods-interfaces/interfaces.md` — interface values, the pair reflection reads.
- `go/standard-library/io-and-encoding-json.md` — `encoding/json`, the best-known user of struct tags.
- `go/generics/type-parameters-and-constraints.md` — compile-time alternative for many reflection uses.
- `go/low-level/unsafe-and-cgo.md` — `reflect.Value.Pointer` and `UnsafeAddr` with `unsafe`.
