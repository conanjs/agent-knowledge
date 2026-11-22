---
schema: deep-dive/v1
topic: networking/http
status: draft
applies-to: ["HTTP/2"]
last-updated: 2026-11-22
synthesized-into: []
tags: [fixture]
ranked-sources: true
---

# How an HTTP/2 stream ends

## Summary
**TL;DR:** a stream ends with END_STREAM or RST_STREAM. ✅[^a]
**Use this when:** a scenario needs a ranked deep dive in a research run.
**Depth:** fixture only.

## 1. Mental model
Either peer may half-close a stream. ✅[^a] A server that stops early resets the stream. ✅[^b]

## References
- [RFC 9113](https://www.rfc-editor.org/rfc/rfc9113) — IETF, 2022. Rank 1. Backs: all. [^a]
- [How HTTP/2 streams end](https://example.dev/blog/h2) — Ann Example, 2021. Rank 6. Backs: one claim. [^b]

## Related
- _None yet._
