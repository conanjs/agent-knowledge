---
schema: knowledge-doc/v1
type: concept
topic: dotnet/app-model
status: verified
applies-to: [".NET 10 (runtime 10.0.12)", "C# 14", "Microsoft.Extensions.Hosting, Configuration, Options and Logging 10.0 (shared framework)"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [dotnet, generic-host, hosted-service, backgroundservice, graceful-shutdown, configuration, appsettings, environment-variables, options-pattern, ioptions, logging, ilogger, message-templates]
ranked-sources: true
---

# The generic host, configuration, options and logging

## Summary
**TL;DR:** `Host.CreateApplicationBuilder(args)` gives you one object that owns the dependency-injection container, a layered configuration, logging and the app's start and stop. Configuration is a flat dictionary of `Section:Key` strings filled by providers in a fixed order (JSON files, then environment variables, then the command line), and the last provider that sets a key wins. The options pattern binds a section to a class and hands it out three ways: `IOptions<T>` (read once), `IOptionsSnapshot<T>` (re-read per scope) and `IOptionsMonitor<T>` (always current, with change callbacks). Log with message templates (`"Order {OrderId}"`, arguments matched by position), never with string interpolation.
**Use this when:** a setting has the "wrong" value, an environment variable does not override JSON, options do not reload, validation fails only at the first request, a `BackgroundService` crash stops the app, shutdown hangs, or log output loses its fields.
**Not this doc:** the container itself (lifetimes, scopes) → `dotnet/app-model/dependency-injection.md`; the web host and middleware → `dotnet/app-model/aspnet-core-pipeline.md`; how `[LoggerMessage]` generates code → `dotnet/metaprogramming/source-generators.md`.

## Problem
Without a model of the host, each of these looks like a bug in the framework:
- `appsettings.Development.json` sets `Retries` to 2, the environment sets `App__Name`, the command line sets `--App:Name`, and nobody can say which value the app sees.
- An `IOptions<T>` value never changes after the file is edited.
- A required setting is missing, but the app starts and fails at the first request that reads it.
- A background worker throws once and the whole process exits.
- `logger.LogInformation($"Order {id}")` works, but the log store has no `OrderId` field to search on.

## Mental model
**Analogy:** the host is a theatre's stage manager. Before the show it collects the script notes in layers (the printed script, then the director's notes, then today's last-minute changes; the newest note wins), hires the crew (the container), and opens a logbook. At curtain-up it cues each act in order; at the end it calls "stop" and gives every act a fixed time to leave the stage.

**Artifact** (run in the lab ✅[^lab]): four layers set `App:Name`; the last provider wins.
```console
$ DOTNET_ENVIRONMENT=Development App__Name=from-env dotnet run h-config-precedence.cs -- --App:Name=from-cli
config["App:Name"] = 'from-cli'      # appsettings.json < appsettings.Development.json < env < command line
config["app:name"] = 'from-cli'      # keys are case-insensitive
config["App:Retries"] = '2'          # only appsettings.Development.json overrides it
```

## How it works
Five actors work together:
- **`HostApplicationBuilder`** — its job: collect configuration, services and logging before the app starts, via `Host.CreateApplicationBuilder(args)` and its `Configuration`, `Services` and `Logging` properties.
- **Configuration providers** — their job: each turn one source into key-value pairs, via `IConfigurationProvider` (JSON file, environment variables, command line, memory).
- **Options** — their job: turn a configuration section into a typed object on demand, via `IOptions<T>`, `IOptionsSnapshot<T>` and `IOptionsMonitor<T>`.
- **`IHost`** — its job: start and stop the hosted services, via `StartAsync` / `StopAsync` (`RunAsync` calls both).
- **`ConsoleLifetime`** — its job: turn Ctrl+C, SIGINT, SIGQUIT and SIGTERM into a graceful stop, via POSIX (Unix-standard) signal handlers.

```
Build time (one thread)                              Run time
───────────────────────                              ────────
CreateApplicationBuilder(args)                       host.RunAsync()
 ├ host config: DOTNET_* env, args                     ├ StartingAsync (lifecycle services)
 ├ app config (low → high priority):                   ├ StartAsync, in registration order
 │   appsettings.json                                  ├ StartedAsync → ApplicationStarted
 │   appsettings.{Env}.json                            │   BackgroundService.ExecuteAsync runs on
 │   {AppName}.settings[.{Env}].json                   │   the thread pool (no startup blocking)
 │   user secrets (Development only)                   │
 │   environment variables                       SIGTERM / Ctrl+C / StopApplication()
 │   command-line args                                 ├ ApplicationStopping
 ├ logging: Console, Debug, EventSource                ├ StoppingAsync → StopAsync (reverse order)
 └ Build(): container (validated in Development)    │   token cancelled after ShutdownTimeout (30 s)
                                                       └ StoppedAsync → ApplicationStopped → dispose
```

1. **Builder defaults.** `CreateApplicationBuilder` sets the content root to the current directory, reads host configuration from `DOTNET_`-prefixed environment variables and the command line, and reads app configuration from `appsettings.json`, `appsettings.{Environment}.json`, user secrets (in `Development`), environment variables and the command line ✅[^generic-host]. It adds the Console, Debug and EventSource logging providers (EventLog on Windows) and turns on dependency-injection (DI) validation in `Development` ✅[^generic-host]. The .NET 10 source also loads `{ApplicationName}.settings.json` and `{ApplicationName}.settings.{Environment}.json` after the `appsettings` files, and every JSON file is loaded with `reloadOnChange` unless `hostBuilder:reloadConfigOnChange` is `false` ✅[^src-hosting]; the lab's provider list showed all of them in that order ✅[^lab].
2. **Configuration is flat and layered.** Hierarchical data becomes keys joined by `:` (`Parent:Child:Name`), and array items get index keys (`App:Tags:1`) ✅[^config] ✅[^lab]. Keys are case-insensitive ✅[^config-providers]. When two providers set one key, the provider added last wins: the command line beats environment variables, which beat the JSON files ✅[^config].
3. **Environment variables and the command line.** Because `:` is not allowed in variable names on every platform (Bash, for one), `__` (double underscore) stands for `:` ✅[^config-providers], so `App__Name` sets `App:Name` ✅[^lab]. Command-line pairs can be written `Key=value`, `--Key value` or `/Key value`; do not mix `=` and space forms in one command ✅[^config-providers].
4. **Binding.** `GetSection("App").Get<T>()` and `Bind(obj)` copy values into an object; the binder converts strings to numbers, enums, `TimeSpan`s and collections, binds a type with a single public parameterized constructor (records), and ignores properties with private setters and properties that have no key ✅[^config] ✅[^lab]. A value that does not convert throws: `Failed to convert configuration value 'three' at 'App:Retries' to type 'System.Int32'.` ✅[^lab]. Since .NET 10, a JSON `null` is bound as `null` instead of being skipped ✅[^config-null]; in the lab it overwrote a property initialized to `"initial"` ✅[^lab].
5. **Three ways to read options.** An options class needs a public parameterless constructor and public read-write properties ✅[^options].

   | Interface | Lifetime | Sees file changes | Named options |
   |---|---|---|---|
   | `IOptions<T>` | singleton | no: computed once | no |
   | `IOptionsSnapshot<T>` | scoped: recomputed per scope | yes, from the next scope | yes |
   | `IOptionsMonitor<T>` | singleton: `CurrentValue`, `OnChange` | yes, at once | yes |

   (all three rows ✅[^options]). Named options are case-sensitive ✅[^options]. `PostConfigure` runs after every `Configure`, whatever the registration order ✅[^options] ✅[^lab].
6. **Validation.** `AddOptions<T>().Bind(…).ValidateDataAnnotations().Validate(…)` validates when the value is first built; `.ValidateOnStart()` moves that to host start ✅[^options]. In the lab the lazy version started fine and threw `OptionsValidationException` at the first `.Value`; with `ValidateOnStart` the same failures came out of `StartAsync` ✅[^lab].
7. **Hosted services start and stop in order.** Hosted services start one after another in registration order and stop in reverse order, unless `ServicesStartConcurrently` / `ServicesStopConcurrently` is set ✅[^asp-hosted]. The documented event order is `StartingAsync`, `StartAsync`, `StartedAsync`, `ApplicationStarted`, and on stop `ApplicationStopping`, `StoppingAsync`, `StopAsync`, `StoppedAsync`, `ApplicationStopped` ✅[^generic-host]; the lab printed exactly that ✅[^lab].
8. **`BackgroundService`.** You implement `ExecuteAsync(stoppingToken)` ✅[^workers]. Since .NET 10 all of `ExecuteAsync` runs on a background thread, so synchronous code before the first `await` no longer delays other services ✅[^bgs-break]. In the lab an 800 ms `Thread.Sleep` at its top ran after `ApplicationStarted` ✅[^lab]. A worker that should end the app calls `IHostApplicationLifetime.StopApplication()` ✅[^workers].
9. **A crash in `ExecuteAsync` stops the host.** Since .NET 6 the exception is logged and the host stops; `BackgroundServiceExceptionBehavior.Ignore` keeps the host running ✅[^bgs-exc]. `StopHost` is the default ✅[^api-hostoptions].
10. **Graceful shutdown.** `ConsoleLifetime` handles SIGINT, SIGQUIT and SIGTERM, and `Environment.Exit` is not a graceful stop ✅[^generic-host]. `HostOptions.ShutdownTimeout` defaults to 30 seconds ✅[^asp-generic-host]. When it expires the stop token is cancelled, but tasks are not abandoned: the host still awaits them ✅[^asp-hosted].
11. **Loggers, categories and levels.** `ILogger<T>` uses the full name of `T` as its category ✅[^logging]. Levels run `Trace` (0), `Debug`, `Information`, `Warning`, `Error`, `Critical`, `None` (6); without configuration the minimum is `Information` ✅[^logging]. For each provider and category, the rule with the longest matching category prefix wins ✅[^logging]. In the lab an `AddFilter("Noisy", LogLevel.Warning)` rule dropped an `Information` entry from `Noisy.Component` ✅[^lab].
12. **Message templates.** Placeholders are matched to arguments by position, not by name, and the arguments travel to the provider as fields ✅[^logging]. In the lab a provider received `OrderId=42, Amount=19.5, Customer=ana, {OriginalFormat}=Order {OrderId} paid {Amount:F2} by {Customer}`, and `"{Second} then {First}", "A", "B"` gave `Second=A` ✅[^lab]. The formatter renders values with the invariant culture ✅[^src-logvalues]. On an `en_VN` machine whose own culture writes `19,5`, the message read `19.50` ✅[^lab]. String interpolation can cause performance issues ✅[^logging]. A scope (`BeginScope`) attaches data to every entry logged inside it ✅[^logging]. `[LoggerMessage]` on a `partial` method generates the logging code at compile time ✅[^logging-sg].

## Worked example
One run of the configuration probe, with `DOTNET_ENVIRONMENT=Development App__Name=from-env App__Region=env-region` in the environment and `--App:Name=from-cli /App:Secret cli-secret` on the command line ✅[^lab]:

| Key | `appsettings.json` | `appsettings.Development.json` | environment | command line | Final value |
|---|---|---|---|---|---|
| `App:Name` | `from-appsettings` | `from-appsettings.Development` | `from-env` | `from-cli` | `from-cli` |
| `App:Retries` | `1` | `2` | — | — | `2` |
| `App:Region` | `json-region` | — | `env-region` | — | `env-region` |
| `App:Secret` | `json-secret` | — | — | `cli-secret` (`/Key value` form) | `cli-secret` |
| `App:Nickname` | `null` | — | — | — | `null`; bound over the `"initial"` default |

Then `Get<AppSettings>()` gave `Name=from-cli Retries=2 Tags=[a,b] Timeout=00:00:05`, left the private-setter property `Hidden` at its default and the unknown property `NotInConfig` at `kept`, and the record `AppRecord(string Name, int Retries)` bound through its constructor to `AppRecord { Name = from-cli, Retries = 2 }`.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| A file named `{AppName}.settings.json` next to the app | Loaded, after `appsettings.{Env}.json` ✅[^lab] | In the .NET 10 source ✅[^src-hosting]; the generic host article's list of sources does not mention it ✅[^generic-host] |
| `export App:Name=x` in Bash | ``bash: line 0: export: `App:Name=x': not a valid identifier`` ✅[^lab]; use `App__Name` | `__` replaces `:` for environment variables ✅[^config-providers] |
| `IOptions<T>` after the JSON file changes | Still `SMTP-V1:1025`, while snapshot and monitor show `SMTP-V2:1587` about 310 ms after the write ✅[^lab] | `IOptions<T>` does not read configuration after start ✅[^options] |
| One save of `appsettings.json` | `OnChange` fired twice in the lab ✅[^lab] | One file change can raise several token callbacks ✅[^change-tokens] |
| `IOptionsSnapshot<T>` in a singleton, `Development` | `Build()` fails: ``Cannot consume scoped service '…IOptionsSnapshot`1[MailOptions]' from singleton 'NeedsSnapshot'.`` ✅[^lab] | It is scoped ✅[^options]; use `IOptionsMonitor<T>` |
| `monitor.Get("Backup")` for options named `backup` | Returns an unconfigured object (`:0`), no error ✅[^lab] | Names are case-sensitive ✅[^options] |
| Config key with no matching property | Ignored silently; `ErrorOnUnknownConfiguration = true` throws `…the following properties were not found on the instance of AppSettings: 'Region', 'Secret'` ✅[^lab] | Missing keys and unknown keys are both skipped by default ✅[^config] |
| `HostOptions.StartupTimeout` | Default `-00:00:00.0010000`, equal to `Timeout.InfiniteTimeSpan` ✅[^lab] | It is the default timeout for `StartAsync` ✅[^api-hostoptions], so start has no time limit unless you set one |
| `StopAsync` that ignores its token, `ShutdownTimeout = 1 s` | Token cancelled after 1 s, but `host.StopAsync()` returned after 3,002 ms, when the service finished ✅[^lab] | The host awaits the tasks after cancelling ✅[^asp-hosted] |
| `ExecuteAsync` throws with `Ignore` | Logged as `BackgroundService failed`, host keeps running, the worker is gone ✅[^lab] | The service is not restarted; with `StopHost` the critical log says so ✅[^lab] |
| `BeginScope(new Dictionary<string, object>{…})` with the simple console formatter | Printed as ``System.Collections.Generic.Dictionary`2[System.String,System.Object]`` ✅[^lab] | The console prints the scope's `ToString()`; structured providers get the object. Use a template scope (`"Request {RequestId}"`) |
| `LogDebug($"… {expensive}")` with Debug disabled | `ToString()` ran once anyway; the template form never called it ✅[^lab] | Interpolation builds the string before the call; the template defers formatting ✅[^logging] |
| Same code with default analyzers | No warning; with `AnalysisMode=Recommended`, CA2254 (template varies) and CA1848 (use `LoggerMessage`) ✅[^lab] | See `dotnet/tooling/analyzers-and-code-quality.md` |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `IOptions<T>` | Cheapest; safe in singletons | No reload ✅[^options] |
| `IOptionsSnapshot<T>` | Consistent value for a whole request | Scoped: not usable from singletons; recomputed per scope ✅[^options] |
| `IOptionsMonitor<T>` | Live values and `OnChange` anywhere ✅[^options] | Value may change between two reads in one operation; callbacks may repeat |
| `ValidateOnStart` | Bad config fails the deploy, not a user request ✅[^options] | Validation runs even for options a run never uses |
| Templates `LogX("… {Id}", id)` | Structured fields, deferred formatting ✅[^logging] | Arguments still go through a `params object?[] args` array on every call ✅[^api-loggerext] |
| `[LoggerMessage]` methods | Generated, faster than the extension methods ✅[^logging-sg] | A `partial` method per message |

## Takeaways
- Put defaults in `appsettings.json`, environment-specific values in `appsettings.{Env}.json`, and secrets and per-deployment values in environment variables (`Section__Key`). [rule-candidate]
- Bind settings with `AddOptions<T>().Bind(...).ValidateDataAnnotations().ValidateOnStart()` so a bad configuration stops the app at start. [rule-candidate]
- Inject `IOptionsMonitor<T>` into singletons that must see changes; never `IOptionsSnapshot<T>`.
- Make `StopAsync` and `ExecuteAsync` honour their cancellation token; the shutdown timeout only cancels the token. [rule-candidate]
- Log with constant message templates and named placeholders in argument order; never interpolate. [rule-candidate]

## Verification status
- Verified: 80 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `dotnet/lab-setup.md` — the .NET SDK 10.0.401 lab (runtime 10.0.12, C# 14, macOS 26.1 arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- [.NET Generic Host](https://learn.microsoft.com/en-us/dotnet/core/extensions/generic-host) — Microsoft, living. Rank 1. Backs: `CreateApplicationBuilder` defaults; validation in Development; lifecycle event order; `ConsoleLifetime` signals and `Environment.Exit`. [^generic-host]
- [Configuration in .NET](https://learn.microsoft.com/en-us/dotnet/core/extensions/configuration) — Microsoft, living. Rank 1. Backs: provider order and last-wins; `:` hierarchy; binder conversions, constructor binding, ignored properties. [^config]
- [Configuration providers in .NET](https://learn.microsoft.com/en-us/dotnet/core/extensions/configuration-providers) — Microsoft, living. Rank 1. Backs: case-insensitive keys; `__` for environment variables; command-line forms. [^config-providers]
- [Null values preserved in configuration](https://learn.microsoft.com/en-us/dotnet/core/compatibility/extensions/10.0/configuration-null-values-preserved) — Microsoft, living. Rank 1. Backs: .NET 10 binds JSON `null`. [^config-null]
- [Options pattern in .NET](https://learn.microsoft.com/en-us/dotnet/core/extensions/options) — Microsoft, living. Rank 1. Backs: options class rules; the three interfaces; named options; post-configuration; validation and `ValidateOnStart`. [^options]
- [Worker services in .NET](https://learn.microsoft.com/en-us/dotnet/core/extensions/workers) — Microsoft, living. Rank 1. Backs: `ExecuteAsync`; `StopApplication`. [^workers]
- [BackgroundService runs all of ExecuteAsync as a Task](https://learn.microsoft.com/en-us/dotnet/core/compatibility/extensions/10.0/backgroundservice-executeasync-task) — Microsoft, living. Rank 1. Backs: .NET 10 runs all of `ExecuteAsync` in the background. [^bgs-break]
- [Unhandled exceptions from a BackgroundService](https://learn.microsoft.com/en-us/dotnet/core/compatibility/core-libraries/6.0/hosting-exception-handling) — Microsoft, living. Rank 1. Backs: log-and-stop since .NET 6; `Ignore`. [^bgs-exc]
- [HostOptions Class](https://learn.microsoft.com/en-us/dotnet/api/microsoft.extensions.hosting.hostoptions) — Microsoft, living. Rank 1. Backs: `BackgroundServiceExceptionBehavior` default `StopHost`; `StartupTimeout` is the `StartAsync` timeout. [^api-hostoptions]
- [Background tasks with hosted services in ASP.NET Core](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/host/hosted-services) — Microsoft, living. Rank 1. Backs: sequential start in registration order, reverse stop, concurrent options; stop token timeout and tasks still awaited. [^asp-hosted]
- [.NET Generic Host in ASP.NET Core](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/host/generic-host) — Microsoft, living. Rank 1. Backs: `ShutdownTimeout` default 30 seconds. [^asp-generic-host]
- [Logging in C# and .NET](https://learn.microsoft.com/en-us/dotnet/core/extensions/logging/overview) — Microsoft, living. Rank 1. Backs: categories, levels and default level; filter rule selection; positional placeholders; interpolation cost; scopes. [^logging]
- [LoggerExtensions.LogInformation Method](https://learn.microsoft.com/en-us/dotnet/api/microsoft.extensions.logging.loggerextensions.loginformation) — Microsoft, living. Rank 1. Backs: the `params object?[] args` signature. [^api-loggerext]
- [Compile-time logging source generation](https://learn.microsoft.com/en-us/dotnet/core/extensions/logging/source-generation) — Microsoft, living. Rank 1. Backs: `[LoggerMessage]` generates partial methods at compile time. [^logging-sg]
- [Detect changes with change tokens in ASP.NET Core](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/change-tokens) — Microsoft, living. Rank 1. Backs: one file change can raise several callbacks. [^change-tokens]
- [HostingHostBuilderExtensions.cs (release/10.0)](https://github.com/dotnet/runtime/blob/release/10.0/src/libraries/Microsoft.Extensions.Hosting/src/HostingHostBuilderExtensions.cs) — .NET team, 2025. Rank 1. Backs: `{ApplicationName}.settings.json` files; `reloadConfigOnChange` default. [^src-hosting]
- [LogValuesFormatter.cs (release/10.0)](https://github.com/dotnet/runtime/blob/release/10.0/src/libraries/Microsoft.Extensions.Logging.Abstractions/src/LogValuesFormatter.cs) — .NET team, 2025. Rank 1. Backs: messages formatted with the invariant culture. [^src-logvalues]

## Related
- `dotnet/app-model/dependency-injection.md` — the container the host builds.
- `dotnet/app-model/aspnet-core-pipeline.md` — `WebApplication.CreateBuilder` uses the same configuration and logging.
- `dotnet/metaprogramming/source-generators.md` — what `[LoggerMessage]` generates.
- `dotnet/async/cancellation-valuetask-and-async-streams.md` — honouring `stoppingToken`.
- `dotnet/tooling/analyzers-and-code-quality.md` — CA1848, CA2254 and `AnalysisMode`.
