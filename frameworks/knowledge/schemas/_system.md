---
schema: schema-system/v1
last-updated: 2026-11-22
---

# Knowledge Framework: Schema System

The meta-schema: a header line, Front-matter, Required structure, Rules, Example, Checks. This file adds what is specific to the knowledge base.

## 1. Shared front-matter

Every file in `knowledge/` (at the root of this repo) starts with:

```yaml
---
schema: knowledge-doc/v1 | deep-dive/v1 | topic-index/v1
last-updated: YYYY-MM-DD
---
```

Only the keys listed in each schema's Front-matter table are allowed; any other key (e.g. `revision:`) fails `KB-10` in `validate-knowledge.mjs`. To track something new, add the key to the schema first.

## 2. Shared sections

Every file ends with these, in this order:

| Section | Content | Empty form |
|---|---|---|
| `## References` | External sources (URL, title, what it backs) **and** local artifacts cited | Not allowed: at least one entry |
| `## Related` | Other knowledge docs or topics to read next | `- _None yet._` |

### Reference entry format

```markdown
- [<Title>](<url>) — <publisher/author>, <year or "living">. Backs: <section or claim>.
- `<local path>` — <what it is>.
```

Example:

```markdown
- [Fast properties in V8](https://v8.dev/blog/fast-properties) — V8 team, 2017. Backs: How it works §2.
```

In a doc with `ranked-sources: true` (§4.1), every external entry also gives its source rank, between the year and "Backs:", and the entries are ordered by rank, 1 first:

```markdown
- [RFC 9113: HTTP/2](https://www.rfc-editor.org/rfc/rfc9113) — IETF, 2022. Rank 1. Backs: How it works §2. [^1]
- [Fast properties in V8](https://v8.dev/blog/fast-properties) — V8 team, 2017. Rank 4. Backs: How it works §3. [^2]
```

## 3. Claim marking

Inline markers, used in any body section:

| Marker | Meaning |
|---|---|
| `✅` + footnote or link | Verified against the cited source on `last-verified` |
| `⚠️ unverified` | General knowledge, not checked. A hypothesis. |

The **Verification status** section (knowledge-doc) counts these.

## 4. Content rules

| Id | Rule | Enforced by |
|---|---|---|
| KB-1 | Own words; quotes ≤ 2 sentences, cited | llm |
| KB-2 | No company names, hosts or secrets (the knowledge base is company-neutral) | llm |
| KB-3 | Every external URL resolves (HTTP < 400) at `last-verified` | script |
| KB-4 | Retired. A doc needs no `Used by` section; a leftover `Used by` section or table is ignored, not checked | none |
| KB-5 | One type per doc | llm |
| KB-6 | Technical/abstract terms get an analogy + one concrete artifact (global instruction) | llm |
| KB-7 | **Stands alone.** The doc reads correctly without the conversation it was drafted in: no answer to a question the doc never states, no "as discussed", "you asked", "in my previous answer", no sentence that only makes sense as a reply to someone. Applies with extra care to text drafted in another AI chat and pasted in | script (heuristic warn) + llm |
| KB-8 | **One canonical copy.** A diagram, code block, table or paragraph that already exists in another doc is linked, not copied; a doc does not repeat its own paragraphs. A short summary next to the link is fine | script (identical 5+-line blocks, repeated paragraphs: warn) + llm |
| KB-9 | **Front-matter values are valid.** Every required key is present; `status` is `draft`, `verified` or `stale`; `applies-to` is a list; dates are `YYYY-MM-DD`; `topic` equals the doc's folder; a knowledge doc's `type` is one of its schema's types; a verified deep dive has `last-verified` (for a knowledge doc that case is KD-2) | script |
| KB-10 | **Only defined front-matter keys.** A key not listed in the schema's Front-matter table fails; to track something new, add the key to the schema first | script |
| KB-11 | **Title and Summary head.** Every v1 file has a `# Title` line. Knowledge docs and deep dives open with `## Summary` holding `**TL;DR:**` and `**Use this when:**` (a deep dive also has `**Depth:**`, DD-1) | script |
| KB-12 | **References and Related are real.** `## References` has at least one entry, `## Related` has at least one entry (`- _None yet._` when empty), and every footnote used in the body (`[^n]`) has a References entry carrying it | script |
| KB-13 | **Revisions do not erase.** When a doc is revised, the old and new versions are compared unit by unit (section, table row, paragraph, claim); every removed unit has a stated reason: wrong, unverifiable, or a true duplicate now linked. A rewrite that drops correct content without a reason fails | llm |
| KB-14 | **Ranked references.** With `ranked-sources: true`, every external References entry has `Rank <1–6>.`, the entries are ordered by rank (1 first), and a URL that a rule in `tools/classify-source/source-ranks.json` covers carries that rule's rank (§4.1) | script |
| KB-15 | **Rank quarantine.** With `ranked-sources: true`, a footnote cited in a section points to a rank that section allows (§4.1 map); in a section that allows only Rank 1–5 or stricter, every ✅ carries a footnote; every body section has a rank role. A Rank 6 source in a worked example only warns | script |
| KB-16 | **No orphan sources.** With `ranked-sources: true`, every References entry that carries a footnote is cited at least once in the body (the reverse of KB-12) | script (warn) |
| KB-17 | **Conflicts are arbitrated, not hidden.** When sources disagree, the claim from the lower rank number governs the sections that allow Rank 1–5 or stricter. The other claim is kept under the pitfalls section (Edge cases, Trade-offs, Troubleshooting, Lookup notes, or a deep dive's `## 6.`) with its source, its rank and why it is wrong or when it holds. On a tie (two sources of the same rank), a Rank 1 source settles it; with none, both claims go under the pitfalls section as an open conflict marked `⚠️ unverified` | llm (judge) |

### 4.1 Source ranks

A doc opts in with `ranked-sources: true` in its front-matter; KB-14 to KB-16 then apply. Existing docs are not retrofitted (§6).

**Ranks** are about who published a source (provenance), not how well it is written:

| Rank | Class | Examples |
|---|---|---|
| 1 | Specs, official docs, the project's own source code, the originator's own publication of a concept | RFCs, `tc39.es`, `man7.org`, `docs.python.org`, a project's own repository |
| 2 | Peer-reviewed papers, preprints, official datasets and benchmarks | arXiv, ACM, IEEE, USENIX |
| 3 | Authoritative secondary: textbooks, curated references | MDN Web Docs (`developer.mozilla.org/en-US/docs/`), `javascript.info` |
| 4 | Vetted engineering literature | Company and project engineering blogs (the V8 blog, Cloudflare), official post-mortems |
| 5 | Tertiary overviews | Wikipedia |
| 6 | Community and unvetted | Stack Overflow, Reddit, Medium, personal blogs, GitHub issues, pull requests and discussions |

**Rules.** `tools/classify-source/source-ranks.json` holds the rules, each a host plus a path prefix, and `classify-source.mjs` applies them. The rule with the most path segments wins, so `github.com/microsoft/typescript/` gives the TypeScript source Rank 1, while `github.com/*/*/issues/` gives any issue Rank 6. A URL that no rule covers is tier B: the writer picks its rank (the higher number when two fit), and the judge re-rates it. A rule is added only on V's yes, and only for a host and prefix that one publisher owns (one book, one organization's blog): a host where many people post, such as a mailing-list archive, never gets one, because its paths do not show who wrote a page.

**Tier B rating guide** (decided by V, 2026-11-22): a post by a project's maintainer on that project's official mailing list is Rank 4, but only when the page itself shows the author's role (the project's lead, or a `Signed-off-by:` line of a maintainer); otherwise it is Rank 6.

**Section map** (KB-15): the ranks each `##` section may cite. A `###` heading inherits its section's role. The research agent writes deep dives with the six numbered headings; a ranked deep dive with any other body heading fails KB-15.

| Role | Deep-dive heading | knowledge-doc headings | Allowed ranks |
|---|---|---|---|
| Mental model | `## 1. Mental model`, `## 2. Concept architecture` | Summary, Problem, Mental model, Takeaways; reference Scope; how-to Goal & prerequisites; case-study Context, Generalized lesson | 1–5 |
| Mechanism | `## 3. How it works` | How it works; how-to Steps, Verify, Rollback; case-study Root cause, Fix | 1–4 |
| Worked examples | `## 4. Worked examples` | Worked example, Case studies; case-study Symptom, Timeline | 1–5 (Rank 6 warns) |
| Reference | `## 5. Reference & invariants` | reference Catalog | 1–4 |
| Pitfalls | `## 6. Trade-offs, pitfalls & misconceptions` | Edge cases, Trade-offs, Troubleshooting, Lookup notes | 1–6 |
| Envelope | `## References`, `## Related` | References, Related, Verification status, Used by | not checked |

## 5. Registry

| Schema | File | Applies to |
|---|---|---|
| `knowledge-doc/v1` | `knowledge-doc.schema.md` | `knowledge/<topic>/[<sub>/]<slug>.md`: structured, typed docs |
| `deep-dive/v1` | `deep-dive.schema.md` | `knowledge/<topic>/[<sub>/]<slug>.md`: free-form deep dives (envelope only), synthesized into knowledge-docs |
| `topic-index/v1` | `topic-index.schema.md` | `knowledge/index.md`, `knowledge/<topic>/[<sub>/]index.md` |

### 5.1 Structured vs. deep dive

| Question | Structured (`knowledge-doc/v1`) | Deep dive (`deep-dive/v1`) |
|---|---|---|
| Shape | fixed sections per type | free body; only the envelope is fixed |
| Size | small, one type per doc | as long as the subject needs |
| Who cites it | rules (`Source:`), Reference topics, `refs:` | humans; `refs:` when the whole story is needed |
| How they connect | `derived-from:` → the deep dive | `synthesized-into:` → the derived docs |

Write a deep dive when the subject's depth would break a type template (many actors, cross-side interactions, long matrices). Then **synthesize** it (`deep-dive.schema.md` §Synthesis) so that rules have small, typed docs to cite.

## 6. Legacy docs (no retrofit)

The schemas apply to **new docs only**. Existing docs stay as they are.

| | New doc | Legacy doc |
|---|---|---|
| How it is recognized | Front-matter `schema: knowledge-doc/v1`, `deep-dive/v1` or `topic-index/v1` | No such `schema:` key. It may still have other front-matter, e.g. `title:` |
| Must follow the schema | yes | **no**: never retrofitted, split or renamed for compliance |
| When edited | Keeps complying | Keeps its own existing shape; normal content edits are fine |
| Checked by `validate-knowledge.mjs` | yes | skipped |
| May be cited by a rule's `Source:` or a task's `refs:` | yes | yes |
| `Used by` section (retired, KB-4) | not required; a leftover is ignored | not required |
| Listed in a topic `index.md` | required | optional, with Type `legacy` |
| May be a **synthesis source** (`deep-dive.schema.md`) | yes, if `deep-dive/v1` | yes: the derived doc records `derived-from:`, and the legacy doc itself is not edited |

**Example:**
- `grpc/stale-connection-keepalive.md` (concept + case study in one file, no `schema:`) stays exactly as it is.
- A new `grpc/keepalive-options.md` written next to it must be a `knowledge-doc/v1` `reference` doc. The folder then gets a `topic-index/v1` `index.md` listing the new doc, and optionally the legacy one as `legacy`.

**Converting** a legacy doc is never required. If someone rewrites one from scratch anyway, the result is a new doc and must comply in full; no half-converted docs.

## References

- [Diátaxis](https://diataxis.fr/) — Daniele Procida, living. Backs: type split.
- The company-kb framework's `schemas/_system.md` (agent-companies repo): the schema-system style this one follows. This framework deliberately does **not** copy its retrofit rule (§6).

## Related

- `knowledge-doc.schema.md`, `deep-dive.schema.md`, `topic-index.schema.md`
