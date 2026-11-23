---
schema: deep-dive/v1
topic: linux/networking
status: verified
applies-to: ["Linux kernel source v6.12 (fs/eventpoll.c)", "Linux man-pages 6.19 (epoll(7), epoll_ctl(2), epoll_wait(2))", "probes: Linux 7.2.12 (OrbStack VM kernel, aarch64), gcc 13.2.1, harness image linlab:1"]
last-updated: 2026-11-22
last-verified: 2026-11-22
synthesized-into: []
tags: [linux, epoll, EPOLLET, edge-triggered, level-triggered, EPOLLONESHOT, EPOLLEXCLUSIVE, EPOLLRDHUP, event-loop, non-blocking-io]
ranked-sources: true
---

# Edge-triggered epoll (EPOLLET): how the kernel queues, reports and re-arms an event

## Summary
**TL;DR:** With `EPOLLET` (edge-triggered, ET), once an event has been copied out to user space the kernel does not put the item back on the ready list; in the default level-triggered (LT) mode it does, so the next `epoll_wait` checks the file again ✅[^eventpoll]. That is why, under ET, a partial read can leave data that the next `epoll_wait` does not report, and why the man page's suggested use is non-blocking file descriptors (fds) plus waiting for an event only after `read`/`write` returns `EAGAIN` ✅[^epoll7].
**Use this when:** you write or debug an event loop that registers with `EPOLLET` (a connection that "hangs" with data unread, threads that get events for the same fd, events for an fd you already closed), you combine ET with `EPOLLONESHOT` or `EPOLLEXCLUSIVE`, or you need to know which part of the ET contract is the kernel's and which is the caller's.
**Depth:** the kernel path in `fs/eventpoll.c` v6.12 from `EPOLL_CTL_ADD` through the wakeup callback to `epoll_wait`, ET versus LT at each step, re-arming with `EPOLL_CTL_MOD`, `EPOLLONESHOT`, `EPOLLEXCLUSIVE`, several threads on one epoll fd, `dup`/`fork`/`close`; seven C probes run on Linux 7.2.12; how nginx, Go, mio and libuv drain and re-arm (§5.3); the 2019–2021 pipe wakeup regression; common misconceptions and two open conflicts. The epoll API basics are in `linux/networking/io-multiplexing-epoll-io-uring.md` and are not repeated here.

## 1. Mental model

**Analogy.** Level-triggered is a light on the mailbox that stays on while any letter is inside: every time you look, you see it. Edge-triggered is a doorbell the postman rings when he drops a letter: if you take half the letters and go back to sleep, the bell does not ring again for the letters still in the box. Only the next delivery rings it.

**Concrete artifact.** The man page's own scenario: 2 kB written to a pipe, 1 kB read, then a second `epoll_wait`. §4.1 traces it through the kernel step by step and runs it as `probe-01`, once with `EPOLLET` and once without.

**The two lists.** An epoll instance is an in-kernel data structure that user space can consider a container for two lists: the interest list (the fds the process registered) and the ready list (the fds that are ready for I/O), which the kernel fills as a result of I/O activity on those fds ✅[^epoll7].

**The two modes, in the man page's words.** Edge-triggered mode "delivers events only when changes occur on the monitored file descriptor", that is, an event is generated upon each receipt of a chunk of data; level-triggered mode is the default (no `EPOLLET`), and then epoll "is simply a faster poll(2)" with the same semantics ✅[^epoll7].

**The two modes, in the kernel.** In v6.12 the difference is one branch in `ep_send_events`, after an event has been copied to user space: a level-triggered item is inserted back into the ready list "so that the next call to epoll_wait() will check again the events availability", and an `EPOLLET` item is not ✅[^eventpoll]. The rest of this doc follows from that branch: an ET item is reported again when something puts it back on the ready list, namely the file's wakeup callback, or an `EPOLL_CTL_ADD`/`EPOLL_CTL_MOD` that finds the file ready (§3).

## 2. Concept architecture

| Term (man page) | Kernel name (v6.12) | What it is |
|---|---|---|
| epoll instance | `struct eventpoll` | Stored in the `private_data` member of the epoll file's `struct file`; the main data structure of the eventpoll interface ✅[^eventpoll] |
| ready list, interest list | `rdllist`, `rbr`, and `ovflist` | `struct eventpoll` holds `rdllist`, the list of ready fds; `rbr`, the root of the RB tree (red-black tree) that stores the monitored fds; and `ovflist`, a singly linked chain of the items that became ready while events were being transferred to user space without holding the lock ✅[^eventpoll] |
| interest-list entry | `struct epitem` | Each fd added to epoll has an `epitem` linked into the `rbr` tree; its `rdllink` field links it into the ready list ✅[^eventpoll] |
| entry key | — | The fd number together with the open file description ✅[^epoll7] |
| wakeup callback | `ep_poll_callback` | The function passed to the wait-queue wakeup mechanism, called by the watched files when they have events to report ✅[^eventpoll] |
| events mask | `epitem.event.events` | Event types, which `epoll_wait` returns, ORed with input flags, which change behaviour but are not returned ✅[^epollctl] |
| `EPOLLET` | one of `EP_PRIVATE_BITS` | An input flag that requests edge-triggered notification ✅[^epollctl]; the kernel groups `EPOLLWAKEUP`, `EPOLLONESHOT`, `EPOLLET` and `EPOLLEXCLUSIVE` as the epoll private bits of the mask ✅[^eventpoll] |

**Open file description (OFD).** POSIX defines it as a record of how a process or group of processes is accessing a file: each fd refers to exactly one OFD, and one OFD can be referred to by more than one fd ✅[^posix]. Analogy: the OFD is the library loan record; fds are the claim tickets that point to it. Because epoll keys on the OFD as well as the fd number, a ticket can be thrown away while the loan stays open (§3.7).

**Non-blocking.** POSIX defines it as a property of an OFD that makes calls return without delay when the requested action cannot be completed without unknown delay ✅[^posix]. Under ET this is what turns "read until there is nothing left" into a loop that ends with `EAGAIN` instead of a thread stuck in `read`.

## 3. How it works

### 3.1 Registration: `EPOLL_CTL_ADD`

1. The new interest-list entry holds the fd, a reference to its open file description, and the settings given in `event` ✅[^epollctl].
2. `ep_ptable_queue_proc` installs `ep_poll_callback` on the target file's wait queue: with `add_wait_queue_exclusive` when the item has `EPOLLEXCLUSIVE`, with `add_wait_queue` otherwise ✅[^eventpoll].
3. `ep_insert` then polls the file once for its current event bits, and if the file is already "ready" and the item is not linked, it drops the item into the ready list at once ✅[^eventpoll]. So an fd that already holds data when it is added is reported, ET or not.

### 3.2 The file becomes ready: `ep_poll_callback`

When the watched file wakes its wait queue, `ep_poll_callback` runs and, in v6.12:

1. It stops if the item's mask has no poll(2) event left, which the comment calls a disabled fd and ties to `EPOLLONESHOT` (disabled until the next `EPOLL_CTL_MOD`), and it stops if the wakeup carries event bits and none of them is in the item's mask ✅[^eventpoll].
2. While events are being transferred to user space, it chains the item on `ovflist` to be requeued later; otherwise, if the item is not already linked, it adds it to the tail of `rdllist`; then it wakes, if they have waiters, the `epoll_wait` wait queue (`ep->wq`) and the epoll file's own `->poll()` wait list ✅[^eventpoll].

Because an item that is already linked is not added again, several events that occur between two `epoll_wait` calls are combined, not reported separately ✅[^eventpoll][^epoll7]. And because the callback runs only when the watched file wakes its wait queue, a file that does not wake it for new data produces no new ET event: §6.3 tells how pipes did exactly that from Linux 5.5 to a 2021 fix.

### 3.3 `epoll_wait`: `ep_poll` and `ep_send_events`

1. `ep_poll` calls `ep_send_events` when events may be available and returns as soon as it delivered at least one; with zero delivered and time left it tries again ✅[^eventpoll].
2. When nothing is available and the timeout is not zero (a zero timeout returns 0 before this point), `ep_poll` adds the calling thread to `ep->wq` with `__add_wait_queue_exclusive`; this path has no `EPOLLET` test ✅[^eventpoll].
3. `ep_send_events` starts with `ep_start_scan`, which moves the whole ready list to a private list, re-initializes `rdllist` to empty, and sets `ovflist` to NULL so that events happening during the copy are not lost ✅[^eventpoll].
4. For each item it unlinks the item, polls the file again, and skips the item if no requested event is set now; otherwise it copies the event to user space, and then an `EPOLLONESHOT` item has its mask cut to the private bits, a level-triggered item is added back to the tail of the ready list, and an `EPOLLET` item is left off it ✅[^eventpoll].
5. `ep_done_scan` re-inserts the items the callback chained on `ovflist` during the copy, splices the items not processed back onto the ready list, and, if the ready list is not empty and `ep->wq` has waiters, wakes it ✅[^eventpoll].

The re-poll in step 4 is why a stale entry is harmless: if the file is no longer ready, nothing is reported for it. The end of step 4 is the whole ET/LT difference.

### 3.4 Re-arming: `EPOLL_CTL_MOD`

- epoll(7) says a modify on an existing fd "will reread available I/O" ✅[^epoll7].
- In v6.12, `ep_modify` sets the new mask before calling the file's poll, and if the item is "hot" and not on the ready list, pushes it there ✅[^eventpoll]. So re-arming an ET fd that still holds data reports it again without any new data (`probe-03`, §4.3).

### 3.5 `EPOLLONESHOT` with `EPOLLET`

Even with ET, multiple events can be generated upon receipt of multiple chunks of data; `EPOLLONESHOT` tells epoll to disable the fd after one event, and the caller must re-arm it with `EPOLL_CTL_MOD` ✅[^epoll7]. The flag exists since Linux 2.6.2 ✅[^epollctl]. In the kernel the two halves are §3.3 step 4 (mask cut to the private bits) and §3.2 step 1 (a mask with no poll event is ignored).

### 3.6 `EPOLLEXCLUSIVE` and several threads

- `EPOLLEXCLUSIVE` (since Linux 4.5) sets an exclusive wakeup mode for the epoll fd being attached to the target fd: when several epoll fds are attached to the same target with it, one or more of them receive the event, where the default is all of them; it may be combined only with `EPOLLIN`, `EPOLLOUT`, `EPOLLWAKEUP` and `EPOLLET` (`EPOLLHUP` and `EPOLLERR` optional), and other values give `EINVAL` ✅[^epollctl].
- The kernel comment says epoll adds to the wakeup queue at `EPOLL_CTL_ADD` time only, so `EPOLLEXCLUSIVE` is not allowed for an `EPOLL_CTL_MOD` ✅[^eventpoll].
- Threads sharing one epoll fd are a different case: if several threads (or processes that inherited the epoll fd across `fork`) are blocked in `epoll_wait` on the same epoll fd and an `EPOLLET` fd becomes ready, just one of them is woken ✅[^epoll7]. The kernel side of this is §3.3: every sleeper joins `ep->wq` as an exclusive waiter, and only a level-triggered item goes back on the ready list, where `ep_done_scan` wakes `ep->wq` again (`probe-07`, §4.4).

### 3.7 `dup`, `fork` and `close`

`dup`, `dup2`, `fcntl` `F_DUPFD` and `fork` create a new fd that refers to the same OFD; an fd leaves the interest list only after all fds referring to its OFD are closed, so events may be reported for an fd that was already closed, and to prevent this the fd must be removed with `EPOLL_CTL_DEL` before it is duplicated ✅[^epoll7].

### 3.8 The caller's half of the contract

- An application using `EPOLLET` "should use nonblocking file descriptors to avoid having a blocking read or write starve a task that is handling multiple file descriptors", and the suggested use is (1) non-blocking fds and (2) waiting for an event only after `read` or `write` returns `EAGAIN` ✅[^epoll7].
- After an event, "You must consider it ready until the next (nonblocking) read/write yields EAGAIN". For packet- or token-oriented files (a datagram socket, a terminal in canonical mode), reading or writing until `EAGAIN` is the only way to detect the end of the I/O space; for stream-oriented files (pipe, FIFO, stream socket) a short read or write also shows it, and the man page says to avoid that technique if you cannot guarantee the fd always refers to a stream-oriented file ✅[^epoll7].
- Under ET an fd can be added once with `EPOLLIN|EPOLLOUT`, which avoids switching between the two with `EPOLL_CTL_MOD` ✅[^epoll7].
- `EPOLLRDHUP` (since Linux 2.6.17) reports that a stream-socket peer closed the connection or shut down its writing half, and is "especially useful" for detecting peer shutdown under edge-triggered monitoring ✅[^epollctl].

## 4. Worked examples

All probes below ran in the harness container (image `linlab:1`). Each one first calls `print_env()` from the `env` block below, so its recorded output starts with the kernel release, machine and compiler it ran on: Linux 7.2.12 (an OrbStack VM kernel), aarch64, gcc 13.2.1. Each output is what that kernel did, not a rule for every version.

```c lib id=env runtime=c
#include <stdio.h>
#include <sys/utsname.h>

/* Prints the kernel release, machine and compiler this probe ran on. */
static void print_env(void) {
  struct utsname u;
  uname(&u);
  printf("kernel %s, %s, gcc %s\n", u.release, u.machine, __VERSION__);
}
```

### 4.1 The man page's pipe scenario, traced

| Step (epoll(7)) | What the kernel does (v6.12, §3) | ET | LT |
|---|---|---|---|
| 1. Register the pipe's read end `rfd` | `ep_insert` polls: empty pipe, not queued | — | — |
| 2. Writer writes 2 kB | Pipe wakes its wait queue → `ep_poll_callback` → item on `rdllist`, `ep->wq` woken | queued | queued |
| 3. `epoll_wait` | `ep_send_events` re-polls, `EPOLLIN` set, copied out | reported, **not** re-queued | reported, re-queued |
| 4. Reader reads 1 kB | 1 kB stays in the pipe; no write, so no callback | ready list empty | item still on it |
| 5. `epoll_wait` | ET: nothing to send, thread sleeps. LT: re-poll finds `EPOLLIN` | waits | reported |

epoll(7) says the ET call in step 5 "will probably hang despite the available data still present in the file input buffer" ✅[^epoll7].

```c verify id=probe-01 runtime=c uses=env expect="stdout:ET second wait: 0, LT second wait: 1"
#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/epoll.h>

/* Returns how many events the second epoll_wait reports after a partial read. */
static int second_wait(unsigned extra) {
  int p[2]; char buf[2048]; struct epoll_event ev = {0}, out;
  pipe(p); fcntl(p[0], F_SETFL, O_NONBLOCK);
  int ep = epoll_create1(0);
  ev.events = EPOLLIN | extra; ev.data.fd = p[0];
  epoll_ctl(ep, EPOLL_CTL_ADD, p[0], &ev);
  memset(buf, 'x', sizeof buf);
  write(p[1], buf, 2048);               /* step 2: 2 kB written */
  epoll_wait(ep, &out, 1, 100);         /* step 3: reported */
  read(p[0], buf, 1024);                /* step 4: 1 kB read, 1 kB left */
  return epoll_wait(ep, &out, 1, 100);  /* step 5: 100 ms timeout */
}

int main(void) {
  print_env();
  printf("ET second wait: %d, LT second wait: %d\n", second_wait(EPOLLET), second_wait(0));
  return 0;
}
```

On Linux 7.2.12 (the kernel line of the probe's recorded output) the step-5 call timed out with 0 events under ET and returned 1 under LT ✅[^harness][^probe-01].

### 4.2 A new write into a pipe that is not empty

```c verify id=probe-02 runtime=c uses=env expect="stdout:first: 1, no new write: 0, write into non-empty pipe: 1"
#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/epoll.h>

int main(void) {
  print_env();
  int p[2]; char buf[2048]; struct epoll_event ev = {0}, out;
  pipe(p); fcntl(p[0], F_SETFL, O_NONBLOCK);
  int ep = epoll_create1(0);
  ev.events = EPOLLIN | EPOLLET; ev.data.fd = p[0];
  epoll_ctl(ep, EPOLL_CTL_ADD, p[0], &ev);
  memset(buf, 'x', sizeof buf);
  write(p[1], buf, 2048);
  int a = epoll_wait(ep, &out, 1, 100);
  read(p[0], buf, 1024);                /* 1 kB still unread */
  int b = epoll_wait(ep, &out, 1, 100); /* no new write: no event */
  write(p[1], buf, 1);                  /* new write while the pipe is not empty */
  int c = epoll_wait(ep, &out, 1, 100);
  printf("first: %d, no new write: %d, write into non-empty pipe: %d\n", a, b, c);
  return 0;
}
```

On Linux 7.2.12 a 1-byte write into a pipe that still held 1 kB produced a new ET report ✅[^harness][^probe-02]. On that kernel, for pipes, the "edge" was a new write, not only an empty-to-non-empty change; §6.3 explains why pipes behaved differently from 5.5 until a 2021 fix.

### 4.3 Re-arming with `EPOLL_CTL_MOD`, and `EPOLLONESHOT`

```c verify id=probe-03 runtime=c uses=env expect="stdout:before MOD: 0, after MOD: 1"
#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/epoll.h>

int main(void) {
  print_env();
  int p[2]; char buf[2048]; struct epoll_event ev = {0}, out;
  pipe(p); fcntl(p[0], F_SETFL, O_NONBLOCK);
  int ep = epoll_create1(0);
  ev.events = EPOLLIN | EPOLLET; ev.data.fd = p[0];
  epoll_ctl(ep, EPOLL_CTL_ADD, p[0], &ev);
  memset(buf, 'x', sizeof buf);
  write(p[1], buf, 2048);
  epoll_wait(ep, &out, 1, 100);
  read(p[0], buf, 1024);
  int stuck = epoll_wait(ep, &out, 1, 100);
  epoll_ctl(ep, EPOLL_CTL_MOD, p[0], &ev);  /* same mask, no new data */
  int after = epoll_wait(ep, &out, 1, 100);
  printf("before MOD: %d, after MOD: %d\n", stuck, after);
  return 0;
}
```

On Linux 7.2.12, an `EPOLL_CTL_MOD` with the same mask and no new data made the next `epoll_wait` report the half-read pipe again ✅[^harness][^probe-03], the path of §3.4.

```c verify id=probe-04 runtime=c uses=env expect="stdout:first: 1, new data while disarmed: 0, after re-arm: 1"
#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/epoll.h>

int main(void) {
  print_env();
  int p[2]; char buf[64]; struct epoll_event ev = {0}, out;
  pipe(p); fcntl(p[0], F_SETFL, O_NONBLOCK);
  int ep = epoll_create1(0);
  ev.events = EPOLLIN | EPOLLET | EPOLLONESHOT; ev.data.fd = p[0];
  epoll_ctl(ep, EPOLL_CTL_ADD, p[0], &ev);
  write(p[1], "a", 1);
  int a = epoll_wait(ep, &out, 1, 100);
  while (read(p[0], buf, sizeof buf) > 0) {}   /* drain until EAGAIN */
  write(p[1], "b", 1);                         /* new data while disarmed */
  int b = epoll_wait(ep, &out, 1, 100);
  epoll_ctl(ep, EPOLL_CTL_MOD, p[0], &ev);     /* re-arm */
  int c = epoll_wait(ep, &out, 1, 100);
  printf("first: %d, new data while disarmed: %d, after re-arm: %d\n", a, b, c);
  return 0;
}
```

On Linux 7.2.12, with `EPOLLET|EPOLLONESHOT`, data written while the fd was disarmed was not reported, and was reported by the first `epoll_wait` after the re-arm ✅[^harness][^probe-04].

### 4.4 Two threads on one epoll fd

```c verify id=probe-07 runtime=c uses=env repeat=3 expect="stdout:threads that got the event: ET 1, LT 2"
#include <stdio.h>
#include <unistd.h>
#include <pthread.h>
#include <stdatomic.h>
#include <sys/epoll.h>

static int ep;
static atomic_int woken;

static void *waiter(void *arg) {
  struct epoll_event out;
  if (epoll_wait(ep, &out, 1, 300) == 1) atomic_fetch_add(&woken, 1);
  return arg;
}

/* Two threads block on one epoll fd; one byte is written and never read. */
static int threads_woken(unsigned extra) {
  int p[2]; pthread_t t[2];
  pipe(p);
  ep = epoll_create1(0);
  struct epoll_event ev = { .events = EPOLLIN | extra, .data.fd = p[0] };
  epoll_ctl(ep, EPOLL_CTL_ADD, p[0], &ev);
  atomic_store(&woken, 0);
  for (int i = 0; i < 2; i++) pthread_create(&t[i], NULL, waiter, NULL);
  usleep(100000);                       /* both threads are now asleep in epoll_wait */
  write(p[1], "a", 1);
  for (int i = 0; i < 2; i++) pthread_join(t[i], NULL);
  close(p[0]); close(p[1]); close(ep);
  return atomic_load(&woken);
}

int main(void) {
  print_env();
  int et = threads_woken(EPOLLET);
  int lt = threads_woken(0);
  printf("threads that got the event: ET %d, LT %d\n", et, lt);
  return 0;
}
```

On Linux 7.2.12, with two threads blocked on one epoll fd and one unread byte, one thread got the event under ET and both got it under LT; the harness ran the probe 3 times and recorded a pass ✅[^harness][^probe-07].

## 5. Reference & invariants

### 5.1 Flags

| Flag | Kind | Since | Note with `EPOLLET` |
|---|---|---|---|
| `EPOLLIN`, `EPOLLOUT` | event types | — | One ET registration can carry both (§3.8) |
| `EPOLLRDHUP` | event type | Linux 2.6.17 | Peer shutdown, useful under ET (§3.8) |
| `EPOLLET` | input flag | — | Edge-triggered; LT is the default (§2) |
| `EPOLLONESHOT` | input flag | Linux 2.6.2 | Disabled after one event; re-arm with `EPOLL_CTL_MOD` (§3.5) |
| `EPOLLEXCLUSIVE` | input flag | Linux 4.5 | `EPOLL_CTL_ADD` only; combines with `EPOLLET` (§3.6) |

### 5.2 Invariants of the v6.12 code

The passages are those of §3.
- An item is on the ready list at most once: `ep_poll_callback`, `ep_insert` and `ep_modify` add it only when it is not already linked ✅[^eventpoll].
- After an event is copied out, `ep_send_events` puts a level-triggered item back on the ready list, and neither an `EPOLLET` nor an `EPOLLONESHOT` item ✅[^eventpoll].

### 5.3 How production event loops drain and re-arm

| Project (version) | Registration and mode | Drain and re-arm rule |
|---|---|---|
| nginx | The read and write events of each connection "operate in Edge-Triggered mode": a partial read does not make nginx deliver a repeated read notification until more data arrives on the socket, and even on level-triggered mechanisms (`poll`, `select`) nginx converts notifications to edge-triggered ones ✅[^nginx]. Its `pending_eof` flag, EOF pending with data possibly before it, comes from the `EPOLLRDHUP` event on epoll ✅[^nginx] | The guide's sample read handler loops while `rev->ready`, calling `c->recv` until it returns `NGX_AGAIN`, then calls `ngx_handle_read_event(rev, 0)` ✅[^nginx] |
| Go runtime (go1.23.4) | `netpollopen` registers each fd once with `EPOLLIN \| EPOLLOUT \| EPOLLRDHUP \| EPOLLET` ✅[^gonetpoll], the add-once pattern of §3.8 | — |
| mio (1.0.2, Rust) | The `Poll` docs' Implementation notes list epoll as the Linux selector, and the docs say that once a readiness event is received, the operation "must be performed repeatedly until it returns WouldBlock"; otherwise there is no guarantee another event will be delivered, even if more data arrives ✅[^mio] | Repeat until `WouldBlock` (same claim) |
| libuv (v1.49.2) | `uv__read` stops after 32 reads to "Prevent loop starvation", next to the comment "XXX Need to rearm fd if we switch to edge-triggered I/O", and returns after a read that did not fill the buffer, treating that as no more data ✅[^libuv] | When a write returns `EAGAIN` or is partial, `uv__write` starts the `POLLOUT` watcher and returns, unless the stream has `UV_HANDLE_BLOCKING_WRITES`, in which case it tries the write again ✅[^libuv] |

### 5.4 Limits and history

- If more than `n` (the maximum-events argument) fds are ready, successive `epoll_wait` calls round-robin through the ready set, which helps avoid starvation ✅[^epollwait].
- epoll(7) gives the history as Linux 2.5.44 and glibc 2.3.2 ✅[^epoll7]. epoll_wait(2) gives Linux 2.6, with a source comment "To be precise: Linux 2.5.44" and "The interface should be finalized by Linux 2.5.66" ✅[^epollwait]. The same Rank 1 page thus gives both numbers, so the 2.5.44 of epoll(7) and the 2.6 of epoll_ctl(2) do not conflict.

## 6. Trade-offs, pitfalls & misconceptions

### 6.1 Pitfalls

| Pitfall | What happens | Fix |
|---|---|---|
| Partial read, then `epoll_wait` | The rest of the data is not reported until new data arrives (§4.1) | Read until `EAGAIN`, or record that the fd is still ready (§3.8) |
| Blocking fd under ET | A blocking `read`/`write` starves a task handling many fds (§3.8) | Non-blocking fds |
| Draining one fd starves the others | With a large I/O space, draining it can leave the other files unprocessed, a problem the man page says is not specific to epoll; its fix is a user-space ready list that marks fds ready and round-robins among them ✅[^epoll7] | That fix; libuv also caps a call at 32 reads (§5.3) |
| `close` while a duplicate is open | Events keep arriving for the closed fd (§3.7) | `EPOLL_CTL_DEL` before `close`/`dup` (§6.2) |

### 6.2 Closed fds that keep reporting

The 2017 post "Epoll is fundamentally broken 2/2" adds that once the registered fd is closed, the registration cannot be removed, because `EPOLL_CTL_DEL` needs a valid fd and neither the closed fd nor its duplicate works, and its advice is to always call `EPOLL_CTL_DEL` before `close()` ✅[^popcount2].

```c verify id=probe-05 runtime=c uses=env expect="stdout:events: 1 for closed fd 3 (data.fd=3); DEL closed fd: -1 Bad file descriptor; DEL dup: -1 No such file or directory"
#include <stdio.h>
#include <errno.h>
#include <string.h>
#include <unistd.h>
#include <sys/epoll.h>

int main(void) {
  print_env();
  int p[2]; struct epoll_event ev = {0}, out = {0};
  pipe(p);
  int ep = epoll_create1(0);
  int rfd = p[0];
  ev.events = EPOLLIN | EPOLLET; ev.data.fd = rfd;
  epoll_ctl(ep, EPOLL_CTL_ADD, rfd, &ev);
  int rfd2 = dup(rfd);
  close(rfd);                                  /* rfd2 keeps the open file description alive */
  write(p[1], "a", 1);
  int n = epoll_wait(ep, &out, 1, 100);
  int d1 = epoll_ctl(ep, EPOLL_CTL_DEL, rfd, &ev);  int e1 = errno;
  int d2 = epoll_ctl(ep, EPOLL_CTL_DEL, rfd2, &ev); int e2 = errno;
  printf("events: %d for closed fd %d (data.fd=%d); DEL closed fd: %d %s; DEL dup: %d %s\n",
         n, rfd, out.data.fd, d1, strerror(e1), d2, strerror(e2));
  return 0;
}
```

On Linux 7.2.12 the probe printed, after its kernel line, `events: 1 for closed fd 3 (data.fd=3); DEL closed fd: -1 Bad file descriptor; DEL dup: -1 No such file or directory` ✅[^harness][^probe-05]. The duplicate is a different key (§2: fd number plus OFD), so the instance does not know it.

### 6.3 Misconception: "an edge is only an empty-to-non-empty change"

- **The claim.** Linus Torvalds, quoted by LWN in 2021: "An edge is not 'somebody wrote more data'. An edge is 'there was no data, now there is data'."; the article adds that "The epoll() man page agrees with Torvalds's description" ✅[^lwn].
- **What governs.** The man page's own words, not LWN's (Rank 4) reading of them: epoll(7) (Rank 1) says ET generates an event "upon each receipt of a chunk of data" (§1), and that even with ET, multiple events can be generated upon receipt of multiple chunks (§3.5). In the kernel, an ET item is queued when the watched file wakes its wait queue (§3.2), so a write into a non-empty buffer is reported when that file type wakes its waiters for it. A program that follows the caller's contract of §3.8 (treat the fd as ready until `EAGAIN`) does not depend on either reading.
- **When the claim held: pipes, Linux 5.5 to the 2021 fix.**
  - A 2019 pipe change made a write wake waiting readers only if the pipe buffer was empty at the start of the write; after it, a process that started an edge-triggered wait on a pipe that already held data did not see the "edge" and did not wake ✅[^lwn].
  - Android libraries such as Realm, which relied on an edge-triggered wakeup even when data was already waiting in the pipe, broke when the 5.10 kernel went into the Android 12 beta ✅[^lwn].
  - The fix was merged for 5.14-rc4 and included in the 5.10.56 and 5.13.8 stable updates, and does not quite restore the old behaviour, doing only one wakeup per write; the regression had shipped with 5.5 (January 2020), lasted about a year and a half and reached the 5.10 long-term-stable release ✅[^lwn].
  - `probe-02` (§4.2) shows Linux 7.2.12 reporting a write into a non-empty pipe.
- **The dispute, and other file types.** A reader comment by mkerrisk (a comment, not the article) calls the article's reading "questionable" and quotes epoll(7)'s `EPOLLONESHOT` passage against it, and says every other mechanism he tested (Internet domain stream sockets, POSIX message queues, terminals, hierarchical epoll) behaves the same as `EPOLLET` historically behaved ✅[^lwn].

### 6.4 Misconception: "a short read means the fd is drained"

- **What governs.** epoll(7): true only for stream-oriented files, and to be avoided when the fd may not always be one (§3.8).
- In a 2003 linux-kernel thread, a reply signed Davide Libenzi gives the rule: when `read`/`write` returns a lower number of bytes, it is time to stop processing the fd, and events that happened meanwhile come at the next `epoll_wait()` ✅[^lkml2003].
- Jamie Lokier, in the same thread: some kinds of fd return a short read when more data is pending (ttys, some devices, and TCP if there is urgent data and under some other conditions), so read-until-`EAGAIN` is required nonetheless ✅[^lkml2003].
- libuv's `uv__read`, which stops at a short read, carries the comment that the fd would need re-arming if libuv switched to edge-triggered I/O; mio's portability rules require repeating until `WouldBlock` (§5.3). The two Rank 1 sources describe different loops, not one rule.

### 6.5 Misconception: "re-arming `EPOLLONESHOT` after the read loses events"

- A reader comment on the LWN article (NYKevin) says that with `EPOLLONESHOT` you have to re-arm before calling `read` or `write` to avoid a race, which leaves another race in which duplicate notifications can still arrive ✅[^lwn].
- **What governs.** `EPOLL_CTL_MOD` re-polls the file and queues the item if it is ready (§3.4, epoll(7): "Modify will reread available I/O"), so data that arrived while the fd was disarmed is reported after the re-arm. `probe-04` (§4.3) shows it on Linux 7.2.12.

### 6.6 Threads, `accept` and the thundering herd

These claims come from the 2017 post "Epoll is fundamentally broken 1/2" (Rank 6):
- With level-triggered epoll and no special flags, all the workers are woken on each new connection ✅[^popcount1].
- With edge-triggered epoll a second thread can be woken needlessly: it calls `accept` and gets `EAGAIN`, because the first thread must keep calling `accept` until `EAGAIN` ✅[^popcount1].
- The post's fix for `accept` is kernel 4.5+ with level-triggered events and `EPOLLEXCLUSIVE`; without it, edge-triggered plus `EPOLLONESHOT`, at the cost of one extra `epoll_ctl()` call after each event and with at most one worker calling `accept()` at a time ✅[^popcount1].
- For `read` on a connected socket, ET has a race: after thread A drains the buffer, new data wakes thread B, and both read the same socket; the post's fix is `EPOLLONESHOT` with a manual re-arm ✅[^popcount1].
- The same post opens by saying multi-threaded scaling was fixed by the `EPOLLONESHOT` and `EPOLLEXCLUSIVE` flags, and later says `EPOLLEXCLUSIVE` won't help with the `read` race ✅[^popcount1]: for `EPOLLEXCLUSIVE`, the opening claim holds for `accept` only.

### 6.7 Conflicts between sources

**Arbitrated:**
- *Is the single-waiter wakeup specific to `EPOLLET`?* epoll(7) says one thread is woken for an `EPOLLET` fd (§3.6); the v6.12 code adds every `epoll_wait` sleeper as an exclusive waiter with no `EPOLLET` test (§3.3). Both are Rank 1, and they do not contradict each other: the man page says nothing about LT, and the code re-queues an LT item and wakes `ep->wq` again in `ep_done_scan`. `probe-07` shows the outcome on Linux 7.2.12: ET 1 thread, LT 2.
- *First kernel with epoll:* 2.5.44 (epoll(7)) versus 2.6 (epoll_ctl(2), epoll_wait(2)). epoll_wait(2)'s source comment settles it (§5.4).
- *Read until `EAGAIN` versus stop at a short read:* §6.4.

**Open (neither appears in §1 to §5):**
- *Does a listening socket under ET report a connection that arrives while earlier ones are still queued?* ⚠️ unverified. The 2017 post (Rank 6) says no: the socket "was 'readable', still is 'readable'", so no event is emitted ✅[^popcount1]. A reader comment on the LWN article says `EPOLLET` "will re-arm when there is a new write (unless it was done on a pipe on v5-v15)" ✅[^lwn], but it is about data, not connections. No Rank 1 page settles it. On Linux 7.2.12, `probe-06` saw a second connection into a non-empty accept queue reported ✅[^harness][^probe-06]; that is one kernel version, not a rule.

```c verify id=probe-06 runtime=c uses=env expect="stdout:first: 1, idle: 0, second connection into non-empty queue: 1"
#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <sys/socket.h>
#include <sys/epoll.h>

static int dial(int port) {
  struct sockaddr_in a = { .sin_family = AF_INET, .sin_port = htons(port) };
  a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  int c = socket(AF_INET, SOCK_STREAM, 0);
  connect(c, (struct sockaddr *)&a, sizeof a);
  return c;
}

int main(void) {
  print_env();
  struct sockaddr_in a = { .sin_family = AF_INET, .sin_port = 0 };
  a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  socklen_t len = sizeof a;
  int l = socket(AF_INET, SOCK_STREAM, 0);
  bind(l, (struct sockaddr *)&a, sizeof a); listen(l, 16);
  getsockname(l, (struct sockaddr *)&a, &len);
  fcntl(l, F_SETFL, O_NONBLOCK);
  int ep = epoll_create1(0);
  struct epoll_event ev = { .events = EPOLLIN | EPOLLET, .data.fd = l }, out;
  epoll_ctl(ep, EPOLL_CTL_ADD, l, &ev);
  dial(ntohs(a.sin_port));
  int first = epoll_wait(ep, &out, 1, 200);
  int idle = epoll_wait(ep, &out, 1, 200);       /* nothing accepted, no new connection */
  dial(ntohs(a.sin_port));                       /* second connection, queue not empty */
  int second = epoll_wait(ep, &out, 1, 200);
  printf("first: %d, idle: %d, second connection into non-empty queue: %d\n", first, idle, second);
  return 0;
}
```

- *Does `EPOLLWAKEUP` apply together with `EPOLLET`?* ⚠️ unverified. epoll(7) describes `EPOLLWAKEUP` keeping the system awake from the moment the event is queued, with no condition ✅[^epoll7]; epoll_ctl(2) says it applies only if `EPOLLONESHOT` and `EPOLLET` are clear and the process has `CAP_BLOCK_SUSPEND` ✅[^epollctl]. In the v6.12 source, the registration check `ep_take_care_of_epollwakeup` clears `EPOLLWAKEUP` only when the caller lacks `CAP_BLOCK_SUSPEND` (or the kernel has no `CONFIG_PM_SLEEP`), with no `EPOLLET` test ✅[^eventpoll]. When `ep_send_events` delivers an item, it relaxes the item's wakeup source (`__pm_relax(ws)`) and calls `ep_pm_stay_awake(epi)` again only in the level-triggered branch, while `ep_poll_callback` calls `ep_pm_stay_awake_rcu(epi)` whenever it queues an item, with no `EPOLLET` test ✅[^eventpoll]. So for an `EPOLLET` item nothing is held after `epoll_wait` returns it, which matches epoll_ctl(2)'s condition for the time the event is being processed, but the time it is pending is not conditioned on `EPOLLET`. All three are Rank 1; the part after `epoll_wait` returns is settled by the code, the pending part stays open.

### 6.8 EOF folded into the data event

In 2003 Eric Varsanyi reported that under edge-triggered epoll, a client that writes data and then shuts down its write side gives the server a single `EPOLLIN` for both, with no way to tell that EOF also occurred, and proposed a `POLLRDHUP` event ✅[^lkml2003]. `EPOLLRDHUP` exists since Linux 2.6.17 (§3.8), and nginx's `pending_eof` comes from it (§5.3).

## References
- [epoll(7)](https://man7.org/linux/man-pages/man7/epoll.7.html) — Linux man-pages project (man-pages 6.19), living. Rank 1. Backs: interest and ready lists, ET and LT definitions, the pipe scenario, the non-blocking and `EAGAIN` rules, `EPOLLONESHOT`, single-waiter wakeup, the key, `dup`/`fork`/`close`, combined events, modify rereads, short reads, starvation, `EPOLLWAKEUP`, history. [^epoll7]
- [epoll_ctl(2)](https://man7.org/linux/man-pages/man2/epoll_ctl.2.html) — Linux man-pages project (man-pages 6.19), living. Rank 1. Backs: entry contents, event types and input flags, `EPOLLRDHUP`, `EPOLLET`, `EPOLLONESHOT`, `EPOLLWAKEUP`, `EPOLLEXCLUSIVE`. [^epollctl]
- [epoll_wait.2 at man-pages-6.19](https://git.kernel.org/pub/scm/docs/man-pages/man-pages.git/plain/man/man2/epoll_wait.2?h=man-pages-6.19) — Linux man-pages project, 2026. Rank 1. Backs: round robin, history. [^epollwait]
- [fs/eventpoll.c at v6.12](https://github.com/torvalds/linux/blob/v6.12/fs/eventpoll.c) — Linux kernel, 2024. Rank 1. Backs: `struct eventpoll`, `epitem`, `rdllist`, `rbr`, `ovflist`, `ep_poll_callback`, `ep_insert`, `ep_modify`, `ep_send_events`, `ep_done_scan`, `ep_poll`, `EP_PRIVATE_BITS`, the `EPOLLEXCLUSIVE` and `EPOLLWAKEUP` checks. [^eventpoll]
- [POSIX.1-2024, Base Definitions, chapter 3: Definitions](https://pubs.opengroup.org/onlinepubs/9799919799/basedefs/V1_chap03.html) — The Open Group and IEEE, 2024. Rank 1. Backs: open file description, non-blocking. [^posix]
- [nginx development guide](https://nginx.org/en/docs/dev/development_guide.html) — nginx, living. Rank 1. Backs: edge-triggered connection events, the read-handler loop, `pending_eof` from `EPOLLRDHUP`. [^nginx]
- [mio::Poll (mio 1.0.2)](https://docs.rs/mio/1.0.2/mio/struct.Poll.html) — mio project, 2024. Rank 1. Backs: drain until `WouldBlock`, epoll on Linux. [^mio]
- [src/unix/stream.c at libuv v1.49.2](https://github.com/libuv/libuv/blob/v1.49.2/src/unix/stream.c) — libuv project, 2024. Rank 1. Backs: 32-read cap and its edge-triggered comment, stop at a short read, `POLLOUT` after a partial write. [^libuv]
- [src/runtime/netpoll_epoll.go at go1.23.4](https://github.com/golang/go/blob/go1.23.4/src/runtime/netpoll_epoll.go) — The Go Authors, 2024. Rank 1. Backs: the `EPOLLIN|EPOLLOUT|EPOLLRDHUP|EPOLLET` registration. [^gonetpoll]
- [The edge-triggered misunderstanding](https://lwn.net/Articles/864947/) — LWN.net (Jonathan Corbet), 2021. Rank 4. Backs: the 2019 pipe wakeup change, the regression from 5.5 and its 2021 fix, Torvalds's definition; reader comments (unvetted, cited as such in §6 only). [^lwn]
- [Epoll is fundamentally broken 1/2](https://idea.popcount.org/2017-02-20-epoll-is-fundamentally-broken-12/) — Marek Majkowski (personal blog), 2017. Rank 6. Backs: §6.6 and the open listening-socket conflict. [^popcount1]
- [Epoll is fundamentally broken 2/2](https://idea.popcount.org/2017-03-20-epoll-is-fundamentally-broken-22) — Marek Majkowski (personal blog), 2017. Rank 6. Backs: §6.2. [^popcount2]
- [[Patch][RFC] epoll and half closed TCP connections](https://lore.kernel.org/all/20030712231147.GI15643@srv.foo21.com/T/) — linux-kernel mailing list thread, 2003. Rank 6. Backs: §6.4 and §6.8. [^lkml2003]
- `verdicts/round-<n>.harness.json` — the Stage 1.5 result of each round: every probe's exit code and stdout, run in the harness container on Linux 7.2.12. [^harness]
- `probes/probe-01.c` — verify, C (gcc 13.2.1, image linlab:1) on Linux 7.2.12, prints its kernel line, then `ET second wait: 0, LT second wait: 1`. [^probe-01]
- `probes/probe-02.c` — verify, C (gcc 13.2.1, image linlab:1) on Linux 7.2.12, prints its kernel line, then `first: 1, no new write: 0, write into non-empty pipe: 1`. [^probe-02]
- `probes/probe-03.c` — verify, C (gcc 13.2.1, image linlab:1) on Linux 7.2.12, prints its kernel line, then `before MOD: 0, after MOD: 1`. [^probe-03]
- `probes/probe-04.c` — verify, C (gcc 13.2.1, image linlab:1) on Linux 7.2.12, prints its kernel line, then `first: 1, new data while disarmed: 0, after re-arm: 1`. [^probe-04]
- `probes/probe-05.c` — verify, C (gcc 13.2.1, image linlab:1) on Linux 7.2.12, prints its kernel line, then `events: 1 for closed fd 3 (data.fd=3); DEL closed fd: -1 Bad file descriptor; DEL dup: -1 No such file or directory`. [^probe-05]
- `probes/probe-06.c` — verify, C (gcc 13.2.1, image linlab:1) on Linux 7.2.12, prints its kernel line, then `first: 1, idle: 0, second connection into non-empty queue: 1`. [^probe-06]
- `probes/probe-07.c` — verify, C (gcc 13.2.1, image linlab:1, pthreads) on Linux 7.2.12, run 3 times, prints its kernel line, then `threads that got the event: ET 1, LT 2`. [^probe-07]

## Related
- `linux/networking/io-multiplexing-epoll-io-uring.md` — the epoll API, interest and ready lists, LT versus ET in short, `max_user_watches`, `EPERM` for regular files, io_uring.
- `concurrency/blocking-in-async-runtimes.md` — blocking work inside event loops, language side.
- `linux/processes/ipc-pipes-sockets-shm.md` — pipes and sockets as watched descriptors.
- `linux/networking/tcp-connection-lifecycle.md` — the sockets an event loop serves.
- `linux/networking/packet-path.md` — how data reaches the socket receive buffer.
