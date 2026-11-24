---
schema: knowledge-doc/v1
type: concept
topic: go/standard-library
status: verified
applies-to: ["Go 1.27 (go1.27.4)", "ServeMux method and wildcard patterns: Go ≥ 1.22", "httptest.NewTestServer: Go ≥ 1.27"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [go, golang, net-http, servemux, routing, handler, middleware, timeouts, graceful-shutdown, httptest]
ranked-sources: true
---

# HTTP servers and clients with net/http

## Summary
**TL;DR:** A Go HTTP (Hypertext Transfer Protocol) server is a `Handler` — anything with `ServeHTTP(w, r)` — and `http.ServeMux` picks one per request. Since Go 1.22 mux patterns carry a method and wildcards (`"GET /items/{id}"`, read with `r.PathValue("id")`), and the *most specific* matching pattern wins, whatever the registration order. The defaults are unsafe for production: an `http.Server` has no timeouts unless you set them, and `http.DefaultClient` waits forever. The server recovers a panicking handler and drops that connection; the request's context is cancelled when the client goes away; `Shutdown` drains in-flight requests before `Serve` returns `http.ErrServerClosed`.
**Use this when:** you write or review a Go HTTP service, its routing, middleware or timeouts, call another service with `http.Client`, implement graceful shutdown, or test handlers with `net/http/httptest`.
**Not this doc:** choosing status codes and error bodies → `web-apis/http-error-mapping.md`; `context` cancellation in general → `go/concurrency/context-and-cancellation.md`; request bodies as streams → `go/standard-library/io-and-encoding-json.md`; the same timeout and shutdown questions in Node.js → `javascript/node/node-services-deep-dive.md`.

## Problem
A service that works in a demo fails under real clients. A slow or malicious client holds connections open because the server has no read timeouts. An outgoing call to a stuck dependency blocks a goroutine forever because the default client has no timeout. Connections leak because response bodies are never closed. Routes overlap in ways nobody can predict, a handler keeps working after its client left, and a deploy kills requests mid-flight because the process exits without draining.

## Mental model
**Analogy:** the server is a building's front desk. The mux is the directory board that sends each visitor to one office (handler), always choosing the most precise listing ("Room 4B" beats "4th floor"). Middleware is a security guard standing in front of an office door: it sees every visitor, may turn some away, then lets them through. Timeouts are the rule "if you can't say who you're visiting in 5 seconds, please leave". `Shutdown` is closing the front door at 6 p.m. while letting people already inside finish.

**Artifact:** a mux, a wildcard route, middleware and an explicit server, in the shape the lab ran ✅[^1]:
```go
mux := http.NewServeMux()
mux.HandleFunc("GET /items/{id}", func(w http.ResponseWriter, r *http.Request) {
	fmt.Fprintf(w, "item %s", r.PathValue("id"))
})

func logging(next http.Handler) http.Handler { // middleware: a handler that wraps a handler
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		next.ServeHTTP(w, r)
		log.Printf("%s %s", r.Method, r.URL.Path)
	})
}

srv := &http.Server{Addr: ":8080", Handler: logging(mux), ReadHeaderTimeout: 5 * time.Second}
```

## How it works
1. **Handlers.** `Handler` has one method, `ServeHTTP(ResponseWriter, *Request)`; returning from it means the request is finished, and the `ResponseWriter` and `Request.Body` must not be used after or concurrently with that return ✅[^2]. Depending on the client, protocol version and proxies, the body may no longer be readable once the handler has written to the `ResponseWriter`, so cautious handlers read the body first and then reply; apart from reading the body, handlers should not modify the request ✅[^2]. `http.HandlerFunc(f)` adapts any function with that signature into a `Handler` ✅[^2] — which is what makes middleware a plain `func(http.Handler) http.Handler`.
2. **Patterns (Go 1.22).** A pattern is `[METHOD ][HOST]/[PATH]`, each part optional ✅[^2] ✅[^4].
   - No method matches every method; `GET` also matches `HEAD`; any other method must match exactly ✅[^2].
   - `{name}` matches one path segment, `{name...}` the rest of the path including slashes and only at the end; `r.PathValue(name)` returns the match, or `""` when there is none ✅[^2].
   - A trailing `/` matches the whole subtree; `{$}` matches only the end, so `"/{$}"` matches just `/` while `"/"` matches every path ✅[^2].
   - A request whose path matches but whose method does not gets `405 Method Not Allowed` with an `Allow` header ✅[^6].
3. **Precedence.** When several patterns match, the most specific one wins: P1 beats P2 if P1 matches a strict subset of P2's requests ✅[^2]. If neither is more specific they *conflict*, and registering the second one panics; registration order never matters ✅[^2] ✅[^4]. The one exception: of two otherwise conflicting patterns, the one with a host wins ✅[^2]. Setting `GODEBUG=httpmuxgo121=1` restores the pre-1.22 matching ✅[^2].
4. **Redirects and clean-up.** A request for a subtree root without its slash (`/images` when `/images/` is registered) is redirected to add the slash, unless the bare path is registered too ✅[^2]; on Go 1.27.4 the redirect status was `307 Temporary Redirect` ✅[^1]. The mux also redirects paths with `.`, `..` or repeated slashes to a clean form ✅[^2].
5. **Server timeouts.** Each is a `time.Duration` field on `http.Server` ✅[^2]:
   - `ReadTimeout`: the whole request, body included; zero or negative means no timeout.
   - `ReadHeaderTimeout`: the request headers only; if zero, `ReadTimeout` is used; no timeout if both are zero. The docs say most users will prefer it over `ReadTimeout`, because it leaves the body's pace to the handler.
   - `WriteTimeout`: writing the response, reset when a new request's header is read; zero or negative means none.
   - `IdleTimeout`: waiting for the next keep-alive request; if zero, `ReadTimeout` is used.
   In the lab, a client that sent half its headers and stalled was disconnected after about 200 ms with `ReadHeaderTimeout: 200 * time.Millisecond`, and received no response bytes at all ✅[^1].
6. **Client timeouts and bodies.** `http.DefaultClient` is `&Client{}`, used by `http.Get`, `Head` and `Post` ✅[^2], and its `Timeout` printed `0s` in the lab ✅[^1]; a `Timeout` of zero means no timeout ✅[^2]. `Client.Timeout` covers connecting, redirects and reading the body, and keeps running after `Do` returns ✅[^2]. A non-2xx status is not an error; when `err` is nil the body is non-nil and the caller must close it, and a body not read to `EOF` and closed may stop the transport from reusing the TCP (Transmission Control Protocol) connection ✅[^2].
7. **Request context.** For a server request, `r.Context()` is cancelled when the client's connection closes, when the request is cancelled (HTTP/2), or when `ServeHTTP` returns ✅[^2]. In the lab a client with `Timeout: 200 * time.Millisecond` gave up on a 2-second handler (`context deadline exceeded (Client.Timeout exceeded while awaiting headers)`), and the handler, waiting on `r.Context().Done()`, saw `context canceled` ✅[^1].
8. **Panics.** If `ServeHTTP` panics, the server assumes the damage is limited to that request: it recovers, logs a stack trace to the server's error log, and closes the connection (HTTP/1) or resets the stream (HTTP/2); panicking with `http.ErrAbortHandler` aborts the response without the log ✅[^2]. In the lab the server logged `http: panic serving 127.0.0.1:…: boom` and the client got `EOF` instead of a response; with `ErrAbortHandler` the client got the same `EOF` and nothing was logged ✅[^1]. The rest of the program kept running.
9. **Graceful shutdown.** `Shutdown(ctx)` closes the listeners, then idle connections, then waits for active connections to become idle; if `ctx` expires first it returns the context's error ✅[^2]. `Serve` and `ListenAndServe` return `ErrServerClosed` at once, so the program must wait for `Shutdown` itself to return; hijacked connections such as WebSockets are not waited for, and a shut-down server cannot be reused ✅[^2].
10. **Testing without a network.** `httptest.NewServer` starts a real server on a loopback interface (call `Close` when done), and `httptest.NewRecorder` records what a handler writes without any server ✅[^3]. Go 1.27 adds `httptest.NewTestServer(t, handler)`, which uses an in-memory network by default and is meant to work with `testing/synctest` ✅[^3] ✅[^5]. The `httptest` docs now say most tests should use it: it avoids port exhaustion, fails the test if the handler panics with anything but `http.ErrAbortHandler`, and registers a cleanup that shuts the server down, while servers made any other way must be closed with `Close` ✅[^3]. All lab examples ran inside a container with `--network none`, on loopback only ✅[^1].

## Worked example
One mux, six routes, requests sent through `httptest.NewServer` with the logging middleware; redirects not followed. Observed on Go 1.27.4 ✅[^1]:

```go
mux.HandleFunc("GET /items/{id}", …)        // "item <id>"
mux.HandleFunc("POST /items/", …)           // "created"
mux.HandleFunc("/files/{path...}", …)       // "file <path>"
mux.HandleFunc("/images/", …)               // "images subtree"
mux.HandleFunc("/images/thumbnails/", …)    // "thumbnails"
mux.HandleFunc("/{$}", …)                   // "home only"
```

| Request | Result | Why |
|---|---|---|
| `GET /items/42` | `200 "item 42"` | wildcard `{id}` = `42` |
| `HEAD /items/42` | `200 ""` | a `GET` pattern also serves `HEAD` |
| `DELETE /items/42` | `405`, `Allow: GET, HEAD, POST` | path matches `GET /items/{id}` and the subtree `POST /items/`, method matches neither |
| `POST /items/` | `200 "created"` | method pattern |
| `GET /files/a/b/c.txt` | `200 "file \"a/b/c.txt\""` | `{path...}` takes the rest, slashes included |
| `GET /images/thumbnails/cat.png` | `200 "thumbnails"` | the more specific subtree wins over `/images/` |
| `GET /images` | `307`, `Location: /images/` | subtree root without its slash is redirected |
| `GET /` and `GET /nothing` | `200 "home only"`, then `404` | `/{$}` matches only `/` |

Every line was also printed by the middleware (`[log] DELETE /items/42` …), including the 405 and 404, because the middleware wraps the whole mux. Registering `"GET /"` and then `"/index.html"` on a new mux panicked with `pattern "/index.html" … conflicts with pattern "GET /"` — neither pattern is more specific than the other.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `http.Get` to a server that never answers | Blocks forever | `DefaultClient.Timeout` is zero, which means no timeout ✅[^2] ✅[^1] |
| Response body not closed, or not read to the end | Connections may not be reused | The transport can reuse a connection only after the body is read to `EOF` and closed ✅[^2] |
| `"/b_{bucket}"` pattern | Invalid; since Go 1.22 invalid patterns panic on registration | Wildcards must be whole segments ✅[^2] |
| `/a%2Fb/` request against pattern `"/a/b/"` | No match; `"/a%2fb/"` matches | Paths are unescaped segment by segment, `%2F` is not a separator ✅[^2] |
| Handler panics | Connection closed, stack trace logged, server keeps serving ✅[^1] | The server recovers handler panics per request ✅[^2] |
| Client disconnects mid-request | `r.Context().Done()` closes; `Err()` is `context.Canceled` ✅[^1] | Server request contexts end when the connection closes ✅[^2] |
| Program exits right after `ListenAndServe` returns | In-flight requests are cut off | `ListenAndServe` returns `ErrServerClosed` immediately on `Shutdown`; wait for `Shutdown` to return ✅[^2] |
| New request after `Shutdown` | `connect: connection refused` ✅[^1] | Listeners are closed first ✅[^2] |
| WebSocket or other hijacked connection at shutdown | Not waited for | Notify them yourself, for example with `RegisterOnShutdown` ✅[^2] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `ReadHeaderTimeout` only | Stops slow-header clients; handlers set their own pace for bodies ✅[^2] | Slow bodies must be bounded in the handler |
| `ReadTimeout` + `WriteTimeout` | One hard limit per request | No per-request decisions; long uploads and streams are cut ✅[^2] |
| `http.ServeMux` (Go ≥ 1.22) | Methods, wildcards, order-independent precedence in the standard library ✅[^4] | No regular expressions; conflicts panic at startup |
| `httptest.NewRecorder` | No server at all, fastest unit test ✅[^3] | Does not exercise the real connection, timeouts or middleware order around the server |

## Takeaways
- Never serve with the zero-value timeouts: set at least `ReadHeaderTimeout`, plus `IdleTimeout` and a `WriteTimeout` that fits the slowest legitimate response ✅[^2]. [rule-candidate]
- Never call other services with `http.DefaultClient` or `http.Get`; build an `http.Client` with a `Timeout`, or pass a deadline in the request context ✅[^2]. [rule-candidate]
- After a successful `Do`, `defer resp.Body.Close()` and read the body to the end ✅[^2]. [rule-candidate]
- On shutdown, call `srv.Shutdown(ctx)` with a deadline and wait for it to return; treat `http.ErrServerClosed` from `ListenAndServe` as normal ✅[^2]. [rule-candidate]
- Pass `r.Context()` to every downstream call a handler makes, so work stops when the client leaves.
- Write middleware as `func(http.Handler) http.Handler` and wrap the whole mux, so it sees 404s and 405s too.

## Verification status
- Verified: 58 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `go/lab-setup.md` — the Go 1.27.4 lab (`golang:1.27.4`) where every behaviour marked with this note ran on 2026-11-24, with `--network none` and loopback only: the routing table, the conflict panic, `DefaultClient.Timeout`, handler panics and `ErrAbortHandler`, client timeout and request-context cancellation, `ReadHeaderTimeout` on a stalled client, and `Shutdown` with a request in flight. [^1]
- [net/http package](https://pkg.go.dev/net/http) — Go team, living. Rank 1. Backs: `Handler` and `HandlerFunc`, `ServeMux` patterns, precedence, conflicts, redirects and `httpmuxgo121`, `PathValue`, `Server` timeout fields, `DefaultClient`, `Client.Timeout`, closing bodies, request context, handler panics and `ErrAbortHandler`, `Shutdown` and `ErrServerClosed`. [^2]
- [net/http/httptest package](https://pkg.go.dev/net/http/httptest) — Go team, living. Rank 1. Backs: `NewServer`, `NewRecorder`, `NewTestServer` and its in-memory network, the advice that most tests use it, its panic check and cleanup. [^3]
- [Go 1.22 Release Notes](https://go.dev/doc/go1.22) — Go team, 2024. Rank 1. Backs: enhanced routing patterns with methods and wildcards; order-independent precedence. [^4]
- [Go 1.27 Release Notes](https://go.dev/doc/go1.27) — Go team, 2026. Rank 1. Backs: `httptest.NewTestServer` with an in-memory fake network for `testing/synctest`. [^5]
- [Routing Enhancements for Go 1.22](https://go.dev/blog/routing-enhancements) — Go team, 2024. Rank 4. Backs: 405 Method Not Allowed with an `Allow` header. [^6]

## Related
- `go/concurrency/context-and-cancellation.md` — how `r.Context()` cancellation spreads to downstream calls.
- `go/standard-library/io-and-encoding-json.md` — request and response bodies as `io.Reader`s, and decoding JSON bodies safely.
- `go/errors/panic-and-recover.md` — why the server can recover a handler's panic, and when you should not rely on it.
- `go/tooling/testing-benchmarks-and-fuzzing.md` — tests around `httptest` servers, and `testing/synctest`.
- `web-apis/http-error-mapping.md` — mapping errors to status codes and problem details.
- `javascript/node/node-services-deep-dive.md` — the same timeout and shutdown concerns in Node.js.
- `operations/config-at-startup.md` — reading timeouts and ports from configuration at startup.
- `go/learning-path.md`
