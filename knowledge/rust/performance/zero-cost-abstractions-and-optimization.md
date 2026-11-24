---
schema: knowledge-doc/v1
type: concept
topic: rust/performance
status: verified
applies-to: ["Rust 1.100.0", "edition 2024", "LLVM 23", "criterion 0.5", "llvm-tools component (llvm-profdata, LLVM 23.1.5)"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [rust, performance, zero-cost-abstractions, monomorphization, inlining, bounds-checks, vectorization, allocation, cow, with-capacity, criterion, black-box, benchmarking, profiling, pgo]
---

# Zero-cost abstractions and optimizing Rust code

## Summary
**TL;DR:** "Zero-cost" means an abstraction compiles to code you could not write faster by hand; it does not mean free compile time or free binary size. The optimizer earns it: generics are copied per type (monomorphization), small functions are inlined, and once the code is in one piece LLVM can prove indexes in bounds, drop the checks and vectorize. So measure in release mode and read the assembly before rewriting anything. In the lab, an index loop and an iterator chain compiled to the same 52 instructions; LLVM moved a bounds check out of a loop over a caller-supplied `n`; only a data-dependent index `values[idx[i]]` kept a check per element; a generic function used with 8 types became 8 copies; 1,000 `push` calls cost 9 allocations, 1 with `with_capacity`; a timing loop whose result was not passed to `black_box` measured 0.0 µs; and profile-guided optimization (PGO) made a log parser 18–20% faster but an interpreter loop in the same program 2–5% slower in two batches (within the machine's noise).
**Use this when:** someone proposes rewriting iterators as loops, or `get_unchecked`, "for speed"; you write a micro-benchmark; a profile shows allocation or bounds-check cost; generic code makes the binary large; you consider PGO.
**Not this doc:** the general method (state the question, warm up, repeat, control noise) → `performance/measurement/benchmarking-methodology.md`; reading profiles and flame graphs → `performance/measurement/profiling-and-flame-graphs.md`; techniques by bottleneck → `performance/optimization/optimization-playbook.md`; `opt-level`, `lto` and `codegen-units` → `rust/project-structure/cargo-workspaces-features-and-profiles.md`; build time → `rust/performance/compiler-pipeline-and-compile-times.md`; what monomorphization is → `rust/traits-and-generics/generics-and-traits.md`; iterator and loop machine code compared instruction by instruction → `rust/closures-and-iterators/iterators.md`; `Vec` growth → `rust/collections/vec-hashmap-and-std-collections.md`; `get_unchecked` and its safety contract → `rust/unsafe/unsafe-rust-and-undefined-behavior.md`.

## Problem
Code reviews rewrite readable iterator chains into index loops, or reach for `unsafe` unchecked indexing, on the belief that Rust's safety checks are slow. Micro-benchmarks report nanoseconds for work the compiler deleted. A generic helper instantiated for dozens of types bloats the binary and the build. A loop allocates a fresh `String` per line. Each belief is testable in a few minutes with `--emit asm`, an allocation counter or criterion, and the results often contradict the intuition.

## Mental model
**Analogy:** the optimizer is an editor who can cut redundant sentences only from a paragraph printed on one page. Inlining puts caller and callee on the same page; then "check that index 7 is below the length" next to "the loop stops at the length" is visibly redundant and gets cut. If the index comes from somewhere the editor cannot read (another array, user input), the sentence must stay.

**Artifact:** seven kernels compiled with `rustc +nightly -C opt-level=3 -C codegen-units=1 -Zcross-crate-inline-threshold=never --emit=asm` on aarch64, counting instructions and calls to a panic path per function ✅[^1]:

| Function | Loop shape | Instructions | Panic calls | Where a check remains |
|---|---|---|---|---|
| `chain` | `values.iter().filter(\|&&v\| v % 2 == 0).map(\|&v\| v * v).sum()` | 52 | 0 | none |
| `index_loop` | `for i in 0..values.len() { … values[i] … }` | 52 | 0 | none: proven in bounds |
| `index_loop_n` | `for i in 0..n { … values[i] … }` | 63 | 1 | one compare before the loop |
| `index_loop_n_hoisted` | `let values = &values[..n];` then `0..values.len()` | 65 | 1 | one slice check before the loop |
| `scale_index` | `for i in 0..src.len() { dst[i] = src[i] * 3 }` | 44 | 1 | only in a remainder loop after a check-free unrolled part |
| `scale_zip` | `for (d, s) in dst.iter_mut().zip(src) { *d = s * 3 }` | 33 | 0 | none |
| `gather` | `idx.iter().map(\|&i\| values[i]).sum()` | 18 | 1 | every element |

These counts are one measurement: seven small kernels, one compiler (rustc nightly 1.102.0, LLVM 23) and one target (aarch64). Another LLVM version, target or loop body can keep or remove a check differently, so treat the table as a method to repeat on your own code with `--emit=asm`, not as a rule that these shapes always compile this way.

The `gather` loop body, where the check cannot go away because each index is data:
```asm
.LBB6_1:
	ldr	x9, [x2], #8        // i = idx[k]
	cmp	x9, x1              // i < values.len() ?
	b.hs	.LBB6_4             // no: jump to panic_bounds_check
	ldr	x9, [x0, x9, lsl #3]
	subs	x3, x3, #1
	add	x8, x9, x8
	b.ne	.LBB6_1
```

## How it works
**3 actors:**
- **rustc** — its job: turn generic code into concrete copies and mark what may be inlined, via monomorphization and inlining attributes.
- **LLVM** — its job: inline, prove facts about indexes, delete what is redundant and vectorize, via its optimization passes at `opt-level` 2 or 3.
- **criterion** — its job: time the result repeatedly and report a confidence interval, via `cargo bench` and `Bencher::iter`.

```text
source: generic fn + iterator adapters + v[i]
  │ rustc: one copy per concrete type (monomorphization); small fns marked inlinable
  ▼
LLVM IR: calls to next(), add_assign(), bounds checks
  │ LLVM: inline → loop bound known → "i < len" proven → check deleted → vectorize
  ▼
machine code ──► criterion: warm up, sample, interval [low  estimate  high]
```

1. **What "zero-cost" promises.** The Book calls iterators a zero-cost abstraction, meaning the abstraction adds no runtime overhead, and traces the idea to Stroustrup's zero-overhead principle: what you do use, you could not hand-code any better ✅[^2]. The lab shows it for this kernel: `chain` and `index_loop` are the same 52 instructions, without a bounds check ✅[^1]. The promise is about run time only; the next two items are where the cost goes instead.
2. **Monomorphization costs size and build time.** rustc makes one copy of a generic function per set of concrete types ✅[^3]. In the lab, a `#[inline(never)] fn label_generic<T: Display>(value: T) -> String` called with `u8`, `u16`, `u32`, `u64`, `i32`, `f64`, `char` and `&str` produced eight 68-byte functions (`label_generic::<u8>` …), while the `&dyn Display` version produced one ✅[^1]. The rustc dev guide names the cost: copies take compile time and grow the binary ✅[^3]. A common fix is a thin generic shell around a non-generic inner function, as `std::fs::read` does ✅[^4]; trading to `dyn` is covered in `rust/traits-and-generics/trait-objects-and-dynamic-dispatch.md`.
3. **Inlining makes the other optimizations possible.** Without an attribute the compiler decides by size, generics and crate boundaries; `#[inline]` suggests, `#[inline(always)]` strongly suggests, `#[inline(never)]` strongly discourages, and none is a guarantee ✅[^5]. Attributes are not transitive, and the best candidates are tiny functions or functions with one call site ✅[^5]. Since Rust 1.75, rustc also makes small functions inlinable across crates automatically ✅[^6]. Seen in the lab: the release-mode assembly of the library crate contained only `chain` and `index_loop_n_hoisted`; the small `pub fn index_loop` and `index_loop_n` appeared only with `-Zcross-crate-inline-threshold=never`, because rustc leaves them to be compiled inside each calling crate ✅[^1], as it does for any non-generic `#[inline]` function ✅[^3].
4. **Bounds-check elimination.** Indexing a slice or `Vec` is checked by default ✅[^7]. After inlining, LLVM removes a check it can prove redundant (`index_loop`), moves it before the loop (`index_loop_n`: one compare of `n - 1` with the length), or, for a loop that writes memory before a possible panic, splits it into a check-free part and a checked remainder (`scale_index`) ✅[^1]. The Performance Book's tools to help it: iterate instead of indexing, re-slice before the loop, assert the index range, and `get_unchecked` only as a last resort ✅[^7]. To check, emit assembly for one crate: `cargo rustc --release --lib -- --emit=asm` (the file lands under `target/release/`) ✅[^1].
5. **Allocation reduction.** Each heap allocation may take a lock and do bookkeeping, and `malloc`/`free` showing up hot in a profile is the signal ✅[^8]. Measured with a counting `#[global_allocator]` that wraps `System` (allocators themselves are covered in `rust/ecosystem/no-std-embedded-and-webassembly.md`) ✅[^1]:

   | Pattern | Heap allocations |
   |---|---|
   | `Vec::new()` then 1,000 × `push(u32)` | 9 (one allocation, eight regrowths) |
   | `Vec::with_capacity(1000)` then 1,000 × `push` | 1 |
   | `line.to_uppercase()` for 1,000 lines | 1,000 |
   | one `String` buffer, `clear()` + `push_str` + `make_ascii_uppercase()` per line | 1 |
   | `Cow<str>` escape of 1,000 lines with nothing to escape | 0 |
   | the same escape of one input containing `<` | 2 |

   The Performance Book lists the same levers: reserve capacity, reuse a cleared "workhorse" collection, read lines into one buffer with `read_line`, and return `Cow` to allocate only when needed ✅[^8]. `Cow` itself is explained in `rust/collections/strings-and-utf-8.md`.
6. **Benchmarking with criterion and `black_box`.**
   - Setup: `criterion` as a dev-dependency, a `[[bench]]` target with `harness = false`, a `benches/*.rs` file with `criterion_group!` and `criterion_main!`, and `b.iter(|| …)` around the code ✅[^9] ✅[^10].
   - Reading the output: `time: [low estimate high]` is a confidence interval with Criterion's best estimate in the middle; `change:` compares with the previous saved run, and Criterion treats changes within ±2% as noise by default ✅[^11].
   - `std::hint::black_box(x)` returns `x` but tells the compiler to assume anything could happen to it; the docs say to wrap both the inputs and the result, and that it works only on a best-effort basis ✅[^12]. Lab, a 64 KiB checksum run 20,000 times: with no `black_box`, or with `black_box` on the input only, the loop took 0.0 µs per run, because the unused result let LLVM delete the work; with `black_box(checksum(black_box(&data)))` it took 49.8–53.9 µs ✅[^1].
   - Criterion's `iter` also times dropping the closure's return value ✅[^13]; use `iter_batched` when the routine consumes a freshly built input ✅[^13].
7. **Profiling pointers.** Find the hot code before optimizing it; the method is in `performance/measurement/profiling-and-flame-graphs.md`. For Rust, the Performance Book adds `debug = "line-tables-only"` in `[profile.release]` for source lines, `-C force-frame-pointers=yes` for better stacks, and profilers such as perf, samply, Cachegrind and DHAT (for allocations) ✅[^14].
8. **PGO (profile-guided optimization).** Without a profile, the compiler guesses which branches and calls are hot; PGO feeds it counts from real runs, which then steer inlining, machine-code layout and register allocation, at `opt-level` 2 or above ✅[^15]. The instrumented workflow has four steps ✅[^15], run in the lab like this (each variant got its own `CARGO_TARGET_DIR`, left out below) ✅[^1]:
   ```console
   $ rm -rf /lab/pgo-data                                   # step 0: no left-over profiles
   $ RUSTFLAGS="-Cprofile-generate=/lab/pgo-data" cargo build --release --target=aarch64-unknown-linux-gnu
   $ ./target/aarch64-unknown-linux-gnu/release/pgodemo 100000 100000 7 5      # typical inputs, twice
   $ $(rustc --print sysroot)/lib/rustlib/aarch64-unknown-linux-gnu/bin/llvm-profdata merge -o /lab/merged.profdata /lab/pgo-data
   $ RUSTFLAGS="-Cprofile-use=/lab/merged.profdata" cargo build --release --target=aarch64-unknown-linux-gnu
   ```
   - `--target` keeps `RUSTFLAGS` out of build scripts, and the paths are absolute because Cargo runs rustc from changing working directories ✅[^15].
   - `llvm-profdata` ships in a rustup component (`llvm-tools`; the rustc book names it `llvm-tools-preview`) and is not put on `PATH` ✅[^15]; in the lab it was under `$(rustc --print sysroot)/lib/rustlib/aarch64-unknown-linux-gnu/bin/` and reported LLVM 23.1.5 ✅[^1].
   - Two training runs left one file, `default_5050834608577337338_0.profraw` (12,864 bytes), updated in place; the merged profile was 17,856 bytes ✅[^1], as the rustc book describes ✅[^15].

   The lab program `pgodemo` has two hot functions: a log-line parser (`split`, `split_once`, `parse` and one `HashMap` update per line) and a register-machine interpreter (a `match` over 11 opcodes in a loop, computing Collatz step counts). Training used 100,000 and 50,000 lines with two seeds; measurement used 1,000,000 lines with a third seed. Medians of 15 interleaved runs per batch, two batches in opposite order, aarch64, 8 CPUs, Docker, load average about 4 from other containers ✅[^1]:

   | Binary | Size (bytes) | Parser median, batch 1 / 2 (ms) | Interpreter median, batch 1 / 2 (ms) |
   |---|---|---|---|
   | baseline `--release` | 552,464 | 128.1 / 132.2 | 1,103.6 / 1,144.9 |
   | PGO, representative training | 553,784 | 104.7 / 106.2 (−18% / −20%) | 1,163.5 / 1,203.8 (+5% / +5%) |
   | PGO, unrepresentative training (80% error lines, interpreter limit 2,000) | 553,624 | 105.6 / 108.5 (−18% / −18%) | 1,159.4 / 1,168.9 (+5% / +2%) |
   | instrumented (`-Cprofile-generate`), one run | 1,665,712 | 171.5 | 1,234.2 |

   Both batches agree: the parser gained about a fifth, the interpreter lost 2–5%, and the unrepresentative profile gave the parser nearly the same gain ✅[^1]. The interpreter's loss is small next to the noise of a shared machine: a later 5-round re-run on the same lab measured it 3% faster with PGO, so read it as "no gain", not as a reliable slowdown ✅[^1]. The Performance Book's "10% or more" describes what suitable programs can gain ✅[^16], not what every function gets: measure each hot path with and without the profile.

## Worked example
Benchmark of the artifact's kernels with criterion 0.5.1 over 10,000 `u64` values; command `cargo bench --bench sum_even_squares --bench scale -- --warm-up-time 2 --measurement-time 5` ✅[^1]:
```rust
// benches/scale.rs (sum_even_squares.rs has the same shape)
use criterion::{criterion_group, criterion_main, Criterion};
use std::hint::black_box;

fn bench(c: &mut Criterion) {
    let src: Vec<u64> = (0..10_000).collect();
    let mut dst = vec![0u64; 10_000];
    let mut group = c.benchmark_group("scale_10k");
    group.bench_function("index", |b| b.iter(|| kernels::scale_index(black_box(&src), black_box(&mut dst))));
    group.bench_function("hoisted", |b| b.iter(|| kernels::scale_hoisted(black_box(&src), black_box(&mut dst))));
    group.bench_function("zip", |b| b.iter(|| kernels::scale_zip(black_box(&src), black_box(&mut dst))));
    group.finish();
}
criterion_group!(benches, bench);
criterion_main!(benches);
```
Point estimates of two runs with unchanged code (aarch64, 8 CPUs, Docker, load average 12–18 from other containers) ✅[^1]:

| Kernel | Run A (µs) | Run B (µs) | Run B `change:` line |
|---|---|---|---|
| `iterator_chain` | 3.54 | 3.11 | −12.5%, "Performance has improved" |
| `index_loop_len` | 3.98 | 4.54 | +8.3%, "Performance has regressed" |
| `index_loop_n` | 4.79 | 4.49 | p = 0.82, "No change in performance detected" |
| `index_loop_n_hoisted` | 3.18 | 3.37 | +11.7%, "Performance has regressed" |
| `scale_10k/index` | 2.32 | 2.61 | +28.3%, "Performance has regressed" |
| `scale_10k/hoisted` | 2.16 | 2.30 | p = 0.44, "No change in performance detected" |
| `scale_10k/zip` | 1.91 | 2.12 | +8.2%, "Performance has regressed" |

What survives both runs: `zip` beat the indexed write loop by about 18%, and the iterator chain beat both plain index loops (`index_loop_len`, `index_loop_n`); the chain and the hoisted loop swapped places between runs ✅[^1]. What does not: every "improved" or "regressed" verdict, since no code changed between runs; an earlier run at load average 43 had made three of run A's four `sum_even_squares` results look 29–47% "improved" ✅[^1]. The Performance Book notes that wall time is noisy and lower-variance counts (cycles, instructions) can suit better, and that imperfect benchmarking still beats none ✅[^17].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Result of the measured call unused | 0.0 µs per run ✅[^1] | The optimizer deletes work whose result is dead; wrap the result in `black_box` ✅[^12] |
| `black_box` on the input only | Still 0.0 µs ✅[^1] | Hiding the input does not keep the output alive ✅[^12] |
| `black_box` for constant-time cryptography | No guarantee ✅[^12] | Best-effort hint only |
| `cargo bench -- --warm-up-time 2` without `--bench NAME` | ``error: Unrecognized option: 'warm-up-time'`` from the library's libtest harness ✅[^1] | `cargo bench` runs every bench target, including the default `src/lib.rs` one |
| Small `pub fn` missing from the library's `.s` file | It is compiled in the calling crate instead ✅[^1] | Automatic cross-crate inlining since 1.75 ✅[^6] |
| Symbols start with `_R…` | `nm -C` demangled them (`mono::label_generic::<u8>`) ✅[^1] | v0 mangling is the default since Rust 1.97 ✅[^6]; the Performance Book still describes it as opt-in ✅[^14] |
| Index read from another array | A check per element ✅[^1] | Nothing proves the value is below the length |
| Timing a `dev` build | About 55× slower compute loop in the lab (table in the profiles doc) ✅[^1] | `opt-level = 0`; measure `release` or `bench` |
| `#[inline]` on `f` that calls `g` | `g` is not inlined because of it ✅[^5] | Attributes are not transitive |
| Two runs of unchanged code | Criterion reported "regressed" by 28% ✅[^1] | Shared machine; repeat and compare across runs |
| Rebuilding with a profile after editing the code | Builds, with ``warning: … function control flow change detected (hash mismatch) _RNv…4main … count discarded`` ✅[^1] | That function's counts no longer fit its code, so they are dropped; re-run steps 0–3 after every change to the hot code |
| `-Cprofile-use` naming a file that does not exist | ``error: file `/lab/missing.profdata` passed to `-C profile-use` does not exist``; under Cargo it already fails in Cargo's first rustc probe ✅[^1] | Use absolute paths ✅[^15] |
| A profile recorded from a different program | rustc printed no warning ✅[^1] | No message tells you the profile does not belong to the program; keep each profile next to the build that produced it |
| `LLVM_PROFILE_FILE=/lab/pgo-wrong/w-%p.profraw` set for a training run | The profile was written to `w-230.profraw` ✅[^1] | The variable sets the output path and `%p` becomes the process ID ✅[^18] |
| `rustup component add llvm-tools-preview` after installing `llvm-tools` | `info: component llvm-tools is up to date` ✅[^1] | rustup accepts both names; the rustc book still uses `llvm-tools-preview` ✅[^15] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Iterator adapters (`zip`, `filter`, `sum`) | No index, so no check to remove; equal or faster here ✅[^1] | Long chains can be harder to debug |
| Index loop over `0..len` | Fine when one step reads `v[i]` and `v[i + 1]` | Relies on the optimizer to remove checks ✅[^7] |
| `get_unchecked` | No check at all ✅[^7] | `unsafe`, a last resort: the caller must guarantee the index (`rust/unsafe/unsafe-rust-and-undefined-behavior.md`) ✅[^7] |
| Generic function | Static dispatch, inlinable ✅[^3] | One copy per type: 8 copies in the lab ✅[^1] |
| `dyn Trait` | One copy ✅[^1] | A call through a vtable (`rust/traits-and-generics/trait-objects-and-dynamic-dispatch.md`) |
| `with_capacity` / buffer reuse | 1 allocation instead of 9 or 1,000 ✅[^1] | Must know or bound the size; buffers keep their capacity |
| PGO | 18–20% on the lab's parser ✅[^1]; 10% or more on suitable programs ✅[^16] | Two builds, representative workloads, `llvm-profdata` ✅[^15]; the lab's interpreter got no gain (2–5% slower in two batches, within noise) ✅[^1] |

## Takeaways
- Do not rewrite iterator chains as index loops, or add `get_unchecked`, without assembly or a benchmark showing a check in the hot loop. [rule-candidate]
- In every manual benchmark loop, pass both the inputs and the result through `std::hint::black_box`. [rule-candidate]
- Re-slice (`let v = &v[..n];`) or iterate with `zip` when the compiler cannot prove an index range.
- Pre-size collections with `with_capacity` when the size is known, and reuse buffers inside loops. [rule-candidate]
- Trust only differences that hold across repeated benchmark runs on a quiet machine.
- Put the non-generic bulk of a generic function into an inner non-generic function.
- Keep PGO only for hot paths that measure faster with it on representative input, and regenerate the profile whenever the hot code changes. [rule-candidate]

## Verification status
- Verified: 79 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `linux/lab-setup.md` — the Rust 1.100.0 lab (`rustlab:1`) where every behaviour marked with this note ran on 2026-11-24. [^1]
- [Performance in Loops vs. Iterators](https://doc.rust-lang.org/book/ch13-04-performance.html) — The Rust Programming Language, living. Backs: zero-cost abstraction, the zero-overhead principle. [^2]
- [Monomorphization](https://rustc-dev-guide.rust-lang.org/backend/monomorph.html) — Rust Compiler Development Guide, living. Backs: one copy per concrete type, compile-time and size cost, non-generic `#[inline]` functions compiled in the calling crate. [^3]
- [Compile Times](https://nnethercote.github.io/perf-book/compile-times.html) — Nicholas Nethercote and others, The Rust Performance Book, living. Backs: inner non-generic function, as in `std::fs::read`. [^4]
- [Inlining](https://nnethercote.github.io/perf-book/inlining.html) — Nicholas Nethercote and others, The Rust Performance Book, living. Backs: the four inline attributes, non-transitivity, best candidates. [^5]
- [RELEASES.md](https://raw.githubusercontent.com/rust-lang/rust/master/RELEASES.md) — Rust project, living. Backs: 1.75.0 "Automatically enable cross-crate inlining for small functions"; 1.97.0 v0 symbol mangling by default. [^6]
- [Bounds Checks](https://nnethercote.github.io/perf-book/bounds-checks.html) — Nicholas Nethercote and others, The Rust Performance Book, living. Backs: checks by default, the techniques to avoid them. [^7]
- [Heap Allocations](https://nnethercote.github.io/perf-book/heap-allocations.html) — Nicholas Nethercote and others, The Rust Performance Book, living. Backs: allocation cost, capacity, reuse, `read_line`, `Cow`. [^8]
- [Getting Started](https://bheisler.github.io/criterion.rs/book/getting_started.html) — Criterion.rs Documentation, living. Backs: dev-dependency, `[[bench]]` with `harness = false`, `criterion_group!`/`criterion_main!`, `iter`. [^9]
- [Cargo Targets](https://doc.rust-lang.org/cargo/reference/cargo-targets.html) — The Cargo Book, living. Backs: the `harness` field. [^10]
- [Command-Line Output](https://bheisler.github.io/criterion.rs/book/user_guide/command_line_output.html) — Criterion.rs Documentation, living. Backs: confidence interval, `change:`, noise threshold. [^11]
- [Function black_box](https://doc.rust-lang.org/std/hint/fn.black_box.html) — Rust standard library, living. Backs: semantics, wrap inputs and outputs, best effort, no cryptographic guarantee. [^12]
- [Struct Bencher](https://docs.rs/criterion/0.5.1/criterion/struct.Bencher.html) — criterion maintainers, 2023 (version 0.5.1). Backs: `iter` times the drop of the output, `iter_batched`. [^13]
- [Profiling](https://nnethercote.github.io/perf-book/profiling.html) — Nicholas Nethercote and others, The Rust Performance Book, living. Backs: profilers, `line-tables-only`, frame pointers, demangling. [^14]
- [Profile-guided Optimization](https://doc.rust-lang.org/rustc/profile-guided-optimization.html) — The rustc book, living. Backs: what PGO feeds, the four steps, `opt-level` 2 or above, `.profraw` files updated in place, `llvm-tools-preview`, `--target` and absolute paths under Cargo. [^15]
- [Build Configuration](https://nnethercote.github.io/perf-book/build-configuration.html) — Nicholas Nethercote and others, The Rust Performance Book, living. Backs: PGO gains of 10% or more. [^16]
- [Benchmarking](https://nnethercote.github.io/perf-book/benchmarking.html) — Nicholas Nethercote and others, The Rust Performance Book, living. Backs: wall-time noise, lower-variance metrics, imperfect benchmarking. [^17]
- [Source-based Code Coverage](https://clang.llvm.org/docs/SourceBasedCodeCoverage.html) — LLVM project (Clang documentation), living. Backs: `LLVM_PROFILE_FILE` and the `%p` pattern for raw profile paths. [^18]

## Related
- `performance/measurement/benchmarking-methodology.md` — the language-neutral benchmarking method.
- `performance/measurement/profiling-and-flame-graphs.md` — finding the hot code first.
- `performance/optimization/optimization-playbook.md` — techniques by measured bottleneck.
- `rust/closures-and-iterators/iterators.md` — iterator laziness and the loop/iterator code comparison.
- `rust/project-structure/cargo-workspaces-features-and-profiles.md` — profile settings and their measured effect.
- `rust/performance/compiler-pipeline-and-compile-times.md` — where monomorphization and LLVM sit in the build.
