---
schema: deep-dive/v1
topic: js-runtime
status: verified
applies-to: ["Node.js 24.22.1 with V8 13.6.233.17 (official build: pointer compression off, 32-bit small integers), image node:24.22.1-alpine, linux arm64", "V8 source at tag 13.6.233.17; older tags only where named", "lab runs of 2026-11-26"]
last-updated: 2026-11-26
last-verified: 2026-11-26
synthesized-into: []
tags: [v8, node, performance, memory, smi, heap-number, pointer-compression, field-representation, slack-tracking, dictionary-mode, elements-kinds, typed-arrays, strings, cons-string, sliced-string, map, set, proxy]
ranked-sources: true
---

# How V8 stores values, objects, arrays and strings (Node.js 24)

## Summary
**TL;DR:** In Node.js 24.22.1 (V8 13.6), a number is stored either as a small integer inside the pointer itself (a Smi, from -2³¹ to 2³¹-1 in this build) or as a separate 16-byte heap number; an object keeps its first properties inside itself and the rest in a side array, until a `delete`, an accessor in a literal, or too many computed keys turn it into a hash table (dictionary mode) ✅[^lab]. Arrays carry an elements kind that only moves from specific to general (small integers → doubles → anything, packed → holey) ✅[^v8-elements], with one new exception in this build: `fill()` over the whole array makes a holey array packed again ✅[^lab]. Strings are one-byte or two-byte, and `+` and `slice` build ropes and slices that point at other strings, so a 20-character slice can keep a 10 MB parent alive ✅[^lab].
**Use this when:** you want to know what memory layout and which fast or slow mode your objects, arrays, strings, `Map`s and typed arrays get in Node.js 24; you review code that uses `delete`, computed keys, `new Array(n)`, holes, string building or `Proxy`; you want to check a piece of popular V8 advice against a real run.
**Depth:** tagged values and pointer compression in this build; field representations and double boxing; in-object and out-of-object properties and slack tracking; every way into and out of dictionary mode that was tested, with the thresholds; integer-like keys; the elements-kinds lattice step by step, holes, `new Array(n)`, `Array.from`, `fill`, `length = 0`, sparse arrays; typed arrays and where their bytes live; string representations; `Map` and `Set` against objects; literals, spread, `Object.assign`, classes and prototypes; getters, setters and `Proxy`; bytes per element for each representation; nine corrections of popular advice. Each lab script and its output is embedded. Shapes, transitions and inline caches are in [V8 hidden classes and inline caches](v8-hidden-classes.md) and are not repeated; compiler tiers and deoptimization are in [the compiler pipeline deep dive](v8-compiler-pipeline-deep-dive.md); garbage collection and what keeps memory alive are in [the memory and startup deep dive](v8-memory-and-startup-deep-dive.md).

## 1. Mental model

Think of the V8 heap as a warehouse. Every slot on a shelf is one machine word (8 bytes in this build). A slot holds either a small integer written directly on the label (a Smi) or the address of a box somewhere else (a pointer to a heap object). Objects are boxes with a few built-in slots, a label saying which layout they follow (the map, also called hidden class or shape), and two side drawers: one for extra named properties and one for numbered items (the elements). Most of what this doc measures is which drawer a value ends up in, and whether the drawer is a neat row of slots (fast) or a hash table you must search (dictionary).

### 1.1 Words first

| Term | Plain meaning | Analogy | Concrete example (this build) |
|---|---|---|---|
| Tagged value | A machine word that holds either a small integer or a pointer, told apart by its lowest bit ✅[^v8-ptrcomp] | A label that is either a number written on it, or a shelf address | `%DebugPrint(42)` prints `Smi: 0x2a (42)` ✅[^lab] |
| Smi (small integer) | An integer stored inside the tagged word itself, with no box ✅[^v8-ptrcomp] | Writing the price on the tag instead of in a separate book | `2 ** 31 - 1` is a Smi, `2 ** 31` is not ✅[^lab] |
| Heap number | A 16-byte box holding one 64-bit floating-point number | A small envelope holding one figure | `1.5` prints as `<HeapNumber 1.5>` ✅[^lab] |
| Pointer compression | A build option that stores pointers in 32 bits inside a 4 GB region ✅[^v8-ptrcomp] | Writing shelf numbers with fewer digits because the warehouse is small | Off in the official Node.js 24 build: `v8_enable_pointer_compression: 0` ✅[^lab] |
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

Natives used: `%IsSmi`, `%HaveSameMap`, `%HasFastProperties`, `%HasSmiElements`, `%HasDoubleElements`, `%HasObjectElements`, `%HasHoleyElements`, `%HasDictionaryElements`, `%HasFixedFloat64Elements`, `%StringIsFlat`, `%FlattenString`, `%IsInternalizedString`, `%DebugPrint`. Flags used, all present in this build's `node --v8-options`: `--allow-natives-syntax`, `--expose-gc`, `--trace-generalization`, `--fast-properties-soft-limit`. There is no `--trace-maps` flag in this build ✅[^lab]:

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

Two tracing flags exist but did not show this script's own changes in this release build: `--trace-normalization` printed nothing for a `delete`, and `--trace-elements-transitions` printed two transitions of arrays inside Node.js's startup code, before the script ran, and nothing for the script's `push(4.5)` and `push('x')` ✅[^lab]. The natives are more reliable here.

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

**What the engine does.** Every value slot is one tagged word. On 64-bit machines without pointer compression, V8 uses 32 bits of that word for the Smi payload ✅[^v8-ptrcomp]; with pointer compression the payload is 31 bits ✅[^v8-ptrcomp]. The official Node.js 24.22.1 build has pointer compression off, so a slot is 8 bytes and Smis are 32-bit ✅[^lab]. Any number that is not an integer in that range, including `-0` and `NaN`, lives in a heap number box ✅[^lab].

**Why it helps.** A Smi needs no allocation and no pointer chase, so integer counters, indexes and small IDs cost nothing beyond their slot.

**Code that keeps it working.** Integers between -2 147 483 648 and 2 147 483 647. **Code that defeats it.** Values like `2 ** 31`, `1.5`, `-0` or `NaN`; each needs a heap number when it is stored in a generic slot ✅[^lab].

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

**Since when.** Pointer compression shipped in V8 in 2020; the post of 30 March 2020 reports a V8 heap up to 43 % smaller in its browsing tests (a ceiling, varying by website) ✅[^v8-ptrcomp]; the Node.js 24 build used here does not enable it ✅[^lab].

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

**What it costs.** Each double field adds a 16-byte box per object in this build: `{ x }` costs 32 bytes with an integer and 48 bytes with a double, and two double fields add 32 bytes ✅[^lab]. A review re-run (two runs, 100 000 objects each, list slot subtracted) found the same 16 bytes per double at other sizes: 5 fields 64 bytes with integers and 144 with doubles (80 more), 10 fields 104 and 264 (160 more); a class instance with two fields (after slack tracking) 40 bytes with integers and 72 with doubles; `{ x: 2 ** 31 + i }`, an integer-valued number outside the Smi range, also 48 ✅[^lab].

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
{x:i}                                        27.9 bytes per object (list slot subtracted)
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

Dictionary mode means the object carries its own hash table of properties ✅[^v8-fastprops]. Reads still work, but they search a table instead of loading a slot at a known offset: in the lab, a million reads of `o.a` took about 0.6 ms on a fast object and about 4 ms on an object made slow by `delete` ✅[^lab] (measured here).

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

**`delete`.** In this build every `delete` of an existing property switched the object to dictionary mode, including deleting the last property added, inside or outside a function, in a literal or in an object built by assignments; assigning `undefined` kept it fast ✅[^lab]. A review re-run on 2026-11-26 repeated the last-property case on objects built by named stores with 1, 2, 10, 50, 100, 500 and 1000 properties, on the first property of 10- and 100-property objects, on a class instance (also after slack tracking) and inside a function after `%OptimizeFunctionOnNextCall`: all went to dictionary mode (`delete-var.mjs` below). The one exception found: deleting a property the object does not have (`delete o.zzz`) left it fast ✅[^lab].

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
| Named stores, one statement per key (`o.k0 = 0; o.k1 = 1; …`), also on top of a 10-key literal (1021 in all) | 1021 |
| Object literal with N keys | 1021 |
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

So code that builds a lookup table with computed string keys (`map['id' + i] = …`) from `{}` gets a dictionary-mode object after about 20 keys (16 added keys on a literal of up to 10 keys, 34 on a 30-key literal, 103 on a 100-key literal; the cause of this dependence on the starting size was not isolated); that is usually what you want for a real dictionary, but not for a record type. The `--max-fast-properties` flag (default 128) did not limit named stores in this run ✅[^lab].

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
- `[1, undefined, 3]` is `PACKED_ELEMENTS`, not holey: `undefined` is a value, not a hole.
- `map`, `filter` and `slice` start a new array at the most specific kind: `[1.5, 2.5].map(Math.round)` is `PACKED_SMI`.
- `Array.from({ length: 3 })` (values `undefined`) and `[...new Array(3)]` are `PACKED_ELEMENTS`; `'a,b'.split(',')` is `PACKED_ELEMENTS`.

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

**What changed.** The 2017 post said that an array, once holey, stays holey forever ✅[^v8-elements]; an update of 28 February 2025 on the same post adds an exception for `Array.prototype.fill` ✅[^v8-elements]. In this build, `fill(value)` over the whole array turns `HOLEY_SMI` into `PACKED_SMI`, for sizes from 3 to 1 000 000 and for a holey literal; a `fill` that leaves one slot empty keeps it holey ✅[^lab]. A review re-run added sizes 1, 2, 16, 17, 100, 1025, 5 000 000 and 10 000 000 (all became packed), doubles (`PACKED_DOUBLE`), strings and objects (`PACKED_ELEMENTS`), an explicit full range `fill(0, 0, 5)`, an end past the length, and a holey array with a real gap (`a[10] = 1` on `[1, 2, 3]`): all packed. Exceptions: `new Array(0).fill(0)` stays `HOLEY_SMI` (nothing to fill), and `fill(0, 1)`, which skips index 0, stays holey ✅[^lab].

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

A typed array is a view over an `ArrayBuffer`: a fixed length, one element type, no holes and no kind transitions. In this build a typed array of up to 64 bytes (the source's default `kMaxSizeInHeap`) keeps its data on the V8 heap; above that the bytes are allocated outside it and show up in `process.memoryUsage().arrayBuffers` ✅[^v8-jsab] ✅[^lab], which Node.js documents as memory for `ArrayBuffer`s, also counted in `external` ✅[^node-process]. Writes convert the value to the element type: past the end is ignored, `'abc'` becomes `NaN` in a `Float64Array`, `300` becomes `44` in an `Int8Array` and `255` in a `Uint8ClampedArray` ✅[^lab].

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
baseline, heapUsed MB           : 4.2
holding parent.slice(0, 20)     : 14.0
after dropping the slice        : 4.0
holding slice.split("").join(""): 4.0
copy is a sliced string: false
```

</details>

**String building in a loop.** Because `+=` adds a rope node instead of copying, building a string one character at a time stayed at roughly the same cost per character from 100 000 to 1 600 000 characters (7 to 15 ns per character in four runs), flattening included ✅[^lab] (measured here). A quadratic cost would have grown that per-character time sixteenfold across the range. The conclusion does not extend to larger sizes: in review re-runs of the same loop (three runs) the cost per character rose to 29 to 41 ns at 3 200 000 characters and 37 to 45 ns at 6 400 000, then levelled off at 44 to 54 ns at 12 800 000 (`concat-var.mjs` below, one more run: 34, 38 and 40 ns), a rise of about 3 to 5 times against 100 000 but far from the 128 times a quadratic cost would give. The cause of the rise was not isolated. A pattern that reads the string after every append is different: `s += 'x'; s.charCodeAt(0)` in the loop cost 154, 281, 540 and 935 ns per character at 5 000, 10 000, 20 000 and 40 000 characters in `concat-var.mjs` (116 to 960 ns in an earlier run), roughly doubling with the length, so that pattern is quadratic ✅[^lab].

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

`Map` and `Set` are built on an ordered hash table that keeps insertion order, compares keys with SameValueZero, and is based on the deterministic hash table attributed to Tyler Close ✅[^v8-ordered]. An object used as a key keeps its hash code in its own properties backing store, and V8 moved it there from a private symbol in 2018 (V8 6.3 and later) ✅[^v8-hash] (post of 29 January 2018). A `Map` never changes mode; an object used as a dictionary does (§3.4). With 100 000 string keys holding small integers, the lab measured about 63 bytes per entry for a dictionary-mode object, 37 for a `Map` and 26 for a `Set`; with integer keys 0 to 99 999, an object (elements) cost about 9 bytes per entry and a `Map` 37 ✅[^lab] (§4.1).

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

A class getter cost the same as a plain property read in the lab, about 0.55 ms per million reads after warm-up ✅[^lab] (measured here); whether the compiler inlines it is covered in [v8-compiler-pipeline-deep-dive.md](v8-compiler-pipeline-deep-dive.md). A `Proxy` is a different object type (`JS_PROXY_TYPE`) ✅[^lab]. Reading `o.a` through one with no traps took about 10 ms per million reads, with a `get` trap about 16 ms ✅[^lab] (measured here). The post of 5 October 2017 reports that porting proxy construction to CodeStubAssembler code (V8 6.3) improved V8's JavaScript performance score for proxy construction by 49 % to 74 % ✅[^v8-proxy]; the post compares only with older V8 and does not say proxies match plain objects, and the lab above shows they do not.

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

| Representation | Bytes per element | Why |
|---|---|---|
| Small integers, `new Array(n).fill(0)`, then by index (`PACKED_SMI`) | 8.0 | one tagged word each, no pointer compression |
| Small integers, `push` onto `[]` | 10.4 | the backing store grows in steps and keeps spare capacity |
| Doubles, `PACKED_DOUBLE` | 8.0 | raw 8-byte floats, unboxed |
| Doubles in a `PACKED_ELEMENTS` array (one string in it) | 24.0 | 8-byte pointer + 16-byte heap number per element |
| Small integers in a `PACKED_ELEMENTS` array | 8.0 | still Smis, no boxes |
| `Float64Array` | 8.0 (off-heap) | raw floats in the `ArrayBuffer` |
| `Int32Array` | 4.0 (off-heap) | raw 32-bit integers |
| One-byte string | 1.0 | 1 byte per character |
| Two-byte string | 2.0 | 2 bytes per character |
| Object as dictionary, 100 000 string keys | 62.9 | hash table entry: key, value, details, plus spare capacity |
| `Map`, 100 000 string keys | 36.7 | ordered hash table entry plus bucket and chain |
| `Set`, 100 000 string keys | 26.2 | as `Map`, without the value |
| Object with integer keys 0 to 99 999 (elements) | 9.3 | a holey Smi row, grown in steps |
| `Map` with integer keys 0 to 99 999 | 36.7 to 36.8 | same entry size as with string keys |

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

A request log record created as `{ id, ms }` in one literal, with `ms` always a fraction, stays on one map with an in-object Smi field `id` and a Double field `ms` (§3.2, §3.3). The same record built as `const r = {}; r[key] = …` in a loop over a field list, then `delete r.tmp`, is in dictionary mode from the `delete` on (§3.4), costs a hash table per object, and is read through a table search: about seven times slower per read in the §3.4 timing (0.52 to 0.59 ms against 3.9 to 4.2 ms across four runs) ✅[^lab] (measured here).

## 5. Reference & invariants

Thresholds in Node.js 24.22.1 / V8 13.6.233.17, from the lab and the source at that tag:

| Item | Value | Source |
|---|---|---|
| Smi range | -2 147 483 648 to 2 147 483 647 | ✅[^lab] |
| Slot size | 8 bytes (pointer compression off) | ✅[^lab] |
| In-object slots of `{}` | 4 | ✅[^lab] ✅[^v8-jsobjects] |
| In-object slots of a literal | its key count | ✅[^lab] |
| Property array growth step | 3 slots | ✅[^v8-jsobjects] ✅[^lab] |
| Slack tracking | used slots + 8, shrunk after 7 constructions | ✅[^v8-slack] ✅[^lab] |
| Dictionary mode by computed keys, from `{}` | 20th key | ✅[^lab] |
| Dictionary mode by named stores or literal keys | 1021st key | ✅[^lab] |
| Dictionary mode for `JSON.parse` output | 128 keys | ✅[^lab] |
| `--fast-properties-soft-limit` / `--max-fast-properties` defaults | 12 / 128 | ✅[^lab] |
| Elements gap that switches to dictionary elements | 1024 empty slots | ✅[^lab] ✅[^v8-jsobjects] |
| Largest `new Array(n)` with fast elements | 33 554 432 | ✅[^lab] ✅[^v8-jsarray] |
| Element slots preallocated for an empty array | 4 | ✅[^v8-jsarray] |
| Minimum length of a cons string and a sliced string | 13 characters | ✅[^v8-string] ✅[^lab] |
| Largest typed array kept on the V8 heap | 64 bytes (the default; a build macro can change it) | ✅[^v8-jsab] ✅[^lab] |
| Maximum string length (64-bit) | about 536.8 million characters | ✅[^v8-string] |

Invariants observed in every case tested ✅[^lab]:

- Elements kinds only move down the lattice, except that a whole-array `fill` makes a holey array packed.
- Dictionary elements can return to fast elements; holey kinds return to packed only through `fill`.
- A dictionary-mode object stays slow under reads and writes, and becomes fast only when used as a prototype or copied.
- A field representation only widens, and widening applies to every object of the shape.

## 6. Trade-offs, pitfalls & misconceptions

### 6.1 Corrections: popular advice against this build

| Belief | What the lab or the current source shows (Node.js 24.22.1, V8 13.6, 2026-11-26) |
|---|---|
| "`delete` always makes an object slow." | True in this build for every delete of an existing property, including the last-added one, at the sizes tried (1 to 1000 properties) ✅[^lab]; a delete of a missing property stayed fast ✅[^lab]. It was not always true: V8 up to 11.9 had a fast path that undid the last transition ✅[^v8-delete-old] ✅[^v8-delete-new]. The object comes back to fast mode when it is used as a prototype or copied with spread ✅[^lab]. |
| "An array that becomes holey stays holey forever." | The 2017 post said so ✅[^v8-elements]. Since its 2025-02-28 update, `fill` is an exception ✅[^v8-elements], and in this build `new Array(n).fill(0)` is `PACKED_SMI` ✅[^lab]. Filling holes by index still leaves it holey ✅[^lab]. |
| "Holey arrays are much slower." | Summing 1 000 000 Smis took under 1 ms whether the array was packed or holey, when no hole was actually left. In the doc's run the holey median was about 11 % above the packed one in each of 3 rounds; in 3 further runs (9 rounds) it was 8 to 11 % above in 8 rounds and 55 % above (1.15 ms against 0.74 ms) in one, so "within about 25 %" is the typical case, not a bound ✅[^lab] (measured here). The same script at 100 000 elements gave 0.08 ms for both, and at 10 000 000 elements 9.1 to 10.5 ms packed against 9.4 to 10.1 ms holey; at 1 000 and 10 000 elements the timer was too coarse to compare ✅[^lab]. The 2017 post says holey operations "require additional checks and expensive lookups on the prototype chain" but that the difference is usually too small to matter ✅[^v8-elements]. A dictionary-mode object, by contrast, was about seven times slower to read (§3.4). Arrays with real holes left in them were not timed. |
| "Never use `new Array(n)`; always use a literal and `push`" (the 2017 post's advice ✅[^v8-elements]) and its opposite, "always preallocate with `new Array(n)`". | Building 1 000 000 Smis took 4.1 to 5.7 ms with `push`, 1.2 to 1.3 ms with `new Array(n)` filled by index and 1.8 to 2.0 ms with `new Array(n).fill(0)` first, in four runs: `push` was 3.3 to 4.3 times slower than the preallocated build ✅[^lab] (measured here). The same ratio held at 100 000 elements (0.45 to 0.50 ms against 0.13 ms) and at 10 000 000 (61.8 ms against 13.5 ms, one run); at 1 000 elements every case was 0.00 to 0.02 ms, below what this timer resolves ✅[^lab]. The 2017 post itself says the difference "is usually too small to matter" in real code ✅[^v8-elements]. Preallocation was faster to build and its result is holey, which did not slow the sum above; `push` over-allocates by about 30 % (10.4 against 8.0 bytes per element) ✅[^lab]. Preallocate when you know the length; `fill` first if you want a packed array. Neither "always" holds. |
| "String concatenation in a loop is quadratic." | Not when the string is only flattened once at the end: `+=` builds a rope, and the per-character cost stayed flat from 100 000 to 1 600 000 characters, flattening included (it rose 3 to 5 times by 6 400 000 characters, not quadratically); it is quadratic when the string is read after every append ✅[^lab] (measured here, §3.10). |
| "Objects with more than 128 properties become dictionaries." | Only for some ways of building them: `JSON.parse` switched at 128 keys, computed-key stores at about 20, but named stores, literals and `Object.fromEntries` stayed fast up to 1020 keys ✅[^lab]. |
| "Double fields are stored unboxed in the object." | Not in this build: a Double field points to a 16-byte heap number, 48 bytes against 32 for `{ x }`, and 16 more per extra double field at every size tried (up to 10 fields) ✅[^lab]. The V8 page describes the box under pointer compression ✅[^v8-fields]. Double unboxing was turned off with pointer compression in 2020 ✅[^v8-ptrcomp], and Node.js 24 does not re-enable it even without pointer compression ✅[^lab]. |
| "`%DebugPrint` shows the elements kind only in a debug build of the d8 shell." | The release Node.js 24 build prints the map, its elements kind, the in-object count and each property's location ✅[^lab] (§1.1, §3.2, §3.3). |
| "`é` or other accented letters make a string two-byte." | A character above U+00FF does (U+0100 and up); Latin-1 letters such as `é` and `ÿ` (up to U+00FF) stay one-byte ✅[^lab]. A slice of a two-byte parent stays two-byte even when its own characters are all ASCII ✅[^lab] (§3.10). |

The two timings behind the holey-array and preallocation rows:

<details>
<summary>Lab: <code>holey.mjs</code> (timing: the numbers vary per run)</summary>

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

</details>

<details>
<summary>Lab: <code>prealloc.mjs</code> (timing: the numbers vary per run)</summary>

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

</details>

### 6.2 Pitfalls

- **Literal getters are slow objects.** `{ get v() {…} }` is in dictionary mode from the start ✅[^lab]. Put accessors on a class prototype, or add them with `Object.defineProperty`.
- **Computed keys in constructors.** A constructor that loops over a field list with `this[name] = …` produces dictionary-mode instances after about 20 fields from an empty literal, 26 from an instance of an empty class ✅[^lab] (the count depends on how many in-object slots the object starts with, §3.4).
- **A `JSON.parse` result with 128 or more keys is a dictionary** ✅[^lab]; a `Map` is cheaper per entry for large lookup tables (§4.1) ✅[^lab].
- **Small slices of big strings.** A slice of 13 characters or more keeps its parent alive ✅[^lab] ✅[^v8-string]; copy it when the parent is large and the slice lives long.
- **One stray value changes the whole array.** One string in a double array makes every later double a 24-byte box ✅[^lab]; one `NaN` or `-0` makes a Smi array a double array ✅[^lab] ✅[^v8-elements].
- **`Object.assign({}, x)` does not copy the shape**, `{ ...x }` does ✅[^lab]. When many copies flow into the same hot function, this decides how many shapes it sees ([v8-hidden-classes.md](v8-hidden-classes.md)).
- **Natives are for experiments.** `%HasFastProperties` and the like work only with `--allow-natives-syntax`; this doc uses them in the lab, never in application code.

## Verification status

- **Measured** on 2026-11-26, Node.js 24.22.1 (V8 13.6.233.17-node.58) in `node:24.22.1-alpine` on arm64 with `--network none`: every ✅[^lab] claim; 34 scripts in 35 runs, each embedded with its command and output. Each script was run at least twice; deterministic outputs matched byte for byte; timings and some memory figures varied as noted. An independent review on the same day re-ran all 29 runs of the original 28 scripts: every deterministic output matched byte for byte; the timing and memory outputs matched in conclusion, with the one exception of a single holey-sum round (§6.1). The review then added six variation scripts (`delete-var`, `fill-var`, `limits-var`, `fieldmem-var`, `twobyte`, `concat-var`) and re-ran `holey.mjs` and `prealloc.mjs` with other sizes (those two edits are described in §6.1, not embedded).
- **Read only** (source or docs, not run): the 43 % heap saving of pointer compression (2020), the 2017 proxy benchmark gains, the 2018 hash-code storage change, the 21 elements kinds, the source constants quoted in §5 (each also observed in the lab except the maximum string length and the 4 preallocated slots). The review re-opened every source cited, and the `DeleteObjectPropertyFast` check was repeated at seven tags.
- **Not checked:** a build with pointer compression on (only the official build was available), V8 versions before 13.6 in the lab (the `delete` history comes from the source only), the exact commit that removed the delete fast path and the one that added the `fill` exception.

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
- [Pointer compression in V8](https://v8.dev/blog/pointer-compression) — V8 team (Igor Sheludko, Santiago Aboy Solanes), 2020-03-30. Rank 4. Backs: §1.1, §3.1, §3.2, §6.1 (Smi width, tag bit, 4 GB range, 43 %, double unboxing disabled). [^v8-ptrcomp]
- [The story of a V8 performance cliff in React](https://v8.dev/blog/react-cliff) — V8 team (Benedikt Meurer, Mathias Bynens), 2019-08-28. Rank 4. Backs: §3.2 (deprecation and migration, initial values, `null`). [^v8-react]
- [Fast properties in V8](https://v8.dev/blog/fast-properties) — V8 team (Camillo Bruni), 2017-08-30. Rank 4. Backs: §1.1, §3.3, §3.4, §3.5, §3.12 (in-object count, dictionary properties, elements kept apart, map holds the prototype). [^v8-fastprops]
- [Slack tracking in V8](https://v8.dev/blog/slack-tracking) — V8 team (Michael Stanton), 2020-09-24. Rank 4. Backs: §1.1, §3.3, §5 (eight extra slots, seven constructions). [^v8-slack]
- [Elements kinds in V8](https://v8.dev/blog/elements-kinds) — V8 team (Mathias Bynens), 2017-09-12, updated 2025-02-28. Rank 4. Backs: §1.1, §3.6, §3.7, §6.1, §6.2 (21 kinds, the lattice, holey forever and the `fill` exception, `-0`/`NaN`/`Infinity`, literal and `push` advice). [^v8-elements]
- [Optimizing hash tables: hiding the hash code](https://v8.dev/blog/hash-code) — V8 team (Sathya Gunasekaran), 2018-01-29. Rank 4. Backs: §3.11. [^v8-hash]
- [Optimizing ES2015 proxies in V8](https://v8.dev/blog/optimizing-proxies) — V8 team (Maya Armyanova), 2017-10-05. Rank 4. Backs: §3.13. [^v8-proxy]
- Lab: 34 scripts (35 runs) on Node.js 24.22.1 (V8 13.6.233.17-node.58), image `node:24.22.1-alpine`, arm64, `--network none`, 2026-11-26; each script, command and output is embedded next to the claim it backs. [^lab]

## Related

- [V8 hidden classes and inline caches](v8-hidden-classes.md) — shapes, transitions, inline caches; this doc adds the storage under them.
- [V8 compiler pipeline deep dive](v8-compiler-pipeline-deep-dive.md) — tiers, feedback, inline-cache states and deoptimization.
- [V8 memory and startup deep dive](v8-memory-and-startup-deep-dive.md) — heap spaces, garbage collection, what keeps memory alive, startup.
- [Private class fields: `#x` versus TypeScript `private`](private-fields.md) — what `#x` fields are at run time.
- [Default heap limit of a Node.js worker thread in a memory-limited container](node-worker-default-heap-limit.md) — heap limits for worker threads.
- [Performance problem classes hidden by language and runtime features](../performance/code-review/problem-classes-language-runtimes.md) — the `object-shape-instability` class, whose advice §6.1 checks.
