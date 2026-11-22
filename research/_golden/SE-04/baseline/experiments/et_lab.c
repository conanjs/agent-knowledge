/*
 * et_lab.c - small experiments on epoll edge-triggered (EPOLLET) behaviour.
 * Build and run inside a Linux container:  see run.sh next to this file.
 * Every test prints what epoll_wait() returned after each step.
 */
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

static void die(const char *m) { perror(m); exit(1); }
static void nb(int fd) { int f = fcntl(fd, F_GETFL); if (fcntl(fd, F_SETFL, f | O_NONBLOCK) < 0) die("fcntl"); }

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

static int waitmax(int ep, int maxev, const char *label) {
    struct epoll_event ev[8];
    int n = epoll_wait(ep, ev, maxev, 0);
    if (n < 0) die("epoll_wait");
    printf("    %-58s -> %d event(s)", label, n);
    for (int i = 0; i < n; i++) printf(" [data=%llu %s]", (unsigned long long)ev[i].data.u64, mask(ev[i].events));
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

/* T1: partial read. The epoll(7) pipe example. */
static void t1(uint32_t trig) {
    printf("\n[T1-%s] pipe, write 2048 bytes, read only 1024\n", trigname(trig));
    int p[2]; if (pipe(p)) die("pipe"); nb(p[0]);
    int ep = epoll_create1(0);
    ctl(ep, EPOLL_CTL_ADD, p[0], EPOLLIN | trig, 1);
    wr(p[1], 2048);
    w(ep, "after writer sends 2048 bytes");
    printf("    read(1024) = %zd\n", rd(p[0], 1024));
    w(ep, "1024 bytes still unread, no new write");
    w(ep, "same, asked again");
    printf("    read(4096) = %zd\n", rd(p[0], 4096));
    ssize_t r = rd(p[0], 4096);
    printf("    read(4096) = %zd (%s)\n", r, r < 0 ? strerror(errno) : "data");
    w(ep, "after draining to EAGAIN");
    close(p[0]); close(p[1]); close(ep);
}

/* T2: fd already readable when it is added. */
static void t2(void) {
    printf("\n[T2-ET] pipe already holds 10 bytes when EPOLL_CTL_ADD runs\n");
    int p[2]; if (pipe(p)) die("pipe"); nb(p[0]);
    wr(p[1], 10);
    int ep = epoll_create1(0);
    ctl(ep, EPOLL_CTL_ADD, p[0], EPOLLIN | EPOLLET, 1);
    w(ep, "first wait after ADD");
    w(ep, "second wait, nothing new");
    close(p[0]); close(p[1]); close(ep);
}

/* T3: several writes before one epoll_wait are merged. */
static void t3(void) {
    printf("\n[T3-ET] three 1-byte writes before one epoll_wait\n");
    int p[2]; if (pipe(p)) die("pipe"); nb(p[0]);
    int ep = epoll_create1(0);
    ctl(ep, EPOLL_CTL_ADD, p[0], EPOLLIN | EPOLLET, 1);
    wr(p[1], 1); wr(p[1], 1); wr(p[1], 1);
    w(ep, "after 3 writes");
    printf("    read(100) = %zd\n", rd(p[0], 100));
    close(p[0]); close(p[1]); close(ep);
}

/* T4: new data arrives while old data is still unread. */
static void t4_one(const char *kind, int rfd, int wfd) {
    printf("\n[T4-ET] %s: second write while the first byte is still unread\n", kind);
    nb(rfd);
    int ep = epoll_create1(0);
    ctl(ep, EPOLL_CTL_ADD, rfd, EPOLLIN | EPOLLET, 1);
    wr(wfd, 1); usleep(20000);
    w(ep, "after 1st byte");
    w(ep, "no new write");
    wr(wfd, 1); usleep(20000);
    w(ep, "after 2nd byte (1st still unread)");
    printf("    read(100) = %zd\n", rd(rfd, 100));
    close(ep);
}
static void tcp_pair(int *a, int *b) {
    int l = socket(AF_INET, SOCK_STREAM, 0);
    struct sockaddr_in sa = { .sin_family = AF_INET, .sin_addr.s_addr = htonl(INADDR_LOOPBACK) };
    socklen_t sl = sizeof sa;
    if (bind(l, (void *)&sa, sl) || listen(l, 1) || getsockname(l, (void *)&sa, &sl)) die("tcp listen");
    *a = socket(AF_INET, SOCK_STREAM, 0);
    if (connect(*a, (void *)&sa, sl)) die("connect");
    *b = accept(l, NULL, NULL);
    if (*b < 0) die("accept");
    close(l);
}
static void t4(void) {
    int p[2]; if (pipe(p)) die("pipe");
    t4_one("pipe", p[0], p[1]); close(p[0]); close(p[1]);
    int s[2]; if (socketpair(AF_UNIX, SOCK_STREAM, 0, s)) die("socketpair");
    t4_one("AF_UNIX stream socketpair", s[0], s[1]); close(s[0]); close(s[1]);
    int a, b; tcp_pair(&a, &b);
    t4_one("TCP over loopback", b, a); close(a); close(b);
}

/* T5: data arrives and is consumed before epoll_wait runs. */
static void t5(void) {
    printf("\n[T5-ET] write 5 bytes, read them all, then epoll_wait\n");
    int p[2]; if (pipe(p)) die("pipe"); nb(p[0]);
    int ep = epoll_create1(0);
    ctl(ep, EPOLL_CTL_ADD, p[0], EPOLLIN | EPOLLET, 1);
    wr(p[1], 5);
    printf("    read(100) = %zd (before any epoll_wait)\n", rd(p[0], 100));
    w(ep, "wait after the data was already consumed");
    close(p[0]); close(p[1]); close(ep);
}

/* T6: EPOLL_CTL_MOD on a still-readable fd re-reports it. */
static void t6(void) {
    printf("\n[T6-ET] EPOLL_CTL_MOD with the same mask while data is unread\n");
    int p[2]; if (pipe(p)) die("pipe"); nb(p[0]);
    int ep = epoll_create1(0);
    ctl(ep, EPOLL_CTL_ADD, p[0], EPOLLIN | EPOLLET, 1);
    wr(p[1], 10);
    w(ep, "after write");
    w(ep, "no new write");
    ctl(ep, EPOLL_CTL_MOD, p[0], EPOLLIN | EPOLLET, 1);
    w(ep, "after EPOLL_CTL_MOD (same mask)");
    w(ep, "again");
    close(p[0]); close(p[1]); close(ep);
}

/* T7: EPOLLONESHOT. */
static void t7(void) {
    printf("\n[T7-ET] EPOLLET|EPOLLONESHOT\n");
    int p[2]; if (pipe(p)) die("pipe"); nb(p[0]);
    int ep = epoll_create1(0);
    ctl(ep, EPOLL_CTL_ADD, p[0], EPOLLIN | EPOLLET | EPOLLONESHOT, 1);
    wr(p[1], 1);
    w(ep, "after 1st write");
    wr(p[1], 1);
    w(ep, "after 2nd write (no re-arm yet)");
    ctl(ep, EPOLL_CTL_MOD, p[0], EPOLLIN | EPOLLET | EPOLLONESHOT, 1);
    w(ep, "after EPOLL_CTL_MOD re-arm");
    close(p[0]); close(p[1]); close(ep);
}

/* T8: EPOLLOUT edges: fill until EAGAIN, then read in steps. */
static void t8_one(const char *kind, int wfd, int rfd, size_t step) {
    printf("\n[T8-ET] %s: EPOLLOUT edge after the writer hits EAGAIN\n", kind);
    nb(wfd); nb(rfd);
    int ep = epoll_create1(0);
    ctl(ep, EPOLL_CTL_ADD, wfd, EPOLLOUT | EPOLLET, 2);
    w(ep, "right after ADD (empty buffer)");
    w(ep, "again");
    char buf[4096]; memset(buf, 'y', sizeof buf);
    size_t total = 0; ssize_t r;
    while ((r = write(wfd, buf, sizeof buf)) > 0) total += r;
    printf("    wrote %zu bytes before write() failed with %s\n", total, strerror(errno));
    w(ep, "buffer full");
    size_t readsofar = 0;
    while (readsofar < total) {
        ssize_t got = rd(rfd, step);
        if (got <= 0) break;
        readsofar += got;
        usleep(2000);
        char label[96];
        snprintf(label, sizeof label, "reader consumed %zu of %zu bytes", readsofar, total);
        struct epoll_event ev[2];
        int n = epoll_wait(ep, ev, 2, 0);
        if (n > 0) { printf("    %-58s -> %d event(s) [%s]  <- first EPOLLOUT edge\n", label, n, mask(ev[0].events)); break; }
    }
    if (readsofar >= total) printf("    no EPOLLOUT edge before the buffer was empty\n");
    close(ep);
}
static void t8(void) {
    int p[2]; if (pipe(p)) die("pipe");
    printf("\n[T8-ET] pipe, 1-byte read first\n");
    {
        nb(p[1]); nb(p[0]);
        int ep = epoll_create1(0);
        ctl(ep, EPOLL_CTL_ADD, p[1], EPOLLOUT | EPOLLET, 2);
        w(ep, "right after ADD");
        char buf[4096]; memset(buf, 'y', sizeof buf);
        size_t total = 0; ssize_t r;
        while ((r = write(p[1], buf, sizeof buf)) > 0) total += r;
        printf("    wrote %zu bytes before EAGAIN\n", total);
        w(ep, "pipe full");
        printf("    read(1) = %zd\n", rd(p[0], 1));
        w(ep, "after reading 1 byte");
        printf("    read(4095) = %zd\n", rd(p[0], 4095));
        w(ep, "after reading 4096 bytes in total (one page)");
        close(ep);
    }
    close(p[0]); close(p[1]);
    if (pipe(p)) die("pipe");
    t8_one("pipe, reads of 1024 bytes", p[1], p[0], 1024); close(p[0]); close(p[1]);
    int s[2]; if (socketpair(AF_UNIX, SOCK_STREAM, 0, s)) die("socketpair");
    t8_one("AF_UNIX stream socketpair, reads of 4096 bytes", s[0], s[1], 4096); close(s[0]); close(s[1]);
}

/* T9: peer shutdown / EOF. */
static void t9(uint32_t trig) {
    printf("\n[T9-%s] AF_UNIX socketpair, peer writes 3 bytes then shutdown(SHUT_WR)\n", trigname(trig));
    int s[2]; if (socketpair(AF_UNIX, SOCK_STREAM, 0, s)) die("socketpair"); nb(s[0]);
    int ep = epoll_create1(0);
    ctl(ep, EPOLL_CTL_ADD, s[0], EPOLLIN | EPOLLRDHUP | trig, 1);
    wr(s[1], 3); shutdown(s[1], SHUT_WR);
    w(ep, "after write + shutdown");
    w(ep, "again, nothing read yet");
    printf("    read(100) = %zd\n", rd(s[0], 100));
    printf("    read(100) = %zd (0 means end of file)\n", rd(s[0], 100));
    w(ep, "after reading to end of file");
    close(s[0]); close(s[1]); close(ep);
}

/* T10: several threads in epoll_wait on ONE epoll instance. */
struct tharg { int ep; int got; };
static void *waiter(void *v) {
    struct tharg *a = v; struct epoll_event ev;
    a->got = epoll_wait(a->ep, &ev, 1, 400);
    return NULL;
}
static void t10(uint32_t trig) {
    enum { N = 4 };
    printf("\n[T10-%s] %d threads blocked in epoll_wait on one epoll fd, one 1-byte write, nobody reads\n", trigname(trig), N);
    int p[2]; if (pipe(p)) die("pipe"); nb(p[0]);
    int ep = epoll_create1(0);
    ctl(ep, EPOLL_CTL_ADD, p[0], EPOLLIN | trig, 1);
    pthread_t t[N]; struct tharg a[N];
    for (int i = 0; i < N; i++) { a[i].ep = ep; a[i].got = -2; pthread_create(&t[i], NULL, waiter, &a[i]); }
    usleep(100000);
    wr(p[1], 1);
    int woke = 0;
    for (int i = 0; i < N; i++) { pthread_join(t[i], NULL); if (a[i].got > 0) woke++; }
    printf("    threads that returned with an event: %d of %d\n", woke, N);
    close(p[0]); close(p[1]); close(ep);
}

/* T11: several epoll instances watching the same fd, with and without EPOLLEXCLUSIVE. */
static void t11(uint32_t extra, const char *name) {
    enum { N = 4 };
    printf("\n[T11] %d epoll instances (one per thread) watch the same pipe, mask EPOLLIN|EPOLLET%s\n", N, name);
    int p[2]; if (pipe(p)) die("pipe"); nb(p[0]);
    pthread_t t[N]; struct tharg a[N];
    for (int i = 0; i < N; i++) {
        a[i].ep = epoll_create1(0); a[i].got = -2;
        ctl(a[i].ep, EPOLL_CTL_ADD, p[0], EPOLLIN | EPOLLET | extra, 1);
        pthread_create(&t[i], NULL, waiter, &a[i]);
    }
    usleep(100000);
    wr(p[1], 1);
    int woke = 0;
    for (int i = 0; i < N; i++) { pthread_join(t[i], NULL); if (a[i].got > 0) woke++; close(a[i].ep); }
    printf("    instances that returned with an event: %d of %d\n", woke, N);
    close(p[0]); close(p[1]);
}

/* T12: more ready fds than maxevents. */
static void t12(void) {
    printf("\n[T12-ET] three ready pipes, epoll_wait(maxevents=1) four times\n");
    int ep = epoll_create1(0); int p[3][2];
    for (int i = 0; i < 3; i++) { if (pipe(p[i])) die("pipe"); nb(p[i][0]); ctl(ep, EPOLL_CTL_ADD, p[i][0], EPOLLIN | EPOLLET, 10 + i); }
    for (int i = 0; i < 3; i++) wr(p[i][1], 1);
    for (int k = 1; k <= 4; k++) { char l[32]; snprintf(l, sizeof l, "call %d", k); waitmax(ep, 1, l); }
    for (int i = 0; i < 3; i++) { close(p[i][0]); close(p[i][1]); }
    close(ep);
}

/* T13: registration follows the open file description, not the fd number. */
static void t13(void) {
    printf("\n[T13-ET] register fd A, dup it to B, close A, then write\n");
    int p[2]; if (pipe(p)) die("pipe"); nb(p[0]);
    int ep = epoll_create1(0);
    ctl(ep, EPOLL_CTL_ADD, p[0], EPOLLIN | EPOLLET, 100);
    int b = dup(p[0]); int a = p[0];
    close(a);
    wr(p[1], 1);
    w(ep, "after write (A is closed, B still open)");
    struct epoll_event e = { 0 };
    int r = epoll_ctl(ep, EPOLL_CTL_DEL, a, &e);
    printf("    EPOLL_CTL_DEL on closed A -> %d (%s)\n", r, r ? strerror(errno) : "ok");
    r = epoll_ctl(ep, EPOLL_CTL_DEL, b, &e);
    printf("    EPOLL_CTL_DEL on B        -> %d (%s)\n", r, r ? strerror(errno) : "ok");
    if (dup2(b, a) != a) die("dup2");
    r = epoll_ctl(ep, EPOLL_CTL_DEL, a, &e);
    printf("    dup2(B, A), then DEL on A -> %d (%s)\n", r, r ? strerror(errno) : "ok");
    wr(p[1], 1);
    w(ep, "write after that DEL");
    close(a); close(b); close(p[1]); close(ep);
}

/* T14: one registration for both directions (the Go netpoller style). */
static void t14(void) {
    printf("\n[T14-ET] AF_UNIX socketpair registered once with EPOLLIN|EPOLLOUT|EPOLLRDHUP|EPOLLET\n");
    int s[2]; if (socketpair(AF_UNIX, SOCK_STREAM, 0, s)) die("socketpair"); nb(s[0]);
    int ep = epoll_create1(0);
    ctl(ep, EPOLL_CTL_ADD, s[0], EPOLLIN | EPOLLOUT | EPOLLRDHUP | EPOLLET, 1);
    w(ep, "right after ADD");
    w(ep, "again");
    wr(s[1], 1); usleep(20000);
    w(ep, "peer wrote 1 byte (a read-side wakeup only)");
    close(s[0]); close(s[1]); close(ep);
}

int main(void) {
    struct utsname u; uname(&u);
    printf("kernel: %s %s %s\n", u.sysname, u.release, u.machine);
    t1(EPOLLET); t1(0);
    t2(); t3(); t4(); t5(); t6(); t7(); t8();
    t9(EPOLLET); t9(0);
    t10(EPOLLET); t10(0);
    t11(0, ""); t11(EPOLLEXCLUSIVE, "|EPOLLEXCLUSIVE");
    t12(); t13(); t14();
    return 0;
}
