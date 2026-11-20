# agent-knowledge: rules for working in this repo

- **Knowledge base (`knowledge/`):** every new doc follows `frameworks/knowledge/schemas/_system.md`: a typed `knowledge-doc/v1`, or a free-form `deep-dive/v1` for "deep dive" or "thorough" requests, later synthesized into typed docs. Docs without a `schema:` key are legacy: never retrofit them.
- **Before committing** any change under `knowledge/`, and always for text drafted in another AI chat: use the `review-knowledge-doc` skill (`plugin/skills/review-knowledge-doc/SKILL.md`).
- **Checks:** `npm run check` (the validator, then the scenarios in `tests/`); run it before committing.
