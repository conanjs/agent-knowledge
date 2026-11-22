"""Build <run>/verdicts/round-<n>.input/: doc.md, the cited pages' cache files, sources.json, criteria.json if any.
Usage: python3 -I make_input.py <run> <n>"""
import json, os, re, shutil, sys
run, n = sys.argv[1], sys.argv[2]
dst = os.path.join(run, "verdicts", "round-%s.input" % n)
if os.path.exists(dst):
    shutil.rmtree(dst)
os.makedirs(os.path.join(dst, "cache"))
doc = open(os.path.join(run, "doc.md")).read()
urls = {u.split("#")[0].rstrip(".,;") for u in re.findall(r"https?://[^\s)>\]`]+", doc)}
idx = json.load(open(os.path.join(run, "sources.json")))
keep = [e for e in idx if e["normalized"] in urls]
for e in keep:
    if e.get("status") == 200:
        shutil.copy(os.path.join(run, e["cache"]), os.path.join(dst, e["cache"]))
missing = sorted(urls - {e["normalized"] for e in keep})
for u in missing:
    keep.append({"url": u, "normalized": u, "status": "not fetched"})
json.dump(keep, open(os.path.join(dst, "sources.json"), "w"), indent=1)
shutil.copy(os.path.join(run, "doc.md"), os.path.join(dst, "doc.md"))
if os.path.exists(os.path.join(run, "criteria.json")):
    shutil.copy(os.path.join(run, "criteria.json"), os.path.join(dst, "criteria.json"))
print(dst, "|", len(keep), "sources,", sum(1 for e in keep if e.get("status") == 200), "cached; not fetched:", missing)
