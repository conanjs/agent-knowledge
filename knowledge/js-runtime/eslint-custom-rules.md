---
schema: knowledge-doc/v1
type: reference
topic: js-runtime
status: verified
applies-to: ["ESLint 10.15.0 (probe on 10.13.0)", "typescript-eslint 8.73.0", "TypeScript 7.0.2 and 6.0.x", "oxlint 1.94.0", "dependency-cruiser 18.9.0", "agentic-sdlc-reference-typescript-node v4.2.0 (probe)", "versions read from npm 2026-11-23, re-checked 2026-11-27"]
last-verified: 2026-11-27
last-updated: 2026-11-27
tags: [eslint, custom-rules, eslint-plugin, typescript-eslint, rule-tester, oxlint, dependency-cruiser, lint]
---

# Custom ESLint rules and plugins for TypeScript projects

## Summary
**TL;DR:** A check that no published rule covers can be written as an ESLint rule (an object with `meta` and `create`) and shipped in a plugin (an object with `meta`, `configs` and `rules`). `RuleTester` tests it with lists of valid and invalid code. Rules that need types use typescript-eslint's `RuleCreator` and `getParserServices`, and typescript-eslint 8.73.0 accepts TypeScript only below 6.1.0, so typed linting cannot run on TypeScript 7 yet. Many checks people plan to write already exist: look in typescript-eslint, oxlint and dependency-cruiser first.
**Use this when:** you want a lint check that no installed rule gives; you are deciding between writing a rule and configuring an existing one; you plan to upgrade a typed-linting project to TypeScript 7.
**Not this doc:** which config file applies to which file ([eslint-nested-config-lookup.md](eslint-nested-config-lookup.md)); how a checker's exit codes map onto Claude Code hook exit codes ([harness deep dive §9, failure and edge-case matrix](../ai-agents/harness-engineering-deep-dive.md#9-failure-and-edge-case-matrix)).

## Scope

ESLint's plugin and custom-rule format, typescript-eslint's helpers for typed rules, and the existing rules and tools that already cover common architecture checks. Versions are those listed in `applies-to`, read from the npm registry and the projects' docs and source on 2026-11-23, and re-checked on 2026-11-27.

The doc stays pinned to those versions. Newer releases came out on 2026-11-23: typescript-eslint 8.74.0 and oxlint 1.95.0. typescript-eslint 8.74.0 was re-checked on 2026-11-27 and has the same peer range. oxlint 1.95.0's rules were not re-checked.

## Catalog

**Building blocks**

| Piece | Shape | Source |
|---|---|---|
| Plugin | An object with `meta` (recommended: `name`, `version`, `namespace`), `configs` (named configurations) and `rules`. `meta.name` should match the npm package name | ✅[^plugins] |
| Rule | An object with `meta` (type, docs, messages, options schema, `fixable`) and `create(context)`, which returns visitor functions keyed by AST node type; problems are reported with `context.report` | ✅[^rules] |
| Rule tests | `new RuleTester().run(name, rule, { valid: [...], invalid: [...] })`; each invalid case lists the errors it must raise | ✅[^rules] |
| Typed rule | `ESLintUtils.RuleCreator` from `@typescript-eslint/utils` infers message IDs from `meta.messages`. `ESLintUtils.getParserServices(context)` returns services such as `getTypeAtLocation` on the TypeScript type checker | ✅[^tse] |
| Typed rule tests | `RuleTester` from `@typescript-eslint/rule-tester`, in place of ESLint core's | ✅[^tse] |

**Version limits (npm registry, read 2026-11-23, re-checked 2026-11-27)**

| Package | Version read | Peer range that matters | Effect | Source |
|---|---|---|---|---|
| `eslint` | 10.15.0, still the latest on 2026-11-27 | — | — | ✅[^npm] |
| `typescript-eslint` | 8.73.0 (8.74.0, published 2026-11-23, has the same peer range) | `typescript >=4.8.4 <6.1.0`; `eslint ^8.57.0 \|\| ^9.0.0 \|\| ^10.0.0` | Typed linting needs TypeScript 6.0.x or older | ✅[^npm] |
| `typescript` | 7.0.2 | Ships one native binary package per platform (`@typescript/typescript-darwin-x64` and others) as optional dependencies | Not yet inside typescript-eslint's range | ✅[^npm] |
| `@typescript/native-preview` | 7.0.0-dev.20260707.2 | Last published 2026-07-07 | The `tsgo` preview (its only binary is `tsgo`); TypeScript 7 itself is now released | ✅[^npm] |
| `oxlint` | 1.94.0 (1.95.0 published 2026-11-23, not re-checked) | — | Its rules in the next table were read at the matching source tag, `oxlint_v1.94.0` | ✅[^npm] |
| `dependency-cruiser` | 18.9.0, still the latest on 2026-11-27 | — | Its docs in the next table were read at tag `v18.9.0` | ✅[^npm] |

**Checks that already exist** (typescript-eslint rules at tag `v8.73.0`, oxlint 1.94.0, dependency-cruiser 18.9.0)

| Check | Existing rule or tool | Source |
|---|---|---|
| No explicit `any` | typescript-eslint `no-explicit-any`; oxlint `typescript/no-explicit-any` | ✅[^tse_any] ✅[^oxc] |
| No type assertions (`x as T`) | typescript-eslint `consistent-type-assertions` with `assertionStyle: "never"`; oxlint `typescript/consistent-type-assertions` | ✅[^tse_cta] ✅[^oxc] |
| Import cycles | oxlint `import/no-cycle`; dependency-cruiser's circular-dependency rules | ✅[^oxc] ✅[^dc] |
| Layer and folder boundaries | dependency-cruiser `forbidden` rules | ✅[^dc] |
| What one module reaches, or what reaches it | dependency-cruiser `--focus` with `--focus-depth` (0 = unlimited) for neighbours both ways; `--reaches` for transitive dependents; `--affected` for what changed since a git revision | ✅[^dc_cli] |

## Lookup notes

- **Local plugins work without publishing.** A flat config can import a plugin object from a file in the repo: the typescript-node reference's `eslint.config.mjs` imports `./eslint/local-docs.mjs`, whose header says it is copied into each repo as one file ✅[^tsnref]. A copied file drifts; a versioned package does not (reasoning, ours).
- **Pick the narrowest tool.** A per-file pattern fits an ESLint rule. A rule about the import graph fits dependency-cruiser. A rule about non-code files such as specs fits a project validator script.
- **A `Program > VariableDeclaration` selector misses `export const`.** In the syntax tree, an exported declaration sits inside an `ExportNamedDeclaration` node, so the child selector `Program > VariableDeclaration > VariableDeclarator[init.type='ArrowFunctionExpression']` never reaches it. The typescript-node reference at v4.2.0 lists that selector, and no exported variant of it, in its `noFreeFunctions` block ✅[^tsnref].
  - Measured on 2026-11-24 with ESLint 10.13.0 in the typescript-node reference, and re-run on 2026-11-27 at tag v4.2.0, by linting planted code through `eslint --stdin --stdin-filename <path>` with an existing file under `src/modules/documents/application/` as the path ✅[^tsnref]:
    - `const probe = (a: number): number => a;` was reported by `no-restricted-syntax` ("Tier A code is a class");
    - the same line with `export` in front gave no `no-restricted-syntax` message. Its only message was `jsdoc/require-jsdoc`, which asks for a doc comment on the export.
  - Fix: add a second selector, `Program > ExportNamedDeclaration > VariableDeclaration > VariableDeclarator[init.type='ArrowFunctionExpression']`. Passed through `--rule` in the same re-run, it reported the exported line ✅[^tsnref].
- **A lint config fails open without a test.** A rule left out of one `files` block, or an option that replaces an earlier one, removes a check silently while `eslint` still exits 0. Keep one known-bad file per rule and assert the expected `ruleId` in CI.

## Takeaways
- Search typescript-eslint, oxlint and dependency-cruiser before writing a rule; write one only for a check none of them has. The five checks in the Catalog's last table already exist there ✅[^tse_any] ✅[^oxc] ✅[^dc]. [rule-candidate]
- Ship repo-specific rules as one versioned plugin package tested with `RuleTester` ✅[^plugins] ✅[^rules], not as a file copied into each repo, which is how the typescript-node reference ships its local rules today ✅[^tsnref]. [rule-candidate]
- Stay on TypeScript 6.0.x while the project uses typed linting, until typescript-eslint's peer range includes 7. It is `>=4.8.4 <6.1.0` in both 8.73.0 and 8.74.0 ✅[^npm]. [rule-candidate]

## Verification status
- Verified: 30 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-27
- Re-checked on 2026-11-27: every ✅ above, against the pages, tags and commands in References. Not re-checked: oxlint 1.95.0's rules. Unsourced on purpose: "Pick the narrowest tool" and "A lint config fails open without a test" are advice, not claims about a tool.

## References
- [Create plugins](https://eslint.org/docs/latest/extend/plugins) — ESLint, living (docs for v10.15.0), read 2026-11-23 and 2026-11-27. Backs: plugin shape and `meta`. [^plugins]
- [Custom rules](https://eslint.org/docs/latest/extend/custom-rules) — ESLint, living (docs for v10.15.0), read 2026-11-23 and 2026-11-27. Backs: rule shape, `context.report`, `RuleTester`. [^rules]
- [Custom rules (typescript-eslint)](https://typescript-eslint.io/developers/custom-rules) — typescript-eslint, living (site at v8.74.0 on 2026-11-27), read 2026-11-23 and 2026-11-27. Backs: `RuleCreator`, `getParserServices`, `@typescript-eslint/rule-tester`. [^tse]
- [no-explicit-any](https://typescript-eslint.io/rules/no-explicit-any) — typescript-eslint, living, read 2026-11-23 and 2026-11-27; rule source [`no-explicit-any.ts` at tag v8.73.0](https://github.com/typescript-eslint/typescript-eslint/blob/v8.73.0/packages/eslint-plugin/src/rules/no-explicit-any.ts). Backs: the rule exists. [^tse_any]
- [consistent-type-assertions](https://typescript-eslint.io/rules/consistent-type-assertions) — typescript-eslint, living, read 2026-11-23 and 2026-11-27; rule source [`consistent-type-assertions.ts` at tag v8.73.0](https://github.com/typescript-eslint/typescript-eslint/blob/v8.73.0/packages/eslint-plugin/src/rules/consistent-type-assertions.ts). Backs: `assertionStyle: "never"`. [^tse_cta]
- [oxc linter rules source at `oxlint_v1.94.0`](https://github.com/oxc-project/oxc/tree/oxlint_v1.94.0/crates/oxc_linter/src/rules) — oxc project, tag `oxlint_v1.94.0` (the oxlint 1.94.0 release, 2026-11-16), read 2026-11-27; first read from `main` on 2026-11-23. Backs: `typescript/no_explicit_any.rs`, `typescript/consistent_type_assertions.rs` (with a `Never` assertion style), `import/no_cycle.rs` exist. [^oxc]
- [dependency-cruiser README at v18.9.0](https://github.com/sverweij/dependency-cruiser/blob/v18.9.0/README.md) — Sander Verweij, tag `v18.9.0`, read 2026-11-27; first read from `main` on 2026-11-23. Backs: circular dependencies, `forbidden` rules. [^dc]
- [dependency-cruiser command line reference at v18.9.0](https://github.com/sverweij/dependency-cruiser/blob/v18.9.0/doc/cli.md) — Sander Verweij, tag `v18.9.0`, read 2026-11-27; first read from `main` on 2026-11-23. Backs: `--focus`, `--focus-depth` (0 means infinite), `--reaches`, `--affected`. [^dc_cli]
- npm registry, local check: `npm view <package> version`, `npm view typescript-eslint@8.73.0 peerDependencies`, `npm view typescript-eslint peerDependencies` (8.74.0), `npm view typescript@7.0.2 optionalDependencies`, `npm view @typescript/native-preview bin`, and `npm view <package> time` for publish dates, run 2026-11-23 and again 2026-11-27. Backs: the version table; Takeaway 3. [^npm]
- [conanjs/agentic-sdlc-reference-typescript-node at v4.2.0](https://github.com/conanjs/agentic-sdlc-reference-typescript-node/tree/v4.2.0) (commit `bfa1706`): [`eslint/local-docs.mjs`](https://github.com/conanjs/agentic-sdlc-reference-typescript-node/blob/v4.2.0/eslint/local-docs.mjs) (header comment) and [`eslint.config.mjs`](https://github.com/conanjs/agentic-sdlc-reference-typescript-node/blob/v4.2.0/eslint.config.mjs) (the `localDocs` import and the `noFreeFunctions` selectors). Read 2026-11-27 with `gh api repos/conanjs/agentic-sdlc-reference-typescript-node/contents/<path>?ref=v4.2.0`; the probe was re-run the same day in a local clone at that tag, with its installed ESLint 10.13.0. Backs: Lookup notes 1 and 3; Takeaway 2. [^tsnref]

## Related
- [eslint-nested-config-lookup.md](eslint-nested-config-lookup.md) — which config file ESLint uses for each file.
- [Harness engineering deep dive](../ai-agents/harness-engineering-deep-dive.md) — lint rules as computational sensors, and hook exit codes (§9).
