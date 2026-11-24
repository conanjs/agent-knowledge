---
schema: knowledge-doc/v1
type: concept
topic: rust/fundamentals
status: verified
applies-to: ["Rust 1.100.0", "edition 2024"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [rust, variables, mutability, shadowing, const, static, integer-overflow, casts, char, tuples, arrays, expressions, loops]
---

# Variables, types and control flow

## Summary
**TL;DR:** A `let` binding cannot be reassigned unless it is `mut`; a second `let` with the same name **shadows** the first, which creates a new variable that may have a new type. `const` is a typed compile-time value copied into each use; `static` is one memory location for the whole run. The scalar types are integers (`i8`…`i128`, `u8`…`u128`, pointer-sized `isize`/`usize`), `f32`/`f64`, `bool` and `char` (a 4-byte Unicode scalar value). Integer overflow **panics in debug builds and wraps in release builds**, so say what you mean with `checked_`, `wrapping_`, `saturating_` or `overflowing_` methods. `as` never fails: it truncates integers, and float-to-integer casts round toward zero and saturate (NaN gives 0). Nearly everything is an expression: blocks, `if` and `loop` (through `break value`) produce values, and a trailing semicolon turns an expression into a statement whose value is `()`.
**Use this when:** you write your first functions and loops, an error says E0384, E0308 "expected `i32`, found `()`" or E0571, a sum works in tests but gives a wrong number in production, or a cast gives a surprising value.
**Not this doc:** moves, `Copy` and scope-end drop → `rust/ownership/ownership-moves-and-drop.md`; `String`, `&str` and UTF-8 → `rust/collections/strings-and-utf-8.md`; IEEE 754 float behaviour → `floating-point/`; `match` and patterns → `rust/data-modeling/enums-and-pattern-matching.md`; iterators behind `for` → `rust/closures-and-iterators/iterators.md`; the toolchain → `rust/fundamentals/toolchain-cargo-and-editions.md`.

## Problem
Habits from other languages break here. `if count { … }` does not compile, assigning twice to a `let` fails, a function returns `()` because of one semicolon, and `while` cannot return a value. Worse, two silent behaviours depend on the build: a `u8` counter that panics in a debug test **wraps to a small number in the release binary**, and `300 as u8` quietly yields 44.

## Mental model
**Analogy:** a `let` is a labelled jar that is sealed once filled; `mut` is a jar with a screw lid; shadowing puts a new jar with the same label in front of the old one, which stays on the shelf, hidden, until the end of the inner scope. Expressions work like spreadsheet cells: every block computes a value, and a semicolon throws that value away.

**Artifact:** shadowing, scopes and a block expression (lab, Rust 1.100.0) ✅[^1]:
```rust
let label = "  padded  ";
let label = label.trim();     // new variable, still &str
let label = label.len();      // new variable, now usize
let depth = 1;
{ let depth = depth * 10; println!("inner depth = {depth}"); }
println!("outer depth = {depth}");
let bonus = { let base = 4; base * 3 };   // a block is an expression
println!("label = {label}, bonus = {bonus}");
```
```text
inner depth = 10
outer depth = 1
label = 6, bonus = 12
```

## How it works
1. **Bindings.**
   - Variables are immutable by default; `level = 2` after `let level = 1` fails with `error[E0384]: cannot assign twice to immutable variable` and the compiler suggests `let mut` ✅[^2] ✅[^1].
   - `mut` cannot change the type: `let mut label = "  padded  "; label = label.len();` fails with E0308 "expected `&str`, found `usize`", while shadowing does it ✅[^2] ✅[^1].
   - A binding may be declared first and assigned once later (`let mode; if … { mode = "on" } else { mode = "off" }`); reading one that was never assigned (`let total: i32; println!("{total}");`) fails with E0381 "used binding `total` isn't initialized" ✅[^1].
   - `const` needs a type (`const LIMIT = 10;` fails with "missing type for `const` item"), takes only a constant expression (`n * 2` with a runtime `n` fails with E0435) and is evaluated at compile time ✅[^2] ✅[^11] ✅[^1]. It has no fixed address: each use gets its own copy ✅[^11].
   - `static` is one allocation for the whole program, with the `'static` lifetime; its type must be `Sync`, and reading or writing a `static mut` needs `unsafe` ✅[^12]. Prefer `const` unless you need a single address, a large table or interior mutability ✅[^12]. In edition 2024, `&HITS` on a `static mut HITS` is a deny-by-default error (`static_mut_refs`; only a warning in 2021) ✅[^19] ✅[^1]; the safe alternatives belong to `rust/unsafe/unsafe-rust-and-undefined-behavior.md`.
2. **Scalar types.**

   | Type | Size measured on aarch64 | Note |
   |---|---|---|
   | `i8`…`i128`, `u8`…`u128` | 1…16 bytes | two's complement signed ✅[^9] |
   | `isize`, `usize` | 8 | as wide as a pointer, at least 16 bits ✅[^9] ✅[^1] |
   | `f32`, `f64` | 4, 8 | IEEE 754 binary32/binary64 ✅[^9] |
   | `bool` | 1 | ✅[^3] ✅[^1] |
   | `char` | 4 | one Unicode scalar value ✅[^10] ✅[^1] |
   | `()` | 0 | the unit type, the value of "nothing" ✅[^3] ✅[^1] |

   An unannotated integer literal is `i32` and a float literal is `f64` (`type_name_of_val` printed `i32` and `f64`) ✅[^3] ✅[^1]. Literals accept `_` separators and prefixes: `1_000_000`, `0xff` (255), `0o17` (15), `0b1010_1010` (170), `b'A'` (65, a `u8`) ✅[^3] ✅[^1]. Integer division truncates toward zero: `-7 / 2` is `-3` and `-7 % 2` is `-1`; `rem_euclid` gives `1` ✅[^3] ✅[^1].
3. **Integer overflow.** Overflow is a bug, not undefined behaviour: builds with debug assertions must panic, other builds may wrap using two's complement ✅[^8]. Who decides, step by step:
   - Cargo's `dev` profile sets `overflow-checks = true` and `release` sets `false` ✅[^17].
   - Cargo passes that to rustc as `-C overflow-checks`, whose default follows `-C debug-assertions`, which is on only at `opt-level=0` ✅[^16].
   - With checks on, the generated code panics with "attempt to add with overflow"; with checks off it wraps ✅[^7] ✅[^1].
   - Some cases always panic, whatever the flags: division by zero, and `i32::MIN / -1` or `%` on that pair ✅[^7] ✅[^1].
   - Overflow the compiler can see at compile time, such as `let x: u8 = 255 + 1;`, is a deny-by-default `arithmetic_overflow` error in every build ✅[^15] ✅[^1].
   - Explicit methods state intent: `checked_add` returns `None`, `wrapping_add` wraps, `saturating_add` clamps, `overflowing_add` returns the value and a flag ✅[^3] ✅[^1].
4. **`as` casts never fail** ✅[^7] (values measured ✅[^1]):

   | Cast | Rule | Example → result |
   |---|---|---|
   | same width | bits reinterpreted | `-1_i32 as u32` → 4294967295; `200_u8 as i8` → -56 |
   | wider → narrower | truncates high bits | `300_i32 as u8` → 44 |
   | narrower → wider | zero- or sign-extends | `-3_i8 as i32` → -3 |
   | float → integer | rounds toward zero, saturates, NaN → 0 | `300.9_f64 as u8` → 255; `-5.7_f64 as u8` → 0; `-5.7_f64 as i32` → -5; `f64::NAN as i32` → 0; `1e20 as i32` → 2147483647; `f64::INFINITY as u16` → 65535 |
   | integer → float | nearest float, ties to even | `16_777_217_i32 as f32` → 16777216 |
   | `bool`, `char` → integer | 0/1, code point then numeric cast | `true as i32` → 1; `'é' as u8` → 233 |
   | `u8` → `char` | only `u8` is allowed | `233_u8 as char` → `é`; `0x1F600_u32 as char` → E0604 "only `u8` can be cast as `char`" with a hint to use `char::from_u32` |

   For a checked conversion use `TryFrom`: `u8::try_from(300_i32)` is `Err(TryFromIntError(PosOverflow))` ✅[^1].
5. **`char`.** A `char` is always 4 bytes and holds a Unicode scalar value: a code point from 0 to 0x10FFFF that is not a surrogate (0xD800–0xDFFF); building any other value is undefined behaviour ✅[^10] ✅[^18]. `char::from_u32(0xD800)` is `None`; `'ß'.len_utf8()` is 2 and `'😀'.len_utf8()` is 4, so a `char` and its bytes inside a string differ ✅[^18] ✅[^1]. Strings are owned by `rust/collections/strings-and-utf-8.md`.
6. **Tuples and arrays.** A tuple groups values of different types with a fixed length; read it with `.0`, `.1` or destructure it: `let (name, temp, _) = ("probe", 21.5, 3);` ✅[^3] ✅[^1]. An array `[T; N]` has one element type and a fixed length, lives inline (on the stack for a local), and `[0_i16; 5]` measured 10 bytes ✅[^3] ✅[^1]. A runtime index past the end panics: "index out of bounds: the len is 3 but the index is 7" ✅[^3] ✅[^1].
7. **Functions, statements and expressions.** Every parameter needs a type (`fn scale(x, factor: f64)` is a parse error) and the return type follows `->` ✅[^4] ✅[^1]. A statement performs an action and has no value: `let a = (let b = 6);` fails with "expected expression, found `let` statement" ✅[^4] ✅[^1]. The body's last expression, written without a semicolon, is the return value; `return` exits early ✅[^4]. Adding the semicolon gives E0308 "expected `i32`, found `()`" with the help "remove this semicolon to return this value" ✅[^4] ✅[^1]. Comments are `//` to the end of the line ✅[^5]; doc comments are owned by `code-documentation/doc-comments.md`.
8. **Control flow.**
   - `if` takes a `bool` only (`if items` with an integer gives E0308 "expected `bool`, found integer") and is an expression whose arms must share a type ("`if` and `else` have incompatible types") ✅[^6] ✅[^14] ✅[^1].
   - `loop` repeats until `break`; `break value` makes the loop produce that value, and a `loop` with no `break` has type `!` (never) ✅[^6] ✅[^13].
   - `while` and `for` produce `()`, so `break n` inside `while` fails with E0571 ✅[^13] ✅[^1].
   - A label `'name:` lets `break 'name` or `continue 'name` target an outer loop ✅[^6] ✅[^13].
   - A **labelled block** `'check: { … break 'check value; … }` returns early with a value without being a loop; its `break` must name the label, and `continue` is not allowed ✅[^13] ✅[^1].
   - `for x in collection` is preferred over indexing in a `while` loop: it cannot go out of bounds and skips the per-step bounds check ✅[^6]. Ranges: `1..4` excludes 4, `1..=3` includes 3, `.rev()` reverses ✅[^6] ✅[^1].

## Worked example
One program, three builds. `black_box` hides the starting value from the optimizer, so the addition really happens at run time ✅[^20]:
```rust
use std::hint::black_box;
fn main() {
    let stock: u8 = black_box(250);
    println!("checked     {:?}", stock.checked_add(10));
    println!("wrapping    {}", stock.wrapping_add(10));
    println!("saturating  {}", stock.saturating_add(10));
    println!("overflowing {:?}", stock.overflowing_add(10));
    println!("plain +     {}", stock + 10);
}
```
| Build | Command | Last line printed | Exit code |
|---|---|---|---|
| debug | `rustc --edition 2024 overflow.rs` | `panicked at overflow.rs:8:32: attempt to add with overflow` | 101 |
| release | `rustc -C opt-level=3 -C debug-assertions=off …` | `plain +     4` | 0 |
| release with checks | `rustc -C opt-level=3 -C overflow-checks=on …` | `attempt to add with overflow` | 101 |

In all three builds the first four lines are the same: `None`, `4`, `255`, `(4, true)` ✅[^1]. 250 + 10 = 260, and 260 − 256 = 4 is the two's complement wrap ✅[^8]. The release binary printed a wrong stock level and exited 0, which is why the takeaways ask for explicit methods.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `let x: u8 = 255 + 1;` | Compile error in debug and release: "this arithmetic operation will overflow" ✅[^1] | `arithmetic_overflow` is deny-by-default ✅[^15] |
| `slots[7]` on a 3-element array, constant index | Compile error "this operation will panic at runtime" ✅[^1] | `unconditional_panic` is deny-by-default ✅[^15] |
| `10 / d` with `d == 0` at run time | Panics in release too: "attempt to divide by zero" ✅[^1] | Integer division by zero always panics ✅[^7] |
| `i32::MIN / -1` in release | Panics: "attempt to divide with overflow" ✅[^1] | Checked even with overflow checks off ✅[^7] |
| `1.0 / 0.0`, `0.0 / 0.0` | `inf`, `NaN`, no panic ✅[^1] | IEEE 754 floats; see `floating-point/special-values-and-exceptions.md` |
| `0.1 + 0.2` | `0.30000000000000004` ✅[^1] | Binary rounding; see `floating-point/rounding-and-error.md` |
| `u64::MAX as f32` | `18446744000000000000` ✅[^1] | Rounds to the nearest `f32` ✅[^7] |
| Shadowed variable in an inner block | Outer value returns after `}` (`outer depth = 1`) ✅[^1] | Shadowing lasts until the scope ends ✅[^2] |
| `let nothing = println!(…)` | `nothing` is `()` and prints as `()` ✅[^1] | Expressions with no other value produce unit ✅[^3] |
| `break` without a value in a `loop` | Same as `break ()` | ✅[^13] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Plain `+` and `*` | Shortest; debug tests catch overflow | Release silently wraps ✅[^1] |
| `checked_*` | Forces handling the overflow case | An `Option` at every step |
| `saturating_*` / `wrapping_*` | Explicit, branch-free intent | Wrong if the clamp or wrap is not what the domain wants |
| `overflow-checks = true` in the release profile | Panics instead of wrong numbers in production | A check on each operation; profiles are owned by `rust/project-structure/cargo-workspaces-features-and-profiles.md` |
| `as` | Infallible, short | Silent truncation and saturation |
| `TryFrom` / `try_into` | Reports out-of-range values | A `Result` to handle |

## Takeaways
- Do not rely on `+`, `-` or `*` wrapping: use `checked_`, `saturating_` or `wrapping_` where overflow is possible. [rule-candidate]
- Use `as` only for conversions that cannot lose data or where truncation is intended; otherwise `try_from`. [rule-candidate]
- Prefer shadowing to `mut` when a value is transformed step by step and then stays fixed.
- Prefer `const` to `static`; never take references to a `static mut`. [rule-candidate]
- Use `loop` with `break value` or a labelled block instead of a mutable "result" variable set inside the loop.
- Iterate with `for` over a collection instead of indexing inside `while`.

## Verification status
- Verified: 97 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `linux/lab-setup.md` — the Rust 1.100.0 lab (`rustlab:1`) where every behaviour marked with this note ran on 2026-11-24. [^1]
- [Variables and Mutability](https://doc.rust-lang.org/book/ch03-01-variables-and-mutability.html) — The Rust Programming Language (Klabnik, Nichols, Krycho and the Rust community), living. Backs: immutability, `mut`, constants, shadowing vs `mut`. [^2]
- [Data Types](https://doc.rust-lang.org/book/ch03-02-data-types.html) — The Rust Programming Language, living. Backs: scalar and compound types, literal forms, defaults, overflow method families, division, arrays. [^3]
- [Functions](https://doc.rust-lang.org/book/ch03-03-how-functions-work.html) — The Rust Programming Language, living. Backs: parameter types, statements vs expressions, return values, the semicolon error. [^4]
- [Comments](https://doc.rust-lang.org/book/ch03-04-comments.html) — The Rust Programming Language, living. Backs: `//` comments. [^5]
- [Control Flow](https://doc.rust-lang.org/book/ch03-05-control-flow.html) — The Rust Programming Language, living. Backs: `if`, `loop` with `break` value, labels, `while`, `for`, ranges. [^6]
- [Operator expressions](https://doc.rust-lang.org/reference/expressions/operator-expr.html) — The Rust Reference, living. Backs: overflow panics, always-checked division cases, numeric cast semantics. [^7]
- [Behavior not considered `unsafe`](https://doc.rust-lang.org/reference/behavior-not-considered-unsafe.html) — The Rust Reference, living. Backs: overflow is erroneous but defined, two's complement wrapping. [^8]
- [Numeric types](https://doc.rust-lang.org/reference/types/numeric.html) — The Rust Reference, living. Backs: integer and float types, `usize`/`isize` width. [^9]
- [Character type](https://doc.rust-lang.org/reference/types/char.html) — The Rust Reference, living. Backs: `char` range, size equal to `u32`, invalid `char` is UB. [^10]
- [Constant items](https://doc.rust-lang.org/reference/items/constant-items.html) — The Rust Reference, living. Backs: no fixed address, inlined, typed, compile-time evaluation. [^11]
- [Static items](https://doc.rust-lang.org/reference/items/static-items.html) — The Rust Reference, living. Backs: single allocation, `Sync`, `static mut` needs `unsafe`, const vs static guidance. [^12]
- [Loop expressions](https://doc.rust-lang.org/reference/expressions/loop-expr.html) — The Rust Reference, living. Backs: loop kinds, `break` values, `!` type, labels, labelled blocks. [^13]
- [`if` expressions](https://doc.rust-lang.org/reference/expressions/if-expr.html) — The Rust Reference, living. Backs: `bool` conditions, one type for all branches. [^14]
- [Deny-by-default Lints](https://doc.rust-lang.org/rustc/lints/listing/deny-by-default.html) — The rustc book, living. Backs: `arithmetic_overflow`, `unconditional_panic`. [^15]
- [Codegen Options](https://doc.rust-lang.org/rustc/codegen-options/index.html) — The rustc book, living. Backs: `-C overflow-checks` and `-C debug-assertions` defaults. [^16]
- [Profiles](https://doc.rust-lang.org/cargo/reference/profiles.html) — The Cargo Book, living. Backs: `overflow-checks` in `dev` and `release`. [^17]
- [char](https://doc.rust-lang.org/std/primitive.char.html) — Rust standard library docs 1.100.0, living. Backs: 4 bytes, `len_utf8`, `from_u32`. [^18]
- [Disallow references to static mut](https://doc.rust-lang.org/edition-guide/rust-2024/static-mut-references.html) — The Rust Edition Guide, living. Backs: `static_mut_refs` deny in 2024. [^19]
- [black_box in std::hint](https://doc.rust-lang.org/std/hint/fn.black_box.html) — Rust standard library docs 1.100.0, living. Backs: identity function that hints the optimizer, best effort. [^20]

## Related
- `rust/fundamentals/toolchain-cargo-and-editions.md` — the previous doc: how the program is built.
- `rust/ownership/ownership-moves-and-drop.md` — the next step: what `let` does with heap values.
- `rust/data-modeling/enums-and-pattern-matching.md` — `match`, `if let` and patterns.
- `floating-point/` — IEEE 754 behaviour behind `f32` and `f64`.
- `software-design/functional-modeling/immutability.md` — immutability as a design choice.
