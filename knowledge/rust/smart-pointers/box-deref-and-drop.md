---
schema: knowledge-doc/v1
type: concept
topic: rust/smart-pointers
status: verified
applies-to: ["Rust 1.100.0", "edition 2024"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [rust, smart-pointers, box, heap, recursive-types, deref, derefmut, deref-coercion, drop, raii]
---

# `Box<T>`, `Deref` and `Drop`

## Summary
**TL;DR:** `Box<T>` is a pointer that alone owns one heap allocation: 8 bytes for a sized `T` and 16 for a slice or trait object on a 64-bit target, freed when the box is dropped. Use it for recursive types, large values you move around, and trait objects. `Deref` and `DerefMut` let a type act like a reference: `*x` means `*Deref::deref(&x)`, and deref coercion turns `&Box<String>` into `&String` and then `&str` at compile time. `Drop::drop` is a type's cleanup hook: it runs before the fields are dropped, cannot be called by hand (`E0040`), and `std::mem::drop(x)` ends a value early.
**Use this when:** a recursive `enum` fails with `E0072`, a function wants `&str` and you hold a `Box<String>` or your own wrapper, you write a wrapper type and consider implementing `Deref`, or you need cleanup code (an RAII guard) and must know when it runs.
**Not this doc:** the order in which locals, fields and temporaries drop → `rust/ownership/ownership-moves-and-drop.md`; `Rc`, `RefCell`, `Weak` → `rust/smart-pointers/rc-refcell-and-interior-mutability.md`; `Box<dyn Trait>` and vtables → `rust/traits-and-generics/trait-objects-and-dynamic-dispatch.md`; `Option<Box<T>>` niche, `ManuallyDrop`, `mem::forget` → `rust/unsafe/memory-layout-and-repr.md`; `Pin<Box<T>>` → `rust/async/pin-and-unpin.md`; `Deref`/`Drop` in the trait catalog → `rust/traits-and-generics/core-traits-reference.md`.

## Problem
`enum Chain { Link(u32, Chain), End }` is rejected with "recursive type has infinite size" ✅[^1]. A function that takes `&str` accepts `&Box<String>` and `&Rc<String>` without any conversion, which looks like magic until the coercion rule is known, and it fails for `&mut [i32]` from a `&Box<Vec<i32>>` ✅[^1]. `*boxed` can move the value out but `*rc` cannot ✅[^1]. Calling `guard.drop()` to release something early is a compile error ✅[^1]. Each of these follows from three small mechanisms.

## Mental model
**Analogy:** a `Box` is a luggage tag. The tag (8 bytes) stays with you on the stack; the suitcase sits in the hold (the heap). Only one tag exists per suitcase, so when you leave, the airline knows exactly which suitcase to destroy. `Deref` is the porter who fetches the suitcase when you ask for its contents; `Drop` is the check-out procedure that runs when the tag holder leaves.

**Artifact:** an expression tree, where each node owns its children through boxes ✅[^1]:
```rust
enum Expr { Num(i64), Add(Box<Expr>, Box<Expr>), Neg(Box<Expr>) }
fn eval(e: &Expr) -> i64 {
    match e {
        Expr::Num(n) => *n,
        Expr::Add(a, b) => eval(a) + eval(b),   // &Box<Expr> coerces to &Expr
        Expr::Neg(inner) => -eval(inner),
    }
}
// (2 + 3) + -(4)
let e = Expr::Add(
    Box::new(Expr::Add(Box::new(Expr::Num(2)), Box::new(Expr::Num(3)))),
    Box::new(Expr::Neg(Box::new(Expr::Num(4)))),
);
println!("eval = {}", eval(&e));   // eval = 1
// size_of: Box<u64> = 8, Box<[u8]> = 16, Box<dyn Display> = 16, Expr = 24 (aarch64)
```

## How it works
1. **`Box<T>` owns one heap allocation.** It is a pointer type that uniquely owns a heap allocation of `T` ✅[^2]; for a sized `T` it is guaranteed to be a single pointer ✅[^2]. Measured on aarch64: `Box<u64>` 8 bytes, `Box<[u8]>` and `Box<dyn Display>` 16, because a pointer to an unsized value carries extra data (see `rust/traits-and-generics/trait-objects-and-dynamic-dispatch.md`) ✅[^1]. It adds no cost beyond the heap allocation, and dropping it frees both the box and the heap data ✅[^3].
2. **When to box.** The Book names three uses: a type whose size is unknown at compile time used where a size is required, a large value whose ownership you transfer without copying it, and a value you only know by a trait it implements ✅[^3].
3. **Recursive types need indirection.** A type that contains itself directly would have infinite size: `enum Chain { Link(u32, Chain), End }` is `` error[E0072]: recursive type `Chain` has infinite size ``, with the help "insert some indirection (e.g., a `Box`, `Rc`, or `&`) to break the cycle" ✅[^1] ✅[^4]. A `Box` has a known size, so `Link(u32, Box<Chain>)` compiles ✅[^3]. `Expr` above measured 24 bytes on aarch64; how enums are laid out is in `rust/unsafe/memory-layout-and-repr.md` ✅[^1].
4. **`Box` lets you move out through `*`.** The result of `*` on a `Box<T>` is one of the few places a value can be moved out of ✅[^5] ✅[^2], so `let owned: String = *boxed;` compiles. `let s: String = *shared;` with `shared: Rc<String>` is `` error[E0507]: cannot move out of an `Rc` `` ✅[^1].
5. **`Deref` makes `*` work on your type.** For a type that is not a reference or raw pointer, `*v` is `*Deref::deref(&v)` in a read context and `*DerefMut::deref_mut(&mut v)` in a write context ✅[^6] ✅[^7]. `deref` returns a reference so that `*` does not move the inner value out of `self` ✅[^7].
6. **Deref coercion.** At a coercion site (a function argument, a `let` with a type, a struct field, a return value) ✅[^8], the compiler inserts as many `deref` calls as needed ✅[^7]:
   - `&T` to `&U` when `T: Deref<Target = U>`;
   - `&mut T` to `&mut U` when `T: DerefMut<Target = U>`;
   - `&mut T` to `&U` when `T: Deref<Target = U>` ✅[^7] ✅[^8].

   The number of calls is fixed at compile time, so there is no run-time search ✅[^7]. Measured chains ✅[^1]:
   ```rust
   fn shout(s: &str) -> String { s.to_uppercase() }
   let boxed: Box<String> = Box::new(String::from("ferris"));
   shout(&boxed);                // &Box<String> → &String → &str        "FERRIS"
   let rc_name = Rc::new(String::from("crab"));
   shout(&rc_name);              // &Rc<String> → &String → &str         "CRAB"
   let deep: Box<Rc<String>> = Box::new(Rc::new(String::from("deep")));
   shout(&deep);                 // &Box<Rc<String>> → &Rc → &String → &str  "DEEP"
   shout(&(**boxed)[..]);        // the same, written out by hand        "FERRIS"
   ```
   A shared reference never becomes a mutable one: `zero(&b)` with `fn zero(xs: &mut [i32])` and `b: Box<Vec<i32>>` is `error[E0308]: mismatched types` labelled "types differ in mutability" ✅[^1] ✅[^7].
7. **Method calls auto-deref the receiver.** Method lookup tries the receiver type, then `&` and `&mut` of it, then each type reached by dereferencing it again ✅[^9]; that is why `v.len()` works on a wrapper of `Vec` ✅[^1].
8. **A custom smart pointer.** `struct Audited<T> { inner: T, reads: Cell<u32> }` with `Deref<Target = T>` (counting each call) and `DerefMut` behaves like the `Vec` it wraps: `v.len()` gives 3, `sum(&v)` with `fn sum(xs: &[i32])` gives 18, `zero_first(&mut v)` with `fn zero_first(xs: &mut [i32])` writes through `DerefMut`, and `let r: &[i32] = &mut v;` uses the third coercion. After those lines `reads` was 3: coercion really calls `deref` ✅[^1].
9. **When to implement `Deref`.** The std docs say yes when the type behaves transparently like its target, `deref` is cheap, and users will not be surprised by the coercions; no when `deref` could fail, when the type's methods would collide with the target's, or when the coercions should not be part of the public API ✅[^6].
10. **`Drop` is the cleanup hook.** A value's destructor calls `Drop::drop` if the type implements it, then the drop glue drops each field ✅[^10]. So an outer type's `drop` runs before its fields' destructors ✅[^1] ✅[^10]. `drop` takes `&mut self` rather than ownership, so the language forbids calling it yourself ✅[^10]: `l.drop()` is `error[E0040]: explicit use of destructor method` ✅[^1] ✅[^11]; otherwise the automatic drop at scope end would free the value a second time ✅[^12].
11. **`std::mem::drop` ends a value early.** It is in the prelude ✅[^12] and is literally `pub fn drop<T>(_x: T) {}`: moving the value into the parameter drops it when the function returns ✅[^13]. It does nothing for `Copy` values, which are copied in; rustc warns "calls to `std::mem::drop` with a value that implements `Copy` does nothing" ✅[^13] ✅[^1]. Dropping a `RefCell` guard this way releases the borrow ✅[^13].

## Worked example
A `TempFile` guard whose `Drop` prints the file it removes, and a `Job` that owns one, built with `--edition 2024` ✅[^1]:
```rust
struct TempFile { path: String }
impl Drop for TempFile { fn drop(&mut self) { println!("  removing {}", self.path); } }
struct Job { name: &'static str, scratch: TempFile }
impl Drop for Job { fn drop(&mut self) { println!("  Job {} drop() runs first", self.name); } }

let a = TempFile { path: String::from("/tmp/a.part") };
let _b = TempFile { path: String::from("/tmp/b.part") };
drop(a);
println!("  after drop(a)");
{ let _j = Job { name: "export", scratch: TempFile { path: String::from("/tmp/export.part") } }; }
{ let _boxed = Box::new(TempFile { path: String::from("/tmp/boxed.part") }); }
println!("end of main");
```
| Step | What runs | Output |
|---|---|---|
| `drop(a)` | `a` moves into `mem::drop`, whose parameter is dropped at its return | `removing /tmp/a.part`, then `after drop(a)` |
| block with `_j` ends | `Job::drop`, then the drop glue drops the `scratch` field | `Job export drop() runs first`, `removing /tmp/export.part` |
| block with `_boxed` ends | the box drops its `TempFile`, then frees the heap block | `removing /tmp/boxed.part` |
| `main` returns | `_b`, the remaining local | `end of main`, then `removing /tmp/b.part` |

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `x.drop()` on a type with `Drop` | `E0040`; rustc suggests `drop(x)` ✅[^1] | Manual destructor calls are not allowed ✅[^11] |
| `#[derive(Clone, Copy)]` on a type with `Drop` | `E0184` (see `rust/ownership/ownership-moves-and-drop.md`) ✅[^1] | `Copy` and `Drop` are exclusive ✅[^10] |
| `*boxed` versus `*rc` as a value | `Box` moves out; `Rc` is `E0507` ✅[^1] | Only `Box` dereference is a movable place ✅[^5] |
| Passing `&Box<Vec<i32>>` where `&mut [i32]` is expected | `E0308`, "types differ in mutability" ✅[^1] | `&T` never coerces to `&mut U` ✅[^7] |
| `deref` with a side effect | Runs on every coercion and auto-deref (3 calls in the `Audited` run) ✅[^1] | Coercion inserts real `deref` calls ✅[^7] |
| A `drop` that panics while the thread is already unwinding | Likely aborts the program; the value counts as dropped even if `drop` panics ✅[^10] | `drop` runs during unwinding, and a second panic there is a "double panic" ✅[^10] |
| `std::mem::forget(guard)` | The guard's `drop` never runs (`after forget` printed, no release line) ✅[^1] | Suppressing a destructor is safe; see `rust/unsafe/memory-layout-and-repr.md` ✅[^14] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Value on the stack | No allocation | The size must be known at compile time ✅[^3] |
| `Box<T>` | Known size for recursive types, cheap moves of large values, trait objects ✅[^3] | One heap allocation and a pointer hop |
| Implementing `Deref` on a wrapper | Callers use the wrapper like its target | Method-name collisions and coercions become public API ✅[^6] |
| Explicit accessor (`fn inner(&self) -> &T`) | No implicit coercions | Callers write `.inner()` |
| RAII guard with `Drop` | Cleanup on every exit path: normal return, an early `?` return and an unwinding panic each printed the release line ✅[^1] | Not run after `std::process::exit` or `mem::forget` ✅[^14] ✅[^1] |

## Takeaways
- Box the recursive field of a recursive type; prefer `Option<Box<Self>>` for optional children. [rule-candidate]
- Implement `Deref` only for types that really are transparent wrappers; otherwise expose an accessor. [rule-candidate]
- Release a guard early with `drop(guard)`, never by calling `.drop()`.
- Keep `Drop::drop` free of panics. [rule-candidate]
- Write functions that take `&str` / `&[T]`; deref coercion lets callers pass boxes, `Rc`s and owned collections.

## Verification status
- Verified: 65 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `linux/lab-setup.md` — the Rust 1.100.0 lab (`rustlab:1`) where every behaviour marked with this note ran on 2026-11-24. [^1]
- [std::boxed](https://doc.rust-lang.org/std/boxed/index.html) — Rust standard library, living. Backs: unique ownership of a heap allocation, single-pointer layout for sized `T`, moving out with `*`. [^2]
- [Using `Box<T>` to Point to Data on the Heap](https://doc.rust-lang.org/book/ch15-01-box.html) — The Rust Programming Language (Klabnik, Nichols, Krycho and the Rust community), living. Backs: three uses, no overhead, deallocation, recursive types. [^3]
- [E0072](https://doc.rust-lang.org/error_codes/E0072.html) — Error codes index, Rust project, living. Backs: infinite size without indirection, `Option<Box<ListNode>>`. [^4]
- [Expressions](https://doc.rust-lang.org/reference/expressions.html) — The Rust Reference, living. Backs: dereferencing a `Box<T>` can be moved out of. [^5]
- [Deref in std::ops](https://doc.rust-lang.org/std/ops/trait.Deref.html) — Rust standard library, living. Backs: `*v` desugaring, when to implement and when not. [^6]
- [Treating Smart Pointers Like Regular References](https://doc.rust-lang.org/book/ch15-02-deref.html) — The Rust Programming Language, living. Backs: `*(y.deref())`, why `deref` returns a reference, deref coercion and its three cases, compile-time resolution, no `&T` to `&mut U`. [^7]
- [Type coercions](https://doc.rust-lang.org/reference/type-coercions.html) — The Rust Reference, living. Backs: coercion sites, the `Deref` and `DerefMut` coercions. [^8]
- [Method call expressions](https://doc.rust-lang.org/reference/expressions/method-call-expr.html) — The Rust Reference, living. Backs: the receiver candidate list built by dereferencing. [^9]
- [Drop in std::ops](https://doc.rust-lang.org/std/ops/trait.Drop.html) — Rust standard library, living. Backs: `Drop::drop` then drop glue, `Copy`/`Drop` exclusivity, panics in `drop`. [^10]
- [E0040](https://doc.rust-lang.org/error_codes/E0040.html) — Error codes index, Rust project, living. Backs: destructors cannot be called manually; use `drop(x)`. [^11]
- [Running Code on Cleanup with the Drop Trait](https://doc.rust-lang.org/book/ch15-03-drop.html) — The Rust Programming Language, living. Backs: why manual `drop` would double free, `std::mem::drop` in the prelude. [^12]
- [drop in std::mem](https://doc.rust-lang.org/std/mem/fn.drop.html) — Rust standard library, living. Backs: definition, no effect on `Copy`, releasing a `RefCell` borrow. [^13]
- [Destructors](https://doc.rust-lang.org/reference/destructors.html) — The Rust Reference, living. Backs: `mem::forget` is safe, `process::exit` skips destructors. [^14]

## Related
- `rust/ownership/ownership-moves-and-drop.md` — when each value is dropped.
- `rust/smart-pointers/rc-refcell-and-interior-mutability.md` — shared ownership and run-time borrow checks.
- `rust/traits-and-generics/trait-objects-and-dynamic-dispatch.md` — `Box<dyn Trait>`.
- `rust/unsafe/memory-layout-and-repr.md` — `Option<Box<T>>` layout, `ManuallyDrop`, `mem::forget`.
- `rust/design-patterns/idioms-and-api-guidelines.md` — RAII guards as an API pattern.
