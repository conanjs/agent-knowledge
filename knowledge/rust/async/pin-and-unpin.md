---
schema: knowledge-doc/v1
type: concept
topic: rust/async
status: verified
applies-to: ["Rust 1.100.0", "edition 2024"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [rust, async, pin, unpin, phantompinned, self-referential, pin-projection, future, miri]
---

# `Pin` and `Unpin`

## Summary
**TL;DR:** Every Rust value can be moved, and a move puts its bytes at a new address. A value that holds a pointer into itself is broken by a move, and the futures the compiler builds from `async` code can be such values (a borrow of a local kept across an `.await`). So `Future::poll` takes `Pin<&mut Self>`: a wrapper around a pointer that promises the **pointee** stays at the same address until it is dropped. `Unpin`, an auto trait that almost every type has, cancels that promise; `async` fn and block futures and types with a `PhantomPinned` field are `!Unpin`. Pin on the heap with `Box::pin` (can be returned and stored) or locally with `pin!` (cannot leave its scope). Reaching a field of a pinned value is **pin projection**, and doing it by hand is `unsafe`.
**Use this when:** the compiler says "cannot be unpinned" (E0277), you poll or `.await` a future through `&mut`, you write a `Future` that wraps another future, or you build an address-sensitive type.
**Not this doc:** what `poll`, `Context` and wakers do → `rust/async/futures-and-async-await.md`; moves and drop order in general → `rust/ownership/ownership-moves-and-drop.md`; `unsafe`, undefined behaviour and Miri → `rust/unsafe/unsafe-rust-and-undefined-behavior.md`; `PhantomData` and variance → `rust/unsafe/variance-phantomdata-and-drop-check.md`.

## Problem
A struct that stores a raw pointer to one of its own fields works until it is moved; after `std::mem::swap`, assignment into a `Vec`, or a return from a function, the pointer still names the old address. Safe code cannot see this happen, so the bug surfaces as a wrong value or undefined behaviour (UB) far from the move. The compiler's async state machines have the same shape, which is why `Pin` exists and why ordinary-looking code such as `(&mut fut).await` or `Box::new(fut).await` fails with E0277.

## Mental model
**Analogy:** a house with its own street address written on notes inside it. Moving the house to another lot leaves every note pointing at the old lot. `Pin` is a covenant written on the **deed** (the pointer), saying "this house will not be moved until it is demolished"; the covenant binds the house, not the deed, so the deed can be handed around freely. A tent (`Unpin`) has no address notes inside, so the covenant means nothing for it.

**Artifact:** a self-referential `Note`, swapped with another one ✅[^1]:
```rust
struct Note { text: String, me: *const String }
impl Note {
    fn new(t: &str) -> Self { Note { text: t.to_string(), me: std::ptr::null() } }
    fn link(&mut self) { self.me = &self.text; }
    fn via_ptr(&self) -> &str { unsafe { &*self.me } }   // trusts that `me` still points at self.text
}
// main:
let mut a = Note::new("alpha"); a.link();
let mut b = Note::new("beta");  b.link();
std::mem::swap(&mut a, &mut b);                           // moves both values
```
```console
before: a.text=alpha a.via_ptr=alpha points at own field: true
after : a.text=beta  a.via_ptr=alpha points at own field: false
```
After the swap, `a` owns `"beta"` but its pointer reads `b`'s field. Under Miri (the UB checker), the same program stops at the read: `error: Undefined Behavior: trying to retag from <868> for SharedReadOnly permission … but that tag does not exist in the borrow stack`, pointing at the `&mut b` of the swap as the place that invalidated it ✅[^1].

## How it works
**Moving and pinning.** All Rust values are movable, so a value's address may change between two borrows ✅[^2]. A value is *pinned* once it is guaranteed to stay at the same place in memory from that moment until its `drop` runs ✅[^2]. The futures generated for `async` blocks can hold references to their own fields, which is why moving them is unsafe once polling has started ✅[^6] ✅[^7].

**4 actors** act in sequence over a future's life:
- **Compiler** — its job: generate the future's state machine and decide whether it is `Unpin`, via the auto-trait rules.
- **Pinning pointer (`Pin<P>`)** — its job: keep safe code from getting `&mut T` to a pinned `!Unpin` value, via offering `get_mut` and `DerefMut` only when `T: Unpin`.
- **Executor (or any caller of `poll`)** — its job: pin the future once and poll it many times, via `Box::pin` or `pin!` and then `Pin::as_mut`.
- **Future** — its job: rely on its own address staying fixed between polls, via the receiver `self: Pin<&mut Self>`.

```
 compile time                     run time
 ────────────                     ────────
 Compiler: async body ─▶ {async fn body} : !Unpin
                                    │
 Executor:                 pin!(fut) / Box::pin(fut)        value now has a fixed address
                                    │
                           fut.as_mut().poll(cx)  ×N        Pin<&mut F> reborrowed each time
                                    │                       no safe &mut F exists ─▶ no move
 Future:                   uses self-references safely
                                    │
 Drop:                     destructor runs, then memory may be reused
```

1. **Compiler:**
   - Implements `Unpin` automatically for a type whose fields are all `Unpin` (`struct Plain(u8)` passes a `T: Unpin` bound) ✅[^5] ✅[^1].
   - Makes every `async` fn and block future `!Unpin`, even an empty one: `needs_unpin(&nothing())` fails with `` error[E0277]: `{async fn body of nothing()}` cannot be unpinned `` and `needs_unpin(&async {})` with `` `{async block@…}` cannot be unpinned `` ✅[^1].
   - Treats a type with a `PhantomPinned` field as `!Unpin`: `` error[E0277]: `PhantomPinned` cannot be unpinned ``; this field is how a hand-written address-sensitive type opts out ✅[^5] ✅[^1].
2. **Pinning pointer:**
   - `Pin<Ptr>` wraps a pointer such as `&mut T` or `Box<T>`; it pins the pointee, not the pointer ✅[^2]. It is `#[repr(transparent)]` with the same layout as `Ptr` ✅[^3]: `size_of::<Pin<Box<Note>>>()` is 8, like `Box<Note>`, on aarch64 ✅[^1].
   - `Pin::new` and `Pin::get_mut` exist only for `Unpin` targets; for a `!Unpin` target the only ways to `&mut T` are `unsafe` (`new_unchecked`, `get_unchecked_mut`, `map_unchecked_mut`), each with a promise never to move the data out ✅[^3].
3. **Executor:**
   - Pins the future: `Box::pin` on the heap, or `pin!` in the enclosing scope, which allocates nothing ✅[^4]. Inside an `async` body, a `pin!`ned local that lives across an `.await` is stored in the outer future's state ✅[^4].
   - Polls through `Pin::as_mut`, which reborrows the `Pin<&mut T>` so it can be used again ✅[^3]. The `.await` desugaring pins its operand the same way: it binds the future to a local that is never moved again and calls `unsafe { Pin::new_unchecked(&mut local) }` before each poll ✅[^8].
4. **Drop:**
   - The memory of a pinned value must stay valid and unused for anything else until its `drop` has run; `mem::forget` is allowed, because it never reuses the memory ✅[^2].
   - `Pin::set` may overwrite a pinned value, because it runs the old value's destructor first ✅[^2] ✅[^3].

Polling a `!Unpin` future more than once through `pin!` ✅[^1]:
```rust
let mut cx = Context::from_waker(Waker::noop());
let mut fut = pin!(two_steps());                  // Pin<&mut {async fn body of two_steps()}>
for i in 1..=2 { println!("poll {i}: {:?}", fut.as_mut().poll(&mut cx)); }
```
```console
poll 1: Pending
poll 2: Ready("done")
```

### Pin projection
A wrapper future holding an inner future must decide, field by field, whether `Pin<&mut Wrapper>` gives `Pin<&mut Field>` (*structural* pinning) or a plain `&mut Field` ✅[^2]. Structural pinning has four rules ✅[^2]:
1. The wrapper may be `Unpin` only if every structurally pinned field is.
2. Its destructor must treat `self` as if it were pinned, so the type must not be `#[repr(packed)]`.
3. Its storage must not be reused without running the pinned fields' destructors.
4. It must offer no operation that moves data out of a pinned field.

A by-hand projection, with `inner` pinned and a counter not pinned ✅[^1]:
```rust
struct CountPolls<F> { inner: F, polls: u32 }
impl<F: Future> Future for CountPolls<F> {
    type Output = (F::Output, u32);
    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        // SAFETY: `inner` is never moved out of `self`; CountPolls has no Drop impl
        // and no manual Unpin impl, so the four structural-pinning rules hold.
        let this = unsafe { self.get_unchecked_mut() };
        this.polls += 1;                                              // not pinned: plain &mut
        let inner = unsafe { Pin::new_unchecked(&mut this.inner) };   // pinned projection
        match inner.poll(cx) {
            Poll::Ready(v) => Poll::Ready((v, this.polls)),
            Poll::Pending => Poll::Pending,
        }
    }
}
```
Wrapping a future that is `Pending` twice printed `done after 3 polls`, natively and under Miri, with no UB reported ✅[^1]. The Async Book recommends the `pin-project` crate, or `pin-project-lite` to avoid procedural macros, for generating such projections safely ✅[^7]; neither crate was run in the lab.

## Worked example
Fixing `Note` with `Pin<Box<_>>` and `PhantomPinned`, then trying to break it ✅[^1]:
```rust
struct Note { text: String, me: *const String, _pin: PhantomPinned }
impl Note {
    fn new(t: &str) -> Pin<Box<Self>> {
        let mut boxed = Box::pin(Note { text: t.to_string(), me: std::ptr::null(), _pin: PhantomPinned });
        // SAFETY: we only write a field; the Note itself is never moved out of the pin.
        let this = unsafe { boxed.as_mut().get_unchecked_mut() };
        this.me = &this.text;
        boxed
    }
    fn via_ptr(self: Pin<&Self>) -> &str { unsafe { &*self.me } }
}
// main:
let a = Note::new("alpha");
let addr_before = &a.text as *const String;
let moved = vec![a];                               // moves the Box pointer, not the Note
let addr_after = &moved[0].text as *const String;
```
```console
same address after moving the Pin<Box>: true
via_ptr = alpha
size_of Box<Note> = 8, Pin<Box<Note>> = 8
```
| Step | What happens |
|---|---|
| `Box::pin(Note { … })` | The `Note` is placed on the heap, behind a pinning pointer |
| `get_unchecked_mut` | An `unsafe` `&mut Note`, used only to write `me`; never used to move |
| `vec![a]` | Moves the 8-byte `Pin<Box<Note>>` into the vector; the heap `Note` stays where it was, so `me` stays correct |
| `std::mem::swap(&mut *a, &mut *b)` on two `Pin<Box<Note>>` | `error[E0596]: cannot borrow data in dereference of Pin<Box<Note>> as mutable`, help: "trait `DerefMut` is required … but it is not implemented" ✅[^1] |
| `Pin::get_mut(a.as_mut())` | `` error[E0277]: `PhantomPinned` cannot be unpinned `` ✅[^1] |
| The whole program under Miri | Runs clean; the swapped version in the Mental model is flagged ✅[^1] |

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `(&mut fut).await` where `fut` is an `async fn` future | `` error[E0277]: `{async fn body of step()}` cannot be unpinned ``, note "required for `&mut impl Future<Output = u8>` to implement `Future`" ✅[^1] | `&mut F` is a future only when `F: Unpin`; fix with `let mut fut = pin!(step());` then `(&mut fut).await` |
| `Box::new(fut).await` | Same E0277, note "required for `Box<impl Future…>` to implement `Future`" ✅[^1] | `Box<F>` is a future only when `F: Unpin`; use `Box::pin(fut)` |
| `Pin<Box<dyn Future>>` | Can be polled and awaited directly ✅[^3] | `impl Future for Pin<P>` when `P: DerefMut` and its target is a future |
| Returning `pin!(async {})` from a function | `error[E0515]: cannot return value referencing temporary value` ✅[^1] | A `pin!` result borrows local storage and cannot leave its scope; return `Box::pin` instead ✅[^4] |
| Reusing a future across `select!` loop iterations by reference | Needs the future to be pinned or `Unpin` ✅[^9] | Same `&mut F: Future` rule as the first row |
| `Pin::new(&mut s)` for `s: String` | Allowed; `mem::replace` through it works ✅[^5] | `String: Unpin`, so the pin has no effect |
| `mem::replace` on a `!Unpin` value that is not pinned yet | Allowed ✅[^5] | `Unpin` matters only for data behind a `Pin`; pinning starts when the `Pin` is created |
| `Pin<Box<T>>` for a `!Unpin` `T` | Is itself `Unpin`: it passed `needs_unpin(&Box::pin(nothing()))` ✅[^1] | `Box<T>` has no structural pinning, so `Box<T>: Unpin` for every `T` ✅[^2] |
| A `!Unpin` value wrapped in `ManuallyDrop`, then pinned | Unsound, and cannot be made safe ✅[^2] | It would let the memory be reused without running `drop` |
| `#[repr(packed)]` type with a structurally pinned field | Not allowed ✅[^2] | Rule 2 of structural pinning: the destructor must treat the fields as pinned, which `repr(packed)` rules out |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `Box::pin(fut)` | Can be returned, stored in collections, used as `Pin<Box<dyn Future>>`; the result is `Unpin` | One heap allocation per future |
| `pin!(fut)` | No allocation; usually cheaper ✅[^4] | Cannot leave the enclosing scope |
| By-hand projection with `unsafe` | No dependency | Must uphold the four structural rules; a mistake is UB |
| `pin-project` / `pin-project-lite` | Safe, generated projections ✅[^7] | An extra dependency (and a proc macro for `pin-project`) |

## Takeaways
- Pin a future with `pin!` before polling or awaiting it by `&mut` in a loop; use `Box::pin` only when it must outlive the scope or be stored. [rule-candidate]
- Every `unsafe` pin projection carries a `// SAFETY:` comment that says why the field is never moved out. [rule-candidate]
- Mark hand-written address-sensitive types `!Unpin` with a `PhantomPinned` field. [rule-candidate]
- Never `#[repr(packed)]` a type with structurally pinned fields, and never move a pinned field in `Drop`.
- Run hand-written pinning code under Miri.

## Verification status
- Verified: 46 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `linux/lab-setup.md` — the Rust 1.100.0 lab (`rustlab:1`) where every behaviour marked with this note ran on 2026-11-24. [^1]
- [std::pin](https://doc.rust-lang.org/std/pin/index.html) — Rust standard library, living. Backs: moving and pinning, self-referential types, `Pin` pins the pointee, the Drop guarantee, `Pin::set`, structural pinning rules, `Box<T>: Unpin`, `ManuallyDrop`, `repr(packed)`. [^2]
- [Pin in std::pin](https://doc.rust-lang.org/std/pin/struct.Pin.html) — Rust standard library, living. Backs: `repr(transparent)` layout, `Pin::new`/`get_mut` need `Unpin`, the `unsafe` accessors, `as_mut`, `set`, `impl Future for Pin<P>`. [^3]
- [pin in std::pin](https://doc.rust-lang.org/std/pin/macro.pin.html) — Rust standard library, living. Backs: local pinning without allocation, storage inside async bodies, cannot escape its scope, use `Box::pin` to return. [^4]
- [Unpin in std::marker](https://doc.rust-lang.org/std/marker/trait.Unpin.html) — Rust standard library, living. Backs: `Unpin` as an auto trait, `PhantomPinned` opt-out, `Unpin` has no effect on unpinned data, `Pin::new` on `String`. [^5]
- [A Closer Look at the Traits for Async](https://doc.rust-lang.org/book/ch17-05-traits-for-async.html) — The Rust Programming Language (Rust project), living. Backs: async-block futures can reference their own fields; moving them would leave stale references. [^6]
- [Pinning](https://rust-lang.github.io/async-book/part-reference/pinning.html) — Asynchronous Programming in Rust (Rust Async Working Group), living (draft chapter). Backs: why futures need pinning, `pin-project` and `pin-project-lite`. [^7]
- [Await expressions](https://doc.rust-lang.org/reference/expressions/await-expr.html) — The Rust Reference (Rust project), living. Backs: the `.await` desugaring pins its operand with `Pin::new_unchecked`. [^8]
- [Select](https://tokio.rs/tokio/tutorial/select) — Tokio project, living. Backs: awaiting a reference needs the value pinned or `Unpin`. [^9]

## Related
- `rust/async/futures-and-async-await.md` — `poll`, wakers and executors.
- `rust/async/tokio-runtime-tasks-and-cancellation.md` — `tokio::pin!` and futures reused across `select!`.
- `rust/unsafe/unsafe-rust-and-undefined-behavior.md` — `unsafe`, `// SAFETY:` comments and Miri.
- `rust/unsafe/memory-layout-and-repr.md` — `repr(transparent)`, `repr(packed)` and `ManuallyDrop`.
- `rust/ownership/ownership-moves-and-drop.md` — what a move is.
