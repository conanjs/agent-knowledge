---
schema: topic-index/v1
kind: subtopic
topic: rust/collections
last-updated: 2026-11-24
---

# Rust collections and strings

The standard collections and text types, matching chapter 8 of The Rust Programming Language plus the std documentation: `Vec` capacity, growth measured on this build, indexing versus `get`, borrowing while pushing or iterating, removal methods, `HashMap` ownership of keys, the entry API, the randomly seeded SipHash hasher and why iteration order changes between runs, `BTreeMap`, `HashSet`, `VecDeque`, `BinaryHeap` and the std cost table; then `String` versus `&str`, UTF-8 bytes versus `char`s versus graphemes, why integer indexing is absent, slicing panics at non-boundaries, `+` and `format!`, case mapping that changes length, invalid UTF-8 and `Cow<str>`, and the `OsString`, `CString` and `Path` families. Every behaviour ran in Rust 1.100.0 in the lab. Not covered: iterator adapters (see `rust/closures-and-iterators/`), hash-table theory (see `algorithms/data-structures/hash-tables.md`), FFI use of C strings (see `rust/unsafe/ffi-and-c-interop.md`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [vec-hashmap-and-std-collections.md](vec-hashmap-and-std-collections.md) | concept | `Vec` layout and growth (0→4→8… for `u32`), `get` vs indexing, E0502/E0507, `HashMap` entry API and key ownership, random-seeded order across runs, `BTreeMap`, `HashSet`, `VecDeque`, `BinaryHeap`, cost table | verified |
| [strings-and-utf-8.md](strings-and-utf-8.md) | concept | `String` vs `&str`, bytes vs `char`s vs graphemes, E0277 on `s[0]`, the char-boundary slicing panic and `floor_char_boundary`, `+` vs `format!`, case mapping, `from_utf8_lossy` and `Cow<str>`, `OsString`/`CString`/`Path` | verified |

## References
- [The Rust Programming Language](https://doc.rust-lang.org/book/) — Klabnik, Nichols, Krycho and the Rust community, living. Backs: subtopic scope (chapter 8).
- [std::collections](https://doc.rust-lang.org/std/collections/index.html) — Rust standard library docs, living. Backs: collection scope.

## Related
- `rust/index.md` — the Rust topic and its subtopics.
- `rust/ownership/borrowing-references-and-slices.md` — slices and the borrow rules both docs rely on.
- `algorithms/` — data-structure costs across languages.
