---
schema: knowledge-doc/v1
type: concept
topic: rust/unsafe
status: verified
applies-to: ["Rust 1.100.0", "edition 2024", "sizes measured on aarch64-unknown-linux-gnu"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [rust, layout, repr, alignment, padding, niche, zst, dst, wide-pointer, maybeuninit, manuallydrop, mem-forget, leak]
---

# Memory layout, `repr` and uninitialized memory

## Summary
**TL;DR:** Every type has a size and an alignment, and its size is a multiple of its alignment. Under the default `repr(Rust)` the compiler may reorder fields and promises almost nothing else; `repr(C)` lays fields out in declaration order the way C does; `repr(transparent)` gives a one-field wrapper its field's layout and ABI (application binary interface); `repr(packed)` removes padding, which makes references to its fields a compile error; `repr(u8)` and friends fix an enum's tag. Bit patterns a type can never hold ("niches") let `Option<&T>`, `Option<Box<T>>` and `Option<NonZeroU32>` cost no extra byte. Memory that is not yet a valid value lives in `MaybeUninit<T>`; skipping a destructor with `mem::forget` or `ManuallyDrop` is safe, because a leak is not undefined behaviour (UB).
**Use this when:** sending a struct to C, reinterpreting bytes, reading a packed network or file header, building an array element by element, or wondering why `Option<T>` is (or is not) bigger than `T`.
**Not this doc:** what `unsafe` allows and the UB list → `rust/unsafe/unsafe-rust-and-undefined-behavior.md`; vtables and trait-object dispatch → `rust/traits-and-generics/trait-objects-and-dynamic-dispatch.md`; `Box` and `Drop` basics → `rust/smart-pointers/box-deref-and-drop.md`; `repr(C)` types across a C boundary → `rust/unsafe/ffi-and-c-interop.md`.

## Problem
Code that hands a struct to C, casts bytes into a struct, or allocates a buffer and fills it later breaks when it assumes a layout Rust never promised: that fields stay in declaration order, that there is no padding, that every `Option` is free, or that an uninitialized integer is "just some number". Some of these break at compile time (E0793), some only under Miri, and some only on the next compiler version, because the default layout "is not stable across compilations" ✅[^10].

## Mental model
**Analogy:** packing a toolbox whose compartments sit on a grid. Each tool must start on a grid line that matches its size (alignment), and the box's length must be a whole number of its widest grid step (size is a multiple of alignment). The default packer (`repr(Rust)`) may reorder tools to waste less space; the `repr(C)` packer keeps your order and pads gaps; `packed` throws the grid away, so a tool may sit off-grid and nobody may grab it by its handle (a reference).

**Artifact:** the same three fields under four representations, measured on aarch64 with `size_of`, `align_of` and `offset_of!` ✅[^1]:
```rust
struct Sensor { flag: u8, reading: u32, id: u16 }                // repr(Rust)
#[repr(C)]            struct SensorC        { flag: u8, reading: u32, id: u16 }
#[repr(C, packed)]    struct SensorPacked   { flag: u8, reading: u32, id: u16 }
#[repr(C, align(16))] struct SensorAligned  { flag: u8, reading: u32, id: u16 }
```
| Type | size | align | offset of `flag` / `reading` / `id` |
|---|---|---|---|
| `Sensor` | 8 | 4 | 6 / 0 / 4 (reordered) |
| `SensorC` | 12 | 4 | 0 / 4 / 8 |
| `SensorPacked` | 7 | 1 | 0 / 1 / 5 |
| `SensorAligned` | 16 | 16 | — |

## How it works
### 1. Size and alignment
Alignment is a power of two, at least 1; a value of alignment *n* is stored only at addresses that are multiples of *n*; a type's size is a multiple of its alignment, so array elements can sit back to back ✅[^2] ✅[^3]. Primitive sizes are fixed (`u32` 4, `u64` 8, `char` 4, `bool` 1), but primitive *alignment* is platform-specific: `u64` is 4-aligned on many 32-bit targets ✅[^2]. A thin pointer (`&T`, `Box<T>`, `*const T` with `T: Sized`) has the size of `usize` ✅[^10]. *Padding* is the unused space the compiler leaves between or after fields ✅[^17].

### 2. `repr(Rust)`, the default
It guarantees only what soundness needs: each field's offset is a multiple of its alignment, fields do not overlap, and the type's alignment is at least that of its largest-aligned field. Field order may differ from the declaration ✅[^2]. Two values of the same type share a layout, but two different structs with the same fields need not ✅[^3], and two compilations of one program may differ ✅[^11]. `Sensor` above shows the compiler moving `reading` first to save four bytes ✅[^1]. Miri accepts code that relies on such unspecified layout details; its README suggests `-Zrandomize-layout` to catch some of it ✅[^18].

### 3. `repr(C)`
Fields go in declaration order; each starts at the next multiple of its alignment; the total is rounded up to the struct's alignment ✅[^2] ✅[^10]. A `repr(C)` union is as large as its largest field, rounded to its alignment ✅[^2]. A field-less `repr(C)` enum gets the platform C compiler's enum size, which the Nomicon calls a "best guess"; an enum with fields becomes a `repr(C)` struct of a tag plus a `repr(C)` union of the variants ✅[^2] ✅[^4]. Zero-sized types stay zero-sized even under `repr(C)`, unlike an empty C++ type ✅[^4]. Use it for anything that crosses into C or is reinterpreted as another type ✅[^4].

### 4. Enum tags: `repr(u8)`, `repr(i32)` …
On a field-less enum, the named integer fixes size and alignment: `enum Light { Red, Amber, Green }` measured 1 byte, the same enum with `#[repr(u32)]` 4 bytes ✅[^1] ✅[^2]. On an enum with fields, a primitive or `C` repr turns off the niche optimization (§7): a home-made `MyOption<&u16>` measured 8 bytes, the same enum with `#[repr(u8)]` 16 ✅[^1] ✅[^4]. `repr(C, u8)` and `repr(u8)` are different layouts ✅[^2].

### 5. `align(N)` and `packed(N)`
`align(N)` raises alignment (cache-line separation is the usual reason); `packed(N)` lowers the alignment used to place fields, and `packed` alone removes all padding. They cannot be combined on one type ✅[^2] ✅[^4]. A packed field may sit at an address its type does not allow, so creating a reference to it is UB even if nobody reads through it; the compiler refuses it ✅[^13] ✅[^1]:
```console
error[E0793]: reference to field of packed struct is unaligned
  = note: creating a misaligned reference is undefined behavior (even if that reference is never dereferenced)
```
`println!("{}", f.value)` fails the same way, because format macros take a reference ✅[^1] ✅[^13]. Three fixes work: copy the field (`let copy = f.value;` or `{ f.value }`), or take a raw pointer with `&raw const f.value` and call `read_unaligned`; a plain `*p` would be an unaligned load ✅[^12] ✅[^13]. Both the copy and `read_unaligned` printed `0xabcd` ✅[^1].

### 6. `repr(transparent)`
Allowed on a struct (or one-variant enum) with at most one field that is not zero-sized with alignment 1; the type then has exactly that field's layout *and ABI* ✅[^2] ✅[^4]. `struct Meters(f64)` with it measured 8 bytes, align 8 ✅[^1]. Unlike `repr(C)`, which always uses the C struct ABI, a transparent wrapper is passed exactly like its field, which is what a newtype across a foreign function interface (FFI) needs ✅[^2].

### 7. Niches
A *niche* is a bit pattern a type's validity rules forbid; layout optimizations store an enum's tag there ✅[^17]. `std` guarantees that `Option<T>` has the size, alignment and call ABI of `T` for `&U`, `&mut U`, `Box<U>`, `NonNull<U>` (all with `U: Sized`), function pointers, `NonZero*`, and `repr(transparent)` wrappers of these; for them `None` is all-zero bytes ✅[^6]. Measured on aarch64 ✅[^1]:

| Type | size | Why |
|---|---|---|
| `Option<&u64>`, `Option<Box<u64>>` | 8 (same as the pointer) | null is a niche; guaranteed ✅[^6] |
| `Option<NonZeroU32>` vs `Option<u32>` | 4 vs 8 | 0 is a niche of `NonZeroU32`; `u32` has none, so a tag plus padding is added |
| `Option<*const u64>` | 16 | raw pointers may be null: no niche |
| `Option<bool>`, `Option<Option<bool>>`, `Option<char>` | 1, 1, 4 | a `bool` never holds the bytes 2..=255, a `char` never a surrogate or a value above `0x10FFFF`; measured, not guaranteed |
| `Option<Vec<u8>>` | 24 (same as `Vec<u8>`) | `Vec`'s pointer is non-null; measured, not guaranteed |
| `Option<MaybeUninit<bool>>` | 2 | `MaybeUninit` may hold any bits, so it has no niche ✅[^7] |

### 8. Zero-sized types (ZSTs)
`()`, a unit struct, `[u64; 0]` and `PhantomData<T>` measured size 0; `[u64; 0]` keeps align 8 ✅[^1] ✅[^2]. `PhantomData<T>` is guaranteed size 0, align 1 for every `T` ✅[^16]. Operations on ZSTs compile to nothing, which is why a `HashSet<K>` can be a `HashMap<K, ()>`; for unsafe code, pointer offsets on a ZST are no-ops and allocators usually refuse size 0 ✅[^5]. A `Vec` of a ZST never allocates and reports `capacity() == usize::MAX`: 1000 elements gave `len=1000 capacity=18446744073709551615` ✅[^14] ✅[^1].

### 9. Dynamically sized types (DSTs) and wide pointers
A DST (`[T]`, `str`, `dyn Trait`) has no size known at compile time, so it lives behind a *wide* pointer: address plus length for slices, address plus vtable pointer for trait objects ✅[^5]. `&[u8]`, `&str`, `*const [u8]`, `Box<str>`, `&dyn Area` and `Box<dyn Area>` (`Area` is a one-method trait) each measured 16 bytes, two words ✅[^1]. The Reference promises only that a wide pointer is at least as large as a thin one; "twice `usize`" is today's layout, not a guarantee ✅[^2]. `size_of_val` reads the pointee size through the metadata: 6 for a `&[u16]` of 3 elements, 6 for `"héllo"` (`é` is two UTF-8 bytes) ✅[^1].

### 10. `MaybeUninit<T>`
The compiler assumes every variable holds a valid value of its type, so `mem::zeroed::<&T>()` is UB and so is an uninitialized `i32`: uninitialized memory "does not have a fixed value" ✅[^7]. Lab, both caught ✅[^1]:
- `MaybeUninit::<u32>::uninit().assume_init()`: rustc warns ``the type `u32` does not permit being left uninitialized`` (lint `invalid_value`); Miri reports `constructing invalid value of type u32: encountered uninitialized memory, but expected an integer`.
- `mem::zeroed::<&u8>()`: the debug build panics with ``attempted to zero-initialize type `&u8`, which is invalid`` and aborts; Miri reports `encountered a null reference`.

A `MaybeUninit<T>` has the same size, alignment and ABI as `T` ✅[^7] (8 bytes for `u64` ✅[^1]), and the compiler knows its bytes may be anything. The element-by-element pattern from the std docs, here with other data, ran clean under Miri ✅[^7] ✅[^1]:
```rust
let mut slots: [MaybeUninit<String>; 3] = [const { MaybeUninit::uninit() }; 3];
for (i, slot) in slots.iter_mut().enumerate() {
    slot.write(format!("bin-{i}"));   // write() does not drop the old (uninit) value
}
// SAFETY: every element was written above; MaybeUninit<T> has T's layout.
let labels = unsafe { std::mem::transmute::<_, [String; 3]>(slots) };
// ["bin-0", "bin-1", "bin-2"]
```
Dropping a `MaybeUninit` drops nothing, so a panic in the loop leaks the strings already written but causes no UB; calling `write` twice on one slot leaks the first value ✅[^7].

### 11. Leaking is safe: `mem::forget`, `ManuallyDrop`, `Box::leak`
`mem::forget` is a safe function because "Rust's safety guarantees do not include a guarantee that destructors will always run": `Rc` cycles and `process::exit` already skip them ✅[^8]. So unsafe code "must allow for this possibility": it cannot hand out a value and count on its destructor running ✅[^8]; `rust/unsafe/variance-phantomdata-and-drop-check.md` shows what that means for guard types. `ManuallyDrop<T>` is the wrapper form: `repr(transparent)`, same layout and validity as `T`, usable through `Deref`, and its `drop` is `unsafe` because a second call or a later use is UB ✅[^9]. The std docs prefer it over `forget` when handing memory to another owner (`String::from_raw_parts`), since a panic then leaks instead of double-freeing ✅[^8]. `Box::leak` turns a box into a `&'a mut T` (often `'static`) for data that should live until exit ✅[^15].

Lab: a `Loud` value (its `Drop` prints `drop <name>`) named "a" passed to `forget` and one named "b" wrapped in `ManuallyDrop` never printed; only `drop c` appeared ✅[^1]. Miri then reported `error: memory leaked: alloc245 (Rust heap, size: 1, align: 1)` and one more, and exited 1; that is a leak report, not `Undefined Behavior`, and `-Zmiri-ignore-leaks` silences it ✅[^1] ✅[^18].

## Worked example
Shrinking a `repr(C)` struct that must keep C layout, by ordering the fields from largest to smallest alignment ✅[^1]:

| Struct | Placement (Reference algorithm ✅[^2]) | size |
|---|---|---|
| `#[repr(C)] SensorC { flag: u8, reading: u32, id: u16 }` | `flag` 0..1, 3 bytes padding, `reading` 4..8, `id` 8..10, 2 bytes tail padding to reach a multiple of 4 | 12 |
| `#[repr(C)] SensorCOrdered { reading: u32, id: u16, flag: u8 }` | `reading` 0..4, `id` 4..6, `flag` 6..7, 1 byte tail padding | 8 |

`offset_of!` printed `reading=0 id=4 flag=6` for the ordered struct and `size_of` printed `SensorC 12 -> SensorCOrdered 8`, the same 8 bytes and the same offsets that `repr(Rust)` chose for `Sensor` by itself ✅[^1]. The C side must declare its fields in the same new order.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `&packed.value` or `println!("{}", packed.value)` | `E0793`, even inside `unsafe` | A misaligned reference is UB ✅[^1] ✅[^13] |
| `&packed.tag` where `tag: u8` | Allowed | Alignment 1 is always met ✅[^13] |
| `#[repr(C, packed)]` struct that contains an `#[repr(align(8))]` type | Rejected | `packed` may not transitively contain `align` ✅[^2] |
| `Option<*const T>` | 16 bytes on aarch64 | No niche in a nullable pointer ✅[^1] |
| `repr(u8)` on an `Option`-like enum | Grows from 8 to 16 bytes | A fixed tag disables the niche ✅[^1] ✅[^4] |
| Transmuting `None::<&T>` to `&T` | UB | Only `Some` values may be transmuted back ✅[^6] |
| `(u8, ())` | 1 byte | The ZST adds nothing ✅[^1] |
| `&*ptr` where `ptr` points to a ZST | Still must be non-null and aligned | Only loads and stores through a null ZST pointer are allowed ✅[^5] |
| `MaybeUninit::write` twice | The first value leaks | `write` never drops the old content ✅[^7] |
| A raw `Vec` layout assumption (pointer first) | Not guaranteed | `Vec` makes no promise about its field order ✅[^14] |
| Reclaiming a `Box::leak` reference with `Box::from_raw` | A "grey area" the docs advise against | Prefer `Box::into_raw` when memory must be freed later ✅[^15] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `repr(Rust)` | Smallest layout, chosen by the compiler | No order, no stability across compilations |
| `repr(C)` | Predictable, C-compatible | Padding follows your field order |
| `repr(C, packed)` | Exact byte image of a wire format | No references to fields; unaligned loads may be slow or fault on some CPUs ✅[^4] |
| `MaybeUninit<T>` | Delayed or partial initialization without UB | Every `assume_init` is a proof obligation |

## Takeaways
- Put `#[repr(C)]` (or `#[repr(transparent)]` for a newtype) on every type that crosses FFI or is reinterpreted from bytes. [rule-candidate]
- Never take `&` or `&mut` of a `packed` field; copy it or use `&raw const` plus `read_unaligned`. [rule-candidate]
- Count on a free `Option` only for the types std lists (references, `Box`, `NonNull`, `NonZero*`, function pointers); measure anything else.
- Hold not-yet-valid data in `MaybeUninit<T>`, never in a `T` made by `mem::zeroed` or `assume_init` on fresh memory. [rule-candidate]
- Design unsafe code so that a skipped destructor leaks instead of causing UB; prefer `ManuallyDrop` over `mem::forget` when handing memory to a new owner.
- Sizes in this doc are aarch64 measurements; check `size_of` on your target.

## Verification status
- Verified: 84 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `linux/lab-setup.md` — the Rust 1.100.0 lab (`rustlab:1`) where every behaviour marked with this note ran on 2026-11-24; sizes are for aarch64-unknown-linux-gnu. [^1]
- [Type layout](https://doc.rust-lang.org/reference/type-layout.html) — The Rust Reference, Rust project, living. Backs: size and alignment rules, primitive and pointer layout, `repr(Rust)`, `repr(C)` algorithm, primitive reprs, `align`/`packed`, `transparent`. [^2]
- [repr(Rust)](https://doc.rust-lang.org/nomicon/repr-rust.html) — The Rustonomicon, Rust project, living. Backs: alignment and padding, reordering, same-type-same-layout. [^3]
- [Other reprs](https://doc.rust-lang.org/nomicon/other-reprs.html) — The Rustonomicon, Rust project, living. Backs: `repr(C)` purpose and ZSTs, field-less enum best guess, `transparent`, primitive reprs disable the niche, `packed` hazards, `align`. [^4]
- [Exotically Sized Types](https://doc.rust-lang.org/nomicon/exotic-sizes.html) — The Rustonomicon, Rust project, living. Backs: DSTs and wide pointers, ZSTs in generic and unsafe code. [^5]
- [std::option](https://doc.rust-lang.org/std/option/index.html) — Rust standard library, living. Backs: the Representation guarantee and its type list, `None` as zero bytes. [^6]
- [MaybeUninit in std::mem](https://doc.rust-lang.org/std/mem/union.MaybeUninit.html) — Rust standard library, living. Backs: initialization invariant, array pattern, layout, `write` semantics. [^7]
- [forget in std::mem](https://doc.rust-lang.org/std/mem/fn.forget.html) — Rust standard library, living. Backs: why `forget` is safe, `ManuallyDrop` preferred for ownership transfer. [^8]
- [ManuallyDrop in std::mem](https://doc.rust-lang.org/std/mem/struct.ManuallyDrop.html) — Rust standard library, living. Backs: layout, `Deref`, why `drop` is unsafe. [^9]
- [size_of in std::mem](https://doc.rust-lang.org/std/mem/fn.size_of.html) — Rust standard library, living. Backs: pointer sizes, `repr(C)` size algorithm, sizes not stable across compilations. [^10]
- [offset_of in std::mem](https://doc.rust-lang.org/std/mem/macro.offset_of.html) — Rust standard library, living. Backs: byte offsets; layouts may differ between compilations. [^11]
- [read_unaligned in std::ptr](https://doc.rust-lang.org/std/ptr/fn.read_unaligned.html) — Rust standard library, living. Backs: unaligned reads and `&raw const` for packed fields. [^12]
- [E0793](https://doc.rust-lang.org/error_codes/E0793.html) — Error codes index, Rust project, living. Backs: references to packed fields, format macros, fixes. [^13]
- [Vec in std::vec](https://doc.rust-lang.org/std/vec/struct.Vec.html) — Rust standard library, living. Backs: ZST capacity `usize::MAX`, no layout guarantee. [^14]
- [Box in std::boxed](https://doc.rust-lang.org/std/boxed/struct.Box.html) — Rust standard library, living. Backs: `Box::leak`. [^15]
- [PhantomData in std::marker](https://doc.rust-lang.org/std/marker/struct.PhantomData.html) — Rust standard library, living. Backs: size 0, align 1 guarantee. [^16]
- [Glossary](https://rust-lang.github.io/unsafe-code-guidelines/glossary.html) — Unsafe Code Guidelines Reference, Rust project, living. Backs: niche and padding definitions. [^17]
- [rust-lang/miri: An interpreter for Rust's mid-level intermediate representation](https://github.com/rust-lang/miri) — Miri project (README), living. Backs: leak checker and `-Zmiri-ignore-leaks`, `-Zrandomize-layout`. [^18]

## Related
- `rust/unsafe/unsafe-rust-and-undefined-behavior.md` — invalid values and the rest of the UB list.
- `rust/unsafe/variance-phantomdata-and-drop-check.md` — `PhantomData`, leak amplification.
- `rust/unsafe/ffi-and-c-interop.md` — `repr(C)` structs passed to C.
- `rust/traits-and-generics/trait-objects-and-dynamic-dispatch.md` — what the vtable half of a wide pointer holds.
- `rust/smart-pointers/box-deref-and-drop.md` — `Box` and `Drop`.
