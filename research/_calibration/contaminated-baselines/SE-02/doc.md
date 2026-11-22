---
schema: deep-dive/v1
topic: networking
status: draft
applies-to: ["HTTP/2 per RFC 9113 (2022)", "HTTP/3 per RFC 9114 (2022) over QUIC version 1 (RFC 9000 / 9001 / 9002)", "QPACK per RFC 9204", "sources read 2026-11-22"]
last-updated: 2026-11-22
last-verified: 2026-11-22
synthesized-into: []
tags: [http2, http3, quic, tcp, tls, head-of-line-blocking, hpack, qpack, flow-control, prioritization]
---

# Head-of-line blocking in HTTP/2 and HTTP/3

## Summary
**TL;DR:** HTTP/2 removed HTTP/1.1's application-layer head-of-line (HOL) blocking by interleaving many streams on one TCP connection, but TCP hands the application one ordered byte stream, so a single lost packet stalls every stream on the connection. HTTP/3 runs over QUIC, which keeps order per stream, so a lost packet stalls only the streams whose data was inside it. HTTP/3 does not remove HOL blocking altogether: it remains inside each stream, in QPACK header compression when the peers allow it, in shared flow-control credit, and whenever a client falls back to HTTP/2 because UDP is blocked.
**Use this when:** choosing between HTTP/2 and HTTP/3 for lossy networks such as mobile links; debugging stalls where every request on one connection pauses at the same moment; tuning QPACK, flow-control or stream-limit settings; or checking a claim such as "HTTP/3 has no head-of-line blocking".
**Depth:** HOL blocking at every layer (HTTP/1.1 pipelining, TCP, TLS records, QUIC streams, QPACK, flow control, congestion control); each relevant setting with its default; cross-side interactions between client, server and network; a packet-by-packet worked example; a matrix of what HTTP/3 does and does not remove; a local simulation with four scenarios; three published measurement studies; misconceptions; a decision table.

**How this doc was made.** One agent wrote it in a single pass on 2026-11-22 from a plain prompt, reading the RFC texts on rfc-editor.org and the other sources listed under References. The ✅ marks are that agent's own checks against the cited page; no second agent or script verified them. Read it as a draft.

Marking: ✅ followed by a footnote = checked against that source on 2026-11-22; ⚠️ unverified = general knowledge or the writer's own inference, not checked against a source.

---

## 1. Context

### 1.1 What head-of-line blocking is

**Head-of-line blocking** is the situation where data that is already available cannot be used, because something ahead of it in a shared queue is missing or slow.

Analogy: a supermarket with a single checkout lane. When the first customer's card is declined, everyone behind waits, including the person holding one bottle of water who could have paid in two seconds. Adding more lanes (more connections) or letting people pass (independent streams) are the two ways out.

Concrete artifact, HTTP/1.1 pipelining: a client sends two requests on one connection without waiting, `GET /big.js` then `GET /small.css`. The server may process them in parallel if both are safe methods, but it must send the responses in the order the requests arrived ✅[^18]. So `small.css` waits behind every byte of `big.js`. HTTP/1.1 pipelining therefore still suffers from application-layer HOL blocking, and clients open several connections to get concurrency instead ✅[^1].

### 1.2 Why it matters

- HTTP/2 and HTTP/3 both put many requests on **one** connection. HTTP/2 was designed so that fewer TCP connections are needed than with HTTP/1.x ✅[^1]. The cost: a problem on that one connection is a problem for every request on it.
- Several separate HTTP/1.1 connections do not share congestion control, which hurts network efficiency ✅[^2]; HTTP/2 is described as friendlier to the network because it needs fewer connections ✅[^1].
- gRPC runs on HTTP/2, so everything below about HTTP/2 over TCP applies to gRPC calls too ⚠️ unverified (general knowledge; see the gRPC keepalive doc under Related).
- The effect grows with packet loss. Wired links rarely lose packets; mobile and Wi-Fi links lose more ⚠️ unverified.

### 1.3 Terms used in this doc

| Term | Plain meaning | Concrete example |
|---|---|---|
| **Stream** | One lane inside a connection, usually carrying one request and its response | In HTTP/3 the client's first request uses QUIC stream 0, the next ones 4, 8 and so on ✅[^2] |
| **Frame** | A typed chunk of bytes sent on a stream | `HEADERS` (the request or response header fields) and `DATA` (the body) ✅[^2] |
| **Segment / packet** | What actually crosses the network: a TCP segment, or a QUIC packet inside a UDP datagram | One QUIC packet can carry frames of one stream or of several streams ✅[^12] |
| **RTT** (round-trip time) | Time for a packet to reach the peer and an answer to come back | 50 ms in the worked example in §5 |
| **Flow-control window** (credit) | How many bytes the receiver allows the sender to send before it must wait for more credit. Like a prepaid bar tab: when it reaches zero, the bartender stops pouring until someone tops it up | HTTP/2 starts every stream and the connection at 65,535 bytes ✅[^1] |
| **Dynamic table** (HPACK, QPACK) | A dictionary of recently sent header lines that both ends keep, so a repeated line is sent as a short index. Like two people agreeing that "#7" means "the usual coffee order" | The first response sends `content-type: text/html` in full and adds it to the table; later responses send only its index |
| **Packet-threshold loss detection** | The sender declares a packet lost once a packet sent some number of places later is acknowledged | TCP fast retransmit fires after 3 duplicate ACKs ✅[^9]; QUIC recommends a packet threshold of 3 ✅[^4] |

---

## 2. Actors and the settings that control HOL blocking

### 2.1 Actors

**HTTP/2 over TCP: 5 actors**
- **Client HTTP/2 layer** — its job: split each request into frames on its own stream and interleave the streams, via HTTP/2 framing on one connection.
- **Server HTTP/2 layer** — its job: decide which stream's frames to send next, via its own scheduler.
- **TLS record layer** — its job: encrypt the HTTP/2 bytes, via TLS records of at most 2^14 bytes (16,384) each ✅[^10].
- **TCP (sender and receiver)** — its job: deliver one reliable, in-order byte stream ✅[^7], via segments, ACKs and retransmission.
- **Network** — its job: carry the packets, via IP; it may drop or reorder them.

**HTTP/3 over QUIC: 5 actors**
- **Client HTTP/3 layer** — its job: map each request-response pair to its own QUIC stream ✅[^2], via HTTP/3 frames on that stream.
- **Server HTTP/3 layer** — its job: decide which streams' data goes into the next packet, via its own scheduler.
- **QPACK encoder and decoder** (one of each in every endpoint) — its job: compress header fields, via a dynamic table that is changed only on the single encoder stream (stream type 0x02) and acknowledged on the decoder stream (type 0x03) ✅[^6].
- **QUIC transport** — its job: reliability per stream and congestion control for the whole connection ✅[^2], plus encryption of each packet ✅[^5], via UDP datagrams.
- **Network** — its job: carry UDP datagrams; it may drop or reorder them, and some networks block UDP entirely ✅[^12].

### 2.2 Settings, with defaults

"Advertised by" is the side that announces the value; the **other** side must obey it when sending. In both protocols, flow-control limits are set by the receiver and respected by the sender ✅[^1][^3].

| Setting | Protocol | Advertised by | Default when not sent | What it does to HOL blocking | Source |
|---|---|---|---|---|---|
| `SETTINGS_INITIAL_WINDOW_SIZE` | HTTP/2 | each endpoint, as receiver | 65,535 bytes, for every stream | Small values make a stream stop and wait for `WINDOW_UPDATE`; only `DATA` frames count against it | ✅[^1] |
| Connection flow-control window | HTTP/2 | each endpoint, as receiver | 65,535 bytes; changed only by `WINDOW_UPDATE` frames, never by a SETTINGS value | Shared by all streams of the connection (what that leads to: §3.6) | ✅[^1] |
| `SETTINGS_MAX_CONCURRENT_STREAMS` | HTTP/2 | each endpoint, for streams the peer may open | No limit; RFC recommends at least 100 | A limit used up by active streams prevents new streams, so further requests wait for a stream to close | ✅[^1] |
| `SETTINGS_HEADER_TABLE_SIZE` | HTTP/2 (HPACK) | decoder side | 4,096 bytes | Size of the HPACK dynamic table; no extra HOL blocking, since TCP already orders everything | ✅[^1] |
| `SETTINGS_MAX_FRAME_SIZE` | HTTP/2 | receiver | 16,384 bytes | Larger frames mean longer runs of one stream between chances to switch streams ⚠️ unverified | ✅[^1] (value) |
| `initial_max_data` | QUIC | receiver | 0 when absent | Connection-level credit shared by all streams, like the HTTP/2 connection window | ✅[^3] |
| `initial_max_stream_data_bidi_local` / `_bidi_remote` / `_uni` | QUIC | receiver | 0 when absent: streams of that type start with a flow-control limit of 0 | Per-stream credit | ✅[^3] |
| `initial_max_streams_bidi` | QUIC | receiver | 0 when absent: the peer cannot open bidirectional streams until a `MAX_STREAMS` frame arrives | An HTTP/3 server SHOULD allow at least 100 request streams ✅[^2] | ✅[^3] |
| `initial_max_streams_uni` | QUIC | receiver | 0 when absent | HTTP/3 MUST allow the peer at least 3 unidirectional streams (control, QPACK encoder, QPACK decoder) and SHOULD give each at least 1,024 bytes of credit ✅[^2] | ✅[^3] |
| `SETTINGS_QPACK_MAX_TABLE_CAPACITY` | HTTP/3 (QPACK) | decoder side | 0, so no dynamic table, so QPACK can never block a stream | The QPACK counterpart of `SETTINGS_HEADER_TABLE_SIZE` | ✅[^6] |
| `SETTINGS_QPACK_BLOCKED_STREAMS` | HTTP/3 (QPACK) | decoder side | 0: the peer's encoder may not risk blocking any stream | Upper bound on how many streams may wait for dynamic-table updates at once | ✅[^6] |
| Priority (`urgency` `u`, `incremental` `i`) | HTTP/2 and HTTP/3, RFC 9218 | client in requests, server may override | `u=3`, `i=0` (false) | Decides whether the server sends responses one by one or interleaved, which decides how many streams a single loss touches (§4, §7) | ✅[^11] |

Two related facts about priority: RFC 9113 deprecates the HTTP/2 priority scheme of RFC 7540 and points to RFC 9218 as an alternative ✅[^1]; HTTP/3 itself has no priority signaling ✅[^2].

---

## 3. How HOL blocking happens, layer by layer

### 3.1 HTTP/1.1: application layer

Covered in §1.1: responses on one connection must come back in request order ✅[^18]. The usual workaround is several parallel TCP connections ✅[^1].

### 3.2 HTTP/2 over TCP: application layer fixed, transport layer not

HTTP/2 lets messages interleave on the same connection ✅[^1], so a slow response no longer holds up a fast one at the HTTP level. RFC 9113 states the limit plainly: "TCP head-of-line blocking is not addressed by this protocol" ✅[^1].

Why: TCP gives the application one reliable, in-order byte stream ✅[^7]. HTTP/2's streams exist only inside that byte stream, and TCP's loss recovery cannot see them. RFC 9114 sums up the result: a lost **or reordered** packet stalls all active transactions, whether or not their own data was in that packet ✅[^2].

Diagram (three responses A, B, C, sent interleaved; the segment carrying B0 is lost):

```
[Server: HTTP/2 + TLS + TCP sender]                       [Client: TCP receiver -> TLS -> HTTP/2]
HTTP/2 frames A0 B0 C0 A1 B1 C1 ...
  -> TLS records -> one TCP byte stream
  │
  │ ════════════════════ network boundary ═════════════════════
  ├── seg 1 [A0] ─────────────────────────────────▶ in order: handed to the app, A0 usable
  ├── seg 2 [B0] ──────── ✗ lost
  ├── seg 3 [C0] ─────────────────────────────────▶ held in the kernel buffer (gap before it)
  ├── seg 4 [A1] ─────────────────────────────────▶ held (A's bytes, but behind the gap)
  ├── ...       every later segment                ▶ held
  │◀──────────── ACKs keep asking for the bytes of seg 2 (duplicate ACKs) ────
  ├── after 3 duplicate ACKs: resend seg 2 [B0] ──▶ gap filled: B0 C0 A1 B1 ... handed over at once
```

Steps:

1. **Server HTTP/2 layer (local):** writes frames of A, B and C in turn into one TLS connection.
2. **TLS (local):** wraps the bytes in records of up to 16,384 bytes ✅[^10].
3. **TCP sender → network:** sends the bytes as numbered segments. The segment carrying B0 is dropped.
4. **TCP receiver (client kernel):** receives seg 3, seg 4 and so on, but holds them, because TCP may only hand bytes to the application in order ✅[^7]. The client application's `read()` returns nothing new, even though A's and C's next bytes are sitting in the buffer ⚠️ unverified (standard socket behaviour, not checked against a socket API spec).
5. **TCP receiver → sender:** each ACK still names the first missing byte, so the sender sees duplicate ACKs. After 3 of them it resends the missing segment without waiting for its timer ✅[^9]. Selective acknowledgment (SACK) lets the receiver also report which later segments arrived, so the sender resends only what was lost ✅[^8]; it does not change the in-order service the application gets ✅[^7].
6. **TCP receiver (client kernel):** when the resent segment arrives, the gap closes, and everything held is released at once.
7. **Client HTTP/2 layer:** now sees B0, C0, A1, B1 … together. A and C were delayed by close to one RTT although none of their bytes were lost (43 to 45 ms with a 50 ms RTT in the worked example, §5).

### 3.3 TLS records add their own HOL blocking (HTTP/2 only)

- TLS cuts the byte stream into records of at most 16,384 bytes ✅[^10]. Each record is protected as a unit and sent over a reliable transport that provides sequencing ✅[^5].
- A record can only be decrypted once all of it has arrived. A 16 KB record spans about 11 TCP packets, so one lost packet holds back the whole record ✅[^13].
- QUIC does not use TLS records for application data: it protects each packet with the TLS-negotiated AEAD (authenticated encryption with associated data) algorithm ✅[^5], so each received packet can be decrypted on its own ✅[^13].

### 3.4 HTTP/3 over QUIC: order per stream, not per connection

- QUIC carries stream data in `STREAM` frames that name a stream ID and a byte offset ✅[^3].
- **Delivery order and transmission order are separate.** Packet numbers give transmission order; delivery order comes from the stream offsets ✅[^4]. TCP conflates the two: the order the sender transmits in is the order the receiver must deliver in ✅[^4].
- Each stream is delivered to the application as an ordered byte stream, and the receiver buffers out-of-order data up to the flow-control limit ✅[^3]. QUIC gives no ordering guarantee between bytes of different streams ✅[^3].
- A lost packet is never resent whole: the lost data goes out again in new frames, inside new packets ✅[^3].
- HTTP/3 uses one QUIC stream per request-response pair, and a stream that is blocked or loses a packet does not stop the others ✅[^2].

Diagram (same three responses and the same loss as in §3.2):

```
[Server: HTTP/3 + QUIC sender]                            [Client: QUIC receiver -> HTTP/3]
streams A, B, C, frames interleaved into packets
  │
  │ ════════════════════ network boundary (UDP) ════════════════
  ├── pkt 1 [A0] ─────────────────────────────────▶ stream A offset 0: delivered
  ├── pkt 2 [B0] ──────── ✗ lost
  ├── pkt 3 [C0] ─────────────────────────────────▶ stream C offset 0: delivered
  ├── pkt 4 [A1] ─────────────────────────────────▶ stream A next offset: delivered
  ├── pkt 5 [B1] ─────────────────────────────────▶ stream B: held (B0 missing)
  ├── ...                                          ▶ A and C keep flowing; B's frames held
  │◀──────────── ACK ranges show pkt 2 missing ───
  ├── pkt 13 [B0 again, new packet number] ───────▶ stream B gap filled: B0 B1 B2 ... delivered
```

Steps:

1. **Server HTTP/3 layer (local):** writes each response on its own QUIC stream ✅[^2].
2. **QUIC sender (local):** packs `STREAM` frames into packets and protects each packet ✅[^5]. One packet may hold frames of one stream or of several ✅[^12].
3. **QUIC sender → network (UDP):** sends packets; packet 2, with B0, is lost.
4. **QUIC receiver (client):** places each frame by stream ID and offset ✅[^3]. A and C have no gaps, so their bytes go straight to HTTP/3. B's later frames wait in B's buffer.
5. **QUIC receiver → sender:** acknowledgments show packet 2 missing; the sender declares it lost by the packet threshold (3) or a time threshold (9/8 of an RTT) ✅[^4].
6. **QUIC sender → network:** resends B0's bytes in a new `STREAM` frame inside a new packet with a new packet number ✅[^3].
7. **QUIC receiver:** fills B's gap and delivers B. A and C finished as if nothing had been lost.

### 3.5 Header compression: why HTTP/3 needed QPACK

- HPACK, the HTTP/2 header compressor, assumes that encoded field sections arrive and are decoded in exactly the order they were encoded, so both dynamic tables stay in sync ✅[^2]. Over TCP that holds for free, because TCP delivers everything in order ✅[^7].
- Used over QUIC, HPACK would bring HOL blocking back, because streams no longer arrive in one total order ✅[^6]. HTTP/3 therefore replaces HPACK with QPACK ✅[^2].
- QPACK makes **all** dynamic-table changes on one unidirectional encoder stream, so updates keep a total order; header blocks on request streams only refer to the table ✅[^2]. Each endpoint opens at most one encoder stream ✅[^6].
- Each encoded header block carries a **Required Insert Count**: how many table insertions the decoder must have received before it can decode that block. A block with no dynamic-table references has a Required Insert Count of 0 ✅[^6].
- If a block arrives before the insertions it needs, its stream is **blocked** ✅[^6]. That is HOL blocking across streams, re-created on purpose and kept under control:
  - The decoder announces how many streams may be blocked at once in `SETTINGS_QPACK_BLOCKED_STREAMS`. The encoder MUST stay within it; a decoder that sees more blocked streams than it allowed treats it as a connection error of type `QPACK_DECOMPRESSION_FAILED` ✅[^6].
  - The encoder chooses per header block: refer to entries still in transit (better compression, risk of blocking) or only to entries the decoder has acknowledged (no risk, but literal strings, so bigger header blocks, which can then wait on congestion or flow-control limits instead) ✅[^6].
  - Both QPACK settings default to 0 ✅[^6]. With the defaults, there is no dynamic table and no QPACK blocking.
- QPACK also has a deadlock hazard: an encoder SHOULD NOT write an instruction unless there is enough stream and connection flow-control credit for all of it ✅[^6].

Artifact, the encoder's choice for one header line (schematic, not the real wire encoding):

```
encoder stream (type 0x02):   Insert  "user-agent: ExampleBrowser/1.0"   -> becomes dynamic entry 0
request stream 0 HEADERS:     Required Insert Count = 1, "indexed field: dynamic entry 0"   <- may block
            or, if risk not allowed:
request stream 0 HEADERS:     Required Insert Count = 0, "literal: user-agent: ExampleBrowser/1.0"  <- never blocks
```

### 3.6 Flow control: a second way one stream can block others

- In HTTP/2, multiplexing creates contention for the TCP connection, which is why HTTP/2 has flow control for each stream **and** for the connection as a whole ✅[^1]. Only `DATA` frames count against it ✅[^1].
- In QUIC, flow control also has a stream level and a connection level, and the sender must respect both ✅[^3]. Unlike HTTP/2, every HTTP/3 frame, headers included, is sent on a stream and so counts against QUIC flow control ✅[^2].
- RFC 9308 describes how this blocks across streams in QUIC: a receiver may hold back credit until data at the start of a stream has arrived ✅[^12]; connection credit can be used up by other streams, so a large message can deadlock even when its own stream limit is not reached ✅[^12]; and credit updates travel back over the same lossy path, so late updates throttle the sender ✅[^12].
- RFC 9308 also names the cross-stream case directly: when data on one stream depends on another and the first stream is left unread, the receiver may stop extending the credit the second stream needs, and the two deadlock ✅[^12].
- In short: removing transport ordering between streams does not remove the shared connection-level credit. HTTP/2's connection window is shared by all streams in the same way ✅[^1], so the writer expects one unread stream to be able to stall the others there too ⚠️ unverified (inference from RFC 9113's shared window, not stated in it).

### 3.7 Congestion control: shared fate, not HOL blocking

- QUIC keeps congestion control for the whole connection ✅[^2]. With the NewReno controller that RFC 9002 specifies, a detected loss halves the slow-start threshold, and the congestion window drops to it ✅[^4]. TCP does the same on the third duplicate ACK ✅[^9].
- So a loss on stream B also lowers the sending rate for A and C, in both protocols. That is not HOL blocking (A's data is not held back behind B's), but a loss still costs every stream on the connection something ⚠️ unverified (the writer's inference from the shared congestion window).
- On lossy cellular links, single-connection HTTP/2 slowed down pages with large objects, and HTTP/2 spread over several connections did better (§8.3) ✅[^16].

---

## 4. Cross-side interactions

What a choice made on one side does to the other sides.

| # | Change made by | Change | Effect on the other side(s) | Source |
|---|---|---|---|---|
| 1 | Server (scheduler) | Sends responses **one after another** (sequential) | A loss usually touches one stream. HTTP/3 then lets the *other* streams finish on time, but the stream hit still waits; the client gets each response complete early | §7 model ✅[^17]; sequential order suits scripts and style sheets ✅[^13] |
| 2 | Server (scheduler) | **Interleaves** responses (round-robin) | HTTP/3 cuts HOL waiting the most, but every response finishes near the end, which delays resources the browser can only use when complete (scripts, style sheets) | ✅[^13][^14]; §7 model ✅[^17] |
| 3 | Client (request header) | Sets `incremental=1` for a response | Tells the server that partial data is useful, so interleaving same-urgency responses may help; with the default `incremental=0`, serving them one by one in request order is considered best | ✅[^11] |
| 4 | Client, as QPACK decoder | Leaves `SETTINGS_QPACK_BLOCKED_STREAMS` at 0 (default) | The server's encoder may never reference unacknowledged entries: no QPACK HOL blocking, larger header blocks | ✅[^6] |
| 5 | Client, as QPACK decoder | Sets `SETTINGS_QPACK_BLOCKED_STREAMS` to N > 0 | The encoder may let up to N streams depend on in-flight table updates; a loss on the encoder stream then blocks up to N request streams | ✅[^6], §7 scenario 3 |
| 6 | Client, as QPACK decoder | Leaves `SETTINGS_QPACK_MAX_TABLE_CAPACITY` at 0 (default) | No dynamic table, so the encoder stream carries nothing that could block; the encoder may skip creating the encoder stream | ✅[^6] |
| 7 | Receiver (either side) | Small connection-level credit (`initial_max_data`, HTTP/2 connection window) or slow reading | All streams of the connection compete for that credit; one unread stream can stall the others; late credit updates throttle the sender | ✅[^1][^3][^12] |
| 8 | Server | Advertises few unidirectional streams or little credit on them | Control and QPACK streams can block early in the connection; HTTP/3 requires at least 3 and recommends at least 1,024 bytes each | ✅[^2] |
| 9 | Sender (QUIC packetizer) | Puts frames of several streams into one packet | Losing that one packet blocks all those streams: the HTTP/3 advantage shrinks to "only the streams in the lost packet" | ✅[^12] (packets can carry several streams), §7 scenario 2 |
| 10 | Sender (QUIC) | Sends retransmissions before new data | Recommended by RFC 9308; fills gaps sooner and frees flow-control credit | ✅[^12] |
| 11 | Network | Blocks UDP | HTTP/3 cannot connect; the HTTP fallback is TLS over TCP, so the client is back to HTTP/2 and its TCP HOL blocking. Measurements put UDP-blocking networks at 3% to 5% | ✅[^12] |
| 12 | Network | Reorders packets without losing them | HTTP/2: the reordered gap stalls all streams until it fills ✅[^2]. HTTP/3: only the stream with the gap waits ✅[^2][^3] | ✅[^2][^3] |
| 13 | Client | Sends 1-RTT packets before its handshake `Finished` is acknowledged | The server must wait for the client `Finished` before using 1-RTT packets; coalescing a copy of the Finished-carrying Handshake packet with them avoids that handshake-level HOL blocking | ✅[^5] |

---

## 5. Worked example: one lost packet, three responses

**Setup** (the same model as §7, scenario 1; numbers from its output ✅[^17]):

- Three responses, A, B and C, of 4 packets each. The server interleaves them (round-robin).
- One packet sent every 1 ms; one-way delay 25 ms, so the RTT is 50 ms.
- Loss detection by packet threshold 3, the same rule for TCP ✅[^9] and QUIC ✅[^4].
- The 2nd packet, carrying B0, is lost. Congestion control is not modelled.

The send order, exactly as the model prints it:

```
A0 B0 C0 A1 B1 C1 A2 B2 C2 A3 B3 C3
   ^^ lost
```

**Timeline** (ms after the first packet is sent):

| t (ms) | Event | HTTP/2 over TCP | HTTP/3 over QUIC |
|---|---|---|---|
| 0–11 | Server sends packets 1–12 | | |
| 25 | A0 arrives | delivered to the app | delivered to stream A |
| 26 | (B0 would have arrived) | — | — |
| 27–36 | Packets 3–12 (C0, A1, B1, C1, … C3) arrive, one per ms | all **held** behind the gap | A and C delivered as they arrive; B1 (29 ms), B2 (32 ms), B3 (35 ms) held in stream B |
| 34 | A3 arrives | held | **A complete** |
| 36 | C3 arrives | held | **C complete** |
| 54 | ACK of packet 5 (B1, sent at 4 ms) reaches the server: 3 packets past the gap, so B0 is declared lost and resent | | |
| 79 | Resent B0 arrives | gap filled, **A, B and C all complete** | **B complete** |

**Result:**

| Response | No loss | HTTP/2 over TCP | HTTP/3 over QUIC |
|---|---|---|---|
| A | 34 ms | 79 ms | 34 ms |
| B | 35 ms | 79 ms | 79 ms |
| C | 36 ms | 79 ms | 36 ms |
| Packets that arrived but had to wait | — | 10 of 12 | 3 of 12 |
| Total waiting (packet-milliseconds) | — | 475 | 141 |

Where the waiting totals come from:
- TCP: packets 3 to 12 arrive at 27, 28, …, 36 ms and are all released at 79 ms: 10 × 79 − (27 + 28 + … + 36) = 790 − 315 = 475.
- QUIC: B1, B2, B3 arrive at 29, 32 and 35 ms and are released at 79 ms: 50 + 47 + 44 = 141.

**The same loss with sequential sending** (`A0 A1 A2 A3 B0 … C3`, packet 2 = A1 lost): HTTP/2 again completes all three at 79 ms. HTTP/3 completes A at 79 ms, B at 32 ms and C at 36 ms, which are B's and C's no-loss times ✅[^17]. The lost stream always pays the full repair time in both protocols; HTTP/3 only spares the streams that lost nothing.

---

## 6. What HTTP/3 removes and what it does not

| # | Source of blocking | HTTP/2 over TCP | HTTP/3 over QUIC | Who controls it | Source |
|---|---|---|---|---|---|
| 1 | Lost or reordered packet, data of **other** streams | Blocks every stream until repaired | Blocks only the streams with data in that packet | Transport design | ✅[^2][^3] |
| 2 | Lost packet, data of the **same** stream | Blocks | Blocks: each stream is still delivered in order, and HTTP/3 does not use QUIC's optional out-of-order delivery | Protocol design | ✅[^2][^3] |
| 3 | One packet carrying several streams' frames | (all streams blocked anyway) | Every stream in that packet is blocked | Sender's packetizer | ✅[^12], §7 scenario 2 |
| 4 | TLS record spanning several packets | One loss blocks the whole record (up to 16 KB) | None: each packet is decrypted alone | Protocol design | ✅[^13][^10][^5] |
| 5 | Header compression | HPACK: no extra blocking beyond TCP's own ordering | QPACK: a stream can wait for encoder-stream updates, up to `SETTINGS_QPACK_BLOCKED_STREAMS` streams (default 0) | Client as decoder (limit), server as encoder (choice) | ✅[^2][^6] |
| 6 | Loss on the QPACK encoder stream | n/a | Blocks every request stream whose header block refers to entries after the gap | Encoder's referencing choice | ✅[^6] (mechanism), §7 scenario 3 |
| 7 | Large header block | Header block plus `CONTINUATION` frames must be sent back to back, with no frames of other streams in between | No `CONTINUATION` frame; a large `HEADERS` frame sits on its own stream | Protocol design | ✅[^1][^2] |
| 8 | Connection-level flow-control credit | Shared by all streams | Shared by all streams; also covers frame headers, not only `DATA` | Receiver | ✅[^1][^2][^3][^12] |
| 9 | Congestion window after a loss (shared fate, not ordering) | Shrinks for the whole connection | Shrinks for the whole connection | Sender | ✅[^2][^4][^9] |
| 10 | Requests waiting for a stream slot | `SETTINGS_MAX_CONCURRENT_STREAMS` (no limit by default) | `MAX_STREAMS` (0 until granted; HTTP/3 servers SHOULD allow ≥ 100) | Receiver | ✅[^1][^2][^3] |
| 11 | UDP blocked on the path | n/a | Falls back to TLS over TCP, so HTTP/2's blocking returns | Network | ✅[^12] |
| 12 | Handshake | TCP + TLS handshakes complete first | 1-RTT packets can wait for the client `Finished`; coalescing avoids it | Client | ✅[^5] |

---

## 7. Local model experiment

**What was run.** `experiments/hol-sim.mjs`, a deterministic Node.js script (Node 24.22.1, 2026-11-22) next to this doc; its full output is `experiments/output.txt` ✅[^17]. It is a **model**, not a real TCP or QUIC stack. It applies the two delivery rules (TCP: release bytes in connection order; QUIC: release bytes in per-stream order) to the same packets, the same losses and the same retransmission times. It leaves out congestion control, flow control, handshakes, ACK delay, TLS records and lost retransmissions. Loss detection: the ACK of the first packet sent at least 3 places later and not itself lost; for a loss in the last 3 packets, a stand-in timeout of 1.5 RTT. No test with real stacks and real packet loss was run: emulating loss on this machine (macOS) would mean changing the operating system's packet filter, which was out of scope.

**Scenario 1** is the worked example in §5.

**Scenario 2, one QUIC packet carrying two streams.** Send order `A0 A1 A2+B0 B1 C0 C1 C2 C3`; the 3rd packet (A's last frame plus B's first frame) is lost. Result ✅[^17]:

| Response | HTTP/2 over TCP | HTTP/3 over QUIC |
|---|---|---|
| A | 80 ms | 80 ms |
| B | 80 ms | 80 ms |
| C | 80 ms | 32 ms |

One loss blocks both streams that had frames in that packet. HTTP/3 protects only C.

**Scenario 3, QPACK, a lost encoder-stream packet (HTTP/3 only).** The first packet is the encoder stream's insert instruction, and it is lost. Then the `HEADERS` of A, B and C, then their bodies. Three decoder settings ✅[^17]:

| Decoder's `SETTINGS_QPACK_BLOCKED_STREAMS` | Encoder's choice | A | B | C | Frames that had to wait |
|---|---|---|---|---|---|
| ≥ 3 | all three header blocks refer to the new entry | 78 ms | 78 ms | 78 ms | 6 of 10 |
| 1 | only A refers to it; B and C use literals | 78 ms | 30 ms | 31 ms | 2 of 10 |
| 0 (default) | all use literals | 29 ms | 30 ms | 31 ms | 0 of 10 |

With every stream allowed to risk blocking, one lost encoder packet behaves like TCP HOL blocking for those streams. The model ignores the cost on the other side of the trade: literals make header blocks bigger ✅[^6].

**Scenario 4, Monte Carlo.** 10 responses of 10 packets each (100 packets), 5,000 trials per row, seed 42, average loss rate 2%. "Random" drops each packet independently; "bursty" drops runs of 5 consecutive packets at the same average rate (measured: 1.97 and 1.89 lost packets per trial). Columns: mean time until a response is complete; mean time until the **last** response is complete; mean time a packet's data sat in the receive buffer after it arrived, averaged over all 100 packets ✅[^17].

| Loss | Server sends | Protocol | Mean completion of a response (ms) | Last response (ms) | Mean buffer wait per packet (ms) |
|---|---|---|---|---|---|
| none | sequential | either | 79.0 | 124.0 | 0 |
| none | round-robin | either | 119.5 | 124.0 | 0 |
| random | sequential | HTTP/2 / TCP | 97.7 | 145.7 | 16.71 |
| random | sequential | HTTP/3 / QUIC | 88.0 | 145.7 | 4.13 |
| random | round-robin | HTTP/2 / TCP | 140.2 | 145.7 | 16.71 |
| random | round-robin | HTTP/3 / QUIC | 122.8 | 145.7 | 1.72 |
| bursty | sequential | HTTP/2 / TCP | 84.2 | 130.5 | 3.90 |
| bursty | sequential | HTTP/3 / QUIC | 81.7 | 130.5 | 0.79 |
| bursty | round-robin | HTTP/2 / TCP | 125.6 | 130.5 | 3.90 |
| bursty | round-robin | HTTP/3 / QUIC | 122.8 | 130.5 | 1.68 |

What the numbers say, with the arithmetic:

1. **HOL removal does not move the end of the whole transfer.** The last response completes at the same time in both protocols (145.7 ms random, 130.5 ms bursty). The last response is complete only when every packet, the last repaired one included, has arrived, and that moment is the same in both. HTTP/3's gain is that the *other* responses finish earlier.
2. **Round-robin plus QUIC cuts waiting the most** under random loss: 16.71 → 1.72 ms per packet, (16.71 − 1.72) / 16.71 = 90% less. Sequential plus QUIC: 16.71 → 4.13 ms, (16.71 − 4.13) / 16.71 = 75% less.
3. **Less waiting is not faster completion.** Round-robin with QUIC (122.8 ms mean) is still slower than sequential over **TCP** (97.7 ms), because interleaving makes every response end near the end even without loss (119.5 ms against 79.0 ms).
4. **Share of the loss penalty that HTTP/3 removes** (penalty = mean completion with loss minus without):

   | Loss | Server sends | TCP penalty | QUIC penalty | Removed by QUIC |
   |---|---|---|---|---|
   | random | sequential | 97.7 − 79.0 = 18.7 | 88.0 − 79.0 = 9.0 | 9.7 / 18.7 = 52% |
   | random | round-robin | 140.2 − 119.5 = 20.7 | 122.8 − 119.5 = 3.3 | 17.4 / 20.7 = 84% |
   | bursty | sequential | 84.2 − 79.0 = 5.2 | 81.7 − 79.0 = 2.7 | 2.5 / 5.2 = 48% |
   | bursty | round-robin | 125.6 − 119.5 = 6.1 | 122.8 − 119.5 = 3.3 | 2.8 / 6.1 = 46% |

   Bursts cut round-robin's advantage from 84% to 46%: in round-robin order, 5 consecutive packets belong to 5 different streams, so one burst blocks 5 streams. In sequential order a burst mostly hits one stream, so the share barely moves (52% to 48%). Under bursty loss with HTTP/3, round-robin packets even wait longer in the buffer than sequential ones (1.68 against 0.79 ms).
5. **Bursty loss costs less in total here** (5.2 ms penalty against 18.7 ms) because the same number of lost packets falls into fewer recovery episodes: only 1,596 of 5,000 bursty trials had any loss, against 4,314 of 5,000 random trials. This is a property of the model's loss pattern, not a general law ⚠️ unverified.

These model results agree in direction with the published measurements in §8: the HOL benefit depends on scheduling and on the loss pattern.

---

## 8. Published measurements

### 8.1 Marx, "Head-of-Line Blocking in QUIC and HTTP/3: The Details" (2020)

- HTTP/2's TCP-level HOL blocking ends up blocking HTTP itself; QUIC keeps order within a stream but not across streams ✅[^13].
- QUIC's benefit needs several streams active at once; interleaving is often not the best order for loading web resources, because the browser needs scripts, style sheets and fonts complete before it can use them ✅[^13].
- Real loss is usually bursty and hard to predict; a burst that spans several streams blocks all of them ✅[^13].
- The author's conclusion, given as tentative: removing HOL blocking will probably not do much for web performance in most cases; he still expects HTTP/3 to beat HTTP/2 overall, mainly through faster connection setup (0-RTT) ✅[^13].

### 8.2 Sander, Kunze and Wehrle, "Analyzing the Influence of Resource Prioritization on HTTP/3 HOL Blocking and Performance" (TMA 2022)

Paper details from the authors' publication page ✅[^15]; findings from the first author's summary ✅[^14]:
- Setup: 35 websites replayed in a testbed and loaded with Chromium; 1 to 10 Mbit/s, 50 ms latency per direction, random loss and bursts of 5; Chrome's sequential strategy compared with parallel and round-robin strategies ✅[^14].
- At 10 Mbit/s, over a quarter of the sites showed barely any difference, often because the page finished during slow start, before any loss ✅[^14].
- At 2 Mbit/s with higher random loss, parallel strategies cut HOL blocking strongly, but SpeedIndex gains (a measure of how fast the visible page fills in) were more modest and mostly for larger sites ✅[^14].
- Moving from random loss to bursts of 5 pushed the gains below the sequential baseline ✅[^14].
- Conclusion: sequential sending is adequate in typical low-loss, high-bandwidth conditions; parallel sending pays off mainly with high random loss and low bandwidth ✅[^14].

### 8.3 Goel, Steiner, Wittie, Ludin and Flack, "Domain-Sharding for Faster HTTP/2 in Lossy Cellular Networks" (2017)

- Unlike HTTP/1, HTTP/2 uses one TCP connection; under lossy cellular conditions it was faster for small objects but slowed down pages with large objects ✅[^16].
- Spreading HTTP/2 over several connections beat both single-connection HTTP/2 and HTTP/1.1 with six connections in those conditions ✅[^16].
- This is the TCP-side counterpart of HTTP/3's design: more connections spread the effect of a loss, at the cost the RFCs describe in §1.2 ✅[^2].

---

## 9. Misconceptions and pitfalls

| # | Claim | Verdict | Why | Source |
|---|---|---|---|---|
| M1 | "HTTP/2 has no head-of-line blocking, thanks to multiplexing." | Wrong | It removed application-layer HOL blocking only; TCP HOL blocking remains | ✅[^1][^2] |
| M2 | "HTTP/3 has no head-of-line blocking." | Wrong | It removes cross-stream blocking at the transport only. Blocking inside a stream, QPACK blocking (when allowed), shared packets, shared flow-control credit and the TCP fallback all remain (§6) | ✅[^2][^3][^6][^12] |
| M3 | "HTTP/3 hands data to the application out of order." | Wrong | QUIC MAY offer out-of-order delivery within a stream; HTTP/3 does not use it | ✅[^2][^3] |
| M4 | "In QUIC, a loss on stream B has no effect on stream A." | Partly wrong | A's data is not held back, but congestion control is shared, and a packet with frames of both streams blocks both | ✅[^2][^12]; §7 scenario 2 |
| M5 | "TCP SACK fixes HOL blocking." | Wrong | SACK changes what the sender resends; the application still gets bytes in order | ✅[^7][^8] |
| M6 | "QPACK always causes head-of-line blocking." | Wrong | Only if the decoder allows blocked streams (default 0) **and** the encoder chooses to reference unacknowledged entries | ✅[^6] |
| M7 | "QPACK removes all header-compression blocking." | Wrong | It bounds blocking; with blocked streams allowed, a lost encoder-stream packet can still block several request streams | ✅[^6]; §7 scenario 3 |
| M8 | "With HTTP/3, the server should always interleave responses." | Depends | Interleaving maximizes HOL relief but delays each complete response; for non-incremental responses of equal urgency, one by one is considered best | ✅[^11][^13][^14] |
| M9 | "Removing HOL blocking makes the whole page download finish sooner." | Wrong in the model; ⚠️ unverified in general | In the model, the last response completes at the same time; only the others finish earlier. Real stacks add congestion-control effects | ✅[^17] for the model |
| M10 | "HTTP/3's main speed gain is the removal of HOL blocking." | Contested | Marx expects 0-RTT connection setup to matter more for most web loads | ✅[^13] |
| M11 | "If HTTP/3 is enabled, users get HTTP/3." | Not always | 3–5% of networks block UDP; HTTP then falls back to TLS over TCP | ✅[^12] |

---

## 10. Decision table: when does HTTP/3's HOL advantage matter?

| Situation | Expected effect of HTTP/3 on HOL blocking | Why |
|---|---|---|
| Wired, low-loss, high-bandwidth link | Little | Few losses to recover from; pages often finish before loss occurs (§8.2) ✅[^14] |
| Lossy, low-bandwidth link with random loss, many parallel responses | Largest | Each loss stalls one stream instead of all; parallel strategies cut HOL blocking strongly (§8.2) ✅[^14] |
| Bursty loss | Smaller | A burst spans several streams, especially with interleaved sending (§7, §8.1) ✅[^13][^17] |
| One large download on one stream | None | All the data is in one stream, which stays in order ✅[^3] |
| Many small, independent API calls on one connection (for example many concurrent gRPC-style requests) | Helpful | Each call is its own stream, and one call's loss no longer delays the rest ⚠️ unverified (inference; gRPC over HTTP/3 not checked) |
| Header-heavy traffic with QPACK blocked streams allowed | Partly given back | Encoder-stream loss blocks up to N streams ✅[^6] |
| Path that blocks UDP | None | Fallback to HTTP/2 over TCP ✅[^12] |

---

## 11. Open questions (not verified here)

- Which QPACK settings (`SETTINGS_QPACK_MAX_TABLE_CAPACITY`, `SETTINGS_QPACK_BLOCKED_STREAMS`) major browsers and servers send today ⚠️ unverified.
- How often real QUIC stacks put frames of several streams in one packet, which decides how often scenario 2 happens ⚠️ unverified.
- Whether real HTTP/2 stacks reduce HOL waiting with very small TLS records or TCP tuning; not researched here ⚠️ unverified.
- How the model results in §7 compare with real stacks (for example an HTTP/2 and an HTTP/3 server under emulated loss); not measured.

## References

All read 2026-11-22. RFC texts were read in their plain-text form at `https://www.rfc-editor.org/rfc/rfcNNNN.txt`.

- [RFC 9113: HTTP/2](https://www.rfc-editor.org/rfc/rfc9113) — IETF, 2022. Backs: §1 (pipelining HOL, fewer connections), §1 note on TCP HOL; §4.3 field blocks contiguous; §5.2, §5.2.1, §6.9.2 flow control; §6.5.2 settings defaults; §5.3.2 priority deprecation. [^1]
- [RFC 9114: HTTP/3](https://www.rfc-editor.org/rfc/rfc9114) — IETF, 2022. Backs: §1.1 (HTTP/2 stall on loss or reordering, HTTP/1.1 connections not sharing congestion control); §1.2 (stream-level reliability, connection-wide congestion control); §2 (one stream per request, independent streams, QPACK replaces HPACK); §6 (no out-of-order delivery used); §6.1 (stream IDs, ≥ 100 request streams); §6.2 (≥ 3 unidirectional streams, 1,024 bytes); §4.2.1; Appendix A.2.1–A.2.3 and A.2.5. [^2]
- [RFC 9000: QUIC: A UDP-Based Multiplexed and Secure Transport](https://www.rfc-editor.org/rfc/rfc9000) — IETF, 2021. Backs: §2 (no ordering across streams); §2.2 (ordered delivery per stream, optional out-of-order); §4.1 (two levels of flow control); §13.3 (lost data resent in new frames); §18.2 (transport parameter defaults). [^3]
- [RFC 9002: QUIC Loss Detection and Congestion Control](https://www.rfc-editor.org/rfc/rfc9002) — IETF, 2021. Backs: §4.2 (transmission order vs delivery order); §7.3.2 (NewReno recovery halves the threshold); Appendix A.2 (packet threshold 3, time threshold 9/8). [^4]
- [RFC 9001: Using TLS to Secure QUIC](https://www.rfc-editor.org/rfc/rfc9001) — IETF, 2021. Backs: §2.1 (TLS records individually protected over a reliable transport); §5 (per-packet AEAD protection, each packet handled separately); §5.7 (client `Finished` dependency and coalescing). [^5]
- [RFC 9204: QPACK: Field Compression for HTTP/3](https://www.rfc-editor.org/rfc/rfc9204) — IETF, 2022. Backs: §1 (HPACK would cause HOL blocking; QPACK goals); §2.1.2 (Required Insert Count, blocked streams, limit, error, encoder choice); §2.1.3 (flow-control deadlocks); §4.2 (encoder/decoder stream types, one each); §5 (settings defaults). [^6]
- [RFC 9293: Transmission Control Protocol (TCP)](https://www.rfc-editor.org/rfc/rfc9293) — IETF, 2022. Backs: §2.2 (reliable, in-order byte stream). [^7]
- [RFC 2018: TCP Selective Acknowledgment Options](https://www.rfc-editor.org/rfc/rfc2018) — IETF, 1996. Backs: §1 (SACK lets the sender resend only lost segments). [^8]
- [RFC 5681: TCP Congestion Control](https://www.rfc-editor.org/rfc/rfc5681) — IETF, 2009. Backs: §3.2 (fast retransmit after 3 duplicate ACKs; ssthresh lowered on the third duplicate ACK). [^9]
- [RFC 8446: The Transport Layer Security (TLS) Protocol Version 1.3](https://www.rfc-editor.org/rfc/rfc8446) — IETF, 2018. Backs: §5.1 (record fragment at most 2^14 bytes). [^10]
- [RFC 9218: Extensible Prioritization Scheme for HTTP](https://www.rfc-editor.org/rfc/rfc9218) — IETF, 2022. Backs: §4.1, §4.2 (urgency default 3, incremental default false, one-by-one serving of non-incremental responses). [^11]
- [RFC 9308: Applicability of the QUIC Transport Protocol](https://www.rfc-editor.org/rfc/rfc9308) — IETF, 2022. Backs: §2 (3–5% of networks block UDP; HTTP fallback is TLS over TCP); §4 (packets carry one or several streams' frames); §4.2 (retransmit before new data); §4.3 (credit withheld until contiguous data); §4.4 (flow-control deadlocks across streams). [^12]
- [Head-of-Line Blocking in QUIC and HTTP/3: The Details](https://calendar.perfplanet.com/2020/head-of-line-blocking-in-quic-and-http-3-the-details/) — Robin Marx, Web Performance Calendar, 2020. Backs: §3.3 TLS record HOL; §8.1; M8, M10. [^13]
- [HTTP/3 and QUIC — prioritization and head-of-line blocking](https://blog.apnic.net/2022/11/30/http-3-and-quic-prioritization-and-head-of-line-blocking/) — Constantin Sander, APNIC Blog, 2022. Backs: §8.2 findings; §10. [^14]
- [Analyzing the Influence of Resource Prioritization on HTTP/3 HOL Blocking and Performance](https://www.comsys.rwth-aachen.de/publication/2022/2022_sander_analyzing-the-influence-of/) — Sander, Kunze, Wehrle, RWTH Aachen University, TMA 2022 (publication page; the PDF could not be read as text). Backs: §8.2 title, authors, venue. [^15]
- [Domain-Sharding for Faster HTTP/2 in Lossy Cellular Networks](https://arxiv.org/abs/1707.05836) — Goel, Steiner, Wittie, Ludin, Flack, arXiv, 2017 (abstract read). Backs: §3.7, §8.3. [^16]
- `research/_golden/SE-02/baseline/experiments/hol-sim.mjs` and `experiments/output.txt` — the local model and its output, run 2026-11-22 with Node 24.22.1. Backs: §5, §7, M9. [^17]
- [RFC 9112: HTTP/1.1](https://www.rfc-editor.org/rfc/rfc9112) — IETF, 2022. Backs: §9.3.2 (pipelined responses in request order). [^18]

## Related

- `knowledge/linux/networking/tcp-connection-lifecycle.md` — TCP states and the connection lifecycle underneath HTTP/2.
- `knowledge/linux/networking/packet-path.md` — where a packet goes inside the Linux kernel, including the receive buffer that holds out-of-order segments.
- `knowledge/grpc/stale-connection-keepalive.md` — gRPC over long-lived HTTP/2 connections, another failure mode of "one connection for everything".
