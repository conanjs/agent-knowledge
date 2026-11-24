---
schema: topic-index/v1
kind: subtopic
topic: deno/web
last-updated: 2026-11-24
---

# Web servers in Deno

Serving HTTP with Deno 2.9.8: `Deno.serve` and `deno serve` (handler, options, graceful shutdown, streaming bodies and backpressure, TLS and HTTP/2, automatic compression, `--parallel`), then what is built on top of them: WebSockets with `Deno.upgradeWebSocket` and `WebSocketStream`, server-sent events with `EventSource`, routing with `URLPattern` and `@std/http` `route`, and static files with `serveDir`/`serveFile`. The Deno behaviours were run in the lab of `deno/deno-lab-setup.md`; a few cases (Windows, browser connection limits, WebSockets over HTTP/2) come from the docs only. Not covered: the `fetch` client and other web globals (`deno/fundamentals/web-platform-apis.md`), permission flags (`deno/security/`), hosted serving on Deno Deploy, and a comparison of web frameworks.

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [http-server.md](http-server.md) | concept | `Deno.serve(handler)` and `deno serve`: defaults, `info.remoteAddr` and `completed`, `onError`, `shutdown()` with requests in flight, streamed bodies with backpressure, TLS with ALPN to HTTP/2, compression rules, `--parallel` workers | verified |
| [websockets-sse-and-routing.md](websockets-sse-and-routing.md) | concept | `Deno.upgradeWebSocket` and what happens if its response is not returned, idle pings, `WebSocketStream`, SSE with `EventSource` reconnects, `URLPattern` and `route`, `serveDir` ETags, 304 and ranges | verified |

## References
- [Writing an HTTP Server](https://docs.deno.com/runtime/fundamentals/http_server/) — Deno project, living. Backs: subtopic scope.
- [@std/http](https://jsr.io/@std/http) — Deno project, living. Backs: the routing and file-server modules covered.

## Related
- `deno/learning-path.md` — where this subtopic sits in the reading order.
- `deno/security/permission-model.md` — the `--allow-net` and `--allow-read` grants a server needs.
- `deno/std-and-jsr/standard-library.md` — the rest of the `@std` packages.
