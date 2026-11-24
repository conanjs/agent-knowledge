---
schema: knowledge-doc/v1
type: concept
topic: go/packages-modules
status: verified
applies-to: ["Go 1.27 (go1.27.4)", "the Go language specification as of 2026-11"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [go, golang, packages, imports, exported-names, internal, init, initialization-order, blank-import, import-cycle, naming]
ranked-sources: true
---

# Go packages, visibility and initialization order

## Summary
**TL;DR:** A Go package is the set of `.go` files in one directory that share one `package` clause; its import path is the module path plus that directory. A name is exported when it starts with an upper-case letter, and an `internal/` directory limits who may import what is below it. At start-up Go initializes every imported package first, then each package's variables in dependency order, then its `init` functions in source order, all on one goroutine, and only then calls `main.main`.
**Use this when:** a build fails with `undefined: pkg.name`, `imported and not used`, `import cycle not allowed` or `use of internal package … not allowed`; you need to know in which order package-level variables and `init` functions run; or you are naming a package and its exported identifiers.
**Not this doc:** modules, versions and `go.mod` → `go/packages-modules/modules-and-dependencies.md`; declarations, constants and `iota` → `go/fundamentals/declarations-types-and-constants.md`; doc comments on exported names → `code-documentation/doc-comments.md`.

## Problem
Go has no `public` or `private` keywords, no header files and no explicit start-up order, so newcomers trip over rules that live in naming and in the import graph. A lower-case function cannot be called from another package. A leftover import stops the build. Two packages that import each other cannot be built at all. A variable declared later in a file can be initialized first. Code that relies on "this `init` ran before that one" may be relying on something the language does not promise.

## Mental model
**Analogy:** a package is a shop. Items whose label starts with a capital letter sit on the display shelf (exported); everything else stays in the back room (unexported). An `internal/` directory is a staff-only door: only people from the same building — code whose import path starts with the directory above `internal` — may pass. Every morning the shopping centre opens in a fixed way: suppliers (imported packages) open first, each shop then stocks its shelves in the order the goods depend on each other (variable initialization), runs its opening checklist from top to bottom (`init` functions), and only then are customers let in (`main`).

**Artifact:** one module, three packages, and the import path of each:
```text
initorder/                  go.mod: module example/initorder
├── go.mod
├── main.go                 package main   → the program
├── a/a.go                  package a      → import "example/initorder/a"
├── b/b.go                  package b      → import "example/initorder/b"   (imports a)
└── plugin/plugin.go        package plugin → import "example/initorder/plugin"
```

## How it works
1. **Files form a package.** Each source file starts with a package clause, then its imports, then declarations ✅[^2]. Files that share the same package name form one package, and an implementation may require them to sit in one directory ✅[^2]; the `go` command does, and rejects a directory with two package names ✅[^1]. A package's import path is its module path joined with its subdirectory, and standard-library paths have no module prefix ✅[^5].
2. **Naming.** By convention a package name is short, lower case and one word, with no underscores or mixedCaps, and it is the base name of its directory: the package in `encoding/base64` is named `base64` ✅[^3]. The name is only the default name an importer uses, so it need not be unique ✅[^3]; a package named `text` in directory `strutil` still builds, and its importer writes `text.Up()` ✅[^1]. Exported names lean on the package name instead of repeating it: `bufio.Reader`, not `bufio.BufReader`, and `ring.New` as the constructor ✅[^3]. A getter for field `owner` is `Owner`, not `GetOwner`; a setter is `SetOwner` ✅[^3]. Multi-word names use MixedCaps or mixedCaps ✅[^3].
3. **Exported identifiers.** An identifier is exported when its first character is a Unicode upper-case letter (category Lu) and it is declared in the package block, or it is a field or method name ✅[^2]. Everything else is visible only inside its own package, across all of that package's files ✅[^2] ✅[^5].
4. **Imports.** An import declares a dependency and gives access to the imported package's exported identifiers ✅[^2]. The four forms ✅[^2]:

   | Declaration | How `Sin` is named in the file |
   |---|---|
   | `import "lib/math"` | `math.Sin` (the package clause's name) |
   | `import m "lib/math"` | `m.Sin` |
   | `import . "lib/math"` | `Sin` (dot import; Effective Go says avoid it outside tests that must run outside the package ✅[^3]) |
   | `import _ "lib/math"` | not accessible; imported only for its initialization side effects |

   A package may not import itself, directly or through others, and may not import a package without using it ✅[^2] ✅[^1].
5. **`internal` directories.** Code in or below a directory named `internal` can be imported only by code whose import path shares the prefix above `internal` ✅[^4]. The Go team recommends putting supporting packages in `internal/` first, so they can be refactored without breaking other modules ✅[^6].
6. **Initializing one package.** Package-level variables are initialized stepwise: each step picks the variable earliest in declaration order that does not depend on an uninitialized variable ✅[^2]. Dependencies are found from lexical references, followed through function and method bodies, and only within the current package ✅[^2]. Across files, order follows the order files are given to the compiler, and build systems are encouraged to use lexical file-name order ✅[^2]. Then every `init` function runs, in the order it appears in the source ✅[^2]. A package may have many `init` functions, even several in one file, and none of them can be called or referenced ✅[^2] ✅[^3].
7. **Initializing the program.** Imported packages are initialized before the package that imports them, and a package imported by several others is initialized once ✅[^2]. Since Go 1.21 the order between packages is fully specified: all packages are sorted by import path, and each step initializes the first one in that list whose imports are all initialized ✅[^2] ✅[^7]. All of it happens on a single goroutine, one package at a time; an `init` may start goroutines, but the next `init` does not start until the previous one returns ✅[^2]. Then `main.main` runs, and when it returns the program exits without waiting for other goroutines ✅[^2].

## Worked example
The module from the Mental model, run with `go run .` in the lab ✅[^1]. `a` declares `var A = trace("a.A")` and two `init` functions, `b` builds `B` from `a.A`, `plugin` fills a registry in its `init`, and `main.go` declares its variables out of dependency order:

```go
var (
	x = c + y // depends on c and y
	y = f()   // depends on d, through f's body
	c = f()
	d = 3
)

func f() int { d++; return d }
```

```console
$ go run .
init var a.A
init func a #1
init func a #2
init func b, B = b.B uses a.A
init func plugin
init func main, x y c d = 9 4 5 5
main starts: a.A | b.B uses a.A | registered by plugin.init
```

| Step | What ran | Why |
|---|---|---|
| 1 | `a.A`, then `a`'s two `init` functions | `b` and `main` import `a`, so `a` goes first; variables before `init`, and `init`s in source order ✅[^2] ✅[^1] |
| 2 | `b`'s `init` | `b`'s only import, `a`, is done, and `example/initorder/b` sorts before `example/initorder/plugin` ✅[^2]; with `b` moved to a directory named `zb`, `plugin`'s `init` ran before `b`'s ✅[^1] |
| 3 | `plugin`'s `init` | Imported by `main`; it registers itself, which is how blank imports such as `_ "net/http/pprof"` work ✅[^3] |
| 4 | `d = 3`, then `y = f()` → 4, `c = f()` → 5, `x = c + y` → 9 | `x` is first in the source but not ready; `d` is the earliest ready variable — the same order the specification's own example gives ✅[^2] ✅[^1] |
| 5 | `main`'s `init`, then `main.main` | A package's `init` runs after all its variables ✅[^2] |

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `a.go` says `package util`, `b.go` in the same folder says `package helpers` | `found packages util (a.go) and helpers (b.go)` ✅[^1] | The specification lets an implementation require one directory per package ✅[^2], and the `go` command does ✅[^1] |
| `main` uses `a.hidden` | `undefined: a.hidden` ✅[^1] | Lower-case names are not exported ✅[^2] |
| `"os"` imported but not used | `"os" imported and not used`; the build fails ✅[^1] | Unused imports are illegal; while code is half-written, `var _ = fmt.Printf` keeps an import alive ✅[^3] |
| `p` imports `q`, `q` imports `p` | `import cycle not allowed` ✅[^1] | A package may not import itself indirectly ✅[^2] |
| `example.com/m/crash/bang` imports `example.com/m/foo/internal/baz` | `use of internal package … not allowed`; `foo/bar` may import it ✅[^1] | Only paths under `example.com/m/foo` may import below `foo/internal` ✅[^4] |
| `var a = b + 1`, `var b = f()`, `f` returns `a` | `initialization cycle for a` with the chain a → b → f → a ✅[^1] | Variables left uninitialized form a cycle, which makes the program invalid ✅[^2] |
| `x` depends on `a` only through an interface method call | Order of `x` relative to `a` is unspecified ✅[^2] | Dependency analysis ignores interface method calls and other hidden data flow ✅[^2] |
| `main` returns while goroutines still work | The program exits; they are stopped mid-way ✅[^2] | Program execution does not wait for non-`main` goroutines ✅[^2] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Register in `init`, import with `_` | Zero-configuration plug-ins, as `net/http/pprof` does ✅[^3] | Work happens at start-up where callers cannot see it; `init` cannot be called again or tested on its own ✅[^2] |
| An explicit `Setup`/constructor called from `main` | Visible order, can return an error, easy to test | Every caller must remember to call it |
| Keep a package in `internal/` | Free to change its API (application programming interface) ✅[^6] | Other modules cannot reuse it until it is moved out |
| One large package | No import graph to manage | Everything shares one namespace; cycles push code into one place |

## Takeaways
- Name a package after its directory, in lower case, and name exported identifiers so they read well after the package name (`bufio.Reader`, `ring.New`). [rule-candidate]
- Put supporting packages under `internal/` until another module really needs them. [rule-candidate]
- Do not rely on start-up order beyond what the specification promises (imports first, then packages in import-path order, variables by dependency, `init` in source order); prefer explicit set-up functions over `init` with side effects. [rule-candidate]
- An import cycle means a design problem: move the shared piece into a third package that both import.

## Verification status
- Verified: 60 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `go/lab-setup.md` — the Go 1.27.4 lab (`golang:1.27.4`) where every behaviour marked with this note ran on 2026-11-24. [^1]
- [The Go Programming Language Specification](https://go.dev/ref/spec) — Go team, living. Rank 1. Backs: §Packages, §Source file organization, §Package clause, §Import declarations, §Exported identifiers, §Package initialization, §Program initialization, §Program execution. [^2]
- [Effective Go](https://go.dev/doc/effective_go) — Go team, living. Rank 1. Backs: §Names (Package names, Getters, MixedCaps), §Initialization (The init function), §The blank identifier (Unused imports and variables, Import for side effect), dot imports. [^3]
- [Command go: Internal packages](https://pkg.go.dev/cmd/go) — Go team, living. Rank 1. Backs: the `internal` import rule and its example layout. [^4]
- [How to Write Go Code](https://go.dev/doc/code) — Go team, living. Rank 1. Backs: a package is a directory of files compiled together; import path = module path + subdirectory. [^5]
- [Organizing a Go module](https://go.dev/doc/modules/layout) — Go team, living. Rank 1. Backs: keep supporting packages in `internal/`. [^6]
- [Go 1.21 Release Notes](https://go.dev/doc/go1.21) — Go team, 2023. Rank 1. Backs: package initialization order by sorted import path. [^7]

## Related
- `go/packages-modules/modules-and-dependencies.md` — how a module path, its versions and `go.mod` fit around these packages.
- `go/fundamentals/declarations-types-and-constants.md` — declarations, zero values, constants and `iota`.
- `go/tooling/go-command-and-build-reference.md` — build tags and file-name suffixes that decide which files belong to a build.
- `code-documentation/doc-comments.md` — doc comments for exported names.
- `go/learning-path.md` — where this doc sits in the learning order.
