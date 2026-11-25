---
name: review-knowledge-doc
description: "Review knowledge-base docs before committing: run the knowledge validator, then check what it cannot (stands alone without the chat, each section does its job, no copied content, sourced claims, current external-tool behaviour, nothing erased). Use before committing any change to the knowledge base (agent-knowledge, knowledge/ or frameworks/knowledge/), and always for text drafted in another AI chat."
---

# Review knowledge-base docs before commit

Covers what the validator cannot judge: meaning, purpose and truth.

**Inputs:** the change (staged diff, a commit, or a list of files) and its origin. Text drafted elsewhere (another AI chat, a paste, a person outside the repo) gets every step, for every file.

## Steps

1. **Run the checks** from the root of the agent-knowledge clone that holds the changed files (`git -C <folder of a changed file> rev-parse --show-toplevel`): `pnpm run verify-before-commit` (the validator, then its scenarios). Fix every FAIL. Treat every `KB-7`, `KB-8` and `KD-9` warning as a question for step 3. For docs that cite URLs, also run `pnpm run validate-docs-urls`.
2. **Read every changed file in full**, not only the diff: a duplicated paragraph is invisible in a diff that adds one copy.
3. **Check each file against this list.** Record each finding as `file:line — problem — why it matters`.

   | # | Check | Rule | Typical defect |
   |---|---|---|---|
   | a | **Stands alone:** every sentence makes sense to a reader who never saw the conversation; no answer whose question is missing, no "as discussed" | KB-7 | "**No, not by definition.**" opening a section |
   | b | **Each section does its job**, not only carries its name (Problem states a problem; Worked example is one run with real values; Verify gives checks with expected results; Takeaways are about this doc's topic) | KD-8 | Notes template inside Verify |
   | c | **One canonical copy:** nothing copied from another doc or repeated within the doc; a summary and a link instead | KB-8 | Same diagram in two docs |
   | d | **Copy-paste fit:** every paragraph matches the diagram, code or table next to it | KB-8, KD-8 | A paragraph about a join under a diagram without one |
   | e | **Claims are sourced:** each factual claim about a tool, standard or author is ✅ with a source you opened, or ⚠️ unverified (a `verified` doc may not keep ⚠️). A reference's title, author and year match the page | KB-1, KD-2 | Reference title that is not the page's title |
   | f | **External tool behaviour is current:** for every flag, path, command or step of a third-party tool, open its current docs and changelog | KD-2 | A CLI flag removed upstream |
   | g | **Revisions do not erase:** compare the old and new version unit by unit; every removed block has a reason (wrong, unverifiable, true duplicate) | KB-13 | A good table silently dropped in a rewrite |
   | h | **Front matter is the schema's:** no invented keys; to track something new, change the schema first (`frameworks/knowledge/schemas/`) | KB-10 | `revision: 1` |
   | i | **Every conclusion names its conditions:** a claim about how a tool behaves says the version, mode (headless or interactive, session or subagent), settings and location it holds under. Each "always", "never", "only" or "every" lists its exceptions or names the cases it covers | `scope-every-conclusion.pattern.md` | "The user's `CLAUDE.md` always loads" when it was measured only with the default settings sources |
   | j | **Rules come from a case table with a counter-case, and stay current:** a rule over several cases shows its case table, including one case chosen to break it. A sentence that a later finding in the doc narrows is updated, or points to the finding | `scope-every-conclusion.pattern.md` | An early entry says "it loads anyway", and a later entry shows a flag that stops it, with nothing saying which holds |

4. **Fix, or report.** Fix what you were asked to fix without erasing (step 3g), then run step 1 again. Otherwise report the findings, most important first, and do not commit.
5. **State what was checked and what was not** in the commit message or the reply, for example "validator passes; Spec Kit sources re-checked at v1.2.3; `--urls` not run".

Legacy docs (no `schema:` key) are not retrofitted unless the change itself touches them. This review does not approve: V decides to commit.
