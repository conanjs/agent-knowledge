---
schema: topic-index/v1
kind: subtopic
topic: rust/macros
last-updated: 2026-11-24
---

# Macros

Code that writes code at compile time: `macro_rules!` declarative macros (rules, fragment specifiers, repetitions, hygiene, `$crate`, recursion and tt-munchers, scoping, viewing expansions) and procedural macros (derive, attribute and function-like macros, the `proc-macro` crate type, `TokenStream`, `syn` and `quote`, spans and error reporting, compile-time cost). Covers The Rust Programming Language ch 20.5. Not covered: where expansion sits in the compiler pipeline (see `rust/performance/compiler-pipeline-and-compile-times.md`) and serde's derive attributes (see `rust/ecosystem/serde-data-model.md`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [declarative-macros.md](declarative-macros.md) | concept | `macro_rules!` rules and first-match order, fragment specifiers and follow sets, repetitions and trailing commas, mixed-site hygiene and `$crate`, recursion limit and tt-munchers, textual and path scoping, edition-2024 `expr` | verified |
| [procedural-macros.md](procedural-macros.md) | concept | The three kinds of procedural macros, the host-built `proc-macro` crate, `TokenStream` and `Punct` spacing, `syn` and `quote`, `compile_error!` with spans, `quote_spanned!`, call-site versus mixed-site hygiene, measured `syn` build time | verified |

## References
- [Macros](https://doc.rust-lang.org/book/ch20-05-macros.html) — The Rust Programming Language (ch 20.5), Rust project, living. Backs: subtopic scope.
- [Macros By Example](https://doc.rust-lang.org/reference/macros-by-example.html) — The Rust Reference, Rust project, living. Backs: subtopic scope.
- [The Little Book of Rust Macros](https://lukaswirth.dev/tlborm/) — continuation of Daniel Keep's book, living. Backs: subtopic scope.

## Related
- `rust/index.md` — the Rust topic and its other subtopics.
- `rust/ecosystem/serde-data-model.md` — the most common derive macro in practice.
