---
schema: topic-index/v1
kind: subtopic
topic: ai-agents/harness-lab
last-updated: 2026-11-26
---

# Harness lab

Experiments run while building a coding-agent harness on Claude Code: what was asked, the exact setup and command, the measured result and the conclusion. Each experiment is one dated entry, and the notebook grows with every trial. Not covered: the general evidence and principles the experiments test (see `ai-agents/efficient-coding-agents-deep-dive.md`) or how-to guides for Claude Code itself.

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [lab-notebook.md](lab-notebook.md) | deep-dive | Thirty-three experiments: hook tests, reviewer calibration, one agent against a model-orchestrated harness, plugin agents as the whole session, when `CLAUDE.md` loads, what the start-up block holds, the guard in `--agent` mode, a script-orchestrated three-arm trial, why the real start-up block is larger than `/context` says, when a project `CLAUDE.md` loads, dropping the user's settings layer and which memory files and imports each settings source loads (`CLAUDE.local.md` included), the Artifact tool's cost, `skills:` as session versus subagent, the upward walk with the default settings sources, a skill typed as `/name` without the `Skill` tool, an orchestrator agent that reads Spec Kit's steps by path, one story card through test-author, red check, implementer and gate, a plugin declared in project settings under `-p`, one feature across two repositories run by the script, the same feature run by the orchestrator agent from a plain request, one card as a Claude Code dynamic workflow, planning and building in two fresh sessions, path-scoped rules for a headless worker, the build phase as one script, whether path-scoped pattern rules change the code workers write, and auto memory in a worker without the user layer; the four ways to orchestrate, compared | verified |

## References
- `frameworks/knowledge/schemas/topic-index.schema.md` — defines the topic index shape.
- [Create custom subagents](https://code.claude.com/docs/en/sub-agents) — Anthropic, living. Backs: topic scope.

## Related
- [ai-agents index](../index.md)
