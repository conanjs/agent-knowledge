---
schema: knowledge-doc/v1
type: reference
topic: bun/http-and-networking
status: verified
applies-to: ["Bun 1.4.5"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [bun, fetch, proxy, no-proxy, http2, http3, fetch-session, unix-socket, tls, sni, alpn, mtls, tcp, bun-listen, bun-connect, starttls, udp, multicast, dns, cookies, cookiemap]
---

# Bun networking APIs: fetch extensions, TCP, UDP, DNS, cookies and TLS options

## Summary
**TL;DR:** Bun's `fetch` takes extra options that browsers do not: `proxy`, `unix`, `verbose`, `tls`, `decompress`, `compress`, `maxRedirects`, an idle `timeout`, `protocol` (force HTTP/1.1, HTTP/2 or HTTP/3) and `session` (a `Bun.FetchSession` with its own connection pool), plus `fetch.preconnect()`. `Bun.listen`/`Bun.connect` give raw TCP (Transmission Control Protocol) with one shared handler object per server, `Bun.udpSocket` sends UDP (User Datagram Protocol) datagrams to IP (Internet Protocol) addresses only and joins multicast groups, `Bun.dns` resolves names (DNS, the Domain Name System) and caches them for `fetch` and `Bun.connect`, `Bun.Cookie`/`Bun.CookieMap` parse and build cookies (and `req.cookies` in `Bun.serve` routes applies changes for you), and `Bun.serve({ tls })` takes key/cert contents or an array of them for SNI (Server Name Indication). Every row below ran in the lab or names the page it comes from.
**Use this when:** you need the exact option name, default or return value of one of these APIs, or want to know what it did in a real run.
**Not this doc:** how `Bun.serve` routes and handles requests, and its `http2`/`http3` server options → [bun-serve.md](bun-serve.md); WebSocket server and client → [websockets-and-pubsub.md](websockets-and-pubsub.md); `node:http`, `node:net` and other `node:*` compatibility → `bun/node-compat/nodejs-compatibility.md`.

## Scope
These APIs (application programming interfaces) as shipped in Bun 1.4.5 on Linux (arm64 container). The DNS backends and cache, `exclusive`, `reusePort` and `ipv6Only` also ran on macOS 26.1, with a build cross-compiled for `darwin-arm64`; Windows defaults are named only where the docs give them, because the lab has no Windows machine. The families, each with a picture:
- **`fetch` extensions**: extra keys in the second argument of `fetch(url, init)`, the HTTP (Hypertext Transfer Protocol) client; `url` is the URL (Uniform Resource Locator, the web address). Example: `fetch(url, { unix: "/tmp/app.sock" })`.
- **Forward proxy**: a relay that makes requests for you, like a mail room that posts your letters. For an `http:` URL the client sends the whole URL to the proxy (a `GET` for `http://host/path`); for `https:` it asks the proxy to open a tunnel (`CONNECT host:443`) and speaks TLS through it. Example: `HTTPS_PROXY=http://proxy:3128`.
- **TCP** (Transmission Control Protocol) sockets: a phone call, a connected, ordered byte stream. Example: `Bun.connect({ hostname, port, socket: { data } })`.
- **UDP** (User Datagram Protocol): postcards, separate packets with no connection and no delivery promise. Example: `socket.send("ping", 41234, "127.0.0.1")`. **Multicast** is a mailing list: a packet sent to a group address such as `239.1.2.3` reaches every socket that joined the group.
- **DNS** (Domain Name System): the phone book that turns a name into an IP (Internet Protocol) address. Example: `await Bun.dns.lookup("example.com")`.
- **Cookies**: a cloakroom ticket the server hands out (`Set-Cookie`) and the browser shows on every later visit (`Cookie`).
- **TLS** (Transport Layer Security) and **SNI** (Server Name Indication): TLS is the sealed envelope plus an identity check; SNI is the name written on the envelope, so one server can show the matching certificate. Example: `tls: [{ serverName: "a.test", key, cert }, ...]`. **ALPN** (Application-Layer Protocol Negotiation) is the line on the envelope that says which language to speak inside, such as `h2` (HTTP/2) or `http/1.1`.

## Catalog

### fetch extensions
| Option or API | Values (default) | Effect and lab result | Evidence |
|---|---|---|---|
| `proxy` | URL string, `URL`, `{ url, headers, respectNoProxy }`, or `false` | Sends the request through an HTTP proxy; `headers` go to the proxy. A proxy built with `Bun.serve` received `GET url=http://localhost:34559/through-proxy`, `proxy-authorization=Bearer p`, `x-custom-proxy-header=v`. Through a logging forward proxy written for the lab (Node.js 24 in `node:24.22.1-alpine`), an `http:` URL arrived as a `GET` for `http://net-srv:8080/c24` and an `https:` URL as `CONNECT net-srv:8446`, both carrying those two headers | ✅[^lab] ✅[^1] ✅[^8] |
| Credentials in the proxy URL | `http://user:pass@proxy:3128` | Sent as `proxy-authorization: Basic bGFiOmxhYnNlY3JldA==` (`lab:labsecret`); a `Proxy-Authorization` header in `proxy.headers` replaced them (`Bearer override`) | ✅[^lab] ✅[^1] |
| `proxy: false` | — | Connects directly, ignoring the proxy environment variables: with `HTTP_PROXY` set, the proxy saw nothing. On a `FetchSession` request it also overrode the session's proxy | ✅[^lab] ✅[^1] ✅[^8] |
| `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY` | upper or lower case | Read on every `fetch`: setting `process.env.HTTP_PROXY` between two requests sent only the second through the proxy, and deleting it sent the third direct. `HTTP_PROXY` (or `http_proxy`) covered `http:` URLs only and `HTTPS_PROXY` `https:` URLs only (as `CONNECT`); `ALL_PROXY` covered both; `ALL_PROXY=socks5://...` was ignored (direct). Never used with `unix`: a Unix-socket request answered `200` and the proxy saw nothing | ✅[^lab] ✅[^1] |
| `NO_PROXY`, `no_proxy` | comma- or space-separated entries | Hosts that bypass the proxy. Direct: `net-srv`, `*`, `lab.test`, `.lab.test` and `*.lab.test` for `api.lab.test` (and `.lab.test` for `lab.test` itself), `net-srv:8080` for port 8080, `192.168.0.0/16` for a URL by IP, `foo, net-srv` and `foo net-srv`. Through the proxy: `net-srv:9999` (other port). A non-empty `no_proxy` wins over `NO_PROXY`; an empty one falls back to it | ✅[^lab] ✅[^1] |
| `respectNoProxy` | `true` | `NO_PROXY` also applies to an explicit `proxy`: with `NO_PROXY=net-srv`, `proxy: "http://..."` went direct, and `{ url, respectNoProxy: false }` went through the proxy | ✅[^lab] ✅[^1] |
| Proxy refuses `CONNECT` | — | A proxy answering `407` made `fetch` reject with `code` `ERR_PROXY_TUNNEL`, `status` `407` and `headers.get("proxy-authenticate")` `Basic realm="lab"`; an `http:` URL through the same proxy needs no `CONNECT` and got `200` | ✅[^lab] ✅[^1] |
| `unix` | socket path | HTTP over a Unix domain socket: `fetch("http://localhost/hello", { unix: "/tmp/app.sock" })` → `200`, the server saw `url` `http://localhost/hello` | ✅[^lab] ✅[^1] |
| `proxy` with `unix` | — | `TypeError: fetch() cannot use a proxy with a unix socket.` | ✅[^lab] ✅[^1] |
| `verbose` | `true` or `"curl"` | `true` prints request and response headers to stderr (sample in Lookup notes); `"curl"` first prints the request as a command line, `curl --http1.1 "http://localhost:40213/" -H "Connection: keep-alive" ... --compressed`, then the same headers | ✅[^lab] ✅[^1] |
| `tls.ca` + `tls.serverName` | CA (certificate authority) certificate as PEM (Privacy-Enhanced Mail, the `-----BEGIN ...-----` text format) contents; a host name | Trusts that CA and uses the name for SNI and the certificate check: `https://127.0.0.1:<port>` with `serverName: "a.test"` got the certificate whose CN (common name) is `a.test`, and `"b.test"` got `CN=b.test` | ✅[^lab] ✅[^1] |
| `tls.rejectUnauthorized` | `true` | `false` accepted a certificate from an unknown CA (`200`); with no `tls` the request failed `UNABLE_TO_VERIFY_LEAF_SIGNATURE` | ✅[^lab] ✅[^1] |
| `tls.checkServerIdentity(host, cert)` | function | Runs after the chain verifies and replaces the host-name check; returning `new Error("pinned cert mismatch")` rejected the `fetch` with that error. A request with its own function gets a connection of its own: three such requests used three client ports and called it three times, three requests without it shared one port, and a `FetchSession` holding the function used one port and called it once | ✅[^lab] ✅[^1] |
| `tls.key`, `tls.cert` | PEM contents | Client certificate (mTLS, mutual TLS). Against `Bun.serve` with `requestCert: true`: a certificate from the lab CA got `200 ok`, none failed with `EPROTO`, a self-signed one with `ECONNRESET` | ✅[^lab] ✅[^1] |
| `decompress` | `true` | Decodes gzip, deflate, br (Brotli) and zstd (Zstandard) bodies. A 34-byte gzip body read as 220 bytes; with `false`, 34 bytes | ✅[^lab] ✅[^1] ✅[^8] |
| `compress` | `false`; `true` = gzip, `"deflate"`, `"br"`, `"zstd"`, `{ encoding, level }` | Compresses a buffered request body and sets `Content-Encoding`: 50,000 bytes arrived as 83 bytes, `gzip`. Stream bodies are sent as they are | ✅[^lab] ✅[^8] |
| `keepalive` | `true` (standard option) | `false` closes the connection after the response; the next request came from a new client port | ✅[^lab] ✅[^1] |
| `maxRedirects` | `126` | With 5 redirects in a chain: `3` → rejected `TooManyRedirects`, `5` and the default → final response, `redirected=true` | ✅[^lab] ✅[^8] |
| `timeout` | milliseconds of idle; default 5 minutes (`BUN_CONFIG_HTTP_IDLE_TIMEOUT`); `0`/`false` off | Fails a request whose connection stays silent: `TimeoutError`, `code` `23`, `The operation timed out.` (timing in Lookup notes) | ✅[^lab] ✅[^8] |
| `signal: AbortSignal.timeout(ms)` | standard | A whole-request deadline: `500` ms against a 1.5 s handler rejected with `TimeoutError` | ✅[^lab] ✅[^1] |
| `protocol` | `"http2"`, `"http1.1"`, `"http3"` (aliases `h2`, `h1`, `h3`) | Forces the HTTP version; experimental, `https` only. Against `Bun.serve({ tls, http2: true, http3: true })` in `bunlab:1`, `verbose` printed `HTTP/1.1 GET` with no option, `"http1.1"` or `"h1"`, `HTTP/2 GET` with `"http2"`/`"h2"` and `HTTP/3 GET` with `"http3"`/`"h3"`; the HTTP/2 and HTTP/3 responses had an empty `statusText`, because an HTTP/2 response carries only a `:status` code, with no reason phrase. `"http2"` against an HTTP/1.1-only server or an `http:` URL rejected with `HTTP2Unsupported`, `"http3"` against a server without HTTP/3 with `HTTP3HandshakeFailed`, and `"spdy"` threw `ERR_INVALID_ARG_TYPE`. `"http3"` refuses some `tls` options (Lookup notes) | ✅[^lab] ✅[^8] ✅[^10] |
| `--experimental-http2-fetch`, `--experimental-http3-fetch` | off; same as `BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT=1` / `..._HTTP3_CLIENT=1` | Change the default when `protocol` is not given: with the first flag, three requests all used HTTP/2; with the second, the first used HTTP/1.1 and, after its `Alt-Svc: h3` answer, the next two used HTTP/3. Both are listed in `bun --help` | ✅[^lab] ✅[^8] |
| `session` / `new Bun.FetchSession(init)` | `{ tls, proxy, keepAlive, unix }` | A keep-alive pool and settings of its own; never shares connections with plain `fetch`. Against a logging TCP server: two `session.fetch` calls, a detached `const f = session.fetch; f(url)` and `fetch(url, { session })` all reused connection 1, plain `fetch` used connection 2 and a second session connection 3. `"preconnect" in session.fetch` was `false`. A session with `proxy` sent its requests through the proxy | ✅[^lab] ✅[^1] |
| `keepAlive` (session) | `true`; `false`; `{ idleTimeout: 300 s, maxIdleSockets }` | `false` opened a new connection per request. `maxIdleSockets: 1` closed two of three idle connections as soon as they were released. `idleTimeout` closed an idle connection after (5 runs each): `1` → 5.0–8.0 s, `4` → 5.0–7.9 s, `5` → 8.9–11.9 s, `9` → 12.8–15.7 s, `12` → 12.7–15.6 s, never before the value | ✅[^lab] ✅[^1] |
| `session.close()`, `Symbol.dispose` | — | `close()` closed the idle connection (the docs add that the session stays usable); a `using session = ...` block closed its connection at block end | ✅[^lab] ✅[^1] |
| `FetchSession` constructor errors | — | `proxy: 8080`, a `proxy` object without `url` and `tls.checkServerIdentity: 1` threw `ERR_INVALID_ARG_TYPE`; `proxy: ""` was accepted. On a request, `proxy: true` threw and `proxy: 8080` was ignored (the session's proxy was used) | ✅[^lab] ✅[^1] |
| `fetch.preconnect(url, { dns, tcp, http, https })` | — | Starts DNS, TCP and TLS early: a TCP server counted 1 connection with no request sent | ✅[^lab] ✅[^1] ✅[^8] |
| `bun --fetch-preconnect <url> script.ts` | — | Preconnect at startup: a TCP server counted one connection while the script sent no request, and none without the flag. Listed in `bun --help` as `Preconnect to a URL while code is loading`. The docs say it is not available on Windows; not run there: the lab has no Windows machine | ✅[^lab] ✅[^1] |
| `BUN_CONFIG_MAX_HTTP_REQUESTS` | `256`, at most `65535` | Caps simultaneous `fetch` requests; extra ones wait in a queue. 300 parallel requests to a 300 ms handler peaked at 256 in flight by default (done in 0.68 s), 10 with `=10` (9.10 s), 300 with `=1000` or `=65535`; `=70000` fell back to 256 | ✅[^lab] ✅[^1] |

### Bun.listen and Bun.connect options
| Option | Used by | Default | Effect | Evidence |
|---|---|---|---|---|
| `hostname`, `port` | both | required | Address to listen on or connect to; `port: 0` let the operating system choose for `Bun.listen` | ✅[^lab] ✅[^9] |
| `unix` | both | — | A Unix socket path instead of host and port: `Bun.listen({ unix: "/tmp/tcp.sock" })` answered a `Bun.connect({ unix })` client with `pong:ping`; `listener.unix` was the path and the client's `remoteAddress` `undefined` | ✅[^lab] ✅[^9] |
| `socket` | both | required | One handler object shared by all sockets of the server | ✅[^2] ✅[^9] |
| `data` | both | `undefined` | Initial `socket.data`: `Bun.listen({ data: { tag: "from listen option" } })` gave every new server socket that value; the lab also set `s.data = { id }` in `open` and read it in `data` | ✅[^lab] ✅[^2] |
| `tls` | both | off | `TLSOptions` (server) or `true`/`TLSOptions` (client). A TLS `Bun.listen` and a `Bun.connect({ tls: { ca, serverName: "localhost" } })` client talked TLS 1.3 (`TLS_AES_128_GCM_SHA256`); `tls: true` trusts only the system CAs and closed against the lab CA (handler table) | ✅[^lab] ✅[^2] ✅[^9] |
| `allowHalfOpen` | both | `false` | `true` keeps your side open after the peer sends FIN (the "I'm done sending" flag). After the client's `shutdown()`, a server with `true` wrote `late reply` 100 ms later and the client received it; with `false` the server closed at once and that write returned `-1` | ✅[^lab] ✅[^9] |
| `exclusive` | both | `false` | Binds the address:port exclusively. On Linux and on macOS 26.1 a second listener on the same port threw `EADDRINUSE` with or without it, and so did a plain listener after an `exclusive` one | ✅[^lab] ✅[^9] |
| `reusePort`, `ipv6Only` | typed on `Bun.connect`; work on `Bun.listen` | — | Socket flags. Two `Bun.listen` with `reusePort: true` shared one port (a second without it, or with `exclusive: true`, got `EADDRINUSE`). On macOS two `Bun.serve` processes with `reusePort: true` both bound, but the last one took all 200 connections (Linux: 107/93; details in [bun-serve.md](bun-serve.md)). `ipv6Only: true` on `hostname: "::"` accepted `::1` and refused `127.0.0.1` (`ECONNREFUSED`); `false` accepted both; the same on macOS | ✅[^lab] ✅[^9] |

### TCP socket handlers
| Handler | Called when | Lab result | Evidence |
|---|---|---|---|
| `open(socket)` | The connection is up (after the handshake for TLS without `handshake`) | Server: `open #1 from 127.0.0.1:35470`. TLS client without `handshake`: `open` ran after the handshake with `authorized` `true`; with a `handshake` handler it ran before, `authorized` was `false` and a `write()` there returned `0` (nothing sent) | ✅[^lab] ✅[^9] |
| `data(socket, data)` | Bytes arrive; a `Buffer` unless `binaryType` is `"arraybuffer"` or `"uint8array"` | Server got `"ping"` as `Buffer`; `binaryType` `"arraybuffer"` gave `ArrayBuffer`, `"uint8array"` `Uint8Array` | ✅[^lab] ✅[^9] |
| `drain(socket)` | The socket can take more data after a short write | A `write()` of 32 MiB returned 2,611,200 in both directions; `drain` ran once on each side, and the peer received exactly 2,611,200 bytes: the unwritten rest is yours to send again | ✅[^lab] ✅[^2] ✅[^9] |
| `end(socket)` | The peer sent FIN | Server: `end (client sent FIN)` after `client.end()` | ✅[^lab] ✅[^9] |
| `close(socket, error?)` | The socket closed | Both sides; `error=none` | ✅[^lab] ✅[^9] |
| `error(socket, error)` | A handler threw, or a TLS session failed | A `data` handler that threw sent each error to `error()` (`boom in data: x`, then `y`) and the socket stayed open. A relay that flipped one byte of a TLS record after the handshake gave the receiver `EPROTO ... DECRYPTION_FAILED_OR_BAD_RECORD_MAC` and the sender `EPROTO ... SSLV3_ALERT_BAD_RECORD_MAC`, in either direction; both sockets then closed | ✅[^lab] ✅[^9] |
| `connectError(socket, error)` | `Bun.connect` failed; the promise still rejects afterwards | Port 1: handler saw `ECONNREFUSED`, promise rejected `ECONNREFUSED` | ✅[^lab] ✅[^9] |
| `timeout(socket)` | `socket.timeout(seconds)` expired | Called once on a 4-second timer: `timeout(1)` and `timeout(2)` fired after 1.6–4.0 s, `timeout(5)` after 5.6–8.0 s (5 runs each, medians 2.8, 2.8 and 6.8 s). The socket stayed open (Lookup notes) | ✅[^lab] ✅[^2] ✅[^9] |
| `handshake(socket, success, authorizationError)` | A TLS handshake finished | Client against the lab CA: `success=true`, `authorizationError=null`, `authorized=true`, `TLSv1.3`. `tls: true` (system CAs only): `success=false`, `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, then closed; `rejectUnauthorized: false`: `success=true` with the same error. The server's `handshake` saw `success=true` and `UNABLE_TO_GET_ISSUER_CERT` (the client sent no certificate) | ✅[^lab] ✅[^9] |

### TCP socket and listener methods
| Member | Returns or does | Lab result | Evidence |
|---|---|---|---|
| `socket.write(data)` | Bytes written; less than the input when the buffer is full; `-1` if closed | `client.write("ping")` → `4`; server echo → `12`; after `end()` → `-1` (`readyState` `-1`) | ✅[^lab] ✅[^9] |
| `socket.end(data?)` | Sends FIN after the data | Server saw `end`, then `close` | ✅[^lab] ✅[^9] |
| `socket.flush()`, `terminate()`, `shutdown(halfClose?)` | Flush, abort, half-close | `flush()` returned `undefined`. After `terminate()` the peer's `close` got `ECONNRESET` and no `end`. `shutdown()` sent FIN (peer `end`) and a later `write()` returned `-1`; `shutdown(true)` stopped reading: the socket's own `end` fired, the peer's data no longer arrived, and its own writes still did | ✅[^lab] ✅[^9] |
| `socket.timeout(s)`, `setNoDelay()`, `setKeepAlive(on, delay)` | Idle timer; turn off Nagle's algorithm (which batches small writes); TCP keep-alive probes | `timeout` in the handler table. `setNoDelay` and `setKeepAlive` returned `true`. `strace` (in `bunlab:2`) showed `TCP_NODELAY=1` already set on every new socket, so Nagle is off by default; `setNoDelay(false)` → `TCP_NODELAY=0`; `setKeepAlive(true, 5000)` → `SO_KEEPALIVE=1`, `TCP_KEEPIDLE=5`, `TCP_KEEPINTVL=1`, `TCP_KEEPCNT=10`; `setKeepAlive(false)` → `SO_KEEPALIVE=0` | ✅[^lab] ✅[^9] ✅[^11] |
| `remoteAddress`, `remotePort`, `localAddress`, `localPort` | Peer and local address | `127.0.0.1`, numeric ports | ✅[^lab] ✅[^9] |
| `socket.reload({ socket })`, `listener.reload({ socket })` | Swap handlers on live sockets | `listener.reload({ socket })` moved existing and new server sockets to the new `data` handler; `socket.reload({ socket: { data } })` moved the client. The docs' form `socket.reload({ data() {} })` threw `Expected "socket" option` | ✅[^lab] ✅[^2] |
| `socket.upgradeTLS(options)` | `[raw, tls]` sockets on the same connection | STARTTLS, a plain connection switched to TLS mid-stream as SMTP (Simple Mail Transfer Protocol) servers do: after `220 go ahead`, the client's `upgradeTLS({ tls: { ca, serverName }, socket })` and the server socket's `upgradeTLS({ tls: { key, cert }, socket })` completed TLS 1.3 (`authorized` `true`, peer `CN=localhost`) and exchanged `AUTH ...` and `secret reply` over TLS. The original handlers kept receiving the encrypted records | ✅[^lab] ✅[^9] ✅[^12] |
| `listener.stop(closeActive?)`, `listener.port`, `listener.hostname`, `unref()` | Stop listening, address, let the process exit | `hostname=127.0.0.1`, `port>0`; `stop(true)` returned without error; after `unref()` a script that still listened exited with code 0 | ✅[^lab] ✅[^2] ✅[^9] |
| Write buffering | None: five 1-byte writes are slower than one 5-byte write; buffer with `ArrayBufferSink` | Each `write()` was one `sendto` system call: 4,000 × `hello` sent 7 times made 140,000 calls as 1-byte writes, 28,000 as 5-byte writes and 7 through `ArrayBufferSink`. Write loop, median of 5: 7.62 ms vs 2.32 ms vs 1.06 ms in `bunlab:2`, 26.84 vs 1.28 vs 0.60 ms in a second run in `bunlab:1`; the receiver was a separate process | ✅[^lab] ✅[^2] |

### Bun.udpSocket
| Option or member | Values (default) | Effect and lab result | Evidence |
|---|---|---|---|
| `Bun.udpSocket({ hostname, port, binaryType, socket })` | `port` chosen by the operating system when left out | Bound `127.0.0.1`; `address` was `{"address":"127.0.0.1","family":"IPv4","port":35306}` | ✅[^lab] ✅[^3] ✅[^9] |
| `socket.data(socket, data, port, address, flags)` | `flags.truncated`, `flags.ipv6` | Server got `"ping"` from `127.0.0.1` with a numeric port and replied. A socket bound to `::` saw `flags.ipv6` `true` for every packet, IPv4 senders as `::ffff:127.0.0.1`. `flags.truncated` stayed `false` even for 65,507 bytes, the largest IPv4 datagram (65,508 threw `EMSGSIZE`) | ✅[^lab] ✅[^9] |
| `send(data, port, address)` | `true`, or `false` when the operating system buffer is full | `true`; the reply `pong:ping` came back. 2,000 × 60 KB to an address with no host and to a closed port also returned `true` every time: the `false` case never occurred on loopback or the Docker bridge | ✅[^lab] ✅[^3] |
| `send(..., "localhost")` | IP addresses only, no DNS | `TypeError: Invalid address` | ✅[^lab] ✅[^3] |
| `sendMany([data, port, addr, ...])` | Number of packets sent | `2` for two packets; both answered. Batches of 50 × 60 KB to a listening port returned `50` (the receiver kept only 63 of 3,000: UDP drops what it cannot hold); to a closed port, `1` | ✅[^lab] ✅[^3] |
| `connect: { hostname, port }` | — | A connected socket: `send("c1")` → `true`, `sendMany(["c2","c3"])` → `2`, `remoteAddress` set; only that peer's packets arrive | ✅[^lab] ✅[^3] |
| `drain(socket)` | — | Called once a full buffer can take more. In the lab it ran once right after the socket was created, before any send, and not again during the floods above | ✅[^lab] ✅[^3] |
| `error(error)` | — | ICMP (Internet Control Message Protocol) errors, the network's "could not deliver" replies, arrive here: sends to a closed port gave `ECONNREFUSED`. The handler got the error as its first argument and `undefined` as the second, unlike the typed `(socket, error)`. Without a handler Bun printed each error with `errqueue: true` and kept running; in one tight loop of 2,000 sends to a closed port, `send()` itself threw `ECONNREFUSED` | ✅[^lab] ✅[^9] |
| `addMembership(group)`, `dropMembership(group)` | — | In `bunlab:1`: `addMembership("239.1.2.3")` → `true` (again → `EADDRINUSE`; `10.0.0.1` → `EINVAL`); `dropMembership` → `true`, after which nothing arrived (again → `EADDRNOTAVAIL`). Between two containers on one Docker network, the member received `hello group` from a third container's sender and a non-member received nothing | ✅[^lab] ✅[^3] ✅[^13] |
| `setMulticastLoopback(on)`, `setMulticastTTL(n)`, `setMulticastInterface(addr)`, `setTTL(n)` | — | Return their argument: `true`/`false`, `1`, `64`; `setMulticastInterface("127.0.0.1")` → `true`. With loopback `true` a receiver in the same container got the group packet (from `192.168.147.4`), with `false` it did not | ✅[^lab] ✅[^3] ✅[^13] |
| `addSourceSpecificMembership(source, group)`, `dropSourceSpecificMembership` | — | Joining `232.1.1.1` for source `192.168.147.4` → `true` and that source's packet arrived; after the drop (`true`) it did not | ✅[^lab] ✅[^3] |
| `setBroadcast(on)` | — | Without it, a send to `192.168.147.255` threw `EACCES`; after `setBroadcast(true)` (→ `true`) it returned `true` and the packet arrived | ✅[^lab] ✅[^3] ✅[^13] |
| `close()`, `closed`, `ref()`, `unref()` | — | `closed` went `false` → `true` across `close()`; `ref`/`unref` are functions | ✅[^lab] ✅[^9] |

### DNS
| API | Values (default) | Effect and lab result | Evidence |
|---|---|---|---|
| `Bun.dns.lookup(host, { family, socketType, port, backend })` | `family` `0`/`4`/`6`/`"IPv4"`/`"IPv6"`/`"any"` | Returns `[{ address, family, ttl }]`; `localhost` → `::1` (family 6) and `127.0.0.1` (family 4) | ✅[^lab] ✅[^9] |
| `backend: "c-ares"` | default on Linux | Reads `/etc/resolv.conf` itself; on Linux the only backend that fills `ttl` (`260` vs `0`); it filled `ttl` on macOS too | ✅[^lab] ✅[^4] ✅[^9] |
| `backend: "system"` / `"getaddrinfo"` (`"libc"`) | `system` default on macOS, Windows, Android | On Linux: same addresses, `ttl: 0`. On macOS 26.1 (2 runs) the default gave the same addresses, order and `ttl` values as `backend: "system"`, and other `ttl` values than `c-ares`, so `system` is the default there; unlike on Linux it filled `ttl` (49 s for the IPv6 and 38 s for the IPv4 addresses of `example.com`, `1` for `localhost`), while `getaddrinfo` and `libc` gave `0`. Windows and Android were not run: the lab has neither | ✅[^lab] ✅[^4] |
| Failed lookup | — | `no-such-host.invalid` → `DNSException`, `code` `DNS_ENOTFOUND` | ✅[^lab] |
| `Bun.dns.prefetch(host, port = 443)` | experimental | Resolves early: stats went to `cacheMisses: 1, size: 1` | ✅[^lab] ✅[^4] ✅[^9] |
| `Bun.dns.getCacheStats()` | experimental | `cacheHitsCompleted`, `cacheHitsInflight`, `cacheMisses`, `size`, `errors`, `totalCount`; two `fetch` calls after the prefetch → `cacheHitsCompleted: 2, totalCount: 3`. A `fetch` that reused a kept-alive connection made no lookup and counted nothing; on macOS a prefetch, a `fetch` and a `Bun.connect` to `localhost` gave `cacheMisses: 1`, then two hits, as on Linux | ✅[^lab] ✅[^4] |
| The connection cache | 256 entries, 30 s each; `BUN_CONFIG_DNS_TIME_TO_LIVE_SECONDS` | Used by `fetch`, `Bun.connect`, `node:net`, `node:tls`, the `node:http` client and `bun install`; a failed connection evicts its host. Lab: `fetch` and `Bun.connect` shared it (one miss, then hits). With the default, a lookup 3 s later was a hit and 32 s later a miss; with `BUN_CONFIG_DNS_TIME_TO_LIVE_SECONDS=1`, 3 s later was a miss; the two 3-second checks gave the same on macOS (2 runs). Three lab results differ from the docs (Lookup notes) | ✅[^lab] ✅[^4] |
| `node:dns` `lookup` / `resolve*` | — | `lookup` uses the `system` backend, `resolve*` use c-ares; `resolve4(host, { ttl: true })` → `[{ address, ttl: 259 }]` | ✅[^lab] ✅[^4] |

### Cookies
| API | Values (default) | Effect and lab result | Evidence |
|---|---|---|---|
| `new Bun.Cookie(name, value, options?)`, `new Bun.Cookie("a=1; Path=/")`, `new Bun.Cookie({ name, value, ... })`, `Bun.Cookie.from(...)` | `path "/"`, `sameSite "lax"`, `secure`/`httpOnly`/`partitioned` `false` | `new Bun.Cookie("a","1").toJSON()` → `{"name":"a","value":"1","path":"/","secure":false,"sameSite":"lax","httpOnly":false,"partitioned":false}` | ✅[^lab] ✅[^5] |
| `cookie.serialize()` / `toString()` | — | `session=abc123; Path=/; Max-Age=3600; Secure; HttpOnly; SameSite=Lax` | ✅[^lab] ✅[^5] |
| `Bun.Cookie.parse(str)` | — | `theme=dark; Path=/app; SameSite=Strict; Secure` → `dark`, `/app`, `strict`, `true` | ✅[^lab] ✅[^5] |
| `cookie.isExpired()` | `maxAge` wins over `expires` | `maxAge: 0` → `true`; no expiry → `false` | ✅[^lab] ✅[^5] |
| `new Bun.CookieMap(init?)` | string, object, or `[name, value]` pairs | `"a=1; b=2"` → `size 2`; `{ a: "1" }` and `[["x", "1"]]` also worked | ✅[^lab] ✅[^5] |
| `map.get(name)`, `has`, `size`, `toJSON()`, iteration | `get` → `null` when missing | After `set("c")` and `delete("a")`: `get("a")` `null`, `toJSON` `{"c":"3","b":"2"}` | ✅[^lab] ✅[^5] |
| `map.set(name, value, options?)`, `set(options)`, `set(cookie)` | `{ path: "/", sameSite: "lax" }` | Adds or replaces: `set({ name: "b", value: "2" })` and `set(new Bun.Cookie("c", "3"))` gave `b=2; Path=/; SameSite=Lax` and `c=3; Path=/; SameSite=Lax` | ✅[^lab] ✅[^5] |
| `map.delete(name, options?)` | — | Becomes a `Set-Cookie` with an empty value and a past date: `a=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax` | ✅[^lab] ✅[^5] |
| `map.toSetCookieHeaders()` | — | `["c=3; Path=/; SameSite=Lax", "a=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax"]` | ✅[^lab] ✅[^5] |
| `req.cookies` in a `Bun.serve` route | a `CookieMap` | `set` calls became `Set-Cookie` headers: `user_id=42; Path=/; HttpOnly; SameSite=Lax`, `theme=dark; Path=/; SameSite=Lax`; a `get` after `set` saw the new value | ✅[^lab] ✅[^6] |
| `req.cookies` in the `fetch` handler | — | Not present (`"cookies" in req` was `false`) and nothing was applied | ✅[^lab] |

### TLS options in Bun.serve
Checked with `openssl s_client` (OpenSSL 3.5.7 in `bunlab:1`) and Bun `fetch` clients against `Bun.serve` on 127.0.0.1.

| Key | Values (default) | Effect and lab result | Evidence |
|---|---|---|---|
| `key`, `cert` | contents (not paths): string, `BunFile`, `TypedArray`, `Buffer`, or an array | Required to enable TLS; in an array only the last pair is used: `key: [a, b], cert: [a, b]` served `CN=b.test`, even to a client asking for `a.test`. With them, `server.protocol` was `https` | ✅[^lab] ✅[^7] |
| `tls: [ {...}, {...} ]` with `serverName` each | — | One certificate per host name (SNI): `a.test` and `b.test` were served their own certificates on one port. A later entry with the same name replaces the earlier: a second `a.test` entry holding the `b.test` pair served `CN=b.test`. `*.x` matches one label: `*.wild.test` served `one.wild.test`, not `two.one.wild.test` or `wild.test`. Those, unknown names and clients without SNI got the first entry's certificate (`CN=a.test`). An entry without `serverName` threw `SNI tls object must have a serverName` | ✅[^lab] ✅[^7] |
| `passphrase` | — | Decrypts an encrypted `key`: a key encrypted with AES-256 (Advanced Encryption Standard, 256-bit key) and `labsecret` served `200`; a wrong or missing passphrase made `Bun.serve` throw `ERR_OSSL_BAD_DECRYPT`; with an unencrypted key it is ignored | ✅[^lab] ✅[^7] |
| `ca` | Mozilla's list | Replaces the trusted CAs; with `requestCert` it decides which client certificates pass | ✅[^lab] ✅[^7] |
| `requestCert` | `false` | `true` asks clients for a certificate (mTLS), verified against `ca`: one from the lab CA got `200`; none got the TLS 1.3 alert `certificate required`; a self-signed one was closed without a response | ✅[^lab] ✅[^7] |
| `rejectUnauthorized` | `true` | With `requestCert`, `false` also accepts clients without a valid certificate: no certificate and a self-signed one both got `200` | ✅[^lab] ✅[^7] |
| `crl` | — | Certificate revocation lists for client certificates: a client certificate listed in the CRL (certificate revocation list) was closed without a response, another from the same CA got `200` | ✅[^lab] ✅[^7] |
| `dhParamsFile` | — | Path to Diffie-Hellman parameters. No effect seen: with a 2048-bit file, a TLS 1.2 client offering only `DHE-RSA-AES128-GCM-SHA256` got `handshake failure`, and a default TLS 1.2 client got `ECDHE-RSA-AES256-GCM-SHA384` | ✅[^lab] ✅[^7] ✅[^9] |
| `lowMemoryMode` | `false` | Memory mode. Accepted and served normally; 1,000 idle TLS connections cost the server about the same with it (9.5 and 9.1 KiB each, two runs) as without (9.2 and 9.6 KiB) | ✅[^lab] ✅[^9] |
| `secureOptions` | — | OpenSSL option bits: `crypto.constants.SSL_OP_NO_TLSv1_3` made the server negotiate TLS 1.2, and a TLS 1.3-only client got the alert `protocol version` | ✅[^lab] ✅[^9] |
| `ALPNProtocols` | string or buffer | ALPN list in wire format, each name preceded by its length byte. On `Bun.listen`: `"\x05lab/1\x02h2"` let clients pick `lab/1` or `h2`, and `Buffer.from("\x05lab/1")` worked too; a plain `"lab/1"` matched nothing; a client whose offer matched nothing got the fatal alert `no application protocol`; an array threw `ERR_INVALID_ARG_TYPE`. `socket.alpnProtocol` was `false` in `open` and the chosen name in `handshake`. On `Bun.serve` it had no effect (no ALPN negotiated); `http2: true` makes Bun offer `h2` itself ([bun-serve.md](bun-serve.md)) | ✅[^lab] ✅[^9] |
| `ciphers` | — | Cipher list for TLS 1.2: with `ECDHE-RSA-AES256-GCM-SHA384`, a TLS 1.2 client offering only `ECDHE-RSA-AES128-GCM-SHA256` got `handshake failure` and one offering the listed suite connected; TLS 1.3 clients still got `TLS_AES_256_GCM_SHA384` | ✅[^lab] ✅[^9] |

## Lookup notes
- **`verbose` output differs from the docs sample.** The docs show lines starting `[fetch] >`; Bun 1.4.5 wrote request lines starting with a space and response lines with `< `, on stderr (sample after this list) ✅[^lab].
- **`decompress: true` keeps the `Content-Encoding` header.** The body was decoded (220 bytes) but `content-encoding` still read `gzip` ✅[^lab]; do not decode it a second time.
- **`timeout` is coarse.** `timeout: 500` let a 3 s silent response through and failed silent 9 s responses after 5.0 s and 8.0 s in two runs; `timeout: 6000` failed after 12.0 s ✅[^lab]. This matches the 4-second socket-timer steps the docs give for `FetchSession` idle timeouts ✅[^1], which the lab saw too (`keepAlive` row) ✅[^lab]. For an exact deadline use `AbortSignal.timeout(ms)`.
- **`keepalive` vs `keepAlive`.** The per-request option is the standard, lowercase `keepalive`; `Bun.FetchSession` takes `keepAlive: { idleTimeout, maxIdleSockets }` ✅[^1] ✅[^lab].
- **Keep a reference to a `FetchSession`.** A session that nothing referenced any more lost its idle connection when garbage collected: in the first idle-timeout run, sessions created inside a function closed their connections after 0–1 s whatever their `idleTimeout`, and after `Bun.gc(true)` an unreferenced session's connection closed while a referenced one stayed open ✅[^lab].
- **`protocol: "http3"` refuses custom trust.** With `tls.ca` or `tls.serverName` it rejected with `HTTP3Unsupported` (the docs name only `serverName`) ✅[^lab] ✅[^1]; with no `tls` it failed `HTTP3HandshakeFailed` against the lab certificate. It worked with `rejectUnauthorized: false` or with the CA in `NODE_EXTRA_CA_CERTS`. `protocol: "http2"` accepted `tls.ca` and `tls.serverName` ✅[^lab].
- **`socket.timeout()` does not close the socket.** The types say the socket closes when the timeout fires ✅[^9]; in the lab the handler ran once and both sides were still open 13 s later, with or without a `timeout` handler ✅[^lab]. Call `socket.end()` in the handler yourself.
- **Do not write in `open` when a TLS socket has a `handshake` handler.** `open` then runs before the handshake and `write()` returned `0`; write in `handshake` (which returned `7` for `ping-hs` and got the echo) ✅[^lab]. Without a `handshake` handler and with a failed check, `open` still ran with `authorized` `false`, `Bun.connect` resolved, and the socket closed with no error ✅[^lab]: check `socket.authorized`.
- **`socket.reload` takes `{ socket: handlers }`.** The TCP docs show `socket.reload({ data() {} })` ✅[^2]; Bun 1.4.5 threw `Expected "socket" option` for that and accepted `socket.reload({ socket: { data } })` ✅[^lab].
- **The UDP `error` handler gets the error first.** The types declare `error(socket, error)` ✅[^9]; the lab handler received `(Error, undefined)` ✅[^lab].
- **DNS cache: three differences from the docs.** The docs list `node:net` and the `node:http` client as users and say a failed connection evicts its host ✅[^4]. In the lab, `node:net` and `node:http` lookups left `getCacheStats()` unchanged (no hit, no miss), a refused `Bun.connect` or `fetch` did not evict the name (the next `fetch` was a hit), and after 301 distinct names `size` was 204, not 256, with the first name still a hit and the last a miss ✅[^lab]. Do not plan around an age-ordered 256-entry cache.
- **`Bun.dns.lookup()` does not show in `getCacheStats()`.** Four lookups left every counter at `0`; only the prefetch and the `fetch` calls counted, on Linux and on macOS ✅[^lab]. Twenty `Bun.dns.lookup("example.com")` calls in a row took 0.49 and 0.99 ms each on average with the macOS default (two runs), against 0.03 ms with c-ares on Linux ✅[^lab].
- **`req.cookies` exists only in route handlers.** In `fetch`, build `new Bun.CookieMap(req.headers.get("cookie") ?? "")` and add `map.toSetCookieHeaders()` to the response yourself ✅[^lab] ✅[^5].
- **`key` and `cert` are contents.** `Bun.file("./key.pem")` works because Bun reads the file ✅[^7]: every lab TLS server used `Bun.file(...)` values ✅[^lab]. A path string is parsed as PEM text, and `Bun.serve` threw `ERR_OSSL_PEM_NO_START_LINE` ✅[^lab].

The `verbose: true` sample from the first note (trimmed; the local port is random):
```
 HTTP/1.1 GET http://localhost:34559/gz
 Accept-Encoding: gzip, deflate, br, zstd
< 200 OK
< Content-Encoding: gzip
```

## Takeaways
- Set `proxy: false` and `redirect: "manual"` when you dial a pre-resolved IP address with a `Host` header and `tls.serverName`, as the docs advise. [rule-candidate]
- Use `AbortSignal.timeout(ms)` for request deadlines; treat the `timeout` option as a coarse idle guard. [rule-candidate]
- Pass IP literals to `Bun.udpSocket().send()`; resolve names with `Bun.dns.lookup` first. [rule-candidate]
- Check what `socket.write()` returns and keep the unwritten rest for `drain`; Bun does not buffer it for you. [rule-candidate]
- Batch small TCP writes (one string, or `ArrayBufferSink`): every `write()` is a system call. [rule-candidate]
- Keep a `FetchSession` in a long-lived variable; an unreferenced one loses its pooled connections.
- Keep cookie handling in `routes` (`req.cookies`) when you can, and use `CookieMap.toSetCookieHeaders()` everywhere else.
- Give `Bun.serve({ tls })` an array with `serverName` per entry when one process serves several host names, and put the default certificate first.

## Verification status
- Verified: 242 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- `linux/lab-setup.md` — the Bun 1.4.5 lab where every ✅[^lab] behaviour ran on 2026-11-24: the `oven/bun:1.4.5` image (arm64); `bunlab:1` (the same Bun plus OpenSSL 3.5.7, used for the test CA, client, revoked and wildcard certificates, the CRL and `openssl s_client`); `bunlab:2` (plus `strace` 6.13); `node:24.22.1-alpine` for the logging forward proxy; and a Docker bridge network between containers for the proxy, DNS, HTTP/2–HTTP/3 and multicast runs. The macOS DNS and socket-option runs (the last just after midnight, on 2026-11-25) used a Bun 1.4.5 binary cross-compiled with `bun build --compile --target=bun-darwin-arm64` and run as the full CLI (`BUN_BE_BUN=1`) with an isolated environment on macOS 26.1 (Apple M2), with the same scripts run in `oven/bun:1.4.5` for comparison; the binary was deleted afterwards. [^lab]
- [Fetch: docs/runtime/networking/fetch.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/networking/fetch.mdx) — Bun documentation source (Oven), 2026. Backs: `proxy` and proxy variables, `NO_PROXY` entries, `respectNoProxy`, `ERR_PROXY_TUNNEL`, `unix`, `tls`, `checkServerIdentity`, `decompress`, `keepalive`, `verbose`, `preconnect`, `--fetch-preconnect`, `FetchSession`, socket-timer steps, request limit, `serverName` and `http3`, error cases. [^1]
- [TCP: docs/runtime/networking/tcp.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/networking/tcp.mdx) — Bun documentation source (Oven), 2026. Backs: `Bun.listen`/`Bun.connect` handlers, `socket.data`, TLS, `stop`, `reload`, no write buffering. [^2]
- [UDP: docs/runtime/networking/udp.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/networking/udp.mdx) — Bun documentation source (Oven), 2026. Backs: `udpSocket`, `send`, IP-only addresses, `sendMany`, connected sockets, `drain`, socket and multicast options. [^3]
- [DNS: docs/runtime/networking/dns.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/networking/dns.mdx) — Bun documentation source (Oven), 2026. Backs: backends and defaults, cache size and TTL (time to live), users of the cache, `prefetch`, `getCacheStats`, `node:dns` backends. [^4]
- [Cookies: docs/runtime/cookies.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/cookies.mdx) — Bun documentation source (Oven), 2026. Backs: `Bun.Cookie` and `Bun.CookieMap` constructors, defaults, methods, `toSetCookieHeaders` outside `Bun.serve`. [^5]
- [Cookies (HTTP server): docs/runtime/http/cookies.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/http/cookies.mdx) — Bun documentation source (Oven), 2026. Backs: `req.cookies` in routes and automatic `Set-Cookie`. [^6]
- [TLS: docs/runtime/http/tls.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/http/tls.mdx) — Bun documentation source (Oven), 2026. Backs: `key`/`cert` contents, arrays, `passphrase`, `ca`, `requestCert`, `rejectUnauthorized`, `crl`, `dhParamsFile`, SNI arrays and matching. [^7]
- [packages/bun-types/globals.d.ts at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/packages/bun-types/globals.d.ts) — Bun source (Oven), 2026. Backs: `BunFetchRequestInit` (`proxy`, `decompress`, `compress`, `maxRedirects`, `timeout`, `protocol` and its aliases, `HTTP2Unsupported`, the HTTP/2 client flag), `fetch.preconnect` options. [^8]
- [packages/bun-types/bun.d.ts at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/packages/bun-types/bun.d.ts) — Bun source (Oven), 2026. Backs: socket options, handlers and methods (`timeout` closing, `setKeepAlive` options, `upgradeTLS`), `udp` types and handler signatures, `dns.lookup` options and `ttl`, `TLSOptions` keys, `FetchSession`. [^9]
- [RFC 9113: HTTP/2](https://www.rfc-editor.org/rfc/rfc9113) — IETF, 2022. Backs: an HTTP/2 response carries only a `:status` code (§8.3.2). [^10]
- [tcp(7)](https://man7.org/linux/man-pages/man7/tcp.7.html) — Linux man-pages project, living. Backs: `TCP_NODELAY` turning off Nagle's algorithm, `TCP_KEEPIDLE`/`TCP_KEEPINTVL`/`TCP_KEEPCNT`. [^11]
- [RFC 3207: SMTP Service Extension for Secure SMTP over TLS](https://www.rfc-editor.org/rfc/rfc3207) — IETF, 2002. Backs: STARTTLS, switching a plain connection to TLS mid-stream. [^12]
- [ip(7)](https://man7.org/linux/man-pages/man7/ip.7.html) — Linux man-pages project, living. Backs: `IP_ADD_MEMBERSHIP`/`IP_DROP_MEMBERSHIP`, `IP_MULTICAST_LOOP`, `IP_MULTICAST_TTL`, `IP_MULTICAST_IF`, broadcast needing `SO_BROADCAST`. [^13]

## Related
- `bun/http-and-networking/bun-serve.md` — the server side of `fetch`, Unix-socket servers, and the `http2`/`http3` server options.
- `bun/http-and-networking/websockets-and-pubsub.md` — the `WebSocket` client's `tls` and `proxy` options.
- `bun/node-compat/nodejs-compatibility.md` — `node:net`, `node:dns`, `node:tls` status.
- `js-runtime/abort-signal.md` — `AbortSignal.timeout` and cancellation.
- `linux/lab-setup.md` — the lab.
