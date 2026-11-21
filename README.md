# agent-knowledge

V's knowledge base for coding agents (Claude Code, GitHub Copilot, Codex): source-traced docs on tools, runtimes and design, plus the framework that defines how the docs are written.

| Folder | What | When to use |
|---|---|---|
| `knowledge/` | The docs, one folder per topic; start at `knowledge/index.md` | Looking something up: how a tool, runtime or design technique works and why |
| `frameworks/knowledge/` | How docs are written: `index.md` (the framework), `research.md` (researching a topic with checkable claims), `schemas/` (the shape of each doc type and of a research run), `tools/` (the validator, the research-run scripts, their scenarios) and `agents/` (the two research agents) | Writing, updating, researching or reviewing a doc |
| `research/` | One folder per researched doc, `research/<topic>/<slug>/`, mirroring `knowledge/`: its plan, sources, claims with quotes, experiments and the verifier's verdicts. Kept in git as the doc's evidence (cached page text is gitignored) | Checking why a researched doc says what it says, or refreshing it |

## README and AGENTS.md

- **README.md** (this file) is for people, and for an agent asked to set this repo up. No agent loads it by itself.
- **AGENTS.md** is the rules for an agent working inside this repo. Codex and Copilot load it at session start; Claude Code loads it through `CLAUDE.md` (`@AGENTS.md`). It is not loaded when the session runs in another folder.

## Checks

| Command | What it does |
|---|---|
| `pnpm run validate-docs` | Checks every doc and index under `knowledge/` against the schemas (legacy docs skipped) |
| `pnpm run validate-docs-urls` | The same, and also requests every URL the docs cite |
| `pnpm run research -- <command> <run>` | The research-run scripts: `init`, `merge`, `quotes`, `replay`, `pairs`, `validate` (`frameworks/knowledge/research.md`) |
| `pnpm run test-tools` | Runs the scenarios of the tools under `frameworks/knowledge/tools/` |
| `pnpm run verify-before-commit` | `validate-docs`, then `test-tools`; CI runs this |

Run `pnpm install` once first (pnpm version: `packageManager` in `package.json`). The validator also runs on its own: `node frameworks/knowledge/tools/validate-knowledge/validate-knowledge.mjs [knowledge-root] [--urls]`.

## Use it from your coding agent

1. Clone it anywhere, for example: `git clone https://github.com/conanjs/agent-knowledge.git ~/workspace/agent-knowledge`. Below, `<clone>` is that folder.
2. Add one line to the instructions your coding agent loads for every session, pointing at the clone, for example:
   > Knowledge base: look things up from `<clone>/knowledge/index.md`; to write or update a doc there, follow `<clone>/frameworks/knowledge/index.md`.
3. Install the plugin (below) for the `review-knowledge-doc` and `research-knowledge` skills.
4. For research, the two agents in `frameworks/knowledge/agents/` must be built for your coding agents. agent-config does it: its installer adds this folder to its agent build (`agent-sources` in its `installer/mapping.yaml`). Each folder is `body.md` plus one header per coding agent (`claude.yaml`, `codex.toml`, `copilot.yaml`).

## Skills (plugin)

`plugin/` is a plugin for Claude Code, Codex and GitHub Copilot CLI with the skills for working on this knowledge base: `review-knowledge-doc` and `research-knowledge`. `.claude-plugin/marketplace.json` (Claude Code, Copilot CLI) and `.agents/plugins/marketplace.json` (Codex) make the clone a local marketplace; how the install works: `knowledge/ai-agents/plugin-marketplace-install-flow.md`. Install from the clone:

```bash
claude plugin marketplace add <clone> && claude plugin install agent-knowledge@agent-knowledge
copilot plugin marketplace add <clone> && copilot plugin install agent-knowledge@agent-knowledge
codex plugin marketplace add <clone> && codex plugin add agent-knowledge@agent-knowledge
```

Claude Code and Copilot CLI read the plugin from the clone, so an edit shows in the next session. Codex copies it: run `codex plugin add agent-knowledge@agent-knowledge` again after an edit.
