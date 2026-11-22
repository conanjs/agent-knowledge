#!/usr/bin/env node
// evaluate-research.mjs — Stage 1 helpers of the research verifier (frameworks/knowledge/research-agent.design.md §3.2).
//
// Usage: node evaluate-research.mjs ranks <doc.md>
//        node evaluate-research.mjs quotes <verdict.json> <input-dir>
//        node evaluate-research.mjs verdict <verdict.json> [--write]
//        node evaluate-research.mjs stage1 <run> <n> [--out <dir>] [--sample <k> --seed <s> [--include <regex>...]]
//   ranks   one line per URL in the doc's References: its footnotes, the rank the rules give (tier A) or "no rank" (tier B,
//           which the judge re-rates), and the rank the doc wrote, if any; "differs" marks a written rank the rules contradict
//   quotes  checks every quote behind a verdict other than entails (its page_says) against the saved text of the pages that
//           claim cites (<input-dir>/cache/, through the verdict's sources); text is compared after normalizing letter case,
//           quotes, dashes, white space and comment or list markers at line starts (* // # > - +), so a quote that wraps across lines of a
//           source-code comment still matches; a page_says that quotes two pages may carry their footnotes inline, or
//           name each page before its "quoted" text, and then only the quoted text is checked. A footnote's pages come from
//           stage1.json when the input folder has it, plus the verdict's own sources; a quote of a cited probe's output
//           is checked against that probe's stdout in harness.json
//   verdict the final verdict (design §3.4, decided by V 2026-11-22): the judge's FAIL stays FAIL; its PASS stays PASS only
//           when at least 70% of the judged claims are checkable (a verdict other than not_checkable and no_cache), and
//           becomes INCONCLUSIVE otherwise. --write adds it to the verdict file as "final"
//   stage1  builds the judge's input folder (default <run>/verdicts/round-<n>.input/) from <run>/doc.md, <run>/sources.json and
//           <run>/cache/: the doc, the saved pages it cites, sources.json, criteria.json if present, probes/ and this
//           round's harness result as harness.json if present (Stage 1.5), and stage1.json, which
//           gives every References URL its tier and, for tier A, the rank and rule the judge takes as given. --sample adds
//           claims.json: k of the doc's ✅ claims, each `## ` heading getting its share by its claim count (at least 1),
//           picked with a seeded generator (mulberry32) so the same seed gives the same sample; --include forces, for each
//           regex up to the next --option, the first claim matching it into the sample
//   ledger  checks a research worker's ledger/<profile>.json files (all of them, or the profiles named) against
//           ledger.schema.md: each source is in sources.json with the same cache file and fetch time, its saved page still
//           has the SHA-256 it was saved with, and its tier, rank and rule agree with the rules; at most --cap sources
//           (default 4) besides seed sources; each fact's quote is in its source's page at loc.lines (give or take 2
//           lines), after the same normalizing as quotes; conflicts name facts of the ledger; a key the schema does not
//           define (a drafted section, say) is an error, since a worker writes no doc text
// Exit codes: 0 done, 1 a quote was not found or a ledger has an error, 2 usage error or unreadable input.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { classify, loadRules, referenceEntries } from '../classify-source/classify-source.mjs';

const out = (s) => console.log(s);
const die = (msg) => { out(msg); process.exit(2); };
const USAGE = 'usage: node evaluate-research.mjs ranks <doc.md> | quotes <verdict.json> <input-dir> | verdict <verdict.json> [--write] | stage1 <run> <n> [--out <dir>] [--sample <k> --seed <s> [--include <regex>...]] | ledger <run> [<profile>...] [--cap <n>]';

function referencesOf(text) {
  const clean = text.replace(/\r\n/g, '\n').replace(/^(`{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm, '');
  const m = clean.match(/^## References[ \t]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m);
  return m ? m[1] : '';
}

function ranks(docPath) {
  if (!docPath || !fs.existsSync(docPath)) die(`${USAGE}\nno doc at "${docPath ?? ''}"`);
  const rules = loadRules();
  let a = 0; let b = 0; let differ = 0; let n = 0;
  for (const e of referenceEntries(referencesOf(fs.readFileSync(docPath, 'utf8')))) {
    const labels = e.labels.length ? e.labels.map((l) => `[^${l}]`).join(' ') : '(no footnote)';
    for (const url of e.urls) {
      const c = classify(url, rules);
      if (!c) continue;
      n++;
      const written = e.rank ? `written Rank ${e.rank}` : 'written: none';
      const flag = c.tier === 'A' && e.rank && e.rank !== c.rank ? ' | differs' : '';
      if (flag) differ++;
      if (c.tier === 'A') { a++; out(`${labels} | Rank ${c.rank} | tier A | ${c.rule} | ${written} | ${url}${flag}`); }
      else { b++; out(`${labels} | no rank | tier B | no rule | ${written} | ${url}`); }
    }
  }
  out(`${n} URLs: ${a} tier A, ${b} tier B; ${differ} written rank(s) differ from the rules`);
}

const norm = (t) => t
  .replace(/^[ \t]*(?:\*+|\/\/+|#+|>+|[-+](?=\s))[ \t]?/gm, '')
  .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/ /g, ' ')
  .replace(/\s+/g, ' ').replace(/ - /g, ' ').trim().toLowerCase(); // a list dash kept inside a quote matches the page's list line
const labelsOf = (s) => [...String(s ?? '').matchAll(/\[\^?([\w.-]+)\]/g)].map((m) => m[1]);

function quotes(verdictPath, inputDir) {
  if (!verdictPath || !inputDir) die(USAGE);
  let v;
  try { v = JSON.parse(fs.readFileSync(verdictPath, 'utf8')); } catch (e) { die(`cannot read verdict ${verdictPath}: ${e.message}`); }
  const pageText = new Map();
  const page = (rel) => {
    if (!pageText.has(rel)) {
      const p = path.join(inputDir, rel);
      pageText.set(rel, fs.existsSync(p) ? norm(fs.readFileSync(p, 'utf8')) : null);
    }
    return pageText.get(rel);
  };
  const cacheOf = new Map(); // footnote label -> cache files, from stage1.json (Stage 1's own map) and the verdict's sources
  const addCache = (refs, cache) => {
    const files = [...String(cache ?? '').matchAll(/cache\/[\w.-]+\.txt/g)].map((m) => m[0]);
    for (const l of labelsOf(refs)) cacheOf.set(l, [...(cacheOf.get(l) ?? []), ...files]);
  };
  try {
    for (const s of JSON.parse(fs.readFileSync(path.join(inputDir, 'stage1.json'), 'utf8')).sources ?? []) addCache((s.labels ?? []).join(' '), s.cache);
  } catch { /* no stage1.json: the verdict's sources only */ }
  for (const s of v.sources ?? []) addCache(s.ref, s.cache);
  const probeOut = new Map(); // probe id -> its stdout in harness.json (a quote of a probe's output is checked there)
  try {
    for (const p of JSON.parse(fs.readFileSync(path.join(inputDir, 'harness.json'), 'utf8')).probes ?? []) probeOut.set(p.probe_id, norm(p.stdout ?? ''));
  } catch { /* no probes */ }
  let found = 0; let missing = 0; let claims = 0;
  for (const c of v.claim_checks ?? []) {
    if (['entails', 'observed', 'not_checkable', 'no_cache'].includes(c.verdict)) continue;
    const q = String(c.page_says ?? '').split(/\bnot found\b/i)[0]; // a note such as "Not found for x: searched …" ends the quotes
    if (!q.trim()) continue;
    claims++;
    const files = [...new Set(labelsOf(c.source).flatMap((l) => cacheOf.get(l) ?? []))];
    const texts = files.map(page).filter((t) => t !== null)
      .concat(labelsOf(c.source).filter((l) => probeOut.has(l)).map((l) => probeOut.get(l)));
    const where = texts.length ? texts : [...fs.readdirSync(path.join(inputDir, 'cache'))].map((f) => page(`cache/${f}`));
    const quoted = [...q.matchAll(/"([^"]{12,})"|\u201c([^\u201d]{12,})\u201d|(?:^|[\s(])'([^']{12,})'(?=[\s;:,.)]|$)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
    // A page_says that names pages ("lifecycle: \"…\"") is checked by its quoted parts; without quotes, a leading
    // "<page or probe> stdout:" style label is dropped.
    const parts = quoted.length ? quoted : [q.replace(/^[\w .-]{1,40}:\s+/, '')];
    for (const seg of parts.flatMap((x) => x.split(/\s*(?:…|\.\.\.|\[\^?[\w.-]+\]|\s\|\s|\s\/\s)\s*/))) {
      const s = norm(seg.replace(/^["'\s]+|["'\s]+$/g, ''));
      if (s.length < 12) continue;
      if (where.some((t) => t && t.includes(s))) found++;
      else { missing++; out(`missing | ${c.id ?? '?'} | ${s.slice(0, 80)}`); }
    }
  }
  out(`quotes: ${found} found, ${missing} missing, in ${claims} claim(s) with a verdict other than entails`);
  process.exit(missing ? 1 : 0);
}

// ---- verdict: PASS, FAIL or INCONCLUSIVE ----------------------------------------------------------------------

const THRESHOLD = 0.7;
function finalVerdict(verdictPath, write) {
  if (!verdictPath) die(USAGE);
  let v;
  try { v = JSON.parse(fs.readFileSync(verdictPath, 'utf8')); } catch (e) { die(`cannot read verdict ${verdictPath}: ${e.message}`); }
  const claims = v.claim_checks ?? [];
  const checkable = claims.filter((c) => !['not_checkable', 'no_cache'].includes(c.verdict)).length;
  const share = claims.length ? checkable / claims.length : 0;
  const final = v.verdict === 'PASS' && share < THRESHOLD ? 'INCONCLUSIVE' : v.verdict;
  const pct = Math.round(share * 100);
  out(`final verdict: ${final} (judge ${v.verdict}; ${checkable} of ${claims.length} claims checkable, ${pct}%; threshold ${THRESHOLD * 100}%)`);
  if (write) {
    v.final = { verdict: final, checkable, claims: claims.length, share: Number(share.toFixed(2)), threshold: THRESHOLD, by: 'evaluate-research.mjs verdict' };
    fs.writeFileSync(verdictPath, JSON.stringify(v, null, 2) + '\n');
  }
}

// ---- stage1: the judge's input folder -------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Every ✅ claim of a doc: { line, heading, claim, context }. Envelope sections and the marking legend are skipped. */
function claimsOf(text) {
  const SKIP = /^## (References|Related|Verification status)\b/i;
  const CITE = /\s*((?:\[\^?[\w.-]+\])+|\(\[[^\]]+\]\([^)]+\)\))?/y;
  const claims = []; let heading = null; let skip = false; let fence = false;
  text.replace(/\r\n/g, '\n').split('\n').forEach((line, i) => {
    if (line.startsWith('```')) fence = !fence;
    if (fence) return;
    if (line.startsWith('## ')) { heading = line.trim(); skip = SKIP.test(line); return; }
    if (skip || heading === null || !line.includes('✅') || /✅\s*=/.test(line)) return;
    let start = 0;
    for (const m of line.matchAll(/✅/g)) {
      CITE.lastIndex = m.index + 1;
      const end = CITE.exec(line) ? CITE.lastIndex : m.index + 1;
      const seg = line.slice(start, end);
      const cut = Math.max(seg.lastIndexOf('|'), seg.lastIndexOf('. ', Math.max(0, seg.length - (end - m.index) - 2)));
      const claim = (cut >= 0 ? seg.slice(cut + 1) : seg).replace(/^[\s|]+|[\s|]+$/g, '');
      claims.push({ line: i + 1, heading, claim, context: line.trim().slice(0, 1200) });
      start = end;
    }
  });
  return claims;
}

function sample(claims, k, seed, include) {
  const strata = new Map();
  for (const c of claims) strata.set(c.heading, [...(strata.get(c.heading) ?? []), c]);
  const total = claims.length; k = Math.min(k, total);
  const quota = new Map([...strata].map(([h, v]) => [h, (k * v.length) / total]));
  const alloc = new Map([...quota].map(([h, q]) => [h, Math.floor(q)]));
  if (k >= strata.size) for (const h of alloc.keys()) alloc.set(h, Math.max(1, alloc.get(h)));
  const sum = () => [...alloc.values()].reduce((x, y) => x + y, 0);
  while (sum() > k) {
    const h = [...alloc.keys()].reduce((a, b) => ((alloc.get(b) - quota.get(b)) > (alloc.get(a) - quota.get(a)) ? b : a));
    alloc.set(h, alloc.get(h) - 1);
  }
  for (const h of [...quota.keys()].sort((a, b) => (quota.get(b) % 1) - (quota.get(a) % 1))) {
    if (sum() >= k) break;
    if (alloc.get(h) < strata.get(h).length) alloc.set(h, alloc.get(h) + 1);
  }
  const rnd = mulberry32(seed); const picked = [];
  for (const [h, pool] of strata) {
    const forced = [];
    for (const r of include) {
      const re = new RegExp(r);
      const hit = pool.find((c) => re.test(c.claim) && !forced.includes(c)) ?? pool.find((c) => re.test(c.context) && !forced.includes(c));
      if (hit) forced.push(hit);
    }
    const rest = pool.filter((c) => !forced.includes(c));
    for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
    picked.push(...forced, ...rest.slice(0, Math.max(0, alloc.get(h) - forced.length)));
  }
  picked.sort((a, b) => a.line - b.line);
  return {
    doc_claims: total, sample_size: picked.length, seed,
    strata: Object.fromEntries([...strata].map(([h, v]) => [h, [v.length, picked.filter((c) => c.heading === h).length]])),
    claims: picked.map((c, i) => ({ id: `S${i + 1}`, line: c.line, heading: c.heading, claim: c.claim, context: c.context })),
  };
}

function stage1(args) {
  const [run, n] = args;
  if (!run || !/^\d+$/.test(n ?? '')) die(USAGE);
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const includes = [];
  for (let i = args.indexOf('--include') + 1; i > 0 && i < args.length && !args[i].startsWith('--'); i++) includes.push(args[i]);
  const dst = path.resolve(opt('--out') ?? path.join(run, 'verdicts', `round-${n}.input`));
  const docPath = path.join(run, 'doc.md');
  if (!fs.existsSync(docPath)) die(`no doc at ${docPath}`);
  const text = fs.readFileSync(docPath, 'utf8');
  let index = [];
  try { index = JSON.parse(fs.readFileSync(path.join(run, 'sources.json'), 'utf8')); } catch { /* no pages saved yet */ }
  const byUrl = new Map(index.map((e) => [String(e.normalized ?? e.url).split('#')[0], e]));
  fs.rmSync(dst, { recursive: true, force: true });
  fs.mkdirSync(path.join(dst, 'cache'), { recursive: true });
  fs.copyFileSync(docPath, path.join(dst, 'doc.md'));
  const docUrls = new Set([...text.matchAll(/https?:\/\/[^\s)>\]`"'|]+/g)].map((m) => m[0].replace(/[.,;:]+$/, '').split('#')[0]));
  const kept = []; let cached = 0;
  for (const u of docUrls) {
    const e = byUrl.get(u);
    if (e?.status === 200 && e.cache && fs.existsSync(path.join(run, e.cache))) {
      fs.copyFileSync(path.join(run, e.cache), path.join(dst, e.cache)); cached++; kept.push(e);
    } else kept.push({ url: u, normalized: u, status: e?.status ?? 'not fetched' });
  }
  fs.writeFileSync(path.join(dst, 'sources.json'), JSON.stringify(kept, null, 1) + '\n');
  if (fs.existsSync(path.join(run, 'criteria.json'))) fs.copyFileSync(path.join(run, 'criteria.json'), path.join(dst, 'criteria.json'));
  // Stage 1.5's evidence (design §3.6): the probes and this round's harness result, so the judge can read the probe code.
  if (fs.existsSync(path.join(run, 'probes'))) fs.cpSync(path.join(run, 'probes'), path.join(dst, 'probes'), { recursive: true });
  const harness = path.join(run, 'verdicts', `round-${n}.harness.json`);
  if (fs.existsSync(harness)) fs.copyFileSync(harness, path.join(dst, 'harness.json'));
  const rules = loadRules(); const sources = [];
  for (const e of referenceEntries(referencesOf(text))) {
    for (const url of e.urls) {
      const c = classify(url, rules);
      if (!c) continue;
      sources.push({ labels: e.refs, url, tier: c.tier, rank: c.rank, rule: c.rule,
        written_rank: e.rank, cache: byUrl.get(url.split('#')[0])?.cache ?? null });
    }
  }
  const tierB = sources.filter((s) => s.tier === 'B').map((s) => s.url);
  fs.writeFileSync(path.join(dst, 'stage1.json'), JSON.stringify({
    stage: 1, doc: 'doc.md', rules: 'frameworks/knowledge/tools/classify-source/source-ranks.json',
    note: 'Tier A ranks come from the rules and are taken as given. Tier B sources have no rule: rate each one.',
    sources, tier_b: tierB,
  }, null, 1) + '\n');
  let line = `${dst} | ${sources.length} References URLs: ${sources.length - tierB.length} tier A, ${tierB.length} tier B | pages saved: ${cached} of ${docUrls.size} URLs in the doc`;
  if (opt('--sample')) {
    const seed = Number(opt('--seed') ?? NaN);
    if (!Number.isInteger(seed)) die('--sample needs --seed <integer>');
    const s = sample(claimsOf(text), Number(opt('--sample')), seed, includes);
    fs.writeFileSync(path.join(dst, 'claims.json'), JSON.stringify(s, null, 1) + '\n');
    line += ` | sample: ${s.sample_size} of ${s.doc_claims} claims, seed ${seed}`;
  }
  out(line);
}

// ---- ledger: a research worker's sources and facts (ledger.schema.md) -----------------------------------------

const PROFILES = ['taxonomy', 'ground-truth', 'practitioner', 'pitfall'];
const LEDGER_KEYS = {
  ledger: ['profile', 'question', 'terms', 'sources', 'facts', 'conflicts'],
  source: ['id', 'url', 'cache', 'fetched', 'tier', 'rank', 'rule', 'rank_basis', 'seed', 'provenance_ref'],
  fact: ['id', 'source', 'summary', 'quote', 'loc'],
  conflict: ['id', 'topic', 'facts', 'note'],
};
const SPAN = 20; // a fact's loc.lines covers at most this many lines
const SLACK = 2; // a quote may start or end this many lines away from loc.lines
const lineSpan = ([i, j]) => (i === j ? `line ${i}` : `lines ${i}–${j}`);

function checkLedger(run, file, { cap, index, rules }) {
  const profile = file.replace(/\.json$/, '');
  let errors = 0; let warnings = 0;
  const err = (id, msg) => { errors++; out(`error | ${profile} | ${id} | ${msg}`); };
  const warn = (id, msg) => { warnings++; out(`warn | ${profile} | ${id} | ${msg}`); };
  let L;
  try { L = JSON.parse(fs.readFileSync(path.join(run, 'ledger', file), 'utf8')); } catch (e) {
    err('json', `cannot read ledger/${file}: ${e.message}`);
    return true;
  }
  const extra = (obj, kind, id) => {
    for (const k of Object.keys(obj ?? {})) if (!LEDGER_KEYS[kind].includes(k)) err(id ?? k, `unknown key "${k}": a ledger holds sources, facts and conflicts, no doc text`);
  };
  const pages = new Map(); // cache file -> { raw, lines }, or null when the run lacks it
  const page = (rel) => {
    if (!pages.has(rel)) {
      const p = path.join(run, String(rel));
      const raw = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
      pages.set(rel, raw === null ? null : { raw, lines: raw.replace(/\r\n/g, '\n').split('\n') });
    }
    return pages.get(rel);
  };
  const checked = new Set();
  const savedPage = (id, rel, what) => { // a page saved by fetch-source.mjs, listed in sources.json, unchanged since
    const pg = page(rel);
    if (!pg) { err(id, `${what} ${rel} is not in the run`); return; }
    if (checked.has(rel)) return;
    checked.add(rel);
    const entry = index.find((e) => e.cache === rel);
    if (!entry) err(id, `${what} ${rel} is not in sources.json: save every page with fetch-source.mjs`);
    const head = pg.raw.match(/^SHA256: ([0-9a-f]{64})$/m); const cut = pg.raw.indexOf('\n\n');
    if (!head || cut < 0) { warn(id, `${rel} has no SHA-256 header: a page not saved by fetch-source.mjs`); return; }
    const digest = crypto.createHash('sha256').update(pg.raw.slice(cut + 2)).digest('hex');
    if (digest !== head[1] || (entry?.sha256 && entry.sha256 !== head[1])) err(id, `${rel} changed after it was fetched: its text no longer matches the SHA-256 it was saved with`);
  };

  extra(L, 'ledger');
  if (!PROFILES.includes(L.profile)) err('profile', `"${L.profile}" is not one of ${PROFILES.join(', ')}`);
  else if (L.profile !== profile) err('profile', `"${L.profile}" in a file named ${file}`);

  const sources = new Map();
  for (const s of L.sources ?? []) {
    extra(s, 'source', s.id);
    if (!s.id || sources.has(s.id)) { err(s.id ?? 'sources', `source id "${s.id}" is missing or used twice`); continue; }
    sources.set(s.id, s);
    const url = String(s.url ?? '').split('#')[0].replace(/[.,;:]+$/, '');
    const entry = index.find((e) => String(e.normalized ?? e.url) === url);
    if (!entry) err(s.id, `${url} is not in sources.json: save every page with fetch-source.mjs`);
    else {
      if (entry.status !== 200) err(s.id, `sources.json has status ${entry.status} for ${url}`);
      if (entry.cache !== s.cache) err(s.id, `cache ${s.cache}, but sources.json has ${entry.cache}`);
      if (entry.fetched !== s.fetched) err(s.id, `fetched ${s.fetched}, but sources.json has ${entry.fetched}`);
    }
    savedPage(s.id, s.cache, 'cache');
    const c = classify(url, rules);
    if (c?.tier === 'A') {
      if (s.tier !== 'A' || s.rank !== c.rank || s.rule !== c.rule) err(s.id, `tier ${s.tier} Rank ${s.rank}, but the rule ${c.rule} gives tier A Rank ${c.rank}`);
    } else {
      if (s.tier !== 'B' || (s.rule ?? null) !== null) err(s.id, `tier ${s.tier} with rule ${s.rule}, but no rule fits: tier B, rule null`);
      if (!Number.isInteger(s.rank) || s.rank < 1 || s.rank > 6) err(s.id, 'a tier B source needs the worker\'s rank, 1 to 6');
      else if ([1, 4].includes(s.rank) && !s.provenance_ref) warn(s.id, `tier B Rank ${s.rank} with no provenance_ref: name the page that shows the author's role, unless the URL is the project's own home`);
    }
    if (s.provenance_ref) savedPage(s.id, s.provenance_ref, 'provenance_ref');
  }
  const seeds = [...sources.values()].filter((s) => s.seed === true).length;
  const counted = sources.size - seeds;
  if (counted > cap) err('sources', `${counted} sources count against the cap of ${cap}${seeds ? ` (${seeds} seed source${seeds > 1 ? 's' : ''} not counted)` : ''}`);

  const facts = new Set(); let placed = 0;
  for (const x of L.facts ?? []) {
    extra(x, 'fact', x.id);
    if (!x.id || facts.has(x.id)) { err(x.id ?? 'facts', `fact id "${x.id}" is missing or used twice`); continue; }
    facts.add(x.id);
    const s = sources.get(x.source);
    if (!s) { err(x.id, `source ${x.source} is not in this ledger`); continue; }
    if (!String(x.summary ?? '').trim()) err(x.id, 'no summary');
    else if (x.summary.length > 300) warn(x.id, `a summary of ${x.summary.length} characters: one or two sentences, since the orchestrator writes the doc`);
    const segs = String(x.quote ?? '').split(/\s*(?:…|\.\.\.)\s*/).map(norm).filter((t) => t.length >= 12);
    if (!segs.length) { err(x.id, 'a quote shorter than 12 characters: quote the sentence that says it'); continue; }
    const [a, b] = x.loc?.lines ?? [];
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 1 || b < a) { err(x.id, 'loc.lines must be [first, last], counted from 1'); continue; }
    if (b - a + 1 > SPAN) { err(x.id, `loc.lines covers ${b - a + 1} lines, at most ${SPAN}`); continue; }
    const pg = page(s.cache);
    if (!pg) continue; // reported with the source
    const ls = pg.lines;
    const at = (i, j) => norm(ls.slice(i - 1, j).join('\n'));
    const win = at(Math.max(1, a - SLACK), Math.min(ls.length, b + SLACK));
    const off = segs.find((t) => !win.includes(t));
    if (!off) {
      placed++;
      const h = norm(String(x.loc.heading ?? ''));
      if (!h) warn(x.id, 'no loc.heading');
      else if (!ls.slice(0, a).some((l) => norm(l).includes(h))) warn(x.id, `heading "${x.loc.heading}" is not above ${lineSpan([a, a])} of ${s.cache}`);
      continue;
    }
    if (!at(1, ls.length).includes(off)) { err(x.id, `quote not in ${s.cache}: "${off.slice(0, 80)}"`); continue; }
    let where = null;
    for (let j = 1; j <= ls.length && !where; j++) {
      if (!at(Math.max(1, j - SPAN + 1), j).includes(off)) continue;
      for (let i = j; i >= Math.max(1, j - SPAN + 1); i--) if (at(i, j).includes(off)) { where = [i, j]; break; }
    }
    err(x.id, `quote is at ${where ? lineSpan(where) : 'more than 20 lines'} of ${s.cache}, not at ${lineSpan([a, b])}`);
  }

  for (const c of L.conflicts ?? []) {
    extra(c, 'conflict', c.id);
    const named = Array.isArray(c.facts) ? c.facts : [];
    if (named.length < 2) err(c.id ?? 'conflicts', 'a conflict names at least 2 facts');
    for (const f of named) if (!facts.has(f)) err(c.id ?? 'conflicts', `fact ${f} is not in this ledger`);
  }
  const n = (k, word) => `${k} ${word}${k === 1 ? '' : 's'}`;
  out(`ledger ${profile}: ${n(sources.size, 'source')} (${counted} counted, cap ${cap}), ${n(facts.size, 'fact')} (${placed} at their place), ${n((L.conflicts ?? []).length, 'conflict')}: ${n(errors, 'error')}, ${n(warnings, 'warning')}`);
  return errors > 0;
}

function ledger(args) {
  const capAt = args.indexOf('--cap');
  const cap = capAt >= 0 ? Number(args[capAt + 1]) : 4;
  const [run, ...profiles] = args.filter((_, i) => capAt < 0 || (i !== capAt && i !== capAt + 1));
  if (!run || !Number.isInteger(cap) || cap < 1) die(USAGE);
  const dir = path.join(run, 'ledger');
  if (!fs.existsSync(dir)) die(`no ledger folder at ${dir}`);
  const files = profiles.length ? profiles.map((p) => `${p}.json`) : fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  let index = [];
  try { index = JSON.parse(fs.readFileSync(path.join(run, 'sources.json'), 'utf8')); } catch { /* none: every source fails */ }
  const rules = loadRules();
  let failed = false;
  for (const f of files) failed = checkLedger(run, f, { cap, index, rules }) || failed;
  process.exit(failed ? 1 : 0);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'ledger') ledger(rest);
else if (cmd === 'ranks') ranks(rest[0]);
else if (cmd === 'quotes') quotes(rest[0], rest[1]);
else if (cmd === 'stage1') stage1(rest);
else if (cmd === 'verdict') finalVerdict(rest[0], rest.includes('--write'));
else die(USAGE);
