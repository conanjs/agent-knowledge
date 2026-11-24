---
schema: knowledge-doc/v1
type: concept
topic: rust/project-structure
status: verified
applies-to: ["Rust 1.100.0", "edition 2024", "proptest 1.12"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [rust, testing, cargo-test, libtest, unit-tests, integration-tests, doc-tests, should-panic, ignore, test-threads, output-capture, proptest, property-testing, shrinking]
---

# Testing in Rust: unit, integration, doc and property tests

## Summary
**TL;DR:** `cargo test` builds and runs three kinds of tests: **unit tests** in a `#[cfg(test)] mod tests` next to the code (they can call private items), **integration tests** in `tests/*.rs` (each file is its own crate and sees only the public API), and **doc tests** taken from code blocks in `///` comments (merged into one binary in edition 2024). A test passes when it returns without panicking, or returns `Ok`; `#[should_panic(expected = "…")]` inverts that and `#[ignore]` skips a test unless you pass `--ignored` or `--include-ignored`. The harness runs tests on parallel threads of one process: three 500 ms tests took 0.50 s, and 1.51 s with `--test-threads=1`. It hides the output of passing tests unless you pass `--show-output` or `--no-capture` (`--nocapture` is a deprecated alias). proptest generates random inputs and **shrinks** a failure: an `(a + b) / 2` overflow shrank to `a = 1096256322, b = 3198710974`, whose sum is exactly 2³².
**Use this when:** organising tests in a crate; a test passes alone and fails in the full run; output of a test does not appear; you need to run a subset; you want to test a property over many inputs.
**Not this doc:** testing concurrent code with loom → `rust/concurrency/atomics-and-memory-ordering.md`; finding undefined behaviour with Miri → `rust/unsafe/unsafe-rust-and-undefined-behavior.md`; benchmarks with criterion → `rust/performance/zero-cost-abstractions-and-optimization.md`; testing a binary end to end through its exit codes → `rust/project-structure/build-a-command-line-tool.md`; pinning legacy behaviour before a change → `testing/characterization-tests.md`.

## Problem
Tests that share a file or an environment variable pass alone and fail together, because they run in parallel. A `println!` inside a test prints nothing. A helper used only by tests triggers a dead-code warning. A binary-only crate cannot be imported by integration tests. And hand-picked examples miss the input that breaks the code, such as two large numbers whose sum overflows.

## Mental model
**Analogy:** an exam hall. Cargo prints one exam paper per target (the library, each file in `tests/`, the doc examples). The invigilator (the test harness) seats every question (test function) at its own desk (thread) at the same time, collects each candidate's notes (stdout) in a sealed envelope, and opens the envelope only for the candidates who fail.

**Artifact:** one `cargo test` on the lab crate `ledger` (trimmed) ✅[^1]:
```console
$ cargo test
     Running unittests src/lib.rs (target/debug/build/ledger/…/out/ledger-…)
running 5 tests
test tests::split_a_large_bill ... ignored, takes a few seconds
test tests::zero_people_is_an_error ... ok
test tests::leftover_goes_to_first_people ... ok
test tests::private_helper_is_testable ... ok
test tests::percent_of_nothing_panics - should panic ... ok
test result: ok. 4 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.00s
     Running tests/public_api.rs (…)
test shares_add_up_to_total ... ok
   Doc-tests ledger
test src/lib.rs - split_bill (line 3) ... ok
all doctests ran in 0.27s; merged doctests compilation took 0.27s
```

## How it works
**3 actors:**
- **Cargo** — its job: build one test executable per target and run them in turn, via `cargo test` and the `test` profile.
- **libtest (the test harness)** — its job: run every `#[test]` function and report the result, via a `main` that rustc generates when it compiles with `--test`.
- **rustdoc** — its job: turn code blocks in doc comments into tests, via `cargo test`'s doc-test step.

```text
cargo test [FILTER] [-- HARNESS-FLAGS]                    (all local)
  ├─ rustc --test src/lib.rs ─────────► unit-test binary ─┐
  ├─ rustc --test tests/public_api.rs ► one binary per file├─ libtest: threads, capture, filter
  ├─ rustc --test tests/props.rs ─────► …                 ┘
  └─ rustdoc --test src/lib.rs ───────► doc tests (merged into one binary in edition 2024)
```

1. **Cargo builds the test targets.**
   - Unit tests live in the library or binary target; each file in `tests/` becomes a separate crate ✅[^2] ✅[^4].
   - `#[cfg(test)]` compiles the `tests` module only for `cargo test`; as a child module it can call private functions (the lab's `private_helper_is_testable` called the private `round_to_ten`) ✅[^4] ✅[^1].
   - Doc tests come from the library target's doc comments ✅[^12].
   - Options before `--` go to Cargo (`--lib`, `--test NAME`, `--doc`, `--no-run`); the filter and options after `--` go to each test binary ✅[^12] ✅[^3].
2. **libtest runs the functions.**
   - `rustc --test` links the crate with libtest, which generates the `main` ✅[^5].
   - Each test runs on its own thread, and a test fails when its thread panics ✅[^2]. In the lab, a test printed its thread name: `Some("tests::leftover_goes_to_first_people")` ✅[^1].
   - A test may return `Result<(), E>`: `Err` fails it and `?` works inside; such a test cannot also carry `#[should_panic]` ✅[^2].
   - `#[should_panic(expected = "whole must be non-zero")]` passes only if the panic message contains that text ✅[^2]; the lab output marks it `- should panic ... ok` ✅[^1].
   - Tests run in parallel, by default with as many threads as `available_parallelism` reports ✅[^5]. The lab's three tests that each sleep 500 ms finished in 0.50 s, and in 1.51 s with `-- --test-threads=1` ✅[^1].
3. **libtest captures output.**
   - Output of passing tests is hidden; output of failing tests is printed in the failures section ✅[^3].
   - `--show-output` prints the captured output of passing tests after the run, in one block per test ✅[^5]. The lab printed `---- tests::leftover_goes_to_first_people stdout ----` and the line under it ✅[^1].
   - `--no-capture` lets tests print directly while they run; `--nocapture` is a deprecated alias for it ✅[^5]. Both spellings worked in the lab, and `cargo test -- --help` lists only `--no-capture` ✅[^1].
4. **libtest selects tests.**
   - A bare argument is a substring filter on the full test path (`cargo test leftover` ran 1 test, `4 filtered out`) ✅[^5] ✅[^1].
   - `--exact` requires the whole path, and `--skip FILTER` excludes tests ✅[^5].
   - `#[ignore = "reason"]` skips a test and prints the reason; `-- --ignored` runs only ignored tests, and `-- --include-ignored` runs all ✅[^3] ✅[^1].
5. **rustdoc runs the examples.**
   - Each code block in a doc comment is compiled, wrapped in `fn main` when it has none, and passes if it does not panic ✅[^6].
   - Lines starting with `#` are compiled but hidden from the docs ✅[^6].
   - `ignore`, `no_run`, `should_panic` and `compile_fail` after the opening fence change what is checked ✅[^6].
   - In edition 2024, compatible doc tests are merged into one binary before running; `standalone_crate` opts a block out ✅[^6]. The lab reported `merged doctests compilation took 0.27s` ✅[^1].
6. **Property tests with proptest (a dev-dependency).**
   - `proptest! { #[test] fn name(a in any::<u32>(), …) { … } }` runs the body on generated inputs, 256 cases by default (`PROPTEST_CASES` overrides it) ✅[^7] ✅[^8].
   - `prop_assert!` reports a failure instead of panicking ✅[^7].
   - On a failure proptest shrinks the input toward a simpler one that still fails, and prints `minimal failing input` ✅[^7] ✅[^1].
   - It saves the failing seed in a regression file that is replayed before new cases; the RNG seed is otherwise random ✅[^8] ✅[^9].

## Worked example
The bug: `pub fn average(a: u32, b: u32) -> u32 { (a + b) / 2 }`. The property: the average lies between the two inputs ✅[^1]:
```rust
// tests/props.rs
use proptest::prelude::*;
proptest! {
    #[test]
    fn average_lies_between_inputs(a in any::<u32>(), b in any::<u32>()) {
        let avg = ledger::average(a, b);
        prop_assert!(a.min(b) <= avg && avg <= a.max(b));
    }
}
```
| Step | What happened in the lab ✅[^1] |
|---|---|
| 1. `cargo test --test props` | The first random pair overflowed: `panicked at src/lib.rs:18:5: attempt to add with overflow` (a debug build checks integer overflow, see `rust/fundamentals/variables-types-and-control-flow.md`) |
| 2. Shrinking | proptest kept trying smaller values; the panic message repeated once per failing try |
| 3. Report | `minimal failing input: a = 1096256322, b = 3198710974`, then `successes: 0` |
| 4. Why that pair | 1,096,256,322 + 3,198,710,974 = 4,294,967,296 = `u32::MAX + 1`: the smallest sum that overflows, found without anyone writing it (a re-run in a fresh project shrank to `a = 1309540831, b = 2985426465`: a different pair, again summing to exactly 2³²) |
| 5. Persistence | proptest printed `FileFailurePersistence::SourceParallel set, but failed to find lib.rs or main.rs` and wrote `tests/props.proptest-regressions` with the line `cc d5cd43f7… # shrinks to a = 1096256322, b = 3198710974` |
| 6. Rerun | Three more runs reported the same pair first, because the saved seed is replayed before random cases |
| 7. Fix | `a.midpoint(b)`, which computes the average as if in a wider type and never overflows ✅[^10]; the property then passed: `1 passed` |

Step 5 is the documented fallback: `SourceParallel` walks up from the test file looking for `lib.rs` or `main.rs`; for `tests/props.rs` it finds neither, so it warns and writes the file next to the source ✅[^9].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Helper used only by tests, defined outside `mod tests` | `warning: function round_to_ten is never used` in normal builds ✅[^1] | The non-test build never calls it; move it into `mod tests` or mark it `#[cfg(test)]` |
| `tests/common.rs` for shared helpers | Shows up as its own test crate with `running 0 tests` ✅[^4] | Every top-level file in `tests/` is a crate; use `tests/common/mod.rs` ✅[^4] |
| Crate with only `src/main.rs` | Integration tests cannot import its functions ✅[^4] | Move logic to `src/lib.rs`, or run the binary through `CARGO_BIN_EXE_<name>` ✅[^11] |
| Two tests write the same file or env var | Flaky results ✅[^3] | They run in parallel threads of one process ✅[^5] |
| `println!` in a passing test | Nothing printed ✅[^3] | Captured; use `--show-output` or `--no-capture` |
| `cargo test --test-threads=1` (before `--`) | ``error: unexpected argument '--test-threads' found``, with the tip `use '-- --test-threads'` ✅[^1] | Two argument lists: Cargo's and the binary's ✅[^3] |
| `#[should_panic]` on a test returning `Result` | Not allowed; use `assert!(value.is_err())` ✅[^2] | The `Err` result already means failure |
| `?` in a doc test | Needs a final hidden `# Ok::<(), io::Error>(())` line ✅[^6] | The generated `main` returns `()` otherwise |
| `panic = "abort"` for tests | Not supported by default ✅[^5] | Tests rely on catching panics in one process |
| Unit tests' working directory | The package root ✅[^12] | Relative paths in tests resolve from there |
| Integration-test property failures | Regression file lands in `tests/`, next to the test file ✅[^1] | No `lib.rs`/`main.rs` above `tests/` ✅[^9] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Unit tests in `mod tests` | Reach private items; live next to the code ✅[^4] | Can couple tests to internals |
| Integration tests in `tests/` | Test only the public API, as a user would ✅[^4] | One more crate to compile per file |
| Doc tests | Examples in the docs cannot go stale ✅[^6] | Each block is a small program to compile; edition 2024 merges them to cut that cost ✅[^6] |
| Property tests | Find inputs nobody thought of; shrink to a minimal case ✅[^1] | Random by default; 256 cases per property cost time ✅[^8] |
| `--test-threads=1` | No interference through shared state ✅[^3] | Total time adds up (1.51 s vs 0.50 s in the lab) ✅[^1] |

## Takeaways
- Keep `#[cfg(test)] mod tests` in the same file for unit tests and put public-API tests in `tests/`.
- Give each test its own temporary file names and never mutate process-wide state such as environment variables in parallel tests. [rule-candidate]
- Use `#[should_panic(expected = "…")]`, never a bare `#[should_panic]`, so an unrelated panic cannot pass the test. [rule-candidate]
- Write `--no-capture`, not the deprecated `--nocapture`.
- Commit proptest regression files so every run replays past failures; the generated file's own header recommends it ✅[^1].
- Mark slow tests `#[ignore = "reason"]` and run them in CI with `-- --include-ignored`.

## Verification status
- Verified: 67 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `linux/lab-setup.md` — the Rust 1.100.0 lab (`rustlab:1`) where every behaviour marked with this note ran on 2026-11-24. [^1]
- [How to Write Tests](https://doc.rust-lang.org/book/ch11-01-writing-tests.html) — The Rust Programming Language, living. Backs: `#[test]`, a thread per test, assertions, `should_panic` with `expected`, `Result` tests. [^2]
- [Controlling How Tests Are Run](https://doc.rust-lang.org/book/ch11-02-running-tests.html) — The Rust Programming Language, living. Backs: arguments before and after `--`, parallel threads and shared state, `--test-threads`, `--show-output`, filters, `#[ignore]`. [^3]
- [Test Organization](https://doc.rust-lang.org/book/ch11-03-test-organization.html) — The Rust Programming Language, living. Backs: `#[cfg(test)]`, private functions, `tests/`, `tests/common/mod.rs`, binary crates. [^4]
- [Tests](https://doc.rust-lang.org/rustc/tests/index.html) — The rustc book, living. Backs: `--test` and libtest, default thread count, `--no-capture` and its deprecated alias, `--show-output`, `--exact`, `--skip`, `panic = "abort"`. [^5]
- [Documentation tests](https://doc.rust-lang.org/rustdoc/write-documentation/documentation-tests.html) — The rustdoc book, living. Backs: wrapping in `main`, hidden lines, attributes, `?` in doc tests, edition-2024 merging. [^6]
- [Crate proptest](https://docs.rs/proptest/1.12.0/proptest/) — proptest maintainers, 2026 (version 1.12.0). Backs: property-based testing and shrinking, `prop_assert!`. [^7]
- [Config in proptest::test_runner](https://docs.rs/proptest/1.12.0/proptest/test_runner/struct.Config.html) — proptest maintainers, 2026 (version 1.12.0). Backs: 256 cases, `PROPTEST_CASES`, random seed, failure persistence default. [^8]
- [FileFailurePersistence in proptest::test_runner](https://docs.rs/proptest/1.12.0/proptest/test_runner/enum.FileFailurePersistence.html) — proptest maintainers, 2026 (version 1.12.0). Backs: how `SourceParallel` finds the regression directory and its fallback. [^9]
- [Primitive type u32: midpoint](https://doc.rust-lang.org/std/primitive.u32.html#method.midpoint) — Rust standard library, living. Backs: `midpoint` never overflows, rounds toward zero. [^10]
- [Environment Variables](https://doc.rust-lang.org/cargo/reference/environment-variables.html) — The Cargo Book, living. Backs: `CARGO_BIN_EXE_<name>` in integration tests. [^11]
- [cargo test](https://doc.rust-lang.org/cargo/commands/cargo-test.html) — The Cargo Book, living. Backs: doc tests from the library target, Cargo options versus harness options, working directory. [^12]

## Related
- `rust/project-structure/build-a-command-line-tool.md` — unit tests plus an end-to-end test of a binary.
- `rust/project-structure/packages-crates-and-modules.md` — why integration tests see only `pub` items.
- `rust/concurrency/atomics-and-memory-ordering.md` — loom for concurrency tests.
- `rust/unsafe/unsafe-rust-and-undefined-behavior.md` — running tests under Miri.
- `testing/characterization-tests.md` — tests that pin existing behaviour.
