---
schema: knowledge-doc/v1
type: concept
topic: deno/runtime-apis
status: verified
applies-to: ["Deno 2.9.8", "Linux (measured on Alpine 3.24.2); signal and file-watching details vary by operating system"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [deno, file-system, fsfile, using, subprocess, deno-command, env, args, exit, signals, errors, import-meta, stdin, stdout]
ranked-sources: true
---

# Files, processes and the environment in the Deno namespace

## Summary
**TL;DR:** The global `Deno` object is how a script reaches the machine: files (`Deno.readTextFile`, `Deno.open` returning a `Deno.FsFile`), child processes (`Deno.Command`), environment variables and arguments (`Deno.env`, `Deno.args`), exit and lifecycle events, operating-system (OS) signals, and the standard streams. Every call passes two gates in order: Deno's own permission check, which throws `Deno.errors.NotCapable`, then the operating system, whose refusals arrive as other `Deno.errors` classes (`NotFound`, `AlreadyExists`, `PermissionDenied` …). Declare file and child-process handles with `using` / `await using` so they close at the end of the block.
**Use this when:** writing a command-line tool or script in Deno, choosing which error class to catch, piping data through a subprocess, or making a script shut down cleanly.
**Not this doc:** which permission flag grants what → `deno/security/permission-model.md` and `deno/security/permission-flags.md`; Web Workers, Deno KV and `Deno.cron` → `deno/runtime-apis/workers-kv-and-cron.md`; how `import.meta.resolve` fits module resolution → `deno/modules/module-specifiers-and-imports.md`; `fetch`, `URL` and other web-standard globals → `deno/fundamentals/web-platform-apis.md`.

## Problem
Code ported from Node.js or shell scripts trips over five things: a missing permission and a missing file look alike until you check the error class; a file opened with `const` stays open when an exception skips `close()`; `Deno.Command(...).output()` refuses piped stdin; a child whose stdin is never closed hangs forever; and `Deno.exit()` skips the `beforeunload` cleanup that a normal exit runs. Each has a fixed rule, measured below.

## Mental model
**Analogy:** the `Deno` namespace is a hotel front desk. Your script is a guest who can only act through the desk: ask for a room key (a file handle), call a taxi (a child process), read the notice board (environment variables). The desk first checks the guest's pass (permission flags) and says "not on your pass" (`NotCapable`). Only then does it ask the building (the operating system), which may say "no such room" (`NotFound`) or "locked by the owner" (`PermissionDenied`). A key you borrow must be handed back; `using` hands it back automatically when you leave the block.

| Term | Plain-English analogy | Concrete artifact |
|---|---|---|
| Resource handle (`Deno.FsFile`) | A borrowed room key | `const f = await Deno.open("a.txt")` |
| `using` / `await using` (explicit resource management) | A key on a spring that snaps back when you leave the room | `{ using f = await Deno.open("a.txt"); }` closes `f` at `}` |
| `Deno.Command` | A taxi order form you can reuse; each `spawn()` sends a new taxi | `new Deno.Command("sort", { stdin: "piped" }).spawn()` |
| Signal | A knock on the door from the operating system | `Deno.addSignalListener("SIGTERM", onTerm)` |
| `Deno.errors.*` | The reason code on a refusal slip | `e instanceof Deno.errors.NotFound` |
| `import.meta` | The module's own name tag | `import.meta.dirname` → `/lab` |

**Artifact:** the two gates, measured as the non-root `deno` user ✅[^run]:
```console
$ deno run --allow-read=/etc perm.ts
/etc/shadow -> PermissionDenied | Permission denied (os error 13): readfile '/etc/shadow'
/lab/fs.ts -> NotCapable | Requires read access to "/lab/fs.ts", run again with the --allow-read flag
```

## How it works
**3 actors:**
- **Your script** — its job: ask for an action, via a `Deno.*` call or a `using` declaration.
- **The Deno runtime** — its job: check the permission, via the flags given to `deno run`, then perform the action, via a system call.
- **The operating system** — its job: carry out or refuse the system call, via its own file modes, process table and signals.

```
[script]                     [Deno runtime]                         [operating system]
Deno.readTextFile(p)
  └──────────────▶ permission check (--allow-read?)
                     ├─ not granted → throw Deno.errors.NotCapable
                     └─ granted
                          │  ═══════ process / kernel boundary ═══════
                          └──────────────────────────────────▶ open(p), read()
                     ◀─────────── result or OS error number ───┘
                     maps os error 2 → NotFound, 13 → PermissionDenied …
  ◀── string, or a Deno.errors.* instance
```

1. **Script:** calls an API (application programming interface), for example `Deno.readTextFile("/etc/shadow")`. Nothing has reached the operating system yet.
2. **Runtime, permission gate:** compares the path, command or variable name with the granted flags. A miss throws `Deno.errors.NotCapable` with a hint naming the flag ✅[^run] ✅[^errors]. The rules of the gate are in `deno/security/permission-model.md`.
3. **Runtime → operating system:** only now does a system call cross into the kernel.
4. **Runtime, error mapping:** an OS refusal comes back as an error number, and the runtime throws the matching class with the number in the message, for example `No such file or directory (os error 2): readfile '…'` ✅[^run]. `PermissionDenied` therefore means the OS refused the user running Deno; before Deno 2.0 that class also covered missing flags ✅[^errors].

### Files and `Deno.FsFile`
- **Whole-file calls** read or write in one step: `readTextFile` / `writeTextFile` (UTF-8 strings; UTF-8 = Unicode Transformation Format, 8-bit), `readFile` / `writeFile` (bytes) ✅[^fs]. `writeTextFile` creates or overwrites by default; options change that ✅[^fs] ✅[^run]:

  | Option | Effect (measured) |
  |---|---|
  | `{ append: true }` | Adds to the end: `"one\n"` then `"two\n"` reads back as `"one\ntwo\n"` |
  | `{ createNew: true }` on an existing file | `AlreadyExists: File exists (os error 17)` |
  | `{ create: false }` on a missing file | `NotFound` (this form also needs `--allow-read` ✅[^wtf]) |
  | `{ mode: 0o600 }` | New file has mode `600` |

  The whole-file write closes the file, but the data may still sit in OS buffers; for durability open the file and call `sync()` before closing ✅[^wtf].
- **Handles.** `Deno.open(path, options)` returns a `Deno.FsFile`. `read` defaults to `true`; `write`, `append`, `truncate`, `create` and `createNew` default to `false` ✅[^fs]. Writing without `truncate` overwrites in place: `"HE"` written over `"hello using"` gives `"HEllo using"` ✅[^run].
- **Disposal.** `Deno.FsFile` implements `Symbol.dispose`, so `using file = await Deno.open(p)` closes it when the block ends ✅[^fsfile]. Measured: a read on the escaped handle after the block throws `BadResource: Bad resource ID`; `Symbol.dispose in file` is `true`, `Symbol.asyncDispose in file` is `false`, and `await using` still works because it falls back to `Symbol.dispose` ✅[^run] ✅[^mdn-using]. `Deno.resources` is not available in 2.9.8 (`typeof Deno.resources` → `"undefined"`), so a `BadResource` error is how a closed handle shows ✅[^run].
- **Streams take ownership.** `file.readable` and `file.writable` close the file when the stream finishes, is cancelled or aborted ✅[^fsfile]. After `src.readable.pipeTo(dst.writable)`, calling `src.close()` or `dst.close()` throws `BadResource` ✅[^run].
- **Directories and metadata** ✅[^fs] ✅[^run]:

  | Call | Measured result |
  |---|---|
  | `Deno.stat(p)` | `{ isFile: true, isDirectory: false, isSymlink: false, size: 8, mtime: Date … }` |
  | `Deno.readDir(dir)` | Async iterator of `{ name, isFile, isDirectory, isSymlink }`, no guaranteed order |
  | `Deno.mkdir(dir)` on an existing directory | `AlreadyExists`; with `{ recursive: true }` it succeeds silently |
  | `Deno.mkdir("a/b")` when `a` is missing | `NotFound`; `{ recursive: true }` creates both |
  | `Deno.remove(dir)` on a non-empty directory | Plain `Error: Directory not empty (os error 39)`; `{ recursive: true }` removes the tree |
  | `Deno.makeTempDir({ prefix: "lab-" })` | `/tmp/lab-ef7fd671aa0552e2` |
- **Watching.** `Deno.watchFs(paths)` returns an async iterator of `{ kind, paths }`; `recursive` defaults to `true`, the paths must already exist, and event order varies by OS ✅[^watch]. On Linux, create → write → rename → remove produced `create`, `modify`, `access`, …, `rename a.txt,b.txt`, `remove b.txt`; watching a missing path throws `NotFound: No path was found.` ✅[^run].

### Subprocesses with `Deno.Command`
`new Deno.Command(cmd, options)` is a reusable description; each `output()` or `spawn()` starts a new process and needs `--allow-run` ✅[^cmd].

| Step | `output()` | `spawn()` |
|---|---|---|
| Default stdin | `"inherit"` | `"inherit"` |
| Default stdout / stderr | `"piped"` (collected as `Uint8Array`) | `"inherit"` (printed to the terminal) |
| Piped stdin | Throws `TypeError: Piped stdin is not supported for this function, use 'Deno.Command.spawn()' instead` ✅[^run] | Allowed; you write to `child.stdin` and must close it |
| Returns | `{ success, code, signal, stdout, stderr }` | A `ChildProcess` with `pid`, `status`, `stdin`, `stdout`, `stderr`, `kill()`, `output()` |

Sources: ✅[^cmd] ✅[^stdin-ex]. Measured results ✅[^run]:
- `sh -c "echo out; echo err >&2; exit 3"` via `output()` → `{ success: false, code: 3, signal: null, stdout: "out\n", stderr: "err\n" }`.
- `env: { GREETING: "hi" }, cwd: "/tmp"` → the child prints `hi` and `/tmp`; `clearEnv: true` leaves only the variables you pass (`ONLY=1`).
- `kill()` sends `SIGTERM` by default → `{"success":false,"code":143,"signal":"SIGTERM"}`; `kill("SIGKILL")` → code `137`; aborting the `signal` option's `AbortController` → `SIGTERM`, code `143`.
- A missing program → `NotFound: Failed to spawn 'no-such-cmd': entity not found`.
- Reading `child.stdout` when it was not piped → `TypeError: Cannot get 'stdout': 'stdout' is not piped`.
- `ChildProcess` has `Symbol.asyncDispose`: `await using c = cmd.spawn()` ended a `sleep 30` at the block's end with `SIGTERM` (code `143`) in under 100 ms.
- Shorthands `Deno.spawn(cmd, args, options)`, `Deno.spawnAndWait(...)` and `Deno.spawnAndWaitSync(...)` return a `ChildProcess` or a `CommandOutput` without the builder ✅[^spawn]. `Deno.spawnAndWait("sh", ["-c", "echo hi; exit 2"])` gave `{"code":2,"success":false,"stdout":"hi\n"}`, and piping a stream into `Deno.spawn("cat", [], { stdin: "piped", stdout: "piped" }).stdin` closed stdin by itself ✅[^run] ✅[^stdin-ex].

### Arguments, environment, exit and lifecycle
- `Deno.args` holds only the script's arguments: `deno run envargs.ts one "two words" --flag` → `["one","two words","--flag"]` ✅[^runtime] ✅[^run].
- `Deno.env.get/set/delete/has/toObject` need `--allow-env`; a missing variable reads as `undefined` ✅[^runtime] ✅[^run]. With `--allow-env=APP_MODE`, reading any other name throws `NotCapable`, even for a variable that is not set ✅[^run].
- `Deno.cwd()` returned `/lab`; `Deno.chdir("/tmp")` needs read access to the target, else `NotCapable: Requires read access to "/tmp"` ✅[^runtime] ✅[^run].
- **Exit and events.** `load` fires after the main module runs; `beforeunload` fires when the event loop is empty and can be cancelled; `unload` fires last and cannot ✅[^nsapi] ✅[^exit-ex]. `Deno.exit(n)` stops at once and skips `beforeunload`; `Deno.exitCode = n` only records the code ✅[^exit-ex]. Measured order and codes ✅[^run]:

  | Script ends by | Printed | Exit code |
  |---|---|---|
  | Running out of work | `main body end`, `load`, `beforeunload 0`, `unload` | 0 |
  | `beforeunload` calls `preventDefault()` and starts a timer (twice) | `beforeunload 0`, `extra work 1`, `beforeunload 1`, `extra work 2`, `beforeunload 2`, `unload` | 0 |
  | `Deno.exit(3)` | `unload` only | 3 |
  | `Deno.exitCode = 4` | all three events | 4 |
  | An uncaught `throw` | `load`, then the error; no `unload` | 1 |

### Signals
`Deno.addSignalListener(signal, handler)` registers a handler; `Deno.removeSignalListener` needs the same function reference ✅[^signal]. On Windows only `SIGINT`, `SIGBREAK`, `SIGTERM`, `SIGQUIT`, `SIGHUP` and `SIGWINCH` work ✅[^runtime]. Measured on Linux ✅[^run]: with a `SIGTERM` listener, two `kill -TERM <pid>` calls ran the handler and the process kept running; after `removeSignalListener`, the third `SIGTERM` ended it with exit code 143 (`Terminated`). `Deno.addSignalListener("SIGKILL", …)` throws `TypeError: Binding to signal 'SIGKILL' is not allowed`.

### Error classes
Deno 2.9.8 has 25 classes under `Deno.errors` ✅[^run] ✅[^errors]. Measured mapping ✅[^run]:

| Failure | Class | Message starts |
|---|---|---|
| Flag not granted | `NotCapable` | `Requires read access to "…", run again with the --allow-read flag` |
| OS refuses the user | `PermissionDenied` | `Permission denied (os error 13)` |
| Missing file or parent directory | `NotFound` | `No such file or directory (os error 2)` |
| `createNew` / `mkdir` on an existing path | `AlreadyExists` | `File exists (os error 17)` |
| `readTextFile` / `writeTextFile` on a directory | `IsADirectory` | `Is a directory (os error 21)` |
| `readDir` on a file, or `file.txt/child` | `NotADirectory` | `Not a directory (os error 20)` |
| Using a closed handle | `BadResource` | `Bad resource ID` |
| Removing a non-empty directory | `Error` (no `Deno.errors` class) | `Directory not empty (os error 39)` |

### `import.meta` and the standard streams
- `import.meta.main` is `true` only in the entry module (`false` in `meta_dep.ts`); `url` is `file:///lab/meta.ts`; `filename` / `dirname` are `/lab/meta.ts` / `/lab`; `resolve("./x.ts")` gives `file:///lab/x.ts`; `resolve("lodash")` throws `TypeError: Import "lodash" not a dependency` ✅[^importmeta] ✅[^run]. In a `data:` module, `filename` and `dirname` are `undefined` ✅[^nsapi] ✅[^run].
- `Deno.stdin.readable` is a `ReadableStream` and `Deno.stdout.write()` resolves to the byte count ✅[^io]. `printf "piped in" | deno run stdio.ts` printed `got "piped in"`, `write returned 15`, and `isTerminal()` was `false` for both ✅[^run].

## Worked example
`sort_file.ts` sorts a file's lines through the system `sort` and writes `<input>.sorted`, with a distinct exit code per failure:
```ts
if (import.meta.main) {
  const [input] = Deno.args;
  if (!input) { console.error("usage: sort_file.ts <input>"); Deno.exit(2); }
  let text: string;
  try { text = await Deno.readTextFile(input); }
  catch (e) {
    if (e instanceof Deno.errors.NotFound) { console.error(`no such file: ${input}`); Deno.exit(1); }
    throw e;
  }
  const child = new Deno.Command("sort", { stdin: "piped", stdout: "piped" }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(text));
  await writer.close();                       // without this, sort waits forever
  const { code, stdout } = await child.output();
  const outPath = `${input}.sorted`;
  { using out = await Deno.open(outPath, { write: true, create: true, truncate: true });
    await out.write(stdout); }                // closed here
  console.log(`sort exited ${code}; wrote ${(await Deno.stat(outPath)).size} bytes to ${outPath}`);
}
```
Measured with `printf "pear\napple\nfig\n" > fruits.txt` ✅[^run]:

| Command | Output | Exit |
|---|---|---|
| `deno run --allow-read --allow-write --allow-run=sort sort_file.ts fruits.txt` | `sort exited 0; wrote 15 bytes to fruits.txt.sorted`; the file holds `apple`, `fig`, `pear` | 0 |
| same, `missing.txt` | `no such file: missing.txt` | 1 |
| same, no argument | `usage: sort_file.ts <input>` | 2 |
| without `--allow-run` | `error: Uncaught (in promise) NotCapable: Requires run access to "sort", run again with the --allow-run flag` | 1 |

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Catching `PermissionDenied` for a missing flag | Never matches in Deno 2 | Missing flags throw `NotCapable`; `PermissionDenied` is the OS refusal ✅[^errors] ✅[^run] |
| `Deno.remove` on a non-empty directory | Plain `Error`, not a `Deno.errors` class | No class maps os error 39 in 2.9.8 ✅[^run]; check `e.message` or pass `{ recursive: true }` |
| Piped stdin never closed | The child (`sort`) never exits | It waits for end of input ✅[^stdin-ex] |
| `Deno.spawn` / `Deno.spawnAndWait` without an `--unstable-*` flag | Run: they work with only `--allow-run`; the API page labels them unstable | They may still change; `Deno.Command` is the stable form ✅[^run] ✅[^spawn] |
| `output()` with `stdin: "piped"` | `TypeError` before the child starts | `output()` cannot feed stdin ✅[^cmd] ✅[^run] |
| `Deno.exit()` with a `beforeunload` cleanup | Cleanup skipped; `unload` still runs | Use `Deno.exitCode` to keep the normal shutdown ✅[^exit-ex] ✅[^run] |
| Reading a stream-owned file after `pipeTo` | `BadResource` | The stream closed the file ✅[^fsfile] ✅[^run] |
| `import.meta.filename` in a remote or `data:` module | Run: `undefined`; the `ImportMeta` API page says an empty string | Test with `if (!import.meta.filename)`, which covers both ✅[^run] ✅[^nsapi] ✅[^importmeta] |
| Error-class count | 25 classes exist; the namespace guide still says 20 | The guide's count is out of date; trust `Object.keys(Deno.errors)` ✅[^run] ✅[^nsapi] |
| `Deno.watchFs` event sequence | One rename gave three events on Linux; other systems give other sequences | The docs promise no common order ✅[^watch] ✅[^run] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `readTextFile` / `writeTextFile` | One line, closes for you | Whole file in memory; no `sync()` |
| `Deno.open` + streams | Constant memory for large files | Ownership rules: do not close a file a stream owns |
| `output()` | One call, all output buffered | No piped stdin; large output stays in memory |
| `spawn()` | Streaming in and out, `kill()` | You must close stdin and read or discard the piped streams |

## Takeaways
- Catch `Deno.errors.NotCapable` for missing flags and `Deno.errors.PermissionDenied` for OS refusals; never treat them as the same failure. [rule-candidate]
- Declare `Deno.FsFile` and spawned `ChildProcess` handles with `using` / `await using`. [rule-candidate]
- Close a piped `child.stdin` writer before awaiting the child. [rule-candidate]
- Prefer `Deno.exitCode = n` over `Deno.exit(n)` when cleanup runs in `beforeunload`.
- Guard script entry code with `if (import.meta.main)` so the module can also be imported.

## Verification status
- Verified: 73 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- Commands run on 2026-11-24 with `denoland/deno:alpine-2.9.8` (Deno 2.9.8, V8 15.0.245.2-rusty, TypeScript 6.0.3, Alpine 3.24.2, aarch64) in the lab of `deno/deno-lab-setup.md`; outputs as quoted in Mental model, How it works, Worked example and Edge cases. [^run]
- [Deno APIs: File System](https://docs.deno.com/api/deno/file-system) — Deno project, living. Rank 1. Backs: whole-file calls, `OpenOptions` defaults, `stat`, `readDir`, `mkdir`, `remove`, `makeTempDir`. [^fs]
- [Deno.FsFile](https://docs.deno.com/api/deno/~/Deno.FsFile) — Deno project, living. Rank 1. Backs: `using` closes the file, `readable` / `writable` close the file when done. [^fsfile]
- [Deno.writeTextFile](https://docs.deno.com/api/deno/~/Deno.writeTextFile) — Deno project, living. Rank 1. Backs: `allow-read` needed when `create` is `false`; data not guaranteed flushed. [^wtf]
- [Deno.watchFs](https://docs.deno.com/api/deno/~/Deno.watchFs) — Deno project, living. Rank 1. Backs: `recursive` default, paths must exist, event order varies by OS. [^watch]
- [Deno.Command](https://docs.deno.com/api/deno/~/Deno.Command) — Deno project, living. Rank 1. Backs: stdio defaults, `output()` vs `spawn()`, `kill()` default `SIGTERM`, `allow-run`. [^cmd]
- [Deno.spawnAndWait](https://docs.deno.com/api/deno/~/Deno.spawnAndWait) — Deno project, living. Rank 1. Backs: `spawn`, `spawnAndWait`, `spawnAndWaitSync` signatures and return types; marked unstable. [^spawn]
- [Pipe data into a subprocess](https://docs.deno.com/examples/subprocess_stdin/) — Deno project, living. Rank 1. Backs: writing to and closing piped stdin; `Deno.spawn` with `pipeTo` closes stdin. [^stdin-ex]
- [Deno APIs: Runtime](https://docs.deno.com/api/deno/runtime) — Deno project, living. Rank 1. Backs: `Deno.args`, `Deno.env`, `Deno.chdir`, Windows signal list. [^runtime]
- [Deno.addSignalListener](https://docs.deno.com/api/deno/~/Deno.addSignalListener) — Deno project, living. Rank 1. Backs: listener signature, same reference for removal. [^signal]
- [Deno APIs: Errors](https://docs.deno.com/api/deno/errors) — Deno project, living. Rank 1. Backs: class list, `NotCapable` versus `PermissionDenied`. [^errors]
- [Deno APIs: I/O](https://docs.deno.com/api/deno/io) — Deno project, living. Rank 1. Backs: `Deno.stdin.readable`, `write()` byte count, `isTerminal()`. [^io]
- [Deno namespace APIs](https://docs.deno.com/runtime/reference/deno_namespace_apis/) — Deno project, living. Rank 1. Backs: `load` / `beforeunload` / `unload` rules, `import.meta.filename` `undefined` for remote modules, "20 error classes". [^nsapi]
- [ImportMeta](https://docs.deno.com/api/web/~/ImportMeta) — Deno project, living. Rank 1. Backs: `main`, `url`, `filename`, `dirname`, `resolve`; empty string for non-local modules. [^importmeta]
- [Set and read process exit codes](https://docs.deno.com/examples/exit_codes/) — Deno project, living. Rank 1. Backs: `Deno.exit` skips `beforeunload` but fires `unload`; `Deno.exitCode`. [^exit-ex]
- [await using](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/await_using) — MDN Web Docs, living. Rank 3. Backs: `await using` falls back to `Symbol.dispose`. [^mdn-using]

## Related
- `deno/security/permission-model.md` — how the permission gate decides, and what each grant implies.
- `deno/runtime-apis/workers-kv-and-cron.md` — Web Workers, local Deno KV and `Deno.cron`.
- `deno/modules/module-specifiers-and-imports.md` — module specifiers and `import.meta.resolve` in resolution.
- `deno/web/http-server.md` — `Deno.serve` and graceful shutdown with signals.
- `deno/releases-stability-and-support.md` — what "unstable" means for APIs such as `Deno.spawn`, and every `--unstable-*` flag.
- `deno/deno-lab-setup.md` — the lab where every output above was measured.
