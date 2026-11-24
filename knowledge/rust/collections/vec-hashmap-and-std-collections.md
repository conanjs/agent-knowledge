---
schema: knowledge-doc/v1
type: concept
topic: rust/collections
status: verified
applies-to: ["Rust 1.100.0", "edition 2024"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [rust, vec, capacity, reallocation, hashmap, entry-api, siphash, randomstate, btreemap, hashset, vecdeque, binaryheap, collections]
---

# `Vec`, `HashMap` and the other std collections

## Summary
**TL;DR:** A `Vec<T>` is a growable array: a pointer, a capacity and a length (24 bytes on a 64-bit target) plus one heap buffer. When `len == capacity`, `push` reallocates; the growth strategy is not specified, but on this build capacity went 0 → 4 → 8 → 16 … for `u32` (0 → 8 for `u8`, 0 → 1 for elements over 1 KiB), which keeps `push` amortized O(1). `v[i]` panics out of range while `v.get(i)` returns `None`, and holding `&v[0]` while pushing is rejected (E0502) because the buffer may move. `HashMap<K, V>` is not in the prelude, needs `K: Eq + Hash`, takes ownership of inserted keys and values, and iterates in an **arbitrary order that changed from run to run**, because its default hasher (currently SipHash 1-3) is seeded randomly; `entry` inserts or updates with one lookup. Use `BTreeMap`/`BTreeSet` for sorted order and ranges, `HashSet` for membership, `VecDeque` for both ends, `BinaryHeap` for "largest first".
**Use this when:** you choose a collection, size one up front, see E0502 or E0507 around a `Vec`, rely on map order, or need the cost of an operation.
**Not this doc:** borrowing rules themselves → `rust/ownership/borrowing-references-and-slices.md`; iterator adapters and `collect` → `rust/closures-and-iterators/iterators.md`; `String` → `rust/collections/strings-and-utf-8.md`; amortized cost in general → `algorithms/fundamentals/amortized-analysis.md`; hashing, collisions and load factor → `algorithms/data-structures/hash-tables.md`; heaps and B-trees → `algorithms/data-structures/trees-heaps-and-b-trees.md`; `with_capacity` as an optimization → `rust/performance/zero-cost-abstractions-and-optimization.md`.

## Problem
A program keeps `&names[0]` and later pushes: it does not compile. A test compares the printed contents of a `HashMap` and fails one run in three. `let first = names[0];` on a `Vec<String>` is refused. A loop that calls `remove(0)` on a large `Vec` is slow. Each of these follows from how the collection stores its data.

## Mental model
**Analogy:** a `Vec` is a group holding a row of reserved theatre seats. While seats are free, newcomers sit down at once; when the row is full, the whole group moves to a row twice as long, and any ticket stub that named an old seat now points at an empty seat. The borrow checker refuses to let you hold a stub while the group might move. A `HashMap` is a cloakroom whose hook number comes from a secret formula chosen fresh each evening, so walking the hooks in order returns the coats in a different order every night.

**Artifact:** capacity after each growth, from `Vec::new()` (lab, Rust 1.100.0, aarch64) ✅[^1]:
```rust
fn capacities<T: Clone>(item: T, pushes: usize) -> Vec<usize> {
    let mut v: Vec<T> = Vec::new();
    let mut seen = vec![v.capacity()];
    for _ in 0..pushes {
        v.push(item.clone());
        if *seen.last().unwrap() != v.capacity() { seen.push(v.capacity()); }
    }
    seen
}
fn main() {
    println!("Vec<u8>         {:?}", capacities(0_u8, 100));
    println!("Vec<u32>        {:?}", capacities(0_u32, 100));
    println!("Vec<[u8; 2048]> {:?}", capacities([0_u8; 2048], 10));
    println!("Vec<()>         {:?}", capacities((), 3));
}
```
```text
Vec<u8>         [0, 8, 16, 32, 64, 128]
Vec<u32>        [0, 4, 8, 16, 32, 64, 128]
Vec<[u8; 2048]> [0, 1, 2, 4, 8, 16]
Vec<()>         [18446744073709551615]
```

## How it works
1. **Representation.** A `Vec` is a pointer, a capacity and a length on the stack and its elements in one heap buffer; `size_of::<Vec<u32>>()` measured 24 bytes ✅[^4] ✅[^1]. The field order is not guaranteed ✅[^4]. There is no small-vector optimization: elements never live inline ✅[^4].
2. **Growth.**
   - `push` reallocates exactly when `len == capacity`, and the reported capacity can be relied on ✅[^4].
   - The growth strategy is unspecified, but it guarantees amortized O(1) `push` ✅[^4]. The current source doubles (`max(cap * 2, required)`) with a first non-zero capacity of 8 for 1-byte elements, 4 up to 1 KiB and 1 above, which is exactly the artifact's output ✅[^15] ✅[^1].
   - `vec![…]`, `vec![x; n]` and `Vec::with_capacity(n)` request exactly `n` elements; the allocator may give more ✅[^4]. In the lab `with_capacity(10)` had capacity 10, and `extend(0..11)` raised it to 20 ✅[^1].
   - A `Vec` never shrinks by itself: after `truncate(2)` the capacity stayed 20; `shrink_to_fit()` brought it to 2 ✅[^4] ✅[^1].
   - `reserve(n)` guarantees room for `len + n` and may over-allocate; `reserve_exact(n)` does not over-allocate on purpose ✅[^4]. Both turned capacity 2 (len 2) into 7 ✅[^1].
   - A `Vec` of a zero-sized type never allocates and reports capacity `usize::MAX` ✅[^4] ✅[^1].
   - Reallocation does not always move the data: over 1,000 pushes of `u64`, capacity grew 8 times after the first allocation but the buffer address changed once (glibc on aarch64; machine-specific) ✅[^1].
3. **Reading and removing.**
   - `scores[1]` returns the element, and an index past the end panics (index 3 on a 3-element `Vec`: "index out of bounds: the len is 3 but the index is 3"); `scores.get(10)` returns `None` ✅[^2] ✅[^1].
   - `let first = names[0];` on a `Vec<String>` fails with E0507 "cannot move out of index of `Vec<String>`"; borrow it (`&names[0]`), clone it, or take it with a method ✅[^1].
   - `pop()` takes the last element (`Option<T>`), `remove(i)` shifts the rest left (O(n)), `swap_remove(i)` moves the last element into the hole (O(1), order lost), and `std::mem::take(&mut names[0])` leaves `T::default()` behind ✅[^4] ✅[^14] ✅[^1].
   - `retain` keeps matching elements in order; `dedup` removes only consecutive duplicates, so sort first: `[5, 1, 4, 1, 5, 9, 2, 6]` became `[1, 2, 4, 5, 6]` after `retain(|&x| x != 9)`, `sort()` and `dedup()` ✅[^4] ✅[^1].
4. **Borrowing while changing.**
   - `let head = &queue[0]; queue.push(4); println!("{head}");` fails with E0502 "cannot borrow `queue` as mutable because it is also borrowed as immutable" ✅[^1]. The reason is step 2: `push` may move every element, leaving `head` pointing at freed memory ✅[^2].
   - `for x in &queue { queue.push(20); }` fails the same way, and the compiler suggests an index loop or collecting the changes separately ✅[^1].
   - `for s in &mut scores { *s += 5; }` changes elements in place: `[70, 85, 92]` became `[75, 90, 97]` ✅[^2] ✅[^1].
   - To keep different types in one `Vec`, wrap them in an enum (`enum Cell { Int(i64), Text(String) }`) ✅[^2]. Dropping a `Vec` drops its elements ✅[^2].
5. **`HashMap` basics.**
   - It is not in the prelude (`use std::collections::HashMap;`) and has no literal macro like `vec!` ✅[^3].
   - `insert` returns the previous value: `None` the first time, then `Some(10)` when the key `"bolt"` is inserted again ✅[^1]. `get` returns `Option<&V>`; `.copied().unwrap_or(0)` gives a default ✅[^3] ✅[^1].
   - A `HashMap<String, _>` can be looked up with a `&str`: `stock["bolt"]` returned 12 ✅[^1].
   - `Copy` values are copied in; owned values such as `String` are moved in, so using `key` after `owners.insert(key, value)` fails with E0382 ✅[^3] ✅[^1].
   - Keys need `Eq` and `Hash`; `k1 == k2` must imply equal hashes, and changing a key's hash or equality while it is in the map is a logic error whose effects stay inside that map (no undefined behaviour) ✅[^6]. `HashMap<f64, &str>::insert` fails with E0599 listing the unmet bounds `f64: Eq` and `f64: Hash` ✅[^1].
6. **The entry API.** `map.entry(key)` returns an `Entry`, either occupied or vacant ✅[^9]. `or_insert(v)` and `or_default()` return `&mut V` to the existing or newly inserted value; `and_modify(f)` changes an occupied entry before the fallback insert ✅[^9] ✅[^3]. Two calls of `entry("nut").and_modify(|n| *n += 1).or_insert(1)` left `nut` at 2 ✅[^1].
7. **Hashing and iteration order.**
   - The default hashing algorithm is currently SipHash 1-3, chosen to resist HashDoS (hash flooding: an attacker sends many colliding keys); it may change, and other hashers are faster for small or very large keys ✅[^6] ✅[^3].
   - The algorithm is seeded randomly. Each `RandomState` builds the same hashers, but two `RandomState`s are unlikely to agree ✅[^6] ✅[^7]. Iterators visit entries "in arbitrary order" ✅[^6].
   - Measured: one program printed its keys as `["dog", "cat", "the", "saw", "and"]`, `["the", "cat", "saw", "dog", "and"]` and `["dog", "cat", "and", "the", "saw"]` in three runs, and a second map with the same content in the same process printed yet another order ✅[^1].
   - With `BuildHasherDefault<DefaultHasher>` the order repeated across three runs, because `DefaultHasher::new` instances are all the same; its algorithm is still unspecified across Rust releases ✅[^8] ✅[^1].
   - The table is a port of Google's SwissTable with quadratic probing ✅[^6]; `HashMap::with_capacity(10)` reported capacity 14 ✅[^1]. Collisions and load factor are explained in `algorithms/data-structures/hash-tables.md`.
8. **The other collections.**
   - `BTreeMap` keeps keys sorted (`K: Ord`), iterates in key order and supports `range` ✅[^10]. Each B-tree node holds an array of B−1 to 2B−1 elements, which cuts allocations and cache misses compared with a binary tree ✅[^10].
   - `HashSet<T>` is a `HashMap<T, ()>`; `insert` returns `true` only for a new value: inserting `3, 1, 3, 2, 1` returned `[true, true, false, true, false]` ✅[^11] ✅[^1].
   - `VecDeque` is a growable ring buffer: `push_front`/`pop_front` are cheap, and the elements may not be contiguous (`make_contiguous` fixes that) ✅[^12]. `push_back(2), push_back(3), push_front(1)` then `pop_front()` returned `Some(1)` ✅[^1].
   - `BinaryHeap` is a max-heap priority queue; wrapping items in `std::cmp::Reverse` makes it a min-heap ✅[^13]. Pops from `[4, 9, 1, 7]` came out `9 7 4 1`, and `1 4 7 9` with `Reverse` ✅[^1].
   - Sizes of the empty handles on aarch64: `HashMap<String, u32>` 48 bytes, `HashSet<i32>` 48, `BTreeMap<String, u32>` 24, `VecDeque<u32>` 32 ✅[^1].

   Costs from the std documentation (`*` amortized, `~` expected) ✅[^5]:

   | Collection | get(i) | insert(i) | remove(i) | append | split_off(i) | range |
   |---|---|---|---|---|---|---|
   | `Vec` | O(1) | O(n−i)* | O(n−i) | O(m)* | O(n−i) | — |
   | `VecDeque` | O(1) | O(min(i, n−i))* | O(min(i, n−i)) | O(m)* | O(min(i, n−i)) | — |
   | `LinkedList` | O(min(i, n−i)) | O(min(i, n−i)) | O(min(i, n−i)) | O(1) | O(min(i, n−i)) | — |
   | `HashMap` (by key) | O(1)~ | O(1)~* | O(1)~ | — | — | — |
   | `BTreeMap` (by key) | O(log n) | O(log n) | O(log n) | O(n+m) | — | O(log n) |

   Sets cost the same as the matching map ✅[^5]. `BinaryHeap`: `push` O(1)~, `pop` O(log n), `peek` O(1) ✅[^13].

## Worked example
Grouping log messages by level with the entry API, then printing the groups (lab, three runs) ✅[^1]:
```rust
use std::collections::{BTreeMap, HashMap};

fn main() {
    let log = ["WARN disk 91%", "INFO start", "ERROR db down", "INFO ready", "WARN disk 95%", "INFO tick"];
    let mut by_level: HashMap<String, Vec<&str>> = HashMap::new();
    for line in log {
        let Some((level, msg)) = line.split_once(' ') else { continue };
        by_level.entry(level.to_string()).or_default().push(msg); // one lookup: insert or update
    }
    let order: Vec<&String> = by_level.keys().collect();
    println!("HashMap order: {order:?}");
    let counts: BTreeMap<&str, usize> = by_level.iter().map(|(k, v)| (k.as_str(), v.len())).collect();
    println!("BTreeMap:      {counts:?}");
    println!("WARN messages: {:?}", by_level["WARN"]);            // String key, &str lookup
    println!("DEBUG present: {}", by_level.contains_key("DEBUG"));
}
```
| Run | `HashMap order` line | Other lines |
|---|---|---|
| 1 | `["WARN", "INFO", "ERROR"]` | `{"ERROR": 1, "INFO": 3, "WARN": 2}`, `["disk 91%", "disk 95%"]`, `false` |
| 2 | `["INFO", "WARN", "ERROR"]` | identical to run 1 |
| 3 | `["WARN", "ERROR", "INFO"]` | identical to run 1 |

Reading it: `or_default()` inserts an empty `Vec` the first time a level appears and returns `&mut Vec<&str>` either way, so `push` needs no second lookup. Only the `HashMap` order moves between runs; the `BTreeMap` built from the same data always prints `ERROR`, `INFO`, `WARN` in key order. The counts check out: 3 `INFO` + 2 `WARN` + 1 `ERROR` = 6 lines.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `Vec::new()` | Capacity 0, no allocation ✅[^1] | A zero-capacity `Vec` does not allocate ✅[^4] |
| `v.binary_search(&3)` on sorted `[1, 2, 4, 5, 6]` | `Err(2)`, the insert position; `&4` gives `Ok(2)` ✅[^1] | The result says where the value would go |
| `dedup()` on unsorted data | Keeps non-adjacent repeats ✅[^4] | Only consecutive duplicates are removed |
| `remove(0)` in a loop over a large `Vec` | O(n) per call ✅[^4] | Every later element shifts; use `VecDeque::pop_front` or `swap_remove` |
| Sensitive data removed from a `Vec` | Still in memory until overwritten | Removed data is not erased ✅[^4] |
| Test asserts on `format!("{map:?}")` | Flaky: order differs between runs ✅[^1] | Random seed per `RandomState` ✅[^7]; sort the entries or use `BTreeMap` |
| Hash values saved to disk with `DefaultHasher` | May change on a Rust upgrade | The algorithm is unspecified across releases ✅[^8] |
| Item changes its `Ord` while inside a `BinaryHeap` | Logic error: wrong results or panics, not undefined behaviour | ✅[^13] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `Vec` | Contiguous, cache-friendly, cheapest at the end ✅[^5] | O(n) inserts and removals near the front |
| `VecDeque` | Cheap at both ends ✅[^12] | Not always one contiguous slice |
| `LinkedList` | O(1) split and append, no amortization ✅[^5] | Slow traversal; rarely the right choice ✅[^5] |
| `HashMap` | O(1) expected by key, HashDoS-resistant by default ✅[^6] | No order; SipHash slower than simpler hashers for small keys ✅[^6] |
| `BTreeMap` | Sorted iteration, ranges, min/max ✅[^5] | O(log n) per operation |
| `with_capacity(n)` when `n` is known | No reallocation while filling ✅[^4] ✅[^5] | Wasted memory if `n` is overestimated |

## Takeaways
- Use `get` when an index may be out of range; reserve `v[i]` for indices that are correct by construction. [rule-candidate]
- Never depend on `HashMap` iteration order, in code or in tests; sort or use `BTreeMap`. [rule-candidate]
- Use the entry API instead of `contains_key` followed by `insert`. [rule-candidate]
- Pre-size with `with_capacity` when the final size is known.
- Default to `Vec` and `HashMap`; switch only for a reason listed in the std guidance (both ends → `VecDeque`, order → `BTreeMap`, priority → `BinaryHeap`).

## Verification status
- Verified: 88 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `linux/lab-setup.md` — the Rust 1.100.0 lab (`rustlab:1`) where every behaviour marked with this note ran on 2026-11-24. [^1]
- [Storing Lists of Values with Vectors](https://doc.rust-lang.org/book/ch08-01-vectors.html) — The Rust Programming Language (Klabnik, Nichols, Krycho and the Rust community), living. Backs: `vec!`, indexing vs `get`, E0502 and its reason, iterating with `&mut`, enums for mixed types, drop. [^2]
- [Storing Keys with Associated Values in Hash Maps](https://doc.rust-lang.org/book/ch08-03-hash-maps.html) — The Rust Programming Language, living. Backs: not in the prelude, `get` and `copied`, ownership on insert, `entry`/`or_insert`, SipHash and other hashers. [^3]
- [Vec in std::vec](https://doc.rust-lang.org/std/vec/struct.Vec.html) — Rust standard library docs 1.100.0, living. Backs: capacity and reallocation, guarantees, `reserve`/`reserve_exact`, ZSTs, `remove`/`swap_remove`/`retain`/`dedup`. [^4]
- [std::collections](https://doc.rust-lang.org/std/collections/index.html) — Rust standard library docs 1.100.0, living. Backs: when to use which collection, the cost table, capacity management. [^5]
- [HashMap in std::collections](https://doc.rust-lang.org/std/collections/struct.HashMap.html) — Rust standard library docs 1.100.0, living. Backs: SipHash 1-3, random seeding, key requirements, logic errors, arbitrary order, SwissTable. [^6]
- [RandomState in std::hash](https://doc.rust-lang.org/std/hash/struct.RandomState.html) — Rust standard library docs 1.100.0, living. Backs: different instances produce different hashers. [^7]
- [DefaultHasher in std::hash](https://doc.rust-lang.org/std/hash/struct.DefaultHasher.html) — Rust standard library docs 1.100.0, living. Backs: `new` instances are the same; algorithm unspecified across releases. [^8]
- [Entry in std::collections::hash_map](https://doc.rust-lang.org/std/collections/hash_map/enum.Entry.html) — Rust standard library docs 1.100.0, living. Backs: occupied/vacant, `or_insert`, `or_default`, `and_modify`. [^9]
- [BTreeMap in std::collections](https://doc.rust-lang.org/std/collections/struct.BTreeMap.html) — Rust standard library docs 1.100.0, living. Backs: key order, `Ord`, B-tree node design, `range`. [^10]
- [HashSet in std::collections](https://doc.rust-lang.org/std/collections/struct.HashSet.html) — Rust standard library docs 1.100.0, living. Backs: `HashMap<T, ()>`, `insert` return value. [^11]
- [VecDeque in std::collections](https://doc.rust-lang.org/std/collections/struct.VecDeque.html) — Rust standard library docs 1.100.0, living. Backs: ring buffer, queue use, `make_contiguous`. [^12]
- [BinaryHeap in std::collections](https://doc.rust-lang.org/std/collections/struct.BinaryHeap.html) — Rust standard library docs 1.100.0, living. Backs: max-heap, `Reverse`, costs, ordering logic error. [^13]
- [take in std::mem](https://doc.rust-lang.org/std/mem/fn.take.html) — Rust standard library docs 1.100.0, living. Backs: replaces with `Default` and returns the old value. [^14]
- [`library/alloc/src/raw_vec/mod.rs`](https://raw.githubusercontent.com/rust-lang/rust/master/library/alloc/src/raw_vec/mod.rs) — rust-lang/rust source, living (read 2026-11-24). Backs: `min_non_zero_cap` (8, 4, 1) and doubling in `grow_amortized`. [^15]

## Related
- `rust/collections/strings-and-utf-8.md` — `String`, the `Vec<u8>` that must stay UTF-8.
- `rust/ownership/borrowing-references-and-slices.md` — the shared-or-mutable rule behind E0502.
- `rust/closures-and-iterators/iterators.md` — `iter`, `iter_mut`, `into_iter` and `collect`.
- `algorithms/fundamentals/amortized-analysis.md` — why doubling gives amortized O(1).
- `algorithms/data-structures/hash-tables.md` — hashing, collisions and load factor.
