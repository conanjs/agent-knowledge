---
schema: knowledge-doc/v1
type: concept
topic: dotnet/metaprogramming
status: verified
applies-to: [".NET 10 (runtime 10.0.12)", "C# 14"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [dotnet, csharp, reflection, attributes, typeof, gettype, methodinfo, activator, unsafeaccessor, callermembername, nameof, obsolete, conditional, trimming, native-aot]
ranked-sources: true
---

# Reflection and attributes

## Summary
**TL;DR:** Reflection is the run-time API (application programming interface), `System.Type` plus `System.Reflection`, that reads the metadata every assembly carries and acts on it: find a method by name, read a private field, create an object from a `Type`. Attributes are classes whose instances the compiler records in that metadata; nothing runs until code asks for them, and some (`[Obsolete]`, `[Conditional]`, `[CallerMemberName]`) are read by the compiler itself. Reflection works anywhere the just-in-time (JIT) compiler runs, but it is slow per call (about 10 times a direct call in the lab), it wraps exceptions, and the trimmer and Native AOT (ahead-of-time compilation) cannot see through it, which the IL2026 and IL3050 warnings report.
**Use this when:** code finds members by name, reads custom attributes, builds objects from a `Type`, needs a caller's name or line, or a build warns IL2026, IL2057, IL2067 or IL3050.
**Not this doc:** generating code at compile time instead of reflecting at run time → `dotnet/metaprogramming/source-generators.md`; turning those warnings into errors and other analyzer settings → `dotnet/tooling/analyzers-and-code-quality.md`; what Native AOT removes → `dotnet/runtime/jit-tiering-and-aot.md`; the nullable-analysis attributes → `dotnet/type-design/nullable-reference-types.md`.

## Problem
Code that works by name instead of by reference fails in ways the compiler cannot warn about:
- `typeof(Account).GetField("_balance")` returns `null`, although the field exists.
- A method called through `MethodInfo.Invoke` throws `TargetInvocationException`, and a `catch (ArgumentOutOfRangeException)` around it never runs.
- A custom attribute's constructor has a side effect that runs on every lookup, not once.
- A plugin loader that works under `dotnet run` breaks after trimming, because the trimmer removed the members it looks up by string.
- A logging helper takes the member name as a string literal, and a rename leaves it wrong.

## Mental model
**Analogy:** an assembly ships with a building plan: every room (type), door (method) and cupboard (field) is listed, with sticky labels (attributes) on some of them. Normal code walks the corridors it was built for. Reflection reads the plan at run time and opens a door by its name, which takes longer and works even on doors marked private. The labels are only paper until someone reads them: reading a label builds a fresh object from what is written on it. A trimmer that tears out the rooms nobody seems to visit cannot know which rooms the plan-readers will ask for.

**Artifact** (run in the lab ✅[^lab]):
```csharp
object o = "hi";
Console.WriteLine(typeof(object));            // System.Object  (a type named in source)
Console.WriteLine(o.GetType());               // System.String  (the run-time type of the object)
var t = typeof(Account);
Console.WriteLine(t.GetField("_balance") is null);   // True: default lookup sees only public members
var field = t.GetField("_balance", BindingFlags.NonPublic | BindingFlags.Instance)!;
var acc = new Account();
field.SetValue(acc, 100m);                     // writes a private field
Console.WriteLine(t.GetMethod("Deposit")!.Invoke(acc, [25m]));   // 125 (boxed decimal)

class Account { private decimal _balance; public decimal Deposit(decimal x) => _balance += x; }
```

## How it works
Three actors take part, at three different times:
- **The C# compiler** — its job: write types, members and attribute arguments into the assembly's metadata, via the compiled `.dll`; and act on compiler-interpreted attributes, via its own rules.
- **The runtime's reflection API** — its job: answer questions about loaded types and call members by name, via `Type`, `MethodInfo`, `FieldInfo`, `PropertyInfo` and `Activator`.
- **The trimmer and the AOT compiler (ILC, the Native AOT compiler)** — their job: decide which code to keep and compile ahead of time, via static analysis at publish time (and the same analysis as build warnings).

```
build time                          run time (JIT)                         publish time (trim / AOT)
C# compiler                         reflection API                         trimmer / ILC
  │ writes metadata:                  │ typeof(T) / obj.GetType()            │ walks calls from Main
  │ types, members,                   │   → the one RuntimeType per type     │ keeps what it can see
  │ [Author("Lan")] as bytes ───────▶ │ GetCustomAttributes()                │ Type.GetType(string)
  │                                   │   → runs AuthorAttribute ctor now    │ → IL2057;
  │ [Obsolete] → CS0618               │ MethodInfo.Invoke(obj, args)         │ [RequiresUnreferencedCode]
  │ [Conditional] → call removed      │   → boxes args, checks types,        │ → IL2026; MakeGenericType
  │ [CallerLineNumber] → literal      │     wraps exceptions                 │ → IL3050
```

1. **Compiler: attributes are metadata, not code.** An attribute class derives from `System.Attribute`; its constructor parameters are the positional parameters and its public read-write fields and properties are the named ones ✅[^cs-create-attr]. The `Attribute` suffix may be left out when it is applied: `[Author]` means `AuthorAttribute` ✅[^cs-attrs]. `AttributeUsage` sets which declarations accept it, whether it may appear more than once (`AllowMultiple`) and whether derived classes inherit it (`Inherited`); left out, it allows every target, once, and inherited ✅[^attr-general]. A second `[Tag]` where `AllowMultiple` is false is error CS0579, and a class-only attribute on a field is error CS0592 ✅[^lab].
2. **Compiler: some attributes change the compiled code.**
   - `[Obsolete("…")]` makes every use a warning (CS0618), or an error (CS0619) when its second argument is `true`, and shows the message ✅[^attr-general] ✅[^lab].
   - `[Conditional("DEBUG")]` on a `void` method makes the compiler drop each call unless the symbol is defined ✅[^attr-general]. In the lab a Release build also skipped evaluating the call's arguments (a counter passed as the argument stayed at 0) ✅[^lab].
   - `[CallerMemberName]`, `[CallerLineNumber]`, `[CallerFilePath]` and `[CallerArgumentExpression]` go on optional parameters; the compiler writes the caller's name, line, file path or argument text into the IL (intermediate language) as literals at compile time ✅[^caller].
   - `nameof(x)` is a compile-time string constant; since C# 14 it accepts an unbound generic type, and `nameof(List<>)` is `"List"` ✅[^nameof] ✅[^lab].
3. **Runtime: one `Type` object per type.** `typeof(T)` needs a type name and is fixed at compile time; `GetType()` asks an object for its run-time type ✅[^typeof]. Both return the same object: `ReferenceEquals(typeof(string), "x".GetType())` is `True`, and its class is `System.RuntimeType` ✅[^lab], an internal runtime class that implements the abstract `Type` ✅[^refl-overview]. Assemblies contain modules, modules contain types, types contain members, and reflection has an object for each ✅[^refl-overview].
4. **Runtime: lookup and invoke.** `GetMethod(name)` and `GetField(name)` search public members unless `BindingFlags` say otherwise ✅[^lab]. `MethodBase.Invoke` checks and converts the `object[]` arguments, and wraps any exception the target throws in `TargetInvocationException`; `GetBaseException()` returns the original ✅[^api-methodbase]. `BindingFlags.DoNotWrapExceptions` turns the wrapping off ✅[^api-bindingflags]. `MethodInvoker` (.NET 8) is faster than `Invoke` when cached and reused ✅[^api-methodinvoker]; `CreateDelegate` turns the `MethodInfo` into an ordinary delegate, which in the lab cost about as much as a direct call (Worked example) ✅[^lab].
5. **Runtime: attribute objects are built on demand.** `GetCustomAttributes` constructs the attribute objects when it is called, not when the type loads ✅[^cs-access-attr]. In the lab every call ran the constructor again and returned new instances, while `IsDefined` and `CustomAttributeData` answered without running it ✅[^lab]; `CustomAttributeData` exists to examine attributes without creating them ✅[^refl-overview].
6. **Runtime: creating objects.** `Activator.CreateInstance(type, args)` runs the public constructor that best matches the arguments, or the parameterless one when none are given ✅[^api-activator]; a private constructor needs `nonPublic: true` ✅[^lab].
7. **Runtime: `UnsafeAccessor` (.NET 8) replaces reflection for known private members.** It goes on an `extern static` method, and the runtime supplies that method's body, which calls the named field, method or constructor directly; the first parameter names the owning type, base classes are not searched, and a missing member throws `MissingFieldException` or `MissingMethodException` ✅[^api-unsafeaccessor]. Generic targets work since .NET 9 ✅[^api-unsafeaccessor].
8. **Trimmer and AOT: reflection must be visible statically.** The trimmer starts from the entry points and keeps the code it can follow; a `Type` that comes from a string or an unknown object defeats it ✅[^trim-concepts]. `[DynamicallyAccessedMembers]` on a `Type` parameter is a contract: callers must pass a `Type` whose listed members are known, and the requirement flows back through every method that forwards it ✅[^trim-concepts]. Calling a member marked `[RequiresUnreferencedCode]` is warning IL2026 ✅[^il2026], and one marked `[RequiresDynamicCode]`, such as `MakeGenericType`, is IL3050 under Native AOT ✅[^il3050]. `<IsAotCompatible>true</IsAotCompatible>` turns on the trim, single-file and AOT analyzers ✅[^aot]. Native AOT cannot load assemblies dynamically or generate code at run time (`System.Reflection.Emit`) ✅[^aot].

## Worked example
One method, `Calc.Add(int)`, called 10 million times seven ways, in a Release build after two warm-up passes (Apple M2, numbers rounded) ✅[^lab].

| Way | Code | Time per call | Allocated per call | Why |
|---|---|---|---|---|
| Direct | `calc.Add(i)` | about 2.4 ns | 0 B | an ordinary call the JIT can inline |
| Delegate | `mi.CreateDelegate<Func<Calc,int,int>>()` once, then `del(calc, i)` | about 4.2 ns | 0 B | one indirect call; no boxing |
| `UnsafeAccessor` to a private twin of `Add` | `AddPrivate(calc, i)` | about 3.9 ns | 0 B | the runtime-built body calls the method directly (How it works 7) |
| `MethodInvoker` | `invoker.Invoke(calc, i)` | about 13.5 ns | 48 B | boxes the `int` argument and the `int` result; one boxed `int` measured 24 B |
| `MethodInfo.Invoke` | `mi.Invoke(calc, argv)` with a reused `object[]` | about 22.5 ns | 48 B | the same boxing plus argument checks |
| Lookup every time | `typeof(Calc).GetMethod("Add")!.Invoke(calc, new object[] { i })` | about 41 ns | 80 B | a name lookup and a new array on each call |
| Object creation | `new Calc()` against `Activator.CreateInstance(typeof(Calc))` | about 3.6 ns against 5.2 ns | 24 B each | the same 24 B object; `Activator` adds the step through a `Type` |

Look a member up once and cache the `MethodInfo`; for a hot path, turn it into a delegate or, for a private member known at compile time, an `UnsafeAccessor`.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `nothing.GetType()` on a `null` reference | `NullReferenceException` ✅[^lab] | `GetType()` is an instance method; `typeof` needs no object |
| `Show<Animal>(new Dog())` printing `typeof(T)` and `value.GetType()` | `Animal` and `Dog` ✅[^lab] | `typeof(T)` is the type argument; `GetType()` is the object's run-time type |
| `Invoke` with an `int` where the parameter is `decimal` | `ArgumentException` ✅[^lab] | `Invoke` performs only primitive widening (such as `Int16` to `Int32`) and reference widening ✅[^api-methodbase], not the other C# implicit conversions: in the lab an `int` for a `long` parameter worked, an `int` for a `decimal` did not ✅[^lab] |
| A `null` argument for a value-type parameter | The method gets a zero-initialized value ✅[^api-methodbase] | Documented `Invoke` behaviour |
| A base-class `MethodInfo` for a `virtual` method, invoked on a derived object | Runs the override: `Animal.Speak` on a `Dog` returned `Woof` ✅[^lab] | `Invoke` makes a virtual call: the Remarks of the `Invoke(Object, BindingFlags, Binder, Object[], CultureInfo)` overload say reflection uses dynamic method lookup and runs the derived class's implementation ✅[^api-methodbase]. The same page's Examples note says a base-class `MethodInfo` cannot invoke the override in a derived class ✅[^api-methodbase]; on runtime 10.0.12 it did |
| `Type.GetType("No.Such.Type")` | Returns `null` ✅[^lab] | The no-throw overload |
| An attribute with `Inherited = false` on a base class | `GetCustomAttributes(inherit: true)` on the derived class finds 0 ✅[^lab] | `Inherited` controls whether derived classes see it ✅[^attr-general] |
| `[CallerMemberName]` called from top-level statements | `<Main>$` ✅[^lab] | Top-level statements compile into a method with that generated name |
| `Type.GetType(userInput)` with the trim analyzer on | IL2057 at build time; it still runs under the JIT ✅[^lab] | The analyzer cannot know the type name |
| `Forward(Type t) => PrintMethods(t)` where only `PrintMethods` is annotated | IL2067 ✅[^lab] | The `[DynamicallyAccessedMembers]` requirement must be repeated on `t` ✅[^trim-concepts] |
| `JsonSerializer.Serialize(new { A = 1 })` with `IsAotCompatible` | IL2026 and IL3050 ✅[^lab] | Reflection-based serialization; the source-generated overloads avoid both (`dotnet/app-model/system-text-json.md`) |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `MethodInfo.Invoke` / `PropertyInfo.GetValue` | Works on any member found at run time | About 10 times a direct call, boxing, wrapped exceptions, trim and AOT warnings |
| `CreateDelegate` or `MethodInvoker`, cached | Close to a direct call (delegate), or faster `Invoke` semantics | Needs the signature (delegate) or still boxes (`MethodInvoker`) |
| `UnsafeAccessor` | Direct-call speed to private members; no reflection, so trim-safe | The member name and signature must be known when compiling; breaks silently if the target is renamed (throws at run time) |
| A source generator | No run-time lookup at all; AOT-friendly | Only for what is known at compile time (`dotnet/metaprogramming/source-generators.md`) |

## Takeaways
- Look a `MethodInfo` or `PropertyInfo` up once and cache it; on a hot path, call it through a delegate. [rule-candidate]
- Catch `TargetInvocationException` (or pass `BindingFlags.DoNotWrapExceptions`) around `Invoke`, never only the inner exception type.
- Keep attribute constructors free of side effects: they run on every `GetCustomAttributes` call. Use `IsDefined` when only presence matters.
- Use `nameof` and the caller-info attributes instead of member names in string literals. [rule-candidate]
- Code that may be trimmed or compiled with Native AOT must not take a `Type` from a string; annotate `Type` parameters with `[DynamicallyAccessedMembers]` and build with `IsAotCompatible` to see the warnings. [rule-candidate]

## Verification status
- Verified: 52 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `dotnet/lab-setup.md` — the .NET SDK 10.0.401 lab (runtime 10.0.12, C# 14, macOS 26.1 arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- [Reflection in .NET](https://learn.microsoft.com/en-us/dotnet/fundamentals/reflection/overview) — Microsoft, living. Rank 1. Backs: `Type` and `System.Reflection`; assemblies, modules, types and members; `RuntimeType`; `CustomAttributeData` without instances. [^refl-overview]
- [Attributes and reflection (C#)](https://learn.microsoft.com/en-us/dotnet/csharp/advanced-topics/reflection-and-attributes/) — Microsoft, living. Rank 1. Backs: the `Attribute` suffix may be omitted. [^cs-attrs]
- [Create custom attributes](https://learn.microsoft.com/en-us/dotnet/csharp/advanced-topics/reflection-and-attributes/creating-custom-attributes) — Microsoft, living. Rank 1. Backs: derive from `System.Attribute`; positional and named parameters. [^cs-create-attr]
- [Access attributes using reflection](https://learn.microsoft.com/en-us/dotnet/csharp/advanced-topics/reflection-and-attributes/accessing-attributes-by-using-reflection) — Microsoft, living. Rank 1. Backs: attribute objects are constructed when queried. [^cs-access-attr]
- [Miscellaneous attributes interpreted by the C# compiler](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/attributes/general) — Microsoft, living. Rank 1. Backs: `AttributeUsage` and its defaults, `Inherited`; `Obsolete`; `Conditional`. [^attr-general]
- [Caller information attributes](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/attributes/caller-information) — Microsoft, living. Rank 1. Backs: caller-info attributes on optional parameters, emitted as literals. [^caller]
- [nameof expression](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/nameof) — Microsoft, living. Rank 1. Backs: compile-time constant; C# 14 unbound generic types. [^nameof]
- [Type-testing operators: typeof](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/type-testing-and-cast) — Microsoft, living. Rank 1. Backs: `typeof` takes a type name; `GetType` for the run-time type. [^typeof]
- [MethodBase.Invoke](https://learn.microsoft.com/en-us/dotnet/api/system.reflection.methodbase.invoke) — Microsoft, living. Rank 1. Backs: `TargetInvocationException`, `GetBaseException`, `null` for a value type; primitive and reference widening of arguments; dynamic method lookup for virtual methods (Remarks) and the Examples note on base-class `MethodInfo`. [^api-methodbase]
- [BindingFlags](https://learn.microsoft.com/en-us/dotnet/api/system.reflection.bindingflags) — Microsoft, living. Rank 1. Backs: `DoNotWrapExceptions`. [^api-bindingflags]
- [MethodInvoker](https://learn.microsoft.com/en-us/dotnet/api/system.reflection.methodinvoker) — Microsoft, living. Rank 1. Backs: faster than `Invoke` when cached; in `System.Runtime` 8.0 and later. [^api-methodinvoker]
- [Activator.CreateInstance](https://learn.microsoft.com/en-us/dotnet/api/system.activator.createinstance) — Microsoft, living. Rank 1. Backs: best-matching public constructor; parameterless by default. [^api-activator]
- [UnsafeAccessorAttribute](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.compilerservices.unsafeaccessorattribute) — Microsoft, living. Rank 1. Backs: `extern static` body supplied by the runtime; owning type; no hierarchy walk; missing-member exceptions; generics since .NET 9; available from .NET 8. [^api-unsafeaccessor]
- [Understanding trim analysis](https://learn.microsoft.com/en-us/dotnet/core/deploying/trimming/trimming-concepts) — Microsoft, living. Rank 1. Backs: static analysis from entry points; `DynamicallyAccessedMembers` as a contract that flows back. [^trim-concepts]
- [IL2026](https://learn.microsoft.com/en-us/dotnet/core/deploying/trimming/trim-warnings/il2026) — Microsoft, living. Rank 1. Backs: `RequiresUnreferencedCode` warning. [^il2026]
- [IL3050](https://learn.microsoft.com/en-us/dotnet/core/deploying/native-aot/warnings/il3050) — Microsoft, living. Rank 1. Backs: `RequiresDynamicCode` warning; `MakeGenericType`. [^il3050]
- [Native AOT deployment](https://learn.microsoft.com/en-us/dotnet/core/deploying/native-aot/) — Microsoft, living. Rank 1. Backs: `IsAotCompatible` turns on four analyzers; no dynamic loading or `Reflection.Emit`. [^aot]

## Related
- `dotnet/metaprogramming/source-generators.md` — the compile-time alternative to most reflection.
- `dotnet/metaprogramming/interop-and-unsafe.md` — `DllImport` and `LibraryImport`, attributes the runtime and a generator act on.
- `dotnet/tooling/analyzers-and-code-quality.md` — warning levels, `TreatWarningsAsErrors` and the trim analyzers in a build.
- `dotnet/runtime/jit-tiering-and-aot.md` — what Native AOT compiles and removes.
- `dotnet/app-model/system-text-json.md` — reflection-based versus source-generated JSON.
