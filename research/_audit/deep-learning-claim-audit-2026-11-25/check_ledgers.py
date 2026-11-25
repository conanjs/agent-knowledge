# Compare each ledger with its doc's claim markers: check_ledgers.py <repo>
import csv, glob, os, re, sys

repo = sys.argv[1]
here = os.path.dirname(os.path.abspath(__file__))
docs = sorted(glob.glob(f"{repo}/knowledge/machine-learning/deep-learning/*.md")) + [
    f"{repo}/knowledge/machine-learning/transformers/{s}.md"
    for s in ("vision-transformers", "mixture-of-experts", "efficient-attention-and-state-space-models")
]
ok_all = True
totals = {}
for d in docs:
    slug = os.path.basename(d)[:-3]
    if slug == "index":
        continue
    body = open(d).read().split("## References")[0]
    marks = re.findall(r"✅\[\^([^\]]+)\]", body)
    status = re.search(r"Verified: (\d+) claims", body)
    lp = f"{here}/ledgers/{slug}.tsv"
    if not os.path.exists(lp):
        print(f"MISSING  {slug}: no ledger ({len(marks)} markers)"); ok_all = False; continue
    rows = list(csv.DictReader(open(lp), delimiter="\t"))
    labels = [r["label"].strip().strip("[]^") for r in rows]
    bad = [r for r in rows if r["verdict"].strip() not in ("OK", "FIXED", "LAB-OK")]
    empty = [r for r in rows if not r["evidence"].strip() or not r["source"].strip()]
    issues = []
    if labels != marks:
        i = next((k for k, (a, b) in enumerate(zip(labels, marks)) if a != b), min(len(labels), len(marks)))
        issues.append(f"order/count mismatch at row {i+1}: ledger {len(labels)} rows, doc {len(marks)} markers")
    if status and int(status.group(1)) != len(marks):
        issues.append(f"status line says {status.group(1)}, doc has {len(marks)}")
    if bad: issues.append(f"{len(bad)} rows with a bad verdict")
    if empty: issues.append(f"{len(empty)} rows without evidence or source")
    for v in ("OK", "FIXED", "LAB-OK"):
        totals[v] = totals.get(v, 0) + sum(1 for r in rows if r["verdict"].strip() == v)
    dp = f"{here}/ledgers/{slug}.dropped.tsv"
    nd = max(0, len(open(dp).read().strip().splitlines()) - 1) if os.path.exists(dp) else 0
    totals["dropped"] = totals.get("dropped", 0) + nd
    if issues:
        ok_all = False; print(f"FAIL     {slug}: " + "; ".join(issues))
    else:
        print(f"OK       {slug}: {len(marks)} markers covered, dropped {nd}")
print("totals:", totals)
print("ALL COVERED" if ok_all else "NOT COMPLETE")
