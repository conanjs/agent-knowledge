---
schema: knowledge-doc/v1
type: concept
topic: bun/bundler
status: verified
applies-to: ["Bun 1.4.5"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [bun, bundler, compile, single-file-executable, cross-compile, bytecode, embedded-files, bunfs, sqlite, codesign]
---

# Bun single-file executables (`bun build --compile`)

## Summary
**TL;DR:** `bun build ./cli.ts --compile --outfile mycli` bundles your code and appends it, with any embedded files, to a copy of the Bun runtime, so the result runs on a machine without Bun. The runtime dominates the size: a hello world was 109,300,728 bytes against 107,405,304 for the `bun` binary itself. `--target=bun-linux-x64` (or `-arm64-musl`, `-darwin-arm64`, `-windows-x64`, …) cross-compiles by downloading that platform's runtime once; the x64 Linux binaries then ran in an amd64 container under emulation, and the musl ones need the distribution's `libstdc++`. Embedded files live under `/$bunfs/root/` and are read with `Bun.file` or `node:fs`. `--bytecode` moves parsing to build time: per round, a generated 1.3 MB program started 2.7–3.75× faster and a 59 KB zod app 1.25–2.5× faster on a loaded host. By default the executable still reads `.env` and `bunfig.toml` from the folder it runs in.
**Use this when:** shipping a CLI (command-line tool) or server as one file, cross-compiling for another OS or CPU, embedding assets or a SQLite database, deciding whether `--bytecode` is worth it, or debugging why a compiled binary behaves differently in another folder.
**Not this doc:** bundler options shared with normal builds → [bun-build.md](bun-build.md); a whole frontend in one `.html` file (`--compile --target=browser`) and HTML imports → [fullstack-dev-server-and-html.md](fullstack-dev-server-and-html.md); `bun:sqlite` itself → `bun/system-apis/sqlite-and-sql.md`.

## Problem
Deploying a TypeScript tool usually means installing Bun, copying `node_modules`, and trusting the target to match. A compiled executable removes that, but brings new surprises: a binary built on an arm64 laptop does not start on an x64 server unless it was cross-compiled; a `.env` file sitting in the directory where the binary runs silently changes its behaviour; files the code reads with relative paths are not inside the binary unless embedded; and `--bytecode` builds are larger and tied to one Bun version.

## Mental model
**Analogy:** a ship in a bottle. The ship is the Bun runtime, the cargo is your bundle and its files, and `--compile` seals both into one bottle. Inside the bottle the cargo hold has its own address, `/$bunfs/root/`, that only the ship can reach. Cross-compiling means fetching a different ship (a Linux, macOS or Windows runtime) and loading the same cargo.

**Artifact:** a compiled program reporting where it lives, run from `/tmp/run` with arguments `a b` ✅[^lab]:
```console
$ bun build ./info.ts --compile --asset ./public --outfile out/info
  [18ms]  bundle  3 modules
[1424ms] compile  out/info
$ cd /tmp/run && /w/out/info a b
isStandaloneExecutable: true
execPath: /w/out/info
argv: ["bun","/$bunfs/root/info","a","b"]
import.meta.url: file:///$bunfs/root/info | import.meta.dir: /$bunfs/root
icon path: /$bunfs/root/icon-e08x70mm.png | bytes: 22
embeddedFiles: data-c7h3gqrh.json (33 B), icon-e08x70mm.png (22 B), public/img/a.txt (3 B), public/index.html (21 B)
```

## How it works
Three actors take part:
- **`bun build --compile`** — its job: bundle the code and write the executable, via a runtime binary for the target plus the appended bundle and files.
- **The executable at start-up** — its job: find its own payload and run the entrypoint, via the embedded file system at `/$bunfs/root/`.
- **Your code** — its job: read embedded files and runtime settings, via import paths, `Bun.file`, `node:fs`, `process.argv` and `process.env`.

```
build machine                                         target machine
bun build --compile --target=T ./cli.ts              ./mycli a b
  │ bundle cli.ts + imports (like bun build)            │
  │ pick runtime for T:                                 ├─ runtime starts, mounts payload at /$bunfs/root/
  │   same OS/CPU → copy of this bun                    ├─ unless disabled: reads ./.env and ./bunfig.toml
  │   other T → download bun-<os>-<arch>-v1.4.5  ═══╗   │   (from the current directory)
  │            (network, once; then cached)         ║   ├─ applies baked --compile-exec-argv, then BUN_OPTIONS
  │ append: bundle, files, bytecode, options        ║   └─ runs /$bunfs/root/cli with argv ["bun", "/$bunfs/root/cli", "a", "b"]
  ▼                                                 ║
mycli (one file)  ─────── copy to the target ═══════╝
```

1. **`bun build --compile` (build machine):**
   - Bundles all imported files and packages into the executable together with a copy of the Bun runtime, and supports all built-in Bun and Node.js APIs ✅[^1]. A sample ran in one compiled binary: `node:crypto` hashing, `node:zlib` gzip, `node:child_process` `execSync`, `bun:sqlite`, a `Bun.serve` answering `fetch`, and `Bun.password` ✅[^lab].
   - The JavaScript API form is `Bun.build({ entrypoints, compile: { outfile } })`; `compile` also accepts `true` or a target string ✅[^1]. In the lab the result listed one `entry-point` artifact whose `path` was the executable but whose `size` was 58,659 bytes, about the minified bundle, not the 109 MB file ✅[^lab].
   - Not allowed with `--compile`: `--outdir` (use `--outfile`), `--public-path`, `--target=node`, `--target=browser` without HTML entrypoints, and `--no-bundle` ✅[^1]. In 1.4.5 only two of the five failed: `error: cannot use --compile with --outdir` and `error: --compile does not support --no-bundle` ✅[^lab]; the other three built (Edge cases).
   - Workers must be listed as extra entrypoints (`bun build --compile ./index.ts ./my-worker.ts`) ✅[^1]. Run from an empty folder, the binary built that way printed `embedded worker, file /$bunfs/root/my-worker.js`; the one built from `index.ts` alone failed with `BuildMessage: ModuleNotFound resolving "./my-worker.ts" (entry point)` ✅[^lab].
2. **Choosing the runtime (cross-compiling):**
   - `--target` takes `bun-<os>-<arch>[-musl]`: `bun-linux-x64`, `bun-linux-arm64`, `bun-linux-x64-musl`, `bun-linux-arm64-musl`, `bun-darwin-x64`, `bun-darwin-arm64`, `bun-windows-x64`, `bun-windows-arm64`; on Windows `.exe` is added to the name ✅[^1] ✅[^5]. All eight built from the arm64 container ✅[^lab]; `file` called the Windows outputs `PE32+ executable (console) x86-64, for MS Windows` and `… Aarch64 …`, and the `bun-darwin-x64` one `Mach-O 64-bit executable x86_64` ✅[^lab].
   - x64 now ships one baseline binary; the `-baseline` and `-modern` suffixes are still accepted and give the same file ✅[^1] ✅[^4]. Lab: `--target=bun-linux-x64-baseline` cached `bun-linux-x64-baseline-v1.4.5`, byte-identical to `bun-linux-x64-v1.4.5` (same SHA-256, 107,394,952 bytes) ✅[^lab].
   - **Network boundary:** for a foreign target, the lab printed `Downloading [50433053]` (bytes, for `bun-linux-x64`), decompressed it, and cached the runtime as `~/.bun/install/cache/bun-linux-x64-v1.4.5`; each first build took about 3 s ✅[^lab]. `compile.executablePath` points at a runtime you already have instead ✅[^1] ✅[^5]. Lab, offline (`--network none`) with an empty cache: `target: "bun-linux-x64-musl"` failed with `Failed to download 'bun-linux-x64-musl-v1.4.5': DNSResolveFailed`, and with `executablePath` set to a copy of that runtime it built the 102,802,968-byte binary ✅[^lab].
3. **The executable at start-up (target machine):**
   - Embedded files and the entrypoint are under `/$bunfs/root/`; `import.meta.url` was `file:///$bunfs/root/info`, `process.execPath` the real file on disk ✅[^lab].
   - Config files: `.env` and `bunfig.toml` in the current directory are loaded by default, `tsconfig.json` and `package.json` are not (since 1.3.4) ✅[^1] ✅[^4]. Lab: with `FOO=from-dotenv` in `./.env` and a `bunfig.toml` `preload`, the default binary printed `FOO: from-dotenv | PRELOADED: yes`; the one built with `--no-compile-autoload-dotenv --no-compile-autoload-bunfig` printed `FOO: (unset) | PRELOADED: no` ✅[^lab]. In a folder whose `tsconfig.json` maps `@lib/*` and whose `package.json` maps `#lib/*` (both to `./lib/*`), a binary doing `await import()` of those names failed by default (`Cannot find package '@lib/x.ts'`, `Cannot find package '#lib'`) and loaded `lib/x.ts` when built with `--compile-autoload-tsconfig --compile-autoload-package-json` ✅[^lab].
   - Runtime flags: `--compile-exec-argv="--smol"` (`compile.execArgv`) bakes flags into `process.execArgv`, and `BUN_OPTIONS` adds flags without rebuilding ✅[^1]; both gave `execArgv: ["--smol"]` ✅[^lab].
   - `BUN_BE_BUN=1 ./mycli …` makes the binary act as the `bun` CLI instead of running its entrypoint ✅[^1]; `BUN_BE_BUN=1 ./out/hello --version` printed `1.4.5` ✅[^lab].
4. **Your code reading embedded files:**
   - `import icon from "./icon.png" with { type: "file" }` embeds the file and gives a path such as `/$bunfs/root/icon-e08x70mm.png` (named by `--asset-naming`, default `[name]-[hash].[ext]`) ✅[^1] ✅[^lab]. `readFileSync(icon)` returned the 22 bytes, `Bun.file(dataPath).json()` the parsed JSON ✅[^lab].
   - `--asset ./public` (`compile.assets`, new in 1.4.0) embeds a folder under its own relative path, reachable through `import.meta.dir`; `readdirSync(join(import.meta.dir, "public"), { recursive: true })` listed `index.html, img/a.txt, img` ✅[^1] ✅[^4] ✅[^lab]. Bun 1.3.14 did not know the flag: the same command failed with `error: ModuleNotFound resolving "./public" (entry point)` ✅[^lab].
   - `Bun.embeddedFiles` lists the embedded files as `Blob`s with a `name`, but never the bundled source code; `Bun.isStandaloneExecutable` tells whether the process is a compiled binary without creating those blobs ✅[^1]. The Artifact above shows both: four files listed, `info.ts` not among them, and `isStandaloneExecutable: true` ✅[^lab].
   - A `text` import (`.txt`, or `with { type: "text" }`) is stored as a string module, not a file, so `Bun.embeddedFiles` does not list it ✅[^1]. Lab: a binary importing `note.txt` printed its text and an empty `Bun.embeddedFiles`; a `.ts` file imported `with { type: "file" }` was not listed either ✅[^lab].
   - SQLite: `import db from "./app.db" with { type: "sqlite", embed: "true" }` copies the database into the binary; it is writable in memory, and changes are lost at exit ✅[^1]. Run twice from a folder with no `app.db`: both runs printed `rows: [{"name":"ada"},{"name":"linus"}]` and `n: 3` after one insert ✅[^lab].

### Size, minification and source maps
| Build (arm64 Linux) | Bytes | Note |
|---|---|---|
| `/usr/local/bin/bun` in the image | 107,405,304 | The runtime alone ✅[^lab] |
| `hello.ts` (`console.log("Hello world!")`) `--compile` | 109,300,728 | +1,895,424 bytes (+1.8%) over the runtime ✅[^lab] |
| Same with `--minify`, and the zod app from [bun-build.md](bun-build.md) with `--minify` | 109,300,728 | Identical size: the bundle is tiny next to the runtime ✅[^lab] |
| 1.4 MB generated program `--minify` / `--minify --bytecode` | 110,349,304 / 112,905,208 | Bytecode adds 2,555,904 bytes ✅[^lab] |
| Re-run: zod app, and a 1.33 MB generated program (845,053 bytes minified), each `--minify` / `--minify --bytecode` | 109,300,728 / 109,497,336, and 110,087,160 / 111,332,344 | Bytecode adds 196,608 and 1,245,184 bytes ✅[^lab] |

- `--sourcemap` embeds a zstd-compressed source map that Bun applies when an error is printed ✅[^1]. Without it, a thrown error pointed at `/$bunfs/root/boom-plain:4:9` and showed bundled code; with `--minify --sourcemap` it showed the original `boom.ts:2:13` and the original source line, while function names stayed minified (`at o (boom.ts:2:13)`) ✅[^lab]. The build also wrote a 419-byte `boom-map.map` next to the binary, but a copy of the binary run alone from `/` still showed `boom.ts:2:13`, and both binaries were 109,300,728 bytes ✅[^lab].

### Bytecode caching (`--bytecode`)
- JavaScriptCore (Bun's engine) normally parses source and compiles it to bytecode on every start; `--bytecode` does that at build time and stores the bytecode, which shortens start-up ✅[^1] ✅[^2]. It is not obfuscation: the source must still ship ✅[^2]. The `--bytecode` binary of a small program still contained its source text `function secretSauce(n` ✅[^lab].
- Without `--compile`, bytecode works only for CommonJS: `bun build --target=bun --bytecode` wrote `zodapp.js` (59,342 bytes, first line `// @bun @bytecode @bun-cjs`) and `zodapp.js.jsc` (183,632 bytes, 3.1×) ✅[^lab]. `--format=esm` without `--compile` failed: `ESM bytecode requires --compile` ✅[^2] ✅[^lab].
- `BUN_JSC_verboseDiskCache=1 bun dist/zodapp.js` printed `[Disk Cache] Cache hit for sourceCode` ✅[^2] ✅[^lab].
- Bytecode is tied to the Bun version that built it; on a mismatch Bun silently ignores it and parses the source ✅[^2]. Lab, with the CommonJS `.jsc` file: overwriting 16 of its header bytes, truncating it to 100 bytes, or deleting it each made `BUN_JSC_verboseDiskCache=1` print `Cache miss for sourceCode`, and the program still ran with exit code 0 ✅[^lab]. Across versions: Bun 1.3.14 (`oven/bun:1.3.14`), 1.4.5 and `1.4.6-canary.1` (`oven/bun:canary`, the preview of the next release) built a small CommonJS program into a byte-identical `app.js` but three different `.jsc` files (4,368, 1,312 and 1,312 bytes). Each runtime printed `Cache hit for sourceCode` only for its own `.jsc`; 1.4.5 given the 1.3.14 or the canary file, and 1.3.14 or the canary given the 1.4.5 file, printed `Cache miss for sourceCode`, gave the right output with exit code 0, and wrote nothing to stderr without the debug variable (2 runs of all 9 pairs) ✅[^lab].

**Start-up measured** (Docker on OrbStack, arm64; per round, each binary ran once as a warm-up and then 5 times, interleaved, timed by `Bun.spawnSync`; the round value is the median of the 5; five rounds per session, two sessions back to back at a 1-minute load average of 6.6; values in round order) ✅[^lab]:

| Program | Session | Without `--bytecode` (ms) | With `--bytecode` (ms) | Ratio per round |
|---|---|---|---|---|
| zod app (58,659 bytes minified) | 1 | 7.3 · 4.5 · 5.0 · 10.2 · 7.3 | 4.7 · 3.0 · 2.9 · 4.1 · 4.3 | 1.5–2.5× |
| zod app | 2 | 5.0 · 4.0 · 4.6 · 3.9 · 3.7 | 3.5 · 3.2 · 3.0 · 2.4 · 2.3 | 1.25–1.6× |
| generated program (1.33 MB source, a table of 6,000 small methods, two called) | 1 | 15.7 · 11.3 · 12.2 · 18.3 · 18.1 | 4.2 · 3.1 · 3.4 · 6.7 · 4.9 | 2.7–3.7× |
| generated program | 2 | 13.0 · 13.0 · 11.9 · 10.7 · 10.5 | 3.7 · 3.8 · 3.6 · 3.2 · 2.8 | 3.3–3.75× |
| zod app, earlier session at lower load (1-minute load average 2.5) | — | 4.0 · 4.0 · 4.4 | 2.4 · 2.4 · 2.6 | 1.7× |
| earlier 1.4 MB generated program, same earlier session | — | 17.6 · 17.4 · 18.7 | 11.8 · 11.3 · 12.3 | 1.5× |

The earlier session's values are in round order too ✅[^lab]. A first earlier session reported its three round values sorted instead of in round order, so its per-round ratios could not be read; the two sessions above replace it. Its 1.4 MB program was not kept, so the re-run generated a new one, and that program gained far more from bytecode (2.7–3.75×) than the earlier one (1.5×): the factor depends on the program's shape. An earlier attempt gave runs from 9 to 43 ms for the same binaries while other containers were busy, and was discarded. Read these as rough factors for this machine. The docs expect 1.5–2× for a small CLI and 2–4× for apps over 5 MB ✅[^2].

### Platform notes
- **macOS:** sign with `codesign --deep --force -vvvv --sign "<identity>" --entitlements entitlements.plist ./myapp`, where the entitlements allow JIT, just-in-time compilation (`com.apple.security.cs.allow-jit` and four related keys), then check with `codesign -vvv --verify ./myapp`; this fixes the Gatekeeper "unidentified developer" warning and needs Bun 1.2.4 or newer ✅[^1] ✅[^3]. Lab, on a macOS 26.1 arm64 Mac, with a hot-loop script cross-compiled in the container (`--target=bun-darwin-arm64`, 89,160,066 bytes) ✅[^lab]:
  - **As built** the binary already carried an ad-hoc signature (`codesign -dv`: `flags=0x20002(adhoc,linker-signed)`, `Signature=adhoc`); `codesign -v` passed and it ran.
  - **Signature removed** (`codesign --remove-signature`): killed at start, exit 137. On Apple silicon the operating system runs only signed executables ✅[^6].
  - **Hardened runtime without entitlements** (`codesign --force --sign - --options runtime`): it ran, but the 50-million-iteration loop took a median 1,542 ms over 5 runs, against 193 ms as built; signed the same way with the entitlements file, 190 ms. The hardened runtime refuses the writable-and-executable memory a JIT needs unless `com.apple.security.cs.allow-jit` is granted, and JIT-based engines may then fall back to an interpreter ✅[^7].
  - **Gatekeeper:** `spctl --assess --type execute` judges app bundles only. It rejected the as-built and the entitled binary, and also the Developer ID-signed, notarized `bun` that Homebrew installs, which it rejected with `the code is valid but does not seem to be an app` ✅[^lab]. For a command-line binary, the check that answers the question is `spctl --assess --type open --context context:primary-signature -vv <file>` ✅[^lab]:
    - the Homebrew `bun` → `accepted`, `source=Notarized Developer ID`;
    - a binary compiled with `bun build --compile` on the Mac itself, which is also `adhoc,linker-signed` → `rejected`.
    The Homebrew binary shows the signature the guide aims at ✅[^3] ✅[^lab]: `Authority=Developer ID Application` (Team ID `7FRXF46ZSN`), the hardened runtime (`flags=0x10000(runtime)`), and exactly the guide's five entitlements. Signing your own executable with a Developer ID was not tested: it needs the user's own Apple Developer ID certificate.
- **Windows:** `--windows-icon`, `--windows-hide-console`, and through the API `title`, `publisher`, `version`, `description` and `copyright`; all except `hideConsole` need a Windows build machine ✅[^1]. Cross-compiling with `--windows-title=Lab` printed `error: Using --windows-title is only available when compiling on Windows`, and `--windows-icon`, `--windows-publisher`, `--windows-version`, `--windows-description` and `--windows-copyright` gave the same error with their own names, while `--windows-hide-console` built `hidden.exe` ✅[^lab]. That flag set the PE (Portable Executable) header's subsystem field to 2, which `file` reports as `PE32+ executable (GUI)`; without it the field was 3, `(console)` ✅[^lab]. The `.exe` files were not run: that needs a Windows machine, which the lab does not have.

## Worked example
Cross-compiling one hello world to four targets from the arm64 Linux container ✅[^lab]:
```console
$ bun build ./hello.ts --compile --target=bun-darwin-arm64 --outfile cross/hello-bun-darwin-arm64
Downloading [40463298]
Decompressing...
[3.344s] compile  cross/hello-bun-darwin-arm64 bun-darwin-aarch64-v1.4.5
```
| `--target` | Download (bytes) | Output | Output bytes | First bytes |
|---|---|---|---|---|
| `bun-linux-x64` | 50,433,053 | `hello-bun-linux-x64` | 109,209,776 | `7F 45 4C 46` (ELF) |
| `bun-linux-arm64-musl` | 48,355,798 | `hello-bun-linux-arm64-musl` | 101,719,256 | `7F 45 4C 46` (ELF) |
| `bun-darwin-arm64` | 40,463,298 | `hello-bun-darwin-arm64` | 89,160,066 | `CF FA ED FE` (Mach-O 64-bit) |
| `bun-windows-x64` | 50,767,934 and 53,454,910 (two downloads) | `hello-bun-windows-x64.exe` | 115,368,960 | `4D 5A` (`MZ`, PE) |

Running them in the same container: the x64 binary failed with OrbStack's `Dynamic loader not found: /lib64/ld-linux-x86-64.so.2`, and the musl binary with `not found` (exit 127): it asks for `/lib/ld-musl-aarch64.so.1`, which the Debian image does not have ✅[^lab]. The native `bun build ./hello.ts --compile --outfile out/hello` printed `Hello world!` ✅[^lab].

Running each one where it belongs ✅[^lab]:
- `hello-bun-linux-x64` and `hello-bun-linux-x64-baseline` printed `Hello world!` in `bunlab-amd64/debian:trixie-slim` started with `--platform linux/amd64`, which runs x64 code under Rosetta emulation. The emulated CPU lists SSE4.2 but no AVX, and neither binary stopped on an illegal instruction.
- `hello-bun-linux-arm64-musl` printed `Hello world!` in `linlab:1` (Alpine 3.20, arm64).
- `hello-bun-linux-x64-musl` failed in `bunlab-amd64/alpine:3.20`: `Error loading shared library libstdc++.so.6: No such file or directory`, then 38 `symbol not found` lines for C++ library symbols, exit code 127 (two runs). `readelf -d` lists `libstdc++.so.6` as a needed library of both musl builds; `linlab:1` has it, the bare Alpine image does not, and installing it was outside the lab's rules.
- A binary for the wrong C library failed at the dynamic loader: the glibc x64 build on Alpine with `Dynamic loader not found: /lib64/ld-linux-x86-64.so.2`, the musl x64 build on Debian with `/lib/ld-musl-x86_64.so.1` (both exit 255).

Start-up of the same hello world, timed by a compiled timer built for each image (`Bun.spawnSync`, 3 warm-ups, then the median of 11 runs; two sessions at a 1-minute load average of about 7) ✅[^lab]:

| Binary | Image | First run (ms), session 1 / 2 | Median (ms), session 1 / 2 |
|---|---|---|---|
| `hello-native` (glibc, arm64) | `oven/bun:1.4.5` | 43.9 / 6.2 | 1.9 / 4.3 |
| `hello-bun-linux-arm64-musl` | `linlab:1` | 63.1 / 11.6 | 2.2 / 3.5 |
| `hello-bun-linux-x64` | `bunlab-amd64/debian:trixie-slim`, emulated | 318.6 / 261.0 | 157.6 / 177.2 |
| `hello-bun-linux-x64-baseline` | same, emulated | 312.9 / 241.1 | 183.8 / 176.5 |

Emulation made start-up 40–97× slower than native (medians, same session). These numbers measure Rosetta on this Mac, not Bun on a real x64 CPU, so do not use them to size x64 start-up.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Binary started in a folder that has a `.env` or `bunfig.toml` | Their values apply (`FOO: from-dotenv`, preload ran) ✅[^lab] | Loading both is the default ✅[^1]; for servers and tools, build with `--no-compile-autoload-dotenv --no-compile-autoload-bunfig` |
| CLI parsing of `process.argv` | `argv[0]` is `"bun"`, `argv[1]` is `/$bunfs/root/<name>`, user arguments start at index 2 ✅[^lab] | Same layout as `bun cli.ts`; keep `process.argv.slice(2)` |
| Relative `new Worker("./w.ts")` or file path that is not embedded | Loaded from disk relative to the current directory, or an error if missing ✅[^1]. Lab: with a `my-worker.ts` in the current folder, the binary built without it ran that file (`/tmp/run/my-worker.ts`), while the binary built with it kept running its embedded copy ✅[^lab] | Only bundled entrypoints and embedded files are inside the binary |
| `--compile` with `--public-path`, `--target=node`, or `--target=browser` and a `.ts` entry | Each built a working native executable (`Hello world!`, 109,300,728 bytes, the same size as the plain build), from the CLI and from `Bun.build` (`success: true`) ✅[^lab] | The docs list them as unsupported ✅[^1]; 1.4.5 accepts them without a warning, and so did `1.4.6-canary.1` (all three printed `Hello world!`) ✅[^lab], so do not rely on an error to catch a wrong target |
| musl binary on a bare Alpine image | `Error loading shared library libstdc++.so.6` (exit 127) ✅[^lab] | The musl builds link the C++ standard library dynamically (`readelf -d`); the image must provide `libstdc++.so.6` |
| `Bun.build({ compile: { executablePath: undefined } })` | `executablePath must be a valid path to a Bun executable`, while leaving the key out tried the download ✅[^lab] | An explicit `undefined` counts as set; leave the key out instead |
| `Bun.build({ bytecode: true, target: "browser" })` | `TypeError: target must be 'bun' when bytecode is true` (thrown even with `throw: false`) ✅[^lab] | The CLI `--bytecode` instead switched the output to `// @bun @bytecode @bun-cjs` without a flag ✅[^lab] |
| Bun upgraded on the target but `.jsc` files not rebuilt | Start-up falls back to parsing, with no error ✅[^2]; a damaged, truncated or missing `.jsc` did the same in the lab (`Cache miss`, exit 0), and so did a `.jsc` from 1.3.14 or `1.4.6-canary.1` under 1.4.5, and a 1.4.5 one under those two, with nothing on stderr ✅[^lab] | The bytecode check fails open, so a stale `.jsc` costs only the start-up gain; rebuild it with the Bun that runs it |
| Embedded SQLite written at run time | Writes visible during the run, gone at the next start ✅[^1] ✅[^lab] | The database is a copy in memory |
| `--minify` to shrink the binary | No change in file size for small programs ✅[^lab] | The runtime is over 98% of the file (107,405,304 / 109,300,728) |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `--compile` | One file, no Bun or `node_modules` on the target | 89–115 MB per binary in the Worked example; one binary per OS/CPU |
| `--bytecode` | 1.25–3.75× faster start-up per round, over three sessions and three programs | 0.2–2.6 MB larger here; rebuild for every Bun version |
| `--sourcemap` | Original file and line in stack traces | A stray `.map` file beside the binary; no size change measured for a small program |
| Default config autoload | Per-deployment `.env` and `bunfig.toml` | Behaviour depends on the folder the binary runs in |

## Takeaways
- Cross-compile in CI (continuous integration) for each target with `--target=bun-<os>-<arch>[-musl]`; pick `-musl` for Alpine images. [rule-candidate]
- Build release binaries with `--minify --sourcemap`, and add `--bytecode` for CLIs where start-up time matters. [rule-candidate]
- Pass `--no-compile-autoload-dotenv --no-compile-autoload-bunfig` unless the binary should read per-folder config. [rule-candidate]
- Embed every file the program reads (`with { type: "file" }`, `--asset`), and read it through the import path, not a hand-written relative path.
- Treat an embedded SQLite database as read-only seed data: writes do not persist.

## Verification status
- Verified: 99 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- `linux/lab-setup.md` — the Bun 1.4.5 lab (`oven/bun:1.4.5` image, arm64; the macOS signing runs used the cross-compiled binary on a macOS 26.1 arm64 host (and, on 2026-11-25, the Homebrew-installed `bun` 1.4.5 and a binary compiled on that Mac, both removed afterwards)) where every ✅[^lab] behaviour ran on 2026-11-24. The cross-compiled Linux binaries also ran in `bunlab-amd64/debian:trixie-slim` and `bunlab-amd64/alpine:3.20` (`--platform linux/amd64`, Rosetta emulation under OrbStack) and in `linlab:1` (Alpine 3.20 arm64); `readelf` ran in `bunlab:1`; `file` 5.41 ran on the macOS host; the offline build used `--network none`; the bytecode re-run installed zod 3.25.76 inside the container; `oven/bun:1.3.14` (`1.3.14+0d9b296af`) and `oven/bun:canary` (`1.4.6-canary.1+bd92f9bef`) built and loaded the cross-version `.jsc` files. [^lab]
- [docs/bundler/executables.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/bundler/executables.mdx) — Bun documentation source at the release tag, 2026 (`bun.com/docs/bundler/executables` returned 404 on 2026-11-24; the live page moved to `/docs/compiler/executables` and describes a newer release). Backs: what is embedded, targets, baseline x64, `executablePath`, unsupported flags, workers, config autoload defaults and flags, `--compile-exec-argv`, `BUN_OPTIONS`, `BUN_BE_BUN`, `with { type: "file" }`, `--asset`, `Bun.embeddedFiles`, `isStandaloneExecutable`, text imports, embedded SQLite, zstd source maps, bytecode flag, Windows flags, codesigning. [^1]
- [docs/bundler/bytecode.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/bundler/bytecode.mdx) — Bun documentation source at the release tag, 2026. Backs: what bytecode caching saves, CommonJS `.jsc` files, ESM needing `--compile`, `BUN_JSC_verboseDiskCache`, version tie and silent fallback, not obfuscation, expected speed-ups. [^2]
- [docs/guides/runtime/codesign-macos-executable.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/guides/runtime/codesign-macos-executable.mdx) — Bun documentation source at the release tag, 2026. Backs: `codesign` commands, entitlements, Gatekeeper warning. [^3]
- [Bun 1.4](https://bun.com/blog/bun-v1.4) — Bun blog, 2026. Backs: x64 builds baseline-only, `--asset` new in 1.4.0, no runtime `tsconfig.json`/`package.json` autoload since 1.3.4. [^4]
- [macOS Big Sur 11.0.1 Universal Apps Release Notes](https://developer.apple.com/documentation/macos-release-notes/macos-big-sur-11_0_1-universal-apps-release-notes) — Apple, 2020. Backs: Apple silicon Macs run only signed executables. [^6]
- [Allow execution of JIT-compiled code entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.cs.allow-jit) — Apple, living. Backs: the hardened runtime blocks JIT memory without `allow-jit`; JIT frameworks may fall back to an interpreter. [^7]
- [packages/bun-types/bun.d.ts at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/packages/bun-types/bun.d.ts) — Bun source, 2026. Backs: the `CompileTarget` union (OS, `x64`/`arm64`, `glibc`/`musl`, `baseline`/`modern`), `CompileBuildOptions` fields such as `executablePath`. [^5]

## Related
- `bun/bundler/bun-build.md` — the bundling options `--compile` reuses.
- `bun/bundler/fullstack-dev-server-and-html.md` — full-stack servers with HTML imports, which `--compile` can also embed.
- `bun/system-apis/sqlite-and-sql.md` — `bun:sqlite` queries used on an embedded database.
- `bun/fundamentals/configuration-and-environment.md` — `.env`, `bunfig.toml` and `BUN_OPTIONS` that the binary reads.
- `bun/internals/performance-measured.md` — other start-up measurements and their method.
- `performance/measurement/benchmarking-methodology.md` — why medians and repeated rounds.
