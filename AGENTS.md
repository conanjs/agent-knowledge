# agent-knowledge: rules for working in this repo

- **Knowledge base (`knowledge/`):** every new doc follows `frameworks/knowledge/schemas/_system.md`: a typed `knowledge-doc/v1`, or a free-form `deep-dive/v1` for "deep dive" or "thorough" requests, later synthesized into typed docs. Docs without a `schema:` key are legacy: never retrofit them.
- **Before committing** any change under `knowledge/`, and always for text drafted in another AI chat: use the `review-knowledge-doc` skill (`plugin/skills/review-knowledge-doc/SKILL.md`).
- **Research runs (`research/<topic>/<slug>/`):** written only through the `research-knowledge` skill (`frameworks/knowledge/research.md`); the format is `frameworks/knowledge/schemas/research-run.schema.md`. Never delete a claim or an experiment: mark it superseded. Commit a run together with the doc it backs.
- **Checks:** `pnpm run verify-before-commit` (the validator over `knowledge/`, then the tools' scenarios under `frameworks/knowledge/tools/*/tests/`; a research run also needs `pnpm run research -- validate research/<topic>/<slug>`); run it before committing.
