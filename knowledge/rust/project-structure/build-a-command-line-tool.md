---
schema: knowledge-doc/v1
type: how-to
topic: rust/project-structure
status: verified
applies-to: ["Rust 1.100.0", "edition 2024", "Linux or macOS shell"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [rust, cli, command-line, grep, args, env-var, stderr, exit-code, exitcode, broken-pipe, integration-test, cargo-install]
---

# Build a grep-like command-line tool in Rust

## Summary
**TL;DR:** Build `seek`, a small grep: `seek [-i] PATTERN PATH` prints every matching line with its line number. The library (`src/lib.rs`) holds `Config`, `search` and `run`, so tests can call them; `main` only parses, calls `run` and maps the outcome to an exit code: 0 when a line matched, 1 when none did, 2 on any error, as POSIX `grep` does. Errors go to stderr with `eprintln!`; `-i` or the variable `SEEK_IGNORE_CASE` turns off case sensitivity; output goes through a locked stdout with `writeln!`, so `seek … | head -1` ends cleanly, where a `println!` loop panicked with exit code 101.
**Use this when:** starting a small CLI in Rust, or fixing one that mixes errors into stdout, returns the wrong exit code, or panics on a closed pipe.
**Not this doc:** argument-parsing crates (out of scope); `Result`, `?` and `main` returning `Result` → `rust/errors/panic-result-and-error-propagation.md`; error types for libraries versus applications → `rust/errors/error-types-thiserror-and-anyhow.md`; the test kinds used in step 5 → `rust/project-structure/testing.md`; the lifetime on `search` → `rust/ownership/lifetimes.md`.

## Goal & prerequisites
**End state:** a binary `seek` with these behaviours, each checked in Verify:

| Invocation | stdout | stderr | Exit code |
|---|---|---|---|
| a pattern that matches | `N: line` per match | — | 0 |
| a pattern that does not match | — | — | 1 |
| missing argument, unreadable or non-UTF-8 file | — | `seek: <reason>` | 2 |

The 0/1/2 meaning follows POSIX `grep`: 0 when lines were selected, 1 when none were, above 1 on error ✅[^2].

**Needs:** a Rust toolchain with Cargo (Rust 1.100.0 and edition 2024 were used; see `rust/fundamentals/toolchain-cargo-and-editions.md`), a shell, and no external crates.

## Steps
1. **Create the package.**
   ```console
   $ cargo new seek && cd seek
       Creating binary (application) `seek` package
   ```
   This writes `Cargo.toml` with `edition = "2024"` and `src/main.rs` ✅[^1]. Create an empty `src/lib.rs` next to it: logic in the library and a thin `main` keep the logic testable, which is the Book's split for binary projects ✅[^3].

2. **Write the library: `Config`, `search` and `run`** in `src/lib.rs`:
   ```rust
   use std::error::Error;
   use std::fs;
   use std::io::Write;

   /// What the user asked for, parsed from the command line and the environment.
   #[derive(Debug, PartialEq)]
   pub struct Config {
       pub pattern: String,
       pub path: String,
       pub ignore_case: bool,
   }

   impl Config {
       /// `args` excludes the program name. `env_ignore_case` is true when SEEK_IGNORE_CASE is set.
       pub fn from_args(mut args: impl Iterator<Item = String>, env_ignore_case: bool) -> Result<Config, String> {
           let mut ignore_case = env_ignore_case;
           let mut first = args.next().ok_or("missing PATTERN")?;
           if first == "-i" {
               ignore_case = true;
               first = args.next().ok_or("missing PATTERN")?;
           }
           let path = args.next().ok_or("missing PATH")?;
           if let Some(extra) = args.next() {
               return Err(format!("unexpected argument '{extra}'"));
           }
           Ok(Config { pattern: first, path, ignore_case })
       }
   }

   /// Returns (line number, line) for every line containing `pattern`.
   pub fn search<'t>(pattern: &str, text: &'t str, ignore_case: bool) -> Vec<(usize, &'t str)> {
       let needle = if ignore_case { pattern.to_lowercase() } else { pattern.to_string() };
       text.lines()
           .enumerate()
           .filter(|(_, line)| {
               if ignore_case { line.to_lowercase().contains(&needle) } else { line.contains(&needle) }
           })
           .map(|(i, line)| (i + 1, line))
           .collect()
   }

   /// Prints the matches to `out` and returns how many lines matched.
   pub fn run(config: &Config, out: &mut impl Write) -> Result<usize, Box<dyn Error>> {
       let text = fs::read_to_string(&config.path)
           .map_err(|e| format!("cannot read '{}': {e}", config.path))?;
       let matches = search(&config.pattern, &text, config.ignore_case);
       for (number, line) in &matches {
           writeln!(out, "{number}: {line}")?;
       }
       Ok(matches.len())
   }
   ```
   - `from_args` returns `Err` instead of panicking, as the Book's `Config::build` does, so `main` decides how to report it ✅[^3].
   - `search` borrows its result lines from `text`, so the lifetime `'t` ties the output to `text`, not to `pattern` ✅[^4].
   - `run` takes any `Write`, so tests can pass a `Vec<u8>` and `main` passes stdout; it returns how many lines matched instead of deciding the exit code itself.
   - `fs::read_to_string` returns an error, not a panic, for a missing file or for contents that are not valid UTF-8 ✅[^5].

3. **Add unit tests** at the end of `src/lib.rs`:
   ```rust
   #[cfg(test)]
   mod tests {
       use super::*;

       const POEM: &str = "Rust is fast\nrusty nails\nTrust the borrow checker\n";

       #[test]
       fn case_sensitive_search() {
           assert_eq!(search("Rust", POEM, false), vec![(1, "Rust is fast")]);
       }

       #[test]
       fn case_insensitive_search() {
           assert_eq!(search("rust", POEM, true),
                      vec![(1, "Rust is fast"), (2, "rusty nails"), (3, "Trust the borrow checker")]);
       }

       #[test]
       fn dash_i_turns_on_ignore_case() {
           let args = ["-i", "rust", "poem.txt"].map(String::from).into_iter();
           let config = Config::from_args(args, false).unwrap();
           assert!(config.ignore_case);
       }

       #[test]
       fn missing_path_is_an_error() {
           let args = ["rust"].map(String::from).into_iter();
           assert_eq!(Config::from_args(args, false), Err("missing PATH".to_string()));
       }
   }
   ```
   Writing these first, failing, and then making them pass is the Book's test-driven loop for this chapter ✅[^4].

4. **Write `src/main.rs`:** read the environment and arguments, call `run`, map the result to an exit code.
   ```rust
   use std::env;
   use std::io::{self, ErrorKind};
   use std::process::ExitCode;

   use seek::Config;

   fn main() -> ExitCode {
       let env_ignore_case = env::var_os("SEEK_IGNORE_CASE").is_some();
       let config = match Config::from_args(env::args().skip(1), env_ignore_case) {
           Ok(config) => config,
           Err(message) => {
               eprintln!("seek: {message}\nusage: seek [-i] PATTERN PATH");
               return ExitCode::from(2);
           }
       };
       let mut stdout = io::stdout().lock();
       match seek::run(&config, &mut stdout) {
           Ok(0) => ExitCode::from(1),               // no line matched
           Ok(_) => ExitCode::SUCCESS,               // at least one match
           Err(e) if e.downcast_ref::<io::Error>().is_some_and(|io| io.kind() == ErrorKind::BrokenPipe) => {
               ExitCode::SUCCESS                     // reader (e.g. `head`) closed the pipe early
           }
           Err(e) => {
               eprintln!("seek: {e}");
               ExitCode::from(2)
           }
       }
   }
   ```
   - The first item of `env::args()` is the program name, hence `skip(1)` ✅[^6].
   - `env::var_os` returns `None` when the variable is unset and does not check that its value is valid Unicode; only presence matters here, as with the Book's `IGNORE_CASE` ✅[^7] ✅[^8].
   - `eprintln!` writes to stderr, so `seek … > out.txt` never puts an error message into the file ✅[^9].
   - Returning `ExitCode` from `main` sets the process status while still running destructors, unlike `process::exit`; `ExitCode::from(u8)` builds any code ✅[^10].
   - `println!` panics when writing to stdout fails ✅[^11]; the locked stdout plus `writeln!` (step 2) turns that failure into an `io::Error`, and `main` treats `BrokenPipe` as a normal end.

5. **Add an end-to-end test** in `tests/cli.rs`; Cargo sets `CARGO_BIN_EXE_seek` to the built binary's path in integration tests ✅[^12]:
   ```rust
   use std::process::Command;

   fn seek(args: &[&str]) -> std::process::Output {
       Command::new(env!("CARGO_BIN_EXE_seek")).args(args).output().unwrap()
   }

   #[test]
   fn exit_code_reports_match_no_match_and_error() {
       std::fs::write("target/cli-test.txt", "alpha\nbeta\n").unwrap();
       assert_eq!(seek(&["beta", "target/cli-test.txt"]).status.code(), Some(0));
       assert_eq!(seek(&["gamma", "target/cli-test.txt"]).status.code(), Some(1));
       let missing = seek(&["beta", "target/no-such-file.txt"]);
       assert_eq!(missing.status.code(), Some(2));
       assert!(String::from_utf8_lossy(&missing.stderr).contains("cannot read"));
       assert!(missing.stdout.is_empty());
   }
   ```

6. **Run the tests.**
   ```console
   $ cargo test -q
   test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
   test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
   test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
   test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
   ```
   The four lines are the library's unit tests, the binary's (none), `tests/cli.rs`, and doc tests (none) ✅[^1].

7. **Build an optimized binary, and optionally install it.**
   ```console
   $ cargo build --release            # binary: target/release/seek (548,560 bytes on aarch64)
   $ cargo install --path .
     Installing /usr/local/cargo/bin/seek
      Installed package `seek v0.1.0 (/lab)` (executable `seek`)
   ```
   `cargo install` puts the binary in the `bin/` folder of the install root, `$HOME/.cargo/bin` on a default rustup setup (the lab image's root was `/usr/local/cargo`) ✅[^13] ✅[^1].

## Verify
Create `poem.txt` with three lines (`Rust is fast`, `rusty nails`, `Trust the borrow checker`), then run each check; every output below is from the lab ✅[^1]:

| Command | Expected stdout | Expected stderr | `echo $?` |
|---|---|---|---|
| `seek Rust poem.txt` | `1: Rust is fast` | — | 0 |
| `seek -i rust poem.txt` | `1: Rust is fast` / `2: rusty nails` / `3: Trust the borrow checker` | — | 0 |
| `SEEK_IGNORE_CASE=1 seek RUST poem.txt` | the same three lines | — | 0 |
| `seek python poem.txt` | — | — | 1 |
| `seek Rust` | — | `seek: missing PATH` / `usage: seek [-i] PATTERN PATH` | 2 |
| `seek Rust nope.txt > /dev/null` | — | `seek: cannot read 'nope.txt': No such file or directory (os error 2)` | 2 |
| `seek ok bin.dat` (bytes `\377\376` inside) | — | `seek: cannot read 'bin.dat': stream did not contain valid UTF-8` | 2 |
| `seek Rust big.txt \| head -1` (200,000 matching lines) | `1: line 0 Rust` | — | 0 for `seek` |

The last check is the one a `println!` version fails: the same 200,000 lines written with `println!` and piped to `head -1` printed ``failed printing to stdout: Broken pipe (os error 32)`` from a panic and exited with 101 ✅[^1].

## Troubleshooting
| Symptom | Cause | Fix |
|---|---|---|
| ``error: unexpected argument '-i' found`` from `cargo run -i rust poem.txt` | Cargo parsed `-i` as its own option ✅[^1] | Put the program's arguments after `--`: `cargo run -- -i rust poem.txt` ✅[^6] |
| Panic `failed printing to stdout: Broken pipe (os error 32)`, exit code 101 | `println!` panics when stdout is closed ✅[^11] ✅[^1] | Write with `writeln!` to `io::stdout().lock()` and end quietly on `ErrorKind::BrokenPipe` (step 4) |
| Error text ends up in the output file | Errors printed with `println!` go to stdout ✅[^9] | Use `eprintln!` for every error and usage message |
| `stream did not contain valid UTF-8` | `read_to_string` requires UTF-8 ✅[^5] ✅[^1] | Read bytes with `fs::read` and decide how to treat invalid data (for example `String::from_utf8_lossy`) |
| Panic on an argument that is not valid Unicode | `env::args` panics on such arguments ✅[^6] | Use `env::args_os`, which yields `OsString` ✅[^6] |
| `SEEK_IGNORE_CASE=0` still ignores case | Only the variable's presence is checked ✅[^1] ✅[^8] | Unset the variable, or parse its value if `0` must mean "off" |
| Scripts treat "no match" as a failure | Exit code 1 means "no lines selected", not an error ✅[^2] | Test for exit code 2 (or above 1) to detect errors |
| `env!("CARGO_BIN_EXE_seek")` fails to compile in a unit test | The variable is set only for integration tests and benchmarks ✅[^12] | Keep binary-level tests in `tests/` |
| `seek: command not found` after `cargo install` | The install root's `bin/` is not on `PATH` ✅[^13] | Add `$HOME/.cargo/bin` to `PATH` |

## Rollback
- Remove an installed binary with `cargo uninstall seek`; in the lab it printed `Removing /usr/local/cargo/bin/seek`, after which `which seek` found nothing ✅[^1].
- The package itself is just the `seek/` folder; delete it to undo steps 1–7.

## Takeaways
- Keep `main` to parsing, calling `run` and choosing the exit code; keep logic in `src/lib.rs` so it is unit-testable ✅[^3].
- Send every error and usage message to stderr. [rule-candidate]
- Return distinct exit codes for "found", "not found" and "error" when scripts consume the tool ✅[^2]. [rule-candidate]
- In a tool whose output may be piped, write through a locked stdout and handle `BrokenPipe` instead of using `println!` in a loop. [rule-candidate]
- Test the binary end to end with `CARGO_BIN_EXE_<name>`, checking stdout, stderr and the exit code.

## Verification status
- Verified: 36 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `linux/lab-setup.md` — the Rust 1.100.0 lab (`rustlab:1`) where every behaviour marked with this note ran on 2026-11-24. [^1]
- [grep — search a file for a pattern](https://pubs.opengroup.org/onlinepubs/9799919799/utilities/grep.html) — The Open Group Base Specifications Issue 8 (IEEE Std 1003.1-2024), 2024. Backs: exit status 0, 1 and above 1. [^2]
- [Refactoring to Improve Modularity and Error Handling](https://doc.rust-lang.org/book/ch12-03-improving-error-handling-and-modularity.html) — The Rust Programming Language, living. Backs: `main.rs`/`lib.rs` split, `Config::build` returning `Result`, `run` returning `Result<(), Box<dyn Error>>`. [^3]
- [Adding Functionality with Test Driven Development](https://doc.rust-lang.org/book/ch12-04-testing-the-librarys-functionality.html) — The Rust Programming Language, living. Backs: the test-driven loop, the lifetime tying `search` results to the text. [^4]
- [Function read_to_string](https://doc.rust-lang.org/std/fs/fn.read_to_string.html) — Rust standard library, living. Backs: error on non-UTF-8 contents. [^5]
- [Accepting Command Line Arguments](https://doc.rust-lang.org/book/ch12-01-accepting-command-line-arguments.html) — The Rust Programming Language, living. Backs: first argument is the program name, `cargo run --`, `args` panics on invalid Unicode, `args_os`. [^6]
- [Function var_os](https://doc.rust-lang.org/std/env/fn.var_os.html) — Rust standard library, living. Backs: `None` when unset, no Unicode check. [^7]
- [Working with Environment Variables](https://doc.rust-lang.org/book/ch12-05-working-with-environment-variables.html) — The Rust Programming Language, living. Backs: case switch by presence of a variable. [^8]
- [Redirecting Errors to Standard Error](https://doc.rust-lang.org/book/ch12-06-writing-to-stderr-instead-of-stdout.html) — The Rust Programming Language, living. Backs: `eprintln!` to stderr, redirect check. [^9]
- [Struct ExitCode](https://doc.rust-lang.org/std/process/struct.ExitCode.html) — Rust standard library, living. Backs: returning `ExitCode` from `main`, `From<u8>`, versus `process::exit`. [^10]
- [Macro println](https://doc.rust-lang.org/std/macro.println.html) — Rust standard library, living. Backs: panics if writing to stdout fails. [^11]
- [Environment Variables](https://doc.rust-lang.org/cargo/reference/environment-variables.html) — The Cargo Book, living. Backs: `CARGO_BIN_EXE_<name>` only in integration tests and benchmarks. [^12]
- [Installing Binaries with cargo install](https://doc.rust-lang.org/book/ch14-04-installing-binaries.html) — The Rust Programming Language, living. Backs: install location and `PATH`. [^13]
- [Reading a File](https://doc.rust-lang.org/book/ch12-02-reading-a-file.html) — The Rust Programming Language, living. Background: `fs::read_to_string` in the Book's version of this tool.

## Related
- `rust/project-structure/testing.md` — unit, integration and doc tests.
- `rust/errors/panic-result-and-error-propagation.md` — `?`, `Box<dyn Error>` and when to panic.
- `rust/errors/error-types-thiserror-and-anyhow.md` — richer error types for a growing tool.
- `rust/project-structure/cargo-workspaces-features-and-profiles.md` — `cargo install` and release profiles.
- `error-handling/handle-errors-once.md` — report an error in one place, as `main` does here.
