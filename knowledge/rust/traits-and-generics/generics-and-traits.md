---
schema: knowledge-doc/v1
type: concept
topic: rust/traits-and-generics
status: verified
applies-to: ["Rust 1.100.0", "edition 2024"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [rust, generics, traits, monomorphization, trait-bounds, impl-trait, blanket-impl, coherence, orphan-rule, derive]
---

# Generics, traits and monomorphization

## Summary
**TL;DR:** A generic function, struct or enum is written once with type parameters, and the compiler stamps out one machine-code copy per concrete type the program actually uses (monomorphization): generic code runs like hand-written concrete code, at the price of binary size. A trait is a named set of methods a type promises to provide; a bound (`T: Trait`, or a `where` clause) is the only thing a generic body may rely on, and `impl Trait` is shorthand for a bound in argument position or for one hidden concrete type in return position. Coherence (the orphan rule plus "no two impls may overlap") guarantees that each trait has at most one impl for a given type across every crate in the build.
**Use this when:** writing a function or type that works for many types, reading a "consider restricting type parameter" error, hitting E0117 or E0119 when implementing a trait, or wondering why a `#[derive]` impl does not apply to your generic type.
**Not this doc:** `dyn Trait`, vtables and dynamic dispatch → `rust/traits-and-generics/trait-objects-and-dynamic-dispatch.md`; associated types, operator overloading, the newtype workaround for the orphan rule, GATs, HRTB (higher-ranked trait bounds) and const generics → `rust/traits-and-generics/advanced-traits-and-type-system.md`; the catalog of standard traits → `rust/traits-and-generics/core-traits-reference.md`; lifetime parameters → `rust/ownership/lifetimes.md`; the code-size cost of monomorphization → `rust/performance/zero-cost-abstractions-and-optimization.md`; how derive macros are written → `rust/macros/procedural-macros.md`.

## Problem
Without generics, the same "find the largest" or "describe this device" logic is copied once per type. With generics but without traits, the body cannot do anything with `T` — not even compare two values — so a call with `i32` fails even though `i32` supports `>`. Trait impls then fail with errors that name rules rather than bugs: E0117 ("only traits defined in the current crate can be implemented for types defined outside of the crate"), E0119 ("conflicting implementations") even when the types look unrelated, and E0599 when a derived `Clone` mysteriously does not apply to `Shared<NoClone>`.

## Mental model
**Analogy:** a generic function is a stencil, and the compiler is a print shop. You hand over one stencil; for every paper colour (concrete type) somebody orders, the shop prints a separate sheet. A colour nobody orders is never printed. The trait bound is the note on the stencil saying which papers it works on ("only papers that can be added together").

**Artifact:** one generic function used with three types becomes three distinct functions in the binary; an unused generic function becomes none ✅[^1]:
```rust
use std::ops::Add;
#[inline(never)]
fn double_it<T: Add<Output = T> + Copy>(x: T) -> T { x + x }
#[allow(dead_code)]
#[inline(never)]
fn never_called<T: Copy>(x: T) -> T { x }
fn main() {
    println!("{} {} {}", double_it(3u8), double_it(2.5f64), double_it(7i64));
}
```
```console
$ rustc --edition 2024 -o /tmp/m g02_mono.rs && /tmp/m
6 5 14
$ nm -C /tmp/m | grep -E 'double_it|never_called'
0000000000008ce8 t g02_mono::double_it::<f64>
0000000000008d0c t g02_mono::double_it::<u8>
0000000000008d30 t g02_mono::double_it::<i64>
```
The raw names (`nm` without `-C`) are `_RINv…9double_itdEB2_`, `…ithEB2_` and `…itxEB2_`: the `_R` prefix is the v0 mangling scheme, which encodes the type arguments in the symbol ✅[^1]. The rustc book calls v0 the one stable mangling scheme, with `legacy` available only on nightly ✅[^8]; in the lab, `-C symbol-mangling-version=legacy` on stable 1.100 was refused with "requires `-Z unstable-options`" ✅[^1].

## How it works
1. **Generic definitions.** Functions, structs, enums and `impl` blocks take type parameters in angle brackets: `fn peak<T: PartialOrd + Copy>(xs: &[T]) -> T`, `struct Span<T> { lo: T, hi: T }`, `enum Sample<T> { Value(T), Missing }` ✅[^2] ✅[^1]. An `impl<T: PartialOrd> Span<T>` block gives methods to every qualifying `Span<T>`; an `impl Span<f64>` block gives methods (here `width`) to that one instantiation only ✅[^2] ✅[^1].
2. **Monomorphization.** At compile time each use with concrete types is replaced by a specialised copy, which is why generic code is no slower than concrete code ✅[^2]. The artifact above shows one symbol per instantiation and none for the generic that was never instantiated ✅[^1]. This is Rust's form of polymorphism: generics constrained by trait bounds, which the Book calls bounded parametric polymorphism, instead of inheritance ✅[^9].
3. **The body is checked against the bounds, not against the caller's type.** `fn bigger<T>(a: T, b: T) -> T { if a > b { a } else { b } }` fails with `error[E0369]: binary operation `>` cannot be applied to type `T`` even though the only call is `bigger(1, 2)` with `i32`; the compiler suggests `T: std::cmp::PartialOrd` ✅[^1]. A bound is a promise the caller must keep and the only knowledge the body may use.
4. **Traits: required and default methods.** A trait lists method signatures; an impl must supply every method without a body and may override the ones with a default body. A default method may call required methods of the same trait ✅[^3]. In the worked example, `Sensor` keeps the default `status_line` and `Valve` overrides it ✅[^1].
5. **Bounds and `where`.** Several bounds join with `+` (`T: Display + Clone`). A `where` clause after the signature says the same thing and keeps long signatures readable ✅[^3].
6. **`impl Trait` in argument position** is sugar for an anonymous type parameter ✅[^5]. Because that parameter has no name, the caller cannot pass it explicitly: `total::<Vec<u32>>(…)` against `fn total(xs: impl IntoIterator<Item = u32>)` fails with `error[E0107]: function takes 0 generic arguments but 1 generic argument was supplied` ✅[^1]. Switching a parameter between `impl Trait` and a named generic changes the number of generic arguments, which can break callers ✅[^5].
7. **`impl Trait` in return position** hides one concrete type that the function, not the caller, chooses; every return path must produce that same type ✅[^5] ✅[^3]. Returning `1` from one branch and `"one"` from the other fails with `error[E0308]: `if` and `else` have incompatible types`, and the compiler suggests `Box<dyn Display>` ✅[^1].
8. **Blanket impls** implement a trait for every type that meets a bound: `impl<T: Display + ?Sized> Shout for T` made `"hello".shout()` and `3.5.shout()` work ✅[^1]. The standard library's `impl<T: Display> ToString for T` is why every `Display` type has `to_string` ✅[^3].
9. **Coherence: the orphan rule.** An impl is allowed only if the trait is local, or at least one type in the impl is local and no uncovered type parameter appears before the first local type. Formally, for `impl<P1..=Pn> Trait<T1..=Tn> for T0`, the first local type `Ti` among `T0..=Tn` must have no uncovered `P` in `T0..Ti` ✅[^4]. The rule exists so that two crates cannot both implement the same trait for the same type ✅[^3]. In the lab, `impl fmt::Display for Vec<u8>` failed with E0117 and the note "define and implement a trait or new type instead", while `impl From<Meters> for f64` compiled because the local `Meters` appears as `T1` with nothing uncovered before it ✅[^1].
10. **Coherence: no overlap.** Two impls overlap when some type could match both; any overlap is rejected ✅[^4]. Next to the blanket `impl<T: Display> Label for T`, an `impl Label for i32` failed with E0119 because `i32: Display` ✅[^1]. The check also accounts for impls other crates may add later: `impl Label for Vec<u8>` failed with E0119 and the note "upstream crates may add a new impl of trait `std::fmt::Display` for type `std::vec::Vec<u8>` in future versions", while `impl Label for Opaque` (a local type without `Display`) compiled, since only this crate could ever give `Opaque` a `Display` impl ✅[^1].
11. **Derive adds bounds.** `#[derive(Clone)]` on a generic struct adds a `T: Clone` bound to the generated impl ✅[^6]. `Shared<T> { inner: Rc<T> }` is clonable for any `T` in principle, yet with the derive, `Shared<NoClone>::clone` failed with E0599 ("the method `clone` exists … but its trait bounds were not satisfied", with the help "consider manually implementing the trait to avoid undesired bounds"); a hand-written `impl<T> Clone for Shared<T>` worked and printed `strong count = 2` ✅[^1].

## Worked example
One program exercising items 1–8 of How it works (lab file `g01_basics.rs`) ✅[^1]:
```rust
use std::fmt::Display;
fn peak<T: PartialOrd + Copy>(xs: &[T]) -> T {
    let mut best = xs[0];
    for &x in xs { if x > best { best = x; } }
    best
}
#[derive(Debug)] struct Span<T> { lo: T, hi: T }
impl<T: PartialOrd> Span<T> { fn holds(&self, x: &T) -> bool { &self.lo <= x && x <= &self.hi } }
impl Span<f64> { fn width(&self) -> f64 { self.hi - self.lo } }
trait Device {
    fn id(&self) -> String;
    fn status_line(&self) -> String { format!("{}: ok", self.id()) }
}
struct Sensor { serial: u32 }
struct Valve { name: String, open: bool }
impl Device for Sensor { fn id(&self) -> String { format!("sensor-{}", self.serial) } }
impl Device for Valve {
    fn id(&self) -> String { self.name.clone() }
    fn status_line(&self) -> String { format!("{}: {}", self.id(), if self.open { "open" } else { "closed" }) }
}
fn report<D>(d: &D) -> String where D: Device { d.status_line() }
fn log_all(items: impl IntoIterator<Item = impl Display>) -> String {
    items.into_iter().map(|i| i.to_string()).collect::<Vec<_>>().join(",")
}
fn evens(limit: u32) -> impl Iterator<Item = u32> { (0..limit).filter(|n| n % 2 == 0) }
trait Shout { fn shout(&self) -> String; }
impl<T: Display + ?Sized> Shout for T { fn shout(&self) -> String { self.to_string().to_uppercase() } }
```
| Call | Output | Feature |
|---|---|---|
| `peak(&[3, 9, 2])`, `peak(&[1.5, -2.0])`, `peak(&['q', 'z', 'a'])` | `9 1.5 'z'` | one generic, three instantiations |
| `Span { lo: 1.0, hi: 4.5 }.holds(&2.0)`, `.width()` | `true`, `3.5` | generic impl plus `f64`-only impl |
| `Span { lo: 'a', hi: 'm' }.holds(&'x')` | `false` | `width` does not exist for `Span<char>` |
| `report(&Sensor { serial: 42 })` | `sensor-42: ok` | default method calling a required one |
| `report(&Valve { name: "v1".into(), open: false })` | `v1: closed` | overridden default |
| `log_all(vec![1, 2, 3])` | `1,2,3` | nested `impl Trait` arguments |
| `evens(9).collect::<Vec<_>>()` | `[0, 2, 4, 6, 8]` | `impl Iterator` return |
| `"hello".shout()`, `3.5.shout()` | `HELLO 3.5` | blanket impl over `Display` |

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Generic body uses `>` with no bound | E0369 even if every call uses `i32` | Bodies are checked against bounds only ✅[^1] |
| `impl Display for Vec<u8>` | E0117 | Foreign trait on a foreign type; wrap it in a newtype (`rust/traits-and-generics/advanced-traits-and-type-system.md`) ✅[^1] ✅[^4] |
| `impl From<Meters> for f64` | Compiles | A local type is a trait parameter and nothing uncovered precedes it ✅[^1] ✅[^4] |
| Blanket `impl<T: Display> Label for T` plus `impl Label for Vec<u8>` | E0119, "upstream crates may add a new impl" | Coherence assumes `std` might add `Display for Vec<u8>` later ✅[^1] |
| Same blanket impl plus `impl Label for Opaque` (local, no `Display`) | Compiles | Only this crate can add `Display for Opaque` ✅[^1] |
| `#[derive(Clone)]` on `Shared<T> { inner: Rc<T> }` | `Shared<NoClone>` is not `Clone` (E0599) | Derive bounds every type parameter; write the impl by hand ✅[^1] ✅[^6] |
| Two return types behind one `impl Display` | E0308 | Return-position `impl Trait` is one concrete type; use `Box<dyn Trait>` for several ✅[^1] ✅[^5] |
| Turbofish on a function whose parameter is `impl Trait` | E0107 | The anonymous parameter cannot be named ✅[^1] |
| Generic function never called | No machine code for it | Instantiation happens on use ✅[^1] |
| Method defined in `impl Span<f64>` called on `Span<char>` | Not found | That impl covers one instantiation only ✅[^2] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Named generic `T: Trait` | Static dispatch and inlining; the caller may write `f::<T>()` | A copy of the body per type, so a larger binary ✅[^7]; one `T` per call |
| `impl Trait` argument | Shortest signature | Callers cannot specify the type; switching to a named parameter later can break them ✅[^5] |
| `dyn Trait` (`rust/traits-and-generics/trait-objects-and-dynamic-dispatch.md`) | One copy of the code; mixed types in one collection | A runtime lookup per call that also blocks inlining ✅[^10] |
| Blanket impl | Every qualifying type gets the trait for free | No specific impl is possible for any type that does or might meet the bound (E0119) ✅[^1] |

## Takeaways
- Put trait bounds on `impl` blocks and functions, not on struct definitions, unless the struct cannot exist without them. [rule-candidate]
- When a derive adds a bound the type does not need (`Rc<T>`, `PhantomData<T>`, `&T` fields), implement the trait by hand. [rule-candidate]
- Read E0369 and E0277 inside generic code as "add the bound the compiler suggests", not as a problem with the caller's type.
- To implement a foreign trait on a foreign type, define a newtype or a local trait; to avoid E0119, prefer impls for concrete types over broad blanket impls in libraries.
- Use `where` clauses once a signature has more than one or two bounds.

## Verification status
- Verified: 50 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `linux/lab-setup.md` — the Rust 1.100.0 lab (`rustlab:1`) where every behaviour marked with this note ran on 2026-11-24. [^1]
- [Generic Data Types](https://doc.rust-lang.org/book/ch10-01-syntax.html) — The Rust Programming Language (Klabnik, Nichols, Krycho and the Rust community), living. Backs: generic functions, structs, enums and methods; concrete-type impls; monomorphization and its zero runtime cost. [^2]
- [Defining Shared Behavior with Traits](https://doc.rust-lang.org/book/ch10-02-traits.html) — The Rust Programming Language, living. Backs: default methods, `where` clauses, `impl Trait` returning a single type, blanket impls and `ToString`, the purpose of the orphan rule. [^3]
- [Implementations](https://doc.rust-lang.org/reference/items/implementations.html) — The Rust Reference, living. Backs: coherence, overlap, the formal orphan rule. [^4]
- [Impl trait type](https://doc.rust-lang.org/reference/types/impl-trait.html) — The Rust Reference, living. Backs: argument-position `impl Trait` as an anonymous type parameter, breaking-change note, return-position single concrete type. [^5]
- [Trait `Clone`](https://doc.rust-lang.org/std/clone/trait.Clone.html) — Rust standard library docs, living. Backs: derive adds a `Clone` bound on generic parameters. [^6]
- [Flexibility](https://rust-lang.github.io/api-guidelines/flexibility.html) — Rust API Guidelines, living. Backs: C-GENERIC, code-size cost of generic functions. [^7]
- [Symbol Mangling](https://doc.rust-lang.org/rustc/symbol-mangling/index.html) — The rustc book, living. Backs: v0 is the stable mangling scheme; legacy only on nightly. [^8]
- [Characteristics of Object-Oriented Languages](https://doc.rust-lang.org/book/ch18-01-what-is-oo.html) — The Rust Programming Language, living. Backs: generics with trait bounds as bounded parametric polymorphism. [^9]
- [Using Trait Objects to Abstract over Shared Behavior](https://doc.rust-lang.org/book/ch18-02-trait-objects.html) — The Rust Programming Language, living. Backs: dynamic dispatch costs a lookup and prevents inlining. [^10]

## Related
- `rust/traits-and-generics/trait-objects-and-dynamic-dispatch.md` — the runtime alternative to generics.
- `rust/traits-and-generics/advanced-traits-and-type-system.md` — associated types, GATs, HRTB, const generics, newtype for the orphan rule.
- `rust/traits-and-generics/core-traits-reference.md` — what each standard trait means and whether it derives.
- `rust/performance/zero-cost-abstractions-and-optimization.md` — monomorphization and code size.
- `rust/design-patterns/idioms-and-api-guidelines.md` — accepting `impl AsRef<T>` and `impl Into<T>` in public APIs.
