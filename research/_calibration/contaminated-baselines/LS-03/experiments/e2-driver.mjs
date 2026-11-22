// E2 driver: runs the cookie checks of e2-cookies-server.mjs in one headless browser, with a fresh
// throwaway context (no saved profile). Usage:
//   node e2-driver.mjs <path-to-playwright-core> <chromium|firefox|webkit> [--wait-lax]
// --wait-lax repeats the cross-site form POST 130 s after the cookies were set (the "Lax-allowing-unsafe"
// 2-minute window of RFC 6265bis 5.6.7.2).
const [, , pwPath, browserName, flag] = process.argv;
const pw = await import(`${pwPath}/index.mjs`);
const BASE = 'http://localhost:8801';
const ATT = 'http://127.0.0.1:8801';
const getLog = async () => (await fetch(`${BASE}/log`)).json();

const browser = await pw[browserName].launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const start = (await getLog()).length;

await page.goto(`${BASE}/`);
await page.waitForFunction(() => document.getElementById('out').textContent.startsWith('{'));
const stored = (await context.cookies(BASE)).map((c) => `${c.name}${c.httpOnly ? '(HttpOnly)' : ''}${c.secure ? '(Secure)' : ''}:${c.sameSite}`);

await page.goto(`${ATT}/attacker?step=subresources`);
await page.waitForFunction(() => document.getElementById('out').textContent.startsWith('done'));
await page.goto(`${ATT}/attacker?step=form-post`);
await page.waitForURL(/xsite-toplevel-form-post/);
await page.goto(`${ATT}/attacker?step=nav-get`);
await page.waitForURL(/xsite-toplevel-nav-get/);
if (flag === '--wait-lax') {
  await page.waitForTimeout(130_000);
  await page.goto(`${ATT}/attacker?step=form-post`);
  await page.waitForURL(/xsite-toplevel-form-post/);
}
await browser.close();

const entries = (await getLog()).slice(start);
const report = entries.find((e) => e.report)?.report;
console.log(`=== ${browserName} ${browser.version()} ===`);
console.log('cookies stored (context.cookies):', stored.join(', '));
console.log('in-page report:', JSON.stringify(report, null, 1));
for (const e of entries.filter((e) => e.path.startsWith('/echo')))
  console.log(`${e.t}  ${e.method.padEnd(4)} ${e.path.padEnd(40)} sec-fetch-site=${String(e.secFetchSite).padEnd(11)} cookies=[${e.cookieNames.join(', ')}]`);
