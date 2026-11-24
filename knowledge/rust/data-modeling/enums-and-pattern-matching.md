---
schema: knowledge-doc/v1
type: concept
topic: rust/data-modeling
status: verified
applies-to: ["Rust 1.100.0", "edition 2024"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [rust, enum, option, match, exhaustiveness, if-let, let-else, while-let, let-chains, patterns, refutability, match-ergonomics, binding-modes, non-exhaustive]
---

# Enums and pattern matching

## Summary
**TL;DR:** An enum is a type whose value is exactly one of its **variants**, and each variant can carry its own data (none, a tuple, or named fields). `Option<T>` (`Some(T)` or `None`) is how Rust says "maybe absent" instead of null, and the compiler will not let you use an `Option<i32>` as an `i32`. `match` tries its arms in order and must be **exhaustive**: a missing case is error E0004, which names it, and arms with guards do not count. `if let`, `let … else` (whose `else` must leave the scope) and `while let` handle one pattern; edition 2024 adds **let chains** (`if let Some(a) = age && a >= 18`). Patterns combine literals, `|`, ranges, destructuring, `_`, `..`, `@` bindings, guards and slices. Matching a reference with a non-reference pattern makes the bindings references (**match ergonomics**); edition 2024 forbids writing `mut`, `ref` or `&` inside such a pattern. `#[non_exhaustive]` makes other crates add a wildcard arm.
**Use this when:** you model "one of several kinds" data, handle an `Option` or `Result`, read E0004, E0005 or a 2024 "implicitly-borrowing pattern" error, or wonder why a binding is `&String` instead of `String`.
**Not this doc:** structs and `impl` blocks → `rust/data-modeling/structs-and-methods.md`; `Result`, `?` and error types → `rust/errors/panic-result-and-error-propagation.md` and `error-handling/result-type.md`; niche layout (`Option<&T>` is pointer-sized) → `rust/unsafe/memory-layout-and-repr.md`; making illegal states unrepresentable → `rust/design-patterns/type-driven-design.md`; moves caused by bindings → `rust/ownership/ownership-moves-and-drop.md`.

## Problem
Code from languages with null and `switch` meets new rules: an `Option` cannot be added to a number, a `match` without one variant does not compile, and a name in a pattern does not compare against a variable of that name but creates a new one. `if let Some(_n) = note` moves the string out while `if let Some(_) = note` does not. Code that compiled in edition 2021 (`let (mut a, b) = pair;` on a reference) is rejected in 2024.

## Mental model
**Analogy:** an enum value is a parcel with a label saying which kind of item is inside, and what sits inside depends on the label. `match` is a sorting desk with one chute per label; the inspector (the compiler) will not open the desk until every label has a chute. A pattern is a stencil laid over the value: where the stencil has a name, that part of the value is captured under that name.

**Artifact:** one enum, four variant shapes, one exhaustive `match` (lab, Rust 1.100.0) ✅[^1]:
```rust
#[derive(Debug)]
enum Command {
    Quit,                          // unit variant
    Move { dx: i32, dy: i32 },     // struct-like variant
    Say(String),                   // tuple variant
    Paint(u8, u8, u8),
}

impl Command {
    fn cost(&self) -> u32 {
        match self {
            Command::Quit => 0,
            Command::Move { dx, dy } => (dx.abs() + dy.abs()) as u32,
            Command::Say(text) => text.len() as u32,
            Command::Paint(..) => 5,
        }
    }
}

fn main() {
    let script = [Command::Move { dx: 3, dy: -4 }, Command::Say(String::from("héllo")), Command::Paint(255, 0, 0), Command::Quit];
    for c in &script { println!("{c:?} costs {}", c.cost()); }
}
```
```text
Move { dx: 3, dy: -4 } costs 7
Say("héllo") costs 6
Paint(255, 0, 0) costs 5
Quit costs 0
```
`"héllo"` costs 6 because `len()` counts UTF-8 bytes (see `rust/collections/strings-and-utf-8.md`).

## How it works
1. **Variants and data.** Each variant may hold different types and amounts of data, and each variant name also works as a constructor (`Command::Say(String::from("x"))`) ✅[^2] ✅[^11]. Enums take `impl` blocks like structs ✅[^2]. A field-less enum can be cast to its discriminant: with `enum Level { Low = 1, Mid = 5, High = 10 }`, `Level::High as u8` is 10; unspecified discriminants start at 0 and add 1 ✅[^11] ✅[^1]. On aarch64 the lab measured `Command` at 24 bytes, `Level` at 1, `Option<i32>` at 8 and `Option<u8>` at 2 ✅[^1]; the layout rules are owned by `rust/unsafe/memory-layout-and-repr.md`.
2. **`Option<T>` instead of null.** `Option`, `Some` and `None` are in the prelude ✅[^2]. Because `Option<i32>` and `i32` are different types, `base + extra` with `extra: Option<i32>` fails with E0277 "cannot add `Option<i32>` to `i32`" ✅[^2] ✅[^1]. You get the value out by matching or with a method: `Some(8).map(|n| n * 10)` is `Some(80)`, `None.unwrap_or(-1)` is `-1` ✅[^1].
3. **`match`.**
   - The scrutinee (the value after `match`) is compared with each arm's pattern in order; the first arm whose pattern matches, and whose guard is true, runs ✅[^9] ✅[^3].
   - Every possible value must be covered ✅[^3]. Leaving out `Light::Amber` gives `error[E0004]: non-exhaustive patterns: Light::Amber not covered`; for an `Option<u8>` covered only by `Some(0)`, `Some(1..=9)` and `None`, the message names the gap exactly: `Some(10_u8..=u8::MAX) not covered` ✅[^1].
   - A catch-all is either a name (`other => …`, which binds the value) or `_` (which does not) ✅[^3]. It must come last: an arm after `_` triggers `warning: unreachable pattern` ✅[^3] ✅[^1].
   - Each arm is an expression, and all arms must have one type; `_ => ()` does nothing ✅[^3].
4. **One-pattern forms.**
   - `if let PAT = EXPR { … } else { … }` is a `match` with one interesting arm; it gives up the exhaustiveness check ✅[^4] ✅[^5].
   - `let PAT = EXPR else { … };` binds in the surrounding scope, and its `else` must diverge (`return`, `break`, `continue`, `panic!`). An `else` that just prints fails with E0308 "`else` clause of `let...else` does not diverge … expected `!`, found `()`" ✅[^4] ✅[^1].
   - `while let Some(top) = stack.pop() { … }` loops while the pattern matches; on `vec![1, 2, 3]` it printed `pop 3 pop 2 pop 1` ✅[^5] ✅[^1].
   - **Let chains** (edition 2024 only, stable since Rust 1.88): `if let Some(a) = age && a >= 18 { … }` printed `adult 20` ✅[^10] ✅[^15] ✅[^1]. Mixing `||` with a `let` condition is not allowed without parentheses ✅[^10].
5. **Pattern forms** (each line ran in the lab ✅[^1]; syntax per ✅[^7] ✅[^8]):

   | Form | Example | Result |
   |---|---|---|
   | literal, or-pattern, range | `0 => …`, `1 \| 2 \| 3 => …`, `4..=9 => …`, `i32::MIN..0 => …` | `-4` → "negative", `7` → "digit" |
   | `char` range | `'a'..='f'`, `'A'..='Z'` | `'c'` → "low hex", `'Q'` → "upper" |
   | struct with rename and `ref` | `let Reading { sensor: ref name, value } = r;` | `name t1, value 17` |
   | nested, `@` binding | `(a, (Some(b @ -5..=-1), _))` | `a 3, b -1` |
   | `@` plus guard | `v @ 10..=19 if v % 2 == 1` | 17 → "odd teen 17" |
   | rest `..` | `let (first, .., last) = (1, 2, 3, 4);` | `first 1, last 4` |
   | slice | `[]`, `[only]`, `[head, rest @ ..]` | `[1, 2, 3, 4]` → "head 1, rest [2, 3, 4]" |

   Ranges are allowed for integers, `char` and floats, and must not be empty ✅[^8]. `..` may appear once per tuple, tuple-struct or slice pattern ✅[^8] ✅[^7]. A guard applies to the whole or-pattern: `4 | 5 | 6 if flag` with `flag = false` sends 5 to the next arm ✅[^7] ✅[^1].
6. **Refutability.** A pattern that can fail is refutable (`Some(x)`); one that always matches is irrefutable (`x`, `(a, b)`) ✅[^6] ✅[^8]. `let`, `for` and function parameters accept only irrefutable patterns: `let Some(x) = maybe;` fails with E0005 "refutable pattern in local binding … pattern `None` not covered", and the compiler suggests `let...else` ✅[^6] ✅[^1]. `if let`, `while let` and `let … else` accept both, but warn on an irrefutable one (`if let n = 5` gives `warning: irrefutable if let pattern`) ✅[^6] ✅[^1].
7. **Binding modes (match ergonomics).** Who decides the type of a binding, step by step ✅[^8] ✅[^13]:
   - The **default binding mode** starts as *move*: a name binds the value itself.
   - Each time the matcher meets a reference while the pattern is not a reference pattern, it dereferences automatically and switches the mode to *ref* (for `&`) or *ref mut* (for `&mut`, unless already *ref*).
   - A name then binds with the current mode. Matching `&maybe_name` (an `&Option<String>`) with `Some(n)` gave `n: &alloc::string::String`; `if let Some(c) = &mut counter { *c += 41; }` turned `Some(1)` into `Some(42)` ✅[^1].
   - `ref` / `ref mut` request a reference explicitly when the mode is *move*, so a field can be borrowed without moving it ✅[^8].
8. **Edition 2024 reservations.** When the default mode is not *move*, writing `mut`, `ref`, `ref mut`, `&` or `&mut` is an error ✅[^13] ✅[^8]. The same three files in the lab:

   | Pattern on a reference | Edition 2021 | Edition 2024 |
   |---|---|---|
   | `let (mut a, b) = pair;` with `pair: &(u32, u32)` | compiles; `a: u32`, `b: &u32` (`mut` silently reset the mode to *move*) | "cannot mutably bind by value within an implicitly-borrowing pattern" |
   | `let [&x, y] = pairs;` with `pairs: &[&u32; 2]` | compiles; `x: u32`, `y: &&u32` | "cannot explicitly dereference within an implicitly-borrowing pattern" |
   | `if let Some(ref s) = opt` with `opt: &Option<String>` | compiles | "cannot explicitly borrow within an implicitly-borrowing pattern" |

   All three ran ✅[^1]. The fix is a fully explicit pattern: `let &(mut a, b) = pair;` gives `a: u32, b: u32` in 2024 ✅[^1]; `cargo fix --edition` applies it through the `rust_2024_incompatible_pat` lint ✅[^13].
9. **`matches!`.** `matches!(value, PATTERN)` or `matches!(value, PATTERN if guard)` returns a `bool` ✅[^14]: `matches!('k', 'a'..='z')` is `true` ✅[^1].
10. **`#[non_exhaustive]`.** Inside the defining crate it changes nothing ✅[^12]. In another crate (tested with a library `shapes` and a binary linked through `--extern`) ✅[^1]:
    - a `match` naming all three `Status` variants fails with E0004 "`&_` not covered" and the note "`Status` is marked as non-exhaustive, so a wildcard `_` is necessary";
    - `Limits { max: 10 }` fails with E0639 "cannot create non-exhaustive struct using struct expression";
    - `let Limits { max } = …` fails with E0638 "`..` required with struct marked as non-exhaustive".
    This matches the Reference rules ✅[^12]: library authors can add variants or fields later without breaking callers.

## Worked example
Parsing log lines into an enum, then classifying them through a reference (lab) ✅[^1]:
```rust
#[derive(Debug)]
enum Event { Login { user: String, attempt: u8 }, Upload(u64), Logout }

fn parse(line: &str) -> Option<Event> {
    let mut words = line.split_whitespace();
    let Some(kind) = words.next() else { return None };          // let-else: bail out early
    match (kind, words.next(), words.next()) {
        ("login", Some(user), Some(n)) => n.parse().ok()
            .map(|attempt| Event::Login { user: user.to_string(), attempt }),
        ("upload", Some(bytes), None) => bytes.parse().ok().map(Event::Upload),
        ("logout", None, None) => Some(Event::Logout),
        _ => None,
    }
}

fn verdict(e: &Event) -> String {          // e is a reference: bindings below are references too
    match e {
        Event::Login { attempt: 1, user } => format!("{user}: first try"),
        Event::Login { attempt: n @ 2..=3, user } => format!("{user}: retry {n}"),
        Event::Login { user, .. } => format!("{user}: locked"),
        Event::Upload(size) if *size > 1_000_000 => format!("large upload {size}"),
        Event::Upload(size) => format!("upload {size}"),
        Event::Logout => String::from("bye"),
    }
}

fn main() {
    for line in ["login ana 1", "login bo 3", "login cy 7", "upload 2500000", "upload 12", "logout", "logout now", ""] {
        match parse(line) {
            Some(e) => println!("{line:?} -> {e:?} -> {}", verdict(&e)),
            None => println!("{line:?} -> rejected"),
        }
    }
}
```
```text
"login ana 1" -> Login { user: "ana", attempt: 1 } -> ana: first try
"login bo 3" -> Login { user: "bo", attempt: 3 } -> bo: retry 3
"login cy 7" -> Login { user: "cy", attempt: 7 } -> cy: locked
"upload 2500000" -> Upload(2500000) -> large upload 2500000
"upload 12" -> Upload(12) -> upload 12
"logout" -> Logout -> bye
"logout now" -> rejected
"" -> rejected
```
Reading it: matching the tuple `(kind, next, next)` checks the word count and the keyword in one pattern, so `"logout now"` falls to `_`. In `verdict`, `e` is `&Event`, so `size` binds as `&u64` and the guard must write `*size`. The arm order matters: `attempt: 1` before `n @ 2..=3` before the catch-all `user, ..`.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `match n { x if x < 0 => -1, x if x >= 0 => 1 }` on `i32` | E0004 "`i32::MIN..=i32::MAX` not covered", note "match arms with guards don't count towards exhaustivity" ✅[^1] | The compiler does not reason about guard conditions ✅[^7] |
| `u8` split as `0..=127` and `128..=255` | Exhaustive, no `_` needed (200 → "high") ✅[^1] | The checker adds up integer ranges; a single range spanning a whole integer or `char` type is even irrefutable ✅[^8] |
| `Some(wanted) => …` with an outer `wanted = 5` and the value `Some(9)` | Matches, and `wanted` is 9 inside the arm ✅[^1] | A name in a pattern binds a new variable; compare with a guard `Some(w) if w == wanted` ✅[^7] |
| `if let Some(_n) = note`, then `note` used | E0382 "borrow of partially moved value: `note`" ✅[^1] | `_n` binds and moves ✅[^7] |
| `if let Some(_) = note`, then `note` used | Fine ✅[^1] | `_` never copies, moves or borrows ✅[^8] |
| `match cmd { "stop" => … }` with `cmd: String` | E0308 "expected `String`, found `&str`", hint `.as_str()` ✅[^1] | String literals are `&str` patterns |
| Guard with side effects on an or-pattern | May run more than once | Each alternative of `\|` is tried with the guard ✅[^9] |
| Value moved by a binding but the guard fails | Not moved | The move happens only after the guard succeeds ✅[^9] |
| `if let` chain in edition 2021 | Rejected | Let chains need edition 2024 ✅[^10] ✅[^15] |

The Book's patterns chapter still says `if let Ok(age) = age && age > 30` cannot be written ✅[^5]; that holds only before edition 2024, and the Reference documents let chains for 2024 ✅[^10].

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `match` | Exhaustiveness checked, so new variants are found at compile time | More lines for one interesting case |
| `if let` / `let … else` | Short; `let … else` keeps the main path unindented ✅[^4] | No exhaustiveness check |
| Catch-all `_` arm | Short; required for `#[non_exhaustive]` enums | New variants silently go to `_` |
| `#[non_exhaustive]` on a public enum | Add variants without a breaking release ✅[^12] | Every caller must handle "unknown" |

## Takeaways
- Prefer `match` to chains of `if let` when every variant matters, and avoid `_` on your own enums so the compiler flags new variants. [rule-candidate]
- Use `let … else` for early returns on a failed pattern instead of nesting. [rule-candidate]
- Compare against an outer variable with a guard (`Some(w) if w == wanted`), never by reusing its name in the pattern. [rule-candidate]
- Use `_`, not `_name`, when a value must not be moved.
- Write patterns that work in edition 2024: no `mut`, `ref` or `&` inside a pattern that matches through a reference; make the outer `&` explicit instead. [rule-candidate]
- Mark public enums that will grow `#[non_exhaustive]`.

## Verification status
- Verified: 77 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `linux/lab-setup.md` — the Rust 1.100.0 lab (`rustlab:1`) where every behaviour marked with this note ran on 2026-11-24. [^1]
- [Defining an Enum](https://doc.rust-lang.org/book/ch06-01-defining-an-enum.html) — The Rust Programming Language (Klabnik, Nichols, Krycho and the Rust community), living. Backs: variants with data, constructors, `impl` on enums, `Option` in the prelude, `Option<i8> + i8` error. [^2]
- [The match Control Flow Construct](https://doc.rust-lang.org/book/ch06-02-match.html) — The Rust Programming Language, living. Backs: arms in order, exhaustiveness, catch-all and `_`, catch-all last. [^3]
- [Concise Control Flow with if let and let...else](https://doc.rust-lang.org/book/ch06-03-if-let.html) — The Rust Programming Language, living. Backs: `if let` sugar and lost exhaustiveness, `let...else`. [^4]
- [All the Places Patterns Can Be Used](https://doc.rust-lang.org/book/ch19-01-all-the-places-for-patterns.html) — The Rust Programming Language, living. Backs: `if let` chains of `else if`, `while let`, the pre-2024 statement on combining `if let` and `&&`. [^5]
- [Refutability: Whether a Pattern Might Fail to Match](https://doc.rust-lang.org/book/ch19-02-refutability.html) — The Rust Programming Language, living. Backs: refutable vs irrefutable, where each is allowed, E0005. [^6]
- [Pattern Syntax](https://doc.rust-lang.org/book/ch19-03-pattern-syntax.html) — The Rust Programming Language, living. Backs: every pattern form, shadowing trap, `_x` vs `_`, guards and or-patterns, guards and exhaustiveness, `@`. [^7]
- [Patterns](https://doc.rust-lang.org/reference/patterns.html) — The Rust Reference, living. Backs: refutability, binding modes, 2024 restrictions, `_`, rest and range patterns, slice patterns. [^8]
- [match expressions](https://doc.rust-lang.org/reference/expressions/match-expr.html) — The Rust Reference, living. Backs: arm order, guards run per alternative, move after guard. [^9]
- [if expressions](https://doc.rust-lang.org/reference/expressions/if-expr.html) — The Rust Reference, living. Backs: let chains, no `\|\|`, 2024 only. [^10]
- [Enumerations](https://doc.rust-lang.org/reference/items/enumerations.html) — The Rust Reference, living. Backs: variant kinds, constructors, discriminants and casts. [^11]
- [Type system](https://doc.rust-lang.org/reference/attributes/type_system.html) — The Rust Reference, living. Backs: `non_exhaustive` rules inside and outside the defining crate. [^12]
- [Match ergonomics reservations](https://doc.rust-lang.org/edition-guide/rust-2024/match-ergonomics.html) — The Rust Edition Guide, living. Backs: default binding mode, 2021 surprises, 2024 errors, `rust_2024_incompatible_pat`. [^13]
- [matches in std](https://doc.rust-lang.org/std/macro.matches.html) — Rust standard library docs 1.100.0, living. Backs: `matches!` with optional guard. [^14]
- [Announcing Rust 1.88.0](https://blog.rust-lang.org/2025/06/26/Rust-1.88.0/) — The Rust Release Team, 2025. Backs: let chains stabilized, edition 2024 only. [^15]

## Related
- `rust/data-modeling/structs-and-methods.md` — product types and `impl` blocks.
- `error-handling/result-type.md` — `Result` as a value, across languages.
- `rust/errors/panic-result-and-error-propagation.md` — `Result`, `?` and `unwrap` in Rust.
- `software-design/functional-modeling/types-as-rules.md` — tagged unions as business rules.
- `rust/fundamentals/toolchain-cargo-and-editions.md` — editions and `cargo fix --edition`.
