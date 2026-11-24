---
schema: knowledge-doc/v1
type: concept
topic: rust/traits-and-generics
status: verified
applies-to: ["Rust 1.100.0", "edition 2024"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [rust, dyn, trait-objects, vtable, dynamic-dispatch, dyn-compatibility, object-safety, any, downcasting, upcasting]
---

# Trait objects, vtables and dynamic dispatch

## Summary
**TL;DR:** `dyn Trait` stands for "some value of a type that implements `Trait`, decided at run time". It is a DST (dynamically sized type), so it always sits behind a pointer — `&dyn`, `Box<dyn>`, `Rc<dyn>`, `Arc<dyn>` — and that pointer is wide: a data pointer plus a pointer to a vtable (virtual method table) holding the type's size, alignment, drop function and one function pointer per method. A method call loads the function pointer from the vtable and jumps to it (dynamic dispatch), which lets one collection mix types at the cost of an indirect call the optimizer cannot inline. Only dyn-compatible traits (formerly "object safe") can become trait objects; `where Self: Sized` takes single methods out of the vtable. Since Rust 1.86, `&dyn Sub` coerces to `&dyn Super`, which also turns `Any`-based downcasting from your own trait into a one-liner.
**Use this when:** you need a `Vec` of different types behind one trait, a plugin or callback registry, E0038 says a trait "is not dyn compatible", a `Box<dyn Trait>` will not accept a borrowed value, or `downcast_ref` returns `None` unexpectedly.
**Not this doc:** generics and static dispatch → `rust/traits-and-generics/generics-and-traits.md`; why `async fn` in a trait blocks `dyn` → `rust/traits-and-generics/advanced-traits-and-type-system.md`; how wide pointers and niches sit in memory → `rust/unsafe/memory-layout-and-repr.md`; `Box`, `Rc` and `Arc` themselves → `rust/smart-pointers/box-deref-and-drop.md` and `rust/smart-pointers/rc-refcell-and-interior-mutability.md`; the state pattern with `Box<dyn State>` → `rust/design-patterns/type-driven-design.md`.

## Problem
`Vec<T>` holds one `T`, so "a list of shapes, some squares, some circles" cannot be a generic vector. Rust has no struct inheritance to fall back on ✅[^13]. Reaching for `dyn Trait` then raises its own surprises: some traits refuse to become objects (E0038), `Box<dyn Display>` rejects a `&str` argument with a lifetime error, `size_of` of a `&dyn Trait` is twice that of a `&T`, and `boxed.type_id()` on a `Box<dyn Any>` compares unequal to the type that is obviously inside.

## Mental model
**Analogy:** a trait object is a parcel plus a laminated instruction card. The parcel is the value; the card, printed once per kind of parcel, says how big it is, how to dispose of it and which button does `area` or `name`. Whoever holds the parcel (the wide pointer) holds the card too, so they can use the parcel without knowing what is inside.

**Artifact:** sizes measured on aarch64 (64-bit pointers) ✅[^1]:
```rust
use std::mem::{size_of, size_of_val, align_of_val};
use std::any::type_name_of_val;
use std::{rc::Rc, sync::Arc};
trait Shape { fn area(&self) -> f64; fn name(&self) -> &'static str; }
struct Square(f64);
struct Tagged { r: f64, tag: [u8; 20] }
impl Shape for Square { fn area(&self) -> f64 { self.0 * self.0 } fn name(&self) -> &'static str { "square" } }
impl Shape for Tagged { fn area(&self) -> f64 { 3.14159 * self.r * self.r } fn name(&self) -> &'static str { "tagged" } }
fn main() {
    println!("&Square={} &dyn Shape={} &(dyn Shape+Send)={}", size_of::<&Square>(), size_of::<&dyn Shape>(), size_of::<&(dyn Shape + Send)>());
    println!("Box<Square>={} Box<dyn Shape>={} Rc<dyn Shape>={} Arc<dyn Shape>={}",
        size_of::<Box<Square>>(), size_of::<Box<dyn Shape>>(), size_of::<Rc<dyn Shape>>(), size_of::<Arc<dyn Shape>>());
    println!("Option<Box<dyn Shape>>={} &[u8]={} &str={}", size_of::<Option<Box<dyn Shape>>>(), size_of::<&[u8]>(), size_of::<&str>());
    let shapes: Vec<Box<dyn Shape>> = vec![Box::new(Square(2.0)), Box::new(Tagged { r: 1.0, tag: [0; 20] })];
    for s in &shapes {
        println!("{:7} area={:.3} size_of_val={} align_of_val={} type_name_of_val={}",
            s.name(), s.area(), size_of_val(&**s), align_of_val(&**s), type_name_of_val(&**s));
    }
}
```
```console
&Square=8 &dyn Shape=16 &(dyn Shape+Send)=16
Box<Square>=8 Box<dyn Shape>=16 Rc<dyn Shape>=16 Arc<dyn Shape>=16
Option<Box<dyn Shape>>=16 &[u8]=16 &str=16
square  area=4.000 size_of_val=8 align_of_val=8 type_name_of_val=dyn t01_sizes::Shape
tagged  area=3.142 size_of_val=32 align_of_val=8 type_name_of_val=dyn t01_sizes::Shape
```
Every pointer to a `dyn` is two words; adding an auto trait (`+ Send`) adds no word. `size_of_val` reports the concrete size (8 or 32), which the vtable stores, while `type_name_of_val` only sees `dyn Shape` ✅[^1] ✅[^11].

## How it works
**3 actors:**
- **The compiler at the coercion site** — its job: pair a data pointer with the vtable for (concrete type, trait), via the unsized coercion `T → dyn U`.
- **The wide pointer** — its job: carry both addresses to wherever the object travels, via two machine words.
- **The call site** — its job: run the method, via a load from a fixed vtable offset and an indirect branch.

```
 at the coercion site                       at the call site
 ────────────────────                       ────────────────
 let s: &dyn Shape = &Square(2.0);
   │ coercion T → dyn U
   ▼
 ┌───────────── &dyn Shape (16 B) ─┐        area_dyn(s)
 │ data ptr ──▶ Square(2.0)        │          │ ldr x1, [x1, #24]   ← vtable slot
 │ vtable ptr ─┐                   │          │ br  x1              ← indirect jump
 └─────────────┼───────────────────┘          ▼
               ▼                            <Square as Shape>::area
   vtable for (Square, Shape):
   [ drop_in_place | size | align | area | name ]
     +0              +8     +16     +24    +32
```

1. **Compiler, at the coercion site:**
   - Builds the vtable at compile time, via codegen of a static table that holds the type's size, alignment, a pointer to its `drop_in_place`, and one pointer per trait method (supertrait methods included) ✅[^11] ✅[^3].
   - Emits code that stores the data pointer next to the vtable address, via the unsized coercion `T` to `dyn U`, allowed when `T: U + Sized` and `U` is dyn compatible ✅[^5].
2. **Wide pointer, while the value travels:** it is a DST behind a pointer, so `&dyn`, `Box<dyn>`, `Rc<dyn>` and `Arc<dyn>` are all two words (16 bytes measured) ✅[^3] ✅[^1]. The concrete type is erased: only the vtable still knows it.
3. **Call site, at run time:** the method call compiles to "load slot, jump". The lab compiled `pub fn area_dyn(s: &dyn Shape) -> f64 { s.area() }` at `-C opt-level=2` to `ldr x1, [x1, #24]` then `br x1`, and `name_dyn` to the same with `#32`; the statically dispatched `area_static(s: &Square)` became `ldr d0, [x0]` and `fmul d0, d0, d0` with the method inlined ✅[^1]. Offsets 24 and 32 match three header entries before the methods; the slot order is a rustc detail, not a guarantee (the docs list the contents, not their layout) ✅[^11].
4. **Drop, size, align are always there.** They are what lets any `Box<dyn Trait>` be freed and measured without knowing its type ✅[^11]; `size_of_val` returned 8 and 32 for the two shapes ✅[^1].

**Dyn compatibility** decides whether step 1 is possible. A trait is dyn compatible when ✅[^4]:

| Rule | Intuition | Lab trigger |
|---|---|---|
| No `Sized` supertrait | `dyn Trait` is unsized | — |
| No associated consts; no associated types with generics | No slot can hold them | — |
| Every method is dispatchable or opts out with `where Self: Sized` | Each slot is one function pointer | — |
| Dispatchable: no type parameters (lifetimes are fine) | One slot cannot hold every instantiation ✅[^12] | `fn visit<V: Debug>(&self, v: V)` → E0038 "has generic type parameters" ✅[^1] |
| Dispatchable: `Self` only in the receiver | The caller does not know `Self`'s size | `fn duplicate(&self) -> Self` → E0038 "references the `Self` type in its return type" ✅[^1] |
| Dispatchable: receiver `&self`, `&mut self`, `Box<Self>`, `Rc<Self>`, `Arc<Self>` or `Pin<P>` of those | The data pointer must be reachable | — |
| Dispatchable: no `async fn`, no return-position `impl Trait` | Hidden return types differ per impl | `async fn load` → E0038 "because method `load` is `async`" ✅[^1] |

The concept was formerly called object safety ✅[^4]. Adding `where Self: Sized` to `duplicate` made the trait dyn compatible again: `note.duplicate()` still worked on the concrete type, and `d.duplicate()` on a `&dyn Duplicate` failed with "the `duplicate` method cannot be invoked on a trait object" ✅[^1] ✅[^12].

**Upcasting.** Since Rust 1.86 (2025-04-03) a pointer to `dyn Sub` coerces to a pointer to `dyn Super` when `Super` is a supertrait, for references, `Box`, `Arc` and raw pointers alike ✅[^10] ✅[^5]. Auto traits may be dropped in the same coercion (`dyn T + Send` to `dyn U`) ✅[^5].

**`Any` and downcasting.** `Any` is declared `pub trait Any: 'static`, so only types without non-`'static` borrows implement it ✅[^8]. `&dyn Any` offers `is::<T>()` and `downcast_ref::<T>()`, and `Box<dyn Any>` offers `downcast::<T>()` ✅[^7] ✅[^8]. Combined with upcasting, a trait declared `trait Component: Any` can be turned into `&dyn Any` and downcast with no extra `as_any` method ✅[^10] ✅[^1].

## Worked example
A component list where each element is downcast back to its concrete type (lab file `t03_upcast.rs`) ✅[^1]:
```rust
use std::any::Any;
trait Named { fn name(&self) -> String; }
trait Pet: Named { fn sound(&self) -> &'static str; }
struct Dog;
impl Named for Dog { fn name(&self) -> String { "Rex".into() } }
impl Pet for Dog { fn sound(&self) -> &'static str { "woof" } }
trait Component: Any { fn tick(&self) -> u32; }
struct Health(u32);
struct Speed(u32);
impl Component for Health { fn tick(&self) -> u32 { self.0 } }
impl Component for Speed { fn tick(&self) -> u32 { self.0 * 2 } }
fn main() {
    let p: &dyn Pet = &Dog;
    let n: &dyn Named = p;                 // upcast &dyn Pet → &dyn Named
    let b: Box<dyn Pet> = Box::new(Dog);
    let bn: Box<dyn Named> = b;            // upcast Box<dyn Pet> → Box<dyn Named>
    println!("{} says {}; {} {}", p.name(), p.sound(), n.name(), bn.name());
    let parts: Vec<Box<dyn Component>> = vec![Box::new(Health(10)), Box::new(Speed(3))];
    for c in &parts {
        let any: &dyn Any = &**c;          // upcast to Any
        match any.downcast_ref::<Health>() {
            Some(h) => println!("health {} (tick {})", h.0, c.tick()),
            None => println!("not health (tick {})", c.tick()),
        }
    }
}
```
```console
Rex says woof; Rex Rex
health 10 (tick 10)
not health (tick 6)
```
| Step | What runs | Result |
|---|---|---|
| `p.sound()` | vtable of (`Dog`, `Pet`), `sound` slot | `woof` |
| `n.name()` after `&dyn Pet → &dyn Named` | vtable of (`Dog`, `Named`) | `Rex` |
| `c.tick()` on element 0 and 1 | vtables of `Health` and `Speed` | `10`, then `3 * 2 = 6` |
| `any.downcast_ref::<Health>()` | compares the hidden `TypeId` with `Health`'s | `Some` for element 0, `None` for element 1 |

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `Box<dyn Iterator>` without `Item` | E0191 "the value of the associated type `Item` … must be specified" | Each associated type is part of the object type; write `dyn Iterator<Item = u32>` ✅[^1] |
| `&(dyn Display + Debug)` | E0225 "only auto traits can be used as additional traits" | One non-auto trait per object; make `trait Both: Display + Debug {}` ✅[^1] ✅[^3] |
| `fn keep(v: &mut Vec<Box<dyn Display>>, s: &str) { v.push(Box::new(s)) }` | "lifetime may not live long enough … must outlive `'static`" | `Box<dyn Trait>` means `Box<dyn Trait + 'static>`; `&'a dyn Trait` means `&'a (dyn Trait + 'a)`; write `Box<dyn Display + 'a>` ✅[^1] ✅[^6] |
| `boxed.type_id()` on `Box<dyn Any>` holding `5u8` | `false` against `TypeId::of::<u8>()`; `(*boxed).type_id()` gives `true` | The call resolves on the box, which is itself `Any` ✅[^1] ✅[^7] |
| `&dyn Any` from a struct holding `&'a str` | E0597, "coercion requires that `owned` is borrowed for `'static`" | `Any: 'static` ✅[^1] ✅[^8] |
| `type_name_of_val(&**boxed)` | `dyn t01_sizes::Shape`, not `Square` | It does not look through trait objects; its output is for diagnostics only ✅[^1] ✅[^9] |
| Comparing two vtable pointers | Unreliable either way | Vtables may be duplicated across codegen units or merged when identical ✅[^11] |
| `Option<Box<dyn Shape>>` | 16 bytes, same as `Box<dyn Shape>` | Niche in the non-null data pointer (`rust/unsafe/memory-layout-and-repr.md`) ✅[^1] |
| Method with `where Self: Sized` called on `dyn` | "cannot be invoked on a trait object" | It has no vtable slot ✅[^1] ✅[^12] |
| Trait with `async fn` used as `dyn` | E0038 | See `rust/traits-and-generics/advanced-traits-and-type-system.md` for workarounds ✅[^1] ✅[^4] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Generic `T: Trait` (static dispatch) | Calls can be inlined, as `area_static` was ✅[^1] | One copy per type; one type per container |
| `&dyn Trait` | No allocation; one copy of the caller's code | Lifetime-bound to the borrowed value; indirect calls that block inlining ✅[^2] |
| `Box<dyn Trait>` | Owns heterogeneous values; `'static` by default ✅[^6] | Each `Box` owns its own heap allocation ✅[^15] |
| `Arc<dyn Trait + Send + Sync>` | Shared across threads | Atomic reference-count updates, with their overhead ✅[^14] |
| An `enum` over the known types | Exhaustive `match`, no vtable, no allocation | Closed set: adding a type means editing the enum |

## Takeaways
- Reach for `dyn Trait` when the set of types is open or the collection is heterogeneous; otherwise prefer generics. [rule-candidate]
- Keep traits you may want as objects free of generic methods and `Self` returns, or mark those methods `where Self: Sized`. [rule-candidate]
- Write `Box<dyn Trait + '_>` (or a named lifetime) when the object may borrow; the default is `'static`.
- On `Box<dyn Any>`, call `(*b).type_id()` or `downcast_ref` on `&*b`, never `b.type_id()`. [rule-candidate]
- Use `trait MyTrait: Any` plus upcasting instead of hand-written `as_any` methods (Rust 1.86 and later).

## Verification status
- Verified: 52 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `linux/lab-setup.md` — the Rust 1.100.0 lab (`rustlab:1`) where every behaviour marked with this note ran on 2026-11-24. [^1]
- [Using Trait Objects to Abstract over Shared Behavior](https://doc.rust-lang.org/book/ch18-02-trait-objects.html) — The Rust Programming Language (Klabnik, Nichols, Krycho and the Rust community), living. Backs: trait objects need a pointer; dynamic dispatch has a lookup cost and prevents inlining. [^2]
- [Trait objects](https://doc.rust-lang.org/reference/types/trait-object.html) — The Rust Reference, living. Backs: one non-auto base trait plus auto traits; trait objects are DSTs behind wide pointers; vtable holds the methods of the trait and its supertraits. [^3]
- [Traits: Dyn compatibility](https://doc.rust-lang.org/reference/items/traits.html#dyn-compatibility) — The Rust Reference, living. Backs: the dyn-compatibility rules table, former name "object safety", `async fn` and RPIT not dispatchable. [^4]
- [Type coercions](https://doc.rust-lang.org/reference/type-coercions.html) — The Rust Reference, living. Backs: unsized coercion `T` to `dyn U`; upcasting `dyn T` to `dyn U` for supertraits, dropping auto traits. [^5]
- [Lifetime elision: Default trait object lifetimes](https://doc.rust-lang.org/reference/lifetime-elision.html#default-trait-object-lifetimes) — The Rust Reference, living. Backs: `Box<dyn Foo>` equals `Box<dyn Foo + 'static>`; `&'a dyn Foo` equals `&'a (dyn Foo + 'a)`. [^6]
- [Module `std::any`](https://doc.rust-lang.org/std/any/index.html) — Rust standard library docs, living. Backs: `is` and `downcast_ref` on `&dyn Any`; `type_id` on `Box<dyn Any>` returns the box's id. [^7]
- [Trait `Any`](https://doc.rust-lang.org/std/any/trait.Any.html) — Rust standard library docs, living. Backs: `Any: 'static`; types with non-`'static` references do not implement it; `Box<dyn Any>::downcast`. [^8]
- [Function `type_name_of_val`](https://doc.rust-lang.org/std/any/fn.type_name_of_val.html) — Rust standard library docs, living. Backs: does not resolve trait objects; output not guaranteed. [^9]
- [Announcing Rust 1.86.0](https://blog.rust-lang.org/2025/04/03/Rust-1.86.0/) — The Rust Release Team, 2025. Backs: trait upcasting stabilized, pointer kinds covered, use with `Any`. [^10]
- [Struct `DynMetadata`](https://doc.rust-lang.org/std/ptr/struct.DynMetadata.html) — Rust standard library docs, living. Backs: vtable holds size, alignment, `drop_in_place` and method pointers; comparing vtable pointers is unreliable. [^11]
- [Error code E0038](https://doc.rust-lang.org/error_codes/E0038.html) — Rust compiler error index, living. Backs: `where Self: Sized` makes a method unavailable on trait objects while keeping the trait dyn compatible. [^12]
- [Characteristics of Object-Oriented Languages](https://doc.rust-lang.org/book/ch18-01-what-is-oo.html) — The Rust Programming Language, living. Backs: no struct inheritance in Rust. [^13]
- [Trait `Send`](https://doc.rust-lang.org/std/marker/trait.Send.html) — Rust standard library docs, living. Backs: `Arc` uses atomic operations, with some overhead. [^14]
- [Struct `Box`](https://doc.rust-lang.org/std/boxed/struct.Box.html) — Rust standard library docs, living. Backs: a `Box` uniquely owns a heap allocation. [^15]

## Related
- `rust/traits-and-generics/generics-and-traits.md` — static dispatch and monomorphization.
- `rust/traits-and-generics/advanced-traits-and-type-system.md` — supertraits, `Sized`/`?Sized`, `async fn` in traits.
- `rust/unsafe/memory-layout-and-repr.md` — wide pointers and niches in memory.
- `rust/design-patterns/type-driven-design.md` — trait-object state pattern versus typestate.
- `rust/closures-and-iterators/closures-and-fn-traits.md` — `Box<dyn Fn>` for stored callbacks.
