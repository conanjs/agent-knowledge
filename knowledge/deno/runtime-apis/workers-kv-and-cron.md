---
schema: knowledge-doc/v1
type: concept
topic: deno/runtime-apis
status: verified
applies-to: ["Deno 2.9.8", "local Deno KV backed by SQLite; the hosted KV service is out of scope"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [deno, web-workers, postmessage, transfer, deno-kv, openkv, versionstamp, atomic, kvu64, watch, queues, enqueue, listenqueue, deno-cron, unstable]
ranked-sources: true
---

# Web Workers, local Deno KV and Deno.cron

## Summary
**TL;DR:** Deno runs code in parallel with **Web Workers**, which must be module workers (`{ type: "module" }`) and talk to the main thread only by messages. **Deno KV** is a key-value database built into the runtime; locally `Deno.openKv(path)` stores it in one SQLite file, and it needs `--unstable-kv` in 2.9.8. Keys are arrays sorted by type then value, every write gets a **versionstamp**, and `atomic().check(...)` commits only if nothing changed since you read. KV also gives `watch` streams and a message queue (`enqueue` / `listenQueue`). **`Deno.cron`** (needs `--unstable-cron`) runs a handler on a five-field schedule in UTC (Coordinated Universal Time) inside the running process.
**Use this when:** moving central processing unit (CPU) heavy work off the main thread, keeping small persistent state without an external database, coordinating writes with optimistic locking, processing background jobs, or scheduling a recurring task in a long-running Deno process.
**Not this doc:** what a worker may access and how grants narrow → `deno/security/permission-model.md`; every `--unstable-*` flag and the end of hosted services such as Deno Deploy → `deno/releases-stability-and-support.md`; files, subprocesses and signals → `deno/runtime-apis/files-processes-and-environment.md`.

## Problem
A worker started the browser way, `new Worker("./w.js")`, fails at once in Deno. Code that reads a KV value, computes, then writes it back loses updates when two writers run at the same time. Scripts that call `Deno.openKv` or `Deno.cron` crash with `is not a function` because the unstable flag is missing. A queue listener or a cron job keeps the process alive, so a script "hangs" after its work is done. Each of these has a fixed rule, measured below.

## Mental model
**Analogy:** a worker is a colleague in another room: you pass notes under the door (`postMessage`), and handing over a box (a transfer) means you no longer have it. Deno KV is a filing cabinet whose drawers are always sorted by label, and every folder carries a stamp that changes on each edit. An atomic operation says "file this only if the stamp is still the one I saw". The queue is an outbox tray that a clerk (`listenQueue`) empties, retrying failed deliveries. `watch` is a bell on chosen drawers. `Deno.cron` is an alarm clock that rings only while the office (the process) is open.

| Term | Plain-English analogy | Concrete artifact |
|---|---|---|
| Module worker | A colleague in another room | `new Worker(new URL("./worker.ts", import.meta.url).href, { type: "module" })` |
| Transfer | Handing over the box itself, not a copy | `worker.postMessage({ buf }, [buf])` → `buf.byteLength` is `0` afterwards |
| KV key | A folder label with several parts, most significant first | `["users", "alice"]` |
| Versionstamp | The edit stamp on a folder | `"00000000000000090000"` |
| Atomic check | "Only if the stamp is unchanged" | `kv.atomic().check(entry).set(k, v).commit()` → `{ ok: false }` on a stale stamp |
| `Deno.KvU64` | A counter wheel that only holds whole numbers 0 … 2^64−1 | `kv.atomic().sum(["visits"], 1n)` |
| Queue | An outbox tray with a clerk | `kv.enqueue(msg)`, `kv.listenQueue(handler)` |
| Cron schedule | An alarm setting in UTC | `"* * * * *"` = every minute |

**Artifact:** an optimistic-locking miss, measured ✅[^run]:
```ts
const a = await kv.get(["acct", "a"]);          // read, remember its versionstamp
await kv.set(["acct", "a"], 90);                // another writer changes it
await kv.atomic().check(a).set(["acct", "a"], a.value - 10).commit();
// → {"ok":false}   nothing was written
```

## How it works
### Web Workers
**3 actors:**
- **Main thread** — its job: create the worker and exchange messages, via `new Worker(...)` and `postMessage`.
- **Worker thread** — its job: run its own module and reply, via `self.onmessage` and `self.postMessage`.
- **Deno runtime** — its job: load the worker's module and enforce its permissions, via the module loader and the worker's permission set.

```
[main thread]                     [Deno runtime]                       [worker thread]
new Worker(url, {type:"module"})
  └────────────▶ read access to the worker file? ─ no → worker error, main exits 1
                 permissions: inherit (default) or narrowed (--unstable-worker-options)
                   └──────────────── ═══ thread boundary ═══ ────────────▶ runs worker.ts
postMessage({cmd, buf}, [buf]) ──── structured clone; buf moved, not copied ──▶ onmessage
onmessage ◀────────────────────────────────────────────────────────── postMessage(reply)
```

1. **Main thread:** constructs the worker. Only module workers exist: without `type`, or with `type: "classic"`, the constructor throws `NotSupportedError: Classic workers are not supported.` ✅[^webapis] ✅[^run].
2. **Runtime:** loads the worker module, which needs `--allow-read` for a local file ✅[^webapis]. Without it the run printed `error: Uncaught (in worker "") Requires read access to "/lab/w/worker.ts", run again with the --allow-read flag` and exited with code 1 ✅[^run].
3. **Runtime, permissions:** by default the worker inherits the creating thread's permissions ✅[^webapis] ✅[^workeropts]. Narrowing them through `deno: { permissions: … }` needs `--unstable-worker-options` ✅[^unstable]; without the flag the run stopped with ``Unstable API 'Worker.deno.permissions'. The `--unstable-worker-options` flag must be provided.`` and exit code 70 ✅[^run]. The rules for what each value grants live in `deno/security/permission-model.md`.
4. **Main → worker:** `postMessage(data, [transferables])` sends a structured clone; a transferred `ArrayBuffer` is no longer usable by the sender ✅[^mdn-post]. Measured: the sender's `byteLength` went from 4 to `0`, and the worker replied `{"total":10,"gotBytes":4,"hasDeno":true,"main":true}`: the `Deno` namespace exists inside the worker, and `import.meta.main` is `true` in the worker's entry module ✅[^run].
5. **Shutdown:** `worker.terminate()` from outside, or `self.close()` inside ✅[^webworkers-ex]. `Deno.exit()` inside a worker closes only that worker ✅[^runtime]; the main thread printed `main still alive after worker Deno.exit` ✅[^run].

### Deno KV
**3 actors:**
- **Your code** — its job: read and write entries, via the `Deno.Kv` object from `Deno.openKv`.
- **The KV layer in the runtime** — its job: encode keys, assign versionstamps, check atomic conditions and deliver queue messages, via the `--unstable-kv` API (application programming interface).
- **SQLite** — its job: store everything on disk, via one database file.

```
[your code]                    [KV layer, runtime]                         [SQLite file]
kv.atomic().check(e).sum(k,1n).commit()
  └─────────────▶ compare e.versionstamp with stored one
                    ├─ differs → {ok:false}, nothing written
                    └─ same → apply all mutations, new versionstamp ──▶ one transaction
  ◀── {ok:true, versionstamp}   ── wake watch() streams, queue listeners
```

1. **Opening.** Without `--unstable-kv`, `typeof Deno.openKv` is `"undefined"` and calling it fails with `TypeError: Deno.openKv is not a function` plus the hint ``Run again with `--unstable-kv` flag to enable this API.`` ✅[^openkv] ✅[^run]. With the flag, `openKv(path)` opens a SQLite file (the file starts with `SQLite format 3`), `":memory:"` opens a throwaway database, and no argument opens a default file for the script ✅[^openkv] ✅[^kv-quick] ✅[^run]. In the lab the default was `/deno-dir/location_data/<hash>/kv.sqlite3` under `DENO_DIR` ✅[^run]. A path needs `--allow-read` and `--allow-write` for it ✅[^openkv]; without them the run threw `NotCapable: Requires read access to "./data.sqlite3"` ✅[^run]. An `https://` URL connects to a remote database, such as one hosted on Deno Deploy ✅[^openkv]; that service ends with Deno Deploy, see `deno/releases-stability-and-support.md`.
2. **Keys.** A key is an array of parts: `string`, `number`, `boolean`, `Uint8Array` or `bigint`; the first part is the most significant, and values must be structured-clonable ✅[^keyspace]. Parts sort by type first, then by value. Measured order across types ✅[^run]:
   ```
   u8[1] < u8[2] < "B" < "a" < "b" < 0n < 2n < -1 < 1.5 < Infinity < NaN < false < true
   ```
   Strings sort by their UTF-8 (Unicode Transformation Format, 8-bit) bytes, so `"B"` comes before `"a"` ✅[^keyspace] ✅[^run].
3. **Versionstamps.** Each write gets a new versionstamp that only grows and is not sequential; all writes in one atomic operation share one ✅[^keyspace]. Measured: the first `set` in a fresh file returned `{"ok":true,"versionstamp":"00000000000000090000"}`; in ten re-runs against fresh files and `:memory:` databases the first stamp ranged from `…00010000` to `…00090000`, so it cannot be predicted. `x` and `y` set in one atomic call had equal stamps ✅[^run].
4. **Operations** ✅[^kvapi] ✅[^ops], measured ✅[^run]:

   | Call | Measured result |
   |---|---|
   | `kv.get(["users","alice"])` | `{"key":["users","alice"],"value":{"name":"Alice","age":30},"versionstamp":"00000000000000090000"}` |
   | `kv.get` of a missing key | `{"key":["users","nobody"],"value":null,"versionstamp":null}` |
   | `kv.list({ prefix: ["orders"] }, { reverse: true, limit: 2 })` | keys `4`, `3` |
   | `kv.list({ start: ["orders","2"], end: ["orders","4"] })` | `2`, `3` (start inclusive, end exclusive) |
   | `kv.getMany([k1, missing])` | entries in input order; the missing one has `null` value and versionstamp |
   | `kv.delete` of a missing key | no error |
   | `kv.set(["bad"], () => 1)` | `TypeError: ()=>1 could not be cloned.` |
   | `kv.set(k, "x".repeat(70000))` | `TypeError: Value too large (max 65536 bytes)` |
5. **Atomic operations.** `kv.atomic()` collects checks and mutations and does nothing until `commit()` ✅[^kvapi]. A failed check returns `{ ok: false }` and writes nothing; other failures throw ✅[^atomic]. A check with `versionstamp: null` means "the key must not exist" ✅[^atomic]; measured, the first create-if-absent returned `true`, the second `false` ✅[^run]. The usual pattern is a retry loop that re-reads on `ok: false` ✅[^tx].
   - `sum`, `min` and `max` work only on `Deno.KvU64` values; `sum` wraps around ✅[^atomic] ✅[^kvu64]. Measured: `sum 5n + 3n` → `8n`; `max(7n, 4n)` → `7n`; `min(7n, 4n)` → `4n`; `(2^64−1) + 2` → `1n`; `sum` on a plain number → `TypeError: Failed to perform 'sum' mutation on a non-U64 value in the database`; `new Deno.KvU64(-1n)` → `RangeError: Value must be a positive bigint: received -1` ✅[^run].
   - Limits per atomic operation: 100 checks, 1000 mutations, 800 KiB (kibibytes, 1 KiB = 1024 bytes) in total; keys up to 2 KiB, values up to 64 KiB; `getMany` and `watch` take at most 10 keys ✅[^tx].
6. **Watch.** `kv.watch(keys)` returns a `ReadableStream` that emits the current entries of all watched keys whenever one of them changes, and may skip intermediate states ✅[^kvapi] ✅[^ops]. Measured ✅[^run]:
   ```
   initial ->            [["theme",null,null],["lang",null,null]]
   after set theme ->    [["theme","dark","vs"],["lang",null,null]]
   after set lang ->     [["theme","dark","vs"],["lang","en","vs"]]   (a write to an unwatched key emitted nothing)
   after delete theme -> [["theme",null,null],["lang","en","vs"]]
   ```
   Five quick writes `0 … 4` to one key produced two emissions, `[0,4]`; eleven keys → `TypeError: Too many keys (max 10)`.
7. **Queues.** `kv.enqueue(value, { delay, keysIfUndelivered, backoffSchedule })` stores a message; `kv.listenQueue(handler)` runs the handler per message and retries a failed one ✅[^kvapi]. Delivery is at least once, so handlers must tolerate duplicates ✅[^queues-blog]; an `enqueue` inside an atomic operation happens only if the commit succeeds ✅[^atomic] ✅[^queues-blog]. Measured ✅[^run]:
   - an immediate message arrived at about 100 ms; `delay: 2000` arrived at about 2100 ms;
   - a handler that always throws, with `backoffSchedule: [200, 200]`, ran 3 times (about 100, 400, 700 ms, each logged as `Exception in queue handler Error: …`), then the message was written to its `keysIfUndelivered` key: `{"kind":"fail"}`;
   - `atomic().check(stale).enqueue(...)` → `{"ok":false}`, and the message never arrived;
   - two `listenQueue` calls are both accepted, and six messages were split between them (`A:0 B:1 A:2 B:3 B:4 A:5`);
   - an open listener keeps the process alive; `kv.close()` ends it and resolves the `listenQueue` promise.

### `Deno.cron`
`Deno.cron(name, schedule, [options], handler)` registers a job that runs for the lifetime of the process; the schedule is a five-field string (minute, hour, day of month, month, day of week) or an object such as `{ minute: { every: 15 } }`, always in UTC ✅[^cron] ✅[^cron-guide]. Locally the state is kept in memory, so each process runs its own jobs ✅[^cron-guide]. There are no retries unless `backoffSchedule` is set, and aborting the `signal` option unregisters the job ✅[^cron] ✅[^cron-guide]. Measured ✅[^run]:

| Call | Result |
|---|---|
| any `Deno.cron` call without `--unstable-cron` | `TypeError: Deno.cron is not a function`, hint ``Run again with `--unstable-cron` flag to enable this API.``, exit 1 |
| `"every minute"` or six fields `"0 * * * * *"` | throws at once: `TypeError: Invalid cron schedule` |
| a second job named `"obj"` | `TypeError: Cron with this name already exists` |
| `backoffSchedule` with 6 entries | `TypeError: Invalid backoff schedule` (the documented limit is 5 retries ✅[^cron]) |
| `"* * * * *"` registered at `08:46:36.036Z` | handler ran at `08:47:00.006Z`; the returned promise resolved only after the job was aborted, then the process exited 0 |

`--unstable-kv` was not needed for `Deno.cron` in the local run ✅[^run].

## Worked example
A job processor: three jobs go through the queue, each handler commits its result and bumps a counter in one atomic operation guarded so a duplicate delivery cannot count twice, and a `watch` reports progress.
```ts
// deno run --unstable-kv --allow-read=. --allow-write=. jobs.ts
await using kv = await Deno.openKv("./jobs.sqlite3");
const allDone = Promise.withResolvers<void>();
const watcher = kv.watch<Deno.KvU64>([["stats", "done"]]).getReader();
(async () => { while (true) { const { value, done } = await watcher.read(); if (done) break;
  const n = value[0].value?.value ?? 0n; console.log(`watch: done=${n}`); if (n === 3n) allDone.resolve(); } })();
kv.listenQueue(async (job: { id: string; words: string }) => {
  const count = job.words.split(" ").length;
  const res = await kv.atomic()
    .check({ key: ["results", job.id], versionstamp: null })   // once per job
    .set(["results", job.id], { count })
    .sum(["stats", "done"], 1n)
    .commit();
  console.log(`job ${job.id}: ${count} words, commit ok=${res.ok}`);
});
for (const [id, words] of [["a", "one two"], ["b", "three four five"], ["c", "six"]]) await kv.enqueue({ id, words });
await allDone.promise;
for await (const e of kv.list({ prefix: ["results"] })) console.log("result", JSON.stringify(e.key), JSON.stringify(e.value));
await watcher.cancel();
```
Measured output, exit code 0, leaving one file `jobs.sqlite3` ✅[^run]:
```
watch: done=0
job a: 2 words, commit ok=true
watch: done=1
job b: 3 words, commit ok=true
watch: done=2
job c: 1 words, commit ok=true
watch: done=3
result ["results","a"] {"count":2}
result ["results","b"] {"count":3}
result ["results","c"] {"count":1}
```
`await using` closed the database at the end, which also ended the queue listener. A second run against the same file printed `watch: done=3` first: the data persisted ✅[^run].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Key order of `bigint` versus `number` | Run: every `bigint` sorts before every `number` (`0n < 2n < -1`). The key-space page's type list puts `number` first, but its own example says `1.0` is greater than `0n` | The run and the page's example agree; do not rely on the list ✅[^run] ✅[^keyspace] |
| Versionstamp size | Run: 20 hex characters (10 bytes); the key-space page says 12-byte values | Treat versionstamps as opaque strings ✅[^run] ✅[^keyspace] |
| `Deno.openKv("/tmp/newdir/db.sqlite3")` with `newdir` missing | Run: `Error: unable to open database file`; the `openKv` page says missing parent directories are created | Create the directory first with `Deno.mkdir(dir, { recursive: true })` ✅[^run] ✅[^openkv] |
| `Deno.openKv()` with no path and no flags | Opens, without `--allow-read` or `--allow-write` | The file lives under `DENO_DIR`, not in your project ✅[^run] |
| `set(k, v, { expireIn: 100 })` | The value was still returned 1.5 s later | Expired keys may stay visible for some time ✅[^atomic] ✅[^run] |
| Script with `listenQueue` or `Deno.cron` "never ends" | The listener or job keeps the event loop alive | Close the KV (`kv.close()`, `using`) or abort the cron signal ✅[^cron] ✅[^run] |
| `await Deno.cron(...)` at the top level | Waits until the job is unregistered, so later code never runs | Do not await it; the promise surfaces registration errors ✅[^cron] ✅[^run] |
| Worker asks for more than its parent (`{ net: true }` without `--allow-net`) | `NotCapable: Can't escalate parent thread permissions` | A worker cannot exceed its parent ✅[^workeropts] ✅[^run] |
| Several `listenQueue` handlers | Each message goes to one of them | Do not use two listeners as a broadcast ✅[^run] |
| Queue handler runs twice | Possible | At-least-once delivery; guard with an atomic check ✅[^queues-blog] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Local KV file | Persistence and atomic writes with no server | Unstable API; one process's SQLite file, no network sharing |
| `":memory:"` KV | Fast, isolated tests | Gone when the process exits |
| Worker with inherited permissions | No unstable flag | The worker can do everything the main thread can |
| Worker with `deno.permissions` | Least privilege per worker | Needs `--unstable-worker-options` |
| `Deno.cron` locally | Schedules inside the app, no system crontab | Runs only while the process runs; each process has its own jobs |

## Takeaways
- Create workers with `new Worker(new URL("./w.ts", import.meta.url).href, { type: "module" })`; there are no classic workers. [rule-candidate]
- Update shared KV state only through `atomic().check(...)` with a retry on `ok: false`. [rule-candidate]
- Make queue handlers idempotent: guard the side effect with a `versionstamp: null` check on a per-message key. [rule-candidate]
- Never `await` the promise from `Deno.cron`; register jobs at the top level and abort their signal to stop them. [rule-candidate]
- Treat versionstamps as opaque strings, and do not depend on the order between `bigint` and `number` key parts.
- Pass `--unstable-kv` / `--unstable-cron` (or the `unstable` array in `deno.json`) explicitly, and close KV handles so the process can exit.

## Verification status
- Verified: 76 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- Commands run on 2026-11-24 with `denoland/deno:alpine-2.9.8` (Deno 2.9.8, V8 15.0.245.2-rusty, TypeScript 6.0.3, Alpine 3.24.2, aarch64) in the lab of `deno/deno-lab-setup.md`; outputs as quoted in Mental model, How it works, Worked example and Edge cases. [^run]
- [Web platform APIs: Web Workers](https://docs.deno.com/runtime/reference/web_platform_apis/) — Deno project, living. Rank 1. Backs: module workers only, inherited permissions by default, `--allow-read` for local worker modules. [^webapis]
- [WorkerOptions](https://docs.deno.com/api/web/~/WorkerOptions) — Deno project, living. Rank 1. Backs: `deno.permissions` values, no escalation beyond the parent. [^workeropts]
- [Unstable feature flags](https://docs.deno.com/runtime/reference/cli/unstable_flags/) — Deno project, living. Rank 1. Backs: `--unstable-worker-options`, `--unstable-kv`, `--unstable-cron`, the `unstable` array. [^unstable]
- [Web workers example](https://docs.deno.com/examples/web_workers/) — Deno project, living. Rank 1. Backs: `self.close()`, narrowed worker permissions. [^webworkers-ex]
- [Deno APIs: Runtime](https://docs.deno.com/api/deno/runtime) — Deno project, living. Rank 1. Backs: `Deno.exit` in a worker closes the worker. [^runtime]
- [Deno.openKv](https://docs.deno.com/api/deno/~/Deno.openKv) — Deno project, living. Rank 1. Backs: path, `:memory:`, default path, remote URLs, permissions, `--unstable-kv`, parent-directory claim. [^openkv]
- [Deno KV Quick Start](https://docs.deno.com/deploy/kv/) — Deno project, living. Rank 1. Backs: SQLite backing for local development. [^kv-quick]
- [Key space](https://docs.deno.com/deploy/kv/key_space/) — Deno project, living. Rank 1. Backs: key part types and ordering, versionstamps, value types. [^keyspace]
- [Operations](https://docs.deno.com/deploy/kv/operations/) — Deno project, living. Rank 1. Backs: `list` selectors, `watch` emits on change and skips states. [^ops]
- [Transactions](https://docs.deno.com/deploy/kv/transactions/) — Deno project, living. Rank 1. Backs: retry loop, limits. [^tx]
- [Deno.Kv](https://docs.deno.com/api/deno/~/Deno.Kv) — Deno project, living. Rank 1. Backs: method list, `atomic()` does nothing until commit, `enqueue` options, `listenQueue` retries, `watch`. [^kvapi]
- [Deno.AtomicOperation](https://docs.deno.com/api/deno/~/Deno.AtomicOperation) — Deno project, living. Rank 1. Backs: `check` with `null`, `commit` results, `sum`/`min`/`max`, atomic `enqueue`, `expireIn` visibility. [^atomic]
- [Deno.KvU64](https://docs.deno.com/api/deno/~/Deno.KvU64) — Deno project, living. Rank 1. Backs: unsigned 64-bit values required by `sum`/`min`/`max`. [^kvu64]
- [Announcing Deno Queues](https://deno.com/blog/queues) — Deno project, 2023. Rank 1. Backs: at-least-once delivery, enqueue inside transactions. [^queues-blog]
- [Deno.cron](https://docs.deno.com/api/deno/~/Deno.cron) — Deno project, living. Rank 1. Backs: signatures, UTC, `backoffSchedule` limit, `signal`, `--unstable-cron`, do not await. [^cron]
- [Cron](https://docs.deno.com/runtime/fundamentals/cron/) — Deno project, living. Rank 1. Backs: five-field syntax, object schedules, in-memory state per process, no default retries. [^cron-guide]
- [Worker: postMessage() method](https://developer.mozilla.org/en-US/docs/Web/API/Worker/postMessage) — MDN Web Docs, living. Rank 3. Backs: transferred objects are unusable by the sender. [^mdn-post]

## Related
- `deno/security/permission-model.md` — how worker permissions are inherited and narrowed.
- `deno/releases-stability-and-support.md` — the unstable flags, and the end of Deno Deploy and its hosted KV.
- `deno/runtime-apis/files-processes-and-environment.md` — files, subprocesses, signals and `Deno.errors`.
- `deno/testing/testing-and-mocking.md` — `Deno.test` and its sanitizers, for testing code like the examples here.
- `deno/deno-lab-setup.md` — the lab where every output above was measured.
