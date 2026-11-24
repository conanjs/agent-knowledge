---
schema: knowledge-doc/v1
type: concept
topic: deno/toolchain
status: verified
applies-to: ["Deno 2.9.8"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [deno, deno-fmt, deno-lint, lint-plugins, deno-doc, dprint, formatter, linter, jsdoc, editorconfig]
ranked-sources: true
---

# Formatting, linting and API docs: `deno fmt`, `deno lint`, `deno doc`

## Summary
**TL;DR:** Three built-in tools read the same `deno.json`. `deno fmt` rewrites layout only (it is based on dprint), for about 20 file types, with a short list of options; `--check` turns it into a continuous integration (CI) gate. `deno lint` runs 124 rules in 2.9.8 (87 on by default as the `recommended` tag), honours `// deno-lint-ignore <rule>` comments, applies fixes with `--fix` only for rules that ship one, and loads JavaScript plugins that add rules through an AST (abstract syntax tree) visitor. `deno doc` prints or exports the public API (application programming interface) from JSDoc comments, and `deno doc --lint` fails when an exported symbol lacks JSDoc, an explicit type, or references a non-exported type.
**Use this when:** setting up formatting and lint gates for a Deno project, writing a custom lint rule, silencing one finding, or checking that a library's public API is documented.
**Not this doc:** the full list of `fmt`/`lint` keys among all `deno.json` keys → `deno/configuration/deno-json-reference.md`; the `no-slow-types` rule's purpose for publishing → `deno/std-and-jsr/jsr-and-publishing.md`; doc tests (`deno test --doc`) → `deno/testing/testing-and-mocking.md`; every other subcommand → `deno/toolchain/cli-subcommands.md`.

## Problem
Without a shared formatter, reviews fill with whitespace changes and style arguments. Without a linter, unused variables, `any` types and `==` comparisons slip in. A library's documentation drifts from its code, and nothing fails when an exported function has no comment. Each tool also has its own config block, ignore syntax and exit codes; mixing them up gives a CI step that passes while files are still unformatted, or an ignore comment that silences nothing.

## Mental model
**Analogy:** a print shop. The typesetter (`deno fmt`) changes spacing and line breaks but never the words. The proofreader (`deno lint`) marks doubtful sentences with a reason code; a sticky note ("known, leave it") on a line is an ignore comment, and a proofreader you train with your own checklist is a lint plugin. The catalogue writer (`deno doc`) builds a catalogue from the labels (JSDoc) on every item for sale (export), and the catalogue audit (`--lint`) lists items with no label.

| Term | Plain-English meaning | Concrete artifact |
|---|---|---|
| Formatter | Rewrites whitespace and punctuation layout to one style | `const greeting   = "hi"` → `const greeting = "hi";` |
| Linter rule | A named check that reports a pattern in code | `error[prefer-const]: \`count\` is never reassigned` |
| Tag | A named set of rules switched on together | `"rules": { "tags": ["recommended"] }` |
| Ignore directive | A comment that silences named rules on the next line or the whole file | `// deno-lint-ignore no-explicit-any -- legacy API` |
| Fix | An automatic edit a rule offers, applied by `--fix` | `window.location` → `globalThis.location` |
| AST visitor | An object whose methods run for each code element of a type | `{ Identifier(node) { … } }` |
| Lint plugin | A module that adds rules named `<plugin>/<rule>` | `"lint": { "plugins": ["./no-todo-names.ts"] }` |
| JSDoc | A `/** … */` comment above a declaration | `/** Returns a name. */` |

**Artifact:** one `deno.json` configures both tools (each has its own `include`/`exclude`):
```json
{
  "fmt": { "semiColons": false, "singleQuote": true, "exclude": ["skip/"] },
  "lint": { "rules": { "tags": ["recommended"], "include": ["eqeqeq"], "exclude": ["no-explicit-any"] } }
}
```

## How it works
**4 actors**; every run below stayed on the machine except `deno doc jsr:@std/path@1`, which fetched the package:
- **`deno fmt`** — its job: rewrite each file's layout, via the bundled formatter for its extension.
- **`deno lint`** — its job: parse JavaScript and TypeScript and run the enabled rules, via the built-in rule set plus the modules in `lint.plugins`.
- **A lint plugin** — its job: report problems for the code elements it watches, via a `create(context)` method that returns a visitor.
- **`deno doc`** — its job: list exported symbols with their JSDoc, via the module graph of the files or `jsr:`/`npm:` specifiers given.

```
deno.json ──fmt block──▶ deno fmt ──▶ per-extension formatter ──▶ rewrite (or --check: diff + exit 1)
          ──lint block─▶ deno lint ─▶ parse ─▶ built-in rules ┐
                                      │       plugin visitors ┴▶ drop ignored ─▶ report / --fix
source files ───────────────────────▶ deno doc ─▶ exported symbols + JSDoc ─▶ text | --json | --html | --lint
```

1. **Config (local):** `deno fmt` reads `fmt`, `deno lint` reads `lint`; their `exclude` lists are separate: `fmt.exclude: ["skip/"]` kept `skip/raw.ts` out of formatting, but `deno lint` still linted it ✅[^run] ✅[^config].
2. **`deno fmt` (local):**
   - Picks options in this order: CLI flag, then `deno.json` `fmt`, then `.editorconfig`, then defaults ✅[^fmt]; an `.editorconfig` with `indent_style = tab` and `max_line_length = 40` gave tab indents and wrapped lines, and `--no-editorconfig` turned that off ✅[^run].
   - Rewrites files and prints each changed path, then `Checked 4 files` ✅[^run].
   - With `--check` it writes nothing, prints a diff per file and ends with a count such as `error: Found 5 not formatted files in 7 files`, exit 1 ✅[^run] ✅[^fmt]; `--fail-fast` stops at the first file ✅[^run].
3. **`deno lint` (local):**
   - Builds the rule set: the tags (default `recommended`), plus `include`, minus `exclude` ✅[^lint] ✅[^rules].
   - Reports each finding as `error[<rule>]`, location, `hint:` and a `docs:` link; ends `Found 4 problems` / `Checked 1 file`, exit 1 ✅[^run].
4. **Plugin (local):** `deno lint` calls `create(context)` and then the visitor methods; `context.report({ node, message, hint, fix })` adds a finding named `<plugin>/<rule>` ✅[^run] ✅[^plugins].
5. **`deno doc` (local, or network for `jsr:`/`npm:`):** prints exported symbols, with non-exported referenced types marked `private`; `--lint` prints diagnostics to stderr and exits non-zero ✅[^run] ✅[^doc].

### `deno fmt`: file types, options, ignore comments
| File types | Needs |
|---|---|
| `.js .cjs .mjs .ts .mts .cts .jsx .tsx`, Markdown (fenced code that names a language is formatted too: `const x  =  1` became `const x = 1;` in a `ts` block ✅[^run]), `.json .jsonc`, `.css .scss .less`, `.html .xml .svg .njk .vto`, `.yml .yaml`, `.ipynb` | Nothing ✅[^fmt] |
| `.astro .svelte .vue` (and Angular templates) | `--unstable-component` or `"unstable": ["fmt-component"]` ✅[^fmt] |
| `.sql` | `--unstable-sql` or `"unstable": ["fmt-sql"]` ✅[^fmt]; with the flag `select a,b from t where x=1` became `SELECT a,b` / `FROM t` / `WHERE x=1` ✅[^run] |

| Option | `deno.json` `fmt` key | Flag | Default |
|---|---|---|---|
| Indent with tabs | `useTabs` | `--use-tabs` | `false` ✅[^config] |
| Line width | `lineWidth` | `--line-width` | `80` ✅[^config] |
| Indent width | `indentWidth` | `--indent-width` | `2` ✅[^config] |
| Semicolons | `semiColons` | `--no-semicolons` | `true` ✅[^config] |
| Quotes | `singleQuote` | `--single-quote` | `false` ✅[^config] |
| Markdown prose wrap | `proseWrap` | `--prose-wrap` | `always` (`never`, `preserve`) ✅[^config] |
| Sort named imports / exports | `sortNamedImports`, `sortNamedExports` | — | `caseInsensitive`: `{ z, a, M }` became `{ a, M, z }` ✅[^config] ✅[^run] |
| Trailing commas | `trailingCommas`, `json.trailingCommas` | — | `always` (JS/TS), `never` (JSON) ✅[^config] |
| Braces | `useBraces` | — | `whenNotSingleLine`: `if (v == null) { return "none" }` became `if (v == null) return 'none'` ✅[^config] ✅[^run] |
| Files | `include`, `exclude` | `--ignore=dist/,build/` | all supported files ✅[^fmt] |

| Ignore | Syntax |
|---|---|
| Next item (JS, TS, JSONC) | `// deno-fmt-ignore`: kept `const matrix = [1,0,` / `0,1];` as written ✅[^run] ✅[^fmt] |
| Whole file (JS, TS, JSONC) | `// deno-fmt-ignore-file` as the first line ✅[^run] ✅[^fmt] |
| Markdown, HTML, CSS | `<!-- deno-fmt-ignore -->`, a `<!-- deno-fmt-ignore-start -->` … `<!-- deno-fmt-ignore-end -->` range (kept a Markdown table as written), `<!-- deno-fmt-ignore-file -->` ✅[^run] ✅[^fmt] |
| YAML | `# deno-fmt-ignore` ✅[^fmt] |

### `deno lint`: rules, tags, flags, ignores, fixes
| Tag (2.9.8 `deno lint --rules`) | Rules | Examples |
|---|---|---|
| `recommended` (the default) | 87 | `prefer-const`, `no-unused-vars`, `no-explicit-any`, `ban-unused-ignore` ✅[^run] ✅[^rules] |
| `react` / `jsx` | 14 / 11 | `jsx-key`, `react-rules-of-hooks` ✅[^run] ✅[^rules] |
| `fresh` | 11 | `fresh-handler-export`, `fresh-server-event-handlers` ✅[^run] |
| `jsr` | 2 | `no-slow-types`, `verbatim-module-syntax` ✅[^run] |
| `workspace` | 1 | `no-import-prefix` ✅[^run] |
| No tag (opt in with `include`) | 29 | `eqeqeq`, `no-console`, `no-eval`, `no-process-global`, `no-node-globals`, `explicit-function-return-type` ✅[^run] ✅[^lint] |

124 rules in total ✅[^run] ✅[^rules]. `--rules-tags=jsr` replaced the default set (2 rules on) rather than adding to it ✅[^run].

| Flag | Effect |
|---|---|
| `--rules` | List rules, `✓` marking enabled ones, with tags and docs link ✅[^run] |
| `--rules-tags`, `--rules-include`, `--rules-exclude` | Same as `lint.rules.tags/include/exclude` ✅[^lint]; `--rules-include=eqeqeq` reported `expected '===' and instead saw '=='.` ✅[^run] |
| `--compact` | One line per finding: `file:///lab/lint/main.ts: line 1, col 5 - \`count\` is never reassigned (prefer-const)` ✅[^run] |
| `--json` | `{ "version": 1, "diagnostics": [ { "filename", "range", "message", "code", "hint" } ] }` (0-based `col`) ✅[^run] |
| `--fix` | Applies fixes of rules that have one ✅[^lint] |
| `--ext=tsx` with `-` | Lint stdin as that type ✅[^lint] |

| Directive | Effect |
|---|---|
| `// deno-lint-ignore no-explicit-any -- legacy API` | Silences that rule on the next line; rule names are required, a reason goes after `--` ✅[^run] ✅[^lint] |
| `// deno-lint-ignore-file no-explicit-any` | Before the first statement: silences the rule in the whole file (2 `any` parameters, 0 findings); only the first such line counts ✅[^run] ✅[^lint] |
| An ignore that silences nothing | Reported: `error[ban-unused-ignore]: Ignore for code "no-var" was not used.` ✅[^run]; only `// deno-lint-ignore-file ban-unused-ignore` silences it ✅[^lint] |

### Lint plugins
A plugin is a module whose default export is a `Deno.lint.Plugin`; it needs no unstable flag since Deno 2.2, and the API "is still evolving" ✅[^plugins]. This one ran in the lab with no permission flags ✅[^run]:
```ts
const plugin: Deno.lint.Plugin = {
  name: "lab",
  rules: {
    "no-foo": {
      create(context) {
        return {
          Identifier(node) {
            if (node.name === "foo") {
              context.report({
                node,
                message: "Do not name things `foo`",
                hint: "Pick a descriptive name",
                fix(fixer) {
                  return fixer.replaceText(node, "value");
                },
              });
            }
          },
          'CallExpression[callee.name="eval"]'(node) {
            context.report({ node, message: "eval call" });
          },
        };
      },
    },
  },
};
export default plugin;
```
- **Declare:** `"lint": { "plugins": ["./no-todo-names.ts"] }`; entries may be paths, `jsr:` or `npm:` ✅[^plugins].
- **Run:** on `const foo = 1; export const bar = foo + 1; … eval("1");` it printed `error[lab/no-foo]: Do not name things \`foo\`` twice with `hint: Pick a descriptive name`, `error[lab/no-foo]: eval call`, and `Found 3 problems (2 fixable via --fix)` ✅[^run].
- **Fix:** `--fix` rewrote the file to `const value = 1;` / `export const bar = value + 1;` and left the `eval` finding ✅[^run] ✅[^plugins].
- **Ignore:** `// deno-lint-ignore lab/no-foo` silenced both `foo` names on the next line ✅[^run]; `lint.rules.exclude: ["lab/no-foo"]` disables the rule everywhere ✅[^plugins].
- **Selectors:** string keys are CSS-like selectors; the attribute selector `'CallExpression[callee.name="eval"]'` matched in the lab ✅[^run]. Also supported: regex attributes, combinators (`>`, `+`, `~`, space), `:not()`, `:has()`, `:first-child`, and `:exit` (only at the end; runs on the way back up the tree) ✅[^plugins].
- **Test:** `Deno.lint.runPlugin(plugin, "dummy.ts", "const foo = 1;")` inside `deno test` returned `[{"id":"lab/no-foo","message":"Do not name things \`foo\`","fix":[{"range":[6,9],"text":"value"}]}]` ✅[^run] ✅[^plugins].
- **Lifecycle:** a plugin instance may be reused across files; keep no global state and clean up in the optional `destroy()` ✅[^plugins].

### `deno doc`: output modes and doc lint
| Command | Output (2.9.8) |
|---|---|
| `deno doc mod.ts` | Each export: `Defined in file:///lab/doc/mod.ts:10:1`, the signature `function add(a: number, b: number): number`, JSDoc text, `@param`, `@return`, `@example`; the non-exported `Person` shows as `private interface Person` ✅[^run] |
| `deno doc --filter add mod.ts` | Only `add` ✅[^run] ✅[^doc] |
| `deno doc --json mod.ts` | `{ "version": 2, "nodes": { "file:///lab/doc/mod.ts": { "symbols": [ … ] } } }` ✅[^run] |
| `deno doc --html --name=Lab --output=site mod.ts` | `Written 18 files to "site"` (`index.html`, `all_symbols.html`, `search_index.js`, …), with client-side search ✅[^run] ✅[^doc] |
| `deno doc jsr:@std/path@1` | The package's docs, fetched (2.8+) ✅[^run] ✅[^doc] |
| `deno doc --lint mod.ts` | The three diagnostics below, `error: Found 3 documentation lint errors.`, exit 1 ✅[^run] |

| Diagnostic | Trigger in the lab | Silence it with |
|---|---|---|
| `error[private-type-ref]: public type 'getName' references private type 'Person'` | Exported function takes a non-exported interface | Export the type, or tag it `@internal` ✅[^run] ✅[^doc] |
| `error[missing-return-type]: exported function is missing an explicit return type annotation` | `export function getName(p: Person) {` | Add the return type ✅[^run] ✅[^doc] |
| `error[missing-jsdoc]: exported symbol is missing JSDoc documentation` | `export const VERSION = "1.0.0";` | Add JSDoc, or `@ignore` to drop it from the docs ✅[^run] ✅[^doc] |

## Worked example
A folder with the Mental model's `deno.json`, an `.editorconfig` (`indent_style = tab`, `max_line_length = 40`), `app.ts`, `readme.md`, `ignored.ts` (first line `// deno-fmt-ignore-file`) and `skip/raw.ts` ✅[^run]:

1. `deno fmt --check` → diffs for `app.ts`, `deno.json`, `readme.md`, then `error: Found 3 not formatted files in 4 files`, exit 1 (`skip/` excluded; `ignored.ts` counted but untouched).
2. `deno fmt` → prints the three paths and `Checked 4 files`, exit 0. `app.ts` now reads:
   ```ts
   export function check(v: any) {
   	if (v == null) return 'none'
   	return 'value: ' + String(v) +
   		' and some more text here'
   }
   ```
   Single quotes and no semicolons come from `deno.json`, tabs and the 40-column wrap from `.editorconfig`.
3. `deno lint` → `error[eqeqeq]: expected '===' and instead saw '=='.` in `app.ts` (added by `include`), `error[no-unused-vars]` in `ignored.ts` and in `skip/raw.ts` (the fmt ignore and fmt exclude do not apply to lint), no `no-explicit-any` finding (excluded); `Found 3 problems`, `Checked 3 files`, exit 1.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `.sql` file without `--unstable-sql` | `deno fmt --check q.sql` printed `Checked 1 file`, exit 0, although the file was unformatted ✅[^run] | Unflagged SQL is skipped silently, so a CI gate passes |
| `--unstable-css`, `--unstable-html`, `--unstable-yaml` | Accepted though `deno fmt --help` shows only `--unstable-component` and `--unstable-sql`; CSS, HTML and YAML formatted the same with or without them, while `--unstable-nope` failed with `tip: a similar argument exists: '--unstable-net'` ✅[^run] | The 2.9 post says CSS, SCSS and Less moved to the new `lax-css` engine, "still under `--unstable-css`" ✅[^v29]; the fmt page lists CSS as needing no flag ✅[^fmt] |
| `deno lint --fix` on `prefer-const`, `no-var`, `no-extra-boolean-cast`, `prefer-as-const`, `prefer-namespace-keyword` | Nothing changed; all findings stayed ✅[^run] | Only rules that ship a fix change code: `no-window` gave `globalThis.location`, `no-process-global` added `import process from "node:process";` ✅[^run] |
| `--rules-exclude=ban-unused-ignore` | Still reported `ban-unused-ignore` ✅[^run] | Only the file-level directive silences it ✅[^lint] |
| A `deno.json` with `name`, `version` and `exports` | `deno lint` reported `missing explicit return type in the public API (no-slow-types)` for `export function f() { return 1; }` although no tag asked for it, and a `// deno-lint-ignore no-slow-types` line above did not silence it; with `--no-config` the same file passed ✅[^run] | A package config switches the JSR rule on; what slow types are → `deno/std-and-jsr/jsr-and-publishing.md` |
| `no-process-global`, `no-node-globals` | Off by default since 2.8 (no tag in 2.9.8) ✅[^v28] ✅[^run] | Add them to `include` to get the old behaviour |
| `Deno.lint.runPlugin` outside a test | `error: Uncaught (in promise) Error: \`Deno.lint.runPlugin\` is only available in \`deno test\` subcommand.` ✅[^run] | The docs say `deno test` and `deno bench` ✅[^plugins]; the 2.9.8 message names only `deno test` |
| `hint` in `context.report` | Printed as `= hint: …` ✅[^run] | Works although the plugin page's examples show only `node`, `message`, `fix` ✅[^plugins] |
| Markup and CSS formatters on unknown syntax | Pass it through unchanged instead of erroring ✅[^fmt] | They only adjust whitespace |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Defaults (`recommended`, no fmt options) | Zero config | 29 useful rules (`eqeqeq`, `no-console`) stay off |
| Lint plugin | Project-specific rules in TypeScript, with fixes and tests | API "still evolving" ✅[^plugins]; one more module to maintain |
| `deno doc --lint` in CI | Public API always documented and explicitly typed | Every export needs JSDoc and return types |

## Takeaways
- Run `deno fmt --check` and `deno lint` in CI; both exit 1 on findings. [rule-candidate]
- Always name the rule and give a reason in ignore comments (`// deno-lint-ignore <rule> -- <why>`); unused ignores fail the `recommended` set. [rule-candidate]
- Pass `--unstable-sql` / `--unstable-component` in the CI `deno fmt --check` call when the repo has those files, or they are skipped silently. [rule-candidate]
- Run `deno doc --lint` on a library's entry points before publishing it.
- Test custom lint rules with `Deno.lint.runPlugin` inside `deno test`.

## Verification status
- Verified: 110 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- Commands run on 2026-11-24 with `denoland/deno:alpine-2.9.8` (Deno 2.9.8, V8 15.0.245.2-rusty, TypeScript 6.0.3, Alpine 3.24.2, aarch64) in the lab of `deno/deno-lab-setup.md`; outputs as quoted in How it works, Worked example and Edge cases. [^run]
- [deno fmt](https://docs.deno.com/runtime/reference/cli/fmt/) — Deno project, living. Rank 1. Backs: dprint base, file types and unstable flags, option precedence with `.editorconfig`, `--check`, ignore comments, include/exclude, markup formatters passing unknown syntax. [^fmt]
- [Configuration file (deno.json)](https://docs.deno.com/runtime/reference/deno_json/) — Deno project, living. Rank 1. Backs: `fmt` keys and defaults, separate `lint` include/exclude and rules keys. [^config]
- [deno lint](https://docs.deno.com/runtime/reference/cli/lint/) — Deno project, living. Rank 1. Backs: rule configuration, untagged rules, ignore directives and reasons, `ban-unused-ignore`, `--fix`, `--ext`. [^lint]
- [List of rules](https://docs.deno.com/lint/) — Deno project, living. Rank 1. Backs: the six tags, `recommended` as the default, the rule count. [^rules]
- [Lint Plugins](https://docs.deno.com/runtime/reference/lint_plugins/) — Deno project, living. Rank 1. Backs: plugin shape, declaration, naming, selectors, fixer, `runPlugin`, `destroy`, stability. [^plugins]
- [deno doc](https://docs.deno.com/runtime/reference/cli/doc/) — Deno project, living. Rank 1. Backs: output modes, `jsr:`/`npm:` specifiers, the three doc-lint problems and how to silence them. [^doc]
- [Deno 2.8](https://deno.com/blog/v2.8) — Deno project, 2026. Rank 1. Backs: `no-process-global` and `no-node-globals` off by default. [^v28]
- [Deno 2.9](https://deno.com/blog/v2.9) — Deno project, 2026. Rank 1. Backs: `--unstable-css` and the `lax-css` engine. [^v29]

## Related
- `deno/toolchain/cli-subcommands.md` — all `deno fmt`, `deno lint` and `deno doc` flags next to the other subcommands.
- `deno/toolchain/tasks-and-task-shell.md` — wrapping these checks in `deno task`.
- `deno/configuration/deno-json-reference.md` — the `fmt` and `lint` blocks among all keys.
- `deno/std-and-jsr/jsr-and-publishing.md` — slow types and what `deno publish` checks.
