---
schema: knowledge-doc/v1
type: reference
topic: ai-agents
status: verified
applies-to: ["Claude Code 2.1.129 (CLI), and the docs read 2026-10-29", "plugin-agent session and plugin hook rows: Claude Code 2.1.330, 2026-11-25", "skills rows: Claude Code 2.1.332, 2026-11-25"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [claude-code, subagents, skills, install, synced]
---

# Claude Code subagents and skills: where they load and how to call them

## Summary
**TL;DR:** User-level agents load from `~/.claude/agents/` and project agents from `.claude/agents/`. Call one by asking for it by name, by `@`-mentioning it, or by running a whole session as it with `claude --agent <name>`. `~/.claude/skills/` can also hold a `synced/` folder with the skills enabled on claude.ai; replacing `~/.claude/skills` with a link moves that folder, and the next session did not download it again.
**Use this when:** installing agents or skills into a home folder, or calling an agent in Claude Code.
**Not this doc:** how agent-config's installer works → `README.md` "Install strategies".

## Scope
Claude Code's user and project agent folders, the four ways to call an agent, and the `~/.claude/skills/synced/` folder, as documented on 2026-10-29 and as tested on this machine with Claude Code 2.1.129.

## Catalog

| Item | Behaviour | Status |
|---|---|---|
| User agents | `~/.claude/agents/`, available in all projects; project agents in `.claude/agents/` | ✅ [^1] |
| Ask by name | "Use the sdlc-coordinator agent to …"; Claude delegates | ✅ [^1] |
| `@`-mention | Pick it after typing `@`, or type `@agent-<name>`; that agent runs, not Claude's choice | ✅ [^1] |
| `@` in the Claude desktop app (Code tab) | The picker offered only files for `@agent-sdlc-coor`, though the agent was loaded (listed as a subagent the session could launch): observed 2026-10-29. Ask for the agent by name there, or use the terminal CLI | ✅ |
| A session as the agent | `claude --agent <name>`, or the `agent` setting; the flag wins | ✅ [^1] |
| A plugin's agent as the session | `claude -p --plugin-dir <plugin> --agent <plugin-name>:<agent-name>` worked. The session had only the agent's tools: an agent with `tools: Read`, told to use Glob, answered "NO-GLOB" and made no tool call, while a default session in the same folder used Glob. Its first request was 6,957 tokens, against about 40,400 for a default session on the same machine. `omitClaudeMd: true` is ignored in this mode, so the user's `CLAUDE.md` still loads (it does not load for the same agent run as a subagent). Asked to list its own tools, an agent may name tools it does not have: test by calling one. Details: [harness-lab/lab-notebook.md](harness-lab/lab-notebook.md) E6–E8. When it finished, the `Stop` hook fired, not `SubagentStop`, and the hook input carried `agent_type: "<plugin-name>:<agent-name>"`. Tested 2026-11-25 with 2.1.330 and a debug hook given through `--settings` | ✅ |
| Hooks a plugin brings | A plugin's `hooks/hooks.json` is active "When plugin is enabled", which includes a session started with `--plugin-dir`. Hooks from settings and plugins "also run inside subagents", for the main session and every subagent alike; the frontmatter `hooks` of a plugin's own agents are ignored. A script that must act on one agent only reads `agent_type` from its input | ✅ [^3] |
| New agent files | Picked up within seconds, no restart; except the first file in an `agents` folder that did not exist when the session started | ✅ [^1] |
| `skills:` in an agent | Preloads those skills' full text into the agent; other skills stay callable. **Only when the agent runs as a subagent.** The docs word it as "to preload into the subagent's context at startup", and say nothing about `skills` for an agent run as the whole session. Measured 2026-11-25 on 2.1.332: the same plugin agent with `skills: [kit]`, told to use no tool, answered the skill's codeword as a subagent and "NO-SKILL" as the session (`--agent`). Why the mode matters is not documented | ✅ [^1][^4][^5] |
| Skill listing and the `Skill` tool | Before any skill runs, Claude Code puts a listing of skill names and descriptions in the context, budgeted at about 1 % of the context window, with each description cut at 1,536 characters. An agent whose `tools` leave out `Skill` got no listing (`/context` shows no Skills row), so its start was smaller. Adding `Skill` to such an agent brought the listing back: with the default settings sources, the first request went from 3,803 to 10,548 tokens, and `/context` showed a 6k Skills row (lab notebook, E19). The size depends on how many skills the session can see. A path to a reference file written in the agent's prompt costs only the path; the file's text enters the context once, when the agent reads it | ✅ [^4][^5] |
| `~/.claude/skills/synced/` | The skills enabled on claude.ai, downloaded per account (`synced/<account>/<skill>/`); the `syncClaudeAiSkills` setting turns the download off | ✅ [^2] |
| Moving `synced/` away | Not downloaded again by the next session: tested 2026-10-29 by replacing `~/.claude/skills` with a link (the folder went to a backup) and running `claude -p` with 2.1.129; no `synced/` appeared within a minute | ✅ |

## Lookup notes
- **Current-doc clarification (2026-11-07):** the failed re-download observation in the Catalog belongs to 2.1.129, not all future releases. Current [skills documentation](https://code.claude.com/docs/en/skills#where-synced-skills-load) describes terminal background sync from v2.1.273 (the [changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md) lists the feature under 2.1.275, so treat 2.1.275 as the safe minimum), conditional on authentication and feature flags; short non-interactive runs can finish before download. This is source-checked behavior, not a rerun of the historical experiment. For current cross-host execution semantics, see [subagent execution boundaries](subagent-execution-boundaries.md).
- An installer that links the whole `~/.claude/skills` folder to a repo moves `synced/` into its backup. agent-config's installer does this on purpose (V, 2026-10-29: the synced skills are minor and come back once used); the per-skill alternative was built, tested and withdrawn (`specs/011`). To keep a copy, take it from the install run's backup folder.
- To call the agent-config coordinator: in the terminal CLI, `@agent-sdlc-coordinator where is …` or `claude --agent sdlc-coordinator` for a whole session; in the desktop app, "Use the sdlc-coordinator agent: where is …".

## Takeaways
- Linking the whole `~/.claude/skills` folder moves the claude.ai `synced/` skills aside; link each skill instead when they must stay.
- Use `@agent-<name>` when a specific agent must answer; plain requests let Claude choose.

## Verification status
- Verified: 12 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [Extend Claude with skills](https://code.claude.com/docs/en/skills) — Anthropic, living, read 2026-11-07. Backs: current-doc clarification of sync scope; earlier local tests remain dated.
- [Create custom subagents](https://code.claude.com/docs/en/sub-agents) — Anthropic, living. Backs: Catalog rows 1–6. [^1]
- Claude Code settings schema, `syncClaudeAiSkills`: "previously synced skills (~/.claude/skills/synced) can no longer be run" when off — read from the settings JSON schema bundled with Claude Code, 2026-10-29. Backs: Catalog row 7. [^2]
- [Hooks reference](https://code.claude.com/docs/en/hooks) — Anthropic, living, read 2026-11-25. Backs: Catalog row "Hooks a plugin brings" (hook scope table, hooks inside subagents); the plugin-agent frontmatter restriction is in [Create custom subagents](https://code.claude.com/docs/en/sub-agents). [^3]
- [Extend Claude with skills](https://code.claude.com/docs/en/skills) and [Create custom subagents](https://code.claude.com/docs/en/sub-agents) — Anthropic, living, read 2026-11-25. Backs: skill listing and its budget; the `skills` field's subagent wording. [^4]
- [Harness lab notebook](harness-lab/lab-notebook.md) — local experiments, Claude Code 2.1.332, 2026-11-25: entries E8 and E19. Backs: `skills:` as session versus subagent; the listing's dependence on the `Skill` tool and its size. [^5]
- `specs/011-installer-link-each/research.md` in agent-config — the test of moving `synced/`, and why `link-each` was added.

## Related
- `ai-agents/graph-engineering-study-guide.md`
