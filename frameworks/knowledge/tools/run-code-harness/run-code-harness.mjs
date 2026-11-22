#!/usr/bin/env node
// run-code-harness.mjs — Stage 1.5 of the research verifier (frameworks/knowledge/research-agent.design.md §3.6): runs the
// tagged code blocks ("probes") of a doc in a throw-away container with no network, and checks each against what it expects.
//
// Usage: node run-code-harness.mjs extract <doc.md> <probes-dir>
//        node run-code-harness.mjs run <run> <n>
//   extract  writes every tagged block of the doc to <probes-dir>/<id>.<ext> (a block that `uses=` a lib gets the lib's
//            code first) and <probes-dir>/manifest.json; untagged blocks are illustrations and are skipped
//   run      extracts <run>/doc.md into <run>/probes/, runs every verify and syntax-only probe, and writes
//            <run>/verdicts/round-<n>.harness.json. A tsc probe runs on TypeScript 5 (the runtime the doc names) and again on
//            TypeScript 7, and records whether 7 gives the same outcome and diagnostics, and its exit code ("compat")
//
// A tag is the fence's info string after the language: verify | syntax-only | lib, then key=value pairs
// (a value with spaces in double quotes): id=probe-<nn> (lib: any id), runtime=<name>, expect=exit:<n> | throws:<Name> |
// stdout:<text> (the output contains the text, whatever the exit code; verify only), uses=<lib id>[,<lib id>], repeat=<n> (a timing-dependent probe: passes when every run
// passes, fails when every run fails, "mixed" otherwise).
// Exit codes: 0 every probe passed, 1 a probe failed or was mixed, 2 usage error or a bad tag, 3 Docker is not available
// (every probe is not_run: the claims they back stay unverified).
// Environment (scenarios only): KB_HARNESS_DOCKER overrides the docker command; KB_HARNESS_RUNNER=host-node runs node24
// probes with the host's node and no container.

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const RUNTIMES = {
  node24: { image: 'node:24.22.1-alpine', ext: 'js', verify: (f) => `node ${f}`, syntax: (f) => `node --check ${f}` },
  python3: { image: 'linlab:1', ext: 'py', verify: (f) => `python3 ${f}`, syntax: (f) => `python3 -m py_compile ${f}` },
  c: { image: 'linlab:1', ext: 'c', verify: (f) => `gcc -O0 -pthread -o /tmp/probe ${f} && /tmp/probe`, syntax: (f) => `gcc -fsyntax-only ${f}` },
  tsc: { image: 'kb-probe-tsc5:5.9.3', ext: 'ts', verify: (f) => `tsc --noEmit --strict --target es2022 ${f}`, syntax: (f) => `tsc --noEmit --strict --target es2022 ${f}`, compat: 'tsc7' },
  tsc7: { image: 'kb-probe-tsc7:7.0.2', ext: 'ts', verify: (f) => `tsc --noEmit --strict --target es2022 ${f}`, syntax: (f) => `tsc --noEmit --strict --target es2022 ${f}` },
};
const MODES = ['verify', 'syntax-only', 'lib'];
const TIMEOUT_MS = 10000;

/** Parse a fence info string into { lang, mode, attrs } when it carries a harness tag, else null. Throws on a bad tag. */
export function parseTag(info) {
  const words = [...info.matchAll(/([\w-]+)="([^"]*)"|(\S+)/g)].map((m) => (m[1] ? `${m[1]}=${m[2]}` : m[3]));
  const [lang, mode, ...rest] = words;
  if (!MODES.includes(mode)) return null;
  const attrs = {};
  for (const w of rest) {
    const i = w.indexOf('=');
    if (i <= 0) throw new Error(`"${w}" is not key=value`);
    attrs[w.slice(0, i)] = w.slice(i + 1);
  }
  if (!attrs.id) throw new Error('no id=');
  if (mode !== 'lib' && !/^probe-[\w-]+$/.test(attrs.id)) throw new Error(`id "${attrs.id}" must be probe-<nn>`);
  if (!RUNTIMES[attrs.runtime]) throw new Error(`runtime "${attrs.runtime ?? ''}" is not one of ${Object.keys(RUNTIMES).join(', ')}`);
  if (mode === 'verify' && !/^(exit:\d+|throws:\w+|stdout:.+)$/.test(attrs.expect ?? '')) throw new Error(`expect "${attrs.expect ?? ''}" is not exit:<n>, throws:<Name> or stdout:<text>`);
  if (mode !== 'verify' && attrs.expect) throw new Error(`expect= is for verify blocks only`);
  return { lang, mode, attrs };
}

/** Every tagged block of a doc: { line, lang, mode, attrs, code }, and the problems found (bad tags, duplicate or unknown ids). */
export function blocksOf(text) {
  const blocks = []; const problems = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(/^(`{3,})(.*)$/);
    if (!open) continue;
    let j = i + 1;
    while (j < lines.length && !lines[j].startsWith(open[1])) j++;
    let tag = null;
    try { tag = parseTag(open[2].trim()); } catch (e) { problems.push(`line ${i + 1}: ${e.message}`); }
    if (tag) blocks.push({ line: i + 1, ...tag, code: lines.slice(i + 1, j).join('\n') + '\n' });
    i = j;
  }
  const ids = new Map();
  for (const b of blocks) {
    if (ids.has(b.attrs.id)) problems.push(`line ${b.line}: id ${b.attrs.id} is used twice`);
    ids.set(b.attrs.id, b);
  }
  for (const b of blocks) {
    for (const u of (b.attrs.uses ?? '').split(',').filter(Boolean)) {
      const lib = ids.get(u);
      if (!lib || lib.mode !== 'lib') problems.push(`line ${b.line}: uses=${u}, but no lib block has that id`);
      else if (lib.attrs.runtime !== b.attrs.runtime) problems.push(`line ${b.line}: uses=${u}, a lib for runtime ${lib.attrs.runtime}`);
    }
  }
  return { blocks, problems };
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);

function extract(docPath, dir) {
  const { blocks, problems } = blocksOf(fs.readFileSync(docPath, 'utf8'));
  if (problems.length) { for (const p of problems) console.log(`bad tag | ${p}`); process.exit(2); }
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const libs = new Map(blocks.filter((b) => b.mode === 'lib').map((b) => [b.attrs.id, b]));
  const manifest = [];
  for (const b of blocks.filter((x) => x.mode !== 'lib')) {
    const code = (b.attrs.uses ?? '').split(',').filter(Boolean).map((u) => libs.get(u).code).join('') + b.code;
    const file = `${b.attrs.id}.${RUNTIMES[b.attrs.runtime].ext}`;
    fs.writeFileSync(path.join(dir, file), code);
    manifest.push({ probe_id: b.attrs.id, mode: b.mode, runtime: b.attrs.runtime, expect: b.attrs.expect ?? null, uses: b.attrs.uses ?? null, repeat: Number(b.attrs.repeat ?? 1), line: b.line, file, block_sha: sha(code) });
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
  return manifest;
}

const docker = process.env.KB_HARNESS_DOCKER ?? 'docker';
const hostNode = process.env.KB_HARNESS_RUNNER === 'host-node';

function dockerReady() {
  if (hostNode) return 'host-node (scenarios only)';
  const r = spawnSync(docker, ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

function runOnce(dir, p, runtime) {
  const rt = RUNTIMES[runtime];
  const cmd = (p.mode === 'verify' ? rt.verify : rt.syntax)(`/probes/${p.file}`);
  const t0 = Date.now();
  let r;
  if (hostNode) {
    if (runtime !== 'node24') return { status: 'not_run', exit_code: null, stdout: '', stderr: 'host-node runs node24 only', duration_ms: 0 };
    r = spawnSync(process.execPath, p.mode === 'verify' ? [path.join(dir, p.file)] : ['--check', path.join(dir, p.file)], { encoding: 'utf8', timeout: TIMEOUT_MS });
  } else {
    const name = `kbprobe-${process.pid}-${p.probe_id}-${runtime}`;
    r = spawnSync(docker, ['run', '--rm', '--name', name, '--pull=never', '--network', 'none', '--read-only', '--tmpfs', '/tmp:rw,exec,nosuid,size=64m',
      '--cpus', '1', '--memory', '512m', '--pids-limit', '128', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
      '--user', '65534:65534', '-v', `${path.resolve(dir)}:/probes:ro`, rt.image, 'sh', '-c', cmd], { encoding: 'utf8', timeout: TIMEOUT_MS + 5000 });
    if (r.error?.code === 'ETIMEDOUT') spawnSync(docker, ['kill', name]);
  }
  const timedOut = r.error?.code === 'ETIMEDOUT' || r.signal === 'SIGTERM';
  return { exit_code: timedOut ? null : r.status, stdout: (r.stdout ?? '').slice(0, 4000), stderr: (timedOut ? 'timed out\n' : '') + (r.stderr ?? '').slice(0, 4000), duration_ms: Date.now() - t0 };
}

function meets(p, res) {
  if (res.status === 'not_run') return false;
  if (p.mode !== 'verify') return res.exit_code === 0;
  const [kind, ...v] = p.expect.split(':'); const val = v.join(':');
  if (kind === 'exit') return res.exit_code === Number(val);
  if (kind === 'throws') return res.exit_code !== 0 && res.exit_code !== null && new RegExp(`\\b${val}\\b`).test(res.stderr);
  return res.exit_code !== null && res.stdout.includes(val); // stdout: checks the output only (a type checker exits non-zero on the errors it prints)
}

function run(runDir, n) {
  if (!runDir || !/^\d+$/.test(n ?? '')) { console.log('usage: node run-code-harness.mjs extract <doc.md> <probes-dir> | run <run> <n>'); process.exit(2); }
  const dir = path.join(runDir, 'probes');
  const manifest = extract(path.join(runDir, 'doc.md'), dir);
  const engine = dockerReady();
  const results = [];
  for (const p of manifest) {
    const runs = [];
    for (let k = 0; k < p.repeat; k++) {
      const res = engine ? runOnce(dir, p, p.runtime) : { status: 'not_run', exit_code: null, stdout: '', stderr: 'Docker is not available', duration_ms: 0 };
      res.ok = meets(p, res); runs.push(res);
    }
    const last = runs[runs.length - 1];
    const status = !engine || last.status === 'not_run' ? 'not_run' : runs.every((x) => x.ok) ? 'pass' : runs.every((x) => !x.ok) ? 'fail' : 'mixed';
    const row = { ...p, status, exit_code: last.exit_code, stdout: last.stdout, stderr: last.stderr, duration_ms: last.duration_ms, runs: runs.length };
    const compat = RUNTIMES[p.runtime].compat;
    if (compat && engine && !hostNode) {
      const c = runOnce(dir, p, compat); c.ok = meets(p, c);
      const diag = (t) => t.trim().replace(/\r/g, '');
      row.compat = { [compat]: { same_outcome: c.ok === last.ok, same_diagnostics: diag(c.stdout) === diag(last.stdout), exit_code: c.exit_code, ok: c.ok, stdout: c.stdout } };
    }
    results.push(row);
    const k = row.compat?.[compat];
    const cm = k ? ` | ${compat}: ${k.same_outcome && k.same_diagnostics ? 'same' : 'differs'}${k.exit_code !== last.exit_code ? ` (exit ${k.exit_code})` : ''}` : '';
    console.log(`${p.probe_id} | ${p.runtime} | ${p.mode}${p.expect ? ` ${p.expect}` : ''} | ${status}${status === 'pass' || status === 'fail' ? ` (exit ${last.exit_code})` : ''}${cm}`);
  }
  const images = Object.fromEntries([...new Set(manifest.flatMap((p) => [p.runtime, RUNTIMES[p.runtime].compat].filter(Boolean)))].map((r) => {
    const img = RUNTIMES[r].image;
    const id = engine && !hostNode ? spawnSync(docker, ['image', 'inspect', img, '--format', '{{.Id}}'], { encoding: 'utf8' }).stdout.trim() : null;
    return [r, { image: img, id: id || null }];
  }));
  fs.mkdirSync(path.join(runDir, 'verdicts'), { recursive: true });
  fs.writeFileSync(path.join(runDir, 'verdicts', `round-${n}.harness.json`), JSON.stringify({ round: Number(n), doc: 'doc.md', engine: engine ?? null, runtimes: images, probes: results }, null, 1) + '\n');
  const count = (s) => results.filter((r) => r.status === s).length;
  console.log(`probes: ${results.length} | pass ${count('pass')} | fail ${count('fail')} | mixed ${count('mixed')} | not_run ${count('not_run')}${engine ? '' : ' (Docker is not available)'}`);
  process.exit(!engine ? 3 : count('fail') + count('mixed') ? 1 : 0);
}

const [cmd, ...rest] = process.argv.slice(2);
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(new URL(import.meta.url).pathname)) {
  if (cmd === 'extract' && rest.length === 2) { for (const p of extract(rest[0], rest[1])) console.log(`${p.probe_id} | ${p.runtime} | ${p.mode} | ${p.file}`); }
  else if (cmd === 'run') run(rest[0], rest[1]);
  else { console.log('usage: node run-code-harness.mjs extract <doc.md> <probes-dir> | run <run> <n>'); process.exit(2); }
}
