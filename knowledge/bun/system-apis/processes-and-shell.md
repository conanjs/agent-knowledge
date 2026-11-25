---
schema: knowledge-doc/v1
type: concept
topic: bun/system-apis
status: verified
applies-to: ["Bun 1.4.5", "Node.js 24.22.1"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [bun, spawn, spawnsync, subprocess, ipc, bun-shell, shell-injection, child-process, shellerror]
---

# Bun processes and the Bun Shell: `Bun.spawn`, `Bun.spawnSync` and `$`

## Summary
**TL;DR:** `Bun.spawn(["cmd", "arg"])` starts a program directly from an argument array, with no shell in between; you read `proc.stdout` as a stream and `await proc.exited` for the code. `Bun.spawnSync` blocks and returns `Buffer`s plus `success`. The Bun Shell, `` $`…` ``, is a bash-like interpreter that runs inside the Bun process: each `${value}` becomes one literal argument, so `` $`echo ${"x; rm -rf /tmp/t"}` `` prints the text and deletes nothing. A non-zero exit throws `ShellError` unless you call `.nothrow()`; `.text()`, `.json()`, `.lines()` read the output; `<` and `>` redirect from and to buffers, `Response`s and `Bun.file`s.
**Use this when:** running another program from Bun code, writing a cross-platform build or dev script, passing user input to a command, or porting `child_process` code.
**Not this doc:** `FileSink` and `Bun.file` themselves → [file-io.md](file-io.md); running `package.json` scripts with `bun run` → `bun/fundamentals/running-code-and-transpilation.md`; message passing between threads → [workers-ffi-and-native-code.md](workers-ffi-and-native-code.md).

## Problem
Building a command string and handing it to a system shell (`child_process.exec`) lets a value like `x; rm -rf /tmp/t` run a second command. Scripts written for bash break on Windows, or need helpers such as `rimraf` and `cross-env`. And process APIs hide sharp details: which environment a child gets, what `exitCode` is after a kill, how to stop a child that hangs, and how large captured output may grow.

## Mental model
**Analogy:** `Bun.spawn` is a written work order handed straight to a contractor: every line of the order (each array element) is one instruction, and nobody re-reads it looking for hidden extra instructions. The Bun Shell is a clerk who reads a script for you but puts every value you hand over into a sealed envelope (`${…}`): the clerk passes the envelope on unopened, so a note inside saying "and also delete everything" is never read as an instruction.

**Artifact** (Bun 1.4.5 in the lab, then Node.js 24.22.1 for contrast) ✅[^lab]:
```ts
import { $ } from "bun";
const userInput = "x; rm -rf /tmp/t";                 // /tmp/t/keep exists
await $`echo ${userInput}`.text();                    // "x; rm -rf /tmp/t\n"  — /tmp/t still exists
await $`echo ${{ raw: "x; rm -rf /tmp/t2" }}`;        // raw: parsed as shell code — /tmp/t2 is deleted
// Node.js: execSync(`echo ${userInput}`)  → "x\n"   — /tmp/t is deleted by /bin/sh
//          execFileSync("echo", [userInput]) → "x; rm -rf /tmp/t\n" — nothing deleted
```

## How it works
Four actors take part:
- **Your code** — its job: describe the command and its input and output, via `Bun.spawn` options or a `` $`…` `` template.
- **The Bun Shell interpreter** — its job: parse the template into commands, pipes and redirects, via its own lexer and parser in the Bun process ✅[^2].
- **Bun's spawn layer** — its job: start each external program, via `posix_spawn(3)` ✅[^1].
- **The child process** — its job: do the work and exit with a code or die from a signal, via its stdin, stdout, stderr and exit status.

```
your code ── Bun.spawn(["sort"], {stdin, stdout}) ─────────────────────┐
your code ── $`cat < ${resp} | wc -c` ─▶ Bun Shell (in-process):      │
                                          parse → builtin? run it here │
                                                  else ───────────────▶ spawn layer: posix_spawn
                                                                        │   ═══ process boundary ═══
                                                                        ▼
                                                                    child process (stdin/stdout/stderr)
                                                                        │ exit code or signal
your code ◀── proc.exited / ShellOutput / ShellError ◀──────────────────┘
```

### `Bun.spawn` and `Bun.spawnSync`
1. **Your code → spawn layer.** `Bun.spawn(cmd[], options)` or `Bun.spawn({ cmd, ...options })` returns a `Subprocess` at once ✅[^1]. A missing program throws synchronously: `Error: Executable not found in $PATH: "no-such-cmd"`, `code` `ENOENT` ✅[^lab]. Under `strace` in `bunlab:2`, `Bun.spawn(["/bin/true"])` made one `clone(…, flags=CLONE_VM|CLONE_VFORK|SIGCHLD)` followed by `execve("/bin/true")`: a vfork-style start, in which the child shares the parent's memory and the parent waits until the child runs the new program ✅[^7], not a full `fork` ✅[^lab].
2. **Options** (defaults from the docs and type definitions, results from the lab):

   | Option | Default | Observed in 1.4.5 |
   |---|---|---|
   | `cwd` | `process.cwd()` ✅[^3] | `cwd: "/tmp"` → child `pwd` printed `/tmp` ✅[^lab] |
   | `env` | `process.env` as it was when Bun started ✅[^3] | `env: { FOO: "bar" }` replaced the whole environment: the child's `env` printed only `FOO=bar` ✅[^lab] |
   | `stdin` | none (`"ignore"`) ✅[^1] ✅[^3] | Default: `proc.stdin` was `undefined`, and the child's stdin was `/dev/null` (it read 0 bytes) ✅[^lab]. `"pipe"` gave a `FileSink` (`write("hello ")` → `6`); `Bun.file`, `Response`, `Request`, `Blob`, `Uint8Array` and `ReadableStream` were all read by `cat` ✅[^lab] |
   | `stdout` | `"pipe"` (a `ReadableStream`) ✅[^1] | Default: `proc.stdout instanceof ReadableStream` → `true` ✅[^lab]. `Bun.file("/tmp/out.txt")` wrote the file; `"ignore"` and a file left `proc.stdout` `undefined` ✅[^lab] |
   | `stderr` | `"inherit"` for `spawn`, `"pipe"` for `spawnSync` ✅[^3] | Defaults: `spawn` left `proc.stderr` `undefined` and the child's text appeared on the parent's stderr; `spawnSync` returned it, `"to-stderr\n"` ✅[^lab]. `stderr: "pipe"` → `await proc.stderr.text()` = `"err\n"` ✅[^lab] |
   | `onExit(proc, exitCode, signalCode, error)` | — | `sh -c "exit 3"` → `{exitCode: 3, signalCode: null}` ✅[^lab] |
   | `timeout` (ms) + `killSignal` | no timeout; `SIGTERM` ✅[^3] | `sleep 10`, `timeout: 200` → ended with `SIGTERM` after a median 201 ms (5 runs, 201–202 ms, from the script's first line), so the timer, not `sleep`, ended it; with `killSignal: "SIGKILL"` → `SIGKILL` ✅[^lab] |
   | `signal` (an `AbortSignal`) | — | `abort()` after 50 ms → `SIGTERM` ✅[^lab]; `killSignal` applies here too ✅[^1] (`killSignal: "SIGKILL"` + `abort()` → `SIGKILL`) ✅[^lab] |
   | `maxBuffer` (bytes) | no limit ✅[^3] | `spawnSync(["yes"], { maxBuffer: 100 })` → killed with `SIGTERM`, 65,636 bytes returned ✅[^lab] |
   | `ipc(message, proc)` + `serialization` | `"advanced"` ✅[^1] | With no `serialization`, a `Map` and a `Date` reached a Bun child as a `Map` and a `Date`, as with `"advanced"` ✅[^lab]; see step 5 |

3. **Child → your code: exit status.** `await proc.exited` resolves to the exit code; after a signal it resolves to 128 + the signal number (`143` for `SIGTERM`, `137` for `SIGKILL`), while `proc.exitCode` is `null` and `proc.signalCode` is `"SIGTERM"` ✅[^lab]. `proc.kill()` sends `SIGTERM`; `kill("SIGKILL")` or `kill(9)` send others ✅[^1] ✅[^lab].
4. **Lifetime.** The parent waits for its children ✅[^1]: measured from the script's first line, a script that spawned `sleep 1` exited after a median 1,002 ms (5 runs, 1,001–1,003 ms), and with `proc.unref()` after 0 ms (5 of 5 runs) ✅[^lab]. `proc.resourceUsage()` is `undefined` until the child exits, then gives `maxRSS` (peak resident memory in bytes; 30,982,144 for a busy `sh` loop) and `cpuTime.user/system/total` in microseconds as `bigint` ✅[^1] ✅[^lab].
5. **IPC between Bun processes.** IPC (inter-process communication) is a message channel between parent and child, like a pneumatic tube between two offices. The parent passes `ipc(message)` and calls `proc.send()`; the child uses `process.send()` and `process.on("message")`, the same API as Node's `fork()` ✅[^1]. In the lab, a `Map` arrived as a `Map` with `serialization: "advanced"` (structured clone) and as a plain `{}` with `"json"`; a `Date` arrived as a `Date` and as a string ✅[^lab]. Use `"json"` to talk to a Node.js child ✅[^1]. With a Node.js 24.22.1 child (the musl build from `node:24.22.1-alpine`, started through its own musl loader inside the Bun image), `"json"` worked both ways, the `Date` arriving as a string and the `Map` as `{}`; with the default `"advanced"`, the child's `process.send()` reported no error, Bun received nothing, the child got a `disconnect` event, and `proc.send()` threw `Subprocess.send() can only be used if an IPC channel is open.` (2 runs) ✅[^lab].
6. **`Bun.spawnSync`** returns `{ exitCode, stdout, stderr, success, resourceUsage, pid }` with `Buffer` output and no `stdin` property ✅[^1] ✅[^lab]. `sh -c "echo out; echo err >&2; exit 2"` gave `success: false`, `exitCode: 2`, stdout `"out\n"`, stderr `"err\n"`; a `timeout: 100` on `sleep 5` gave `exitCode: null`, `signalCode: "SIGTERM"`, `exitedDueToTimeout: true` ✅[^lab].

### The Bun Shell (`$`)
1. **Your code → interpreter.** The template is parsed by Bun itself; no `/bin/sh` is started ✅[^2]. Under `strace`, `` $`ls /w > /dev/null && echo $(basename /a/b) | wc -c` `` started one process, `execve("/usr/bin/wc")`, and a line made only of builtins (`echo`, `pwd`, `mkdir`, `touch`, `rm`) started none ✅[^lab]. Each interpolated value is one literal argument ✅[^2]: `` ls ${"my-file.txt; rm -rf /"} `` failed with `ls: my-file.txt; rm -rf /: No such file or directory` ✅[^lab]. An array becomes several arguments (`` printf '[%s]' ${["a b", "c"]} `` → `[a b][c]`) ✅[^lab]. `$.escape(s)` returns the quoted form (`"x; rm -rf /tmp/t"` with the double quotes) and `{ raw: s }` skips escaping ✅[^2] ✅[^lab].
2. **Bash features.** Pipes, `&&`/`||`, `$(…)` command substitution, `VAR=value` prefixes, globs (`echo g*.txt` → `g1.txt g2.txt`) and brace expansion (`$.braces("echo {1,2,3}")` → three strings) worked ✅[^2] ✅[^lab]. Backtick command substitution does not, because Bun reads the template's raw strings ✅[^2].
3. **Interpreter → builtin or spawn.** Builtins run inside Bun, so they behave the same on every operating system ✅[^2]. The same script ran on Linux and on macOS 26.1, each command twice: once with `PATH` empty, and once with a folder of stub programs of the same names (each prints `STUB:<name>`) first on `PATH`, so a spawned program shows itself ✅[^lab]:
   - On both systems these ran as builtins, working with an empty `PATH` and ignoring the stubs: `cd`, `echo`, `pwd`, `ls`, `mkdir`, `touch`, `mv`, `rm`, `which`, `seq`, `yes`, `basename`, `dirname`, `true`, `false`, `exit`, `export` ✅[^lab].
   - `bun` is not a builtin: a `bun` on `PATH` won (the stub printed), and with an empty `PATH` the current Bun executable ran ✅[^lab].
   - `cat` and `cp` exist in the source but are switched off on Linux and macOS unless `BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS=1` is set in Bun's own environment ✅[^4]: without it both spawned the stub, and an empty `PATH` gave `bun: command not found: cat`, on both systems ✅[^lab].
   - With the flag, `cp` ran as a builtin on both. The `cat` builtin printed the file and exited `0` on Linux in every form tried (captured, printed, piped, redirected to a buffer or a file, from `<` and from a pipe; 2 runs; an earlier run here had seen it exit `1` with no output, which these runs did not reproduce). On macOS `cat f.txt` and `cat < f.txt` printed the file and then never finished (killed after 4 or 8 s, 3 runs); only `echo hi | cat` completed ✅[^lab].
   - Anything else (`wc`, `head`, `sh`) is looked up on `PATH` ✅[^lab]. Windows was not run (the lab has no Windows machine); there the source turns `cat` and `cp` on always ✅[^4].
4. **Reading output.** `` await $`…` `` prints to stdout and returns a `ShellOutput` with `stdout`/`stderr` `Buffer`s and `exitCode`; `.quiet()` stops the printing ✅[^2] ✅[^lab]. `.text()` (quiet by itself), `.json()`, `.blob()`, `.arrayBuffer()` and `.lines()` (an async iterator) convert it ✅[^2] ✅[^5] ✅[^lab].
5. **Errors.** A non-zero exit rejects with `ShellError`: `message` `"Failed with exit code 7"`, `exitCode` `7`, and the captured `stdout`/`stderr` ✅[^2] ✅[^lab]. An unknown command exits `1` with stderr `bun: command not found: no-such-command-xyz` ✅[^lab]. `.nothrow()` or `.throws(false)` turn this off per command; `$.nothrow()` / `$.throws(false)` for every later command ✅[^2] ✅[^lab].
6. **Redirects to and from JavaScript objects.** `< ${buffer}`, `< ${response}` and `< ${Bun.file(p)}` feed stdin; `> ${buffer}` fills the buffer (the rest stays zero bytes), `> ${Bun.file(p)}` writes and `>>` appends; `2>&1` and `2> file` work as in bash ✅[^2] ✅[^lab].
7. **Working folder and environment.** `.cwd("/usr")` and `.env({...})` apply to one command, `$.cwd()` and `$.env()` to all later ones; without them commands see `process.env`, including values set at run time ✅[^2] ✅[^lab].

### Compared with `node:child_process`
`exec`/`execSync` run the string through a system shell, so the artifact's input deleted `/tmp/t` in Node.js 24.22.1; `execFile`/`execFileSync` pass an argument array like `Bun.spawn` and deleted nothing ✅[^6] ✅[^lab]. Bun's `$` gives shell syntax with `execFile`-style argument safety.

## Worked example
A release script: count the bytes of a downloaded body, save output, then run a tool with a time limit, as one script (Bun 1.4.5, lab) ✅[^lab]:

| Step | Code | Observed |
|---|---|---|
| 1 | `` await $`cat < ${new Response("resp body")} \| wc -c`.text() `` | `"9\n"` (Response → stdin, piped to `wc`) |
| 2 | `` await $`echo to-file > ${Bun.file("/tmp/sh-out.txt")}` `` then `` $`echo more >> ${Bun.file("/tmp/sh-out.txt")}` `` | file holds `to-file\nmore\n` |
| 3 | `` await $`sh -c 'echo partial; echo bad >&2; exit 7'`.quiet() `` in `try` | `ShellError`, `exitCode` 7, `stdout` `partial\n`, `stderr` `bad\n` |
| 4 | `const p = Bun.spawn(["sleep", "10"], { timeout: 200 })` | returns at once (0 ms) |
| 5 | `await p.exited` | `143` after the 200 ms timeout (203 ms in this run; a median 201 ms over 5 separate runs); `p.exitCode` `null`, `p.signalCode` `"SIGTERM"` |
| 6 | `Bun.spawnSync(["sh", "-c", "echo out; exit 2"]).success` | `false` |

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `proc.killed` after a normal exit | `true` (it was `false` while running) ✅[^lab] | The docs gloss it as "was the process killed?" ✅[^1]; in 1.4.5 it means "no longer running", so test `signalCode` instead |
| `await proc.exited` after a kill | `143`/`137`, not `null` ✅[^lab] | `exitCode` is `null` and `signalCode` names the signal; check both |
| `maxBuffer: 100` | 65,636 bytes came back ✅[^lab] | Bun stops reading after the read that crossed the limit ✅[^1]; one read was 64 KiB here |
| `process.env.LATE = "…"` at run time, then `Bun.spawn` without `env` | The child printed `LATE=` (empty); with `env: process.env` it printed the value ✅[^lab] | The default is a snapshot taken at start-up ✅[^3]; the Bun Shell does see run-time changes ✅[^lab] |
| `env` without `PATH` | `Bun.spawn(["ls"], { env: { X: "1" } })` still found `ls`, and the child got no `PATH` ✅[^lab] | Bun looks the program up itself, with the `PATH` it started with (a `PATH` inside `env` is used instead) ✅[^lab]; a child that spawns further programs needs `PATH` in `env`, so spread `...process.env` |
| `` $`echo ${{ raw: input }}` `` or `` $`sh -c ${input}` `` | The second command ran and deleted the folder ✅[^lab] | `raw` turns escaping off; `sh -c` hands the string to a new shell that Bun does not protect ✅[^2] |
| An argument that starts with `-` (`--upload-pack=…`) | Passed safely as one argument, but the program may read it as its own flag ✅[^2]: in `bunlab:1`, `` $`git ls-remote ${"--upload-pack=touch /tmp/pwned;"} /tmp/repo` `` ran `touch` and created `/tmp/pwned`; with `--` before the value, git refused it (`strange pathname … blocked`) and nothing was created ✅[^lab] | Argument injection; validate input or put `--` before it |
| `cat`/`cp` in `$` on Linux or macOS | Spawn the system binary; fail with `bun: command not found: cat` if `PATH` has none (both systems) ✅[^lab] | Disabled on POSIX (Portable Operating System Interface) systems such as Linux and macOS in 1.4.5 ✅[^4]; the docs list `cat` as a builtin ✅[^2] |
| `BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS=1`, then `` $`cat ${file}` `` on macOS | The file's text is printed, then the command never resolves (3 runs) ✅[^lab] | The builtin is experimental; on Linux it finished ✅[^lab]. Leave the flag off on macOS, where the system `cat` works |
| `.lines()` on output ending in a newline | Yields a final empty string: `["a","b","c",""]` ✅[^lab] | Skip empty lines when iterating |
| `.blob()` type | `""` in the lab ✅[^lab] | The docs show `type: "text/plain"` ✅[^2]; set a type yourself if it matters |
| Backticks inside the template | Printed literally: `` echo \`echo hi\` `` gave `` `echo hi` `` ✅[^2] ✅[^lab] | Use `$(…)` |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `Bun.spawn` | Streams, timeouts, IPC, no shell parsing at all | Verbose for pipelines; no globs or redirects |
| `Bun.spawnSync` | Simple for command-line tools; `success`, `exitedDueToTimeout` | Blocks the event loop; output fully buffered |
| Bun Shell `$` | Bash syntax, safe interpolation, cross-platform builtins, JavaScript-object redirects | Not full bash; `raw` and `sh -c` reopen injection; throws by default |
| `node:child_process` | Same code on Node.js | `exec` runs a real shell (injection risk); no `Response`/`Bun.file` stdio |

## Takeaways
- Pass user input to commands only through `${}` in `$` or as array elements in `Bun.spawn`; never through `{ raw }`, `sh -c` or a string built by hand. [rule-candidate]
- Put `--` before user-controlled arguments to stop them being read as flags. [rule-candidate]
- Give every spawned process that may hang a `timeout` (and a `killSignal` if it ignores `SIGTERM`). [rule-candidate]
- Decide success from `exitCode` and `signalCode`, never from `killed`. [rule-candidate]
- Wrap `$` calls in `try`/`catch` or use `.nothrow()` and read `exitCode`.

## Verification status
- Verified: 105 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- `linux/lab-setup.md` — the Bun 1.4.5 lab (`oven/bun:1.4.5` image; `bunlab:1`, which adds git, for the argument-injection check; `bunlab:2`, which adds strace 6.13, for the process-creation traces; arm64) where every ✅[^lab] behaviour ran on 2026-11-24; the Node.js comparison ran in `node:24.22.1-alpine`, and the IPC check ran that image's `node` binary, its musl loader and libraries copied into the Bun image. The macOS builtin checks ran a Bun 1.4.5 binary cross-compiled with `bun build --compile --target=bun-darwin-arm64` and run as the full CLI (`BUN_BE_BUN=1`) with an isolated environment on macOS 26.1 (Apple M2); the binary was deleted afterwards. [^lab]
- [Spawn (docs at bun-v1.4.5)](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/child-process.mdx) — Bun documentation in the Bun repository (Oven), 2026. Backs: `spawn`/`spawnSync` options and results, stdin/stdout values, `onExit`, `kill`, `unref`, `resourceUsage`, `timeout`/`killSignal`, `maxBuffer`, IPC and `serialization`, `posix_spawn`. [^1]
- [Shell (docs at bun-v1.4.5)](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/shell.mdx) — Bun documentation in the Bun repository (Oven), 2026. Backs: in-process interpreter, escaping, `raw`, `$.escape`, builtins list, output methods, `ShellError`, `nothrow`/`throws`, redirects, pipes, `cwd`/`env`, security notes. [^2]
- [packages/bun-types/bun.d.ts at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/packages/bun-types/bun.d.ts) — Bun source (Oven), 2026. Backs: stdio defaults, `killSignal` and `maxBuffer` defaults. [^3]
- [src/runtime/shell/Builtin.rs at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/src/runtime/shell/Builtin.rs) — Bun source (Oven), 2026. Backs: the builtin list and `cat`/`cp` disabled on POSIX unless `BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS`. [^4]
- [packages/bun-types/shell.d.ts at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/packages/bun-types/shell.d.ts) — Bun source (Oven), 2026. Backs: `ShellPromise` and `ShellOutput` methods. [^5]
- [Child process](https://nodejs.org/docs/latest-v24.x/api/child_process.html) — Node.js documentation, v24. Backs: `exec` runs a shell, `execFile` does not. [^6]
- [clone(2)](https://man7.org/linux/man-pages/man2/clone.2.html) — Linux man-pages project, living. Backs: `CLONE_VM` (shared memory) and `CLONE_VFORK` (the parent waits until the child calls `execve` or exits). [^7]

## Related
- `bun/system-apis/file-io.md` — `FileSink`, `Bun.file` and `Bun.stdout` used as stdio.
- `bun/system-apis/workers-ffi-and-native-code.md` — threads instead of processes.
- `bun/node-compat/nodejs-compatibility.md` — `node:child_process` status in Bun.
- `js-runtime/abort-signal.md` — `AbortSignal` patterns used by the `signal` option.
