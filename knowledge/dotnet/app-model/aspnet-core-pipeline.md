---
schema: knowledge-doc/v1
type: concept
topic: dotnet/app-model
status: verified
applies-to: [".NET 10 (runtime 10.0.12)", "C# 14", "ASP.NET Core 10.0 (Microsoft.AspNetCore.App 10.0.12)"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [dotnet, aspnet-core, kestrel, middleware, routing, endpoints, minimal-apis, parameter-binding, endpoint-filters, problem-details, exception-handling, httpcontext, controllers]
ranked-sources: true
---

# The ASP.NET Core request pipeline

## Summary
**TL;DR:** Kestrel turns each HTTP request into an `HttpContext` and hands it to a chain of middleware, each of which can act before and after calling `next`, or stop the chain (short-circuit). Routing middleware (`UseRouting`) picks one endpoint from the URL and method; the endpoint middleware at the end runs it. A minimal API endpoint binds its parameters from the route, query, headers, JSON body and dependency-injection (DI) services, runs its endpoint filters, and turns the return value into a response. Order is everything: exception handling first, routing before anything that needs the endpoint, and nothing may change status or headers once the body has started. Every request gets its own DI scope; `HttpContext` is valid only during its request.
**Use this when:** a middleware runs in the wrong order or not at all, a route returns 404 or 405 unexpectedly, a parameter will not bind (400, 415), errors come back as empty 500s, you choose between `Results` and `TypedResults`, between filters and middleware, or between minimal APIs and controllers, or `HttpContext` throws in background code.
**Not this doc:** the container and lifetimes → `dotnet/app-model/dependency-injection.md`; configuration, logging and the generic host → `dotnet/app-model/host-configuration-options-and-logging.md`; JSON options for bodies → `dotnet/app-model/system-text-json.md`; calling other services → `dotnet/app-model/httpclient-and-ihttpclientfactory.md`.

## Problem
The same few lines of `Program.cs` produce very different behaviour depending on order and on small details:
- An exception returns an empty `500` with no clue, or a full stack trace, depending on the environment.
- `GET /items/abc` against `/items/{id:int}` gives `404`, not `400`.
- Middleware that reads `context.GetEndpoint()` sees `null`.
- Setting a status code after writing the body throws.
- Code that saves `HttpContext` for later crashes with `ObjectDisposedException`.

## Mental model
**Analogy:** an airport security line. Each station (middleware) takes the tray, may inspect or tag it, passes it on, and gets it back on the return trip; a station can also stop the tray and send the passenger back (short-circuit). Halfway along, the gate desk (routing) reads the boarding pass and assigns a gate (endpoint); stations after the desk know the gate. The plane (endpoint handler) is at the end. The tray (`HttpContext`) belongs to one passenger and is recycled as soon as they leave.

**Artifact** (run in the lab: two `Use` middlewares, one before and one after `UseRouting` ✅[^lab]):
```console
GET /hello -> 200 text/plain | literal /hello
    trace: A before (endpoint=null) -> C after UseRouting (endpoint=HTTP: GET /hello) -> A after (200)
GET /secret/x -> 401 application/problem+json | {"type":"https://tools.ietf.org/html/rfc9110#section-15.5.2","title":"Unauthorized","status":401,…}
    trace: A before (endpoint=null) -> B short-circuit 401 -> A after (401)
```

## How it works
Five actors handle a request:
- **Kestrel** — its job: accept connections and parse HTTP into an `HttpContext`, via its socket listener (the cross-platform default server).
- **Middleware pipeline** — its job: run cross-cutting steps in the order the app added them, via `Use`, `Run`, `Map` and built-in `Use…` methods.
- **Routing** — its job: choose the endpoint for the URL and method, via `UseRouting` (matching) and endpoint execution at the end.
- **Endpoint** — its job: bind parameters, run endpoint filters and the handler, and write the result, via `MapGet`/`MapPost` (minimal APIs) or controllers.
- **Request DI scope** — its job: own scoped services for this request, via `HttpContext.RequestServices`.

```
socket ─► Kestrel ─► HttpContext + request scope (RequestServices)
                         │
   UseExceptionHandler ──┤ catches anything thrown below; writes problem details
   UseStatusCodePages ───┤ adds a body to empty 4xx/5xx on the way back
   Use(A) ───────────────┤ before → next → after
   Use(B) ── short-circuit? return without next ─────────────────┐
   UseRouting ───────────┤ sets Endpoint + RouteValues           │
   Use(C) ───────────────┤ GetEndpoint() is now known            │
   endpoint execution ───┘ bind params → filters → handler → IResult
                         ▲ response travels back up through every "after"
   end of request: scope disposed, HttpContext returned to Kestrel
```

1. **Kestrel.** Kestrel is the recommended, cross-platform server ✅[^kestrel]. With no endpoint configuration it listens on `http://localhost:5000`, and port `0` makes it bind any free port, readable through `IServerAddressesFeature` ✅[^kestrel-endpoints]; every lab probe used `http://127.0.0.1:0` and read the bound address that way ✅[^lab].
2. **Middleware order.** Middleware runs in the order it is added for the request and in reverse for the response; each delegate can work before and after `next` ✅[^middleware]. `Run` is terminal and anything added after the first `Run` never runs ✅[^middleware]. Exception-handling middleware belongs early, so it can catch errors from later stages ✅[^middleware].
3. **Short-circuiting and the started response.** A middleware that does not call `next` ends the request; earlier middleware still runs its "after" code ✅[^middleware] ✅[^lab]. Once the response has started, changing headers or status throws, and writing after `next` can corrupt the body ✅[^middleware]; check `HttpResponse.HasStarted` ✅[^middleware].
4. **Branching.** `Map("/branch", …)` runs a separate pipeline for paths that start with the prefix and moves the matched segments from `Path` to `PathBase`; `MapWhen` branches on any predicate, and `UseWhen` rejoins the main pipeline ✅[^middleware]. The lab's `/branch/deep/path` saw `PathBase=/branch Path=/deep/path` ✅[^lab].
5. **What `WebApplication` adds for you.** It adds the developer exception page first in `Development`, `UseRouting` second if you did not call it and endpoints exist, authentication and authorization after routing when those services are registered, and endpoint execution at the very end ✅[^middleware].
6. **Routing.** Routing sets the chosen `Endpoint` and route values on the `HttpContext`; middleware after it can read `GetEndpoint()` and its metadata, and the endpoint's delegate runs after all middleware ✅[^routing]. Among matches, the more specific template wins: literal segments beat parameters, and constrained parameters beat unconstrained ones; a tie at the same priority throws an ambiguous-match exception at request time ✅[^routing]. No match gives `404` ✅[^routing].
7. **Parameter binding.** A minimal API handler's parameters are bound from route values, query string, headers, the JSON body, form values and DI services, explicitly with `[From…]` attributes or by inference ✅[^binding]. Inference order: special types (`HttpContext`, `HttpRequest`, `CancellationToken` = `RequestAborted`, `ClaimsPrincipal`, …), then `BindAsync`, then `string`/`TryParse` types from the route or else the query, then registered services, then the body ✅[^binding]. `GET`, `HEAD`, `OPTIONS` and `DELETE` never bind the body implicitly ✅[^binding]. Failures: a missing required or unparsable value gives `400`, bad JSON `400`, a wrong content type `415` ✅[^binding].
8. **Return values.** A `string` is written as `text/plain` with `200`; any other object is JSON-serialized with `200`; an `IResult` decides the response itself ✅[^responses]. `TypedResults` return concrete result types, which helps tests and OpenAPI metadata, and needs a `Results<T1, …>` return type when one handler returns several kinds ✅[^responses]. JSON bodies use `System.Text.Json` with the web defaults (camelCase) ✅[^binding] ✅[^lab].
9. **Endpoint filters.** `AddEndpointFilter` wraps the handler; code before `next` runs first-in-first-out and code after `next` first-in-last-out, and a filter can return a result without calling `next` ✅[^filters]. The lab printed `F1 before -> F2 before -> handler -> F2 after -> F1 after`, and `F1 before -> F2 before -> F2 short-circuit -> F1 after` for an invalid body ✅[^lab].
10. **Validation (.NET 10).** `builder.Services.AddValidation()` makes minimal APIs validate data-annotation attributes on bound parameters before the handler runs, using a source generator ✅[^validation]. Without it, invalid input reaches the handler ✅[^validation]. In the lab `{"sku":"","qty":0}` got `200` without and `400` with `"Qty":["The field Qty must be between 1 and 100."]` ✅[^lab].
11. **Errors and problem details.** The developer exception page is on by default in `Development` for apps built with `WebApplication.CreateBuilder` ✅[^errors]. `UseExceptionHandler` catches exceptions in later middleware and re-executes or writes a response, but not once the response has started ✅[^errors]. `IExceptionHandler` implementations are singletons tried in registration order, and they run only if `UseExceptionHandler` is in the pipeline ✅[^errors]. `AddProblemDetails` produces problem-details bodies for error responses that have no body yet ✅[^errors-api].
12. **One DI scope per request.** The framework creates a scope per request and exposes it as `HttpContext.RequestServices`; scoped services live as long as the request ✅[^asp-di]. In the lab the middleware and the handler of one request saw the same scoped `RequestId` (`c59df6f3`), and the next request a new one (`36146ec2`) ✅[^lab].
13. **`HttpContext` is not thread-safe.** Using it outside the request can fail; copy the data you need and pass the copy to background work ✅[^httpcontext]. A `CancellationToken` parameter is `HttpContext.RequestAborted` ✅[^binding]. When the lab client gave up after 300 ms, the handler's `Task.Delay` was cancelled ✅[^lab].
14. **Controllers.** `AddControllers()` plus `MapControllers()` add controller endpoints; with `[ApiController]`, attribute routing is required and invalid models get an automatic `400` ✅[^webapi]. The lab's `[ApiController]` returned `400` with `"Name":["The Name field is required."]` for an empty name, and `201` otherwise ✅[^lab].

## Worked example
One run of the pipeline probe in `Production`, with `UseExceptionHandler` + `AddProblemDetails`, `UseStatusCodePages`, an `IExceptionHandler` for `ConflictException`, and these endpoints: `/hello`, `/{message}`, `/items/{id:int}`, `/dup` twice, `/boom` (throws), `/conflict` (throws `ConflictException`), `/late-error` ✅[^lab]:

| Request | Status | Body / note | Rule |
|---|---|---|---|
| `GET /hello` | 200 | `literal /hello` | literal beats `/{message}` (How it works 6) |
| `GET /world` | 200 | `parameter /{message} = world` | parameter route |
| `GET /items/42` | 200 | `item 42` | constraint matches |
| `GET /items/abc` | 404 | problem details `"title":"Not Found"` | a failed constraint is "no match", not a bad request |
| `POST /hello` | 405 | `"title":"Method Not Allowed"`; endpoint name `405 HTTP Method Not Supported` | path matched, method did not |
| `GET /secret/x` | 401 | B short-circuited; A still ran its "after" | How it works 3 |
| `GET /dup` | 500 | `AmbiguousMatchException`; only "A before" ran | thrown inside `UseRouting` |
| `GET /boom` | 500 | generic problem details, `"status":500` with the standard "An error occurred while processing…" title | `UseExceptionHandler` + problem details |
| `GET /conflict` | 409 | `"title":"Conflict","detail":"order 7 changed"` | the `IExceptionHandler` handled it |
| `GET /late-error` | 200 | `partial body...`; setting 500 threw `StatusCode cannot be set because the response has already started.` | headers were already sent |
| `GET /a/b/c` | 404 | problem details | no route; `UseStatusCodePages` added the body |

Rerun without `UseExceptionHandler`: in `Production` `/boom` and `/dup` returned `500` with an empty body; in `Development` the developer exception page returned `application/problem+json` (because `AddProblemDetails` was registered and the client did not ask for HTML) with `"title":"System.InvalidOperationException"` and the stack, and `/conflict` was `500` because the `IExceptionHandler` was never called ✅[^lab].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Route constraint used for input validation | `404` for bad input ✅[^lab] | Constraints disambiguate routes; the docs say not to use them for validation, because invalid input should be `400` ✅[^routing] |
| Two endpoints with the same template | Starts fine, then `500` per request; in `Development` the detail lists `HTTP: GET /dup`, `HTTP: GET /dup`, `HTTP: GET /{message}` ✅[^lab] | Ambiguity can only be detected per request ✅[^routing] |
| `IExceptionHandler` registered, no `UseExceptionHandler` | Never called; plain `500` ✅[^lab] | The middleware is what invokes the handlers ✅[^errors] |
| `UseExceptionHandler()` with no path, no problem details, no lambda | `app.StartAsync()` threw `InvalidOperationException: An error occurred when configuring the exception handler middleware. Either the 'ExceptionHandlingPath' or the 'ExceptionHandler' property must be set…` ✅[^lab] | A fallback is required ✅[^errors] |
| `HttpContext` read from `Task.Run` 300 ms after the response | `ObjectDisposedException: IFeatureCollection has been disposed.` ✅[^lab] | The context ends with its request ✅[^httpcontext] |
| `int page` query parameter missing / `?page=two` | `400`, empty body ✅[^lab] | Required and unparsable values fail binding ✅[^binding] |
| `POST` with `text/plain` to a JSON-body handler | `415` ✅[^lab] | Body binding expects `application/json` ✅[^binding] |
| Validation attribute on a record property with `[property: Required]`, MVC (Model-View-Controller) controller | `500`: `InvalidOperationException: Record type 'ProductIn' has validation metadata defined on property 'Name' that will be ignored…` ✅[^lab] | Put the attribute on the constructor parameter (`[Required] string Name`) |
| Minimal API body with data annotations, no `AddValidation()` | Invalid input reaches the handler (`200`) ✅[^lab] | Validation is opt-in in .NET 10 ✅[^validation] |
| Endpoint returns `Results<Ok<T>, NotFound>` | `200` JSON or `404` with no body ✅[^lab] | Each branch is a concrete typed result ✅[^responses] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Minimal APIs | Little ceremony; filters, `TypedResults` and .NET 10 validation ✅[^responses] ✅[^validation] | Organization (groups, files) is up to you |
| Controllers with `[ApiController]` | Conventions, automatic `400` for invalid models ✅[^webapi] | More types; attribute routing required ✅[^webapi] |
| `TypedResults` | Compile-time result types, OpenAPI metadata without `Produces` ✅[^responses] | Verbose return types (`Results<…>`) ✅[^responses] |
| Middleware | Sees every request, including unmatched ones ✅[^middleware] | No access to bound parameters |
| Endpoint filter | Sees the bound arguments (`GetArgument<T>`) of one endpoint ✅[^filters] | Runs only for that endpoint |
| `UseExceptionHandler` + `AddProblemDetails` | Uniform `application/problem+json` errors ✅[^errors-api] | Clients get a generic title, not the exception detail ✅[^lab] |

## Takeaways
- Register error handling first (`UseExceptionHandler` with `AddProblemDetails`), then routing, then middleware that needs the endpoint, then endpoints. [rule-candidate]
- Never set status or headers after writing to the body; use `Response.OnStarting` or decide before the first write. [rule-candidate]
- Never keep `HttpContext` (or anything from `RequestServices`) beyond the request; copy the values a background task needs. [rule-candidate]
- Validate input explicitly (`AddValidation()`, filters or `[ApiController]`); route constraints only choose between routes.
- Return `TypedResults` from minimal APIs so tests and OpenAPI see the real result types.

## Verification status
- Verified: 72 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `dotnet/lab-setup.md` — the .NET SDK 10.0.401 lab (runtime 10.0.12, C# 14, macOS 26.1 arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- [ASP.NET Core Middleware](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/middleware/) — Microsoft, living. Rank 1. Backs: order and reverse order; `Use`, `Run`, `Map`, `MapWhen`, `UseWhen`; short-circuiting; started responses; middleware added by `WebApplication`. [^middleware]
- [Routing in ASP.NET Core](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/routing) — Microsoft, living. Rank 1. Backs: endpoint and route values on `HttpContext`; precedence; ambiguity; 404; constraints are not validation. [^routing]
- [Parameter binding in Minimal API apps](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/parameter-binding) — Microsoft, living. Rank 1. Backs: sources, precedence, special types, no implicit body for GET, failure status codes, System.Text.Json for bodies. [^binding]
- [Create responses in Minimal API applications](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/responses) — Microsoft, living. Rank 1. Backs: `string`, object and `IResult` returns; `TypedResults` versus `Results`. [^responses]
- [Filters in Minimal API apps](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/min-api-filters) — Microsoft, living. Rank 1. Backs: FIFO before, FILO after; short-circuit; `GetArgument`. [^filters]
- [Validation in ASP.NET Core](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/validation) — Microsoft, living. Rank 1. Backs: `AddValidation`, source generator, no validation without it. [^validation]
- [Handle errors in ASP.NET Core](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/error-handling) — Microsoft, living. Rank 1. Backs: developer exception page default; `UseExceptionHandler` behaviour; `IExceptionHandler` order, lifetime and dependence on the middleware; startup error without a fallback. [^errors]
- [Handle errors in ASP.NET Core APIs](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/error-handling-api) — Microsoft, living. Rank 1. Backs: `AddProblemDetails` for responses without a body. [^errors-api]
- [Access HttpContext in ASP.NET Core](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/http-context) — Microsoft, living. Rank 1. Backs: not thread-safe; copy data for background work. [^httpcontext]
- [Dependency injection in ASP.NET Core](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/dependency-injection) — Microsoft, living. Rank 1. Backs: one scope per request; `RequestServices`. [^asp-di]
- [Kestrel web server in ASP.NET Core](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/servers/kestrel) — Microsoft, living. Rank 1. Backs: recommended cross-platform server. [^kestrel]
- [Configure endpoints for the ASP.NET Core Kestrel web server](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/servers/kestrel/endpoints) — Microsoft, living. Rank 1. Backs: default `http://localhost:5000`; port 0 and `IServerAddressesFeature`. [^kestrel-endpoints]
- [Create web APIs with ASP.NET Core](https://learn.microsoft.com/en-us/aspnet/core/web-api/) — Microsoft, living. Rank 1. Backs: `[ApiController]` attribute routing and automatic 400. [^webapi]

## Related
- `dotnet/app-model/dependency-injection.md` — the scope each request gets.
- `dotnet/app-model/host-configuration-options-and-logging.md` — `WebApplication.CreateBuilder` uses the generic host's configuration and logging.
- `dotnet/app-model/system-text-json.md` — the web defaults for request and response bodies.
- `dotnet/app-model/httpclient-and-ihttpclientfactory.md` — the client side used by the lab probes.
- `dotnet/async/synchronization-context-and-configureawait.md` — ASP.NET Core has no synchronization context.
- `dotnet/errors-and-resources/exceptions.md` — exceptions in general.
