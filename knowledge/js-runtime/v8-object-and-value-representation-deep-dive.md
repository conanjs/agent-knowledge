---
schema: deep-dive/v1
topic: js-runtime
status: verified
applies-to: ["Node.js 24.22.1 with V8 13.6.233.17 (official build: pointer compression off, 32-bit small integers), image node:24.22.1-alpine, linux arm64, in Docker on an Apple M2", "V8 source at tag 13.6.233.17; older tags only where named", "lab runs of 2026-11-26", "matrix re-run 2026-11-27: macOS arm64 Node.js 24.22.1, linux x64 (emulated) Node.js 24.22.1, Node.js 22.23.4 (V8 12.4), Node.js 25.7.0 (V8 14.1), Electron 43.7.7 as Node (V8 15.0, pointer compression on), the unofficial Node.js 24.22.3 linux x64 build with pointer compression on and the sandbox off (emulated); narrowing runs on Deno 2.9.8 (V8 15.0) and Electron 38.8.6 (V8 14.0); Google Chrome 158.0.8127.89 (V8 15.8, pointer compression on), scripts in a headless page"]
last-updated: 2026-11-28
last-verified: 2026-11-27
synthesized-into:
  - { path: javascript/best-practices/browser-rendering-and-interaction.md, on: 2026-11-28 }
  - { path: javascript/best-practices/measuring-performance.md, on: 2026-11-28 }
  - { path: javascript/best-practices/numbers-and-arrays.md, on: 2026-11-28 }
  - { path: javascript/best-practices/objects-and-shapes.md, on: 2026-11-28 }
  - { path: javascript/best-practices/strings-and-collections.md, on: 2026-11-28 }
tags: [v8, node, performance, memory, smi, heap-number, pointer-compression, field-representation, slack-tracking, dictionary-mode, elements-kinds, typed-arrays, strings, cons-string, sliced-string, map, set, proxy]
ranked-sources: true
---

# How V8 stores values, objects, arrays and strings (Node.js 24)

## Summary
**TL;DR:** In Node.js 24.22.1 (V8 13.6), a number is stored either as a small integer inside the pointer itself (a Smi, from -2³¹ to 2³¹-1 in this build; from -2³⁰ to 2³⁰-1 where pointer compression is on, as in Electron and in Chrome 158 ✅[^lab-matrix], which the V8 team turned on in Chrome 80 ✅[^v8-dev-80]) or as a separate 16-byte heap number; an object keeps its first properties inside itself and the rest in a side array, until a `delete`, an accessor in a literal, or too many computed keys turn it into a hash table (dictionary mode) ✅[^lab]. Arrays carry an elements kind that only moves from specific to general (small integers → doubles → anything, packed → holey) ✅[^v8-elements], with one new exception in this build: `fill()` over the whole array makes a holey array packed again ✅[^lab] (not yet in V8 12.4, Node.js 22 ✅[^lab-matrix]). Strings are one-byte or two-byte, and `+` and `slice` build ropes and slices that point at other strings, so a 20-character slice can keep a 10 MB parent alive ✅[^lab].
**Use this when:** you want to know what memory layout and which fast or slow mode your objects, arrays, strings, `Map`s and typed arrays get in Node.js 24; you review code that uses `delete`, computed keys, `new Array(n)`, holes, string building or `Proxy`; you want to check a piece of popular V8 advice against a real run.
**Depth:** tagged values and pointer compression in this build; field representations and double boxing; in-object and out-of-object properties and slack tracking; every way into and out of dictionary mode that was tested, with the thresholds; integer-like keys; the elements-kinds lattice step by step, holes, `new Array(n)`, `Array.from`, `fill`, `length = 0`, sparse arrays; typed arrays and where their bytes live; string representations; `Map` and `Set` against objects; literals, spread, `Object.assign`, classes and prototypes; getters, setters and `Proxy`; bytes per element for each representation; nine corrections of popular advice. Each lab script and its output is embedded. Shapes, transitions and inline caches are in [V8 hidden classes and inline caches](v8-hidden-classes.md) and are not repeated; compiler tiers and deoptimization are in [the compiler pipeline deep dive](v8-compiler-pipeline-deep-dive.md); garbage collection and what keeps memory alive are in [the memory and startup deep dive](v8-memory-and-startup-deep-dive.md).

## 1. Mental model

Think of the V8 heap as a warehouse. Every slot on a shelf is one machine word (8 bytes in this build). A slot holds either a small integer written directly on the label (a Smi) or the address of a box somewhere else (a pointer to a heap object). Objects are boxes with a few built-in slots, a label saying which layout they follow (the map, also called hidden class or shape), and two side drawers: one for extra named properties and one for numbered items (the elements). Most of what this doc measures is which drawer a value ends up in, and whether the drawer is a neat row of slots (fast) or a hash table you must search (dictionary).

### 1.1 Words first

| Term | Plain meaning | Analogy | Concrete example (this build) |
|---|---|---|---|
| Tagged value | A machine word that holds either a small integer or a pointer, told apart by its lowest bit ✅[^v8-ptrcomp] | A label that is either a number written on it, or a shelf address | `%DebugPrint(42)` prints `Smi: 0x2a (42)` ✅[^lab] |
| Smi (small integer) | An integer stored inside the tagged word itself, with no box ✅[^v8-ptrcomp] | Writing the price on the tag instead of in a separate book | `2 ** 31 - 1` is a Smi, `2 ** 31` is not ✅[^lab] |
| Heap number | A 16-byte box holding one 64-bit floating-point number (12 bytes with pointer compression: Electron 43, the Node.js 24.22.3 pointer-compression build and Chrome 158 ✅[^lab-matrix]) | A small envelope holding one figure | `1.5` prints as `<HeapNumber 1.5>` ✅[^lab] |
| Pointer compression | A build option that stores pointers in 32 bits inside a 4 GB region ✅[^v8-ptrcomp] | Writing shelf numbers with fewer digits because the warehouse is small | Off in the official Node.js 24 build: `v8_enable_pointer_compression: 0` ✅[^lab]; on in Electron 43 and in the unofficial Node.js 24.22.3 pointer-compression build: `1` ✅[^lab-matrix] (§3.1) |
| Map (hidden class, shape) | The layout record every heap object points to; explained in [v8-hidden-classes.md](v8-hidden-classes.md) | The floor plan of a box | `{x, y}` and `{y, x}` have different maps ✅[^lab] |
| Field representation | What kind of value a property slot has held so far: None, Smi, Double, HeapObject or Tagged (anything) ✅[^v8-fields] | A shelf marked "coins only", then "coins or notes" | `x` goes Smi → Double → Tagged in `--trace-generalization` as `s` → `d` → `t` ✅[^lab] |
| In-object property | A property stored in a slot inside the object itself ✅[^v8-fastprops] | A pocket sewn into the coat | `{}` has 4 in-object slots ✅[^lab] |
| Out-of-object property (property array) | A property stored in a separate array the object points to | A bag carried next to the coat | the 5th and 6th keys added to `{}` go to a `PropertyArray[3]` ✅[^lab] |
| Slack tracking | Giving objects made by a constructor extra slots at first, then shrinking to what was used after 7 constructions ✅[^v8-slack] | Buying a suitcase one size too big, then swapping it after a week of trips | `new Point()` has 10 in-object slots at first, 2 after 12 instances ✅[^lab] |
| Dictionary mode (slow properties) | Properties kept in a hash table inside the object instead of in slots described by the map ✅[^v8-fastprops] | A drawer of loose cards you must search | after `delete o.b`, `%HasFastProperties(o)` is `false` ✅[^lab] |
| Elements, elements kind | The numbered properties of an object or array, kept apart from named ones, and the tag saying what they hold ✅[^v8-fastprops] ✅[^v8-elements] | A numbered rack, and a sign on it: "integers only" | `[1, 2, 3]` is `PACKED_SMI_ELEMENTS` ✅[^lab] |
| Packed / holey | Holey means some indexes in the range may be missing (a hole); packed means none can be ✅[^v8-elements] | A full egg carton, against one that may have empty cups | `[1, , 3]` is `HOLEY_SMI_ELEMENTS` ✅[^lab] |
| Dictionary elements | Numbered elements kept in a hash table keyed by index ✅[^v8-jsarray] | A sparse ledger listing only the filled pages | `[1, 2, 3]` then `a[1027] = 1` ✅[^lab] |
| One-byte / two-byte string | A string whose characters are stored in 1 byte each (all codes ≤ 255) or in 2 bytes each ✅[^v8-string] | Writing in plain letters, or in a script that needs wider cells | `"café"` is one-byte; `"a—b"` (em dash, U+2014) is two-byte ✅[^lab] |
| Cons string (rope) | A string made by `+` that just points at its two halves ✅[^v8-string] | Taping two notes together instead of rewriting them | 13 or more characters joined by `+` gives `CONS_ONE_BYTE_STRING_TYPE` ✅[^lab] |
| Flattening | Copying a rope into one contiguous string | Rewriting the taped notes onto one sheet | after `s.charCodeAt(50)`, `%StringIsFlat(s)` is `true` ✅[^lab] |
| Sliced string | A substring that points into its parent with an offset and length ✅[^v8-string] | A bookmark into a book, not a photocopy | `long.slice(1, 14)` is `SLICED_ONE_BYTE_STRING_TYPE` ✅[^lab] |
| Internalized string | The one shared copy of a string kept in V8's string table, so equal names are the same object; a thin string is a forwarder to it ✅[^v8-string] | The dictionary's official spelling, and a sticky note saying "see the dictionary" | `"key7"` built at run time becomes `THIN_ONE_BYTE_STRING_TYPE` after `o[k] = 1` ✅[^lab] |
| Ordered hash table | The hash table behind `Map` and `Set` that remembers insertion order ✅[^v8-ordered] | A hash index plus an append-only list | `%DebugPrint(new Map([[1, 1]]))` shows `table: <OrderedHashMap[17]>` ✅[^lab] |
| Native (`%Name`) | A V8 internal function callable from JavaScript with `--allow-natives-syntax`, for testing only | A service hatch in the wall | `%HasFastProperties(o)` |

The `%DebugPrint` examples in this table come from this run ✅[^lab]:

<details>
<summary>Lab: <code>debugprint.mjs</code></summary>

```sh
docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node --allow-natives-syntax debugprint.mjs | grep -E '^##|^DebugPrint| - type:| - table:' | sed -E 's/0x[0-9a-f]{6,}/0x…/g'
```

```js
// What %DebugPrint says a value is; run through: grep -E '^##|^DebugPrint| - type:| - table:'
const show = (label, v) => { console.log('##', label); %DebugPrint(v); };
show('42', 42);
show('1.5', 1.5);
show('new Map([[1, 1]])', new Map([[1, 1]]));
show('new Proxy({ a: 1 }, {})', new Proxy({ a: 1 }, {}));
```

Output:

```text
## 42
DebugPrint: Smi: 0x2a (42)
## 1.5
DebugPrint: 0x…: [HeapNumber]
 - type: HEAP_NUMBER_TYPE
## new Map([[1, 1]])
DebugPrint: 0x…: [JSMap]
 - table: 0x… <OrderedHashMap[17]>
 - type: JS_MAP_TYPE
## new Proxy({ a: 1 }, {})
DebugPrint: 0x…: [JSProxy]
 - type: JS_PROXY_TYPE
```

</details>

### 1.2 How the lab ran

Every ✅[^lab] claim was run on 2026-11-26 in the Docker image `node:24.22.1-alpine` (Node.js 24.22.1, V8 `13.6.233.17-node.58`, arm64) with the network off. Each `<details>` block gives the command, the script and its output. Addresses in `%DebugPrint` output change every run, so those commands pipe the output through `sed` to replace them with `0x…`. Timings are "measured here": they vary from run to run and from machine to machine, and only the order of magnitude between cases carries over.

Natives used: `%IsSmi`, `%HaveSameMap`, `%HasFastProperties`, `%HasSmiElements`, `%HasDoubleElements`, `%HasObjectElements`, `%HasHoleyElements`, `%HasDictionaryElements`, `%HasFixedFloat64Elements`, `%StringIsFlat`, `%FlattenString`, `%IsInternalizedString`, `%DebugPrint`. Flags used, all present in this build's `node --v8-options`: `--allow-natives-syntax`, `--expose-gc`, `--trace-generalization`, `--fast-properties-soft-limit`. There is no `--trace-maps` flag in this build ✅[^lab]. In Chrome 158 (V8 15.8) every one of these natives answers in a page started with `--js-flags=--allow-natives-syntax`, but `%DebugPrint` writes to the renderer's standard output, which headless Chrome does not pass on, so its output cannot be read there ✅[^lab-matrix]:

<details>
<summary>Lab: <code>flags.mjs</code></summary>

```sh
docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node flags.mjs
```

```js
// Which flags does this build have, and with which defaults? Reads `node --v8-options`.
import { execFileSync } from 'node:child_process';
const text = execFileSync(process.execPath, ['--v8-options'], { encoding: 'utf8' });
for (const flag of ['trace-generalization', 'trace-normalization', 'trace-elements-transitions', 'trace-maps', 'fast-properties-soft-limit', 'max-fast-properties', 'unbox-double-arrays', 'string-slices', 'expose-gc']) {
  const m = text.match(new RegExp(`^  --${flag} \\(.*\\)\\n\\s+type: \\S+  default: (.*)$`, 'm'));
  console.log(`--${flag}`.padEnd(30), m ? `present, default ${m[1]}` : 'absent');
}
```

Output:

```text
--trace-generalization         present, default --no-trace-generalization
--trace-normalization          present, default --no-trace-normalization
--trace-elements-transitions   present, default --no-trace-elements-transitions
--trace-maps                   absent
--fast-properties-soft-limit   present, default --fast-properties-soft-limit=12
--max-fast-properties          present, default --max-fast-properties=128
--unbox-double-arrays          present, default --unbox-double-arrays
--string-slices                present, default --string-slices
--expose-gc                    present, default --no-expose-gc
```

</details>

Two tracing flags exist but did not show this script's own changes in this release build: `--trace-normalization` printed nothing for a `delete`, and `--trace-elements-transitions` printed two transitions of arrays inside Node.js's startup code, before the script ran, and nothing for the script's `push(4.5)` and `push('x')` ✅[^lab]. Node.js 22.23.4 (V8 12.4) printed one startup transition and Electron 43 none; neither printed anything for the script ✅[^lab-matrix]. The Node.js 24.22.3 build with pointer compression on printed the same two startup lines as the baseline, so Electron's silence does not come from pointer compression ✅[^lab-matrix]. Electron 38.8.6 (V8 14.0) printed no startup line either, so the silence is common to the two Electron builds run; Deno 2.9.8 has no Node.js startup code to compare and printed nothing for the script ✅[^lab-matrix]. Not checked in Chrome: V8's trace output does not leave the renderer there. The natives are more reliable here.

<details>
<summary>Lab: <code>silent.mjs</code></summary>

```sh
docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node --trace-normalization --trace-elements-transitions silent.mjs | sed -E 's/0x[0-9a-f]{6,}/0x…/g'
```

```js
// Run with --trace-normalization --trace-elements-transitions: does either flag print anything here?
const o = { a: 1, b: 2, c: 3 };
console.log('before delete o.b'); delete o.b; console.log('after delete o.b');
const a = [1, 2, 3];
console.log("before push(4.5), push('x')"); a.push(4.5); a.push('x'); console.log("after push(4.5), push('x')");
```

Output:

```text
elements transition [PACKED_SMI_ELEMENTS -> PACKED_ELEMENTS] in from+0 at <unknown>:<unknown> for 0x… <JSArray[0]> from 0x… <FixedArray[17]> to 0x… <FixedArray[17]>
elements transition [PACKED_SMI_ELEMENTS -> PACKED_ELEMENTS] in from+0 at <unknown>:<unknown> for 0x… <JSArray[0]> from 0x… <FixedArray[17]> to 0x… <FixedArray[17]>
before delete o.b
after delete o.b
before push(4.5), push('x')
after push(4.5), push('x')
```

</details>

## 2. Concept architecture

| Layer | What V8 stores | What decides fast or slow | Section |
|---|---|---|---|
| A value | a Smi in the word, or a pointer to a heap object (heap number, string, object) | whether the number is an integer in the Smi range | §3.1 |
| A named property (field) | a slot whose representation is tracked on the map | the values written so far: Smi, Double, HeapObject, Tagged | §3.2 |
| An object's named properties | in-object slots, then a property array; or one dictionary | how the object was built, `delete`, computed keys, accessors | §3.3 – §3.5 |
| An object's numbered properties | elements: a fixed array of a given kind, or a number dictionary | the values (kind), holes, gaps and length | §3.6 – §3.8 |
| Binary data | a typed array over an `ArrayBuffer`, on the V8 heap up to 64 bytes, off it above | the size | §3.9 |
| Text | sequential, cons, sliced, thin or internalized strings, one-byte or two-byte | the characters and how the string was made | §3.10 |
| Keyed collections | `Map` and `Set` as ordered hash tables | nothing: they are always hash tables | §3.11 |

The map ties these together: it records the field representations, where each property lives, the prototype and the elements kind, so changing any of them gives the object a different map ✅[^v8-hidden] ✅[^lab]. How maps form transition trees, and how inline caches use them, is in [v8-hidden-classes.md](v8-hidden-classes.md); how the optimizing compilers use the map and deoptimize when it changes is in [v8-compiler-pipeline-deep-dive.md](v8-compiler-pipeline-deep-dive.md).

## 3. How it works

### 3.1 Tagged values: small integers and heap numbers

#### What pointer compression is for

**The problem.** In 2014 Chrome switched from a 32-bit to a 64-bit process, and every pointer grew from 4 bytes to 8 ✅[^v8-ptrcomp]. A pointer is one kind of tagged value: a slot that holds either a small integer or an address (§1.1). The V8 team found that on real websites tagged values took about 70 % of the V8 heap, the memory where V8 keeps JavaScript objects ✅[^v8-ptrcomp]; V8's design document says tagged fields "make up the majority of V8 heap memory" ✅[^v8-ptrcomp-design]. So the move to 64-bit almost doubled most of the heap.

**The answer.** Keep the whole heap inside one reserved block of 4 GB (gigabytes: 2³² bytes) of addresses, called the cage, and store in each slot only a 4-byte offset from the start of the cage instead of the full 8-byte address ✅[^v8-ptrcomp] ✅[^v8-ptrcomp-design]. Reading a slot adds the cage's start address (the base) back: that is decompression. Writing a slot keeps only the offset: that is compression.

**Analogy.** A full postal address is long. When everyone you write to lives in the same building, the room number is enough. The building is the cage, the room number is the 4-byte offset, and the building's street address is the base, written down once.

**Worked example (measured here).** The script `fieldmem.mjs` (§3.2) keeps 1 000 000 objects `{ x, y }`, each with two small-integer fields, in an array. On the official Node.js 24.22.1 build (linux x64, pointer compression off) each object plus its array slot took 48.0 bytes; on the unofficial Node.js 24.22.3 build with pointer compression on (same V8 13.6, same emulated x64 machine) it took 24.0 bytes ✅[^lab-matrix]. Both numbers fit the same 6 tagged words, at 8 or at 4 bytes: 6 × 8 = 48 and 6 × 4 = 24 (three header words of the object, its two fields, and the array slot; the lab measures bytes, not words). For the million objects that is 1 000 000 × 48 = 48 000 000 bytes (about 45.8 MiB) against 1 000 000 × 24 = 24 000 000 bytes (about 22.9 MiB); a MiB (mebibyte) is 1 048 576 bytes.

What it gives, what it costs and why Chrome has it on while the official Node.js builds have it off are at the end of this section, after the mechanism.

#### How it works: tagged words, small integers and heap numbers

**What the engine does.** Every value slot is one tagged word. On 64-bit machines without pointer compression, V8 uses 32 bits of that word for the Smi payload ✅[^v8-ptrcomp]; with pointer compression the payload is 31 bits ✅[^v8-ptrcomp]. The official Node.js 24.22.1 build has pointer compression off, so a slot is 8 bytes and Smis are 32-bit ✅[^lab]. Any number that is not an integer in that range, including `-0` and `NaN`, lives in a heap number box ✅[^lab].

**Why it helps.** A Smi needs no allocation and no pointer chase, so integer counters, indexes and small IDs cost nothing beyond their slot.

**Code that keeps it working.** Integers between -2 147 483 648 and 2 147 483 647 (between -1 073 741 824 and 1 073 741 823 where pointer compression is on). **Code that defeats it.** Values like `2 ** 31`, `1.5`, `-0` or `NaN`; each needs a heap number when it is stored in a generic slot ✅[^lab].

**See it yourself.**

<details>
<summary>Lab: <code>values.mjs</code></summary>

```sh
docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node --allow-natives-syntax values.mjs
```

```js
// Which numbers are small integers (Smi) in this build?
const cases = [['0', 0], ['-0', -0], ['2**30', 2 ** 30], ['2**31 - 1', 2 ** 31 - 1], ['2**31', 2 ** 31],
  ['-(2**31)', -(2 ** 31)], ['-(2**31) - 1', -(2 ** 31) - 1], ['1.5', 1.5], ['NaN', NaN], ['3.0', 3.0], ['2**53', 2 ** 53]];
for (const [label, v] of cases) console.log(label.padEnd(22), 'Smi:', %IsSmi(v));
const c = process.config.variables;
console.log('pointer compression:', c.v8_enable_pointer_compression, '| 31-bit Smis on 64-bit:', c.v8_enable_31bit_smis_on_64bit_arch);
```

Output:

```text
0                      Smi: true
-0                     Smi: false
2**30                  Smi: true
2**31 - 1              Smi: true
2**31                  Smi: false
-(2**31)               Smi: true
-(2**31) - 1           Smi: false
1.5                    Smi: false
NaN                    Smi: false
3.0                    Smi: true
2**53                  Smi: false
pointer compression: 0 | 31-bit Smis on 64-bit: 0
```

</details>

**Pointer compression, in plain words.** On a 64-bit machine a full pointer is 8 bytes. Pointer compression keeps the whole V8 heap inside one 4 GB region and stores each pointer in 32 bits, as a position inside that region ✅[^v8-ptrcomp]. Analogy: a full postal address is long, but inside one building a room number is enough. Example: an array of 1 000 000 small integers took 8.0 bytes per element on the official Node.js 24 build and 4.0 in Electron 43, in the unofficial Node.js 24.22.3 build and in a Chrome 158 page, all with pointer compression on ✅[^lab] ✅[^lab-matrix] (§4.1). What it changes:

- **Slot size.** Every tagged slot is 4 bytes instead of 8, so objects, pointer arrays, `Map`s and `Set`s take about half the heap; raw data does not shrink: double arrays stayed at 8 bytes per element and string characters at 1 or 2 bytes ✅[^lab-matrix] (§4.1).
- **Heap limit.** A heap inside a 4 GB region cannot grow past 4 GB. Node.js's build option says it "limits max heap to 4GB" ✅[^node-configure], and Electron names the 4 GB cap as the main downside ✅[^electron-cage]. The cap that pointer compression puts on the heap was measured on the 16 GiB macOS host: with `--max-old-space-size=8192` and `--max-old-space-size=16384`, `heap_size_limit` followed the flag on Node.js 24.22.1 and 25.7.0 (8,384 and 16,576 MiB) and stayed at 4,192 MiB on Electron 43.7.7 (V8 15.0) and at 4,096 MiB on Electron 38.8.6 (V8 14.0), the two builds with pointer compression on ✅[^lab-matrix]. Both Electron builds also have the V8 sandbox on, so those runs alone do not separate the two; the unofficial Node.js 24.22.3 build with pointer compression on and the sandbox off does: about 4,096 MiB (4,095.75) with `--max-old-space-size=8192`, against 8,384 MiB on the official Node.js 24.22.1 build on the same emulated linux x64 machine ✅[^lab-matrix]. In a Chrome 158 page, with no heap flag, `performance.memory.jsHeapSizeLimit` was 4,192 MiB ✅[^lab-matrix].
- **Small integers.** A Smi must fit, with its tag bit, in the 32-bit compressed word, so its payload drops from 32 bits to 31 ✅[^v8-ptrcomp].
- **Memory saved, as reported.** The V8 team measured the V8 heap up to 43 % smaller, and Chrome's renderer process memory up to 20 % smaller on desktop, in its browsing tests (post of 30 March 2020; "up to" figures; the renderer figure is for browsing on Windows 10) ✅[^v8-ptrcomp]. The V8 8.0 release post (18 December 2019) gives an average saving of 40 % ✅[^v8-release-80]. These are browser figures; no whole Node.js application was measured here.

**The small-integer width in each case.** The V8 header `include/v8-internal.h` at tag 13.6.233.17 defines two schemes: `SmiTagging<8>` with `kSmiValueSize = 32` and `SmiTagging<4>` with `kSmiValueSize = 31`. The tagged size is 4 bytes when `V8_COMPRESS_POINTERS` is defined and 8 bytes otherwise, and a separate macro, `V8_31BIT_SMIS_ON_64BIT_ARCH`, forces the 31-bit scheme even without compression ✅[^v8-internal]. With n payload bits the range is -2ⁿ⁻¹ to 2ⁿ⁻¹ - 1:

| Build | Smi payload | Smallest Smi | Largest Smi | Seen in the runs |
|---|---|---|---|---|
| 64-bit, pointer compression off | 32 bits ✅[^v8-internal] | -2 147 483 648 (-2³¹) | 2 147 483 647 (2³¹ - 1) | Node.js 22.23.4, 24.22.1 (linux arm64, macOS arm64, linux x64) and 25.7.0 ✅[^lab] ✅[^lab-matrix] |
| pointer compression on | 31 bits ✅[^v8-internal] | -1 073 741 824 (-2³⁰) | 1 073 741 823 (2³⁰ - 1) | Electron 43.7.7 (V8 15.0), an Electron build with V8 14.0, the unofficial Node.js 24.22.3 pointer-compression build (linux x64, V8 13.6), and Chrome 158.0.8127.89 (V8 15.8, in a page) ✅[^lab-matrix] |

**The default when you run Node.js normally: off.** In Node.js, pointer compression is chosen when Node.js is compiled, not when it runs. The `configure` option is `--experimental-enable-pointer-compression`, marked experimental, and its help text says it "limits max heap to 4GB and breaks ABI compatibility" ✅[^node-configure]. ABI (application binary interface) compatibility is what lets an already-compiled native add-on load; a build with the option needs add-ons compiled for it. The option sets the build variables `v8_enable_pointer_compression` and `v8_enable_31bit_smis_on_64bit_arch` to 1 when it is passed and to 0 otherwise ✅[^node-configure]; there is no run-time flag for it. Every official build run here reports 0 ✅[^lab-matrix]. No official release line has changed that default as far as the changelogs read show: the v24.0.0 and v24.2.0 release notes list only build changes and fixes for pointer-compression builds, and `CHANGELOG_V25.md`, read in full, only removes a build define in 25.1.0 ✅[^node-changelogs]. `CHANGELOG_V24.md` and `CHANGELOG_V26.md` were read only in part when the research notes were written (their first 100 000 characters, of about 824 000 and 548 000). A keyword search of both whole files on 2026-11-27 ("pointer compression", "ptr compression", `V8_COMPRESS_POINTERS`, "Smis") found only build entries in `CHANGELOG_V24.md` (the two above, the removed define, and one that turns off the shared cage on non-64-bit builds) and nothing in `CHANGELOG_V26.md`; that is a search, not a line-by-line read. One Node.js build with pointer compression on was run here: the unofficial build described under "Node.js builds with it on" below.

**How to check a given binary.**

```sh
node -p "process.config.variables.v8_enable_pointer_compression"
```

It prints `0` for off and `1` for on. The Node.js docs say `process.config` holds the configure options the executable was compiled with, the same as its `config.gypi` file ✅[^node-process-config]; they do not list or explain this field, so its meaning comes from `configure.py` ✅[^node-configure]. A second check that does not rely on the build record is the small-integer probe below: `%IsSmi(2 ** 30)` is `true` with compression off and `false` with it on. The second check matters: Electron 43 reports `v8_enable_pointer_compression: 1` but `v8_enable_31bit_smis_on_64bit_arch: 0`, yet its Smis are 31-bit, as the header predicts for 4-byte tagged words ✅[^lab-matrix] ✅[^v8-internal]. The unofficial Node.js 24.22.3 pointer-compression build reports both variables as `1`, as `configure.py` sets them ✅[^lab-matrix] ✅[^node-configure].

**Where it is on.**

- **Chrome:** on by default since Chrome 80; a V8 team member wrote on the v8-dev list on 20 February 2020 that Chrome 80 enabled it, and with it 31-bit Smis ✅[^v8-dev-80]. Measured in Chrome 158.0.8127.89 (V8 15.8) on 2026-11-27, in a headless page: `%IsSmi(2 ** 30)` is `false` and `%IsSmi(2 ** 30 - 1)` is `true` (the `smi.js` probe gives the 31-bit range), and `performance.memory.jsHeapSizeLimit` is 4,192 MiB ✅[^lab-matrix].
- **Electron:** on since Electron 14, per the Electron blog of 30 June 2022 ✅[^electron-cage]. Measured on 2026-11-27: Electron 43.7.7 (V8 15.0.245.31) and a second Electron build on the same machine (V8 14.0.365.10, Node.js 22.22.0 API), both in Node mode, both with 31-bit Smis and `v8_enable_pointer_compression: 1` ✅[^lab-matrix].
- **Deno:** off, from its source configuration: Deno's `Cargo.toml` takes its V8 crate with `default-features = false`, and the `rusty_v8` build script passes `v8_enable_pointer_compression=false` unless the Cargo feature of that name, or the sandbox feature, is set ✅[^deno-build]. A run agrees: Deno 2.9.8 (V8 15.0.245.2) in its container image on linux arm64, started with `--v8-flags=--allow-natives-syntax`, gave the 32-bit range with the `smi.js` probe (2³⁰ and 2³¹ − 1 are small integers, 2³¹ is not) ✅[^lab-matrix].

**Node.js builds with it on.** The Node.js project's unofficial-builds site publishes some: `node-v24.22.3-linux-x64-pointer-compression` and `node-v24.22.3-linux-riscv64-pointer-compression` (each as `.tar.gz` and `.tar.xz`, 12 November 2026), and the same two for v26.13.1 (11 November 2026) ✅[^node-unofficial]. Its README also lists an arm64 variant, but the v24.22.3 and v26.13.1 folders hold no arm64 pointer-compression file ✅[^node-unofficial]. One of them was downloaded and run here: `node-v24.22.3-linux-x64-pointer-compression` (the `.tar.xz` file), its SHA-256 checksum checked against the folder's `SHASUMS256.txt`, run on 2026-11-27 in a Debian 13 x64 container without network, under emulation on the arm64 host. Its `process.config.variables` showed `v8_enable_pointer_compression: 1`, `v8_enable_31bit_smis_on_64bit_arch: 1` and `v8_enable_sandbox: 0` ✅[^lab-matrix]; §6.3 calls it E9. The official Docker images (`library/node`) have no pointer-compression tag ✅[^docker-node].

**What to take from it.** An integer from 2³⁰ (1 073 741 824) to 2³¹ - 1 (2 147 483 647), or from -2³¹ to -2³⁰ - 1, is a Smi on an official Node.js build and a heap number in Electron, in the Node.js 24.22.3 pointer-compression build and in Chrome 158 ✅[^lab-matrix]. Code tuned on one can therefore behave differently on the other: a field or array holding such values stays on the Smi path in Node.js and holds boxed numbers in Electron and Chrome, and pointer-heavy structures take about half the heap in Electron, in Chrome 158 and in that build (§4.1).

<details>
<summary>Lab: <code>smi.js</code> (eight builds, 2026-11-27)</summary>

```sh
docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node --allow-natives-syntax smi.js                                     # E0
~/.nvm/versions/node/v24.22.1/bin/node --allow-natives-syntax smi.js                                                                              # E1
docker run --rm --network none --platform linux/amd64 -v "$PWD:/work" -w /work node:24.22.1-alpine-amd64 node --allow-natives-syntax smi.js       # E2
~/.nvm/versions/node/v22.23.4/bin/node --allow-natives-syntax smi.js                                                                              # E3
~/.nvm/versions/node/v25.7.0/bin/node --allow-natives-syntax smi.js                                                                               # E4
ELECTRON_RUN_AS_NODE=1 "/Applications/Visual Studio Code.app/Contents/MacOS/Code" --allow-natives-syntax smi.js                                    # E7
node --allow-natives-syntax smi.js   # E9: the unofficial node-v24.22.3-linux-x64-pointer-compression build, in a linux/amd64 Debian 13 container, --network none
# E10: Chrome 158 page (§6.3), --js-flags="--allow-natives-syntax"; page variant, line 6-7: the `where` expression (Deno and process fields) -> navigator.userAgent
```

```js
// Which integers are stored as small integers (Smi) in this build?
const tests = [
  ['2**30 - 1', 2 ** 30 - 1], ['2**30', 2 ** 30], ['2**31 - 1', 2 ** 31 - 1], ['2**31', 2 ** 31],
  ['-(2**30)', -(2 ** 30)], ['-(2**30) - 1', -(2 ** 30) - 1], ['-(2**31)', -(2 ** 31)], ['-(2**31) - 1', -(2 ** 31) - 1],
];
const where = typeof Deno !== 'undefined' ? `deno ${Deno.version.deno} v8 ${Deno.version.v8} ${Deno.build.os} ${Deno.build.arch}`
  : `node ${process.version} v8 ${process.versions.v8} ${process.platform} ${process.arch} pointer_compression=${process.config.variables.v8_enable_pointer_compression}`;
console.log(where);
for (const [label, v] of tests) console.log(label.padEnd(14), String(v).padStart(12), 'IsSmi =', %IsSmi(v));
```

Output (one block per build, headed by its id):

```text
##### E0
node v24.22.1 v8 13.6.233.17-node.58 linux arm64 pointer_compression=0
2**30 - 1        1073741823 IsSmi = true
2**30            1073741824 IsSmi = true
2**31 - 1        2147483647 IsSmi = true
2**31            2147483648 IsSmi = false
-(2**30)        -1073741824 IsSmi = true
-(2**30) - 1    -1073741825 IsSmi = true
-(2**31)        -2147483648 IsSmi = true
-(2**31) - 1    -2147483649 IsSmi = false
##### E1
node v24.22.1 v8 13.6.233.17-node.58 darwin arm64 pointer_compression=0
2**30 - 1        1073741823 IsSmi = true
2**30            1073741824 IsSmi = true
2**31 - 1        2147483647 IsSmi = true
2**31            2147483648 IsSmi = false
-(2**30)        -1073741824 IsSmi = true
-(2**30) - 1    -1073741825 IsSmi = true
-(2**31)        -2147483648 IsSmi = true
-(2**31) - 1    -2147483649 IsSmi = false
##### E2
node v24.22.1 v8 13.6.233.17-node.58 linux x64 pointer_compression=0
2**30 - 1        1073741823 IsSmi = true
2**30            1073741824 IsSmi = true
2**31 - 1        2147483647 IsSmi = true
2**31            2147483648 IsSmi = false
-(2**30)        -1073741824 IsSmi = true
-(2**30) - 1    -1073741825 IsSmi = true
-(2**31)        -2147483648 IsSmi = true
-(2**31) - 1    -2147483649 IsSmi = false
##### E3
node v22.23.4 v8 12.4.254.21-node.57 darwin arm64 pointer_compression=0
2**30 - 1        1073741823 IsSmi = true
2**30            1073741824 IsSmi = true
2**31 - 1        2147483647 IsSmi = true
2**31            2147483648 IsSmi = false
-(2**30)        -1073741824 IsSmi = true
-(2**30) - 1    -1073741825 IsSmi = true
-(2**31)        -2147483648 IsSmi = true
-(2**31) - 1    -2147483649 IsSmi = false
##### E4
node v25.7.0 v8 14.1.146.11-node.20 darwin arm64 pointer_compression=0
2**30 - 1        1073741823 IsSmi = true
2**30            1073741824 IsSmi = true
2**31 - 1        2147483647 IsSmi = true
2**31            2147483648 IsSmi = false
-(2**30)        -1073741824 IsSmi = true
-(2**30) - 1    -1073741825 IsSmi = true
-(2**31)        -2147483648 IsSmi = true
-(2**31) - 1    -2147483649 IsSmi = false
##### E7
node v24.21.0 v8 15.0.245.31-electron.0 darwin arm64 pointer_compression=1
2**30 - 1        1073741823 IsSmi = true
2**30            1073741824 IsSmi = false
2**31 - 1        2147483647 IsSmi = false
2**31            2147483648 IsSmi = false
-(2**30)        -1073741824 IsSmi = true
-(2**30) - 1    -1073741825 IsSmi = false
-(2**31)        -2147483648 IsSmi = false
-(2**31) - 1    -2147483649 IsSmi = false
##### E9
node v24.22.3 v8 13.6.233.17-node.63 linux x64 pointer_compression=1
2**30 - 1        1073741823 IsSmi = true
2**30            1073741824 IsSmi = false
2**31 - 1        2147483647 IsSmi = false
2**31            2147483648 IsSmi = false
-(2**30)        -1073741824 IsSmi = true
-(2**30) - 1    -1073741825 IsSmi = false
-(2**31)        -2147483648 IsSmi = false
-(2**31) - 1    -2147483649 IsSmi = false
##### E10
Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/158.0.0.0 Safari/537.36
2**30 - 1        1073741823 IsSmi = true
2**30            1073741824 IsSmi = false
2**31 - 1        2147483647 IsSmi = false
2**31            2147483648 IsSmi = false
-(2**30)        -1073741824 IsSmi = true
-(2**30) - 1    -1073741825 IsSmi = false
-(2**31)        -2147483648 IsSmi = false
-(2**31) - 1    -2147483649 IsSmi = false
```

</details>

**Since when.** Pointer compression shipped with V8 8.0 and Chrome 80 (December 2019 to February 2020) ✅[^v8-release-80] ✅[^v8-dev-80]; the official Node.js builds used here do not enable it ✅[^lab] ✅[^lab-matrix].

#### What pointer compression gives

- **Memory, in V8's figures.** The V8 team's post of 30 March 2020 measured the V8 heap up to 43 % smaller and Chrome's renderer process memory up to 20 % smaller on desktop, on browsing user stories that it found representative of real websites ✅[^v8-ptrcomp]. V8's design document puts the saving at "roughly 30% to 40% of total heap memory" ✅[^v8-ptrcomp-design].
- **Speed, in V8's figures.** On real websites Chrome spent less CPU time and less garbage-collection time ✅[^v8-ptrcomp]. On Octane, a peak-performance benchmark, a gap remained after the team's optimizations, which the post explains by two optimizations for 64-bit builds that had to be turned off; on low-end Arm64 devices the team saw almost no difference in either direction ✅[^v8-ptrcomp]. The design document adds that smaller tagged fields improve CPU cache use and memory bandwidth ✅[^v8-ptrcomp-design]. All of these are Chrome measurements; none is a Node.js server.
- **Bytes measured here.** The same scripts on the same emulated linux x64 machine, Node.js 24.22.1 with pointer compression off (E2) against the unofficial Node.js 24.22.3 build with it on (E9), both with V8 13.6 and the V8 sandbox off, on 2026-11-27 ✅[^lab-matrix]. The last column is Chrome 158 (V8 15.8, pointer compression on), measured in a page through `performance.memory.usedJSHeapSize` after `gc()` with page variants of the same scripts (§6.3) ✅[^lab-matrix]:

| Data (1 000 000 array elements; 100 000 entries for the keyed collections) | Off (E2) | On (E9) | Halves? | Chrome 158 (E10) |
|---|---|---|---|---|
| Small integers in an array, by index | 8.0 bytes | 4.0 | yes: one tagged slot each | 4.0 |
| Small integers, `push` onto `[]` | 10.4 | 5.2 | yes | 5.2 |
| Object `{ x, y }`, two small integers, with its array slot | 48.0 | 24.0 | yes: six tagged words | 24.0 |
| Object `{ x }` with a double field, with its array slot | 56.0 | 32.1 | partly: the slots halve, the heap number box goes from 16 to 12 bytes | 32.1 |
| Doubles in a generic (`PACKED_ELEMENTS`) array | 24.0 | 16.0 | partly: pointer 8 → 4, box 16 → 12 | 16.0 |
| Object as dictionary, string keys | 63.0 | 31.5 | yes | 31.5 |
| `Map` entry, string keys | 36.7 | 18.4 | yes | 18.4 |
| `Set` entry, string keys | 26.2 | 13.1 | yes | 13.1 |
| Doubles in a `PACKED_DOUBLE` array | 8.0 | 8.0 | no: raw 8-byte floats, not tagged values | 8.0 |
| `Float64Array` / `Int32Array` contents (in `arrayBuffers`) | 8.0 / 4.0 | 8.0 / 4.0 | no: an `ArrayBuffer` holds raw bytes | 8.0 / 4.0, read in `usedJSHeapSize`, which in Chrome 158 included `ArrayBuffer` contents in these runs (cause not examined) |
| One-byte / two-byte string characters | 1.0 / 2.0 | 1.0 / 2.0 | no: character data is not tagged | 1.0 / 2.0 |

So the saving is large for pointer-heavy data (objects, arrays of objects or small integers, `Map`, `Set`, dictionaries) and zero for raw data (double arrays, typed arrays, string characters); Chrome 158 gave the E9 figure in every row. Measured Node.js application numbers from outside the project are in §6.4.

#### What pointer compression costs

- **A little work on every access.** V8 decompresses a value on every load and compresses it on every store ✅[^v8-ptrcomp]. The design document says the current code keeps the base in a dedicated register, so decompression needs no extra memory load ✅[^v8-ptrcomp-design]. Not measured here: E9 runs only under emulation, where timings mean nothing.
- **At most 4 GB of heap per cage.** Measured here with `--max-old-space-size=8192`: `heap_size_limit` was about 4,096 MiB on E9 (4,095.75) against 8,384 MiB on E2 ✅[^lab-matrix]. Both have the sandbox off, so this cap comes from pointer compression. V8's post says that embedders needing bigger heaps cannot use pointer compression with a 4 GB maximum, and names Node.js as one that may need them ✅[^v8-ptrcomp]; Electron's post also states the 4 GB limit on the V8 heap ✅[^electron-cage]. V8's build file has an option for 8 GB heaps, `v8_enable_pointer_compression_8gb` ✅[^v8-build-gn], but a contributor wrote on a Node.js pull request in October 2025 that such heaps are not supported by V8 yet (§6.4).
- **Fewer small integers.** The small-integer payload shrinks from 32 to 31 bits, so integers from 2³⁰ (1 073 741 824) up to 2³¹ − 1 (2 147 483 647), and from −2³¹ up to −2³⁰ − 1, become heap numbers: measured on E9 with `values.mjs` and `smi.js`, against E2 ✅[^lab-matrix]. Each such value in a generic slot then costs a 12-byte heap number: `{ x: 2 ** 31 }` took 12 bytes more than `{ x: i }` on E9 (`fieldmem-var.mjs`) ✅[^lab-matrix].
- **Native add-ons.** Node.js's build option says it "breaks ABI compatibility" ✅[^node-configure]: an add-on compiled against V8's own C++ headers (the application binary interface, ABI) for a build without pointer compression is not compatible with a build that has it (this doc's reading of the help text). That add-ons built on Node-API (Node.js's stable C interface for add-ons) are unaffected, and that add-ons built on NAN (Native Abstractions for Node.js) do not work, is stated only by one vendor's post ✅[^platformatic]; no Node.js page read for this doc says it.
- **Not the same thing as the V8 sandbox.** The pages read do not say that the sandbox requires pointer compression. V8's build file makes the sandbox's default depend on it: the sandbox is on by default only when shared-cage pointer compression and the external code space are on (and the target is not Fuchsia) ✅[^v8-build-gn], and the design document places the 4 GB cage at the start of the sandbox's 1 TB (terabyte) reservation ✅[^v8-ptrcomp-design]. Node.js's `configure.py` has a separate option, `--experimental-pointer-compression-shared-cage`, whose help text says it enables the V8 sandbox and requires `--experimental-enable-pointer-compression` ✅[^node-configure]. E9 has pointer compression on and the sandbox off, which is how §6.3 separates the two.

<details>
<summary>Lab: build facts and heap limit on E9 and E2 (2026-11-27)</summary>

```sh
node --max-old-space-size=8192 -p "const c=process.config.variables; JSON.stringify({v:process.version,v8:process.versions.v8,arch:process.arch,pc:c.v8_enable_pointer_compression,smi31:c.v8_enable_31bit_smis_on_64bit_arch,sandbox:c.v8_enable_sandbox,objprint:c.v8_enable_object_print,limitMiB:require('v8').getHeapStatistics().heap_size_limit/1048576})"
# E9: the unofficial build in a linux/amd64 Debian 13 container; E2: image node:24.22.1-alpine-amd64; both --network none
```

Output:

```text
# E9
{"v":"v24.22.3","v8":"13.6.233.17-node.63","arch":"x64","pc":1,"smi31":1,"sandbox":0,"objprint":1,"limitMiB":4095.75}
# E2
{"v":"v24.22.1","v8":"13.6.233.17-node.58","arch":"x64","pc":0,"smi31":0,"sandbox":0,"objprint":1,"limitMiB":8384}
```

</details>

#### Is it good or bad?

This part is this doc's synthesis of the facts above, not a source's verdict. Neither: pointer compression trades address space and a little computation for memory.

- **A clear win** when each cage's heap stays well under 4 GB, the data is pointer-heavy (objects, arrays of objects, `Map`s; the table above: about half the bytes), and memory is the scarce resource (the cases measured by others: Chrome's renderer in V8's figures, and one vendor's Node.js application in §6.4).
- **A loss, or not possible,** when one process (one cage) needs more than 4 GB of V8 heap (the 4,096 MiB cap above), or when the program loads native add-ons compiled against V8's binary interface for a build without it (the ABI break above).
- **Little gain** when the memory is mostly raw data: double arrays, typed arrays and long strings do not shrink.

#### Why Chrome has it on

V8's post gives two reasons: V8 in Chrome already had a 2 GB or 4 GB limit on the V8 heap, depending on the device, so the 4 GB cap cost Chrome nothing, and the saving was large (up to 43 % of the V8 heap) ✅[^v8-ptrcomp]. Chrome turned it on by default in Chrome 80 ✅[^v8-dev-80], and Chrome 158 still has it on: measured in a page on 2026-11-27, 31-bit small integers, a 4,192 MiB `jsHeapSizeLimit` and the halved byte counts of the table above ✅[^lab-matrix]. Two reasons often given, many tabs in one browser and one vendor shipping one binary, are not stated on the pages read; if they matter, that is this doc's inference, not a sourced reason.

#### Why the official Node.js builds have it off (as of 2026-11-27)

- **What the rank-1 and rank-4 pages say.** The build option's own help text names two costs: it "limits max heap to 4GB and breaks ABI compatibility" ✅[^node-configure]. V8's post names Node.js as an embedder that "may require bigger heaps" ✅[^v8-ptrcomp]. The project's threads say that until 2025 every thread of a Node.js process shared one cage (§6.4); Node.js 25.1.0 (release notes of 28 October 2025) lists "initial enablement of IsolateGroups" (pull request 60254) ✅[^node-v2510]. An isolate is one independent V8 heap and JavaScript world (a Node.js worker thread has its own); an isolate group is a set of isolates, and V8's design document says each isolate group has its own 4 GB cage ✅[^v8-ptrcomp-design]. This doc's inference: a build with pointer compression can then give each worker thread its own 4 GB (the plan in issue 55735, §6.4).
- **The status as of 2026-11-27.** Pointer compression is still a compile-time option, off unless `--experimental-enable-pointer-compression` is passed to `configure.py` ✅[^node-configure]; its help text and the option's `[Experimental]` label were unchanged on the `main` branch on 2026-11-27 ✅[^node-configure]; every official build run here reports `v8_enable_pointer_compression: 0` ✅[^lab-matrix]; no release note read announces it on by default ✅[^node-changelogs] ✅[^node-v2510].
- **The project's own discussion** (servers with heaps far above 4 GB, the shared cage, the add-on break, some compute overhead, the cost of building, testing and supporting a second set of binaries, and the pull request author's doubt about turning it on by default) is in GitHub issues and pull requests, which this knowledge base ranks 6; it is summarized with dates in §6.4.

#### What this means when you write JavaScript

- Your code cannot turn pointer compression on or off: it is a build option, so it is fixed when the binary is built (this doc's inference from the option being in `configure.py`). In Node.js, check it with `process.config.variables.v8_enable_pointer_compression` (`1` on, `0` off).
- In Chrome and Electron assume it is on: integers at or above 2³⁰ are not small integers there, and one cage's heap tops out near 4 GB ✅[^v8-dev-80] ✅[^v8-ptrcomp] ✅[^electron-cage] ✅[^lab-matrix] (measured in Electron 43.7.7 and in Chrome 158.0.8127.89, V8 15.8: `%IsSmi(2 ** 30)` is `false`; Chrome's page reports a 4,192 MiB `jsHeapSizeLimit`).
- A memory estimate measured on an official Node.js build is up to about twice what the same pointer-heavy data takes in a build with pointer compression, such as Chrome; for double arrays, typed arrays and string characters it is the same (the table above: measured in Chrome 158 for every row ✅[^lab-matrix]; in these Chrome 158 runs a page's `usedJSHeapSize` also included `ArrayBuffer` contents, which Node.js's `heapUsed` does not, so compare typed arrays with care; the probe is in the memory deep dive, §3.8).

### 3.2 Number fields: representations, boxing and generalization

**What the engine does.** For each property, the map records a field representation, which starts narrow and only widens: None → Smi → Double → HeapObject → Tagged ✅[^v8-fields]. When a store needs a wider representation, V8 generalizes the field for the whole transition tree, so every existing and future object of that shape ends up on the wider map ✅[^v8-fields]. The old map is marked deprecated, and an object still on it moves to the new map the next time it is read or written ✅[^v8-react]. In this build, a Double field holds a pointer to its own mutable heap number box, not 8 raw bytes in the object ✅[^lab]. The V8 page describes that box under pointer compression ✅[^v8-fields], and the 2020 post says double-field unboxing was turned off when pointer compression arrived ✅[^v8-ptrcomp]; that the box is also used in this build, which has pointer compression off, rests on the lab alone.

The lab shows all three steps. `b.x = 1.5` widens `x` from `s` (Smi) to `d` (Double) and creates one more map; `c.x = 'text'` widens it to `t` (Tagged). The object `c` was created after step 2 as `{ x: 1 }`, yet its trace already starts from `d`, because the generalization applied to the shape, not to one object ✅[^lab].

<details>
<summary>Lab: <code>gen.mjs</code></summary>

```sh
docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node --trace-generalization gen.mjs 2>&1 | grep -E '^step|^done|\]x:' | sed -E 's/0x[0-9a-f]{6,}/0x…/g'
```

```js
const a = { x: 1 };
console.log('step 1: a = {x: 1}');
const b = { x: 1 };
console.log('step 2: b.x = 1.5');
b.x = 1.5;
console.log('step 3: c.x = "text"');
const c = { x: 1 };
c.x = 'text';
console.log('done');
```

Output:

```text
step 1: a = {x: 1}
step 2: b.x = 1.5
[generalizing]x:s{Any;const}->d{Any;mutable} (+1 maps) [~+85 at file:///work/gen.mjs:5]
step 3: c.x = "text"
[generalizing]x:d{Any;mutable}->t{Any;mutable} (uninitialized field) [~+113 at file:///work/gen.mjs:8]
[generalizing]x:d{Any;mutable}->t{Any;mutable} (field type generalization) [~+113 at file:///work/gen.mjs:8]
done
```

</details>

`%DebugPrint` shows the double stored in-object as a pointer to a `HeapNumber`, and that `a`, left on the deprecated map, joins `b`'s map as soon as it is read ✅[^lab]:

<details>
<summary>Lab: <code>fields.mjs</code></summary>

```sh
docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node --allow-natives-syntax fields.mjs | grep -E '^--|after|#x:' | sed -E 's/0x[0-9a-f]{6,}/0x…/g'
```

```js
// Field representation of property x, read from %DebugPrint's descriptor line.
function show(label, o) { console.log('--', label); %DebugPrint(o); }
const a = { x: 1 };
show('a = {x: 1}', a);
const b = { x: 1 };
b.x = 1.5;
console.log('after b.x = 1.5, same map as a:', %HaveSameMap(a, b));
show('b after b.x = 1.5', b);
a.x;                         // touching a migrates it off its deprecated map
console.log('after reading a.x, same map as b:', %HaveSameMap(a, b));
const c = { x: 1 };
c.x = 'text';
show('c after c.x = "text"', c);
const d = { x: null };
show('d = {x: null}', d);
```

Output:

```text
-- a = {x: 1}
    0x…: [String] in ReadOnlySpace: #x: 1 (const data field 0, attrs: [WEC]) @ Any, location: in-object
after b.x = 1.5, same map as a: false
-- b after b.x = 1.5
    0x…: [String] in ReadOnlySpace: #x: 0x… <HeapNumber 1.5> (data field 0, attrs: [WEC]) @ Any, location: in-object
after reading a.x, same map as b: true
-- c after c.x = "text"
    0x…: [String] in ReadOnlySpace: #x: 0x… <String[4]: #text> (data field 0, attrs: [WEC]) @ Any, location: in-object
-- d = {x: null}
    0x…: [String] in ReadOnlySpace: #x: 0x… <null> (data field 0, attrs: [WEC]) @ Any, location: in-object
```

</details>

**What it costs.** Each double field adds a 16-byte box per object in this build: `{ x }` costs 32 bytes with an integer and 48 bytes with a double, and two double fields add 32 bytes ✅[^lab]. A review re-run (two runs, 100 000 objects each, list slot subtracted) found the same 16 bytes per double at other sizes: 5 fields 64 bytes with integers and 144 with doubles (80 more), 10 fields 104 and 264 (160 more); a class instance with two fields (after slack tracking) 40 bytes with integers and 72 with doubles; `{ x: 2 ** 31 + i }`, an integer-valued number outside the Smi range, also 48 ✅[^lab]. The same sizes were seen on Node.js 22.23.4, 24.22.1 (macOS, linux x64) and 25.7.0. With pointer compression on (Electron 43, V8 15.0) every size was smaller and the box was 12 bytes: `{ x }` 16 bytes with an integer and 28 with a double, 5 fields 32 and 92, 10 fields 52 and 172, the two-field class 20 and 44, `{ x: 2 ** 31 + i }` 28 (the scripts subtract an 8-byte list slot, which is 4 bytes there; the 4 is added back here) ✅[^lab-matrix]. That fits 4-byte slots plus a 12-byte heap number (4-byte map word, 8-byte value). The unofficial Node.js 24.22.3 build with pointer compression on and the sandbox off (V8 13.6, linux x64, emulated) gave the same sizes as Electron to within 0.2 byte, and the official Node.js 24.22.1 build on the same machine gave the sizes above, so on V8 13.6 with the sandbox off pointer compression is the cause of the smaller sizes ✅[^lab-matrix]. A Chrome 158 page (V8 15.8, `performance.memory.usedJSHeapSize` after `gc()`) gave Electron's sizes too: `{ x }` 16 and 28, 5 fields 32 and 92, 10 fields 52 and 172.1, the class 20 and 44 ✅[^lab-matrix].

<details>
<summary>Lab: <code>fieldmem.mjs</code> (memory: may vary by about 0.1 byte or 0.5 MB per run)</summary>

```sh
docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node --expose-gc fieldmem.mjs
```

```js
// Bytes per object for { x } holding a small integer against a double. Run with --expose-gc.
const N = 100_000; const keep = [];
function measure(label, make) {
  globalThis.gc(); const before = process.memoryUsage().heapUsed;
  const list = new Array(N).fill(null); for (let i = 0; i < N; i++) list[i] = make(i);
  globalThis.gc(); const after = process.memoryUsage().heapUsed; keep.push(list);
  console.log(label.padEnd(40), ((after - before) / N).toFixed(1), 'bytes per object (8 of them are the list slot)');
}
measure('warm-up (not counted)', (i) => ({ w: i }));
measure('{ x: i } (small integer field)', (i) => ({ x: i }));
measure('{ x: i + 0.5 } (double field)', (i) => ({ x: i + 0.5 }));
measure('{ x: i, y: i } (two small integers)', (i) => ({ x: i, y: i }));
measure('{ x: i + 0.5, y: i + 0.5 } (two doubles)', (i) => ({ x: i + 0.5, y: i + 0.5 }));
```

Output:

```text
warm-up (not counted)                    40.1 bytes per object (8 of them are the list slot)
{ x: i } (small integer field)           40.1 bytes per object (8 of them are the list slot)
{ x: i + 0.5 } (double field)            56.1 bytes per object (8 of them are the list slot)
{ x: i, y: i } (two small integers)      48.0 bytes per object (8 of them are the list slot)
{ x: i + 0.5, y: i + 0.5 } (two doubles) 80.1 bytes per object (8 of them are the list slot)
```

</details>

<details>
<summary>Lab: <code>fieldmem-var.mjs</code> (memory: review variation with more fields and classes)</summary>

```sh
docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node --expose-gc fieldmem-var.mjs
```

```js
const keep = [];
function measure(label, make, N = 100_000) {
  globalThis.gc(); globalThis.gc(); const before = process.memoryUsage().heapUsed;
  const list = new Array(N).fill(null); for (let i = 0; i < N; i++) list[i] = make(i);
  globalThis.gc(); globalThis.gc(); const after = process.memoryUsage().heapUsed; keep.push(list);
  console.log(label.padEnd(44), ((after - before) / N - 8).toFixed(1), 'bytes per object (list slot subtracted)');
}
measure('warm-up', (i) => ({ w: i }));
measure('{x:i}', (i) => ({ x: i }));
measure('{x:i+.5}', (i) => ({ x: i + 0.5 }));
measure('{a..e: 5 ints}', (i) => ({ a: i, b: i, c: i, d: i, e: i }));
measure('{a..e: 5 doubles}', (i) => ({ a: i+.5, b: i+.5, c: i+.5, d: i+.5, e: i+.5 }));
measure('{a..j: 10 ints}', (i) => ({ a: i, b: i, c: i, d: i, e: i, f:i,g:i,h:i,i:i,j:i }));
measure('{a..j: 10 doubles}', (i) => ({ a: i+.5, b: i+.5, c: i+.5, d: i+.5, e: i+.5, f:i+.5,g:i+.5,h:i+.5,i:i+.5,j:i+.5 }));
class P { constructor(i){ this.x = i; this.y = i; } }
class Q { constructor(i){ this.x = i+.5; this.y = i+.5; } }
for (let k=0;k<30;k++){ new P(k); new Q(k);} 
measure('class P, 2 ints (after slack tracking)', (i) => new P(i));
measure('class Q, 2 doubles (after slack tracking)', (i) => new Q(i));
measure('{x: 2**31} (above Smi, integer-valued double)', (i) => ({ x: 2**31 + i }));
```

Output:

```text
warm-up                                      32.1 bytes per object (list slot subtracted)
{x:i}                                        32.1 bytes per object (list slot subtracted)
{x:i+.5}                                     48.1 bytes per object (list slot subtracted)
{a..e: 5 ints}                               64.1 bytes per object (list slot subtracted)
{a..e: 5 doubles}                            144.1 bytes per object (list slot subtracted)
{a..j: 10 ints}                              104.2 bytes per object (list slot subtracted)
{a..j: 10 doubles}                           264.2 bytes per object (list slot subtracted)
class P, 2 ints (after slack tracking)       40.0 bytes per object (list slot subtracted)
class Q, 2 doubles (after slack tracking)    72.0 bytes per object (list slot subtracted)
{x: 2**31} (above Smi, integer-valued double) 48.1 bytes per object (list slot subtracted)
```

</details>

**Code that keeps it working.** Give each field a value of its final kind in the constructor: `0.0` is still a Smi (`3.0` tests as a Smi in §3.1), so a field that will hold fractions stays Smi until the first fraction arrives and then generalizes once, which is cheap; the 2019 V8 post's fix for React started its time fields with a floating-point value (`Number.NaN`) so they begin as Double ✅[^v8-react]. **Code that defeats it.** A field that holds numbers in some objects and strings or `null` in others ends up Tagged for all of them; the V8 post of 28 August 2019 names `null` as an initial value that disables representation tracking ✅[^v8-react]. What the optimizing compiler does with these representations is in [v8-compiler-pipeline-deep-dive.md](v8-compiler-pipeline-deep-dive.md).

### 3.3 Where properties live: in-object, out-of-object, slack tracking

**What the engine does.** The number of in-object slots is fixed when the object is allocated ✅[^v8-fastprops]. In this build:

- `{}` gets 4 in-object slots ✅[^lab], matching the source constant `kInitialGlobalObjectUnusedPropertiesCount = 4`, whose comment says it applies only to the initial map of `Object` ✅[^v8-jsobjects].
- An object literal gets exactly as many slots as it has keys: 6 keys → 6 slots ✅[^lab].
- Properties beyond the in-object slots go to a property array that grows 3 slots at a time ✅[^v8-jsobjects]: after adding 6 keys to `{}`, 4 are in-object and 2 sit in a `PropertyArray[3]` with one slot free ✅[^lab].
- A constructor's first objects get the slots it used plus 8 more; after 7 constructions V8 shrinks the instance size to what was really used ✅[^v8-slack]. The lab shows `new Point(x, y)` with 10 in-object slots (2 used, 8 spare, counter at 6) on the first instance, and 2 slots on the 12th ✅[^lab].

<details>
<summary>Lab: <code>inobject.mjs</code></summary>

```sh
docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node --allow-natives-syntax inobject.mjs | grep -E '^##|inobject properties|unused property fields|construction counter|^ - properties:' | sed -E 's/0x[0-9a-f]{6,}/0x…/g'
```

```js
// How many properties live inside the object, and where does the next one go?
const where = (label, o) => { console.log('##', label); %DebugPrint(o); };
const e = {};
where('{} (empty literal)', e);
for (let i = 0; i < 6; i++) e['p' + i] = i;
where('{} after adding p0..p5', e);
where('literal with 6 properties', { p0: 0, p1: 1, p2: 2, p3: 3, p4: 4, p5: 5 });
function Point(x, y) { this.x = x; this.y = y; }
where('new Point() #1 (slack tracking running)', new Point(1, 2));
for (let i = 0; i < 10; i++) new Point(i, i);
where('new Point() #12 (slack tracking done)', new Point(3, 4));
class Wide { constructor() { for (let i = 0; i < 30; i++) this['f' + i] = i; } }
for (let i = 0; i < 10; i++) new Wide();
where('class with 30 fields set in a loop, after 11 instances', new Wide());
```

Output:

```text
## {} (empty literal)
 - properties: 0x… <FixedArray[0]>
 - inobject properties: 4
 - unused property fields: 4
 - construction counter: 0
## {} after adding p0..p5
 - properties: 0x… <PropertyArray[3]>
 - inobject properties: 4
 - unused property fields: 1
 - construction counter: 0
## literal with 6 properties
 - properties: 0x… <FixedArray[0]>
 - inobject properties: 6
 - unused property fields: 0
 - construction counter: 0
## new Point() #1 (slack tracking running)
 - properties: 0x… <FixedArray[0]>
 - inobject properties: 10
 - unused property fields: 8
 - construction counter: 6
## new Point() #12 (slack tracking done)
 - properties: 0x… <FixedArray[0]>
 - inobject properties: 2
 - unused property fields: 0
 - construction counter: 0
## class with 30 fields set in a loop, after 11 instances
 - properties: 0x… <NameDictionary[198]>
 - inobject properties: 0
 - unused property fields: 0
 - construction counter: 0
```

</details>

The last case in that output is a trap: a constructor that writes 30 fields with computed keys (`this['f' + i] = i`) produces instances in dictionary mode with no in-object slots ✅[^lab]. §3.4 explains the threshold.

**Code that keeps it working.** Create all properties in the constructor or in one literal, with plain names. **Code that defeats it.** Adding properties long after construction (they go out-of-object), or computed-key loops in constructors.

### 3.4 Fast and dictionary mode: what switches an object, and what brings it back

Dictionary mode means the object carries its own hash table of properties ✅[^v8-fastprops]. Reads still work, but they search a table instead of loading a slot at a known offset: in the lab, a million reads of `o.a` took about 0.6 ms on a fast object and about 4 ms on an object made slow by `delete` ✅[^lab] (measured here); Node.js 22.23.4 and 25.7.0 gave the same picture (0.5 to 0.8 ms against 4.2 to 5.3 ms), but Electron 43 (V8 15.0, pointer compression on) read the dictionary-mode object in 1.41 ms in five runs, about 2.5 times the fast object ✅[^lab-matrix]. Deno 2.9.8 (V8 15.0, no sandbox, no pointer compression) gave the same picture as Electron 43 (1.33 to 1.73 ms against 0.54 to 0.58, six runs), and Electron 38.8.6 (V8 14.0) the baseline one (4.72 to 4.88 ms against 0.53 to 0.55, six runs), so the smaller gap comes with the V8 version: seen on V8 15.0 in two embedders and not on V8 14.0 or 14.1 ✅[^lab-matrix]. In Chrome 158 (V8 15.8), measured here, with `--disable-renderer-backgrounding` (the main figure, six runs, Turbofan speed) the dictionary read took 1.3 to 1.4 ms against 0.3 to 0.6 ms, about 2.2 to 4.7 times; in default headless mode 4 of 6 runs gave the same figures, and in the other 2 the code ran in efficiency mode (Maglev) and both cases took 2.4 to 2.7 ms, a ratio of about 1 (§6.3) ✅[^lab-matrix].

<details>
<summary>Lab: <code>dicttime.mjs</code> (timing: the numbers vary per run)</summary>

```sh
docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node --allow-natives-syntax dicttime.mjs
```

```js
// 1,000,000 reads of o.a from a fast object against a dictionary-mode one (made slow by delete).
const median = (xs) => xs.sort((a, b) => a - b)[xs.length >> 1];
const fastObj = { a: 1, b: 2, c: 3 };
const slowObj = { a: 1, b: 2, c: 3, d: 4 }; delete slowObj.d;
console.log('fast object fast:', %HasFastProperties(fastObj), '| deleted-from object fast:', %HasFastProperties(slowObj));
for (const [name, o] of [['fast object', fastObj], ['dictionary-mode', slowObj]]) {
  const read = new Function('o', 'let s = 0; for (let i = 0; i < 1000000; i++) s += o.a; return s;');
  for (let i = 0; i < 30; i++) read(o);
  const runs = []; for (let r = 0; r < 9; r++) { const t = process.hrtime.bigint(); read(o); runs.push(Number(process.hrtime.bigint() - t)); }
  console.log(`${name.padEnd(16)} ${(median(runs) / 1e6).toFixed(2)} ms per 1,000,000 reads (median of 9 after 30 warm-up calls)`);
}
```

Output:

```text
fast object fast: true | deleted-from object fast: false
fast object      0.52 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
dictionary-mode  3.94 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
```

</details>

**`delete`.** In this build every `delete` of an existing property switched the object to dictionary mode, including deleting the last property added, inside or outside a function, in a literal or in an object built by assignments; assigning `undefined` kept it fast ✅[^lab]. A review re-run on 2026-11-26 repeated the last-property case on objects built by named stores with 1, 2, 10, 50, 100, 500 and 1000 properties, on the first property of 10- and 100-property objects, on a class instance (also after slack tracking) and inside a function after `%OptimizeFunctionOnNextCall`: all went to dictionary mode (`delete-var.mjs` below). The one exception found: deleting a property the object does not have (`delete o.zzz`) left it fast ✅[^lab]. The three `delete` scripts gave the same output on V8 12.4 (Node.js 22.23.4), 14.1 and 15.0 ✅[^lab-matrix].

<details>
<summary>Lab: <code>delete.mjs</code></summary>

```sh
docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node --allow-natives-syntax delete.mjs
```

```js
const log = (label, o) => console.log(label.padEnd(50), 'fast:', %HasFastProperties(o));
const o1 = { a: 1, b: 2, c: 3 }; delete o1.c;       log('literal {a,b,c}: delete c (last)', o1);
const o2 = {}; o2.a = 1; o2.b = 2; o2.c = 3; delete o2.c; log('built by o.a=, o.b=, o.c=: delete c (last)', o2);
const o3 = {}; o3.a = 1; o3.b = 2; o3.c = 3; delete o3.b; log('built by assignments: delete b (middle)', o3);
const o4 = { a: 1, b: 2, c: 3 }; o4.b = undefined;   log('literal: o.b = undefined instead of delete', o4);
// Does a slow object come back to fast mode?
const s = { a: 1, b: 2, c: 3 }; delete s.b;
s.d = 4;                                    log('slow object, then add d', s);
for (let i = 0; i < 1000; i++) s.a;         log('slow object, after 1000 reads', s);
const child = Object.create(s);             log('slow object, after Object.create(it)', s);
for (let i = 0; i < 3; i++) child.a;        log('... after 3 reads of child.a through it', s);
function F() {} ; const p = { a: 1, b: 2, c: 3 }; delete p.b;
F.prototype = p; const f = new F(); f.a;    log('slow object as F.prototype, after new F() and f.a', p);
const copy = { ...o3 };                     log('{ ...slowObject } (a copy)', copy);
const asg = Object.assign({}, o3);          log('Object.assign({}, slowObject)', asg);
```

Output:

```text
literal {a,b,c}: delete c (last)                   fast: false
built by o.a=, o.b=, o.c=: delete c (last)         fast: false
built by assignments: delete b (middle)            fast: false
literal: o.b = undefined instead of delete         fast: true
slow object, then add d                            fast: false
slow object, after 1000 reads                      fast: false
slow object, after Object.create(it)               fast: false
... after 3 reads of child.a through it            fast: true
slow object as F.prototype, after new F() and f.a  fast: true
{ ...slowObject } (a copy)                         fast: true
Object.assign({}, slowObject)                      fast: true
```

</details>

<details>
<summary>Lab: <code>dellast.mjs</code></summary>

```sh
docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node --allow-natives-syntax dellast.mjs
```

```js
const log = (label, o) => console.log(label.padEnd(52), 'fast:', %HasFastProperties(o));
function make() { const o = {}; o.a = 1; o.b = 2; o.c = 3; return o; }
const x = make(); delete x.c; log('in a function: delete last (c)', x);
const y = make(); y.c = 30; delete y.c; log('c written twice, then delete c', y);
const z = { a: 1 }; delete z.a; log('{a:1}: delete a (the only one)', z);
const w = make(); log('control: no delete', w);
```

Output:

```text
in a function: delete last (c)                       fast: false
c written twice, then delete c                       fast: false
{a:1}: delete a (the only one)                       fast: false
control: no delete                                   fast: true
```

</details>

<details>
<summary>Lab: <code>delete-var.mjs</code> (review variation of the last-property delete)</summary>

```sh
docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node --allow-natives-syntax delete-var.mjs
```

```js
const fast = (l, o) => console.log(l.padEnd(58), 'fast:', %HasFastProperties(o));
// named-store objects via generated code, so computed-key dictionary switch does not interfere
const named = (n) => new Function(`const o = {}; ${Array.from({length:n},(_, i)=>`o.p${i}=${i};`).join('')} return o;`);
for (const n of [1, 2, 10, 50, 100, 500, 1000]) { const o = named(n)(); fast(`named stores x${n}: control`, o); delete o['p' + (n-1)]; fast(`named stores x${n}: delete last`, o); }
for (const n of [10, 100]) { const o = named(n)(); delete o.p0; fast(`named x${n}: delete first`, o); }
{ const o = { a: 1, b: 2 }; delete o.zzz; fast('delete a property that does not exist', o); }
{ const o = { a: 1, b: 2 }; delete o.b; delete o.a; fast('delete both properties', o); }
class P { constructor() { this.x = 1; this.y = 2; } }
{ const o = new P(); delete o.y; fast('class instance: delete last (y)', o); }
{ const o = new P(); for (let i=0;i<20;i++) new P(); delete o.y; fast('class instance after slack tracking: delete y', o); }
{ const o = { a: 1, b: 2 }; o.c = 3; o.b = undefined; fast('assign undefined', o); }
// optimized code
function del(o) { delete o.c; return o; }
const w = { a: 1, b: 2, c: 3 };
%PrepareFunctionForOptimization(del); del({ a: 1, b: 2, c: 3 }); del({ a: 1, b: 2, c: 3 });
%OptimizeFunctionOnNextCall(del); fast('delete in Turbofan-optimized function', del(w));
```

Output:

```text
named stores x1: control                                   fast: true
named stores x1: delete last                               fast: false
named stores x2: control                                   fast: true
named stores x2: delete last                               fast: false
named stores x10: control                                  fast: true
named stores x10: delete last                              fast: false
named stores x50: control                                  fast: true
named stores x50: delete last                              fast: false
named stores x100: control                                 fast: true
named stores x100: delete last                             fast: false
named stores x500: control                                 fast: true
named stores x500: delete last                             fast: false
named stores x1000: control                                fast: true
named stores x1000: delete last                            fast: false
named x10: delete first                                    fast: false
named x100: delete first                                   fast: false
delete a property that does not exist                      fast: true
delete both properties                                     fast: false
class instance: delete last (y)                            fast: false
class instance after slack tracking: delete y              fast: false
assign undefined                                           fast: true
delete in Turbofan-optimized function                      fast: false
```

</details>

Older V8 had a fast path that undid the last map transition when the last-added property was deleted ✅[^v8-delete-old]. The function that did it, `DeleteObjectPropertyFast` in `src/runtime/runtime-object.cc`, is present at tags 11.3.244.8, 11.8.172.17 and 11.9.169.7 and absent at tags 12.0.267.17, 12.1.285.27, 12.2.281.27 and 13.6.233.17 ✅[^v8-delete-new]; so it was removed somewhere between 11.9 and 12.0. The doc read those files at those tags only (other tags in between were not opened), and the commit that removed it was not found.

**Coming back to fast mode.** The same `delete.mjs` run shows three ways back ✅[^lab]:

- Use the slow object as a prototype and read a property through it (`Object.create(s)` then `child.a`, or `F.prototype = p` then `new F().a`): V8 makes prototypes fast.
- Copy it: `{ ...slow }` and `Object.assign({}, slow)` both produce fast objects.
- Reading it a thousand times, or adding more properties, does not bring it back.

**Too many properties.** The limit depends on how the properties are added, and for computed keys on how big the object already was ✅[^lab]:

| How properties are added | First property count in dictionary mode |
|---|---|
| Computed keys, `o['k' + i] = i`, starting from `{}` | 20 (the 16th property outside the object) |
| Computed keys on a literal with 1, 3 or 10 keys | the 16th key added (26 properties in all for the 10-key literal) |
| Computed keys on a literal with 30 keys / 100 keys / 300 keys | the 34th / 103rd / 1st key added |
| Computed keys on an instance of an empty class | 26 |
| Computed keys with `--fast-properties-soft-limit=40` (default 12) | 47 |
| Named stores, one statement per key (`o.k0 = 0; o.k1 = 1; …`), also on top of a 10-key literal (1021 in all) | 1021 (also on V8 12.4, 14.1 and 15.0 ✅[^lab-matrix]) |
| Object literal with N keys | 1021 (V8 12.4 and 13.6); 128 on V8 14.1 (Node.js 25.7.0), 15.0 (Electron 43) and 15.8 (Chrome 158) ✅[^lab-matrix] |
| `Object.fromEntries` | 1021 |
| `JSON.parse` (Smi, string or object values; 127 keys stayed fast) | 128 |

<details>
<summary>Lab: <code>limits.mjs</code></summary>

```sh
docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node --allow-natives-syntax limits.mjs
```

```js
// After how many added properties does an object switch to dictionary mode?
function firstSlow(add) { const o = {}; for (let n = 1; n <= 2000; n++) { add(o, n - 1); if (!%HasFastProperties(o)) return n; } return 'never (2000)'; }
console.log('computed key, o["k" + i] = i       :', firstSlow((o, i) => { o['k' + i] = i; }));
// Named stores: generate one statement per property, o.k0 = 0; o.k1 = 1; ...
const named = (count) => new Function('o', Array.from({ length: count }, (_, i) => `o.k${i} = ${i};`).join('\n'));
for (const count of [20, 128, 129, 200, 1020, 1021]) { const o = {}; named(count)(o); console.log(`named stores o.kN = N, ${String(count).padStart(4)} props :`, 'fast:', %HasFastProperties(o)); }
// Object literal with many keys
for (const count of [200, 1020, 1021]) { const o = new Function(`return {${Array.from({ length: count }, (_, i) => `k${i}: ${i}`).join(',')}}`)(); console.log(`object literal, ${count} keys              :`, 'fast:', %HasFastProperties(o)); }
// Integer-like keys go to elements, not properties
const ints = {}; for (let i = 0; i < 2000; i++) ints[i] = i; console.log('2000 integer keys o[i] = i           :', 'fast properties:', %HasFastProperties(ints), '| dictionary elements:', %HasDictionaryElements(ints));
const map = {}; for (let i = 0; i < 2000; i++) map['id' + i] = i; console.log('2000 keys "id" + i                   :', 'fast properties:', %HasFastProperties(map));
// JSON.parse
const j = JSON.parse(JSON.stringify(Object.fromEntries(Array.from({ length: 200 }, (_, i) => ['k' + i, i])))); console.log('JSON.parse of a 200-key object       :', 'fast:', %HasFastProperties(j));
const f = Object.fromEntries(Array.from({ length: 200 }, (_, i) => ['k' + i, i])); console.log('Object.fromEntries, 200 keys         :', 'fast:', %HasFastProperties(f));
```

Output:

```text
computed key, o["k" + i] = i       : 20
named stores o.kN = N,   20 props : fast: true
named stores o.kN = N,  128 props : fast: true
named stores o.kN = N,  129 props : fast: true
named stores o.kN = N,  200 props : fast: true
named stores o.kN = N, 1020 props : fast: true
named stores o.kN = N, 1021 props : fast: false
object literal, 200 keys              : fast: true
object literal, 1020 keys              : fast: true
object literal, 1021 keys              : fast: false
2000 integer keys o[i] = i           : fast properties: true | dictionary elements: false
2000 keys "id" + i                   : fast properties: false
JSON.parse of a 200-key object       : fast: false
Object.fromEntries, 200 keys         : fast: true
```

</details>

<details>
<summary>Lab: <code>limits2.mjs</code></summary>

```sh
docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node --allow-natives-syntax limits2.mjs
```

```js
const entries = (n) => Array.from({ length: n }, (_, i) => ['k' + i, i]);
function first(build) { for (let n = 1; n <= 3000; n++) if (!%HasFastProperties(build(n))) return n; return 'never (3000)'; }
console.log('JSON.parse, first slow key count        :', first((n) => JSON.parse(JSON.stringify(Object.fromEntries(entries(n))))));
console.log('Object.fromEntries, first slow key count:', first((n) => Object.fromEntries(entries(n))));
console.log('Object.assign({}, fast 200-key object)  :', 'fast:', %HasFastProperties(Object.assign({}, Object.fromEntries(entries(200)))));
const pre = { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0, g: 0, h: 0, i: 0, j: 0 };
let n = 0; while (%HasFastProperties(pre)) { pre['k' + n] = n; n++; }
console.log('10-property literal, computed keys added before slow:', n);
```

Output:

```text
JSON.parse, first slow key count        : 128
Object.fromEntries, first slow key count: 1021
Object.assign({}, fast 200-key object)  : fast: true
10-property literal, computed keys added before slow: 16
```

</details>

<details>
<summary>Lab: <code>soft.mjs</code></summary>

```sh
docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node --allow-natives-syntax soft.mjs
```

```js
const o = {}; let n = 0; while (%HasFastProperties(o) && n < 5000) { o['k' + n] = n; n++; }
console.log('computed keys added until dictionary mode:', n);
```

Output:

```text
computed keys added until dictionary mode: 20
```

</details>

<details>
<summary>Lab: <code>soft.mjs</code></summary>

```sh
docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node --allow-natives-syntax --fast-properties-soft-limit=40 soft.mjs
```

```js
const o = {}; let n = 0; while (%HasFastProperties(o) && n < 5000) { o['k' + n] = n; n++; }
console.log('computed keys added until dictionary mode:', n);
```

Output:

```text
computed keys added until dictionary mode: 47
```

</details>

<details>
<summary>Lab: <code>limits-var.mjs</code> (review variation: other starting objects and JSON.parse shapes; the output is for the default flags)</summary>

```sh
docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node --allow-natives-syntax limits-var.mjs
```

```js
function firstSlowFrom(make, add, max=3000) { const o = make(); for (let n = 1; n <= max; n++) { add(o, n-1); if (!%HasFastProperties(o)) return n; } return 'never'; }
const lit = (k) => () => { const o = {}; for (let i = 0; i < k; i++) o['L' + i] = i; return o; }; // literal-like via fresh? (computed)
const litSrc = (k) => new Function(`return {${Array.from({length:k},(_, i)=>`L${i}:${i}`).join(',')}}`);
for (const k of [0, 1, 3, 10, 30, 100, 300]) console.log(`literal with ${k} keys, then computed keys: added until slow =`, firstSlowFrom(k?litSrc(k):()=>({}), (o,i)=>{o['k'+i]=i;}));
class E0 {} ; console.log('instance of empty class, computed keys:', firstSlowFrom(()=>new E0(), (o,i)=>{o['k'+i]=i;}));
console.log('Object.create({}) , computed keys:', firstSlowFrom(()=>Object.create({}), (o,i)=>{o['k'+i]=i;}));
console.log('{} , Symbol-free named via Reflect.set:', firstSlowFrom(()=>({}), (o,i)=>{Reflect.set(o,'k'+i,i);}));
console.log('{} , Object.defineProperty data props:', firstSlowFrom(()=>({}), (o,i)=>{Object.defineProperty(o,'k'+i,{value:i,writable:true,enumerable:true,configurable:true});}));
// named stores, other counts around the limit and in a loop-free function after reuse
const named = (count) => new Function('o', Array.from({ length: count }, (_, i) => `o.k${i} = ${i};`).join('\n'));
for (const c of [1019, 1020, 1021, 1022, 2000]) { const o = {}; named(c)(o); console.log(`named stores ${c}:`, 'fast', %HasFastProperties(o)); }
// named stores on an object that already has 10 props from a literal
{ const o = {a:0,b:0,c:0,d:0,e:0,f:0,g:0,h:0,i:0,j:0}; named(1010)(o); console.log('10-key literal + 1010 named stores (1020 total): fast', %HasFastProperties(o)); named(1011)(o);  }
{ const o = {a:0,b:0,c:0,d:0,e:0,f:0,g:0,h:0,i:0,j:0}; named(1011)(o); console.log('10-key literal + 1011 named stores (1021 total): fast', %HasFastProperties(o)); }
// literals
for (const c of [1019, 1020,1021,1022]) console.log(`literal ${c} keys: fast`, %HasFastProperties(new Function(`return {${Array.from({length:c},(_, i)=>`k${i}:${i}`).join(',')}}`)()));
// JSON.parse variants
const json = (n, mk) => JSON.stringify(Object.fromEntries(Array.from({length:n},(_, i)=>['k'+i, mk(i)])));
for (const n of [126,127,128,129,200]) console.log(`JSON.parse ${n} Smi-valued keys: fast`, %HasFastProperties(JSON.parse(json(n,i=>i))));
console.log('JSON.parse 128 string-valued keys: fast', %HasFastProperties(JSON.parse(json(128,i=>'v'+i))));
console.log('JSON.parse 128 nested {} values: fast', %HasFastProperties(JSON.parse(json(128,i=>({a:i})))));
console.log('JSON.parse 100 keys: fast', %HasFastProperties(JSON.parse(json(100,i=>i))));
const inner = JSON.parse('{"o":'+json(200,i=>i)+'}'); console.log('JSON.parse nested 200-key inner object: outer fast', %HasFastProperties(inner), 'inner fast', %HasFastProperties(inner.o));
console.log('JSON.parse array of 3 x 200-key objects: each fast', JSON.parse('['+[1,2,3].map(()=>json(200,i=>i)).join(',')+']').map(o=>%HasFastProperties(o)).join());
console.log('JSON.parse reviver, 128 keys: fast', %HasFastProperties(JSON.parse(json(128,i=>i),(k,v)=>v)));
```

Output:

```text
literal with 0 keys, then computed keys: added until slow = 20
literal with 1 keys, then computed keys: added until slow = 16
literal with 3 keys, then computed keys: added until slow = 16
literal with 10 keys, then computed keys: added until slow = 16
literal with 30 keys, then computed keys: added until slow = 34
literal with 100 keys, then computed keys: added until slow = 103
literal with 300 keys, then computed keys: added until slow = 1
instance of empty class, computed keys: 26
Object.create({}) , computed keys: 20
{} , Symbol-free named via Reflect.set: 20
{} , Object.defineProperty data props: 1021
named stores 1019: fast true
named stores 1020: fast true
named stores 1021: fast false
named stores 1022: fast false
named stores 2000: fast false
10-key literal + 1010 named stores (1020 total): fast true
10-key literal + 1011 named stores (1021 total): fast false
literal 1019 keys: fast true
literal 1020 keys: fast true
literal 1021 keys: fast false
literal 1022 keys: fast false
JSON.parse 126 Smi-valued keys: fast true
JSON.parse 127 Smi-valued keys: fast true
JSON.parse 128 Smi-valued keys: fast false
JSON.parse 129 Smi-valued keys: fast false
JSON.parse 200 Smi-valued keys: fast false
JSON.parse 128 string-valued keys: fast false
JSON.parse 128 nested {} values: fast false
JSON.parse 100 keys: fast true
JSON.parse nested 200-key inner object: outer fast true inner fast false
JSON.parse array of 3 x 200-key objects: each fast false,false,false
JSON.parse reviver, 128 keys: fast false
```

</details>

So code that builds a lookup table with computed string keys (`map['id' + i] = …`) from `{}` gets a dictionary-mode object after about 20 keys (16 added keys on a literal of up to 10 keys, 34 on a 30-key literal, 103 on a 100-key literal; the cause of this dependence on the starting size was not isolated); that is usually what you want for a real dictionary, but not for a record type. The `--max-fast-properties` flag (default 128) did not limit named stores in this run ✅[^lab]. On V8 14.1 (Node.js 25.7.0), 15.0 (Electron 43) and 15.8 (Chrome 158), an object literal with 128 or more keys was already in dictionary mode, while named stores and `Object.fromEntries` still stayed fast up to 1020 ✅[^lab-matrix].

**Accessors and `Object.defineProperty`.** ✅[^lab]

- An object literal with a getter or setter (`{ get v() {} }`) is created in dictionary mode.
- Adding a new accessor later with `Object.defineProperty` keeps the object fast, and so does a class whose prototype has getters, setters and methods.
- Turning an existing data property into an accessor switches the object to dictionary mode.
- A data property with non-default attributes (non-writable, non-enumerable) keeps the object fast; `Object.freeze` keeps it fast but gives it a new map.
- `Object.create(null)` objects start in dictionary mode.

<details>
<summary>Lab: <code>acc.mjs</code></summary>

```sh
docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node --allow-natives-syntax acc.mjs
```

```js
const fast = (label, o) => console.log(label.padEnd(56), 'fast:', %HasFastProperties(o));
fast('{ get v() {} } (literal, one getter)', { get v() { return 1; } });
fast('{ a: 1, get v() {} }', { a: 1, get v() { return 1; } });
const o = { a: 1 }; Object.defineProperty(o, 'v', { get() { return 1; }, configurable: true, enumerable: true });
fast('{ a: 1 } then defineProperty(o, "v", { get })', o);
class C { get v() { return 1; } set v(x) {} m() {} }
fast('C.prototype (class with get v, set v, m)', C.prototype);
const d = {}; Object.defineProperties(d, { a: { get() { return 1; } }, b: { get() { return 2; } } });
fast('{} then defineProperties with two getters', d);
```

Output:

```text
{ get v() {} } (literal, one getter)                     fast: false
{ a: 1, get v() {} }                                     fast: false
{ a: 1 } then defineProperty(o, "v", { get })            fast: true
C.prototype (class with get v, set v, m)                 fast: true
{} then defineProperties with two getters                fast: true
```

</details>

### 3.5 Integer-like keys

Named properties and elements are stored separately ✅[^v8-fastprops]. A key that is an array index (a canonical integer string from `"0"` to `"4294967294"`) goes to the elements, so it does not add a map transition; `"01"`, `"-1"`, `"1.5"` and `"4294967295"` are ordinary named properties ✅[^lab]. `o["4294967294"]` also switches the elements to a dictionary, because of the gap rule in §3.8 ✅[^lab]. Integer keys are listed first, in numeric order, by `Object.keys` ✅[^lab].

<details>
<summary>Lab: <code>intkeys.mjs</code></summary>

```sh
docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node --allow-natives-syntax intkeys.mjs
```

```js
// Which keys are stored as elements (array indices) and which as named properties?
// A named property adds a map transition; an element changes the map only if the elements kind changes.
for (const key of ['0', '1', '01', '-1', '1.5', '4294967294', '4294967295']) {
  const o = {}; o[key] = true;
  console.log(`o[${JSON.stringify(key)}] = true`.padEnd(26), 'map changed:', String(!%HaveSameMap(o, {})).padEnd(6), '| dictionary elements:', %HasDictionaryElements(o));
}
console.log('key order of { b: 1, 2: 1, a: 1, 1: 1 }:', Object.keys({ b: 1, 2: 1, a: 1, 1: 1 }).join(', '));
```

Output:

```text
o["0"] = true              map changed: false  | dictionary elements: false
o["1"] = true              map changed: false  | dictionary elements: false
o["01"] = true             map changed: true   | dictionary elements: false
o["-1"] = true             map changed: true   | dictionary elements: false
o["1.5"] = true            map changed: true   | dictionary elements: false
o["4294967294"] = true     map changed: true   | dictionary elements: true
o["4294967295"] = true     map changed: true   | dictionary elements: false
key order of { b: 1, 2: 1, a: 1, 1: 1 }: 1, 2, b, a
```

</details>

An object used as a map from numeric IDs to values therefore stores the values as elements, and a dense run of IDs from 0 costs about 9 bytes per entry (§4.1) ✅[^lab].

### 3.6 Elements kinds: the lattice, one step at a time

**What the engine does.** V8 distinguishes 21 elements kinds ✅[^v8-elements]. The six common ones form a lattice, and an array can only move down it ✅[^v8-elements] ✅[^v8-fields]:

```text
PACKED_SMI_ELEMENTS    → PACKED_DOUBLE_ELEMENTS → PACKED_ELEMENTS
        ↓                         ↓                      ↓
HOLEY_SMI_ELEMENTS     → HOLEY_DOUBLE_ELEMENTS  → HOLEY_ELEMENTS
```

**Why it helps.** A Smi array is a plain row of tagged integers, and a double array a row of raw 8-byte floats with no boxes: 8 bytes per element each, against 24 for a double in a generic array (§4.1) ✅[^lab]. `--unbox-double-arrays` is on by default here ✅[^lab].

**The lattice in the lab** ✅[^lab]:

- `[1, 2, 3]` is `PACKED_SMI`; `push(4.5)` makes it `PACKED_DOUBLE`; `push('x')` makes it `PACKED_ELEMENTS`.
- Popping back to integers, `length = 0`, and pushing `1` again leave it `PACKED_ELEMENTS`: the kind never goes back up.
- `-0`, `NaN`, `Infinity` and `2 ** 31` in an integer literal make it `PACKED_DOUBLE`, as the 2017 post says for the first three ✅[^v8-elements].
- `[1, undefined, 3]` is `PACKED_ELEMENTS`, not holey: `undefined` is a value, not a hole. That held on V8 12.4 to 14.1 (Node.js 22.23.4 to 25.7.0, and Electron 38.8.6 with V8 14.0); on V8 15.0 in Deno 2.9.8 and Electron 43.7.7, and on V8 15.8 in Chrome 158, the natives report `HOLEY_DOUBLE_ELEMENTS` for it. Deno has neither the sandbox nor pointer compression, and the Node.js 24.22.3 build with pointer compression on reports `PACKED_ELEMENTS`, so the change comes with the V8 version in the builds run, not with the sandbox or pointer compression ✅[^lab-matrix].
- `map`, `filter` and `slice` start a new array at the most specific kind: `[1.5, 2.5].map(Math.round)` is `PACKED_SMI`.
- `Array.from({ length: 3 })` (values `undefined`) and `[...new Array(3)]` are `PACKED_ELEMENTS`; `'a,b'.split(',')` is `PACKED_ELEMENTS`. In Electron 43 and Deno 2.9.8 (V8 15.0) and in Chrome 158 (V8 15.8), `Array.from({ length: 3 })` was `HOLEY_DOUBLE_ELEMENTS` and `[...new Array(3)]` stayed `PACKED_ELEMENTS`; the Node.js 24.22.3 build with pointer compression on gave `PACKED_ELEMENTS` for `Array.from({ length: 3 })`, as the baseline does ✅[^lab-matrix].

<details>
<summary>Lab: <code>kinds.mjs</code></summary>

```sh
docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node --allow-natives-syntax kinds.mjs
```

```js
// Name an array's elements kind from the boolean natives.
function kind(a) {
  if (%HasDictionaryElements(a)) return 'DICTIONARY_ELEMENTS';
  const holey = %HasHoleyElements(a) ? 'HOLEY' : 'PACKED';
  if (%HasSmiElements(a)) return holey + '_SMI_ELEMENTS';
  if (%HasDoubleElements(a)) return holey + '_DOUBLE_ELEMENTS';
  if (%HasObjectElements(a)) return holey + '_ELEMENTS';
  return 'other';
}
const show = (label, a) => console.log(label.padEnd(44), kind(a));
const a = [1, 2, 3];        show('[1, 2, 3]', a);
a.push(4.5);                show('push(4.5)', a);
a.push('x');                show("push('x')", a);
a.pop(); a.pop();           show('pop twice (only small integers left)', a);
a.length = 0;               show('length = 0', a);
a.push(1);                  show('then push(1)', a);
const b = [1, 2, 3]; b[5] = 6;  show('[1, 2, 3], then b[5] = 6', b);
b[3] = 4; b[4] = 5;         show('fill the holes b[3], b[4]', b);
show('[1, -0]', [1, -0]);
show('[1, NaN]', [1, NaN]);
show('[1, Infinity]', [1, Infinity]);
show('[1, 2 ** 31]', [1, 2 ** 31]);
show('[]', []);
show('new Array(3)', new Array(3));
show('new Array(3).fill(0)', new Array(3).fill(0));
show('Array(3).fill(1.5)', Array(3).fill(1.5));
show('Array.from({ length: 3 }, (_, i) => i)', Array.from({ length: 3 }, (_, i) => i));
show('Array.from({ length: 3 })', Array.from({ length: 3 }));
show('Array.of(1, 2, 3)', Array.of(1, 2, 3));
show('[...new Array(3)]', [...new Array(3)]);
show('new Array(3).map(x => 0)', new Array(3).map(() => 0));
const c = []; for (let i = 0; i < 3; i++) c.push(i); show('[] then push 0, 1, 2', c);
const d = []; for (let i = 0; i < 3; i++) d[i] = i; show('[] then d[i] = i for i = 0..2', d);
const e = []; e[2] = 2; e[1] = 1; e[0] = 0; show('[] then e[2], e[1], e[0] (backwards)', e);
show('[1, , 3] (hole in the literal)', [1, , 3]);
show('[1, undefined, 3]', [1, undefined, 3]);
show('[1, 2, 3].map(x => x * 1.5)', [1, 2, 3].map((x) => x * 1.5));
show('[1.5, 2.5].map(x => Math.round(x))', [1.5, 2.5].map((x) => Math.round(x)));
show('[1, 2, 3].filter(x => x > 1)', [1, 2, 3].filter((x) => x > 1));
show('[1, 2, 3].slice()', [1, 2, 3].slice());
show('[...[1, , 3]] (spread of holey)', [...[1, , 3]]);
show('[1.5, 2.5].concat([1])', [1.5, 2.5].concat([1]));
show("'a,b'.split(',')", 'a,b'.split(','));
```

Output:

```text
[1, 2, 3]                                    PACKED_SMI_ELEMENTS
push(4.5)                                    PACKED_DOUBLE_ELEMENTS
push('x')                                    PACKED_ELEMENTS
pop twice (only small integers left)         PACKED_ELEMENTS
length = 0                                   PACKED_ELEMENTS
then push(1)                                 PACKED_ELEMENTS
[1, 2, 3], then b[5] = 6                     HOLEY_SMI_ELEMENTS
fill the holes b[3], b[4]                    HOLEY_SMI_ELEMENTS
[1, -0]                                      PACKED_DOUBLE_ELEMENTS
[1, NaN]                                     PACKED_DOUBLE_ELEMENTS
[1, Infinity]                                PACKED_DOUBLE_ELEMENTS
[1, 2 ** 31]                                 PACKED_DOUBLE_ELEMENTS
[]                                           PACKED_SMI_ELEMENTS
new Array(3)                                 HOLEY_SMI_ELEMENTS
new Array(3).fill(0)                         PACKED_SMI_ELEMENTS
Array(3).fill(1.5)                           PACKED_DOUBLE_ELEMENTS
Array.from({ length: 3 }, (_, i) => i)       PACKED_SMI_ELEMENTS
Array.from({ length: 3 })                    PACKED_ELEMENTS
Array.of(1, 2, 3)                            PACKED_SMI_ELEMENTS
[...new Array(3)]                            PACKED_ELEMENTS
new Array(3).map(x => 0)                     HOLEY_SMI_ELEMENTS
[] then push 0, 1, 2                         PACKED_SMI_ELEMENTS
[] then d[i] = i for i = 0..2                PACKED_SMI_ELEMENTS
[] then e[2], e[1], e[0] (backwards)         HOLEY_SMI_ELEMENTS
[1, , 3] (hole in the literal)               HOLEY_SMI_ELEMENTS
[1, undefined, 3]                            PACKED_ELEMENTS
[1, 2, 3].map(x => x * 1.5)                  PACKED_DOUBLE_ELEMENTS
[1.5, 2.5].map(x => Math.round(x))           PACKED_SMI_ELEMENTS
[1, 2, 3].filter(x => x > 1)                 PACKED_SMI_ELEMENTS
[1, 2, 3].slice()                            PACKED_SMI_ELEMENTS
[...[1, , 3]] (spread of holey)              PACKED_ELEMENTS
[1.5, 2.5].concat([1])                       PACKED_DOUBLE_ELEMENTS
'a,b'.split(',')                             PACKED_ELEMENTS
```

</details>

### 3.7 Holes, `new Array(n)` and `fill`

**What the engine does.** `new Array(n)` creates a holey array ✅[^v8-elements] ✅[^lab]. Writing past the end, or filling an empty array backwards, makes it holey too ✅[^lab]. Filling the holes one by one does not make it packed again: `b[3] = 4; b[4] = 5` leaves `HOLEY_SMI`, and so does `new Array(10)` filled by index ✅[^lab].

**What changed.** The 2017 post said that an array, once holey, stays holey forever ✅[^v8-elements]; an update of 28 February 2025 on the same post adds an exception for `Array.prototype.fill` ✅[^v8-elements]. In this build, `fill(value)` over the whole array turns `HOLEY_SMI` into `PACKED_SMI`, for sizes from 3 to 1 000 000 and for a holey literal; a `fill` that leaves one slot empty keeps it holey ✅[^lab]. A review re-run added sizes 1, 2, 16, 17, 100, 1025, 5 000 000 and 10 000 000 (all became packed), doubles (`PACKED_DOUBLE`), strings and objects (`PACKED_ELEMENTS`), an explicit full range `fill(0, 0, 5)`, an end past the length, and a holey array with a real gap (`a[10] = 1` on `[1, 2, 3]`): all packed. Exceptions: `new Array(0).fill(0)` stays `HOLEY_SMI` (nothing to fill), and `fill(0, 1)`, which skips index 0, stays holey ✅[^lab]. The same held on V8 14.1, 15.0 and in Chrome 158 (V8 15.8), except that on V8 15.0 (Electron 43, Deno 2.9.8) and in Chrome 158 `new Array(5).fill(undefined)` became `HOLEY_DOUBLE`, not `PACKED_ELEMENTS`; Electron 38.8.6 (V8 14.0) gave `PACKED_ELEMENTS`. On V8 12.4 (Node.js 22.23.4) there is no exception: every `fill` in both scripts left the array holey, as the 2017 post describes ✅[^lab-matrix].

<details>
<summary>Lab: <code>fill.mjs</code></summary>

```sh
docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node --allow-natives-syntax fill.mjs
```

```js
function kind(a) {
  if (%HasDictionaryElements(a)) return 'DICTIONARY_ELEMENTS';
  const holey = %HasHoleyElements(a) ? 'HOLEY' : 'PACKED';
  if (%HasSmiElements(a)) return holey + '_SMI_ELEMENTS';
  if (%HasDoubleElements(a)) return holey + '_DOUBLE_ELEMENTS';
  return holey + '_ELEMENTS';
}
for (const n of [3, 1000, 100000]) {
  const a = new Array(n); const before = kind(a); const r = a.fill(0);
  console.log(`new Array(${n}): ${before} -> fill(0): ${kind(a)} (same array: ${r === a})`);
}
const p = new Array(10); p.fill(0, 0, 9); console.log('new Array(10).fill(0, 0, 9) (last slot left empty):', kind(p));
const q = new Array(10); for (let i = 0; i < 10; i++) q[i] = 0; console.log('new Array(10), then q[i] = 0 for every i     :', kind(q));
const h = [1, , 3]; h.fill(7); console.log('[1, , 3].fill(7) (holey literal)              :', kind(h));
const big = new Array(1e6); console.log('new Array(1e6)                                 :', kind(big));
big.fill(0); console.log('new Array(1e6).fill(0)                         :', kind(big));
```

Output:

```text
new Array(3): HOLEY_SMI_ELEMENTS -> fill(0): PACKED_SMI_ELEMENTS (same array: true)
new Array(1000): HOLEY_SMI_ELEMENTS -> fill(0): PACKED_SMI_ELEMENTS (same array: true)
new Array(100000): HOLEY_SMI_ELEMENTS -> fill(0): PACKED_SMI_ELEMENTS (same array: true)
new Array(10).fill(0, 0, 9) (last slot left empty): HOLEY_SMI_ELEMENTS
new Array(10), then q[i] = 0 for every i     : HOLEY_SMI_ELEMENTS
[1, , 3].fill(7) (holey literal)              : PACKED_SMI_ELEMENTS
new Array(1e6)                                 : HOLEY_SMI_ELEMENTS
new Array(1e6).fill(0)                         : PACKED_SMI_ELEMENTS
```

</details>

<details>
<summary>Lab: <code>fill-var.mjs</code> (review variation: more sizes, kinds and ranges)</summary>

```sh
docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node --allow-natives-syntax fill-var.mjs
```

```js
function kind(a) { if (%HasDictionaryElements(a)) return 'DICT'; const h = %HasHoleyElements(a) ? 'HOLEY' : 'PACKED'; if (%HasSmiElements(a)) return h+'_SMI'; if (%HasDoubleElements(a)) return h+'_DOUBLE'; return h+'_OBJ'; }
const t=(l,a)=>console.log(l.padEnd(52), kind(a));
for (const n of [0,1,2,16,17,100,1025,5000000,10000000]) { const a=new Array(n); const b=kind(a); a.fill(0); console.log(`new Array(${n}).fill(0)`.padEnd(30), b,'->',kind(a)); }
t('new Array(5).fill(1.5)', new Array(5).fill(1.5));
t("new Array(5).fill('x')", new Array(5).fill('x'));
t('new Array(5).fill({})', new Array(5).fill({}));
t('new Array(5).fill(undefined)', new Array(5).fill(undefined));
t('new Array(5).fill(0, 0)', new Array(5).fill(0,0));
t('new Array(5).fill(0, 0, 5)', new Array(5).fill(0,0,5));
t('new Array(5).fill(0, 1)', new Array(5).fill(0,1));
t('new Array(5).fill(0, -5)', new Array(5).fill(0,-5));
t('new Array(5).fill(0, 0, 100) (end clamped)', new Array(5).fill(0,0,100));
{const a=[]; a.length=5; a.fill(0); t('[] length=5 fill(0)', a);}
{const a=[1,2,3]; a[10]=1; a.fill(0); t('[1,2,3], a[10]=1, fill(0)', a);}
{const a=[1.5,,3.5]; a.fill(0.1); t('holey double literal fill', a);}
{const a=['a',,'c']; a.fill('z'); t('holey object literal fill', a);}
{const a=new Array(5); a.fill(0,0,4); t('fill all but last', a);}
{const a=new Array(5); a.fill(0,1); t('fill all but first', a);}
{const a=new Array(2000); a.fill(0,0,1999); t('2000, fill all but last', a);}
{const a=new Array(5); a.fill(0); a.length=10; t('after fill, length=10', a);}
{const a=new Array(5); a.fill(0); a.push(1); t('after fill, push', a);}
{const a=new Array(5); a[10]=1; a.fill(0); t('new Array(5), a[10]=1 (len 11), fill', a);}
```

Output:

```text
new Array(0).fill(0)           HOLEY_SMI -> HOLEY_SMI
new Array(1).fill(0)           HOLEY_SMI -> PACKED_SMI
new Array(2).fill(0)           HOLEY_SMI -> PACKED_SMI
new Array(16).fill(0)          HOLEY_SMI -> PACKED_SMI
new Array(17).fill(0)          HOLEY_SMI -> PACKED_SMI
new Array(100).fill(0)         HOLEY_SMI -> PACKED_SMI
new Array(1025).fill(0)        HOLEY_SMI -> PACKED_SMI
new Array(5000000).fill(0)     HOLEY_SMI -> PACKED_SMI
new Array(10000000).fill(0)    HOLEY_SMI -> PACKED_SMI
new Array(5).fill(1.5)                               PACKED_DOUBLE
new Array(5).fill('x')                               PACKED_OBJ
new Array(5).fill({})                                PACKED_OBJ
new Array(5).fill(undefined)                         PACKED_OBJ
new Array(5).fill(0, 0)                              PACKED_SMI
new Array(5).fill(0, 0, 5)                           PACKED_SMI
new Array(5).fill(0, 1)                              HOLEY_SMI
new Array(5).fill(0, -5)                             PACKED_SMI
new Array(5).fill(0, 0, 100) (end clamped)           PACKED_SMI
[] length=5 fill(0)                                  PACKED_SMI
[1,2,3], a[10]=1, fill(0)                            PACKED_SMI
holey double literal fill                            PACKED_DOUBLE
holey object literal fill                            PACKED_OBJ
fill all but last                                    HOLEY_SMI
fill all but first                                   HOLEY_SMI
2000, fill all but last                              HOLEY_SMI
after fill, length=10                                HOLEY_SMI
after fill, push                                     PACKED_SMI
new Array(5), a[10]=1 (len 11), fill                 PACKED_SMI
```

</details>

`length = 0` does not reset an array's kind either (§3.6), and lengthening an array with `length = 100000` makes it holey ✅[^lab].

### 3.8 Dictionary (sparse) elements

Slow elements use a hash table keyed by index ✅[^v8-jsarray]. In this build an array switches to them when ✅[^lab]:

- a write leaves 1024 or more empty slots past the current end: `a[1027] = 1` on `[1, 2, 3]` switches, `a[1026] = 1` does not, which fits the source's maximum gap of 1024 ✅[^v8-jsobjects];
- `new Array(n)` has `n` above 33 554 432 (32 × 1024 × 1024), the source's maximum fast array length, which that header lowers to 8 × 1024 × 1024 in a build with `V8_LOWER_LIMITS_MODE` ✅[^v8-jsarray];
- an element gets a getter through `Object.defineProperty`.

Unlike the elements kinds, this one does come back: an array that became sparse through `a[50000] = 1` returns to fast elements once indexes 0 to 49 999 are filled ✅[^lab]. `Object.freeze([1, 2, 3])` keeps fast elements ✅[^lab].

<details>
<summary>Lab: <code>sparse.mjs</code></summary>

```sh
docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node --allow-natives-syntax sparse.mjs
```

```js
const dict = (a) => %HasDictionaryElements(a);
for (const empty of [1023, 1024]) { const a = [1, 2, 3]; a[3 + empty] = 1; console.log(`[1, 2, 3], then a[${3 + empty}] = 1 (${empty} empty slots):`, 'dictionary:', dict(a)); }
for (const n of [1000, 100000, 32 * 1024 * 1024, 32 * 1024 * 1024 + 1]) console.log(`new Array(${n})`.padEnd(36), 'dictionary:', dict(new Array(n)));
const big = []; big[50000] = 1; console.log('[] then a[50000] = 1'.padEnd(36), 'dictionary:', dict(big));
const s = []; s[50000] = 1; for (let i = 0; i < 50000; i++) s[i] = i; console.log('... then fill a[0..49999]'.padEnd(36), 'dictionary:', dict(s));
const l = [1, 2, 3]; l.length = 100000; console.log('[1, 2, 3], then length = 100000'.padEnd(36), 'dictionary:', dict(l), '| holey:', %HasHoleyElements(l));
const g = [1, 2, 3]; g.length = 0; console.log('[1, 2, 3], then length = 0'.padEnd(36), 'smi:', %HasSmiElements(g), '| holey:', %HasHoleyElements(g));
const d = [1.5, 2.5]; d.length = 0; d.push(1); console.log('[1.5, 2.5], length = 0, push(1)'.padEnd(36), 'double:', %HasDoubleElements(d));
const n = [1, 2, 3]; Object.defineProperty(n, 0, { get() { return 1; } }); console.log('defineProperty(arr, 0, getter)'.padEnd(36), 'dictionary:', dict(n));
const f = Object.freeze([1, 2, 3]); console.log('Object.freeze([1, 2, 3])'.padEnd(36), 'dictionary:', dict(f));
```

Output:

```text
[1, 2, 3], then a[1026] = 1 (1023 empty slots): dictionary: false
[1, 2, 3], then a[1027] = 1 (1024 empty slots): dictionary: true
new Array(1000)                      dictionary: false
new Array(100000)                    dictionary: false
new Array(33554432)                  dictionary: false
new Array(33554433)                  dictionary: true
[] then a[50000] = 1                 dictionary: true
... then fill a[0..49999]            dictionary: false
[1, 2, 3], then length = 100000      dictionary: false | holey: true
[1, 2, 3], then length = 0           smi: true | holey: false
[1.5, 2.5], length = 0, push(1)      double: true
defineProperty(arr, 0, getter)       dictionary: true
Object.freeze([1, 2, 3])             dictionary: false
```

</details>

### 3.9 Typed arrays and `ArrayBuffer`

A typed array is a view over an `ArrayBuffer`: a fixed length, one element type, no holes and no kind transitions. In this build a typed array of up to 64 bytes (the source's default `kMaxSizeInHeap`) keeps its data on the V8 heap; above that the bytes are allocated outside it and show up in `process.memoryUsage().arrayBuffers` ✅[^v8-jsab] ✅[^lab], which Node.js documents as memory for `ArrayBuffer`s, also counted in `external` ✅[^node-process]. In Electron 43's Node mode `arrayBuffers` stayed at 0; the same script reading `external` showed the same 64-byte boundary (0 bytes for 64, 65 for 65, 0 for a `Float64Array(8)`, 72 for 9) ✅[^lab-matrix]. The Node.js 24.22.3 build with pointer compression on and the sandbox off counted the bytes in `arrayBuffers` as the baseline does, so pointer compression is not the cause ✅[^lab-matrix]. Electron 38.8.6 (V8 14.0, sandbox on) showed what Electron 43 showed (`arrayBuffers` 0; `external` 0, 65, 0 and 72), so it is common to the two Electron builds, not to V8 15.0; cause not isolated between the sandbox and Electron's build. Deno 2.9.8 cannot settle it: its own `process.memoryUsage()` reported `arrayBuffers` 0 and counted the 64-byte arrays in `external` too ✅[^lab-matrix]. Not checked in Chrome: a page has no `arrayBuffers` counter, and its `usedJSHeapSize` counts `ArrayBuffer` contents (a 100 MB `ArrayBuffer` added 100.0 MB, against 0.0 in `heapUsed` on Node.js 24.22.1) ✅[^lab-matrix]. Writes convert the value to the element type: past the end is ignored, `'abc'` becomes `NaN` in a `Float64Array`, `300` becomes `44` in an `Int8Array` and `255` in a `Uint8ClampedArray` ✅[^lab].

<details>
<summary>Lab: <code>typed.mjs</code></summary>

```sh
docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node --expose-gc --allow-natives-syntax typed.mjs
```

```js
// Where does a typed array's data live? Count arrayBuffers (off-heap) growth for 10,000 arrays.
const keep = [];
function off(label, make) {
  globalThis.gc(); const before = process.memoryUsage().arrayBuffers;
  const list = []; for (let i = 0; i < 10_000; i++) list.push(make()); keep.push(list);
  globalThis.gc(); const after = process.memoryUsage().arrayBuffers;
  console.log(label.padEnd(30), 'off-heap bytes per array:', ((after - before) / 10_000).toFixed(1));
}
off('new Uint8Array(64)', () => new Uint8Array(64));
off('new Uint8Array(65)', () => new Uint8Array(65));
off('new Float64Array(8)', () => new Float64Array(8));
off('new Float64Array(9)', () => new Float64Array(9));
const f = new Float64Array(2);
console.log('Float64Array elements kind is FLOAT64:', %HasFixedFloat64Elements(f));
f[5] = 1; console.log('write past the end, f[5] = 1 -> f.length:', f.length, '| f[5]:', f[5]);
f[0] = 'abc'; console.log("f[0] = 'abc' stores:", f[0]);
const i8 = new Int8Array(1); i8[0] = 300; console.log('Int8Array: i8[0] = 300 stores:', i8[0]);
const c8 = new Uint8ClampedArray(1); c8[0] = 300; console.log('Uint8ClampedArray: c8[0] = 300 stores:', c8[0]);
```

Output:

```text
new Uint8Array(64)             off-heap bytes per array: 0.0
new Uint8Array(65)             off-heap bytes per array: 65.0
new Float64Array(8)            off-heap bytes per array: 0.0
new Float64Array(9)            off-heap bytes per array: 72.0
Float64Array elements kind is FLOAT64: true
write past the end, f[5] = 1 -> f.length: 2 | f[5]: undefined
f[0] = 'abc' stores: NaN
Int8Array: i8[0] = 300 stores: 44
Uint8ClampedArray: c8[0] = 300 stores: 255
```

</details>

A `Float64Array` costs 8 bytes per element, like a `PACKED_DOUBLE` array, and an `Int32Array` 4 bytes, half of a Smi array in this build (§4.1) ✅[^lab]. How external memory is collected is in [v8-memory-and-startup-deep-dive.md](v8-memory-and-startup-deep-dive.md).

### 3.10 Strings

**Representations.** ✅[^v8-string] ✅[^lab]

- A string made from characters is one-byte when every character code is 255 or less; `"café"` is one-byte, because `é` is U+00E9. One character above 255, such as an em dash, makes the whole string two-byte, which doubles its size (§4.1). The boundary was checked at U+00FF (`ÿ`, one-byte) against U+0100 (`Ā`, two-byte), with characters written literally and built by `String.fromCharCode`; `€` and an emoji (U+1F600, stored as two 16-bit units) are two-byte. A wide character at the end of a 200-character ASCII string makes the rope two-byte. A string can also be two-byte without holding a wide character itself: a 100-character ASCII `slice` of a two-byte parent was `SLICED_TWO_BYTE_STRING_TYPE`, while a copy of it made with `split('').join('')` was one-byte; and `'ÿ'.toUpperCase()` gives `Ÿ` (U+0178), which is two-byte, because case conversion can create a character above 255.
- `a + b` gives a flat sequential string when the result is shorter than 13 characters, and a cons string (rope) from 13 characters up; 13 is the source's `ConsString::kMinLength`.
- `slice` and `substring` give a sliced string from 13 characters up (`SlicedString::kMinLength` is 13), a copy below that.
- A string built at run time is not internalized; using it as a property key internalizes it, and the original becomes a thin string that forwards to the internalized copy.
- Reading a character of a rope flattens it: `%StringIsFlat` goes from `false` to `true` after `s.charCodeAt(50)`.

<details>
<summary>Lab: <code>strtype.mjs</code></summary>

```sh
docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node --allow-natives-syntax strtype.mjs | grep -E '^##| - type:|flat|internalized'
```

```js
// Prints the string's internal type from %DebugPrint; run through: grep -E '^##|type:'
const show = (label, s) => { console.log('##', label); %DebugPrint(s); };
const n = Number(process.argv[2] ?? 7);            // a runtime value, so nothing is folded at parse time
const twelve = 'abcdefghijk' + String(n);          // 11 + 1 = 12 characters
const thirteen = 'abcdefghijkl' + String(n);       // 12 + 1 = 13 characters
const long = 'x'.repeat(100) + String(n);
show('literal "hello"', 'hello');
show('"caf\\u00e9" (é is U+00E9, fits in one byte)', 'café' + String(n));
show('"\\u2014" em dash (U+2014) in the text', 'a—b' + String(n));
show('12-character concatenation', twelve);
show('13-character concatenation', thirteen);
show('long.slice(1, 13) (12 characters)', long.slice(1, 13));
show('long.slice(1, 14) (13 characters)', long.slice(1, 14));
let s = ''; for (let i = 0; i < 100; i++) s += String(i % 10);
show('s += digit, 100 times', s);
console.log('flat before:', %StringIsFlat(s)); s.charCodeAt(50); console.log('flat after s.charCodeAt(50):', %StringIsFlat(s));
const k = 'key' + String(n);
console.log('computed "key7" internalized:', %IsInternalizedString(k));
const o = {}; o[k] = 1;
show('the same string after o[k] = 1', k);
```

Output:

```text
## literal "hello"
 - type: INTERNALIZED_ONE_BYTE_STRING_TYPE
## "caf\u00e9" (é is U+00E9, fits in one byte)
 - type: SEQ_ONE_BYTE_STRING_TYPE
## "\u2014" em dash (U+2014) in the text
 - type: SEQ_TWO_BYTE_STRING_TYPE
## 12-character concatenation
 - type: SEQ_ONE_BYTE_STRING_TYPE
## 13-character concatenation
 - type: CONS_ONE_BYTE_STRING_TYPE
## long.slice(1, 13) (12 characters)
 - type: SEQ_ONE_BYTE_STRING_TYPE
## long.slice(1, 14) (13 characters)
 - type: SLICED_ONE_BYTE_STRING_TYPE
## s += digit, 100 times
 - type: CONS_ONE_BYTE_STRING_TYPE
flat before: false
flat after s.charCodeAt(50): true
computed "key7" internalized: false
## the same string after o[k] = 1
 - type: THIN_ONE_BYTE_STRING_TYPE
```

</details>

<details>
<summary>Lab: <code>twobyte.mjs</code> (review variation: the one-byte and two-byte boundary)</summary>

```sh
docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node --allow-natives-syntax twobyte.mjs | grep -E '^##| - type:' | sed -E 's/0x[0-9a-f]{6,}/0x…/g'
```

```js
// Which strings are two-byte? Prints the internal type of each; run through: grep -E '^##| - type:'
const n = Number(process.argv[2] ?? 7);              // a runtime value, so nothing is folded at parse time
const show = (label, s) => { console.log('##', label); %DebugPrint(s); };
show('"\\u00ff" + n (ÿ, code 255)', 'ÿ' + n);
show('"\\u0100" + n (Ā, code 256)', 'Ā' + n);
show('String.fromCharCode(255) + n', String.fromCharCode(255) + n);
show('String.fromCharCode(256) + n', String.fromCharCode(256) + n);
show('"€" + n (U+20AC)', '€' + n);
show('"😀" + n (U+1F600)', '😀' + n);
const wide = 'a'.repeat(200) + '—' + n;
show('200 x "a" + "—" + n', wide);
show('wide.slice(0, 100): only ASCII characters', wide.slice(0, 100));
show('same slice copied with split("").join("")', wide.slice(0, 100).split('').join(''));
show('"ÿ" x 20 .toUpperCase() + n (becomes Ÿ, U+0178)', 'ÿ'.repeat(20).toUpperCase() + n);
```

Output:

```text
## "\u00ff" + n (ÿ, code 255)
 - type: SEQ_ONE_BYTE_STRING_TYPE
## "\u0100" + n (Ā, code 256)
 - type: INTERNALIZED_TWO_BYTE_STRING_TYPE
## String.fromCharCode(255) + n
 - type: SEQ_ONE_BYTE_STRING_TYPE
## String.fromCharCode(256) + n
 - type: INTERNALIZED_TWO_BYTE_STRING_TYPE
## "€" + n (U+20AC)
 - type: INTERNALIZED_TWO_BYTE_STRING_TYPE
## "😀" + n (U+1F600)
 - type: SEQ_TWO_BYTE_STRING_TYPE
## 200 x "a" + "—" + n
 - type: CONS_TWO_BYTE_STRING_TYPE
## wide.slice(0, 100): only ASCII characters
 - type: SLICED_TWO_BYTE_STRING_TYPE
## same slice copied with split("").join("")
 - type: SEQ_ONE_BYTE_STRING_TYPE
## "ÿ" x 20 .toUpperCase() + n (becomes Ÿ, U+0178)
 - type: CONS_TWO_BYTE_STRING_TYPE
```

</details>

**What a slice keeps alive.** A sliced string points to its parent, and the V8 source lists truncating a slice so that the parent can be collected as a missing feature ✅[^v8-string]. In the lab, holding a 20-character slice of a 10 000 000-character string kept about 10 MB of heap in use; dropping it, or holding a copy made with `split('').join('')`, freed it ✅[^lab]. Garbage collection and other retention paths are in [v8-memory-and-startup-deep-dive.md](v8-memory-and-startup-deep-dive.md).

<details>
<summary>Lab: <code>slice-keep.mjs</code> (memory: may vary by about 0.1 byte or 0.5 MB per run)</summary>

```sh
docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node --expose-gc --allow-natives-syntax slice-keep.mjs
```

```js
// Does a 20-character slice keep its 10,000,000-character parent alive? Run with --expose-gc --allow-natives-syntax.
const mb = () => (process.memoryUsage().heapUsed / 1e6).toFixed(1);
function parent(seed) { const s = seed + 'x'.repeat(10_000_000); %FlattenString(s); return s; } // one flat 10 MB one-byte string
globalThis.gc(); console.log('baseline, heapUsed MB           :', mb());
let slice = parent('a').slice(0, 20); globalThis.gc(); console.log('holding parent.slice(0, 20)     :', mb());
slice = null; globalThis.gc(); console.log('after dropping the slice        :', mb());
let copy = parent('b').slice(0, 20).split('').join(''); globalThis.gc(); console.log('holding slice.split("").join(""):', mb());
console.log("copy is a sliced string:", %HaveSameMap(copy, parent("c").slice(0, 20)));
```

Output:

```text
baseline, heapUsed MB           : 3.7
holding parent.slice(0, 20)     : 14.0
after dropping the slice        : 4.0
holding slice.split("").join(""): 4.0
copy is a sliced string: false
```

</details>

**String building in a loop.** Because `+=` adds a rope node instead of copying, building a string one character at a time stayed at roughly the same cost per character from 100 000 to 1 600 000 characters (7 to 15 ns per character in four runs), flattening included ✅[^lab] (measured here). Node.js 25.7.0, Electron 43 and Chrome 158 agreed (Electron at 2 to 5 ns, Chrome at 2.8 to 6 ns in three runs with `--disable-renderer-backgrounding` and 2.8 to 10 ns in three default headless runs, measured here); on V8 12.4 (Node.js 22.23.4) the cost was flat only up to 400 000 characters (9 to 22 ns) and rose to 31 to 56 ns at 800 000 and 1 600 000, in five runs ✅[^lab-matrix]. A quadratic cost would have grown that per-character time sixteenfold across the range. The conclusion does not extend to larger sizes: in review re-runs of the same loop (three runs) the cost per character rose to 29 to 41 ns at 3 200 000 characters and 37 to 45 ns at 6 400 000, then levelled off at 44 to 54 ns at 12 800 000 (`concat-var.mjs` below, one more run: 34, 38 and 40 ns), a rise of about 3 to 5 times against 100 000 but far from the 128 times a quadratic cost would give. In Electron 43 the rise was about 7 to 10 times (3 to 6 ns at 100 000, 21 to 34 ns at 6 400 000 and 12 800 000), in Chrome 158 about 4 to 9 times with `--disable-renderer-backgrounding` (3 to 7 ns, then 20 to 26 ns at 12 800 000, five runs; in five of six default headless runs the cost was already 36 to 43 ns at 1 600 000 characters and 110 to 123 ns at 12 800 000, cause not isolated) and on V8 12.4 it started at 1 600 000 ✅[^lab-matrix]. The cause of the rise was not isolated. A pattern that reads the string after every append is different: `s += 'x'; s.charCodeAt(0)` in the loop cost 154, 281, 540 and 935 ns per character at 5 000, 10 000, 20 000 and 40 000 characters in `concat-var.mjs` (116 to 960 ns in an earlier run), roughly doubling with the length, so that pattern is quadratic ✅[^lab].

<details>
<summary>Lab: <code>concat.mjs</code> (timing: the numbers vary per run)</summary>

```sh
docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node concat.mjs
```

```js
// Is s += 'x' in a loop quadratic? Time per character at growing n, flattening included.
const median = (xs) => xs.sort((a, b) => a - b)[xs.length >> 1];
function build(n) { let s = ''; for (let i = 0; i < n; i++) s += 'x'; s.charCodeAt(n >> 1); return s.length; }
for (let i = 0; i < 5; i++) build(100_000);                         // warm-up
for (const n of [100_000, 200_000, 400_000, 800_000, 1_600_000]) {
  const runs = [];
  for (let r = 0; r < 7; r++) { const t = process.hrtime.bigint(); build(n); runs.push(Number(process.hrtime.bigint() - t)); }
  console.log(`n = ${String(n).padStart(9)}: median ${(median(runs) / n).toFixed(1)} ns per character (7 runs)`);
}
```

Output:

```text
n =    100000: median 9.8 ns per character (7 runs)
n =    200000: median 13.2 ns per character (7 runs)
n =    400000: median 12.9 ns per character (7 runs)
n =    800000: median 13.3 ns per character (7 runs)
n =   1600000: median 9.2 ns per character (7 runs)
```

</details>

<details>
<summary>Lab: <code>concat-var.mjs</code> (timing: review variation, the numbers vary per run)</summary>

```sh
docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node concat-var.mjs
```

```js
// Review variation of concat.mjs: larger sizes, and a loop that reads the string after every append.
const median = (xs) => xs.sort((a, b) => a - b)[xs.length >> 1];
function build(n) { let s = ''; for (let i = 0; i < n; i++) s += 'x'; s.charCodeAt(n >> 1); return s.length; }
function buildAndRead(n) { let s = '', c = 0; for (let i = 0; i < n; i++) { s += 'x'; c += s.charCodeAt(0); } return c; }
for (let i = 0; i < 5; i++) build(100_000);
for (const n of [100_000, 1_600_000, 3_200_000, 6_400_000, 12_800_000]) {
  const runs = []; for (let r = 0; r < 5; r++) { const t = process.hrtime.bigint(); build(n); runs.push(Number(process.hrtime.bigint() - t)); }
  console.log(`flatten once, n = ${String(n).padStart(9)}: median ${(median(runs) / n).toFixed(1)} ns per character (5 runs)`);
}
for (const n of [5_000, 10_000, 20_000, 40_000]) {
  const runs = []; for (let r = 0; r < 5; r++) { const t = process.hrtime.bigint(); buildAndRead(n); runs.push(Number(process.hrtime.bigint() - t)); }
  console.log(`read after every append, n = ${String(n).padStart(6)}: median ${(median(runs) / n).toFixed(1)} ns per character (5 runs)`);
}
```

Output:

```text
flatten once, n =    100000: median 9.5 ns per character (5 runs)
flatten once, n =   1600000: median 12.7 ns per character (5 runs)
flatten once, n =   3200000: median 33.8 ns per character (5 runs)
flatten once, n =   6400000: median 38.3 ns per character (5 runs)
flatten once, n =  12800000: median 40.3 ns per character (5 runs)
read after every append, n =   5000: median 153.5 ns per character (5 runs)
read after every append, n =  10000: median 281.4 ns per character (5 runs)
read after every append, n =  20000: median 539.7 ns per character (5 runs)
read after every append, n =  40000: median 935.3 ns per character (5 runs)
```

</details>

### 3.11 `Map` and `Set` against plain objects

`Map` and `Set` are built on an ordered hash table that keeps insertion order, compares keys with SameValueZero, and is based on the deterministic hash table attributed to Tyler Close ✅[^v8-ordered]. An object used as a key keeps its hash code in its own properties backing store, and V8 moved it there from a private symbol in 2018 (V8 6.3 and later) ✅[^v8-hash] (post of 29 January 2018). A `Map` never changes mode; an object used as a dictionary does (§3.4). With 100 000 string keys holding small integers, the lab measured about 63 bytes per entry for a dictionary-mode object, 37 for a `Map` and 26 for a `Set`; with integer keys 0 to 99 999, an object (elements) cost about 9 bytes per entry and a `Map` 37 ✅[^lab] (§4.1). In Electron 43 and in Chrome 158, with pointer compression on, each was about half (31.5, 18.4, 13.1, 4.6 and 18.4) ✅[^lab-matrix].

### 3.12 Literals, spread, `Object.assign`, classes and prototypes

What the lab showed about maps ✅[^lab]:

- Two literals with the same keys in the same order share a map, even at different places in the code; `{x, y}` and `{y, x}` do not.
- `{ ...src }` gets the same map as `src`. `Object.assign({}, src)` and `structuredClone(src)` give a different map; this fits both starting from an empty object, whose map has 4 in-object slots (§3.3), but that cause was not isolated. `JSON.parse(JSON.stringify(src))` got the same map as `src` here.
- Instances of one class share a map. A class with field declarations (`x = 1`) and a class that assigns the same fields in its constructor give different maps.
- `Object.setPrototypeOf` on one of two identical objects gives it a different map, so the two no longer share inline-cache entries ([v8-hidden-classes.md](v8-hidden-classes.md)). The map records the prototype ✅[^v8-fastprops].
- Adding a property to a prototype object kept it fast.

<details>
<summary>Lab: <code>shapes.mjs</code></summary>

```sh
docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node --allow-natives-syntax shapes.mjs
```

```js
const same = (label, a, b) => console.log(label.padEnd(62), 'same map:', %HaveSameMap(a, b));
const fast = (label, o) => console.log(label.padEnd(62), 'fast:', %HasFastProperties(o));
const make = () => ({ x: 1, y: 2 });
same('two objects from the same literal site', make(), make());
same('{x, y} literals at two different sites', { x: 1, y: 2 }, { x: 3, y: 4 });
same('{x, y} against {y, x}', { x: 1, y: 2 }, { y: 2, x: 1 });
const src = { x: 1, y: 2 };
same('{ ...src } against src', { ...src }, src);
same('Object.assign({}, src) against src', Object.assign({}, src), src);
same('structuredClone(src) against src', structuredClone(src), src);
same('JSON.parse(JSON.stringify(src)) against src', JSON.parse(JSON.stringify(src)), src);
same('{ ...src, z: 3 } against { x, y, z } literal', { ...src, z: 3 }, { x: 1, y: 2, z: 3 });
class A { x = 1; y = 2; }
class B { constructor() { this.x = 1; this.y = 2; } }
same('class with field declarations: two instances', new A(), new A());
same('class A (fields) against class B (constructor) instance', new A(), new B());
const p = { x: 1, y: 2 }; const q = { x: 1, y: 2 };
Object.setPrototypeOf(q, { greet() {} });
same('Object.setPrototypeOf on one of two twins', p, q);
const r = Object.create(null); r.x = 1;
fast('Object.create(null), then r.x = 1', r);
const proto = { m() {} }; const kid1 = Object.create(proto); kid1.x = 1;
proto.extra = 1;                    fast('a prototype after adding a property to it', proto);
const gs = { _v: 1, get v() { return this._v; }, set v(x) { this._v = x; } };
fast('object literal with a getter and a setter', gs);
const dp = { a: 1 }; Object.defineProperty(dp, 'b', { value: 2, writable: false, enumerable: false });
fast('Object.defineProperty(o, "b", non-writable, non-enumerable)', dp);
const dp2 = { a: 1, b: 2 }; Object.defineProperty(dp2, 'a', { get() { return 1; } });
fast('Object.defineProperty turns existing data property a into a getter', dp2);
const fr = Object.freeze({ a: 1, b: 2 }); fast('Object.freeze({a, b})', fr);
same('Object.freeze changes the map', Object.freeze({ a: 1, b: 2 }), { a: 1, b: 2 });
```

Output:

```text
two objects from the same literal site                         same map: true
{x, y} literals at two different sites                         same map: true
{x, y} against {y, x}                                          same map: false
{ ...src } against src                                         same map: true
Object.assign({}, src) against src                             same map: false
structuredClone(src) against src                               same map: false
JSON.parse(JSON.stringify(src)) against src                    same map: true
{ ...src, z: 3 } against { x, y, z } literal                   same map: false
class with field declarations: two instances                   same map: true
class A (fields) against class B (constructor) instance        same map: false
Object.setPrototypeOf on one of two twins                      same map: false
Object.create(null), then r.x = 1                              fast: false
a prototype after adding a property to it                      fast: true
object literal with a getter and a setter                      fast: false
Object.defineProperty(o, "b", non-writable, non-enumerable)    fast: true
Object.defineProperty turns existing data property a into a getter fast: false
Object.freeze({a, b})                                          fast: true
Object.freeze changes the map                                  same map: false
```

</details>

### 3.13 Getters, setters and `Proxy`

A class getter cost the same as a plain property read in the lab, about 0.55 ms per million reads after warm-up ✅[^lab] (measured here), and also on V8 12.4; on V8 14.1 (Node.js 25.7.0) the getter took 0.94 to 1.00 ms against 0.56 to 0.57 ms, and in Electron 43 0.70 to 0.74 ms against 0.56 to 0.63 ms, in five runs each; in Chrome 158, measured here, 0.70 ms against 0.30 to 0.60 ms in the runs where the plain read ran at Turbofan speed (4 of 4 with `--disable-renderer-backgrounding`, the main figure; 3 of 4 in default headless mode; in the others it took 2.4 to 2.5 ms against 1.4 for the getter), with the `Proxy` cases at 9.3 to 10.1 and 14.6 to 15.4 ms ✅[^lab-matrix]; whether the compiler inlines it is covered in [v8-compiler-pipeline-deep-dive.md](v8-compiler-pipeline-deep-dive.md). A `Proxy` is a different object type (`JS_PROXY_TYPE`) ✅[^lab]. Reading `o.a` through one with no traps took about 10 ms per million reads, with a `get` trap about 16 ms ✅[^lab] (measured here). The post of 5 October 2017 reports that porting proxy construction to CodeStubAssembler code (V8 6.3) improved V8's JavaScript performance score for proxy construction by 49 % to 74 % ✅[^v8-proxy]; the post compares only with older V8 and does not say proxies match plain objects, and the lab above shows they do not.

<details>
<summary>Lab: <code>proxytime.mjs</code> (timing: the numbers vary per run)</summary>

```sh
docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node proxytime.mjs
```

```js
// 1,000,000 reads of o.a: plain object, class getter, Proxy with no traps, Proxy with a get trap.
const median = (xs) => xs.sort((a, b) => a - b)[xs.length >> 1];
class G { constructor() { this._a = 1; } get a() { return this._a; } }
const objs = {
  plain: { a: 1 },
  getter: new G(),
  'proxy, no traps': new Proxy({ a: 1 }, {}),
  'proxy, get trap': new Proxy({ a: 1 }, { get: (t, k) => t[k] }),
};
for (const [name, o] of Object.entries(objs)) {
  // a fresh copy of the loop per case, so each one only ever sees one kind of receiver
  const read = new Function('o', 'let s = 0; for (let i = 0; i < 1000000; i++) s += o.a; return s;');
  for (let i = 0; i < 30; i++) read(o);
  const runs = []; for (let r = 0; r < 9; r++) { const t = process.hrtime.bigint(); read(o); runs.push(Number(process.hrtime.bigint() - t)); }
  console.log(`${name.padEnd(16)} ${(median(runs) / 1e6).toFixed(2)} ms per 1,000,000 reads (median of 9 after 30 warm-up calls)`);
}
```

Output:

```text
plain            0.54 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
getter           0.55 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
proxy, no traps  9.55 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
proxy, get trap  15.45 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
```

</details>

## 4. Worked examples

### 4.1 Bytes per element, by representation

**Method.** For each case the script forces two full collections (`--expose-gc`, `gc()` twice), reads `process.memoryUsage().heapUsed` (or `arrayBuffers` for typed arrays), builds and keeps the structure, collects twice again and divides the growth by the element count: 1 000 000 for arrays and strings, 100 000 for the keyed collections ✅[^lab]. A warm-up case runs first and is not counted; repeated runs gave the same values to within about 0.5 byte ✅[^lab].

| Representation | Bytes per element | Electron 43, Node.js 24.22.3 (E9) and Chrome 158 (E10), pointer compression on ✅[^lab-matrix] | Why |
|---|---|---|---|
| Small integers, `new Array(n).fill(0)`, then by index (`PACKED_SMI`) | 8.0 | 4.0 | one tagged word each, no pointer compression |
| Small integers, `push` onto `[]` | 10.4 | 5.2 | the backing store grows in steps and keeps spare capacity |
| Doubles, `PACKED_DOUBLE` | 8.0 | 8.0 | raw 8-byte floats, unboxed |
| Doubles in a `PACKED_ELEMENTS` array (one string in it) | 24.0 | 16.0 | 8-byte pointer + 16-byte heap number per element |
| Small integers in a `PACKED_ELEMENTS` array | 8.0 | 4.0 | still Smis, no boxes |
| `Float64Array` | 8.0 (off-heap) | 8.0 on E9 and in Chrome's `usedJSHeapSize`; not shown in Electron (`arrayBuffers` stays 0) | raw floats in the `ArrayBuffer` |
| `Int32Array` | 4.0 (off-heap) | 4.0 on E9 and in Chrome's `usedJSHeapSize`; not shown in Electron (`arrayBuffers` stays 0) | raw 32-bit integers |
| One-byte string | 1.0 | 1.0 | 1 byte per character |
| Two-byte string | 2.0 | 2.0 | 2 bytes per character |
| Object as dictionary, 100 000 string keys | 62.9 | 31.5 | hash table entry: key, value, details, plus spare capacity |
| `Map`, 100 000 string keys | 36.7 | 18.4 | ordered hash table entry plus bucket and chain |
| `Set`, 100 000 string keys | 26.2 | 13.1 | as `Map`, without the value |
| Object with integer keys 0 to 99 999 (elements) | 9.3 | 4.6 | a holey Smi row, grown in steps |
| `Map` with integer keys 0 to 99 999 | 36.7 to 36.8 | 18.4 | same entry size as with string keys |

Node.js 22.23.4, 24.22.1 (macOS, linux x64) and 25.7.0 gave the values of the second column to within 0.1 byte ✅[^lab-matrix]. In Electron 43 every pointer-sized cost halved and raw data stayed the same, which fits 4-byte slots and a 12-byte heap number. The unofficial Node.js 24.22.3 build with pointer compression on and the sandbox off (E9, V8 13.6) gave the same values as Electron to within 0.1 byte, while the official 24.22.1 build on the same emulated machine gave the second column, so on V8 13.6 with the sandbox off pointer compression is the cause of the halving ✅[^lab-matrix]. A Chrome 158 page (V8 15.8) gave the third column in every row, read through `performance.memory.usedJSHeapSize` after `gc()`; that figure includes `ArrayBuffer` contents, so there the typed arrays show in the heap figure ✅[^lab-matrix].

<details>
<summary>Lab: <code>mem.mjs</code> (memory: may vary by about 0.1 byte or 0.5 MB per run)</summary>

```sh
docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node --expose-gc --allow-natives-syntax mem.mjs
```

```js
// Bytes per element, measured as the heapUsed (or arrayBuffers) growth across forced collections.
// Run with: node --expose-gc --allow-natives-syntax mem.mjs
const N = 1_000_000;
const keep = [];
function measure(label, build, field = 'heapUsed', count = N) {
  globalThis.gc(); globalThis.gc();
  const before = process.memoryUsage()[field];
  const value = build();
  globalThis.gc(); globalThis.gc();
  const after = process.memoryUsage()[field];
  keep.push(value);
  console.log(label.padEnd(58), ((after - before) / count).toFixed(1), 'bytes/element', `(${field})`);
}
measure('warm-up (not counted)', () => { const a = new Array(N).fill(0); for (let i = 0; i < N; i++) a[i] = i; return a; });
measure('small integers, new Array(N).fill(0) then a[i] = i', () => { const a = new Array(N).fill(0); for (let i = 0; i < N; i++) a[i] = i; return a; });
measure('small integers, [] then push(i)', () => { const a = []; for (let i = 0; i < N; i++) a.push(i); return a; });
measure('doubles, new Array(N).fill(0.5) then a[i] = i + 0.5', () => { const a = new Array(N).fill(0.5); for (let i = 0; i < N; i++) a[i] = i + 0.5; return a; });
measure("doubles in a generic array (a[0] = 'x'), a[i] = i + 0.5", () => { const a = new Array(N).fill(0.5); a[0] = 'x'; for (let i = 1; i < N; i++) a[i] = i + 0.5; return a; });
measure('small integers in a generic array (a[0] = "x"), a[i] = i', () => { const a = new Array(N).fill(0); a[0] = 'x'; for (let i = 1; i < N; i++) a[i] = i; return a; });
measure('new Float64Array(N)', () => new Float64Array(N), 'arrayBuffers');
measure('new Int32Array(N)', () => new Int32Array(N), 'arrayBuffers');
measure('one-byte string, N characters (flattened)', () => { const s = 'a'.repeat(N); %FlattenString(s); return s; });
measure('two-byte string, N characters (flattened)', () => { const s = '中'.repeat(N); %FlattenString(s); return s; });
const K = 100_000;
const keys = Array.from({ length: K }, (_, i) => 'key' + i); keys.forEach((k) => { const o = {}; o[k] = 0; }); // internalize keys first
measure('object as dictionary, K string keys (values small ints)', () => { const o = {}; for (const k of keys) o[k] = 1; return o; }, 'heapUsed', K);
measure('Map, K string keys (values small ints)', () => { const m = new Map(); for (const k of keys) m.set(k, 1); return m; }, 'heapUsed', K);
measure('Set, K string keys', () => { const s = new Set(); for (const k of keys) s.add(k); return s; }, 'heapUsed', K);
measure('object, K integer keys 0..K-1 (elements)', () => { const o = {}; for (let i = 0; i < K; i++) o[i] = 1; return o; }, 'heapUsed', K);
measure('Map, K integer keys 0..K-1', () => { const m = new Map(); for (let i = 0; i < K; i++) m.set(i, 1); return m; }, 'heapUsed', K);
```

Output:

```text
warm-up (not counted)                                      8.0 bytes/element (heapUsed)
small integers, new Array(N).fill(0) then a[i] = i         8.0 bytes/element (heapUsed)
small integers, [] then push(i)                            10.4 bytes/element (heapUsed)
doubles, new Array(N).fill(0.5) then a[i] = i + 0.5        8.0 bytes/element (heapUsed)
doubles in a generic array (a[0] = 'x'), a[i] = i + 0.5    24.0 bytes/element (heapUsed)
small integers in a generic array (a[0] = "x"), a[i] = i   8.0 bytes/element (heapUsed)
new Float64Array(N)                                        8.0 bytes/element (arrayBuffers)
new Int32Array(N)                                          4.0 bytes/element (arrayBuffers)
one-byte string, N characters (flattened)                  1.0 bytes/element (heapUsed)
two-byte string, N characters (flattened)                  2.0 bytes/element (heapUsed)
object as dictionary, K string keys (values small ints)    62.9 bytes/element (heapUsed)
Map, K string keys (values small ints)                     36.7 bytes/element (heapUsed)
Set, K string keys                                         26.2 bytes/element (heapUsed)
object, K integer keys 0..K-1 (elements)                   9.2 bytes/element (heapUsed)
Map, K integer keys 0..K-1                                 36.7 bytes/element (heapUsed)
```

</details>

The "why" column is this doc's reading of the numbers, based on §3.1, §3.6, §3.9 and §3.11, not a measurement of each part.

### 4.2 A record type, done two ways

A request log record created as `{ id, ms }` in one literal, with `ms` always a fraction, stays on one map with an in-object Smi field `id` and a Double field `ms` (§3.2, §3.3). The same record built as `const r = {}; r[key] = …` in a loop over a field list, then `delete r.tmp`, is in dictionary mode from the `delete` on (§3.4), costs a hash table per object, and is read through a table search: about seven times slower per read in the §3.4 timing (0.52 to 0.59 ms against 3.9 to 4.2 ms across four runs) ✅[^lab] (measured here); about 2.5 times in Electron 43 ✅[^lab-matrix].

## 5. Reference & invariants

Thresholds in Node.js 24.22.1 / V8 13.6.233.17, from the lab and the source at that tag:

| Item | Value | Source |
|---|---|---|
| Smi range | -2 147 483 648 to 2 147 483 647; -1 073 741 824 to 1 073 741 823 with pointer compression (Electron 43, Node.js 24.22.3 pointer-compression build, Chrome 158) | ✅[^lab] ✅[^lab-matrix] |
| Slot size | 8 bytes (pointer compression off); 4 bytes with it on (Electron 43, Node.js 24.22.3 pointer-compression build, Chrome 158, §4.1) | ✅[^lab] ✅[^lab-matrix] |
| In-object slots of `{}` | 4 | ✅[^lab] ✅[^v8-jsobjects] |
| In-object slots of a literal | its key count | ✅[^lab] |
| Property array growth step | 3 slots | ✅[^v8-jsobjects] ✅[^lab] |
| Slack tracking | used slots + 8, shrunk after 7 constructions | ✅[^v8-slack] ✅[^lab] |
| Dictionary mode by computed keys, from `{}` | 20th key | ✅[^lab] |
| Dictionary mode by named stores or literal keys | 1021st key; for literals, 128th key on V8 14.1 and 15.0 | ✅[^lab] ✅[^lab-matrix] |
| Dictionary mode for `JSON.parse` output | 128 keys | ✅[^lab] |
| `--fast-properties-soft-limit` / `--max-fast-properties` defaults | 12 / 128 | ✅[^lab] |
| Elements gap that switches to dictionary elements | 1024 empty slots | ✅[^lab] ✅[^v8-jsobjects] |
| Largest `new Array(n)` with fast elements | 33 554 432 | ✅[^lab] ✅[^v8-jsarray] |
| Element slots preallocated for an empty array | 4 | ✅[^v8-jsarray] |
| Minimum length of a cons string and a sliced string | 13 characters | ✅[^v8-string] ✅[^lab] |
| Largest typed array kept on the V8 heap | 64 bytes (the default; a build macro can change it) | ✅[^v8-jsab] ✅[^lab] |
| Maximum string length (64-bit) | about 536.8 million characters | ✅[^v8-string] |

Invariants observed in every case tested ✅[^lab]:

- Elements kinds only move down the lattice, except that a whole-array `fill` makes a holey array packed (V8 13.6 to 15.0; not on V8 12.4 ✅[^lab-matrix]).
- Dictionary elements can return to fast elements; holey kinds return to packed only through `fill` (V8 13.6 and later).
- A dictionary-mode object stays slow under reads and writes, and becomes fast only when used as a prototype or copied.
- A field representation only widens, and widening applies to every object of the shape.

## 6. Trade-offs, pitfalls & misconceptions

### 6.1 Corrections: popular advice against this build

| Belief | What the lab or the current source shows (Node.js 24.22.1, V8 13.6, 2026-11-26) |
|---|---|
| "`delete` always makes an object slow." | True in this build for every delete of an existing property, including the last-added one, at the sizes tried (1 to 1000 properties) ✅[^lab]; a delete of a missing property stayed fast ✅[^lab]. It was not always true: V8 up to 11.9 had a fast path that undid the last transition ✅[^v8-delete-old] ✅[^v8-delete-new]. The object comes back to fast mode when it is used as a prototype or copied with spread ✅[^lab]. Chrome 158 (V8 15.8) gave the same answers in every case of `delete.mjs`, `dellast.mjs` and `delete-var.mjs` ✅[^lab-matrix]. |
| "An array that becomes holey stays holey forever." | The 2017 post said so ✅[^v8-elements]. Since its 2025-02-28 update, `fill` is an exception ✅[^v8-elements], and in this build `new Array(n).fill(0)` is `PACKED_SMI` ✅[^lab], as on V8 14.1 and 15.0 and in Chrome 158 (V8 15.8); on V8 12.4 (Node.js 22.23.4) it stays `HOLEY_SMI` ✅[^lab-matrix]. Filling holes by index still leaves it holey ✅[^lab]. |
| "Holey arrays are much slower." | Summing 1 000 000 Smis took under 1 ms whether the array was packed or holey, when no hole was actually left. In the doc's run the holey median was about 11 % above the packed one in each of 3 rounds; in 3 further runs (9 rounds) it was 8 to 11 % above in 8 rounds and 55 % above (1.15 ms against 0.74 ms) in one, so "within about 25 %" is the typical case, not a bound ✅[^lab] (measured here). The same script at 100 000 elements gave 0.08 ms for both, and at 10 000 000 elements 9.1 to 10.5 ms packed against 9.4 to 10.1 ms holey; at 1 000 and 10 000 elements the timer was too coarse to compare ✅[^lab]. The 2017 post says holey operations "require additional checks and expensive lookups on the prototype chain" but that the difference is usually too small to matter ✅[^v8-elements]. A dictionary-mode object, by contrast, was about seven times slower to read (§3.4). Arrays with real holes left in them were not timed. In Chrome 158 (a timer of about 0.1 ms) the holey sum was 0 to 12 % above the packed one with `--disable-renderer-backgrounding` (the main figure) and 0 to 25 % in default headless mode (0.9 to 1.0 ms against 0.8 to 0.9 ms, three runs of 3 rounds each; an earlier first run read 1.4 against 1.2) ✅[^lab-matrix] (measured here). |
| "Never use `new Array(n)`; always use a literal and `push`" (the 2017 post's advice ✅[^v8-elements]) and its opposite, "always preallocate with `new Array(n)`". | Building 1 000 000 Smis took 4.1 to 5.7 ms with `push`, 1.2 to 1.3 ms with `new Array(n)` filled by index and 1.8 to 2.0 ms with `new Array(n).fill(0)` first, in four runs: `push` was 3.3 to 4.3 times slower than the preallocated build ✅[^lab] (measured here); 2.9 to 4.3 times on Node.js 22.23.4 and 25.7.0, 2.2 to 2.9 times in Electron 43 (2.0 to 2.6 ms against 0.78 to 1.19 ms, five runs), and in Chrome 158 2.0 to 3.0 times with `--disable-renderer-backgrounding` (the main figure: 1.8 to 2.4 ms against 0.7 to 0.9 ms, six runs) and 1.4 to 5.2 times in other default headless runs (1.6 to 5.8 ms against 0.7 to 1.4 ms, nine runs, measured here); `push` was slower in every run ✅[^lab-matrix]. The same ratio held at 100 000 elements (0.45 to 0.50 ms against 0.13 ms) and at 10 000 000 (61.8 ms against 13.5 ms, one run); at 1 000 elements every case was 0.00 to 0.02 ms, below what this timer resolves ✅[^lab]. The 2017 post itself says the difference "is usually too small to matter" in real code ✅[^v8-elements]. Preallocation was faster to build and its result is holey, which did not slow the sum above; `push` over-allocates by about 30 % (10.4 against 8.0 bytes per element) ✅[^lab]. Preallocate when you know the length; `fill` first if you want a packed array. Neither "always" holds. |
| "String concatenation in a loop is quadratic." | Not when the string is only flattened once at the end: `+=` builds a rope, and the per-character cost stayed flat from 100 000 to 1 600 000 characters, flattening included (it rose 3 to 5 times by 6 400 000 characters, not quadratically); it is quadratic when the string is read after every append ✅[^lab] (measured here, §3.10). On V8 12.4 the flat range ended at 400 000 characters; Chrome 158 stayed flat to 1 600 000 (2.8 to 6 ns per character with `--disable-renderer-backgrounding`, up to 10 ns in default headless mode, three runs each) and was quadratic when reading after every append ✅[^lab-matrix]. |
| "Objects with more than 128 properties become dictionaries." | Only for some ways of building them: `JSON.parse` switched at 128 keys, computed-key stores at about 20, but named stores, literals and `Object.fromEntries` stayed fast up to 1020 keys ✅[^lab]. On V8 14.1, 15.0 and in Chrome 158 (V8 15.8) literals also switched at 128 keys; the other ways gave the baseline counts in Chrome ✅[^lab-matrix]. |
| "Double fields are stored unboxed in the object." | Not in this build: a Double field points to a 16-byte heap number, 48 bytes against 32 for `{ x }`, and 16 more per extra double field at every size tried (up to 10 fields) ✅[^lab]; with pointer compression on (Electron 43, the Node.js 24.22.3 pointer-compression build, and Chrome 158) the box is 12 bytes, 28 against 16 ✅[^lab-matrix]. The V8 page describes the box under pointer compression ✅[^v8-fields]. Double unboxing was turned off with pointer compression in 2020 ✅[^v8-ptrcomp], and Node.js 24 does not re-enable it even without pointer compression ✅[^lab]. |
| "`%DebugPrint` shows the elements kind only in a debug build of the d8 shell." | The release Node.js 24 build prints the map, its elements kind, the in-object count and each property's location ✅[^lab] (§1.1, §3.2, §3.3), and so do Node.js 22.23.4 and 25.7.0. Electron 43 does not: there `%DebugPrint` prints one short line such as `0x… <HeapNumber 1.5>`, and Electron reports `v8_enable_object_print: 0` ✅[^lab-matrix]. The Node.js 24.22.3 build with pointer compression on prints the full output, so the short form is Electron's build setting, not pointer compression ✅[^lab-matrix]. Deno 2.9.8 (V8 15.0) and Electron 38.8.6 (V8 14.0, `v8_enable_object_print: 0`) print the short form too ✅[^lab-matrix]. Not checked in Chrome: there `%DebugPrint` writes to the renderer's standard output, which headless Chrome does not pass on. |
| "`é` or other accented letters make a string two-byte." | A character above U+00FF does (U+0100 and up); Latin-1 letters such as `é` and `ÿ` (up to U+00FF) stay one-byte ✅[^lab]. A slice of a two-byte parent stays two-byte even when its own characters are all ASCII ✅[^lab] (§3.10). Not checked in Chrome: the script reads `%DebugPrint` output. |

The two timings behind the holey-array and preallocation rows:

<details>
<summary>Lab: <code>holey.mjs</code> (timing: the numbers vary per run; also Chrome 158)</summary>

```sh
docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node --allow-natives-syntax holey.mjs
```

```js
// Sum 1,000,000 small integers: packed array against holey array (same values, no actual holes left).
const median = (xs) => xs.sort((a, b) => a - b)[xs.length >> 1];
const N = 1_000_000;
const packed = []; for (let i = 0; i < N; i++) packed.push(i & 1023);
const holey = []; holey[N - 1] = 0; for (let i = 0; i < N; i++) holey[i] = i & 1023;
const preallocated = new Array(N); for (let i = 0; i < N; i++) preallocated[i] = i & 1023;
console.log('kinds: packed holey?', %HasHoleyElements(packed), '| holey holey?', %HasHoleyElements(holey), '| new Array(N) holey?', %HasHoleyElements(preallocated));
function sumPacked(a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; }
function sumHoley(a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; }  // separate copy: own feedback
function time(f, a) { for (let i = 0; i < 20; i++) f(a); const runs = []; for (let r = 0; r < 9; r++) { const t = process.hrtime.bigint(); f(a); runs.push(Number(process.hrtime.bigint() - t)); } return median(runs) / 1e6; }
for (let round = 0; round < 3; round++) console.log(`round ${round + 1}: packed ${time(sumPacked, packed).toFixed(2)} ms, holey ${time(sumHoley, holey).toFixed(2)} ms (median of 9 after 20 warm-up calls)`);
```

Output:

```text
kinds: packed holey? false | holey holey? true | new Array(N) holey? true
round 1: packed 0.72 ms, holey 0.80 ms (median of 9 after 20 warm-up calls)
round 2: packed 0.72 ms, holey 0.80 ms (median of 9 after 20 warm-up calls)
round 3: packed 0.72 ms, holey 0.80 ms (median of 9 after 20 warm-up calls)
```

On E10 (Chrome 158, §6.3), page variant; changed line 10: `process.hrtime.bigint()` → `BigInt(Math.round(performance.now() * 1e6))` (on E1 the variant gave packed 0.76 to 0.77 ms, holey 0.80 to 0.90 ms). Three runs:

```text
run 1: packed 1.20, 1.20, 1.30 ms; holey 1.40, 1.40, 1.40 ms
runs 2 and 3: packed 0.80 ms, holey 0.90 ms in every round
# re-run on 2026-11-28, with --disable-renderer-backgrounding (three runs, 3 rounds each)
packed 0.80 ms in all 9 rounds; holey 0.90 ms in 7 rounds and 0.80 ms in 2
# re-run on 2026-11-28, default headless (three runs)
runs 1 and 3: packed 0.80 ms, holey 0.80 to 0.90 ms; run 2: packed 1.20 to 1.30 ms, holey 1.30 to 1.40 ms
```

</details>

<details>
<summary>Lab: <code>prealloc.mjs</code> (timing: the numbers vary per run; also Chrome 158)</summary>

```sh
docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node prealloc.mjs
```

```js
// Build an array of N small integers: push onto [] against new Array(N) filled by index.
const median = (xs) => xs.sort((a, b) => a - b)[xs.length >> 1];
function viaPush(n) { const a = []; for (let i = 0; i < n; i++) a.push(i); return a; }
function viaNewArray(n) { const a = new Array(n); for (let i = 0; i < n; i++) a[i] = i; return a; }
function viaFill(n) { const a = new Array(n).fill(0); for (let i = 0; i < n; i++) a[i] = i; return a; }
function time(f, n) { for (let i = 0; i < 10; i++) f(n); const runs = []; for (let r = 0; r < 9; r++) { const t = process.hrtime.bigint(); f(n); runs.push(Number(process.hrtime.bigint() - t)); } return (median(runs) / 1e6).toFixed(2); }
for (const n of [1_000, 100_000, 1_000_000]) console.log(`n = ${String(n).padStart(9)}: push ${time(viaPush, n)} ms, new Array(n) ${time(viaNewArray, n)} ms, new Array(n).fill(0) ${time(viaFill, n)} ms (median of 9)`);
```

Output:

```text
n =      1000: push 0.01 ms, new Array(n) 0.00 ms, new Array(n).fill(0) 0.01 ms (median of 9)
n =    100000: push 0.45 ms, new Array(n) 0.13 ms, new Array(n).fill(0) 0.19 ms (median of 9)
n =   1000000: push 4.13 ms, new Array(n) 1.24 ms, new Array(n).fill(0) 1.84 ms (median of 9)
```

On E10 (Chrome 158, §6.3), page variant; changed line 6: `process.hrtime.bigint()` → `BigInt(Math.round(performance.now() * 1e6))` (on E1 the variant gave 5.33, 1.30 and 1.77 ms at 1 000 000). Three runs at n = 1 000 000 in default headless mode, then three with `--disable-renderer-backgrounding` (the main figure):

```text
push 5.80, 1.80, 5.70 ms | new Array(n) 1.20, 0.80, 1.20 ms | new Array(n).fill(0) 1.30, 0.90, 1.30 ms
# re-run on 2026-11-28, default headless
push 5.70, 1.60, 1.80 ms | new Array(n) 1.10, 0.70, 0.70 ms | new Array(n).fill(0) 1.30, 0.90, 0.90 ms
# re-run on 2026-11-28, with --disable-renderer-backgrounding
push 1.90, 2.20, 1.80 ms | new Array(n) 0.70, 0.90, 0.70 ms | new Array(n).fill(0) 0.80, 1.00, 0.90 ms
```

</details>

### 6.2 Pitfalls

- **Literal getters are slow objects.** `{ get v() {…} }` is in dictionary mode from the start ✅[^lab]. Put accessors on a class prototype, or add them with `Object.defineProperty`.
- **Computed keys in constructors.** A constructor that loops over a field list with `this[name] = …` produces dictionary-mode instances after about 20 fields from an empty literal, 26 from an instance of an empty class ✅[^lab] (the count depends on how many in-object slots the object starts with, §3.4).
- **A `JSON.parse` result with 128 or more keys is a dictionary** ✅[^lab]; a `Map` is cheaper per entry for large lookup tables (§4.1) ✅[^lab].
- **Small slices of big strings.** A slice of 13 characters or more keeps its parent alive ✅[^lab] ✅[^v8-string]; copy it when the parent is large and the slice lives long.
- **One stray value changes the whole array.** One string in a double array makes every later double a 24-byte box ✅[^lab] (16 bytes with pointer compression ✅[^lab-matrix]); one `NaN` or `-0` makes a Smi array a double array ✅[^lab] ✅[^v8-elements].
- **`Object.assign({}, x)` does not copy the shape**, `{ ...x }` does ✅[^lab]. When many copies flow into the same hot function, this decides how many shapes it sees ([v8-hidden-classes.md](v8-hidden-classes.md)).
- **Natives are for experiments.** `%HasFastProperties` and the like work only with `--allow-natives-syntax`; this doc uses them in the lab, never in application code.

### 6.3 Other builds and versions (2026-11-27)

Every lab script above was re-run on 2026-11-27 on six more builds and then in Google Chrome itself (E10), all on one Apple M-series Mac; two more builds (E6, E8) ran only the scripts of the differences that E9 left to Electron 43 ✅[^lab-matrix]. E0 is the baseline the rest of this doc reports.

| Id | Build | What differs from the baseline |
|---|---|---|
| E0 | Node.js 24.22.1, V8 13.6.233.17-node.58, image `node:24.22.1-alpine`, linux arm64 | the baseline; pointer compression off |
| E1 | Node.js 24.22.1, same V8, macOS 26.1 arm64 (the host) | operating system |
| E2 | Node.js 24.22.1, same V8, image `node:24.22.1-alpine-amd64`, linux x64 | CPU architecture, emulated on arm64: timing scripts not run |
| E3 | Node.js 22.23.4, V8 12.4.254.21-node.57, macOS arm64 | older V8 |
| E4 | Node.js 25.7.0, V8 14.1.146.11-node.20, macOS arm64 | newer V8, pointer compression still off |
| E7 | Electron 43.7.7 run as Node (`ELECTRON_RUN_AS_NODE=1`, Visual Studio Code's binary), Node.js 24.21.0 API, V8 15.0.245.31-electron.0, macOS arm64 | pointer compression on, V8 sandbox on, `v8_enable_object_print: 0`, newest V8 |
| E9 | Node.js 24.22.3, V8 13.6.233.17-node.63, the Node.js project's unofficial build `node-v24.22.3-linux-x64-pointer-compression`, in a Debian 13 container, linux x64 | pointer compression **on**, sandbox off; differs from E2 in that one way; emulated like E2, so timing scripts not run |
| E6 | Deno 2.9.8, V8 15.0.245.2, image `denoland/deno:alpine-2.9.8`, linux arm64 (native) | V8 15.0 without the sandbox and without pointer compression, not Electron; narrowing runs only |
| E8 | Electron 38.8.6 run as Node (Postman's binary), Node.js 22.22.0 API, V8 14.0.365.10-electron.0, macOS arm64 | pointer compression on, sandbox on, `v8_enable_object_print: 0`, Electron, but V8 14.0; narrowing runs only |
| E10 | Google Chrome 158.0.8127.89, V8 15.8.62.31, macOS 26.1 arm64, headless, each script inlined in a `file://` page | a browser: pointer compression on (31-bit small integers, 4,192 MiB `jsHeapSizeLimit`), no Node.js API, V8's own printed output not readable |

A difference seen only in E7 can come from pointer compression, the sandbox, the build settings or V8 15.0. E9 separates pointer compression: where E9 shows what E7 showed and E2 the baseline, pointer compression is the cause; where E9 shows the baseline, it is not. Where no run separates the rest, the text says "cause not isolated". E2 and E9 both default to `--no-turbofan` under emulation, so `delete-var.mjs`, which asks for an optimized function, was also run with `--turbofan` on both (same output as the doc). Timings ran three times per build (five where they differed), with other labs running on the machine.

E10 runs Chrome as `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --user-data-dir=<an empty folder> --enable-precise-memory-info --js-flags="<V8 flags>" --virtual-time-budget=120000 --dump-dom file://<page>`, with no extensions; the page holds the script inline (as a module script for `.mjs` files), its `console.log` lines are collected into a `<pre>` element of the page, and they are read from the dumped page. A script that uses a Node.js measurement call ran as a page variant that changes only that call: `process.hrtime.bigint()` becomes `BigInt(Math.round(performance.now() * 1e6))` (the same nanosecond unit), `process.memoryUsage().heapUsed` becomes `performance.memory.usedJSHeapSize` (read after `gc()`), `process.argv` values become constants and `process.config` lines are removed; each variant also ran on E1, where it falls back to the Node.js call, and gave the baseline result there. Chrome's `performance.now()` is real time in steps of about 0.1 ms, so its sub-millisecond medians are coarse. On V8 15.8 the bits of `%GetOptimizationStatus` mean what they mean on V8 14.1, one place lower than on V8 13.6: bit 3 optimized, 4 Maglev, 5 Turbofan, 6 interpreted, 14 baseline, 17 never compiled (bits 4, 5, 6, 7, 15 and 18 on V8 13.6); each was checked on V8 15.8 with functions forced into one state (`%OptimizeFunctionOnNextCall`, `%OptimizeMaglevOnNextCall`, a function never called, a function called once), and three runs of the probe below gave identical lines ✅[^lab-matrix]. A status read after a timed loop describes the function's own code, not the on-stack-replacement code a long loop may have run in: a loop that ran in 0.6 ms read 16385 (bit 14, baseline) afterwards, so the timings below are told apart by their speed as well as by the status.

**Efficiency mode (timing).** In default headless Chrome 158 the page's V8 is often in efficiency mode: hot functions stay in Maglev and do not reach Turbofan. It varies from run to run: in 6 default runs of the `dicttime.mjs` variant, 4 ran at Turbofan speed (fast read 0.6 ms, dictionary read 1.4 ms) and 2 at Maglev speed (2.4 to 2.5 and 2.6 ms, statuses 65 and 25); three more default runs on 2026-11-28 were all at Turbofan speed (fast read 0.4 to 0.6 ms, dictionary read 1.4 ms). With the Chrome flag `--disable-renderer-backgrounding` (not a V8 flag) all runs measured here (3 + 3) were at Turbofan speed, so the timings below give that figure as the main one and the default headless figure labelled; a visible (non-headless) window was run only for scripts of the compiler deep dive (`v8-compiler-pipeline-deep-dive.md`, §6.2, §4.2 and §6.4: a probe and four of its scripts), where the page in the front tab reached Turbofan in every run like the flagged run, and a probe in a hidden tab, a minimized window or a covered window stayed in Maglev in every run; this doc's own scripts were not run in a visible window. A ratio from a Maglev-only run is a Maglev ratio and is not averaged with the others. Byte counts, `%IsSmi`, shapes and the heap limit do not depend on the tier.

<details>
<summary>Matrix: E10 set-up probes: natives, heap limit and optimization-status bits in Chrome 158</summary>

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --user-data-dir=<an empty folder> --enable-precise-memory-info \
  --js-flags="--allow-natives-syntax --expose-gc" --virtual-time-budget=120000 --dump-dom file://<page holding natives.js, then optstatus.js>
```

```js
// natives.js: calls each native of §1.2 once (a native that does not exist is a SyntaxError for the whole page), then prints the heap limit.
const calls = {
  IsSmi: () => %IsSmi(1), HaveSameMap: () => %HaveSameMap({ a: 1 }, { a: 2 }), HasFastProperties: () => %HasFastProperties({ a: 1 }),
  HasSmiElements: () => %HasSmiElements([1, 2, 3]), HasDoubleElements: () => %HasDoubleElements([1.5]),
  HasObjectElements: () => %HasObjectElements(['x']), HasHoleyElements: () => %HasHoleyElements([1, , 3]),
  HasDictionaryElements: () => %HasDictionaryElements([1, 2, 3]), HasFixedFloat64Elements: () => %HasFixedFloat64Elements(new Float64Array(2)),
  StringIsFlat: () => %StringIsFlat('ab'), FlattenString: () => %FlattenString('a' + 'b'.repeat(20)).length,
  IsInternalizedString: () => %IsInternalizedString('ab'), DebugPrint: () => %DebugPrint(1),
  NeverOptimizeFunction: () => %NeverOptimizeFunction(function f() {}),
  OptimizeFunctionOnNextCall: () => { function g() {} %PrepareFunctionForOptimization(g); g(); %OptimizeFunctionOnNextCall(g); g(); },
  OptimizeMaglevOnNextCall: () => { function h() {} %PrepareFunctionForOptimization(h); h(); %OptimizeMaglevOnNextCall(h); h(); },
};
let threw = 0; for (const [k, f] of Object.entries(calls)) { try { console.log('%' + k, f()); } catch (e) { threw++; console.log('%' + k, 'THREW', e.message); } }
console.log('natives that threw:', threw, 'of', Object.keys(calls).length);
console.log('performance.memory.jsHeapSizeLimit MiB:', performance.memory.jsHeapSizeLimit / 2 ** 20);
console.log('gc is', typeof gc);
```

```js
// optstatus.js
const bits = (f) => { const s = %GetOptimizationStatus(f); const on = []; for (let i = 0; i < 31; i++) if (s & (1 << i)) on.push(i); return `${s} bits [${on.join(',')}]`; };
function lazy(a, b) { return a + b; }  function interp(a, b) { return a + b; }  function never(a, b) { return a + b; }
function tf(a, b) { return a + b; }    function mg(a, b) { return a + b; }      function de(a, b) { return a + b; }
console.log('never called (lazy)           ', bits(lazy));
interp(1, 2); console.log('called once (interpreted)     ', bits(interp));
%NeverOptimizeFunction(never); never(1, 2); console.log('NeverOptimizeFunction         ', bits(never));
%PrepareFunctionForOptimization(tf); tf(1, 2); tf(3, 4); %OptimizeFunctionOnNextCall(tf); tf(5, 6); console.log('OptimizeFunctionOnNextCall    ', bits(tf));
%PrepareFunctionForOptimization(mg); mg(1, 2); mg(3, 4); %OptimizeMaglevOnNextCall(mg); mg(5, 6); console.log('OptimizeMaglevOnNextCall      ', bits(mg));
%PrepareFunctionForOptimization(de); de(1, 2); de(3, 4); %OptimizeFunctionOnNextCall(de); de(5, 6); de('x', {}); console.log('Turbofan, then called with a string (deopt)', bits(de));
```

Output:

```text
# natives.js: none of the sixteen natives the script calls (the thirteen of §1.2 and three optimization natives) threw, and the query natives returned values (for example %HasHoleyElements([1, , 3]) true, %StringIsFlat("ab") true); the last lines of its output:
natives that threw: 0 of 16
performance.memory.jsHeapSizeLimit MiB: 4192
gc is function
# optstatus.js on E10 (Node.js 25.7.0, V8 14.1, prints the same; Node.js 24.22.1, V8 13.6, prints 262145 [0,18], 129 [0,7], 129, 81 [0,4,6], 49 [0,4,5], 129)
never called (lazy)            131073 bits [0,17]
called once (interpreted)      65 bits [0,6]
NeverOptimizeFunction          65 bits [0,6]
OptimizeFunctionOnNextCall     41 bits [0,3,5]
OptimizeMaglevOnNextCall       25 bits [0,3,4]
Turbofan, then called with a string (deopt) 65 bits [0,6]
```

</details>

| Script: claim | E1 | E2 | E3 | E4 | E7 | E9 | E10 |
|---|---|---|---|---|---|---|---|
| `debugprint.mjs`: `%DebugPrint` kinds of values | same | same | same | same | cannot run | same | cannot run |
| `flags.mjs`: flags and defaults | same | same | same | same | same | same | cannot run |
| `silent.mjs`: tracing flags stay silent | same | same | differs | same | differs | same | cannot run |
| `values.mjs`: Smi range, build flags | same | same | same | same | differs | differs | differs (page variant) |
| `gen.mjs`: field generalization trace | same | same | same | same | same | same | cannot run |
| `fields.mjs`: double field is a HeapNumber pointer | same | same | same | same | cannot run | same | cannot run |
| `fieldmem.mjs`: 16-byte box per double field | same | same | same | same | differs | differs | differs (page variant) |
| `fieldmem-var.mjs`: box size at more sizes | same | same | same | same | differs | differs | differs (page variant) |
| `inobject.mjs`: in-object slots, slack tracking | same | same | same | same | cannot run | same | cannot run |
| `dicttime.mjs`: dictionary reads slower | same | not run | same | same | differs | not run | differs (page variant) |
| `delete.mjs`: `delete` makes slow; ways back | same | same | same | same | same | same | same |
| `dellast.mjs`: last-property delete | same | same | same | same | same | same | same |
| `delete-var.mjs`: delete variations | same | same | same | same | same | same | same |
| `limits.mjs`: dictionary thresholds | same | same | same | differs | differs | same | differs |
| `limits2.mjs`: JSON.parse 128, fromEntries 1021 | same | same | same | same | same | same | same |
| `soft.mjs`: computed keys: 20 | same | same | same | same | same | same | same |
| `soft.mjs (--fast-properties-soft-limit=40)`: soft limit 40: 47 | same | same | same | same | same | same | same |
| `limits-var.mjs`: threshold variations | same | same | same | differs | differs | same | differs |
| `acc.mjs`: accessors and fast mode | same | same | same | same | same | same | same |
| `intkeys.mjs`: integer-like keys | same | same | same | same | same | same | same |
| `kinds.mjs`: elements-kinds lattice | same | same | differs | same | differs | same | differs |
| `fill.mjs`: `fill` makes packed | same | same | differs | same | same | same | same |
| `fill-var.mjs`: `fill` variations | same | same | differs | same | differs | same | differs |
| `sparse.mjs`: dictionary elements | same | same | same | same | same | same | same |
| `typed.mjs`: typed arrays on heap up to 64 bytes | same | same | same | same | differs | same | cannot run |
| `strtype.mjs`: string representations | same | same | cannot run | same | cannot run | same | cannot run |
| `twobyte.mjs`: one-byte / two-byte boundary | same | same | same | same | cannot run | same | cannot run |
| `slice-keep.mjs`: slice keeps 10 MB parent | same | same | same | same | same | same | same (page variant) |
| `concat.mjs`: `+=` not quadratic | same | not run | differs | same | same | not run | same (page variant) |
| `concat-var.mjs`: larger sizes, read after append | same | not run | differs | same | differs | not run | differs (page variant) |
| `shapes.mjs`: shared maps | same | same | same | same | same | same | same |
| `proxytime.mjs`: getter = plain; Proxy slower | same | not run | same | differs | differs | not run | differs (page variant) |
| `mem.mjs`: bytes per element | same | same | same | same | differs | differs | differs (page variant) |
| `holey.mjs`: holey sum within about 25 % | same | not run | same | same | same | not run | same (page variant) |
| `prealloc.mjs`: push slower than preallocated | same | not run | same | same | differs | not run | same (page variant) |

Totals: 35 runs of 34 scripts on 7 builds, 245 cells: 180 same, 38 differs, 15 cannot run, 12 not run (the timing scripts on E2 and E9). The E9 column alone: 29 run, 25 same, 4 differs, 0 cannot run, 6 not run. The E10 column alone: 15 same (4 of them page variants), 11 differs (7 page variants), 9 cannot run, 0 not run; timing scripts three times each, and `dicttime.mjs`, `proxytime.mjs` and `concat-var.mjs` again where the runs disagreed (six, six and five runs).

"Cannot run" means: in E7 `%DebugPrint` prints one short line (`0x… <HeapNumber 1.5>`), which fits the `v8_enable_object_print: 0` that Electron reports, so the fields `debugprint.mjs`, `fields.mjs`, `inobject.mjs`, `strtype.mjs` and `twobyte.mjs` read are absent (the other lines of `strtype.mjs` matched); on E9, which has pointer compression on and reports `v8_enable_object_print: 1`, all five ran and matched the doc (for example `{}` has 4 in-object slots there too), so the short form is Electron's build setting; in E3 the native `%StringIsFlat` does not exist (`SyntaxError: StringIsFlat is not defined`), and a copy of `strtype.mjs` without those two calls matched the doc in every other line. "Same" for memory scripts means within the 0.1 byte or 0.5 MB the doc allows, except one line: `fieldmem-var.mjs` gave 32.1 bytes for `{x:i}` on every build, and on E0 again (three more runs on 2026-11-28); the first output of 2026-11-26 had 27.9, which was noise in that run, and §3.2 now quotes 32.1. `slice-keep.mjs` gave a baseline of 3.7 MB on E0 in four runs on 2026-11-28 (4.2 on 2026-11-26; the growth of 10 MB and the later lines did not change), and on E7 and E9 a baseline of 2.2 MB, 12.2 and 12.5 MB while holding the slice and 2.2 and 2.5 MB after dropping it, in three runs each: the start-up heap is about 1.5 to 2 MB smaller with pointer compression on, and the 10 MB held by the slice is the same. `debugprint.mjs` and `fields.mjs` on E3 and E4 print a few more or fewer words on some lines (`[HeapNumber] in OldSpace`; no `attrs: [WEC]) @ Any` on E3); the fields the doc reads are the same. On E10, "cannot run" means: `debugprint.mjs`, `fields.mjs`, `inobject.mjs`, `strtype.mjs` and `twobyte.mjs` read `%DebugPrint` output, and `silent.mjs` and `gen.mjs` read V8's trace output, which goes to the renderer's standard output and is not passed on by headless Chrome (their own `console.log` lines matched, and so did the `%HaveSameMap` lines of `fields.mjs` and the flat and internalized lines of `strtype.mjs`); `flags.mjs` needs `node:child_process`; `typed.mjs` needs `process.memoryUsage().arrayBuffers`, for which a page has no counterpart (its other five lines matched).

What differs:

- **Smi range** (§3.1): -2³¹ to 2³¹ - 1 on E0 to E4; -2³⁰ to 2³⁰ - 1 on E7 and E9, where `2 ** 30`, `2 ** 31 - 1` and `-(2 ** 31)` are not Smis. E7 also reports `v8_enable_31bit_smis_on_64bit_arch: 0`; E9 reports `1`.
- **Tracing flags** (§1.2): two startup transitions printed on E0 and E9, one on E3, none on E7; nothing for the script's own changes anywhere. E9 matches the baseline, so E7's silence is not pointer compression; E8 (Electron 38.8.6) is silent too, so it is common to the two Electron builds.
- **Object and double-field sizes** (§3.2): `{ x }` 32 bytes with an integer and 48 with a double on E0 to E4; 16 and 28 on E7 and E9 (12-byte box). E9 shows what E7 showed and E2 the baseline: pointer compression is the cause (isolated on V8 13.6, the same Node.js 24 line, sandbox off).
- **Object literal threshold** (§3.4, §5, §6.1): dictionary mode from 1021 keys on V8 12.4 and 13.6; from 128 keys on V8 14.1 (E4) and 15.0 (E7). E4 has pointer compression off, so the change came with V8 14.1 or earlier, not with compression. Named stores, `Object.fromEntries` (1021) and `JSON.parse` (128) did not change.
- **`fill` exception** (§3.6, §3.7, §5, §6.1): whole-array `fill` makes a holey array packed on V8 13.6, 14.1 and 15.0; on V8 12.4 (E3) every `fill` left it holey.
- **`undefined` in arrays** (§3.6, §3.7): `[1, undefined, 3]`, `Array.from({ length: 3 })` and `new Array(5).fill(undefined)` are `PACKED_ELEMENTS` on E0 to E4 and E9 and `HOLEY_DOUBLE` on E7. E9 shows the baseline, so pointer compression is not the cause; E6 (Deno, V8 15.0, no sandbox) shows E7's result and E8 (Electron, V8 14.0) the baseline, so it comes with the V8 version: seen on V8 15.0 in Deno 2.9.8 and Electron 43.7.7, and on V8 15.8 in Chrome 158, not on V8 12.4 to 14.1.
- **Typed-array counter** (§3.9): `arrayBuffers` stays 0 on E7; the bytes appear in `external`, with the same 64-byte boundary. E9 counts them in `arrayBuffers` like the baseline, so pointer compression is not the cause; E8 shows what E7 showed, so it is not V8 15.0 alone but common to the two Electron builds (sandbox on, Electron's build), cause not isolated between those two; E6 cannot settle it (Deno's own `process.memoryUsage()`).
- **Bytes per element** (§3.11, §4.1): every pointer-sized cost about halves on E7 and E9 (Smi array 4.0, `Map` 18.4); double arrays and strings do not change. E9 matches E7 to within 0.1 byte and E2 the baseline: pointer compression is the cause.
- **Dictionary-mode reads** (§3.4, §4.2): about 7 times slower than a fast object on E0, E1 and E3 and about 9 times on E4; about 2.5 times on E7 (1.41 ms against 0.57 ms) and 2.3 to 3.2 times on E6 (Deno, V8 15.0), against about 9 times on E8 (Electron 38.8.6, V8 14.0), so the smaller gap comes with V8 15.0 in the two embedders run; about 2 to 5 times in Chrome 158 (V8 15.8) at Turbofan speed (main figure, with `--disable-renderer-backgrounding`; in default headless runs that stayed in Maglev, about equal). Every timing in this list is measured here: three runs each, with other labs running on the machine.
- **String building** (§3.10, §6.1): flat cost per character from 100 000 to 1 600 000 characters on E0, E1, E4 and E7; on E3 flat only to 400 000, then 31 to 56 ns. In `concat-var.mjs` the later rise starts at 1 600 000 on E3 and is 7 to 10 times on E7, against 3 to 5 times on E0. Reading after every append was quadratic everywhere.
- **Getter cost** (§3.13): same as a plain read on E0, E1 and E3; 1.7 times on E4 and about 1.25 times on E7. The `Proxy` timings matched everywhere.
- **`push` against preallocation** (§6.1): 3.3 to 4.3 times slower on E0; 2.2 to 2.9 times on E7. The order held everywhere.

Narrowing runs: E6 and E8 (the differences that E9 left to Electron 43; same commands as for E7, with `deno run -A --v8-flags=<flags>` on E6):

| Difference | E6: Deno 2.9.8, V8 15.0, no sandbox, no compression | E8: Electron 38.8.6, V8 14.0, sandbox and compression on | What it shows |
|---|---|---|---|
| `undefined` in arrays (`kinds.mjs`, `fill-var.mjs`) | E7's result: `HOLEY_DOUBLE_ELEMENTS` | baseline: `PACKED_ELEMENTS` | comes with the V8 version: seen on V8 15.0 in two embedders (and on V8 15.8 in Chrome), not on V8 14.0 or 14.1 |
| Typed-array counter (`typed.mjs`, `typed-external.mjs`) | not comparable: `arrayBuffers` 0, and `external` counts the 64-byte arrays too (63.1, 65.0, 64.0, 72.0), from Deno's own `process.memoryUsage()` | E7's result: `arrayBuffers` 0; `external` 0, 65, 0, 72 | one run (E8): common to the two Electron builds; pointer compression ruled out by E9 |
| Tracing flags silent (`silent.mjs`) | not comparable: no Node.js startup code; nothing for the script | E7's result: no startup lines | one run (E8): common to the two Electron builds |
| Short `%DebugPrint` (`debugprint.mjs` and the four scripts that read it) | short form: cannot run | short form, `v8_enable_object_print: 0`: cannot run | seen on V8 14.0 and 15.0 builds of Deno and Electron (three builds), not on Node.js 22.23.4, 24.22.1, 24.22.3 or 25.7.0 |
| Dictionary-mode reads (`dicttime.mjs`, three runs) | E7's result: 1.33 to 1.73 ms against 0.54 to 0.58 (six runs) | baseline: 4.72 to 4.74 ms against 0.53 to 0.55 | comes with the V8 version: seen on V8 15.0 in two embedders, not on V8 14.0 or 14.1 |

What Chrome 158 does differently from the baseline (E10, Chrome 158.0.8127.89, V8 15.8):

- Smi range -2³⁰ to 2³⁰ - 1, as on E7 and E9 (`values.mjs`, `smi.js`).
- Object and double-field sizes and bytes per element as on E9: `{ x }` 16 and 28 bytes, Smi array 4.0, `Map` 18.4 (`fieldmem.mjs`, `fieldmem-var.mjs`, `mem.mjs`); in these runs the page's `usedJSHeapSize` also included typed-array contents (cause not examined).
- Object literals in dictionary mode from 128 keys, as on V8 14.1 and 15.0 (`limits.mjs`, `limits-var.mjs`).
- `[1, undefined, 3]`, `Array.from({ length: 3 })` and `fill(undefined)` are `HOLEY_DOUBLE`, as on V8 15.0 (`kinds.mjs`, `fill-var.mjs`).
- Dictionary-mode reads about 2 to 5 times a fast read, not 7 (`dicttime.mjs`, Turbofan speed with `--disable-renderer-backgrounding`; in default headless runs that stayed in Maglev both cases took 2.4 to 2.7 ms); a class getter 0.70 ms against 0.30 to 0.60 ms for a plain read (`proxytime.mjs`); the flatten-once cost rose about 4 to 9 times by 12 800 000 characters (`concat-var.mjs`; in default headless runs it was already 36 to 43 ns at 1 600 000 characters in five of six runs), not 3 to 5. All measured here, three or more runs each.

Could not be checked in Chrome: 9 of 35 scripts (5 read `%DebugPrint` output, 2 read V8's trace output, 1 needs `node:child_process`, 1 needs `process.memoryUsage().arrayBuffers`).

<details>
<summary>Matrix: <code>values.mjs</code> on E7, E9, E2 and E10</summary>

```sh
ELECTRON_RUN_AS_NODE=1 "/Applications/Visual Studio Code.app/Contents/MacOS/Code" --allow-natives-syntax values.mjs
```

Output:

```text
0                      Smi: true
-0                     Smi: false
2**30                  Smi: false
2**31 - 1              Smi: false
2**31                  Smi: false
-(2**31)               Smi: false
-(2**31) - 1           Smi: false
1.5                    Smi: false
NaN                    Smi: false
3.0                    Smi: true
2**53                  Smi: false
pointer compression: 1 | 31-bit Smis on 64-bit: 0
```

On E9 and E2 (the same flags):

```sh
node --allow-natives-syntax values.mjs   # E9, in the linux/amd64 Debian 13 container with the unofficial build, --network none
docker run --rm --network none --platform linux/amd64 -v "$PWD:/work" -w /work node:24.22.1-alpine-amd64 node --allow-natives-syntax values.mjs   # E2
```

```text
# E9
0                      Smi: true
-0                     Smi: false
2**30                  Smi: false
2**31 - 1              Smi: false
2**31                  Smi: false
-(2**31)               Smi: false
-(2**31) - 1           Smi: false
1.5                    Smi: false
NaN                    Smi: false
3.0                    Smi: true
2**53                  Smi: false
pointer compression: 1 | 31-bit Smis on 64-bit: 1
# E2: the baseline output above, including
2**30                  Smi: true
pointer compression: 0 | 31-bit Smis on 64-bit: 0
```

On E10 (Chrome 158), page variant: lines 5 and 6 (`process.config`, a Node.js API) removed; the other eleven lines match E7 and E9 (E1 ran the variant and gave the baseline's eleven lines):

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --user-data-dir=<an empty folder> --enable-precise-memory-info --js-flags="--allow-natives-syntax" --virtual-time-budget=120000 --dump-dom file://<page holding values.page.js>
```

```text
# E10
2**30                  Smi: false
2**31 - 1              Smi: false
-(2**31)               Smi: false
(the other eight lines as on E7)
```

</details>

<details>
<summary>Matrix: <code>silent.mjs</code> on E3, E7, E9 and E8</summary>

```sh
~/.nvm/versions/node/v22.23.4/bin/node --trace-normalization --trace-elements-transitions silent.mjs | sed -E 's/0x[0-9a-f]{6,}/0x…/g'
ELECTRON_RUN_AS_NODE=1 "/Applications/Visual Studio Code.app/Contents/MacOS/Code" --trace-normalization --trace-elements-transitions silent.mjs | sed -E 's/0x[0-9a-f]{6,}/0x…/g'
```

Output:

```text
# E3
elements transition [PACKED_SMI_ELEMENTS -> PACKED_ELEMENTS] in from+1888 at <unknown>:<unknown> for 0x… <JSArray[0]> from 0x… <FixedArray[17]> to 0x… <FixedArray[17]>
before delete o.b
after delete o.b
before push(4.5), push('x')
after push(4.5), push('x')
# E7
before delete o.b
after delete o.b
before push(4.5), push('x')
after push(4.5), push('x')
```

On E9 the output was byte for byte the baseline output in §1.2, two startup transition lines included (E2 too), so only its first line is shown:

```sh
node --trace-normalization --trace-elements-transitions silent.mjs | sed -E 's/0x[0-9a-f]{6,}/0x…/g'   # E9, in the linux/amd64 Debian 13 container with the unofficial build, --network none
```

```text
elements transition [PACKED_SMI_ELEMENTS -> PACKED_ELEMENTS] in from+0 at <unknown>:<unknown> for 0x… <JSArray[0]> from 0x… <FixedArray[17]> to 0x… <FixedArray[17]>
(and a second identical line, then the four script lines)
```

On E8 (Electron 38.8.6 as Node, `ELECTRON_RUN_AS_NODE=1 "/Applications/Postman.app/Contents/MacOS/Postman" --trace-normalization --trace-elements-transitions silent.mjs`) the output was E7's four script lines and no startup line. On E6 (Deno) it was the same four lines; Deno runs no Node.js startup code, so the missing startup lines say nothing there.

</details>

<details>
<summary>Matrix: <code>fieldmem.mjs</code> and <code>fieldmem-var.mjs</code> on E7, E9, E2 and E10</summary>

```sh
ELECTRON_RUN_AS_NODE=1 "/Applications/Visual Studio Code.app/Contents/MacOS/Code" --expose-gc fieldmem.mjs
ELECTRON_RUN_AS_NODE=1 "/Applications/Visual Studio Code.app/Contents/MacOS/Code" --expose-gc fieldmem-var.mjs
```

The scripts count or subtract an 8-byte list slot; with pointer compression the slot is 4 bytes.

Output:

```text
warm-up (not counted)                    20.1 bytes per object (8 of them are the list slot)
{ x: i } (small integer field)           20.0 bytes per object (8 of them are the list slot)
{ x: i + 0.5 } (double field)            32.0 bytes per object (8 of them are the list slot)
{ x: i, y: i } (two small integers)      24.0 bytes per object (8 of them are the list slot)
{ x: i + 0.5, y: i + 0.5 } (two doubles) 48.0 bytes per object (8 of them are the list slot)
warm-up                                      12.1 bytes per object (list slot subtracted)
{x:i}                                        12.1 bytes per object (list slot subtracted)
{x:i+.5}                                     24.0 bytes per object (list slot subtracted)
{a..e: 5 ints}                               28.0 bytes per object (list slot subtracted)
{a..e: 5 doubles}                            88.0 bytes per object (list slot subtracted)
{a..j: 10 ints}                              48.2 bytes per object (list slot subtracted)
{a..j: 10 doubles}                           168.0 bytes per object (list slot subtracted)
class P, 2 ints (after slack tracking)       16.0 bytes per object (list slot subtracted)
class Q, 2 doubles (after slack tracking)    40.0 bytes per object (list slot subtracted)
{x: 2**31} (above Smi, integer-valued double) 24.0 bytes per object (list slot subtracted)
```

On E9 and E2 (the same flags; on E9 the list slot is 4 bytes, as on E7):

```sh
node --expose-gc fieldmem.mjs   # E9, in the linux/amd64 Debian 13 container with the unofficial build, --network none
node --expose-gc fieldmem-var.mjs   # E9, in the linux/amd64 Debian 13 container with the unofficial build, --network none
docker run --rm --network none --platform linux/amd64 -v "$PWD:/work" -w /work node:24.22.1-alpine-amd64 node --expose-gc fieldmem.mjs   # E2
docker run --rm --network none --platform linux/amd64 -v "$PWD:/work" -w /work node:24.22.1-alpine-amd64 node --expose-gc fieldmem-var.mjs   # E2
```

```text
# E9
warm-up (not counted)                    20.0 bytes per object (8 of them are the list slot)
{ x: i } (small integer field)           20.1 bytes per object (8 of them are the list slot)
{ x: i + 0.5 } (double field)            32.1 bytes per object (8 of them are the list slot)
{ x: i, y: i } (two small integers)      24.0 bytes per object (8 of them are the list slot)
{ x: i + 0.5, y: i + 0.5 } (two doubles) 48.0 bytes per object (8 of them are the list slot)
warm-up                                      12.0 bytes per object (list slot subtracted)
{x:i}                                        12.1 bytes per object (list slot subtracted)
{x:i+.5}                                     24.0 bytes per object (list slot subtracted)
{a..e: 5 ints}                               28.0 bytes per object (list slot subtracted)
{a..e: 5 doubles}                            88.0 bytes per object (list slot subtracted)
{a..j: 10 ints}                              48.1 bytes per object (list slot subtracted)
{a..j: 10 doubles}                           168.2 bytes per object (list slot subtracted)
class P, 2 ints (after slack tracking)       16.0 bytes per object (list slot subtracted)
class Q, 2 doubles (after slack tracking)    40.0 bytes per object (list slot subtracted)
{x: 2**31} (above Smi, integer-valued double) 24.0 bytes per object (list slot subtracted)
# E2
warm-up (not counted)                    40.0 bytes per object (8 of them are the list slot)
{ x: i } (small integer field)           40.1 bytes per object (8 of them are the list slot)
{ x: i + 0.5 } (double field)            56.0 bytes per object (8 of them are the list slot)
{ x: i, y: i } (two small integers)      48.1 bytes per object (8 of them are the list slot)
{ x: i + 0.5, y: i + 0.5 } (two doubles) 80.0 bytes per object (8 of them are the list slot)
warm-up                                      32.1 bytes per object (list slot subtracted)
{x:i}                                        32.1 bytes per object (list slot subtracted)
{x:i+.5}                                     48.1 bytes per object (list slot subtracted)
{a..e: 5 ints}                               64.0 bytes per object (list slot subtracted)
{a..e: 5 doubles}                            144.1 bytes per object (list slot subtracted)
{a..j: 10 ints}                              104.1 bytes per object (list slot subtracted)
{a..j: 10 doubles}                           264.1 bytes per object (list slot subtracted)
class P, 2 ints (after slack tracking)       40.0 bytes per object (list slot subtracted)
class Q, 2 doubles (after slack tracking)    72.0 bytes per object (list slot subtracted)
{x: 2**31} (above Smi, integer-valued double) 48.0 bytes per object (list slot subtracted)
```

On E10 (Chrome 158), page variants; changed lines: `fieldmem.mjs` lines 4 and 6, `fieldmem-var.mjs` lines 3 and 5: `process.memoryUsage().heapUsed` → `(globalThis.performance?.memory ? performance.memory.usedJSHeapSize : process.memoryUsage().heapUsed)`. On E1 the variants gave the baseline (40.1, 56.0, 48.1, 80.1; 32.1, 48.0, 64.1, 144.0, 104.2, 264.0, 40.0, 72.0, 48.0).

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --user-data-dir=<an empty folder> --enable-precise-memory-info --js-flags="--expose-gc" --virtual-time-budget=120000 --dump-dom file://<page holding fieldmem.page.js>
```

```text
# fieldmem.page.js E10
warm-up (not counted)                    20.0 bytes per object (8 of them are the list slot)
{ x: i } (small integer field)           20.0 bytes per object (8 of them are the list slot)
{ x: i + 0.5 } (double field)            32.1 bytes per object (8 of them are the list slot)
{ x: i, y: i } (two small integers)      24.0 bytes per object (8 of them are the list slot)
{ x: i + 0.5, y: i + 0.5 } (two doubles) 48.0 bytes per object (8 of them are the list slot)
# fieldmem-var.page.js E10 (list slot of 8 subtracted, as in the script)
{x:i} 12.0 | {x:i+.5} 24.0 | 5 ints 28.0 | 5 doubles 88.0 | 10 ints 48.0 | 10 doubles 168.1 | class P 16.0 | class Q 40.0 | {x: 2**31} 24.0
```

</details>

<details>
<summary>Matrix: <code>limits.mjs</code>, <code>limits-var.mjs</code> and the probe <code>litprobe.mjs</code> on E4, E7 and E10</summary>

```sh
~/.nvm/versions/node/v25.7.0/bin/node --allow-natives-syntax limits.mjs
ELECTRON_RUN_AS_NODE=1 "/Applications/Visual Studio Code.app/Contents/MacOS/Code" --allow-natives-syntax limits.mjs
~/.nvm/versions/node/v25.7.0/bin/node --allow-natives-syntax limits-var.mjs
ELECTRON_RUN_AS_NODE=1 "/Applications/Visual Studio Code.app/Contents/MacOS/Code" --allow-natives-syntax limits-var.mjs
~/.nvm/versions/node/v25.7.0/bin/node --allow-natives-syntax litprobe.mjs   # also on E1, E3, E7
```

The probe `litprobe.mjs`:

```js
// First object-literal key count that gives a dictionary-mode object.
const lit = (c) => new Function(`return {${Array.from({ length: c }, (_, i) => `k${i}: ${i}`).join(',')}}`)();
let first = 'never (1100)'; for (let c = 1; c <= 1100; c++) if (!%HasFastProperties(lit(c))) { first = c; break; }
console.log('object literal, first key count in dictionary mode:', first);
for (const c of [127, 128, 129, 130]) console.log(`literal ${c} keys: fast`, %HasFastProperties(lit(c)));
```

Output:

```text
# limits.mjs E4 (E7 identical)
computed key, o["k" + i] = i       : 20
named stores o.kN = N,   20 props : fast: true
named stores o.kN = N,  128 props : fast: true
named stores o.kN = N,  129 props : fast: true
named stores o.kN = N,  200 props : fast: true
named stores o.kN = N, 1020 props : fast: true
named stores o.kN = N, 1021 props : fast: false
object literal, 200 keys              : fast: false
object literal, 1020 keys              : fast: false
object literal, 1021 keys              : fast: false
2000 integer keys o[i] = i           : fast properties: true | dictionary elements: false
2000 keys "id" + i                   : fast properties: false
JSON.parse of a 200-key object       : fast: false
Object.fromEntries, 200 keys         : fast: true
# limits-var.mjs E4 (E7 identical)
literal with 0 keys, then computed keys: added until slow = 20
literal with 1 keys, then computed keys: added until slow = 16
literal with 3 keys, then computed keys: added until slow = 16
literal with 10 keys, then computed keys: added until slow = 16
literal with 30 keys, then computed keys: added until slow = 34
literal with 100 keys, then computed keys: added until slow = 103
literal with 300 keys, then computed keys: added until slow = 1
instance of empty class, computed keys: 26
Object.create({}) , computed keys: 20
{} , Symbol-free named via Reflect.set: 20
{} , Object.defineProperty data props: 1021
named stores 1019: fast true
named stores 1020: fast true
named stores 1021: fast false
named stores 1022: fast false
named stores 2000: fast false
10-key literal + 1010 named stores (1020 total): fast true
10-key literal + 1011 named stores (1021 total): fast false
literal 1019 keys: fast false
literal 1020 keys: fast false
literal 1021 keys: fast false
literal 1022 keys: fast false
JSON.parse 126 Smi-valued keys: fast true
JSON.parse 127 Smi-valued keys: fast true
JSON.parse 128 Smi-valued keys: fast false
JSON.parse 129 Smi-valued keys: fast false
JSON.parse 200 Smi-valued keys: fast false
JSON.parse 128 string-valued keys: fast false
JSON.parse 128 nested {} values: fast false
JSON.parse 100 keys: fast true
JSON.parse nested 200-key inner object: outer fast true inner fast false
JSON.parse array of 3 x 200-key objects: each fast false,false,false
JSON.parse reviver, 128 keys: fast false
# litprobe.mjs
== E1
object literal, first key count in dictionary mode: 1021
literal 127 keys: fast true
literal 128 keys: fast true
literal 129 keys: fast true
literal 130 keys: fast true
== E3
object literal, first key count in dictionary mode: 1021
literal 127 keys: fast true
literal 128 keys: fast true
literal 129 keys: fast true
literal 130 keys: fast true
== E4
object literal, first key count in dictionary mode: 128
literal 127 keys: fast true
literal 128 keys: fast false
literal 129 keys: fast false
literal 130 keys: fast false
== E7
object literal, first key count in dictionary mode: 128
literal 127 keys: fast true
literal 128 keys: fast false
literal 129 keys: fast false
literal 130 keys: fast false
```

On E10 (Chrome 158, the scripts unchanged, `--js-flags="--allow-natives-syntax"`) all three outputs were identical to E4's, including `object literal, first key count in dictionary mode: 128`.

</details>

<details>
<summary>Matrix: <code>kinds.mjs</code> on E3, E7, E9, E2, E6, E8 and E10</summary>

```sh
~/.nvm/versions/node/v22.23.4/bin/node --allow-natives-syntax kinds.mjs
ELECTRON_RUN_AS_NODE=1 "/Applications/Visual Studio Code.app/Contents/MacOS/Code" --allow-natives-syntax kinds.mjs
```

Output:

```text
# E3
[1, 2, 3]                                    PACKED_SMI_ELEMENTS
push(4.5)                                    PACKED_DOUBLE_ELEMENTS
push('x')                                    PACKED_ELEMENTS
pop twice (only small integers left)         PACKED_ELEMENTS
length = 0                                   PACKED_ELEMENTS
then push(1)                                 PACKED_ELEMENTS
[1, 2, 3], then b[5] = 6                     HOLEY_SMI_ELEMENTS
fill the holes b[3], b[4]                    HOLEY_SMI_ELEMENTS
[1, -0]                                      PACKED_DOUBLE_ELEMENTS
[1, NaN]                                     PACKED_DOUBLE_ELEMENTS
[1, Infinity]                                PACKED_DOUBLE_ELEMENTS
[1, 2 ** 31]                                 PACKED_DOUBLE_ELEMENTS
[]                                           PACKED_SMI_ELEMENTS
new Array(3)                                 HOLEY_SMI_ELEMENTS
new Array(3).fill(0)                         HOLEY_SMI_ELEMENTS
Array(3).fill(1.5)                           HOLEY_DOUBLE_ELEMENTS
Array.from({ length: 3 }, (_, i) => i)       PACKED_SMI_ELEMENTS
Array.from({ length: 3 })                    PACKED_ELEMENTS
Array.of(1, 2, 3)                            PACKED_SMI_ELEMENTS
[...new Array(3)]                            PACKED_ELEMENTS
new Array(3).map(x => 0)                     HOLEY_SMI_ELEMENTS
[] then push 0, 1, 2                         PACKED_SMI_ELEMENTS
[] then d[i] = i for i = 0..2                PACKED_SMI_ELEMENTS
[] then e[2], e[1], e[0] (backwards)         HOLEY_SMI_ELEMENTS
[1, , 3] (hole in the literal)               HOLEY_SMI_ELEMENTS
[1, undefined, 3]                            PACKED_ELEMENTS
[1, 2, 3].map(x => x * 1.5)                  PACKED_DOUBLE_ELEMENTS
[1.5, 2.5].map(x => Math.round(x))           PACKED_SMI_ELEMENTS
[1, 2, 3].filter(x => x > 1)                 PACKED_SMI_ELEMENTS
[1, 2, 3].slice()                            PACKED_SMI_ELEMENTS
[...[1, , 3]] (spread of holey)              PACKED_ELEMENTS
[1.5, 2.5].concat([1])                       PACKED_DOUBLE_ELEMENTS
'a,b'.split(',')                             PACKED_ELEMENTS
# E7
[1, 2, 3]                                    PACKED_SMI_ELEMENTS
push(4.5)                                    PACKED_DOUBLE_ELEMENTS
push('x')                                    PACKED_ELEMENTS
pop twice (only small integers left)         PACKED_ELEMENTS
length = 0                                   PACKED_ELEMENTS
then push(1)                                 PACKED_ELEMENTS
[1, 2, 3], then b[5] = 6                     HOLEY_SMI_ELEMENTS
fill the holes b[3], b[4]                    HOLEY_SMI_ELEMENTS
[1, -0]                                      PACKED_DOUBLE_ELEMENTS
[1, NaN]                                     PACKED_DOUBLE_ELEMENTS
[1, Infinity]                                PACKED_DOUBLE_ELEMENTS
[1, 2 ** 31]                                 PACKED_DOUBLE_ELEMENTS
[]                                           PACKED_SMI_ELEMENTS
new Array(3)                                 HOLEY_SMI_ELEMENTS
new Array(3).fill(0)                         PACKED_SMI_ELEMENTS
Array(3).fill(1.5)                           PACKED_DOUBLE_ELEMENTS
Array.from({ length: 3 }, (_, i) => i)       PACKED_SMI_ELEMENTS
Array.from({ length: 3 })                    HOLEY_DOUBLE_ELEMENTS
Array.of(1, 2, 3)                            PACKED_SMI_ELEMENTS
[...new Array(3)]                            PACKED_ELEMENTS
new Array(3).map(x => 0)                     HOLEY_SMI_ELEMENTS
[] then push 0, 1, 2                         PACKED_SMI_ELEMENTS
[] then d[i] = i for i = 0..2                PACKED_SMI_ELEMENTS
[] then e[2], e[1], e[0] (backwards)         HOLEY_SMI_ELEMENTS
[1, , 3] (hole in the literal)               HOLEY_SMI_ELEMENTS
[1, undefined, 3]                            HOLEY_DOUBLE_ELEMENTS
[1, 2, 3].map(x => x * 1.5)                  PACKED_DOUBLE_ELEMENTS
[1.5, 2.5].map(x => Math.round(x))           PACKED_SMI_ELEMENTS
[1, 2, 3].filter(x => x > 1)                 PACKED_SMI_ELEMENTS
[1, 2, 3].slice()                            PACKED_SMI_ELEMENTS
[...[1, , 3]] (spread of holey)              PACKED_ELEMENTS
[1.5, 2.5].concat([1])                       PACKED_DOUBLE_ELEMENTS
'a,b'.split(',')                             PACKED_ELEMENTS
```

On E9 and E2 every line matched the doc; the lines that differ on E7:

```sh
node --allow-natives-syntax kinds.mjs   # E9, in the linux/amd64 Debian 13 container with the unofficial build, --network none
docker run --rm --network none --platform linux/amd64 -v "$PWD:/work" -w /work node:24.22.1-alpine-amd64 node --allow-natives-syntax kinds.mjs   # E2
```

```text
# E9
Array.from({ length: 3 })                    PACKED_ELEMENTS
[1, undefined, 3]                            PACKED_ELEMENTS
# E2
Array.from({ length: 3 })                    PACKED_ELEMENTS
[1, undefined, 3]                            PACKED_ELEMENTS
```

On E6 (Deno 2.9.8: `deno run -A --v8-flags=--allow-natives-syntax kinds.mjs`) and E10 (Chrome 158, the script unchanged), the lines that differ from the doc are E7's two; on E8 (Electron 38.8.6) every line matched the doc:

```text
# E6 and E10
Array.from({ length: 3 })                    HOLEY_DOUBLE_ELEMENTS
[1, undefined, 3]                            HOLEY_DOUBLE_ELEMENTS
# E8
Array.from({ length: 3 })                    PACKED_ELEMENTS
[1, undefined, 3]                            PACKED_ELEMENTS
```

</details>

<details>
<summary>Matrix: <code>fill.mjs</code> and <code>fill-var.mjs</code> on E3, <code>fill-var.mjs</code> on E7, E9, E2, E6, E8 and E10</summary>

```sh
~/.nvm/versions/node/v22.23.4/bin/node --allow-natives-syntax fill.mjs
~/.nvm/versions/node/v22.23.4/bin/node --allow-natives-syntax fill-var.mjs
ELECTRON_RUN_AS_NODE=1 "/Applications/Visual Studio Code.app/Contents/MacOS/Code" --allow-natives-syntax fill-var.mjs
```

Output:

```text
# fill.mjs E3
new Array(3): HOLEY_SMI_ELEMENTS -> fill(0): HOLEY_SMI_ELEMENTS (same array: true)
new Array(1000): HOLEY_SMI_ELEMENTS -> fill(0): HOLEY_SMI_ELEMENTS (same array: true)
new Array(100000): HOLEY_SMI_ELEMENTS -> fill(0): HOLEY_SMI_ELEMENTS (same array: true)
new Array(10).fill(0, 0, 9) (last slot left empty): HOLEY_SMI_ELEMENTS
new Array(10), then q[i] = 0 for every i     : HOLEY_SMI_ELEMENTS
[1, , 3].fill(7) (holey literal)              : HOLEY_SMI_ELEMENTS
new Array(1e6)                                 : HOLEY_SMI_ELEMENTS
new Array(1e6).fill(0)                         : HOLEY_SMI_ELEMENTS
# fill-var.mjs E3
new Array(0).fill(0)           HOLEY_SMI -> HOLEY_SMI
new Array(1).fill(0)           HOLEY_SMI -> HOLEY_SMI
new Array(2).fill(0)           HOLEY_SMI -> HOLEY_SMI
new Array(16).fill(0)          HOLEY_SMI -> HOLEY_SMI
new Array(17).fill(0)          HOLEY_SMI -> HOLEY_SMI
new Array(100).fill(0)         HOLEY_SMI -> HOLEY_SMI
new Array(1025).fill(0)        HOLEY_SMI -> HOLEY_SMI
new Array(5000000).fill(0)     HOLEY_SMI -> HOLEY_SMI
new Array(10000000).fill(0)    HOLEY_SMI -> HOLEY_SMI
new Array(5).fill(1.5)                               HOLEY_DOUBLE
new Array(5).fill('x')                               HOLEY_OBJ
new Array(5).fill({})                                HOLEY_OBJ
new Array(5).fill(undefined)                         HOLEY_OBJ
new Array(5).fill(0, 0)                              HOLEY_SMI
new Array(5).fill(0, 0, 5)                           HOLEY_SMI
new Array(5).fill(0, 1)                              HOLEY_SMI
new Array(5).fill(0, -5)                             HOLEY_SMI
new Array(5).fill(0, 0, 100) (end clamped)           HOLEY_SMI
[] length=5 fill(0)                                  HOLEY_SMI
[1,2,3], a[10]=1, fill(0)                            HOLEY_SMI
holey double literal fill                            HOLEY_DOUBLE
holey object literal fill                            HOLEY_OBJ
fill all but last                                    HOLEY_SMI
fill all but first                                   HOLEY_SMI
2000, fill all but last                              HOLEY_SMI
after fill, length=10                                HOLEY_SMI
after fill, push                                     HOLEY_SMI
new Array(5), a[10]=1 (len 11), fill                 HOLEY_SMI
# fill-var.mjs E7
new Array(0).fill(0)           HOLEY_SMI -> HOLEY_SMI
new Array(1).fill(0)           HOLEY_SMI -> PACKED_SMI
new Array(2).fill(0)           HOLEY_SMI -> PACKED_SMI
new Array(16).fill(0)          HOLEY_SMI -> PACKED_SMI
new Array(17).fill(0)          HOLEY_SMI -> PACKED_SMI
new Array(100).fill(0)         HOLEY_SMI -> PACKED_SMI
new Array(1025).fill(0)        HOLEY_SMI -> PACKED_SMI
new Array(5000000).fill(0)     HOLEY_SMI -> PACKED_SMI
new Array(10000000).fill(0)    HOLEY_SMI -> PACKED_SMI
new Array(5).fill(1.5)                               PACKED_DOUBLE
new Array(5).fill('x')                               PACKED_OBJ
new Array(5).fill({})                                PACKED_OBJ
new Array(5).fill(undefined)                         HOLEY_DOUBLE
new Array(5).fill(0, 0)                              PACKED_SMI
new Array(5).fill(0, 0, 5)                           PACKED_SMI
new Array(5).fill(0, 1)                              HOLEY_SMI
new Array(5).fill(0, -5)                             PACKED_SMI
new Array(5).fill(0, 0, 100) (end clamped)           PACKED_SMI
[] length=5 fill(0)                                  PACKED_SMI
[1,2,3], a[10]=1, fill(0)                            PACKED_SMI
holey double literal fill                            PACKED_DOUBLE
holey object literal fill                            PACKED_OBJ
fill all but last                                    HOLEY_SMI
fill all but first                                   HOLEY_SMI
2000, fill all but last                              HOLEY_SMI
after fill, length=10                                HOLEY_SMI
after fill, push                                     PACKED_SMI
new Array(5), a[10]=1 (len 11), fill                 PACKED_SMI
```

On E9 and E2 every line of `fill-var.mjs` matched the doc; the line that differs on E7:

```sh
node --allow-natives-syntax fill-var.mjs   # E9, in the linux/amd64 Debian 13 container with the unofficial build, --network none
docker run --rm --network none --platform linux/amd64 -v "$PWD:/work" -w /work node:24.22.1-alpine-amd64 node --allow-natives-syntax fill-var.mjs   # E2
```

```text
# E9
new Array(5).fill(undefined)                         PACKED_OBJ
# E2
new Array(5).fill(undefined)                         PACKED_OBJ
```

On E6 and E10 `fill-var.mjs` gave E7's line, on E8 the doc's (`fill.mjs` matched the doc on E10):

```text
# E6 and E10
new Array(5).fill(undefined)                         HOLEY_DOUBLE
# E8
new Array(5).fill(undefined)                         PACKED_OBJ
```

</details>

<details>
<summary>Matrix: <code>typed.mjs</code> on E7, E9, E2, E6 and E8, <code>typed-external.mjs</code> (the same script reading <code>external</code>), and the heap figure in Chrome</summary>

```sh
ELECTRON_RUN_AS_NODE=1 "/Applications/Visual Studio Code.app/Contents/MacOS/Code" --expose-gc --allow-natives-syntax typed.mjs
ELECTRON_RUN_AS_NODE=1 "/Applications/Visual Studio Code.app/Contents/MacOS/Code" --expose-gc --allow-natives-syntax typed-external.mjs
```

Output:

```text
# typed.mjs E7
new Uint8Array(64)             off-heap bytes per array: 0.0
new Uint8Array(65)             off-heap bytes per array: 0.0
new Float64Array(8)            off-heap bytes per array: 0.0
new Float64Array(9)            off-heap bytes per array: 0.0
Float64Array elements kind is FLOAT64: true
write past the end, f[5] = 1 -> f.length: 2 | f[5]: undefined
f[0] = 'abc' stores: NaN
Int8Array: i8[0] = 300 stores: 44
Uint8ClampedArray: c8[0] = 300 stores: 255
# typed-external.mjs E7 (E1 gives the same four lines)
new Uint8Array(64)             external bytes per array: 0.0
new Uint8Array(65)             external bytes per array: 65.0
new Float64Array(8)            external bytes per array: 0.0
new Float64Array(9)            external bytes per array: 72.0
Float64Array elements kind is FLOAT64: true
write past the end, f[5] = 1 -> f.length: 2 | f[5]: undefined
f[0] = 'abc' stores: NaN
Int8Array: i8[0] = 300 stores: 44
Uint8ClampedArray: c8[0] = 300 stores: 255
```

On E9 the output was byte for byte the doc's output in §3.9 (E2 too), so it is not repeated; its first off-heap line, the one that reads 0 on E7:

```sh
node --expose-gc --allow-natives-syntax typed.mjs   # E9, in the linux/amd64 Debian 13 container with the unofficial build, --network none
```

```text
new Uint8Array(65)             off-heap bytes per array: 65.0
```

On E8 (Electron 38.8.6) both scripts printed E7's lines. On E6 (Deno 2.9.8) `typed.mjs` printed 0.0 four times too, but `typed-external.mjs` printed 63.1, 65.0, 64.0 and 72.0, so Deno's own `process.memoryUsage()` counts even the 64-byte arrays in `external` and cannot be compared. In a page there is no `arrayBuffers`; the probe `abprobe.js` shows that Chrome's `usedJSHeapSize` counts `ArrayBuffer` contents while `heapUsed` does not:

```js
// abprobe.js: does the heap figure count ArrayBuffer contents? Run with --expose-gc.
const used = () => (globalThis.performance?.memory ? performance.memory.usedJSHeapSize : process.memoryUsage().heapUsed);
gc(); gc(); let b = used(); const big = new ArrayBuffer(100_000_000); new Uint8Array(big).fill(1); gc(); gc();
console.log('ArrayBuffer(100,000,000): heap figure grew by', ((used() - b) / 1e6).toFixed(1), 'MB');
```

```text
# E10 (Chrome 158)
ArrayBuffer(100,000,000): heap figure grew by 100.0 MB
# E1 (Node.js 24.22.1) and E8 (Electron 38.8.6)
ArrayBuffer(100,000,000): heap figure grew by -0.0 MB
```

</details>

<details>
<summary>Matrix: <code>mem.mjs</code> on E7, E9, E2 and E10</summary>

```sh
ELECTRON_RUN_AS_NODE=1 "/Applications/Visual Studio Code.app/Contents/MacOS/Code" --expose-gc --allow-natives-syntax mem.mjs
```

Output:

```text
warm-up (not counted)                                      4.0 bytes/element (heapUsed)
small integers, new Array(N).fill(0) then a[i] = i         4.0 bytes/element (heapUsed)
small integers, [] then push(i)                            5.2 bytes/element (heapUsed)
doubles, new Array(N).fill(0.5) then a[i] = i + 0.5        8.0 bytes/element (heapUsed)
doubles in a generic array (a[0] = 'x'), a[i] = i + 0.5    16.0 bytes/element (heapUsed)
small integers in a generic array (a[0] = "x"), a[i] = i   4.0 bytes/element (heapUsed)
new Float64Array(N)                                        0.0 bytes/element (arrayBuffers)
new Int32Array(N)                                          0.0 bytes/element (arrayBuffers)
one-byte string, N characters (flattened)                  1.0 bytes/element (heapUsed)
two-byte string, N characters (flattened)                  2.0 bytes/element (heapUsed)
object as dictionary, K string keys (values small ints)    31.5 bytes/element (heapUsed)
Map, K string keys (values small ints)                     18.4 bytes/element (heapUsed)
Set, K string keys                                         13.1 bytes/element (heapUsed)
object, K integer keys 0..K-1 (elements)                   4.6 bytes/element (heapUsed)
Map, K integer keys 0..K-1                                 18.4 bytes/element (heapUsed)
```

On E9 and E2 (the same flags):

```sh
node --expose-gc --allow-natives-syntax mem.mjs   # E9, in the linux/amd64 Debian 13 container with the unofficial build, --network none
docker run --rm --network none --platform linux/amd64 -v "$PWD:/work" -w /work node:24.22.1-alpine-amd64 node --expose-gc --allow-natives-syntax mem.mjs   # E2
```

```text
# E9
warm-up (not counted)                                      4.0 bytes/element (heapUsed)
small integers, new Array(N).fill(0) then a[i] = i         4.0 bytes/element (heapUsed)
small integers, [] then push(i)                            5.2 bytes/element (heapUsed)
doubles, new Array(N).fill(0.5) then a[i] = i + 0.5        8.0 bytes/element (heapUsed)
doubles in a generic array (a[0] = 'x'), a[i] = i + 0.5    16.0 bytes/element (heapUsed)
small integers in a generic array (a[0] = "x"), a[i] = i   4.0 bytes/element (heapUsed)
new Float64Array(N)                                        8.0 bytes/element (arrayBuffers)
new Int32Array(N)                                          4.0 bytes/element (arrayBuffers)
one-byte string, N characters (flattened)                  1.0 bytes/element (heapUsed)
two-byte string, N characters (flattened)                  2.0 bytes/element (heapUsed)
object as dictionary, K string keys (values small ints)    31.5 bytes/element (heapUsed)
Map, K string keys (values small ints)                     18.4 bytes/element (heapUsed)
Set, K string keys                                         13.1 bytes/element (heapUsed)
object, K integer keys 0..K-1 (elements)                   4.6 bytes/element (heapUsed)
Map, K integer keys 0..K-1                                 18.4 bytes/element (heapUsed)
# E2
warm-up (not counted)                                      8.0 bytes/element (heapUsed)
small integers, new Array(N).fill(0) then a[i] = i         8.0 bytes/element (heapUsed)
small integers, [] then push(i)                            10.4 bytes/element (heapUsed)
doubles, new Array(N).fill(0.5) then a[i] = i + 0.5        8.0 bytes/element (heapUsed)
doubles in a generic array (a[0] = 'x'), a[i] = i + 0.5    24.0 bytes/element (heapUsed)
small integers in a generic array (a[0] = "x"), a[i] = i   8.0 bytes/element (heapUsed)
new Float64Array(N)                                        8.0 bytes/element (arrayBuffers)
new Int32Array(N)                                          4.0 bytes/element (arrayBuffers)
one-byte string, N characters (flattened)                  1.0 bytes/element (heapUsed)
two-byte string, N characters (flattened)                  2.0 bytes/element (heapUsed)
object as dictionary, K string keys (values small ints)    63.0 bytes/element (heapUsed)
Map, K string keys (values small ints)                     36.7 bytes/element (heapUsed)
Set, K string keys                                         26.2 bytes/element (heapUsed)
object, K integer keys 0..K-1 (elements)                   9.3 bytes/element (heapUsed)
Map, K integer keys 0..K-1                                 36.7 bytes/element (heapUsed)
```

On E10 (Chrome 158), page variant; changed lines 7 and 10: `process.memoryUsage()[field]` → `(globalThis.performance?.memory ? performance.memory.usedJSHeapSize : process.memoryUsage()[field])`. On E1 the variant gave the doc's values to within 0.1 byte. In Chrome every row equals E9's; the two typed-array rows read `usedJSHeapSize` there (the label still says `arrayBuffers`):

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --user-data-dir=<an empty folder> --enable-precise-memory-info --js-flags="--expose-gc --allow-natives-syntax" --virtual-time-budget=120000 --dump-dom file://<page holding mem.page.js>
```

```text
# E10, bytes per element in the order of the script
4.0 (warm-up) | 4.0 | 5.2 | 8.0 | 16.0 | 4.0 | 8.0 | 4.0 | 1.0 | 2.0 | 31.5 | 18.4 | 13.1 | 4.6 | 18.4
```

</details>

<details>
<summary>Matrix: <code>dicttime.mjs</code> on E7, E6, E8 and E10 (timing)</summary>

```sh
ELECTRON_RUN_AS_NODE=1 "/Applications/Visual Studio Code.app/Contents/MacOS/Code" --allow-natives-syntax dicttime.mjs
```

Output:

```text
# run 1
fast object fast: true | deleted-from object fast: false
fast object      0.57 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
dictionary-mode  1.41 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
# run 2
fast object fast: true | deleted-from object fast: false
fast object      0.56 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
dictionary-mode  1.41 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
# run 3
fast object fast: true | deleted-from object fast: false
fast object      0.56 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
dictionary-mode  1.41 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
# run 4
fast object fast: true | deleted-from object fast: false
fast object      0.57 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
dictionary-mode  1.41 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
# run 5
fast object fast: true | deleted-from object fast: false
fast object      0.57 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
dictionary-mode  1.41 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
```

On E6 (Deno 2.9.8) and E8 (Electron 38.8.6), three runs each, the two timed lines:

```text
# E6: fast object 0.56, 0.54, 0.54 ms; dictionary-mode 1.73, 1.33, 1.37 ms (review re-run: 0.58, 0.56, 0.55 and 1.43, 1.34, 1.34)
# E8: fast object 0.55, 0.53, 0.53 ms; dictionary-mode 4.72, 4.74, 4.73 ms (review re-run: 0.54, 0.55, 0.55 and 4.88, 4.76, 4.80)
```

On E10 (Chrome 158), page variant; changed line 9: `process.hrtime.bigint()` → `BigInt(Math.round(performance.now() * 1e6))` (on E1 the variant gave 0.49 and 4.02 ms). Nine runs in default headless mode, six more with `%GetOptimizationStatus(read)` printed after the timing (41: Turbofan, 25: Maglev, 65: interpreted, 16385: baseline; see the note on bits in §6.3), and in a review re-run six default and six runs with `--disable-renderer-backgrounding` (all six at Turbofan speed: fast 0.3 to 0.6 ms, dictionary-mode 1.3 to 1.4 ms):

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --user-data-dir=<an empty folder> --enable-precise-memory-info --js-flags="--allow-natives-syntax" --virtual-time-budget=120000 --dump-dom file://<page holding dicttime.page.js>
```

```text
# runs at Turbofan speed (status 41 for the dictionary case; the fast case read 41 or 16385): fast 0.30 to 0.60 ms, dictionary-mode 1.30 to 1.50 ms
fast object      0.40 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
dictionary-mode  1.40 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
# the other runs, default headless only (efficiency mode; status 65 and 25): fast 2.40 to 2.50 ms, dictionary-mode 2.50 to 2.70 ms
fast object      2.40 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
dictionary-mode  2.50 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
```

</details>

<details>
<summary>Matrix: <code>concat.mjs</code> on E3 and E10 (timing)</summary>

```sh
~/.nvm/versions/node/v22.23.4/bin/node concat.mjs
```

Output:

```text
# run 1
n =    100000: median 10.4 ns per character (7 runs)
n =    200000: median 12.9 ns per character (7 runs)
n =    400000: median 10.4 ns per character (7 runs)
n =    800000: median 35.8 ns per character (7 runs)
n =   1600000: median 46.5 ns per character (7 runs)
# run 2
n =    100000: median 12.7 ns per character (7 runs)
n =    200000: median 22.3 ns per character (7 runs)
n =    400000: median 18.7 ns per character (7 runs)
n =    800000: median 47.3 ns per character (7 runs)
n =   1600000: median 55.7 ns per character (7 runs)
# run 3
n =    100000: median 9.4 ns per character (7 runs)
n =    200000: median 11.8 ns per character (7 runs)
n =    400000: median 9.6 ns per character (7 runs)
n =    800000: median 30.8 ns per character (7 runs)
n =   1600000: median 35.1 ns per character (7 runs)
# run 4
n =    100000: median 12.0 ns per character (7 runs)
n =    200000: median 14.1 ns per character (7 runs)
n =    400000: median 10.0 ns per character (7 runs)
n =    800000: median 33.1 ns per character (7 runs)
n =   1600000: median 37.4 ns per character (7 runs)
# run 5
n =    100000: median 9.7 ns per character (7 runs)
n =    200000: median 12.4 ns per character (7 runs)
n =    400000: median 10.0 ns per character (7 runs)
n =    800000: median 32.8 ns per character (7 runs)
n =   1600000: median 40.7 ns per character (7 runs)
```

On E10 (Chrome 158), page variant; changed line 7: `process.hrtime.bigint()` → `BigInt(Math.round(performance.now() * 1e6))` (on E1 the variant gave 6.3 to 11.9 ns). Three runs with `--disable-renderer-backgrounding` and three in default headless mode, ns per character at 100 000 / 200 000 / 400 000 / 800 000 / 1 600 000 characters:

```text
# with --disable-renderer-backgrounding
run 1: 4.0 / 3.0 / 3.5 / 3.5 / 3.4
run 2: 3.0 / 6.0 / 2.8 / 3.5 / 5.3
run 3: 5.0 / 3.0 / 4.5 / 4.1 / 5.4
# default headless
run 1: 10.0 / 5.5 / 5.3 / 5.3 / 6.7
run 2: 3.0 / 4.0 / 3.8 / 4.1 / 3.9
run 3: 3.0 / 3.0 / 2.8 / 4.4 / 5.6
```

</details>

<details>
<summary>Matrix: <code>concat-var.mjs</code> on E3, E7 and E10 (timing)</summary>

```sh
~/.nvm/versions/node/v22.23.4/bin/node concat-var.mjs
ELECTRON_RUN_AS_NODE=1 "/Applications/Visual Studio Code.app/Contents/MacOS/Code" concat-var.mjs
```

Output:

```text
## E3
# run 1
flatten once, n =    100000: median 12.8 ns per character (5 runs)
flatten once, n =   1600000: median 46.9 ns per character (5 runs)
flatten once, n =   3200000: median 52.6 ns per character (5 runs)
flatten once, n =   6400000: median 53.2 ns per character (5 runs)
flatten once, n =  12800000: median 57.6 ns per character (5 runs)
read after every append, n =   5000: median 195.9 ns per character (5 runs)
read after every append, n =  10000: median 360.5 ns per character (5 runs)
read after every append, n =  20000: median 689.0 ns per character (5 runs)
read after every append, n =  40000: median 1246.6 ns per character (5 runs)
# run 2
flatten once, n =    100000: median 16.2 ns per character (5 runs)
flatten once, n =   1600000: median 44.2 ns per character (5 runs)
flatten once, n =   3200000: median 48.6 ns per character (5 runs)
flatten once, n =   6400000: median 53.2 ns per character (5 runs)
flatten once, n =  12800000: median 64.1 ns per character (5 runs)
read after every append, n =   5000: median 312.1 ns per character (5 runs)
read after every append, n =  10000: median 441.2 ns per character (5 runs)
read after every append, n =  20000: median 701.2 ns per character (5 runs)
read after every append, n =  40000: median 1065.8 ns per character (5 runs)
# run 3
flatten once, n =    100000: median 9.4 ns per character (5 runs)
flatten once, n =   1600000: median 37.3 ns per character (5 runs)
flatten once, n =   3200000: median 43.2 ns per character (5 runs)
flatten once, n =   6400000: median 40.9 ns per character (5 runs)
flatten once, n =  12800000: median 46.5 ns per character (5 runs)
read after every append, n =   5000: median 170.7 ns per character (5 runs)
read after every append, n =  10000: median 264.5 ns per character (5 runs)
read after every append, n =  20000: median 509.1 ns per character (5 runs)
read after every append, n =  40000: median 943.7 ns per character (5 runs)
## E7
# run 1
flatten once, n =    100000: median 3.1 ns per character (5 runs)
flatten once, n =   1600000: median 3.2 ns per character (5 runs)
flatten once, n =   3200000: median 14.2 ns per character (5 runs)
flatten once, n =   6400000: median 23.8 ns per character (5 runs)
flatten once, n =  12800000: median 22.8 ns per character (5 runs)
read after every append, n =   5000: median 127.5 ns per character (5 runs)
read after every append, n =  10000: median 214.6 ns per character (5 runs)
read after every append, n =  20000: median 446.9 ns per character (5 runs)
read after every append, n =  40000: median 824.2 ns per character (5 runs)
# run 2
flatten once, n =    100000: median 5.6 ns per character (5 runs)
flatten once, n =   1600000: median 5.0 ns per character (5 runs)
flatten once, n =   3200000: median 15.8 ns per character (5 runs)
flatten once, n =   6400000: median 22.3 ns per character (5 runs)
flatten once, n =  12800000: median 33.8 ns per character (5 runs)
read after every append, n =   5000: median 127.0 ns per character (5 runs)
read after every append, n =  10000: median 255.4 ns per character (5 runs)
read after every append, n =  20000: median 498.3 ns per character (5 runs)
read after every append, n =  40000: median 924.6 ns per character (5 runs)
# run 3
flatten once, n =    100000: median 2.8 ns per character (5 runs)
flatten once, n =   1600000: median 2.8 ns per character (5 runs)
flatten once, n =   3200000: median 13.2 ns per character (5 runs)
flatten once, n =   6400000: median 23.2 ns per character (5 runs)
flatten once, n =  12800000: median 21.5 ns per character (5 runs)
read after every append, n =   5000: median 145.9 ns per character (5 runs)
read after every append, n =  10000: median 286.0 ns per character (5 runs)
read after every append, n =  20000: median 524.8 ns per character (5 runs)
read after every append, n =  40000: median 966.4 ns per character (5 runs)
```

On E10 (Chrome 158), page variant; changed lines 7 and 11: `process.hrtime.bigint()` → `BigInt(Math.round(performance.now() * 1e6))`; flatten once at 100 000 / 1 600 000 / 3 200 000 / 6 400 000 / 12 800 000 characters, ns per character. With `--disable-renderer-backgrounding` (the main figure), five runs; in default headless mode, six runs, of which five stayed slow from 1 600 000 characters on (an earlier run of this kind was put down to a busy machine; it came in five of six default runs and in none of the five flagged runs, at a load average of 2 to 4, so it belongs to the default headless mode; its cause was not isolated):

```text
# with --disable-renderer-backgrounding
run 1: 7.0 / 5.8 / 18.2 / 23.7 / 26.1      read after every append, 5 000 to 40 000: 140, 280, 575, 1075
run 2: 3.0 / 2.7 / 11.8 / 16.7 / 19.9      read after every append: 120, 230, 450, 788
run 3: 3.0 / 3.5 / 13.3 / 17.4 / 20.3      read after every append: 120, 220, 435, 768
run 4: 3.0 / 2.8 / 12.1 / 17.5 / 20.1
run 5: 3.0 / 2.9 / 12.0 / 16.9 / 20.9
# default headless
runs 1, 2, 3, 4 and 6: 2.0 to 13.0 / 36 to 43 / 52 to 62 / 90 to 98 / 110 to 123      read after every append: 140, 170 to 180, 310 to 315, 718
run 5: 2.0 / 2.7 / 12.1 / 17.0 / 21.8
```

</details>

<details>
<summary>Matrix: <code>proxytime.mjs</code> on E4, E7 and E10 (timing)</summary>

```sh
~/.nvm/versions/node/v25.7.0/bin/node proxytime.mjs
ELECTRON_RUN_AS_NODE=1 "/Applications/Visual Studio Code.app/Contents/MacOS/Code" proxytime.mjs
```

Output:

```text
## E4
# run 1
plain            0.56 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
getter           0.94 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
proxy, no traps  10.58 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
proxy, get trap  16.92 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
# run 2
plain            0.56 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
getter           0.94 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
proxy, no traps  10.55 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
proxy, get trap  17.44 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
# run 3
plain            0.57 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
getter           0.94 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
proxy, no traps  10.39 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
proxy, get trap  16.65 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
# run 4
plain            0.56 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
getter           0.94 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
proxy, no traps  10.42 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
proxy, get trap  16.67 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
# run 5
plain            0.57 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
getter           1.00 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
proxy, no traps  10.57 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
proxy, get trap  17.99 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
## E7
# run 1
plain            0.57 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
getter           0.70 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
proxy, no traps  10.25 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
proxy, get trap  16.20 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
# run 2
plain            0.60 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
getter           0.72 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
proxy, no traps  10.34 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
proxy, get trap  15.97 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
# run 3
plain            0.56 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
getter           0.74 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
proxy, no traps  10.48 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
proxy, get trap  15.82 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
# run 4
plain            0.57 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
getter           0.70 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
proxy, no traps  10.45 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
proxy, get trap  16.04 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
# run 5
plain            0.63 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
getter           0.71 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
proxy, no traps  10.33 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
proxy, get trap  15.77 ms per 1,000,000 reads (median of 9 after 30 warm-up calls)
```

On E10 (Chrome 158), page variant; changed line 14: `process.hrtime.bigint()` → `BigInt(Math.round(performance.now() * 1e6))` (on E1 the variant gave 0.56, 0.56, 9.81, 16.11 ms); six runs, ms per 1,000,000 reads: plain / getter / proxy, no traps / proxy, get trap:

```text
runs 1 to 3: 2.40 / 1.40 / 9.80 to 10.10 / 14.90 to 15.40   (the plain loop not yet optimized)
run 4: 0.60 / 0.70 / 9.50 / 14.80
run 5: 0.30 / 0.70 / 9.60 / 14.80
run 6: 0.60 / 0.70 / 9.70 / 14.80
```

</details>

<details>
<summary>Matrix: <code>prealloc.mjs</code> on E7 (timing)</summary>

```sh
ELECTRON_RUN_AS_NODE=1 "/Applications/Visual Studio Code.app/Contents/MacOS/Code" prealloc.mjs
```

Output:

```text
# run 1
n =      1000: push 0.01 ms, new Array(n) 0.01 ms, new Array(n).fill(0) 0.00 ms (median of 9)
n =    100000: push 0.20 ms, new Array(n) 0.06 ms, new Array(n).fill(0) 0.11 ms (median of 9)
n =   1000000: push 2.04 ms, new Array(n) 0.78 ms, new Array(n).fill(0) 1.25 ms (median of 9)
# run 2
n =      1000: push 0.01 ms, new Array(n) 0.00 ms, new Array(n).fill(0) 0.00 ms (median of 9)
n =    100000: push 0.20 ms, new Array(n) 0.06 ms, new Array(n).fill(0) 0.11 ms (median of 9)
n =   1000000: push 2.06 ms, new Array(n) 0.80 ms, new Array(n).fill(0) 1.31 ms (median of 9)
# run 3
n =      1000: push 0.02 ms, new Array(n) 0.00 ms, new Array(n).fill(0) 0.01 ms (median of 9)
n =    100000: push 0.20 ms, new Array(n) 0.06 ms, new Array(n).fill(0) 0.12 ms (median of 9)
n =   1000000: push 2.28 ms, new Array(n) 0.78 ms, new Array(n).fill(0) 1.26 ms (median of 9)
# run 4
n =      1000: push 0.00 ms, new Array(n) 0.01 ms, new Array(n).fill(0) 0.01 ms (median of 9)
n =    100000: push 0.19 ms, new Array(n) 0.06 ms, new Array(n).fill(0) 0.12 ms (median of 9)
n =   1000000: push 2.21 ms, new Array(n) 0.82 ms, new Array(n).fill(0) 1.27 ms (median of 9)
# run 5
n =      1000: push 0.00 ms, new Array(n) 0.01 ms, new Array(n).fill(0) 0.00 ms (median of 9)
n =    100000: push 0.20 ms, new Array(n) 0.06 ms, new Array(n).fill(0) 0.11 ms (median of 9)
n =   1000000: push 2.63 ms, new Array(n) 1.19 ms, new Array(n).fill(0) 1.27 ms (median of 9)
```

</details>

### 6.4 Pointer compression in Node.js: the project's discussion and outside numbers (as of 2026-11-27)

§3.1 gives the mechanism, the costs and the status from rank-1 and rank-4 pages. This part adds what the Node.js project's own threads say. They are GitHub issues and pull requests, which this knowledge base ranks 6 whoever writes in them, so each statement below says who wrote it (by role) and when. All were read on 2026-11-27.

**Why the official builds have it off, in the project's threads:**

- **2019: the add-on break and the 4 GB limit.** Issue 26756, "Pointer compression and Node modules", was opened on 18 March 2019 by a user the page labels Member (hashseed): "Different ABI, so Node modules for non-pointer-compressed builds are incompatible with pointer-compressed builds." He also hoped it "will pay for itself due to fewer cache misses" ✅[^node-issue-26756]. The next day three other participants (two labelled Member, one Contributor) wrote that they saw a benefit in the option "but not on by default, or even on in our distribution builds", that turning it on by default "sounds like a regression", and that "the limit of 4G means it is probably not viable for Node.js in the short term" ✅[^node-issue-26756].
- **2019 to 2023: overhead, big heaps and the cost of a second build.** The Technical Steering Committee issue 790, "Looking for feedback: Pointer compression in Node.js", opened on 6 December 2019, says that it "breaks native addon compatibility" and that the memory estimates "are based on statistics gathered in Chrome for typical websites"; on 9 December 2019 its author added: "The extra shifts are likely to introduce some performance overhead, though." ✅[^node-tsc-790]. A participant called `--max-old-space-size` "the only practical escape hatch to unblock the entire company's workflow"; another wrote: "I think this will benefit a vast majority of users." (both 6 December 2019) ✅[^node-tsc-790]. On 17 February 2023 a member wrote: "The discussion always come down to the cost of building/testing/shipping releases." ✅[^node-tsc-790].
- **2023 to 2024: a second download that nobody kept up.** Build working group issue 3204, "Path to adding a Tier 2 build with pointer compression enabled" (22 February 2023 to 25 September 2024): a concern about "confusion to end users in producing a second Linux download" (23 February 2023); "Nobody appears to be paying any attention to it." (5 August 2024); "the main driver for investing to make it happen is gone" (6 August 2024); and "the vast majority of cases can fit well within a 4gb compressed heap" (5 September 2024) ✅[^node-build-3204].
- **2024 to 2026: one cage per thread.** Issue 55735, "Pointer Compression and Isolate Groups", opened on 5 November 2024: pointer compression "has historically forced a process-wide maximum v8 heap limit of 4 GB", because all threads shared one cage; the plan was that "each thread (main thread and each worker thread) will have it's own separate 4GB limit" (28 May 2025), and to "make this the default build mode for Node.js in a later phase 2" (5 November 2024), which on 8 May 2025 depended on whether it is "not too big of a breaking change" ✅[^node-issue-55735]. The same day a user labelled Member wrote: "the ArrayBuffer issues comes from sandboxing, not pointer compression per-se." ✅[^node-issue-55735]. The issue was closed as completed on 26 April 2026, the day a bot marked it stale; that close does not announce a default change ✅[^node-issue-55735].
- **2025: isolate groups land, still off by default.** Pull request 60254, "src: initial enablement of IsolateGroups", was merged on 17 October 2025 ✅[^node-pr-60254] and is listed in the v25.1.0 release notes ✅[^node-v2510]. Its description: "When pointer compression is enabled, all isolates within a single group are limited to a 4 GB shared pointer cage", but as many groups can be created as virtual memory allows; and "In the default node.js build, this is disabled." Its author wrote that he is "not yet convinced" pointer compression is "safe to enable by default"; a user labelled Contributor (verwaest) wrote on 17 October 2025 that "8gib heaps aren't currently supported by v8" ✅[^node-pr-60254].

**Status as of 2026-11-27:** a compile-time option, off in the default build ✅[^node-configure] ✅[^node-pr-60254]; no release note read announces it on by default ✅[^node-changelogs] ✅[^node-v2510]; the newest statement found in these threads is the close of issue 55735 on 26 April 2026.

**Independent numbers for Node.js, ranked:**

- **A vendor's measurement (Rank 4; the numbers are the vendor's own, in its own product set-up).** Platformatic, which sells the Watt application server, reports "50% memory savings with only a 2-4% increase in average latency", and for plain Node.js an average overhead of 2.5 %, about 1 ms on a 40 ms median ✅[^platformatic]. Its conditions: a Next.js 16 e-commerce application with server-side rendering, 400 requests per second for two minutes after a one-minute ramp-up, the k6 load tool, AWS EKS on m5.2xlarge nodes, Node.js 25 ✅[^platformatic]. For Watt with pointer compression against its baseline, the text says it "increase[s] p99 latency by 43%", while the post's summary says P99 latency fell by 7 %; the two p99 statements do not agree as read, and the post does not say what the 7 % is measured against. P99 latency is the time that 99 % of requests finish within, so it describes the slowest 1 % ✅[^platformatic]. The post shows no date or author.
- **The pull request author's check (Rank 6, informal).** In pull request 60254: "`heapUsed` is cut in half", and "There should be no real noticeable difference in performance", with no benchmark attached ✅[^node-pr-60254].
- **User reports (Rank 6, no conditions given).** One user wrote that recompiling their Node.js image with pointer compression "effectively halved our memory use" (12 February 2023) ✅[^node-tsc-790]; another, on 8 May 2025, that the promised performance and memory improvements did not show up in their workload ✅[^node-issue-55735].
- **This doc's own byte counts** (§3.1, E9 against E2): pointer-heavy data halves, raw data does not ✅[^lab-matrix].
- No Node.js core benchmark result (the project's `benchmark/` suite) for pointer compression was found on the pages read.

## Verification status

- **Measured** on 2026-11-26, Node.js 24.22.1 (V8 13.6.233.17-node.58) in `node:24.22.1-alpine` on arm64 with `--network none`: every ✅[^lab] claim; 34 scripts in 35 runs, each embedded with its command and output. Build facts read from the same image on 2026-11-27: `process.arch` is `arm64`, `process.platform` is `linux`, and `process.config.variables` gives `v8_enable_pointer_compression: 0`, `v8_enable_sandbox: 0`, `v8_enable_maglev: 1` and `v8_enable_lite_mode: 0`. A result that depends on the word size or on the tiers (the small-integer range, bytes per value, tier-up) may differ on a build with other values, on x64, or on another V8 version: none of those was run in the 2026-11-26 lab (the matrix of 2026-11-27, §6.3, re-ran the scripts on macOS, emulated x64 and V8 12.4 to 15.0). Each script was run at least twice; deterministic outputs matched byte for byte; timings and some memory figures varied as noted. An independent review on the same day re-ran all 29 runs of the original 28 scripts: every deterministic output matched byte for byte; the timing and memory outputs matched in conclusion, with the one exception of a single holey-sum round (§6.1). The review then added six variation scripts (`delete-var`, `fill-var`, `limits-var`, `fieldmem-var`, `twobyte`, `concat-var`) and re-ran `holey.mjs` and `prealloc.mjs` with other sizes (those two edits are described in §6.1, not embedded).
- **Matrix re-run on 2026-11-27** (§6.3): 34 scripts in 35 runs on E1, E2, E3, E4 and E7, 175 cells: 140 same, 23 differs, 6 cannot run (5 `%DebugPrint` scripts on E7, `strtype.mjs` on E3), 6 not run (timing on emulated E2); timings three times per build and five where they differed, 227 runs in all, plus the probes `smi.js` (E0 to E4 and E7), `litprobe.mjs`, `typed-external.mjs` and `strtype-noflat.mjs`. Still not run: Windows; native x64 hardware (E2 and E9 are emulated, and both default to `--no-turbofan` there); a pointer-compression build on arm64 other than Chrome and Electron; the other unofficial Node.js pointer-compression builds (riscv64, and v26.13.1); Firefox and Safari themselves, and this doc's own scripts on their engines (an engine-neutral cross-check of the rules on SpiderMonkey and JavaScriptCore, run on 2026-11-28, is in `v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md`); V8 versions outside 12.4 to 15.8.
- **E9 pass on 2026-11-27** (§6.3): the unofficial Node.js 24.22.3 build `node-v24.22.3-linux-x64-pointer-compression` (checksum checked against `SHASUMS256.txt`; `v8_enable_pointer_compression: 1`, `v8_enable_31bit_smis_on_64bit_arch: 1`, `v8_enable_sandbox: 0`), with E2 re-run beside it: the 29 non-timing scripts once on each, plus `smi.js`, `litprobe.mjs`, `typed-external.mjs`, the build facts and the heap limit, and `delete-var.mjs` again with `--turbofan` on both. E9 column: 25 same, 4 differs, 0 cannot run, 6 not run (timing). New totals over 210 cells: 165 same, 27 differs, 6 cannot run, 12 not run. Of the places that said "cause not isolated", the field sizes and bytes per element were settled as pointer compression, `undefined` in arrays (and the typed-array counter, the tracing silence and the short `%DebugPrint`) as not pointer compression, and the dictionary-read timing was not settled (emulated timings).
- **E10 pass on 2026-11-27** (§6.3): Google Chrome 158.0.8127.89 (V8 15.8.62.31), headless, each script inlined in a `file://` page; 26 scripts ran there (15 unchanged, 11 as page variants that swap only the measurement call, each variant also run on E1), the timing scripts three times each and again where runs disagreed, plus the probes `smi.js`, `natives.js`, `optstatus.js` and `abprobe.js`. E10 column: 15 same, 11 differs, 9 cannot run (5 read `%DebugPrint` output, 2 read trace output, 2 need a Node.js API). New totals over 245 cells: 180 same, 38 differs, 15 cannot run, 12 not run. Narrowing runs on E6 (Deno 2.9.8, V8 15.0, linux arm64) and E8 (Electron 38.8.6, V8 14.0, macOS arm64) for the five differences E9 left to Electron 43: `undefined` in arrays and the dictionary-read gap come with V8 15.0 in the builds run; the typed-array counter and the tracing silence are common to both Electron builds; the short `%DebugPrint` is shared by Deno and both Electron builds.
- **Re-run on 2026-11-28** (§6.3), after a restart of the lab machine: the scripts were extracted from this doc and run again (screen unlocked, one browser window at a time, timing runs one at a time). Chrome 158 (E10): all 35 cells re-run (26 as listed, 9 "cannot run" confirmed), 35 matched in result: the byte counts, the small-integer range, the 4,192 MiB heap limit, the dictionary thresholds, the elements kinds and the `usedJSHeapSize` figure for `ArrayBuffer` contents reproduced exactly (to the 0.1 byte the doc allows), the optimization-status bits gave identical lines in three runs, and the probes `smi.js`, `litprobe.mjs`, `natives.js` (added to the set-up block: it was only described) and `optstatus.js` matched; the six timing scripts ran three times with `--disable-renderer-backgrounding` and three times in default headless mode (41 runs with five extra `concat-var.mjs` runs), and each order and ratio held. One statement was corrected: the slow `concat-var.mjs` run that the doc put down to a busy machine came in 5 of 6 default headless runs and in none of 5 flagged runs, so it is a property of default headless mode (cause not isolated). Narrowing runs on E6 and E8: all 5 rows matched, including 3 `dicttime.mjs` runs on each; the 6 page variants on E1 gave the baseline. Node.js builds and Electron 43 (E0, E1, E2, E3, E4, E7, E9): all 28 non-timing script runs on each of the 7 builds (196 runs; `delete-var.mjs` with `--turbofan` on E2 and E9), the probes `smi.js`, `litprobe.mjs`, `typed-external.mjs`, `abprobe.js`, the build facts and the heap limits (with `--max-old-space-size=8192`: 4,095.75 MiB on E9 against 8,384 on E2; 4,192 on E7; with 16384, 16,576 on E1 and E4 and 4,192 on E7), and the copy of `strtype.mjs` without the two `%StringIsFlat` calls on E3; every one of the 192 cells of the matrix for these builds gave the verdict the table gives (159 same, 27 differs, 6 cannot run, and the 12 timing cells on E2 and E9 not run), and the E0 outputs matched the quoted ones. The timing scripts ran three times each on E1, E3, E4 and E7 (72 runs, plus two more `concat-var.mjs` runs on E7 and one repeated `concat.mjs` run after the lock wait of 20 minutes ran out; E0 was timed once, `concat-var.mjs`, and E1, which has the same V8, stands for it), and each order and ratio held: dictionary reads 7.1 to 7.4 times a fast read on E1, 6.7 to 7.0 on E3, 8.8 to 9.0 on E4 and 2.4 to 2.5 on E7; getter 0.9 to 1.1 times a plain read on E1 and E3, 1.6 times on E4, 1.3 times on E7; `push` 3.3 to 4.4 times the preallocated build on E1, E3 and E4 and 2.6 to 2.9 times on E7; holey sum 0 to 28 % above packed; the string-building rise on E3 and E7 as listed. Three `concat-var.mjs` runs on E7 taken while other timing runs shared the machine read 8 to 15 ns at the small sizes instead of 3 and a rise of 5 to 9 times; two more, taken with the machine quiet, gave 2.3 to 2.8 ns and 7 to 9 times, as the doc says. Two quoted values were corrected: the `{x:i}` line of `fieldmem-var.mjs` on E0 (27.9 to 32.1, noise in the first run, 32.1 in the matrix run and in four runs now) and the baseline line of `slice-keep.mjs` on E0 (4.2 to 3.7 MB, in four runs; its other lines did not change); the start-up heap of E7 and E9 is smaller still (2.2 MB, noted in §6.3). Two single readings fell outside the doc's tolerance and did not repeat: `{ x: i, y: i }` in `fieldmem.mjs` on E9 once read 18.6 bytes (24.1 and 24.0 in two repeats), and `typed.mjs` on E4 reads `-0.0` instead of `0.0` on its first line in some runs (a growth of a few bytes below zero after a collection; no conclusion rests on it).
- **Read only** (source or docs, not run): the 43 % heap saving of pointer compression (2020), the 2017 proxy benchmark gains, the 2018 hash-code storage change, the 21 elements kinds, the source constants quoted in §5 (each also observed in the lab except the maximum string length and the 4 preallocated slots). The review re-opened every source cited, and the `DeleteObjectPropertyFast` check was repeated at seven tags.
- **Not checked:** a Node.js build with pointer compression on native hardware (the one run, E9, is emulated), timings on a pointer-compression Node.js build, V8 versions before 12.4 in the lab (the `delete` history before 12.0 comes from the source only), the exact commit that removed the delete fast path and the one that added the `fill` exception.

## References
- [V8 source: src/objects/string.h at 13.6.233.17](https://github.com/v8/v8/blob/13.6.233.17/src/objects/string.h) — V8 project, 2025. Rank 1. Backs: §1.1, §3.10, §5, §6.2 (string kinds, minimum cons and slice length, slices keep the parent, maximum length). [^v8-string]
- [V8 source: src/objects/js-objects.h at 13.6.233.17](https://github.com/v8/v8/blob/13.6.233.17/src/objects/js-objects.h) — V8 project, 2025. Rank 1. Backs: §3.3, §3.8, §5 (4 unused fields of the initial Object map, property array step 3, maximum gap 1024). [^v8-jsobjects]
- [V8 source: src/objects/js-array.h at 13.6.233.17](https://github.com/v8/v8/blob/13.6.233.17/src/objects/js-array.h) — V8 project, 2025. Rank 1. Backs: §1.1, §3.8, §5 (slow elements are a hash table, maximum fast array length, 4 preallocated slots). [^v8-jsarray]
- [V8 source: src/objects/js-array-buffer.h at 13.6.233.17](https://github.com/v8/v8/blob/13.6.233.17/src/objects/js-array-buffer.h) — V8 project, 2025. Rank 1. Backs: §3.9, §5 (typed arrays on the heap up to 64 bytes). [^v8-jsab]
- [V8 source: src/objects/ordered-hash-table.h at 13.6.233.17](https://github.com/v8/v8/blob/13.6.233.17/src/objects/ordered-hash-table.h) — V8 project, 2025. Rank 1. Backs: §1.1, §3.11 (Map and Set as ordered hash tables). [^v8-ordered]
- [V8 source: src/runtime/runtime-object.cc at 11.3.244.8](https://github.com/v8/v8/blob/11.3.244.8/src/runtime/runtime-object.cc) — V8 project, 2023. Rank 1. Backs: §3.4, §6.1 (the old delete-last-property fast path). [^v8-delete-old]
- [V8 source: src/runtime/runtime-object.cc at 12.2.281.27](https://github.com/v8/v8/blob/12.2.281.27/src/runtime/runtime-object.cc) and [at 13.6.233.17](https://github.com/v8/v8/blob/13.6.233.17/src/runtime/runtime-object.cc) — V8 project, 2023 to 2025. Rank 1. Backs: §3.4, §6.1 (no `DeleteObjectPropertyFast`; the name occurs at 11.3, 11.4, 11.5, 11.6, 11.8 and 11.9, not at 12.0, 12.1, 12.2, 12.4 or 13.6). [^v8-delete-new]
- [Field Representations and Elements Kinds](https://github.com/v8/v8/blob/main/docs/objects/fields-and-elements.md) — V8 project docs, living, read 2026-11-26. Rank 1. Backs: §1.1, §3.2, §3.6, §6.1 (representation lattice, generalization of the tree, boxed double fields, one-way elements transitions). [^v8-fields]
- [Maps (Hidden Classes) in V8](https://v8.dev/docs/hidden-classes) — V8 team, living. Rank 1. Backs: §2 (every heap object points to a map). [^v8-hidden]
- [Node.js v24 process documentation: process.memoryUsage()](https://nodejs.org/docs/latest-v24.x/api/process.html) — Node.js project, v24.x, read 2026-11-26. Rank 1. Backs: §3.9 (`arrayBuffers`, `external`, `heapUsed`). [^node-process]
- [V8 source: include/v8-internal.h at 13.6.233.17](https://github.com/v8/v8/blob/13.6.233.17/include/v8-internal.h) — V8 project, 2025. Rank 1. Backs: §3.1 (`SmiTagging<4>` 31 bits, `SmiTagging<8>` 32 bits, tagged size under `V8_COMPRESS_POINTERS`, `V8_31BIT_SMIS_ON_64BIT_ARCH`). [^v8-internal]
- [Node.js source: configure.py](https://github.com/nodejs/node/blob/main/configure.py) — Node.js project, main and v24.x, read 2026-11-27. Rank 1. Backs: §3.1 (`--experimental-enable-pointer-compression`, help text, the two build variables). [^node-configure]
- [Node.js process documentation: process.config](https://nodejs.org/api/process.html) — Node.js project, v26.13.1 docs, read 2026-11-27. Rank 1. Backs: §3.1 (`process.config` is the configure options; the field is not documented). [^node-process-config]
- Node.js release notes and changelogs: [v24.0.0](https://nodejs.org/en/blog/release/v24.0.0), [v24.2.0](https://nodejs.org/en/blog/release/v24.2.0), [CHANGELOG_V25.md](https://github.com/nodejs/node/blob/main/doc/changelogs/CHANGELOG_V25.md) (read in full), CHANGELOG_V24.md and CHANGELOG_V26.md (first 100 000 characters read; whole files searched by keyword on 2026-11-27) — Node.js project, read 2026-11-27. Rank 1. Backs: §3.1 (no default change found). [^node-changelogs]
- [Deno: Cargo.toml](https://github.com/denoland/deno/blob/main/Cargo.toml) and [rusty_v8: build.rs](https://github.com/denoland/rusty_v8/blob/main/build.rs) — Deno project, main, read 2026-11-27. Rank 1. Backs: §3.1 (V8 crate without default features; `v8_enable_pointer_compression=false` unless the feature is set). [^deno-build]
- [Node.js unofficial-builds: README](https://github.com/nodejs/unofficial-builds/blob/main/README.md) and release folders [v24.22.3](https://unofficial-builds.nodejs.org/download/release/v24.22.3/) and [v26.13.1](https://unofficial-builds.nodejs.org/download/release/v26.13.1/) — Node.js project, read 2026-11-27. Rank 1. Backs: §3.1 (pointer-compression builds and their file names). [^node-unofficial]
- [Docker official images: library/node](https://github.com/docker-library/official-images/blob/master/library/node) — Docker official images, Node.js Docker team, master, read 2026-11-27. Rank 1. Backs: §3.1 (no pointer-compression tag). [^docker-node]
- [V8 design document: Pointer compression](https://chromium.googlesource.com/v8/v8.git/+/main/docs/heap/pointer-compression.md) — V8 project, main, read 2026-11-27. Rank 1. Backs: §3.1, §6.4 (tagged fields are most of the heap, 30 % to 40 % saving, cache use, base in a register, cage at the start of the sandbox, one cage per isolate group). [^v8-ptrcomp-design]
- [V8 source: BUILD.gn at main](https://github.com/v8/v8/blob/main/BUILD.gn) — V8 project, main, read 2026-11-27 (first 100 000 of about 331 000 characters). Rank 1. Backs: §3.1 (`v8_enable_pointer_compression_8gb`; the sandbox default depends on shared-cage pointer compression). [^v8-build-gn]
- [Node.js v25.1.0 release notes](https://nodejs.org/en/blog/release/v25.1.0) — Node.js project, 2025-10-28, read 2026-11-27. Rank 1. Backs: §3.1, §6.4 (initial enablement of IsolateGroups, pull request 60254; no default change). [^node-v2510]
- [Pointer compression in V8](https://v8.dev/blog/pointer-compression) — V8 team (Igor Sheludko, Santiago Aboy Solanes), 2020-03-30. Rank 4. Backs: §1.1, §3.1, §3.2, §6.1 (Smi width, tag bit, 4 GB range, 43 %, double unboxing disabled). [^v8-ptrcomp]
- [The story of a V8 performance cliff in React](https://v8.dev/blog/react-cliff) — V8 team (Benedikt Meurer, Mathias Bynens), 2019-08-28. Rank 4. Backs: §3.2 (deprecation and migration, initial values, `null`). [^v8-react]
- [Fast properties in V8](https://v8.dev/blog/fast-properties) — V8 team (Camillo Bruni), 2017-08-30. Rank 4. Backs: §1.1, §3.3, §3.4, §3.5, §3.12 (in-object count, dictionary properties, elements kept apart, map holds the prototype). [^v8-fastprops]
- [Slack tracking in V8](https://v8.dev/blog/slack-tracking) — V8 team (Michael Stanton), 2020-09-24. Rank 4. Backs: §1.1, §3.3, §5 (eight extra slots, seven constructions). [^v8-slack]
- [Elements kinds in V8](https://v8.dev/blog/elements-kinds) — V8 team (Mathias Bynens), 2017-09-12, updated 2025-02-28. Rank 4. Backs: §1.1, §3.6, §3.7, §6.1, §6.2 (21 kinds, the lattice, holey forever and the `fill` exception, `-0`/`NaN`/`Infinity`, literal and `push` advice). [^v8-elements]
- [Optimizing hash tables: hiding the hash code](https://v8.dev/blog/hash-code) — V8 team (Sathya Gunasekaran), 2018-01-29. Rank 4. Backs: §3.11. [^v8-hash]
- [Optimizing ES2015 proxies in V8](https://v8.dev/blog/optimizing-proxies) — V8 team (Maya Armyanova), 2017-10-05. Rank 4. Backs: §3.13. [^v8-proxy]
- [V8 release v8.0](https://v8.dev/blog/v8-release-80) — V8 team, 2019-12-18. Rank 4. Backs: §3.1 (average saving of 40 %; released in coordination with Chrome 80). [^v8-release-80]
- [v8-dev list: 31-bit Smis and pointer compression](https://groups.google.com/g/v8-dev/c/AI0RcAj-Z4g/m/Juj4UbcdAwAJ) — Santiago Aboy Solanes (V8 team), 2020-02-20. Rank 4. Backs: §3.1 (Chrome 80 enabled pointer compression and 31-bit Smis by default). [^v8-dev-80]
- [Electron and the V8 Memory Cage](https://www.electronjs.org/blog/v8-memory-cage) — Electron project (nornagon), 2022-06-30. Rank 4. Backs: §3.1 (on since Electron 14, 4 GB heap cap, up to 40 % smaller heap). [^electron-cage]
- [We cut Node.js memory in half](https://blog.platformatic.dev/we-cut-nodejs-memory-in-half) — Platformatic (vendor of the Watt application server; the numbers are its own, measured in its own set-up), no date or author shown, read 2026-11-27. Rank 4. Backs: §3.1, §6.4 (Node-API and NAN add-ons; memory and latency figures and their conditions). [^platformatic]
- [Node.js issue 26756: Pointer compression and Node modules](https://github.com/nodejs/node/issues/26756) — Node.js issue tracker, 2019-03-18 to 2020-06-26, read 2026-11-27. Rank 6. Backs: §6.4. [^node-issue-26756]
- [Node.js TSC issue 790: Looking for feedback: Pointer compression in Node.js](https://github.com/nodejs/TSC/issues/790) — Node.js Technical Steering Committee tracker, 2019-12-06 to 2023, read 2026-11-27. Rank 6. Backs: §6.4 (including one user report). [^node-tsc-790]
- [Node.js build issue 3204: Path to adding a Tier 2 build with pointer compression enabled](https://github.com/nodejs/build/issues/3204) — Node.js build working group tracker, 2023-02-22 to 2024-09-25, read 2026-11-27. Rank 6. Backs: §6.4. [^node-build-3204]
- [Node.js issue 55735: Pointer Compression and Isolate Groups](https://github.com/nodejs/node/issues/55735) — Node.js issue tracker, 2024-11-05 to 2026-04-26, read 2026-11-27. Rank 6. Backs: §6.4 (including one user report). [^node-issue-55735]
- [Node.js pull request 60254: src: initial enablement of IsolateGroups](https://github.com/nodejs/node/pull/60254) — Node.js project, merged 2025-10-17, read 2026-11-27. Rank 6. Backs: §6.4. [^node-pr-60254]
- Lab: 34 scripts (35 runs) on Node.js 24.22.1 (V8 13.6.233.17-node.58), image `node:24.22.1-alpine`, arm64, `--network none`, 2026-11-26; each script, command and output is embedded next to the claim it backs. [^lab]
- Lab matrix: the same scripts and the probe `smi.js` on six environments (E0 Node.js 24.22.1 linux arm64; E1 Node.js 24.22.1 macOS arm64; E2 Node.js 24.22.1 linux x64, emulated; E3 Node.js 22.23.4, V8 12.4; E4 Node.js 25.7.0, V8 14.1; E7 Electron 43.7.7 as Node, V8 15.0, pointer compression on; E9 the unofficial Node.js 24.22.3 build `node-v24.22.3-linux-x64-pointer-compression`, V8 13.6.233.17-node.63, pointer compression on, sandbox off, linux x64 emulated in a Debian 13 container, run beside E2), 2026-11-27. Rank 1 (primary measurement). Backs: §1.1, §1.2, §3.1 to §3.13, §4, §5, §6.1, §6.3 and §6.4. One more probe: `smi.js` on Deno 2.9.8 (V8 15.0.245.2), image `denoland/deno:alpine-2.9.8`, linux arm64. The heap-limit runs with `--max-old-space-size` also used a second Electron build with pointer compression on: Electron 38.8.6 run as Node (V8 14.0.365.10), macOS arm64, which with Deno 2.9.8 (E6, V8 15.0.245.2, linux arm64) also ran the narrowing scripts of §6.3 (E8). E10: Google Chrome 158.0.8127.89 (V8 15.8.62.31), macOS arm64, headless, scripts inlined in a `file://` page, 2026-11-27; 245 matrix cells over E1 to E4, E7, E9 and E10. [^lab-matrix]

## Related

- [v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md](v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md) — which of the rules measured on V8 also hold on SpiderMonkey (Firefox 161) and JavaScriptCore (the macOS framework's shell, Bun, a WebKit page): 33 engine-neutral checks.
- [V8 hidden classes and inline caches](v8-hidden-classes.md) — shapes, transitions, inline caches; this doc adds the storage under them.
- [V8 compiler pipeline deep dive](v8-compiler-pipeline-deep-dive.md) — tiers, feedback, inline-cache states and deoptimization.
- [V8 memory and startup deep dive](v8-memory-and-startup-deep-dive.md) — heap spaces, garbage collection, what keeps memory alive, startup.
- [Private class fields: `#x` versus TypeScript `private`](private-fields.md) — what `#x` fields are at run time.
- [Default heap limit of a Node.js worker thread in a memory-limited container](node-worker-default-heap-limit.md) — heap limits for worker threads.
- [Performance problem classes hidden by language and runtime features](../performance/code-review/problem-classes-language-runtimes.md) — the `object-shape-instability` class, whose advice §6.1 checks.
