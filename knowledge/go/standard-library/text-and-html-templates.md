---
schema: knowledge-doc/v1
type: concept
topic: go/standard-library
status: verified
applies-to: ["Go 1.27 (go1.27.4)", "{{break}} and {{continue}}: Go ≥ 1.18", "actions inside JavaScript template literals: Go ≥ 1.22", "{{else with}}: Go ≥ 1.23", "range over integers and iterator functions in templates: Go ≥ 1.24"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [go, golang, text-template, html-template, templates, auto-escaping, xss, funcmap, pipelines, template-must, missingkey, define, block]
ranked-sources: true
---

# Text and HTML templates

## Summary
**TL;DR:** `text/template` fills a text with data: `{{…}}` actions read fields, call methods and functions, branch and loop, and dot (`.`) is the cursor that points at the current piece of data. `html/template` has the same API but escapes each value for the spot it lands in (the text or an attribute of HTML, HyperText Markup Language; JavaScript; CSS, Cascading Style Sheets; or a URL, Uniform Resource Locator), so a user's `<script>` prints as `&lt;script&gt;`. Values of the types `template.HTML`, `template.JS`, `template.URL` and friends skip that escaping, so they are only for content you trust. A missing function fails at `Parse`; a missing key (with `missingkey=error`), a failing function and every html/template escaping error fail at `Execute`, after part of the output may already be written.
**Use this when:** you generate text, configuration, code or HTML pages from Go data; you see `<no value>`, `#ZgotmplZ` or `ZgotmplZ` in output; or a template error appears only when the page is rendered.
**Not this doc:** the `printf` verbs themselves → `go/standard-library/fmt-and-printing.md`; serving the page over HTTP (Hypertext Transfer Protocol) → `go/standard-library/net-http.md`; how cross-site scripting (XSS) steals session tokens → `security/jwt-storage-and-revocation-deep-dive.md`; JSON (JavaScript Object Notation) encoding → `go/standard-library/io-and-encoding-json.md`.

## Problem
Building output by joining strings mixes layout with code, and for HTML it opens a hole: a comment author named `<script>alert('pwned')</script>` pasted into a page runs as code in every visitor's browser. This attack is cross-site scripting (XSS). `text/template` does not help here: it copies the value as is ✅[^1], because its security model trusts template authors and it does not auto-escape output ✅[^2]. Escaping by hand fails too, because the right escaping depends on where the value lands. The same string came out as `&lt;i&gt;` in HTML text, `%3ci%3e` in a URL path and `\u003ci\u003e` in a JavaScript string in the lab ✅[^1].

## Mental model
**Analogy:** a mail-merge letter. The template is the letter with blanks (`{{.Customer}}`), the data is one row of the address book, and `Execute` prints the filled-in letter. `html/template` adds a proofreader who knows whether each blank sits in body text, inside a link or inside a script, and rewrites the filled-in value so it cannot break out of that spot.

**Artifact:** the same template and data through both packages ✅[^1]:
```go
const src = `Hello, {{.}}!`
data := "<script>alert('pwned')</script>"
// text/template:  Hello, <script>alert('pwned')</script>!
// html/template:  Hello, &lt;script&gt;alert(&#39;pwned&#39;)&lt;/script&gt;!
```

## How it works
**4 actors:**
- **Parser** — its job: turn template text into a tree of actions, via `Parse`, `ParseFiles`, `ParseGlob` or `ParseFS`.
- **Template set** — its job: keep named templates that can call each other, via `{{define}}`, `{{block}}` and `Template.New`.
- **Executor** — its job: walk the tree with dot set to the data and write the result, via `Execute` or `ExecuteTemplate` to an `io.Writer`.
- **Escaper** (`html/template` only) — its job: add the right escaping function to every action, via a pass over the tree before the first execution.

```
template text ──Parse──▶ [Parser] ──▶ parse tree ──┬──▶ [Template set] "page", "comment", …
   (FuncMap must already be attached)              │
                                                   ▼
data ──Execute(w, data)──▶ [Escaper: html/template, first Execute only]
                                   │  {{.}} becomes {{. | htmlescaper}} …
                                   ▼
                           [Executor] walks the tree, dot = data ──▶ io.Writer
```

1. **Parser (in memory):**
   - Reads UTF-8 text; everything outside `{{` and `}}` is copied unchanged ✅[^2].
   - Looks up every function name in the template's function map, so a name not added with `Funcs` fails here: `function "upper" not defined` ✅[^1]. Functions must be added before parsing ✅[^2].
   - Moves `{{define "name"}}…{{end}}` and `{{block}}` bodies into separate named templates ✅[^2].
2. **Template set:** each template has a name and belongs to one set; `{{template "name" pipeline}}` runs another template of the same set with dot set to the pipeline's value ✅[^2]. `template.Must` wraps a `(*Template, error)` call and panics on error, for package-level variables ✅[^2]; Effective Go's web-server example builds its page that way, once, and executes it per request ✅[^4].
3. **Escaper (`html/template`, before the first `Execute`):** it reads the HTML around each action and appends escaping functions, so `<a href="/search?q={{.}}">` becomes `{{. | urlescaper | attrescaper}}` ✅[^3]. This pass runs when the template first executes: the exported parse tree is "updated to be HTML-safe after the first execution" ✅[^3]. After that, `Parse` and `Clone` return errors ✅[^3] (`html/template: cannot Parse after Execute` ✅[^1]).
4. **Executor (writes to the `io.Writer`):**
   - Sets dot and `$` to the data argument ✅[^2].
   - Evaluates each action; if a function or method returns a non-nil error, execution stops and `Execute` returns it ✅[^2]. Output written before the error stays written ✅[^2]: `start {{fail}} end` left `"start "` in the buffer ✅[^1].
   - A parsed template may be executed in parallel; if the runs share a writer, their output may interleave ✅[^2].

### Actions
| Action | Does | Lab output on Go 1.27.4 ✅[^1] |
|---|---|---|
| `{{.Field}}`, `{{.Key}}`, `{{.Method}}`, `{{$x.F}}` | Struct field, map key (may be lower-case), niladic method; chains to any depth ✅[^2] | `Order {{.ID}} for {{.Customer}}` → `Order 7 for Ana` |
| `{{if p}} T1 {{else if q}} T0 {{else}} … {{end}}` | Empty values are false, 0, nil pointer or interface, and length-zero array, slice, map or string ✅[^2] | `two` |
| `{{range p}} T1 {{else}} T0 {{end}}` | Array, slice, map, `iter.Seq`, `iter.Seq2`, integer or channel; `{{else}}` runs on length zero ✅[^2] | `{{range .}}x{{else}}empty{{end}}` on `[]int{}` → `empty` |
| `{{range $i, $e := p}}` | Index or key, then element; with one variable it gets the **element**, the opposite of Go ✅[^2] | `0:pen 1:book` |
| `{{range 3}}`, `{{range seq}}` | Range over an integer or an iterator function, since Go 1.24 ✅[^8] | `0 1 2`; `countdown(3)` → `3 2 1` |
| `{{break}}`, `{{continue}}` | Leave or skip in the innermost range, since Go 1.18 ✅[^5] | `1 3` for 1–5 with continue at 2, break at 4 |
| `{{with p}} T1 {{else with q}} T0 {{else}} … {{end}}` | Sets dot to a non-empty value; `else with` since Go 1.23 ✅[^7] | `B=yes` |
| `{{$v := p}}`, `{{$v = p}}` | Declare or assign; scope ends at the `{{end}}` of the enclosing `if`, `with` or `range` ✅[^2] | `last=12` |
| `{{define "T"}}…{{end}}`, `{{template "T" .}}` | Define a named template; call it with nil or with a pipeline ✅[^2] | `ONE TWO` |
| `{{block "T" .}}default{{end}}` | Define and call in place; a set of root templates is then customized by redefining `T` ✅[^2] | `<default x>`, clone → `<custom x>`, original still `<default x>` |
| `{{/* c */}}` | Comment, discarded ✅[^2] | `a{{/* note */}}b` → `ab` |

Ranging over a map with keys of a basic ordered type visits keys in sorted order ✅[^2]: `zeta`, `alpha`, `gift` came out `alpha gift zeta` ✅[^1].

### Pipelines, functions and the function map
- **Pipeline:** commands joined by `|`; each command's result becomes the **last** argument of the next ✅[^2]. Think of a kitchen line where each cook adds to the plate and passes it on: `{{.Total | printf "%.2f"}}` printed `6.00` ✅[^1].
- **Predefined functions** ✅[^2]: `and`, `or` (return the first empty / first non-empty argument, or else the last argument, and since Go 1.18 stop evaluating once the result is known ✅[^5]), `not`, `len`, `index x 1 2` (= `x[1][2]`), `slice x 1 2` (= `x[1:2]`), `print`/`printf`/`println` (aliases of `fmt.Sprint`, `Sprintf`, `Sprintln`), `html`, `js`, `urlquery`, `call` (calls a function value), and the comparisons `eq`, `ne`, `lt`, `le`, `gt`, `ge`. In the lab `{{and 1 0 "x"}}|{{or 0 "" "y"}}` printed `0|y`, `{{slice "golang" 1 3}}` printed `ol`, and `{{and false get}}` did not call the failing `get` ✅[^1].
- **Comparisons:** `eq` alone takes several arguments and is true if the first equals any of the rest; integers compare by value whatever their size or signedness ✅[^2]. `{{eq .ID 1 3 7}}` with `ID` 7 gave `true`, and `{{lt -1 .}}` with `uint(0)` gave `true` ✅[^1].
- **`FuncMap`** is a `map[string]any` of your own functions, a phone book the parser looks names up in; each returns one value, or a value and an `error` ✅[^2]. Attach it with `Funcs` before `Parse`; calling `Funcs` again later replaces a function of the same name for later executions ✅[^2] (`old` then `new` in the lab ✅[^1]). A map value that is not a function panics: `value for bad not a function` ✅[^1].
- **Errors from functions** are wrapped: `errors.Is(err, errBoom)` was true, and `errors.AsType[template.ExecError]` found the template name ✅[^1].

### Whitespace trimming
`{{- ` trims all white space before the action and ` -}}` all white space after it; the space next to the minus is required, so `{{-3}}` is the number −3 ✅[^2]. `"{{23 -}} < {{- 45}}"` printed `23<45`, and `{{-3}}` printed `-3` ✅[^1].

### Options and delimiters
- `Option("missingkey=…")` decides what a missing **map** key does: `default`/`invalid` prints `<no value>`, `zero` gives the element type's zero value, `error` stops execution ✅[^2]. Lab: `<no value>`, `0`, and `map has no entry for key "nope"` ✅[^1].
- A missing **struct field** is always an execution error: `can't evaluate field Nope in type main.Order` ✅[^1].
- `Delims("<<", ">>")` changes the action markers for later parses ✅[^2]; `<<.>> {{.}}` printed `hi {{.}}` ✅[^1].

### `html/template`: contexts
The package understands HTML, CSS, JavaScript and URIs and treats every data value as plain text to be encoded for its context ✅[^3]. With `It's: How are <i>you</i>?` as data (the package docs use a surname with an apostrophe), Go 1.27.4 printed ✅[^1]:

| Context in the template | Output |
|---|---|
| `<p>{{.}}</p>` | `It&#39;s: How are &lt;i&gt;you&lt;/i&gt;?` |
| `<a title='{{.}}'>` | `It&#39;s: How are &lt;i&gt;you&lt;/i&gt;?` |
| `<a href="/{{.}}">` | `/It%27s:%20How%20are%20%3ci%3eyou%3c/i%3e?` |
| `<a href="?q={{.}}">` | `?q=It%27s%3a%20How%20are%20%3ci%3eyou%3c%2fi%3e%3f` |
| `<a onclick='f("{{.}}")'>` | `It\u0027s: How are \u003ci\u003eyou\u003c\/i\u003e?` |

- An unsafe value in a URL or CSS context is replaced by `ZgotmplZ` ✅[^3]: `javascript:alert(1)` in `href` became `#ZgotmplZ`, and `red; background: url(evil)` in `style` became `ZgotmplZ`, while `red` passed ✅[^1].
- Non-string values in a script context are marshaled as JSON ✅[^3]: a struct became `{"A":"foo","B":"\u003c/script\u003e"}` ✅[^1].
- HTML comments in the template are stripped from the output ✅[^3] (`a<!-- secret -->b` → `ab` ✅[^1]).
- Since Go 1.22, actions may appear inside JavaScript template literals (back-quoted strings) ✅[^6]; a back quote in the data came out as `\u0060` ✅[^1].

### `html/template`: typed strings
The types `HTML`, `HTMLAttr`, `JS`, `JSStr`, `CSS`, `URL` and `Srcset` mark content as already safe, and the escaper inserts it verbatim; each type's documentation warns that this "presents a security risk" and that the content must come from a trusted source ✅[^3]. A typed string is a sealed envelope stamped "checked": the proofreader no longer opens it. `template.HTML("<b>World</b>")` printed bold markup, and `template.HTML(userInput)` let `<script>alert('pwned')</script>` through untouched ✅[^1]. `template.URL("javascript:alert(1)")` was no longer filtered ✅[^1].

### Errors: `Parse` versus `Execute`
| Error | Reported by | Lab text on Go 1.27.4 ✅[^1] |
|---|---|---|
| Syntax error, unknown function | `Parse` (`Must` panics) | `template: bad:1: missing value for if` |
| Missing key with `missingkey=error`, missing field, nil pointer, a function's error | `Execute` | `nil pointer evaluating *main.Order.Customer` |
| Unknown name in `ExecuteTemplate` | `ExecuteTemplate` | `no template "C" associated with template "root"` |
| html/template escaping errors (`ErrBranchEnd`, `ErrEndContext`, `ErrPredefinedEscaper`, …) | `Execute`, as `*template.Error` with an `ErrorCode` ✅[^3] | `Parse` succeeded, then `{{if}} branches end in different contexts` |

## Worked example
A guestbook page rendered with `html/template`: one honest comment, one hostile comment, and a footer written by the site itself. The function `upper` is attached before `Parse`.

```go
const page = `{{define "comment"}}<li><a href="{{.Website}}" title="{{.Author}}">{{.Author | upper}}</a>: {{.Text}}</li>{{end -}}
<h1>{{.Title}}</h1>
<ul>
{{- range .Comments}}
  {{template "comment" .}}
{{- else}}
  <li>no comments</li>
{{- end}}
</ul>
<footer>{{.Footer}}</footer>
<script>const count = {{len .Comments}}; const first = {{(index .Comments 0).Author}};</script>
`
t := template.Must(template.New("page").Funcs(template.FuncMap{"upper": strings.ToUpper}).Parse(page))
t.Execute(os.Stdout, map[string]any{
	"Title": "Guestbook",
	"Comments": []Comment{
		{"ana", "https://ana.example/?a=1&b=2", "Nice <b>post</b>!"},
		{"<script>alert('x')</script>", "javascript:alert(1)", "\"quoted\" & 'single'"},
	},
	"Footer": template.HTML(`<small>&copy; 2026</small>`), // trusted: written by the site
})
```

Output on Go 1.27.4 ✅[^1]:
```html
<h1>Guestbook</h1>
<ul>
  <li><a href="https://ana.example/?a=1&amp;b=2" title="ana">ANA</a>: Nice &lt;b&gt;post&lt;/b&gt;!</li>
  <li><a href="#ZgotmplZ" title="&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;">&lt;SCRIPT&gt;ALERT(&#39;X&#39;)&lt;/SCRIPT&gt;</a>: &#34;quoted&#34; &amp; &#39;single&#39;</li>
</ul>
<footer><small>&copy; 2026</small></footer>
<script>const count =  2 ; const first = "ana";</script>
```

What happened, step by step:
1. The `{{- …}}` and `{{end -}}` markers removed the blank lines the template source needed for readability.
2. `range` set dot to each `Comment`; `{{template "comment" .}}` passed it on.
3. The hostile author was escaped three ways: as attribute text in `title`, as HTML text in the link body (after `upper` ran), and the `javascript:` website became `#ZgotmplZ`.
4. The footer, typed `template.HTML`, went out unescaped. That is right only because the site wrote it.
5. Inside `<script>`, the number became ` 2 ` and the string became a quoted JavaScript string `"ana"`.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `Funcs` called after `Parse` for a new name | `Parse` already failed: `function "upper" not defined` ✅[^1] | Functions must be added before parsing ✅[^2] |
| `{{range $x := .Items}}` | `$x` is the element, not the index ✅[^1] | One variable gets the element, unlike Go ✅[^2] |
| Map key absent, default option | Prints `<no value>` ✅[^1] | Default `missingkey` behaviour ✅[^2] |
| Error halfway through `Execute` into an `http.ResponseWriter` | The client may get half a page | Partial results may already be written ✅[^2]; render into a buffer first |
| `<div class={{. \| html}}>` (unquoted attribute) in `html/template` | `Execute` fails: `predefined escaper "html" disallowed in template` ✅[^1]; the same `{{. \| html}}` in HTML text ran without error ✅[^1] | The package escapes on its own; `html` and `urlquery` stay allowed as the last command of a pipeline, except `html` in an unquoted attribute value ✅[^3] |
| `{{if .}}<a href="{{end}}{{.}}">` | `Parse` passes, `Execute` fails with `ErrBranchEnd` ✅[^1] | The two branches leave the escaper in different contexts ✅[^3] |
| `<div title="no close quote>` | `Execute` fails with `ErrEndContext` ✅[^1] | A template must end in a text context ✅[^3] |
| `Parse` on an `html/template` that has run | `html/template: cannot Parse after Execute` ✅[^1] | Templates can be redefined only before the first `Execute` ✅[^3] |
| `template.HTML(userInput)` | The script passes through ✅[^1] | Typed content is included verbatim ✅[^3] |
| Expected output copied from the package docs' context table | That table shows `\x27` and `\x3c` in a JavaScript string; Go 1.27.4 printed `\u0027` and `\u003c` ✅[^1] ✅[^3] | Compare escaped output by meaning, not byte for byte |
| The package overview says each `{{.}}` is rewritten "at parse time" | The rewriting, and every escaping error, came at the first `Execute` ✅[^1] | The `Tree` field is updated to be HTML-safe after the first execution ✅[^3]; read "parse time" as "before the first output" |
| `nil` interface data in `html/template` | Prints nothing (`[]`) ✅[^1] | A nil interface is treated as an empty string by the escapers ✅[^3] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `text/template` | Any text format: config files, code, e-mail bodies ✅[^2] | No escaping; unsafe for HTML with untrusted data ✅[^2] |
| `html/template` | Context-aware escaping against code injection ✅[^3] | Escaping errors show up only at the first `Execute` ✅[^1]; output must be a complete HTML fragment ✅[^3] |
| Typed strings (`template.HTML` …) | Trusted markup is not double-escaped ✅[^3] | One mistake reopens XSS ✅[^3] |
| `missingkey=error` | Typos in map keys fail loudly ✅[^2] | Optional keys must be read with `index`, which gave the zero value; `{{with .nope}}` and `{{if .nope}}` failed too ✅[^1] |

## Takeaways
- Use `html/template` for anything a browser will read, even when today's data looks harmless. [rule-candidate]
- Never convert user-supplied text to `template.HTML`, `template.JS`, `template.URL` or the other typed strings; pass a plain string and let the escaper work ✅[^3]. [rule-candidate]
- Parse templates once into package-level variables with `template.Must`, and attach every `FuncMap` before `Parse` ✅[^2]. [rule-candidate]
- Render into a `bytes.Buffer` and copy it to the response only when `Execute` returned `nil`, so an error never ships half a page. [rule-candidate]
- Run every `html/template` in a test: escaping errors appear at `Execute`, not at `Parse`.
- Set `Option("missingkey=error")` when the data is a map you build yourself.

## Verification status
- Verified: 104 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `go/lab-setup.md` — the Go 1.27.4 lab (`golang:1.27.4`) where every behaviour marked with this note ran on 2026-11-24: every action and function in the tables, `missingkey`, trimming, `Funcs` before and after `Parse`, error wrapping, the `html/template` contexts, `ZgotmplZ`, typed strings, escaping errors at `Execute`, and the guestbook page. [^1]
- [text/template package](https://pkg.go.dev/text/template) — Go team, living. Rank 1. Backs: security model, actions, arguments, pipelines, variables, predefined functions and comparisons, associated and nested templates, `Funcs`, `FuncMap`, `Must`, `Option` (`missingkey`), `Delims`, `Execute` partial output and parallel use. [^2]
- [html/template package](https://pkg.go.dev/html/template) — Go team, living. Rank 1. Backs: contexts and escaper insertion, `ZgotmplZ`, JSON in script contexts, comment stripping, typed strings and their security warning, `ErrorCode` values, `Tree` updated after the first execution, `Parse` and `Clone` after `Execute`, nil interface values. [^3]
- [Effective Go](https://go.dev/doc/effective_go) — Go team, 2009, living. Rank 1. Backs: §A web server (`html/template` page built once with `template.Must`, executed per request, `{{if .}}`). [^4]
- [Go 1.18 Release Notes](https://go.dev/doc/go1.18) — Go team, 2022. Rank 1. Backs: `{{break}}` and `{{continue}}`; `and` and `or` stop evaluating early. [^5]
- [Go 1.22 Release Notes](https://go.dev/doc/go1.22) — Go team, 2024. Rank 1. Backs: actions allowed in JavaScript template literals. [^6]
- [Go 1.23 Release Notes](https://go.dev/doc/go1.23) — Go team, 2024. Rank 1. Backs: `{{else with}}`. [^7]
- [Go 1.24 Release Notes](https://go.dev/doc/go1.24) — Go team, 2025. Rank 1. Backs: templates range over functions and integers. [^8]

## Related
- `go/standard-library/fmt-and-printing.md` — the verbs behind `printf` and the `fmt.Print` rules behind `{{.}}`.
- `go/standard-library/net-http.md` — handlers that execute a template per request.
- `go/standard-library/iterators.md` — `iter.Seq`, which `{{range}}` accepts since Go 1.24.
- `go/low-level/reflection.md` — `reflect.Value`, which `FuncMap` functions may take and return.
- `security/jwt-storage-and-revocation-deep-dive.md` — what an XSS attacker can do with tokens in the browser.
- `go/learning-path.md`
