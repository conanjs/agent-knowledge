---
schema: knowledge-doc/v1
type: concept
topic: rust/closures-and-iterators
status: verified
applies-to: ["Rust 1.100.0", "edition 2024"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [rust, iterators, iterator-trait, intoiterator, fromiterator, collect, laziness, size-hint, double-ended-iterator, zero-cost-abstractions]
---

# Iterators: the `Iterator` trait, laziness and `collect`

## Summary
**TL;DR:** An iterator is any type with `fn next(&mut self) -> Option<Self::Item>`; every other method (`map`, `filter`, `sum`, `collect` …) is provided on top of it. **Adapters** only build a bigger iterator; nothing runs until a **consumer** (`collect`, `sum`, `count`, a `for` loop) pulls, and then each item travels through the whole chain before the next one starts. `iter()`, `iter_mut()` and `into_iter()` yield `&T`, `&mut T` and `T`; `for x in v` calls `IntoIterator::into_iter(v)` and so moves `v`. `collect` builds any `FromIterator` type, including `Result<Vec<T>, E>`, which stops at the first `Err`. In the lab, an optimized iterator chain compiled to the same machine code as the equivalent indexed loop.
**Use this when:** an adapter chain "does nothing"; a `for` loop moved your `Vec`; `array.into_iter()` yields different types in old and new code; you collect results or options; you write your own iterator; `rev()`, `len()` or `max()` refuses to compile; someone asks whether iterators are slower than loops.
**Not this doc:** the closures passed to adapters, and their `Fn` traits → `rust/closures-and-iterators/closures-and-fn-traits.md`; changing a `Vec` or `HashMap` while iterating it → `rust/collections/vec-hashmap-and-std-collections.md`; `IntoIterator`, `FromIterator` and `Extend` among the other core traits → `rust/traits-and-generics/core-traits-reference.md`; benchmarking method → `rust/performance/zero-cost-abstractions-and-optimization.md`; JavaScript's pull-based generators → `javascript/generators-iterators/generators-and-async-iteration.md`.

## Problem
`v.iter().map(|x| log(x));` prints nothing. `for name in names { … }` makes `names` unusable afterwards. `[1, 2, 3].into_iter()` gave `&i32` in edition 2018 and gives `i32` now. Parsing a list of strings needs "all or nothing" without a hand-written loop. A custom type needs `next` and then wonders why `rev()` or `.len()` do not exist. And code reviewers still rewrite iterator chains into index loops "for speed".

## Mental model
**Analogy:** a bucket brigade where each person passes a bucket only when the next person asks for one. Building the line (adapters) moves no water. When the last person (the consumer) asks, one bucket travels the whole line; only then is the next one requested. If the last person stops asking, the line stops.

**Artifact:** temperatures through `map` then `filter`, in the lab ✅[^1]:
```rust
let temps = vec![12, 25, 31, 8];
temps.iter().map(|t| { println!("convert {t}"); t * 9 / 5 + 32 });   // never runs
let hot: Vec<i32> = temps.iter()
    .map(|t| { println!("  map    {t}"); t * 9 / 5 + 32 })
    .filter(|f| { println!("  filter {f}"); *f > 70 })
    .collect();
```
```console
warning: unused `Map` that must be used        ← compile time, for the first line
  = note: iterators are lazy and do nothing unless consumed
  map    12
  filter 53
  map    25
  filter 77
  map    31
  filter 87
  map    8
  filter 46
hot = [77, 87]
```
The first chain printed nothing; the second interleaves `map` and `filter` per item, not stage by stage.

## How it works
1. **The trait.** `Iterator` has one required method, `next`, returning `Some(item)` until the iteration ends with `None`, and an associated type `Item` ✅[^13] ✅[^2]. The provided methods call `next` internally ✅[^3].
2. **Adapters versus consumers.** An adapter (`map`, `filter`, `take`, `zip`, `rev` …) takes an iterator and returns another; a consumer (`sum`, `count`, `collect`, `fold`, `for_each`) calls `next` until the end and takes ownership of the iterator ✅[^13] ✅[^3]. Creating an iterator does nothing until `next` is called; for side effects, std suggests a `for` loop or `for_each`, not `map` ✅[^3].
3. **Pull, one item at a time.** A consumer pulls an item through every stage before pulling the next (artifact). Consumers stop pulling when they can: `.filter(|t| *t > 20).take(1).count()` ran the `map` closure for `12` and `25` only ✅[^1].
4. **Three ways to iterate a collection.** `iter()` yields `&T`, `iter_mut()` yields `&mut T`, `into_iter()` yields `T` ✅[^3] ✅[^2]. `IntoIterator` is implemented for `Vec<T>`, `&Vec<T>` and `&mut Vec<T>`, so in the lab `(&names).into_iter()` yielded `&alloc::string::String` and `names.into_iter()` yielded `alloc::string::String`, and `for s in &mut scores { *s *= 10 }` turned `[1, 2, 3]` into `[10, 20, 30]` ✅[^1].
5. **The `for` loop.** `for PAT in EXPR { body }` is defined as `match IntoIterator::into_iter(EXPR) { mut iter => loop { match Iterator::next(&mut iter) { Some(val) => …, None => break } } }` ✅[^4]. Because `into_iter` takes `self`, `for n in names` moves `names`; using it afterwards fails with ``error[E0382]: borrow of moved value: `names` ``, and the compiler suggests `for n in &names` ✅[^1].
6. **Arrays and editions.** Arrays implement `IntoIterator` by value in every edition since Rust 1.53 ✅[^5]. In editions 2015 and 2018 the *method-call* form `arr.into_iter()` still resolves to `(&arr).into_iter()` and the `array_into_iter` lint warns ✅[^5]. Measured on the same file: edition 2018 yields `&u8` with that warning, edition 2024 yields `u8` ✅[^1].
7. **`collect` and `FromIterator`.** The requested type, not the iterator, chooses the container: `Vec`, `String` from `char`s, `HashMap` from pairs, and more ✅[^2] ✅[^6]. The turbofish `collect::<Vec<_>>()` helps inference ✅[^2]. `Result<V, E>` implements `FromIterator<Result<A, E>>`: on the first `Err` no further elements are taken and that `Err` is returned ✅[^7]. An `Option<Vec<T>>` collects the same way (`Some(['a', 'b', 'd'])` in the lab), and `sum` over `Result`s also returns the first `Err` ✅[^7] ✅[^1].
8. **Writing your own.** Store the state in a struct and implement `next` ✅[^3]; every adapter then works on it (Worked example). Three optional extras:
   - **`size_hint`** returns `(lower, Option<upper>)`; the default `(0, None)` is always correct. It exists for optimizations such as reserving space, and unsafe code must not trust it ✅[^2].
   - **`ExactSizeIterator`** adds `len()`; implementing it means `size_hint` must return the exact size ✅[^8].
   - **`DoubleEndedIterator`** adds `next_back`, which `rev()` needs; the front and back draw from the same range and stop when they meet ✅[^9]. On a `Vec`, `next()` gave `Some(1)`, `next_back()` gave `Some(5)`, and `rev()` of the rest gave `[4, 3, 2]` ✅[^1].
9. **Taking iterators as arguments.** A function can accept `impl Iterator<Item = String>`, such as `std::env::args()`, and move the `String`s out with `next()` instead of indexing a slice and cloning ✅[^10]. The lab's `parse(["prog", "needle", "hay.txt"].map(String::from).into_iter())` returned `Ok(("needle", "hay.txt"))`, and a missing argument returned `Err("missing pattern")` ✅[^1].
10. **Cost.** The Book calls iterators a zero-cost abstraction and measured its loop and iterator searches within 2 % of each other ✅[^11]. In the lab, `v.iter().map(|&x| x as u64).filter(|x| x % 2 == 0).map(|x| x * x).sum()` and the same logic as an indexed `for i in 0..v.len()` loop compiled at `-C opt-level=3` to 124 instructions each. The two bodies differ only in the order of one `mov`; both are vectorized with NEON, Arm's SIMD (single instruction, multiple data) unit, and neither has a bounds-check branch ✅[^1]. Over 10 million `u32` values, the best of 20 runs was 2.36–2.41 ms for the iterator and 2.37–2.44 ms for the loop (aarch64, 8 CPU cores, Docker, three alternating rounds) ✅[^1].

## Worked example
A custom iterator over the pages of a listing with 23 items and 10 items per page ✅[^1]:
```rust
struct Pages { total_items: u32, per_page: u32, next_page: u32 }

impl Iterator for Pages {
    type Item = (u32, u32);                       // (page number, items on that page)
    fn next(&mut self) -> Option<Self::Item> {
        let start = self.next_page * self.per_page;
        if start >= self.total_items { return None; }
        let n = (self.total_items - start).min(self.per_page);
        self.next_page += 1;
        Some((self.next_page, n))
    }
}
fn pages(total_items: u32, per_page: u32) -> Pages { Pages { total_items, per_page, next_page: 0 } }
```
| Call | `next` calls | Output |
|---|---|---|
| `pages(23, 10).collect::<Vec<_>>()` | 4 (the 4th returns `None`) | `[(1, 10), (2, 10), (3, 3)]` |
| `.filter(\|&(_, n)\| n == 10).count()` | 4 | `2` full pages |
| `.map(\|(_, n)\| n).sum::<u32>()` | 4 | `23` items |
| `.size_hint()` | 0 | `(0, None)`: the default, since `Pages` does not override it |
| `.rev()` | — | does not compile: ``error[E0277]: the trait bound `…: DoubleEndedIterator` is not satisfied`` (shown on a similar type `Up`) |

For comparison, std's own iterators report tighter hints: `(0..10)` gives `(10, Some(10))`, a `filter` over it `(0, Some(10))`, and `(0..10).chain(5..8)` `(13, Some(13))` ✅[^1].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `nums.by_ref().take_while(\|&n\| n < 5)` on `[1, 2, 9, 3, 4]` | Yields `[1, 2]`; the rest is `[3, 4]`: the `9` is gone ✅[^1] | `take_while` must consume the first failing item to test it ✅[^2] |
| `["a", "b", "c"].iter().zip(1..)` | 3 pairs, although `1..` never ends ✅[^1] | `zip` ends when either side returns `None` ✅[^2] |
| `(0..).size_hint()` | `(18446744073709551615, None)`: lower bound `usize::MAX` ✅[^1] | An unbounded range has no upper bound |
| `(0..10).chain(5..8).len()` | ``error[E0599]: no method named `len` found for struct `Chain` `` ✅[^1] | `Chain` is not `ExactSizeIterator`: the combined length might not fit in `usize` ✅[^8] |
| An iterator returns `Some` again after `None` | `Some(1) None Some(3)` unfused; `.fuse()` gives `Some(1) None None` ✅[^1] | `next` may resume after `None`; `fuse` forbids it ✅[^2] |
| `FusedIterator` as a generic bound | Avoid it; call `.fuse()`, which costs nothing on an already fused iterator | std's own advice ✅[^12] |
| `sum` / `max` of an empty iterator | `0` / `None` ✅[^1] | The sum of nothing is the additive identity ✅[^2] |
| `[2.5f64, 7.25].iter().max()` | ``error[E0277]: the trait bound `f64: Ord` is not satisfied`` ✅[^1] | NaN (not a number) gives floats no total order (see `floating-point/special-values-and-exceptions.md`); use `.max_by(\|a, b\| a.total_cmp(b))`, which returned `Some(7.25)` ✅[^1] |
| `[200u8, 100].iter().sum::<u8>()` | Debug build panics `attempt to add with overflow`; with `-C debug-assertions=off` it prints `44` ✅[^1] | `sum` panics on overflow when overflow checks are on ✅[^2] |
| `(0..=255u8).count()` | `256`, no overflow panic even in a debug build ✅[^1] | The range stops after yielding `255` instead of stepping past it ✅[^1] |
| `std::iter::repeat(1).min()` | Never returns | Methods that must see every item do not terminate on infinite iterators ✅[^3] |
| Reusing an iterator after a consumer | Moved; `it.clone().count()` then `it.sum()` works (3, then 6) ✅[^1] | Consumers take `self` ✅[^2] |
| A `size_hint` that lies | Safe code may misbehave, memory safety must not | The hint is not enforced ✅[^2] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Iterator chain | No index arithmetic; same machine code as the loop in the lab ✅[^1]; adapters compose | Side effects inside closures run interleaved item by item, which can surprise (Mental model) ✅[^1] |
| `for` loop over an iterator | The idiomatic form for side effects ✅[^3]; `break` and labels work as in any loop ✅[^4] | Accumulators are mutable state you manage |
| Indexed `for i in 0..v.len()` | Natural when one step reads several positions, such as `v[i]` and `v[i + 1]` | Relies on the optimizer to remove bounds checks (it did in the lab ✅[^1]); off-by-one risk |

## Takeaways
- Use `for` or `for_each` for side effects, never a bare `map`; heed the `unused Map` warning. [rule-candidate]
- Iterate `&v` (or `v.iter()`) when you need `v` after the loop.
- Validate a whole list with `collect::<Result<Vec<_>, _>>()`; it stops at the first error.
- On custom iterators, override `size_hint` when the length is known, and implement `ExactSizeIterator` and `DoubleEndedIterator` when they hold.
- Accept `impl Iterator<Item = T>` or `impl IntoIterator<Item = T>` instead of `&[T]` plus `clone()` when the function consumes the items. [rule-candidate]
- Do not rewrite iterator chains into index loops for speed without a measurement. [rule-candidate]

## Verification status
- Verified: 61 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `linux/lab-setup.md` — the Rust 1.100.0 lab (`rustlab:1`) where every behaviour marked with this note ran on 2026-11-24. [^1]
- [Trait `std::iter::Iterator`](https://doc.rust-lang.org/std/iter/trait.Iterator.html) — Rust project, living. Backs: `next` and resuming after `None`, `size_hint` contract, `take_while`, `zip`, `collect` (target type chooses the collection, turbofish), `fuse`, `sum` (empty sum, overflow panic). [^2]
- [Module `std::iter`](https://doc.rust-lang.org/std/iter/index.html) — Rust project, living. Backs: the three forms of iteration, laziness, `for`/`for_each` for side effects, adapters, infinite iterators, implementing `Iterator`. [^3]
- [Loop expressions: iterator loops](https://doc.rust-lang.org/reference/expressions/loop-expr.html) — The Rust Reference, living. Backs: `for` desugaring. [^4]
- [IntoIterator for arrays](https://doc.rust-lang.org/edition-guide/rust-2021/IntoIterator-for-arrays.html) — The Rust Edition Guide, living. Backs: by-value arrays since 1.53, method-call resolution before 2021, the `array_into_iter` lint. [^5]
- [Trait `std::iter::FromIterator`](https://doc.rust-lang.org/std/iter/trait.FromIterator.html) — Rust project, living. Backs: defining how a type is built from an iterator. [^6]
- [Enum `std::result::Result`](https://doc.rust-lang.org/std/result/enum.Result.html) — Rust project, living. Backs: `FromIterator` and `Sum` for `Result` take no further elements after an `Err`. [^7]
- [Trait `std::iter::ExactSizeIterator`](https://doc.rust-lang.org/std/iter/trait.ExactSizeIterator.html) — Rust project, living. Backs: exact `size_hint`, `len`, why `Chain` is not exact. [^8]
- [Trait `std::iter::DoubleEndedIterator`](https://doc.rust-lang.org/std/iter/trait.DoubleEndedIterator.html) — Rust project, living. Backs: `next_back`, both ends share one range. [^9]
- [Improving Our I/O Project](https://doc.rust-lang.org/book/ch13-03-improving-our-io-project.html) — The Rust Programming Language (Klabnik, Nichols, Krycho et al.), living. Backs: taking an iterator instead of a slice to remove `clone`. [^10]
- [Performance in Loops vs. Iterators](https://doc.rust-lang.org/book/ch13-04-performance.html) — The Rust Programming Language, living. Backs: zero-cost abstraction, the Book's benchmark. [^11]
- [Trait `std::iter::FusedIterator`](https://doc.rust-lang.org/std/iter/trait.FusedIterator.html) — Rust project, living. Backs: prefer `.fuse()` over a `FusedIterator` bound. [^12]
- [Processing a Series of Items with Iterators](https://doc.rust-lang.org/book/ch13-02-iterators.html) — The Rust Programming Language, living. Backs: only `next` is required, iterator adapters produce new iterators, consuming adapters such as `sum` take ownership, `iter`/`iter_mut`/`into_iter`. [^13]

## Related
- `rust/closures-and-iterators/closures-and-fn-traits.md` — what the closures in `map` and `filter` capture.
- `rust/collections/vec-hashmap-and-std-collections.md` — the collections these iterators walk.
- `rust/errors/panic-result-and-error-propagation.md` — `?` and `Result`, which `collect` can build.
- `rust/performance/zero-cost-abstractions-and-optimization.md` — what "zero-cost" means and how to measure it.
- `performance/measurement/benchmarking-methodology.md` — keeping results live, warming up and repeating runs, as the timing above did.
- `javascript/generators-iterators/generators-and-async-iteration.md` — the same pull protocol in JavaScript.
