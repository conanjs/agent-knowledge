---
schema: knowledge-doc/v1
type: concept
topic: rust/project-structure
status: verified
applies-to: ["Rust 1.100.0", "edition 2024"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [rust, packages, crates, modules, module-tree, visibility, privacy, pub-crate, use, re-exports, path-attribute]
---

# Packages, crates and the module tree

## Summary
**TL;DR:** A **package** is a folder with a `Cargo.toml`; it builds at most one **library crate** and any number of **binary crates**, and each crate is a tree of **modules** that starts at its crate root (`src/lib.rs` or `src/main.rs`). `mod name;` attaches a file to that tree exactly once: it is not an include, and a file nobody declares is never compiled. Items are reached by **paths** (`crate::…`, `self::…`, `super::…`) and are private to their parent module unless marked `pub`; `pub(crate)`, `pub(super)` and `pub(in path)` open them only that far. `use` adds a shortcut in one scope; `pub use` re-exports, so the public path can differ from the file layout. In the lab, outside code reaching a private module failed with E0603, a private field with E0616, a struct literal with private fields with E0451, and re-exporting a `pub(crate)` function with E0364.
**Use this when:** laying out the files of a crate; a path or `use` does not resolve; you hit E0603, E0616, E0451, E0364, E0583 or E0761; you decide what a library's public API is.
**Not this doc:** `cargo new`, `cargo build` and the first program → `rust/fundamentals/toolchain-cargo-and-editions.md`; dependencies, workspaces and features → `rust/project-structure/cargo-workspaces-features-and-profiles.md`; where test modules go → `rust/project-structure/testing.md`; macro scoping and `#[macro_export]` → `rust/macros/declarative-macros.md`; the `pub` API naming conventions → `rust/design-patterns/idioms-and-api-guidelines.md`.

## Problem
A new `src/util.rs` builds fine but its functions "do not exist". A `pub fn` is still unreachable from another crate. A `pub struct` cannot be built outside its module. A `use` written at the top of `lib.rs` does nothing inside a child module. And a library that exposes its folder structure (`mylib::internal::v2::parse`) cannot reorganise its files without breaking every caller. Each of these follows from three rules: the module tree is declared, not discovered; privacy follows the tree; paths and `use` are resolved per scope.

## Mental model
**Analogy:** a crate is an office building. Each module is a department, and departments nest inside departments. A notice pinned in a department can be read there and in every sub-department below it, never by the department above. To read a notice from the street, every door on the corridor to it must be open (`pub`), not only the last one. `use` is a speed-dial entry in one office's phone; `pub use` is a reception desk that forwards outside callers to an inner office, so callers never learn the internal floor plan.

**Artifact:** the lab package `bakery`, its module tree and what it built ✅[^1]:
```text
bakery/Cargo.toml              package "bakery"
src/lib.rs                     root of the library crate `bakery`
├── pub mod shop;          →   src/shop.rs
│   ├── pub mod counter;   →   src/shop/counter.rs
│   └── mod oven;          →   src/shop/oven.rs        (private to `shop`)
├── mod pricing { … }          inline module, private
├── #[path = "extra/legacy_name.rs"] pub mod legacy;
└── pub use shop::counter::sell;   re-export
src/main.rs                    root of the binary crate `bakery`
src/bin/report.rs              root of the binary crate `report`
```
```console
$ cargo build -q && ls target/debug
bakery  build  examples  incremental  libbakery.rlib  report
$ ./target/debug/bakery
rye for 270 cents after 1800 s in the oven
spelt for 270 cents after 1800 s in the oven
loaded through #[path]
```

## How it works
1. **Package and crates.** A crate is the unit the compiler handles at once, even a single file given to `rustc`; a binary crate has `main`, a library crate does not ✅[^2]. A package holds at least one crate, any number of binaries and at most one library ✅[^2] ✅[^10]. By convention `src/main.rs` and `src/lib.rs` are the roots of a binary and a library both named after the package, and each `src/bin/*.rs` is another binary ✅[^2]. In the lab, one package produced `bakery`, `report` and `libbakery.rlib`, and `main.rs` called the library as an outside crate, by the package name: `bakery::sell("rye")` ✅[^1].
2. **The module tree is declared.** The tree is rooted at the implicit module `crate` ✅[^3]. `mod shop;` in a crate root makes the compiler look for the body inline, in `src/shop.rs`, or in `src/shop/mod.rs`; a `mod counter;` inside `src/shop.rs` is looked up under `src/shop/` ✅[^3] ✅[^8]. The file is loaded once and is then reached by its path; `mod` is not an include ✅[^6].
   - A file that no `mod` declares is not compiled: the lab build stayed green with an undeclared `src/orphan.rs` containing `fn broken( {` ✅[^1].
   - A declared module with no file fails with ``error[E0583]: file not found for module `engine` `` ✅[^1].
   - Having both `engine.rs` and `engine/mod.rs` fails with ``error[E0761]: file for module `engine` found at both "engine.rs" and "engine/mod.rs"`` ✅[^1] ✅[^8]. The `engine.rs` form is the current idiom; `mod.rs` is the older style that still works ✅[^6] ✅[^8].
3. **Paths.** An absolute path starts at `crate` (or at an external crate's name); a relative one starts at `self`, `super` or a name in the current module, and `super` means the parent module ✅[^4]. In the lab, `src/shop/counter.rs` used both: `use super::Loaf;` and `use crate::pricing::with_tax;` ✅[^1].
4. **Privacy follows the tree.** Two rules decide every access ✅[^7]:
   - A private item can be used by its own module and that module's descendants.
   - A public item can be used from module `m` only if all of the item's ancestor modules are accessible from `m`.

   So a parent cannot see a child's private items, while a child sees all of its ancestors' items ✅[^4]. Everything is private by default except the variants of a `pub enum` and the items of a `pub trait` ✅[^7]. A `pub struct` keeps each field private until that field is `pub` too ✅[^4]. Lab errors from an outside crate (an example target) ✅[^1]:
   - `bakery::pricing::internal_only()` → ``error[E0603]: module `pricing` is private``, although `internal_only` is `pub`; the library build also warned that it is never used (`dead_code`), since `pub` exports nothing through a private module.
   - `loaf.cost_cents` (a `pub(crate)` field) → ``error[E0616]: field `cost_cents` of struct `Loaf` is private``.
   - `Loaf { name, cost_cents, baked_seconds }` → ``error[E0451]: fields `cost_cents` and `baked_seconds` of struct `Loaf` are private``; outside code must use the public constructor `Loaf::new`.
5. **Scoped visibility.** `pub(crate)` makes an item visible in the whole crate, `pub(super)` in the parent module, `pub(in path)` inside the named ancestor, and `pub(self)` is the same as private ✅[^7]. Since edition 2018 the path in `pub(in …)` must start with `crate`, `self` or `super` ✅[^7]. In the lab, `oven::bake_time` was `pub(super)` and `Loaf::new` in `shop` could call it; `tools::sharpen` was `pub(crate)`, and calling it from outside gave ``error[E0603]: function `sharpen` is private`` ✅[^1]. E0603 is the error index's "a private item was used outside its scope" ✅[^9].
6. **`use` is a per-scope shortcut.** A `use` only applies in the scope where it is written ✅[^5]. In the lab, `use kitchen::boil;` at the crate root did not reach `mod waiter`, and `boil()` there failed with ``error[E0425]: cannot find function `boil` in this scope`` ✅[^1]. The Book's idiom: import a function's parent module (`hosting::add_to_waitlist()`), but structs and enums by their full path; rename clashes with `as`; group with `use std::{cmp::Ordering, io};`; keep globs (`*`) for tests and preludes ✅[^5].
7. **Re-exports.** `pub use` makes an item reachable under a new public path ✅[^5] ✅[^7]. In the lab, `pub use shop::counter::sell;` let `main.rs` call `bakery::sell` as well as `bakery::shop::counter::sell` ✅[^1]. A re-export cannot widen visibility: `pub use pricing::with_tax;` of a `pub(crate)` function failed with ``error[E0364]: `with_tax` is only public within the crate, and cannot be re-exported outside`` ✅[^1].
8. **`#[path]`.** On a `mod` outside any inline module, the path is relative to the directory of the current file ✅[^8]; the lab's `#[path = "extra/legacy_name.rs"] pub mod legacy;` in `src/lib.rs` loaded `src/extra/legacy_name.rs` ✅[^1]. Inside an inline module, the inline module names are added as directories first ✅[^8].

## Worked example
How the compiler resolves `bakery::sell("rye")` written in `src/main.rs` (lab run above) ✅[^1]:

| Step | Path piece | Resolves to | Privacy check |
|---|---|---|---|
| 1 | `bakery` | The library crate of the same package, an external crate seen from `main.rs` | The crate root is always reachable |
| 2 | `bakery::sell` | The re-export `pub use shop::counter::sell;` in `src/lib.rs` | The `pub use` is public; the long path works too, because `shop` and `counter` are `pub` |
| 3 | `shop::counter::sell` | `pub fn sell` in `src/shop/counter.rs` | `shop` and `counter` are `pub mod`, so all ancestors are open |
| 4 | inside `sell`: `Loaf::new` | `src/shop.rs` | `pub fn` on a `pub struct` |
| 5 | inside `new`: `oven::bake_time()` | `src/shop/oven.rs` | `pub(super)`: visible to `shop`, the caller's module |
| 6 | inside `sell`: `with_tax(250)` | the inline `mod pricing` | `pub(crate)`: any module of this crate |
| 7 | output | `rye for 270 cents after 1800 s in the oven` | 250 × 108 / 100 = 270 |

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `pub fn` inside a private module, unused in the crate | `dead_code` warning; outside callers get E0603 on the module ✅[^1] | An ancestor is private, so no outside path reaches it ✅[^7] |
| New `.rs` file never named in a `mod` | Not compiled, even with a syntax error ✅[^1] | The tree is declared from the root ✅[^3] |
| Both `foo.rs` and `foo/mod.rs` | E0761 ✅[^1] | The Reference forbids both ✅[^8] |
| `pub struct` with one private field | Outside code cannot build it with a literal (E0451) or read that field (E0616) ✅[^1] | Fields have their own visibility ✅[^4] |
| `pub enum` | Every variant is public without `pub` ✅[^4] ✅[^7] | Variants inherit the enum's visibility |
| `pub use` of a `pub(crate)` item | E0364 ✅[^1] | A re-export cannot exceed the item's own visibility |
| `use` at the root, item used in a child module | E0425; the compiler suggests importing it there ✅[^1] | `use` is scoped to one module ✅[^5] |
| `pub(in some_mod)` in edition 2024 | Path must start with `crate`, `self` or `super` ✅[^7] | Edition 2018 rule |
| `#[path]` inside `mod inline { … }` | Path gains the inline module's name as a directory ✅[^8] | Inline modules map to directories |
| Binary and library in one package | `main.rs` uses the library by the package name, like any dependency ✅[^1] | They are two crates ✅[^2] |
| Integration tests in `tests/` | See only the `pub` API | Each file is its own crate (`rust/project-structure/testing.md`) |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `foo.rs` plus `foo/child.rs` | Current idiom; distinct file names in an editor ✅[^6] | Module code split between `foo.rs` and the `foo/` folder |
| `foo/mod.rs` | Everything of `foo` in one folder | Many tabs named `mod.rs` ✅[^6] |
| Flat API through `pub use` | Callers write `crate_name::Item`; files can move freely ✅[^5] | Two paths to one item; document the public one |
| `pub(crate)` instead of `pub` for internals | Shared inside the crate, invisible outside ✅[^7] | Integration tests cannot reach it |
| Many small binaries in `src/bin/` | One package, shared library code ✅[^2] | All share one `Cargo.toml` and its dependencies |

## Takeaways
- Declare every new file with `mod`; an undeclared file is silently ignored. [rule-candidate]
- Default to private, use `pub(crate)` for crate-internal sharing, and make `pub` only what callers need. [rule-candidate]
- Re-export the public API at the crate root with `pub use` so the file layout can change without breaking callers.
- Prefer `foo.rs` + `foo/` over `foo/mod.rs` in new code, and never both for one module.
- Keep logic in `src/lib.rs` and a thin `src/main.rs`, so tests and other binaries can use it.

## Verification status
- Verified: 60 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `linux/lab-setup.md` — the Rust 1.100.0 lab (`rustlab:1`) where every behaviour marked with this note ran on 2026-11-24. [^1]
- [Packages and Crates](https://doc.rust-lang.org/book/ch07-01-packages-and-crates.html) — The Rust Programming Language, living. Backs: crate, binary and library crates, package limits, `src/main.rs`, `src/lib.rs`, `src/bin/`. [^2]
- [Control Scope and Privacy with Modules](https://doc.rust-lang.org/book/ch07-02-defining-modules-to-control-scope-and-privacy.html) — The Rust Programming Language, living. Backs: where `mod` looks for code, the implicit `crate` root. [^3]
- [Paths for Referring to an Item in the Module Tree](https://doc.rust-lang.org/book/ch07-03-paths-for-referring-to-an-item-in-the-module-tree.html) — The Rust Programming Language, living. Backs: absolute and relative paths, `super`, parent/child privacy, struct fields, enum variants. [^4]
- [Bringing Paths Into Scope with the use Keyword](https://doc.rust-lang.org/book/ch07-04-bringing-paths-into-scope-with-the-use-keyword.html) — The Rust Programming Language, living. Backs: `use` scope, idioms, `as`, nested paths, globs, `pub use`. [^5]
- [Separating Modules into Different Files](https://doc.rust-lang.org/book/ch07-05-separating-modules-into-different-files.html) — The Rust Programming Language, living. Backs: `mod` is not an include, the two file styles. [^6]
- [Visibility and privacy](https://doc.rust-lang.org/reference/visibility-and-privacy.html) — The Rust Reference, living. Backs: the two privacy rules, defaults, `pub(crate)`/`pub(super)`/`pub(in path)`/`pub(self)`, the edition-2018 path rule, re-exports. [^7]
- [Modules](https://doc.rust-lang.org/reference/items/modules.html) — The Rust Reference, living. Backs: module file names, `mod.rs` versus non-`mod.rs` files, `#[path]` resolution, both files forbidden. [^8]
- [E0603](https://doc.rust-lang.org/error_codes/E0603.html) — Rust error codes index, living. Backs: meaning of E0603. [^9]
- [Cargo Targets](https://doc.rust-lang.org/cargo/reference/cargo-targets.html) — The Cargo Book, living. Backs: one library target per package, target kinds. [^10]
- [Packages, Crates, and Modules](https://doc.rust-lang.org/book/ch07-00-managing-growing-projects-with-packages-crates-and-modules.html) — The Rust Programming Language, living. Background: the chapter's overview of the module system.

## Related
- `rust/fundamentals/toolchain-cargo-and-editions.md` — creating and building a package.
- `rust/project-structure/cargo-workspaces-features-and-profiles.md` — several packages in one workspace.
- `rust/project-structure/testing.md` — unit test modules and integration-test crates.
- `rust/design-patterns/idioms-and-api-guidelines.md` — designing the public API you re-export.
- `code-documentation/doc-comments.md` — documenting the public items.
