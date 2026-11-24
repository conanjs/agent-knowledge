---
schema: knowledge-doc/v1
type: concept
topic: go/standard-library
status: verified
applies-to: ["Go 1.27 (go1.27.4)", "net/netip: Go ≥ 1.18", "KeepAliveConfig: Go ≥ 1.23", "Dialer.DialTCP/DialUDP: Go ≥ 1.26", "lab: Linux loopback (golang:1.27.4, --network none)"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [go, golang, net, tcp, udp, net-conn, listener, dialer, deadlines, setdeadline, i-o-timeout, keepalive, closewrite, netip, joinhostport, ipv6, dns-resolver, netdns, godebug]
ranked-sources: true
---

# TCP, UDP and deadlines with package net

## Summary
**TL;DR:** A Go network server is `net.Listen`, an `Accept` loop and `go handle(conn)`: each connection gets a goroutine that makes plain blocking `Read` and `Write` calls, and a waiting goroutine does not hold an operating-system thread (2,000 idle connections ran on 10–11 threads in the lab). A `net.Conn` is an `io.Reader` and an `io.Writer`. Timeouts are *deadlines*: absolute times set with `SetDeadline`, `SetReadDeadline` or `SetWriteDeadline` that apply to every pending and later call until you move them; an expired one returns `i/o timeout`, an error that matches `os.ErrDeadlineExceeded` and whose `Timeout()` is true. TCP (Transmission Control Protocol) is a byte stream, so two writes can arrive as one read; UDP (User Datagram Protocol) keeps each datagram whole. Build addresses with `net.JoinHostPort`, so IPv6 (Internet Protocol version 6) literals get their brackets.
**Use this when:** you write a TCP or UDP server or client, add timeouts or keep-alive to raw connections, read `i/o timeout` or `use of closed network connection`, handle IPv6 addresses, choose between `net.IP` and `netip.Addr`, or need to know which DNS (Domain Name System) resolver a binary uses.
**Not this doc:** HTTP servers and clients → `go/standard-library/net-http.md`; how the runtime parks a goroutine on a socket → `go/runtime/scheduler-and-goroutine-stacks.md`; TCP states, the accept queue and `TIME-WAIT` → `linux/networking/tcp-connection-lifecycle.md`; epoll → `linux/networking/io-multiplexing-epoll-io-uring.md`; `context` itself → `go/concurrency/context-and-cancellation.md`.

## Problem
Raw connections fail in ways a quick test does not show. A peer that connects and then says nothing holds a server goroutine forever unless a deadline is set. A deadline set once is not a per-call timeout: after it passes, every later read fails at once until it is moved ✅[^1]. A reader that expects one `Read` per `Write` breaks when TCP delivers two messages in one read ✅[^1]. `fmt.Sprintf("%s:%s", host, port)` turns `::1` into `::1:8080`, which `Dial` rejects with `too many colons in address` ✅[^1]. And timeout errors are wrapped in layers, so checking for one sentinel error can miss them ✅[^1].

## Mental model
**Analogy:** a deadline is an alarm clock set to a time of day, not a kitchen timer started for each call. Set it to ring at 10:00:00.250: every read still waiting then is woken with "time's up", and every read started later fails at once, until you set a new time or switch the alarm off with the zero `time.Time`. An idle timeout is moving the alarm forward each time a message arrives. TCP is a water pipe: the bytes keep their order but have no edges. UDP is a stack of postcards: each one arrives whole, and a card too big for the slot loses its end.

**Artifact:** the lab's echo server, one goroutine per connection, with the client half-closing its side ✅[^1]:
```go
ln, err := net.Listen("tcp", "127.0.0.1:0") // port 0: the kernel picks a free port
go func() {
	for {
		c, err := ln.Accept()
		if err != nil {
			return // after ln.Close(): errors.Is(err, net.ErrClosed)
		}
		go func(c net.Conn) { defer c.Close(); io.Copy(c, c) }(c) // echo until end of file
	}
}()

c, _ := net.Dial("tcp", ln.Addr().String())
fmt.Fprintf(c, "hello\nworld\n")
c.(*net.TCPConn).CloseWrite() // FIN: "I will send nothing more"; reading still works
echo, err := io.ReadAll(c)    // "hello\nworld\n" <nil>
```

## How it works
**5 actors:**
- **Server code** — its job: accept connections and serve each one, via `Listener.Accept` and one goroutine per `net.Conn`.
- **Client code** — its job: open connections, via `net.Dial` or a `net.Dialer`.
- **Package `net`** — its job: turn those calls into socket system calls and enforce deadlines, via the methods of `Listener`, `Conn` and `PacketConn`.
- **Go runtime (network poller)** — its job: park a goroutine whose socket is not ready and wake it when it is, via the kernel's readiness interface (epoll on Linux).
- **Kernel network stack** — its job: run TCP and UDP, via the sockets (here on loopback, so nothing leaves the machine).

```
client goroutine          kernel (loopback)                 server goroutines                 runtime poller
────────────────          ─────────────────                 ─────────────────                 ──────────────
                                                         net.Listen ─► socket, bind, listen
                                                         Accept(): nothing queued ───────────► park G0
Dial(addr) ─► handshake SYN, SYN+ACK, ACK ─► accept queue ──────────────────────────────────► wake G0
                                                         Accept() returns conn
                                                         go handle(conn): G1 Read(), no data ─► park G1
Write("hello") ─► bytes ────────────────────────────────────────────────────────────────────► wake G1
                                                         G1: Read returns 5 bytes, Write echo
                          (read deadline passes) ───────────────────────────────────────────► wake G1: i/o timeout
CloseWrite() ─► FIN ──────────────────────────────────►  G1: Read returns io.EOF, Close() ─► FIN
```

1. **Server code → kernel: listen.** `net.Listen("tcp", addr)` takes `tcp`, `tcp4`, `tcp6`, `unix` or `unixpacket`; an empty or unspecified host listens on all local addresses, and port `0` lets the system choose a port, which `Listener.Addr` reports ✅[^2]. Lab: `127.0.0.1:0` became `127.0.0.1:45989` ✅[^1].
2. **Server code: the accept loop.**
   - `Accept` waits for the next connection, and closing the listener unblocks a waiting `Accept` with an error ✅[^2]. Lab: `accept tcp 127.0.0.1:45989: use of closed network connection` ✅[^1]; the documented test for it is `errors.Is(err, net.ErrClosed)` ✅[^2], which returned true ✅[^1].
   - The package's own example runs `go handleConnection(conn)` for each connection ✅[^2].
3. **Runtime: a blocked call holds a goroutine, not a thread.**
   - How the poller parks and wakes goroutines is step 4 of `go/runtime/scheduler-and-goroutine-stacks.md`.
   - Lab: with 2,000 open connections and a server goroutine blocked in `Read` on each, the process had 2,002 goroutines and 10–11 threads (`Threads:` in `/proc/self/status`, `GOMAXPROCS=8`, 3 runs) ✅[^1].
   - The `net` docs give the same reason for preferring the pure Go DNS resolver: a blocked DNS request costs a goroutine, a blocked C call costs a thread ✅[^2].
4. **Your code: read and write.** `net.Conn` has `Read(b []byte) (n int, err error)` and `Write` with the same shape, so it works with `io.Copy`, `bufio` and the rest of `io` (contracts in `go/standard-library/io-and-encoding-json.md`). Several goroutines may call one `Conn`'s methods at the same time ✅[^2].
5. **Client code → kernel: dial.** `Dial(network, address)` takes `host:port`, where the host is an IP literal or a name to resolve and the port a number or a service name; when a name resolves to several addresses, TCP tries each in turn until one succeeds ✅[^2].
6. **Either side: close.**
   - `Close` unblocks any blocked `Read` or `Write`, which then return errors ✅[^2]. Lab: a `Read` blocked in another goroutine returned `use of closed network connection` when `Close` ran 100 ms later ✅[^1].
   - `TCPConn.CloseWrite` shuts down only the writing side (the kernel sends a FIN, TCP's "no more data" flag), and most callers should just use `Close` ✅[^2]. It is like putting down the microphone but keeping the earphones on: the peer learns you are done talking and can still answer. Lab: after `CloseWrite`, the server's `io.Copy` saw end of file, finished the echo and closed, and the client's `io.ReadAll` returned `"hello\nworld\n"` with a nil error ✅[^1]. The TCP states behind this half-close are in `linux/networking/tcp-connection-lifecycle.md`.

### Deadlines
- `SetDeadline(t)` sets both the read and the write deadline. A deadline is an absolute time after which input/output (I/O) fails instead of blocking, and it applies to all future and pending I/O, not only the next call ✅[^2].
- Past it, calls return an error that wraps `os.ErrDeadlineExceeded` (test with `errors.Is`) and whose `Timeout()` is true; other errors can report `Timeout()` true too ✅[^2] ✅[^4]. The error text is `i/o timeout` ✅[^4].
- Setting a later deadline makes the connection usable again; the zero `time.Time` means no timeout ✅[^2]. Extending the deadline after each successful read or write gives an idle timeout ✅[^2].
- A write that times out may still return `n > 0` ✅[^2]. Lab: writing 1 MiB (mebibyte) chunks to a peer that never read, the last `Write` returned `n=514048` with `i/o timeout` at the 200 ms deadline, after 2,611,200 bytes in total ✅[^1].
- `net.Error` is `error` plus `Timeout() bool`; its `Temporary()` method is deprecated ✅[^2].

Lab, read side (Go 1.27.4, 3 runs) ✅[^1]:
```text
silent peer, 100 ms read deadline    read tcp 127.0.0.1:52688->127.0.0.1:37249: i/o timeout   (after 100–130 ms)
                                     errors.Is(err, os.ErrDeadlineExceeded)=true  net.Error.Timeout()=true
second Read, no new deadline         same error after 0s
SetReadDeadline(now + 1 s), peer     "hi" <nil>
  writes "hi"
Read blocked in one goroutine,       i/o timeout returned 100 ms after the Read began, as soon as
  SetReadDeadline(time.Now()) from     the deadline moved
  another
```

**`Read` takes no context.** To stop a `Read` when a context ends, the `context` docs register `context.AfterFunc(ctx, func() { conn.SetReadDeadline(time.Now()) })`; if that function ran, the helper clears the deadline and returns `ctx.Err()` ✅[^5]. Lab: with a 50 ms context the helper returned `context deadline exceeded` after 50 ms, and the same connection then read `"later"` normally ✅[^1].

### Dialing with `net.Dialer`
- The zero `Dialer` behaves like `net.Dial`, and its methods are safe to call concurrently ✅[^2].
- `Timeout` caps the wait for a connection. The default is none, though the operating system may impose its own, often about 3 minutes; for a name with several addresses the time may be divided between them. `Deadline` is the absolute form ✅[^2].
- `DialContext(ctx, ...)` fails if the context ends before the connection is made; once connected, the context no longer affects the connection ✅[^2].
- Keep-alive probes are small packets on an idle connection that detect a dead peer. `KeepAlive` zero sends them at a default interval (currently 15 seconds), and a negative value turns them off ✅[^2]. `KeepAliveConfig` (Go 1.23) sets `Idle`, `Interval` and `Count` separately, with defaults 15 s, 15 s and 9, and `KeepAlive` is ignored when `KeepAliveConfig.Enable` is true ✅[^2] ✅[^6].
- Go 1.26 added `Dialer.DialTCP`, `DialUDP`, `DialIP` and `DialUnix`, which dial one network type with a context ✅[^7].

Lab: the kernel's keep-alive options, read back with `getsockopt` after each dial (this container's own defaults are 7200 s, 75 s and 9) ✅[^1]:

| Dialer | `SO_KEEPALIVE` | `TCP_KEEPIDLE` | `TCP_KEEPINTVL` | `TCP_KEEPCNT` |
|---|---|---|---|---|
| zero value | 1 | 15 s | 15 s | 9 |
| `KeepAlive: 30 * time.Second` | 1 | 30 s | 15 s | 9 |
| `KeepAlive: -1` | 0 | 7200 s | 75 s | 9 |
| `KeepAliveConfig{Enable: true, Idle: 60s, Interval: 10s, Count: 3}` | 1 | 60 s | 10 s | 3 |

Lab, dial failures on loopback ✅[^1]: with no listener, `connect: connection refused` came back at once and matched `syscall.ECONNREFUSED`. Against a listener with backlog 0 that never accepts, the first dial connected (it waits in the accept queue) and the second hung until `Dialer{Timeout: 300 * time.Millisecond}` returned `i/o timeout` at 300 ms. A `DialContext` whose context was cancelled after 100 ms returned `operation was canceled`, matching `context.Canceled`.

### UDP: datagrams with `ListenPacket`
- `net.ListenPacket` takes `udp`, `udp4`, `udp6`, `unixgram` or an IP transport and returns a `PacketConn`; `ReadFrom` copies one packet's payload and returns the sender's address, and `WriteTo` sends a packet to an address ✅[^2]. Deadlines work as on a `Conn` ✅[^2].
- Lab: `WriteTo` calls with `hello`, `abc` and `0123456789` arrived as separate reads of 5 and 3 bytes; the third, read into a 4-byte buffer, gave `0123` with a nil error, and the next read timed out because the other 6 bytes were gone ✅[^1].
- Lab, TCP for contrast: two `Write` calls of `hello` and `abc` arrived in one 8-byte `Read`, `helloabc` ✅[^1]. A protocol over TCP therefore needs its own framing, such as a length prefix or a line ending read with `bufio`.
- `UDPConn.ReadFromUDPAddrPort` and `WriteToUDPAddrPort` (Go 1.18) work with `netip.AddrPort` and support allocation-free I/O ✅[^8]. Lab: the server read `"ping"` from `127.0.0.1:45591` and answered `"pong"` to that `AddrPort` ✅[^1].

### Addresses: `JoinHostPort` and `net/netip`
- In `host:port`, a literal IPv6 host must be in square brackets, as in `[2001:db8::1]:80`, optionally with a zone (the interface an address is scoped to) as in `[fe80::1%zone]:80` ✅[^2]. `JoinHostPort` adds the brackets when the host contains a colon, and `SplitHostPort` removes them ✅[^2]. Lab: `JoinHostPort("::1", "8080")` gave `[::1]:8080`, and `SplitHostPort("[fe80::1%eth0]:53")` gave `fe80::1%eth0` and `53` ✅[^1].
- `net/netip` (Go 1.18) defines `Addr`, `AddrPort` and `Prefix`. An `Addr` is to `net.IP` what a number is to a list of digits: one value you can compare and copy, not a slice that shares memory. Compared with `net.IP`, an `Addr` uses less memory, is immutable and is comparable, so it works with `==` and as a map key ✅[^3] ✅[^8]. The zero `Addr` is not a valid address ✅[^3]; in the lab it reported `IsValid()` false and printed `invalid IP` ✅[^1].
- An IPv4-mapped IPv6 address, such as `::ffff:192.0.2.1`, is IPv4 wrapped in IPv6 form: `Is4In6` reports it, `Unmap` strips it, and an IPv4 `Prefix` does not contain it ✅[^3]. Lab: `192.0.2.1 == ::ffff:192.0.2.1` was false, equal after `Unmap()`, and `192.0.2.0/24` did not contain the mapped form ✅[^1].
- `ParseAddr` and `ParseAddrPort` do no name resolution ✅[^3]; `ParseAddr("example.com")` failed with `unexpected character` ✅[^1].
- From the older type: `net.ParseIP("192.0.2.1")` returned a 16-byte `net.IP`, and `netip.AddrFromSlice` on it gave `::ffff:192.0.2.1` until `Unmap` turned it into `192.0.2.1` ✅[^1].

### Name resolution: pure Go or cgo
- Two ways to look up a name: ask the DNS servers yourself, or ask the C library to do it as other programs on the machine would. On Unix, `net` resolves names with a pure Go resolver that queries the servers in `/etc/resolv.conf`, or with a cgo-based one (cgo is Go's mechanism for calling C code) that calls C library routines such as `getaddrinfo` ✅[^2]. The Go resolver is preferred; when cgo is available the cgo one is used in some cases, among them macOS, a set `LOCALDOMAIN` variable (even an empty one), or `/etc/resolv.conf` or `/etc/nsswitch.conf` features the Go resolver does not implement ✅[^2].
- `GODEBUG=netdns=go` or `netdns=cgo` forces one; a number such as `netdns=1` prints the decision, and `netdns=go+1` does both ✅[^2]. The `netgo` build tag leaves the cgo resolver out; `netcgo` prefers it ✅[^2]. At most 500 cgo lookups run at the same time ✅[^2].

Lab, looking up `localhost` (from `/etc/hosts`) in the same container ✅[^1]:
```text
default build, GODEBUG=netdns=2   go package net: dynamic selection of DNS resolver
                                  go package net: hostLookupOrder(localhost) = files,dns
                                  LookupHost [127.0.0.1 ::1]   LookupNetIP "ip4" [::ffff:127.0.0.1]
LOCALDOMAIN= (empty), netdns=2    go package net: hostLookupOrder(localhost) = cgo
                                  LookupHost [::1 127.0.0.1]
GODEBUG=netdns=cgo+1              go package net: GODEBUG setting forcing use of the cgo resolver
                                  LookupHost [::1 127.0.0.1]   LookupNetIP "ip4" [127.0.0.1 127.0.0.1]
CGO_ENABLED=0, or -tags netgo     go package net: ignoring GODEBUG=netdns=cgo as the binary was compiled
                                  without support for the cgo resolver
unknown name, no network          netdns=go:  lookup pkg.go.dev on 0.250.250.200:53: dial udp
                                              0.250.250.200:53: connect: network is unreachable
                                  netdns=cgo: lookup pkg.go.dev: Temporary failure in name resolution
```
The error text alone tells the two apart: the Go resolver names the DNS server it tried.

## Worked example
A connection with a timeout, two ways. The peer writes one byte every 100 ms (`a` to `e`), then, in a second phase, `x` every 150 ms three times (Go 1.27.4, loopback, 8 runs, times rounded to 10 ms) ✅[^1]:
```go
// Phase 1: one absolute deadline for the whole exchange.
c.SetReadDeadline(time.Now().Add(250 * time.Millisecond))
for {
	n, err := c.Read(buf)
	if err != nil {
		break
	}
	handle(buf[:n])
}

// Phase 2: an idle timeout, moved forward before every Read.
for {
	c.SetReadDeadline(time.Now().Add(250 * time.Millisecond))
	n, err := c.Read(buf)
	if err != nil { // errors.Is(err, os.ErrDeadlineExceeded): idle for 250 ms
		break
	}
	handle(buf[:n])
}
```

| Time | Phase | Event | Result ✅[^1] |
|---|---|---|---|
| 100 ms | 1 | `Read` | `"a"` |
| 200–210 ms | 1 | `Read` | `"b"` |
| 250 ms | 1 | `Read` | `i/o timeout`: the same instant applies to every call |
| later | 1 | deadline cleared, `Read` | `"cde"`: bytes that came after the timeout were kept |
| 150, 300–310, 460 ms | 2 | `Read` | `"x"` each time, deadline moved to 250 ms ahead |
| 710–720 ms | 2 | `Read` | `i/o timeout`, 250 ms after the last byte |

Phase 1 bounds the whole conversation, which suits a request that must finish in time; phase 2 bounds silence, which suits a long-lived connection that may legitimately run for hours.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `Read` after an expired deadline, with no new one | Fails at once with `i/o timeout` ✅[^1] | The deadline applies to all future I/O until it is moved ✅[^2] |
| Data that arrives after a read timed out | Kept; the next read, once the deadline is cleared or moved, returns it ✅[^1] | A timeout ends the call, not the connection; a later deadline refreshes it ✅[^2] |
| A dial timeout tested with `errors.Is` | In 3 runs of 20 dials each, the `i/o timeout` error matched `os.ErrDeadlineExceeded` in some dials and `context.DeadlineExceeded` in the others, for both `Dialer.Timeout` and a context deadline; `Timeout()` was true every time ✅[^1] | Not documented; test dial timeouts with `net.Error`'s `Timeout()` |
| Context ends after the dial succeeded | The connection stays usable | `DialContext` only bounds connecting ✅[^2] |
| UDP datagram larger than the buffer | Truncated to the buffer, `err == nil`, rest discarded ✅[^1] | One `ReadFrom` returns one packet ✅[^2] |
| `"::1:8080"` passed to `Dial` | `dial tcp: address ::1:8080: too many colons in address` ✅[^1] | IPv6 literals need brackets ✅[^2] |
| `Listen` with a host name | Listens on at most one of the host's addresses | Not recommended by the docs ✅[^2] |
| `LookupNetIP(ctx, "ip4", "localhost")` | Go resolver: `[::ffff:127.0.0.1]`; cgo resolver: `[127.0.0.1 127.0.0.1]` ✅[^1] | Call `Unmap()` before comparing with an IPv4 `Addr` ✅[^3] |
| `GODEBUG=netdns=cgo` on a `CGO_ENABLED=0` or `netgo` binary | Ignored, with a debug message ✅[^1] | `netgo` removes the cgo resolver ✅[^2] |
| DNS lookup times out | Since Go 1.23, `errors.Is(dnsErr, context.DeadlineExceeded)` reports it | `DNSError` wraps timeout and cancellation errors ✅[^6] |
| `UnixConn` read at end of file | Since Go 1.27, returns `io.EOF` itself, not wrapped in `net.OpError` ✅[^9] | Release-note change |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Goroutine per connection | Plain blocking code; a blocked goroutine holds no thread ✅[^1] | Every connection needs its own deadline handling |
| One deadline per exchange | Bounds the total time ✅[^1] | Every later call fails until it is reset ✅[^1] |
| Deadline moved before each `Read` | Idle timeout for long connections ✅[^2] | One extra call per read |
| `context.AfterFunc` setting the deadline | A `Read` that stops with a context ✅[^5] | More code; the deadline must be cleared afterwards ✅[^5] |
| TCP | Ordered bytes | Message boundaries are lost ✅[^1] |
| UDP | Message boundaries kept ✅[^1] | Silent truncation with a short buffer ✅[^1] |
| `netip.Addr` | Small, immutable, `==`, map key ✅[^3] | Mapped forms from older APIs need `Unmap` ✅[^1] |

## Takeaways
- Set a deadline on every connection that reads from a peer you do not control; for an idle timeout, move it forward before each `Read` ✅[^2]. [rule-candidate]
- Test dial timeouts with `errors.As(err, &ne) && ne.Timeout()` (`ne` a `net.Error`), not with one sentinel error ✅[^1]. [rule-candidate]
- Build every `host:port` with `net.JoinHostPort`, never with `fmt.Sprintf` ✅[^2]. [rule-candidate]
- Dial with a `net.Dialer` that has a `Timeout`, or with `DialContext`, instead of a bare `net.Dial` ✅[^2]. [rule-candidate]
- End an accept loop when `errors.Is(err, net.ErrClosed)` after `ln.Close()` ✅[^2].
- Frame messages yourself on TCP: one `Write` is not one `Read` ✅[^1].
- Store and compare addresses as `netip.Addr`, and `Unmap()` results from APIs that may return IPv4-mapped forms ✅[^3].

## Verification status
- Verified: 102 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `go/lab-setup.md` — the Go 1.27.4 lab (`golang:1.27.4`, `--network none`, loopback only) where every behaviour marked with this note ran on 2026-11-24: the echo server and half-close, 2,000 idle connections against the thread count, read and write deadlines, the `context.AfterFunc` read, refused and timed-out dials and their error identities, keep-alive socket options, UDP truncation against TCP merging, `JoinHostPort` and `netip`, and the DNS resolver runs with `GODEBUG=netdns`. [^1]
- [net package](https://pkg.go.dev/net) — Go team, living. Rank 1. Backs: `Listen`, `Accept`, `Dial` and address forms; the `Conn` and `Listener` interfaces and their concurrency; deadline semantics; `ErrClosed`; `Error` and deprecated `Temporary`; `CloseWrite`; `Dialer` fields, `DialContext`, keep-alive defaults and `KeepAliveConfig`; `ListenPacket` and `PacketConn`; `JoinHostPort`, `SplitHostPort`; name resolution, `GODEBUG=netdns`, `netgo`/`netcgo`, the 500-lookup limit. [^2]
- [net/netip package](https://pkg.go.dev/net/netip) — Go team, living. Rank 1. Backs: `Addr` is a small comparable immutable value; the zero `Addr` is invalid; `Is4In6`, `Unmap`; `Prefix.Contains` and mapped addresses; `ParseAddr` and `ParseAddrPort` do no resolution. [^3]
- [os package](https://pkg.go.dev/os) — Go team, living. Rank 1. Backs: `ErrDeadlineExceeded` and its text `i/o timeout`; its `Timeout` method. [^4]
- [context package](https://pkg.go.dev/context) — Go team, living. Rank 1. Backs: the `AfterFunc` example that stops a `net.Conn` read with a context. [^5]
- [Go 1.23 Release Notes](https://go.dev/doc/go1.23) — Go team, 2024. Rank 1. Backs: `KeepAliveConfig`; `DNSError` wraps timeout and cancellation errors. [^6]
- [Go 1.26 Release Notes](https://go.dev/doc/go1.26) — Go team, 2026. Rank 1. Backs: `Dialer.DialTCP`, `DialUDP`, `DialIP`, `DialUnix`. [^7]
- [Go 1.18 Release Notes](https://go.dev/doc/go1.18) — Go team, 2022. Rank 1. Backs: the new `net/netip` package; `UDPConn` `AddrPort` methods and allocation-free I/O. [^8]
- [Go 1.27 Release Notes](https://go.dev/doc/go1.27) — Go team, 2026. Rank 1. Backs: `UnixConn` reads return `io.EOF` directly. [^9]

## Related
- `go/runtime/scheduler-and-goroutine-stacks.md` — the network poller that parks a goroutine blocked in `Read`.
- `go/standard-library/io-and-encoding-json.md` — the `io.Reader` and `io.Writer` contracts a `net.Conn` follows, and `bufio`.
- `go/standard-library/net-http.md` — HTTP on top of these connections, with its own server and client timeouts.
- `go/concurrency/context-and-cancellation.md` — `context.AfterFunc` and deadlines in general.
- `go/standard-library/time-and-clocks.md` — `time.Time` values used as deadlines.
- `linux/networking/tcp-connection-lifecycle.md` — handshake, accept queue, half-close and `TIME-WAIT`.
- `linux/networking/io-multiplexing-epoll-io-uring.md` — epoll, the readiness interface under the poller.
- `go/learning-path.md`
