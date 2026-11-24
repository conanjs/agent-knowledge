---
schema: topic-index/v1
kind: subtopic
topic: rust/design-patterns
last-updated: 2026-11-24
---

# Rust design patterns and API conventions

How to shape Rust code and public APIs so they read the way experienced Rust programmers expect and so the compiler enforces as many rules as possible: the Rust API Guidelines' naming, conversion, flexibility and future-proofing conventions, everyday idioms from Rust Design Patterns (RAII guards, `mem::take`, `Cow`, borrowed argument types, sealed traits, `#[must_use]`) and the clippy lints that check them; then type-driven design with newtypes, enums that rule out invalid states, parse-don't-validate types, typestate with zero-sized markers, and builders, including the Book's comparison of a trait-object state pattern with states encoded as types. Every behaviour ran on Rust 1.100.0 (edition 2024). Not covered here: the traits themselves (`rust/traits-and-generics/`), error-type design (`rust/errors/`), concurrency patterns (`rust/concurrency/`), or the language-neutral modelling idea (`software-design/functional-modeling/types-as-rules.md`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [idioms-and-api-guidelines.md](idioms-and-api-guidelines.md) | concept | `as_`/`to_`/`into_` and other naming rules with the clippy lints that enforce them, common traits and conversions, `impl AsRef`/`impl Into` parameters, constructors and `Default`, RAII guards and `DropGuard`, `#[must_use]`, sealed traits, `Cow`, `mem::take`, the `Deref` anti-pattern | verified |
| [type-driven-design.md](type-driven-design.md) | concept | Newtypes with private constructors, enums instead of flag combinations, parse-don't-validate (`NonEmpty`, `NonZeroU32`), typestate with `PhantomData` markers, trait-object state pattern versus typestate, `&mut self` and consuming builders, a typestate builder whose early `build()` does not compile | verified |

## References
- [Rust API Guidelines](https://rust-lang.github.io/api-guidelines/checklist.html) — Rust API Guidelines (authored largely by the Rust library team), living. Backs: subtopic scope (the guideline checklist).
- [Rust Design Patterns](https://rust-unofficial.github.io/patterns/) — rust-unofficial contributors, living. Backs: subtopic scope (idioms, patterns, anti-patterns).
- [Implementing an Object-Oriented Design Pattern](https://doc.rust-lang.org/book/ch18-03-oo-design-patterns.html) — The Rust Programming Language, living. Backs: Book chapter 18.3, mapped to `rust/design-patterns/type-driven-design.md`.

## Related
- `rust/traits-and-generics/` — the traits and generics these patterns are built from.
- `software-design/functional-modeling/types-as-rules.md` — types as business rules, language-neutral.
- `error-handling/library-vs-application-errors.md` — error design for public APIs.
