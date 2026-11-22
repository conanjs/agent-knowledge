#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/epoll.h>

int main(void) {
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
