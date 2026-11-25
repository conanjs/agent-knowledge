---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/transformers
status: verified
applies-to: ["any"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [machine-learning, transformers, tokenization, bpe, byte-level-bpe, wordpiece, unigram, sentencepiece, vocabulary, tokens]
---

# Tokenization: BPE, WordPiece, Unigram and byte-level BPE

## Summary
**TL;DR:** A tokenizer turns text into a list of integer ids from a fixed vocabulary, and the model only ever sees those ids. Subword tokenizers keep frequent words whole and split rare words into known pieces, so a vocabulary of tens of thousands of entries can encode any word. BPE (byte-pair encoding) learns merge rules bottom-up from the most frequent pairs; WordPiece merges by a frequency ratio and encodes by longest match; Unigram starts big and prunes by likelihood. Byte-level BPE starts from the 256 byte values, so no input is ever unknown, but text the tokenizer saw little of in training costs more tokens.
**Use this when:** you need to know why a word became several tokens, why the same text has different token counts in two models or two languages, or which tokenizer family a model uses.
**Not this doc:** counting tokens for a specific vendor's model → `ai-agents/tokenizers-for-coding-agents.md`; what the model does with the ids → `machine-learning/transformers/attention-and-the-transformer.md`.

## Problem
A neural network needs a fixed, finite set of input symbols, but text is open-ended: names, typos, compounds, code and other languages keep producing words never seen before. A word-level vocabulary must map every unseen word to one "unknown" symbol and loses it. A character-level vocabulary never fails but makes sequences longer (23 tokens instead of 6 for one sentence in the worked example ✅[^10]), and a self-attention layer's cost grows as `n²·d` for `n` tokens of width `d` ✅[^11]. Context windows and usage are counted in tokens (`ai-agents/agent-token-accounting.md`), so an engineer who treats "token ≈ word" mis-estimates both.

## Mental model
**Analogy:** a stenographer who invents shorthand. She starts by writing every letter. Each evening she looks at the day's notes, finds the letter pair she wrote most often, and invents one new symbol for it. After many evenings, common words are one symbol, rare words are a few, and a word she has never heard is still spelled out letter by letter. BPE training is those evenings; the list of inventions, in order, is the tokenizer.

**Artifact:** the merge rules BPE learns from the toy dictionary in the BPE paper's Algorithm 1 (`low`×5, `lower`×2, `newest`×6, `widest`×3, `</w>` marks a word’s end), printed by the full script in the Worked example; lab run (`machine-learning/lab-setup.md`), 2026-11-24, Python 3.13.7 ✅[^10]:

```text
merge  1:     'e' + 's'     -> 'es'       (pair count 9)
merge  2:    'es' + 't'     -> 'est'      (pair count 9)
merge  3:   'est' + '</w>'  -> 'est</w>'  (pair count 9)
merge  4:     'l' + 'o'     -> 'lo'       (pair count 7)
merge  5:    'lo' + 'w'     -> 'low'      (pair count 7)
…
merge 10:     'w' + 'i'     -> 'wi'       (pair count 3)
 lowest -> ['low', 'est</w>']        # never in the training dictionary, encoded from known pieces
```

## How it works
**The pipeline.** An encode call runs four steps: normalization (clean-up such as Unicode normalization or lowercasing), pre-tokenization (split into "words", which bound what a token can span), the model (split each word into vocabulary tokens and map them to ids), and post-processing (add special tokens such as BERT's (Bidirectional Encoder Representations from Transformers) `[CLS]` and `[SEP]`) ✅[^7]. Only the model step is learned from data ✅[^7].

### BPE (byte-pair encoding)
BPE was a data-compression technique that replaces the most frequent pair of bytes with an unused byte; Sennrich et al. adapted it to merge characters and character sequences for NMT (neural machine translation) ✅[^1].
1. **Start:** split every word of the training dictionary into characters plus an end-of-word symbol; each word is weighted by its frequency, and pairs that cross a word boundary are not counted ✅[^1].
2. **Count and merge:** count every adjacent symbol pair, replace each occurrence of the most frequent pair `(A, B)` with a new symbol `AB`, and repeat ✅[^1].
3. **Stop:** final vocabulary size = initial characters + number of merges; the number of merges is the algorithm's only hyperparameter ✅[^1].
4. **Encode new text:** split a word into characters, then apply the learned merges in the order they were learned ✅[^1] ✅[^2]. A character never seen in training becomes the unknown token (`[UNK]`) in a character-level BPE ✅[^2].

### WordPiece
WordPiece, the tokenizer developed to pretrain BERT, trains like BPE but differs in two ways ✅[^3]. It picks the pair with the highest `score = freq(pair) / (freq(first) × freq(second))`, where `freq` counts occurrences in the weighted corpus; on the course corpus `("##u","##g")` occurs 20 times but scores `20 / (36 × 20) = 1/36`, while `("##g","##s")` scores `5 / (20 × 5) = 1/20` and is merged first ✅[^3]. It marks word-internal pieces with `##` and stores only the final vocabulary, then encodes by taking the longest vocabulary entry from the start of the word, repeatedly ✅[^3]. If any part cannot be matched, the whole word becomes `[UNK]` ✅[^3]. Google never released its WordPiece training code, so the course's training description is a reconstruction ✅[^3].

### Unigram
Unigram, proposed by Kudo for subword regularization ✅[^9], works top-down ✅[^4]:
1. Start from a large candidate vocabulary (for example all common substrings) ✅[^4].
2. Treat each token as independent: `P(token) = count(token) / total count`, and a segmentation's probability is the product over its tokens; in the course corpus `P("ug") = 20/210` ✅[^4].
3. Encode a word as its most probable segmentation, found with the Viterbi algorithm (dynamic programming over split points) ✅[^4].
4. The training loss is the corpus negative log-likelihood, `Σ_words freq(word) · (−log P(word))`. Repeatedly remove the p % of tokens (p is usually 10 or 20) whose removal raises that loss least, never removing single characters, until the target size is reached ✅[^4].
Because several segmentations have probabilities, Unigram can sample a different segmentation each time during training, which is Kudo's subword regularization ✅[^9].

### SentencePiece and byte-level BPE: where the spaces and the unknowns go
- **SentencePiece** trains BPE or Unigram directly on raw sentences, with no language-specific pre-tokenizer, so languages written without spaces (Chinese, Korean, Japanese) need no separate word segmenter ✅[^5] ✅[^4]. It escapes the space as `▁` (U+2581) and treats it as an ordinary symbol, so decoding is lossless: join the pieces and turn `▁` back into spaces ✅[^5].
- **Byte-level BPE** (GPT-2 (Generative Pre-trained Transformer 2) and RoBERTa) runs BPE over UTF-8 (Unicode Transformation Format, 8-bit) bytes instead of characters, so the base vocabulary has 256 entries and no unknown token is needed ✅[^2] ✅[^6]. The GPT-2 pre-tokenizer keeps the space at the start of the next word and shows it as `Ġ` (`Ġhow`), so `" the"` and `"the"` are different tokens ✅[^8].

### What a token count means
The count is a property of the (tokenizer, text) pair. Sennrich et al. frame segmentation as a trade-off between vocabulary size and text size, and chose BPE for its good compression of the text ✅[^1]: more merges mean a bigger vocabulary and fewer tokens per text. In the worked example, text like the training corpus compresses well, while a rare word and an unseen script fall back to short pieces or single bytes and cost more tokens ✅[^10].

## Worked example
Byte-level BPE trained on a 20-times-repeated English toy corpus (`the cat sat on the mat. the dog sat on the log. …`), with GPT-2-style pre-tokenization (a word keeps its leading space), then used to encode three strings. The core training loop:

```python
pairs = collections.Counter()
for w, f in word_freqs.items():               # w: tuple of byte ids, f: word frequency
    for p in zip(w, w[1:]):
        pairs[p] += f
best = max(pairs, key=pairs.get)               # most frequent adjacent pair
word_freqs = {merge(w, best, new): f for w, f in word_freqs.items()}
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-24, Python 3.13.7, two runs identical ✅[^10]:

```text
first 8 merges: ['th', 'the', 'at', ' the', ' o', ' on', 'og', ' a']
merges= 0 seen English  chars=23 bytes=23 tokens=23
merges= 0 Vietnamese    chars=23 bytes=29 tokens=29
merges=10 seen English  chars=23 bytes=23 tokens=12
merges=10 Vietnamese    chars=23 bytes=29 tokens=27
merges=40 seen English  chars=23 bytes=23 tokens= 6 ['the', ' cat', ' sat', ' on', ' the', ' log.']
merges=40 unseen word   chars=10 bytes=10 tokens= 6 [' cat', 'a', 'l', 'og', 'u', 'e']
merges=40 Vietnamese    chars=23 bytes=29 tokens=27 ['c', 'o', 'n', ' m', '<c3>', '<a8>', 'o', …]
```

<details><summary>Full script (prints the output above)</summary>

```python
# Toy BPE trainers: (1) Sennrich et al. Algorithm 1 dictionary, character level with </w>;
# (2) byte-level BPE (base vocabulary = 256 byte values) and what token counts mean.
import collections, re

def merge(word, pair, new):                      # replace every adjacent `pair` in `word` by `new`
    out, i = [], 0
    while i < len(word):
        if i < len(word) - 1 and (word[i], word[i + 1]) == pair:
            out.append(new); i += 2
        else:
            out.append(word[i]); i += 1
    return tuple(out)

def train(word_freqs, n_merges, new_symbol):     # word_freqs: {tuple of symbols: count}
    merges = []
    for i in range(n_merges):
        pairs = collections.Counter()
        for w, f in word_freqs.items():
            for p in zip(w, w[1:]):
                pairs[p] += f                     # pair frequency weighted by word frequency
        if not pairs:
            break
        best = max(pairs, key=pairs.get)          # most frequent pair (first seen wins a tie)
        new = new_symbol(best, i)
        merges.append((best, new, pairs[best]))
        word_freqs = {merge(w, best, new): f for w, f in word_freqs.items()}
    return merges

def encode(word, merges):                          # apply the learned merges in learned order
    for pair, new, _ in merges:
        word = merge(word, pair, new)
    return word

print("== Part 1: Algorithm 1 dictionary, 10 merges ==")
d = {"low": 5, "lower": 2, "newest": 6, "widest": 3}
wf = {tuple(w) + ("</w>",): f for w, f in d.items()}
m1 = train(wf, 10, lambda p, i: p[0] + p[1])
for k, (pair, new, f) in enumerate(m1, 1):
    print(f"merge {k:2d}: {pair[0]!r:>7} + {pair[1]!r:<7} -> {new!r:<10} (pair count {f})")
for w in ["lowest", "lower", "newer", "wider"]:
    print(f"{w:>7} -> {list(encode(tuple(w) + ('</w>',), m1))}")

print("\n== Part 2: byte-level BPE on an English toy corpus ==")
corpus = ("the cat sat on the mat. the dog sat on the log. "
          "a cat and a dog met on the mat and on the log. ") * 20
pretok = lambda text: re.findall(r" ?\S+", text)  # GPT-2 style: a word keeps its leading space
wf2 = collections.Counter(tuple(w.encode("utf-8")) for w in pretok(corpus))
vocab = {i: bytes([i]) for i in range(256)}
def new_id(pair, i):
    vocab[256 + i] = vocab[pair[0]] + vocab[pair[1]]
    return 256 + i
m2 = train(dict(wf2), 40, new_id)
print("first 8 merges:", [vocab[new].decode() for _, new, _ in m2[:8]])
tests = {"seen English": "the cat sat on the log.",
         "unseen word": " catalogue",
         "Vietnamese": "con mèo ngồi trên thảm."}
def show(b):                                       # a lone byte of a multi-byte character -> <hex>
    try: return b.decode("utf-8")
    except UnicodeDecodeError: return "<" + b.hex() + ">"
for n in [0, 10, 40]:
    for name, text in tests.items():
        ids = [t for w in pretok(text) for t in encode(tuple(w.encode("utf-8")), m2[:n])]
        print(f"merges={n:2d} {name:<13} chars={len(text):2d} bytes={len(text.encode()):2d} "
              f"tokens={len(ids):2d} {[show(vocab[t]) for t in ids] if n == 40 else ''}")
```

</details>

Reading it: with no merges, a token is a byte, so the count equals the byte count (23 and 29: `è` is 2 bytes `c3 a8`, `ồ` is 3). After 40 merges the English sentence shrinks from 23 to 6 tokens, almost one per word. The unseen word `catalogue` still encodes, from ` cat`, `og` and single bytes, without any unknown token. The Vietnamese sentence of the same 23 characters stays at 27 tokens, because the training text held no Vietnamese pairs to merge: same length, 4.5 times the tokens.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Character never seen in training, character-level BPE | Becomes `[UNK]` (`"mug"` → `["[UNK]", "ug"]` in the course example) | The base vocabulary is the training characters ✅[^2] |
| Same case, byte-level BPE | Encoded as its UTF-8 bytes; never unknown | Base vocabulary is all 256 bytes ✅[^6]; lab: `è` → `<c3> <a8>` ✅[^10] |
| WordPiece word with one unmatched piece | The whole word becomes `[UNK]`, not just the piece | Longest-match encoding gives up on the word ✅[^3] |
| `"the"` vs `" the"` | Two different tokens | The leading space is part of the GPT-2-style pre-token ✅[^8]; lab merges include both `the` and ` the` ✅[^10] |
| BPE token whose every training occurrence was merged into a longer one (`safeguar` → `safeguard`) | Can be unknown to the model at test time | It never appears in the encoded training text ✅[^1] |
| Two pairs tie for most frequent | The implementation's tie rule decides; results differ across implementations | Lab: first-seen pair wins, `e+s` over `s+t`, both 9 ✅[^10] |
| Same text, two models | Different token counts | Each model has its own vocabulary and merges; vendor measurements in `ai-agents/tokenizers-for-coding-agents.md` |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Larger vocabulary (more merges) | Shorter sequences ✅[^1] | One more learned embedding vector per entry ✅[^11] |
| Character-level BPE | Readable tokens | Unseen characters become `[UNK]` ✅[^2] |
| Byte-level BPE | Nothing is unknown; 256-entry base ✅[^6] | A character absent from training costs one token per UTF-8 byte (2–3 for Vietnamese accented letters in the lab) ✅[^10] |
| WordPiece | Score favours pairs of individually rare parts ✅[^3] | Whole-word `[UNK]` on any unmatched piece ✅[^3] |
| Unigram (with SentencePiece) | Probabilistic, can sample segmentations ✅[^9]; raw-text training, lossless spaces ✅[^5] | Costlier training (loss re-computed per candidate removal) ✅[^4] |

## Takeaways
- Never assume token = word: measure with the model's own tokenizer, on text like yours. [rule-candidate]
- A token budget measured on English text does not hold for other languages or for code; re-measure per language.
- Byte-level BPE never fails to encode, but "can encode" is not "encodes cheaply".
- The vocabulary and merges are part of the model: a model fine-tuned or served with a different tokenizer sees different ids.

## Verification status
- Verified: 51 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- [Neural Machine Translation of Rare Words with Subword Units](https://arxiv.org/html/1508.07909v5) — Sennrich, Haddow, Birch, 2016. Backs: BPE origin, training steps, end-of-word symbol, vocabulary = characters + merges, encoding by applied merges, the `safeguar` case, vocabulary-size vs text-size trade-off. [^1]
- [Byte-Pair Encoding tokenization (LLM Course, chapter 6.5)](https://huggingface.co/learn/llm-course/chapter6/5) — Hugging Face, living. Backs: merges applied in order at encode time, `[UNK]` for unseen characters, byte-level BPE with a 256-entry base. [^2]
- [WordPiece tokenization (LLM Course, chapter 6.6)](https://huggingface.co/learn/llm-course/chapter6/6) — Hugging Face, living. Backs: WordPiece score and its worked numbers, `##` prefix, longest-match encoding, whole-word `[UNK]`, training code never released. [^3]
- [Unigram tokenization (LLM Course, chapter 6.7)](https://huggingface.co/learn/llm-course/chapter6/7) — Hugging Face, living. Backs: top-down pruning, token probability, Viterbi, negative log-likelihood loss, p of 10 or 20. [^4]
- [SentencePiece: A simple and language independent subword tokenizer and detokenizer for Neural Text Processing](https://arxiv.org/html/1808.06226v1) — Kudo, Richardson, 2018. Backs: raw-sentence training, BPE and Unigram support, `▁` (U+2581), lossless tokenization. [^5]
- [Components (Tokenizers docs)](https://huggingface.co/docs/tokenizers/components) — Hugging Face, living. Backs: ByteLevel pre-tokenizer, 256-character alphabet, no unknown token needed. [^6]
- [The tokenization pipeline (Tokenizers docs)](https://huggingface.co/docs/tokenizers/pipeline) — Hugging Face, living. Backs: normalization, pre-tokenization, model, post-processing; only the model is trained. [^7]
- [Normalization and pre-tokenization (LLM Course, chapter 6.4)](https://huggingface.co/learn/llm-course/chapter6/4) — Hugging Face, living. Backs: GPT-2 keeps spaces as `Ġ`. [^8]
- [Subword Regularization: Improving Neural Network Translation Models with Multiple Subword Candidates](https://arxiv.org/html/1804.10959v1) — Kudo, 2018. Backs: the unigram language model segmentation, sampling multiple segmentations in training. [^9]
- `machine-learning/lab-setup.md` — the lab where the BPE merge sequence and the byte-level BPE token counts ran on 2026-11-24. [^10]
- [Attention Is All You Need](https://arxiv.org/html/1706.03762v7) — Vaswani et al., 2017. Backs: self-attention cost per layer `O(n²·d)`; learned embeddings map each token to a vector. [^11]

## Related
- `ai-agents/tokenizers-for-coding-agents.md` — measured token counts per vendor model and the official counting tools.
- `ai-agents/agent-token-accounting.md` — how tokens add up across an agent session.
- `machine-learning/transformers/attention-and-the-transformer.md` — what the model does with the token ids.
- `machine-learning/transformers/pretraining-and-scaling-laws.md` — training data is measured in tokens.
- `machine-learning/transformers/decoding-and-kv-cache.md` — generation picks one vocabulary id at a time.
