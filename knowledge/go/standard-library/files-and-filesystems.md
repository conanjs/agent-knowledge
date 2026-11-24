---
schema: knowledge-doc/v1
type: concept
topic: go/standard-library
status: verified
applies-to: ["Go 1.27 (go1.27.4)", "os.ReadFile, os.WriteFile, os.ReadDir, os.CreateTemp, os.MkdirTemp, io/fs, os.DirFS, embed, testing/fstest, filepath.WalkDir: Go ≥ 1.16", "filepath.IsLocal: Go ≥ 1.20", "os.CopyFS, filepath.Localize: Go ≥ 1.23", "os.Root: Go ≥ 1.24; Root.MkdirAll, Root.ReadFile, Root.WriteFile, Root.Rename and fs.ReadLinkFS: Go ≥ 1.25", "Lab: Linux (Debian 13, arm64)"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [go, golang, os, files, io-fs, filepath, permissions, umask, close-error, sync, os-root, path-traversal, embed, fstest, walkdir, copyfs]
ranked-sources: true
---

# Files and file systems in Go

## Summary
**TL;DR:** For a whole small file use `os.ReadFile` and `os.WriteFile`; for a stream, `os.Open`, `os.Create` or `os.OpenFile` return an `*os.File`, which is an `io.Reader` and an `io.Writer`. The permission bits you pass are reduced by the process umask, and after writing you must check the error that `Close` returns (and call `Sync` when the data must survive a crash). Use `path/filepath` for operating-system paths and `path` for slash-only paths such as URLs. Code that only reads a tree of files should accept an `io/fs.FS`, so the same code works on `os.DirFS`, an `embed.FS` and a `testing/fstest.MapFS`. When a file name comes from outside, open it through an `os.Root` (Go 1.24): neither `filepath.Join` nor `os.DirFS` stops `..` or a symbolic link from leaving the directory. Failed calls return a `*fs.PathError`; test it with `errors.Is(err, fs.ErrNotExist)`.
**Use this when:** you read, write, list, walk, copy or delete files in Go; choose permission bits; replace a file safely; accept file names from users or archives; write code that must work on embedded files or in-memory test files; or choose between `path` and `path/filepath`.
**Not this doc:** the `io.Reader`/`io.Writer` contract and `bufio` → `go/standard-library/io-and-encoding-json.md`; what `fsync` and the page cache guarantee → `linux/storage/block-io-and-durability.md`; inodes, descriptors and `rename` on Linux → `linux/storage/vfs-and-file-descriptors.md`; how Linux applies the umask → `linux/fundamentals/users-and-permissions.md`; `//go:embed` pattern rules → `go/tooling/go-command-and-build-reference.md`; error wrapping → `go/errors/errors-and-wrapping.md`; flags, environment and child processes → `go/standard-library/command-line-programs.md`.

## Problem
File code usually passes a quick test and then fails in one of a few ways:
- A config file written with `os.WriteFile` can be left half-written by a failure, because `WriteFile` needs several system calls ✅[^2].
- `defer f.Close()` on a file that was written throws away the only report of a failed earlier write: on Linux such an error may be reported only by the final `close` ✅[^15].
- A file created with mode `0666` comes out as `0644`, because the mode is applied "before umask" ✅[^2] ✅[^1].
- A handler builds `filepath.Join(baseDir, name)` from a request, and `../../etc/passwd` or a planted symbolic link opens a file outside `baseDir` ✅[^16].
- Code takes a path string, so its tests need real temporary directories; and a check `err == os.ErrNotExist` stops matching as soon as someone wraps the error.

## Mental model
**Analogy:** the `os` package is a caretaker with a master key: it opens whatever door (path) you name and follows every corridor (symbolic link, a file that points to another path) wherever it leads. An `fs.FS` is a library catalogue: you ask for a shelf mark such as `docs/b.md`, always written with `/`, and get a read-only copy; whether the books live on disk, inside the program binary or in a test's map is hidden from you. An `os.Root` is a key that works only inside one flat: every route out, by `..` or by a corridor that leads elsewhere, is refused at the door.

**Artifact:** one file read three ways; the last comment is the error the lab printed on Go 1.27.4 ✅[^1]:
```go
b, err := os.ReadFile("/srv/data/docs/b.md")   // caretaker: any path, any link

fsys := os.DirFS("/srv/data")                   // catalogue: slash names, read-only
b, err = fs.ReadFile(fsys, "docs/b.md")

root, err := os.OpenRoot("/srv/data")           // flat key: nothing outside /srv/data
defer root.Close()
b, err = root.ReadFile("docs/b.md")             // Root.ReadFile needs Go 1.25
_, err = root.ReadFile("../secret.txt")         // openat ../secret.txt: path escapes from parent
```

## How it works

### Whole files, open flags and permission bits
1. **Whole files.** `os.ReadFile` returns the whole content, and success is `err == nil`, not `io.EOF` ✅[^2]. `os.WriteFile(name, data, perm)` creates the file with `perm` (before umask), or truncates an existing file without changing its permissions ✅[^2]. In the lab, `WriteFile(…, 0666)` under umask `022` gave `-rw-r--r--`, and a second `WriteFile` with `0600` left it at 0644 ✅[^1].
2. **Where they came from.** Go 1.16 moved these helpers out of the deprecated `io/ioutil`: `ioutil.ReadFile` → `os.ReadFile`, `ioutil.TempFile` → `os.CreateTemp`, `ioutil.TempDir` → `os.MkdirTemp`, `ioutil.ReadDir` → `os.ReadDir` ✅[^9].
3. **Opening.** `os.Open` opens read-only (`O_RDONLY`). `os.Create` creates or truncates, with mode 0666 before umask, opened `O_RDWR`. `os.OpenFile(name, flag, perm)` is the general call: exactly one of `O_RDONLY`, `O_WRONLY`, `O_RDWR`, or'ed with any of `O_APPEND`, `O_CREATE`, `O_EXCL` (with `O_CREATE`: the file must not exist), `O_SYNC` and `O_TRUNC` ✅[^2]. Not every flag is implemented on every system ✅[^2].
4. **Permission bits and the umask.** `perm` is an `fs.FileMode` whose nine lowest bits are the Unix `rwxrwxrwx` permissions ✅[^2]. The umask is a per-process stencil laid over the bits you ask for: every bit set in it is removed from each new file and directory, so `0666 &^ 022 = 0644` (the Linux rules are in `linux/fundamentals/users-and-permissions.md`). In the lab, changing the umask from `022` to `077` turned `Create`'s 0644 into 0600 and `MkdirAll(…, 0777)`'s 0755 into 0700 ✅[^1].

### Streams, Close and Sync
Four actors take part when a program writes a file:
- **Your code** — its job: pick the name, flags and permission bits, via `os.OpenFile`, then hand over bytes, via `Write` or any `io.Writer` helper.
- **The `os` package** — its job: turn each method call into a system call (a request from a program to the kernel), via the descriptor (the small number the kernel hands out for an open file) held in the `*os.File` it returns, and each failure into an error, via `*fs.PathError`.
- **The kernel** — its job: apply the umask, via the `open` system call, and hold written bytes in its page cache (memory that stands in for the disk), via `write`.
- **The storage device** — its job: keep the bytes across a power loss, once a flush, via `fsync`, reaches it.

```
your code                  os (*os.File)      kernel                              device
OpenFile(name,flag,perm) ─► open(2)  ───────► new file mode = perm &^ umask
Write(b), io.Copy(f, r)  ─► write(2) ───────► bytes kept in the page cache
Sync()                   ─► fsync(2) ───────► flush ────────────────────────────► stored
Close()                  ─► close(2) ───────► may report an earlier write's error
```

1. **Your code → `os`:** an `*os.File` has `Read`, `Write`, `WriteString`, `ReadFrom` and `WriteTo`, so it plugs into `io.Copy`, `fmt.Fprintf` and `bufio` ✅[^2]; the lab wrote to one with `fmt.Fprintf` and `io.Copy` ✅[^1]. `Write` returns a non-nil error whenever it wrote fewer than `len(b)` bytes, and all `*os.File` methods are safe for concurrent use ✅[^2].
2. **`os` → kernel:** from here on the kernel acts, outside your process. The descriptor carries the open mode, so writing to a file opened with `os.Open` failed with `write w.txt: bad file descriptor` ✅[^1].
3. **`Sync`:** commits the file's current contents to stable storage, usually by flushing the file system's in-memory copy to disk ✅[^2]. What that covers on Linux, and why a new or renamed file also needs a sync of its parent directory, is in `linux/storage/block-io-and-durability.md`.
4. **`Close`:** makes the file unusable and returns an error when called a second time ✅[^2]; the lab printed `close w.txt: file already closed`, which matches `errors.Is(err, os.ErrClosed)` ✅[^1]. On Linux a successful `close` does not mean the data is on disk, an earlier write may fail only at `close` (notably on NFS, the Network File System, and with disk quotas), and a failed `close` must not be retried ✅[^15].
5. **The idiom:** `defer f.Close()` right after a successful open keeps the close next to the open and runs on every return path ✅[^8], which is right for files you only read. For files you write, close explicitly and return its error; when `Write` has already failed, ignore the close error, because the write error "takes precedence", as the `os` examples do ✅[^2].

### Directories and temporary files
1. `os.Mkdir` creates one directory; `os.MkdirAll` also creates the parents, uses `perm` (before umask) for each directory it creates, and returns `nil` when the path is already a directory ✅[^2] ✅[^1].
2. `os.ReadDir` returns all entries sorted by file name and, on error, the entries read so far plus the error ✅[^2]. The sort is by byte value, so the lab listed `Alpha b beta zeta` ✅[^1]. An `fs.DirEntry` gives `Name`, `IsDir`, `Type` and `Info`; `Info` may come from the directory read or from a later call, and fails with `ErrNotExist` if the file has gone since ✅[^3].
3. `os.Remove` removes a file or an empty directory. `os.RemoveAll` removes a tree, removes all it can, returns the first error, and returns `nil` for a path that does not exist ✅[^2]. Lab: `remove a: directory not empty`, and `RemoveAll` of a missing path returned `<nil>` ✅[^1].
4. `os.CreateTemp(dir, pattern)` and `os.MkdirTemp(dir, pattern)` add a random string at the end of `pattern`, or in place of its last `*`. Files get mode 0600 and directories 0700 (before umask); `dir == ""` means `os.TempDir()`; callers running at the same time never get the same name; deleting the result is the caller's job ✅[^2]. Lab: `report-*.txt` became `report-632498502.txt` with mode 0600 ✅[^1]. On Unix `os.TempDir` is `$TMPDIR` or else `/tmp`, and the directory is not guaranteed to exist ✅[^2].

### Rename
`os.Rename(old, new)` replaces `new` when it is an existing file, returns an error when it is an existing directory, may be restricted across directories, and "on non-Unix platforms Rename is not an atomic operation" even within one directory ✅[^2]. Its error is an `*os.LinkError`, which carries both paths ✅[^2]. On Linux in the lab, a rename over a file succeeded, and a rename of a directory onto an *empty* directory failed with `rename d1 d2: file exists` ✅[^1]. The `os` docs promise nothing more about atomicity; what Linux's `rename` guarantees is in `linux/storage/vfs-and-file-descriptors.md`.

### `path` versus `path/filepath`
- `path/filepath` handles the operating system's paths, with `/` or `\` depending on the system; `path` is for slash-only paths such as URLs and does not handle drive letters or backslashes ✅[^4] ✅[^5].
- `filepath.Join` drops empty elements and cleans the result, so `Join("a/b", "../../../xyz")` is `../xyz` ✅[^4]; the lab's `Join("uploads", "../../etc/passwd")` gave `../etc/passwd` ✅[^1]. So `Join` alone does not keep a name inside the base directory.
- `filepath.IsLocal` (Go 1.20) is a *lexical* check, made by reading only the text of the path: the path stays under the directory it is evaluated in, is not absolute, not empty and, on Windows, not a reserved name such as `NUL`; it ignores symbolic links ✅[^4]. `filepath.Localize` (Go 1.23) turns a slash-separated name that passes `fs.ValidPath` into an operating-system path, and its result is always local ✅[^4]. Lab: `IsLocal("a/../../b")` was false, and `Localize("../x")` failed with `invalid path` ✅[^1].

### Walking a tree: `WalkDir` versus `Walk`
1. `filepath.WalkDir` (Go 1.16) passes an `fs.DirEntry`; the older `filepath.Walk` passes an `fs.FileInfo` and is less efficient because it calls `os.Lstat` on every file and directory ✅[^4]. Both walk in lexical order, read a whole directory into memory first, and do not follow symbolic links ✅[^4]; the lab's link to `/etc` was reported with type `L` and not entered ✅[^1].
2. The callback's result steers the walk: `fs.SkipDir` skips the current directory (for a file, the rest of its directory), `fs.SkipAll` skips everything left, and any other non-nil error stops the walk and is returned ✅[^3] ✅[^4].
3. `WalkDir` calls the callback for a directory *before* reading it, so `SkipDir` can avoid the read; when the read fails, it calls the callback a second time with the error ✅[^3]. Run as a non-root user, an unreadable directory appeared twice under `WalkDir` (once clean, once with `permission denied`, which matched `fs.ErrPermission`) and once under `Walk` ✅[^1].
4. `filepath.WalkDir` passes paths with the system's separator; `fs.WalkDir` over an `fs.FS` always passes slash paths ✅[^4].

### The `io/fs.FS` abstraction
1. **The interface.** `fs.FS` has one method, `Open(name)`. Optional interfaces (`ReadFileFS`, `ReadDirFS`, `StatFS`, `SubFS`, `GlobFS`, `ReadLinkFS`) add faster or extra operations, and the helpers `fs.ReadFile`, `fs.ReadDir`, `fs.Stat`, `fs.Sub` and `fs.Glob` use them when present ✅[^3].
2. **Names.** Names are UTF-8 (the standard byte encoding of Unicode text), unrooted and slash-separated (`x/y/z`): no `.`, `..` or empty element, no leading or trailing slash, and `.` alone means the root ✅[^3]. `Open` should reject any other name ✅[^3]; `os.DirFS(dir).Open` failed with `invalid argument` for `../secret.txt`, `/etc/hostname` and even `docs/../a.txt` ✅[^1].
3. **Producers and consumers.** Go 1.16 added `io/fs`, `os.DirFS` (files on disk), `embed.FS` (files compiled into the binary) and `testing/fstest`; `http.FS` and the templates' `ParseFS` consume any `fs.FS` ✅[^9]. An `embed.FS` is read-only and safe to use from many goroutines at once ✅[^7]. The lab used `fs.Sub(content, "static")` to drop a folder prefix from an `embed.FS` ✅[^1].
4. **Helpers.** `fs.Glob` uses `path.Match` patterns, ignores I/O (input/output) errors, and returns only `path.ErrBadPattern` ✅[^3]. `fs.Sub(fsys, dir)` returns the subtree and does not check that `dir` exists ✅[^3].
5. **`os.DirFS` is not a sandbox.** It only guarantees that its `Open` calls start with `dir`, so a symbolic link inside the tree that points outside is followed, and a relative `dir` moves with later `os.Chdir` calls ✅[^2]. In the lab, a relative and an absolute link to `../secret.txt` were both read through `DirFS` ✅[^1]. `Root.FS()` gives an `fs.FS` that blocks such escapes ✅[^2].
6. **Testing.** `fstest.MapFS` maps names to `*MapFile` values; parent directories are synthesized; it suits a few hundred entries, and the map may be edited between operations but must not change while a file-system operation is running on it ✅[^6]. `fstest.TestFS(fsys, expected...)` walks a file system, checks that each file behaves correctly and that the expected files exist ✅[^6]; the lab's failing call reported `expected but not found: logs/missing.log` ✅[^1].
7. **`os.CopyFS` (Go 1.23)** copies any `fs.FS` to disk: files get 0666 plus the source's execute bits, directories 0777 (before umask), and existing files are never overwritten (the error matches `fs.ErrExist`) ✅[^2] ✅[^10]. Since Go 1.25 it copies symbolic links from file systems that implement `fs.ReadLinkFS`, which `os.DirFS` and `Root.FS` do ✅[^12]. Lab: a `MapFile` with mode 0755 arrived as `-rwxr-xr-x`, and a second copy failed with `file exists` ✅[^1].

### `os.Root`: traversal-resistant access
A *path traversal* tricks a program into opening a file other than the one it meant: with `..` in a name, with a symbolic link, or with a link swapped in between a check and the open, a TOCTOU (time-of-check/time-of-use) race ✅[^16].
1. **The rule.** `os.OpenRoot(dir)` opens a directory. Methods on the returned `*os.Root` take names relative to it and fail when any component, `..` or a symbolic link, would leave it; links that stay inside are followed, and links must not be absolute ✅[^2]. `os.OpenInRoot(dir, name)` does both steps in one call ✅[^2].
2. **The mechanism.** On Unix a `Root` holds a descriptor of its directory and resolves names with the `openat` family of system calls, so it keeps pointing at the directory if that is moved ✅[^16] ✅[^2].
3. **Limits.** It does not stop crossing file-system boundaries (Linux bind mounts), `/proc` special files or device files ✅[^2]. On Unix `Root.Chmod`, `Chown` and `Chtimes` can act on a link if the file is swapped during the call, and with `GOOS=js` symbolic-link checks are open to TOCTOU races ✅[^2]. Names with many components or `..` can cost much more than the plain `os` call ✅[^16].
4. **Versions.** Go 1.24 brought `os.Root`, `OpenRoot`, `OpenInRoot` and the methods `Open`, `Create`, `OpenFile`, `Mkdir`, `Remove`, `Stat`, `Lstat`, `OpenRoot` and `FS` ✅[^11] ✅[^2]. Go 1.25 added `Chmod`, `Chown`, `Chtimes`, `Lchown`, `Link`, `MkdirAll`, `ReadFile`, `Readlink`, `RemoveAll`, `Rename`, `Symlink` and `WriteFile` ✅[^12]. Go 1.26 changed `os` only for process handles and Windows open flags, and the Go 1.27 notes list no change to `os`, `io/fs` or `path/filepath` ✅[^13] ✅[^14].
5. **Lab (Go 1.27.4).** `../secret.txt`, `/etc/hostname` and both escaping links failed with `openat …: path escapes from parent`, while `docs/../a.txt` and a link to `docs/b.md` worked. `Root.Symlink("/etc/passwd", "out/pw")` succeeded, because `Symlink` does not check its target ✅[^2], but reading `out/pw` through the root then failed ✅[^1].
6. **When to use it.** Use a `Root` when you open files in one directory and must not touch anything outside it, such as an archive extractor's output directory; a command-line tool that writes to a path its user typed should not use it ✅[^16]. The Go team's rule of thumb: code that calls `filepath.Join` with a fixed directory and an outside file name should probably use `os.Root` instead ✅[^16].

### Errors
Calls that take a file name return a `*fs.PathError` with `Op`, `Path` and `Err` (`os.PathError` is an alias), and its message names the file ✅[^2] ✅[^3]: `open missing.txt: no such file or directory` ✅[^1]. Test the cause with `errors.Is(err, fs.ErrNotExist)` (or `ErrExist`, `ErrPermission`, `ErrClosed`); the older `os.IsNotExist` only understands errors returned by `os` itself ✅[^2]. Wrapping and `errors.As` are in `go/errors/errors-and-wrapping.md`.

## Worked example
Replace `config.json` with new content using the Linux recipe from `linux/storage/block-io-and-durability.md`: write a temporary file in the same directory, sync and close it, set the final mode, rename it over the target, then sync the directory.

```go
func SaveFile(name string, data []byte, perm os.FileMode) (err error) {
	dir := filepath.Dir(name)
	tmp, err := os.CreateTemp(dir, "."+filepath.Base(name)+".tmp-*")
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			os.Remove(tmp.Name()) // never leave the temp file behind on failure
		}
	}()
	if _, err = tmp.Write(data); err != nil {
		tmp.Close() // the Write error is the one to report
		return err
	}
	if err = tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err = tmp.Close(); err != nil { // a late write error can surface here
		return err
	}
	if err = os.Chmod(tmp.Name(), perm); err != nil { // CreateTemp made it 0600
		return err
	}
	if err = os.Rename(tmp.Name(), name); err != nil {
		return err
	}
	d, err := os.Open(dir)
	if err != nil {
		return err
	}
	defer d.Close()
	return d.Sync() // make the new directory entry durable too
}
```

Run on Go 1.27.4 (Linux), replacing `{"port":8080}` with `{"port":9090}` while another handle still has the old file open ✅[^1]:

| Step | Call | Observed |
|---|---|---|
| 1 | `CreateTemp(dir, ".config.json.tmp-*")` | `.config.json.tmp-3764938272` |
| 2 | `Write` | 13 bytes |
| 3 | `Sync`, then `Close` | both `nil` |
| 4 | mode of the temp file before `Chmod` | `-rw-------` (the 0600 of `CreateTemp`) |
| 5 | `Chmod(0644)`, then `Rename` | `nil`; `config.json` is `-rw-r--r--`; the directory holds 1 entry |
| 6 | `Sync` on the directory | `nil` |
| 7 | read through the handle opened before step 1 | still `{"port":8080}` |
| 8 | same call for `nope/x.json` (missing directory) | `open /tmp/save-…/nope/.x.json.tmp-…: no such file or directory` |

Step 4 is the trap: without the `Chmod`, a file that used to be 0644 silently becomes 0600 on its first save. Step 7 shows that a reader keeps the version it opened. The `os` docs make no atomicity promise for `Rename` on Unix and deny it elsewhere ✅[^2], so on other systems this recipe needs its own check.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `os.WriteFile` on an existing file with a new `perm` | Content replaced, mode unchanged (0644 stayed when 0600 was passed) ✅[^1] | `perm` is used only when the file is created ✅[^2] |
| `OpenFile` with `O_CREATE\|O_EXCL` on an existing file | `open w.txt: file exists`; `errors.Is(err, fs.ErrExist)` is true ✅[^1] | With `O_CREATE`, `O_EXCL` requires that the file not exist ✅[^2] |
| Two opens with `O_APPEND\|O_CREATE\|O_WRONLY`, one line each | Both lines, in order ✅[^1] | `O_APPEND` appends on each write ✅[^2] |
| `WriteAt` on an `O_APPEND` file | Returns an error | Documented for `File.WriteAt` ✅[^2] |
| `defer f.Close()` on a file you wrote | An error reported only at close is lost | `close` can carry an earlier write's failure ✅[^15] |
| `os.Rename` onto an existing directory, even an empty one | `rename d1 d2: file exists` ✅[^1] | An existing directory as `newpath` is an error ✅[^2] |
| `File.ReadDir(n)` with `n > 0` | Returns batches, then `io.EOF` | With `n <= 0` it returns everything and a `nil` error ✅[^2] |
| `os.DirFS("rel")` followed by `os.Chdir` | The file system's root moves | A relative `DirFS` root is affected by later `Chdir` calls ✅[^2] |
| `fs.Sub(os.DirFS("/"), "p")` used as a jail | Links inside `p` still lead out | Neither `Sub` nor `DirFS` checks links ✅[^3] |
| `fstest.MapFS` edited while a test reads it | Data race | Operations read the map directly ✅[^6] |
| `os.Root` given an absolute name or an absolute link | `path escapes from parent` ✅[^1] | Names must stay inside and links must not be absolute ✅[^2] |
| `Root.Symlink` to a target outside the root | Created; reading it through the root fails ✅[^1] | `Symlink` does not validate `oldname` ✅[^2] |
| Closing `os.Stderr` | Later panic messages may land in a file opened afterwards | The runtime writes panics and crashes to standard error ✅[^2] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `os.WriteFile` | One line | Can leave a partly written file ✅[^2]; no `Sync` |
| Temp file + `Sync` + `Rename` (worked example) | On Linux, readers see the old or the new file (the kernel side is in `linux/storage/vfs-and-file-descriptors.md`); durable with the directory sync | More code; you set the mode; `Rename` is not atomic on non-Unix systems ✅[^2] |
| Function takes an `fs.FS` | Same code on disk, `embed.FS` and `MapFS` in tests | Read-only; slash names only ✅[^3] |
| `os.DirFS` | Simple; implements `StatFS`, `ReadFileFS`, `ReadDirFS`, `ReadLinkFS` ✅[^2] | Follows links out of the tree ✅[^2] |
| `os.Root` or `Root.FS()` | Refuses `..` and escaping links ✅[^2] | Go ≥ 1.24, many methods ≥ 1.25; slower on long names ✅[^16]; no mount-point protection ✅[^2] |
| `filepath.WalkDir` instead of `Walk` | No `Lstat` per entry; can skip a directory before reading it ✅[^4] ✅[^3] | `DirEntry.Info` is a separate call ✅[^3] |

## Takeaways
- After writing a file, return the error from `Close`; keep `defer f.Close()` for files you only read. [rule-candidate]
- Ask for `0644` files and `0755` directories (`0600`/`0700` for private data) and let the umask reduce them; `perm` never changes an existing file's mode.
- Replace an important file with temp file → `Sync` → `Close` → `Chmod` → `Rename` → directory `Sync`. [rule-candidate]
- Test file errors with `errors.Is(err, fs.ErrNotExist)`, not `==` or `os.IsNotExist`. [rule-candidate]
- Use `path/filepath` for disk paths and `path` only for URLs and `fs.FS` names.
- Make read-only file code take an `fs.FS`, and test it with `fstest.MapFS` and `fstest.TestFS`. [rule-candidate]
- Open a file name that comes from a user, a request or an archive through `os.OpenRoot` or `os.OpenInRoot`, never through `filepath.Join(base, name)`. [rule-candidate]
- Prefer `filepath.WalkDir` to `filepath.Walk`.

## Verification status
- Verified: 124 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `go/lab-setup.md` — the Go 1.27.4 lab (`golang:1.27.4`) where every behaviour marked with this note ran on 2026-11-24, with `--network none`: modes under umask `022` and `077`, open flags, `Close` twice, `ReadDir` order, `Remove`/`RemoveAll`, `Rename` cases, `path`/`filepath` results, `WalkDir` and `Walk` run as user 65534 over an unreadable directory, `DirFS` versus `os.Root` with escaping links, `CopyFS`, `embed.FS`, `fstest.TestFS`, and the `SaveFile` run. [^1]
- [os package](https://pkg.go.dev/os) — Go team, living (page for go1.27.4). Rank 1. Backs: `ReadFile`, `WriteFile`, `Open`, `Create`, `OpenFile` and the flags, `FileMode` bits, "before umask", `File` methods, `Sync`, `Close`, `MkdirAll`, `ReadDir`, `Remove`, `RemoveAll`, `CreateTemp`, `MkdirTemp`, `TempDir`, `Rename` and its atomicity note, `LinkError`, `DirFS`, `CopyFS`, `Root` and its limits, `ErrNotExist` and `IsNotExist`, `Stderr`. [^2]
- [fs package](https://pkg.go.dev/io/fs) — Go team, living. Rank 1. Backs: `FS` and the optional interfaces, path-name rules, `ReadFile`, `Glob`, `Sub`, `WalkDir` and `WalkDirFunc` (double call, `SkipDir`, `SkipAll`), `DirEntry.Info`, `PathError`, `ErrClosed`. [^3]
- [filepath package](https://pkg.go.dev/path/filepath) — Go team, living. Rank 1. Backs: OS separators, `Join`, `IsLocal`, `Localize`, `Walk` versus `WalkDir`, symbolic links not followed, separator in `WalkDir` paths. [^4]
- [path package](https://pkg.go.dev/path) — Go team, living. Rank 1. Backs: `path` is for slash-separated paths such as URLs only. [^5]
- [fstest package](https://pkg.go.dev/testing/fstest) — Go team, living. Rank 1. Backs: `MapFS` (synthesized parents, size, no concurrent edits) and `TestFS`. [^6]
- [embed package](https://pkg.go.dev/embed) — Go team, living. Rank 1. Backs: `embed.FS` is read-only, safe for concurrent use and an `fs.FS`. [^7]
- [Effective Go](https://go.dev/doc/effective_go) — Go team, living. Rank 1. Backs: §Defer (`defer f.Close()` next to the open, run on every return path). [^8]
- [Go 1.16 Release Notes](https://go.dev/doc/go1.16) — Go team, 2021. Rank 1. Backs: `io/fs`, `os.DirFS`, `embed.FS`, `testing/fstest`, `http.FS`, `ParseFS`; `io/ioutil` names moved to `os`. [^9]
- [Go 1.23 Release Notes](https://go.dev/doc/go1.23) — Go team, 2024. Rank 1. Backs: `os.CopyFS`. [^10]
- [Go 1.24 Release Notes](https://go.dev/doc/go1.24) — Go team, 2025. Rank 1. Backs: `os.Root` and `os.OpenRoot`. [^11]
- [Go 1.25 Release Notes](https://go.dev/doc/go1.25) — Go team, 2025. Rank 1. Backs: `fs.ReadLinkFS`, `CopyFS` with symbolic links, the new `Root` methods. [^12]
- [Go 1.26 Release Notes](https://go.dev/doc/go1.26) — Go team, 2026. Rank 1. Backs: the `os` changes in Go 1.26 (`Process.WithHandle`, Windows `OpenFile` flags). [^13]
- [Go 1.27 Release Notes](https://go.dev/doc/go1.27) — Go team, 2026. Rank 1. Backs: no `os`, `io/fs` or `path/filepath` entry among the library changes. [^14]
- [close(2)](https://man7.org/linux/man-pages/man2/close.2.html) — Linux man-pages project, living. Rank 1. Backs: an earlier write error may be reported only at `close`; a successful `close` is not a flush; do not retry. [^15]
- [Traversal-resistant file APIs](https://go.dev/blog/osroot) — Damien Neil, Go team, 2025. Rank 4. Backs: path traversal and TOCTOU, `openat`, cost of long names, who should use `os.Root`, the `filepath.Join` rule of thumb. [^16]

## Related
- `go/standard-library/io-and-encoding-json.md` — `io.Reader`, `io.Writer`, `io.Copy` and `bufio`, which every `*os.File` plugs into.
- `go/standard-library/command-line-programs.md` — arguments, flags, standard streams and child processes.
- `go/errors/errors-and-wrapping.md` — `errors.Is`, `errors.As` and `*fs.PathError` in general.
- `go/tooling/go-command-and-build-reference.md` — the `//go:embed` directive that fills an `embed.FS`.
- `go/tooling/testing-benchmarks-and-fuzzing.md` — where `fstest.MapFS` tests run.
- `linux/storage/block-io-and-durability.md` — `fsync`, the page cache and the directory sync.
- `linux/storage/vfs-and-file-descriptors.md` — inodes, descriptors and `rename` on Linux.
- `linux/fundamentals/users-and-permissions.md` — permission bits and the umask.
- `deno/runtime-apis/files-processes-and-environment.md` — the same tasks in Deno, for comparison.
- `go/learning-path.md`
