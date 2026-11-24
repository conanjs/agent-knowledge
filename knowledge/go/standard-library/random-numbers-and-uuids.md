---
schema: knowledge-doc/v1
type: concept
topic: go/standard-library
status: verified
applies-to: ["Go 1.27 (go1.27.4)", "math/rand/v2: Go ≥ 1.22", "(*Rand).N generic method and the uuid package: Go ≥ 1.27", "crypto/rand.Text and Read that cannot fail: Go ≥ 1.24", "math/rand auto-seeding: Go ≥ 1.20; Seed a no-op: Go ≥ 1.24"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [go, golang, math-rand, math-rand-v2, pcg, chacha8, crypto-rand, uuid, uuidv7, godebug, seeding]
ranked-sources: true
---

# Random numbers, secrets and UUIDs

## Summary
**TL;DR:** For simulations, shuffles, retry jitter and test data use `math/rand/v2` (Go 1.22): its top-level functions are randomly seeded at start-up and it has no `Seed` function, so for a stream you can replay you build your own generator, `rand.New(rand.NewPCG(a, b))`. For anything secret — keys, session tokens, passwords — use `crypto/rand`: since Go 1.24 `Read` never returns an error (the program crashes instead) and `Text` returns a ready-made token. For identifiers use the `uuid` package (Go 1.27): `uuid.New` gives a random version 4 UUID (universally unique identifier), `uuid.NewV7` a time-ordered one, and `uuid.Parse` reads four spellings. The old `math/rand` is auto-seeded since Go 1.20 and its `Seed` does nothing since Go 1.24.
**Use this when:** you need a random number, a reproducible random stream for a test, a secure token or key, or a UUID; old code calls `rand.Seed` and its "fixed" sequence changed; you choose between `math/rand`, `math/rand/v2` and `crypto/rand`.
**Not this doc:** how GODEBUG settings (named switches in the `GODEBUG` environment variable that bring back an older behaviour) and the `go` line work in general → `go/introduction/toolchain-and-compatibility.md`; type parameters such as the one in `rand.N` → `go/generics/type-parameters-and-constraints.md`; the `time.Duration` values `rand.N` can return → `go/standard-library/time-and-clocks.md`; random inputs in tests → `go/tooling/testing-benchmarks-and-fuzzing.md`.

## Problem
Before Go 1.20 the global generator of `math/rand` behaved as if `Seed(1)` ran at start-up, so every run printed the same "random" numbers ✅[^3] ✅[^12]. Libraries then seeded it from `init` functions "just to be sure", and one package's correct behaviour could depend on another package happening to be imported ✅[^12]. Worse, `math/rand.Read` and `crypto/rand.Read` share a name: a key read from `math/rand` holds at most the 63 bits of entropy of its seed, which makes it far easier to brute-force ✅[^12]. Today the opposite surprise hits old tests: code that calls `rand.Seed(1)` to get a fixed sequence silently gets different numbers on every run with Go 1.24 or later ✅[^3] ✅[^1].

## Mental model
**Analogy:** a pseudo-random number generator (PRNG) is a huge pre-printed list of numbers made by a recipe; the seed says where on the list to start. Same seed, same numbers — perfect for replaying a failing test, useless for a secret, because anyone who learns the seed can read the list too. `crypto/rand` is a dice cup filled by the operating system: nobody, including you, can replay or predict it. A UUID is a 128-bit serial number in which a few bits say which recipe made it.

**Artifact:** the three tools side by side (Go 1.27.4 ✅[^1]):
```go
import (
	crand "crypto/rand"
	"math/rand/v2"
	"uuid"
)

r := rand.New(rand.NewPCG(1, 2))          // replayable stream
fmt.Println(r.Float32(), r.Float32())     // 0.95955694 0.8076733 — on every run
fmt.Println(rand.IntN(100))               // auto-seeded: 32 on one run, 33 on the next
fmt.Println(len(crand.Text()))            // 26: a secret token, base32
fmt.Println(uuid.NewV7())                 // 01a20e33-2434-7275-be09-288e57c72d67
```

## How it works
**math/rand/v2 (Go 1.22).**
1. It is meant for tasks such as simulation, not security: its output may be easy to predict however it is seeded ✅[^2]. The top-level functions are safe for concurrent use; a `Source` or `Rand` you create must be used by one goroutine at a time ✅[^2].
2. The global generator behind the top-level functions is always randomly seeded, and the package has no top-level `Seed` ✅[^8] ✅[^12]. In the lab `rand.Seed(1)` failed to compile with `undefined: rand.Seed`, and two runs of `IntN(100)` three times printed `32 13 64` and `33 83 30` ✅[^1].
3. A `Source` has one method, `Uint64() uint64` ✅[^2]. The package provides two:
   - `PCG` (permuted congruential generator): 128 bits of state, seeded by `NewPCG(seed1, seed2)`; a zero `PCG` equals `NewPCG(0, 0)`; faster than ChaCha8 but unfit for security ✅[^2].
   - `ChaCha8`: a cryptographically strong generator built on the ChaCha8 cipher, seeded with a `[32]byte`, and resistant to prediction ✅[^2]. It is the algorithm behind the top-level functions ✅[^8].
4. **Reproducible streams.** `rand.New(src)` wraps a source in a `*Rand` with all the helper methods ✅[^2]. In the lab `rand.New(rand.NewPCG(1, 2))` returned `0.95955694 0.8076733 0.8135684` from three `Float32` calls on every run — the same values as the package's own example output ✅[^1] ✅[^2]. Both sources implement `encoding.BinaryMarshaler` and `BinaryUnmarshaler`, so a stream can be saved and resumed ✅[^12]; a `PCG` state was 20 bytes in the lab, and the restored copy produced the next value of the original ✅[^1].
5. **Bounded integers.** `IntN`, `Int32N`, `Int64N`, `UintN`, `Uint32N` and `Uint64N` return a value in `[0, n)`; the signed ones panic if `n <= 0`, the unsigned ones if `n == 0` ✅[^2]. They replace v1's `Intn`, `Int31n` and `Int63n` ✅[^8] ✅[^12]. The lab's `rand.IntN(0)` panicked with `invalid argument to IntN` ✅[^1].
6. **The generic N.** `rand.N[Int intType](n Int) Int` works for any integer type, including `time.Duration`: `rand.N(5 * time.Minute)` is a random duration up to five minutes ✅[^2] ✅[^8]. In the lab its result had type `time.Duration`, and `rand.N[int8](100)` an `int8` ✅[^1].
7. **The generic method (Go 1.27).** Go 1.27 lets a method declare its own type parameters, and `math/rand/v2` added `(*Rand) N[Int intType](Int) Int` with the same behaviour as the top-level `N` ✅[^10] ✅[^2]. The lab's `r.N(int64(1000))` and `r.N(time.Duration(1000))` both compiled and ran ✅[^1].
8. **No Read.** `Read` was not carried into v2; most callers should use `crypto/rand.Read` ✅[^8]. Only `ChaCha8` has a `Read` method (Go 1.23), which always fills the slice ✅[^2].

**math/rand (v1).** Two GODEBUG settings control how its global generator is seeded. Their defaults are the toolchain's, amended to the Go version on the `go` line of `go.mod`, though never to a version older than Go 1.20 ✅[^11].
1. **Go 1.20: automatic seeding.** The global generator is seeded with a random value and the top-level `Seed` is deprecated; programs that need a fixed sequence should use `rand.New(rand.NewSource(seed))` ✅[^7]. `GODEBUG=randautoseed=0` restores the old fixed start ✅[^7] ✅[^11]. In the lab, without any `Seed` call, two runs printed `77 14 32` and `54 73 74`; with `randautoseed=0` both printed `81 87 47` ✅[^1].
2. **Go 1.24: Seed does nothing.** Calls to the top-level `Seed` have no effect; `GODEBUG=randseednop=0` restores them ✅[^3] ✅[^9] ✅[^11]. In the lab, `Seed(1)` followed by three `Intn(100)` calls printed `94 98 72` and then `26 73 43`; with `GODEBUG=randseednop=0` both runs printed `81 87 47`, the same as `rand.New(rand.NewSource(1))` ✅[^1].
3. **The go line decides the default.** The same program in a module whose `go.mod` says `go 1.23` printed `81 87 47` on every run, and `go list -f '{{.DefaultGODEBUG}}' .` listed `randseednop=0` ✅[^1]: the toolchain amends its defaults to the older version ✅[^11].
4. Since Go 1.22, v1's top-level functions also use ChaCha8 when not explicitly seeded ✅[^8]. Its `Read` is deprecated in favour of `crypto/rand.Read`, or `ChaCha8.Read` when a deterministic stream is needed ✅[^3].

**crypto/rand.**
1. It is a cryptographically secure random number generator; `rand.Reader` is a shared instance, safe for concurrent use, that calls the operating system (`getrandom(2)` on Linux, `arc4random_buf(3)` on macOS, `ProcessPrng` on Windows) ✅[^4].
2. **Read (Go 1.24).** `Read(b)` fills `b` entirely and never returns an error; if `Reader` fails, the program crashes irrecoverably ✅[^4] ✅[^9]. The default `Reader`'s system calls are documented never to fail, except on Linux kernels before 3.17, where it opens `/dev/urandom` and may fail ✅[^9]. In the lab, with `rand.Reader` replaced by a reader that always fails, `Read` printed `fatal error: crypto/rand: failed to read random data (see https://go.dev/issue/66821): entropy source down`, the exit status was 2, and neither a deferred call nor `recover` ran ✅[^1].
3. **Text (Go 1.24).** `Text()` returns a random string in the RFC (Request for Comments) 4648 base32 alphabet with at least 128 bits of randomness, for secret strings, tokens and passwords ✅[^4] ✅[^9]. In the lab it was 26 characters long, all in `A–Z` and `2–7` ✅[^1].
4. **Int.** `Int(rand.Reader, max)` returns a uniform `*big.Int` in `[0, max)` and panics if `max <= 0` ✅[^4].

**uuid (Go 1.27).**
1. The new `uuid` package generates and parses UUIDs ✅[^10]. `UUID` is a `[16]byte` as specified by RFC 9562, comparable with `==`, and the random parts of new UUIDs come from a cryptographically secure generator ✅[^5].
2. **Versions.** `NewV4` returns a version 4 UUID with 122 random bits; `New` is the one to use when no algorithm is required, and at present equals `NewV4` ✅[^5]. `NewV7` puts a timestamp in the top 48 bits and at least 62 random bits after it, and its results always sort in increasing order unless the system clock moves backwards ✅[^5]. The 48 bits are the Unix time in milliseconds ✅[^6].
3. **Reading the version.** RFC 9562 keeps the version in the top 4 bits of octet 6 and the variant in the top bits of octet 8 ✅[^6]; the package documents no method that returns them ✅[^5]. In the lab `u[6]>>4` was 4 for `New` and `NewV4`, 7 for `NewV7`, and `u[8]>>6` was binary `10`, the RFC's variant ✅[^1] ✅[^6].
4. **Order.** `Compare` orders UUIDs by their bytes, big-endian, as RFC 9562 §6.11 defines ✅[^5]. Five `NewV7` values made in a row were already sorted by `Compare`, their first 48 bits decoded to a time less than a second old, and within one millisecond the third group, the version digit `7` followed by the next 12 bits, rose (`7275`, `7276`, `7277`, `728d`, `728e`) ✅[^1]; the RFC lets those bits hold a counter or sub-millisecond fraction for extra monotonicity ✅[^6].
5. **Parsing and text.** `Parse` accepts `f81d4fae-7dec-11d0-a765-00a0c91e6bf6`, the same in braces, with a `urn:uuid:` prefix, or as 32 hex digits without dashes, in any letter case; `MustParse` panics on bad input ✅[^5]. `String` writes lowercase hex with dashes, and `MarshalText` and `UnmarshalText` implement the `encoding` package's text interfaces ✅[^5]. In the lab all four forms parsed to the same value, a 35-digit string returned `invalid uuid` with the zero UUID, a struct field encoded to JSON (JavaScript Object Notation) as `{"id":"f81d4fae-7dec-11d0-a765-00a0c91e6bf6"}`, and decoding `"nope"` failed with `invalid uuid` ✅[^1].
6. **Nil and Max.** `Nil()` is `00000000-0000-0000-0000-000000000000` and `Max()` `ffffffff-ffff-ffff-ffff-ffffffffffff`; the Nil UUID is not the Go value `nil` ✅[^5]. The zero value `uuid.UUID{}` equalled `Nil()` in the lab ✅[^1].

## Worked example
A service needs a session token, order identifiers that sort by creation time, a random delay between retries, and a test fixture shuffled the same way on every run (Go 1.27.4 ✅[^1]):

```go
func backoff(attempt int) time.Duration {
	base := 100 * time.Millisecond << attempt // 100ms, 200ms, 400ms
	return base/2 + rand.N(base/2)             // "equal jitter": [base/2, base)
}

session := crand.Text()                                          // secret: crypto/rand only
ids := []uuid.UUID{uuid.NewV7(), uuid.NewV7(), uuid.NewV7()}
fmt.Println(slices.IsSortedFunc(ids, uuid.UUID.Compare))        // true
for a := range 3 { fmt.Println(backoff(a).Round(time.Millisecond)) }
deck := []string{"A", "B", "C", "D", "E"}
r := rand.New(rand.NewPCG(2026, 11))
r.Shuffle(len(deck), func(i, j int) { deck[i], deck[j] = deck[j], deck[i] })
```

| Step | Run 1 | Run 2 | Why |
|---|---|---|---|
| `crand.Text()` | 26 base32 characters | 26 base32 characters | A new secret from the operating system each call ✅[^4]; two other lab runs began `JM5Y…` and `PT3D…` ✅[^1] |
| Three `NewV7` IDs | sorted: `true` | sorted: `true` | V7 sorts by creation time ✅[^5] |
| `backoff(0..2)` | `98ms`, `156ms`, `204ms` | `64ms`, `108ms`, `213ms` | `rand.N` uses the randomly seeded global generator ✅[^8]; each value stayed in `[base/2, base)` ✅[^1] |
| Shuffled fixture | `[A E D C B]` | `[A E D C B]` | A fixed seed produces the same output on every run ✅[^2] |

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Old test calls `rand.Seed(1)` (v1) in a module with `go 1.24` or later | Different numbers on every run ✅[^1] | `Seed` is a no-op since Go 1.24 ✅[^3]; use `rand.New(rand.NewSource(1))` ✅[^7] |
| The same test in a module with `go 1.23` | Fixed numbers again ✅[^1] | GODEBUG defaults follow the `go` line ✅[^11] |
| `rand.Seed` with `math/rand/v2` | Compile error `undefined: rand.Seed` ✅[^1] | The top-level `Seed` was removed ✅[^12] |
| `rand.IntN(0)` or `rand.Uint64N(0)` | Panic (`invalid argument to IntN` in the lab ✅[^1]) | `n` must be positive ✅[^2] |
| One `*rand.Rand` shared by goroutines | Needs a lock or other synchronization | Only the top-level functions are safe for concurrent use ✅[^2] |
| A session token from `math/rand` | Predictable | The package must not be used for security work ✅[^2] ✅[^3] |
| A UUID used as an access token | Unsafe | UUIDs must not be used as security capabilities, and a V7's timestamp reveals creation order ✅[^6]; use `crypto/rand.Text` |
| `NewV7` after the system clock moved backwards | Sorting is no longer guaranteed | Documented exception ✅[^5] |
| `crypto/rand.Reader` replaced and failing | `fatal error`, exit status 2, no `recover` ✅[^1] | `Read` crashes rather than return an error since Go 1.24 ✅[^9] |
| A 2024 source says `Rand` can never have an `N` method | Outdated since Go 1.27 | The math/rand/v2 blog post (Rank 4) said there were no generic methods and that they were unlikely ✅[^12]; the Go 1.27 release notes (Rank 1) added generic methods and `(*Rand).N` ✅[^10], and the lab ran it ✅[^1] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `math/rand/v2` top-level functions | Random every run, safe from many goroutines, ChaCha8 underneath ✅[^2] ✅[^8] | Not replayable; not for secrets ✅[^2] |
| `rand.New(rand.NewPCG(a, b))` | Replayable stream; save and resume its state ✅[^2] ✅[^12] | One goroutine at a time; unfit for security ✅[^2] |
| `rand.New(rand.NewChaCha8(seed))` | Replayable and resistant to prediction ✅[^2] | A PRNG is deterministic from its seed, so a known seed means known output ✅[^12] |
| `crypto/rand` | Unpredictable, for keys and tokens ✅[^4] | No replay; a failing reader crashes the program ✅[^9] |
| `uuid.New` (version 4) | 122 random bits, no timestamp ✅[^5] | Poor database-index locality ✅[^6] |
| `uuid.NewV7` | Sorts by creation time, better index locality ✅[^5] ✅[^6] | Reveals creation order ✅[^6] |

## Takeaways
- Import `crypto/rand` for every key, token, password or nonce (a number used once); never `math/rand`. [rule-candidate]
- In new code import `math/rand/v2`, not `math/rand`. [rule-candidate]
- For a reproducible test, create a seeded generator (`rand.New(rand.NewPCG(seed, 0))`) and log the seed; never rely on a global `Seed`. [rule-candidate]
- Use `uuid.NewV7` for database keys that should sort by creation, `uuid.New` when the ID must reveal nothing; never use either as a secret. [rule-candidate]
- Use `rand.N(d)` for random `time.Duration` jitter instead of converting through `Int64N`.

## Verification status
- Verified: 113 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `go/lab-setup.md` — the Go 1.27.4 lab (`golang:1.27.4`) where every behaviour marked with this note ran on 2026-11-24: v2 auto-seeding and the missing `Seed`, `PCG` and `ChaCha8` streams, `N` and `(*Rand).N`, v1 `Seed` with `randautoseed` and `randseednop` and with a `go 1.23` module, `crypto/rand.Read`, `Text`, `Int` and a failing `Reader`, and the `uuid` package's versions, order, parsing and JSON form. [^1]
- [math/rand/v2 package](https://pkg.go.dev/math/rand/v2) — Go team, living. Rank 1. Backs: not for security, concurrency rules, `Source`, `PCG`, `ChaCha8`, `New`, the bounded functions and their panics, `N`, `(*Rand).N`, `ChaCha8.Read`, the `PCG(1, 2)` example output. [^2]
- [math/rand package](https://pkg.go.dev/math/rand) — Go team, living. Rank 1. Backs: not for security; `Seed` before Go 1.20, deprecated, and a no-op since Go 1.24; `Read` deprecated. [^3]
- [crypto/rand package](https://pkg.go.dev/crypto/rand) — Go team, living. Rank 1. Backs: `Reader` and its system calls, `Read` never errors and crashes on failure, `Text`, `Int`. [^4]
- [uuid package](https://pkg.go.dev/uuid) — Go team, living. Rank 1. Backs: `UUID` type, `New`, `NewV4`, `NewV7`, `Parse` forms, `MustParse`, `String`, text marshaling, `Compare`, `Nil`, `Max`, the method list. [^5]
- [RFC 9562: Universally Unique IDentifiers (UUIDs)](https://www.rfc-editor.org/rfc/rfc9562) — IETF (Internet Engineering Task Force), 2024. Rank 1. Backs: version and variant bit positions, the version 7 layout and its optional counter, database-index locality, not a security capability, timestamps reveal order. [^6]
- [Go 1.20 Release Notes](https://go.dev/doc/go1.20) — Go team, 2023. Rank 1. Backs: `math/rand` auto-seeding, `Seed` deprecated, `rand.New(rand.NewSource(seed))`, `randautoseed=0`. [^7]
- [Go 1.22 Release Notes](https://go.dev/doc/go1.22) — Go team, 2024. Rank 1. Backs: new `math/rand/v2`, unconditional seeding, no `Read`, renamed functions, `N`, `ChaCha8` and `PCG`, ChaCha8 in v1 and the runtime. [^8]
- [Go 1.24 Release Notes](https://go.dev/doc/go1.24) — Go team, 2025. Rank 1. Backs: `crypto/rand.Read` cannot fail and crashes, the legacy-Linux exception, `Text`; `math/rand.Seed` a no-op and `randseednop=0`. [^9]
- [Go 1.27 Release Notes](https://go.dev/doc/go1.27) — Go team, 2026. Rank 1. Backs: generic methods and `(*Rand).N`; the new `uuid` package. [^10]
- [Go, Backwards Compatibility, and GODEBUG](https://go.dev/doc/godebug) — Go team, living. Rank 1. Backs: defaults amended to the `go` line; `randautoseed` (Go 1.20) and `randseednop` (Go 1.24). [^11]
- [Evolving the Go Standard Library with math/rand/v2](https://go.dev/blog/randv2) — Russ Cox, Go team, 2024. Rank 4. Backs: the seeding history and its problems, 63-bit entropy of v1 keys, removed `Seed`, binary marshaling of sources, the then-current view that `Rand` could not have an `N` method, the PRNG definition. [^12]

## Related
- `go/introduction/toolchain-and-compatibility.md` — the `go` line, `godebug` lines and `//go:debug`, which set the v1 seeding defaults.
- `go/standard-library/time-and-clocks.md` — `time.Duration`, the type `rand.N` returns for jitter.
- `go/generics/generic-types-methods-and-inference.md` — Go 1.27 generic methods, which `(*Rand).N` uses.
- `go/concurrency/memory-model-and-data-races.md` — why a shared `*rand.Rand` needs a lock.
- `go/standard-library/io-and-encoding-json.md` — how text-marshaling types such as `UUID` appear in JSON.
- `go/learning-path.md`
