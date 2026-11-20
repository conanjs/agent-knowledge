# agent-knowledge

V's knowledge base for coding agents (Claude Code, GitHub Copilot, Codex): source-traced docs on tools, runtimes and design, plus the framework that defines how the docs are written.

Split out of [conanjs/agent-config](https://github.com/conanjs/agent-config) on 2026-11-18 with full history (paths rewritten from `copilot/…`).

| Folder | What | Installed at |
|---|---|---|
| `knowledge/` | The docs; start at `knowledge/index.md` | `~/.agent-config/knowledge` |
| `frameworks/knowledge/` | Rules and schemas for knowledge docs, and the validator | `~/.agent-config/frameworks/knowledge` |

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

The agent home is `~/.agent-config` (`%USERPROFILE%\.agent-config` on Windows): the folder every coding agent reads, whose core instructions point at `~/.agent-config/knowledge/index.md` and `~/.agent-config/frameworks/knowledge/index.md`. agent-config does not install this repo: ask an agent to follow these steps.

1. Clone it anywhere, for example: `git clone https://github.com/conanjs/agent-knowledge.git ~/workspace/agent-knowledge`. Below, `<clone>` is that folder.
2. Link it into the agent home (macOS, Linux):
   ```bash
   ln -sfn <clone>/knowledge ~/.agent-config/knowledge
   mkdir -p ~/.agent-config/frameworks && ln -sfn <clone>/frameworks/knowledge ~/.agent-config/frameworks/knowledge
   ```
   Windows (PowerShell): `New-Item -ItemType Junction -Path $HOME\.agent-config\knowledge -Target <clone>\knowledge`, and the same for `frameworks\knowledge`.
3. Install the plugin: the commands in "Skills (plugin)" above, with `<clone>` in place of `~/workspace/agent-knowledge`.
4. Core line: the core instructions already point at the two paths in step 2; nothing to add.
