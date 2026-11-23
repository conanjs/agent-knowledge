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
