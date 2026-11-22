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
// Flip the 2 spare low bits of the last base64url character of the 32-byte signature (43 chars = 258 bits).
const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const variant = token.slice(0, -1) + A[A.indexOf(token.at(-1)) ^ 1];
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const hashDenylist = new Set([sha(token)]);                                    // keyed on SHA-256(token)
const jtiDenylist = new Set(['a1b2c3|https://issuer.example']);                // keyed on (jti, iss)
const c = verify(variant);
console.log(`same-string=${token === variant} both-verify=${verify(token) !== null && c !== null}`);
console.log(`hash-denylist-blocks-variant=${hashDenylist.has(sha(variant))} jti-denylist-blocks-variant=${jtiDenylist.has(`${c.jti}|${c.iss}`)}`);
