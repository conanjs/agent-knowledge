---
schema: knowledge-doc/v1
type: concept
topic: rust/ecosystem
status: verified
applies-to: ["Rust 1.100.0", "edition 2024", "targets thumbv7em-none-eabihf and wasm32-unknown-unknown"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [rust, no-std, embedded, cortex-m, webassembly, wasm, core, alloc, global-allocator, panic-handler, cross-compilation]
---

# `no_std`, embedded targets and WebAssembly

## Summary
**TL;DR:** The standard library is three layers: `core` (the language itself, no operating system and no heap), `alloc` (heap types such as `Vec` and `String`, which need a global allocator) and `std` (files, threads, clocks, randomness, all from an operating system). `#![no_std]` links only `core`; a `no_std` binary must then bring what `std` normally supplies: a `#[panic_handler]`, its own entry point (`#![no_main]` plus a linker script on bare metal) and, to use `alloc`, a `#[global_allocator]`. `thumbv7em-none-eabihf` (Cortex-M4F/M7F microcontrollers) offers only `core` and `alloc`; `wasm32-unknown-unknown` compiles all of `std`, but most operating-system calls fail at run time.
**Use this when:** writing a library that must also run on a microcontroller or in WebAssembly; reading "`#[panic_handler]` function required", "no global memory allocator found" or "can't find crate for `core`"; deciding whether a type lives in `core`, `alloc` or `std`; shrinking a `.wasm` module.
**Not this doc:** `extern "C"`, `repr(C)` and calling C → `rust/unsafe/ffi-and-c-interop.md`; the orderings used in the allocator below → `rust/concurrency/atomics-and-memory-ordering.md`; profile settings in general → `rust/project-structure/cargo-workspaces-features-and-profiles.md`; what makes `unsafe` code sound → `rust/unsafe/unsafe-rust-and-undefined-behavior.md`; serde in `no_std` → `rust/ecosystem/serde-data-model.md`.

## Problem
Code that builds on a laptop fails for a microcontroller in several distinct ways: `std::` paths do not resolve, `HashMap` and `f32::sqrt` are missing, `AtomicU64` does not exist, a binary without `main` links into an empty file, and the first `Vec::push` stops the build with an allocator error. On the WebAssembly side the same crate builds, but a debug module weighs 1.6 MB and file or thread calls fail only when they run. Each failure maps to one missing layer or one missing piece that `std` used to supply.

## Mental model
**Analogy:** a building with three floors. The ground floor, `core`, is the language itself: integers, slices, `Option`, formatting, atomics. The first floor, `alloc`, has running water, but only if you install the plumbing yourself (a heap allocator). The top floor, `std`, needs the city's utilities: an operating system for files, threads, the clock and random numbers. `#![no_std]` means living on the ground floor; you may add the first floor by bringing your own plumbing.

**Artifact:** a library that lives on the ground floor. It formats text without an allocator by writing into a caller's buffer through `core::fmt::Write` ✅[^1]:
```rust
#![no_std]
pub fn fletcher16(data: &[u8]) -> u16 {
    let (mut a, mut b) = (0u16, 0u16);
    for &byte in data { a = (a + byte as u16) % 255; b = (b + a) % 255; }
    (b << 8) | a
}
pub fn format_reading(buf: &mut [u8], celsius: i16) -> Option<&str> {
    use core::fmt::Write;
    struct Cursor<'a> { buf: &'a mut [u8], len: usize }
    impl Write for Cursor<'_> {
        fn write_str(&mut self, s: &str) -> core::fmt::Result {
            let end = self.len + s.len();
            if end > self.buf.len() { return Err(core::fmt::Error); }
            self.buf[self.len..end].copy_from_slice(s.as_bytes());
            self.len = end;
            Ok(())
        }
    }
    let mut c = Cursor { buf, len: 0 };
    write!(c, "T={celsius}C").ok()?;
    let len = c.len;
    core::str::from_utf8(&buf[..len]).ok()
}
```
`cargo build --release --target thumbv7em-none-eabihf` and `--target wasm32-unknown-unknown` both finish; on the host, `fletcher16(b"abcde")` is `0xc8f0`, `format_reading` into 16 bytes gives `Some("T=-7C")` and into 3 bytes `None` ✅[^1].

Which floor holds what, checked by compiling for `thumbv7em-none-eabihf` ✅[^1]:

| Item | Layer | Result in a `#![no_std]` crate |
|---|---|---|
| `core::fmt::Write`, slices, `str`, `f32::abs` | `core` | compiles |
| `alloc::vec::Vec`, `alloc::collections::BTreeMap` | `alloc` | needs `extern crate alloc;` and a global allocator at link time |
| `alloc::collections::HashMap` | `std` only | `error[E0432]: unresolved import` ("no `HashMap` in `collections`") |
| `std::time::SystemTime` | `std` | ``error[E0433]: cannot find module or crate `std` in this scope`` |
| `f32::sqrt` | `std` | ``error[E0599]: no method named `sqrt` found for type `f32` `` |
| `core::sync::atomic::AtomicU64` | `core`, per target | E0432 on `thumbv7em-none-eabihf`; compiles for `wasm32-unknown-unknown` |

This matches the documented split: `core` has no heap, concurrency or I/O and links to no system library ✅[^16]; `alloc` holds the heap pointers and collections and `std` re-exports it ✅[^17]; `HashMap` stays in `std` because its default hasher is seeded from host randomness ✅[^19] ✅[^2].

## How it works
### Bare metal: `thumbv7em-none-eabihf`
Five actors bring a bare-metal binary to life:
- **rustup** — its job: install the precompiled `core` and `alloc` for a target, via `rustup target add`.
- **rustc** — its job: compile against that target's libraries and settings, via `--target` and the built-in target specification.
- **Your crate** — its job: supply what `std` would have, via `#[panic_handler]`, an exported reset handler and `#[global_allocator]`.
- **rust-lld (the linker)** — its job: place code and data at fixed addresses, via the linker script passed as `-C link-arg=-Tlink.x`.
- **The CPU at reset** — its job: start the program, via the first two words of flash (the vector table).

```
build machine (all local)                               device flash at 0x0800_0000
┌──────────────┐   ┌──────────────────┐   ┌─────────┐   ┌──────────────────────────────┐
│ rustup target│──▶│ rustc --target … │──▶│ rust-lld│──▶│ word 0: 0x2001_0000 (stack)  │
│ add (core,   │   │ panic_handler,   │   │ link.x  │   │ word 1: 0x0800_0009 (Reset|1)│
│ alloc .rlib) │   │ Reset, allocator │   └─────────┘   │ .text, .rodata               │
└──────────────┘   └──────────────────┘                 └──────────────────────────────┘
                                                          RAM 0x2000_0000: .bss (HEAP), .data, stack ↓
```

1. **rustup — the target's libraries.** `rustup target add thumbv7em-none-eabihf` installs the standard library parts for that target ✅[^22] ✅[^5]. The target is Tier 2 ("guaranteed to build") with `no_std` support only ✅[^6], for Cortex-M4/M4F and M7/M7F, offering `core` and `alloc` ✅[^7]. Without the target installed, rustc stops at ``error[E0463]: can't find crate for `core` `` with the hint `rustup target add riscv32imac-unknown-none-elf` (tested with a target the lab lacks) ✅[^1].
2. **rustc — the target specification.** `rustc +nightly -Z unstable-options --print target-spec-json --target thumbv7em-none-eabihf` shows `"panic-strategy": "abort"`, `"linker": "rust-lld"`, `"max-atomic-width": 32` and `"features": "+vfp4d16sp"` ✅[^1]. The 32-bit maximum atomic width matches the missing `AtomicU64` ✅[^1]; atomic types are not available on every platform, and `#[cfg(target_has_atomic = "64")]` selects code by supported width ✅[^26]. Armv7E-M itself has full compare-and-swap ✅[^26]. `eabihf` passes `f32`/`f64` arguments in floating-point registers, so it needs an FPU ✅[^8].
3. **Your crate — the pieces `std` supplied.**
   - `#![no_std]` stops `std` from being linked and switches the prelude to `core`'s; it is valid only at the crate root ✅[^10] (in a module rustc warns ``the `#![no_std]` attribute can only be used at the crate root``) ✅[^1].
   - `fn main` needs `std`'s start-up code: ``error: using `fn main` requires the standard library``, with the help to use `#![no_main]` ✅[^1]. `#![no_main]` stops rustc from emitting the `main` symbol ✅[^11].
   - Any `no_std` binary needs exactly one `#[panic_handler]` of type `fn(&PanicInfo) -> !` in its dependency graph ✅[^12] ✅[^3]; without one: ``error: `#[panic_handler]` function required, but not found`` ✅[^1]. Crates such as `panic-halt` provide one ✅[^3].
   - With only a panic handler, the build links but warns `rust-lld: cannot find entry symbol _start; not setting start address`, and the 704-byte ELF holds no program ✅[^1].
4. **Your crate plus rust-lld — entry point and vector table.** The target ships no linker script; you bring one for your device ✅[^8]. The lab's `link.x` places a `LONG(ORIGIN(RAM) + LENGTH(RAM))` word and then the `.vector_table.reset_vector` section at the start of flash, keeps `RESET_VECTOR` with `EXTERN`, sets `ENTRY(Reset)` and discards `.ARM.exidx`, following the Embedonomicon's layout ✅[^20]. The Rust side:
   ```rust
   #[unsafe(no_mangle)]
   pub extern "C" fn Reset() -> ! {
       let mut ticks: u32 = 0;
       loop { ticks = ticks.wrapping_add(1); core::hint::black_box(ticks); }
   }
   #[unsafe(link_section = ".vector_table.reset_vector")]
   #[unsafe(no_mangle)]
   pub static RESET_VECTOR: extern "C" fn() -> ! = Reset;
   ```
   In edition 2024 both `no_mangle` and `link_section` must be written as `unsafe(…)` attributes ✅[^14]. Built with `-C opt-level=s -C link-arg=-Tlink.x`, the ELF header shows machine `0x28` (Arm) and entry `0x08000009`; `rust-objcopy -O binary` (the copy shipped in the toolchain's `lib/rustlib/<host>/bin`, run with `LD_LIBRARY_PATH` set to the toolchain's `lib`) gives a 24-byte flash image whose first words are `20010000 08000009` ✅[^1]. Word 0 is the initial stack pointer (end of the 64 KiB RAM) and word 1 the reset handler; the odd address is the Thumb bit ✅[^20].
5. **`alloc` and the global allocator.** `extern crate alloc;` brings in `Vec`; with no allocator the link fails: ``error: no global memory allocator found but one is required; link to std or add `#[global_allocator]` to a static item that implements the GlobalAlloc trait`` ✅[^1] ✅[^4]. `#[global_allocator]` accepts one `static` whose type implements `GlobalAlloc`, once in the whole crate graph ✅[^13]. The lab used a 4 KiB bump allocator (it never frees; the Embedded Book and the `GlobalAlloc` docs show the same idea) ✅[^4] ✅[^18]:
   ```rust
   struct Bump { arena: UnsafeCell<[u8; 4096]>, next: AtomicUsize }
   // SAFETY: `next` is only advanced atomically, so two callers never get the same bytes.
   unsafe impl Sync for Bump {}
   unsafe impl GlobalAlloc for Bump {
       unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
           let base = self.arena.get() as usize;
           let mut cur = self.next.load(Ordering::Relaxed);
           loop {
               let start = (base + cur).next_multiple_of(layout.align()) - base;
               let end = start + layout.size();
               if end > 4096 { return core::ptr::null_mut(); }   // null = out of memory
               match self.next.compare_exchange_weak(cur, end, Ordering::Relaxed, Ordering::Relaxed) {
                   Ok(_) => return (base + start) as *mut u8,
                   Err(seen) => cur = seen,
               }
           }
       }
       unsafe fn dealloc(&self, _ptr: *mut u8, _layout: Layout) {}
   }
   #[global_allocator]
   static HEAP: Bump = Bump { arena: UnsafeCell::new([0; 4096]), next: AtomicUsize::new(0) };
   ```
   Returning null signals exhaustion, and an allocator must never unwind ✅[^18]. With one `Vec::push` in `Reset`, the link map puts `HEAP` in `.bss` at `0x2000_0000` (`0x1004` bytes: arena plus counter), and the flash image grows from 24 to 3,888 bytes ✅[^1].
6. **What this demo leaves out.** RAM holds random values after power-up, so a real reset handler zeroes `.bss` and copies `.data` from flash before any `static` is read; the Embedonomicon writes that start-up code in assembly, and runtime crates such as `cortex-m-rt` provide it together with the linker script ✅[^21]. The images above prove what links and where it lands; they were not run on hardware.

### WebAssembly: `wasm32-unknown-unknown`
- It is Tier 2 and has `std` ✅[^6], but it imports nothing from the host: `core` and `alloc` work fully, `println!` does nothing, `std::fs` always errors and `std::thread::spawn` panics ✅[^9]. Measured: `std::fs::File::open` returned `ErrorKind::Unsupported` ✅[^1].
- Its target specification shows `"panic-strategy": "abort"`, `"linker-flavor": "wasm-lld"`, `"max-atomic-width": 64` and `"singlethread": true` ✅[^1]; the default global allocator is `dlmalloc` ✅[^9].
- A library becomes a module with `crate-type = ["cdylib"]`, the C-compatible dynamic library type ✅[^25] ✅[^15]; each `#[unsafe(no_mangle)] pub extern "C" fn` becomes an export, and a plain `pub fn` does not ✅[^1] ✅[^14].

## Worked example
One `cdylib` with one exported function, built with several profiles and features and loaded in Node.js 24.22.1 on the host:
```rust
/// Number of Collatz steps needed to reach 1 from `n` (0 for n = 0).
#[unsafe(no_mangle)]
pub extern "C" fn collatz_steps(mut n: u64) -> u32 {
    let mut steps = 0;
    while n > 1 { n = if n % 2 == 0 { n / 2 } else { 3 * n + 1 }; steps += 1; }
    steps
}
```
The size profile used `opt-level = "z"`, `lto = true`, `codegen-units = 1`, `panic = "abort"`, `strip = true` ✅[^23]. Sizes from `cargo build [--release] --target wasm32-unknown-unknown` ✅[^1]:

| Build | Exports | `.wasm` size |
|---|---|---|
| debug profile | `collatz_steps` | 1,639,506 bytes |
| release, `strip = "none"` set explicitly | `collatz_steps` | 1,579,154 bytes |
| release, default profile | `collatz_steps` | 397 bytes |
| release, size profile | `collatz_steps` | 119 bytes |
| size profile, plus an export that calls `format!` | + `label_len` | 16,486 bytes (24,418 with the default release profile) |
| size profile, plus an export that calls `std::fs::File::open` | + `open_is_unsupported` | 323 bytes (1,446 with the default release profile) |

Loading the 119-byte module with `WebAssembly.instantiate` listed no imports and the exports `memory:memory` and `collatz_steps:function`; `collatz_steps(27n)` returned `111`, and `label_len(42)` on the formatting build returned `11` ✅[^1]. A Rust `u64` is a JavaScript `BigInt` at the boundary: `collatz_steps(27)` throws `TypeError: Cannot convert 27 to a BigInt` ✅[^1].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Default release profile versus `strip = "none"` | 397 bytes versus 1,579,154 bytes | Since Rust 1.77, profiles without debug info strip debug info by default ✅[^24] ✅[^1]; the Cargo Book's profile page still lists `strip = "none"` as the default ✅[^23] |
| `#![no_std]` binary with `fn main` | ``error: using `fn main` requires the standard library`` | `main` is called by `std`'s start-up code ✅[^1] ✅[^2] |
| `#![no_std]` + `#![no_main]`, no panic handler | ``error: `#[panic_handler]` function required, but not found`` | Exactly one handler per binary ✅[^1] ✅[^12] |
| Panic handler but no entry symbol | Links with a warning; empty 704-byte ELF | The linker found no entry symbol (`_start`) to start from ✅[^1] |
| `Vec` without `#[global_allocator]` | Link-time error | `alloc` needs an allocator ✅[^1] ✅[^4] |
| `AtomicU64` on `thumbv7em-none-eabihf` | E0432 | The target spec says `max-atomic-width` 32; guard with `#[cfg(target_has_atomic = "64")]` ✅[^1] ✅[^26] |
| Armv6-M (`thumbv6m-*`) and older Arm cores | Atomic `load`/`store` only, no `compare_exchange` or `fetch_add` | Those architectures support only basic atomic loads and stores ✅[^8] ✅[^26] |
| `x.sqrt()` on `f32` in `no_std` | E0599; `abs()` works | The same call compiles and prints `1.4142135` once `std` is linked ✅[^1] |
| Reading a `static` before `.bss`/`.data` initialization | Undefined behaviour on real hardware | RAM is random at power-up ✅[^21] |
| `-fpregs` with `thumbv7em-none-eabihf` | Unsound mix of ABIs | Never disable FPU registers on `eabihf` ✅[^7] |
| `println!` in `wasm32-unknown-unknown` | Prints nothing | No host imports ✅[^9] |
| `u64` export called with a JS number | `TypeError` | 64-bit integers map to `BigInt` ✅[^1] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `core` only, caller-provided buffers | No allocator, no out-of-memory, predictable memory | API takes buffers; fixed sizes |
| `alloc` + a global allocator | Familiar `Vec`/`String`/`Box` | Out-of-memory at any growth point; fragmentation; growth time hard to bound ✅[^4] |
| Fixed-capacity collections (`heapless` crate) | Capacity in the type, constant-time `push`, overflow caught as `Result` | Must pick capacities; cannot shrink ✅[^4] |
| `wasm32-unknown-unknown` | No host assumptions, minimal modules | `std` I/O does nothing or fails ✅[^9] |
| `wasm32-wasip1` / `wasm32-wasip2` | Fuller `std` through WASI | Needs a WASI host ✅[^9] |
| `wasm32v1-none` | `no_std` for engines without newer WebAssembly features | No `std` ✅[^9] |

## Takeaways
- Write reusable libraries as `#![no_std]` with an optional `std` feature, and build them for a `no_std` target in CI so a stray `std::` fails early. [rule-candidate]
- Import from `core::` and `alloc::` rather than `std::` in library code that might run without an operating system. [rule-candidate]
- On bare metal, take the reset handler, `.bss`/`.data` start-up and linker script from a runtime crate such as `cortex-m-rt` instead of writing your own.
- Check the target's `max-atomic-width` before choosing 64-bit atomics, and gate them with `#[cfg(target_has_atomic = "64")]`. [rule-candidate]
- Measure `.wasm` size per build profile; debug builds and `strip = "none"` carry megabytes of debug info.
- Pass `BigInt` for `u64`/`i64` WebAssembly parameters from JavaScript.

## Verification status
- Verified: 76 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `linux/lab-setup.md` — the Rust 1.100.0 lab (`rustlab:1`) where every behaviour marked with this note ran on 2026-11-24; the `.wasm` files were loaded in Node.js 24.22.1 on the host. [^1]
- [no_std](https://docs.rust-embedded.org/book/intro/no-std.html) — The Embedded Rust Book, Rust Embedded Working Group, living. Backs: hosted versus bare metal, `core`, what `no_std` lacks, `HashMap`. [^2]
- [Panicking](https://docs.rust-embedded.org/book/start/panicking.html) — The Embedded Rust Book, Rust Embedded Working Group, living. Backs: one panic handler, handler crates. [^3]
- [Collections](https://docs.rust-embedded.org/book/collections/index.html) — The Embedded Rust Book, Rust Embedded Working Group, living. Backs: `alloc` with `#[global_allocator]`, bump allocator, `heapless` trade-offs. [^4]
- [Installation](https://docs.rust-embedded.org/book/intro/install.html) — The Embedded Rust Book, Rust Embedded Working Group, living. Backs: `rustup target add thumbv7em-none-eabihf`, target per Cortex-M family. [^5]
- [Platform Support](https://doc.rust-lang.org/rustc/platform-support.html) — The rustc book, Rust project, living. Backs: tiers and the `std` column for both targets. [^6]
- [thumbv7em-none-eabi and thumbv7em-none-eabihf](https://doc.rust-lang.org/rustc/platform-support/thumbv7em-none-eabi.html) — The rustc book, Rust project, living. Backs: CPUs, `core`/`alloc`, `-fpregs` warning. [^7]
- [arm-none-eabi](https://doc.rust-lang.org/rustc/platform-support/arm-none-eabi.html) — The rustc book, Rust project, living. Backs: bring your own linker script, hard-float ABI, atomics on older cores. [^8]
- [wasm32-unknown-unknown](https://doc.rust-lang.org/rustc/platform-support/wasm32-unknown-unknown.html) — The rustc book, Rust project, living. Backs: no host imports, `std` behaviour, `dlmalloc`, WASI and `wasm32v1-none` alternatives. [^9]
- [Preludes](https://doc.rust-lang.org/reference/names/preludes.html#the-no_std-attribute) — The Rust Reference, Rust project, living. Backs: the `no_std` attribute. [^10]
- [Crates and source files](https://doc.rust-lang.org/reference/crates-and-source-files.html#the-no_main-attribute) — The Rust Reference, Rust project, living. Backs: the `no_main` attribute. [^11]
- [Panic](https://doc.rust-lang.org/reference/panic.html#the-panic_handler-attribute) — The Rust Reference, Rust project, living. Backs: `panic_handler` signature, one per graph, required for `no_std` binaries. [^12]
- [The Rust runtime](https://doc.rust-lang.org/reference/runtime.html#the-global_allocator-attribute) — The Rust Reference, Rust project, living. Backs: `global_allocator` rules. [^13]
- [Application binary interface](https://doc.rust-lang.org/reference/abi.html) — The Rust Reference, Rust project, living. Backs: `unsafe(no_mangle)`, `unsafe(link_section)`, symbol export. [^14]
- [Linkage](https://doc.rust-lang.org/reference/linkage.html) — The Rust Reference, Rust project, living. Backs: the `cdylib` crate type. [^15]
- [core](https://doc.rust-lang.org/core/index.html) — Rust standard library docs, Rust project, living. Backs: `core` has no heap, I/O or system dependencies. [^16]
- [alloc](https://doc.rust-lang.org/alloc/index.html) — Rust standard library docs, Rust project, living. Backs: heap types, re-exported by `std`. [^17]
- [GlobalAlloc in core::alloc](https://doc.rust-lang.org/core/alloc/trait.GlobalAlloc.html) — Rust standard library docs, Rust project, living. Backs: required methods, null on failure, no unwinding, bump example. [^18]
- [HashMap in std::collections](https://doc.rust-lang.org/std/collections/struct.HashMap.html) — Rust standard library docs, Rust project, living. Backs: randomly seeded default hasher. [^19]
- [Memory layout](https://docs.rust-embedded.org/embedonomicon/memory-layout.html) — The Embedonomicon, Rust Embedded Working Group, living. Backs: vector table, linker script, Thumb bit. [^20]
- [A main interface](https://docs.rust-embedded.org/embedonomicon/main.html) — The Embedonomicon, Rust Embedded Working Group, living. Backs: `.bss`/`.data` initialization, runtime crates. [^21]
- [Cross-compilation](https://rust-lang.github.io/rustup/cross-compilation.html) — The rustup book, Rust project, living. Backs: `rustup target add`. [^22]
- [Profiles](https://doc.rust-lang.org/cargo/reference/profiles.html) — The Cargo Book, Rust project, living. Backs: `opt-level`, `lto`, `codegen-units`, `panic`, `strip` and the listed defaults. [^23]
- [Announcing Rust 1.77.0](https://blog.rust-lang.org/2024/03/21/Rust-1.77.0/) — The Rust Blog, Rust project, 2024. Backs: `strip = "debuginfo"` by default for profiles without debug info. [^24]
- [Cargo Targets](https://doc.rust-lang.org/cargo/reference/cargo-targets.html#the-crate-type-field) — The Cargo Book, Rust project, living. Backs: `crate-type = ["cdylib"]`. [^25]
- [core::sync::atomic](https://doc.rust-lang.org/core/sync/atomic/index.html) — Rust standard library docs, Rust project, living. Backs: atomic availability per platform, `target_has_atomic`, CAS on Armv6-M versus Armv7E-M. [^26]

## Related
- `rust/unsafe/ffi-and-c-interop.md` — `extern "C"` functions and symbols.
- `rust/unsafe/unsafe-rust-and-undefined-behavior.md` — the `unsafe` impls and `// SAFETY:` comments above.
- `rust/concurrency/atomics-and-memory-ordering.md` — `compare_exchange_weak` and `Relaxed`.
- `rust/project-structure/cargo-workspaces-features-and-profiles.md` — profiles and features.
- `rust/ecosystem/serde-data-model.md` — serde features in `no_std`.
