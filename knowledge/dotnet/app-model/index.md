---
schema: topic-index/v1
kind: subtopic
topic: dotnet/app-model
last-updated: 2026-11-24
---

# .NET application model

The building blocks every modern .NET service is assembled from, each run in the lab on .NET 10 with the `Microsoft.AspNetCore.App` shared framework (the HTTP resilience handler from its pinned NuGet package, and the .NET 11 JSON naming features in the .NET 11 container): the built-in dependency-injection container and its lifetimes and scopes; the generic host with its layered configuration, the options pattern, logging, hosted services and graceful shutdown; JSON with `System.Text.Json`; outgoing HTTP with `HttpClient` and `IHttpClientFactory`; and the ASP.NET Core request pipeline (Kestrel, middleware, routing, minimal APIs, error handling, controllers). Not covered: Blazor, Razor Pages and MVC views, SignalR, gRPC, authentication and authorization schemes, Entity Framework Core, OpenAPI generation, and third-party containers or resilience libraries beyond what the official docs say about them.

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [dependency-injection.md](dependency-injection.md) | concept | `ServiceCollection` and `ServiceProvider`; transient, scoped and singleton; scopes, captive dependencies, `ValidateScopes` and `ValidateOnBuild`; disposal by the container; factories, multiple registrations, `TryAdd`, keyed services, open generics, constructor selection | verified |
| [host-configuration-options-and-logging.md](host-configuration-options-and-logging.md) | concept | `Host.CreateApplicationBuilder` defaults; configuration providers and precedence (`__` in environment variables); binding; `IOptions`, `IOptionsSnapshot`, `IOptionsMonitor`, `ValidateOnStart`; hosted services, `BackgroundService` and shutdown; `ILogger`, levels, message templates, scopes | verified |
| [system-text-json.md](system-text-json.md) | concept | `JsonSerializer` defaults versus `Web` and `Strict`; reusing options; naming, enums, required and nullable handling; converters; polymorphism; `JsonNode`, `JsonDocument`, `Utf8JsonReader`; source generation; differences from Newtonsoft.Json | verified |
| [httpclient-and-ihttpclientfactory.md](httpclient-and-ihttpclientfactory.md) | concept | Connection pooling, socket exhaustion and stale DNS; `PooledConnectionLifetime`; `IHttpClientFactory` handler recycling, named and typed clients, `DelegatingHandler` pipeline; timeouts versus cancellation; `ResponseHeadersRead`; the standard resilience handler measured against a failing local server (retries, timeouts, circuit breaker) | verified |
| [aspnet-core-pipeline.md](aspnet-core-pipeline.md) | concept | Kestrel, middleware order and short-circuiting, routing and endpoints, minimal API binding, results and filters, .NET 10 validation, exception handling and problem details, the per-request DI scope, `HttpContext` lifetime, controllers | verified |

## References
- [.NET fundamentals: Dependency injection, configuration, logging and the generic host](https://learn.microsoft.com/en-us/dotnet/core/extensions/generic-host) — Microsoft, living. Backs: subtopic scope.
- [ASP.NET Core fundamentals overview](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/) — Microsoft, living. Backs: subtopic scope.

## Related
- `dotnet/lab-setup.md` — how every probe in these docs was run.
- `dotnet/async/tasks-and-async-await.md` — the async code every host, handler and client uses.
- `dotnet/metaprogramming/source-generators.md` — `[LoggerMessage]` and the JSON source generator.
- `dotnet/errors-and-resources/disposal-and-finalization.md` — what the container's disposal builds on.
