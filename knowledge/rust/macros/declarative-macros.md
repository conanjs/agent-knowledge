---
schema: knowledge-doc/v1
type: concept
topic: rust/macros
status: verified
applies-to: ["Rust 1.100.0", "edition 2024"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [rust, macros, macro-rules, hygiene, tt-muncher, fragment-specifiers, metaprogramming]
---

# Declarative macros (`macro_rules!`)

## Summary
**TL;DR:** A `macro_rules!` macro is an ordered list of rules, each a pattern over token trees plus a template. At expansion time the compiler tries the rules top to bottom, captures typed fragments (`$x:expr`, `$t:ty` …) and splices them into the template as whole syntax nodes, not text. Hygiene keeps the macro's own local variables and labels apart from the caller's, but functions, types and paths resolve where the macro is called, so an exported macro reaches its own crate through `$crate::`.
**Use this when:** writing or debugging a `macro_rules!`; reading errors such as "`$e:expr` is followed by `=`", "recursion limit reached", "local ambiguity" or "not accessible due to macro hygiene"; choosing between a declarative macro, a procedural macro and a generic function.
**Not this doc:** derive, attribute and function-like procedural macros → `rust/macros/procedural-macros.md`; where expansion sits among the compiler passes → `rust/performance/compiler-pipeline-and-compile-times.md`; module paths and `pub(crate) use` in general → `rust/project-structure/packages-crates-and-modules.md`.

## Problem
Some repetition cannot be written as a function: a variable number of arguments, generating items (impls for ten integer types), or taking an identifier that becomes a variable name. Macros fill that gap, but trial and error produces confusing failures: a general rule placed first swallows input meant for a later rule, an `expr` fragment cannot be followed by `=`, a captured expression no longer matches a literal in a second macro, a recursive macro hits the recursion limit, a `let` written in the macro is invisible to the caller, and a macro that works in its own crate breaks in another one.

## Mental model
**Analogy:** a stencil machine. Each rule is a stencil with a shape cut out (the matcher). The machine tries stencils in order and uses the first one the input fits; the pieces the holes captured are pasted into a printed form (the transcriber). Each pasted piece is a laminated card (a syntax node), so `1 + 1` stays one card and is never split by surrounding operators. Notes the form writes for itself (its local variables) are in ink the caller cannot read (hygiene).

**Artifact:** a list macro with a repetition, an optional trailing comma and an empty rule, run in Rust 1.100.0 ✅[^1]:
```rust
macro_rules! squares {
    () => { Vec::<i64>::new() };
    ($($x:expr),+ $(,)?) => {{
        let mut v = Vec::new();
        $( v.push($x * $x); )+
        v
    }};
}
// squares![1, 2, 3] → [1, 4, 9]   squares![4, 5,] → [16, 25]   squares![] → []
// squares![1 + 1]   → [4]  (not 1 + 1*1 + 1 = 3)
```
`rustc +nightly -Zunpretty=expanded` shows why the last line is 4: the captured expression is inserted as one node, printed with parentheses ✅[^1] ✅[^11]:
```rust
{ let mut v = Vec::new(); v.push((1 + 1) * (1 + 1)); v }
```

## How it works
Four actors take part, all inside the compiler: macros are expanded before the compiler interprets the meaning of the code, so nothing of this runs at program run time ✅[^2].
- **Parser** — its job: turn the source into token trees and keep each `name!(…)` call unparsed, via delimiter matching of `()`, `[]` and `{}`.
- **Macro expander** — its job: pick the rule to use, via trying the rules in source order.
- **Fragment parsers** — their job: turn each `$name:spec` capture into a syntax node, via the ordinary Rust parser for that kind (expression, type, pattern …).
- **Transcriber and name resolution** — their job: splice captures into the template and resolve every name, via the syntax context (hygiene tag) carried by each identifier.

```
source ──▶ [Parser] token trees ──▶ [Expander] rule 1? rule 2? … first fit
                                         │ for each $x:spec
                                         ▼
                                  [Fragment parser] ──▶ opaque node
                                         │
                                         ▼
           [Transcriber] template + nodes ──▶ new syntax ──▶ contains name!(…)?
                                         ▲                         │ yes (depth + 1, limit 128)
                                         └─────────────────────────┘
                                                   no ──▶ [Name resolution with hygiene]
```

1. **Parser — token trees.** A token tree is one token or a delimited group with everything inside it. `count_tts!(x += (a b) [c] 7)` counts 5 trees: `x`, `+=`, `(a b)`, `[c]`, `7` ✅[^1] ✅[^3].
2. **Expander — first matching rule, no backtracking.**
   - Rules are tried in order and the first match is transcribed; if that transcription fails, later rules are not tried ✅[^3].
   - Once a fragment parser starts consuming tokens it cannot give them back: with `($e:expr)` before `($i:ident +)`, the call `classify!(a +)` fails with `error: expected expression, found end of macro arguments`; putting the specific rule first makes it print `ident then plus` ✅[^1] ✅[^10]. Order rules from most specific to most general ✅[^10].
   - Two ways to match the same tokens are an error: `($($a:ident)* $b:ident)` called with `x y z` gives `error: local ambiguity when calling macro` ✅[^1] ✅[^3].
3. **Fragment parsers — specifiers and what may follow them.**

   | Specifier | Matches | May be followed by |
   |---|---|---|
   | `expr` | an expression; in edition 2024 also `const { … }` and `_` | `=>` `,` `;` |
   | `expr_2021` | an expression without top-level `const` blocks and `_` | `=>` `,` `;` |
   | `stmt` | a statement without its trailing `;` | `=>` `,` `;` |
   | `pat` / `pat_param` | a pattern; since edition 2021 `pat` includes top-level `a \| b`, `pat_param` does not | `=>` `,` `=` `if` `in` (`pat_param` also `\|`) |
   | `ty`, `path` | a type, a type path | `=>` `,` `=` `\|` `;` `:` `>` `>>` `[` `{` `as` `where`, a `block` capture |
   | `vis` | a visibility, possibly empty | `,`, a non-`priv` identifier, a type start, an `ident`/`ty`/`path` capture |
   | `ident`, `lifetime`, `literal`, `block`, `item`, `meta`, `tt` | identifier, lifetime, literal (with optional `-`), block, item, attribute content, one token tree | anything |

   The table is from the Reference ✅[^3]. The follow rules exist so future syntax cannot change how today's macro input is split ✅[^10]. Breaking one is a definition-time error: `($target:expr = $value:expr)` gives `` error: `$target:expr` is followed by `=`, which is not allowed for `expr` fragments `` with ``note: allowed there are: `=>`, `,` or `;` `` ✅[^1]. A capture is opaque once parsed: forwarding `$e:expr` holding `0` into a macro whose rule is the literal `(0)` falls through to its catch-all, while forwarding `$t:tt` matches the literal; only `ident`, `lifetime` and `tt` captures can be matched again by literal tokens ✅[^1] ✅[^3].
4. **Repetitions.** `$( … ) sep op` repeats with `*` (zero or more), `+` (one or more) or `?` (zero or one, no separator) ✅[^3]. `$(,)?` is the usual trailing-comma rule (the artifact accepts `squares![4, 5,]`) ✅[^1]. Variables used in one template repetition must have captured the same number of fragments: `bind_all!(a, b; 1)` gives `` error: meta-variable `name` repeats 2 times, but `value` repeats 1 time `` ✅[^1] ✅[^3].
5. **Transcriber — nodes, not text.** The output is parsed as whatever the call position expects (expression, statements, items), and captured fragments go in as single nodes, which is why `squares![1 + 1]` squares 2 ✅[^1] ✅[^11].
6. **Name resolution — mixed-site hygiene.** Local variables, labels and `$crate` resolve at the macro definition; everything else (functions, types, modules, other macros) resolves at the call site ✅[^3] ✅[^7].
   - A `let total = $e;` inside the macro does not clash with the caller's `total`: `sum_twice!(total * 2)` with a caller `total = 10` returns 40 and leaves the caller's variable at 10 ✅[^1].
   - A macro-local `let count = 3;` is unreadable by the caller: `` error[E0425]: cannot find value `count` in this scope `` with `help: … not accessible due to macro hygiene`; the fix is to take the name as an `$name:ident` argument ✅[^1] ✅[^7].
   - Items are not hygienic: a `fn helper()` generated by a macro is callable by the caller ✅[^1] ✅[^7].
   - `$crate` expands to a path to the defining crate, so `$crate::conv::km_to_m($km)` works from any crate; the same macro written as `conv::km_to_m($km)` fails in the calling crate with `` error[E0433]: cannot find module or crate `conv` in this scope `` ✅[^1] ✅[^3]. `$crate` does not bypass privacy ✅[^3].
7. **Recursion.** Expansion repeats until no macro calls remain, with a crate-wide depth limit of 128 by default ✅[^4] ✅[^11]. Peeling one token per step on 200 tokens fails with ``error: recursion limit reached while expanding `count_tts!` `` and the hint to add `#![recursion_limit = "256"]`, which then prints 200 ✅[^1]. Every recursive step counts against the limit because there is no tail-call shortcut ✅[^8].
8. **Scoping.**
   - Textual scope, like a `let`: a macro is usable after its definition, so calling `double!` above its `macro_rules!` gives ``error: cannot find macro `double` in this scope`` with "a macro with the same name exists, but it appears later" ✅[^1] ✅[^3].
   - `#[macro_export]` puts the macro at the crate root for path-based use (`units::meters!`), with `pub` visibility ✅[^3] ✅[^2]. Inside one crate, `pub(crate) use clamp_pct;` after the definition gives a path (`crate::util::clamp_pct!`) without exporting it (ran: `42 100`) ✅[^1] ✅[^3].

**Viewing expansions.** `rustc +nightly -Zunpretty=expanded file.rs` (or `cargo +nightly rustc -- -Zunpretty=expanded`) prints the expanded crate ✅[^1]. `#![feature(trace_macros)]` with `trace_macros!(true)` prints each step as `expanding … to …` ✅[^12] ✅[^1].

## Worked example
A tt-muncher (a recursive macro that consumes its input from the front, one statement per step, carrying the output so far in an accumulator) ✅[^8]:
```rust
macro_rules! config {
    (@acc [$($done:expr),*]) => { vec![$($done),*] };
    (@acc [$($done:expr),*] set $k:ident = $v:expr; $($rest:tt)*) => {
        config!(@acc [$($done,)* (stringify!($k), $v.to_string())] $($rest)*)
    };
    (@acc [$($done:expr),*] unset $k:ident; $($rest:tt)*) => {
        config!(@acc [$($done,)* (stringify!($k), String::from("<unset>"))] $($rest)*)
    };
    ($($input:tt)*) => { config!(@acc [] $($input)*) };
}
let cfg: Vec<(&str, String)> = config! { set host = "db.local"; set port = 5432; unset password; };
```
`trace_macros!` recorded these steps ✅[^1]:

| Step | Rule used | Accumulator after | Input left |
|---|---|---|---|
| 1 | catch-all `($($input:tt)*)` | `[]` | `set host … unset password;` |
| 2 | `@acc … set` | `[("host", …)]` | `set port = 5432; unset password;` |
| 3 | `@acc … set` | `[("host", …), ("port", …)]` | `unset password;` |
| 4 | `@acc … unset` | three entries | nothing |
| 5 | `(@acc [...])` base case | — | expands to `vec![…]` |

Output: `[("host", "db.local"), ("port", "5432"), ("password", "<unset>")]` ✅[^1]. The `@acc` prefix is a literal token marking the internal rules. The public catch-all must stay last: moved to the top, it also captures every internal `config!(@acc …)` call and the build stops with ``recursion limit reached while expanding `config!` `` ✅[^1]. Each step re-matches the whole remaining input, so long inputs cost quadratic compile time ✅[^8].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| General rule before a specific one | `expected expression, found end of macro arguments` | Fragment parsers do not backtrack ✅[^1] ✅[^10] |
| `$e:expr` followed by `=` or `{` | Error at the macro definition | Follow-set rule for `expr` ✅[^1] ✅[^3] |
| `($x)` with no specifier | `error: missing fragment specifier`, in edition 2024 and in 2021 | A hard error in every edition since Rust 1.89 ✅[^1] ✅[^6] |
| `which!(const { 1 })` with rules `($e:expr)` then `(const $b:block)` | Edition 2024: first rule; edition 2021: second rule | 2024 `expr` matches `const` blocks and `_`; `expr_2021` keeps the old meaning ✅[^1] ✅[^5] |
| `cargo fix --edition` to 2024 | Rewrites `expr` to `expr_2021` | Lint `edition_2024_expr_fragment_specifier` keeps old behaviour; revert where the new one is wanted ✅[^5] |
| Forwarded `$e:expr` matched against a literal | Never matches | Captures are opaque except `ident`, `lifetime`, `tt` ✅[^1] ✅[^3] |
| Macro-local `let` read by caller | E0425 with a hygiene hint | Locals resolve at the definition site ✅[^1] ✅[^7] |
| Macro-generated `fn` or `struct` | Visible to the caller, can collide with caller names | Items are not hygienic ✅[^1] ✅[^7] |
| Exported macro calling a helper by bare path | E0433 in the calling crate | Paths resolve at the call site; use `$crate::` ✅[^1] ✅[^3] |
| Counting 200 tokens by recursion | Recursion limit (128) reached | One expansion level per token ✅[^1] ✅[^4] |
| Counting with `<[()]>::len(&[$(replace_with_unit!($t)),*])` | Prints 200 with the default limit | Flat expansion, no recursion ✅[^1] ✅[^9] |
| `1usize + …` sum over hundreds of tokens | Deep, unbalanced expression tree; The Little Book of Rust Macros reports a likely compiler crash near 500 tokens | Each `+` nests one level ✅[^9] |
| Macro called above its definition | "cannot find macro", "it appears later" | Textual scope ✅[^1] ✅[^3] |
| A rule that rejects bad input with `compile_error!(concat!(…, stringify!($other)))` | Custom message such as `port! expects a number literal, got: http`, located at the rule with "in this macro invocation" under the call | The error takes the span of the template tokens, not of the bad argument ✅[^1] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Generic function or trait | Type-checked once, readable, no expansion | Fixed arity; cannot create items or take identifiers |
| `macro_rules!` | Same crate, no dependencies; variadic input; can create items and take identifiers | Pattern language only; errors appear at expansion; harder to read and maintain than a function ✅[^2] |
| Procedural macro (`rust/macros/procedural-macros.md`) | Full parsing of items, custom diagnostics | Separate crate, extra compile time |

## Takeaways
- Order rules from most specific to most general; put a catch-all last. [rule-candidate]
- End list rules with `$(,)?` so callers may write a trailing comma. [rule-candidate]
- In an exported macro, reach every item of your crate through `$crate::…`, and std items through `::std::…` or `::core::…`. [rule-candidate]
- Take identifiers the caller must see as `$name:ident` arguments instead of inventing them in the template.
- Prefix internal rules with a literal marker such as `@acc` and keep the public catch-all last.
- Prefer flat repetitions over recursion; when a muncher is needed, keep the input short or raise `recursion_limit` knowingly.
- Inspect expansions with `-Zunpretty=expanded` or `trace_macros!` before guessing.

## Verification status
- Verified: 77 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `linux/lab-setup.md` — the Rust 1.100.0 lab (`rustlab:1`) where every behaviour marked with this note ran on 2026-11-24. [^1]
- [Macros](https://doc.rust-lang.org/book/ch20-05-macros.html) — The Rust Programming Language (ch 20.5), Rust project, living. Backs: macros versus functions, `#[macro_export]`, trade-offs. [^2]
- [Macros By Example](https://doc.rust-lang.org/reference/macros-by-example.html) — The Rust Reference, Rust project, living. Backs: rule order, fragment specifiers, follow sets, opaque forwarding, repetitions, hygiene, `$crate`, scoping. [^3]
- [Limits](https://doc.rust-lang.org/reference/attributes/limits.html) — The Rust Reference, Rust project, living. Backs: `recursion_limit`, default 128. [^4]
- [Macro Fragment Specifiers](https://doc.rust-lang.org/edition-guide/rust-2024/macro-fragment-specifiers.html) — The Rust Edition Guide, Rust project, living. Backs: edition-2024 `expr`, `expr_2021`, migration lint. [^5]
- [Missing macro fragment specifiers](https://doc.rust-lang.org/edition-guide/rust-2024/missing-macro-fragment-specifiers.html) — The Rust Edition Guide, Rust project, living. Backs: hard error in all editions since 1.89. [^6]
- [Hygiene](https://lukaswirth.dev/tlborm/decl-macros/minutiae/hygiene.html) — The Little Book of Rust Macros, living. Backs: mixed hygiene, items not hygienic, `$crate`. [^7]
- [Incremental TT Munchers](https://lukaswirth.dev/tlborm/decl-macros/patterns/tt-muncher.html) — The Little Book of Rust Macros, living. Backs: tt-muncher pattern, recursion limit, quadratic cost. [^8]
- [Counting](https://lukaswirth.dev/tlborm/decl-macros/building-blocks/counting.html) — The Little Book of Rust Macros, living. Backs: counting techniques and their limits. [^9]
- [Metavariables and Expansion Redux](https://lukaswirth.dev/tlborm/decl-macros/minutiae/metavar-and-expansion.html) — The Little Book of Rust Macros, living. Backs: no backtracking, rule order, follow-set rationale. [^10]
- [Expansion](https://lukaswirth.dev/tlborm/syntax-extensions/expansion.html) — The Little Book of Rust Macros, living. Backs: expansion produces syntax nodes, recursion limit. [^11]
- [trace_macros](https://doc.rust-lang.org/unstable-book/library-features/trace-macros.html) — The Rust Unstable Book, Rust project, living. Backs: tracing expansions on nightly. [^12]

## Related
- `rust/macros/procedural-macros.md` — derive, attribute and function-like macros.
- `rust/performance/compiler-pipeline-and-compile-times.md` — where macro expansion happens.
- `rust/project-structure/packages-crates-and-modules.md` — paths, `use` and visibility.
