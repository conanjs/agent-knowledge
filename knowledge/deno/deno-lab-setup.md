---
schema: knowledge-doc/v1
type: how-to
topic: deno
status: verified
applies-to: ["Deno 2.9.8", "denoland/deno:alpine-2.9.8 Docker image", "macOS with OrbStack or Docker Desktop, or any Linux host with Docker"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [deno, lab, docker, permissions, no-color, deno-dir]
ranked-sources: true
---

# Set up the Deno 2.9 lab the `deno/` docs were measured in

## Summary
**TL;DR:** Run every Deno experiment in a throwaway container from the official image `denoland/deno:alpine-2.9.8`, with the probe folder mounted at `/lab` and `NO_COLOR=1` so error text is plain. Nothing is installed on the host, the version is pinned by the tag, and `--rm` throws away the dependency cache, so each run starts clean. Every output marked "measured in the lab" in the `deno/` docs came from this setup on 2026-11-24.
**Use this when:** you want to re-run an example from the `deno/` docs, or check whether a behaviour changed in a newer Deno.
**Not this doc:** what each example shows → the doc that quotes it; what to learn first → `deno/learning-path.md`.

## Goal & prerequisites
**End state:** `deno --version` inside the container prints `deno 2.9.8`, and a script that reads an environment variable fails until you grant `--allow-env`.

**Needs:**
- A Docker CLI with a running engine (the reference run: OrbStack on macOS, Docker Engine 29.8.2, arm64) ✅[^run].
- Network access once, to pull the image (99 MB unpacked on arm64; about 50 MB compressed for amd64) ✅[^run], and again for any example that imports `jsr:` or `npm:` packages.

## Steps
1. **Pull the pinned image.** The official images come in Alpine, Debian (the default), distroless, Ubuntu and binary-only variants ✅[^docker]; the lab uses Alpine.
   ```console
   $ docker pull denoland/deno:alpine-2.9.8
   ```
2. **Make a probe folder** and put the example in it, for example `env.ts`:
   ```ts
   console.log(Deno.version);
   console.log(Deno.build.target);
   console.log(Deno.env.get("HOME"));
   ```
3. **Run it in a throwaway container**, with the folder at `/lab` and colours off. `NO_COLOR` disables coloured output ✅[^envvars]:
   ```console
   $ docker run --rm -e NO_COLOR=1 -v "$PWD:/lab" -w /lab denoland/deno:alpine-2.9.8 deno run env.ts
   ```
4. **Grant only what the example needs.** Without a flag the third line fails; with `--allow-env=HOME` it prints the home folder ✅[^run]:
   ```console
   $ docker run --rm -e NO_COLOR=1 -v "$PWD:/lab" -w /lab denoland/deno:alpine-2.9.8 deno run --allow-env=HOME env.ts
   ```
5. **Run as the non-root `deno` user when the example writes files or depends on the user.** The image starts as `root` (user ID, uid, 0) unless told otherwise; the image also ships a `deno` user (uid 1000) ✅[^run], and the upstream example Dockerfile switches to it ✅[^docker]:
   ```console
   $ docker run --rm --user deno -e NO_COLOR=1 -v "$PWD:/lab" -w /lab denoland/deno:alpine-2.9.8 deno run --allow-env env.ts
   ```
6. **Add `-e DENO_NO_UPDATE_CHECK=1` when the run must stay offline or touch only named hosts.** The variable turns off Deno's check for a newer version ✅[^envvars], so the container does not contact Deno's download host on its own.
7. **Use `sh -c '…'` to chain several commands in one container**, so a cache filled by the first command (`deno install`, `deno cache`) is still there for the next.

## Verify
| Check | Expected output (reference run, 2026-11-24) |
|---|---|
| `deno --version` | `deno 2.9.8 (stable, release, aarch64-unknown-linux-gnu)`, `v8 15.0.245.2-rusty`, `typescript 6.0.3` ✅[^run] |
| `cat /etc/alpine-release` | `3.24.2` ✅[^run] |
| `deno run env.ts` (no flags) | the version object and target print, then `error: Uncaught (in promise) NotCapable: Requires env access to "HOME", run again with the --allow-env flag`, exit code 1 ✅[^run] |
| `deno run --allow-env=HOME env.ts` as root | `/root`, exit code 0 ✅[^run] |
| the same with `--user deno` | `/home/deno` ✅[^run] |
| `deno info` | `DENO_DIR location: /deno-dir/`, with `remote`, `npm` and `gen` caches below it ✅[^run] |
| `deno eval 'console.log(Deno.permissions.querySync({name:"env"}).state)'` | `granted`: unlike `deno run`, `deno eval` runs with all permissions ✅[^run] ✅[^eval] |

## Troubleshooting
| Symptom | Cause | Fix |
|---|---|---|
| Error text full of `[0m[31m` sequences when captured to a file | Deno colours its output | Pass `-e NO_COLOR=1` ✅[^envvars] |
| `^[[4m` (underline) and `^[[3m` (italic) codes remain in `info:` and `hint:` lines even with `NO_COLOR=1`, for example after `require is not defined` in a `.js` file | In 2.9.8 those hint lines keep their underline and italic styling ✅[^run]; after a failed `deno run --check`, the `info:` and `hint:` labels also keep their colours (`^[[33m`, `^[[36m`) ✅[^run] | Strip them when quoting: `… 2>&1 \| sed 's/\x1b\[[0-9;]*m//g'` |
| A permission check passes that should fail | The example ran under `deno eval`, which grants every permission ✅[^eval] | Put the code in a file and use `deno run` |
| A second `docker run` downloads the same packages again | `--rm` deleted the container and its `DENO_DIR` (`/deno-dir/`) ✅[^run] | Chain the commands in one `sh -c`, or mount a cache folder at `/deno-dir` |
| The script waits forever for input after `docker run -it` | It hit a permission prompt: on a terminal, with no flag passed, Deno asks instead of failing ✅[^security]. Which streams must be terminals for a prompt is measured in `deno/security/permission-model.md` | Pass the flag, or `--no-prompt` to fail at once |
| `HOME` or file ownership differs from a doc | The run used the other user (root versus `deno`) ✅[^run] | Match the doc's `--user` setting |

## Rollback
```console
$ docker image rm denoland/deno:alpine-2.9.8
```
Nothing else is left behind: each container was started with `--rm`.

## Takeaways
- Pin the image tag (`alpine-2.9.8`), never `latest`, so a measured output stays tied to one Deno version. [rule-candidate]
- Run probes with `deno run` and explicit flags, never `deno eval`, when the permission outcome matters.

## Verification status
- Verified: 23 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- Commands run on 2026-11-24 with `denoland/deno:alpine-2.9.8` (Deno 2.9.8, V8 15.0.245.2-rusty, TypeScript 6.0.3, Alpine 3.24.2, aarch64) on OrbStack, Docker Engine 29.8.2; outputs as quoted in Goal, Steps, Verify and Troubleshooting. [^run]
- [denoland/deno_docker](https://github.com/denoland/deno_docker) — Deno project, living. Rank 1. Backs: image variants, the `deno` user in the example Dockerfile. [^docker]
- [deno eval](https://docs.deno.com/runtime/reference/cli/eval/) — Deno project, living. Rank 1. Backs: `deno eval` runs with all permissions by default. [^eval]
- [Environment variables](https://docs.deno.com/runtime/reference/env_variables/) — Deno project, living. Rank 1. Backs: `NO_COLOR`, `DENO_NO_UPDATE_CHECK`. [^envvars]
- [Security and permissions](https://docs.deno.com/runtime/fundamentals/security/) — Deno project, living. Rank 1. Backs: on a terminal, with no flag passed, Deno prompts instead of failing. [^security]

## Related
- `deno/learning-path.md` — the order to read the `deno/` docs in.
- `deno/security/permission-model.md` — what each permission flag allows.
- `linux/lab-setup.md` — the Linux container lab used by other topics.
