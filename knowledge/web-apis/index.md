---
schema: topic-index/v1
kind: topic
topic: web-apis
last-updated: 2026-11-23
---

# Web APIs

Web APIs covers HTTP-facing contracts and interface-layer behavior for services, and how the HTTP version underneath (HTTP/2 over TCP, HTTP/3 over QUIC) changes what a lost packet delays. It does not cover internal domain modeling, runtime object shapes, or general logging setup.

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [http2-http3-head-of-line-blocking-deep-dive.md](http2-http3-head-of-line-blocking-deep-dive.md) | deep-dive | Where head-of-line blocking happens in HTTP/2 and in HTTP/3, what QUIC removes and what it keeps (QPACK, flow control, UDP fallback), and when the difference matters | verified |
| [http-error-mapping.md](http-error-mapping.md) | concept | Central mapping from domain/application errors to HTTP status codes and RFC 9457 problem details | verified |
| [Node.js / nvm / corepack / pnpm / yarn Architecture](../nodejs/node-nvm-corepack-pnpm-yarn-architecture.md) | legacy | Windows Node.js toolchain dispatch, useful when debugging API service tooling | — |

## References
- [RFC 9110: HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110.html) — IETF, 2022. Backs: topic scope.
- [RFC 9457: Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457.html) — IETF, 2023. Backs: topic scope.

## Related
- `operations/structured-logging.md` — logs internal details that HTTP responses should not leak.
- `js-runtime/abort-signal.md` — cancellation and timeout behavior around outbound API calls.
- `nodejs/node-nvm-corepack-pnpm-yarn-architecture.md` — legacy Node.js service tooling context.
