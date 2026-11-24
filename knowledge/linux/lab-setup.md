---
schema: knowledge-doc/v1
type: how-to
topic: linux
status: verified
applies-to: ["macOS with OrbStack or Docker Desktop", "any Linux host with Docker or Podman", "Alpine 3.20 lab image", "node:24.22.1-alpine image", "rust:1.100.0-slim image (rustlab:1)"]
last-verified: 2026-11-04
last-updated: 2026-11-24
tags: [linux, lab, docker, orbstack, privileged-container, strace, unshare, cgroups, practice, node, python, gcc, rust, cargo, miri]
---

# Build a disposable Linux kernel lab

## Summary
**TL;DR:** Build a small Alpine image with the Linux tools these docs use (`strace`, `unshare`, `ip`, `iptables`/`nft`, `procps`, `sysstat`, Python), and run it as a **privileged, throwaway** container. On macOS the container runs inside OrbStack's or Docker Desktop's Linux VM, so you get a real Linux kernel to experiment on (namespaces, cgroups, overlayfs, netfilter) without touching a real server. Every captured output in the `linux/` docs comes from this lab.
**Use this when:** you want to reproduce an example from the `linux/` docs, practise a mechanism hands-on, or check how a kernel feature behaves on a given version.
The same lab, plus the official Node and Rust images, also produced the measurements in `floating-point/` (C and Python), `javascript/` (Node.js) and `rust/` (Rust).
**Not this doc:** what each experiment shows → the concept doc that quotes it; the order to learn in → `linux/learning-path.md`.

## Goal & prerequisites
**End state:** a shell inside a privileged Linux container where `uname -r` prints the VM's kernel version, and `unshare`, `strace`, `ip netns` and cgroup writes all work.

**Needs:**
- Docker CLI with a running engine: OrbStack or Docker Desktop on macOS, or Docker/Podman on Linux.
- Network access once, to pull `alpine:3.20` and its packages (for Rust: `rust:1.100.0-slim`, the rustup components and targets of step 11, and the crates.io crates the `rust/` docs use).
- Accept that `--privileged` gives the container full control of the **VM's** kernel. Use it only for this lab, never for real workloads (see `containers/container-isolation.md`).

The reference run used OrbStack with kernel `6.17.8-orbstack`, arm64, Docker Engine 28.5.2, Alpine 3.20, on 2026-11-04 ✅[^1].

## Steps
1. **Create a folder and the Dockerfile.**
   ```dockerfile
   # linlab/Dockerfile
   FROM alpine:3.20
   RUN apk add --no-cache util-linux iproute2 strace procps-ng iptables nftables \
       coreutils bash gcc musl-dev python3 sysstat
   ```
2. **Build it.**
   ```console
   $ docker build -t linlab:1 linlab/
   ```
3. **(For the container-from-scratch experiment) export a root filesystem** to use as an image layer.
   ```console
   $ docker create --name rootsrc alpine:3.20
   $ docker export rootsrc -o linlab/alpine-rootfs.tar && docker rm rootsrc
   ```
4. **Start a privileged, throwaway shell** with the folder mounted at `/lab`.
   ```console
   $ docker run --rm -it --privileged -v "$PWD/linlab:/lab" linlab:1 bash
   ```
5. **Before creating cgroups by hand, move existing processes into a child cgroup.** cgroup v2 refuses to enable controllers for children of a cgroup that still holds processes (`EBUSY`) ✅[^2]:
   ```console
   # mkdir -p /sys/fs/cgroup/init
   # for p in $(cat /sys/fs/cgroup/cgroup.procs); do echo $p > /sys/fs/cgroup/init/cgroup.procs 2>/dev/null; done
   # echo "+memory +cpu +pids" > /sys/fs/cgroup/cgroup.subtree_control
   ```
6. **Put overlay experiments on a `tmpfs`**, because the container's own root is already an overlay and cannot be an upper layer ✅[^1]:
   ```console
   # mkdir -p /o && mount -t tmpfs tmp /o
   ```
7. **Run an experiment** from a doc, for example from `containers/namespaces.md`:
   ```console
   # unshare --pid --fork --mount-proc ps -o pid,ppid,comm
   ```
8. **Leave with `exit`.** `--rm` deletes the container, its namespaces, cgroups, veths and NAT rules.
9. **For C or Python language experiments** (the `floating-point/` docs), the same `linlab:1` image works without `--privileged`; it ships GCC 13.2.1 and Python 3.12.13 ✅[^1]:
   ```console
   $ docker run --rm -v "$PWD/linlab:/lab" -w /lab linlab:1 sh -c 'gcc -O0 -frounding-math -o fpc fp.c -lm && ./fpc; python3 fp.py'
   ```
10. **For JavaScript experiments** (the `javascript/` docs), use the official Node image; no privileges are needed ✅[^1]:
   ```console
   $ docker run --rm -v "$PWD/jslab:/j" -w /j node:24.22.1-alpine node checks.js
   $ docker run --rm -v "$PWD/jslab:/j" -w /j node:24.22.1-alpine node --expose-gc gc.js   # garbage-collection tests
   ```
11. **For Rust experiments** (the `rust/` docs), extend the official Rust image. Its `slim` variant installs only the minimal rustup profile (`rustc`, `cargo`, `rust-std`) ✅[^3] ✅[^4], so add the linters, two cross-compilation targets, a nightly toolchain with Miri (the undefined-behaviour checker), and `llvm-tools`, whose `llvm-profdata` merges profiles for profile-guided optimization ✅[^3]:
   ```dockerfile
   # rustlab/Dockerfile
   FROM rust:1.100.0-slim
   RUN rustup component add clippy rustfmt \
    && rustup target add thumbv7em-none-eabihf wasm32-unknown-unknown \
    && rustup toolchain install nightly --profile minimal --component miri,rust-src \
    && cargo +nightly miri setup \
    && rm -rf /usr/local/cargo/registry
   RUN rustup component add llvm-tools
   ENV TZ=UTC
   WORKDIR /lab
   ```
   Build it, create a volume that caches crates.io downloads across runs, then run single files with `rustc` or Cargo projects with `cargo`; no privileges are needed ✅[^3]:
   ```console
   $ docker build -t rustlab:1 rustlab/
   $ docker volume create rustlab-cargo
   $ docker run --rm -v "$PWD/rs:/lab" rustlab:1 sh -c 'rustc --edition 2024 -o /tmp/a demo.rs && /tmp/a'
   $ docker run --rm -v rustlab-cargo:/usr/local/cargo/registry -v "$PWD/proj:/lab" rustlab:1 cargo run -q
   $ docker run --rm -v rustlab-cargo:/usr/local/cargo/registry -v "$PWD/proj:/lab" rustlab:1 cargo +nightly miri run
   ```
   The Dockerfile pins stable but not nightly: `rustup toolchain install nightly` takes whatever nightly is current on the build day ✅[^4], so nightly-only output (Miri reports, `-Z` flags) can differ after a rebuild; install a dated nightly (`nightly-YYYY-MM-DD`) instead to pin it ✅[^4]. The `llvm-tools` line was added after the first build: Docker reused the cached layer above it, so the nightly stayed the same build ✅[^3].

## Verify
```console
# uname -r
6.17.8-orbstack-00308-g8f9c941121b1
# grep CapEff /proc/self/status
CapEff:	000001ffffffffff              # privileged: all capabilities
# unshare --uts sh -c 'hostname lab-ok; hostname'
lab-ok
# cat /sys/fs/cgroup/cgroup.subtree_control      # after step 5
cpu memory pids
```
Values measured on the reference run ✅[^1]. Your kernel version string will differ.

For the language images ✅[^1]:
```console
$ docker run --rm linlab:1 sh -c 'gcc --version | head -1; python3 --version'
gcc (Alpine 13.2.1_git20240309) 13.2.1 20240309
Python 3.12.13
$ docker run --rm node:24.22.1-alpine node -e 'console.log(process.version, Intl.DateTimeFormat().resolvedOptions().timeZone)'
v24.22.1 UTC
```
The Node container's time zone is UTC, which the `Date` results in `javascript/` depend on.

For the Rust image ✅[^3]:
```console
$ docker run --rm rustlab:1 sh -c 'rustc -V; cargo -V; rustc +nightly -V; cargo +nightly miri --version; rustup target list --installed'
rustc 1.100.0 (0ef1bc386 2026-11-09)
cargo 1.100.0 (3acc79c0c 2026-11-05)
rustc 1.102.0-nightly (20fe935d5 2026-11-23)
miri 0.1.0 (20fe935d50 2026-11-23)
aarch64-unknown-linux-gnu
thumbv7em-none-eabihf
wasm32-unknown-unknown
$ docker run --rm rustlab:1 sh -c '$(rustc --print sysroot)/lib/rustlib/aarch64-unknown-linux-gnu/bin/llvm-profdata --version | sed -n 2p'
  LLVM version 23.1.5-rust-1.100.0-stable
```

## Troubleshooting
| Symptom | Cause | Fix |
|---|---|---|
| `unshare: unshare failed: Operation not permitted` | Container started without `--privileged` (default capabilities and seccomp) | Restart with `--privileged` ✅[^1] |
| `write error: Resource busy` on `cgroup.subtree_control` | Processes still in that cgroup | Step 5 ✅[^1] ✅[^2] |
| `overlay: filesystem on … not supported as upperdir` | Upper dir on an overlay mount | Step 6 ✅[^1] |
| `Permission denied` writing `memory.max` in a new cgroup | Controller not enabled in the parent's `subtree_control` | Step 5, then recreate the child cgroup ✅[^1] |
| `/proc/pressure` missing | Kernel built or booted without PSI | Use `vmstat`, `cpu.stat`, `memory.events` instead ✅[^1] |
| Busybox tool lacks an option (`readlink a b`, `ip -br`) inside a hand-built rootfs | The Alpine rootfs uses Busybox applets | Use one argument per call or copy the util-linux binary in ✅[^1] |
| Values differ from the docs (e.g. `overcommit_memory = 1`, `swappiness = 20`) | The VM vendor sets its own sysctls | Compare with the kernel defaults cited in the concept docs ✅[^1] |

## Rollback
Nothing to undo on the host: everything lives in the throwaway container (`--rm`). Remove the image with `docker rmi linlab:1` and delete the `linlab/` folder. For Rust: `docker rmi rustlab:1 rust:1.100.0-slim` and `docker volume rm rustlab-cargo`.

## Takeaways
- Run kernel experiments only in a throwaway privileged container or VM, never on a shared host.
- Before manual cgroup work, move existing processes into a child cgroup; put overlay experiments on a `tmpfs`.

## Verification status
- Verified: 23 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-04

## References
- Reference lab run of 2026-11-04 — OrbStack on macOS, Linux 6.17.8-orbstack, arm64, Docker Engine 28.5.2, Alpine 3.20 (GCC 13.2.1, Python 3.12.13) and `node:24.22.1-alpine` (Node.js 24.22.1, time zone UTC): build, privileged runs, `EBUSY`, upperdir error, missing PSI, Busybox limits, VM sysctls and the language versions were all observed directly. [^1]
- [Control Group v2](https://docs.kernel.org/admin-guide/cgroup-v2.html) — Linux kernel documentation, living. Backs: no internal process rule for enabling controllers. [^2]
- [OrbStack architecture](https://docs.orbstack.dev/architecture) — OrbStack, living. Backs: containers on macOS run in a Linux VM.
- [Docker run reference: runtime privilege](https://docs.docker.com/reference/cli/docker/container/run/#privileged) — Docker, living. Backs: what `--privileged` grants.
- [node (Docker Official Image)](https://hub.docker.com/_/node) — Docker Hub, living. Background: the official Node.js image tags.
- Rust lab run of 2026-11-24 — OrbStack on macOS, arm64, Docker Engine 29.8.2, `rust:1.100.0-slim` extended to `rustlab:1` (rustc and cargo 1.100.0, clippy 0.1.100, rustfmt 1.11.0, rustc 1.102.0-nightly with Miri, Debian GCC 14.2.0 as the linker, time zone UTC; `llvm-tools` with LLVM 23.1.5 added in a later layer the same day): the build, the reused cache layer, the installed components and targets, and the version output were observed directly. [^3]
- [Profiles](https://rust-lang.github.io/rustup/concepts/profiles.html) and [Channels](https://rust-lang.github.io/rustup/concepts/channels.html) — The rustup book, Rust project, living. Backs: what the minimal profile installs; installing a channel takes its current release. [^4]
- [rust (Docker Official Image)](https://hub.docker.com/_/rust) — Docker Hub, living. Background: the official Rust image tags and variants.

## Related
- `linux/learning-path.md` — which experiment to run at which stage.
- `linux/containers/container-from-primitives-deep-dive.md` — the biggest experiment: a container built by hand.
- `floating-point/`, `javascript/` and `rust/` — the language docs measured in this lab.
