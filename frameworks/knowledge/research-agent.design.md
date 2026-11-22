---
last-updated: 2026-11-22
status: proposal (not built, not committed)
---

# Research agent for the knowledge base: design proposal

> **Plain English:** today an agent that researches a topic searches the web like a person with no librarian: it takes what the search engine ranks first, writes the doc, and ticks its own claims ✅. This design adds the librarian (a **source rank** on every reference), a **separate checker** that re-reads the cited pages before a ✅ counts (the *verifier*, also called the LLM-as-a-judge Evaluator), and a **test set** that tells us whether the whole thing beats a plain prompt.

**Built from:** the seven spec files of the "Research Agent Architecture" conversation (foundation, technical spec, retrieval routing, LLM-as-a-judge evaluator, golden dataset in Markdown and JSON, the full conversation), compared with `schemas/_system.md`, `knowledge-doc.schema.md`, `deep-dive.schema.md`, `tools/validate-knowledge/`, and the reverted research workflow (commit `36d4ce2`, reverted in `b32f789`).

## 0. What exists today, and what does not

| Piece the specs need | Exists? | Where / why not |
|---|---|---|
| Web search and page fetch | Yes, as raw tools | Each coding agent's own `WebSearch` / `WebFetch`, `gh api`. No routing: nothing tells an agent which domains to search, or ranks results |
| Source rank 1–6 | **No** | References carry publisher, year and "Backs:", but no rank (`_system.md` §2) |
| Rank-aware conflict rule | **No** | Only "prefer free, official sources" (`index.md` §6 rule 3) |
| Saved copy of each source page | **No** | Nothing to re-check a quote against later |
| Structure and citation checks by script | Partly | `validate-knowledge.mjs`: headings (KD-1), Summary (KB-11), URLs resolve (KB-3), footnote → References in one direction only (KB-12) |
| Independent claim checker | **No** | `review-knowledge-doc` is run by the same agent that wrote the doc; ✅ is the writer's own check |
| Test set for output quality | **No** | The 112 Cucumber scenarios test the *tools*, not the docs agents write |
| Doc lifecycle (draft → verified → stale) | **Yes, better than the specs** | `status`, `last-verified`, `applies-to`, KB-13 (revisions do not erase) |

**Why the last attempt was reverted, and what this design changes.** The reverted workflow (`36d4ce2`) had cheap researcher agents (Claude Haiku) that wrote atomic claims to YAML files, and the writer had to build the doc from those claims. It had 15 run rules and 10 steps. In a review it did *worse than a plain prompt*, so V reverted it.

**Why it lost** (confirmed by V, 2026-11-22):
- Cheap models (Claude Haiku) cut the knowledge into separate YAML claims, so the writer lost the whole picture and the narrative came out in broken pieces.
- The process (10 steps, 15 run rules) cost more coordination than it gave back.

Three more causes, from the reverted commit itself:
- **Checked in two hops.** Its verifier checked each claim against the page, then each ✅ sentence against its claim (step 8, `entailment.yaml`). A sentence was never compared with the page itself, so a worker's misreading passed both hops. This design's judge compares each sentence with the saved page text (§3.1).
- **Never run before it was judged.** Its own status section said "Next: one real run on a small topic with a known answer" and "No measurement exists yet". The first real run (the MCP topic) was the review, with no plain-prompt baseline beside it.
- **The orchestrator had to be a skill**, because it assumed a subagent cannot start subagents. That assumption no longer holds (§1.1).

**Core rule for Phase 3** (decided by V, 2026-11-22): a worker only finds sources, ranks them, saves them and sums up the key points with citations; the orchestrator reads the relevant passages of the sources itself and writes the narrative.

This design changes three things:

1. **The writer reads the sources and writes the narrative.** Workers find, rank and save sources and flag conflicts. They do not dictate the doc sentence by sentence.
2. **The plain prompt is the baseline to beat.** Nothing is adopted until it beats a plain prompt on the same topics, scored by the same judge (§6, Phase 4).
3. **The verifier comes first.** It improves plain-prompt docs too, so it pays off even if the full agent never ships.

## 1. Architecture

### 1.1 Actors (7)

- **V**: approves the plan and the commit, in chat.
- **Orchestrator** (the Supervisor in the specs): plans, dispatches, arbitrates and writes the doc. It is the `research-orchestrator` agent, on a strong model, built like the other agents (body plus one header per coding agent, composed by agent-config's `build-agents`). Its Claude header allows only `Agent(research-worker, knowledge-judge)` as subagents.
- **Worker** (one agent body, 4 profiles): searches, ranks, fetches and extracts for one profile. It is the `research-worker` agent, started as a subagent.
- **Rank classifier**: gives each URL a rank 1–6, via `classify-source.mjs` (deterministic rules, `tier: A`) or, for URLs no rule covers, the worker's judgment marked `tier: B`. A worker unsure between two ranks picks the higher number (the less authoritative one), so an unknown source never reaches a core section by default. The judge re-rates every `tier: B` source (§3.3).
- **Fetcher**: saves the page text, via `fetch-source.mjs` (HTML to text) or `gh api` (GitHub issues and code at a tag).
- **Stage 1 checker**: checks structure, citations and ranks, via `validate-knowledge.mjs` with the new rules KB-14 to KB-16.
- **Judge** (the Stage 2 LLM-as-a-judge): checks every core claim against the saved page text, plus conflicts and structure. It is the `knowledge-judge` agent, in a fresh context on a strong model.

Why the orchestrator is an agent, not a skill plus a procedure (changed 2026-11-22). The first version of this design said a Claude Code subagent cannot start other subagents, so the orchestrator had to be a skill in the main session. The Claude Code docs for 2.1.330 say otherwise:
- a subagent can start its own (nested) subagents;
- an agent started with `claude --agent <name>` runs as the main thread and can start subagents;
- `tools: Agent(a, b)` limits which ones.

So the orchestrator can be an agent: started as the main thread (`claude --agent research-orchestrator`), or as a subagent that starts the workers and the judge as nested subagents. In both cases the judge still starts with a fresh context. A thin skill can stay as the trigger ("research X" starts the agent), but the steps live in the agent's body, one canonical copy. **Unconfirmed:** whether Codex CLI and Copilot support nested subagents or an agent as the main thread; their orchestrator headers wait for that (Phase 3).

### 1.2 Diagram

```
V ──prompt──► ORCHESTRATOR (research-orchestrator agent)
               │ 1 scope: grep knowledge/ for what is already known
               │ 2 plan.md (questions, out of scope, budget) ──► V approves
               │
               │ 3a taxonomy worker (first, alone) ──► canonical terms ──► orchestrator checks them
               │ 3b ground-truth ┐
               │    practitioner ├─ parallel workers, each:
               │    pitfall      ┘   WebSearch(profile domains) ═══ network ═══
               │                     → classify-source.mjs (rank, local)
               │                     → drop ranks outside profile
               │                     → fetch-source.mjs / gh api ═══ network ═══
               │                     → cache/<url-hash>.txt (local, skipped if present)
               │                     → ledger/<profile>.json (sources, key facts + quotes + location, conflicts)
               │ 4 arbitrate: merge ledgers, lower rank number wins core sections,
               │   loser goes to "Pitfalls & misconceptions"
               │ 5 write deep-dive/v1 doc (reads the cited cache passages, not only the ledger)
               ▼
        STAGE 1 (script, 0 tokens) ── FAIL ──┐
               │ PASS                        │
        JUDGE (fresh agent) ─ FAIL, round<2 ─┴─► ORCHESTRATOR patches only the named sections
               │ PASS                         (fresh judge every round)
               │ FAIL after 2 patch rounds ──► release as status: draft, failing claims ⚠️, known issues in Summary
               ▼
        status: verified ──► review-knowledge-doc ──► V commits
```

### 1.3 Steps (who does what, via which channel)

1. **Orchestrator (local):** searches `knowledge/` via `index.md` and grep, and keeps only the gaps. It writes `research/<topic>/<slug>/plan.md`, and V approves it in chat.
2. **Taxonomy worker:**
   - Searches via `WebSearch` with the taxonomy profile's domains (network).
   - Returns canonical terms and the boundaries of the subject, via `ledger/taxonomy.json`.
   - **Orchestrator (local), before step 3:** checks the terms against `knowledge/` and against the Rank 1 sources in the taxonomy ledger. Wrong terms here would send all three workers after the wrong thing, so the result of this check goes into the run report.
3. **Three workers in parallel**, each with only its profile, the terms and the question:
   - Searches via `WebSearch` (network).
   - Ranks each result via `classify-source.mjs` (local, no tokens), and drops ranks its profile does not allow.
   - Keeps at most the per-profile source cap set in `plan.md` (start: 4).
   - Fetches the rest via `fetch-source.mjs` or `gh api` (network), saving `cache/<url-hash>.txt` (local). `<url-hash>` is a shortened SHA-256 hash of the normalized URL, so two workers that find the same page share one file. The script writes to a temporary file and then renames it (an atomic write, so no one reads a half-written file), and skips the fetch when the file already exists.
   - Writes `ledger/<profile>.json`: sources with rank, tier and fetch date; key facts, each with an exact quote and its location in the cached page (heading and line range); and the conflicts it saw.
4. **Orchestrator (local):** merges the ledgers and arbitrates by rank. It writes the doc from the ledger and the cited passages of the cache, read by location rather than as whole files, which would flood its context. Its footnotes point to References entries that carry `Rank n`.
5. **Stage 1 (local script):** runs `validate-knowledge.mjs` and `evaluate-research.mjs`, and writes `verdicts/round-<n>.stage1.json`, which also lists every `tier: B` source.
6. **Judge (fresh subagent):** the orchestrator copies the judge's inputs (doc, ledger, cache, Stage 1 report) into `verdicts/round-<n>.input/` and points the judge only there. A subagent has its own context but shares the disk, so the plan and the orchestrator's notes stay out of its inputs by layout, not only by instruction. A judge with a Read tool could still open them on purpose; blocking a path for one subagent only is **unconfirmed**. It writes `verdicts/round-<n>.json`.
7. **Orchestrator:** on FAIL, patches only the sections listed in `patch_instructions`, then goes back to step 5. At most 2 patch rounds.
8. **Orchestrator → V:** reports the verdict, the scores and the open issues. V decides the commit.

### 1.4 Worker profiles (one body, four configurations)

The specs' "4 skills" are one shared prompt plus 4 profiles (technical spec §3.2), so they become **one agent with a profile argument**, not four agents.

| Profile | Feeds doc section | Allowed ranks | Search domains (start list; tune by measurement) |
|---|---|---|---|
| `taxonomy` | 1, 2 | 1, 3, 5 | Wikipedia, official docs overview pages, textbooks, `*.edu` |
| `ground-truth` | 3, 5 | 1, 2 | Specs (`rfc-editor.org`, `w3.org`, `tc39.es`, `whatwg.org`), official `docs.*`, source code at a tag, `arxiv.org`, `dl.acm.org` |
| `practitioner` | 4 | 1, 3, 4 | Vendor engineering blogs, official guides, conference talks by the maintainers |
| `pitfall` | 6 | 2, 4, 6 | GitHub issues, Stack Overflow, Hacker News, post-mortems |

**Model:** start the workers on the same tier as the orchestrator (Sonnet or better). Move them to a cheaper model only after Phase 4 shows that quality holds. The reverted design started cheap and lost.

### 1.5 Run options (decided by V, 2026-11-22)

| Option | Set in | Rules |
|---|---|---|
| `seed_sources` | `plan.md`: URLs V supplies | Exempt from the per-profile source cap, and from nothing else: each is still ranked (tier A or B), cached, held to KB-15 and re-rated by the judge. In a golden-set comparison (Phase 4) the list stays empty, or the same list goes to the plain-prompt baseline, so neither side gets sources the other lacks |
| Tier B list | Run report, step 8 | Every `tier: B` source with the rank the judge gave it. A `source-ranks.json` rule is proposed only for a host and prefix one publisher owns (§2.1), and added only on V's yes |
| `mode: full-verified` | `plan.md` (the default) | Steps 1–8 |
| `mode: research-only` | `plan.md` | Steps 1–5 only, with no judge: a judge run cost about 240k tokens per doc in Phase 0. Output: the draft doc, `cache/`, `ledger/`, `probes/` and the Stage 1 report, all kept in `research/`, never in `knowledge/`. The doc has `status: draft` and a note in its Summary that its ✅ marks are the writer's own checks, as the MCP deep dive has. `sources.json` records each page's fetch date and the SHA-256 of its saved text, so a later verification spots pages that changed. `cache/` is gitignored, so on another machine or after a clean-up the pages are fetched again and compared |

## 2. Source rank: the schema addition

### 2.1 The ranks

These are the specs' 6 ranks (foundation §1), with four refinements for a software knowledge base:

| Rank | Class | Examples | Refinement vs. the specs |
|---|---|---|---|
| 1 | Canonical specs, official docs, source code at a tag, the originator's own publication of a concept | RFCs, `tc39.es`, `docs.kernel.org`, `man7.org` (the man-pages project), `kubernetes.io/docs`, `github.com/<org>/<repo>/blob/<tag>/…`, martinfowler.com for a term he coined | **Source code at a tag** and **the originator of a term** added; the specs have neither |
| 2 | Peer-reviewed papers, preprints, official datasets, benchmarks | arXiv, ACM, IEEE | — |
| 3 | Authoritative secondary: textbooks, curated references | O'Reilly, university courseware, MDN Web Docs (`developer.mozilla.org/en-US/docs/`), `javascript.info` | **Decided by V, 2026-11-22.** The specs put MDN at 5, which would bar it from How it works. MDN content is reviewed before it is merged, and is written mostly by staff of Mozilla, Google, Open Web Docs and Samsung (MDN pull request guide). `javascript.info` is a textbook by one author, Ilya Kantor, since 2007; it is open source, with no review step documented (its About page and repository) |
| 4 | Vetted engineering literature | Cloudflare, Netflix, Stripe engineering blogs; official post-mortems | — |
| 5 | Tertiary overviews | Wikipedia, general handbooks | Used to map the topic and expand queries, never as proof |
| 6 | Community and unvetted | Stack Overflow, Reddit, Medium, personal blogs, GitHub issues/discussions/PRs | **GitHub is split by path**: repo code at a tag is 1, issues are 6. Of 202 github.com links today, 12 are issues/discussions/PRs |

Rank is about **provenance** (who published it and with what authority), not about quality of writing (retrieval spec §3.2 rule 1). The rule table lives in one place, `tools/classify-source/source-ranks.json`, and both the script and this doc read from it (one canonical copy, KB-8).

**Rules match a host plus a path prefix, not a bare domain**, and the longest matching prefix wins. One site often mixes ranks by folder: `github.com/<org>/<repo>/blob/<tag>/` is Rank 1 and `github.com/<org>/<repo>/issues/` is Rank 6; `aws.amazon.com/whitepapers/` and `aws.amazon.com/blogs/` would get different ranks too.

**From tier B to a rule.** When the judge confirms the same `tier: B` rank for one host and path prefix across several runs, the run report proposes a `source-ranks.json` entry in that host-plus-prefix form. It is added only on V's yes. Later runs then rank that source by script, with no tokens.

A rule is proposed only when one publisher owns everything under that host and prefix, such as one book or one organization's blog. A host where many people post never gets a rule, because its paths do not show who wrote a page: a mailing-list archive such as `lkml.iu.edu` (`/hypermail/linux/kernel/2010.1/04469.html` names no author), `medium.com`, or `github.com/<user>/`. Those pages stay tier B and are rated one at a time.

**GitHub: org rules and repo rules** (decided by V, 2026-11-22). The code and docs in the repositories of core languages, runtimes, frameworks and operating systems are Rank 1, while `/issues/`, `/pull/` and `/discussions/` inside them stay Rank 6, because the rule with more path segments wins.
- **Org rule** (`github.com/<org>/` → Rank 1) for an organization whose every repository is official: `rust-lang`, `nodejs`, `golang`, `python`, `denoland`, `oven-sh`, `tc39`, `kubernetes`, `postgres`, `llvm`, `whatwg`, `w3c`, plus those seen in the knowledge base's References: `opencontainers`, `swiftlang`, `cucumber`, `github`, `actions`, `anthropics`, `openai`, `modelcontextprotocol`, `Homebrew`, `cilium`, `projectcalico`, `flannel-io`, `kata-containers`, `firecracker-microvm`, `graphql`.
- **Repo rule** (`github.com/<org>/<repo>/` → Rank 1) for a flagship project inside a large or personal account: `facebook/react`, `vercel/next.js`, `microsoft/TypeScript`, `torvalds/linux`, `v8/v8`, `apple/swift`, `redis/redis`, `docker/cli`, `moby/moby`, `libuv/libuv`, `nvm-sh/nvm`, `google/benchmark`.
- **Books on GitHub** are Rank 3, like a textbook: `getify/You-Dont-Know-JS`, `MostlyAdequate/mostly-adequate-guide`, and `javascript-tutorial` (the source of `javascript.info`).

The list cannot name every library's repository: of the 112 tier B `github.com` References URLs found on 2026-11-22, most were one library's own repo. Those stay tier B, and the judge's "project's own home" rule below rates them.

**Tier B rating guide** (decided by V, 2026-11-22). The judge applies these in order, and the first that fits decides:
1. **Originator:** the author coined or first published the concept the claim is about, and a page in the judge's input shows it. Rank 1, for claims about that concept only. In the audit, three originators' own pages were rated Rank 6 by the fallback below; this rule comes first so that cannot recur.
2. **The project's own home:** the project's own repository, docs or release notes, for claims about that project. Rank 1.
3. **Maintainer's post:** a post by a project's maintainer on that project's official mailing list is Rank 4, but only when the saved page itself shows the author's role, for example the project's lead or a `Signed-off-by:` line of a maintainer. Example: the three `lkml.iu.edu` posts in the SE-04 baseline are by Linus Torvalds, and their saved pages show it.
4. **Class:** otherwise by the classes in the table above; when two ranks fit, the higher number.

Rules 1–3 rest only on what the input shows, never on the judge's own memory.

**Provenance pages** (decided by V, 2026-11-22; Phase 3). When a tier B source needs rule 1 (originator) or rule 3 (maintainer), the worker also saves a page that shows the role and links it in the ledger as `provenance_ref` (the cache file of that page): the project's `MAINTAINERS` file, the originator's first publication, or a credit line in a spec or book. The orchestrator copies it into the judge's input. Without it the judge cannot apply the rule: in the v5 re-judging, Robert C. Martin's and Brendan Gregg's pages stayed Rank 6 for exactly that reason.

**Pinned source code** (decided by V, 2026-11-22; Phase 3). A worker that cites a file in a repository uses a release tag or a commit (`/blob/v19.0.0/…`), not a moving branch (`/blob/main/…`), so the cited text stays the same after the repository changes. Fetch the raw file (`raw.githubusercontent.com/<org>/<repo>/<tag>/<path>`): the audit showed that GitHub's HTML view of a long file is cut off.

### 2.2 Where the rank is written

In the References entry, between the year and "Backs:":

```markdown
- [RFC 9113: HTTP/2](https://www.rfc-editor.org/rfc/rfc9113) — IETF, 2022. Rank 1. Backs: How it works §2. [^1]
- [Why HTTP/2 has no head-of-line blocking](https://example.dev/blog/h2) — personal blog, 2021. Rank 6. Backs: Pitfalls, misconception M1. [^7]
```

New optional front-matter key in `knowledge-doc.schema.md` and `deep-dive.schema.md` (KB-10 requires the schema to list it first):

| Key | Required | Values / meaning |
|---|---|---|
| `ranked-sources` | no | `true`: every external reference carries a rank, and the rank rules KB-14 to KB-16 apply. The research agent always sets it. Existing docs are untouched (no retrofit, `_system.md` §6) |

### 2.3 New rules in `_system.md` §4

| Id | Rule | Enforced by |
|---|---|---|
| KB-14 | **Ranked references.** With `ranked-sources: true`, every external References entry has `Rank <1–6>.`, entries are ordered by rank, 1 first, and a URL that a `source-ranks.json` rule covers (tier A) carries that rule's rank | script |
| KB-15 | **Rank quarantine.** With `ranked-sources: true`, a footnote cited in a core section points to an allowed rank (table below). Anything else fails | script |
| KB-16 | **No orphan sources.** With `ranked-sources: true`, every References entry that carries a footnote is cited at least once in the body (the reverse of KB-12) | script (warn first, fail after Phase 2) |
| KB-17 | **Conflicts are arbitrated, not hidden.** When sources disagree, the claim from the lower rank number governs the core sections. The other claim is kept under Pitfalls / Edge cases with its source and rank, and the text says why it is wrong or when it holds. **On a tie** (both sources the same rank, for example MDN and `javascript.info`, both Rank 3), neither wins: the orchestrator looks for a Rank 1 source (the spec) to settle it. With none, both claims go under Pitfalls / Edge cases as an open conflict marked `⚖️ open conflict`, each with its own source, rank and ✅, and neither appears in the core sections. (Until 2026-11-22 the marker was `⚠️ unverified`, which KD-2 forbids in a verified doc; V chose a marker of its own) | script (the marker's place, ranked docs) + llm (judge) |

**KB-15 section map.** The specs number sections 1–7. Knowledge docs use names, so the validator maps names to allowed ranks:

| Spec section | Deep-dive heading written by the agent | knowledge-doc headings | Allowed ranks |
|---|---|---|---|
| 1 Thesis & mental model | `## 1. Mental model` | Problem, Mental model; reference Scope; how-to Goal & prerequisites | 1–5 |
| 2 Concept architecture | `## 2. Concept architecture` | (inside Mental model) | 1–5 |
| 3 First-principles mechanics | `## 3. How it works` | How it works; how-to Steps, Verify | 1–4 |
| 4 Worked examples | `## 4. Worked examples` | Worked example | 1–5 (6 warns) |
| 5 Canonical reference | `## 5. Reference & invariants` | reference Catalog | 1–4 |
| 6 Trade-offs & pitfalls | `## 6. Trade-offs, pitfalls & misconceptions` | Edge cases, Trade-offs, Troubleshooting, Lookup notes | any |
| 7 Source ledger & mastery path | `## References` (ordered by rank) + `## Related` (next topics) | References, Related | — |

The validator's full map, `_system.md` §4.1, also covers the headings this table leaves out: Summary and Takeaways (1–5), Case studies (1–5, Rank 6 warns), how-to Rollback (1–4) and the case-study headings. A ranked doc with any other body heading fails KB-15. (Built in Phase 1, 2026-11-22.)

The 7 headings are a writing convention of the research agent inside the free deep-dive body (DD-2 is unchanged: nothing forces other deep dives into this shape). After the judge passes, the deep dive is **synthesized** as usual: sections 1–4 and 6 become a `concept` doc, section 5 a `reference` doc, a walkthrough a `how-to` doc.

## 3. The verifier (LLM-as-a-judge Evaluator)

Analogy: a teaching assistant who marks an essay with the cited books open on the desk. They do not take the student's word for what page 12 says.

### 3.1 Inputs, and what it never sees

| Sees | Never sees |
|---|---|
| Copies of the doc, `ledger/*.json`, `cache/*.txt` (page text) and the Stage 1 report, in `verdicts/round-<n>.input/` (§1.3 step 6). The Stage 1 report carries each source's tier A rank from `classify-source.mjs` | `plan.md`, the orchestrator's notes, earlier verdicts (each round's judge is fresh) |

**Key change from the evaluator spec.** The spec's judge checks the doc against the workers' JSON. If a worker misread a page, that judge still passes the claim. This judge checks against the **saved page text**. The 2 known errors in `knowledge/ai-agents/model-context-protocol.md` are exactly the kind only the page shows: a SHOULD written as MUST, and a dropped qualifier word. (A third, "the wrong delivery channel", was the blind check's own error; V ruled it out on 2026-11-22.)

### 3.2 Stage 1: script, no tokens

| Check | Rule |
|---|---|
| The 7 research headings are present and not empty (when `ranked-sources: true` and `schema: deep-dive/v1`) | new check in DD-1 |
| Every footnote resolves; no orphan source | KB-12 + KB-16 |
| Every ✅ in a core section carries a footnote | new, part of KB-15 |
| Rank quarantine | KB-15 |
| Every ledger quote is found in its cached page (after normalizing quotes, dashes and white space) | `evaluate-research.mjs quotes` (reuses the normalizing idea from the reverted RR-13) |
| URLs resolve | KB-3 |

### 3.3 Stage 2: judge, fresh context

1. **Re-rate tier B sources.** The judge takes tier A ranks from the Stage 1 report as given, so its prompt holds no rank table that could drift from `source-ranks.json`. For every `tier: B` source, it reads the cached page and states the rank it would give, using the tier B rating guide (§2.1). A different rank that moves a source into a section KB-15 bars it from is a `CRITICAL_FAIL`.
2. **Grounding.** The judge checks **every** ✅ sentence in sections 1–5. In section 6 it checks every sentence that records a KB-17 conflict or cites a Rank 6 or `tier: B` source, plus a random 15 of the rest. For each, it reads the cited cache text and gives one verdict:
   - `entails`: the page says this, or more.
   - `overstates`: the sentence is stronger than the page. That covers a stronger modal verb (RFC 2119 MUST vs. SHOULD), wider scope, a dropped qualifier, a number or version the page lacks.
   - `unsupported`: the page does not say it.
   - `contradicted`: the page says the opposite.
3. **Conflict audit (KB-17).** For every conflict in the ledger, the winner is in the core sections and the loser is in section 6 with its rank and the reason; a tie is an open conflict in section 6, marked `⚖️ open conflict`. A misconception found in the pitfall ledger but missing from section 6 is a violation.
4. **Structure.** Each section does its job (Diátaxis): section 4 holds real worked runs, section 6 holds a decision table, section 2 holds no mechanism text.

**Long docs are judged in parts.** A doc with more claims than one judge context holds well is split by top-level section. Each part gets a fresh judge with `SCOPE` set to its headings, and the orchestrator merges their claim checks before scoring. In Phase 0, the 197-claim MCP doc took 3 parts of 154k–197k tokens each, about 2,600 tokens per claim.

**Comparison runs ground a sample.** For the golden set and the plain-prompt baselines, a script picks the claims instead of the judge: a random sample of 45 ✅ claims, stratified by `##` heading (each heading gets its share of the 45 by its claim count, and at least 1), with a fixed seed. The judge gets the list as `claims.json` and grounds exactly those claims. Both sides of a comparison are then measured the same way, at about 120k tokens per doc.

**Patch rounds (round 2 and later).** Stage 1 re-runs in full, at no token cost. A script diffs the doc against the previous round, and the judge re-grounds only the changed sentences and the sentences whose footnote changed. The tier B re-rating covers only new sources. The conflict audit and the structure check re-run in full, since they read only the doc and the ledger. The judge still never sees earlier verdicts: it gets the list of sentences to check, not the reasons. Rubric scores apply to the whole doc, so there is no per-section score to skip by.

### 3.4 Verdict file (`verdicts/round-<n>.json`)

This is the evaluator spec's `EvaluatorVerdict` with three changes. `section` is a heading string, not a number, so it fits typed docs too. It adds `claim_checks` (one row per sentence judged). It adds `judge` (model and prompt hash), so scores from different judge versions are never compared as if they were the same.

```json
{
  "verdict": "FAIL",
  "overall_score": 3.75,
  "judge": { "model": "claude-opus-5-5", "prompt_sha": "a1b2c3d" },
  "deterministic_checks": { "sections_present": true, "zero_orphan_citations": true, "rank_quarantine_intact": true },
  "rubric_scores": { "citation_integrity": 5, "rank_compliance": 4, "factual_grounding": 3, "diataxis_rigor": 3 },
  "claim_checks": [
    { "section": "3. How it works", "sentence": "The server MUST return 403 insufficient_scope …", "source": "[^4]",
      "verdict": "overstates", "page_says": "… the server SHOULD respond with HTTP 403 …" }
  ],
  "violations": [ { "severity": "CRITICAL_FAIL", "section": "3. How it works", "rule": "grounding", "evidence": "MUST vs SHOULD" } ],
  "patch_instructions": [ { "section": "3. How it works", "action": "Change MUST to SHOULD in step 9; cite [^4] §3.1" } ]
}
```

**PASS** = Stage 1 all true, no `CRITICAL_FAIL`, and every rubric score ≥ 4 (evaluator spec §4), **and at least 70% of the judged claims are checkable** (decided by V, 2026-11-22). A judge's `PASS` below that share becomes **`INCONCLUSIVE`**: nothing was found wrong, but too little could be checked. A script sets it from `claim_checks` (`evaluate-research.mjs verdict`), so the judge does not compute it. Example: a doc with 4 ✅ claims of which 3 cite only a local lab is 1 of 4 = 25% checkable, so `INCONCLUSIVE`.

**Severity of a grounding finding in sections 1–5** (decided by V, 2026-11-22; judge v3):

| Severity | Findings | Effect |
|---|---|---|
| `CRITICAL_FAIL` | `contradicted` (inverted behaviour included); `unsupported`; a number, version, date or name the page lacks or gives differently; a modal raised to MUST level in the sentence's own words (must, required, always, never, will) where the page says SHOULD, MAY, can or could | The doc fails |
| `WARN` | Every other `overstates`: a SHOULD or MAY rule written as a plain statement; a modal raised short of MUST level; a wider scope; a dropped qualifier or condition | Lowers `factual_grounding`: score 4 allows at most 3 `WARN`s, or 1 per 10 checked claims when that is more |
| `SOFT_WARN` | Any finding in section 6; `no_cache` | Counts with `WARN` toward the same limit |

Example: in the MCP deep dive, "Server must …; insufficient scope gives `403`", where the spec has SHOULD for the 403, is a `CRITICAL_FAIL`. "Alternative transports must follow established best practice", where the spec says "security best practices", is a `WARN`.

### 3.5 How a verdict sets the doc's status

| Outcome | `status` | ✅ marks | Summary |
|---|---|---|---|
| PASS | `verified`, `last-verified` = date of the verdict | ✅ now means "checked by the judge against the saved page" | — |
| INCONCLUSIVE | `draft`, with the reason (for example "13 of 20 claims cite only local labs") in a Summary note | Unchanged: they are the writer's own checks | — |
| FAIL after 2 patch rounds | `draft` | Each failing claim becomes `⚠️ unverified` with the judge's note in our own words | A "Known issues" line listing them, as the MCP doc already does (the specs' "Epistemic Caution Banner") |

### 3.6 Stage 1.5: code probes (Phase 2b, decided by V, 2026-11-22)

Analogy: a lab notebook next to the textbook. The textbook says what is guaranteed; the notebook says what happened when someone tried it, on which machine and version.

A **probe** is a tagged code block in the doc that a script runs in a sandbox (a throw-away container with no network) and compares with the result the doc expects.

**What it is for.** Text grounding cannot check that code runs, and docs back many claims with local labs the judge cannot read. In the Phase 0 baselines, 16 of 135 sampled claims (12%) were `not_checkable` for that reason: SE-04 10 of 45, LS-03 6 of 45, SE-02 0 of 45. Probes make those claims checkable. Only about 3–4 of the 25 grounding findings in the v3 runs were of the kind a probe could settle, such as a wider scope that is true in practice (`protected` bracket access). Most were wrong citations, dropped conditions or rank breaches, which probes do not fix.

**What it never excuses.** A probe shows what one version did on one machine. It never excuses a dropped condition or a SHOULD or MAY written as MUST, and it never stands for what a spec guarantees.

**Placement.** Stage 1 (scripts) → PASS → Stage 1.5 (`run-code-harness.mjs`, no tokens) → PASS → Stage 2 (judge). A probe whose result differs from its `expect` returns FAIL, with its stderr, to the patch loop before any judge tokens are spent.

**Fence contract.** Only tagged blocks run; an untagged block is an illustration and is skipped. Renderers use only the first word of a fence's info string as the language (CommonMark 0.31.2, §4.5), so the tags do not change how the doc looks:

````markdown
```js verify id=probe-01 runtime=node24 expect=stdout:false
class A { #x = 1; static has(o) { return #x in o; } }
console.log(A.has(structuredClone(new A())));
```
````

Run on 2026-11-22 with Node 24.22.1, this prints `false` (`A.has(new A())` prints `true`): the clone has no private field. Two earlier drafts of this example were wrong. The first expected `throws:TypeError`; running it showed that `structuredClone()` does not throw. The second printed `JSON.stringify` of the clone, `{}`, which cannot tell "not copied" from "copied", because `JSON.stringify` never shows `#` fields; the v6 judge caught that in calibration.

| Tag | Meaning |
|---|---|
| `verify` | Run the block and compare with `expect` |
| `syntax-only` | Parse or type-check only: `node --check`, `tsc --noEmit`, `python -m py_compile` |
| `lib` | Shared code that is not run itself; a probe with `uses=<lib id>` gets it first (for example the helpers of a C lab) |
| `repeat=<n>` | Run n times: pass when every run passes, fail when every run fails, `mixed` otherwise |
| `id=probe-<nn>` | Stable id. The harness extracts blocks by id and hashes each one on every run, so no hand-kept manifest drifts after a patch round |
| `runtime=<name>` | One of the v1 runtimes below. The validator checks the name (DD-6); whether the doc's `applies-to` covers that version is the judge's call |
| `expect=` | `exit:<n>`, `throws:<ErrorName>` or `stdout:<text>` |

**v1 runtimes**, each a Docker image in the harness's own table, whose image id `harness.json` records: `node24` (`node:24.22.1-alpine`); `python3` and `c` (`linlab:1`, the local lab image: Python 3.12.13, gcc 13.2.1); `tsc`, the TypeScript type checker (TypeScript access modifiers are erased at runtime, so a claim about them needs `tsc`, not `node`); `c`, gcc on Linux, for kernel interfaces such as epoll. Browser probes, such as the LS-03 cookie lab, are out of scope for v1.

**TypeScript 5 and 7** (decided by V, 2026-11-22). `runtime=tsc` is TypeScript 5.9.3, the line the knowledge base's docs describe (image `kb-probe-tsc5:5.9.3`). The harness runs every `tsc` probe again on TypeScript 7.0.2, the native rewrite in Go (image `kb-probe-tsc7:7.0.2`), and records in `harness.json` whether 7 gives the same outcome and the same diagnostics. Checked on 2026-11-22, `tsc --noEmit --strict --target es2022`:

| Behaviour | TypeScript 5.9.3 | TypeScript 7.0.2 |
|---|---|---|
| Bracket access to a `private` member type-checks | yes | same |
| Dot access to a `private` member: `TS2341` | yes | same diagnostic |
| Bracket access to a `protected` member type-checks | yes | same |
| A `#` name as a parameter property: `TS18009` | yes | same diagnostic |
| `readonly #x` is allowed | yes | same |
| `obj.#x` outside its class: `TS18013` | yes | same diagnostic |
| Exit code when the check finds errors | 2 | **1** |

So a probe should expect a diagnostic (`expect=stdout:TS2341`), not an exit code, when it tests a type error: the diagnostics agree across the two versions, the exit codes do not.

**Sandbox.** `docker run --rm --network none --read-only --tmpfs /tmp --cpus 1 --memory 512m --pids-limit 128 --cap-drop ALL --security-opt no-new-privileges --user 65534:65534 -v <probes>:/probes:ro`, with a hard timeout of 10 s per probe. (Every flag is listed by `docker run --help` in Docker 29.8.2.)
- With no Docker on the machine, probe-backed claims become `⚠️ unverified`: the harness fails closed, never PASS.
- A probe that depends on timing (wake-ups, races) runs 3 times and fails only if all 3 fail; a mixed result is a `SOFT_WARN`.

**Citations.**
- A probe is a local source, cited with a normal footnote `[^probe-01]` whose References entry reads, for example, `` `probes/probe-01.js` — verify, Node 24.22.1, prints false. [^probe-01] ``. KB-12 and KB-16 then cover it unchanged.
- It has no rank. It may back claims in roles 3, 4 and 6 next to a ranked source, and never backs a role 5 claim alone.
- A claim backed by a probe alone is worded as an observation with its version ("In Node 24.22.1, a `structuredClone()` copy of a class instance has no `#` field"), not as a rule.
- A web footnote covers only what its saved page says. The part only the probe shows cites the probe.

**Judge.** It gets `probes/` and `round-<n>.harness.json` in its input folder and reads the probe code, because the orchestrator writes the probes.
- A claim whose probe ran as expected and tests what the claim says gets the new verdict `observed`. It is counted apart from `entails`, so "grounding errors per 15 claims" keeps its meaning.
- A probe that swallows errors, runs another version or does not test the claim is `invalid_probe`, a `CRITICAL_FAIL`.

**Evidence** in the run folder: `probes/probe-<nn>.<ext>` (extracted by the harness) and `verdicts/round-<n>.harness.json` (`probe_id`, `status`, `exit_code`, `stdout`, `stderr`, `duration_ms`, `runtime_image`, `block_sha`), both copied into `verdicts/round-<n>.input/`.

## 4. Lifecycles

### 4.1 One research run

```
planned ─(V approves)─► retrieving ─► drafted ─► evaluating ─┬─ PASS ─────────────────► verified ─(V commits)─► published
                                                    ▲         ├─ FAIL, round < 2 ─► patching ─┘
                                                    └─────────┘
                                                              └─ FAIL, round = 2 ─► released as draft (⚠️ + known issues)
published ─(applies-to versions age / a cited page changes)─► stale ─► refresh: re-fetch the cache, re-run Stage 1 + judge
```

### 4.2 The verifier's own lifecycle

A judge is itself a model that can be wrong. It is trusted only after it is tested, and it is re-tested whenever it changes.

| Stage | What happens | Done when |
|---|---|---|
| 1. Calibrate | Inputs sit in neutral `run-<id>` folders, so the judge cannot guess the expected result from a path. Run the judge on docs with **known** errors. (a) the MCP deep dive, whose 2 errors a blind check already found. (b) A copy of a verified doc with 5 planted errors: MUST/SHOULD swapped, a wrong number, a Rank 6 source cited in How it works, an orphan footnote, a hidden conflict | It finds 2/2 MCP errors and ≥ 4/5 planted ones, and V spot-checks that it raises no false alarm on 1 clean doc. No calibration error may appear as an example in the judge prompt (Phase 0 found three that did) |
| 2. Online gate | Every research run, as in §3 | — |
| 3. Offline audit | Run the judge, report-only, over existing `verified` docs in small batches. Aggregate the failure patterns (evaluator spec §1.1) | V gets a report; no doc is changed without V's yes |
| 4. Regression | Run the golden set (§5) before and after any change to prompts, models or rules | Release gate met (§5) |
| 5. Re-calibrate | When the judge's model or prompt changes (`prompt_sha` changes), repeat stage 1 | Same as stage 1 |

## 5. Golden set: adapted from the spec's 20 traps

- **Use the software topics first:** SE-01 (PostgreSQL VACUUM), SE-02 (HTTP/2 vs HTTP/3 head-of-line blocking), SE-03 (Kafka exactly-once), SE-04 (epoll edge-triggered), LS-02 (OAuth vs OpenID Connect), LS-03 (JWT storage). They fit this company-neutral software knowledge base. The finance, law and statistics topics stay in the set as stress tests, but their outputs are never committed to `knowledge/`.
- **Outputs live in `research/_golden/<id>/`**, not in `knowledge/`.
- **Pass criteria name headings, not numbers**, for example `## 5. Reference & invariants` or `## 6.`. Each topic's criteria live only in `research/_golden/<id>/criteria.json`, never in this design: the orchestrator may not open either, and in the first 3.6 attempt (2026-11-22) it read them here, by grep, before that rule existed.
- **Fix the spec's inconsistencies first.** DS-02's "ground truth" is a Rank 3 book. The `.md` release gate drops the "no more than 0.1 below baseline" condition the conversation states. SE-03's criteria differ between the `.md` and the `.json`.
- **Release gate** (golden dataset §3, kept): Stage 1 100%; judge average ≥ 4.5/5 and no more than 0.1 below the previous version; the trap lands in section 6 in ≥ 19/20 (in the 6-topic subset: 6/6). New: **it beats the plain-prompt baseline** on grounding errors per 15 sampled claims, at a token cost V accepts.

## 6. Plan

Each phase ends with a check V can see, and the next starts only on V's yes. Phases 1 and 2 pay off even if Phase 3 is never adopted.

| Phase | Builds | Done when | Size |
|---|---|---|---|
| **0. Baseline + judge prototype** (Markdown only) | The judge prompt as a draft agent. A plain-prompt run on 3 golden topics (SE-04, LS-03, SE-02) | The judge passes calibration (§4.2 stage 1), and the 3 baseline docs have verdicts. **Status 2026-11-22: done.** Judge v3 (`f166f98`, V's severity split, neutral examples) found both known MCP errors and 5/5 planted ones at the right severity, and passes the clean doc (4.50). The 3 baselines fail at 2.75–3.25, with 2.0–3.9 grounding findings per 15 checkable claims (0.3–1.3 critical), mostly on tier B sources the judge rated Rank 6 (`research/_calibration/REPORT.md`) | S |
| **1. Source rank** | `source-ranks.json` (host + path-prefix rules) + `classify-source.mjs` (tier A). `ranked-sources` key; KB-14 to KB-16 in the validator, with Cucumber scenarios. A report-only rank census of today's References (for example, how many are Rank 5–6) | `pnpm run verify-before-commit` passes; the census reaches V. **Status 2026-11-22: built, checks pass (94 scenarios).** Census of 1,873 References URLs: 64% tier A (Rank 1: 47%, Rank 3: 15%), 36% tier B. KB-16 gated on `ranked-sources`, as §2.2 says | S–M |
| **2. Verifier** | `evaluate-research.mjs` (Stage 1 + quote check), the `knowledge-judge` agent, the verdict JSON schema, the patch loop and the status mapping (§3.5) for the orchestrator's body. Stage 1 passes tier A ranks to the judge, and the tier B rating guide (§2.1) joins the judge prompt in the same change, so the judge is recalibrated once | It re-runs green on the calibration docs. An offline audit of 10 verified docs reaches V | M |
| **2b. Code probes** | `tools/run-code-harness/` (Stage 1.5, §3.6) with Cucumber scenarios; the fence tags in `deep-dive.schema.md` and a validator check for them; the judge's `observed` and `invalid_probe` verdicts | SE-04's 14 C tests run as probes, and its `not_checkable` claims drop from 10/45 to 2/45 or fewer when re-judged with the same sample seed; `pnpm run verify-before-commit` passes. Done before Phase 3. **Status 2026-11-22: done.** 14 of 14 probes pass; `not_checkable` 10/45 → 0/45 with judge v7 (`research/_calibration/REPORT.md` §3.8); 107 scenarios | M |
| **3. Research agent** | The `research-orchestrator` agent (and, if wanted, a thin `research-knowledge` skill that starts it); the `research-worker` agent with 4 profiles; `fetch-source.mjs`; the ledger JSON schema | One run end to end on SE-04 reaches `verified` or an honest draft | M–L |
| **4. Regression + decision** | Runs the agent and the plain prompt on the 6 software topics, both scored by the same calibrated judge, with tokens measured | V decides: **adopt**, **tune** (record wording tests in `knowledge/ai-agents/instruction-wording-findings.md`), or **drop the agent and keep phases 1–2** | S |
| 5. Mechanize (only if needed) | LangGraph or a script orchestrator | Only on a signal from the conversation's list: the model keeps breaking the JSON or quarantine, runs are too slow, or V wants batch or API use | — |

**Phase 2 work order** (status 2026-11-22):

| # | Piece | Status |
|---|---|---|
| 1 | `evaluate-research.mjs ranks` (tier A or B per References URL) and `quotes` (the judge's quotes against the cited pages, comment-aware); the References parser is shared with the validator | **Done**, 4 scenarios. On the 6 v3 runs, 58 of 58 quote segments are found on the pages each claim cites |
| 2 | `evaluate-research.mjs stage1 <run> <n>`: the judge's input folder with `stage1.json` (each source's tier, and for tier A its rank and rule), and `--sample <k> --seed <s> [--include …]` (replaces the Phase 0 scripts `make_input.py` and `sample_claims.py`). The validator's result for a doc outside `knowledge/` is not in it yet | **Done**, 2 scenarios |
| 3 | The verdict JSON schema, checked by the same tool | — |
| 4 | Judge v4 (`d8dcf5d`): takes tier A ranks from `stage1.json` and adds the tier B rating guide (§2.1); recalibrated on the 3 calibration docs, about 360k tokens | **Done**: passes calibration (`research/_calibration/REPORT.md` §3.5), 373k tokens |
| 5 | The judge's `claude.yaml` header (model `claude-opus-5-5`; no Agent, WebFetch or WebSearch). Codex and Copilot headers only after a calibration run on them. Linking through agent-config's `agent-sources` | **Done**: agent-config `installer/mapping.yaml` lists `{{KNOWLEDGE_REPO}}/frameworks/knowledge/agents`, and `~/.claude/agents/knowledge-judge.md` links to the built file. A plain `build-agents` run (agent-config's own checks) does not read `agent-sources` and deletes the built file; tracked as agent-config T-10 |
| 6 | The patch loop (at most 2 rounds) and status mapping (§3.5), written for the orchestrator's body (Phase 3) | — |
| 7 | Offline audit of 10 verified docs: about 110k tokens each (the clean Phase 0 doc's cost), so about 1.1M | **Done**: 6 FAIL, 4 PASS; 1,177k tokens (`research/_audit/REPORT.md`) |

**Phase 3 work order** (approved by V, 2026-11-22). V's core rule (§0) shapes every step: workers find, rank, save and sum up with citations; the orchestrator reads the cited passages and writes the doc.

| # | Piece | Done when | Tokens |
|---|---|---|---|
| 3.0 | **Two spikes**, before any code: (a) an agent started as a subagent starts a nested subagent, in this app, and the nested one cannot start a third; (b) whether `WebSearch` takes allowed and blocked domain lists here (§7, unconfirmed) | Both answered and recorded in `knowledge/ai-agents/claude-code-usage-reference.md`. **Done 2026-11-22** (Claude Code 2.1.330, desktop app): (a) nesting goes deeper than expected, three levels each answered, so `tools: Agent(...)` is what limits it; (b) `WebSearch` takes `allowed_domains` and `blocked_domains` | about 50k |
| 3.1 | `tools/fetch-source/fetch-source.mjs`, which replaces the Phase 0 `fetch_pages.py`. It fetches with the system's CA store (Node's `--use-system-ca`, else curl), saves `cache/<sha256(url)[:12]>.txt` atomically, skips a page already saved, and records in `sources.json` the fetch date and the SHA-256 of the saved text (§1.5). A GitHub file is fetched raw, and a moving branch draws a warning (pin a tag or commit, §2.1). A PDF is refused with a note to use the HTML version, since PDFs are out of scope for v1. Scenarios run against a local web server | Scenarios pass; re-fetching the 18 SE-04 pages gives the same text. **Done 2026-11-22**: 4 scenarios; on the 18 pages re-fetched, every quote of the two SE-04 verdicts is found again (run-w3j7 18 of 18, run-h6t1 16 of 16). The cache names match Phase 0's, since both hash the URL the same way | 0 |
| 3.2 | The **ledger**: `tools/evaluate-research/ledger.schema.md` (next to the tool that checks it, since `schemas/` holds the doc schemas) and `ledger/<profile>.json`, holding the sources (rank, tier, fetch date, `provenance_ref`), the facts (each one a short summary in the worker's own words, an exact quote, and its place in the cache: heading and line range) and the conflicts. `evaluate-research.mjs ledger` checks that every quote is at its place in its page, with the same normalizer as `quotes` | Scenarios pass, one of which plants a wrong quote. **Done 2026-11-22**: 4 scenarios (a clean ledger; a planted wrong quote, a quote at the wrong lines, a wrong rank, dangling ids and a drafted section; a page edited after fetching, caught by its SHA-256; the cap with a seed source). The schema's example passes against fsync(2) as saved that day | 0 |
| 3.3 | **Stage 1 for a doc outside `knowledge/`**: `stage1` runs the validator's rules (DD-1, DD-6, KB-12, KB-14 to KB-16) on the run's doc and records the result in `stage1.json` | Scenarios pass. **Done 2026-11-22**: `stage1` runs `validate-knowledge.mjs` on a copy of the doc placed at its `topic:` folder, so KB-9 holds, and records every rule except those that compare it with other docs of `knowledge/` (TI-*, KD-7, DD-3, DD-4). With a `ledger/` folder it records the ledger check too. 2 scenarios | 0 |
| 3.4 | The **`research-worker` agent**: one body, 4 profiles (`taxonomy`, `ground-truth`, `practitioner`, `pitfall`; §1.4) given as `PROFILE`. It searches, ranks each URL with `classify-source.mjs`, keeps at most 4 sources per profile (`seed_sources` exempt), saves pages with `fetch-source.mjs`, and writes only its own ledger file. It writes no doc text. Claude header first, on the same model tier as the orchestrator; Codex and Copilot headers later | One `ground-truth` run on SE-04 gives a ledger that passes 3.2's check. **Done 2026-11-22** (`research/_phase3/se04-ground-truth/`): 4 Rank 1 sources (epoll(7), epoll_ctl(2), and `fs/eventpoll.c` and `eventpoll.h` at tag `v6.12`), 48 facts all at their place, 2 conflicts, 0 errors; it wrote only its ledger and used no WebFetch or Agent; 133k tokens. The agent, just linked, was not yet loaded in the session, so this run was a `general-purpose` subagent given `body.md` word for word and the header's tool limits. It met HTTP 429 from `raw.githubusercontent.com` and checked status codes with `curl`; `fetch-source.mjs` now retries a 429 or 503 itself, and the body says to reach the web only through the two tools | about 150k |
| 3.5 | The **`research-orchestrator` agent**, with `tools: Agent(research-worker, knowledge-judge)` plus Bash, Read, Write and Edit. It runs steps 1–8 of §1.3: `plan.md` for V's approval; the taxonomy worker and its term check; 3 workers in parallel; merging the ledgers with the conflict rule (KB-17); writing the doc itself from the cited passages; Stage 1, Stage 1.5 and the judge; at most 2 patch rounds; then the report to V with the tier B list (§1.5). Both modes. An optional thin `research-knowledge` skill only starts it | The 3.6 run completes without manual steps. **Done 2026-11-22**: it ran from plan to report with V's plan approval as its only stop; the caller saved its report, since Claude Code refuses a report file written by a subagent. Its first plan step read SE-04's criteria in this design, by grep, and was set aside: the body now forbids the design and `research/`, and the criteria live only in `research/_golden/` | — |
| 3.6 | **End-to-end run on SE-04** (gate): research → judge v7 → patch rounds → result, scored on the same 45-claim sample method as the baseline, with every agent's tokens added up | It reaches `verified` or an honest draft (§3.5); the report compares it with the plain-prompt baseline (FAIL 2.75 at v3, 3.25 at v7). **Done 2026-11-22** (`research/_phase3/se04-e2e/report.md`): its own judge failed round 1 (3.50) and passed round 2 (4.75, 80 of 80 claims checkable). On the baseline's sample method (`run-k7d2`): FAIL 4.75 against 3.25, 0 grounding findings per 15 claims against 3.67, 1 `CRITICAL_FAIL` against 7; the one left is the §5 criterion, failed by both (the rule sat in `## 3.`). Tokens: 1.45M in all (workers 426k, orchestrator 262k, its 2 judges 475k, the comparison judge 204k, 2 plan steps 83k), against the baseline writer's 232k. KD-2 forbade `⚠️ unverified` in a verified doc while KB-17 required it on an open conflict; **decided by V, 2026-11-22**: open conflicts get `⚖️ open conflict` (KB-17, `_system.md` §3), and the judge's recalibration for it opens Phase 4 | about 1.5–2M |

Total estimate: about 1.7–2.2M tokens, most of it in 3.6. After 3.6, Phase 4 compares the agent with the plain prompt on the 6 software topics.

**Phase 4, batch 1** (approved by V, 2026-11-22, about 2.8–2.9M tokens): (1) recalibrate the judge after its `⚖️ open conflict` change, once, before any Phase 4 verdict, so every Phase 4 verdict shares one `prompt_sha`; (2) run the research agent on SE-02 and LS-03, each plan approved by V; (3) judge each final doc by the baseline's method (45-claim sample, seed 20261122, the topic's `criteria.json`) against its clean Phase 0 baseline. SE-04 is not re-run: the orchestrator's section-role fix came from SE-04's own criterion. Batch 2 (SE-01, SE-03, LS-02) waits for V's yes on batch 1's report. **Progress 2026-11-22:** the judge v8 recalibration met the gate (`research/_calibration/REPORT.md` §3.9; 500k tokens). SE-02 (`research/_phase4/se02-e2e/report.md`): the agent's own judge failed round 1 (4.25) and passed round 2 (4.5); on the baseline's method, both judged by v8, the agent FAIL 4.75 against the baseline's FAIL 4.25, 0 grounding findings per 15 claims against 2.0, its one failure a criterion the two judges read differently. SE-02 cost 1.48M with both comparison judges; batch 1 so far 2.02M. LS-03 waits for V's yes on that cost.

**Where each piece lives** (artifact-types pattern):

| Piece | Type | Path |
|---|---|---|
| Rank rules and the new KB rules | Framework | `schemas/_system.md`, both doc schemas, `tools/classify-source/source-ranks.json` |
| Scripts | Tools with scenarios | `tools/classify-source/`, `tools/evaluate-research/`, `tools/run-code-harness/`, `tools/fetch-source/` |
| `research-orchestrator` | Agent (optional thin skill as its trigger) | `frameworks/knowledge/agents/research-orchestrator/` (body + headers); trigger, if any: `plugin/skills/research-knowledge/SKILL.md` |
| `research-worker`, `knowledge-judge` | Agents | `frameworks/knowledge/agents/<name>/` (body + one header per coding agent) |
| Run folders | Evidence | `research/<topic>/<slug>/`: `plan.md`, `ledger/`, `verdicts/` committed; `cache/` gitignored, `verdicts/` committed (decided by V, 2026-11-22) |

## 7. Open decisions and risks

| Item | Why it matters | Settle in |
|---|---|---|
| `javascript.info` (247 links, the most cited domain) is Rank 3 but documents no review step | At Rank 3 it can back a How it works claim alone. The judge's grounding shows only that the page says it, not that the spec agrees | Phase 4: count golden-set claims that rest on Rank 3 alone, and spot-check them against the spec |
| The "higher number when two ranks fit" rule against the originator class | In the audit it rated three originators' own pages Rank 6 (Robert C. Martin on ISP, Wadler on the expression problem, Gregg on USE), causing 9 of 10 KB-15 failures | **Decided by V, 2026-11-22**: the originator rule comes first (§2.1, judge v5). Re-judged: it raised Wadler's note to Rank 1 where the note itself shows he named the problem, but not Robert C. Martin or Brendan Gregg, whose originator role no saved page shows. **Phase 3:** workers save a page that shows who originated each concept the doc rests on |
| A PASS that rests on few checked claims | 4 of 4 passing audit docs cite local labs for 25–75% of their claims; one passed with 1 of 4 claims checked | **Decided by V, 2026-11-22**: at least 70% checkable, else `INCONCLUSIVE`; the 3 verified docs below it keep their status until Phase 2b's probes |
| Rank 3 ties (MDN and `javascript.info`) | Their conflicts need a Rank 1 source to settle (KB-17 tie rule); without one, the claim leaves the core sections | Phase 3: count how often a run hits a tie with no Rank 1 source |
| Does `WebFetch` return the raw page or a model's summary of it? | A quote check needs the real text | **Settled in 3.1**: the question no longer matters, since `fetch-source.mjs` fetches the page itself and saves its text |
| Does `WebSearch` take allowed and blocked domain lists in every coding agent we use? | Profile routing depends on it; without it, workers filter after the search | Claude Code: **yes** (3.0). Codex and Copilot: unconfirmed, settle when their headers are written |
| Docker on every machine that runs Stage 1.5 | Without it, probe-backed claims stay `⚠️ unverified`, so a Windows or CI machine without Docker cannot verify them | Phase 2b: measure; consider a non-Docker runner only if it is needed |
| PDFs (arXiv papers, specs) | The specs use layout-aware parsers (Docling, Marker). v1 prefers arXiv's HTML version and leaves PDFs out | Phase 3 |
| The cost of a full run | Unknown until measured; the reverted design had no measurement either | Phase 4 |
| Why the reverted workflow lost | Repeating its cause would waste Phases 3–4 | **Answered by V, 2026-11-22** (§0): fragmented claims from cheap models, too much process; plus two-hop checking and no run before review |

## References

**Local artifacts:**
- `schemas/_system.md`, `schemas/knowledge-doc.schema.md`, `schemas/deep-dive.schema.md`: the schemas this proposal extends.
- `tools/validate-knowledge/validate-knowledge.mjs`: today's Stage 1 checks (KB-12 is in one direction only).
- Commit `36d4ce2` (reverted in `b32f789`): the earlier research workflow; reused here are the quote normalizing, the fresh verifier and the run folder.
- `../../knowledge/ai-agents/model-context-protocol.md`: the plain-prompt deep dive with 3 known errors, used to calibrate the judge.
- The spec set (outside this repo): `research_agent_foundation.md`, `research_agent_technical_specification.md`, `retrieval_epistemic_routing_specification.md`, `llm_as_a_judge_evaluator_specification.md`, `regression_testing_golden_dataset.md`, `golden_dataset_automation_payload.json`, `Research Agent Architecture.md`.
- `~/.agent-config/patterns/artifact-types.pattern.md`, `explaining-mechanisms.pattern.md`: how the pieces are typed and how §1 is laid out.

**External authoritative sources:**
- [Diátaxis](https://diataxis.fr/): Daniele Procida, living. Backs: the section roles the judge checks.
- [Create custom subagents](https://code.claude.com/docs/en/sub-agents): Anthropic, living, read 2026-11-22 (Claude Code 2.1.330). Backs: §1.1, nested subagents, `claude --agent` as the main thread, `tools: Agent(a, b)`.
- [CommonMark Spec 0.31.2](https://spec.commonmark.org/0.31.2/): John MacFarlane, 2024, read 2026-11-22. Backs: §3.6, "The first word of the info string is typically used to specify the language" (§4.5, fenced code blocks).
- `docker run --help`, Docker 29.8.2 on this machine, checked 2026-11-22. Backs: §3.6, the sandbox flags.
- [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119): IETF, 1997. Backs: the MUST/SHOULD distinction that the "overstates" verdict checks.
- [About MDN](https://developer.mozilla.org/en-US/about): Mozilla, living, read 2026-11-22. Backs: §2.1, MDN is owned by Mozilla and has a Product Advisory Board (Google, Microsoft Edge, W3C, Bocoup; no Apple member listed).
- [MDN pull request guidelines](https://developer.mozilla.org/en-US/docs/MDN/Community/Pull_requests): Mozilla, living, read 2026-11-22. Backs: §2.1, changes are reviewed before merge and are written mostly by staff of Mozilla, Google, Open Web Docs and Samsung, plus volunteers.
- [About javascript.info](https://javascript.info/about): Ilya Kantor, living, read 2026-11-22. Backs: §2.1, one author since 2007, two maintainers, open source.
- [en.javascript.info repository](https://github.com/javascript-tutorial/en.javascript.info): living, read 2026-11-22. Backs: §2.1, no review step is described in the README or `AUTHORING.md`.

## Related

- `index.md`: the knowledge framework this agent writes into.
