---
schema: knowledge-doc/v1
type: reference
topic: ai-agents
status: verified
applies-to: ["Official documentation read 2026-11-07 (Claude Code, Codex) and 2026-11-11 (Claude Code limits, Copilot CLI, VS Code); Claude Code rows re-read and Gemini CLI added 2026-11-24; `skills:` session-mode note measured on Claude Code 2.1.332, 2026-11-25; host-specific behavior"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [skills, subagents, context, portability, prompt-caching]
---

# Subagents: task, context and permission boundaries

## Summary
**TL;DR:** A subagent is a delegated worker with its own task context. Specify its inputs and output explicitly; a separate conversation does not by itself provide a separate filesystem or permission boundary.
**Use this when:** deciding whether a skill should delegate, porting an agent definition, or investigating missing context in a child run.

## Scope
Current documented Claude Code and ChatGPT/Codex behavior, checked 2026-11-07; Claude Code limits and GitHub Copilot (CLI and VS Code) added 2026-11-11; Gemini CLI added 2026-11-24. Think of a skill as a recipe and a subagent as the cook assigned to execute a job. The job ticket must say which ingredients and result are required. Model Context Protocol (MCP) supplies connections to external tools. YAML and TOML are text configuration formats; the examples below are the concrete artifacts.

## Catalog

| Claude Code control | Meaning | Evidence |
|---|---|---|
| Skill `context: fork` | Skill body becomes child task; conversation history is absent; different from forking the conversation | ✅[^skill] |
| Forked skill background | Defaults to background; `background: false` waits; non-interactive execution also waits | ✅[^skill] |
| `agent: Explore` | Forked skill uses Explore's startup context; Explore/Plan omit `CLAUDE.md` | ✅[^skill] |
| Custom definition | `.claude/agents/*.md` or `~/.claude/agents/*.md`; YAML configuration and Markdown system prompt | ✅[^agent] |
| `skills:` | Injects named skills' full bodies at startup; unlisted skills can remain callable. Only in subagent mode: when the same agent definition runs as the whole session (`claude --agent`), the listed skills were not loaded (measured 2026-11-25, Claude Code 2.1.332) | ✅[^agent][^lab_2611] |
| Tools | `tools` selects; `disallowedTools` removes; omitted `tools` inherits tools available to subagents | ✅[^agent] |
| Repository isolation | `isolation: worktree` requests a separate checkout, branched by default from the default branch rather than the parent session's `HEAD`, and cleaned up when the subagent changes nothing; context isolation alone does not | ✅[^agent] ✅[^agent_2611] |
| Description budget | Every subagent's description is in the parent's context; above 15,000 tokens combined (built-ins excluded) Claude Code warns at startup and still loads them all | ✅[^agent] |
| What loads at startup | The whole `CLAUDE.md` hierarchy the main conversation loads (not for Explore and Plan, or with `omitClaudeMd`); not the main conversation's auto memory, which the agent's own `memory` field replaces | ✅[^agent] |
| Inline `mcpServers` | An inline server definition connects when the subagent starts and disconnects when it ends; the parent never gets its tools. A name reference shares the parent's connection. Ignored for plugin subagents | ✅[^agent] |
| Nesting depth | Subagents may spawn subagents up to three layers below the main conversation; at the limit the `Agent` tool is withheld | ✅[^agent] |
| Turn limit | `maxTurns`: at the limit the output returns marked as partial and the subagent can be resumed (partial marking from v2.1.246) | ✅[^agent_2611] |
| `Stop` in frontmatter hooks | Converted to `SubagentStop` at runtime. Frontmatter hooks of a project subagent run only after the workspace trust dialog is accepted for its folder | ✅[^agent_2611] |
| `SubagentStop` input and control | Receives `stop_hook_active`, `agent_id`, `agent_type`, `agent_transcript_path`, `last_assistant_message`; `decision: "block"` with a `reason`, or exit 2 with stderr, keeps the subagent working | ✅[^hooks_2611] |
| Who holds the plan | Subagents and skills: Claude, turn by turn, results in its context. Agent teams (experimental, off by default): a lead agent with a shared task list, no worktree isolation. Dynamic workflows: a script the runtime executes, resumable, dozens to hundreds of agents | ✅[^parallel_2611] |

| OpenAI surface or control | Meaning | Evidence |
|---|---|---|
| Local Codex delegation | Direct request or applicable project/skill instructions | ✅[^openai] |
| ChatGPT Work | Hosted execution; most intelligence levels require explicit delegation; Ultra can delegate proactively | ✅[^openai] |
| Custom Codex definition | `.codex/agents/*.toml` or `~/.codex/agents/*.toml`; requires `name`, `description`, `developer_instructions` | ✅[^openai] |
| Inheritance | Parent permissions, provider, MCP servers and skills; custom files cannot replace inherited permission/provider/server settings | ✅[^openai] |
| Model settings | Custom file wins; otherwise explicit spawn, configured defaults, then parent. Selecting another model without effort can select that model's default effort | ✅[^openai] |
| Capability reduction | Supported feature switches and `skills.config` can disable capabilities; “read-only” prose creates no separate sandbox | ✅[^openai] |
| Concurrency | `[agents].max_concurrent_threads_per_session`; no fixed universal default promised | ✅[^openai] |

| GitHub Copilot CLI control | Meaning | Evidence |
|---|---|---|
| Custom definition | Markdown agent files in `~/.copilot/agents/` (highest priority), `.github/agents/` and `.claude/agents/` from the working folder up to the Git root, added roots, plugins, then organization agents | ✅[^copilot] |
| Context | A subagent runs in its own context window | ✅[^copilotcli] |
| Repository instructions | A custom agent spawned as a subagent gets `copilot-instructions.md`, `AGENTS.md` and `CLAUDE.md` only with `include-custom-instructions: true`; the `general-purpose` subagent gets them; built-in `explore`, `task` and `code-review` do not | ✅[^copilot] |
| Automatic delegation | `infer: false` stops the main agent from delegating to it (default true) | ✅[^copilot] |
| Model | `model`, `models` (first one the plan allows), `modelPolicy` (`preferred` can be overridden, `required` cannot); an explicit `--model` loses to `modelPolicy: required` | ✅[^copilot] |
| Tools and servers | `tools` (default all); agent-scoped `mcp-servers` | ✅[^copilot] |
| Memory | Only the root agent stores or votes on memories; subagents may read them | ✅[^copilot] |

| VS Code Copilot control | Meaning | Evidence |
|---|---|---|
| Locations | `.github/agents`, `.claude/agents`, `~/.copilot/agents`, `~/.claude/agents` | ✅[^vscode] |
| Visibility | `user-invocable: false` hides it from the picker; `disable-model-invocation: true` stops other agents from calling it; `infer` is deprecated | ✅[^vscode] |
| Copilot-harness fields | `skills` (preload), `include-custom-instructions`, `deferred-tool-loading`, `mcp-servers`, `model-policy`; handoffs work only in the Local harness | ✅[^vscode] |

| Gemini CLI control | Meaning | Evidence |
|---|---|---|
| What a subagent is | A specialist with its own system prompt, tools and context loop; the main agent calls it as a tool of the same name | ✅[^gemini_sub] |
| Custom definition | Markdown files with YAML front-matter: project `.gemini/agents/*.md`, user `~/.gemini/agents/*.md` | ✅[^gemini_sub] |
| Hooks | Events include `BeforeTool`, `BeforeAgent` and `SessionStart`; a hook blocks by printing JSON such as `{"decision": "deny", "reason": "…"}` with exit 0, or by its exit code; logs go to stderr, only the final JSON to stdout | ✅[^gemini_hooks] |

## Lookup notes
**Configuration example, not an installed agent:** TOML is a text format for settings. This minimal Codex file deliberately leaves model selection to the session:

```toml
# .codex/agents/evidence-reader.toml
name = "evidence-reader"
description = "Check claims against a supplied source list."
developer_instructions = """
Read the specified draft and sources. Return claim, URL, support/conflict,
and proposed correction. Report missing inputs. Do not edit files.
"""
```

**Design recommendation:** “Do not edit” describes behavior; enforce access restrictions through the host when required. A Git worktree is a separate working checkout, like a second desk for the same project, not a promise that all external tools are restricted.

A delegation ticket that can stand alone:

```text
Task: verify the 12 claims in work/draft.md against work/sources.md.
Ownership: read those files; do not modify any repository file.
Output: claim number, evidence URL, verdict, exact proposed correction.
Missing input: report it instead of inferring prior chat decisions.
Completion: cover all 12 claims and distinguish inaccessible sources.
```

**Proposed failure checks:**

| Situation | What to inspect | Design response |
|---|---|---|
| Child asks what “the earlier decision” means | Actual launch prompt and context mode | Pass the decision as an explicit input |
| Two writers touch one file | Ownership assignments and checkout paths | Separate ownership or serialize changes |
| Child finishes, parent omits findings | Result collection and coverage against assigned jobs | Require one returned status per job |
| Background skill lacks a needed tool | Host's background tool restrictions | Re-check current foreground/background documentation |
| A skill preloads several large guides | Actual injected bodies | Preload only essential material; reference the rest |

Review observation: Anthropic's changelog records a fix for workflow agents receiving forked-skill results in v2.1.295. This supports treating delivery behavior as version-sensitive, not testing only whether a child starts. ✅[^changes]

## Takeaways
- Put task-specific facts in the delegation ticket.
- Keep skill loading, worker creation, result collection and access control as distinct checks.
- Do not translate Claude YAML fields directly into Codex TOML.
- A Copilot custom agent used as a subagent does not see repository instructions unless it sets `include-custom-instructions: true`.

## Used by
- _Not cited by any rule yet._

## Verification status
- Verified: 37 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

Source verification, except one measured row: current official pages were read, and illustrative configurations were not executed in a product session. The `skills:` row's session-versus-subagent note was measured with Claude Code 2.1.332 (lab notebook, E19). Recommendations and worked scenarios are this document's synthesis, not measured product guarantees.

## References
- [Run skills in a subagent](https://code.claude.com/docs/en/skills#run-skills-in-a-subagent) — Anthropic, living. Backs: forked-skill semantics. [^skill]
- [Create custom subagents](https://code.claude.com/docs/en/sub-agents) — Anthropic, living, re-read 2026-11-11. Backs: Claude definitions, preloading, tools, worktrees, description budget, startup context, inline `mcpServers`, nesting depth. [^agent]
- [Create custom subagents](https://code.claude.com/docs/en/sub-agents.md) — Anthropic, living, re-read 2026-11-24. Backs: worktree base branch and clean-up, `maxTurns`, frontmatter `Stop` → `SubagentStop`, trust dialog. [^agent_2611]
- [Hooks reference: SubagentStop](https://code.claude.com/docs/en/hooks) — Anthropic, living, read 2026-11-24. Backs: `SubagentStop` input fields and `decision: "block"`. [^hooks_2611]
- [Run agents in parallel](https://code.claude.com/docs/en/agents.md) and [Dynamic workflows](https://code.claude.com/docs/en/workflows.md) — Anthropic, living, read 2026-11-24. Backs: who holds the plan per approach; agent teams experimental and without worktree isolation. [^parallel_2611]
- [Gemini CLI: subagents](https://github.com/google-gemini/gemini-cli/blob/main/docs/core/subagents.md) — Google, living, read 2026-11-24. Backs: Gemini subagent model and custom definitions. [^gemini_sub]
- [Gemini CLI: writing hooks](https://github.com/google-gemini/gemini-cli/blob/main/docs/hooks/writing-hooks.md) — Google, living, read 2026-11-24. Backs: Gemini hook events and blocking. [^gemini_hooks]
- [GitHub Copilot CLI command reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference) — GitHub, living, read 2026-11-11. Backs: Copilot CLI agent locations, fields, instructions for subagents, memory. [^copilot]
- [Creating and using custom agents for GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-custom-agents-for-cli) — GitHub, living, read 2026-11-11. Backs: own context window. [^copilotcli]
- [Custom agent file reference](https://code.visualstudio.com/docs/agents/reference/custom-agent-file-reference) — Microsoft, living, read 2026-11-11. Backs: VS Code locations and fields. [^vscode]
- [Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents) — OpenAI, living. Backs: surfaces, definitions and inheritance. [^openai]
- [Harness lab notebook](harness-lab/lab-notebook.md) — local experiments, 2026-11-25, entry E19. Backs: `skills:` loaded only in subagent mode. [^lab_2611]
- [Claude Code changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md) — Anthropic, living; v2.1.295 entry read 2026-11-07. Backs: workflow result-delivery fix. [^changes]
- `copilot/knowledge/ai-agents/claude-code-agents-and-skills.md` — older version-scoped local observations.
- `copilot/procedures/review-docs.procedure.md` — source and meaning review used for this document.

## Related
- [Skill portability](agent-skills-portability.md).
- [Skills, delegation and cache economics](skills-delegation-cache-economics.md).
- [Codex usage reference](codex-usage-reference.md).
- [What each coding agent loads at session start](session-start-context-by-agent.md).
