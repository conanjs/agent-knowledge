---
schema: topic-index/v1
kind: subtopic
topic: rust/traits-and-generics
last-updated: 2026-11-24
---

# Traits and generics

Rust's type-level abstraction tools, from the Book's chapter 10 to the advanced parts of chapters 18 and 20: generic functions and types and how monomorphization turns them into one copy per concrete type; defining and implementing traits, bounds, `impl Trait`, blanket impls and the coherence (orphan and overlap) rules; trait objects, vtables, dyn compatibility, upcasting and `Any`; associated types, operator overloading, fully qualified syntax, supertraits, GATs, higher-ranked bounds, auto traits, `Sized`, the never type, const generics and `async fn` in traits; and a catalog of the core standard-library traits. Every behaviour ran on Rust 1.100.0 (edition 2024). Not covered here: lifetimes (`rust/ownership/`), closure capture and the iterator protocol (`rust/closures-and-iterators/`), API design conventions and typestate (`rust/design-patterns/`), variance and `PhantomData` (`rust/unsafe/`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [generics-and-traits.md](generics-and-traits.md) | concept | Generic functions, structs and enums; monomorphization shown with `nm`; traits, default methods, bounds and `where`; `impl Trait` in both positions; blanket impls; orphan rule (E0117) and overlap (E0119); derive adds bounds | verified |
| [trait-objects-and-dynamic-dispatch.md](trait-objects-and-dynamic-dispatch.md) | concept | `dyn Trait` behind `&`/`Box`/`Rc`/`Arc`, wide pointers and vtables measured, the indirect call in assembly, dyn-compatibility rules (E0038) and `where Self: Sized`, default object lifetimes, upcasting, `Any` and downcasting | verified |
| [advanced-traits-and-type-system.md](advanced-traits-and-type-system.md) | concept | Associated types versus generic parameters, default type parameters and operators, fully qualified syntax, supertraits, newtype for the orphan rule, GATs, HRTB, auto and marker traits, `?Sized`, the never type (stable in 1.100), aliases, const generics, `async fn` in traits, `fn` pointers | verified |
| [core-traits-reference.md](core-traits-reference.md) | reference | Catalog of `Clone`, `Copy`, `Debug`, `Display`, `Default`, comparison, `Hash`, conversion, `Deref`, `Drop`, iterator, `FromStr`, marker and `Fn*` traits: meaning, derivable, laws, owning doc; derive errors measured | verified |

## References
- [Generic Types, Traits, and Lifetimes](https://doc.rust-lang.org/book/ch10-00-generics.html) — The Rust Programming Language (Klabnik, Nichols, Krycho and the Rust community), living. Backs: subtopic scope (chapter 10).
- [Object-Oriented Programming Features](https://doc.rust-lang.org/book/ch18-00-oop.html) — The Rust Programming Language, living. Backs: subtopic scope (chapter 18).
- [Advanced Features](https://doc.rust-lang.org/book/ch20-00-advanced-features.html) — The Rust Programming Language, living. Backs: subtopic scope (chapter 20).
- [Traits](https://doc.rust-lang.org/reference/items/traits.html) — The Rust Reference, living. Backs: subtopic scope.

## Related
- `rust/design-patterns/` — API guidelines, newtype, typestate and builders built on these traits.
- `rust/ownership/lifetimes.md` — lifetime parameters, the other kind of generic parameter.
- `rust/closures-and-iterators/` — the `Fn*` and iterator traits in use.
- `software-design/functional-modeling/types-as-rules.md` — the language-neutral idea behind type-level rules.
