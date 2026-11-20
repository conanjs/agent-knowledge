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

## Skills (plugin)

`plugin/` is a plugin for Claude Code, Codex and GitHub Copilot CLI with the skills for working on this knowledge base (today `review-knowledge-doc`). `.claude-plugin/marketplace.json` (Claude Code, Copilot CLI) and `.agents/plugins/marketplace.json` (Codex) make this clone a local marketplace; how the install works: `knowledge/ai-agents/plugin-marketplace-install-flow.md`. Install from the clone:

```bash
claude plugin marketplace add ~/workspace/agent-knowledge && claude plugin install agent-knowledge@agent-knowledge
copilot plugin marketplace add ~/workspace/agent-knowledge && copilot plugin install agent-knowledge@agent-knowledge
codex plugin marketplace add ~/workspace/agent-knowledge && codex plugin add agent-knowledge@agent-knowledge
```

Claude Code and Copilot CLI read the plugin from the clone, so an edit shows in the next session. Codex copies it: run `codex plugin add agent-knowledge@agent-knowledge` again after an edit.

## Integrate into the agent home

The agent home is `~/.copilot` (`%USERPROFILE%\.copilot` on Windows); the core instructions read the knowledge base there. agent-config does not install this repo: ask an agent to follow these steps.

1. Clone: `git clone https://github.com/conanjs/agent-knowledge.git ~/workspace/agent-knowledge`
2. Link it into the agent home (macOS, Linux):
   ```bash
   ln -sfn ~/workspace/agent-knowledge/knowledge ~/.copilot/knowledge
   mkdir -p ~/.copilot/frameworks && ln -sfn ~/workspace/agent-knowledge/frameworks/knowledge ~/.copilot/frameworks/knowledge
   ```
   Windows (PowerShell): `New-Item -ItemType Junction -Path $HOME\.copilot\knowledge -Target <clone>\knowledge`, and the same for `frameworks\knowledge`.
3. Install the plugin: the commands in "Skills (plugin)" above.
4. Core line: the core instructions already point at `~/.copilot/knowledge/index.md` and `~/.copilot/frameworks/knowledge/index.md`; nothing to add.
