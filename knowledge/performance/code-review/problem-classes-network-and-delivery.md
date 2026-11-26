---
schema: knowledge-doc/v1
type: reference
topic: performance/code-review
status: verified
applies-to: ["HTTP semantics and caching (RFC 9110, RFC 9111, RFC 8246), HTTP/1.1 (RFC 9112), HTTP/2 (RFC 9113)", "TCP (RFC 896, RFC 1122), Linux man-pages 6.19", "Node.js v26.13.1 docs, nginx docs (living), Amazon S3 docs (living), NIST SP 800-63B-4, OWASP Password Storage Cheat Sheet, all read 2026-11-26"]
last-verified: 2026-11-26
last-updated: 2026-11-26
tags: [performance, code-review, http, caching, compression, cors, tcp, nagle, http2, password-hashing, object-storage, s3, presigned-url, multipart]
ranked-sources: true
---

# Performance problem classes for code review: network and delivery

## Summary
**TL;DR:** Many slow requests come from how bytes travel, not from what the code computes: responses that every client downloads again, text sent uncompressed, a preflight before every cross-origin call, small socket writes that wait for an acknowledgement, too many connections, a password hash on every API call, and large files routed through the application. Each of the nine classes here has a code or config signal, a named fix, and a cost you can count (requests, round trips, bytes, hashes) before running anything.
**Use this when:** you review HTTP handlers, server or proxy config (nginx, Node.js), authentication middleware, or code that moves files to and from an object store; you need the fix and the before → after count for one of these shapes.
**Not this doc:** the first 39 classes (N+1 calls, connection pools, page-load waterfalls, overfetching, unbuffered I/O, blocking calls in async code) → [problem-classes.md](problem-classes.md); why one lost packet stalls an HTTP/2 connection → [../../web-apis/http2-http3-head-of-line-blocking-deep-dive.md](../../web-apis/http2-http3-head-of-line-blocking-deep-dive.md); token storage and revocation → [../../security/jwt-storage-and-revocation-deep-dive.md](../../security/jwt-storage-and-revocation-deep-dive.md); the review agent and its calibration → [perf-reviewer-calibration.md](perf-reviewer-calibration.md).

## Scope
**Domain:** the request path between a client and the bytes it wants: HTTP caching and content encoding, cross-origin preflights, TCP (Transmission Control Protocol) write behaviour, connection count per origin, cryptography run per request, and large-object transfer through object storage. Covered products: HTTP as specified in RFC 9110 to RFC 9113, Linux TCP, Node.js v26, nginx, Amazon S3 (Simple Storage Service). Not covered: TLS (Transport Layer Security) cipher choice, CDN (content delivery network) vendor settings, QUIC tuning, and congestion-control algorithms.

**Notation** (each symbol with one worked example):
- **n**: requests or page views in a period. Example: n = 10,000 page views a day, each loading the same 300 KB bundle, is 10,000 × 300 KB = 3 GB a day with no caching.
- **b**: body size in bytes. Example: a 200 KB JSON (JavaScript Object Notation) response that compresses by half is about 100 KB on the wire.
- **k**: objects or keys under an object-store prefix. Example: k = 25,000 keys and a list page of at most 1,000 keys means ⌈25,000 / 1,000⌉ = 25 list requests to see them all.
- **c**: connections per origin. Example: a page on HTTP/1.1 spread over 3 shard hostnames with 6 connections each opens c = 18 connections, each with its own handshake.
- **p**: parts of a multipart transfer. Example: a 1 GB upload in 100 MB parts has p = 10; one failed part re-sends 100 MB, not 1 GB.

| Term | Plain meaning | Analogy | Concrete example |
|---|---|---|---|
| Freshness lifetime | How long a cache may reuse a stored response without asking the server | The "best before" date on a carton | `Cache-Control: max-age=600` allows reuse for 600 seconds |
| Validator (ETag, Last-Modified) | A tag that lets a cache ask "has this changed?" | A receipt number you quote to the shop | `If-None-Match: "abc"` answered `304 Not Modified` with no body |
| Content encoding | A compressed form of the body, agreed through headers | Vacuum-packing clothes for a suitcase | `Accept-Encoding: gzip, br` in the request, `Content-Encoding: gzip` in the response |
| Preflight | An `OPTIONS` request the browser sends before a non-simple cross-origin request | Phoning ahead to ask whether you may visit | `fetch(url, {method: "PUT", headers: {"X-Api-Key": k}})` triggers `OPTIONS` first |
| Nagle's algorithm | TCP holds small new data while earlier data is unacknowledged | A courier who waits to fill the van before leaving | Two `write()` calls of 40 bytes each: the second waits for the first one's ACK |
| Delayed ACK | The receiver waits a little before acknowledging, hoping to piggyback the ACK on a reply | Answering several letters in one envelope | A server that reads a request header and waits for the body before replying |
| Multiplexing | Many requests interleaved on one connection | One phone call with several topics, not one call per topic | Six images over one HTTP/2 connection instead of six HTTP/1.1 connections |
| Password hashing scheme | A deliberately slow, salted hash for low-entropy secrets | A safe with a slow combination lock | Argon2id with 19 MiB of memory per hash |
| Presigned URL | A time-limited URL that lets a client read or write one object directly | A one-day visitor pass for one room | A `PUT` URL valid 15 minutes for `uploads/123.jpg` |
| Multipart upload | One object sent as independent parts, assembled at the end | Shipping furniture in labelled boxes | 1 GB sent as 10 parts of 100 MB |

## Catalog

**HTTP caching, encoding and preflight**

| Class | Signals in code | Fix | Before → after | Check |
|---|---|---|---|---|
| `missing-cache-headers` | static or rarely changing responses with no `Cache-Control`; `no-store` on everything; fingerprinted assets (`app.3f9a1c.js`) served with a short `max-age` or `no-cache`; no `ETag` or `Last-Modified` on large GET responses; Express `res.set('Cache-Control', 'no-store')` as a global middleware | Fingerprinted assets: `Cache-Control: public, max-age=31536000, immutable`; HTML and API reads: `no-cache` plus `ETag` or `Last-Modified`, `private` when personalised | Per repeat view: one full download of b bytes → zero requests while fresh, or one `304` with no body. A response stays fresh until its age passes `max-age` ✅[^rfc9111]; with no explicit freshness a cache may assign a heuristic lifetime, and RFC 9111 says a typical setting might be 10% of the time since `Last-Modified` ✅[^rfc9111]; for an `immutable` response clients SHOULD NOT send a conditional request while it is fresh (for example on reload), unless the user forces a reload ✅[^rfc8246]; `If-None-Match` is primarily used in conditional GET requests to enable efficient updates of cached information ✅[^rfc9110]; MDN advises an explicit `Cache-Control` on every response, `no-cache` with validators for HTML, and warns that `no-store` loses the back/forward cache ✅[^mdn-caching] | Load the page twice: the second load shows assets "from cache" and HTML as `304`; count bytes transferred on a repeat view |
| `response-compression` | text responses (JSON, HTML, CSS, JS, SVG) with no `Content-Encoding`; nginx `gzip on;` with no `gzip_types`; `gzip_proxied` left at `off` behind a load balancer; compression applied to JPEG, PNG, MP4 or zip bodies; per-request compression of the same static file | Turn on compression for text types (nginx `gzip_types application/json text/css …`; Node `zlib` or framework middleware); exclude already-compressed types; precompress static files (`gzip_static on;`); send `Vary: Accept-Encoding` | Bytes per text response b → often b/2 or less: nginx says gzip often halves the size or more ✅[^nginx-gzip], MDN cites up to 70% for some documents ✅[^mdn-compression]. nginx defaults are `gzip off`, `gzip_types text/html`, `gzip_min_length 20` and `gzip_proxied off`, which disables compression for proxied requests, and nginx treats a request as proxied when it carries a `Via` header ✅[^nginx-gzip] (the page states no version for these defaults); compressing an already compressed format usually gains nothing and is often counterproductive, since the result can be larger ✅[^mdn-compression]; `gzip_static` serves a precompressed `.gz` file instead of the regular file (the module is not built by default) ✅[^nginx-gzip-static]; a negotiated encoding needs `Vary: Accept-Encoding` ✅[^mdn-compression] | `curl -sI -H 'Accept-Encoding: gzip, br' URL` shows `Content-Encoding`; compare `Content-Length` with and without the header; nginx `$gzip_ratio` in the access log ✅[^nginx-gzip] |
| `cors-preflight-repeat` | browser calls to another origin with `PUT`/`PATCH`/`DELETE`, `Content-Type: application/json`, or custom headers (`Authorization`, `X-Api-Key`) on every call; CORS middleware with no `maxAge` / `Access-Control-Max-Age`; an API on `api.` called from `www.` for every read | Set `Access-Control-Max-Age` (capped by browsers); keep cacheable reads simple requests where possible; serve the API from the same origin through a path proxy | Round trips per cross-origin call 2 → 1 after the first preflight within the max-age. Non-simple requests send an `OPTIONS` preflight first; simple ones allow only `GET`, `HEAD`, `POST`, safelisted headers, and three `Content-Type` values, among other conditions ✅[^mdn-cors]; with no header the preflight result is cached 5 seconds; Firefox caps the value at 24 hours and Chromium 76+ at 2 hours ✅[^mdn-acma] | Browser network panel: `OPTIONS` requests per minute for one user session, before and after |

**Transport and connections**

| Class | Signals in code | Fix | Before → after | Check |
|---|---|---|---|---|
| `small-socket-writes` | a raw TCP protocol (`net.Socket`, Go `net.Conn`, Java `Socket`) that writes a header and a body in separate `write()` calls, then waits for a reply; a request/response protocol over sockets with no `setNoDelay` / `TCP_NODELAY`; one `write()` per field or per line | Build the whole message and write once (or `writev`, Node `writable.cork()`/`uncork()`); set `TCP_NODELAY` (`socket.setNoDelay()`) for request/response traffic; Linux `TCP_CORK` only for header-then-`sendfile` | Segments per message k → 1, and a wait of up to the receiver's delayed-ACK timer per write-write-read exchange → none. Nagle holds new data while earlier data is unacknowledged ✅[^rfc896]; RFC 1122 says a TCP SHOULD implement delayed ACKs and the delay MUST be less than 0.5 seconds ✅[^rfc1122]; it also says there MUST be a way for an application to disable Nagle on an individual connection (Nagle itself is a SHOULD) ✅[^rfc1122]; Linux `TCP_NODELAY` sends segments as soon as possible, and `TCP_CORK` holds partial frames for at most 200 ms ✅[^tcp7]; in Node.js a new TCP connection starts with Nagle on ✅[^node-net]; `cork()` exists for several small chunks written in rapid succession ✅[^node-stream] | Packet capture (`tcpdump`): segments per message and the gap between the first and second segment; latency of a small request/response at p50 before and after |
| `http1-connection-fanout` | asset hostnames `static1.` … `static4.` (domain sharding); servers that speak only HTTP/1.1 (nginx `listen 443 ssl;` with no `http2 on;`); client code that opens many parallel HTTP/1.1 connections to one host to get concurrency | Serve HTTP/2 (nginx `http2 on;`) or HTTP/3; drop shard hostnames, or serve them from one certificate and address so HTTP/2 can coalesce them | Connections per origin c → 1, so c handshakes and c slow starts → 1. HTTP/1.x clients open several connections for concurrency, while HTTP/2 interleaves messages on one ✅[^rfc9113]; RFC 9113 §9.1 says clients SHOULD NOT open more than one HTTP/2 connection to a host and port pair, and §9.1.1 says a connection MAY be reused for several authorities ✅[^rfc9113]; RFC 9112 §9.4 says a client ought to limit simultaneous connections to a server (lowercase "ought", not a requirement keyword), since many connections can cause side effects in congested networks ✅[^rfc9112]; nginx `http2` defaults to `off` and appeared in 1.25.1 ✅[^nginx-http2] | Browser network panel "Protocol" and "Connection ID" columns: distinct connections per page load |

**Cryptography on the request path**

| Class | Signals in code | Fix | Before → after | Check |
|---|---|---|---|---|
| `slow-hash-per-request` | `bcrypt.compare`, `argon2.verify`, `pbkdf2`, `scrypt` inside authentication middleware that runs for every API request; API keys or bearer tokens stored as bcrypt hashes and checked per call; a password re-verified on every request instead of once at login | Verify the password once at login and issue a session or token; generate API tokens with high entropy (at least 112 bits) and store them with a fast approved hash (SHA-256 or HMAC), looked up by prefix or id (this catalog's inference from NIST's look-up secret rule; neither NIST nor OWASP names API tokens) | Per request: one deliberately slow hash → one fast hash or a session lookup. OWASP sets Argon2id at a minimum of 19 MiB of memory and 2 iterations, bcrypt at work factor 10 or more, PBKDF2-HMAC-SHA256 at 600,000 iterations, says a hash should take under one second, and warns that a work factor that is too high can degrade performance, which an attacker could use for a denial-of-service attack ✅[^owasp-pw]; so n requests cost n slow hashes and, with Argon2id, up to 19 MiB per concurrent verification. NIST SP 800-63B-4 says look-up secrets SHALL be stored hashed with an approved hashing function, and those shorter than the 112-bit minimum SHALL use a password hashing scheme; passwords SHALL be salted and hashed with a password hashing scheme ✅[^nist-63b] | CPU profile of the auth middleware; requests per second of a cheap endpoint with and without authentication |

**Large objects and object storage**

| Class | Signals in code | Fix | Before → after | Check |
|---|---|---|---|---|
| `app-proxied-transfer` | download handlers that `GetObject` from the store and pipe or send the bytes to the client; upload handlers that receive the file (multer, `request.files`) and then `PutObject`; `fs.readFile` or `await res.arrayBuffer()` of a whole file before sending | Presigned `GET`/`PUT` URLs so the client talks to the store directly; nginx `X-Accel-Redirect` to an `internal` location for files the proxy can read; stream (`fs.createReadStream`, `stream.pipeline`) when the app must touch the bytes | Bytes through the application per transfer 2·b (in from one side, out to the other) → 0 with a presigned URL; memory per transfer O(b) → O(chunk) when streaming. A presigned URL grants time-limited access and allows an upload without the client holding credentials, set up to 7 days when created with the CLI or an SDK (IAM user credentials with Signature Version 4; a URL made from temporary credentials ends when they do) ✅[^s3-presign]; nginx serves requests redirected by `X-Accel-Redirect` from an upstream in an `internal` location ✅[^nginx-core]; Node's `fs.readFile` buffers the entire file, and the docs prefer `createReadStream` ✅[^node-fs] | Application egress and ingress bytes per transfer; heap used while sending a file of 1 GB against one of 10 MB |
| `whole-object-transfer` | one `PutObject` or single `PUT` for files of hundreds of megabytes or more; downloads of large objects with one `GET` and no `Range`; retry logic that restarts the whole file | Multipart upload (SDK transfer managers, `CreateMultipartUpload` / `UploadPart`); byte-range `GET` (`Range: bytes=…`) for resume and parallel download; keep a resume offset | Bytes re-sent after one failure b → b/p; parts sent in parallel. S3 retransmits only a failed part, advises multipart for objects of 100 MB or more ✅[^s3-mpu], and allows up to 10,000 parts of 5 MiB to 5 GiB each, with no minimum for the last part ✅[^s3-mpu-limits]; a byte-range fetch transfers only the requested portion, and smaller ranges improve retry times ✅[^s3-perf]; range requests exist because transfers get interrupted, and `206` fulfils one ✅[^rfc9110] | Fault test: kill the connection at 90% and count bytes re-sent; transfer time with p parallel parts |
| `object-store-listing` | `ListObjectsV2` (or `list_blobs`, `readdir` on a mounted bucket) on each request to find a file, check existence or count items; listing a prefix to find "the latest" object; repeated `GetObject` of the same hot objects with no cache | Keep an index or manifest (a database row per object, or one manifest object); derive the key from data you have and `GET` or `HEAD` it; cache hot objects (CDN or in-memory cache) | Requests per lookup ⌈k/1000⌉ list pages → 1 keyed request, or 0 with the key in a database row. A list request returns at most 1,000 keys and continues with a token ✅[^s3-list]; S3 suggests a cache for a working set of repeated GETs, which also sends fewer direct requests ✅[^s3-patterns] | Store request metrics: list requests per user request; a test with k = 10 and k = 10,000 keys under the prefix shows flat request counts after the fix |

## Lookup notes

| Class | Not a problem when |
|---|---|
| `missing-cache-headers` | The response is per-user and changes on every request, or carries secrets (then `no-store` is right); a CDN in front sets the headers (check the edge, not the code); the URL is not fingerprinted, so a long `max-age` would serve stale assets after a deploy (use `no-cache` with validators instead) |
| `response-compression` | The body is already compressed (images, video, zip, woff2); bodies are tiny (nginx skips them below `gzip_min_length`, 20 bytes by default ✅[^nginx-gzip]); a proxy or CDN in front compresses; the body mixes secrets with attacker-controlled input over TLS (a security review decides, not this catalog) |
| `cors-preflight-repeat` | The call is same-origin; the request is simple; calls are rare per user (one preflight per session) |
| `small-socket-writes` | The server is a Node.js HTTP server: `http.createServer` sets `noDelay` to `true` by default since v18.0.0 ✅[^node-http]; the runtime already sets `TCP_NODELAY` (Bun did in a lab: [../../bun/http-and-networking/networking-apis-reference.md](../../bun/http-and-networking/networking-apis-reference.md)); the traffic is bulk streaming, where Nagle trades latency for fewer packets on purpose ✅[^node-net] |
| `http1-connection-fanout` | Bulk object-store transfers: S3 recommends many concurrent connections and sets no connection limit ✅[^s3-perf]; a lossy mobile network, where one HTTP/2 connection suffers TCP head-of-line blocking (see the [head-of-line blocking deep dive](../../web-apis/http2-http3-head-of-line-blocking-deep-dive.md)); the clients cannot speak HTTP/2 |
| `slow-hash-per-request` | The request is a login, a password change or a token exchange: there the slow hash is the point ✅[^owasp-pw]; the API key is short or user-chosen (then it is a password and needs a password hashing scheme ✅[^nist-63b]) |
| `app-proxied-transfer` | The app must transform, scan or authorise every byte (then stream, do not buffer); files are small and few; the store is not reachable from clients (private network), and an internal redirect is not available |
| `whole-object-transfer` | Objects are well under 100 MB (S3 calls multipart a best practice from 100 MB ✅[^s3-mpu]; that it is unnecessary below is this catalog's inference); the client cannot resume anyway |
| `object-store-listing` | A batch job lists once per run (inventory, cleanup); k is fixed and small (one page); the listing result is cached with an expiry that fits the use |

**Belongs to an existing class** (not added here):
- An HTTP or object-store client created per request, or a custom Agent without keep-alive → `connection-management`. Node.js `new http.Agent()` has `keepAlive` default `false` ✅[^node-http]; S3 says pooled, reused connections avoid TCP slow start and TLS handshakes per request ✅[^s3-patterns]. A TLS handshake per request is the same class.
- A synchronous `bcrypt.hashSync` or `crypto.pbkdf2Sync` on an event loop → `blocking-in-async`. This catalog's class is the slow hash itself, run per request, even when it is asynchronous.
- A JSON Web Key Set (JWKS) fetched, or a public key parsed, on every request → `caching-recomputation`. The jose library fetches the key set only when its cache is missing or stale, refetches for an unknown key only after a cooldown ✅[^jose-jwks], and keeps keys up to 10 minutes by default ✅[^jose-jwks-opts]. The page does not say to build the resolver once; that follows from the cache living in the resolver (inferred).
- One `GetObject` per small object in a loop → `io-batching-n-plus-one` (concurrent calls or a bundle of small objects).
- A whole file buffered in memory before upload or reply → `allocation-gc` ("whole inputs held in memory"); this catalog's `app-proxied-transfer` is about the bytes routed through the app.
- Small writes that each make a system call → `unbuffered-io`. `small-socket-writes` adds a signal that class does not have (write-write-read on a socket) and a fix it does not name (`TCP_NODELAY`, one write per message), because the cost is a wait for an acknowledgement, not a call count.
- Polling a URL and downloading it in full each time → `full-rescan-incremental` (conditional requests).
- Render-blocking scripts and late images → `page-load-delivery`; list endpoints with no page limit → `payload-overfetch`; upload size with no maximum → `unbounded-input`.
- Hot S3 key prefixes and `503 Slow Down` → partition skew in the datastores catalog; S3 says to add request-distribution strategies when a workload consistently exceeds 3,500 PUT/COPY/POST/DELETE or 11,000 GET/HEAD requests per second per partitioned prefix ✅[^s3-patterns].

**Corrections found while checking the sources (2026-11-26):**
- nginx `gzip on;` alone compresses only `text/html`: JSON, CSS and JavaScript need `gzip_types` ✅[^nginx-gzip]. Behind a proxy that adds `Via`, the default `gzip_proxied off` compresses nothing ✅[^nginx-gzip].
- Node.js HTTP servers already disable Nagle (since v18.0.0) ✅[^node-http], while a plain `net.Socket` starts with it on ✅[^node-net]. The class matters for custom TCP protocols, not for ordinary Node HTTP handlers.
- The often-quoted S3 read rate of 5,500 GET/HEAD per second per prefix is not what the current design-patterns page says: it gives 11,000 GET/HEAD per second per partitioned prefix as the level above which to distribute requests ✅[^s3-patterns].
- OWASP says nothing about fast hashes for high-entropy API tokens; it only rules them out for passwords ✅[^owasp-pw]. The rule for random secrets comes from NIST's look-up secrets ✅[^nist-63b]; applying it to API tokens is this catalog's inference, since the page does not name API tokens.

**What the sources do not say:**
- No page read gives the Linux delayed-ACK timer value; RFC 1122 gives only the 0.5 second ceiling ✅[^rfc1122].
- RFC 9112 sets no maximum number of HTTP/1.1 connections per server, so a per-host number such as "6" is not from the spec ✅[^rfc9112].
- The MDN compression page gives no CPU cost of compression and no advice on precompressing; the precompression advice here rests on nginx `gzip_static` ✅[^nginx-gzip-static].

**Calibration state (2026-11-26).** Each class of this catalog has one known-bad sample in round 3 of the review-agent calibration, and some of its "Not a problem when" rows have a trap sample. In that round (one run per arm) the agent with the skill filed all 96 planted problems of the thirteen domain catalogs under the right class id, and without the skill 86 of them. Results per catalog, and the limits of the round: [perf-reviewer-calibration.md](perf-reviewer-calibration.md) §6.5.

## Takeaways
- For every cacheable GET, ask which `Cache-Control` it sends: fingerprinted assets `immutable` with a year's `max-age`, everything else `no-cache` with a validator. [rule-candidate]
- Run a password hashing scheme only where a human password is checked; a random API token needs a fast hash and an index lookup (an inference from NIST's look-up secret rule, not stated for API tokens by any page read). [rule-candidate]
- Large files go client ↔ store directly (presigned URL) and in parts (multipart, ranges); the app signs, it does not carry the bytes. [rule-candidate]
- State network costs as counts: requests per view, round trips per call, bytes per response, bytes re-sent per failure.

## Verification status
- Verified: 57 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-26

## References
- [RFC 9111: HTTP Caching](https://www.rfc-editor.org/rfc/rfc9111.html) — IETF, 2022. Rank 1. Backs: Catalog, missing-cache-headers. [^rfc9111]
- [RFC 9110: HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110.html) — IETF, 2022. Rank 1. Backs: Catalog, missing-cache-headers and whole-object-transfer. [^rfc9110]
- [RFC 8246: HTTP Immutable Responses](https://www.rfc-editor.org/rfc/rfc8246.html) — IETF, 2017. Rank 1. Backs: Catalog, missing-cache-headers. [^rfc8246]
- [RFC 896: Congestion Control in IP/TCP Internetworks](https://www.rfc-editor.org/rfc/rfc896.html) — J. Nagle, IETF, 1984. Rank 1. Backs: Catalog, small-socket-writes. [^rfc896]
- [RFC 1122: Requirements for Internet Hosts](https://www.rfc-editor.org/rfc/rfc1122.html) — IETF, 1989. Rank 1. Backs: Catalog, small-socket-writes; Lookup notes. [^rfc1122]
- [RFC 9113: HTTP/2](https://www.rfc-editor.org/rfc/rfc9113.html) — IETF, 2022. Rank 1. Backs: Catalog, http1-connection-fanout. [^rfc9113]
- [RFC 9112: HTTP/1.1](https://www.rfc-editor.org/rfc/rfc9112.html) — IETF, 2022. Rank 1. Backs: Catalog, http1-connection-fanout; Lookup notes. [^rfc9112]
- [tcp(7)](https://man7.org/linux/man-pages/man7/tcp.7.html) — Linux man-pages project, 6.19. Rank 1. Backs: Catalog, small-socket-writes. [^tcp7]
- [Module ngx_http_gzip_module](https://nginx.org/en/docs/http/ngx_http_gzip_module.html) — nginx, living. Rank 1. Backs: Catalog, response-compression; Lookup notes. [^nginx-gzip]
- [Module ngx_http_gzip_static_module](https://nginx.org/en/docs/http/ngx_http_gzip_static_module.html) — nginx, living. Rank 1. Backs: Catalog, response-compression; Lookup notes. [^nginx-gzip-static]
- [Module ngx_http_v2_module](https://nginx.org/en/docs/http/ngx_http_v2_module.html) — nginx, living. Rank 1. Backs: Catalog, http1-connection-fanout. [^nginx-http2]
- [Module ngx_http_core_module, internal](https://nginx.org/en/docs/http/ngx_http_core_module.html#internal) — nginx, living. Rank 1. Backs: Catalog, app-proxied-transfer. [^nginx-core]
- [Net](https://nodejs.org/api/net.html) — Node.js project, v26.13.1. Rank 1. Backs: Catalog, small-socket-writes; Lookup notes. [^node-net]
- [HTTP](https://nodejs.org/api/http.html) — Node.js project, v26.13.1. Rank 1. Backs: Lookup notes, small-socket-writes and connection-management. [^node-http]
- [Stream, writable.cork()](https://nodejs.org/api/stream.html#writablecork) — Node.js project, v26.13.1. Rank 1. Backs: Catalog, small-socket-writes. [^node-stream]
- [File system, fs.readFile](https://nodejs.org/api/fs.html#fsreadfilepath-options-callback) — Node.js project, v26.13.1. Rank 1. Backs: Catalog, app-proxied-transfer. [^node-fs]
- [NIST SP 800-63B-4: Authenticators](https://pages.nist.gov/800-63-4/sp800-63b/authenticators/) — NIST, SP 800-63-4 web edition. Rank 1. Backs: Catalog, slow-hash-per-request; Lookup notes. [^nist-63b]
- [jose: createRemoteJWKSet](https://raw.githubusercontent.com/panva/jose/main/docs/jwks/remote/functions/createRemoteJWKSet.md) — panva/jose project, main branch. Rank 1. Backs: Lookup notes. [^jose-jwks]
- [jose: RemoteJWKSetOptions](https://raw.githubusercontent.com/panva/jose/main/docs/jwks/remote/interfaces/RemoteJWKSetOptions.md) — panva/jose project, main branch. Rank 1. Backs: Lookup notes. [^jose-jwks-opts]
- [Download and upload objects with presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html) — Amazon Web Services, living. Rank 1. Backs: Catalog, app-proxied-transfer. [^s3-presign]
- [Uploading and copying objects using multipart upload](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html) — Amazon Web Services, living. Rank 1. Backs: Catalog, whole-object-transfer; Lookup notes. [^s3-mpu]
- [Amazon S3 multipart upload limits](https://docs.aws.amazon.com/AmazonS3/latest/userguide/qfacts.html) — Amazon Web Services, living. Rank 1. Backs: Catalog, whole-object-transfer. [^s3-mpu-limits]
- [Performance guidelines for Amazon S3](https://docs.aws.amazon.com/AmazonS3/latest/userguide/optimizing-performance-guidelines.html) — Amazon Web Services, living. Rank 1. Backs: Catalog, whole-object-transfer; Lookup notes. [^s3-perf]
- [Performance design patterns for Amazon S3](https://docs.aws.amazon.com/AmazonS3/latest/userguide/optimizing-performance-design-patterns.html) — Amazon Web Services, living. Rank 1. Backs: Catalog, object-store-listing; Lookup notes. [^s3-patterns]
- [ListObjectsV2](https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectsV2.html) — Amazon Web Services, API version 2006-03-01. Rank 1. Backs: Catalog, object-store-listing. [^s3-list]
- [HTTP caching](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching) — MDN Web Docs, living. Rank 3. Backs: Catalog, missing-cache-headers. [^mdn-caching]
- [Compression in HTTP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Compression) — MDN Web Docs, living. Rank 3. Backs: Catalog, response-compression. [^mdn-compression]
- [Cross-Origin Resource Sharing (CORS)](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS) — MDN Web Docs, living. Rank 3. Backs: Catalog, cors-preflight-repeat. [^mdn-cors]
- [Access-Control-Max-Age](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Access-Control-Max-Age) — MDN Web Docs, living. Rank 3. Backs: Catalog, cors-preflight-repeat. [^mdn-acma]
- [Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) — OWASP Cheat Sheet Series, living. Rank 3. Backs: Catalog, slow-hash-per-request; Lookup notes. [^owasp-pw]

## Related
- [problem-classes.md](problem-classes.md) — the first catalog of 39 classes, including `connection-management`, `page-load-delivery` and `caching-recomputation`.
- [perf-reviewer-calibration.md](perf-reviewer-calibration.md) — the review agent built on these catalogs, and how it scored.
- [../../web-apis/http2-http3-head-of-line-blocking-deep-dive.md](../../web-apis/http2-http3-head-of-line-blocking-deep-dive.md) — why one connection is not free on a lossy network.
- [../../security/jwt-storage-and-revocation-deep-dive.md](../../security/jwt-storage-and-revocation-deep-dive.md) — token storage, verification and revocation.
- [../../bun/http-and-networking/networking-apis-reference.md](../../bun/http-and-networking/networking-apis-reference.md) — `setNoDelay` and `TCP_NODELAY` measured in Bun.
- [../../javascript/browser/network-requests-in-depth.md](../../javascript/browser/network-requests-in-depth.md) — `fetch` cache modes and resumable uploads in the browser.
