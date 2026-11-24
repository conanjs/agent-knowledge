---
schema: knowledge-doc/v1
type: concept
topic: deno/toolchain
status: verified
applies-to: ["Deno 2.9.8", "deno_task_shell as bundled in Deno 2.9.8"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [deno, deno-task, task-runner, deno_task_shell, cross-platform-shell, package-json-scripts, task-dependencies, task-cache, workspaces]
ranked-sources: true
---

# `deno task` and its built-in cross-platform shell

## Summary
**TL;DR:** `deno task <name>` runs a named command string from `deno.json` `tasks` (or, as a fallback, `package.json` `scripts`) in the folder of the config file. A task can be a string or an object with `command`, `description`, `dependencies` and the cache keys `files`, `output`, `env`; dependencies run first, siblings in parallel, a shared one once. The string is run by Deno's own small shell (`deno_task_shell`), not by `sh` or `cmd.exe`, so `&&`, pipes, redirects, globs and about twenty built-in commands (`cp`, `rm`, `mkdir`, `echo`, …) behave the same on every operating system (OS), while `if`, loops, functions and heredocs are refused before anything runs.
**Use this when:** writing or debugging tasks in `deno.json`, porting `package.json` scripts, ordering build steps, or a task works on one machine and fails on another.
**Not this doc:** every other subcommand → `deno/toolchain/cli-subcommands.md`; running tasks across many packages → `deno/configuration/workspaces-and-monorepos.md`; the `deno.json` file itself → `deno/configuration/deno-json-reference.md`.

## Problem
A project script written for one machine's shell relies on that shell and on the programs installed there; Deno's answer is a shell of its own whose built-in commands "work the same out of the box on Windows, Mac, and Linux" ✅[^task]. Build steps that must happen in order are chained with `&&` by hand, which runs independent steps one after another and repeats shared steps. Without knowing which shell runs a task, a reader cannot tell why `if` fails, why `echo -n` prints `-n`, or why a binary in `node_modules/.bin` is "not found".

## Mental model
**Analogy:** a recipe box with a kitchen helper. The box (`tasks`) holds named recipe cards. The helper (`deno task`) reads a card, first makes the sub-recipes it "depends on" (several at once when its hands are free, each only once), then follows the card using its own portable toolkit (the task shell and its built-in commands) that works the same in any kitchen.

| Term | Plain-English meaning | Concrete artifact |
|---|---|---|
| Task | A named command line stored in the project | `"shared": "deno run stamp.ts shared 200"` |
| Object form | A task card with extra fields | `{ "command": "…", "dependencies": ["shared"], "description": "…" }` |
| Dependency | A task that must finish before this one starts | `"dependencies": ["dep-a", "dep-b"]` |
| Task shell | Deno's built-in interpreter for the command string, a subset of `sh` | `deno task --eval "echo hi && pwd"` prints `hi`, `/lab/task` |
| Built-in command | A command the shell implements itself, so it needs no program on `PATH` | `cp`, `rm`, `mkdir` with `PATH=/nonexistent` still work |
| Task cache | A memory of input fingerprints that lets an unchanged task be skipped | `"files": ["src/*.txt"], "output": ["out.txt"]` |

**Artifact:** the `deno.json` used for the runs below (helper `stamp.ts` prints its name and a millisecond clock at start and end, then sleeps the given time):
```json
{
  "tasks": {
    "shared": "deno run stamp.ts shared 200",
    "dep-a": { "command": "deno run stamp.ts dep-a 600", "dependencies": ["shared"] },
    "dep-b": { "command": "deno run stamp.ts dep-b 300", "dependencies": ["shared"] },
    "build": {
      "description": "Build after dep-a and dep-b",
      "command": "deno run stamp.ts build 0",
      "dependencies": ["dep-a", "dep-b"]
    },
    "test:unit": "echo unit", "test:e2e": "echo e2e", "test:lint": "echo lint",
    "cached": { "command": "echo running-cached && cat src/in.txt > out.txt", "files": ["src/*.txt"], "output": ["out.txt"] }
  }
}
```

## How it works
**4 actors, all local (no step crosses the network):**
- **`deno task` (the runner)** — its job: pick the tasks to run, via `deno.json` `tasks` then `package.json` `scripts`, and order them, via the `dependencies` graph.
- **The task cache** — its job: skip a task whose inputs did not change, via fingerprints stored under `$DENO_DIR/task_cache_v1`.
- **`deno_task_shell` (the shell)** — its job: parse and run one command string, via its own parser and built-in commands.
- **External programs** — their job: run any command that is not built in, via a lookup in `node_modules/.bin` and then `PATH`.

```
deno task build
  │ runner: find deno.json (walks up from the current folder), read "tasks"
  │ runner: resolve graph  build ← dep-a, dep-b ← shared   (cycle → error)
  ├─▶ shared            ── cache? no "files" key → run
  ├─▶ dep-a ∥ dep-b     ── up to --jobs at once, output prefixed [dep-a] / [dep-b]
  └─▶ build             ── only after both finish
        │ runner → stderr: "Task build deno run stamp.ts build 0"
        ▼
      shell: parse the whole string (unsupported syntax → error, nothing runs)
        ├─ built-in (cp, echo, …) → runs inside the Deno process
        └─ other word → node_modules/.bin (only with a package.json) → PATH
             (PATH starts with $DENO_DIR/node_compat_bin, so `node` is Deno)
      exit code of the string = exit code of the task
```

1. **Runner (local):**
   - Finds the config, via auto-detection: run from `sub/`, it used `/lab/task/deno.json` ✅[^run].
   - Looks the name up in `deno.json` `tasks` first, then `package.json` `scripts`; a name in both runs the `deno.json` one, and the listing marks package scripts `(package.json)` ✅[^run] ✅[^task].
   - Sets the working folder to the config file's folder and `INIT_CWD` to the folder you ran from (`cwd=/lab/task init=/lab/task/sub`); `--cwd sub` gives `cwd=/lab/task/sub` ✅[^run] ✅[^task].
2. **Runner, dependencies (local):**
   - Builds the graph and refuses cycles: `Task cycle detected: c1 -> c2 -> c1`, exit code 1 ✅[^run] ✅[^task].
   - Runs dependencies before the task, independent ones in parallel up to `--jobs` (`-j`, alias `--concurrency`, default: the number of CPUs, the processor cores; `DENO_JOBS` also sets it), and a dependency shared by two tasks once ✅[^run] ✅[^task] ✅[^v29].
   - A task with `dependencies` and no `command` only groups them; it prints `Task all (no command)` ✅[^run].
3. **Task cache (local):** only a task with a `files` key is cached. The fingerprint covers the command, extra arguments, the matched files' contents and the variables named in `env` ✅[^task] ✅[^v29]; the 2.9 post adds the dependencies' fingerprints, the OS, the CPU architecture and the Deno version ✅[^v29]. Second run: `Task cached … (cached, inputs unchanged)`; after `rm out.txt` a cached run restored `out.txt`; after editing `src/in.txt` it ran again ✅[^run].
4. **Runner → shell (local):** prints `Task <name> <command>` to stderr (with `>/dev/null` only that line remains), appends extra arguments shell-quoted (`deno task args one "two three"` shows `Task args echo got 'one' 'two three'` and prints `got one two three`) ✅[^run].
5. **Shell, parse (local):** parses the whole string first; any unsupported syntax fails with `error: Error parsing script ''.` and nothing runs (`echo before; echo $$` printed no `before`) ✅[^run] ✅[^parser].
6. **Shell, run (local):** built-ins run inside Deno; other commands are looked up in `node_modules/.bin`, then a dependency's `package.json` `bin`, then `PATH` ✅[^task]; `deno` itself was found even with `PATH=/nonexistent` ✅[^run]. The script's exit code becomes the task's (`exit 3` → exit code 3) ✅[^run].

### Where tasks come from, and selecting them
| Feature | Measured in 2.9.8 |
|---|---|
| `deno task` with no name | Prints `Available tasks:`, each command, `// <description>` and `depends on: …` ✅[^run] |
| Unknown name | `Task not found: nope`, then the list, exit 1; with `--if-present`: silent, exit 0 ✅[^run] ✅[^task] |
| Wildcard `deno task "test:*"` | Runs all three `test:` tasks in parallel, output prefixed `[test:unit]`, ` [test:e2e]` (names padded to align) ✅[^run] ✅[^task] |
| Exclusion group `"test:*(!e2e\|lint)"` | Runs only `test:unit` ✅[^run] ✅[^v29] |
| Exclusion without `*` (`"test:(!e2e)"`) | `error: task name filter 'test:(!e2e)' uses an exclusion group '(!...)' but has no wildcard '*' to exclude from` ✅[^run] |
| `--no-prefix` | Plain `unit`, `e2e`, `lint` lines ✅[^run] |
| `package.json` `scripts` | Run when no `deno.json` task matches; `npm_lifecycle_event`, `npm_package_name` are set (`event=pkg name=pkgdemo`), and are empty in a `deno.json` task ✅[^run] ✅[^task] |
| `pre<name>` / `post<name>` scripts | `deno task go` ran `prego`, `go`, `postgo` in order ✅[^run] |
| `--env-file` | Loads `.env` into the task (`echo $MSG` → `from-dotenv`) ✅[^run] ✅[^task] |
| `--eval "<cmd>"` | Runs a string as if it were a task ✅[^run] ✅[^task] |
| Workspace `-r` / `--members` / `-f <name>` | Root and members, members only, or the filtered members; prefix `[@lab/a#hi]` ✅[^run] ✅[^task]; workspace runs in depth → `deno/configuration/workspaces-and-monorepos.md` |

### Shell syntax
| Syntax | Example | Result |
|---|---|---|
| `&&`, `\|\|` | `true && false \|\| echo false-ran` | `false-ran` ✅[^run] |
| `;` | `echo a ; false ; echo $?` | `a`, `1` ✅[^run] |
| `&` (async) | `false & sleep 0.5 && echo after-async` | Nothing printed, exit 1: the first async failure stops the rest ✅[^run] ✅[^task] |
| Async opt-out | `false \|\| true & sleep 0.2 && echo after` | `after`, exit 0 ✅[^run] ✅[^task] |
| `\|`, `\|&` | `echo err >&2 \|& cat` | `err` (stderr piped too) ✅[^run] |
| `$(…)`, backticks | ``echo $(echo inner) `echo tick` `` | `inner tick` ✅[^run] |
| `!` | `! false && echo negated` | `negated` ✅[^run] |
| `( … )` subshell | `(cd .. && pwd) && pwd` | `/lab/shell`, then `/lab/shell/work` (the `cd` stayed inside) ✅[^run] |
| `>`, `>>`, `<`, `2>`, `&>` | `echo out > o.txt && echo more >> o.txt && cat < o.txt` | `out`, `more` ✅[^run] |
| `/dev/null` | `echo gone > /dev/null && echo kept` | `kept`, on every OS per the docs ✅[^run] ✅[^task] |
| `export V=x`, `V=x cmd`, `V=x` | `export FOO=bar && deno eval "…FOO…"` | Child sees `bar`; a plain `FOO=bar` stays in the shell ✅[^run] ✅[^task] |
| Globs `*`, `?`, `[ ]`, `**` | `echo *.ts` | `x1.ts x2.ts` ✅[^run] |
| `shopt` | `shopt` | `failglob off`, `globstar on`, `nullglob off` ✅[^run] |
| `shopt -s nullglob` | `echo "[" *.nomatch "]"` | `[ ]` ✅[^run] |
| `set -o pipefail` | `false \| echo piped; echo pipe-rc=$?` | `piped`, `pipe-rc=1` ✅[^run] |
| `set -e` / `set +e` | `set -e; false; echo not-reached` | Exit 1, nothing printed; after `set +e` the list continues ✅[^run] ✅[^v28] |
| `~` | `echo ~` | `/root` ✅[^run] |

### Built-in commands
All rows ran with `PATH=/nonexistent`, so no system program could have answered; `ls`, `type`, `which` and `tee` gave `<name>: command not found`, exit 127 ✅[^run]. The docs list `cp`, `mv`, `rm`, `mkdir`, `pwd`, `sleep`, `echo`, `cat`, `exit`, `head`, `export`, `unset`, `xargs` and `:` ✅[^task]; the source also registers `cd`, `set`, `shopt`, `test`, `true` and `false` ✅[^builtins].

| Command | Example | Output in 2.9.8 |
|---|---|---|
| `mkdir`, `echo`, `cat` | `mkdir -p a/b && echo hi > a/b/f.txt && cat a/b/f.txt` | `hi` ✅[^run] |
| `cp`, `mv`, `rm` | `cp a/b/f.txt g.txt && mv g.txt h.txt && cat h.txt && rm h.txt` | `hi`; `cp -r` copies a folder ✅[^run] |
| `pwd`, `cd` | `cd .. && pwd` | `/lab/shell` ✅[^run] |
| `head` | `head -n 2 ../probe.sh` | First 2 lines ✅[^run] |
| `export`, `unset` | `export FOO=bar && unset FOO && echo "[$FOO]"` | `[]` ✅[^run] |
| `xargs` | `echo one two \| xargs echo got` | `got one two` ✅[^run] |
| `sleep` | `sleep 0.2 && echo slept` | `slept` (fractions accepted) ✅[^run] |
| `:`, `true`, `false` | `: && echo colon-ok` | `colon-ok` ✅[^run] ✅[^v28] |
| `test` | `test -f ../deno.json && echo test-f-ok; test 1 -eq 2 \|\| echo test-eq-false` | `test-f-ok`, `test-eq-false` ✅[^run] |
| `exit` | `exit 3` | Exit code 3 ✅[^run] |
| `set`, `shopt` | See the syntax table | ✅[^run] |

### Not supported (exact errors)
Each parse error is printed under `error: Error parsing script ''.` and `Caused by:`, exit 1 ✅[^run] ✅[^parser].

| Input | Error |
|---|---|
| `if true; then echo yes; fi`, `for i in 1 2; do …; done` | `Unsupported reserved word.` ✅[^run] |
| `echo $$` (the source also refuses `$#`, `$*`) | `$$ is currently not supported.` ✅[^run] ✅[^parser] |
| `echo a > x.txt 2> y.txt` | `Multiple redirects are currently not supported.` ✅[^run] ✅[^task] |
| Heredoc `cat <<EOT` | `Expected redirect path. (line 1)` ✅[^run] |
| `echo ~nobody` | `Unsupported tilde expansion.` ✅[^run] |
| `f() { echo fn; }; f` | No parse error; runs words as commands: `f: command not found`, exit 127 ✅[^run] |
| `echo $((1+2))` | No arithmetic: read as `$( (1+2) )`, prints `1+2: command not found` and an empty line, exit 0 ✅[^run] |

## Worked example
`deno task build` with the Mental model's `deno.json`; times are milliseconds after `shared` started (raw clock values in the run: 28883 … 30126) ✅[^run]:

| Time (ms) | Event |
|---|---|
| 0 | `Task shared deno run stamp.ts shared 200`; `shared start` |
| 257 | `shared end` |
| 354, 357 | `[dep-a] dep-a start`, `[dep-b] dep-b start`: both start together |
| 695 | `[dep-b] dep-b end` |
| 1062 | `[dep-a] dep-a end` |
| 1205 | `Task build …`; `build start` (only after the slower dependency) |
| 1243 | `build end`, exit code 0 |

With `deno task -j 1 build` the same graph ran one task at a time: `shared` 0–238, `dep-a` 288–1013, `dep-b` 1258–1639, `build` at 1837 ms, so the run took about 0.6 s longer ✅[^run]. `shared` ran once in both runs although two tasks depend on it ✅[^run].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Unmatched glob `echo *.nomatch` | 2.9.8 prints `*.nomatch`, exit 0; `shopt -s failglob` turns it into `glob: no matches found '/lab/task2/*.nomatch' (run \`shopt -u failglob\` …)`, exit 1 ✅[^run] | The docs say "By default, `failglob` and `globstar` are enabled." ✅[^task], but `shopt` in 2.9.8 reported `failglob off` ✅[^run]. Set it explicitly when it matters |
| Binary in `node_modules/.bin` | Without a `package.json` next to it: `hello-bin: command not found`, exit 127; with one (even `{"name":"x"}`) it ran, and as JavaScript under Deno (`typeof Deno` was `object`) ✅[^run] | The docs only say the folder is searched ✅[^task]; the run shows the lookup needs a `package.json` |
| `node` inside a task | Runs Deno's shim: `node -e "console.log(typeof Deno, process.version)"` → `object v26.5.1`; `node --version` prints `deno 2.9.8 …`; inside it `env` and `write` permissions queried as `granted`; `PATH` starts with `/deno-dir/node_compat_bin` ✅[^run] | A script started as `node` runs with every permission; `DENO_DISABLE_NODE_SHIM=1` removes the shim (`node: command not found`) ✅[^run] ✅[^v29] |
| `echo -n x` | Prints `-n x` ✅[^run] | The built-in `echo` takes no options; use `deno eval` or `printf` from `PATH` |
| `deno task -f a` in a workspace of `@lab/a`, `@lab/b` | Selected both members; `-f lab` too; `-f @lab/a` and `-f "*/b"` selected one; `-f pkgs/b` none ✅[^run] | A filter without `*` matched names that contain the text; no match prints `No matching task or script 'hi' found in selected packages.` with exit 0 ✅[^run] |
| `-j 1` | Still prefixes `[dep-a]` lines ✅[^run] | Prefixes mark tasks that could run in parallel |
| A dependency fails | `fail` exited 2 while its sibling `slow` (800 ms) was running: `deno task top` stopped at once with exit code 2, `slow` never printed its end line and `top` did not run ✅[^run] | A failed dependency ends the whole run; add `\|\| true` to a step that may fail harmlessly |
| Extra arguments after a redirect | `deno task cached extra` became `echo ran > out.txt 'extra'` and failed: `extra: command not found`, exit 127 ✅[^run] | Arguments are appended to the end of the string, not to the first command |
| `**` glob on a big tree | Can hit "Argument list too long", since it also walks `node_modules` ✅[^task] | Prefer `exclude` in `deno.json` for `deno fmt`/`deno check` |
| Shell options in nested `deno task` | Do not carry over ✅[^task] | Each `deno task` starts a fresh shell |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Task shell (default) | Same behaviour on Windows, macOS, Linux; no `sh` needed | No `if`, loops, functions, heredocs, `$$` |
| `sh -c '…'` inside a task | Full POSIX (Portable Operating System Interface) shell ✅[^task] | Not portable to Windows; needs `sh` on `PATH` |
| `dependencies` instead of `a && b` | Parallel, de-duplicated, cycle-checked | Sibling output interleaves (prefixed lines) |
| `files`/`output` caching | Skips unchanged work | Only listed inputs count: editing `other.md`, outside `files`, still gave `(cached, inputs unchanged)` ✅[^run]; the cache lives in `DENO_DIR` |

## Takeaways
- Put cross-step ordering in `dependencies`, not long `&&` chains, so independent steps run in parallel and shared steps run once.
- Write task strings with the built-in commands only (`rm -rf`, `mkdir -p`, `cp`), and move logic that needs `if` or loops into a `deno run` script. [rule-candidate]
- Set `shopt -s failglob` (or `nullglob`) explicitly in tasks that rely on glob behaviour; 2.9.8 did not enable `failglob` by default. [rule-candidate]
- List every input of a cached task in `files` (a change to an unlisted file is skipped as "inputs unchanged") and every product in `output` (the files a cache hit restores). [rule-candidate]

## Verification status
- Verified: 109 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- Commands run on 2026-11-24 with `denoland/deno:alpine-2.9.8` (Deno 2.9.8, V8 15.0.245.2-rusty, TypeScript 6.0.3, Alpine 3.24.2, aarch64) in the lab of `deno/deno-lab-setup.md`; outputs as quoted in Mental model, How it works, Worked example and Edge cases. [^run]
- [deno task](https://docs.deno.com/runtime/reference/cli/task/) — Deno project, living. Rank 1. Backs: task sources and object form, working folder and `INIT_CWD`, dependencies and `--jobs`, wildcards, caching keys, shell syntax, built-in command list, command resolution order, failglob default, `**` warning. [^task]
- [Deno 2.8](https://deno.com/blog/v2.8) — Deno project, 2026. Rank 1. Backs: `set -e`/errexit and the `:` built-in added in 2.8. [^v28]
- [Deno 2.9](https://deno.com/blog/v2.9) — Deno project, 2026. Rank 1. Backs: task caching, `--jobs`/`--concurrency`, exclusion groups, `DENO_DISABLE_NODE_SHIM`. [^v29]
- [deno_task_shell: src/shell/commands/mod.rs](https://github.com/denoland/deno_task_shell/blob/main/src/shell/commands/mod.rs) — Deno project, living. Rank 1. Backs: the registered built-in commands, including `cd`, `set`, `shopt`, `test`, `true`, `false`. [^builtins]
- [deno_task_shell: src/parser.rs](https://github.com/denoland/deno_task_shell/blob/main/src/parser.rs) — Deno project, living. Rank 1. Backs: parse-time refusal of reserved words, `$$`/`$#`/`$*`, multiple redirects, tilde forms. [^parser]

## Related
- `deno/toolchain/cli-subcommands.md` — `deno task` flags next to every other subcommand.
- `deno/configuration/workspaces-and-monorepos.md` — running tasks across workspace members.
- `deno/configuration/deno-json-reference.md` — the `tasks` key among all `deno.json` keys.
- `deno/node-compat/migrating-a-node-project.md` — moving `package.json` scripts to Deno.
