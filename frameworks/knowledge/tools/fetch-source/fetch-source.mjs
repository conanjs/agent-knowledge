#!/usr/bin/env node
// fetch-source.mjs — saves the text of source pages for a research run (frameworks/knowledge/research-agent.design.md
// §1.3 step 3), so the judge can check every claim against the page as it was read. Replaces the Phase 0 script
// research/_calibration/scripts/fetch_pages.py.
//
// Usage: node fetch-source.mjs fetch <run> <url>... [--refresh]
//        node fetch-source.mjs plan <url>...
//        node fetch-source.mjs text <file.html>
//   fetch  saves each page as <run>/cache/<first 12 hex of sha256(url without #fragment)>.txt (a header, then the text)
//          and records it in <run>/sources.json: url, the URL fetched, cache file, fetch time, HTTP status, content
//          type, length and the SHA-256 of the saved text (§1.5, so a later check can tell a page that changed).
//          A page already saved is skipped unless --refresh. HTML becomes text with one line per block; text, Markdown
//          and JSON are kept as they are; a PDF is refused (v1 saves no PDFs: cite the HTML version). A 429 or 503 answer
//          is tried again up to 2 times, after its Retry-After seconds (at most 10; 2 s, then 5 s, when it gives none).
//          Before a page's reader comments (wpDiscuz or WordPress markup) it writes COMMENTS_LINE, and records the
//          file line that holds it in sources.json as comments_from_line (null when the page has none).
//   plan   prints, without fetching, what fetch would do with each URL: the URL fetched, the cache file, and warnings
//   text   prints the text that fetch would save for a local HTML file
// A GitHub file page (github.com/<org>/<repo>/blob/<ref>/<path>) is fetched raw from raw.githubusercontent.com, since
// GitHub's HTML view of a long file is cut off; a ref that is a moving branch (main, master, …) draws a warning: cite a
// tag or a commit (§2.1).
// Runs itself with --use-system-ca, so the machine's own certificate store is trusted (a proxy's certificate included).
// Exit codes: 0 every page saved or already saved, 1 a page failed or was refused, 2 usage error.

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

if (!process.execArgv.includes('--use-system-ca') && !process.env.KB_FETCH_NO_REEXEC) {
  const r = spawnSync(process.execPath, ['--use-system-ca', ...process.argv.slice(1)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

const USAGE = 'usage: node fetch-source.mjs fetch <run> <url>... [--refresh] | plan <url>... | text <file.html>';
const MOVING = /^(main|master|develop|dev|trunk|HEAD|next|latest|gh-pages)$/;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function plan(url) {
  const normalized = url.split('#')[0].replace(/[.,;:]+$/, '');
  let fetchUrl = normalized; const warnings = [];
  const gh = normalized.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/);
  if (gh) {
    fetchUrl = `https://raw.githubusercontent.com/${gh[1]}/${gh[2]}/${gh[3]}/${gh[4]}`;
    if (MOVING.test(gh[3])) warnings.push(`ref "${gh[3]}" is a moving branch: cite a tag or a commit`);
  }
  if (/\.pdf($|\?)/i.test(normalized)) warnings.push('a PDF: v1 saves no PDFs, cite the HTML version');
  return { normalized, fetchUrl, cache: `cache/${sha256(normalized).slice(0, 12)}.txt`, warnings };
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', copy: '©' };
/** HTML to text: scripts, styles and SVG dropped; one line per block element; entities decoded; runs of blank lines cut. */
export function htmlToText(html) {
  return html
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|li|ul|ol|dl|dt|dd|h[1-6]|tr|table|thead|tbody|pre|section|article|header|footer|nav|aside|main|blockquote|figure|figcaption|details|summary)\b[^>]*>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e.toLowerCase()] ?? m)))
    .split('\n').map((l) => l.replace(/[ \t ]+/g, ' ').trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim() + '\n';
}

// Reader comments under an article are Rank 6 whatever the page's rank (design §2.1). A boundary line goes before the
// first comment block the page's own HTML holds: wpDiscuz (id="wpdcom", checked on www.percona.com/blog/, 2026-11-23)
// or WordPress theme markup (id="comments", class "comment-list"; not yet seen on a saved page). Comments a page loads
// by script never reach the text, and LWN serves its comments to automated clients only behind a button (2026-11-23).
export const COMMENTS_LINE = '=== READER COMMENTS BELOW (Rank 6: unvetted) ===';
const COMMENT_BLOCK = /<(?:div|section|ol|ul)\b[^>]*\b(?:id="(?:wpdcom|comments)"|class="[^"]*\bcomment-list\b[^"]*")[^>]*>/i;
export function markComments(html) {
  const m = COMMENT_BLOCK.exec(html);
  return m ? `${html.slice(0, m.index)}<p>${COMMENTS_LINE}</p>${html.slice(m.index)}` : html;
}

async function fetchOne(run, url, refresh, index) {
  const p = plan(url);
  for (const w of p.warnings) console.log(`warn | ${w} | ${p.normalized}`);
  const file = path.join(run, p.cache);
  if (fs.existsSync(file) && !refresh) { console.log(`cached | ${p.cache} | ${p.normalized}`); return true; }
  if (/\.pdf($|\?)/i.test(p.normalized)) { console.log(`refused | pdf | ${p.normalized}`); return false; }
  let res;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetch(p.fetchUrl, { redirect: 'follow', signal: AbortSignal.timeout(40000), headers: { 'user-agent': 'kb-fetch-source/1.0', accept: 'text/html,text/plain;q=0.9,*/*;q=0.5' } });
    } catch (e) { console.log(`error | ${e.cause?.code ?? e.name} | ${p.normalized}`); return false; }
    if (![429, 503].includes(res.status) || attempt === 2) break;
    const h = res.headers.get('retry-after'); const ra = h === null ? NaN : Number(h);
    const wait = Math.min(10, Number.isFinite(ra) && ra >= 0 ? ra : [2, 5][attempt]);
    console.log(`retry | ${res.status} | waiting ${wait} s | ${p.normalized}`);
    await new Promise((r) => setTimeout(r, wait * 1000));
  }
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim();
  if (!res.ok) { console.log(`error | ${res.status} | ${p.normalized}`); return false; }
  if (type === 'application/pdf') { console.log(`refused | pdf | ${p.normalized}`); return false; }
  const raw = await res.text();
  const text = /html/.test(type) ? htmlToText(markComments(raw)) : raw.endsWith('\n') ? raw : raw + '\n';
  const at = text.split('\n').indexOf(COMMENTS_LINE);
  const commentsFrom = at < 0 ? null : at + 5; // the file's line: 3 header lines and a blank line come first
  const fetched = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const digest = sha256(text);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `SOURCE: ${p.normalized}\nFETCHED: ${fetched} (${p.fetchUrl === p.normalized ? 'fetch-source.mjs' : `fetch-source.mjs, from ${p.fetchUrl}`})\nSHA256: ${digest}\n\n${text}`);
  fs.renameSync(tmp, file);
  const entry = { url, normalized: p.normalized, fetched_from: p.fetchUrl, cache: p.cache, fetched, status: res.status, content_type: type, chars: text.length, sha256: digest, comments_from_line: commentsFrom };
  const i = index.findIndex((e) => e.normalized === p.normalized);
  if (i >= 0) index[i] = entry; else index.push(entry);
  console.log(`saved | ${res.status} | ${text.length} chars | ${p.cache} | ${p.normalized}${commentsFrom ? ` | comments from line ${commentsFrom}` : ''}`);
  return true;
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'plan' && rest.length) {
  for (const u of rest) {
    const p = plan(u);
    console.log(`${p.normalized} | fetch ${p.fetchUrl} | ${p.cache}${p.warnings.map((w) => ` | warn: ${w}`).join('')}`);
  }
} else if (cmd === 'text' && rest.length === 1) {
  process.stdout.write(htmlToText(markComments(fs.readFileSync(rest[0], 'utf8'))));
} else if (cmd === 'fetch' && rest.length >= 2) {
  const refresh = rest.includes('--refresh');
  const [run, ...urls] = rest.filter((a) => a !== '--refresh');
  const indexFile = path.join(run, 'sources.json');
  const index = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, 'utf8')) : [];
  let ok = true;
  for (const u of urls) ok = (await fetchOne(run, u, refresh, index)) && ok;
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(indexFile, JSON.stringify(index, null, 1) + '\n');
  process.exit(ok ? 0 : 1);
} else { console.log(USAGE); process.exit(2); }
