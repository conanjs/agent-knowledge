---
schema: knowledge-doc/v1
type: reference
topic: javascript/best-practices
status: verified
applies-to: ["HTTP semantics and caching (RFC 9110, RFC 9111, RFC 8246), HTTP/1.1 (RFC 9112), HTTP/2 (RFC 9113), HTTP/3 (RFC 9114), QUIC (RFC 9000)", "MDN, nginx, Amazon S3 and Google AIP docs (living, read 2026-11-22 to 2026-11-26); nginx 1.25.1 or later for http2 on", "one probe on Node.js 24.22.1 (node:24.22.1-alpine), 2026-11-22"]
last-verified: 2026-11-28
last-updated: 2026-11-28
tags: [javascript, best-practices, browser, http, caching, compression, cors, http2, http3]
derived-from: [web-apis/http2-http3-head-of-line-blocking-deep-dive.md]
ranked-sources: true
---

# JavaScript best practices: browser network requests

## Summary
**TL;DR:** Nine practices for the requests a page sends and the headers and protocol of the server that answers: cache lifetimes and validators, compression, cross-origin preflights, one HTTP/2 connection instead of sharded hosts, what HTTP/3 does and does not change, page-sized list requests, conditional polling and direct uploads of large files. A conditional request is answered `304` without a body ✅[^rfc9110], and HTTP/3 might not change performance for the average connection at all ✅[^fastly]. The figures are statements of the RFCs, vendors' documentation and published studies; one Node.js probe is the only lab run.
**Use this when:** you write or review `Cache-Control`, `ETag`, compression or CORS settings, nginx `gzip` or `http2` directives, asset hostnames, a plan to switch to HTTP/3, `fetch` calls to list endpoints, polling loops, or browser uploads of large files.
**Not this doc:** what the page loads and in which order → [browser-loading-and-delivery.md](browser-loading-and-delivery.md); request waterfalls created by React effects → `JB-F7` in [browser-component-frameworks.md](browser-component-frameworks.md); the mechanism of head-of-line blocking in HTTP/2 and HTTP/3 → the deep dive listed under Related.

## Scope
The catalog covers rules `JB-N1` to `JB-N9`. Their figures come from IETF (Internet Engineering Task Force) RFCs, MDN, nginx, Amazon S3 and Google API design docs, read 2026-11-22 to 2026-11-26, and from a peer-reviewed study and content delivery network (CDN) vendors' posts. They are stated by those sources, not measured in the knowledge base's own lab, except one Node.js probe in `JB-N6` (Node.js 24.22.1, one run) ✅[^lab-probe]. Each Evidence line says "stated by" to keep a source's figure apart from a measured one; counts such as "18 connections → 1" are arithmetic from the code.

How to read the "Applies" column: `always` means the better form is as clear as the other, so it is the default; `hot path` means it matters only in code that runs per request, per frame or per element of a large collection, or that a profile points at; `large data` means only above the size the row gives; `startup` means only when start time matters; `check build` means the answer depends on the client, server or network, as the row says; `no gain` means no useful difference was measured or expected, so there is no reason to change code or configuration for it.

Terms used below:
- **Freshness lifetime** (`max-age`): how long a cache may reuse a response without asking, like a "best before" date.
- **Validator** (`ETag`, `Last-Modified`): lets a cache ask "has this changed?" and get `304 Not Modified` with no body.
- **Preflight**: the `OPTIONS` request a browser sends before a non-simple cross-origin request, like phoning ahead to ask whether you may visit. **CORS** = Cross-Origin Resource Sharing.
- **Head-of-line (HOL) blocking**: the first item in a queue holding up every item behind it, like one slow car on a single-lane road.
- **RTT** = round-trip time. **Domain sharding**: spreading assets over several hostnames to get more HTTP/1.1 connections.
- **Presigned URL**: a time-limited link that lets a client upload to or download from object storage without holding credentials, like a one-day visitor badge.

## Catalog
| Id | Situation in the code | Practice | Applies | Evidence |
|---|---|---|---|---|
| `JB-N1` | Hashed asset files (`app.3f9a1c.js`) with a short `max-age`, `no-cache` or a global `no-store` | Send `Cache-Control: public, max-age=31536000, immutable` for fingerprinted URLs only | always | For an `immutable` response clients SHOULD NOT send a conditional request while it is fresh ✅[^rfc8246]. Count: 10,000 views a day of a 300 KB bundle with no caching = 3 GB a day |
| `JB-N2` | HTML or GET API responses with no `Cache-Control` and no `ETag`/`Last-Modified`, or `no-store` everywhere | Send `no-cache` (plus `private` if per user) with an `ETag`, so reuse is a bodiless `304` | always | With no explicit freshness a cache may assign a heuristic lifetime, typically 10% of the time since `Last-Modified` ✅[^rfc9111]; MDN advises `no-cache` with validators for HTML ✅[^mdn-caching] |
| `JB-N3` | Text responses with no `Content-Encoding`; nginx `gzip on;` without `gzip_types`; compressing JPEG/zip/WOFF2 | Compress JSON/HTML/CSS/JS/SVG (set `gzip_types`, `gzip_proxied`), skip compressed formats, send `Vary: Accept-Encoding` | always | gzip often halves the size or more; nginx defaults `gzip_types text/html` and `gzip_proxied off` ✅[^nginx-gzip]; up to 70% for some documents ✅[^mdn-compression] |
| `JB-N4` | Cross-origin `fetch` with JSON, `PUT`/`DELETE` or custom headers; CORS setup with no `maxAge` | Set `Access-Control-Max-Age`, or serve the API same-origin | hot path: cross-origin calls made many times per session | With no header the preflight result is cached 5 s; Chromium 76 and later caps it at 2 h, Firefox at 24 h ✅[^mdn-acma] |
| `JB-N5` | Shard hostnames `static1.` … `static4.`; a server with no HTTP/2 (`http2 on;` missing in nginx) | Serve HTTP/2 from one hostname; drop sharding so requests share one connection | check build: clients without HTTP/2 and very lossy networks are exceptions | Clients SHOULD NOT open more than one HTTP/2 connection per host and port ✅[^rfc9113]; nginx `http2` is `off` by default, from 1.25.1 ✅[^nginx-http2]. Count: 3 hosts × 6 connections = 18 → 1 |
| `JB-N6` | A plan to switch to HTTP/3 for speed, with no loss or throughput data | No speed gain to expect on clean, fast networks; measure loss and throughput first | no gain: low-loss, fast networks | HTTP/3 might not significantly affect the average connection ✅[^fastly]; over fast Internet QUIC with HTTP/3 showed up to 45.2% lower data rate, falling behind on Chrome above about 500 Mbps ✅[^zhang] |
| `JB-N7` | `fetch` of a whole list endpoint, then `.slice(0, 20)` or a map to a few fields in the browser | Request one page (`limit`, cursor) and only the fields shown; the API paginates | large data: list endpoints with no page limit | RPCs that return collections must provide pagination from the start ✅[^aip-158]; cost: whole lists → one page of bytes moved |
| `JB-N8` | `setInterval` polling that downloads the full body each time | Send `If-None-Match` with the last `ETag`; skip work on `304` | hot path | `If-None-Match` is primarily used in conditional GETs; a conditional request is answered `304` without a body ✅[^rfc9110] |
| `JB-N9` | A browser upload of a whole large file to the app server, which copies it to object storage | Upload straight to the store with presigned URLs, in parts | large data: files of 100 MB or more | S3 advises multipart from 100 MB and retransmits only a failed part ✅[^s3-mpu]; a presigned URL grants time-limited access ✅[^s3-presign]. Count: bytes through the app 2 × 1 GB → 0 |

## Lookup notes
### `JB-N1` Cache fingerprinted assets for a year, as `immutable`
Applies to static files whose URL changes when the content does (`app.3f9a1c.js`), served with no `Cache-Control`, a short `max-age`, `no-cache`, or a global `no-store` middleware.
**Prefer:**
```js
app.use('/assets', express.static('dist/assets', { immutable: true, maxAge: '1y' }));
// sends Cache-Control: public, max-age=31536000, immutable
```
**Avoid:**
```js
app.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); }); // everything, always
```
**Why:** a fresh cached response is reused with no request at all; a response stays fresh until its age passes `max-age` ✅[^rfc9111]. For an `immutable` response clients SHOULD NOT send a conditional request while it is fresh, even on reload, unless the user forces one ✅[^rfc8246].
**Evidence:** stated by RFC 9111, RFC 8246 and MDN (HTTP caching, living) ✅[^mdn-caching], not measured here. Count: 10,000 page views a day loading the same 300 KB bundle with no caching is 3 GB a day.
**Exceptions:** a URL that is not fingerprinted: a long `max-age` would serve stale files after a deploy (use `JB-N2`). A CDN in front that sets headers: check the edge, not the code.
**Check it:** load the page twice in Chrome DevTools, Network panel: assets show "(memory cache)" or "(disk cache)" on the second load.

### `JB-N2` Send HTML and API reads with `no-cache` and a validator, not `no-store`
Applies to HTML documents and GET API responses that can change.
**Prefer:**
```http
Cache-Control: no-cache          (add "private" when the response is per user)
ETag: "v42"
→ next request: If-None-Match: "v42"  →  304 Not Modified, no body
```
**Avoid:**
```http
Cache-Control: no-store   (on every response, including public pages)
```
**Why:** `no-cache` with a validator makes every reuse a cheap check, and `If-None-Match` is primarily used in conditional GETs ✅[^rfc9110]. With no explicit freshness, a cache may assign a heuristic lifetime; RFC 9111 says a typical setting might be 10% of the time since `Last-Modified` ✅[^rfc9111].
**Evidence:** stated by RFC 9110, RFC 9111 and MDN, not measured here: MDN advises an explicit `Cache-Control` on every response and `no-cache` with validators for HTML, and warns that `no-store` loses the back/forward cache ✅[^mdn-caching].
**Exceptions:** responses that carry secrets or change on every request: `no-store` is right there.
**Check it:** `curl -sI URL` shows `Cache-Control` and `ETag`; a second load in the Network panel shows `304` for the HTML.

### `JB-N3` Compress text responses, and only text responses
Applies to the server or proxy that answers the page (JSON, HTML, CSS, JavaScript, SVG): text with no `Content-Encoding`; nginx `gzip on;` with no `gzip_types`; `gzip_proxied` left `off` behind a load balancer; compression applied to JPEG, PNG, MP4, zip or WOFF2.
**Prefer:**
```nginx
gzip on;
gzip_types application/json text/css application/javascript image/svg+xml;
gzip_proxied any;   # behind a proxy that adds Via
gzip_static on;     # serve prebuilt .gz files (module not built by default)
```
**Avoid:**
```nginx
gzip on;            # alone: compresses text/html only
```
**Why:** text compresses well. A format that is already compressed usually gains nothing and can grow ✅[^mdn-compression]. A negotiated encoding needs `Vary: Accept-Encoding` so caches keep the variants apart ✅[^mdn-compression]. `gzip_static` serves a precompressed `.gz` file, and its module is not built by default ✅[^nginx-gzip-static].
**Evidence:** stated by the nginx docs (living, no version given for the defaults) and MDN (Compression in HTTP, living), not measured here: gzip often halves the size or more ✅[^nginx-gzip]; up to 70% for some documents ✅[^mdn-compression]. nginx defaults are `gzip off`, `gzip_types text/html`, `gzip_min_length 20` and `gzip_proxied off`, and nginx treats a request carrying `Via` as proxied, so behind such a proxy the default compresses nothing ✅[^nginx-gzip].
**Exceptions:** bodies under `gzip_min_length` (20 bytes by default) ✅[^nginx-gzip]; a CDN in front that compresses; a body that mixes secrets with attacker-controlled input over TLS (a security review decides).
**Check it:** `curl -sI -H 'Accept-Encoding: gzip, br' URL` shows `Content-Encoding`; compare `Content-Length` with and without the header.

### `JB-N4` Stop paying a preflight on every cross-origin call
Applies to cross-origin API calls made many times per session: `fetch` to another origin with `PUT`/`PATCH`/`DELETE`, `Content-Type: application/json` or custom headers (`Authorization`, `X-Api-Key`), and CORS middleware with no `maxAge`.
**Prefer:**
```js
app.use(cors({ origin: 'https://www.example.com', maxAge: 7200 })); // Access-Control-Max-Age: 7200
// or serve the API on the same origin through a path proxy: /api/* → api host
```
**Avoid:**
```js
app.use(cors({ origin: 'https://www.example.com' })); // no max-age: preflight result kept 5 s
```
**Why:** a non-simple cross-origin request is preceded by an `OPTIONS` round trip ✅[^mdn-cors]. `Access-Control-Max-Age` lets the browser reuse the preflight result, so later calls take one round trip instead of two.
**Evidence:** stated by MDN (CORS and `Access-Control-Max-Age`, living, read 2026-11-26), not measured here: with no header the preflight result is cached 5 seconds; Firefox caps the value at 24 hours and Chromium 76 and later at 2 hours ✅[^mdn-acma]; simple requests allow only `GET`, `HEAD`, `POST`, safelisted headers and three `Content-Type` values, among other conditions ✅[^mdn-cors].
**Exceptions:** same-origin calls; simple requests; calls rare enough that one preflight per session is all there is.
**Check it:** Chrome DevTools, Network panel, filter `method:OPTIONS`: preflights per minute in one session, before and after.

### `JB-N5` Serve HTTP/2 from one hostname instead of sharding over HTTP/1.1
Applies to asset hosts and the server config that answers the page: asset hostnames `static1.` … `static4.`, or nginx `listen 443 ssl;` with no `http2 on;`. The sources show a downside on lossy networks and for clients without HTTP/2 (see Exceptions).
**Prefer:**
```nginx
server { listen 443 ssl; http2 on; server_name www.example.com; }  # nginx 1.25.1+
```
```html
<script src="/assets/app.js" defer></script> <!-- one origin -->
```
**Avoid:**
```html
<img src="https://static1.example.com/a.png"><img src="https://static3.example.com/b.png">
```
**Why:** HTTP/1.x clients open several connections to get concurrency, while HTTP/2 interleaves many messages on one connection ✅[^rfc9113]; each extra connection pays its own handshake and slow start. HTTP/2 can also reuse one connection for several hostnames that share a certificate and address ✅[^rfc9113].
**Evidence:** stated by RFC 9113, RFC 9112 and the nginx docs (living), not measured here: clients SHOULD NOT open more than one HTTP/2 connection to a host and port pair (RFC 9113 §9.1), and a connection MAY be reused for several authorities (§9.1.1) ✅[^rfc9113]; RFC 9112 says a client "ought to" limit simultaneous connections and sets no number, so a per-host figure such as 6 is not from the spec ✅[^rfc9112]; nginx `http2` defaults to `off` and appeared in 1.25.1 ✅[^nginx-http2]. Count: 3 shard hostnames × 6 connections = 18 connections → 1.
**Exceptions:** clients that cannot speak HTTP/2; a lossy mobile network, where one HTTP/2 connection suffers TCP head-of-line blocking (`JB-N6`); bulk object-store transfers, where S3 recommends many concurrent connections ✅[^s3-perf].
**Check it:** Chrome DevTools, Network panel, "Protocol" and "Connection ID" columns: distinct connections per page load.

### `JB-N6` HTTP/3 brings no speed gain to expect on a clean, fast network
Applies to a plan to enable HTTP/3 to make a page faster, with no loss or throughput measurements. On links with almost no packet loss and on fast links there is no gain to expect.
**Keep writing:** one HTTP/2 connection per origin (`JB-N5`); loss and throughput are measured on the users' networks before the protocol changes.
**Why:** under HTTP/2 a lost or reordered TCP packet stalls every active transaction on the connection ✅[^rfc9114]; under HTTP/3 over QUIC only the streams with data in the lost packet wait ✅[^rfc9000]. That helps only where loss is frequent, and head-of-line blocking remains in HTTP/3: within one stream ✅[^marx], for streams that share a lost packet ✅[^rfc9000], in QPACK header compression when the decoder allows blocked streams ✅[^rfc9204], and in the one congestion controller per connection ✅[^marx].
**Evidence:** stated by RFC 9114, RFC 9000, a 2024 peer-reviewed study and CDN vendors' posts, not measured here:
- A CDN vendor's 2020 post: HTTP/3 might not significantly affect performance for the average connection, or affect it at all, especially when the HTTP/2 session it is compared with has almost no packet loss and already follows best-practice TLS and TCP configuration ✅[^fastly].
- The same post reports a 2016 study of HTTP/2 against HTTP/1: below 0.5% loss HTTP/2 benefited, between 0.5% and 1.5% it gained about as much as it lost, above 1.5% it was harmed; a rough rule of thumb, for HTTP/2, not HTTP/3 ✅[^fastly].
- Zhang et al. (WWW 2024): over fast Internet the UDP+QUIC+HTTP/3 stack showed a data rate up to 45.2% lower than TCP+TLS+HTTP/2, the gap grew with bandwidth, and on Chrome QUIC fell behind above about 500 Mbps (45.2% slower at 1 Gbps); they name receiver-side processing as the cause ✅[^zhang].
- Edeline et al. (2016): complete UDP blocking on about 2% to 4% of terrestrial access networks; where QUIC over UDP is blocked or limited (1% to 5% of networks), the fallback is HTTP/2 over TLS and TCP ✅[^edeline].
- The knowledge base's own probe (Node.js 24.22.1, `node:24.22.1-alpine`, one run) saw three concurrent HTTP/2 requests share 1 TCP connection (stream IDs 1, 3, 5), the precondition for TCP head-of-line blocking ✅[^lab-probe]; no probe shows packet loss.
**Exceptions:** users on lossy networks (mobile, long-distance) may gain. How often loss is high enough is ⚖️ open conflict between two Rank 4 sources, and no Rank 1 source settles it: a CDN vendor's post says 75% of its edge connections fell in the range where HTTP/2 helped ✅[^fastly], while an independent author says even on the worst cellular networks loss above 2% is rare ✅[^marx]; the two use different thresholds, populations and years. A slow HTTP/2 upload on a clean, fast link is a flow-control window or server receive buffer smaller than bandwidth × RTT, not head-of-line blocking: another CDN vendor's 2020 post measured a 10 MB upload at 200 Mbps and 40 ms RTT at almost half the speed of HTTP/1.1 with its production configuration, and the two almost identical at 5 Mbps and 20 ms ✅[^cfupload].
**Check it:** the Network panel "Protocol" column (`h2`, `h3`); field data split by network type; for uploads, compare the server's receive buffer and window sizes with bandwidth × RTT.
**Full lab:** [http2-http3-head-of-line-blocking-deep-dive.md](../../web-apis/http2-http3-head-of-line-blocking-deep-dive.md) §4.4 (the probe), §6.1, §6.3, §6.5, §6.6 and §6.7 (telling the stalls apart).

### `JB-N7` Request one page of a list and only the fields the screen shows
Applies to list endpoints with no page limit (the sources give no row-count threshold): `fetch('/api/orders')` that returns every order with every field, then `.slice(0, 20)` or a map to three fields in the browser.
**Prefer:**
```js
const res = await fetch(`/api/orders?limit=20&cursor=${cursor}&fields=id,total,status`);
```
**Avoid:**
```js
const all = await (await fetch('/api/orders')).json();
render(all.slice(0, 20).map(({ id, total, status }) => ({ id, total, status })));
```
**Why:** every byte of the unused rows and fields is sent, parsed and held by the page. A page limit bounds the response; projection drops the fields.
**Evidence:** stated by Google AIP-158 (API design guide, living), not measured here: AIP-158 says RPCs that return collections of data must provide pagination at the outset ✅[^aip-158]; the cost is bytes moved, whole lists → one page. AIP-158 also says the API should coerce a page size above the permitted maximum down to that maximum ✅[^aip-158].
**Exceptions:** a list that the data keeps small (a few dozen entries) and that the screen shows whole.
**Check it:** Network panel: response size and item count per request, before and after.

### `JB-N8` When a page polls a URL, make each poll a conditional request
Applies to `setInterval` or a loop that re-fetches the same resource and downloads the full body each time.
**Prefer:**
```js
let etag;
setInterval(async () => {
  const r = await fetch(url, { headers: etag ? { 'If-None-Match': etag } : {} });
  if (r.status === 304) return;          // unchanged: no body sent
  etag = r.headers.get('ETag'); render(await r.json());
}, 5000);
```
**Avoid:**
```js
setInterval(async () => render(await (await fetch(url)).json()), 5000);
```
**Why:** an unchanged resource answered with `304 Not Modified` carries no body ✅[^rfc9110], so an idle poll costs headers only.
**Evidence:** stated by RFC 9110 (HTTP semantics), not measured here: `If-None-Match` is primarily used in conditional GET requests to enable efficient updates of cached information ✅[^rfc9110]. The first performance catalog files full downloads per poll under its incremental-work class, with conditional requests as the fix.
**Exceptions:** a server that sends no `ETag` or `Last-Modified` (add one first, `JB-N2`); a push channel (server-sent events, WebSocket) already used.
**Check it:** Network panel while the page is idle: polls return `304` and transfer only headers.

### `JB-N9` Upload large files from the browser straight to the store, in parts
Applies to files of 100 MB or more, or uploads that must survive a dropped connection, when a browser `fetch(PUT)` or form post sends the whole file to the app server, which then copies it to object storage.
**Prefer:**
```js
const { urls } = await (await fetch('/api/uploads', { method: 'POST' })).json(); // app signs only
for (const [i, url] of urls.entries()) {
  await fetch(url, { method: 'PUT', body: file.slice(i * PART, (i + 1) * PART) }); // presigned part
}
```
**Avoid:**
```js
await fetch('/api/upload', { method: 'POST', body: file }); // 1 GB through the app, all or nothing
```
**Why:** a presigned URL lets the browser send bytes to the store directly without holding credentials ✅[^s3-presign], so the app carries none of them. Parts make a failure cost one part, not the whole file ✅[^s3-mpu].
**Evidence:** stated by the Amazon S3 docs (living, read 2026-11-26), not measured here: S3 advises multipart for objects of 100 MB or more and retransmits only a failed part ✅[^s3-mpu]; up to 10,000 parts of 5 MiB to 5 GiB each, no minimum for the last ✅[^s3-mpu-limits]; a presigned URL grants time-limited access ✅[^s3-presign]. Count: 1 GB in 100 MB parts, one failure re-sends 100 MB, not 1 GB; bytes through the app 2 × 1 GB → 0. The network catalog states presigned URLs and multipart upload as two separate fixes; one presigned URL per part is this rule's combination, not a sentence of the catalog.
**Exceptions:** the app must scan or transform every byte (then stream it); small files (S3 calls multipart a best practice from 100 MB ✅[^s3-mpu]; that it is unnecessary below is the catalog's own inference); a store not reachable from browsers.
**Check it:** kill the connection at 90% in a test and count bytes re-sent; app server ingress bytes per upload.

## Takeaways
- Fingerprinted assets get a one-year `immutable` lifetime; HTML and API reads get `no-cache` with an `ETag` ✅[^rfc8246]. [rule-candidate]
- Compress text and only text, and set `gzip_types`: nginx's default compresses only `text/html` ✅[^nginx-gzip].
- A repeated cross-origin call with JSON or custom headers needs `Access-Control-Max-Age`; without it the preflight result lasts 5 s ✅[^mdn-acma].
- One HTTP/2 connection per origin replaces sharding; HTTP/3 is a choice for lossy networks, not a default speed-up ✅[^fastly].
- Lists are fetched a page at a time (AIP-158: pagination from the start) ✅[^aip-158], polls are conditional ✅[^rfc9110], and large uploads go straight to the store in parts ✅[^s3-mpu].

## Verification status
- Verified: 70 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-28

## References
- Lab probe: one Node.js `http2` client session sending three requests at once to a local server, counting accepted TCP connections; Node.js 24.22.1 in `node:24.22.1-alpine`, one run, printed `ids=1,3,5 sockets=1`. Script and output: `web-apis/http2-http3-head-of-line-blocking-deep-dive.md` §4.4. Rank 1 (primary measurement). Backs: Scope; Lookup notes, JB-N6. [^lab-probe]
- [RFC 9110: HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110.html) — IETF, 2022. Rank 1. Backs: Summary; Catalog, JB-N8; Lookup notes; Takeaways. [^rfc9110]
- [RFC 9111: HTTP Caching](https://www.rfc-editor.org/rfc/rfc9111.html) — IETF, 2022. Rank 1. Backs: Catalog, JB-N2; Lookup notes. [^rfc9111]
- [RFC 8246: HTTP Immutable Responses](https://www.rfc-editor.org/rfc/rfc8246.html) — IETF, 2017. Rank 1. Backs: Catalog, JB-N1; Lookup notes; Takeaways. [^rfc8246]
- [RFC 9112: HTTP/1.1](https://www.rfc-editor.org/rfc/rfc9112.html) — IETF, 2022. Rank 1. Backs: Lookup notes, JB-N5. [^rfc9112]
- [RFC 9113: HTTP/2](https://www.rfc-editor.org/rfc/rfc9113.html) — IETF, 2022. Rank 1. Backs: Catalog, JB-N5; Lookup notes. [^rfc9113]
- [RFC 9114: HTTP/3](https://datatracker.ietf.org/doc/html/rfc9114) — IETF, 2022. Rank 1. Backs: Lookup notes, JB-N6. [^rfc9114]
- [RFC 9000: QUIC: A UDP-Based Multiplexed and Secure Transport](https://www.rfc-editor.org/rfc/rfc9000.html) — IETF, 2021. Rank 1. Backs: Lookup notes, JB-N6. [^rfc9000]
- [RFC 9204: QPACK: Field Compression for HTTP/3](https://datatracker.ietf.org/doc/html/rfc9204) — IETF, 2022. Rank 1. Backs: Lookup notes, JB-N6. [^rfc9204]
- [Module ngx_http_gzip_module](https://nginx.org/en/docs/http/ngx_http_gzip_module.html) — nginx, living. Rank 1. Backs: Catalog, JB-N3; Lookup notes; Takeaways. [^nginx-gzip]
- [Module ngx_http_gzip_static_module](https://nginx.org/en/docs/http/ngx_http_gzip_static_module.html) — nginx, living. Rank 1. Backs: Lookup notes, JB-N3. [^nginx-gzip-static]
- [Module ngx_http_v2_module](https://nginx.org/en/docs/http/ngx_http_v2_module.html) — nginx, living. Rank 1. Backs: Catalog, JB-N5; Lookup notes. [^nginx-http2]
- [AIP-158: Pagination](https://google.aip.dev/158) — Google, living. Rank 1. Backs: Catalog, JB-N7; Lookup notes; Takeaways. [^aip-158]
- [Download and upload objects with presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html) — Amazon Web Services, living. Rank 1. Backs: Catalog, JB-N9; Lookup notes. [^s3-presign]
- [Uploading and copying objects using multipart upload](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html) — Amazon Web Services, living. Rank 1. Backs: Catalog, JB-N9; Lookup notes; Takeaways. [^s3-mpu]
- [Amazon S3 multipart upload limits](https://docs.aws.amazon.com/AmazonS3/latest/userguide/qfacts.html) — Amazon Web Services, living. Rank 1. Backs: Lookup notes, JB-N9. [^s3-mpu-limits]
- [Performance guidelines for Amazon S3](https://docs.aws.amazon.com/AmazonS3/latest/userguide/optimizing-performance-guidelines.html) — Amazon Web Services, living. Rank 1. Backs: Lookup notes, JB-N5. [^s3-perf]
- [QUIC is not Quick Enough over Fast Internet](https://arxiv.org/html/2310.09423v2) — Zhang et al., Proceedings of the ACM Web Conference (WWW '24), 2024. Rank 2. Backs: Catalog, JB-N6; Lookup notes. [^zhang]
- [Using UDP for Internet Transport Evolution](https://arxiv.org/html/1612.07816v1) — Edeline et al., ETH TIK Technical Report 366, 2016. Rank 2. Backs: Lookup notes, JB-N6. [^edeline]
- [HTTP caching](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching) — MDN Web Docs, living. Rank 3. Backs: Catalog, JB-N2; Lookup notes. [^mdn-caching]
- [Compression in HTTP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Compression) — MDN Web Docs, living. Rank 3. Backs: Catalog, JB-N3; Lookup notes. [^mdn-compression]
- [Cross-Origin Resource Sharing (CORS)](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS) — MDN Web Docs, living. Rank 3. Backs: Lookup notes, JB-N4. [^mdn-cors]
- [Access-Control-Max-Age](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Access-Control-Max-Age) — MDN Web Docs, living. Rank 3. Backs: Catalog, JB-N4; Lookup notes; Takeaways. [^mdn-acma]
- [Head-of-Line Blocking in QUIC and HTTP/3: The Details](https://calendar.perfplanet.com/2020/head-of-line-blocking-in-quic-and-http-3-the-details/) — Robin Marx, Web Performance Calendar, 2020. Rank 4. Backs: Lookup notes, JB-N6. [^marx]
- [How HTTP/3 and QUIC aim to help the connections that need it most](https://www.fastly.com/blog/how-http3-and-quic-help-long-tail-connections) — Patrick McManus, Fastly, 2020. Rank 4. Backs: Summary; Catalog, JB-N6; Lookup notes; Takeaways. [^fastly]
- [Delivering HTTP/2 upload speed improvements](https://blog.cloudflare.com/delivering-http-2-upload-speed-improvements/) — Junho Choi, Cloudflare, 2020. Rank 4. Backs: Lookup notes, JB-N6. [^cfupload]

## Related
- [browser-loading-and-delivery.md](browser-loading-and-delivery.md) — what a page loads and in which order, and the back/forward cache (`JB-L`).
- [browser-component-frameworks.md](browser-component-frameworks.md) — `JB-F7`, request waterfalls from component effects.
- [browser-rendering-and-interaction.md](browser-rendering-and-interaction.md) — what happens on the main thread once the response arrives (`JB-R`).
- [../../web-apis/http2-http3-head-of-line-blocking-deep-dive.md](../../web-apis/http2-http3-head-of-line-blocking-deep-dive.md) — head-of-line blocking in HTTP/2 and HTTP/3, the probe, and how to tell the stalls apart.
- [../../performance/code-review/problem-classes-network-and-delivery.md](../../performance/code-review/problem-classes-network-and-delivery.md) — the network catalog: `missing-cache-headers`, `response-compression`, `cors-preflight-repeat`, `http1-connection-fanout`, `app-proxied-transfer`, `whole-object-transfer`.
- [../../performance/code-review/problem-classes.md](../../performance/code-review/problem-classes.md) — the first catalog: `payload-overfetch` and `full-rescan-incremental`.
