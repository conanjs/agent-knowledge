# Plan: Mechanics of epoll EPOLLET (edge-triggered) in Linux

**Request (V's words):** "Mechanics of epoll EPOLLET (Edge-Triggered) in Linux."

## Question

What exactly does edge-triggered mode (`EPOLLET`) make epoll do, step by step inside the kernel and at the API, how is it different from the default level-triggered mode, and what must a program do (and avoid) to use it correctly?

## Sub-questions, one per profile

| Profile | Sub-question | What it must find |
|---|---|---|
| `taxonomy` | What are the canonical names and definitions for the parts of epoll that edge-triggered mode touches? | The terms the man pages and kernel use, each with its definition: epoll instance, interest list, ready list, edge-triggered vs level-triggered, `EPOLLET`, `EPOLLONESHOT`, `EPOLLEXCLUSIVE`, `EPOLLRDHUP`, `EPOLLIN`/`EPOLLOUT`, `EAGAIN`/`EWOULDBLOCK`, "open file description" vs file descriptor, the kernel's own names where they differ (`eventpoll`, `epitem`, wakeup callback). Rank 1 or 3 sources only for the definitions. |
| `ground-truth` | What does the kernel do for an `EPOLLET` registration, from a readiness change on the watched file to `epoll_wait` returning, and what do the official docs require of the caller? | The man pages (`epoll(7)`, `epoll_ctl(2)`, `epoll_wait(2)`) and the kernel source (`fs/eventpoll.c`): when an event is queued on the ready list, what `epoll_wait` does with an ET item vs an LT item after reporting it, whether new data on a not-yet-drained file produces another report, the effect of `EPOLL_CTL_MOD` (re-arming), `EPOLLONESHOT` and `EPOLLEXCLUSIVE` with ET, behaviour across `dup`/`fork`/`close`, the non-blocking + read-until-`EAGAIN` requirement and its exact wording, and the kernel versions each behaviour applies to. |
| `practitioner` | How do production event loops use (or avoid) edge-triggered mode, and how do they drain, re-arm and stay fair? | Real code or official docs of event loops (for example nginx, Go's netpoller, Rust mio/Tokio, libuv, Redis): which mode each registers with and why, accept/read/write loops under ET, handling `EPOLLOUT` after a full send buffer, avoiding starvation of other descriptors (user-space ready lists, read budgets), multithreaded `epoll_wait` with ET. |
| `pitfall` | What goes wrong with `EPOLLET`, and which common beliefs about it are false? | Lost wakeups from partial reads, blocking descriptors under ET, starvation, thundering herd, events from a closed fd whose file description is still open, `EPOLLONESHOT` re-arm races, the belief that a "short read" always means drained, the belief that ET fires only on an empty-to-non-empty transition, and any kernel change or regression that altered ET wake-up behaviour (with the versions). |

## Out of scope

- io_uring, `select`/`poll` beyond a one-line contrast, kqueue (BSD/macOS), IOCP (Windows).
- epoll busy polling (`SO_BUSY_POLL`, `EPIOCSPARAMS`), nested epoll lock ordering, `epoll_pwait2` timer precision.
- Language runtime APIs above the epoll call (promises, futures, goroutine scheduling).
- The path of a packet before it reaches the socket.

**Already covered in `knowledge/`** (the doc links to these instead of repeating them):
- `knowledge/linux/networking/io-multiplexing-epoll-io-uring.md`: the epoll API (`epoll_create1`/`epoll_ctl`/`epoll_wait`), interest and ready lists, LT vs ET in short, the `EAGAIN` rule, `EPOLLONESHOT`, `max_user_watches`, `EPERM` for regular files, io_uring. The deep dive goes deeper on ET only and reuses its terms (interest list, ready list, level-triggered, edge-triggered, non-blocking).
- `knowledge/concurrency/blocking-in-async-runtimes.md`: blocking work inside event loops, language side.
- `knowledge/linux/processes/ipc-pipes-sockets-shm.md`: pipes and sockets as watched descriptors.
- `knowledge/linux/networking/tcp-connection-lifecycle.md`: the sockets an event loop serves.
- `knowledge/linux/networking/packet-path.md`: how data reaches the socket receive buffer.

## Settings

- **Doc:** `RUN/doc.md`, `schema: deep-dive/v1`, `topic: linux/networking` (existing folder).
- **MODE:** `full-verified` (workers, doc, Stage 1 and probes, knowledge-judge, at most 2 patch rounds).
- **CAP:** 4 sources per profile.
- **Seeds:** none supplied by V; each worker searches. If V wants to pin Rank 1 pages, candidates are man7.org `epoll(7)`, `epoll_ctl(2)`, `epoll_wait(2)` (ground-truth, taxonomy) and `fs/eventpoll.c` on git.kernel.org or elixir.bootlin.com (ground-truth).
- **Probes:** C probes (`runtime=c`) for observable ET behaviour, for example a pipe registered with `EPOLLET`, a partial read, and a second `epoll_wait` that times out; worded as observations of the harness's kernel version, never as rules.
- **Token estimate:** 4 workers × about 135k = about 540k; one judge round at up to 80 claims × about 2,600 = about 210k; orchestrator about 150–250k. Total about 0.9M with one judge round, up to about 1.4M if both patch rounds run.
