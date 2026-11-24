---
schema: knowledge-doc/v1
type: concept
topic: rust/design-patterns
status: verified
applies-to: ["Rust 1.100.0", "edition 2024"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [rust, newtype, typestate, builder, phantomdata, zero-sized-types, parse-dont-validate, illegal-states, state-pattern]
---

# Type-driven design: newtypes, typestate and builders

## Summary
**TL;DR:** Move rules out of comments and runtime checks into types the compiler checks. A newtype (a one-field tuple struct, usually with a private field) makes `UserId` and `OrderId` different types and lets a parsing constructor be the only way to obtain an `Email`. An enum instead of flags-plus-options makes invalid combinations unrepresentable, and "parse, don't validate" returns a type that proves a check happened (`NonEmpty<T>`, `NonZeroU32`). Typestate puts an object's state in a ZST (zero-sized type) parameter, so a method called in the wrong state, or an old state reused, is a compile error rather than a runtime error. A builder gathers optional settings; a typestate builder makes `build()` exist only after the required fields are set. The markers and wrappers cost nothing at run time.
**Use this when:** two values share a primitive type but must never be swapped, a string must be validated once and trusted afterwards, a struct's `bool` and `Option` fields allow nonsense combinations, an API has an order of calls (bind → listen → accept), or a constructor has many optional and a few mandatory parameters.
**Not this doc:** the language-neutral idea with TypeScript examples → `software-design/functional-modeling/types-as-rules.md`; newtype as the orphan-rule workaround → `rust/traits-and-generics/advanced-traits-and-type-system.md`; `PhantomData` variance and drop check → `rust/unsafe/variance-phantomdata-and-drop-check.md`; enums and exhaustive `match` → `rust/data-modeling/enums-and-pattern-matching.md`; why `Option<NonZeroU32>` is 4 bytes → `rust/unsafe/memory-layout-and-repr.md`; constructors, `#[must_use]` and sealed traits → `rust/design-patterns/idioms-and-api-guidelines.md`.

## Problem
`fn cancel(order: u64)` accepts a user id without complaint. An email `String` is checked at the HTTP boundary and then re-checked, or not, in every function that receives it. `struct Link { connected: bool, peer: Option<String>, error: Option<String> }` allows eight combinations of which three make sense. A socket API that lets you call `accept()` before `listen()` can only report the mistake at run time, and a builder with a required URL can only panic or return an error from `build()` when the URL is missing.

## Mental model
**Analogy:** a ticket gate. Gate 2 only opens for a ticket stamped at gate 1, and gate 1 takes your unstamped ticket when it hands you the stamped one. The state lives in the ticket you hold, and an old ticket can no longer be presented.

**Artifact:** a socket whose state is a type parameter; each transition consumes the old value and returns a new type ✅[^1]:
```rust
use std::marker::PhantomData;
struct Unbound; struct Bound; struct Listening;              // zero-sized state markers
struct Socket<S> { port: u16, _state: PhantomData<S> }
impl Socket<Unbound> {
    fn new() -> Self { Socket { port: 0, _state: PhantomData } }
    fn bind(self, port: u16) -> Socket<Bound> { Socket { port, _state: PhantomData } }
}
impl Socket<Bound> { fn listen(self) -> Socket<Listening> { Socket { port: self.port, _state: PhantomData } } }
impl Socket<Listening> { fn accept(&self) -> String { format!("client on :{}", self.port) } }
impl<S> Socket<S> { fn port(&self) -> u16 { self.port } }  // every state
fn main() {
    let s = Socket::new().bind(8080);
    println!("bound port {}", s.port());
    let l = s.listen();
    println!("{}", l.accept());
    println!("size_of Socket<Listening>={} size_of u16={} size_of PhantomData<Bound>={}",
        std::mem::size_of::<Socket<Listening>>(), std::mem::size_of::<u16>(), std::mem::size_of::<PhantomData<Bound>>());
}
```
```console
bound port 8080
client on :8080
size_of Socket<Listening>=2 size_of u16=2 size_of PhantomData<Bound>=0
```
Calling `accept` one step too early, `Socket::new().bind(80).accept()`, fails with `error[E0599]: no method named `accept` found for struct `Socket<Bound>`` and the note "the method was found for `Socket<Listening>`" ✅[^1]. The state costs no memory: the whole socket is the size of its `u16` ✅[^1].

## How it works
1. **Newtypes for meaning.** A newtype gives a distinct static type to one interpretation of an underlying type ✅[^4] ✅[^2]. With `struct UserId(u64)` and `struct OrderId(u64)`, `cancel(u)` with a `UserId` failed with `error[E0308]: mismatched types … expected `OrderId`, found `UserId`` ✅[^1]. The wrapper has no runtime overhead ✅[^5]; `size_of::<UserId>()` was 8, the same as `u64` ✅[^1]. The cost is boilerplate: every method or trait you want on the wrapper must be forwarded or implemented ✅[^5].
2. **A private field makes the constructor the gate.** A tuple struct's constructor is private when any field is private: `email::Email("not checked".to_string())` from outside the module failed with `error[E0603]: tuple struct constructor `Email` is private` ✅[^1]. The only way in is `Email::parse(raw) -> Result<Email, String>`, so a function taking `&Email` never re-checks. In the lab, `" Ana@Example.org "` became `ana@example.org` while `"nope"` and `"@x.y"` were rejected ✅[^1]. The same wrapper can change behaviour safely: a `Secret(String)` with a hand-written `Debug` printed `Secret(***)` ✅[^1]. The guidelines call this using newtypes to encapsulate implementation details ✅[^8].
3. **Make illegal states unrepresentable.** Replace `bool` and `Option` arguments and fields with a type whose values are exactly the meaningful cases ✅[^4]:
   ```rust
   enum Link { Down, Up { peer: String }, Failed { error: String } }
   ```
   A `match` over `Link` must handle all three variants, and each variant carries only its own data; the lab printed `down`, `up to 10.0.0.2`, `failed: timeout` ✅[^1].
4. **Parse, don't validate.** A check that returns a stronger type does not have to be repeated. `NonEmpty::parse(vec![4, 5, 6])` returned a value whose `first()` is `&T`, not `Option<&T>`, and `NonEmpty::<u8>::parse(vec![])` returned `None` ✅[^1]. The standard library does the same for numbers: `NonZeroU32::new(0)` is `None`, `NonZeroU32::new(5)` is `Some(5)`, and `Option<NonZeroU32>` measured 4 bytes against 8 for `Option<u32>` ✅[^1].
5. **Typestate.** Encode the state in the type, provide methods only in the `impl` block for that state, and make transitions take `self` so the old state is consumed ✅[^7]. Reusing a consumed state, `let _b = s.bind(80); let _c = s.bind(81);`, failed with `error[E0382]: use of moved value: `s`` ✅[^1]. The marker types are ZSTs held in `PhantomData<S>` (measured size 0) ✅[^1]. Methods valid in every state go in a generic `impl<S> Socket<S>` block ✅[^1].
6. **The trait-object alternative.** The Book builds the same kind of lifecycle with a private `Option<Box<dyn State>>` field and transitions taking `self: Box<Self>`, then rebuilds it with one type per state ✅[^3]. Written the trait-object way, the socket compiles with the call in the wrong order and reports it when the call runs: the lab printed `Err("cannot accept while bound")`, then `Ok("client")` after one more transition ✅[^1]. The Book's verdict on the type-per-state version: invalid states become impossible at compile time; its noted downsides of the trait-object version are coupling between states and duplicated logic ✅[^3].
7. **Builders.** A builder suits types with many inputs, optional configuration or side effects at construction ✅[^4] ✅[^6]. A non-consuming builder (`fn limit(&mut self, n: u32) -> &mut Self`, the `std::process::Command` style) supports both one-liners and configuration in a loop ✅[^4]; the lab built `Query { table: "orders", limit: Some(10), filters: ["paid", "eu"] }` with a `for` loop of `b.filter(f)` ✅[^1]. Its trap: `let b = QueryBuilder::new().limit(5);` keeps a `&mut` to a temporary and failed with `error[E0716]: temporary value dropped while borrowed` once `b` was used ✅[^1]. A consuming builder (`fn retries(mut self, n: u8) -> Self`) moves the value through the chain ✅[^4], which is what a typestate builder needs.

## Worked example
A typestate builder: optional settings in any order, one required URL, and `build()` only after it (lab file `d03_builder.rs`) ✅[^1]:
```rust
use std::marker::PhantomData;
use std::time::Duration;
#[derive(Debug)]
struct Request { url: String, timeout: Duration, retries: u8 }
struct NoUrl; struct HasUrl;
struct RequestBuilder<U> { url: Option<String>, timeout: Duration, retries: u8, _u: PhantomData<U> }
impl RequestBuilder<NoUrl> {
    fn new() -> Self { RequestBuilder { url: None, timeout: Duration::from_secs(30), retries: 0, _u: PhantomData } }
    fn url(self, u: &str) -> RequestBuilder<HasUrl> {
        RequestBuilder { url: Some(u.to_string()), timeout: self.timeout, retries: self.retries, _u: PhantomData }
    }
}
impl<U> RequestBuilder<U> {
    fn timeout(mut self, t: Duration) -> Self { self.timeout = t; self }
    fn retries(mut self, n: u8) -> Self { self.retries = n; self }
}
impl RequestBuilder<HasUrl> {
    fn build(self) -> Request { Request { url: self.url.unwrap(), timeout: self.timeout, retries: self.retries } }
}
fn main() {
    let r = RequestBuilder::new().retries(2).url("https://example.org").timeout(Duration::from_millis(500)).build();
    println!("{:?}", r);
}
```
```console
Request { url: "https://example.org", timeout: 500ms, retries: 2 }
```
| Step | Type after the call | Note |
|---|---|---|
| `RequestBuilder::new()` | `RequestBuilder<NoUrl>` | defaults: 30 s timeout, 0 retries |
| `.retries(2)` | `RequestBuilder<NoUrl>` | generic `impl<U>`: allowed in any state |
| `.url("https://example.org")` | `RequestBuilder<HasUrl>` | the only transition; consumes the old builder |
| `.timeout(Duration::from_millis(500))` | `RequestBuilder<HasUrl>` | still allowed |
| `.build()` | `Request` | exists only on `RequestBuilder<HasUrl>` |
| `RequestBuilder::new().build()` (separate program) | does not compile | `error[E0599]: no method named `build` found for struct `RequestBuilder<NoUrl>``, "the method was found for `RequestBuilder<HasUrl>`" ✅[^1] |

The `unwrap()` in `build` cannot fail: `HasUrl` is only produced by `url()`, which sets the field.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| A type alias instead of a newtype (`type UserId = u64`) | Mixing ids compiles | An alias is the same type (`rust/traits-and-generics/advanced-traits-and-type-system.md`) ✅[^1] |
| Newtype with a `pub` field | Anyone can build an unchecked value | The constructor is private only when a field is ✅[^1] |
| Typestate method called in the wrong state | E0599 with "the method was found for …" | The method lives in another state's `impl` ✅[^1] |
| Old state used after a transition | E0382 | Transitions take `self` ✅[^1] |
| `let b = Builder::new().opt(1);` with a `&mut self` builder | E0716 once `b` is used | `b` borrows a temporary freed at the end of the statement ✅[^1] |
| State known only at run time (read from a file or network) | Typestate cannot express it alone | Types are fixed at compile time; branch into an enum of states at the boundary |
| Many independent required fields in a typestate builder | One marker parameter per field | The type signature grows with each requirement |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Newtype | Distinct types, a single validation point, zero runtime cost ✅[^5] | Forwarding boilerplate ✅[^5] |
| Enum of states (`Link`) | Exhaustive handling; state can change at run time | Each transition is checked by `match`, not by method availability |
| Typestate (`Socket<S>`) | Wrong-order calls do not compile ✅[^1] | One type per state; awkward when the state is decided at run time |
| Trait-object state (`Box<dyn State>`) | State can be stored and swapped dynamically | Errors only at run time ✅[^1]; coupled states, duplicated logic ✅[^3] |
| Non-consuming builder | Loops and one-liners ✅[^4] | E0716 when a chain starting at a temporary is bound |
| Consuming or typestate builder | Required fields enforced at compile time ✅[^1] | Every option method must return the right state type |

## Takeaways
- Give every identifier, unit and validated string its own newtype with a private field and a parsing constructor. [rule-candidate]
- Replace `bool`/`Option` field combinations with an enum whose variants carry only their own data. [rule-candidate]
- Return the proof of a check (`NonEmpty`, `NonZeroU32`, `Email`) instead of `bool`. [rule-candidate]
- Use typestate when the order of calls is fixed at compile time; use an enum when the state is only known at run time.
- Prefer a consuming builder when you need typestate; prefer `&mut self` builders when callers configure in loops.

## Verification status
- Verified: 44 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `linux/lab-setup.md` — the Rust 1.100.0 lab (`rustlab:1`) where every behaviour marked with this note ran on 2026-11-24. [^1]
- [Advanced Types](https://doc.rust-lang.org/book/ch20-03-advanced-types.html) — The Rust Programming Language (Klabnik, Nichols, Krycho and the Rust community), living. Backs: "Type Safety and Abstraction with the Newtype Pattern". [^2]
- [Implementing an Object-Oriented Design Pattern](https://doc.rust-lang.org/book/ch18-03-oo-design-patterns.html) — The Rust Programming Language, living. Backs: state pattern with `Box<dyn State>` and `self: Box<Self>`, states encoded as types, the trade-offs. [^3]
- [Type safety](https://rust-lang.github.io/api-guidelines/type-safety.html) — Rust API Guidelines, living. Backs: C-NEWTYPE, C-CUSTOM-TYPE, C-BUILDER (non-consuming and consuming builders). [^4]
- [Newtype](https://rust-unofficial.github.io/patterns/patterns/behavioural/newtype.html) — Rust Design Patterns, living. Backs: zero-cost wrapper, privacy, pass-through boilerplate. [^5]
- [Builder](https://rust-unofficial.github.io/patterns/patterns/creational/builder.html) — Rust Design Patterns, living. Backs: motivation for builders. [^6]
- [Typestate Programming](https://docs.rust-embedded.org/book/static-guarantees/typestate-programming.html) — The Embedded Rust Book, living. Backs: state encoded in types, transitions consume the old value. [^7]
- [Future proofing](https://rust-lang.github.io/api-guidelines/future-proofing.html) — Rust API Guidelines, living. Backs: C-NEWTYPE-HIDE. [^8]

## Related
- `software-design/functional-modeling/types-as-rules.md` — the same idea, language-neutral.
- `rust/design-patterns/idioms-and-api-guidelines.md` — constructors, `#[must_use]`, sealed state traits.
- `rust/traits-and-generics/trait-objects-and-dynamic-dispatch.md` — `Box<dyn Trait>` behind the state pattern.
- `rust/unsafe/variance-phantomdata-and-drop-check.md` — what `PhantomData<S>` does beyond marking a state.
- `rust/data-modeling/enums-and-pattern-matching.md` — enums and exhaustive matching.
