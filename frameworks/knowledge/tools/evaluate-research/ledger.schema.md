# Ledger: what a research worker hands to the orchestrator

A research run's `ledger/<profile>.json`, one file per worker profile (research-agent design §1.3 step 3, §1.4). The worker writes it; the orchestrator reads it to merge the sources and to find the passages it must read before it writes. `evaluate-research.mjs ledger <run>` checks it with no tokens.

A worker never writes doc text (V's rule, design §0): a fact is a short summary in the worker's own words plus the exact quote that backs it and where the quote sits in the saved page, so the orchestrator can go and read the passage.

## Fields

```json
{
  "profile": "ground-truth",
  "question": "How does epoll's edge-triggered mode report readiness?",
  "terms": ["EPOLLET", "edge-triggered", "ready list"],
  "sources": [
    { "id": "S1", "url": "https://man7.org/linux/man-pages/man7/epoll.7.html", "cache": "cache/c225d5946a26.txt",
      "fetched": "2026-11-22T10:00:00Z", "tier": "A", "rank": 1, "rule": "man7.org/linux/man-pages/",
      "rank_basis": "tier A: man7.org/linux/man-pages/", "seed": false, "provenance_ref": null }
  ],
  "facts": [
    { "id": "F1", "source": "S1", "summary": "In edge-triggered mode an event comes only when the fd changes, such as when new data arrives.",
      "quote": "an event will be generated upon each receipt of a chunk of data",
      "loc": { "heading": "Level-triggered and edge-triggered", "lines": [97, 98] } }
  ],
  "conflicts": [ { "id": "X1", "topic": "one event per write?", "facts": ["F1", "F2"], "note": "epoll(7) against a kernel commit" } ]
}
```

The example is cut to one source and one fact (F2 is not shown). Its quote and lines are those of epoll(7) as `fetch-source.mjs` saved it on 2026-11-22.

Every rule below is checked by `evaluate-research.mjs ledger`; an **error** fails the ledger (exit 1), a **warn** is for the orchestrator to weigh.

| Field | Rule |
|---|---|
| any | Only the keys shown above. Any other key is an error: a drafted section has no place in a ledger |
| `profile` | One of `taxonomy`, `ground-truth`, `practitioner`, `pitfall`, and the same as the file name |
| `sources[]` | At most the cap (`--cap`, 4 by default; the orchestrator passes another when `plan.md` sets one), not counting `seed: true` sources (V's `seed_sources`, design §1.5) |
| `url`, `cache`, `fetched` | Copied from the page's entry in `sources.json`, which `fetch-source.mjs` wrote (status 200). The cache file still has the SHA-256 it was saved with, so a page edited after fetching is an error |
| `tier`, `rank`, `rule` | From `classify-source.mjs`: a tier A source carries the rule's rank and rule. A tier B source has the worker's rank, 1 to 6 (the tier B guide of design §2.1), and `rule: null` |
| `provenance_ref` | The cache file of a page that shows the author's role, for a tier B source rated by the originator or maintainer rule (design §2.1); saved and listed like any source. A tier B Rank 1 or 4 without one is a warn |
| `facts[]` | `source` names a source of this ledger. `summary` is one or two sentences in the worker's words (a warn past 300 characters). `quote` is copied from the saved page, at least 12 characters (a `…` may join two parts, each checked) |
| `loc` | `lines` is `[first, last]` in the cache file as the Read tool numbers it (header included), at most 20 lines, and the quote lies within them give or take 2 lines, after the same normalizing as the judge's quote check. `heading` is the page's heading above the quote (a warn when it is not found above `first`) |
| `conflicts[]` | Names at least 2 facts, all of this ledger |
