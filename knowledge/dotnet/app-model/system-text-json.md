---
schema: knowledge-doc/v1
type: concept
topic: dotnet/app-model
status: verified
applies-to: [".NET 10 (runtime 10.0.12)", "C# 14", "System.Text.Json 10.0 (shared framework)", ".NET 11.0.0 / System.Text.Json 11.0 (container lab) for the .NET 11 naming features"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [dotnet, json, system-text-json, serialization, jsonserializeroptions, polymorphism, converters, jsonnode, jsondocument, utf8jsonreader, source-generation, newtonsoft]
ranked-sources: true
---

# JSON with System.Text.Json

## Summary
**TL;DR:** `JsonSerializer` turns objects into JSON and back using a per-type "contract" that it builds once by reflection (or that a source generator writes at compile time) and caches on the `JsonSerializerOptions` instance. Its defaults are strict and literal: .NET names as written (`PascalCase`), case-sensitive matching, enums as numbers, no comments, no trailing commas, no quoted numbers, and unknown JSON properties silently ignored. `JsonSerializerOptions.Web` (camelCase, case-insensitive, quoted numbers allowed) is what ASP.NET Core uses, and .NET 10 adds `JsonSerializerOptions.Strict`. Create options once and reuse them.
**Use this when:** a deserialized object comes back full of zeros and nulls, JSON from a JavaScript client does not bind, a derived type loses its properties, `null` slips into a non-nullable property, a custom format (money, dates) is needed, you must read JSON without a class, or you prepare code for trimming and Native AOT (ahead-of-time compilation).
**Not this doc:** how ASP.NET Core picks these options for request bodies → `dotnet/app-model/aspnet-core-pipeline.md`; what source generators are in general → `dotnet/metaprogramming/source-generators.md`; spans and UTF-8 bytes → `dotnet/performance/span-and-memory.md`.

## Problem
JSON code that "works" can lose data without any error:
- A client sends `{"id":7,"customer":"Ana"}`; the server class has `Id` and `Customer`; the result is `Id=0`, `Customer=null`, no exception.
- `Serialize<Base>(derived)` drops every property of the derived class.
- `{"Name":null}` fills a non-nullable `string Name` with `null`.
- Creating `new JsonSerializerOptions { Converters = { … } }` in every call made each call about 70 times slower in the lab ✅[^lab].
- Code ported from Newtonsoft.Json breaks on single quotes, comments or numbers sent as strings.

## Mental model
**Analogy:** a customs officer with one printed form per type of goods. The first time a type arrives, the officer drafts its form (which fields, which names, which converters) and files it in the binder that belongs to one options instance. Every later shipment of that type is checked against the filed form. The officer follows the form literally: a box labelled `id` does not match the line `Id`, and a box with no line on the form is waved through and thrown away.

**Artifact** (run in the lab ✅[^lab]):
```csharp
var order = new Order { Id = 7, Customer = "Café <Ana>", Status = Status.Shipped, Total = 19.5m,
                        Placed = new DateTime(2026, 11, 24, 9, 30, 0, DateTimeKind.Utc) };
JsonSerializer.Serialize(order);
// {"Id":7,"Customer":"Caf\u00E9 \u003CAna\u003E","Status":2,"Total":19.5,"Note":null,"Placed":"2026-11-24T09:30:00Z"}
JsonSerializer.Serialize(order, JsonSerializerOptions.Web);
// {"id":7,"customer":"Caf\u00E9 \u003CAna\u003E","status":2,"total":19.5,"note":null,"placed":"2026-11-24T09:30:00Z"}
```

## How it works
Five actors take part in one `Serialize` or `Deserialize` call:
- **`JsonSerializer`** — its job: drive the call, via the static `Serialize` / `Deserialize` methods.
- **`JsonSerializerOptions`** — its job: hold the settings and cache each type's contract, via the options instance you pass (or `JsonSerializerOptions.Default`).
- **`JsonTypeInfo<T>`** (the contract) — its job: say how to create, read and write one type, via reflection at run time or a `JsonSerializerContext` generated at compile time.
- **Converters** — their job: read and write one .NET type as JSON tokens, via `JsonConverter<T>.Read` / `Write`.
- **`Utf8JsonReader` / `Utf8JsonWriter`** — their job: tokenize and write UTF-8 bytes, via a forward-only `ref struct` reader and a writer.

```
Deserialize<Order>(json, options)
  │
  ├─ options.GetTypeInfo(typeof(Order))
  │     cached? ── yes ──► contract
  │        └── no ──► reflection (or source-generated context) builds it, options becomes read-only
  │
  ├─ Utf8JsonReader: StartObject, PropertyName("id"), Number(7), …
  │
  └─ for each property token: match name (case-sensitive unless told otherwise)
        ├─ matched  → pick converter (property attribute > options.Converters > type attribute > built-in)
        └─ unmatched → skip (or throw when UnmappedMemberHandling = Disallow)
```

1. **Contracts are built once and cached.** The serializer needs metadata (getters, setters, constructor, attributes, options) for each type; by default it collects it by reflection the first time it sees the type and caches it ✅[^stj-refl-vs-sg]. Source generation can supply the same metadata at compile time instead ✅[^stj-refl-vs-sg].
2. **Reuse options.** The guidance is to reuse one `JsonSerializerOptions` instance instead of creating one per call ✅[^stj-options]. After its first use an instance is frozen: changing it threw `InvalidOperationException: This JsonSerializerOptions instance is read-only or has already been used…`, and so did changing `JsonSerializerOptions.Web` ✅[^lab]. The .NET 10 source shares one cache between equivalent instances (up to 64 tracked) ✅[^src-stj-caching], so in the lab 2,000 calls with a fresh but equal instance took about 4 ms against 2 ms cached; with a fresh converter object in each instance they took about 144 ms and allocated about 26,900 bytes per call instead of about 490 ✅[^lab].
3. **Serialization defaults.** All public properties are written, names keep their .NET casing, output is minified, fields are skipped, cycles are detected and throw, and the default encoder escapes non-ASCII and HTML-sensitive characters ✅[^stj-howto]. In the lab `é` became `\u00E9` and `<` became `\u003C`; `IncludeFields = true` added the field ✅[^lab].
4. **Deserialization defaults.** Matching is case-sensitive; JSON properties with no .NET member are ignored; enums are read as numbers; comments and trailing commas throw; maximum depth is 64; non-public constructors are ignored ✅[^stj-deserialize]. Only double-quoted names and strings are valid, and a number is not accepted for a `string` property ✅[^stj-migrate].
5. **Web defaults.** Web apps use `PropertyNameCaseInsensitive = true`, `PropertyNamingPolicy = CamelCase` and `NumberHandling = AllowReadingFromString`; from .NET 9 `JsonSerializerOptions.Web` is that preset as a singleton ✅[^stj-options]. Used indirectly through ASP.NET Core, the maximum depth is 32 instead of 64 ✅[^stj-migrate].
6. **Names.** `[JsonPropertyName]` beats any naming policy ✅[^stj-customize]. Built-in policies are `CamelCase` plus, from .NET 8, `SnakeCaseLower/Upper` and `KebabCaseLower/Upper` ✅[^stj-customize]; `SnakeCaseLower` turned `PlacedAtUtc` into `placed_at_utc` ✅[^lab]. .NET 11 adds a `PascalCase` policy and a `[JsonNamingPolicy]` attribute for types and members ✅[^stj-customize], and the name is chosen in this order: `[JsonPropertyName]`, a member-level `[JsonNamingPolicy]`, a type-level one, `options.PropertyNamingPolicy`, the .NET name ✅[^stj-customize]. In the .NET 11 container lab, `PascalCase` turned `tempCelsius` into `TempCelsius`; `[JsonNamingPolicy(JsonKnownNamingPolicy.CamelCase)]` on a class with one `SnakeCaseLower` property wrote `{"temperatureCelsius":25,"summary_text":"Hot"}`, also with `SnakeCaseUpper` in the options and from a source-generated context whose options said `PascalCase`, and read it back; `[JsonPropertyName("given")]` beat a member attribute ✅[^lab11].
7. **Enums.** Numbers by default; `JsonStringEnumConverter` writes names, and only its generic form `JsonStringEnumConverter<T>` works under Native AOT ✅[^stj-customize]. With the converter, `"shipped"` and `2` both read back as `Shipped` ✅[^lab].
8. **Required and nullable.** A `required` member or `[JsonRequired]` must be present, or `Deserialize` throws `JsonException` ✅[^stj-required]. Constructor parameters are optional unless `RespectRequiredConstructorParameters = true` (.NET 9) ✅[^stj-required]. `RespectNullableAnnotations = true` (.NET 9) rejects an explicit `null` for a non-nullable reference, but a missing property still leaves the default, and it cannot see nullability of top-level types, collection elements or generic members ✅[^stj-nullable]. .NET 10 adds `AllowDuplicateProperties = false` and the `JsonSerializerOptions.Strict` preset (disallow unmapped members and duplicates, case-sensitive, both `Respect…` flags on) ✅[^net10-libs]; the lab confirmed each flag on `Strict` ✅[^lab].
9. **Converters.** For each value the serializer picks, from highest priority: `[JsonConverter]` on the property, then a converter in `options.Converters`, then `[JsonConverter]` on the type; built-in converters only when no custom one applies ✅[^stj-converters]. In the lab a cents converter in options wrote `"Amount":1234` while the property attribute on `Fee` still wrote `"0.50 EUR"` ✅[^lab].
10. **Polymorphism is opt-in.** Newtonsoft.Json is polymorphic automatically; System.Text.Json only through `[JsonDerivedType]` (.NET 7+) ✅[^stj-migrate]. `[JsonDerivedType(typeof(D), "d")]` on the base opts a subtype in, and the discriminator (`$type`) lets it round-trip; without one, the payload comes back as the base type ✅[^stj-polymorphism]. A value typed as `object` is written by its runtime type ✅[^stj-supported]. `$type` must come first in the object unless `AllowOutOfOrderMetadataProperties = true` ✅[^stj-polymorphism].
11. **Reading JSON without a class.** `JsonNode` (with `JsonObject`, `JsonArray`, `JsonValue`) is a mutable DOM (document object model); `JsonDocument` is read-only and faster ✅[^stj-dom]. `JsonDocument` is `IDisposable`, its `JsonElement`s die with it, and `Clone()` keeps a copy ✅[^stj-dom]. `Utf8JsonReader` is a forward-only, low-allocation reader over UTF-8 bytes, and a mutable `ref struct` to pass by reference ✅[^stj-reader].
12. **Source generation.** A `partial` class deriving from `JsonSerializerContext` with `[JsonSerializable(typeof(T))]` gets generated metadata; you pass `Context.Default.T` (a `JsonTypeInfo<T>`) to the serializer ✅[^stj-sourcegen]. It cuts start-up time and private memory, removes run-time reflection and allows trimming; its fast-path mode speeds up serialization only ✅[^stj-refl-vs-sg]. `JsonSerializerIsReflectionEnabledByDefault=false` turns reflection off, and `PublishTrimmed` does so by default ✅[^stj-sourcegen].

## Worked example
One JSON payload from a JavaScript client, `{"id":7,"customer":"Ana","total":"19.5"}`, read into the Mental model's `Order` class (`int Id`, `string? Customer`, `Status Status`, `decimal Total`, `string? Note`, `DateTime Placed`, all public read-write properties) with different options ✅[^lab]:

| Step | Call | Result | Rule |
|---|---|---|---|
| 1 | `Deserialize<Order>(json)` | `Id=0`, `Customer=<null>`, no exception | case-sensitive; unmatched names are skipped (How it works 4) |
| 2 | `Deserialize<Order>("""{"Total":"19.5"}""")` | `JsonException: The JSON value could not be converted to System.Decimal.` | quoted numbers off by default |
| 3 | `Deserialize<Order>(json, JsonSerializerOptions.Web)` | `Id=7`, `Customer=Ana`, `Total` 19.5 (printed `19,5` by the lab machine's `en_VN` culture) | camelCase, case-insensitive, quoted numbers (How it works 5) |
| 4 | `Deserialize<Order>("""{"Id":3,"Extra":true}""", JsonSerializerOptions.Strict)` | `JsonException: The JSON property 'Extra' could not be mapped to any .NET member contained in type 'Order'.` | `Strict` disallows unmapped members |
| 5 | `Deserialize<Order>("""{"Id":1,"Id":-1}""")` | `Id=-1` (last wins); with `AllowDuplicateProperties = false`: `Duplicate property 'Id' encountered during deserialization of type 'Order'.` | .NET 10 option |
| 6 | `Serialize(order3, AppJsonContext.Default.Order)`, where `order3` is the step 3 result, with `[JsonSourceGenerationOptions(PropertyNamingPolicy = CamelCase)]`; then with `DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingDefault` added to that attribute | `{"id":7,"customer":"Ana","status":0,"total":19.5,"note":null,"placed":"0001-01-01T00:00:00"}`; with the ignore condition, `{"id":7,"customer":"Ana","total":19.5}` | source-generated contract, no reflection for this type; members left at their default values are written unless an ignore condition drops them |

Step 1 is the dangerous one: the only symptom is default values downstream. Steps 3 to 5 together are the usual choice for a public API: `Web` for casing and `Strict`-style checks for unknown and duplicate fields.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `Serialize<Shape>(circle)` with no attributes | `{"Name":"c1"}`; as `object` it gave `{"Radius":2,"Name":"c1"}` ✅[^lab] | Polymorphism is opt-in ✅[^stj-migrate]; `object` is written by its runtime type ✅[^stj-supported] |
| `$type` after another property | `JsonException: The metadata property is either not supported by the type or is not the first property in the deserialized JSON object.` ✅[^lab] | Must be first unless `AllowOutOfOrderMetadataProperties` ✅[^stj-polymorphism] |
| Unknown discriminator `"cat"` / unregistered subtype `Puppy` | `Read unrecognized type discriminator id 'cat'.` / `NotSupportedException: Runtime type 'Puppy' is not supported by polymorphic type 'Animal'.` ✅[^lab] | Only listed subtypes are allowed; `JsonUnknownDerivedTypeHandling` can fall back to a base ✅[^stj-polymorphism] |
| `{"Status":99}` for an enum | Reads as `99`, a value with no name ✅[^lab] | Enums are plain numbers by default ✅[^stj-deserialize]; validate with `Enum.IsDefined` |
| `record Point(int X, int Y)` from `{}` | `Point { X = 0, Y = 0 }`; with `RespectRequiredConstructorParameters`: `…was missing required properties including: 'X', 'Y'.` ✅[^lab] | Constructor parameters are optional by default ✅[^stj-required] |
| `{"Name":null}` vs `{}` with `RespectNullableAnnotations` | `null` throws `…doesn't allow setting null values…`; missing keeps `"default"` ✅[^lab] | Explicit null and missing are different cases ✅[^stj-nullable] |
| `{"Id":null}` for an `int` | `JsonException: The JSON value could not be converted to System.Int32.` ✅[^lab] | Make it `int?` ✅[^stj-migrate] |
| 65 nested arrays | `The maximum configured depth of 64 has been exceeded.` ✅[^lab] | Default `MaxDepth` 64 ✅[^stj-deserialize] |
| Object that references itself | `A possible object cycle was detected…`; `ReferenceHandler.IgnoreCycles` writes `"Next":null` ✅[^lab] | Cycles are detected by default ✅[^stj-howto] |
| JSON number `1e400` into `double` / `300` into `byte` | `∞`, no exception / `JsonException` ✅[^lab] | Out-of-range doubles become infinity; integers are range-checked |
| `JsonDocument` element used after `Dispose` | `ObjectDisposedException`; a `Clone()` taken before still works ✅[^lab] | Elements live in the document's pooled buffer ✅[^stj-dom] |
| `root.GetProperty("missing")` | `KeyNotFoundException`; `TryGetProperty` returns `false` ✅[^lab] | Use the `Try` form for optional fields |
| `JsonNamingPolicy.PascalCase` (.NET 11) on names with acronyms | `IOStream` became `IoStream`, `URLValue` `UrlValue`, `ID` `Id`, `userID` `UserId` and `iOS` `IOs` ✅[^lab11] | The lab's `SnakeCaseLower` split the same names into the same words (`io_stream`, `url_value`, `user_id`, `i_os`) ✅[^lab11], so `PascalCase` is not a no-op on .NET names; leave the policy unset to keep names as written ✅[^stj-howto] |
| Source-generated context without the type | `NotSupportedException: JsonTypeInfo metadata for type 'Invoice' was not provided by TypeInfoResolver…` ✅[^lab] | Every root type needs `[JsonSerializable]` ✅[^stj-sourcegen] |

### Coming from Newtonsoft.Json
| Newtonsoft.Json habit | System.Text.Json behaviour | Why |
|---|---|---|
| Case-insensitive names | Case-sensitive unless options say otherwise (ASP.NET Core already does) ✅[^stj-migrate] | Exact match is faster ✅[^stj-migrate] |
| `'single'` quotes, unquoted names | `''' is an invalid start of a value.` ✅[^lab] | RFC (Request for Comments) 8259, the JSON standard, allows only double quotes ✅[^stj-migrate] |
| Comments and trailing commas ignored | Throw unless `ReadCommentHandling = Skip`, `AllowTrailingCommas = true` ✅[^stj-invalid] | Not valid JSON ✅[^stj-migrate] |
| `TypeNameHandling.All` | No equivalent; use `[JsonDerivedType]` | Payload-chosen types are a known vulnerability ✅[^stj-migrate] |
| `JObject` editing, JSON Path queries | `JsonNode` edits; no JSON Path, only `GetPath()` (`$.order.lines[1].qty` in the lab ✅[^lab]) | No built-in JSON Path query API ✅[^stj-migrate] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Reflection (default) | Simplest; supports every customization ✅[^stj-refl-vs-sg] | Start-up cost per type; not trim- or Native-AOT-safe ✅[^stj-refl-vs-sg] |
| Source generation | Faster start-up, less memory, trimming and AOT ✅[^stj-refl-vs-sg] | A context class; every root type listed; some customizations need the contract API ✅[^stj-refl-vs-sg] |
| `JsonSerializerOptions.Web` | Matches browsers and ASP.NET Core ✅[^stj-options] | Accepts quoted numbers and any casing |
| `JsonSerializerOptions.Strict` | Rejects unknown, duplicate and null-violating input ✅[^net10-libs] | Older clients that send extra fields fail |
| `JsonNode` | Edit in place, build JSON by hand ✅[^stj-dom] | Allocates a node per element |
| `JsonDocument` / `Utf8JsonReader` | Read-only and fast; reader is forward-only with low allocation ✅[^stj-dom] ✅[^stj-reader] | Dispose rules; reader code is verbose |

## Takeaways
- Create each `JsonSerializerOptions` once (a `static readonly` field or dependency-injection (DI) singleton) and never put `new SomeConverter()` inside a per-call options object. [rule-candidate]
- For public input, start from `Web` casing plus `UnmappedMemberHandling.Disallow`, `AllowDuplicateProperties = false`, `RespectNullableAnnotations` and `RespectRequiredConstructorParameters` (or `Strict` when casing must be exact). [rule-candidate]
- Mark must-have fields `required`; non-nullable annotations alone do not catch a missing property. [rule-candidate]
- Use `[JsonDerivedType]` for polymorphism; never let the payload choose a .NET type.
- Use source generation for trimmed or Native AOT apps and for hot serialization paths.

## Verification status
- Verified: 86 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `dotnet/lab-setup.md` — the .NET SDK 10.0.401 lab (runtime 10.0.12, C# 14, macOS 26.1 arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- `dotnet/lab-setup.md` (Step 13) — the .NET 11 container lab (SDK 11.0.100, runtime 11.0.0, C# 15, Ubuntu 26.04.1 arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab11]
- [How to write .NET objects as JSON (serialize)](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/how-to) — Microsoft, living. Rank 1. Backs: serialization defaults; encoder; cycles; fields. [^stj-howto]
- [How to read JSON as .NET objects (deserialize)](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/deserialization) — Microsoft, living. Rank 1. Backs: deserialization defaults; enums as numbers; depth 64. [^stj-deserialize]
- [How to instantiate JsonSerializerOptions instances](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/configure-options) — Microsoft, living. Rank 1. Backs: reuse options; web defaults; `JsonSerializerOptions.Web`. [^stj-options]
- [How to customize property names and values](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/customize-properties) — Microsoft, living. Rank 1. Backs: `[JsonPropertyName]` precedence; naming policies and their versions; .NET 11 `PascalCase` and `[JsonNamingPolicy]` with the name-selection order; enum converters and AOT. [^stj-customize]
- [Required properties](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/required-properties) — Microsoft, living. Rank 1. Backs: `required`, `[JsonRequired]`; `RespectRequiredConstructorParameters`. [^stj-required]
- [Respect nullable annotations](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/nullable-annotations) — Microsoft, living. Rank 1. Backs: `RespectNullableAnnotations`; null versus missing; limitations. [^stj-nullable]
- [How to write custom converters](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/converters-how-to) — Microsoft, living. Rank 1. Backs: converter precedence. [^stj-converters]
- [How to serialize properties of derived classes](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/polymorphism) — Microsoft, living. Rank 1. Backs: declared type rule; `[JsonDerivedType]`; `$type` position; unknown derived types. [^stj-polymorphism]
- [Supported types in System.Text.Json](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/supported-types) — Microsoft, living. Rank 1. Backs: `object` serialized by its runtime type. [^stj-supported]
- [How to use a JSON document object model](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/use-dom) — Microsoft, living. Rank 1. Backs: `JsonNode` versus `JsonDocument`; disposal; `Clone`. [^stj-dom]
- [How to use Utf8JsonReader](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/use-utf8jsonreader) — Microsoft, living. Rank 1. Backs: forward-only, low-allocation `ref struct` reader. [^stj-reader]
- [How to allow some kinds of invalid JSON](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/invalid-json) — Microsoft, living. Rank 1. Backs: comment and trailing-comma options. [^stj-invalid]
- [How to use source generation in System.Text.Json](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/source-generation) — Microsoft, living. Rank 1. Backs: `JsonSerializerContext` usage; disabling reflection; `PublishTrimmed`. [^stj-sourcegen]
- [Reflection versus source generation](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/reflection-vs-source-generation) — Microsoft, living. Rank 1. Backs: metadata collection and caching; source-generation modes and benefits. [^stj-refl-vs-sg]
- [Migrate from Newtonsoft.Json to System.Text.Json](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/migrate-from-newtonsoft) — Microsoft, living. Rank 1. Backs: casing, quotes, comments, non-string values, null into value types, ASP.NET Core depth 32, `TypeNameHandling`, JSON Path. [^stj-migrate]
- [What's new in .NET libraries for .NET 10](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-10/libraries) — Microsoft, living. Rank 1. Backs: `AllowDuplicateProperties`; `JsonSerializerOptions.Strict`. [^net10-libs]
- [JsonSerializerOptions.Caching.cs (release/10.0)](https://github.com/dotnet/runtime/blob/release/10.0/src/libraries/System.Text.Json/src/System/Text/Json/Serialization/JsonSerializerOptions.Caching.cs) — .NET team, 2025. Rank 1. Backs: equivalent options share a cache of up to 64 tracked contexts. [^src-stj-caching]

## Related
- `dotnet/app-model/aspnet-core-pipeline.md` — request and response bodies use the web defaults.
- `dotnet/app-model/httpclient-and-ihttpclientfactory.md` — `ReadFromJsonAsync` on HTTP responses.
- `dotnet/metaprogramming/source-generators.md` — how the JSON source generator fits with the others.
- `dotnet/metaprogramming/reflection-and-attributes.md` — reflection, trimming and AOT warnings.
- `dotnet/type-design/nullable-reference-types.md` — the annotations `RespectNullableAnnotations` reads.
- `dotnet/runtime/jit-tiering-and-aot.md` — Native AOT.
