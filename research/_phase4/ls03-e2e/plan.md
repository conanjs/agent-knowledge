# Plan: JWT storage and revocation in web applications

## Question
V's request: "Security architecture for storing and revoking JWTs in web applications."

Working question: in a web application (a browser front end talking to one or more HTTP back ends), where should JSON Web Tokens (JWTs) used as access and refresh tokens be kept so that cross-site scripting (XSS) and cross-site request forgery (CSRF) cannot steal or misuse them, and how can such a token be invalidated before its `exp` time (logout, password change, theft)? What do the standards require, what do practitioners build, and what goes wrong?

## Sub-questions, one per profile

### taxonomy
Define the terms the other workers will search with, as the standards name them: JWT, JWS and JWE; the registered claims that matter for revocation (`exp`, `nbf`, `iat`, `jti`, `aud`); access token, refresh token, bearer token; self-contained (by-value) versus reference (by-handle) tokens; token revocation (RFC 7009) and token introspection (RFC 7662); denylist / blocklist; refresh token rotation and reuse detection; sender-constrained tokens (DPoP, RFC 9449; mutual-TLS-bound tokens, RFC 8705); browser-based app architectures: Backend-for-Frontend (BFF), token-mediating backend, browser-only client; cookie attributes `HttpOnly`, `Secure`, `SameSite` and the `__Host-` prefix. Must find: the defining source (Rank 1 or 3) for each term, and the name a standard uses where blogs use several.

### ground-truth
Find the normative rules: what RFC 7519 (JWT), RFC 8725 (JWT Best Current Practices), RFC 9700 (OAuth 2.0 Security Best Current Practice), RFC 7009, RFC 7662, RFC 9449 (DPoP), RFC 6749 / OAuth 2.1 draft and the IETF draft "OAuth 2.0 for Browser-Based Applications", plus the cookie specification (RFC 6265 / 6265bis), say with MUST / SHOULD / MAY about: where a browser-based client may keep tokens, refresh token rotation or sender-constraining for public clients, token lifetimes, validating `exp` / `aud` / `alg`, what a revocation endpoint must do and what it does to self-contained tokens, and cookie attributes. Must find: the exact clause, its modal verb and its conditions.

### practitioner
Find how teams build it in practice, with concrete settings: OWASP cheat sheets (JSON Web Token, Session Management, HTML5 Security / local storage), identity-provider docs (for example Auth0 / Okta refresh token rotation and reuse detection, Curity token handler, Duende BFF), and framework docs. Must find: the reference architectures (BFF with a session cookie; access token in memory plus refresh token in an `HttpOnly` cookie; short-lived access token plus a `jti` denylist), with their real values (token lifetimes, cookie attributes, denylist storage and expiry) and one concrete request/response or configuration example each.

### pitfall
Find what breaks and why: token theft from `localStorage` / `sessionStorage` through XSS; CSRF when tokens ride in cookies; the claim that a self-contained JWT cannot be revoked before `exp` without server-side state; logout that only deletes the client copy; refresh token replay; `alg: none` and algorithm confusion; denylist growth and cache consistency; clock skew; the "stateless JWT sessions" critique. Must find: documented attacks, advisories or Common Vulnerabilities and Exposures (CVE) entries, and the stated reason each one happens, plus where sources disagree (for example "in memory is safe" versus "XSS can still use the token").

## Out of scope
- The OAuth authorization code flow and Proof Key for Code Exchange (PKCE) step by step, beyond what storage and revocation need; OpenID Connect ID token validation details.
- Native mobile and desktop token storage (Keychain, Android Keystore), and server-to-server (machine) tokens.
- Signing-key management and JSON Web Key Set (JWKS) rotation, except as a way to invalidate all tokens at once if sources cover it.
- General XSS prevention (Content Security Policy and output encoding) beyond its role in token theft; password storage; passkeys / WebAuthn; JWT library comparisons.

## What knowledge/ already covers (link, do not repeat)
- `knowledge/javascript/browser/browser-platform-deep-dive.md` §7: `localStorage` / `sessionStorage` behaviour, `document.cookie`, and "keep secrets out of web storage; use `HttpOnly`, `Secure`, `SameSite` cookies for sessions".
- `knowledge/javascript/browser/network-requests-in-depth.md`: the `fetch` `credentials` option and cross-origin cookies with `Access-Control-Allow-Credentials`.
- `knowledge/ai-agents/model-context-protocol.md` §3.5: OAuth 2.1 roles, bearer tokens in the `Authorization` header (never the query string), audience validation, refresh token confidentiality (for MCP servers).
- `knowledge/kubernetes/security/rbac-and-service-accounts.md`: a decoded service-account JWT and bound tokens (a non-browser example).
- `knowledge/gcp/gke-lens-setup.md` (legacy): an access-token / refresh-token split in a CLI tool.

## Run settings
- `topic:` `web-apis` (HTTP-facing contracts; no security folder exists yet).
- `MODE`: `full-verified`.
- `CAP`: 4 sources per profile.
- Seeds: none supplied by V; workers search from the sub-questions.

## Token estimate
- Workers: 4 x about 135k = about 540k.
- Judge: up to 80 claims x about 2,600 = about 210k per round; 1 round expected, up to 3 with 2 patch rounds (about 630k).
- Orchestrator (reading passages, writing, checks): about 200k to 300k.
- Total: about 0.95M to 1.05M with one judge round; up to about 1.5M if both patch rounds run.

**Approved by V, 2026-11-22.** Runs after SE-02, once V has seen SE-02's token cost.
