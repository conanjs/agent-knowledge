---
schema: deep-dive/v1
topic: demo
status: verified
applies-to: ["widgets >= 2.0"]
last-updated: 2026-11-21
last-verified: 2026-11-21
synthesized-into: []
---

# Widget limits

## Summary
**TL;DR:** A widget holds 64 items; the next one throws.
**Use this when:** sizing a widget.
**Depth:** the limit and what happens past it.

## The limit
A widget holds at most 64 items ✅ (Q1-C1). Adding a 65th item throws a `RangeError` ✅ (Q2-C1).

Older releases may have allowed more ⚠️ unverified (Q2-C2).

## References
- `research/demo/widget-limits/` — research run: plan, sources, claims, experiments, verification.

## Related
- _None yet._
