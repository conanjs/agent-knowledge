// E2: browser cookie behaviour that matters for token storage. Plain Node, no dependencies.
//   node e2-cookies-server.mjs            (listens on 8801)
// The same server answers as two different *sites*:
//   http://localhost:8801  = the application (sets the cookies, runs the in-page checks)
//   http://127.0.0.1:8801  = the attacker site (cross-site requests to localhost)
// Every request is logged with its Cookie and Sec-Fetch-Site headers; GET /log returns the log as JSON.
import http from 'node:http';

const PORT = 8801;
const log = [];
const big = 'x'.repeat(4100); // name "big" + 4100 > 4096 octets: must be ignored (RFC 6265bis 5.6 step 5)
const fits = 'y'.repeat(4000); // name "fits" + 4000 < 4096: stored

const appPage = `<!doctype html><meta charset="utf-8"><title>E2 app</title><pre id="out">running</pre>
<script>
(async () => {
  const r = {};
  r.userAgent = navigator.userAgent;
  const names = () => document.cookie.split('; ').filter(Boolean).map(c => c.split('=')[0]);
  r.documentCookieNames = names();
  // JS tries to overwrite an HttpOnly cookie, and to set a cookie whose name claims it came from HTTP
  document.cookie = 'ho=overwritten-by-js; Path=/';
  document.cookie = '__Host-Http-fake=1; Secure; Path=/';
  document.cookie = '__Http-fake2=1; Secure; Path=/';
  document.cookie = '__Host-jsok=1; Secure; Path=/';
  r.afterJsWrites = names();
  r.hoAsSeenByJs = document.cookie.split('; ').filter(c => c.startsWith('ho=')).join(' | ');
  // localStorage is readable by any script on the origin
  localStorage.setItem('access_token', 'eyJ.fake.token');
  r.localStorageRead = localStorage.getItem('access_token');
  // a script-initiated same-origin request still carries the HttpOnly cookie
  const echo = await (await fetch('/echo?via=same-origin-fetch', { credentials: 'include' })).json();
  r.cookiesSentWithJsFetch = echo.cookieNames;
  r.hoValueSeenByServer = echo.ho;
  r.rawCookieHeaderSeenByServer = echo.raw;
  document.getElementById('out').textContent = JSON.stringify(r, null, 2);
  await fetch('/report', { method: 'POST', body: JSON.stringify(r) });
})();
</script>`;

const attackerPage = (step) => `<!doctype html><meta charset="utf-8"><title>E2 attacker</title><pre id="out">running ${step}</pre>
<script>
(async () => {
  const T = 'http://localhost:${PORT}/echo';
  if ('${step}' === 'subresources') {
    await fetch(T + '?via=xsite-fetch-get', { credentials: 'include', mode: 'no-cors' });
    await fetch(T + '?via=xsite-fetch-post', { method: 'POST', credentials: 'include', mode: 'no-cors' });
    await new Promise(res => { const i = new Image(); i.onload = i.onerror = res; i.src = T + '?via=xsite-img'; });
    document.getElementById('out').textContent = 'done subresources';
  } else if ('${step}' === 'form-post') {
    const f = document.createElement('form'); f.method = 'POST'; f.action = T + '?via=xsite-toplevel-form-post';
    document.body.appendChild(f); f.submit();
  } else if ('${step}' === 'nav-get') {
    location.href = T + '?via=xsite-toplevel-nav-get';
  }
})();
</script>`;

const cookiesOf = (req) => Object.fromEntries((req.headers.cookie ?? '').split('; ').filter(Boolean).map((c) => { const i = c.indexOf('='); return [c.slice(0, i), c.slice(i + 1)]; }));

http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const c = cookiesOf(req);
  const entry = { t: new Date().toISOString(), host: req.headers.host, method: req.method, path: url.pathname + url.search, secFetchSite: req.headers['sec-fetch-site'] ?? null, cookieNames: Object.keys(c) };
  if (url.pathname !== '/log') log.push(entry);
  const host = url.hostname;
  if (url.pathname === '/' && host === 'localhost') {
    res.setHeader('Set-Cookie', [
      'ho=server-value; HttpOnly; Path=/; SameSite=Lax',
      'js=1; Path=/; SameSite=Lax',
      'strict=1; HttpOnly; Path=/; SameSite=Strict',
      'lax=1; HttpOnly; Path=/; SameSite=Lax',
      'none=1; HttpOnly; Secure; Path=/; SameSite=None',
      'nosamesite=1; HttpOnly; Path=/',
      '__Host-Http-sid=1; Secure; HttpOnly; Path=/; SameSite=Strict',
      `big=${big}; Path=/`,
      `fits=${fits}; Path=/`,
    ]);
    res.setHeader('Content-Type', 'text/html'); return res.end(appPage);
  }
  if (url.pathname === '/attacker' && host === '127.0.0.1') { res.setHeader('Content-Type', 'text/html'); return res.end(attackerPage(url.searchParams.get('step') ?? 'subresources')); }
  if (url.pathname === '/echo') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ cookieNames: Object.keys(c), ho: c.ho ?? null, raw: (req.headers.cookie ?? '').replace(/=([^;]{20})[^;]+/g, '=$1...') })); }
  if (url.pathname === '/report') { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { entry.report = JSON.parse(b); res.end('ok'); }); return; }
  if (url.pathname === '/log') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(log, null, 2)); }
  res.statusCode = 404; res.end();
}).listen(PORT, () => console.log(`E2 listening on ${PORT}`));
