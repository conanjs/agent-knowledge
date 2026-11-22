# Plan: Head-of-Line blocking in HTTP/2 vs HTTP/3

## Question
REQUEST (V's words): "Compare Head-of-Line blocking in HTTP/2 and HTTP/3."

Main question: where does head-of-line (HOL) blocking happen in HTTP/2 and in HTTP/3, by which mechanism, what does HTTP/3 over QUIC remove and what does it keep, and when does the difference matter in practice?

HOL blocking, in plain words: the first item in a queue holds up everything behind it, like one slow car on a single-lane road. Example: in HTTP/2, one lost TCP packet carrying stream 1's bytes stops the delivery of stream 3's bytes that already arrived, because TCP hands bytes to the application only in order.

## Sub-questions per profile

### taxonomy
Find the exact terms and definitions the specifications use, so later workers search for the right things:
- HOL blocking at the HTTP layer (HTTP/1.1 one-request-at-a-time and pipelining) vs at the transport layer (TCP in-order byte stream);
- HTTP/2: connection, stream, frame, multiplexing, stream and connection flow control, HPACK (header compression) and why its decoding is order-dependent;
- QUIC and HTTP/3: QUIC stream (bidirectional, unidirectional), STREAM frame, per-stream in-order delivery vs no ordering across streams, QUIC flow control (stream and connection), control and critical streams, QPACK, its encoder and decoder streams, dynamic table, "blocked stream" and `SETTINGS_QPACK_BLOCKED_STREAMS`;
- which RFC defines each term (expected: RFC 9113 HTTP/2, RFC 7541 HPACK, RFC 9000 QUIC transport, RFC 9002 QUIC loss detection, RFC 9114 HTTP/3, RFC 9204 QPACK), and the names `knowledge/` already uses ("multiplexed over a single long-lived TCP connection" in `grpc/stale-connection-keepalive.md`).

### ground-truth
Find the normative text (MUST, SHOULD, may, defaults, numbers) that decides each side of the comparison:
- RFC 9113: what it says about TCP-level HOL blocking and about the order frames must be processed in (HPACK state, header block contiguity, CONTINUATION);
- RFC 9000: delivery guarantees within one stream and across streams, how loss on one stream affects others, stream and connection flow-control limits;
- RFC 9114: what HTTP/3 states about HOL blocking compared with HTTP/2, which streams are critical, what happens when a control stream is closed;
- RFC 9204: when QPACK can block a stream, the default value of `SETTINGS_QPACK_BLOCKED_STREAMS` and what an encoder must do within that limit, how the encoder stream itself can block;
- RFC 7541 (HPACK) only for the facts the comparison needs.

### practitioner
Find what implementers and measurements report, from Rank 1–3 sources where possible (vendor engineering blogs, IETF/academic papers, browser and server docs):
- measured effect of packet loss on HTTP/2 vs HTTP/3 page loads or transfers (when HTTP/3 helps, when it does not);
- how implementations handle QPACK blocking in practice (for example, encoders that avoid the dynamic table or allow 0 blocked streams);
- how HTTP/2 deployments work around TCP HOL blocking (several connections, smaller windows), and how prioritization interacts with HOL blocking (RFC 9218 only as far as it touches HOL).

### pitfall
Find the misconceptions and edge cases, each with the source that refutes or limits it:
- "HTTP/3 removes all HOL blocking": what remains (within one stream, QPACK when blocked streams are allowed, connection-level flow control, a lost packet that carries frames of several streams, receiver buffering);
- "HTTP/2 is always worse than HTTP/1.1 under loss": what the sources say about one TCP connection vs several;
- HTTP-layer HOL vs transport-layer HOL confusion; flow-control stalls that look like HOL blocking;
- UDP blocked or throttled on a network, fallback to HTTP/2 over TCP, and the cost of user-space QUIC (CPU) where a source measures it.

## Out of scope
- QUIC handshake, 0-RTT, connection migration, congestion-control algorithms, TLS 1.3 details, server push, WebTransport, MASQUE, Alt-Svc and HTTPS DNS records (except as the fallback pitfall), kernel UDP tuning.
- HTTP/1.1 beyond a short contrast in `## 1.` (its one-request-at-a-time HOL, the reason HTTP/2 multiplexes).
- How-to configuration of a given server or CDN.

## Already in `knowledge/` (link, do not repeat)
- `grpc/stale-connection-keepalive.md` (legacy): gRPC calls multiplexed over one long-lived HTTP/2 TCP connection; HTTP/2 `PING`.
- `linux/networking/tcp-connection-lifecycle.md`: TCP states per RFC 9293 on Linux.
- `linux/networking/packet-path.md`: the kernel receive path, TCP socket receive buffer, retransmits.
- `javascript/browser/network-requests-in-depth.md`: the per-browser HTTP/1.1 connection limit and "use HTTP/2" for many SSE streams.
- `web-apis/index.md`: RFC 9110 HTTP semantics (version-independent).

No doc in `knowledge/` covers HTTP/2 framing, QUIC, HTTP/3, HPACK or QPACK.

## Doc settings
- `topic: web-apis` (the HTTP topic; its index scope "HTTP-facing contracts and interface-layer behavior" would need one line for transport versions when V commits the doc. The other candidate, `linux/networking`, is Linux-specific.)
- `MODE: full-verified`
- `CAP: 4` sources per profile (default).
- Seeds: none (`seed_sources: none`). V struck the 4 proposed RFC seeds on 2026-11-22: this run is compared with a baseline that had no seeds, so neither side may get sources the other lacks.
- Probes: possibly one `node24` probe with `node:http2` (several requests share one session and socket; client stream IDs are odd). No runtime can show packet-loss HOL blocking, so those claims rest on sources only.

## Token estimate
- 4 workers x about 135k (cap 4) = about 540k.
- Judge: at most 80 claims x about 2,600 = about 210k per round; 1 round expected, up to 3 (2 patch rounds) = 210k to 630k.
- Orchestrator (reading passages, writing, checks): about 150k to 250k.
- Total: about 0.9M expected, about 1.4M worst case.

**Approved by V, 2026-11-22**, with the seeds struck.
