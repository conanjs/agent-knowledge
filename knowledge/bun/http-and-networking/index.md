---
schema: topic-index/v1
kind: subtopic
topic: bun/http-and-networking
last-updated: 2026-11-25
---

# Bun HTTP and networking

How Bun serves and sends network traffic in version 1.4.5: the `Bun.serve` HTTP server (routes, the `fetch` handler, errors, timeouts, lifecycle), WebSockets with built-in topic pub/sub, and the lower-level APIs (`fetch` extensions, TCP, UDP, DNS, cookies, TLS options), each checked in a Bun 1.4.5 container. Not covered here: HTML imports and the dev server (`bun/bundler/fullstack-dev-server-and-html.md`), `--hot` reloading (`bun/fundamentals/watch-hot-and-debugging.md`), throughput against Node.js (`bun/internals/performance-measured.md`), and `node:http`/`node:net` compatibility (`bun/node-compat/nodejs-compatibility.md`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [bun-serve.md](bun-serve.md) | concept | `Bun.serve`: route precedence, per-method fallthrough, `fetch` and `error` handlers, development error page, idle timeout in 4 s steps, streaming and `sendfile` file bodies, `reusePort` (balanced on Linux, not on macOS), Unix sockets, `stop`/`reload`, experimental HTTP/2 and HTTP/3 (`http2`, `http3`, `http1: false`, `Alt-Svc`) | verified |
| [websockets-and-pubsub.md](websockets-and-pubsub.md) | concept | `server.upgrade`, `ws.data`, the handler object, topics and `publishToSelf`, what `send()` and `publish()` return under backpressure, corking, `pause`/`resume`, compression on the wire and its memory cost, limits and close codes (Bun client and Chromium), the Bun client's `tls`, `proxy` and close timeout | verified |
| [networking-apis-reference.md](networking-apis-reference.md) | reference | Catalog of `fetch` extensions (proxy variables, `protocol`, `FetchSession`), `Bun.listen`/`Bun.connect` (TLS, `upgradeTLS`, handlers, write buffering), `Bun.udpSocket` (multicast), `Bun.dns` (backends on Linux and macOS), `Bun.Cookie`/`CookieMap` and `Bun.serve` TLS options, with lab results | verified |

## References
- [Server: docs/runtime/http/server.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/http/server.mdx) — Bun documentation source (Oven), 2026. Backs: scope of the server docs.
- [Fetch: docs/runtime/networking/fetch.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/networking/fetch.mdx) — Bun documentation source (Oven), 2026. Backs: scope of the client and socket APIs.
- `linux/lab-setup.md` — the lab the docs' ✅ behaviours ran in.

## Related
- `bun/system-apis/file-io.md` — `BunFile`, the value file routes serve.
- `bun/bundler/fullstack-dev-server-and-html.md` — HTML imports in `Bun.serve` routes.
- `bun/internals/performance-measured.md` — measured HTTP throughput.
