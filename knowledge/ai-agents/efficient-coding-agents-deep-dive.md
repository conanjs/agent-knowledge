---
schema: deep-dive/v1
topic: ai-agents
status: verified
applies-to: ["Coding agents that run subagents and hooks; settings named for Claude Code 2.1, principles also for Codex, Copilot and Gemini CLI", "sources read 2026-11-24", "measurements from Claude Code transcripts on one machine, read 2026-11-24"]
last-verified: 2026-11-24
last-updated: 2026-11-25
synthesized-into: []
tags: [token-cost, latency, subagents, multi-agent, context-rot, instruction-density, hallucination, evaluator, hooks, measurement]
---

# Efficient coding agents, end to end

## Summary
**TL;DR:** An agent run costs roughly *number of requests × average request size*, because every model request sends the whole conversation again. Several things make a run expensive, and the same things make its answers worse:
- a large start-up block;
- instructions loaded "just in case";
- unfiltered tool output;
- many turns, and many agents.

The evidence for "worse": accuracy falls as the input grows, as instructions pile up, and as sequential work is split across agents. So cost and quality are mostly one budget. Spend fewer tokens on fewer things, check the work with code, and keep the grader separate from the worker. Measured here: a nine-role framework started every role at about 57,000 tokens and spent a median 3.6 million input tokens and 19 minutes per engineering task.
**Use this when:**
- an agent workflow is slow or uses up plan limits;
- you define subagents, their tools, skills and hooks;
- you decide how many agents a workflow needs;
- you want to know which "context engineering" advice has evidence behind it.

**Depth:**
- the cost model with its arithmetic;
- what benchmarks and vendor engineering posts found;
- a measured case and its five causes;
- a trial of one agent against a three-part harness;
- the levers, each mapped to a Claude Code setting;
- a popular ten-technique list, checked;
- a design checklist, a failure matrix, and a tested measurement script.

---

## 1. Words first

| Term | Plain English | Analogy | Concrete artifact |
|---|---|---|---|
| Request | One call to the model. One agent turn can make several | One trip to a service counter | One `assistant` line with a `usage` field in a Claude Code transcript |
| Transcript | The log file Claude Code writes for each conversation and each subagent, one JSON object per line | Minutes taken during a meeting | `~/.claude/projects/<folder>/<session>/subagents/agent-<id>.jsonl` |
| Request size | Everything the model reads in one request: new input, cache writes and cache reads | The whole stack of paper handed over at the counter | `input_tokens + cache_creation_input_tokens + cache_read_input_tokens` |
| First request | The size of an agent's first request, before it has done anything: system prompt, tool definitions, skill list, instruction files, the task | The binder every new temp worker is handed on day one | 57,115 tokens for the median engineering role in §4 |
| Cumulative input | The sum of every request's size in one run | Photocopying the whole file again each time one page is added | 33 requests averaging about 110,000 tokens make 3.6 million |
| Tool allowlist | The list of exactly which tools an agent gets | A toolbox packed for one job, instead of the whole workshop | `tools: Read, Grep, Glob` in a subagent file |
| Instruction density | How many separate instructions the model must follow at the same time | A form with 500 boxes to tick | 234 rule rows across the 23 rule files in §4; the engineering role was told to read 12 of the files |
| Effective context length | How long an input can get before the model's accuracy drops well below its short-input score. It is usually far shorter than the advertised window | A car rated for 250 km/h that is only safe at 120 | At 32,000 tokens, 11 of 13 long-context models scored under half their short-input score (§3) |
| Gate | A check run by code that decides whether the agent may stop | A turnstile that opens only for a valid ticket | A `SubagentStop` hook that returns `decision: "block"` while tests fail |
| Evaluator | A separate agent or check that grades the work of the agent that did it | An exam marked by someone other than the student | A read-only reviewer subagent with the acceptance criteria and the diff |
| Self-preference | A model rating its own output above output of equal quality from others | Marking your own exam | Agents "reliably skew positive" when grading their own work (§3) |

---

## 2. The cost model: why runs get slow and expensive

1. **Each request carries the whole conversation.** In the measured runs, request size grew from a median 57,115 tokens on the first request to a peak of 153,709 by the end of an engineering task ✅[^measured]. What is added (tool results, file contents, the agent's own messages) stays and is sent again on every later request. The mechanism, and how each tool reports it, is in [agent-token-accounting.md](agent-token-accounting.md).
2. **So cumulative input ≈ requests × average size.** Example: 3,633,050 tokens ÷ 33 requests ≈ 110,000 tokens per request ✅[^measured].
3. **Every factor multiplies.** Two examples:
   - a start-up block 45,000 tokens larger, over 33 requests, adds about 1.5 million tokens;
   - a 20,000-token tool output read in request 5 is paid again in each of the remaining 28 requests.
4. **Caching changes the price, not what the model reads.** In the measured runs, 96 % of cumulative input was cache reads ✅[^measured]. Cached tokens are billed at a fraction of the normal price (prices in [context-engineering-deep-dive.md](context-engineering-deep-dive.md) §6), but they are still in the window. Context rot and position effects (§3) are about what is in the input, not about how it was billed. *(Synthesis.)*
5. **Wall-clock time follows the number of requests.** Each request waits for the model to read and answer. Time spent in deliberate waits counts too: the engineering runs below made 24 `Monitor` calls and 15 `sleep`/`until` loops ✅[^measured].

---

## 3. Evidence: what more context, more rules and more agents do

| Finding | Numbers | Source |
|---|---|---|
| Context rot | Performance varies significantly with input length, even on simple tasks, across 18 models. Detail: [context-engineering-deep-dive.md](context-engineering-deep-dive.md) §3 | ✅[^chroma] |
| Position effect | Information in the middle of a long input is used worse than information at the start or end | ✅[^lost] |
| No keyword overlap | When the question and the answer share no keywords, 11 of 13 models that claim at least 128K tokens fell below 50 % of their short-input score at 32K. GPT-4o fell from 99.3 % to 69.7 % | ✅[^nolima] |
| Many instructions at once | 20 models, up to 500 simultaneous instructions: the best reached 68 % at 500. Models showed a bias toward earlier instructions | ✅[^ifscale] |
| Personas | 162 roles, 4 model families, 2,410 factual questions: adding a persona to the system prompt did not improve accuracy over no persona. The effect of each persona "can be largely random" | ✅[^persona] |
| Self-preference | Models such as GPT-4 and Llama 2 can tell their own text from others' with non-trivial accuracy. Self-recognition correlates linearly with how much they favor their own output | ✅[^selfpref] |
| Self-grading in a coding harness | Agents "reliably skew positive" grading their own work. Making a separate evaluator skeptical is "far more tractable" than making the generator self-critical | ✅[^ant_harness2] |
| Hallucination comes from guessing | Training and evaluation "reward guessing over acknowledging uncertainty". On SimpleQA: one model abstained 52 % of the time, was right 22 % and wrong 26 %. Another abstained 1 %, was right 24 % and wrong 75 % | ✅[^oai_hall] |
| Tokens buy quality, when spent on the task | On BrowseComp, three factors explained 95 % of performance variance; token usage alone explained 80 %. Agents use about 4× the tokens of chat, multi-agent systems about 15× | ✅[^ant_multi] |
| When several agents help | Centralized multi-agent gained 80.9 % on a parallelizable finance task. On sequential planning, every multi-agent variant lost 39–70 %. The coordination cost grows with the number of tools. Errors were amplified 17.2× by independent agents and 4.4× with a central orchestrator | ✅[^scaling] |
| Why multi-agent systems fail | 14 failure modes in 3 categories (system design, inter-agent misalignment, task verification), from 1,600+ traces of 7 frameworks. Gains over single agents on popular benchmarks are "often minimal" | ✅[^mast] |
| Tool definitions are not free | 58 tools from five MCP servers ≈ 55,000 tokens before the conversation starts (MCP: Model Context Protocol, the standard for plugging tool servers into an agent). Loading tools on demand cut a 50-tool setup from about 77,000 to about 8,700 tokens. Tool-selection accuracy rose from 49 % to 74 % for Opus 4 | ✅[^ant_atu] |
| Process data in code, not in the context | Programmatic tool calling cut average use from 43,588 to 27,297 tokens (37 %) on complex research tasks. Presenting MCP servers as code cut one workflow from 150,000 to 2,000 tokens | ✅[^ant_atu] ✅[^ant_mcpcode] |
| Load knowledge in levels | Skill names and descriptions are pre-loaded. The `SKILL.md` body is read when the skill seems relevant, and bundled files only when needed | ✅[^ant_skills] |
| One feature at a time, state in files | A long-running harness keeps a JSON feature list (all failing at the start), a progress file, `init.sh` and git. Compaction alone "isn't sufficient" | ✅[^ant_harness] |
| Harness parts are assumptions | "Every component in a harness encodes an assumption about what the model can't do on its own". A full three-agent harness cost about 20× a solo run (6 hours and 200 USD against 20 minutes and 9 USD) | ✅[^ant_harness2] |
| Keep agents small | Agents focused on one domain, with "3-10, maybe 20 steps max". This is the author's guidance, not a measurement | ✅[^12f] |

The NoLiMa, IFScale and agent-scaling rows are also summarized, with the other long-context findings, in [context-engineering-deep-dive.md](context-engineering-deep-dive.md) §3 and §6.

---

## 4. Case: a nine-role framework, measured

**Context.** agentic-sdlc v2 is an SDLC framework (SDLC: software development life cycle) built by this knowledge base's owner.
- An orchestrator runs in the main Claude Code session and launches nine role subagents: product spec, system architecture, architecture, tech stack, engineering, QA (quality assurance), security, DevOps and coordinator.
- Each role file removes only the `Agent` tool (`disallowedTools: Agent`).
- Each role preloads a "preset" skill that lists the rule files to read before working. For engineering, that is 12 "foundation" files: coding standards, comments, naming, import paths, error handling, refactoring, design principles, clean architecture, domain-driven design, maintainability, testing strategy and review rubrics.
- Each launch also needs the stack profile and the launch and message schemas.

**Method.** The script in §9 was run over every subagent transcript on the machine on 2026-11-24. File sizes were measured with `wc -c` ✅[^measured].

**Per role (medians per run):**

| Role | Runs | Requests | First request | Peak request | Cumulative input | Output | Minutes |
|---|---|---|---|---|---|---|---|
| engineering | 25 | 33 | 57,115 | 153,709 | 3,633,050 | 39,817 | 18.7 |
| qa | 21 | 45 | 56,745 | 223,476 | 6,450,485 | 56,881 | 19.5 |
| security | 4 | 48 | 56,694 | 216,528 | 8,103,964 | 48,458 | 15.9 |
| architecture | 2 | 33.5 | 57,191 | 303,913 | 6,197,061 | 96,241 | 15.6 |

All 59 role runs together (the table above lists 4 of the 9 roles): 655,652,216 tokens of cumulative input, 96 % of it cache reads ✅[^measured].

**First request by tool set, same machine (medians):**

| Agent type | Tools | First request (tokens) |
|---|---|---|
| `web-fetch` | 1 | 4,324 |
| `research-worker` | 7 | 11,632 |
| `research-orchestrator` | 7 | 13,219 |
| `general-purpose` | all | 52,120 |
| `knowledge-judge` | all but 3 | 54,938 |
| the nine roles | all but `Agent` | 55,832 to 57,191 |

**Five causes, each with its number:**
1. **The start-up block is about 45,000 tokens larger than it needs to be.**
   - Mechanism: a subagent with no `tools` field inherits every tool available to subagents ✅[^cc_sub]. Agents with a short allowlist started at 4,000–13,000 tokens; agents with all tools started at 52,000–57,000 ✅[^measured].
   - Arithmetic: 57,115 − 11,632 = 45,483 tokens. Over 33 requests that is about 1.5 million of the 3.6 million.
   - Not separated: how the gap divides between tool schemas, the skill list, the deferred-tool list and instruction files.
2. **The preset loads every rule file up front.**
   - The engineering role file, the conventions file and the 12 foundation files total 131,388 bytes. The stack profile, paradigm files and schemas add 91,601 bytes; the TypeScript idioms file alone is 45,294 bytes ✅[^measured].
   - About 223 KB, which is an estimated 56,000 tokens. The estimate divides bytes by 4, a rule of thumb for English text; the files were not run through a tokenizer.
   - The skill mechanism was built for the opposite: load a body only when it seems relevant ✅[^ant_skills].
3. **Too many rules at once, and most are prose for the model to enforce.**
   - 23 foundation files hold 234 rule rows; 198 of them say they are enforced by `llm`. The engineering role's preset lists 12 of these files ✅[^measured]. That is the density at which accuracy falls and earlier instructions win ✅[^ifscale].
   - Example, the refactoring foundation: 9 rules (6,373 bytes). In all nine, the "Holds when" column is the same placeholder sentence, "The affected artifact demonstrably satisfies the rule". Its catalog restates published refactoring books ✅[^measured].
4. **File reads and checks went through the shell without filtering.**
   - The 25 engineering runs made 1,398 Bash calls, about 56 per run.
   - `sed -n` page reads were 174 of them and returned 1,062,561 characters.
   - All Bash output came to 5,230,244 characters, about 209,000 characters per run (an estimated 52,000 tokens, by the same rule of thumb), and it stays in context for every later request ✅[^measured].
5. **Nine roles for mostly sequential work.**
   - Each launch pays the start-up block again, plus a launch prompt and schemas.
   - Multi-agent setups lost 39–70 % on sequential planning ✅[^scaling], and coding has "fewer truly parallelizable tasks than research" ✅[^ant_multi]. This case did not measure quality, only cost.

**What the refactoring foundation becomes when rules turn into checks** *(synthesis)*:

| Rule | Replacement |
|---|---|
| Behaviour preserved; tests green before, after and between steps | The gate runs the tests; characterization tests pin current behaviour first ([../testing/characterization-tests.md](../testing/characterization-tests.md)) |
| Stay in the task's scope | A `PreToolUse` hook denies edits outside the task's allowed paths ✅[^cc_hooks] |
| Public contracts do not move | Compare the emitted type declarations or an API report before and after |
| Leave it measurably better | A complexity or size lint rule as a fitness function |
| Characterize first, small steps, separate commits, wrong abstraction | Four lines in the reviewer's checklist |
| Smell-to-refactoring catalog | Dropped: it restates published books the model has read |

### 4.1 Follow-up trial: one agent against a three-part harness

**Setup (2026-11-24).**
- **Project:** a small TypeScript project (TypeScript 6.0.3, ESLint 10.15.0 with typescript-eslint 8.74.0, Vitest 5.1.1).
- **Three sequential tasks:** a permission value object; a deny-by-default access check; role inheritance with cycles.
- **Each task:** a task card (JSON with goal, acceptance criteria, allowed and protected paths, check commands) and acceptance tests written beforehand, which the agents were not allowed to edit.
- **How it ran:** every agent on Sonnet, headless `claude -p`. Each arm ran on a fresh copy of the project.

The two arms:
- **A, one agent:** given the card, told to stay in the allowed paths and run the checks until they pass.
- **B, the harness:**
  - an orchestrator skill in the main session;
  - an implementer subagent (six tools, `omitClaudeMd`, `maxTurns: 25`);
  - a gate hook on `SubagentStop` that runs the checks plus a scope check;
  - a path guard on `PreToolUse`;
  - a read-only reviewer subagent.

| Task | A: requests · cumulative input · seconds · USD | B: requests · cumulative input · seconds · USD | B implementer: first · peak request | B orchestrator: cumulative input |
|---|---|---|---|---|
| T1 | 6 · 266,518 · 25 · 0.13 | 14 · 406,675 · 44 · 0.20 | 6,688 · 11,023 | 358,393 |
| T2 | 5 · 220,986 · 31 · 0.13 | 18 · 484,650 · 54 · 0.21 | 6,721 · 12,625 | 405,709 |
| T3 | 7 · 323,601 · 31 · 0.16 | 28 · 636,487 · 82 · 0.30 | 6,744 · 14,791 | 463,013 |

USD is the CLI's reported list-price cost. All numbers ✅[^trial].

**What happened:**
- **Quality: equal.** Both arms passed typecheck, lint and tests on all three tasks. Both also met the one criterion the acceptance tests did not check (the order of inherited permissions), confirmed afterwards with an extra test ✅[^trial].
- **Cost: B was higher.** B used 1.5–2.2× A's cumulative input and took 1.7–2.6× as long. The implementer itself was small: its first request was 6,700 tokens, against A's 40,400. Most of B's cost was the orchestrator in the main session, which carried the same start-up block of about 41,000 tokens on each of its 8–10 requests ✅[^trial].
- **Reviewer calibration.** The reviewer was given a known-good and a known-bad T3 change. The bad change put the parents' permissions before the role's own and still passed every check.
  - It passed the good change and failed the bad one, citing the right line.
  - It also raised a second blocker that was wrong: it said the criteria had no tests, though the protected acceptance tests covered them.
  - Its first request was 4,700 tokens ✅[^trial].
- **Harness defects found:**
  - the orchestrator's diff command used `$(…)`, which the headless permission rules denied;
  - in T3 the first review ran before the diff existed, so the reviewer ran twice;
  - once, the reviewer wrapped its JSON in a code fence with prose around it ✅[^trial].

**Reading** *(synthesis)*:
- On small, well-specified tasks with acceptance tests, one agent plus machine checks was enough. This harness, with a model as its orchestrator, added cost without a measured gain in quality. A later round with the orchestrator as a script and the implementer run as the whole session used 26 % of one agent's input, with the same results (lab notebook, E10).
- The harness saved tokens where it isolated the worker (6,700 against 40,400 at the start). It did not save on the whole run, because an orchestrator that is itself a model repeats a large start-up block on every request.
- A fixed sequence like this one is a workflow, not an open-ended agent task. Running it from code would remove most of the orchestrator's cost.
- Comparing this trial with the numbers earlier in §4 is indicative only: the framework's tasks were larger, and their sizes were not recorded.

The same trial, and every experiment after it (the script orchestrator, the three-arm round 2, when `CLAUDE.md` loads), is also recorded in [harness-lab/lab-notebook.md](harness-lab/lab-notebook.md), entry E5 onward.

---

## 5. The levers, with evidence and the Claude Code setting for each

| Lever | What it saves | Evidence | Claude Code setting | Risk |
|---|---|---|---|---|
| Give each agent only its tools | The start-up block on every request | Allowlisted agents start 40,000+ tokens smaller ✅[^measured] | `tools:`; when omitted, the agent "inherits every tool available to subagents" ✅[^cc_sub] | A needed tool is missing: the agent must stop and ask |
| Leave out instruction files a worker does not need | The start-up block | About 2,000 tokens per request, measured: 2,688 against 4,689 (lab notebook, E7) and 2,611 against 4,694 (E12) | `omitClaudeMd: true` starts the subagent without user, project and local `CLAUDE.md` files ✅[^cc_sub] | Project conventions are lost: put what the task needs into its task card or skill |
| Preload one skill, not a reading list | Eager loading | Levels of loading ✅[^ant_skills] | `skills:` injects "the full skill content", not only the description ✅[^cc_sub], but only when the agent runs as a subagent; as the whole session (`--agent`) the listed skills did not load, so put file paths in the agent's prompt there (lab notebook, E19) | Preloading many skills is eager loading again |
| Cap the turns | Cumulative input | Small agents of 3–10 steps ✅[^12f] | `maxTurns`: at the limit the output returns marked as partial ✅[^cc_sub] | Partial work needs a resume or a smaller task |
| Filter tool output before it enters the context | Tool output repeated on every later request | 150,000 → 2,000 tokens ✅[^ant_mcpcode]; −37 % ✅[^ant_atu] | A check wrapper that prints only failures and writes the full log to a file; a hook's text is capped at 10,000 characters ([harness-engineering-deep-dive.md](harness-engineering-deep-dive.md) §9) | Hidden detail: keep the full log and return its path |
| Turn rules into checks | Instruction density | 68 % at 500 instructions ✅[^ifscale] | `PreToolUse` denies with exit code 2 or `permissionDecision: "deny"`; `SubagentStop` `decision: "block"` keeps the subagent working ✅[^cc_hooks] | False positives block good work: test each check against a known-good and a known-bad sample |
| Grade with a separate evaluator | Self-praise | ✅[^ant_harness2] ✅[^selfpref] | A read-only subagent: `tools: Read, Grep, Glob` | Worth its cost only when the task "sits beyond what the current model does reliably solo" ✅[^ant_harness2] |
| Few agents, one orchestrator | Coordination cost; error amplification (17.2× against 4.4×) | ✅[^scaling] ✅[^mast] | The main session orchestrates; workers have no `Agent` tool, so they cannot start agents of their own ✅[^cc_sub] | Truly parallel work loses its speed-up |
| Hand off through files | Copying large results through messages | Subagents store outputs externally and pass "lightweight references" ✅[^ant_multi]; a JSON feature list ✅[^ant_harness] | A task card and a run record on disk; the agent returns a path and a short summary | Stale files poison later runs |
| Let the agent say "not sure" | Guessed facts | Abstaining cut errors from 75 % to 26 % at almost the same accuracy ✅[^oai_hall] | An output contract with a `blocked` or `question` status | More questions reach the person |
| Scale effort to the task | Over-spawning | Simple fact-finding: 1 agent, 3–10 tool calls. Comparisons: 2–4 subagents. Early versions spawned "50 subagents for simple queries" ✅[^ant_multi] | Rules in the orchestrator's skill | Under-resourcing hard tasks |

**Packaging note:**
- Plugin subagents "don't support the hooks, mcpServers, or permissionMode frontmatter fields" ✅[^cc_sub].
- A harness shipped as a plugin therefore puts its hooks in `hooks/hooks.json` at the plugin root ✅[^cc_plugins].
- Hooks from settings and plugins also run inside subagents. Their input carries `agent_id` and `agent_type`, and a `SubagentStop` matcher matches the agent type ✅[^cc_hooks].

---

## 6. A popular ten-technique list, checked

A list of "10 context engineering techniques" circulates as a Medium article, also translated on vneduai.com ✅[^tenlist]:
- it names no author or date;
- it cites no study, and none of its numbers has a source, including "70–90 %" context reduction without losing important information;
- it is written for retrieval chatbots.

| Technique in the list | Applies to a coding agent? *(synthesis)* | Evidence elsewhere |
|---|---|---|
| Compression | Yes: filter tool output, compact history | ✅[^ant_mcpcode] |
| Ranking retrieved documents | Only when the agent searches a document store | — |
| Context sized to the task | Yes, as effort scaling | ✅[^ant_multi] |
| Metadata filtering | Only for document-store search | — |
| Deduplication | Yes: repeated reads of the same file | — |
| Conversation memory | Yes: a progress file instead of a long history | ✅[^ant_harness] |
| Hierarchical retrieval | Yes, as levels of loading | ✅[^ant_skills] |
| Caching | Yes: a stable prefix ([context-engineering-deep-dive.md](context-engineering-deep-dive.md) §6) | — |
| Structured formatting | Yes: JSON for state the agent must not rewrite | ✅[^ant_harness] |
| Validation (freshness, contradictions) | Yes: contradictions cause context clash | — |

What the list leaves out is what costs most in an agent: tool definitions, the number of requests, the number of agents, gates, and the evaluator.

---

## 7. Design checklist *(synthesis: starting targets to measure against, not sourced limits)*

1. **Measure first:** first request, peak request, cumulative input, requests, minutes and pass rate per task (§9).
2. **Worker start-up under about 15,000 tokens:** a tool allowlist, no `Agent` tool, only the instruction files the task needs.
3. **The task card at the end of the prompt, under about 2,000 tokens.** It holds the goal, acceptance criteria, allowed paths, check commands and up to three example files to copy.
4. **No reading lists.**
   - Rules that can fail a check become lint rules, tests or hooks.
   - Project facts go into a short constitution and glossary.
   - Procedures become skills loaded when relevant.
   - Examples are paths to real files, not prose.
5. **Check output filtered to failures, the full log on disk.**
6. **A turn cap per worker:** start near 25 and lower it when runs finish earlier.
7. **Machine gate first, evaluator second:** the evaluator reads the acceptance criteria, the diff and the gate result, and returns a verdict with `file:line` evidence.
8. **One orchestrator, few workers.** Add a role only when a measurement shows the cost of a gap.
9. **Every harness part names the failure it prevents.** Remove the part when a newer model no longer shows that failure.

---

## 8. Failure matrix

| Symptom | Cause | Fix |
|---|---|---|
| Every subagent starts at 50,000+ tokens | Inherited tools and instruction files | Tool allowlist, `omitClaudeMd`; measure the first request ✅[^cc_sub] ✅[^measured] |
| A role reads ten rule files before writing a line | Eager preset | Checks plus a skill loaded when relevant ✅[^ant_skills] |
| Rules are followed at random | Instruction density, early-instruction bias | Fewer rules in context; enforce the rest with code ✅[^ifscale] |
| Context passes 150,000 tokens on a small task | Unfiltered file reads and check output | Filter in code; keep the full log on disk ✅[^ant_mcpcode] ✅[^measured] |
| The reviewer approves broken work | Self-preference; an evaluator "inclined to be generous" | A separate, skeptical evaluator with criteria agreed first, after a machine gate ✅[^ant_harness2] |
| The agent invents a file, an API or a version | Guessing is rewarded | Allow `blocked` or `question`; demand `file:line`; check with a tool ✅[^oai_hall] |
| A multi-agent pipeline is slower and worse than one agent on a sequential task | Coordination cost | Fewer agents, one orchestrator ✅[^scaling] |
| Hooks in a plugin's agent file never fire | Plugin subagents ignore frontmatter hooks | Put them in `hooks/hooks.json` and match on the agent type ✅[^cc_sub] ✅[^cc_hooks] |
| A long run wraps up early, as if out of room | "Context anxiety" | Context resets with a structured handoff; Opus 4.5 "largely removed that behavior" ✅[^ant_harness2] |
| A worker starts its own subagents | `Agent` tool inherited | Leave `Agent` out of `tools` ✅[^cc_sub] |

---

## 9. Measure it yourself

Tested on 2026-11-24 with Python 3 over Claude Code transcripts. The script reads every subagent transcript and its `.meta.json` file, which holds the agent type. It prints medians per agent type. Lines that repeat a message id are one request.

```python
#!/usr/bin/env python3
# Usage: python3 -I subagent_cost.py [agent-type-prefix]
import datetime, glob, json, os, statistics, sys

root = os.path.expanduser("~/.claude/projects")
prefix = sys.argv[1] if len(sys.argv) > 1 else ""
runs = {}
for path in glob.glob(root + "/**/subagents/agent-*.jsonl", recursive=True):
    try:
        kind = json.load(open(path[:-len(".jsonl")] + ".meta.json")).get("agentType", "?")
    except (OSError, ValueError):
        kind = "?"
    if not kind.startswith(prefix):
        continue
    seen, sizes, out, t0, t1 = set(), [], 0, None, None
    for line in open(path, encoding="utf-8", errors="ignore"):
        try:
            o = json.loads(line)
        except ValueError:
            continue
        if o.get("timestamp"):
            t = datetime.datetime.fromisoformat(o["timestamp"].replace("Z", "+00:00"))
            t0, t1 = t0 or t, t
        m = o.get("message") or {}
        u = m.get("usage")
        if o.get("type") != "assistant" or not isinstance(u, dict) or m.get("id") in seen:
            continue
        seen.add(m.get("id"))
        sizes.append(u.get("input_tokens", 0) + u.get("cache_creation_input_tokens", 0)
                     + u.get("cache_read_input_tokens", 0))
        out += u.get("output_tokens", 0)
    if sizes:
        runs.setdefault(kind, []).append(
            (len(sizes), sizes[0], max(sizes), sum(sizes), out, (t1 - t0).total_seconds() / 60))

print("type requests first peak cumulative output minutes (medians)")
for kind, rs in sorted(runs.items(), key=lambda kv: -len(kv[1])):
    cols = [statistics.median(c) for c in zip(*rs)]
    print(kind, len(rs), *[round(c, 1) for c in cols])
```

**Reading the output:**
- `first` is the start-up block plus the task.
- `cumulative` is what the model read in total, cached or not.
- `minutes` includes deliberate waits.
- A type of `?` means the metadata file was missing.

Run it before and after a harness change, on the same tasks.

---

## 10. Verification

- **Verified on 2026-11-24:** every ✅ claim against the sources in References. They were read live: vendor engineering posts, the Claude Code docs, arXiv abstract pages, the OpenAI post and the 12-factor repository.
- **Measured on 2026-11-24:** every ✅[^measured] number, with the §9 script over the transcripts on one machine, and with `wc -c` and `grep` over the framework's files.
- **Synthesis, not a sourced claim:**
  - point 4 of §2;
  - the replacement table in §4;
  - the applicability column in §6;
  - the checklist targets in §7.
- **Estimates, not measurements:** the token figures derived from byte counts in §4 (bytes ÷ 4). The saving from `omitClaudeMd` was measured later, in the lab notebook (E7, E12). The "70–90 %" figure of the ten-technique list is reported only as the list's own unsourced claim.
- **Measured on 2026-11-24:** the trial in §4.1. Its arms were run once each, so the numbers show size, not run-to-run spread. The same numbers are in `harness-lab/lab-notebook.md`: E5 for the trial, E4 for the reviewer calibration.
- **Not covered:** quality of the framework's output in §4, where only cost was measured. In §4.1 quality was compared on three small tasks only.

## References

- Local measurement: the §9 script over the Claude Code transcripts on one machine, plus `wc -c` and `grep` over agentic-sdlc v2's `agents/`, `foundations/`, `stacks/`, `paradigms/` and `schemas/`, 2026-11-24. Backs: §2; §4; §5; §8. [^measured]
- Local trial, recorded in full in [harness-lab/lab-notebook.md](harness-lab/lab-notebook.md) (E4, E5): three task cards run once by one Sonnet agent and once through an orchestrator, implementer, gate, guard and reviewer, with headless Claude Code 2.1.330 on 2026-11-24. Backs: §4.1. [^trial]
- [Chroma: Context Rot](https://www.trychroma.com/research/context-rot) — Hong, Troynikov, Huber, 2025. Backs: §3 context rot. [^chroma]
- [Lost in the Middle: How Language Models Use Long Contexts](https://arxiv.org/abs/2307.03172) — Nelson F. Liu et al., TACL 2023. Backs: §3 position effect. [^lost]
- [NoLiMa: Long-Context Evaluation Beyond Literal Matching](https://arxiv.org/abs/2502.05167) — Ali Modarressi et al., ICML 2025, read 2026-11-24. Backs: §1; §3. [^nolima]
- [How Many Instructions Can LLMs Follow at Once?](https://arxiv.org/abs/2507.11538) — Daniel Jaroslawicz, Brendan Whiting, Parth Shah, Karime Maamari, 2025, read 2026-11-24. Backs: §3; §4 cause 3; §5; §8. [^ifscale]
- [When "A Helpful Assistant" Is Not Really Helpful: Personas in System Prompts Do Not Improve Performances of Large Language Models](https://arxiv.org/abs/2311.10054) — Mingqian Zheng, Jiaxin Pei, Lajanugen Logeswaran, Moontae Lee, David Jurgens, Findings of EMNLP 2024, read 2026-11-24. Backs: §3 personas. [^persona]
- [LLM Evaluators Recognize and Favor Their Own Generations](https://arxiv.org/abs/2404.13076) — Arjun Panickssery, Samuel R. Bowman, Shi Feng, 2024, read 2026-11-24. Backs: §3; §5. [^selfpref]
- [Why language models hallucinate](https://openai.com/index/why-language-models-hallucinate/) — Adam Kalai, Ofir Nachum, Santosh Vempala, Eddie Zhang et al., OpenAI, 2025-09-05, read 2026-11-24. Backs: §3; §5; §8. [^oai_hall]
- [How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) — Jeremy Hadfield, Barry Zhang, Kenneth Lien, Florian Scholz, Jeremy Fox, Daniel Ford, Anthropic, 2025-06-13, read 2026-11-24. Backs: §3; §4 cause 5; §5; §6. [^ant_multi]
- [Towards a science of scaling agent systems](https://research.google/blog/towards-a-science-of-scaling-agent-systems-when-and-why-agent-systems-work/) — Yubin Kim and Xin Liu, Google Research, 2026-01-28, with the paper [arXiv 2512.08296](https://arxiv.org/abs/2512.08296); read 2026-11-24. Backs: §3; §4 cause 5; §5; §8. [^scaling]
- [Why Do Multi-Agent LLM Systems Fail?](https://arxiv.org/abs/2503.13657) — Mert Cemri, Melissa Z. Pan, Shuyi Yang et al., 2025 (v3 2025-10-26), read 2026-11-24. Backs: §3; §5. [^mast]
- [Anthropic engineering: advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use) — Anthropic, 2025-11-24, read 2026-11-24. Backs: §3 tool definitions, programmatic tool calling; §5. [^ant_atu]
- [Code execution with MCP: Building more efficient agents](https://www.anthropic.com/engineering/code-execution-with-mcp) — Anthropic, 2025-11-04, read 2026-11-24. Backs: §3; §5; §6; §8. [^ant_mcpcode]
- [Equipping agents for the real world with Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) — Anthropic, 2025-10-16, read 2026-11-24. Backs: §3; §4 cause 2; §5; §6; §8. [^ant_skills]
- [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) — Justin Young, Anthropic, 2025-11-26, read 2026-11-24. Backs: §3; §5; §6. [^ant_harness]
- [Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps) — Prithvi Rajasekaran, Anthropic, 2026-03-24, read 2026-11-24. Backs: §1; §3; §5; §8. [^ant_harness2]
- [12-Factor Agents](https://github.com/humanlayer/12-factor-agents) — HumanLayer (Dex), living; content CC BY-SA 4.0; factor 10 page [Small, Focused Agents](https://github.com/humanlayer/12-factor-agents/blob/main/content/factor-10-small-focused-agents.md), read 2026-11-24. Backs: §3; §5. [^12f]
- [Create custom subagents](https://code.claude.com/docs/en/sub-agents) — Anthropic, living, read 2026-11-24. Backs: §4 cause 1; §5 `tools`, `omitClaudeMd`, `skills`, `maxTurns`, plugin restriction; §8. [^cc_sub]
- [Hooks reference](https://code.claude.com/docs/en/hooks) — Anthropic, living, read 2026-11-24. Backs: §4 replacement table; §5 `PreToolUse` deny, `SubagentStop` block, `agent_type`, matcher. [^cc_hooks]
- [Plugins reference](https://code.claude.com/docs/en/plugins-reference) — Anthropic, living, read 2026-11-24. Backs: §5 packaging note. [^cc_plugins]
- [10 Context Engineering Techniques Every AI Engineer Should Know](https://medium.com/ai-in-plain-english/10-context-engineering-techniques-every-ai-engineer-should-know-b54b486a6921) — Medium, undated; Vietnamese translation at [vneduai.com](https://vneduai.com/kien-thuc-ai/10-context-engineering-techniques), read 2026-11-24. Backs: §6 the list and its lack of sources. [^tenlist]

## Related

- [Context engineering, end to end](context-engineering-deep-dive.md) — the four moves (write, select, compress, isolate), caching and failure modes in full.
- [Harness engineering, end to end](harness-engineering-deep-dive.md) — guides and sensors, gates, exit-code handling.
- [What each coding agent loads at session start](session-start-context-by-agent.md) — the start-up block per agent, with the subagent sizes measured here.
- [Token accounting in coding agents](agent-token-accounting.md) — what each usage field counts.
- [Measure tokens in a Claude Code or Codex session](measure-agent-tokens.md) — per-session scripts.
- [Audit agent sessions for token waste](audit-agent-efficiency.md) — weekly waste detection.
- [Harness lab notebook](harness-lab/lab-notebook.md) — the experiments that test these levers, with commands and results.
- [Subagent execution boundaries](subagent-execution-boundaries.md) — what a subagent inherits and how hooks stop it.
