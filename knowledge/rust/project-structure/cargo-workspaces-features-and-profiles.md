---
schema: knowledge-doc/v1
type: concept
topic: rust/project-structure
status: verified
applies-to: ["Rust 1.100.0", "Cargo 1.100.0", "edition 2024", "serde 1.0.229", "serde_json 1.0.154"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [rust, cargo, dependencies, semver, cargo-lock, workspaces, features, feature-unification, build-rs, profiles, lto, codegen-units, opt-level, cargo-install, publishing]
---

# Cargo dependencies, workspaces, features and profiles

## Summary
**TL;DR:** `serde = "1.0.229"` is a caret requirement (`>=1.0.229, <2.0.0`); Cargo picks the highest compatible version and pins it in `Cargo.lock`. A **workspace** is a set of packages that share one `Cargo.lock` and one `target/`. **Features** are additive flags, and Cargo compiles each dependency with the union of the features requested by every package in the same command: in the lab, member `alpha` used serde's `derive` without asking for it, failed alone with E0433 and built fine with `--workspace`, because member `beta` asked for it. **Profiles** set compiler options: `dev` is `opt-level = 0` with debug info and incremental builds, `release` is `opt-level = 3` with 16 codegen units. In the lab, the release build ran a compute loop 55× faster than dev; fat LTO cut the binary from 549,664 to 448,392 bytes; `opt-level = "z"` made it larger and 3.4× slower.
**Use this when:** writing version requirements; a crate builds in the workspace but not alone; designing features; tuning a release binary for speed or size; adding a `build.rs`; installing or publishing.
**Not this doc:** `Cargo.toml` versus `Cargo.lock` basics and `cargo new/build/run/check` → `rust/fundamentals/toolchain-cargo-and-editions.md`; crates and modules inside one package → `rust/project-structure/packages-crates-and-modules.md`; what codegen units and LTO change inside the compiler, and build-time measurement → `rust/performance/compiler-pipeline-and-compile-times.md`; when an optimization is worth it → `rust/performance/zero-cost-abstractions-and-optimization.md`; the SemVer promise itself → `versioning/semantic-versioning.md`.

## Problem
CI builds the whole workspace and is green, but `cargo build -p one-crate` fails. Two crates of a workspace pin different versions of a dependency and the build breaks. A `[profile.release]` table in a member crate has no effect. A "release" binary is 6 MB, or slow, and nobody knows which setting matters. A build script reruns on every edit. A version published by mistake cannot be removed. All of these come from how Cargo resolves versions, unifies features and applies profiles.

## Mental model
**Analogy:** a workspace is a shared kitchen with one pantry (`target/`) and one shopping list (`Cargo.lock`). Features are pizza toppings on a shared order: if any person at the table orders olives, the pizza that arrives has olives for everyone. A profile is the oven setting: the same dough comes out very differently at 0 or at 3.

**Artifact:** a virtual workspace whose two members ask for different features of the same two dependencies (lab) ✅[^1]:
```toml
# Cargo.toml (root)                       # alpha/Cargo.toml
[workspace]                               [dependencies]
members = ["alpha", "beta", "shared"]     shared = { path = "../shared", features = ["fast"] }
resolver = "3"                            serde = { workspace = true }   # no "derive"
[workspace.dependencies]                  # beta/Cargo.toml
serde = "1.0.229"                         shared = { path = "../shared", features = ["extra"] }
                                          serde = { workspace = true, features = ["derive"] }
```
`shared` prints `cfg!(feature = "fast")` and `cfg!(feature = "extra")`; `alpha` uses `#[derive(serde::Serialize)]`:
```console
# run with -q --offline in the lab
$ cargo build -p alpha
error[E0433]: cannot find `Serialize` in `serde`
$ cargo build -p beta && ./target/debug/beta
beta sees shared with fast=false extra=true
$ cargo build --workspace && ./target/debug/alpha
alpha sees shared with fast=true extra=true
$ find . -name Cargo.lock -o -maxdepth 2 -name target -type d | sort
./Cargo.lock
./target
```

## How it works
**4 actors:**
- **Cargo's version resolver** — its job: choose one version per dependency requirement, via the requirements in each `Cargo.toml` and the versions recorded in `Cargo.lock`.
- **Cargo's feature resolver** — its job: decide each package's feature set for this command, via the packages the command selects and their `features` lists.
- **A build script** — its job: compute settings before its package compiles, via `cargo::` lines it prints to stdout.
- **rustc** — its job: compile each package, via the flags Cargo derives from the profile and the features.

```text
cargo build -p alpha                                   (all local)
  ├─ version resolver: Cargo.toml requirements + Cargo.lock ─► exact versions
  │     └─ a crate missing from the cache is downloaded ═══ network boundary ═══
  ├─ feature resolver: selected packages {alpha} ─► shared{fast}, serde{default, std}
  ├─ build scripts: build.rs runs, prints cargo::rustc-env=… / cargo::rustc-cfg=…
  └─ rustc per package: -C opt-level=3 -C strip=debuginfo --cfg 'feature="fast"' …
        └─► <workspace root>/target/<profile>/
```

1. **Version resolver (local; network only for missing crates).**
   - A bare requirement is a caret requirement: `1.2.3` means `>=1.2.3, <2.0.0`, `0.2.3` means `>=0.2.3, <0.3.0`, and `0.0.3` means `>=0.0.3, <0.0.4`; `~1.2.3`, `1.2.*`, `>=`, `<` and `=1.2.3` give other ranges ✅[^3].
   - Cargo prefers the highest version that matches, but a version already in `Cargo.lock` wins while it still matches ✅[^4].
   - Within one SemVer-compatible range there is only one version per build, so two conflicting exact requirements such as `=0.4.11` and `=0.4.8` are an error; incompatible majors (`0.6` and `0.7`) can coexist, and `cargo tree -d` lists such duplicates ✅[^4].
   - Edition 2024 packages default to resolver `"3"`, which prefers versions whose `rust-version` fits yours ✅[^4]. A virtual workspace has no edition to infer it from, so its root must set `resolver` ✅[^5].
   - The lab workspace resolved `serde 1.0.229` from the crates.io index into the single root `Cargo.lock` ✅[^1].
2. **Workspace sharing.** All members share one `Cargo.lock` and one output directory at the root ✅[^5] ✅[^6]. `[profile.*]`, `[patch]` and `[replace]` are read only from the root manifest ✅[^5]; in the lab, a `[profile.release]` in `alpha/Cargo.toml` printed `warning: profiles for the non root package will be ignored, specify profiles at the workspace root` ✅[^1]. Members inherit shared values with `serde = { workspace = true }` from `[workspace.dependencies]` and `version.workspace = true` from `[workspace.package]`; a member's `features` are added to the workspace's ✅[^5]. With no `default-members`, commands at the root of a virtual workspace act on every member ✅[^5].
3. **Feature resolver.**
   - A feature is a name in `[features]` that enables other features or optional dependencies; code tests it with `#[cfg(feature = "…")]`, and `default` lists what is on unless `--no-default-features` or `default-features = false` ✅[^7].
   - Unification: Cargo builds a dependency once per command with the union of all features enabled on it ✅[^7]. The union covers only the packages selected by that command: `-p beta` gave `shared` only `extra`, `--workspace` gave it both ✅[^1]. `cargo tree -e features -i serde` showed `serde feature "derive"` reached only through `beta` ✅[^1].
   - Because of unification, features must be additive: enabling one must never remove functionality (prefer a `std` feature over a `no_std` one) ✅[^7].
   - Resolver 2 and later do not unify features of build-dependencies and proc-macros with normal ones, of dev-dependencies unless tests or examples are built, or of dependencies for targets not being built ✅[^7] ✅[^4].
   - `cargo build -v -p beta` showed the result as a plain rustc flag on `shared`: `--cfg 'feature="extra"'` ✅[^1].
4. **Build script.** A `build.rs` at the package root is compiled and run just before the package ✅[^8]. Lines starting with `cargo::` are instructions: `rustc-env=VAR=VALUE` (read with `env!`), `rustc-cfg=…`, `rustc-link-lib`, `rustc-link-search`, `warning`, `error`, `rerun-if-changed`, `rerun-if-env-changed` ✅[^8]. Without any `rerun-if-*` line the script reruns when any file of the package changes ✅[^8]. Generated files go only to `OUT_DIR`, which Cargo does not clean ✅[^8] ✅[^9]. In the lab, a script printing `cargo::rustc-env=STAMP_PROFILE={profile}` and `cargo::rustc-cfg=has_stamp` (declared with `cargo::rustc-check-cfg=cfg(has_stamp)`) made the binary print `built with profile debug`, and `release` with `--release` ✅[^1].
5. **rustc with profile flags.** Cargo turns the profile into `-C` flags ✅[^1]:

   | Profile (lab) | Key flags Cargo passed for the crate |
   |---|---|
   | `dev` | `-C debuginfo=2 -C incremental=…/target/debug/incremental` |
   | `release` | `-C opt-level=3 -C strip=debuginfo` |
   | custom `small` | `-C opt-level=z -C lto=fat -C codegen-units=1 -C panic=abort -C strip=symbols` |

   The built-in defaults, from the Cargo Book ✅[^2] ✅[^10]:

   | Setting | `dev` | `release` | Meaning |
   |---|---|---|---|
   | `opt-level` | `0` | `3` | 0–3, `"s"` (size), `"z"` (size, no loop vectorization) |
   | `debug` | `true` (full) | `false` | Debug info level |
   | `debug-assertions`, `overflow-checks` | `true` | `false` | `debug_assert!` and integer overflow panics |
   | `lto` | `false` | `false` | `false` = thin LTO inside the crate only; `"thin"`, `"fat"`/`true` = across crates; `"off"` = none |
   | `codegen-units` | `256` (incremental) | `16` | Parallel compile units; fewer may give faster code |
   | `incremental` | `true` | `false` | Reuse work between builds |
   | `panic` | `"unwind"` | `"unwind"` | `"abort"` drops unwinding |
   | `strip` | `"none"` | `"none"` (see Edge cases) | `"debuginfo"` or `"symbols"` |

   `test` inherits from `dev` and `bench` from `release`; a custom profile needs `inherits` and builds into `target/<name>/` ✅[^2]. `[profile.dev.package."*"]` overrides dependencies only, and overrides cannot set `panic`, `lto` or `rpath` ✅[^2].
6. **`cargo install` and publishing.** `cargo install` builds binary targets with the release profile and copies them to the install root's `bin/` (`--root`, then `CARGO_INSTALL_ROOT`, `install.root`, `CARGO_HOME`, `$HOME/.cargo`) ✅[^11] ✅[^12]; in the lab image `cargo install --path .` wrote `/usr/local/cargo/bin/seek` ✅[^1]. Publishing uploads a version permanently: it can be yanked, which stops new lock files from choosing it, but never overwritten or deleted ✅[^13] ✅[^14]. `cargo package --list` shows the files that would ship ✅[^14]; for the lab's `stamp` crate it listed `Cargo.lock`, `Cargo.toml`, `Cargo.toml.orig`, `build.rs` and `src/main.rs`, and warned that `documentation`, `homepage` or `repository` was missing ✅[^1].

## Worked example
One program, nine profiles. The program counts primes below 20 million with a sieve (memory-bound) and sums squares of 4,096 `u32` values 200,000 times (compute-bound), then prints both results with `serde_json` ✅[^1]. Each profile is `inherits = "release"` plus the listed change. Times are the best of 7 runs inside the program, and the range covers three separate launches (aarch64, 8 CPUs, Docker, load average 10–18 from other containers) ✅[^1]:

| Profile | Changed setting | Binary size (bytes) | Sum-of-squares (ms) | Sieve (ms) |
|---|---|---|---|---|
| `dev` | built-in | 6,382,968 | 5,066–5,334 | 486–546 |
| `o1` | `opt-level = 1` | 555,216 | 292–422 | 70–89 |
| `o2` | `opt-level = 2` | 549,752 | 90–93 | 76–92 |
| `release` | built-in (`opt-level = 3`) | 549,664 | 92–94 | 74–84 |
| `oz` | `opt-level = "z"` | 575,104 | 319–323 | 57–87 |
| `cu1` | `codegen-units = 1` | 545,024 | 96–102 | 81–96 |
| `thin` | `lto = "thin"` | 542,744 | 91–96 | 74–157 |
| `fat` | `lto = "fat"` | 448,392 | 91–96 | 66–83 |
| `small` | `"z"` + fat LTO + 1 unit + `panic = "abort"` + `strip = true` | 332,512 | 319–348 | 80–166 |

Reading it:
- Optimization level is the big lever: `dev` was about 55× slower on the compute loop and 6–7× on the sieve ✅[^1]. The Rust Performance Book gives 10–100× as the usual range ✅[^15].
- `opt-level = 1` left the compute loop 3–4.5× slower than 2 or 3, which were equal here ✅[^1]; the lab did not inspect why.
- Fat LTO removed 18% of the size: the text section went from 346,858 to 303,133 bytes and the function symbols from 717 to 535 ✅[^1]. Speed did not change for this small program; the Performance Book reports 10–20% or more on larger ones ✅[^15].
- `opt-level = "z"` produced a larger binary than `3` and a 3.4× slower loop; the Cargo Book warns that `"s"` and `"z"` are not necessarily smaller ✅[^1] ✅[^2]. The size win of `small` came from stripping symbols and fat LTO, not from `"z"`.
- The 6.4 MB `dev` binary is mostly debug info: it has nine `.debug_*` sections, `release` has none ✅[^1].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `cargo build --workspace` passes, `cargo build -p alpha` fails (E0433) | A member relied on a feature another member enabled ✅[^1] | Unification covers only the selected packages ✅[^7] |
| `[profile.release]` in a member manifest | Ignored, with a warning naming the root manifest ✅[^1] | Profiles are read only from the workspace root ✅[^2] ✅[^5] |
| Release binary has no debug sections although `strip` defaults to `"none"` | Cargo passed `-C strip=debuginfo` ✅[^1] | Since Rust 1.77, profiles that emit no debuginfo default to `strip = "debuginfo"` ✅[^16] |
| `opt-level = "z"` binary bigger than `opt-level = 3` | 575,104 vs 549,664 bytes in the lab ✅[^1] | The size levels are not necessarily smaller ✅[^2] |
| `lto = false` | Still runs thin LTO across the crate's own codegen units; none at `opt-level = 0` or `codegen-units = 1` ✅[^2] | Use `"off"` to disable LTO |
| `version = "0.3"` dependency | `0.4.0` is never picked ✅[^3] | For `0.x`, the minor number is the breaking one |
| Two crates require `=0.4.11` and `=0.4.8` | Resolution error ✅[^4] | One version per compatible range |
| `rand 0.6` and `rand 0.7` in one build | Both compile; their types are distinct ✅[^4] | Incompatible ranges coexist; `cargo tree -d` finds them |
| Dependency declared but unused | `warning: unused dependency` ✅[^1] | Cargo lint `unused_dependencies`, warn by default ✅[^17] |
| `build.rs` without `rerun-if-*` | Reruns when any package file changes ✅[^8] | Print `cargo::rerun-if-changed=build.rs` to rerun only when it changes ✅[^8] |
| `cargo::warning` with `-q` on the first build | Not shown; a later no-op build replayed `warning: stamp@0.3.1: build script ran for profile debug` ✅[^1] | Warnings show for path dependencies; `-vv` shows all ✅[^8] |
| Feature named `no_std` that removes code | Breaks crates that need std once unified | Features must be additive ✅[^7] |
| Path-only dependency | The crate cannot be published to crates.io ✅[^3] | Add a `version` next to `path` |
| `cargo tally --top 3` with an executable `cargo-tally` on `PATH` | Cargo runs it: the script received `tally --top 3`, and `cargo --list` listed `tally` ✅[^1] | Cargo turns `cargo <name>` into a call to an external tool `cargo-<name>`, passing the subcommand name before the remaining arguments ✅[^18] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `codegen-units = 1` | May produce faster code ✅[^10] | Slower builds ✅[^10]; no speed change in the lab's loop ✅[^1] |
| `lto = "fat"` | Smallest code across crates (−18% in the lab) ✅[^1] | Longest link step; `"thin"` is much faster to run ✅[^2] |
| `panic = "abort"` | Smaller binary ✅[^15] | The process terminates on panic, with no unwinding ✅[^10] |
| `strip = "symbols"` | Smaller binary ✅[^1] | Unreadable backtraces and profiles ✅[^10] |
| One workspace, one `Cargo.lock` | All members agree on versions; one build cache ✅[^6] | Feature unification can hide missing features ✅[^1] |
| Exact `=` requirements | Reproducible without a lock file | Conflicts with any other `=` in the same range ✅[^4] |

## Takeaways
- Build and test each workspace member alone in CI (`cargo build -p <member>`), not only `--workspace`, to catch features borrowed through unification. [rule-candidate]
- Keep every feature additive; never name one after what it disables. [rule-candidate]
- Put all `[profile.*]` tables in the workspace root manifest. [rule-candidate]
- For a smaller binary, try `lto = "fat"` and `strip` first; measure `opt-level = "s"`/`"z"` before keeping them.
- Measure speed only on `release` (or a profile inheriting it); `dev` timings say nothing about production.
- Emit `cargo::rerun-if-changed` in every build script. [rule-candidate]
- Run `cargo package --list` before the first `cargo publish`: a published version is permanent.

## Verification status
- Verified: 84 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `linux/lab-setup.md` — the Rust 1.100.0 lab (`rustlab:1`) where every behaviour marked with this note ran on 2026-11-24. [^1]
- [Profiles](https://doc.rust-lang.org/cargo/reference/profiles.html) — The Cargo Book, living. Backs: default `dev`/`release`/`test`/`bench` settings, `lto` values, custom profiles, overrides, root-only profiles. [^2]
- [Specifying Dependencies](https://doc.rust-lang.org/cargo/reference/specifying-dependencies.html) — The Cargo Book, living. Backs: caret, tilde, wildcard and comparison requirements, path dependencies and publishing. [^3]
- [Dependency Resolution](https://doc.rust-lang.org/cargo/reference/resolver.html) — The Cargo Book, living. Backs: highest compatible version, lock-file priority, duplicates, resolver versions, feature resolver 2. [^4]
- [Workspaces](https://doc.rust-lang.org/cargo/reference/workspaces.html) — The Cargo Book, living. Backs: shared lock file and target directory, root-only tables, virtual workspace `resolver`, inheritance, default members. [^5]
- [Cargo Workspaces](https://doc.rust-lang.org/book/ch14-03-cargo-workspaces.html) — The Rust Programming Language, living. Backs: one `Cargo.lock` and one `target/` and why. [^6]
- [Features](https://doc.rust-lang.org/cargo/reference/features.html) — The Cargo Book, living. Backs: `[features]`, `default`, unification, additivity, resolver 2 exceptions. [^7]
- [Build Scripts](https://doc.rust-lang.org/cargo/reference/build-scripts.html) — The Cargo Book, living. Backs: when `build.rs` runs, `cargo::` instructions, rerun rules, `OUT_DIR`, warnings. [^8]
- [Environment Variables](https://doc.rust-lang.org/cargo/reference/environment-variables.html) — The Cargo Book, living. Backs: `OUT_DIR` and `PROFILE` for build scripts. [^9]
- [Codegen Options](https://doc.rust-lang.org/rustc/codegen-options/index.html) — The rustc book, living. Backs: `codegen-units`, `opt-level`, `panic`, `strip` effects. [^10]
- [cargo install](https://doc.rust-lang.org/cargo/commands/cargo-install.html) — The Cargo Book, living. Backs: install root precedence, `--path`, release profile. [^11]
- [Installing Binaries with cargo install](https://doc.rust-lang.org/book/ch14-04-installing-binaries.html) — The Rust Programming Language, living. Backs: binary targets only, `$HOME/.cargo/bin`, `PATH`. [^12]
- [Publishing a Crate to Crates.io](https://doc.rust-lang.org/book/ch14-02-publishing-to-crates-io.html) — The Rust Programming Language, living. Backs: required metadata, permanence, yanking. [^13]
- [Publishing on crates.io](https://doc.rust-lang.org/cargo/reference/publishing.html) — The Cargo Book, living. Backs: `cargo package --list`, `--dry-run`, permanence, yank. [^14]
- [Build Configuration](https://nnethercote.github.io/perf-book/build-configuration.html) — Nicholas Nethercote and others, The Rust Performance Book, living. Backs: release 10–100× faster, LTO 10–20%, size options. [^15]
- [Announcing Rust 1.77.0](https://blog.rust-lang.org/2024/03/21/Rust-1.77.0/) — The Rust Release Team, Rust Blog, 2024. Backs: `strip = "debuginfo"` default when no debuginfo is emitted. [^16]
- [Lints](https://doc.rust-lang.org/cargo/reference/lints.html) — The Cargo Book, living. Backs: `unused_dependencies` lint, warn by default. [^17]
- [Customizing Builds with Release Profiles](https://doc.rust-lang.org/book/ch14-01-release-profiles.html) — The Rust Programming Language, living. Background: `dev` and `release` opt-levels and overriding them.
- [External tools](https://doc.rust-lang.org/cargo/reference/external-tools.html) — The Cargo Book, living. Backs: custom subcommands `cargo-<name>` found on `PATH`, and the order of their arguments. [^18]
- [Extending Cargo with Custom Commands](https://doc.rust-lang.org/book/ch14-05-extending-cargo.html) — The Rust Programming Language, living. Background: custom subcommands and `cargo --list`.

## Related
- `rust/fundamentals/toolchain-cargo-and-editions.md` — `Cargo.toml`, `Cargo.lock` and the first build.
- `rust/project-structure/packages-crates-and-modules.md` — the crates inside each package.
- `rust/performance/compiler-pipeline-and-compile-times.md` — build-time cost of these settings.
- `rust/performance/zero-cost-abstractions-and-optimization.md` — what to optimize once the profile is right.
- `versioning/semantic-versioning.md` — the compatibility promise behind caret requirements.
