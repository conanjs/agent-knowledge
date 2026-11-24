---
schema: knowledge-doc/v1
type: reference
topic: deno/security
status: verified
applies-to: ["Deno 2.9.8"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [deno, security, permissions, cli-flags, allow-read, allow-net, allow-env, allow-import, deny-flags, ignore-env, permission-set, deno-json, audit, trace, permission-broker]
ranked-sources: true
---

# Deno permission flags, permission sets, audit variables and the permission broker

## Summary
**TL;DR:** Deno 2.9.8 has nine grant flags (`--allow-read/-R`, `--allow-write/-W`, `--allow-net/-N`, `--allow-env/-E`, `--allow-sys/-S`, `--allow-run`, `--allow-ffi`, `--allow-import/-I`, `--allow-all/-A`), eight `--deny-*` flags, `--ignore-env` and `--ignore-read`, plus `--no-prompt`, `-P`/`--permission-set` and `--allow-scripts`. Each list flag takes comma-separated values; bare, it covers the whole category. Named permission sets in `deno.json` load only with `-P`. `DENO_AUDIT_PERMISSIONS` logs every check as JSON (JavaScript Object Notation) lines, `DENO_TRACE_PERMISSIONS=1` adds stack traces, and `DENO_PERMISSION_BROKER_PATH` hands every decision to an outside process.
**Use this when:** writing a permission flag or value, checking what a value matches, setting up `permissions` in `deno.json`, reading an audit log, or building a permission broker.
**Not this doc:** how grants, denies and prompts combine, the `Deno.permissions` API (application programming interface) and why `--allow-run` equals `-A` → `deno/security/permission-model.md`; the rest of `deno.json` → `deno/configuration/deno-json-reference.md`; every other CLI flag → `deno/toolchain/cli-subcommands.md`.

## Scope
Every option in the "Permission options" block of `deno run --help` in Deno 2.9.8, plus `--allow-scripts` from the same help page, with their value syntax and what each value matched in the lab. `deno test --help` shows the same block ✅[^run]. Also: the `permissions` key of `deno.json` (Deno 2.5+ ✅[^denojson]), the four permission environment variables, the audit record and the broker message format. Measured in `denoland/deno:alpine-2.9.8` on Linux; Windows-only behaviour is taken from the docs.

## Catalog

### Grant flags
| Flag | Short | Value list | With no flag | Measured example |
|---|---|---|---|---|
| `--allow-read[=<PATH>...]` | `-R` ✅[^run] | Files or folders; a folder covers everything below it ✅[^perm-ref] | Refused, except the static module graph and `node_modules/` ✅[^perm-ref] | `--allow-read=/lab/data` read `/lab/data/secret/s.txt`, refused `/etc/hostname` ✅[^run] |
| `--allow-write[=<PATH>...]` | `-W` ✅[^run] | Same as read ✅[^perm-ref] | Refused ✅[^run] | `--allow-write=/tmp` wrote `/tmp/w.txt` but could not read it back ✅[^run] |
| `--allow-net[=<IP_OR_HOSTNAME>...]` | `-N` ✅[^run] | Hosts, see Value syntax | Refused, including DNS (Domain Name System) lookups and listening ✅[^perm-ref] | `--allow-net=localhost:8000` fetched port 8000, refused 8001 ✅[^run] |
| `--allow-env[=<VARIABLE_NAME>...]` | `-E` ✅[^run] | Names or suffix wildcards ✅[^perm-ref] | Refused, except `NO_COLOR` ✅[^perm-ref] ✅[^run] | `--allow-env='FOO_*'` read `FOO_A`, set `FOO_NEW`, refused `BAR` and `Deno.env.toObject()` ✅[^run] |
| `--allow-sys[=<API_NAME>...]` | `-S` ✅[^run] | `sys` names, see below | Refused ✅[^perm-ref] | `--allow-sys=hostname` allowed `Deno.hostname()`, refused `Deno.osRelease()` ✅[^run] |
| `--allow-run[=<PROGRAM_NAME>...]` | none ✅[^run] | Program names ✅[^perm-ref] | Refused ✅[^run] | `--allow-run=echo` ran `echo` and `/bin/echo`, refused `cat` ✅[^run] |
| `--allow-ffi[=<PATH>...]` | none; help marks it "(Unstable)" ✅[^run] | Library files or folders ✅[^perm-ref] | Refused ✅[^run] | `--allow-ffi=/usr/lib` refused `/lib/libc.musl-aarch64.so.1` ✅[^run] |
| `--allow-import[=<IP_OR_HOSTNAME>...]` | `-I` ✅[^run] | Hosts with optional port; a list replaces the defaults ✅[^perm-ref] | The default host list below ✅[^run] | `--allow-import=example.com` made `jsr:@std/path@1` fail ✅[^run] |
| `--allow-all` | `-A` ✅[^run] | none | — | `-A --deny-read=/etc` read everything except `/etc` ✅[^run] |

### Deny and ignore flags
| Flag | Value list | Effect | Measured example |
|---|---|---|---|
| `--deny-read[=<PATH>...]` | Paths | Refuse; bare, refuse all reads and never prompt for them ✅[^perm-ref] | `--allow-read=/lab/data --deny-read=/lab/data/secret` refused `secret/s.txt`, read the rest of `/lab/data` ✅[^run] |
| `--deny-write[=<PATH>...]` | Paths | Same, for writes ✅[^perm-ref] | — |
| `--deny-net[=<IP_OR_HOSTNAME>...]` | Hosts | Refuse those hosts ✅[^perm-ref] | `--allow-net --deny-net=10.0.0.0/8`: `10.1.2.3` denied, `11.0.0.1` granted ✅[^run] |
| `--deny-env[=<VARIABLE_NAME>...]` | Names | Refuse those variables ✅[^perm-ref] | `--allow-env --deny-env=FOO_B` refused only `FOO_B` ✅[^run] |
| `--deny-sys[=<API_NAME>...]` | `sys` names | Refuse those calls ✅[^perm-ref] | — |
| `--deny-run[=<PROGRAM_NAME>...]` | Names | Refuse those programs ✅[^perm-ref] | `--allow-run --deny-run=cat` refused `cat` and also `LD_PRELOAD` spawns ✅[^run] |
| `--deny-ffi[=<PATH>...]` | Paths; "(Unstable)" in help | Refuse those libraries ✅[^run] | — |
| `--deny-import[=<IP_OR_HOSTNAME>...]` | Hosts | Refuse those import hosts ✅[^perm-ref] | `--deny-import=jsr.io:443` blocked `jsr:` imports; `--deny-import=jsr.io` did not ✅[^run] |
| `--ignore-env[=<VARIABLE_NAME>...]` | Names | Reads return `undefined` instead of throwing ✅[^perm-ref] | `--allow-env='FOO_*' --ignore-env=BAR`: `BAR` read as `undefined` ✅[^run] |
| `--ignore-read[=<PATH>...]` | Paths | Reads throw `NotFound` instead of `NotCapable` ✅[^run] | `--ignore-read=/lab/data`: `NotFound: No such file or directory (os error 2)` ✅[^run] |

### Run-wide options
| Option | Effect | Measured |
|---|---|---|
| `--no-prompt` | "Always throw if required permission wasn't passed" ✅[^run] | On a terminal, failed at once with `NotCapable` ✅[^run] |
| `-P, --permission-set[=<NAME>]` | Load a set from the config file; bare `-P` loads `default` ✅[^run] ✅[^denojson] | Prints `Warning Permissions in the config file is an experimental feature and may change in the future.` ✅[^run] |
| `--allow-scripts[=<PACKAGE>...]` | Run npm lifecycle scripts for the named packages, only with a `node_modules` folder ✅[^run] ✅[^perm-ref] | Help text only; not run (no npm package with a lifecycle script was installed in the lab) |
| `--unstable-worker-options` | Enables the `deno.permissions` option of `new Worker` ✅[^run] | Without it: ``Unstable API 'Worker.deno.permissions'. The `--unstable-worker-options` flag must be provided.``, exit code 70 ✅[^run] |
| `--allow-hrtime`, `--deny-hrtime` | Removed in Deno 2 ✅[^run] | ``Warning `allow-hrtime` and `deny-hrtime` have been removed in Deno 2, as high resolution time is now always allowed``, then the script ran ✅[^run] |

### Value syntax
| Kind | Written as | Matched in the lab ✅[^run] |
|---|---|---|
| Path | Absolute, or relative to the current folder; comma-separated | With cwd `/lab`, `--allow-read=data` allowed `data/root.txt` and `/lab/data/root.txt`, refused `./data/../each.ts` |
| Comma inside a path | Doubled, per the docs (`this file,, contains a comma.txt`) ✅[^perm-ref] | `--allow-read=/tmp/a,,b` → `error: Empty path is not allowed` |
| Host | `name` (all ports) or `name:port` ✅[^perm-ref] | `localhost` allowed 8000 and 8001; `localhost` and `127.0.0.1` are separate entries |
| Subdomain wildcard | `*.example.com` ✅[^perm-ref] | Granted `example.com`, `a.example.com`, `a.b.example.com` |
| IPv4 | `10.0.0.1`, `1.1.1.1:443` ✅[^perm-ref] | `10.0.0.1` granted `10.0.0.1:22`; `10.0.0.2` stayed `prompt` |
| IPv6 | In brackets, `[::1]:8080` ✅[^perm-ref] | `[::1]:8080` granted, `[::1]:9090` `prompt` |
| CIDR (Classless Inter-Domain Routing) range | `10.0.0.0/8` | Granted `10.1.2.3` and `10.255.255.255`, not `11.0.0.1` |
| Unix socket | `unix:<absolute-path>` ✅[^run] | `unix:/tmp/a.sock` (plus read and write on `/tmp`) allowed listening there, refused `/tmp/b.sock`; without the read grant: `Requires read access to "/tmp/a.sock"` |
| Environment variable | `HOME`, or suffix wildcard `AWS_*` (Deno 2.1+); matched case-insensitively on Windows only ✅[^perm-ref] | `FOO_*` matched `FOO_A`, `FOO_B` |
| Program | A name; a path also matched | `--allow-run=echo` and `--allow-run=/bin/echo` each allowed both `echo` and `/bin/echo` |
| Import host | `host[:port]` | `--deny-import=esm.sh` denied `esm.sh` but left `esm.sh:443` granted |

### `sys` names
| Name | Gates (examples) |
|---|---|
| `hostname`, `osRelease`, `osUptime`, `loadavg`, `networkInterfaces`, `systemMemoryInfo`, `uid`, `gid`, `cpus`, `homedir` | The matching `Deno` functions and their `node:os` / `node:process` twins, such as `os.cpus()` → `cpus` ✅[^perm-ref] ✅[^run] |
| `username` | Accepted as an alias of `userInfo` ✅[^src-perms]; `--allow-sys=username` made `userInfo` `granted` ✅[^run] |
| `inspector`, `getegid`, `statfs`, `getPriority`, `setPriority`, `userInfo`, `setegid`, `seteuid`, `setgid`, `setuid`, `ca`, `umask` | Also accepted by the 2.9.8 parser ✅[^src-perms] |
| Any other word | `error: unknown sys descriptor: 'foo'`, exit code 1 ✅[^run] |

### Default import hosts
| Source | Value |
|---|---|
| `deno run --help`, "Default value" of `-I` ✅[^run] | `deno.land:443,jsr.io:443,esm.sh:443,raw.esm.sh:443,cdn.jsdelivr.net:443,raw.githubusercontent.com:443,gist.githubusercontent.com:443` |
| `npm:` specifiers | Always allowed ✅[^perm-ref] |

### Permission sets in `deno.json`
| Item | Form | Measured ✅[^run] |
|---|---|---|
| `permissions` | Object: set name → set; set keys are `read`, `write`, `net`, `env`, `sys`, `run`, `ffi`, `import` ✅[^denojson] | — |
| Value: boolean | `true` allows, `false` denies ✅[^denojson] | `"env": true` granted all env |
| Value: array | Paths, hosts, names ✅[^denojson] | `"read": ["./data"]` read `data/secrets/k.txt` |
| Value: string | Shown in a docs example (`"read": "./data"`) ✅[^denojson] | `error: Failed to parse "permissions" configuration` … `data did not match any variant of untagged enum AllowDenyIgnorePermissionConfigValue` |
| Value: object | `allow`, `deny`, and for `read` and `env` only `ignore` ✅[^denojson] | `deny` → `NotCapable`; read `ignore` → `NotFound`; env `ignore` → `undefined` |
| `"default"` set | Used by a bare `-P` ✅[^denojson] | Applied the object-form rules above |
| `-P=<name>` | Named set ✅[^denojson] | `-P=missing` → `error: Could not find permission set 'missing' in deno.json`, exit 1 |
| `-P` plus flags | — | `-P=envonly --allow-read` granted both env and read |
| No `-P` | Sets not loaded, not even `default` ✅[^denojson] | All operations `NotCapable` |
| `test.permissions`, `bench.permissions`, `compile.permissions` | A set object or a set name ✅[^denojson] | `deno test` without `-P`: `error: Test permissions were found in the config file. Did you mean to run with \`-P\` or a permission flag?` |
| Workspaces | Test and bench files use the closest `deno.json` ✅[^denojson] | — |

### Environment variables
| Variable | Value | Effect | Measured ✅[^run] |
|---|---|---|---|
| `DENO_NO_PROMPT` | Set to anything | Same as `--no-prompt` ✅[^envvars] | `DENO_NO_PROMPT=1` on a terminal: immediate `NotCapable` |
| `DENO_TRACE_PERMISSIONS` | `1` | Stack traces in prompts; off by default for speed ✅[^envvars] ✅[^perm-ref] | Prompt gained `┃  ├─ Object.readTextFileSync (ext:deno_fs/30_fs.js:1:9859)` and `┃  └─ file:///lab/twice.ts:2:18`; audit records gained `stack` |
| `DENO_AUDIT_PERMISSIONS` | A file path, or `otel` | One JSON line per permission check, allowed or refused; `otel` sends OpenTelemetry log records via `OTEL_DENO` ✅[^envvars] ✅[^perm-ref] | Lines as in the next table; `otel` not run |
| `DENO_PERMISSION_BROKER_PATH` | Unix socket path, or a Windows named pipe ✅[^broker] | Every check goes to the broker ✅[^broker] | Prints `Warning Permission broker is an experimental feature` |

### Audit record (`DENO_AUDIT_PERMISSIONS=<file>`)
| Field | Type | Meaning | Measured value ✅[^run] |
|---|---|---|---|
| `v` | number | Format version ✅[^audit-schema] | `1` |
| `datetime` | string, RFC (Request for Comments) 3339 | When the check happened ✅[^perm-ref] | `"2026-11-24T08:43:02Z"` |
| `permission` | string | Permission name ✅[^perm-ref] | `"read"`, `"env"` |
| `value` | string or `null` | The checked value ✅[^perm-ref] | `"/lab/data/root.txt"`, `"HOME"` |
| `stack` | array of strings | Only with `DENO_TRACE_PERMISSIONS` ✅[^audit-schema] | `["Object.readTextFileSync (ext:deno_fs/30_fs.js:1:9859)","file:///lab/audit.ts:1:6"]` |

### Permission broker protocol
| Part | Content |
|---|---|
| Transport | Unix domain socket or Windows named pipe at `DENO_PERMISSION_BROKER_PATH` ✅[^broker] |
| Framing | One JSON object per line, each way ✅[^src-broker] |
| Request fields | `v`, `pid`, `id` (rises by one per request), `datetime`, `permission`, `value` ✅[^broker] ✅[^broker-req] |
| Request seen in the lab | `{"v":1,"pid":17,"id":2,"datetime":"2026-11-24T08:46:47.588063129+00:00","permission":"read","value":"/etc/hostname"}` ✅[^run] |
| Response fields | `id` (must echo the request), `result` (`"allow"` or `"deny"`), optional `reason` ✅[^broker] ✅[^broker-res] |
| `reason` | Replaces the default error text ✅[^broker-res]; lab: `NotCapable: broker says no to read` ✅[^run] |
| Flags and prompts | All `--allow-*`/`--deny-*` flags ignored, no prompts ✅[^broker]; lab: `-A` did not stop a broker `deny` ✅[^run] |
| Failure | Deno ends the process ✅[^broker]; exit code 87 in 2.9.8 ✅[^src-broker] ✅[^run] |
| Failure texts seen | No listener: `Failed to create permission broker: Os { code: 2, kind: NotFound, message: "No such file or directory" }`; wrong `id`: `Permission broker response ID mismatch` ✅[^run] |

## Lookup notes
- **Allow versus deny:** a narrower allow beats a broader deny, and deny wins only ties; the full table is in `deno/security/permission-model.md`. That is why `--deny-import=jsr.io` (any port) loses to the built-in `jsr.io:443` and needs the port ✅[^run].
- **Short forms:** the docs page lists `-R -W -N -E -S -A` ✅[^perm-ref]; `-I` for `--allow-import` and `-P` appear in the 2.9.8 help ✅[^run]. `--allow-run` and `--allow-ffi` have none.
- **Bare `-I`** grants every host, not only the defaults: `example.com` became `granted` ✅[^run].
- **The import list guards static imports too:** a static `import "https://example.com/x.ts"` with no flags stopped at `Requires import access to "example.com:443"` ✅[^run], although the security page exempts the static graph from permission checks; the comparison is in `deno/security/permission-model.md`.
- **Comma escaping** as documented failed in 2.9.8 (`Empty path is not allowed`) ✅[^run] ✅[^perm-ref]; rename such folders instead.
- **Config `deny` error class:** the `deno.json` page says a config deny throws `PermissionDenied` ✅[^denojson]; 2.9.8 threw `NotCapable` ✅[^run].
- **String values in `deno.json`:** the docs example `"read": "./data"` does not parse in 2.9.8; use `["./data"]` ✅[^run].
- **`deno test` error text** in 2.9.8 adds "or a permission flag" to the docs' version ✅[^denojson] ✅[^run].
- **Audit log limits:** no field says allowed or refused; `query` and `revoke` calls are not logged; under `-A` each read also logged a `write` record for the same path ✅[^run].
- **`DENO_TRACE_PERMISSIONS` without a terminal** did not change the uncaught `NotCapable` text ✅[^run]; it shows in prompts and audit records.
- **Broker documentation:** `DENO_PERMISSION_BROKER_PATH` is on the security page, not the environment-variables page ✅[^envvars]; exit code 87 is undocumented, and the source comment calls it "currently randomly selected" ✅[^src-broker].
- **`--allow-env` with a list** cannot use `Deno.env.toObject()`: `Requires env access, run again with the --allow-env flag` ✅[^run].

## Takeaways
- Write every value in its most specific form: hosts with ports (`jsr.io:443`), absolute paths, exact program names. [rule-candidate]
- Keep repeated flag sets in `deno.json` `permissions` and run with `-P`, using array values, not strings, in 2.9.8.
- Set `DENO_AUDIT_PERMISSIONS` (with `DENO_TRACE_PERMISSIONS=1` for call sites) when working out the minimum grants a program needs, then turn the log into scoped flags.
- Treat a permission broker as part of the trusted base: if it fails, every Deno process using it exits with code 87.

## Verification status
- Verified: 136 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- Commands run on 2026-11-24 with `denoland/deno:alpine-2.9.8` (Deno 2.9.8, V8 15.0.245.2-rusty, TypeScript 6.0.3, Alpine 3.24.2, aarch64) in the lab of `deno/deno-lab-setup.md`, including `deno run --help` and `deno test --help`, a toy broker on a Unix socket, and prompts through a pseudo-terminal; outputs as quoted in Scope, Catalog and Lookup notes. [^run]
- [Permissions](https://docs.deno.com/runtime/reference/permissions/) — Deno project, living (page dated 2026-07-21). Rank 1. Backs: flag meanings, value syntax, defaults, short forms, `sys` names, default import hosts, comma escaping, `--ignore-env`, audit fields and `otel`, trace cost. [^perm-ref]
- [Configuration file (deno.json): permissions](https://docs.deno.com/runtime/reference/deno_json/#permissions) — Deno project, living. Rank 1. Backs: permission sets, value forms, `default`, `-P`, `allow`/`deny`/`ignore`, test/bench/compile permissions, explicit opt-in. [^denojson]
- [Environment variables](https://docs.deno.com/runtime/reference/env_variables/) — Deno project, living. Rank 1. Backs: `DENO_NO_PROMPT`, `DENO_TRACE_PERMISSIONS`, `DENO_AUDIT_PERMISSIONS`; no broker entry. [^envvars]
- [Security and permissions: permission broker](https://docs.deno.com/runtime/fundamentals/security/#permission-broker) — Deno project, living (target of `docs.deno.com/go/permission-broker`). Rank 1. Backs: `DENO_PERMISSION_BROKER_PATH`, message fields, flags ignored, termination on failure. [^broker]
- [runtime/permissions/broker.rs at v2.9.8](https://github.com/denoland/deno/blob/v2.9.8/runtime/permissions/broker.rs) — Deno project, 2026. Rank 1. Backs: line framing, exit code 87. [^src-broker]
- [runtime/permissions/lib.rs at v2.9.8](https://github.com/denoland/deno/blob/v2.9.8/runtime/permissions/lib.rs) — Deno project, 2026. Rank 1. Backs: the full `sys` name list and the `username` alias. [^src-perms]
- [permission-audit.v1.json at v2.9.8](https://github.com/denoland/deno/blob/v2.9.8/cli/schemas/permission-audit.v1.json) — Deno project, 2026. Rank 1. Backs: audit fields `v` and `stack`. [^audit-schema]
- [permission-broker-request.v1.json at v2.9.8](https://github.com/denoland/deno/blob/v2.9.8/cli/schemas/permission-broker-request.v1.json) — Deno project, 2026. Rank 1. Backs: request fields. [^broker-req]
- [permission-broker-response.v1.json at v2.9.8](https://github.com/denoland/deno/blob/v2.9.8/cli/schemas/permission-broker-response.v1.json) — Deno project, 2026. Rank 1. Backs: response fields, `reason` replaces the error text. [^broker-res]

## Related
- `deno/security/permission-model.md` — how the flags combine, prompts and the permissions API.
- `deno/configuration/deno-json-reference.md` — every other `deno.json` key.
- `deno/toolchain/cli-subcommands.md` — all subcommands and their non-permission flags.
- `deno/testing/testing-and-mocking.md` — per-test permissions.
- `deno/advanced/debugging-profiling-and-telemetry.md` — OpenTelemetry, where `DENO_AUDIT_PERMISSIONS=otel` sends records.
