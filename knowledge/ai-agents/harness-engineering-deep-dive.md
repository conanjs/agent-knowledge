---
schema: deep-dive/v1
topic: ai-agents
status: verified
applies-to: ["Coding and task agents (Claude Code, Codex, LangChain Deep Agents and similar)", "sources read 2026-10-30; the 2026-03-24 Anthropic post 2026-11-24; §6.4–§6.6 sources 2026-11-26"]
last-verified: 2026-10-30
last-updated: 2026-11-26
synthesized-into: []
tags: [harness-engineering, agent-harness, guides, sensors, hooks, agents-md, long-running-agents, feedback-loops]
---

# Harness engineering, end to end

## Summary
**TL;DR:** An agent is a model plus a harness: every piece of code, configuration and execution logic that is not the model. The harness includes:
- prompts and tools;
- the sandbox and file system;
- hooks, memory and compaction;
- sub-agents and verification.

Harness engineering is designing that layer so the agent's work can be trusted. It has two halves. **Guides** steer the agent before it acts (instruction files, templates, skills). **Sensors** check its work afterwards and feed errors back (tests, linters, review agents). The core habit: every agent mistake becomes a harness change, so the same mistake cannot happen again. With the model held fixed, harness changes alone have moved a coding agent from outside the top 30 to the top 5 of a benchmark.
**Use this when:** you set up a repo for coding agents; an agent declares victory too early, leaves broken state or drifts from the architecture; you choose between adding a rule to `AGENTS.md`/`CLAUDE.md` and adding a check; you compare agent tools; someone asks how prompt, context, harness, loop and graph engineering differ.
**Depth:** every harness component with its default; the guides/sensors × computational/inferential model; the comparison of all five disciplines; the improvement loop; three worked cases with numbers (Anthropic long-running agents, OpenAI's agent-written product, LangChain on Terminal Bench); how Anthropic's published harnesses plan the work (§6.4); how three vendors document orchestrating agents in code (§6.5); what Anthropic describes for improving an agent across runs (§6.6); this repo's own harness as an artifact; a cross-component interaction matrix; a failure matrix; open questions.

---

## 1. Words first

| Term | Plain English | Analogy | Concrete artifact |
|---|---|---|---|
| Model | The trained network that turns input tokens into output tokens | An engine | `claude-opus-5-5`, `gpt-5.2-codex` |
| Harness | Everything in an agent that is not the model ✅[^lc_anatomy] | The car around the engine: steering, brakes, dashboard, seatbelts | Claude Code, Codex CLI, `deepagents-cli` |
| Agent | Model + harness ✅[^lc_anatomy]; it directs its own process and tool use ✅[^bea] | A driver in a car, not an engine on a test bench | A coding agent that edits, runs tests and opens a PR |
| Builder harness / user harness | The harness a vendor ships, versus the outer layer a team adds for its own system ✅[^fowler] | The car as delivered, versus the roof rack and child seat you add | Claude Code itself, versus your repo's `CLAUDE.md`, hooks and lint rules |
| Guide (feedforward) | A control that steers the agent *before* it acts ✅[^fowler] | Lane markings | `AGENTS.md`, a service template, a skill |
| Sensor (feedback) | A control that observes *after* the agent acts and helps it self-correct ✅[^fowler] | A rumble strip | Tests, linters, type checker, an AI reviewer |
| Computational / inferential control | Deterministic and fast, run by the CPU / semantic judgement by a model, slower and non-deterministic ✅[^fowler] | A spell checker / an editor | ESLint, ArchUnit / "LLM as judge" review |
| Hook | A command the harness runs at a fixed point in the agent's life cycle, so it always happens instead of the model choosing to ✅[^cc_hooks] | A turnstile | A `PreToolUse` hook that blocks `DROP TABLE`, exiting 2 |
| Agent-computer interface (ACI) | The tools and their documentation, designed as carefully as a human UI ✅[^bea] | The dashboard and controls | A tool that only accepts absolute file paths ✅[^bea] |

---

## 2. Where the term comes from (timeline)

| Date | Source | Contribution |
|---|---|---|
| 2024-12-19 | Anthropic, *Building effective agents* | Separates workflows (predefined code paths) from agents (the model directs its own process). Defines the "augmented LLM" (retrieval, tools, memory) and the ACI. While building its SWE-bench agent, the team "spent more time optimizing our tools than the overall prompt" ✅[^bea] |
| 2025-11-26 | Anthropic, *Effective harnesses for long-running agents* | Calls the Claude Agent SDK "a powerful, general-purpose agent harness". Shows the harness that lets an agent work across many context windows (§6.1) ✅[^ant_harness] |
| 2026-02-05 | Mitchell Hashimoto, *My AI Adoption Journey*, step 5 "Engineer the Harness" | Harness engineering is "the idea that anytime you find an agent makes a mistake, you take the time to engineer a solution". It takes two forms: better implicit prompting (`AGENTS.md`) and programmed tools ✅[^hashimoto] |
| 2026-02-11 | OpenAI, *Harness engineering: leveraging Codex in an agent-first world* | A product built with no manually-written code. The engineer's job becomes designing environments, stating intent and building feedback loops (§6.2) ✅[^openai] |
| 2026-02-17 | LangChain, *Improving Deep Agents with harness engineering* | Harness-only changes, model fixed: Terminal Bench 2.0 from 52.8 to 66.5 (§6.3) ✅[^lc_improve] |
| 2026-03-10 | LangChain, *The Anatomy of an Agent Harness* | "Agent = Model + Harness", and a component list (§4) ✅[^lc_anatomy] |
| 2026-03-24 | Anthropic, *Harness design for long-running application development* | A planner, a generator and a separate evaluator that clicks through the running app. Agents "reliably skew positive" when grading their own work, and tuning a separate evaluator to be skeptical is "far more tractable". "Every component in a harness encodes an assumption about what the model can't do on its own", so parts are removed as models improve: the sprint construct was dropped for Opus 4.6. Cost: a solo run took 20 minutes and 9 USD, the full harness 6 hours and 200 USD ✅[^ant_harness2] |
| 2026-04-02 | Birgitta Böckeler (Thoughtworks), on martinfowler.com | Guides and sensors, computational and inferential; the user harness; harness engineering as "a specific form of context engineering" ✅[^fowler] |

None of the primary sources above says who coined the term; the martinfowler.com article credits no one ✅[^fowler]. This doc does not settle it.

---

## 3. Five disciplines compared

This is the one place in the knowledge base that compares the five, so other docs link here. Each row is backed by its own sources, but the side-by-side framing is this doc's synthesis.

| Discipline | Question it answers | What you design | Typical artifact | Deep doc |
|---|---|---|---|---|
| Prompt engineering | What should the model do, and how should it answer? | The instructions for one call ✅[^oai_prompt] | A system prompt; a role file | [prompt-engineering-deep-dive.md](prompt-engineering-deep-dive.md) |
| Context engineering | What should the model see on this call? | The whole token set per call, across turns ✅[^ant_ctx] | Tool set, memory files, compaction policy, retrieval | [context-engineering-deep-dive.md](context-engineering-deep-dive.md) |
| Harness engineering | What surrounds the model, so its work can be trusted? | All non-model code and config: tools, sandbox, hooks, checks, memory ✅[^lc_anatomy] ✅[^fowler] | `AGENTS.md`, custom linters, hooks, `init.sh`, review agents | this doc |
| Loop engineering | How does the system keep calling the model, feed it results, and decide when to stop? | The act-observe-decide cycle and its stop condition | A verify-fix loop; a "Ralph Wiggum" loop ✅[^openai] | [loop-engineering.md](loop-engineering.md) |
| Graph engineering | Which step runs next, and who decides? | Explicit nodes, shared state and routing between steps ✅[^bea] (workflows) | A state graph with a review → fix edge | [graph-engineering-study-guide.md](graph-engineering-study-guide.md) |

How the sources nest them:
- Anthropic calls context engineering the progression of prompt engineering ✅[^ant_ctx].
- Böckeler calls harness engineering "a specific form of context engineering" ✅[^fowler].
- LangChain lists context management and the system prompt among the harness's components ✅[^lc_anatomy].

**Synthesis:** these are views of one system at different scopes, not stages. Every harness ends up as context, because a lint message or hook output is text the model reads. Every context is built by a harness. The loop and the graph are the harness's control flow: the loop is the repetition, and the graph is the routing.

---

## 4. The components of a harness

The component list is LangChain's ✅[^lc_anatomy]. Examples and defaults come from the other sources.

| Component | What it does | When it is missing (default) | Example artifact |
|---|---|---|---|
| System prompt | Shapes behaviour on every call | Generic model behaviour | Codex/Claude Code base prompt; a role file |
| Tools, skills, MCP servers | Callable capabilities and their descriptions | The model can only talk | `read_file`, a screenshot script ✅[^hashimoto], Chrome DevTools skills ✅[^openai] |
| File system | Durable storage for data, docs and intermediate work | State lives only in the context, and is lost at reset | `claude-progress.txt`, a feature list ✅[^ant_harness] |
| Sandbox / execution environment | Isolated place to run code, install packages, use a browser | No way to verify by running | App bootable per git worktree, one instance per change ✅[^openai] |
| Orchestration / sub-agents | Spawning, hand-offs, routing between models | One context does everything | Initializer agent vs. coding agent ✅[^ant_harness] |
| Hooks / middleware | Deterministic steps at fixed points: compaction, continuation, lint checks | Every check depends on the model choosing to run it ✅[^cc_hooks] | Pre-completion checklist, loop detection ✅[^lc_improve] |
| Memory | Persistent knowledge loaded at start | The agent rediscovers conventions every session | `AGENTS.md` ✅[^agentsmd], `CLAUDE.md` ✅[^cc_memory] |
| Context management | Keeps the window usable: summarising, offloading | Context rot on long tasks | Compaction; tool-result clearing ✅[^ant_ctx] |
| Verification | Tests or self-evaluation that feed errors back | "Looks right" becomes done | Test suite; browser end-to-end check ✅[^ant_harness] |

---

### Session-start hooks: a reminder that does not depend on memory

A hook at session start can put state in front of the model before the first prompt, and show it to the person too:
- **Claude Code `SessionStart`:** the hook's plain stdout, or `hookSpecificOutput.additionalContext`, is added to the model's context ✅[^cc_hooks_ref]. The top-level `systemMessage` is shown to the user ✅[^cc_hooks_ref].
- **Copilot CLI `sessionStart`:** only `additionalContext` is used ✅[^copilot_hooks]. User-level hook files load from `~/.copilot/hooks/` ✅[^copilot_hooks].
- **Codex `SessionStart`:**
  - plain stdout or `hookSpecificOutput.additionalContext` becomes developer context, and `systemMessage` is shown as a warning ✅[^codex_hooks];
  - hooks load from `~/.codex/hooks.json` among other places ✅[^codex_hooks];
  - a non-managed hook runs only after the user reviews and trusts it in `/hooks` ✅[^codex_hooks].
  - **tested 2026-10-31** (Codex CLI 0.164.0-alpha bundled in the ChatGPT desktop app): with the hook linked but not trusted, `codex exec` skipped it without printing any warning, and the model reported no tracker items. Claude Code's auto mode refused the documented one-off flag `--dangerously-bypass-hook-trust` as a safety bypass, so trusting the hook stays the user's review. Trusting and enabling are two separate switches in `/hooks`: Codex records them as `trusted_hash` and `enabled` under `[hooks.state."<file>:session_start:…"]` in `~/.codex/config.toml`. A trusted hook with `enabled = false` still does not run (seen 2026-10-31). Once it was enabled, `codex exec` logged "hook: SessionStart Completed", and the model listed the tracker's open items.

**Tested 2026-10-30** with agent-config's tracker (`copilot/tracker/`, `specs/015-tracker/`):
- **Minimal `PATH`.** A hook may start without the login shell's `PATH`. Its launcher found nvm's Node under `env -i PATH=/usr/bin:/bin`, and both outputs were valid JSON.
- **Global settings.** Claude Code's auto mode refused an agent's edit to `~/.claude/settings.json` that adds a hook, as self-modification. Wiring a global hook is therefore the user's step.
- **Live session (2026-10-31).** After the user merged the hook, a headless session (`claude -p --output-format stream-json`) logged the hook's `hook_response`. Asked for the ids of the open items it had been given, the model listed all four.

## 5. Guides and sensors (Böckeler's model)

Two axes:
- **When** a control acts: *guide*, before the action, or *sensor*, after it.
- **How** it decides: *computational*, by deterministic code, or *inferential*, by a model ✅[^fowler].

| | Computational | Inferential |
|---|---|---|
| **Guide** (before) | Service and harness templates ✅[^fowler]; a feature list generated before any coding ✅[^ant_harness] | `AGENTS.md` / `CLAUDE.md` rules; skills; design docs ✅[^openai] ✅[^hashimoto] |
| **Sensor** (after) | Tests, linters, type checkers, structural tests such as ArchUnit ✅[^fowler]; custom lints whose messages carry fix instructions ✅[^openai] | AI code review; LLM as judge ✅[^fowler]; agent-to-agent PR review ✅[^openai] |

What a harness regulates ✅[^fowler]:
- **Maintainability:** internal quality, mostly with existing tools.
- **Architecture fitness:** fitness functions that check architecture characteristics.
- **Behaviour:** does the application do what we need? Böckeler calls this "the elephant in the room", because today it leans too much on AI-written tests.

Two related ideas from the same article ✅[^fowler]:
- **Harnessability**: Ned Letcher's "ambient affordances", meaning how legible, navigable and tractable a codebase is to agents. Greenfield repos can build it in; legacy repos struggle.
- **Harness templates**: bundles of guides and sensors for one kind of service.

**Synthesis:** prefer a computational sensor wherever the rule can be checked mechanically. A guide can be ignored. A sensor's failure message reaches the model as context, so it also acts as a guide for the next attempt. OpenAI writes custom lint messages "to inject remediation instructions into agent context" ✅[^openai].

---

## 6. Worked cases and vendor practice

### 6.1 Anthropic: an agent that works across many context windows

**Problem.** Building a large app over many sessions, the agent failed in four ways ✅[^ant_harness]:
- it tried to do too much at once and ran out of context mid-feature;
- it left half-done, undocumented state;
- it saw progress and declared the job done;
- it marked features complete without end-to-end checks.

**Harness.**
- **Initializer agent (first session).** It differs only in its prompt. It writes:
  - a JSON feature list of 200+ features, all marked failing, each with a `passes` field. JSON because the model is less likely to overwrite it wrongly than Markdown.
  - `claude-progress.txt`;
  - `init.sh` to start the dev server;
  - a git repo.

  Agents are told it is unacceptable to remove or edit the tests ✅[^ant_harness].
- **Coding agent (every later session)** ✅[^ant_harness]:
  1. Check the working folder.
  2. Read the git log and the progress file.
  3. Read the feature list; pick the highest-priority failing feature.
  4. Run `init.sh` and a basic end-to-end test, to catch broken state before adding anything.
  5. Implement **one** feature (called "critical").
  6. Test it as a human user would, through browser automation (Puppeteer MCP).
  7. Mark it passing only after that check; commit with a descriptive message; update the progress file.

| Failure | Guide added | Sensor added |
|---|---|---|
| Early victory | Feature list with every feature failing | `passes` flipped only after an end-to-end check |
| Broken, undocumented state | Progress file, git, "one feature per session" | Smoke test at the start of every session |
| Premature "passing" | "Test as a human user would" | Browser automation |
| Time lost working out how to run the app | `init.sh` | — |

**Open questions the post leaves** ✅[^ant_harness]:
- Would one general agent or specialised agents (testing, QA) do better?
- Does the approach carry beyond full-stack web apps?
- Known limit: Claude could not see browser-native alert modals.

### 6.2 OpenAI: a product with no manually-written code

**Numbers** ✅[^openai]:
- First commit in late August 2025.
- About a million lines and about 1,500 merged PRs, driven by three engineers (later seven), roughly 3.5 PRs per engineer per day.
- Built in an estimated tenth of the hand-written time.
- Single runs often last more than six hours.

**Harness choices** ✅[^openai]:
- **Find the missing capability.** Early progress was slow "because the environment was underspecified", not because the model was weak. The standing question for any failure: what capability is missing, and how is it made "both legible and enforceable for the agent"?
- **Legibility:**
  - the app is bootable per git worktree;
  - Chrome DevTools Protocol is wired into the agent runtime;
  - logs, metrics and traces live in an ephemeral local stack per worktree, which agents query with LogQL and PromQL.

  This makes goals like "service startup under 800 ms" checkable.
- **The repo is the system of record:**
  - `AGENTS.md` is a ~100-line map, not a manual. A giant one failed: it crowded out the task, made everything "important", rotted, and could not be checked.
  - Deeper knowledge lives in an indexed `docs/` tree: design docs, execution plans, product specs, a quality score per domain.
  - Linters and CI check that the docs are current and cross-linked.
  - A "doc-gardening" agent opens fix-up PRs.
  - The working rule: knowledge in chat threads or people's heads does not exist for the agent.
- **Architecture by enforcement:**
  - Each domain has fixed layers (Types → Config → Repo → Service → Runtime → UI), with cross-cutting concerns entering only through Providers.
  - Custom linters and structural tests enforce this.
  - "Taste invariants" are linted too: structured logging, naming, file size.
- **Garbage collection.** The team used to spend every Friday, 20% of the week, cleaning "AI slop". Now:
  - "golden principles" are encoded in the repo;
  - background agents scan for deviations, update quality grades and open small refactoring PRs, most reviewable in under a minute.
- **Merge philosophy.** Minimal blocking gates and short-lived PRs, because corrections are cheap and waiting is expensive. The post says this would be irresponsible in a low-throughput team.

### 6.3 LangChain: same model, better harness

`deepagents-cli` with `gpt-5.2-codex` went from 52.8% to 66.5% on Terminal Bench 2.0, "Top 30 to Top 5", with harness changes only ✅[^lc_improve]:

| Change | Kind (§5) | What it does |
|---|---|---|
| Build-verify workflow in the system prompt | Guide, inferential | Plan → build with tests → verify against the spec → fix |
| Pre-completion checklist middleware | Sensor at exit | Stops the agent before it finishes and forces a verification pass |
| Loop detection middleware | Sensor | After N edits to the same file, suggests rethinking the approach |
| Local context middleware | Guide, computational | Maps the folder and finds installed tools at start |
| Time budget warnings | Guide | Pushes toward verification as time runs out |
| Reasoning "sandwich" | Configuration | Highest reasoning for planning and verification, high for implementation. Highest everywhere scored only 53.9% (timeouts), versus 63.6% at high |

**How they found what to change.** Traces in LangSmith, plus a trace-analyser skill that runs parallel error-analysis agents. The most common failure: the agent wrote a solution, re-read it, decided it looked fine, and stopped ✅[^lc_improve].

**Caveats from the post** ✅[^lc_improve]:
- Changes tuned to one task can hurt elsewhere.
- Guard rails like loop detection are workarounds for today's models.
- A loop detector cannot stop a model that is sure it is right.

---

### 6.4 How the published Anthropic harnesses plan the work

What each source says about the planning artifacts, read 2026-11-26:

| Source | Who writes the plan | Its form | What later agents may change | Any script turning a plan into data? |
|---|---|---|---|---|
| *Effective harnesses for long-running agents* (2025-11-26) | The initializer agent expands the user's prompt into a feature list, every feature failing | JSON with `category`, `description`, `steps` and `passes`; models are "less likely to inappropriately change or overwrite JSON files" than Markdown | Coding agents edit it "only by changing the status of a passes field" | No: the initializer writes the JSON itself ✅[^ant_harness] |
| *Harness design for long-running application development* (2026-03-24) | A planner expands "a simple 1-4 sentence prompt" into a full product spec, kept to "product context and high level technical design", because spec errors would "cascade into the downstream implementation" | The article names no format; its example is headed prose with user stories and a data model. Before each sprint the generator and the evaluator negotiate a "sprint contract" on what done looks like. "Communication was handled via files" | The sprint construct and its contracts were later removed for Opus 4.6, leaving one evaluator pass at the end | No ✅[^ant_harness2] |
| Claude Code best practices (living) | The person and Claude: "Interview me until you could write the spec, then write it to SPEC.md", then "start a fresh session to build from it" | A Markdown file | — | No ✅[^cc_best] |

*(Synthesis.)* None of the three compiles Markdown tasks into JSON. Each keeps the machine-checked state (pass flags, contracts, tests) apart from the prose plan, and the one that uses JSON has the model write it directly.

### 6.5 Orchestrating agents in code: what Anthropic, OpenAI and Google document

All three vendors document two ways to run several agents: a model decides which agent runs next, or ordinary code does. Read 2026-11-26:

| Vendor | Code decides | A model decides | How to drive their coding agent from a program |
|---|---|---|---|
| Anthropic | Workflows are "orchestrated through predefined code paths"; it advises that "developers start by using LLM APIs directly" ✅[^bea]. Claude Code's dynamic workflows: "A workflow moves the plan into code", as "a JavaScript script" that runs subagents ✅[^cc_wf] | Agents, where the model directs its own process ✅[^bea]; the research system's lead agent is a model, "Claude Opus 4 as the lead agent" ✅[^ant_multi] | Headless mode is "available as a CLI for scripts and CI/CD", with JSON output and `--resume` ✅[^cc_headless]; the Agent SDK is "programmable in Python and TypeScript" ✅[^cc_sdk] |
| OpenAI | "Orchestrating via code: determining the flow of agents via your code", with structured outputs to route, chaining, an evaluator loop and parallel runs ✅[^oai_orch]; it "makes tasks more deterministic and predictable" ✅[^oai_orch_js] | Handoffs and agents as tools ✅[^oai_orch]; the practical guide's manager and decentralized patterns, after the advice to "maximize a single agent's capabilities first" ✅[^oai_guide] | `codex exec` to "Run as part of a pipeline (CI, pre-merge checks, scheduled jobs)" ✅[^codex_exec]; the Codex SDK to "Programmatically control local Codex agents" ✅[^codex_sdk] |
| Google | ADK's workflow agents run "without consulting an AI model for assistance with the orchestration", for "deterministic and predictable execution patterns"; the page marks them "superseded by more flexible workflow structures" (graph and dynamic workflows) ✅[^adk_wf]. Sequential pipelines are "linear, deterministic, and refreshingly easy to debug" ✅[^adk_patterns] | Coordinator agents: "This relies on LLM-driven delegation" ✅[^adk_patterns] | Gemini CLI headless mode "runs Gemini CLI once and exits" ✅[^gemini_auto] and "provides a programmatic interface" ✅[^gemini_headless]; its pages carry a banner that Gemini CLI was replaced by Antigravity CLI on 2026-06-18 |

*(Synthesis.)* None of the quoted pages says one way is always better. Code is chosen when the steps and their order are known in advance, for determinism and easier debugging; a model is chosen when the next step depends on judgement. Google's measurement of the cost of multi-agent coordination on sequential work is in [efficient-coding-agents-deep-dive.md](efficient-coding-agents-deep-dive.md) §3.

### 6.6 Improving an agent across runs: what Anthropic describes

Read 2026-11-26. Two loops are easy to confuse:

| Loop | What Anthropic says | Scope |
|---|---|---|
| Evaluator-optimizer | "one LLM call generates a response while another provides evaluation and feedback in a loop", useful when there are "clear evaluation criteria" ✅[^bea] | Inside one task |
| Evaluation and transcript review | Build an evaluation, read the agents' transcripts, change the tools, evaluate again: "Simply concatenate the transcripts from your evaluation agents and paste them into Claude Code"; "Claude is an expert at analyzing transcripts and refactoring lots of tools" ✅[^ant_tools] | Across runs, for tools |
| Regression and capability evals | A grader is "logic that scores some aspect of the agent's performance"; regression evals "should have a nearly 100% pass rate" and run "on each agent change and model upgrade" ✅[^ant_evals] | Across runs and model releases |
| Tuning the evaluator | "read the evaluator's logs, find examples where its judgment diverged from mine", then update its prompt; with a new model, strip pieces "no longer load-bearing" ✅[^ant_harness2] | Across runs, for the harness |
| Notes and memory | Structured note-taking keeps notes "persisted to memory outside of the context window", for example "maintaining a NOTES.md file" ✅[^ant_ctx]. The memory tool (an API tool; your application stores the files) keeps files across conversations, written by Claude and run by the application ✅[^memtool]. In Claude Code, auto memory holds notes Claude writes from corrections and preferences, which the user can edit or delete; `CLAUDE.md` is written by the user ✅[^cc_memory] | Across sessions, for one agent |

*(Synthesis.)* None of the pages read describes a process that gathers lessons from many runs into changes of the harness itself. The closest are regression evals and transcript review; the loop in §7 and ACE in [context-engineering-deep-dive.md](context-engineering-deep-dive.md) fill that gap.

## 7. The improvement loop, step by step

The three cases share one cycle ✅[^hashimoto] ✅[^openai] ✅[^lc_improve]:

1. **Run** the agent on real work.
2. **Observe** a failure: a trace, a review comment, a broken build, a bug report.
3. **Ask what was missing** ✅[^openai]:
   - a fact → a guide (doc, map entry);
   - a capability → a tool or script ✅[^hashimoto];
   - a check → a sensor (test, lint, hook).
4. **Encode it in the repo**, preferably as a computational sensor. When documentation falls short, "promote the rule into code" ✅[^openai].
5. **Check the fix generalises:** rerun the eval or the benchmark. Guard against overfitting to one task ✅[^lc_improve].
6. **Garbage-collect** on a schedule: drift scans, stale-doc sweeps, quality grades ✅[^openai].

**Worked flow in the `conanjs/agent-config` repo**, where this knowledge base lived until it was split out on 2026-11-19 (the mechanism is documented in that repo's `scripts/claude-doc-hook.sh`):
1. An agent edits a knowledge doc and forgets an index row.
2. The `PostToolUse` hook in `.claude/settings.json` runs `scripts/check-docs.sh`.
3. That script runs the validators (`validate-knowledge.mjs`, `atlas.mjs` and others) and the Cucumber scenarios.
4. On failure the hook exits 2, and Claude Code sends its stderr back to the model as feedback ✅[^cc_hooks].
5. The model adds the row in the next step.

The guide (the schema doc) said the same thing earlier. The sensor made sure it happened.

---

## 8. Cross-component interactions

| Change | Effect on the agent | Knock-on effect elsewhere |
|---|---|---|
| Add a rule to `AGENTS.md` / `CLAUDE.md` | Steers every session | Costs context every session. Instruction files are context, not enforcement ✅[^cc_memory]; past a size they rot and crowd out the task ✅[^openai]. Claude Code advises under 200 lines ✅[^cc_memory] |
| Turn the rule into a lint or hook | Enforced every time ✅[^cc_hooks] | The failure message becomes context, so write it as a fix instruction ✅[^openai]. Removes the rule from the instruction file |
| Add more tools | More capability | More tokens per call and more tool confusion (context doc §3). Consolidate and namespace ✅[^ant_tools] |
| Add sub-agents (reviewer, tester) | Clean windows, parallel checks | More tokens; decisions may conflict (context doc §6). Anthropic leaves "one general agent or many?" open ✅[^ant_harness] |
| Lower the merge gates | Throughput | Safe only with strong sensors and cheap reverts; irresponsible at low throughput ✅[^openai] |
| Raise reasoning effort everywhere | Better steps | Time-outs and over 2× tokens; a split budget scored better ✅[^lc_improve] |
| Train a model in its harness (vendor side) | Model gets better at that harness's primitives | May overfit: it can struggle when a tool's logic changes, and the best harness for a task is not always the trained one ✅[^lc_anatomy] |
| Model gets stronger | Some harness parts become unnecessary ✅[^lc_anatomy] ✅[^lc_improve]; the evaluator is worth its cost only when the task "sits beyond what the current model does reliably solo" ✅[^ant_harness2] | Planning and self-verification may move into the model; environment and tools stay useful ✅[^lc_anatomy] |

---

## 9. Failure and edge-case matrix

| Symptom | Harness gap | Fix |
|---|---|---|
| "Done!" with features missing | No external definition of done | Feature list with pass flags, all failing at start ✅[^ant_harness]; pre-completion checklist ✅[^lc_improve] |
| Next session finds a broken build | No progress record, no start check | Progress file + git + smoke test at session start ✅[^ant_harness] |
| Tests pass but the app does not work | Only code-level sensors | End-to-end checks through a browser ✅[^ant_harness]; app legible to the agent ✅[^openai] |
| Agent edits the tests to pass | Tests not protected | Forbid editing tests ✅[^ant_harness]; ask for general solutions, not test-specific ones ✅[^ant_bp] |
| The agent grades its own work as good, and the work is not | Self-evaluation only: agents "reliably skew positive" on their own output ✅[^ant_harness2] | A separate evaluator tuned to be skeptical, with criteria agreed before the work starts (a "sprint contract"); tune its prompt from log reviews, since out of the box it talked itself into approving issues it had found ✅[^ant_harness2] |
| Same file edited ten times | No loop sensor | Loop detection middleware ✅[^lc_improve] |
| Architecture drifts | Rules only in prose | Layer rules as structural tests and custom lints ✅[^openai] ✅[^fowler] |
| Codebase fills with near-duplicates and "slop" | The agent copies existing patterns, good or bad ✅[^openai] | Golden principles, background clean-up agents ✅[^openai] |
| A rule in `CLAUDE.md` is ignored | Guide, not enforcement ✅[^cc_memory] | `PreToolUse` hook that blocks (exit 2) ✅[^cc_hooks] |
| Huge instruction file, worse results | Context crowding ✅[^openai] | Short map plus indexed docs, checked by CI ✅[^openai] |
| Harness tuned for one benchmark | Overfitting ✅[^lc_improve] | Evaluate on varied tasks; review the traces |
| Behaviour wrong though every check is green | Weak behavioural sensors ✅[^fowler] | Human acceptance criteria, real-user checks ✅[^openai] |
| The agent never reacts to a checker's violations, or tries to "fix" the checker's own crash | The checker's exit codes are passed straight through as the hook's. Linters such as ESLint exit 1 for rule violations and 2 for a configuration problem or internal error ✅[^eslint_exit]. Claude Code reads a hook's exit codes differently: 2 is a blocking error whose stderr a `PostToolUse` hook shows to Claude; any other non-zero code is a non-blocking error that shows the user a notice and lets the action go ahead ✅[^cc_hooks_ref] | Translate in the hook script: violations → exit 2, with a short message on stderr; checker failure → exit 1, so a person sees it and the model does not ✅[^cc_hooks_ref] |
| A `PostToolUse` checker prints its findings to stdout and exits 0, and the model never sees them | On exit 0, plain stdout reaches Claude only on events such as `UserPromptSubmit` and `SessionStart`, not on `PostToolUse` ✅[^cc_hooks_ref] | Exit 2 with the findings on stderr, or exit 0 with JSON `decision: "block"` and a `reason`. Keep the text short: a hook's plain stdout and its context strings are capped at 10,000 characters ✅[^cc_hooks_ref] |

---

## 10. Open questions (from the sources)

- How does architectural coherence evolve over *years* in a fully agent-written system? ✅[^openai]
- How do you keep a growing harness coherent, with guides and sensors in sync rather than contradicting each other? How do you measure a harness's coverage? ✅[^fowler]
- One general agent, or specialised testing and QA agents? ✅[^ant_harness] The 2026 follow-up adds a separate evaluator, but treats it as a cost decision for each task and model, not a fixed part ✅[^ant_harness2].
- Which harness parts will future models absorb? ✅[^lc_anatomy]

---

## 11. Verification

- **Verified on 2026-10-30:** every ✅ claim, against the sources in References. They were read live, the OpenAI post through a browser because automated fetch is refused there.
- **Verified on 2026-11-24:** every ✅[^ant_harness2] claim, against the Anthropic post read live.
- **Verified on 2026-11-23:** the two exit-code rows at the end of §9, against the Claude Code hooks reference and the ESLint command-line docs.
- **Synthesis, not a sourced claim:**
  - the five-discipline comparison and "views at different scopes" in §3;
  - "prefer a computational sensor" in §5;
  - the shared cycle in §7, which combines three sources.
- **Local and inspectable:** the hook flow in §7. The mechanism is in `conanjs/agent-config`'s `.claude/settings.json` and `scripts/claude-doc-hook.sh`, and the exit-2 behaviour is documented by Claude Code ✅[^cc_hooks].
- **Diagnostic guidance:** in §9 every fix is sourced; the pairing of symptom and harness gap is this doc's reading.
- **Not settled:** who coined "harness engineering".

## References

- [Anthropic: Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) — Anthropic (Erik S., Barry Zhang), 2024. Backs: §1 agent, ACI; §2; §3 workflows; §6.5 workflows and agents, start with the API (re-read 2026-11-26); §6.6. [^bea]
- [Anthropic: Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) — Justin Young, 2025. Backs: §2; §4; §6.1; §6.4; §8; §9; §10. [^ant_harness]
- [Anthropic: Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps) — Prithvi Rajasekaran, 2026-03-24, read 2026-11-24 and 2026-11-26. Backs: §2; §6.4; §8 stronger models; §9 self-evaluation; §10; §6.6. [^ant_harness2]
- [Mitchell Hashimoto: My AI Adoption Journey](https://mitchellh.com/writing/my-ai-adoption-journey) — 2026. Backs: §2 definition; §4, §5, §7. [^hashimoto]
- [OpenAI: Harness engineering: leveraging Codex in an agent-first world](https://openai.com/index/harness-engineering/) — Ryan Lopopolo, 2026. Backs: §2; §3 Ralph loop; §4; §5; §6.2; §7; §8; §9; §10. [^openai]
- [LangChain: Improving Deep Agents with harness engineering](https://www.langchain.com/blog/improving-deep-agents-with-harness-engineering) — Vivek Trivedy, 2026. Backs: §2; §4; §6.3; §7; §8; §9. [^lc_improve]
- [LangChain: The Anatomy of an Agent Harness](https://www.langchain.com/blog/the-anatomy-of-an-agent-harness) — Vivek Trivedy, 2026. Backs: §1; §2; §3; §4 component list; §8; §10. [^lc_anatomy]
- [Birgitta Böckeler: Harness engineering for coding agent users](https://martinfowler.com/articles/harness-engineering.html) — martinfowler.com, 2026. Backs: §1 guides, sensors, controls, user harness; §2; §3; §5; §9; §10. [^fowler]
- [Claude Code: Automate actions with hooks](https://code.claude.com/docs/en/hooks-guide) — Anthropic, living. Backs: §1 hook; §4; §7 exit 2 feedback; §8; §9. [^cc_hooks]
- [Claude Code: Hooks reference](https://code.claude.com/docs/en/hooks) — Anthropic, living; read 2026-10-30 and 2026-11-23. Backs: §4 SessionStart stdout and `additionalContext` reach the model, `systemMessage` is shown to the user; §9 exit-code meanings per event, stdout on exit 0, JSON `decision` and `reason`, the 10,000-character cap. [^cc_hooks_ref]
- [ESLint: command line interface, exit codes](https://eslint.org/docs/latest/use/command-line-interface#exit-codes) — OpenJS Foundation, living, read 2026-11-23. Backs: §9 exit 1 for violations, 2 for configuration or internal errors. [^eslint_exit]
- [Codex: hooks](https://learn.chatgpt.com/docs/hooks) — OpenAI, living; read 2026-10-31. Backs: §4 Codex `SessionStart` output, `~/.codex/hooks.json`, trust review. [^codex_hooks]
- [GitHub Copilot CLI: hooks reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-hooks-reference) — GitHub, living; read 2026-10-30. Backs: §4 `sessionStart` consumes only `additionalContext`; `~/.copilot/hooks/`. [^copilot_hooks]
- [Claude Code: How Claude remembers your project](https://code.claude.com/docs/en/memory) — Anthropic, living. Backs: §4 memory; §8 and §9 context vs. enforcement, 200 lines; §6.6. [^cc_memory]
- [AGENTS.md](https://agents.md/) — Agentic AI Foundation (Linux Foundation), living. Backs: §4 memory; nearest file in the tree wins. [^agentsmd]
- [Anthropic: Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) — Anthropic, 2025. Backs: §3; §4 context management; §6.6. [^ant_ctx]
- [Anthropic: Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents) — Ken Aizawa, 2025. Backs: §8 tools; §6.6. [^ant_tools]
- [OpenAI: Prompt engineering guide](https://developers.openai.com/api/docs/guides/prompt-engineering) — OpenAI, living. Backs: §3 prompt row. [^oai_prompt]
- [Anthropic: Prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices) — Anthropic, living. Backs: §9 test-specific solutions. [^ant_bp]
- [Orchestrate subagents at scale with dynamic workflows](https://code.claude.com/docs/en/workflows) — Anthropic, living, read 2026-11-26. Backs: §6.5 dynamic workflows. [^cc_wf]
- [Run Claude Code programmatically](https://code.claude.com/docs/en/headless) — Anthropic, living, read 2026-11-26. Backs: §6.5 headless mode. [^cc_headless]
- [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview) — Anthropic, living, read 2026-11-26. Backs: §6.5 SDK languages. [^cc_sdk]
- [Agent orchestration - OpenAI Agents SDK](https://openai.github.io/openai-agents-python/multi_agent/) — OpenAI, living, read 2026-11-26. Backs: §6.5 orchestrating via code and via the LLM. [^oai_orch]
- [Agent Orchestration | OpenAI Agents SDK](https://openai.github.io/openai-agents-js/guides/multi-agent/) (JavaScript) — OpenAI, living, read 2026-11-26. Backs: §6.5 determinism. [^oai_orch_js]
- [A practical guide to building agents](https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf) — OpenAI, undated PDF, read 2026-11-26. Backs: §6.5 single agent first, manager and decentralized patterns. [^oai_guide]
- [Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode) — OpenAI, living, read 2026-11-26. Backs: §6.5 `codex exec` in pipelines. [^codex_exec]
- [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk) — OpenAI, living, read 2026-11-26. Backs: §6.5 Codex SDK. [^codex_sdk]
- [Template agent workflows - Agent Development Kit (ADK)](https://adk.dev/agents/workflow-agents/) — Google, living, read 2026-11-26. Backs: §6.5 workflow agents and their replacement. [^adk_wf]
- [Developer's guide to multi-agent patterns in ADK](https://developers.googleblog.com/developers-guide-to-multi-agent-patterns-in-adk/) — Google, 2025-12-16, read 2026-11-26. Backs: §6.5 sequential and coordinator patterns. [^adk_patterns]
- [Headless mode reference | Gemini CLI](https://geminicli.com/docs/cli/headless/) — Google, last updated 2026-03-10, read 2026-11-26. Backs: §6.5 programmatic interface, and the banner that Antigravity CLI replaced Gemini CLI on 2026-06-18. [^gemini_headless]
- [Automate tasks with headless mode | Gemini CLI](https://geminicli.com/docs/cli/tutorials/automation/) — Google, last updated 2026-03-09, read 2026-11-26. Backs: §6.5 runs once and exits. [^gemini_auto]
- [How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) — Anthropic, 2025-06-13, read 2026-11-26. Backs: §6.5 the lead agent is a model. [^ant_multi]
- [Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) — Anthropic, 2026-01-09, read 2026-11-26. Backs: §6.6 graders, regression and capability evals. [^ant_evals]
- [Memory tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool) — Anthropic, living, read 2026-11-26. Backs: §6.6 the memory tool stores files across conversations, client-side. [^memtool]
- [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices) — Anthropic, living, read 2026-11-26. Backs: §6.4 spec interview and `SPEC.md`. [^cc_best]
- `.claude/settings.json`, `scripts/claude-doc-hook.sh`, `scripts/check-docs.sh` — in `conanjs/agent-config`: its computational sensor: validators and scenarios after every doc edit, exit 2 on failure.
- `copilot/atlas/`, `copilot/frameworks/knowledge/tools/validate-knowledge.mjs` — in `conanjs/agent-config` before the split: its map and doc checks (guide and sensor).
- `copilot/tracker/`, `specs/015-tracker/` — in `conanjs/agent-config`: its tracker: an instruction (guide) plus session-start hooks (sensor), tested as described in §4.

## Related

- [Prompt engineering deep dive](prompt-engineering-deep-dive.md) — the instruction layer.
- [Context engineering deep dive](context-engineering-deep-dive.md) — what the harness puts in the window.
- [Loop Engineering](loop-engineering.md) and [Loop Engineering playbook](loop-engineering-playbook.md) — the cycle the harness runs; hook and policy templates.
- [Graph Engineering study guide](graph-engineering-study-guide.md) — explicit routing between harness steps.
- [Claude Code subagents and skills](claude-code-agents-and-skills.md) — where agents and skills load in one builder harness.
