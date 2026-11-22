#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/epoll.h>

int main(void) {
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
