---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/speech-and-audio
status: verified
applies-to: ["PyTorch 2.15.0", "numpy 2.5.5"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, speech-and-audio, asr, speech-recognition, ctc, blank-token, alignment, ctc-loss, greedy-decoding, prefix-beam-search, whisper, encoder-decoder, wav2vec-2, self-supervised, wer, cer, text-normalization]
---

# Speech recognition: CTC, encoder–decoders, wav2vec 2.0 and WER

## Summary
**TL;DR:** ASR (automatic speech recognition) maps a long sequence of audio frames to a much shorter transcript without knowing which frames belong to which character. CTC (connectionist temporal classification) lets the model output one symbol per frame, from the vocabulary plus a "blank", defines the transcript as what is left after merging repeats and dropping blanks, and trains on the total probability of every frame-level path (alignment) that yields the right transcript, summed by dynamic programming. Greedy decoding takes the best symbol per frame; a prefix beam search adds up paths and can find a more probable transcript. Attention encoder–decoders such as Whisper instead generate text tokens one at a time, with a decoder that acts as a language model. wav2vec 2.0 pretrains the encoder on unlabeled audio with a contrastive masked-prediction task, then fine-tunes it with CTC on little labeled speech. Recognizers are scored by WER (word error rate), `(substitutions + deletions + insertions) / reference words`, which can exceed 100 %.
**Use this when:** you choose between a CTC model and an encoder–decoder, train or debug a CTC loss (an infinite loss, an all-blank output), decode CTC outputs, read the wav2vec 2.0 or Whisper papers, or compute and compare WER.
**Not this doc:** the input features → `machine-learning/speech-and-audio/audio-signals-and-features.md`; attention and the transformer block → `machine-learning/transformers/attention-and-the-transformer.md`; beam search for text generation → `machine-learning/transformers/decoding-and-kv-cache.md`; contrastive losses in general → `machine-learning/deep-learning/embeddings-and-self-supervised-learning.md`.

## Problem
Speech datasets pair audio with a transcript but generally say nothing about where each word or character occurs in the audio ✅[^1]. The encoder produces far more outputs than the transcript has characters: wav2vec 2.0 emits one hidden state per 20 ms, 50 per second ✅[^1]. A fixed rule such as "one character per ten inputs" fails because people speak at different rates, and aligning every character by hand is prohibitively slow for any reasonably sized dataset ✅[^2]. Predicting one character per frame repeats characters that last longer than a frame, and simply deleting duplicates turns `ERRRRORR` into `EROR` ✅[^1]. Summing over every possible alignment directly is hopeless: for 100 input steps and a 50-character transcript without repeats there are almost `10^40` of them ✅[^2].

## Mental model
**Analogy:** a typist who must press exactly one key per tick of a metronome while listening. She holds a letter's key while its sound lasts, and presses a special "nothing" key during silence and between letters. The transcript is what remains after squashing each run of held keys into one letter and deleting the "nothing" presses, and the "nothing" press between two runs of `l` is what keeps `hello` from becoming `helo`. CTC training does not ask her for one correct key sequence; it rewards every key sequence that squashes to the right transcript.

**Artifact:** CTC by brute force on tiny inputs: the number of valid alignments, the loss as their summed probability, greedy collapse, and a case where greedy decoding misses the most probable transcript. Lab run (`machine-learning/lab-setup.md`), 2026-11-25, PyTorch 2.15.0, two runs identical ✅[^11]:

```text
== 1. valid alignments, by brute force over every path of length T ==
label (1, 2, 3) T=6: 84 valid alignments out of 4096 paths  C(T+U, T-U) = 84
label (1, 1) T=2: 0 valid alignments out of 4 paths
label (1, 1) T=3: 1 valid alignments out of 8 paths
label (1, 1) T=6: 35 valid alignments out of 64 paths
CTCLoss, target (1, 1) with only T=2 frames, zero_infinity=False: inf
CTCLoss, target (1, 1) with only T=2 frames, zero_infinity=True: 0.0
== 2. p(Y|X) = sum over alignments of the product of per-frame probabilities ==
brute force 0.0078599180 | exp(-CTCLoss) 0.0078599180 | alpha recursion 0.0078599180
== 3. greedy decoding collapses the best path ==
 'hh_e_ll_ll_oo' -> 'hello'
   'hheellllloo' -> 'helo'
   '_ER_RRR_ORR' -> 'ERROR'
== 4. greedy vs prefix beam search, T=3 frames, each frame p(_)=0.5, p(a)=0.3, p(b)=0.2 ==
exact p(Y), top 3: [('a', 0.342), ('b', 0.198), ('(empty)', 0.125)]
greedy -> (empty) (p=0.125); prefix beam search, beam 3 -> a (p=0.342)
```

<details><summary>Full script (prints the output above)</summary>

```python
# CTC by brute force: count alignments, check that exp(-CTCLoss) is the sum of their probabilities,
# the forward (alpha) recursion by hand, greedy collapse, and greedy vs prefix beam search.
import collections, itertools, math, torch
torch.manual_seed(0)
BLANK = 0
def collapse(path):                                   # merge repeats, then drop blanks
    out, prev = [], None
    for s in path:
        if s != prev and s != BLANK:
            out.append(s)
        prev = s
    return tuple(out)

print("== 1. valid alignments, by brute force over every path of length T ==")
for label, T, C in (((1, 2, 3), 6, 4), ((1, 1), 2, 2), ((1, 1), 3, 2), ((1, 1), 6, 2)):
    n = sum(collapse(p) == label for p in itertools.product(range(C), repeat=T))
    note = f"  C(T+U, T-U) = {math.comb(T + len(label), T - len(label))}" if len(set(label)) == len(label) else ""
    print(f"label {label} T={T}: {n} valid alignments out of {C ** T} paths{note}")

short = torch.zeros(2, 1, 2, dtype=torch.float64).log_softmax(-1)      # T=2 frames, target (1, 1) needs 3
for zi in (False, True):
    l = torch.nn.CTCLoss(zero_infinity=zi)(short, torch.tensor([[1, 1]]), torch.tensor([2]), torch.tensor([2]))
    print(f"CTCLoss, target (1, 1) with only T=2 frames, zero_infinity={zi}: {l.item()}")

print("== 2. p(Y|X) = sum over alignments of the product of per-frame probabilities ==")
T, C, label = 6, 4, (1, 2, 3)                          # 1, 2, 3 = 'c', 'a', 't'; 0 = blank
logp = torch.randn(T, C, dtype=torch.float64).log_softmax(-1)
brute = sum(math.exp(sum(logp[t, s].item() for t, s in enumerate(p)))
            for p in itertools.product(range(C), repeat=T) if collapse(p) == label)
loss = torch.nn.CTCLoss(blank=BLANK, reduction="sum")(logp[:, None, :], torch.tensor([label]),
                                                      torch.tensor([T]), torch.tensor([len(label)]))
def ctc_forward(logp, label):                         # alpha recursion over z = [_, y1, _, y2, ..., _]
    z = [BLANK] + [v for y in label for v in (y, BLANK)]
    alpha = torch.full((len(z),), -math.inf, dtype=torch.float64)
    alpha[0], alpha[1] = logp[0, z[0]], logp[0, z[1]]  # two valid starts: a blank or y1
    for t in range(1, len(logp)):
        new = torch.full_like(alpha, -math.inf)
        for s in range(len(z)):
            prev = [alpha[s]] + ([alpha[s - 1]] if s >= 1 else [])
            if s >= 2 and z[s] != BLANK and z[s] != z[s - 2]:
                prev.append(alpha[s - 2])             # skip the blank between two different labels
            new[s] = torch.logsumexp(torch.stack(prev), 0) + logp[t, z[s]]
        alpha = new
    return torch.logsumexp(alpha[-2:], 0)              # two valid ends: y_U or the final blank
print(f"brute force {brute:.10f} | exp(-CTCLoss) {math.exp(-loss.item()):.10f} | "
      f"alpha recursion {math.exp(ctc_forward(logp, label).item()):.10f}")

print("== 3. greedy decoding collapses the best path ==")
for path in ("hh_e_ll_ll_oo", "hheellllloo", "_ER_RRR_ORR"):
    print(f"{path!r:>16} -> {''.join(collapse([c if c != '_' else BLANK for c in path]))!r}")

print("== 4. greedy vs prefix beam search, T=3 frames, each frame p(_)=0.5, p(a)=0.3, p(b)=0.2 ==")
probs = [[0.5, 0.3, 0.2]] * 3
exact = collections.Counter()
for p in itertools.product(range(3), repeat=3):
    exact[collapse(p)] += math.prod(probs[t][s] for t, s in enumerate(p))
name = lambda y: "".join("_ab"[s] for s in y) or "(empty)"
print("exact p(Y), top 3:", [(name(y), round(v, 3)) for y, v in exact.most_common(3)])
greedy = collapse([max(range(3), key=lambda c: fr[c]) for fr in probs])
def prefix_beam_search(probs, beam):
    beams = {(): (1.0, 0.0)}                          # prefix -> (p ending in blank, p ending in a label)
    for fr in probs:
        nxt = collections.defaultdict(lambda: [0.0, 0.0])
        for y, (pb, pnb) in beams.items():
            nxt[y][0] += (pb + pnb) * fr[BLANK]
            for c in range(1, len(fr)):
                if y and y[-1] == c:
                    nxt[y][1] += pnb * fr[c]           # repeat with no blank between: same prefix
                    nxt[y + (c,)][1] += pb * fr[c]     # repeat after a blank: a new symbol
                else:
                    nxt[y + (c,)][1] += (pb + pnb) * fr[c]
        beams = dict(sorted(nxt.items(), key=lambda kv: -sum(kv[1]))[:beam])
    best = max(beams, key=lambda y: sum(beams[y]))
    return best, sum(beams[best])
best, score = prefix_beam_search(probs, beam=3)
print(f"greedy -> {name(greedy)} (p={exact[greedy]:.3f}); prefix beam search, beam 3 -> {name(best)} (p={score:.3f})")
```

</details>

## How it works
### The pipeline
1. **Features:** a CNN (convolutional neural network) feature encoder reads the raw waveform, or a log-mel spectrogram is computed first ✅[^3] (`machine-learning/speech-and-audio/audio-signals-and-features.md`). wav2vec 2.0's encoder has seven convolution blocks of 512 channels with strides `(5,2,2,2,2,2,2)` and kernel widths `(10,3,3,3,3,2,2)`: one output about every 20 ms (49 Hz), each seeing 400 input samples, 25 ms of 16 kHz audio ✅[^4]. The strides multiply to `5·2^6 = 320` samples, and `16000/320 = 50` frames per second, while one second holds only `floor((16000 − 400)/320) + 1 = 49` whole 400-sample windows, which matches the paper's 49 Hz.
2. **Encoder:** a transformer encoder (`machine-learning/transformers/attention-and-the-transformer.md`) turns the frames into one hidden state each; models trained with CTC have typically used an RNN (recurrent neural network, `machine-learning/deep-learning/recurrent-networks.md`) for this ✅[^2].
3. **Output head:** either a CTC head, one linear layer from each hidden state to the characters plus blank ✅[^1], or a decoder that generates tokens ✅[^5].
4. **Decoding:** greedy or beam search, optionally with an external language model ✅[^2].
5. **Scoring:** WER on a held-out set, after text normalization ✅[^6].

### CTC: the blank, alignments and the loss
1. **Alignments:** an alignment has one symbol per input frame, drawn from the vocabulary plus the blank `ε`; it maps to a transcript by merging repeats and then removing blanks, and two equal characters in a row must have a blank between them ✅[^2]. In the lab `hh_e_ll_ll_oo` gives `hello` while `hheellllloo` gives `helo` ✅[^11].
2. **Properties:** alignments are monotonic (the next frame keeps the current output or moves to the next) and many-to-one, so the transcript cannot be longer than the input ✅[^2]. Each pair of equal neighbours also needs a blank frame, so `aa` needs at least 3 frames: the lab finds 0 valid alignments for 2 frames and 1 (`a_a`) for 3 ✅[^11].
3. **The loss:** `p(Y|X) = Σ_{A ∈ A(X,Y)} Π_{t=1}^{T} p_t(a_t | X)`, the sum over the valid alignments `A` of the product of the per-frame probabilities, and training minimizes `−log p(Y|X)` ✅[^2]. Here `X` is the input of `T` frames, `Y` the transcript of `U` symbols, `a_t` the alignment's symbol at frame `t`. Without repeats there are `C(T+U, T−U)` alignments, `C(n, k)` being the binomial coefficient "n choose k" ✅[^2]: `C(9, 3) = 84` for `cat` in 6 frames, which the brute force confirms ✅[^11].
4. **Dynamic programming:** write the transcript with blanks around and between its symbols, `Z = [ε, y1, ε, y2, …, ε, yU, ε]`, and let `α_{s,t}` be the total score of all partial alignments that have reached `Z_{1:s}` after `t` frames. `α_{s,t} = (α_{s−1,t−1} + α_{s,t−1})·p_t(z_s)` when `z_s` is a blank or repeats `z_{s−2}`; otherwise a third term `α_{s−2,t−1}` lets the path skip the blank between two different symbols ✅[^2]. There are two valid starts and two valid ends, because the leading and trailing blanks are optional ✅[^2]. In the lab the recursion, the brute-force sum and `exp(−CTCLoss)` all give `0.0078599180` ✅[^11].
5. **Numerics:** compute in log space with log-sum-exp, `log(e^a + e^b) = max(a, b) + log(1 + e^(−|a−b|))`; probabilities multiplied over long inputs underflow ✅[^2].
6. **PyTorch's `nn.CTCLoss`:** takes log-probabilities of shape `(T, N, C)` (frames, batch, classes including blank, for example from `log_softmax`), the blank index (default 0, which targets may not contain), and input and target lengths ✅[^7]. `reduction='mean'` divides each loss by its target length before averaging over the batch; `zero_infinity=True` zeroes the infinite losses that mainly occur when an input is too short to be aligned to its target ✅[^7]; lab: `inf` becomes `0.0` ✅[^11].
7. **Conditional independence:** CTC assumes each output is independent of the others given the input, so a CTC recognizer learns a language model over its output far less well than a model that conditions on earlier outputs; an external language model usually helps, and can be swapped when the domain changes ✅[^2]. In practice a CTC model is acoustic-only and makes phonetic spelling errors: a wav2vec 2.0 checkpoint wrote `CHRISTMAUS` for `CHRISTMAS` and `ROSE` for `ROAST` ✅[^8].
8. **Vocabulary:** CTC works best with a small vocabulary, usually under 50 characters, with one case, digits spelled out and a word-separator token; in wav2vec 2.0 the blank is the padding token ✅[^1].

### Decoding a CTC output
1. **Greedy:** take the most probable symbol at each frame and collapse; this finds the most probable single alignment, not the most probable transcript, because a transcript's probability is spread over many alignments ✅[^2]. In the lab, with every frame at `p(ε) = 0.5`, `p(a) = 0.3`, `p(b) = 0.2`, greedy returns the empty transcript (`p = 0.125`) while `a` has `p = 0.342` ✅[^11].
2. **Prefix beam search:** keep collapsed prefixes instead of alignments, add up the scores of every alignment that maps to the same prefix, and track two numbers per prefix, the probability of alignments ending in a blank and of those ending in a symbol, because only the first may extend `a` into `aa` ✅[^2]. A larger beam trades computation for a better answer, without a guarantee of finding the best one ✅[^2]. With a beam of 3 the lab search returns `a` (`p = 0.342`) ✅[^11]. General beam search for text → `machine-learning/transformers/decoding-and-kv-cache.md`.
3. **Language model:** score `p(Y|X) · p(Y)^α · L(Y)^β`, where `p(Y)` is the language model's probability, `L(Y)` the length in words or characters acting as an insertion bonus, and `α`, `β` weights usually set by cross-validation ✅[^2].

### Attention encoder–decoders (Whisper)
1. **Shape:** an encoder turns the log-mel spectrogram into hidden states; a decoder with cross-attention to them and causal self-attention generates text tokens one at a time from a start token until it predicts an end token ✅[^5]. The decoder plays the role of a language model, is trained with cross-entropy over tokens, and is usually decoded with beam search ✅[^5].
2. **Tokens:** Whisper predicts words and word pieces with the byte-level BPE (byte-pair encoding) tokenizer of GPT-2 (Generative Pre-trained Transformer 2), refitted at the same size for the multilingual models ✅[^9], so its output sequence is much shorter than a character-level CTC output ✅[^5] (`machine-learning/transformers/tokenization.md`).
3. **Data:** 680,000 hours of labeled audio, of which 117,000 hours cover 96 other languages and 125,000 hours are translation into English; audio is cut into 30-second segments with the matching part of the transcript ✅[^9].
4. **Architecture details:** a stem of two convolutions of width 3 with GELU (Gaussian error linear unit) activations, the second with stride 2; sinusoidal position embeddings in the encoder and learned ones in the decoder; encoder and decoder of the same width and depth ✅[^9].
5. **One model, many tasks:** the decoder's prompt is a token sequence: `<|startoftranscript|>`, a language token (99 languages), `<|nospeech|>` for segments without speech, `<|transcribe|>` or `<|translate|>`, `<|notimestamps|>` unless timestamps are wanted (quantized to 20 ms), the text, then `<|endoftranscript|>` ✅[^9].
6. **Long audio:** Whisper transcribes 30-second windows one after another and shifts the window by the predicted timestamps; it decodes with a beam of 5 to reduce repetition loops, and raises the temperature from 0 by 0.2 up to 1.0 whenever the average log probability falls below −1 or the text's gzip compression ratio exceeds 2.4 ✅[^9].
7. **Robustness:** a zero-shot Whisper model and a supervised LibriSpeech model within 0.1 % of each other on LibriSpeech differ elsewhere: averaged over the paper's robustness datasets, Whisper makes 55.2 % fewer errors ✅[^9].

### Self-supervised pretraining: wav2vec 2.0
1. **Mask:** sample 6.5 % of the encoder's time steps as starts and mask the 10 steps after each (spans may overlap), about 49 % of all steps, replacing them with one shared trained vector; the quantizer still sees the unmasked encoder output ✅[^4].
2. **Context network:** a transformer over the partly masked sequence, with a convolution as relative positional embedding ✅[^4].
3. **Targets:** a quantization module turns each encoder output, taken before masking, into a discrete code by product quantization, picking one entry from each of `G = 2` codebooks of `V = 320` entries (up to 102,400 combinations) with a Gumbel softmax and a straight-through gradient ✅[^4].
4. **Contrastive loss:** at each masked step, the context vector must pick the true quantized target out of `K + 1` candidates, the other `K = 100` drawn from other masked steps of the same utterance, scored by cosine similarity divided by a temperature `κ = 0.1` ✅[^4]; this is the InfoNCE (information noise-contrastive estimation) pattern of `machine-learning/deep-learning/embeddings-and-self-supervised-learning.md`. A diversity loss with weight `α = 0.1` pushes the model to use all codebook entries equally often ✅[^4].
5. **Fine-tuning:** add a randomly initialized linear layer to 29 character tokens plus a word boundary, train with CTC, and mask time steps and channels SpecAugment-style ✅[^4].
6. **What it buys:** for the Large model with 53,000 hours of unlabeled audio and only 10 minutes of labeled speech (48 recordings of 12.5 s on average), 4.8 % / 8.2 % WER on LibriSpeech test-clean / test-other; with all 960 labeled hours, 1.8 % / 3.3 %; both decoded with a Transformer language model ✅[^4].

### WER and its relatives
1. **Definition:** align the hypothesis with the reference by word-level edit distance (Levenshtein distance), count substitutions `S`, deletions `D` and insertions `I`, and divide by the reference length `N = S + D + C`, where `C` counts correct words: `WER = (S + D + I) / N` ✅[^10].
2. **Example:** reference `the cat sat on the mat`, hypothesis `the cat sit on the`: one substitution, one deletion, `2/6 = 0.333` ✅[^6] ✅[^11].
3. **Corpus WER:** add `S`, `D`, `I` and `N` over all sentences first, then divide ✅[^6]. The metric card's two-sentence example gives 0.5 ✅[^10]; the lab's hand-written edit distance agrees ✅[^11].
4. **No upper limit:** ten wrong words against a two-word reference give `10/2 = 5`, 500 % ✅[^6] ✅[^11].
5. **CER (character error rate):** the same count over characters; it penalizes a one-letter misspelling less, and it replaces WER for languages written without word boundaries, such as Mandarin and Japanese ✅[^6].
6. **Normalization:** lower-casing and removing punctuation before scoring lowers WER, but the model is not necessarily better for it; the recommendation is to train on fully formatted text and normalize both sides only for scoring ✅[^6]. Whisper's authors saw WER drop by up to 50 % on some datasets from normalization alone, and warn that their normalizer may be fitted to Whisper's own style ✅[^9].
7. **Comparability:** WER depends strongly on the dataset: the metric card quotes 1.8–3.3 on LibriSpeech and 8.3–20.4 on TIMIT ✅[^10].

## Worked example
A whole CTC recognizer, trained from scratch on the CPU. The "speech" is synthetic: five tokens `a`–`e`, each a Hann-shaped tone (400, 700, 1100, 1600, 2300 Hz, with ±3 % pitch jitter) lasting 60–160 ms, separated by noise-only gaps that are at least 20 ms when a token repeats. Features are log-power STFT frames (32 ms windows, 10 ms hop, 129 bins); the model is a 1-D convolution, a bidirectional GRU (gated recurrent unit) and a linear layer to 6 classes (blank + 5); training uses `nn.CTCLoss`, decoding is greedy, and the score is a token error rate computed exactly like WER. The training step:

```python
log_probs = model(x, lengths)                                   # (batch, frames, 6), log_softmax
loss = ctc(log_probs.transpose(0, 1), targets, lengths, target_lengths)   # CTCLoss wants (frames, batch, 6)
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-25, PyTorch 2.15.0, two runs identical ✅[^11]:

```text
1200 train / 200 test utterances; mean 84 frames, mean 5.5 tokens per utterance
step   0  test token error rate S=311 D=1 I=3272 N=1110 -> 3.229
step  75  test token error rate S=0 D=1110 I=0 N=1110 -> 1.000
step 150  test token error rate S=42 D=116 I=55 N=1110 -> 0.192
step 300  test token error rate S=0 D=0 I=1 N=1110 -> 0.001
step 450  test token error rate S=0 D=1 I=1 N=1110 -> 0.002
utterance 1200: reference 'cbccaee' hypothesis 'cbccaee'
  frame path: _________________cccccccccccc______bbbbbbbbbb____ccccccccc______cccccccc_____aaaaaaa_____________ee_________eee__
  frames that are not blank: 51 of 113
== WER = (S + D + I) / N on words ==
course example:       S=1 D=1 I=0 N=6 -> 0.333
metric-card example:  S=3 D=0 I=1 N=8 -> 0.500
longer hypothesis:    S=2 D=0 I=8 N=2 -> 5.000
raw text:             S=8 D=0 I=0 N=8 -> 1.000
lower-case, no punct: S=0 D=0 I=0 N=8 -> 0.000
```

<details><summary>Full script (prints the output above)</summary>

```python
# A tiny CTC recognizer end to end: synthetic "speech" (each token is a noisy tone segment) -> log-power
# STFT frames -> 1-D convolution + bidirectional GRU -> CTC loss -> greedy decoding -> error rate by edit distance.
import re, numpy as np, torch
from torch import nn
torch.manual_seed(0); rng = np.random.default_rng(0)
SR, VOCAB = 8000, "abcde"
TONE = {"a": 400, "b": 700, "c": 1100, "d": 1600, "e": 2300}          # Hz; class id = 1 + index, 0 = blank

def utterance():
    label = "".join(rng.choice(list(VOCAB), size=rng.integers(3, 9)))
    parts = [rng.normal(0, 0.05, int(SR * rng.uniform(0.05, 0.15)))]   # leading silence (noise only)
    for i, ch in enumerate(label):
        n = int(SR * rng.uniform(0.06, 0.16)); tt = np.arange(n) / SR
        f = TONE[ch] * rng.uniform(0.97, 1.03)                          # +-3 % pitch jitter
        parts.append(rng.uniform(0.3, 1.0) * np.hanning(n) * np.sin(2 * np.pi * f * tt) + rng.normal(0, 0.05, n))
        repeat = i + 1 < len(label) and label[i + 1] == ch
        parts.append(rng.normal(0, 0.05, int(SR * (rng.uniform(0.02, 0.06) if repeat else rng.uniform(0, 0.04)))))
    return np.concatenate(parts), label
def features(wave):                                                    # 32 ms Hann windows, 10 ms hop
    X = torch.stft(torch.tensor(wave, dtype=torch.float32), 256, hop_length=80,
                   window=torch.hann_window(256), return_complex=True)
    return torch.log(X.abs() ** 2 + 1e-6).T                            # (frames, 129)
data = [utterance() for _ in range(1400)]
feats = [features(w) for w, _ in data]; labels = [lab for _, lab in data]
mu, sd = torch.cat(feats[:1200]).mean(0), torch.cat(feats[:1200]).std(0)
feats = [(f - mu) / sd for f in feats]
print(f"1200 train / 200 test utterances; mean {np.mean([len(f) for f in feats]):.0f} frames, "
      f"mean {np.mean([len(l) for l in labels]):.1f} tokens per utterance")

class TinyASR(nn.Module):
    def __init__(self, n_in=129, h=64, n_out=len(VOCAB) + 1):
        super().__init__()
        self.conv, self.gru = nn.Conv1d(n_in, h, 5, padding=2), nn.GRU(h, h, batch_first=True, bidirectional=True)
        self.out = nn.Linear(2 * h, n_out)
    def forward(self, x, lengths):                                     # x: (batch, frames, 129)
        h = torch.relu(self.conv(x.transpose(1, 2))).transpose(1, 2)
        h = nn.utils.rnn.pack_padded_sequence(h, lengths, batch_first=True, enforce_sorted=False)
        h, _ = nn.utils.rnn.pad_packed_sequence(self.gru(h)[0], batch_first=True, total_length=x.shape[1])
        return self.out(h).log_softmax(-1)                             # (batch, frames, 1 + 5 classes)
def batch(idx):
    x = nn.utils.rnn.pad_sequence([feats[i] for i in idx], batch_first=True)
    lengths = torch.tensor([len(feats[i]) for i in idx])
    y = torch.tensor([1 + VOCAB.index(c) for i in idx for c in labels[i]])  # concatenated targets
    return x, lengths, y, torch.tensor([len(labels[i]) for i in idx])
def sdi(ref, hyp):                                                     # edit-distance alignment -> (S, D, I)
    D = np.zeros((len(ref) + 1, len(hyp) + 1), int); D[:, 0] = range(len(ref) + 1); D[0] = range(len(hyp) + 1)
    for i in range(1, len(ref) + 1):
        for j in range(1, len(hyp) + 1):
            D[i, j] = min(D[i - 1, j - 1] + (ref[i - 1] != hyp[j - 1]), D[i - 1, j] + 1, D[i, j - 1] + 1)
    i, j, S, Dl, I = len(ref), len(hyp), 0, 0, 0
    while i or j:
        if i and j and D[i, j] == D[i - 1, j - 1] + (ref[i - 1] != hyp[j - 1]):
            S += ref[i - 1] != hyp[j - 1]; i -= 1; j -= 1
        elif i and D[i, j] == D[i - 1, j] + 1:
            Dl += 1; i -= 1
        else:
            I += 1; j -= 1
    return S, Dl, I
def error_rate(refs, hyps):                                            # corpus level: sum S, D, I and N first
    S, Dl, I = np.array([sdi(r, h) for r, h in zip(refs, hyps)]).sum(0); N = sum(len(r) for r in refs)
    return f"S={S} D={Dl} I={I} N={N} -> {(S + Dl + I) / N:.3f}"

def collapse(p):                                                       # merge repeats, drop blanks
    return "".join(VOCAB[c - 1] for k, c in enumerate(p) if c != 0 and (k == 0 or c != p[k - 1]))
def decode_test():                                                     # greedy: best class per frame
    model.eval()
    with torch.no_grad():
        x, xl, _, _ = batch(range(1200, 1400))
        paths = model(x, xl).argmax(-1)
    model.train()
    return [paths[k, :xl[k]].tolist() for k in range(200)]
model, ctc = TinyASR(), nn.CTCLoss(blank=0)
opt = torch.optim.Adam(model.parameters(), lr=3e-3)
for step in range(451):
    if step in (0, 75, 150, 300, 450):
        hyps = [collapse(p) for p in decode_test()]
        print(f"step {step:3d}  test token error rate {error_rate(labels[1200:], hyps)}")
    x, xl, y, yl = batch(rng.choice(1200, 32, replace=False))
    loss = ctc(model(x, xl).transpose(0, 1), y, xl, yl)               # CTCLoss wants (frames, batch, classes)
    opt.zero_grad(); loss.backward(); nn.utils.clip_grad_norm_(model.parameters(), 1.0); opt.step()
paths = decode_test()
print(f"utterance 1200: reference {labels[1200]!r} hypothesis {collapse(paths[0])!r}")
print("  frame path:", "".join("_" if c == 0 else VOCAB[c - 1] for c in paths[0]))
print(f"  frames that are not blank: {sum(c != 0 for c in paths[0])} of {len(paths[0])}")

print("== WER = (S + D + I) / N on words ==")
w = str.split
print("course example:      ", error_rate([w("the cat sat on the mat")], [w("the cat sit on the")]))
print("metric-card example: ", error_rate([w("this is the reference"), w("there is another one")],
                                          [w("this is the prediction"), w("there is an other sample")]))
print("longer hypothesis:   ", error_rate([w("good morning")], [w("one two three four five six seven eight nine ten")]))
norm = lambda s: re.sub(r"[^\w\s]", "", s.lower()).split()
ref, hyp = "HE TELLS US THAT AT THIS FESTIVE SEASON", "He tells us that at this festive season,"
print("raw text:            ", error_rate([w(ref)], [w(hyp)]))
print("lower-case, no punct:", error_rate([norm(ref)], [norm(hyp)]))
```

</details>

Reading it:
- **Step 0:** the untrained model emits many spurious symbols: 3,272 insertions push the error rate to 3.229, above 1, as WER can be.
- **Step 75:** every test output is empty (`D = 1110`, all deletions): at this point the model predicts the blank at every frame.
- **Steps 150–450:** tokens appear and the error rate falls to 0.192, then 0.001–0.002 (2 errors in 1,110 tokens).
- **The frame path:** 51 of 113 frames carry a token and blanks fill the silences and gaps. The repeated `cc` and the final `ee` survive because blanks separate their runs; without those blank frames they would collapse to one `c` and one `e`.
- **WER lines:** the course example (0.333) and the metric card's corpus example (0.500) come out as published; ten words against two give 5.000; and the same eight words score 1.000 or 0.000 depending only on case and punctuation.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Target too long for the input | `CTCLoss` is `inf`; `zero_infinity=True` returns 0 (lab) | No valid alignment exists ✅[^7] ✅[^11] |
| Repeated characters in the target | Each repeat needs one extra blank frame (`aa` needs 3 frames) | A blank must separate equal neighbours ✅[^2] ✅[^11] |
| Encoder subsamples too aggressively | CTC cannot be trained | `T/s` frames must not fall below the transcript length ✅[^2] |
| Early training outputs only blanks | Error rate 1.0, all deletions (lab, step 75); gone by step 150 in the lab run | Most frames should be blank: 62 of the 113 frames in the decoded example path are ✅[^11] |
| Greedy and beam search disagree | Greedy can return a less probable transcript (lab: empty vs `a`) | Greedy picks one alignment, not the transcript with the largest sum ✅[^2] ✅[^11] |
| Testing a CTC beam search | Its score for the found transcript should be at most, and close to, the true CTC score | The beam keeps only part of the alignments ✅[^2] |
| CTC model output looks phonetic | `CHRISTMAUS`, `ROSE` for `ROAST`; no casing or punctuation | Acoustic-only head; conditional independence ✅[^8] ✅[^2] |
| `CTCLoss` on a GPU (graphics processing unit) with cuDNN, the GPU deep-neural-network library | May pick a nondeterministic algorithm; cuDNN needs concatenated targets, all input lengths `T`, blank 0, target lengths ≤ 256, `int32` lengths and `float32` inputs | Requirements and behaviour of PyTorch's cuDNN path ✅[^7] |
| Whisper on audio longer than 30 s | Must be cut into windows; one bad window can derail the next | Trained on 30-second chunks; windows shift by predicted timestamps ✅[^9] |
| Whisper inventing speaker names | Plausible but wrong names in the transcript, removed by a short fine-tune | Many training transcripts named the speaker ✅[^9] |
| Encoder–decoder decoding goes wrong | Repetitions or skipped words | Each token depends on the tokens already generated ✅[^5] |
| WER above 100 % | Possible | Insertions are not bounded by `N` ✅[^6] |
| WER across datasets or normalizers | Not comparable | Dataset difficulty and normalization change WER a lot ✅[^10] ✅[^9] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| CTC head on a pretrained encoder (wav2vec 2.0) | Small and fast; fine-tuning on as little as 10 minutes of labeled speech ✅[^8]; easy to swap in a new language model ✅[^2] | Phonetic spelling errors, no casing or punctuation ✅[^8]; no output dependencies ✅[^2] |
| Encoder–decoder (Whisper) | Decoder acts as a language model; cased, punctuated, robust transcripts ✅[^8] ✅[^9] | Slower step-by-step decoding; much more training data needed ✅[^8] |
| Greedy CTC decoding | One pass, no search | Misses transcripts whose probability is spread over many alignments ✅[^2] |
| Prefix beam search with a language model | Usually a good boost in accuracy ✅[^2] | More computation; `α`, `β` to tune ✅[^2] |
| WER vs CER | WER asks the system to get whole words, tense included, right ✅[^6] | WER is meaningless without word boundaries; CER forgives misspellings ✅[^6] |

## Takeaways
- Check `T ≥ U + (number of equal neighbours)` for every training pair before blaming the model for an infinite CTC loss. [rule-candidate]
- An all-blank output early in CTC training is not by itself a bug (in the lab run it was gone by step 150); judge the model after more steps.
- Report WER with its dataset, its normalizer and corpus-level aggregation; never compare raw and normalized numbers. [rule-candidate]
- Prefer a pretrained encoder plus CTC when labeled audio is scarce and latency matters; prefer an encoder–decoder when formatted, robust transcripts matter more than speed.

## Verification status
- Verified: 95 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [CTC architectures (Audio Course, unit 3)](https://huggingface.co/learn/audio-course/chapter3/ctc) — Hugging Face, living. Backs: no timing in ASR datasets, 20 ms hidden states, duplicate characters, the `ERROR` example, the CTC head, small vocabularies, blank = padding token. [^1]
- [Sequence Modeling With CTC](https://distill.pub/2017/ctc/) — Hannun, Distill, 2017. Backs: the alignment problem, collapsing rules, alignment count, the loss and its recursion, log-space computation, greedy vs prefix beam search, language-model scoring, conditional independence, the subsampling limit, beam-search checks. [^2]
- [Transformer architectures for audio (Audio Course, unit 3)](https://huggingface.co/learn/audio-course/chapter3/introduction) — Hugging Face, living. Backs: waveform and spectrogram front ends. [^3]
- [wav2vec 2.0: A Framework for Self-Supervised Learning of Speech Representations](https://ar5iv.labs.arxiv.org/html/2006.11477) — Baevski, Zhou, Mohamed, Auli, 2020 (ar5iv HTML of arXiv:2006.11477). Backs: feature encoder, masking, context network, product quantization, contrastive and diversity losses, CTC fine-tuning, results. [^4]
- [Seq2Seq architectures (Audio Course, unit 3)](https://huggingface.co/learn/audio-course/chapter3/seq2seq) — Hugging Face, living. Backs: the encoder–decoder recognizer, cross-attention, autoregressive decoding, decoder as language model, cross-entropy and beam search, shorter token outputs, repetitions and skips. [^5]
- [Evaluation metrics for ASR (Audio Course, unit 5)](https://huggingface.co/learn/audio-course/chapter5/evaluation) — Hugging Face, living. Backs: the WER example, corpus aggregation, no upper bound, CER, normalization advice. [^6]
- [torch.nn.CTCLoss](https://docs.pytorch.org/docs/2.15/generated/torch.nn.CTCLoss.html) — PyTorch, 2026 (2.15). Backs: input shapes, blank, reductions, `zero_infinity`, cuDNN conditions and nondeterminism. [^7]
- [Pre-trained models for automatic speech recognition (Audio Course, unit 5)](https://huggingface.co/learn/audio-course/chapter5/asr_models) — Hugging Face, living. Backs: CTC vs seq2seq, phonetic spelling errors, 10-minute fine-tuning, seq2seq costs. [^8]
- [Robust Speech Recognition via Large-Scale Weak Supervision](https://ar5iv.labs.arxiv.org/html/2212.04356) — Radford et al., 2022 (ar5iv HTML of arXiv:2212.04356). Backs: Whisper's data, tokenizer, architecture, multitask tokens, long-form decoding, effective robustness, normalization effects, speaker-name guesses. [^9]
- [Metric card for WER (evaluate v0.4.3)](https://github.com/huggingface/evaluate/blob/v0.4.3/metrics/wer/README.md) — Hugging Face, 2024. Backs: WER definition from Levenshtein alignment, `N = S + D + C`, the two-sentence example, dataset dependence. [^10]
- `machine-learning/lab-setup.md` — the lab where the CTC brute-force checks and the tiny CTC recognizer with WER ran on 2026-11-25. [^11]

## Related
- `machine-learning/speech-and-audio/audio-signals-and-features.md` — the log-mel features and SpecAugment these models train on.
- `machine-learning/speech-and-audio/speech-synthesis-and-audio-generation.md` — the reverse direction, and audio tokens from codecs.
- `machine-learning/transformers/attention-and-the-transformer.md` — the encoder and decoder blocks.
- `machine-learning/transformers/decoding-and-kv-cache.md` — beam search and sampling for autoregressive decoders.
- `machine-learning/deep-learning/embeddings-and-self-supervised-learning.md` — contrastive learning, the idea behind wav2vec 2.0's loss.
- `machine-learning/deep-learning/recurrent-networks.md` — the GRU in the worked example.
