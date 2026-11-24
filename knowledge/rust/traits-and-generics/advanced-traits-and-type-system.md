---
schema: knowledge-doc/v1
type: concept
topic: rust/traits-and-generics
status: verified
applies-to: ["Rust 1.100.0", "edition 2024", "tokio 1.54"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [rust, associated-types, operator-overloading, fully-qualified-syntax, supertraits, newtype, gat, hrtb, auto-traits, sized, never-type, const-generics, async-fn-in-trait, function-pointers]
---

# Advanced traits and the type system

## Summary
**TL;DR:** A trait can carry more than methods. An associated type is an output the implementer fixes once per impl; a generic parameter is an input the caller picks, so one type can implement `ConvertTo<f64>` and `ConvertTo<String>`. Generic parameters may have defaults (`Add<Rhs = Self>`, the basis of operator overloading), traits may require other traits (supertraits), and associated types may themselves be generic (GATs, generic associated types). Around traits sit the rest of the advanced type system: HRTB (higher-ranked trait bounds, `for<'a>`), auto traits such as `Send` and `Sync`, the implicit `Sized` bound and `?Sized`, the never type `!` (fully stable since Rust 1.100, where `Infallible` became an alias for it), type aliases (synonyms, unlike newtypes), const generics, `impl Trait` and `async fn` in traits (stable since 1.75 but still not usable through `dyn`), and function pointers versus closure traits. Fully qualified syntax, `<Type as Trait>::item`, picks between same-named items.
**Use this when:** you choose between an associated type and a type parameter, overload an operator, see E0034, E0283 or E0790, write a lending iterator, a bound must hold "for every lifetime", a generic must accept `str` or `[T]`, a function never returns, an array length is a parameter, or an `async fn` trait must be spawned or used as `dyn`.
**Not this doc:** generics, bounds, blanket impls and coherence → `rust/traits-and-generics/generics-and-traits.md`; `dyn` and its rules → `rust/traits-and-generics/trait-objects-and-dynamic-dispatch.md`; lifetimes and elision → `rust/ownership/lifetimes.md`; variance and `PhantomData` → `rust/unsafe/variance-phantomdata-and-drop-check.md`; closure captures and how `Fn`/`FnMut`/`FnOnce` are inferred → `rust/closures-and-iterators/closures-and-fn-traits.md`; futures and executors → `rust/async/futures-and-async-await.md`; newtypes for domain modelling → `rust/design-patterns/type-driven-design.md`.

## Problem
These features show up as errors before they show up as tools: `let x = c.convert()` fails with E0283 "type annotations needed"; `machine.start()` fails with E0034 when two traits both define `start`; `Engine::kind()` fails with E0790; a standard `Iterator` cannot hand out a `&mut` window into itself; `let first = |s: &str| s.split(' ').next().unwrap();` fails with "lifetime may not live long enough"; `[u8; N + 1]` is rejected; and a trait with `async fn` can neither be spawned on a multi-threaded runtime from generic code nor turned into `dyn`.

## Mental model
**Analogy:** a trait is a contract form. A generic parameter is a blank the *caller* fills in, so the same type can sign several copies (`From<u8>`, `From<&str>`). An associated type is a blank the *implementer* fills in once, so an `Iterator` has exactly one `Item`. Every other feature here adds a clause to the form: "signed only by those who also signed X" (supertrait), "valid for every lifetime" (HRTB), "about a number, not a type" (const generic).

**Artifact:** one associated type, one generic parameter ✅[^1]:
```rust
trait Decoder { type Output; fn decode(&self, raw: &str) -> Self::Output; }
struct IntDecoder;
impl Decoder for IntDecoder { type Output = i64; fn decode(&self, raw: &str) -> i64 { raw.trim().parse().unwrap_or(0) } }
trait ConvertTo<T> { fn convert(&self) -> T; }
struct Celsius(f64);
impl ConvertTo<f64> for Celsius { fn convert(&self) -> f64 { self.0 * 1.8 + 32.0 } }
impl ConvertTo<String> for Celsius { fn convert(&self) -> String { format!("{} C", self.0) } }
let n = IntDecoder.decode(" 42 ");       // one impl: no annotation
let f: f64 = Celsius(100.0).convert();   // two impls: the annotation picks one
let s: String = Celsius(100.0).convert();
println!("{n} {f} {s}");                 // 42 212 100 C
```
Without the annotation, `let x = Celsius(1.0).convert();` fails with `error[E0283]: type annotations needed` and "multiple `impl`s satisfying `Celsius: ConvertTo<_>` found" ✅[^1]. The Book states the rule: a generic trait can be implemented for a type many times, an associated type only once ✅[^2].

## How it works
1. **Default type parameters and operators.** `Add` is declared with `Rhs = Self`, so `impl Add for Meters` means `Meters + Meters`, and `impl Add<Centimeters> for Meters` adds a second right-hand type ✅[^2]. The result type is the associated type `Output`. In the lab, `Meters(1.5) + Meters(2.0)` then `+= Meters(0.5)` gave `Meters(4.0)`, `Meters(1.0) + Centimeters(25.0)` gave `Meters(1.25)`, and `Neg` and `Index` worked the same way ✅[^1]. Structs take defaults too: with `struct Grid<T = f32>`, a bare `Grid` is `Grid<f32>` ✅[^1].
2. **Fully qualified syntax.** A method call prefers the type's inherent method: with an inherent `start` plus `Engine::start` and `Printer::start`, `m.start()` printed `inherent start`, `Engine::start(&m)` printed `engine start` and `<Machine as Printer>::start(&m)` printed `printer start` ✅[^1]. Without the inherent method, `m.start()` is E0034 "multiple applicable items in scope" ✅[^1]. An associated function without `self` cannot be resolved from the trait name: `Engine::kind()` is E0790, fixed by `<Machine as Engine>::kind()` ✅[^1]. The general form is `<Type as Trait>::function(receiver_if_method, args…)` ✅[^2].
3. **Supertraits.** `trait Badge: fmt::Display` lets a default method use `self` with `{}`; `User { name: "ana" }.badge()` printed `[ana]` ✅[^1]. Implementing `Badge` for a type without `Display` is E0277 "required by a bound in `Badge`" ✅[^1] ✅[^2].
4. **Newtype around the orphan rule.** A foreign trait on a foreign type is rejected (E0117, see `rust/traits-and-generics/generics-and-traits.md`); a one-field tuple struct makes the type local, and the wrapper costs nothing at run time ✅[^2]:
   ```rust
   struct Bytes(Vec<u8>);
   impl fmt::Display for Bytes {
       fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
           for b in &self.0 { write!(f, "{b:02x}")?; }
           Ok(())
       }
   }
   println!("{}", Bytes(vec![0xde, 0xad, 0x01]));   // dead01
   ```
   The output `dead01` was measured ✅[^1]. The wrapper hides `Vec`'s methods; forwarding or `Deref` brings them back, with the trade-off in `rust/design-patterns/idioms-and-api-guidelines.md`.
5. **GATs.** Associated types may take lifetime, type and const parameters (stable since Rust 1.65) ✅[^11] ✅[^6]. That allows a lending iterator whose items borrow from the iterator itself, which `Iterator` cannot express ✅[^11]:
   ```rust
   trait LendingIter {
       type Item<'a> where Self: 'a;
       fn next<'a>(&'a mut self) -> Option<Self::Item<'a>>;
   }
   struct WindowsMut { data: Vec<i32>, start: usize, width: usize }
   impl LendingIter for WindowsMut {
       type Item<'a> = &'a mut [i32] where Self: 'a;
       fn next<'a>(&'a mut self) -> Option<&'a mut [i32]> {
           let end = self.start + self.width;
           if end > self.data.len() { return None; }
           let w = &mut self.data[self.start..end];
           self.start += 1;
           Some(w)
       }
   }
   let mut it = WindowsMut { data: vec![1, 2, 3, 4], start: 0, width: 2 };
   while let Some(w) = it.next() { w[1] += w[0]; }   // it.data == [1, 3, 6, 10]
   ```
   Overlapping mutable windows produced the running sum `[1, 3, 6, 10]` ✅[^1]. Holding two items at once (`let a = it.next(); let b = it.next(); use a`) is E0499, because each item keeps `it` mutably borrowed ✅[^1]. The `where Self: 'a` on the declaration is required: bounds provable from the methods' signatures must be repeated on the GAT ✅[^6].
6. **HRTB.** `for<'a> F: Fn(&'a str) -> &'a str` means "for every lifetime `'a`", not for one lifetime the caller picks ✅[^5]. An explicit `for<'a>` is required when the lifetime sits on something that is not an `Fn` argument, such as `where for<'a> &'a C: IntoIterator<Item = &'a i32>`: `sum_all(&vec![1, 2, 3])` gave `6` and `sum_all(&BTreeSet::from([10, 20]))` gave `30` ✅[^1]. Trait objects take it too: `Box<dyn for<'a> Fn(&'a str) -> &'a str>` stored `trim_start` and returned `"x"` for `"   x"` ✅[^1]. A closure bound to a `let` gets no higher-ranked signature from its context: `let first = |s: &str| s.split(' ').next().unwrap();` failed with "returning this value requires that `'1` must outlive `'2`", and passing the same closure through `fn hr<F: for<'a> Fn(&'a str) -> &'a str>(f: F) -> F` compiled and printed `a` ✅[^1].
7. **Auto traits and marker traits.** `Send`, `Sync`, `Unpin`, `UnwindSafe` and `RefUnwindSafe` are auto traits: a struct, enum or tuple gets one when all its fields have it ✅[^7]. A struct holding an `Rc<u32>` moved into `thread::spawn` was E0277 "`Rc<u32>` cannot be sent between threads safely"; `Cell<u8>` passed a `T: Send` check and failed `T: Sync` ✅[^1]. A marker field such as `PhantomData<*const ()>` opts a type out of both at zero size (`size_of` was 0) ✅[^1]; `PhantomData` itself is owned by `rust/unsafe/variance-phantomdata-and-drop-check.md`. A user-defined marker trait is just a trait with no items used as a bound (`trait Audited {}`) ✅[^1].
8. **`Sized` and `?Sized`.** Every type parameter except `Self` in a trait gets an implicit `Sized` bound; `?Sized` relaxes it ✅[^7] ✅[^5]. `show::<str>(s)` against `fn show<T: Debug>(x: &T)` failed with E0277 "the size for values of type `str` cannot be known at compilation time" and the help "consider relaxing the implicit `Sized` restriction"; with `T: Debug + ?Sized` it printed `"hi"` and `[1, 2]` ✅[^1]. Because `Self` is not implicitly `Sized`, `impl Measure for str` and `impl Measure for [u8]` compile ✅[^1] ✅[^7]. Pointers to unsized values are wide: `&str`, `&[u8]` and `Box<str>` measured 16 bytes on aarch64, `&u8` 8 ✅[^1] ✅[^3].
9. **The never type `!`.** It has no values and marks computations that never finish; an expression of type `!` coerces to any type ✅[^8] ✅[^3]. `continue` inside `match r.parse() { Ok(v) => v, Err(_) => continue }` and a `fn give_up(..) -> !` in an `if` branch both type-check as the other arm's type ✅[^1]. Rust 1.100.0 (2026-11-12) made `!` usable in every type position and turned `Infallible` into an alias for it ✅[^9]: in the lab, `type Never = !;`, `Result<String, !>`, `Vec<!>` and `impl Describe for !` compiled on stable, `TypeId::of::<Infallible>() == TypeId::of::<!>()` printed `true`, and `size_of::<Result<u8, !>>()` was 1 ✅[^1]. A `Result<T, !>` needs no `Err` arm: `let Ok(text) = v;` is irrefutable (allowed since 1.82 for uninhabited types matched by value) ✅[^12] ✅[^1].
10. **Type aliases.** `type Kilos = f64;` is a synonym, not a new type ✅[^3]: assigning a `Kilos` to a `Pounds` compiled, while passing an `Ounces` newtype where a `Grams` newtype was expected was E0308 ✅[^1]. Aliases shorten long types: `type Callback = Box<dyn Fn(u8) -> u8 + Send + 'static>`, `type ParseResult<T> = Result<T, ParseIntError>` ✅[^1].
11. **Const generics.** A parameter can be a value: `struct Ring<const N: usize> { slots: [u32; N], head: usize }`, and `fn sum_arr<const N: usize>(a: [i32; N])` inferred `N = 3` and `N = 5` from its arguments ✅[^1]. `fn header<const N: usize>(b: &[u8]) -> Option<[u8; N]>` returned `Some([127, 69, 76, 70])` for `b"\x7fELF...."` and `None` for `b"ab"` ✅[^1]. Allowed parameter types are the integer types, `char` and `bool` ✅[^10] (stable since 1.51 ✅[^13]); `const F: f32` was rejected with "the only supported types are integers, `bool`, and `char`" ✅[^1]. A parameter must appear alone in a type: `[u8; N + 1]` failed with "generic parameters may not be used in const operations" ✅[^1] ✅[^10].
12. **`impl Trait` and `async fn` in traits.** Both have been stable since Rust 1.75 ✅[^14]. Each `-> impl Trait` in a trait method becomes an anonymous associated type chosen by each impl ✅[^15], and `async fn` is the same with a hidden `Future`. Such methods are not dispatchable, so the trait is not dyn compatible ✅[^16] — still true in 1.100: `&dyn Store` was E0038 "because method `load` is `async`" ✅[^1]. The hidden future carries no `Send` bound, which the worked example shows. Writing a `Send` bound at the use site with return type notation (`S: Store<load(..): Send>`) was still E0658 "return type notation is experimental" in 1.100 ✅[^1].
13. **Function pointers and closures.** `fn(i32) -> i32` is a function-pointer type; functions coerce to it and it implements `Fn`, `FnMut` and `FnOnce` ✅[^4]. Closures coerce to it only when they capture nothing ✅[^17]: `twice(|x| x * 10, 3)` gave `300`, `twice(|x| x + k, 3)` was E0308 "closures can only be coerced to `fn` types if they do not capture any variables" ✅[^1]. Tuple-struct constructors and enum variants are functions: `vec![1, 2].into_iter().map(Id)` gave `[Id(1), Id(2)]` ✅[^1] ✅[^4]. Measured sizes: a `fn` pointer 8 bytes, a function item (`inc` itself) 0, a closure capturing one `i32` 4 ✅[^1].

## Worked example
`async fn` in a trait, the `Send` problem and the two ways out (lab project `proj_async`, tokio 1.54.1) ✅[^1]:
```rust
use std::{future::Future, pin::Pin, sync::Arc};
trait Store { async fn load(&self, key: u32) -> String; }
struct Mem;
impl Store for Mem { async fn load(&self, key: u32) -> String { format!("value-{key}") } }

trait SendStore { fn load(&self, key: u32) -> impl Future<Output = String> + Send; }   // desugared, with Send
struct Remote;
impl SendStore for Remote { async fn load(&self, key: u32) -> String { format!("remote-{key}") } }
fn spawn_load<S: SendStore + Send + Sync + 'static>(s: Arc<S>) -> tokio::task::JoinHandle<String> {
    tokio::spawn(async move { s.load(9).await })
}

trait DynStore { fn load(&self, key: u32) -> Pin<Box<dyn Future<Output = String> + Send + '_>>; }
struct Disk;
impl DynStore for Disk {
    fn load(&self, key: u32) -> Pin<Box<dyn Future<Output = String> + Send + '_>> { Box::pin(async move { format!("boxed-{key}") }) }
}

trait Source { fn ids(&self) -> impl Iterator<Item = u32>; }
struct Three;
impl Source for Three { fn ids(&self) -> impl Iterator<Item = u32> { 1..=3 } }

#[tokio::main]
async fn main() {
    println!("{}", Mem.load(7).await);
    println!("{}", spawn_load(Arc::new(Remote)).await.unwrap());
    let stores: Vec<Box<dyn DynStore>> = vec![Box::new(Disk)];
    println!("{}", stores[0].load(1).await);
    println!("{:?}", Three.ids().collect::<Vec<_>>());
}
```
```console
value-7
remote-9
boxed-1
[1, 2, 3]
```
| Step | What happened | Why |
|---|---|---|
| Same `spawn_load` written for `S: Store` | "future cannot be sent between threads safely … the trait `Send` is not implemented for `impl Future<Output = String>`"; rustc suggests the `SendStore` signature | `async fn` promises no auto traits for its future ✅[^1] ✅[^14] |
| `pub trait PubStore { async fn get(&self, key: u32) -> String; }` in the library | Warning `async_fn_in_trait`: "use of `async fn` in public traits is discouraged as auto trait bounds cannot be specified" | Callers could never add `Send` later ✅[^1] ✅[^14] |
| `SendStore` impl written with `async fn` | Accepted; the future is checked to be `Send` | An `async fn` may implement the desugared method ✅[^1] |
| `DynStore` with a boxed future | Works as `Box<dyn DynStore>` | Its return type is a concrete `Pin<Box<dyn Future>>`, so the method is dispatchable ✅[^1] ✅[^16] |
| `Three.ids()` | `[1, 2, 3]` | Return-position `impl Trait` in a trait ✅[^1] ✅[^15] |

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Generic trait with two impls, result unannotated | E0283 | The compiler cannot pick the impl ✅[^1] |
| Same method name in two traits, no inherent method | E0034; use `Trait::m(&x)` | Ambiguous method call ✅[^1] |
| `Trait::assoc_fn()` with no `self` | E0790 | Needs `<Type as Trait>::assoc_fn()` ✅[^1] |
| Two items from a lending iterator alive together | E0499 | Each item borrows the iterator mutably ✅[^1] |
| `let f = \|s: &str\| s` style closure returning its argument | Lifetime error | No higher-ranked signature is inferred for a bare `let`; pass it through a bound ✅[^1] |
| `let z: [u8; 33] = Default::default();` | E0277, while `[u8; 32]` compiles | `Default` for arrays stops at length 32 ✅[^1] |
| `const F: f32` parameter | Rejected | Only integers, `bool`, `char` ✅[^1] ✅[^10] |
| `Cell<u8>` shared across threads | Not `Sync` (E0277) | Interior mutability without synchronisation ✅[^1] |
| `!` in edition 2015–2021 code that relied on `()` fallback | May change meaning in 1.100 | The never-type fallback moved from `()` to `!` in those editions ✅[^9] |
| `Store<load(..): Send>` on stable | E0658 | Return type notation is unstable ✅[^1] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Associated type | One impl per type; no annotations at call sites | A type cannot offer several outputs |
| Generic trait parameter | Several impls per type (`From<u8>`, `From<&str>`) | Calls may need annotations (E0283) |
| `async fn` in a trait | Shortest form; static dispatch | No `Send` bound, no `dyn` ✅[^14] ✅[^16] |
| `fn … -> impl Future + Send` | Spawnable from generic code | Every impl must produce a `Send` future |
| `Pin<Box<dyn Future + Send + '_>>` return | Dyn compatible | A `Box::pin` (heap allocation) per call |
| Type alias | Shorter signatures | No extra type safety |
| Newtype | A distinct type; orphan workaround | Forwarding boilerplate |
| `fn` pointer parameter | One concrete type; tables of functions | Rejects capturing closures; use `impl Fn` for those |

## Takeaways
- Use an associated type when each implementing type has exactly one natural answer; use a generic parameter when several make sense. [rule-candidate]
- In public traits, prefer `fn m(&self) -> impl Future<Output = T> + Send` over `async fn` when callers may spawn the future. [rule-candidate]
- Write `T: ?Sized` on generic helpers that take `&T`, so `str` and slices are accepted. [rule-candidate]
- On Rust 1.100 or later, prefer `!` over `Infallible` in new signatures; both are the same type.
- Reach for `<Type as Trait>::item` as soon as two traits or an inherent impl share a name.

## Verification status
- Verified: 87 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `linux/lab-setup.md` — the Rust 1.100.0 lab (`rustlab:1`) where every behaviour marked with this note ran on 2026-11-24. [^1]
- [Advanced Traits](https://doc.rust-lang.org/book/ch20-02-advanced-traits.html) — The Rust Programming Language (Klabnik, Nichols, Krycho and the Rust community), living. Backs: associated types versus generics, `Rhs = Self`, fully qualified syntax, supertraits, newtype with no runtime penalty. [^2]
- [Advanced Types](https://doc.rust-lang.org/book/ch20-03-advanced-types.html) — The Rust Programming Language, living. Backs: aliases are synonyms, the never type coerces, `&str` is address plus length. [^3]
- [Advanced Functions and Closures](https://doc.rust-lang.org/book/ch20-04-advanced-functions-and-closures.html) — The Rust Programming Language, living. Backs: `fn` pointers implement the closure traits; variant initializers as functions. [^4]
- [Trait and lifetime bounds](https://doc.rust-lang.org/reference/trait-bounds.html) — The Rust Reference, living. Backs: higher-ranked bounds hold for all lifetimes; `?Sized` relaxes the implicit bound. [^5]
- [Associated items](https://doc.rust-lang.org/reference/items/associated-items.html) — The Rust Reference, living. Backs: GAT definition, required `where` clauses on GATs. [^6]
- [Special types and traits](https://doc.rust-lang.org/reference/special-types-and-traits.html) — The Rust Reference, living. Backs: the auto-trait list and their structural rule; implicit `Sized` except `Self` in traits. [^7]
- [Never type](https://doc.rust-lang.org/reference/types/never.html) — The Rust Reference, living. Backs: `!` has no values, coerces to any type, `Infallible` is an alias. [^8]
- [Announcing Rust 1.100.0](https://blog.rust-lang.org/2026/11/12/Rust-1.100.0/) — The Rust Release Team, 2026. Backs: never type stable everywhere, `Infallible` alias, fallback change in pre-2024 editions. [^9]
- [Generic parameters](https://doc.rust-lang.org/reference/items/generics.html) — The Rust Reference, living. Backs: allowed const parameter types, standalone-use restriction. [^10]
- [Announcing Rust 1.65.0](https://blog.rust-lang.org/2022/11/03/Rust-1.65.0/) — The Rust Release Team, 2022. Backs: GATs stabilized, lending-iterator motivation. [^11]
- [Announcing Rust 1.82.0](https://blog.rust-lang.org/2024/10/17/Rust-1.82.0/) — The Rust Release Team, 2024. Backs: omitting patterns for empty types. [^12]
- [Announcing Rust 1.51.0](https://blog.rust-lang.org/2021/03/25/Rust-1.51.0/) — The Rust Release Team, 2021. Backs: const generics MVP over integers, `bool`, `char`. [^13]
- [Announcing `async fn` and return-position `impl Trait` in traits](https://blog.rust-lang.org/2023/12/21/async-fn-rpit-in-traits/) — Tyler Mandry on behalf of the Async Working Group, 2023. Backs: stable in 1.75, not object safe, the `Send` bound problem and the public-trait warning. [^14]
- [Impl trait type](https://doc.rust-lang.org/reference/types/impl-trait.html) — The Rust Reference, living. Backs: `impl Trait` in trait methods desugars to an anonymous associated type. [^15]
- [Traits: Dyn compatibility](https://doc.rust-lang.org/reference/items/traits.html#dyn-compatibility) — The Rust Reference, living. Backs: `async fn` and return-position `impl Trait` methods are not dispatchable. [^16]
- [Type coercions](https://doc.rust-lang.org/reference/type-coercions.html) — The Rust Reference, living. Backs: non-capturing closures coerce to `fn` pointers. [^17]

## Related
- `rust/traits-and-generics/generics-and-traits.md` — bounds, blanket impls, coherence.
- `rust/traits-and-generics/trait-objects-and-dynamic-dispatch.md` — what "not dyn compatible" rules out.
- `rust/traits-and-generics/core-traits-reference.md` — `Send`, `Sync`, `Sized`, `Fn*` in the catalog.
- `rust/ownership/lifetimes.md` — the lifetimes HRTB quantifies over.
- `rust/async/futures-and-async-await.md` — what the hidden future of an `async fn` is.
- `rust/concurrency/threads-channels-and-locks.md` — `Send` and `Sync` in thread code.
