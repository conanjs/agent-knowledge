#include <stdio.h>
#include <sys/utsname.h>

/* Prints the kernel release, machine and compiler this probe ran on. */
static void print_env(void) {
  struct utsname u;
  uname(&u);
  printf("kernel %s, %s, gcc %s\n", u.release, u.machine, __VERSION__);
}
#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/epoll.h>

/* Returns how many events the second epoll_wait reports after a partial read. */
static int second_wait(unsigned extra) {
  int p[2]; char buf[2048]; struct epoll_event ev = {0}, out;
  pipe(p); fcntl(p[0], F_SETFL, O_NONBLOCK);
  int ep = epoll_create1(0);
  ev.events = EPOLLIN | extra; ev.data.fd = p[0];
  epoll_ctl(ep, EPOLL_CTL_ADD, p[0], &ev);
  memset(buf, 'x', sizeof buf);
  write(p[1], buf, 2048);               /* step 2: 2 kB written */
  epoll_wait(ep, &out, 1, 100);         /* step 3: reported */
  read(p[0], buf, 1024);                /* step 4: 1 kB read, 1 kB left */
  return epoll_wait(ep, &out, 1, 100);  /* step 5: 100 ms timeout */
}

int main(void) {
  print_env();
  printf("ET second wait: %d, LT second wait: %d\n", second_wait(EPOLLET), second_wait(0));
  return 0;
}
