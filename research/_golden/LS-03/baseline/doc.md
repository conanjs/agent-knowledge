---
schema: deep-dive/v1
topic: security
status: draft
applies-to: ["OAuth 2.0 and OpenID Connect web apps (RFC 9700 · RFC 10017)", "JWT per RFC 7519 with HS256 or ES256 signatures", "browsers measured: Chromium 152 and Chrome 158 on macOS", "server-side lab: Node.js 24.22.1", "sources read 2026-11-22"]
last-updated: 2026-11-22
last-verified: 2026-11-22
synthesized-into: []
tags: [jwt, oauth, openid-connect, revocation, logout, refresh-token-rotation, bff, cookies, xss, csrf, dpop, token-status-list, denylist]
---

# Storing and revoking JWTs in web applications: security architecture

## Summary
**TL;DR:** A signed JWT (JSON Web Token) is accepted because its signature checks out, so a server cannot take it back: a logout, a password change or a ban stops a token only if every server that accepts it also consults some state (a denylist, a version counter, introspection, a status list or a server-side session), or when the token expires. Where the browser keeps the token decides what injected JavaScript can do: any place a script can read lets it copy tokens, while an `HttpOnly` cookie held by a backend-for-frontend (BFF) stops copying but not using the session from inside the victim's browser. The strongest common design is a BFF that keeps all tokens server-side behind a `__Host-Http-` session cookie, short-lived access tokens, rotated or sender-constrained refresh tokens, and revocation keyed on signed claims (`jti`, `sid`, a version number), never on the token's raw bytes.
**Use this when:** designing login, logout and "log out everywhere" for a single-page or server-rendered web app that uses OAuth 2.0, OpenID Connect or self-issued JWTs; choosing where the browser keeps tokens; implementing refresh-token rotation; reviewing a JWT denylist; explaining why a "logged-out" token still works.
**Depth:** the seven actors, and every token, claim, cookie attribute and refresh-token setting with its default and unset behaviour; the four attack scenarios of RFC 10017 against eight browser storage options and four architectures; thirteen revocation mechanisms with delay, cost and failure mode; cross-side interactions; one full pass through a BFF (login, API call, refresh, "log out everywhere") with real HTTP artifacts and a timeline; an edge-case and failure matrix; two local labs (a Node.js revocation lab and a Chromium cookie and storage lab) with captured output; verified and unverified claim marks throughout.

## 1. Context: one problem with two halves

### 1.1 What a JWT is, and why it resists revocation

A **JWT** is a small JSON document with a signature, written as three base64url pieces joined by dots: `header.payload.signature`. Base64url is base64 with `-` and `_` instead of `+` and `/`, and no `=` padding. The payload holds **claims**: named facts such as who the token is about (`sub`), who issued it (`iss`), and when it stops being valid (`exp`).

Analogy: a festival wristband with a tamper-proof seal. The gate staff check the seal, not a guest list. To throw someone out before the festival ends, every gate needs a list of cancelled wristbands; otherwise the wristband works until the date printed on it.

The concrete artifact, a decoded access token:

```json
{ "alg": "ES256", "typ": "at+jwt", "kid": "2026-11-key-a" }
{
  "iss": "https://as.example",
  "sub": "user-4821",
  "aud": "https://api.example",
  "client_id": "web-bff",
  "iat": 1795338000,
  "exp": 1795338900,
  "jti": "b3f1c2e0-6a7d-4a8e-9a51-2f0c7d1e9b44",
  "sid": "sess-77a1",
  "scope": "orders:read"
}
```

`iat` 1795338000 is 2026-11-22T09:00:00Z; `exp` is 900 seconds (15 minutes) later, 2026-11-22T09:15:00Z. The time values are a **NumericDate**: seconds since 1970-01-01T00:00:00Z, fractions allowed ✅[^1]. `alg` names the signature algorithm: ES256 is ECDSA (Elliptic Curve Digital Signature Algorithm) on the P-256 curve with SHA-256, a public-key signature; HS256, used in the lab, is HMAC (hash-based message authentication code) with SHA-256, a shared-secret signature.

What the standards say about these claims (an RFC, "Request for Comments", is a numbered standard of the IETF, the Internet Engineering Task Force):

- A token must not be accepted on or after its `exp`; verifiers may allow a small clock-skew leeway, usually no more than a few minutes ✅[^1].
- `jti` is a unique identifier, assigned so that two tokens almost never share one, and meant for replay prevention ✅[^1].
- Every registered claim is optional in RFC 7519 itself ✅[^1]; the JWT access-token profile, RFC 9068, makes `iss`, `exp`, `aud`, `sub`, `client_id`, `iat` and `jti` required and asks for `typ: at+jwt`, which resource servers must check ✅[^21].
- If any validation step fails, the JWT must be rejected ✅[^1].

Nothing in that list involves the issuer at verification time. That is the point of a JWT, and the cause of the revocation problem. The lab reproduces it: a token copied before logout was still accepted 60 seconds after the logout, and rejected only after its `exp` ✅[^24].

```text
2026-11-22T09:00:00.100Z issued access token, exp in 900 s
2026-11-22T09:00:00.100Z user clicks "log out" (client deletes its copy; server keeps no state)
2026-11-22T09:01:00.100Z attacker replays the copied token -> ACCEPTED
2026-11-22T09:16:00.100Z same token after exp -> rejected: expired
```

A plain access token is also a **bearer token**: it works for whoever presents it, like cash. Sender-constrained tokens (section 6.11) are the exception: they also need a private key the thief does not have ✅[^2].

### 1.2 The two questions

1. **Storage:** who can copy the token, and who can use it without copying it?
2. **Revocation:** once the system decides an access must end, how long until every server that accepts the token refuses it, and what does each request pay for that check?

They are linked. Short access-token lifetimes make revocation of access tokens matter less, which moves the risk to the long-lived **refresh token**: it carries the client's full grant and is not tied to one API, so a stolen, replayable refresh token lets an attacker mint new access tokens ✅[^3].

## 2. Actors, tokens and settings

### 2.1 Seven actors

**7 actors:**
- **Browser** — its job: keep cookies and attach them to matching requests, via its cookie store; run page scripts, via its JavaScript engine.
- **Frontend code** (a single-page application, SPA, or server-rendered pages with scripts) — its job: show the interface and call APIs, via `fetch`.
- **Injected script** (attacker code that got onto the page through XSS, cross-site scripting) — its job: act as the frontend, via the page origin's own privileges.
- **Backend-for-frontend (BFF)** — its job: run the OAuth flows as a confidential client and hold the tokens, via its server-side session store; forward API calls, via a proxy route.
- **Authorization server (AS)**, called the OpenID provider (OP) in OpenID Connect (OIDC) — its job: issue tokens, via its token endpoint; end them, via revocation, introspection, logout notifications and status lists.
- **Resource server (RS)**, the API — its job: accept or refuse each request, via signature and claim checks plus any revocation lookup.
- **Revocation state store** — its job: remember what was revoked for as long as it still matters, via a key-value store with per-key expiry or a published status list.

```text
                 ┌─────────────── browser (one origin: https://app.example) ───────────────┐
                 │  cookie store  ──attaches cookies──►  requests to app.example           │
                 │  frontend JS   ──fetch()──────────►  /api/* , /auth/*                   │
                 │  injected JS   (same powers as frontend JS)                             │
                 └───────────────────────────────┬─────────────────────────────────────────┘
                                                 │ HTTPS (network)
                                   ┌─────────────▼─────────────┐
                                   │ BFF (confidential client) │── session store (sid → tokens)
                                   └──────┬─────────────┬──────┘
                       token, revoke      │             │  Authorization: Bearer <access token>
                 ┌────────────────────────▼──┐      ┌───▼────────────────────────┐
                 │ authorization server (AS) │      │ resource server (RS, API)  │── revocation store
                 │ token, revoke, introspect │◄─────│ verify signature + claims  │   (denylist, versions,
                 │ back-channel logout       │ opt. │ + optional state lookup    │    status list cache)
                 └───────────────────────────┘      └────────────────────────────┘
```

### 2.2 Tokens and their lifetimes

| Token | Who holds it, who receives it | Lifetime and default | When it is not used | Evidence |
|---|---|---|---|---|
| Access token | Client holds; RS receives on every call | No standard value; RFC 10017 recommends reducing it and renewing with refresh tokens. Minutes are common in practice | — | ✅[^2]; "minutes are common" ⚠️ unverified |
| Refresh token | Client holds; only the AS receives it | Set by the AS. One vendor's rotation default: 30 days absolute, at most 1 year, and rotation does not extend it | Without one, the client re-runs the authorization flow, possibly silently with the AS session cookie | ✅[^15] ✅[^3] |
| BFF session cookie | Browser holds; BFF receives | Should match the refresh token's maximum lifetime; when the refresh token dies, the BFF should end the session | — | ✅[^2] |
| Logout token | AS sends to each client's back-channel URL | One-shot JWT with `iss`, `aud`, `iat`, `exp`, `jti`, `events`, and `sub` or `sid`; `nonce` forbidden | Without back-channel logout, a client learns of a logout at the AS only when it next talks to the AS, for example at refresh | ✅[^9]; "next talks to the AS" ⚠️ unverified |
| DPoP proof | Client creates per request; AS or RS receives | Short; bound to method (`htm`), URL (`htu`), time (`iat`), access-token hash (`ath`) and optional server nonce | Without it, the token is a plain bearer token | ✅[^11] |

DPoP is "Demonstrating Proof of Possession" (RFC 9449). Section 6.11 explains it.

### 2.3 Claims that revocation depends on

| Claim | What it carries | If absent | Evidence |
|---|---|---|---|
| `exp` | Expiry instant | Nothing in the token ever ends it; the verifier's policy must then require `exp` | optional in RFC 7519 ✅[^1]; required in RFC 9068 ✅[^21] |
| `iat` | Issue instant, seconds | A "revoke everything issued before T" rule has nothing to compare (section 6.3) | ✅[^1] |
| `jti` | Unique token id | No per-token denylist key; fall back to `sid` or a version | ✅[^1] ✅[^4] |
| `sid` | Login-session id | No way to end one device's session without ending all of them | used by back-channel logout ✅[^9] |
| `ver` (custom name) | User's token generation number | No cheap "log out everywhere" | lab ✅[^24] |
| `cnf.jkt` | Thumbprint of the client's DPoP public key | Token is a bearer token | ✅[^11] |
| `status` | `{ "status_list": { "idx": 6, "uri": "https://…" } }`: where to look up this token's status | No issuer-side status lookup | ✅[^8] ✅[^4] |

### 2.4 Cookie attributes

A cookie's attributes decide which scripts can read it and which requests carry it. Analogy: a hotel key card that the front desk programmed (the server) and the guest carries (the browser); `HttpOnly` means the guest cannot read the card's chip, but it still opens the door for anyone who holds the guest's hand to the reader.

| Attribute | Effect | Default when unset | Evidence |
|---|---|---|---|
| `HttpOnly` | `document.cookie` cannot read it; it is still sent on `fetch` and `XMLHttpRequest` | Readable by any script on the page | ✅[^12]; lab: `plain=p1` was readable, `__Host-Http-sid` was not, yet both reached the server on `fetch` ✅[^25] |
| `Secure` | Sent only over `https:`; `http://localhost` is exempt | Sent over plain HTTP too | ✅[^12] |
| `SameSite` | `Strict`: same-site requests only. `Lax`: also cross-site top-level `GET` navigations. `None`: always, needs `Secure` | Some browsers treat it as `Lax` | ✅[^12] |
| `Path` | Limits which paths receive it | The request URL's directory; not a security boundary | ✅[^12] |
| `Domain` | Shares the cookie with subdomains | Host-only (only the exact host) | ✅[^12] |
| `Max-Age` / `Expires` | Lifetime; `Max-Age` wins; `0` deletes | Session cookie | ✅[^12] |
| `__Host-` name prefix | Browser stores it only with `Secure`, no `Domain`, `Path=/` | — | ✅[^12]; lab: a `__Host-` cookie with `Domain=` and one without `Secure` were both dropped ✅[^25] |
| `__Host-Http-` name prefix | `__Host-` rules plus `HttpOnly`, so only a `Set-Cookie` header can set it | — | ✅[^12]; lab: a `__Host-Http-` cookie without `HttpOnly` was dropped ✅[^25] |

Browsers that do not know a prefix accept the cookie anyway ✅[^12], so a prefix hardens supporting browsers and is not a check the server can rely on.

### 2.5 Refresh-token settings

| Setting | What it does | Default and unset behaviour | Evidence |
|---|---|---|---|
| Rotation | Each refresh returns a new refresh token and invalidates the old one | For public clients (no client secret, such as an SPA), the AS must use rotation or sender-constraining; unset, the same refresh token works until it expires | ✅[^3] |
| Reuse detection | Presenting an already-used refresh token revokes the active one; one vendor revokes the whole "family" descending from the original | Part of rotation in RFC 9700 | ✅[^3] ✅[^14] |
| Reuse leeway ("rotation overlap") | Accepts the immediately previous token again for a short time, for retries and races | One vendor: disabled by default; inside the window there is no breach detection, but only the token that was just replaced is accepted, and presenting an older one still triggers detection | ✅[^15] |
| Absolute lifetime | Hard end of the grant | Vendor default 30 days with rotation | ✅[^15] |
| Inactivity expiry | Ends a refresh token not used for a while | RFC 9700: should exist; length is the AS's choice | ✅[^3] |
| Revoke on security events | Ends refresh tokens on password change or logout at the AS | Optional ("may") | ✅[^3] |

## 3. Threat model: what injected JavaScript can do

RFC 10017, "OAuth 2.0 for Browser-Based Applications" (published August 2026 as part of BCP 212, a Best Current Practice), names four things malicious JavaScript can do ✅[^2]:

| Scenario (RFC 10017 §) | What the injected script does | Stopped by short lifetimes or rotation? |
|---|---|---|
| Single-execution token theft (5.1.1) | Runs once, sends the current tokens to the attacker | Partly: short lifetimes, rotation and sender-constraining limit it ✅[^2] |
| Persistent token theft (5.1.2) | Keeps running and re-sends the newest tokens, for example every 10 seconds | No: rotation alone does not stop it ✅[^2] |
| Acquisition of new tokens (5.1.3) | Runs its own silent authorization flow in a hidden iframe, using the user's session at the AS | No practical client-side defence; DPoP does not help either ✅[^2] |
| Proxying requests through the browser (5.1.4) | Calls the APIs from the victim's browser, as the app would | Application-level measures cannot prevent it ✅[^2] |

The central consequence: the attacker's code is indistinguishable from the app's code, so it can always ask for fresh tokens the way the app does; storage choices only decide whether it can take tokens that already exist ✅[^2].

A second, separate threat is **infostealer malware** on the user's computer, which copies the browser's cookie store, including `HttpOnly` cookies, and replays it from another machine ✅[^19]. Device-bound session credentials (section 6.13) target that one.

## 4. Where the browser can keep a token

| Storage | Readable by injected script? | Sent automatically? | Survives reload / shared between tabs | RFC 10017 position | Evidence |
|---|---|---|---|---|---|
| JavaScript-set cookie | Yes | Yes, to the app's own server too | Yes / yes | Not recommended (§8.1) | ✅[^2] |
| `HttpOnly` cookie set by a backend | No | Yes, also on `fetch` from injected script | Yes / yes | The BFF's mechanism (§6.1.3.2) | ✅[^2] ✅[^12]; lab ✅[^25] |
| `localStorage` | Yes | No | Yes / yes, whole origin | One of the persistent stores; none stops exfiltration (§8.5) | ✅[^2] ✅[^13]; lab ✅[^25] |
| `sessionStorage` | Yes | No | Yes / no, per tab | Slightly smaller exposure (§8.5) | ✅[^2] ✅[^13] |
| IndexedDB | Yes | No | Yes / yes, also shared with service workers | Persistent store (§8.5) | ✅[^2] |
| In memory (a variable or closure) | Hard, not impossible: replacing built-ins such as `toString` can capture it | No | No / no | Lost on reload; closures fall to prototype poisoning (§8.4) | ✅[^2] |
| Web Worker or Service Worker memory | Not directly; the page must ask the worker | No | Worker-dependent | Isolated, but the attacker can still run its own flow; a service worker must not keep tokens in storage shared with the page (§8.2, §8.3) | ✅[^2] |
| Non-extractable WebCrypto (Web Cryptography API) key, for DPoP | The key bytes, no; using the key, yes | No | Yes if kept in IndexedDB | Best option for a DPoP key (§9.2) | ✅[^2]; lab: `exportKey` refused with `InvalidAccessError`, yet a script loaded the key from IndexedDB and signed with it ✅[^25] |

The lab page ran this from its own JavaScript, the position an XSS payload runs in, in Chromium 152 (the Claude desktop app's browser) and Chrome 158 headless ✅[^25]:

```text
"documentCookie": "__Host-readable=r1; plain=p1",
"localStorageToken": "eyJhbGciOiJIUzI1NiJ9.demo.sig",
"cookieHeaderSeenByServerOnFetch": "__Host-Http-sid=s3cr3t; __Host-readable=r1; plain=p1",
"exportPrivateKey": "refused: InvalidAccessError",
"signWithKeyLoadedFromIndexedDB": "signed 64 bytes; extractable=false"
```

Read it as two different powers. **Copying** (taking a secret away to use later from anywhere) is blocked by `HttpOnly` and by non-extractable keys. **Riding** (using the secret from inside the victim's browser while the page is open) is not blocked by anything in this table: the `HttpOnly` cookie went out on the injected `fetch`, and the non-extractable key still signed. Copying is the worse outcome, because the attacker keeps access after the tab closes.

## 5. Architectures

RFC 10017 presents three patterns in decreasing order of security ✅[^2]. A fourth, common hybrid is analysed after them.

### 5.1 Backend-for-frontend (BFF)

A server-side component on the app's own origin is the OAuth client. It keeps every token in a server-side session and proxies API calls, adding the access token itself; the browser never sees a token ✅[^2]. Analogy: a coat check. The guest holds a numbered ticket (the session cookie); the valuable coat (the tokens) never leaves the cloakroom.

Rules for the session cookie ✅[^2]:

- must be `Secure` and `HttpOnly`;
- should be `SameSite=Strict`, `Path=/`, no `Domain`, with a name prefix such as `__Host-Http-`;
- if the session itself is stored in the cookie (no server store), its contents should be encrypted.

```http
Set-Cookie: __Host-Http-sid=Yz3k9QxW2b7LhT0aNf8EeR4uJm1pVc6s; Secure; HttpOnly; Path=/; SameSite=Strict
```

Cross-site request forgery (CSRF), where another site makes the browser send a request that carries the cookie, needs a defence ✅[^2]:

- `SameSite=Strict` alone is enough only if no other application shares the same site; a subdomain takeover reopens CSRF.
- The CORS (cross-origin resource sharing) approach: require a fixed custom header on every API request (for example `X-Requested-With: fetch`), because a cross-origin page cannot add a custom header without a preflight request that the BFF does not approve. The BFF must reject any request without that header, since some cross-origin requests (such as a body-less `POST`) need no preflight.
- Anti-forgery tokens (double-submit cookies) also work when done right.

What the BFF does and does not stop ✅[^2]:

- It stops single-execution theft, persistent theft and new-token acquisition (5.1.1 to 5.1.3): there are no tokens in the browser to take, and because the BFF is a confidential client, an authorization code that injected script obtains cannot be redeemed without the BFF's own credentials.
- It does not stop proxying (5.1.4): injected code can still call `/api/*`, and the cookie is attached. Only removing the malicious code ends that.

Revocation becomes simple for browser traffic: deleting the server-side session ends the cookie's power at the next request. The BFF refreshes tokens itself as a confidential client, and revoking the refresh or access token can end access to the API without ending the cookie session ✅[^2].

### 5.2 Token-mediating backend

A confidential backend runs the flow and keeps the refresh token, but hands the access token to the browser, which calls the APIs directly ✅[^2]. Refresh-token theft and new-token acquisition are mitigated; access tokens are exposed to theft by injected code; CSRF defences are needed on the endpoint that hands out access tokens; RFC 10017 says to use it only when a full BFF is not viable ✅[^2].

### 5.3 Browser-only OAuth client

The SPA is a public OAuth client and runs the whole authorization-code flow with PKCE (Proof Key for Code Exchange) itself; all four attack scenarios apply ✅[^2]. Its refresh tokens must be rotated or sender-constrained ✅[^3]. Storage follows section 4; no option prevents exfiltration once a script runs on the page ✅[^2].

### 5.4 The common hybrid: access token in memory, refresh token in an `HttpOnly` cookie

Many apps keep the access token in a JavaScript variable and let the server set the refresh token as an `HttpOnly` cookie limited to `Path=/auth/refresh`. Calling `POST /auth/refresh` returns a new access token in the response body.

What injected script can do here:

1. **Injected script → browser:** `fetch('/auth/refresh', { method: 'POST' })`. The browser attaches the `HttpOnly` cookie, as the lab showed for same-origin `fetch` ✅[^25].
2. **Server → injected script:** the response body holds a fresh access token, which the script reads and sends away.

So the refresh token cannot be copied, but access tokens can be minted on demand while the page is open. `Path=/auth/refresh` reduces where the cookie travels but is not a security boundary ✅[^12]. In effect this is a token-mediating backend (section 5.2) whose token endpoint is guarded by a cookie ⚠️ unverified (this mapping is analysis, not a statement in RFC 10017), and it needs the same CSRF defence on the refresh endpoint ✅[^2].

### 5.5 Self-issued JWTs as the session (no OAuth)

When one backend both issues and accepts the JWT, ask first whether a JWT is needed: a stateless JWT session needs a denylist to end, which removes the statelessness, and a plain server session may be simpler ✅[^4]. RFC 10017 §7.1 covers the same case, a frontend and backend on one domain with no need for OAuth, and points to a cookie-based session with the cookie rules of §6.1.3.2 ✅[^2].

### 5.6 Architecture against attack

| Attack (RFC 10017 §5.1) | BFF | Token-mediating backend | Browser-only client | Hybrid of 5.4 |
|---|---|---|---|---|
| Single-execution theft | mitigated ✅[^2] | access token exposed ✅[^2] | exposed ✅[^2] | access token exposed ⚠️ unverified |
| Persistent theft | mitigated ✅[^2] | access token exposed ✅[^2] | exposed ✅[^2] | access tokens on demand ⚠️ unverified |
| New-token acquisition | mitigated ✅[^2] | mitigated ✅[^2] | exposed ✅[^2] | depends on whether the AS session allows a silent flow ⚠️ unverified |
| Proxying through the browser | exposed ✅[^2] | exposed ✅[^2] | exposed ✅[^2] | exposed ✅[^25] |

## 6. Revocation mechanisms

**Revocation** here means: after a decision ("this user logged out", "this account is banned", "this token leaked"), servers start refusing the affected tokens before they expire. Analogy: recalling a product. You can wait until every unit's best-before date passes (expiry), put a recall list at every shop till (denylist), or have each till phone the manufacturer per sale (introspection).

### 6.0 Catalogue

| # | Mechanism | Ends | Worst-case delay after the decision | Cost per request at the RS | Main failure mode | Evidence |
|---|---|---|---|---|---|---|
| 6.1 | Expiry only | Every token, eventually | The token's full remaining lifetime | None | No real logout | ✅[^24] |
| 6.2 | Denylist on (`iss`, `jti`) | One token | Store replication delay plus any local cache time | One key lookup | Keying on token bytes is bypassable | ✅[^4] ✅[^24] |
| 6.3 | Cut-off time per user ("issued before T is invalid") | All of one user's tokens | Same as 6.2 | One lookup | Same-second tokens slip through or block re-login | ✅[^24] |
| 6.4 | Version (generation) counter per user | All of one user's tokens | Same as 6.2 | One lookup | Needs `ver` in every token | ✅[^24] |
| 6.5 | Session check (`sid` or a BFF session) | One login session | Same as 6.2 | One lookup | It is a session store under another name | ✅[^2] ✅[^9] |
| 6.6 | Introspection (opaque tokens) | One token | Introspection cache time | One call to the AS, or a cache hit | Cached answers stay "active" after revocation | ✅[^7] |
| 6.7 | Token Status List | One token | The list's `ttl` or HTTP cache time | Fetch and cache one compressed list per many tokens | Unique lists defeat privacy | ✅[^8] |
| 6.8 | Signing-key removal | Every token signed with that key | JWKS (JSON Web Key Set) cache time at each RS | None | Logs everyone out | ⚠️ unverified |
| 6.9 | Revocation endpoint (RFC 7009) | A refresh token, often its access tokens too | Immediate at the AS; self-contained access tokens live on unless the RS checks | At the AS only | RS never hears of it | ✅[^6] |
| 6.10 | Rotation with reuse detection | A refresh-token family | At the next refresh | At the AS only | Benign races log users out | ✅[^3] ✅[^24] |
| 6.11 | Sender-constraining (DPoP, mutual TLS, Transport Layer Security with client certificates) | Makes copies useless, revokes nothing | — | Proof check per request | No help against riding | ✅[^11] |
| 6.12 | Logout signals (OIDC back-channel logout, CAEP) | Sessions at other apps | Delivery time of one POST or event | None per request | Lost delivery | ✅[^9] ✅[^10] |
| 6.13 | Device-bound session cookies (DBSC) | Makes stolen cookies expire fast | Cookie lifetime (short) | Periodic refresh | Needs browser and site support | ✅[^19] |

### 6.1 Expiry only

Short access tokens limit how long a revoked grant can still be used ✅[^6], which is why most designs keep them to minutes and accept that window ⚠️ unverified. Worked number: with a 15-minute lifetime, a token issued at 09:30:00 and a logout at 09:40:00 leave a 5-minute window (until 09:45:00); a token issued at 09:39:59 leaves almost the full 15 minutes.

### 6.2 Denylist keyed on (`iss`, `jti`)

Store one entry per revoked token and drop it when the token would have expired anyway. Analogy: a stolen-cards list at a shop till; once a card's printed expiry passes, the till refuses it on its own and the list entry can go.

```text
SET deny:https://as.example:b3f1c2e0-6a7d-4a8e-9a51-2f0c7d1e9b44 1 EXAT 1795338900
```

- `EXAT` sets an absolute Unix expiry in seconds ✅[^17]; an `EXPIREAT` time already in the past deletes the key at once ✅[^16], so revoking an already-expired token stores nothing.
- Redis removes expired keys when they are read and by periodic random sampling; replicas wait for the primary's delete instead of expiring keys themselves ✅[^16].
- OWASP keys the entry on (`jti`, `iss`) and stores it with the token's `exp` ✅[^4].
- The entry's TTL (time to live, the seconds until the store deletes it) is therefore `exp` minus now; the lab prints it as "remaining TTL".
- Size is bounded by arithmetic: live entries ≤ revocations per second × longest remaining lifetime. At 2 revocations per second and 900-second tokens, that is at most 2 × 900 = 1,800 entries.

Lab output ✅[^24]:

```text
2026-11-22T09:16:30.100Z logout: denylist entry added, remaining TTL 869.9 s, size=1
2026-11-22T09:16:30.100Z alice token -> rejected: revoked (denylist)
2026-11-22T09:16:30.100Z bob token   -> ACCEPTED
2026-11-22T09:31:01.100Z after alice exp: denylist size=0 (entry no longer needed: exp check rejects) -> rejected: expired
```

**Never key the denylist on the raw token or its hash.** The same claims can be written as a different string that still verifies (**malleability**), so the revoked token comes back with a new hash ✅[^4] ✅[^5]. Analogy: a cheque for "100" rewritten as "100.00": same amount, different text, so a list of cancelled cheques that compares text misses it. Two causes:

- **Lenient base64url decoding.** A 32-byte HS256 signature is 43 base64url characters, 258 bits for 256 bits of data, so the last character carries 2 unused bits; lenient decoders also accept `=` padding and the `+`/`/` alphabet ✅[^5]. Node.js's `Buffer` decoder for `base64url` accepts the regular base64 alphabet by design ✅[^20]. In the lab, five altered strings of one HS256 token all verified with a lenient decoder, none was on the hash denylist, and a strict decoder that re-encodes and compares rejected all five ✅[^24].
- **ECDSA signatures.** If (r, s) is a valid ECDSA signature, so is (r, n − s), where n is the curve order; no private key is needed; EdDSA (the Edwards-curve signature family) is not affected ✅[^5]. The lab turned a real ES256 signature into its (r, n − s) twin, and Node.js 24 with OpenSSL 3.5.9 accepted both ✅[^24].

```text
variant ...aOa9NR  hash 325fd005fa399e93  in hash-denylist: false  lenient verify: VALID  strict verify: invalid (non-canonical base64url (trailing bits))  jti=jti-8
variant ...Oa9NQ=  hash 9e02a8f6d417cdf6  in hash-denylist: false  lenient verify: VALID  strict verify: invalid (non-base64url character or padding)  jti=jti-8
ES256 original (r, s)   hash d754e19a6322eef1 verify=true
ES256 malleated (r, n-s) hash 329a7e0295a714c9 verify=true  same claims, different token string: true
```

The author of the malleability write-up reports, among others, that PyJWT 2.13.0 accepted all three non-canonical forms and java-jwt 4.5.2 accepted padding and trailing bits; those library results were not re-tested here ✅[^5]. The OWASP cheat sheet itself used to hash the token for its denylist and switched to `jti`-based keys in June 2026 ✅[^5] ✅[^23].

### 6.3 Cut-off time per user, and the same-second bug

"Reject every token of this user with `iat` before T" looks like a cheap "log out everywhere". But `iat` is usually a whole number of seconds ⚠️ unverified (the lab's issuer rounds down, as many libraries do), and a login can happen in the same second as the logout. The lab ✅[^24]:

1. **09:00:00.100, AS:** issues T1 (later stolen), `iat` = 1795338000.
2. **09:00:00.400, app:** "log out everywhere" stores cut-off 1795338000.
3. **09:00:00.700, AS:** the user logs in again; T2 gets `iat` = 1795338000 too.
4. **RS, rule `iat < cut-off`:** T1 accepted (the stolen token survives), T2 accepted.
5. **RS, rule `iat <= cut-off`:** T1 rejected, but T2 rejected as well (the fresh login fails until the next second).

```text
rule "reject iat <  cutoff": T1 (stolen, should die) -> ACCEPTED ; T2 (fresh login) -> ACCEPTED
rule "reject iat <= cutoff": T1 (stolen, should die) -> rejected ; T2 (fresh login) -> rejected
rule "ver must equal user.tokenVersion": T1(ver=1) -> rejected ; T2(ver=2) -> ACCEPTED
```

NumericDate allows fractions ✅[^1], so millisecond `iat` would fix the comparison only if every issuer and library keeps the fraction ⚠️ unverified. A counter (6.4) avoids clocks entirely.

### 6.4 Version (generation) counter

Each user record holds `tokenVersion`; each token carries `ver`; "log out everywhere" increments the counter; the RS refuses tokens whose `ver` is not current. The last lab line above shows T1 (`ver` 1) refused and T2 (`ver` 2) accepted ✅[^24]. The cost is one lookup per request, the same as a session check, usually cached for a few seconds ⚠️ unverified.

### 6.5 Session check (`sid` or BFF session)

Put the login-session id (`sid`) in the token and have the RS check that the session still exists, or, in a BFF, just look up the cookie's session. OIDC back-channel logout identifies sessions by `sid` or by `iss` + `sub` ✅[^9]. This is a server session again; that is fine, because "ends at once" requires state somewhere.

### 6.6 Introspection and the phantom-token pattern

With opaque (reference) tokens the RS asks the AS on each request: `POST /introspect token=…`, answered by `{"active": true, …}` or only `{"active": false}` for revoked, expired or unknown tokens; the RS must authenticate to the AS ✅[^7]. Caching answers reduces load but means a token revoked inside the cache window is still accepted; a response must not be cached beyond its `exp` ✅[^7]. In the phantom-token pattern the browser gets an opaque token and an API gateway exchanges it for a JWT for the internal APIs, caching the JWT ✅[^18]; revocation then takes effect at the gateway after its cache entry expires ⚠️ unverified (the pattern's description does not cover revocation).

### 6.7 Token Status List

Analogy: a printed seating chart at the stadium door with one tick box per seat; the usher looks up seat 6 without telling the ticket office who asked. The issuer publishes a signed, compressed bit array (DEFLATE, the zlib compression format); each token carries an index into it (`status.status_list.idx`) and its URL; 1, 2, 4 or 8 bits per token give values such as 0 VALID, 1 INVALID and 2 SUSPENDED; relying parties validate the token first, then check the list, cached for the list's `ttl` or `exp` ✅[^8]. Many tokens share one list ("herd privacy"), so the issuer cannot tell which token is being checked; per-token lists would defeat that ✅[^8]. The OWASP cheat sheet recommends it for issuer-side revocation ✅[^4]. Status on 2026-11-22: Internet-Draft 21, approved and in the RFC Editor's queue, not yet an RFC ✅[^8].

Worked size: at 1 bit per token, a list covering 1,000,000 tokens is 1,000,000 ÷ 8 = 125,000 bytes before DEFLATE compression, and mostly zeros, so it compresses well ⚠️ unverified (compression ratio not measured).

### 6.8 Signing-key removal

Removing a signing key from the issuer's JWKS makes every token signed with it fail once each RS refreshes its cached key set; it is a mass revocation for incidents such as a leaked key, not a logout tool ⚠️ unverified.

### 6.9 The revocation endpoint (RFC 7009)

The client posts `token=…&token_type_hint=refresh_token` with its client authentication; the AS answers `200` even for an invalid token ✅[^6]. Refresh-token revocation is required; access-token revocation is recommended; revoking a refresh token should also invalidate access tokens of the same grant when the AS supports that ✅[^6]. For self-contained access tokens, stopping them at the RS needs some non-standard link between AS and RS, which is why short lifetimes are paired with it ✅[^6].

### 6.10 Refresh-token rotation with reuse detection

Each refresh returns a new refresh token and invalidates the old one. If two parties hold the same token, one of them will present an invalidated token; the AS cannot tell which is the thief, so it revokes the active refresh token, and the real user logs in again ✅[^3]. Analogy: a single-use ticket at a turnstile; if a ticket that already went through is presented again, the operator cancels the whole booking.

The lab ran five cases ✅[^24]. In its output, RT1, RT2 … are the successive refresh tokens of one login, and RT2' is the one the thief received:

```text
-- D1: thief replays an old refresh token after the client rotated it
client refresh(RT1) -> new RT issued
thief  refresh(RT1) -> REFUSED: REUSE DETECTED -> whole family revoked
client refresh(RT2) -> REFUSED: family revoked
-- D2: thief uses the stolen token first
thief  refresh(RT1) -> new RT issued
client refresh(RT1) -> REFUSED: REUSE DETECTED -> whole family revoked
thief  refresh(RT2') -> REFUSED: family revoked
-- D3: persistent theft: thief copies the LATEST token, waits until the user closes the app
2026-11-22T09:10:06.700Z user closes the tab; the client never presents its last RT again
2026-11-22T10:10:06.700Z thief  refresh(latest RT) -> new RT issued
-- D4: benign race: two tabs refresh with the same RT at once (no leeway)
tab A  refresh(RT1) -> new RT issued
tab B  refresh(RT1) -> REFUSED: REUSE DETECTED -> whole family revoked
-- D5: same race with a 2 s leeway (overlap) window
tab A  refresh(RT1) -> new RT issued
tab B  refresh(RT1) -> new RT issued (reuse inside leeway window, allowed)
thief  refresh(RT1) 5 s later -> REFUSED: REUSE DETECTED -> whole family revoked
```

- D1 and D2: whoever is second triggers detection, and both lose.
- D3: rotation detects nothing when the legitimate client never presents its last token again, which is why RFC 10017 says rotation alone does not stop persistent theft ✅[^2]. An inactivity expiry, which RFC 9700 says refresh tokens should have ✅[^3], bounds this case: with a 30-minute inactivity limit, the thief's attempt one hour later would fail.
- D4 and D5: two tabs sharing one refresh token trip detection on their own; a leeway window fixes that and reopens a short window for a thief. A single-flight refresh across tabs, for example with the Web Locks API (`navigator.locks.request`, exclusive per origin across tabs and workers) ✅[^22], avoids the race without a leeway.

### 6.11 Sender-constrained tokens (DPoP)

Analogy: a bank card that also needs a PIN at every purchase; a copied card number alone buys nothing. The client holds a key pair. Each request carries a DPoP proof: a JWT with header `typ: dpop+jwt` and the public key, and claims `jti`, `htm` (method), `htu` (URL), `iat`, plus `ath` (hash of the access token) and the server's `nonce` when required ✅[^11]. The access token names the key's thumbprint in `cnf.jkt`, and the RS refuses a DPoP-bound token sent as a plain bearer token ✅[^11]. Public clients get refresh tokens bound to the same key ✅[^11].

```http
GET /orders HTTP/1.1
Host: api.example
Authorization: DPoP eyJhbGciOiJFUzI1NiIsInR5cCI6ImF0K2p3dCJ9...
DPoP: eyJ0eXAiOiJkcG9wK2p3dCIsImFsZyI6IkVTMjU2IiwiandrIjp7Imt0eSI6IkVDIi...
```

Limits ✅[^11]:

- With injected code in the client, DPoP's guarantees end: the code cannot copy a non-extractable key, but it can make proofs while the client is online (the lab's non-extractable key still signed ✅[^25]).
- Without a server nonce, an attacker can sign proofs with future `iat` values in advance and take them away with the token; `ath` limits such proofs to one access token's lifetime.
- A silent iframe flow can bind new tokens to the attacker's own key.

DPoP is therefore a defence against copying, not against riding, and it revokes nothing.

### 6.12 Telling other apps: back-channel logout and CAEP

- **OIDC back-channel logout:** analogy: the hotel's front desk phoning every restaurant where the guest ran a tab, server to server, instead of relying on the guest to walk past each one. The OP posts `logout_token=<JWT>` to each client's registered `backchannel_logout_uri`; the client validates it (signature, `iss`, `aud`, `iat`, `exp`, `events` containing `http://schemas.openid.net/event/backchannel-logout`, `sub` or `sid`, no `nonce`), ends the matching sessions, and answers `200` (or `204`); refresh tokens without `offline_access` should be revoked, those with it normally kept ✅[^9]. The OP should not resend except after a suspected recoverable failure ✅[^9], so a client that is down misses the logout. A decoded logout-token payload, with illustrative values:

  ```json
  {
    "iss": "https://as.example",
    "aud": "reports-app",
    "iat": 1795340400,
    "exp": 1795340520,
    "jti": "5c0b6f7e-1d2a-4f39-b0d4-8e2f1a7c9d11",
    "sid": "sess-91c4",
    "events": { "http://schemas.openid.net/event/backchannel-logout": {} }
  }
  ```

  This is the token the AS would send to another client, `reports-app`, for that client's own session `sess-91c4`. `iat` 1795340400 is 2026-11-22T09:40:00Z, the moment of the "log out everywhere" in section 8, and `exp` is two minutes later.
- **CAEP** (Continuous Access Evaluation Profile, on the Shared Signals Framework): defines events such as `session-revoked`, `credential-change` and `token-claims-change`; the version read is dated 2025-08-29 ✅[^10]. Whether that version is labelled Final was not confirmed ⚠️ unverified. The profile defines what the event means, not what the receiver must do ✅[^10].

### 6.13 Device-bound session credentials (DBSC)

Against malware that copies cookies, Chrome's DBSC has the browser create a per-session key pair in hardware (TPM, Trusted Platform Module, on Windows; Secure Enclave on macOS) and prove possession before the server issues new short-lived cookies; it reached public availability on Windows in Chrome 146, announced 2026-04-09 ✅[^19]. A stolen cookie then expires quickly. It is a browser-level form of sender-constraining for cookie sessions and needs the site to add registration and refresh endpoints ✅[^19].

## 7. Cross-side interactions

| Change on one side | Browser / frontend | BFF or client | AS | RS | Attacker | Evidence |
|---|---|---|---|---|---|---|
| Shorter access-token lifetime | More frequent refreshes | More refresh calls | More token-endpoint load | Revocation matters less | Stolen access tokens die sooner | ✅[^2] ✅[^6] |
| Turn on rotation | Tabs that share a refresh token race (D4) | Needs single-flight refresh or a leeway | Must store token families | — | Old copies trigger detection; the newest copy still works if never contested (D3) | ✅[^24] ✅[^3] |
| Add a reuse leeway | Fewer false logouts (D5) | — | Allows the previous token inside the window | — | Gets the same window | ✅[^15] ✅[^24] |
| Add a denylist or version check at the RS | — | — | — | One lookup per request; must decide what to do if the store is down | Revoked tokens die within cache time | ✅[^4]; outage policy ⚠️ unverified |
| Cache introspection or a status list longer | — | — | Less load | Fewer calls | Revoked tokens live up to the cache time | ✅[^7] ✅[^8] |
| BFF deletes a session | Next call is unauthenticated | Stops using that session's tokens | Unaware unless told (revoke or logout) | Unaware; the BFF simply stops calling | Proxying through the old cookie stops | ✅[^2] |
| User logs out at the AS | — | Gets a logout token if registered; ends sessions, revokes refresh tokens without `offline_access` | Sends back-channel logout | Self-contained access tokens remain valid until `exp` unless checked | — | ✅[^9] ✅[^6] |
| Password change | — | — | May revoke refresh tokens | Access tokens remain valid until `exp` unless checked | Loses refresh, keeps access briefly | ✅[^3] ✅[^6] |
| `SameSite=Strict` on the session cookie | A link from another site (an email, a chat) lands without the cookie, so the first page view looks logged out | Must handle that first unauthenticated hit | — | — | Cross-site forged requests carry no cookie | rule ✅[^12]; first-click effect ⚠️ unverified |
| DPoP turned on | Must keep a non-extractable key | Signs a proof per request | Binds tokens to the key | Checks proof, `ath`, `jkt` | Copies are useless; riding still works | ✅[^11] ✅[^2] |

## 8. Worked example: one full pass through a BFF

Setup: frontend and BFF on `https://app.example`, AS at `https://as.example`, API at `https://api.example`. Access tokens last 15 minutes, refresh tokens rotate, and the API checks a per-user version counter. All times are 2026-11-22, UTC.

```text
browser            BFF (app)                   AS                   RS (API)
    │                   │                       │                       │
    │ 1 GET /login      │                       │                       │
    │──────────────────►│                       │                       │
    │ 302 to the AS     │                       │                       │
    │◄──────────────────│                       │                       │
    │ 2 user signs in at the AS                 │                       │
    │──────────────────────────────────────────►│                       │
    │ 302 /callback?code=…                      │                       │
    │◄──────────────────────────────────────────│                       │
    │ GET /callback     │                       │                       │
    │──────────────────►│                       │                       │
    │                   │ 3 POST /token         │                       │
    │                   │──────────────────────►│                       │
    │                   │ access token + RT1    │                       │
    │                   │◄──────────────────────│                       │
    │                   │ 4 keeps tokens        │                       │
    │ Set-Cookie sid    │                       │                       │
    │◄──────────────────│                       │                       │
    │ 5 fetch /api/…    │                       │                       │
    │──────────────────►│                       │                       │
    │                   │ 6 GET /orders, Bearer <access token>          │
    │                   │──────────────────────────────────────────────►│
    │                   │                       │ verifies, ver == 7?   │
    │                   │ 200                   │                       │
    │                   │◄──────────────────────────────────────────────│
    │ 200               │                       │                       │
    │◄──────────────────│                       │                       │
```

Every arrow crosses the network; step 4 (the BFF writing its own session store) is the only local action.

1. **Browser → BFF (09:00:00):** `GET /login`. The BFF creates a PKCE verifier and `state`, stores them, and redirects to the AS.
2. **Browser ↔ AS:** the user signs in; the AS redirects to `https://app.example/callback?code=…&state=…`.
3. **BFF → AS (network, server to server):** `POST /token` with the code, the PKCE verifier and the client's credentials. The AS returns an access token (`ver` 7, `exp` 09:15:00) and refresh token RT1.
4. **BFF (local):** stores both tokens under a new random session id in its session store; answers with `Set-Cookie: __Host-Http-sid=…; Secure; HttpOnly; Path=/; SameSite=Strict`. No token reaches the browser.
5. **Frontend → BFF (09:05:00):** `fetch('/api/orders', { headers: { 'X-Requested-With': 'fetch' } })`. The browser attaches the cookie. The BFF checks the cookie's session and the custom header (the CSRF defence of section 5.1).
6. **BFF → RS (network):** `GET /orders` with `Authorization: Bearer <access token>`. The RS checks signature, `typ`, `aud`, `exp`, then `ver` 7 against its cached user record. `200`.
7. **BFF → AS (09:15:00):** the access token has expired; the BFF sends RT1 and receives a new access token and RT2. RT1 is now invalid.
8. **User, from a phone (09:40:00):** "log out everywhere".
    - **BFF (local):** deletes every session of `user-4821` in its store.
    - **BFF → AS (network):** revokes RT2 at the revocation endpoint; the AS answers `200`.
    - **App backend (local, user database):** increments `tokenVersion` from 7 to 8; the RS sees the new value when its cached user record refreshes.
    - **BFF → AS (network):** ends the user's sessions at the AS as well, for example through the AS's logout or admin interface ⚠️ unverified (no such interface is standardised by the sources above).
    - **AS → other clients (network):** because the AS sessions ended, sends back-channel logout tokens to every other app with a session for this user ✅[^9].
9. **Attacker with a stolen laptop (09:41:00):** the old cookie maps to no session, so the BFF answers `401`. An access token copied off the server would carry `ver` 7 and be refused by the RS.

When each credential stops working:

| Credential | Stops working at | Why |
|---|---|---|
| Session cookie on the stolen laptop | 09:40:00 | Session deleted in the BFF store |
| RT2 | 09:40:00 | Revoked at the AS (RFC 7009) ✅[^6] |
| Access token issued at 09:15:00 | 09:40:00 plus the version-cache time | `ver` 7 ≠ 8 at the RS |
| Same access token, if the RS checked only `exp` | 09:30:00 (its own expiry) | No state consulted |
| Sessions at other apps | When each back-channel POST arrives | Logout token ✅[^9] |

Swap in a browser-only SPA with tokens in `localStorage` and step 9 changes: an injected script could have copied RT2 earlier and, if the app never presents RT2 again, refreshed with it later (lab case D3 ✅[^24]); only the AS-side revocation in step 8 ends it.

## 9. Edge-case and failure matrix

| # | Situation | What happens | Mitigation | Evidence |
|---|---|---|---|---|
| 1 | Two tabs refresh with the same rotating token | Second request trips reuse detection; user logged out everywhere | Single-flight refresh (Web Locks) or a short leeway | ✅[^24] ✅[^22] ✅[^15] |
| 2 | Network drops the refresh response after the AS rotated | Client retries with the old token and trips detection | Leeway for the immediately previous token | ✅[^15] |
| 3 | Persistent XSS copies the newest refresh token and waits | Rotation detects nothing | Inactivity expiry, absolute lifetime, BFF | ✅[^24] ✅[^2] ✅[^3] |
| 4 | XSS calls APIs through the BFF | Works while the page is open | Fix the XSS; CSP (Content Security Policy) as a second layer | ✅[^2] ✅[^11] |
| 5 | XSS runs a silent authorization flow in an iframe | Gets fresh tokens, even bound to its own DPoP key | BFF; AS restrictions on silent flows | ✅[^2] ✅[^11] |
| 6 | Denylist keyed on SHA-256 of the token | Malleated copy passes | Key on (`iss`, `jti`); strict base64url; low-s ECDSA | ✅[^4] ✅[^5] ✅[^24] |
| 7 | Denylist entry expires before the token | Revoked token becomes valid again | Set the entry's expiry to the token's `exp` (`EXAT`) | ✅[^17]; consequence ⚠️ unverified |
| 8 | Denylist store unreachable | Fail open: revoked tokens pass. Fail closed: outage | Decide per API; keep a local cache | ⚠️ unverified |
| 9 | Logout and re-login in the same second with an `iat` cut-off | Stolen token survives, or re-login fails | Version counter | ✅[^24] |
| 10 | Clock skew between AS and RS | Fresh tokens look "not yet valid" or expired ones still pass | Leeway of at most a few minutes; synchronised clocks | ✅[^1] |
| 11 | Introspection answer cached | Revoked token accepted until the cache entry ends | Short cache; never past `exp` | ✅[^7] |
| 12 | Refresh token revoked, access token self-contained | Access token works until `exp` | Short lifetime or RS-side check | ✅[^6] |
| 13 | Back-channel logout POST lost (client down) | That app's session lives on | Bounded session lifetime; refresh-time checks | ✅[^9]; mitigation ⚠️ unverified |
| 14 | Infostealer copies the cookie store | `HttpOnly` cookies replayed from another machine | DBSC; short sessions | ✅[^19] |
| 15 | DPoP without server nonce | Pre-signed proofs with future `iat` work later | Require `DPoP-Nonce`; short access tokens | ✅[^11] |
| 16 | Access token returned in a URL (the deprecated implicit grant) | Leaks through browser history | Authorization code with PKCE; tokens only in headers or bodies | ✅[^2] |
| 17 | `__Host-` or `__Host-Http-` cookie set with a wrong attribute | Browser silently drops it; user never gets a session | Test cookie settings in each target browser | ✅[^12] ✅[^25] |
| 18 | JS-readable session cookie (no `HttpOnly`) | Script reads it with `document.cookie` | `HttpOnly`, or the `__Host-Http-` prefix to enforce it | ✅[^12] ✅[^25] |
| 19 | Verifier accepts any `alg`, including `none`, or confuses key types | Forged tokens pass; revocation is moot | Allow-list algorithms; choose keys by expected algorithm | ✅[^4] |

## 10. Recommended baseline

In order of impact:

1. **Prefer a BFF.** Tokens stay server-side; the session cookie is `__Host-Http-…; Secure; HttpOnly; Path=/; SameSite=Strict`; every API call needs a fixed custom header ✅[^2].
2. **If tokens must reach the browser,** keep access tokens in memory, keep refresh tokens out of page-readable storage (a worker at best), and make refresh tokens rotating or DPoP-bound ✅[^2] ✅[^3].
3. **Short access tokens** plus a revocation check where "log out" must be immediate: a per-user version counter for "everywhere", (`iss`, `jti`) or `sid` for one token or session, with entries expiring at the token's `exp` ✅[^4] ✅[^24].
4. **Refresh-token hygiene:** rotation with reuse detection, an inactivity expiry, an absolute lifetime, and revocation on password change and logout ✅[^3].
5. **Strict JWT parsing:** an algorithm allow-list, strict base64url, and never the token's bytes as a revocation key ✅[^4] ✅[^5].
6. **Tell the other apps:** back-channel logout or CAEP events, so a logout at the AS reaches every client ✅[^9] ✅[^10].
7. **Prevent the XSS in the first place:** every storage choice only limits damage once a script runs on the page ✅[^2].

## 11. Lab notes

| Lab | What it ran | Versions | Files |
|---|---|---|---|
| Revocation lab | Minimal HS256/ES256 JWT code with a simulated clock: stateless logout, (`iss`, `jti`) denylist with expiry, `iat` cut-off vs version counter, rotation with reuse detection (five cases), malleability of base64url and ECDSA signatures | Node.js v24.22.1, OpenSSL 3.5.9, macOS arm64; 2026-11-22 | `experiments/jwt-revocation-lab.mjs`, `experiments/jwt-revocation-lab.output.txt` |
| Cookie and storage lab | A local server sets six cookies (valid and invalid prefixes); the page reads `document.cookie` and `localStorage`, calls `fetch`, and tests a non-extractable WebCrypto key stored in IndexedDB | Chromium 152.0.7977.167 (Claude desktop app browser), Chrome 158.0.8127.37 headless; 2026-11-22 | `experiments/cookie-visibility-server.mjs`, `experiments/cookie-visibility.output.txt` |

To rerun: `node experiments/jwt-revocation-lab.mjs`; `node experiments/cookie-visibility-server.mjs 8787`, then open `http://localhost:8787/` and, afterwards, `http://localhost:8787/clear` to remove the lab's cookies, storage and database. In headless Chrome the IndexedDB step never completed, so that one result comes from Chromium 152 only ✅[^25].

## Verification status

- Verified: 218 claims (✅) · Unverified: 21 claims (⚠️) · Last verified: 2026-11-22.

## References

- [RFC 7519: JSON Web Token (JWT)](https://www.rfc-editor.org/rfc/rfc7519.html) — IETF, 2015. Backs: claim meanings (`exp`, `nbf`, `iat`, `jti`), NumericDate, optional claims, leeway, reject on failed validation. [^1]
- [RFC 10017: OAuth 2.0 for Browser-Based Applications](https://www.rfc-editor.org/rfc/rfc10017.html) — IETF (BCP 212), August 2026. Backs: attack scenarios §5.1, BFF §6.1 (cookie rules, CSRF, refresh and logout, threat analysis), token-mediating backend §6.2, browser-only client §6.3, single-domain apps §7.1, URL token leaks §7.2.3, token storage §8, reducing token authority and DPoP §9. [^2]
- [RFC 9700: Best Current Practice for OAuth 2.0 Security](https://www.rfc-editor.org/rfc/rfc9700.html) — IETF (BCP 240), January 2025. Backs: refresh-token threat and protection §4.14 (rotation, reuse detection, inactivity expiry, revocation on events), public-client rule §2.2.2. [^3]
- [JSON Web Token Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_Cheat_Sheet.html) — OWASP, living. Backs: (`jti`, `iss`) denylist and the malleability warning, Token Status List recommendation, plain sessions as an alternative, algorithm and key-type confusion. [^4]
- [ECDSA JWT malleability](https://www.gabriel.urdhr.fr/2026/06/27/ecdsa-jwt-malleability/) — Gabriel (urdhr.fr), 2026-06-27. Backs: base64url and ECDSA (r, n − s) malleability, library results, the old OWASP hash-keyed denylist. [^5]
- [RFC 7009: OAuth 2.0 Token Revocation](https://www.rfc-editor.org/rfc/rfc7009.html) — IETF, 2013. Backs: revocation request and `200` response, refresh vs access token revocation, self-contained tokens, short lifetimes. [^6]
- [RFC 7662: OAuth 2.0 Token Introspection](https://www.rfc-editor.org/rfc/rfc7662.html) — IETF, 2015. Backs: `active` semantics, RS authentication, caching trade-off. [^7]
- [Token Status List (draft-ietf-oauth-status-list)](https://datatracker.ietf.org/doc/draft-ietf-oauth-status-list/) — IETF OAuth WG, draft 21 (in RFC Editor queue on 2026-11-22). Backs: `status` claim, bit sizes and values, validation order, `ttl` caching, herd privacy. [^8]
- [OpenID Connect Back-Channel Logout 1.0](https://openid.net/specs/openid-connect-backchannel-1_0.html) — OpenID Foundation, final incorporating errata set 1, 2023-12-15. Backs: logout token claims, validation, relying-party (client) actions, responses, retransmission. [^9]
- [OpenID Continuous Access Evaluation Profile 1.0](https://openid.net/specs/openid-caep-1_0.html) — OpenID Foundation Shared Signals WG, 2025-08-29. Backs: `session-revoked`, `credential-change`, `token-claims-change` events. [^10]
- [RFC 9449: OAuth 2.0 Demonstrating Proof of Possession (DPoP)](https://www.rfc-editor.org/rfc/rfc9449.html) — IETF, September 2023. Backs: proof structure, `cnf.jkt` binding, RS checks, refresh-token binding, nonces, pre-generated proofs §11.2, untrusted code §11.4. [^11]
- [Set-Cookie header](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie) — MDN, living. Backs: `HttpOnly`, `Secure`, `SameSite`, `Path`, `Domain`, `Max-Age`, cookie prefixes. [^12]
- [HTML5 Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html) — OWASP, living. Backs: no session identifiers in `localStorage`; `sessionStorage` scope. [^13]
- [Refresh Token Rotation](https://auth0.com/docs/secure/tokens/refresh-tokens/refresh-token-rotation) — Auth0 docs, living. Backs: token families, reuse detection revoking the family. [^14]
- [Configure Refresh Token Rotation](https://auth0.com/docs/secure/tokens/refresh-tokens/configure-refresh-token-rotation) — Auth0 docs, living. Backs: leeway (rotation overlap) disabled by default and its rules, 30-day default and 1-year maximum lifetime. [^15]
- [EXPIRE](https://redis.io/docs/latest/commands/expire/) — Redis docs, living. Backs: past `EXPIREAT` deletes the key, passive and active expiry, replicas waiting for the primary's delete. [^16]
- [SET](https://redis.io/docs/latest/commands/set/) — Redis docs, living. Backs: `EXAT` absolute expiry. [^17]
- [The Phantom Token Pattern](https://curity.io/resources/learn/phantom-token-pattern/) — Curity, living. Backs: opaque token outside, JWT inside, gateway caching. [^18]
- [Protecting cookies with Device Bound Session Credentials](https://blog.google/security/protecting-cookies-with-device-bound-session-credentials/) — Google, 2026-04-09. Backs: DBSC mechanism, Chrome 146 on Windows, infostealer threat. [^19]
- [Buffer: buffers and character encodings](https://nodejs.org/api/buffer.html) — Node.js docs, living. Backs: `base64url` decoding accepts regular base64. [^20]
- [RFC 9068: JWT Profile for OAuth 2.0 Access Tokens](https://www.rfc-editor.org/rfc/rfc9068.html) — IETF, October 2021. Backs: `typ: at+jwt`, required claims including `jti` and `exp`. [^21]
- [Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API) — MDN, living. Backs: exclusive per-origin locks across tabs and workers for single-flight refresh. [^22]
- [Fix unsafe raw-token denylist (OWASP CheatSheetSeries pull request 2242)](https://github.com/OWASP/CheatSheetSeries/pull/2242) — OWASP, 2026-06-22. Backs: the June 2026 switch from a token-hash denylist to claim-based keys. [^23]
- `experiments/jwt-revocation-lab.mjs` and `experiments/jwt-revocation-lab.output.txt` — the revocation lab and its captured output (Node.js v24.22.1, 2026-11-22). [^24]
- `experiments/cookie-visibility-server.mjs` and `experiments/cookie-visibility.output.txt` — the cookie and storage lab and its captured output (Chromium 152, Chrome 158, 2026-11-22). [^25]

## Related

- `javascript/browser/browser-platform-deep-dive.md` — `localStorage`, `sessionStorage` and cookie basics in the browser, measured in Chrome 152.
- `ai-agents/model-context-protocol.md` — OAuth roles (client, authorization server, resource server) applied to MCP servers.
- `web-apis/http-error-mapping.md` — choosing `401` versus `403` when a token is missing, expired or revoked.
