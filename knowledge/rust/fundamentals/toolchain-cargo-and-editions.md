---
schema: knowledge-doc/v1
type: concept
topic: rust/fundamentals
status: verified
applies-to: ["Rust 1.100.0", "edition 2024", "rustup 1.29.3", "Cargo 1.100.0"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [rust, rustup, cargo, toolchain, edition, prelude, nightly, clippy, rustfmt, cargo-fix]
---

# Toolchain, Cargo and editions

## Summary
**TL;DR:** **rustup** installs and switches **toolchains** (a compiler plus its tools, named by a channel such as `stable`/`beta`/`nightly` or a version such as `1.100.0`). **Cargo** creates a package (`cargo new`), checks, builds and runs it: `Cargo.toml` says what you want, `Cargo.lock` records exactly what was resolved, and the output lands in `target/debug` or `target/release`. Each crate is written in one **edition** (2015, 2018, 2021, 2024): an opt-in set of surface changes, such as new keywords or a bigger prelude, and crates of different editions still link together. `cargo fix --edition` rewrites the code for the next edition, but you change the `edition` field yourself.
**Use this when:** you install Rust or start a project, read a `Cargo.toml`, pick between stable and nightly, see an error that appears in only one edition (`gen` is a reserved keyword, `#![feature]` E0554), or move a crate to edition 2024.
**Not this doc:** dependency versions, workspaces, features and build profiles → `rust/project-structure/cargo-workspaces-features-and-profiles.md`; packages, crates and modules → `rust/project-structure/packages-crates-and-modules.md`; variables, types and control flow → `rust/fundamentals/variables-types-and-control-flow.md`; what the compiler does inside → `rust/performance/compiler-pipeline-and-compile-times.md`.

## Problem
A newcomer meets three tools and three unrelated version numbers at once: rustup 1.29.3, rustc 1.100.0 and edition 2024. Without a model of who does what, the usual surprises look random: the same file compiles in one project and fails in another with "expected identifier, found reserved keyword `gen`"; `#![feature(...)]` works on a colleague's machine and fails with E0554 on yours; `HashMap` needs a `use` line but `Vec` does not; `cargo fix --edition` reports "Migrating Cargo.toml" yet the edition stays the same.

## Mental model
**Analogy:** rustup is a toolbox manager that keeps several labelled toolboxes (toolchains) and hands you the right one for the folder you stand in. Cargo is the foreman: it reads the work order (`Cargo.toml`), writes down the exact parts it used (`Cargo.lock`) and runs the machine (`rustc`). The edition is the dialect the work order is written in: one machine reads every dialect, and parts written in different dialects still fit together.

**Artifact:** a new package in the lab (Rust 1.100.0, aarch64 Linux) ✅[^1]:
```console
$ cargo new greeter
    Creating binary (application) `greeter` package
$ find greeter -type f -not -path '*/.git/*'
greeter/.gitignore
greeter/Cargo.toml
greeter/src/main.rs
$ cat greeter/Cargo.toml
[package]
name = "greeter"
version = "0.1.0"
edition = "2024"

[dependencies]
$ cd greeter && cargo run
     Running `target/debug/greeter`
Hello, world!
```

## How it works
**3 actors:**
- **rustup** — its job: choose the toolchain for this command, via the proxy binaries `cargo`, `rustc`, `rustfmt` … on `PATH`.
- **Cargo** — its job: turn the package description into compiler calls, via `Cargo.toml`, `Cargo.lock` and the `target/` folder.
- **rustc** — its job: compile one crate in one edition, via the command line Cargo builds (`--edition=2024`, `--emit=…`, `-C opt-level=…`).

```
you: cargo build
  │
  ▼
[rustup proxy, local]  /usr/local/cargo/bin/cargo -> rustup
  │  picks toolchain: +name > RUSTUP_TOOLCHAIN > rustup override
  │                   > rust-toolchain.toml > default
  ▼
[Cargo, local]  reads Cargo.toml (name, version, edition, [dependencies])
  │  ═══ network boundary: only if a dependency is not in the local cache ═══
  │  writes Cargo.lock (first build), chooses profile dev | release
  ▼
[rustc, local]  rustc --crate-name greeter --edition=2024 src/main.rs
  │             --emit=dep-info,link   (check: --emit=dep-info,metadata)
  ▼
target/debug/greeter   or   target/release/greeter
```

1. **rustup (local).**
   - The `cargo` you type is not Cargo itself: in the lab, `/usr/local/cargo/bin/cargo`, `rustc`, `rustfmt`, `cargo-clippy` and the others are symbolic links to the `rustup` binary ✅[^1]. The rustup book calls rustup a toolchain multiplexer and these wrappers proxies ✅[^9] ✅[^14].
   - It picks the toolchain by the first rule that applies: `cargo +nightly`, then the `RUSTUP_TOOLCHAIN` variable, then a directory override (`rustup override set`), then a `rust-toolchain.toml` file found by walking up from the current folder, then the default ✅[^13]. In the lab, a folder holding `rust-toolchain.toml` with `channel = "nightly"` made `rustc --version` print `1.102.0-nightly`, and `rustup show active-toolchain` named the file as the reason ✅[^1].
2. **Cargo (local).**
   - Reads `[package]` (`name`, `version`, `edition`) and `[dependencies]` from `Cargo.toml` ✅[^4].
   - On the first build it writes `Cargo.lock`, the exact versions it resolved; in the lab its header line reads `version = 4` ✅[^1] ✅[^15]. `Cargo.toml` is written by you, `Cargo.lock` is maintained by Cargo and not edited by hand; when in doubt, commit it ✅[^15]. `cargo update` re-resolves within the ranges in `Cargo.toml` ✅[^5].
   - Network boundary: only fetching a dependency that is not cached leaves the machine. Version ranges and resolution belong to `rust/project-structure/cargo-workspaces-features-and-profiles.md`.
3. **Cargo → rustc.** `cargo build -v` shows the real call: `rustc --crate-name greeter --edition=2024 src/main.rs … --emit=dep-info,link -C debuginfo=2`. `cargo check` runs the same call with `--emit=dep-info,metadata`, so no executable is produced, and `--release` adds `-C opt-level=3` ✅[^1]. The Cargo book describes `check` as compiling without the final code-generation step ✅[^17].
4. **rustc (local).** It parses the crate in its edition, puts that edition's prelude in scope (for 2024, `std::prelude::rust_2024`) and writes the binary to `target/debug/` or `target/release/` ✅[^4] ✅[^30]. In the lab the hello-world binary was 4,586,200 bytes in debug and 468,656 bytes in release (aarch64, sizes are machine-specific) ✅[^1].

### Channels, toolchains and components
- Rust ships on three channels: **stable** every six weeks, **beta** (the next stable), and **nightly** every night ✅[^10] ✅[^8].
- A toolchain name is `<channel>[-<date>][-<host>]`, where the channel may also be a version ✅[^11]. The official Docker image installs a versioned toolchain, so the lab's default is `1.100.0-aarch64-unknown-linux-gnu`, not `stable` ✅[^1].
- A **component** is a part of a toolchain: `rustc` and `cargo` are required; `rustfmt`, `clippy`, `rust-src`, `miri` and `rust-analyzer` are optional (`rustup component add …`) ✅[^12]. The lab's stable toolchain lists cargo, clippy, rust-std (three targets), rustc and rustfmt ✅[^1].
- `rustup update` updates installed toolchains; `rustup doc` opens the offline documentation ✅[^2].

### Editions
An edition changes how the compiler reads a crate's source; it does not split the ecosystem. Editions are opt-in per crate, and crates of different editions must interoperate ✅[^20] ✅[^7]. A missing `edition` key means 2015 ✅[^19] ✅[^22], and `cargo new` writes `edition = "2024"` ✅[^16] ✅[^1].

| Edition | Stable since | One change measured in the lab |
|---|---|---|
| 2015 | 1.0 ✅[^22] | `[10, 20, 30].into_iter()` yields `&i32`, with a warning that 2021 will change it ✅[^1] |
| 2018 | 1.31.0 ✅[^23] | same as 2015 for arrays; `async` becomes a keyword ✅[^20]; `u8::try_from(300)` fails with E0599 because `TryFrom` is not in the prelude ✅[^1] |
| 2021 | 1.56.0 ✅[^24] | `into_iter()` on an array yields `i32` ✅[^27] ✅[^1]; `TryFrom`, `TryInto`, `FromIterator` join the prelude, so `u8::try_from(300_i32)` gives `Err(TryFromIntError(PosOverflow))` ✅[^26] ✅[^1] |
| 2024 | 1.85.0 ✅[^25] ✅[^32] | `let gen = 3;` fails: "expected identifier, found reserved keyword `gen`" ✅[^28] ✅[^1]; `Future` and `IntoFuture` join the prelude ✅[^29]; stricter match ergonomics (`rust/data-modeling/enums-and-pattern-matching.md`); `&` to a `static mut` is a deny-by-default error (`rust/fundamentals/variables-types-and-control-flow.md`) |

### The prelude
The prelude is the set of names every module sees without a `use` line ✅[^31] ✅[^5]. It includes `Vec`, `String`, `Box`, `Option`/`Some`/`None`, `Result`/`Ok`/`Err`, `Clone`, `Copy`, `Iterator`, `drop` and, in current std, `size_of` and `size_of_val` ✅[^31]. `HashMap` is not in it: using it without `use std::collections::HashMap;` fails with E0425 "cannot find type `HashMap` in this scope" ✅[^1]. Primitive types (`bool`, `char`, `str`, the integers and floats) come from a separate, always-present language prelude ✅[^30].

### Anatomy of a first program
```rust
use std::io;                                   // io is not in the prelude

fn main() {                                    // first code that runs
    println!("Temperature in Fahrenheit?");    // `!` = a macro call
    let mut line = String::new();              // associated function, mutable binding
    io::stdin()
        .read_line(&mut line)                  // returns Result<usize, io::Error>
        .expect("could not read stdin");       // crash with this message on Err
    let fahrenheit: f64 = match line.trim().parse() {
        Ok(value) => value,                    // the annotation picks parse::<f64>
        Err(e) => { eprintln!("not a number: {e}"); return; }
    };
    let celsius = (fahrenheit - 32.0) * 5.0 / 9.0;
    println!("{fahrenheit}°F = {celsius:.1}°C");
}
```
`echo 98.6 | cargo run -q` printed `98.6°F = 37.0°C`; `echo abc | cargo run -q` printed `not a number: invalid float literal` ✅[^1]. `main` runs first, `println!` is a macro, and Rust is compiled ahead of time, so the binary runs without Rust installed ✅[^3]. `read_line` returns a `Result`, whose `expect` stops the program on `Err` ✅[^5]. `let`, `mut` and types are explained in `rust/fundamentals/variables-types-and-control-flow.md`; `match` and `Result` in `rust/data-modeling/enums-and-pattern-matching.md`.

### Development tools and nightly
- `cargo fmt` reformats to the community style without changing meaning; `cargo fix` applies the compiler's machine-applicable suggestions; `cargo clippy` adds a larger set of lints; rust-analyzer is the language server for editors ✅[^6]. On one messy file in the lab, `cargo fmt --check` printed the diff, `cargo fix` removed the unused import (1 fix), and clippy reported `needless_range_loop`, `needless_ifs` and `useless_vec` ✅[^1].
- New language features land on nightly behind a feature flag; stable and beta cannot use flags ✅[^8]. On stable, `#![feature(gen_blocks)]` fails with `error[E0554]: #![feature] may not be used on the stable release channel`; on nightly 1.102.0 the same file ran a `gen { … yield n; }` block and printed `[0, 2, 4, 6, 8]` ✅[^1].

## Worked example
Moving a 2021 crate that uses `gen` as a variable name to edition 2024 (lab, `--vcs none`) ✅[^1]:

| Step | Command | Real result |
|---|---|---|
| 1 | `cargo new --vcs none --edition 2021 oldie3`, body `let gen = 41; println!("{}", gen + 1);`, then `cargo run -q` | `42` |
| 2 | `rustc --edition 2024 src/main.rs` | error: expected identifier, found reserved keyword `gen` |
| 3 | `cargo fix --edition --allow-no-vcs` | `Migrating Cargo.toml from 2021 edition to 2024` … `Fixed src/main.rs (2 fixes)`; the code now reads `let r#gen = 41;` |
| 4 | `diff` of `Cargo.toml` before and after | no difference (exit 0): still `edition = "2021"` |
| 5 | set `edition = "2024"` by hand, `cargo run -q` | `42` |

Step 4 matches the Cargo book: `cargo fix --edition` does not update the `edition` field, which must be edited afterwards ✅[^18]. The Edition Guide's order is `cargo update`, `cargo fix --edition`, edit `edition`, `cargo build`/`cargo test`, `cargo fmt` ✅[^21]. `r#gen` is a raw identifier, the escape the `keyword_idents_2024` lint inserts ✅[^28].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `edition` key removed from `Cargo.toml` | Builds, with `warning: Cargo.toml: package.edition is unspecified, defaulting to 2015 while the latest is 2024` ✅[^1] | 2015 is the backward-compatible default ✅[^19] |
| `rustc file.rs` without `--edition` | Compiles as 2015 (the array `into_iter` warning appears) ✅[^1] | Same default as Cargo ✅[^22] |
| `cargo new` inside an existing Git repository | No new `.git` folder (the nested `tally` package had none) ✅[^1] | `--vcs` defaults to `none` inside a repository ✅[^16] ✅[^4] |
| `cargo new` in the lab image, which has no `git` binary | A `.git` folder was still created ✅[^1] | Observed in the lab; Cargo did not need the `git` command |
| `cargo fix` in a folder without version control | `error: no VCS found … pass --allow-no-vcs` ✅[^1] | A guard against unreviewable rewrites; `--allow-dirty` and `--allow-staged` relax the dirty-tree check ✅[^18] |
| `cargo fix --edition` prints "Migrating Cargo.toml" | The `edition` value is unchanged ✅[^1] | The field is edited by hand ✅[^18] |
| `#![feature(x)]` where `x` is already stable | Stable: E0554 with "has been stable since 1.100.0"; nightly: a warning only (seen with `never_type`) ✅[^1] | Flags are refused on stable whatever they name ✅[^8] |
| Crate A on 2015 depends on crate B on 2024 | Works | Editions only change how each crate is parsed ✅[^7] |
| `cargo check` passes but `cargo build` fails | Possible | Some errors appear only in code generation, which `check` skips ✅[^17] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Stable toolchain (default) | Six-weekly releases, backward compatible ✅[^8] | No feature flags |
| Nightly, pinned in `rust-toolchain.toml` | Unstable features; every contributor gets the same compiler ✅[^13] | Features may change or disappear; some nightlies miss optional components ✅[^10] |
| `cargo check` in the edit loop | Faster: no code generation ✅[^17] | No binary; a few late errors only show in `build` |

## Takeaways
- Run `cargo check` while editing, `cargo build --release` for anything you measure or ship.
- Commit `Cargo.lock` unless you have a reason not to; never edit it by hand. [rule-candidate]
- Pin the toolchain with `rust-toolchain.toml` when a project needs nightly or a fixed version. [rule-candidate]
- Upgrade editions with `cargo fix --edition`, then set `edition` yourself and run the tests; commit before, so the rewrite can be reviewed. [rule-candidate]
- Run `cargo fmt` and `cargo clippy` in CI (continuous integration). [rule-candidate]

## Verification status
- Verified: 80 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `linux/lab-setup.md` — the Rust 1.100.0 lab (`rustlab:1`) where every behaviour marked with this note ran on 2026-11-24. [^1]
- [Installation](https://doc.rust-lang.org/book/ch01-01-installation.html) — The Rust Programming Language (Klabnik, Nichols, Krycho and the Rust community), living. Backs: `rustup update`, `rustup doc`. [^2]
- [Hello, World!](https://doc.rust-lang.org/book/ch01-02-hello-world.html) — The Rust Programming Language, living. Backs: `main` runs first, `println!` is a macro, ahead-of-time compilation. [^3]
- [Hello, Cargo!](https://doc.rust-lang.org/book/ch01-03-hello-cargo.html) — The Rust Programming Language, living. Backs: `Cargo.toml` sections, `target/debug` and `target/release`, `cargo new` and Git. [^4]
- [Programming a Guessing Game](https://doc.rust-lang.org/book/ch02-00-guessing-game-tutorial.html) — The Rust Programming Language, living. Backs: the prelude and `use`, `read_line` returning `Result`, `expect`, `cargo update`. [^5]
- [Appendix D: Useful Development Tools](https://doc.rust-lang.org/book/appendix-04-useful-development-tools.html) — The Rust Programming Language, living. Backs: rustfmt, `cargo fix`, Clippy, rust-analyzer. [^6]
- [Appendix E: Editions](https://doc.rust-lang.org/book/appendix-05-editions.html) — The Rust Programming Language, living. Backs: editions are opt-in and interoperate. [^7]
- [Appendix G: How Rust is Made and "Nightly Rust"](https://doc.rust-lang.org/book/appendix-07-nightly-rust.html) — The Rust Programming Language, living. Backs: release channels, six-week train, feature flags only on nightly. [^8]
- [Concepts](https://rust-lang.github.io/rustup/concepts/index.html) — The rustup book, living. Backs: rustup as a toolchain multiplexer, terminology. [^9]
- [Channels](https://rust-lang.github.io/rustup/concepts/channels.html) — The rustup book, living. Backs: stable/beta/nightly cadence, nightlies missing components. [^10]
- [Toolchains](https://rust-lang.github.io/rustup/concepts/toolchains.html) — The rustup book, living. Backs: toolchain name grammar. [^11]
- [Components](https://rust-lang.github.io/rustup/concepts/components.html) — The rustup book, living. Backs: required and optional components. [^12]
- [Overrides](https://rust-lang.github.io/rustup/overrides.html) — The rustup book, living. Backs: toolchain precedence, `rust-toolchain.toml`. [^13]
- [Proxies](https://rust-lang.github.io/rustup/concepts/proxies.html) — The rustup book, living. Backs: `cargo`, `rustc` and others are rustup proxies. [^14]
- [Cargo.toml vs Cargo.lock](https://doc.rust-lang.org/cargo/guide/cargo-toml-vs-cargo-lock.html) — The Cargo Book, living. Backs: who writes each file, committing the lock file. [^15]
- [cargo new](https://doc.rust-lang.org/cargo/commands/cargo-new.html) — The Cargo Book, living. Backs: `--vcs` default, `--edition` default 2024. [^16]
- [cargo check](https://doc.rust-lang.org/cargo/commands/cargo-check.html) — The Cargo Book, living. Backs: no code generation, faster than build, late errors. [^17]
- [cargo fix](https://doc.rust-lang.org/cargo/commands/cargo-fix.html) — The Cargo Book, living. Backs: `--edition` does not edit the manifest; `--allow-no-vcs`, `--allow-dirty`, `--allow-staged`. [^18]
- [The Manifest Format](https://doc.rust-lang.org/cargo/reference/manifest.html) — The Cargo Book, living. Backs: missing `edition` means 2015. [^19]
- [What are editions?](https://doc.rust-lang.org/edition-guide/editions/index.html) — The Rust Edition Guide, living. Backs: opt-in, interoperation, `async` keyword in 2018. [^20]
- [Transitioning an existing project to a new edition](https://doc.rust-lang.org/edition-guide/editions/transitioning-an-existing-project-to-a-new-edition.html) — The Rust Edition Guide, living. Backs: migration steps. [^21]
- [Rust 2015](https://doc.rust-lang.org/edition-guide/rust-2015/index.html) — The Rust Edition Guide, living. Backs: 2015 starts with 1.0 and is the default. [^22]
- [Rust 2018](https://doc.rust-lang.org/edition-guide/rust-2018/index.html) — The Rust Edition Guide, living. Backs: stabilized in 1.31.0. [^23]
- [Rust 2021](https://doc.rust-lang.org/edition-guide/rust-2021/index.html) — The Rust Edition Guide, living. Backs: stabilized in 1.56.0. [^24]
- [Rust 2024](https://doc.rust-lang.org/edition-guide/rust-2024/index.html) — The Rust Edition Guide, living. Backs: stabilized in 1.85.0. [^25]
- [Additions to the prelude](https://doc.rust-lang.org/edition-guide/rust-2021/prelude.html) — The Rust Edition Guide, living. Backs: 2021 prelude adds `TryFrom`, `TryInto`, `FromIterator`. [^26]
- [IntoIterator for arrays](https://doc.rust-lang.org/edition-guide/rust-2021/IntoIterator-for-arrays.html) — The Rust Edition Guide, living. Backs: `array.into_iter()` by value from 2021. [^27]
- [gen keyword](https://doc.rust-lang.org/edition-guide/rust-2024/gen-keyword.html) — The Rust Edition Guide, living. Backs: `gen` reserved, `r#gen` migration. [^28]
- [Changes to the prelude](https://doc.rust-lang.org/edition-guide/rust-2024/prelude.html) — The Rust Edition Guide, living. Backs: 2024 prelude adds `Future`, `IntoFuture`. [^29]
- [Preludes](https://doc.rust-lang.org/reference/names/preludes.html) — The Rust Reference, living. Backs: one std prelude module per edition, the language prelude. [^30]
- [std::prelude](https://doc.rust-lang.org/std/prelude/index.html) — Rust standard library docs 1.100.0, living. Backs: prelude contents. [^31]
- [Announcing Rust 1.85.0 and Rust 2024](https://blog.rust-lang.org/2025/02/20/Rust-1.85.0/) — The Rust Release Team, 2025. Backs: edition 2024 stable. [^32]

## Related
- `rust/fundamentals/variables-types-and-control-flow.md` — the next doc: what goes inside `main`.
- `rust/project-structure/cargo-workspaces-features-and-profiles.md` — dependencies, profiles, workspaces.
- `rust/project-structure/packages-crates-and-modules.md` — what a package and a crate are.
- `versioning/semantic-versioning.md` — the version ranges Cargo resolves.
- `linux/lab-setup.md` — the lab every example ran in.
