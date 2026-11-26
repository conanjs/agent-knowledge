---
schema: deep-dive/v1
topic: ai-agents/harness-lab
status: verified
applies-to: ["Claude Code 2.1.330 and 2.1.332 (CLI, headless -p), Sonnet and Haiku, one macOS machine", "experiments run 2026-11-24 to 2026-11-26"]
last-verified: 2026-11-26
last-updated: 2026-11-26
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

**Depth:** twenty-nine experiments (E1–E29; E10 is a 3-arm, 21-run trial), each with question, setup, command, result and conclusion; four ways to orchestrate, compared with measured costs; the lessons drawn; how to repeat the runs.

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

  The 12 tool definitions one by one, measured as the length of each definition written as JSON (its name, description and input schema), from the same recorded request ✅[^lab]:

| Tool | Characters | | Tool | Characters |
|---|---|---|---|---|
| Artifact | 61,300 | | ListAgents | 3,566 |
| Workflow | 9,487 | | Skill | 3,372 |
| Agent | 8,759 | | ReportFindings | 3,195 |
| ScheduleWakeup | 8,096 | | Read | 2,863 |
| Bash | 6,172 | | ToolSearch | 2,563 |
| Edit | 1,453 | | Write | 984 |

  At the 4.2 characters per token of this request, Read is about 680 tokens and Bash about 1,470 *(estimate)*.
  The `Skill` definition's description includes the instruction, when a listed skill covers the task, to "call this tool first".

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
  - E21 widens the first point to the default mode, to folders without git, and to folders above a git root (headless runs).
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

### E21. The upward walk with the default settings sources: folders above, git, and the home folder (2026-11-25)
- **Question:** with the default settings sources, does the walk from the working folder upward still load project `CLAUDE.md` files, also from folders above the working folder, in folders without git, and above a git root? And how is `~/.claude/CLAUDE.md` listed when both the `user` source and the walk can reach it?
- **Setup:**
  - Claude Code 2.1.332, headless only: `claude -p "/context" --model haiku`, reading the whole `### Memory Files` table of its output (a first reading through `grep … | head -20` cut the table after two rows and looked like a missing file);
  - under the home folder, `~/workspace/_lab-walk-e21p/` with its own `CLAUDE.md`, a subfolder `plain/sub/` with no git above it (neither `~` nor `~/workspace` is a git repository), and a git repository `repo/` with its own `CLAUDE.md`, run from `repo/src/`;
  - outside the home folder, `/Users/Shared/_lab-walk-e21s/CLAUDE.md`, run from its `sub/` folder, no git;
  - this knowledge repository, run from its `knowledge/` subfolder.
- **Result** ✅[^lab]:

| # | Working folder | Git | `--setting-sources` | Memory files listed (type) |
|---|---|---|---|---|
| 1 | `~/workspace/_lab-walk-e21p/plain/sub` | none | not given (all three) | `~/.claude/CLAUDE.md` (User), its import `core.instructions.md` (User), `_lab-walk-e21p/CLAUDE.md` (Project) |
| 2 | `~/workspace/_lab-walk-e21p/repo/src` | `repo/` is the root; `_lab-walk-e21p/CLAUDE.md` is above it | not given | the two User files, `_lab-walk-e21p/CLAUDE.md` (Project), `_lab-walk-e21p/repo/CLAUDE.md` (Project) |
| 3 | `~/workspace/_lab-walk-e21p/plain/sub` | none | `project,local` | `~/.claude/CLAUDE.md` (Project), `_lab-walk-e21p/CLAUDE.md` (Project) |
| 4 | `~/workspace/_lab-walk-e21p/repo/src` | as in 2 | `project,local` | `~/.claude/CLAUDE.md` (Project), `_lab-walk-e21p/CLAUDE.md` (Project), `_lab-walk-e21p/repo/CLAUDE.md` (Project) |
| 5 | `/Users/Shared/_lab-walk-e21s/sub` | none | not given | the two User files, `/Users/Shared/_lab-walk-e21s/CLAUDE.md` (Project) |
| 6 | `/Users/Shared/_lab-walk-e21s/sub` | none | `project,local` | `/Users/Shared/_lab-walk-e21s/CLAUDE.md` (Project) only |
| 7 | `~/workspace/agent-knowledge/knowledge` | the repository | not given | the two User files, `agent-knowledge/CLAUDE.md` (Project), and the auto-memory index `MEMORY.md` of this project's folder under `~/.claude/projects/` (type AutoMem: Claude Code's own notes, not a `CLAUDE.md`) |

- **Conclusion** (headless `-p`, Claude Code 2.1.332, normal folders; `--agent` and interactive sessions were not run here):
  - The upward walk (the `project` source) runs with the default settings sources too. It loaded the `CLAUDE.md` of a folder above the working folder without git (cases 1 and 5), inside a repository (case 7), and above a git root (case 2). This widens E12, whose subfolder case was run only in `--agent` mode inside a git repository.
  - The walk's limits found earlier still hold: a `CLAUDE.md` in a folder below the working folder does not load at the start (run from the parent of `repo/`, `repo/CLAUDE.md` did not load), and folders under `/private/tmp/…` loaded no project file in any mode (E12).
  - So with the default sources two mechanisms run together: the `user` source loads `~/.claude/CLAUDE.md` and its imports from any working folder, and the walk loads the project files from the working folder upward.
  - Under the home folder both could bring `~/.claude/CLAUDE.md`, yet it is listed once, as User (cases 1 and 2). With `user` off, the walk is its only way in: it is then listed as Project, and only when the working folder is under the home folder (cases 3, 4 and 6). *(Inferred: that the walk also reaches the file in cases 1 and 2 and the duplicate is dropped follows from cases 3 and 4; `/context` shows only the result.)*

---

### E22. A skill typed as `/name` in a session run as an agent without the `Skill` tool (2026-11-25)
- **Question:** in a session started with `--agent` whose `tools` leave out `Skill`, can the person still run a skill by typing `/name`? And what does adding the `Skill` tool change?
- **Setup:**
  - Claude Code 2.1.332, headless `-p`, default settings sources, a git folder `~/workspace/_lab-slash-e22/`;
  - a project skill `.claude/skills/codeword/SKILL.md` with `user-invocable: true`, whose body gives the codeword KESTREL-9;
  - two project agents on Haiku, told to reply NO-CODEWORD when they do not know it: one with `tools: Read`, one with `tools: Read, Skill`;
  - each agent got two prompts: `/codeword`, and "What is the codeword?".
- **Result** ✅[^lab]:

| Agent `tools` | Prompt | Reply | Turns | Cumulative input |
|---|---|---|---|---|
| `Read` | `/codeword` | KESTREL-9 | 1 | 3,881 |
| `Read` | "What is the codeword?" | NO-CODEWORD | 1 | 3,814 |
| `Read, Skill` | `/codeword` | KESTREL-9 | 1 | 10,642 |
| `Read, Skill` | "What is the codeword?" | KESTREL-9, after calling the `Skill` tool | 3 | 22,154 |

- **Conclusion** (headless, 2.1.332; interactive sessions not run):
  - A skill typed as `/name` reaches the model without the `Skill` tool: Claude Code expands it before the request.
  - Without the tool, the model cannot load a skill by itself.
  - So an agent run as the session can leave `Skill` out and save the listing on every request (E19): the person types the skill's command when it is needed, and the agent reads other reference files by path.

---

### E23. An orchestrator agent that reads Spec Kit's step by path, from a plain request (2026-11-26)
- **Question:** can an agent run as the session, without the `Skill` tool, run a Spec Kit step from a request in plain words by reading the step's `SKILL.md` itself, inside the limits its guard hooks set?
- **Setup:**
  - Claude Code 2.1.332, headless, default settings sources, Sonnet;
  - a git folder `~/workspace/_lab-orch-e23/` with `src/server.js`, Spec Kit 1.2.3's `specify`, `clarify`, `plan` and `tasks` skills under `.claude/skills/`, and its `.specify/` scripts and templates, copied from another repository;
  - the archkit `orchestrator` agent: `tools: Read, Grep, Glob, Write, Edit, Bash`. Its prompt says to read `.claude/skills/speckit-<step>/SKILL.md` for each step. Its hooks allow writes only under `specs/`, `.specify/memory/` and three named files, and shell commands only from a short list with no chaining;
  - `claude -p '<request>' --plugin-dir <archkit>/build --agent archkit-build:orchestrator --allowedTools Read Grep Glob Write Edit Bash`. The request: add a GET `/health` endpoint to `src/server.js`, do only the specify step, then stop for approval.
- **Result** ✅[^lab]:

| Request | Size | Tool calls | Outcome |
|---|---|---|---|
| 1 | 9,319 | Read `speckit-specify/SKILL.md`, Glob `specs/*/spec.md`, Read `src/server.js` | |
| 2 | 17,238 | Bash `ls …; cat …; git branch …` | Denied by the hook: chained commands |
| 3 | 17,489 | Bash `ls -a .specify …`, Glob `.specify/**/*` | `ls` denied: not on the list; Glob ran |
| 4 | 18,059 | Read the spec template, `init-options.json` and the checklist template | |
| 5 | 21,379 | Bash `mkdir -p specs/001-health-endpoint/checklists`, Bash `git branch --show-current` | Both allowed |
| 6 | 21,742 | Write `spec.md`, the quality checklist and `.specify/feature.json` | All allowed |
| 7 | 23,920 | Text: a summary, and "stopped for your approval" | |

  7 requests, 129,146 tokens of cumulative input, $0.14. The spec has one user story with 3 acceptance scenarios and 5 functional requirements, and no `[NEEDS CLARIFICATION` markers.
- **Conclusion** (one run):
  - The agent found and followed the step's instructions by itself, from the path in its prompt; the person did not type `/speckit-specify` (compare E22).
  - The guard hooks held: two shell commands were denied, and the agent went on with Glob and Read. Those two denials cost two requests; the prompt should send the agent to Glob and Read for looking at files.
  - The agent's first request was 9,319 tokens with the default settings sources, the request included.

---

### E24. One story card from Spec Kit files through test-author, red check, implementer and gate (2026-11-26)
- **Question:** does the script orchestrator run a story card end to end with two separate workers: a test-author that writes the acceptance tests, then an implementer that may not touch them? What does one card cost?
- **Setup:**
  - Claude Code 2.1.332, headless, Sonnet for both workers, each run with `--setting-sources project,local`;
  - a git folder `~/workspace/_lab-t2/` with `src/server.mjs` (a server that answers 404 to everything) and `node --test` as the only check;
  - a hand-written Spec Kit 1.2.3-shaped feature `specs/001-health/`: one user story with three acceptance scenarios (GET `/health` gives 200 and `{"status":"ok"}`, POST gives 405, other routes still 404) and one task line;
  - `cards.mjs` compiled it into card `001-US1`: allowed `src/server.mjs` and `test/unit/**`, protected `specs/**` and the card's acceptance folder `test/acceptance/001-US1/**`;
  - `build-task.mjs` ran the card: test-author, then the script's red check (every scenario id named in a test file, and the test command must fail), a commit of the tests, the implementer with its guard and gate, then `[X]` in `tasks.md` and a second commit.
- **Result** ✅[^lab]:

| Worker | Requests | First request | Cumulative input | Tool calls | Cost |
|---|---|---|---|---|---|
| test-author | 5 | 6,360 | 40,496 | Read, Read, Write, Bash, Bash | $0.032 |
| implementer | 4 | 6,221 | 30,711 | Read, Read, Glob, Edit, Bash | $0.022 |

  - The test file named each test by its scenario id (`US1-AS1: GET /health answers 200 with JSON ok`, and so on). The red check's `node --test` exited 1 before the code existed.
  - The gate passed at its first attempt. The script marked `T001` `[X]` and made two commits: "001-US1: acceptance tests", then "001-US1: Check that the service is alive". Afterwards all 3 tests passed.
  - Together: 71,207 tokens of cumulative input and $0.054 for the card, about 25 seconds of worker time.
- **Two defects found by the first attempt, fixed before this run:**
  - The script's commit failed when the repository's `.gitignore` already listed the run state: `git add` with `:(exclude)` pathspecs for ignored paths exits non-zero. It now stages everything and then unstages the run state with `git rm --cached --ignore-unmatch`. A test covers it.
  - The test-author tried to write its test file through a shell heredoc, which its tool list denied; it then used Write. Its prompt now says to write files with Write or Edit.
- **Conclusion** (one card, one run):
  - Two workers with separate roles completed a card without a model orchestrating them; the tests were committed before the implementer started, so the gate's scope check would have reported any change to them.
  - Each worker started at about 6,200–6,400 tokens with the user layer off, more than the 4,800 measured for the implementer in E13; the agents' prompts and tool lists are larger now.
  - The `usage` totals in `claude -p --output-format json` equal the sum of every request's size in the transcript, so a run record can take cumulative input from that output.

---

### E25. A plugin declared in a project's settings, in headless runs (2026-11-26)
- **Question:** if a repository's `.claude/settings.json` declares a plugin marketplace and enables its plugin, can a headless worker run that plugin's agent without `--plugin-dir`?
- **Setup:** Claude Code 2.1.332; a new git folder whose `.claude/settings.json` has `extraKnownMarketplaces.archkit` (`"source": "directory"`, the absolute path of the archkit folder, whose `.claude-plugin/marketplace.json` lists `archkit-build` at `./build`) and `enabledPlugins: {"archkit-build@archkit": true}`; the marketplace was not added with `claude plugin marketplace add`. Then `claude -p "Reply with the word READY only." --agent archkit-build:test-author`, once with the default settings sources and once with `--setting-sources project,local`.
- **Result** ✅[^lab]: both runs exited 1 with "--agent 'archkit-build:test-author' not found", listing only the other agents.
- **Conclusion** (headless, 2.1.332, a folder never trusted interactively, two runs): a marketplace declared in project settings was not installed by a `-p` run. The settings page says these keys "apply only after each teammate trusts the folder" ✅[^cc_settings], so the missing trust is the likely cause *(inferred: what a headless run does with the trust step was not observed)*; the interactive install was not tried, because answering it changes the user's plugin registry. Workers started by a script should keep `--plugin-dir`.

### E26. One feature across two repositories, run by the script (2026-11-26)
- **Question:** do `cards.mjs` and `build-task.mjs`, run from a system workspace with `--repo`, build a feature that spans a provider and a consumer repository, and do the two halves work together?
- **Setup:**
  - Claude Code 2.1.332, headless, Sonnet workers with `--setting-sources project,local`;
  - `~/workspace/_lab-t3/system/` with `system.json` (two services) and the shared contract `contracts/users-api.md`: `GET /users/:id` answers 200 with `{"id","name"}`, 404 for an unknown id, 405 for other methods;
  - `svc-users` (provider): a server that answered 404 to everything, a user map, one story with 3 scenarios, task `T001`;
  - `svc-greeter` (consumer): an empty `src/greet.mjs`, one story with 3 scenarios (a known user, an unknown user, a 500 from the users API), task `T001 … (depends on svc-users:T001)`;
  - the per-repository spec, tasks and contract copy were written by hand, as the orchestrator would write them; from the system workspace: `cards.mjs specs/001-user-greeting --repo ../<service>`, then `build-task.mjs ../<service>/.archkit/cards/…/001-US1.json --repo ../<service>`, provider first.
- **Result** ✅[^lab]:

| Repository | Worker | Requests (from the transcript) | Cumulative input | Cost |
|---|---|---|---|---|
| svc-users | test-author | 5 | 41,633 | $0.030 |
| svc-users | implementer | 5 | 40,550 | $0.031 |
| svc-greeter | test-author | 5 | 41,398 | $0.034 |
| svc-greeter | implementer | 5 | 41,017 | $0.030 |

  - `cards.mjs` gave the consumer's card `depends_external: ["svc-users:T001"]`.
  - Both cards passed: every scenario id had a test, the red check failed before the code (exit 1), the gate passed at its first attempt, `T001` was marked `[X]`, and each repository got two commits.
  - Afterwards a separate script started the provider's real server and called the consumer's real `greet()` against it: "Hello, Ada!", "Hello, Grace!", "Hello, stranger!".
  - Together: 164,598 tokens of cumulative input and $0.125 for the feature, without any model orchestrating.
- **Conclusion** (one run, two small repositories): the script layer handles a cross-repository feature when each repository holds its own spec, tasks and a copy of the contract. The orchestrator model's part (writing those files and choosing the order) was not run here.

---

### E27. The orchestrator agent runs a two-repository feature from a plain request (2026-11-26)
- **Question:** given only a request in plain words, does the orchestrator agent write the spec, plan, contract and each repository's tasks, compile the cards and build them in dependency order? What does it cost next to the script-only run of E26?
- **Setup:**
  - Claude Code 2.1.332, headless, Sonnet; the orchestrator with the default settings sources, `--plugin-dir <archkit>/build`, `--add-dir` for the two service repositories, and `--allowedTools Read Grep Glob Write Edit Bash` (its guard hooks limit writes and shell commands);
  - fresh copies of E26's repositories with no spec or tasks: a system workspace with Spec Kit 1.2.3's skills and scripts and a `system.json`; `svc-users` (a server that answers 404, a user map) and `svc-greeter` (an empty `greet.mjs`);
  - the request named the endpoint and the greeting's three outcomes, and said, for the trial, that the spec and plan were approved in advance.
- **Result, first run** ✅[^lab]: 18 requests, 827,948 tokens of cumulative input, $0.46 for the orchestrator, 125 seconds.
  - It read the specify, plan and tasks skills, wrote the spec, plan, research notes, contract and tasks in the system workspace, then each service's `spec.md` and `tasks.md`, and compiled both repositories' cards without problems; the consumer's card had `depends_external: ["svc-users:T001"]`.
  - It also read `cards.mjs` itself, twice (requests 10 and 11), to learn the task format.
  - Two shell commands were denied by its hook: a chained `ls … && git …`, and `git -C <repo> status`.
  - The provider's card ended `gate-failed` after 3 attempts with its tests passing: the gate's scope check reported the service's own `specs/…/spec.md` and `tasks.md` as protected files changed. The orchestrator had written them after the repository's last commit, so they were untracked. The orchestrator diagnosed this from `gate.json` and its log, stopped, and asked for the files to be committed.
- **Fixes, then a resumed run:**
  - `build-task.mjs` now commits the feature's documents and cards itself before a run ("<feature>: spec, tasks and cards"), and stops with `dirty-tree`, before any worker, when anything else is uncommitted. The orchestrator's prompt now states the task-line format `cards.mjs` needs; `git -C <repo> status|log|diff --stat` is allowed.
  - The provider was reset to its base commit, and the same session was resumed (`--resume`) with that news: 3 more requests, 210,063 tokens. Both cards passed at their first gate attempt, with 3 and 4 acceptance tests; each repository got three commits (documents, tests, code) and `T001` marked `[X]`.

| Part | Requests or sessions | Cumulative input | Cost |
|---|---|---|---|
| Orchestrator, first run | 18 requests | 827,948 | $0.463 |
| Orchestrator, resumed | 3 requests | 210,063 | about $0.051 *(the second run's `total_cost_usd`, $0.514, appears to include the first: inferred from the difference)* |
| Workers, the failed provider attempt | 2 sessions | 116,400 | $0.085 |
| Workers, the two passing cards | 4 sessions | 164,652 | $0.124 |

  - The orchestrator used 1,038,011 of the 1,319,063 tokens, 79 %. Its requests grew from 9,972 to 71,907 tokens.
  - A separate script then ran the provider's real server against the consumer's real `greet()`: "Hello, Ada!", "Hello, Grace!", "Hello, stranger!", and with the server stopped, an error "users API unreachable: fetch failed".
- **Another defect found:** `cards.mjs` took a route in backticks (`/users/:id`) and a URL template (`${usersUrl}/users/…`) for file paths, so both ended up in `allowed_paths`. It now keeps only relative paths made of plain segments; a test covers it.
- **Conclusion** (one feature, one run plus one resume):
  - The agent ran the whole chain from a plain request, and stopped with a correct diagnosis when the script layer failed, instead of working around its guards.
  - Here the model orchestrator used about 3.7 times the tokens of the workers it coordinated (1,038,011 against 281,052). Two of its costs have since been removed (reading `cards.mjs`; a failed card), and were not re-measured.

---

### E28. The same card as a Claude Code dynamic workflow (2026-11-26)
- **Question:** run E24's card through a dynamic workflow instead of `build-task.mjs`: does it work, what does it cost, and do the guard and gate hooks still hold when the workers are the workflow's subagents?
- **Setup:**
  - Claude Code 2.1.332, headless, a copy of E24's repository at the commit before the build, the same card and plugin;
  - the host session: `claude -p 'Run the workflow with scriptPath .archkit/card.workflow.js.' --plugin-dir <archkit>/build --agent card-runner --setting-sources project,local`, where `card-runner` is a project agent with `tools: Workflow, Read`;
  - the workflow script, in JavaScript: `agent()` with `agentType: 'archkit-build:test-author'`; a red-check step; `agent()` with `agentType: 'archkit-build:implementer'`; a finish step. The dynamic-workflows docs say there is "no filesystem or shell access from the workflow itself" ✅[^cc_wf], so the red check, the commits and the `[X]` had to be done by an agent: a project agent `shell-step` (`tools: Bash, Read, Edit`, Haiku) with a schema for its report.
- **Result** ✅[^lab]:

| Run | What happened |
|---|---|
| 1 | The host could not load the script: `scriptPath` needs the `Read` tool, and the host had only `Workflow` |
| 2 | With `general-purpose` on Haiku for the mechanical steps: tests written and committed, but the red-check agent put a sentence ("US1-AS1 and US1-AS2 fail under node --test …") into the `uncovered` field meant for missing ids, so the script stopped |
| 3 | With `shell-step` and `uncovered` limited to the card's ids: the agent ran `git -C <absolute path> add …` instead of the `git add …` it was given; the command was not on the allowed list, was denied, and it reported `committed: false` |
| 4 | With `shell-step` told to run each command "character for character": **pass**. Tests committed, gate passed at attempt 1 (`gate.json` written by the `SubagentStop` hook), `T001` marked `[X]`, two commits, all 3 tests pass |

  Run 4 against E24:

| | E24, `build-task.mjs` | E28 run 4, dynamic workflow |
|---|---|---|
| test-author | 40,496 (session) | 35,203 (subagent, first request 7,163) |
| implementer | 30,711 (session) | 33,575 (subagent, first request 6,907) |
| Red check, commits, `[X]` | 0 (script) | 61,274 (two Haiku agents: 21,260 and 40,014) |
| Orchestration | 0 (script) | 35,315 (host session) |
| **Cumulative input** | **71,207** | **165,367** |
| Cost (`total_cost_usd`) | $0.054 | $0.070 |

- **Conclusion** (one card; four runs: the first stopped on the host's configuration, the second and third on a model doing a fixed step):
  - The workflow ran the plugin's agents as subagents with their own tool lists; the gate held through `SubagentStop`, and the guard denied nothing because no write left the allowed paths.
  - For fixed steps, the script was cheaper and steadier: the workflow spent 2.3 times the input tokens, and two of its four runs failed because a model did a step that code does in `build-task.mjs` (a field misread, a command rewritten).
  - The workers themselves cost about the same either way (68,778 against 71,207 tokens).

---

### E29. Planning and building in two fresh sessions (2026-11-26)
- **Question:** E27's orchestrator spent 79 % of the run's tokens, and its requests grew to 72,000 tokens as it read Spec Kit's files. Does splitting the work into a planning session and a fresh build session cut that, with the same result?
- **Setup:**
  - fresh copies of E27's three repositories at their base commits; the same request, again with the spec and plan approved in advance for the trial; the same flags as E27;
  - the orchestrator's prompt now says to plan in one session and stop with `planned: specs/<NNN>`, and to build in a new session from the files, without reading Spec Kit's `SKILL.md` files; it also states the task-line format `cards.mjs` needs (added after E27);
  - session 1: the request; session 2, new: `Build specs/001-greet-by-user-id`.
- **Result** ✅[^lab]:

| | E27, one session | E29 planning session | E29 build session |
|---|---|---|---|
| Requests | 21 (14 until the cards compiled, 7 after) | 9 | 5 |
| Cumulative input | 1,038,011 (564,602 + 473,409) | 303,017 | 65,699 |
| Average request while building | 67,630 | — | 13,140 |
| Cost | about $0.51 | $0.280 | $0.063 |

  - The planning session read the specify, plan and tasks skills, wrote the spec, plan and contract and each repository's spec and tasks, compiled both repositories' cards without problems, and stopped with `planned: specs/001-greet-by-user-id`. It did not read `cards.mjs` this time. One `mkdir -p` with two paths was denied (the rule allowed one); it used Write instead.
  - The build session read the two `tasks.md` files and card summaries, ran the provider's card, then the consumer's: both passed at their first gate attempt, with 3 and 4 tests, `T001` marked `[X]`, three commits per repository.
  - Workers: 151,848 tokens and $0.114 for four sessions. The orchestrator's share fell from 79 % to 71 % (368,716 of 520,564).
  - The provider's real server against the consumer's real `greet()`: "Hello, Ada!", "Hello, Grace!", "Hello, stranger!", and "users API unreachable" with the server stopped.
- **Conclusion** (one feature, one run of each session):
  - The orchestrator used 64 % fewer tokens than in E27 (368,716 against 1,038,011). The building part shrank most: a fresh session's requests averaged about a fifth of the size of comparable steps at the end of one long session (E27's last 7 requests also diagnosed a failed card and resumed). Part of the planning saving comes from the prompt change, since this run did not read `cards.mjs`; E27 also carried a failed card. These causes were not measured apart.
  - Planning still dominates: 303,017 tokens. The three Spec Kit skills it read (41,318 characters as read, about 9,800 tokens) were sent again in each later request, about 64,000 tokens or 21 % of the session *(estimate at 4.2 characters per token, not a counter-test)*.

---

## 4. Four ways to orchestrate, compared

| Way | What the orchestrator is | Cost of orchestration | Measured |
|---|---|---|---|
| A skill in the main session | The default session reading `SKILL.md` and following it | About 41,000 tokens per orchestrator request; 358,393–463,013 cumulative per task in E5 | E5: it also ran a step out of order and tripped a permission rule |
| An agent as the whole session | `claude --agent <orchestrator>`: its own prompt and tools | Smaller start (about 3,000–10,000 tokens in E6–E10, E13, E23, E27), still a model on every step, and its requests grow with what it has read | E27: one two-repository feature, 21 requests and 1,038,011 tokens for the orchestrator (79 % of the run) against 281,052 for its workers; it planned and ran the scripts correctly, after three script fixes and one resume |
| A script | A program that runs each agent as its own session (`claude -p --agent …`) and handles files and git itself | No model tokens for orchestration | E10: A+ used 54,877–137,343 tokens of cumulative input per task, against A's 267,751–408,418, with the same results. E24: 71,207 for a whole card |
| A Claude Code dynamic workflow | A JavaScript script that runs the agents as subagents of one session; it cannot touch files or run commands, so fixed steps go to agents | The host session plus an agent for every fixed step | E28: 165,367 for the same card as E24, and two of four runs stopped because a model did a fixed step wrongly |

*(Synthesis, from one card per way in E24 and E28 and the trials of E5 and E10.)* When the steps are fixed, as they are here, the orchestration is a workflow, and code runs it more cheaply and more reliably than a model does. A model orchestrator earns its cost on the steps that need judgement: writing the spec and tasks, and deciding what to do when a card fails (E27).

---

## 5. Lessons

1. **Measure the first request of every agent.** It is multiplied by every request that follows (E2, E5, E8).
2. **Give each agent only its tools.** That cuts tool definitions and the skill list at once (E8). One tool, Artifact, is about a third of a default session's start here; deny it wherever pages are not published (E11, E14).
3. **Which memory files load (E7, E12, E15, E16, E21):** a main session, default or `--agent`, loads the user's files with their imports from any working folder, plus the project's files from the working folder upward (default sources, 2.1.330–2.1.332; E21 measured headless runs with and without git and above a git root, E12 the `--agent` case inside a repository); `omitClaudeMd` works only for subagents. `--setting-sources project,local` drops the user layer, but under the home folder the upward walk still finds `~/.claude/CLAUDE.md` as a project file, and its imports load only when they are inside the working folder (E15, E18). To keep instruction files out of a worker, use a subagent with `omitClaudeMd: true`, or a session with `project,local` started in a repository.
4. **Do not trust an agent's description of its own tools or context, nor `/context` as an exact count.** Test by calling a tool. Measure real sizes from the CLI's usage numbers: `/context` leaves out several parts and counts the rest low (E7, E8, E11).
5. **Hooks are the part that works in every mode.** They see `agent_type` for subagents and for sessions run as an agent (E6, E9). Put the rules in hooks, not in prose.
6. **Test a check against a known-good and a known-bad sample before relying on it.** This applies to hooks (E3) and to the reviewer (E4).
7. **An orchestrator that is a model costs more than the work it coordinates** when the steps are fixed (E5). Write it as code (E10).
8. **An evaluator only judges what it is allowed to read.** Limited to the diff, it called tested criteria untested, twice in E10 and once in E4. Given the acceptance tests too, it stopped doing so and found a real test gap instead (E10, rep 3).
9. **Add an agent only when a measurement shows the gap it closes.** In E10 reps 1–2 the reviewer added 75 % more input and found no real problem; after its prompt was fixed (rep 3) it found one real test gap, in code that was already correct.
10. **Start workers without the user's layer** (`--setting-sources project,local`) in their repository, and give them their own permissions. That drops the user's plugins, hooks and, for a repository, the user's imported instructions, while the harness plugin keeps working (E13, E15). Started in the home folder, the imported instructions still load (E18).
11. **Keep fixed steps in code, not in an agent.** In E28 a model ran the red check and the commits; two of four runs failed, once on a misread field and once on a rewritten command. In `build-task.mjs` the same steps cost no tokens; its first runs also found defects (a commit that failed on ignored paths in E24, untracked documents and paths misread from task text in E27), but each was fixed once in code, and the later runs passed (E24, E26, E27, E29). The comparison rests on one small card for the workflow (E28).
12. **A model orchestrator costs what it has read.** Its requests grew from about 10,000 to 72,000 tokens in E27, as it read Spec Kit's skills, templates and a script's source. Put the formats it needs in its prompt, keep it out of mechanical steps, and start a fresh session when the work changes phase. In E29 the orchestrator used 64 % fewer tokens than in E27; the prompt change, the absence of a failed card and the fresh build session all contributed and were not measured apart (one run each).

---

## 6. Repeat it

- **Hook tests:** `node --test tests/*.test.mjs` in the plugin folder.
- **One task through the harness:** in a project with `.archkit/tasks/<id>.json`, run `node <plugin>/scripts/build-task.mjs .archkit/tasks/<id>.json [--review]`. It prints the run record with each session's id, turns, seconds and cost.
- **Tokens per agent:** `python3 -I <plugin>/scripts/measure.py <session-id> …`. It reads `~/.claude/projects/**/<session-id>.jsonl` and the `subagents/` folder beside it. Request size = input + cache-creation + cache-read tokens; repeated message ids are one request.
- **The start-up block:** `claude -p "/context"`, with or without `--agent <name>`.
- **Which hook fires, and with what input:** pass `--settings '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"cat > <file>"}]}]}}'` and read the file.

---

## 7. Verification

- **Measured on 2026-11-24, 2026-11-25 and 2026-11-26 (E24–E29):** every ✅[^lab] result, on one machine with Claude Code 2.1.330 to 2.1.332 (the CLI updated itself during the work; E11 onward ran on 2.1.332). Each arm and test ran once unless stated, so the numbers show size, not run-to-run spread.
- **Checked against the Claude Code docs on 2026-11-24 and 2026-11-25:**
  - plugin-agent frontmatter limits;
  - `omitClaudeMd` in main-session mode;
  - hooks inside subagents and `agent_type`;
  - the plugin layout;
  - on 2026-11-26: the trust condition for project marketplace settings (E25) and the dynamic-workflows page (E28).
- **Synthesis, not a sourced claim:** the conclusion lines, §4's last paragraph, and §5.
- **Not settled:**
  - about 5,000 tokens of a default session's first request, after E11's two causes;
  - why no project `CLAUDE.md` loads in folders under `/private/tmp/…` (E12);
  - an earlier manual check in the home folder that saw no loaded instructions, which E18 and E20 could not reproduce; E20 shows one way to get that result (Enter on the trust prompt's default "No, exit");
  - the docs text on external-import approval was not read for this notebook; the rule rests on E15–E17.

## References

- Local experiments: the `archkit-build` plugin and its trial projects, run with Claude Code 2.1.330 to 2.1.332 on one machine, 2026-11-24 to 2026-11-26; results read from the CLI's JSON output, the session transcripts and recorded requests (§6 counting rules), `/context`, hook inputs saved by debug hooks, and start-up screens recorded under `expect`. Backs: §2 trial project; §3 E2–E29 results. [^lab]
- [Create custom subagents](https://code.claude.com/docs/en/sub-agents) — Anthropic, living, read 2026-11-25. Backs: §2 plugin-agent frontmatter limits; E7 `omitClaudeMd` ignored in main-session mode; E19 the fields the page names for session mode. [^cc_sub]
- [Hooks reference](https://code.claude.com/docs/en/hooks) — Anthropic, living, read 2026-11-25. Backs: §2 hooks inside subagents, `agent_type`. [^cc_hooks]
- [Plugins reference](https://code.claude.com/docs/en/plugins-reference) — Anthropic, living, read 2026-11-24. Backs: §2 plugin layout. [^cc_plugins]
- [Orchestrate subagents at scale with dynamic workflows](https://code.claude.com/docs/en/workflows) — Anthropic, living, read 2026-11-26. Backs: E28 a workflow script has no filesystem or shell access. [^cc_wf]
- [Settings files and precedence](https://code.claude.com/docs/en/settings) — Anthropic, living, read 2026-11-26. Backs: E25 project marketplace keys apply after the folder is trusted. [^cc_settings]
- Claude Code settings JSON schema, `enableArtifact` entry — bundled with Claude Code 2.1.332, read 2026-11-25. Backs: E14 which settings source wins. [^schema]

## Related

- [Efficient coding agents, end to end](../efficient-coding-agents-deep-dive.md) — the evidence and principles these experiments test.
- [Claude Code subagents and skills](../claude-code-agents-and-skills.md) — where agents load and how to call them, including a plugin agent as the session.
- [What each coding agent loads at session start](../session-start-context-by-agent.md) — the start-up block per agent.
- [Harness engineering, end to end](../harness-engineering-deep-dive.md) — guides, sensors, gates and exit codes.
