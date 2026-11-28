---
schema: knowledge-doc/v1
type: reference
topic: javascript/best-practices
status: verified
applies-to: ["any current browser, as web.dev, MDN and the W3C state it (living pages, read 2026-11-07 to 2026-11-26)", "lab: Google Chrome 158.0.8127.89 (V8 15.8) against Node.js 24.22.1 (V8 13.6), 2026-11-27 and 2026-11-28", "lab: SpiderMonkey shell of Firefox 161.0 (linux arm64 container), 2026-11-28", "lab: Firefox 161 (SpiderMonkey) and JavaScriptCore (macOS 26.1 jsc shell, Bun 1.4.5, a WebKit page), 2026-11-28"]
last-verified: 2026-11-28
last-updated: 2026-11-28
tags: [javascript, best-practices, browser, rendering, layout, animation, long-tasks, inp, chrome]
derived-from: [js-runtime/v8-object-and-value-representation-deep-dive.md, js-runtime/v8-memory-and-startup-deep-dive.md, js-runtime/v8-compiler-pipeline-deep-dive.md, js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md]
ranked-sources: true
---

# JavaScript best practices: browser rendering and interaction

## Summary
**TL;DR:** Nine practices for code that runs between a user's input and the next frame the browser paints: which CSS properties to animate, how to read layout without forcing it again and again, how to keep long lists and event handlers cheap, and how to split work so the page stays responsive. Only `transform` and `opacity` can be animated by the compositor alone ✅[^webdev-compositor], and a task that takes longer than 50 ms is a long task ✅[^webdev-longtasks]. A closing note lists what differs inside Chrome compared with Node.js, in background tabs and on other engines, measured in the lab.
**Use this when:** you write or review CSS animations, DOM (Document Object Model) code in loops, long lists, `scroll`, `resize` or `input` handlers, click handlers that do more than update the screen, or a claim that an interface got faster; or you carry a memory or speed figure from Node.js over to a browser page.
**Not this doc:** what a page loads and in which order (images, scripts, fonts, back/forward cache) → [browser-loading-and-delivery.md](browser-loading-and-delivery.md); caching, compression and HTTP versions → [browser-network-requests.md](browser-network-requests.md); React rendering → [browser-component-frameworks.md](browser-component-frameworks.md); the same blocking problem on a Node.js server → [nodejs-event-loop-and-threads.md](nodejs-event-loop-and-threads.md); the engine mechanisms behind the closing note → the V8 deep dives listed under Related.

## Scope
The catalog covers rules `JB-R1` to `JB-R9`. Their figures are statements of web.dev (the Chrome team's guidance pages), MDN (Mozilla's web reference) and the W3C, read 2026-11-07 to 2026-11-26, about browsers in general; none of these nine rules was measured in the knowledge base's own lab, and each Evidence line says "stated by" to keep a source's figure apart from a measured one. The closing note is the exception: it was measured in Google Chrome 158.0.8127.89 (V8 15.8) on macOS arm64 against official Node.js 24.22.1 (V8 13.6) on 2026-11-27 and 2026-11-28 ✅[^lab-chrome], with a cross-check on SpiderMonkey (Firefox 161) and JavaScriptCore (Safari's engine) on 2026-11-28 ✅[^lab-cross]. Safari itself, Windows, Linux desktops and phones were not run.

**How the timings were taken.** What to take from the timings: the order of the alternatives and the ratio between them, which held in both runs unless the note says otherwise. The times in ms are quoted as the machine printed them under that load; they will differ on another machine or under another load.
- Every lab figure of the closing note comes from one Apple M2 laptop, macOS 26.1; Linux builds ran in containers in a virtual machine on it, and x64 builds were emulated.
- The Chrome figures come from two runs.
  - The first run (2026-11-27 for headless Chrome; the night to 2026-11-28 for the visible window and the background tabs, before the lab machine was restarted): the runner did not yet check for a locked screen or keep one browser window at a time, so the conditions of that run are not fully known; load not recorded ✅[^lab-chrome].
  - The re-run (2026-11-28, after the restart): screen unlocked, one browser window at a time, one timing run at a time; for the background-tab probe, nine runs were made with the machine quiet (one-minute load average 2.90 to 3.51), and for the first five runs of each mode the only figures are the logs of another batch running beside them (9.81 to 28.13, then 27.09 to 19.87), the fifth run of each mode having come after those logs (load not recorded); the workers, a tab shown again and Energy Saver were measured in the re-run only, load not recorded for the author's runs, 2.13 to 6.82 logged at the end of each run of an independent review ✅[^lab-chrome].
- The cross-engine checks: first run, one-minute load average 2.1 to 13.8 at the start of the runs; re-run, 2.11 to 37.24 (median 4.48) for the first seventeen checks, where a check that started above 13.8 was repeated at 3.4 to 8, and up to 34.82 (median 5.00) for the later checks, the loop forms among them ✅[^lab-cross].
- Byte counts, the small-integer range, heap limits and key thresholds are counts, not timings, and were the same in both runs ✅[^lab-chrome].

How to read the "Applies" column: `always` means the better form is as clear as the other, so it is the default; `hot path` means it matters only in code that runs per request, per frame or per element of a large collection, or that a profile points at; `large data` means only above the size the row gives; `startup` means only when start time matters; `check build` means the answer depends on the engine version or build; `no gain` means no useful difference was measured or the advice is outdated, so there is no reason to rewrite code for it.

Terms used below:
- **Layout** (reflow): the browser recomputing the size and position of elements, like re-measuring every shelf after moving one box.
- **Compositor**: the browser stage that moves and fades ready-made layers without layout or paint, like sliding a printed transparency over a projector.
- **Layer**: a part of the page the compositor keeps as its own picture; each one takes memory, like keeping a separate photocopy of one page element.
- **Long task**: main-thread work that takes longer than 50 ms; while it runs, the page cannot react, like a cashier who finishes one long order before looking up.
- **INP** (Interaction to Next Paint): the delay from an input to the next frame shown. **CLS** (Cumulative Layout Shift): a score of how much visible content moves unexpectedly.
- **Windowing** (virtualization): keeping only the visible rows of a long list in the DOM, like a train window that shows a few metres of a long landscape.
- **Debounce**: run a handler once the input pauses; **throttle**: run it at most once per time interval.

## Catalog
| Id | Situation in the code | Practice | Applies | Evidence |
|---|---|---|---|---|
| `JB-R1` | `transition`/`@keyframes` on `width`, `height`, `top`, `left`, `margin`, or `el.style.top` set per animation frame | Animate `transform` (`translate`, `scale`) and `opacity` instead; they run on the compositor with no layout per frame | always | Only `transform` and `opacity` can be handled by the compositor alone ✅[^webdev-compositor]; a composited `translate` does not count toward CLS ✅[^webdev-cls]. Count: a 0.5 s animation at 60 frames per second runs layout 30 times with `left`, 0 with `transform` |
| `JB-R2` | `will-change` on a broad selector or set permanently on many elements | Set `will-change` only on the element about to animate, and remove it after; each layer costs memory | always | Every layer requires memory ✅[^webdev-compositor]; excessive `will-change` leads to excessive memory use and worse performance ✅[^mdn-willchange] |
| `JB-R3` | A loop that writes a style, then reads `offsetHeight` or `getBoundingClientRect()` in the same iteration | Do all layout reads first, then all style writes, so layout runs once, not per element | hot path | Reading layout after a style change forces layout ✅[^webdev-layout]. Count: n elements, up to n forced layouts → 1 |
| `JB-R4` | Thousands of rows rendered into the DOM at once; a page over 800 DOM nodes | Window the list (only visible rows in the DOM) or use `content-visibility: auto` | large data: thousands of rows, or over 800 DOM nodes | Windowing renders only what is visible ✅[^webdev-virtual]; Lighthouse warns above 800 DOM nodes and calls over 1,400 excessive ✅[^webdev-domsize] |
| `JB-R5` | A `scroll`/`resize`/`input` handler that measures, filters or fetches on every event | `IntersectionObserver` for visibility; debounce input; throttle by time; keep the handler itself light | hot path | Scroll events can fire at a high rate ✅[^mdn-scroll]; debouncing limits handler calls ✅[^webdev-input]; a published ticket-booking case reports INP falling from roughly 870–900 ms to 350–370 ms after it cut the results fetched per call from 30 to 10, alongside a debounced scroll handler and `requestAnimationFrame` rendering, which the page gives no figures for ✅[^webdev-case-inp] |
| `JB-R6` | A scroll handler "throttled" with `requestAnimationFrame` | No reason to rewrite toward it: scroll events and frames fire at about the same rate; use an observer or a time-based throttle | no gain | MDN calls a `requestAnimationFrame` throttle of a scroll handler useless, since both fire at about the same rate ✅[^mdn-scroll] |
| `JB-R7` | One input handler that updates the UI, then computes, logs analytics and saves synchronously | Update the screen first, then `await scheduler.yield()` (fallback `setTimeout`) before the rest; keep tasks at 50 ms or less | hot path | A task that takes longer than 50 ms is a long task ✅[^webdev-longtasks] (the W3C draft defines it as a duration that exceeds 50 ms ✅[^w3c-longtasks]); `scheduler.yield()` is in Chrome and Edge 129 and Firefox 142, not Safari ✅[^webdev-longtasks]; INP is good at 200 ms or less at the 75th percentile ✅[^webdev-vitals] |
| `JB-R8` | Yielding only `if (navigator.scheduling.isInputPending())` | Yield unconditionally between chunks | no gain | web.dev no longer recommends `isInputPending()`; yield whether or not input is pending ✅[^webdev-longtasks] |
| `JB-R9` | A UI speed claim or test that times only the `fetch` or API call | Measure input to next paint (Event Timing, a DevTools trace) | always | INP is good at 200 ms or less at the 75th percentile ✅[^webdev-vitals]; the "API time is interaction time" mistake is the knowledge base's own guidance, not an outside source's |

## Lookup notes
### `JB-R1` Animate `transform` and `opacity`, not layout properties
Applies to any transition, keyframe or per-frame style change that repeats over frames.
**Seen in code as:** `transition: width | height | top | left | margin`, `@keyframes` that change `left` or `height`, or `el.style.top = …` inside each `requestAnimationFrame` callback.
**Prefer:**
```css
.panel { transition: transform 300ms, opacity 300ms; }
.panel.open { transform: translateX(240px); opacity: 1; }
```
**Avoid:**
```css
.panel { transition: left 300ms, height 300ms; }
.panel.open { left: 240px; height: 400px; }
```
**Why:** only `transform` and `opacity` can be handled by the compositor alone ✅[^webdev-compositor]; restrict animations to them and avoid properties that trigger layout or paint ✅[^webdev-animations]. Changing `top` and `left` causes layout shifts, while a composited `translate` does not count toward CLS ✅[^webdev-cls].
**Evidence:** stated by web.dev (living, read 2026-11-26), not measured here. The cost is a count: a 0.5-second animation at 60 frames per second has 30 frames, so animating `left` runs layout 30 times and animating `transform` 0 times. The sources give no frame-time figure for one against the other.
**Exceptions:** a property that changes once with no transition (a toggle) runs layout once, not per frame.
**Check it:** Chrome DevTools, Performance panel, record the animation: after the fix there are no Layout or Paint entries per frame, and CLS is not higher.

### `JB-R2` Add `will-change` only to an element about to animate, as a last resort
Applies to any `will-change` in a stylesheet or script.
**Seen in code as:** `will-change: transform` on a broad selector (`*`, every card, every list item), or set permanently "to make it fast".
**Prefer:**
```js
el.addEventListener('pointerenter', () => { el.style.willChange = 'transform'; });
el.addEventListener('animationend', () => { el.style.willChange = 'auto'; });
```
**Avoid:**
```css
.card { will-change: transform; } /* on hundreds of cards, always */
```
**Why:** `will-change` makes the browser prepare for a change ahead of time, and every layer it creates requires memory ✅[^webdev-compositor]; excessive `will-change` leads to excessive memory use and worse performance ✅[^mdn-willchange].
**Evidence:** stated by MDN and web.dev (living, read 2026-11-26), not measured here. MDN calls `will-change` a last resort for an existing problem, not a default ✅[^mdn-willchange].
**Exceptions:** an element with a measured animation problem that `will-change` fixes, kept for the duration of the animation.
**Check it:** Chrome DevTools, Layers panel: the layer count and the memory it reports, before and after.

### `JB-R3` Read layout values before writing styles, not in between
Applies to a loop over elements, or code that runs per frame or per event, that writes a style and then reads `offsetHeight`, `offsetWidth`, `getBoundingClientRect()`, `scrollTop` or `clientWidth`.
**Prefer:**
```js
const heights = items.map((el) => el.offsetHeight); // all reads first
items.forEach((el, i) => { el.style.height = `${heights[i] + 8}px`; }); // then writes
```
**Avoid:**
```js
for (const el of items) {
  el.style.height = `${el.offsetHeight + 8}px`; // read after the previous write: forced layout each time
}
```
**Why:** reading a layout value after a style change forces the browser to run layout at once to answer it ✅[^webdev-layout]. In a loop that alternates writes and reads, layout runs once per element instead of once in all ("layout thrashing").
**Evidence:** stated by web.dev ("Avoid large, complex layouts and layout thrashing", living), not measured here. Count: n elements give up to n forced layouts before the fix, 1 after.
**Exceptions:** a single read after a single write outside any loop costs one layout; rewriting it gains nothing.
**Check it:** Chrome DevTools, Performance panel: the Layout entries inside the loop's task fall from about one per element to one.

### `JB-R4` Render only the visible part of a long list
Applies above thousands of rows rendered at once, or a page over 800 DOM nodes, typically `items.map(item => <Row …/>)` or a loop appending one element per item over a list with no page limit.
**Prefer:**
```css
.row { content-visibility: auto; contain-intrinsic-size: auto 48px; }
/* or windowing with a library such as react-window: only the rows in view are in the DOM */
```
**Avoid:**
```js
list.append(...rows.map(renderRow)); // 10,000 rows, all in the DOM
```
**Why:** render and DOM work grow with every row, visible or not. Windowing renders only what is visible ✅[^webdev-virtual], so the work grows with the viewport, not with the data. The first performance catalog names `content-visibility: auto` as the CSS-only alternative and gives no figure for it.
**Evidence:** stated by web.dev ("Virtualize large lists with react-window", "How large DOM sizes affect interactivity", living), not measured here: Lighthouse warns above 800 DOM nodes and calls a DOM over 1,400 nodes excessive ✅[^webdev-domsize]. The sources give no row-count threshold; "thousands" is the catalog's wording.
**Exceptions:** a short list whose size the code fixes (a menu, a few settings).
**Check it:** `document.querySelectorAll('*').length` in the console on the real page; the Lighthouse audit "Avoid an excessive DOM size".

### `JB-R5` Keep `scroll`, `resize` and `input` handlers light: use an observer, or throttle by time
Applies to any handler on `scroll`, `resize`, `input` or `pointermove` that measures elements, filters data or fetches on every event.
**Seen in code as:** `addEventListener('scroll', …)` that measures elements, filters data or fetches on every event.
**Prefer:**
```js
const io = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) loadMore();
});
io.observe(sentinel);
// for typing: debounce (run the handler once the input pauses)
```
**Avoid:**
```js
window.addEventListener('scroll', () => {
  if (sentinel.getBoundingClientRect().top < innerHeight) loadMore();
});
```
**Why:** scroll events can fire at a high rate ✅[^mdn-scroll], so per-event work multiplies. `IntersectionObserver` calls back only when visibility changes, and debouncing inputs limits handler calls ✅[^webdev-input].
**Evidence:** stated by MDN and web.dev ("Optimize input delay", living), not measured here. In a ticket-booking site's case published on web.dev (a production case, not measured here), the scroll handler was debounced, rendering work was scheduled in a `requestAnimationFrame` callback, and fetching 10 results per call instead of 30 is the change the page ties to INP falling from roughly 870–900 ms to 350–370 ms ✅[^webdev-case-inp]; the page gives no figure for the first two changes, and the improved figure still missed the good level of 200 ms ✅[^webdev-vitals].
**Exceptions:** a handler that only sets a flag or stores a number is already light.
**Check it:** Chrome DevTools, Performance panel, record a scroll burst: main-thread time per burst, before and after.

### `JB-R6` A `requestAnimationFrame` wrapper does not throttle a scroll handler
Applies to a scroll handler wrapped so that it runs at most once per `requestAnimationFrame`, presented as a throttle. The change does not lower the call rate.
**Keep writing:** an `IntersectionObserver`, or a time-based throttle (`setTimeout` or a timestamp check), as in `JB-R5`.
**Why:** scroll events and animation frames fire at about the same rate, so a frame-based throttle does not lower the call rate ✅[^mdn-scroll].
**Evidence:** stated by MDN ("Document: scroll event", living), recorded as a correction on 2026-11-25, not measured here: MDN calls throttling a scroll handler with `requestAnimationFrame` useless and advises throttling by time or using `IntersectionObserver` ✅[^mdn-scroll].
**Exceptions:** the case of `JB-R5` used `requestAnimationFrame` to coordinate rendering, not to cut the handler rate; this note is only about using it as a throttle.
**Check it:** count handler calls per second with and without the wrapper (`performance.now()` timestamps in the handler).

### `JB-R7` Break main-thread work longer than 50 ms into pieces, and show the visible update first
Applies to click, key or input handlers that do more than update the screen: for example one handler that updates the UI, then sorts or parses a large array, sends analytics and saves, all in one synchronous run.
**Prefer:**
```js
const yieldToMain = () =>
  globalThis.scheduler?.yield ? scheduler.yield() : new Promise((r) => setTimeout(r, 0));
button.addEventListener('click', async () => {
  renderSelection();        // visible update first
  await yieldToMain();
  sendAnalytics(); saveDraft();
});
```
**Avoid:**
```js
button.addEventListener('click', () => {
  renderSelection(); sendAnalytics(); saveDraft(); recomputeAll(); // one long task
});
```
**Why:** while a task runs, the page cannot respond to the next input or paint. A task that takes longer than 50 ms is a long task ✅[^webdev-longtasks]; web.dev's own example says one long task in a click handler leaves the interaction measured as a poor INP ✅[^webdev-longtasks]. `scheduler.yield()` ends the current task and runs the continuation before other similar tasks, so the browser can handle input in between ✅[^webdev-longtasks].
**Evidence:** stated by web.dev ("Optimize long tasks", 2024, read 2026-11-26) and the W3C Long Tasks API (a discontinued draft, 2026; its definition says a duration that exceeds 50 ms, while its introduction says "50ms or more" ✅[^w3c-longtasks]), not measured here: `scheduler.yield()` is supported in Chrome and Edge 129 and Firefox 142, not in Safari, so a `setTimeout` fallback stays; do the visible update first and yield before analytics or saving ✅[^webdev-longtasks]. INP is good at 200 ms or less; all three Web Vitals are judged at the 75th percentile, mobile and desktop separately ✅[^webdev-vitals].
**Exceptions:** work that must finish before the screen can be correct (the visible update itself) stays in front of the yield.
**Check it:** Chrome DevTools, Performance panel: tasks with a red corner (long tasks) in the interaction; the Interactions track shows its INP. Field data: INP at the 75th percentile per device class.
**Related, not the same rule:** the same problem on a Node.js server (a long synchronous loop or `*Sync` call blocking the event loop) is `JL-A8` in [async-and-promises.md](async-and-promises.md), `JN-E6` in [nodejs-event-loop-and-threads.md](nodejs-event-loop-and-threads.md) and `JN-W1` in [nodejs-worker-threads.md](nodejs-worker-threads.md); they use Node.js APIs, this rule uses browser ones.

### `JB-R8` Yield unconditionally; gating on `navigator.scheduling.isInputPending()` is outdated
Applies to `if (navigator.scheduling?.isInputPending()) yield…` inside a work loop.
**Keep writing:** an unconditional yield between chunks of work, as in `JB-R7`.
**Why:** web.dev's current advice is to yield whether or not input is pending, so a yield gated on pending input is not needed ✅[^webdev-longtasks].
**Evidence:** stated by web.dev ("Optimize long tasks", 2024), recorded as a correction on 2026-11-26, not measured here: web.dev no longer recommends `isInputPending()` ✅[^webdev-longtasks].
**Exceptions:** none found in the sources.
**Check it:** search the code for `isInputPending`; each use is a candidate for an unconditional yield.

### `JB-R9` Judge an interaction by input-to-paint time, not by API time
Applies when a UI speed-up is reported or tested: a claim that an interaction is fast because the API call behind it returns quickly, or a test that times only the `fetch`.
**Prefer:**
```js
new PerformanceObserver((list) => {
  for (const e of list.getEntries()) console.log(e.name, e.duration); // input to next paint
}).observe({ type: 'event', durationThreshold: 16, buffered: true });
```
**Avoid:**
```js
const t = performance.now(); await fetch(url); console.log(performance.now() - t); // not what the user waits for
```
**Why:** after the response arrives the page still parses, renders and paints, and that work is part of what the user waits for, so a fast backend alone does not make a responsive interface. This is the knowledge base's own guidance, not a statement of an outside source: the profiling table in [runtime-and-client-performance.md](../../performance/runtime-and-client-performance.md) (checked 2026-11-07) lists "treating API time as interaction time" as the mistake to avoid and a browser trace from input to paint as the artifact to keep, and the closing lesson of [case-ui-interaction.md](../../performance/case-ui-interaction.md) says to measure input to paint; neither of those two pages carries a source mark. The `PerformanceObserver` code above and the DevTools Interactions track are not in the source catalogs either.
**Evidence:** sourced: INP is good at 200 ms or less at the 75th percentile ✅[^webdev-vitals]; the ticket-booking case of `JB-R5` reports INP of roughly 870–900 ms before and 350–370 ms after the client fetched 10 results per call instead of 30 ✅[^webdev-case-inp] (the knowledge base reads the case as work on the main thread, not a backend change). Not measured here.
**Exceptions:** none found in the sources.
**Check it:** Chrome DevTools, Performance panel, Interactions track: the interaction's duration split into input delay, processing and presentation.

### What is different inside Chrome compared with Node.js, in background tabs, and on other engines
Not a rule and not in the Catalog: a note for anyone carrying a figure from Node.js to a page. Chrome builds V8 with **pointer compression** on: every slot that holds a small integer or a reference is 4 bytes instead of 8, and the heap lives in one 4 GB block of addresses (like writing only a room number because everyone lives in one building) ✅[^v8-ptrcomp]. Chrome 80 turned it on ✅[^v8-dev-80]; official Node.js builds have it off ✅[^lab-chrome]. Measured in Chrome 158.0.8127.89 (V8 15.8), macOS arm64, headless, each script in a `file://` page with V8 flags passed through `--js-flags`, against official Node.js 24.22.1 (V8 13.6), 2026-11-27:
- **Small integers end at 2³⁰ − 1 (1,073,741,823)**, not 2³¹ − 1: `%IsSmi(2 ** 30 - 1)` is `true` and `%IsSmi(2 ** 30)` is `false`; −2³⁰ is a small integer and −2³⁰ − 1 is not ✅[^lab-chrome]. An integer from 2³⁰ to 2³¹ − 1 (a Unix time in seconds in 2026 is about 1.8 × 10⁹) is a small integer in Node.js and a boxed heap number in Chrome, so code tuned on one can behave differently on the other. The number-range rules are in [numbers-and-arrays.md](numbers-and-arrays.md).
- **Pointer-heavy data takes about half the bytes; raw data the same.** Bytes per element, official Node.js 24.22.1 (emulated linux x64) → Chrome 158 (`usedJSHeapSize` after `gc()`): small integers in an array 8.0 → 4.0; an object `{ x, y }` with its array slot 48.0 → 24.0; an object used as a dictionary 63.0 → 31.5; a `Map` entry 36.7 → 18.4; unchanged: a double array 8.0, `Float64Array` / `Int32Array` contents 8.0 / 4.0, string characters 1.0 / 2.0 ✅[^lab-chrome]. The V8 team reports, for browsing tests, a V8 heap up to 43% smaller and a renderer process up to 20% smaller ✅[^v8-ptrcomp]. So a memory estimate for pointer-heavy data made on an official Node.js build can be up to about twice what the same data takes in a page. No whole application was measured here.
- **One page's JavaScript heap has a fixed ceiling.** On a 16 GiB Mac, `performance.memory.jsHeapSizeLimit` was 4,192 MiB and `--js-flags=--max-old-space-size=8192` did not raise it; Node.js 24.22.1 on the same machine followed the flag (8,384 MiB) ✅[^lab-chrome].
- **Object literals go to dictionary mode at 128 keys** in Chrome 158 (as on V8 14.1 and 15.0), against 1,021 on Node.js 24 (V8 13.6) ✅[^lab-chrome]: `JE-O7` in [objects-and-shapes.md](objects-and-shapes.md).
- **What a page can read about its own memory:** `performance.memory.usedJSHeapSize` and `jsHeapSizeLimit`; the used size is exact only with `--enable-precise-memory-info`, and `gc()` needs `--js-flags=--expose-gc`. In daily work the developer tools' Memory and Performance panels are the practical route (general guidance, not measured here). In these runs `usedJSHeapSize` included `ArrayBuffer` contents (a 64 MiB buffer added 64.0 MiB, even untouched; cause not examined), which Node.js's `heapUsed` does not, so typed arrays need care when the two are compared; `performance.measureUserAgentSpecificMemory()` was not defined on the test page (`crossOriginIsolated` was `false`); V8's own printed output (`%DebugPrint`, trace flags) cannot be read from a headless page ✅[^lab-chrome].
- **Headless benchmarking:** headless Chrome sometimes ran the page's V8 in efficiency mode, so hot code stayed in Maglev (V8's middle compiler) and never reached TurboFan (its top compiler); `--disable-renderer-backgrounding` avoids it ✅[^lab-chrome]. Both runs saw it, less often in the re-run: of 18 functions of one script, 12, 10 and 5 stayed in Maglev code in three runs of the first run (2026-11-27), and 4, 6, 7, 3 and 8 in five runs of the re-run (2026-11-28, after the restart, load not recorded) ✅[^lab-chrome] (see [measuring-performance.md](measuring-performance.md)).
- **Background tabs run slower code.** In a visible Chrome 158 (macOS arm64), in a tab behind another tab, a minimized window and a covered window, a hot function stayed in Maglev code (V8's middle compiler, below TurboFan) and never reached TurboFan code in either run. Over both runs: 0 of 39 background runs reached TurboFan code, and on a quiet machine, or with load not recorded, they took about 1.4 to 2.1 times as long as the front tab, and up to 2.5 times in the re-run's loaded runs (58.5 against 23.0 ms); in both runs the hot function still was Maglev code after 5,460,000 calls over 19.9 s ✅[^lab-chrome].
  - First run (night to 2026-11-28): 0 of 15 runs (5 per case), 200,000 timed calls took 38.4 to 48.3 ms against 23.5 to 25.7 ms in the front tab, where TurboFan code was in place in 5 of 5 runs; load not recorded ✅[^lab-chrome].
  - Re-run (2026-11-28, after the restart): 0 of 24 runs (8 per case), 39.2 to 41.6 ms in the nine runs made with the machine quiet (load average 2.90 to 3.51; up to 58.5 ms in the first five runs of each mode, beside a batch whose log read 9.81 to 28.13 and the runs after it, 27.09 to 19.87) against 23.0 to 27.5 ms in the front tab, where TurboFan code was in place at the end in 10 of 10 runs (two front-tab runs of the loaded part took 52.4 and 59.0 ms with a compile still pending) ✅[^lab-chrome].
  - So heavy computation that goes on in a background tab runs slower code there. So nothing may be benchmarked in a background tab: `JE-M13` in [measuring-performance.md](measuring-performance.md).
  - **Four more results, Chrome 158 on macOS arm64** (the mechanism is an inference: V8 treats a hidden renderer as a background process; no run read its priority):
    - workers of a hidden page also stayed in Maglev code, a dedicated worker in 5 of 5 runs (156.6 to 212.8 ms for 200,000 timed calls against 25.3 to 30.0 ms in the front tab) and a shared worker in 3 of 3 (165.1 to 542.7 ms against 30.0 to 36.3 ms; the largest hidden figure, 542.7 ms, and the 36.3 ms came in the loaded part of the re-run, load not recorded), so moving work to a worker does not avoid it ✅[^lab-chrome].
    - A tab shown again got TurboFan code back 7.8 to 7.9 s after it was shown (5 of 5 runs, after 3,500,000 calls; 7.9, 7.8 and 8.1 s in three more runs of an independent reviewer, one-minute load average 3.31 to 4.42 at the end of each; the batch medians dropped from 107 to 140 ms while hidden to 26 to 39 ms once shown), so wait about 8 seconds after bringing a tab to the front ✅[^lab-chrome].
    - Chrome's Energy Saver, on, kept even the front tab in Maglev code (3 of 3 runs, 39.4 to 41.5 ms; TurboFan with it off) ✅[^lab-chrome].
    - **A hidden tab's code also ran slower from the script's fourth task on,** with TurboFan code at every reading (`--no-efficiency-mode`).
      - First run (night to 2026-11-28, two runs): later batches 32.7 to 187.3 ms against 24.7 to 28.4 ms for the first three, no medians taken; with `--disable-renderer-backgrounding` (one run) every batch took 21.4 to 57.6 ms; load not recorded ✅[^lab-chrome].
      - Re-run (2026-11-28, after the restart, three runs): about 5 times slower (batch medians 122.3, 130.5 and 130.2 ms against about 26 ms, 4.83, 4.98 and 4.88 times, each the median of batches 4 to 26 over the median of batches 1 to 3 of the same run) ✅[^lab-chrome];
        - three more runs of a reviewer, one-minute load average 2.90 to 4.55 logged at the end of each, gave medians 129.0, 130.0 and 136.4 ms, 5.00, 5.35 and 5.15 times ✅[^lab-chrome];
        - with the default flags, Maglev code, 4.22, 4.96 and 5.60 times, load not recorded ✅[^lab-chrome];
        - and a milder 2 times with `--disable-renderer-backgrounding` (three runs of a reviewer, medians 46.5 to 50.6 ms against 23.5 to 28.1 ms in the first six batches; load average 2.13 logged for one run, none for the other two) ✅[^lab-chrome]; load not recorded for the author's runs.
      - Over both runs the later batches were slower than the first three although the tier did not change; the factor of about 5 is from the re-run only.
  - Details and method: `JE-M13` in [measuring-performance.md](measuring-performance.md).
  - Not run: a front tab that is then hidden, other operating systems, phones, Energy Saver on battery power or set through Chrome's settings page.
- **Other engines** (2026-11-28, SpiderMonkey in Firefox 161 and JavaScriptCore; Safari not run):
  - `for…of` was 3.8 to 4.0 times slower than an index `for` in Firefox (2.4 times in the JavaScriptCore shell) in the first run, and 3.79 to 4.87 times (runs 2 and 3) and 2.1 to 2.9 times in the re-run (2026-11-28, after the restart) ✅[^lab-cross];
  - in warmed code, 100 calls over 1,000 items, the index `for` took 0.068 to 0.069 ms in Firefox and 0.049 to 0.053 ms in the shell in the first run, and in the re-run 0.071, 0.096 and 0.191 ms in Firefox and 0.049 to 0.057 ms in the shell (one-minute load average at the start of the re-run's three runs: 16.2 to 26.1 for Firefox and 16.3 to 19.1 for the shell) ✅[^lab-cross], so an index loop is the safer form in code that must be fast in every browser: `JE-F12` in [functions-and-optimization.md](functions-and-optimization.md);
  - on JavaScriptCore a plain slice of 3 characters or more kept its 16 MiB parent string alive (13 on V8) ✅[^lab-cross], and in the SpiderMonkey shell of Firefox 161.0 (a shell on Linux, not a Firefox page) no slice up to 100,000 characters did, the shortest keeping slice of a flat parent being 1,048,577 characters ✅[^lab-sm], so a slice that is kept is copied with `[...part].join('')` at any length: `JL-G3` in [memory-and-garbage-collection.md](memory-and-garbage-collection.md);
  - on JavaScriptCore a `Map` entry took 53 to 210 bytes against 38 for an entry of an object used as a table ✅[^lab-cross], and in the SpiderMonkey shell a `Map` entry took 52.7 bytes (84.7 with string keys) against 27.3 for an object table ✅[^lab-sm], so a `Map` costs more memory there, not less: `JE-S1` in [strings-and-collections.md](strings-and-collections.md).
**Full lab:** [v8-object-and-value-representation-deep-dive.md](../../js-runtime/v8-object-and-value-representation-deep-dive.md) §3.1 and §6.3; [v8-memory-and-startup-deep-dive.md](../../js-runtime/v8-memory-and-startup-deep-dive.md) §3.7, §3.8 and §6.4; [v8-compiler-pipeline-deep-dive.md](../../js-runtime/v8-compiler-pipeline-deep-dive.md) §6.2 and §6.4; [v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md) §5.3.

## Takeaways
- Animate only `transform` and `opacity`; anything else runs layout or paint on every frame ✅[^webdev-compositor]. [rule-candidate]
- Batch layout reads before style writes in loops; one forced layout per element is the cost otherwise ✅[^webdev-layout].
- Keep each task at 50 ms or less (a longer one is a long task) ✅[^webdev-longtasks]: update the screen first, then yield unconditionally before analytics or saving ✅[^webdev-longtasks].
- A `requestAnimationFrame` wrapper is not a scroll throttle ✅[^mdn-scroll]; an observer or a time-based throttle is.
- Report interface speed as input-to-paint time; INP is good at 200 ms or less at the 75th percentile ✅[^webdev-vitals].
- A memory or small-integer figure from official Node.js does not carry over to a Chrome page, and a background tab runs slower code ✅[^lab-chrome].

## Verification status
- Verified: 85 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-28

## References
- Lab, Chrome against Node.js: scripts inlined in `file://` pages in Google Chrome 158.0.8127.89 (V8 15.8.62.31), macOS arm64, headless, 2026-11-27, and in a visible window on 2026-11-28 (front tab, a tab behind another tab, a minimized and a covered window, a hidden tab shown again, a dedicated and a shared worker, Energy Saver on and off), compared with official Node.js 24.22.1 (V8 13.6.233.17-node.58) on macOS arm64, linux arm64 and emulated linux x64. Scripts and outputs: `js-runtime/v8-object-and-value-representation-deep-dive.md` §3.1 and §6.3, `js-runtime/v8-memory-and-startup-deep-dive.md` §6.4, `js-runtime/v8-compiler-pipeline-deep-dive.md` §6.2 and §6.4. Rank 1 (primary measurement). Backs: Scope; Lookup notes, the closing note; Takeaways. [^lab-chrome]
- Lab, SpiderMonkey shell: the SpiderMonkey JavaScript shell of Firefox 161.0 (`jsshell-linux-aarch64.zip` from Mozilla's release archive, `JavaScript-C161.0`), run in an `ubuntu:24.04` linux arm64 container with no network on the same Apple M2 on 2026-11-28, each script three times; heap figure `gcBytes + mallocBytes` after `gc()`; SpiderMonkey on Linux, not a Firefox page; scripts and outputs in `js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md` §2.1 and §4.34. Rank 1 (primary measurement). Backs: Lookup notes, the closing note. [^lab-sm]
- Lab, other engines: the engine-neutral checks run three times each on 2026-11-28 on Node.js 24.22.1, Google Chrome 158.0.8127.89 (visible window), Firefox 161.0 (SpiderMonkey, headless), the macOS 26.1 `jsc` shell (JavaScriptCore 21622.2.11.11.9), Bun 1.4.5 and a Playwright WebKit build 2311 page, all on one Apple M2; scripts and outputs in `js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md` §4, conclusions in §5.3. Rank 1 (primary measurement). Backs: Scope; Lookup notes, the closing note. [^lab-cross]
- [Long Tasks API](https://www.w3.org/TR/longtasks-1/) — W3C, Discontinued Draft 2026. Rank 1. Backs: Catalog, JB-R7; Lookup notes; Takeaways. [^w3c-longtasks]
- [will-change](https://developer.mozilla.org/en-US/docs/Web/CSS/will-change) — MDN Web Docs, living. Rank 3. Backs: Catalog, JB-R2; Lookup notes. [^mdn-willchange]
- [Document: scroll event](https://developer.mozilla.org/en-US/docs/Web/API/Document/scroll_event) — MDN Web Docs, living. Rank 3. Backs: Catalog, JB-R5 and JB-R6; Lookup notes; Takeaways. [^mdn-scroll]
- [Stick to compositor-only properties and manage layer count](https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count) — web.dev (Chrome team), living. Rank 4. Backs: Summary; Catalog, JB-R1 and JB-R2; Lookup notes; Takeaways. [^webdev-compositor]
- [How to create high-performance CSS animations](https://web.dev/articles/animations-guide) — web.dev (Chrome team), living. Rank 4. Backs: Lookup notes, JB-R1. [^webdev-animations]
- [Optimize Cumulative Layout Shift](https://web.dev/articles/optimize-cls) — web.dev (Chrome team), 2025. Rank 4. Backs: Catalog, JB-R1; Lookup notes. [^webdev-cls]
- [Avoid large, complex layouts and layout thrashing](https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing) — web.dev (Chrome team), living. Rank 4. Backs: Catalog, JB-R3; Lookup notes; Takeaways. [^webdev-layout]
- [Virtualize large lists with react-window](https://web.dev/articles/virtualize-long-lists-react-window) — web.dev (Chrome team), living. Rank 4. Backs: Catalog, JB-R4; Lookup notes. [^webdev-virtual]
- [How large DOM sizes affect interactivity](https://web.dev/articles/dom-size-and-interactivity) — web.dev (Chrome team), living. Rank 4. Backs: Catalog, JB-R4; Lookup notes. [^webdev-domsize]
- [Optimize input delay](https://web.dev/articles/optimize-input-delay) — web.dev (Chrome team), living. Rank 4. Backs: Catalog, JB-R5; Lookup notes. [^webdev-input]
- [Optimize long tasks](https://web.dev/articles/optimize-long-tasks) — web.dev (Chrome team), 2024. Rank 4. Backs: Summary; Catalog, JB-R7 and JB-R8; Lookup notes; Takeaways. [^webdev-longtasks]
- [Web Vitals](https://web.dev/articles/vitals) — web.dev (Chrome team), living. Rank 4. Backs: Catalog, JB-R7 and JB-R9; Lookup notes; Takeaways. [^webdev-vitals]
- [A ticket-booking site improves Interaction to Next Paint (web.dev case study; the page's own title is "INP optimizations helped … increase sales by about 7%")](https://web.dev/case-studies/redbus-inp) — web.dev, living. Rank 4. Backs: Catalog, JB-R5; Lookup notes, JB-R5 and JB-R9. [^webdev-case-inp]
- [Pointer compression in V8](https://v8.dev/blog/pointer-compression) — V8 team (Igor Sheludko, Santiago Aboy Solanes), 2020-03-30. Rank 4. Backs: Lookup notes, the closing note. [^v8-ptrcomp]
- [v8-dev list: 31-bit Smis and pointer compression](https://groups.google.com/g/v8-dev/c/AI0RcAj-Z4g/m/Juj4UbcdAwAJ) — Santiago Aboy Solanes (V8 team), 2020-02-20. Rank 4. Backs: Lookup notes, the closing note. [^v8-dev-80]

## Related
- [browser-loading-and-delivery.md](browser-loading-and-delivery.md) — what a page loads and in which order (`JB-L`).
- [browser-network-requests.md](browser-network-requests.md) — caching, compression, preflights and HTTP versions (`JB-N`).
- [browser-component-frameworks.md](browser-component-frameworks.md) — React keys, selectors, context and memoization (`JB-F`).
- [measuring-performance.md](measuring-performance.md) — benchmarking rules, including background tabs and headless Chrome (`JE-M`).
- [../../performance/code-review/problem-classes-web-and-mobile-clients.md](../../performance/code-review/problem-classes-web-and-mobile-clients.md) — the catalog of client-side problem classes these rules come from.
- [../../performance/code-review/problem-classes.md](../../performance/code-review/problem-classes.md) — the first catalog: `frontend-rendering` and `polling-event-rate`.
- [../../performance/runtime-and-client-performance.md](../../performance/runtime-and-client-performance.md) — Web Vitals thresholds and the profiling table.
- [../../performance/case-ui-interaction.md](../../performance/case-ui-interaction.md) — the published INP case, anonymized.
- [../../js-runtime/v8-object-and-value-representation-deep-dive.md](../../js-runtime/v8-object-and-value-representation-deep-dive.md), [../../js-runtime/v8-memory-and-startup-deep-dive.md](../../js-runtime/v8-memory-and-startup-deep-dive.md), [../../js-runtime/v8-compiler-pipeline-deep-dive.md](../../js-runtime/v8-compiler-pipeline-deep-dive.md), [../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md) — the mechanisms and labs behind the closing note.
