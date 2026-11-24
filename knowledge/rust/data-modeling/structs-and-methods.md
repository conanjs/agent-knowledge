---
schema: knowledge-doc/v1
type: concept
topic: rust/data-modeling
status: verified
applies-to: ["Rust 1.100.0", "edition 2024"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [rust, struct, tuple-struct, unit-struct, struct-update-syntax, impl, methods, self, associated-functions, derive-debug, dbg]
---

# Structs and methods

## Summary
**TL;DR:** A struct groups data under one type: named fields (`struct Tank { litres: u32, capacity: u32 }`), positional fields (a **tuple struct**, `struct Celsius(f64);`, which is its own type even when another struct has the same fields), or no fields (a **unit-like struct**, size 0). Mutability belongs to the binding, never to single fields. **Struct update syntax** `Account { owner: …, ..alice }` copies the `Copy` fields of `alice` and **moves** the others, so `alice` is left partially moved. Methods live in `impl` blocks, and the receiver says what a method needs: `&self` reads, `&mut self` changes, `self` consumes, and `self: Box<Self>` (or `Rc`, `Arc`, `Pin`) asks for a pointer. Functions without `self` (`Tank::empty()`) are associated functions, usually constructors. `#[derive(Debug)]` enables `{:?}` and `{:#?}`; `dbg!` prints to stderr with file, line and column and hands its argument back.
**Use this when:** you define your first data types, a struct update leaves the original unusable (E0382 "partially moved"), a method call fails with E0596 or E0599, or you choose between `&self`, `&mut self` and `self`.
**Not this doc:** enums and `match` → `rust/data-modeling/enums-and-pattern-matching.md`; structs that hold references → `rust/ownership/lifetimes.md`; moves in general → `rust/ownership/ownership-moves-and-drop.md`; `pub` fields and modules → `rust/project-structure/packages-crates-and-modules.md`; traits and `derive` in general → `rust/traits-and-generics/generics-and-traits.md`; field order and size → `rust/unsafe/memory-layout-and-repr.md`; `Box` receivers and deref → `rust/smart-pointers/box-deref-and-drop.md`; newtype and typestate → `rust/design-patterns/type-driven-design.md`.

## Problem
Three common surprises: building `bob` from `alice` with `..alice` and then finding `alice` unusable; calling a method on a value declared without `mut` and getting E0596; and calling a method that takes `self`, after which the original variable is gone. A fourth is printing: `println!("{:?}", p)` fails with E0277 until the type opts in to `Debug`.

## Mental model
**Analogy:** a struct is a paper form with named boxes. The `impl` block is the list of actions printed on the back, and each action says how it handles the form: read it (`&self`), write on it (`&mut self`) or take it away for good (`self`). Struct update syntax is "fill the rest from that other form": boxes holding photocopiable values (`Copy` types such as `u32`) are photocopied, boxes holding originals (such as a `String`) are taken out of the old form.

**Artifact:** struct update in the lab (Rust 1.100.0) ✅[^1]:
```rust
#[derive(Debug)]
struct Account { owner: String, email: String, logins: u32, active: bool }

fn open_account(owner: String, email: String) -> Account {
    Account { owner, email, logins: 0, active: true } // field init shorthand
}

fn main() {
    let mut alice = open_account(String::from("alice"), String::from("a@example.org"));
    alice.logins += 1;                                  // `mut` covers every field
    let bob = Account { owner: String::from("bob"), ..alice };
    println!("{bob:?}");
    println!("{} {}", alice.owner, alice.logins);       // owner not taken, logins is Copy
}
```
```text
Account { owner: "bob", email: "a@example.org", logins: 1, active: true }
alice 1
```
Adding `println!("{}", alice.email);` fails with `error[E0382]: borrow of moved value: alice.email`, pointing at the `..alice` line as "value moved here" ✅[^1].

## How it works
1. **Three shapes.** Named-field structs; tuple structs, whose fields are `.0`, `.1` and which are destructured with the type name (`let Celsius(degrees) = freezing;`); and unit-like structs, written `struct Marker;` ✅[^2] ✅[^1]. On aarch64 the lab measured `Account` (two `String`s, `u32`, `bool`) at 56 bytes, `Celsius(f64)` at 8 and `Marker` at 0 ✅[^1]; why the sizes come out that way is owned by `rust/unsafe/memory-layout-and-repr.md`.
2. **Mutability is per binding.** The whole instance is mutable or none of it is ✅[^2]. `p.x = 5` on a `let p` fails with E0594 "cannot assign to `p.x`, as `p` is not declared as mutable" ✅[^1].
3. **Field init shorthand.** When a variable has the field's name, `Account { owner, email, … }` means `owner: owner, email: email` ✅[^2] ✅[^5].
4. **Struct update syntax.** `..base` comes last and fills every field not written out ✅[^2]. The base must be the same struct type, and its remaining fields are **moved or copied** ✅[^5]. Consequences measured in the lab ✅[^1]:
   - a moved field (`alice.email`) can no longer be read: E0382 "borrow of moved value";
   - the whole base can no longer be used: `println!("{:?}", alice)` gives E0382 "borrow of partially moved value: `alice`";
   - fields given explicitly in the new value (`owner`) and `Copy` fields (`logins`, `active`) stay usable ✅[^2].
   Moves themselves are explained in `rust/ownership/ownership-moves-and-drop.md`.
5. **Tuple structs are distinct types.** Passing a `Fahrenheit(98.6)` where `Celsius` is expected fails with E0308 "expected `Celsius`, found `Fahrenheit`", although both wrap one `f64` ✅[^2] ✅[^1]. This is the newtype idea, developed in `rust/design-patterns/type-driven-design.md`.
6. **Owned fields first.** `struct Tag { name: &str }` fails with E0106 "missing lifetime specifier" ✅[^2] ✅[^1]; use `String` until lifetimes are needed (`rust/ownership/lifetimes.md`).
7. **Methods and receivers.** A method is an associated function whose first parameter is `self` ✅[^6]. `&self` is short for `self: &Self`, where `Self` names the type of the `impl` block ✅[^4]. The receiver type may be `Self`, `&Self`, `&mut Self`, `Box<Self>`, `Rc<Self>`, `Arc<Self>` or `Pin<P>` ✅[^6].

   | Receiver | Caller needs | Caller afterwards | Error when misused (lab ✅[^1]) |
   |---|---|---|---|
   | `&self` | any binding | unchanged | — |
   | `&mut self` | a `mut` binding | changed | E0596 "cannot borrow `t` as mutable, as it is not declared as mutable" |
   | `self` | ownership | value moved away | E0382 "borrow of moved value: `t`", note "`Tank::into_report` takes ownership of the receiver `self`" |
   | `self: Box<Self>` | a `Box<Tank>` | box consumed | E0599 "no method named `boxed_label` found for struct `Tank`", hint `Box::new(t).boxed_label()` |

   Taking `self` by value is rare; it fits methods that turn the value into something else ✅[^4].
8. **Automatic referencing and dereferencing.** Rust has no `->` operator: in `t.fill(70)` the compiler adds the `&`, `&mut` or `*` the method's receiver needs ✅[^4]. In the lab `t.free_space()`, `Tank::free_space(&t)` and `(&&t).free_space()` all returned the same value ✅[^1].
9. **Associated functions and constants.** Functions in an `impl` block without `self` are called with `::` (`Tank::empty()`); they are the usual constructors, and `new` is a convention, not a keyword ✅[^4]. An `impl` block may also hold associated constants (`const DEFAULT_CAPACITY: u32 = 50;`, read as `Self::DEFAULT_CAPACITY`) ✅[^6]. A type may have several `impl` blocks ✅[^4]. A method may share a field's name: `t.litres` is the field, `t.litres()` the method ✅[^4] ✅[^1].
10. **Debug output.** Structs have no `Debug` or `Display` implementation until you write or derive one: `{:?}` on a plain struct fails with E0277 "`Point` doesn't implement `Debug`" and the hint `#[derive(Debug)]` ✅[^3] ✅[^1]. `{:#?}` pretty-prints one field per line ✅[^3].
11. **`dbg!`.** It prints `[file:line:column] expression = value` to **stderr**, then returns the value, so it can wrap a sub-expression ✅[^7] ✅[^3]. It takes ownership: `dbg!(t);` followed by `t.litres` fails with E0382 and the hint `dbg!(&t)` ✅[^7] ✅[^1]. It also prints in release builds ✅[^7] ✅[^1].

## Worked example
A fuel tank with every receiver kind (lab) ✅[^1]:
```rust
#[derive(Debug)]
struct Tank { litres: u32, capacity: u32 }

impl Tank {
    const DEFAULT_CAPACITY: u32 = 50;                    // associated constant
    fn empty() -> Self {                                 // associated function
        Self { litres: 0, capacity: Self::DEFAULT_CAPACITY }
    }
    fn free_space(&self) -> u32 { self.capacity - self.litres }   // read
    fn litres(&self) -> bool { self.litres > 0 }                  // same name as a field
    fn fill(&mut self, amount: u32) -> u32 {                      // change
        let added = amount.min(self.free_space());
        self.litres += added;
        added
    }
    fn into_report(self) -> String { format!("{}/{} L", self.litres, self.capacity) } // consume
    fn boxed_label(self: Box<Self>) -> String { format!("boxed tank of {}", self.capacity) }
}

impl Tank {                                              // a second impl block
    fn can_hold(&self, other: &Tank) -> bool { self.capacity >= other.capacity }
}

fn main() {
    let mut t = Tank::empty();
    let added = t.fill(70);                              // auto-borrow: (&mut t).fill(70)
    println!("added {added}, free {}, field {}, method {}", t.free_space(), t.litres, t.litres());
    println!("same call: {} {}", Tank::free_space(&t), (&&t).free_space());
    let small = Tank { litres: 0, capacity: 20 };
    println!("t can hold small: {}", t.can_hold(&small));
    println!("{}", Box::new(small).boxed_label());
    let doubled = dbg!(t.free_space() * 2);              // prints to stderr, returns the value
    dbg!(&t);                                            // borrow, so t is not moved
    println!("doubled = {doubled}, report = {}", t.into_report());
}
```
stdout:
```text
added 50, free 0, field 50, method true
same call: 0 0
t can hold small: true
boxed tank of 20
doubled = 0, report = 50/50 L
```
stderr:
```text
[tank.rs:32:19] t.free_space() * 2 = 0
[tank.rs:33:5] &t = Tank {
    litres: 50,
    capacity: 50,
}
```
Reading it: `fill(70)` on an empty 50-litre tank adds only `min(70, 50) = 50`, so the free space is 0; `into_report` is the last call because it consumes `t`.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `..base` where every non-`Copy` field is given explicitly | `base` stays fully usable | Only `Copy` fields are taken from it ✅[^2] |
| `..base` while another field of `base` is mutably borrowed | Allowed if the update reads only other fields | The update touches only the fields it fills ✅[^5] |
| A derived `Debug` is the only reader of a field | `warning: fields email and active are never read`, with the note that the derived `Debug` impl "is intentionally ignored during dead code analysis" ✅[^1] | Printing a field for debugging is not counted as using it |
| `dbg!` left in a release build | Still prints to stderr (`[dbgrel.rs:1:21] 2 + 3 = 5`) ✅[^1] | Same behaviour in every profile; meant for short-lived debugging ✅[^7] |
| `dbg!(1 + 1, "two")` with several arguments | Prints one line per value and returns the tuple `(2, "two")` ✅[^1] | Several arguments are treated as a tuple ✅[^7] |
| Calling a `self: Box<Self>` method on `Box<Tank>` | Works; the box is consumed | `Box<Self>` is an allowed receiver ✅[^6] ✅[^1] |
| Unit-like struct | Size 0, still a distinct type, useful for implementing traits on no data ✅[^2] ✅[^1] | No fields to store |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Named fields | Self-documenting access (`t.capacity`) | More typing for small wrappers |
| Tuple struct | Short; a new type around one value | `.0` says nothing about meaning |
| `&self` / `&mut self` | Caller keeps the value | Cannot hand the fields away |
| `self` | Can move fields out, prevents reuse after a conversion ✅[^4] | Caller loses the value; clone first if still needed |
| Struct update `..base` | Concise variant of a template | Moves non-`Copy` fields out of the template |

## Takeaways
- After `..base`, assume `base` is gone unless every non-`Copy` field was given explicitly; clone the template when you need it again. [rule-candidate]
- Pick the narrowest receiver: `&self`, then `&mut self`, then `self` only for conversions. [rule-candidate]
- Wrap distinct units or IDs in tuple structs instead of passing bare `f64` or `u64`. [rule-candidate]
- Derive `Debug` on every data type you define; it costs nothing until used.
- Use `dbg!(&x)` while debugging and remove it before committing. [rule-candidate]

## Verification status
- Verified: 51 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `linux/lab-setup.md` — the Rust 1.100.0 lab (`rustlab:1`) where every behaviour marked with this note ran on 2026-11-24. [^1]
- [Defining and Instantiating Structs](https://doc.rust-lang.org/book/ch05-01-defining-structs.html) — The Rust Programming Language (Klabnik, Nichols, Krycho and the Rust community), living. Backs: struct shapes, whole-instance mutability, field init shorthand, struct update moves, tuple and unit-like structs, owned fields. [^2]
- [An Example Program Using Structs](https://doc.rust-lang.org/book/ch05-02-example-structs.html) — The Rust Programming Language, living. Backs: `#[derive(Debug)]`, `{:?}`/`{:#?}`, `dbg!` to stderr. [^3]
- [Methods](https://doc.rust-lang.org/book/ch05-03-method-syntax.html) — The Rust Programming Language, living. Backs: `&self` shorthand, receivers, getters, automatic referencing, associated functions, several `impl` blocks. [^4]
- [Struct expressions](https://doc.rust-lang.org/reference/expressions/struct-expr.html) — The Rust Reference, living. Backs: functional update syntax moves or copies the remaining fields, field init shorthand. [^5]
- [Associated items](https://doc.rust-lang.org/reference/items/associated-items.html) — The Rust Reference, living. Backs: methods, allowed receiver types, associated constants. [^6]
- [dbg in std](https://doc.rust-lang.org/std/macro.dbg.html) — Rust standard library docs 1.100.0, living. Backs: output format, ownership, release builds, several arguments. [^7]

## Related
- `rust/data-modeling/enums-and-pattern-matching.md` — the other half of data modeling: types with variants.
- `rust/ownership/ownership-moves-and-drop.md` — why `..base` and `self` move values.
- `rust/traits-and-generics/core-traits-reference.md` — `Debug`, `Clone`, `Copy` and the other derivable traits.
- `rust/design-patterns/type-driven-design.md` — newtype, builder and typestate built on structs.
