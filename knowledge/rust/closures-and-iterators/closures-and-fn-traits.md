---
schema: knowledge-doc/v1
type: concept
topic: rust/closures-and-iterators
status: verified
applies-to: ["Rust 1.100.0", "edition 2024"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [rust, closures, fn-traits, fnonce, fnmut, move, capture, disjoint-capture, edition-2021, impl-trait]
---

# Closures and the `Fn`, `FnMut`, `FnOnce` traits

## Summary
**TL;DR:** A closure is an anonymous struct that stores what it captures, plus a call method. For each outside variable the body uses, the compiler picks the weakest capture that works: a shared reference, a mutable reference, or the value itself. Separately, it decides which call traits the closure implements from what the body *does* with its captures: moving a capture out → `FnOnce` only; mutating one → `FnMut` (and `FnOnce`); neither → `Fn` (and both others). `move` changes **how** a closure captures (always by value), not **which** traits it implements. Since edition 2021 a closure captures only the fields it uses, not the whole struct.
**Use this when:** you hit E0525 ("expected a closure that implements `Fn`"), E0373 ("closure may outlive the current function"), E0382 on a second call of a closure, or E0596 calling a closure; you choose the bound for a closure parameter; you return a closure; you wonder how big a closure is.
**Not this doc:** `fn` pointer types next to closures in depth → `rust/traits-and-generics/advanced-traits-and-type-system.md`; `dyn Fn`, vtables and dynamic dispatch → `rust/traits-and-generics/trait-objects-and-dynamic-dispatch.md`; closures passed to threads → `rust/concurrency/threads-channels-and-locks.md`; the catalog of borrow errors → `rust/ownership/borrow-checker-errors.md`; closures inside iterator chains → `rust/closures-and-iterators/iterators.md`; closures in JavaScript, which capture whole environments → `javascript/advanced-functions/scope-closures-and-var.md`.

## Problem
A closure that works when called directly fails when passed to a function: "expected a closure that implements the `Fn` trait, but this closure only implements `FnMut`". A closure returned from a function fails with "may outlive borrowed value". Calling a closure twice gives "use of moved value". People add `move` hoping to fix a trait error and it does not help, or assume `move` makes a closure single-use. Code that borrowed one field of a struct while a closure used another compiled in edition 2021 but not in 2018.

## Mental model
**Analogy:** a closure is a lunchbox packed at the moment it is made. For each outside item the recipe mentions, the box holds either a note "look on shelf X" (a reference) or the item itself (moved in). What you may do with the box depends on the recipe: if eating the lunch uses an item up, the box can be opened once (`FnOnce`); if the recipe writes on a shelf, each opening needs exclusive use of the box (`FnMut`); if it only reads, anyone may open it any number of times (`Fn`).

**Artifact:** the box's size is the size of what it holds, measured with `std::mem::size_of_val` on aarch64 ✅[^1]:
```rust
let a: i32 = 7;  let b: u64 = 9;
let name = String::from("depot");  let big = [0u8; 100];
let nothing        = || 1;                 // 0 bytes: captures nothing
let by_ref_one     = || a + 1;             // 8: one &i32
let by_ref_two     = || a as u64 + b;      // 16: &i32 + &u64
let by_move_int    = move || a + 1;        // 4: an i32 copy
let by_move_string = move || name.len();   // 24: the String itself
let by_ref_array   = || big.len();         // 8: &[u8; 100]
let by_move_array  = move || big.len();    // 100: a copy of the array
```

## How it works
1. **A unique type per closure.** Each closure expression has its own anonymous type that cannot be written out, roughly a struct of its captures ✅[^2]. `std::any::type_name_of_val` prints it as `<crate>::main::{{closure}}` (`c7_return::main::{{closure}}` in the lab) ✅[^1]. The sizes in the artifact are that struct's size.
2. **Capture mode, per variable.** The modes are shared borrow, unique immutable borrow, mutable borrow and by value. The compiler takes the first one compatible with how the body uses the place, whatever the surrounding code does ✅[^2]. A `Copy` value that the body uses by value, as in `a + 1`, is captured by shared borrow ✅[^2], which is why `|| a + 1` measured 8 bytes, a reference ✅[^1].
3. **Call traits, from what the body does.**

   | The body … | Implements | Call method | Lab example |
   |---|---|---|---|
   | moves a captured value out | `FnOnce` only | `call_once(self)` | `\|\| { let p = parts; p.len() }` |
   | mutates a capture, moves nothing out | `FnMut` + `FnOnce` | `call_mut(&mut self)` | `\|\| hits += 1` |
   | only reads, or captures nothing | `Fn` + `FnMut` + `FnOnce` | `call(&self)` | `\|\| label.len()` |

   Every closure implements `FnOnce`; `FnMut` needs no move-out; `Fn` needs no move-out and no mutation ✅[^2] ✅[^3]. The traits form a chain, `Fn: FnMut: FnOnce`, so an `Fn` closure is accepted wherever `FnMut` or `FnOnce` is required ✅[^4] ✅[^5]. Because `call_mut` takes `&mut self`, an `FnMut` closure must sit in a `let mut` binding to be called ✅[^5] ✅[^1]. Calling the three methods directly is nightly-only; stable code uses call syntax `f()` ✅[^4].
4. **`move`.** With `move`, every capture is by value, or by copy for `Copy` types ✅[^2]. The trait choice does not change: `move || tag.len()` is still `Fn`, because traits follow what the body does with the captures, not how they were captured ✅[^2] ✅[^1]. `move` matters when the closure must outlive the current scope: returned from a function or handed to a thread ✅[^3] ✅[^7].
5. **Precise (disjoint) capture, edition 2021 and later.** A closure captures a *path* such as `o.note`, not the whole variable `o` ✅[^2] ✅[^6]. Edition 2018 and earlier capture the entire variable ✅[^2]. The lab compiled the same file in both editions (artifact in Worked example) ✅[^1].
6. **Types are inferred once.** A closure's parameter and return types are fixed by its first use ✅[^3]. `let same = |x| x;` called with a `String` and then with `5` fails with `error[E0308]: mismatched types`, noting that the closure was earlier called with a `String` ✅[^1].
7. **Other traits.** A closure is `Clone`/`Copy` when its captures allow it (as if derived) and `Send`/`Sync` by the usual struct rules ✅[^2]. A closure holding only `&String` is `Copy`, so the lab passed `peek` by value to two functions ✅[^1].
8. **Returning closures.**
   - `-> impl Fn(u32) -> u32` returns the closure's own type with no allocation; a `move` closure capturing one `u32` measured 4 bytes ✅[^1].
   - `-> Box<dyn Fn(u32) -> u32>` returns a trait object, 16 bytes on aarch64, and lets branches return different closures ✅[^1] ✅[^8].
   - A non-capturing closure coerces to a function pointer such as `fn(u32) -> u32` ✅[^2]; the lab's `let f: fn() -> i32 = nothing;` compiled and ran ✅[^1].
9. **Picking a bound.** Take the weakest trait your function needs: `FnOnce` if you call it once, `FnMut` if you call it repeatedly and allow mutation, `Fn` if it must not mutate (for example, called concurrently) ✅[^4] ✅[^5] ✅[^8]. Generic `&mut F` is `FnMut` when `F: FnMut`, and `&F` is `Fn` when `F: Fn` ✅[^5] ✅[^8].

## Worked example
Three closures, three bounds, one compile error, and the 2018-versus-2021 capture difference ✅[^1]:
```rust
fn run_fn<F: Fn() -> usize>(f: F) -> usize { f() + f() }
fn run_fn_mut<F: FnMut()>(mut f: F) { f(); f(); }
fn run_once<F: FnOnce() -> usize>(f: F) -> usize { f() }

let label = String::from("crate");
let mut hits = 0u32;
let parts = vec![String::from("lid"), String::from("box")];
let peek = || label.len();                     // reads      → Fn
let mut bump = || hits += 1;                   // mutates    → FnMut
let consume = || { let p = parts; p.len() };   // moves out  → FnOnce

bump();
run_fn_mut(&mut bump);                          // &mut F is FnMut
println!("hits = {hits}");                      // hits = 3
println!("{}", run_fn(peek));                   // 10
println!("{}", run_once(peek));                 // 5: Fn satisfies FnOnce; peek is Copy
println!("{}", run_once(consume));              // 2
```
| Step | What runs | State |
|---|---|---|
| 1 | `bump()` | `hits` 1 |
| 2 | `run_fn_mut(&mut bump)` calls it twice | `hits` 3; the borrow ends, so `hits` can be read |
| 3 | `run_fn(peek)` | `5 + 5 = 10` |
| 4 | `run_once(peek)` | `5`, a second copy of `peek` |
| 5 | `run_once(consume)` | `2`; `consume` is gone afterwards |

A single-use closure called twice is rejected ✅[^1]:
```rust
let ticket = String::from("T-42");
let redeem = move || { let t = ticket; println!("redeemed {t}"); };
redeem();
redeem();   // error[E0382]: use of moved value: `redeem`
            // note: closure cannot be invoked more than once because it moves
            //       the variable `ticket` out of its environment
```
Disjoint capture, with `struct Order { id: u32, note: String, qty: u32 }` ✅[^1]:
```rust
let mut o = Order { id: 1, note: String::from("fragile"), qty: 2 };
let show_note = || println!("note: {}", o.note);  // captures &o.note only
o.qty += 1;                                         // a different field
show_note();
let take_note = move || o.note;                     // moves o.note only
println!("id still usable: {} qty {}", o.id, o.qty);
```
Edition 2024 prints `note: fragile` and `id still usable: 1 qty 3`. Edition 2018 rejects the same file twice: ``error[E0506]: cannot assign to `o.qty` because it is borrowed`` and ``error[E0382]: borrow of moved value: `o.qty` ``, because there the closures capture all of `o` ✅[^1].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| A mutating closure stored in `let tick`, then passed to `F: Fn()` | ``error[E0525]: expected a closure that implements the `Fn` trait, but this closure only implements `FnMut` `` ✅[^1] | The closure mutates `count`, so it is only `FnMut` ✅[^2]; E0525 is the error for a closure that lacks the expected trait ✅[^9] |
| The same closure written inline: `call_twice(\|\| count += 1)` | ``error[E0594]: cannot assign to `count`, as it is a captured variable in a `Fn` closure``, with the hint "change this to accept `FnMut`" ✅[^1] | Rust 1.100 reports the inline form at the assignment instead, labelling the call "expects `Fn` instead of `FnMut`" ✅[^1] |
| `move \|\| msg` passed to `F: FnMut() -> String` | ``error[E0525]: … only implements `FnOnce` ``, "because it moves the variable `msg` out of its environment" ✅[^1] | Returning a capture moves it out ✅[^2] |
| `let add = \|n\| total += n; add(3);` | ``error[E0596]: cannot borrow `add` as mutable``; help: `let mut add` ✅[^1] | `call_mut` takes `&mut self` ✅[^5] |
| A returned closure borrows a parameter | ``error[E0373]: closure may outlive the current function, but it borrows `pct` ``; help: add `move` ✅[^1] | The borrowed local dies when the function returns ✅[^7] |
| Two *capturing* closures in `if`/`else` behind `impl Fn` | ``error[E0308]: `if` and `else` have incompatible types``, "no two closures, even if identical, have the same type" ✅[^1] | Each closure has a unique type ✅[^2]; box both as `Box<dyn Fn…>` |
| Two *non-capturing* closures in `if`/`else` | Compiles; the result is 8 bytes, a function pointer ✅[^1] | Non-capturing closures coerce to `fn` pointers ✅[^2] |
| `move` with a `Copy` capture | The closure gets a copy; the original stays usable (`a still usable: 7`) ✅[^1] | `move` copies `Copy` types ✅[^2] |
| A wrapper type made `Send` for a raw field, used through `wrapper.0` in a 2021 closure | Only the field is captured, losing the wrapper's `Send` impl ✅[^6] | Edition guide's migration inserts `let _ = &wrapper;` to capture it whole ✅[^6] |
| Disjoint capture of a field by value | That field can drop at a different time than the rest of the struct | Captured fields' lifetimes follow the closure ✅[^2] ✅[^6] |
| `\|\| async { log.push(1); }` passed to `F: FnMut() -> Fut` | ``error: captured variable cannot escape `FnMut` closure body``: the returned `async` block "contains a reference to a captured variable" ✅[^1] | A future made inside an ordinary closure cannot borrow from that closure's captures; an `async` closure can, with the traits `AsyncFn`/`AsyncFnMut`/`AsyncFnOnce`, stable since Rust 1.85 ✅[^10]. In the lab, `async \|\| { log.push(log.len() as u32); }` called twice through an `AsyncFnMut` bound left `log = [0, 1]` ✅[^1] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Generic `F: Fn…` parameter or `impl Fn…` return | No allocation; size is just the captures (0 to 100 bytes in the artifact) ✅[^1] | One compiled copy per closure type: `nm` listed `apply::<main::{closure#0}>` and `apply::<main::{closure#1}>` for two closures, against one `apply_dyn` ✅[^1] (monomorphization is owned by `rust/traits-and-generics/generics-and-traits.md`) |
| `Box<dyn Fn…>` | One type for many closures; storable in a `Vec` ✅[^1] | A heap allocation (`rust/smart-pointers/box-deref-and-drop.md`); a 16-byte fat pointer ✅[^1]; a call through the trait object |
| `fn(…)` pointer | Plain 8-byte value, no generics ✅[^1] | Cannot capture anything ✅[^2] |

## Takeaways
- Accept the weakest bound you need: `FnOnce` if called once, `FnMut` if called repeatedly, `Fn` only when shared or concurrent calls require it. [rule-candidate]
- Add `move` to closures that are returned or sent to another thread; do not expect `move` to fix an `Fn`/`FnMut` trait error. [rule-candidate]
- Return `impl Fn…` when there is one closure type; switch to `Box<dyn Fn…>` when branches return different closures.
- Keep a closure that must be called through a binding in `let mut` when it mutates its captures.
- After moving code from edition 2018, remember that closures now capture fields; `let _ = &whole;` restores whole-variable capture where a wrapper depends on it.

## Verification status
- Verified: 70 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `linux/lab-setup.md` — the Rust 1.100.0 lab (`rustlab:1`) where every behaviour marked with this note ran on 2026-11-24. [^1]
- [Closure types](https://doc.rust-lang.org/reference/types/closure.html) — The Rust Reference, living. Backs: unique type, capture modes and how they are chosen, `Copy` captures, `move`, precise capture paths and 2018 behaviour, call traits, `fn` pointer coercion, `Clone`/`Copy`/`Send`/`Sync`, drop timing. [^2]
- [Closures](https://doc.rust-lang.org/book/ch13-01-closures.html) — The Rust Programming Language (Klabnik, Nichols, Krycho et al.), living. Backs: three ways to capture, `move` for threads, the three `Fn` traits, types fixed on first use. [^3]
- [Trait `std::ops::FnOnce`](https://doc.rust-lang.org/std/ops/trait.FnOnce.html) — Rust project, living. Backs: by-value receiver, bound advice, subtraits, nightly `call_once`. [^4]
- [Trait `std::ops::FnMut`](https://doc.rust-lang.org/std/ops/trait.FnMut.html) — Rust project, living. Backs: `call_mut(&mut self)`, bound advice, impls for `&mut F` and `&F`. [^5]
- [Disjoint capture in closures](https://doc.rust-lang.org/edition-guide/rust-2021/disjoint-capture-in-closures.html) — The Rust Edition Guide, living. Backs: field capture since 2021, drop order and trait changes, the `let _ = &x;` migration. [^6]
- [E0373](https://doc.rust-lang.org/error_codes/E0373.html) — Rust compiler error index, living. Backs: a returned or spawned closure borrowing a local; the `move` fix. [^7]
- [Trait `std::ops::Fn`](https://doc.rust-lang.org/std/ops/trait.Fn.html) — Rust project, living. Backs: `call(&self)`, bound advice (concurrent calls), `&F` is `Fn`, `Box<dyn Fn>`. [^8]
- [E0525](https://doc.rust-lang.org/error_codes/E0525.html) — Rust compiler error index, living. Backs: a closure that does not implement the expected trait. [^9]
- [Functional Language Features: Iterators and Closures](https://doc.rust-lang.org/book/ch13-00-functional-features.html) — The Rust Programming Language, living. Background: chapter scope.
- [Announcing Rust 1.85.0 and Rust 2024](https://blog.rust-lang.org/2025/02/20/Rust-1.85.0/) — The Rust Release Team, 2025. Backs: async closures, the three `AsyncFn` traits, futures that borrow from the closure's captures. [^10]

## Related
- `rust/closures-and-iterators/iterators.md` — adapters such as `map` and `filter` take closures.
- `rust/traits-and-generics/advanced-traits-and-type-system.md` — function pointers versus closures.
- `rust/traits-and-generics/trait-objects-and-dynamic-dispatch.md` — what is inside a `Box<dyn Fn>`.
- `rust/concurrency/threads-channels-and-locks.md` — `move` closures and `thread::spawn`.
- `rust/ownership/borrow-checker-errors.md` — E0373, E0382 and other borrow errors.
- `javascript/advanced-functions/scope-closures-and-var.md` — closures in a garbage-collected language.
