---
schema: knowledge-doc/v1
type: concept
topic: rust/performance
status: verified
applies-to: ["Rust 1.100.0", "rustc 1.102.0-nightly (for -Z flags)", "edition 2024", "tokio 1.54"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [rust, rustc, compiler-pipeline, ast, hir, thir, mir, borrow-check, monomorphization, llvm, codegen-units, linking, query-system, incremental-compilation, cargo-check, time-passes, self-profile, cargo-timings]
---

# The rustc pipeline and compile times

## Summary
**TL;DR:** rustc lexes and parses source into an AST (abstract syntax tree), expands macros and resolves names, lowers to HIR (high-level intermediate representation) for type checking, to THIR (typed HIR) for pattern checks, and to MIR (mid-level intermediate representation) for borrow checking and MIR optimizations; it then collects the concrete (monomorphized) items, generates LLVM IR per codegen unit, lets LLVM optimize in parallel, and links. From HIR on, work is organised as memoized **queries** whose dependency graph is saved for **incremental** rebuilds. `cargo check` stops before code generation: on a small tokio program (aarch64, 8 CPUs, Docker, a machine busy with other containers; details in the Worked example), a clean `check` took 5.8–6.1 s against 8.2–8.7 s for `build`, and after a one-line edit 66–87 ms against 481–619 ms. `-Ztime-passes` split tokio's own 2.46 s compile into type checking 0.84 s, MIR checking 0.42 s, monomorphization collection 0.25 s, LLVM IR generation 0.35 s and LLVM passes 0.36 s; `cargo build --timings` showed the `syn` → `tokio-macros` chain holding back tokio until 3.35 s of a 7.4 s build.
**Use this when:** builds are slow and you need to know where the time goes; you pick `cargo check` or `cargo build` for the edit loop; you read `-Ztime-passes`, `-Zself-profile` or `--timings` output; an error appears in `build` but not in `check`; you wonder why generics and procedural macros cost build time.
**Not this doc:** what `cargo check` and `cargo build` are and the flags Cargo passes → `rust/fundamentals/toolchain-cargo-and-editions.md`; profile settings (`opt-level`, `lto`, `codegen-units`) and their measured run-time effect → `rust/project-structure/cargo-workspaces-features-and-profiles.md`; run-time optimization → `rust/performance/zero-cost-abstractions-and-optimization.md`; writing procedural macros and their build cost → `rust/macros/procedural-macros.md`; the borrow-checking rules → `rust/ownership/borrowing-references-and-slices.md`.

## Problem
A one-line edit takes seconds to rebuild and nobody knows whether the time goes to dependencies, macros, type checking, LLVM or the linker. Developers wait for full builds where `cargo check` would do, or trust `check` for an error it cannot see. Generic code and derive-heavy dependencies make builds slow in ways that are invisible in the source. Without the pipeline in mind, `-Ztime-passes` output is a wall of names.

## Mental model
**Analogy:** a restaurant kitchen run backwards from the order. The waiter asks for the finished dish; the plating station asks the grill for meat, the grill asks the prep station for a cut, and so on back to the pantry. Every station writes in a ledger which inputs each result used. Next evening, a station whose inputs did not change serves yesterday's result from the ledger instead of cooking again. The stations are the compiler's representations; the ledger is the incremental dependency graph.

**Artifact:** one function, seen at four stages (lab) ✅[^1]:
```rust
pub fn total(prices: &[u32]) -> u32 {
    let mut sum = 0;
    for p in prices { sum += p; }
    sum
}
```
| Stage | How it was printed | What it shows |
|---|---|---|
| HIR | `rustc +nightly -Zunpretty=hir` | `for` is gone: `match into_iter(prices) { mut iter => loop { match next(&mut iter) { None {} => break, Some { 0: p } => { sum += p; } } } }` |
| MIR | `rustc --emit=mir` | Basic blocks `bb0`…`bb6`: `<&[u32] as IntoIterator>::into_iter`, `<std::slice::Iter<'_, u32> as Iterator>::next`, `switchInt`, `<u32 as AddAssign<&u32>>::add_assign`, `return` |
| Mono items, `opt-level=0` | `rustc +nightly -Zprint-mono-items=yes` | 4 items: `total`, `Iter::next`, `AddAssign::add_assign`, `IntoIterator::into_iter`, each placed in codegen unit `total.…-cgu.0` |
| LLVM IR, `opt-level=2` | `--emit=llvm-ir` (with `-Zcross-crate-inline-threshold=never` so the small function is emitted) | One `define`; the calls are inlined and the loop is vectorized: `load <4 x i32>`, `add <4 x i32>` |

## How it works
**5 actors:**
- **Cargo** — its job: order the crates and start one compiler run per unit, via the dependency graph and the jobserver.
- **rustc front end** — its job: turn text into a resolved tree, via the lexer, the parser, macro expansion and name resolution.
- **rustc middle** — its job: check and lower the program, via HIR, THIR and MIR queries.
- **LLVM** — its job: optimize and emit machine code, via one LLVM module per codegen unit.
- **The linker** — its job: combine object files and libraries into the binary, via the system linker that rustc invokes.

```text
Cargo: unit graph ── build scripts ── rustc per crate (pipelined: dependents may start early)
  rustc front end   lex → parse → AST → macro expansion + name resolution        tokio: 0.14 s + 0.08 s
  rustc middle      AST → HIR → type check (+ coherence) → THIR → MIR            tokio: 0.84 s
                    → borrow check + MIR checks → MIR opts                        tokio: 0.42 s
                    → monomorphization collection → partition into CGUs          tokio: 0.25 s + 0.04 s
  codegen           MIR → LLVM IR (per CGU)                                      tokio: 0.35 s
  LLVM (parallel)   optimize + emit objects                                      tokio: 0.36 s
  linker            rlib (library) or executable                                 ticker: 0.39 s
```

1. **Cargo (local).**
   - It starts a unit when the units it depends on unblock it ✅[^3], and runs a package's build script just before compiling that package ✅[^2].
   - Pipelining lets a dependent start while its dependency is still in code generation ✅[^3].
   - In the lab's `--timings` report, 28 units ran with a maximum concurrency of 8 ✅[^1].
2. **Front end.**
   - The lexer turns text into tokens and the parser builds an AST by recursive descent ✅[^4].
   - Macro expansion, AST validation, name resolution and early lints follow, then the AST is lowered (desugared) to HIR ✅[^4]. The HIR row of the artifact shows that lowering: the `for` loop became `match`/`loop`/`next` ✅[^1].
   - For tokio, `expand_crate` took 0.141 s and `resolve_crate` 0.083 s ✅[^1].
3. **Middle.**
   - Type inference, trait solving and type checking run on HIR ✅[^4]; for tokio, `type_check_crate` took 0.844 s, and `coherence_checking`, printed just before it, 0.484 s ✅[^1].
   - HIR is lowered to THIR for pattern and exhaustiveness checks, then to MIR, a control-flow graph ✅[^4].
   - The borrow checker operates on MIR ✅[^5] ✅[^4]; tokio's `MIR_checking` took 0.421 s ✅[^1].
   - MIR optimizations run on generic MIR, before monomorphization ✅[^4].
4. **Monomorphization and partitioning.**
   - The collector lists every concrete function instance and static that needs machine code ✅[^6]; for tokio, `monomorphization_collector_graph_walk` took 0.252 s ✅[^1].
   - Items are split into codegen units (CGUs). For incremental builds each module gets one CGU for stable non-generic code and one for monomorphized instances ✅[^6].
   - Cargo's defaults are 256 CGUs for incremental (`dev`) builds and 16 otherwise ✅[^7].
5. **Codegen and LLVM.** MIR is translated to LLVM IR, LLVM optimizes it and emits machine code ✅[^4]. Code generation is the only part of rustc that runs in parallel by default ✅[^4]. tokio spent 0.348 s producing LLVM IR and 0.363 s in LLVM passes ✅[^1].
6. **Linker.** Libraries and binaries are linked into the final binary ✅[^4]. For the lab's tiny binary crate, `link_binary` was 0.390 s of a 0.726 s compile, more than code generation ✅[^1].
7. **Queries and incremental compilation.**
   - From HIR on, rustc is not a fixed series of passes but a set of queries that call each other: functions such as `type_of(def_id)`, memoized on first use ✅[^4] ✅[^8].
   - Each query records which other queries it read, which forms a dependency graph saved between sessions ✅[^8] ✅[^9].
   - On the next build, a query whose inputs are all unchanged ("green") is reused without running. A changed one is re-run, and if its result hashes the same as before, its dependents stay green (early cutoff) ✅[^9].
   - `-Zincremental-info` on the 12-line tokio program reported a graph of 30,837 nodes and 137,700 edges; the most frequent node kind was `layout_of` (3,396 nodes, 11.0%) ✅[^1].
8. **`cargo check`.** It compiles without the final code-generation step and keeps metadata for later runs ✅[^10]. The cost is that diagnostics produced only during code generation are missing ✅[^10]. In the lab, a `const { assert!(N > 0) }` inside a generic function instantiated with `N = 0` passed `cargo check` and failed `cargo build` with `error[E0080]: evaluation panicked: chunk size must be non-zero` ✅[^1]. A `const` block can use the function's generic parameters ✅[^11], and in the lab its assertion fired only when `cargo build` generated code for `chunk::<0>` ✅[^1].

## Worked example
A 12-line program using `tokio` (`features = ["full"]`), with the crates.io cache warm and `target/` removed before each clean build; aarch64, 8 CPUs, Docker, load average 16–21 from other containers, two rounds ✅[^1]:

| Command | Clean build (ms) | After a one-line edit to `main.rs` (ms) |
|---|---|---|
| `cargo check` | 5,767 / 6,106 | 87 / 66 |
| `cargo build` | 8,216 / 8,744 | 619 / 481 |
| `cargo build --release` | 9,676 / 5,881 | 432 / 397 |

`cargo build --timings` on the same clean `dev` build (total 7.4 s, 28 units, `target/cargo-timings/cargo-timing.html`) ✅[^1]:

| Unit | Start (s) | Duration (s) | Of which front end / codegen (s) |
|---|---|---|---|
| `proc-macro2` build script, then crate | 0.16 | 0.36 + 0.25 | 0.18 / 0.07 |
| `syn` 3.0.10 | 0.88 | 2.08 | 1.82 / 0.26 |
| `tokio-macros` 2.7.2 | 2.96 | 0.38 | — |
| `tokio` 1.54.1 | 3.35 | 2.94 | 2.16 / 0.78 |
| `ticker` (the program, with linking) | 6.29 | 1.13 | — |

Reading it:
- The critical path is `proc-macro2` → `quote` → `syn` → `tokio-macros` → `tokio` → `ticker`: tokio cannot start until its procedural macro crate is built, and `syn`'s 2.08 s sit on that path ✅[^1]. The report is designed for exactly this: follow the unblocking lines to find the slow chain and the crates that block many others ✅[^3].
- `check` saved about 30% of a clean build but was about 7× faster in the edit loop, where only the binary crate is rebuilt and its code generation and linking dominate ✅[^1].
- Release builds are not incremental by default ✅[^7]; the edit rebuild was still fast because the dependencies were already built and only the tiny `ticker` crate recompiled ✅[^1].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Error only at monomorphization (a failing `const` block in a generic function) | `cargo check` passes, `cargo build` fails with E0080 ✅[^1] | Some errors are only emitted during code generation ✅[^10] |
| Borrow error in a function nobody calls | Still reported ✅[^4] | `mir_borrowck` runs on every function of the crate ✅[^4] |
| `rustc -Ztime-passes` on stable | ``error: the option `Z` is only accepted on the nightly compiler`` ✅[^1] | `-Z` flags are unstable; use `rustc +nightly` or `cargo +nightly rustc -- -Z…` |
| `-Ztime-passes` numbers do not add up | Lines nest: `expand_crate` (0.141 s) is printed before the `macro_expand_crate` (0.142 s) that contains it; `total` was 2.463 s ✅[^1] | Each line times one region of work, and an outer region includes its inner ones |
| `-Zself-profile` output file | The lab produced one file, `ticker-0000021.mm_profdata` (2.6 MB) ✅[^1] | The Unstable Book still names three files (`.events`, `.string_data`, `.string_index`) and points to measureme's `summarize` to read the data ✅[^12] |
| Small `pub fn` absent from a library's `--emit=llvm-ir` at `opt-level=2` | Only 10 lines of IR ✅[^1] | rustc leaves small functions to be compiled in the caller (`rust/performance/zero-cost-abstractions-and-optimization.md`) |
| Many generic instantiations | More LLVM IR, longer codegen ✅[^6] | `cargo llvm-lines` finds the generic functions that produce the most IR ✅[^13] |
| Heavy procedural macros | `syn` on the critical path (2.08 s here) ✅[^1] | Every crate using the macro waits for it (`rust/macros/procedural-macros.md`) |
| Tiny binary crate | Linking took 54% of its compile ✅[^1] | A faster linker is the cheap fix ✅[^14] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `cargo check` in the edit loop | 66–87 ms instead of 481–619 ms in the lab ✅[^1] | No binary; misses code-generation errors ✅[^10] |
| Incremental compilation (default in `dev`) | Reuses green queries ✅[^9] | Extra files under `target/debug/incremental` ✅[^1] |
| More codegen units | More parallel LLVM work, faster builds ✅[^15] | Possibly slower code ✅[^15] |
| Disable debug info in `dev` | Build times 20–40% lower, per the Performance Book ✅[^14] | Weaker debugger experience |
| Faster linker (lld, mold, wild) | Shorter link step, no downside where supported ✅[^14] | One more tool to install on some platforms |
| Split a large crate | More parallelism in the crate graph ✅[^13] | More crates and APIs to maintain |
| Fewer generic layers (inner non-generic functions) | Less IR to generate ✅[^13] | Small effect in most cases ✅[^13] |

## Takeaways
- Use `cargo check` while editing and `cargo build` or `cargo test` before trusting the result, since some errors appear only in code generation. [rule-candidate]
- Before optimizing a build, run `cargo build --timings` and look for the chain that blocks the most units.
- Use `cargo +nightly rustc -- -Ztime-passes` to see which compiler stage dominates one crate.
- Weigh a procedural-macro dependency by its place on the critical path, not only by its own compile time.
- Read compile-time numbers with their conditions: load, cache state and clean versus incremental change them a lot.

## Verification status
- Verified: 68 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `linux/lab-setup.md` — the Rust 1.100.0 lab (`rustlab:1`) where every behaviour marked with this note ran on 2026-11-24. [^1]
- [Build Scripts](https://doc.rust-lang.org/cargo/reference/build-scripts.html) — The Cargo Book, living. Backs: build scripts run before the package is built. [^2]
- [Reporting build timings](https://doc.rust-lang.org/cargo/reference/timings.html) — The Cargo Book, living. Backs: the `--timings` report, unblocking lines, pipelining, what to look for. [^3]
- [Overview of the compiler](https://rustc-dev-guide.rust-lang.org/overview.html) — Rust Compiler Development Guide, living. Backs: the stage order, queries instead of passes, borrow check of every function, parallel code generation. [^4]
- [The borrow checker](https://rustc-dev-guide.rust-lang.org/borrow-check.html) — Rust Compiler Development Guide, living. Backs: borrow checking operates on MIR. [^5]
- [Monomorphization](https://rustc-dev-guide.rust-lang.org/backend/monomorph.html) — Rust Compiler Development Guide, living. Backs: the collector, its cost, CGU partitioning for incremental builds. [^6]
- [Profiles](https://doc.rust-lang.org/cargo/reference/profiles.html) — The Cargo Book, living. Backs: 256 and 16 codegen units, `incremental` defaults. [^7]
- [Queries: demand-driven compilation](https://rustc-dev-guide.rust-lang.org/query.html) — Rust Compiler Development Guide, living. Backs: what a query is, memoization, the dependency graph. [^8]
- [Incremental compilation](https://rustc-dev-guide.rust-lang.org/queries/incremental-compilation.html) — Rust Compiler Development Guide, living. Backs: saved query graph, red/green marking, early cutoff. [^9]
- [cargo check](https://doc.rust-lang.org/cargo/commands/cargo-check.html) — The Cargo Book, living. Backs: no code generation, reused metadata, missing late diagnostics. [^10]
- [Block expressions](https://doc.rust-lang.org/reference/expressions/block-expr.html) — The Rust Reference, living. Backs: `const` blocks use generic parameters and are desugared to generic constant items. [^11]
- [self-profile](https://doc.rust-lang.org/nightly/unstable-book/compiler-flags/self-profile.html) — The Rust Unstable Book, living. Backs: `-Zself-profile`, its documented output files, measureme tools. [^12]
- [Compile Times](https://nnethercote.github.io/perf-book/compile-times.html) — Nicholas Nethercote and others, The Rust Performance Book, living. Backs: `--timings` for parallelism, `cargo llvm-lines`, generic code fixes and their usually small effect. [^13]
- [Build Configuration](https://nnethercote.github.io/perf-book/build-configuration.html) — Nicholas Nethercote and others, The Rust Performance Book, living. Backs: faster linkers, disabling debug info for 20–40% faster builds. [^14]
- [Codegen Options](https://doc.rust-lang.org/rustc/codegen-options/index.html) — The rustc book, living. Backs: codegen units trade build parallelism for code speed. [^15]
- [Profiling the compiler](https://rustc-dev-guide.rust-lang.org/profiling.html) — Rust Compiler Development Guide, living. Background: `-Zself-profile`, `--timings`, perf, `cargo-llvm-lines`.

## Related
- `rust/fundamentals/toolchain-cargo-and-editions.md` — what `cargo check` and `cargo build` pass to rustc.
- `rust/project-structure/cargo-workspaces-features-and-profiles.md` — profiles, features and build scripts.
- `rust/performance/zero-cost-abstractions-and-optimization.md` — what the optimizer does with the code.
- `rust/macros/procedural-macros.md` — the build cost of procedural macros.
- `rust/ownership/borrowing-references-and-slices.md` — what the MIR borrow checker enforces.
