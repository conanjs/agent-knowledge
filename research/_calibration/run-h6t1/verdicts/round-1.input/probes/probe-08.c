#define _GNU_SOURCE
#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/epoll.h>
#include <sys/socket.h>
#include <sys/utsname.h>
#include <unistd.h>

/* Errors: a failing system call ends the probe with exit 1, so an error never passes as a match. */
static void die(const char *m) { perror(m); exit(1); }
static void nb(int fd) { int f = fcntl(fd, F_GETFL); if (fcntl(fd, F_SETFL, f | O_NONBLOCK) < 0) die("fcntl"); }

/* Setup: a pipe, an AF_UNIX stream socketpair, a connected TCP pair over loopback, an epoll instance. */
static void mkpipe(int p[2]) { if (pipe(p)) die("pipe"); }
static void mkunix(int s[2]) { if (socketpair(AF_UNIX, SOCK_STREAM, 0, s)) die("socketpair"); }
static void tcp_pair(int *a, int *b) {
    int l = socket(AF_INET, SOCK_STREAM, 0);
    if (l < 0) die("socket");
    struct sockaddr_in sa = { .sin_family = AF_INET, .sin_addr.s_addr = htonl(INADDR_LOOPBACK) };
    socklen_t sl = sizeof sa;
    if (bind(l, (void *)&sa, sl) || listen(l, 1) || getsockname(l, (void *)&sa, &sl)) die("tcp listen");
    *a = socket(AF_INET, SOCK_STREAM, 0);
    if (*a < 0) die("socket");
    if (connect(*a, (void *)&sa, sl)) die("connect");
    *b = accept(l, NULL, NULL);
    if (*b < 0) die("accept");
    close(l);
}
static int mkep(void) { int ep = epoll_create1(0); if (ep < 0) die("epoll_create1"); return ep; }

static const char *mask(uint32_t e) {
    static char b[128]; b[0] = 0;
    if (e & EPOLLIN) strcat(b, "IN|");
    if (e & EPOLLOUT) strcat(b, "OUT|");
    if (e & EPOLLRDHUP) strcat(b, "RDHUP|");
    if (e & EPOLLHUP) strcat(b, "HUP|");
    if (e & EPOLLERR) strcat(b, "ERR|");
    size_t n = strlen(b); if (n) b[n - 1] = 0; else strcpy(b, "-");
    return b;
}

/* epoll wrappers. waitmax() polls with timeout 0, prints the result as et_lab.c does, and keeps it in
   seen[] and seen_n for the checks below. */
static struct epoll_event seen[8];
static int seen_n;
static int waitmax(int ep, int maxev, const char *label) {
    int n = epoll_wait(ep, seen, maxev, 0);
    if (n < 0) die("epoll_wait");
    seen_n = n;
    printf("    %-58s -> %d event(s)", label, n);
    for (int i = 0; i < n; i++) printf(" [data=%llu %s]", (unsigned long long)seen[i].data.u64, mask(seen[i].events));
    printf("\n");
    return n;
}
static int w(int ep, const char *label) { return waitmax(ep, 8, label); }

static void ctl(int ep, int op, int fd, uint32_t events, uint64_t data) {
    struct epoll_event e = { .events = events, .data.u64 = data };
    if (epoll_ctl(ep, op, fd, &e) < 0) die("epoll_ctl");
}
static void wr(int fd, size_t n) {
    char buf[4096]; memset(buf, 'x', sizeof buf);
    size_t done = 0;
    while (done < n) {
        ssize_t r = write(fd, buf, n - done > sizeof buf ? sizeof buf : n - done);
        if (r < 0) die("write");
        done += r;
    }
}
static ssize_t rd(int fd, size_t n) { static char buf[1 << 20]; return read(fd, buf, n > sizeof buf ? sizeof buf : n); }
static const char *trigname(uint32_t t) { return t ? "ET" : "LT"; }

/* Threads (T10, T11): each blocks in epoll_wait on its epoll fd for up to 400 ms. */
struct tharg { int ep; int got; int err; };
static void *waiter(void *v) {
    struct tharg *a = v; struct epoll_event ev;
    a->got = epoll_wait(a->ep, &ev, 1, 400);
    a->err = errno;
    return NULL;
}
static void spawn(pthread_t *t, struct tharg *a) {
    int e = pthread_create(t, NULL, waiter, a);
    if (e) { errno = e; die("pthread_create"); }
}
/* Joins one waiter; 1 if it returned with an event, 0 if it timed out. An epoll_wait error ends the probe. */
static int joined_with_event(pthread_t t, struct tharg *a) {
    int e = pthread_join(t, NULL);
    if (e) { errno = e; die("pthread_join"); }
    if (a->got < 0) { errno = a->err; die("epoll_wait in a thread"); }
    return a->got > 0;
}

/* Checks: each compares one observation with what the doc states for the test; main() ends with verdict(). */
static int failures;
static void expect_int(const char *what, long long saw, long long doc) {
    if (saw == doc) return;
    printf("    MISMATCH %s: saw %lld, the doc states %lld\n", what, saw, doc);
    failures++;
}
/* The data value of the first event of the last waitmax(). */
static void expect_data(const char *what, uint64_t doc) {
    if (seen_n >= 1 && seen[0].data.u64 == doc) return;
    if (seen_n < 1) printf("    MISMATCH %s: saw no event, the doc states data=%llu\n", what, (unsigned long long)doc);
    else printf("    MISMATCH %s: saw data=%llu, the doc states data=%llu\n", what, (unsigned long long)seen[0].data.u64, (unsigned long long)doc);
    failures++;
}
/* The reported bits (IN, OUT, RDHUP, HUP, ERR) of the first event of the last wait. */
static void expect_mask(const char *what, uint32_t doc) {
    uint32_t saw = seen_n < 1 ? 0 : seen[0].events & (EPOLLIN | EPOLLOUT | EPOLLRDHUP | EPOLLHUP | EPOLLERR);
    if (seen_n >= 1 && saw == doc) return;
    printf("    MISMATCH %s: saw %s, ", what, seen_n < 1 ? "no event" : mask(saw));
    printf("the doc states %s\n", mask(doc));
    failures++;
}
static void kernel(void) {
    struct utsname u;
    if (uname(&u)) die("uname");
    printf("kernel: %s %s %s\n", u.sysname, u.release, u.machine);
}
static int verdict(void) {
    if (failures) printf("\nRESULT: %d observation(s) differ from the doc\n", failures);
    else printf("\nRESULT: every observation matches the doc\n");
    return failures ? 1 : 0;
}
/* The doc: a pipe is full at 65536 bytes; no EPOLLOUT after the reader takes 1 byte, one EPOLLOUT once it
   has taken 4096 (a freed page, so reads of 1024 also give the first EPOLLOUT at 4096). An AF_UNIX stream
   socket is full at 196608 bytes and, read 4096 at a time, gives its first EPOLLOUT only after 151552. */
static size_t fill(int wfd) {
    char buf[4096]; memset(buf, 'y', sizeof buf);
    size_t total = 0; ssize_t r;
    while ((r = write(wfd, buf, sizeof buf)) > 0) total += r;
    int e = errno;
    if (r < 0 && e != EAGAIN) die("write");
    printf("    wrote %zu bytes before write() failed with %s\n", total, strerror(e));
    return total;
}

static void t8_pipe_one_byte(void) {
    printf("\n[T8-ET] pipe, 1-byte read first\n");
    int p[2]; mkpipe(p); nb(p[1]); nb(p[0]);
    int ep = mkep();
    ctl(ep, EPOLL_CTL_ADD, p[1], EPOLLOUT | EPOLLET, 2);
    w(ep, "right after ADD");
    expect_int("bytes written before EAGAIN", fill(p[1]), 65536);
    expect_int("events with the pipe full", w(ep, "pipe full"), 0);
    ssize_t r = rd(p[0], 1);
    printf("    read(1) = %zd\n", r);
    expect_int("read(1)", r, 1);
    expect_int("events after reading 1 byte", w(ep, "after reading 1 byte"), 0);
    r = rd(p[0], 4095);
    printf("    read(4095) = %zd\n", r);
    expect_int("read(4095)", r, 4095);
    expect_int("events after reading 4096 bytes", w(ep, "after reading 4096 bytes in total (one page)"), 1);
    expect_mask("mask of that event", EPOLLOUT);
    close(ep); close(p[0]); close(p[1]);
}

static void t8_one(const char *kind, int wfd, int rfd, size_t step, size_t doc_total, size_t doc_edge) {
    printf("\n[T8-ET] %s: EPOLLOUT edge after the writer hits EAGAIN\n", kind);
    nb(wfd); nb(rfd);
    int ep = mkep();
    ctl(ep, EPOLL_CTL_ADD, wfd, EPOLLOUT | EPOLLET, 2);
    w(ep, "right after ADD (empty buffer)");
    w(ep, "again");
    size_t total = fill(wfd);
    expect_int("bytes written before EAGAIN", total, doc_total);
    expect_int("events with the buffer full", w(ep, "buffer full"), 0);
    size_t readsofar = 0, edge = 0;
    while (readsofar < total) {
        ssize_t got = rd(rfd, step);
        if (got < 0) die("read");
        if (got == 0) break;
        readsofar += got;
        usleep(2000);
        char label[96];
        snprintf(label, sizeof label, "reader consumed %zu of %zu bytes", readsofar, total);
        int n = epoll_wait(ep, seen, 2, 0);
        if (n < 0) die("epoll_wait");
        seen_n = n;
        if (n > 0) {
            printf("    %-58s -> %d event(s) [%s]  <- first EPOLLOUT edge\n", label, n, mask(seen[0].events));
            edge = readsofar;
            break;
        }
    }
    if (!edge) printf("    no EPOLLOUT edge before the buffer was empty\n");
    expect_int("bytes read before the first EPOLLOUT", edge, doc_edge);
    expect_mask("mask of the first EPOLLOUT", EPOLLOUT);
    close(ep);
}

int main(void) {
    kernel();
    t8_pipe_one_byte();
    int p[2]; mkpipe(p);
    t8_one("pipe, reads of 1024 bytes", p[1], p[0], 1024, 65536, 4096);
    close(p[0]); close(p[1]);
    int s[2]; mkunix(s);
    t8_one("AF_UNIX stream socketpair, reads of 4096 bytes", s[0], s[1], 4096, 196608, 151552);
    close(s[0]); close(s[1]);
    return verdict();
}
