"""List tool calls in a subagent transcript that touch forbidden paths.
Usage: python3 -I scan_reads.py <agent.jsonl> <own-folder> [<forbidden-regex> ...]
Prints every Read/Grep/Glob/Bash call whose input mentions research/ outside <own-folder>, or a forbidden regex."""
import json, re, sys
path, own, extra = sys.argv[1], sys.argv[2], sys.argv[3:]
pats = [re.compile(p) for p in extra]
hits = 0
for line in open(path):
    try: o = json.loads(line)
    except Exception: continue
    c = (o.get('message') or {}).get('content')
    if not isinstance(c, list): continue
    for b in c:
        if b.get('type') != 'tool_use': continue
        s = json.dumps(b.get('input'), ensure_ascii=False)
        bad = [p.pattern for p in pats if p.search(s)]
        for m in re.finditer(r'research/[^\s"\'\\]*', s):
            if not m.group(0).startswith(own) and m.group(0).rstrip('/') != 'research':
                bad.append('research-outside:' + m.group(0)[:80])
        if bad:
            hits += 1
            print(b.get('name'), '|', sorted(set(bad))[:4], '|', s[:200])
print('hits:', hits)
