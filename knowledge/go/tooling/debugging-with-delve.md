---
schema: knowledge-doc/v1
type: how-to
topic: go/tooling
status: verified
applies-to: ["Go 1.27 (go1.27.4)", "Delve v1.27.2", "Linux containers (lab: golang:1.27.4 on linux/arm64, kernel 7.2)"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [go, golang, debugging, delve, dlv, breakpoints, goroutines, dlv-debug, dlv-test, dlv-attach, dlv-core, ptrace, core-dump, gotraceback, gdb, docker]
ranked-sources: true
---

# Debug Go programs with Delve

## Summary
**TL;DR:** Install Delve at a pinned version (`go install github.com/go-delve/delve/cmd/dlv@v1.27.2`) and start it with `dlv debug`, which builds your package with `-gcflags "all=-N -l"` (no optimizations, no inlining) so every line and variable stays visible. A session can run unattended: put the commands in a file and run `dlv debug --init <file> --allow-non-terminal-interactive=true`. `dlv test` does the same for a package's tests, `dlv attach <pid>` takes over a running process through the kernel's ptrace interface (another user's process needs the `CAP_SYS_PTRACE` capability), and `dlv core <binary> <core>` opens a crash dump written with `GOTRACEBACK=crash`. Prefer Delve to GDB (the GNU Debugger) for Go code: the Go documentation calls GDB unreliable for Go programs.
**Use this when:** you need to stop a Go program at a line and look at its values, goroutines and call stack; step into one failing test; inspect a process that is already running; or read a crash dump, including inside a Docker container.
**Not this doc:** reading a panic's stack trace without a debugger → `go/errors/panic-and-recover.md`; CPU and memory profiles, execution traces → `go/runtime/profiling-and-diagnostics.md`; what inlining and other optimizations do → `go/runtime/compiler-optimizations.md`; Docker capabilities and seccomp in general → `linux/containers/container-isolation.md`.

## Goal & prerequisites
**End state:** `dlv version` prints `Version: 1.27.2`; a scripted session stops at a breakpoint and prints arguments, locals, goroutines and a stack; `dlv test` stops inside one test case; `dlv attach` attaches to a running process and leaves it running; `dlv core` shows the frame that panicked in a crash dump.

**Needs:**
- The lab from `go/lab-setup.md` (image `golang:1.27.4`, the `gocache` volume), plus a `gomodcache` volume and network access to the Go module proxy for the one-time install.
- A platform Delve supports: its FAQ lists linux/amd64, linux/arm64, linux/386, windows/amd64 and darwin/amd64 ✅[^10]; the lab ran on linux/arm64 ✅[^1].
- Go 1.16 or later, to install with `go install …@<version>` ✅[^2]. Delve checks the Go version by default and exits if it is too old or too new for it (`--check-go-version`, default true) ✅[^4]; Delve v1.27.2 accepted Go 1.27.4 ✅[^1].

**Words used below:**
- A **debugger** is a pause button with a magnifying glass: it controls a running program's execution and shows its variables, goroutines and CPU (central processing unit) registers ✅[^3]. Delve is a source-level debugger written for Go ✅[^3].
- A **breakpoint** is a bookmark that says "stop here". `break main.go:20` stops the program when a goroutine reaches line 20 of `main.go`; `break main.go:20 if o.ID == 1` stops only when the condition holds ✅[^9].
- **ptrace** is the Linux kernel's remote control for another process: through the `ptrace()` system call one process (the tracer) observes and controls another (the tracee) and reads or changes its memory and registers, which is how breakpoint debuggers work ✅[^20]. Delve's Linux backend starts a program with `SysProcAttr{Ptrace: true}` and attaches to one with `PtraceAttach` ✅[^13].
- A **core dump** is a photograph of a process's memory taken at the moment it died, saved as a file a debugger can open later ✅[^21].

**Why Delve and not GDB.** The Go GDB page calls Delve the better choice for programs built with the standard toolchain, because it understands the Go runtime, data structures and expressions better ✅[^14]. GDB is confused by Go's stack management, threading and runtime, so it is not a reliable debugger for Go programs, particularly heavily concurrent ones; it can still help with cgo code or with debugging the runtime itself ✅[^14] ✅[^15].

## Steps
Four actors take part in a `dlv debug` session:
- **The `dlv` terminal client** — its job: read your commands and print what the debugger reports, via the `(dlv)` prompt, an `--init` file or standard input ✅[^4] ✅[^1].
- **`go build`** — its job: compile the package without optimizations and inlining, via the arguments `-o <debug binary> -gcflags "all=-N -l"` that Delve adds ✅[^12].
- **Delve's debugger (native backend on Linux)** — its job: start the binary as a traced child, stop it at breakpoints and read its state, via ptrace ✅[^13] ✅[^3].
- **The program** — its job: run your code until a breakpoint stops it, via a `__debug_bin<number>` file that Delve writes in the current folder and deletes when the session ends ✅[^1].

```text
dlv debug --init session.dlv --allow-non-terminal-interactive=true     (one container, local only)
  │
  ├─ Delve ──▶ go build -o ./__debug_bin<n> -gcflags "all=-N -l" .
  ├─ Delve ──▶ start __debug_bin<n> as a ptrace child; it waits for "continue"
  ├─ client: break main.go:20 if o.ID == 1 ──▶ breakpoint set at an address (0xb6954)
  ├─ client: continue ──▶ program runs; goroutine 9 reaches line 20 with o.ID == 1 ──▶ stop
  ├─ client: print / args / locals / goroutines / stack ──▶ debugger reads the stopped process
  └─ client: exit ──▶ session ends, the program ends with it, __debug_bin<n> is deleted
```

1. **Install Delve at a pinned version** into a `bin` folder next to your examples. The install needs the module proxy once.
   ```console
   $ mkdir -p bin
   $ docker run --rm -v gocache:/root/.cache/go-build -v gomodcache:/go/pkg/mod \
       -v "$PWD/bin":/tools -e GOBIN=/tools golang:1.27.4 \
       sh -c 'go install github.com/go-delve/delve/cmd/dlv@v1.27.2 && /tools/dlv version'
   Delve Debugger
   Version: 1.27.2
   Build: $Id: 360e7b2181d3da54115aaee4f569954bca95cfe3 $
   ```
   ✅[^1] ✅[^2]
2. **Write a program to debug** in its own folder (`dlv-basic/main.go`), then create a module with `go mod init lab`. Three workers, started with `sync.WaitGroup.Go` (new in Go 1.25 ✅[^25]), read orders from a channel; `total` is the function under inspection, and `return withTax` is line 20.
   ```go
   package main

   import (
   	"fmt"
   	"sync"
   )

   type order struct {
   	ID    int
   	Items []string
   }

   // total adds one unit per letter of each item name, plus tax.
   func total(o order, taxRate float64) float64 {
   	sum := 0.0
   	for _, item := range o.Items {
   		sum += float64(len(item))
   	}
   	withTax := sum * (1 + taxRate)
   	return withTax
   }

   func main() {
   	jobs := make(chan order)
   	var wg sync.WaitGroup
   	for w := 1; w <= 3; w++ {
   		wg.Go(func() {
   			for o := range jobs {
   				fmt.Printf("worker %d: order %d = %.2f\n", w, o.ID, total(o, 0.1))
   			}
   		})
   	}
   	jobs <- order{ID: 1, Items: []string{"pen", "notebook"}}
   	jobs <- order{ID: 2, Items: []string{"stapler"}}
   	close(jobs)
   	wg.Wait()
   }
   ```
3. **Write the session as a command file**, `session.dlv`, one Delve command per line. `break` sets a breakpoint (here with a condition), `continue` runs to it, `print` evaluates an expression, `args` and `locals` print the function's arguments and local variables, `goroutines` lists all goroutines, `stack` prints the call stack, and `exit` ends the session ✅[^9]. Expressions cover a subset of Go: field access, indexing, slicing, map access, pointer dereference, comparisons and `len`/`cap` ✅[^16].
   ```text
   break main.go:20 if o.ID == 1
   continue
   print o
   print o.Items[1]
   args
   locals
   goroutines
   stack
   exit
   ```
4. **Run the session without a terminal.** `--init` names a file of commands the terminal client runs ✅[^4]. In a container started without `-t`, standard input is not a terminal, and Delve refuses to start (`Stdin is not a terminal, use '-r' to specify redirects for the target process or --allow-non-terminal-interactive=true …`, exit status 1) until you pass `--allow-non-terminal-interactive=true` ✅[^1] ✅[^4]. `TERM=dumb` turns off the colour codes, because Delve reads `$TERM` to decide whether to print them ✅[^11] ✅[^1].
   ```console
   $ cd dlv-basic
   $ docker run --rm -e TERM=dumb -v gocache:/root/.cache/go-build -v "$PWD":/src \
       -v "$PWD/../bin":/tools -w /src golang:1.27.4 \
       sh -c '/tools/dlv debug --init session.dlv --allow-non-terminal-interactive=true'
   Type 'help' for list of commands.
   Breakpoint 1 set at 0xb6954 for main.total() ./main.go:20
   > [Breakpoint 1] main.total() ./main.go:20 (hits goroutine(9):1 total:1) (PC: 0xb6954)
       15:		sum := 0.0
       16:		for _, item := range o.Items {
       17:			sum += float64(len(item))
       18:		}
       19:		withTax := sum * (1 + taxRate)
   =>  20:		return withTax
       21:	}
       22:	
       23:	func main() {
       24:		jobs := make(chan order)
       25:		var wg sync.WaitGroup
   main.order {
   	ID: 1,
   	Items: []string len: 2, cap: 2, [
   		"pen",
   		"notebook",
   	],}
   "notebook"
   o = main.order {ID: 1, Items: []string len: 2, cap: 2, [...]}
   taxRate = 0.1
   ~r0 = 0
   sum = 11
   withTax = 12.100000000000001
     Goroutine 1 - User: ./main.go:33 main.main (0xb6b98)
     Goroutine 2 - User: /usr/local/go./runtime/proc.go:475 runtime.gopark (0x87ed0) [force gc (idle)]
     Goroutine 3 - User: /usr/local/go./runtime/proc.go:475 runtime.gopark (0x87ed0) [GC sweep wait]
     Goroutine 4 - User: /usr/local/go./runtime/proc.go:475 runtime.gopark (0x87ed0) [GC scavenge wait]
     Goroutine 5 - User: /usr/local/go./runtime/proc.go:7137 runtime.updateMaxProcsGoroutine (0x63130)
     Goroutine 6 - User: /usr/local/go./runtime/mfinal.go:193 runtime.runFinalizers (0x34f50)
     Goroutine 7 - User: /usr/local/go./sync/waitgroup.go:238 sync.(*WaitGroup).Go.func1 (0x96db0)
     Goroutine 8 - User: /usr/local/go./sync/waitgroup.go:238 sync.(*WaitGroup).Go.func1 (0x96db0)
   * Goroutine 9 - User: ./main.go:20 main.total (0xb6954) (thread 59)
   [9 goroutines]
   0  0x00000000000b6954 in main.total
      at ./main.go:20
   1  0x00000000000b6d1c in main.main.func1
      at ./main.go:29
   2  0x0000000000096e18 in sync.(*WaitGroup).Go.func1
      at /usr/local/go./sync/waitgroup.go:258
   3  0x000000000008d214 in runtime.goexit
      at /usr/local/go./runtime/asm_arm64.s:1039
   ```
   ✅[^1]
5. **Read the output.**
   - The stop line names the goroutine that hit the breakpoint (9) and shows the source around line 20 ✅[^1].
   - `print o` expanded the struct and its slice, while the one-line `args` summary shortened the slice to `[...]` ✅[^1]; `print` follows nested values up to two levels deep ✅[^16].
   - `args` listed `o`, `taxRate` and `~r0`, the function's unnamed result, still `0` before the `return` ✅[^1]; `locals` listed `sum = 11` and `withTax = 12.100000000000001` (`pen` + `notebook` = 11 letters, plus 10 % tax) ✅[^1].
   - `goroutines` marked the current goroutine with `*` ✅[^1] and, by default (`-u`), shows each goroutine's topmost frame in user code ✅[^9]; labels such as `[GC sweep wait]` are the same state labels a Go stack trace prints (`goroutine 3 … [GC sweep wait]:` in the crash output of step 9) ✅[^1]. Nine goroutines: `main`, three workers (7, 8, 9) and five started by the runtime ✅[^1].
   - `stack` prints frame 0 (where the program stopped) up to `runtime.goexit`; `stack -full` would add each frame's locals ✅[^9] ✅[^1].
   - Goroutines run concurrently, so the details change between runs: without the `if o.ID == 1` condition, one run stopped on order 2 first, and `print o.Items[1]` failed with `session.dlv:4: index out of bounds`; the script still ran the remaining commands ✅[^1].
6. **See why `dlv debug` turns optimizations off.** The compiler flag `-N` disables optimizations and `-l` disables inlining ✅[^17]; with the `all=` pattern, `-gcflags` applies to every package in the build, dependencies included ✅[^18]. Delve's build code always adds `-gcflags "all=-N -l"` ✅[^12], and with `--build-flags="-a -x"` the lab saw `-N -l` on the compile commands of both `main` and `fmt` ✅[^1]. Inlining (pasting a small function's body into its caller) and keeping variables in registers make debugging harder, so the Go docs recommend `go build -gcflags=all="-N -l"` for code you debug ✅[^14] ✅[^15]. To compare, build the same program both ways and run this `opt.dlv` (`break main.total`, `continue`, `args`, `locals`, `stack`, `exit`) with `dlv exec`, which debugs an existing binary ✅[^5]:

   | Build | What Delve showed in Go 1.27.4 |
   |---|---|
   | `go build -o /tmp/opt .` (optimized) | `break main.go:20` failed: `could not find statement at /src/main.go:20, please use a line with a statement`, so the program ran to the end. `break main.total` stopped inside the caller `main.main.func1` at line 16 (frames `main.total` and `main.main.func1` shared the address `0xa40e8`), printed `Warning: debugging optimized function`, then `args` gave `(no args)` and `locals` gave `sum = (unreadable could not find loclist entry at 0x53f for address 0xa40e8)` ✅[^1] |
   | `go build -gcflags=all="-N -l" -o /tmp/noopt .` | `break main.total` stopped in `main.total()` at line 14, and `args` showed `o = main.order {ID: 1, …}` and `taxRate = 0.1` ✅[^1] |

   `go build -gcflags=-m` confirmed why: `can inline total` and `inlining call to total` ✅[^1]. Delve's own `dlv exec` help gives the same advice: binaries built with optimizations may be hard to debug, so build with `-gcflags="all=-N -l"` ✅[^5].
7. **Debug one test with `dlv test`.** It compiles the package's test binary with optimizations off and starts a session; arguments after `--` go to the test binary, such as `-test.run TestApply -test.v` ✅[^6]. Package `discount` has `Apply(priceCents, percent int) int` (`off := priceCents * percent / 100` on line 5, `return priceCents - off` on line 6) and a table test with the cases `{1000, 10, 900}` and `{999, 15, 850}`. Session `test.dlv`: `break discount.go:6 if percent == 15`, `continue`, `args`, `locals`, `stack 2`, `continue`, `exit`.
   ```console
   $ cd dlv-test
   $ docker run --rm -e TERM=dumb -v gocache:/root/.cache/go-build -v "$PWD":/src \
       -v "$PWD/../bin":/tools -w /src golang:1.27.4 \
       sh -c '/tools/dlv test ./discount --init test.dlv --allow-non-terminal-interactive=true -- -test.run TestApply -test.v'
   Type 'help' for list of commands.
   Breakpoint 1 set at 0x1aa5e0 for lab/discount.Apply() ./discount/discount.go:6
   === RUN   TestApply
   === RUN   TestApply/ten_percent
   === RUN   TestApply/odd_cents
   > [Breakpoint 1] lab/discount.Apply() ./discount/discount.go:6 (hits goroutine(9):1 total:1) (PC: 0x1aa5e0)
   (source lines 1-7 cut here)
   priceCents = 999
   percent = 15
   ~r0 = 0
   off = 149
   0  0x00000000001aa5e0 in lab/discount.Apply
      at ./discount/discount.go:6
   1  0x00000000001aa864 in lab/discount.TestApply.func1
      at ./discount/discount_test.go:16
   2  0x0000000000130e50 in testing.tRunner
      at /usr/local/go./testing/testing.go:2195
   (truncated)
   --- PASS: TestApply (0.00s)
       --- PASS: TestApply/ten_percent (0.00s)
       --- PASS: TestApply/odd_cents (0.00s)
   PASS
   test.dlv:6: Process 75 has exited with status 0
   ```
   ✅[^1] The condition skipped the `ten_percent` case; `off = 149` shows integer division dropping the `.85` of 149.85. After the last `continue` the test binary had already exited, so Delve reported that for line 6 of the file ✅[^1].
8. **Attach to a running process.** `dlv attach <pid> [executable]` (`<pid>` is the process ID) takes control of a running process; when the session ends you choose to let it continue or kill it, and `exit -d` detaches and leaves it running without asking ✅[^7] ✅[^9]. Build the target with `-gcflags=all="-N -l"` too, for the reasons in step 6. Program `dlv-attach/main.go` increments a package variable `ticks` and calls `tick(ticks)` every 100 milliseconds; session `attach.dlv`: `break main.tick`, `continue`, `args`, `locals`, `print ticks`, `exit -d`.
   ```console
   $ cd dlv-attach
   $ docker run --rm -e TERM=dumb -v gocache:/root/.cache/go-build -v "$PWD":/src \
       -v "$PWD/../bin":/tools -w /src golang:1.27.4 sh -c '
       go build -gcflags=all="-N -l" -o /tmp/ticker . && (/tmp/ticker > /dev/null &); sleep 1
       pid=$(pidof ticker)
       /tools/dlv attach $pid --init attach.dlv --allow-non-terminal-interactive=true
       sleep 0.5; ps -o pid,stat,comm -p $pid'
   Type 'help' for list of commands.
   Breakpoint 1 set at 0xb5e40 for main.tick() ./main.go:11
   > [Breakpoint 1] main.tick() ./main.go:11 (hits goroutine(1):1 total:1) (PC: 0xb5e40)
   (source lines 6-16 cut here)
   n = 11
   ~r0 = 125409385512968
   (no locals)
   11
       PID STAT COMMAND
        47 Sl   ticker
   ```
   ✅[^1] The breakpoint sits at the function's entry, so `label` is not yet in scope (`(no locals)`) and `~r0` holds leftover memory that changed from run to run ✅[^1]. `ps` shows the process still alive (`Sl`) after the detach ✅[^1].

   **Who may attach.** The kernel lets a process trace another only if all the target's user and group IDs match the caller's, or the caller has `CAP_SYS_PTRACE` (a capability is one key taken from root's key ring) in the target's user namespace ✅[^20]. When the Yama security module is set to `ptrace_scope` 1, which the ptrace(2) page lists as the default, an attaching process must also be the target's ancestor or hold `CAP_SYS_PTRACE` ✅[^20]. Docker does not grant `SYS_PTRACE` by default but lets you add it ✅[^23], and its default seccomp profile (a filter on which system calls a container may make) blocks `ptrace` only on kernels older than 4.8 ✅[^22]. What the lab saw (kernel 7.2, `ptrace_scope` 0):

   | Case | Docker flags | Result |
   |---|---|---|
   | `dlv debug`, `dlv test` (Delve starts the program as its child) | none | Works ✅[^1] |
   | Attach to a process of the same user (root) | none | Works ✅[^1] |
   | Attach to a process started as user `nobody` with `setpriv --reuid=65534` | none | `Could not attach to pid 48: current user does not own the process`, exit status 1 ✅[^1] |
   | The same | `--cap-add=SYS_PTRACE --security-opt seccomp=unconfined` | Works ✅[^1]; `--cap-add=SYS_PTRACE` alone also worked ✅[^1] |

   Delve's FAQ still tells Docker users to pass `--security-opt=seccomp:unconfined` ✅[^10]; add both flags only to the run that debugs, never to production containers.
9. **Read a crash dump with `dlv core`.** `GOTRACEBACK=crash` makes a fatal failure crash in an operating-system-specific way instead of exiting; on Unix it raises SIGABRT (the abort signal) to trigger a core dump ✅[^19] ✅[^14]. The kernel writes no file while the core-size limit (`RLIMIT_CORE`, what `ulimit -c` shows) is 0, and by default it names the file `core` in the current folder unless `/proc/sys/kernel/core_pattern` says otherwise ✅[^21]. In the lab, `core_pattern` was `core` and `ulimit -c` printed `0` by default, so no file appeared (exit status 134) ✅[^1]; `docker run --ulimit` sets the limit for the container ✅[^24]. `dlv core <executable> <core>` supports linux/amd64 and linux/arm64 core files ✅[^8]. Program `dlv-core/main.go` panics in `withdraw(a *account, amount int)` (line 12) when `amount > a.Balance`; `main` (line 20) calls it a second time with 40 on a balance of 20. Session `core.dlv`: `stack 12`, `frame 9 args`, `frame 9 print *a`, `frame 10 locals`, `exit`.
   ```console
   $ cd dlv-core
   $ docker run --rm --ulimit core=-1 -e TERM=dumb -v gocache:/root/.cache/go-build \
       -v "$PWD":/src -v "$PWD/../bin":/tools -w /src golang:1.27.4 sh -c '
       ulimit -c; go build -gcflags=all="-N -l" -o /tmp/bank . && cd /tmp && GOTRACEBACK=crash ./bank 2>/tmp/stderr.txt
       echo "exit=$?"; ls -l core
       /tools/dlv core ./bank core --init /src/core.dlv --allow-non-terminal-interactive=true'
   unlimited
   exit=134
   -rw------- 1 root root 41844736 Nov 24 15:45 core
   Type 'help' for list of commands.
    0  0x000000000008d1e8 in runtime.raise
       at /usr/local/go/src/runtime/sys_linux_arm64.s:158
   (frames 1-7: runtime.dieFromSignal, sigfwdgo, sigtrampgo, raise, dieFromSignal, crash, fatalpanic)
    8  0x0000000000087288 in runtime.gopanic
       at /usr/local/go/src/runtime/panic.go:878
    9  0x00000000000b2558 in main.withdraw
       at /src/main.go:12
   10  0x00000000000b2600 in main.main
       at /src/main.go:20
   11  0x0000000000057b90 in runtime.main
       at /usr/local/go/src/runtime/proc.go:302
   12  0x000000000008c794 in runtime.goexit
       at /usr/local/go/src/runtime/asm_arm64.s:1039
   a = (*main.account)(0x6fa899f36ea8)
   amount = 40
   main.account {Owner: "lab", Balance: 20}
   acct = (*main.account)(0x6fa899f36ea8)
   ```
   ✅[^1] The core file was 41.8–46.0 MB (megabytes) over three runs ✅[^1]. The crashing program's standard error held the panic message and, as `GOTRACEBACK=crash` implies, the stacks of all six goroutines, runtime frames included ✅[^19] ✅[^1].

## Verify
| Check | Command | Expected (lab, 2026-11-24) |
|---|---|---|
| Delve installed | `/tools/dlv version` | `Version: 1.27.2` ✅[^1] |
| Scripted session works | step 4 | `> [Breakpoint 1] main.total() ./main.go:20`, then `sum = 11` and `withTax = 12.100000000000001` ✅[^1] |
| Debug build has no optimizations | `dlv debug --build-flags="-a -x" …` and look for `-N -l` | `-N -l` on the `-p main` and `-p fmt` compile lines ✅[^1] |
| Test session | step 7 | Stops with `percent = 15`, `off = 149`, then `PASS` ✅[^1] |
| Attach and detach | step 8 | `n = <ticks so far>`, and `ps` still lists `ticker` ✅[^1] |
| Core dump | step 9 | `exit=134`, a `core` file of 42–46 MB, frame 9 is `main.withdraw` with `amount = 40` ✅[^1] |

## Troubleshooting
| Symptom | Cause | Fix |
|---|---|---|
| `Stdin is not a terminal, use '-r' to specify redirects …` and exit status 1 | Delve was started from a script, a pipe or a container without `-t` ✅[^1] | Add `--allow-non-terminal-interactive=true` ✅[^4]; commands can also be piped on standard input, and at the end of input Delve exits ✅[^1] |
| `could not find statement at …, please use a line with a statement` | The binary was optimized; the same breakpoint worked in the `-N -l` build ✅[^1] | Use `dlv debug`, or rebuild with `-gcflags=all="-N -l"` and use `dlv exec` ✅[^5] |
| `Warning: debugging optimized function`, `(no args)`, `(unreadable could not find loclist entry …)` | The binary was optimized: `total` was inlined into its caller (`-gcflags=-m`), and the debug information had no location for `sum` at that address ✅[^1]; optimizations make debugging harder ✅[^15] | Same fix. To keep optimizations, `-gcflags="-dwarflocationlists=true"` (Go 1.10 and later) adds location lists that help debuggers ✅[^15] |
| `Could not attach to pid N: current user does not own the process` | The target runs as another user and the container lacks `CAP_SYS_PTRACE` ✅[^1] ✅[^20] | Run Delve as the target's user, or add `--cap-add=SYS_PTRACE` (plus `--security-opt seccomp=unconfined` as Delve's FAQ advises) for that run only ✅[^1] ✅[^10] |
| Attach fails even for your own process on another host | Yama `ptrace_scope`: 1 requires an ancestor relationship or `CAP_SYS_PTRACE`, 2 requires `CAP_SYS_PTRACE` even for children that ask to be traced, 3 forbids attaching altogether ✅[^20]; the lab had 0 ✅[^1] | Check `cat /proc/sys/kernel/yama/ptrace_scope`; at 1, add the capability or start the program under `dlv debug`/`dlv exec` instead; at 3, debug on another machine or from a core dump |
| No `core` file after the crash | `ulimit -c` is 0, or `core_pattern` starts with `\|`, which pipes the dump to a program instead of writing a file ✅[^21] ✅[^1] | Run with `--ulimit core=-1` ✅[^24] ✅[^1]; check `cat /proc/sys/kernel/core_pattern` |
| `list main.main` says `no such file or directory`; breakpoints by full path do not work | The binary was built in another environment (another container, `-trimpath`, symlinks), so the source paths embedded in it do not exist here ✅[^10] | Use Delve's substitute-path setting (`help config`), and `sources` to see the embedded paths ✅[^10] |
| Captured output is full of `[33m`-style codes | Colour escape codes ✅[^1] | Set `TERM=dumb` ✅[^11] ✅[^1] |
| Go's GDB page says Delve runs on amd64 only | That page names Linux, macOS and Windows on amd64 and points to Delve's docs for the current list ✅[^14] | Delve's FAQ at v1.27.2 lists linux/arm64 too ✅[^10], and the lab ran on linux/arm64 ✅[^1] |

## Rollback
Delete the `bin` folder (it holds only `dlv`) and any `core` files. Delve deleted the debug binary it built on exit, even when `--output` named it ✅[^1]; nothing else was installed outside the example folders.

## Takeaways
- Debug with `dlv debug`, `dlv test`, or a binary built with `-gcflags=all="-N -l"`; on an optimized binary, lines and variables go missing. [rule-candidate]
- Script repeatable sessions with `--init <file> --allow-non-terminal-interactive=true` and `TERM=dumb`, and add a condition to breakpoints in concurrent code, since the first goroutine to arrive differs from run to run. [rule-candidate]
- End an attach session with `exit -d` when the process must keep running. [rule-candidate]
- Grant `--cap-add=SYS_PTRACE` (and `seccomp=unconfined`) only to the one container you debug, never by default. [rule-candidate]
- For post-mortem debugging, run with `GOTRACEBACK=crash` and a non-zero core limit, keep the exact binary, and open both with `dlv core`.

## Verification status
- Verified: 115 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `go/lab-setup.md` — the Go 1.27.4 lab (`golang:1.27.4`) where every behaviour marked with this note ran on 2026-11-24, with Delve v1.27.2 (`github.com/go-delve/delve` v1.27.2, installed from the module proxy) on linux/arm64, kernel 7.2, Docker Engine 29.8.2; every command and output above, run twice. [^1]
- [Installation](https://github.com/go-delve/delve/blob/v1.27.2/Documentation/installation/README.md) — Delve project, v1.27.2. Rank 1. Backs: `go install …/cmd/dlv@<version>` with Go 1.16 or later. [^2]
- [dlv](https://github.com/go-delve/delve/blob/v1.27.2/Documentation/usage/dlv.md) — Delve project, v1.27.2. Rank 1. Backs: Delve is a source-level debugger for Go that controls execution and shows variables, goroutine and register state. [^3]
- [dlv debug](https://github.com/go-delve/delve/blob/v1.27.2/Documentation/usage/dlv_debug.md) — Delve project, v1.27.2. Rank 1. Backs: compiles with optimizations disabled; `--init`, `--allow-non-terminal-interactive`, `--build-flags`, `--check-go-version`, `--output`. [^4]
- [dlv exec](https://github.com/go-delve/delve/blob/v1.27.2/Documentation/usage/dlv_exec.md) — Delve project, v1.27.2. Rank 1. Backs: debugging a precompiled binary; advice to build with `-gcflags="all=-N -l"`. [^5]
- [dlv test](https://github.com/go-delve/delve/blob/v1.27.2/Documentation/usage/dlv_test.md) — Delve project, v1.27.2. Rank 1. Backs: test binary built with optimizations disabled; `--` passes `-test.run` and other flags. [^6]
- [dlv attach](https://github.com/go-delve/delve/blob/v1.27.2/Documentation/usage/dlv_attach.md) — Delve project, v1.27.2. Rank 1. Backs: attach to a running process; continue or kill it on exit. [^7]
- [dlv core](https://github.com/go-delve/delve/blob/v1.27.2/Documentation/usage/dlv_core.md) — Delve project, v1.27.2. Rank 1. Backs: `dlv core <executable> <core>`; linux/amd64 and linux/arm64 core files. [^8]
- [Commands](https://github.com/go-delve/delve/blob/v1.27.2/Documentation/cli/README.md) — Delve project, v1.27.2. Rank 1. Backs: `break` with conditions, `continue`, `print`, `args`, `locals`, `goroutines` (`-u` default), `stack` (`-full`), `exit -d`. [^9]
- [Frequently Asked Questions](https://github.com/go-delve/delve/blob/v1.27.2/Documentation/faq.md) — Delve project, v1.27.2. Rank 1. Backs: supported platforms; `seccomp:unconfined` for Docker; substitute-path and `sources` when source paths differ. [^10]
- [Using Delve](https://github.com/go-delve/delve/blob/v1.27.2/Documentation/usage/README.md) — Delve project, v1.27.2. Rank 1. Backs: `$TERM` decides whether colour codes are printed. [^11]
- [pkg/gobuild/gobuild.go](https://github.com/go-delve/delve/blob/v1.27.2/pkg/gobuild/gobuild.go) — Delve project, v1.27.2. Rank 1. Backs: the build adds `-o <debugname>` and `-gcflags "all=-N -l"`. [^12]
- [pkg/proc/native/proc_linux.go](https://github.com/go-delve/delve/blob/v1.27.2/pkg/proc/native/proc_linux.go) — Delve project, v1.27.2. Rank 1. Backs: launch with `SysProcAttr{Ptrace: true}`, attach with `PtraceAttach`. [^13]
- [Debugging Go Code with GDB](https://go.dev/doc/gdb) — Go team, living. Rank 1. Backs: Delve preferred to GDB; GDB unreliable for Go; inlining and registerization hinder debugging; `-gcflags=all="-N -l"`; `GOTRACEBACK=crash` for core dumps; Delve platform note. [^14]
- [Diagnostics](https://go.dev/doc/diagnostics) — Go team, living. Rank 1. Backs: Debugging section: Delve and GDB, disabling optimizations, `-dwarflocationlists`, core dumps with Delve or GDB. [^15]
- [Expressions](https://github.com/go-delve/delve/blob/v1.27.2/Documentation/cli/expr.md) — Delve project, v1.27.2. Rank 1. Backs: supported expression subset; two-level nesting limit. [^16]
- [Command compile](https://pkg.go.dev/cmd/compile) — Go team, living. Rank 1. Backs: `-N` disables optimizations, `-l` disables inlining. [^17]
- [Command go](https://pkg.go.dev/cmd/go) — Go team, living. Rank 1. Backs: `-gcflags` package patterns; `all=` covers dependencies. [^18]
- [Package runtime](https://pkg.go.dev/runtime) — Go team, living. Rank 1. Backs: `GOTRACEBACK` levels; `crash` raises SIGABRT on Unix to trigger a core dump. [^19]
- [ptrace(2)](https://man7.org/linux/man-pages/man2/ptrace.2.html) — Linux man-pages project, living. Rank 1. Backs: tracer and tracee; access checks (matching IDs or `CAP_SYS_PTRACE`); Yama `ptrace_scope` values. [^20]
- [core(5)](https://man7.org/linux/man-pages/man5/core.5.html) — Linux man-pages project, living. Rank 1. Backs: what a core dump is; `RLIMIT_CORE` 0 means no file; default name `core`; `core_pattern` and piping. [^21]
- [Seccomp security profiles for Docker](https://docs.docker.com/engine/security/seccomp/) — Docker, living. Rank 1. Backs: the default profile blocks `ptrace` only before kernel 4.8. [^22]
- [Running containers](https://docs.docker.com/engine/containers/run/) — Docker, living. Rank 1. Backs: `SYS_PTRACE` is not among the default capabilities and can be added with `--cap-add`. [^23]
- [docker container run](https://docs.docker.com/reference/cli/docker/container/run/) — Docker, living. Rank 1. Backs: `--ulimit` sets ulimits in the container. [^24]
- [Go 1.25 Release Notes](https://go.dev/doc/go1.25) — Go team, 2025. Rank 1. Backs: the new `WaitGroup.Go` method. [^25]

## Related
- `go/errors/panic-and-recover.md` — what a panic prints and how `recover` stops one.
- `go/runtime/profiling-and-diagnostics.md` — profiles and traces when a debugger is the wrong tool.
- `go/runtime/compiler-optimizations.md` — inlining and the other optimizations `-N -l` turns off.
- `go/tooling/testing-benchmarks-and-fuzzing.md` — the tests `dlv test` runs.
- `go/tooling/go-command-and-build-reference.md` — `-gcflags`, `-ldflags` and the other build flags.
- `linux/containers/container-isolation.md` — Docker capabilities and seccomp profiles.
- `linux/security/lsm-and-landlock.md` — Yama and the other Linux security modules.
- `linux/processes/signals.md` — SIGABRT and the other signals that dump core.
- `go/learning-path.md` — where this doc sits in the learning order.
