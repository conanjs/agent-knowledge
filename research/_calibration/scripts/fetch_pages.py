"""Phase 0 throwaway fetcher: save the text of each URL into <run>/cache/<url-hash>.txt.

Usage: python3 -I fetch_pages.py <run-folder> <url> [<url> ...]
Writes <run>/sources.json (url, normalized, cache file, fetch time, status, chars).
Name = first 12 hex chars of SHA-256 of the URL without its #fragment.
Atomic write (tmp + rename); a cached file is not fetched again.
"""
import hashlib, json, os, subprocess, sys, tempfile, time
from html.parser import HTMLParser

BLOCK = {"p", "div", "section", "article", "li", "ul", "ol", "tr", "table", "br", "pre",
         "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "dt", "dd", "header", "footer", "hr"}
SKIP = {"script", "style", "noscript", "svg", "template", "iframe"}


class Text(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out, self.skip, self.pre = [], 0, 0

    def handle_starttag(self, tag, attrs):
        if tag in SKIP:
            self.skip += 1
        if tag == "pre":
            self.pre += 1
        if tag in BLOCK:
            self.out.append("\n")
        if tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self.out.append("#" * int(tag[1]) + " ")
        if tag == "li":
            self.out.append("- ")
        if tag in ("td", "th"):
            self.out.append(" | ")

    def handle_endtag(self, tag):
        if tag in SKIP and self.skip:
            self.skip -= 1
        if tag == "pre" and self.pre:
            self.pre -= 1
        if tag in BLOCK:
            self.out.append("\n")

    def handle_data(self, data):
        if self.skip:
            return
        if self.pre:
            self.out.append(data)
        else:
            core = " ".join(data.split())
            self.out.append((" " if data[:1].isspace() else "") + core + (" " if data[-1:].isspace() and core else ""))

    def text(self):
        lines = [l.rstrip() for l in "".join(self.out).splitlines()]
        res, blank = [], 0
        for l in lines:
            blank = blank + 1 if not l.strip() else 0
            if blank <= 1:
                res.append(l)
        return "\n".join(res).strip() + "\n"


def norm(url):
    return url.split("#", 1)[0]


def main():
    run, urls = sys.argv[1], sys.argv[2:]
    cache = os.path.join(run, "cache")
    os.makedirs(cache, exist_ok=True)
    idx_path = os.path.join(run, "sources.json")
    idx = json.load(open(idx_path)) if os.path.exists(idx_path) else []
    known = {e["normalized"] for e in idx}
    for url in urls:
        n = norm(url)
        h = hashlib.sha256(n.encode()).hexdigest()[:12]
        path = os.path.join(cache, h + ".txt")
        if n in known and os.path.exists(path):
            print("skip", n)
            continue
        entry = {"url": url, "normalized": n, "cache": "cache/" + h + ".txt",
                 "fetched": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
        try:
            # curl uses the system trust store (python.org's Python has no CA bundle here)
            out = subprocess.run(["curl", "-sSL", "--max-time", "40", "-A", "Mozilla/5.0 (compatible; kb-phase0-fetch/0.1)",
                                  "-H", "Accept: text/html,text/plain;q=0.9,*/*;q=0.5",
                                  "-w", "\n__META__%{http_code} %{content_type}", n],
                                 capture_output=True, check=True)
            raw, _, meta = out.stdout.rpartition(b"\n__META__")
            code, _, ctype = meta.decode().partition(" ")
            entry["status"] = int(code)
            if entry["status"] >= 400:
                raise RuntimeError("HTTP %s" % code)
            body = raw.decode("utf-8", "replace")
            if "html" in ctype or body.lstrip()[:15].lower().startswith(("<!doctype", "<html")):
                p = Text(); p.feed(body); txt = p.text()
            else:
                txt = body
            txt = "SOURCE: " + n + "\nFETCHED: " + entry["fetched"] + "\n\n" + txt
            fd, tmp = tempfile.mkstemp(dir=cache)
            with os.fdopen(fd, "w") as f:
                f.write(txt)
            os.replace(tmp, path)
            entry["chars"] = len(txt)
            print(entry["status"], entry["chars"], n)
        except Exception as e:  # record the failure; the judge then reports no_cache
            entry["status"], entry["error"] = "error", repr(e)[:200]
            print("ERROR", n, entry["error"])
        idx = [e for e in idx if e["normalized"] != n] + [entry]
        known.add(n)
    with open(idx_path, "w") as f:
        json.dump(idx, f, indent=1)


if __name__ == "__main__":
    main()
