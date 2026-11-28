---
schema: knowledge-doc/v1
type: reference
topic: javascript/best-practices
status: verified
applies-to: ["any current browser, as web.dev and MDN state it (living pages, read 2026-11-26)", "React 19 docs (react.dev, living) for the lazy-loading source", "no lab run"]
last-verified: 2026-11-28
last-updated: 2026-11-28
tags: [javascript, best-practices, browser, page-load, lcp, cls, images, fonts, bfcache]
ranked-sources: true
---

# JavaScript best practices: browser loading and delivery

## Summary
**TL;DR:** Seven practices for what a page loads and in which order: the main image, image dimensions and widths, scripts, web fonts, code that only one route needs, and staying eligible for the back/forward cache. The main (LCP) image must never be lazy-loaded ✅[^webdev-optlcp], and an `unload` listener or `no-store` can make every Back navigation a full page load ✅[^webdev-bfcache]. All figures are statements of web standards and browser vendors' pages; none was measured in the knowledge base's lab.
**Use this when:** you write or review HTML `<img>`, `<script>` or `<link>` tags, `@font-face` rules, top-level imports of large libraries in front-end code, page lifecycle listeners, or the `Cache-Control` header of an HTML page.
**Not this doc:** animation, layout, long lists and input handlers → [browser-rendering-and-interaction.md](browser-rendering-and-interaction.md); caching and compression headers for assets and APIs → [browser-network-requests.md](browser-network-requests.md); the React form of code splitting (`lazy`) → [browser-component-frameworks.md](browser-component-frameworks.md); barrel files → `JL-L12` in [language-patterns.md](language-patterns.md); loading modules on demand in Node.js → `JN-U7` in [nodejs-startup.md](nodejs-startup.md).

## Scope
The catalog covers rules `JB-L1` to `JB-L7`. Their figures are statements of web.dev (the Chrome team's guidance pages), MDN (Mozilla's web reference) and the React docs, read 2026-11-26, about browsers in general. None was measured in the knowledge base's own lab, and each Evidence line says "stated by" to keep a source's figure apart from a measured one; where a rule's cost is given, it is a count from the code, not a timing.

How to read the "Applies" column: `always` means the better form is as clear as the other, so it is the default; `hot path` means it matters only in code that runs per request, per frame or per element of a large collection, or that a profile points at; `large data` means only above the size the row gives; `startup` means only when start time matters; `check build` means the answer depends on the engine version or build; `no gain` means no useful difference was measured or the advice is outdated, so there is no reason to rewrite code for it.

Terms used below:
- **LCP** (Largest Contentful Paint): the time until the largest image or text block in view is painted. **CLS** (Cumulative Layout Shift): a score of how much visible content moves unexpectedly, like a page of a newspaper whose columns jump while you read.
- **Back/forward cache** (bfcache): the browser keeps a page the user left in memory so that Back restores it at once, like pausing a film instead of rewinding it.
- **Bundler**: the build tool that follows imports and packs modules into the files the browser loads; a **chunk** is one such file.
- **Parser-blocking**: the HTML parser stops at a tag until a file has downloaded and run, like a reader who stops at a footnote until the library sends the book.
- **Block period** of a web font: the time a browser draws text in an invisible fallback while the font loads.

## Catalog
| Id | Situation in the code | Practice | Applies | Evidence |
|---|---|---|---|---|
| `JB-L1` | `loading="lazy"` on the top image, or the main image set as a CSS background or inserted by script | Load it eagerly with `fetchpriority="high"`; `<link rel="preload" as="image">` if it is found late | always | Never lazy-load the LCP image ✅[^webdev-optlcp]; LCP is good at 2.5 s or less at the 75th percentile ✅[^webdev-lcp] |
| `JB-L2` | `<img>`, `<video>` or `<iframe>` with no `width`/`height` and no `aspect-ratio` | Set `width` and `height` attributes (CSS `height:auto` keeps it responsive) so nothing shifts | always | CLS is good at 0.1 or less at the 75th percentile, mobile and desktop separately ✅[^webdev-vitals]; no layout-shift figure for one image is in the sources |
| `JB-L3` | `<script src>` with neither `defer` nor `async` | Add `defer` (ordered, after parsing) or `async` (independent); `async` still blocks while it runs | always | `defer` and `async` avoid parser-blocking for external scripts; an `async` script still blocks when it runs ✅[^mdn-script] |
| `JB-L4` | One large `<img src>` file shown small or on phones, with no `srcset` | Serve 3 to 5 widths with `srcset` `w` descriptors and a `sizes` attribute | always | Desktop-sized images served to mobile can use 2 to 4 times more data than needed; 3 to 5 sizes is common ✅[^webdev-responsive] |
| `JB-L5` | `@font-face` with no `font-display`; fonts through CSS `@import`; no `preload`/`preconnect` | `font-display: optional` (body) or `swap` (brand); preload WOFF2 with `crossorigin`; preconnect to the font host | always | Chromium and Firefox block text rendering for up to 3 s while a web font loads, Safari indefinitely ✅[^webdev-fonts]; `optional` has no swap period ✅[^mdn-fontdisplay] |
| `JB-L6` | Top-level `import` of a large library used only after a click or on one route | Load it with `await import('./x.js')` at first use, so it gets its own chunk | startup | React's `lazy` defers loading a component's code until it first renders ✅[^react-lazy]; no byte or time figure is in the sources |
| `JB-L7` | `unload` listener; `beforeunload` added on load; `no-store` on non-sensitive pages | Use `pagehide`; add `beforeunload` only while changes are unsaved; `no-store` only for sensitive pages | always | Firefox treats pages that use `unload` as ineligible; pages with `no-store` may not be eligible ✅[^webdev-bfcache] |

## Lookup notes
### `JB-L1` Never lazy-load the main (LCP) image; raise its priority instead
Applies to the hero image, banner or first product photo in view.
**Prefer:**
```html
<img src="/hero-1200.jpg" width="1200" height="600" fetchpriority="high" alt="…">
<!-- found late (CSS background, script)? -->
<link rel="preload" as="image" href="/hero-1200.jpg" fetchpriority="high">
```
**Avoid:**
```html
<img src="/hero-1200.jpg" loading="lazy" alt="…">
```
**Why:** a lazy image waits until layout shows it is in view, so the largest paint starts late; `fetchpriority` and `preload` let the browser find and fetch it early ✅[^webdev-optlcp].
**Evidence:** stated by web.dev ("Largest Contentful Paint" and "Optimize LCP", living), not measured here: never lazy-load the LCP image ✅[^webdev-optlcp]; LCP is good at 2.5 s or less at the 75th percentile of page loads ✅[^webdev-lcp].
**Exceptions:** images below the first screen: `loading="lazy"` is right for them.
**Check it:** Chrome DevTools, Performance panel: the LCP marker and which element it names; the network waterfall shows when that image request starts.

### `JB-L2` Give every image (and embed) its `width` and `height`
Applies to any `<img>`, `<video>` or `<iframe>` in content with no `width`/`height` attributes and no CSS `aspect-ratio`.
**Prefer:**
```html
<img src="/photo.jpg" width="800" height="533" alt="…" style="max-width:100%;height:auto">
```
**Avoid:**
```html
<img src="/photo.jpg" alt="…">
```
**Why:** without dimensions the browser reserves no space, and the content below jumps when the image arrives. The first performance catalog lists images without dimensions as a page-load signal with `width` and `height` as the fix, and the knowledge base's measuring table ([runtime-and-client-performance.md](../../performance/runtime-and-client-performance.md)) says to reserve image and content space.
**Evidence:** stated by web.dev ("Web Vitals", living), not measured here: CLS is good at 0.1 or less at the 75th percentile, mobile and desktop separately ✅[^webdev-vitals]. No layout-shift figure for one image is in the sources.
**Exceptions:** images positioned out of flow (absolute over a fixed-size box) do not shift other content.
**Check it:** Chrome DevTools, Performance panel, cold load: the layout shifts when the images arrive, and the CLS score, before and after.

### `JB-L3` Load external scripts with `defer` or `async`
Applies to every `<script src>` in the document head or body.
**Prefer:**
```html
<script src="/app.js" defer></script>          <!-- runs after parsing, in order -->
<script src="https://analytics.example/a.js" async></script> <!-- independent -->
```
**Avoid:**
```html
<script src="/app.js"></script> <!-- parser stops until it downloads and runs -->
```
**Why:** a plain external script stops the HTML parser while it downloads and runs. `defer` and `async` let parsing continue; an `async` script still blocks the main thread while it runs ✅[^mdn-script].
**Evidence:** stated by MDN ("The script element", living), not measured here ✅[^mdn-script].
**Exceptions:** a small inline script that must run before first paint (for example, setting a colour theme) stays blocking on purpose.
**Check it:** the network waterfall shows the parser waiting on the script; Lighthouse lists render-blocking scripts.

### `JB-L4` Serve images in several widths with `srcset` and `sizes`
Applies to content images whose shown width varies by screen: for example a 2048-pixel photo shown in a thumbnail or on phones, with no `srcset`.
**Prefer:**
```html
<img src="/p-800.jpg"
     srcset="/p-400.jpg 400w, /p-800.jpg 800w, /p-1600.jpg 1600w"
     sizes="(max-width: 600px) 100vw, 400px" width="400" height="300" alt="…">
```
**Avoid:**
```html
<img src="/p-2048.jpg" width="128" height="96" alt="…">
```
**Why:** the browser downloads the whole file whatever size it is shown at. With `srcset` and `sizes` it picks a candidate using the slot width and the device ✅[^mdn-responsive].
**Evidence:** stated by web.dev ("Serve responsive images", living) and MDN ("Responsive images", living), not measured here: desktop-sized images served to mobile can use 2 to 4 times more data than needed, and serving 3 to 5 sizes is common ✅[^webdev-responsive]. The Android page puts a 2048 × 1536 image at about 12 MB in memory when decoded in full (ARGB_8888 format, 4 bytes per pixel, which is 12,582,912 bytes by arithmetic), and says that loading a larger image than a 128 × 96 thumbnail needs is not worth the memory ✅[^android-bitmap]; it is an Android figure, and the sources state no browser decode figure.
**Exceptions:** an image shown full-screen and zoomable; or an image service or framework component that already generates the widths.
**Check it:** Chrome DevTools, Network panel at a phone viewport: bytes downloaded per image and the chosen file name.

### `JB-L5` Make web-font text visible on first paint
Applies to any `@font-face` or font stylesheet used for body or heading text.
**Prefer:**
```html
<link rel="preconnect" href="https://fonts.example" crossorigin>
<link rel="preload" href="/fonts/body.woff2" as="font" type="font/woff2" crossorigin>
<style>@font-face { font-family: Body; src: url(/fonts/body.woff2) format("woff2"); font-display: optional; }</style>
```
**Avoid:**
```css
@import url("https://fonts.example/css?family=Body"); /* found only after this CSS loads */
@font-face { font-family: Body; src: url(body.ttf); } /* no font-display */
```
**Why:** while a web font loads, browsers draw text in an invisible fallback for a block period; `swap` has an extremely small block period and an infinite swap period, `optional` no swap period, so no late re-layout ✅[^mdn-fontdisplay]. The browser must load all the CSS before it learns which fonts it needs ✅[^webdev-fonts], so `preload` helps the font meet the first paint ✅[^webdev-cls].
**Evidence:** stated by web.dev ("Best practices for fonts", "Optimize CLS") and MDN (`font-display`, living), read 2026-11-26, not measured here: Chromium and Firefox block text rendering for up to 3 seconds while a web font loads, Safari indefinitely; the 3-second figure is web.dev's, and MDN gives no durations ✅[^webdev-fonts]. `optional` avoids a re-layout, and a preloaded font is more likely to meet first paint ✅[^webdev-cls]. The client catalog's fix is `swap` for brand text and `optional` for body text.
**Exceptions:** text in a system font stack; an icon font, where a fallback glyph is meaningless and a short block may be better. Brand text that must appear in its own face takes `swap` rather than `optional`.
**Check it:** Chrome DevTools, Performance panel with network throttling, cold load: text is visible on the first painted frame and the font swap causes no layout shift.

### `JB-L6` Load code that only one route or interaction needs on demand
Applies to code for a dialog, editor, chart or route the first screen does not show: a top-level `import` of a large library (editor, charting, PDF) used only after a click or on one route.
**Prefer:**
```js
button.addEventListener('click', async () => {
  const { openEditor } = await import('./editor.js'); // separate chunk, fetched on first use
  openEditor(target);
});
```
**Avoid:**
```js
import { openEditor } from './editor.js'; // in the first bundle of every page
```
**Why:** everything imported at the top of the entry module is downloaded, parsed and run before the page is interactive. A dynamic `import()` lets the bundler split that code into its own file, loaded when needed.
**Evidence:** the first performance catalog files a large initial bundle under its start-up class, whose fix is to load on demand; its source for the browser case is React's `lazy` page (React 19 docs, living), which defers loading a component's code until it first renders ✅[^react-lazy]. Not measured here; no byte or time figure is in the sources. The React form is `JB-F8` in [browser-component-frameworks.md](browser-component-frameworks.md).
**Exceptions:** code the first screen needs: loading it on demand only adds a round trip.
**Check it:** a bundle analyzer: modules in the entry chunk before and after; the Network panel shows the new chunk fetched on first use.
**Related, not the same rule:** `JN-U7` in [nodejs-startup.md](nodejs-startup.md) loads heavy optional modules on the path that uses them in Node.js; this rule is about the browser bundle. Importing through a barrel file (a re-exporting `index.ts`) is owned by `JL-L12` in [language-patterns.md](language-patterns.md): import the file that declares a symbol. What the author of one engineering post adds from the tooling side: a barrel file pulls in a web of imports, so a test runner that rebuilds the module graph for every test file and a linter that runs file by file pay the load cost of every module behind the barrel, while bundling the same code into one flat file ran faster in his experiment ✅[^barrel-debacle]. That post does not discuss tree shaking (the bundler dropping exports nothing uses), and the knowledge base has no bundle-size measurement for barrels.

### `JB-L7` Keep the page eligible for the back/forward cache
Applies to page lifecycle listeners and the HTML response's cache headers: `addEventListener('unload', …)` or `onunload`; a `beforeunload` listener added on page load; `Cache-Control: no-store` on a page with no sensitive data.
**Prefer:**
```js
addEventListener('pagehide', flushAnalytics);
function onEdit() { addEventListener('beforeunload', warn); }   // only while unsaved
function onSaved() { removeEventListener('beforeunload', warn); }
```
**Avoid:**
```js
addEventListener('unload', flushAnalytics);
addEventListener('beforeunload', warn); // from page load, forever
```
**Why:** a page in the bfcache is restored entirely from memory, without the network ✅[^webdev-bfcache], so Back or Forward costs no request, parse or render. An `unload` listener or `no-store` can make the page ineligible, so every Back is a full page load.
**Evidence:** stated by web.dev ("Back/forward cache", page last updated 2026-10-16), not measured here: Firefox treats pages that use `unload` as ineligible (except on iOS); Chrome no longer fires `unload` (except on iOS); Safari attempts to cache some pages with an `unload` listener; pages with `no-store` may not be eligible ✅[^webdev-bfcache]. A Chrome-only test may therefore miss the blocker. MDN (HTTP caching, living) also warns that `no-store` loses the bfcache ✅[^mdn-caching].
**Exceptions:** a page with sensitive data that sets `no-store` on purpose ✅[^webdev-bfcache]; a `beforeunload` that guards real unsaved changes.
**Check it:** Chrome DevTools, Application panel, Back/forward cache, "Run test": the page is restored, or the panel names the blocking reason ✅[^webdev-bfcache]; `NotRestoredReasons` in field data.

## Takeaways
- The LCP image is loaded eagerly with `fetchpriority="high"`, never lazily ✅[^webdev-optlcp]. [rule-candidate]
- Every content image carries `width` and `height`; CLS is judged good at 0.1 or less ✅[^webdev-vitals].
- External scripts take `defer` or `async`; `async` still blocks while it runs ✅[^mdn-script].
- Web fonts need a `font-display` and an early `preload`, or text can stay invisible for up to 3 s ✅[^webdev-fonts].
- Code for one route or one click belongs in its own chunk, loaded with `import()` at first use.
- `pagehide` replaces `unload`, and `no-store` is kept for sensitive pages, so Back stays instant ✅[^webdev-bfcache].

## Verification status
- Verified: 37 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-28

## References
- [lazy](https://react.dev/reference/react/lazy) — React team, React 19 docs, living. Rank 1. Backs: Catalog, JB-L6; Lookup notes. [^react-lazy]
- [Loading large bitmaps efficiently](https://developer.android.com/topic/performance/graphics/load-bitmap) — Android Developers, living. Rank 1. Backs: Lookup notes, JB-L4. [^android-bitmap]
- [The script element](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script) — MDN Web Docs, living. Rank 3. Backs: Catalog, JB-L3; Lookup notes; Takeaways. [^mdn-script]
- [font-display](https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/font-display) — MDN Web Docs, living. Rank 3. Backs: Catalog, JB-L5; Lookup notes. [^mdn-fontdisplay]
- [Responsive images](https://developer.mozilla.org/en-US/docs/Web/HTML/Guides/Responsive_images) — MDN Web Docs, living. Rank 3. Backs: Lookup notes, JB-L4. [^mdn-responsive]
- [HTTP caching](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching) — MDN Web Docs, living. Rank 3. Backs: Lookup notes, JB-L7. [^mdn-caching]
- [Largest Contentful Paint](https://web.dev/articles/lcp) — web.dev (Chrome team), living. Rank 4. Backs: Catalog, JB-L1; Lookup notes. [^webdev-lcp]
- [Optimize Largest Contentful Paint](https://web.dev/articles/optimize-lcp) — web.dev (Chrome team), living. Rank 4. Backs: Summary; Catalog, JB-L1; Lookup notes; Takeaways. [^webdev-optlcp]
- [Web Vitals](https://web.dev/articles/vitals) — web.dev (Chrome team), living. Rank 4. Backs: Catalog, JB-L2; Lookup notes; Takeaways. [^webdev-vitals]
- [Serve responsive images](https://web.dev/articles/serve-responsive-images) — web.dev (Chrome team), living. Rank 4. Backs: Catalog, JB-L4; Lookup notes. [^webdev-responsive]
- [Best practices for fonts](https://web.dev/articles/font-best-practices) — web.dev (Chrome team), living. Rank 4. Backs: Catalog, JB-L5; Lookup notes; Takeaways. [^webdev-fonts]
- [Optimize Cumulative Layout Shift](https://web.dev/articles/optimize-cls) — web.dev (Chrome team), 2025. Rank 4. Backs: Lookup notes, JB-L5. [^webdev-cls]
- [Back/forward cache](https://web.dev/articles/bfcache) — web.dev (Chrome team), 2026. Rank 4. Backs: Summary; Catalog, JB-L7; Lookup notes; Takeaways. [^webdev-bfcache]
- [Speeding up the JavaScript ecosystem – The barrel file debacle](https://marvinh.dev/blog/speeding-up-javascript-ecosystem-part-7/) — Marvin Hagemeister, 2023, a personal blog. Rank 6. Backs: Lookup notes, JB-L6 (tooling pays the load cost of a barrel; a flat bundle ran faster). [^barrel-debacle]

## Related
- [browser-rendering-and-interaction.md](browser-rendering-and-interaction.md) — animation, layout, long lists, input handlers and long tasks (`JB-R`).
- [browser-network-requests.md](browser-network-requests.md) — caching and compression headers, preflights, HTTP versions (`JB-N`).
- [browser-component-frameworks.md](browser-component-frameworks.md) — React `lazy`, Server Components and the client boundary (`JB-F`).
- [language-patterns.md](language-patterns.md) — `JL-L12`, imports through barrel files.
- [nodejs-startup.md](nodejs-startup.md) — `JN-U7`, loading modules on demand in Node.js.
- [../../performance/code-review/problem-classes-web-and-mobile-clients.md](../../performance/code-review/problem-classes-web-and-mobile-clients.md) — the client catalog: `oversized-image-decode`, `web-font-blocking`, `bfcache-blocker`.
- [../../performance/code-review/problem-classes.md](../../performance/code-review/problem-classes.md) — the first catalog: `page-load-delivery` and `startup-cold-start`.
- [../../performance/runtime-and-client-performance.md](../../performance/runtime-and-client-performance.md) — Web Vitals thresholds.
- [../../js-runtime/barrel-files.md](../../js-runtime/barrel-files.md) — why barrel files slow tools that follow imports.
