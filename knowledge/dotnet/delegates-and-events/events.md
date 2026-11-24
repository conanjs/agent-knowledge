---
schema: knowledge-doc/v1
type: concept
topic: dotnet/delegates-and-events
status: verified
applies-to: [".NET 10 (runtime 10.0.12)", "C# 14"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [dotnet, csharp, events, EventHandler, field-like-events, add-remove-accessors, thread-safety, memory-leak, weak-events, IObservable, channels]
ranked-sources: true
---

# Events

## Summary
**TL;DR:** An `event` is a delegate wrapped so that code outside the declaring class can only subscribe (`+=`) and unsubscribe (`-=`); for a *field-like* event the compiler adds a hidden delegate field and `add`/`remove` accessors that update it atomically (in the lab: `Delegate.Combine` inside an `Interlocked.CompareExchange` loop). Raise it with `Changed?.Invoke(this, e)`, which reads the field once; the older `if (Changed != null) Changed(this, e)` threw `NullReferenceException` 351 times in 591 million raises in the lab while another thread unsubscribed. The publisher's invocation list holds a strong reference to every subscriber, so a handler that is never removed keeps its subscriber alive as long as the publisher lives.
**Use this when:** you declare or raise an event; a subscriber object never gets garbage-collected; `-=` seems to do nothing; one failing handler stops the others; or you are choosing between an event, a callback delegate, `IObservable<T>` and a `Channel<T>`.
**Not this doc:** delegates, multicast invocation and closures → `dotnet/delegates-and-events/delegates-lambdas-and-closures.md`; `in TEventArgs` variance → `dotnet/generics/variance.md`; channels and producer-consumer pipelines in depth → `dotnet/concurrency/concurrent-collections-and-channels.md`; `async void` and why it crashes → `dotnet/async/tasks-and-async-await.md`; the garbage collector and weak references → `dotnet/runtime/garbage-collection.md`.

## Problem
- A window or view model that subscribed to a long-lived service's event is never collected, even after nothing else uses it.
- `service.Changed -= (s, e) => Refresh();` leaves the handler attached, and it keeps running.
- One handler throws and the handlers after it never run.
- `if (Changed != null) Changed(this, e);` throws `NullReferenceException` once in a while under load.
- A derived class cannot raise the event its base class declares (CS0070).
- A slow handler makes the code that raised the event slow.

## Mental model
**Analogy:** a newsletter's mailing list kept by the publisher. Readers can add or remove only their own address, and only the publisher can send an issue. Every address on the list is a real house the publisher can reach, so as long as the publisher keeps the list, the reader cannot be "moved out" (collected), even if the reader has forgotten the newsletter exists. Sending an issue means walking down the list in order; if one delivery fails, the round stops there.

**Artifact** (run in the lab ✅[^lab]): one field-like event, and what reflection finds the compiler built for it.
```csharp
public class Publisher
{
    public event EventHandler<ChangedEventArgs>? Changed;      // field-like event
    public void Raise(string what) => Changed?.Invoke(this, new ChangedEventArgs(what));
}
// reflection on typeof(Publisher):
// event Changed: add=add_Changed remove=remove_Changed raise=none
// hidden field: EventHandler<...> Changed
// calls made by add_Changed:    Delegate.Combine, Interlocked.CompareExchange
// calls made by remove_Changed: Delegate.Remove,  Interlocked.CompareExchange
```

## How it works
**4 actors:**
- **C# compiler** — its job: generate the hidden delegate field and the `add`/`remove` accessors, and restrict outside code to `+=`/`-=`, via the `event` declaration.
- **Publisher** (event source) — its job: raise the event, via invoking the delegate in its field.
- **Subscriber** (event sink) — its job: attach and detach a handler, via `+=` and `-=`, which call the accessors.
- **Garbage collector (GC)** — its job: free objects no longer reachable, via references, including those inside the publisher's invocation list.

```
Subscriber                         Publisher object                      GC
view.OnTick ──(+= calls add_Ticked)──▶ field Ticked: EventHandler
                                       invocation list:
                                         [target=view, method=OnTick] ──┐
                                                                        │ strong reference
Publisher.Tick():                                                       ▼
  Ticked?.Invoke(this, e)  ── reads the field once, then calls each entry in order
                                                                   view stays reachable while the
                                                                   publisher is reachable, until -=
```

1. **Compiler — what `event` restricts.** The event's type must be a delegate type ✅[^events-overview]. Inside its class a field-like event can be used like a field holding a delegate (or `null` when nobody subscribed); outside, it may appear only on the left of `+=` and `-=` ✅[^spec-events]. In the lab, raising, assigning or reading the event from outside gave CS0070, and so did raising it from a derived class ✅[^lab].
2. **Compiler — field-like accessors.** For a field-like event the compiler creates the storage and the accessors, and the add and remove operations are thread safe ✅[^spec-events]. Roslyn implements them without a lock: the lab's IL (intermediate language) showed `Delegate.Combine`/`Delegate.Remove` plus `Interlocked.CompareExchange`, and 8 threads adding 20,000 handlers each left exactly 160,000 entries; a hand-written `add { _h = _h + value; }` lost updates and kept 125,538 ✅[^lab].
3. **Compiler — custom accessors.** An event can declare `add` and `remove` blocks; each receives the handler as the implicit parameter `value`, and `+=`/`-=` call them ✅[^spec-events]. A class with many rarely-raised events can store all handlers in one data structure this way, trading speed for memory ✅[^handle-raise]; in the lab a class with two such events stored 1 dictionary entry after only one was used ✅[^lab]. Since C# 14 an event can be `partial`: the defining part uses field-like syntax and the implementing part declares the `add` and `remove` accessors ✅[^event-pattern]. In the lab such an event compiled to ordinary `add_Changed`/`remove_Changed` methods with no hidden delegate field, and its accessors ran on `+=` and `-=`; without the implementing part the build failed with CS9275 "Partial member 'Sensor.Changed' must have an implementation part" ✅[^lab].
4. **Publisher — raising.** Raising an event is exactly invoking its delegate; the standard's own example checks for `null` on a local copy to be thread safe ✅[^spec-events]. Code must allow for no subscribers, and `?.Invoke` does that ✅[^events-overview]; it reads the field once. In the lab, with one thread subscribing and unsubscribing in a loop, `if (Evt != null) Evt(this, e)` threw `NullReferenceException` 351 times in 591,270,000 raises, and `Evt?.Invoke(this, e)` threw 0 times ✅[^lab].
5. **Publisher — the standard pattern.** Use `EventHandler` for events without data and `EventHandler<TEventArgs>` for events with data; both return `void` and take the sender and the data ✅[^handle-raise]. Raise from a `protected virtual` method named `On<EventName>` so derived classes can hook in ✅[^handle-raise]; pass `EventArgs.Empty` rather than `null`, never `null` as the sender of an instance event, and `null` as the sender of a static event ✅[^event-design]. In .NET Core `TEventArgs` no longer has to derive from `EventArgs` ✅[^modern-events]; the lab raised an `EventHandler<MeterReading>` whose argument is a `readonly record struct` ✅[^lab].
6. **Publisher — handlers run in line.** Delegate invocation calls each handler synchronously, in order, and an uncaught exception skips the remaining handlers ✅[^spec-delegates]. In the lab, a 200 ms handler made `Raise` return after 201 ms on the raising thread, and a throwing second handler kept the third from running until the raise looped over `GetInvocationList()` with a `try` per handler ✅[^lab]. An `async void` handler cannot report a failure through a task, so it must catch its own exceptions ✅[^modern-events]. In the lab, an `async void` handler that threw, before or after its first `await`, let `Raise` return normally, so a `try` around the raise caught nothing, and the process then crashed with exit code 134 (the mechanism is in `dotnet/async/tasks-and-async-await.md`); with its own `try`/`catch` the handler caught the exception and the program finished ✅[^lab].
7. **Subscriber and GC — the lifetime link.** Until a subscriber unsubscribes, the publisher's multicast delegate references the subscriber's handler, and as long as the publisher holds that reference the subscriber is not collected; unsubscribe before disposing a subscriber ✅[^subscribe]. A handler added as an anonymous function cannot easily be removed: store it in a variable first ✅[^subscribe], because `-=` with a new lambda tries to remove a handler that was never attached and does nothing ✅[^events-overview].
8. **Subscriber — weak subscriptions.** A weak reference lets the GC collect an object while the program can still reach it if it survives ✅[^weak-refs]. WPF's (Windows Presentation Foundation's) *weak event pattern* uses this idea with a `WeakEventManager`, for listeners that do not know when to unsubscribe ✅[^weak-events] (WPF is Windows-only and was not run here). The same idea without WPF is a small forwarding handler that holds the listener through `WeakReference<T>` and removes itself once the listener is gone; the lab version is in the Worked example ✅[^lab].

## Worked example
A long-lived `Clock` publisher and four `View` subscribers (each holding a 1 MB array), created in helper methods and then dropped; Release build, after `GC.Collect()` ✅[^lab].

| Step | Subscription | `View` still alive? | Why |
|---|---|---|---|
| 1 | `clock.Ticked += view.OnTick;` never removed | `True` | the invocation list references the view (How it works 7) |
| 2 | `+= view.OnTick;` then `-= view.OnTick;` | `False` | the second method-group delegate is equal to the first, so removal works |
| 3 | `+= (s, e) => view.OnTick(s, e);` then `-=` a second, identical lambda | `True` | the second lambda is a different delegate; nothing was removed |
| 4 | forwarding handler holding `WeakReference<View>` | `False` | the publisher holds only the forwarder |
| 5 | `clock.HandlerCount` after the collection | `3` | entries from steps 1, 3 and 4 |
| 6 | `clock.Tick()`, then `HandlerCount` | `2` | the forwarder found its view gone and ran `source.Ticked -= h` |

The forwarder at step 4, in full:
```csharp
static void Subscribe<TListener>(Clock source, TListener listener,
    Action<TListener, object?, EventArgs> forward) where TListener : class
{
    var weakRef = new WeakReference<TListener>(listener);
    EventHandler? h = null;
    h = (s, e) =>
    {
        if (weakRef.TryGetTarget(out var target)) forward(target, s, e);
        else source.Ticked -= h;                  // listener collected: detach the forwarder
    };
    source.Ticked += h;
}
// called with a static lambda, so the forwarder itself does not capture the view:
// Subscribe(clock, view, static (v, s, e) => v.OnTick(s, e));
```

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Subscriber of a `static` event | Alive after `GC.Collect()` ✅[^lab] | The publisher is a static field that is never collected, and while the publisher holds the delegate the subscriber cannot be collected ✅[^subscribe] |
| Same handler added twice | Runs twice; one `-=` leaves one copy; extra `-=` is a no-op ✅[^lab] | Invocation lists allow duplicates and removal takes the rightmost match ✅[^combine]; removing a missing handler returns the list unchanged ✅[^spec-expr] |
| Hand-written `add`/`remove` accessors | Not thread safe unless you make them so: 34,462 lost subscriptions in the lab ✅[^lab] | Only field-like events get the compiler's thread-safe accessors ✅[^spec-events] |
| Event arguments as a mutable `struct` with a `Cancel` flag | The publisher never sees a handler's `Cancel = true` | Each handler gets its own copy; keep cancellable arguments a class ✅[^modern-events] |
| `EventHandler<EventArgs>` handler attached to an `EventHandler<CancelEventArgs>` event | Compiles on .NET 10 ✅[^lab] | `EventHandler<in TEventArgs>` is contravariant from .NET 10 ✅[^api-eventhandler] |
| Raising from the base class's `protected virtual OnChanged(e)` in an override that skips `base.OnChanged(e)` | Subscribers are never called | The override must call the base method to reach the registered delegates ✅[^handle-raise] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `event` | Many optional listeners; only the owner raises ✅[^distinguish] | Strong references to subscribers; handlers run on the raiser's thread and block it (201 ms in the lab ✅[^lab]) |
| Delegate parameter or property (callback) | Right when the code *must* call the supplied code or needs a return value ✅[^distinguish] | As a public field or property, outside code can overwrite or invoke it (`p.Callback = null` compiled in the lab ✅[^lab]) |
| `IObservable<T>` / `IObserver<T>` | `Subscribe` returns an `IDisposable` to unsubscribe; `OnError` and `OnCompleted` signals ✅[^observer] (lab: 0 observers after `Dispose` ✅[^lab]) | More types to write; for simple in-app notifications events are more idiomatic ✅[^observer] |
| `Channel<T>` | Producer and consumer decoupled ✅[^channels], with back-pressure when bounded ✅[^observer]; two writes returned in 6 ms while the consumer took 405 ms in the lab ✅[^lab] | One consumer gets each item (no fan-out); see `dotnet/concurrency/concurrent-collections-and-channels.md` |
| `IAsyncEnumerable<T>` | Pull-based: the consumer sets the pace ✅[^observer] | The consumer must be iterating to receive anything |

## Takeaways
- Raise events with `Handler?.Invoke(this, e)`; never test the field and then invoke it in a second read. [rule-candidate]
- Unsubscribe from any publisher that outlives the subscriber (static events, singletons, app-wide services), in `Dispose` or at the end of the subscriber's life. [rule-candidate]
- Keep a reference to any lambda you subscribe if you will need `-=` later.
- Raise through a `protected virtual On<EventName>(TEventArgs e)` method and pass `EventArgs.Empty`, not `null`.
- Use `GetInvocationList()` with a `try` per handler when one subscriber's failure must not silence the others.

## Verification status
- Verified: 52 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `dotnet/lab-setup.md` — the .NET SDK 10.0.401 lab (runtime 10.0.12, C# 14, macOS 26.1 arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- [Introduction to events](https://learn.microsoft.com/en-us/dotnet/csharp/events-overview) — Microsoft, living. Rank 1. Backs: the event type is a delegate type; allow for no subscribers and use `?.`; removing with a new lambda does nothing. [^events-overview]
- [Standard .NET event patterns](https://learn.microsoft.com/en-us/dotnet/csharp/event-pattern) — Microsoft, living. Rank 1. Backs: partial events in C# 14; field-like defining part, accessors in the implementing part. [^event-pattern]
- [The updated .NET event pattern](https://learn.microsoft.com/en-us/dotnet/csharp/modern-events) — Microsoft, living. Rank 1. Backs: `TEventArgs` no longer needs `EventArgs`; struct arguments break cancellation; `async void` handlers must catch. [^modern-events]
- [Distinguish delegates and events](https://learn.microsoft.com/en-us/dotnet/csharp/distinguish-delegates-events) — Microsoft, living. Rank 1. Backs: events when listening is optional, delegates when the call is required or a value is returned; private invocation. [^distinguish]
- [How to subscribe to and unsubscribe from events](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/events/how-to-subscribe-to-and-unsubscribe-from-events) — Microsoft, living. Rank 1. Backs: the publisher's delegate keeps the subscriber from being collected; unsubscribing from anonymous functions. [^subscribe]
- [C# language specification: Classes, §15.8 Events](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/classes) — ECMA / Microsoft, living. Rank 1. Backs: field-like events; outside use only with `+=`/`-=`; thread-safe add and remove; raising is invoking; the local-copy check; event accessors and `value`. [^spec-events]
- [C# language specification: Delegates, §21.6 Delegate invocation](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/delegates) — ECMA / Microsoft, living. Rank 1. Backs: handlers run synchronously in order; an exception stops the list. [^spec-delegates]
- [C# language specification: Expressions, §12.12.6 Subtraction operator](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/expressions) — ECMA / Microsoft, living. Rank 1. Backs: removing a delegate that is not in the list returns the list unchanged. [^spec-expr]
- [How to combine delegates (multicast delegates)](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/delegates/how-to-combine-delegates-multicast-delegates) — Microsoft, living. Rank 1. Backs: duplicates are allowed; removal takes the rightmost copy. [^combine]
- [Handle and raise events](https://learn.microsoft.com/en-us/dotnet/standard/events/) — Microsoft, living. Rank 1. Backs: `EventHandler` and `EventHandler<TEventArgs>`; `protected virtual On<EventName>`; overrides must call the base; event properties trade speed for memory. [^handle-raise]
- [Event design](https://learn.microsoft.com/en-us/dotnet/standard/design-guidelines/event) — Microsoft, living. Rank 1. Backs: `EventArgs.Empty` instead of `null`; sender rules for instance and static events. [^event-design]
- [Weak references](https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/weak-references) — Microsoft, living. Rank 1. Backs: what a weak reference allows. [^weak-refs]
- [Weak event patterns (WPF)](https://learn.microsoft.com/en-us/dotnet/desktop/wpf/events/weak-event-patterns) — Microsoft, living. Rank 1. Backs: event subscriptions as a leak source; `WeakEventManager` for listeners that do not know when to unregister. [^weak-events]
- [Observer design pattern](https://learn.microsoft.com/en-us/dotnet/standard/events/observer-design-pattern) — Microsoft, living. Rank 1. Backs: `IObservable<T>`/`IObserver<T>` roles and the `IDisposable` unsubscriber; events, `IAsyncEnumerable<T>` and channels as alternatives. [^observer]
- [Channels](https://learn.microsoft.com/en-us/dotnet/core/extensions/channels) — Microsoft, living. Rank 1. Backs: producer-consumer model, bounded and unbounded channels. [^channels]
- [EventHandler<TEventArgs> Delegate](https://learn.microsoft.com/en-us/dotnet/api/system.eventhandler-1) — Microsoft, living. Rank 1. Backs: `in TEventArgs` on .NET 10. [^api-eventhandler]

## Related
- `dotnet/delegates-and-events/delegates-lambdas-and-closures.md` — the multicast delegate under every event.
- `dotnet/concurrency/concurrent-collections-and-channels.md` — `Channel<T>` pipelines and back-pressure.
- `dotnet/async/tasks-and-async-await.md` — `async void` handlers and unobserved exceptions.
- `dotnet/runtime/garbage-collection.md` — reachability, weak references and why `GC.Collect` is only for experiments.
- `dotnet/errors-and-resources/disposal-and-finalization.md` — unsubscribing in `Dispose`.
