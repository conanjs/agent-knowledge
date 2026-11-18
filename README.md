# agent-knowledge

V's knowledge base for coding agents (Claude Code, GitHub Copilot, Codex): source-traced docs on tools, runtimes and design, plus the framework that defines how the docs are written.

Split out of [conanjs/agent-config](https://github.com/conanjs/agent-config) on 2026-11-18 with full history (paths rewritten from `copilot/…`).

| Folder | What | Installed at |
|---|---|---|
| `knowledge/` | The docs; start at `knowledge/index.md` | `~/.copilot/knowledge` |
| `frameworks/knowledge/` | Rules and schemas for knowledge docs, and the validator | `~/.copilot/frameworks/knowledge` |

## Check

```bash
node frameworks/knowledge/tools/validate-knowledge.mjs
```

Defaults to `knowledge/` next to the framework; pass another root as the first argument.
