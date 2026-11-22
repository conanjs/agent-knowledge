---
schema: deep-dive/v1
topic: networking
status: draft
applies-to: ["HTTP/1.1 (RFC 9112)", "HTTP/2 (RFC 9113) over TLS 1.3 over TCP", "HTTP/3 (RFC 9114) over QUIC version 1 (RFC 9000)", "HPACK (RFC 7541), QPACK (RFC 9204)", "sources read 2026-11-22"]
last-verified: 2026-11-22
last-updated: 2026-11-22
synthesized-into: []
tags: [http2, http3, quic, tcp, tls, head-of-line-blocking, multiplexing, hpack, qpack, flow-control, prioritization]
---

# Head-of-line blocking in HTTP/2 and HTTP/3

## Summary
**TL;DR:** Head-of-line (HoL) blocking is when one missing or slow piece of data stops data queued behind it, even data that has already arrived. HTTP/2 removed it from the HTTP layer by interleaving many streams on one connection, but kept it in the transport: TCP (Transmission Control Protocol) delivers one ordered byte stream, so one lost packet stalls every stream. HTTP/3 moves streams into QUIC, which orders data only within each stream, so a loss stalls only the streams whose data was in the lost packet; HoL blocking remains inside a stream, in shared flow-control and congestion limits, and (by choice) in QPACK header compression.
**Use this when:** you need to explain why HTTP/2 can do worse than HTTP/1.1 on lossy networks; you decide whether HTTP/3 will help a given workload (many parallel small responses vs. one large download); you tune QPACK settings (`SETTINGS_QPACK_BLOCKED_STREAMS`, `SETTINGS_QPACK_MAX_TABLE_CAPACITY`), flow-control windows or the server's response scheduling; you read a packet trace where unrelated responses stall together.
**Depth:** every layer where HoL blocking can occur (HTTP message, header compression, TLS (Transport Layer Security) record, transport, flow control, congestion control, single stream) in HTTP/1.1, HTTP/2 and HTTP/3; each actor in both stacks and every setting that changes HoL behaviour, with defaults and unset behaviour; a step-by-step timeline of one lost packet in each stack; a worked example with numbers from a local model; the HPACK vs. QPACK trade-off; cross-side interactions (client vs. server, sender vs. receiver); an edge-case matrix; published measurements of how much it matters in practice.

---

## 1. Words first

RFC (Request for Comments) numbers refer to the IETF (Internet Engineering Task Force) documents that define each protocol.

| Term | Plain English | Analogy | Concrete artifact |
|---|---|---|---|
| Head-of-line (HoL) blocking | One slow or missing item prevents the items behind it from making progress ✅[^marx] | A stalled car at a single-lane toll booth: every car behind it waits, though none of them did anything wrong | In §6, scenario S1: one lost packet holds 7 packets that already arrived for up to 52 ms |
| Stream | One request/response exchange inside a shared connection | One order ticket in a busy kitchen | HTTP/2 stream 1 carrying `GET /app.js`; HTTP/3 uses one client-initiated bidirectional QUIC stream per request ✅[^rfc9114] |
| Frame | A labelled chunk of a stream: type, length, stream identifier | A labelled box on a shared conveyor belt | An HTTP/2 `DATA` frame for stream 3; default maximum frame payload 16,384 bytes ✅[^rfc9113] |
| Packet (in TCP: segment) | The unit the network delivers, delays or loses | One truck on a road | One UDP (User Datagram Protocol) datagram, carried in one IP (Internet Protocol) packet, holding one QUIC packet with two `STREAM` frames |
| Byte stream | Ordered bytes; the transport knows no message boundaries inside them | A ticker tape you can only read from the front | TCP gives no link between segment boundaries and the application's write boundaries ✅[^rfc9293] |
| Multiplexing | Several streams share one connection by interleaving their frames | Dishes for several tables on one conveyor belt | Packet order `A1 B1 C1 A2 B2 C2 …` |
| Round-trip time (RTT) | Time for a packet to reach the peer and its acknowledgment (ACK) to come back | The delay before you hear your echo in a canyon | 50 ms (milliseconds) in the worked example |
| Retransmission | Sending lost data again once the sender concludes it was lost | Re-sending a parcel that never arrived | QUIC never resends a lost packet whole; it puts the lost frames into new packets ✅[^rfc9000] |
| TLS record | The unit TLS encrypts and authenticates: at most 2^14 = 16,384 bytes of plaintext ✅[^rfc8446] | A sealed envelope: you can read the letter only after the whole envelope has arrived | A 16 KB (kilobyte) record spans about 11 TCP packets ✅[^marx] |
| HPACK / QPACK | The header-compression formats of HTTP/2 (RFC 7541) and HTTP/3 (RFC 9204): repeat a header by pointing at an entry in a table | A shared phrasebook: "say entry 62" instead of the whole sentence | A `cookie` header sent in full once, then referenced by index |
| Dynamic table | The part of that phrasebook built up during the connection | Pages both sides add to the phrasebook while talking | Initial size 4,096 bytes in HTTP/2 ✅[^rfc9113]; capacity 0 in HTTP/3 until the decoder allows more ✅[^rfc9204] |
| Flow control | A receiver-set limit on how much data the sender may have outstanding | A mailbox that holds only so many letters before someone empties it | HTTP/2: 65,535-byte window per stream and per connection at start ✅[^rfc9113] |
| Congestion control | A sender-side limit on its sending rate, so it does not overload the network | Slowing down in heavy traffic | QUIC's NewReno-like controller, one per network path ✅[^rfc9002] |
| Scheduling | The order in which the sender interleaves frames of different streams | Serving one table's whole meal first vs. one dish per table in turn | Sequential `AAAABBBBCCCC` vs. round-robin `ABCABCABCABC` ✅[^marx] |

---

## 2. Context: why HoL blocking matters, and how each version moved it

A web page needs tens of resources over one origin. How long each one waits depends on where in the stack a delay can spread to unrelated resources.

- **HTTP/1.1.** One connection carries one response at a time. Pipelining lets a client send several requests without waiting, but the server must send the responses in the order the requests arrived ✅[^rfc9112], so one slow response holds up the rest. RFC 9113 names this application-layer HoL blocking ✅[^rfc9113]. HTTP/1.1 lists HoL blocking as a reason clients open several connections ✅[^rfc9112]; browsers use about six per host ✅[^marx].
- **HTTP/2.** Frames carry a stream identifier, so either endpoint can interleave frames of many streams on one connection ✅[^rfc9113]. That removes HTTP-layer HoL blocking. RFC 9113 states that HTTP/2 does not address TCP-level HoL blocking ✅[^rfc9113]: TCP sees one byte stream, so a lost or reordered packet stalls all active transactions, even those that had no data in it ✅[^rfc9114].
- **HTTP/3.** QUIC provides streams, per-stream flow control, reliability at the stream level and congestion control across the whole connection ✅[^rfc9114]. Because QUIC streams are independent, a stream that is blocked or loses a packet does not stop progress on other streams ✅[^rfc9114]. The price: QUIC guarantees no order across streams ✅[^rfc9000], so HTTP/2 features that assumed one total order (HPACK, the priority tree) had to be redesigned ✅[^rfc9114].

**Why HTTP/2 can lose to HTTP/1.1 on a bad network.** HTTP/1.1's six connections are six independent byte streams: a loss stalls one of them. HTTP/2 puts everything on one, so one loss stalls everything. At around 2% packet loss, HTTP/1.1 users are usually better off ✅[^h3explained].

---

## 3. Where HoL blocking can happen, layer by layer

| Layer | HTTP/1.1 | HTTP/2 over TLS over TCP | HTTP/3 over QUIC |
|---|---|---|---|
| HTTP messages | Yes: responses in request order on a connection ✅[^rfc9112] | No: frames of many streams interleave ✅[^rfc9113] | No: one QUIC stream per request ✅[^rfc9114] |
| Header compression | None across requests (HTTP/1.1 has no header compression ⚠️ unverified) | Masked by TCP: HPACK uses one encoder and one decoder context for all field blocks on the connection ✅[^rfc9113], which is safe only because TCP delivers in order ✅[^rfc9114] | Optional: a request stream that references a dynamic-table entry not yet received is blocked; the decoder caps how many streams may block ✅[^rfc9204] (§7) |
| TLS record | Per connection ⚠️ unverified (inference) | Yes: a record is decrypted as a whole ✅[^rfc8446], so one lost packet can stall a whole record of about 11 packets ✅[^marx] | No TLS records: each QUIC packet is protected on its own with the AEAD (authenticated encryption with associated data) algorithm negotiated by TLS ✅[^rfc9001] |
| Transport ordering | Per connection: a loss stalls only that connection ✅[^h3explained] | Yes, across all streams: TCP is an in-order byte stream ✅[^rfc9293] | Only within a stream ✅[^rfc9000] |
| A packet holding several streams' frames | n/a | Always shared: TCP carries every stream in one ordered byte stream ✅[^marx] | Allowed ✅[^rfc9000]; then one loss blocks every stream in that packet. Most implementations rarely mix streams in one packet ✅[^marx] |
| Flow control | TCP window per connection ⚠️ unverified | Per stream and per connection; only `DATA` frames count ✅[^rfc9113] | Per stream and per connection ✅[^rfc9000]; all frames on all streams count ✅[^rfc9114] |
| Congestion control | Per connection ⚠️ unverified | One TCP connection, one controller ⚠️ unverified | One controller per path ✅[^rfc9002], covering the whole connection ✅[^rfc9114] |
| Inside one stream | Yes: TCP is in-order ✅[^rfc9293] | Yes: TCP is in-order ✅[^rfc9293] | Yes: QUIC keeps order within a stream ✅[^marx], and HTTP/3 does not use QUIC's optional out-of-order delivery ✅[^rfc9114] |
| Handshake | TCP handshake, then TLS handshake ⚠️ unverified | Same as HTTP/1.1 ⚠️ unverified | The server waits for the client's TLS Finished message; RFC 9001 notes the possible HoL blocking this implies and a client-side mitigation ✅[^rfc9001] |

---

## 4. The actors, and every setting that changes HoL behaviour

### 4.1 HTTP/2 stack: 5 actors

- **Application** — its job: produce and consume requests and responses, via the HTTP/2 library's API (application programming interface).
- **HTTP/2 framing layer** — its job: split messages into `HEADERS` and `DATA` frames tagged with stream identifiers and process received frames in the order they arrive ✅[^rfc9113], via the connection's single frame sequence.
- **HPACK encoder and decoder** — its job: compress and decompress header blocks, via one connection-wide context per direction ✅[^rfc9113]; a header block must be sent as a contiguous run of frames with no frames of other streams in between ✅[^rfc9113].
- **TLS record layer** — its job: encrypt the byte stream, via records of at most 16,384 plaintext bytes, each protected as one unit ✅[^rfc8446]; TLS needs a reliable, in-order transport underneath ✅[^rfc8446].
- **TCP** — its job: deliver one reliable, in-order byte stream ✅[^rfc9293], via sequence numbers, cumulative ACKs and retransmission; a receiver ACKs out-of-order segments at once ✅[^rfc5681], and the sender retransmits after 3 duplicate ACKs ✅[^rfc5681].

### 4.2 HTTP/3 stack: 5 actors

- **Application** — its job: the same as in HTTP/2, via the HTTP/3 library's API.
- **HTTP/3 framing layer** — its job: carry each request/response on its own bidirectional QUIC stream ✅[^rfc9114], and connection-wide signals (`SETTINGS`, `GOAWAY`) on a unidirectional control stream ✅[^rfc9114].
- **QPACK encoder and decoder** — its job: compress headers, via dynamic-table updates sent on a separate encoder stream (type 0x02) and acknowledgments sent back on a decoder stream (type 0x03) ✅[^rfc9204].
- **QUIC** — its job: streams, flow control, loss recovery and encryption, via `STREAM` frames that carry per-stream byte ranges ✅[^marx], packets protected one by one ✅[^rfc9001], and packet numbers that are never reused ✅[^rfc9000].
- **UDP/IP** — its job: carry QUIC packets, via UDP datagrams; several QUIC packets may share one datagram, and each is processed separately ✅[^rfc9000].

### 4.3 Settings that change HoL behaviour

| Setting (who sets it) | Default / unset behaviour | Effect on HoL blocking |
|---|---|---|
| HTTP/2 `SETTINGS_HEADER_TABLE_SIZE` (decoder) | 4,096 bytes ✅[^rfc9113] | None of its own: HPACK cannot block beyond TCP's own ordering |
| HTTP/2 `SETTINGS_MAX_CONCURRENT_STREAMS` (receiver) | No limit at first ✅[^rfc9113] | More concurrent streams means more streams stalled by one TCP loss |
| HTTP/2 `SETTINGS_INITIAL_WINDOW_SIZE` (receiver) | 65,535 bytes ✅[^rfc9113]; applies to streams only ✅[^rfc9113] | A small stream window stalls that stream only |
| HTTP/2 connection window | 65,535 bytes; `SETTINGS` cannot change it, only `WINDOW_UPDATE` frames can ✅[^rfc9113] | A small connection window lets one unread stream starve all others |
| HTTP/2 priority signals (RFC 7540 tree) | Deprecated by RFC 9113 ✅[^rfc9113] | Replaced by RFC 9218 (below) |
| QPACK `SETTINGS_QPACK_MAX_TABLE_CAPACITY` (decoder) | 0: no dynamic table until the peer's `SETTINGS` say otherwise ✅[^rfc9204] | 0 means only static-table references and literals, which never risk HoL blocking ✅[^rfc9204] |
| QPACK `SETTINGS_QPACK_BLOCKED_STREAMS` (decoder) | 0 ✅[^rfc9204] | Upper bound on request streams allowed to wait for dynamic-table updates; exceeding it is connection error `QPACK_DECOMPRESSION_FAILED` ✅[^rfc9204]. With 0, no stream may risk blocking, so the encoder may reference only acknowledged entries: this follows from the rule that the encoder must keep the number of streams that could block within this limit at all times ✅[^rfc9204] |
| QUIC `initial_max_data` (receiver) | 0 if absent ✅[^rfc9000] | Connection-wide limit; credit used by one stream is unavailable to the others ✅[^rfc9308] |
| QUIC `initial_max_stream_data_*` (receiver) | 0 if absent ✅[^rfc9000] | Per-stream limit; stalls that stream only |
| QUIC `initial_max_streams_bidi` (receiver) | Absent or 0: the peer cannot open bidirectional streams until a `MAX_STREAMS` frame arrives ✅[^rfc9000] | Caps concurrent requests, like HTTP/2's concurrent-streams limit |
| QUIC `max_ack_delay` (receiver) | 25 ms ✅[^rfc9000] | Longer ACK delay can slow loss detection, hence how long a gap blocks ⚠️ unverified (inference) |
| QUIC loss detection (sender) | Packet threshold 3 ✅[^rfc9002]; time threshold 9/8 of an RTT ✅[^rfc9002] | Sets how long a gap stays open before the retransmission is sent; same order as TCP's 3 duplicate ACKs ✅[^rfc9002] |
| RFC 9218 `urgency` and `incremental` (client hint) | Urgency 3, incremental false ✅[^rfc9218] | Non-incremental responses should be sent one after another, incremental ones of equal urgency should share bandwidth ✅[^rfc9218]; this choice decides how many streams one loss touches (§6) |

Effect cells without their own marker are reasoning from the mechanisms in §2 and §3, not statements found in a source ⚠️ unverified.

---

## 5. One lost packet, step by step

**Set-up (the same for both stacks).** Three responses, A, B and C, of 4 packets each. The server sends them round-robin, one packet per millisecond: slot 0 is `A1` at 0 ms, slot 1 is `B1` at 1 ms, and so on to slot 11, `C4`, at 11 ms. One-way delay 25 ms, so RTT 50 ms. Slot 4 (`B2`) is lost. Both stacks detect it the same way: the sender treats a packet as lost once a packet sent 3 slots later is acknowledged ✅[^rfc9002] ✅[^rfc5681].

**Diagram: what the receiver sees, and when it may hand data to the application.**

```
receiver clock (ms):   25  26  27  28  29  30  31  32  33  34  35  36   ...   82
arrives:               A1  B1  C1  A2  --  C2  A3  B3  C3  A4  B4  C4         B2 (retransmitted)
                                       ^ B2 lost on the way

HTTP/2 over TCP: one ordered byte stream
  to application:      A1  B1  C1  A2  |__ C2 A3 B3 C3 A4 B4 C4 held in TCP's buffer __| B2 + all 7 at 82

HTTP/3 over QUIC: ordered per stream
  stream A:            A1          A2          A3          A4                  -> A done at 34
  stream B:                B1                     [B3 held]   [B4 held]       B2 B3 B4 at 82
  stream C:                    C1          C2          C3          C4          -> C done at 36
```

**Timeline (local work vs. network marked on each step):**

1. **Server application → HTTP layer (server, local):** hands over responses A, B, C.
   - HTTP/2: the framing layer cuts `DATA` frames with stream identifiers; TLS seals them into records; TCP numbers the bytes.
   - HTTP/3: each response goes onto its own QUIC stream; QUIC puts `STREAM` frames into packets and encrypts each packet.
2. **Server → network, 0–11 ms:** 12 packets leave, one per millisecond. *This is the first network boundary.*
3. **Network, 4–29 ms:** slot 4 (`B2`) is dropped. The other 11 arrive at 25–36 ms (slot number + 25 ms).
4. **Receiver transport, 30–36 ms (client, local):** 7 packets arrive above the gap.
   - TCP: sends a duplicate ACK for each ✅[^rfc5681]; cannot pass their bytes up, because its service is in-order ✅[^rfc9293]. TLS cannot finish a record whose bytes have not been delivered; HTTP/2 sees nothing new.
   - QUIC: passes `C2`, `A3`, `C3`, `A4`, `C4` to streams C and A at once, because ordering is per stream ✅[^rfc9000]; holds `B3` and `B4` in stream B's buffer (up to its flow-control limit ✅[^rfc9000]).
5. **Receiver → sender, network:** ACKs travel back. The ACK triggered by slot 7 (sent at 7 ms, received at 32 ms) reaches the server at 57 ms. That is the third ACK above the gap, so both stacks declare slot 4 lost.
6. **Sender, 57 ms (server, local, then network):**
   - TCP: retransmits the missing bytes with their original sequence numbers.
   - QUIC: sends `B2`'s frame in a *new* packet with a new packet number ✅[^rfc9000], so the ACK for it cannot be confused with the original ✅[^rfc9002].
7. **Receiver, 82 ms (57 + 25):** the retransmission arrives.
   - TCP: the gap closes; all 8 waiting packets go up at once; A, B and C all complete at 82 ms.
   - QUIC: stream B's gap closes; B completes at 82 ms. A completed at 34 ms and C at 36 ms.

---

## 6. Worked example: the numbers

The figures below come from a small deterministic model run locally (§12). The model applies the same loss recovery to both stacks and changes only the ordering rule, so every difference comes from HoL blocking alone. It is a model, not a measurement of real stacks.

**Column meanings.** *Done* is when the last byte of a response reaches the application. *HoL wait* adds up, over a stream's packets, how long each packet sat in a receive buffer after it had arrived; for example, in S1 A's packets in slots 6 and 9 arrive at 31 and 34 ms and are released at 82 ms: (82 − 31) + (82 − 34) = 51 + 48 = 99 packet-ms.

| Scenario | Stream | HTTP/2 done (ms) | HTTP/3 done (ms) | HTTP/2 HoL wait (packet-ms) | HTTP/3 HoL wait (packet-ms) |
|---|---|---|---|---|---|
| S0: round-robin, no loss | A / B / C | 34 / 35 / 36 | 34 / 35 / 36 | 0 / 0 / 0 | 0 / 0 / 0 |
| S1: round-robin, slot 4 (`B2`) lost | A / B / C | 82 / 82 / 82 | **34** / 82 / **36** | 99 / 97 / 147 | 0 / 97 / 0 |
| S2: sequential, slot 4 (`B1`) lost | A / B / C | 28 / 82 / 82 | 28 / 82 / **36** | 0 / 153 / 190 | 0 / 153 / 0 |
| S3: sequential, slot 1 (`A2`) lost | A / B / C | 79 / 79 / 79 | 79 / **32** / **36** | 103 / 194 / 178 | 103 / 0 / 0 |
| S5: round-robin, slot 4 carries frames of B **and** C, lost | A / B / C | 82 / 82 / 82 | **34** / 82 / 82 | 99 / 97 / 147 | 0 / 97 / 147 |

**What the rows show:**
- **S1 vs. S0:** one loss delays every HTTP/2 response by 46–48 ms (A: 82 − 34 = 48; C: 82 − 36 = 46). Under HTTP/3 only B, the stream that lost data, is late.
- **S2:** with sequential sending, A had finished before the loss, so the loss can only hurt B and C. HTTP/3 saves C (82 → 36 ms) and nothing else. HoL removal helps only streams that are active at the same time ✅[^marx].
- **S3:** the loss is in A. If A is a render-blocking file (a stylesheet, say), the page still waits until 79 ms in both stacks; HTTP/3 only lets B and C finish early. Resources that must be complete before use (JavaScript, CSS (Cascading Style Sheets) files, fonts) gain less than progressive ones ✅[^marx].
- **S5:** one QUIC packet carried frames of two streams, so one loss blocked two streams, the same as HTTP/2 for C.

**The TLS record effect (S4).** Same as S1, but HTTP/2's 12 packets form one TLS record of about 14 KB (below the 16 KB maximum). Under HTTP/2, A's first byte now reaches the application at 82 ms instead of 25 ms, because no byte of a record can be used before the whole record is decrypted ✅[^rfc8446]: here the loss delays even data that arrived *before* it. Under HTTP/3 nothing changes (first data at 25, 26, 27 ms), because each QUIC packet is decrypted on its own ✅[^rfc9001]. How large real records are depends on the server; many servers start a connection with small records ⚠️ unverified.

**Random loss.** 6 streams × 10 packets, 20,000 trials per row, each packet lost independently with the given probability (model R1, §12):

| Loss rate | Scheduling | HTTP/2 mean "done" (ms) | HTTP/3 mean "done" (ms) | Saved by HTTP/3 (ms) | Trials where HTTP/2 was later for at least one stream |
|---|---|---|---|---|---|
| 0.01% | round-robin | 81.62 | 81.52 | 0.10 | 0.5% |
| 0.01% | sequential | 59.10 | 59.05 | 0.05 | 0.5% |
| 0.1% | round-robin | 82.96 | 81.76 | 1.20 | 5.8% |
| 0.1% | sequential | 60.06 | 59.47 | 0.59 | 4.6% |
| 1% | round-robin | 93.42 | 84.00 | 9.42 | 43.2% |
| 1% | sequential | 68.68 | 63.62 | 5.06 | 38.7% |
| 2% | round-robin | 102.39 | 86.50 | 15.89 | 68.6% |
| 2% | sequential | 76.27 | 67.90 | 8.37 | 62.3% |
| 5% | round-robin | 116.58 | 92.97 | 23.61 | 94.6% |
| 5% | sequential | 90.10 | 78.59 | 11.51 | 86.8% |

How to read it:
- **Without loss**, round-robin streams finish at 79–84 ms (mean 81.5) and sequential ones at 34, 44, … 84 ms (mean 59), so sequential is faster on average for *whole* responses in both stacks.
- **The benefit is the gap between the two "done" columns**, and it grows with the loss rate: 0.10 ms at 0.01% and 15.89 ms at 2% (round-robin).
- **Round-robin gains more from HTTP/3** than sequential (15.89 vs. 8.37 ms at 2%), because more streams are in flight when a loss happens, which matches the cited measurement findings in §11.
- **The last column is close to "at least one loss happened":** 1 − (1 − p)^60 for 60 packets is 0.6% at p = 0.01% and 95.4% at p = 5%; it is a little lower in the model because some losses fall where HTTP/3 has no advantage (the last packet sent, for example).

---

## 7. Header compression: HPACK vs. QPACK

**Mechanism.** Both formats keep a static table (fixed, known to both sides) and a dynamic table (entries the encoder inserts during the connection). A reference to a dynamic entry is decodable only if the decoder has already processed the insertion.

- **HPACK in HTTP/2.** The insertion is part of an earlier header block on the same connection. TCP delivers blocks in order and HTTP/2 processes frames in order ✅[^rfc9113], so the insertion always arrives first. HPACK relies on that in-order delivery, which QUIC does not provide ✅[^rfc9114]; used over QUIC it would cause HoL blocking for header fields ✅[^rfc9204].
- **QPACK in HTTP/3.** Insertions travel on the encoder stream; request streams carry references. Because QUIC does not order data across streams, a request stream can arrive before the insertion it references ✅[^rfc9204]. The field section then names a *Required Insert Count*, the number of insertions needed to decode it; if the decoder has seen fewer, the stream is blocked until they arrive ✅[^rfc9204].
- **The trade-off is the encoder's choice.** Referencing entries still in flight compresses better but can block on loss or reordering; referencing only acknowledged entries never blocks but may force literals ✅[^rfc9204]. Static-table references and literals need no dynamic state and never risk HoL blocking ✅[^rfc9204]. QPACK's stated goal is compression close to HPACK's with much less HoL blocking ✅[^rfc9204].

**Worked example (model Q1, §12).** Four requests share one header (a cookie, say). Slot 0 carries the dynamic-table insertion, slots 1–3 carry requests 2–4; the packet in slot 0 is lost and its retransmission arrives at 78 ms (slot 3 sent at 3 ms, its ACK back at 53 ms, retransmission arrives 25 ms later).

| Request | HPACK over TCP: decoded at (ms) | QPACK, references to unacknowledged entries allowed | QPACK, `SETTINGS_QPACK_BLOCKED_STREAMS = 0` |
|---|---|---|---|
| req1 (in the lost packet) | 78 | 78 | 78 |
| req2 | 78 | 78 (blocked on the insertion) | 26 (header sent as a literal) |
| req3 | 78 | 78 | 27 |
| req4 | 78 | 78 | 28 |

Allowing references gives the same 78 ms as HPACK for every request; forbidding them unblocks requests 2–4, at the cost of sending the full header again in each.

**Related QPACK risks:**
- *Flow-control deadlock:* a decoder may withhold flow-control credit on a request stream until encoder-stream data arrives, while the encoder-stream data itself waits for credit. The encoder should not write an instruction unless there is credit for all of it ✅[^rfc9204].
- *Cancelled streams:* when a stream is reset, the decoder sends a Stream Cancellation instruction so the encoder stops counting that stream's references ✅[^rfc9204].
- *Literals cost bytes:* larger field sections can make the encoder wait on congestion or flow-control limits instead ✅[^rfc9204].

---

## 8. What HTTP/3 does not remove

| Remaining blocking | Why | Source |
|---|---|---|
| Inside one stream | QUIC delivers each stream in order, and HTTP/3 does not use out-of-order delivery | ✅[^marx] ✅[^rfc9114] |
| One download, one stream | No other stream exists to benefit; data that can be processed independently should go on separate streams | ✅[^rfc9308] |
| Several streams' frames in one lost packet | One packet may carry frames of several streams | ✅[^rfc9000] (model S5) |
| Shared connection flow control | Credit consumed by one stream cannot be used by others; interdependent streams can deadlock | ✅[^rfc9308] |
| Shared congestion control | One controller per path for all streams, so a loss on any stream lowers the sending rate for all | ✅[^rfc9002] ✅[^rfc9114] (the "lowers the rate for all" step is inference ⚠️ unverified) |
| QPACK blocked streams | Up to `SETTINGS_QPACK_BLOCKED_STREAMS` request streams may wait for the encoder stream | ✅[^rfc9204] |
| Control-stream ordering | `PRIORITY_UPDATE` travels on the control stream and can arrive before the request stream it refers to; servers should buffer it | ✅[^rfc9218] |
| UDP blocked by the network | Then clients should fall back to TCP-based HTTP ✅[^rfc9114], and HTTP/2's HoL blocking returns; 3% to 5% of networks blocked all UDP in 2016-era measurements | ✅[^rfc9308] |

---

## 9. Cross-side interactions

| A change on this side | What it does to the other side | HoL consequence |
|---|---|---|
| Client sets `SETTINGS_QPACK_BLOCKED_STREAMS = 0` | Server's encoder must not reference unacknowledged entries in response headers ✅[^rfc9204] | No QPACK blocking on responses; larger response headers |
| Client keeps `SETTINGS_QPACK_MAX_TABLE_CAPACITY` at its default 0 | Server's encoder cannot use the dynamic table at all ✅[^rfc9204] | No QPACK blocking; static table and literals only |
| Server advertises blocked streams > 0, client encoder references in-flight entries | Server's decoder may hold requests | Request headers can block on a lost encoder-stream packet (Q1) |
| Server schedules round-robin instead of sequential | Client receives many streams at once | A loss touches more streams: worse under HTTP/2, a bigger relative gain under HTTP/3 (R1) ✅[^sander_blog] |
| Client marks a response `incremental` (RFC 9218) | Server should share bandwidth between same-urgency incremental responses ✅[^rfc9218] | Same as round-robin for those responses |
| Receiver lets one stream go unread while the connection window is small | Sender runs out of connection credit (HTTP/2 window, QUIC `MAX_DATA`) | All streams stall, in both versions ✅[^rfc9308]; HTTP/2 also requires endpoints to read frames promptly to avoid deadlock ✅[^rfc9113] |
| Sender packs frames of several streams into one QUIC packet | Receiver cannot prevent it | One loss blocks all streams in that packet (S5) ✅[^rfc9000] |
| Network path blocks UDP | Client falls back to TCP ✅[^rfc9114] | HTTP/2 behaviour, with all of §3's HTTP/2 column |
| Receiver delays ACKs (`max_ack_delay`, default 25 ms ✅[^rfc9000]) | Sender learns of losses later | Gaps stay open longer ⚠️ unverified (inference) |

---

## 10. Edge cases and failure combinations

| Situation | HTTP/2 over TCP | HTTP/3 over QUIC | Why |
|---|---|---|---|
| No loss, no reordering | Same as HTTP/3 for HoL | Same | Ordering rules only matter when something is missing (S0) |
| One large file | Blocked on each loss | Blocked on each loss | One stream: per-stream ordering is total ordering ✅[^rfc9308] |
| Many small parallel responses, random loss | Every loss stalls all | A loss stalls only the affected streams | Model S1, R1 ✅[^rfc9114] |
| Bursty loss (several packets in a row) | All stall | Many streams hit at once; gains fall, below the sequential baseline at burst size 5 in one testbed | ✅[^sander_blog] |
| High bandwidth | Little difference | Little difference | Most data arrived during slow start (the sender's initial ramp-up of its sending rate), before any loss, in one testbed at 10 Mbps (megabits per second) ✅[^sander_blog] |
| Loss inside a render-blocking resource | Page waits | Page waits | The resource itself is late either way (S3) ✅[^marx] |
| Packet reordering without loss | Data above the gap waits until the late packet arrives | Only that stream waits | Same ordering rules as for loss ⚠️ unverified (inference from §3) |
| A lost packet inside a large TLS record | Data *before* the loss in that record also waits | n/a | Record decrypted as a whole (S4) ✅[^rfc8446] |
| Lost encoder-stream packet, blocked streams > 0 | n/a | Referencing request streams wait for it | ✅[^rfc9204] (Q1) |
| More blocked streams than the decoder allowed | n/a | Connection error `QPACK_DECOMPRESSION_FAILED` | ✅[^rfc9204] |
| One stream never read by the application | Connection window drains, all streams stall; deadlock risk if frames are not read | Connection limit drains, all streams stall | ✅[^rfc9113] ✅[^rfc9308] |
| UDP blocked | n/a | Fallback to TCP-based HTTP | ✅[^rfc9114] ✅[^rfc9308] |
| CPU-bound receiver | n/a | Per-packet encryption costs more CPU; one reason QUIC was slower than TCP in some implementations in 2020 | ✅[^marx] |

---

## 11. How much it matters in practice

- **Loss is rare on many networks.** One estimate: about 0.01% on wired networks and rarely above 2% on cellular; loss is also bursty, which makes it hard to predict which streams a loss hits ✅[^marx]. In R1, 0.01% loss gives HTTP/3 a mean advantage of 0.10 ms.
- **An expert view (2020):** removing HoL blocking "probably won't actually help all that much" for most web performance; HTTP/3's expected speed-ups come mainly from other features, such as 0-RTT connection set-up and lower overhead ✅[^marx]. The author based this on early experiments, before final measurements existed ✅[^marx]. (0-RTT means a returning client sends its first request together with its first handshake packet instead of a round trip later ⚠️ unverified.)
- **A 2022 testbed study (35 replayed websites, Chromium):** parallel scheduling strategies clearly reduced HoL-blocked bytes; SpeedIndex (a score for how quickly the visible page fills in) improved only a little for the median site at low bandwidth, and mainly for larger sites under random loss; at 10 Mbps differences vanished; bursty loss erased the gains ✅[^sander_blog]. The authors' advice: keep sequential scheduling for typical low-loss, low-RTT, high-bandwidth conditions, and switch carefully to a parallel strategy on lossy, low-bandwidth links ✅[^sander_blog].
- **When to expect a real gain:** many concurrent streams, lossy or low-bandwidth links, independent random losses, and resources that are useful before they finish. When to expect none: one large stream, clean links, bursty loss, render-blocking resources sent sequentially.

---

## 12. The local experiment

- **What:** a deterministic model, `hol_model.py`, standard library only, run with Python 3.13.7 on 2026-11-22. Output saved as `results.txt` next to it.
- **How to run:** `python3 -I hol_model.py` in `research/_golden/SE-02/baseline/experiments/` (about 9 s, mostly the 200,000 trials of R1).
- **Assumptions:**
  - one packet per millisecond, one-way delay 25 ms;
  - immediate ACKs; loss declared when the third later packet is acknowledged, as in RFC 9002 and RFC 5681;
  - retransmissions are never lost, and the R1 sweep treats a lost final packet like any other (real stacks need a probe timeout there);
  - no congestion-window reduction after a loss (it would slow both stacks alike).
- **What it shows:** only the ordering rules (TCP byte stream, TLS record, QUIC per-stream) and their effect on when data may reach the application.
- **What it does not show:** real kernel or QUIC-library behaviour, CPU cost, handshake time, congestion control, or browser rendering. Treat the numbers as an illustration of the mechanism, not as a benchmark.

---

## 13. Verification

- **Verified on 2026-11-22:** every claim marked verified, against the sources in References, read live that day: the IETF RFCs, one practitioner article, one online book chapter and one research blog post.
- **Produced locally, not sourced:** every number in §5–§7 and §11's "0.10 ms" comes from the model in §12. The arithmetic is shown next to each one.
- **Unverified (general knowledge or inference):** the HTTP/1.1 cells of §3 other than transport ordering; the TCP and TLS handshake order; servers starting connections with small TLS records; the effects of `max_ack_delay` and of reordering without loss; the step from "one congestion controller per path" to "a loss slows every stream"; the definition of 0-RTT.
- **Not covered:**
  - Multipath QUIC, and datagram-based extensions (unreliable delivery);
  - Linux kernel or library tuning for TCP (for example, selective-ACK settings) or QUIC;
  - the effect of HoL blocking on gRPC or WebSocket traffic in particular.

## References

- [RFC 9113: HTTP/2](https://www.rfc-editor.org/rfc/rfc9113.html) — IETF, 2022. Backs: §1 frame size, dynamic table, flow control; §2 HTTP/1.1 and TCP HoL statements; §3; §4.1 frame order, HPACK context, contiguous field blocks; §4.3 settings, defaults, connection window, deprecated priorities; §7 in-order frame processing; §9, §10 prompt reading and deadlock. [^rfc9113]
- [RFC 9114: HTTP/3](https://www.rfc-editor.org/rfc/rfc9114.html) — IETF, 2022. Backs: §1 one stream per request; §2 TCP stall of all transactions, QUIC stream independence, redesign of HPACK and priorities; §3; §4.2 control stream; §7 HPACK's reliance on in-order delivery; §8–§10 fallback to TCP, no out-of-order delivery, connection-wide congestion control. [^rfc9114]
- [RFC 9000: QUIC](https://www.rfc-editor.org/rfc/rfc9000.html) — IETF, 2021. Backs: §1 retransmission in new frames; §2 no order across streams; §3; §4.2 packet numbers never reused, coalesced packets processed separately; §4.3 transport-parameter defaults; §5 per-stream delivery and buffering up to the flow-control limit; §8, §9 several streams in one packet. [^rfc9000]
- [RFC 9001: Using TLS to Secure QUIC](https://www.rfc-editor.org/rfc/rfc9001.html) — IETF, 2021. Backs: §3 no TLS record protection, per-packet AEAD, handshake dependency on the client Finished message; §4.2; §6 S4. [^rfc9001]
- [RFC 9002: QUIC Loss Detection and Congestion Control](https://www.rfc-editor.org/rfc/rfc9002.html) — IETF, 2021. Backs: §1 congestion controller per path; §4.3 packet threshold 3 and time threshold 9/8; §5 loss detection, no retransmission ambiguity; §8 shared congestion control. [^rfc9002]
- [RFC 9204: QPACK](https://www.rfc-editor.org/rfc/rfc9204.html) — IETF, 2022. Backs: §1 dynamic table capacity; §3; §4.2 encoder and decoder streams; §4.3 QPACK settings and defaults; §7 blocked streams, Required Insert Count, trade-off, deadlock, Stream Cancellation; §8–§10. [^rfc9204]
- [RFC 9218: Extensible Prioritization Scheme for HTTP](https://www.rfc-editor.org/rfc/rfc9218.html) — IETF, 2022. Backs: §4.3 urgency and incremental defaults and scheduling advice; §8 `PRIORITY_UPDATE` reordering; §9. [^rfc9218]
- [RFC 9308: Applicability of the QUIC Transport Protocol](https://www.rfc-editor.org/rfc/rfc9308.html) — IETF, 2022. Backs: §4.3 shared connection credit; §8 single-stream use, deadlocks, UDP blocking rates; §9, §10. [^rfc9308]
- [RFC 9293: Transmission Control Protocol (TCP)](https://www.rfc-editor.org/rfc/rfc9293.html) — IETF, 2022. Backs: §1 no message boundaries; §3 in-order byte stream; §4.1; §5 step 4. [^rfc9293]
- [RFC 5681: TCP Congestion Control](https://www.rfc-editor.org/rfc/rfc5681.html) — IETF, 2009. Backs: §4.1 immediate ACK of out-of-order segments, fast retransmit after 3 duplicate ACKs; §5. [^rfc5681]
- [RFC 8446: TLS 1.3](https://www.rfc-editor.org/rfc/rfc8446.html) — IETF, 2018. Backs: §1 record size limit; §3, §4.1 per-record protection, in-order transport requirement; §6 S4; §10. [^rfc8446]
- [RFC 9112: HTTP/1.1](https://www.rfc-editor.org/rfc/rfc9112.html) — IETF, 2022. Backs: §2 pipelining order, HoL blocking as a reason for several connections; §3. [^rfc9112]
- [Head-of-Line Blocking in QUIC and HTTP/3: The Details](https://calendar.perfplanet.com/2020/head-of-line-blocking-in-quic-and-http-3-the-details/) — Robin Marx, Web Performance Calendar, 2020. Backs: §1 definition, TLS record spanning about 11 packets, scheduling; §2 six connections; §3 TLS record HoL, packet mixing, in-stream order; §4.2 byte ranges per stream; §6 who benefits; §8 in-stream order; §10 CPU cost; §11 loss rates and the expert view. [^marx]
- [Why QUIC: TCP head of line blocking](https://http3-explained.haxx.se/en/why-quic/why-tcphol) — HTTP/3 explained, Daniel Stenberg, living. Backs: §2 HTTP/2 worse than HTTP/1.1 at about 2% loss; §3 HTTP/1.1 loss stalls only one connection. [^h3explained]
- [HTTP/3 and QUIC: prioritization and head-of-line blocking](https://blog.apnic.net/2022/11/30/http-3-and-quic-prioritization-and-head-of-line-blocking/) — Constantin Sander, APNIC Blog, 2022 (summary of the authors' paper at TMA 2022, the Network Traffic Measurement and Analysis Conference, "Analyzing the Influence of Resource Prioritization on HTTP/3 HOL Blocking and Performance"). Backs: §9 scheduling; §10 bursty loss, high bandwidth; §11 testbed results and advice. [^sander_blog]
- `research/_golden/SE-02/baseline/experiments/hol_model.py` — the deterministic model behind §5–§7 (scenarios S0–S5, Q1, R1).
- `research/_golden/SE-02/baseline/experiments/results.txt` — its full output from the 2026-11-22 run.

## Related

- `knowledge/linux/networking/tcp-connection-lifecycle.md` — the TCP connection HTTP/2 runs on: states, handshake, close.
- `knowledge/linux/networking/packet-path.md` — where an arrived packet waits (the socket receive buffer) before the application reads it; TCP HoL blocking happens there.
- `knowledge/grpc/stale-connection-keepalive.md` — gRPC multiplexes calls over one HTTP/2 connection, so one TCP loss stalls every call on that channel.
