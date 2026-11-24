---
schema: knowledge-doc/v1
type: concept
topic: deno/advanced
status: verified
applies-to: ["Deno 2.9.8"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [deno, deno-compile, denort, standalone-executable, cross-compilation, target, include, embedded-files, deno-install-global, deno-uninstall, deno-desktop, distribution]
ranked-sources: true
---

# Shipping Deno programs: deno compile, deno install -g and deno desktop in 2.9

## Summary
**TL;DR:** `deno compile` takes a prebuilt runtime called `denort`, downloaded once per version and target from `dl.deno.land` and cached in `DENO_DIR`, and appends your module graph, the files you `--include`, and the runtime flags. The result runs on a machine with no Deno installed. Permissions and any leading arguments are fixed at compile time: a flag typed after the binary's name is just another entry in `Deno.args`. `--target` cross-compiles to six targets. A hello world came out at 105,894,856 bytes on Linux arm64. `deno install -g` is the light option: it writes a three-line shell script that runs `deno run` with fixed flags (with `--compile`, a binary instead) into the install root's `bin`, and `deno uninstall -g` deletes it. `deno desktop`, new and experimental in 2.9, wraps a web UI in a native window.
**Use this when:** you hand a CLI (command-line interface) tool or server to people without Deno, build for another OS (operating system) or CPU (central processing unit), embed data files, put a tool on `PATH`, or choose between a compiled binary and an installed script.
**Not this doc:** permission flags themselves → `deno/security/permission-flags.md`; `deno install` and `deno uninstall` for project dependencies → `deno/modules/dependency-management.md`; `deno bundle` and the other subcommands → `deno/toolchain/cli-subcommands.md`; embedding a native library for FFI (foreign function interface) → `deno/advanced/ffi-and-webassembly.md`; Deno KV and other storage → `deno/runtime-apis/workers-kv-and-cron.md`.

## Problem
- The people who run the tool do not have Deno, or the right version of it, and want one file per platform.
- Code that reads a file next to the script works under `deno run` and then fails inside the binary with `NotFound: path not found (entry missing)` because the file was never embedded.
- `./app --allow-env` looks like it grants a permission, but in a compiled binary it does nothing: the flag arrives in `Deno.args`.
- A hello-world binary is about 101 MiB (mebibytes, 1 MiB = 1,048,576 bytes), larger than the `deno` executable that built it.
- `deno uninstall greet` without `-g` does not remove the installed tool; it edits project dependencies instead.

## Mental model
**Analogy:** `denort` is a blank media player. `deno compile` burns a cartridge (your code, your data files, the settings such as permissions) and glues it to a copy of the player, so the result plays only that cartridge. `deno install -g` instead puts a sticky note on your `PATH`: "run Deno with these flags on that file".

| Term | Plain-English analogy | Concrete artifact (lab, Deno 2.9.8) |
|---|---|---|
| `denort` | The blank player: Deno without its tooling subcommands | `denort-aarch64-unknown-linux-gnu.zip`, 34,610,952 bytes, unpacks to a 105,887,651-byte `denort` |
| Embedded module graph | The cartridge: every module the entry point imports statically | `Embedded Files` → `hello` → `hello.ts (44B)` |
| Virtual file system | A pretend folder inside the cartridge | `import.meta.dirname` → `/tmp/deno-compile-app`, a path that does not exist on disk |
| Target triple | The player model the cartridge must fit: CPU, vendor, OS | `x86_64-pc-windows-msvc` |
| Install root | The drawer that holds your sticky notes | `DENO_INSTALL_ROOT=/usr/local` in the image, so scripts go to `/usr/local/bin` |

**Artifact:** compiling and running a hello world ✅[^run]:
```console
$ deno compile -o out/hello hello.ts
Check hello.ts
Compile hello.ts to out/hello
Download https://dl.deno.land/release/v2.9.8/denort-aarch64-unknown-linux-gnu.zip

Embedded Files

hello
└── hello.ts (44B)
$ ./out/hello
hello from /lab/out/hello
```

## How it works

### `deno compile`
**4 actors:**
- **The `deno` CLI** — its job: build and check the module graph, then write the executable, via `deno compile`.
- **`dl.deno.land`** — its job: serve the base runtime, via a `denort-<target>.zip` download over HTTPS.
- **`DENO_DIR`** — its job: keep that zip for later builds, via `$DENO_DIR/dl/release/v<version>/`.
- **The output binary** — its job: run the embedded program, via `denort` reading the payload appended to its own file.

```
[deno compile — local]          [dl.deno.land — network]       [output binary — later, anywhere]
build module graph, type-check
  │
  ├─ denort zip cached? ── no ──▶ GET denort-<target>.zip
  │        ◀──────────────────── zip saved in DENO_DIR
  ▼
copy denort + append payload:
  modules · --include files · flags (permissions, baked args)
  │
  └─ write out/<name>[.exe] ─────────────────────────────────▶ ./out/name args…
                                                                 denort reads payload,
                                                                 serves files from a virtual FS,
                                                                 applies the baked flags
```

1. **CLI (local): build the graph.** Imports that can be read without running code are embedded; a dynamic `import()` with a computed specifier, and a worker that is not imported statically, are left out unless named with `--include` ✅[^compile]. The CLI type-checks local code first (`Check hello.ts`) ✅[^run].
2. **CLI → `dl.deno.land` (network, first build only):** the first compile for a Deno version and target downloads `denort-<target>.zip` from `dl.deno.land` and caches it in `DENO_DIR`; later builds work offline ✅[^compile]. The lab saw `Download https://dl.deno.land/release/v2.9.8/denort-aarch64-unknown-linux-gnu.zip` and found it at `/deno-dir/dl/release/v2.9.8/` ✅[^run]. `DENORT_BIN` points the CLI at a local runtime instead ✅[^compile].
3. **CLI (local): write the file.** The output is `denort` plus the payload, and the CLI prints an `Embedded Files` tree with sizes ✅[^run]. `-o` sets the path (default: an inferred name in the current folder) ✅[^compile]; a Windows target turned `-o out/hello-win` into `out/hello-win.exe` ✅[^run].
4. **Binary (any machine): run.** Embedded files come from an in-memory virtual file system ✅[^compile], and the docs read them through `import.meta.dirname` ✅[^compile]. In the lab, `import.meta.url` was `file:///tmp/deno-compile-app/app.ts`, `ls /tmp/deno-compile-app` answered `No such file or directory`, and `Deno.execPath()` returned the binary's own path ✅[^run].
5. **Binary: apply the baked flags.** Runtime flags, permissions included, "must be specified at compilation time" ✅[^compile]. Arguments written after the script at compile time come first in `Deno.args`, and run-time arguments follow ✅[^compile] ✅[^run]. A run-time `--allow-env` became `Deno.args[2]`, and `Deno.env.get` still failed with ``Requires env access to "HOME", specify the required permissions during compilation using `deno compile --allow-env` `` ✅[^run]. `--help` after the binary name was likewise just an argument ✅[^run].

### Targets, sizes and other options
| Target triple | OS and CPU |
|---|---|
| `x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-gnu` | Linux x86-64, Linux ARM64 |
| `x86_64-pc-windows-msvc`, `aarch64-pc-windows-msvc` (since 2.9.3) | Windows x86-64, Windows ARM64 |
| `x86_64-apple-darwin`, `aarch64-apple-darwin` | macOS x86-64, macOS ARM64 |

The docs list these six and say Deno cross-compiles to every target from any host ✅[^compile]; 2.9.8 rejects anything else with exactly this list (`error: invalid value 'riscv64-unknown-linux-gnu' for '--target': possible values: …`) ✅[^run].

| Output (built on Linux arm64) | Bytes ✅[^run] |
|---|---|
| `/bin/deno` in the image, for comparison | 85,616,329 |
| hello world, default V8 engine | 105,894,856 |
| the same program plus two embedded text files | 105,897,536 |
| hello world, `--engine quickjs` (downloads `denort-quickjs-…zip`) | 63,075,240 |
| hello world, `--target x86_64-pc-windows-msvc` | 80,418,431 |

| Option | Effect | Status in 2.9 |
|---|---|---|
| `--include <path>` / `--exclude <path>` | Embed or skip files, folders or modules; also `compile.include`/`compile.exclude` in `deno.json` ✅[^compile] | Files and folders since 2.1 ✅[^compile] |
| `--include-as-is` | Embed files without module resolution or transpiling ✅[^v29] | New in 2.9 |
| `--icon <file.ico>`, `--no-terminal` | Windows icon; hide the console window on Windows ✅[^compile] ✅[^run] | Windows targets only |
| `--engine quickjs` | Smaller binary on the QuickJS interpreter, which "does not receive the same security updates as v8" (help text) ✅[^run] | Experimental ✅[^compile] |
| `--bundle`, `--minify` | Bundle before embedding; can shrink npm-heavy binaries ✅[^v29] | Experimental ✅[^compile] |
| `--self-extracting` | Unpack the embedded files to disk on first run, for native addons that read relative files ✅[^compile] | — |
| `--app-name` | Storage identity for `localStorage`, the Cache API (application programming interface) and a default `Deno.openKv()`, which persist per app ✅[^compile] | New in 2.9 ✅[^v29] |

### `deno install -g` and `deno uninstall -g`
1. **CLI (local): pick the install root:** `--root`, then `DENO_INSTALL_ROOT`, then `$HOME/.deno`; executables go in its `bin` folder ✅[^install] ✅[^envvars]. The image sets `DENO_INSTALL_ROOT=/usr/local`, so the script landed in `/usr/local/bin/greet`; with the variable unset it went to `/root/.deno/bin/g2` with a hint `Add /root/.deno/bin to PATH` ✅[^run].
2. **CLI (local): write the shim.** Install writes "a thin, executable shell script" that runs `deno` with the given flags ✅[^install]. The lab's `deno install -g --allow-env -n greet greet.ts -- fixed` wrote ✅[^run]:
   ```sh
   #!/bin/sh
   # generated by deno install
   exec deno run --allow-env --config /usr/local/bin/.greet/deno.json 'file:///lab/greet.ts' fixed "$@"
   ```
   next to a folder `.greet/` holding a `deno.json` of `{ "workspace": [] }`. The shim needs `deno` on `PATH` and the source at that URL.
3. **Name clash:** a second install under the same name stops with `error: Existing installation found. Aborting (Use -f to overwrite).` ✅[^run]; `-f` overwrites ✅[^install].
4. **`--compile`:** `deno install -g --compile` runs `deno compile` and puts the binary in the root's `bin` instead of a script ✅[^install]; the lab printed `Successfully installed /usr/local/bin/greetbin` ✅[^run].
5. **Uninstall:** `deno uninstall -g <name>` removes a script or binary from the root's `bin` ✅[^uninstall]; the lab printed `deleted /usr/local/bin/greet`, `deleted /usr/local/bin/.greet` and a check-mark line `Successfully uninstalled greet` ✅[^run].

### `deno desktop` (2.9, experimental)
`deno desktop` compiles a project into a desktop application: one redistributable binary per platform that bundles your code, the runtime and a rendering backend ✅[^desktop-cli]. `Deno.serve()` in the entry point is wired to the window ✅[^v29]. The `--output` extension picks the format: `.app` or `.dmg` on macOS; a folder or an `.msi` on Windows; a folder, `.AppImage`, `.deb` or `.rpm` on Linux ✅[^desktop-dist]. `--backend webview` (the OS engine, default) or `cef` (bundled Chromium), `--target`, `--all-targets` and `--compress` complete the set ✅[^desktop-cli] ✅[^desktop-dist]. A `.dmg` and macOS signing need a macOS host ✅[^desktop-dist]. Settings live in a `desktop` block of `deno.json` (`app`, `backend`, per-platform `output`, `macos.codesignIdentity`, `release`, `errorReporting`), and `--output` overrides `desktop.output` for one build ✅[^desktop-cfg]. With `{ "desktop": { "output": { "linux": "dist/FromConfig.AppImage" } } }`, 2.9.8 printed `Compile main.ts to dist/FromConfig.so`; adding `-o out/FromFlag.AppImage` gave `Compile main.ts to out/FromFlag.so` ✅[^run].

In the lab (no display) the build started with `⚠ deno desktop is experimental and subject to change`, downloaded `libdenort-aarch64-unknown-linux-gnu.zip` from `dl.deno.land`, wrote a 75,531,120-byte `out/hello.so`, then tried to fetch a webview backend archive (`laufey-webview-aarch64-unknown-linux-gnu.tar.gz`, v0.7.0) from a host other than `dl.deno.land`. The lab only lets `dl.deno.land` through, so the build stopped there with `failed to download`; no app was produced or run ✅[^run].

## Worked example
Ship `app.ts`, which reads `data/greeting.txt`, as one Linux binary with read access only. `app.ts` prints `Deno.args`, the embedded file, the folder listing and three permission states.

| Step | Command | Output in the lab ✅[^run] |
|---|---|---|
| 1 | `deno compile --allow-read --include data -o out/app app.ts --baked "two words"` | `Embedded Files` → `app.ts (2.43KB)`, `data/* (32B)`; exit 0 |
| 2 | `mv data /tmp/data-moved` | the source folder is gone from disk |
| 3 | `./out/app extra1` | `Deno.args = ["--baked","two words","extra1"]` |
| 4 | (same run) | `embedded file: hi from an embedded file`; `readDir data: [ "greeting.txt", "two.txt" ]` |
| 5 | (same run) | `permission read: granted`, `permission env: prompt`, `permission net: prompt` |
| 6 | (same run) | `Deno.env.get("HOME")` → ``Requires env access to "HOME", specify the required permissions during compilation using `deno compile --allow-env` `` |
| 7 | `deno compile --allow-read -o out/app2 app.ts` then `./out/app2` | `error: Uncaught (in promise) NotFound: path not found (entry missing): /tmp/deno-compile-app2/data/greeting.txt` |

Step 4 ran after step 2, so the file came from the binary, not the disk. The first compile in a fresh container (`hello.ts`) took 6.8 s of wall time, the 34.6 MB `denort` download included.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Binary size versus the docs | The docs say building on `denort` "is what keeps compiled executables smaller" ✅[^compile]; in the lab the Linux arm64 `denort` (105,887,651 bytes) was larger than the image's `deno` (85,616,329 bytes) ✅[^run] | Measured on one target only; for small binaries use `--bundle` or `--engine quickjs`, both experimental ✅[^compile] |
| Permission flags after the binary name | Become `Deno.args` entries; the permission stays at its compiled state ✅[^run] | Flags are fixed at compile time ✅[^compile] |
| `--help` after the binary name | Passed to the program; `hello` printed its normal line ✅[^run] | `denort` carries none of the tooling subcommands ✅[^compile] |
| File read by computed path, not embedded | `NotFound … (entry missing)` ✅[^run] | Only `--include`d files are in the virtual file system ✅[^compile] |
| `--include` of a remote URL | Not supported; only local files ✅[^compile] | — |
| `deno uninstall greet` (no `-g`) in a folder without config | `Created deno.json configuration file.` and `No packages were removed`, exit 0 ✅[^run] | Without `--global` it removes dependencies from `deno.json` ✅[^uninstall] |
| `--global` with `--os`, `--arch`, `--prod` or `--dev` | Refused, for example `error: the argument '--prod' cannot be used with '--global'` ✅[^run] | The install page does not state this; the 2.9.8 argument parser does |
| Experimental label of `deno desktop` | The CLI and the 2.9 post call it experimental ✅[^run] ✅[^v29]; the desktop docs pages only say it is available from 2.9.0 ✅[^desktop-cli] | The CLI's own warning says it is "subject to change" ✅[^run] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `deno compile` | One file; no Deno on the target; any of six targets from one host ✅[^compile] | About 101 MiB per binary on Linux arm64 ✅[^run]; flags and permissions are frozen until you rebuild |
| `deno install -g` (script) | A three-line file that runs the source in place (`file:///lab/greet.ts`) ✅[^run] | Needs Deno and the source on the target machine |
| `deno install -g --compile` | A binary placed on `PATH` in one step ✅[^install] | Same size and rebuild costs as `deno compile` |
| `deno desktop` | Native window and installers (`.msi`, `.deb`, `.rpm`, `.AppImage`) from any host ✅[^desktop-dist] | Experimental; downloads a rendering backend at build time ✅[^run] |

## Takeaways
- Pass every permission flag to `deno compile`, never to the compiled binary: a flag after the binary name is only an argument. [rule-candidate]
- Read embedded data through `import.meta.dirname` and list each data folder with `--include`; test the binary after moving the source away. [rule-candidate]
- Pre-fetch `denort` (one compile per target) on build machines that will later run offline, because the first build per version and target downloads it.
- Use `deno uninstall -g` for tools; without `-g` the command edits project dependencies.
- Treat `deno desktop` as experimental in 2.9 and pin the Deno version that builds it.

## Verification status
- Verified: 76 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- Commands run on 2026-11-24 with `denoland/deno:alpine-2.9.8` (Deno 2.9.8, V8 15.0.245.2-rusty, TypeScript 6.0.3, Alpine 3.24.2, aarch64) in the lab of `deno/deno-lab-setup.md`; outputs as quoted in Mental model, How it works, Worked example, Edge cases and Trade-offs. The `deno compile` runs downloaded `denort` archives from `dl.deno.land`; the `deno desktop` run went through a proxy that allowed only `dl.deno.land`. [^run]
- [deno compile](https://docs.deno.com/runtime/reference/cli/compile/) — Deno project, living. Rank 1. Backs: `denort`, download and cache, flags, targets, cross-compiling, `--include`, virtual file system, permissions at compile time, baked arguments, experimental options. [^compile]
- [deno install](https://docs.deno.com/runtime/reference/cli/install/) — Deno project, living. Rank 1. Backs: install root order, shell script, `-f`, `--compile`. [^install]
- [deno uninstall](https://docs.deno.com/runtime/reference/cli/uninstall/) — Deno project, living. Rank 1. Backs: `--global` versus dependency removal. [^uninstall]
- [deno desktop](https://docs.deno.com/runtime/reference/cli/desktop/) — Deno project, living. Rank 1. Backs: what the command builds, flags, availability from 2.9.0. [^desktop-cli]
- [Distribution (Desktop apps guide)](https://docs.deno.com/runtime/desktop/distribution/) — Deno project, living. Rank 1. Backs: output formats per platform, targets, host requirements, compression. [^desktop-dist]
- [Configuration (Desktop apps guide)](https://docs.deno.com/runtime/desktop/configuration/) — Deno project, living. Rank 1. Backs: the `desktop` block in `deno.json` and `--output` precedence. [^desktop-cfg]
- [Environment variables](https://docs.deno.com/runtime/reference/env_variables/) — Deno project, living. Rank 1. Backs: `DENO_INSTALL_ROOT`. [^envvars]
- [Deno 2.9](https://deno.com/blog/v2.9) — Deno project, 2026. Rank 1. Backs: `--include-as-is`, `--bundle`, `--app-name` and persistent storage, `deno desktop` being experimental and wiring `Deno.serve()`. [^v29]

## Related
- `deno/security/permission-flags.md` — the flags you bake into a binary.
- `deno/modules/dependency-management.md` — `deno install` and `deno uninstall` for project dependencies.
- `deno/toolchain/cli-subcommands.md` — `deno bundle` and the rest of the CLI.
- `deno/advanced/ffi-and-webassembly.md` — native libraries, which `dlopen` needs as files on disk.
- `deno/releases-stability-and-support.md` — how long 2.9 receives fixes.
