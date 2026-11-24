---
schema: topic-index/v1
kind: subtopic
topic: deno/modules
last-updated: 2026-11-24
---

# Deno modules and dependencies

How Deno 2.9 names and loads modules (relative and `file:` paths with full extensions, `jsr:`, `npm:`, `node:` and `https:` specifiers, `imports` and `scopes` in `deno.json`, import attributes, dynamic `import()`, `import.meta.resolve`) and how it manages the packages behind them (`deno add`, `install`, `remove`, `outdated`, `update`, `why`, `list`, `ci`, `clean`; `deno.lock`; the `DENO_DIR` cache; `nodeModulesDir` modes and vendoring; the minimum package age; private registries). Every behaviour was run in Deno 2.9.8. Not covered here: how the module graph is fetched, transpiled and type-checked (`deno/internals/`), permission flags such as `--allow-import` (`deno/security/`), workspaces (`deno/configuration/`), npm and CommonJS compatibility (`deno/node-compat/`), global installs and `deno compile` (`deno/advanced/`), and publishing to JSR (`deno/std-and-jsr/`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [module-specifiers-and-imports.md](module-specifiers-and-imports.md) | concept | ES modules in Deno: specifier kinds, full extensions, import maps with `scopes`, import attributes, literal versus computed `import()`, `import.meta.resolve` | verified |
| [dependency-management.md](dependency-management.md) | concept | The dependency subcommands, `deno.lock` and `--frozen`, the `DENO_DIR` cache, `nodeModulesDir` modes, vendoring, the 24-hour minimum age, `.npmrc` and `DENO_AUTH_TOKENS` | verified |

## References
- [Modules](https://docs.deno.com/runtime/fundamentals/modules/) — Deno project, living. Backs: subtopic scope (module system).
- [Dependency management](https://docs.deno.com/runtime/packages/) — Deno project, living. Backs: subtopic scope (package management).

## Related
- `deno/deno-lab-setup.md` — the container lab every output in these docs came from.
- `deno/internals/module-loading-and-type-checking.md` — the module graph behind these docs.
- `deno/configuration/deno-json-reference.md` — every `deno.json` key named here.
