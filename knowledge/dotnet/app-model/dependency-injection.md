---
schema: knowledge-doc/v1
type: concept
topic: dotnet/app-model
status: verified
applies-to: [".NET 10 (runtime 10.0.12)", "C# 14", "Microsoft.Extensions.DependencyInjection 10.0 (shared framework)"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [dotnet, csharp, dependency-injection, ioc, service-lifetimes, scopes, captive-dependency, keyed-services, open-generics, disposal]
ranked-sources: true
---

# Dependency injection with Microsoft.Extensions.DependencyInjection

## Summary
**TL;DR:** You register services in an `IServiceCollection` (a list of recipes), build it once into an `IServiceProvider` (the container), and let the container call constructors for you. Each registration has a lifetime: transient (new object every time), scoped (one per scope, usually one per web request) or singleton (one per container). The container also disposes what it created, at the end of the owning scope or of the container. The two classic bugs are a scoped service resolved from the root container and a singleton that captures a scoped one; `ValidateScopes` and `ValidateOnBuild` catch both, and the generic host turns them on only in the `Development` environment.
**Use this when:** choosing a lifetime, a service is "shared between requests" by surprise, an `InvalidOperationException` names "scoped service" or "root provider", a disposable is never disposed, or you need several implementations of one interface (enumerable, keyed, open generic).
**Not this doc:** the host that owns the container, configuration and options → `dotnet/app-model/host-configuration-options-and-logging.md`; the per-request scope in ASP.NET Core → `dotnet/app-model/aspnet-core-pipeline.md`; `IDisposable` itself → `dotnet/errors-and-resources/disposal-and-finalization.md`.

## Problem
A class that creates its own dependencies with `new` is hard to swap, hard to test and repeats the wiring everywhere it is used. The built-in container solves that, but it brings its own surprises:
- A `DbContext`-like scoped object resolved in a background service lives for the whole process.
- A singleton that takes a scoped service in its constructor keeps the first instance forever (a "captive dependency").
- A transient `IDisposable` resolved from the root container is kept alive until shutdown: a memory leak.
- Registering two implementations of one interface silently makes the last one win.

## Mental model
**Analogy:** a hotel's front desk with a recipe book. Each recipe says how to make one item and how long a guest may keep it. A transient item is a fresh towel every time anyone asks. A scoped item is the room key: one per stay (scope), handed back at checkout. A singleton is the lobby: one for the whole hotel, closed only when the hotel closes. The front desk, not the guest, throws away what it handed out, at checkout or at closing time.

**Artifact** (run in the lab ✅[^lab]):
```csharp
var services = new ServiceCollection();
services.AddTransient<TransientDep>();
services.AddScoped<ScopedDep>();
services.AddSingleton<SingletonDep>();
using var root = services.BuildServiceProvider();
using var a = root.CreateScope(); using var b = root.CreateScope();
// transient: two resolves -> two objects            -> transient same? False
// scoped: same inside scope a, different in b       -> True / False
// singleton: same from the root and from scope b    -> True
```

## How it works
Four actors take part in every resolution:
- **`IServiceCollection`** — its job: hold the registrations, via a list of `ServiceDescriptor` objects (service type, implementation or factory, lifetime).
- **Root `ServiceProvider`** — its job: work out once per service how to build it (a "call site": which constructor, which dependencies) and own the singletons, via `BuildServiceProvider()`.
- **`IServiceScope`** — its job: own scoped and disposable transient instances for one unit of work, via `CreateScope()` / `CreateAsyncScope()`.
- **Your constructor** — its job: declare what it needs, via its parameter list.

```
startup (once)                     per unit of work (request, message, job)
───────────────                    ─────────────────────────────────────────
services.AddScoped<UnitOfWork>()   scope = root.CreateScope()
services.AddSingleton<Clock>()       │
        │                            ├─ scope.ServiceProvider.GetRequiredService<OrderHandler>()
        ▼                            │     transient → new OrderHandler(...)
BuildServiceProvider(options)        │     Clock      → root cache (one per container)
  ValidateOnBuild: try every         │     UnitOfWork → scope cache (one per scope)
  descriptor now                     │
        │                            └─ scope.Dispose(): disposes scoped + transient
        ▼                                 disposables it created, newest first
root provider ───────────────────── root.Dispose(): disposes singletons it created
```

1. **Registration is a list.** `IServiceCollection` is a collection of `ServiceDescriptor` objects, and every `Add{Lifetime}` method just adds one ✅[^di-registration]. Registration order does not matter, except when one service type has several implementations ✅[^di-registration].
2. **Building the provider.** `BuildServiceProvider()` creates the container ✅[^di-overview]. `ServiceProviderOptions.ValidateScopes` checks that scoped services are never resolved from the root provider, and `ValidateOnBuild` tries to create every service at build time ✅[^api-spo]. A plain `new ServiceProviderOptions()` has both set to `False`; the generic host enables both when the environment is `Development` ✅[^generic-host] ✅[^lab].
3. **Constructor selection.** The container needs a public constructor ✅[^di-overview]. With several, it picks the one with the most parameters that it can resolve; if two such constructors tie, it throws ✅[^di-overview]. In the lab, a class with `()`, `(ILogger<T>)` and `(ILogger<T>, Missing)` got the `(ILogger)` one, and two one-parameter constructors failed with `The following constructors are ambiguous` ✅[^lab].
4. **Lifetimes.** Transient: created each time it is requested. Scoped: one per scope; in web apps, one per client request. Singleton: created on first request (or supplied by you) and reused for every later request ✅[^di-lifetimes].
5. **Scopes.** A scoped service should be used inside a scope, either the framework's (one per ASP.NET Core request) or one you create with `IServiceScopeFactory.CreateScope` ✅[^di-lifetimes]. `IServiceScopeFactory` is always a singleton, while the `IServiceProvider` a service receives belongs to the scope it was resolved from ✅[^di-overview] ✅[^lab]. Scopes are not hierarchical: there is no special link between two scopes ✅[^di-guidelines].
6. **Disposal.** The container calls `Dispose` or `DisposeAsync` on what it created: transient and scoped instances when their scope ends, singletons when the container is disposed ✅[^di-guidelines]. An instance you pass in (`AddSingleton(new X())`) is not disposed by the container ✅[^di-guidelines] ✅[^lab]. In the lab the scope disposed its instances in reverse creation order (`TDisp#2`, `TDisp#1`, then `SDisp`) ✅[^lab].
7. **Several registrations of one type.** Resolving `IWriter` gives the last registration; resolving `IEnumerable<IWriter>` gives all of them in registration order ✅[^di-registration]. `TryAdd{Lifetime}` adds only when the service type has no registration yet, and `TryAddEnumerable` adds only when that exact implementation type is not already registered for the service ✅[^di-registration]. `Replace` removes only the first descriptor of the service type and appends the new one ✅[^api-replace] ✅[^lab].
8. **Factories.** `Add{Lifetime}<T>(sp => …)` runs your delegate instead of a constructor, with the same lifetime and disposal rules ✅[^di-registration]. A singleton factory is called once by a single thread, like a static constructor ✅[^di-guidelines]; 16 parallel resolves in the lab called it once, while a transient factory ran on each of 3 resolves ✅[^lab].
9. **Keyed services (.NET 8+).** `AddKeyed{Lifetime}<TService, TImpl>(key)` registers under a key of any type with a correct `Equals`, and `[FromKeyedServices(key)]` on a constructor parameter selects it ✅[^di-overview]. A registration under `KeyedService.AnyKey` is the fallback for keys with no registration of their own ✅[^di-overview]. Keyed registrations are invisible to unkeyed resolution: `GetService<IWriter>()` returned `null` when only keyed writers existed ✅[^lab].
10. **Open generics.** One registration of `typeof(IRepo<>)` to `typeof(Repo<>)` serves every closed type; the container builds `ILogger<T>` the same way ✅[^di-overview]. In the lab `IRepo<int>` resolved to ``Repo`1[System.Int32]``, and singleton applies per closed type ✅[^lab].
11. **Thread safety.** Resolving services from a built provider or scope is thread-safe; the instances you get are not made thread-safe by that, so singletons with mutable state need their own locking ✅[^di-guidelines].

## Worked example
Two simulated requests, each in its own async scope, resolve `OrderHandler` (transient) twice. It needs `Clock` (singleton, `IDisposable`), `UnitOfWork` (scoped, `IAsyncDisposable`) and `Validator` (transient). Ids come from one counter, so they show creation order. Both validations are on ✅[^lab]:

| Step | Code | Observed | Rule |
|---|---|---|---|
| 1 | `BuildServiceProvider(new() { ValidateScopes = true, ValidateOnBuild = true })` | builds; every descriptor resolvable | How it works 2 |
| 2 | scope 1: resolve `OrderHandler` twice | `Clock#1 UnitOfWork#2 Validator#3` and `Clock#1 UnitOfWork#2 Validator#4` | singleton shared, scoped shared in scope, transient new |
| 3 | `await using` ends scope 1 | `UnitOfWork#2.DisposeAsync` | scoped disposed at scope end |
| 4 | scope 2: resolve twice | `Clock#1 UnitOfWork#5 Validator#6` and `Clock#1 UnitOfWork#5 Validator#7` | new scope, new `UnitOfWork` |
| 5 | scope 2 ends | `UnitOfWork#5.DisposeAsync` | — |
| 6 | `await using` ends the root | `Clock#1.Dispose` | singletons disposed with the container |

The two `OrderHandler` objects were never disposed because they do not implement `IDisposable`; a disposable transient would have been disposed at step 3.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Scoped service resolved from the root, no validation | Works, and returns the same instance every time ✅[^lab] | It is effectively promoted to a singleton, disposed only when the root is ✅[^di-overview] |
| Same, with `ValidateScopes = true` | `InvalidOperationException: Cannot resolve scoped service 'ScopedDep' from root provider.` ✅[^lab] | The check exists for exactly this ✅[^api-spo] |
| Singleton takes a scoped service (captive dependency) | With `ValidateScopes`: `Cannot consume scoped service 'ScopedDep' from singleton 'CaptiveSingleton'.`; without it the singleton keeps a different `ScopedDep` than every scope sees ✅[^lab] | The longer-lived service holds the shorter-lived one captive ✅[^di-guidelines] |
| `ValidateOnBuild = true` with a missing or captive dependency | `AggregateException: Some services are not able to be constructed (Error while validating the service descriptor …)` at build time ✅[^lab] | Every descriptor is tried at build time ✅[^api-spo]; without the flag, the build passes and the error waits for the first resolve ✅[^lab] |
| Open generic with a missing dependency | Passes `ValidateOnBuild`, then fails at resolve: ``Unable to resolve service for type 'Missing' while attempting to activate 'Repo`1[System.Int32]'.`` ✅[^lab] | Open generic services are not validated ✅[^api-spo] |
| Circular dependency `A(B)`, `B(A)` | `A circular dependency was detected for the service of type 'A'. A -> B -> A` ✅[^lab] | While it builds the call site, the container keeps the chain of services on the current path and throws when one repeats ✅[^runtime-chain] |
| 1,000 transient `IDisposable`s resolved from the root | All 1,000 stay alive until the root is disposed ✅[^lab] | The container keeps disposable transients to dispose them later; from the root that is a leak ✅[^di-guidelines] |
| Service only implements `IAsyncDisposable`, provider disposed with `Dispose()` | `InvalidOperationException: 'AsyncOnly' type only implements IAsyncDisposable. Use DisposeAsync to dispose the container.` ✅[^lab] | Use `await using` / `CreateAsyncScope` when a service is async-disposable |
| Factory doing sync-over-async (`.Result`) that resolves another service on another thread | Singleton factory (the guideline's anti-pattern): no deadlock in 10.0.12, resolved in about 506 ms. Scoped factory: blocked until the 3-second watchdog ✅[^lab] | The guideline warns it causes a deadlock ✅[^di-guidelines]; in the 10.0 source, root singletons lock per call site while a scope takes one lock for all its resolutions ✅[^runtime-resolver]. Keep factories fast and synchronous ✅[^di-guidelines] |
| `GetKeyedService<T>(KeyedService.AnyKey)` | `InvalidOperationException: KeyedService.AnyKey cannot be used to resolve a single service.` ✅[^lab]; `GetKeyedServices(AnyKey)` returned only the two writers with real keys ✅[^lab] | Changed in .NET 10 ✅[^anykey-break]. The breaking-change page quotes the message as "Cannot resolve a single service using AnyKey." ✅[^anykey-break], which is not the 10.0.12 text |
| `BuildServiceProvider()` in a web-SDK (software development kit) project | Warning `ASP0000: Calling 'BuildServiceProvider' from application code results in an additional copy of singleton services being created` ✅[^lab] | A second container means second copies of every singleton ✅[^asp0000] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Built-in container | Ships with every host, thread-safe resolution, scope validation ✅[^di-guidelines] | No property injection, child containers, `Func<T>` lazy factories or convention-based registration; use a third-party container for those ✅[^di-guidelines] |
| Singleton | One instance; cheap after the first resolve | Must be thread-safe, can keep a large graph alive, cannot follow configuration reloads, can capture shorter-lived services ✅[^di-guidelines] |
| Transient for stateless services | Cheap to create, no shared state | An allocation per resolve ✅[^di-lifetimes] |
| Inject `IServiceScopeFactory` and create a scope (background work) | Correct scoped lifetimes outside a request ✅[^di-overview] | More code than constructor injection |
| `IServiceProvider.GetService` inside classes (service locator) | Late decisions | Hides dependencies; the guidelines say to avoid it ✅[^di-guidelines] |

## Takeaways
- Turn on `ValidateScopes` and `ValidateOnBuild` in every environment you test in, not only `Development`. [rule-candidate]
- Never inject a scoped service into a singleton or a hosted service; inject `IServiceScopeFactory` and create a scope per unit of work. [rule-candidate]
- Never call `Dispose` on something the container gave you, and never register a disposable as transient if it may be resolved from the root. [rule-candidate]
- Keep factories synchronous; do async initialization after resolution.
- Use `TryAdd*` in library registration code so a library never overrides a registration the application already made.

## Verification status
- Verified: 65 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `dotnet/lab-setup.md` — the .NET SDK 10.0.401 lab (runtime 10.0.12, C# 14, macOS 26.1 arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- [.NET dependency injection](https://learn.microsoft.com/en-us/dotnet/core/extensions/dependency-injection/overview) — Microsoft, living. Rank 1. Backs: `BuildServiceProvider`; public constructor and constructor selection; scope validation; `IServiceScopeFactory` singleton and scoped `IServiceProvider`; keyed services and `AnyKey`; open types for `ILogger<T>`. [^di-overview]
- [Service lifetimes](https://learn.microsoft.com/en-us/dotnet/core/extensions/dependency-injection/service-lifetimes) — Microsoft, living. Rank 1. Backs: transient, scoped and singleton definitions; using scoped services inside a scope; per-resolve allocations. [^di-lifetimes]
- [Service registration](https://learn.microsoft.com/en-us/dotnet/core/extensions/dependency-injection/service-registration) — Microsoft, living. Rank 1. Backs: `ServiceDescriptor` list; last registration wins, `IEnumerable<T>` in order; `TryAdd*`, `TryAddEnumerable`; factories; order independence. [^di-registration]
- [Dependency injection guidelines](https://learn.microsoft.com/en-us/dotnet/core/extensions/dependency-injection/guidelines) — Microsoft, living. Rank 1. Backs: disposal rules; instances not created by the container; scopes not hierarchical; thread safety; singleton factory called once; captive dependency; disposable transients captured; async factory deadlock; replacement containers; service locator. [^di-guidelines]
- [ServiceProviderOptions Class](https://learn.microsoft.com/en-us/dotnet/api/microsoft.extensions.dependencyinjection.serviceprovideroptions) — Microsoft, living. Rank 1. Backs: `ValidateScopes` and `ValidateOnBuild` meaning; open generics not validated. [^api-spo]
- [ServiceCollectionDescriptorExtensions.Replace](https://learn.microsoft.com/en-us/dotnet/api/microsoft.extensions.dependencyinjection.extensions.servicecollectiondescriptorextensions.replace) — Microsoft, living. Rank 1. Backs: `Replace` removes the first matching descriptor. [^api-replace]
- [.NET Generic Host](https://learn.microsoft.com/en-us/dotnet/core/extensions/generic-host) — Microsoft, living. Rank 1. Backs: scope and dependency validation enabled in `Development`. [^generic-host]
- [Fix issues in GetKeyedService() and GetKeyedServices() with AnyKey](https://learn.microsoft.com/en-us/dotnet/core/compatibility/extensions/10.0/getkeyedservice-anykey) — Microsoft, living. Rank 1. Backs: .NET 10 `AnyKey` behaviour change and its documented message. [^anykey-break]
- [ASP0000: Do not call 'IServiceCollection.BuildServiceProvider' in 'ConfigureServices'](https://learn.microsoft.com/en-us/aspnet/core/diagnostics/asp0000) — Microsoft, living. Rank 1. Backs: the analyzer and why a second provider duplicates singletons. [^asp0000]
- [CallSiteRuntimeResolver.cs (release/10.0)](https://github.com/dotnet/runtime/blob/release/10.0/src/libraries/Microsoft.Extensions.DependencyInjection/src/ServiceLookup/CallSiteRuntimeResolver.cs) — .NET team, 2025. Rank 1. Backs: per-call-site lock for root singletons, one lock per scope. [^runtime-resolver]
- [CallSiteChain.cs (release/10.0)](https://github.com/dotnet/runtime/blob/release/10.0/src/libraries/Microsoft.Extensions.DependencyInjection/src/ServiceLookup/CallSiteChain.cs) — .NET team, 2025. Rank 1. Backs: circular-dependency detection on the chain of services being built. [^runtime-chain]

## Related
- `dotnet/app-model/host-configuration-options-and-logging.md` — the host that builds and owns this container.
- `dotnet/app-model/aspnet-core-pipeline.md` — one dependency-injection scope per HTTP request.
- `dotnet/errors-and-resources/disposal-and-finalization.md` — `IDisposable`, `IAsyncDisposable` and `using`.
- `dotnet/async/synchronization-context-and-configureawait.md` — why sync-over-async blocks.
- `dotnet/type-design/members-and-initialization.md` — primary constructors, a short way to declare the constructor the container calls.
