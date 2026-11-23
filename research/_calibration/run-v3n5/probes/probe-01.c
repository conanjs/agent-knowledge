#include <stdio.h>
#include <stdint.h>

int main(void) {
    /* Assumption: MaxTransactionId is the 32-bit maximum (its definition is not in this doc's sources). */
    const uint32_t MaxTransactionId = 0xFFFFFFFFu;
    const uint32_t oldest_datfrozenxid = 1000u;  /* any normal XID */
    uint32_t xidWrapLimit = oldest_datfrozenxid + (MaxTransactionId >> 1); /* varsup.c */
    uint32_t xidStopLimit = xidWrapLimit - 3000000u;                       /* varsup.c */
    uint32_t xidWarnLimit = xidWrapLimit - 100000000u;                     /* varsup.c */
    printf("warn_age=%u stop_age=%u wrap_age=%u\n",
           xidWarnLimit - oldest_datfrozenxid, xidStopLimit - oldest_datfrozenxid,
           xidWrapLimit - oldest_datfrozenxid);
    uint32_t left = 99985967u;                   /* the manual's sample warning */
    printf("left=%u pct=%.2f%%\n", left, (double) left / (MaxTransactionId / 2) * 100);
    return 0;
}
