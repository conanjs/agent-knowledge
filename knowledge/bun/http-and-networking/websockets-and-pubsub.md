---
schema: knowledge-doc/v1
type: concept
topic: bun/http-and-networking
status: verified
applies-to: ["Bun 1.4.5"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [bun, websocket, bun-serve, pubsub, topics, backpressure, permessage-deflate, idle-timeout, close-codes]
---

# WebSockets and pub/sub in Bun.serve

## Summary
**TL;DR:** Inside `fetch`, `server.upgrade(req, { data, headers })` turns an HTTP (Hypertext Transfer Protocol) request into a WebSocket: it returns `true` (return nothing; Bun sends `101 Switching Protocols`) or `false` (not an upgrade request; answer with a `Response`). One `websocket` object handles every socket's `open`, `message`, `close`, `drain`, `ping`, `pong` and `error`, and per-socket state lives in `ws.data`. Topics give built-in broadcast: `ws.publish` reaches every subscriber except the sender (unless `publishToSelf`), `server.publish` reaches all. `ws.send()` never throws: it returns the payload size, `-1` (queued, wait for `drain`) or `0` (dropped). Defaults: 16 MB message limit (`1009` close), 120 s idle timeout with automatic pings, 16 MB outgoing buffer, compression off.
**Use this when:** building chat, live dashboards or notifications on `Bun.serve`; debugging lost messages, `1006`/`1009` closes, a server that will not shut down, or compression that seems to do nothing.
**Not this doc:** routes, the `fetch` handler, `idleTimeout` for HTTP and `stop()` in general → [bun-serve.md](bun-serve.md); the `fetch` client, TCP (Transmission Control Protocol) and TLS (Transport Layer Security) options → [networking-apis-reference.md](networking-apis-reference.md).

## Problem
A WebSocket chat works in a demo, then misbehaves under real clients. `send()` to a slow reader silently drops messages because nobody checks its return value. The sender of a group message never sees its own line because `ws.publish` skips it. A 17 MB upload closes the connection with `1009`. `await server.stop()` never resolves because open sockets keep it alive. An `async` handler that throws crashes the process instead of reaching `error`. And because the browser's same-origin policy (the rule that stops a page from one site reading another site's responses) does not apply to the handshake, a page on another site can open a socket that carries the user's cookies, depending on their `SameSite` attribute.

## Mental model
**Analogy:** a radio switchboard. The front desk (`fetch`) decides who gets a line (`upgrade`) and pins a name badge to it (`data`). Topics are radio channels: a caller who speaks on a channel (`ws.publish`) is heard by everyone else tuned in, not by themselves; the station itself (`server.publish`) broadcasts to all. Every line has an outbox: while the listener reads slowly, letters pile up (`-1`); once the outbox is full, new letters go in the bin (`0`).

**Artifact** (three clients A, B and C in the lab) ✅[^lab]:
```ts
const server = Bun.serve({
  port: 0,
  fetch(req, server) {
    const name = new URL(req.url).searchParams.get("name") ?? "anon";
    if (server.upgrade(req, { data: { name } })) return;   // true: Bun sends the 101
    return new Response("upgrade() returned false", { status: 400 });
  },
  websocket: {
    data: {} as { name: string },                          // types ws.data in every handler
    open(ws) { ws.subscribe("room"); },
    message(ws, msg) { ws.publish("room", `${ws.data.name}: ${msg}`); },
  },
});
// plain GET /     -> 400 "upgrade() returned false"
// A sends "hello" -> B and C receive "A: hello"; A receives nothing
```

## How it works
Four actors take part:
- **The client** — its job: ask for the upgrade and exchange frames, via the `WebSocket` class (browser or Bun).
- **Your `fetch` handler** — its job: accept or refuse the upgrade, via `server.upgrade(req, { data, headers })`.
- **Bun's WebSocket layer** — its job: frame, compress, buffer and time out messages and keep topic lists, via native code built on uWebSockets ✅[^1].
- **Your `websocket` handlers** — their job: react to events on any socket, via one shared object ✅[^1].

```
client                    fetch handler            Bun WebSocket layer (native)          websocket handlers
GET + Upgrade ══ net ══▶  server.upgrade(req, {data, headers}) → true
                                            101 Switching Protocols + your headers ══▶ client
                                            socket {data, topics, outbox} ───────────▶ open(ws)
frame "hi" ══ net ════════════════════════▶ unmask, inflate, size check ─────────────▶ message(ws, "hi")
                                            ws.send / ws.publish / server.publish
                                            outbox: written → size | queued → -1 | full → 0
◀═══ net ══════════════════════════════════ frames (RSV1 bit set when compressed)
                                            idle timer: ping before idleTimeout, close if silent
close frame / timeout / stop(true) ──────────────────────────────────────────────────▶ close(ws, code, reason)
```

1. **The upgrade (fetch handler → Bun, then the network).**
   - `server.upgrade(req, opts)` returns `true` when the upgrade succeeds and `false` when it fails ✅[^3]; a plain `GET` returned `false` ✅[^lab]. After `true`, return nothing: Bun writes the `101` itself ✅[^1].
   - `headers` go into the `101`. The raw response read over TCP was `HTTP/1.1 101 Switching Protocols`, `set-cookie: sid=abc`, `X-Hello: 1`, `Upgrade: websocket`, `Connection: Upgrade`, `Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=` ✅[^lab] ✅[^1].
   - `data` becomes `ws.data`; you type it with `data: {} as T` inside `websocket`, which replaced the older `Bun.serve<T>` generic ✅[^1] ✅[^3].
   - The same-origin policy does not cover the handshake, so check the `Origin` header against an allowlist before upgrading (cross-site WebSocket hijacking) ✅[^1]. In Chromium 156 (`bunlab:2`), a page from `http://127.0.0.1:7700` opened `ws://localhost:7701/` on another origin: the server saw the `Origin` header `http://127.0.0.1:7700`, accepted, and the page read the reply ✅[^lab].
   - Upgrades work only on HTTP/1.1 requests ✅[^2]: a `wss://` client against `Bun.serve({ tls, http2: true, http1: false })` failed its TLS handshake with `TLSV1_ALERT_NO_APPLICATION_PROTOCOL`, while a server with `http2: true` and HTTP/1.1 still on kept upgrading ✅[^lab].
2. **Events (Bun → your handlers).**
   - Every handler is optional, and one object serves all sockets, which saves a closure per connection ✅[^1].
   - `message(ws, msg)` gets a string for text frames and, by default, a `Buffer` for binary ones (a 3-byte `Uint8Array` arrived as `Buffer(3)`) ✅[^lab] ✅[^3]; `ws.binaryType` selects `arraybuffer`, `uint8array` or `blob` instead ✅[^3]: set in `open`, a 3-byte message arrived as `ArrayBuffer`, `Uint8Array` and `Blob` (`size` 3) ✅[^lab].
   - `close(ws, code, reason)`: a client `close(4000, "bye")` arrived as `code=4000 reason="bye"` ✅[^lab].
   - Ping and pong (control frames that check the other side is alive, like "are you there?" / "yes"): a client `ping("cli-ping")` reached the server's `ping` handler and came back as a `pong` event without any code ✅[^lab] ✅[^3]. `ws.ping("srv-ping")` returned `8`, the Bun client saw a `ping` event and answered, and the server's `pong` handler got `srv-ping` ✅[^lab].
   - `error(error, ws)` (socket second) gets what another handler throws ✅[^1]: a throw in `message` arrived as `thrown by A` ✅[^lab]; a throw in `open` called `error` and closed the socket, and the client saw `1006` ✅[^lab] ✅[^1]. A rejected `async` handler skipped `error` and raised the process's `unhandledRejection` ✅[^lab] ✅[^1].
3. **Topics (Bun keeps the subscriber lists).**
   - `ws.subscribe("room")` returned `true`, `ws.subscriptions` was `["room"]`, and `server.subscriberCount("room")` rose 1, 2, 3 as clients joined ✅[^lab] ✅[^3].
   - `ws.publish("room", "A: hello")` returned `8` and reached B and C but not A ✅[^lab] ✅[^1]; with `publishToSelf: true` A received it too ✅[^lab] ✅[^3].
   - `server.publish("room", "from server", false)` reached all three and returned `11` ✅[^lab] ✅[^1]; to a topic with no subscribers it returned `0` ✅[^lab] ✅[^3].
   - A closed socket leaves its topics on its own: after A closed, the count was `2` ✅[^lab] ✅[^1].
4. **Backpressure (the outbox).** Backpressure is the signal that the receiver reads slower than you write, like a queue forming at a till when the cashier slows down.
   - `send()` returns the bytes sent (`1+`), `-1` when the message was queued under backpressure, or `0` when it was dropped because the socket is closed or already holds more than `backpressureLimit` ✅[^1] ✅[^3].
   - Lab: a client called `pause()`, the server sent 100 messages of 256 KB with `backpressureLimit: 1 MB`. Results: `262144×9, -1×5, 0×86`, `getBufferedAmount()` `1114252`, identical in three runs ✅[^lab]. The first nine (2.25 MB) were written to the socket at once; five more queued inside Bun, because the limit is checked before queueing, so the outbox can reach the limit plus one message ✅[^1]; the rest were dropped.
   - After the client's `resume()` it received 14 of 100 messages and the server's `drain` ran once ✅[^lab] ✅[^1].
   - With `closeOnBackpressureLimit: true` the same sends returned the same values, then the connection closed (`1006` on both sides) and the client received only 9: the 5 queued messages were lost and `drain` never ran ✅[^lab].
   - Inbound, `ws.pause()` and `ws.resume()` stop and restart reading, so a fast client feels TCP backpressure ✅[^1] ✅[^3]; the Bun client's `pause()` and `resume()` both returned `true` ✅[^lab] ✅[^1]. On the server, `ws.pause()` returned `undefined` and set `ws.isPaused` to `true`; a client then sent 200 messages of 64 KB, none reached `message`, and the client's `bufferedAmount` rose to 10,554,096; after `ws.resume()` all 200 arrived and `bufferedAmount` fell to `0` ✅[^lab].
   - The idle timeout is suspended while a socket is paused ✅[^1]: with `idleTimeout: 8` and `sendPings: false`, a paused socket was still open after 17 s, while an unpaused one closed at 8.0 s ✅[^lab].
   - Sends inside `message`, `open` and `drain` are batched automatically ("corked": held and written as one block, like posting a bundle instead of single letters); elsewhere, wrap them in `ws.cork(cb)` ✅[^3]. Traced with `strace` in `bunlab:2`: 100 `ws.send` calls inside `message` left the server as one `sendto` of 490 bytes, 100 calls in a `setTimeout` as 100 `sendto` calls, and the same 100 inside `ws.cork()` as one again ✅[^lab].
5. **Compression (permessage-deflate, the standard extension that compresses each message with deflate, the algorithm zip files use).**
   - Off by default ✅[^3]. With `perMessageDeflate: true` the `101` carried `Sec-WebSocket-Extensions: permessage-deflate; client_no_context_takeover; server_no_context_takeover`, and the Bun client, which offers it by default, showed the same in `ws.extensions`; a client created with `perMessageDeflate: false` showed `""` ✅[^lab] ✅[^1].
   - `ws.send` and `ws.publish` compress only with a final `true`; `server.publish` compresses unless you pass `false` ✅[^1] ✅[^3]. On the wire, the RSV1 bit (a reserved flag in the first byte of each frame) marks a compressed message ✅[^5]: 10,000 × `a` sent with `true` took 28 bytes, without it 10,000 bytes, and `server.publish` with no flag 28 bytes ✅[^lab].
   - `send()` returned `10000` in both cases: the return value is the payload size, not the bytes on the wire ✅[^lab].
   - The shared compressor resets after every message; a per-socket one (`perMessageDeflate: { compress: "16KB" }`) keeps context ✅[^1]. Read frame by frame with a raw client: a 1,000-byte text sent three times with `true` took 60, 60 and 60 bytes shared, but 59, 17 and 16 bytes with `"16KB"` (whose `101` offered `server_max_window_bits=11` instead of `server_no_context_takeover`). With `compress: "disable"` it went out as 1,000 bytes without RSV1 even with `true` ✅[^lab] ✅[^1].
6. **Limits and timeouts.**
   - `maxPayloadLength` defaults to 16 MB and applies after decompression ✅[^1] ✅[^3]. With `1024`, a 1024-byte message was accepted; a 1025-byte one closed the client with `1009 "Received too big message"`, while the server's `close` handler got `1006` and the same reason ✅[^lab] ✅[^1]. `1009` means "message too big" in the protocol ✅[^4]. With compression on, a raw client sent 5,000 × `a` as one 23-byte compressed frame and got the same `1009` close, while 1,000 × `a` in 12 bytes was delivered as 1,000 characters ✅[^lab].
   - `idleTimeout` defaults to 120 s, accepts `0` to `960`, and rounds `1`–`7` up to `8` ✅[^1] ✅[^3]. `961` threw `websocket expects idleTimeout to be 960 or less`; `0`, `960` and also `-1` were accepted ✅[^lab]. With `sendPings: false`: `1` → closed at 8.0 s, `8` → 8.0 s, `12` → 12.0 s, code `1006`, reason `WebSocket timed out from inactivity` ✅[^lab]. With the default `sendPings: true` and `idleTimeout: 8`, the client got 7 pings and was still open at 30 s ✅[^lab] ✅[^3].
   - `backpressureLimit` defaults to 16 MB; `0` means no limit ✅[^1]. To a paused client, 40 sends of 1 MiB gave, by default, 2 written, 17 queued (`-1`) and 21 dropped (`0`), with `getBufferedAmount()` at 17,301,694 (16 MiB plus one message); with `0`, 2 written, 38 queued, none dropped, 39,256,464 buffered ✅[^lab].
7. **Shutdown.** `server.stop()` leaves open sockets alone (B was still `OPEN` after it) and `server.stop(true)` closes each with `1001 "Server closed"`, seen by both the server's `close` handler and the clients ✅[^lab] ✅[^1]. `server.pendingWebSockets` was `2` with two sockets open ✅[^lab].
8. **The Bun client.** `new WebSocket(url, { headers, protocols, tls, proxy, perMessageDeflate })` is a Bun-only form that browsers reject ✅[^1]. The server saw `Authorization: Bearer t0k3n` and `Sec-WebSocket-Protocol: chat.v1`, and the client's `ws.protocol` was `chat.v1` ✅[^lab]. The client also has `ping()`, `pong()`, `terminate()` and `binaryType` `nodebuffer` by default ✅[^lab] ✅[^1]; it force-closes after 30 s if the server never answers a close (`BUN_CONFIG_WS_CLOSE_TIMEOUT`) ✅[^1]. Against a raw server that never answered a Close, the `close` event (code `1006`) came after 33.2–36.0 s (median 34.6 s of 5 runs); with `BUN_CONFIG_WS_CLOSE_TIMEOUT=2` after 5.2–8.0 s and with `=5` after 9.2–12.0 s, so the value is in seconds and the timer adds up to about two 4-second steps ✅[^lab].
   - `tls: { ca }` connected to a `wss://` server with the lab certificate, which failed the TLS handshake without it; `proxy` sent `wss://` and also `ws://` connections through a logging forward proxy as `CONNECT net-srv:8443` and `CONNECT net-srv:8080` ✅[^lab] ✅[^1].

## Worked example
One lab run of the chat server above with an `error` handler, three Bun clients and `publishToSelf: false` ✅[^lab]:

| # | Action | Observed |
|---|---|---|
| 1 | `fetch(server.url)` without upgrade headers | `400 upgrade() returned false` |
| 2 | A, B, C connect with `?name=` | server `open` logs `subscribers=1`, `2`, `3`; `remote=::1` |
| 3 | A sends `hello` | `ws.publish` returned `8`; B and C got `A: hello`; A got nothing |
| 4 | `server.publish("room", "from server", false)` | returned `11`; A, B and C got `from server` |
| 5 | A sends `new Uint8Array([1, 2, 3])` | server: `binary from A: Buffer(3)` |
| 6 | A calls `ping("cli-ping")` | server `ping` handler: `cli-ping`; A's `pong` event: `cli-ping` |
| 7 | A sends `throw`, the `message` handler throws | `error() handler: thrown by A`; the socket stays open |
| 8 | A calls `close(4000, "bye")` | server `close` code `4000`, reason `bye`, subscribers now `2` |
| 9 | `server.stop()` | B still `readyState 1` (open) |
| 10 | `server.stop(true)` | B and C closed with `1001 "Server closed"` |

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `ws.send("")`, `ws.ping()`, `ws.pong()` with no data | Return `0`, though they succeeded | An empty payload has zero bytes ✅[^lab] ✅[^1] |
| `server.publish` to many subscribers | One number: `0` if dropped for any, `-1` if backpressure for any, else bytes. With one fast and one paused subscriber, 20 × 256 KB returned `262144` ten times, `-1` five times, then `0`, while the fast one received all 20 ✅[^lab] | One status sums up all subscribers ✅[^3] |
| `publish` buffers per subscriber | A big message to many slow subscribers multiplies memory: after those 20, the paused subscriber held 1,245,334 bytes and the fast one 0 ✅[^lab] | Unsent bytes are kept per socket ✅[^1] |
| Client breaks the protocol | Close `1002`, `1007` or `1009`; your `close` handler sees `1006` and a description | Bun closes for the client ✅[^lab] ✅[^1] |
| `ws.close(1005)` or a code outside `1000`–`1003`, `1007`–`1014`, `3000`–`4999` | `0`/`1005`/`1006` send no code; other invalid codes show as `1006` in browsers ✅[^1]. Lab, `ws.close(code, "bye")`: the Bun client saw `1000` and `4000` with `bye`, `0`/`1005`/`1006` as `1005` with no reason, and `2000` and `1004` as `1006`; Chromium 156 saw `0`/`1005`/`1006` as `1005`, but `2000` and `1004` unchanged, with `bye` and `wasClean: true` ✅[^lab] | Clients accept only those ranges ✅[^1]; Chromium 156 did not enforce that for codes the server sent ✅[^lab] |
| Long close reason | Cut to 123 bytes of UTF-8 (the usual byte encoding of Unicode text): a 200-character reason arrived as 123 ✅[^lab] | A close frame is a control frame (at most 125 bytes), and the code takes 2 ✅[^1] ✅[^4] |
| `http1: false` on the server | No WebSocket upgrades at all: the `wss://` client failed the TLS handshake ✅[^lab] | `upgrade()` is HTTP/1.1-only ✅[^2] |
| `ws.readyState` on the server | Only `1` (open) or `3` (closed): `1` in `open`, `3` in `close` ✅[^lab] | A `ServerWebSocket` is never connecting or closing ✅[^3] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `perMessageDeflate: true` (shared compressor) | 10,000 repeated bytes → 28 on the wire ✅[^lab] | Processor time per message; short messages grow ✅[^1]: `"hi"` took 4 bytes compressed, 2 plain ✅[^lab] |
| Per-socket compressor (`compress: "16KB"` … `"256KB"`) | Better ratio, context kept across messages ✅[^1]: a repeated 1,000-byte text fell to 17 bytes ✅[^lab] | That much memory per connection ✅[^1]: with `"256KB"`, 1,000 connections that each got one compressed message grew the server by 273 MiB, about 280 KiB each, against about 6 KiB with the shared compressor or none (two runs) ✅[^lab] |
| Low `backpressureLimit` | Bounded memory per slow client | More `0` returns: silent loss unless you check ✅[^lab] |
| `closeOnBackpressureLimit: true` | A stuck client is disconnected instead of growing a backlog | Queued messages are lost with it ✅[^lab] |
| `sendPings: true` (default) | Idle but healthy clients stay connected ✅[^lab] | A ping every few seconds per idle socket: 7 in 30 s at `idleTimeout: 8` ✅[^lab] |

## Takeaways
- Check what `send()` and `publish()` return: `0` means the message is gone, `-1` means stop sending until `drain`. [rule-candidate]
- Check `Origin` against an allowlist before `server.upgrade()`. [rule-candidate]
- Wrap the body of every `async` WebSocket handler in `try`/`catch`; `error` only sees synchronous throws. [rule-candidate]
- Use `server.publish` (or `publishToSelf: true`) when the sender must see its own message, and pass `false` as the third argument for short messages.
- Call `server.stop(true)` at shutdown, or close sockets yourself, because `stop()` leaves WebSockets open.
- Wrap bursts of sends made outside `message`, `open` and `drain` (timers, other sockets' events) in `ws.cork()`; otherwise each send is its own system call. [rule-candidate]

## Verification status
- Verified: 124 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `linux/lab-setup.md` — the Bun 1.4.5 lab where every ✅[^lab] behaviour ran on 2026-11-24: the `oven/bun:1.4.5` image (arm64); `bunlab:1` (the same Bun plus OpenSSL 3.5.7, for the `wss://` certificates); `bunlab:2` (plus `strace` 6.13 and Chromium 156, for the corking trace, the cross-origin page and browser close codes); `node:24.22.1-alpine` for the logging forward proxy; and a Docker bridge network for the proxy and `http1: false` runs. [^lab]
- [WebSockets: docs/runtime/http/websockets.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/http/websockets.mdx) — Bun documentation source (Oven), 2026. Backs: upgrade and headers, `ws.data` typing, handlers, Origin warning, pub/sub, compression, backpressure, `pause`/`resume`, close codes, errors, timeouts and limits, the client `WebSocket`. [^1]
- [Server: docs/runtime/http/server.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/http/server.mdx) — Bun documentation source (Oven), 2026. Backs: `upgrade()` only on HTTP/1.1, `http1: false` refusing WebSockets. [^2]
- [packages/bun-types/serve.d.ts at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/packages/bun-types/serve.d.ts) — Bun source (Oven), 2026. Backs: `upgrade()` return value, `ServerWebSocketSendStatus`, `binaryType`, `cork`, `subscribe`, `publishToSelf`, `sendPings`, `perMessageDeflate` default, `server.publish` status, `readyState` values. [^3]
- [RFC 6455: The WebSocket Protocol](https://www.rfc-editor.org/rfc/rfc6455) — IETF, 2011. Backs: close code `1009`, the 125-byte limit on control frames. [^4]
- [RFC 7692: Compression Extensions for WebSocket](https://www.rfc-editor.org/rfc/rfc7692) — IETF, 2015. Backs: the RSV1 bit marking compressed messages. [^5]

## Related
- `bun/http-and-networking/bun-serve.md` — the server these sockets live in.
- `bun/http-and-networking/networking-apis-reference.md` — cookies (`Bun.CookieMap`) for identifying users at upgrade time, TLS options.
- `js-runtime/promise-rejections.md` — what an unhandled rejection from an `async` handler does.
- `linux/lab-setup.md` — the lab.
