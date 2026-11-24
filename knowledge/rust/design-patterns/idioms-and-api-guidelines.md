---
schema: knowledge-doc/v1
type: concept
topic: rust/design-patterns
status: verified
applies-to: ["Rust 1.100.0", "edition 2024", "clippy 0.1.100"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [rust, api-guidelines, idioms, naming, conversions, asref, into, default, constructors, raii, dropguard, must-use, sealed-traits, cow, mem-take, clippy]
---

# Rust idioms and the API Guidelines

## Summary
**TL;DR:** The Rust API Guidelines and the Rust Design Patterns book turn "idiomatic Rust" into named, checkable conventions. Method names encode cost and ownership (`as_` is a free borrow, `to_` is costly, `into_` consumes; `iter`/`iter_mut`/`into_iter`; no `get_` prefix). Public types implement the common traits and convert through `From`, `TryFrom` and `AsRef`; functions accept the most general input that works (`impl AsRef<Path>`, `impl Into<String>`, `&str` rather than `&String`) and let the caller decide where data is copied. Constructors are `new`, `with_…` and `from_…`, with `Default` next to `new`; cleanup lives in a `Drop` guard (or `std::mem::DropGuard`, stable since Rust 1.100); results that must not be dropped carry `#[must_use]`; traits outsiders must not implement are sealed; `Cow` skips the allocation when nothing changes; `mem::take` and `mem::replace` move a value out of a `&mut` without cloning. Clippy enforces several of these.
**Use this when:** designing or reviewing a public API, naming a conversion or getter, reading clippy's `new_without_default`, `ptr_arg` or `wrong_self_convention`, adding cleanup that must survive early returns, or planning to add methods to a public trait later.
**Not this doc:** newtypes, typestate and builders → `rust/design-patterns/type-driven-design.md`; what each standard trait promises → `rust/traits-and-generics/core-traits-reference.md`; error-type design → `rust/errors/error-types-thiserror-and-anyhow.md` and `error-handling/library-vs-application-errors.md`; `#[non_exhaustive]` → `rust/data-modeling/enums-and-pattern-matching.md`; `String`, `&str` and `Cow<str>` as string types → `rust/collections/strings-and-utf-8.md`; doc comments → `code-documentation/doc-comments.md`.

## Problem
An API compiles and still trips its users: `to_vec(self)` silently consumes the value, `get_name()` sits next to std's `name()` style, a `&String` parameter rejects a string literal, `Config::new()` exists but `Config::default()` does not, a function returns a new total that callers forget to use, a lock or indent level is not restored on an early `return`, and a public trait cannot gain a method without breaking every downstream impl.

## Mental model
**Analogy:** road signs. A driver reacts to a red octagon without reading the word; a reader of Rust reacts to `into_` ("this consumes"), `as_` ("this is free") or a `#[must_use]` warning the same way. The guidelines are the sign catalogue, and clippy is the inspector who flags a sign of the wrong shape.

**Artifact:** the conversion prefixes ✅[^2] and what clippy said about code that breaks them ✅[^1]:

| Prefix | Cost | Ownership |
|---|---|---|
| `as_` | Free | borrowed → borrowed |
| `to_` | Expensive | borrowed → borrowed, borrowed → owned (non-`Copy`), owned → owned (`Copy`) |
| `into_` | Variable | owned → owned (non-`Copy`) |

```rust
// src/lib.rs (public items)
pub struct Config { pub level: u8 }
impl Config { pub fn new() -> Self { Config { level: 1 } } }      // no Default
pub fn path_len(p: &String) -> usize { p.len() }

// src/main.rs (private items)
struct Meter { level: u8 }
impl Meter { fn into_level(&self) -> u8 { self.level } }   // into_ that only borrows
struct Buffer { data: Vec<u8> }
impl Buffer { fn to_vec(self) -> Vec<u8> { self.data } }   // to_ that consumes a non-Copy type
```
```console
$ cargo clippy -q --bin proj_clippy
warning: you should consider adding a `Default` implementation for `Config`
warning: writing `&String` instead of `&str` involves a new object where a slice will do
warning: methods called `into_*` usually take `self` by value
warning: methods with the following characteristics: (`to_*` and `self` type is not `Copy`) usually take `self` by reference
```
The lints were `clippy::new_without_default`, `clippy::ptr_arg` and `clippy::wrong_self_convention`, all warn-by-default ✅[^1].

## How it works
1. **Names.** Getters drop the `get_` prefix (`owner()`, not `get_owner()`) ✅[^2]. A collection of `U` offers `iter(&self)`, `iter_mut(&mut self)` and `into_iter(self)`, and the returned types are named after them (`Iter`, `IterMut`, `IntoIter`) ✅[^2]; the mechanics are in `rust/closures-and-iterators/iterators.md`. Acronyms are one word in `UpperCamelCase` (`Uuid`) ✅[^2]. Conversions belong on the more specific type, and `to_`/`as_`/`into_` are preferred over `from_` when either fits ✅[^5].
2. **Common traits and conversions.** Public types should eagerly implement `Copy`, `Clone`, `Eq`, `PartialEq`, `Ord`, `PartialOrd`, `Hash`, `Debug`, `Display` and `Default` where they make sense ✅[^3]. Conversions use `From`, `TryFrom`, `AsRef` and `AsMut`; `Into` and `TryInto` come for free from blanket impls and are never implemented directly ✅[^3]. Collections implement `FromIterator` and `Extend`, and types are `Send` and `Sync` where possible ✅[^3].
3. **Flexible, caller-controlled parameters.** The fewer assumptions a function makes about its inputs, the more callers it serves: take `impl IntoIterator<Item = T>` rather than `&[T]` when you only iterate, and `AsRef<Path>` like `File::open` does ✅[^4]. Take ownership only when the function needs it (instead of borrowing and cloning inside), and borrow otherwise ✅[^4]. Prefer the borrowed type over a borrow of the owned type: `&str` over `&String`, `&[T]` over `&Vec<T>`, `&T` over `&Box<T>` ✅[^12].
4. **Constructors and `Default`.** Constructors are static inherent methods; the primary one is `new`, variants are `with_…` or `from_…` ✅[^5]. Clippy warns when a public no-argument `new` has no matching `Default` impl ✅[^1]. The standard `Default` trait lets callers write `..Default::default()` in struct literals ✅[^16].
5. **RAII guards.** Acquire in a constructor, release in `Drop` ✅[^8]. In the lab, an `Indent` guard that increments a depth counter on creation and decrements it in `drop` left the counter at 0 both after an early `return Err(..)` and after a panic caught with `catch_unwind` ✅[^1]. Rust 1.100 stabilized `std::mem::DropGuard`, which wraps a value and runs a closure when dropped; `DropGuard::dismiss(g)` returns the value without running the closure and is preferred over `mem::forget` ✅[^9] ✅[^17]. The lab run printed `["work", "cleanup ran"] dismissed value=5` ✅[^1].
6. **`#[must_use]`.** It applies to functions, structs, enums, unions and traits; an unused value then triggers the `unused_must_use` lint, optionally with a message, and `let _ = …` is the idiomatic explicit discard ✅[^7]. The lab saw: `unused return value of `add_tax` that must be used` with the custom note, `unused `Ticket` that must be used` for a `#[must_use]` struct, `unused `Result` that must be used`, `unused return value of `clone`` ("cloning is often expensive and is not expected to have side effects"), and `unused `Map` that must be used` ("iterators are lazy and do nothing unless consumed") ✅[^1].
7. **Sealed traits.** A public trait with a supertrait from a private module cannot be implemented downstream, because the supertrait cannot be named, so the crate can add methods later without a breaking release ✅[^6]. In the lab, `impl fmtlib::Format for Yaml` outside the module failed with E0277 and the note "`Format` is a "sealed trait", because to implement it you also need to implement `fmtlib::private::Sealed`, which is not accessible"; naming `fmtlib::private::Sealed` directly failed with E0603 "module `private` is private" ✅[^1]. Calling the sealed trait's methods from outside still works ✅[^1].
8. **`Cow` for "usually borrowed".** `Cow` holds either borrowed or owned data and clones lazily when mutation or ownership is needed ✅[^14]. `fn normalize(s: &str) -> Cow<'_, str>` returned `Borrowed` for `"plain"` and `Owned` for `"has space"` (see the worked example) ✅[^1].
9. **`mem::take` and `mem::replace`.** To change an enum variant through `&mut` while keeping its owned field, take the field out and leave a default behind, instead of cloning it ✅[^10] ✅[^11]. In the lab, `Upload::Pending { chunks }` became `Upload::Done { chunks: ["ab", "cde"], bytes: 5 }` with `mem::take(chunks)`, and `mem::replace(&mut name, "new")` returned the old `"old"` ✅[^1].
10. **Anti-pattern: `Deref` as inheritance.** Implementing `Deref` so a wrapper "inherits" its field's methods surprises readers, gives no real subtyping (the inner type's traits do not follow) and is not what `Deref` is for ✅[^13]; only smart pointers should implement `Deref` ✅[^5].

## Worked example
A constructor that accepts anything string-like and path-like, a getter without `get_`, and a `Cow` return that allocates only when needed (lab file `i01_conversions.rs`) ✅[^1]:
```rust
use std::borrow::Cow;
use std::path::{Path, PathBuf};
struct Account { owner: String, home: PathBuf }
impl Account {
    fn new(owner: impl Into<String>, home: impl AsRef<Path>) -> Self {
        Account { owner: owner.into(), home: home.as_ref().join("data") }
    }
    fn owner(&self) -> &str { &self.owner }
}
fn normalize(s: &str) -> Cow<'_, str> {
    if s.contains(' ') { Cow::Owned(s.replace(' ', "_")) } else { Cow::Borrowed(s) }
}
fn main() {
    let a = Account::new("mia", "/home/mia");
    let b = Account::new(String::from("li"), PathBuf::from("/srv"));
    println!("{} {:?} {} {:?}", a.owner(), a.home, b.owner(), b.home);
    for s in ["plain", "has space"] {
        let n = normalize(s);
        println!("{:?} -> {} ({})", s, n, if matches!(n, Cow::Borrowed(_)) { "borrowed" } else { "owned" });
    }
}
```
```console
mia "/home/mia/data" li "/srv/data"
"plain" -> plain (borrowed)
"has space" -> has_space (owned)
```
| Call | Input types | What happened |
|---|---|---|
| `Account::new("mia", "/home/mia")` | `&str`, `&str` | `Into<String>` allocated the owner; `AsRef<Path>` viewed the literal as a path |
| `Account::new(String::from("li"), PathBuf::from("/srv"))` | `String`, `PathBuf` | `into()` moved the existing `String`, no second allocation |
| `normalize("plain")` | no space | `Cow::Borrowed`: no allocation |
| `normalize("has space")` | one space | `Cow::Owned("has_space")`: one allocation |

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `pub fn into_level(&self)` on a public type | No `wrong_self_convention` warning; the same method on a private type is flagged | Clippy's `avoid-breaking-exported-api` (default `true`) suppresses that lint on exported items ✅[^1] ✅[^15] |
| `let _ = save();` or `_ = save();` | No warning | The idiomatic explicit discard ✅[^1] ✅[^7] |
| Guard passed to `mem::forget` | Its cleanup never runs: only `cleanup b` printed for guards `a` (forgotten) and `b` (dropped) | Leaking is safe Rust; see `rust/unsafe/memory-layout-and-repr.md` ✅[^1] |
| `DropGuard::dismiss(g)` | Returns the value; closure skipped, its captures dropped | Preferred over `mem::forget` ✅[^9] |
| Downstream impl of a sealed trait | E0277 with a "sealed trait" note | The private supertrait is unreachable ✅[^1] ✅[^6] |
| `&String` parameter called with a literal | Does not compile; `&str` accepts both | Deref coercion goes `&String` → `&str`, not back ✅[^12] |
| Wrapper with `Deref` to its field | Methods appear, traits do not | `Deref` is not subtyping ✅[^13] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `impl AsRef<Path>` / `impl Into<String>` parameters | Callers pass any compatible type | One instantiation per argument type; bigger code ✅[^4] |
| Concrete `&Path` / `String` parameters | One copy of the code; simpler errors | Callers convert by hand |
| Returning `Cow<'_, str>` | No allocation on the common path | A lifetime in the signature; callers match or deref |
| Sealed public trait | Free to add methods later | Users cannot implement it for their own types |
| `Drop` guard | Cleanup on every exit path, panics included ✅[^1] | Hidden control flow; skipped by `mem::forget` ✅[^1] |

## Takeaways
- Name conversions by cost and ownership: `as_` borrows for free, `to_` borrows and may allocate, `into_` consumes. [rule-candidate]
- Accept `&str`, `&[T]`, `impl AsRef<…>` or `impl Into<…>` instead of `&String`, `&Vec<T>` or a forced `String`. [rule-candidate]
- Pair every public no-argument `new()` with `Default`. [rule-candidate]
- Mark pure functions whose result is the point, and handles that must be used, with `#[must_use = "…"]`. [rule-candidate]
- Seal public traits that only your crate should implement.
- Put cleanup in a guard's `Drop` (or `DropGuard`) rather than before each `return`.
- Do not implement `Deref` to emulate inheritance; forward the methods you need. [rule-candidate]

## Verification status
- Verified: 47 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `linux/lab-setup.md` — the Rust 1.100.0 lab (`rustlab:1`) where every behaviour marked with this note ran on 2026-11-24. [^1]
- [Naming](https://rust-lang.github.io/api-guidelines/naming.html) — Rust API Guidelines, living. Backs: C-CASE, C-CONV prefixes table, C-GETTER, C-ITER, C-ITER-TY. [^2]
- [Interoperability](https://rust-lang.github.io/api-guidelines/interoperability.html) — Rust API Guidelines, living. Backs: C-COMMON-TRAITS, C-CONV-TRAITS, C-COLLECT, C-SEND-SYNC. [^3]
- [Flexibility](https://rust-lang.github.io/api-guidelines/flexibility.html) — Rust API Guidelines, living. Backs: C-GENERIC, C-CALLER-CONTROL, code-size cost. [^4]
- [Predictability](https://rust-lang.github.io/api-guidelines/predictability.html) — Rust API Guidelines, living. Backs: C-CTOR, C-CONV-SPECIFIC, C-DEREF. [^5]
- [Future proofing](https://rust-lang.github.io/api-guidelines/future-proofing.html) — Rust API Guidelines, living. Backs: C-SEALED. [^6]
- [Diagnostic attributes: `must_use`](https://doc.rust-lang.org/reference/attributes/diagnostics.html#the-must_use-attribute) — The Rust Reference, living. Backs: where `must_use` applies, the lint, the message, `let _ =`. [^7]
- [RAII Guards](https://rust-unofficial.github.io/patterns/patterns/behavioural/RAII.html) — Rust Design Patterns, living. Backs: initialise in the constructor, finalise in the destructor. [^8]
- [Struct `DropGuard`](https://doc.rust-lang.org/std/mem/struct.DropGuard.html) — Rust standard library docs, living. Backs: `DropGuard::new`, `dismiss` versus `mem::forget`, stable in 1.100.0. [^9]
- [mem::{take(_), replace(_)}](https://rust-unofficial.github.io/patterns/idioms/mem-replace.html) — Rust Design Patterns, living. Backs: keeping owned values when changing an enum, avoiding clones. [^10]
- [Function `std::mem::take`](https://doc.rust-lang.org/std/mem/fn.take.html) — Rust standard library docs, living. Backs: replace with the default and return the old value. [^11]
- [Use borrowed types for arguments](https://rust-unofficial.github.io/patterns/idioms/coercion-arguments.html) — Rust Design Patterns, living. Backs: `&str` over `&String`, `&[T]` over `&Vec<T>`, `&T` over `&Box<T>`. [^12]
- [Deref Polymorphism](https://rust-unofficial.github.io/patterns/anti_patterns/deref.html) — Rust Design Patterns, living. Backs: why `Deref` as inheritance is an anti-pattern. [^13]
- [Enum `Cow`](https://doc.rust-lang.org/std/borrow/enum.Cow.html) — Rust standard library docs, living. Backs: clone-on-write behaviour. [^14]
- [Lint Configuration](https://doc.rust-lang.org/clippy/lint_configuration.html) — Clippy documentation, living. Backs: `avoid-breaking-exported-api`, default `true`, covers `wrong_self_convention`. [^15]
- [Trait `Default`](https://doc.rust-lang.org/std/default/trait.Default.html) — Rust standard library docs, living. Backs: `..Default::default()` in struct literals. [^16]
- [Announcing Rust 1.100.0](https://blog.rust-lang.org/2026/11/12/Rust-1.100.0/) — The Rust Release Team, 2026. Backs: `core::mem::DropGuard` stabilized. [^17]

## Related
- `rust/design-patterns/type-driven-design.md` — newtype, typestate and builders.
- `rust/traits-and-generics/core-traits-reference.md` — the traits C-COMMON-TRAITS lists.
- `rust/traits-and-generics/generics-and-traits.md` — the generics behind `impl AsRef<…>` parameters.
- `rust/smart-pointers/box-deref-and-drop.md` — `Drop` and deref coercion.
- `error-handling/library-vs-application-errors.md` — error types in public APIs.
