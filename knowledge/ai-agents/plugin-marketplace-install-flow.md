---
schema: knowledge-doc/v1
type: concept
topic: ai-agents
status: verified
applies-to: ["Claude Code 2.1.319", "Codex CLI 0.166.0-alpha.6", "GitHub Copilot CLI 1.0.109", "Agent Plugins 1.0.0", "docs read 2026-11-19 and 2026-11-20"]
last-verified: 2026-11-20
last-updated: 2026-11-20
tags: [plugins, marketplace, skills, distribution, claude-code, codex, copilot-cli]
---

# How a plugin gets from a marketplace to a loaded skill

## Summary
**TL;DR:** A marketplace file is a catalog that lists plugins and where each one lives; a plugin is a folder with a manifest and component folders such as `skills/`. Adding a marketplace only registers the catalog; installing a plugin resolves its `source` from the marketplace root, reads the manifest at fixed paths, and finds each skill at `skills/<name>/SKILL.md` one level deep. Claude Code and Copilot CLI load a plugin from a local marketplace folder in place; Codex always loads a copy from its cache.
**Use this when:** packaging skills in a repo for Claude Code, Codex and Copilot CLI; debugging why a plugin skill is missing or stale; deciding where the marketplace and manifest files go.
**Not this doc:** what a plugin costs per session and how to turn it off → [agent-plugins-and-mcp-loading.md](agent-plugins-and-mcp-loading.md); the portable `SKILL.md` format and host fields → [agent-skills-portability.md](agent-skills-portability.md).

## Problem
`marketplace add` succeeds but no skill appears, a skill edit shows in one agent and not another, or one repo needs two marketplace files: each comes from not knowing which file each step reads, where a relative `source` is resolved from, and whether the agent loads the folder or a copy.

## Mental model
**Analogy:** a shop's menu and the labelled boxes in its stockroom. The menu (`marketplace.json`) says which boxes exist and on which shelf; each box has a label (`plugin.json`) and fixed compartments (`skills/`, `agents/`). Pinning the menu to the wall (`marketplace add`) does not hand anyone a box; ordering one (`install`) does.
**Artifact:** one repo serving all three agents (the `agent-knowledge` repo, 2026-11-20):

```text
agent-knowledge/                        ← marketplace root (the folder given to `marketplace add`)
  .claude-plugin/marketplace.json       ← catalog: Claude Code, Copilot CLI (and Codex when the next file is absent)
  .agents/plugins/marketplace.json      ← catalog in Codex's own format; Codex reads this one when both exist
  plugin/                               ← plugin root: "source": "./plugin", resolved from the marketplace root
    plugin.json                         ← Agent Plugins manifest (Codex; Copilot CLI checks it first)
    .claude-plugin/plugin.json          ← Claude Code manifest
    skills/review-knowledge-doc/SKILL.md ← one skill, one level under skills/
```

## How it works
**3 actors:**
- **The agent's CLI** — its job: register catalogs and install plugins, via `<cli> plugin marketplace add` and `<cli> plugin install|add`.
- **The marketplace root** — its job: hold the catalog file, via a fixed path inside the folder or repo.
- **The plugin folder** — its job: hold the manifest and the components, via fixed paths under the plugin root.

**Catalog files each CLI looks for** (fixed paths, never a recursive search):

| CLI | Paths, in order |
|---|---|
| Claude Code | `.claude-plugin/marketplace.json` only ✅[^cmkt] |
| Copilot CLI | `marketplace.json`, `.plugin/marketplace.json`, `.github/plugin/marketplace.json`, `.claude-plugin/marketplace.json` ✅[^gref] |
| Codex | `.agents/plugins/marketplace.json`, `.claude-plugin/marketplace.json` (documented without a ranking; with both present Codex used the first) ✅[^xbuild][^t] |

**Plugin entry shape.** Claude Code and Copilot CLI take `"source": "./plugin"`; Codex's own format is an object and needs `policy` and `category` on every entry ✅[^cmkt][^gref][^xbuild]:

```json
{ "name": "agent-knowledge",
  "source": { "source": "local", "path": "./plugin" },
  "policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" },
  "category": "Productivity" }
```

**Diagram:**
```
[CLI — local]                          [marketplace root]                 [plugin root ./plugin]
marketplace add ~/workspace/agent-knowledge
  ├─ reads catalog at fixed path ───▶ .claude-plugin/marketplace.json
  │                                    (Codex: .agents/plugins/marketplace.json)
  └─ registers name "agent-knowledge" in its settings
     (a GitHub source is cloned first ═══ network ═══; a local folder is not)
install agent-knowledge@agent-knowledge
  ├─ finds the entry, resolves source "./plugin" from the marketplace root ─▶ plugin/
  ├─ reads the manifest at fixed paths ──────────────────────────────────────▶ plugin.json, .claude-plugin/plugin.json
  ├─ scans components at fixed folders ──────────────────────────────────────▶ skills/<name>/SKILL.md (one level)
  └─ records the install; Claude/Copilot load the folder in place, Codex copies it to its cache
new session: the agent lists each skill's name and description
```

**Steps:**
1. **CLI (local) — `marketplace add <arg>`.** `<arg>` is a local folder, `owner/repo` or a git URL (Claude Code also takes a path or URL to the `.json` file) ✅[^cmkt][^gref][^xbuild].
   - Reading the catalog: at the fixed paths above, under `<arg>`.
   - Network boundary: only for a GitHub, git or URL source, which Claude Code clones into `~/.claude/plugins/marketplaces/` ✅[^cload]; a local folder is used where it is.
   - Registering: Claude Code writes `extraKnownMarketplaces` in `~/.claude/settings.json` and a record in `~/.claude/plugins/known_marketplaces.json` ✅[^cload][^t]; Copilot CLI writes `extraKnownMarketplaces` in `~/.copilot/settings.json` ✅[^t]; Codex writes `[marketplaces.<name>]` with `source_type = "local"` in `~/.codex/config.toml` ✅[^t]. The registration key is the catalog's `name`, not the folder name ✅[^gref].
   - Nothing is installed yet: adding a marketplace only makes its plugins browsable ✅[^gref].
2. **CLI (local) — `install <plugin>@<marketplace>`** (`codex plugin add` in Codex).
   - Resolving the source: a relative path is resolved from the marketplace root, not from the folder holding the catalog file ✅[^cmkt][^xbuild]; Claude Code requires the `./` prefix, Copilot CLI does not ✅[^cmkt][^gref].
   - Reading the manifest, at fixed paths only: Claude Code `.claude-plugin/plugin.json`, optional ✅[^cman]; Codex the root `plugin.json` (Agent Plugins), `.codex-plugin/plugin.json` as fallback ✅[^xbuild]; Copilot CLI a root `plugin.json` with the Agent Plugins `$schema` first, else `.plugin/`, `plugin.json`, `.github/plugin/`, `.claude-plugin/` in that order ✅[^gref]. Agent Plugins makes the root `plugin.json` mandatory ✅[^apspec].
   - Finding skills: each immediate child folder of `skills/` that holds a `SKILL.md` is one skill; deeper folders are not searched ✅[^apspec][^cman]. The manifest names no skill: the folder convention does. Claude Code's `skills` key adds folders to the scan; Agent Plugins forbids overriding the locations ✅[^cman][^apspec].
   - Recording and loading: Claude Code records the install in `~/.claude/plugins/installed_plugins.json` and enables it in settings ✅[^cload][^t]; for a relative-path plugin of a local marketplace it loads the folder in place, otherwise a copy in `cache/<marketplace>/<plugin>/<version>/` ✅[^cload]. Copilot CLI loads a path plugin of a local marketplace live from its folder ✅[^gref][^t]. Codex copies the plugin to `~/.codex/plugins/cache/<marketplace>/<plugin>/<version>/` and loads the copy ✅[^xbuild][^t].
3. **Agent (local), next session.** It lists the skill's `name` and `description`; Claude Code and Codex prefix the plugin name (`agent-knowledge:review-knowledge-doc`) ✅[^cman][^t].

## Worked example
Run on macOS on 2026-11-19 and 2026-11-20 with the artifact above:

| Step | Command | Observed |
|---|---|---|
| Claude Code add | `claude plugin marketplace add ~/workspace/agent-knowledge` | "Successfully added marketplace: agent-knowledge (declared in user settings)"; `known_marketplaces.json` source `{"source": "directory", "path": "/Users/…/agent-knowledge"}` |
| Claude Code install | `claude plugin install agent-knowledge@agent-knowledge` | `claude plugin list`: "Read from: /Users/…/agent-knowledge/plugin" |
| Copilot CLI | `copilot plugin marketplace add …` then `copilot plugin install agent-knowledge@agent-knowledge` | "It is loaded live from …/agent-knowledge/plugin … nothing was copied"; `copilot skill list` shows it under "Plugin skills" |
| Codex | `codex plugin marketplace add …` then `codex plugin add agent-knowledge@agent-knowledge` | "Installed plugin root: ~/.codex/plugins/cache/agent-knowledge/agent-knowledge/0.1.0"; `codex debug prompt-input` lists `agent-knowledge:review-knowledge-doc` |
| Edit the skill's description | — | Seen at once by `copilot skill list`; Claude Code read the edited file from the clone, but a session already running kept the text it loaded at start (seen 2026-11-20); Codex showed the old text until `codex plugin add` ran again |
| Add `.agents/plugins/marketplace.json` | `codex plugin list` | The marketplace line changed from `.claude-plugin/marketplace.json` to `.agents/plugins/marketplace.json` |

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Plugin at the repo root (`"source": "./"`) | Codex copies the whole repo into its cache on every install | Codex installs by copying the plugin folder ✅[^xbuild] |
| Skill at `skills/group/name/SKILL.md` | Not found | Only immediate children of `skills/` are scanned ✅[^apspec] |
| Codex marketplace refresh on a local folder | `codex plugin marketplace upgrade` fails: "not configured as a Git marketplace"; run `codex plugin add` again instead | Upgrade refreshes git marketplaces only ✅[^t] |
| Two catalog files in one repo | Claude Code and Copilot CLI ignore `.agents/plugins/`; Codex prefers it | Each CLI reads its own fixed paths ✅[^cmkt][^gref][^t] |
| Claude Code install from a local marketplace | A copy also appears under `~/.claude/plugins/cache/…/0.1.0`, but the plugin is read from the folder | Recorded by `installed_plugins.json`; loading rule for local relative-path plugins ✅[^cload][^t] |

## Takeaways
- Put the catalog at `.claude-plugin/marketplace.json` for Claude Code and Copilot CLI, and add `.agents/plugins/marketplace.json` for Codex.
- Keep the plugin in its own sub-folder (`./plugin`) so a Codex install copies only the plugin.
- Skills go at `skills/<name>/SKILL.md`, one level deep; no manifest lists them.
- After editing a skill, run `codex plugin add <plugin>@<marketplace>` again; Claude Code and Copilot CLI pick it up in the next session (Claude Code also on `/reload-plugins`).

## Verification status
- Verified: 29 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-20

## References
- [Create and distribute a plugin marketplace](https://code.claude.com/docs/en/plugin-marketplaces) and [Marketplace reference](https://code.claude.com/docs/en/plugins/marketplace-reference) — Anthropic, living, read 2026-11-20. Backs: `marketplace add` sources, catalog path, plugin `source` forms and resolution. [^cmkt]
- [Plugin manifest reference](https://code.claude.com/docs/en/plugins/manifest-reference) — Anthropic, living, read 2026-11-20. Backs: manifest path, standard layout, skill scan, namespacing. [^cman]
- [How plugins load](https://code.claude.com/docs/en/plugins/loading) — Anthropic, living, read 2026-11-20. Backs: registration files, clone and cache paths, in-place loading. [^cload]
- [Build plugins](https://developers.openai.com/plugins/build/plugins) — OpenAI, living, read 2026-11-20. Backs: Codex catalog paths, entry shape and required fields, manifest, cache. [^xbuild]
- [GitHub Copilot CLI plugin reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference) — GitHub, living, read 2026-11-20. Backs: catalog and manifest search order, source paths, live loading, registration key. [^gref]
- [Agent Plugins specification 1.0.0](https://agent-plugins.org/specification) — Agent Plugins, read 2026-11-20. Backs: mandatory root `plugin.json`, fixed `skills/` location, no recursion. [^apspec]
- Local test, 2026-11-19 and 2026-11-20, macOS: Claude Code 2.1.319, Codex CLI 0.166.0-alpha.6 (bundled with the ChatGPT app), GitHub Copilot CLI 1.0.109; commands and outputs as in the Worked example, plus the settings and registry files named in How it works. [^t]

## Related
- [Plugins and MCP servers: what they add to each session](agent-plugins-and-mcp-loading.md).
- [Agent Skills portability](agent-skills-portability.md).
- [What each coding agent loads at session start](session-start-context-by-agent.md).
