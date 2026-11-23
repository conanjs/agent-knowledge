#!/usr/bin/env node
// classify-source.mjs — gives a URL its source rank (1–6) from the rules in source-ranks.json (schemas/_system.md §4.1).
//
// Usage: node classify-source.mjs [--rules <file>] <url> …
//        node classify-source.mjs [--rules <file>] --census <knowledge-root>
//   <url> …    one line per URL: "Rank <n> | tier A | <rule> | <url>", or "no rank | tier B | no rule | <url>"
//   --census   report-only: counts the ranks of every URL in the References sections of all docs under the root
//   --rules    another rules file (tests); default: source-ranks.json next to this file
//
// Tier A is this script's rank. Tier B means no rule covers the URL: the research worker rates it, and the judge re-rates it.
// Exit codes: 0 done, 1 an argument is not a URL, 2 usage error or invalid rules file.
// The validator imports loadRules, classify and referenceEntries for KB-14; evaluate-research.mjs uses them too.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const defaultRulesFile = path.join(here, 'source-ranks.json');

const bareHost = (h) => h.toLowerCase().replace(/^www\./, '');

/** Reads and checks a rules file; throws an Error naming the first problem. */
export function loadRules(file = defaultRulesFile) {
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`cannot read rules file ${file}: ${e.message}`); }
  if (!Array.isArray(data.rules)) throw new Error(`rules file ${file}: "rules" must be a list`);
  const seen = new Set();
  return data.rules.map((r, i) => {
    const at = `rules file ${file}, rule ${i + 1}`;
    if (typeof r.host !== 'string' || !/^(\*\.)?[a-z0-9.-]+$/i.test(r.host)) throw new Error(`${at}: host "${r.host}" is not a host name`);
    if (typeof r.prefix !== 'string' || !r.prefix.startsWith('/')) throw new Error(`${at}: prefix "${r.prefix}" must start with "/"`);
    if (!Number.isInteger(r.rank) || r.rank < 1 || r.rank > 6) throw new Error(`${at}: rank ${r.rank} is not 1–6`);
    const host = r.host.startsWith('*.') ? '*.' + bareHost(r.host.slice(2)) : bareHost(r.host);
    const prefix = r.prefix.toLowerCase();
    const key = `${host}${prefix}`;
    if (seen.has(key)) throw new Error(`${at}: ${r.host} ${r.prefix} is listed twice`);
    seen.add(key);
    const segs = prefix.split('/').filter(Boolean);
    const re = new RegExp('^' + prefix.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]+'));
    return { ...r, host, prefix, re, segs: segs.length, literal: prefix.replace(/\*/g, '').length, label: `${host}${r.prefix}` };
  });
}

/** { rank, tier: 'A', rule } for a URL a rule covers, { rank: null, tier: 'B', rule: null } otherwise, null for a non-URL. */
export function classify(url, rules) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  // A page's reader comments, cited as the page URL plus #comments (or #comment-<n>): Rank 6 whatever the article's rank,
  // since fetch-source.mjs marks them in the saved text (research-agent design §2.1, decided by V 2026-11-23).
  if (/^#comments?$|^#comment-\d+$/i.test(u.hash)) return { rank: 6, tier: 'A', rule: 'reader comments (#comments)' };
  const host = bareHost(u.hostname);
  const p = (u.pathname.endsWith('/') ? u.pathname : u.pathname + '/').toLowerCase();
  const fits = rules.filter((r) => (r.host.startsWith('*.') ? host.endsWith(r.host.slice(1)) : host === r.host) && r.re.test(p));
  if (!fits.length) return { rank: null, tier: 'B', rule: null };
  // Most path segments first, then more literal characters, then an exact host; on a full tie, the higher rank number.
  const score = (r) => [r.segs, r.literal, r.host.startsWith('*.') ? 0 : 1, r.rank];
  const best = fits.reduce((a, b) => {
    const [x, y] = [score(a), score(b)];
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] > y[i] ? a : b;
    return a;
  });
  return { rank: best.rank, tier: 'A', rule: best.label };
}

/** The external entries of a References section's text: { labels, refs, urls, rank } per top-level list item, continuation lines
 * joined. labels are the [^x] footnotes; refs are how the doc cites the entry: its [^x] footnotes, or a leading [x] label. */
export function referenceEntries(refs) {
  const items = [];
  for (const line of refs.split('\n')) {
    if (/^[-*] /.test(line)) items.push(line);
    else if (/^\s+\S/.test(line) && items.length) items[items.length - 1] += ' ' + line.trim();
  }
  return items
    .map((e) => ({
      labels: [...e.matchAll(/\[\^([\w-]+)\]/g)].map((m) => m[1]),
      refs: [...e.matchAll(/\[\^([\w-]+)\]/g)].map((m) => `[^${m[1]}]`).concat(/\[\^[\w-]+\]/.test(e) ? [] : [e.match(/^[-*] (\[[\w.-]+\])(?!\()/)?.[1]].filter(Boolean)),
      urls: [...e.matchAll(/https?:\/\/[^\s)>\]`|]+/g)].map((m) => m[0].replace(/[.,;]+$/, '')),
      rank: Number(e.match(/\bRank ([1-6])\./)?.[1]) || null,
    }))
    .filter((e) => e.urls.length);
}

function census(root, rules) {
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name.startsWith('.')) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.md')) files.push(p); } };
  walk(root);
  const byRank = new Map([[1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0], ['B', 0]]);
  const unruled = new Map();
  let docs = 0; let n = 0;
  for (const f of files.sort()) {
    const text = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
    const m = text.match(/^## References[ \t]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m);
    if (!m) continue;
    const found = [...m[1].matchAll(/https?:\/\/[^\s)>\]`"|]+/g)].map((x) => x[0].replace(/[.,;]+$/, ''));
    if (!found.length) continue;
    docs++;
    for (const url of found) {
      const c = classify(url, rules);
      if (!c) continue;
      n++;
      byRank.set(c.rank ?? 'B', byRank.get(c.rank ?? 'B') + 1);
      if (c.tier === 'B') { const h = bareHost(new URL(url).hostname); unruled.set(h, (unruled.get(h) ?? 0) + 1); }
    }
  }
  const pct = (k) => (n ? Math.round((100 * k) / n) : 0);
  const out = [`rank census: ${docs} docs with external References, ${n} URLs`];
  for (const r of [1, 2, 3, 4, 5, 6]) out.push(`Rank ${r}: ${byRank.get(r)} (${pct(byRank.get(r))}%)`);
  out.push(`tier B, no rule: ${byRank.get('B')} (${pct(byRank.get('B'))}%)`);
  const top = [...unruled].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 20);
  if (top.length) { out.push('Hosts with no rule, most cited first:'); for (const [h, c] of top) out.push(`  ${c} ${h}`); }
  return out.join('\n');
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  let rulesFile = defaultRulesFile;
  const ri = args.indexOf('--rules');
  if (ri >= 0) { rulesFile = args[ri + 1]; args.splice(ri, 2); }
  let rules;
  try { rules = loadRules(rulesFile); } catch (e) { console.log(e.message); process.exit(2); }
  const ci = args.indexOf('--census');
  if (ci >= 0) {
    const root = args[ci + 1];
    if (!root || !fs.existsSync(root)) { console.log(`usage: --census <knowledge-root> (got "${root ?? ''}")`); process.exit(2); }
    console.log(census(root, rules));
    process.exit(0);
  }
  if (!args.length) { console.log('usage: node classify-source.mjs [--rules <file>] <url> … | --census <knowledge-root>'); process.exit(2); }
  let bad = false;
  for (const url of args) {
    const c = classify(url, rules);
    if (!c) { console.log(`not a URL | ${url}`); bad = true; continue; }
    console.log(c.tier === 'A' ? `Rank ${c.rank} | tier A | ${c.rule} | ${url}` : `no rank | tier B | no rule | ${url}`);
  }
  process.exit(bad ? 1 : 0);
}
