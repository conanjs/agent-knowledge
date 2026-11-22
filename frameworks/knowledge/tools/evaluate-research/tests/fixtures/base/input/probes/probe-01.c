#include <stdio.h>
int main(void) {
  for (int i = 0; i < 4; i++) { if (drain_once(fd) < 0) break; }
  puts("events: 1 of 4");
}
