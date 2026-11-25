---
schema: deep-dive/v1
topic: ai-agents/harness-lab
status: verified
applies-to: ["Claude Code 2.1.330 and 2.1.332 (CLI, headless -p), Sonnet and Haiku, one macOS machine", "experiments run 2026-11-24 and 2026-11-25"]
last-verified: 2026-11-25
last-updated: 2026-11-25
synthesized-into: []
tags: [lab-notebook, claude-code, subagents, plugins, hooks, orchestrator, evaluator, token-cost, experiments]
---

# Harness lab notebook: building a lean coding harness on Claude Code

## Summary
**TL;DR:** This notebook records, in order, every experiment run while building a small coding harness: a task card, an implementer agent, a gate hook that runs the checks, a path guard, and a separate reviewer. For each experiment it gives the question, the setup, the exact command, the result and the conclusion.

What the experiments showed:
- Giving an agent only its own tools shrinks its start-up block from about 40,000 to about 3,000–8,200 tokens (E6, E10, E13).
- An orchestrator that is itself a model costs more than the work it coordinates.
- A plugin's agent can run as the whole session, but then `omitClaudeMd` is ignored.
- Hooks see `agent_type` in every mode.
- Asking an agent to list its tools is not evidence of what it has.

**Use this when:**
- you build or change an agent harness on Claude Code (subagents, plugin agents, hooks, headless runs);
- you need a tested fact rather than a docs summary;
- you want to repeat an experiment: the commands are given.

**Depth:** twenty experiments (E1–E20; E10 is a 3-arm, 21-run trial), each with question, setup, command, result and conclusion; the three ways to orchestrate, compared with measured costs; the lessons drawn; how to repeat the runs.

---

## 1. Words first

| Term | Plain English | Analogy | Concrete artifact |
|---|---|---|---|
| Harness | The code and configuration around a model that give it a task, check its work and decide when it is done | The jig and gauges around a machine tool | The `archkit-build` plugin below |
| Task card | A JSON file that says what to build, what counts as done, which files may change and how to check it | A work order slip | `.archkit/tasks/T4.json` |
| Implementer | The agent that writes the code for one task card | The worker at the bench | Plugin agent `archkit-build:implementer` |
| Gate | A hook script that runs the checks when the implementer tries to stop, and sends it back on failure | An automatic gauge at the end of the bench | `scripts/gate.mjs` on `Stop` / `SubagentStop` |
| Guard | A hook script that refuses edits outside the task's allowed paths | A fence around the work area | `scripts/guard.mjs` on `PreToolUse` |
| Reviewer | A separate, read-only agent that grades the change against the criteria | A quality inspector who did not build the part | Plugin agent `archkit-build:reviewer` |
| Orchestrator | Whatever runs the steps in order: launch the implementer, read the gate, launch the reviewer, record the run | The shift manager | First a skill followed by the main session; later a Node script |
| Start-up block | Everything a fresh session or subagent receives before doing anything | The binder handed to a new temp worker on day one | 40,420 tokens for a default session on this machine |
| Cumulative input | The sum of every request's full context in a run | Photocopying the whole file again each time one page is added | 266,518 tokens for one small task (E5) |

---

## 2. The harness under test

**The plugin, `archkit-build` (the author's own project):**

```
.claude-plugin/plugin.json      {"name": "archkit-build", ...}; only the manifest lives here
agents/implementer.md           tools: Read, Edit, Write, Bash, Grep, Glob · model: sonnet · maxTurns: 25 · omitClaudeMd: true
agents/reviewer.md              tools: Read, Grep, Glob · model: sonnet · maxTurns: 12 · omitClaudeMd: true
skills/build-task/SKILL.md      the orchestrator's procedure (round 1)
hooks/hooks.json                PreToolUse → guard.mjs; SubagentStop and Stop → gate.mjs
scripts/guard.mjs, gate.mjs     the hooks; both act only when agent_type ends in "implementer"
scripts/build-task.mjs          the orchestrator as a Node script (round 2)
scripts/measure.py              tokens and minutes per agent for given session ids
schemas/task-card.schema.json   the task card format
tests/hooks.test.mjs            known-good and known-bad hook inputs
```

**Layout rule:** only `plugin.json` goes inside `.claude-plugin/`; every other folder sits at the plugin root ✅[^cc_plugins].

**Hooks live in `hooks/hooks.json`, not in the agent files.** Plugin subagents "don't support the hooks, mcpServers, or permissionMode frontmatter fields" ✅[^cc_sub]. Hooks from plugins also run inside subagents, and their input carries `agent_id` and `agent_type` ✅[^cc_hooks]. So each script reads `agent_type` itself.

**What the gate does when the implementer tries to stop:**
1. It runs the card's check commands, then a scope check: `git status --porcelain=v1 -uall`, compared against `allowed_paths` and `protected_paths`.
2. On failure it prints `{"decision":"block","reason":"…"}` with the failures cut to about 3,000 characters. The full log goes to `.archkit/runs/<id>/gate-<n>.log`.
3. After 3 failed attempts it lets the implementer stop.
4. It records the outcome in `gate.json`.

**What the guard does:** before an implementer's Edit or Write, it exits 2 when the file is outside `allowed_paths` or inside `protected_paths`. The message goes back to the model.

**The trial project:**
- TypeScript 6.0.3, ESLint 10.15.0 with typescript-eslint 8.74.0, Vitest 5.1.1; ESLint rules `complexity: 8` and `max-lines-per-function: 40`. TypeScript 7.0.2 was the newest release, but typescript-eslint 8.74.0 accepts TypeScript `>=4.8.4 <6.1.0` (`npm view`, 2026-11-24).
- Each task has a card and acceptance tests written beforehand, which the agents may not change.
- A reference solution written by hand proved every task solvable before any agent ran.

---

## 3. Experiments

### E1. Where a nine-role framework's tokens went (2026-11-24)
- **Question:** why did each role run of an earlier nine-role framework take about 19 minutes?
- **Result:** the first request was about 57,000 tokens per role. All rule files were loaded up front, and file reads went through the shell unfiltered.
- **Full case:** [the measured case in efficient-coding-agents-deep-dive.md](../efficient-coding-agents-deep-dive.md) §4. It is not repeated here.

### E2. First-request size by tool set (2026-11-24)
- **Question:** how much does the inherited tool set add to a subagent's start?
- **Result:**
  - agents with a short `tools` list started at 4,324–13,219 tokens;
  - agents with all tools started at 52,120–57,191 ✅[^lab].
- **Where recorded:** [session-start-context-by-agent.md](../session-start-context-by-agent.md), Measured on this machine.

### E3. The hooks, tested before use (2026-11-24, extended 2026-11-25)
- **Question:** do the guard and the gate allow and block exactly what they should?
- **Setup:** `node --test tests/hooks.test.mjs` feeds each script hook input JSON on stdin, inside a throwaway git repository with an active task.
- **Cases (13):**
  - guard allows the implementer an allowed path;
  - guard denies a namespaced `archkit-build:implementer` editing a protected test;
  - guard denies a file outside `allowed_paths`;
  - guard denies a file outside the project;
  - guard does not limit the main session or the reviewer;
  - guard does nothing with no active task;
  - gate lets a passing implementer stop;
  - gate blocks with the failing check's text (under 3,200 characters);
  - gate gives up after 3 attempts and records `gave_up`;
  - gate's scope check catches files changed through Bash;
  - gate does not gate other agents;
  - gate handles a `Stop` from a session run as the implementer;
  - gate does not gate a default session's `Stop`.
- **Result:** 13 of 13 passed ✅[^lab].
- **Conclusion:** the guard only sees Edit and Write. The gate's `git status` scope check is the backstop for edits made through Bash.

### E4. Can the reviewer catch what the tests miss? (2026-11-24)
- **Question:** before trusting the reviewer, does it fail a change that passes every check but breaks a criterion?
- **Setup:** two diffs for the same task (role inheritance).
  - **Good:** own permissions first, then parents depth first, with a unit test for the order.
  - **Bad:** parents' permissions first, no order test. It passes typecheck, lint and all 34 tests.

  The reviewer ran through a minimal main session that launched `archkit-build:reviewer` with the card, diff and gate paths.
- **Result** ✅[^lab]:

| Diff | Verdict | Findings | Reviewer first request | Reviewer cumulative input |
|---|---|---|---|---|
| Good | `pass` | none (reply wrapped the JSON in a code fence, with prose after it) | 4,668 | 32,792 |
| Bad | `fail` | the order defect at the right line (34) as a blocker; a second blocker that was wrong ("no tests" for criteria the protected acceptance tests covered); one minor | 4,652 | 21,037 |

- **Conclusion:**
  - The reviewer caught the defect that tests miss.
  - It also produced a false blocker, and it did not always reply with JSON only. Parse its reply defensively, and do not let one reviewer verdict be final.

### E5. Round 1: one agent against the plugin, with a model orchestrator (2026-11-24)
- **Question:** does the harness (orchestrator skill in the main session, implementer subagent, gate, guard, reviewer) beat one agent on cost or quality?
- **Setup:**
  - three sequential tasks: a permission value object; deny-by-default access; role inheritance with cycles;
  - Sonnet everywhere, headless `claude -p`, each arm on a fresh copy, run once;
  - **A:** `claude -p "Implement the task card .archkit/tasks/T1.json. …" --model sonnet --permission-mode acceptEdits --allowedTools …`;
  - **B:** `claude -p "/archkit-build:build-task .archkit/tasks/T1.json" --plugin-dir <plugin> …`.
- **Result** ✅[^lab]:

| Task | A: requests · cumulative input · seconds · USD | B: requests · cumulative input · seconds · USD | B implementer: first · peak request | B orchestrator: cumulative input |
|---|---|---|---|---|
| T1 | 6 · 266,518 · 25 · 0.13 | 14 · 406,675 · 44 · 0.20 | 6,688 · 11,023 | 358,393 |
| T2 | 5 · 220,986 · 31 · 0.13 | 18 · 484,650 · 54 · 0.21 | 6,721 · 12,625 | 405,709 |
| T3 | 7 · 323,601 · 31 · 0.16 | 28 · 636,487 · 82 · 0.30 | 6,744 · 14,791 | 463,013 |

- **What happened:**
  - Both arms passed every check on all three tasks, and both met the criterion the tests did not check (the order of inherited permissions).
  - B used 1.5–2.2× the tokens (T1 406,675 ÷ 266,518 = 1.53; T2 484,650 ÷ 220,986 = 2.19; T3 636,487 ÷ 323,601 = 1.97) and took 1.7–2.6× as long (44 ÷ 25, 54 ÷ 31, 82 ÷ 31). Most of B's cost was the orchestrator: a model in the main session, carrying a start-up block of about 41,000 tokens on each of 8–10 requests.
  - **Defects:**
    - the orchestrator's diff command `git add -A && git diff --cached $(cat …/base.txt) > …` was denied by the headless permission rules;
    - in T3 the orchestrator ran the reviewer before the diff existed, so the reviewer ran twice;
    - the orchestrator's replies followed the user's global `CLAUDE.md` (greeting and four-part answer format).
- **Conclusion:**
  - On small, well-specified tasks with acceptance tests, one agent plus checks was enough.
  - Isolating the worker saved tokens at its start (6,700 against 40,400). But an orchestrator that is a model repeats a large start-up block on every step.
  - The steps are fixed, so they can run as code.

### E6. A plugin's agent as the whole session (2026-11-25)
- **Question:** can a session run as a plugin agent, and what does it get?
- **Setup:** `claude -p "<prompt>" --plugin-dir <plugin> --agent archkit-build:reviewer --model haiku --settings '<a debug hook that saves the Stop input>' --output-format json`.
- **Result** ✅[^lab]:

| Check | Result |
|---|---|
| Plugin agent accepted as the session | Yes, as `<plugin-name>:<agent-name>` |
| Tools | Only the agent's: a test agent with `tools: Read` replied "NO-GLOB" when told to use Glob, and made no tool call; a default session in the same folder used Glob |
| First request | 6,957 tokens (reviewer agent); a default session on this machine: 40,420 |
| Event when it finishes | `Stop`, not `SubagentStop` |
| Hook input | Carries `agent_type: "archkit-build:reviewer"` |

- **Conclusion:** any agent definition, including a plugin's, can be the whole session, and hooks can tell which agent it is. This is what lets a script start each agent directly (E10).

### E7. When does `CLAUDE.md` load? `omitClaudeMd` in both modes (2026-11-25)
- **Question:** does `omitClaudeMd: true` keep the instruction files out of an agent, as a subagent and as the whole session?
- **Setup:**
  - a test plugin with two agents, both `tools: Read`, `model: haiku`: `with-omit` (`omitClaudeMd: true`) and `no-omit` (the field left out);
  - the user's global `CLAUDE.md` tells the model to start every reply by greeting the user as "V". That greeting is the visible marker;
  - each agent was asked "What is 2+2?", once as the whole session (`--agent`) and once as a subagent launched by a default session.
- **Result** ✅[^lab]:

| Mode | `omitClaudeMd` | Reply | First request | Instruction files loaded? |
|---|---|---|---|---|
| Whole session (`--agent`) | `true` | "V, 2 + 2 = 4." | 4,211 | Yes: the field is ignored |
| Whole session (`--agent`) | left out | (asked to list tools) "V …" | 4,210 | Yes |
| Subagent | `true` | "4" | 2,688 | No |
| Subagent | left out | "V, 2 + 2 = 4." | 4,689 | Yes |

- **The docs agree:** `omitClaudeMd` is "Ignored when the agent runs as the main session agent" ✅[^cc_sub].
- **Project-level `CLAUDE.md`:** this test could not tell, because it ran in a temporary folder where a project `CLAUDE.md` never loads. E12 settles it.
- **Side finding:** asked to list its tools, the `with-omit` subagent answered "Read, Grep, Glob, Edit, Write, Bash, and Agent, plus deferred tools". Yet it had only Read: told to use Glob, it said "NO-GLOB". **An agent's own list of its tools is not evidence.** Test by calling a tool.
- **Conclusion:** to keep the user's instructions out of an agent, run it as a subagent with `omitClaudeMd: true`. As the whole session, with the default settings sources, it gets them anyway: about 1,800 tokens here, plus whatever behaviour they ask for. `--setting-sources project,local` changes this (E13, E15, E18).

### E8. What the start-up block holds (2026-11-25)
- **Question:** is the ~41,000-token start of a default session mostly `CLAUDE.md`?
- **Setup:** `claude -p "/context"` prints Claude Code's estimate by category, without a model call.
- **Result** ✅[^lab]:

| Category | Default session | Session as the implementer (`--agent archkit-build:implementer`) | Session as a one-tool test agent |
|---|---|---|---|
| System prompt | 2.9k | 350 (the agent's own body) | 20 |
| System tools | 16.6k | 3k (six tools) | 1k (one tool) |
| Skills list | 6.3k | none listed | none listed |
| Custom agents list | 378 | 508 | 442 |
| Memory files (`CLAUDE.md` and its import) | 1.8k | 1.8k | 1.8k |
| Total, as `/context` estimates it | 28.2k | 5.7k | about 3.3k |

- `/context` also showed 21.4k tokens of "System tools (deferred)". They are not in the 28.2k total.
- The default session's measured first request was 40,420 tokens, about 12,000 more than the estimate. E11 traces where the difference comes from.
- **Conclusion:** `CLAUDE.md` is about 1.8k of the start. Most of it is tool definitions (16.6k) and the skill list (6.3k). Running as an agent replaces the system prompt with the agent's body, keeps only its tools, and drops the skill list.

### E9. Does the guard work when the implementer is the whole session? (2026-11-25)
- **Question:** in `--agent` mode, does `PreToolUse` input carry `agent_type`, so the guard acts?
- **Setup:**
  - a throwaway repository with an active task allowing only `src/domain/**`;
  - `claude -p "Create the file notes.md … If the tool call is refused, report the refusal message word for word." --plugin-dir <plugin> --agent archkit-build:implementer --model haiku --permission-mode acceptEdits`, plus a debug `PreToolUse` hook through `--settings` that saved its input.
- **Result** ✅[^lab]:
  - the hook input had `hook_event_name: "PreToolUse"` and `agent_type: "archkit-build:implementer"`;
  - the file was not created;
  - the model quoted the guard: "notes.md is outside task E1's allowed_paths (src/domain/**). Stay inside them, or stop with status "blocked" and say why.";
  - the gate also ran on `Stop` and wrote `gate.json`.
- **Conclusion:** both hooks work unchanged when the implementer is the whole session. Its reply still began with the user's greeting, as E7 predicts.

### E10. Round 2: three arms, script orchestrator, harder tasks (2026-11-25)
- **Question:** without a model orchestrator, what do lean context plus gates add, and what does the reviewer add, on tasks with traps?
- **Tasks**, built on the round-1 code; each has one criterion the acceptance tests do not check, verified afterwards by a hidden check:
  - **T4:** time-limited role grants with an injected clock. Boundary trap: active "at validUntil, inactive 1 ms later". Hidden check: no `Date.now()` or argument-less `new Date()` in `src/domain` outside `clock.ts`.
  - **T5:** `explain()` returns why access is allowed or denied, while `can()` and `canAccess()` keep their signatures. Hidden check: with several granting roles, `grantedBy` names the first one given.
  - **T6:** a behaviour-preserving refactor into `anyCovers()`. Hidden check: no direct `.covers(` call outside `permission.ts` and `permission-set.ts`.
- **Arms**, each run twice, on a fresh copy, T4 → T6:
  - **A:** a default session given the card;
  - **A+:** `node build-task.mjs <card>`: the implementer as the whole session (`--agent`), guard and gate, no reviewer;
  - **B:** `node build-task.mjs <card> --review`: A+, then the reviewer and at most one fix round. The script writes the diff itself, so no agent needs shell access for it.
- **Result, every run** ✅[^lab]:

| Arm | Rep | Task | Checks · hidden · scope | Result (gate attempts, reviews, fix rounds) | Requests | Cumulative input | Implementer first request | Seconds | USD |
|---|---|---|---|---|---|---|---|---|---|
| A | 1 | T4 | pass · pass · pass | — | 7 | 319,089 | 40,521 | 29 | 0.151 |
| A | 1 | T5 | pass · pass · pass | — | 7 | 316,839 | 40,545 | 26 | 0.140 |
| A | 1 | T6 | pass · pass · pass | — | 9 | 408,418 | 40,568 | 29 | 0.144 |
| A | 2 | T4 | pass · pass · pass | — | 7 | 320,814 | 40,525 | 30 | 0.157 |
| A | 2 | T5 | pass · pass · pass | — | 7 | 316,965 | 40,552 | 25 | 0.133 |
| A | 2 | T6 | pass · pass · pass | — | 6 | 267,751 | 40,569 | 20 | 0.121 |
| A+ | 1 | T4 | pass · pass · pass | pass (1, 0, 0) | 7 | 83,412 | 8,202 | 32 | 0.098 |
| A+ | 1 | T5 | pass · pass · pass | pass (1, 0, 0) | 10 | 137,343 | 8,201 | 34 | 0.091 |
| A+ | 1 | T6 | pass · pass · pass | pass (1, 0, 0) | 5 | 54,877 | 8,202 | 20 | 0.067 |
| A+ | 2 | T4 | pass · pass · pass | pass (1, 0, 0) | 5 | 55,661 | 8,205 | 22 | 0.049 |
| A+ | 2 | T5 | pass · pass · pass | pass (1, 0, 0) | 6 | 67,746 | 8,203 | 24 | 0.056 |
| A+ | 2 | T6 | pass · pass · pass | pass (1, 0, 0) | 9 | 112,688 | 8,201 | 27 | 0.068 |
| B | 1 | T4 | pass · pass · pass | pass (1, 1, 0) | 9 | 94,325 | 8,196 | 40 | 0.147 |
| B | 1 | T5 | pass · pass · pass | pass (2, 2, 1) | 22 | 255,758 | 8,197 | 75 | 0.217 |
| B | 1 | T6 | pass · pass · pass | pass (1, 1, 0) | 10 | 104,906 | 8,195 | 33 | 0.096 |
| B | 2 | T4 | pass · pass · pass | pass (2, 2, 1) | 16 | 174,837 | 8,200 | 67 | 0.181 |
| B | 2 | T5 | pass · pass · pass | pass (1, 1, 0) | 12 | 147,228 | 8,196 | 42 | 0.117 |
| B | 2 | T6 | pass · pass · pass | pass (1, 1, 0) | 11 | 118,737 | 8,197 | 34 | 0.090 |

- **Per arm, summed over its six task runs** ✅[^lab]:

| Arm | Checks · hidden · scope passed | Cumulative input | USD | Seconds |
|---|---|---|---|---|
| A | 6 · 6 · 6 of 6 | 1,949,876 | 0.846 | 159 |
| A+ | 6 · 6 · 6 of 6 | 511,727 | 0.429 | 159 |
| B | 6 · 6 · 6 of 6 | 895,791 | 0.848 | 291 |

- **What happened:**
  - Every run passed every check, every hidden check and the scope check. On these tasks the traps did not separate the arms: Sonnet met every criterion each time ✅[^lab].
  - **A+ against A:** 26 % of the cumulative input (511,727 against 1,949,876), 51 % of the cost, the same wall-clock time. The implementer's first request was 8,195–8,205 tokens against A's 40,521–40,569. E8's `/context` estimate for the same agent was 5.7k, and that already includes 1.8k of `CLAUDE.md`; the rest of the difference is `/context` counting low (E11) plus the task prompt ✅[^lab].
  - **B against A+:** 75 % more input and 83 % more time, for no change in any result.
  - **The reviewer's failures were false.** The reviewer failed 2 of 8 reviews (rep 1 T5, rep 2 T4), each time claiming that criteria AC-1 to AC-4 had no tests. For example: "No test checks time == validUntil (active) or validUntil + 1ms (inactive)". But the protected acceptance tests check exactly that. The reviewer never saw them, because its prompt said "Read only the diff, the files it touches and the card's `examples`". Each false failure cost a fix round and a second review ✅[^lab].
  - **Permission denials:** 1 in A+ and 2 in B, over the 22 implementer and reviewer sessions of reps 1–2 (A+: 6 implementer sessions; B: 8 implementer sessions, counting 2 fix rounds, and 8 reviews), all for shell commands outside the card's check commands. None stopped a task ✅[^lab].
- **Conclusion:**
  - The cost saving comes from the lean worker plus checks run by code, not from adding agents.
  - An evaluator sees only what its prompt lets it read. Limit it to the diff, and it reports covered criteria as untested.
  - In reps 1–2 the reviewer did not pay for itself on these tasks. Where it might pay off is where a single agent actually fails: larger or ambiguous tasks, untested criteria that matter. That still has to be shown. Rep 3, below, reran B after a prompt fix.
- **Fix and re-run (rep 3, arm B only).** The reviewer's prompt now tells it to read the tests that `checks.test` runs, including the protected acceptance tests, and says that those count as tests. Arm B then ran once more ✅[^lab]:

| Task | Checks · hidden · scope | Result (gate attempts, reviews, fix rounds) | Requests | Cumulative input | Seconds | USD |
|---|---|---|---|---|---|---|
| T4 | pass · pass · pass | pass (1, 1, 0) | 9 | 96,195 | 38 | 0.110 |
| T5 | pass · pass · pass | pass (2, 2, 1) | 19 | 204,708 | 65 | 0.185 |
| T6 | pass · pass · pass | pass (1, 1, 0) | 11 | 115,601 | 35 | 0.101 |

  - The false "no tests" failures were gone.
  - The one failure left was a real gap. In T5 the reviewer wrote that the acceptance tests cover AC-1 to AC-5, but no test covered AC-6 (the first granting role is named), and the change added none. In the fix round the implementer added `test/unit/role-catalog.test.ts`, and the second review passed. The code already met AC-6, as the hidden check showed, so the finding closed a test gap, not a defect.

### E11. Why the real first request is larger than `/context` says (2026-11-25)
- **Question:** a default session's first request measured about 38,000–40,000 tokens, but `/context` estimated 28.2k. Where do the other ~10,000 come from?
- **Setup:**
  - a new, empty git folder, Claude Code 2.1.332, Sonnet, prompt "Reply with OK.";
  - the real size is input + cache-creation + cache-read tokens from `--output-format json`;
  - the transcript holds a `prompt_snapshot` attachment (system prompt blocks and tool definitions as sent) and `api-request-blob` lines (the messages as sent). Their sizes were measured in characters;
  - then tools were removed with `--disallowedTools`, and the real size and `/context` were compared for each case.
- **The request, as recorded** ✅[^lab]:

| Part | Characters | Shown by `/context` as |
|---|---|---|
| System prompt, 12 blocks | 8,901 | System prompt 2.9k |
| 12 tool definitions (Artifact alone 61,300) | 111,810 | System tools 16.6k |
| A system-role message: environment 2,292 | 2,292 | not listed |
| … deferred-tool names | 798 | not listed (its "System tools (deferred)" 21.4k is the size of the schemas, which are not sent) |
| … agent listing, built-in and custom agents | 5,923 | Custom agents 378 (custom agents only) |
| … MCP server instructions | 2,018 | not listed |
| … Artifact tool instructions | 2,079 | not listed |
| … skill listing | 19,144 | Skills 6.3k |
| User-message reminder with `CLAUDE.md` | 5,212 | Memory files 1.8k |
| Other user-message reminders (user context, commit attribution) | 1,534 | not listed |
| Three MCP tool definitions added inline | 2,169 | not listed |
| The prompt | 14 | Messages 10 |

  The whole request is 161,894 characters for 38,965 tokens, about 4.2 characters per token.

- **Removing tools, real against estimated** ✅[^lab]:

| Removed | Real first request | Real drop | `/context` total | `/context` drop |
|---|---|---|---|---|
| nothing (two runs) | 38,965 · 38,966 | — | 28.2k | — |
| Artifact | 26,040 (two runs) | 12,925 | 15.9k | 12.3k |
| Workflow and ScheduleWakeup | 34,216 | 4,749 | 24.4k | 3.8k |
| Agent (its tool and the agent listing) | 35,141 | 3,824 | 26.4k | 1.8k |
| MCP servers (`--strict-mcp-config`) | 38,964 | 1 | — | — |

- **Conclusion: no single hidden part; the gap has two measured causes.**
  1. **Parts of the request that `/context` does not list:**
     - the built-in agent listing;
     - the deferred-tool names;
     - the MCP server instructions;
     - the Artifact tool's extra instructions;
     - the environment block;
     - the user-context and attribution reminders;
     - the inline MCP tool definitions.

     Together they are 16,813 characters, about 4,000 tokens at the request's average. The Agent row shows the effect directly: the real drop (3,824) is twice the estimated drop (1.8k), because the agent listing goes with the tool.
  2. **`/context` counts the parts it does list too low:** real drops were 1.05× (Artifact) to 1.25× (Workflow and ScheduleWakeup) the estimated drops. Over 16.6k of tool estimates that is roughly 1,000–4,000 tokens.

  The remainder, up to about 5,000 tokens, was not split further. `--strict-mcp-config` changed nothing, so locally configured MCP servers are not the cause.
- **Side finding:** the claude.ai **Artifact** tool alone is about 12,900 tokens of every default session's first request here, a third of it. A worker that does not need it saves that much by leaving it out of its `tools`.
- **Side finding:** with `--disallowedTools Skill` the request got larger (41,761), and `/context` reported 32.3k for tools. Removing the Skill tool changes what else is loaded, so it is not a clean ablation.

### E12. When does a project's `CLAUDE.md` load? By working folder and mode (2026-11-25)
- **Question:** does the `CLAUDE.md` in a project folder load when the session runs as an agent (`--agent`), and does it depend on the working folder?
- **Setup:**
  - a git repository `repo/` whose `CLAUDE.md` says "The project codename is ZEBRA-42", and a non-git folder `plain/` whose `CLAUDE.md` says "OTTER-77";
  - each case asked "What is the project codename? Reply with only the codename, or UNKNOWN", and `/context` listed the memory files loaded;
  - agent mode used the E7 test agent (`tools: Read`, `omitClaudeMd: true`).
- **Result** ✅[^lab]:

| Working folder | Mode | Project `CLAUDE.md` listed by `/context` | Answer |
|---|---|---|---|
| `repo/` under `~/workspace` | default | `repo/CLAUDE.md` | ZEBRA-42 |
| `repo/` | `--agent` | `repo/CLAUDE.md` | ZEBRA-42 |
| `repo/src/deep/` (two levels below) | `--agent` | `repo/CLAUDE.md` | ZEBRA-42 |
| `plain/` (no git) | `--agent` | `plain/CLAUDE.md` | OTTER-77 |
| the parent of `repo/` | `--agent` | none | UNKNOWN |
| `repo/`, as a subagent with `omitClaudeMd: true` | subagent | — | ZEBRA-42, but only after it used Read on `repo/CLAUDE.md` itself; its first request was 2,611 tokens, against 4,694 for the agent without `omitClaudeMd` |
| the same folders under `/private/tmp/…` (a session scratchpad) | default and `--agent` | none, only the user-level files | UNKNOWN |

- **Conclusion:**
  - A project `CLAUDE.md` loads from the working folder and every folder above it, in default and `--agent` mode alike. Git is not needed.
  - A `CLAUDE.md` in a folder below the working folder does not load at the start.
  - `omitClaudeMd: true` keeps project and user files out of a subagent's start, but an agent with Read can still open the file.
  - In folders under `/private/tmp/…`, no project `CLAUDE.md` loaded in any mode. The cause was not found in the docs read; it is an observation. Run tests that involve project files in a normal folder.

### E13. Dropping the user's settings layer: `--setting-sources project,local` (2026-11-25)
- **Question:** can a worker session start without the user's instructions, plugins and hooks, while the harness plugin and its hooks still work?
- **Background:** `--setting-sources` takes a comma-separated list of the settings layers to load:
  - `user`: `~/.claude/settings.json`;
  - `project`: `.claude/settings.json`;
  - `local`: `.claude/settings.local.json`.

  Left out, all three load.
- **Setup:**
  - a git folder under `~/workspace` with a project `CLAUDE.md`, Claude Code 2.1.332;
  - the user layer here enables two plugins and the user's hooks, and `~/.claude/CLAUDE.md` is one line that imports `~/.agent-config/instructions/core.instructions.md`.
- **Result** ✅[^lab]:

| Run | Real first request | Memory files `/context` lists | Reply |
|---|---|---|---|
| Default session | 37,915 | `~/.claude/CLAUDE.md`, its import `core.instructions.md`, the project `CLAUDE.md` | "OK" |
| Default session, `--setting-sources project,local` | 32,029 | `~/.claude/CLAUDE.md` and the project `CLAUDE.md`; the import was not loaded | "OK" |
| `--agent archkit-build:implementer --plugin-dir <plugin>`, `--setting-sources project,local` | 4,780 (round 2's implementer sessions without the flag: 8,195–8,205) | 56 tokens of memory files; custom agents 130 | no greeting; the guard refused a file outside `allowed_paths`, and the gate ran on `Stop` |

- **Conclusion:**
  - Leaving out the user layer removes what it brings: user-enabled plugins and their skills, user hooks, user permissions. In this test it also removed the instructions imported by `~/.claude/CLAUDE.md`, while the one-line file itself still loaded. E15 explains why.
  - A plugin given with `--plugin-dir`, and its hooks, keep working.
  - **Cost:** the worker also loses the user's permission rules and environment settings, so it needs its own (`--allowedTools`, or the project's settings).
  - **Side finding:** the test project's own CLI output file (`out.json`, written into the project folder) made the gate's scope check fail three times. Keep harness output outside the project, or under `.archkit/`.

### E14. What the Artifact tool is, and turning it off (2026-11-25)
- **Question:** what is the tool that takes about 12,900 tokens in E11, and can it be left out without a CLI flag?
- **What it is,** from the tool's own description in the recorded request (E11) ✅[^lab]: `Artifact` is a tool this Claude Code installation gets from the user's claude.ai account and the desktop app. It publishes an HTML page as a private web page on claude.ai, and can read, list, delete and pin such pages, upload assets, and start from page types (decks, documents, dashboards). It is not a file in the project.

  In the recorded request its definition is 61,300 characters: a 22,367-character description and a 38,884-character input schema. A further 2,079-character "Artifact tool instructions" block sits in the system-role message ✅[^lab].
- **Result: turning it off, same folder as E13** ✅[^lab]:

| Run | Real first request |
|---|---|
| Default session | 37,915 |
| `--disallowedTools Artifact` | 27,718 |
| `--settings '{"permissions":{"deny":["Artifact"]}}'` | 27,722 |

- **The settings switch, measured on 2026-11-25 in a fresh git folder under `~/workspace`** ✅[^lab]:

| Run | Real first request |
|---|---|
| Default session | 38,826 |
| `--settings '{"enableArtifact": false}'` | 25,233 |
| `--settings '{"permissions":{"deny":["Artifact"]}}'` | 25,897 |
| both | 25,233 |

- **Conclusion:**
  - A `deny` rule takes the tool out of the request just as the flag does: 10,200 to 12,900 tokens, depending on the folder.
  - The settings key `enableArtifact: false` removes a little more (13,593 here), because it also drops the Artifact instructions block from the system-role message. The settings schema says that off "in any of managed, --settings, or user settings wins" ✅[^schema].
  - **Where to set it:** in user settings it turns the feature off in every session. The user here had no published pages, so it was set there: `"enableArtifact": false` in `~/.claude/settings.json`, 2026-11-25. Afterwards a new default session started at 25,233 tokens, about 35 % less.

### E15. Why the user file's import disappeared: which `CLAUDE.md` files and imports load per settings layer (2026-11-25)
- **Question:** in E13, with `--setting-sources project,local`, `~/.claude/CLAUDE.md` still loaded but the file it imports did not. Why?
- **Setup:**
  - a git repository under `~/workspace` whose `CLAUDE.md` imports `@docs/inside.md` (inside the repository) and `@~/workspace/…/outside.md` (outside it);
  - `~/.claude/CLAUDE.md` is one line importing `@~/.agent-config/instructions/core.instructions.md`;
  - `/context` lists every memory file loaded, with its type;
  - the same repository was then copied to `/Users/Shared/`, outside the home folder.
- **Result** ✅[^lab]:

| Repository under | `--setting-sources` | Memory files listed (type) |
|---|---|---|
| `~/workspace` | not given, or `user,project,local` | `~/.claude/CLAUDE.md` (User), its import `core.instructions.md` (User), `repo/CLAUDE.md` (Project), `docs/inside.md` (Project) |
| `~/workspace` | `user` | the two User files only; no project file |
| `~/workspace` | `project,local` or `project` | `~/.claude/CLAUDE.md` labelled **Project**, without its import; `repo/CLAUDE.md`; `docs/inside.md` |
| `~/workspace` | `local` | none |
| `/Users/Shared` | not given | as the first row |
| `/Users/Shared` | `project,local` | `repo/CLAUDE.md` and `docs/inside.md` only; no `~/.claude/CLAUDE.md` |

  In every run, the import that points outside the repository (`outside.md`) was not loaded. Real first requests in `/Users/Shared`: 38,971 tokens by default, 33,024 with `project,local`.
- **Conclusion:**
  1. **Which layer loads which file.** The `user` setting source loads the user's memory files, and the `project` source loads the project's, including every `CLAUDE.md` or `.claude/CLAUDE.md` found while walking up from the working folder.
  2. **Why the user file came back under another label.** Under the home folder, that walk reaches `~/.claude/CLAUDE.md`, so with `user` off the file still loads, now as a **project** file.
  3. **Why its import was dropped.** As a project file, its import points outside the project. Imports from outside the project stay off until approved, and the headless `-p` mode never shows the approval dialog, so the import is skipped. `outside.md` was skipped the same way.
  4. **Outside the home folder,** the walk never reaches `~/.claude/`, so `project,local` loads no user file at all.

  **Supporting record:** `~/.claude.json` keeps two flags for each project, `hasClaudeMdExternalIncludesApproved` and `hasClaudeMdExternalIncludesWarningShown`. On this machine all 15 projects had both `false`. So no project has approved its external imports, and a project file's import from outside the project does not load in any session until approved.

  **For a harness:** workers started with `--setting-sources project,local` in a repository get only the project's own memory files and in-project imports. If the repository is under the home folder, they also get the one-line `~/.claude/CLAUDE.md`, but not what it imports from outside the repository. A worker started in the home folder itself does get the import (E18).

### E16. The full matrix: does the user's imported instruction file load? (2026-11-25)
- **Question:** a session the user started interactively in `/Users/Shared` greeted them as "V", which means the instructions imported by `~/.claude/CLAUDE.md` loaded. That looked like a contradiction with E15. Which combinations load the imported file?
- **Setup:**
  - two projects, each placed once under `~/workspace` (inside the home folder) and once under `/Users/Shared` (outside it): `plain/` with a project `CLAUDE.md`, and `withimport/` whose project `CLAUDE.md` also imports `@~/.agent-config/instructions/core.instructions.md` (the file the user's `~/.claude/CLAUDE.md` imports);
  - each was run with default settings sources and with `--setting-sources project,local`;
  - per run, `/context` listed the memory files, and the reply to "What is 2+2?" showed whether the imported instructions (which ask for a greeting "V") were followed.
- **Result** ✅[^lab]:

| Project under | Project file | Settings sources | Memory files listed (type) | Reply |
|---|---|---|---|---|
| `~/workspace` | plain | default | `~/.claude/CLAUDE.md` (User), `core.instructions.md` (User), project `CLAUDE.md` | "V — 2+2 = 4." |
| `~/workspace` | plain | `project,local` | `~/.claude/CLAUDE.md` (Project), project `CLAUDE.md` | "4" |
| `~/workspace` | with import | default | as the first row | "V, 2+2 = 4." |
| `~/workspace` | with import | `project,local` | `~/.claude/CLAUDE.md` (Project), project `CLAUDE.md`; neither import loaded | "4" |
| `/Users/Shared` | plain | default | `~/.claude/CLAUDE.md` (User), `core.instructions.md` (User), project `CLAUDE.md` | "V, 2+2 = 4." |
| `/Users/Shared` | plain | `project,local` | project `CLAUDE.md` only | "4" |
| `/Users/Shared` | with import | default | as the previous default row (the import is listed once, as User) | "V, 2+2 = 4." |
| `/Users/Shared` | with import | `project,local` | project `CLAUDE.md` only; its import not loaded | "4" |

- **Conclusion:**
  1. **Default settings sources, any working folder:** the user's file and its import load. That is why the interactive session in `/Users/Shared` greeted the user. There was no contradiction: E15's rows where no user file loaded were all run with `--setting-sources project,local`.
  2. **Only with the user layer off** (`project,local`) does the imported instruction file disappear, inside or outside the home folder.
  3. **A project file that imports a file outside the project** does not get it in headless runs. It adds nothing when the user layer already loads the same file.
  4. The interactive approval prompt for such an import is tested in E17.

### E17. The approval prompt for external imports, in interactive sessions (2026-11-25)
- **Question:** when does an interactive session ask before loading an `@` import that points outside the project?
- **What the user saw first:**
  - In the `agentic-sdlc` repository, the user put a `CLAUDE.md` with the same single line as `~/.claude/CLAUDE.md`: `@~/.agent-config/instructions/core.instructions.md`.
  - `claude --setting-sources=project,local` showed "Allow external CLAUDE.md file imports?", listing the absolute path of `~/.agent-config/instructions/core.instructions.md`, with the choices "No, disable external imports" and "Yes, allow external imports".
  - Plain `claude` in the same repository did not ask.
  - Separately, `claude` started in the home folder asked a different question, the workspace-trust prompt ("This is your home folder, so Yes lasts for this session only").
- **Setup to explain it:**
  - four new folders under `/Users/Shared`, a folder already trusted;
  - each was started interactively under a pseudo-terminal: an `expect` script, 140×40, recording 12 seconds of the start-up screen and then pressing Ctrl-C twice without answering anything;
  - the recorded screen was stripped of terminal codes and searched for the prompt.
- **Result** ✅[^lab]:

| Case | Project `CLAUDE.md` imports | Settings sources | Start-up screen |
|---|---|---|---|
| A | `@~/.agent-config/instructions/core.instructions.md` (the file the user layer already loads) | default | main screen, no prompt |
| B | the same | `project,local` | import-approval prompt |
| C | `@~/workspace/…/outside-note.md` (a file nothing else loads) | default | import-approval prompt |
| D | the same as C | `project,local` | import-approval prompt |
| E | `@/Users/Shared/…-note.md` (outside the home folder) | default | import-approval prompt |
| F | `@~/.agent-config/global-variables.md` (same folder as the user's import, inside the home folder, but not imported by the user's files) | default | import-approval prompt |

  Quitting without an answer left the project's flags in `~/.claude.json` at `hasClaudeMdExternalIncludesApproved: false` and `hasClaudeMdExternalIncludesWarningShown: false`.
- **Conclusion:**
  - A project file's import from outside the project needs the user's approval in every settings combination (C, D).
  - Case A asked nothing because the file is already loaded through the user layer, so there is nothing new to approve. With the user layer off (B), the same import is new, and the prompt appears.
  - **The home folder gives no exemption.** Rows C and F import files inside the home folder; F even sits in the same folder as the user's own import. Both still prompted. Row E, outside the home folder, prompted too. The only file that passed without a prompt was the exact one the user layer already loads (A).
  - Headless `-p` runs never show the prompt and skip the import (E15, E16).
  - The workspace-trust prompt is a separate check, about the folder rather than the imports.

### E18. Started in the home folder with `--setting-sources project,local` (2026-11-25)
- **Question:** in the home folder, with the user layer off, does Claude ask about the import in `~/.claude/CLAUDE.md`, and does the imported file load? In a repository it asked (E17, case B).
- **Setup:**
  - the home folder has no `CLAUDE.md` of its own, only `~/.claude/CLAUDE.md` (a link to a one-line file importing `@~/.agent-config/instructions/core.instructions.md`);
  - `claude -p "/context" --setting-sources project,local`, run in the home folder;
  - the same interactively under `expect`: the home folder's trust prompt was answered "Yes" (the prompt says it "lasts for this session only"), then `/context` was typed.
- **Result** ✅[^lab]:

| Run | Prompt seen | Memory files |
|---|---|---|
| Headless, home folder, `project,local` | none (headless) | `~/.claude/CLAUDE.md` (Project, 28 tokens) and `core.instructions.md` (Project, 1.8k) |
| Headless, home folder, default | none | the same two files, typed User |
| Interactive, home folder, `project,local` | the workspace-trust prompt only, no import prompt | "2 memory files", 1.8k |

- **Conclusion:**
  - With the user layer off, `~/.claude/CLAUDE.md` is found as a project file whenever the working folder is the home folder or below it.
  - Whether its import loads depends on where the working folder is:
    - in the home folder, `~/.agent-config/…` is inside the working folder, so the import loads without a prompt;
    - in a repository, the same path is outside the working folder, so it needs approval (E17).
  - An earlier manual check by the user had seen no loaded instructions in the home folder. That check was not repeated here, and its exact steps are not known.

### E19. `skills:` in an agent: as the session versus as a subagent (2026-11-25)
- **Question:** do skills listed in an agent's `skills:` field load when the agent runs as the session, as they do for a subagent? And what does giving an agent the `Skill` tool cost?
- **Setup:**
  - a test plugin with a skill `kit` whose body holds the codeword HERON-31;
  - an agent `skilled` with `skills: [kit]`, `tools: Read`, `model: haiku`;
  - the prompt: "What is the kit codeword from your preloaded kit skill? Do not use any tool. If it is not in your context, reply NO-SKILL." Run once as the session (`--agent skilltest:skilled`) and once as a subagent launched by a default session, both with `--setting-sources project,local`.
- **Result** ✅[^lab]:

| Mode | Reply | Tool calls | First request |
|---|---|---|---|
| As the session (`--agent`) | "NO-SKILL" | none | 2,943 |
| As a subagent | "HERON-31" | none | 2,773 |

  The `Skill` tool, measured with two test agents run as the session with default settings sources (Haiku, 2.1.332) ✅[^lab]:

| Agent `tools` | Real first request | `/context` |
|---|---|---|
| `Read` | 3,803 | tools 1k, no Skills row |
| `Read, Skill` | 10,548 | a Skills row of 6k, about 30 skills listed |

  So the tool brings the whole skill listing with it: here about 6,700 tokens on every request. How much depends on how many skills the session can see; with the user layer off, fewer user and plugin skills are listed. E8 shows the listing absent for agents without `Skill`.
- **Conclusion:**
  - `skills:` preloads only when the agent runs as a subagent. The docs word the field for subagents ("to preload into the subagent's context at startup") and name only `omitClaudeMd` and `initialPrompt` as behaving specially in session mode ✅[^cc_sub], so this case is undocumented.
  - For an agent that runs as the session, put paths to its reference files in its prompt. That costs only the path; the file enters the context once, when it is read.

### E20. The three settings sources and the memory files each loads, `CLAUDE.local.md` included (2026-11-25)
- **Question:** which memory file does each settings source (`user`, `project`, `local`) bring? Does `CLAUDE.local.md` follow the project rule for imports? And what happens in the home folder?
- **Setup:**
  - a git repository under `~/workspace` with `CLAUDE.md` ("ZEBRA-42") and `CLAUDE.local.md` ("OTTER-7");
  - `/context` run headless with each value of `--setting-sources`;
  - interactively: a folder whose `CLAUDE.local.md` imports a file outside the folder; and the home folder with `project,local`, answering its trust prompt.
- **Result: memory files per settings source** ✅[^lab]:

| `--setting-sources` | Memory files listed (type) |
|---|---|
| not given (all three) | `~/.claude/CLAUDE.md` (User), its import `core.instructions.md` (User), `repo/CLAUDE.md` (Project), `repo/CLAUDE.local.md` (Local) |
| `user` | `~/.claude/CLAUDE.md` (User), `core.instructions.md` (User) |
| `project` | `~/.claude/CLAUDE.md` (Project, found by the walk up from the working folder), `repo/CLAUDE.md` (Project) |
| `local` | `repo/CLAUDE.local.md` (Local) only |
| `project,local` | `~/.claude/CLAUDE.md` (Project), `repo/CLAUDE.md` (Project), `repo/CLAUDE.local.md` (Local) |
| `user,local` | the two User files, `repo/CLAUDE.local.md` (Local) |

- **Result: imports and the home folder** ✅[^lab]:
  - `CLAUDE.local.md` that imports a file outside the working folder, default sources, interactive: the import-approval prompt appeared, as for a project file (E17).
  - Home folder, `project,local`, headless: the reply to "What is 2+2?" began "V, 2 + 2 = 4.", so the imported instructions loaded and were followed (E18 showed them in `/context`).
  - Home folder, interactive: the workspace-trust prompt's default choice is "No, exit". A run that pressed Enter on it got "Claude Code didn't start because this folder isn't trusted." After a run that chose "Yes", `~/.claude.json` still had `hasTrustDialogAccepted: false` for the home folder, so that answer is not saved, as the prompt says ("Yes lasts for this session only"). The project's two external-import flags were also still `false`.
- **Conclusion:**
  - Each settings source brings one kind of memory file: `user` the user's own (`~/.claude/CLAUDE.md` and its imports), `project` the `CLAUDE.md` files from the working folder upward, `local` the `CLAUDE.local.md` files.
  - A file's type decides the import rule. A User file's imports load without asking. A Project or Local file's imports from outside the working folder need approval, unless the same file is already loaded as a User file (E17).
  - The type a file gets depends on which source found it. Under the home folder, `~/.claude/CLAUDE.md` is a User file when `user` is on, and a Project file found by the walk when only `project` is on.
  - In the home folder every interactive start asks the trust question again, and pressing Enter at once exits without starting.

---

## 4. Three ways to orchestrate, compared

| Way | What the orchestrator is | Cost of orchestration | Measured |
|---|---|---|---|
| A skill in the main session | The default session reading `SKILL.md` and following it | About 41,000 tokens per orchestrator request; 358,393–463,013 cumulative per task in E5 | E5: it also ran a step out of order and tripped a permission rule |
| An agent as the whole session | `claude --agent <orchestrator>`: its own prompt and tools | Smaller start (about 3,000–8,200 tokens in E6–E10, E13), still a model on every step | Not run as an orchestrator |
| A script | A program that runs each agent as its own session (`claude -p --agent …`) and handles files and git itself | No model tokens for orchestration | E10: A+ used 54,877–137,343 tokens of cumulative input per task, against A's 267,751–408,418, with the same results |

*(Synthesis.)* When the steps are fixed, as they are here, the orchestration is a workflow, and code runs it more cheaply and more reliably than a model does.

---

## 5. Lessons

1. **Measure the first request of every agent.** It is multiplied by every request that follows (E2, E5, E8).
2. **Give each agent only its tools.** That cuts tool definitions and the skill list at once (E8). One tool, Artifact, is about a third of a default session's start here; deny it wherever pages are not published (E11, E14).
3. **Which memory files load (E7, E12, E15, E16):** a main session, default or `--agent`, loads the user's files with their imports from any working folder, plus the project's files from the working folder upward; `omitClaudeMd` works only for subagents. `--setting-sources project,local` drops the user layer, but under the home folder the upward walk still finds `~/.claude/CLAUDE.md` as a project file, and its imports load only when they are inside the working folder (E15, E18). To keep instruction files out of a worker, use a subagent with `omitClaudeMd: true`, or a session with `project,local` started in a repository.
4. **Do not trust an agent's description of its own tools or context, nor `/context` as an exact count.** Test by calling a tool. Measure real sizes from the CLI's usage numbers: `/context` leaves out several parts and counts the rest low (E7, E8, E11).
5. **Hooks are the part that works in every mode.** They see `agent_type` for subagents and for sessions run as an agent (E6, E9). Put the rules in hooks, not in prose.
6. **Test a check against a known-good and a known-bad sample before relying on it.** This applies to hooks (E3) and to the reviewer (E4).
7. **An orchestrator that is a model costs more than the work it coordinates** when the steps are fixed (E5). Write it as code (E10).
8. **An evaluator only judges what it is allowed to read.** Limited to the diff, it called tested criteria untested, twice in E10 and once in E4. Given the acceptance tests too, it stopped doing so and found a real test gap instead (E10, rep 3).
9. **Add an agent only when a measurement shows the gap it closes.** In E10 reps 1–2 the reviewer added 75 % more input and found no real problem; after its prompt was fixed (rep 3) it found one real test gap, in code that was already correct.
10. **Start workers without the user's layer** (`--setting-sources project,local`) in their repository, and give them their own permissions. That drops the user's plugins, hooks and, for a repository, the user's imported instructions, while the harness plugin keeps working (E13, E15). Started in the home folder, the imported instructions still load (E18).

---

## 6. Repeat it

- **Hook tests:** `node --test tests/*.test.mjs` in the plugin folder.
- **One task through the harness:** in a project with `.archkit/tasks/<id>.json`, run `node <plugin>/scripts/build-task.mjs .archkit/tasks/<id>.json [--review]`. It prints the run record with each session's id, turns, seconds and cost.
- **Tokens per agent:** `python3 -I <plugin>/scripts/measure.py <session-id> …`. It reads `~/.claude/projects/**/<session-id>.jsonl` and the `subagents/` folder beside it. Request size = input + cache-creation + cache-read tokens; repeated message ids are one request.
- **The start-up block:** `claude -p "/context"`, with or without `--agent <name>`.
- **Which hook fires, and with what input:** pass `--settings '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"cat > <file>"}]}]}}'` and read the file.

---

## 7. Verification

- **Measured on 2026-11-24 and 2026-11-25:** every ✅[^lab] result, on one machine with Claude Code 2.1.330 to 2.1.332 (the CLI updated itself during the work; E11 onward ran on 2.1.332). Each arm and test ran once unless stated, so the numbers show size, not run-to-run spread.
- **Checked against the Claude Code docs on 2026-11-24 and 2026-11-25:**
  - plugin-agent frontmatter limits;
  - `omitClaudeMd` in main-session mode;
  - hooks inside subagents and `agent_type`;
  - the plugin layout.
- **Synthesis, not a sourced claim:** the conclusion lines, §4's last paragraph, and §5.
- **Not settled:**
  - about 5,000 tokens of a default session's first request, after E11's two causes;
  - why no project `CLAUDE.md` loads in folders under `/private/tmp/…` (E12);
  - an earlier manual check in the home folder that saw no loaded instructions, which E18 and E20 could not reproduce; E20 shows one way to get that result (Enter on the trust prompt's default "No, exit");
  - the docs text on external-import approval was not read for this notebook; the rule rests on E15–E17.

## References

- Local experiments: the `archkit-build` plugin and its trial projects, run with Claude Code 2.1.330 to 2.1.332 on one machine, 2026-11-24 and 2026-11-25; results read from the CLI's JSON output, the session transcripts and recorded requests (§6 counting rules), `/context`, hook inputs saved by debug hooks, and start-up screens recorded under `expect`. Backs: §2 trial project; §3 E2–E19 results. [^lab]
- [Create custom subagents](https://code.claude.com/docs/en/sub-agents) — Anthropic, living, read 2026-11-25. Backs: §2 plugin-agent frontmatter limits; E7 `omitClaudeMd` ignored in main-session mode; E19 the fields the page names for session mode. [^cc_sub]
- [Hooks reference](https://code.claude.com/docs/en/hooks) — Anthropic, living, read 2026-11-25. Backs: §2 hooks inside subagents, `agent_type`. [^cc_hooks]
- [Plugins reference](https://code.claude.com/docs/en/plugins-reference) — Anthropic, living, read 2026-11-24. Backs: §2 plugin layout. [^cc_plugins]
- Claude Code settings JSON schema, `enableArtifact` entry — bundled with Claude Code 2.1.332, read 2026-11-25. Backs: E14 which settings source wins. [^schema]

## Related

- [Efficient coding agents, end to end](../efficient-coding-agents-deep-dive.md) — the evidence and principles these experiments test.
- [Claude Code subagents and skills](../claude-code-agents-and-skills.md) — where agents load and how to call them, including a plugin agent as the session.
- [What each coding agent loads at session start](../session-start-context-by-agent.md) — the start-up block per agent.
- [Harness engineering, end to end](../harness-engineering-deep-dive.md) — guides, sensors, gates and exit codes.
