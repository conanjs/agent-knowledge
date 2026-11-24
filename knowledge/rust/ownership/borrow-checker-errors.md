---
schema: knowledge-doc/v1
type: reference
topic: rust/ownership
status: verified
applies-to: ["Rust 1.100.0", "edition 2024"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [rust, borrow-checker, error-codes, e0382, e0499, e0502, e0505, e0507, e0597, e0716, lifetimes]
---

# Borrow-checker and move error codes

## Summary
**TL;DR:** A lookup table of the move, borrow and lifetime errors rustc reports most often, each with the exact first line rustc 1.100.0 prints, a minimal program that triggers it, and the usual fix. Every row was compiled in the lab, and each meaning is backed by the code's page in the rustc error index.
**Use this when:** you have an `error[E0…]` from the borrow checker and want the meaning and the standard fix fast, or you want a minimal reproduction for a code review comment.
**Not this doc:** why the rules exist and how they work → `rust/ownership/ownership-moves-and-drop.md`, `rust/ownership/borrowing-references-and-slices.md`, `rust/ownership/lifetimes.md`; `RefCell` run-time borrow panics → `rust/smart-pointers/rc-refcell-and-interior-mutability.md`; `Send`/`Sync` errors (`E0277`) → `rust/concurrency/threads-channels-and-locks.md`.

## Scope
rustc 1.100.0, compiled with `rustc --edition 2024 file.rs` in the lab; the `E0700` row and one `E0597` row compare editions 2021 and 2024 ✅[^1]. Covers the error codes of the borrow checker and the move checker, the lifetime errors that come from signatures and bounds, and the two errors that block deriving `Copy`. "First line" is rustc's headline, copied from the lab output; the trigger is the smallest program body that produced it. The meaning column paraphrases the code's page in the error index.

## Catalog

### Moves, copies and initialization
| Code | First line (rustc 1.100.0) | Minimal trigger | Meaning | Usual fix | Explained in |
|---|---|---|---|---|---|
| E0381 | `` used binding `port` is possibly-uninitialized `` ✅[^1] | `let port: u16; if cond { port = 80; } println!("{port}");` | A variable is read before it is surely initialized ✅[^2] | Initialize on every path; rustc labels where "an `else` arm might be missing" ✅[^1] | `rust/fundamentals/variables-types-and-control-flow.md` |
| E0382 | `` borrow of moved value: `title` `` ✅[^1] | `let moved = title; println!("{title}");` | A value is used after it was moved ✅[^3] | Borrow (`&title`), `clone()`, or make the type `Copy` ✅[^3] | `rust/ownership/ownership-moves-and-drop.md` |
| E0382 | `` use of moved value: `note` `` ✅[^1] | `archive(note); archive(note);` with `fn archive(_s: String)`; inside a loop the label is "value moved here, in previous iteration of loop" ✅[^1] | Same code, a by-value use | Change the parameter to `&str` (rustc's note), or clone per call ✅[^1] | `rust/ownership/ownership-moves-and-drop.md` |
| E0382 | `` borrow of partially moved value: `t` `` ✅[^1] | `let owner = t.owner; println!("{:?}", t);` | One field was moved out | Borrow the field (`let owner = &t.owner;`) instead of moving it ✅[^1] | `rust/ownership/ownership-moves-and-drop.md` |
| E0382 | `` use of moved value: `r` `` (with `r: &mut u32`) ✅[^1] | `sink(r); *r += 1;` with `fn sink<T>(_t: T)` | A `&mut` passed as a generic `T` is moved | Pass `&mut *r` (rustc's own help) ✅[^1] | `rust/ownership/borrowing-references-and-slices.md` |
| E0384 | `` cannot assign twice to immutable variable `retries` `` ✅[^1] | `let retries = 3; retries = 4;` | An immutable binding is reassigned ✅[^4] | `let mut`, or shadow with a new `let` ✅[^4] | `rust/fundamentals/variables-types-and-control-flow.md` |
| E0505 | `` cannot move out of `path` because it is borrowed `` ✅[^1] | `let view = &path; consume(path); println!("{view}");` | A value is moved while a borrow is still used ✅[^5] | Finish with the borrow first, pass by reference, or clone ✅[^5] | `rust/ownership/borrowing-references-and-slices.md` |
| E0507 | `` cannot move out of index of `Vec<String>` `` ✅[^1] | `let first = tags[0];` | Moving out of borrowed content ✅[^6] | `&tags[0]`, `.clone()`, `std::mem::take(&mut tags[0])`, `tags.remove(0)` ✅[^1] | `rust/ownership/ownership-moves-and-drop.md` |
| E0507 | `` cannot move out of `j.name` which is behind a shared reference `` ✅[^1] | `fn name_of(j: &Job) -> String { j.name }` | Same; the field is behind `&` | `j.name.clone()`, or take `Job` by value | `rust/ownership/ownership-moves-and-drop.md` |
| E0507 | `` cannot move out of an `Rc` `` ✅[^1] | `let s: String = *shared;` with `shared: Rc<String>` | Same; only `Box` allows moving out through `*` | `(*shared).clone()`, or `Rc::try_unwrap` when the count is 1 ✅[^1] | `rust/smart-pointers/rc-refcell-and-interior-mutability.md` |
| E0508 | ``cannot move out of type `[String; 2]`, a non-copy array`` ✅[^1] | `let w = words[0];` | Moving an element out of a fixed-size array ✅[^7] | `&words[0]`, `.clone()`, or destructure `let [a, b] = words;` ✅[^7] ✅[^1] | `rust/ownership/ownership-moves-and-drop.md` |
| E0509 | ``cannot move out of type `Conn`, which implements the `Drop` trait`` ✅[^1] | `let a = c.addr;` where `Conn: Drop` | Moving a field out of a type with a destructor ✅[^8] | Borrow the field (`&c.addr`, `ref`) ✅[^8], or `std::mem::take(&mut c.addr)`, which leaves `""` for `Drop` to see ✅[^1] | `rust/ownership/ownership-moves-and-drop.md` |
| E0204 | ``the trait `Copy` cannot be implemented for this type`` ✅[^1] | `#[derive(Clone, Copy)] struct User { id: u32, name: String }` | A `Copy` type has a non-`Copy` field ✅[^9] | Drop `Copy`, keep `Clone` ✅[^9] | `rust/ownership/ownership-moves-and-drop.md` |
| E0184 | ``the trait `Copy` cannot be implemented for this type; the type has a destructor`` ✅[^1] | `#[derive(Clone, Copy)] struct Handle(u32); impl Drop for Handle { … }` | `Copy` and `Drop` on one type ✅[^10] | Choose one; a type with cleanup is not `Copy` | `rust/ownership/ownership-moves-and-drop.md` |

### Borrow conflicts
| Code | First line (rustc 1.100.0) | Minimal trigger | Meaning | Usual fix | Explained in |
|---|---|---|---|---|---|
| E0499 | ``cannot borrow `level` as mutable more than once at a time`` ✅[^1] | `let a = &mut level; let b = &mut level; *a += 1;` | Two overlapping `&mut` ✅[^11] | One `&mut` at a time, or shared borrows if no writes ✅[^11] | `rust/ownership/borrowing-references-and-slices.md` |
| E0499 | ``cannot borrow `v` as mutable more than once at a time`` ✅[^1] | `let a = &mut v[0]; let b = &mut v[2]; std::mem::swap(a, b);` | Index borrows cover the whole `Vec` | `v.swap(0, 2)`, `split_at_mut` (rustc's help) or `get_disjoint_mut` ✅[^1] | `rust/ownership/borrowing-references-and-slices.md` |
| E0499 | ``cannot borrow `t` as mutable more than once at a time`` ✅[^1] | Keeping two results of `fn next_token(&mut self) -> Option<&str>` | The elided output is tied to `&mut self` | Return the input's lifetime: `-> Option<&'s str>` ✅[^1] | `rust/ownership/lifetimes.md` |
| E0502 | ``cannot borrow `names` as mutable because it is also borrowed as immutable`` ✅[^1] | `let first = &names[0]; names.push(…); println!("{first}");` | A shared and a mutable borrow overlap ✅[^12] | Use `first` before the `push`, or copy the value out ✅[^12] | `rust/ownership/borrowing-references-and-slices.md` |
| E0502 | ``cannot borrow `ids` as mutable because it is also borrowed as immutable`` ✅[^1] | `for id in &ids { ids.push(4); }` | The loop holds `&ids` | Collect changes, then apply; or an index loop (rustc's help) ✅[^1] | `rust/collections/vec-hashmap-and-std-collections.md` |
| E0502 | ``cannot borrow `v` as immutable because it is also borrowed as mutable`` ✅[^1] | `Vec::push(&mut v, v.len());` | An explicit `&mut` is not two-phase | Method syntax `v.push(v.len())`, or compute `let n = v.len();` first ✅[^1] | `rust/ownership/borrowing-references-and-slices.md` |
| E0503 | ``cannot use `count` because it was mutably borrowed`` ✅[^1] | `let r = &mut count; let copy = count; *r += 1;` | A value is used while a `&mut` to it is live ✅[^13] | End the `&mut` first, or read through `r` ✅[^13] | `rust/ownership/borrowing-references-and-slices.md` |
| E0506 | ``cannot assign to `limit` because it is borrowed`` ✅[^1] | `let r = &limit; limit = 20; println!("{r}");` | Assigning to a borrowed value ✅[^14] | Use the borrow first, or scope it in a block ✅[^14] | `rust/ownership/borrowing-references-and-slices.md` |
| E0594 | ``cannot assign to `*n`, which is behind a `&` reference`` ✅[^1] | `fn reset(n: &u32) { *n = 0; }` | Writing through a shared reference ✅[^15] | Take `&mut u32` (rustc's help) ✅[^1] | `rust/ownership/borrowing-references-and-slices.md` |
| E0596 | ``cannot borrow `list` as mutable, as it is not declared as mutable`` ✅[^1] | `let list = Vec::new(); list.push(1);` | Mutable borrow of a non-`mut` binding ✅[^16] | `let mut list` ✅[^16] | `rust/ownership/borrowing-references-and-slices.md` |
| E0596 | ``cannot borrow data in an `Rc` as mutable`` ✅[^1] | `let list = Rc::new(vec![1]); list.push(2);` | `Rc` has no `DerefMut` (rustc's help) ✅[^1] | `Rc<RefCell<Vec<_>>>`, or `Rc::make_mut(&mut list).push(2)` ✅[^1] | `rust/smart-pointers/rc-refcell-and-interior-mutability.md` |

### Lifetimes and scope
| Code | First line (rustc 1.100.0) | Minimal trigger | Meaning | Usual fix | Explained in |
|---|---|---|---|---|---|
| E0106 | `missing lifetime specifier` ✅[^1] | `fn longer(a: &str, b: &str) -> &str` | An output lifetime cannot be elided ✅[^17] | Name it: `fn longer<'a>(a: &'a str, b: &'a str) -> &'a str` ✅[^1] | `rust/ownership/lifetimes.md` |
| E0106 | `missing lifetime specifier` ✅[^1] | `fn dangle() -> &String { let s = …; &s }` | No input to borrow from ✅[^17] | Return `String` (rustc's second help) ✅[^1] | `rust/ownership/borrowing-references-and-slices.md` |
| E0515 | ``cannot return reference to local variable `s` `` ✅[^1] | `fn make_label() -> &'static str { let s = String::from("tmp"); &s }` | Returning a reference to data the function owns ✅[^18] | Return the owned value ✅[^18] | `rust/ownership/borrowing-references-and-slices.md` |
| E0597 | `` `inner` does not live long enough `` ✅[^1] | `let r; { let inner = 5; r = &inner; } println!("{r}");` | A value is dropped while still borrowed ✅[^19] | Declare it in the outer scope ✅[^19] | `rust/ownership/lifetimes.md` |
| E0597 | `` `y` does not live long enough `` ✅[^1] | `result = longer(x.as_str(), y.as_str());` in an inner block, `result` used after it | `'a` is the shorter of the two inputs | Use the result inside the block ✅[^1], or return an owned `String` | `rust/ownership/lifetimes.md` |
| E0597 | `` `local` does not live long enough `` ✅[^1] | `keep(&local)` with `fn keep<T: Send + 'static>(value: T)` | The label says "argument requires that `local` is borrowed for `'static`" | Pass an owned value (`keep(local)`) ✅[^1] | `rust/ownership/lifetimes.md` |
| E0597 | `` `s` does not live long enough `` ✅[^1] | Edition 2024: `fn summary(x: &str) -> impl Display { x.len() }`, result used after the `String` drops | The `impl Trait` captures `x`'s lifetime (the note names the 2024 capture rules) | `-> impl Display + use<>` ✅[^1] | `rust/ownership/lifetimes.md` |
| E0716 | `temporary value dropped while borrowed` ✅[^1] | `s = String::from("temp").as_str(); println!("{s}");` | A temporary is freed at the end of its statement while borrowed ✅[^20] | Bind it: `let owned = String::from("temp"); s = owned.as_str();` ✅[^20] | `rust/ownership/ownership-moves-and-drop.md` |
| E0373 | ``closure may outlive the current function, but it borrows `data`, which is owned by the current function`` ✅[^1] | `thread::spawn(\|\| println!("{:?}", data));` | A closure that may outlive the function borrows a local ✅[^21] | `move \|\| …` ✅[^21] | `rust/closures-and-iterators/closures-and-fn-traits.md` |
| E0521 | `borrowed data escapes outside of function` ✅[^1] | `fn log_later(msg: &str) { std::thread::spawn(move \|\| println!("{msg}")); }` | A borrowed parameter is sent somewhere that needs `'static`; the note names `spawn` ✅[^1] | Take an owned `String`, or borrow inside `std::thread::scope` ✅[^1] | `rust/concurrency/threads-channels-and-locks.md` |
| E0310 | ``the parameter type `T` may not live long enough`` ✅[^1] | `fn boxed<T: Display>(t: T) -> Box<dyn Display> { Box::new(t) }` | A generic type lacks a lifetime bound the target needs ✅[^22] | `T: 'static`, or `<'a, T: Display + 'a> … Box<dyn Display + 'a>` ✅[^1] | `rust/ownership/lifetimes.md` |
| E0621 | ``explicit lifetime required in the type of `b` `` ✅[^1] | `fn pick<'a>(a: &'a str, b: &str) -> &'a str { if a.is_empty() { b } else { a } }` | Signature and body disagree about lifetimes ✅[^23] | Give `b` the `'a` too, or return only `a` ✅[^23] | `rust/ownership/lifetimes.md` |
| E0700 | ``hidden type for `impl Iterator<Item = i32>` captures lifetime that does not appear in bounds`` ✅[^1] | Edition 2021 only: `fn doubled(xs: &[i32]) -> impl Iterator<Item = i32> { xs.iter().map(\|x\| x * 2) }` | The returned type uses a lifetime the `impl Trait` does not mention ✅[^24] | `+ use<'_>` (rustc's help) or edition 2024, where it compiles ✅[^1] | `rust/ownership/lifetimes.md` |
| (none) | `lifetime may not live long enough` ✅[^1] | `fn pick(&self, other: &str) -> &str { other }` | The returned reference has a different lifetime than the elided output | `fn pick<'a>(&self, other: &'a str) -> &'a str` (rustc's help) ✅[^1] | `rust/ownership/lifetimes.md` |

## Lookup notes
- One code covers several headlines: `E0382` reads "borrow of moved value", "use of moved value" or "borrow of partially moved value" depending on the use ✅[^1].
- The `E0521` index page shows a closure-parameter case and says "outside of closure"; for the `thread::spawn` case rustc 1.100.0 prints "outside of function" ✅[^25] ✅[^1].
- `E0700` for a missing capture appears in edition 2021; the same function compiles in 2024, and the reverse case is an `E0597` that only 2024 reports ✅[^1].
- `rustc --explain E0502` prints the index page's text offline, starting "A variable already borrowed with a certain mutability" ✅[^1] ✅[^12].
- Each headline is followed by labelled spans ("first mutable borrow occurs here", "borrow later used here"); the line numbers in those labels point at the three places to look: where the borrow starts, the conflicting use, and the later use that keeps the borrow alive ✅[^1].

## Takeaways
- Read the three labels of a borrow error (start, conflict, later use) before changing code; moving the later use is often the whole fix.
- Prefer rustc's `help:` suggestion when it proposes a borrow or `&mut *r`; treat a suggested `'static` or `clone()` as a last resort. [rule-candidate]
- Quote the error code and its minimal trigger from this table in review comments instead of pasting whole compiler output.

## Verification status
- Verified: 113 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `linux/lab-setup.md` — the Rust 1.100.0 lab (`rustlab:1`) where every behaviour marked with this note ran on 2026-11-24. [^1]
- [E0381](https://doc.rust-lang.org/error_codes/E0381.html) — Error codes index, Rust project, living. Backs: E0381 meaning and fix. [^2]
- [E0382](https://doc.rust-lang.org/error_codes/E0382.html) — Error codes index, Rust project, living. Backs: E0382 meaning and fixes. [^3]
- [E0384](https://doc.rust-lang.org/error_codes/E0384.html) — Error codes index, Rust project, living. Backs: E0384 meaning and fixes. [^4]
- [E0505](https://doc.rust-lang.org/error_codes/E0505.html) — Error codes index, Rust project, living. Backs: E0505 meaning and fixes. [^5]
- [E0507](https://doc.rust-lang.org/error_codes/E0507.html) — Error codes index, Rust project, living. Backs: E0507 meaning. [^6]
- [E0508](https://doc.rust-lang.org/error_codes/E0508.html) — Error codes index, Rust project, living. Backs: E0508 meaning and fixes. [^7]
- [E0509](https://doc.rust-lang.org/error_codes/E0509.html) — Error codes index, Rust project, living. Backs: E0509 meaning, borrow with `ref`. [^8]
- [E0204](https://doc.rust-lang.org/error_codes/E0204.html) — Error codes index, Rust project, living. Backs: E0204 meaning and fixes. [^9]
- [E0184](https://doc.rust-lang.org/error_codes/E0184.html) — Error codes index, Rust project, living. Backs: E0184 meaning. [^10]
- [E0499](https://doc.rust-lang.org/error_codes/E0499.html) — Error codes index, Rust project, living. Backs: E0499 meaning and fixes. [^11]
- [E0502](https://doc.rust-lang.org/error_codes/E0502.html) — Error codes index, Rust project, living. Backs: E0502 meaning and fix. [^12]
- [E0503](https://doc.rust-lang.org/error_codes/E0503.html) — Error codes index, Rust project, living. Backs: E0503 meaning and fixes. [^13]
- [E0506](https://doc.rust-lang.org/error_codes/E0506.html) — Error codes index, Rust project, living. Backs: E0506 meaning and fixes. [^14]
- [E0594](https://doc.rust-lang.org/error_codes/E0594.html) — Error codes index, Rust project, living. Backs: E0594 meaning. [^15]
- [E0596](https://doc.rust-lang.org/error_codes/E0596.html) — Error codes index, Rust project, living. Backs: E0596 meaning and fix. [^16]
- [E0106](https://doc.rust-lang.org/error_codes/E0106.html) — Error codes index, Rust project, living. Backs: E0106 meaning, elision cases. [^17]
- [E0515](https://doc.rust-lang.org/error_codes/E0515.html) — Error codes index, Rust project, living. Backs: E0515 meaning and fix. [^18]
- [E0597](https://doc.rust-lang.org/error_codes/E0597.html) — Error codes index, Rust project, living. Backs: E0597 meaning and fix. [^19]
- [E0716](https://doc.rust-lang.org/error_codes/E0716.html) — Error codes index, Rust project, living. Backs: E0716 meaning, `let` binding fix. [^20]
- [E0373](https://doc.rust-lang.org/error_codes/E0373.html) — Error codes index, Rust project, living. Backs: E0373 meaning, `move` fix. [^21]
- [E0310](https://doc.rust-lang.org/error_codes/E0310.html) — Error codes index, Rust project, living. Backs: E0310 meaning. [^22]
- [E0621](https://doc.rust-lang.org/error_codes/E0621.html) — Error codes index, Rust project, living. Backs: E0621 meaning and fixes. [^23]
- [E0700](https://doc.rust-lang.org/error_codes/E0700.html) — Error codes index, Rust project, living. Backs: E0700 meaning. [^24]
- [E0521](https://doc.rust-lang.org/error_codes/E0521.html) — Error codes index, Rust project, living. Backs: the index page's closure example and wording. [^25]

## Related
- `rust/ownership/ownership-moves-and-drop.md` — moves, `Copy` and drop order.
- `rust/ownership/borrowing-references-and-slices.md` — the borrow rules, NLL, two-phase borrows, reborrowing.
- `rust/ownership/lifetimes.md` — elision, `'static`, `impl Trait` capture.
- `rust/smart-pointers/rc-refcell-and-interior-mutability.md` — the run-time equivalents (`RefCell` panics).
