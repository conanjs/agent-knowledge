---
schema: knowledge-doc/v1
type: concept
topic: go/methods-interfaces
status: verified
applies-to: ["Go 1.27 (go1.27.4)"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [go, golang, methods, receivers, pointer-receiver, method-sets, method-values, method-expressions, embedding, promotion]
ranked-sources: true
---

# Methods, receivers, method sets and embedding

## Summary
**TL;DR:** A method is a function with one extra parameter, the receiver, bound to a defined type declared in the same package. A pointer receiver (`*T`) can change the caller's value; a value receiver (`T`) works on a copy. The method set of `T` holds only the value-receiver methods, while the method set of `*T` holds both kinds; that difference decides which interfaces `T` and `*T` satisfy. Embedding a type in a struct promotes its fields and methods to the outer struct, with the shallowest name winning, but the promoted method still runs on the inner value: it is composition, not subclassing.
**Use this when:** choosing between a value and a pointer receiver, reading a "cannot call pointer method" or "method has pointer receiver" compile error, using a method as a function value, or designing a struct that embeds another type.
**Not this doc:** interfaces themselves → `go/methods-interfaces/interfaces.md`; methods on generic types and generic methods → `go/generics/generic-types-methods-and-inference.md`; the design argument for composition → `software-design/oop/composition-over-inheritance.md`.

## Problem
Code that looks right silently loses updates: a method with a value receiver increments a counter, and the caller's counter never changes. Other code does not compile at all: `m["a"].Inc()` fails with "cannot call pointer method", and `var x Incer = Counter{}` fails with "method Inc has pointer receiver", although `c.Inc()` on a plain variable works. Embedding adds its own surprises: a struct that embeds an interface compiles even when it implements none of the interface's methods, and two embedded types with the same method name make every call to that name a compile error. Each case follows one rule of the specification.

## Mental model
**Analogy:** a value receiver is a photocopy handed to a clerk: the clerk can read it or scribble on it, but the original on your desk stays the same. A pointer receiver is the address of your desk: the clerk walks over and edits the original. Embedding is hiring a specialist into your team: requests for the specialist's skills can be sent to your team, but the specialist does the work at their own desk, not yours.

**Artifact:** the same counter with both receiver kinds, run in Go 1.27.4 ✅[^1]:
```go
type Counter struct{ n int }

func (c *Counter) Inc()      { c.n++ }      // pointer receiver: edits the caller's Counter
func (c Counter) Value() int { return c.n } // value receiver: reads a copy

var c Counter
c.Inc()          // the compiler rewrites this to (&c).Inc()
c.Inc()
fmt.Println(c.Value()) // 2
```

## How it works
1. **Declaring a method.** The receiver is an extra parameter section before the method name. Its type must be a defined type `T` or a pointer `*T`; `T` is the *receiver base type*, it cannot itself be a pointer or an interface type, and it must be declared in the same package as the method ✅[^2]. The base type does not have to be a struct: any named type except a pointer or an interface can have methods, for example `type ByteSlice []byte` ✅[^3]. Method names on one base type must be unique, and for a struct they must also differ from its field names ✅[^2].
2. **The receiver is an argument.** It behaves exactly like a function argument, so choosing value or pointer is the same question as for any parameter ✅[^4]. Three considerations, in order: the method must modify the receiver → pointer; the receiver is large → a pointer may be cheaper; some methods need a pointer → make the rest pointers too, for a consistent method set ✅[^4]. For basic types, slices and small structs a value receiver is cheap and clear ✅[^4].
3. **Method sets.** The method set of a defined type `T` is the methods declared with receiver `T`; the method set of `*T` is the methods declared with receiver `*T` or `T` ✅[^2]. The reason: from a `*T` stored in an interface the runtime can always reach the value, but from a `T` stored in an interface there is no safe way to get a pointer, and a pointer method on a hidden copy would lose its changes ✅[^4].
4. **Calls fill in `&` and `*` for you.** A call `x.m()` is valid when the method set of `x`'s type contains `m`; if `x` is *addressable* (a variable, a pointer indirection, a slice element, a field of an addressable struct, or an element of an addressable array) and `&x`'s method set contains `m`, then `x.m()` is shorthand for `(&x).m()` ✅[^2]. In the other direction, a value-receiver method called through a pointer dereferences it: `pt.Mv` means `(*pt).Mv` ✅[^2]. Effective Go states the rule as: value methods can be called on pointers and values, pointer methods only on pointers, except that the compiler inserts `&` for an addressable value ✅[^3].
5. **Method values and method expressions.** `x.M` without a call is a *method value*: a function value with `x` evaluated and saved at that moment, so later changes to `x` do not reach a value receiver already saved ✅[^2] ✅[^1]. `T.M` (or `(*T).M`) is a *method expression*: an ordinary function whose first parameter is the receiver ✅[^2] ✅[^1].
6. **Embedding.** A struct field declared with a type but no name is an *embedded field*; a field or method `f` of an embedded field is *promoted* when `x.f` is a legal selector for it, and promoted fields act like ordinary fields ✅[^2]. Promoted methods join the outer struct's method sets: if `S` embeds `T`, both `S` and `*S` get `T`'s value-receiver methods and `*S` also gets `T`'s pointer-receiver methods; if `S` embeds `*T`, both `S` and `*S` get all of them ✅[^2].
7. **Name resolution by depth.** The *depth* of a name is the number of embedded fields traversed to reach it; a name declared in `T` itself has depth 0 ✅[^2]. `x.f` picks the `f` at the shallowest depth, and the selector is illegal if there is not exactly one `f` at that depth ✅[^2]. So an outer name hides a deeper one, and two names at the same depth are an error only where the program uses that name ✅[^3].
8. **The receiver of a promoted method is the inner value.** When a promoted method runs, its receiver is the embedded field, not the outer struct; this is the key difference from subclassing ✅[^3]. The embedded field is still reachable by its type name, without a package qualifier, as in `s.Logger` ✅[^3].

## Worked example
A service embeds a logger, overrides one method, and also embeds an interface it only partly implements. Program run in Go 1.27.4 ✅[^1]:
```go
type Logger struct{ prefix string }

func (l Logger) Log(msg string) { fmt.Println(l.prefix + msg) }
func (l Logger) Name() string   { return "Logger" }

type Service struct {
	Logger        // embedded: Log, Name and prefix are promoted
	name   string
}

func (s Service) Name() string { return "Service " + s.name } // depth 0 hides Logger.Name (depth 1)

type Greeter interface{ Greet() string; Bye() string }

type loud struct{ Greeter } // embeds an interface value, nil here

func (loud) Greet() string { return "HELLO" }

s := Service{Logger: Logger{prefix: "[svc] "}, name: "orders"}
s.Log("started")             // [svc] started
fmt.Println(s.Name())        // Service orders
fmt.Println(s.Logger.Name()) // Logger

var g Greeter = loud{}  // compiles: Bye is promoted from the embedded Greeter
fmt.Println(g.Greet())  // HELLO
fmt.Println(g.Bye())    // panic: runtime error: invalid memory address or nil pointer dereference
```

| Step | What happens |
|---|---|
| `s.Log("started")` | `Log` has depth 1 and no rival, so it is promoted; it runs with receiver `s.Logger` and prints the inner `prefix` ✅[^1] ✅[^3] |
| `s.Name()` | Two `Name` methods exist, at depth 0 and depth 1; the shallowest wins ✅[^1] ✅[^2] |
| `var g Greeter = loud{}` | The method set of `loud` contains `Greet` (declared) and `Bye` (promoted from the interface field), so the assignment type-checks ✅[^1] ✅[^2] |
| `g.Bye()` | The promoted call goes to the embedded interface, which is nil; calling a method on a nil interface value panics ✅[^1] ✅[^2] |

Method values and expressions from the same lab run ✅[^1]:
```go
v := c.Value           // method value: copies c (n is 2) now
c.Inc()
fmt.Println(v(), c.Value())        // 2 3
inc := (*Counter).Inc  // method expression: func(*Counter)
inc(&c)
fmt.Println(Counter.Value(c))      // 4
```

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `m["a"].Inc()` where `m` is `map[string]Counter` and `Inc` has a pointer receiver | Compile error `cannot call pointer method Inc on Counter` ✅[^1] | A map element is not in the list of addressable operands, so the `&` shorthand cannot apply ✅[^2] |
| `var x Incer = Counter{}` when `Inc` has receiver `*Counter` | Compile error `Counter does not implement Incer (method Inc has pointer receiver)` ✅[^1] | `Inc` is in the method set of `*Counter` only ✅[^2]; assign `&Counter{}` instead |
| A value-receiver method modifies the receiver | The change is lost when the method returns | The method got a copy, as any value argument does ✅[^4] |
| Struct `C` embeds both `A` and `B`, each with `Hello()`, and code calls `c.Hello()` | Compile error `ambiguous selector c.Hello` ✅[^1] | Two `Hello` at the same shallowest depth ✅[^2]; `c.A.Hello()` still works ✅[^1] |
| The same duplicate exists but nothing calls it | Compiles | A same-level duplicate is only an error when the name is used outside the type definition ✅[^3] |
| `makeT().Mp` with pointer method `Mp` | Invalid | A function result is not addressable ✅[^2] |
| Embedding `*T` and forgetting to set it | Promoted calls dereference a nil pointer | Embedded pointers must point to valid values before use ✅[^3] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Value receiver | Cheap for small types; `T` and `*T` both satisfy interfaces made of these methods ✅[^2] | Cannot change the caller's value; copies large structs on every call ✅[^4] |
| Pointer receiver | Can modify; avoids copying large values ✅[^4] | Only `*T` satisfies interfaces needing it; values in maps or returned by functions cannot call it |
| Embedding | Methods come along without writing forwarding methods ✅[^3] | Every promoted method joins the outer type's method set ✅[^2], so the outer type exposes all of them, wanted or not |
| Named field plus forwarding methods | Only the chosen methods are exposed | One hand-written method per forwarded call ✅[^3] |

## Takeaways
- If any method of a type needs a pointer receiver, give all its methods pointer receivers, so the method set is the same however the type is used. [rule-candidate]
- Assign `&T{}` (not `T{}`) to an interface when the methods have pointer receivers; read "method has pointer receiver" as exactly this mistake.
- Embedding promotes, it does not inherit: a promoted method never sees the outer struct, so it cannot call the outer type's overriding methods.
- Embedding an interface in a struct satisfies the interface at compile time even for methods you did not write; calling one of those panics at run time unless the field is set. [rule-candidate]

## Verification status
- Verified: 50 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `go/lab-setup.md` — the Go 1.27.4 lab (`golang:1.27.4`) where every behaviour marked with this note ran on 2026-11-24. [^1]
- [The Go Programming Language Specification](https://go.dev/ref/spec) — Go team, living. Rank 1. Backs: §Method declarations, §Method sets, §Struct types (embedded fields, promotion), §Selectors (depth, nil interface), §Calls (`(&x).m()` shorthand), §Address operators (addressability), §Method expressions, §Method values. [^2]
- [Effective Go](https://go.dev/doc/effective_go) — Go team, living. Rank 1. Backs: §Pointers vs. Values, §Embedding (no subclassing, receiver is the inner type, name conflicts). [^3]
- [Frequently Asked Questions (FAQ)](https://go.dev/doc/faq) — Go team, living. Rank 1. Backs: "Should I define methods on values or pointers?", "Why do T and *T have different method sets?". [^4]

## Related
- `go/methods-interfaces/interfaces.md` — how method sets decide which interfaces a type satisfies.
- `go/data-types/structs-and-pointers.md` — structs, pointers and addressability.
- `go/generics/generic-types-methods-and-inference.md` — methods on generic types and Go 1.27 generic methods.
- `software-design/oop/composition-over-inheritance.md` — why composition, across languages.
- `go/learning-path.md`
