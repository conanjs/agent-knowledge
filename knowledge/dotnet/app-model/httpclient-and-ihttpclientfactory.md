---
schema: knowledge-doc/v1
type: concept
topic: dotnet/app-model
status: verified
applies-to: [".NET 10 (runtime 10.0.12)", "C# 14", "System.Net.Http and Microsoft.Extensions.Http 10.0 (shared framework)", "Microsoft.Extensions.Http.Resilience 11.0.1 (Polly.Core 8.4.2)"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [dotnet, httpclient, ihttpclientfactory, socketshttphandler, connection-pooling, socket-exhaustion, dns, delegatinghandler, timeout, cancellation, streaming, resilience]
ranked-sources: true
---

# HttpClient and IHttpClientFactory

## Summary
**TL;DR:** An `HttpClient` is a thin front over a handler (`SocketsHttpHandler`) that owns a pool of TCP (Transmission Control Protocol) connections. Creating and disposing a client per request throws the pool away each time, which leaves one closed socket in `TIME_WAIT` (the cool-down state a closed TCP connection waits in) per request and can exhaust ports under load; keeping one client forever keeps connections whose DNS (Domain Name System) answer may be stale. Use either one long-lived client with `PooledConnectionLifetime` set, or short-lived clients from `IHttpClientFactory`, which pools and recycles handlers (every 2 minutes by default) and adds a `DelegatingHandler` pipeline, logging and named or typed clients. `HttpClient.Timeout` (100 s) and your own `CancellationToken` both end a request with `TaskCanceledException`; `HttpCompletionOption.ResponseHeadersRead` returns before the body is downloaded.
**Use this when:** choosing how to create `HttpClient`s, seeing `SocketException` or many `TIME_WAIT` sockets, a service keeps calling an old IP address, adding headers or retries to every outgoing call, telling a timeout from a cancellation, or downloading large responses.
**Not this doc:** reading JSON bodies → `dotnet/app-model/system-text-json.md`; registering services → `dotnet/app-model/dependency-injection.md`; cancellation tokens in general → `dotnet/async/cancellation-valuetask-and-async-streams.md`.

## Problem
Two opposite mistakes, both common:
- `using var client = new HttpClient();` inside each request handler. Every call opens a new TCP connection; the closed ones linger, and under load the machine runs out of ports (`SocketException`).
- `static readonly HttpClient client = new();` with no other settings. Connections live forever, DNS is looked up only when a connection opens, and after a failover the app keeps talking to the old address.

Add a few more: a request that hangs for 100 seconds because nobody set a timeout, a 2 GB download buffered into memory, and a typed client captured in a singleton that defeats the factory's recycling.

## Mental model
**Analogy:** an `HttpClient` is a desk phone and the handler is the building's switchboard with a bank of open lines to each destination. Buying a new phone for every call (and throwing it away) also tears down the line, and each torn-down line must cool off before its number can be reused. Keeping one phone and one line forever is cheap, but if the person you call moves, you keep ringing the old address. `IHttpClientFactory` hands out new phones freely while they all share switchboards, and it swaps each switchboard for a fresh one every two minutes.

**Artifact** (run in the lab against a local Kestrel server on `127.0.0.1` ✅[^lab]):
```console
shared client, 5 requests -> client ports 57221,57221,57221,57221,57221
new client per request -> client ports 57222,57223,57224,57225,57226
sockets to :57220 in TIME_WAIT right after: 5
```

## How it works
Five actors take part in a request made through the factory:
- **Your code** — its job: build and send a request, via `HttpClient.GetAsync` / `SendAsync`.
- **`HttpClient`** — its job: apply per-client settings (`BaseAddress`, `Timeout`, default headers), via the handler chain it was built with.
- **`DelegatingHandler`s** — their job: run cross-cutting code around each request, via `SendAsync` overrides chained in registration order.
- **`SocketsHttpHandler`** (the primary handler) — its job: pick or open a pooled TCP connection and speak HTTP, via the connection pool and a DNS lookup when a connection opens.
- **`IHttpClientFactory`** — its job: create clients over cached handler chains and retire chains when their lifetime ends, via `CreateClient(name)` and typed-client registration.

```
CreateClient("api")  (new HttpClient each call, cheap)
   │
   ▼
[LogicalHandler logging] → OuterHandler → CorrelationHandler → [ClientHandler logging] → SocketsHttpHandler
 (factory, outermost)      (your handlers, in registration order)  (factory, innermost)   (pooled connections)
   ▲                                                                                        │ DNS lookup only
   │ the whole chain is cached per client name and replaced after HandlerLifetime (2 min)   │ when a connection
   └──────────────── old chain disposed once no HttpClient uses it ────────────────────────┘ opens
                                                     ═══════ network boundary: TCP to the server ═══════
```

1. **One client, one pool.** An `HttpClient` is a set of settings plus a connection pool, isolated from other clients' pools; it is meant to be created once and reused, and a client per request can exhaust sockets under heavy load, ending in `SocketException` ✅[^api-httpclient]. In the lab one shared client sent 5 requests over one connection (same client port), while 5 short-lived clients used 5 ports and left 5 sockets in `TIME_WAIT` ✅[^lab].
2. **DNS is read only when a connection opens.** `HttpClient` does not track DNS time-to-live; `SocketsHttpHandler.PooledConnectionLifetime` caps a connection's age so that a new connection, and a new lookup, happens ✅[^http-guidelines]. Its default is infinite ✅[^api-pooled-lifetime]; an idle connection is dropped after 1 minute (`PooledConnectionIdleTimeout`) ✅[^api-idle-timeout]. In the lab a new `SocketsHttpHandler` printed `-00:00:00.0010000` (`Timeout.InfiniteTimeSpan`) and `00:01:00` ✅[^lab]; with a 1-second lifetime, requests at 0 s and 0.4 s shared a port and the request at 1.6 s got a new one ✅[^lab].
3. **The two correct patterns.** Use a `static` or singleton client with `PooledConnectionLifetime` set, or short-lived clients from `IHttpClientFactory` ✅[^http-guidelines]. Disposing a client disposes the pool only if the client owns its handler ✅[^http-guidelines]. In the lab a handler passed with `disposeHandler: false` served a new client after the first was disposed, while one owned by a disposed client threw `ObjectDisposedException: Cannot access a disposed object.` ✅[^lab].
4. **What the factory does.** `CreateClient` returns a new `HttpClient` each time over a cached handler; the default handler lifetime is two minutes (`SetHandlerLifetime` changes it); disposing a factory client does not dispose the handler; expired handlers are disposed once no client uses them ✅[^factory]. The lab printed `00:02:00` for `HttpClientFactoryOptions.HandlerLifetime` ✅[^lab].
5. **Named and typed clients.** A named client is configured under a string and created with `CreateClient(name)`; do not derive names from unbounded input ✅[^factory]. A typed client is a class taking `HttpClient` in its constructor, registered by `AddHttpClient<T>()` as a transient service, and must not be registered again separately ✅[^factory]; after an extra `AddTransient<ApiClient>()` the lab's typed client received an `HttpClient` whose `BaseAddress` was null instead of the configured one ✅[^lab].
6. **Outgoing middleware.** `AddHttpMessageHandler<T>()` adds a `DelegatingHandler`; handlers run in the order they are registered, each wrapping the next ✅[^asp-http-requests]. The factory logs under `System.Net.Http.HttpClient.{name}.LogicalHandler` (outside your handlers) and `….ClientHandler` (just before the request is sent) ✅[^asp-http-requests]; the lab output carried both categories ✅[^lab].
7. **Handler dependency-injection (DI) scopes are separate.** The factory creates one DI scope per handler chain, separate from the app's scopes, so a scoped service in a handler is not the request's instance ✅[^factory]. In the lab a `RequestContext` set to `set-in-app-scope` in an app scope arrived at the server as `corr=unset` ✅[^lab].
8. **Timeout versus cancellation.** `HttpClient.Timeout` defaults to 100 seconds (`00:01:40` in the lab ✅[^lab]) and applies to every request of that client ✅[^api-timeout]. Both a timeout and a cancelled token raise `TaskCanceledException`; for a timeout the inner exception is a `TimeoutException` ✅[^httpclient-doc]. The lab printed `The request was canceled due to the configured HttpClient.Timeout of 0,5 seconds elapsing.` (the comma is the lab machine's `en_VN` culture) with inner `TimeoutException` after 506 ms, and `The operation was canceled.` with no `TimeoutException` for a token cancelled at 300 ms ✅[^lab].
9. **Buffering versus streaming.** By default the methods (except `GetStreamAsync`) read the whole body into memory before returning; `HttpCompletionOption.ResponseHeadersRead` completes as soon as headers arrive ✅[^api-httpclient] ✅[^api-completion]. Stream downloads of 50 MB or more ✅[^api-httpclient]. Against a server that sent headers and then the body 1 s later, default `GetAsync` returned after 1,011 ms and `ResponseHeadersRead` after 0 ms ✅[^lab].
10. **Status codes.** `GetAsync` returns the response for any status; `EnsureSuccessStatusCode` throws `HttpRequestException` outside 200–299, and helpers that do not return a response (`GetStringAsync`, `GetFromJsonAsync`) call it for you ✅[^httpclient-doc]. In the lab: `Response status code does not indicate success: 404 (Not Found).` with `StatusCode=NotFound`, thrown by `EnsureSuccessStatusCode`, `GetStringAsync` and `GetFromJsonAsync` alike, while `GetAsync` returned the 404 ✅[^lab].
11. **Thread safety.** `GetAsync`, `PostAsync`, `SendAsync` and the other send methods are thread-safe ✅[^api-httpclient]; settings such as proxy credentials should be changed only before the first request ✅[^api-httpclient]. Setting `Timeout` after a request threw `InvalidOperationException: This instance has already started one or more requests. Properties can only be modified before sending the first request.` ✅[^lab].
12. **Resilience (package `Microsoft.Extensions.Http.Resilience`).** `AddStandardResilienceHandler()` stacks, outermost first, a rate limiter, a 30 s total timeout, a retry (3 retries, exponential back-off with jitter), a circuit breaker and a 10 s attempt timeout; retries and the breaker react to 5xx, 408, 429, `HttpRequestException` and `TimeoutRejectedException`, and retries apply to all methods unless you disable them for unsafe ones ✅[^resilience]. With package 11.0.1 the default options printed `PermitLimit=1000 QueueLimit=0`, `TotalRequestTimeout=00:00:30 AttemptTimeout=00:00:10`, `MaxRetryAttempts=3 BackoffType=Exponential UseJitter=True Delay=00:00:02` and a breaker with `FailureRatio=0.1 MinimumThroughput=100 SamplingDuration=00:00:30 BreakDuration=00:00:05`, the documented defaults ✅[^resilience] ✅[^lab]. Against a local Kestrel server that failed on purpose, 400 and 404 were sent once, while 408, 429, 500, 501 and 503 were each sent 4 times, as was a request to a port with nothing listening (`HttpRequestException: Connection refused`) and a POST answered with 500; after `options.Retry.DisableForUnsafeHttpMethods()` that POST was sent once and a GET still 4 times ✅[^lab]. The jittered back-off left gaps of 1.5, 2.8 and 2.7 s in one run and 1.2, 1.7 and 7.6 s in another, not a fixed 2, 4, 8 s ✅[^lab]. The telemetry log names each strategy (`Standard-Retry`, `Standard-AttemptTimeout`, `Standard-TotalRequestTimeout`, `Standard-CircuitBreaker`) ✅[^lab].

## Worked example
One `IHttpClientFactory` client named `api` with `SetHandlerLifetime(1 s)`, two `DelegatingHandler`s, and a typed `ApiClient` with the same lifetime held by a singleton. The server echoes the client's TCP port ✅[^lab].

| Step | Action | Client port seen by the server | Why |
|---|---|---|---|
| 1 | `c1 = CreateClient("api")`, `c2 = CreateClient("api")` | `ReferenceEquals(c1, c2)` is `False` | a new `HttpClient` per call (How it works 4) |
| 2 | `c1` then `c2` send `/conn` | `59321`, `59321` | both wrap the same cached handler and connection |
| 3 | `c1.Dispose()`, `c3 = CreateClient("api")` | `59321` | disposing a factory client leaves the handler alive |
| 4 | wait 1.5 s, `c4 = CreateClient("api")` | `59518` | handler expired; new chain, new connection, new DNS lookup |
| 5 | old `c2` sends again | `59321` | an existing client keeps its original handler |
| 6 | singleton's typed client, t = 0 and t = 1.5 s | `59519`, then `59519` | captured typed client never gets a new handler |
| 7 | freshly resolved `ApiClient`, t = 1.5 s | `59629` | transient typed client gets the current handler |
| 8 | each `api` request | `OuterHandler: before` → `CorrelationHandler: adds header` → `OuterHandler: after (200)` | registration order, each wrapping the next |

Steps 5 and 6 are why factory clients must be short-lived: the factory recycles handlers, but it cannot reach into a client you kept.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Typed client injected into a singleton | Same connection after the handler lifetime ended (step 6) ✅[^lab] | The factory has no control after creation; use a named client, or `SocketsHttpHandler` with `PooledConnectionLifetime` ✅[^factory] |
| App needs cookies | Avoid the factory | Pooled handlers share one `CookieContainer`, which can leak cookies between unrelated callers ✅[^factory]; in the lab a cookie set through one `CreateClient("c")` was sent by the next one (`sid=abc`), and a separate `HttpClient` sent none ✅[^lab] |
| Factory plus `SocketsHttpHandler` | Supported: `UseSocketsHttpHandler` / `ConfigurePrimaryHttpMessageHandler`, set `PooledConnectionLifetime`, and optionally `SetHandlerLifetime(Timeout.InfiniteTimeSpan)` | The socket handler then does the recycling ✅[^factory]; with a 1 s lifetime and an infinite handler lifetime, factory clients at 0 s, 0 s and 1.5 s used client ports 50132, 50132 and 50133 ✅[^lab] |
| Many concurrent HTTP/1.1 requests to one server | One connection per concurrent request; even a shared client can exhaust sockets | Concurrent HTTP/1.1 connections are unlimited by default; set `MaxConnectionsPerServer` ✅[^api-httpclient]; the lab printed `2147483647` ✅[^lab] |
| `Timeout` below 15 s with a host name | A DNS lookup can take up to 15 s, so the timeout can fire late | Documented on `HttpClient.Timeout` ✅[^api-timeout]; not run, because it needs a DNS server that answers slowly |
| Nothing listening on the port | `HttpRequestException: Connection refused (127.0.0.1:56843)` with `HttpRequestError=ConnectionError` and `StatusCode=null` ✅[^lab] | A transport error, not an HTTP status |
| `ResponseHeadersRead` response never disposed | With `MaxConnectionsPerServer = 1`, the next request waited 2 s until its token fired; after `Dispose()` it went through at once ✅[^lab] | The call returns before the content is read ✅[^api-completion], so the connection stays busy until the body is read or the response disposed |
| Default proxy settings | `HttpClient` reads proxy settings from environment variables or system settings ✅[^api-httpclient]. With `http_proxy` pointing at a local listener, a default client sent `GET http://example.invalid/x HTTP/1.1` to it, and a request to `127.0.0.1` went through it too ✅[^lab] | Loopback is not exempt, so the lab probes set `UseProxy = false` to keep loopback calls on the machine |
| Scoped data (user, tenant) in a `DelegatingHandler` | The handler sees its own scope, not the request's (How it works 7) | Do not cache scope data in handlers; for scope-aware logic, wrap a transient `DelegatingHandler` around `IHttpMessageHandlerFactory.CreateHandler(name)` ✅[^factory] |
| Standard resilience handler, endpoint that answers after 12 s | Attempts started at 0, 12.1 and 23.0 s, each cut by the 10 s attempt timeout and retried, and the call ended after 30,053 ms with `TimeoutRejectedException: The operation didn't complete within the allowed timeout of '00:00:30'.` ✅[^lab] | The attempt timeout sits inside the retry and the total timeout outside it ✅[^resilience] |
| Standard resilience handler, every attempt fails | 25 calls of 4 attempts (100 failures) opened the breaker; the 26th call failed at once with `BrokenCircuitException: The circuit is now open and is not allowing calls.`, reached no server and was not retried; 5.5 s later one trial attempt reached the server, failed, and the breaker opened again ✅[^lab] | The breaker needs 100 attempts in its 30 s window before it judges the 10% failure ratio, and it sits inside the retry, so it counts attempts, not calls ✅[^resilience] ✅[^lab] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| One static `HttpClient` + `SocketsHttpHandler { PooledConnectionLifetime = … }` | Solves port exhaustion and DNS staleness without the factory's overhead ✅[^http-guidelines] | Configuration and handlers wired by hand; one `Timeout` and header set for all callers |
| `IHttpClientFactory` named clients | Several configurations, DI-created handlers, built-in logging ✅[^factory] | String keys; clients must stay short-lived |
| `IHttpClientFactory` typed clients | Strongly typed API per remote service; recommended when you want the factory ✅[^http-guidelines] | Transient: capturing one in a singleton breaks recycling ✅[^factory] |
| `HttpCompletionOption.ResponseHeadersRead` | Low memory, early access to status and headers ✅[^api-completion] | You must read and dispose the stream yourself |
| Standard resilience handler | Retries, breaker and timeouts in one call ✅[^resilience] | Extra package (11.0.1 restored 13 packages, Polly.Core 8.4.2 among them ✅[^lab]); retries non-idempotent methods unless told not to ✅[^resilience], as a POST answered with 500 showed: 4 sends ✅[^lab] |

## Takeaways
- Never create and dispose an `HttpClient` per request; use one long-lived client with `PooledConnectionLifetime`, or `IHttpClientFactory`. [rule-candidate]
- Never hold a factory-created or typed client in a singleton; inject `IHttpClientFactory` and create clients when needed. [rule-candidate]
- Set an explicit `Timeout` (or a per-call token) for every remote dependency; 100 seconds is rarely right. [rule-candidate]
- Use `ResponseHeadersRead` plus streaming for large bodies, and always dispose the response.
- Catch `TaskCanceledException` and check `InnerException is TimeoutException` to tell a timeout from a caller's cancellation.

## Verification status
- Verified: 70 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `dotnet/lab-setup.md` — the .NET SDK 10.0.401 lab (runtime 10.0.12, C# 14, macOS 26.1 arm64) where every behaviour marked with this note ran on 2026-11-24; the resilience probe declared `#:package Microsoft.Extensions.Http.Resilience@11.0.1` and restored it with Polly.Core, Polly.Extensions and Polly.RateLimiting 8.4.2 into the lab's own package folder (Step 11), and every other probe used only the shared framework. [^lab]
- [Guidelines for using HttpClient](https://learn.microsoft.com/en-us/dotnet/fundamentals/networking/http/httpclient-guidelines) — Microsoft, living. Rank 1. Backs: DNS behaviour and `PooledConnectionLifetime`; handler ownership; the two recommended patterns; typed clients recommended. [^http-guidelines]
- [HttpClient Class](https://learn.microsoft.com/en-us/dotnet/api/system.net.http.httpclient) — Microsoft, living. Rank 1. Backs: one pool per instance; instancing and socket exhaustion; `MaxConnectionsPerServer`; buffering, 50 MB guidance; thread-safe methods; proxy settings. [^api-httpclient]
- [HttpClient.Timeout Property](https://learn.microsoft.com/en-us/dotnet/api/system.net.http.httpclient.timeout) — Microsoft, living. Rank 1. Backs: 100-second default; DNS can take 15 s. [^api-timeout]
- [HttpCompletionOption Enum](https://learn.microsoft.com/en-us/dotnet/api/system.net.http.httpcompletionoption) — Microsoft, living. Rank 1. Backs: `ResponseHeadersRead` completes once headers are read. [^api-completion]
- [SocketsHttpHandler.PooledConnectionLifetime Property](https://learn.microsoft.com/en-us/dotnet/api/system.net.http.socketshttphandler.pooledconnectionlifetime) — Microsoft, living. Rank 1. Backs: default infinite. [^api-pooled-lifetime]
- [SocketsHttpHandler.PooledConnectionIdleTimeout Property](https://learn.microsoft.com/en-us/dotnet/api/system.net.http.socketshttphandler.pooledconnectionidletimeout) — Microsoft, living. Rank 1. Backs: default 1 minute. [^api-idle-timeout]
- [Make HTTP requests with the HttpClient class](https://learn.microsoft.com/en-us/dotnet/fundamentals/networking/http/httpclient) — Microsoft, living. Rank 1. Backs: `EnsureSuccessStatusCode`; implicit status checks; `TaskCanceledException` with inner `TimeoutException`. [^httpclient-doc]
- [IHttpClientFactory with .NET](https://learn.microsoft.com/en-us/dotnet/core/extensions/httpclient-factory) — Microsoft, living. Rank 1. Backs: handler caching and 2-minute lifetime; named and typed clients; cookies warning; `SocketsHttpHandler` combination; typed clients in singletons; handler DI scopes. [^factory]
- [Make HTTP requests using IHttpClientFactory in ASP.NET Core](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/http-requests) — Microsoft, living. Rank 1. Backs: handler registration order; `LogicalHandler` and `ClientHandler` log categories. [^asp-http-requests]
- [Build resilient HTTP apps](https://learn.microsoft.com/en-us/dotnet/core/resilience/http-resilience) — Microsoft, living. Rank 1. Backs: standard resilience handler strategies and their order, default values of each strategy, handled errors, retries for all methods, `DisableForUnsafeHttpMethods`. [^resilience]

## Related
- `dotnet/app-model/dependency-injection.md` — transient typed clients and captive dependencies.
- `dotnet/app-model/aspnet-core-pipeline.md` — the server side used by the lab probes.
- `dotnet/app-model/system-text-json.md` — `GetFromJsonAsync` uses the web defaults.
- `dotnet/async/cancellation-valuetask-and-async-streams.md` — tokens, `CancelAfter` and `WaitAsync`.
- `dotnet/errors-and-resources/disposal-and-finalization.md` — disposing responses and streams.
