---
schema: deep-dive/v1
topic: security
status: draft
applies-to: ["RFC 10017 (BCP 212, August 2026) and RFC 9700 (BCP 240, January 2025)", "RFC 7519, RFC 8725, RFC 9068, RFC 7009, RFC 7662, RFC 9449", "draft-ietf-httpbis-rfc6265bis-22 and draft-ietf-httpbis-layered-cookies-02", "experiments: Node 24.22.1; Chromium 156.0.8078.4, Firefox 151.0, WebKit 26.5 (Playwright builds)", "sources read 2026-11-22"]
last-updated: 2026-11-22
synthesized-into: []
tags: [jwt, oauth, cookies, xss, csrf, bff, revocation, refresh-token, dpop, session-management]
---

# Storing and revoking JWTs in web applications: security architecture

## Summary
**TL;DR:** A JWT (JSON Web Token) access token is a signed bearer credential: every copy is accepted until its `exp` time, and the format has no way for the issuer to take it back. Security therefore rests on two linked choices: where the browser keeps the token (this decides whether injected JavaScript can steal it or can only use it in place), and what server-side state is added so a token stops working before `exp`. The IETF's current best practice for browser apps (RFC 10017, August 2026) is a Backend for Frontend that keeps every token on the server behind an `HttpOnly` session cookie, with short-lived access tokens, rotating or sender-constrained refresh tokens, and revocation at the authorization server.
**Use this when:** choosing where a web app keeps access or refresh tokens; designing logout, "log out everywhere" or account lock; choosing between JWT and opaque tokens, a denylist, introspection or event-based logout; reviewing the cookie, CSRF (cross-site request forgery) or XSS (cross-site scripting) defences of a token-based app.
**Depth:** the 6 actors and the default of every setting they own; 10 browser storage options and 5 architectures scored against the 4 XSS attack scenarios of RFC 10017; cookie attributes, name prefixes, the size limit and `SameSite` delivery as measured in 3 browser engines; 11 revocation mechanisms with their delay and cost; cross-side interactions; two worked timelines (a BFF from login to logout, refresh-token theft under persistent XSS); an edge-case matrix; misconceptions, including a change in OWASP's own advice; 2 local experiments.

**How this doc was made.** One agent wrote it in a single pass on 2026-11-22. ✅ means the writer checked the sentence against the cited source (RFC and Internet-Draft text read as plain text from rfc-editor.org and ietf.org, OWASP pages read from their Markdown source on GitHub) or reproduced it in a local experiment ([^E1], [^E2]). No second reviewer re-checked the marks, so the status is `draft`. `⚠️ unverified` marks general knowledge or the writer's inference, not stated by any source read.

---

## 1. Context

### 1.1 What a JWT is, and why "bearer" is the whole problem

**Analogy.** A signed JWT is a laminated day pass with a hologram. The gate guard checks the hologram (the signature) and the printed date (`exp`) and never phones the office. Whoever picks up a dropped pass gets in until the printed date. Cancelling one pass early means giving every gate a list of banned pass numbers, which is exactly the shared state the pass was meant to avoid.

**The artifact.** A JWT is three base64url parts, `header.payload.signature`. Decoded, an access token from experiment E1 looks like this (RFC 9068 profile; `iat` 1795338000 is 2026-11-22 09:00:00 UTC, and `exp` is 600 seconds later, 09:10:00):

```
header  {"alg":"ES256","typ":"at+jwt","kid":"k1"}
payload {"iss":"https://as.example","sub":"alice","aud":"api","client_id":"web",
         "iat":1795338000,"exp":1795338600,"jti":"3b0c…"}
```

What the standards say about it:

- A signed JWT gives integrity, not confidentiality: the payload is only base64url-encoded, so anyone holding the token reads every claim ✅[^12].
- `exp` is the time on or after which the JWT must not be accepted ✅[^1]. Verifiers may allow a small leeway for clock skew, usually no more than a few minutes ✅[^1]. In E1, a token 1 second past `exp` was rejected without leeway and accepted with a 60-second leeway ✅[^E1].
- `jti` is a unique token ID; it is optional in a plain JWT ✅[^1]. In the JWT access-token profile, `iss`, `exp`, `aud`, `sub`, `client_id`, `iat` and `jti` are all required, and the header `typ` is `at+jwt` ✅[^3].
- The token revocation RFC states the trade-off directly: when access tokens are self-contained, the resource server needs no call to the authorization server, so immediate revocation needs some (non-standardized) back-end interaction between the two; the alternative is short-lived access tokens renewed by refresh tokens ✅[^6].
- OWASP's JWT cheat sheet warns that JWTs used as "stateless" user sessions need a deny list for logout, and that the deny list makes them stateful again; it suggests considering plain server sessions instead ✅[^12].

### 1.2 Two questions that are really one

1. **Storage:** who can read the token, and who can use it.
2. **Revocation:** how long a stolen or logged-out token keeps working.

They are linked. If the browser never holds a token (the BFF pattern, section 3.3), theft from the browser is off the table and revocation becomes a purely server-side problem. If the browser holds a long-lived bearer token, revocation is the only thing standing between a stolen copy and the attacker.

### 1.3 Terms used below

| Term | Plain meaning | Concrete example |
|---|---|---|
| Origin | scheme + host + port ✅[^4] | `https://app.example.com:443` |
| Site | scheme + registrable domain (eTLD+1: the public suffix plus one label) ✅[^4] | `a.example.com` and `b.example.com` are the same site but different origins ✅[^4] |
| XSS (cross-site scripting) | attacker-controlled JavaScript running inside your origin, from an injection bug or a compromised script file ✅[^4] | a comment field that renders `<img src=x onerror=…>` |
| CSRF (cross-site request forgery) | another site makes the victim's browser send a request that carries the victim's cookies | a hidden form on `evil.example` that POSTs to `bank.example/transfer` |
| Session riding | RFC 10017 calls it "proxying requests via the user's browser": injected code sends requests from the victim's page, and the browser attaches the cookies or tokens itself ✅[^4] | `fetch('/api/orders', {credentials:'include'})` run by the injected script |
| Confidential client | an OAuth client that can keep a secret (a server); a browser app is a public client ✅[^4] | a BFF with a client secret or private key |
| Refresh token (RT) | a long-lived credential exchanged at the authorization server for new access tokens (AT) | 8-hour RT, 10-minute AT |
| Refresh-token rotation | every refresh returns a new RT and retires the old one; presenting a retired RT revokes the whole chain ✅[^5]. Like a book of single-use tickets where each ride hands you the next ticket: if the conductor sees an already-punched ticket, the whole book is cancelled | RT1 → RT2 → RT3; RT1 shown again → all revoked |
| Sender-constrained token | a token usable only with proof of a private key, so a copy alone is useless ✅[^5]. Like a cheque that the bank cashes only with the payee's ID card | a DPoP-bound token (section 4.1, row 4) |
| BFF (Backend for Frontend) | a small server that belongs to the frontend, holds the tokens and makes the API calls; the browser only holds a session cookie ✅[^4]. Like a coat check: you carry the numbered ticket, the coat stays behind the counter | `__Host-Http-session` cookie → BFF → `Authorization: Bearer …` to the API |
| Denylist | a server-side list of token IDs that must be refused even though their signature and `exp` are fine ✅[^12] | a Redis set of `(iss, jti)` pairs, each kept until the token's `exp` |

---

## 2. The actors

**6 actors:**

- **Browser** — its job: store cookies and site data and attach cookies to matching requests, via the `Set-Cookie` / `Cookie` headers and the storage APIs.
- **Application JavaScript** (the SPA, single-page application) — its job: render the UI and call APIs, via `fetch`.
- **Injected JavaScript** (the attacker) — its job: act with the same privileges as the application code, via an XSS bug or a compromised dependency ✅[^4].
- **Backend for Frontend (BFF)**, optional — its job: be the confidential OAuth client, keep the tokens and forward API calls, via a server-side session keyed by a cookie ✅[^4].
- **Authorization server (AS)** — its job: issue, rotate and revoke tokens, via its token, revocation ✅[^6] and introspection ✅[^7] endpoints.
- **Resource server (RS, the API)** — its job: accept or refuse each request, via signature and claim checks on the JWT, plus any state lookup it adds.

### 2.1 Every setting, its default, and what "unset" means

| Owner | Setting | Default when unset | Consequence | Source |
|---|---|---|---|---|
| Browser cookie | `HttpOnly` | off: `document.cookie` can read and write the cookie | XSS can exfiltrate it | ✅[^11] ✅[^E2] |
| Browser cookie | `Secure` | off: the cookie is sent over plain HTTP too | network attackers can read or plant it | ✅[^9] |
| Browser cookie | `SameSite` | engine-dependent: Chromium treats it as `Lax` but with a 2-minute window in which cross-site top-level POSTs still carry it; Firefox and Safari do not default to `Lax` | cross-site requests may carry the cookie | ✅[^14] ✅[^9] ✅[^E2] |
| Browser cookie | `Domain` | host-only: sent only to the exact host that set it | setting `Domain` widens it to every subdomain | ✅[^9] ✅[^14] |
| Browser cookie | `Max-Age` / `Expires` | session cookie, removed when the browser shuts down, but browsers with session restore bring it back ✅[^11]; when set, the lifetime is capped at 400 days or less ✅[^9] | a "session" cookie can outlive the browser window | ✅[^11] ✅[^9] |
| AT | `exp` | optional in RFC 7519, required in RFC 9068 | without it the token never expires by itself ⚠️ unverified (inference from the claim being optional) | ✅[^1] ✅[^3] |
| AT | `jti` | optional in RFC 7519, required in RFC 9068 | without it a per-token denylist has no safe key (section 4.3) | ✅[^1] ✅[^3] |
| AT | `aud` | — | when one issuer serves several relying parties, the JWT must carry `aud` and the receiver must check it, or a token for one API is replayable at another | ✅[^2] |
| AS | RT rotation | implementation choice | for public clients the AS must either rotate RTs or sender-constrain them | ✅[^5] |
| AS | RT lifetime | implementation choice | for browser apps the AS must set a maximum lifetime or an idle expiry, and must not extend a rotated RT past the original expiry | ✅[^4] |
| AS | rotation grace period ("leeway", Auth0) | off at Auth0 | two tabs that refresh at the same moment trigger reuse detection | ✅[^22] |
| RS | introspection cache | resource servers may cache introspection responses | a revoked token works until the cache entry expires; the cache must never outlive the token's `exp` | ✅[^7] |
| RS | algorithm allowlist | library-dependent | libraries must let the caller fix the allowed algorithms, and each key must be used with exactly one algorithm | ✅[^2] |

---

## 3. Storage: where the token can live

### 3.1 What injected JavaScript can do

RFC 10017's starting point: once attacker code runs in the application's origin it has the same privileges as the legitimate code, and nothing isolates the two ✅[^4]. It lists four attack scenarios, and every storage decision below is judged against them:

| # | Scenario | What the attacker does | Stopped by |
|---|---|---|---|
| S1 | Single-execution token theft | reads the tokens from wherever the app keeps them and sends them out once ✅[^4] | not giving the browser tokens; short lifetimes and RT rotation limit the damage ✅[^4] |
| S2 | Persistent token theft | re-reads the tokens every few seconds, so it always holds the newest; then keeps the client from using the latest RT (clears it, or waits for the tab to close), so rotation never sees a reuse ✅[^4] | not giving the browser tokens; short lifetimes and rotation do **not** stop it ✅[^4] |
| S3 | Acquisition of new tokens | opens a hidden iframe and runs a silent authorization-code flow on the user's existing AS session, then extracts the code from the same-origin frame ✅[^4] | only a confidential client (BFF or token-mediating backend). Isolated storage, short lifetimes, rotation and DPoP all fail, because the attacker's flow is indistinguishable from the app's ✅[^4] |
| S4 | Proxying requests (session riding) | sends requests from inside the page; the browser or the app attaches cookies or tokens itself ✅[^4] | nothing at application level; DPoP treats it as out of scope ✅[^4]. Only preventing XSS (CSP, Content Security Policy; output encoding; Subresource Integrity) helps ✅[^4] |

S3 relies on the authorization server supporting silent frame-based flows ✅[^4].

### 3.2 Browser storage options compared

"Readable" = injected code can copy the token out (S1/S2). "Usable" = injected code can make authenticated requests in place (S4).

| Option | Readable by XSS | Usable by XSS | Survives reload | Sent automatically (CSRF exposure) | Verdict and notes |
|---|---|---|---|---|---|
| `localStorage` | yes ✅[^4] ✅[^E2] | yes | yes, shared by all tabs ✅[^4] | no | OWASP: never store JWTs or RTs in Web Storage ✅[^13] |
| `sessionStorage` | yes ✅[^4] | yes | per tab only, slightly less exposure ✅[^4] | no | same OWASP warning ✅[^13] |
| IndexedDB | yes ✅[^4] | yes | yes, shared with tabs and service workers ✅[^4] | no | not confidential at rest ✅[^15] |
| Cookie written by JavaScript | yes | yes | yes | **yes**: the browser also sends it to the app's own server, for example on the next page load ✅[^4] | NOT RECOMMENDED by RFC 10017 ✅[^4] |
| In-memory variable / closure | harder, not impossible: prototype poisoning of functions the closure calls can leak the token ✅[^4] | yes | no ✅[^4] | no | needs a silent re-login or refresh on every page load |
| Web Worker holding the RT | the RT: no; the AT handed to the page: yes ✅[^4] | yes | no (ends with the page) ✅[^4] | no | protects the RT from S1/S2, not from S3 ✅[^4] |
| Service Worker | no, if the worker never shares tokens and never persists them in IndexedDB, which the page can read ✅[^4] | yes | registration persists | no | a discouraged pattern: still open to S3 and S4 ✅[^4] |
| `HttpOnly` cookie holding the JWT itself | no ✅[^11] ✅[^E2] | **yes**: JS-initiated requests still carry it ✅[^11] ✅[^E2] | yes | yes | needs CSRF defence; a JWT may exceed the 4096-octet cookie limit (section 3.6) |
| BFF session cookie (`HttpOnly`), tokens on the server | no tokens in the browser at all ✅[^4] | yes, through the BFF ✅[^4] | yes | yes | RFC 10017's first choice (section 3.3) |
| DPoP-bound tokens + non-extractable key in IndexedDB | token yes, key no | yes, while the page is open ✅[^8] | yes | no | stops S1/S2 exfiltration, not S3 (attacker binds a fresh token to its own key) ✅[^4] |

Two observations from E2 that matter when debugging: in all three engines the page's `document.cookie` did not list the `HttpOnly` cookies, while a same-origin `fetch` from that page sent all of them ✅[^E2]. When the page then wrote `ho=overwritten-by-js` over an `HttpOnly` cookie named `ho`, the server kept receiving the original value in all three engines, but Firefox 151 and WebKit 26.5 showed the JavaScript value in `document.cookie` afterwards ✅[^E2]. Why they show it is not established ⚠️ unverified.

### 3.3 The architectures

RFC 10017 describes three patterns in decreasing order of security, plus discouraged ones ✅[^4]:

| Architecture | Tokens in the browser | S1 | S2 | S3 | S4 | RFC 10017 verdict |
|---|---|---|---|---|---|---|
| **BFF**: a server-side part of the frontend is the confidential client, keeps AT and RT in a cookie-based session, and proxies every API call ✅[^4] | none | mitigated | mitigated | mitigated (no client credentials in the browser) | open | "strongly recommended" for business, sensitive and personal-data apps ✅[^4] |
| **Token-mediating backend**: a backend is the confidential client but hands the AT to the browser, which calls APIs directly ✅[^4] | AT only | AT exposed | AT exposed | mitigated | open | evaluate a full BFF first ✅[^4] |
| **Browser-based OAuth client**: the SPA runs the whole flow and holds AT and RT ✅[^4] | AT and RT | exposed | exposed | exposed | open | not recommended for business, sensitive or personal-data apps ✅[^4] |
| Service Worker as the OAuth client | none in the page | mitigated | mitigated | exposed | open | discouraged ✅[^4] |
| **No OAuth between frontend and backend**: one domain, plain server-side session cookie (OpenID Connect may still be used for login) | none | n/a | n/a | n/a | open | recommended when the app does not need OAuth for its own API ✅[^4] |

The last row is easy to skip: RFC 10017 says many simple apps are made needlessly complex by using OAuth in place of session management, and that a server-side cookie session is only exposed to S4 ✅[^4].

**What else RFC 10017 asks of a BFF** ✅[^4]:

- MUST act as a confidential client and use the authorization-code grant;
- MUST implement a CSRF defence (section 3.5);
- MUST forward only to an explicit allowlist of resource servers and paths; an open proxy leaks the user's access token to whatever host the attacker names;
- SHOULD encrypt the cookie when it is a client-side session that contains tokens, so tokens never sit in plaintext in the browser's cookie file;
- and, as advice rather than a requirement: make the session lifetime equal to the RT's maximum lifetime, and end the session when the RT turns out to be invalid.

With a client-side (stateless) BFF session cookie, revoking the user's AT and RT is enough to cut access; the cookie itself need not be invalidated ✅[^4].

### 3.4 Cookie settings for the session cookie

The artifact, as the BFF should send it:

```
Set-Cookie: __Host-Http-session=<opaque id or encrypted blob>; Secure; HttpOnly; SameSite=Strict; Path=/
```

| Piece | Rule for a BFF ✅[^4] | What it does |
|---|---|---|
| `Secure` | MUST | only sent over HTTPS |
| `HttpOnly` | MUST | invisible to `document.cookie` ✅[^11] |
| `SameSite=Strict` | SHOULD | only sent on same-site requests |
| `Path=/` | SHOULD | one cookie for the whole host |
| no `Domain` | SHOULD NOT set it | host-only, not shared with subdomains |
| `__Host-Http-` name prefix | SHOULD | a browser accepts the cookie only if it is `Secure`, `HttpOnly`, `Path=/` and has no `Domain` ✅[^10] ✅[^11] |

**The prefixes, and why `__Host-` alone is not enough.**

- `__Host-` guarantees `Secure`, `Path=/` and no `Domain` ✅[^9].
- `__Http-` guarantees `Secure` and `HttpOnly`, so it proves the cookie came from a `Set-Cookie` header and not from script ✅[^10].
- `__Host-Http-` guarantees all four ✅[^10]. These two newer prefixes are defined in `draft-ietf-httpbis-layered-cookies-02`, not in `rfc6265bis-22` ✅[^10] ✅[^9].

In E2, Chromium 156 and Firefox 151 refused `document.cookie = '__Host-Http-fake=1; Secure; Path=/'` and the `__Http-` equivalent, but accepted a JavaScript-written `__Host-jsok` cookie ✅[^E2]. So a `__Host-` cookie can still be planted by script; only the `Http` prefixes prove server origin. The WebKit build did not store any `Secure` cookie over `http://localhost`, so the prefix test there was inconclusive ✅[^E2]. A browser that predates the `Http` prefixes would likely still enforce the `__Host-` rules on a `__Host-Http-` name, because the name starts with `__Host-` ⚠️ unverified.

### 3.5 CSRF: the price of cookies

Any cookie-based design must defend against CSRF; for a BFF it is a MUST ✅[^4]. The options, and their limits:

1. **`SameSite=Strict`** keeps the cookie off cross-site requests. It does not help when the attacker is on another subdomain of the same site (`b.example.com` after a subdomain takeover attacking `a.example.com`), because that is same-site ✅[^4] ✅[^14].
2. **CORS (Cross-Origin Resource Sharing) plus a required custom header.** A cross-origin request with a custom header always needs a preflight, which the BFF refuses; requests without one ("CORS-safelisted": a bodiless POST, a form POST, a GET) skip the preflight, so the BFF SHOULD require a static custom header such as `My-Static-Header: 1` and MUST then check it on every request ✅[^4].
3. **Double-submit / anti-forgery cookie** from the framework: acceptable, not preferred over CORS ✅[^4]. OWASP recommends the signed variant and discourages the naive one ✅[^14].
4. **Fetch Metadata**: reject state-changing requests whose `Sec-Fetch-Site` is `cross-site`; OWASP requires an `Origin` / `Referer` fallback for browsers that do not send it ✅[^14].

OWASP treats `SameSite` as defence in depth that rarely suffices alone: `Lax` lets cookies ride on cross-site top-level GETs, so any state-changing GET is exposed ✅[^14]. And XSS defeats every CSRF defence ✅[^14].

**Measured delivery (E2).** The application at `http://localhost:8801` set one cookie per `SameSite` value; a page on `http://127.0.0.1:8801`, a different site, then sent requests to it. "No attribute" means the cookie was set without `SameSite`.

| Request from the other site | `Strict` | `Lax` | `None` (+`Secure`), Chromium and Firefox | No attribute: Chromium 156 | No attribute: Firefox 151 | No attribute: WebKit 26.5 |
|---|---|---|---|---|---|---|
| `fetch` GET/POST (`no-cors`), `<img>` | not sent | not sent | sent | not sent | sent | not sent |
| top-level form POST, within 2 minutes of the cookie being set | not sent | not sent | sent | **sent** | sent | sent |
| top-level form POST, 130 s after | not sent | not sent | sent | not sent | (not run) | (not run) |
| top-level GET navigation | not sent | sent | sent | sent | sent | sent |

All rows ✅[^E2]. The Chromium rows match the "Lax-allowing-unsafe" mode of rfc6265bis, a 2-minute grace for cookies that got `Lax` only by default ✅[^9] ✅[^11]. The WebKit build stored no `Secure` cookie over `http://localhost`, so it has no `None` result, and it sent no cookies at all on cross-site subresource requests ✅[^E2]; that this is its third-party cookie blocking is ⚠️ unverified. These are Playwright builds: stock Firefox and Safari ship tracking protections whose defaults may differ ⚠️ unverified.

### 3.6 Size: a JWT often does not fit in a cookie

A browser ignores the whole `Set-Cookie` header when the cookie's name plus value exceeds 4096 octets ✅[^9]; the older RFC 6265 only asked browsers to support "at least 4096 bytes" including attributes ✅[^23]. Sizes from E1, for the cookie name `__Host-Http-session` (19 characters) ✅[^E1]:

| Token | Token length | Name + value | Fits? |
|---|---|---|---|
| ES256, 8 claims | 421 | 19 + 421 = 440 | yes |
| RS256, 8 claims | 677 | 19 + 677 = 696 | yes |
| RS256, 8 claims + 100 group IDs | 5891 | 19 + 5891 = 5910 | no: silently dropped |

In E2, a cookie of 3 + 4100 = 4103 octets was dropped and one of 4 + 4000 = 4004 octets was kept, in all three engines ✅[^E2]. The failure is silent: the server sends the header and the next request simply has no cookie. A BFF with server-side sessions avoids the problem, because the cookie carries only an ID.

### 3.7 Storage the browser may delete or leak

- **Safari deletes script-writable storage** (IndexedDB, `localStorage`, `sessionStorage`, Service Worker registrations and cache) after seven days of Safari use without user interaction on the site; home-screen web apps keep their own counter ✅[^20]. An RT kept in `localStorage` can vanish; server-set `HttpOnly` cookies are not in that list ✅[^20].
- **Browser storage is not guaranteed to be encrypted at rest**, and infostealer malware targets browser profiles for tokens and session cookies ✅[^4]. A non-extractable Web Crypto key does not help here, because the specification makes no promise about how the key itself is stored on disk ✅[^4].
- **Device Bound Session Credentials (DBSC)** bind a cookie session to a hardware-held key (TPM, Trusted Platform Module, on Windows; Secure Enclave on macOS): the server issues short-lived cookies only after the browser proves it holds the key, so stolen cookies expire quickly. Chrome 146 made it publicly available on Windows, with macOS announced for a later release ✅[^21]. It needs registration and refresh endpoints on the server ✅[^21].

---

## 4. Revocation: making a token stop working before `exp`

### 4.1 Catalogue

"Delay" is how long a revoked token can still be used.

| # | Mechanism | State it needs | Checked by | Delay | What it revokes | Source |
|---|---|---|---|---|---|---|
| 1 | **Short AT lifetime** (minutes) + RT | none | RS (`exp`) | up to the AT's remaining lifetime | nothing early; it bounds the damage | ✅[^6] ✅[^4] |
| 2 | **RT revocation endpoint** (RFC 7009) | AS token store | AS on the next refresh | immediate for the RT; ATs live on unless the AS also revokes ATs | the RT; the AS SHOULD also invalidate ATs of the same grant if it supports AT revocation | ✅[^6] |
| 3 | **RT rotation + reuse detection** | AS keeps the chain of RTs | AS | immediate once a reuse is seen | the whole token family; the legitimate client must log in again | ✅[^5] ✅[^E1] |
| 4 | **Sender-constrained tokens** (DPoP, or mutual TLS) | the token carries the key's thumbprint (`cnf.jkt`); the client keeps the private key | RS checks a fresh proof per request | n/a: a stolen copy is useless without the key | stops replay from elsewhere, not S3/S4 | ✅[^5] ✅[^8] ✅[^4] |
| 5 | **Opaque token + introspection** (RFC 7662) | AS | RS asks the AS | 0 without a cache; up to the cache TTL (time to live) with one | any single token | ✅[^7] |
| 6 | **`jti` denylist** | shared store (for example Redis) with TTL = remaining lifetime | RS on every request | as fast as the store replicates | one token | ✅[^12] ✅[^E1] |
| 7 | **Per-user cut-off time or version counter** | one value per user | RS on every request | immediate | every token of that user | ⚠️ unverified (common practice); behaviour in ✅[^E1] |
| 8 | **Signing-key rotation** (drop the key from the JWKS, JSON Web Key Set) | key set | RS (JWKS cache) | up to the RS's JWKS cache time ⚠️ unverified | every token signed with that key | mechanism ✅[^E1] |
| 9 | **Token Status List** | compressed status list published by the issuer | RS fetches the list | up to the list's cache time ⚠️ unverified | one token (a bit in the list) | ✅[^12] ✅[^19] |
| 10 | **Back-Channel Logout / CAEP events** | AS pushes signed events to each app | the app (RP, relying party) | as fast as delivery | the app's sessions for a user or a session ID | ✅[^17] ✅[^18] |
| 11 | **End the BFF session** | BFF session store, or nothing extra for a client-side session | BFF | immediate for requests through the BFF | the browser's access through the BFF | ✅[^4] |

Notes per row:

- **Row 2.** The AS MUST support revoking refresh tokens and SHOULD support revoking access tokens ✅[^6]. Revocation takes effect immediately at the AS, though a propagation delay between servers is acknowledged ✅[^6]. If the AS cannot revoke ATs, they stay valid after the RT is revoked, and deployments must account for that ✅[^6].
- **Row 3.** The AS cannot tell which party presented the old RT, so it revokes the active one ✅[^5]. The grant ID may be encoded in the RT so the AS can find the whole family, provided the RT's integrity is protected, for example by a signature ✅[^5]. The AS MAY also revoke RTs on password change or logout, and RTs SHOULD expire after a period of client inactivity ✅[^5].
- **Row 4.** A DPoP proof is a JWT with `typ` `dpop+jwt`, signed with an asymmetric key whose public part travels in the `jwk` header; its payload carries `jti`, `htm` (HTTP method), `htu` (target URI), `iat`, and `ath`, the hash of the access token, when sent to a resource server ✅[^8]. A bound JWT access token carries `cnf.jkt`, the key's SHA-256 thumbprint ✅[^8]. RFC 9700 says authorization and resource servers SHOULD sender-constrain access tokens ✅[^5].
- **Row 5.** The AS MUST check expiry, start time, revocation, signature and audience before answering `active: true` ✅[^7]. A cached response MUST NOT be kept past the token's `exp`; highly sensitive resources may disable caching ✅[^7].
- **Row 6.** See section 4.3 for the key choice.
- **Row 9.** The issuer puts a `status` claim with the list's URI and the token's index in it ✅[^12]. The draft (`draft-ietf-oauth-status-list-21`) is in the RFC Editor queue, not yet an RFC, as of 2026-11-22 ✅[^19].
- **Row 10.** A Logout Token is a signed JWT with `iss`, `aud`, `iat`, `exp`, `jti`, an `events` claim containing `http://schemas.openid.net/event/backchannel-logout`, and `sub` or `sid` (without `sid`, all the user's sessions at the RP are meant); a `nonce` claim is prohibited ✅[^17]. RTs issued to the logged-out session without `offline_access` SHOULD be revoked ✅[^17]. CAEP (Continuous Access Evaluation Profile) 1.0, published 2025-08-29 on the Shared Signals Framework, defines a `session-revoked` event among others ✅[^18].
- **Row 11.** The AS SHOULD tie browser apps' RT lifetime to the user's AS session, so an AS logout also invalidates them ✅[^4].

### 4.2 Refresh-token rotation in detail

The rules for refresh tokens issued to browser apps ✅[^4]:

- the AS MUST rotate RTs on each use, or sender-constrain them;
- it MUST set a maximum lifetime or an idle expiry;
- a rotated RT MUST NOT live past the original RT's expiry.

RFC 10017's own example: a 10-minute AT and an 8-hour RT; after 10 minutes the refresh returns a new 10-minute AT and an RT valid for 7 h 50 min; after 8 hours the refresh fails and the user must sign in again ✅[^4]. E1 reproduced the arithmetic: the first refresh, 600 s after login, returned an RT expiring in 28,800 − 600 = 28,200 s, not a fresh 28,800 ✅[^E1].

**Where rotation fails.**

- **Persistent theft (S2).** Rotation detects a stolen RT only when both parties use the same RT. If the attacker always copies the newest RT and the client stops refreshing (tab closed), no reuse ever happens ✅[^4]. E1 measured it: the attacker refreshed 46 times undetected and was stopped only by the 8-hour absolute cap ✅[^E1] (worked example B, section 7).
- **Concurrency.** Two tabs or two parallel requests that refresh with the same RT look like a replay. Auth0 offers an overlap period ("leeway") for this; it is off by default, and reuse outside it revokes every RT issued since the reused one, plus the grant ✅[^22]. A grace period is also a window in which a thief's replay is accepted ⚠️ unverified (inference).

### 4.3 Denylist design

- **Key it by `(iss, jti)`**, and keep each entry until the token's `exp`; after that the token is rejected anyway ✅[^12]. In E1 the entry was pruned at `exp` and the token was then rejected as expired ✅[^E1].
- **Do not key it by the raw token or its hash.** OWASP warns that a revoked JWT may be re-encoded into another valid form, through lax parsing or because ECDSA signatures are malleable ✅[^12]. E1 demonstrated the ECDSA case: replacing the signature's `s` with `n − s` (n = the P-256 group order) gave a different token string whose signature still verified in Node's crypto; a SHA-256-of-token denylist accepted it, a `jti` denylist rejected it ✅[^E1].
- **The cost:** every RS instance must consult a shared store on every request, which is the statefulness OWASP warns about ✅[^12].

**Per-user cut-off timestamps have a 1-second trap.** `iat` is a NumericDate, a count of seconds that may have a fractional part ✅[^1], but issuers commonly write whole seconds ⚠️ unverified (E1 does). With whole seconds, a cut-off stored in seconds cannot separate a token issued at 09:00:00.100 from a logout at 09:00:00.400 and a new login at 09:00:00.800. In E1, the rule `iat < cutoff` kept the old token valid, and `iat <= cutoff` rejected the new one; a per-user version counter (`ver` claim compared with a stored value) got both right ✅[^E1].

### 4.4 What "logout" must do, actor by actor

Deleting the browser's copy is not revocation: in E1, a copy kept by an attacker was still accepted 5 minutes after such a "logout" ✅[^E1]. OWASP: invalidating the session on the server is the mandatory part, and all session IDs of the same logical session, including rotated ones, must be revoked together ✅[^13].

1. **Browser (app JS):** sends the logout request to the BFF (or the AS), then drops in-memory tokens.
2. **BFF:** calls the AS revocation endpoint with the RT ✅[^6]; deletes the server-side session; answers with an expired cookie and, optionally, `Clear-Site-Data: "cache", "cookies", "storage"` ✅[^13].
3. **AS:** revokes the RT and, if it can, the ATs of the grant ✅[^6]; ends its own session; sends Back-Channel Logout tokens to other apps of the user ✅[^17].
4. **RS:** keeps accepting already-issued JWT ATs until `exp`, unless it checks introspection, a denylist, a version counter or a status list (section 4.1) ✅[^6].

---

## 5. Cross-side interactions

What a change on one side does to every other side.

| Change | Browser | BFF | AS | RS | Source |
|---|---|---|---|---|---|
| Shorter AT lifetime | none with a BFF; more refresh calls in a browser-only client | refreshes more often | more token requests | smaller window for a stolen AT | ✅[^4] ✅[^6]; load effect ⚠️ unverified |
| Turn on RT rotation | parallel tabs can trigger false reuse and log the user out | must serialize refreshes per session ⚠️ unverified | stores RT chains; needs a grace period | none | ✅[^5] ✅[^22] |
| Add a `jti` denylist | none | none | publishes revocations to the store | becomes stateful; every instance needs the shared store | ✅[^12] |
| Longer introspection cache | none | none | less load | revoked tokens live up to the cache TTL | ✅[^7] |
| `SameSite=Strict` on the session cookie | the first request after following a link from another site arrives without the cookie, so the app looks logged out | must handle that request (for example, re-check the session after the page loads) ⚠️ unverified | none | none | ✅[^14] ✅[^E2] |
| `__Host-` / `__Host-Http-` prefix | cookie cannot be shared with subdomains | each subdomain app needs its own session | none | none | ✅[^4] ✅[^9] |
| Third-party cookie blocking in browsers | silent iframe renewal at the AS becomes unreliable ⚠️ unverified | none | refresh tokens for browser apps become the more attractive option ✅[^4] | none | ✅[^4] |
| Rotate and remove a signing key | none | none | publishes the new JWKS | every token signed with the removed key fails; RSs must refresh their key cache | ✅[^E1]; cache timing ⚠️ unverified |
| Logout at the AS | none | learns of it by Back-Channel Logout or a failed refresh, then ends the session | revokes session-bound RTs (SHOULD) | still accepts unexpired JWT ATs | ✅[^4] ✅[^17] ✅[^6] |
| Move from browser-only client to BFF | holds no tokens; all API calls go through the BFF | must proxy and allowlist; one IP for many users | client becomes confidential | rate limits by IP may need changing | ✅[^4] |

---

## 6. Worked example A: a BFF from login to logout

Setup: a BFF at `https://app.example`, AT lifetime 10 minutes, RT absolute lifetime 8 hours with rotation, login on 2026-11-22 at 09:00:00 UTC. The steps follow RFC 10017's BFF figure ✅[^4]; the times are illustrative.

```
[Browser + app JS]          [BFF — server]                 [AS]                 [RS — API]
 GET /bff/login (navigation)
   ─────────────────────────▶ 302 to AS /authorize (PKCE)
 ═════════════════ network ═══════════════════════════════▶ user signs in
 ◀──────────────────────────────────────────── 302 /bff/callback?code=…
   ─────────────────────────▶ POST /token (client auth + code_verifier) ══▶
                              ◀═════════ AT (exp 09:10), RT (abs. exp 17:00)
                              stores tokens in session
 ◀───────── Set-Cookie: __Host-Http-session=…; Secure; HttpOnly; SameSite=Strict; Path=/
 fetch /bff/api/orders + My-Static-Header: 1   (cookie attached by the browser)
   ─────────────────────────▶ check header, find session, attach AT
                              GET /orders, Authorization: Bearer AT ═════════════════▶ verify kid, alg, iss, aud, exp
 ◀─────────────────────────────────────────────────────────────────────────── 200
```

1. **Browser → BFF (09:00:00):** the app finds no session (a "check session" call) and navigates to `/bff/login` ✅[^4].
2. **BFF → browser → AS (network):** the BFF redirects to the AS authorization endpoint with PKCE (Proof Key for Code Exchange); the user signs in; the AS redirects back to the BFF with a code ✅[^4].
3. **BFF → AS token endpoint (network):** exchanges the code with its client credentials and the PKCE verifier; receives AT1 (`exp` 09:10:00) and RT1 (absolute expiry 17:00:00) ✅[^4].
4. **BFF (local):** stores both in the session and sets the `__Host-Http-session` cookie; no token reaches the browser ✅[^4]. The cookie can be set with `SameSite=Strict` even though this response answers a cross-site navigation (the redirect from the AS): `SameSite` blocks setting cookies only on cross-site subresource requests and nested navigations, not on top-level navigations ✅[^9].
5. **Browser → BFF (09:05):** `fetch('/bff/api/orders', {headers: {'My-Static-Header': '1'}})`; the browser adds the cookie by itself ✅[^E2].
6. **BFF (local):** checks the static header (CSRF defence), maps the path to the allowlisted host `https://orders-api.example`, removes the cookie and attaches AT1 ✅[^4].
7. **RS (network, then local):** verifies the signature with the key named by `kid` from the AS's JWKS, the algorithm allowlist, `iss`, `aud` and `exp` ✅[^2].
8. **BFF (09:12):** AT1 has expired, so before forwarding it refreshes inline: RT1 → AT2 (`exp` 09:22) + RT2, whose expiry stays 17:00:00, that is 17:00 − 09:12 = 7 h 48 min ✅[^4].
9. **Browser → BFF (10:00, logout):** the BFF calls the AS revocation endpoint with RT2 ✅[^6], deletes the session, and replies with an expired cookie and `Clear-Site-Data` ✅[^13].
10. **What survives:** the last AT issued (say AT5, issued 09:52, `exp` 10:02) is still accepted by the RS until 10:02 if anyone copied it, unless the RS checks revocation state ✅[^6]. With a BFF, only a BFF compromise or an RS-side leak could have copied it ⚠️ unverified (inference from section 3.3).

---

## 7. Worked example B: refresh-token theft under persistent XSS in a browser-only client

Setup (E1, scenario D2): a browser-only SPA holds its RT in JavaScript-reachable storage; 10-minute ATs; 8-hour absolute RT lifetime with rotation and reuse detection ✅[^E1].

1. **09:00 — App JS → AS:** login; receives RT1 (absolute expiry 17:00).
2. **09:10 — App JS → AS:** refresh with RT1; receives RT2. RT1 is now "used".
3. **09:10 — Injected JS:** copies RT2 to the attacker's server (persistent theft polls every few seconds) ✅[^4].
4. **09:10 — Browser:** the user closes the tab, so the app never presents RT2.
5. **09:20 to 16:50 — Attacker → AS:** refreshes every 10 minutes from its own machine: RT2 → RT3 → … Each RT is used once, so reuse detection never fires. That is (16:50 − 09:20) / 10 min + 1 = 46 successful refreshes ✅[^E1].
6. **17:00 — Attacker → AS:** refused, "absolute lifetime reached" ✅[^E1].

Contrast, E1 scenario D1: when the attacker instead replays the old RT1 after the client has rotated, the AS sees a reuse, revokes the family, and the client's own RT2 is refused too ✅[^E1] ✅[^5]. Rotation catches the careless thief, not the persistent one ✅[^4].

---

## 8. Edge cases and failure matrix

| # | Situation | What happens | Why | Mitigation | Source |
|---|---|---|---|---|---|
| 1 | XSS; tokens in `localStorage` | tokens copied and used from anywhere | same-origin script reads Web Storage | BFF; never store tokens in Web Storage | ✅[^4] ✅[^13] |
| 2 | XSS; token in an `HttpOnly` cookie | no copy, but authenticated requests from the page | the browser attaches the cookie to the script's requests | prevent XSS (CSP, encoding); BFF anomaly detection and rate limits | ✅[^11] ✅[^4] ✅[^E2] |
| 3 | XSS in a browser-only client | attacker gets its own fresh AT and RT via a hidden iframe flow | public client; the code is readable in a same-origin frame | confidential client (BFF or token-mediating backend) | ✅[^4] |
| 4 | XSS with DPoP and a non-extractable key | requests via the victim's browser still work; proofs pre-computed with future `iat` values may work while the client is offline; a new flow binds tokens to the attacker's key | the key can be used, just not exported | server-provided DPoP nonces against pre-generated proofs, and short-lived DPoP-bound ATs; still needs XSS prevention | ✅[^8] ✅[^4] |
| 5 | Persistent XSS; RT rotation | stolen RT chain runs until the absolute lifetime | the client never re-uses an RT | short absolute lifetime; BFF | ✅[^4] ✅[^E1] |
| 6 | Two tabs refresh at the same moment | reuse detection revokes the family; user logged out | both present the same RT | overlap period, or serialize refreshes | ✅[^22] |
| 7 | Logout only deletes the browser copy | other copies valid until `exp` | nothing at the AS or RS changed | revoke at the AS; RS-side check for immediacy | ✅[^E1] ✅[^13] |
| 8 | Denylist keyed by token hash | an ECDSA-malleated copy is accepted | different string, same valid signature | key by `(iss, jti)` | ✅[^12] ✅[^E1] |
| 9 | Cut-off timestamp in seconds | old token survives, or a new one is refused, inside the logout second | `iat` is usually written in whole seconds | version counter, or finer-grained timestamps | ✅[^1] ✅[^E1] |
| 10 | Generous clock-skew leeway | expired tokens accepted for the leeway | `exp` + leeway | keep leeway to seconds or a few minutes | ✅[^1] ✅[^E1] |
| 11 | Introspection cache | revoked token accepted until the entry expires | RS trusts its cache | short TTL, no cache for sensitive resources, never past `exp` | ✅[^7] |
| 12 | JWT stored in a cookie grows past 4096 octets | the browser drops the cookie silently; user looks logged out | name + value limit | server-side session with an ID cookie; fewer claims | ✅[^9] ✅[^E1] ✅[^E2] |
| 13 | Cookie without `SameSite` | Chromium sends it on cross-site top-level POSTs only within 2 minutes of setting it; the Firefox build also sent it on cross-site `fetch` and `<img>` requests; the WebKit build stored it as `None` | engine defaults differ | always set `SameSite` explicitly | ✅[^14] ✅[^E2] |
| 14 | Takeover of a sibling subdomain | CSRF against `SameSite=Strict` cookies still works | same-site is not same-origin | custom header + CORS; `__Host-` cookie; no `Domain` | ✅[^4] ✅[^14] |
| 15 | State-changing GET endpoint | `SameSite=Lax` cookie rides on a cross-site link | Lax allows top-level safe-method navigations | no state changes on GET | ✅[^14] ✅[^E2] |
| 16 | BFF forwards to any path or host | the user's AT is sent to an attacker-chosen host | open proxy | explicit allowlist of hosts, paths and methods | ✅[^4] |
| 17 | Safari, 7 days without a visit | RT in `localStorage` or IndexedDB is deleted | ITP (Intelligent Tracking Prevention) cap on script-writable storage | server-side session | ✅[^20] |
| 18 | Infostealer malware | cookies and stored tokens copied from disk | storage not guaranteed encrypted at rest | DBSC (device-bound cookies); short lifetimes | ✅[^4] ✅[^21] |
| 19 | `alg: none` or RS256 → HS256 switch | forged token accepted by a naive library | the library trusts the header's `alg` | fixed algorithm per key | ✅[^2] ✅[^E1] |
| 20 | HS256 key derived from a password | offline brute force recovers the key from one token | low-entropy MAC key | 256-bit random key, or asymmetric signatures | ✅[^2] |
| 21 | `document.cookie` written over an `HttpOnly` name | Firefox and WebKit builds show the script's value; the server still gets the original | display only, not the stored cookie ⚠️ unverified (cause) | debug with server logs, not `document.cookie` | ✅[^E2] |
| 22 | Testing `Secure` or `__Host-` cookies on `http://localhost` | Chromium and Firefox store them; the WebKit build did not | engines differ on whether `http://localhost` counts as secure for cookies | test cookies over HTTPS | ✅[^E2] |

---

## 9. Misconceptions and conflicting guidance

| Belief | Reality | Source |
|---|---|---|
| "`HttpOnly` cookies make XSS harmless." | They stop theft of the cookie, not its use: script-initiated requests carry it | ✅[^11] ✅[^4] ✅[^E2] |
| "Logout = delete the JWT on the client." | Every other copy stays valid until `exp` | ✅[^E1] |
| "Refresh-token rotation makes stolen refresh tokens harmless." | Not against persistent theft (S2) | ✅[^4] ✅[^E1] |
| "DPoP solves XSS." | It stops exfiltrated tokens being used elsewhere; it does not stop in-page use or a fresh flow with the attacker's key | ✅[^4] ✅[^8] |
| "A Service Worker isolates tokens." | Discouraged by RFC 10017: still open to a fresh flow and session riding | ✅[^4] |
| "Putting the JWT in a cookie from JavaScript is the safe compromise." | NOT RECOMMENDED: readable by script and also sent to your server automatically | ✅[^4] |
| "JWTs make sessions stateless." | Logout needs a deny list, which brings state back | ✅[^12] |
| "`SameSite` replaces CSRF tokens." | Defence in depth in most deployments | ✅[^14] |

**A change in OWASP's own advice.** At commit `fd8d87b` (2026-06-26) the OWASP "JSON Web Token Cheat Sheet for Java" advised keeping the JWT in `sessionStorage` (or `localStorage` with short timeouts, or a closure) and binding it to a random "fingerprint" sent as a hardened `HttpOnly` cookie, whose SHA-256 hash sits in the token ✅[^16]. The fingerprint stops a stolen token from being used on the attacker's machine, but not from inside the victim's page; the sheet's own note admits the proxy case ✅[^16]. The renamed sheet read on 2026-11-22 has no client-storage section ✅[^12], and OWASP's Session Management cheat sheet now says never to put JWTs, refresh tokens or session IDs in `localStorage` or `sessionStorage`, pointing to `HttpOnly; Secure; SameSite=Strict` cookies or a BFF ✅[^13]. The IETF's RFC 10017 is the primary source and agrees with the newer text ✅[^4]. Older tutorials that recommend Web Storage descend from the earlier advice ⚠️ unverified.

---

## 10. Decision guide

| Your situation | Choose | Revocation set-up |
|---|---|---|
| One first-party domain, own API, no third-party API access | plain server-side session cookie; OpenID Connect only for login ✅[^4] | delete the server session ✅[^13] |
| SPA calling APIs on other origins; business or personal data | BFF with `__Host-Http-` session cookie, CSRF header check, path allowlist ✅[^4] | short ATs; RT revocation at logout; Back-Channel Logout from the AS ✅[^6] ✅[^17] |
| Cannot proxy every API call (latency, volume) | token-mediating backend; AT in memory only; RT stays on the server ✅[^4] | short ATs (they are exposed); RS-side denylist or introspection for urgent cases ✅[^12] ✅[^7] |
| Browser-only client unavoidable, low-sensitivity data | authorization code + PKCE; RT in a Web Worker; DPoP if available ✅[^4] | rotation or sender-constrained RTs, absolute lifetime ✅[^4] |
| Must cut off a user within seconds (fraud, account lock) | any of the above | opaque tokens + introspection without cache, or a version counter or denylist at every RS ✅[^7] ✅[^E1] |
| Many independent resource servers | JWT ATs with `aud` per RS ✅[^5] | Token Status List (draft) or CAEP events ✅[^19] ✅[^18] |

---

## 11. The experiments

Both live in `research/_golden/LS-03/baseline/experiments/`. E1 needs only Node; E2 also needs `playwright-core` and its browser builds, which were already installed on the machine used.

| ID | Files | What it checks | Environment |
|---|---|---|---|
| E1 | `e1-revocation.mjs`, `e1-output.txt` | stateless logout (A), `jti` denylist with TTL (B), cut-off time vs version counter (C), RT rotation, reuse detection and the absolute cap, including persistent theft (D), hash-keyed denylist vs ECDSA malleability (E), key removal (F), `alg: none` (G), token sizes (H). Simulated clock, hand-written ES256/HS256/RS256 with `node:crypto` | Node 24.22.1 |
| E2 | `e2-cookies-server.mjs`, `e2-driver.mjs`, `e2-output-chromium.txt` (with the 130 s wait), `e2-output-chromium-rerun.txt`, `e2-output-firefox.txt`, `e2-output-webkit.txt` | `HttpOnly` visibility, JavaScript overwrite of an `HttpOnly` cookie, `__Host-` / `__Http-` / `__Host-Http-` prefixes from JavaScript, the 4096-octet limit, `localStorage` readability, cookie delivery on same-origin and cross-site requests per `SameSite` value | Playwright headless Chromium 156.0.8078.4 (playwright-core 1.64.1), Firefox 151.0 and WebKit 26.5 (playwright-core 1.61.1); fresh browser context per run; HTTP on `localhost` vs `127.0.0.1` |

To reproduce E2: start `node e2-cookies-server.mjs`, then `node e2-driver.mjs <path to playwright-core> chromium --wait-lax` (and `firefox`, `webkit`). Limits: single runs; plain HTTP on loopback, not HTTPS; Playwright builds, not stock browsers with their tracking protections; E1's authorization server is a toy model of the RFC rules, not a product.

---

## 12. Verification status and gaps

- Verified against primary text: the RFC 10017 threat model, architectures, storage section and cookie rules; RFC 9700 refresh-token rules; RFC 7009, 7662, 7519, 8725, 9068 and 9449 passages cited; rfc6265bis-22 size, prefix and `SameSite` rules; layered-cookies-02 prefixes; OpenID Back-Channel Logout and CAEP; OWASP sheets as of 2026-11-22.
- Verified by experiment only: section 3.5's delivery table, section 3.6's sizes, section 4.3's malleability and cut-off cases, and the worked example B counts.
- Not verified (marked as such in the body): the load effect of shorter AT lifetimes; JWKS cache timing; Token Status List cache timing; how older browsers treat `__Host-Http-` names; the cause of the Firefox/WebKit `document.cookie` display; whether stock Firefox and Safari match the Playwright builds; whether a rotation grace period widens a thief's window; why the WebKit build sent no cookies on cross-site subresource requests.
- Not covered: native mobile apps; ID-token handling beyond logout; mTLS (RFC 8705) details; token exchange between services.

---

## References

- [RFC 7519: JSON Web Token (JWT)](https://www.rfc-editor.org/rfc/rfc7519) — IETF, 2015. Backs: `exp`, `jti`, leeway, NumericDate. [^1]
- [RFC 8725: JSON Web Token Best Current Practices](https://www.rfc-editor.org/rfc/rfc8725) — IETF, 2020. Backs: algorithm allowlist, `alg: none` and RS/HS confusion, weak HMAC keys, `aud` validation. [^2]
- [RFC 9068: JWT Profile for OAuth 2.0 Access Tokens](https://www.rfc-editor.org/rfc/rfc9068) — IETF, 2021. Backs: required claims and `at+jwt`. [^3]
- [RFC 10017: OAuth 2.0 for Browser-Based Applications (BCP 212)](https://www.rfc-editor.org/rfc/rfc10017) — IETF, August 2026. Backs: threat scenarios, architectures, BFF rules, CSRF options, browser storage, refresh-token rules, DPoP limits. [^4]
- [RFC 9700: Best Current Practice for OAuth 2.0 Security (BCP 240)](https://www.rfc-editor.org/rfc/rfc9700) — IETF, January 2025. Backs: refresh-token rotation and sender-constraining, access-token audience restriction. [^5]
- [RFC 7009: OAuth 2.0 Token Revocation](https://www.rfc-editor.org/rfc/rfc7009) — IETF, 2013. Backs: revocation endpoint duties and the self-contained token trade-off. [^6]
- [RFC 7662: OAuth 2.0 Token Introspection](https://www.rfc-editor.org/rfc/rfc7662) — IETF, 2015. Backs: `active` checks and the caching trade-off. [^7]
- [RFC 9449: OAuth 2.0 Demonstrating Proof of Possession (DPoP)](https://www.rfc-editor.org/rfc/rfc9449) — IETF, 2023. Backs: proof structure, `cnf.jkt`, untrusted code in the client. [^8]
- [draft-ietf-httpbis-rfc6265bis-22: Cookies: HTTP State Management Mechanism](https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-rfc6265bis-22) — IETF HTTP WG, 2025-12-01, Internet-Draft. Backs: 4096-octet limit, `__Host-`, `SameSite` and Lax-allowing-unsafe, 400-day cap. [^9]
- [draft-ietf-httpbis-layered-cookies-02](https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-layered-cookies-02) — IETF HTTP WG, 2026-05-21, Internet-Draft. Backs: `__Http-` and `__Host-Http-` prefixes. [^10]
- [Set-Cookie header](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie) — MDN, living, read 2026-11-22. Backs: `HttpOnly` still sent with `fetch`, prefixes, Lax default window. [^11]
- [JSON Web Token Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_Cheat_Sheet.html) — OWASP, living, read 2026-11-22. Backs: JWTs as stateless sessions, denylist keyed by `jti`/`iss`, malleability warning, Token Status List, JWS not confidential. [^12]
- [Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) — OWASP, living, read 2026-11-22. Backs: no tokens in Web Storage, server-side invalidation, logout of rotated IDs, `Clear-Site-Data`. [^13]
- [Cross-Site Request Forgery Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html) — OWASP, living, read 2026-11-22. Backs: `SameSite` limits and engine defaults, Fetch Metadata, double-submit, XSS defeats CSRF defences. [^14]
- [HTML5 Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html) — OWASP, living, read 2026-11-22. Backs: IndexedDB and Web Storage not confidential, no session IDs in local storage. [^15]
- [JSON Web Token Cheat Sheet for Java, at commit fd8d87b](https://github.com/OWASP/CheatSheetSeries/blob/fd8d87b8cde1a15148512ced24348c7e525a1b47/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.md) — OWASP, 2026-06-26 (historical version). Backs: the earlier `sessionStorage` + fingerprint advice. [^16]
- [OpenID Connect Back-Channel Logout 1.0 (incorporating errata set 1)](https://openid.net/specs/openid-connect-backchannel-1_0.html) — OpenID Foundation, 2023. Backs: Logout Token claims, `nonce` prohibited, refresh-token revocation on logout. [^17]
- [OpenID Continuous Access Evaluation Profile 1.0](https://openid.net/specs/openid-caep-1_0.html) — OpenID Foundation Shared Signals WG, 2025-08-29. Backs: `session-revoked` event. [^18]
- [draft-ietf-oauth-status-list (datatracker)](https://datatracker.ietf.org/doc/draft-ietf-oauth-status-list/) — IETF OAuth WG, revision 21, read 2026-11-22. Backs: Token Status List status, in the RFC Editor queue. [^19]
- [Full Third-Party Cookie Blocking and More](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/) — WebKit (John Wilander), 2020. Backs: 7-day cap on script-writable storage, home-screen exception. [^20]
- [Protecting Cookies with Device Bound Session Credentials](https://blog.google/security/protecting-cookies-with-device-bound-session-credentials/) — Google, 2026-04-09. Backs: DBSC mechanism and Chrome 146 availability on Windows. [^21]
- [Configure Refresh Token Rotation](https://auth0.com/docs/secure/tokens/refresh-tokens/configure-refresh-token-rotation) — Auth0 (Okta), living, read 2026-11-22. Backs: rotation overlap ("leeway") off by default, revocation on reuse. [^22]
- [RFC 6265: HTTP State Management Mechanism](https://www.rfc-editor.org/rfc/rfc6265) — IETF, 2011. Backs: "at least 4096 bytes per cookie". [^23]
- `research/_golden/LS-03/baseline/experiments/e1-revocation.mjs` and `e1-output.txt` — experiment E1, run 2026-11-22 on Node 24.22.1. [^E1]
- `research/_golden/LS-03/baseline/experiments/e2-cookies-server.mjs`, `e2-driver.mjs` and the four `e2-output-*.txt` files — experiment E2, run 2026-11-22 in Playwright Chromium 156, Firefox 151 and WebKit 26.5. [^E2]

## Related

- `knowledge/javascript/browser/browser-platform-deep-dive.md` — Web Storage and cookie basics in the browser platform.
- `knowledge/javascript/browser/resource-loading-windows-and-frames.md` — popups and iframes (used by OAuth flows) and clickjacking defences.
- `knowledge/ai-agents/model-context-protocol.md` — another OAuth deployment: MCP servers as resource servers.
