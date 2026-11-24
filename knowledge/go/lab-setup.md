---
schema: knowledge-doc/v1
type: how-to
topic: go
status: verified
applies-to: ["Go 1.27.4", "golang:1.27.4 official image (Debian 13 trixie)", "Docker Engine 29 on OrbStack or Docker Desktop, or any Linux host with Docker"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [go, golang, lab, docker, race-detector, go-test, module-proxy, ptrace, practice]
ranked-sources: true
---

# Run Go examples in a disposable Docker lab

## Summary
**TL;DR:** Pull the official `golang:1.27.4` image (Debian based, with `gcc`), keep the build cache in a named volume, and run each example with `docker run --rm --network none … go run .`. No Go install on the host is needed, every run starts clean, and the race detector works because the image has a C compiler. Every captured output in the `go/` docs comes from this lab.
**Use this when:** you want to reproduce an example from the `go/` docs, try a language rule yourself, or check how a given Go version behaves.
**Not this doc:** what each example shows → the concept doc that quotes it; the order to learn in → `go/learning-path.md`; the Linux lab used by `linux/` → `linux/lab-setup.md`.

## Goal & prerequisites
**End state:** `go version` inside the container prints `go version go1.27.4 linux/<arch>`, `go run`, `go test` and `go run -race` all work, and no file outside your example folder changes.

**Needs:**
- A Docker command-line interface (CLI) with a running engine (OrbStack or Docker Desktop on macOS, Docker or Podman on Linux).
- Network access once, to pull the image (about 900 MB, megabytes, on disk).
- A folder per example; the container sees only that folder.

The reference run used OrbStack (kernel `7.2.12-orbstack`, arm64), Docker Engine 29.8.2 and image digest `golang@sha256:205c7636d74e0ffbe3d007162df7d74f859f5a8c8322dfb9f907977686c126cf`, on 2026-11-24 ✅[^1].

## Steps
1. **Pull the image once.** The tag pins the exact Go release, so every reader gets the same compiler and standard library.
   ```console
   $ docker pull golang:1.27.4
   ```
2. **Create a build-cache volume.** Go keeps compiled packages in its build cache (`GOCACHE`, `/root/.cache/go-build` in this image) ✅[^1]. A named volume keeps that cache between throwaway containers, so the second run of an example compiles only what changed.
   ```console
   $ docker volume create gocache
   ```
3. **Write the example in its own folder.** A single `main.go` with `package main` and `func main()` is enough for `go run main.go`.
   ```go
   package main

   import "fmt"

   func main() { fmt.Println("hello from the lab") }
   ```
4. **Run it with no network.** `--rm` deletes the container afterwards, `--network none` makes sure the example cannot download anything, and `-v "$PWD":/src -w /src` shows the container only the current folder.
   ```console
   $ docker run --rm --network none -v gocache:/root/.cache/go-build \
       -v "$PWD":/src -w /src golang:1.27.4 go run main.go
   hello from the lab
   ```
5. **Create a module before testing.** `go test ./...` needs a main module (a folder with `go.mod`); create one inside the container with `go mod init <name>` ✅[^1] ✅[^2]. The run below had this `main_test.go` next to `main.go`; with no test file the last line reads `?   	lab	[no test files]` instead ✅[^1].
   ```go
   package main

   import "testing"

   func TestOK(t *testing.T) {}
   ```
   ```console
   $ docker run --rm --network none -v gocache:/root/.cache/go-build \
       -v "$PWD":/src -w /src golang:1.27.4 sh -c 'go mod init lab && go test ./...'
   go: creating new go.mod: module lab
   go: to add module requirements and sums:
   	go mod tidy
   ok  	lab	0.001s
   ```
6. **Use the race detector when an example shares memory between goroutines.** Add `-race` to `go run`, `go test` or `go build` ✅[^3]; it needs cgo (Go's support for calling and linking C code), and in this image it works because `CGO_ENABLED` is `1` and `gcc` is installed ✅[^1].
   ```console
   $ docker run --rm --network none -v gocache:/root/.cache/go-build \
       -v "$PWD":/src -w /src golang:1.27.4 go run -race main.go
   ```
7. **Allow the network only for an example that downloads a module or a tool.** Drop `--network none` for that run, pin the exact version, and mount a second volume for the module cache (`GOMODCACHE`, `/go/pkg/mod`), so the download happens once. The default `GOPROXY` sends the download through the Go module proxy ✅[^5]:
   ```console
   $ docker volume create gomodcache
   $ docker run --rm -v gocache:/root/.cache/go-build -v gomodcache:/go/pkg/mod \
       -v "$PWD":/src -w /src golang:1.27.4 sh -c 'go mod init lab && go get golang.org/x/sync@v0.25.0 && go run .'
   go: creating new go.mod: module lab
   go: to add module requirements and sums:
   	go mod tidy
   go: downloading golang.org/x/sync v0.25.0
   go: added golang.org/x/sync v0.25.0
   true
   ```
   The output above is from the lab, with an empty module cache and a `main.go` that calls `errgroup` ✅[^1]. Go's own telemetry stays in its default mode in the image: `go env GOTELEMETRY` prints `local` ✅[^1], and in that mode the counters are kept on the machine and never uploaded ✅[^6].
8. **Give a debugger the ptrace capability only when it attaches to another user's process.** Debuggers such as Delve control the program through the `ptrace` system call. In this lab, Delve started and debugged a program running as the same user with no extra flags, and attaching to a process owned by another user failed until the run added `--cap-add=SYS_PTRACE` ✅[^1]; Delve's own FAQ also advises `--security-opt seccomp=unconfined` for Docker ✅[^7]. Add these flags to that one run only, and check that they took effect:
   ```console
   $ docker run --rm --network none --cap-add=SYS_PTRACE --security-opt seccomp=unconfined \
       golang:1.27.4 grep -E 'CapEff|Seccomp:' /proc/self/status
   CapEff:	00000000a80c25fb
   Seccomp:	0
   ```
   Without the two flags the same command printed `CapEff: 00000000a80425fb` and `Seccomp: 2` ✅[^1]. `go/tooling/debugging-with-delve.md` has the exact errors and the kernel rules.

## Verify
| Check | Command (inside the container) | Expected |
|---|---|---|
| Go version | `go version` | `go version go1.27.4 linux/arm64` (or `linux/amd64` on an x86-64 host) ✅[^1] |
| Toolchain stays local | `go env GOTOOLCHAIN` | `local`: the image never downloads another toolchain ✅[^1] ✅[^4] |
| Cgo is on | `go env CGO_ENABLED` | `1` ✅[^1] |
| Paths | `go env GOROOT GOPATH GOMODCACHE` | `/usr/local/go`, `/go`, `/go/pkg/mod` ✅[^1] |
| Base system | `grep PRETTY /etc/os-release` | `Debian GNU/Linux 13 (trixie)` ✅[^1] |
| Race detector | `go run -race` on two goroutines that both write one `int` | `WARNING: DATA RACE`, then exit status 66 ✅[^1] ✅[^3] |

## Troubleshooting
| Symptom | Cause | Fix |
|---|---|---|
| `go: -race requires cgo; enable cgo by setting CGO_ENABLED=1` | The `golang:1.27.4-alpine` image has no C compiler, so `go env CGO_ENABLED` prints `0` there ✅[^1]; the race detector needs cgo and, on systems other than macOS, an installed C compiler ✅[^3] | Use the Debian-based `golang:1.27.4` image for race and cgo examples |
| `pattern ./...: directory prefix . does not contain main module or its selected dependencies` | `go test ./...` ran in a folder without `go.mod` ✅[^1] | Run `go mod init lab` first (Step 5) |
| `go get …: dial tcp: lookup proxy.golang.org … network is unreachable` | `--network none` blocks the module proxy, which `GOPROXY=https://proxy.golang.org,direct` points to ✅[^1] ✅[^5] | Keep examples to the standard library, or follow Step 7 for that one run |
| Every run recompiles the standard library | The build-cache volume is not mounted | Add `-v gocache:/root/.cache/go-build` |

## Rollback
Remove the cache volumes and the image: `docker volume rm gocache gomodcache` and `docker image rm golang:1.27.4`. Nothing else was installed on the host.

## Takeaways
- Pin the image by its full Go version (`golang:1.27.4`), and record the version next to every captured output, because Go behaviour can change between releases behind a `go` line or a GODEBUG setting. [rule-candidate]
- Run standard-library examples with `--network none`, so they cannot quietly depend on a downloaded module; allow the network only for a run that downloads a pinned module or tool. [rule-candidate]

## Verification status
- Verified: 27 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- Lab run, 2026-11-24: OrbStack kernel `7.2.12-orbstack` (arm64), Docker Engine 29.8.2, image `golang:1.27.4` (Go 1.27.4, Debian 13), plus `golang:1.27.4-alpine` for the cgo comparison; the commands and outputs above. [^1]
- [How to Write Go Code](https://go.dev/doc/code) — Go team, living. Rank 1. Backs: a module is a folder with `go.mod`; `go mod init`. [^2]
- [Data Race Detector](https://go.dev/doc/articles/race_detector) — Go team, living. Rank 1. Backs: the `-race` flag on `go test`, `run`, `build` and `install`; it needs cgo; exit status 66. [^3]
- [Go Toolchains](https://go.dev/doc/toolchain) — Go team, living. Rank 1. Backs: `GOTOOLCHAIN=local` means the bundled toolchain is always used. [^4]
- [Go Modules Reference](https://go.dev/ref/mod) — Go team, living. Rank 1. Backs: `GOPROXY` and its default value. [^5]
- [Go Telemetry](https://go.dev/doc/telemetry) — Go team, living. Rank 1. Backs: `local` is the default mode; local data is never uploaded. [^6]
- [Frequently Asked Questions](https://github.com/go-delve/delve/blob/v1.27.2/Documentation/faq.md) — Delve project, v1.27.2. Rank 1. Backs: `--security-opt=seccomp:unconfined` for Delve in Docker. [^7]
- [golang official image](https://hub.docker.com/_/golang) — Docker official images, living. Rank 1. Background: available tags and variants.

## Related
- `go/learning-path.md` — the order to read the `go/` docs in.
- `linux/lab-setup.md` — the same throwaway-container approach for the Linux, C, Python and Node examples.
