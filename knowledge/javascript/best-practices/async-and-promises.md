---
schema: knowledge-doc/v1
type: reference
topic: javascript/best-practices
status: verified
applies-to: ["Node.js 24.22.1 (V8 13.6.233.17, linux arm64, pointer compression off), lab of 2026-11-26", "other builds 2026-11-27 on Node.js 22.23.4, 25.7.0, a Node.js 24.22.3 pointer-compression build, Electron 43.7.7 and Google Chrome 158.0.8127.89 (V8 12.4 to 15.8)", "cross-engine checks 2026-11-28 on Firefox 161 (SpiderMonkey) and JavaScriptCore (macOS 26.1 shell, Bun 1.4.5, a WebKit page)", "re-run 2026-11-28 after a restart of the lab machine (language catalog and cross-engine checks)", "Node.js 15 and later for rejection handling, Node.js 18 and later and Web APIs for AbortSignal"]
last-verified: 2026-11-28
last-updated: 2026-11-28
tags: [javascript, best-practices, async, promises, await, microtasks, abort-signal, unhandled-rejection]
derived-from: [js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md]
ranked-sources: true
---

# JavaScript best practices: async functions and promises

## Summary
**TL;DR:** Eight practices for what `await`, floating promises and cancellation cost or break in JavaScript and TypeScript. An `await` on a plain value costs one microtask turn: 1,000 of them in a loop gave a competing microtask chain 1,001 turns where the synchronous loop gave it 1 ✅[^lab], with the same counts on V8, SpiderMonkey and JavaScriptCore ✅[^lab-cross]. The other six practices are about ownership and correctness: since Node.js 15 an unhandled rejection is raised as an uncaught exception by default ✅[^node15], and removing `return await` for speed gains nothing ✅[^mdn-await].
**Use this when:** you write or review `async` code that loops over many elements, starts several calls, starts work it does not await, or calls `fetch` and other APIs that take an `AbortSignal`.
**Not this doc:** array, error and TypeScript patterns → [language-patterns.md](language-patterns.md); what keeps memory alive (listeners, timers, closures) → [memory-and-garbage-collection.md](memory-and-garbage-collection.md); the Node.js event loop, thread pool and `*Sync` APIs → [nodejs-event-loop-and-threads.md](nodejs-event-loop-and-threads.md) and [nodejs-worker-threads.md](nodejs-worker-threads.md); the browser main thread → [browser-rendering-and-interaction.md](browser-rendering-and-interaction.md); the lab scripts → [problem-classes-javascript-language.md](../../performance/code-review/problem-classes-javascript-language.md) and [v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md).

## Scope
The catalog covers eight practices, `JL-A1` to `JL-A8`. Measured counts come from Node.js 24.22.1 (V8 13.6.233.17, Linux on arm64, pointer compression off) on 2026-11-26 ✅[^lab], run again on 2026-11-27 on Node.js 22.23.4 (V8 12.4), 25.7.0 (V8 14.1), Electron 43.7.7 (V8 15.0), macOS on arm64, emulated x64, a Node.js 24.22.3 pointer-compression build and Google Chrome 158.0.8127.89 (V8 15.8.62.31, headless page) ✅[^lab-matrix]. V8 is the engine of Chrome and Node.js, SpiderMonkey the engine of Firefox, and JavaScriptCore the engine of WebKit ✅[^jsc] and of Bun ✅[^bun]. `JL-A1`, `JL-A2` and `JL-A8` were also checked on 2026-11-28 on SpiderMonkey (Firefox 161, a page) and JavaScriptCore (the `jsc` shell of macOS 26.1, Bun 1.4.5, a WebKit build's page) ✅[^lab-cross], each with an **Other engines** line; Safari itself was not run, and `JL-A3` to `JL-A7` were not checked on other engines. `JL-A3` to `JL-A7` rest on the Node.js docs, MDN (MDN Web Docs, the Mozilla Developer Network reference), the WHATWG DOM (Document Object Model) Standard and the typescript-eslint docs, as each note says.

**How the timings were taken.** The conclusions are the order of events and the ratio between the forms, which held in both runs; the absolute times are quoted as the machine printed them under that load and will differ on another machine or under another load.
- **Machine.** Every lab ran on one Apple M2 laptop with macOS 26.1; the Linux builds ran in containers in a virtual machine on it, and the x64 builds were emulated ✅[^lab] ✅[^lab-matrix].
- **Each lab was run twice.**
  - The **first run**: the baseline on 2026-11-26 ✅[^lab] ✅[^lab-node], the other builds and the Chrome 158 page variants on 2026-11-27 ✅[^lab-matrix] ✅[^lab-node], and the cross-engine checks in the night to 2026-11-28, before the lab machine was restarted ✅[^lab-cross]; the runner did not yet check for a locked screen or keep one browser window at a time, so the conditions of that run are not fully known.
  - The **re-run** (2026-11-28, after the restart): every script was taken from the lab docs and run again with the screen unlocked, one browser window at a time and one timing run at a time, while other, untimed jobs ran on the machine; the language catalog's results all matched ✅[^lab] and no verdict of the cross-engine checks changed ✅[^lab-cross].
- **Load:** the turn counts of the language catalog and the order checks of the Node.js runtime catalog print no time, so no load applies to them; for the cross-engine checks the one-minute load average was 2.1 to 13.8 at the start of the runs in the first run, and in the re-run 3.0 to 11.7 at the start of the runs of the microtask-chain check of `JL-A8` (the turn counts of `JL-A1` and `JL-A2` print no time, and the lab doc prints no load for them) ✅[^lab-cross].
- **Counts and timings.** Counts were the same in both runs; the only timings here are those of `JL-A8`'s **Other engines** line, which gives both runs.

How to read the **Applies** column: `always` (the better form is as clear as the other: use it by default), `hot path` (only in code that runs per request, per frame or per element of a large collection, or that a profile points at), `large data` (only above the size the note gives), `startup` (only when start time matters), `check build` (the answer depends on the engine version or build), `no gain` (the lab measured no useful difference, or the advice is outdated: there is no reason to rewrite code for it). Correct and clear code comes first: a practice here chooses between two equally clear forms, and justifies a less clear one only where its "Applies" condition holds.

| Term | Plain meaning | Everyday comparison |
|---|---|---|
| Microtask | A small queued callback, such as a promise reaction, that runs before the engine returns to timers and I/O (input and output) | A cook's side orders, all served before the next table is seated |
| Microtask turn | One point where an `async` function pauses and the engine runs every other queued microtask before resuming it | A cook who steps away after every onion to serve all waiting side orders |
| Floating promise | A promise nobody awaits, returns or catches | A courier sent without a return address |
| Unhandled rejection | A rejected promise with no handler attached in time | A returned parcel with nobody at the address to sign for it |
| `AbortSignal` | A read-only object passed to async APIs that should stop when the caller no longer wants the work ✅[^node-globals] | A red flag on a job site that every worker watches |

## Catalog
| Id | Situation in the code | Practice | Applies | Evidence |
|---|---|---|---|---|
| `JL-A1` | `await` on a sync value or a no-I/O `async` function per element; `for await` over an in-memory array | Call sync code without `await`; `for…of` for arrays; `await` once where the I/O is | hot path | n = 1,000 on Node.js 24.22.1: a competing microtask chain ran 1 turn during the plain loop, 1,001 with `await` per value, 2,003 with `for await` ✅[^lab]; the same on V8 12.4 to 15.8 ✅[^lab-matrix] |
| `JL-A2` | A change from `return await p` to `return p` made for speed | Keep `return await p`; it is not slower on native promises | no gain | 1,000 awaited calls on Node.js 24.22.1: `return p` 3,001 turns, `return await p` 2,001 ✅[^lab]; MDN says it is at least as fast ✅[^mdn-await] |
| `JL-A3` | `await` inside a loop on calls that do not depend on each other; `Promise.all` over an unbounded list | `Promise.all` for small bounded lists; a pool of c in flight (for example `p-limit`) for large ones | always | Sourced: promises represent work already in progress ✅[^mdn-promise]; awaiting in a loop is right only when iterations depend on each other ✅[^eslint-await] |
| `JL-A4` | A promise-returning call as a bare statement, `void doWork()` with no `.catch`, promise arrays never combined | Await, return, `.catch`, or hand to a supervisor that catches; combine arrays with `Promise.all` or `allSettled` | always | Sourced: the default unhandled-rejection mode changed from `warn` to `throw` in Node.js 15 ✅[^node15]; `void` does not handle the promise ✅[^ts-eslint-floating] |
| `JL-A5` | `const p = a(); await b(); await p;` or a stored promise awaited later | Start both in `Promise.all`, or attach `.catch` before the next `await` | always | Sourced: Node.js reports a rejection with no handler attached within one turn of the event loop ✅[^node-rejection] |
| `JL-A6` | An `async` function calling `fetch` or another `{ signal }` API without a `signal` parameter | Accept `signal` and pass it on; join timeouts with `AbortSignal.any([signal, AbortSignal.timeout(ms)])` | always | Sourced: `AbortSignal` has `timeout` and `any` members, so a caller's signal and a deadline can be joined ✅[^whatwg-abort] |
| `JL-A7` | `signal.addEventListener('abort', fn)` with no `once` and no removal | Pass `{ once: true }`, or remove the listener after cleanup | always | Sourced: Node.js recommends `{ once: true }` for abort listeners ✅[^node-globals] |
| `JL-A8` | A CPU-heavy loop over a large input inside an `async` function with no `await` in it | Know it blocks everything until it ends; split it into chunks with yields, or move it off the thread | large data | A 1,000-element synchronous loop inside an `async` function let a competing microtask chain run 1 turn on Node.js 24.22.1 ✅[^lab]; 100,000 microtasks all ran before a 0 ms timer ✅[^lab-node] |

## Lookup notes
### `JL-A1` A value that is not a promise is not awaited inside a loop
**Seen in code as:** `await` on a synchronous call (`await cache.get(k)` with a sync `get`), `await` on an `async` function with no I/O, or `for await (const x of array)` over an in-memory array.
**Prefer:**
```js
let s = 0;
for (const v of values) s = add(s, v);   // add is synchronous
const rows = await loadAll(ids);         // await once, where the I/O is
```
**Avoid:**
```js
for (const v of values) s += await v;              // v is a plain number
for (const v of values) s = await asyncAdd(s, v);  // async (a, b) => a + b
for await (const v of values) s += v;              // values is an array
```
**Why:** `await` converts a non-promise to a resolved promise and waits for it, and the function resumes only after all already-scheduled microtasks are processed ✅[^mdn-await]. An `async` function always returns a promise ✅[^mdn-async]. `for await` awaits every iteration even over a sync iterable, which MDN says makes it slower ✅[^mdn-forawait].
**Evidence:** Node.js 24.22.1 (V8 13.6, arm64), n = 1,000: a competing microtask chain ran 1 turn during the plain loop, 1,001 with `await` per plain value, 1,001 with `await asyncAdd()` per element, 2,003 with `for await` over the array (counts, not timings) ✅[^lab]. The same counts on Node.js 22.23.4 (V8 12.4), 25.7.0 (V8 14.1), Electron 43.7.7 (V8 15.0), macOS arm64, emulated x64, the Node.js 24.22.3 pointer-compression build and Chrome 158 (V8 15.8) ✅[^lab-matrix].
**Other engines:** holds on all three engines: SpiderMonkey (Firefox 161) and JavaScriptCore (macOS 26.1 shell, Bun 1.4.5, WebKit page) gave the same counts as V8 in every run: 1 turn for the plain loop, 1,001 with `await` per plain value, 1,001 with `await asyncAdd()` per element (counts; the shell with `Promise.resolve().then` in place of `queueMicrotask`) ✅[^lab-cross]. `for await` over an array was not checked there.
**Exceptions:** the value is sometimes a real promise (check first and await only then); the pause is wanted, to let other work run between items of a long loop. A resolved `await` lets only queued microtasks run, not I/O or timers: in Chrome 158 too, 100,000 chained `queueMicrotask` steps all ran before a 0 ms timer ✅[^lab-node]. Yielding to the event loop with `setImmediate` in Node.js is `JN-E3` in [nodejs-event-loop-and-threads.md](nodejs-event-loop-and-threads.md).
**Check it:** count turns of a competing chain while the loop runs: `let t = 0, done = false; const spin = () => { if (!done) { t++; queueMicrotask(spin); } }; queueMicrotask(spin); await loop(); done = true;` then print `t`. Expect about 1 after the fix, not n.
**Full lab:** [problem-classes-javascript-language.md](../../performance/code-review/problem-classes-javascript-language.md), Catalog class `await-per-sync-value`, Lookup notes script `hops.mjs`; [v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md), §4.28.

### `JL-A2` `return await p` stays; removing it gains nothing
**Seen in code as:** a review comment or lint fix that turns `return await somePromise` into `return somePromise` for speed.
**Keep writing:**
```js
async function load(id) {
  return await fetchRow(id);
}
```
**Why:** MDN says `return await promise` is at least as fast as `return promise`, because of how the specification and engines handle native promises ✅[^mdn-await]. Since V8 7.2 (V8 blog, 12 November 2018), an `await` on a native promise takes one microtick instead of a minimum of three ✅[^v8-fastasync]. The popular advice "drop the redundant `return await`" is therefore outdated for native promises.
**Evidence:** "not slower" rests on MDN's statement and on a count of microtask turns, not on a timing. Node.js 24.22.1 (V8 13.6, arm64), 1,000 awaited calls of an `async` function that returns a native promise: `async () => p()` took 3,001 turns of a competing microtask chain, `async () => await p()` took 2,001 (counts) ✅[^lab]. The same counts on all seven builds of the 2026-11-27 matrix (V8 12.4 to 15.0) and in Chrome 158 (V8 15.8) ✅[^lab-matrix]. Only native promises were tested.
**Other engines:** no gain on all three engines: `return p` took 3,001 turns and `return await p` 2,001 in SpiderMonkey (Firefox 161) and JavaScriptCore (macOS 26.1 shell, Bun 1.4.5, WebKit page), as on V8 (counts, every run) ✅[^lab-cross].
**Exceptions:** none found in the lab; promise libraries other than native promises were not measured.
**Check it:** the turn counter of `JL-A1` around 1,000 calls of each form.
**Full lab:** [problem-classes-javascript-language.md](../../performance/code-review/problem-classes-javascript-language.md), Lookup notes "Corrections found while checking the sources (2026-11-26)" and script `hops.mjs`; [v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md), §4.28.

### `JL-A3` Independent async calls start together, with a cap on how many run at once
**Seen in code as:** `for (const id of ids) results.push(await fetchOne(id))` where no call needs the previous result; or `Promise.all(list.map(fetchOne))` over a list of unbounded size.
**Prefer:**
```js
const results = await Promise.all(ids.map((id) => fetchOne(id)));  // small, bounded list
// large or unbounded list: a pool of c calls at a time (for example p-limit)
```
**Avoid:**
```js
for (const id of ids) results.push(await fetchOne(id));  // independent calls, one after another
await Promise.all(allRowsFromDb.map(sendMail));          // thousands in flight at once
```
**Why:** a promise represents work already in progress, and the combinators make async tasks run concurrently ✅[^mdn-promise], so calls started together overlap. Awaited one by one, the latency is about n · t (t = one call's time) instead of about n / c · t with c in flight (arithmetic, not a lab result). MDN does not say that `Promise.all` limits concurrency, so a large list starts every call at once.
**Evidence:** sourced, not measured: the MDN `Promise` page ✅[^mdn-promise] and the ESLint `no-await-in-loop` page, which says awaiting in a loop is right when iterations depend on each other ✅[^eslint-await].
**Exceptions:** each iteration needs the previous result; the order of side effects matters; the remote service needs calls one at a time. Calls that run on the Node.js thread pool need a cap at the pool size: `JN-E1` in [nodejs-event-loop-and-threads.md](nodejs-event-loop-and-threads.md). The same practice for fetches started from component effects: `JB-F7` in [browser-component-frameworks.md](browser-component-frameworks.md).
**Check it:** run the code against a stub with a fixed delay: total time should fall from about n · delay to about n / c · delay, and the maximum in flight should stay at c.
**Full lab:** none; the class and its sources are in [problem-classes.md](../../performance/code-review/problem-classes.md), class `concurrency-backpressure` and Lookup notes "When the usual advice does not apply".

### `JL-A4` Every promise has an owner: it is awaited, returned, caught, or handed to a supervisor
**Seen in code as:** a call that returns a promise used as a bare statement (`sendEmail();` inside an `async` function), `void doWork()` with no `.catch`, or an array of promises that is never combined.
**Prefer:**
```js
await createUser(body);                                     // local error path
backgroundTasks.run(() => sendEmail(user));                 // a named supervisor that catches and logs
await Promise.allSettled(items.map((i) => notify(i)));      // one owner for many promises
```
**Avoid:**
```js
createUser(body);         // floating: a rejection has nowhere to go
res.status(202).end();
void sendEmail(user);     // void silences the linter; it does not catch anything
```
**Why:** Node.js emits `'unhandledRejection'` when a promise is rejected and no handler is attached within one turn of the event loop ✅[^node-rejection]. With `--unhandled-rejections=throw` Node.js emits the event and, if no hook is set, raises the rejection as an uncaught exception ✅[^node-cli-rejections]; since Node.js 15 `throw` is the default, in place of `warn` ✅[^node15]. An uncaught exception makes Node.js print the stack trace to `stderr` and exit with code 1, unless an `'uncaughtException'` handler is installed ✅[^node-rejection]; so in the default mode a floating promise that rejects, with no hook set, ends the process. The Node.js documentation above is the source of the rule; which exit code and which output each mode and hook produces is shown by the spot check under Evidence. The typescript-eslint rule `no-floating-promises` reports promise-valued statements that are not awaited, returned or caught, and arrays of promises never combined; its docs warn that `void` does not handle the promise or change run-time behaviour ✅[^ts-eslint-floating].
**Evidence:** sourced, not measured: the Node.js process and command-line docs ✅[^node-rejection] ✅[^node-cli-rejections], the Node.js 15.0.0 release notes ✅[^node15] and the typescript-eslint docs ✅[^ts-eslint-floating]. The sources cover only Node.js, so what a browser does with an unhandled rejection is not stated here. An earlier check, made when this practice was first written (before the restart of the lab machine; its output was not kept), printed on Node.js 24.22.1 (arm64): a floating `Promise.reject` ended the process with the error and exit code 1 by default, only logged a warning with `--unhandled-rejections=warn`, and did nothing fatal when a `process.on('unhandledRejection')` hook was set. Run again on 2026-11-28 (Node.js 24.22.1, linux arm64 container, one process per case), each case printed this ✅[^spot].
- default: exit code 1; first line printed `/work/floating.js:3`, the source line and then `Error: floating`; the 50 ms timer never ran;
- `--unhandled-rejections=warn`: exit code 0; first line `(node:7) UnhandledPromiseRejectionWarning: Error: floating`; the timer ran;
- with a `process.on('unhandledRejection')` hook: exit code 0; first line `hook saw: floating` (no warning, no stack trace); the timer ran.

Both checks agree: in the default mode a floating rejection with no hook ends the process with exit code 1; `warn` and a hook keep it running, and the hook also silences the warning.
<details><summary>Spot check: a floating rejection in each mode</summary>

`floating.js`:
```js
// A floating rejection; with HOOK=1 an 'unhandledRejection' hook is set first.
if (process.env.HOOK) process.on('unhandledRejection', (r) => console.log('hook saw:', r.message));
Promise.reject(new Error('floating'));
setTimeout(() => console.log('still running after 50 ms'), 50);
```
```sh
for c in "node floating.js" "node --unhandled-rejections=warn floating.js" "HOOK=1 node floating.js"; do
  echo "\$ $c"; docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine sh -c "$c > out.txt 2>&1; echo exit=\$?; grep -v '^    at ' out.txt"
done
```
```text
$ node floating.js
exit=1
/work/floating.js:3
Promise.reject(new Error('floating'));
               ^

Error: floating

Node.js v24.22.1
$ node --unhandled-rejections=warn floating.js
exit=0
(node:7) UnhandledPromiseRejectionWarning: Error: floating
(Use `node --trace-warnings ...` to show where the warning was created)
(node:7) UnhandledPromiseRejectionWarning: Unhandled promise rejection. This error originated either by throwing inside of an async function without a catch block, or by rejecting a promise which was not handled with .catch(). To terminate the node process on unhandled promise rejection, use the CLI flag `--unhandled-rejections=strict` (see https://nodejs.org/api/cli.html#cli_unhandled_rejections_mode). (rejection id: 1)
still running after 50 ms
$ HOOK=1 node floating.js
exit=0
hook saw: floating
still running after 50 ms
```
</details>

**Exceptions:** none: true fire-and-forget work still needs a handler that catches and logs.
**Check it:** enable `@typescript-eslint/no-floating-promises`; run with `node --unhandled-rejections=throw` and make the call reject in a test.
**Full lab:** none; the sources are in [promise-rejections.md](../../js-runtime/promise-rejections.md), How it works and Edge cases.

### `JL-A5` The rejection handler is attached in the same turn that creates the promise
**Seen in code as:** `const p = fetchA(); await fetchB(); await p;`, or a promise stored in a field or map and awaited later.
**Prefer:**
```js
const [a, b] = await Promise.all([fetchA(), fetchB()]);
```
**Avoid:**
```js
const pa = fetchA();       // if it rejects while fetchB runs, nobody is listening yet
const b = await fetchB();
const a = await pa;
```
**Why:** rejection tracking in Node.js is based on event-loop turns: a handler attached one turn late gets `'unhandledRejection'` first and `'rejectionHandled'` later ✅[^node-rejection]. In the default `throw` mode (Node.js 15 and later) ✅[^node15] a rejection with no `'unhandledRejection'` hook is raised as an uncaught exception ✅[^node-cli-rejections], so a late handler can be too late.
**Evidence:** Both checks agree on the `setTimeout` case: a handler one event-loop turn late is too late in the default mode, while one attached in the same tick or a microtask is in time.
- **Source.** sourced, not measured: the Node.js process docs, events `'unhandledRejection'` and `'rejectionHandled'` ✅[^node-rejection] (the source doc that holds these pages was last verified on 2026-10-04). The source covers only Node.js's rejection tracking, so browsers are not covered.
- **Earlier check.** An earlier check, made when this practice was first written (before the restart of the lab machine; its output was not kept), printed on Node.js 24.22.1 (arm64): a promise rejected at start-up and given `.catch` from a `setTimeout(…, 0)` callback still ended the process with exit code 1 in the default mode.
- **Run again.** Run again on 2026-11-28 (Node.js 24.22.1, linux arm64 container, default mode, one process per case), each case printed this ✅[^spot]:
  - The handler attached in the same tick: exit code 0, first line `caught: rejected at start-up`; attached in a microtask (`queueMicrotask`), exit code 0, the same first line;
  - attached from a `setTimeout(…, 0)` callback, exit code 1, first line `/work/late.js:2` and then `Error: rejected at start-up`, and neither the handler nor the 50 ms timer ran.
<details><summary>Spot check: a handler attached in the same tick, in a microtask, and one turn late</summary>

`late.js`:
```js
// A promise rejected at start-up; its handler is attached in the same tick, in a microtask, or from a setTimeout(…, 0) callback.
const p = Promise.reject(new Error('rejected at start-up'));
const attach = () => p.catch((e) => console.log('caught:', e.message));
const when = process.argv[2];
if (when === 'same-tick') attach();
if (when === 'microtask') queueMicrotask(attach);
if (when === 'timeout-0') setTimeout(attach, 0);
setTimeout(() => console.log('still running after 50 ms'), 50);
```
```sh
for w in same-tick microtask timeout-0; do
  echo "\$ node late.js $w"; docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine sh -c "node late.js $w > out.txt 2>&1; echo exit=\$?; grep -v '^    at ' out.txt"
done
```
```text
$ node late.js same-tick
exit=0
caught: rejected at start-up
still running after 50 ms
$ node late.js microtask
exit=0
caught: rejected at start-up
still running after 50 ms
$ node late.js timeout-0
exit=1
/work/late.js:2
const p = Promise.reject(new Error('rejected at start-up'));
                         ^

Error: rejected at start-up

Node.js v24.22.1
```
</details>

**Exceptions:** the stored promise gets `.catch(...)` (or is passed to `Promise.all` or `allSettled`) before the next `await`.
**Check it:** in a test, make `fetchA` reject before `fetchB` resolves and listen for `process.on('unhandledRejection', ...)`.
**Full lab:** none; the sources are in [promise-rejections.md](../../js-runtime/promise-rejections.md), Problem and Edge cases ("Handler attached one tick late").

### `JL-A6` Async boundaries accept an `AbortSignal` and pass it to every outbound call
**Seen in code as:** an `async` function that calls `fetch` or another API taking `{ signal }` but has no `signal` parameter; a timeout that replaces the caller's signal instead of joining it.
**Prefer:**
```js
async function loadUser(id, signal) {
  signal.throwIfAborted();
  const res = await fetch(`${base}/users/${id}`, { signal });
  return res.json();
}
const signal = AbortSignal.any([req.signal, AbortSignal.timeout(5_000)]);
```
**Avoid:**
```js
async function loadUser(id) { return (await fetch(`${base}/users/${id}`)).json(); }
await loadUser(id, AbortSignal.timeout(5_000));   // drops the caller's cancellation
```
**Why:** without a propagated signal, outbound I/O and child operations can keep running after the caller has timed out or disconnected, and cancellation reaches a layer only if that layer accepts the same signal and passes it on (a consequence of how signals work: the cited pages describe what a signal does, not what happens without one, so this sentence has no mark). `AbortSignal.any` aborts when the first input aborts and keeps that input's reason ✅[^node-globals]. This applies to functions that do I/O on behalf of a request, a command or a parent operation.
**Evidence:** sourced, not measured: the Node.js globals docs (`AbortController`, `AbortSignal`, `fetch`) ✅[^node-globals] and the WHATWG DOM Standard (`AbortSignal`) ✅[^whatwg-abort]. The source doc applies to Node.js 18 and later and to Web APIs; it does not give the version that added `AbortSignal.any`.
**Exceptions:** an API that ignores the signal is not stopped by it; each layer has to honour it (same reasoning, no mark).
**Check it:** abort the controller in a test and assert the stub saw `signal.aborted === true` and the call rejected with `signal.reason`.
**Full lab:** none; the sources are in [abort-signal.md](../../js-runtime/abort-signal.md), How it works and Worked example.

### `JL-A7` Abort listeners are registered with `{ once: true }`, or removed after cleanup
**Seen in code as:** `signal.addEventListener('abort', cleanup)` with no `once` and no `removeEventListener`.
**Prefer:**
```js
signal.addEventListener('abort', cleanup, { once: true });
```
**Avoid:**
```js
signal.addEventListener('abort', cleanup);   // stays attached, with everything cleanup captures
```
**Why:** a listener stays reachable from its target, so whatever it captures stays alive while the signal lives; the same mechanism is `JL-G2` in [memory-and-garbage-collection.md](memory-and-garbage-collection.md). Node.js recommends `{ once: true }` for abort listeners so they are removed when the event is handled ✅[^node-globals]. It matters for long-lived signals, such as a server's shutdown signal or a shared controller.
**Evidence:** sourced, not measured for `AbortSignal`: the Node.js globals docs ✅[^node-globals]. The memory kept by a listener was measured for an `EventEmitter` listener on Node.js and an `EventTarget` listener in Chrome 158 (`JL-G2`).
**Exceptions:** a short-lived signal that is dropped together with its listeners.
**Check it:** a heap snapshot after many operations on the same signal: the count of `cleanup` closures should stay flat.
**Full lab:** none; the sources are in [abort-signal.md](../../js-runtime/abort-signal.md), How it works item 8 and Edge cases ("Long-lived event listener").

### `JL-A8` A long synchronous loop inside an `async` function holds the thread until it ends
**Prefer:**
```js
for (let i = 0; i < rows.length; i += 1000) {
  processChunk(rows, i, i + 1000);
  await new Promise((r) => setTimeout(r, 0));  // a macrotask yield lets I/O and timers in
}
```
**Avoid:**
```js
async function importAll(rows) {
  for (const r of rows) heavyTransform(r);   // nothing else runs until this ends
}
```
**Why:** the body of an `async` function runs on the same thread as everything else; a loop with no `await` holds it, so the lab's competing microtask chain could not run until the loop ended ✅[^lab]. Node.js's synchronous APIs block the event loop ✅[^node-dontblock]. Moving the work to another thread: `JN-E6` in [nodejs-event-loop-and-threads.md](nodejs-event-loop-and-threads.md) (the async API, not `*Sync`, in handlers) and `JN-W1` in [nodejs-worker-threads.md](nodejs-worker-threads.md) (CPU-bound work in a worker). The browser form of the same practice is `JB-R7` in [browser-rendering-and-interaction.md](browser-rendering-and-interaction.md).
**Evidence:** Node.js 24.22.1 (V8 13.6, arm64): a competing microtask chain got 1 turn while a 1,000-element synchronous loop ran inside an `async` function (count) ✅[^lab]; the same on all seven builds of the 2026-11-27 matrix and in Chrome 158 (V8 15.8) ✅[^lab-matrix]. A chain of 100,000 `queueMicrotask` steps ran completely before a 0 ms timer on Node.js 24.22.1 and in Chrome 158 too, so a microtask yield does not let timers in ✅[^lab-node]; the Node.js docs state the draining for `process.nextTick` and the microtask queue ✅[^node-process]. The chunked form with a `setTimeout` yield under **Prefer** was not measured: it is a sketch to measure.
**Other engines:** holds on all three engines: a 0 ms timer set first, then a chain of 100,000 microtasks: the chain finished before the timer ran, or in the same millisecond on a coarse timer, in every run ✅[^lab-cross]; only the times moved.
- **Over both runs,** done at 3.5 to 4.5 ms on Node.js 24.22.1, 25 to 39 ms in Chrome 158, 28 to 48 ms in SpiderMonkey (Firefox 161), 9 to 14 ms in the macOS 26.1 `jsc` shell, 2.2 to 4.9 ms in Bun 1.4.5 and 2.0 to 5.0 ms in the WebKit page, with the timer 0.0 to 22.7 ms after that (time, nine runs each) ✅[^lab-cross]. Those ranges cover both runs.
- **First run** (2026-11-28, six runs each): 3.7 to 4.5 ms on Node.js, 25 to 27 ms in Chrome, 32 to 48 ms in SpiderMonkey, 9 to 14 ms in the shell, 2.2 to 3.6 ms in Bun and 2.0 to 3.0 ms in the WebKit page, the timer 0.0 to 22.7 ms later ✅[^lab-cross].
- **Re-run** (2026-11-28, after the restart, three runs each, under a load average of 3.0 to 11.7): 3.5 to 3.7 ms on Node.js, 28.1 to 38.5 ms in Chrome, 28.0 to 34.0 ms in SpiderMonkey, 9.9 to 13.3 ms in the shell, 2.9 to 4.9 ms in Bun and 3.0 to 5.0 ms in the WebKit page, the timer 0.0 to 5.7 ms later ✅[^lab-cross].
- **Both runs.** In both runs the whole chain ran before the timer on every engine; only the times moved ✅[^lab-cross].
- The 1,000-element synchronous loop was not run off V8.
**Exceptions:** small inputs; a CLI (command-line interface) step where nothing else waits.
**Check it:** the turn counter of `JL-A1` stays at 1 for the whole loop; in a CPU profile, one long task with no gaps.
**Full lab:** [problem-classes-javascript-language.md](../../performance/code-review/problem-classes-javascript-language.md), Lookup notes script `hops.mjs` (row "sync loop, no await"); [problem-classes-nodejs-runtime.md](../../performance/code-review/problem-classes-nodejs-runtime.md), class `microtask-starvation`, Lookup notes lab run 2 and "Other builds and versions (2026-11-27)"; [problem-classes.md](../../performance/code-review/problem-classes.md), class `blocking-in-async`; [v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md), §4.29.

## Takeaways
- An `await` costs a microtask turn even on a plain value, on every engine checked ✅[^lab-cross]: keep synchronous loops synchronous. [rule-candidate]
- `return await p` took fewer turns than `return p` on native promises, not more ✅[^lab].
- Independent calls start together; a large or data-sized list needs a cap on calls in flight, which `Promise.all` does not give ✅[^mdn-promise].
- Every promise needs an owner, because Node.js 15 and later raise an unhandled rejection as an uncaught exception by default ✅[^node15].
- `async` does not move work off the thread: a synchronous loop inside it blocks microtasks, timers and I/O until it ends ✅[^lab-node].

## Verification status
- Verified: 84 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-28

## References
- Lab: the scripts of the JavaScript language catalog run in `node:24.22.1-alpine` (Node.js v24.22.1, V8 13.6.233.17-node.58, linux arm64, pointer compression off, Apple M2 under Docker) on 2026-11-26, and re-run with every build on 2026-11-28 after a restart of the lab machine (all results matching); script `hops.mjs` and its output in [problem-classes-javascript-language.md](../../performance/code-review/problem-classes-javascript-language.md), Lookup notes. Rank 1 (primary measurement). Backs: Summary, Scope, Catalog, Lookup notes, Takeaways. [^lab]
- Lab matrix: the same scripts run again on 2026-11-27 on Node.js 24.22.1 (macOS 26.1 arm64; linux x64 emulated), Node.js 22.23.4 (V8 12.4.254.21), Node.js 25.7.0 (V8 14.1.146.11), Electron 43.7.7 run as Node (V8 15.0.245.31, pointer compression on), the Node.js 24.22.3 pointer-compression build (V8 13.6, linux x64 emulated) and Google Chrome 158.0.8127.89 (V8 15.8.62.31, headless page, macOS arm64); in [problem-classes-javascript-language.md](../../performance/code-review/problem-classes-javascript-language.md), Lookup notes, "Other builds and versions (2026-11-27)". Rank 1 (primary measurement). Backs: Scope, Catalog, Lookup notes. [^lab-matrix]
- Lab Node.js runtime: lab run 2 of the Node.js runtime catalog (100,000 recursive `process.nextTick`, `queueMicrotask` and `setImmediate` steps against a 0 ms timer) in `node:24.22.1-alpine` (Node.js 24.22.1, V8 13.6.233.17, libuv 1.52.1, linux arm64) on 2026-11-26, and its `queueMicrotask` trial in Google Chrome 158.0.8127.89 (V8 15.8.62.31, headless page, macOS arm64) on 2026-11-27; in [problem-classes-nodejs-runtime.md](../../performance/code-review/problem-classes-nodejs-runtime.md), Lookup notes. Rank 1 (primary measurement). Backs: Catalog `JL-A8`; Lookup notes `JL-A1`, `JL-A8`; Takeaways. [^lab-node]
- Lab cross-engine: the engine-neutral checks of 2026-11-28 on one Apple M2: V8 in Node.js 24.22.1 (macOS arm64) and Google Chrome 158.0.8127.89, SpiderMonkey in Firefox 161.0 (headless), JavaScriptCore in the `jsc` shell of macOS 26.1 (framework 21622.2.11.11.9), Bun 1.4.5 (linux arm64 container) and the Playwright WebKit build 2311; each check script run three times per environment (first run, load average 2.1 to 13.8), and every script run again three times per environment on 2026-11-28 after a restart of the lab machine (re-run, `uptime` logged before every run); scripts and outputs in [v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md), §4.28, §4.29 and Verification status. Rank 1 (primary measurement). Backs: Summary, Scope, Lookup notes, Takeaways. [^lab-cross]
- Spot checks for this doc: the scripts in the `JL-A4` and `JL-A5` notes, run on 2026-11-28 with `docker run --rm --network none node:24.22.1-alpine` (Node.js 24.22.1, V8 13.6.233.17, linux arm64), one process per case, exit code read with `echo exit=$?` inside the container; commands and output in those notes; both were run once more by a reviewer the same day with the same output. Rank 1 (primary measurement). Backs: Lookup notes, JL-A4 and JL-A5. [^spot]
- [Node.js Process: event 'unhandledRejection'](https://nodejs.org/api/process.html#event-unhandledrejection) — Node.js project, living. Rank 1. Backs: Catalog `JL-A5`; Lookup notes `JL-A4`, `JL-A5`. [^node-rejection]
- [Node.js CLI: --unhandled-rejections=mode](https://nodejs.org/api/cli.html#--unhandled-rejectionsmode) — Node.js project, living. Rank 1. Backs: Lookup notes `JL-A4`, `JL-A5`. [^node-cli-rejections]
- [Node.js 15.0.0 release notes](https://nodejs.org/en/blog/release/v15.0.0) — Node.js project, 2020. Rank 1. Backs: Summary, Catalog `JL-A4`, Lookup notes `JL-A4`, `JL-A5`, Takeaways. [^node15]
- [Process: process.nextTick and queueMicrotask](https://nodejs.org/docs/latest-v24.x/api/process.html) — Node.js project, v24.22.3. Rank 1. Backs: Lookup notes `JL-A8`. [^node-process]
- [Don't Block the Event Loop (or the Worker Pool)](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop) — Node.js project, living. Rank 1. Backs: Lookup notes `JL-A8`. [^node-dontblock]
- [Node.js Globals: AbortController and AbortSignal](https://nodejs.org/api/globals.html#class-abortsignal) — Node.js project, living. Rank 1. Backs: Scope, Catalog `JL-A7`, Lookup notes `JL-A6`, `JL-A7`. [^node-globals]
- [DOM Standard: AbortSignal](https://dom.spec.whatwg.org/#interface-abortsignal) — WHATWG, living. Rank 1. Backs: Catalog `JL-A6`; Lookup notes `JL-A6`. [^whatwg-abort]
- [@typescript-eslint/no-floating-promises](https://typescript-eslint.io/rules/no-floating-promises/) — typescript-eslint project, living. Rank 1. Backs: Catalog `JL-A4`; Lookup notes `JL-A4`. [^ts-eslint-floating]
- [no-await-in-loop](https://eslint.org/docs/latest/rules/no-await-in-loop) — ESLint, living. Rank 1. Backs: Catalog `JL-A3`; Lookup notes `JL-A3`. [^eslint-await]
- [JavaScriptCore](https://docs.webkit.org/Deep%20Dive/JSC/JavaScriptCore.html) — WebKit project documentation, living. Rank 1. Backs: Scope (JavaScriptCore is WebKit's engine). [^jsc]
- [Welcome to Bun](https://bun.com/docs) — Bun documentation, living. Rank 1. Backs: Scope (Bun runs on JavaScriptCore). [^bun]
- [await](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/await) — MDN, modified 2026-11-23. Rank 3. Backs: Summary, Catalog `JL-A2`, Lookup notes `JL-A1`, `JL-A2`. [^mdn-await]
- [async function](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/async_function) — MDN, modified 2026-11-17. Rank 3. Backs: Lookup notes `JL-A1`. [^mdn-async]
- [for await...of](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/for-await...of) — MDN, modified 2026-11-17. Rank 3. Backs: Lookup notes `JL-A1`. [^mdn-forawait]
- [Promise](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise) — MDN Web Docs, living. Rank 3. Backs: Catalog `JL-A3`, Lookup notes `JL-A3`, Takeaways. [^mdn-promise]
- [Faster async functions and promises](https://v8.dev/blog/fast-async) — V8 team, 2018-11-12. Rank 4. Backs: Lookup notes `JL-A2`. [^v8-fastasync]

## Related
- [language-patterns.md](language-patterns.md) — array, error, spread and TypeScript patterns (`JL-L`).
- [memory-and-garbage-collection.md](memory-and-garbage-collection.md) — listeners, timers and closures that keep memory alive (`JL-G`).
- [problem-classes-javascript-language.md](../../performance/code-review/problem-classes-javascript-language.md) — the review catalog with `hops.mjs`.
- [problem-classes-nodejs-runtime.md](../../performance/code-review/problem-classes-nodejs-runtime.md) — microtask starvation and the event loop.
- [problem-classes.md](../../performance/code-review/problem-classes.md) — `concurrency-backpressure` and `blocking-in-async`.
- [promise-rejections.md](../../js-runtime/promise-rejections.md) and [abort-signal.md](../../js-runtime/abort-signal.md) — the concept docs behind `JL-A4` to `JL-A7`.
- [event-loop-and-async-await.md](../async/event-loop-and-async-await.md) — how microtasks and `await` work.
