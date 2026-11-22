"""Pick a stratified random sample of ✅ claims from a doc, for the judge's claims.json.
Usage: python3 -I sample_claims.py <doc.md> <n> <seed> <out.json> [--include <regex> ...]
Strata are the doc's `## ` headings (envelope sections References, Related and Verification status are skipped).
Each stratum gets a share of n in proportion to its claim count (largest remainder, at least 1 when n allows).
--include forces the first claim matching each regex into the sample, inside its stratum's share."""
import json, math, random, re, sys

args = sys.argv[1:]
inc = []
if '--include' in args:
    i = args.index('--include'); args, inc = args[:i], args[i + 1:]
doc, n, seed, out = args[0], int(args[1]), int(args[2]), args[3]
SKIP = re.compile(r'^## (References|Related|Verification status)', re.I)
CITE = re.compile(r'\s*((?:\[\^?[\w.-]+\])+|\(\[[^\]]+\]\([^)]+\)\))?')
claims, heading, skip, fence = [], None, False, False
for no, line in enumerate(open(doc, encoding='utf-8'), 1):
    line = line.rstrip('\n')
    if line.startswith('```'):
        fence = not fence
    if fence:
        continue
    if line.startswith('## '):
        heading, skip = line.strip(), bool(SKIP.match(line))
        continue
    if skip or heading is None or '✅' not in line or re.search(r'✅\s*=', line):
        continue
    start = 0
    for m in re.finditer('✅', line):
        c = CITE.match(line, m.end())
        end = c.end() if c else m.end()
        seg = line[start:end]
        cut = max(seg.rfind('|'), seg.rfind('. ', 0, len(seg) - (end - m.start())))
        text = seg[cut + 1:].strip(' |') if cut >= 0 else seg.strip(' |')
        claims.append({'line': no, 'heading': heading, 'claim': text, 'context': line.strip()[:1200]})
        start = end
strata = {}
for c in claims:
    strata.setdefault(c['heading'], []).append(c)
total = len(claims)
n = min(n, total)
quota = {h: n * len(v) / total for h, v in strata.items()}
alloc = {h: int(q) for h, q in quota.items()}
if n >= len(strata):
    for h in alloc:
        alloc[h] = max(alloc[h], 1)
while sum(alloc.values()) > n:
    h = max(alloc, key=lambda k: (alloc[k] - quota[k], alloc[k])); alloc[h] -= 1
for h in sorted(quota, key=lambda k: quota[k] - int(quota[k]), reverse=True):
    if sum(alloc.values()) >= n: break
    if alloc[h] < len(strata[h]): alloc[h] += 1
rng = random.Random(seed)
picked = []
for h, pool in strata.items():
    forced = []
    for r in inc:
        hit = next((c for c in pool if re.search(r, c['claim']) and c not in forced), None) \
            or next((c for c in pool if re.search(r, c['context']) and c not in forced), None)
        if hit: forced.append(hit)
    rest = [c for c in pool if c not in forced]
    k = max(0, alloc[h] - len(forced))
    picked += forced + rng.sample(rest, min(k, len(rest)))
picked.sort(key=lambda c: (c['line'], c['claim']))
for i, c in enumerate(picked, 1):
    c['id'] = f'S{i}'
json.dump({'doc_claims': total, 'sample_size': len(picked), 'seed': seed,
           'strata': {h: [len(strata[h]), sum(1 for c in picked if c['heading'] == h)] for h in strata},
           'claims': [{k: c[k] for k in ('id', 'line', 'heading', 'claim', 'context')} for c in picked]},
          open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f'{total} claims in {len(strata)} strata; sampled {len(picked)} -> {out}')
for h in strata: print(f'  {len(strata[h]):4d} -> {sum(1 for c in picked if c["heading"] == h):2d}  {h[:70]}')
