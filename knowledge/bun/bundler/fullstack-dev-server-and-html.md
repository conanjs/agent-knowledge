---
schema: knowledge-doc/v1
type: concept
topic: bun/bundler
status: verified
applies-to: ["Bun 1.4.5"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [bun, bundler, html-imports, bun-serve, dev-server, hmr, import-meta-hot, css, css-modules, standalone-html, fullstack]
---

# HTML imports, the dev server and HMR in Bun

## Summary
**TL;DR:** `import index from "./index.html"` gives an `HTMLBundle`; used as a route value in `Bun.serve({ routes: { "/": index } })`, it makes Bun read the HTML's `<script>`, `<link>` and `<img>` tags, bundle what they point to, and serve the rewritten page plus every asset as static routes. With `development: true`, assets are rebuilt when files change and pushed to the browser over a WebSocket (HMR, hot module replacement, driven by `import.meta.hot`); with `development: false`, Bun bundles once, minifies, and serves hashed files with `Cache-Control: immutable`. `bun ./index.html` runs the same server with no server code. For production, `bun build --target=bun ./server.ts` pre-bundles the HTML into a manifest, `bun build ./index.html` writes a static site, and `--compile --target=browser` writes one self-contained `.html` file.
**Use this when:** serving a frontend from `Bun.serve`, running a static or single-page app in development, using `import.meta.hot`, bundling CSS (imports, nesting, CSS modules), or building any of these for production.
**Not this doc:** `Bun.serve` routing, handlers and server options → `bun/http-and-networking/bun-serve.md`; bundler options in general → [bun-build.md](bun-build.md); `[serve.static] plugins` reuse the plugin API in [plugins-and-macros.md](plugins-and-macros.md); `--compile` for servers → [single-file-executables.md](single-file-executables.md); `--watch` and `--hot` for server code → `bun/fundamentals/watch-hot-and-debugging.md`.

## Problem
A frontend written in TypeScript, JSX and modern CSS needs a bundler, a dev server with live reload and a production build, usually three tools with three configs. Bun puts all three behind an `import` of an HTML file, which hides what changes between modes: development pages load a different script (`/_bun/client/…`) than production pages; CSS nesting is lowered in some builds and kept in others; a production server built with `--target=bun` looks for its assets relative to the current directory; and `import.meta.hot` code written with a variable (`const hot = import.meta.hot`) crashes once the HMR calls are removed in production.

## Mental model
**Analogy:** the HTML file is a shopping list handed to a personal shopper (Bun). The shopper reads the list (the tags), fetches and prepares each item (bundles the scripts, styles and images), puts a barcode on each one (a hashed URL), and hands back a copy of the list with the barcodes written in. In development the shopper stays on the phone (a WebSocket) and brings a replacement the moment an item changes.

**Artifact:** a server with one HTML route and one API route, and what `GET /` returned with `development: false` ✅[^lab]:
```ts
// server.ts                                     <!-- index.html, as written -->
import index from "./index.html";                <link rel="stylesheet" href="./styles.css" />
Bun.serve({                                       <img src="./logo.svg" alt="logo" />
  development: false,                             <script type="module" src="./app.ts"></script>
  routes: {
    "/": index,                                  <!-- as served -->
    "/api/hello": { GET: () => Response.json({ hello: "api" }) },
  },                                             <link rel="stylesheet" crossorigin href="/chunk-y3v77x3v.css">
});                                              <script type="module" crossorigin src="/chunk-enpkv15n.js"></script>
// console.log(index) → HTMLBundle { index: "/w/index.html" }      <img src="/logo-8ev2gykr.svg" alt="logo" />
```

## How it works
Four actors take part:
- **Your server code** — its job: name the pages, via `import x from "./page.html"` and `Bun.serve({ routes, development })`.
- **Bun's HTML bundler** — its job: find and bundle what the page references, via an HTML rewriter over the tags and the same bundler as `Bun.build`.
- **`Bun.serve`** — its job: answer the requests, via static routes for the rewritten HTML and each output file, plus `/_bun/hmr` in development.
- **The browser** — its job: load the page, and in development apply updates, via the dev client script and `import.meta.hot`.

```
import index from "./index.html"  ──►  routes: { "/": index }
                                          │ first GET /   (development: true → also after every file change)
                                          ▼
HTML bundler: scan <script src> <link rel=stylesheet> <img src> …   (lol-html selectors)
   ├─ JS/TS/JSX  ──► bundle ──► /_bun/client/index-<generation>.js   (dev)  |  /chunk-<hash>.js   (prod)
   ├─ CSS         ──► bundle ──► /_bun/asset/<hash>.css               (dev)  |  /chunk-<hash>.css  (prod)
   └─ images      ──► copy   ──► /_bun/asset/<hash>.svg               (dev)  |  /logo-<hash>.svg   (prod)
                                          │
Bun.serve ◄────── rewritten HTML + static routes for every output file
   │ development only:  ws://host/_bun/hmr  ◄═══ network ═══►  browser dev client (import.meta.hot)
```

1. **Your server code:**
   - Importing an `.html` file from server code returns an `HTMLBundle` (in the lab `HTMLBundle { index: "/w/index.html" }`), and passing it to `routes` makes Bun bundle the page's `<script>` and `<link>` tags and expose the results as static routes ✅[^1] ✅[^lab].
   - API routes sit next to pages in the same `routes` object; `GET /api/hello` returned `{"hello":"api"}` ✅[^1] ✅[^lab].
2. **The HTML bundler:**
   - The `html` loader uses `lol-html` (a streaming HTML rewriter) to treat `script[src]` and `link[rel='stylesheet'][href]` as entrypoints, and `img[src]`, `img[srcset]`, `source[src]`, `video[poster]`, icons, manifests and similar tags as assets; `http://` and `https://` URLs stay as they are ✅[^6]. Lab, `bun build ./page.html`: `link rel="icon"`, `rel="apple-touch-icon"`, `rel="manifest"`, `video[poster]`, `source[src]` and a one-URL `img[srcset]` or `source[srcset]` were each copied under a hashed name (`./fav-d2pce81h.ico`, `./thumb-ksvgr4b8.jpg`, …), and `https://example.com/x.png` was left as written ✅[^lab]. A `srcset` with a size descriptor failed the build (Edge cases) ✅[^lab].
   - Scripts get TypeScript and JSX transpiled and their imports bundled; stylesheets go through Bun's CSS bundler; assets get content hashes in their URLs ✅[^1] ✅[^3].
   - The same HTML import means three things: on-the-fly bundling under `bun run server.ts`, a static site under `bun build ./index.html`, and a pre-built manifest under `bun build --target=bun server.ts` ✅[^6].
3. **`Bun.serve`, by mode** (the lab's two runs of the same `server.ts`) ✅[^lab]:

   | | `development: true` | `development: false` |
   |---|---|---|
   | Script tag | `/_bun/client/index-0000000042354f6a.js` with `data-bun-dev-server-script`, plus an inline `sendBeacon('/_bun/unref', …)` script | `/chunk-enpkv15n.js` |
   | Stylesheets | One `/_bun/asset/<hash>.css` per CSS file (two links), nesting kept | One `/chunk-y3v77x3v.css`, minified, nesting lowered |
   | JavaScript | 53,916 characters: the HMR runtime plus a module map, ending in `//# sourceMappingURL=/_bun/client/0000000042354f6a.js.map` | 229 characters, minified, `import.meta.hot` calls gone |
   | Headers | `etag` set, no `cache-control` | `etag` and `cache-control: public, max-age=31536000, immutable` |
   | When it bundles | On request, logged as `Bundled page in 14ms: index.html`, again after each change | Once, kept in memory until the server restarts ✅[^1]; after `label.ts` changed from `"v1"` to `"v2-edited"`, the served chunk still held `"v1"` ✅[^lab] |

   In production mode HTML routes serve no source maps unless `[serve.static] sourcemap` in `bunfig.toml` says so (since 1.4.0) ✅[^1] ✅[^7]. Lab: the production chunk had no `sourceMappingURL` comment; with `sourcemap = "linked"` it ended in `//# sourceMappingURL=/chunk-j5psx6qv.js.map`, and that URL returned HTTP 200 with a version 3 source map ✅[^lab]. Bun 1.3.14 (`oven/bun:1.3.14`) still served them with no setting: its `development: false` chunk ended in `sourceMappingURL=/chunk-0cj37g69.js.map`, which returned HTTP 200 ✅[^lab].
4. **HMR (hot module replacement: swapping changed modules into the running page without a reload):**
   - **Browser → server:** the dev client opens `ws://…/_bun/hmr`; the server first sent a 17-byte message starting with `V` and the build version, and the client script's source then sends `she`, `n` plus its path (`n/`) and `i` plus its generation, which the lab's own WebSocket copied ✅[^lab].
   - **Server, local:** editing `label.ts` printed `Reloaded in 0ms: label.ts` in the server's terminal and changed the script's generation (`…56bfdd41.js` → `…bf10f1c0.js`) ✅[^lab].
   - **Server → browser:** a 259-byte message starting with `u` carried only `label.ts`'s new code, wrapped in `self[Symbol.for("bun:hmr")]({ "label.ts": … })` ✅[^lab].
   - **Browser:** a module that calls `import.meta.hot.accept()` is re-run in place and its importers patched; with no accepting module the page reloads in full ✅[^2]. Lab, headless Chromium 156 in `bunlab:2` against `development: { hmr: true, console: true }`: four saves of a self-accepting `counter.ts` re-ran it in place each time; saving `plain.ts`, which no module accepts, fired `bun:beforeFullReload`, and the page loaded again with navigation type `reload` ✅[^lab].
   - **Tab close:** a driver script opened the page and later closed its tab through the Chrome DevTools Protocol (CDP, the JSON-over-WebSocket interface that remote-controls Chromium), with `Target.createTarget` and `Target.closeTarget`. The page's `pagehide` and `visibilitychange` beacons reached the server when the tab closed, and its `dispose` callback never ran then: every `dispose` beacon matched an earlier `Reloaded in …` update, with or without such an update before the close (9 runs in 1.4.5, 2 with a `1.4.6-canary.1` binary copied from `oven/bun:canary`) ✅[^lab].
   - `development: { hmr: false }` turns HMR off, and `development: { console: true }` (or `bun ./index.html --console`) echoes browser `console` output to the terminal over the same socket ✅[^1] ✅[^3]. Lab: with `hmr: false` the page loaded a 312-byte `/chunk-wf797nmc.js` without the HMR client, a WebSocket to `/_bun/hmr` failed, and saving a file logged nothing; with `console: true` every browser `console.log` appeared in the server's terminal prefixed `[browser]` ✅[^lab].

### `import.meta.hot`
The API follows Vite's; the Status and Use columns are from the docs ✅[^2], the last column from the Chromium run above ✅[^lab]:

| Call | Status in 1.4.5 | Use | Observed in Chromium |
|---|---|---|---|
| `accept()` / `accept(cb)` / `accept("./dep", cb)` | Works | Mark the module (or a dependency) as replaceable | `accept()`: re-run in place; `accept("./dep", cb)`: `cb` got the new exports (`v=d2`) and the accepting module did not re-run |
| `data` | Works | State carried to the next copy of the module; writing it also self-accepts | A counter in `data` went 1, 2, 3, 4, 5 over four saves, and back to 1 after the full reload |
| `dispose(cb)` | Works | Clean up before the module is replaced; not called on navigation or tab close | Ran before each replacement; a `sendBeacon` inside it never fired when the page navigated to `/other`, nor on the full reload, nor when the tab was closed through the Chrome DevTools Protocol (`Target.closeTarget`), in 9 runs, while `pagehide` and `visibilitychange` beacons from the same page arrived at the close; the same in `1.4.6-canary.1`. A `pagehide` listener that the replaced copy had added still fired at the close, next to the new copy's |
| `on(event, cb)` / `off` | Works | `bun:beforeUpdate`, `bun:afterUpdate`, `bun:beforeFullReload`, `bun:error`, `bun:ws:connect`, … (also as `vite:*`) | The four `bun:` events above fired; `vite:beforeUpdate` and `vite:afterUpdate` never did (Edge cases); a handler removed with `off` did not run |
| `prune(cb)` | Partial | The callback is currently never called | Never called |
| `decline()` | No-op | Vite compatibility | No effect: `accept()` in the same module still worked |
| `invalidate()`, `send()` | Missing | — | Present as functions; calling them threw `TODO: implement ImportMetaHot.invalidate` and `… .send` |

In production builds Bun removes these calls, so they must be written as `import.meta.hot.<name>` with no variable in between ✅[^2]. Lab, `bun build ./page.html`: `import.meta.hot.accept()`, `.dispose(…)` and `.on(…)` disappeared, and `export const root = (import.meta.hot.data.root ??= { made: Date.now() })` became `var root = { made: Date.now() };` ✅[^lab].

### CSS bundling
- `@import` is inlined, `url()` assets are copied with hashed names, and CSS imported from JavaScript goes into one stylesheet per entrypoint ✅[^3] ✅[^5]. Lab: `@import "./base.css"` came out inlined ahead of the importing rules; a `url()` file was copied with a hashed name only from 131,072 bytes (128 KiB) up, and smaller files were inlined as `data:` URLs (Edge cases) ✅[^lab].
- Modern syntax is lowered for the default targets (Edge 80+, Firefox 78+, Chrome 80+, Safari 14+, Opera 67+); the parser is a port of LightningCSS ✅[^5]. Lab, static build: `.card { color: red; &:hover { color: blue; } .title { … } }` became `.card{color:red}.card:hover{color:#00f}.card .title{font-weight:700}` ✅[^lab].
- CSS modules: a `.module.css` file's class names are made unique per file, and importing it gives a map; `composes` reuses classes ✅[^5]. Lab: `btn.module.css` `.primary` became `.primary_NhKpNw`, and the bundle held `{ primary: "primary_NhKpNw" }` ✅[^lab]; with `.primary { composes: shared; color: red; }` the map held `primary: "shared_UxUeSA primary_UxUeSA"` ✅[^lab].

### Static pages without server code
- `bun ./index.html` printed `Bun v1.4.5 dev server ready in 2.58 ms` and a `url:` line for port 3000 on localhost; with one HTML file it is a single-page-app fallback: `/`, `/about` and `/users/123` all returned the page ✅[^3] ✅[^lab].
- `bun ./*.html` (here `index.html`, `about.html`) printed a `Routes:` list (`/ → index.html`, `/about → about.html`); `/index` and `/nope` returned 404 ✅[^3] ✅[^lab].
- `bunfig.toml` `[serve.static]` sets `plugins` (for example `bun-plugin-tailwind`), `env` (`"PUBLIC_*"` to inline matching `process.env.X`) and `sourcemap` for these servers and for HTML routes; the plugins do not work through the `bun build` CLI ✅[^1] ✅[^3]. Lab, with `env = "PUBLIC_*"` and `plugins = ["./upper.ts"]` (a local file exporting a plugin that upper-cases `.txt` imports): `bun ./index.html` inlined `PUBLIC_X` as `"pub"`, kept `process.env.SECRET_X`, and served `"PLUGIN:PLAIN NOTE"`; `bun build ./index.html` in the same folder applied neither setting, while `Bun.build({ plugins: [upper] })` applied the plugin ✅[^lab].

### Production builds
1. **Server plus pages:** `bun build --target=bun --production ./prod-server.ts --outdir dist` wrote `prod-server.js`, `index.html`, `index-x1kkkjsd.js`, `index-ggxr56p0.css` and `logo-8ev2gykr.svg` ✅[^lab]. The HTML import became a manifest object that `Bun.serve` serves from ✅[^1] ✅[^6]:
   ```json
   {"index":"./index.html","files":[{"input":"index.html","path":"./index-x1kkkjsd.js","loader":"js","isEntry":true,
     "headers":{"etag":"HQFT05Ny-c0","content-type":"text/javascript;charset=utf-8"}}, …]}
   ```
2. **Static site:** `PUBLIC_API=https://api.example bun build ./index.html --minify --outdir dist-static --env="PUBLIC_*"` wrote a rewritten `index.html` (`./index-pvhsbb8t.css`, `./index-vz0xhwmb.js`, `./logo-8ev2gykr.svg`) and inlined `console.log("PUBLIC_API =","https://api.example")` ✅[^3] ✅[^lab].
3. **Standalone HTML:** `bun build --compile --target=browser --minify ./index.html --outdir dist-one` wrote one `index.html` of 0.68 KB with the CSS in a `<style>`, the JavaScript in a `<script type="module">` before `</body>`, and the image as `data:image/svg+xml;base64,PHN2Zy…` ✅[^4] ✅[^lab]. Code splitting cannot be combined with it, and base64 makes assets about 33% larger ✅[^4]. Lab: adding `--splitting` failed with `error: cannot use --compile --target browser with --splitting`, and a 30,000-byte PNG became 40,000 base64 characters (1.33×) ✅[^lab].
4. **One executable:** `bun build --compile ./prod-server.ts` embedded the pages; run from `/`, it served `/chunk-w4xc3kck.css`, `/chunk-2tptvw1d.js` and the logo, with `index` pointing at `/$bunfs/root/index-q6knbvsw.html` ✅[^lab].

## Worked example
One page, served in development, edited, then built for production ✅[^lab]:
1. `bun server.ts` (`development: true`, `port: 0`) logged `Bundled page in 14ms: index.html`. `GET /` returned:
   ```html
   <link rel="stylesheet" href="/_bun/asset/3aab9c8e1a59efb0.css"><link rel="stylesheet" href="/_bun/asset/383d627da32a782f.css"><script type="module" crossorigin src="/_bun/client/index-0000000042354f6a.js" data-bun-dev-server-script></script>…</head>
   <img src="/_bun/asset/a8ce3b62b0deb358.svg" alt="logo" />
   ```
   The script's end listed each module by file, for example `"label.ts": [ [], ["label"], [], (hmr) => { hmr.exports = { label: "Click me" }; }, false]`, and the build info `{ main: "index.html", bun: "1.4.5", generation: "42354f6a", … }`.
2. With a WebSocket open on `/_bun/hmr`, writing `export const label: string = "Edited label";` to `label.ts` logged `Reloaded in 0ms: label.ts` and delivered a 259-byte `u` message with the new `label.ts` module.
3. With `DEV=0` (`development: false`) the same `server.ts` served `/chunk-enpkv15n.js`:
   ```js
   var t={primary:"primary_NhKpNw"};var o="Click me";var r=((void 0)?.data.count??0)+1;document.getElementById("root").innerHTML=`<button class="${t.primary}">${o} #${r}</button>`;console.log("PUBLIC_API =",process.env.PUBLIC_API);
   ```
   `import.meta.hot.accept()` and `.dispose()` were gone, `import.meta.hot?.data` had become `(void 0)?.data`, and `process.env.PUBLIC_API` stayed as written because no `env` option was set.
4. `cd dist && bun prod-server.js` (the step 1 build of Production builds) served HTML that points at the pre-built files named in its manifest, `./index-x1kkkjsd.js` and `./index-ggxr56p0.css`, instead of new `/chunk-…` names.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Built `--target=bun` server started from another folder | `bun dist/prod-server.js` from the project root: `TypeError: Bundled file "./index-x1kkkjsd.js" not found` ✅[^lab] | The manifest paths are relative and were looked up from the current directory; start it inside `dist` (as the docs' Dockerfile does with `WORKDIR`) ✅[^1], or `--compile` it |
| `const hot = import.meta.hot; hot.accept();` | Production output `var hot = undefined; hot.accept();`, a `TypeError` at run time; the build gave no error ✅[^lab] | Only the full `import.meta.hot.<name>` form is recognized and removed ✅[^2] |
| CSS nesting in other outputs | Lowered in `bun build ./index.html` and in `development: false`; kept as `&:hover` in development, in the `--target=bun` server build, and in standalone HTML ✅[^lab]. `1.4.6-canary.1` also lowered it in `bun build ./page.html` and kept it in standalone HTML ✅[^lab] | The docs say nesting is converted to flat CSS "that works in all browsers" ✅[^5]; where 1.4.5 keeps it, the page needs a browser with native nesting, so check the output CSS when old browsers matter |
| `development: true` and source maps | No `SourceMap` header; the script ends with `//# sourceMappingURL=/_bun/client/<generation>.js.map` ✅[^lab] | The docs mention a header ✅[^1]; devtools find the map either way |
| Several stylesheets in development | Two `<link>` tags, one per CSS file; production merged them into one ✅[^lab] | The docs describe one combined `<link>` ✅[^1], which matched production only |
| `import styles from "./btn.module.css"` under `bun run`: run-time class map documented on bun.com, not in 1.4.5 | `{}` at run time, while the bundle has `{ primary: "primary_NhKpNw" }`; a plain `.css` import is `{}` too ✅[^lab] ✅[^7]. Present in `1.4.6-canary.1` (the `oven/bun:canary` preview build), not in 1.4.5: `bun run` gave `{"primary":"primary_NhKpNw","shared":"shared_NhKpNw","withcomp":"shared_NhKpNw withcomp_NhKpNw"}`, and a plain `.css` import stayed `{}`. Bun 1.3.14 gave each file's absolute path as a string (`"/w/css/plain.css"`, `"/w/css/btn.module.css"`), the behaviour the 1.4 notes say 1.4.0 replaced ✅[^lab] ✅[^7] | Since 1.4.0 `.css` imports export `{}` at run time and `.module.css` still differs from `bun build` ✅[^7]; the live bun.com CSS page already describes the class map at run time, for a newer release ✅[^8]. The run-time loader values are in `bun/fundamentals/module-resolution-and-loaders.md` |
| `bun ./*.html` and client-side routes | `/nope` is 404 ✅[^lab] | The fallback to one page exists only when a single HTML file is served ✅[^3] |
| `<img srcset="./a.png 1x, ./b.png 2x">`, or one URL with a descriptor (`"./b.png 2x"`) | Build error `Could not resolve: "./b.png 2x"`, also in `1.4.6-canary.1` ✅[^lab] | The `html` loader lists `img[srcset]` ✅[^6] but takes the whole value as one path; only a single bare URL worked, so use `src` or a `<picture>` with one URL per `<source srcset>` |
| CSS `url()` of a file under 128 KiB | Inlined as `data:image/png;base64,…`; at 131,072 bytes and above copied as `f131072-35b48ytn.png` (same from an HTML page, a JavaScript import and a CSS entry) ✅[^lab] | The docs say `url()` assets are copied ✅[^3]; 1.4.5 inlines small ones, so a Content Security Policy that blocks `data:` images, or a cache rule that expects separate files, is affected |
| `import.meta.hot.on("vite:beforeUpdate", …)` | Never fired, while the `bun:beforeUpdate` handler next to it did, in two Chromium sessions, and two more with `1.4.6-canary.1`, where `vite:afterUpdate` stayed silent next to `bun:afterUpdate` as well ✅[^lab] | The docs say every event also exists with the `vite:*` prefix ✅[^2]; not observed in 1.4.5, so listen for `bun:*` |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Runtime bundling (`development: false`, no build step) | No build pipeline; minified, cached, immutable assets | First request pays the bundling time; bundler runs in production |
| Ahead-of-time `bun build --target=bun` | No bundling at start-up; manifest with ETags | Must run from the output folder; one more build step |
| `bun build ./index.html` | Plain static files for any host or CDN (content delivery network) | No server routes |
| Standalone HTML | One file that opens from `file://` | No code splitting; base64 adds about 33% per asset |

## Takeaways
- Serve frontends by putting HTML imports in `Bun.serve` `routes`; set `development` from the environment so production gets minified, immutable assets. [rule-candidate]
- Always write HMR calls as `import.meta.hot.accept()` / `.dispose()` / `.data`, never through a variable. [rule-candidate]
- Start an ahead-of-time built server from its output folder, or compile it into one executable. [rule-candidate]
- Use `env: "PUBLIC_*"` in `[serve.static]` or `--env`, not `inline`, so secrets never reach browser code.
- Check the emitted CSS for leftover nesting (`&:`) if you support browsers without native CSS nesting.

## Verification status
- Verified: 82 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- `linux/lab-setup.md` — the Bun 1.4.5 lab (`oven/bun:1.4.5` image, arm64) where every ✅[^lab] behaviour ran on 2026-11-24; the browser runs used headless Chromium 156 in `bunlab:2` (the same Bun plus Chromium and strace), and the server checks there used a small Bun `fetch` script; `oven/bun:canary` (`1.4.6-canary.1+bd92f9bef`, its binary also copied into `bunlab:2` for the browser runs) and `oven/bun:1.3.14` (`1.3.14+0d9b296af`) ran the cross-version checks. [^lab]
- [docs/bundler/fullstack.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/bundler/fullstack.mdx) — Bun documentation source at the release tag, 2026. Backs: HTML imports as routes, development vs production behaviour, runtime and ahead-of-time bundling, the manifest, `[serve.static]` plugins/env/sourcemap, the processing pipeline, the Dockerfile, the `SourceMap` header and single `<link>` claims. [^1]
- [docs/bundler/hot-reloading.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/bundler/hot-reloading.mdx) — Bun documentation source at the release tag, 2026. Backs: the `import.meta.hot` methods and status, accept semantics, full reload fallback, events, removal in production, no indirection. [^2]
- [docs/bundler/html-static.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/bundler/html-static.mdx) — Bun documentation source at the release tag, 2026. Backs: `bun ./index.html`, SPA fallback, multi-page routes and globs, `--console`, static builds with `--env`, CSS `@import` and `url()`. [^3]
- [docs/bundler/standalone-html.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/bundler/standalone-html.mdx) — Bun documentation source at the release tag, 2026. Backs: `--compile --target=browser`, what is inlined, no splitting, base64 overhead. [^4]
- [docs/bundler/css.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/bundler/css.mdx) — Bun documentation source at the release tag, 2026. Backs: syntax lowering and default browser targets, LightningCSS port, CSS modules and `composes`. [^5]
- [docs/bundler/loaders.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/bundler/loaders.mdx) — Bun documentation source at the release tag, 2026. Backs: the `html` loader, `lol-html`, the selector list, the three contexts of an HTML import. [^6]
- [Bun 1.4](https://bun.com/blog/bun-v1.4) — Bun blog, 2026. Backs: HTML-route source maps off in production, `.css` imports export `{}` at run time and `.module.css` differing from `bun build` (since 1.4.0). [^7]
- [CSS](https://bun.com/docs/bundler/css) — Bun documentation, living (read 2026-11-24; describes a release newer than 1.4.5). Backs: only the CSS-modules-at-run-time gap row in Edge cases. [^8]

## Related
- `bun/http-and-networking/bun-serve.md` — routes, handlers and server options around HTML imports.
- `bun/bundler/bun-build.md` — the bundler the HTML pipeline runs on.
- `bun/bundler/single-file-executables.md` — compiling a full-stack server into one file.
- `bun/bundler/plugins-and-macros.md` — the plugin API that `[serve.static] plugins` loads.
- `bun/fundamentals/watch-hot-and-debugging.md` — `--hot` and `--watch` for the server process.
