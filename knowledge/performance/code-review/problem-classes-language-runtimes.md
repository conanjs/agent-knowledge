---
schema: knowledge-doc/v1
type: reference
topic: performance/code-review
status: verified
applies-to: ["Java SE 21 (JLS SE 21), .NET 10 and C#, Go 1.27 spec, Rust std 1.100.0, C++17 and later, Python 3.15, V8 (blog posts of 2017), Django 5.2, Apache Spark 4.3.0; all read 2026-11-26"]
last-verified: 2026-11-26
last-updated: 2026-11-26
tags: [performance, code-review, linq, lazy-evaluation, copies, boxing, capacity, v8, reflection, hashing, false-sharing]
ranked-sources: true
---

# Performance problem classes hidden by language and runtime features

## Summary
**TL;DR:** Some slow code looks cheap because a language or runtime feature hides the work: a variable that is a query rather than a list, a loop variable that is a copy, an `Integer` that is a heap object, a list that reallocates as it grows, an object whose shape the engine cannot cache, a call that goes through reflection, a key that hashes badly, or two counters in one cache line. This catalog names eight such classes with the fix, the cost from the code, and the check. Most are constant-factor or per-element costs, so the sizes from the workload decide whether a finding matters.
**Use this when:** you review Java, C#, Go, Rust, C++, Python or JavaScript code on a hot path, and the code shape looks harmless but runs once per element, per request or per thread.
**Not this doc:** the first catalog of 39 classes (lookups in loops, N+1 queries, allocation, locks) → `problem-classes.md`; how V8 shapes work → `../../js-runtime/v8-hidden-classes.md`; why false sharing happens → `../hardware/false-sharing.md`; hash tables in general → `../../algorithms/data-structures/hash-tables.md`; the review agent built on these catalogs → `perf-reviewer-calibration.md`.

## Scope
The domain is cost that the source code does not show, because a language or runtime feature adds it: deferred execution, value semantics, boxing, automatic growth, dynamic object layout, reflection, hashing and cache-line placement. Analogy: a restaurant bill with a service charge printed in small type. The menu price (the code) looks low; the charge (the hidden work) is added to every dish. Concrete example: in C#, `var active = users.Where(u => u.Active);` followed by `active.Count()` and `foreach (var u in active)` runs the filter twice, because `active` holds a query, not a list.

Covered: eight classes in three groups (work hidden behind a value or a type, dynamic lookup and hashing, threads). Not covered: compiler flags, just-in-time (JIT) tuning, garbage-collector settings, and the shapes already in `problem-classes.md` (see "Belongs to an existing class" in Lookup notes).

Notation (each symbol is a count read from the code or its workload):

| Symbol | Meaning | Worked example |
|---|---|---|
| n | Elements processed by the loop or stored in the container | A batch of 10,000 orders: n = 10,000 |
| k | Times one lazy sequence is enumerated | `Count()`, then `Any()`, then `foreach` on one query: k = 3, so 3 database queries instead of 1 |
| s | Bytes in one element that is copied | A Go struct of 200 bytes ranged by value over n = 1,000,000 items copies 200 × 1,000,000 = 200,000,000 bytes (200 MB) per loop |
| T | Threads or workers writing at the same time | 8 workers each writing its own 8-byte counter in one array: 8 × 8 = 64 bytes, which fits in one 64-byte cache line, so all 8 share it |

Terms:

| Term | Plain meaning | Analogy | Concrete example |
|---|---|---|---|
| Deferred (lazy) execution | The expression stores a recipe; work runs each time the result is read | A recipe card, not a cooked meal | `IEnumerable<T>` from `Where`; a Django `QuerySet`; a Spark RDD |
| Materialize | Run the recipe once and keep the result | Cook once, keep the meal in the fridge | `ToList()`, `list(qs)`, `rdd.persist()` |
| Boxing | Wrapping a primitive value in a heap object | Putting each coin in its own envelope | Java `List<Integer>`; C# `object o = 42;` |
| Capacity | Slots a growable container has reserved, beyond its length | Chairs set out before guests arrive | Go `make([]T, 0, 100)`; Rust `Vec::with_capacity(100)` |
| Rehash / reallocation | Moving all elements into a bigger table or array when it fills | Moving house when the family grows | A `HashMap` growing past its load factor |
| Hidden class (V8 "map") | The engine's record of an object's layout | A form template: fields at fixed places | `{x, y}` built in the same order shares one map |
| Elements kind | V8's record of what an array holds (small integers, doubles, any, with or without holes) | A shelf label: "eggs only" | `[1, 2, 3]` is packed small integers; `new Array(3)` is holey |
| Inline cache | A per-call-site memory of the shapes seen there | A cashier who remembers regular customers | A property read that saw one shape stays fast |
| Reflection | Finding and calling members by name at run time | Looking up a phone number in a directory on every call | Java `Method.invoke`; C# `PropertyInfo.GetValue` |
| Cache line | The block of memory that caches move between cores | One page of a shared notebook | 64 bytes on many x86-64 CPUs, 128 bytes on some Arm CPUs (see the hardware doc) |
| False sharing | Threads writing different variables in one cache line slow each other; mechanism and a lab run → `../hardware/false-sharing.md` | Two cooks chopping different vegetables on one shared board, handing it back and forth | `long[] counters` indexed by thread id |

## Catalog

**Work hidden behind a value or a type**

| Class | Signals in code | Fix | Before → after | Check |
|---|---|---|---|---|
| `lazy-reenumeration` | an `IEnumerable<T>` or `IQueryable<T>` variable read by `Count()`, `Any()`, `First()` and then a `foreach`; the same Django `Model.objects.filter(...)` built in two places, or `qs[i]` inside a loop; a Spark RDD or DataFrame feeding two actions with no `cache()` / `persist()` | Materialize once (`ToList()`, `ToArray()`); keep one evaluated `QuerySet` or `list(qs)` and reuse it; `persist()` before the second action and `unpersist()` after; for a count alone, count in the database | k runs of the whole pipeline (k queries for a database source) → 1 run plus O(n) memory. Deferred operators run when the variable is enumerated, again on each enumeration ✅[^dotnet-linq]; `Count()` then `Last()` costs 2·O(n), and materializing allocates O(n) ✅[^ca1851]; a new QuerySet starts with an empty cache, its first full evaluation fills the cache and later evaluations reuse it ✅[^django-cache], so each fresh QuerySet pays for its own query; a transformed RDD may be recomputed on each action unless persisted ✅[^spark-rdd] | Turn on analyzer CA1851 (introduced in .NET 7, off by default in .NET 10 and 11) ✅[^ca1851]; count database queries per call: expect 1 after the fix, not k |
| `copy-per-iteration` | Go `for _, v := range items` over large structs or arrays, with `v` only read; C++ `for (auto x : v)` over strings, vectors or structs; C++ parameters `std::string s` or `std::vector<T> v` taken by value and only read; Rust `.clone()` of a `String`, `Vec` or map inside a loop | Go: range by index and take `&items[i]`; C++: `const auto&` in loops, `const T&` parameters; Rust: borrow `&T` or `&str`, or share with `Rc` / `Arc` | n copies of s bytes, plus one heap allocation per copy for owning types → n references. Go assigns each iteration value to the iteration variable as in an assignment ✅[^go-spec]; `for (auto i : v)` accesses by value ✅[^cpp-rangefor]; the C++ Core Guidelines warn on by-value parameters larger than 4·sizeof(void*) ✅[^cpp-f16]; Rust `Clone` is explicit and may be expensive, unlike `Copy` ✅[^rust-clone] | clang-tidy `performance-for-range-copy`, which flags only types expensive to copy ✅[^tidy-forrange]; allocations per iteration in an allocation profile: expect 0 after the fix |
| `primitive-boxing` | Java `List<Integer>`, `Map<Long, V>`, `Stream<Integer>` with `map` / `reduce` over numbers, `Integer` or `Long` accumulators; C# `ArrayList`, `Hashtable`, `List<object>`, `object` parameters receiving `int`; a struct in `List<T>` searched with `Contains` but lacking `IEquatable<T>` | Java: primitive arrays and `IntStream` / `LongStream` / `DoubleStream` (`mapToInt`, `sum`); C#: generic collections of the value type (`List<int>`), `IEquatable<T>` on structs, generic overloads | One heap object per element or per operation → none. the Java SE 8 autoboxing guide says it is not appropriate for scientific computing or other performance-sensitive numerical code ✅[^java-autobox]; Java has streams over primitive `int`, `long` and `double` ✅[^java-streampkg]; a boxed value type is a new allocated object ✅[^dotnet-boxing]; a `List<T>` of a value type does not box its elements, but `Contains` boxes when `T` lacks `IEquatable<T>` ✅[^dotnet-listt] | Allocation profile or heap dump at n and 2n: wrapper objects (`Integer`, boxed `Int32`) grow with n before the fix and stay flat after; .NET allocation counting → `../../dotnet/performance/measuring-and-reducing-allocations.md` |
| `missing-capacity-hint` | an empty container filled in a loop whose count is known first (`len(src)`, `src.size()`, `Count`): Go `var out []T` or `make([]T, 0)` plus `append`, `make(map[K]V)`; Java `new ArrayList<>()`, `new HashMap<>()`; Rust `Vec::new()`, `HashMap::new()`; C++ `std::vector` plus `push_back`; C# `new List<T>()`, `new Dictionary<K, V>()` | Size at creation: Go `make([]T, 0, n)`, `make(map[K]V, n)`; Java `new ArrayList<>(n)` or `ensureCapacity`, `HashMap.newHashMap(n)` (Java 19 and later); Rust `with_capacity(n)`; C++ one `reserve(n)` before the loop; C# `new List<T>(n)`, `new Dictionary<K, V>(n)` | O(log n) reallocations, each copying the elements stored so far (with geometric growth) → 1 allocation; total time is O(n) both ways, so this is a constant factor. `append` allocates a new array when capacity is short ✅[^go-spec]; a map size hint gives initial space for n elements, with implementation-dependent behaviour ✅[^go-spec]; reallocation "can be slow", so use `Vec::with_capacity` whenever possible ✅[^rust-vec]; when the count of a `List<T>` exceeds its capacity the internal array is reallocated and the old elements are copied ✅[^dotnet-listcap]; a sufficiently large `HashMap` capacity stores mappings more efficiently than automatic rehashing ✅[^java-hashmap]; an initial `Dictionary` capacity removes a number of resizing operations ✅[^dotnet-dict]; `ensureCapacity` may reduce incremental reallocation ✅[^java-arraylist]. The O(log n) count above is arithmetic that assumes doubling, not a figure from these pages (see "What the sources do not say") | clang-tidy `performance-inefficient-vector-operation` flags single-statement loops that add elements to a vector and suggests a `reserve(n)` before the loop, which can avoid unnecessary reallocations ✅[^tidy-vector]; allocations per call at n and 2n: before the fix, count them at both sizes (if growth doubles, about one more per doubling of n: arithmetic, not a sourced figure); after the fix, 1 |

**Dynamic lookup and hashing**

| Class | Signals in code | Fix | Before → after | Check |
|---|---|---|---|---|
| `object-shape-instability` | `delete obj.prop` on hot objects; properties added conditionally or in different orders after construction; reads past `arr.length`; one array mixing small integers, doubles (`-0`, `NaN`) and objects; array-like objects used as arrays | Set every field in the constructor or one factory, in one order; assign `undefined` instead of `delete`; a `Map` for data with keys added and removed; keep numeric arrays numeric | Per property read a cached shape check → a dictionary lookup; per array access the packed fast path → extra checks for the whole life of the array. Per the V8 post of 30 August 2017, inline caches do not work with dictionary properties ✅[^v8-fastprops]; per the post of 12 September 2017, a hole marks an array holey forever, even after it is filled, and holey arrays need additional checks and expensive prototype-chain lookups ✅[^v8-elements], but the post's update of 2025-02-28 adds an exception for `Array.prototype.fill` ✅[^v8-elements], so confirm the 2017 behaviour on the V8 version in use ([measured on V8 13.6](../../js-runtime/v8-object-and-value-representation-deep-dive.md)); an object's map is its first pointer, which allows an easy same-class comparison ✅[^v8-maps] | the post shows the elements kind with `%DebugPrint(obj)` and `--allow-natives-syntax` in a debug build of the d8 shell ✅[^v8-elements], and a release build of Node.js 24.22.1 prints it too ([measured](../../js-runtime/v8-object-and-value-representation-deep-dive.md)); CPU profile of the hot function before and after |
| `reflection-in-hot-path` | Java `Method.invoke`, `Field.get`, `Class.forName`, `getDeclaredMethod` per call or per row; C# `GetType().GetProperty(name).GetValue(obj)`, `MethodInfo.Invoke`, `Activator.CreateInstance` per item; Go `reflect.ValueOf(x).FieldByName(...)` in a per-record loop; reflection-based mapping or serialization on the request path | Resolve once and keep the handle: Java `MethodHandles.lookup()` or `Lookup.unreflect` stored in a `static final` field; C# source generators, for JSON System.Text.Json source generation (`JsonSerializerContext`); Go generated code or a type switch; a direct call where the type is known | Per call a dynamic lookup and an access check → a direct call. Reflection prevents some Java virtual machine optimizations and should be avoided in frequently called code ✅[^java-reflect]; reflection checks access on every invoke, a method handle once when it is created ✅[^java-mh]; System.Text.Json collects metadata by reflection the first time it meets a type and caches it; source generation reduces start-up time and memory, and its fast-path mode increases serialization throughput ✅[^dotnet-stj] | CPU profile: reflection frames (`Method.invoke`, `MethodInfo.Invoke`, `reflect.Value`) on the hot path before the fix, gone after |
| `weak-hash-keys` | `hashCode()` or `__hash__` returning a constant or a single low-variety field; `equals` / `__eq__` overridden but the hash left to cover fewer fields; mutable objects used as keys and changed while stored; Rust `HashMap<u64, V>` with the default hasher in a hot loop over integer keys | Hash every field that takes part in equality (Python `hash((a, b, c))`); keep keys immutable, or remove, change and re-insert; in Rust, a faster hasher through `with_hasher` only for keys an attacker cannot choose | Lookup O(1) on average → O(n) when keys collide, so n inserts go from O(n) to O(n²). Python dict times assume collisions are uncommon; when every key hashes to the same value each O(1) operation takes O(n) ✅[^py-tc]; many keys with the same `hashCode()` slow any hash table, and `HashMap` may use `Comparable` order to break ties ✅[^java-hashmap]; mix the components' hashes by hashing a tuple ✅[^py-datamodel]; a key changed while stored: Java map behaviour is unspecified ✅[^java-map], Rust calls it a logic error ✅[^rust-hashmap], Python puts it in the wrong bucket ✅[^py-datamodel]; Rust's default hasher is currently SipHash 1-3 (the page says this may change) and resists HashDoS (hash-flooding denial of service), while other hashers outperform it for small keys such as integers without that protection ✅[^rust-hashmap] | Count distinct hash values over a sample of real keys: expect close to the number of distinct keys; scaling test of n inserts: time per insert stays flat after the fix |

**Threads**

| Class | Signals in code | Fix | Before → after | Check |
|---|---|---|---|---|
| `false-sharing` | an array of per-thread counters or slots indexed by thread or worker id (`long[] counts = new long[threads]`, `[]int64` per goroutine, `std::atomic<int> c[N]`); one struct holding two hot fields written by different threads (a producer index next to a consumer index); per-worker stats structs packed in a slice | Give each hot slot its own cache line: C++17 `alignas(std::hardware_destructive_interference_size)`; Rust `crossbeam_utils::CachePadded`; Go `cpu.CacheLinePad` from `golang.org/x/sys/cpu`; or accumulate in a local variable and combine once at the end | A cache-line transfer between cores on every write → none for padded slots; memory per slot grows to one cache line. The C++17 constant is the minimum offset between two objects to avoid false sharing ✅[^cpp-hdis]; `CachePadded` assumes 128 bytes on x86-64, aarch64 and powerpc64 and 64 bytes on most others ✅[^crossbeam]; `CacheLinePad` pads structs to avoid false sharing ✅[^go-cpu]. Mechanism and a lab run → `../hardware/false-sharing.md` | `perf c2c record`, then `perf c2c report`, tracks cache-line contention ✅[^perf-c2c]; throughput at T = 1, 2, 4, 8: scales with T after the fix |

## Lookup notes
- **Sizes decide.** Every class here costs per element or per call. A loop over ten items, start-up code, or a path that runs once per process is not a finding. Report these classes on code a profile shows as hot, or that runs per element of a large or unbounded input.
- **Not a problem when.**

| Class | Not a problem when |
|---|---|
| `lazy-reenumeration` | The sequence is enumerated once; its runtime type is already a `List` or an array, which CA1851's page says makes the warning safe to suppress ✅[^ca1851]; each pass must see fresh data, which deferred execution provides ✅[^dotnet-linq]; the data is too large to hold in memory, so a second pass is cheaper than O(n) memory |
| `copy-per-iteration` | The element is small and trivially copyable (an `int`, a small Go struct); the Core Guidelines also warn when a parameter of 2·sizeof(void*) or less is passed by reference to `const` ✅[^cpp-f16]; the loop needs its own copy because it changes it |
| `primitive-boxing` | The collection is small or built once; Java values from `Integer.valueOf` in −128 to 127 are always cached ✅[^java-integer]; a .NET `List<T>` of a value type generates its own code, and the page says the memory saved by not boxing exceeds that code's memory only after about 500 elements ✅[^dotnet-listt] |
| `missing-capacity-hint` | The final size is unknown or small; the container is reused across calls and keeps its capacity; the size comes from user input, where .NET advises no capacity parameter, or a clamped one ✅[^dotnet-dict]; a function that appends to a vector it was given should usually not call `reserve` ✅[^cpp-reserve] |
| `object-shape-instability` | The code is not hot; the object is a true dictionary, which belongs in a `Map` anyway; the array is small and short-lived |
| `reflection-in-hot-path` | It runs at start-up or once per type and the result is cached (System.Text.Json caches the metadata after the first use of a type ✅[^dotnet-stj]); the framework already generates code for the hot path |
| `weak-hash-keys` | The map holds a handful of keys; keys come from outside and the default hasher's HashDoS resistance is the point ✅[^rust-hashmap] |
| `false-sharing` | The slots are only read, or written by one thread; writes are rare; the memory of one cache line per slot is too high for the number of slots |

- **Belongs to an existing class.**
  - A generator or iterator rebuilt for each use with the same input → `caching-recomputation`. A generator consumed twice is a correctness bug, not a cost: the second pass sees an exhausted iterator that looks empty ✅[^py-glossary], and a Java stream should be operated on only once ✅[^java-stream].
  - `len(qs)` only to count rows → `sql-query-shape`: Django says counting in the database with `count()` is much more efficient ✅[^django-qsref]. Spark `collect()` → `warehouse-query-cost`.
  - `getMethod` / `GetProperty` looked up on every call while the invoke itself is rare → `hot-path-constants` (an object built per call → once).
  - Go `string(b)` / `[]byte(s)` conversions per iteration are a sub-case of `copy-per-iteration`; the gc compiler avoids the allocation for `m[string(b)]` since gc 1.4 and for comparisons since gc 1.5, but the page notes these are not guaranteed by the language specification ✅[^go-wiki].
  - Per-thread counters behind one lock, or one hot `AtomicLong` → `lock-contention` (`LongAdder`). Spread or `concat` on an accumulator → `allocation-gc`. Strings built by `+=` → `string-matching`.
- **Corrections found while checking the sources (2026-11-26).**
  - A Django `QuerySet` caches its rows once evaluated, so iterating the same object twice runs one query; the cost comes from building a fresh `QuerySet` each time, or from slicing or indexing an unevaluated one, which does not fill the cache ✅[^django-cache]. A LINQ query, in contrast, runs again on every enumeration ✅[^dotnet-linq].
  - The Java Language Specification guarantees that two boxing conversions of the same value give `==` references only when the value comes from a constant expression of type `boolean`, `byte`, `char`, `short`, `int` or `long` and is `true`, `false`, a `char` up to `'\u007f'`, or an integer from −128 to 127 ✅[^jls-boxing]; for other values it allows no assumption about identity ✅[^jls-boxing]; `Integer.valueOf` always caches −128 to 127 ✅[^java-integer].
  - `new HashMap<>(n)` sets a capacity, not a number of mappings; for n mappings the Java SE 21 page points to `HashMap.newHashMap(n)`, added in Java 19 ✅[^java-hashmap].
  - Calling `reserve` before every `push_back` can make capacity grow linearly and add reallocations ✅[^cpp-reserve].
  - The Rust page calls SipHash 1-3 very competitive for medium-sized keys; it is small keys such as integers, and large keys such as long strings, where other hashers win ✅[^rust-hashmap].
  - CA1851, the analyzer for multiple enumeration, is off by default in .NET 10 and 11, so its absence from build output proves nothing ✅[^ca1851].
- **What the sources do not say.**
  - No growth factor: Java states only that adding to an `ArrayList` has constant amortized cost ✅[^java-arraylist], Rust states that `Vec` guarantees no particular growth strategy, only O(1) amortized `push` ✅[^rust-vec], and Go calls the map size hint implementation-dependent ✅[^go-spec]. "log₂ n reallocations" is the writer's arithmetic and assumes doubling.
  - The `HashMap` page says `Comparable` keys "may" be used to break ties; it states no complexity for that case ✅[^java-hashmap].
  - The Java reflection tutorial gives no number for the overhead ✅[^java-reflect].
  - The V8 posts cited are from 2017; no current V8 page read today states an inline-cache threshold. The KB's V8 doc gives one from a personal blog → `../../js-runtime/v8-hidden-classes.md`.
  - No official Java page on `@Contended` padding could be read (the OpenJDK enhancement-proposal page refused automated reading), so Java padding is left out.
- **Weaker sources, rank 5 or 6.** The Go compiler-optimizations page used above is a community-edited wiki on the project's site, rated rank 6 here ✅[^go-wiki].

- **Changed after a measurement (2026-11-26).** This catalog first listed "`new Array(n)` then filled by index" as a signal of `object-shape-instability`, with "`[]` plus `push`" as the fix. Both were removed. On Node.js 24.22.1 (V8 13.6), building an array with `new Array(n)` and indexed writes was faster than `push`, reading a holey array that has no real holes cost about a tenth more in most runs, and `fill()` over the whole array makes it packed again: the runs are in [v8-object-and-value-representation-deep-dive.md](../../js-runtime/v8-object-and-value-representation-deep-dive.md). One `delete` of an existing property did put the object in dictionary mode in the same runs, so that signal stays.

**Calibration state (2026-11-26).** None of these classes has a sample in the review-agent calibration, and the agent's index does not list them: see [perf-reviewer-calibration.md](perf-reviewer-calibration.md). Whether a reviewer, person or agent, finds them from this catalog has not been measured.

## Takeaways
- When a variable holds a query, a stream or an RDD, count how many times it is read; each read reruns the whole pipeline unless it is materialized. [rule-candidate]
- In a loop over a large input, look at the type, not only the call: by-value loop variables, boxed numbers and containers grown from empty each add work per element. [rule-candidate]
- A custom hash or a per-thread array is a performance decision: hash all equality fields, and give each thread's hot slot its own cache line.

## Verification status
- Verified: 69 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-26

## References
- [Introduction to LINQ Queries](https://learn.microsoft.com/en-us/dotnet/csharp/linq/get-started/introduction-to-linq-queries) — Microsoft Learn, 2024 (updated 2026). Rank 1. Backs: Catalog, lazy-reenumeration; Lookup notes. [^dotnet-linq]
- [CA1851: Possible multiple enumerations of IEnumerable collection](https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/quality-rules/ca1851) — Microsoft Learn, 2026. Rank 1. Backs: Catalog, lazy-reenumeration; Lookup notes. [^ca1851]
- [QuerySet API reference](https://docs.djangoproject.com/en/5.2/ref/models/querysets/) — Django, 5.2. Rank 1. Backs: Lookup notes, existing class. [^django-qsref]
- [Making queries: Caching and QuerySets](https://docs.djangoproject.com/en/5.2/topics/db/queries/) — Django, 5.2. Rank 1. Backs: Catalog, lazy-reenumeration; Lookup notes, corrections. [^django-cache]
- [RDD Programming Guide](https://spark.apache.org/docs/latest/rdd-programming-guide.html) — Apache Spark, 4.3.0. Rank 1. Backs: Catalog, lazy-reenumeration. [^spark-rdd]
- [java.util.stream.Stream](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/stream/Stream.html) — Oracle, Java SE 21. Rank 1. Backs: Lookup notes, existing class. [^java-stream]
- [Glossary: iterator](https://docs.python.org/3/glossary.html) — Python Software Foundation, 3.15. Rank 1. Backs: Lookup notes, existing class. [^py-glossary]
- [The Go Programming Language Specification](https://go.dev/ref/spec) — Go, go1.27 (2026-05-26). Rank 1. Backs: Catalog, copy-per-iteration and missing-capacity-hint; Lookup notes. [^go-spec]
- [clang-tidy performance-for-range-copy](https://clang.llvm.org/extra/clang-tidy/checks/performance/for-range-copy.html) — LLVM, living. Rank 1. Backs: Catalog, copy-per-iteration. [^tidy-forrange]
- [Trait Clone](https://doc.rust-lang.org/std/clone/trait.Clone.html) — Rust project, std 1.100.0. Rank 1. Backs: Catalog, copy-per-iteration. [^rust-clone]
- [Autoboxing](https://docs.oracle.com/javase/8/docs/technotes/guides/language/autoboxing.html) — Oracle, Java SE 8 guide. Rank 1. Backs: Catalog, primitive-boxing. [^java-autobox]
- [JLS SE 21, chapter 5: Conversions and Contexts, §5.1.7 Boxing Conversion](https://docs.oracle.com/javase/specs/jls/se21/html/jls-5.html) — Oracle, Java SE 21. Rank 1. Backs: Lookup notes, corrections. [^jls-boxing]
- [java.lang.Integer](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/Integer.html) — Oracle, Java SE 21. Rank 1. Backs: Lookup notes. [^java-integer]
- [Package java.util.stream](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/stream/package-summary.html) — Oracle, Java SE 21. Rank 1. Backs: Catalog, primitive-boxing. [^java-streampkg]
- [Boxing and Unboxing](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/types/boxing-and-unboxing) — Microsoft Learn, 2025. Rank 1. Backs: Catalog, primitive-boxing. [^dotnet-boxing]
- [System.Collections.Generic.List&lt;T&gt; class](https://learn.microsoft.com/en-us/dotnet/fundamentals/runtime-libraries/system-collections-generic-list%7Bt%7D) — Microsoft Learn, living. Rank 1. Backs: Catalog, primitive-boxing; Lookup notes. [^dotnet-listt]
- [java.util.HashMap](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/HashMap.html) — Oracle, Java SE 21. Rank 1. Backs: Catalog, missing-capacity-hint and weak-hash-keys; Lookup notes. [^java-hashmap]
- [java.util.ArrayList](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/ArrayList.html) — Oracle, Java SE 21. Rank 1. Backs: Catalog, missing-capacity-hint; Lookup notes. [^java-arraylist]
- [Struct Vec](https://doc.rust-lang.org/std/vec/struct.Vec.html) — Rust project, std 1.100.0. Rank 1. Backs: Catalog, missing-capacity-hint. [^rust-vec]
- [clang-tidy performance-inefficient-vector-operation](https://clang.llvm.org/extra/clang-tidy/checks/performance/inefficient-vector-operation.html) — LLVM, living. Rank 1. Backs: Catalog, missing-capacity-hint. [^tidy-vector]
- [List&lt;T&gt;.Capacity Property](https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.list-1.capacity?view=net-10.0) — Microsoft Learn, .NET 10. Rank 1. Backs: Catalog, missing-capacity-hint. [^dotnet-listcap]
- [Dictionary&lt;TKey,TValue&gt; Constructor](https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.dictionary-2.-ctor?view=net-10.0) — Microsoft Learn, .NET 10. Rank 1. Backs: Catalog, missing-capacity-hint; Lookup notes. [^dotnet-dict]
- [Time complexity of operations on built-in types](https://docs.python.org/3/library/time-complexity.html) — Python Software Foundation, 3.15. Rank 1. Backs: Catalog, weak-hash-keys. [^py-tc]
- [Maps (Hidden Classes) in V8](https://v8.dev/docs/hidden-classes) — V8, living. Rank 1. Backs: Catalog, object-shape-instability. [^v8-maps]
- [java.lang.reflect tutorial: Drawbacks of Reflection](https://docs.oracle.com/javase/tutorial/reflect/index.html) — Oracle, The Java Tutorials (JDK 8). Rank 1. Backs: Catalog, reflection-in-hot-path; Lookup notes. [^java-reflect]
- [java.lang.invoke.MethodHandle](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/invoke/MethodHandle.html) — Oracle, Java SE 21. Rank 1. Backs: Catalog, reflection-in-hot-path. [^java-mh]
- [How to choose reflection or source generation in System.Text.Json](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/reflection-vs-source-generation) — Microsoft Learn, 2026. Rank 1. Backs: Catalog, reflection-in-hot-path; Lookup notes. [^dotnet-stj]
- [Struct HashMap](https://doc.rust-lang.org/std/collections/struct.HashMap.html) — Rust project, std 1.100.0. Rank 1. Backs: Catalog, weak-hash-keys; Lookup notes. [^rust-hashmap]
- [Data model: object.\_\_hash\_\_](https://docs.python.org/3/reference/datamodel.html) — Python Software Foundation, 3.15. Rank 1. Backs: Catalog, weak-hash-keys. [^py-datamodel]
- [java.util.Map](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/Map.html) — Oracle, Java SE 21. Rank 1. Backs: Catalog, weak-hash-keys. [^java-map]
- [Struct CachePadded](https://docs.rs/crossbeam-utils/latest/crossbeam_utils/struct.CachePadded.html) — crossbeam-utils, 0.8.23. Rank 1. Backs: Catalog, false-sharing. [^crossbeam]
- [Package golang.org/x/sys/cpu](https://pkg.go.dev/golang.org/x/sys/cpu) — Go project, x/sys v0.50.0. Rank 1. Backs: Catalog, false-sharing. [^go-cpu]
- [perf-c2c(1)](https://man7.org/linux/man-pages/man1/perf-c2c.1.html) — Linux perf via man7.org, living. Rank 1. Backs: Catalog, false-sharing. [^perf-c2c]
- [C++ Core Guidelines, F.16](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines) — Bjarne Stroustrup and Herb Sutter (eds.), living. Rank 3. Backs: Catalog, copy-per-iteration; Lookup notes. [^cpp-f16]
- [Range-based for loop](https://en.cppreference.com/w/cpp/language/range-for) — cppreference, living. Rank 3. Backs: Catalog, copy-per-iteration. [^cpp-rangefor]
- [std::vector::reserve](https://en.cppreference.com/w/cpp/container/vector/reserve) — cppreference, living. Rank 3. Backs: Lookup notes. [^cpp-reserve]
- [std::hardware_destructive_interference_size](https://en.cppreference.com/w/cpp/thread/hardware_destructive_interference_size) — cppreference, living (C++17). Rank 3. Backs: Catalog, false-sharing. [^cpp-hdis]
- [Elements kinds in V8](https://v8.dev/blog/elements-kinds) — V8 team, 2017. Rank 4. Backs: Catalog, object-shape-instability. [^v8-elements]
- [Fast properties in V8](https://v8.dev/blog/fast-properties) — V8 team, 2017. Rank 4. Backs: Catalog, object-shape-instability. [^v8-fastprops]
- [Go Wiki: Compiler And Runtime Optimizations](https://go.dev/wiki/CompilerOptimizations) — Go wiki, community-edited, living. Rank 6. Backs: Lookup notes. [^go-wiki]

## Related
- [problem-classes.md](problem-classes.md) — the first catalog of 39 classes; several shapes found here belong to its classes.
- [perf-reviewer-calibration.md](perf-reviewer-calibration.md) — the review agent built on these catalogs, and how it scored.
- [../../js-runtime/v8-hidden-classes.md](../../js-runtime/v8-hidden-classes.md) — how V8 shapes and inline caches work.
- [../hardware/false-sharing.md](../hardware/false-sharing.md) — the false-sharing mechanism and a lab run.
- [../../algorithms/data-structures/hash-tables.md](../../algorithms/data-structures/hash-tables.md) — collisions, load factor and resizing.
- [../../dotnet/collections-and-linq/linq.md](../../dotnet/collections-and-linq/linq.md) — LINQ deferred execution in depth.
- [../../dotnet/runtime/object-layout-and-boxing.md](../../dotnet/runtime/object-layout-and-boxing.md) — the size of a boxed value in .NET.
- [../../go/data-types/arrays-and-slices.md](../../go/data-types/arrays-and-slices.md) — Go slice capacity and `append`.
- [../../rust/ownership/ownership-moves-and-drop.md](../../rust/ownership/ownership-moves-and-drop.md) — moves, `Copy` and `Clone` in Rust.
- [../../rust/collections/vec-hashmap-and-std-collections.md](../../rust/collections/vec-hashmap-and-std-collections.md) — `Vec` growth and `HashMap` hashers.
- [../../python/iteration-and-functional/iterators-generators-and-itertools.md](../../python/iteration-and-functional/iterators-generators-and-itertools.md) — one-pass iterators and generators.
- [../../python/data-structures/dicts-sets-and-hashing.md](../../python/data-structures/dicts-sets-and-hashing.md) — hashable keys in Python.
