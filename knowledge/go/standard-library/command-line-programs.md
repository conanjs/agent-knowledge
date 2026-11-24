---
schema: knowledge-doc/v1
type: concept
topic: go/standard-library
status: verified
applies-to: ["Go 1.27 (go1.27.4)", "flag.Func, signal.NotifyContext: Go ≥ 1.16", "flag.TextVar, exec.ErrDot, Cmd.Environ: Go ≥ 1.19", "Cmd.Cancel, Cmd.WaitDelay: Go ≥ 1.20", "flag.BoolFunc: Go ≥ 1.21", "signal cause on the NotifyContext context: Go ≥ 1.26", "Lab: Linux (Debian 13, arm64), dash and bash; Docker Engine 29.8.2 for the PID 1 runs"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [go, golang, cli, os-args, flag, flagset, subcommands, stdin, stdout, stderr, environment, exit-code, os-exit, log-fatal, os-exec, exiterror, errdot, waitdelay, os-signal, notifycontext, sigterm, graceful-shutdown]
ranked-sources: true
---

# Command-line programs in Go

## Summary
**TL;DR:** `os.Args` holds the raw arguments; the `flag` package turns the leading `-name value` words into typed variables (one or two dashes, `-f=x` or `-f x`, but a boolean only as `-f` or `-f=false`) and stops at the first word that is not a flag; a `flag.FlagSet` per subcommand gives `git`-style tools. A program talks to the world through `os.Stdin`, `os.Stdout`, `os.Stderr` and `os.LookupEnv`, and answers with an exit status: returning from `main` is 0, `os.Exit(n)` ends the program at once *without running deferred calls*, `log.Fatal` is a print plus `os.Exit(1)`, and an unrecovered panic is 2. `os/exec` starts other programs directly — no shell, so no wildcards or pipes — reports a failed run as an `*exec.ExitError` with `ExitCode()`, refuses a program found through `.` in `PATH` (Go 1.19), and with `CommandContext`, `Cancel` and `WaitDelay` (Go 1.20) can stop a child that hangs. `signal.NotifyContext` turns `SIGINT` and `SIGTERM` into a cancelled context, which is the start of a graceful shutdown.
**Use this when:** you write a Go command-line tool or the `main` of a service: parse flags or subcommands, read standard input or environment variables, choose exit codes, run another program and read its result, or make the program stop cleanly on Ctrl-C or `docker stop`.
**Not this doc:** what signals are, the 128 + n exit codes and the PID (process identifier) 1 rule → `linux/processes/signals.md`; how processes are created and reaped → `linux/processes/process-lifecycle.md`; validating configuration at startup → `operations/config-at-startup.md`; draining an HTTP (Hypertext Transfer Protocol) server → `go/standard-library/net-http.md`; `context` in general → `go/concurrency/context-and-cancellation.md`; `panic` and `recover` → `go/errors/panic-and-recover.md`; logging → `go/standard-library/log-and-slog.md`; reading and writing files → `go/standard-library/files-and-filesystems.md`.

## Problem
Small command-line programs break in ways that tests rarely catch:
- `tool -v false input.txt` turns verbose output *on* and treats `false` as the first file name ✅[^1].
- `tool input.txt -n 3` silently ignores `-n 3`, because flag parsing stops at the first non-flag word ✅[^2] ✅[^1].
- `os.Exit` or `log.Fatal` in a helper skips every deferred call, so buffered output is never flushed and temporary files stay behind ✅[^3] ✅[^1].
- `exec.Command("ls", "*.go")` finds no files, because no shell expands `*.go` ✅[^4] ✅[^1].
- A service stopped by `docker stop` drops its in-flight work, because nothing turns `SIGTERM` into "finish up".

## Mental model
**Analogy:** a command-line program is a clerk at a counter. The order slip (`os.Args`) is a list of words; the `flag` package reads the ticked boxes at the top of the slip and stops at the first line of free text. The clerk takes work from the in-tray (standard input), puts results in the out-tray (standard output), drops complaints in a separate box (standard error), and leaves with a coloured badge (the exit status) that the caller reads. Hiring a subcontractor (`os/exec`) means handing over a slip directly — there is no receptionist (shell) to interpret `*` or `|`. A bell (a signal) can ring at any time; `signal.NotifyContext` turns the bell into a "please finish" note instead of an instant eviction.

**Artifact:** the shape the rest of this doc builds on; `main` is the only place that exits ✅[^3] ✅[^5]:
```go
func main() {
	os.Exit(run(os.Args[1:], os.Stdin, os.Stdout, os.Stderr)) // the only os.Exit
}

func run(args []string, stdin io.Reader, stdout, stderr io.Writer) int {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop() // runs, because run returns before main calls os.Exit
	fs := flag.NewFlagSet("tool", flag.ContinueOnError)
	fs.SetOutput(stderr)
	n := fs.Int("n", 1, "number of `workers`")
	if err := fs.Parse(args); err != nil {
		return 2 // the FlagSet already printed the error and the usage
	}
	return work(ctx, *n, fs.Args(), stdin, stdout, stderr) // 0 on success, 1 on failure
}
```

## How it works

### Arguments and the `flag` package
1. **Raw arguments.** `os.Args` holds the command-line arguments, starting with the program name ✅[^3]. The shell has already split and unquoted them: `./app a "b c"` gave `["./app" "a" "b c"]` ✅[^1].
2. **Defining flags.** `flag.Int`, `flag.String`, `flag.Bool`, `flag.Duration` and friends return a pointer; the `…Var` forms bind an existing variable; `flag.Var` takes any type that implements `flag.Value` (`String()` and `Set(string) error`) ✅[^2]. Defining the same name twice in one set panics ✅[^2].
3. **Parsing.** `flag.Parse()` parses `os.Args[1:]`, and must run after all flags are defined and before any is read; afterwards `flag.Args()`, `flag.Arg(i)` and `flag.NArg()` give the remaining words ✅[^2].
4. **Accepted forms.** `-flag`, `--flag` (one or two dashes are equivalent), `-flag=x`, and `-flag x` for non-boolean flags only ✅[^2]. Integers accept `1234`, `0664`, `0x1234` and negatives; booleans accept `1, 0, t, f, T, F, true, false, TRUE, FALSE, True, False`; durations accept anything `time.ParseDuration` does ✅[^2]. Lab: `-n=3 --name Gopher -timeout 1m30s file.txt` set all three and left `["file.txt"]` ✅[^1].
5. **The boolean exception.** `-x false` is not allowed for a boolean, because the meaning of `cmd -x *` would change whenever a file named `0` or `false` exists; write `-x=false` ✅[^2]. Lab: `-v false rest` gave `v=true` and `Args=["false" "rest"]`, while `-v=false rest` gave `v=false` ✅[^1]. A custom `Value` with an `IsBoolFlag() bool` method returning true gets the same treatment ✅[^2].
6. **Where parsing stops.** Just before the first non-flag word (a lone `-` counts as a non-flag) or right after `--` ✅[^2]. Lab: `file.txt -n 3` left `n=1` and `Args=["file.txt" "-n" "3"]`; `-n 3 -- -v` left `Args=["-v"]` ✅[^1].
7. **Errors and help.** On a parse error the default set calls `flag.Usage`, which prints `Usage of <program>:` and `PrintDefaults()` to standard error; `Usage` is a variable you may replace ✅[^2]. The default set uses `ExitOnError`: exit status 2, or 0 for `-h`/`-help` ✅[^2]. Lab: `-nope` printed `flag provided but not defined: -nope` plus the usage on standard error and exited 2; `-h` and `-help` exited 0 ✅[^1].
8. **Usage text.** A back-quoted word in a usage string becomes the value name, and the default is shown unless it is the zero value ✅[^2]: the usage string ``"number of `workers`"`` printed `-n workers` / `number of workers (default 1)` ✅[^1].
9. **Function and text flags.** `flag.Func` (Go 1.16) calls a function each time the flag appears, and its error becomes a parse error ✅[^2] ✅[^8]; `flag.BoolFunc` (Go 1.21) is the same for a flag without a value ✅[^11]. `flag.TextVar` (Go 1.19) accepts any type that implements `encoding.TextUnmarshaler`, such as `netip.Addr`, `big.Int` or `time.Time` ✅[^9] ✅[^2]. Lab: `-tag x -tag y` collected `[x y]`, and `-addr 999.1.1.1` failed with `ParseAddr("999.1.1.1"): IPv4 field has value >255` and exit 2 ✅[^1].

### Subcommands with `FlagSet`
1. A `flag.FlagSet` is an independent set of flags, meant for subcommands; the top-level functions are wrappers around the default set `flag.CommandLine` ✅[^2].
2. `flag.NewFlagSet(name, handling)` takes an error strategy: `ContinueOnError` returns the error, `ExitOnError` calls `os.Exit(2)` (or 0 for `-h`/`-help`), `PanicOnError` panics ✅[^2]. `fs.Parse(args)` takes the words *after* the subcommand name and returns `flag.ErrHelp` for an undefined `-h`/`-help` ✅[^2].
3. `fs.SetOutput(w)` redirects the usage and error text; without it, they go to standard error ✅[^2]. The worked example passes the caller's `stderr`, which makes the whole command testable with buffers.

### Standard streams and the environment
1. `os.Stdin`, `os.Stdout` and `os.Stderr` are `*os.File` values for the standard descriptors (the numbered channels 0, 1 and 2 every process starts with), so they are also `io.Reader` and `io.Writer` ✅[^3]. Keep results on standard output and messages on standard error: `notes add … 2>/dev/null` hid the error and kept the exit code ✅[^1].
2. `os.Getenv` returns `""` both for an unset and for an empty variable; `os.LookupEnv` tells them apart with a second result ✅[^3]. Lab: `NOTES_FILE=` (set but empty) gave `ok == true` with an empty value, so the default `notes.txt` was not used ✅[^1]. Read and validate the environment once at startup, as `operations/config-at-startup.md` explains.
3. Unless the program called `signal.Notify` for `SIGPIPE`, a write to a closed pipe on descriptor 1 or 2 makes a Go program exit with `SIGPIPE`, as Unix tools do; on any other descriptor it is an `EPIPE` error ✅[^5]. Lab: `app | head -2` printed two lines, and bash reported exit status 141 (128 + 13, the number of `SIGPIPE`) ✅[^1].

### Exit codes
| How the program ends | Deferred calls | Exit status |
|---|---|---|
| `main` returns | run ✅[^1] | 0 ✅[^1] |
| `os.Exit(n)` | not run ✅[^3] | `n`; keep it in 0–125 for portability ✅[^3] |
| `log.Fatal…` | not run (it calls `os.Exit(1)` after printing to standard error) ✅[^6] | 1 ✅[^6] |
| Unrecovered panic | run while the stack unwinds ✅[^1] | 2, after a stack trace ✅[^7] |
| Flag error with `ExitOnError` | not run (it calls `os.Exit`) ✅[^2] ✅[^3] | 2 (0 for `-h`) ✅[^2] ✅[^1] |
| Killed by a signal | not run ✅[^1] | the shell shows 128 + n, e.g. 143 for `SIGTERM` ✅[^1] |

Lab detail: with `defer w.Flush()` on a `bufio.Writer`, the line written before `os.Exit(3)` never appeared, and `log.Fatalf` printed `2026/11/24 15:37:08 config "app.yaml" not found` and exited 1 ✅[^1]. That is why only `main` should call `os.Exit`, with a `run` function returning the code.

### Running other programs with `os/exec`
1. **No shell.** `os/exec` wraps `os.StartProcess` and does not call the system shell, so it expands no wildcards and handles no pipes or redirections; use `filepath.Glob` or `os.ExpandEnv`, or call `sh -c` yourself and escape any outside input ✅[^4]. Lab: `exec.Command("echo", "*.go", "$HOME", "a|b")` printed `*.go $HOME a|b`, and the same words through `sh -c` printed `a.go b.go /root` ✅[^1]. `exec.Command("ls -l")` looks for a program literally named `ls -l` and fails with `executable file not found in $PATH` ✅[^1].
2. **Building a command.** `exec.Command(name, args...)` sets `Path` and `Args`; a `name` without a path separator is resolved with `LookPath`; `Args[0]` stays `name` ✅[^4]. `Env == nil` means the parent's environment, and for duplicate keys the last one wins; `Dir` sets the working directory and, since Go 1.19 on Unix, also the child's `PWD` variable unless the environment already sets it ✅[^4] ✅[^9]. A nil `Stdin`, `Stdout` or `Stderr` is connected to the null device; an `*os.File` is connected directly; any other reader or writer is fed by a goroutine that `Wait` waits for ✅[^4].
3. **Running it.** `Run` starts and waits, and returns `nil` only for exit status 0 with no copying problem; a command that started but failed gives an `*exec.ExitError` ✅[^4]. `Output` returns standard output and, when `Stderr` was nil, puts standard error into the `ExitError`; `CombinedOutput` returns both streams together ✅[^4]. After `Start`, `Wait` must be called to release resources, and a `Cmd` cannot be reused ✅[^4] (`exec: already started` on a second `Run` ✅[^1]).
4. **Reading the result.** `ExitError` embeds the `*os.ProcessState`: `ExitCode()` is the code, or -1 when the process was killed by a signal, and `Exited()` is false in that case ✅[^4] ✅[^3]. Lab: `ls /nope` gave `exit status 2`, code 2, and through `Output` the `Stderr` text `ls: cannot access '/nope': No such file or directory`; a `sleep` sent `SIGTERM` gave `signal: terminated`, code -1 ✅[^1].
5. **`PATH` and the current directory.** Since Go 1.19, `Command` and `LookPath` refuse a result that a `PATH` search found relative to the current directory; the error matches `errors.Is(err, exec.ErrDot)` ✅[^4] ✅[^9]. Write `"./prog"` to mean the local file; `GODEBUG=execerrdot=0` restores the old behaviour ✅[^4]. Lab, with `PATH=.:…` and a script `hello` in the working directory: `cannot run executable found relative to current directory`, already stored in `cmd.Err` before `Run`; `./hello` ran; `GODEBUG=execerrdot=0` ran `hello` ✅[^1]. A missing program matches `exec.ErrNotFound` ✅[^4] ✅[^1].

### Stopping a child: `CommandContext`, `Cancel` and `WaitDelay`
1. `exec.CommandContext(ctx, …)` stops the process when `ctx` is done before the command finishes; by default its `Cancel` function calls `Process.Kill`, and `WaitDelay` is unset ✅[^4]. Lab: `sleep 5` under a 100 ms timeout returned `signal: killed` after about 100 ms, with `ctx.Err()` = `context deadline exceeded` ✅[^1].
2. Go 1.20 added `Cmd.Cancel` and `Cmd.WaitDelay` ✅[^10]. A custom `Cancel` typically sends a gentler signal, such as `SIGTERM` ✅[^4].
3. `WaitDelay` bounds two delays in `Wait`: a child that does not exit after cancellation is killed with `Process.Kill`, and pipes still held open after the child exited are closed. The timer starts when the context is done or `Wait` sees the exit, whichever is first; when the pipes were closed because of `WaitDelay`, no `Cancel` call happened, and the exit status was success, `Wait` returns `exec.ErrWaitDelay` ✅[^4]. With `WaitDelay` zero, output pipes are read until end of file, which may wait for orphaned grandchildren ✅[^4].
4. Lab, five runs each: a child that traps and ignores `SIGTERM`, with `Cancel` sending `SIGTERM` and `WaitDelay` 500 ms, was killed after 600–610 ms (`signal: killed`, its output `got TERM, ignoring`). `sh -c "sleep 2 & echo started"` read with `Output` returned after 2.00–2.01 s without `WaitDelay`, and after 200–210 ms with `WaitDelay` 200 ms and `exec: WaitDelay expired before I/O complete` ✅[^1].

### Signals and graceful shutdown
Five actors take part when `docker stop` or Ctrl-C asks a Go program to stop:
- **The sender** (a terminal, `kill`, `docker stop`) — its job: ask the process to stop, via a signal number such as `SIGTERM` (15) or `SIGINT` (2).
- **The kernel** — its job: deliver the signal, via the signal handler the Go runtime installed at startup.
- **The Go runtime with `os/signal`** — its job: apply the default action to an unregistered signal, via its own handler, and relay a registered one, via the channel or context that `signal.Notify` or `signal.NotifyContext` set up.
- **Your worker goroutines** — their job: notice the request, via `<-ctx.Done()`, and clean up, via their own `Flush`, `Close` or `Shutdown` calls.
- **Your `main` (through `run`)** — its job: wait for the workers, via a `sync.WaitGroup` or an `errgroup`, and pick the exit status, via the code `run` returns to `os.Exit`.

```
sender                kernel              Go runtime + os/signal               your code
kill -TERM <pid> ───► deliver ──────────► registered by NotifyContext? ──no──► default: exit (shell: 143)
                                              │ yes
                                              ▼
                                          cancel ctx with cause ────────────► <-ctx.Done() in workers
                                                                              stop(); flush, close, drain
                                                                              run returns 0 → os.Exit(0)
second kill -TERM ──► deliver ──────────► after stop(): default again ──────► exit 143, cleanup cut short
```

1. **Sender → kernel:** a signal comes from outside the process; `SIGKILL` and `SIGSTOP` cannot be caught at all ✅[^5]. Signal numbers, dispositions and `docker stop`'s timeout are in `linux/processes/signals.md`.
2. **Kernel → Go runtime (default action):** without registration, `SIGHUP`, `SIGINT` and `SIGTERM` make a Go program exit, and `SIGQUIT` exits with a stack dump ✅[^5]. Lab: with no handler, `kill -TERM` ended the program at once, its deferred call did not run, and the shell reported 143 ✅[^1].
3. **Go runtime → your code (registration):** `signal.Notify(c, sigs...)` disables the default action for those signals and sends them on `c`; the package never blocks on the send, so `c` needs a buffer (1 is enough for one signal) ✅[^5]. `go vet` flags an unbuffered channel: `misuse of unbuffered os.Signal channel as argument to signal.Notify` ✅[^1].
4. **`NotifyContext` (Go 1.16):** returns a context that is done when a listed signal arrives, when `stop` is called, or when the parent is done ✅[^5] ✅[^8]. Since Go 1.26, `context.Cause(ctx)` names the signal ✅[^12] ✅[^5]; the lab printed `terminated signal received` and `interrupt signal received` ✅[^1].
5. **Your code (cleanup):** call `stop` as soon as the signal has been seen: it unregisters, like `signal.Reset`, so a *second* signal gets the default action again ✅[^5]. Lab: a second `SIGTERM` during a 1 s cleanup ended the program with 143 before `cleanup done` ✅[^1]. That gives users the familiar "press Ctrl-C again to force".
6. **Containers.** Go code built normally (not with `-buildmode=c-archive` or `c-shared`) installs handlers for these asynchronous signals ✅[^5], so a Go binary is not stuck the way a bare `sleep` is as PID 1 (see `linux/processes/signals.md`). Lab, three runs each with Docker 29.8.2: the binary as PID 1 without any `Notify` stopped on `docker stop` in 0.08–0.10 s with exit 143; with `NotifyContext` it finished its 1 s cleanup and exited 0 after 1.08–1.18 s ✅[^1].
7. **HTTP servers.** Pass the signal context's `Done` to a goroutine that calls `http.Server.Shutdown` with a deadline; the shutdown rules are in `go/standard-library/net-http.md`.
8. **Portability.** `os.Interrupt` and `os.Kill` are the only signal values present on every system ✅[^3]; on Windows only `os.Interrupt` (Ctrl-C or Ctrl-Break) can be relayed, and console close, logoff and shutdown events arrive as `syscall.SIGTERM` ✅[^5].

## Worked example
A small tool, `notes`, with two subcommands: `add [-tag t] text…` appends a line to `$NOTES_FILE` (default `notes.txt`), and `count [-tag t]` counts lines read from standard input. It follows the `main` → `run` shape from the Mental model; the `add` branch is the interesting part:

```go
case "add":
	fs := flag.NewFlagSet("add", flag.ContinueOnError)
	fs.SetOutput(stderr)
	tag := fs.String("tag", "misc", "tag for the note")
	if err := fs.Parse(args[1:]); err != nil {
		return 2 // fs already printed the error and usage
	}
	if fs.NArg() == 0 {
		fmt.Fprintln(stderr, "add: missing note text")
		return 2
	}
	file, ok := os.LookupEnv("NOTES_FILE")
	if !ok {
		file = "notes.txt"
	}
	f, err := os.OpenFile(file, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		fmt.Fprintln(stderr, "add:", err)
		return 1
	}
	_, werr := fmt.Fprintf(f, "[%s] %s\n", *tag, strings.Join(fs.Args(), " "))
	if cerr := f.Close(); werr == nil {
		werr = cerr // a Close error matters after writing
	}
	if werr != nil {
		fmt.Fprintln(stderr, "add:", werr)
		return 1
	}
	fmt.Fprintln(stdout, "saved to", file)
	return 0
```

The run, in `/work` on Go 1.27.4; the stream column comes from a second run with standard output and standard error redirected separately ✅[^1]:

| Command | Output | Stream | Exit |
|---|---|---|---|
| `notes add -tag work buy milk` | `saved to notes.txt` | stdout | 0 |
| `NOTES_FILE=/work/w.txt notes add call the bank` | `saved to /work/w.txt` | stdout | 0 |
| `NOTES_FILE= notes add empty var` | `add: open : no such file or directory` | stderr | 1 |
| `notes add -tag home fix sink`, then `cat notes.txt` | `[work] buy milk` / `[home] fix sink` | stdout | 0 |
| `notes count < notes.txt` | `2` | stdout | 0 |
| `notes count -tag work < notes.txt` | `1` | stdout | 0 |
| `notes count -x < notes.txt` | `flag provided but not defined: -x` / `Usage of count:` / `-tag string` … | stderr | 2 |
| `notes add` | `add: missing note text` | stderr | 2 |
| `notes remove 1` | `unknown command "remove"` | stderr | 2 |
| `NOTES_FILE=/no/such/dir/n.txt notes add x 2>/dev/null` | (nothing) | — | 1 |

Three habits show: exit 2 for "you called me wrong" and 1 for "I tried and failed", matching `flag`'s own choice of 2 for usage errors ✅[^2]; every message on standard error, so the last row stays silent while the exit code still reports the failure; and `LookupEnv`, which made `NOTES_FILE=` an explicit (and wrong) choice instead of a silent fallback.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `-v false input.txt` | `v=true`, and `false` becomes the first argument ✅[^1] | A boolean takes no separate value ✅[^2] |
| Flags after the first argument | Treated as arguments ✅[^1] | Parsing stops at the first non-flag ✅[^2] |
| A lone `-` | Kept as an argument (`["-" "-v"]`) ✅[^1] | `-` is a non-flag argument ✅[^2] |
| Same flag name defined twice in one set | Panic | Names must be unique in a `FlagSet` ✅[^2] |
| `os.Exit` after writing to a `bufio.Writer` | Buffered text is lost ✅[^1] | Deferred `Flush` never runs ✅[^3] |
| `log.Fatal` inside a library function | Caller's cleanup is skipped; exit 1 | It calls `os.Exit(1)` ✅[^6] |
| `exec.Command("ls -l")` | `executable file not found in $PATH` ✅[^1] | The name is one program name; there is no shell ✅[^4] |
| `Output()` with `Stderr` already set | `ExitError.Stderr` stays empty | `Output` fills it only when `Stderr` was nil ✅[^4] |
| Same `Cmd` run twice | `exec: already started` ✅[^1] | A `Cmd` cannot be reused ✅[^4] |
| Child killed by a signal | `ExitCode()` is -1, `Exited()` false ✅[^1] | Documented for `ProcessState` ✅[^3] |
| Grandchild keeps stdout open | `Output` waits for it (2 s in the lab) unless `WaitDelay` is set ✅[^1] | Pipes are read until end of file ✅[^4] |
| Unbuffered channel passed to `signal.Notify` | A signal can be missed; `go vet` reports it ✅[^1] | The package does not block when sending ✅[^5] |
| Second Ctrl-C after `stop()` | Program exits with the default action ✅[^1] | `stop` restores the default behaviour ✅[^5] |
| Output piped into `head` | Program dies of `SIGPIPE`, exit 141 ✅[^1] | Broken pipe on descriptor 1 or 2 ✅[^5] |
| Program started with `SIGHUP` or `SIGINT` ignored | They stay ignored, until `Notify` installs a handler | Documented in `os/signal` ✅[^5] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Default `flag` set and `flag.Parse` | Shortest code; `-h` for free | Global state; exits by itself on errors ✅[^2]; awkward to test |
| One `FlagSet` per subcommand with `ContinueOnError` | Testable; you choose exit codes ✅[^2] | A little more code |
| `Output` / `CombinedOutput` | One call, the whole result in memory ✅[^4] | No streaming; with `CombinedOutput` the two streams are mixed |
| `StdoutPipe` / `StdinPipe` | Stream large outputs | Finish reading before `Wait`, and never use `Run` with them ✅[^4] |
| Default `CommandContext` (`Process.Kill`) | Simple ✅[^4]; `SIGKILL` cannot be caught ✅[^5] | No chance for the child to clean up |
| `Cancel` = `SIGTERM` plus `WaitDelay` | Child can exit cleanly; still bounded ✅[^4] | Go ≥ 1.20 ✅[^10]; you choose the delay |
| `signal.NotifyContext` | Gives a `context.Context` to pass to context-aware calls ✅[^5] | Remember to call `stop` ✅[^5] |
| `signal.Notify` with a channel | Receives the signal value itself (`s := <-c`), so each signal can be handled differently ✅[^5] | Buffer it; more wiring |

## Takeaways
- Call `os.Exit` only in `main`, as `os.Exit(run(...))`; return errors or codes from everything else. [rule-candidate]
- Use exit status 2 for usage errors and 1 for failures, and write every message to standard error. [rule-candidate]
- Put all flags before positional arguments, and write `-flag=false` for booleans.
- Use `os.LookupEnv` when an empty value and an unset variable mean different things.
- Never build a shell string for `os/exec` from outside input; pass each argument separately. [rule-candidate]
- Check `errors.As(err, &exitErr)` and `exitErr.ExitCode()`; -1 means the child was killed by a signal.
- Give long-running children `CommandContext` with `Cancel` sending `SIGTERM` and a `WaitDelay`. [rule-candidate]
- Start every long-running `main` with `signal.NotifyContext(ctx, os.Interrupt, syscall.SIGTERM)` and call `stop` once the signal is seen. [rule-candidate]

## Verification status
- Verified: 140 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `go/lab-setup.md` — the Go 1.27.4 lab (`golang:1.27.4`) where every behaviour marked with this note ran on 2026-11-24, with `--network none`: `os.Args`, every flag form and error with exit codes, the `notes` subcommand tool, `LookupEnv`, `SIGPIPE` under bash, exit paths (`return`, `os.Exit`, `log.Fatal`, panic), `os/exec` without a shell, `ExitError`, `ErrNotFound`, `ErrDot` and `GODEBUG=execerrdot=0`, `CommandContext`, `Cancel` with `WaitDelay` and the grandchild pipe (five runs), signals sent with `kill` from the same `sh -c` script, `go vet` on `signal.Notify`, and the binary as PID 1 under `docker stop` (Docker Engine 29.8.2, three runs). [^1]
- [flag package](https://pkg.go.dev/flag) — Go team, living (page for go1.27.4). Rank 1. Backs: defining flags, `Parse`, accepted forms and the boolean exception, where parsing stops, value syntax, `Usage`, `PrintDefaults`, `ErrorHandling`, `FlagSet`, `NewFlagSet`, `Parse` and `ErrHelp`, `SetOutput`, `Func`, `TextVar`, `Value` and `IsBoolFlag`, unique names. [^2]
- [os package](https://pkg.go.dev/os) — Go team, living. Rank 1. Backs: `Args`, `Stdin`/`Stdout`/`Stderr`, `Getenv` and `LookupEnv`, `Exit` skips deferred calls and the 0–125 range, `ProcessState.ExitCode` and `Exited`, `os.Interrupt` and `os.Kill`. [^3]
- [exec package](https://pkg.go.dev/os/exec) — Go team, living. Rank 1. Backs: no shell, `Command`, `Cmd` fields (`Env`, `Dir`, standard streams, `Cancel`, `WaitDelay`), `Run`, `Output`, `CombinedOutput`, `Start`/`Wait`, no reuse, `ExitError`, `LookPath`, `ErrDot` and `execerrdot`, `ErrNotFound`, `ErrWaitDelay`, `CommandContext`. [^4]
- [signal package](https://pkg.go.dev/os/signal) — Go team, living. Rank 1. Backs: uncatchable signals, default behaviour, `Notify` and buffering, `NotifyContext`, `stop` and `Reset`, the cause from `context.Cause`, `SIGPIPE` rules, handlers installed at startup, inherited ignored signals, Windows. [^5]
- [log package](https://pkg.go.dev/log) — Go team, living. Rank 1. Backs: `Fatal` = print + `os.Exit(1)`; the standard logger writes to standard error with date and time. [^6]
- [runtime package](https://pkg.go.dev/runtime) — Go team, living. Rank 1. Backs: an unrecovered panic prints a stack trace and exits with code 2. [^7]
- [Go 1.16 Release Notes](https://go.dev/doc/go1.16) — Go team, 2021. Rank 1. Backs: `flag.Func`, `signal.NotifyContext`. [^8]
- [Go 1.19 Release Notes](https://go.dev/doc/go1.19) — Go team, 2022. Rank 1. Backs: `PATH` lookups no longer return results relative to the current directory; `flag.TextVar`; `Cmd.Dir` sets `PWD`. [^9]
- [Go 1.20 Release Notes](https://go.dev/doc/go1.20) — Go team, 2023. Rank 1. Backs: `Cmd.Cancel` and `Cmd.WaitDelay`. [^10]
- [Go 1.21 Release Notes](https://go.dev/doc/go1.21) — Go team, 2023. Rank 1. Backs: `flag.BoolFunc`. [^11]
- [Go 1.26 Release Notes](https://go.dev/doc/go1.26) — Go team, 2026. Rank 1. Backs: `NotifyContext` cancels with a cause naming the signal. [^12]

## Related
- `go/standard-library/files-and-filesystems.md` — the files a command reads and writes, and why the `Close` error matters.
- `go/standard-library/net-http.md` — `Server.Shutdown`, the HTTP half of a graceful shutdown.
- `go/concurrency/context-and-cancellation.md` — how a cancelled context reaches every goroutine.
- `go/errors/panic-and-recover.md` — what a panic does before the exit status 2.
- `go/standard-library/log-and-slog.md` — loggers, and why `log.Fatal` belongs only in `main`.
- `linux/processes/signals.md` — signal numbers, 128 + n exit codes, PID 1 and stop timeouts.
- `linux/processes/process-lifecycle.md` — fork, exec, wait and zombies, under `os/exec`.
- `operations/config-at-startup.md` — reading environment variables once and validating them.
- `go/learning-path.md`
