---
schema: knowledge-doc/v1
type: concept
topic: rust/ownership
status: verified
applies-to: ["Rust 1.100.0", "edition 2024"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [rust, borrowing, references, aliasing, nll, two-phase-borrows, reborrow, slices, str]
---

# Borrowing, references and slices

## Summary
**TL;DR:** A reference uses a value without owning it. At any point a value has either any number of shared references `&T` or exactly one mutable reference `&mut T` (aliasing XOR mutation, "many readers or one writer"), and a reference must never outlive its value. Since NLL (non-lexical lifetimes) a borrow lasts until its **last use**, not to the end of the block; two-phase borrows let `v.push(v.len())` compile; and passing a `&mut` to a `&mut` parameter **reborrows** it instead of moving it. Slices `&[T]` and `&str` are references to a contiguous run of elements: a pointer plus a length, 16 bytes on a 64-bit target.
**Use this when:** the compiler reports `E0499`, `E0502` or `E0506`, you wonder why a borrow ends earlier (or later) than the block, you pass `&mut` through several calls, or you choose `&str`/`&[T]` versus `&String`/`&Vec<T>` for a parameter.
**Not this doc:** lifetime annotations and elision → `rust/ownership/lifetimes.md`; error-code lookup → `rust/ownership/borrow-checker-errors.md`; moves and drop → `rust/ownership/ownership-moves-and-drop.md`; runtime-checked borrows (`RefCell`) → `rust/smart-pointers/rc-refcell-and-interior-mutability.md`; UTF-8 boundaries when slicing a `str` → `rust/collections/strings-and-utf-8.md`; modifying a collection while iterating → `rust/collections/vec-hashmap-and-std-collections.md`; closures that borrow → `rust/closures-and-iterators/closures-and-fn-traits.md`; data races between threads → `concurrency/shared-state-and-data-races.md`.

## Problem
A reference to the first element of a vector would point to freed memory after a `push` that has to move the buffer, and the borrow rules exist to reject that program ✅[^11]; the same rules rule out data races ✅[^2]. They surprise in both directions, though: code that looks fine is rejected (`E0502` on `Vec::push(&mut v, v.len())`), and code that looks like it should be rejected compiles (`v.push(v.len())`, or a `push` while a reference is still "in scope") ✅[^1]. Without the rules below, people add `clone()` calls and extra blocks they do not need.

## Mental model
**Analogy:** a reference book in a library. Shared borrows are reading-room passes: many readers at once, nobody writes in it. A mutable borrow checks the book out to one person with a pencil; nobody else may even read it until it comes back. The librarian (the borrow checker) checks every loan before the program runs, and a loan ends when the borrower last touches the book, not when they leave the building.

**Artifact:** the borrow of `queue[0]` ends at its last use, so the `push` is accepted ✅[^1]:
```rust
let mut queue = vec![10u32, 20];
let head = &queue[0];
println!("head = {head}");     // last use of `head`: the shared borrow ends here
queue.push(30);                // accepted
println!("queue = {:?}", queue);
// head = 10
// queue = [10, 20, 30]
```
Moving the `println!("{head}")` below the `push` gives `` error[E0502]: cannot borrow `queue` as mutable because it is also borrowed as immutable `` ✅[^1].

## How it works
1. **Two kinds of reference.** `&x` creates a shared reference and `&mut x` a mutable one; creating a reference is called borrowing ✅[^2]. The rules: at any given time either one mutable reference or any number of immutable ones, and references must always be valid ✅[^2].
2. **Why exclusivity.** A data race needs two pointers to the same data at the same time, at least one writing, and no synchronization; forbidding a second reference while a `&mut` exists makes that state impossible to write ✅[^2]. A `&mut` also needs a `mut` binding (`E0596`), and writing through a `&T` is `E0594` ✅[^1].
3. **NLL: a borrow is a set of program points.** The borrow checker models a lifetime as the set of points in the MIR (mid-level intermediate representation) control-flow graph where the reference may still be used ✅[^3] ✅[^4]; the Book puts it as a reference's scope running from where it is introduced to its last use ✅[^2]. NLL is the default for every edition since Rust 1.63 ✅[^5]. RFC 2094's problem case #1 (a `&mut data[..]` stored in a variable, used, then `data.push(b'd')`) and case #2 (`match map.get_mut(k) { Some(n) => …, None => { map.insert(k, 1); } }`) both compile on 1.100.0 ✅[^1] ✅[^4].
4. **What NLL still rejects.** Problem case #3, returning `map.get_mut(&key)` from one branch and calling `map.insert` in the other, is `` error[E0499]: cannot borrow `*map` as mutable more than once at a time `` on stable 1.100.0 ✅[^1]. Polonius, the next-generation borrow checker, is provisionally integrated into rustc and reached through nightly `-Zpolonius` ✅[^5] ✅[^6], and `rustc +nightly -Zpolonius` (1.102.0-nightly) accepts the same function ✅[^1].
5. **Two-phase borrows.** Three implicit mutable borrows are two-phase: the autoref of a method call with a `&mut self` receiver, a mutable reborrow in a function argument, and the implicit borrow of an overloaded compound assignment ✅[^7]. `v.push(v.len())` becomes `temp1 = &two_phase v; temp2 = v.len(); Vec::push(temp1, temp2)`: from the reservation to the activation (the call) the borrow acts as a shared one, so `v.len()` may read `v` ✅[^7]. An explicit `&mut` is never two-phase: `Vec::push(&mut v, v.len())` and `append(&mut v, v.len())` are `E0502`, while `let r = &mut v; append(r, r.len());` compiles ✅[^1] ✅[^7].
6. **Reborrowing.** `&mut T` is not `Copy` ✅[^8], yet `bump(r); bump(r);` compiles when `fn bump(n: &mut u32)`: an argument of `&mut` type is passed as a fresh reborrow `&mut *r`, and `r` is usable again after the call ✅[^1] ✅[^7]. When the parameter is a bare generic `T`, no reborrow happens: `sink(r)` moves `r`, and the next use is `E0382` with the help "consider creating a fresh reborrow of `r` here", suggesting `sink(&mut *r)` ✅[^1]. `&mut T` also coerces to `&T` at a coercion site ✅[^9] ✅[^1].
7. **Disjoint borrows.** Two `&mut` to different fields of one struct coexist (`let (px, py) = (&mut p.x, &mut p.y);`) ✅[^1]. The checker does not see inside indexing or method calls: `&mut v[0]` and `&mut v[2]` together are `E0499` with the help "use `.split_at_mut(position)`", and `&mut p.x` live across `p.bump_y()` is `E0499` ✅[^1]. `split_at_mut(2)` and `get_disjoint_mut([0, 2])` hand out non-overlapping `&mut` safely ✅[^1].
8. **No dangling references.** `fn dangle() -> &String { let s = …; &s }` is `error[E0106]: missing lifetime specifier`, with the help "this function's return type contains a borrowed value, but there is no value for it to be borrowed from" ✅[^1] ✅[^2]; with a `'static` return type instead (`fn make_label() -> &'static str { let s = String::from("tmp"); &s }`) it is `E0515: cannot return reference to local variable` ✅[^1]. Return the owned value.
9. **Slices.** A slice references a contiguous sequence inside a collection and owns nothing; it stores a pointer and a length ✅[^10]. Measured on aarch64: `&u32` is 8 bytes, `&[u32]`, `&str` and `&mut [u8]` are 16 ✅[^1]. String literals are `&'static str` slices into the binary ✅[^10]. A `&str` parameter accepts both `&String` and literals through deref coercion, and `&[T]` accepts `&Vec<T>` and `&[T; N]` ✅[^10] ✅[^1]. A range past the end panics at run time with `range end index 10 out of range for slice of length 3` ✅[^1].

## Worked example
One `main` (built with `--edition 2024`), each step with the borrows alive after it and the real output ✅[^1]:

| Step | Code | Borrows alive afterwards | Output |
|---|---|---|---|
| 1 | `let scores = vec![3u32, 5, 8]; let r1 = &scores; let r2 = &scores; println!("{} {}", r1.len(), total(r2));` | none (last uses passed) | `3 16` |
| 2 | `let mut queue = vec![10u32, 20]; let head = &queue[0]; println!("{head}"); queue.push(30);` | none: `head` ended at its last use | `10`, then `[10, 20, 30]` |
| 3 | `queue.push(queue.len() as u32);` | none: two-phase borrow, reserved then activated | `[10, 20, 30, 3]` |
| 4 | `let mut hits = 0u32; let r = &mut hits; bump(r); bump(r); *r += 10;` | `r` until its last use | `hits = 12` |
| 5 | `let line = String::from("GET /index.html HTTP/1.1"); let verb = first_token(&line);` with `fn first_token(line: &str) -> &str` | `verb` borrows `line` | `GET` |
| 6 | `let arr = [1u32, 2, 3, 4, 5]; let mid: &[u32] = &arr[1..4];` | `mid` borrows `arr` | `[2, 3, 4]`, total `9` |
| 7 | `let mut cells = [0u8; 4]; let (left, right) = cells.split_at_mut(2); left[0] = 1; right[0] = 9;` | two disjoint `&mut`, then none | `[1, 0, 9, 0]` |

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `for id in &ids { ids.push(4); }` | `E0502`, with the note "this for loop borrows `ids` immutably" and the help to use an index loop or collect changes separately ✅[^1] | The loop's iterator holds `&ids` for the whole loop |
| `Vec::push(&mut v, v.len())` | `E0502` although `v.push(v.len())` compiles ✅[^1] | Explicit `&mut` is never two-phase ✅[^7] |
| `let r = &mut count; let copy = count; *r += 1;` | `` error[E0503]: cannot use `count` because it was mutably borrowed `` ✅[^1] | Even reading a `Copy` value conflicts with a live `&mut` |
| `let r = &limit; limit = 20; println!("{r}");` | `` error[E0506]: cannot assign to `limit` because it is borrowed `` ✅[^1] | Assignment would change what `r` sees |
| Conditional return of a `&mut` borrow (NLL case #3) | `E0499` on stable; accepted by `-Zpolonius` on nightly ✅[^1] | The error's note reads "returning this value requires that `*map` is borrowed for `'m`": stable NLL keeps that borrow alive on the `insert` path too ✅[^1]. Workarounds that compile on stable: test `contains_key` first and return early (the RFC's `get_default2` shape) ✅[^4] ✅[^1], or `map.entry(key).or_insert(0)` ✅[^1] |
| `&mut p.x` alive across `p.bump_y()` | `E0499`, with the second borrow pointing at `p` ✅[^1] | The `&mut self` call borrows all of `p`; finish with `a` first, or pass the fields separately |
| A `&mut` passed to `fn sink<T>(t: T)` | Moved, not reborrowed; write `sink(&mut *r)` to keep `r` ✅[^1] | Reborrows happen only where a `&mut` type is expected ✅[^7] |
| `&v[1..10]` on a 3-element `Vec` | Panics: `range end index 10 out of range for slice of length 3` ✅[^1] | Slice bounds are checked at run time |

## Trade-offs
| Fix for a borrow conflict | Gains | Costs |
|---|---|---|
| Reorder so the borrow's last use comes before the conflicting access | Free; NLL accepts it ✅[^1] | Not always possible |
| Copy or clone the value out (`let first = v[0];` for `Copy`, `.clone()` otherwise) | The borrow ends at once | A copy or an allocation |
| Keep an index instead of a reference | No borrow outstanding | A bounds check per access; the index can point at a different element after a removal |
| `split_at_mut` / `get_disjoint_mut` | Two `&mut` into one slice, checked | Slices only |
| `RefCell` | Borrow rules checked at run time | A possible panic (`rust/smart-pointers/rc-refcell-and-interior-mutability.md`) |

## Takeaways
- Take `&str` and `&[T]` parameters, not `&String` and `&Vec<T>`; callers can pass both. [rule-candidate]
- When a borrow error appears, first move the reference's last use earlier; NLL ends the borrow there.
- To keep using a `&mut` after passing it to a generic function, pass `&mut *r`.
- For two mutable elements of one slice, use `split_at_mut` or `get_disjoint_mut` instead of two index borrows. [rule-candidate]
- Never return a reference to a local; return the owned value. [rule-candidate]

## Verification status
- Verified: 57 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `linux/lab-setup.md` — the Rust 1.100.0 lab (`rustlab:1`) where every behaviour marked with this note ran on 2026-11-24. [^1]
- [References and Borrowing](https://doc.rust-lang.org/book/ch04-02-references-and-borrowing.html) — The Rust Programming Language (Klabnik, Nichols, Krycho and the Rust community), living. Backs: borrowing, the rules of references, data races, scope ending at last use, dangling references and `E0106`. [^2]
- [Region inference](https://rustc-dev-guide.rust-lang.org/borrow-check/region-inference.html) — Rust Compiler Development Guide, living. Backs: a region as a set of MIR points. [^3]
- [2094-nll](https://rust-lang.github.io/rfcs/2094-nll.html) — The Rust RFC Book (Niko Matsakis), 2017. Backs: lifetimes as sets of control-flow points, problem cases #1–#3. [^4]
- [Non-lexical lifetimes (NLL) fully stable](https://blog.rust-lang.org/2022/08/05/nll-by-default/) — Niko Matsakis for the NLL working group, Rust Blog, 2022. Backs: NLL on for all editions from 1.63, Polonius as the next-generation checker. [^5]
- [Current status and roadmap](https://rust-lang.github.io/polonius/current_status.html) — Polonius book, Rust project, living. Backs: provisionally integrated into rustc, nightly `-Zpolonius`. [^6]
- [Two-phase-borrows](https://rustc-dev-guide.rust-lang.org/borrow-check/two-phase-borrows.html) — Rust Compiler Development Guide, living. Backs: the three two-phase cases, reservation and activation, argument reborrows, explicit `&mut` never two-phase. [^7]
- [Copy in std::marker](https://doc.rust-lang.org/std/marker/trait.Copy.html) — Rust standard library, living. Backs: `&mut T` is not `Copy`. [^8]
- [Type coercions](https://doc.rust-lang.org/reference/type-coercions.html) — The Rust Reference, living. Backs: `&mut T` to `&T`, coercion sites. [^9]
- [The Slice Type](https://doc.rust-lang.org/book/ch04-03-slices.html) — The Rust Programming Language, living. Backs: slices as references to a contiguous sequence, pointer and length, literals as `&str`, `&str` parameters. [^10]
- [Storing Lists of Values with Vectors](https://doc.rust-lang.org/book/ch08-01-vectors.html) — The Rust Programming Language, living. Backs: why a reference into a `Vec` blocks `push` (reallocation). [^11]

## Related
- `rust/ownership/lifetimes.md` — naming the lifetimes the borrow checker infers.
- `rust/ownership/borrow-checker-errors.md` — the codes above with fixes.
- `rust/collections/strings-and-utf-8.md` — why `&s[0..1]` can panic on a multibyte character.
- `rust/smart-pointers/rc-refcell-and-interior-mutability.md` — the same rules enforced at run time.
- `concurrency/shared-state-and-data-races.md` — data races across languages.
