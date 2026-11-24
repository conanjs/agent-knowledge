---
schema: knowledge-doc/v1
type: concept
topic: rust/unsafe
status: verified
applies-to: ["Rust 1.100.0", "edition 2024", "Miri on nightly 1.102.0 (2026-11-23)"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [rust, unsafe, undefined-behavior, soundness, miri, stacked-borrows, tree-borrows, edition-2024, safety-comments]
---

# Unsafe Rust, undefined behaviour and Miri

## Summary
**TL;DR:** `unsafe` unlocks a short list of operations the compiler cannot check: dereferencing a raw pointer, calling an `unsafe fn`, using a mutable or external static, reading a union field, implementing an `unsafe trait`, and (edition 2024) declaring `extern` blocks and applying unsafe attributes. It switches off no other check, the borrow checker included. In return the author promises that the program never reaches undefined behaviour (UB), a listed set of things the compiler assumes cannot happen. A safe function built on `unsafe` is *sound* when no safe caller can reach UB through it. Miri, an interpreter that checks every operation, catches most UB at run time, but only on the paths a run takes.
**Use this when:** writing or reviewing an `unsafe` block, deciding whether a safe wrapper is sound, reading a Miri report, or moving unsafe code to edition 2024.
**Not this doc:** layout, `MaybeUninit`, `mem::forget` → `rust/unsafe/memory-layout-and-repr.md`; variance, `PhantomData`, drop check, panic safety → `rust/unsafe/variance-phantomdata-and-drop-check.md`; calling C → `rust/unsafe/ffi-and-c-interop.md`; atomics → `rust/concurrency/atomics-and-memory-ordering.md`.

## Problem
UB is silent. Six lab programs that each commit one UB listed below (read past an array, read freed memory, make a `bool` from byte 2, make a `char` from a surrogate, race two threads, write through a reference after its parent pointer wrote) were built with plain `cargo build`. Five ran to the end with exit status 0 and nothing on stderr; only the `char` one stopped, on an optional debug-build check ✅[^1]. The compiler assumes that every value is valid and that UB never happens, and it optimises on that assumption, so whatever such a binary prints means nothing and may change with the next compiler or optimisation level ✅[^3] ✅[^8]. The evidence is a checker's report, not the output.

## Mental model
**Analogy:** a building inspector (the compiler) signs off every room it can enter. `unsafe` is a short form on which you sign for the few rooms it cannot enter: "I checked the wiring behind this wall." The inspector still inspects every other room (the borrow checker keeps running), and if your signature is false the whole building loses its certificate, not just that room: UB affects the entire program ✅[^3].

**Artifact:** a safe function built on raw pointers. The `SAFETY:` comment names each requirement of `slice::from_raw_parts_mut` (one allocation, initialized, no other access for the lifetime) and why it holds ✅[^15]; Miri accepts it under both aliasing models ✅[^1]:
```rust
fn split_at_mut_raw<T>(s: &mut [T], mid: usize) -> (&mut [T], &mut [T]) {
    let len = s.len();
    assert!(mid <= len, "mid {mid} > len {len}");
    let base = s.as_mut_ptr();
    // SAFETY: `mid <= len`, so both ranges lie inside the one allocation `s`
    // points to, they do not overlap, and `s` stays mutably borrowed for the
    // output lifetime, so no other access can alias them.
    unsafe {
        (std::slice::from_raw_parts_mut(base, mid),
         std::slice::from_raw_parts_mut(base.add(mid), len - mid))
    }
}
// main: temps = [18.5f32, 19.0, 21.25, 22.0, 20.5]; split at 2;
//       morning[0] += 1.0; evening[2] -= 0.5; print temps
```
```console
$ cargo +nightly miri run --bin split                                 # Stacked Borrows (default)
[19.5, 19.0, 21.25, 22.0, 20.0]
$ MIRIFLAGS=-Zmiri-tree-borrows cargo +nightly miri run --bin split   # Tree Borrows
[19.5, 19.0, 21.25, 22.0, 20.0]
```
Safe Rust cannot write this function: two `&mut` into the same slice fail with E0499, because the borrow checker sees two borrows of one slice, not of two disjoint halves ✅[^2].

## How it works
### 1. The unsafe operations
Each row is an operation that needs `unsafe`, and the error edition 2024 gives without it ✅[^1] ✅[^2] ✅[^4]:

| Operation | Example | Error without `unsafe` |
|---|---|---|
| Dereference a raw pointer (creating one with `&raw const x` is safe) | `*p` | `E0133: dereference of raw pointer is unsafe and requires unsafe block` |
| Call an `unsafe fn` | `risky()` | ``E0133: call to unsafe function `risky` is unsafe and requires unsafe block`` |
| Read or write a `static mut` (or an extern static) | `HITS += 1` | `E0133: use of mutable static is unsafe and requires unsafe block` |
| Read a union field (writing one is safe) | `b.u` | `E0133: access to union field is unsafe and requires unsafe block` |
| Implement an unsafe trait | `impl Send for Handle {}` | ``E0200: the trait `Send` requires an `unsafe impl` declaration`` |
| Declare an `extern` block | `extern "C" { … }` | `error: extern blocks must be unsafe` |
| Apply an unsafe attribute | `#[no_mangle]` | `error: unsafe attribute used without unsafe` |

The Book names the first five "superpowers"; the Reference adds the last two and one more: calling a `#[target_feature]` function from a function that does not enable the same features ✅[^2] ✅[^4]. The union row reinterprets bits: with `union Bits { f: f32, u: u32 }`, the value `Bits { f: 1.0 }` read through `u` printed `0x3f800000` ✅[^1]. The compiler's note on E0133 sums up raw pointers: they "may be null, dangling or unaligned; they can violate aliasing rules and cause data races" ✅[^1]. Whether one is valid depends on the access: the `std::ptr` docs ask whether a pointer is valid *for a given access*, and say the precise rules "are not determined yet" ✅[^16].

### 2. What `unsafe` does not switch off
Unsafe Rust has the same rules and meaning as safe Rust; it only allows extra operations ✅[^18]. The borrow checker and the other checks still run inside the block ✅[^2]. Two `&mut stock` used inside `unsafe { *a += 1; *b += 1; }` still fail with ``E0499: cannot borrow `stock` as mutable more than once at a time``, and rustc adds ``warning: unnecessary `unsafe` block`` ✅[^1].

### 3. Who promises what
- **`unsafe fn`** declares a contract the *caller* must meet, found in the function's documentation ✅[^5]; Clippy's `missing_safety_doc` (group `style`, warn by default) asks for a `# Safety` section on every public `unsafe fn` ✅[^17], and printed ``warning: unsafe function's docs are missing a `# Safety` section`` for one without it ✅[^1]. Since edition 2024 its body is no longer an unsafe block: unsafe operations in it need their own `unsafe {}` (lint `unsafe_op_in_unsafe_fn`, now warn by default) ✅[^10].
- **`unsafe { … }`** is the author's claim that every contract of the operations inside holds ✅[^5].
- **`unsafe trait` / `unsafe impl`** put the contract on the *implementer*: `unsafe impl Send` claims the type really can move between threads ✅[^5].
- **Trust is one-way.** Unsafe code may trust the code it chose to depend on, never safe code its callers supply. A `BTreeMap` must stay free of UB even when a caller's `Ord` is not a total order: it may misbehave, but not cause UB ✅[^5].

### 4. Undefined behaviour
The Reference's list, with the lab program that shows each one where there is one ✅[^3] ✅[^1]. The list "is not exhaustive", there is no formal model of Rust's semantics yet, and "the exact aliasing rules are not determined yet" ✅[^3].

| UB | Lab evidence (Miri's headline) |
|---|---|
| A data race | `race`: ``Data race detected between (1) non-atomic write on thread `main` and (2) non-atomic read on thread `unnamed-1` `` |
| A load or store through a dangling pointer | `uaf`: `memory access failed: alloc307 has been freed, so this pointer is dangling`; `oob`: `attempting to access 4 bytes, but got alloc222+0xc which is at or beyond the end of the allocation of size 12 bytes` |
| A load or store through a misaligned pointer; an out-of-bounds field or index projection | references to packed fields are refused at compile time: `rust/unsafe/memory-layout-and-repr.md` |
| Breaking the aliasing rules: a `&T` target mutated outside `UnsafeCell`, a `&mut T` target touched by a pointer not derived from it while it is live | `alias`: Worked example |
| Mutating immutable bytes (a non-`mut` binding, a `static`, bytes behind `&T`) | — |
| Producing an invalid value | `bad_bool`: `constructing invalid value of type bool: encountered 0x02, but expected a boolean`; `bad_char`: ``encountered 0x0000d800, but expected a valid unicode scalar value (in `0..=0x10FFFF` but not in `0xD800..=0xDFFF`)`` |
| Calling a function with the wrong application binary interface (ABI, the calling convention), or unwinding into a frame that does not allow it | `rust/unsafe/ffi-and-c-interop.md` |
| Misusing intrinsics or inline assembly; running code built for target features the CPU lacks; breaking runtime assumptions (C `longjmp` skipping destructors) | — |

Not UB, though usually bugs: deadlocks, logic race conditions, memory leaks, integer overflow with `+`, aborting the process ✅[^6].

### 5. Validity and safety invariants
- **Validity invariant:** must hold every time a value is produced, even inside unsafe code. Examples: `bool` is 0 or 1, `char` is a Unicode scalar value, a reference is non-null, aligned and not dangling, an integer is initialized. Breaking it is immediate UB ✅[^3] ✅[^8].
- **Safety invariant:** what safe code may assume. Unsafe code may break it for a while if it restores it before safe code can look. A `str` holding bytes that are not UTF-8 is "valid-but-unsafe": not UB by itself, but no string operation may run on it and it may not leave the abstraction ✅[^8].
- The glossary in one line: "Data must always be valid, but it only must be safe in safe code." ✅[^8]

### 6. Soundness and the module boundary
A function or library is *sound* if safe code cannot cause UB through its public API; otherwise it is *unsound* ✅[^8] ✅[^3]. Drop the `assert!` from the artifact's function and a `main` without any `unsafe` (a 2-element array split at 5) makes Miri report `constructing invalid value of type &mut [f32]: encountered a dangling reference (going beyond the bounds of its allocation)` inside `split_at_mut_raw` ✅[^1]. The function is unsound, wherever the UB happens to land. Soundness also depends on *safe* code next to the `unsafe` block: in the Nomicon's `Vec`, a safe private method that changes `cap` breaks the unsafe code that trusts `cap`, so privacy at the module boundary is "the only bullet-proof way" to limit the scope of unsafety ✅[^7].

### 7. Miri
- **What it is:** a UB detection tool that runs a binary or a test suite "as a platform-independent interpreter" and checks each operation ✅[^9]. It finds out-of-bounds accesses and use-after-free, uninitialized data, misaligned accesses, invalid values, data races, and (experimental) Stacked Borrows or Tree Borrows aliasing violations; it also reports memory that is still allocated at exit and not reachable from a `static` ✅[^9].
- **How to run:** `rustup +nightly component add miri`, then `cargo +nightly miri run` or `cargo +nightly miri test`; extra flags go in `MIRIFLAGS`, for example `-Zmiri-tree-borrows`, or `-Zmiri-many-seeds` to rerun with the seeds `0..64` of the random choices Miri makes for thread scheduling and allocation addresses ✅[^2] ✅[^9].
- **Reading a report:** `error: Undefined Behavior: <what>`, the source line marked `Undefined Behavior occurred here`, then `help:` lines saying where the allocation was made or freed; Miri exits with status 1 ✅[^1].
- **Limits:** it tests one execution, so code that never ran is never checked; it cannot call most platform APIs or foreign functions; weak memory emulation is incomplete; and it cannot prove soundness. "When Miri finds UB, your code is definitely unsound", but a clean run only covers the inputs tried ✅[^9] ✅[^2].

### 8. Edition 2024 changes
The same files compiled with `--edition 2021` and `--edition 2024` ✅[^1]:

| Change | Edition 2021 | Edition 2024 |
|---|---|---|
| Unsafe operation in an `unsafe fn` body with no inner block | compiles silently | `warning[E0133]: dereference of raw pointer is unsafe and requires unsafe block` (`#[warn(unsafe_op_in_unsafe_fn)]`) |
| `extern "C" { … }` | compiles | `error: extern blocks must be unsafe` |
| `#[no_mangle]` | compiles | `error: unsafe attribute used without unsafe`, help `#[unsafe(no_mangle)]` |
| `let r = &VISITS;` on a `static mut` | `warning: creating a shared reference to mutable static` | the same text as an error (`#[deny(static_mut_refs)]`); `VISITS += 1` still compiles |
| `std::env::set_var(…)` | compiles | ``error[E0133]: call to unsafe function `set_var` is unsafe and requires unsafe block`` |

Sources: the five Edition Guide pages ✅[^10] ✅[^11] ✅[^12] ✅[^13] ✅[^14]. `export_name` and `link_section` are unsafe attributes too ✅[^12]; `remove_var` and `CommandExt::before_exec` also became unsafe; the two environment functions because calling them can be unsound in a multithreaded program on some platforms ✅[^14]. `cargo fix --edition` adds `unsafe` to extern blocks, wraps the attributes and the newly unsafe calls, but cannot check that the code is correct ✅[^11] ✅[^12] ✅[^14]; references to `static mut` have no automatic fix, and the guide points to atomics, `Mutex`, `OnceLock`/`LazyLock`, or `&raw const`/`&raw mut` ✅[^13].

### 9. `SAFETY:` comments
The Book's idiom: a comment starting with `SAFETY` before each unsafe operation saying how its rules are met, and one on each `unsafe fn` saying what the caller must do ✅[^2]. Clippy's `undocumented_unsafe_blocks` (group `restriction`, allowed by default) enforces the first ✅[^17]. With `-W clippy::undocumented_unsafe_blocks` it printed `warning: unsafe block missing a safety comment` for the use-after-free program and nothing for the artifact above ✅[^1].

## Worked example
One aliasing bug under both models. `r` is a `&mut` made from the raw pointer `ptr`; the parent `ptr` writes while `r` is still going to be used:
```rust
let mut level = 1i32;
let ptr = &raw mut level;
let r = unsafe { &mut *ptr }; // unique reference derived from ptr
unsafe { *ptr = 2 };          // write through the parent pointer
*r = 3;                       // r is used after that write
```
| Step | Stacked Borrows (default) | Tree Borrows (`-Zmiri-tree-borrows`) |
|---|---|---|
| `let r = &mut *ptr` | `<551> was created by a Unique retag at offsets [0x0..0x4]` | `<525> was created here, in the initial state Reserved` |
| `*ptr = 2` | `<551> was later invalidated at offsets [0x0..0x4] by a write access` | `<525> later transitioned to Disabled due to a foreign write access` |
| `*r = 3` | `attempting a write access using <551> at alloc222[0x0], but that tag does not exist in the borrow stack for this location` | `write access through <525> at alloc222[0x0] is forbidden` … `the accessed tag <525> has state Disabled` |

Both runs ended with `Undefined Behavior`, and both say the violated rules "are still experimental" ✅[^1]. The rule they model is the Reference's: memory behind a live `&mut T` may not be read or written through a pointer not derived from it ✅[^3]. The fix is to finish with the child before going back to the parent: swap the last two lines (`*r = 3;` then `*ptr = 2`), and both models accept the program, which prints `2` ✅[^1].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `p.add(3)` on a 3-element array, then `*` | Miri accepted the arithmetic and reported the 4-byte read | One-past-the-end is a valid offset; only the access is out of bounds ✅[^1] |
| `&mut bytes[0] as *mut u8`, then write `first.add(1)` | Stacked Borrows: `that tag does not exist in the borrow stack` (the retag covered only `[0x0..0x1]`); Tree Borrows: prints `[0, 7]` | The two experimental models disagree; Miri's README warns that the final model will likely be stricter than Tree Borrows, so do not rely on its acceptance ✅[^1] ✅[^9] |
| Debug build of `char::from_u32_unchecked(0xD800)` | Aborts: ``unsafe precondition(s) violated: invalid value for `char` `` … `This Undefined Behavior check is optional, and cannot be relied on for safety.` The release build exits 0 silently | std checks some preconditions in debug builds only ✅[^1] |
| Debug build of the unsound split (no `assert!`) | Aborts: ``unsafe precondition(s) violated: slice::from_raw_parts_mut requires the pointer to be aligned and non-null, and the total size of the slice not to exceed `isize::MAX` `` | Same optional check; Miri flagged the first slice, the debug check the second ✅[^1] |
| `unsafe { }` around safe code only | ``warning: unnecessary `unsafe` block`` | The block contains no unsafe operation ✅[^1] |
| `VISITS += 1` on a `static mut` in edition 2024 | Compiles inside `unsafe` | Only taking a reference is denied ✅[^1] ✅[^13] |
| Miri on a program that calls C | Stops: `unsupported operation` | Miri cannot run foreign code; see `rust/unsafe/ffi-and-c-interop.md` ✅[^9] |
| A clean Miri run | No UB on that path, with that seed | Not a soundness proof ✅[^9] |

## Takeaways
- Put a `// SAFETY:` comment on every `unsafe` block naming each obligation and why it holds, and enable `clippy::undocumented_unsafe_blocks`. [rule-candidate]
- Give every `unsafe fn` and `unsafe trait` a `# Safety` doc section that lists the caller's or implementer's obligations. [rule-candidate]
- Check every argument that an unsafe block relies on (`assert!(mid <= len)`), because a safe caller can pass anything. [rule-candidate]
- Keep unsafe code in a small module with private fields, and review the whole module, not only the block.
- Run `cargo +nightly miri test` in continuous integration (CI) for crates with unsafe code, under both Stacked and Tree Borrows. [rule-candidate]
- Treat a program's output as no evidence once it may have UB; read Miri's report.

## Verification status
- Verified: 72 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `linux/lab-setup.md` — the Rust 1.100.0 lab (`rustlab:1`) where every behaviour marked with this note ran on 2026-11-24. [^1]
- [Unsafe Rust](https://doc.rust-lang.org/book/ch20-01-unsafe-rust.html) — The Rust Programming Language, Steve Klabnik, Carol Nichols, Chris Krycho and the Rust community, living. Backs: the five superpowers, `unsafe` keeps the borrow checker, `split_at_mut` and E0499, `SAFETY` comments, running Miri and its limits. [^2]
- [Behavior considered undefined](https://doc.rust-lang.org/reference/behavior-considered-undefined.html) — The Rust Reference, Rust project, living. Backs: the UB list, not exhaustive, aliasing rules not determined, invalid values, soundness, UB affects the whole program. [^3]
- [Unsafety](https://doc.rust-lang.org/reference/unsafety.html) — The Rust Reference, Rust project, living. Backs: the full list of unsafe operations, including extern blocks, unsafe attributes and `target_feature` calls. [^4]
- [How Safe and Unsafe Interact](https://doc.rust-lang.org/nomicon/safe-unsafe-meaning.html) — The Rustonomicon, Rust project, living. Backs: who promises what for `unsafe fn`, blocks and traits; one-way trust; the `BTreeMap`/`Ord` example. [^5]
- [What Unsafe Rust Can Do](https://doc.rust-lang.org/nomicon/what-unsafe-does.html) — The Rustonomicon, Rust project, living. Backs: what is not UB (deadlock, race condition, leak, overflow, abort). [^6]
- [Working with Unsafe](https://doc.rust-lang.org/nomicon/working-with-unsafe.html) — The Rustonomicon, Rust project, living. Backs: soundness depends on safe code in the module; privacy as the boundary. [^7]
- [Glossary](https://rust-lang.github.io/unsafe-code-guidelines/glossary.html) — Unsafe Code Guidelines Reference, Rust project, living. Backs: soundness, validity and safety invariants, UB as a contract. [^8]
- [rust-lang/miri: An interpreter for Rust's mid-level intermediate representation](https://github.com/rust-lang/miri) — Miri project (README), living. Backs: what Miri detects, leak check, flags, Tree Borrows status, limits. [^9]
- [unsafe_op_in_unsafe_fn warning](https://doc.rust-lang.org/edition-guide/rust-2024/unsafe-op-in-unsafe-fn.html) — The Rust Edition Guide, Rust project, living. Backs: the lint warns by default in 2024; `unsafe fn` bodies need blocks. [^10]
- [Unsafe extern blocks](https://doc.rust-lang.org/edition-guide/rust-2024/unsafe-extern.html) — The Rust Edition Guide, Rust project, living. Backs: `unsafe extern` required; migration. [^11]
- [Unsafe attributes](https://doc.rust-lang.org/edition-guide/rust-2024/unsafe-attributes.html) — The Rust Edition Guide, Rust project, living. Backs: `no_mangle`, `export_name`, `link_section` need `unsafe(...)`; migration. [^12]
- [Disallow references to static mut](https://doc.rust-lang.org/edition-guide/rust-2024/static-mut-references.html) — The Rust Edition Guide, Rust project, living. Backs: `static_mut_refs` deny by default, alternatives, no automatic migration. [^13]
- [Newly unsafe functions](https://doc.rust-lang.org/edition-guide/rust-2024/newly-unsafe-functions.html) — The Rust Edition Guide, Rust project, living. Backs: `set_var`, `remove_var`, `before_exec` became unsafe, and why. [^14]
- [from_raw_parts_mut in std::slice](https://doc.rust-lang.org/std/slice/fn.from_raw_parts_mut.html) — Rust standard library, living. Backs: the safety requirements the artifact's comment discharges. [^15]
- [std::ptr](https://doc.rust-lang.org/std/ptr/index.html) — Rust standard library, living. Backs: pointer validity depends on the access; rules not determined yet. [^16]
- [Clippy Lints](https://clippy.rust-lang.org/rust-1.100.0/index.html) — Clippy project (lint list for Rust 1.100.0), 2026. Backs: `undocumented_unsafe_blocks` and `missing_safety_doc` groups, default levels and rules. [^17]
- [Meet Safe and Unsafe](https://doc.rust-lang.org/nomicon/meet-safe-and-unsafe.html) — The Rustonomicon, Rust project, living. Backs: unsafe Rust has the same rules as safe Rust plus extra abilities. [^18]

## Related
- `rust/unsafe/memory-layout-and-repr.md` — sizes, `repr`, niches, `MaybeUninit`, leaking.
- `rust/unsafe/variance-phantomdata-and-drop-check.md` — variance, `PhantomData`, drop check, panic safety.
- `rust/unsafe/ffi-and-c-interop.md` — `unsafe extern`, `#[unsafe(no_mangle)]`, `"C-unwind"`.
- `rust/ownership/borrowing-references-and-slices.md` — the aliasing XOR mutation rule as safe Rust enforces it.
- `rust/concurrency/atomics-and-memory-ordering.md` — data-race-free shared state; loom.
- `concurrency/shared-state-and-data-races.md` — data races across languages.
