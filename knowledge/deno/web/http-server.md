---
schema: knowledge-doc/v1
type: concept
topic: deno/web
status: verified
applies-to: ["Deno 2.9.8"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [deno, http-server, deno-serve, serve-handler-info, graceful-shutdown, streaming, backpressure, tls, http2, alpn, h2c, compression, parallel, reuse-port, unix-socket]
ranked-sources: true
---

# HTTP servers with `Deno.serve` and `deno serve`

## Summary
**TL;DR:** `Deno.serve(handler)` listens on `0.0.0.0:8000`, speaks HTTP (Hypertext Transfer Protocol) 1.1 and HTTP/2, and calls `handler(request, info)` with a web-standard `Request`; the handler returns a `Response` (or a promise of one), and `info` carries the client's `remoteAddr` and a `completed` promise. The returned `HttpServer` stops gracefully with `shutdown()`: no new connections, and requests already in progress finish. Bodies stream both ways as `ReadableStream`s with backpressure. `deno serve file.ts` runs a module whose default export is `{ fetch }`, needs no `--allow-net`, and with `--parallel` runs one isolate per CPU (central processing unit) behind one port, each with its own module state.
**Use this when:** writing or reviewing a Deno HTTP server, choosing between `Deno.serve` and `deno serve`, adding TLS or HTTP/2, stopping a server without dropping requests, streaming large or slow bodies, or spreading a server over several CPU cores.
**Not this doc:** WebSockets, server-sent events, routing and static files → `deno/web/websockets-sse-and-routing.md`; `--allow-net` value syntax → `deno/security/permission-flags.md`; the `--unstable-*` flags → `deno/releases-stability-and-support.md`; operating-system signal listeners → `deno/runtime-apis/files-processes-and-environment.md`; the `fetch` client and other web globals → `deno/fundamentals/web-platform-apis.md`.

## Problem
A server that works in a demo fails in quieter ways in production:
- A deploy kills the process and drops requests that were half done.
- A streamed response keeps producing data after the client left, until the process runs out of memory ✅[^http-guide].
- Code expects a thrown error to crash the process, or a custom error page without `onError`.
- Compression, `reusePort` or a Unix socket are expected to work by default, and each needs an option, an unstable flag or extra permissions ✅[^run].
- `deno serve --parallel` is expected to share an in-memory counter between workers, and it does not ✅[^parallel-ex].

## Mental model
**Analogy:** `Deno.serve` is the front desk of a restaurant. The desk staff (the runtime) open the door (the listening socket), seat guests (accept connections and parse HTTP) and pass a written order (`Request`) to your kitchen (the handler). The kitchen hands back a plate (`Response`), and the staff carry it out, either whole or course by course (a streamed body). `shutdown()` locks the door but lets seated guests finish. `--parallel` opens several identical kitchens behind the same door, each with its own fridge.

| Term | Plain-English meaning | Concrete artifact |
|---|---|---|
| Handler | The function that answers one request | `(req, info) => new Response("hi")` |
| `info` (`Deno.ServeHandlerInfo`) | A slip attached to each order: who sent it, and a "delivered" promise | `{"transport":"tcp","hostname":"127.0.0.1","port":43184}` |
| `HttpServer` | The remote control for the running server | `server.shutdown()`, `server.addr`, `server.finished` |
| Streamed body | A body sent piece by piece as it is produced | `new Response(new ReadableStream({ pull(c) { … } }))` |
| Backpressure | The reader's "slow down" signal that pauses the producer | the producer stopped at 42 chunks while the client paused |
| TLS (Transport Layer Security) | Encryption of the connection | `cert` and `key` given as PEM (Privacy-Enhanced Mail) text |
| ALPN (Application-Layer Protocol Negotiation) | The TLS handshake step where client and server agree on HTTP/2 or HTTP/1.1 | curl prints `ALPN: server accepted h2` |
| h2c | HTTP/2 over plain TCP (Transmission Control Protocol), without TLS | `curl --http2-prior-knowledge http://localhost:8080/` |
| Isolate | A separate JavaScript world with its own globals and module state | `[serve-worker-3 ]`, the prefix Deno puts on worker 3's console output under `--parallel` |

**Artifact:** `hello.ts`, run with `deno run --allow-net hello.ts`, then `curl -si http://127.0.0.1:8000/hello` ✅[^run]:
```ts
Deno.serve((req, info) => {
  const addr = info.remoteAddr as Deno.NetAddr;
  return new Response(`${req.method} ${new URL(req.url).pathname} from ${addr.hostname}:${addr.port}\n`);
});
```
```text
Listening on http://0.0.0.0:8000/ (http://localhost:8000/)
HTTP/1.1 200 OK
content-type: text/plain;charset=UTF-8
content-length: 32
date: Tue, 24 Nov 2026 08:47:57 GMT

GET /hello from 127.0.0.1:49598
```

## How it works
**4 actors:**
- **The client** — its job: send requests and read responses, via a TCP or TLS connection to the listening port.
- **The Deno HTTP layer** (Rust code inside the runtime) — its job: own the listening socket and speak HTTP, via the options passed to `Deno.serve`.
- **Your handler** — its job: turn each `Request` into a `Response`, via the function passed to `Deno.serve` or the `fetch` of a default export.
- **The `HttpServer` object** — its job: control the server's lifetime, via `shutdown()`, `signal`, `ref()`/`unref()` and `finished`.

```text
client                    Deno HTTP layer (Rust)                    your handler (JavaScript)
  │                          owns 0.0.0.0:8000 (or a Unix socket path)
  │══ TCP/TLS connect ══════▶ accept; TLS ALPN picks h2 or http/1.1
  │══ GET /x ═══════════════▶ parse → Request + info{remoteAddr, completed}
  │                             │──────────────────────────────────▶ handler(req, info)
  │                             │◀──────────────────────────────────  Response (or throw → onError)
  │◀═ status + headers ═══════ add date; content-length, or chunked for a stream
  │◀═ body chunks ════════════ pull() the next chunk as the socket drains
  │                             info.completed settles
                     shutdown(): stop accepting → wait for in-flight → finished resolves
```

1. **Listen (Deno HTTP layer, local).**
   - The default is port 8000 on hostname `0.0.0.0`; `port: 0` picks any free port ✅[^serve-api], read back from `server.addr`: `{"hostname":"0.0.0.0","port":42625,"transport":"tcp"}` ✅[^run].
   - Without `onListen` it prints `Listening on http://0.0.0.0:8000/ (http://localhost:8000/)` ✅[^serve-api] ✅[^run].
   - Under `deno run` it needs `--allow-net`; without it: `NotCapable: Requires net access to "0.0.0.0:8000", run again with the --allow-net flag`, exit code 1 ✅[^run]. What a net grant allows → `deno/security/permission-model.md`.
2. **Accept and parse (client → Deno HTTP layer, network).** One server handles HTTP/1.1 and HTTP/2 requests ✅[^http-guide] and builds a `Request` plus the `info` object.
3. **Handle (your handler, local).** It runs once per request and may be `async` ✅[^http-guide]. `info.remoteAddr` is the peer's address ✅[^info-api].
4. **Respond (Deno HTTP layer → client, network).**
   - `new Response("hello")` reached the client with `content-type: text/plain;charset=UTF-8`, `content-length: 5` and a `date` header; `HEAD` got the same headers and no body ✅[^run].
   - A `ReadableStream` body went out with `transfer-encoding: chunked` and no `content-length` ✅[^run].
5. **Fail (handler → error path, local).** A throw is isolated to its request ✅[^serve-api]. Without `onError` the client got `500 Internal Server Error` with the body `Internal Server Error`, and the stack (`Error: boom`) went to stderr; with `onError` its response is sent (measured: `503`, body `custom 503`) ✅[^run].
6. **Settle (Deno HTTP layer, local).** `info.completed` settles once the response has been sent ✅[^info-api]; for a client that disconnects, see Edge cases.

### Streaming bodies and backpressure
- **Response, producer side.** The layer asks the stream for more (`pull()`) only as the socket drains. Measured with 64 KiB (kibibyte) chunks while the client read once and then paused 2,000 ms (milliseconds): the producer stood at 42 pulls (about 2.6 MiB, mebibytes, buffered) at 500 ms and still at 1,900 ms, then ran on to all 400 pulls (25 MiB) once the client read again ✅[^run].
- **Client hang-up.** The stream's `cancel()` runs when the client disconnects; a producer driven by a timer in `start()` that ignores it keeps queuing forever ✅[^http-guide] ✅[^stream-ex]. Measured: `cancel()` ran as soon as the client aborted, with the reason `resource closed` ✅[^run].
- **Async generators.** `ReadableStream.from(generator())` turns an async generator into a response body ✅[^stream-ex].
- **Request bodies.** `for await (const chunk of req.body)` sees chunks as they arrive: a client that sent 4 parts 300 ms apart with `fetch(url, { method: "POST", body: stream, duplex: "half" })` produced 4 server-side chunks about 300 ms apart, not one at the end ✅[^run]. Reading a body (`text()`, `json()`, a reader) can fail when the client hangs up first ✅[^http-guide].

### Options and the server object
| Option or member | Default | Effect | Measured in 2.9.8 |
|---|---|---|---|
| `port`, `hostname` | `8000`, `"0.0.0.0"` | Where to listen ✅[^serve-api] | default message above ✅[^run] |
| `onListen` | prints `Listening on …` | Called once when listening ✅[^serve-api] | custom callback printed `custom onListen 0.0.0.0:8001` ✅[^run] |
| `onError` | 500 response | Called when the handler throws ✅[^serve-api] | step 5 |
| `signal` | none | Aborting it closes the server and all its connections ✅[^serve-api] | `finished` resolved after `abort()` ✅[^run] |
| `cert`, `key` | none | PEM text, not file paths; turns on TLS ✅[^http-guide] | TLS section below |
| `path` | none | Listen on a Unix domain socket instead of TCP ✅[^serve-api] | needed `--allow-net=unix:/tmp/app.sock` plus `--allow-read` and `--allow-write` on the path; printed `Listening on /tmp/app.sock`; `remoteAddr` was `{"transport":"unix","path":"/tmp/app.sock"}` ✅[^run] |
| `reusePort` | `false` | Sets `SO_REUSEPORT` (a POSIX, Portable Operating System Interface, socket option that lets several sockets bind one port) ✅[^serve-api] | needs `--unstable-net`; two servers on port 9001 answered 20 requests 10 and 10 ✅[^run] |
| `tcpBacklog` | `511` | Maximum pending connections in the listen queue ✅[^serve-api] | not measured |
| `automaticCompression` | `false` | Compresses eligible bodies ✅[^serve-api] | section below |
| `shutdown()` | — | Stops accepting connections, lets pending requests finish ✅[^serve-api] | Worked example |
| `finished` | — | Promise that resolves once the server has closed ✅[^serve-api] | Worked example |
| `addr` | — | The local address being listened on ✅[^serve-api] | step 1 |
| `ref()`, `unref()` | ref'd | `unref()` stops the server from keeping the process alive ✅[^serve-api] | after `unref()` the process exited at once, exit code 0 ✅[^run] |

### TLS and HTTP/2
- Pass the PEM contents, for example `cert: Deno.readTextFileSync("cert.pem")`, which also needs read permission on the files; the docs make a self-signed development certificate with `openssl req -x509 -newkey rsa:2048 -nodes …` ✅[^tls-ex].
- HTTP/2 needs no option ✅[^http-guide]. Measured with curl 8.23.0 against a TLS server: `--http2 -k` printed `ALPN: server accepted h2` and `HTTP/2 200`; `--http1.1` printed `ALPN: server accepted http/1.1` and `HTTP/1.1 200 OK` ✅[^run].
- Over cleartext, HTTP/2 works "with prior knowledge" ✅[^http-guide]: `curl --http2-prior-knowledge` got `HTTP/2 200` ✅[^run]. The `Upgrade: h2c` path is not taken: `curl --http2 http://…` sent the upgrade headers and got `HTTP/1.1 200 OK` ✅[^run].

### Automatic compression
- Off by default; turn it on per server with `automaticCompression: true` or for the process with `DENO_SERVE_AUTOMATIC_COMPRESSION=1`. Encodings are gzip and brotli ✅[^http-guide].
- A body is compressed only when `Accept-Encoding` includes `br` or `gzip` (quality values are respected), the `Content-Type` is compressible, and the body is over 64 bytes; it is skipped when the response already has `Content-Encoding` or `Content-Range`, or `Cache-Control` contains `no-transform` ✅[^http-guide].
- Measured: a 4,901-byte JSON (JavaScript Object Notation) body came back with `content-encoding: gzip`, `vary: Accept-Encoding`, `transfer-encoding: chunked` and 791 bytes on the wire; `Accept-Encoding: gzip;q=0.5, br` chose `br`; a 9-byte body, an `image/png` body and a `cache-control: no-transform` body came back uncompressed with `content-length`; the environment variable turned compression on for a server without the option ✅[^run].

### `deno serve` and `--parallel`
- **Module shape.** The default export satisfies `Deno.ServeDefaultExport`: a required `fetch(request, info)` and an optional `onListen`; other properties are ignored ✅[^serve-cli].
- **Permissions.** Listening needs no `--allow-net`; other access (files, environment) still needs its flag ✅[^serve-cli]. Measured: `deno serve serve_main.ts` with no flags printed `deno serve: Listening on http://0.0.0.0:8000/` and answered ✅[^run].
- **Address.** `--port` (default 8000, `0` = random) and `--host` (default `0.0.0.0`, all interfaces) ✅[^serve-cli]; `--port 0 --host 127.0.0.1` printed `Listening on http://127.0.0.1:44255/` ✅[^run].
- **`--parallel`.** The worker count is the number of available CPUs, or `DENO_JOBS` ✅[^serve-cli]. The runtime owns the listening socket and spreads incoming connections over the workers; each worker is a separate isolate, so module-level state is per worker ✅[^parallel-ex]. Measured on 8 CPUs: `Listening on http://0.0.0.0:8200/ with 8 threads`, eight log prefixes `[serve-worker-0 ]` to `[serve-worker-7 ]` on a line the test module printed when it loaded, all in one process (`Deno.pid` was `34` in every worker); `DENO_JOBS=3` printed `with 3 threads` ✅[^run].
- **`--watch`.** Restarts when a local file in the module graph changes ✅[^serve-cli]. Measured after editing the file: `Watcher Waiting for graceful termination...`, `Watcher Restarting! File change detected: "/tmp/w/app.ts"`, and the next request returned `version 2` ✅[^run].

## Worked example
Graceful shutdown with one slow request in flight (`shutdown.ts`, run with `deno run --allow-net shutdown.ts`) ✅[^run]:
```ts
const server = Deno.serve({ port: 0, onListen() {} }, async (req) => {
  if (new URL(req.url).pathname === "/slow") {
    await new Promise((r) => setTimeout(r, 2000));   // 2 s of work
    return new Response("slow done");
  }
  return new Response("fast");
});
const base = `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}`;
server.finished.then(() => log("server.finished resolved"));
const slow = fetch(base + "/slow").then((r) => r.text());   // 1. start the slow request
await new Promise((r) => setTimeout(r, 300));
const done = server.shutdown();                               // 2. shut down while it runs
await new Promise((r) => setTimeout(r, 100));
await fetch(base + "/fast");                                  // 3. try a new request
```
(Trimmed: the full `shutdown.ts` run in the lab defines `log` to print the milliseconds since start, logs each step, and wraps step 3 in `try`/`catch`. The table quotes its output.)

| Time | Actor | Event (quoted output) |
|---|---|---|
| 54 ms | server | `addr {"hostname":"0.0.0.0","port":42625,"transport":"tcp"}` |
| 115 ms | handler | `/slow started, sleeping 2000ms` |
| 418 ms | script | `calling shutdown()` |
| 637 ms | client | new request: `TypeError - fetch failed` (the port no longer accepts connections) |
| 2,219 ms | handler | `/slow returning` |
| 2,260 ms | server | `shutdown() promise resolved`, then `server.finished resolved` |
| 2,270 ms | client | `/slow got "slow done"`; the process exits with code 0 |

The in-flight request finished; only the new one was refused. In a real service the same `shutdown()` call goes in a `SIGINT`/`SIGTERM` listener with a hard-exit timer, as in the docs' example ✅[^shutdown-ex].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Client disconnects mid-body, or before the handler returns | `info.completed` **resolved** in all three measured cases: a stream aborted after 3 chunks, a 50 MiB body cancelled after the first read, a client gone 800 ms before the handler returned ✅[^run] | The API (application programming interface) reference says it rejects with `Deno.errors.Interrupted` when the response cannot be delivered ✅[^info-api]; 2.9.8 did not. Detect hang-ups with the stream's `cancel()` instead |
| Listening to `request.signal` | It fired `abort` after a successful response too, and Deno printed `Deno.serve: request.signal aborts on successful responses (legacy behavior).` plus a pointer to the flag ✅[^run] | Kept for history; `--unstable-no-legacy-abort` makes it abort only on a real disconnect ✅[^http-guide], which the run confirmed ✅[^run] |
| `reusePort: true` without `--unstable-net` | `Unstable API 'Deno.listen({ reusePort: true })'. The --unstable-net flag must be provided.`, exit code 70 ✅[^run] | The option is behind the unstable net flag in 2.9.8 |
| A second `Deno.serve` on a used port | `AddrInUse - Address already in use (os error 98)` ✅[^run] | No `reusePort` |
| Unix socket with only `--allow-read --allow-write` | `NotCapable: Requires net access to "unix:/tmp/app.sock"` ✅[^run] | A socket path needs net, read and write permission |
| `--parallel` with one keep-alive connection | All 200 requests on it went to one worker ✅[^run] | Connections, not requests, are spread ✅[^parallel-ex] |
| `--parallel` fairness | 200 new connections over 8 workers: 68, 51, 49, 16, 5, 4, 4 and 3 ✅[^run] | The pull request that added `--parallel` says Linux uses `SO_REUSEPORT` and relies on the kernel's round-robin, while macOS and Windows clone the socket handle, and that the spread is not guaranteed fair ✅[^parallel-pr]; the run was uneven, not round-robin |
| `deno serve` on a module without `fetch` | `error: deno serve requires export default { fetch } in the main module, did you mean to run "deno run"?`, exit code 0 ✅[^run] | No server starts ✅[^serve-cli] |
| `fetch` that is not a function | `TypeError: Invalid type for fetch: must be a function`, exit code 1 ✅[^run] | Documented `TypeError` ✅[^serve-cli] |
| Opening `0.0.0.0` in a browser on Windows | Does not work | Hence the default message also prints a `localhost` URL (uniform resource locator, a web address) ✅[^serve-api] |
| `SIGTERM` listener on Windows | Not supported | The docs' shutdown example registers it only on other systems ✅[^shutdown-ex] |
| WebSocket upgrade over HTTP/2 | Not supported | WebSockets are HTTP/1.1 only for now ✅[^http-guide] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `Deno.serve` under `deno run` | Every option (TLS, Unix socket, `signal`, several servers per process) | Needs `--allow-net`; no `--parallel` |
| `deno serve` with `export default { fetch }` | No net flag; port, host, `--parallel` and `--watch` come from the command line ✅[^serve-cli] | Listen options live outside the code |
| `--parallel` | Uses every CPU with one command ✅[^parallel-ex] | Per-worker state; spread per connection and uneven ✅[^run] |
| `automaticCompression` | 4,901 → 791 bytes for the measured JSON ✅[^run] | CPU per response; `content-length` is replaced by chunked transfer ✅[^run] |
| `shutdown()` versus aborting `signal` | `shutdown()` waits for in-flight requests ✅[^serve-api] | Aborting `signal` closes all connections at once ✅[^serve-api] |

## Takeaways
- Give every streamed body a `cancel()` that stops the producer, and produce in `pull()` rather than on a timer so backpressure can pause it. [rule-candidate]
- On `SIGTERM`, call `await server.shutdown()` with a hard-exit timer, so deploys never drop in-flight requests. [rule-candidate]
- Do not rely on `info.completed` rejecting to detect disconnects in Deno 2.9.8; it resolved even when the client left.
- Keep shared state (counters, caches, sessions) outside module scope when running `deno serve --parallel`. [rule-candidate]
- Bind `127.0.0.1` when a server must not be reachable from other machines; the default `0.0.0.0` means all interfaces. [rule-candidate]
- Compression is off unless asked for; turn on `automaticCompression` only when no proxy in front already compresses.

## Verification status
- Verified: 90 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- Commands run on 2026-11-24 with `denoland/deno:alpine-2.9.8` (Deno 2.9.8, V8 15.0.245.2-rusty, TypeScript 6.0.3, Alpine 3.24.2, aarch64) in the lab of `deno/deno-lab-setup.md`; outputs as quoted in Problem, Mental model, How it works, Worked example, Edge cases and Trade-offs. Clients were Deno's `fetch` and Alpine's `curl` 8.23.0 (OpenSSL 3.5.8, nghttp2 1.70.0), with `openssl` for the self-signed certificate. [^run]
- [Writing an HTTP Server](https://docs.deno.com/runtime/fundamentals/http_server/) — Deno project, living. Rank 1. Backs: HTTP/1.1 and HTTP/2, async handlers, `cert`/`key` as PEM text, cleartext HTTP/2 with prior knowledge, body read failures, `cancel()` on hang-up, compression rules, legacy `request.signal` and `--unstable-no-legacy-abort`, WebSockets on HTTP/1.1 only. [^http-guide]
- [Deno.serve](https://docs.deno.com/api/deno/~/Deno.serve) — Deno project, living. Rank 1. Backs: defaults, `port: 0`, `onListen` message, `onError`, `signal`, `path`, `reusePort`, `tcpBacklog`, `automaticCompression`, `HttpServer` members, error isolation, the Windows `0.0.0.0` note. [^serve-api]
- [Deno.ServeHandlerInfo](https://docs.deno.com/api/deno/~/Deno.ServeHandlerInfo) — Deno project, living. Rank 1. Backs: `remoteAddr`, `completed` and its documented rejection with `Deno.errors.Interrupted`. [^info-api]
- [deno serve](https://docs.deno.com/runtime/reference/cli/serve/) — Deno project, living. Rank 1. Backs: `Deno.ServeDefaultExport`, no `--allow-net` needed, `--port`, `--host`, `--parallel` and `DENO_JOBS`, `--watch`, the `TypeError` and no-server cases. [^serve-cli]
- [HTTP server: Scaling across CPU cores](https://docs.deno.com/examples/http_server_parallel/) — Deno project, living. Rank 1. Backs: one worker per core, connections spread across workers, the runtime owns the socket, per-isolate state. [^parallel-ex]
- [HTTP server: Graceful shutdown](https://docs.deno.com/examples/http_server_graceful_shutdown/) — Deno project, living. Rank 1. Backs: `shutdown()` in signal listeners with a hard-exit timer, no `SIGTERM` listener on Windows. [^shutdown-ex]
- [HTTP server: TLS](https://docs.deno.com/examples/http_server_tls/) — Deno project, living. Rank 1. Backs: reading PEM files, read permission, the `openssl` command for a self-signed certificate. [^tls-ex]
- [HTTP server: Streaming](https://docs.deno.com/examples/http_server_streaming/) — Deno project, living. Rank 1. Backs: `ReadableStream` bodies, `cancel()` on disconnect, `ReadableStream.from` with an async generator. [^stream-ex]
- [feat(serve): Opt-in parallelism for `deno serve` (#24920)](https://github.com/denoland/deno/pull/24920) — Deno project, 2024. Rank 6. Backs: `SO_REUSEPORT` and kernel round-robin on Linux, cloned socket handle on macOS and Windows, no fairness guarantee. [^parallel-pr]

## Related
- `deno/web/websockets-sse-and-routing.md` — WebSockets, server-sent events, `URLPattern` routing and static files on top of `Deno.serve`.
- `deno/security/permission-model.md` — what `--allow-net`, `--allow-read` and `--allow-write` grant.
- `deno/runtime-apis/files-processes-and-environment.md` — `Deno.addSignalListener` for `SIGINT`/`SIGTERM`.
- `deno/runtime-apis/workers-kv-and-cron.md` — Deno KV, one place to keep state shared by `--parallel` workers.
- `deno/releases-stability-and-support.md` — `--unstable-net` and the other unstable flags.
- `deno/deno-lab-setup.md` — the container every output above came from.
