---
schema: topic-index/v1
kind: topic
topic: security
last-updated: 2026-11-23
---

# Security

Security covers how an application keeps tokens and credentials safe: where a browser-based app stores them, how it ends them before they expire, and which attacks each choice resists. It does not cover cluster access control (`kubernetes/security/`) or browser storage APIs in general (`javascript/browser/`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [jwt-storage-and-revocation-deep-dive.md](jwt-storage-and-revocation-deep-dive.md) | deep-dive | Where a browser-based app keeps JWT access and refresh tokens against XSS and CSRF, and how it ends a token before `exp`: backend-for-frontend, cookie attributes, refresh token rotation, revocation and denylists | verified |

## References
- [RFC 7519: JSON Web Token (JWT)](https://www.rfc-editor.org/rfc/rfc7519) — IETF, 2015. Backs: topic scope.

## Related
- `kubernetes/security/index.md` — RBAC, service accounts and Pod Security inside a cluster.
- `web-apis/index.md` — HTTP API design and HTTP versions.
- `javascript/browser/browser-platform-deep-dive.md` — browser storage and cookies.
