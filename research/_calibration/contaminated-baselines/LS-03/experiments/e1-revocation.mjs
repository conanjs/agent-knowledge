// E1: JWT revocation strategies, run with plain Node (no dependencies): node e1-revocation.mjs
// Simulated clock (seconds) so no test sleeps. Every scenario prints PASS/FAIL lines that the deep dive quotes.
import crypto from 'node:crypto';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const json64 = (o) => b64u(JSON.stringify(o));
let NOW_MS = Date.UTC(2026, 10, 22, 9, 0, 0); // 2026-11-22 09:00:00 UTC
const now = () => Math.floor(NOW_MS / 1000);
const advance = (sec) => { NOW_MS += sec * 1000; };
const log = (...a) => console.log(...a);

// ---- keys ----------------------------------------------------------------------------------------
const hsKey = crypto.randomBytes(32); // 256-bit random secret (RFC 8725 3.5: never a password)
const ec1 = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const ec2 = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
let acceptedKeys = { k1: { alg: 'ES256', key: ec1.publicKey }, k2: { alg: 'ES256', key: ec2.publicKey }, h1: { alg: 'HS256', key: hsKey } };

function sign(header, payload, priv) {
  const input = `${json64(header)}.${json64(payload)}`;
  let sig;
  if (header.alg === 'HS256') sig = crypto.createHmac('sha256', priv).update(input).digest();
  else if (header.alg === 'ES256') sig = crypto.sign('sha256', Buffer.from(input), { key: priv, dsaEncoding: 'ieee-p1363' });
  else if (header.alg === 'RS256') sig = crypto.sign('sha256', Buffer.from(input), priv);
  return `${input}.${b64u(sig)}`;
}

// Verify: algorithm allowlist bound to the key (RFC 8725 3.1), then exp/iss/aud, then the caller's state checks.
function verify(token, { aud = 'api', iss = 'https://as.example', leeway = 0 } = {}) {
  const [h, p, s] = token.split('.');
  const header = JSON.parse(Buffer.from(h, 'base64url'));
  const entry = acceptedKeys[header.kid];
  if (!entry) return { ok: false, why: `unknown kid ${header.kid}` };
  if (header.alg !== entry.alg) return { ok: false, why: `alg ${header.alg} not allowed for kid ${header.kid}` };
  const input = Buffer.from(`${h}.${p}`);
  const sig = Buffer.from(s ?? '', 'base64url');
  let good;
  if (entry.alg === 'HS256') good = sig.length === 32 && crypto.timingSafeEqual(sig, crypto.createHmac('sha256', entry.key).update(input).digest());
  else good = crypto.verify('sha256', input, { key: entry.key, dsaEncoding: 'ieee-p1363' }, sig);
  if (!good) return { ok: false, why: 'bad signature' };
  const c = JSON.parse(Buffer.from(p, 'base64url'));
  if (!(now() < c.exp + leeway)) return { ok: false, why: 'expired' };
  if (c.iss !== iss) return { ok: false, why: 'wrong iss' };
  if (c.aud !== aud) return { ok: false, why: 'wrong aud' };
  return { ok: true, claims: c };
}

const issueAT = (sub, extra = {}, kid = 'k1', ttl = 600) =>
  sign({ alg: 'ES256', typ: 'at+jwt', kid }, { iss: 'https://as.example', sub, aud: 'api', client_id: 'web', iat: now(), exp: now() + ttl, jti: crypto.randomUUID(), ...extra }, kid === 'k1' ? ec1.privateKey : ec2.privateKey);

const show = (label, r) => log(`  ${r.ok ? 'ACCEPTED' : 'REJECTED'}  ${label}${r.ok ? '' : `  (${r.why})`}`);

// ---- A: logout that only deletes the client copy --------------------------------------------------
log('A. Stateless JWT, "logout" = browser deletes its copy; attacker kept a copy');
{
  const t = issueAT('alice');
  const attackerCopy = t; // exfiltrated earlier (XSS, log, malware)
  // client "logs out": deletes its copy; the server has no state to change
  advance(300);
  show('attacker copy 5 min after logout', verify(attackerCopy));
  advance(301);
  show('attacker copy at exp + 1 s', verify(attackerCopy));
  show('attacker copy at exp + 1 s with 60 s leeway', verify(attackerCopy, { leeway: 60 }));
}

// ---- B: jti denylist with TTL = remaining lifetime ------------------------------------------------
log('B. Denylist keyed by (iss, jti), entry kept until the token exp');
{
  const deny = new Map(); // key -> expiresAt (s)
  const isDenied = (c) => { const k = `${c.iss}|${c.jti}`; const e = deny.get(k); if (e !== undefined && e <= now()) deny.delete(k); return deny.has(k); };
  const check = (t) => { const r = verify(t); if (r.ok && isDenied(r.claims)) return { ok: false, why: 'jti denylisted' }; return r; };
  const t = issueAT('alice');
  const c = verify(t).claims;
  deny.set(`${c.iss}|${c.jti}`, c.exp);
  show('revoked token right after revocation', check(t));
  advance(601);
  isDenied(c);
  log(`  denylist size after token exp: ${deny.size} (entry pruned; the token is rejected as expired anyway)`);
  show('revoked token after exp', check(t));
}

// ---- C: per-user "tokens issued before X are invalid" -----------------------------------------------
log('C. Per-user cut-off timestamp vs. per-user version counter');
{
  // Second-resolution iat (RFC 7519 NumericDate is seconds). Logout and re-login inside the same second.
  NOW_MS = Math.floor(NOW_MS / 1000) * 1000 + 100; // xx:xx:xx.100
  const before = issueAT('bob');
  NOW_MS += 300; // .400 logout
  const cutoff = now(); // stored in seconds
  NOW_MS += 400; // .800 re-login, same second
  const after = issueAT('bob');
  const strict = (t) => { const r = verify(t); return r.ok && r.claims.iat < cutoff ? { ok: false, why: 'iat < cutoff' } : r; };
  const inclusive = (t) => { const r = verify(t); return r.ok && r.claims.iat <= cutoff ? { ok: false, why: 'iat <= cutoff' } : r; };
  show('old token (before logout), rule iat <  cutoff', strict(before));
  show('new token (after re-login), rule iat <  cutoff', strict(after));
  show('old token (before logout), rule iat <= cutoff', inclusive(before));
  show('new token (after re-login), rule iat <= cutoff', inclusive(after));
  // Version counter: no clock involved
  const userVer = { bob: 1 };
  const t1 = issueAT('bob', { ver: userVer.bob });
  userVer.bob += 1; // logout-everywhere / password change
  const t2 = issueAT('bob', { ver: userVer.bob });
  const byVer = (t) => { const r = verify(t); return r.ok && r.claims.ver !== userVer[r.claims.sub] ? { ok: false, why: `ver ${r.claims.ver} != ${userVer[r.claims.sub]}` } : r; };
  show('old token, version check', byVer(t1));
  show('new token, version check', byVer(t2));
}

// ---- D: refresh token rotation with reuse detection -----------------------------------------------
log('D. Refresh token rotation, reuse detection, absolute lifetime cap (RFC 9700 4.14.2, RFC 10017 6.3.2.3)');
{
  const ABS = 8 * 3600; // 8 h absolute lifetime of the grant
  const store = new Map(); // rt -> { family, used, exp }
  const families = new Map(); // family -> { revoked, exp }
  const login = () => { const fam = crypto.randomUUID(); families.set(fam, { revoked: false, exp: now() + ABS }); return mint(fam); };
  const mint = (fam) => { const rt = b64u(crypto.randomBytes(32)); store.set(rt, { family: fam, used: false, exp: families.get(fam).exp }); return rt; };
  const refresh = (rt) => {
    const e = store.get(rt);
    if (!e) return { ok: false, why: 'unknown' };
    const fam = families.get(e.family);
    if (fam.revoked) return { ok: false, why: 'family revoked' };
    if (now() >= e.exp) return { ok: false, why: 'absolute lifetime reached' };
    if (e.used) { fam.revoked = true; return { ok: false, why: 'REUSE detected -> whole family revoked' }; }
    e.used = true;
    return { ok: true, rt: mint(e.family), expIn: e.exp - now() };
  };
  // D1: attacker replays an old token after the client rotated
  let rt1 = login();
  const stolen = rt1;
  advance(600);
  const r2 = refresh(rt1); show(`client refresh #1 (new RT expires in ${r2.expIn} s, not reset to ${ABS})`, r2);
  show('attacker replays stolen RT1', refresh(stolen));
  show('client uses its current RT2', refresh(r2.rt));
  // D2: persistent theft: attacker always copies the newest RT, the client stops using it (tab closed)
  const start = now();
  let cur = login();
  advance(600); const a = refresh(cur); cur = a.rt; // client refreshes once
  const attackerLatest = cur; // copied by persistent XSS; client tab then closes
  let r = { ok: true, rt: attackerLatest }, n = 0;
  while (true) {
    advance(600);
    const x = refresh(r.rt);
    if (!x.ok) { show(`attacker refresh after ${n} undetected refreshes, ${((now() - start) / 3600).toFixed(2)} h after login`, x); break; }
    r = x; n++;
  }
}

// ---- E: denylist keyed by a hash of the raw token, bypassed by ECDSA malleability -------------------
log('E. Denylist keyed by SHA-256(token) vs. by jti, against ECDSA signature malleability');
{
  const N = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551'); // P-256 group order
  const t = issueAT('carol');
  const [h, p, s] = t.split('.');
  const sig = Buffer.from(s, 'base64url');
  const rr = sig.subarray(0, 32), ss = BigInt('0x' + sig.subarray(32).toString('hex'));
  const s2 = (N - ss).toString(16).padStart(64, '0');
  const t2 = `${h}.${p}.${b64u(Buffer.concat([rr, Buffer.from(s2, 'hex')]))}`;
  const hash = (x) => crypto.createHash('sha256').update(x).digest('hex');
  const denyHash = new Set([hash(t)]);
  const denyJti = new Set([verify(t).claims.jti]);
  log(`  tokens differ: ${t !== t2}; signature of variant verifies: ${verify(t2).ok}`);
  const byHash = (x) => { const r = verify(x); return r.ok && denyHash.has(hash(x)) ? { ok: false, why: 'hash denylisted' } : r; };
  const byJti = (x) => { const r = verify(x); return r.ok && denyJti.has(r.claims.jti) ? { ok: false, why: 'jti denylisted' } : r; };
  show('original token, hash denylist', byHash(t));
  show('malleated token, hash denylist', byHash(t2));
  show('malleated token, jti denylist', byJti(t2));
}

// ---- F: key rotation as mass revocation --------------------------------------------------------------
log('F. Removing a signing key from the accepted set (JWKS) invalidates every token it signed');
{
  const old = issueAT('dave', {}, 'k1');
  const fresh = issueAT('dave', {}, 'k2');
  delete acceptedKeys.k1;
  show('token signed with removed key k1', verify(old));
  show('token signed with current key k2', verify(fresh));
  acceptedKeys.k1 = { alg: 'ES256', key: ec1.publicKey };
}

// ---- G: algorithm confusion guard ---------------------------------------------------------------------
log('G. alg header that does not match the key entry');
{
  const none = `${json64({ alg: 'none', kid: 'k1' })}.${json64({ iss: 'https://as.example', aud: 'api', sub: 'eve', exp: now() + 600 })}.`;
  show('alg=none token', verify(none));
}

// ---- H: sizes vs. the 4096-octet cookie limit --------------------------------------------------------
log('H. Token sizes (characters = octets, base64url is ASCII) vs. the 4096-octet name+value cookie limit');
{
  const base = { iss: 'https://as.example', sub: '248289761001', aud: 'api', client_id: 'web', iat: now(), exp: now() + 600, jti: crypto.randomUUID(), scope: 'openid profile orders:read orders:write' };
  const es = sign({ alg: 'ES256', typ: 'at+jwt', kid: 'k1' }, base, ec1.privateKey);
  const rs = sign({ alg: 'RS256', typ: 'at+jwt', kid: 'r1' }, base, rsa.privateKey);
  const groups = Array.from({ length: 100 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
  const big = sign({ alg: 'RS256', typ: 'at+jwt', kid: 'r1' }, { ...base, groups }, rsa.privateKey);
  const name = '__Host-Http-session';
  for (const [l, t] of [['ES256, 8 claims', es], ['RS256, 8 claims', rs], ['RS256, 8 claims + 100 group ids', big]])
    log(`  ${l}: token ${t.length} chars; cookie name+value ${name.length + t.length} -> ${name.length + t.length > 4096 ? 'OVER 4096, the browser ignores the whole Set-Cookie' : 'fits'}`);
}
