// JWT revocation lab: no dependencies, Node >= 20 (run with Node 24).
// Usage: node jwt-revocation-lab.mjs
//
// Each scenario uses a simulated clock (nowMs) so the timing edge cases are reproducible.
// The JWT code is deliberately minimal (HS256 and ES256 only) and is NOT a production library.

import crypto from 'node:crypto';

// ---------- simulated clock ----------
let nowMs = Date.UTC(2026, 10, 22, 9, 0, 0, 100); // 2026-11-22T09:00:00.100Z
const nowSec = () => Math.floor(nowMs / 1000);
const iso = () => new Date(nowMs).toISOString();
const advance = (ms) => { nowMs += ms; };

// ---------- minimal JWT ----------
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const enc = (obj) => b64u(JSON.stringify(obj));
const lenientDecode = (s) => Buffer.from(s, 'base64url'); // what many hand-rolled verifiers do
function strictDecode(s) {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('non-base64url character or padding');
  const b = Buffer.from(s, 'base64url');
  if (b.toString('base64url') !== s) throw new Error('non-canonical base64url (trailing bits)');
  return b;
}
const HS_KEY = crypto.randomBytes(32);

function signHS256(claims) {
  const h = enc({ alg: 'HS256', typ: 'JWT' });
  const p = enc(claims);
  const sig = crypto.createHmac('sha256', HS_KEY).update(`${h}.${p}`).digest();
  return `${h}.${p}.${b64u(sig)}`;
}
function verifyHS256(token, { strict = false } = {}) {
  const [h, p, s] = token.split('.');
  const dec = strict ? strictDecode : lenientDecode;
  let got;
  try { got = dec(s); } catch (e) { return { ok: false, reason: e.message }; }
  const expected = crypto.createHmac('sha256', HS_KEY).update(`${h}.${p}`).digest();
  if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) return { ok: false, reason: 'bad signature' };
  const claims = JSON.parse(Buffer.from(p, 'base64url'));
  if (nowSec() >= claims.exp) return { ok: false, reason: 'expired' };
  return { ok: true, claims };
}
let jtiCounter = 0;
const issue = (sub, ttlSec, extra = {}) =>
  signHS256({ iss: 'https://issuer.example', sub, iat: nowSec(), exp: nowSec() + ttlSec, jti: `jti-${++jtiCounter}`, ...extra });

const line = (s = '') => console.log(s);
const head = (s) => { line(); line(`=== ${s} ===`); };

// =====================================================================
head('A. Stateless verification: logout does not stop a copied token');
{
  const at = issue('alice', 900); // 15-minute access token
  line(`${iso()} issued access token, exp in 900 s`);
  line(`${iso()} user clicks "log out" (client deletes its copy; server keeps no state)`);
  advance(60_000);
  const r = verifyHS256(at);
  line(`${iso()} attacker replays the copied token -> ${r.ok ? 'ACCEPTED' : 'rejected: ' + r.reason}`);
  advance(900_000);
  const r2 = verifyHS256(at);
  line(`${iso()} same token after exp -> ${r2.ok ? 'ACCEPTED' : 'rejected: ' + r2.reason}`);
}

// =====================================================================
head('B. Denylist keyed on (iss, jti), entry TTL = exp - now');
{
  const deny = new Map(); // key -> expiresAtMs
  const revoke = (claims) => deny.set(`${claims.iss}|${claims.jti}`, claims.exp * 1000);
  const purge = () => { for (const [k, until] of deny) if (until <= nowMs) deny.delete(k); };
  const isRevoked = (claims) => { purge(); return deny.has(`${claims.iss}|${claims.jti}`); };
  const check = (t) => { const r = verifyHS256(t); if (!r.ok) return 'rejected: ' + r.reason; return isRevoked(r.claims) ? 'rejected: revoked (denylist)' : 'ACCEPTED'; };

  const at = issue('alice', 900);
  const other = issue('bob', 900);
  line(`${iso()} issued alice token (${verifyHS256(at).claims.jti}) and bob token`);
  advance(30_000);
  revoke(verifyHS256(at).claims);
  line(`${iso()} logout: denylist entry added, remaining TTL ${(deny.get(`https://issuer.example|${verifyHS256(at).claims.jti}`) - nowMs) / 1000} s, size=${deny.size}`);
  line(`${iso()} alice token -> ${check(at)}`);
  line(`${iso()} bob token   -> ${check(other)}`);
  advance(871_000);
  purge();
  line(`${iso()} after alice exp: denylist size=${deny.size} (entry no longer needed: exp check rejects) -> ${check(at)}`);
}

// =====================================================================
head('C. "Revoke all tokens issued before T" with second-precision iat');
{
  // T1 issued at 09:00:00.100 ; revocation at 09:00:00.400 ; re-login at 09:00:00.700 -> all in the same second
  nowMs = Date.UTC(2026, 10, 22, 9, 0, 0, 100);
  const t1 = issue('alice', 900);
  line(`${iso()} T1 issued, iat=${verifyHS256(t1).claims.iat}`);
  advance(300);
  const cutoff = nowSec();
  line(`${iso()} "log out everywhere": cutoff=${cutoff} (seconds)`);
  advance(300);
  const t2 = issue('alice', 900);
  line(`${iso()} user logs in again: T2 issued, iat=${verifyHS256(t2).claims.iat}`);
  const ruleLt = (t) => (verifyHS256(t).claims.iat < cutoff ? 'rejected' : 'ACCEPTED');
  const ruleLe = (t) => (verifyHS256(t).claims.iat <= cutoff ? 'rejected' : 'ACCEPTED');
  line(`rule "reject iat <  cutoff": T1 (stolen, should die) -> ${ruleLt(t1)} ; T2 (fresh login) -> ${ruleLt(t2)}`);
  line(`rule "reject iat <= cutoff": T1 (stolen, should die) -> ${ruleLe(t1)} ; T2 (fresh login) -> ${ruleLe(t2)}`);

  // Fix: a per-user token version (generation counter) checked on each request.
  const user = { tokenVersion: 1 };
  nowMs = Date.UTC(2026, 10, 22, 9, 0, 0, 100);
  const v1 = issue('alice', 900, { ver: user.tokenVersion });
  advance(300); user.tokenVersion += 1; // log out everywhere
  advance(300);
  const v2 = issue('alice', 900, { ver: user.tokenVersion });
  const ruleVer = (t) => (verifyHS256(t).claims.ver !== user.tokenVersion ? 'rejected' : 'ACCEPTED');
  line(`rule "ver must equal user.tokenVersion": T1(ver=1) -> ${ruleVer(v1)} ; T2(ver=2) -> ${ruleVer(v2)}`);
}

// =====================================================================
head('D. Refresh token rotation with reuse detection (token families)');
function makeAS({ leewayMs = 0 } = {}) {
  const rts = new Map(); // rt -> { family, usedAtMs|null, child|null }
  const families = new Map(); // family -> { revoked }
  const mint = (family) => { const rt = 'rt_' + crypto.randomBytes(6).toString('hex'); rts.set(rt, { family, usedAtMs: null, child: null }); return rt; };
  return {
    login() { const f = 'fam_' + crypto.randomBytes(3).toString('hex'); families.set(f, { revoked: false }); return mint(f); },
    refresh(rt) {
      const rec = rts.get(rt);
      if (!rec) return { ok: false, why: 'unknown token' };
      const fam = families.get(rec.family);
      if (fam.revoked) return { ok: false, why: 'family revoked' };
      if (rec.usedAtMs !== null) {
        const withinLeeway = nowMs - rec.usedAtMs <= leewayMs && rts.get(rec.child)?.usedAtMs === null;
        if (withinLeeway) { const rt2 = mint(rec.family); return { ok: true, rt: rt2, note: 'reuse inside leeway window, allowed' }; }
        fam.revoked = true;
        return { ok: false, why: 'REUSE DETECTED -> whole family revoked' };
      }
      rec.usedAtMs = nowMs; const child = mint(rec.family); rec.child = child;
      return { ok: true, rt: child };
    },
  };
}
const show = (who, r) => line(`${iso()} ${who} -> ${r.ok ? 'new RT issued' + (r.note ? ' (' + r.note + ')' : '') : 'REFUSED: ' + r.why}`);
{
  line('-- D1: thief replays an old refresh token after the client rotated it');
  const as = makeAS(); const rt1 = as.login();
  const stolen = rt1; // XSS copies RT1
  advance(1000); const c = as.refresh(rt1); show('client refresh(RT1)', c);
  advance(1000); show('thief  refresh(RT1)', as.refresh(stolen));
  advance(1000); show('client refresh(RT2)', as.refresh(c.rt));

  line('-- D2: thief uses the stolen token first');
  const as2 = makeAS(); const r1 = as2.login();
  advance(1000); const t = as2.refresh(r1); show('thief  refresh(RT1)', t);
  advance(1000); show('client refresh(RT1)', as2.refresh(r1));
  advance(1000); show('thief  refresh(RT2\')', as2.refresh(t.rt));

  line('-- D3: persistent theft: thief copies the LATEST token, waits until the user closes the app');
  const as3 = makeAS(); let cur = as3.login();
  for (let i = 0; i < 2; i++) { advance(300_000); const r = as3.refresh(cur); cur = r.rt; }
  const latest = cur; // malicious script exfiltrates each new RT; this is the last one
  line(`${iso()} user closes the tab; the client never presents its last RT again`);
  advance(3_600_000); show('thief  refresh(latest RT)', as3.refresh(latest));

  line('-- D4: benign race: two tabs refresh with the same RT at once (no leeway)');
  const as4 = makeAS(); const shared = as4.login();
  advance(1000); show('tab A  refresh(RT1)', as4.refresh(shared));
  advance(40); show('tab B  refresh(RT1)', as4.refresh(shared));

  line('-- D5: same race with a 2 s leeway (overlap) window');
  const as5 = makeAS({ leewayMs: 2000 }); const sh = as5.login();
  advance(1000); show('tab A  refresh(RT1)', as5.refresh(sh));
  advance(40); show('tab B  refresh(RT1)', as5.refresh(sh));
  advance(5000); show('thief  refresh(RT1) 5 s later', as5.refresh(sh));
}

// =====================================================================
head('E. JWT malleability vs a denylist keyed on SHA-256(token)');
{
  const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
  const at = issue('alice', 900);
  const [h, p, s] = at.split('.');
  // E1: HS256 signature = 32 bytes = 43 base64url chars; the last char carries 2 unused bits.
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const last = s.at(-1); const idx = A.indexOf(last);
  const variants = [];
  for (let k = 0; k < 4; k++) { const alt = A[(idx & 0b111100) | k]; if (alt !== last) variants.push(`${h}.${p}.${s.slice(0, -1)}${alt}`); }
  variants.push(`${at}=`); // padding variant
  const std = s.replace(/-/g, '+').replace(/_/g, '/');
  if (std !== s) variants.push(`${h}.${p}.${std}`); // standard-alphabet variant (only differs if sig has - or _)
  line(`original token hash ${sha(at)}; denylisted`);
  const hashDeny = new Set([sha(at)]);
  for (const v of variants) {
    const lenient = verifyHS256(v); const strict = verifyHS256(v, { strict: true });
    line(`variant ...${v.slice(-6)}  hash ${sha(v)}  in hash-denylist: ${hashDeny.has(sha(v))}  lenient verify: ${lenient.ok ? 'VALID' : 'invalid'}  strict verify: ${strict.ok ? 'VALID' : 'invalid (' + strict.reason + ')'}  jti=${lenient.ok ? lenient.claims.jti : '-'}`);
  }

  // E2: ES256 (r, s) -> (r, n - s) is also a valid signature.
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const eh = enc({ alg: 'ES256', typ: 'JWT' }); const ep = enc({ iss: 'https://issuer.example', sub: 'alice', jti: 'jti-es-1', exp: nowSec() + 900 });
  const input = `${eh}.${ep}`;
  const sig = crypto.sign('sha256', Buffer.from(input), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  const n = BigInt('0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551');
  const r = sig.subarray(0, 32); const sv = BigInt('0x' + sig.subarray(32).toString('hex'));
  const s2 = Buffer.from((n - sv).toString(16).padStart(64, '0'), 'hex');
  const sig2 = Buffer.concat([r, s2]);
  const t1 = `${input}.${b64u(sig)}`; const t2 = `${input}.${b64u(sig2)}`;
  const ok1 = crypto.verify('sha256', Buffer.from(input), { key: publicKey, dsaEncoding: 'ieee-p1363' }, sig);
  const ok2 = crypto.verify('sha256', Buffer.from(input), { key: publicKey, dsaEncoding: 'ieee-p1363' }, sig2);
  line(`ES256 original (r, s)   hash ${sha(t1)} verify=${ok1}`);
  line(`ES256 malleated (r, n-s) hash ${sha(t2)} verify=${ok2}  same claims, different token string: ${t1 !== t2}`);
}
line();
line(`node ${process.version}, ${process.platform}-${process.arch}, OpenSSL ${process.versions.openssl}`);
