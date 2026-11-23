#include <stdio.h>
#include <stdint.h>

/* a counts as older than b when the 32-bit difference a - b, read as signed, is negative */
static int older(uint32_t a, uint32_t b) { return (int32_t) (a - b) < 0; }

int main(void) {
    uint32_t row = 100u;  /* a row's insertion XID */
    printf("after 2.0e9: %s\n", older(row, row + 2000000000u) ? "past" : "future");
    printf("after 2.2e9: %s\n", older(row, row + 2200000000u) ? "past" : "future");
    printf("4294967000 vs 100: %s\n", older(4294967000u, 100u) ? "older" : "newer");
    return 0;
}
