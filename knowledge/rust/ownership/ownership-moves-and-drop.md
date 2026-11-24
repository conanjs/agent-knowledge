---
schema: knowledge-doc/v1
type: concept
topic: rust/ownership
status: verified
applies-to: ["Rust 1.100.0", "edition 2024"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [rust, ownership, move, copy, clone, drop, destructor, drop-order, temporaries, edition-2024]
---

# Ownership, moves and drop order

## Summary
**TL;DR:** Every Rust value has exactly one owner (a variable, a field, a temporary), and the value is dropped when its owner goes out of scope. Assigning, passing or returning a non-`Copy` value **moves** it: the fixed-size part on the stack is copied bit for bit and the source becomes unusable, so the heap data still has one owner and is freed once. `Copy` types are duplicated instead, and `Clone` is the explicit deep copy. Drop order is fixed by the language: locals in reverse declaration order, struct fields in declaration order, temporaries at the end of their statement, and in edition 2024 the temporaries of an `if let` scrutinee and of a block's tail expression drop earlier than in 2021.
**Use this when:** the compiler says "borrow of moved value", you must know exactly when a guard, lock or file handle is released, you migrate code to edition 2024 and a `RefCell` or lock is released at a different point, or you choose between moving, cloning and borrowing.
**Not this doc:** references and slices → `rust/ownership/borrowing-references-and-slices.md`; lifetime annotations → `rust/ownership/lifetimes.md`; looking up an error code → `rust/ownership/borrow-checker-errors.md`; implementing `Drop`, `std::mem::drop`, `Box` → `rust/smart-pointers/box-deref-and-drop.md`; `mem::forget` and `ManuallyDrop` → `rust/unsafe/memory-layout-and-repr.md`; drop check → `rust/unsafe/variance-phantomdata-and-drop-check.md`; the move caused by struct update syntax → `rust/data-modeling/structs-and-methods.md`; closures capturing by move → `rust/closures-and-iterators/closures-and-fn-traits.md`.

## Problem
A bitwise copy of a `String` copies only its pointer, so if both copies stayed valid, both would free the same buffer: a double free ✅[^5] ✅[^2]. Rust's answer is that `let b = a;` makes `a` unusable, and newcomers meet `error[E0382]` on code that looks harmless ✅[^1]. A second class of surprise is timing: a lock guard, a `RefCell` borrow or a temporary file is released at a point fixed by drop-order rules most people never read. Edition 2024 moved some of those points: a program that panicked in 2021 runs in 2024 ✅[^1] ✅[^9], and a block whose tail temporary must outlive the block compiled in 2021 but not in 2024 ✅[^10].

## Mental model
**Analogy:** a heap value is a house with one deed. Handing the deed over (a move) means the previous holder can no longer enter; nothing about the house changes. A `Copy` value is a printed flyer: handing one out leaves you yours. `clone()` builds a second identical house with its own deed. When a deed holder leaves the scope, the house is demolished (dropped), and the demolition crews work through the deeds in the reverse order they were signed.

**Artifact:** a move copies only the 24-byte header of a `String`; the heap buffer stays where it was ✅[^1]:
```rust
let a = String::from("crate");
let pa = a.as_ptr();
let b = a;                                 // move: header copied, heap untouched
println!("{}", pa == b.as_ptr());          // true: same heap buffer
let c = b.clone();                         // deep copy
println!("{}", c.as_ptr() != b.as_ptr());  // true: new heap buffer
println!("{}", std::mem::size_of::<String>()); // 24 on aarch64
// println!("{a}");  → error[E0382]: borrow of moved value: `a`
```

## How it works
1. **Stack and heap.** A `String` is three fixed-size parts on the stack (a pointer, a length, a capacity) plus the text on the heap ✅[^2]. The header measured 24 bytes on aarch64, as did `Vec<u8>` ✅[^1].
2. **The ownership rules.** Each value has an owner; there is one owner at a time; when the owner goes out of scope, the value is dropped ✅[^2].
3. **A move is a bitwise copy plus invalidation.** `let b = a;`, passing `a` to a function and returning it all move a non-`Copy` value: the stack part is copied and the source place is deinitialized, so reading it again is `error[E0382]` ✅[^1] ✅[^2] ✅[^3]. Rust never makes an implicit deep copy, so any automatic copy is cheap ✅[^2].
4. **What can be moved out of.** Only variables that are not borrowed, temporaries, fields of a movable place whose type has no `Drop`, and the result of `*` on a `Box<T>` ✅[^3]. Indexing a `Vec` is `*Index::index(&v, i)`, a dereference of a reference ✅[^4], so `let first = tags[0];` on a `Vec<String>` is `` error[E0507]: cannot move out of index of `Vec<String>` `` ✅[^1]. A fixed-size array gives `E0508`, a field of a type that implements `Drop` gives `E0509` ✅[^1].
5. **`Copy` replaces the move.** A `Copy` value is duplicated implicitly with a bitwise copy that cannot be overloaded, and the source stays valid ✅[^5]. A type can be `Copy` only if every component is `Copy` (otherwise `E0204`), `Clone` is its supertrait, and `&T` is `Copy` while `&mut T` is not ✅[^5]. The Book lists integers, `bool`, floats, `char` and tuples of `Copy` types ✅[^2]; arrays of `Copy` types are `Copy` too ✅[^5].
6. **`Clone` is explicit.** `x.clone()` runs type-specific code that may be expensive; `#[derive(Clone)]` calls `clone` on each field ✅[^6]. A cloned `String` has its own buffer ✅[^1].
7. **Functions move like assignment.** Passing a `String` to `fn take(label: String)` moves it in, and the parameter is dropped when the function returns; returning it moves it back out ✅[^2] ✅[^1].
8. **Partial moves.** `let owner = t.owner;` moves one field: the other fields stay readable, the whole struct does not (`E0382: borrow of partially moved value`), and at scope end only the fields still present are dropped ✅[^1] ✅[^7].
9. **Destructors.** Dropping a value calls its `Drop::drop` if it has one, then drops its fields recursively ✅[^7]. The order ✅[^7] ✅[^1]:
   - local variables: reverse order of declaration;
   - struct and enum-variant fields: declaration order, whatever order the initializer listed them in;
   - tuple elements: in order; array elements: first to last (`Vec` elements measured first to last as well ✅[^1]);
   - function parameters: after every local of the body, the last parameter first.
10. **Assignment and wildcards.** Assigning to an initialized variable drops the old value at that line ✅[^1]. The wildcard pattern `_` never copies, moves or borrows ✅[^8]: `let _ = make();` drops the temporary at the semicolon, `let _ = s;` leaves `s` usable, and `let _kept = make();` keeps the value to the end of the scope ✅[^1].
11. **Temporaries.** A value expression used where a place is needed (a method receiver, an operand of `&`) creates a temporary, usually dropped at the end of the enclosing statement ✅[^3]. `let r = &make();` extends the temporary to the end of the block ✅[^7] ✅[^1]; a method receiver is not extended, so `s = String::from("temp").as_str();` followed by a use of `s` is `error[E0716]: temporary value dropped while borrowed` ✅[^7] ✅[^1]. A `match` scrutinee is not a temporary scope: its temporaries live until the end of the whole `match` statement ✅[^7] ✅[^1].
12. **Edition 2024 narrows two temporary scopes.** Temporaries in an `if let` scrutinee are dropped before the `else` block runs ✅[^9], and temporaries in a block's tail expression are dropped before the block's locals ✅[^10]. The same program built with both editions ✅[^1]:
    ```rust
    if let Some(v) = Guard("scrutinee temp").value() { /* … */ } else { println!("else-branch runs"); }
    let n = { let _local = Guard("block local"); Guard("tail temp").len() };
    ```
    | Event order | `--edition 2021` | `--edition 2024` |
    |---|---|---|
    | `if let … else` | `else-branch runs`, then `drop scrutinee temp` | `drop scrutinee temp`, then `else-branch runs` |
    | block tail | `drop block local`, then `drop tail temp` | `drop tail temp`, then `drop block local` |

    `cargo fix --edition` applies the `if_let_rescope` lint, which rewrites affected `if let` into `match`; `tail_expr_drop_order` only warns ✅[^9] ✅[^10].

## Worked example
One program, every drop printed by `impl Drop for Noisy` (`struct Noisy(&'static str)` prints `drop <name>`), built with `rustc --edition 2024`; each step is its own block ✅[^1]:

| Step | Code | Output, in order |
|---|---|---|
| 1 | `let _a = Noisy("a"); let _b = Noisy("b"); let _c = Noisy("c");` | `drop c`, `drop b`, `drop a` |
| 2 | `let _p = Pair { second: Noisy("second-field"), first: Noisy("first-field") };` with `struct Pair { first: Noisy, second: Noisy }` | `drop first-field`, `drop second-field`: declaration order, not initializer order |
| 3 | `let _ = make("bound to _"); println!("after"); let _kept = make("kept"); println!("after kept");` | `drop bound to _`, `after`, `after kept`, `drop kept` |
| 4 | `let len = make("temp").0.len(); println!("len {len}");` | `drop temp`, `len 4` |
| 5 | `let r = &make("extended"); println!("{}", r.0);` | `extended`, `drop extended` |
| 6 | `let mut x = Noisy("old"); x = Noisy("new"); println!("holding {}", x.0);` | `drop old`, `holding new`, `drop new` |
| 7 | `let p = Pair { first: Noisy("pair.first"), second: Noisy("pair.second") }; let moved = p.first;` | `drop pair.first` (owned by `moved`, declared later, so dropped first), `drop pair.second` |
| 8 | `fn params(_first: Noisy, _second: Noisy) { let _body = Noisy("body"); }` called with `Noisy("param first"), Noisy("param second")` | `drop body`, `drop param second`, `drop param first` |

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Moving a `String` inside a loop | `error[E0382]: use of moved value`, label "value moved here, in previous iteration of loop" | The first iteration moved it ✅[^1] |
| Taking an element out of a `Vec<String>` | Not with `v[0]` (`E0507`); `std::mem::take(&mut v[0])` leaves `""` behind, `v.remove(1)` shifts the rest, `for t in v` moves each element ✅[^1] | Indexing goes through a reference ✅[^4] |
| Moving out of an array | `let w = words[0];` is `E0508`; `let [first, second] = words;` compiles and moves both ✅[^1] | Destructuring moves the whole array |
| Moving a field out of a type with `Drop` | `` error[E0509]: cannot move out of type `Conn`, which implements the `Drop` trait `` ✅[^1] | Only fields of types without `Drop` are places a value can be moved out of ✅[^3]; borrow the field or `std::mem::take` it instead |
| `#[derive(Clone, Copy)]` on a struct with a `String` | `error[E0204]`, pointing at the field that is not `Copy` ✅[^1] | All components must be `Copy` ✅[^5] |
| `Copy` on a type that implements `Drop` | `` error[E0184]: the trait `Copy` cannot be implemented for this type; the type has a destructor `` ✅[^1] | Implicit copies would make destructor runs unpredictable ✅[^11] |
| Passing a `&mut T` to a generic `fn sink<T>(t: T)` | Moves the reference; a later use is `E0382` with the help "consider creating a fresh reborrow" ✅[^1] | `&mut T` is not `Copy` ✅[^5]; reborrowing is in `rust/ownership/borrowing-references-and-slices.md` |
| `RefCell` borrowed in an `if let` scrutinee, mutated in `else` | 2021: panics `RefCell already borrowed`; 2024: runs ✅[^1] | The scrutinee guard lived through `else` before 2024 ✅[^9] |
| `fn f() -> usize { let c = RefCell::new(…); c.borrow().len() }` | 2021: `` error[E0597]: `c` does not live long enough ``; 2024: compiles and returns 6 for `"ferris"` ✅[^1] | The `Ref` temporary outlived `c` before 2024 ✅[^10] |
| `std::process::exit(0)` with live locals | Their destructors never run (a guard printed nothing) ✅[^1] | `exit` ends the process without unwinding ✅[^7] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Move (pass `T`) | No copy of heap data; the callee owns and may keep it | The caller loses the value unless it is returned |
| `clone()` | Both sides keep an independent value | An allocation and a copy per call ✅[^6] |
| Borrow (`&T` / `&mut T`) | No copy, the caller keeps ownership | The borrow rules and lifetimes apply (`rust/ownership/borrowing-references-and-slices.md`) |
| Shared ownership (`Rc<T>`) | Several owners of one heap value | Reference counting, read-only access (`rust/smart-pointers/rc-refcell-and-interior-mutability.md`) |

## Takeaways
- Read `E0382` as "this value already has a new owner": borrow instead, clone deliberately, or restructure so the move happens last.
- Put guards (locks, `RefCell` borrows, temp files) in a named `let` binding, never `let _ =`, when they must live to the end of the scope. [rule-candidate]
- Do not rely on field initializer order for cleanup; fields drop in declaration order. [rule-candidate]
- When migrating to edition 2024, review every `if let` and block tail expression whose temporary holds a lock or a `RefCell` borrow; `cargo fix --edition` rewrites some into `match`. [rule-candidate]
- Use `std::mem::take` or `Vec::remove` to get an owned element out of a `Vec`, not indexing.

## Verification status
- Verified: 67 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `linux/lab-setup.md` — the Rust 1.100.0 lab (`rustlab:1`) where every behaviour marked with this note ran on 2026-11-24. [^1]
- [What is Ownership?](https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html) — The Rust Programming Language (Klabnik, Nichols, Krycho and the Rust community), living. Backs: stack and heap, the three rules, moves, no implicit deep copies, `Copy` types, functions and return values. [^2]
- [Expressions](https://doc.rust-lang.org/reference/expressions.html) — The Rust Reference, living. Backs: moved and copied types, what may be moved out of, temporaries. [^3]
- [Array and index expressions](https://doc.rust-lang.org/reference/expressions/array-expr.html) — The Rust Reference, living. Backs: `a[b]` is `*Index::index(&a, b)` for non-array types. [^4]
- [Copy in std::marker](https://doc.rust-lang.org/std/marker/trait.Copy.html) — Rust standard library, living. Backs: bitwise copy, components must be `Copy`, `Clone` supertrait, `&T` versus `&mut T`, arrays. [^5]
- [Clone in std::clone](https://doc.rust-lang.org/std/clone/trait.Clone.html) — Rust standard library, living. Backs: explicit and possibly expensive, derive calls `clone` per field. [^6]
- [Destructors](https://doc.rust-lang.org/reference/destructors.html) — The Rust Reference, living. Backs: destructor steps, drop order of locals, fields, tuples, arrays and parameters, partial moves, temporary scopes, lifetime extension, `match` scrutinee, process exit. [^7]
- [Patterns](https://doc.rust-lang.org/reference/patterns.html) — The Rust Reference, living. Backs: `_` does not copy, move or borrow. [^8]
- [if let temporary scope](https://doc.rust-lang.org/edition-guide/rust-2024/temporary-if-let-scope.html) — The Rust Edition Guide, living. Backs: edition 2024 `if let` change, `if_let_rescope`. [^9]
- [Tail expression temporary scope](https://doc.rust-lang.org/edition-guide/rust-2024/temporary-tail-expr-scope.html) — The Rust Edition Guide, living. Backs: edition 2024 tail-expression change, the `RefCell` example, `tail_expr_drop_order`. [^10]
- [Drop in std::ops](https://doc.rust-lang.org/std/ops/trait.Drop.html) — Rust standard library, living. Backs: why `Copy` types cannot have destructors. [^11]

## Related
- `rust/ownership/borrowing-references-and-slices.md` — using a value without taking ownership.
- `rust/ownership/borrow-checker-errors.md` — every error code above with its minimal trigger.
- `rust/smart-pointers/box-deref-and-drop.md` — writing a `Drop` impl and dropping early.
- `rust/unsafe/memory-layout-and-repr.md` — `mem::forget`, `ManuallyDrop`, leaking.
- `software-design/functional-modeling/immutability.md` — immutable values in functional pipelines (TypeScript), for comparison.
