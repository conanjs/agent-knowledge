---
schema: knowledge-doc/v1
type: concept
topic: bun/http-and-networking
status: verified
applies-to: ["Bun 1.4.5"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [bun, http, bun-serve, routes, fetch-handler, error-handler, development-mode, idle-timeout, reuse-port, unix-socket, streaming, sendfile, http2, http3, alt-svc]
---

# Bun.serve: routes, the fetch handler and the server lifecycle

## Summary
**TL;DR:** `Bun.serve(options)` starts an HTTP (Hypertext Transfer Protocol) server whose handlers take a web-standard `Request` and return a `Response` or a promise of one. The `routes` object is matched by specificity, not by key order: exact path, then `:param`, then `/prefix/*`, then `/*`; only when nothing matches does `fetch(req, server)` run, and with no `fetch` the client gets an empty `404`. Errors go to `error(err)`; without it, a server in development mode (the default unless `NODE_ENV=production`) answers with an HTML (HyperText Markup Language) page that shows your stack trace and source. Idle connections close after `idleTimeout` (10 s by default), which in the lab fired in 4-second steps (12 s for the default), and `stop()` waits for in-flight requests while `stop(true)` cuts them. With `tls`, the experimental `http2: true` serves HTTP/2 to clients that ask for it on the same port, and `http3: true` adds HTTP/3 over UDP on the same port number, advertised in an `Alt-Svc` header.
**Use this when:** writing or reviewing a Bun HTTP server, debugging a route that matches the wrong handler, a request cut at about 12 s, an error page that leaks source code, or a missing file that answers 500 or reaches the catch-all instead of 404; turning on HTTP/2 or HTTP/3.
**Not this doc:** WebSocket upgrades and pub/sub → [websockets-and-pubsub.md](websockets-and-pubsub.md); the `fetch` client (including its `protocol` option for HTTP/2 and HTTP/3), TCP (Transmission Control Protocol), UDP (User Datagram Protocol), DNS (Domain Name System), cookies and the TLS (Transport Layer Security) options catalog → [networking-apis-reference.md](networking-apis-reference.md); HTML imports in `routes` → `bun/bundler/fullstack-dev-server-and-html.md`; `--hot` and when `server.reload` runs → `bun/fundamentals/watch-hot-and-debugging.md`; requests per second against Node.js → `bun/internals/performance-measured.md`.

## Problem
Developers coming from Express or `node:http` expect routes to run in the order they are written, so they put a catch-all first and are surprised when it never wins, or they rely on order to shadow a parameter route. A `{ GET, POST }` route answers a `PUT` with whatever catch-all exists, not with `405`. A slow report endpoint dies with `ECONNRESET` after about 12 seconds although nobody set a timeout. A server deployed without `NODE_ENV=production` sends its stack trace, source lines and file paths to any client that triggers an exception. A handler that returns `new Response(Bun.file(path))` for a missing file answers `500`, while the same file as a route value silently hands the request to the catch-all or `fetch`.

## Mental model
**Analogy:** a post-office sorting wall. Each pigeonhole has a label: an exact address (`/api/users/me`), a street with any house number (`/api/users/:id`), a whole district (`/api/*`), or "everything else" (`/*`). A letter goes to the most specific label that fits, wherever that hole sits on the wall. Letters no hole accepts go to the clerk at the counter (`fetch`); with no clerk, they are returned unopened (`404`).

**Artifact** (routes declared least specific first, on purpose) ✅[^lab]:
```ts
const server = Bun.serve({
  port: 0,
  routes: {
    "/*": () => new Response("global catch-all"),
    "/api/*": () => new Response("api wildcard"),
    "/api/users/:id": req => new Response(`param id=${req.params.id}`),
    "/api/users/me": () => new Response("exact me"),
  },
});
// GET /api/users/me  -> 200 "exact me"
// GET /api/users/42  -> 200 "param id=42"
// GET /api/users     -> 200 "api wildcard"     (a :param needs a non-empty segment)
// GET /elsewhere     -> 200 "global catch-all"
```

## How it works
Three actors take part in every request:
- **The client** — its job: open a connection and send the request, via `fetch()`, a browser or any HTTP tool.
- **Bun's HTTP layer** — its job: accept connections, parse requests, pick a route and enforce limits, via native code built on a fork of uWebSockets ✅[^4].
- **Your handlers** — their job: turn a request into a `Response`, via the `routes` values, `fetch(req, server)` and `error(err)`.

```
client                          Bun HTTP layer (native)                        your code
fetch(url) ══ network ══▶  accept (port, or unix socket path)
                           parse request line + headers
                           match routes: exact > :param > /prefix/* > /*
                             ├─ static Response / BunFile value ───────▶ (no JavaScript runs)
                             ├─ handler, or {GET, POST, ...} object ───▶ handler(req, server)
                             └─ nothing matched ───────────────────────▶ fetch(req, server), or empty 404
                                                     ◀── Response | Promise<Response> ──────┘
                           throw / reject / invalid Response ──────────▶ error(err) → dev page → 500
                           write status, headers, body (chunks, sendfile)
◀══ network ══ response    idle timer: close the socket after idleTimeout of silence
```

1. **Bun listens (local, before any request).**
   - With no `port`, Bun uses `--port`, then `BUN_PORT`, `PORT`, `NODE_PORT`, else `3000` ✅[^1]. Observed: no option → `3000`; `PORT=4002` → `4002`; `NODE_PORT=4005` → `4005`; `BUN_PORT=4003 PORT=4002` → `4003`; `bun --port=4004` → `4004` ✅[^lab].
   - `port: 0` lets the operating system pick a free port; read it from `server.port` or `server.url` (`http://localhost:40473/`) ✅[^lab] ✅[^1]. A port of `-1`, `70000` or `1.5` throws `RangeError: The value of "options.port" is out of range` ✅[^lab] ✅[^5].
   - With no `hostname`, `server.hostname` reads `localhost` ✅[^lab]; the types give the bind default as `"0.0.0.0"`, all interfaces ✅[^4], and a client in a second container reached such a server at its container IP address (`http://192.168.147.4:7400/static` → `OK`) ✅[^lab].
   - `unix: "/tmp/app.sock"` listens on a Unix domain socket instead: a socket addressed by a file path on the same machine, like an internal phone extension instead of a street address. `server.port` and `server.hostname` are then `undefined` and `server.url` is `unix:///tmp/app.sock` ✅[^lab] ✅[^1].
   - `reusePort: true` sets `SO_REUSEPORT`, a socket option that on Linux lets several sockets bind one port while the kernel spreads incoming connections among them ✅[^4] ✅[^7]. Two processes on port 3000 shared 200 non-keep-alive requests 103/97; without the flag the second process failed with `EADDRINUSE: Failed to start server. Is port 3000 in use?` ✅[^lab]. On macOS 26.1 the flag let a second process bind the port too, but nothing was spread: all 200 requests went to the process that bound last, and the first one answered only after the last was killed (2 runs; the same script split 107/93 on Linux) ✅[^lab].
2. **Bun matches the path (local).**
   - Precedence is exact, then parameter, then wildcard, then the global catch-all ✅[^2]; the order of keys in `routes` does not change it ✅[^lab].
   - `:name` segments land in `req.params`, percent-decoded: `/api/users/caf%C3%A9` gave `id=café`, and `/api/users/7/posts/9` gave `{"id":"7","postId":"9"}` ✅[^lab] ✅[^2]. Matching is case-sensitive: `/STATIC` missed `/static` ✅[^lab] ✅[^2].
   - A per-method object (`{ GET, POST }`) that lacks the request's method counts as no match: a `PUT` fell to `/*` when it existed and to `fetch` when it did not ✅[^lab]. A `HEAD` is answered by the `GET` handler (`content-length: 9` for `"GET items"`), new in 1.4 ✅[^lab] ✅[^5].
3. **Your handler runs (local, JavaScript).**
   - A route value can be a `Response` (static: built once and cached for the server's lifetime, changed only by `server.reload`), a `BunFile`, a handler function, a per-method object, or `{ dir: "./public" }` for a folder (from 1.4; a file under it came back `200` with a weak ETag `W/"45f-6b054dd9"`) ✅[^lab] ✅[^2] ✅[^4] ✅[^5]. A static route kept answering `static v1` until `server.reload` gave it a new `Response`, while a `BunFile` route served a rewritten file on the next request ✅[^lab].
   - `fetch(req, server)` runs only for unmatched requests ✅[^2] and receives the server as its second argument ✅[^lab].
   - A handler returns a `Response` or a promise of one ✅[^2]. Returning `undefined` or a string (no `websocket` configured) produced an empty `204` and the log line `error: Expected a Response object, but received 'undefined'` ✅[^lab].
4. **Bun writes the response (local, then the network).**
   - A `ReadableStream` or an async generator function as the body is sent with `Transfer-Encoding: chunked`; three `enqueue` calls 20 ms apart arrived as three chunks ✅[^lab] ✅[^1].
   - `new Response(Bun.file(p))` gets `Content-Type` from the extension (`text/plain;charset=utf-8`) and a `Content-Length` ✅[^lab]. Bun uses the `sendfile(2)` system call when it can ✅[^2], which copies file bytes to the socket inside the kernel without passing them through the program, like a forklift moving a pallet from shelf to truck without unpacking it ✅[^6]. Traced with `strace` in `bunlab:2`: one `sendfile` of 1,048,576 bytes for a 1 MiB file as a route value and the same from a handler, none for a 9-byte file or for the same file over TLS ✅[^lab].
   - A `BunFile` given directly as a route value also sends `Last-Modified`, answers `Range: bytes=0-4` with `206` and `Content-Range: bytes 0-4/64`, and `If-Modified-Since` with `304` ✅[^lab] ✅[^2]. `file.slice(0, 5)` from a handler answered `206` with `Content-Range: bytes 0-4/*` ✅[^lab] ✅[^2].
   - A static route holding buffered bytes (`new Response(await file.bytes())`) gets an ETag (entity tag, a fingerprint of the content) such as `"5d0d62f2f7952746"`, and `If-None-Match` with that value gets `304` ✅[^lab] ✅[^2].
5. **Errors reach `error`, the dev page or a plain 500.**
   - Development mode defaults to `NODE_ENV !== "production"` ✅[^4] ✅[^3]; with `NODE_ENV` unset, `server.development` was `true` ✅[^lab].
   - A throw (or an async rejection) with no `error` handler gave, in development, `500 text/html` of about 50 KB with the stack and the source file path; with `development: false` or `NODE_ENV=production`, `500 text/plain` `Something went wrong!` ✅[^lab] ✅[^3]. Both printed the error with a code frame to stderr ✅[^lab].
   - An `error(err)` that returns a `Response` replaces both (`503 handled: woops!`) ✅[^lab] ✅[^3]; one that returns `undefined` falls back to them ✅[^lab].
   - Returning `Response.error()` (status 0) also goes to `error()`, with the message `Cannot send a Response with status 0. HTTP sta…` ✅[^lab] ✅[^5].
6. **Bun enforces timeouts and limits.**
   - `idleTimeout` (seconds, default 10, maximum 255, `0` disables) closes a connection that sends and receives nothing, including one whose handler is still running ✅[^1]. `idleTimeout: 256` throws `TypeError: Bun.serve expects idleTimeout to be 255 or less` ✅[^lab], and with `idleTimeout: 0` a handler that stayed silent for 14 s still answered `200` ✅[^lab].
   - Measured with a raw TCP client and a silent handler, the socket closed in 4-second steps: `idleTimeout` 1 or 2 → 4.0 s, 5 → 8.0 s, 9, 10 (default) or 12 → 12.0 s, the same in two runs ✅[^lab]. The default case also logged ``warn: Bun.serve() timed out a request after 10 seconds. Pass `idleTimeout` to configure.``, and a `fetch` client saw `ECONNRESET` ✅[^lab].
   - `server.timeout(req, 0)` turns the timer off for one request and `server.timeout(req, 6)` lengthens it: both let a 4 s silent handler finish under `idleTimeout: 2` ✅[^lab] ✅[^1]. The docs recommend it for SSE (Server-Sent Events, a response that stays open and pushes events) ✅[^1].
   - `maxRequestBodySize` defaults to 128 MB ✅[^4]: a body of 134,217,728 bytes (128 MiB) got `200` and one byte more `413` ✅[^lab]; with `1024`, a 4096-byte body got `413` ✅[^lab].
7. **The lifecycle methods change a running server.**
   - `await server.stop()` stops accepting, lets in-flight requests finish, and resolves when every connection has closed ✅[^1]: a 300 ms request started 50 ms earlier completed with `200`, the promise resolved after 258 ms, and the next request got `ECONNREFUSED` ✅[^lab].
   - `await server.stop(true)` cuts them: the in-flight client got `ECONNRESET` and the promise resolved in 3 ms ✅[^lab] ✅[^1].
   - `server.reload({ routes, fetch })` swapped both on the same port (`{"v":1}` → `{"v":2}`); a `port` passed to it was ignored ✅[^lab] ✅[^4]. Only `fetch`, `error`, `routes` and `websocket` can change ✅[^1]: `idleTimeout: 30` and `development: false` passed to `reload` were ignored, so a 5 s handler still died at 4.0 s under the original `idleTimeout: 2` and `server.development` stayed `true` ✅[^lab].
   - `server.closeIdleConnections()` closed the one idle keep-alive connection and returned `1` ✅[^lab] ✅[^1]; `unref()` lets the process exit while the server still listens ✅[^1]: with it a script exited with code 0, without it the process kept running until killed ✅[^lab].
8. **Introspection.** `server.requestIP(req)` returned `{"address":"::1","family":"IPv6","port":53348}` (the client resolved `localhost` to IPv6, Internet Protocol version 6) and `null` over a Unix socket ✅[^lab] ✅[^1]. `server.pendingRequests` was `1` during a request ✅[^lab]. A second `fetch` reused the client port (keep-alive: one TCP connection carries many requests, like keeping a phone line open between calls), and `keepalive: false` opened a new one ✅[^lab].
9. **HTTP/2 and HTTP/3 (experimental; same routes and `fetch`).** HTTP/2 carries many requests as interleaved streams over one TCP connection; HTTP/3 does the same over QUIC, a transport that runs on UDP and builds its own reliable, encrypted streams, like a courier who sends postcards but numbers them and re-sends lost ones. Over TLS, Bun picks HTTP/2 per connection with ALPN (Application-Layer Protocol Negotiation), the protocol name a client offers during the TLS handshake ✅[^1] ✅[^4]. The lab ran `Bun.serve({ tls, http2: true, http3: true })` in `bunlab:1` on a Docker network and checked each request from outside ✅[^lab]:
   - Options: `http2` (default `false`), `http3` (default `false`, needs `tls`) and `http1` (default `true`) ✅[^4]. `http1: false` alone threw `Cannot disable http1 without enabling http2 or http3`, and `http3` without `tls` threw `HTTP/3 requires 'tls' to be set` ✅[^lab] ✅[^1].
   - ALPN, from `openssl s_client`: offering `h2,http/1.1` got `ALPN protocol: h2`, offering `http/1.1` got `http/1.1`, and offering nothing got HTTP/1.1 `200 OK`. Node.js 24 (`node:24.22.1-alpine`) `http2.connect` got `alpnProtocol` `h2` and `:status` `200`; Chromium 156 (`bunlab:2`) reported `nextHopProtocol` `h2` ✅[^lab] ✅[^1].
   - `http3: true` opened a UDP socket on the same port number next to the TCP listener (both visible in `/proc/net`). HTTP/1.1 and HTTP/2 responses carried `alt-svc: h3=":8443"; ma=86400`, an Alt-Svc (alternative service) header that tells clients the same site answers over HTTP/3 on that port for the next 86,400 s; HTTP/3 responses did not ✅[^lab] ✅[^1] ✅[^9]. Chromium forced onto QUIC (`--origin-to-force-quic-on`) reported `nextHopProtocol` `h3` ✅[^lab].
   - On the server side, HTTP/1.1 requests carried `connection: keep-alive` and HTTP/2 and HTTP/3 requests had no `connection` header, which HTTP/2 forbids ✅[^lab] ✅[^8]. The `fetch` client's view, including `protocol: "http2"`/`"http3"`, is in [networking-apis-reference.md](networking-apis-reference.md).
   - `http1: false` with `http2: true` over TLS: a client offering only `http/1.1` got the alert `no application protocol`, and a client with no ALPN got `505 HTTP Version Not Supported`. `http1: false` with only `http3: true` left no TCP listener at all: plain `fetch` got `ECONNREFUSED`, and only HTTP/3 clients (Bun with `protocol: "http3"`, Chromium over QUIC) were answered ✅[^lab] ✅[^1].
   - Without `tls`, `http2: true` served HTTP/2 to a client that opens with the HTTP/2 preface, a fixed opening line that announces HTTP/2 without any negotiation ("prior knowledge"): Node.js `http2.connect("http://...")` got `alpnProtocol` `h2c` and `200`, while Bun's `fetch` still got HTTP/1.1; adding `http1: false` gave Bun's `fetch` and a raw HTTP/1.1 request `505` ✅[^lab] ✅[^1].

## Worked example
A notes API (application programming interface) run once in the lab with `port: 0` and `development: false`: a static health route, a `{ GET, POST }` collection, a parameter route that can throw or stall, a `fetch` fallback and an `error` handler that returns JSON (JavaScript Object Notation) ✅[^lab]:

| # | Action | Observed |
|---|---|---|
| 1 | `Bun.serve({ port: 0, ... })` | `server.url` is `http://localhost:44339/` |
| 2 | `GET /health` (static `new Response("OK")`) | `200 OK` |
| 3 | `POST /api/notes` with `{"text":"call mum"}` | `201 {"id":"2"}` |
| 4 | `GET /api/notes` | `200 ["1","2"]` |
| 5 | `GET /api/notes/2` (`:id` route) | `200 {"id":"2","text":"call mum"}` |
| 6 | `PUT /api/notes` (object has no `PUT`) | `404 no route for PUT /api/notes`, from `fetch` |
| 7 | `GET /api/notes/boom` (handler throws `db down`) | `500 {"error":"db down"}`, from `error` |
| 8 | `GET /api/notes/slow` (300 ms), read `server.pendingRequests` at 50 ms | `1` |
| 9 | `await server.stop()` while step 8 runs | resolves after the slow request finished with `200` |
| 10 | `GET /health` after stop | `ECONNREFUSED` |

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `${server.url}/users` | `http://localhost:3000//users`, two slashes | `server.url.href` (the URL, Uniform Resource Locator, as text) ends with `/`; use `new URL("/users", server.url)` ✅[^lab] ✅[^1] |
| Routes only, no `fetch`, unmatched path | `404`, empty body, no `Content-Type` | Bun's built-in fallback ✅[^lab] |
| `/api/users` or `/api/users/` with routes `/api/users/:id` and `/api/*` | `api wildcard` | A parameter needs a non-empty segment ✅[^lab] |
| Missing file as a route value (`Bun.file(p)` or `new Response(Bun.file(p))`) | Counts as no match: the request went to a `/*` route or to `fetch` when one existed (`200 catch-all`, `200 from fetch`), and got the built-in empty `404` only when neither did ✅[^lab] | The docs promise a `404` from file routes ✅[^2]; a `{ dir }` route did answer an empty `404` for a missing file even with `fetch` set ✅[^lab] |
| Missing file returned from a handler | `500` (`ENOENT` goes to `error` or the dev page) | The read fails after the handler returned ✅[^lab] |
| A streaming response that goes quiet longer than `idleTimeout` | Client got `first\n`, then `ECONNRESET` after 4.1 s (`idleTimeout: 2`) | The idle timer also runs while a response streams ✅[^lab] ✅[^1] |
| `server.fetch(request)` to call the handler without a socket | Works, but the handler's second argument was `undefined` | The types call this mock "not fully implemented" ✅[^lab] ✅[^4] |
| Unix-socket server's `server.protocol` | `"http"` | The types say `null` for Unix sockets; the lab disagrees ✅[^lab] ✅[^4] |
| `bun --production server.ts` | Does not turn off the error page | Only `NODE_ENV=production` or `development: false` do; `bun --production -e ...` still had `server.development` `true` ✅[^lab] ✅[^3] |
| Duplicate request headers | Joined with `, ` (from 1.4) | Fetch-spec behaviour (two `X-Dup` headers arrived as `a, b`); before, the last value won ✅[^lab] ✅[^5] |
| `http3: true` with `unix` | Printed `warn: http3: true with a unix socket — HTTP/3 listener skipped` and served HTTP/1.1 over the socket | QUIC needs a UDP port; the docs say `http3` is not supported with Unix sockets ✅[^lab] ✅[^1] |
| A client offers `h2` to a TLS server without `http2` | No ALPN negotiated; HTTP/1.1 `200 OK`; Node.js `http2.connect` failed with `ERR_HTTP2_ERROR` | HTTP/2 is off by default ✅[^lab] ✅[^4] |
| WebSocket client against `http1: false` | TLS handshake failed: `TLSV1_ALERT_NO_APPLICATION_PROTOCOL` | `server.upgrade()` works only on HTTP/1.1 ✅[^lab] ✅[^1] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Static `Response` route | No JavaScript per request; buffered bytes get ETag and `304`; the docs claim at least 15% over a handler ✅[^2] | Cached until `server.reload`; whole body held in memory ✅[^2] |
| `BunFile` as a route value | `Last-Modified`, `Range`, `sendfile` for free ✅[^lab] ✅[^2] | Reads the file system on every request ✅[^2] (a rewritten file was served at once ✅[^lab]); a missing file falls through to the next route instead of answering `404` ✅[^lab] |
| Handler returning `Bun.file` | Picks the file at request time | Missing file → `500` unless you check `await file.exists()` first ✅[^lab] |
| `reusePort` with N processes | Uses N cores, kernel balances ✅[^lab] ✅[^7] | No shared memory between processes; each holds its own state; Linux only: on macOS the last process to bind took every connection ✅[^lab] |
| `stop()` vs `stop(true)` | Clean drain vs immediate exit ✅[^lab] | One slow client delays shutdown vs cut requests |
| `http2: true` (with `tls`) | HTTP/2 for browsers and HTTP/2 clients on the same port, routes and `fetch` ✅[^lab] ✅[^1] | Experimental; WebSockets over HTTP/2, server push and response trailers are not supported ✅[^1] |
| `http3: true` | HTTP/3 on the same port number, advertised by `Alt-Svc` ✅[^lab] | Experimental, needs `tls` ✅[^lab] ✅[^1]; the `fetch` client rejects `tls.ca` with it (networking reference) ✅[^lab] |
| `http1: false` | Refuses HTTP/1.x clients ✅[^lab] ✅[^1] | No WebSocket upgrades; plain `fetch` fails unless forced to HTTP/2 or HTTP/3 ✅[^lab] |

No throughput numbers here: a `fetch`-loop client in the same container varied more than eightfold for one static route across five runs ✅[^lab], so it measured the client, not `Bun.serve`. A second try with the client in its own container (64 concurrent `fetch` loops, 5 alternating 3-second runs per route, two sessions) gave static/handler median ratios of 1.06 and 0.89 at about 200,000 requests per second, so it neither confirmed nor refuted the docs' 15% claim: the client was still the limit ✅[^lab]. Throughput against Node.js, with a separate load client and its method, is in `bun/internals/performance-measured.md`.

## Takeaways
- Deploy with `NODE_ENV=production` or `development: false`; the default error page sends source code and file paths to the client. [rule-candidate]
- Always pass an `error` handler that logs and returns a fixed `500` body, so thrown and rejected handlers answer the same way in every environment. [rule-candidate]
- Do not rely on key order in `routes`; make the more specific path more specific (exact or `:param`), and answer `405` yourself in a catch-all, because a per-method object falls through. [rule-candidate]
- Give long or streaming handlers `server.timeout(req, 0)` or a larger `idleTimeout`, and expect the cut up to 4 s after the configured value. [rule-candidate]
- Serve files as route values to get ranges and `304`, and use `{ dir }` routes when a missing file must answer `404` (a missing `BunFile` value falls through to your catch-all or `fetch`); in a handler, check `await file.exists()` before returning it. [rule-candidate]
- Build URLs with `new URL(path, server.url)`, never by string concatenation. [rule-candidate]
- Count on `reusePort` to spread connections across processes only on Linux; on macOS put a load balancer in front instead. [rule-candidate]
- Turn on `http2` (and `http3`) with `tls` when clients benefit, but keep `http1` on while you serve WebSockets or HTTP/1.1-only clients. [rule-candidate]

## Verification status
- Verified: 152 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- `linux/lab-setup.md` — the Bun 1.4.5 lab where every ✅[^lab] behaviour ran on 2026-11-24: the `oven/bun:1.4.5` image (arm64); `bunlab:1` (the same Bun plus OpenSSL 3.5.7, for the test certificates and `openssl s_client`); `bunlab:2` (plus `strace` 6.13 and Chromium 156); `node:24.22.1-alpine` for the `node:http2` client; and a Docker bridge network between containers for the HTTP/2, HTTP/3, all-interfaces and throughput runs. The macOS `reusePort` runs (just after midnight, on 2026-11-25) used a Bun 1.4.5 binary cross-compiled with `bun build --compile --target=bun-darwin-arm64` and run as the full CLI (`BUN_BE_BUN=1`) with an isolated environment on macOS 26.1 (Apple M2); the binary was deleted afterwards. [^lab]
- [Server: docs/runtime/http/server.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/http/server.mdx) — Bun documentation source (Oven), 2026. Backs: default port order, `port: 0`, `server.url`, Unix sockets, `idleTimeout`, `server.timeout`, `stop`, `closeIdleConnections`, `ref`/`unref`, `reload`, `requestIP`, streaming bodies. [^1]
- [Routing: docs/runtime/http/routing.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/http/routing.mdx) — Bun documentation source (Oven), 2026. Backs: route precedence, params decoding, static responses and their cache, file routes vs static routes, `sendfile`, `slice`, the `fetch` fallback. [^2]
- [Error Handling: docs/runtime/http/error-handling.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/http/error-handling.mdx) — Bun documentation source (Oven), 2026. Backs: development default, the error page, the `error` callback, `--production` not turning it off. [^3]
- [packages/bun-types/serve.d.ts at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/packages/bun-types/serve.d.ts) — Bun source (Oven), 2026. Backs: route value kinds, `development` and `maxRequestBodySize` defaults, `hostname` default, `reusePort`, `reload` ignoring other options, `server.fetch` limits, `protocol` for Unix sockets, uWebSockets fork. [^4]
- [Bun 1.4](https://bun.com/blog/bun-v1.4) — Bun blog (Oven), 2026. Backs: `HEAD` answered by `GET` handlers, port validation, out-of-range statuses going to `error()`, directory routes, joined duplicate headers. [^5]
- [sendfile(2)](https://man7.org/linux/man-pages/man2/sendfile.2.html) — Linux man-pages project, living. Backs: in-kernel copy without user-space buffers. [^6]
- [socket(7): SO_REUSEPORT](https://man7.org/linux/man-pages/man7/socket.7.html) — Linux man-pages project, living. Backs: several sockets on one address, accept load distribution. [^7]
- [RFC 9113: HTTP/2](https://www.rfc-editor.org/rfc/rfc9113) — IETF, 2022. Backs: HTTP/2 messages must not carry the `Connection` header (§8.2.2). [^8]
- [RFC 7838: HTTP Alternative Services](https://www.rfc-editor.org/rfc/rfc7838) — IETF, 2016. Backs: the `Alt-Svc` header and its `ma` (max-age, seconds) parameter. [^9]

## Related
- `bun/http-and-networking/websockets-and-pubsub.md` — the `websocket` option and `server.upgrade`.
- `bun/http-and-networking/networking-apis-reference.md` — `fetch` options, cookies, TLS options for `Bun.serve`.
- `bun/bundler/fullstack-dev-server-and-html.md` — HTML imports as route values.
- `bun/fundamentals/watch-hot-and-debugging.md` — `--hot` and server reloads.
- `bun/internals/performance-measured.md` — HTTP throughput against Node.js 24.
- `bun/system-apis/file-io.md` — `BunFile`, the value file routes serve.
- `js-runtime/abort-signal.md` — cancelling requests with `AbortSignal`.
- `linux/lab-setup.md` — the lab.
