---
schema: knowledge-doc/v1
type: concept
topic: rust/smart-pointers
status: verified
applies-to: ["Rust 1.100.0", "edition 2024"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [rust, smart-pointers, rc, weak, reference-counting, refcell, cell, oncecell, lazycell, interior-mutability, reference-cycles]
---

# `Rc`, `RefCell` and interior mutability

## Summary
**TL;DR:** `Rc<T>` gives one heap value several owners by counting strong pointers: `Rc::clone` adds one, dropping an `Rc` removes one, and the value is dropped when the count reaches zero. `Rc` hands out only `&T`, so mutating shared data needs **interior mutability**: `Cell<T>` moves values in and out and never lends a reference, `RefCell<T>` checks the borrow rules at run time and panics on a conflict (`RefCell already borrowed`), and `OnceCell`/`LazyCell` are written once. A cycle of `Rc`s is never freed; a `Weak<T>` (from `Rc::downgrade`) does not keep the value alive, so back-pointers such as a child's link to its parent are `Weak`. All of these are single-threaded.
**Use this when:** several parts of a single-threaded program must own the same value (graph nodes, a shared configuration, an observer list), you need to mutate through `&self`, you build a tree with parent links, a program panics with `RefCell already borrowed`, or memory is not freed and you suspect a cycle.
**Not this doc:** `Box`, `Deref`, `Drop` → `rust/smart-pointers/box-deref-and-drop.md`; the compile-time borrow rules that `RefCell` re-checks at run time → `rust/ownership/borrowing-references-and-slices.md`; the thread-safe counterparts `Arc`, `Mutex`, `RwLock`, `OnceLock`, `LazyLock` → `rust/concurrency/threads-channels-and-locks.md`; `UnsafeCell` and building your own cell → `rust/concurrency/building-a-spinlock-channel-and-arc.md`; why an `if let` over `cell.borrow()` panicked in 2021 but not 2024 → `rust/ownership/ownership-moves-and-drop.md`.

## Problem
Ownership gives every value one owner, but a graph node with two parents, or a cache read by many components, has no single owner. Borrowing does not help when no one scope outlives all users. `Rc` solves sharing, then mutation fails: `list.push(2)` on an `Rc<Vec<i32>>` is `` error[E0596]: cannot borrow data in an `Rc` as mutable `` ✅[^1]. Wrapping in `RefCell` compiles, but moves the borrow check to run time, where a forgotten guard becomes a panic ✅[^8]. And two `Rc`s that point at each other are never freed, with no error at all ✅[^1].

## Mental model
**Analogy:** `Rc` is a shared flat with a sign-out sheet: each housemate who holds a key adds a line, and the last one to hand back a key switches off the lights (drops the value). A `Weak` is a visitor's pass: it lets you ring the bell and find out if anyone still lives there, but it does not keep the flat rented. `RefCell` is a meeting room with a booking board: many people may book it to listen, or one person to rearrange the furniture, and a double booking is refused on the spot (a panic) instead of in advance (a compile error).

**Artifact:** the strong count of one `Rc<Config>` through clones and scopes ✅[^1]:
```rust
let cfg = Rc::new(Config { name: String::from("prod") });   // strong = 1
let worker_a = Rc::clone(&cfg);                              // strong = 2, same allocation
{ let _worker_b = cfg.clone(); }                             // 3 inside, back to 2 after
drop(worker_a);                                              // strong = 1
let weak = Rc::downgrade(&cfg);                              // strong = 1, weak = 1
drop(cfg);                                                   // prints "drop Config prod"
weak.upgrade().is_none()                                     // true; weak.strong_count() = 0
```

## How it works
1. **`Rc<T>` is shared ownership of a heap value** ✅[^2]. `Rc::clone(&a)` does not copy the value; it increments the reference count ✅[^3] ✅[^1], and `Rc::ptr_eq` confirms both handles point to one allocation ✅[^1]. Writing `Rc::clone(&a)` rather than `a.clone()` is the convention, to tell count bumps apart from deep copies ✅[^3] ✅[^2]. When the last `Rc` is dropped, the inner value is dropped ✅[^2] ✅[^1]. The handle measured 8 bytes on aarch64, so the counts live in the heap allocation, not in each handle ✅[^1].
2. **Single-threaded by type.** The counts are updated non-atomically, so the compiler stops an `Rc` from crossing threads: `thread::spawn(move || println!("{shared}"))` is ``error[E0277]: `Rc<i32>` cannot be sent between threads safely`` ✅[^2] ✅[^1]. Use `Arc` across threads ✅[^2].
3. **Read-only by default.** You cannot generally get `&mut T` out of an `Rc`; put a `Cell` or `RefCell` inside when you need mutation ✅[^2]. The exceptions check the count ✅[^4] ✅[^1]:
   - `Rc::get_mut` returns `Some(&mut T)` only when no other `Rc` or `Weak` exists (it returned `None` while a second `Rc` was alive);
   - `Rc::make_mut` clones the value into a new allocation when it is shared (clone-on-write): after `make_mut(&mut a).push(3)`, `a` was `[1, 2, 3]`, `b` stayed `[1, 2]`, and `ptr_eq` became `false`;
   - `Rc::try_unwrap` returns the value when exactly one strong reference is left (`Ok("solo")`), even if `Weak`s exist.
4. **Interior mutability.** Cell types allow mutation through a shared reference ("interior" mutability, versus the usual "inherited" mutability through `&mut`) ✅[^5]. `UnsafeCell<T>` is the only legal way to mutate behind a `&`; every safe cell is built on it ✅[^6]. The std docs call interior mutability a last resort, for mutability inside something immutable, implementation details of logically immutable methods (such as a cache), and `Clone` impls that must mutate ✅[^5].
5. **`Cell<T>`: move in, move out.** `Cell` never hands out a reference to its contents ✅[^5]: `get` returns a copy (only for `T: Copy`), `set` and `replace` store a new value, `take` leaves `Default::default()` ✅[^7]. It has the same in-memory representation as `T` ✅[^7]; `Cell<u32>` measured 4 bytes ✅[^1]. A `hits: Cell<u32>` counter incremented through `&self` read 2 after two calls; `Cell<String>::take` returned `"taken"` and left `""` ✅[^1].
6. **`RefCell<T>`: borrow rules at run time.** It enforces "many `&` or one `&mut`" dynamically and panics on a violation ✅[^5] ✅[^8]. 3 actors:
   - **Caller** — its job: ask for access, via `cell.borrow()` or `cell.borrow_mut()`.
   - **`RefCell<T>`** — its job: count the active borrows and refuse a conflicting one, via its internal borrow counter checked at run time.
   - **Guard (`Ref<T>` or `RefMut<T>`)** — its job: give access to the value, via `Deref`/`DerefMut`, and return the borrow, via its own drop.

   ```
   caller                      RefCell<Vec<i32>>                 guard
     │ cell.borrow()   ──────▶ shared count 0 → 1   ──────▶  Ref<Vec<i32>>  (Deref → &Vec<i32>)
     │ cell.borrow_mut() ────▶ count ≠ 0 → panic "RefCell already borrowed"
     │ Ref dropped     ──────▶ shared count 1 → 0
     │ cell.borrow_mut() ────▶ free → exclusive     ──────▶  RefMut<Vec<i32>> (DerefMut → &mut Vec<i32>)
     │ cell.borrow()   ──────▶ exclusive → panic "RefCell already mutably borrowed"
   ```
   1. **Caller → `RefCell` (run time, same thread):** `borrow()` returns a `Ref<T>` and raises the count of shared borrows; `borrow_mut()` returns a `RefMut<T>` ✅[^8].
   2. **Guard:** derefs to the value; when it goes out of scope, the count goes back down ✅[^8] ✅[^9]. `drop(guard)` releases a borrow early ✅[^10].
   3. **`RefCell` on a conflict:** `borrow` panics if the value is mutably borrowed, `borrow_mut` panics if it is borrowed at all ✅[^9]. The messages in 1.100.0 are `RefCell already borrowed` (a `borrow_mut` while any guard lives) and `RefCell already mutably borrowed` (a `borrow` while a `RefMut` lives) ✅[^1]. `try_borrow` and `try_borrow_mut` return an error instead: `Err(BorrowMutError)` while a `Ref` was alive ✅[^9] ✅[^1].

   The counter costs space: `RefCell<u32>` measured 16 bytes and `RefCell<Vec<u8>>` 32, against 4 and 24 for the bare types ✅[^1].
7. **`Rc<RefCell<T>>`: shared and mutable.** Several owners can then each mutate the value ✅[^8]: two `Rc` clones of one `RefCell<Vec<&str>>` pushed `"from writer1"` and `"from writer2"`, and the original saw both ✅[^1].
8. **Write-once cells.** `OnceCell<T>` (stable since 1.70) is written once and then lends `&T` without a run-time borrow check; `set` on a filled cell returns `Err(value)` ✅[^11] ✅[^1]. `LazyCell<T, F>` (stable since 1.80) runs its closure on first dereference ✅[^12]; in the lab, `lazy init runs` printed only at the first `*lazy`, which gave `42` twice ✅[^1].
9. **Cycles leak.** A cycle of `Rc`s never reaches a strong count of zero, so it is never freed, and memory leaks are memory-safe in Rust ✅[^13] ✅[^2]. Two `Peer`s pointing at each other through `RefCell<Option<Rc<Peer>>>` each had strong count 2; after both handles were dropped, neither `Drop` ran ✅[^1].
10. **`Weak<T>` breaks cycles.** `Rc::downgrade` returns a `Weak<T>` and raises the weak count, not the strong count, and the weak count does not have to reach zero for the value to be dropped ✅[^13]. `upgrade` returns `Option<Rc<T>>`: `None` once the value is gone ✅[^14] ✅[^1]. A `Weak` keeps the allocation alive but not the value ✅[^2]; `Weak::new()` allocates nothing and always upgrades to `None` ✅[^14].
11. **The thread-safe family.** These cells are not `Sync`; across threads the counterparts are `Mutex`/`RwLock` for `RefCell`, `OnceLock` for `OnceCell`, `LazyLock` for `LazyCell`, and atomics ✅[^5].

## Worked example
A directory tree where parents own children (`Rc`) and children point back (`Weak`), so dropping the root frees it while a child is still held ✅[^1]:
```rust
struct Dir { name: String, parent: RefCell<Weak<Dir>>, children: RefCell<Vec<Rc<Dir>>> }
// impl Drop for Dir prints "drop Dir <name>"
let src = dir("src");
{
    let root = dir("root");
    root.children.borrow_mut().push(Rc::clone(&src));   // root owns src (strong)
    *src.parent.borrow_mut() = Rc::downgrade(&root);     // src points back (weak)
}
```
| Step | `root` strong / weak | `src` strong / weak | `src.parent.upgrade()` | Output |
|---|---|---|---|---|
| `let src = dir("src")` | — | 1 / 0 | `None` (from `Weak::new()`) | `created: src strong = 1, weak = 0` |
| `root` built, `src` pushed, parent set | 1 / 1 | 2 / 0 | `Some("root")` | `inside scope: root strong = 1, weak = 1`, `src strong = 2, weak = 0` |
| `root`'s block ends | 1 → 0: dropped | 1 / 0 (root's `children` dropped its clone) | `None` | `drop Dir root` |
| end of `main` | — | 1 → 0 | — | `drop Dir src` |

With `parent: RefCell<Rc<Dir>>` instead, `root` and `src` would hold each other strongly, as the two `Peer`s did, and neither would be dropped ✅[^13] ✅[^1].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Two `borrow_mut()` guards alive at once | Panic `RefCell already borrowed` at the second call ✅[^1] | `borrow_mut` panics while any borrow is active ✅[^9] |
| `borrow()` while a `RefMut` is alive | Panic `RefCell already mutably borrowed` ✅[^1] | `borrow` panics while mutably borrowed ✅[^9] |
| The Book's example of the double `borrow_mut` | Its output block shows `RefCell already borrowed`, while its prose still says `already borrowed: BorrowMutError` ✅[^8] | The output matches 1.100.0 ✅[^1]; the prose is older |
| `RefCell` borrowed in an `if let` scrutinee and mutated in `else` | Panics in edition 2021, runs in 2024 ✅[^1] | Explained in `rust/ownership/ownership-moves-and-drop.md` |
| `Rc` cycle | No destructor runs, memory is not freed ✅[^1] | Strong counts never reach 0 ✅[^13] |
| `Rc::make_mut` with only `Weak`s left | The value is not cloned; the `Weak`s are disassociated and later upgrade to `None` ✅[^4] | Unique strong owner, so no copy is needed |
| `Rc` moved into `thread::spawn` | `E0277` ✅[^1] | `Rc` is not `Send` ✅[^2] |
| `OnceCell::set` on a filled cell | `Err("other")`, the first value stays ✅[^1] | Set-once ✅[^11] |
| `LazyCell` closure panics | The panic reaches the caller and the cell is poisoned; later accesses panic too ✅[^12] | Initialization never completed |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `Box<T>` | One owner, borrows checked at compile time ✅[^8] | No sharing |
| `Rc<T>` | Several owners of read-only data ✅[^8] | A count update per clone and drop; not `Send`; cycles leak ✅[^2] |
| `Cell<T>` | No size overhead (same layout as `T`) ✅[^7] and no borrow tracking, since it never lends a reference ✅[^5] | Only whole-value get/set/replace; `get` needs `Copy` |
| `RefCell<T>` | `&mut` access through `&self` ✅[^8] | A borrow counter (16 bytes for `RefCell<u32>` on aarch64), and conflicts surface as run-time panics ✅[^1] |
| `OnceCell<T>` / `LazyCell<T>` | Lazy, set-once data without run-time borrow checks ✅[^11] | Cannot be changed after initialization without `&mut` ✅[^5] |
| `Rc<RefCell<T>>` | Shared and mutable | Both sets of costs |

## Takeaways
- Write `Rc::clone(&x)`, not `x.clone()`, so reviewers can tell a count bump from a deep copy. [rule-candidate]
- Any back-pointer (child to parent, observer to subject) is a `Weak`; owning pointers go one way only. [rule-candidate]
- Keep `RefCell` guards short-lived: borrow, use, drop in one statement where possible; never hold a `borrow()` across a call that may `borrow_mut()` the same cell. [rule-candidate]
- Use `try_borrow_mut` where a conflict is an expected state rather than a bug.
- Prefer `Cell` over `RefCell` for small `Copy` state such as counters and flags.

## Verification status
- Verified: 80 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `linux/lab-setup.md` — the Rust 1.100.0 lab (`rustlab:1`) where every behaviour marked with this note ran on 2026-11-24. [^1]
- [std::rc](https://doc.rust-lang.org/std/rc/index.html) — Rust standard library, living. Backs: shared ownership, no `&mut` by default, non-atomic counts and `Send`, `Arc`, `Weak` keeps the allocation, cycles, `Rc::clone` convention, inner value dropped with the last `Rc`. [^2]
- [`Rc<T>`, the Reference Counted Smart Pointer](https://doc.rust-lang.org/book/ch15-04-rc.html) — The Rust Programming Language (Klabnik, Nichols, Krycho and the Rust community), living. Backs: `Rc::clone` increments the count, the convention. [^3]
- [Rc in std::rc](https://doc.rust-lang.org/std/rc/struct.Rc.html) — Rust standard library, living. Backs: `get_mut`, `make_mut`, `try_unwrap`, counts. [^4]
- [std::cell](https://doc.rust-lang.org/std/cell/index.html) — Rust standard library, living. Backs: interior versus inherited mutability, `Cell` never lends a reference, when to use, not `Sync`, thread-safe counterparts. [^5]
- [Interior mutability](https://doc.rust-lang.org/reference/interior-mutability.html) — The Rust Reference, living. Backs: `UnsafeCell` is the only way to mutate behind `&`. [^6]
- [Cell in std::cell](https://doc.rust-lang.org/std/cell/struct.Cell.html) — Rust standard library, living. Backs: `get`, `set`, `replace`, `take`, same representation as `T`. [^7]
- [`RefCell<T>` and the Interior Mutability Pattern](https://doc.rust-lang.org/book/ch15-05-interior-mutability.html) — The Rust Programming Language, living. Backs: run-time borrow tracking, `Ref`/`RefMut`, panics, `Rc<RefCell<T>>`, the Box/Rc/RefCell comparison, the example output and prose. [^8]
- [RefCell in std::cell](https://doc.rust-lang.org/std/cell/struct.RefCell.html) — Rust standard library, living. Backs: panic conditions of `borrow`/`borrow_mut`, `try_` variants, borrow lasts until the guard leaves scope. [^9]
- [drop in std::mem](https://doc.rust-lang.org/std/mem/fn.drop.html) — Rust standard library, living. Backs: dropping a guard releases a `RefCell` borrow. [^10]
- [OnceCell in std::cell](https://doc.rust-lang.org/std/cell/struct.OnceCell.html) — Rust standard library, living. Backs: write-once semantics, `set` returning `Err(value)`, stable since 1.70.0. [^11]
- [LazyCell in std::cell](https://doc.rust-lang.org/std/cell/struct.LazyCell.html) — Rust standard library, living. Backs: initialized on first access, poisoning on panic, stable since 1.80.0. [^12]
- [Reference Cycles Can Leak Memory](https://doc.rust-lang.org/book/ch15-06-reference-cycles.html) — The Rust Programming Language, living. Backs: leaks are memory-safe, cycles, `downgrade` and weak count, parent `Weak` / children `Rc`. [^13]
- [Weak in std::rc](https://doc.rust-lang.org/std/rc/struct.Weak.html) — Rust standard library, living. Backs: `upgrade` returns `Option`, `Weak::new` does not allocate. [^14]

## Related
- `rust/smart-pointers/box-deref-and-drop.md` — single ownership on the heap and `Drop`.
- `rust/ownership/borrowing-references-and-slices.md` — the rules `RefCell` enforces at run time.
- `rust/concurrency/threads-channels-and-locks.md` — `Arc`, `Mutex`, `RwLock`, `OnceLock`, `LazyLock`.
- `concurrency/shared-state-and-data-races.md` — shared mutable state across languages.
- `rust/unsafe/memory-layout-and-repr.md` — leaking memory is safe.
