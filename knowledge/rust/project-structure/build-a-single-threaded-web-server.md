---
schema: knowledge-doc/v1
type: how-to
topic: rust/project-structure
status: verified
applies-to: ["Rust 1.100.0", "edition 2024", "HTTP/1.1 (RFC 9110, RFC 9112)", "Docker for the lab run"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [rust, http, tcp, web-server, tcplistener, tcpstream, std-net, bufreader, read-timeout, status-codes, docker-port-publishing]
---

# Build a single-threaded HTTP server with `std::net`

## Summary
**TL;DR:** Build `tinyhttp`, an HTTP/1.1 server that uses only the standard library: a `TcpListener` accepts one connection at a time, `handle` reads the request line and the header lines up to the empty line, `route` picks a status and a body, and one `write_all` sends the status line, headers (with `Content-Length`) and body before the connection closes. TCP is the pipe that carries bytes between two programs; HTTP is the agreed layout of the text sent through it, like a letter format (address line, then headers, then a blank line, then the body) sent over the postal service. Because one thread serves every client, a 2-second page made a second client wait 1.67 s in the lab; the thread pool that fixes this is in `rust/concurrency/threads-channels-and-locks.md`.
**Use this when:** you want to see what a web framework does underneath, write a tiny test or health endpoint without dependencies, or debug a hand-written server that hangs clients or cannot be reached from outside a container.
**Not this doc:** serving clients in parallel with a thread pool and shutting down cleanly (Rust Book 21.2–21.3) → `rust/concurrency/threads-channels-and-locks.md`; async servers → `rust/async/tokio-runtime-tasks-and-cancellation.md`; how container networking works → `linux/containers/container-networking.md`; the general shape of a Rust CLI project → `rust/project-structure/build-a-command-line-tool.md`.

## Goal & prerequisites
**End state:** a binary `tinyhttp [ADDR]` (default `127.0.0.1:7878`) that answers:

| Request | Status line | Body |
|---|---|---|
| `GET /` | `HTTP/1.1 200 OK` | `hello from one thread` |
| `GET /echo/<text>` | `HTTP/1.1 200 OK` | `<text>` |
| `GET /slow` | `HTTP/1.1 200 OK` after 2 s | `slow page done` |
| `GET` of any other path | `HTTP/1.1 404 Not Found` | `no such page` |
| any other method | `HTTP/1.1 405 Method Not Allowed`, plus `Allow: GET` | `only GET is supported` |
| a request line that is not three words | `HTTP/1.1 400 Bad Request` | `bad request line` |
| a version other than `HTTP/1.x` | `HTTP/1.1 505 HTTP Version Not Supported` | `HTTP/1.x only` |

A 405 response must carry an `Allow` header listing the methods the resource supports ✅[^5].

**Needs:** a Rust toolchain with Cargo (Rust 1.100.0, edition 2024; see `rust/fundamentals/toolchain-cargo-and-editions.md`), `curl` and `nc` for the checks, no external crates. The lab ran the server in `rustlab:1` (`linux/lab-setup.md`) and the checks from the macOS host.

## Steps
1. **Create the project.**
   ```console
   $ cargo new tinyhttp && cd tinyhttp
   ```
2. **Listen and accept connections in `src/main.rs`.** `TcpListener::bind` opens the listening socket; `incoming()` never ends and is the same as calling `accept` in a loop, so each item is one connection *attempt*, which can fail ✅[^3] ✅[^2]. A bind failure is reported and turned into exit code 1 instead of a panic:
   ```rust
   use std::io::{BufRead, BufReader, Read, Write};
   use std::net::{TcpListener, TcpStream};
   use std::time::Duration;

   fn main() {
       let addr = std::env::args().nth(1).unwrap_or_else(|| "127.0.0.1:7878".to_string());
       let listener = match TcpListener::bind(&addr) {
           Ok(listener) => listener,
           Err(e) => {
               eprintln!("cannot bind {addr}: {e}");
               std::process::exit(1);
           }
       };
       eprintln!("listening on {addr}");
       for attempt in listener.incoming() {
           match attempt {
               Ok(stream) => {
                   if let Err(e) = handle(stream) {
                       eprintln!("connection error: {e}");
                   }
               }
               Err(e) => eprintln!("accept failed: {e}"),
           }
       }
   }
   ```
3. **Read the request head, bounded in time and size.** An HTTP/1.1 message is a start line, then header lines, each ending in CRLF (carriage return + line feed, `\r\n`), then an empty line, then an optional body ✅[^4]. So read lines until the empty one; never read "until the end of the stream", because the client keeps the connection open while it waits for the answer (see Troubleshooting). `set_read_timeout` stops a silent client from holding the only thread forever ✅[^6], and `take` makes the reader report end of input after 16 KiB ✅[^7]:
   ```rust
   /// Reads one request (request line + headers) and writes one response.
   fn handle(mut stream: TcpStream) -> std::io::Result<()> {
       stream.set_read_timeout(Some(Duration::from_secs(5)))?;
       let mut reader = BufReader::new((&stream).take(16 * 1024)); // cap the request head at 16 KiB
       let mut request_line = String::new();
       reader.read_line(&mut request_line)?;
       loop {
           let mut header = String::new();
           let n = reader.read_line(&mut header)?;
           if n == 0 || header == "\r\n" || header == "\n" {
               break; // end of headers (or the client stopped sending)
           }
       }
       let reply = route(request_line.trim_end());
       let response = format!(
           "HTTP/1.1 {}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n{}\r\n{}",
           reply.status, reply.body.len(), reply.extra_headers, reply.body
       );
       stream.write_all(response.as_bytes())
   }
   ```
   The response follows the same layout: a status line (`HTTP/1.1`, a space, the code, a space, an optional reason phrase), the headers, an empty line, the body ✅[^4]. `Content-Length` is the body's size in bytes, which tells the client where the body ends ✅[^4]; `body.len()` counts bytes, not characters: `GET /echo/Việt` got `Content-Length: 7` for the 4-letter word plus a newline ✅[^1]. When `stream` is dropped at the end of `handle`, the socket closes ✅[^3] ✅[^2].
4. **Route the request line.** A request line is three parts separated by single spaces: method, request target, HTTP version ✅[^4]. Splitting on spaces and requiring exactly three parts gives the 400 case for free:
   ```rust
   #[derive(Debug, PartialEq)]
   struct Reply { status: &'static str, body: String, extra_headers: &'static str }

   fn reply(status: &'static str, body: impl Into<String>) -> Reply {
       Reply { status, body: body.into(), extra_headers: "" }
   }

   /// Maps a request line such as `GET /echo/hi HTTP/1.1` to a reply.
   fn route(request_line: &str) -> Reply {
       let mut parts = request_line.split(' ');
       let (Some(method), Some(target), Some(version), None) = (parts.next(), parts.next(), parts.next(), parts.next()) else {
           return reply("400 Bad Request", "bad request line\n");
       };
       if !version.starts_with("HTTP/1.") {
           return reply("505 HTTP Version Not Supported", "HTTP/1.x only\n");
       }
       match (method, target) {
           ("GET", "/") => reply("200 OK", "hello from one thread\n"),
           ("GET", "/slow") => {
               std::thread::sleep(Duration::from_secs(2));
               reply("200 OK", "slow page done\n")
           }
           ("GET", t) if t.starts_with("/echo/") => reply("200 OK", format!("{}\n", &t["/echo/".len()..])),
           ("GET", _) => reply("404 Not Found", "no such page\n"),
           _ => Reply { extra_headers: "Allow: GET\r\n", ..reply("405 Method Not Allowed", "only GET is supported\n") },
       }
   }
   ```
   `route` takes a `&str` and returns a value, with no socket involved, so it can be unit-tested.
5. **Add unit tests** at the end of `src/main.rs` and run them:
   ```rust
   #[cfg(test)]
   mod tests {
       use super::*;

       #[test]
       fn root_and_echo() {
           assert_eq!(route("GET / HTTP/1.1").status, "200 OK");
           assert_eq!(route("GET /echo/rust HTTP/1.1").body, "rust\n");
       }

       #[test]
       fn errors() {
           assert_eq!(route("GET /missing HTTP/1.1").status, "404 Not Found");
           assert_eq!(route("POST / HTTP/1.1").extra_headers, "Allow: GET\r\n");
           assert_eq!(route("garbage").status, "400 Bad Request");
           assert_eq!(route("GET / HTTP/2").status, "505 HTTP Version Not Supported");
       }
   }
   ```
   ```console
   $ cargo test -q
   running 2 tests
   ..
   test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
   ```
   Output from the lab ✅[^1]. Test kinds and flags are covered in `rust/project-structure/testing.md`.
6. **Build and start the server.** On the machine itself: `cargo run --release`. In a container, bind every interface inside it and publish the port on the host's loopback only, because a published port is otherwise reachable from other machines too ✅[^8]:
   ```console
   $ cargo build --release
   $ docker run -d --rm --name tinyhttp-lab -p 127.0.0.1:7878:7878 -v "$PWD:/lab" rustlab:1 ./target/release/tinyhttp 0.0.0.0:7878
   $ docker port tinyhttp-lab
   7878/tcp -> 127.0.0.1:7878
   ```
   The release binary was 541,744 bytes on aarch64 ✅[^1].

## Verify
Run each check from the host; every output below is from the lab ✅[^1]:

| Command | Expected output |
|---|---|
| `curl -si http://127.0.0.1:7878/` | `HTTP/1.1 200 OK`, `Content-Type: text/plain; charset=utf-8`, `Content-Length: 22`, `Connection: close`, an empty line, `hello from one thread`; `echo $?` prints 0 |
| `curl -s http://127.0.0.1:7878/echo/rust` | `rust` |
| `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:7878/nope` | `404` |
| `curl -si -X POST http://127.0.0.1:7878/` | `HTTP/1.1 405 Method Not Allowed` … `Allow: GET` |
| `printf 'HELLO\r\n\r\n' \| nc 127.0.0.1 7878` | `HTTP/1.1 400 Bad Request` |
| `printf 'GET / HTTP/2\r\n\r\n' \| nc 127.0.0.1 7878` | `HTTP/1.1 505 HTTP Version Not Supported` |
| `curl -s …/slow &`, then 0.3 s later `curl -s …/` | `/slow` returns after 2.03 s; the `/` request, which needs no work, returns after 1.67 s |

The last check shows the limit of one thread: the second client waited for the first one's 2 seconds (2.03 − 0.3 ≈ 1.7) ✅[^1]. Rust Book 21.2 and 21.3 move `handle` onto a pool of worker threads; `rust/concurrency/threads-channels-and-locks.md` builds such a pool with clean shutdown.

## Troubleshooting
| Symptom | Cause | Fix |
|---|---|---|
| `cannot bind 0.0.0.0:7878: Address already in use (os error 98)`, exit code 1 ✅[^1] | Another process (here a second copy of the server) already listens on that port ✅[^2] | Stop the other process or pass another address, such as `127.0.0.1:7879` |
| From the host, `curl: (56) Recv failure: Connection reset by peer` (a second run on the same lab gave `curl: (52) Empty reply from server`, so the exact curl error varies); from inside the container the same request returns 200 ✅[^1] | The server bound `127.0.0.1` inside the container, which is the container's own loopback interface, not the host's ✅[^9] | Bind `0.0.0.0:7878` inside the container and publish with `-p 127.0.0.1:7878:7878` (step 6) |
| Every request hangs; `curl -m 3` ends with `curl: (28) Operation timed out after 3005 milliseconds with 0 bytes received`, and only then does the server log `read 5 lines` ✅[^1] | The handler read the request with `lines()` until the end of the stream; the client never ends its side while it waits for the answer | Stop at the empty line that ends the headers (step 3) |
| `connection error: Resource temporarily unavailable (os error 11)` in the log after a client connected and sent nothing for 5 s ✅[^1] | The read timeout fired; on Unix a timed-out read typically fails with `WouldBlock`, on Windows it may be `TimedOut` ✅[^6] | Expected: the thread is free again. Raise the timeout if real clients are that slow |
| A request head larger than 16 KiB still got `200 OK`, and the client saw `write error: Broken pipe` while still sending ✅[^1] | After 16 KiB, `take` reports end of input, so the header loop stops and the server answers and closes ✅[^7] | To reject such requests instead, count the bytes read and answer with an error status |
| A browser shows several `connection` log lines for one page view | Browsers also request other resources, such as `/favicon.ico`, retry, or open spare connections ✅[^2] | Expected; test with `curl` to see one request per connection |

## Rollback
Stop the server with Ctrl-C (or `docker stop tinyhttp-lab`; `--rm` removes the container) and delete the `tinyhttp/` folder. Nothing is installed.

## Takeaways
- Read an HTTP request head up to the empty line, never to the end of the stream. [rule-candidate]
- Give every accepted connection a read timeout and a size cap, so one slow or huge client cannot hold the server. [rule-candidate]
- Compute `Content-Length` from the body's bytes, and send `Allow` with every 405 response. [rule-candidate]
- Keep routing a pure function of the request line so it can be unit-tested without sockets.
- In containers, bind `0.0.0.0` inside and publish to `127.0.0.1` on the host unless other machines must reach it.

## Verification status
- Verified: 27 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `linux/lab-setup.md` — the Rust 1.100.0 lab (`rustlab:1`) where every behaviour marked with this note ran on 2026-11-24; the `curl` and `nc` checks ran from the macOS host against the published port. [^1]
- [Building a Single-Threaded Web Server](https://doc.rust-lang.org/book/ch21-01-single-threaded.html) — The Rust Programming Language, living. Backs: connection attempts from `incoming`, a failing `bind` when the port is taken, the connection closing when the stream is dropped, browsers' extra requests and connections. [^2]
- [TcpListener in std::net](https://doc.rust-lang.org/std/net/struct.TcpListener.html) — Rust standard library, living. Backs: `bind`, `incoming` as an endless `accept` loop, the socket closing on drop. [^3]
- [RFC 9112: HTTP/1.1](https://www.rfc-editor.org/rfc/rfc9112.html) — IETF, 2022. Backs: message layout with CRLF and the empty line, request-line and status-line grammar, `Content-Length` as the body length. [^4]
- [RFC 9110: HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110.html) — IETF, 2022. Backs: a 405 response must include `Allow`. [^5]
- [TcpStream in std::net](https://doc.rust-lang.org/std/net/struct.TcpStream.html) — Rust standard library, living. Backs: `set_read_timeout`, and the platform-specific error kind of a timed-out read. [^6]
- [Read in std::io](https://doc.rust-lang.org/std/io/trait.Read.html) — Rust standard library, living. Backs: `take` reads at most the limit, then returns end of input. [^7]
- [Port publishing and mapping](https://docs.docker.com/engine/network/port-publishing/) — Docker, living. Backs: published ports are reachable from outside by default; `-p 127.0.0.1:…` limits them to the host. [^8]
- [Networking overview](https://docs.docker.com/engine/network/) — Docker, living. Backs: `127.0.0.1` inside a container is the container's own loopback address. [^9]

## Related
- `rust/concurrency/threads-channels-and-locks.md` — the thread pool and graceful shutdown of Rust Book 21.2–21.3.
- `rust/project-structure/build-a-command-line-tool.md` — the other Book project, a grep-like tool.
- `rust/async/tokio-runtime-tasks-and-cancellation.md` — serving many connections with async tasks instead of threads.
- `linux/containers/container-networking.md` — network namespaces and port publishing underneath Docker.
- `linux/networking/` — the packet path and TCP states.
