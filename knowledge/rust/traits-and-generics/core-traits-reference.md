---
schema: knowledge-doc/v1
type: reference
topic: rust/traits-and-generics
status: verified
applies-to: ["Rust 1.100.0", "edition 2024"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [rust, std, traits, derive, clone, copy, eq, ord, hash, from, into, asref, borrow, deref, drop, iterator, send, sync]
---

# Core standard-library traits: catalog

## Summary
**TL;DR:** One table per question: what each everyday standard trait means, whether `#[derive]` can produce it, the rules ("laws") an implementation must keep, and which doc explains it in depth. Only `Debug`, `PartialEq`, `Eq`, `PartialOrd`, `Ord`, `Clone`, `Copy`, `Hash` and `Default` derive; the marker traits `Send`, `Sync` and `Unpin` are implemented automatically; the rest are written by hand.
**Use this when:** deciding which traits a new type should implement or derive, checking a trait's contract before writing an impl, picking between `From`, `AsRef`, `Borrow`, `ToOwned` and `Deref`, or decoding a derive error (E0184, E0204, E0277).
**Not this doc:** how traits, bounds and derive bounds work → `rust/traits-and-generics/generics-and-traits.md`; `Sized`, auto traits and `!` in depth → `rust/traits-and-generics/advanced-traits-and-type-system.md`; which traits a public type should implement and naming conventions → `rust/design-patterns/idioms-and-api-guidelines.md`.

## Scope
Traits from `std::clone`, `std::marker`, `std::fmt`, `std::default`, `std::cmp`, `std::hash`, `std::convert`, `std::borrow`, `std::ops`, `std::iter` and `std::str`, as documented for Rust 1.100.0 (edition 2024). Derive results and error codes were reproduced in the lab. Operator traits other than `Deref` and the call traits (`Add`, `Index`, …) are covered in `rust/traits-and-generics/advanced-traits-and-type-system.md`; `Error` is covered in `rust/errors/error-types-thiserror-and-anyhow.md`.

## Catalog

**Traits: meaning, derive, laws, owner**

| Trait | Meaning | Derive | Laws and rules | Owning doc |
|---|---|---|---|---|
| `Clone` | Explicit duplicate; may be expensive ✅[^3] | Yes, when all fields are `Clone`; adds `T: Clone` on type parameters ✅[^3] | For a `Copy` type, `y.clone()` must equal `*y` ✅[^3] | `rust/ownership/ownership-moves-and-drop.md` |
| `Copy` | Implicit bitwise copy on assignment; not overloadable ✅[^4] | Yes, together with `Clone` ✅[^2] ✅[^4] | `Clone` is a supertrait; every field `Copy`; no `Drop` impl; `&mut T` is never `Copy` ✅[^4] ✅[^27] | `rust/ownership/ownership-moves-and-drop.md` |
| `Debug` | Programmer-facing `{:?}`, pretty `{:#?}` ✅[^5] | Yes, when all fields are `Debug` ✅[^5] | Derived and std formats are not stable across releases ✅[^5] | `rust/data-modeling/structs-and-methods.md` |
| `Display` | User-facing `{}` ✅[^6] | No ✅[^2] ✅[^6] | Gives `to_string` through the blanket `ToString`; implement `Display`, not `ToString` ✅[^6] | this catalog |
| `Default` | A useful default value ✅[^7] | Yes: each field's default; an enum marks one unit variant `#[default]` ✅[^7] | Enables `..Default::default()` in struct literals ✅[^7] | `rust/design-patterns/idioms-and-api-guidelines.md` |
| `PartialEq` | `==` and `!=`, a partial equivalence ✅[^8] | Yes: equal when every field is equal; enums also need the same variant ✅[^8] | Symmetric and transitive; keep the default `ne` ✅[^8] | this catalog |
| `Eq` | Adds reflexivity (`a == a`); no methods ✅[^9] | Yes, when all fields are `Eq` ✅[^9] | Needs `PartialEq`; floats are not `Eq` because `NaN != NaN` ✅[^9] ✅[^2] | this catalog |
| `PartialOrd` | `<`, `>`, `partial_cmp` returning `Option<Ordering>` ✅[^10] | Yes: structs compare fields top to bottom; enums by discriminant, which defaults to declaration order ✅[^10] ✅[^2] | Agrees with `PartialEq`; transitive; dual (`a < b` iff `b > a`); `NaN.partial_cmp(&1.0)` is `None` ✅[^10] | this catalog |
| `Ord` | Total order, `cmp` ✅[^11] | Yes, same order as `PartialOrd` ✅[^11] | `partial_cmp(a, b) == Some(cmp(a, b))`; derive all four comparison traits or write all four; breaking the rules is a logic error, never UB (undefined behaviour) ✅[^11] | this catalog |
| `Hash` | Feeds a value to a `Hasher` ✅[^12] | Yes: combines the fields' hashes ✅[^12] | `k1 == k2` implies equal hashes; written data must be prefix-free ✅[^12] | `rust/collections/vec-hashmap-and-std-collections.md` |
| `From<T>` / `Into<U>` | Infallible, lossless, value-preserving conversion ✅[^13] | No | Implement `From`; `Into` comes from a blanket impl; `From<T> for T` exists; `?` converts errors with `From` ✅[^13] ✅[^30] | `rust/errors/panic-result-and-error-propagation.md` |
| `TryFrom<T>` / `TryInto<U>` | Fallible conversion with an `Error` type ✅[^14] | No | `TryFrom` implies `TryInto`; `TryFrom<T> for T` has error type `Infallible` ✅[^14] | this catalog |
| `AsRef<T>` / `AsMut<T>` | Cheap reference-to-reference conversion ✅[^15] | No | Must not fail; not reflexive; auto-derefs through `&` and `&mut` only ✅[^15] | `rust/design-patterns/idioms-and-api-guidelines.md` |
| `Borrow<T>` / `BorrowMut<T>` | Borrow as `T` with identical `Eq`, `Ord` and `Hash` ✅[^16] | No | `x.borrow() == y.borrow()` iff `x == y`; this is what lets `HashMap<String, _>::get` take `&str` ✅[^16] | `rust/collections/vec-hashmap-and-std-collections.md` |
| `ToOwned` | Owned data from a borrow: a generalised `Clone` ✅[^17] | No; blanket impl for every `T: Clone` ✅[^17] | `type Owned: Borrow<Self>`; `str` → `String`, `[T]` → `Vec<T>`, `Path` → `PathBuf` ✅[^17] | `rust/collections/strings-and-utf-8.md` |
| `Deref` / `DerefMut` | `*v` and deref coercion `&T` → `&U` ✅[^18] | No | Cheap; never fails unexpectedly; for types that behave transparently like the target (smart pointers) ✅[^18] | `rust/smart-pointers/box-deref-and-drop.md` |
| `Drop` | Destructor run when a value is destroyed ✅[^27] | No | `Drop::drop` cannot be called directly (E0040), use `mem::drop`; fields drop in declaration order, locals in reverse; never with `Copy` ✅[^19] | `rust/ownership/ownership-moves-and-drop.md` |
| `Iterator` | `next(&mut self) -> Option<Self::Item>`, plus the provided methods (75 listed in the 1.100 docs, some of them nightly-only) ✅[^20] | No | Adapters such as `map` are lazy ✅[^20] | `rust/closures-and-iterators/iterators.md` |
| `IntoIterator` | Conversion into an iterator; what `for` loops use ✅[^21] | No | Every `Iterator` is `IntoIterator`; std collections implement it for `C`, `&C` and `&mut C` ✅[^21] | `rust/closures-and-iterators/iterators.md` |
| `FromIterator<A>` | Builds a collection from an iterator; `collect` uses it ✅[^22] | No | `Result<V, E>` collects until the first `Err`; `String` collects `char` and `&str`; `HashMap` collects pairs ✅[^22] | `rust/closures-and-iterators/iterators.md` |
| `Extend<A>` | Adds an iterator's items to an existing collection ✅[^23] | No | An existing key's entry is updated ✅[^23] | `rust/collections/vec-hashmap-and-std-collections.md` |
| `FromStr` | Parse from `&str`; used through `str::parse` ✅[^24] | No | `type Err`; no lifetime parameter, so the result cannot borrow from the input ✅[^24] | `rust/collections/strings-and-utf-8.md` |
| `Send` | Safe to transfer to another thread ✅[^25] | Automatic (`unsafe auto trait`) ✅[^25] | `Rc` is not `Send`; a struct is `Send` when all fields are ✅[^25] ✅[^27] | `rust/concurrency/threads-channels-and-locks.md` |
| `Sync` | Safe to share `&T` across threads ✅[^26] | Automatic ✅[^26] | `T: Sync` iff `&T: Send`; `Cell`, `RefCell` and `Rc` are not `Sync` ✅[^26] | `rust/concurrency/threads-channels-and-locks.md` |
| `Sized` | Size known at compile time ✅[^27] | Only the compiler implements it ✅[^27] | Implicit on type parameters except `Self` in traits; `?Sized` relaxes it ✅[^27] | `rust/traits-and-generics/advanced-traits-and-type-system.md` |
| `Unpin` | Does not rely on pinning guarantees ✅[^28] | Automatic (`auto trait`) ✅[^28] | `PhantomPinned` opts a type out ✅[^28] | `rust/async/pin-and-unpin.md` |
| `FnOnce` / `FnMut` / `Fn` | Call by value (maybe once) / repeatedly with mutation / repeatedly without ✅[^29] | Implemented by closures and function pointers ✅[^29] | `Fn` and `FnMut` are subtraits of `FnOnce` ✅[^29] | `rust/closures-and-iterators/closures-and-fn-traits.md` |

**Derive outcomes measured in the lab**

| Attempt | Result |
|---|---|
| `#[derive(Default)] enum Level { #[default] Low, Mid, High }` | `Level::default()` is `Low`; `Low < High` is `true` with derived `Ord` ✅[^1] |
| `#[derive(PartialOrd, Ord)] struct Version { major: u16, minor: u16 }`, then `sort()` | `v0.7`, `v1.2`, `v1.9`: major first, then minor ✅[^1] |
| `#[derive(Clone, Copy)]` plus `impl Drop` | `error[E0184]: the trait `Copy` cannot be implemented for this type; the type has a destructor` ✅[^1] |
| `#[derive(Copy)]` without `Clone` | `error[E0277]: the trait bound `Point: Clone` is not satisfied`, "required by a bound in `Copy`" ✅[^1] |
| `#[derive(Clone, Copy)]` on a struct with a `String` field | `error[E0204]: the trait `Copy` cannot be implemented for this type` ✅[^1] |
| `#[derive(PartialEq, Eq)]` on a struct with an `f64` field | `error[E0277]: the trait bound `f64: Eq` is not satisfied` ✅[^1] |
| `vec![2.0, 1.0].sort()` | `error[E0277]: the trait bound `{float}: Ord` is not satisfied`; `sort_by(f64::total_cmp)` gives `[-1.0, 0.0, 2.5]` ✅[^1] |
| `#[derive(Display)]` | "cannot find derive macro `Display`", with the note "`Display` is a trait, not a derive macro" ✅[^1] |
| `#[derive(Clone)]` on `Shared<T> { inner: Rc<T> }` | Not `Clone` for `T = NoClone` (E0599); see `rust/traits-and-generics/generics-and-traits.md` ✅[^1] |

**Conversions: which trait for which job**

| Need | Trait | Can fail | Lab call → result |
|---|---|---|---|
| Owned value to another owned value | `From` / `Into` | No | `let v: Version = 3u16.into()` → `v3.0` ✅[^1] |
| Same, but the input may not fit | `TryFrom` / `TryInto` | Yes | `u8::try_from(300i32)` → `Err(TryFromIntError(PosOverflow))`; `u8::try_from(200i32)` → `Ok(200)` ✅[^1] |
| Text to value | `FromStr` (`str::parse`) | Yes | `"2.5".parse::<Version>()` → `Ok(Version { major: 2, minor: 5 })`; `"2x"` → `Err("no dot")` ✅[^1] |
| Accept "anything viewable as `str`" | `AsRef<str>` | No | `shout("abc")`, `shout(String::from("def"))` → `ABC DEF` ✅[^1] |
| Map lookup by a borrowed key | `Borrow<str>` | No | `HashMap<String, u32>::get("apples")` → `Some(3)` ✅[^1] |
| Owned copy of borrowed data | `ToOwned` | No | `[1, 2][..].to_owned()` → `[1, 2]` (a `Vec`) ✅[^1] |
| Call the target's methods through a wrapper | `Deref` | Must not | `String` reaching `str::len` → `5` ✅[^1] |
| Collect or append | `FromIterator` / `Extend` | No | `['o', 'k']` → `"ok"`; `["1", "2", "x"]` parsed into `Result<Vec<u8>, _>` → `Err`; `vec![1].extend([2, 3])` → `[1, 2, 3]` ✅[^1] |

## Lookup notes
- Standard-library `Debug` output is not a stable format ✅[^5]: in 1.100 the overflow error prints as `TryFromIntError(PosOverflow)` ✅[^1]. Never parse `{:?}` output.
- Enum variants with explicit discriminants order by discriminant, not by position in the source ✅[^10].
- A type whose `Eq` or `Hash` differs from its inner type's (for example a case-insensitive string) may implement `AsRef<str>` but must not implement `Borrow<str>` ✅[^16].
- `Infallible`, the error type of `TryFrom<T> for T`, is an alias for the never type `!` since Rust 1.100; see `rust/traits-and-generics/advanced-traits-and-type-system.md`.
- The Rust API Guidelines list the traits a public type should implement eagerly: `Copy`, `Clone`, `Eq`, `PartialEq`, `Ord`, `PartialOrd`, `Hash`, `Debug`, `Display`, `Default` ✅[^30].
- Locals were dropped in reverse declaration order in the lab (`drop b` before `drop a`) ✅[^1].

## Takeaways
- Derive `Debug` on every type; add `Clone`, `PartialEq`, `Eq`, `Hash`, `Default` whenever their laws hold. [rule-candidate]
- Implement `From` and `TryFrom`, never `Into` or `TryInto` directly. [rule-candidate]
- Implement `Ord` and `PartialOrd` together, deriving all four comparison traits or writing all four by hand. [rule-candidate]
- Keep `Hash` consistent with `Eq`: when `PartialEq` is written by hand, write `Hash` by hand from the same fields. [rule-candidate]
- Sort floats with `total_cmp`; floats have no `Ord`.

## Verification status
- Verified: 100 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `linux/lab-setup.md` — the Rust 1.100.0 lab (`rustlab:1`) where every behaviour marked with this note ran on 2026-11-24. [^1]
- [Appendix C: Derivable Traits](https://doc.rust-lang.org/book/appendix-03-derivable-traits.html) — The Rust Programming Language (Klabnik, Nichols, Krycho and the Rust community), living. Backs: the derivable std traits, `Display` not derivable, derived ordering, `Copy` needs `Clone`, `Eq` needs `PartialEq`. [^2]
- [Trait `Clone`](https://doc.rust-lang.org/std/clone/trait.Clone.html) — Rust standard library docs, living. Backs: `Clone` row. [^3]
- [Trait `Copy`](https://doc.rust-lang.org/std/marker/trait.Copy.html) — Rust standard library docs, living. Backs: `Copy` row. [^4]
- [Trait `Debug`](https://doc.rust-lang.org/std/fmt/trait.Debug.html) — Rust standard library docs, living. Backs: `Debug` row, format instability. [^5]
- [Trait `Display`](https://doc.rust-lang.org/std/fmt/trait.Display.html) — Rust standard library docs, living. Backs: `Display` row. [^6]
- [Trait `Default`](https://doc.rust-lang.org/std/default/trait.Default.html) — Rust standard library docs, living. Backs: `Default` row. [^7]
- [Trait `PartialEq`](https://doc.rust-lang.org/std/cmp/trait.PartialEq.html) — Rust standard library docs, living. Backs: `PartialEq` row. [^8]
- [Trait `Eq`](https://doc.rust-lang.org/std/cmp/trait.Eq.html) — Rust standard library docs, living. Backs: `Eq` row. [^9]
- [Trait `PartialOrd`](https://doc.rust-lang.org/std/cmp/trait.PartialOrd.html) — Rust standard library docs, living. Backs: `PartialOrd` row, discriminant ordering. [^10]
- [Trait `Ord`](https://doc.rust-lang.org/std/cmp/trait.Ord.html) — Rust standard library docs, living. Backs: `Ord` row. [^11]
- [Trait `Hash`](https://doc.rust-lang.org/std/hash/trait.Hash.html) — Rust standard library docs, living. Backs: `Hash` row. [^12]
- [Trait `From`](https://doc.rust-lang.org/std/convert/trait.From.html) — Rust standard library docs, living. Backs: `From`/`Into` row. [^13]
- [Trait `TryFrom`](https://doc.rust-lang.org/std/convert/trait.TryFrom.html) — Rust standard library docs, living. Backs: `TryFrom`/`TryInto` row. [^14]
- [Trait `AsRef`](https://doc.rust-lang.org/std/convert/trait.AsRef.html) — Rust standard library docs, living. Backs: `AsRef` row. [^15]
- [Trait `Borrow`](https://doc.rust-lang.org/std/borrow/trait.Borrow.html) — Rust standard library docs, living. Backs: `Borrow` row, case-insensitive example. [^16]
- [Trait `ToOwned`](https://doc.rust-lang.org/std/borrow/trait.ToOwned.html) — Rust standard library docs, living. Backs: `ToOwned` row. [^17]
- [Trait `Deref`](https://doc.rust-lang.org/std/ops/trait.Deref.html) — Rust standard library docs, living. Backs: `Deref` row. [^18]
- [Trait `Drop`](https://doc.rust-lang.org/std/ops/trait.Drop.html) — Rust standard library docs, living. Backs: `Drop` row. [^19]
- [Trait `Iterator`](https://doc.rust-lang.org/std/iter/trait.Iterator.html) — Rust standard library docs, living. Backs: `Iterator` row. [^20]
- [Trait `IntoIterator`](https://doc.rust-lang.org/std/iter/trait.IntoIterator.html) — Rust standard library docs, living. Backs: `IntoIterator` row. [^21]
- [Trait `FromIterator`](https://doc.rust-lang.org/std/iter/trait.FromIterator.html) — Rust standard library docs, living. Backs: `FromIterator` row. [^22]
- [Trait `Extend`](https://doc.rust-lang.org/std/iter/trait.Extend.html) — Rust standard library docs, living. Backs: `Extend` row. [^23]
- [Trait `FromStr`](https://doc.rust-lang.org/std/str/trait.FromStr.html) — Rust standard library docs, living. Backs: `FromStr` row. [^24]
- [Trait `Send`](https://doc.rust-lang.org/std/marker/trait.Send.html) — Rust standard library docs, living. Backs: `Send` row. [^25]
- [Trait `Sync`](https://doc.rust-lang.org/std/marker/trait.Sync.html) — Rust standard library docs, living. Backs: `Sync` row. [^26]
- [Special types and traits](https://doc.rust-lang.org/reference/special-types-and-traits.html) — The Rust Reference, living. Backs: `Sized`, auto-trait structural rule, `Copy` and `Drop` exclusion, `Drop` as destructor. [^27]
- [Trait `Unpin`](https://doc.rust-lang.org/std/marker/trait.Unpin.html) — Rust standard library docs, living. Backs: `Unpin` row. [^28]
- [Trait `FnOnce`](https://doc.rust-lang.org/std/ops/trait.FnOnce.html) — Rust standard library docs, living. Backs: `Fn*` row. [^29]
- [Interoperability](https://rust-lang.github.io/api-guidelines/interoperability.html) — Rust API Guidelines, living. Backs: C-COMMON-TRAITS list; implement `From`/`TryFrom`, not `Into`/`TryInto`. [^30]

## Related
- `rust/traits-and-generics/generics-and-traits.md` — derive bounds and coherence.
- `rust/traits-and-generics/advanced-traits-and-type-system.md` — `Sized`, auto traits, `!`, operator traits.
- `rust/design-patterns/idioms-and-api-guidelines.md` — which traits a public type should implement.
- `rust/closures-and-iterators/iterators.md` — the iterator traits in use.
