---
schema: knowledge-doc/v1
type: concept
topic: bun/system-apis
status: verified
applies-to: ["Bun 1.4.5"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [bun, file-io, bunfile, bun-write, filesink, stdin, stdout, mime, node-fs, blob]
---

# Bun file I/O: `Bun.file`, `Bun.write` and `FileSink`

## Summary
**TL;DR:** `Bun.file(path)` returns a `BunFile`, a lazy handle that names a file without opening it: creating one for a missing file does not throw, and only a read (`.text()`, `.json()`, `.bytes()`, `.arrayBuffer()`, `.stream()`) fails, with `ENOENT`. `Bun.write(dest, data)` writes strings, bytes, blobs, other files and `Response` bodies in one call, creates missing parent folders and truncates the target. `file.writer()` returns a `FileSink` for incremental writes that you `flush()` and `end()`. Use `node:fs` for everything these two do not cover: folders, appends, renames, permissions.
**Use this when:** reading or writing files in Bun code, copying a file, streaming output to a file or to stdout, or choosing between `Bun.file`/`Bun.write` and `node:fs`.
**Not this doc:** returning a file from an HTTP handler → `bun/http-and-networking/bun-serve.md`; child-process stdin/stdout → [processes-and-shell.md](processes-and-shell.md); measured file I/O speed against Node.js → `bun/internals/performance-measured.md`; S3 objects (`Bun.s3.file`) → [builtin-utilities-reference.md](builtin-utilities-reference.md).

## Problem
Code ported from Node.js expects a file read to happen when the handle is made, so a `Bun.file("config.json")` for a missing file looks fine until a later `await` throws far from the cause. Writers reach for `Bun.write` to append to a log and silently overwrite it, or open a `FileSink` on an existing file and leave old bytes after the new ones. A long-lived `BunFile` held in a variable can return a shortened copy of a file that grew after its `.size` was read.

## Mental model
**Analogy:** a `BunFile` is a library call slip. Writing the slip (the shelf mark) costs nothing and does not check that the book exists; only handing it to the desk (a read) fetches the book or tells you it is missing. `Bun.write` is the photocopier: put anything in (text, bytes, another book) and it produces a fresh copy at the destination, replacing what was there.

**Artifact** (Bun 1.4.5, in a container's `/tmp`) ✅[^lab]:
```ts
const f = Bun.file("missing.txt");    // no error: nothing was opened
f.size;                               // 0
await f.exists();                     // false
await f.text();                       // throws Error: ENOENT: no such file or directory, open 'missing.txt'
                                      //   e.code "ENOENT", e.errno -2, e.syscall "open", e.path "missing.txt"
await Bun.write("deep/a/b/c.txt", "x"); // 1 (bytes) — the folders deep/a/b were created
```

## How it works
Three actors take part in every read or write:
- **Your code** — its job: describe the file and the data, via `Bun.file()` / `Bun.write()` / `file.writer()`.
- **Bun's I/O (input/output) layer** — its job: pick how to move the bytes, via the input and output kinds it sees.
- **The kernel** — its job: move the bytes, via one system call (syscall: a request from a program to the operating system) such as `read`, `write` or `copy_file_range`.

```
your code                        Bun I/O layer                         kernel
Bun.file("a.json") ──────────▶  BunFile {path, type from extension}   (nothing yet)
await file.text()  ──────────▶  open + read ─────────────────────────▶ open(2), read(2)
                                ◀── bytes, or Error ENOENT ────────────
Bun.write(dst, src) ─────────▶  look at (dst kind, src kind) ─────────▶ copy_file_range / sendfile /
                                                                       splice / clonefile / write
```

1. **Creating a handle reads nothing.**
   - `Bun.file(path | URL | fd)` stores where the file is; the docs call it lazily loaded ✅[^1]. A `file://` URL and a numeric file descriptor (fd, the small integer the kernel gives an open file) both work ✅[^lab] ✅[^1].
   - `.type` is a MIME type (Multipurpose Internet Mail Extensions type, the `Content-Type` label such as `application/json`) taken from the extension: `.json` → `application/json;charset=utf-8`, `.ts` and `.js` → `text/javascript;charset=utf-8`, `.png` → `image/png`, `.csv` → `text/csv`, `.wasm` → `application/wasm` ✅[^lab]. A second argument `{ type }` overrides it ✅[^1]: `Bun.file("x.tar", { type: "application/x-tar" }).type` → `application/x-tar` ✅[^lab].
   - `.name` is the path as given, `.lastModified` a millisecond timestamp, `.stat()` a `node:fs` `Stats` object ✅[^lab] ✅[^2].
2. **Reading.** A `BunFile` is a `Blob`, so it has the `Blob` readers ✅[^1]:

   | Call | Returns (lab, 17-byte `data.json`) |
   |---|---|
   | `await f.text()` | the string `{"a":1,"b":[1,2]}` |
   | `await f.json()` | the parsed object; invalid JSON (JavaScript Object Notation) throws `SyntaxError: JSON Parse error: Expected '}'` |
   | `await f.bytes()` | `Uint8Array`, length 17 |
   | `await f.arrayBuffer()` | `ArrayBuffer`, `byteLength` 17 |
   | `f.stream()` | `ReadableStream` of `Uint8Array` chunks (1 chunk here) |
   | `f.slice(2, 5)` | a new `BunFile` for bytes 2–4 (`.size` 3, `.text()` → `a":`); nothing is read or copied until you read it |

   All rows ran in the lab ✅[^lab]; the type definitions say `slice` neither copies nor opens the file ✅[^2], and under `strace` in `bunlab:2` neither `Bun.file()` nor `slice(2, 5)` made a system call, while the later `.text()` made `openat`, `fstat`, `lseek(fd, 2)`, a 3-byte `read` and `close` ✅[^lab]. Converting between `ArrayBuffer`, `Uint8Array`, `Buffer` and strings follows the standard Web and Node rules; the Bun docs keep a full conversion table ✅[^3].
3. **Writing with `Bun.write(destination, data, options?)`.**
   - Destination: a path string, a `file://` URL, a `BunFile`, or `Bun.stdout`/`Bun.stderr` ✅[^1] ✅[^lab].
   - Data: `string`, `Blob` (including a `BunFile`, which makes it a copy), `ArrayBuffer`, `SharedArrayBuffer`, a typed array, a `Response`, and in 1.4.5 also an array of blob parts and a `ReadableStream` ✅[^1] ✅[^2] ✅[^lab].
   - It returns a promise of the number of **bytes** written: `Bun.write("w1.txt", "héllo")` → `6`, because `é` is two bytes in UTF-8 (the usual byte encoding of Unicode text) ✅[^lab].
   - It replaces the whole file: writing `"ab"` over `0123456789` leaves `ab` ✅[^lab].
   - `createPath` (default `true`) creates missing parent folders; `createPath: false` makes the same write fail with `ENOENT` from `open` ✅[^2] ✅[^lab].
   - `mode` (for example `0o600`) sets permissions; in 1.4.5 it took effect only when the data was a `BunFile` (a file copy), see Edge cases ✅[^lab].
4. **Which syscall Bun picks.** Bun looks at the kind of output and input and uses the fastest call the platform has ✅[^1]. The first three columns are the docs' table ✅[^1]; the last is what `strace -f` (a tool that prints every system call a process makes) showed in `bunlab:2` for a 1 MiB input ✅[^lab]:

   | Output | Input | Syscall (docs) | Platform | Observed on Linux, 1.4.5 |
   |---|---|---|---|---|
   | file | file | `copy_file_range` | Linux | One `copy_file_range(src, NULL, dst, NULL, 1048576, 0)`, for a new and for an existing destination (opened with `O_TRUNC`) ✅[^lab] |
   | file | pipe | `sendfile` | Linux | No copy: `Bun.write(path, Bun.stdin)` with stdin a pipe, `Bun.file("/dev/stdin")` and a named FIFO all threw `Non-regular files aren't supported yet` (`errno` 95, `syscall` `"fstat"`), see Edge cases; `Bun.stdin.stream()` as the data worked, with `read`s and 64 KiB `write`s ✅[^lab] |
   | pipe | pipe | `splice` | Linux | `splice(0, NULL, 1, NULL, 65536, 0)` repeated in 64 KiB steps ✅[^lab] |
   | terminal | file or terminal | `sendfile` | Linux | File to a terminal (a pseudo-terminal from `script`): `sendfile(1, fd, NULL, 14)`. Terminal to terminal: `sendfile` failed with `EINVAL`, then `read` + `write` ✅[^lab] |
   | socket | file or pipe | `sendfile` (HTTP, not HTTPS) | Linux | `Bun.serve` answering with a `Bun.file`: `sendfile(socket, fd, [0] => [1048576], 1048576)` over HTTP; over HTTPS no `sendfile`, only `sendto` of encrypted data ✅[^lab] |
   | file (does not exist) | file (path) | `clonefile` | macOS | Not traced (that needs `dtruss` with System Integrity Protection off); shown by effect instead, on APFS (Apple File System) in macOS 26.1 with a 1 GiB file, 5 runs: `Bun.write("new.bin", Bun.file(src))` took a median 0.5 ms (0.3–2.5 ms), and free space moved by −11 to +9 MiB, which is noise (`df` showed about 1 MiB less after two clones); a `BunFile` for a missing path as the destination behaved the same (0.6 ms). After its first 16 bytes were overwritten, the copy differed and the source kept its bytes and whole-file hash: a copy-on-write clone ✅[^lab] |
   | file (exists) | file | `fcopyfile` | macOS | By effect, same file and runs: a median 327 ms (301–338 ms) and 1,017–1,037 MiB less free space, as for a byte copy through `Bun.file(src).stream()` (357 ms, 915–1,036 MiB less): a full copy, no clone ✅[^lab] |
   | file | Blob or string | `write` | Linux and macOS | Traced on Linux only: a string: `openat` without `O_TRUNC`, one `write`, then `ftruncate` to the new length; a 3 MiB `Uint8Array`, a `Blob` and a `Response`: `openat` with `O_TRUNC`, then one `write` ✅[^lab] |

   `copy_file_range` asks the kernel to copy between two open files without passing the bytes through the program ✅[^5]; `clonefile` makes a copy-on-write clone, a copy that shares disk blocks with the original until one side changes ✅[^6]; `sendfile` and `splice` are the same idea for a file into a socket or terminal, and for pipe to pipe ✅[^7] ✅[^8].
5. **Incremental writes with `FileSink`.**
   - `Bun.file(p).writer({ highWaterMark })` returns a `FileSink`. Analogy: a bucket under a tap; `write()` fills the bucket, `flush()` empties it into the file, and when the bucket passes the high water mark (its size in bytes) Bun empties it for you ✅[^1].
   - `write(chunk)` returns the bytes accepted, `flush()` the bytes flushed, `end()` flushes and closes ✅[^1] ✅[^4]. In the lab, after `write("abc")` the file on disk was still 0 bytes; `flush()` returned `3` and the file became 3 bytes ✅[^lab].
   - With `highWaterMark: 8`, writing 13 bytes left the file at 0 bytes synchronously and at 13 bytes 10 ms later, so the automatic flush runs after the current task ✅[^lab].
   - `ref()`/`unref()` decide whether an open pipe keeps the process alive; for a regular file they do nothing ✅[^4] ✅[^lab]. On a FIFO whose reader waited 2 s before reading, a 1 MiB `write()` returned a `Promise` instead of a number; the process stayed alive 2,010 ms and the reader got all 1,048,576 bytes; with `unref()` the process exited after 1 ms and the reader got only 65,536 bytes ✅[^lab].
6. **Standard streams are files.** `Bun.stdin`, `Bun.stdout` and `Bun.stderr` are `BunFile`-style blobs (`constructor.name` is `Blob`, `.type` is `application/octet-stream`) ✅[^1] ✅[^lab]. `await Bun.stdin.text()` read a piped `piped line\n`; `Bun.write(Bun.stdout, "…\n")` and `Bun.stdout.writer()` both printed ✅[^lab].
7. **Deleting.** `await file.delete()` (alias `unlink()`) removes the file; on a missing file it rejects with `ENOENT` from `unlink` ✅[^1] ✅[^2] ✅[^lab].
8. **`node:fs` is the rest.** The docs send folder work (`mkdir`, `readdir`) to `node:fs`, which Bun implements almost completely ✅[^1]. In the lab, `mkdir({ recursive: true })`, `readdir({ recursive: true })` and `appendFile` worked next to `Bun.file` on the same files ✅[^lab].

## Worked example
Copy a config, read it back, log progress with a `FileSink`, then clean up, as one script (Bun 1.4.5 in the lab, `/tmp`) ✅[^lab]:

| Step | Code | Observed |
|---|---|---|
| 1 | `await Bun.write("data.json", JSON.stringify({ a: 1, b: [1, 2] }))` | `17` |
| 2 | `await Bun.write(Bun.file("w5.json"), Bun.file("data.json"))` | `17`; `w5.json` holds `{"a":1,"b":[1,2]}` |
| 3 | `Bun.file("w5.json").type` | `application/json;charset=utf-8` |
| 4 | `(await Bun.file("w5.json").json()).b` | `[1, 2]` |
| 5 | `const w = Bun.file("sink.txt").writer({ highWaterMark: 8 }); w.write("abc")` | returns `3`; file size on disk `0` |
| 6 | `w.flush()` | returns `3`; file size `3` |
| 7 | `w.write("0123456789"); await w.end()` | file holds `abc0123456789` |
| 8 | `await Bun.file("w5.json").delete(); await Bun.file("w5.json").exists()` | `false` |

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `.type` of a path with an unknown or no extension (`a.unknownext`, `noext`) | `application/octet-stream`, not `text/plain;charset=utf-8` ✅[^lab] | The docs call `text/plain;charset=utf-8` the default, but their example is a `.txt` file; the type comes from the extension ✅[^1] |
| Read `.size`, then the file grows, then `.text()` on the same handle | Returns only the old size: a handle that had `.size` = 5 returned `12345` from a 10-byte file ✅[^lab] | The size is cached on the handle once read; a fresh `Bun.file()` returned all 10 bytes ✅[^lab]. Make a new handle per read when the file may change |
| `.size` of a missing file | `0`, no error; `.lastModified` is `4503599627370495` (2^52 − 1) ✅[^lab] | Neither opens the file; only reads, `stat()` and `delete()` report `ENOENT` ✅[^lab] |
| `Bun.file(dir).exists()` on a folder | `false`; `.text()` throws `EISDIR` from `read` ✅[^lab] | `exists()` is true only for regular files and FIFOs (named pipes) ✅[^2]: a FIFO → `true`, `/dev/null` → `false` ✅[^lab] |
| `Bun.write(path, Bun.stdin)` when stdin is a pipe, or `Bun.write(path, Bun.file(fifo))` | Throws `Non-regular files aren't supported yet` (`errno` 95, `syscall` `"fstat"`), 2 of 2 runs, and the destination is already created and truncated: an old file was left at 0 bytes ✅[^lab] | The docs list `sendfile` for a pipe input ✅[^1]; in 1.4.5 pass `Bun.stdin.stream()` instead, which copied all 1 MiB ✅[^lab] |
| `file.writer()` on an existing file | Overwrites from byte 0 and does **not** truncate: `new` over `OLDCONTENT` gave `newCONTENT` ✅[^lab] | `Bun.write` and `file.write()` truncate (`new` over `OLDCONTENT` gave `new`) ✅[^lab]; delete the file first or use `Bun.write` |
| Appending a line | No append option on `Bun.write` or `writer()` ✅[^2]: `{ append: true }` was ignored, and `second` replaced `first` ✅[^lab] | Use `appendFile` from `node:fs/promises` ✅[^lab] |
| `Bun.write(path, "s", { mode: 0o600 })` with string or bytes data | File created `644`; the same option with a `BunFile` as data gave `600` ✅[^lab] | The type definitions offer `mode` for path destinations too, so treat this as a 1.4.5 gap; `chmod` from `node:fs` afterwards ✅[^2] |
| `Bun.write(dst, Bun.file(src))` onto an existing file, on macOS | A full copy: 327 ms and 1 GiB of disk for a 1 GiB file, against 0.5 ms and no space when `dst` did not exist (5 runs) ✅[^lab] | Only a missing destination gets `clonefile`; an existing one gets `fcopyfile` ✅[^1]. Delete `dst` first when you want the clone |
| Permissions and times of a macOS clone | A source with mode `640` copied to a new path gave `640` (Linux: `644`, from the umask), and the copy kept the source's modification time; `mode: 0o600` still gave `600`; a copy onto an existing `600` file kept `600` ✅[^lab] | `clonefile` gives the new file the source's attributes ✅[^6]; set `mode` or `chmod` if the copy needs other permissions |
| `mode: 0o1777` | `RangeError: The value of "mode" is out of range. It must be >= 0 and <= 511. Received 1023` ✅[^lab] | Only permission bits `0`–`0o777` are allowed ✅[^2] |
| `FileSink` never `end()`-ed, regular file | The process exited with code 0, 0 ms after the script's first line in 5 of 5 runs, and the data was on disk ✅[^lab] | The docs say the process stays alive until `.end()` ✅[^1]; the type definitions limit that to pipes and FIFOs ✅[^4]. In `bunlab:2` a small flushed write to a FIFO, or to stdout piped into `cat`, without `end()` also exited at once; only a write still waiting for its reader kept the process alive (step 5) ✅[^lab]. Call `end()` anyway, to close the fd |
| `w.write("x")` after `w.end()` | No error, and nothing written ✅[^lab] | The sink is closed; a lost write is silent |
| `Bun.write(path, { a: 1 })` or `Bun.write(path, 42)` | Writes `[object Object]` or `42` ✅[^lab] | Unknown data is turned into a string; pass `JSON.stringify(obj)` |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `Bun.file()` + `.text()/.json()` | One line, lazy, MIME type for free, works as a `Response` body | Whole file in memory; stale `.size` on long-lived handles |
| `Bun.write()` | Any data kind, fast copy syscalls, creates folders | Always replaces the file; `mode` only for file copies in 1.4.5 |
| `FileSink` | Many small writes without one syscall each | Does not truncate; you must `flush()`/`end()`; lost writes after `end()` are silent |
| `node:fs` | Folders, append, rename, `chmod`, same API as Node.js | More code for simple reads; no MIME type or `Response` integration |

## Takeaways
- Treat `Bun.file()` as a name, not an open file: wrap the first read (not the `Bun.file()` call) in `try`/`catch`, or check `await f.exists()` when a missing file is expected. [rule-candidate]
- Create a fresh `Bun.file()` for each read of a file that other code may change; never keep one handle and re-read it after reading `.size`. [rule-candidate]
- Use `Bun.write` only to replace a whole file; append with `node:fs` `appendFile`. [rule-candidate]
- Before `file.writer()` on a path that may exist, delete it or write `""` first, then `end()` the sink. [rule-candidate]
- To save piped input to a file, pass `Bun.stdin.stream()` to `Bun.write`, never `Bun.stdin` itself. [rule-candidate]
- For a cheap copy of a large file on macOS, delete the destination before `Bun.write(dst, Bun.file(src))`, so Bun can clone it instead of copying every byte. [rule-candidate]

## Verification status
- Verified: 87 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- `linux/lab-setup.md` — the Bun 1.4.5 lab (`oven/bun:1.4.5` image, and `bunlab:2`, which adds strace 6.13, for the syscall table, `slice` laziness and FIFO checks; arm64) where every ✅[^lab] behaviour ran on 2026-11-24; the macOS rows ran a Bun 1.4.5 binary cross-compiled with `bun build --compile --target=bun-darwin-arm64` and run as the full CLI (`BUN_BE_BUN=1`) with an isolated environment on macOS 26.1 (Apple M2, APFS), measuring time with `performance.now()` and free space with `statfs` and `df`; the 1 GiB files and the binary were deleted afterwards. [^lab]
- [File I/O (docs at bun-v1.4.5)](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/file-io.mdx) — Bun documentation in the Bun repository (Oven), 2026. Backs: lazy `BunFile`, readers, MIME override, stdio as `BunFile`, `delete()`, `Bun.write` inputs and destinations, the syscall table, `FileSink`, `node:fs` for folders. [^1]
- [packages/bun-types/bun.d.ts at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/packages/bun-types/bun.d.ts) — Bun source (Oven), 2026. Backs: `createPath` and `mode` options, extra `Bun.write` inputs, `slice`, `exists()` for FIFOs, `stat()`, `unlink()`. [^2]
- [Binary Data (docs at bun-v1.4.5)](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/binary-data.mdx) — Bun documentation in the Bun repository (Oven), 2026. Backs: conversions between buffers, views, blobs and streams. [^3]
- [packages/bun-types/s3.d.ts at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/packages/bun-types/s3.d.ts) — Bun source (Oven), 2026. Backs: the `FileSink` interface, return values, `ref()`/`unref()` only for pipes and FIFOs. [^4]
- [copy_file_range(2)](https://man7.org/linux/man-pages/man2/copy_file_range.2.html) — Linux man-pages project, living. Backs: in-kernel copy between file descriptors. [^5]
- [clonefile(2)](https://www.manpagez.com/man/2/clonefile/) — Apple macOS manual page (mirror linked from Bun's type definitions), living. Backs: copy-on-write clones. [^6]
- [sendfile(2)](https://man7.org/linux/man-pages/man2/sendfile.2.html) — Linux man-pages project, living. Backs: in-kernel copy from a file into another descriptor such as a socket. [^7]
- [splice(2)](https://man7.org/linux/man-pages/man2/splice.2.html) — Linux man-pages project, living. Backs: in-kernel move of data between a pipe and another descriptor. [^8]

## Related
- `bun/system-apis/processes-and-shell.md` — `Bun.file` and `Response` as child-process stdin/stdout.
- `bun/http-and-networking/bun-serve.md` — serving a `BunFile` as a response.
- `bun/internals/performance-measured.md` — file I/O measured against Node.js 24.
- `linux/lab-setup.md` — the lab.
