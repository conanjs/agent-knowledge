#include <stdio.h>
#include <errno.h>
#include <string.h>
#include <unistd.h>
#include <sys/epoll.h>

int main(void) {
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
