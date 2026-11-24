---
schema: knowledge-doc/v1
type: concept
topic: rust/unsafe
status: verified
applies-to: ["Rust 1.100.0", "edition 2024", "gcc 14.2.0 (Debian) on aarch64-unknown-linux-gnu, glibc"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [rust, ffi, c, extern, unsafe-extern, no-mangle, repr-c, cstring, cstr, callback, c-unwind, build-script, bindgen, cbindgen]
---

# FFI and C interop

## Summary
**TL;DR:** Through the foreign function interface (FFI), Rust calls C through declarations in an `unsafe extern "C"` block; each item is unsafe to call unless it is marked `safe fn`. C calls Rust through `extern "C" fn` items exported under a fixed name with `#[unsafe(no_mangle)]`, or through function pointers. Only C-compatible things cross the boundary: integers and floats, raw pointers, `repr(C)` or `repr(transparent)` types, `Box<T>` as `T*`, and `Option` of a reference, box or function pointer as a nullable pointer. Strings go through `CString` (owned, ending in a NUL, the zero byte; Rust → C) and `CStr` (borrowed, C → Rust). A panic that reaches an `extern "C"` boundary aborts the process; to let it unwind through C frames, both sides must use the `"C-unwind"` application binary interface (ABI, the calling convention).
**Use this when:** calling a C library or libc (the C standard library) from Rust, exposing Rust functions to C, passing a Rust callback to C, compiling a C file inside a Cargo build, or choosing between hand-written declarations and bindgen/cbindgen.
**Not this doc:** what `unsafe` allows and the edition-2024 errors for a bare `extern` block or `#[no_mangle]` → `rust/unsafe/unsafe-rust-and-undefined-behavior.md`; `repr(C)` layout rules → `rust/unsafe/memory-layout-and-repr.md`; `build.rs` and profiles in general → `rust/project-structure/cargo-workspaces-features-and-profiles.md`; `String`, `&str`, `OsString` → `rust/collections/strings-and-utf-8.md`; panic strategies → `rust/errors/panic-result-and-error-propagation.md`.

## Problem
The compiler cannot see C code; it trusts the signature you declare. A wrong argument type, a Rust `&str` where C expects a NUL-terminated `char *`, a pointer into a `CString` that was already dropped, Rust memory freed by C's `free`, or a panic escaping into a C frame are all invisible to the type checker, and undefined behaviour (UB) on either side "affects the entire program" ✅[^18]. Miri, the interpreter that detects UB in Rust code, cannot help either: it stops at the first foreign call with ``unsupported operation: can't call foreign function `c_dot` on OS `linux` `` ✅[^1] ✅[^16].

## Mental model
**Analogy:** a border crossing between two countries with different laws. Only goods packed in an agreed container format cross (`repr(C)` types, C scalars, raw pointers); paperwork must be translated (`CString` out, `CStr` in); and the customs officer (the compiler) reads only the declaration form, the `extern` block, never the cargo itself.

**Artifact:** one struct described twice, once per language, and a call across ✅[^1]:
```c
/* c/labc.c */
struct Point { int32_t x; int32_t y; };
int64_t c_dot(const struct Point *a, const struct Point *b) {
    return (int64_t)a->x * b->x + (int64_t)a->y * b->y;
}
```
```rust
#[repr(C)]
struct Point { x: i32, y: i32 }          // same field order and types as the C struct

unsafe extern "C" {
    fn c_dot(a: *const Point, b: *const Point) -> i64;
}

let (p, q) = (Point { x: 3, y: -4 }, Point { x: 2, y: 5 });
// SAFETY: both pointers come from live references to repr(C) Points.
let d = unsafe { c_dot(&p, &q) };        // printed: c_dot = -14
```

## How it works
### 1. Who does what, from build to run
Four actors:
- **Cargo running `build.rs`** — its job: turn the C files into a static library, via the system `cc` and `ar`, and tell rustc to link it, via `cargo::rustc-link-*` lines printed to stdout.
- **rustc and the system linker** — its job: join the Rust objects, the static library and the C library into one binary, via `-l static=labc` and `-L <OUT_DIR>`.
- **Rust code** — its job: call C, via `unsafe extern "C"` declarations, and be called by C, via an exported `extern "C" fn` name or a function pointer.
- **C code** — its job: run the C functions and call back into Rust, via the symbol `rust_scale` and the function pointers it was given.

The build script, abridged (the lab calls the system compiler directly instead of using the `cc` crate; the Cargo Book's own example uses `cc::Build` ✅[^12]):
```rust
// build.rs
for name in ["labc", "walk"] {
    Command::new("cc").args(["-c", "-O2", "-fPIC", "-fexceptions"])
        .arg(format!("c/{name}.c")).arg("-o").arg(out.join(format!("{name}.o")))
        .status().unwrap();
}
Command::new("ar").arg("crs").arg(out.join("liblabc.a")).args(&objs).status().unwrap();
println!("cargo::rustc-link-search=native={}", out.display());
println!("cargo::rustc-link-lib=static=labc");
println!("cargo::rerun-if-changed=c/labc.c");
```
```
[Cargo: build.rs]                  [rustc + ld]                     [the running process]
cc -c labc.c walk.c → *.o
ar crs liblabc.a *.o
prints cargo::rustc-link-*  ─────▶ links Rust objects
                                   + liblabc.a + libc
                                   resolves c_dot, qsort  (Rust→C)
                                   resolves rust_scale    (C→Rust)
                                          │
                                          └──────────────▶ main → c_dot(&p, &q)
                                                           c_sum_scaled → rust_scale (by name)
                                                           qsort → desc              (by pointer)
```
1. **Cargo (build time, before the crate compiles):**
   - Runs `build.rs`, which writes only into `OUT_DIR` ✅[^12].
   - `build.rs` compiles each C file with `cc -c` and bundles the objects with `ar crs`.
   - `cargo::rustc-link-search` adds a `-L` directory and `cargo::rustc-link-lib` adds `-l static=labc` ✅[^12]; the `cargo::` spelling needs Cargo 1.77 or later ✅[^12].
2. **rustc and the linker (link time):**
   - The linker takes a member of a static archive whole. When `c_sum_scaled` (which calls `rust_scale`) and `c_for_each` sat in one object file, the two binaries that do not define `rust_scale` failed with ``undefined reference to `rust_scale'``; splitting the C into two objects fixed it ✅[^1].
3. **Rust → C (run time):**
   - A call goes through the declared signature; nothing checks it against the C definition ✅[^17].
4. **C → Rust (run time):**
   - By name: `#[unsafe(no_mangle)]` keeps the symbol `rust_scale` as written. `nm` (which lists a binary's symbols) showed `T rust_scale`, next to a normal function's mangled `_RNvCsc4iFtACLTXE_7interop4desc` ✅[^1]; that is the shape of `v0`, the one stable mangling scheme, as in the rustc book's example `_RNvCskwGfYPst2Cb_3foo16example_function` ✅[^15].
   - By pointer: `qsort` receives `desc` as an `unsafe extern "C" fn` value.

### 2. Declaring foreign items
- Since edition 2024 the block must be `unsafe extern`, because its author vouches for every signature ✅[^4] ✅[^17]. Its functions are unsafe to call and its statics unsafe to access unless marked `safe` ✅[^4]. `safe fn abs(x: c_int) -> c_int;` was then called without an `unsafe` block ✅[^1]; marking an item `safe` "does not inherently make it safe", the promise is still yours ✅[^2].
- ABI strings: `"C"` matches the platform C compiler's default and is used when `extern` has no string; `"system"` differs only on 32-bit Windows; `"C-unwind"` and `"system-unwind"` are the variants that allow unwinding ✅[^4] ✅[^6].
- Linking from source: `#[link(name = "z")]` (kinds `dylib` by default, `static`, `framework`, `raw-dylib`) and `#[link_name = "…"]` to import under another name ✅[^4].
- Variadic C functions such as `printf` are declared with `...`; Rust functions themselves cannot be variadic ✅[^3] ✅[^4].

### 3. Exporting Rust
`#[unsafe(no_mangle)] pub extern "C" fn rust_scale(x: i32) -> i32` uses the C calling convention and the plain symbol name ✅[^3] ✅[^5]. The attribute is unsafe because "an unmangled symbol may collide with another symbol with the same name (or with a well-known symbol), leading to undefined behavior" ✅[^5]; `export_name` picks any name and is unsafe for the same reason ✅[^5]. A library meant for C is built as `crate-type = ["cdylib"]` ✅[^3].

### 4. What may cross the boundary
- Scalars through the `std::ffi` aliases: `c_int` is C's `int`, `c_char` is C's `char`, and `*mut c_void` stands for `void *` ✅[^10].
- `repr(C)` structs, unions and enums (`rust/unsafe/memory-layout-and-repr.md`); tuples and wide pointers (`&[T]`, `&str`, `&dyn Trait`) are not FFI-safe ✅[^19]. Pass a slice as a pointer plus a length ✅[^3].
- `Box<T>` with `T: Sized` is one pointer, ABI-compatible with `T *`, and `Option<Box<T>>` is its nullable form ✅[^11].
- `Option<extern "C" fn(c_int) -> c_int>` is a nullable C function pointer, no `transmute` needed ✅[^3].
- An opaque C type is a `repr(C)` struct with a private zero-sized field and no constructor; an empty `enum` is "a really bad idea" for this ✅[^3].
- `&CStr` has no guaranteed layout and should not appear in FFI signatures; pass `*const c_char` ✅[^9].

### 5. Strings
- Rust strings store their length, may contain NUL bytes and are UTF-8; C strings end at the first NUL and may use another encoding ✅[^10].
- `CString::new` appends the NUL and fails on an interior one with a `NulError` that holds the position and the bytes ✅[^8].
- `as_ptr` returns a pointer with no lifetime: `CString::new(…).unwrap().as_ptr()` dangles as soon as the statement ends, so bind the `CString` to a variable first ✅[^8].
- `into_raw` hands ownership to C; the pointer must come back through `CString::from_raw` exactly once, never through C's `free`, and C must not change the string's length ✅[^8].
- `CStr::from_ptr` requires a NUL terminator inside one allocation, unchanged memory for the borrow, and a lifetime you tie to something real, because none is checked; `to_str` checks UTF-8, `to_string_lossy` replaces bad bytes ✅[^9]. A `c"…"` literal is a `&CStr` ✅[^9].

### 6. Callbacks
A callback passed to C must use the C calling convention; state travels as a `void *` context argument that C hands back to the callback ✅[^3]. The `qsort` comparator in the Worked example has the type `unsafe extern "C" fn(*const c_void, *const c_void) -> c_int` and casts its arguments back to `*const u32` ✅[^1].

### 7. Panics and unwinding across the boundary
At an ABI boundary, with the default `panic=unwind` ✅[^6]:

| Boundary ABI | A Rust panic arriving there | A foreign (for example C++) unwind |
|---|---|---|
| unwinding (`"Rust"`, `"C-unwind"`) | unwinds through | unwinds through |
| non-unwinding (`"C"`, `"system"`) | the process aborts; it is unspecified whether destructors up to the boundary ran | UB |

With `panic=abort` every panic aborts without unwinding ✅[^6]. Lab: C's `c_for_each(xs, n, visit, ctx)` calls `visit` for 1, 2, 3, and `visit` panics on 2; `main` wraps the call in `catch_unwind` ✅[^1]:
- **`"C"`** on the callback and the import: stdout `visit 1`, `visit 2`; stderr `panic in a function that cannot unwind` … `thread caused non-unwinding panic. aborting.`; exit status 134 and the shell's `Aborted`, in debug and release builds. `catch_unwind` never saw it.
- **`"C-unwind"`** on both: stdout `visit 1`, `visit 2`, `caught panic: true`; exit status 0. The panic unwound through the C frame.

The C file was compiled with `-fexceptions`. Unwinding out of a Rust `"C-unwind"` function into C compiled without unwinding support (`-fno-exceptions`) is UB, and so is a foreign exception entering Rust through a `"C"` import ✅[^7]. A foreign exception caught by `catch_unwind` either aborts or returns `Err`, unspecified which ✅[^7].

### 8. Generating bindings
- **bindgen** generates Rust FFI declarations and types from C (and C++) headers, either from `build.rs` or from the command line ✅[^13].
- **cbindgen** goes the other way: it "creates C/C++11 headers for Rust libraries which expose a public C API", also from the command line or `build.rs` ✅[^14].
Neither ran in the lab.

## Worked example
`src/bin/interop.rs` against the lab's C library and glibc (the GNU C library), one run ✅[^1]:

| Call | Rust side | Output |
|---|---|---|
| Struct by pointer | `c_dot(&p, &q)` with (3, −4)·(2, 5) | `c_dot = -14` |
| Rust string to C | `CString::new("Ownership and borrowing")`, then `c_count_vowels(text.as_ptr())` and libc `strlen` | `vowels = 7, strlen = 23, bytes_with_nul = 24` |
| C string to Rust | `CStr::from_ptr(c_version())`, `.to_str()` | `c_version = "labc 1.0" -> Ok("labc 1.0")` |
| Interior NUL | `CString::new("ab\0cd")` | `Err(NulError(2, [97, 98, 0, 99, 100]))` |
| C string literal | `c"literal"`, `.count_bytes()` | `"literal", len = 7` |
| Ownership hand-off | `into_raw` then `CString::from_raw` | `round trip = "handoff"` |
| C calls Rust by name | `c_sum_scaled([1, 2, 3, 4])`, which calls `rust_scale(x) = x * 10` | `c_sum_scaled = 100` |
| C calls Rust by pointer | libc `qsort` on `[42, 7, 99, 15, 63]` with comparator `desc` | `qsort desc = [99, 63, 42, 15, 7]` |
| `safe fn` import | `abs(-17)` with no `unsafe` block | `abs(-17) = 17` |

`strlen` and `bytes_with_nul` differ by one: the terminating NUL that `CString` added. `NulError(2, …)` names the byte index of the NUL ✅[^1] ✅[^8].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Archive member refers to a symbol the binary lacks | Link error ``undefined reference to `rust_scale'`` | The linker pulls the whole object file ✅[^1] |
| `extern "C" {}` or `#[no_mangle]` in edition 2024 | Compile error | See `rust/unsafe/unsafe-rust-and-undefined-behavior.md` §8 ✅[^1] |
| `safe fn` on a function that needs valid pointers | Compiles; bad input is UB | The compiler trusts the qualifier ✅[^2] |
| `CString::new(s).unwrap().as_ptr()` passed later | Dangling pointer | The temporary `CString` is dropped at the end of the statement ✅[^8] |
| C calls `free` on a pointer from `into_raw` | Not allowed; the matching call is `CString::from_raw` | The docs require `from_raw` to deallocate it; skipping it leaks ✅[^8] |
| `&str`, `&[T]` or a tuple in an `extern "C"` signature | Not FFI-safe | Wide pointers and tuples are "not a concept in C" ✅[^19] |
| Panic in an `extern "C"` callback | Abort, exit 134 | Non-unwinding ABI ✅[^1] ✅[^6] |
| C++ exception through a `"C"` import | UB | Use `"C-unwind"` ✅[^7] |
| Running the FFI program under Miri | `unsupported operation` at the first call into the lab's own C code; `-Zmiri-native-lib` is an experimental way to load native code. Common libc functions such as `strlen` have built-in shims, and `strlen(c"hello".as_ptr())` ran and printed 5 | Miri interprets Rust only, plus a fixed set of emulated system calls ✅[^1] ✅[^16] |

## Takeaways
- Wrap every foreign function in a safe Rust function that checks its inputs and converts types, and keep the `extern` block private. [rule-candidate]
- Mark an `extern` item `safe` only when every possible argument value is fine for the C function. [rule-candidate]
- Use `"C-unwind"` on any import or callback a panic or C++ exception may cross, and compile the C/C++ side with unwinding enabled; otherwise catch the panic inside the callback. [rule-candidate]
- Bind each `CString` to a variable before taking `as_ptr`. [rule-candidate]
- Free memory with the allocator that made it: Rust memory returns through `from_raw`, C memory through the C library's own free function.
- Generate declarations with bindgen and headers with cbindgen for any API larger than a few functions.

## Verification status
- Verified: 63 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `linux/lab-setup.md` — the Rust 1.100.0 lab (`rustlab:1`, gcc 14.2.0, glibc, aarch64) where every behaviour marked with this note ran on 2026-11-24. [^1]
- [Unsafe Rust](https://doc.rust-lang.org/book/ch20-01-unsafe-rust.html) — The Rust Programming Language, Steve Klabnik, Carol Nichols, Chris Krycho and the Rust community, living. Backs: `unsafe extern`, the `safe` qualifier is a promise, `#[unsafe(no_mangle)]`. [^2]
- [FFI](https://doc.rust-lang.org/nomicon/ffi.html) — The Rustonomicon, Rust project, living. Backs: safe wrappers, pointer plus length, callbacks and context pointers, `cdylib`, nullable function pointers, opaque structs, variadics, aborting on a non-unwind boundary. [^3]
- [External blocks](https://doc.rust-lang.org/reference/items/external-blocks.html) — The Rust Reference, Rust project, living. Backs: `unsafe extern`, `safe`/`unsafe` qualifiers and defaults, ABI strings, `#[link]` kinds, `#[link_name]`, variadics. [^4]
- [Application binary interface](https://doc.rust-lang.org/reference/abi.html) — The Rust Reference, Rust project, living. Backs: `no_mangle` and `export_name` and why they are unsafe. [^5]
- [Functions](https://doc.rust-lang.org/reference/items/functions.html) — The Rust Reference, Rust project, living. Backs: `extern` defaults to `"C"`, unwinding and non-unwinding ABIs, the boundary table. [^6]
- [Panic](https://doc.rust-lang.org/reference/panic.html) — The Rust Reference, Rust project, living. Backs: unwinding across FFI, the two UB cases, foreign exceptions and `catch_unwind`. [^7]
- [CString in std::ffi](https://doc.rust-lang.org/std/ffi/struct.CString.html) — Rust standard library, living. Backs: `new` and `NulError`, `as_ptr` lifetime warning, `into_raw`/`from_raw` contract. [^8]
- [CStr in std::ffi](https://doc.rust-lang.org/std/ffi/struct.CStr.html) — Rust standard library, living. Backs: `from_ptr` safety, `to_str` and `to_string_lossy`, `c"…"` literals, no FFI layout. [^9]
- [std::ffi](https://doc.rust-lang.org/std/ffi/index.html) — Rust standard library, living. Backs: Rust versus C strings, `c_int`, `c_char`, `c_void`. [^10]
- [std::boxed](https://doc.rust-lang.org/std/boxed/index.html) — Rust standard library, living. Backs: `Box<T>` as a C `T *`, `Option<Box<T>>` for nullable. [^11]
- [Build Scripts](https://doc.rust-lang.org/cargo/reference/build-scripts.html) — The Cargo Book, Rust project, living. Backs: `OUT_DIR`, `rustc-link-lib`, `rustc-link-search`, `rerun-if-changed`, the `cc` example, `cargo::` needs 1.77. [^12]
- [Introduction](https://rust-lang.github.io/rust-bindgen/) — The bindgen User Guide, Rust project, living. Backs: what bindgen generates and its two usage modes. [^13]
- [mozilla/cbindgen: A project for generating C bindings from Rust code](https://github.com/mozilla/cbindgen) — cbindgen project (README), living. Backs: what cbindgen generates and its two usage modes. [^14]
- [Symbol Mangling](https://doc.rust-lang.org/rustc/symbol-mangling/index.html) — The rustc book, Rust project, living. Backs: `v0` is the stable scheme; `_R` prefix. [^15]
- [rust-lang/miri: An interpreter for Rust's mid-level intermediate representation](https://github.com/rust-lang/miri) — Miri project (README), living. Backs: no FFI in Miri; experimental `-Zmiri-native-lib`. [^16]
- [Unsafe extern blocks](https://doc.rust-lang.org/edition-guide/rust-2024/unsafe-extern.html) — The Rust Edition Guide, Rust project, living. Backs: the author of an `unsafe extern` block vouches for its signatures. [^17]
- [Behavior considered undefined](https://doc.rust-lang.org/reference/behavior-considered-undefined.html) — The Rust Reference, Rust project, living. Backs: UB reached through FFI affects the whole program. [^18]
- [Other reprs](https://doc.rust-lang.org/nomicon/other-reprs.html) — The Rustonomicon, Rust project, living. Backs: wide pointers and tuples are not FFI-safe. [^19]

## Related
- `rust/unsafe/unsafe-rust-and-undefined-behavior.md` — the unsafe operations, UB, edition-2024 changes.
- `rust/unsafe/memory-layout-and-repr.md` — `repr(C)`, `repr(transparent)`, niches.
- `rust/project-structure/cargo-workspaces-features-and-profiles.md` — `build.rs` and the `panic` profile setting.
- `rust/collections/strings-and-utf-8.md` — `String`, `&str`, `OsString`, `CString` overview.
- `rust/errors/panic-result-and-error-propagation.md` — unwind versus abort.
