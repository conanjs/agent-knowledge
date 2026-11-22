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
  int et = threads_woken(EPOLLET);
  int lt = threads_woken(0);
  printf("threads that got the event: ET %d, LT %d\n", et, lt);
  return 0;
}
