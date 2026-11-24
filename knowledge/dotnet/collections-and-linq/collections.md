---
schema: knowledge-doc/v1
type: concept
topic: dotnet/collections-and-linq
status: verified
applies-to: [".NET 10 (runtime 10.0.12)", "C# 14", ".NET 11.0.0 / C# 15 (container lab, SDK 11.0.100) for `with(...)` arguments"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [dotnet, csharp, collections, array, list, dictionary, hashset, gethashcode, priorityqueue, immutable, frozen, collection-expressions, collectionsmarshal]
ranked-sources: true
---

# Collections: arrays, lists, dictionaries and their read-only forms

## Summary
**TL;DR:** An array has a fixed length; a `List<T>` wraps an array and replaces it with one twice as large when it fills up (capacity 0, 4, 8, 16, … in the lab). A `Dictionary<TKey,TValue>` is a hash table: a key must keep the same hash code while it is stored, and the enumeration order is undefined. "Read-only" types differ: `ReadOnlyCollection<T>` and `IReadOnlyList<T>` are views of a list that can still change, `ImmutableArray<T>` and `FrozenDictionary<TKey,TValue>` never change. A collection expression `[1, 2, ..xs]` (C# 12) builds whatever type it is assigned to. Changing a `List<T>` while a `foreach` runs over it throws `InvalidOperationException`.
**Use this when:** you are choosing a collection type, a key "disappears" from a dictionary, a loop fails with "Collection was modified", you need to know what `[1, 2, 3]` creates for an interface type, or a list allocates more than expected.
**Not this doc:** `foreach`, enumerators and `yield` → `dotnet/collections-and-linq/iterators.md`; LINQ (language-integrated query) operators → `dotnet/collections-and-linq/linq.md`; array covariance in depth → `dotnet/generics/variance.md`; thread-safe collections → `dotnet/concurrency/concurrent-collections-and-channels.md`; `Span<T>` → `dotnet/performance/span-and-memory.md`; value equality of records and structs → `dotnet/type-design/classes-structs-and-records.md`.

## Problem
The collection types look interchangeable, but each one stores data differently, and code written without knowing how fails in ways that look random:
- A list of 70 numbers built one `Add` at a time allocates six arrays and copies 124 elements.
- A key that is still in the dictionary (it shows up when you enumerate) is not found by `ContainsKey`.
- A dictionary enumerates in insertion order in a test, then in another order after a `Remove`.
- A method returns `IReadOnlyList<T>`, and a caller casts it back to `List<T>` and changes it.
- `PriorityQueue` hands out four items of equal priority in the reverse of the order they went in, once an item of higher priority has gone first.
- `foreach (var x in list) list.Add(...)` throws `InvalidOperationException`, but removing from a `Dictionary` inside `foreach` works.

## Mental model
**Analogy:** a `List<T>` is a row of numbered lockers with some empty lockers at the end. While there is an empty one, adding an item is quick. When the row is full, you rent a new row twice as long and move every item across, which is slow, but rare. A `Dictionary` is a cloakroom: the hash code is the ticket number that says which hook a coat hangs on. If you change the coat so that it would get a different ticket (you mutate the key), the attendant looks on the wrong hook and says it is not there, although it still hangs in the room.

**Artifact** (run in the lab ✅[^lab]):
```csharp
var list = new List<int>();
for (int i = 1; i <= 70; i++) list.Add(i);
// capacity seen after each change: count=1 cap=4 | count=5 cap=8 | count=9 cap=16
//                                  | count=17 cap=32 | count=33 cap=64 | count=65 cap=128

var key = new MutableKey { Id = 1 };              // GetHashCode() => Id
var byKey = new Dictionary<MutableKey, string> { [key] = "one" };
key.Id = 2;                                       // change the hash while stored
byKey.ContainsKey(key);                           // False, though Count is 1
byKey.Select(p => p.Key.Id);                      // [2]: the entry is still there
key.Id = 1; byKey.ContainsKey(key);               // True again
```

## How it works
1. **Arrays.** An array's number of dimensions and the length of each are fixed when it is created and cannot change afterwards; elements start at their type's default value (`0`, `null`), even in a `string[]` with nullable annotations on ✅[^ref-arrays]. Arrays are reference types derived from `System.Array`, and single-dimensional arrays also implement `IList<T>` ✅[^ref-arrays]. In the lab, `Array.Resize` returned a new array object and left the old one at length 3, `int[,]` did not implement `IList<int>`, and `((IList<int>)arr).Add(1)` threw `NotSupportedException: Collection was of a fixed size.` ✅[^lab]. A jagged array (`int[][]`) is an array of arrays whose rows start as `null`; a multidimensional array (`int[,]`) is one block, and `foreach` walks its rightmost index first ✅[^ref-arrays]. Arrays are covariant (`object[] o = new string[1]`), so a store can fail at run time with `ArrayTypeMismatchException` ✅[^lab]; `dotnet/generics/variance.md` explains why.
2. **`List<T>` grows by doubling.** It implements `IList<T>` "by using an array whose size is dynamically increased as required" ✅[^api-list]. `Capacity` is what the array can hold, `Count` is what it holds; when an `Add` needs more room, a new array is allocated and the old elements are copied ✅[^api-list]. The runtime source sets a default capacity of 4 and grows to twice the current length ✅[^src-list], which is the 0 → 4 → 8 → … sequence the lab printed ✅[^lab]. So `Add` is O(1) (constant time, whatever the count) while `Count < Capacity` and O(n) (time proportional to the count) when it must grow; the fix is to set the initial capacity to the expected size ✅[^coll-overview]. `TrimExcess()` or setting `Capacity` shrinks the array, at an O(n) copy ✅[^api-list].
3. **`Dictionary<TKey,TValue>` is a hash table.** Lookup by key is close to O(1), and its speed depends on the quality of the key type's hash function ✅[^api-dict]. Keys are compared with the comparer passed to the constructor, or `EqualityComparer<TKey>.Default`, which uses `IEquatable<TKey>` when the key type implements it ✅[^api-dict]. A key cannot be `null`, every key must be unique, and a key must not change in any way that affects its hash value while it is stored ✅[^api-dict]. Its internal array sizes are primes from a fixed table (3, 7, 11, 17, 23, 29, 37, …), and on growth it takes the first prime at least twice the old size ✅[^src-hashhelpers], and the lab saw capacities 3, 7, 17, 37, 89, 197, 431 ✅[^lab].
4. **The `GetHashCode`/`Equals` contract.** Two equal objects must return equal hash codes; equal hash codes do not imply equal objects; override both methods or neither ✅[^api-gethashcode]. Without an override, a class hashes by reference and a struct hashes its field values by reflection, which works but is slow ✅[^api-gethashcode]. A hash code is not stable across processes or platforms, so never persist it ✅[^api-gethashcode]. For a mutable reference type, override `GetHashCode` only if the hash cannot change while the object sits in a hash-based collection ✅[^api-gethashcode].
5. **Order is not part of the contract.** The order in which a `Dictionary` returns its items is undefined ✅[^api-dict]. In the runtime, removed entries go onto a free list that the next `Add` reuses, the slot freed last first ✅[^src-dict]. So the lab's `pear,apple,fig,kiwi,plum` became `pear,lime,fig,date,plum` after `Remove("kiwi")`, `Remove("apple")`, `Add("lime", 6)`, `Add("date", 7)` in that order, and `pear,date,fig,lime,plum` when `apple` was removed before `kiwi` ✅[^lab]. When order matters, use `SortedDictionary<TKey,TValue>` (a binary search tree with O(log n) retrieval, time that grows with the logarithm of the count, sorted by a comparer) ✅[^api-sorteddict] or the generic `OrderedDictionary<TKey,TValue>` that .NET 9 added (insertion order plus lookup by key) ✅[^whatsnew9].
6. **Sets.** `HashSet<T>` holds unique elements in no particular order; it behaves like a dictionary with keys only and adds set operations (`UnionWith`, `IntersectWith`, `ExceptWith`, `IsSubsetOf`) ✅[^api-hashset]. Passing a comparer changes what "duplicate" means: `new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "a", "A", "b" }` has `Count` 2 ✅[^lab].
7. **Queues and stacks.** `Queue<T>` is first-in first-out and `Stack<T>` last-in first-out ✅[^coll-overview]. `PriorityQueue<TElement,TPriority>` is an array-backed quaternary min-heap that dequeues the lowest priority first and does not guarantee first-in first-out order among equal priorities ✅[^api-pq]. .NET 9 added `PriorityQueue.Remove`, an O(n) way to emulate a priority update ✅[^whatsnew9].
8. **Read-only view, immutable, frozen.**
   - `ReadOnlyCollection<T>` (what `list.AsReadOnly()` returns) is a wrapper that blocks changes through itself, but shows changes made to the underlying list ✅[^api-roc].
   - `IReadOnlyList<T>` promises only that the number and order of elements are read-only through that interface, not that the elements are ✅[^api-irol]; a `List<T>` passed as `IReadOnlyList<T>` can be cast back and changed ✅[^lab].
   - `ImmutableArray<T>` cannot change after creation: `Add` is O(n) because it builds a new array, while the indexer is O(1) ✅[^api-immarray].
   - `FrozenDictionary<TKey,TValue>` is immutable and costs more to build in exchange for fast lookups, which suits a dictionary built once at startup; it should be built only from trusted keys ✅[^api-frozen].
9. **Collection expressions (C# 12).** `[e1, e2, ..spread]` has no type of its own: it converts to its target type, such as an array, a `Span<T>`, a type with a collection initializer or a `CollectionBuilder` method, or `IEnumerable<T>`, `IReadOnlyCollection<T>`, `IReadOnlyList<T>`, `ICollection<T>` and `IList<T>` ✅[^ref-collexpr]. A spread element `..xs` copies every element of anything `foreach` can enumerate ✅[^ref-collexpr]. The expression always builds the whole collection at once, even for an `IEnumerable<T>` target ✅[^ref-collexpr]. For the read-only interfaces the compiler may pick or synthesize any type that implements them; for `ICollection<T>` and `IList<T>` it must create a `List<T>` ✅[^prop-collexpr]. In the lab, `IEnumerable<int> e = [1, 2, 3]` built a hidden `<>z__ReadOnlyArray<int>`, `IList<int>` built `List<int>`, and `IEnumerable<int> e = []` returned the cached `Array.Empty<int>()` ✅[^lab]. C# 15 (.NET 11) adds `with(...)` as a first element to pass constructor arguments, such as a capacity or a comparer ✅[^ref-collexpr]. In the .NET 11 container, `List<string> names = [with(capacity: values.Length * 2), .. values]` over three strings had `Capacity` 6 (3 without `with`), and `HashSet<string> set = [with(StringComparer.OrdinalIgnoreCase), "Hello", "HELLO", "hello"]` had `Count` 1 ✅[^lab11].
10. **`CollectionsMarshal`.** `AsSpan(list)` returns a `Span<T>` over the list's backing array, and items must not be added or removed while the span is in use ✅[^api-marshal]. `GetValueRefOrAddDefault(dict, key, out exists)` returns a reference to the value slot, adding a default entry if the key is missing, so a counter needs one lookup instead of two ✅[^api-marshal]; in the lab, `GetValueRefOrAddDefault(counts, w, out _)++` over `"a b a c a"` gave `a=3,b=1,c=1` ✅[^lab].
11. **Changing a collection during `foreach`.** A `Dictionary` enumerator stays valid only while the collection is unchanged; after an add or a capacity change, the next `MoveNext` throws `InvalidOperationException`, and the only mutating methods that do not invalidate it are `Remove` and `Clear` ✅[^api-dict-enum]. Overwriting the value of an existing key does not count as a change either: that path of the runtime source sets the value and returns without touching the version counter ✅[^src-dict]. `List<T>` has no such exceptions: in the lab, `Add`, `Remove` and even `list[0] = 100` inside the loop all threw ✅[^lab].

## Worked example
Filling a list with 70 numbers, three ways, measured in a Release build ✅[^lab].

| Step | Code | Observed | Why |
|---|---|---|---|
| 1 | `var l = new List<int>(); for (…70…) l.Add(i);` | 6 backing arrays (capacity 4, 8, 16, 32, 64, 128), 124 elements copied, 1,184 bytes allocated | doubling from 4 (How it works 2); copies are 4 + 8 + 16 + 32 + 64 = 124 |
| 2 | `l.Capacity` after the loop | `128`: 58 unused slots | the last doubling went from 64 to 128 |
| 3 | `new List<int>(70)`, then 70 `Add`s | capacity 70, 336 bytes allocated, no copy | one array of the right size |
| 4 | `List<int> l = [.. Enumerable.Range(0, 70)];` | capacity 70, 376 bytes allocated | a spread over a source with a known length lets the compiler build the result with no copying and no slack space ✅[^prop-collexpr] |
| 5 | `l.TrimExcess()` on step 1's list | capacity 70 | one more O(n) copy into a 70-slot array (How it works 2) |
| 6 | `new List<int>(10)`, then 11 `Add`s | capacity 20 | growth doubles the current capacity, not the default |

Step 1 versus step 3: the same 70 numbers, about 3.5 times the allocated bytes (1,184 / 336). When the size is known or can be estimated, pass it to the constructor or use a collection expression over a source with a known count.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Class overrides `Equals` but not `GetHashCode` | Compiler warning CS0659; `ContainsKey(new EqOnly(5))` is `False` for an equal key ✅[^lab] | Each instance keeps its reference-based hash code, so equal keys land in different buckets and are never compared (How it works 4) |
| Struct key with no overrides | Works: two `Pt(1, 2)` values count as one in a `HashSet` ✅[^lab] | `ValueType` compares and hashes fields by reflection, which is slow; override both or use a `record struct` ✅[^api-gethashcode] |
| `d.Add` with an existing key, `d["missing"]` | `ArgumentException: An item with the same key has already been added. Key: pear`; `KeyNotFoundException: The given key 'nope' was not present in the dictionary.` ✅[^lab] | Use `TryAdd` and `TryGetValue`, which return `false` instead ✅[^lab] |
| `foreach` over a `default(ImmutableArray<int>)` | `NullReferenceException`; `IsDefault` is `True` ✅[^lab] | The struct wraps a `null` array until it is initialized |
| `CollectionsMarshal.AsSpan(list)`, then the list grows | A write through the old span no longer reaches the list (`list[1]` stayed `2` after `view[1] = 20`) ✅[^lab] | Growth moved the items to a new array; the span still points at the old one (How it works 10) |
| `new Stack<int>([1, 2, 3])` | Enumerates `3,2,1`; `Pop()` returns `3` ✅[^lab] | The constructor copies the items onto the stack in the order the source enumerates them ✅[^api-stack], so the last one ends up on top |
| Equal priorities in `PriorityQueue` | Enqueued after one item of priority 1, `low-1` … `low-4` (priority 5) came out as `low-4 low-3 low-2 low-1`; enqueued alone, as `low-1 low-4 low-3 low-2` ✅[^lab] | A heap gives no first-in first-out guarantee for ties ✅[^api-pq]; add a sequence number to the priority if order matters |
| `IEnumerable<int> e = [1, 2, 3]`, then `((ICollection<int>)e).Add(4)` | `NotSupportedException` ✅[^lab] | The synthesized type implements the mutable interfaces but is read-only (How it works 9) |
| Concrete type of a frozen collection | `ToFrozenDictionary()` returned `LengthBucketsFrozenDictionary`; `FrozenSet<int> fs = [3, 1, 2]` returned `SmallValueTypeComparableFrozenSet` ✅[^lab] | The factory picks a specialised implementation for the keys it sees; code only sees the abstract type |
| `[with(capacity: values.Length * 2), .. values]` on SDK (software development kit) 10.0.401 | `error CS8652: The feature 'collection expression arguments' is currently in Preview and *unsupported*.` ✅[^lab] | A C# 15 feature (How it works 9); SDK 11.0.100 at `LangVersion=14` reports `error CS9327: Feature 'collection expression arguments' is not available in C# 14.0.` ✅[^lab11] |
| Removing items in a loop | `RemoveAll(predicate)`, or a `for` loop that runs backwards with `RemoveAt(i)`, works without an exception ✅[^lab] | Neither uses an enumerator, so there is no version check |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `T[]` | Smallest, fastest indexing, `Span<T>`-friendly | Fixed length; covariance checks on stores of reference types |
| `List<T>` | Grows on demand; O(1) amortized `Add` ✅[^coll-overview] | Slack capacity; O(n) copy on each growth; enumerators break on any change |
| `Dictionary<TKey,TValue>` | Near O(1) lookup ✅[^api-dict] | No defined order; keys must keep a stable hash |
| `SortedDictionary` / `OrderedDictionary` | Sorted by key / insertion order ✅[^api-sorteddict] ✅[^whatsnew9] | O(log n) operations for the sorted one; more memory |
| `ReadOnlyCollection<T>` / `IReadOnlyList<T>` | No copy; callers cannot change it through the view | The owner can still change it, and a cast gets around the interface |
| `ImmutableArray<T>` | Never changes; O(1) indexer ✅[^api-immarray] | Every `Add` copies the array; `default` value is a trap |
| `FrozenDictionary<TKey,TValue>` | Fastest lookups for data built once ✅[^api-frozen] | Slow to build; cannot be changed |

## Takeaways
- Pass a capacity to `List<T>`, `Dictionary` and `HashSet` constructors when the final size is known or can be estimated. [rule-candidate]
- Use only immutable fields to compute a dictionary key's hash code, and override `Equals` and `GetHashCode` together (or use a `record`). [rule-candidate]
- Never depend on `Dictionary` or `HashSet` enumeration order; pick `SortedDictionary` or `OrderedDictionary` when order is part of the meaning. [rule-candidate]
- Return `ImmutableArray<T>` or a frozen collection when callers must never see a change; `IReadOnlyList<T>` only stops them from changing it.
- To remove while iterating, use `RemoveAll`, a backwards `for` loop, or (for a dictionary only) `Remove` inside `foreach`.

## Verification status
- Verified: 73 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `dotnet/lab-setup.md` — the .NET SDK 10.0.401 lab (runtime 10.0.12, C# 14, macOS 26.1 arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- `dotnet/lab-setup.md` (Step 13) — the .NET 11 container lab (SDK 11.0.100, runtime 11.0.0, C# 15, Ubuntu 26.04.1 arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab11]
- [Arrays (C# reference)](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/arrays) — Microsoft, living. Rank 1. Backs: fixed dimensions and lengths, default elements, `Array` base type and `IList<T>`, jagged and multidimensional arrays and their `foreach` order. [^ref-arrays]
- [List&lt;T&gt; Class](https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.list-1) — Microsoft, living. Rank 1. Backs: array-backed `IList<T>`, `Capacity` versus `Count`, reallocation on growth, `TrimExcess`. [^api-list]
- [Collections and data structures](https://learn.microsoft.com/en-us/dotnet/standard/collections/) — Microsoft, living. Rank 1. Backs: `Add` O(1) or O(n) and presizing, the complexity table, FIFO and LIFO collections. [^coll-overview]
- [Dictionary&lt;TKey,TValue&gt; Class](https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.dictionary-2) — Microsoft, living. Rank 1. Backs: hash table near O(1), comparer selection, null and mutable keys, undefined order. [^api-dict]
- [Dictionary&lt;TKey,TValue&gt;.GetEnumerator Method](https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.dictionary-2.getenumerator) — Microsoft, living. Rank 1. Backs: an add or a capacity change invalidates the enumerator; `Remove` and `Clear` are the only mutating methods that do not. [^api-dict-enum]
- [Object.GetHashCode Method](https://learn.microsoft.com/en-us/dotnet/api/system.object.gethashcode) — Microsoft, living. Rank 1. Backs: the equality contract, default reference and reflection-based hashes, no persistence, mutable reference types. [^api-gethashcode]
- [HashSet&lt;T&gt; Class](https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.hashset-1) — Microsoft, living. Rank 1. Backs: unique unordered elements and set operations. [^api-hashset]
- [SortedDictionary&lt;TKey,TValue&gt; Class](https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.sorteddictionary-2) — Microsoft, living. Rank 1. Backs: binary search tree, O(log n), sorted by comparer. [^api-sorteddict]
- [What's new in .NET 9 libraries](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-9/libraries) — Microsoft, living. Rank 1. Backs: generic `OrderedDictionary<TKey,TValue>`, `PriorityQueue.Remove`. [^whatsnew9]
- [PriorityQueue&lt;TElement,TPriority&gt; Class](https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.priorityqueue-2) — Microsoft, living. Rank 1. Backs: quaternary min-heap, lowest priority first, no FIFO among equals. [^api-pq]
- [Stack&lt;T&gt; Class](https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.stack-1) — Microsoft, living. Rank 1. Backs: the collection constructor copies elements in enumeration order. [^api-stack]
- [ReadOnlyCollection&lt;T&gt; Class](https://learn.microsoft.com/en-us/dotnet/api/system.collections.objectmodel.readonlycollection-1) — Microsoft, living. Rank 1. Backs: a wrapper that reflects changes to the underlying collection. [^api-roc]
- [IReadOnlyList&lt;T&gt; Interface](https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.ireadonlylist-1) — Microsoft, living. Rank 1. Backs: only count and order are read-only. [^api-irol]
- [ImmutableArray&lt;T&gt; Struct](https://learn.microsoft.com/en-us/dotnet/api/system.collections.immutable.immutablearray-1) — Microsoft, living. Rank 1. Backs: immutability, O(1) indexer, O(n) `Add`. [^api-immarray]
- [FrozenDictionary&lt;TKey,TValue&gt; Class](https://learn.microsoft.com/en-us/dotnet/api/system.collections.frozen.frozendictionary-2) — Microsoft, living. Rank 1. Backs: immutable, costly to create, fast lookup, trusted keys only. [^api-frozen]
- [Collection expressions (C# reference)](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/collection-expressions) — Microsoft, living. Rank 1. Backs: target types, spread elements, always fully built, C# 15 `with(...)` arguments. [^ref-collexpr]
- [CollectionsMarshal Class](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.interopservices.collectionsmarshal) — Microsoft, living. Rank 1. Backs: `AsSpan` and `GetValueRefOrAddDefault` and their no-add/remove rule. [^api-marshal]
- [Collection expressions feature specification](https://github.com/dotnet/csharplang/blob/main/proposals/csharp-12.0/collection-expressions.md) — .NET team (dotnet/csharplang), 2023. Rank 1. Backs: read-only interface targets may use any implementing type; `ICollection<T>`/`IList<T>` targets must be `List<T>`; known-length translation. [^prop-collexpr]
- [List.cs, release/10.0](https://github.com/dotnet/runtime/blob/release/10.0/src/libraries/System.Private.CoreLib/src/System/Collections/Generic/List.cs) — .NET team (dotnet/runtime), 2025. Rank 1. Backs: `DefaultCapacity = 4` and growth to twice the length. [^src-list]
- [Dictionary.cs, release/10.0](https://github.com/dotnet/runtime/blob/release/10.0/src/libraries/System.Private.CoreLib/src/System/Collections/Generic/Dictionary.cs) — .NET team (dotnet/runtime), 2025. Rank 1. Backs: the free list reused by `Add`; overwriting an existing key leaves the version unchanged. [^src-dict]
- [HashHelpers.cs, release/10.0](https://github.com/dotnet/runtime/blob/release/10.0/src/libraries/System.Private.CoreLib/src/System/Collections/HashHelpers.cs) — .NET team (dotnet/runtime), 2025. Rank 1. Backs: the prime table and growth to the first prime at least twice the old size. [^src-hashhelpers]

## Related
- `dotnet/collections-and-linq/iterators.md` — how `foreach` walks these collections and why struct enumerators allocate nothing.
- `dotnet/collections-and-linq/linq.md` — querying collections, deferred execution and its multiple-enumeration bugs.
- `dotnet/generics/variance.md` — array covariance and `ArrayTypeMismatchException`.
- `dotnet/concurrency/concurrent-collections-and-channels.md` — `ConcurrentDictionary` and friends.
- `dotnet/performance/span-and-memory.md` — spans over arrays and lists.
- `dotnet/type-design/classes-structs-and-records.md` — value equality for record and struct keys.
