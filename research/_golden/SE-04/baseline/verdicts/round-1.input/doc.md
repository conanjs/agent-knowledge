---
schema: deep-dive/v1
topic: linux
status: draft
applies-to: ["Linux epoll, any kernel since 2.5.44; kernel source read at mainline on 2026-11-22", "lab experiments on Linux 7.2.12 (OrbStack, aarch64)", "pipe wakeup history: Linux 5.4, 5.5 and the 2021 fixes"]
last-updated: 2026-11-22
last-verified: 2026-11-22
synthesized-into: []
tags: [linux, epoll, epollet, edge-triggered, level-triggered, epolloneshot, epollexclusive, nonblocking-io, event-loop, pipe, thundering-herd]
---

# epoll edge-triggered mode (EPOLLET) in Linux, end to end

## Summary
**TL;DR:** With `EPOLLET`, `epoll_wait` reports a file descriptor once each time the watched file signals new activity (new data, freed buffer space, a hang-up). It does not keep reporting it on every call while the descriptor stays ready. Inside the kernel the whole difference is one branch: after an event is delivered, a level-triggered item goes back on the ready list and an edge-triggered item does not. So the application must keep reading or writing a nonblocking descriptor until `EAGAIN`, or it may never hear about leftover data again. In exchange, one edge wakes only one of several threads waiting on the same epoll instance.
**Use this when:** you write or review an epoll event loop; a connection "hangs" with data still in its buffer; you choose between level-triggered mode, `EPOLLET`, `EPOLLONESHOT` and `EPOLLEXCLUSIVE` for a multi-threaded server; you read the epoll code in Go, mio (Rust) or nginx; a pipe-based wakeup behaves differently after a kernel upgrade.
**Depth:** every registration flag with its default; the four actors and the kernel data structures; registration, wakeup and harvest step by step from `fs/eventpoll.c`; what exactly counts as an "edge", with the 2019–2021 pipe regression as evidence; a worked read and write loop with a timeline; cross-actor interactions; multi-threading patterns; how Go, mio, nginx and io_uring use the flag; a failure matrix; 14 lab experiments on Linux 7.2.12.

---

## 1. Context: why edge-triggered mode exists

A server with thousands of connections cannot park one thread on each socket. It asks the kernel instead: "tell me which of these descriptors I can read or write without blocking". `select` and `poll` take the whole list on every call ⚠️ unverified. epoll keeps the list inside the kernel and returns only the descriptors that are ready. epoll has been in Linux since 2.5.44 ✅[^epoll7].

epoll has two reporting modes:

- **Level-triggered (LT), the default** ✅[^ctl]: a descriptor is reported on every `epoll_wait` call for as long as it stays ready. The man page calls it "simply a faster poll(2)" ✅[^epoll7].
- **Edge-triggered (ET), with `EPOLLET`** ✅[^ctl]: a descriptor is reported when something changes on it, and then not again until the next change ✅[^epoll7].

Why anyone wants ET: an LT loop that is not ready to consume a descriptor, for example a socket that is writable while there is nothing to send, gets it back on every call. ET reports it once and stays quiet. The cost is a stricter contract: the application must consume everything that is available, because the kernel will not remind it. Several widely used event loops register with ET: the Go runtime ✅[^go], mio (the I/O layer under the Tokio async runtime for Rust) ✅[^mio], and nginx for client connections ✅[^nginx].

**Analogy:** LT is a mailbox flag that stays up while there is mail inside. ET is a doorbell: it rings once per visit, and if you collect only half the parcels, nobody rings again until a new delivery arrives.

---

## 2. Words first

| Term | Plain English | Analogy | Concrete artifact |
|---|---|---|---|
| File descriptor (fd) | A small integer that names an open file, pipe or socket inside one process | A cloakroom ticket number | `p[0] = 3` after `pipe(p)` |
| Open file description | The kernel object an fd points to (offset, flags, the file). Several fds can share one, after `dup` or `fork` | The coat itself; two tickets can point to the same coat | `b = dup(a)`: two numbers, one description |
| epoll instance | A kernel object that holds the watch lists. It is itself an fd | A pager desk at a restaurant | `epfd = epoll_create1(0)` |
| Interest list | The set of fds registered on the instance ✅[^epoll7] | The guest list at the desk | `epoll_ctl(epfd, EPOLL_CTL_ADD, fd, &ev)` |
| Ready list | The subset the kernel fills as I/O happens ✅[^epoll7] | The "needs attention" tray | `rdllist` in `struct eventpoll` ✅[^src] |
| epitem | The kernel record for one registration: the fd number, the file, the mask, list links ✅[^src] | One index card per guest | `struct epitem` with `rbn`, `rdllink`, `ffd` ✅[^src] |
| Wait queue | A list, owned by a file, of parties to notify when its state changes | A "call me when it arrives" list at a shop counter | A pipe's `rd_wait` and `wr_wait` ✅[^pipesrc] |
| Wakeup callback | The function epoll hooks onto each watched file's wait queue ✅[^src] | A forwarding rule on that list that buzzes your pager | `ep_poll_callback` |
| Harvest | This doc's word for `epoll_wait` collecting entries from the ready list and copying them to the application | Emptying the tray | `ep_send_events` and `ep_deliver_event` ✅[^src] |
| Nonblocking fd | An fd whose `read`/`write` fails at once with `EAGAIN` instead of sleeping when it cannot proceed | A shop that says "nothing yet, come back later" instead of making you queue | `fcntl(fd, F_SETFL, flags \| O_NONBLOCK)`; then `read` returns `-1`, errno `EAGAIN` ("Resource temporarily unavailable") ✅[^exp] |
| `EAGAIN` | The error number ("try again") meaning "no data or space right now" | The "come back later" sign | `read(4096) = -1 (Resource temporarily unavailable)` ✅[^exp] |
| Thundering herd | Many sleepers woken for one event, all but one find nothing to do | Everyone in a waiting room standing up when one name is called | 4 of 4 threads woken by one write in LT mode ✅[^exp] |

Abbreviations used below: LT = level-triggered; ET = edge-triggered; `EPOLLRDHUP` = "read hang-up" (the peer closed or shut down its writing side) ✅[^ctl]; `EPOLLHUP` = hang-up; `EPOLLERR` = error; TCP = Transmission Control Protocol; `AF_UNIX` = UNIX-domain sockets, which connect processes on one machine; FIFO = a named pipe (first in, first out); LKML = the Linux Kernel Mailing List; "mainline" = the kernel's main development branch.

---

## 3. The actors and their data structures

**4 actors:**
- **Application thread**: its job: register fds and react to events, via `epoll_ctl()` and `epoll_wait()`, then move bytes, via `read()`/`write()`.
- **epoll instance** (`struct eventpoll`): its job: store registrations, via a red-black tree of epitems, and queue ready ones, via the ready list ✅[^src].
- **Watched file's driver** (pipe, socket, terminal): its job: report its current state, via its `poll` method, and announce changes, via a wake-up on its own wait queue ✅[^src] ✅[^pipesrc].
- **Wakeup callback** (`ep_poll_callback`): its job: put the epitem on the ready list and wake a sleeping `epoll_wait`, via the wait-queue entry epoll attached at registration ✅[^src].

**The artifacts** (field names from `fs/eventpoll.c` in mainline, read 2026-11-22 ✅[^src]):

```text
struct eventpoll            one per epoll instance
  mtx        sleepable lock held while events are delivered
  lock       spinlock protecting rdllist and ovflist (the callback can run in interrupt context)
  rbr        red-black tree root: every epitem of the interest list
  rdllist    ready list
  ovflist    overflow list: catches callbacks that fire while rdllist is being scanned
  wq         wait queue of threads sleeping in epoll_wait()
  poll_wait  wait queue used when this epoll fd is itself polled

struct epitem               one per (fd number, open file description) registration
  rbn        link into rbr
  rdllink    link into rdllist (linked = "already queued")
  ffd        the fd number and the file pointer
  event      the registered mask (EPOLLIN, EPOLLET, ...) and the user's data
```

Three terms in that block: a *red-black tree* is a sorted tree that stays balanced, so finding the epitem for an fd stays fast with many registrations (like an alphabetised card index); a *spinlock* is a lock a CPU waits on by spinning, usable where sleeping is not allowed, such as interrupt handlers; a *mutex* is a lock whose waiters sleep.

The key of a registration is the fd number *together with* the open file description ✅[^epoll7]. Each registration costs roughly 160 bytes on a 64-bit kernel, and `/proc/sys/fs/epoll/max_user_watches` caps the total per user ✅[^epoll7].

---

## 4. Every flag and parameter

| Flag / parameter | Since | What it does | When unset | Interaction with `EPOLLET` |
|---|---|---|---|---|
| `EPOLLIN` / `EPOLLOUT` | 2.5.44 | Interest in "readable" / "writable" | That direction is ignored: wakeups whose bits do not overlap the mask are dropped by the callback ✅[^src] | ET applies to each requested direction |
| `EPOLLET` | 2.5.44 | Edge-triggered notification ✅[^ctl] | Level-triggered, the default ✅[^ctl] | — |
| `EPOLLONESHOT` | 2.6.2 ✅[^ctl] | After one reported event, the fd is disabled until `EPOLL_CTL_MOD` re-arms it ✅[^ctl] | Events keep coming | Common pairing: ET + ONESHOT gives "one event, one owner thread" (§9) |
| `EPOLLRDHUP` | 2.6.17 ✅[^ctl] | Reports that a stream socket's peer closed or shut down writing ✅[^ctl] | End of file seen only as `read() == 0` | The man page calls it especially useful with ET ✅[^ctl]; reported once in ET mode ✅[^exp] |
| `EPOLLHUP`, `EPOLLERR` | 2.5.44 | Hang-up and error | Always reported, even if not requested ✅[^ctl] | — |
| `EPOLLEXCLUSIVE` | 4.5 ✅[^ctl] | When several epoll instances watch one file, wake "one or more" of them instead of all ✅[^ctl] | All instances are woken ✅[^ctl] ✅[^exp] | Allowed together with `EPOLLET`; only with `EPOLL_CTL_ADD`; `EPOLL_CTL_MOD` fails with `EINVAL` ✅[^ctl] |
| `EPOLLWAKEUP` | 3.5 ✅[^ctl] | Keeps the system from suspending while an event is pending | No suspend blocking | Applies only when `EPOLLONESHOT` and `EPOLLET` are both clear, and needs the `CAP_BLOCK_SUSPEND` privilege; without that privilege the flag is silently ignored ✅[^ctl] |
| `epoll_wait` `maxevents` | 2.5.44 | Most events returned per call | — (required) | Items not returned stay queued; successive calls round-robin through them ✅[^wait] ✅[^exp] |
| `epoll_wait` `timeout` | 2.5.44 | `-1` blocks, `0` returns at once, otherwise milliseconds ✅[^wait] | — (required) | Lab tests use `0`, so "0 events" means "nothing queued now"; T10 and T11 use 400 ms |
| `data` field | 2.5.44 | Opaque value returned with each event, from the latest ADD or MOD ✅[^wait] | — | — |

Rows marked 2.5.44 give the version that introduced epoll ✅[^epoll7]; no later version was found for those flags.

---

## 5. The mechanism, step by step

### 5.1 Diagram

```text
 USER SPACE                     │ KERNEL
                                │
 App thread                     │  epoll instance (struct eventpoll)
  epoll_ctl(ADD, fd, IN|ET) ────┼─► new epitem in rbr
                                │      ├─ poll the file once: ready already? → link on rdllist
                                │      └─ hook ep_poll_callback onto the file's wait queue
                                │
                                │  watched file's driver (pipe, socket)
 peer: write(2048) ─────────────┼─► data queued → wake its wait queue, key EPOLLIN
                                │        └─► ep_poll_callback (may run in interrupt context)
                                │              bits overlap mask? no → ignore
                                │              already on rdllist?  yes → nothing (events merge)
                                │              else link epitem on rdllist; wake ONE epoll_wait sleeper
                                │
 epoll_wait() ──────────────────┼─► harvest each epitem on rdllist:
                                │      unlink; poll the file again
                                │        nothing requested is ready → drop it, deliver nothing
                                │      copy {events from this poll, data} to user
                                │        ONESHOT → disable the mask until EPOLL_CTL_MOD
                                │        LT      → link the epitem back on rdllist
                                │        ET      → leave it off (back only on the next wakeup)
  events[] ◄────────────────────┼──  after the scan: rdllist still non-empty? wake the next sleeper
```

### 5.2 Steps

The `│` line in the diagram is the system-call boundary: everything right of it runs inside the kernel, triggered either by a system call or by the driver.

1. **App → kernel (`epoll_ctl`, system call):** `EPOLL_CTL_ADD` with mask `EPOLLIN | EPOLLET` and a `data` value.
2. **epoll (kernel, `ep_insert`):**
   - Creates the epitem and inserts it in the red-black tree ✅[^src].
   - Calls the file's `poll` method, passing the registered mask as the *poll key*, the bit mask that tells a driver which events the caller cares about (`pt->_key = epi->event.events`) ✅[^src]. That call hooks `ep_poll_callback` onto the file's wait queue (an exclusive hook if `EPOLLEXCLUSIVE` is set) ✅[^src].
   - If that poll already reports a requested bit, the epitem goes on the ready list at once ✅[^src]. So an fd that is readable when it is added is reported once, even in ET mode ✅[^exp] (T2).
3. **Driver (kernel, on new activity):** wakes its wait queue with a key describing what happened. Each driver decides when to wake. A pipe write wakes readers when the pipe was empty, or on every write once an edge-triggered poll has been seen on the pipe ✅[^pipesrc]; §6.3 has the history.
4. **Callback (kernel, `ep_poll_callback`):**
   - Drops the wakeup if its bits do not overlap the registered mask; a wakeup with no bits passes, because not every driver fills in the key ✅[^src].
   - If a harvest is running, puts the epitem on the overflow list; otherwise links it on the ready list **only if it is not already linked** ✅[^src]. That is why several writes before one `epoll_wait` produce one event ✅[^epoll7] ✅[^exp] (T3).
   - Wakes the instance's wait queue. Sleepers in `epoll_wait` are queued as *exclusive* waiters, meaning a wake-up stops after the first one it wakes, so one wakeup wakes one thread ✅[^src].
5. **App → kernel (`epoll_wait`, system call):** if the ready list is empty, the thread adds itself to the instance's wait queue as an exclusive waiter and sleeps ✅[^src].
6. **epoll (kernel, harvest in `ep_deliver_event`):** for each epitem taken from the ready list:
   - Unlinks it and **polls the file again** under the instance's mutex. If no requested bit is set now, it delivers nothing; the epitem stays off the list until the callback queues it again ✅[^src]. Data that was consumed before the harvest therefore produces no event ✅[^exp] (T5).
   - Copies the mask from *this* poll, plus the `data` value, to user space ✅[^src].
   - `EPOLLONESHOT`: reduces the mask to its private bits, so later callbacks see no requested event and ignore the item until `EPOLL_CTL_MOD` ✅[^src].
   - Else, **not** `EPOLLET`: links the epitem back on the ready list, so the next `epoll_wait` checks it again ✅[^src]. This is level-triggered mode.
   - Else (`EPOLLET`): does nothing. The epitem is off the list.
7. **epoll (kernel, end of the scan, `ep_done_scan`):** moves overflow-list items to the ready list, puts back items not delivered because `maxevents` was reached, and, if the ready list is still not empty and threads are sleeping, wakes one more ✅[^src].
8. **Kernel → app:** `epoll_wait` returns the number of events.

**The one-line difference.** In mainline `fs/eventpoll.c`, `EPOLLET` appears in two bit-mask macros and in exactly one branch, the re-queue test in step 6 ✅[^src]. Everything else that makes ET "feel" different follows from that branch, plus one side channel: the mask, including the `EPOLLET` bit, travels to the driver as the poll key (step 2), and the pipe driver reads it (§6.3) ✅[^pipesrc].

In this doc's own pseudo-code, the harvest of one item is:

```text
unlink(item)
ready = poll(item.file, key = item.mask) & item.mask
if ready == 0:          return            # stale wakeup: deliver nothing
copy_to_user(ready, item.data)
if item.mask has ONESHOT:  item.mask = only private bits      # disabled until MOD
elif item.mask lacks ET:   append(item, ready_list)           # level-triggered
# edge-triggered: nothing; only the next driver wakeup re-queues it
```

---

## 6. What exactly counts as an edge

### 6.1 The rule

The man page describes ET as delivering events "only when changes occur on the monitored file descriptor" ✅[^epoll7]. The source gives the precise rule. An `EPOLLET` registration appears in an `epoll_wait` result when **both** hold ✅[^src]:

1. **A trigger happened since the item was last delivered.** Either the watched file woke its wait queue with bits that overlap the mask (or with no bits), or `EPOLL_CTL_ADD` / `EPOLL_CTL_MOD` found the file already ready.
2. **The file is still ready at harvest time.** The re-poll returns at least one requested bit.

The reported mask is the re-poll's result, not the reason for the wakeup. A socket registered for `EPOLLIN | EPOLLOUT | EPOLLET` that receives one byte is reported as `IN|OUT`, although no "writable" edge happened ✅[^exp] (T14).

So an "edge" is not a transition from not-ready to ready. It is "the driver called its wait queue". When a driver calls it is driver policy, and it has changed between kernel versions (§6.3).

### 6.2 Consequences, case by case

| Situation | ET result | Why | Evidence |
|---|---|---|---|
| 2048 bytes arrive; the app reads 1024 and waits again | **No event**; 1024 bytes stranded | No new wakeup, and an ET item is not re-queued | T1 ✅[^exp]; the man page's pipe example ✅[^epoll7] |
| Same, level-triggered | Event on every call until drained | LT re-queue in step 6 | T1 ✅[^exp] |
| fd already readable when added | One event, then quiet | `ep_insert` polls immediately | T2 ✅[^exp] ✅[^src] |
| Three 1-byte writes, then one `epoll_wait` | One event; `read` returns 3 | The epitem is already linked, so later callbacks add nothing | T3 ✅[^exp]; "combined" ✅[^epoll7] |
| New data while old data is still unread | **New event** on a pipe, an `AF_UNIX` stream socket and TCP over loopback (Linux 7.2.12) | Each write woke the reader's wait queue | T4 ✅[^exp] |
| Data arrives and is fully read before `epoll_wait` | No event | The harvest re-poll finds nothing and drops the item | T5 ✅[^exp] ✅[^src] |
| `EPOLL_CTL_MOD` with the same mask while data is unread | One new event | `ep_modify` polls and queues a ready item | T6 ✅[^exp] ✅[^src] |
| `EPOLLET \| EPOLLONESHOT`, second write before re-arm | No event until `EPOLL_CTL_MOD` | The mask is disabled after delivery | T7 ✅[^exp] ✅[^ctl] |
| Pipe filled to `EAGAIN` (65536 bytes), reader takes 1 byte | No `EPOLLOUT` | A pipe is "full" by page-sized slots; the reader wakes writers only when a full pipe stops being full ✅[^pipesrc] | T8 ✅[^exp]; 65536 = 16 pages of 4096 ✅[^pipe7] |
| Same pipe, reader has taken 4096 bytes | One `EPOLLOUT` | A slot was freed | T8 ✅[^exp] |
| `AF_UNIX` socket filled to `EAGAIN` (196608 bytes), reader takes 4096 at a time | First `EPOLLOUT` only after 151552 bytes were read | The socket counts as writable when 4 × (memory charged for queued data) ≤ the send-buffer limit ✅[^unixsrc] | T8 ✅[^exp] |
| Peer writes 3 bytes, then `shutdown(SHUT_WR)` | One `IN\|RDHUP`; nothing after reading to end of file. LT keeps reporting `IN\|RDHUP` forever | Read shutdown makes the socket permanently "readable" ✅[^unixsrc] | T9 ✅[^exp] |

The `AF_UNIX` numbers, worked out: 196608 = 48 writes of 4096 bytes. After 151552 bytes (37 chunks) were read, 11 chunks (45056 bytes) were still queued. The send-buffer limit here is 229376 bytes (`net.core.wmem_default`), so writable means at most 229376 / 4 = 57344 bytes charged. With 12 chunks queued it was not writable, so each 4096-byte chunk is charged between 57344 / 12 ≈ 4779 and 57344 / 11 ≈ 5213 bytes, the payload plus bookkeeping. That reading assumes the socket's limit equals `wmem_default` ⚠️ unverified.

TCP: the observed new event per arriving write (T4) fits the socket waking its wait queue each time data is queued; that mechanism is not checked against `net/` source here ⚠️ unverified.

### 6.3 Proof that "edge" is driver policy: the pipe regression, 2019–2021

1. **2019-12-07, Linus Torvalds, commit `1b6b26ae7053`** "pipe: fix and clarify pipe write wakeup logic": a pipe write now wakes readers only if the pipe was empty before ✅[^kerrisk] ✅[^linus2020]. It ships in Linux 5.5 ✅[^kerrisk].
2. **2020-10-12, Michael Kerrisk (man-pages maintainer), LKML report:** an `EPOLLIN | EPOLLET` reader on a pipe; write 1 byte → ready; wait again → not ready; write a second byte → Linux 5.4 reports ready, 5.5 and later report **0 events**. Sockets and terminals still report it ✅[^kerrisk].
3. **2020-10-12, Linus's reply:** readiness did not change between the two writes, so there is no edge and the test is wrong; it becomes a regression only if real programs depend on the old behaviour ✅[^linus2020].
4. **Before the fix:** Android moves to Linux 5.10 and apps using the realm-core library stop working. realm-core expected an ET event on every write, using a pipe it does not drain until it fills ✅[^c3a34].
5. **2021-07-30, commit `3a34b13a88ca`** "pipe: make pipe writes always wake up readers": every write wakes readers again. Kernel policy treats breaking real applications as a regression even when they relied on behaviour they should not have ✅[^c3a34].
6. **Commit `3b844826b6c6`, posted to the 5.13 stable series on 2021-08-24,** "pipe: avoid unnecessary EPOLLET wakeups under normal loads": the extra wakeups slowed the hackbench benchmark (sensitive to extra pipe wakeups, per the commit) on large machines, so they are limited to pipes that have been polled (a `poll_usage` flag) ✅[^c3b84].
7. **Mainline, read 2026-11-22:** the flag is named `pseudo_edgetrigger` and is set only when a read-side poll carries `EPOLLET` in its key. io_uring multishot polls set `EPOLLET` and get the same behaviour ✅[^pipesrc].
8. **2026-11-22, lab, Linux 7.2.12:** a second write to a pipe with unread data gives a new ET event ✅[^exp] (T4).

**Lessons:**
- Code must not rely on extra edges. Drain until `EAGAIN`, and a missing "per-write" event cannot hurt you ✅[^epoll7].
- Code must tolerate extra edges, because a driver may wake more often than the state changes. mio's documentation warns that readiness events can be spurious ✅[^miodocs].

---

## 7. Worked example: a correct ET loop, one full pass

### 7.1 Code (this doc's own sketch)

```c
/* fd: O_NONBLOCK, registered once with EPOLLIN | EPOLLOUT | EPOLLRDHUP | EPOLLET */

void on_readable(conn *c) {
    for (int budget = 64; budget > 0; budget--) {     /* fairness cap, see §12 */
        ssize_t n = read(c->fd, buf, sizeof buf);
        if (n > 0) { consume(c, buf, n); continue; }  /* there may be more */
        if (n == 0) { conn_close(c); return; }        /* peer finished: end of file */
        if (errno == EINTR) continue;                 /* interrupted by a signal: retry */
        if (errno == EAGAIN) return;                  /* drained: the next wakeup brings an event */
        conn_close(c); return;                        /* real error */
    }
    push_on_app_ready_list(c);   /* budget used up: still readable, come back without waiting */
}

void flush_output(conn *c) {   /* call when there is output, and on every EPOLLOUT event */
    while (c->out_len > 0) {
        ssize_t n = write(c->fd, c->out, c->out_len);
        if (n > 0) { advance(c, n); continue; }
        if (n < 0 && errno == EINTR) continue;
        if (n < 0 && errno == EAGAIN) return;   /* buffer full: an EPOLLOUT event comes when space frees */
        conn_close(c); return;
    }
}

void conn_close(conn *c) {
    epoll_ctl(epfd, EPOLL_CTL_DEL, c->fd, NULL);   /* before close(): see §8 and §12 */
    close(c->fd);
}
```

Why each piece is there:
- **Nonblocking fd:** ET requires reading until `EAGAIN`, and a blocking `read` at that point would sleep forever and stall every other fd on the thread ✅[^epoll7].
- **Loop until `EAGAIN`:** "You must consider it ready until the next (nonblocking) read/write yields EAGAIN." ✅[^epoll7]
- **Shortcut for stream fds:** for pipes and stream sockets, a `read` that returns fewer bytes than asked also means the buffer is drained, but datagram sockets and terminals in canonical mode need the full loop until `EAGAIN` ✅[^epoll7].
- **Budget plus an application-level ready list:** draining a very busy fd can starve the others; the man page suggests keeping your own ready list ✅[^epoll7].
- **Registering `EPOLLOUT` once, permanently:** with ET a writable socket does not spam events, so there is no need to add and remove `EPOLLOUT` with `EPOLL_CTL_MOD`. The Go runtime registers both directions once and never calls `EPOLL_CTL_MOD` ✅[^go].

### 7.2 Timeline of one pass (pipe, numbers from lab test T1)

| # | Who, via what | What happens | State after |
|---|---|---|---|
| 1 | App → kernel, `epoll_ctl(ADD, rfd, EPOLLIN\|EPOLLET)` | Registration; the pipe is empty, so nothing is queued | epitem in tree, not on ready list |
| 2 | Writer → kernel, `write(2048)` | Pipe was empty → wake readers → `ep_poll_callback` links the epitem and wakes a sleeper | epitem on ready list |
| 3 | App → kernel, `epoll_wait` | Harvest: re-poll says `IN`; event `{IN, data=1}` delivered; ET, so not re-queued | ready list empty |
| 4a | **Buggy app:** `read(1024)` → 1024, back to `epoll_wait` | No wakeup since step 3 → **0 events** ✅[^exp]. 1024 bytes wait until the writer writes again | stalled |
| 4b | **Correct app:** `read` → 1024, `read` → 1024, `read` → `-1 EAGAIN` ✅[^exp] | Drained; return to `epoll_wait` | nothing pending, nothing lost |
| 5 | Writer → kernel, `write(...)` again | Wakeup → callback → new event | back to step 3 |

---

## 8. Cross-actor interactions

What a change made by one actor does to the others:

| Change, by whom | Effect on the epoll instance | Effect on the application and other threads |
|---|---|---|
| App reads only part of the data (ET) | Nothing: the epitem stays off the ready list | No further event until the peer sends more: the connection looks hung ✅[^exp] |
| App calls `EPOLL_CTL_MOD` while data is unread | `ep_modify` re-polls and queues the item ✅[^src] | One fresh event: a way to "re-arm" without reading ✅[^exp] |
| Peer writes more while data is unread | Driver wakes its queue → callback queues the item (on these drivers, this kernel) | New event ✅[^exp]; on pipes in Linux 5.5 up to the 2021 fix, no event ✅[^kerrisk] |
| Peer shuts down writing | The driver reports `IN\|RDHUP` from then on ✅[^unixsrc] | ET: reported once; the app must remember it. LT: reported on every call ✅[^exp] |
| A second thread blocks in `epoll_wait` on the same instance | Added as an exclusive waiter ✅[^src] | ET: one thread wakes per trigger. LT: the re-queued item makes the scan end with a non-empty list, which wakes the next thread, and so on (4 of 4 woke) ✅[^exp] ✅[^src] |
| Another epoll instance watches the same file | Each instance hooks its own callback on the file's wait queue ✅[^src] | All instances wake (4 of 4), unless all used `EPOLLEXCLUSIVE` (1 of 4 woke) ✅[^exp] |
| App closes an fd that has a `dup` elsewhere | The registration lives on: it belongs to the open file description, which is still open ✅[^epoll7] | Events still arrive with the old `data`; `EPOLL_CTL_DEL` on the closed number fails with `EBADF`, and on the duplicate with `ENOENT` ✅[^exp] |
| Kernel upgrade changes a driver's wake policy | Different trigger frequency | Code that relies on per-write edges can break (§6.3) ✅[^c3a34] |

The `ENOENT` case is not a dead end: `dup2(B, A)` recreates fd number A on the same description, and `EPOLL_CTL_DEL` on A then succeeds ✅[^exp] (T13). Marek Majkowski describes the general problem, and recommends `EPOLL_CTL_DEL` before every `close` ✅[^majek2].

---

## 9. Multiple threads and multiple epoll instances

| Setup | ET behaviour | Risk | Remedy |
|---|---|---|---|
| One epoll instance per thread, each fd owned by one thread | One wakeup, one handler | None specific to ET | — |
| N threads in `epoll_wait` on **one** instance | One thread wakes per trigger ✅[^epoll7] ✅[^exp] | Two consecutive triggers on the same socket can go to two different threads, which then read it at the same time and can reorder the data ✅[^majek1] | `EPOLLET \| EPOLLONESHOT`; the handling thread re-arms with `EPOLL_CTL_MOD` when done ✅[^majek1] ✅[^epoll7] |
| N instances (often one per worker process) watching one listening socket | Every instance wakes (shown with a pipe in T11) ✅[^exp] | Thundering herd on `accept` | `EPOLLEXCLUSIVE` (Linux 4.5+) ✅[^ctl] ✅[^exp], or one listening socket per worker with `SO_REUSEPORT`, a socket option that lets several sockets listen on one port ✅[^majek1] |
| N threads accepting from one shared listening socket with ET | One thread wakes | That thread may keep draining the accept queue while the others idle, so the load is not spread ✅[^majek1] | One epoll instance per thread, level-triggered with `EPOLLEXCLUSIVE`, which Majkowski calls the only scalable option for this case ✅[^majek1] |

`EPOLLONESHOT` exists because even in ET mode several chunks of data can produce several events ✅[^epoll7]. It costs one extra system call per event, the re-arm ✅[^majek1].

---

## 10. Choosing a mode

| Mode | Reports | Must drain to `EAGAIN`? | Threads sharing one instance | Extra system calls | Fits |
|---|---|---|---|---|---|
| Level-triggered (default) | Every call while ready | No; partial reads are safe | All waiters can wake (thundering herd) ✅[^exp] | `EPOLL_CTL_MOD` to stop write interest when nothing is pending ⚠️ unverified (general practice) | Simple loops, code ported from `poll` |
| `EPOLLET` | Once per driver wakeup | Yes ✅[^epoll7] | One wakes per trigger ✅[^epoll7] | None to manage write interest ✅[^go] | Single-threaded loops or one loop per thread; runtimes that retry syscalls themselves |
| `EPOLLET \| EPOLLONESHOT` | Once, then disabled | Yes | One owner per event ✅[^majek1] | One `EPOLL_CTL_MOD` per event ✅[^majek1] | Thread pools sharing one instance |
| `EPOLLEXCLUSIVE` (with or without ET) | Wakes one or more of several instances ✅[^ctl] | Depends on ET | Applies across instances, not threads of one instance | None | Several workers watching one listening socket |

ET does not make one `read` faster. It saves `epoll_wait` returns and `epoll_ctl` calls by not re-reporting fds the application already knows about; how much that saves depends on the workload and is not measured here ⚠️ unverified.

**Portability:** the closest BSD analogue is kqueue's `EV_CLEAR`, which resets an event's state after it is retrieved, and `EV_DISPATCH` disables the event source after delivery, much like `EPOLLONESHOT` ✅[^kqueue]. The mapping is this doc's comparison, not a documented equivalence.

---

## 11. How real event loops use `EPOLLET`

| Project | Registration | What it shows |
|---|---|---|
| Go runtime (`runtime/netpoll_epoll.go`) | `EPOLLIN \| EPOLLOUT \| EPOLLRDHUP \| EPOLLET`, once, with `EPOLL_CTL_ADD`; no `EPOLL_CTL_MOD` ✅[^go] | One permanent registration per fd; `EPOLLRDHUP`, `EPOLLHUP` and `EPOLLERR` wake readers, `EPOLLHUP` and `EPOLLERR` also wake writers ✅[^go] |
| mio, under Tokio (`src/sys/unix/selector/epoll.rs`) | Every mask starts as `EPOLLET`; `EPOLLIN \| EPOLLRDHUP`, `EPOLLOUT` and `EPOLLPRI` are added for the interests the caller registers ✅[^mio] | Its docs require repeating the operation until `WouldBlock` (Rust's name for `EAGAIN`) and warn of spurious events ✅[^miodocs] |
| nginx (`ngx_epoll_module.c`) | Client connections: `EPOLLIN \| EPOLLOUT \| EPOLLET \| EPOLLRDHUP` ✅[^nginx] | Sets `NGX_USE_CLEAR_EVENT` when built with "clear" (edge) event support ✅[^nginx]; the name follows kqueue's `EV_CLEAR` ⚠️ unverified |
| io_uring multishot poll | Sets `EPOLLET` on its internal poll ✅[^pipesrc] | ET semantics reach beyond epoll: pipes treat it the same way ✅[^pipesrc] |

The common pattern, as this doc reads these sources: register once, always try the system call first, and wait for an event only after `EAGAIN`.

---

## 12. Edge-case and failure matrix

| Symptom | Cause | Fix | Evidence |
|---|---|---|---|
| Connection hangs with bytes in its receive buffer | One `read` per event in ET mode | Read until `EAGAIN` (or a short read on a stream fd) | T1 ✅[^exp]; ✅[^epoll7] |
| A thread blocks inside `read` and every other fd on it stalls | Blocking fd in an ET drain loop | `O_NONBLOCK` on every ET fd | ✅[^epoll7] |
| One busy client starves the others | Draining one fd without limit | A per-fd budget plus an application ready list | ✅[^epoll7] |
| Writer stops after `EAGAIN` and never resumes | Waiting for `EPOLLOUT` that was never registered, or a write that is never retried on `EPOLLOUT` | Register `EPOLLOUT` with ET once; retry pending output on every `EPOLLOUT` event | T8 ✅[^exp]; ✅[^go] |
| `EPOLLOUT` arrives late, long after the reader started consuming | The driver wakes writers only past a threshold (a freed pipe page; a quarter of the socket send buffer) | Expected; size the output buffer for it | T8 ✅[^exp]; ✅[^pipesrc] ✅[^unixsrc] |
| A pipe-based wakeup stops working after a kernel upgrade | Code relied on one ET event per write on a pipe it does not drain | Drain the pipe, or use a counter fd such as `eventfd` ⚠️ unverified (eventfd semantics not checked here) | ✅[^kerrisk] ✅[^c3a34] |
| Events arrive for an fd the app already closed | A `dup` or `fork` keeps the open file description alive | `EPOLL_CTL_DEL` before `close`; to recover, `dup2` the duplicate onto the old number, then delete | T13 ✅[^exp]; ✅[^epoll7] ✅[^majek2] |
| An event cache acts on an fd closed earlier in the same batch | The handler for one event closed another fd whose event is later in the same returned batch | Mark the connection as removed and skip its remaining events | ✅[^epoll7] |
| Two threads process the same socket at once | ET wakes different threads on consecutive triggers | `EPOLLONESHOT` and re-arm | ✅[^majek1] |
| Hang-up handled once, then forgotten | ET reports `RDHUP` once | Keep connection state; read until `read() == 0` | T9 ✅[^exp] |
| Datagrams left unread on a UDP (User Datagram Protocol) socket in ET mode | "Short read means drained" assumed on a datagram fd, where each `read` returns one datagram | Loop until `EAGAIN` | ✅[^epoll7] |
| More ready fds than `maxevents` | Normal | Nothing is lost: undelivered items stay queued and later calls round-robin | T12 ✅[^exp]; ✅[^wait] |
| `EPOLLOUT` reported with every `EPOLLIN` | One registration for both directions; the mask comes from the harvest re-poll | Treat each bit as "may proceed", not as "something changed" | T14 ✅[^exp]; ✅[^src] |
| `WouldBlock`/`EAGAIN` right after an event | Spurious or already-consumed readiness | Not an error: wait for the next event | ✅[^miodocs] |
| `EPOLL_CTL_MOD` fails with `EINVAL` | The fd was added with `EPOLLEXCLUSIVE` | Delete and re-add instead of modifying | ✅[^ctl] |

---

## 13. Lab experiments

**What:** one C program, 14 tests, each printing what `epoll_wait` returned after each step (timeout 0, except 400 ms for the waiting threads in T10 and T11).
**How:** `experiments/run.sh` compiles `experiments/et_lab.c` with gcc 13.2.1 inside a local Alpine 3.20.10 container (no network) and runs it. Output is in `experiments/results.txt`.
**Where and when:** Linux 7.2.12 (OrbStack virtual machine, aarch64, page size 4096), 2026-11-22. T4, T8, T10 and T11 gave identical lines in four further runs.

| Test | Question | ET result | LT result, where run |
|---|---|---|---|
| T1 | Pipe: 2048 bytes in, read 1024, wait again | 0 events, twice | 1 event on each call |
| T2 | Pipe already holds data when added | 1 event, then 0 | — |
| T3 | Three 1-byte writes, one wait | 1 event; `read` returns 3 | — |
| T4 | Second write while the first byte is unread (pipe, `AF_UNIX`, TCP loopback) | 1 new event on all three | — |
| T5 | Data fully read before the wait | 0 events | — |
| T6 | `EPOLL_CTL_MOD` with the same mask, data unread | 1 event, then 0 | — |
| T7 | `EPOLLONESHOT`: second write before re-arm; then re-arm | 0 events; 1 after `EPOLL_CTL_MOD` | — |
| T8 | `EPOLLOUT` after `EAGAIN`: pipe (65536 bytes written) and `AF_UNIX` (196608 bytes written) | Pipe: no event after 1 byte read, event after 4096; socket: first event after 151552 bytes read | — |
| T9 | Peer writes 3 bytes and shuts down writing | `IN\|RDHUP` once; 0 after end of file | `IN\|RDHUP` on every call, also after end of file |
| T10 | 4 threads in `epoll_wait` on one instance, one write, no reads | 1 of 4 threads returned with the event | 4 of 4 |
| T11 | 4 instances watching one pipe, one write | 4 of 4 without `EPOLLEXCLUSIVE`; 1 of 4 with it | — |
| T12 | 3 ready pipes, `maxevents = 1`, 4 calls | data 10, 11, 12, then 0 events | — |
| T13 | Register A, `dup` to B, close A, write | Event with A's data; `DEL` A → `EBADF`; `DEL` B → `ENOENT`; `dup2(B, A)` then `DEL` A → ok; next write → 0 events | — |
| T14 | `AF_UNIX` registered `IN\|OUT\|RDHUP\|ET`; peer writes 1 byte | `OUT` at add, then 0, then `IN\|OUT` | — |

**Limits:** OrbStack ships its own kernel build; behaviour that depends on driver wake policy (T4 on pipes, T8 thresholds) can differ on other versions, as §6.3 shows. No test covers datagram sockets, terminals, `eventfd` or `timerfd`.

---

## 14. Verification

- **Checked against primary sources on 2026-11-22:** the man pages (epoll(7), epoll_ctl(2), epoll_wait(2), pipe(7), all man-pages 6.19), mainline `fs/eventpoll.c`, `fs/pipe.c` and `net/unix/af_unix.c`, the LKML thread and the two pipe commits, the Go, mio and nginx sources, mio's docs, FreeBSD's kqueue(2) and Majkowski's two articles.
- **Checked by experiment:** every row marked with the lab footnote, on one kernel (7.2.12).
- **This doc's synthesis, not a sourced claim:** the two-condition rule in §6.1 (read from the source, not stated anywhere as such); the pseudo-code in §5.2 and the C sketch in §7.1; the "choosing" table in §10; the kqueue mapping.
- **Unverified:** marked inline; they are the TCP wake mechanism, the `AF_UNIX` send-buffer assumption, the LT write-interest practice, the performance claim in §10, the nginx naming origin and the `eventfd` alternative.
- **Refines** `linux/networking/io-multiplexing-epoll-io-uring.md`: its edge-case row "several threads woken for one event" holds for level-triggered registrations; with `EPOLLET`, one thread wakes per trigger (T10) ✅[^epoll7] ✅[^exp].
- **Counts on 2026-11-22:** 185 verified marks (about 162 claims, since some claims carry two sources) and 7 unverified marks.
- **Status `draft`:** unverified claims remain, and the doc has not been through the `review-knowledge-doc` skill.

## References

- [epoll(7)](https://man7.org/linux/man-pages/man7/epoll.7.html) — Linux man-pages project (man-pages 6.19), living; read 2026-11-22. Backs: §1 history and LT/ET definitions; §2 interest and ready lists; §3 key and per-watch cost; §6 the pipe example and "combined" events; §7 drain rule, stream vs. datagram, starvation; §8 and §12 closed fds and event caches; §9 one thread woken, `EPOLLONESHOT` rationale. [^epoll7]
- [epoll_ctl(2)](https://man7.org/linux/man-pages/man2/epoll_ctl.2.html) — Linux man-pages project (man-pages 6.19), living; read 2026-11-22. Backs: §4 flag table (defaults, versions, `EPOLLEXCLUSIVE` and `EPOLLWAKEUP` rules); §9; §12 `EINVAL` on MOD. [^ctl]
- [epoll_wait(2)](https://man7.org/linux/man-pages/man2/epoll_wait.2.html) — Linux man-pages project (man-pages 6.19), living; read 2026-11-22. Backs: §4 `maxevents` round-robin, timeout and `data` semantics; §12. [^wait]
- [pipe(7)](https://man7.org/linux/man-pages/man7/pipe.7.html) — Linux man-pages project (man-pages 6.19), living; read 2026-11-22. Backs: §6.2 pipe capacity of 16 pages. [^pipe7]
- [Linux `fs/eventpoll.c`, mainline](https://raw.githubusercontent.com/torvalds/linux/master/fs/eventpoll.c) — Linux kernel (Davide Libenzi and others), living; read 2026-11-22. Backs: §2 and §3 data structures; §4 mask filtering; §5 every kernel step (insert, callback, exclusive waiters, harvest re-poll, ONESHOT, LT re-queue, end-of-scan wakeup, the only `EPOLLET` branch); §6.1; §8. [^src]
- [Linux `fs/pipe.c`, mainline](https://raw.githubusercontent.com/torvalds/linux/master/fs/pipe.c) — Linux kernel, living; read 2026-11-22. Backs: §2 pipe wait queues; §5 step 3; §6.2 writer wakeup rule; §6.3 step 7 `pseudo_edgetrigger` and io_uring; §11. [^pipesrc]
- [Linux `net/unix/af_unix.c`, mainline](https://raw.githubusercontent.com/torvalds/linux/master/net/unix/af_unix.c) — Linux kernel, living; read 2026-11-22. Backs: §6.2 `unix_writable` quarter rule and read-shutdown poll bits; §8. [^unixsrc]
- [Regression: epoll edge-triggered (EPOLLET) for pipes/FIFOs](https://lkml.iu.edu/hypermail/linux/kernel/2010.1/04363.html) — Michael Kerrisk, LKML, 2020-10-12. Backs: §6.3 steps 1–2; §8; §12. [^kerrisk]
- [Re: Regression: epoll edge-triggered (EPOLLET) for pipes/FIFOs](https://lkml.iu.edu/hypermail/linux/kernel/2010.1/04469.html) — Linus Torvalds, LKML, 2020-10-12. Backs: §6.3 steps 1 and 3. [^linus2020]
- [pipe: make pipe writes always wake up readers (3a34b13a88ca)](https://android-kvm.googlesource.com/linux/+/3a34b13a88caeb2800ab44a4918f230041b37dd9) — Linus Torvalds, 2021-07-30 (Android KVM mirror of the kernel tree). Backs: §6.3 steps 4–5; §8; §12. [^c3a34]
- [pipe: avoid unnecessary EPOLLET wakeups under normal loads (3b844826b6c6)](https://lkml.iu.edu/2108.3/00913.html) — Linus Torvalds, posted to the 5.13 stable series 2021-08-24. Backs: §6.3 step 6. [^c3b84]
- [Go `runtime/netpoll_epoll.go`](https://raw.githubusercontent.com/golang/go/master/src/runtime/netpoll_epoll.go) — The Go Authors, living; read 2026-11-22. Backs: §1; §7.1; §10; §11. [^go]
- [mio `src/sys/unix/selector/epoll.rs`](https://raw.githubusercontent.com/tokio-rs/mio/master/src/sys/unix/selector/epoll.rs) — Tokio project, living; read 2026-11-22. Backs: §1; §11. [^mio]
- [mio `Poll` documentation](https://docs.rs/mio/latest/mio/struct.Poll.html) — Tokio project (mio 1.2.5), living; read 2026-11-22. Backs: §6.3 lessons; §11; §12 spurious events. [^miodocs]
- [nginx `src/event/modules/ngx_epoll_module.c`](https://raw.githubusercontent.com/nginx/nginx/master/src/event/modules/ngx_epoll_module.c) — nginx project, living; read 2026-11-22. Backs: §1; §11. [^nginx]
- [Epoll is fundamentally broken 1/2](https://idea.popcount.org/2017-02-20-epoll-is-fundamentally-broken-12/) — Marek Majkowski, 2017. Backs: §9 multi-thread races, accept balancing, `EPOLLEXCLUSIVE`, `SO_REUSEPORT`, ONESHOT cost; §12. [^majek1]
- [Epoll is fundamentally broken 2/2](https://idea.popcount.org/2017-03-20-epoll-is-fundamentally-broken-22/) — Marek Majkowski, 2017. Backs: §8 and §12 registrations outliving `close`. [^majek2]
- [kqueue(2)](https://man.freebsd.org/cgi/man.cgi?query=kqueue&sektion=2) — FreeBSD Project (FreeBSD 15.1), living; read 2026-11-22. Backs: §10 `EV_CLEAR`, `EV_DISPATCH`. [^kqueue]
- `research/_golden/SE-04/baseline/experiments/et_lab.c`, `run.sh`, `results.txt` — the 14 lab tests of §13, their runner and the captured output (Linux 7.2.12, 2026-11-22). [^exp]
- `knowledge/linux/lab-setup.md` — how the `linlab:1` Alpine image used by `run.sh` is built.

## Related

- `linux/networking/io-multiplexing-epoll-io-uring.md` — the short concept doc: epoll vs. `poll`, threads and io_uring; this dive goes deeper into its `EPOLLET` rows.
- `linux/processes/ipc-pipes-sockets-shm.md` — the pipes and `AF_UNIX` sockets watched in the experiments.
- `linux/storage/vfs-and-file-descriptors.md` — file descriptors vs. open file descriptions, behind §8's `dup`/`close` case.
- `concurrency/blocking-in-async-runtimes.md` — why blocking calls inside an event loop stall every connection on it.
- `linux/lab-setup.md` — the container lab the experiments ran in.
