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
