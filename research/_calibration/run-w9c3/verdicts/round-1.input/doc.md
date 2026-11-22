---
schema: deep-dive/v1
topic: web-apis
status: draft
applies-to: ["RFC 7519 (2015)", "RFC 6749 (2012) as updated by RFC 9700 (2025)", "RFC 7009 (2013)", "RFC 10017 (2026)", "jsonwebtoken (npm) <= 8.5.1 and 9.0.0", "Duende.BFF 4.0", "Okta refresh token guide (fetched 2026-11-22)", "dj-rest-auth with SimpleJWT (docs fetched 2026-11-22)", "Node 24.22.1 (probes)"]
last-updated: 2026-11-22
last-verified: 2026-11-22
synthesized-into: []
tags: [jwt, oauth, browser, bff, refresh-token-rotation, token-revocation, denylist, xss, csrf, cookies, dpop]
ranked-sources: true
---

# JWT storage and revocation in browser-based web applications

## Summary
**TL;DR:** RFC 10017 names three architectures for a browser app that uses OAuth and lists them in decreasing order of security: a Backend for Frontend (BFF), where a backend handles OAuth and forwards all requests; a token-mediating backend, where a backend handles OAuth but the app calls resource servers with the access token; and a browser-based OAuth client that handles all of OAuth in the browser ✅[^rfc10017]. None of the browser's persistent storage APIs (`localStorage`, `sessionStorage`, IndexedDB) can fully stop token exfiltration once attacker code runs in the app ✅[^rfc10017]. For revocation, a self-contained JWT is the hard case: §1 and §3 show why, and what servers do instead (short-lived access tokens, refresh tokens they can refuse or rotate, a `jti` denylist).
**Use this when:** choosing where a web front end keeps access and refresh tokens; designing logout, "log out everywhere" or account-disable behaviour for JWT-based APIs; reviewing cookie attributes, refresh token rotation or a denylist; judging advice such as "keep the token in memory" or "JWTs cannot be revoked".
**Depth:** the standards (RFC 7519, RFC 6749 with RFC 9700, RFC 7009, RFC 10017) with their MUST / SHOULD / MAY rules; the BFF, token-mediating and browser-only architectures; revocation endpoint, rotation, sender-constrained tokens and denylists step by step; three vendor or framework setups (Duende.BFF, Okta, dj-rest-auth) with real values; two Node 24 probes; XSS, CSRF, algorithm and lifetime pitfalls, and how each source conflict was settled.

## 1. Mental model

### The problem
A JSON Web Token (JWT) is "a string representing a set of claims as a JSON object that is encoded in a JWS or JWE", which lets the claims be signed or protected with a message authentication code (MAC) and/or encrypted ✅[^rfc7519]. A web app that receives one has two separate questions to answer:

1. **Storage.** Where can the token sit so that injected script (cross-site scripting, XSS) cannot read it, and a request forged from another site (cross-site request forgery, CSRF) cannot ride on it?
2. **Revocation.** How does the server stop a token before its `exp` time: at logout, after a password change, or after theft?

### The thesis
- **Storage:** the fewer tokens the browser holds, the less XSS can take. RFC 10017 says the BFF counters token theft by exposing no tokens to the browser app: "Even when the attacker gains full control over the application, there are simply no tokens to be stolen." ✅[^rfc10017]
- **Revocation:** RFC 7009 contrasts two token styles. An authorization server can revoke a handle-style access token, because the resource server relays each received token to it; for a self-contained token, "some (currently non-standardized) backend interaction between the authorization server and the resource server may be used when immediate access token revocation is desired" ✅[^rfc7009]. Its other design option is short-lived access tokens renewed with refresh tokens, which lets the authorization server limit how long a revoked access token stays in use ✅[^rfc7009].

### Analogy
A self-contained JWT is a festival wristband: every gate checks the hologram (the signature) and the printed date (`exp`) without phoning the box office. Cancelling one wristband needs either a list of cancelled numbers at every gate (a `jti` denylist), or wristbands that last an hour and are renewed at the box office, which can refuse (a refresh token). A handle token is a coat-check ticket: the number means nothing without the cloakroom's ledger, so the cloakroom can void it at once. The concrete artifact is the RFC 7519 example token decoded in §4.1.

### Scope
"Browser-based application" has RFC 10017's meaning: an application downloaded and executed in a web browser, usually written in JavaScript, also called a single-page application (SPA) ✅[^rfc10017]. Out of scope: the authorization code flow and Proof Key for Code Exchange (PKCE) step by step, OpenID Connect ID token validation, native and machine-to-machine clients, signing-key rotation, and XSS prevention itself. Web storage and cookie basics are in `javascript/browser/browser-platform-deep-dive.md` §7; `fetch` credentials and Cross-Origin Resource Sharing (CORS) are in `javascript/browser/network-requests-in-depth.md`.

## 2. Concept architecture

### Tokens
- **Access token:** "credentials used to access protected resources"; the token "may denote an identifier used to retrieve the authorization information or may self-contain the authorization information in a verifiable manner" ✅[^rfc6749].
- **Refresh token:** a credential used to obtain a new access token when the current one becomes invalid or expires; issuing one is optional for the authorization server, RFC 6749 says it denotes an identifier, and it is used only with authorization servers, never sent to resource servers ✅[^rfc6749].
- **Bearer token:** the "bearer" type is used by simply including the access token string in the request, as in `Authorization: Bearer mF_9.B5f-4.1JqM` ✅[^rfc6749]. In browser-based clients the refresh token is typically a bearer token too, unless the app explicitly uses Demonstrating Proof of Possession (DPoP, RFC 9449) ✅[^rfc10017].
- **Registered claims** that revocation and validation use: `exp`, `nbf`, `iat`, `jti`, `aud`; their meanings and rules are in §5.

### Three architectures
- **BFF:** the backend acts as a confidential OAuth client, manages the access and refresh tokens in a cookie-based session so no token reaches the browser app, and forwards every request to the resource server with the right access token added ✅[^rfc10017]. Attacker script in the page can still send requests to the BFF from within the user's browser, but `HttpOnly` cookies stop it from reading the session state itself ✅[^rfc10017].
- **Token-mediating backend:** the backend obtains the tokens as a confidential client and gives the browser app the access token, which it uses to call resource servers directly; attacker script cannot abuse refresh tokens or obtain a fresh set of tokens, but it can steal the access token from client-side storage or request a fresh one from the backend ✅[^rfc10017].
- **Browser-based OAuth client:** the browser app is the OAuth client; its pitfalls (persistent theft, new silent flows) are in §6.

### Revocation building blocks
- **Revocation endpoint (RFC 7009):** lets a client invalidate its tokens if the end user logs out, changes identity, or uninstalls the application ✅[^rfc7009].
- **Sender-constrained token:** an access token scoped to one sender, which must show knowledge of a secret before the resource server accepts it; RFC 9700 names two methods in use, mutual TLS certificate-bound tokens (RFC 8705, the client identified by the fingerprint of its public key) and DPoP (RFC 9449, an application-level key pair and signing, usable by public clients) ✅[^rfc9700].
- **Denylist:** a list of revoked token identifiers that the token's consumer checks (§3.6).
- **Refresh token rotation:** defined with its detection rule in §3.3.

## 3. How it works

### 3.1 Why a valid signature outlives a logout
A stateless API trusts a JWT "because the signature checks out and the exp claim is in the future"; it never asks a database whether the session is still good, which is why the token cannot be taken back ✅[^workos]. Each way out below brings back some server state: the authorization server's record of revoked or rotated tokens (§3.2, §3.3), a BFF session (§3.4), or a list at the resource server (§3.6).

### 3.2 Revoking at the authorization server (RFC 7009)
1. The client POSTs the token, optionally with a `token_type_hint`, to the revocation endpoint (example in §4.2).
2. The authorization server validates the client credentials (for a confidential client), then checks that the token was issued to the client asking, and refuses the request if either check fails ✅[^rfc7009].
3. It invalidates the token immediately; in practice there can be a propagation delay in which some servers know and others do not, and clients must not use the token after an HTTP 200 response ✅[^rfc7009].
4. Access tokens of the same grant: if the authorization server does not support access token revocation, they are not immediately invalidated when the matching refresh token is revoked ✅[^rfc7009]. The cascade rules are in §5.

### 3.3 Refresh token rotation and replay detection
1. With rotation, the authorization server issues a new refresh token with every access token refresh response; the previous one is invalidated, but the server keeps the relationship between them ✅[^rfc9700].
2. Detection works when a stolen refresh token is used by both the attacker and the legitimate client: one of them presents an invalidated token, the server cannot tell which, and it revokes the active refresh token, which stops the attack at the cost of forcing the legitimate client to obtain a fresh grant ✅[^rfc9700].
3. With short-lived access tokens, the refresh exchange is also where revocation happens: it "means refusing to issue the next access token", at the refresh boundary instead of mid-token ✅[^workos].

The rotation and lifetime rules are in §5; a worked lifetime cap is in §4.3.

### 3.4 The BFF session and its CSRF defense
1. **Session state.** With a client-side session (data pushed to the browser in a signed, optionally encrypted object) used in a BFF, the cookie only serves to obtain the user's tokens, so all control and revocation follow from the tokens: it suffices to revoke the user's access token and/or refresh token, without invalidating the cookie-based session ✅[^rfc10017].
2. **CSRF.** Because the interactions between the app and the BFF rely on cookies, the BFF has to account for CSRF (the MUST is in §5); the `SameSite=Strict` attribute ensures its cookies are included only on same-site requests ✅[^rfc10017].
3. A custom request header closes the gap that CORS leaves for requests sent without a preflight: cross-origin requests that carry a custom header always need a preflight, which makes CORS an effective CSRF defense ✅[^rfc10017].

### 3.5 Sender-constrained tokens in a browser
1. The client has to prove possession of a private key to use the token, so a stolen token is not usable by itself; RFC 10017 says this shifts the challenge from storing the token securely to storing the private key securely ✅[^rfc10017].
2. In a browser OAuth client using DPoP, the signing key is a non-extractable `CryptoKeyPair` stored in IndexedDB, which "effectively prevents scenarios where the XSS attacker exfiltrates the application's tokens" ✅[^rfc10017].
3. It does not stop the attacker from running a new flow to get fresh tokens; even when DPoP is mandatory, the attacker can bind the fresh tokens to a key pair under its own control ✅[^rfc10017].

### 3.6 A `jti` denylist at the resource server
1. A token consumer may keep a JWT denylist as a simple form of replay protection or "as a workaround for the “stateless session” invalidation problem"; OWASP's sketch keys it on the (`jti`, `iss`) pair, inserts each entry with the token's `exp`, and checks a token by looking up the same pair ✅[^owasp].
2. Keying it on the raw JWT or its SHA-256 hash "is not safe": an attacker holding a revoked JWT may produce another representation that still passes signature verification, through non-strict JWT parsing or, for ECDSA (Elliptic Curve Digital Signature Algorithm) JWTs, signature malleability ✅[^owasp]. §4.7 shows one such case.

## 4. Worked examples

### 4.1 Reading the RFC 7519 example token
RFC 7519 §3.1 gives the header `{"typ":"JWT","alg":"HS256"}`, the claims `{"iss":"joe","exp":1300819380,"http://example.com/is_root":true}` and the complete token below ✅[^rfc7519].

```js verify id=probe-01 runtime=node24 expect="stdout:exp=2011-03-22T18:43:00.000Z expired=true"
// RFC 7519 section 3.1 example JWT, joined without the display line breaks.
const jwt = 'eyJ0eXAiOiJKV1QiLA0KICJhbGciOiJIUzI1NiJ9' +
  '.eyJpc3MiOiJqb2UiLA0KICJleHAiOjEzMDA4MTkzODAsDQogImh0dHA6Ly9leGFtcGxlLmNvbS9pc19yb290Ijp0cnVlfQ' +
  '.dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const [h, p] = jwt.split('.');
const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
const claims = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
// No key was used above: the payload of a signed JWT is only base64url-encoded.
console.log(`alg=${header.alg} iss=${claims.iss} is_root=${claims['http://example.com/is_root']}`);
const now = Math.floor(Date.now() / 1000);
// RFC 7519 4.1.4: the current time MUST be before exp.
console.log(`exp=${new Date(claims.exp * 1000).toISOString()} expired=${!(now < claims.exp)}`);
```

On Node 24.22.1 (image `node:24.22.1-alpine`, kernel `7.2.12-orbstack-00394-gbecdd6130068`), this probe decoded the header and claims with no key and printed `alg=HS256 iss=joe is_root=true` and `exp=2011-03-22T18:43:00.000Z expired=true` ✅[^probe-01]. The first line is why a signed JWT is not a place for secrets; the second is the only "revocation" a bare JWT has.

### 4.2 Revoking a refresh token (RFC 7009)
The RFC's example request, and its rule that the server answers HTTP 200 whether the token was revoked or the client sent an invalid token ✅[^rfc7009]. The second block is the status line that rule gives; the RFC shows no response example.

```http
POST /revoke HTTP/1.1
Host: server.example.com
Content-Type: application/x-www-form-urlencoded
Authorization: Basic czZCaGRSa3F0MzpnWDFmQmF0M2JW

token=45ghiukldjahdnhzdauz&token_type_hint=refresh_token
```

```http
HTTP/1.1 200 OK
```

### 4.3 A refresh token lifetime that rotation cannot stretch (RFC 10017)
A user authorizes an app, which gets a 10-minute access token and an 8-hour refresh token. After 10 minutes the app refreshes and gets a new 10-minute access token and a new refresh token that lasts 7 hours 50 minutes; this repeats until 8 hours have passed, and then the refresh request fails and the app must start a new Authorization Code flow ✅[^rfc10017].

### 4.4 Okta: rotation and reuse detection
- Rotation is the default for SPAs when you create or edit one; if a used refresh token is presented again, Okta immediately invalidates the most recently issued refresh token and all access tokens issued since the user authenticated ✅[^okta].
- The grace period, during which the previous token stays valid after rotation, defaults to 30 seconds and can be set from 0 through 60; in the app's `settings.oauthClient`, the `refresh_token` object takes a `rotation_type` of `ROTATE` or `STATIC` and a `leeway` of 0 through 60, as in `"refresh_token": { "rotation_type": "ROTATE", "leeway": 30 }` ✅[^okta].
- The refresh call is a form POST to `/oauth2/v1/token` with `grant_type=refresh_token`, `scope=offline_access%20openid` and the `refresh_token`; the example response carries `"token_type": "Bearer"` and `"expires_in": 3600` ✅[^okta].

### 4.5 Duende.BFF: a server-side session behind one cookie
- The BFF 4.0 example of a host that stores the session server-side uses `ResponseType = "code"`, `SaveTokens = true` and the `offline_access` scope for refresh tokens, and sets the cookie to `SameSite=Lax` because its identity provider is on a different site; the comment says `Strict` would stop the cookie being sent after login, and recommends `Strict` when the identity provider is on the same site as the BFF ✅[^duende].
- The front end sends `X-CSRF: 1` on every request to a BFF API endpoint, or the BFF answers 401 Unauthorized; local API routes must be marked with `.AsBffApiEndpoint()`, without which the header is not enforced ✅[^duende].

This is the custom-header defense of §3.4 with a static value.

### 4.6 dj-rest-auth: both JWTs in `HttpOnly` cookies
```python
REST_AUTH = {
    'USE_JWT': True,
    'JWT_AUTH_COOKIE': 'access',
    'JWT_AUTH_REFRESH_COOKIE': 'refresh',
    'JWT_AUTH_HTTPONLY': True,
    'JWT_AUTH_SECURE': False, # True in production!
    'JWT_AUTH_SAMESITE': 'Lax',
    'JWT_AUTH_RETURN_EXPIRATION': True,
}
SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(minutes=15),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=7),
    'ROTATE_REFRESH_TOKENS': True,
    'BLACKLIST_AFTER_ROTATION': True,
    'UPDATE_LAST_LOGIN': True,
}
```
- These are the guide's settings from its step "Configure Django Settings", whose comment says `JWT_AUTH_SECURE` must be `True` in production ✅[^djra].
- At login the API sets `HttpOnly` cookies for both tokens; when a request comes back 401 because the access cookie expired, the SPA calls `POST /token/refresh/` with the refresh cookie and receives a new access cookie ✅[^djra].
- The production example sets `JWT_AUTH_SECURE: True`, an access token lifetime of 5 minutes and a refresh token lifetime of 1 day, and the checklist asks for 5 to 15 minutes ✅[^djra].
- With SimpleJWT's `token_blacklist` app installed, a user's refresh token is blacklisted at logout and cannot be reused ✅[^djra].

This is not a BFF: the JWTs themselves travel in the cookies, and the API reads them there.

### 4.7 A denylist bypass through a re-encoded signature
```js verify id=probe-02 runtime=node24 expect="stdout:hash-denylist-blocks-variant=false jti-denylist-blocks-variant=true"
const crypto = require('node:crypto');
const key = crypto.randomBytes(32);
const b64u = (x) => Buffer.from(x).toString('base64url');
const sign = (claims) => {
  const input = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' })) + '.' + b64u(JSON.stringify(claims));
  return input + '.' + crypto.createHmac('sha256', key).update(input).digest('base64url');
};
// A lenient verifier: decodes the signature to bytes and compares bytes.
const verify = (token) => {
  const [h, p, s] = token.split('.');
  const expected = crypto.createHmac('sha256', key).update(h + '.' + p).digest();
  const given = Buffer.from(s, 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  return Math.floor(Date.now() / 1000) < claims.exp ? claims : null;
};
const token = sign({ iss: 'https://issuer.example', jti: 'a1b2c3', exp: Math.floor(Date.now() / 1000) + 300 });
// Flip the lowest of the 2 spare bits of the last base64url character of the 32-byte signature (43 chars = 258 bits).
const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const variant = token.slice(0, -1) + A[A.indexOf(token.at(-1)) ^ 1];
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const hashDenylist = new Set([sha(token)]);                                    // keyed on SHA-256(token)
const jtiDenylist = new Set(['a1b2c3|https://issuer.example']);                // keyed on (jti, iss)
const c = verify(variant);
console.log(`same-string=${token === variant} both-verify=${verify(token) !== null && c !== null}`);
console.log(`hash-denylist-blocks-variant=${hashDenylist.has(sha(variant))} jti-denylist-blocks-variant=${jtiDenylist.has(`${c.jti}|${c.iss}`)}`);
```

On Node 24.22.1 (image `node:24.22.1-alpine`, kernel `7.2.12-orbstack-00394-gbecdd6130068`), the verifier written for this probe, which decodes the signature with `Buffer.from(s, 'base64url')` and compares bytes, accepted both the issued token and a copy whose last signature character differs in the lower of its two unused bits; the SHA-256-keyed list missed the copy and the (`jti`, `iss`)-keyed list caught it, printing `same-string=false both-verify=true` and `hash-denylist-blocks-variant=false jti-denylist-blocks-variant=true` ✅[^probe-02]. A verifier that compares the base64url strings instead would reject the copy; the probe shows one lenient decoder, not every library.

## 5. Reference & invariants

### JWT processing (RFC 7519)

| Claim or step | Rule | |
|---|---|---|
| `exp`, `nbf`, `iat` | A JWT MUST NOT be accepted on or after `exp`, nor before `nbf`; implementers MAY allow a small leeway, usually no more than a few minutes, for clock skew; `iat` is the time of issue and can be used to determine the token's age; all are NumericDate values and OPTIONAL | ✅[^rfc7519] |
| `aud` | Each principal intended to process the JWT MUST identify itself with a value in `aud`; when `aud` is present and the processor is not in it, the JWT MUST be rejected; the claim is OPTIONAL | ✅[^rfc7519] |
| `jti` | The value MUST be assigned so that an accidental collision is negligibly likely, and with several issuers collisions MUST be prevented across issuers too; it "can be used to prevent the JWT from being replayed"; OPTIONAL | ✅[^rfc7519] |
| Validation | If any validation step fails, the JWT MUST be rejected; which algorithms are acceptable is an application decision, and a JWT that validates with an unacceptable algorithm SHOULD be rejected | ✅[^rfc7519] |

### OAuth tokens (RFC 6749, updated by RFC 9700)

| Subject | Rule | |
|---|---|---|
| Refresh token storage | MUST be kept confidential in transit and storage, shared only between the authorization server and its client, and sent only over TLS (Transport Layer Security); the authorization server MUST maintain the binding between a refresh token and its client | ✅[^rfc6749] |
| New refresh token on refresh | The authorization server MAY issue one; the client MUST then discard the old refresh token, and the server MAY revoke it | ✅[^rfc6749] |
| Sender-constraining | Authorization and resource servers SHOULD sender-constrain access tokens (mutual TLS or DPoP); refresh tokens for public clients MUST be sender-constrained or use refresh token rotation | ✅[^rfc9700] |
| Audience | Access tokens SHOULD be audience-restricted to one resource server or, if that is not feasible, to a small set; a resource server MUST refuse a token not meant for it; the `aud` claim MAY carry the restriction | ✅[^rfc9700] |
| Security events and idle refresh tokens | Authorization servers MAY revoke refresh tokens automatically on a password change or a logout at the authorization server; refresh tokens SHOULD expire after the client has been inactive for some time, a period the server chooses | ✅[^rfc9700] |

### Browser-based applications (RFC 10017)

| Subject | Rule | |
|---|---|---|
| BFF cookies | MUST set `Secure`; MUST set `HttpOnly`; SHOULD set `SameSite=Strict`; SHOULD use `Path=/`; SHOULD NOT set `Domain`; SHOULD give the cookie name a prefix showing it was set over HTTP, for example `__Host-Http-` from the `[COOKIES]` reference, which is draft-ietf-httpbis-layered-cookies-02 (21 May 2026), an Internet-Draft marked work in progress | ✅[^rfc10017] |
| CSRF | The BFF MUST implement a proper CSRF defense; when it relies on CORS it SHOULD require a custom request header, and when it uses one it MUST ensure every incoming request carries that header | ✅[^rfc10017] |
| Refresh tokens issued to browser-based apps | Authorization servers MUST rotate refresh tokens on each use OR sender-constrain them; MUST set a maximum lifetime OR expire unused refresh tokens; MUST NOT let a rotated refresh token outlive the initial one when it has a preset expiry | ✅[^rfc10017] |
| Logout | Authorization servers SHOULD link the refresh token's lifetime to the user's session at the authorization server, so logout invalidates the refresh tokens issued to browser-based apps | ✅[^rfc10017] |
| Script-set cookies | Storing a token in a cookie through the JavaScript Cookie API is NOT RECOMMENDED, because the browser also sends that cookie to the app's own server | ✅[^rfc10017] |

### Revocation endpoint (RFC 7009)

| Subject | Rule | |
|---|---|---|
| Support and transport | Implementations MUST support revoking refresh tokens and SHOULD support revoking access tokens; revocation endpoint URLs MUST be HTTPS URLs | ✅[^rfc7009] |
| Cascade | Revoking a refresh token SHOULD also invalidate all access tokens of the same grant when the server supports access token revocation; revoking an access token MAY revoke its refresh token | ✅[^rfc7009] |

### A library rule: jsonwebtoken (CVE-2022-23540)

| Versions | Rule | |
|---|---|---|
| `jsonwebtoken` <= 8.5.1 | Signature validation can be bypassed because `jwt.verify()` defaults to the `none` algorithm; an app is affected if all three hold: a token with no signature arrives, no algorithms are specified, and a falsy secret or key (`null`, `false`, `undefined`) is passed; 9.0.0 removes the default support for `none`, which must then be named in the options if needed | ✅[^ghsa] |

## 6. Trade-offs, pitfalls & misconceptions

### "Keep the token in memory and XSS cannot get it"
- The misconception: some SPA OAuth libraries keep the access token in memory and isolate the refresh token in a Web Worker, which looks hard to steal. A proof of concept that redefines `MessageChannel` intercepts each access token the Web Worker sends back, so the attacker steals access tokens for as long as the app runs in the user's browser ✅[^pws]. The author's advice is not to worry much about storage: in-memory or Web Worker storage "makes an attack harder, but it never solves the root problem" (XSS itself) ✅[^pws]. This blog is Rank 6; RFC 10017's §8.5 statement in the Summary is the Rank 1 version of the same point.
- Persistent theft: injected code that steals the latest tokens on a timer always holds the newest ones, which "already suffices to counter typical defenses against token theft, such as short lifetimes or refresh token rotation"; it can also make sure the app never uses the latest refresh token (clear the tokens, wait until the app closes or goes offline), so no reuse is ever detected ✅[^rfc10017].
- New tokens: attacker code can ignore stored tokens altogether, open a hidden iframe and run a silent Authorization Code flow on the user's existing authorization-server session, getting a new, independent access token; this relies on the authorization server supporting silent frame-based flows ✅[^rfc10017].

### Rotation detects some theft, not all
RFC 9700's detection (§3.3) needs both parties to keep using the token; RFC 10017's persistent-theft case is the one where the legitimate app stops using it. The two are conditions, not a contradiction, and both are Rank 1. The Rank 4 and Rank 6 sources split along the same line. The vendor post says a replayed stale refresh token is the signal by which rotation detects theft ✅[^workos]; the Rank 6 proof of concept above only intercepts new access tokens and replays no refresh token, which is the RFC 10017 case.

### Short lifetimes versus a denylist
- With short access tokens, "instant" revocation really means "within one token lifetime", so the lifetime is a security-versus-latency choice ✅[^workos].
- A server-side denylist is precise, but every request then does a lookup, the database round-trip JWTs were adopted to avoid ✅[^workos].
- Stateless JWT sessions: OWASP says JWT user sessions need a way to invalidate sessions, such as a deny list, after which they are no longer completely stateless, and suggests considering a plain session system ✅[^owasp].
- The lifetimes in this doc's sources differ: 10 minutes for access and 8 hours for refresh in RFC 10017's example (§4.3), `expires_in: 3600` in Okta's example response (§4.4), and 5 to 15 minutes in dj-rest-auth's checklist (§4.6). Only dj-rest-auth's is a recommendation; the other two are examples.

### Sender-constrained tokens and XSS
RFC 9700 says sender-constraining is undermined when an attacker gets both the token and the key material, in particular through cross-site scripting when the client runs in the browser ✅[^rfc9700]. RFC 10017's non-extractable key (§3.5) is the case where script cannot reach the key, so both Rank 1 statements hold under their own condition; and §3.5 step 3 shows what a key does not stop.

### Cookies: SameSite and Domain
- `SameSite=Strict` is adequate only if the BFF is never same-site with another app: `https://a.example.com` and `https://b.example.com` share the site `example.com`, so a subdomain takeover of `b.example.com` can enable CSRF against the BFF on `a.example.com` ✅[^rfc10017].
- dj-rest-auth calls `Lax` its default and recommended value and says `Strict` "may break some flows", and documents `JWT_AUTH_COOKIE_DOMAIN: '.example.com'` to share cookies across subdomains ✅[^djra]. For a BFF, RFC 10017's SHOULD `SameSite=Strict` and SHOULD NOT `Domain` (§5, Rank 1) govern; dj-rest-auth's `Lax` holds for its own cookie setup, and Duende's `Lax` (§4.5) for an identity provider on another site, where a `Strict` cookie would not be sent after login.
- Encrypting a client-side session cookie keeps the tokens out of plaintext on disk, but an attacker can still use the encrypted cookie in a session hijacking attack ✅[^rfc10017].

### `alg: none` and algorithm confusion
- A verifier that reads the `alg` header to pick the algorithm lets the attacker choose how the signature is checked; some libraries treated `alg: none` tokens as validly signed, so anyone could create tokens with any payload ✅[^auth0].
- Algorithm confusion: a server expecting an RSA-signed token that receives an HMAC (hash-based message authentication code) one treats its RSA public key as the HMAC secret, so anyone with the public key can forge tokens that pass, provided the key string matches the server's exactly, format and line breaks included ✅[^auth0].
- The 2015 post says most implementations by then failed `none` tokens "if a secret key was provided" ✅[^auth0]. CVE-2022-23540 (§5, Rank 3) is the case that check leaves open: no key at all (a falsy one) and no algorithm list. The Rank 3 advisory governs; the Rank 4 statement holds only when a key is passed.

### Older text that a newer Rank 1 source replaces
- RFC 6749 says that, when client authentication is not possible, the authorization server SHOULD deploy other means to detect refresh token abuse, and gives rotation as something it "could employ" ✅[^rfc6749]. RFC 9700 updates RFC 6749 ✅[^rfc9700], and its MUST for public clients (§5) governs.
- RFC 9700 says refresh tokens SHOULD expire after client inactivity (§5); for browser-based apps RFC 10017's MUST (cap the lifetime or expire unused tokens) governs, since RFC 10017 "expands on and further restricts various recommendations given in [RFC9700]" ✅[^rfc10017].
- RFC 7519 makes `aud` OPTIONAL while RFC 9700 says access tokens SHOULD be audience-restricted (§5). They do not clash: the first is the JWT format, the second is OAuth access-token policy.
- RFC 10017 says revoking the tokens suffices in a client-side BFF session (§3.4), and RFC 7009 says access tokens may outlive a revoked refresh token (§3.2). Both hold: the BFF statement removes the need to kill the cookie, while how fast access stops still depends on the RFC 7009 conditions.

## References
- [RFC 10017: OAuth 2.0 for Browser-Based Applications](https://www.rfc-editor.org/rfc/rfc10017.html) — IETF, 2026. Rank 1. Backs: the three architectures, storage limits, BFF session and cookie rules, CSRF defenses, DPoP in the browser, refresh token rules and the lifetime example, attack scenarios. [^rfc10017]
- [RFC 7519: JSON Web Token (JWT)](https://www.rfc-editor.org/rfc/rfc7519.html) — IETF, 2015. Rank 1. Backs: the JWT definition, the example token, registered claim and validation rules. [^rfc7519]
- [RFC 9700 - Best Current Practice for OAuth 2.0 Security](https://datatracker.ietf.org/doc/html/rfc9700) — IETF, 2025. Rank 1. Backs: sender-constrained tokens, refresh token rotation and replay detection, audience restriction, refresh token revocation and expiry, its update of RFC 6749. [^rfc9700]
- [RFC 7009 - OAuth 2.0 Token Revocation](https://datatracker.ietf.org/doc/html/rfc7009) — IETF, 2013. Rank 1. Backs: the revocation endpoint, its request and response, handle versus self-contained tokens. [^rfc7009]
- [RFC 6749 - The OAuth 2.0 Authorization Framework](https://datatracker.ietf.org/doc/html/rfc6749) — IETF, 2012. Rank 1. Backs: access, refresh and bearer token definitions, refresh token confidentiality and replacement, the original rotation text. [^rfc6749]
- [Getting Started - Single Frontend](https://docs.duendesoftware.com/bff/getting-started/single-frontend/) — Duende Software, 2026. Rank 1. Backs: the Duende.BFF example (§4.5). [^duende]
- [Refresh access tokens and rotate refresh tokens](https://developer.okta.com/docs/guides/refresh-tokens/main/) — Okta, living. Rank 1. Backs: Okta rotation, reuse detection, grace period, refresh request and response (§4.4). [^okta]
- [JWT & Cookies](https://dj-rest-auth.readthedocs.io/en/latest/guides/jwt-cookies/) — dj-rest-auth, living. Rank 1. Backs: the dj-rest-auth settings, flow, blacklist and SameSite advice (§4.6, §6). [^djra]
- [jsonwebtoken vulnerable to signature validation bypass due to insecure default algorithm in jwt.verify() · CVE-2022-23540](https://github.com/advisories/GHSA-qwph-4952-7xr6) — GitHub Advisory Database, 2022. Rank 3. Backs: CVE-2022-23540 conditions and fix. [^ghsa]
- [JSON Web Token - OWASP Cheat Sheet Series](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_Cheat_Sheet.html) — OWASP, living. Rank 3. Backs: the denylist, its key, the stateless-session critique. [^owasp]
- [Critical vulnerabilities in JSON Web Token libraries](https://auth0.com/blog/critical-vulnerabilities-in-json-web-token-libraries/) — Tim McLean on the Auth0 blog, 2015. Rank 4. Backs: `alg: none` and algorithm confusion. [^auth0]
- [Stateless JWTs have a logout problem — and enterprise customers will find it](https://workos.com/blog/stateless-jwt-logout-problem) — WorkOS, 2026. Rank 4. Backs: why a stateless JWT outlives logout, revocation at the refresh boundary, the lifetime and denylist trade-offs, token-family revocation. [^workos]
- [Why avoiding LocalStorage for tokens is the wrong solution](https://pragmaticwebsecurity.com/articles/oauthoidc/localstorage-xss.html) — Philippe De Ryck, Pragmatic Web Security, 2020. Rank 6. Backs: the in-memory and Web Worker misconception (§6 only). [^pws]
- `probes/probe-01.js` — verify, node24 (`node:24.22.1-alpine`), prints `alg=HS256 iss=joe is_root=true` and `exp=2011-03-22T18:43:00.000Z expired=true`. [^probe-01]
- `probes/probe-02.js` — verify, node24 (`node:24.22.1-alpine`), prints `same-string=false both-verify=true` and `hash-denylist-blocks-variant=false jti-denylist-blocks-variant=true`. [^probe-02]

## Related
- `javascript/browser/browser-platform-deep-dive.md` — §7: `localStorage`, `sessionStorage`, `document.cookie`, and cookie attributes for sessions.
- `javascript/browser/network-requests-in-depth.md` — the `fetch` `credentials` option and cross-origin cookies with `Access-Control-Allow-Credentials`.
- `ai-agents/model-context-protocol.md` — §3.5: OAuth 2.1 roles, bearer tokens in the `Authorization` header, audience validation, refresh token confidentiality for MCP (Model Context Protocol) servers.
- `kubernetes/security/rbac-and-service-accounts.md` — a decoded service-account JWT and bound tokens, a non-browser example.
- `gcp/gke-lens-setup.md` — legacy: an access-token and refresh-token split in a command-line tool.
