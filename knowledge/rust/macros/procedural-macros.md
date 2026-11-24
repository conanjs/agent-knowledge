---
schema: knowledge-doc/v1
type: concept
topic: rust/macros
status: verified
applies-to: ["Rust 1.100.0", "edition 2024", "syn 2.0.119", "quote 1.0.47", "proc-macro2 1.0.107"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [rust, macros, proc-macro, derive, attribute-macro, syn, quote, tokenstream, spans, compile-time]
---

# Procedural macros: derive, attribute and function-like

## Summary
**TL;DR:** A procedural macro is an ordinary Rust function in a separate `proc-macro` crate that the compiler builds for the host, loads, and calls during expansion: tokens in, tokens out. There are three kinds: a derive appends items after a struct or enum, an attribute replaces the item it sits on, and a function-like macro replaces its call. `syn` parses the input tokens into a syntax tree, `quote!` builds the output, and errors are returned as `compile_error!` tokens whose span points at the user's code. The price is compile time: `syn` with all features sits on the critical path of every crate that uses the macro.
**Use this when:** writing a derive or an attribute; an error points at `#[derive(X)]` instead of the field at fault; generated code clashes with a caller's names; deciding whether a procedural macro is worth its build cost.
**Not this doc:** `macro_rules!` patterns, hygiene and tt-munchers → `rust/macros/declarative-macros.md`; serde's derive attributes → `rust/ecosystem/serde-data-model.md`; how expansion fits the compiler passes → `rust/performance/compiler-pipeline-and-compile-times.md`.

## Problem
A `macro_rules!` pattern cannot practically take apart an arbitrary struct with generics, attributes and `where` clauses; it can emit a message with `compile_error!`, but that error points at the macro's own rule and the whole call, not at the offending token ✅[^1]. Procedural macros can, but they bring their own traps: a panic produces an unhelpful error, generated code reports type errors on the `derive` line, names leak into or collide with the caller's code, the macro cannot be used in its own crate, and an innocent-looking `syn` dependency added 1.6–1.9 s to every clean build in the lab (Trade-offs).

## Mental model
**Analogy:** a plug-in in the compiler's own workshop. The compiler hands the plug-in a bag of tokens (the item or the call's arguments), the plug-in reads them with a parser (`syn`), writes new code from a template (`quote!`) and hands back a new bag. The plug-in runs on the build machine, never on the target device, and every token it returns carries a location label (a span) the compiler uses when it reports an error.

**Artifact:** what the compiler actually hands over. This function-like macro, written without `syn`, names the kind of each top-level token tree ✅[^1]:
```rust
#[proc_macro]
pub fn token_kinds(input: TokenStream) -> TokenStream {
    use proc_macro::TokenTree;
    let kinds: Vec<String> = input.into_iter().map(|tt| match tt {
        TokenTree::Ident(i) => format!("Ident({i})"),
        TokenTree::Punct(p) => format!("Punct({}, {:?})", p.as_char(), p.spacing()),
        TokenTree::Literal(l) => format!("Literal({l})"),
        TokenTree::Group(g) => format!("Group({:?}, {} inner)", g.delimiter(), g.stream().into_iter().count()),
    }).collect();
    let joined = kinds.join(" ");
    quote::quote! { #joined }.into()
}
// token_kinds!(x += (a, b) "s" 7) evaluates to:
// Ident(x) Punct(+, Joint) Punct(=, Alone) Group(Parenthesis, 3 inner) Literal("s") Literal(7)
```
The four variants are the whole vocabulary: `Group` (a delimited stream), `Ident`, `Punct` and `Literal` ✅[^5]. `+=` arrives as two `Punct` values, `+` marked `Joint` and `=` marked `Alone` ✅[^1] ✅[^6], whereas a `macro_rules!` matcher sees `+=` as one token tree (see `rust/macros/declarative-macros.md`) ✅[^1].

## How it works
Four actors, all at build time:
- **Cargo** — its job: build the macro crate before its users, for the host, via `[lib] proc-macro = true`.
- **rustc's expander** — its job: call the macro for each use site, via the compiled shared library it loads.
- **The macro function** — its job: turn input tokens into output tokens, via `syn` for parsing and `quote!` for generating.
- **rustc after expansion** — its job: parse and type-check the returned tokens, via the span on each token for error locations.

```
[Cargo] builds macros crate for the HOST ──▶ libmacros-<hash>.so
                                                   │ loaded by
[rustc expander] sees #[derive(Describe)] on Server ▼
      │  TokenStream of `struct Server { … }`  ──▶ [macro fn]
      │                                            syn::parse ─▶ DeriveInput
      │                                            walk fields, read #[describe(..)]
      │  TokenStream of `impl Server { … }`    ◀── quote! { … } (or compile_error!)
      ▼
[rustc] appends the impl, parses, type-checks ──▶ errors reported at token spans
```

1. **Cargo — a separate crate for the host.**
   - `proc-macro = true` in `[lib]` makes the library a procedural macro crate ✅[^13] ✅[^2]. The `proc-macro` crate type is always compiled for the compiler's host target ✅[^4]; in the lab it became `target/debug/build/macros/<hash>/out/libmacros-<hash>.so` ✅[^1].
   - Such a crate may export only macro functions: adding `pub fn helper() {}` fails with `` error: `proc-macro` crate types currently cannot export any items other than functions tagged with `#[proc_macro]`, `#[proc_macro_derive]`, or `#[proc_macro_attribute]` `` ✅[^1].
   - A macro cannot be used in the crate that defines it, only from crates that import it ✅[^3].
   - Cargo builds proc macros and their dependencies with the `build-override` profile, whose default is `opt-level = 0` even for `--release` ✅[^14].
2. **rustc's expander — three kinds, three contracts** ✅[^3] ✅[^2]:

   | Kind | Marked with | Signature | Output |
   |---|---|---|---|
   | Function-like `name!(…)` | `#[proc_macro]` | `fn(TokenStream) -> TokenStream` | replaces the call |
   | Derive `#[derive(Name)]` | `#[proc_macro_derive(Name, attributes(helper))]` | `fn(TokenStream) -> TokenStream` | items appended after the input item |
   | Attribute `#[name(args)]` | `#[proc_macro_attribute]` | `fn(attr: TokenStream, item: TokenStream) -> TokenStream` | replaces the item |

   A derive cannot change its input: the expanded crate still shows `struct Server` unchanged, with its inert `#[describe(…)]` helper attributes, followed by the generated items ✅[^1] ✅[^3].
3. **The macro function — parse, walk, generate.**
   - `parse_macro_input!(input as DeriveInput)` parses the tokens and turns a parse failure into a compile error ✅[^8]. `DeriveInput` covers the three legal derive inputs: struct, enum and union ✅[^8].
   - `Attribute::parse_nested_meta` walks helper arguments such as `#[describe(skip)]`, with `meta.path` naming the key and `meta.error(…)` building an error ✅[^10].
   - `quote!` interpolates with `#var` and repeats with `#(#var),*`; it returns a `proc_macro2::TokenStream` that `.into()` converts for the compiler ✅[^11].
   - `syn`'s optional features (`full` for every syntax type, `extra-traits` for `Debug`/`Eq`/`Hash` on them) exist so a macro pays compile time only for what it uses ✅[^8]. Parsing a function item (`ItemFn`, for an attribute macro) needs `full` ✅[^8]; without it the build fails with `` error[E0425]: cannot find type `ItemFn` in crate `syn` `` and a note that the item was "configured out" ✅[^1].
4. **Errors — return them, do not panic.**
   - A panic becomes a compiler error: `error: proc macro panicked` with `help: message: config file missing` ✅[^1] ✅[^3].
   - The better path: build the output in a function returning `syn::Result<TokenStream>` and convert an `Err` with `to_compile_error()`, which emits a `compile_error!` invocation carrying the error's span ✅[^9]. `Error::new_spanned(node, msg)` spans a whole syntax node ✅[^9].
   - Result in the lab: `#[describe(skp)]` on a field gives `` error: unknown describe option; expected `skip` or `rename = "..."` `` with the caret under `skp` ✅[^1]; applying the derive to an enum points at the enum's name ✅[^1].
5. **rustc after expansion — spans decide where type errors land.**
   - Tokens written inside `quote!` get `Span::call_site()`, while interpolated tokens keep their own spans ✅[^11]. So when a field type lacks `Debug`, the generated `format!("{}={:?}", "inner", self.inner)` fails with `` error[E0277]: `NoDebug` doesn't implement `Debug` `` pointing at `#[derive(Describe)]` ✅[^1].
   - `quote_spanned!(ty.span()=> …)` gives the template tokens the user's span ✅[^12]. A per-field assertion `fn must_be_debug<T: ::core::fmt::Debug>() {} must_be_debug::<#ty>();` generated that way moves the first E0277 onto `inner: NoDebug` itself ✅[^1].
6. **Hygiene — none by default.**
   - Procedural macro output behaves as if written inline at the call site, so it can see and shadow the caller's names; the Reference advises absolute paths and unlikely names ✅[^3].
   - `quote! { let answer = 42; }` lets the caller print `answer` (`call_site: answer = 42`) ✅[^1]. Building the identifier with `Span::mixed_site()` gives `macro_rules!`-style hygiene for locals, and the same caller fails with E0425 "not accessible due to macro hygiene" ✅[^1] ✅[^7]. `Span::def_site()` is nightly only ✅[^7].
   - The other direction: a caller with its own `struct Vec;` breaks generated code that wrote bare `Vec<String>`: `error[E0107]: struct takes 0 generic arguments but 1 generic argument was supplied` at the derive ✅[^1].

## Worked example
A derive that generates `fn describe(&self) -> String`, with a helper attribute, from a workspace of two crates (`macros` with `proc-macro = true`, `app` using it). The core of the derive (assertions from step 5 left out):
```rust
#[proc_macro_derive(Describe, attributes(describe))]
pub fn derive_describe(input: TokenStream) -> TokenStream {
    let ast = parse_macro_input!(input as DeriveInput);
    expand_describe(&ast).unwrap_or_else(syn::Error::into_compile_error).into()
}

fn expand_describe(ast: &DeriveInput) -> syn::Result<proc_macro2::TokenStream> {
    let name = &ast.ident;
    let Data::Struct(data) = &ast.data else {
        return Err(syn::Error::new_spanned(&ast.ident, "Describe supports structs only"));
    };
    let Fields::Named(fields) = &data.fields else {
        return Err(syn::Error::new_spanned(&data.fields, "Describe needs named fields"));
    };
    let mut parts = Vec::new();
    for field in &fields.named {
        let ident = field.ident.as_ref().unwrap();
        let (mut label, mut skip) = (ident.to_string(), false);
        for attr in field.attrs.iter().filter(|a| a.path().is_ident("describe")) {
            attr.parse_nested_meta(|meta| {
                if meta.path.is_ident("skip") { skip = true; Ok(()) }
                else if meta.path.is_ident("rename") { label = meta.value()?.parse::<LitStr>()?.value(); Ok(()) }
                else { Err(meta.error("unknown describe option; expected `skip` or `rename = \"...\"`")) }
            })?;
        }
        if !skip { parts.push(quote! { format!("{}={:?}", #label, self.#ident) }); }
    }
    let type_name = name.to_string();
    let (impl_generics, ty_generics, where_clause) = ast.generics.split_for_impl();
    Ok(quote! {
        impl #impl_generics #name #ty_generics #where_clause {
            pub fn describe(&self) -> String {
                let parts: Vec<String> = vec![#(#parts),*];
                format!("{} {{ {} }}", #type_name, parts.join(", "))
            }
        }
    })
}
```
`unwrap_or_else(syn::Error::into_compile_error)` is the conversion `syn` documents for a derive entry point ✅[^9].

| Step | Value |
|---|---|
| User code | `#[derive(Describe)] struct Server { host: String, #[describe(rename = "tcp_port")] port: u16, #[describe(skip)] password: String }` |
| Expansion (`cargo +nightly rustc -p app --bin app -- -Zunpretty=expanded`) | `impl Server { pub fn describe(&self) -> String { … format_args!("{0}={1:?}", "host", self.host) … "tcp_port", self.port … } }`; no line for `password` ✅[^1] |
| `s.describe()` at run time | `Server { host="db.local", tcp_port=5432 }` ✅[^1] |

The same crate held the other two kinds, also run in the lab ✅[^1]:
- **Attribute** `#[log_call] fn add(a: i32, b: i32) -> i32` expands to a wrapper that holds the original body as an inner `fn __add_inner`, calls it, prints and returns the result. `add(2, 3)` prints `[log_call] add((2, 3)) -> 5`.
- **Function-like** `hex_bytes!("dead beef")` expands to `[222u8, 173u8, 190u8, 239u8]` at compile time. `hex_bytes!("abc")` fails with `error: odd number of hex digits (3)` under the string literal.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Macro panics | `error: proc macro panicked`, message in a `help:` line, no useful location | The compiler catches the panic ✅[^1] ✅[^3] |
| Infinite loop in the macro | The build hangs | Endless loops are not caught ✅[^3] |
| Type error in generated code | Reported at `#[derive(…)]` | Template tokens carry `Span::call_site()` ✅[^1] ✅[^11] |
| Same error with `quote_spanned!(ty.span()=> …)` | Reported on the user's field type | Tokens take the given span ✅[^1] ✅[^12] |
| Caller defines `struct Vec;` | Generated `Vec<String>` fails with E0107 | Output resolves at the call site; write `::std::vec::Vec` ✅[^1] ✅[^3] |
| Generated `let answer` | Caller can read it | Call-site spans are unhygienic ✅[^1] ✅[^7] |
| Same `let` with `Span::mixed_site()` | Caller gets E0425 | Local variables resolve at the definition site ✅[^1] ✅[^7] |
| `pub fn` that is not a macro in the proc-macro crate | Compile error | Only macro functions may be exported ✅[^1] |
| Using the macro inside its own crate | Not allowed | Macros are usable only from importing crates ✅[^3] |
| `ItemFn`, `Expr` and other full syntax types | Missing without the `full` feature | `syn` feature-gates its syntax tree ✅[^8] |
| `--release` build | The macro crate is still compiled with `opt-level = 0` | `build-override` defaults ✅[^14] |
| `+=` in the input | Two `Punct` tokens, `Joint` then `Alone` | `Punct` is one character ✅[^1] ✅[^6] |
| `syn` major version | The names above are `syn` 2.0.119's; the lab's `tokio-macros` 2.7.2 depends on `syn` 3.0.10, whose API this doc did not check | Two major versions of `syn` can sit in one build ✅[^1] |

## Trade-offs
Measured in the lab with `cargo build --timings` on a clean dev build, aarch64, 8 CPUs, inside Docker (three runs where a range is given) ✅[^1] ✅[^15]: `syn` 2.0.119 with `full` and `extra-traits` took 1.59–1.93 s, with default features 0.64–0.73 s; the `macros` crate 0.51 s and `app` 0.24 s; the whole workspace 2.77 s. In the report `app` started only when `macros` finished, which itself waited for `syn`: every crate that uses the macro waits for that chain.

| Option | Gains | Costs |
|---|---|---|
| `macro_rules!` | No extra crate or dependency | Pattern matching only; `compile_error!` messages point at the rule and the whole call ✅[^1] |
| Proc macro with `syn` (`full`) | Parses any item; precise errors with spans | Separate crate; about 1.6–1.9 s of `syn` per clean build here |
| Proc macro with `syn` default features | Roughly 40 % of that `syn` time here | Only derive-input and basic types (no `ItemFn`) ✅[^8] |
| Proc macro on raw `proc_macro` tokens | No dependencies | Manual token walking; easy to get wrong |

## Takeaways
- Return `syn::Result` from the expansion function and turn errors into `compile_error!` tokens; never `unwrap()` or `panic!` on user input. [rule-candidate]
- Give generated checks the user's span with `quote_spanned!` so errors land on the field, not on the derive.
- Write absolute paths (`::core::fmt::Debug`, `::std::vec::Vec`) in generated code. [rule-candidate]
- Create internal identifiers with `Span::mixed_site()` or unlikely names, so the expansion cannot capture the caller's variables.
- Enable only the `syn` features the macro needs, and measure with `cargo build --timings`.
- Read the expansion with `cargo +nightly rustc -- -Zunpretty=expanded` when generated code misbehaves.

## Verification status
- Verified: 68 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `linux/lab-setup.md` — the Rust 1.100.0 lab (`rustlab:1`) where every behaviour marked with this note ran on 2026-11-24. [^1]
- [Macros](https://doc.rust-lang.org/book/ch20-05-macros.html) — The Rust Programming Language (ch 20.5), Rust project, living. Backs: the three kinds, the separate crate, `syn` and `quote` roles. [^2]
- [Procedural Macros](https://doc.rust-lang.org/reference/procedural-macros.html) — The Rust Reference, Rust project, living. Backs: signatures, derive output appended, helper attributes, hygiene, panics and `compile_error!`, own-crate restriction, endless loops. [^3]
- [Linkage](https://doc.rust-lang.org/reference/linkage.html) — The Rust Reference, Rust project, living. Backs: `proc-macro` crate type compiled for the host. [^4]
- [TokenTree in proc_macro](https://doc.rust-lang.org/proc_macro/enum.TokenTree.html) — `proc_macro` crate docs, Rust project, living. Backs: the four token tree variants. [^5]
- [Punct in proc_macro](https://doc.rust-lang.org/proc_macro/struct.Punct.html) — `proc_macro` crate docs, Rust project, living. Backs: single-character punctuation and `Spacing`. [^6]
- [Span in proc_macro](https://doc.rust-lang.org/proc_macro/struct.Span.html) — `proc_macro` crate docs, Rust project, living. Backs: `call_site`, `mixed_site`, nightly `def_site`. [^7]
- [syn](https://docs.rs/syn/2.0.119/syn/index.html) — docs.rs, dtolnay, 2026 (syn 2.0.119). Backs: `DeriveInput`, `parse_macro_input!`, feature flags and compile time. [^8]
- [Error in syn](https://docs.rs/syn/2.0.119/syn/struct.Error.html) — docs.rs, dtolnay, 2026 (syn 2.0.119). Backs: `new_spanned`, `to_compile_error`, `into_compile_error`, the `syn::Result` pattern. [^9]
- [Attribute in syn](https://docs.rs/syn/2.0.119/syn/struct.Attribute.html) — docs.rs, dtolnay, 2026 (syn 2.0.119). Backs: `parse_nested_meta`. [^10]
- [quote in quote](https://docs.rs/quote/1.0.47/quote/macro.quote.html) — docs.rs, dtolnay, 2026 (quote 1.0.47). Backs: interpolation, repetition, return type, call-site spans. [^11]
- [quote_spanned in quote](https://docs.rs/quote/1.0.47/quote/macro.quote_spanned.html) — docs.rs, dtolnay, 2026 (quote 1.0.47). Backs: tokens with a given span, user-type assertion pattern. [^12]
- [Cargo Targets](https://doc.rust-lang.org/cargo/reference/cargo-targets.html#the-proc-macro-field) — The Cargo Book, Rust project, living. Backs: `proc-macro = true`. [^13]
- [Profiles](https://doc.rust-lang.org/cargo/reference/profiles.html#build-dependencies) — The Cargo Book, Rust project, living. Backs: `build-override` defaults for proc macros. [^14]
- [Reporting build timings](https://doc.rust-lang.org/cargo/reference/timings.html) — The Cargo Book, Rust project, living. Backs: `cargo build --timings` report. [^15]

## Related
- `rust/macros/declarative-macros.md` — `macro_rules!`, hygiene and recursion.
- `rust/ecosystem/serde-data-model.md` — a large real-world derive and its attributes.
- `rust/performance/compiler-pipeline-and-compile-times.md` — expansion in the pipeline and measuring build time.
- `rust/project-structure/cargo-workspaces-features-and-profiles.md` — workspaces, features and profiles.
