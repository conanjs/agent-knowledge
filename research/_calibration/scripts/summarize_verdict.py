"""Summarize one or more judge verdict files (parts are merged).
Usage: python3 -I summarize_verdict.py <verdict.json> [<part.json> ...] [--find <regex> ...]
Prints verdict, scores, counts per claim verdict and every non-entails claim; --find prints the claims matching each regex."""
import collections, json, re, sys

args = sys.argv[1:]
finds = []
if "--find" in args:
    i = args.index("--find")
    args, finds = args[:i], args[i + 1:]
checks, viol = [], []
for p in args:
    v = json.load(open(p))
    print("==", p, "| verdict:", v.get("verdict"), "| score:", v.get("overall_score"), "| rubric:", v.get("rubric_scores"))
    print("   coverage:", v.get("coverage"))
    checks += v.get("claim_checks", [])
    viol += v.get("violations", [])
c = collections.Counter(x.get("verdict") for x in checks)
print("claims judged:", len(checks), dict(c))
for x in checks:
    if x.get("verdict") not in ("entails",):
        print(" -", x.get("id"), "|", x.get("verdict"), "|", (x.get("section") or "")[:40], "|", (x.get("claim") or "")[:150].replace("\n", " "))
        print("     page_says:", (x.get("page_says") or "")[:160].replace("\n", " "), "| note:", (x.get("note") or "")[:200])
print("violations:", collections.Counter((x.get("severity"), x.get("rule")) for x in viol))
for x in viol:
    if x.get("rule") not in ("grounding",):
        print(" *", x.get("severity"), x.get("rule"), "|", (x.get("section") or "")[:40], "|", (x.get("evidence") or "")[:220])
for f in finds:
    hits = [x for x in checks if re.search(f, (x.get("claim") or ""), re.I)]
    print("find", repr(f), "->", [(x.get("id"), x.get("verdict")) for x in hits])
