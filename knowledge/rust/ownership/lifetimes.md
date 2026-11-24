---
schema: knowledge-doc/v1
type: concept
topic: rust/ownership
status: verified
applies-to: ["Rust 1.100.0", "edition 2024"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [rust, lifetimes, elision, static, lifetime-bounds, impl-trait, precise-capturing, use-bound, edition-2024]
---

# Lifetimes, elision and `'static`

## Summary
**TL;DR:** A lifetime is the stretch of a program during which a borrow must stay valid. A lifetime annotation such as `'a` changes nothing at run time: it states how the references in a signature relate, so the borrow checker can check every caller. Three elision rules fill in most signatures; you write lifetimes when a function returns a reference that could come from more than one input, when a struct holds a reference, and in trait-object and `impl Trait` bounds. `T: 'static` means "`T` holds no borrow shorter than the whole program", which an owned `String` satisfies; it does not mean the value lives forever. In edition 2024, a return-position `impl Trait` captures every lifetime in scope, and `use<..>` narrows that.
**Use this when:** you get `E0106`, `E0621`, `E0597`, `E0310`, `E0700` or "lifetime may not live long enough", you design a struct that borrows its input, you are told a type must be `'static`, or an `impl Trait` return type behaves differently after moving to edition 2024.
**Not this doc:** what a borrow is and NLL (non-lexical lifetimes) → `rust/ownership/borrowing-references-and-slices.md`; variance and subtyping of lifetimes → `rust/unsafe/variance-phantomdata-and-drop-check.md`; higher-ranked bounds `for<'a>` (HRTB, higher-ranked trait bound) → `rust/traits-and-generics/advanced-traits-and-type-system.md`; error-code lookup → `rust/ownership/borrow-checker-errors.md`; why `thread::spawn` needs `'static` → `rust/concurrency/threads-channels-and-locks.md`.

## Problem
`fn longer(a: &str, b: &str) -> &str` does not compile, and the help text proposes putting `'a` on every reference ✅[^1]. People then reach for `'static` until it compiles, or clone to escape. Other surprises: a method's elided return lifetime keeps `self` mutably borrowed long after the caller is done with it; `Box<dyn Trait>` quietly requires `'static` ✅[^3]; `T: 'static` gets read as "leaks" or "lives forever"; and edition 2024 changed which lifetimes an `impl Trait` return type holds on to, so a function call can keep its argument borrowed where it did not before ✅[^1].

## Mental model
**Analogy:** a lifetime parameter is a "valid until" stamp the function promises to pass through. `fn longer<'a>(a: &'a str, b: &'a str) -> &'a str` says: "the reference I return expires no later than the earlier of the two you gave me". The stamp never extends anything; it only lets the checker refuse a caller that keeps the result past the earlier expiry.

**Artifact:** the same function, used inside and outside the shorter value's scope ✅[^1]:
```rust
fn longer<'a>(a: &'a str, b: &'a str) -> &'a str { if a.len() >= b.len() { a } else { b } }

let x = String::from("long string");
let result;
{
    let y = String::from("short");
    result = longer(x.as_str(), y.as_str());
    println!("longer = {result}");     // longer = long string
}
// println!("{result}");  here → error[E0597]: `y` does not live long enough
```
The call returns `x`'s text, but the signature only promises the shorter of the two lifetimes, so a use after `y` is gone is rejected ✅[^1] ✅[^2].

## How it works
1. **Annotations describe, they do not change.** Lifetime parameters are generic parameters; they relate the lifetimes of several references without affecting how long any value lives ✅[^2]. At a call, `'a` becomes the smaller of the lifetimes of the arguments that share it ✅[^2]. Lifetimes on parameters are input lifetimes, on the return type output lifetimes ✅[^2].
2. **Elision rules.** When a signature leaves lifetimes out ✅[^3] ✅[^2]:
   - each elided lifetime in the parameters becomes its own lifetime parameter;
   - if exactly one lifetime is used in the parameters, it is assigned to all elided output lifetimes;
   - if the receiver is `&self` or `&mut self`, its lifetime is assigned to all elided output lifetimes.

   Otherwise eliding an output lifetime is an error ✅[^3]. On 1.100.0: `fn longer(a: &str, b: &str) -> &str` is `error[E0106]: missing lifetime specifier` with "the signature does not say whether it is borrowed from `a` or `b`"; `fn dangle() -> &String` is `E0106` with "there is no value for it to be borrowed from" ✅[^1]. Struct fields and type aliases never elide ✅[^4].
3. **Rule 3 picks `self` even when you meant the other argument.** `fn pick(&self, other: &str) -> &str { other }` is "error: lifetime may not live long enough" (no error code): the output was tied to `&self` ✅[^1]. Declaring `fn pick<'a>(&self, other: &'a str) -> &'a str` fixes it ✅[^1]. Returning a parameter that has no lifetime in the signature, as in `fn pick<'a>(a: &'a str, b: &str) -> &'a str { … b … }`, is `` error[E0621]: explicit lifetime required in the type of `b` `` ✅[^1] ✅[^5].
4. **Structs that borrow.** A struct holding a reference declares the lifetime (`struct Headline<'t> { words: &'t str }`), and an instance cannot outlive what it borrows ✅[^2]: building one from a `String` that dies in an inner block and using it outside is `E0597` ✅[^1]. In an `impl` that does not need the name, `impl Headline<'_>` uses the placeholder lifetime ✅[^3] ✅[^1].
5. **Return the struct's lifetime, not `self`'s.** A method `fn words(&self) -> &'t str` returns data borrowed from the original input, so the result stays usable after the struct is dropped; `-> &str` would tie it to the borrow of `self` ✅[^1]. The worked example shows the difference with `&mut self`.
6. **Lifetime bounds.** `'a: 'b` reads "`'a` outlives `'b`"; `T: 'a` means every lifetime parameter inside `T` outlives `'a` ✅[^6]. Bounds needed for well-formed types are implied: `&'a T` in a signature or a field `&'a T` in a struct implies `T: 'a` without writing it ✅[^6] ✅[^1].
7. **`'static` and `T: 'static`.** String literals have type `&'static str` ✅[^2]. A `T: 'static` bound is about what `T` may borrow: `i32: 'static` holds, `Vec<&'a ()>: 'static` does not for a shorter `'a` ✅[^6]. So `fn keep<T: Send + 'static>(value: T)` accepts `String::from("owned value")`, moves it into a thread and gets it back, while `keep(&local)` is `E0597` with "argument requires that `local` is borrowed for `'static`" ✅[^1]. `Box::leak` produces a real `&'static mut T` by never freeing the allocation; it is meant for data that lives for the rest of the program ✅[^7] ✅[^1]. When an error suggests `'static`, the cause is usually a reference that would dangle; fix that instead ✅[^2].
8. **Trait objects carry a lifetime bound.** `Box<dyn Trait>` means `Box<dyn Trait + 'static>`, and `&'a dyn Trait` means `&'a (dyn Trait + 'a)` ✅[^3]. Hence `fn boxed<T: Display>(t: T) -> Box<dyn Display>` is `` error[E0310]: the parameter type `T` may not live long enough ``, with the label "this `dyn Trait` has an implicit `'static` lifetime bound"; `fn boxed<'a, T: Display + 'a>(t: T) -> Box<dyn Display + 'a>` compiles and accepts `&local` ✅[^1].
9. **Edition 2024 `impl Trait` capture rules.** A return-position `impl Trait` captures all in-scope generic parameters, including lifetimes; before 2024, free functions and inherent methods captured a lifetime only when it appeared in the bounds ✅[^8] ✅[^9]. Run in both editions ✅[^1]:

   | Function | `--edition 2021` | `--edition 2024` |
   |---|---|---|
   | `fn doubled(xs: &[i32]) -> impl Iterator<Item = i32> { xs.iter().map(\|x\| x * 2) }` | `` error[E0700]: hidden type for `impl Iterator<Item = i32>` captures lifetime that does not appear in bounds `` | compiles, prints `[2, 4]` |
   | `fn summary(x: &str) -> impl Display { x.len() }`, result used after the `String` is dropped | compiles, prints `3` | `E0597`, with the note that Rust 2024 adjusted the `impl Trait` capture rules |
   | same with `-> impl Display + use<>` | compiles | compiles, prints `3` |
   | `doubled` with `+ '_` (the older "outlives trick") | compiles | compiles |

   `use<..>` lists exactly what is captured (`use<>` captures nothing) and exists since Rust 1.82 in every edition; the `+ '_` and `Captures` tricks still work but are no longer needed in 2024; `cargo fix --edition` adds `use<..>` bounds through the `impl_trait_overcaptures` lint ✅[^9].
10. **`const` and `static`.** A reference type in a `const` or `static` item is implicitly `'static` ✅[^3].

## Worked example
A tokenizer that borrows its input and hands out slices of it. The output lifetime is the input's `'s`, not the borrow of `&mut self` ✅[^1]:
```rust
struct Tokens<'s> { rest: &'s str }
impl<'s> Tokens<'s> {
    fn new(input: &'s str) -> Self { Tokens { rest: input } }
    fn next_token(&mut self) -> Option<&'s str> {
        let trimmed = self.rest.trim_start();
        if trimmed.is_empty() { return None; }
        let end = trimmed.find(' ').unwrap_or(trimmed.len());
        let (tok, rest) = trimmed.split_at(end);
        self.rest = rest;
        Some(tok)
    }
}
let line = String::from("SET retries 3");
let mut t = Tokens::new(&line);
let cmd = t.next_token().unwrap();
let key = t.next_token().unwrap();         // cmd still usable
let val = t.next_token().unwrap();
println!("cmd = {cmd}, key = {key}, val = {val}, end = {:?}", t.next_token());
drop(t);
println!("tokens outlive the tokenizer: {cmd} {key}");
```
| Step | What the borrow checker sees | Output |
|---|---|---|
| `Tokens::new(&line)` | `'s` = the borrow of `line` | — |
| three `next_token()` calls | each `&mut t` ends at the call; the returned `&'s str` borrows `line`, not `t` | `cmd = SET, key = retries, val = 3, end = None` |
| `drop(t)` then use `cmd`, `key` | `line` is still alive, so the slices are valid | `tokens outlive the tokenizer: SET retries` |
| Same code with the elided `fn next_token(&mut self) -> Option<&str>` | rule 3 ties each token to `&mut t`, so `cmd` keeps `t` mutably borrowed | `` error[E0499]: cannot borrow `t` as mutable more than once at a time `` at the second call |

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `fn dangle() -> &String` | `E0106`; the help offers `&'static String` but adds that returning an owned `String` is more likely right ✅[^1] | No input to borrow from ✅[^3] |
| Elided return on a `&mut self` method | The caller's `self` stays mutably borrowed as long as the result is used (`E0499` above) ✅[^1] | Elision rule 3 ✅[^3] |
| `fn pick(&self, other: &str) -> &str { other }` | "lifetime may not live long enough", no error code ✅[^1] | Rule 3 tied the output to `self` |
| `Box<dyn Trait>` built from a generic `T` | `E0310` ✅[^1] | Default object lifetime is `'static` ✅[^3] |
| Edition 2024 `-> impl Trait` from a function taking `&T` | The result keeps the argument borrowed; add `+ use<>` when it holds no borrow ✅[^1] | All in-scope lifetimes are captured ✅[^9] |
| `T: 'static` with an owned value | The value is still dropped normally; the thread above returned the `String` to `main` ✅[^1] | The bound restricts borrows inside `T`, not the value's lifetime ✅[^6] |
| `Box::leak(Box::new(vec![1, 2]))` | A `&'static mut Vec<u8>` that can be pushed to (`[1, 2, 3]`) and is never freed ✅[^1] | Leaking on purpose ✅[^7] |
| `struct Foo { x: &bool }` | `E0106`; struct fields never elide ✅[^4] | Elision applies to function, function-pointer and closure-trait signatures ✅[^3] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Struct borrows its input (`Tokens<'s>`) | No copy of the input | The lifetime parameter spreads to every user; the struct cannot outlive the source ✅[^1] |
| Struct owns its data (`String` fields) | No lifetime parameter; satisfies `'static` ✅[^1] | An allocation and a copy |
| `Cow<'a, str>` | Borrow when possible, own when needed | More code; see `rust/collections/strings-and-utf-8.md` |
| `Rc<str>` | Cheap shared clones without a lifetime parameter | Reference counting; see `rust/smart-pointers/rc-refcell-and-interior-mutability.md` |

## Takeaways
- When a function returns a reference into one specific argument, give only that argument the output's lifetime. [rule-candidate]
- On methods that return data borrowed from the struct's input, return `&'s T` (the struct's lifetime), not an elided `&T` tied to `&self`. [rule-candidate]
- Treat a compiler suggestion of `'static` as a hint that something would dangle; do not accept it by reflex. [rule-candidate]
- Read `T: 'static` as "owns its data or borrows only statics"; pass owned values to `'static` APIs.
- After moving to edition 2024, add `+ use<>` (or `use<T>`) to `impl Trait` returns that do not borrow from their arguments.

## Verification status
- Verified: 57 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `linux/lab-setup.md` — the Rust 1.100.0 lab (`rustlab:1`) where every behaviour marked with this note ran on 2026-11-24. [^1]
- [Validating References with Lifetimes](https://doc.rust-lang.org/book/ch10-03-lifetime-syntax.html) — The Rust Programming Language (Klabnik, Nichols, Krycho and the Rust community), living. Backs: annotations describe relationships, the smaller lifetime, input and output lifetimes, structs holding references, `'static`, advice on suggested `'static`. [^2]
- [Lifetime elision](https://doc.rust-lang.org/reference/lifetime-elision.html) — The Rust Reference, living. Backs: the elision rules, `'_`, default trait object lifetimes, `const`/`static` elision. [^3]
- [E0106](https://doc.rust-lang.org/error_codes/E0106.html) — Error codes index, Rust project, living. Backs: struct fields and type aliases never elide. [^4]
- [E0621](https://doc.rust-lang.org/error_codes/E0621.html) — Error codes index, Rust project, living. Backs: signature versus body lifetime mismatch. [^5]
- [Trait and lifetime bounds](https://doc.rust-lang.org/reference/trait-bounds.html) — The Rust Reference, living. Backs: `'a: 'b`, `T: 'a`, `'static` examples, implied bounds. [^6]
- [Box in std::boxed](https://doc.rust-lang.org/std/boxed/struct.Box.html) — Rust standard library, living. Backs: `leak` returns `&'a mut T`, possibly `'static`, for data that lives for the rest of the program. [^7]
- [Impl trait type](https://doc.rust-lang.org/reference/types/impl-trait.html) — The Rust Reference, living. Backs: automatic capturing, the pre-2024 rule, `use<..>`. [^8]
- [RPIT lifetime capture rules](https://doc.rust-lang.org/edition-guide/rust-2024/rpit-lifetime-capture.html) — The Rust Edition Guide, living. Backs: 2024 capture rule, `use<..>` since 1.82, outlives and `Captures` tricks, `impl_trait_overcaptures`. [^9]

## Related
- `rust/ownership/borrowing-references-and-slices.md` — the borrows that lifetimes name.
- `rust/unsafe/variance-phantomdata-and-drop-check.md` — when a longer lifetime can stand in for a shorter one.
- `rust/traits-and-generics/advanced-traits-and-type-system.md` — `for<'a>` bounds.
- `rust/concurrency/threads-channels-and-locks.md` — `'static` closures and scoped threads.
- `rust/ownership/borrow-checker-errors.md` — lifetime error codes at a glance.
