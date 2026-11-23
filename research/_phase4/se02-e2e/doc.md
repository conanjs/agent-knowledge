---
schema: deep-dive/v1
topic: web-apis
status: verified
applies-to: ["HTTP/2 (RFC 9113)", "HTTP/3 (RFC 9114)", "QUIC version 1 (RFC 9000)", "QPACK (RFC 9204)", "H2O ≥ 2.1", "quiche 0.22.0", "Node.js 24.22.1 (probe)"]
last-updated: 2026-11-22
last-verified: 2026-11-22
synthesized-into: []
tags: [http2, http3, quic, head-of-line-blocking, hpack, qpack, flow-control, tcp, udp]
ranked-sources: true
---

# Head-of-line blocking in HTTP/2 and HTTP/3

## Summary

**TL;DR:** HTTP/2 multiplexes many requests over TCP (Transmission Control Protocol), and because TCP's loss recovery cannot see that multiplexing, a lost or reordered packet stalls every active transaction, including those the lost packet did not directly affect ✅[^rfc9114]. HTTP/3 runs over QUIC ✅[^rfc9114], where a lost packet blocks only the streams that had data in it ✅[^rfc9000]. Head-of-line (HOL) blocking does not disappear in HTTP/3: it remains inside a single stream, in packets that carry several streams, in QPACK header compression when the decoder allows it, and in the congestion controller the whole connection shares (§6.1).

**Use this when:** you need to explain why one lost packet slows every request on an HTTP/2 connection, judge whether HTTP/3 will help on a lossy network or a fast one, tell a HOL stall apart from a flow-control stall, or set QPACK and HTTP/2 window limits.

**Depth:** HOL blocking at the HTTP/1.1, TCP, QUIC-stream and header-compression layers; the stream, frame and flow-control model of HTTP/2 and of HTTP/3 over QUIC; QPACK blocked streams step by step; worked loss examples and a Node.js probe; the specs' MUST, SHOULD and default values; measured results (loss thresholds, fast-network CPU cost, UDP (User Datagram Protocol) blocking) and the conflicts between sources. Not covered: the QUIC handshake and 0-RTT (sending data in the first flight), connection migration, congestion-control algorithms, prioritization (RFC 9218), server push, and server or CDN (content delivery network) configuration.

## 1. Mental model

**Head-of-line (HOL) blocking** happens when the item at the front of a queue holds up every item behind it. Analogy: a single-lane tunnel where one broken-down car stops every car behind it, including those heading for other exits. Concrete case: under HTTP/2, a lost TCP packet carrying CSS bytes holds back JavaScript bytes that have already arrived behind it (§4.1).

### 1.1 The problem: HOL blocking moved down a layer

- **Application layer (HTTP/1.x).** HTTP/1.0 allowed only one outstanding request at a time on a TCP connection. HTTP/1.1 added request pipelining, which only partly addressed concurrency and still suffers from application-layer HOL blocking, so HTTP/1.0 and HTTP/1.1 clients open several connections to a server ✅[^rfc9113].
- **Transport layer (TCP).** HTTP/2 addresses this by allowing messages to be interleaved on the same connection, but RFC 9113 also notes that "TCP head-of-line blocking is not addressed by this protocol" ✅[^rfc9113]. TCP's loss recovery cannot see HTTP/2's parallel streams, so a lost or reordered packet stalls all active transactions, whether or not the lost packet carried their data ✅[^rfc9114]. §6.2 explains an overview sentence of RFC 9113 that seems to say otherwise.

### 1.2 The thesis: HTTP/3 makes the stream, not the connection, the unit that blocks

HTTP/3 hands multiplexing to QUIC, which provides reliability per stream and congestion control across the entire connection ✅[^rfc9114]. QUIC has no way to order bytes on different streams ✅[^rfc9000], so the in-order rule behind TCP HOL blocking now applies to one stream at a time. Four kinds of blocking remain, all listed in §6.1: a gap inside one stream, a lost packet that carried several streams, QPACK blocked streams, and one congestion controller for the whole connection.

Back to the analogy: QUIC turns the tunnel into a road with one lane per stream. A breakdown stops only its own lane. A wide truck straddling two lanes (one packet carrying two streams) blocks both lanes, and every lane still shares one speed limit (the connection's congestion controller).

### 1.3 Scope

This doc compares HTTP/2 over TCP with HTTP/3 over QUIC version 1, as the IETF (Internet Engineering Task Force) specifies them in RFCs (Requests for Comments), including header compression and flow control where they cause or mimic HOL blocking. HTTP/1.1 appears only as the starting point. Version-independent HTTP semantics, TCP connection states and the kernel receive path are in other docs (Related).

## 2. Concept architecture

| Part | HTTP/2 over TCP | HTTP/3 over QUIC |
|---|---|---|
| Stream | An independent, bidirectional sequence of frames inside one HTTP/2 connection. Many can be open at once, and either endpoint interleaves their frames ✅[^rfc9113] | A unidirectional or bidirectional channel of ordered bytes inside a QUIC connection, which can carry many streams at the same time ✅[^rfc9000] |
| Where order is guaranteed | Across all frames of all streams | Within each stream only. RFC 9114 sums it up: HTTP/2 "provides an absolute ordering between frames across all streams, while QUIC provides this guarantee on each stream only" ✅[^rfc9114] |
| Header compression | HPACK (RFC 7541): each endpoint has one encoder context and one decoder context for all field blocks on the connection, and the dynamic table is each context's main state ✅[^rfc9113] | QPACK (RFC 9204; "a name, not an abbreviation"): a dynamic table, a first-in, first-out list of field lines that encoder and decoder share. It starts empty, and the encoder fills it with instructions sent on the encoder stream ✅[^rfc9204] |
| Flow control | Credit-based: with WINDOW_UPDATE frames, receivers advertise how many octets they will accept on a stream and on the whole connection ✅[^rfc9113] | Limit-based, at two levels: stream flow control and connection flow control ✅[^rfc9000] |

HTTP/3 also has streams that serve the connection itself: a control stream, and a QPACK encoder stream and decoder stream. Their rules are in §5.3.

**Kinds of HOL blocking** used in this doc:

| Kind | Where | Section |
|---|---|---|
| Application-layer | HTTP/1.x on one connection | §1.1 |
| Transport-layer | TCP under HTTP/2: a lost packet holds back the later bytes of the whole connection | §3.1, §4.1 |
| Within a stream | QUIC: a byte gap in one stream holds back that stream's later bytes | §6.1 |
| Header compression | HPACK over an unordered transport; QPACK "blocked" streams | §3.3 |
| Shared congestion control | One congestion controller per connection, in TCP and in QUIC | §3.5 |

## 3. How it works

### 3.1 HTTP/2: TCP hands bytes over only in order

1. HTTP/2 interleaves frames of many streams into one TCP byte stream (§2). TCP's in-order guarantee means that after a packet loss, all the data that follows the loss on the connection must wait for the loss to be repaired before HTTP can see it ✅[^fastly].
2. HTTP/2 framing relies on that order too: recipients process frames in the order they are received, and the order of HEADERS and DATA frames is semantically significant ✅[^rfc9113].
3. HPACK adds a second dependence on order. Encoded field sections must arrive and be decoded in the order they were encoded, which keeps the dynamic state of both endpoints in sync ✅[^rfc9114]. §5.1 lists the MUST rules RFC 9113 sets on field blocks.

### 3.2 HTTP/3: QUIC orders each stream on its own

1. QUIC multiplexes by interleaving STREAM frames from several streams into QUIC packets, and one packet can carry STREAM frames from one or more streams. The receiver uses each STREAM frame's Stream ID and Offset fields to put the data in order ✅[^rfc9000], buffering out-of-order data up to the flow-control limit it advertised (§5.2).
2. When a packet is lost, only the streams with data in that packet wait for the retransmission, and the other streams can continue making progress. When one packet carried data from several streams, losing it blocks all of them, so RFC 9000 advises putting as few streams as necessary in each outgoing packet without losing efficiency to underfilled packets ✅[^rfc9000].
3. QUIC allows out-of-order delivery within a stream, but HTTP/3 does not use it ✅[^rfc9114].

### 3.3 QPACK: compression with a bounded, chosen risk of blocking

Analogy: an order slip that says "the usual, as in entry 7" cannot be filled until the note that defined entry 7 arrives, and that note travels on a different delivery van.

1. If HTTP/3 used HPACK, it would cause HOL blocking of field sections, because HPACK assumes a total ordering of frames across all streams ✅[^rfc9204].
2. QPACK instead makes every change to the dynamic table on a single unidirectional stream, which keeps those updates in a total order. Frames that carry encoded fields only reference the table's state at a given time ✅[^rfc9114].
3. References to the static table and literal representations never risk HOL blocking. A reference to the dynamic table risks it while the encoder has no acknowledgment that the entry is available at the decoder ✅[^rfc9204].
4. Each encoded field section carries a **Required Insert Count**: one more than the largest absolute index it references in the dynamic table, or zero when it references none. The decoder's **Insert Count** is the total number of entries inserted in its dynamic table ✅[^rfc9204].
5. Because QUIC does not guarantee order between data on different streams, a decoder might meet a reference to an entry it has not received yet. When the Required Insert Count is less than or equal to the decoder's Insert Count, the field section can be processed immediately; otherwise the stream it arrived on becomes **blocked** ✅[^rfc9204].
6. A blocked stream becomes unblocked when the Insert Count is greater than or equal to the Required Insert Count of every encoded field section the decoder has started reading on it ✅[^rfc9204].
7. The encoder chooses its risk. If SETTINGS_QPACK_BLOCKED_STREAMS permits it, referencing entries still in transit can often improve compression, but on loss or reordering the stream can become blocked at the decoder. Referencing only acknowledged entries avoids blocking but may mean literals, and the larger field sections can leave the encoder blocked on congestion or flow-control limits ✅[^rfc9204].
8. The decoder sets the ceiling with SETTINGS_QPACK_BLOCKED_STREAMS, and the encoder picks its risk below it (§5.3).

### 3.4 Flow control: a stall that looks like HOL blocking

Analogy: flow control is a budget the receiver hands the sender. When the budget runs out, the sender stops, even on a perfect network, and from the outside that stop looks like blocking.

1. In HTTP/2 only the DATA frame payload is flow controlled. In HTTP/3 every frame travels on a QUIC stream, so all frame headers and payloads are flow controlled ✅[^rfc9114].
2. If an endpoint cannot make sure its peer always has more flow-control credit than the peer's bandwidth-delay product (BDP: bandwidth times round-trip time) on the connection, flow control limits its receive throughput, and packet loss can leave gaps in the receive buffer that keep the application from consuming data and freeing buffer space ✅[^rfc9000].
3. QPACK and flow control can deadlock each other. A decoder might withhold flow-control credit on a request stream until the encoder stream delivers the updates it needs. If credit on the encoder stream, or on the connection, in turn depends on consuming that request stream, a deadlock might result ✅[^rfc9204]. The rule that avoids it is in §5.3.

### 3.5 Congestion control: still one controller per connection

Congestion control works per TCP or QUIC connection, not per stream. One loss slows HTTP/2's single connection, while HTTP/1.1 with 6 connections slows only the one that lost a packet, and in QUIC a loss on any stream slows every stream of the connection ✅[^marx].

## 4. Worked examples

### 4.1 One lost packet: HTTP/2 over TCP against HTTP/3 over QUIC

The setup, from one practitioner's figures: a JavaScript file on stream 1 and a CSS file on stream 2, sent in three packets. Packet 2 carries only stream 2 data and packet 3 carries data for both streams. Over TCP, when packet 2 is lost, TCP keeps packet 3 in its receive buffer until the retransmitted copy of packet 2 arrives, at least one round trip later, so both streams wait although stream 1's DATA frame in packet 3 was usable ✅[^marx].

| Same loss over QUIC | What happens |
|---|---|
| Packet 2 lost | QUIC hands over stream 1's STREAM frame in packet 3 at once (byte 450 follows byte 449) and holds only stream 2, whose bytes 0–299 were in the lost packet ✅[^marx] |
| Packet 1 lost | TCP would hold packets 2 and 3 even though the CSS on stream 2 is complete in them; QUIC passes stream 2 to the browser and holds only stream 1 ✅[^marx] |

### 4.2 Two streams, one burst of 8 lost packets

The same author models one burst of 8 lost packets while 2 streams download. When the streams are sent one after the other, QUIC's HOL removal barely helps, because the packets received after the loss belong to the stream that lost data. When they are multiplexed and, by chance, all 8 losses hit one stream, the other stream can be processed. When the losses are spread over both streams, both are HOL blocked, each because it still has to be put in order by itself ✅[^marx].

The catch: sending multiplexed (12121212) is what lets HTTP/3 profit from HOL removal, while sending sequentially (11112222) lets browsers process core resources sooner, and the author calls these two recommendations conflicting ✅[^marx].

### 4.3 A QPACK encoder that never blocks: quiche 0.22.0

Both QPACK settings default to zero (§5.3). The QPACK encoder of quiche 0.22.0 does without the dynamic table:

1. It writes a Required Insert Count of 0 and a Base of 0 at the start of every encoded field section, and encodes each field line in one of three ways: a static-table index, a literal with a static name reference, or a fully literal line. Its `Encoder` struct has no fields ✅[^quiche].
2. A Required Insert Count of 0 is never greater than the decoder's Insert Count, so by rule 5 of §3.3 every such field section can be processed immediately ✅[^rfc9204]. The price is the one step 7 of §3.3 names: literals make field sections larger.

### 4.4 Probe: three HTTP/2 requests share one TCP connection

The precondition for TCP HOL blocking is that all streams share one connection. This probe opens one Node.js `http2` client session, sends three requests at once, and counts the TCP connections the server accepts.

```js verify id=probe-01 runtime=node24 expect="stdout:ids=1,3,5 sockets=1"
const http2 = require('node:http2');
const server = http2.createServer();
let sockets = 0;
server.on('connection', () => { sockets++; });
server.on('stream', (stream) => {
  stream.respond({ ':status': 200 });
  stream.end('ok');
});
server.listen(0, '127.0.0.1', () => {
  const client = http2.connect(`http://127.0.0.1:${server.address().port}`);
  const ids = [];
  for (const path of ['/a', '/b', '/c']) {
    const req = client.request({ ':path': path });
    req.resume();
    req.on('end', () => {
      ids.push(req.id);
      if (ids.length === 3) {
        console.log(`ids=${ids.sort((x, y) => x - y).join(',')} sockets=${sockets}`);
        client.close();
        server.close();
      }
    });
    req.end();
  }
});
```

On Node.js 24.22.1 (image `node:24.22.1-alpine`, kernel `7.2.12-orbstack-00394-gbecdd6130068`), the three requests arrived on one TCP connection and got HTTP/2 stream IDs 1, 3 and 5 ✅[^probe-01]. This is one run on one machine, not a rule, and no probe here can show packet loss. For comparison, HTTP/3 puts a client's first request on QUIC stream 0 and later ones on streams 4, 8 and so on ✅[^rfc9114].

## 5. Reference & invariants

### 5.1 HTTP/2 (RFC 9113)

| Item | Rule or value |
|---|---|
| Field block framing | Field blocks MUST be transmitted as a contiguous sequence of frames, with no interleaved frames of any other type or from any other stream ✅[^rfc9113] |
| CONTINUATION | A HEADERS frame without the END_HEADERS flag set MUST be followed by a CONTINUATION frame for the same stream. A receiver MUST treat any other frame type, or a frame on a different stream, as a connection error of type PROTOCOL_ERROR ✅[^rfc9113] |
| Decompression | A receiver MUST terminate the connection with a connection error of type COMPRESSION_ERROR if it does not decompress a field block, and a decoding error in a field block MUST be treated as a COMPRESSION_ERROR connection error ✅[^rfc9113] |
| Initial windows | 65,535 octets for new streams and 65,535 octets for the connection. SETTINGS_INITIAL_WINDOW_SIZE adjusts the value for new streams; the connection window can only be changed with WINDOW_UPDATE frames ✅[^rfc9113] |
| Window limit | The sender MUST NOT send a flow-controlled frame whose length exceeds the space available in either the stream or the connection flow-control window ✅[^rfc9113] |
| Reading | Endpoints MUST read and process HTTP/2 frames from the TCP receive buffer as soon as data is available. Reading late could lead to a deadlock when critical frames such as WINDOW_UPDATE are not read and acted on ✅[^rfc9113] |

### 5.2 QUIC (RFC 9000)

| Item | Rule or value |
|---|---|
| Ordered delivery | Endpoints MUST be able to deliver stream data to an application as an ordered byte stream, which requires buffering out-of-order data up to the advertised flow-control limit. Implementations MAY offer out-of-order delivery to the application ✅[^rfc9000] (HTTP/3 does not use it, §3.2) |
| Limits | Senders MUST NOT send data in excess of either the stream or the connection limit. MAX_STREAM_DATA carries the maximum absolute byte offset of one stream; MAX_DATA carries the maximum of the sum of absolute byte offsets over all streams ✅[^rfc9000] |
| Blocked sender | A sender that has sent data up to its limit is blocked and SHOULD send STREAM_DATA_BLOCKED or DATA_BLOCKED. Since a blocked sender is not required to send them, a receiver MUST NOT wait for those frames before sending MAX_STREAM_DATA or MAX_DATA ✅[^rfc9000] |
| Initial stream limits | If the transport parameters that set initial per-stream limits are absent, streams of that type start with a flow-control limit of 0 ✅[^rfc9000] |

### 5.3 HTTP/3 (RFC 9114) and QPACK (RFC 9204)

| Item | Rule or value |
|---|---|
| Unidirectional stream budget | The transport parameters of clients and servers MUST allow the peer to create at least three unidirectional streams (the control stream plus the two QPACK streams), and SHOULD give each unidirectional stream at least 1,024 bytes of flow-control credit ✅[^rfc9114] |
| Critical streams first | Endpoints SHOULD create the HTTP control stream and the unidirectional streams of mandatory extensions, such as the QPACK encoder and decoder streams, first, then other streams as the peer allows ✅[^rfc9114] |
| Control stream | The sender MUST NOT close the control stream, and closing either control stream at any point MUST be treated as a connection error of type H3_CLOSED_CRITICAL_STREAM (0x0104). Endpoints SHOULD give enough flow-control credit to keep the peer's control stream from becoming blocked ✅[^rfc9114] |
| QPACK streams | An encoder stream is unidirectional stream type 0x02 and a decoder stream type 0x03. Each endpoint MUST initiate at most one of each, the sender MUST NOT close either, and closing either MUST be treated as a connection error of type H3_CLOSED_CRITICAL_STREAM ✅[^rfc9204] |
| Settings | `SETTINGS_QPACK_MAX_TABLE_CAPACITY` (0x01) defaults to zero and is the counterpart of HTTP/2's SETTINGS_HEADER_TABLE_SIZE; `SETTINGS_QPACK_BLOCKED_STREAMS` (0x07) defaults to zero ✅[^rfc9204] |
| Blocked-stream limit | An encoder MUST limit the number of streams that could become blocked to the value of SETTINGS_QPACK_BLOCKED_STREAMS at all times. A decoder that meets more blocked streams than it promised to support MUST treat this as a connection error of type QPACK_DECOMPRESSION_FAILED ✅[^rfc9204] |
| While blocked | Encoded field section data SHOULD remain in the blocked stream's flow-control window ✅[^rfc9204] |
| Deadlock rule | An encoder SHOULD NOT write an instruction unless sufficient stream and connection flow-control credit is available for the entire instruction ✅[^rfc9204] |

### 5.4 Server knobs: H2O

Since version 2.1, H2O's HTTP/2 latency optimization tries to keep unsent HTTP/2 frames as small as possible on TCP connections whose round-trip time (RTT) is greater, and whose congestion window (CWND) is smaller, than configured thresholds. The thresholds default to `http2-latency-optimization-min-rtt: 50` (milliseconds; 4294967295 disables the optimization), `http2-latency-optimization-max-additional-delay: 0.1` (a ratio to RTT) and `http2-latency-optimization-max-cwnd: 65535` (octets), and the optimization is supported only on Linux and OS X, which provide `TCP_INFO` and `TCP_NOTSENT_LOWAT` ✅[^h2o].

## 6. Trade-offs, pitfalls & misconceptions

### 6.1 "HTTP/3 removes HOL blocking"

It removes HOL blocking *across* streams whose data was not lost. Four kinds remain:

- **One stream at a time.** QUIC keeps byte order within a stream, so a byte gap holds back the later parts of that stream. Its HOL removal therefore helps only when several streams are active at once, and a lone active stream is still HOL blocked by any loss ✅[^marx].
- **Several streams in one packet.** Losing such a packet blocks all of them (§3.2).
- **QPACK.** A request stream blocks when it references dynamic-table entries the decoder has not received, up to the SETTINGS_QPACK_BLOCKED_STREAMS ceiling (§3.3).
- **Congestion control.** One controller per connection, so loss on any stream slows all of them (§3.5).

RFC 9114's overview says that streams "are independent of each other, so one stream that is blocked or suffers packet loss does not prevent progress on other streams" ✅[^rfc9114]. Read alone, this seems to contradict RFC 9000 and RFC 9204, all three Rank 1; the more detailed Rank 1 texts settle it. RFC 9000 adds that a lost packet blocks every stream with data in it (§3.2), and RFC 9204 defines the QPACK case (§3.3). The overview sentence holds for a stream whose *own* data was lost.

An edge case over TCP: if a TLS (Transport Layer Security) record is spread over 11 TCP packets and the last one is lost, the record cannot be decrypted until the retransmission arrives, even though no TCP HOL blocking occurs in that case. The author calls it a highly specific case, and avoiding it is part of the reason QUIC encrypts each packet on its own rather than using TLS records ✅[^marx].

### 6.2 "HTTP/2 streams are independent"

RFC 9113's overview says HTTP/2 streams "are largely independent of each other, so a blocked or stalled request or response does not prevent progress on other streams" ✅[^rfc9113]. Read with the rest of the RFC, this is about the HTTP layer: the same RFC says TCP HOL blocking is not addressed, and RFC 9114 says a lost or reordered packet stalls all active HTTP/2 transactions (§1.1). The Rank 1 texts agree once the layer is named.

### 6.3 HTTP/2 against HTTP/1.1 under loss

A 2016 study reported by Fastly found that the higher the packet loss, the worse HTTP/2 performed against HTTP/1. The post puts this mostly down to HTTP/2 using one TCP connection for all exchanges, and to how packet loss interacts with TCP's congestion control and in-order delivery. Its rough rule of thumb: connections below 0.5% loss benefited from HTTP/2, those between 0.5% and 1.5% gained about as much as they lost, and those above 1.5% were harmed ✅[^fastly]. Two disagreements between sources of the same rank remain, and no Rank 1 source settles either:

- ⚖️ open conflict: how often loss is high enough to matter.
  - Robin Marx (Web Performance Calendar, 2020, Rank 4): on high-speed, cabled networks loss is on the order of 0.01%, and even on the worst cellular networks rates above 2% are rare in practice ✅[^marx].
  - Fastly (2020, citing 2016 edge data, Rank 4): 75% of Fastly edge connections then fell in the loss range that HTTP/2 improved, and the rest split roughly evenly between hurt (above 1.5% loss) and unchanged ✅[^fastly].
  - The two use different thresholds (2% against 1.5%), populations and years.
- ⚖️ open conflict: whether, and why, HTTP/2 is slower than HTTP/1.1.
  - Robin Marx (Rank 4): as deployed, HTTP/2 is typically as fast as or slightly faster than HTTP/1.1 in most conditions, in his opinion partly because sites got better at optimizing for HTTP/2 and partly because browsers often still open several parallel HTTP/2 connections ✅[^marx]. In some cases, especially on slower networks with more loss, HTTP/1.1 on 6 connections still beats HTTP/2 on one, often because of TCP HOL blocking ✅[^marx].
  - Cloudflare (2020, Rank 4): uploading a 10MB object over a network with 200Mbps of bandwidth and a 40ms RTT, with Cloudflare's production configuration, HTTP/2 measured almost half the speed of HTTP/1.1, while at 5Mbps upload and 20ms RTT the two were almost identical ✅[^cfupload]. The bottleneck was HTTP/2 flow control: the application layer runs its own receiver flow control, and NGINX uses a fixed-size receive buffer, which limits upload speed when the link's BDP is larger than the request body buffer ✅[^cfupload].

The Cloudflare case is also the first thing to check when an HTTP/2 transfer is slow on a clean, fast link: a window smaller than the BDP stalls the sender (§3.4) even when no packet is lost, and from the outside that stall looks like HOL blocking.

### 6.4 The sender's own queue

HOL blocking can also start on the sending side. For an HTTP/2 server to switch quickly to a high-priority response, H2O says the TCP send buffer should hold only the packets in flight, and TLS records must be small enough to avoid HOL blocking; the cost is more CPU (processor) cycles and slightly higher latency ✅[^h2o]. H2O's knobs for this are in §5.4.

### 6.5 HTTP/3 is not always faster

- Fastly (2020): HTTP/3 might not significantly affect performance for the average connection, or affect it at all, especially when the HTTP/2 session it is compared with has almost no packet loss and already follows best-practice TLS and TCP configuration ✅[^fastly].
- Robin Marx (December 2020, without final measurements): his gut feeling, backed by several early experiments, is that QUIC's HOL removal probably won't help Web performance much, and that it would probably have a large impact only on networks with a lot of packet loss ✅[^marx].
- Zhang et al. (WWW 2024, Rank 2): over fast Internet, the UDP+QUIC+HTTP/3 stack showed a data rate up to 45.2% lower than TCP+TLS+HTTP/2, and the gap grew with bandwidth; on Chrome, QUIC fell behind above about 500 Mbps and was 45.2% slower than HTTP/2 at 1 Gbps ✅[^zhang].
- The cause, per Zhang et al.: high receiver-side processing overhead, in particular excessive data packets and QUIC's user-space ACKs (acknowledgments). The kernel's UDP stack reads many more packets than TCP's because none of the QUIC implementations they examined uses UDP generic receive offload (GRO) ✅[^zhang].

Partly resolved conflict on QUIC's CPU cost: Robin Marx (2020, Rank 4) names per-packet encryption, which needs more CPU than encrypting larger blocks, as one of the main reasons QUIC can still be slower than TCP in current implementations ✅[^marx]. Zhang et al. (Rank 2) govern the measured main cause, receiver-side processing (excessive data packets and user-space ACKs, with no UDP GRO, as above), and found that the cipher suite made no significant difference: both their stacks used the TLS_AES_128_GCM_SHA256 cipher, and benchmarking other cipher suites did not significantly change the results ✅[^zhang]. The cost of per-packet against per-record encryption that Marx raises is still untested, since their test varied cipher suites, not that.

### 6.6 UDP may be blocked: the fallback is HTTP/2

QUIC runs over UDP. A 2016 measurement study saw complete UDP blocking on about 2% to 4% of terrestrial access networks, concentrated in enterprise networks and in regions with otherwise challenged connectivity ✅[^edeline]. On the 1% to 5% of networks where QUIC packets over UDP are blocked or limited, HTTP/2's natural fallback to TLS over TCP can be used ✅[^edeline], and on those networks the TCP HOL blocking of §3.1 applies again.

### 6.7 Telling the stalls apart

Each row points to the section where its cause is stated and sourced.

| Symptom | Likely cause | What to check | Details |
|---|---|---|---|
| Every stream on an HTTP/2 connection stalls after one packet loss | TCP HOL blocking: TCP releases no later byte until the lost one is retransmitted | Whether retransmits line up with the stall | §1.1, §3.1, §4.1 |
| HTTP/2 is slow on a clean, fast link, worst on uploads | A flow-control window or receive buffer smaller than the BDP | The stream and connection windows and the server's request body buffer against bandwidth × RTT | §3.4, §6.3 |
| One HTTP/3 stream stalls while the others continue | A byte gap in that stream, or a QPACK blocked stream | Loss on that stream; whether its field sections reference dynamic-table entries not yet received, and the SETTINGS_QPACK_BLOCKED_STREAMS value | §3.2, §3.3, §6.1 |
| Several HTTP/3 streams stall together after one loss | One lost packet carried data of all of them | How many streams the sender packs into one packet | §3.2 |
| The whole HTTP/3 connection slows after a loss on one stream | One congestion controller per connection | Congestion-window drops on the connection | §3.5 |
| HTTP/3 is slower than HTTP/2 on a fast link | Receiver-side processing, with no UDP GRO | Client CPU during the download | §6.5 |
| HTTP/3 is never used on some networks | UDP blocked or limited, with fallback to HTTP/2 over TLS and TCP | Whether UDP gets through on that network | §6.6 |

## References

- [RFC 9000: QUIC: A UDP-Based Multiplexed and Secure Transport](https://www.rfc-editor.org/rfc/rfc9000.html) — IETF, 2021. Rank 1. Backs: QUIC streams and ordering, loss across streams, ordered delivery, flow control (Summary, §1.2, §2, §3.2, §3.4, §5.2). [^rfc9000]
- [RFC 9113: HTTP/2](https://www.rfc-editor.org/rfc/rfc9113.html) — IETF, 2022. Rank 1. Backs: HTTP/1.x and TCP HOL blocking, streams, HPACK state, flow control, field block and window rules (§1.1, §2, §3.1, §5.1, §6.2). [^rfc9113]
- [RFC 9114: HTTP/3](https://datatracker.ietf.org/doc/html/rfc9114) — IETF, 2022. Rank 1. Backs: HTTP/2 stalls under loss, delegation to QUIC, frame ordering, HPACK and QPACK, flow-control differences, stream rules (Summary, §1, §2, §3, §4.4, §5.3, §6.1). [^rfc9114]
- [RFC 9204: QPACK: Field Compression for HTTP/3](https://datatracker.ietf.org/doc/html/rfc9204) — IETF, 2022. Rank 1. Backs: QPACK dynamic table, Required Insert Count, blocked streams, settings and deadlock rules (§2, §3.3, §3.4, §4.3, §5.3). [^rfc9204]
- [HTTP/2 Directives - Configure - H2O](https://h2o.examp1e.net/configure/http2_directives.html) — H2O project, living. Rank 1. Backs: latency optimization, its defaults and platforms, send-buffer advice (§5.4, §6.4). [^h2o]
- [quiche/src/h3/qpack/encoder.rs at tag 0.22.0](https://github.com/cloudflare/quiche/blob/0.22.0/quiche/src/h3/qpack/encoder.rs) — Cloudflare quiche project, 2019 (file copyright; tag 0.22.0). Rank 1. Backs: an encoder with Required Insert Count 0 and no dynamic table (§4.3). [^quiche]
- [QUIC is not Quick Enough over Fast Internet](https://arxiv.org/html/2310.09423v2) — Zhang et al., Proceedings of the ACM Web Conference (WWW '24), 2024. Rank 2. Backs: QUIC throughput and its receiver-side cause on fast networks, the cipher test (§6.5). [^zhang]
- [Using UDP for Internet Transport Evolution](https://arxiv.org/html/1612.07816v1) — Edeline et al., ETH TIK Technical Report 366, 2016. Rank 2. Backs: UDP blocking rates and the HTTP/2 fallback (§6.6). [^edeline]
- [Head-of-Line Blocking in QUIC and HTTP/3: The Details](https://calendar.perfplanet.com/2020/head-of-line-blocking-in-quic-and-http-3-the-details/) — Robin Marx, Web Performance Calendar, 2020. Rank 4. Backs: loss walk-throughs, within-stream blocking, congestion control per connection, loss rates, TLS records, per-packet encryption (§3.5, §4.1, §4.2, §6). [^marx]
- [How HTTP/3 and QUIC aim to help the connections that need it most](https://www.fastly.com/blog/how-http3-and-quic-help-long-tail-connections) — Patrick McManus, Fastly, 2020. Rank 4. Backs: TCP in-order repair delay, 2016 loss thresholds and edge data, HTTP/3 and the average connection (§3.1, §6.3, §6.5). [^fastly]
- [Delivering HTTP/2 upload speed improvements](https://blog.cloudflare.com/delivering-http-2-upload-speed-improvements/) — Junho Choi, Cloudflare, 2020. Rank 4. Backs: HTTP/2 upload slowdown from flow control (§6.3). [^cfupload]
- `probes/probe-01.js` — verify, Node.js 24.22.1 (`node:24.22.1-alpine`), prints `ids=1,3,5 sockets=1`. [^probe-01]

## Related

- [Web APIs topic index](index.md) — RFC 9110 HTTP semantics, which do not depend on the HTTP version.
- [Network requests in depth](../javascript/browser/network-requests-in-depth.md) — the browser's per-host HTTP/1.1 connection limit, and HTTP/2 for many concurrent streams.
- [TCP connection lifecycle](../linux/networking/tcp-connection-lifecycle.md) — TCP states on Linux.
- [Packet path](../linux/networking/packet-path.md) — the kernel receive path, socket receive buffers and retransmits.
- [gRPC stale connection keepalive](../grpc/stale-connection-keepalive.md) — gRPC calls multiplexed over one long-lived HTTP/2 connection.
