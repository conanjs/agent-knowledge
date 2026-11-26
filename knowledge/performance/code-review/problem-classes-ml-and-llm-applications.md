---
schema: knowledge-doc/v1
type: reference
topic: performance/code-review
status: verified
applies-to: ["Application code that calls ML frameworks or LLM APIs; examples in Python and SQL", "PyTorch 2.15 docs, TensorFlow tf.data guide (living), Hugging Face Transformers 5.24.1 docs, pgvector 0.8.7 README", "Claude API docs (platform.claude.com) and OpenAI API docs (developers.openai.com), both read 2026-11-26"]
last-verified: 2026-11-26
last-updated: 2026-11-26
tags: [performance, code-review, machine-learning, pytorch, tensorflow, llm, prompt-caching, batch-api, context-window, vector-search, pgvector]
ranked-sources: true
---

# Performance problem classes for ML and LLM applications

## Summary
**TL;DR:** Application code that drives a machine-learning (ML) framework or a large-language-model (LLM) API has seven recurring costly shapes: an input pipeline that leaves the accelerator idle, a training loop that reads tensors back every step, inference one item at a time with gradient tracking on, a prompt whose changing part comes first so the provider's cache never hits, offline work sent through the real-time API, a conversation history re-sent in full every turn, and an exact scan over every embedding. Each has a named remedy and a cost a reviewer can state from the code. Prices, limits and cache lifetimes change often: the provider facts here are dated 2026-11-26.
**Use this when:** you review Python that trains or serves a model with PyTorch, TensorFlow or Hugging Face Transformers, code that calls the Claude API or the OpenAI API, or SQL that searches embeddings with pgvector.
**Not this doc:** the 39 general classes (N+1 calls, caching, concurrency, payload size) → [problem-classes.md](problem-classes.md); how the training loop works → [training-loop-and-debugging.md](../../machine-learning/deep-learning/training-loop-and-debugging.md); token accounting in coding agents → [agent-token-accounting.md](../../ai-agents/agent-token-accounting.md); what to keep in a context → [context-engineering-deep-dive.md](../../ai-agents/context-engineering-deep-dive.md); measuring recall of a vector index → [vector-search-evaluation.md](../../algorithms/vector-search-evaluation.md).

## Scope
The domain is how application code calls an ML framework or an LLM API: data loading, the training and inference loop, prompt layout, request mode, conversation state and vector search. A class here follows the admission test of the first catalog: visible in review, a standard remedy, a cost stated from the code, a rank 1–3 source, and not one of the 39 existing classes. Out of scope: writing or tuning accelerator kernels, compiler flags, model architecture, quantization internals, mixed precision and `torch.compile`.

Notation, each with one worked example:
- **n**: items processed (samples, prompts, queries). Example: n = 20,000 support tickets to classify overnight.
- **b**: batch size. Example: n = 20,000 items at b = 32 is ⌈20,000 / 32⌉ = 625 forward calls instead of 20,000.
- **s**: training steps between two reads of a tensor value. Example: logging every s = 100 steps over 10,000 steps is 100 reads instead of 10,000.
- **t**: turns in one conversation; **w**: turns kept in the window. Example: t = 50 turns of 1,000 tokens each; the last request sends 50,000 tokens.
- **p**: tokens in the stable prompt prefix (tools, system prompt, shared documents). Example: p = 8,000 tokens of instructions sent with every request.
- **d**: dimensions of an embedding vector; **k**: neighbours returned. Example: n = 1,000,000 vectors of d = 768 is 768,000,000 multiply-adds for one exact query that returns k = 10.

| Term | Plain meaning | Analogy | Concrete example |
|---|---|---|---|
| Accelerator synchronization | The CPU stops and waits until the GPU has finished all queued work | A waiter who stands at the kitchen door after every order instead of taking the next table | `loss.item()` inside the step loop |
| Autograd graph | The record of operations PyTorch keeps so it can compute gradients later | A receipt roll that keeps growing until someone tears it off | `total_loss += loss` keeps every step's graph alive |
| Epoch | One full pass over the training data | One lap of a running track | 10 epochs over 50,000 images reads each image 10 times |
| Prompt cache | The provider stores the processed form of a prompt prefix and reuses it when the next request starts with exactly the same prefix | A copy shop that keeps the first 100 pages already copied if the next order starts with the same pages | `cache_read_input_tokens: 8000` in a Claude API response |
| Time to live (TTL) | How long a cache entry survives without use | A parking ticket that expires unless you feed the meter | Claude API default: 5 minutes, refreshed on each hit |
| Context window | The maximum tokens one request can hold, input plus output | A whiteboard of fixed size | 200,000 or 1,000,000 tokens, by model |
| Compaction | Replacing old turns with a summary so the conversation can continue | Minutes of a meeting instead of the full recording | The Claude API's server-side compaction (beta) |
| Batch API | An asynchronous endpoint that takes many requests at once, runs them within a time window, and charges less | Sending laundry out overnight instead of standing at the machine | OpenAI Batch API: one input file, results within 24 hours |
| Embedding | A fixed-length vector of numbers that represents a text | A postcode for meaning: close codes, close meaning | A 768-number vector for one paragraph |
| Approximate nearest neighbour (ANN) index | An index that finds most, not always all, of the true closest vectors much faster | Asking the librarian for the right shelf instead of reading every book | pgvector `USING hnsw` |
| Recall@k | The share of the true k nearest neighbours that the index returned | Of the 10 best answers, how many you found | Exact `[A,B,C]`, approximate `[A,D,B]`: recall@3 = 2/3 |

## Catalog

**Training and inference with an ML framework**

| Class | Signals in code | Fix | Before → after | Check |
|---|---|---|---|---|
| `input-pipeline-starvation` | `DataLoader(ds, batch_size=…)` with no `num_workers` on a GPU job; no `pin_memory=True`; a `tf.data` chain with no `.prefetch`, `.map(f)` with no `num_parallel_calls`, files decoded again each epoch with no `.cache()`, a per-element `.map` before `.batch` | PyTorch: `num_workers > 0`, `pin_memory=True`, `persistent_workers=True`; `tf.data`: `.prefetch(tf.data.AUTOTUNE)`, `num_parallel_calls=tf.data.AUTOTUNE` on `map` and `interleave`, `.cache()` after the expensive `map`, `.batch()` before a vectorized `map` | Step time = load + compute → about max(load, compute); per-element calls n → ⌈n/b⌉. PyTorch 2.15 defaults are `num_workers=0`, `pin_memory=False`, `persistent_workers=False` ✅[^pt-data]; with 0 workers loading is synchronous in the main process, and `num_workers > 0` overlaps loading with training ✅[^pt-tuning]; pinned memory gives faster, asynchronous host-to-GPU copies ✅[^pt-tuning]; prefetching makes the step time the maximum, not the sum, of training and data extraction ✅[^tf-data]; transformations before `cache` run only in the first epoch ✅[^tf-data]; batch before `map` so the function runs over a batch at once ✅[^tf-data] | Time the loop with the model step removed: if data alone takes about as long as a full step, the input is the bottleneck. GPU busy share rises after the fix |
| `training-loop-readback` | `loss.item()`, `print(t)`, `.cpu()`, `.numpy()`, `.tolist()` or `if (t != 0).all()` on GPU tensors in every step; `total_loss += loss` with `loss` a tensor | Read values every s steps or once per epoch; accumulate a Python number (`total_loss += float(loss)`) where a running sum is needed; keep metrics on the device between reads | Synchronizations n steps → n/s; memory held by graphs O(steps) → O(1). PyTorch lists `print(cuda_tensor)`, `.item()`, `.cpu()`, `.to(device)`, `.nonzero()` and control flow on CUDA results as synchronizing, and asks to let the CPU run ahead ✅[^pt-tuning]; "Don’t accumulate history across your training loop", fixed with `float(loss)` ✅[^pt-faq] | Memory after each step stays flat over 1,000 steps; a profiler trace shows no wait on the device inside the step |
| `per-item-inference` | `for x in items: model(x.unsqueeze(0))`; a Hugging Face `pipe(text)` call inside a Python loop; evaluation or serving code with no `torch.no_grad()` or `torch.inference_mode()`; `model.eval()` used as if it turned gradients off | Batch the inputs (a `DataLoader` with `batch_size`, or pass a list or `Dataset` to the pipeline); wrap inference in `torch.inference_mode()` (or `torch.no_grad()` when the outputs re-enter autograd) | Forward calls n → ⌈n/b⌉; autograd records per call → none. Gradients are typically not needed for validation or inference ✅[^pt-tuning]; `no_grad` reduces memory for computations that would otherwise require gradients ✅[^pt-nograd]; `inference_mode` also removes view tracking and version counter bumps, but its tensors cannot be used in autograd later ✅[^pt-infmode]; evaluation mode is not a mechanism to disable gradients ✅[^pt-autograd]; to iterate over a full dataset, Transformers recommends giving the dataset to the pipeline directly, and says batching is not automatically a win ✅[^hf-pipelines] | Throughput at b = 1, 8, 32 on the real hardware and data; peak memory with and without `inference_mode`; equal outputs |

**Calling an LLM API**

| Class | Signals in code | Fix | Before → after | Check |
|---|---|---|---|---|
| `prompt-prefix-churn` | A system prompt that starts with a timestamp, request id or user name; per-user data placed before shared instructions or documents; a tool list built from a `set` or an unordered dict; no `cache_control` on Claude API requests that repeat a long prefix | Put stable content first and variable content last: tools, then system prompt, then shared documents, then the turn; serialize tools in a fixed order; on the Claude API add a `cache_control` breakpoint or the top-level automatic one; on the OpenAI API caching is automatic | The stable prefix p is billed at full input price on every request → at the cache-read price after the first. Claude API: the cache covers `tools`, `system`, `messages` in that order up to the breakpoint, and a change at one level invalidates it and every later level ✅[^an-cache]; hits need 100 percent identical segments ✅[^an-cache]; cache reads cost 0.1 times the base input price by default, less on some models (see Lookup notes) ✅[^an-cache]. OpenAI API: reuse requires the entire rendered prefix to match, so put stable instructions first ✅[^oa-cache]; cached input is discounted up to 95% ✅[^oa-cache]. Per-provider lifetimes, write prices and minimum lengths are in Lookup notes | A second identical request reports `cache_read_input_tokens` > 0 (Claude API) ✅[^an-cache] or `cached_tokens` > 0 (OpenAI API) ✅[^oa-cache]; the hit share of input tokens in production logs |
| `realtime-api-for-offline` | A nightly job, backfill, evaluation or corpus-embedding script that loops over thousands of items calling `messages.create` or `responses.create`, with sleep-and-retry on HTTP 429 | Send the work through the provider's batch interface (Claude Message Batches API, OpenAI Batch API) and collect results when the batch ends | n synchronous requests at full price, throttled by per-minute limits → ⌈n / per-batch cap⌉ batches at half price. Claude API: costs reduced by 50 percent, most batches finish in under 1 hour, a batch holds up to 100,000 requests or 256 MB, and it expires if not done within 24 hours ✅[^an-batch]. OpenAI API: 50% discount, completes within 24 hours, up to 50,000 requests or 200 MB per batch, and jobs do not count toward standard rate limits ✅[^oa-batch] | Count the requests the job sends: a few batch calls, not n; cost per item before and after |
| `unbounded-conversation-context` | `messages.append(...)` for every turn and every tool result, with the whole list sent on each call; full file or search outputs kept as tool results forever; an endless `previous_response_id` chain; no token count before sending | Server-side compaction; clearing old tool results (Claude API context editing, beta); a window of the last w turns plus a summary; count tokens before sending | Input of turn i grows with i, so input over t turns is O(t²) tokens → O(t·w). Each Claude API turn's input holds all previous history plus the new message ✅[^an-ctx]; with OpenAI chained responses, all previous input tokens in the chain are billed as input ✅[^oa-conv]; a Claude API input larger than the window fails with HTTP 400 ✅[^an-ctx]; Claude API compaction is in beta for Claude 4.6 and later ✅[^an-ctx]; context editing clears tool results above a trigger, by default 100,000 input tokens, keeping 3 tool uses ✅[^an-ctxedit]; OpenAI offers compaction through `context_management` with `compact_threshold` or `/responses/compact` ✅[^oa-conv] | Plot input tokens per request (from `usage`) against the turn number: it should level off, not rise in a line |

**Vector search over embeddings**

| Class | Signals in code | Fix | Before → after | Check |
|---|---|---|---|---|
| `exact-vector-scan` | `ORDER BY embedding <=> $1 LIMIT k` on a table with no HNSW or IVFFlat index; NumPy `query @ all_vectors.T` over the whole corpus per request; an approximate index used with a selective `WHERE` filter and no iterative scan | pgvector `CREATE INDEX … USING hnsw (embedding vector_cosine_ops)` or `ivfflat`; tune `hnsw.ef_search` or `ivfflat.probes` against a recall target; enable iterative index scans for filtered queries (pgvector 0.8.0 and later) | O(n·d) per query with perfect recall → an index search with recall below 1. pgvector performs exact search by default, which gives perfect recall, and an index trades some recall for speed ✅[^pgvector]; HNSW has better query performance than IVFFlat but builds more slowly and uses more memory; IVFFlat builds faster and uses less memory ✅[^pgvector]; the query needs `ORDER BY` a distance and `LIMIT` to use the index ✅[^pgvector]; with approximate indexes filtering is applied after the index scan ✅[^pgvector] | `EXPLAIN (ANALYZE, BUFFERS)` shows the index scan ✅[^pgvector]; recall@k against exact results on held-out queries is at or above the target ([vector-search-evaluation.md](../../algorithms/vector-search-evaluation.md)) |

## Lookup notes

**Provider facts for `prompt-prefix-churn` and `realtime-api-for-offline`** (read 2026-11-26; these pages change often):

| Fact | Claude API (Anthropic) | OpenAI API |
|---|---|---|
| Is caching on by default? | No: mark a `cache_control` block, or add one top-level `cache_control` field for automatic caching ✅[^an-cache] | Yes, for supported models ✅[^oa-cache] |
| Minimum cacheable prefix | 512 tokens on Claude Opus 5.5, Sonnet 5.5 and Haiku 5.5, up to 4,096 on some older models; a shorter prompt is processed without caching and no error is returned ✅[^an-cache] | 1,024 tokens for GPT-5.6 and later; earlier models: depends on the request ✅[^oa-cache] |
| Lifetime | 5 minutes by default, refreshed each time the cached content is used; 1-hour option (`ttl: "1h"`) with a higher write price ✅[^an-cache] | GPT-5.6 and later: `prompt_cache_options.ttl`, default `30m`, or `12h` (Responses API); earlier models: `in_memory`, typically 5 to 10 minutes of inactivity and up to one hour, or `24h` extended retention ✅[^oa-cache] |
| Price of a cached read | 0.1 times base input by default; 0.05 times on Claude Opus 5.5 and Claude Sonnet 5.5; 0.025 times on Claude Fable and Mythos 5.1 and 5.2 ✅[^an-cache] | GPT-5.6 and later: 0.1 times the input rate (0.05 times on some GPT-6.x models); earlier models: a model-dependent cached-input rate; the page also says "discounted up to 95%" ✅[^oa-cache] |
| Price of a cache write | 1.25 times base input for 5 minutes, 2 times for 1 hour ✅[^an-cache] | GPT-5.6 and later: 1.25 times for the 30-minute lifetime, 2.5 times for 12 hours; earlier models: no additional write charge ✅[^oa-cache] |
| Effect on rate limits | The default input-tokens-per-minute limits count only uncached input: cache reads do not count, cache writes do ✅[^an-rate] | Not stated on the pages read |
| Batch discount and window | 50 percent; most batches under 1 hour; expire after 24 hours ✅[^an-batch] | 50%; within 24 hours ✅[^oa-batch] |
| Batch and rate limits | Batches have their own limits, including requests waiting in the queue ✅[^an-batch] | Jobs do not count toward standard per-model limits ✅[^oa-batch] |

**Not a problem when**

| Class | Not a problem when |
|---|---|
| `input-pipeline-starvation` | The data is small, already in memory as tensors, and needs no decoding; or the job runs on CPU only. More workers cost memory and start-up time, and PyTorch says `num_workers` should be tuned to the workload ✅[^pt-tuning] |
| `training-loop-readback` | The read happens once per epoch or every s steps; the tensors live on the CPU (the PyTorch list names CUDA tensors, so there is no device to wait for: inferred) |
| `per-item-inference` | A live service is latency-bound or runs on CPU: Transformers says not to batch in those cases, and batching can be a 10x speedup or a 5x slowdown depending on hardware, data and model ✅[^hf-pipelines]; training code that needs gradients |
| `prompt-prefix-churn` | The prefix is below the provider's minimum, or requests come further apart than the cache lifetime; then a Claude API breakpoint only adds the 1.25 times write price with no later read ✅[^an-cache] |
| `realtime-api-for-offline` | A user waits for the answer; n is small; results are needed sooner than the batch window allows |
| `unbounded-conversation-context` | Sessions have a small fixed number of turns; the task needs the whole history and it fits. Caching lowers the price of the repeated part, but cached prefixes still occupy the context window ✅[^an-ctx] |
| `exact-vector-scan` | n is small enough that an exact scan meets the latency budget; results must be exact; a selective filter would make the approximate index return too few rows (pgvector notes filtered queries can return fewer results) ✅[^pgvector] |

**Belongs to an existing class**
- Independent LLM calls awaited one after another → `concurrency-backpressure`, bounded by the provider's limits. The Claude API uses a token bucket and short bursts can exceed the limit ✅[^an-rate]; a 429 may carry `retry-after` ✅[^an-rate], and OpenAI advises exponential backoff with jitter when it is missing ✅[^oa-rate] → `distributed-calls` for the retry policy.
- One embedding request per text → `io-batching-n-plus-one`: the OpenAI embeddings endpoint takes an array, up to 2,048 inputs and 300,000 tokens per request ✅[^oa-embed]. A whole corpus is also a `realtime-api-for-offline` case: the OpenAI Batch API accepts `/v1/embeddings` ✅[^oa-batch].
- Embeddings recomputed for unchanged text → `caching-recomputation`, keyed by content hash and model name.
- A model loaded inside the request handler → `startup-cold-start` or `caching-recomputation`.
- Python loops over tensor or array elements → `numeric-vectorization`.
- Retrieval that stuffs many more chunks into the prompt than the answer needs → `payload-overfetch`; a caller-controlled prompt size or `max_tokens` with no cap → `unbounded-input`.
- A filter or sort on an ordinary column with no matching index stays `db-query-index`: there the index returns the same rows. `exact-vector-scan` is only the nearest-neighbour `ORDER BY` on a vector column, where the index returns approximate rows.
- Exact distance to every point in two or three dimensions (maps, geometry) stays `spatial-search`; `exact-vector-scan` is the high-dimensional case where the standard remedy is approximate and changes the result.

**Corrections found while checking the sources (2026-11-26)**
- `model.eval()` does not turn off gradients; it is orthogonal to `no_grad` and inference mode ✅[^pt-autograd].
- Batching inference is not always faster: Transformers states either a 10x speedup or a 5x slowdown, and advises measuring ✅[^hf-pipelines].
- The FAQ fix `float(loss)` frees the graph but is itself a read of a tensor value, which the tuning guide lists among synchronizing calls when the tensor is on CUDA (inferred from ✅[^pt-faq] and ✅[^pt-tuning]); for both costs, read every s steps.
- A batch interface is not free of limits on the Claude API: batches have their own rate limits, including the queue of waiting requests ✅[^an-batch]. On the OpenAI API, batch jobs do not count toward standard limits ✅[^oa-batch].
- `max_tokens` counts differently: OpenAI computes the rate limit from the maximum of `max_tokens` and the estimated tokens ✅[^oa-rate]; the Claude API's output-tokens-per-minute limit counts only tokens actually generated, not `max_tokens` ✅[^an-rate].
- Caching in batches is best-effort on the Claude API: typical hit rates of 30 to 98 percent, and the page suggests the 1-hour cache for shared context ✅[^an-batch].
- Clearing old tool results breaks the prompt cache; the Claude API's `clear_at_least` exists to make each clearing worth the new cache write ✅[^an-ctxedit].
- The PyTorch 2.15 `DataLoader` page shows `prefetch_factor=2` in one signature and `prefetch_factor=None` in another; the parameter text says its default depends on `num_workers` ✅[^pt-data].

**What the sources do not say**
- No PyTorch or TensorFlow page gives a recommended `num_workers` value or a speedup factor for prefetching.
- OpenAI states caching "does not guarantee" lower latency for every request ✅[^oa-cache]; neither provider page read gives a latency number that a reviewer could quote as a guarantee.
- The pgvector README gives the defaults (`hnsw.ef_search` 40, `m` 16, `ef_construction` 64, `ivfflat.probes` 1) ✅[^pgvector] but no recall figure for them: recall depends on the data and must be measured.
- The OpenAI conversation-state page says previous input tokens of a chain are billed as input; it does not say how earlier output tokens are billed in a chain.
- The `tf.data` guide shows no version or date.

**Weaker sources, rank 5 or 6.** None used.

**Calibration state (2026-11-26).** Each class of this catalog has one known-bad sample in round 3 of the review-agent calibration, and some of its "Not a problem when" rows have a trap sample. In that round (one run per arm) the agent with the skill filed all 96 planted problems of the thirteen domain catalogs under the right class id, and without the skill 86 of them. Results per catalog, and the limits of the round: [perf-reviewer-calibration.md](perf-reviewer-calibration.md) §6.5.

## Takeaways
- In a training or inference loop, look for work that runs once per step and does not need to: a synchronous loader, a tensor read, a per-item forward call; state the cost as calls per step and per run. [rule-candidate]
- In an LLM call, check the order of the prompt (stable first), whether the work is interactive (else a batch interface), and whether the history is bounded; state the before → after in tokens per request and requests per job. [rule-candidate]
- An approximate vector index is a trade, not a free fix: report it with a recall target and a check against exact results.
- Any price, limit or lifetime quoted in a review names the provider, the model and the date of the page.

## Verification status
- Verified: 71 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-26

## References
- [Performance Tuning Guide](https://docs.pytorch.org/tutorials/recipes/recipes/tuning_guide.html) — PyTorch, tutorials (docs version selector v2.15.0; the page states no tutorial version), last updated 2025-07-09. Rank 1. Backs: Catalog, input-pipeline-starvation, training-loop-readback and per-item-inference; Lookup notes. [^pt-tuning]
- [torch.utils.data](https://docs.pytorch.org/docs/2.15/data.html) — PyTorch, 2.15. Rank 1. Backs: Catalog, input-pipeline-starvation; Lookup notes. [^pt-data]
- [Frequently Asked Questions](https://docs.pytorch.org/docs/2.15/notes/faq.html) — PyTorch, 2.15. Rank 1. Backs: Catalog, training-loop-readback; Lookup notes. [^pt-faq]
- [torch.no_grad](https://docs.pytorch.org/docs/2.15/generated/torch.no_grad.html) — PyTorch, 2.15. Rank 1. Backs: Catalog, per-item-inference. [^pt-nograd]
- [torch.autograd.grad_mode.inference_mode](https://docs.pytorch.org/docs/2.15/generated/torch.autograd.grad_mode.inference_mode.html) — PyTorch, 2.15. Rank 1. Backs: Catalog, per-item-inference. [^pt-infmode]
- [Autograd mechanics](https://docs.pytorch.org/docs/2.15/notes/autograd.html) — PyTorch, 2.15. Rank 1. Backs: Catalog, per-item-inference; Lookup notes. [^pt-autograd]
- [Better performance with the tf.data API](https://www.tensorflow.org/guide/data_performance) — TensorFlow, living. Rank 1. Backs: Catalog, input-pipeline-starvation. [^tf-data]
- [Pipelines, pipeline batching](https://huggingface.co/docs/transformers/main_classes/pipelines) — Hugging Face, Transformers 5.24.1. Rank 1. Backs: Catalog, per-item-inference; Lookup notes. [^hf-pipelines]
- [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) — Anthropic, Claude API docs, living, read 2026-11-26. Rank 1. Backs: Catalog, prompt-prefix-churn; Lookup notes. [^an-cache]
- [Batch processing](https://platform.claude.com/docs/en/build-with-claude/batch-processing) — Anthropic, Claude API docs, living, read 2026-11-26. Rank 1. Backs: Catalog, realtime-api-for-offline; Lookup notes. [^an-batch]
- [Context windows](https://platform.claude.com/docs/en/build-with-claude/context-windows) — Anthropic, Claude API docs, living, read 2026-11-26. Rank 1. Backs: Catalog, unbounded-conversation-context; Lookup notes. [^an-ctx]
- [Context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing) — Anthropic, Claude API docs, living (beta feature), read 2026-11-26. Rank 1. Backs: Catalog, unbounded-conversation-context; Lookup notes. [^an-ctxedit]
- [Rate limits](https://platform.claude.com/docs/en/api/rate-limits) — Anthropic, Claude API docs, living, read 2026-11-26. Rank 1. Backs: Lookup notes. [^an-rate]
- [Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching) — OpenAI, API docs, living, read 2026-11-26. Rank 1. Backs: Catalog, prompt-prefix-churn; Lookup notes. [^oa-cache]
- [Batch API](https://developers.openai.com/api/docs/guides/batch) — OpenAI, API docs, living, read 2026-11-26. Rank 1. Backs: Catalog, realtime-api-for-offline; Lookup notes. [^oa-batch]
- [Conversation state](https://developers.openai.com/api/docs/guides/conversation-state) — OpenAI, API docs, living, read 2026-11-26. Rank 1. Backs: Catalog, unbounded-conversation-context. [^oa-conv]
- [Rate limits](https://developers.openai.com/api/docs/guides/rate-limits) — OpenAI, API docs, living, read 2026-11-26. Rank 1. Backs: Lookup notes. [^oa-rate]
- [Create embeddings](https://developers.openai.com/api/reference/resources/embeddings/methods/create) — OpenAI, API reference, living, read 2026-11-26. Rank 1. Backs: Lookup notes. [^oa-embed]
- [pgvector README](https://github.com/pgvector/pgvector) — pgvector project, 0.8.7. Rank 1. Backs: Catalog, exact-vector-scan; Lookup notes. [^pgvector]

## Related
- [problem-classes.md](problem-classes.md) — the first catalog: 39 general classes, several of which own ML and LLM sub-cases (see "Belongs to an existing class").
- [perf-reviewer-calibration.md](perf-reviewer-calibration.md) — the review agent built on the catalogs, and how it scored.
- [../../machine-learning/deep-learning/training-loop-and-debugging.md](../../machine-learning/deep-learning/training-loop-and-debugging.md) — the PyTorch training loop, `DataLoader`, `eval()` and `no_grad()`.
- [../../machine-learning/transformers/decoding-and-kv-cache.md](../../machine-learning/transformers/decoding-and-kv-cache.md) — the key-value cache inside the model, which provider prompt caching reuses across requests.
- [../../ai-agents/agent-token-accounting.md](../../ai-agents/agent-token-accounting.md) — how repeated context and cache reads add up in coding agents.
- [../../ai-agents/skills-delegation-cache-economics.md](../../ai-agents/skills-delegation-cache-economics.md) — prompt-cache economics for agent design.
- [../../ai-agents/context-engineering-deep-dive.md](../../ai-agents/context-engineering-deep-dive.md) — what to keep, compress or isolate in a context.
- [../../algorithms/vector-search-evaluation.md](../../algorithms/vector-search-evaluation.md) — measuring recall and latency of a vector index.
