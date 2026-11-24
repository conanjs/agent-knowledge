---
schema: topic-index/v1
kind: subtopic
topic: deno/std-and-jsr
last-updated: 2026-11-24
---

# Deno standard library and JSR

How Deno code shares packages through JSR (the JavaScript Registry): what a JSR package is, how versions and `exports` resolve, how `deno publish` checks and uploads a package (slow types, licence, provenance), how npm projects use JSR packages, and the 43 `@std` standard-library packages with their stability and imports, measured in Deno 2.9.8 except the npm-side commands and real uploads. Not covered: `jsr:`/`npm:` specifier syntax and import maps (`deno/modules/module-specifiers-and-imports.md`), `deno add`, `deno.lock` and the cache (`deno/modules/dependency-management.md`), publishing a workspace (`deno/configuration/workspaces-and-monorepos.md`), and the testing packages in use (`deno/testing/testing-and-mocking.md`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [jsr-and-publishing.md](jsr-and-publishing.md) | concept | JSR packages, names, semver ranges and `exports`; what `deno publish` and `--dry-run` check, slow types, OIDC publishing and provenance, the JSR score, JSR from npm | verified |
| [standard-library.md](standard-library.md) | reference | All 43 `@std` packages with latest version, stability, runtimes and a checked import; the versioning policy; import forms; use from npm | verified |

## References
- [JSR documentation](https://jsr.io/docs/introduction) — JSR project, living. Backs: subtopic scope.
- [Deno Standard Library (@std)](https://docs.deno.com/runtime/reference/std/) — Deno project, living. Backs: subtopic scope.

## Related
- `deno/deno-lab-setup.md` — the lab every output in these docs came from.
- `deno/modules/dependency-management.md` — adding, locking and updating dependencies.
- `deno/releases-stability-and-support.md` — Deno's support timeline, including JSR after the Cloudflare announcement.
