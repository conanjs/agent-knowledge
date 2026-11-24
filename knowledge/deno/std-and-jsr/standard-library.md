---
schema: knowledge-doc/v1
type: reference
topic: deno/std-and-jsr
status: verified
applies-to: ["Deno 2.9.8", "the 43 @std packages on jsr.io as of 2026-11-24"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [deno, std, standard-library, jsr, stability, semver, unstable, imports, npm]
ranked-sources: true
---

# The Deno standard library (`@std`) packages

## Summary
**TL;DR:** The Deno standard library is 43 separate packages in the `@std` scope on JSR (the JavaScript Registry), each with its own version: 1.x packages follow semantic versioning, 0.x packages are unstable, and `@std/internal` is not for direct use. Add one with `deno add jsr:@std/path`, which saves `"@std/path": "jsr:@std/path@^1.1.6"`, or import `jsr:@std/path@^1` inline. npm projects get the same packages as `@jsr/std__path` through JSR's npm compatibility layer.
**Use this when:** you look for a ready-made helper (paths, encodings, formats, streams, testing), need to know whether an `@std` package is stable, or write the import for one.
**Not this doc:** how JSR packages, ranges and publishing work → `deno/std-and-jsr/jsr-and-publishing.md`; `@std/assert`, `@std/expect` and `@std/testing` in use → `deno/testing/testing-and-mocking.md`; `@std/http` static files → `deno/web/websockets-sse-and-routing.md`; `deno add` and `deno.lock` → `deno/modules/dependency-management.md`.

## Scope
**Covers:** every package listed at jsr.io/@std on 2026-11-24 (43 packages, the same 43 names as the Deno docs' standard library page) ✅[^std-scope] ✅[^std-docs], with the latest version read from JSR in the lab ✅[^run], its stability, the runtimes JSR marks it compatible with ✅[^jsr-api], and one import that type-checked under Deno 2.9.8 ✅[^run]. It does not document each package's functions: each package page on jsr.io has the generated docs.

**Analogy:** `@std` is a toolbox in which every drawer (package) carries its own version label. A 1.x drawer is sealed: new tools may be added, nothing is taken away without a new major label. A 0.x drawer is still being rearranged. **Artifact:** the `deno.json` line `deno add jsr:@std/path` wrote, `"@std/path": "jsr:@std/path@^1.1.6"` ✅[^run].

Abbreviations used below: API = application programming interface; CBOR = Concise Binary Object Representation; CSV = comma-separated values; FAQ = frequently asked questions; HTML = HyperText Markup Language; HTTP = Hypertext Transfer Protocol; INI = initialization file; I/O = input/output; JSON = JavaScript Object Notation; JSONC = JSON with comments; MIME = Multipurpose Internet Mail Extensions; PRNG = pseudo-random number generator; BDD = behaviour-driven development; TOML = Tom's Obvious, Minimal Language; ULID = Universally Unique Lexicographically Sortable Identifier; URL = uniform resource locator, a web address; UUID = universally unique identifier; XML = Extensible Markup Language; YAML = YAML Ain't Markup Language; TSDoc = the TypeScript documentation-comment standard.

## Catalog

### Packages
Latest versions read from each package's `meta.json` on jsr.io (path `/@std/<name>/meta.json`, field `latest`) in the lab on 2026-11-24 ✅[^run]; purposes paraphrase each package's JSR description, and "UNSTABLE"/"INTERNAL" labels come from those descriptions ✅[^std-scope] ✅[^jsr-api] ✅[^std-docs]. Runtimes are those marked compatible on JSR: "All 5" = browsers, Deno, Node.js, Bun and `workerd`, JSR's key for the Workers edge runtime ✅[^jsr-api]. Every import in the last column passed `deno check` together in one file (exit code 0) and resolved to a defined value at run time ✅[^run].

| Package | Purpose | Latest | Stability | Runtimes marked compatible | Typical import |
|---|---|---|---|---|---|
| `@std/assert` | Assertion functions, mainly for tests | 1.0.19 | stable | All 5 | `{ assertEquals }` from `jsr:@std/assert@^1` |
| `@std/async` | Delays, debouncing, pooling | 1.5.1 | stable | All 5 | `{ delay }` from `jsr:@std/async@^1` |
| `@std/bytes` | `Uint8Array` helpers JavaScript lacks | 1.0.6 | stable | All 5 | `{ concat }` from `jsr:@std/bytes@^1` |
| `@std/cache` | Caching helpers | 0.2.4 | unstable | All 5 | `{ memoize }` from `jsr:@std/cache@^0.2.4` |
| `@std/cbor` | CBOR encoding and decoding | 0.1.10 | unstable | Browsers, Deno | `{ encodeCbor }` from `jsr:@std/cbor@^0.1.10` |
| `@std/cli` | Building interactive command-line tools | 1.0.32 | stable | Deno | `{ parseArgs }` from `jsr:@std/cli@^1` |
| `@std/collections` | Pure functions over arrays and objects | 1.4.0 | stable | All 5 | `{ chunk }` from `jsr:@std/collections@^1` |
| `@std/crypto` | Extensions to the Web Crypto API | 1.1.0 | stable | Browsers, Deno | `{ crypto }` from `jsr:@std/crypto@^1` |
| `@std/csv` | Reading and writing CSV | 1.0.6 | stable | All 5 | `{ parse }` from `jsr:@std/csv@^1` |
| `@std/data-structures` | Red-black trees, binary heaps and similar | 1.1.3 | stable | All 5 | `{ BinaryHeap }` from `jsr:@std/data-structures@^1` |
| `@std/datetime` | Helpers for `Date` objects | 0.225.7 | unstable | All 5 | `{ format }` from `jsr:@std/datetime@^0.225.7` |
| `@std/dotenv` | Parsing and loading `.env` files | 0.225.8 | unstable | Deno | `{ load }` from `jsr:@std/dotenv@^0.225.8` |
| `@std/encoding` | Hex, base64, varint and similar encodings | 1.0.11 | stable | All 5 | `{ encodeBase64 }` from `jsr:@std/encoding@^1` |
| `@std/expect` | Jest-compatible `expect` assertions | 1.0.20 | stable | All 5 | `{ expect }` from `jsr:@std/expect@^1` |
| `@std/fmt` | Terminal colours, durations, printf, byte sizes | 1.0.10 | stable | All 5 | `{ bold }` from `jsr:@std/fmt@^1/colors` |
| `@std/front-matter` | Extracting front matter from strings | 1.0.9 | stable | All 5 | `{ extract }` from `jsr:@std/front-matter@^1/yaml` |
| `@std/fs` | File-system helpers | 1.0.24 | stable | Deno | `{ ensureDir }` from `jsr:@std/fs@^1` |
| `@std/html` | Escaping and unescaping HTML entities | 1.0.7 | stable | All 5 | `{ escape }` from `jsr:@std/html@^1` |
| `@std/http` | Utilities for HTTP servers | 1.1.4 | stable | Deno | `{ serveDir }` from `jsr:@std/http@^1/file-server` |
| `@std/ini` | INI parsing and serializing | 0.225.2 | unstable | All 5 | `{ parse }` from `jsr:@std/ini@^0.225.2` |
| `@std/internal` | Shared code for other `@std` packages | 1.0.14 | internal: do not import | Browsers, Deno | none |
| `@std/io` | I/O through `Reader`/`Writer` interfaces | 0.225.3 | unstable | Deno | `{ readAll }` from `jsr:@std/io@^0.225.3` |
| `@std/json` | Streaming JSON parsing and serializing | 1.1.0 | stable | All 5 | `{ JsonParseStream }` from `jsr:@std/json@^1` |
| `@std/jsonc` | JSONC parsing and serializing | 1.0.3 | stable | All 5 | `{ parse }` from `jsr:@std/jsonc@^1` |
| `@std/log` | A configurable logger | 0.224.14 | unstable | Deno | `{ getLogger }` from `jsr:@std/log@^0.224.14` |
| `@std/math` | Basic math helpers | 0.0.0 | 0.x, no unstable label | All 5 | `{ clamp }` from `jsr:@std/math@^0.0.0` |
| `@std/media-types` | MIME type helpers | 1.1.0 | stable | All 5 | `{ contentType }` from `jsr:@std/media-types@^1` |
| `@std/msgpack` | MessagePack encoding and decoding | 1.0.3 | stable | All 5 | `{ encode }` from `jsr:@std/msgpack@^1` |
| `@std/net` | Network helpers | 1.0.7 | stable | Deno | `{ getAvailablePort }` from `jsr:@std/net@^1` |
| `@std/path` | File-system path helpers | 1.1.6 | stable | All but Bun | `{ join }` from `jsr:@std/path@^1` |
| `@std/random` | Random-number helpers, including a seeded PRNG | 0.1.5 | unstable | All 5 | `{ randomIntegerBetween }` from `jsr:@std/random@^0.1.5` |
| `@std/regexp` | Regular-expression helpers | 1.0.2 | stable | All 5 | `{ escape }` from `jsr:@std/regexp@^1` |
| `@std/semver` | Parsing and comparing semantic versions | 1.0.8 | stable | All 5 | `{ parse }` from `jsr:@std/semver@^1` |
| `@std/streams` | Helpers for the Web Streams API | 1.2.0 | stable | All 5 | `{ TextLineStream }` from `jsr:@std/streams@^1` |
| `@std/tar` | Streaming tar archives | 0.1.10 | unstable | Deno | `{ TarStream }` from `jsr:@std/tar@^0.1.10` |
| `@std/testing` | Snapshot tests, BDD, time mocking | 1.0.21 | stable | Deno | `{ describe, it }` from `jsr:@std/testing@^1/bdd` |
| `@std/text` | Text helpers such as case conversion | 1.1.0 | stable | All 5 | `{ toCamelCase }` from `jsr:@std/text@^1` |
| `@std/toml` | TOML parsing and serializing | 1.0.11 | stable | All 5 | `{ parse }` from `jsr:@std/toml@^1` |
| `@std/ulid` | ULID generation | 1.0.0 | stable | All 5 | `{ ulid }` from `jsr:@std/ulid@^1` |
| `@std/uuid` | UUID generators and validators | 1.1.2 | stable | All 5 | `{ validate }` from `jsr:@std/uuid@^1` |
| `@std/webgpu` | Helpers for the WebGPU API | 0.224.9 | unstable | Browsers, Deno | `{ createTextureWithData }` from `jsr:@std/webgpu@^0.224.9` |
| `@std/xml` | XML parsing and serializing | 0.2.0 | 0.x, no unstable label | All 5 | `{ parse }` from `jsr:@std/xml@^0.2.0` |
| `@std/yaml` | YAML parsing and serializing | 1.3.0 | stable | All 5 | `{ parse }` from `jsr:@std/yaml@^1` |

### Stability and versioning policy
| Rule | What it means in practice | Source |
|---|---|---|
| Versions ≥ 1.0.0 follow semantic versioning | Breaking changes only in a new major version | ✅[^std-readme] ✅[^std-docs] |
| Versions < 1.0.0 follow a separate proposal for 0.x numbers | 0.x packages are the unstable ones; their API may change without a major bump | ✅[^std-readme] ✅[^std-docs] |
| Each package has its own version, unrelated to Deno's | `@std/path` 1.1.6 and `@std/log` 0.224.14 both work on Deno 2.9.8 | ✅[^std-faq] ✅[^run] |
| New features start as unstable | They are stabilized after feedback | ✅[^std-contrib] |
| Unstable APIs inside a 1.x package live in `unstable_<name>.ts` files and are not exported from `mod.ts` | They appear as `./unstable-*` entrypoints: `@std/encoding` 1.0.11 has 6 (e.g. `./unstable-base32-stream`), `@std/http` 1.1.4 has 12, `@std/path` 1.1.6 none | ✅[^std-contrib] ✅[^run] |
| Unstable APIs carry the TSDoc tag `@experimental` | Written as `@experimental **UNSTABLE**: New API, yet to be vetted.` in the doc comment | ✅[^std-contrib] |
| A change confined to unstable APIs is released as a patch, even a breaking one | `^1` can pick up a breaking change to an `unstable-*` entrypoint | ✅[^std-contrib] |
| A deprecated API is removed, in almost all cases, in the next major version | To keep using it, pin the older major, e.g. `jsr:@std/foo@^0/bar` | ✅[^std-faq] |
| `@std` is designed for, and tested in CI (continuous integration) against, the latest stable and canary Deno | Only those two Deno releases are the stated target | ✅[^std-faq] |
| Versions up to 0.224.0 stay at `deno.land/std`; newer ones are only on JSR | Old `https://deno.land/std@0.224.0/...` URLs remain available there | ✅[^std-readme] |

### Ways to import
Every row ran in the lab on 2026-11-24 ✅[^run].

| Form | Example | What Deno 2.9.8 did |
|---|---|---|
| `deno add`, then a bare name | `deno add jsr:@std/path jsr:@std/log`, then `import { join } from "@std/path";` | Saved `"@std/path": "jsr:@std/path@^1.1.6"` and `"@std/log": "jsr:@std/log@^0.224.14"` under `imports` in `deno.json` |
| Inline range, no `deno.json` | `import { join } from "jsr:@std/path@^1";` | Resolved and ran; `join("a", "b")` printed `a/b` |
| Subpath entrypoint | `import { bold } from "jsr:@std/fmt@^1/colors";` | The path after the range picks one key of the package's `exports` (`./colors`) |
| Unstable entrypoint of a 1.x package | `import * as m from "jsr:@std/encoding@^1/unstable-base32-stream";` | Exported `Base32DecoderStream` and `Base32EncoderStream` |
| A path outside `exports` | `jsr:@std/path@^1/_common/does-not-exist` | `error: Unknown export './_common/does-not-exist' for '@std/path@1.1.6'`, followed by the 61 valid keys |

How ranges such as `^1`, `1.0` or a missing version resolve, and what `deno.lock` records for each, is in `deno/std-and-jsr/jsr-and-publishing.md` (section "Consuming a version").

## Lookup notes
- **From Node.js, Bun and npm-based tools.** An `@std` package installs like any JSR package, under its mapped npm name: `npx jsr add @std/path` records `"@std/path": "npm:@jsr/std__path@^<version>"` plus an `.npmrc` line for `https://npm.jsr.io`, and pnpm 10.9+ and Yarn 4.9+ take `jsr:@std/path` directly ✅[^using] ✅[^npm-compat]. Which tool takes which form, the name rule, installing by hand and what the npm tarball holds are in `deno/std-and-jsr/jsr-and-publishing.md` (section "From npm and other package managers"). JSR's own publishing guide uses `"@std/encoding": "npm:@jsr/std__encoding@1"` as its `package.json` example ✅[^jsr-publish]. None of this was run in the lab, whose network allowed only jsr.io.
- **Package count.** jsr.io/@std showed "Showing 1 to 43 results, out of 43", the JSR API returned `total: 43`, and the Deno docs page lists the same 43 names ✅[^std-scope] ✅[^jsr-api] ✅[^std-docs]. A new package changes the count; re-read jsr.io/@std rather than this table.
- **"Stable" in the table** means version ≥ 1.0.0; "unstable" means a 0.x version that JSR's description and the Deno docs both label UNSTABLE ✅[^jsr-api] ✅[^std-docs]. `@std/math` (only version: 0.0.0, entrypoints `.`, `./clamp`, `./modulo`, `./round-to`) and `@std/xml` (0.2.0) are 0.x but carry no unstable label ✅[^run] ✅[^jsr-api]; by the README's version rule they are still pre-1.0 ✅[^std-readme].
- **Runtime column.** JSR's API stores `true` or `false` per runtime and leaves some runtimes out of the record (Bun for `@std/cli`) ✅[^jsr-api]; a package page offers three levels, supported, unsupported and unknown ✅[^packages]. The table lists only the `true` ones. Nine packages are marked compatible with Deno only: `cli`, `dotenv`, `fs`, `http`, `io`, `log`, `net`, `tar`, `testing` ✅[^jsr-api]. The Deno docs say the library works on other runtimes "wherever the underlying platform APIs are available" ✅[^std-docs].
- **`^0` versus `^0.224.0`.** The FAQ suggests `jsr:@std/foo@^0` for a package whose latest major is 0 ✅[^std-faq]. Measured: `jsr:@std/datetime@^0` resolved 0.225.7 (lock key `@0`), while `jsr:@std/datetime@^0.224.0` stayed on 0.224.5 (lock key `@0.224`) ✅[^run]. The README points 0.x versions to an open SemVer pull request, "[spec] document real-world v0 semantics", which treats the 0.y minor number as the breaking one ✅[^semver-pr]; if that holds for a package, `^0` can cross a breaking line. The form `deno add` writes (`^0.224.14` for `@std/log`, locked as `~0.224.14`) stays on one line ✅[^run].
- **`@std/internal` arrives anyway.** The lock showed `@std/path@1.1.6` depending on `jsr:@std/internal` ✅[^run]; it is meant only for other `@std` packages ✅[^std-docs].
- **Provenance.** The `@std/path` page shows "Built and signed on GitHub Actions" with a transparency-log link ✅[^std-path], and its JSR score is 100 ✅[^jsr-api].
- **No third-party dependencies, but `@std` ones.** The Deno docs say every module "has no third-party dependencies" ✅[^std-docs]; `@std` packages do depend on each other (`@std/log` 0.224.14 pulled in `@std/fmt`, `@std/fs` and `@std/io`) ✅[^run].

## Takeaways
- Import `@std` packages with a caret on the full current version, as `deno add` writes it (`^1.1.6`, `^0.224.14`), not with `^0`. [rule-candidate]
- Never import `@std/internal`, and treat `unstable-*` entrypoints and 0.x packages as able to break without a major version bump. [rule-candidate]
- Check the runtime column before using an `@std` package outside Deno: nine packages are marked compatible with Deno only.

## Verification status
- Verified: 52 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- Commands run on 2026-11-24 with `denoland/deno:alpine-2.9.8` (Deno 2.9.8, V8 15.0.245.2-rusty, TypeScript 6.0.3, Alpine 3.24.2, aarch64) in the lab of `deno/deno-lab-setup.md`; outputs as quoted in Scope, Catalog and Lookup notes: `meta.json` reads for all 43 packages, `deno check` and `deno run` of one import per package, `deno add`, and `deno.lock` contents. [^run]
- [@std on JSR](https://jsr.io/@std) — Deno project on JSR, living. Rank 1. Backs: the 43-package list, descriptions and labels. [^std-scope]
- [@std/path on JSR](https://jsr.io/@std/path) — Deno project on JSR, living. Rank 1. Backs: provenance shown for `@std/path`. [^std-path]
- [JSR API: packages in scope std](https://api.jsr.io/scopes/std/packages?limit=100) — JSR project, living. Rank 1. Backs: total 43, descriptions, runtime compatibility, scores. [^jsr-api]
- [Deno Standard Library (@std)](https://docs.deno.com/runtime/reference/std/) — Deno project, living. Rank 1. Backs: package list, stable/unstable/internal labels, independent versions, runtimes, no third-party dependencies. [^std-docs]
- [denoland/std README](https://github.com/denoland/std) — Deno project, living. Rank 1. Backs: semver for ≥ 1.0.0, the 0.x proposal, `deno.land/std` up to 0.224.0. [^std-readme]
- [Contributing Guide (Deno Standard Library)](https://github.com/denoland/std/blob/main/.github/CONTRIBUTING.md) — Deno project, living. Rank 1. Backs: unstable features, `unstable_` files, `@experimental`, patch releases for unstable changes. [^std-contrib]
- [Frequently Asked Questions (Deno Standard Library)](https://github.com/denoland/std/blob/main/.github/FAQ.md) — Deno project, living. Rank 1. Backs: independent versioning, CI against stable and canary, `^1`/`^0` advice, deprecation removal. [^std-faq]
- [Using packages](https://jsr.io/docs/using-packages) — JSR project, living. Rank 1. Backs: `npx jsr add`, `pnpm add jsr:`, `package.json` and `.npmrc` entries. [^using]
- [npm compatibility](https://jsr.io/docs/npm-compatibility) — JSR project, living. Rank 1. Backs: `@jsr` scope and name mapping, native `jsr:` support in pnpm 10.9+ and Yarn 4.9+. [^npm-compat]
- [Publishing packages](https://jsr.io/docs/publishing-packages) — JSR project, living. Rank 1. Backs: the `npm:@jsr/std__encoding@1` example. [^jsr-publish]
- [Packages](https://jsr.io/docs/packages) — JSR project, living. Rank 1. Backs: the three runtime support levels. [^packages]
- [[spec] document real-world v0 semantics](https://github.com/semver/semver/pull/923) — SemVer project contributors, open pull request. Rank 6. Backs: the 0.x rule the README links to. [^semver-pr]

## Related
- `deno/std-and-jsr/jsr-and-publishing.md` — JSR, version ranges, `exports`, and publishing your own package.
- `deno/testing/testing-and-mocking.md` — `@std/assert`, `@std/expect` and `@std/testing` in tests.
- `deno/modules/dependency-management.md` — `deno add`, `deno outdated`, `deno.lock`.
- `deno/web/websockets-sse-and-routing.md` — serving static files with `@std/http`.
