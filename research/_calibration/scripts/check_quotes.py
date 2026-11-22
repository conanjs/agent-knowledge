"""Check that every quote segment behind a non-entails verdict is in the run's saved pages.
Usage: python3 -I check_quotes.py <run-dir> [<run-dir> ...]  (reads verdicts/round-1.json and verdicts/round-1.input/cache)"""
import glob, json, os, re, sys
norm = lambda t: re.sub(r'\s+', ' ', t.replace('’', "'").replace('‘', "'").replace('“', '"').replace('”', '"').replace('–', '-').replace('—', '-')).strip().lower()
for run in sys.argv[1:]:
    pages = ' '.join(norm(open(f, encoding='utf-8', errors='replace').read()) for f in glob.glob(os.path.join(run, 'verdicts/round-1.input/cache/*')))
    v = json.load(open(os.path.join(run, 'verdicts/round-1.json')))
    ok = bad = 0
    for c in v['claim_checks']:
        if c['verdict'] in ('entails', 'not_checkable', 'no_cache'): continue
        q = c.get('page_says') or ''
        if q.lower().startswith('not found'): continue
        for seg in re.split(r'\s*(?:…|\.\.\.)\s*', q):
            seg = norm(seg.strip(' "\''))
            if len(seg) < 12: continue
            if seg in pages: ok += 1
            else: bad += 1; print('  MISSING', c['id'], '|', seg[:120])
    print(f'{run}: {ok} quote segments found, {bad} missing')
