// Cookie vs. Web Storage visibility lab.
// Usage: node cookie-visibility-server.mjs [port]   then load http://localhost:<port>/ in a browser
// (headless: "Google Chrome" --headless=new --user-data-dir=<tmp> --virtual-time-budget=5000 --dump-dom http://localhost:<port>/)
//
// What it shows, from the page's own JavaScript (the position an XSS payload is in):
//   1. which cookies document.cookie can read (HttpOnly ones should be missing),
//   2. that a token in localStorage is readable,
//   3. that a same-origin fetch still carries the HttpOnly cookie to the server (session riding),
//   4. which cookie-prefix rules the browser enforces (__Host-, __Host-Http-).

import http from 'node:http';

const port = Number(process.argv[2] ?? 8787);
const log = [];

const page = `<!doctype html><meta charset="utf-8"><title>cookie lab</title>
<pre id="out">running</pre>
<script>
const res = {};
const render = () => { document.getElementById('out').textContent = 'RESULT ' + JSON.stringify(res, null, 2); };
(async () => { try {
  localStorage.setItem('access_token', 'eyJhbGciOiJIUzI1NiJ9.demo.sig');
  Object.assign(res, {
    userAgent: navigator.userAgent,
    isSecureContext: window.isSecureContext,
    documentCookie: document.cookie,
    localStorageToken: localStorage.getItem('access_token'),
  });
  render();
  const r = await fetch('/echo', { credentials: 'same-origin' });
  res.cookieHeaderSeenByServerOnFetch = (await r.json()).cookie;
  render();

  // 5. A non-extractable WebCrypto key (what a DPoP client should use): the bytes cannot be exported,
  //    but any script on the origin can still load it from IndexedDB and sign with it.
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  try { await crypto.subtle.exportKey('jwk', kp.privateKey); res.exportPrivateKey = 'EXPORTED'; }
  catch (e) { res.exportPrivateKey = 'refused: ' + e.name; }
  render();
  res.step = 'indexedDB.open'; render();
  const db = await new Promise((ok, ko) => { const q = indexedDB.open('lab', 1); q.onupgradeneeded = () => q.result.createObjectStore('keys'); q.onsuccess = () => ok(q.result); q.onerror = () => ko(q.error); q.onblocked = () => ko(new Error('blocked')); });
  res.step = 'put'; render();
  await new Promise((ok, ko) => { const tx = db.transaction('keys', 'readwrite'); tx.objectStore('keys').put(kp, 'dpop'); tx.oncomplete = ok; tx.onerror = () => ko(tx.error); });
  res.step = 'get'; render();
  const loaded = await new Promise((ok, ko) => { const q = db.transaction('keys').objectStore('keys').get('dpop'); q.onsuccess = () => ok(q.result); q.onerror = () => ko(q.error); });
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, loaded.privateKey, new TextEncoder().encode('attacker-chosen DPoP proof'));
  delete res.step;
  res.signWithKeyLoadedFromIndexedDB = 'signed ' + sig.byteLength + ' bytes; extractable=' + loaded.privateKey.extractable;
  render();
} catch (e) { res.error = String(e); render(); } })();
</script>`;

http.createServer((req, res) => {
  log.push(`${req.method} ${req.url} cookie=${JSON.stringify(req.headers.cookie ?? '')}`);
  if (req.url === '/') {
    res.setHeader('Set-Cookie', [
      '__Host-Http-sid=s3cr3t; Secure; HttpOnly; Path=/; SameSite=Strict', // BFF session cookie as RFC 10017 6.1.3.2 suggests
      '__Host-readable=r1; Secure; Path=/; SameSite=Strict',               // valid __Host-, but not HttpOnly
      '__Host-Http-noHttpOnly=x1; Secure; Path=/',                         // breaks the __Host-Http- rule (no HttpOnly)
      '__Host-withDomain=x2; Secure; Path=/; Domain=localhost',            // breaks the __Host- rule (Domain set)
      '__Host-noSecure=x3; Path=/',                                        // breaks the __Host- rule (no Secure)
      'plain=p1; Path=/',                                                  // no attributes at all
    ]);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(page);
  }
  if (req.url === '/echo') {
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ cookie: req.headers.cookie ?? '' }));
  }
  if (req.url === '/clear') { // remove everything the lab stored (the HttpOnly cookie can only be expired by the server)
    res.setHeader('Set-Cookie', [
      '__Host-Http-sid=; Secure; HttpOnly; Path=/; SameSite=Strict; Max-Age=0',
      '__Host-readable=; Secure; Path=/; SameSite=Strict; Max-Age=0',
      'plain=; Path=/; Max-Age=0',
    ]);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(`<!doctype html><pre id="out">clearing</pre><script>
      localStorage.clear();
      const q = indexedDB.deleteDatabase('lab');
      q.onsuccess = () => { document.getElementById('out').textContent = 'CLEARED cookie=' + JSON.stringify(document.cookie) + ' localStorage=' + localStorage.length; };
    </script>`);
  }
  if (req.url === '/log') { res.setHeader('Content-Type', 'text/plain'); return res.end(log.join('\n') + '\n'); }
  res.statusCode = 404; res.end();
}).listen(port, '127.0.0.1', () => console.log(`listening on http://localhost:${port}/`));
