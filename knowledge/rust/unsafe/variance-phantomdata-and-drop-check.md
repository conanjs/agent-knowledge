---
schema: knowledge-doc/v1
type: concept
topic: rust/unsafe
status: verified
applies-to: ["Rust 1.100.0", "edition 2024", "nightly 1.102.0 (2026-11-23) for may_dangle and Miri"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [rust, variance, subtyping, covariance, contravariance, invariance, phantomdata, drop-check, may-dangle, exception-safety, leak-amplification]
---

# Variance, `PhantomData` and drop check

## Summary
**TL;DR:** Lifetimes have a subtype relation: when `'long` outlives `'short`, a `&'long T` may be used where a `&'short T` is expected. *Variance* says how that relation passes through a type: covariant types pass it on (`&'a T`, `Box<T>`, `fn() -> T`), contravariant ones reverse it (`fn(T)`), invariant ones block it (`&mut T` and `Cell<T>` in `T`, `*mut T`). A type built on raw pointers states the variance, auto traits and drop-check meaning it wants with a zero-sized `PhantomData` field. Drop check forces borrowed data to outlive any value whose destructor might read it. Unsafe code must also stay memory-safe when user code panics half-way through an update (exception safety) and when a destructor never runs (leak amplification).
**Use this when:** writing a container or iterator over raw pointers, choosing a `PhantomData` marker, reading a "lifetime may not live long enough … invariant" error, or reviewing unsafe code that calls user code (`clone`, `Ord`, closures) in the middle of an update.
**Not this doc:** lifetime annotations and elision → `rust/ownership/lifetimes.md`; higher-ranked trait bounds → `rust/traits-and-generics/advanced-traits-and-type-system.md`; drop order of locals and fields → `rust/ownership/ownership-moves-and-drop.md`; `Send`/`Sync` rules → `rust/concurrency/threads-channels-and-locks.md`; `mem::forget` itself → `rust/unsafe/memory-layout-and-repr.md`; `PhantomPinned` → `rust/async/pin-and-unpin.md`.

## Problem
An unsafe container stores `*mut T` instead of a real `T`. The compiler then derives the container's variance, its `Send`/`Sync`, and its drop-check behaviour from that pointer, not from what the container logically owns. Pick the wrong marker and safe code can compile a use-after-free (Worked example). Two more exits hide in unsafe code: a panic from user code while an invariant is broken, and a guard whose destructor is skipped by `mem::forget`.

## Mental model
**Analogy:** a reference is a lease on a flat. A 10-year lease can be handed to anyone who needs a 1-year lease (covariance). Handing over the right to *replace* someone's lease (`&mut`) is different: you could write a 1-year lease into a slot promised to last 10 years, so the type must match exactly (invariance). For function arguments the direction flips: a cleaner able to clean any flat can stand in for one hired only for 10-year flats, not the other way round (contravariance).

**Artifact:** each function body is just `x`, so it compiles only if the type's variance allows the conversion. `'long: 'short` means `'long` outlives `'short` ✅[^1]:
```rust
fn shrink_ref<'short, 'long: 'short>(x: &'long str) -> &'short str { x }                 // compiles
fn shrink_inner<'short, 'long: 'short>(x: &'short mut &'long str) -> &'short mut &'short str { x }
```
```console
error: lifetime may not live long enough
  = note: requirement occurs because of a mutable reference to `&str`
  = note: mutable references are invariant over their type parameter
```

## How it works
### 1. Lifetime subtyping
Subtyping in Rust exists only between lifetimes and between higher-ranked types; with lifetimes erased, it is plain type equality ✅[^2]. `'long <: 'short` (read "is a subtype of") holds when the region of `'long` contains that of `'short`, so `&'static str` can be passed where `&'a str` is wanted ✅[^3].

### 2. The variance table
`F<T>` is covariant if `T <: U` gives `F<T> <: F<U>`, contravariant if it gives `F<U> <: F<T>`, invariant otherwise ✅[^2]. Each lab check is a function like the artifact's ✅[^1] ✅[^2] ✅[^3]:

| Type | in `'a` | in `T` | Lab check |
|---|---|---|---|
| `&'a T` | covariant | covariant | `&'long str` → `&'short str` compiles |
| `&'a mut T` | covariant | **invariant** | `&'long mut Vec<u8>` → `&'short mut Vec<u8>` compiles; `&mut &'long str` → `&mut &'short str` fails |
| `Box<T>`, `Vec<T>` | | covariant | `Box<&'long str>` → `Box<&'short str>` compiles |
| `*const T` / `*mut T` | | covariant / invariant | — |
| `UnsafeCell<T>`, `Cell<T>` | | invariant | `Cell<&'long str>` → `Cell<&'short str>` fails: ``the struct `Cell<T>` is invariant over the parameter `T` `` |
| `fn(T) -> U` | | **contravariant** in `T`, covariant in `U` | `fn(&'short str)` → `fn(&'long str)` compiles, the reverse fails; `fn() -> &'long str` → `fn() -> &'short str` compiles |
| `PhantomData<T>` | | covariant | — |
| `dyn Trait<T> + 'a` | covariant | invariant | — |

### 3. Why `&mut T` is invariant and `fn(T)` contravariant
If `&mut T` were covariant, `fn overwrite<T>(slot: &mut T, value: T)` could store a short-lived `&str` into a variable typed `&'static str`. Invariance forces `T = &'static str`, so the call `overwrite(&mut keep, &temp)` fails with ``E0597: `temp` does not live long enough`` and the note ``type annotation requires that `temp` is borrowed for `'static` `` ✅[^1] ✅[^3]. A function that needs a `&'static str` argument cannot stand in for one that must accept any shorter-lived `&str`; function arguments are the only source of contravariance in the language ✅[^3]. Interior mutability behaves like `&mut`: `Cell<T>` follows `UnsafeCell<T>` and is invariant ✅[^3].

### 4. Variance of your own types
A struct, enum or union takes the variance of its fields; a parameter used in positions of different variance becomes invariant ✅[^2]. A type that holds only `*mut T` is therefore invariant in `T`, and a type that mentions a parameter in no field at all is rejected: `struct Tagged<T> { id: u32 }` gives ``E0392: type parameter `T` is never used``, with the help ``consider removing `T`, referring to it in a field, or using a marker such as `PhantomData` `` ✅[^1] ✅[^4].

### 5. `PhantomData` markers
`PhantomData<T>` is a zero-sized field that tells the compiler the type "acts as though it stores a value of type `T`" ✅[^6]; it simulates a field for variance, auto traits (`Send`, `Sync`, which a type gets from its fields, as the E0277 notes below show) and drop check ✅[^4]. The marker you pick decides all three ✅[^4]:

| Marker | Variance in `T` | `Send` / `Sync` | Drop check | Typical use |
|---|---|---|---|---|
| `PhantomData<T>` | covariant | as `T` | owns `T`: dangling `T` disallowed | owning container (`Vec`-like) |
| `PhantomData<&'a T>` | covariant (and in `'a`) | both only if `T: Sync` | allowed | iterator that borrows |
| `PhantomData<&'a mut T>` | invariant | as `T` | allowed | iterator that borrows mutably |
| `PhantomData<*const T>` | covariant | neither | allowed | opt out of `Send` and `Sync` |
| `PhantomData<fn() -> T>` | covariant | always both | allowed | "produces a `T`": type tags, factories |
| `PhantomData<fn(T)>` | contravariant | always both | allowed | "consumes a `T`" |
| `PhantomData<fn(T) -> T>` | invariant | always both | allowed | invariance without auto-trait effects |

Lab, with `fn need_send<T: Send>()` ✅[^1]:
- `MakesT<Rc<u8>>` (marker `PhantomData<fn() -> T>`) passed both `need_send` and `need_sync`.
- `OwnsT<Rc<u8>>` (`PhantomData<T>`): ``E0277: `Rc<u8>` cannot be sent between threads safely``, note ``required because it appears within the type `PhantomData<Rc<u8>>` ``.
- `RawT<u8>` (`PhantomData<*const T>`): ``E0277: `*const u8` cannot be sent between threads safely``.

The std docs' standard example is a slice iterator made of two `*const T` plus `PhantomData<&'a T>`, so that the iterator cannot outlive the borrowed data ✅[^6].

### 6. Drop check
The rule: "For a generic type to soundly implement drop, its generics arguments must strictly outlive it." ✅[^5] Locals are dropped in reverse order of definition ✅[^5]. The checker cannot see what a destructor does, so it assumes any `Drop` impl of a generic type may read its `T` ✅[^5]. Lab, with `label` declared last and therefore dropped first ✅[^1]:
```rust
struct Tray<T>(Vec<T>);
impl<T> Drop for Tray<T> { fn drop(&mut self) {} }  // never reads T
let mut std_vec: Vec<&String> = Vec::new();
let mut tray: Tray<&String> = Tray(Vec::new());
let label = String::from("crate-9");
std_vec.push(&label);   // accepted
tray.0.push(&label);    // E0597
```
```console
error[E0597]: `label` does not live long enough
   | borrow might be used here, when `tray` is dropped and runs the `Drop` code for type `Tray`
   = note: values in a scope are dropped in the opposite order they are defined
```
`Vec` is accepted because std marks its `Drop` impl with the unstable, unsafe `#[may_dangle]` attribute, which opts back out of this check for `T`; the impl must then not read a `T` except by dropping it ✅[^4] ✅[^5]. A holder with no `Drop` impl at all (`struct Plain<'a>(&'a String)`) in the same position compiled and printed `pallet-3` ✅[^1]. With a `Drop` impl present, a `PhantomData<T>` adds nothing for drop check; it matters once `#[may_dangle]` removes the impl's own claim ✅[^4]. The std docs warn that this interaction "may change in the future" ✅[^6].

### 7. Exception safety
Unsafe code must stay memory-safe if a panic unwinds through it (minimal exception safety); safe code should ideally also leave correct results (maximal) ✅[^7]. `Vec::set_len` requires that every element below the new length is initialized ✅[^9]. Breaking that before calling user code is the classic bug ✅[^7]:
```rust
unsafe { v.set_len(start + src.len()) }   // claims slots are initialized...
for (i, item) in src.iter().enumerate() {
    let copy = item.clone();               // ...then user code may panic
    unsafe { v.as_mut_ptr().add(start + i).write(copy) };
}
```
With a `clone` that panics on the third of three tickets, caught by `catch_unwind`, Miri (the interpreter that detects undefined behaviour, UB; `rust/unsafe/unsafe-rust-and-undefined-behavior.md`) reported `reading memory at alloc880[0x38..0x40], but memory is uninitialized at [0x38..0x40], and this operation requires initialized memory` when the `Vec` was dropped ✅[^1]. Writing each element and then growing the length by one (the Nomicon's first fix) printed `panicked: true, kept 2 items` and ran clean under Miri ✅[^1] ✅[^7]. For longer critical sections the Nomicon's pattern is a guard struct whose `Drop` restores the invariant, which runs "whether we panic or not" ✅[^7]. `catch_unwind` itself asks for `UnwindSafe`: capturing `&mut Vec<String>` fails with ``E0277: the type `&mut Vec<String>` may not be safely transferred across an unwind boundary``, which is why the lab wraps the closure in `AssertUnwindSafe` ✅[^1].

### 8. Leaks and leak amplification
Leaking is safe (`rust/unsafe/memory-layout-and-repr.md`), so a proxy type must never need its destructor for safety ✅[^8]. `vec::Drain` leaves part of the `Vec` logically uninitialized while it runs; it first shrinks the `Vec`'s length, so a forgotten `Drain` loses elements instead of exposing moved-out ones. The Nomicon calls this *leak amplification*, "leaks causing more leaks" ✅[^8], and the std docs say a forgotten `Drain` "may have lost and leaked elements arbitrarily" ✅[^9]. Lab: four strings, `drain(1..)`, one `next()` (gave `Some("b")`), then `mem::forget` → `len=1 ["a"]`; `"c"` and `"d"` were never dropped, and Miri with `-Zmiri-ignore-leaks` found no UB ✅[^1]. Two more cases from the Nomicon: `Rc` aborts if its count would overflow, because enough forgotten clones could wrap it to 0 and free live data; and the pre-1.0 `thread::scoped` was removed because its safety relied on a `JoinGuard` destructor ✅[^8].

## Worked example
`#[may_dangle]` plus the wrong marker compiles a use-after-free (nightly, `#![feature(dropck_eyepatch)]`) ✅[^1]:
```rust
struct MyBox<T> { ptr: *mut T, _marker: PhantomData<T> }   // variant B: PhantomData<fn() -> T>
impl<T> MyBox<T> {
    fn new(v: T) -> Self { MyBox { ptr: Box::into_raw(Box::new(v)), _marker: PhantomData } }
}
unsafe impl<#[may_dangle] T> Drop for MyBox<T> {
    fn drop(&mut self) { unsafe { drop(Box::from_raw(self.ptr)) } } // runs T's destructor
}
struct Reporter<'a>(&'a String);
impl Drop for Reporter<'_> { fn drop(&mut self) { println!("report: {}", self.0); } }

let holder;
let name = String::from("pallet-3");   // declared after holder, so dropped before it
holder = MyBox::new(Reporter(&name));
```
| Step | Variant A: `PhantomData<T>` | Variant B: `PhantomData<fn() -> T>` |
|---|---|---|
| Compile | ``E0597: `name` does not live long enough`` … ``when `holder` is dropped and runs the `Drop` code for type `MyBox` `` | Compiles: the marker says `MyBox` does not own a `T`, and `#[may_dangle]` waived the impl's own claim |
| End of `main`, drop `name` | — | `name`'s heap buffer is freed |
| Drop `holder` → `Box::from_raw` → `Reporter::drop` reads `self.0` | — | Miri: `Undefined Behavior: constructing invalid value of type &std::string::String: encountered a dangling reference (use-after-free)` in `<&String as Display>::fmt` |

Variant A is right: `MyBox` drops a `T`, and `Reporter`'s destructor reads its borrow, so `name` must outlive `holder` ✅[^4] ✅[^5]. The same applies to any owning type built on raw pointers.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `&'a mut T` shortened in `'a` | Compiles | `&mut` is covariant in its own lifetime, invariant only in `T` ✅[^1] ✅[^2] |
| `fn(&'long str)` used as `fn(&'short str)` | `lifetime may not live long enough` | Contravariance runs the other way ✅[^1] |
| Generic `Drop` impl whose body ignores `T` | Still triggers drop check | The checker does not look inside `drop` ✅[^1] ✅[^5] |
| Type with a reference but no `Drop` impl | Borrowed data may die first | No destructor can read it ✅[^1] ✅[^5] |
| `PhantomData<fn() -> T>` on a type that owns `T` | Wrong: loses "owns `T`" for drop check, and makes the type `Send + Sync` even for a `!Send` `T` | Worked example; marker table ✅[^1] ✅[^4] |
| Forgetting a `Drain` | Elements leak, the `Vec` keeps only those before the range | Leak amplification ✅[^1] ✅[^8] |
| Relying on field drop order for correctness | Fragile | The Nomicon advises `ManuallyDrop` when order matters ✅[^5] |

## Takeaways
- Give every type that holds `*const T`/`*mut T` an explicit `PhantomData` marker chosen from the table: `PhantomData<T>` if it owns `T`, `PhantomData<&'a T>` if it borrows. [rule-candidate]
- Never use `#[may_dangle]` without a `PhantomData<T>` for every `T` the type drops. [rule-candidate]
- Before calling user code (`clone`, `Ord`, closures) inside unsafe code, restore every invariant, or hold a guard whose `Drop` restores it. [rule-candidate]
- Grow a length after writing the element, never before (`set_len` last). [rule-candidate]
- Design guard types so that a forgotten guard leaks rather than exposing invalid data.
- When a lifetime error says "invariant", look for a `&mut`, `Cell` or `*mut` around the lifetime, not for a missing annotation.

## Verification status
- Verified: 56 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `linux/lab-setup.md` — the Rust 1.100.0 lab (`rustlab:1`) where every behaviour marked with this note ran on 2026-11-24; the `#[may_dangle]` programs used its nightly 1.102.0 toolchain. [^1]
- [Subtyping and variance](https://doc.rust-lang.org/reference/subtyping.html) — The Rust Reference, Rust project, living. Backs: subtyping only for lifetimes and higher-ranked types, variance definitions and table, variance of user types. [^2]
- [Subtyping and Variance](https://doc.rust-lang.org/nomicon/subtyping.html) — The Rustonomicon, Rust project, living. Backs: `'long <: 'short`, why `&mut T` is invariant, why `fn(T)` is contravariant, `Box`/`Vec`/`Cell` variance. [^3]
- [PhantomData](https://doc.rust-lang.org/nomicon/phantom-data.html) — The Rustonomicon, Rust project, living. Backs: why markers exist, the marker table, `PhantomData` and drop check after RFC 1238, `Vec` and `may_dangle`. [^4]
- [Drop Check](https://doc.rust-lang.org/nomicon/dropck.html) — The Rustonomicon, Rust project, living. Backs: the drop check rule, reverse drop order, sound-but-rejected cases, `#[may_dangle]`, field order advice. [^5]
- [PhantomData in std::marker](https://doc.rust-lang.org/std/marker/struct.PhantomData.html) — Rust standard library, living. Backs: "acts as though it stores a `T`", the slice-iterator example, drop-check note. [^6]
- [Exception Safety](https://doc.rust-lang.org/nomicon/exception-safety.html) — The Rustonomicon, Rust project, living. Backs: minimal and maximal exception safety, the `set_len`-before-`clone` bug and fixes, guard pattern. [^7]
- [Leaking](https://doc.rust-lang.org/nomicon/leaking.html) — The Rustonomicon, Rust project, living. Backs: proxy types, `Drain` leak amplification, `Rc` overflow abort, `thread::scoped`. [^8]
- [Vec in std::vec](https://doc.rust-lang.org/std/vec/struct.Vec.html) — Rust standard library, living. Backs: `set_len` safety requirements, `drain` leaking note. [^9]

## Related
- `rust/unsafe/unsafe-rust-and-undefined-behavior.md` — UB, soundness and Miri.
- `rust/unsafe/memory-layout-and-repr.md` — `PhantomData` is zero-sized; `mem::forget` and `ManuallyDrop`.
- `rust/ownership/lifetimes.md` — lifetime annotations and bounds.
- `rust/ownership/ownership-moves-and-drop.md` — drop order of locals, fields and temporaries.
- `rust/concurrency/threads-channels-and-locks.md` — `Send` and `Sync`.
- `rust/errors/panic-result-and-error-propagation.md` — panics, unwinding and `catch_unwind`.
