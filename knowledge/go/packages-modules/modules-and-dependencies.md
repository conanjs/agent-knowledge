---
schema: knowledge-doc/v1
type: concept
topic: go/packages-modules
status: verified
applies-to: ["Go 1.27 (go1.27.4)", "Go Modules Reference as of 2026-11", "proxy.golang.org and sum.golang.org as of 2026-11-24 (golang.org/x/sync v0.25.0, modernc.org/sqlite v1.63.0)"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [go, golang, modules, go.mod, go.sum, mvs, minimal-version-selection, goproxy, checksum-database, sum.golang.org, semantic-import-versioning, pseudo-version, retract, go-mod-why, go-mod-download, go-mod-verify, vendoring, workspaces, go.work]
ranked-sources: true
---

# Go modules, minimal version selection and go.sum

## Summary
**TL;DR:** A module is a tree of packages released and versioned together, named by the `module` line of its `go.mod`. Each `require` line is a *minimum* version; minimal version selection (MVS) builds by taking, for every module, the highest minimum that anyone in the graph asks for — so the result is deterministic and needs no lock file. `go.sum` holds the content hash of every module version used, and the public checksum database vouches for first downloads. From v2 on, a new major version is a new import path (`/v2`), so v1 and v2 can be built together. `replace`, workspaces (`go.work`) and vendoring change where the code comes from, not how versions are chosen.
**Use this when:** reading or editing `go.mod`/`go.sum`, wondering why a dependency is at a version you did not ask for, decoding a pseudo-version, meeting a retracted version, checking what the `go` command downloads and verifies, releasing a v2, working on two modules at once, or setting up private modules or an offline build.
**Not this doc:** what MAJOR.MINOR.PATCH means → `versioning/semantic-versioning.md`; packages, imports and `internal/` → `go/packages-modules/packages-and-initialization.md`; the `go` and `toolchain` lines as Go-version switches → `go/introduction/toolchain-and-compatibility.md`; every `go` subcommand and environment variable → `go/tooling/go-command-and-build-reference.md`.

## Problem
Developers who come from package managers that pick the newest compatible release are surprised in both directions: Go keeps a dependency at an old version nobody upgraded, or raises one they never touched because another module asked for more. `go.sum` looks like a lock file but is not one. A library that tags `v2.0.0` without changing its module path breaks its users. A `replace` line in a dependency does nothing. A `go.work` file committed to the repository makes continuous integration test a different set of versions than users get.

## Mental model
**Analogy:** a shared reading list. Every member writes "I need at least edition 1.3 of book C" on the board. The librarian lends, for each book, the highest edition anyone wrote — never a newer one that nobody asked for, so the answer does not change when a publisher prints edition 1.9 tomorrow. A fingerprint card for every edition ever lent (`go.sum`) catches a swapped copy. A second volume with breaking changes gets a new title ("C, volume 2"), so it sits on the shelf next to volume 1.

**Artifact:** the `go.mod` that `go mod tidy` wrote in the lab ✅[^1]:
```text
module example.com/app          // the module path: prefix of every package path in it

go 1.27                         // minimum Go version; also gates language features

require (
	example.com/a v1.2.0        // minimum versions of direct dependencies
	example.com/b v1.2.0
	example.com/d v1.2.0
	example.com/d/v2 v2.0.0     // major version 2 is a different module path
)

require example.com/c v1.4.0 // indirect   (needed, but no package of it is imported here)
```

## How it works
Four actors take part when a build needs a module version that is not yet on the machine:
- **The `go` command** — its job: work out the build list, via minimal version selection over the `go.mod` files (step 3), and fetch each missing `go.mod` or module `.zip`, via the `GOPROXY` list (step 5) ✅[^2].
- **A module proxy, or `direct` version control** — its job: serve the requested version's files, via `https`, `http` or `file` URLs (Uniform Resource Locators) ✅[^2].
- **`go.sum`** — its job: hold the expected hash of every module version the main module uses, via its `h1:` lines (step 4) ✅[^2].
- **The checksum database** — its job: vouch for a hash that `go.sum` does not hold yet, via the public transparent log at `sum.golang.org` (step 4) ✅[^2].

```text
go build (local)
  ├─ go command: read go.mod files, run MVS → build list
  ├─ version already in the read-only module cache? ── yes ──▶ compile
  │
  │  ═══════ network boundary (none with a file:// proxy) ═══════
  ├─ GOPROXY entry 1 ── 404/410 after a comma, any error after a pipe ──▶ next entry … direct
  │        └─ returns the .mod or .zip file
  ├─ go command: hash the download
  │     ├─ go.sum has a line, hashes differ ──▶ SECURITY ERROR, download deleted
  │     ├─ go.sum has no line ──▶ ask the checksum database
  │     │                          (skipped for GOPRIVATE / GONOSUMDB, or GOSUMDB=off)
  │     └─ match ──▶ store in the module cache
  └─ compile
```

1. **Module, path, main module.** A module is a collection of packages released, versioned and distributed together, identified by the module path in its `go.mod` ✅[^2]. The module root is the directory holding `go.mod`; the main module is the one containing the directory where the `go` command runs; a package path is the module path joined with the package's subdirectory ✅[^2]. A module path normally names the repository root, plus `/vN` from major version 2 ✅[^2]. The paths `example` and `test` are reserved for users, so they suit tutorials and tests ✅[^2].
2. **`go.mod` directives.**

   | Directive | Meaning | Applies |
   |---|---|---|
   | `module` | The main module's path; exactly one; a `// Deprecated:` comment marks the module deprecated ✅[^2] | — |
   | `go` | Minimum Go version for the module: advisory before Go 1.21, a hard requirement since then (toolchains refuse a module that declares a newer Go); the compiler rejects language features newer than it; a missing line means `go 1.16` ✅[^2] | — |
   | `toolchain` | A suggested toolchain, used only when this is the main module and the default toolchain is older ✅[^2] | main module only |
   | `godebug` | A GODEBUG default, as if every main package had a `//go:debug` line ✅[^2] | main module only |
   | `require` | Minimum version of a dependency; `// indirect` marks modules no package of the main module imports directly ✅[^2] | — |
   | `tool` | Since Go 1.24: a package that `go tool` can run, replacing the old `tools.go` blank-import workaround ✅[^2] ✅[^5] | — |
   | `ignore` | Since Go 1.25: directories the `go` command skips when matching patterns such as `./...` ✅[^2] ✅[^6] | — |
   | `exclude` | A module version that must not be loaded ✅[^2] | main module only ✅[^2] |
   | `replace` | Use other contents (another module version, or a local directory with its own `go.mod`) for one or all versions of a module ✅[^2] | main module only ✅[^2] |
   | `retract` | Versions of *this* module that others should not depend on; the author publishes a newer version carrying the line ✅[^2] | — |

3. **Minimal version selection.** MVS walks the requirement graph from the main module(s), tracking the highest required version of each module; those versions form the build list — the minimum versions that satisfy every requirement ✅[^2]. `go list -m all` prints it, nothing stores it in a lock file, and it does not change when new versions are released ✅[^2]. `go get` upgrades by adding edges before MVS runs and then records the result in `go.mod`, adding `// indirect` lines where needed ✅[^2]. With `go 1.17` or later, the graph keeps only the direct requirements of each dependency that is itself at `go 1.17` or later (graph pruning) ✅[^2].
4. **`go.sum` and the checksum database.** Each `go.sum` line holds a module path, a version (ending in `/go.mod` when the hash covers only the `go.mod` file) and an `h1:` hash, which is SHA-256 (Secure Hash Algorithm, 256-bit) in base64 ✅[^2] ✅[^1]. When a downloaded file's hash differs from `go.sum`, the `go` command reports a security error and discards the download ✅[^2] ✅[^1]. When `go.sum` has no line yet, the hash may be checked against the checksum database at `sum.golang.org`, a transparent log (a Merkle tree) that anyone can audit ✅[^2]. Modules matched by `GOPRIVATE` or `GONOSUMDB`, or every module when `GOSUMDB=off`, are accepted without that check ✅[^2]. `go.sum` may be missing when every dependency is replaced by a local directory ✅[^2] ✅[^1].
5. **Proxies and private code.** `GOPROXY` is a list of proxy URLs, by default `https://proxy.golang.org,direct`; after a comma the next entry is tried only on HTTP (Hypertext Transfer Protocol) status 404 (Not Found) or 410 (Gone), after a pipe on any error ✅[^2]. URLs may be `https`, `http` or `file`, and the keywords are `direct` (fetch from version control) and `off` (download nothing) ✅[^2]. `GOPRIVATE` lists module-path patterns that skip the proxy and the checksum database, and is the default for `GONOPROXY` and `GONOSUMDB` ✅[^2]. `GOINSECURE` allows plain HTTP but does not turn off checksum-database validation; `GOPRIVATE` or `GONOSUMDB` does that ✅[^3].
6. **Versions and pseudo-versions.** A version is `v` plus a semantic version; versions with major 0 or a pre-release suffix are unstable and carry no compatibility promise ✅[^2]. A pseudo-version such as `v0.0.0-20191109021931-daa7c04131f5` names an untagged commit: a base version, the commit's time in UTC (Coordinated Universal Time) and a 12-character commit-hash prefix ✅[^2]. Commands accept a branch or commit (`go get example.com/mod@master`) and write the pseudo-version for you ✅[^2].
7. **Major version suffixes.** From v2, the module path must end in `/vN` matching the major version; this implements the import compatibility rule — packages with the same import path must be backwards compatible ✅[^2]. `/v0` and `/v1` suffixes are not allowed ✅[^2]. Because `example.com/d` and `example.com/d/v2` are different modules, one build can use both ✅[^1].
8. **Commands.** `go get` changes requirements in `go.mod`: `@v1.2.3`, `@latest`, `@patch`, a branch or commit, or `@none` to remove; with no version it means `@upgrade`; `-u` also upgrades the dependencies of the named packages, and `-tool` adds a `tool` line ✅[^2]. `go install pkg@version` builds a program in module-aware mode and ignores the `go.mod` of the current directory ✅[^2]. `go mod tidy` adds missing requirements and `go.sum` lines and removes unused ones, considering files for every build tag except `ignore` ✅[^2]. For modules at `go 1.27` or later, `go mod tidy` also merges scattered `require` blocks into at most two, one direct and one indirect ✅[^7] ✅[^1]. Downloaded modules live read-only in the module cache, and `go clean -modcache` removes them ✅[^4].
9. **Vendoring.** `go mod vendor` copies every package needed to build and test the main module into `vendor/`, with a manifest in `vendor/modules.txt` ✅[^2]. When `vendor/` exists and the `go` line is 1.14 or later, builds use it as if `-mod=vendor` were set; `-mod=readonly` or `-mod=mod` turn that off ✅[^2] ✅[^3].
10. **Workspaces.** A `go.work` file lists module directories with `use`; together they are the main modules for MVS, and `GOWORK=off` turns workspace mode off ✅[^2]. Hashes needed only by the workspace go to `go.work.sum` ✅[^2]. The reference advises against committing `go.work` in most cases, because it can make continuous integration test versions that users of the module will not get ✅[^2].
11. **Online: one real module through the proxy and the checksum database.** In the lab, with the network allowed and an empty module cache, `go get -x golang.org/x/sync@v0.25.0` in a new module `example.com/app` logged every request it sent. Each `# get` line is later repeated with its result; only the results are shown ✅[^1]. The order of the lines changed from run to run (in a second run the `golang.org/x/sync` `.info` request came first) ✅[^1]:
    In the output below, `$PROXY` stands for `https://proxy.golang.org` and `$SUMDB` for `https://sum.golang.org`; nothing else is changed.
    ```console
    $ go get -x golang.org/x/sync@v0.25.0
    # get $PROXY/golang.org/@v/v0.25.0.info: 404 Not Found (0.268s)
    # get $PROXY/golang.org/x/@v/v0.25.0.info: 404 Not Found (0.279s)
    # get $PROXY/golang.org/x/sync/@v/v0.25.0.info: 200 OK (0.149s)
    go: downloading golang.org/x/sync v0.25.0
    # get $PROXY/golang.org/x/sync/@v/v0.25.0.zip: 200 OK (0.037s)
    # get $PROXY/sumdb/sum.golang.org/supported: 404 Not Found (0.090s)
    # get $SUMDB/lookup/golang.org/x/sync@v0.25.0: 200 OK (0.131s)
    # get $SUMDB/tile/8/0/x277/505: 200 OK (0.037s)      … and 5 more tiles
    # get $PROXY/golang.org/x/sync/@v/v0.25.0.mod: 200 OK (0.036s)
    # get $PROXY/golang.org/x/sync/@v/list: 200 OK (0.034s)
    go: added golang.org/x/sync v0.25.0
    ```
    - **go command → proxy (network):** it asked for `golang.org`, `golang.org/x` and `golang.org/x/sync` at v0.25.0, and only the last one exists ✅[^1]; to find the module that provides a package, the `go` command tries each prefix of the package path ✅[^2].
    - **Proxy (network):** `.info` returns a version's metadata as JSON (JavaScript Object Notation), `.mod` its `go.mod` file, `.zip` its files, and `@v/list` the known tagged versions; these are the endpoints of the GOPROXY protocol ✅[^2].
    - **go command → checksum database (network):** `go.sum` had no line yet, so the `go` command fetched the `/lookup` record and then tiles, sets of hashes that make up sections of the log, to prove the record is in the tree and that the tree was not rewritten ✅[^1] ✅[^2]. It first asked the proxy for `/sumdb/sum.golang.org/supported`, got 404 and then went to `sum.golang.org` itself ✅[^1]; the reference also allows getting sums through a proxy that mirrors the checksum database ✅[^2].
    - **go command (local):** it wrote two lines to `go.sum` and kept the tree data under `cache/download/sumdb/sum.golang.org/` in the module cache ✅[^1] ✅[^2]. Asked directly with `curl` from the same container, the checksum database returned the same two lines; `diff` against `go.sum` printed nothing ✅[^1]:
    ```console
    $ cat go.sum
    golang.org/x/sync v0.25.0 h1:dJnifr0nMV8/SBnBvdo4eSGGnrc3O4FFx6IqvtLcmRs=
    golang.org/x/sync v0.25.0/go.mod h1:sUUOizhqBxiL6pEWpqNLUiaJn1ShEbZ6BBqskPbjZm0=
    $ curl -s https://sum.golang.org/lookup/golang.org/x/sync@v0.25.0
    71041485                                  ← the record's number in the log
    golang.org/x/sync v0.25.0 h1:dJnifr0nMV8/SBnBvdo4eSGGnrc3O4FFx6IqvtLcmRs=
    golang.org/x/sync v0.25.0/go.mod h1:sUUOizhqBxiL6pEWpqNLUiaJn1ShEbZ6BBqskPbjZm0=

    go.sum database tree                      ← signed tree description: size, then head hash
    72110729
    zdo2BBkpda3C0B9eWZHLC0NURHUbArFY+wkD93aPkFw=

    — sum.golang.org Az3grh4AwBGu8g/kLkYODjr6EFuc+T6JIZysq421/K+xkfmRXq4B93ynCvlYQru4jN+tbC8yjXszIExyZetz1Q6aygI=
    ```
    The reference documents this answer as the record number, the `go.sum` lines for that version, and a signed tree description that gives the tree's size and the hash of its head ✅[^2].
12. **Online: versions, pseudo-versions and retractions.**
    ```console
    $ go list -m -versions golang.org/x/sync
    golang.org/x/sync v0.1.0 v0.2.0 v0.3.0 … v0.23.0 v0.24.0 v0.25.0    ← 25 tags (middle cut here)
    $ go list -m -versions golang.org/x/exp
    golang.org/x/exp                                                    ← no tag at all
    $ go list -m golang.org/x/exp@latest
    golang.org/x/exp v0.0.0-20261124000051-d6646c509b6d
    $ go list -m golang.org/x/sync@3ffd83cb522e golang.org/x/sync@f75267d8412f
    golang.org/x/sync v0.22.1-0.20260819171727-3ffd83cb522e             ← an untagged commit
    golang.org/x/sync v0.23.0                                           ← a tagged commit
    ```
    ✅[^1]. `-versions` lists the known versions in semantic-version order, lowest first, and never pseudo-versions ✅[^2]. The untagged commit `3ffd83cb522e`, committed on 2026-08-19 between the tags v0.22.0 (2026-07-01) and v0.23.0 (2026-08-31) ✅[^1], became `v0.22.1-0.20260819171727-3ffd83cb522e`:
    - `v0.22.1-0.` — the base: after a release tag vX.Y.Z (here v0.22.0) the form is vX.Y.(Z+1)-0, which sorts above that tag and below the next one ✅[^2]. `go get` reported going from v0.22.0 to it as an upgrade, and from it to v0.23.0 as another upgrade ✅[^1].
    - `20260819171727` — the commit time in UTC, 2026-08-19 17:17:27; for Git this is the commit time, not the author time ✅[^2] ✅[^1].
    - `3ffd83cb522e` — the first 12 characters of the commit hash ✅[^2].

    `golang.org/x/exp` has no tag, so `@latest` picked a pseudo-version for the tip of the default branch, in the vX.0.0 form used when there is no base version ✅[^2] ✅[^1]. A commit that carries a tag (`f75267d8412f`) resolves to the tag ✅[^2] ✅[^1]. Before accepting a pseudo-version, the `go` command checks that its base tag is an ancestor of the commit, that the time matches the commit, and that the commit belongs to a branch or tag of the repository ✅[^2].

    **A real retraction.** The word comes from academic papers: a retracted paper stays available but should not be built on ✅[^2]. The public module `modernc.org/sqlite` retracts 10 of its versions with 7 `retract` lines in the `go.mod` of its latest version, v1.63.0: `go list -m -versions` listed 166 versions, and 176 with `-retracted` ✅[^1].
    ```console
    $ go list -m -versions modernc.org/sqlite | tr ' ' '\n' | grep -E '^v1\.29\.[3-5]$'
    v1.29.3
    v1.29.5
    $ go list -m -retracted -versions modernc.org/sqlite | tr ' ' '\n' | grep -E '^v1\.29\.[3-5]$'
    v1.29.3
    v1.29.4
    v1.29.5
    $ grep v1.29.4 "$(go env GOMODCACHE)/cache/download/modernc.org/sqlite/@v/v1.63.0.mod"
    retract v1.29.4 // tagged accidentally w/o builders checking the commit
    $ go list -m -retracted -json modernc.org/sqlite@v1.29.4     (outside any module; other fields left out)
    	"Version": "v1.29.4",
    	"Retracted": [
    		"tagged accidentally w/o builders checking the commit"
    	],
    $ go mod edit -require=modernc.org/sqlite@v1.29.4 && go list -m -u -mod=mod modernc.org/sqlite
    modernc.org/sqlite v1.29.4 (retracted) [v1.63.0]
    ```
    ✅[^1]. Retracted versions are hidden from `-versions` unless `-retracted` is given, retractions are read from the `go.mod` of the `@latest` version, and the comment next to a `retract` line is the rationale that `go` commands may show in warnings and in `go list` output ✅[^2]. A build that already depends on a retracted version keeps working; `go list -m -u` tells the user ✅[^2] ✅[^1].
13. **Online: why a module is needed, what was downloaded, and whether the cache is intact.**
    ```console
    $ go mod why golang.org/x/sync/errgroup golang.org/x/sync/semaphore
    # golang.org/x/sync/errgroup
    example.com/app
    golang.org/x/sync/errgroup

    # golang.org/x/sync/semaphore
    (main module does not need package golang.org/x/sync/semaphore)
    $ go mod why -m golang.org/x/sync
    # golang.org/x/sync
    example.com/app
    golang.org/x/sync/errgroup
    $ go mod download -json golang.org/x/sync@v0.25.0       (the Origin URL line left out)
    {
    	"Path": "golang.org/x/sync",
    	"Version": "v0.25.0",
    	"Info": "/go/pkg/mod/cache/download/golang.org/x/sync/@v/v0.25.0.info",
    	"GoMod": "/go/pkg/mod/cache/download/golang.org/x/sync/@v/v0.25.0.mod",
    	"Zip": "/go/pkg/mod/cache/download/golang.org/x/sync/@v/v0.25.0.zip",
    	"Dir": "/go/pkg/mod/golang.org/x/sync@v0.25.0",
    	"Sum": "h1:dJnifr0nMV8/SBnBvdo4eSGGnrc3O4FFx6IqvtLcmRs=",
    	"GoModSum": "h1:sUUOizhqBxiL6pEWpqNLUiaJn1ShEbZ6BBqskPbjZm0=",
    	"Origin": {
    		"VCS": "git",
    		"Hash": "1f920df1e8fcf601d1aaf0f2ea500e1d2ccce105",
    		"Ref": "refs/tags/v0.25.0"
    	}
    }
    ```
    ✅[^1]
    - `go mod why` prints a shortest path in the import graph from the main module to each package, or a note in parentheses when the main module does not need it; with `-m` the arguments are modules ✅[^2].
    - `go mod download -json` prints one JSON object per module: the cached `.info`, `.mod` and `.zip` files, the extracted directory, the two `go.sum` hashes and `Origin`, the module's provenance (where its files came from) ✅[^2]. Here `Origin` named the Git commit and the tag it came from ✅[^1].
    - `go mod verify` printed `all modules verified` ✅[^1]. Then one comment line was appended to `errgroup/errgroup.go` inside a separate module cache. That cache had been filled with `-modcacherw`, which leaves new directories in the module cache writable ✅[^3]; the file itself was still read-only (`-r--r--r--`) and needed `chmod u+w` first ✅[^1].
    ```console
    $ go run .
    Wait: <nil>                                   ← no error: the build does not re-hash the cache
    $ go mod verify; echo "exit $?"
    golang.org/x/sync v0.25.0: dir has been modified (/cache/mod/golang.org/x/sync@v0.25.0)
    exit 1
    $ go clean -modcache && go mod download && go mod verify
    all modules verified
    ```
    ✅[^1]. Commands that read the module cache check hashes stored next to each zip instead of re-hashing the files; `go mod verify` re-hashes each zip and extracted directory against the hash recorded at the first download, and exits non-zero when one changed ✅[^2].

## Worked example
An offline run of the reference's MVS example in the lab, using a file-based proxy (`GOPROXY=file:///src/proxy`) with `GOSUMDB=off`, because these `example.com` modules are not public ✅[^1] ✅[^2]. The main module requires `a v1.2.0` and `b v1.2.0`; `a` requires `c v1.3.0`, `b` requires `c v1.4.0`, and `c` requires `d v1.2.0`. The proxy also has `b v1.3.0` and `d v1.3.0`, which nobody requires.

```console
$ go mod tidy && go list -m all
example.com/app
example.com/a v1.2.0
example.com/b v1.2.0
example.com/c v1.4.0          ← highest minimum (a asked 1.3.0, b asked 1.4.0)
example.com/d v1.2.0          ← v1.3.0 exists, but nobody requires it
example.com/d/v2 v2.0.0
$ go mod graph | grep '^example.com/a@'
example.com/a@v1.2.0 example.com/c@v1.3.0
example.com/a@v1.2.0 go@1.27
$ head -2 go.sum
example.com/a v1.2.0 h1:7UgR48sR8MXzXLcVeky9M+NNFuPZeH/+XWZDaAQCCPA=
example.com/a v1.2.0/go.mod h1:Jc/NNTPVNApMS9s7/8RBi5C5D5kaeHIt5rkbYGOWtJc=
$ go run .
a v1.2.0 -> c v1.4.0 -> d v1.2.0
b v1.2.0 -> c v1.4.0 -> d v1.2.0
d v1.2.0 | d/v2 v2.0.0
$ go list -m -u all | grep '\['
example.com/b v1.2.0 [v1.3.0]
example.com/d v1.2.0 [v1.3.0]
$ go get example.com/b@v1.3.0
go: upgraded example.com/b v1.2.0 => v1.3.0
go: upgraded example.com/d v1.2.0 => v1.3.0     ← b v1.3.0 requires d v1.3.0
$ go run .
a v1.2.0 -> c v1.4.0 -> d v1.3.0                ← c asked for d 1.2.0 and gets 1.3.0
```
The build list matches the reference's diagram (A 1.2, B 1.2, C 1.4, D 1.2) ✅[^2] ✅[^1]. Then the first four characters of the `d v1.2.0` hash in `go.sum` were changed to `AAAA` and the module cache was empty:
```console
$ go run .
verifying example.com/d@v1.2.0: checksum mismatch
	downloaded: h1:I+15vtyCurj46R8UpCZdfcVTLqmGT9EBXkl1w06ZerQ=
	go.sum:     h1:AAAAvtyCurj46R8UpCZdfcVTLqmGT9EBXkl1w06ZerQ=

SECURITY ERROR
```
✅[^1]

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Two dependencies require `c v1.3.0` and `c v1.4.0` | `c v1.4.0` is used by both ✅[^1] | MVS keeps the highest minimum ✅[^2] |
| A newer `d v1.3.0` is published | Nothing changes until someone requires it or you run `go get` ✅[^1] | The build list does not depend on what is newest ✅[^2] |
| Upgrading one module | Others can rise too (`d` with `b`) ✅[^1] | The new version brings higher minimums ✅[^2] |
| `go.sum` hash edited or the download swapped | `SECURITY ERROR`, build stops ✅[^1] | The hash must match `go.sum` ✅[^2] |
| `import "example.com/greet"` with no `require` | `no required module provides package example.com/greet` ✅[^1] | Packages come only from required modules or the workspace ✅[^2] |
| `require …greet v1.0.0` plus `replace …greet => ../greet` | Builds with `GOPROXY=off` and writes no `go.sum` ✅[^1] | Local replacements need no download or hash ✅[^2] |
| A `replace` line inside a dependency's `go.mod` | Ignored ✅[^2] | `replace` and `exclude` apply only in the main module ✅[^2] |
| `replace` without any `require` of that module | No effect ✅[^2] | `replace` does not add a module to the graph ✅[^2] |
| `go.work` with `use ./hello ./greet`, then `GOWORK=off` | Works in the workspace; fails again without it ✅[^1] | `GOWORK=off` disables workspace mode ✅[^2] |
| A broken Go file under `node_modules/` | `go build ./...` fails until `ignore ./node_modules` is added ✅[^1] | Since Go 1.25 `ignore` hides directories from patterns ✅[^6] |
| `require example.com/d v2.0.0` (path without `/v2`) | `version "v2.0.0" invalid: should be v0 or v1, not v2` ✅[^1] | The last path element must match the major version; from v2 the path needs the suffix ✅[^2] |
| `go 1.28` in a dependency, Go 1.27 toolchain | The toolchain refuses the module (or switches toolchains, see the toolchain doc) ✅[^2] | Since Go 1.21 the `go` line is a requirement ✅[^2] |
| A file in the module cache edited after download | `go run .` still builds; `go mod verify` reports `dir has been modified` and exits 1 ✅[^1] | Builds trust the hashes stored at download time; only `go mod verify` re-hashes ✅[^2] |
| `require modernc.org/sqlite v1.29.4`, a retracted version | `go list -m -u` prints `v1.29.4 (retracted) [v1.63.0]` ✅[^1] | Retracted versions keep building; users are told when they check for updates ✅[^2] |
| `mod@<hash>` for a commit that carries a tag | `go list -m` gives the tag (`v0.23.0`), not a pseudo-version ✅[^1] | A revision tagged with a semantic version selects that version ✅[^2] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `replace => ../local` in `go.mod` | Works with any tool; one module | Easy to commit by mistake; ignored when your module is a dependency ✅[^2] |
| `go.work` (not committed) | Edit several modules together without touching `go.mod` ✅[^2] | Each developer keeps their own; continuous integration must not depend on it |
| `go mod vendor` | All source in the repository; builds with no network ✅[^2] ✅[^1] | Large diffs; must be regenerated after every `go.mod` change ✅[^2] |
| Default proxy and checksum database | Fast, cached, tamper-evident downloads ✅[^2] | Module paths are sent to public servers; private code needs `GOPRIVATE` ✅[^2] |

## Takeaways
- Read `go.mod` as minimum versions and `go list -m all` as the truth about what builds. [rule-candidate]
- Commit `go.mod` and `go.sum` together; treat a checksum mismatch as an incident, not something to delete. [rule-candidate]
- Change the module path to `/vN` when you release a breaking major version ≥ 2. [rule-candidate]
- Prefer an uncommitted `go.work` to `replace` lines for local multi-module work, and set `GOPRIVATE` for private module paths. [rule-candidate]
- Pin an untagged commit with `go get mod@<commit-hash>` and let the `go` command write the pseudo-version; never type one by hand ✅[^2]. [rule-candidate]
- Run `go mod verify` before building from a module cache that other tools or jobs can write to; builds alone do not notice edited files. [rule-candidate]

## Verification status
- Verified: 141 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `go/lab-setup.md` — the Go 1.27.4 lab (`golang:1.27.4`) where every behaviour marked with this note ran on 2026-11-24, here with a local file proxy built from `archive/zip`, and online through `proxy.golang.org` and `sum.golang.org` (`golang.org/x/sync` v0.25.0 and the pseudo-version `v0.22.1-0.20260819171727-3ffd83cb522e`, `golang.org/x/exp` at `latest`, `modernc.org/sqlite` v1.29.4 and v1.63.0), with `curl` 8.14.1 from the image for the direct checksum-database query. [^1]
- [Go Modules Reference](https://go.dev/ref/mod) — Go team, living. Rank 1. Backs: modules and paths, versions, pseudo-versions (forms, parts, checks), major version suffixes, go.mod directives, retract, MVS and graph pruning, workspaces and go.work, vendoring, version queries, resolving a package to a module, go get, go install, go list -m (-versions, -retracted, -u), go mod download -json, go mod tidy, go mod verify, go mod why, private modules, the GOPROXY protocol, the module cache, authenticating modules, go.sum, the checksum database (lookup, tiles, proofs, proxying). [^2]
- [Command go](https://pkg.go.dev/cmd/go) — Go team, living. Rank 1. Backs: the `-mod` flag default, `-modcacherw`, `GOINSECURE` and the private-module variables. [^3]
- [How to Write Go Code](https://go.dev/doc/code) — Go team, living. Rank 1. Backs: the read-only module cache and `go clean -modcache`. [^4]
- [Organizing a Go module](https://go.dev/doc/modules/layout) — Go team, living. Rank 1. Background: module and repository layouts.
- [Go 1.24 Release Notes](https://go.dev/doc/go1.24) — Go team, 2025. Rank 1. Backs: `tool` directives and `go get -tool`. [^5]
- [Go 1.25 Release Notes](https://go.dev/doc/go1.25) — Go team, 2025. Rank 1. Backs: the `ignore` directive. [^6]
- [Go 1.27 Release Notes](https://go.dev/doc/go1.27) — Go team, 2026. Rank 1. Backs: `go mod tidy` merging require blocks. [^7]

## Related
- `versioning/semantic-versioning.md` — what a major, minor or patch bump promises.
- `go/packages-modules/packages-and-initialization.md` — packages, imports and `internal/` inside a module.
- `go/introduction/toolchain-and-compatibility.md` — the `go` and `toolchain` lines and GODEBUG.
- `go/tooling/go-command-and-build-reference.md` — `go` subcommands, flags and environment variables.
- `go/learning-path.md` — where this doc sits in the learning order.
