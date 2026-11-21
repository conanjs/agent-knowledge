#!/usr/bin/env node
// research-run.mjs — the scripts of a knowledge research run (frameworks/knowledge/research.md). They do the checks
// that need no judgment, so no agent spends tokens on them. A run is the folder research/<topic>/<slug>/
// (schemas/research-run.schema.md, rules RR-1 … RR-15).
//
//   node frameworks/knowledge/tools/research-run/research-run.mjs <command> <run folder | topic/slug> [options]
//
//   init <topic>/<slug>   create research/<topic>/<slug>/plan.md from the template
//   merge <run>           batches/<Qn>/{sources,claims}.yaml → sources.yaml, claims.yaml; verdicts already there stay
//   quotes <run>          every quote must be in .cache/<source-id>.txt after normalizing; a documented claim whose
//                         quotes all match is verified here, the rest go to the verifier
//   replay <run>          run every experiment, normalize its output, compare it with expected.txt (--update writes it)
//   pairs <run>           list each ✅ sentence of the doc with its claim in entailment.yaml, for the verifier
//   validate <run>        check the whole run against the schema for its status
//
// Options: --root <repo> (default: the folder above the run that holds knowledge/; for init, this repo).
// Output: a header line, then `  warn  CODE  message` lines, then PASS (n warning(s)) or FAIL (n) and `  CODE  message`.
// Exit codes: 0 pass, 1 a rule failed, 2 usage error.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const here = path.dirname(fileURLToPath(import.meta.url));
const COMMANDS = ['init', 'merge', 'quotes', 'replay', 'pairs', 'validate'];
const USAGE = `Usage: node research-run.mjs <${COMMANDS.join('|')}> <run folder | topic/slug> [--root <repo>] [--update]`;

function usage(msg) {
  process.stderr.write(`research-run: ${msg}\n${USAGE}\n`);
  process.exit(2);
}

const argv = process.argv.slice(2);
const opts = { command: argv[0], target: null, root: null, update: false };
for (let i = 1; i < argv.length; i++) {
  if (argv[i] === '--root') opts.root = path.resolve(argv[++i] ?? usage('--root needs a folder'));
  else if (argv[i] === '--update') opts.update = true;
  else if (!opts.target) opts.target = argv[i];
  else usage(`unexpected argument ${argv[i]}`);
}
if (!COMMANDS.includes(opts.command)) usage(`unknown command ${opts.command ?? '(none)'}`);
if (!opts.target) usage('a run folder (or topic/slug for init) is required');
if (opts.update && opts.command !== 'replay') usage('--update belongs to replay');

// ---- shared ----------------------------------------------------------------------------------------------------

const fails = [];
const warns = [];
const notes = [];
const fail = (code, msg) => fails.push(`  ${code}  ${msg}`);
const warn = (code, msg) => warns.push(`  warn  ${code}  ${msg}`);

const QID = /^Q[1-9]\d*$/;
const SID = /^(Q[1-9]\d*)-S[1-9]\d*$/;
const CID = /^(Q[1-9]\d*)-C[1-9]\d*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MARK = /(✅|⚠️(?: unverified)?)?\s*\((Q[1-9]\d*-C[1-9]\d*(?:,\s*Q[1-9]\d*-C[1-9]\d*)*)\)/gu;
const ENUM = {
  mode: ['new', 'refresh'],
  status: ['planned', 'approved', 'verified', 'published'],
  tier: ['primary', 'secondary'],
  method: ['web-fetch', 'gh-api', 'local', 'browser'],
  kind: ['documented', 'runtime', 'interpretive'],
  claimStatus: ['active', 'superseded', 'deprecated'],
  verdict: ['pending', 'verified', 'contradicted', 'unsupported'],
  by: ['quote-check', 'verifier', 'experiment'],
  pair: ['pending', 'entails', 'overstates', 'unrelated'],
};
const STAGE = { planned: 0, approved: 1, verified: 2, published: 3 };

function findRoot(start) {
  for (let d = path.resolve(start); ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, 'knowledge'))) return d;
    if (path.dirname(d) === d) return null;
  }
}

function readYaml(file, label) {
  if (!fs.existsSync(file)) return null;
  try {
    return YAML.parse(fs.readFileSync(file, 'utf8')) ?? {};
  } catch (e) {
    fail('RR-1', `${label}: not YAML (${e.message.split('\n')[0]})`);
    return null;
  }
}

const writeYaml = (file, data) => fs.writeFileSync(file, YAML.stringify(data, { lineWidth: 0 }));
const list = (v) => (Array.isArray(v) ? v : []);
const isDate = (v) => (v instanceof Date ? true : typeof v === 'string' && DATE.test(v));

function finish(header) {
  process.stdout.write(`${header}\n`);
  for (const n of notes) process.stdout.write(`${n}\n`);
  for (const w of warns) process.stdout.write(`${w}\n`);
  if (fails.length) {
    process.stdout.write(`FAIL (${fails.length})\n${fails.join('\n')}\n`);
    process.exit(1);
  }
  process.stdout.write(`PASS (${warns.length} warning(s))\n`);
  process.exit(0);
}

// ---- init ------------------------------------------------------------------------------------------------------

const PLAN = (topic, slug, today) => `---
schema: research-run/v1
doc: knowledge/${topic}/${slug}.md
mode: new
status: planned
approved:
last-updated: ${today}
---

# Research plan: <subject>

## Questions
- Q1: <the first thing the doc must answer>
- Q2: <the next one>

## Out of scope
- <what this run will not cover, and why>

## Done when
- <the check that says the doc answers every question>

## Budget
- Researchers: <2-4, one per question> · Sources: <at most n> · Experiments: <which claims need one>
`;

if (opts.command === 'init') {
  const m = /^([a-z0-9-]+(?:\/[a-z0-9-]+)?)\/([a-z0-9-]+)$/.exec(opts.target);
  if (!m) usage('init takes <topic>/<slug> (or <topic>/<sub>/<slug>), lowercase letters, digits and hyphens');
  const root = opts.root ?? path.resolve(here, '..', '..', '..', '..');
  const dir = path.join(root, 'research', m[1], m[2]);
  const plan = path.join(dir, 'plan.md');
  if (fs.existsSync(plan)) {
    fail('RR-1', `research/${m[1]}/${m[2]}/plan.md already exists`);
    finish(`research-run init: research/${m[1]}/${m[2]}`);
  }
  fs.mkdirSync(path.join(dir, 'batches'), { recursive: true });
  fs.writeFileSync(plan, PLAN(m[1], m[2], new Date().toISOString().slice(0, 10)));
  notes.push(`created research/${m[1]}/${m[2]}/plan.md`);
  finish(`research-run init: research/${m[1]}/${m[2]}`);
}

// ---- the run ---------------------------------------------------------------------------------------------------

const run = path.resolve(opts.target);
if (!fs.statSync(run, { throwIfNoEntry: false })?.isDirectory()) usage(`${opts.target}: no such folder`);
const root = opts.root ?? findRoot(run) ?? usage(`${opts.target}: no knowledge/ folder above it; pass --root`);
const show = (p) => path.relative(root, p).split(path.sep).join('/');
const at = (...p) => path.join(run, ...p);
const header = `research-run ${opts.command}: ${show(run)}`;

function readPlan() {
  const file = at('plan.md');
  if (!fs.existsSync(file)) {
    fail('RR-1', 'plan.md is missing');
    return null;
  }
  const text = fs.readFileSync(file, 'utf8');
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  let fm = null;
  try {
    fm = m ? YAML.parse(m[1]) : null;
  } catch {
    fm = null;
  }
  if (!fm || typeof fm !== 'object') {
    fail('RR-1', 'plan.md: no front matter');
    return null;
  }
  if (fm.schema !== 'research-run/v1') fail('RR-1', `plan.md: schema must be research-run/v1, found ${fm.schema}`);
  if (typeof fm.doc !== 'string' || !/^knowledge\/.+\.md$/.test(fm.doc))
    fail('RR-1', 'plan.md: doc must be a path knowledge/<topic>/<slug>.md');
  if (!ENUM.mode.includes(fm.mode)) fail('RR-1', `plan.md: mode must be ${ENUM.mode.join(' or ')}`);
  if (!ENUM.status.includes(fm.status)) fail('RR-1', `plan.md: status must be one of ${ENUM.status.join(', ')}`);
  if (!isDate(fm['last-updated'])) fail('RR-1', 'plan.md: last-updated must be YYYY-MM-DD');
  const questions = new Map();
  for (const q of text.matchAll(/^- (Q[1-9]\d*): (.+)$/gm)) questions.set(q[1], q[2]);
  if (!questions.size) fail('RR-1', 'plan.md: ## Questions needs at least one `- Q1: …` line');
  return { ...fm, questions, stage: STAGE[fm.status] ?? 0 };
}

// ---- merge -----------------------------------------------------------------------------------------------------

if (opts.command === 'merge') {
  const plan = readPlan();
  const dir = at('batches');
  const batches = fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((b) => fs.statSync(path.join(dir, b)).isDirectory())
        .sort()
    : [];
  if (!batches.length) fail('RR-11', 'batches/ has no batch folder');
  const sources = [];
  const claims = [];
  const ids = new Set();
  for (const b of batches) {
    if (!QID.test(b) || (plan && !plan.questions.has(b)))
      fail('RR-11', `batches/${b}: a batch folder is named after a question in plan.md (Q1, Q2, …)`);
    for (const [file, key, re, into] of [
      ['sources.yaml', 'sources', SID, sources],
      ['claims.yaml', 'claims', CID, claims],
    ]) {
      const data = readYaml(path.join(dir, b, file), `batches/${b}/${file}`);
      if (!data) {
        fail('RR-11', `batches/${b}/${file} is missing`);
        continue;
      }
      for (const item of list(data[key])) {
        const id = item?.id;
        if (typeof id !== 'string' || re.exec(id)?.[1] !== b)
          fail('RR-11', `batches/${b}/${file}: id ${id} must be ${b}-${key === 'sources' ? 'S' : 'C'}<n>`);
        else if (ids.has(id)) fail('RR-11', `batches/${b}/${file}: id ${id} appears twice`);
        ids.add(id);
        into.push(item);
      }
    }
  }
  const urls = new Map();
  for (const s of sources) {
    const k = `${s.url}${s.locator ?? ''}`;
    if (urls.has(k)) warn('RR-11', `${s.id} and ${urls.get(k)} cite the same url and locator; the verifier may join them`);
    else urls.set(k, s.id);
  }
  // Verdicts the quote check or the verifier already wrote stay; a merged claim missing from every batch fails.
  const before = new Map(list(readYaml(at('claims.yaml'), 'claims.yaml')?.claims).map((c) => [c.id, c]));
  const kept = ['experiment', 'quote-check', 'verdict', 'verified-by', 'note', 'status', 'superseded-by'];
  for (const c of claims) {
    const old = before.get(c.id);
    for (const k of kept) if (old && old[k] !== undefined && c[k] === undefined) c[k] = old[k];
    c.status ??= 'active';
    c.verdict ??= 'pending';
    before.delete(c.id);
  }
  for (const id of before.keys())
    fail('RR-12', `claims.yaml: ${id} is in no batch; mark it superseded or deprecated in its batch instead of deleting it`);
  if (!fails.length) {
    writeYaml(at('sources.yaml'), { sources });
    writeYaml(at('claims.yaml'), { claims });
    notes.push(`wrote sources.yaml (${sources.length}) and claims.yaml (${claims.length}) from ${batches.length} batch(es)`);
  }
  finish(header);
}

// ---- quotes ----------------------------------------------------------------------------------------------------

/** Text as it compares: Unicode compatibility forms, plain quotes and dashes, no * or `, one space for any run. */
const normalizeText = (t) =>
  t
    .normalize('NFKC')
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/[*`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

if (opts.command === 'quotes') {
  const file = at('claims.yaml');
  const data = readYaml(file, 'claims.yaml');
  if (!data) {
    fail('RR-13', 'claims.yaml is missing; run merge first');
    finish(header);
  }
  const cache = new Map();
  const text = (id) => {
    if (!cache.has(id)) {
      const f = at('.cache', `${id}.txt`);
      cache.set(id, fs.existsSync(f) ? normalizeText(fs.readFileSync(f, 'utf8')) : null);
    }
    return cache.get(id);
  };
  let auto = 0;
  let toVerifier = 0;
  for (const c of list(data.claims)) {
    if (c.status && c.status !== 'active') continue;
    const evidence = list(c.evidence);
    if (!evidence.length) continue;
    let result = 'pass';
    for (const e of evidence) {
      const quote = typeof e?.quote === 'string' ? e.quote : '';
      if (quote.length > 300) warn('RR-14', `${c.id}: the quote from ${e.source} has ${quote.length} characters (keep quotes short, KB-1)`);
      const page = text(e?.source);
      if (page === null) {
        warn('RR-13', `${c.id}: no .cache/${e?.source}.txt to check the quote against; sent to the verifier`);
        result = 'no-cache';
      } else if (!quote || !page.includes(normalizeText(quote))) {
        warn('RR-13', `${c.id}: the quote is not in .cache/${e.source}.txt; sent to the verifier`);
        if (result === 'pass') result = 'fail';
      }
    }
    c['quote-check'] = result;
    // A verdict the quote check gave earlier does not survive a quote that no longer matches.
    if (result !== 'pass' && c['verified-by'] === 'quote-check') {
      c.verdict = 'pending';
      delete c['verified-by'];
    }
    if (result === 'pass' && c.kind === 'documented' && (c.verdict ?? 'pending') === 'pending') {
      c.verdict = 'verified';
      c['verified-by'] = 'quote-check';
      auto++;
    } else if ((c.verdict ?? 'pending') === 'pending') toVerifier++;
  }
  writeYaml(file, data);
  notes.push(`verified by quote check: ${auto}; left for the verifier: ${toVerifier}`);
  finish(header);
}

// ---- replay ----------------------------------------------------------------------------------------------------

/** Output as it compares: LF line ends, no ANSI codes, timestamps, durations, this folder's path or trailing spaces. */
function normalizeOutput(out, dir, extra) {
  let t = out
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g, '<time>')
    .replace(/\b\d+(?:\.\d+)?\s?(?:ms|s)\b/g, '<duration>')
    .replaceAll(dir, '<dir>')
    .replaceAll(os.homedir(), '~');
  for (const n of list(extra)) t = t.replace(new RegExp(n.pattern, 'g'), n.replace ?? '');
  return t.replace(/[ \t]+$/gm, '').trimEnd() + '\n';
}

function experiments() {
  const dir = at('experiments');
  return fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((e) => fs.statSync(path.join(dir, e)).isDirectory())
        .sort()
    : [];
}

if (opts.command === 'replay') {
  const all = experiments();
  if (!all.length) notes.push('no experiments');
  for (const id of all) {
    const dir = at('experiments', id);
    const cfg = readYaml(path.join(dir, 'experiment.yaml'), `experiments/${id}/experiment.yaml`);
    if (!cfg?.command) {
      fail('RR-7', `experiments/${id}: experiment.yaml needs a command`);
      continue;
    }
    const r = spawnSync(cfg.command, {
      cwd: dir,
      shell: true,
      encoding: 'utf8',
      timeout: (cfg.timeout ?? 60) * 1000,
    });
    const out = normalizeOutput(`${r.stdout ?? ''}${r.stderr ?? ''}`, fs.realpathSync(dir), cfg.normalize);
    fs.writeFileSync(path.join(dir, 'output.txt'), out);
    const wantExit = cfg['expected-exit'] ?? 0;
    if (r.error?.code === 'ETIMEDOUT' || r.signal) {
      fail('RR-15', `experiments/${id}: did not finish within ${cfg.timeout ?? 60} s`);
      continue;
    }
    if (r.status !== wantExit) {
      fail('RR-15', `experiments/${id}: exit code ${r.status}, expected ${wantExit}`);
      continue;
    }
    const expectedFile = path.join(dir, 'expected.txt');
    if (opts.update) {
      fs.writeFileSync(expectedFile, out);
      notes.push(`  wrote experiments/${id}/expected.txt`);
      continue;
    }
    if (!fs.existsSync(expectedFile)) {
      fail('RR-15', `experiments/${id}: expected.txt is missing; check output.txt, then run replay --update`);
      continue;
    }
    const want = fs.readFileSync(expectedFile, 'utf8').split('\n');
    const got = out.split('\n');
    const line = want.findIndex((l, i) => l !== got[i]);
    if (line === -1 && want.length === got.length) notes.push(`  pass ${id}`);
    else fail('RR-15', `experiments/${id}: output.txt differs from expected.txt at line ${(line === -1 ? want.length : line) + 1}`);
  }
  finish(header);
}

// ---- the doc's markers -----------------------------------------------------------------------------------------

/** Each claim marker in the doc: the marker (✅, ⚠️ or none), the ids, and the sentence or table cell it sits in. */
function markers(text) {
  const out = [];
  const body = text.replace(/^---\n[\s\S]*?\n---\n/, '');
  for (const line of body.split('\n')) {
    if (!line.includes('(Q')) continue;
    const parts = line.trim().startsWith('|')
      ? line.split('|').map((c) => c.trim())
      : line.trim().split(/(?<=[.!?])\s+(?=[A-Z*`[(])/);
    for (const part of parts) {
      for (const m of part.matchAll(MARK)) {
        const ids = m[2].split(/,\s*/);
        out.push({ mark: m[1]?.startsWith('✅') ? 'ok' : m[1] ? 'warn' : 'none', ids, sentence: part.replace(/^[-*]\s+/, '') });
      }
    }
  }
  return out;
}

if (opts.command === 'pairs') {
  const plan = readPlan();
  const docFile = plan?.doc && path.join(root, plan.doc);
  if (!docFile || !fs.existsSync(docFile)) {
    fail('RR-8', `the doc ${plan?.doc} does not exist yet`);
    finish(header);
  }
  const before = new Map(
    list(readYaml(at('entailment.yaml'), 'entailment.yaml')?.pairs).map((p) => [`${p.claim}\n${p.sentence}`, p]),
  );
  const pairs = [];
  const seen = new Set();
  for (const m of markers(fs.readFileSync(docFile, 'utf8'))) {
    if (m.mark !== 'ok') continue;
    for (const claim of m.ids) {
      const key = `${claim}\n${m.sentence}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push(before.get(key) ?? { claim, sentence: m.sentence, verdict: 'pending' });
    }
  }
  writeYaml(at('entailment.yaml'), { pairs });
  const fresh = pairs.filter((p) => p.verdict === 'pending').length;
  notes.push(`wrote entailment.yaml: ${pairs.length} pair(s), ${fresh} for the verifier`);
  finish(header);
}

// ---- validate --------------------------------------------------------------------------------------------------

const plan = readPlan();
const stage = plan?.stage ?? 0;
const sources = new Map();
const claims = new Map();
const sourcesData = readYaml(at('sources.yaml'), 'sources.yaml');
const claimsData = readYaml(at('claims.yaml'), 'claims.yaml');
const exps = experiments();

// RR-2 approval
if (plan && stage >= STAGE.approved && !isDate(plan.approved)) {
  const fastTrack = plan.mode === 'refresh' && list(sourcesData?.sources).length <= 3 && !exps.length;
  if (!fastTrack)
    fail('RR-2', `plan.md: status ${plan.status} needs approved: YYYY-MM-DD (the day V approved the plan)`);
}

// RR-3 sources
for (const s of list(sourcesData?.sources)) {
  const where = `sources.yaml: ${s?.id ?? '(no id)'}`;
  if (typeof s?.id !== 'string' || !SID.test(s.id)) {
    fail('RR-3', `${where}: id must be Q<n>-S<n>`);
    continue;
  }
  sources.set(s.id, s);
  const local = s['retrieval-method'] === 'local';
  if (typeof s.url !== 'string' || !(local || /^https:\/\//.test(s.url)))
    fail('RR-3', `${where}: url must start with https:// (or be a path, for retrieval-method local)`);
  if (typeof s.locator !== 'string' || !s.locator.trim())
    fail('RR-3', `${where}: locator is required (a section anchor, file path or line range, not the whole site)`);
  for (const k of ['title', 'publisher', 'version'])
    if (typeof s[k] !== 'string' || !s[k].trim()) fail('RR-3', `${where}: ${k} is required`);
  if (!ENUM.tier.includes(s.tier)) fail('RR-3', `${where}: tier must be primary or secondary`);
  if (!ENUM.method.includes(s['retrieval-method']))
    fail('RR-3', `${where}: retrieval-method must be one of ${ENUM.method.join(', ')}`);
  if (!isDate(s['retrieved-at'])) fail('RR-3', `${where}: retrieved-at must be YYYY-MM-DD`);
}

// RR-7 experiments: structure, pinned dependencies, and (from verified on) the last replay matched
const expClaims = new Map();
for (const id of exps) {
  const dir = at('experiments', id);
  const where = `experiments/${id}`;
  const cfg = readYaml(path.join(dir, 'experiment.yaml'), `${where}/experiment.yaml`);
  if (!cfg) fail('RR-7', `${where}: experiment.yaml is missing`);
  else {
    if (typeof cfg.command !== 'string') fail('RR-7', `${where}: experiment.yaml needs a command`);
    if (!list(cfg.claims).length) fail('RR-7', `${where}: experiment.yaml needs claims, the claim ids its assertions test`);
    expClaims.set(id, new Set(list(cfg.claims)));
  }
  for (const f of ['env.txt', 'expected.txt'])
    if (!fs.existsSync(path.join(dir, f))) fail('RR-7', `${where}: ${f} is missing`);
  const pkg = readYaml(path.join(dir, 'package.json'), `${where}/package.json`);
  if (pkg) {
    if (!['pnpm-lock.yaml', 'package-lock.json'].some((f) => fs.existsSync(path.join(dir, f))))
      fail('RR-7', `${where}: package.json without a lockfile (pnpm-lock.yaml or package-lock.json)`);
    for (const [name, v] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies }))
      if (!/^\d+\.\d+\.\d+$/.test(String(v))) fail('RR-7', `${where}: ${name}@${v} is not an exact version`);
  }
  if (stage >= STAGE.verified) {
    const out = path.join(dir, 'output.txt');
    const exp = path.join(dir, 'expected.txt');
    if (!fs.existsSync(out) || (fs.existsSync(exp) && fs.readFileSync(out, 'utf8') !== fs.readFileSync(exp, 'utf8')))
      fail('RR-7', `${where}: output.txt does not equal expected.txt; run replay`);
  }
}

// RR-4 claims, RR-5 corroboration (for a claim marked verified), RR-6 verdicts
for (const c of list(claimsData?.claims)) {
  const where = `claims.yaml: ${c?.id ?? '(no id)'}`;
  const m = typeof c?.id === 'string' ? CID.exec(c.id) : null;
  if (!m) {
    fail('RR-4', `${where}: id must be Q<n>-C<n>`);
    continue;
  }
  claims.set(c.id, c);
  if (plan && !plan.questions.has(m[1])) fail('RR-4', `${where}: ${m[1]} is not a question in plan.md`);
  if (typeof c.statement !== 'string' || !c.statement.trim()) fail('RR-4', `${where}: statement is required`);
  if (!ENUM.kind.includes(c.kind)) fail('RR-4', `${where}: kind must be one of ${ENUM.kind.join(', ')}`);
  const status = c.status ?? 'active';
  if (!ENUM.claimStatus.includes(status)) fail('RR-4', `${where}: status must be one of ${ENUM.claimStatus.join(', ')}`);
  const evidence = list(c.evidence);
  if (!evidence.length && !c.experiment) fail('RR-4', `${where}: needs evidence (source, locator, quote) or an experiment`);
  for (const e of evidence) {
    if (!sources.has(e?.source)) fail('RR-4', `${where}: evidence cites ${e?.source}, which is not in sources.yaml`);
    if (typeof e?.quote !== 'string' || !e.quote.trim()) fail('RR-4', `${where}: every evidence entry needs a quote`);
  }
  if (c.kind === 'runtime' && !c.experiment) fail('RR-4', `${where}: a runtime claim needs an experiment`);
  if (c.experiment && !exps.includes(c.experiment))
    fail('RR-4', `${where}: experiment ${c.experiment} is not a folder in experiments/`);
  if (status === 'superseded' && typeof c['superseded-by'] !== 'string')
    fail('RR-4', `${where}: a superseded claim names its successor in superseded-by`);
  if (status !== 'active') continue;

  const publishers = new Set(evidence.map((e) => sources.get(e?.source)?.publisher).filter(Boolean));
  const allSecondary = evidence.length > 0 && evidence.every((e) => sources.get(e?.source)?.tier === 'secondary');
  if (c.verdict === 'verified' && (c.critical === true || allSecondary) && publishers.size < 2 && !c.experiment)
    fail('RR-5', `${where}: ${c.critical === true ? 'a critical claim' : 'a claim backed only by secondary sources'} needs sources from two publishers, or an experiment`);

  const verdict = c.verdict ?? 'pending';
  if (!ENUM.verdict.includes(verdict)) {
    fail('RR-6', `${where}: verdict must be one of ${ENUM.verdict.join(', ')}`);
    continue;
  }
  if (verdict === 'pending' && stage >= STAGE.verified) fail('RR-6', `${where}: still pending in a ${plan.status} run`);
  if (verdict === 'verified') {
    const by = c['verified-by'];
    if (!ENUM.by.includes(by)) fail('RR-6', `${where}: verified-by must be one of ${ENUM.by.join(', ')}`);
    if (by === 'quote-check' && (c.kind !== 'documented' || c['quote-check'] !== 'pass'))
      fail('RR-6', `${where}: only a documented claim whose quote check passed is verified by the quote check`);
    if ((by === 'experiment' || c.kind === 'runtime') && !expClaims.get(c.experiment)?.has(c.id))
      fail('RR-6', `${where}: experiment ${c.experiment} does not name this claim in its claims list`);
  }
  if ((verdict === 'contradicted' || verdict === 'unsupported') && !c.note)
    fail('RR-6', `${where}: a ${verdict} claim needs a note saying why`);
}
for (const c of claims.values())
  if (c['superseded-by'] && !claims.has(c['superseded-by']))
    fail('RR-4', `claims.yaml: ${c.id}: superseded-by ${c['superseded-by']} is not a claim`);

// RR-9 the verifier's report
if (stage >= STAGE.verified && !fs.existsSync(at('verification.md')))
  fail('RR-9', `verification.md is missing in a ${plan.status} run`);

// RR-8 the doc, RR-10 entailment
if (stage >= STAGE.published && plan?.doc) {
  const docFile = path.join(root, plan.doc);
  if (!fs.existsSync(docFile)) fail('RR-8', `${plan.doc} does not exist`);
  else {
    const text = fs.readFileSync(docFile, 'utf8');
    const runPath = show(run);
    const refs = text.split(/^## References$/m)[1]?.split(/^## /m)[0] ?? '';
    if (!refs.includes(runPath)) fail('RR-8', `${plan.doc}: References does not list the run folder ${runPath}/`);
    const ms = markers(text);
    const body = text.replace(/^---\n[\s\S]*?\n---\n/, '');
    const bare = (body.match(/✅(?!\s*\(Q[1-9]\d*-C)/gu) ?? []).length;
    if (bare) fail('RR-8', `${plan.doc}: ${bare} ✅ without a claim id; every ✅ in a researched doc names its claim, e.g. ✅ (Q1-C2)`);
    const pairs = new Map(
      list(readYaml(at('entailment.yaml'), 'entailment.yaml')?.pairs).map((p) => [`${p.claim}\n${p.sentence}`, p]),
    );
    for (const m of ms) {
      for (const id of m.ids) {
        const c = claims.get(id);
        if (!c) {
          fail('RR-8', `${plan.doc}: cites ${id}, which is not in claims.yaml`);
          continue;
        }
        const status = c.status ?? 'active';
        if (status !== 'active') fail('RR-8', `${plan.doc}: cites ${id}, which is ${status}`);
        else if (c.verdict === 'contradicted') fail('RR-8', `${plan.doc}: cites ${id}, which the verifier found contradicted`);
        else if (m.mark === 'ok' && c.verdict !== 'verified')
          fail('RR-8', `${plan.doc}: marks ${id} ✅, but its verdict is ${c.verdict ?? 'pending'}`);
        if (m.mark !== 'ok') continue;
        const p = pairs.get(`${id}\n${m.sentence}`);
        if (!p) fail('RR-10', `${plan.doc}: the ✅ sentence for ${id} is not in entailment.yaml; run pairs`);
        else if (p.verdict !== 'entails')
          fail('RR-10', `${plan.doc}: the sentence for ${id} is ${p.verdict}, not entails, in entailment.yaml`);
      }
    }
    const inDoc = new Set(ms.flatMap((m) => m.ids.map((id) => `${id}\n${m.sentence}`)));
    for (const key of pairs.keys())
      if (!inDoc.has(key)) warn('RR-10', `entailment.yaml: the pair for ${key.split('\n')[0]} is no longer in the doc; run pairs`);
  }
}

notes.push(
  `${plan?.status ?? '?'}: ${sources.size} source(s), ${claims.size} claim(s), ${exps.length} experiment(s)`,
);
finish(header);
