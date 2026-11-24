---
schema: knowledge-doc/v1
type: concept
topic: deno/security
status: verified
applies-to: ["Deno 2.9.8"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [deno, security, permissions, sandbox, allow-list, deny-list, prompt, notcapable, permissions-api, workers, subprocess, allow-run, allow-ffi, allow-import, allow-scripts]
ranked-sources: true
---

# Deno's permission model: deny by default, scoped grants, deny lists and prompts

## Summary
**TL;DR:** A program started with `deno run` gets no file, network, environment, system-information, subprocess, FFI (foreign function interface: loading native libraries) or remote-import access until a flag grants it. A grant can be scoped by a list (`--allow-read=./data`) and a `--deny-*` list carves pieces out; when an allow entry and a deny entry both match, the more specific one decides, and deny wins only a tie. An ungranted operation throws `Deno.errors.NotCapable`, unless stdin and stderr are both terminals, in which case Deno stops and asks `y/n/A`. Code can inspect and drop its own grants with `Deno.permissions`. `--allow-run` and `--allow-ffi` reach outside the sandbox, so treat them like `-A`.
**Use this when:** choosing flags for a script, reading a `NotCapable` error, judging whether a dependency can escape the sandbox, narrowing a worker, or working out why a prompt did or did not appear.
**Not this doc:** the exact syntax of every flag, permission sets in `deno.json`, the audit and trace variables and the permission broker → `deno/security/permission-flags.md`; the Worker API (application programming interface) itself → `deno/runtime-apis/workers-kv-and-cron.md`; `Deno.Command` and the file APIs → `deno/runtime-apis/files-processes-and-environment.md`.

## Problem
In Node.js every dependency gets the same full access to the system as the program that loads it; Deno grants nothing until asked ✅[^security]. Without a clear picture of how grants combine, people silence errors with `-A`, assume `--deny-*` always beats `--allow-*` (it does not), wait for a prompt in CI (continuous integration) that never appears, or think `--allow-run=deno` is a narrow grant when it hands out everything.

## Mental model
**Analogy:** an office building with a guard at every door. Each visitor (your code and every dependency in it) carries one shared badge that lists rooms they may enter and rooms marked "never". The guard reads the most precisely written line that fits the door. If the badge says nothing about a door, the guard phones the badge's owner, but only if someone sits by the phone (a terminal); otherwise the answer is no. A few doors lead out of the building (subprocesses, native libraries): past them, the badge means nothing.

| Term | Plain-English meaning | Concrete artifact |
|---|---|---|
| Permission | One category of input/output (I/O) | `read`, `write`, `net`, `env`, `sys`, `run`, `ffi`, `import` ✅[^perm-ref] |
| Allow list | The rooms on the badge | `--allow-read=/lab/data` |
| Deny list | Rooms marked "never" | `--deny-read=/lab/data/secret` |
| Descriptor | One category plus one value that code asks about | `{ name: "read", path: "/lab/data" }` ✅[^perm-api] |
| Permission state | The guard's current answer for a descriptor | `"granted"`, `"denied"` or `"prompt"` ✅[^perm-api] |
| Prompt | The guard phoning the owner about a door the badge does not mention | `Allow? [y/n/A]` on the terminal |
| Partial grant | Granted, with a sub-part denied | `granted (partial)` for `/lab/data` when `/lab/data/secret` is denied ✅[^run] |
| `NotCapable` | The error thrown for a refused operation | `NotCapable: Requires read access to "/etc/hostname", run again with the --allow-read flag` ✅[^run] |

**Artifact:** one operation per permission, run with no flags in the lab (`each.ts`; the import uses a non-literal specifier). Every line failed, and the run still exited 0 because each error was caught ✅[^run]:
```console
$ deno run each.ts
read ERR NotCapable: Requires read access to "/etc/hostname", run again with the --allow-read flag
write ERR NotCapable: Requires write access to "/tmp/x.txt", run again with the --allow-write flag
net ERR NotCapable: Requires net access to "0.0.0.0:8123", run again with the --allow-net flag
env ERR NotCapable: Requires env access to "HOME", run again with the --allow-env flag
sys ERR NotCapable: Requires sys access to "hostname", run again with the --allow-sys flag
run ERR NotCapable: Requires run access to "echo", run again with the --allow-run flag
ffi ERR NotCapable: Requires ffi access to "/lib/libc.musl-aarch64.so.1", run again with the --allow-ffi flag
import ERR TypeError: Requires import access to "example.com:443", run again with the --allow-import flag
```

## How it works
**Five actors:**
- **Your code and its dependencies** — its job: ask for I/O, via `Deno.*` functions, web APIs such as `fetch`, `node:` modules, or `import()`.
- **The permission checker** — its job: decide each request, via the allow, deny and ignore lists built from the flags at startup.
- **The prompter** — its job: ask a human about an undecided request, via the terminal on stdin and stderr.
- **The module loader** — its job: load code, via the static import graph (no read or net checks) and runtime `import()` calls (checked).
- **The operating system (OS)** — its job: apply its own user and file rights, via ordinary system calls.

```
deno run --allow-read=/lab/data --deny-read=/lab/data/secret app.ts
  │
  ├─ startup: flags ──▶ [permission checker] lists: allow /lab/data, deny /lab/data/secret
  ├─ [module loader] static graph: no read or net check; remote hosts checked against the import list
  ▼
app.ts calls Deno.readTextFileSync(p)
  │
  ▼
[permission checker] most specific matching entry decides
  ├─ allow ──▶ [OS] open(p) ──▶ data, or PermissionDenied (os error 13)
  ├─ deny  ──▶ throw NotCapable
  └─ none  ──▶ [prompter] stdin and stderr both terminals?
                 ├─ no  ──▶ throw NotCapable
                 └─ yes ──▶ ask y/n/A ──▶ remember answer ──▶ allow or throw
```

1. **Startup (local, before any user code):** the flags become lists per permission. A bare flag (`--allow-net`) grants the whole category; a list grants only its entries; `-A` grants everything ✅[^perm-ref]. `--allow-hrtime` is gone: 2.9.8 prints a warning that high-resolution time is always allowed, then runs ✅[^run].
2. **Module loader:** modules in the initial static graph (static `import` and `import()` with a string literal) need no `--allow-read` or `--allow-net`; `import()` with a computed specifier is checked against `--allow-read` or `--allow-import` ✅[^security]. A remote host in the static graph must still be on the import list: `import "https://example.com/x.ts"` with no flags stopped with `error: Requires import access to "example.com:443"` before any download ✅[^run] (compared with the docs under Edge cases). Measured: `import(s)` of a local file not already in the graph failed with `TypeError: Requires read access to "/lab/mod2.ts"` and worked with `--allow-read=/lab/mod2.ts` ✅[^run].
3. **Permission checker:** all entries for a permission are sorted most specific first; at equal specificity a deny sorts before an allow; the first entry that matches decides ✅[^src-perms]. A bare flag is the least specific entry of all, so a scoped allow still beats a bare deny ✅[^run].
4. **Prompter:** only consulted when no entry matched. It asks only if stdin and stderr are terminals; otherwise the answer is "deny" ✅[^src-prompter] ✅[^run]. `--no-prompt` or `DENO_NO_PROMPT` turn prompts off even on a terminal ✅[^envvars] ✅[^run].
5. **Operating system:** a granted call still runs as the process's user. As the `deno` user with `--allow-read`, reading a root-only file threw `PermissionDenied: Permission denied (os error 13)`, a different error class from `NotCapable` ✅[^run].

### Allow and deny: the more specific entry decides
Measured with files `/lab/data/root.txt`, `/lab/data/public/a.txt`, `/lab/data/secret/s.txt` and a local server on ports 8000 and 8001 ✅[^run]:

| Flags | Result |
|---|---|
| `--allow-read=/lab/data --deny-read=/lab/data/secret` | `root.txt` and `public/a.txt` read; `secret/s.txt` NotCapable |
| `--deny-read=/lab/data --allow-read=/lab/data/public` | Only `public/a.txt` read: the narrower allow beats the broader deny |
| `--allow-read=/lab/data/public --deny-read` (bare deny) | `public/a.txt` still read; everything else NotCapable |
| `--allow-read --deny-read` (both bare) | Everything NotCapable: a tie goes to deny |
| `--allow-read=/lab/data/public --deny-read=/lab/data/public` | NotCapable: a tie goes to deny |
| `-A --deny-read=/etc` | Everything except `/etc` readable; `-A` does not override a deny |
| `--deny-net=localhost --allow-net=localhost:8000` | Port 8000 answers; 8001 NotCapable |
| `--deny-import=jsr.io` | Does not block `jsr:@std/path`: the built-in allow entry `jsr.io:443` is more specific than `jsr.io` (any port) |

The Deno source states the rule in its own tests: "Most specific allow wins over less specific denies" ✅[^src-perms]. The docs' simpler wording ("deny takes precedence") is compared under Edge cases.

### Prompts and `NotCapable`
- **The prompt** (from a run with a pseudo-terminal; the first line starts with a warning-sign emoji, left out here) ✅[^run]:
  ```console
  ┏ Deno requests read access to "/etc/hostname".
  ┠─ Requested by `Deno.permissions.request()` API.
  ┠─ To see a stack trace for this prompt, set the DENO_TRACE_PERMISSIONS environmental variable.
  ┠─ Learn more at: https://docs.deno.com/go/--allow-read
  ┠─ Run again with --allow-read to bypass this prompt.
  ┗ Allow? [y/n/A] (y = yes, allow; n = no, deny; A = allow all read permissions) >
  ```
- **The answers** ✅[^run]: `y` grants this one value (a second file prompted again); `A` grants the whole category (`Granted all read access.`, and the next file read without a prompt); `n` denies and is remembered: a second read of the same file failed with no new prompt, and `query` then reported `denied`.
- **Which streams count:** with stdout piped but stdin and stderr on the terminal, the prompt appeared; with stdin from `/dev/null`, or stderr sent to a file, `request()` returned `denied` with no prompt ✅[^run] ✅[^src-prompter].
- **`NotCapable`** is a normal exception: catch it with `err instanceof Deno.errors.NotCapable` ✅[^security]. Uncaught, it ends the program with exit code 1 ✅[^run]. Remote-import refusals are thrown as `TypeError` instead ✅[^run].

### The runtime API: query, request, revoke
`Deno.permissions` has `query`, `request` and `revoke`, each with a `…Sync` twin, and each returns a `PermissionStatus` whose `state` is `"granted"`, `"denied"` or `"prompt"` and whose `partial` flag marks a grant with a denied sub-part ✅[^perm-api]. `PermissionStatus` is an `EventTarget` with a `change` event ✅[^perm-api]. Measured ✅[^run]:

| Call | Flags | Result |
|---|---|---|
| `querySync({name})` for all eight names | none | `prompt` each |
| `requestSync({name: "read", path: "/etc/hostname"})` | none, no terminal | `denied`, no prompt |
| `query({name: "read", path: "/lab/data"})` | `--allow-read=/lab/data --deny-read=/lab/data/secret` | `granted`, `partial: true` |
| `revoke({name: "read", path: "/lab/data"})` | `--allow-read=/lab/data` | `prompt`; the next read throws NotCapable; `onchange` fires |
| `revokeSync({name: "read", path: "/lab/data/secret"})` | `--allow-read=/lab/data` | Removes the whole `/lab/data` grant that covered it |
| `revokeSync({name: "read", path: "/lab/data/secret"})` | `--allow-read` (bare) | No effect: returns `granted`, both files still read |

Revoking after startup is the documented way to shrink what later code, including dependencies, can do ✅[^security].

### Permissions that amount to `-A`
- **`--allow-run`:** a subprocess is a separate program with its own rights, outside the sandbox; the docs say to treat it as equivalent to `--allow-all` ✅[^security]. Measured: with `--allow-run=echo,deno` and no read grant, the parent could not read `/etc/hostname`, but a child `deno eval` it spawned printed the file ✅[^run]; `deno eval` runs with all permissions ✅[^eval].
- **Linker variables:** spawning with an `LD_*` or `DYLD_*` variable needs the bare `--allow-run`, because those variables load arbitrary libraries into the child ✅[^perm-ref]. Measured: `--allow-run=echo` and even `--allow-run --deny-run=cat` refused `LD_PRELOAD` ✅[^run].
- **`--allow-ffi`:** a native library runs as machine code in the same process and can make system calls directly, whatever the other flags say ✅[^security]. It covers both `Deno.dlopen` and Node-API addons ✅[^perm-ref].
- **`--allow-write` plus `--allow-run`:** write access to a folder holding an allowed executable lets the program replace that executable ✅[^security].
- **`-A`:** turns the sandbox off; the docs equate it with running under Node.js ✅[^perm-ref].
- **Symlink creation:** `Deno.symlink` needs unscoped `--allow-read` and `--allow-write`, since a link can point anywhere ✅[^perm-ref] ✅[^run].

### Workers and subprocesses
- **Workers** inherit the creating thread's permissions by default and can be narrowed with the `deno.permissions` option (`"inherit"`, `"none"` or a per-permission object) ✅[^workers]. Asking for more than the parent has fails: `NotCapable: Can't escalate parent thread permissions` (measured for `read: true` and `read: ["/etc"]` under `--allow-read=/lab`, and for `net: true` with no net grant) ✅[^run]. In 2.9.8 the option needs `--unstable-worker-options`; without it the run stopped with exit code 70 ✅[^run]. Loading a local worker script needs read access, checked against the creating thread ✅[^perm-ref].
- **Subprocesses** are not bound by the parent's grants: they run with whatever the operating system allows the user ✅[^perm-ref].
- **Signals to yourself** need no `--allow-run`: `Deno.kill(Deno.pid, "SIGUSR1")` worked with no flags ✅[^perm-ref] ✅[^run].

### Imports and npm lifecycle scripts
- **Default hosts:** without flags, imports may come from seven public registry hosts over HTTPS, among them `deno.land`, `jsr.io` and `esm.sh` (full list in `deno/security/permission-flags.md`); `npm:` packages are allowed too ✅[^perm-ref]. In 2.9.8 the built-in entries carry port 443 ✅[^run].
- **Other hosts** need `--allow-import`; a list replaces the defaults ✅[^perm-ref]. Measured: `--allow-import=example.com` made `import "jsr:@std/path@1"` fail with `Requires import access to "jsr.io:443"` ✅[^run].
- **npm lifecycle scripts** (`postinstall` and friends) do not run unless `--allow-scripts` names the package, and then only with a `node_modules` folder ✅[^perm-ref] ✅[^run-cli]. Not measured: no npm package with a lifecycle script was installed in the lab.

### Other subcommands, one line each
- `deno eval` grants all permissions by default ✅[^eval]; see `deno/fundamentals/running-code-and-typescript.md`.
- `deno test` permissions per test and in `deno.json` → `deno/testing/testing-and-mocking.md`.
- `deno compile` and the permissions of a compiled executable → `deno/advanced/compile-and-distribution.md`.

## Worked example
A job reads its config, then drops read access before plugin code runs. `worked.ts` queries its grants, reads `/lab/data/root.txt`, lets a "plugin" try `/lab/data/secret/s.txt`, revokes `/lab/data`, and reads the config again. Run with an audit log ✅[^run]:
```console
$ DENO_AUDIT_PERMISSIONS=/tmp/audit.jsonl deno run --allow-read=/lab/data --deny-read=/lab/data/secret worked.ts
1 query /lab/data        : granted (partial)
1 query /lab/data/secret : denied
2 config                 : data root
3 secret                 : true Requires read access to "/lab/data/secret/s.txt", run again with the --allow-read flag
4 revoke                 : prompt
5 config again           : NotCapable
$ cat /tmp/audit.jsonl
{"v":1,"datetime":"2026-11-24T08:49:25Z","permission":"read","value":"/lab/data/root.txt"}
{"v":1,"datetime":"2026-11-24T08:49:25Z","permission":"read","value":"/lab/data/secret/s.txt"}
{"v":1,"datetime":"2026-11-24T08:49:25Z","permission":"read","value":"/lab/data/root.txt"}
```

| Line | Who decided | Why |
|---|---|---|
| 1 | Permission checker | `/lab/data` is allowed with a denied sub-path, so `partial`; the sub-path itself matches the more specific deny |
| 2 | Checker, then the OS | The allow entry matched; the file opened |
| 3 | Checker | The deny entry is more specific than the allow; `NotCapable` was thrown and caught (`true` is the `instanceof` test) |
| 4 | Checker | `revoke` removed the grant; the state fell back to `prompt` |
| 5 | Checker, then prompter | No entry matched; no terminal, so the prompter denied |
| Audit | Checker | Three read checks logged, allowed and refused alike; `query` and `revoke` are not logged |

The exit code was 0: every refusal was caught.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| The docs say deny flags "take precedence over the allow flags" ✅[^perm-ref] | In 2.9.8 a narrower allow beats a broader deny (table above) ✅[^run] | The source sorts by specificity first and lets deny win only ties ✅[^src-perms]; the docs' wording covers the common "broad allow, narrow deny" case only |
| The docs say prompts need stdout to be a terminal ✅[^security], or stdout/stderr ✅[^perm-ref] | The prompter tests stdin and stderr; stdout does not matter ✅[^run] | `prompter.rs` returns deny when either is not a terminal ✅[^src-prompter] |
| The security page says static-graph modules, "remote URLs" included, load "without consulting the permission system" ✅[^security] | A static import from a host outside the import list (`example.com`) failed with `Requires import access to "example.com:443"`; `--deny-import=jsr.io:443` also blocked a static `jsr:` import ✅[^run] | The exemption covers `--allow-read` and `--allow-net` only; the reference page says the host limit applies to "both static and dynamic imports" ✅[^perm-ref] |
| The docs apply the default host list to dynamic imports only "if the `--allow-import` flag is specified" ✅[^perm-ref] | A computed `import()` of `jsr:@std/path@1` and of `https://jsr.io/@std/path/1.1.2/mod.ts` worked with no flag, in fresh containers ✅[^run] | The built-in `jsr.io:443` entry is a normal grant, so it also covers runtime imports |
| Bare `-I` / `--allow-import` | Grants every host: `example.com` was queried `granted` and the loader tried to download from it ✅[^run] | The help's "Default value" list is what applies when the flag is absent ✅[^run] |
| `http:` import | Refused as `Requires import access to "example.com:80"`; allowed with `--allow-import=example.com:80` ✅[^run] | Default entries are HTTPS (port 443) only ✅[^perm-ref] |
| `--allow-net=localhost` and `fetch("http://127.0.0.1:8000")` | NotCapable for `127.0.0.1:8000` ✅[^run] | Names and addresses are matched as written; no lookup joins them |
| `Deno.serve({port: 9000})` with `--allow-net=localhost:9000` | NotCapable for `0.0.0.0:9000` ✅[^run] | The default listen address is `0.0.0.0` |
| `deno serve` with no flags | Listened on `0.0.0.0:8100` and answered; inside, `net` for `0.0.0.0:8100` was `granted`, for `example.com` `prompt` ✅[^run] | `deno serve` grants only its own listen address ✅[^serve] |
| Listening on a Unix socket | Needed all three: `--allow-net=unix:/tmp/a.sock`, read and write on the path; each one missing gave its own NotCapable (`net`, `read`, `write`) ✅[^run] | 2.9.8 checks the socket path as a net value and as a file |
| Storage APIs with no flags | `localStorage` (with `--location`) and Deno KV (with `--unstable-kv`) wrote and read back a value ✅[^run] | `localStorage`, Deno KV, `caches` and `Blob` use disk without read or write grants ✅[^perm-ref] |
| Symlink inside an allowed folder | `/lab/data/link → /etc/hostname` read fine; a link to `/proc/self/environ` needed `--allow-all` ✅[^run] | Checks use the link's location, except for targets in `/proc`, `/dev`, `/sys` ✅[^perm-ref] |
| `query({name: "read"})` (no path) after `--allow-read=/lab/data`, no terminal | `prompt`, while the same query with `path: "/lab/data"` returned `granted` ✅[^run] | A scoped grant is not a grant of the whole category, and the docs do not say which state to expect; check with a path |
| A worker started with `"none"`, or with `env: false` | `querySync({name: "env"})` inside it reported `prompt`, not `denied`, yet its reads threw `NotCapable` ✅[^run] | Only `granted` promises access; read `prompt` inside a worker as "no". Per-test permissions: `deno/testing/testing-and-mocking.md` |
| `NO_COLOR` with no env grant | `Deno.env.get("NO_COLOR")` returned `"1"` ✅[^run] | Documented as visible to all code ✅[^perm-ref] |
| Code at the same privilege level | `eval`, `new Function`, `import()` and workers run any code with the same grants ✅[^security] | All code on one thread shares one privilege level ✅[^security] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Scoped lists (`--allow-read=./data`) | Least privilege; a stray dependency fails loudly | Longer commands; easy to miss a path (move them into `deno.json` sets or a task) |
| Bare category flags (`-R`, `-N`) | Short | Every dependency gets the whole category |
| Prompts on a terminal | Discover needed grants interactively | Absent in CI and in pipes with stdin redirected; habit of pressing `A` |
| `--no-prompt` | Fails fast and the same way everywhere | No interactive discovery |
| Worker with narrowed permissions | Isolates untrusted code inside one process ✅[^security] | Unstable option in 2.9.8; cannot exceed the parent |
| Subprocess | Any tool can run | Outside the sandbox entirely |

## Takeaways
- Grant scoped lists, never `-A`, in scripts and CI. [rule-candidate]
- Never grant `--allow-run=deno`, a shell, or bare `--allow-run`/`--allow-ffi` to code you would not run with `-A`. [rule-candidate]
- To carve out a secret, deny a path at least as specific as any allow that covers it; a broader deny does not beat a narrower allow. [rule-candidate]
- Pass `--no-prompt` (or set `DENO_NO_PROMPT`) in non-interactive runs so behaviour does not depend on which streams are terminals. [rule-candidate]
- Catch `Deno.errors.NotCapable` where a missing grant has a sensible fallback, and revoke read or env access once startup work is done.
- Write deny lists for import hosts with the port (`jsr.io:443`), or they do not override the defaults.

## Verification status
- Verified: 90 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- Commands run on 2026-11-24 with `denoland/deno:alpine-2.9.8` (Deno 2.9.8, V8 15.0.245.2-rusty, TypeScript 6.0.3, Alpine 3.24.2, aarch64) in the lab of `deno/deno-lab-setup.md`, most with `--network none`, prompts driven through a pseudo-terminal with `expect`, plus `deno run --help`; outputs as quoted in Mental model, How it works, Worked example and Edge cases. [^run]
- [Security and permissions](https://docs.deno.com/runtime/fundamentals/security/) — Deno project, living (page dated 2026-06-17). Rank 1. Backs: no I/O by default, the static-graph exemption, `NotCapable`, prompts, permissions that bypass the sandbox, revoking at runtime, same-privilege code, worker isolation. [^security]
- [Permissions](https://docs.deno.com/runtime/reference/permissions/) — Deno project, living (page dated 2026-07-21). Rank 1. Backs: the permission list, deny precedence wording, symlinks, `LD_*`/`DYLD_*`, FFI and Node-API, default import hosts, `--allow-scripts`, worker script loading, `NO_COLOR`, self-signals. [^perm-ref]
- [Permissions](https://docs.deno.com/api/deno/permissions) (the `Deno` namespace API reference) — Deno project, living. Rank 1. Backs: `query`/`request`/`revoke` and sync forms, `PermissionStatus`, states, `partial`, descriptors. [^perm-api]
- [Environment variables](https://docs.deno.com/runtime/reference/env_variables/) — Deno project, living. Rank 1. Backs: `DENO_NO_PROMPT`. [^envvars]
- [deno run](https://docs.deno.com/runtime/reference/cli/run/) — Deno project, living. Rank 1. Backs: lifecycle scripts only run with a `node_modules` folder. [^run-cli]
- [deno eval](https://docs.deno.com/runtime/reference/cli/eval/) — Deno project, living. Rank 1. Backs: `deno eval` runs with all permissions. [^eval]
- [deno serve](https://docs.deno.com/runtime/reference/cli/serve/) — Deno project, living. Rank 1. Backs: `deno serve` listens without `--allow-net`. [^serve]
- [Web Platform APIs: specifying worker permissions](https://docs.deno.com/runtime/reference/web_platform_apis/#specifying-worker-permissions) — Deno project, living. Rank 1. Backs: workers inherit by default, `deno.permissions` with `"inherit"`, `"none"` or an object. [^workers]
- [runtime/permissions/lib.rs at v2.9.8](https://github.com/denoland/deno/blob/v2.9.8/runtime/permissions/lib.rs) — Deno project, 2026. Rank 1. Backs: descriptor ordering, the "Most specific allow wins over less specific denies" tests. [^src-perms]
- [runtime/permissions/prompter.rs at v2.9.8](https://github.com/denoland/deno/blob/v2.9.8/runtime/permissions/prompter.rs) — Deno project, 2026. Rank 1. Backs: prompts need stdin and stderr to be terminals. [^src-prompter]

## Related
- `deno/security/permission-flags.md` — every flag, value syntax, `deno.json` permission sets, audit, trace and the broker.
- `deno/deno-lab-setup.md` — the container these runs used.
- `deno/runtime-apis/workers-kv-and-cron.md` — the Worker API.
- `deno/runtime-apis/files-processes-and-environment.md` — `Deno.Command`, file and env APIs.
- `deno/node-compat/node-and-npm-compatibility.md` — npm packages and lifecycle scripts.
- `deno/testing/testing-and-mocking.md` — per-test permissions.
- `deno/advanced/compile-and-distribution.md` — permissions in compiled executables.
