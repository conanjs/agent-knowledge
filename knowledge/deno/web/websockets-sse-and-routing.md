---
schema: knowledge-doc/v1
type: concept
topic: deno/web
status: verified
applies-to: ["Deno 2.9.8", "@std/http 1.1.4"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [deno, websocket, upgradewebsocket, websocketstream, idle-timeout, server-sent-events, eventsource, last-event-id, urlpattern, routing, std-http, servedir, servefile, etag, range-requests]
ranked-sources: true
---

# WebSockets, server-sent events, routing and static files in Deno

## Summary
**TL;DR:** `Deno.upgradeWebSocket(request)` returns `{ socket, response }`: the handler must return that `response`, and then talks to the client through `socket`, a standard `WebSocket` that pings quiet clients and closes them after `idleTimeout` (30 seconds by default). The `WebSocket` client is a global; `WebSocketStream`, which adds backpressure, needs `--unstable-net`. Server-sent events (SSE) are a `ReadableStream` response with `content-type: text/event-stream`; the global `EventSource` reconnects on its own and sends `Last-Event-ID`. Route with the global `URLPattern`, or with `route` from `jsr:@std/http/unstable-route`; serve files with `serveDir` or `serveFile` from `jsr:@std/http/file-server`, which answer conditional requests (weak ETag, 304) and single byte ranges (206, 416).
**Use this when:** adding real-time messages (WebSocket or SSE) to a Deno server, matching URLs (web addresses) to handlers, serving a folder of static files, or debugging a socket that never opens or a cache that never hits.
**Not this doc:** `Deno.serve` itself, streaming bodies, TLS (Transport Layer Security) and shutdown → `deno/web/http-server.md`; the `@std` packages at large → `deno/std-and-jsr/standard-library.md`; `jsr:` specifiers → `deno/modules/module-specifiers-and-imports.md`; which web globals exist → `deno/fundamentals/web-platform-apis.md`.

## Problem
- A handler that calls `Deno.upgradeWebSocket` but returns some other response leaves the client hanging, and in Deno 2.9.8 it also stopped the whole server from accepting connections ✅[^run].
- A plain HTTP (Hypertext Transfer Protocol) request sent to a WebSocket route makes `Deno.upgradeWebSocket` throw ✅[^run].
- The `WebSocket` API (application programming interface) cannot apply backpressure, so a fast sender can flood a slow reader's memory ✅[^mdn-ws].
- An event stream with the wrong content type is rejected by the browser, and without event IDs (identifiers) a reconnecting client replays or loses events ✅[^sse-spec].
- Hand-written routing (`if (url.pathname.startsWith(…))`) and hand-written file serving miss methods, parameters, path-traversal checks, ETags and ranges that `@std/http` already handles ✅[^fs-src].

## Mental model
**Analogy:** one switchboard (`Deno.serve`) with three kinds of call. A normal call is question and answer. A WebSocket call is turned into an open intercom where both sides talk at any time, but only once you hand the operator the "switch over" slip (the 101 response). An SSE call is a radio broadcast on one long answer: only the station talks, and a listener whose signal drops re-tunes by itself and says the last song number it heard (`Last-Event-ID`). A receptionist (the router) reads each address and points it to a room, and an archive clerk (`serveDir`) checks whether you already hold the current copy (ETag) and can copy just pages 1 to 5 (a range).

| Term | Plain-English meaning | Concrete artifact |
|---|---|---|
| Upgrade | Turning one HTTP request into a WebSocket connection | response status `101` from `Deno.upgradeWebSocket` |
| Ping/pong, `idleTimeout` | "Still there?" frames; no answer in time closes the socket | `{ idleTimeout: 2 }` closed a silent client with code `1001` |
| `WebSocketStream` | A WebSocket whose messages are a readable and a writable stream | `const { readable, writable } = await wss.opened` |
| SSE (server-sent events) | One long HTTP response carrying text events from server to client | `id: 1\nevent: tick\ndata: {"n":1}\n\n` |
| `EventSource` | The client that parses SSE and reconnects | `new EventSource("http://127.0.0.1:8000/events")` |
| `URLPattern` | A web-standard matcher for URLs with named parts | `new URLPattern({ pathname: "/users/:id" })` |
| ETag (entity tag) | A version label for a response; a matching `If-None-Match` gets `304 Not Modified` | `W/"15-BKkBz8s/PQliMSz0bkkRyo5lIiA"` |
| Range request | A request for part of a file | `Range: bytes=0-4` → `206`, `content-range: bytes 0-4/21` |

**Artifact:** `app.ts` puts all three behind one router (run with `deno run --allow-net --allow-read=public app.ts`) ✅[^run]:
```ts
import { route, type Route } from "jsr:@std/http@1.1.4/unstable-route";
import { serveDir } from "jsr:@std/http@1.1.4/file-server";

const routes: Route[] = [
  { pattern: new URLPattern({ pathname: "/ws" }), handler: (req) => {
      if (req.headers.get("upgrade") !== "websocket") return new Response("upgrade required\n", { status: 426 });
      const { socket, response } = Deno.upgradeWebSocket(req);
      socket.onmessage = (e) => socket.send(`echo: ${e.data}`);
      return response;                      // must be returned, see Edge cases
  } },
  { pattern: new URLPattern({ pathname: "/events" }), handler: () => {
      const enc = new TextEncoder();
      let n = 0, timer: number;
      const body = new ReadableStream({
        start(c) { timer = setInterval(() => { n++; c.enqueue(enc.encode(`id: ${n}\ndata: tick ${n}\n\n`)); if (n === 2) { clearInterval(timer); c.close(); } }, 100); },
        cancel() { clearInterval(timer); },
      });
      return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
  } },
  { pattern: new URLPattern({ pathname: "/static/*" }), handler: (req) => serveDir(req, { fsRoot: "public", urlRoot: "static", quiet: true }) },
];
Deno.serve(route(routes, () => new Response("not found\n", { status: 404 })));
```
```text
$ curl -s http://127.0.0.1:8000/events
id: 1
data: tick 1

id: 2
data: tick 2

$ curl -s -o /dev/null -w "<path> -> %{http_code}\n" …   (three requests)
/static/hello.txt -> 200
/nope -> 404
/ws without upgrade -> 426
$ deno run --allow-net app_client.ts      # new WebSocket("ws://127.0.0.1:8000/ws"), send "hi"
ws: echo: hi
```

## How it works
**4 actors:**
- **The client** (`WebSocket`, `EventSource` or `curl`) — its job: open requests and read messages, via HTTP/1.1 to the server's port.
- **`Deno.serve`** — its job: turn each request into a `Request` and send back the `Response`, via the handler it was given (see `deno/web/http-server.md`).
- **The router** (`route` or your own `URLPattern` checks) — its job: pick one handler, via the URL pattern and the method.
- **The chosen handler** — its job: answer, via `Deno.upgradeWebSocket`, a `ReadableStream` event stream, or `serveDir`/`serveFile`.

```text
client ══ HTTP/1.1 request ══▶ Deno.serve ─▶ router: first URLPattern + method match
                                              ├─ /ws      → upgradeWebSocket → return response (101) ═▶ socket: message ⇄ send, ping/pong
                                              ├─ /events  → ReadableStream "text/event-stream"       ═▶ id/data events … end → client retries
                                              ├─ /static/*→ serveDir: 405 / 301 / 404 / 304 / 206 / 416 / 200
                                              └─ no match → default handler (404)
```

### WebSocket server: `Deno.upgradeWebSocket`
1. **Client → server (network).** The client sends `GET` with `Upgrade: websocket`; Deno supports WebSockets on HTTP/1.1 only for now ✅[^http-guide].
2. **Handler (local).** `Deno.upgradeWebSocket(req, { protocol?, idleTimeout? })` returns `{ socket, response }` ✅[^upgrade-api]. Measured before returning: `response.status = 101`, `socket.readyState = 0` (connecting) ✅[^run]. Reading the request body first makes the upgrade fail ✅[^upgrade-api].
3. **Handler → `Deno.serve` (local).** The upgrade happens only once that `response` is returned ✅[^upgrade-api]; then the server-side socket fired `open` with `readyState = 1` and `protocol = ""` ✅[^run].
4. **Messages (network, both ways).** The server received `"hello"` as a string and 3 bytes as an `ArrayBuffer`; the Deno client, whose `binaryType` defaults to `blob`, got the echoed bytes as a `Blob` ✅[^run].
5. **Close (network).** `ws.close(1000, "bye")` on the client gave the server `close code = 1000 reason = "bye" wasClean = true` ✅[^run].
6. **Idle check (server → client, network).** The server pings; if no pong arrives within `idleTimeout` seconds (default 30, `0` turns it off) the connection is closed as unhealthy ✅[^upgrade-api]. Measured with `idleTimeout: 2` and a raw TCP (Transmission Control Protocol) client that never answers: a ping frame at about 1 s, a close frame with code `1001` at about 2 s; the server got an `error` event `No response from ping frame.` and `close code = 1001`, `wasClean = false` ✅[^run].

Requests without `upgrade: websocket` should be answered before calling `upgradeWebSocket`; the docs' example returns `426` ✅[^ws-ex].

### WebSocket client and `WebSocketStream`
- `new WebSocket("ws://…")` opens an outbound connection; wait for `open` (`readyState` 1) before `send()`, which takes strings, `ArrayBuffer`, `Blob` or typed arrays ✅[^ws-out-ex]. The four events are `open`, `message`, `error` and `close` ✅[^mdn-ws].
- `WebSocket` has no way to apply backpressure ✅[^mdn-ws]. `WebSocketStream` gives `readable` and `writable` streams that do ✅[^mdn-wss] ✅[^wss-ex]; it is not part of any web standard yet ✅[^mdn-wss], and in Deno it is unstable and needs `--unstable-net` ✅[^wss-ex].
- Measured without the flag: `ReferenceError: WebSocketStream is not defined`, with the hint ``Run again with `--unstable-net` flag to enable this API.`` ✅[^run]. With it, `await wss.opened` gave the streams, one write and one read echoed `echo: hello`, and `await wss.closed` gave `{"closeCode":1000,"reason":"done"}` ✅[^run]. The server side stays a plain `Deno.upgradeWebSocket` ✅[^wss-ex].

### Server-sent events
- **Format.** UTF-8 (the standard Unicode text encoding) text; lines `data:`, `event:` (default type `message`), `id:` and `retry:` (milliseconds, digits only); a line starting with `:` is a comment; a blank line dispatches the event ✅[^sse-spec].
- **Server side in Deno.** Return a `ReadableStream` body with `content-type: text/event-stream` (the docs add `cache-control: no-store`), and clear the producer's timer in `cancel()` when the client leaves ✅[^sse-ex]. A client fails the connection when the type is wrong or the status is not 200 ✅[^sse-spec].
- **Client side.** `EventSource` is a global in Deno 2.9.8 (`typeof EventSource` is `function`) ✅[^run]. When the connection closes the client waits the reconnection time and retries, sending the last event ID in a `Last-Event-ID` header; a `204` response stops the retries ✅[^sse-spec]. The Worked example shows each step.
- **Keep-alive.** Some proxies drop idle connections; the standard suggests a comment line about every 15 seconds ✅[^sse-spec].

### Routing with `URLPattern` and `route`
`URLPattern` is a global in Deno ✅[^run] and Baseline 2025 in browsers ✅[^mdn-urlpattern]. It matches each URL part separately; parts left out of the dictionary match anything ✅[^urlpattern-spec]. Measured ✅[^run]:

| Pattern | Input | Result | Rule |
|---|---|---|---|
| `{ pathname: "/users/:id" }` | `/users/42?tab=1` | `exec(…).pathname.groups` = `{"id":"42"}` | `:name` is a named group matching one segment ✅[^urlpattern-ex] |
| same | `/users/42/posts` | `test` → `false` | one segment only |
| `{ pathname: "/static/*" }` | `/static/css/site.css` | groups `{"0":"css/site.css"}` | `*` crosses segments; unnamed groups get numeric keys from 0 ✅[^urlpattern-ex] |
| `/items/:id(\\d+)` | `/items/7`, `/items/abc` | `true`, `false` | a regular-expression group ✅[^urlpattern-spec] |
| `/products/:id?` | `/products`, `/products/2`, `/products/` | `true`, `true`, `false` | `?` makes a part optional ✅[^urlpattern-spec] |
| `/users/:id` | `/USERS/1` | `false`; `true` with `{ ignoreCase: true }` | case-sensitive by default ✅[^urlpattern-spec] |

`route(routes, defaultHandler)` from `jsr:@std/http/unstable-route` scans `{ pattern, method?, handler }` entries in order and calls the first match as `handler(request, params, info)`, where `params` is the `URLPatternResult`; an entry without `method` matches every method ✅[^route-src]. `route` is an alias of `routeLinear`; `routeRadix` builds a tree for larger tables ✅[^route-src]; all three are exported by 1.1.4 ✅[^run]. The module is unstable: its path is `unstable-route` ✅[^std-http], and each of its exports carries the tag `@experimental **UNSTABLE**: New API, yet to be vetted.` ✅[^route-src]. Measured with a `/users/:id` entry (no method) and a `POST /users` entry ✅[^run]:

| Request | Status and body |
|---|---|
| `GET /users/42` | `200 user 42` |
| `POST /users` | `201 created` |
| `GET /users` | `404 not found` (method mismatch falls to the default handler, not 405) |
| `DELETE /users/42` | `200 user 42` (no `method` listed, so every method matches) |
| `GET /nope` | `404 not found` |

Frameworks such as Hono (`jsr:@hono/hono`, served with `Deno.serve(app.fetch)`) ✅[^hono-ex] and Oak (`jsr:@oak/oak`, started with `app.listen`) ✅[^oak-ex] add middleware and routing on the same `Request`/`Response` model; this doc does not compare them.

### Static files with `serveDir` and `serveFile`
- **Calls.** `serveDir(req, opts)` serves a folder; `serveFile(req, path, opts)` serves one file ✅[^servedir] ✅[^servefile]. Both need read permission on the files ✅[^http-guide].
- **Options and defaults.** `fsRoot` `"."`, `urlRoot` (prefix stripped from the path), `showDirListing` `false`, `showDotfiles` `false`, `showIndex` `true`, `enableCors` `false`, `quiet` `false`, `etagAlgorithm` `"SHA-256"`, `headers` `[]` ✅[^servedir-opts].
- **ETag.** For a file it is weak, `W/"<size in hex>-<hash>"`, and the hash covers the modification time, not the content ✅[^etag-src]. Measured on a 21-byte file: `etag: W/"15-BKkBz8s/PQliMSz0bkkRyo5lIiA"` with `last-modified`, `accept-ranges: bytes` and `server: deno` ✅[^run].
- **Conditional requests.** A matching `If-None-Match` (compared weakly) gives `304`; without it, `If-Modified-Since` is checked ✅[^fs-src] ✅[^etag-src]. Both returned `304 Not Modified` ✅[^run].
- **Ranges.** One range of the form `bytes=a-b`, `bytes=a-` or `bytes=-b` gives `206` with `Content-Range`; an unsatisfiable one gives `416` with `bytes */<size>`; several ranges get the whole file with `200` ✅[^fs-src]. Measured: `bytes=0-4` → `206`, `content-range: bytes 0-4/21`, body `Hello`; `bytes=-7` → `bytes 14-20/21`, body `world!` and a newline; `bytes=100-200` → `416`, `content-range: bytes */21`; `bytes=0-1,5-6` → `200`, `content-length: 21` ✅[^run].
- **Safety and methods.** Methods other than `GET` and `HEAD` get `405`; a directory URL without a trailing slash gets `301`; dotfiles and paths that resolve outside the root get `404` ✅[^fs-src]. Measured: `POST` → `405`, `/static/sub` → `301` to `/static/sub/` (which served its `index.html`), `/static/.env` → `404`, `/static/..%2f..%2fetc/passwd` → `404`, `/static/` with no `index.html` and listing off → `404` ✅[^run].

## Worked example
An event stream that ends twice and then tells the client to stop. The server (`sse_server.ts`) numbers events, closes each stream after every second event, reads `Last-Event-ID` to resume, and answers its third connection with `204`:
```ts
let connection = 0;
Deno.serve({ onListen() {} }, (req) => {
  connection++;
  const lastId = req.headers.get("last-event-id");
  log(`connection ${connection}; Last-Event-ID = ${JSON.stringify(lastId)}; accept = ${JSON.stringify(req.headers.get("accept"))}`);
  if (connection === 3) return new Response(null, { status: 204 });   // stop reconnecting
  let n = lastId ? Number(lastId) : 0, timer: number;
  const body = new ReadableStream({
    start(c) {
      c.enqueue(enc.encode("retry: 500\n: comment lines start with a colon and are ignored\n\n"));
      timer = setInterval(() => {
        n++;
        c.enqueue(enc.encode(`id: ${n}\nevent: tick\ndata: {"n":${n}}\n\n`));
        if (n % 2 === 0) { clearInterval(timer); c.close(); log(`closed the stream after id ${n}`); }
      }, 200);
    },
    cancel() { clearInterval(timer); },
  });
  return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
});
```
(`log` and `enc` are a timestamped `console.log` and a `TextEncoder`.) Connection 1 was `curl -s -N -i`, which showed the raw stream ✅[^run]:
```text
HTTP/1.1 200 OK
content-type: text/event-stream
cache-control: no-store
transfer-encoding: chunked

retry: 500
: comment lines start with a colon and are ignored

id: 1
event: tick
data: {"n":1}

id: 2
event: tick
data: {"n":2}
```
Connections 2 and 3 came from `new EventSource(url)` with listeners for `open`, `tick` and `error` ✅[^run]:

| # | Actor | Quoted output | What it shows |
|---|---|---|---|
| 1 | server | `connection 2; Last-Event-ID = null; accept = "text/event-stream"` | `EventSource` asks for an event stream |
| 2 | client, 11 ms | `open; readyState = 1` | connected |
| 3 | client, 214 ms | `tick lastEventId=1 data={"n":1}` | `event: tick` reached the `tick` listener; `id:` set `lastEventId` |
| 4 | client, 422 ms | `tick lastEventId=2 data={"n":2}` | the server then logged `closed the stream after id 2` |
| 5 | client, 423 ms | `error event; readyState = 0` | stream ended; 0 = connecting again |
| 6 | server, 505 ms after closing | `connection 3; Last-Event-ID = "2"` | waited the `retry: 500` time, then sent the last ID |
| 7 | client, 926 ms | `error event; readyState = 2` | the `204` closed it for good (2 = closed) |
| 8 | client, 3,010 ms | `final readyState = 2` | no further reconnects |

Steps 5 to 7 are the standard's reconnection rules at work ✅[^sse-spec].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Handler calls `Deno.upgradeWebSocket` but returns another response | Deno printed `Upgrade response was not returned from callback`; `server.finished` resolved, the next `curl` could not connect (exit code 7), the upgrading client sat at `readyState = 0` for 3 seconds, and the process stayed alive ✅[^run] | The docs say only that the returned response must be used for the upgrade to succeed ✅[^upgrade-api]; in 2.9.8 the whole listener stopped |
| `Deno.upgradeWebSocket` on a plain request | `TypeError: Invalid Header: 'upgrade' header must contain 'websocket'` ✅[^run] | Check the header first and answer 426 ✅[^ws-ex] |
| Idle close | The server-side socket fired `close` twice: `1001` (`wasClean = false`), then `1005` (`wasClean = true`) ✅[^run] | Observed in 2.9.8 for one connection; make `close` handlers safe to run twice |
| WebSocket on an HTTP/2 connection | Not supported | HTTP/1.1 only for now ✅[^http-guide] |
| Last SSE event without a closing blank line | Discarded by the client | Only a blank line dispatches; the end of the stream does not ✅[^sse-spec] |
| Many SSE streams to one domain over HTTP/1 | Browsers allow about 6 open connections per browser and domain, shared by all tabs | Over HTTP/2 the limit is the negotiated stream count, 100 by default ✅[^mdn-sse] |
| `route` entry without `method` | Matches `DELETE` as well as `GET` ✅[^run] | Omitted method means all methods ✅[^route-src] |
| Wrong method for a matched path | Default handler (`404`), not `405` ✅[^run] | Linear scan for the first entry whose pattern and method both match ✅[^route-src] |
| `touch` a file without changing it | New ETag `W/"15-o/iP0mtQSIJdpsw4dFyre8f3GKU"`; the old `If-None-Match` got `200` ✅[^run] | The ETag hashes the modification time ✅[^etag-src] |
| Two files written in the same millisecond | Same hash part (`BKkBz8s/PQliMSz0bkkRyo5lIiA`) for `hello.txt` and `sub/index.html`; only the size prefix (`15` and `13`) differed ✅[^run] | Same reason; equal size and time would give equal ETags |
| `Range` on an empty file | Ignored; the full (empty) file is sent | The range branch needs a size above 0 ✅[^fs-src] |
| `/products/:id?` against `/products/` | No match ✅[^run] | The `/` before `:id` is the group's prefix and becomes optional together with it, so `/products` matches and a lone trailing `/` does not ✅[^urlpattern-spec] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| WebSocket | Two-way, text and binary ✅[^ws-out-ex] | No backpressure ✅[^mdn-ws]; HTTP/1.1 only in Deno ✅[^http-guide]; reconnecting is up to you |
| `WebSocketStream` | Backpressure through streams ✅[^wss-ex] | `--unstable-net` in Deno, not standardized ✅[^mdn-wss] |
| SSE with `EventSource` | Plain HTTP response; built-in reconnect with `Last-Event-ID` ✅[^sse-spec] | Server to client only, UTF-8 text only ✅[^sse-spec]; 6 streams per domain on HTTP/1 ✅[^mdn-sse] |
| Hand-written `URLPattern` checks | No dependency | Methods, 404 and ordering by hand |
| `route` / `routeRadix` from `@std/http` | Declarative table, captured params ✅[^route-src] | Unstable module ✅[^route-src] |
| `serveDir` | 304, ranges, traversal and dotfile checks in one call ✅[^fs-src] | Time-based weak ETags; one range per request ✅[^fs-src] ✅[^etag-src] |

## Takeaways
- Return the `response` from `Deno.upgradeWebSocket` on every path of the handler; in Deno 2.9.8 a forgotten one stopped the whole server. [rule-candidate]
- Check `upgrade: websocket` before calling `Deno.upgradeWebSocket`, and answer other requests with `426`. [rule-candidate]
- Give every SSE event an `id:`, resume from `Last-Event-ID`, and answer `204` to make clients stop. [rule-candidate]
- List `method` on every `route` entry; an omitted method accepts `DELETE` too. [rule-candidate]
- Serve static files with `serveDir`/`serveFile` rather than `Deno.readFile` in a handler, and keep `showDotfiles` off.
- Use `WebSocketStream` only where backpressure matters and an unstable flag is acceptable.

## Verification status
- Verified: 97 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- Commands run on 2026-11-24 with `denoland/deno:alpine-2.9.8` (Deno 2.9.8, V8 15.0.245.2-rusty, TypeScript 6.0.3, Alpine 3.24.2, aarch64) in the lab of `deno/deno-lab-setup.md`; outputs as quoted in Problem, Mental model, How it works, Worked example and Edge cases. Clients were Deno's `WebSocket`, `WebSocketStream`, `EventSource` and `fetch`, a raw `Deno.connect` client for the idle test, and Alpine's `curl` 8.23.0; `@std/http` 1.1.4 came from JSR. [^run]
- [Deno.upgradeWebSocket](https://docs.deno.com/api/deno/~/Deno.upgradeWebSocket) — Deno project, living. Rank 1. Backs: `{ socket, response }`, `protocol`, `idleTimeout` default and meaning, the response must be returned, reading the body first fails the upgrade. [^upgrade-api]
- [Writing an HTTP Server](https://docs.deno.com/runtime/fundamentals/http_server/) — Deno project, living. Rank 1. Backs: WebSockets on HTTP/1.1 only, `serveDir` needs read access. [^http-guide]
- [HTTP server: WebSockets](https://docs.deno.com/examples/http_server_websocket/) — Deno project, living. Rank 1. Backs: answering non-upgrade requests with 426. [^ws-ex]
- [Outbound WebSockets](https://docs.deno.com/examples/websocket/) — Deno project, living. Rank 1. Backs: `new WebSocket`, waiting for `open`, `readyState` 1, message types for `send()`. [^ws-out-ex]
- [Two-way streaming with WebSocketStream](https://docs.deno.com/examples/websocket_stream/) — Deno project, living. Rank 1. Backs: unstable, `--unstable-net`, `opened`/`closed`, backpressure, server stays `upgradeWebSocket`. [^wss-ex]
- [HTTP server: Server-sent events](https://docs.deno.com/examples/http_server_sse/) — Deno project, living. Rank 1. Backs: `ReadableStream` event stream, `text/event-stream` and `no-store` headers, `cancel()` clearing the timer. [^sse-ex]
- [Match URLs with URLPattern](https://docs.deno.com/examples/url_pattern/) — Deno project, living. Rank 1. Backs: named groups, `exec(…).pathname.groups`, `*` with numeric keys. [^urlpattern-ex]
- [Hono HTTP server](https://docs.deno.com/examples/hono/) — Deno project, living. Rank 1. Backs: `jsr:@hono/hono` served with `Deno.serve(app.fetch)`. [^hono-ex]
- [HTTP server: Performing CRUD operations using SQLite3](https://docs.deno.com/examples/http_server_oak_crud_middleware_with_sqlite3_db/) — Deno project, living. Rank 1. Backs: `jsr:@oak/oak` started with `app.listen`. [^oak-ex]
- [@std/http](https://jsr.io/@std/http) — Deno project, living. Rank 1. Backs: package version 1.1.4, `route` in the `unstable-route` module. [^std-http]
- [serveDir](https://jsr.io/@std/http/doc/file-server/~/serveDir) — Deno project, living. Rank 1. Backs: `serveDir(req, opts)` and the `fsRoot`/`urlRoot` mapping. [^servedir]
- [ServeDirOptions](https://jsr.io/@std/http/doc/file-server/~/ServeDirOptions) — Deno project, living. Rank 1. Backs: every option and its default. [^servedir-opts]
- [serveFile](https://jsr.io/@std/http/doc/file-server/~/serveFile) — Deno project, living. Rank 1. Backs: `serveFile(req, filePath, options)`. [^servefile]
- [denoland/std: http/unstable_route.ts](https://github.com/denoland/std/blob/main/http/unstable_route.ts) — Deno project, living. Rank 1. Backs: `Route` fields, handler arguments, omitted method matches all, linear scan, `route` alias of `routeLinear`, `routeRadix`, the `@experimental` tag on every export. [^route-src]
- [denoland/std: http/file_server.ts](https://github.com/denoland/std/blob/main/http/file_server.ts) — Deno project, living. Rank 1. Backs: 304 rules, single-range parsing, 206/416, 405, 301, dotfile and outside-root 404, empty-file ranges. [^fs-src]
- [denoland/std: http/etag.ts](https://github.com/denoland/std/blob/main/http/etag.ts) — Deno project, living. Rank 1. Backs: weak file ETags from size and modification time, weak `If-None-Match` comparison. [^etag-src]
- [HTML Standard: Server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html) — WHATWG, living. Rank 1. Backs: MIME type, UTF-8, fields, comments, dispatch on blank line, reconnection, `Last-Event-ID`, 204, keep-alive comments. [^sse-spec]
- [URL Pattern Standard](https://urlpattern.spec.whatwg.org/) — WHATWG, living. Rank 1. Backs: per-component matching, omitted parts as wildcards, regular-expression groups, `?` modifier, `ignoreCase`. [^urlpattern-spec]
- [WebSocket](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket) — MDN Web Docs, living. Rank 3. Backs: the four events, no backpressure. [^mdn-ws]
- [WebSocketStream](https://developer.mozilla.org/en-US/docs/Web/API/WebSocketStream) — MDN Web Docs, living. Rank 3. Backs: experimental and non-standard, stream backpressure. [^mdn-wss]
- [Using server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events) — MDN Web Docs, living. Rank 3. Backs: 6 connections per browser and domain over HTTP/1, 100 streams by default over HTTP/2. [^mdn-sse]
- [URLPattern](https://developer.mozilla.org/en-US/docs/Web/API/URLPattern) — MDN Web Docs, living. Rank 3. Backs: Baseline 2025 in browsers. [^mdn-urlpattern]

## Related
- `deno/web/http-server.md` — `Deno.serve`, `deno serve`, streaming bodies, TLS, HTTP/2 and graceful shutdown.
- `deno/std-and-jsr/standard-library.md` — the other `@std` packages and their stability.
- `deno/modules/module-specifiers-and-imports.md` — how `jsr:@std/http@1.1.4/…` resolves.
- `deno/security/permission-model.md` — the `--allow-net` and `--allow-read` grants these servers need.
- `deno/releases-stability-and-support.md` — `--unstable-net` and the other unstable flags.
