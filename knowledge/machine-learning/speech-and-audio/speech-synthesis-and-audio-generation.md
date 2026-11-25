---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/speech-and-audio
status: verified
applies-to: ["PyTorch 2.15.0", "numpy 2.5.5", "scikit-learn 1.9.1"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, speech-and-audio, tts, text-to-speech, tacotron-2, vocoder, wavenet, mu-law, hifi-gan, neural-audio-codec, residual-vector-quantization, soundstream, encodec, audiolm, audio-tokens, mos, mushra]
---

# Speech synthesis and audio generation: vocoders, neural codecs and audio tokens

## Summary
**TL;DR:** Most neural TTS (text-to-speech) systems work in two stages: an acoustic model turns text into a mel spectrogram, a compact low-resolution picture of the sound, and a vocoder turns that into a waveform of tens of thousands of samples per second. WaveNet is autoregressive: it predicts each sample from the previous ones with dilated causal convolutions and a softmax over 256 μ-law levels, which sounds natural but costs one network pass per sample. GAN (generative adversarial network) vocoders such as HiFi-GAN produce all samples in parallel, trained against discriminators that look at the waveform at several periods and scales, plus a mel-spectrogram loss. Neural audio codecs (SoundStream, EnCodec) compress audio into a few discrete tokens per frame with RVQ (residual vector quantization), each codebook encoding what the previous ones missed; the bitrate is frames per second × codebooks × bits per codebook. A language model over such tokens can generate audio (AudioLM). Quality is judged by listeners, as a MOS (mean opinion score, 1 to 5) or a MUSHRA (multiple stimuli with hidden reference and anchor) score, because one text has many valid spoken forms.
**Use this when:** you choose or debug a TTS pipeline or vocoder, read "24 kbps with 32 codebooks" or "MOS 4.36 ± 0.07", need the cost of autoregressive audio generation, or want to know what audio tokens are.
**Not this doc:** mel spectrograms and the STFT → `machine-learning/speech-and-audio/audio-signals-and-features.md`; the GAN game and its failure modes → `machine-learning/generative-models/generative-adversarial-networks.md`; diffusion models → `machine-learning/generative-models/diffusion-models.md`; sampling strategies and the KV (key–value) cache for token models → `machine-learning/transformers/decoding-and-kv-cache.md`.

## Problem
Text-to-speech is one-to-many: the same sentence can be spoken with different emphasis, so a training loss such as L1 or MSE (mean squared error) on spectrograms says little about quality, and models are judged by human listeners instead ✅[^1]. The output is long and precise, up to 24,000 samples per second at up to 16-bit fidelity ✅[^2], and a softmax over every 16-bit value would need 65,536 probabilities per sample ✅[^3]. Generating one sample per network pass, as the autoregressive WaveNet does, is prohibitively slow at that resolution ✅[^2]. The usual intermediate, the mel spectrogram, drops even more information than a linear spectrogram, which already lacks the phase, so getting a waveform back is a hard inverse problem ✅[^4]. Compressing audio into discrete tokens with a single codebook breaks down at once: 6 kbps (kilobits per second) at 75 frames per second is 80 bits per frame, a codebook of `2^80` vectors ✅[^5].

## Mental model
**Analogy:** a composer and a performer. The acoustic model writes a piano-roll score (the mel spectrogram); the vocoder performs it. The WaveNet performer plays one instant at a time, always listening to what she just played; the HiFi-GAN performer plays the whole bar at once, coached by critics who each listen only to every 2nd, 3rd, 5th, 7th or 11th instant. A neural codec is directions given in stages: "in Paris" (codebook 1), "then 3 km north-east" (codebook 2), "then 40 m west" (codebook 3); each stage corrects the error left by the ones before, so adding stages adds bits and precision.

**Artifact:** residual vector quantization of 32-dimensional feature frames with k-means codebooks (`machine-learning/unsupervised-learning/k-means-clustering.md`), and codec bitrates as plain arithmetic. Lab run (`machine-learning/lab-setup.md`), 2026-11-25, scikit-learn 1.9.1, two runs identical ✅[^12]:

```text
== 1. residual vector quantization of 32-dim feature frames (smooth envelopes + noise) ==
1 codebook(s) x 8 bits =  8 bits/frame: relative squared error 0.135
2 codebook(s) x 8 bits = 16 bits/frame: relative squared error 0.047
4 codebook(s) x 8 bits = 32 bits/frame: relative squared error 0.013
8 codebook(s) x 8 bits = 64 bits/frame: relative squared error 0.004
same 8 bits/frame split differently:
  1 x 256 entries: relative error 0.135, 256 codebook vectors stored
  2 x  16 entries: relative error 0.162,  32 codebook vectors stored
  4 x   4 entries: relative error 0.195,  16 codebook vectors stored
  8 x   2 entries: relative error 0.215,  16 codebook vectors stored
== 2. bitrate = frames per second x codebooks x bits per codebook ==
SoundStream example: 24 kHz / stride 320 = 75 frames/s; 6000 bps / 75 = 80 bits/frame = 8 codebooks x log2(1024) = 80
EnCodec 24 kHz, 1024-entry codebooks: {2: '1.5 kbps', 4: '3 kbps', 8: '6 kbps', 16: '12 kbps', 32: '24 kbps'}
AudioLM: acoustic 50 frames/s x 12 x 10 = 6000 bps, 600 tokens/s; semantic 25/s x 10 = 250 bps
```

<details><summary>Full script (prints the output above)</summary>

```python
# Residual vector quantization of feature frames: k-means codebooks fitted on residuals, error vs number of
# codebooks, depth vs codebook size at a fixed bit budget, and codec bitrate arithmetic.
import math, numpy as np
from sklearn.cluster import KMeans
rng = np.random.default_rng(0)

print("== 1. residual vector quantization of 32-dim feature frames (smooth envelopes + noise) ==")
def frames(n):
    i = np.arange(32); X = rng.normal(0, 0.05, (n, 32))
    for _ in range(3):
        c, w, h = rng.uniform(0, 32, (n, 1)), rng.uniform(1.5, 5, (n, 1)), rng.uniform(0.5, 2, (n, 1))
        X += h * np.exp(-0.5 * ((i - c) / w) ** 2)
    return X
Xtr, Xte = frames(10000), frames(2000)
def rvq(stages, size):                                 # fit each codebook on the residual of the previous ones
    books, res = [], Xtr.copy()
    for s in range(stages):
        km = KMeans(size, n_init=1, max_iter=50, random_state=s).fit(res)
        books.append(km.cluster_centers_); res = res - km.cluster_centers_[km.labels_]
    return books
def relative_error(books, n_used):                     # encode the test frames with the first n_used books
    res = Xte.copy()
    for B in books[:n_used]:
        res = res - B[((res[:, None, :] - B[None]) ** 2).sum(-1).argmin(1)]
    return (res ** 2).sum() / ((Xte - Xtr.mean(0)) ** 2).sum()
books = rvq(8, 256)
for n in (1, 2, 4, 8):
    print(f"{n} codebook(s) x 8 bits = {8 * n:2d} bits/frame: relative squared error {relative_error(books, n):.3f}")
print("same 8 bits/frame split differently:")
for stages, size in ((1, 256), (2, 16), (4, 4), (8, 2)):
    print(f"  {stages} x {size:3d} entries: relative error {relative_error(rvq(stages, size), stages):.3f}, "
          f"{stages * size:3d} codebook vectors stored")

print("== 2. bitrate = frames per second x codebooks x bits per codebook ==")
print("SoundStream example: 24 kHz / stride 320 =", 24000 // 320, "frames/s; 6000 bps / 75 =", 6000 // 75,
      "bits/frame = 8 codebooks x log2(1024) =", 8 * int(math.log2(1024)))
print("EnCodec 24 kHz, 1024-entry codebooks:", {n: f"{75 * n * 10 / 1000:g} kbps" for n in (2, 4, 8, 16, 32)})
print("AudioLM: acoustic 50 frames/s x 12 x 10 =", 50 * 12 * 10, "bps,", 50 * 12, "tokens/s; semantic 25/s x 10 =",
      25 * 10, "bps")
```

</details>

## How it works
### The two-stage TTS pipeline
1. **Two stages:** most neural speech synthesis first predicts a low-resolution intermediate, a mel spectrogram or linguistic features, from text, then synthesizes the waveform from it ✅[^2]. Mel spectrograms are a simpler, lower-level representation than linguistic features, so a WaveNet conditioned on them can act as a neural vocoder ✅[^4].
2. **Tacotron 2's acoustic model:** characters become 512-dimensional embeddings, pass three convolution layers (512 filters spanning 5 characters) and one bidirectional LSTM (long short-term memory) layer of 512 units; a decoder with location-sensitive attention predicts mel frames one at a time ✅[^4]. A 5-layer convolutional post-net predicts a residual added to the prediction, and the loss is the summed MSE before and after the post-net ✅[^4]. A "stop token" probability ends generation at the first frame where it exceeds 0.5 ✅[^4].
3. **Transformer variant:** SpeechT5 starts decoding from an all-zero spectrogram frame, also predicts a stop probability, refines with a post-net, and leaves the waveform to a separately trained vocoder ✅[^1]; speaker embeddings such as x-vectors pick the voice ✅[^6].
4. **Train the vocoder on what it will see:** a WaveNet trained on ground-truth mel spectrograms and run on predicted ones scored MOS 4.362, against 4.526 when trained on predicted ones; predicted spectrograms are oversmoothed because the acoustic model minimizes squared error ✅[^4].
5. **Result:** Tacotron 2 with a WaveNet vocoder reached MOS 4.53, against 4.58 for professionally recorded speech ✅[^4].

### Autoregressive vocoders: WaveNet
1. **Factorization:** `p(x) = Π_{t=1}^{T} p(x_t | x_1, …, x_{t−1})`, each factor a softmax over the next sample's value ✅[^3]; conditioning adds an input `h`, `p(x_t | x_1, …, x_{t−1}, h)` ✅[^3].
2. **μ-law companding:** `f(x) = sign(x)·ln(1 + μ·|x|) / ln(1 + μ)` with `−1 < x < 1` and `μ = 255`, then quantization to 256 values, which reconstructs much better than linear quantization ✅[^3]. Example: `x = 0.01` gives `ln(3.55)/ln(256) = 0.228`, so a sample at 1 % of full scale already uses 23 % of the code range. In the lab, 8-bit μ-law keeps 33.7–37.5 dB SNR (signal-to-noise ratio) from full scale down to 1 %, while 8-bit linear falls from 49.4 to 11.1 dB ✅[^12].
3. **Causal convolutions:** the prediction at step `t` cannot depend on later samples; training predicts all steps in parallel because the true samples are known, but generation is sequential, each new sample fed back as input ✅[^3].
4. **Dilated convolutions:** each layer skips inputs with a step (the dilation), doubled per layer up to a limit and repeated, `1, 2, 4, …, 512, 1, 2, 4, …, 512, …`; one `1…512` block has a receptive field of 1,024 samples ✅[^3].
5. **Gated units and conditioning:** each layer computes `z = tanh(W_f ∗ x) ⊙ σ(W_g ∗ x)`, a tanh "filter" times a sigmoid "gate" (`∗` convolution, `⊙` element-wise product), which worked better than ReLU (rectified linear unit) for audio ✅[^3]. Global conditioning (for example a speaker embedding) influences every time step; local conditioning (linguistic features in the paper) is upsampled by transposed convolutions to the audio rate ✅[^3]; Tacotron 2's WaveNet vocoder is conditioned on mel frames instead, through a stack of 2 upsampling layers matched to its 12.5 ms hop ✅[^4].
6. **Quality:** in US English, WaveNet scored MOS 4.21, against 3.67 and 3.86 for the two baselines and 4.55 for natural 16-bit speech ✅[^3]. Its 240 ms receptive field was too short for the long-term dependencies of pitch contours, which sometimes gave unnatural prosody ✅[^3].
7. **Cost:** in HiFi-GAN's benchmark, a WaveNet with a mixture-of-logistics output generated 0.07 kHz, that is 70 samples per second, on a GPU (graphics processing unit): 0.003 times real time ✅[^2].

### GAN vocoders: HiFi-GAN
1. **Generator:** fully convolutional; it upsamples the mel spectrogram with transposed convolutions until the output reaches the waveform's resolution, each followed by an MRF (multi-receptive field fusion) module that sums residual blocks with different kernel sizes and dilations ✅[^2].
2. **Multi-period discriminator (MPD):** several sub-discriminators, each seeing only equally spaced samples, with periods `[2, 3, 5, 7, 11]` chosen to overlap as little as possible; audio of length `T` is reshaped to `T/p × p` and processed by 2-D convolutions of width 1 along the period axis ✅[^2]. The reshape in miniature: a signal with a 5-sample period has constant columns only when `p = 5` ✅[^12]:

```text
== multi-period discriminator input: reshape 1-D audio of length T to (T/p, p) ==
p= 2: shape (165, 2), mean spread down a column 0.479
p= 3: shape (110, 3), mean spread down a column 0.479
p= 5: shape (66, 5), mean spread down a column 0.010
p= 7: shape (47, 7), mean spread down a column 0.478
p=11: shape (30, 11), mean spread down a column 0.479
```

<details><summary>Full script (prints the output above)</summary>

```python
# The input of HiFi-GAN's multi-period discriminator: 1-D audio reshaped to (T/p, p) for prime periods p.
import numpy as np
rng = np.random.default_rng(0)
print("== multi-period discriminator input: reshape 1-D audio of length T to (T/p, p) ==")
x = np.tile([0.0, 0.5, 1.0, 0.5, -0.4], 66)[:330] + rng.normal(0, 0.01, 330)   # period 5 samples
for p in (2, 3, 5, 7, 11):
    grid = x[: len(x) // p * p].reshape(-1, p)         # column j holds samples j, j + p, j + 2p, ...
    print(f"p={p:2d}: shape {grid.shape}, mean spread down a column {grid.std(0).mean():.3f}")
```

</details>

3. **Multi-scale discriminator (MSD):** three sub-discriminators, from MelGAN, on the raw audio and on ×2 and ×4 average-pooled audio, to judge consecutive samples ✅[^2].
4. **Losses:** least-squares GAN losses (LSGAN) instead of binary cross-entropy, plus an L1 distance between the mel spectrograms of generated and real audio (weight 45) and a feature-matching loss on discriminator features (weight 2) ✅[^2]. The adversarial game itself → `machine-learning/generative-models/generative-adversarial-networks.md`.
5. **Results on LJSpeech** (13,100 clips, about 24 hours, one speaker, 22 kHz) ✅[^2]: version V1 (13.92 M parameters) scored MOS 4.36 against 4.45 for the recordings and 4.02 for the WaveNet, at 167.86 times real time on one V100 GPU; the 1.46 M-parameter V3 ran 13.44 times real time on a CPU (central processing unit) ✅[^2]. Removing the MPD caused a significant quality drop, and adding it to MelGAN raised MelGAN's MOS by 0.47 ✅[^2].

### Neural audio codecs and residual vector quantization
1. **Shape:** SoundStream is a convolutional encoder, a residual vector quantizer and a decoder, trained end to end with reconstruction and adversarial losses ✅[^5]. Its encoder strides multiply to `2·4·5·8 = 320` samples, so one frame is 13.3 ms of 24 kHz audio ✅[^5], 75 frames per second ✅[^5].
2. **Plain VQ (vector quantization):** a codebook of `N` vectors encodes each frame as the index of its nearest vector, `log2 N` bits ✅[^5]; that is why 80 bits per frame would need `2^80` vectors ✅[^5].
3. **RVQ:** quantize the frame with codebook 1, quantize what is left (the residual) with codebook 2, and so on through `N_q` codebooks; the decoder sums the chosen vectors ✅[^5]. Bits per frame are `N_q · log2 N`, so 80 bits are 8 codebooks of 1,024 ✅[^5]. In the lab, each added 8-bit codebook cuts the error: 0.135, 0.047, 0.013, 0.004 for 1, 2, 4, 8 codebooks ✅[^12].
4. **Depth vs codebook size:** at a fixed bitrate, fewer quantizers with larger codebooks code most efficiently but cost more computation, and a chain of 80 one-bit quantizers degraded quality only modestly ✅[^5]. The lab shows the same direction at 8 bits per frame: 1 × 256 entries gives 0.135, 8 × 2 gives 0.215, with 256 against 16 stored vectors ✅[^12].
5. **Learning the codebooks:** SoundStream updates codebook vectors by exponential moving average, starts them from k-means on the first batch, and replaces vectors unused for several batches with random frames from the batch ✅[^5]; EnCodec uses the same procedure, a straight-through estimator for the encoder's gradient, and a commitment loss (MSE between the quantizer's input and output) ✅[^7].
6. **One model, many bitrates:** quantizer dropout samples a number of codebooks `n_q` between 1 and `N_q` for each training example, so a single model decodes from any prefix of the codebooks; it may also act as a regularizer ✅[^5].
7. **Results:** SoundStream at 3 kbps outperformed Opus at 6 kbps and EVS (Enhanced Voice Services) at 5.9 kbps in listening tests ✅[^5]. EnCodec runs at 1.5, 3, 6, 12 and 24 kbps at 24 kHz with up to 32 codebooks of 1,024 entries (10 bits each) at 75 steps per second, and a small transformer language model over the codes cuts the bandwidth by about 25–40 % through entropy coding ✅[^7]; the arithmetic `75 × 2 × 10 = 1.5 kbps`, `75 × 32 × 10 = 24 kbps` is in the artifact ✅[^12].

### Audio tokens and language models: AudioLM
1. **Two kinds of tokens:** semantic tokens are k-means cluster ids (`K = 1024`) of layer-7 embeddings of a self-supervised speech model, w2v-BERT, at 25 Hz, 250 bits per second; acoustic tokens are SoundStream codes, 12 quantizers of 1,024 entries at 50 Hz for 16 kHz audio, 6,000 bits and 600 tokens per second ✅[^8]. Acoustic tokens reconstruct audio well but separate phonemes poorly; semantic tokens do the opposite ✅[^8].
2. **Three stages:** a decoder-only transformer generates semantic tokens for long-term structure; a second generates the coarse acoustic tokens (the first 4 quantizers) conditioned on them; a third generates the fine ones (the other 8) ✅[^8]. The coarse levels carry speaker identity and recording conditions, the fine levels the remaining detail, which follows from residual quantization ✅[^8].
3. **Continuations:** from a 3-second prompt of an unseen speaker, AudioLM continues in the same voice; raters told original from generated speech 51.2 % of the time, not significantly different from guessing (binomial test, p-value 0.23), so the authors trained a classifier that detects AudioLM speech ✅[^8].

### Judging quality
1. **MOS:** listeners rate naturalness on a five-point scale (1 Bad, 2 Poor, 3 Fair, 4 Good, 5 Excellent), and the mean is reported ✅[^3]; Tacotron 2 had each sample rated by at least 8 raters, in steps of 0.5, and models were rated independently of each other ✅[^4]; HiFi-GAN reports 95 % confidence intervals ✅[^2]. ITU-T (the International Telecommunication Union's standardization sector) keeps the MOS vocabulary in Recommendation P.800.1, "Mean opinion score (MOS) terminology" ✅[^9].
2. **Why listeners:** speech perception is subjective, so no single objective number captures pronunciation, intonation, naturalness and clarity; MOS itself varies between raters ✅[^10].
3. **MUSHRA:** listeners compare several versions of the same excerpt, including a hidden reference and a low-quality anchor, and score each from 1 to 100 ✅[^7]; SoundStream used a crowd-sourced variant with a hidden reference but no low-pass anchor, 20 ratings per sample ✅[^5].
4. **Objective proxies:** SoundStream selects models with ViSQOL (Virtual Speech Quality Objective Listener), a freely available objective metric that SoundStream's authors found, in early experiments, strongly correlated with their listening tests ✅[^5]; AudioLM also reports ViSQOL, the WER (word error rate) of a recognizer on generated speech, and a speaker classifier's accuracy ✅[^8].

## Worked example
WaveNet in miniature, end to end: 2 seconds of synthetic audio sampled at 8 kHz (a 220 Hz tone plus a weaker 660 Hz partial under a slow 1.5 Hz loudness swell) is μ-law encoded to 256 classes, a 6-layer gated causal CNN (convolutional neural network) with dilations 1–32 (receptive field 64 samples) is trained with teacher forcing to predict the next class, and then generates 2,000 samples one at a time from a 64-sample seed. The heart of it:

```python
hp = F.pad(h, (d, 0))                                  # pad only on the left: the layer never sees the future
h = h + r(torch.tanh(f(hp)) * torch.sigmoid(g(hp)))    # gated unit, residual connection
loss = F.cross_entropy(model(crop[:, :-1]), crop[:, 1:])   # 512 next-sample predictions in one pass
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-25, PyTorch 2.15.0, two runs identical ✅[^12]:

```text
== 1. 8-bit quantization: mu-law (mu = 255) vs linear, SNR in dB ==
sine amplitude  0.9: linear  49.4 | mu-law  37.2
sine amplitude  0.1: linear  29.8 | mu-law  37.5
sine amplitude 0.01: linear  11.1 | mu-law  33.7
== 2. tiny WaveNet: dilated causal convolutions, gated units, softmax over 256 mu-law classes ==
receptive field 64 samples; uniform guess 8.00 bits; no-context (marginal histogram) 7.06 bits
step   0  held-out cross-entropy 8.19 bits per sample
step 100  held-out cross-entropy 6.21 bits per sample
step 200  held-out cross-entropy 4.44 bits per sample
step 300  held-out cross-entropy 3.82 bits per sample
step 400  held-out cross-entropy 3.72 bits per sample
generated 2000 samples with 2000 sequential forward passes
  generated (0.25 s): peak 216 Hz, 660/220 level ratio 0.21, RMS 0.298
  training (all 2 s): peak 220 Hz, 660/220 level ratio 0.50, RMS 0.262
```

<details><summary>Full script (prints the output above)</summary>

```python
# WaveNet in miniature: mu-law companding to 256 classes, dilated causal convolutions with gated units,
# teacher-forced training on a synthetic waveform, then sample-by-sample generation.
import math, numpy as np, torch
from torch import nn
from torch.nn import functional as F
torch.manual_seed(0); rng = np.random.default_rng(0)
MU = 255

def mulaw_encode(x):                                   # [-1, 1] -> 256 class ids
    y = np.sign(x) * np.log1p(MU * np.abs(x)) / np.log1p(MU)
    return np.clip(np.round((y + 1) / 2 * MU), 0, MU).astype(np.int64)
def mulaw_decode(q):
    y = 2 * q / MU - 1
    return np.sign(y) * ((1 + MU) ** np.abs(y) - 1) / MU
def linear8(x):                                        # 256 evenly spaced levels on [-1, 1)
    return np.clip(np.round(x * 128), -128, 127) / 128
print("== 1. 8-bit quantization: mu-law (mu = 255) vs linear, SNR in dB ==")
tt = np.arange(8000) / 8000
for amp in (0.9, 0.1, 0.01):
    x = amp * np.sin(2 * np.pi * 220 * tt)
    snr = lambda xq: 10 * np.log10(np.mean(x ** 2) / np.mean((xq - x) ** 2))
    print(f"sine amplitude {amp:4}: linear {snr(linear8(x)):5.1f} | mu-law {snr(mulaw_decode(mulaw_encode(x))):5.1f}")

print("== 2. tiny WaveNet: dilated causal convolutions, gated units, softmax over 256 mu-law classes ==")
SR = 8000; t = np.arange(2 * SR) / SR                  # 2 s: two partials under a slow loudness swell
wave = (0.6 + 0.4 * np.sin(2 * np.pi * 1.5 * t)) * (0.5 * np.sin(2 * np.pi * 220 * t) + 0.25 * np.sin(2 * np.pi * 660 * t + 1))
wave += rng.normal(0, 0.001, len(t))
q = torch.tensor(mulaw_encode(wave)); train_q, test_q = q[:14000], q[14000:]
class TinyWaveNet(nn.Module):
    def __init__(self, ch=32, dilations=(1, 2, 4, 8, 16, 32)):
        super().__init__()
        self.dil, self.emb = dilations, nn.Embedding(256, ch)
        self.filt = nn.ModuleList(nn.Conv1d(ch, ch, 2, dilation=d) for d in dilations)
        self.gate = nn.ModuleList(nn.Conv1d(ch, ch, 2, dilation=d) for d in dilations)
        self.res = nn.ModuleList(nn.Conv1d(ch, ch, 1) for _ in dilations)
        self.out = nn.Sequential(nn.ReLU(), nn.Conv1d(ch, 256, 1))
    def forward(self, q):                              # output at t = logits for the sample at t + 1
        h = self.emb(q).transpose(1, 2)
        for d, f, g, r in zip(self.dil, self.filt, self.gate, self.res):
            hp = F.pad(h, (d, 0))                      # pad on the left only: causal
            h = h + r(torch.tanh(f(hp)) * torch.sigmoid(g(hp)))
        return self.out(h)
model = TinyWaveNet(); RF = 1 + sum(model.dil)
opt = torch.optim.Adam(model.parameters(), lr=1e-3)
def bits(seq):                                         # teacher-forced cross-entropy, bits per sample
    with torch.no_grad():
        return F.cross_entropy(model(seq[None, :-1]), seq[None, 1:]).item() / math.log(2)
counts = np.bincount(train_q.numpy(), minlength=256) / len(train_q)
print(f"receptive field {RF} samples; uniform guess 8.00 bits; no-context (marginal histogram) "
      f"{-(counts[counts > 0] * np.log2(counts[counts > 0])).sum():.2f} bits")
for step in range(401):
    if step % 100 == 0:
        print(f"step {step:3d}  held-out cross-entropy {bits(test_q):.2f} bits per sample")
    starts = rng.integers(0, len(train_q) - 513, 16)
    crop = torch.stack([train_q[s:s + 513] for s in starts])
    loss = F.cross_entropy(model(crop[:, :-1]), crop[:, 1:])  # all 512 next-sample predictions in one pass
    opt.zero_grad(); loss.backward(); opt.step()
gen, g, passes = test_q[:RF].tolist(), torch.Generator().manual_seed(0), 0
with torch.no_grad():
    while len(gen) < RF + 2000:                        # sampling is sequential: one pass per new sample
        logits = model(torch.tensor(gen[-RF:])[None])[0, :, -1]
        gen.append(torch.multinomial(logits.softmax(0), 1, generator=g).item()); passes += 1
def profile(sig):                                     # strongest frequency, level at 660 Hz relative to 220 Hz
    spec = np.abs(np.fft.rfft(sig * np.hanning(len(sig)))); fr = np.fft.rfftfreq(len(sig), 1 / SR)
    at = lambda f: spec[np.abs(fr - f).argmin()]
    return f"peak {fr[spec.argmax()]:.0f} Hz, 660/220 level ratio {at(660) / at(220):.2f}, RMS {np.sqrt(np.mean(sig ** 2)):.3f}"
print(f"generated 2000 samples with {passes} sequential forward passes")
print(f"  generated (0.25 s): {profile(mulaw_decode(np.array(gen[RF:])))}")
print(f"  training (all 2 s): {profile(wave)}")
```

</details>

Reading it:
- **μ-law:** at full scale linear 8-bit is better (49.4 against 37.2 dB), but μ-law holds 33.7–37.5 dB from amplitude 0.9 down to 0.01, where linear 8-bit drops to 11.1 dB: μ-law spends its levels where quiet samples are.
- **Baselines:** guessing uniformly costs 8 bits per sample; a model without context, which knows only how often each class occurs, costs 7.06.
- **Training:** held-out cross-entropy falls from 8.19 to 3.72 bits per sample: the 64-sample context makes the next sample far more predictable than its histogram does.
- **Generation:** 2,000 samples took 2,000 sequential forward passes, while training scored 512 positions per pass. The generated audio has the right pitch (peak at 216 Hz, the FFT (fast Fourier transform) bin next to 220 Hz at this length), but its 660 Hz partial is weaker (0.21 against 0.50), and no 64-sample window can carry the 1.5 Hz loudness swell, one period of which is 5,333 samples: the same kind of limit WaveNet's authors hit with pitch contours and a 240 ms receptive field.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Vocoder trained on real mels, run on predicted ones | Lower MOS (4.362 against 4.526) | Predicted mels are oversmoothed by the squared-error loss ✅[^4] |
| Long-range structure in an autoregressive model | Unnatural prosody, or a loudness swell the model cannot follow (lab) | The receptive field is shorter than the dependency: 240 ms in WaveNet's TTS ✅[^3]; 64 samples in the lab ✅[^12] |
| Autoregressive generation at audio rates | One pass per sample: 2,000 passes for 0.25 s at 8 kHz in the lab | Sequential sampling ✅[^3] ✅[^12]; 0.003 × real time for the WaveNet in HiFi-GAN's table ✅[^2] |
| Linear 8-bit quantization of quiet audio | SNR collapses (lab: 11.1 dB at 1 % of full scale) | Even steps waste levels on loud values ✅[^12] |
| HiFi-GAN without the MPD | Significant drop in perceived quality | Periodic patterns go unjudged ✅[^2] |
| RVQ with very many tiny codebooks | Only modest quality loss (80 one-bit quantizers) | Each stage still refines the residual ✅[^5] |
| A codec trained without quantizer dropout, decoded with fewer codebooks | Quality drops, more the fewer codebooks are used (an 18 kbps model still does well at somewhat lower rates); with dropout the gap vanishes and one model serves every bitrate | Without dropout the decoder never saw short codebook prefixes in training; dropout trains every prefix ✅[^5] |
| Unused codebook entries | Wasted bits | Fixed by k-means initialization and replacing dead vectors ✅[^5] |
| MOS on test sentences that resemble training text | Possibly inflated scores; comparisons on the same set stay meaningful | Shared patterns and common words with the training set ✅[^4] |
| Realistic voice continuation from 3 seconds | Listeners cannot tell it from real speech | AudioLM's 51.2 % ✅[^8]; voice data needs explicit consent ✅[^11] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Autoregressive vocoder (WaveNet) | High naturalness, MOS 4.21 against 3.86 for the best baseline ✅[^3] | One pass per sample; 0.003 × real time ✅[^2] |
| GAN vocoder (HiFi-GAN V1) | MOS 4.36, 167.86 × real time on a GPU ✅[^2] | Adversarial training with several discriminators and auxiliary losses ✅[^2] |
| Small GAN vocoder (HiFi-GAN V3) | 13.44 × real time on a CPU, 1.46 M parameters ✅[^2] | Lower MOS (4.05) ✅[^2] |
| More RVQ codebooks | Lower error (lab: 0.135 → 0.004 from 1 to 8) ✅[^12] | Higher bitrate; more tokens per second for a language model ✅[^8] |
| Fewer, larger codebooks at a fixed bitrate | Best coding efficiency ✅[^5]; lab 0.135 at 1 × 256 ✅[^12] | More computation and memory ✅[^5] |
| Semantic vs acoustic tokens | Semantic: phonetic content, long-term structure ✅[^8] | Semantic: poor reconstruction; acoustic: poor phonetic discriminability ✅[^8] |

## Takeaways
- Train the vocoder on the acoustic model's predicted spectrograms, not only on ground truth, when the two are used together. [rule-candidate]
- Budget autoregressive audio generation in samples (or tokens) per second, one forward pass each; prefer a parallel vocoder when speech must be real time.
- Read a codec's bitrate as frames per second × codebooks × bits per codebook, and ask how many of those codebooks the downstream model must generate.
- Compare TTS systems only by listening tests run on the same sentences, with confidence intervals. [rule-candidate]
- Obtain explicit consent before training on anyone's voice.

## Verification status
- Verified: 94 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [Seq2Seq architectures (Audio Course, unit 3)](https://huggingface.co/learn/audio-course/chapter3/seq2seq) — Hugging Face, living. Backs: one-to-many TTS, uninformative L1/MSE, human evaluation, SpeechT5's start frame, stop probability, post-net and separate vocoder. [^1]
- [HiFi-GAN: Generative Adversarial Networks for Efficient and High Fidelity Speech Synthesis](https://ar5iv.labs.arxiv.org/html/2010.05646) — Kong, Kim, Bae, 2020 (ar5iv HTML of arXiv:2010.05646). Backs: the two-stage pipeline, sample rates, WaveNet's cost, generator and MRF, MPD and MSD, LSGAN, mel and feature-matching losses, LJSpeech, MOS and speed table, ablation, 95 % intervals. [^2]
- [WaveNet: A Generative Model for Raw Audio](https://ar5iv.labs.arxiv.org/html/1609.03499) — van den Oord et al., 2016 (ar5iv HTML of arXiv:1609.03499). Backs: autoregressive factorization, the 65,536-way softmax, μ-law, causal and dilated convolutions, gated units, conditioning, MOS results, the 240 ms receptive field, the five-point scale. [^3]
- [Natural TTS Synthesis by Conditioning WaveNet on Mel Spectrogram Predictions](https://ar5iv.labs.arxiv.org/html/1712.05884) — Shen et al., 2017 (ar5iv HTML of arXiv:1712.05884). Backs: mel inversion difficulty, mel as vocoder input, the vocoder's upsampling layers, Tacotron 2's architecture, stop token, predicted vs ground-truth training, MOS 4.53 vs 4.58, rating protocol, possible MOS inflation. [^4]
- [SoundStream: An End-to-End Neural Audio Codec](https://ar5iv.labs.arxiv.org/html/2107.03312) — Zeghidour et al., 2021 (ar5iv HTML of arXiv:2107.03312). Backs: encoder–RVQ–decoder, strides and frame rate, the `2^80` example, RVQ algorithm and bit count, depth vs codebook size, codebook training, quantizer dropout, results against Opus and EVS, MUSHRA-style test, ViSQOL. [^5]
- [Pre-trained models for text-to-speech (Audio Course, unit 6)](https://huggingface.co/learn/audio-course/chapter6/pre-trained_models) — Hugging Face, living. Backs: speaker embeddings (x-vectors) in SpeechT5. [^6]
- [High Fidelity Neural Audio Compression](https://ar5iv.labs.arxiv.org/html/2210.13438) — Défossez, Copet, Synnaeve, Adi, 2022 (ar5iv HTML of arXiv:2210.13438). Backs: EnCodec's bitrates, codebooks, 75 steps per second, codebook training and commitment loss, entropy coding with a transformer, the MUSHRA protocol. [^7]
- [AudioLM: a Language Modeling Approach to Audio Generation](https://ar5iv.labs.arxiv.org/html/2209.03143) — Borsos et al., 2022 (ar5iv HTML of arXiv:2209.03143). Backs: semantic and acoustic tokens and their rates, their complementary strengths, the three stages, coarse vs fine levels, continuation results, the detector, ASR and speaker-classifier evaluation. [^8]
- [P.800.1: Mean opinion score (MOS) terminology](https://www.itu.int/rec/T-REC-P.800.1) — ITU-T, living (in-force version 07/16). Backs: the recommendation that defines MOS terminology. [^9]
- [Evaluating text-to-speech models (Audio Course, unit 6)](https://huggingface.co/learn/audio-course/chapter6/evaluation) — Hugging Face, living. Backs: MOS on a 1–5 scale, why objective TTS metrics are hard, rater variability. [^10]
- [From text to speech (Audio Course, unit 6)](https://huggingface.co/learn/audio-course/chapter6/introduction) — Hugging Face, living. Backs: misuse risks and explicit consent for voice data. [^11]
- `machine-learning/lab-setup.md` — the lab where the RVQ and bitrate script, the period reshape and the tiny μ-law WaveNet ran on 2026-11-25. [^12]

## Related
- `machine-learning/speech-and-audio/audio-signals-and-features.md` — the mel spectrogram a vocoder inverts.
- `machine-learning/speech-and-audio/speech-recognition.md` — the reverse task, and wav2vec 2.0's product quantization.
- `machine-learning/generative-models/generative-adversarial-networks.md` — the adversarial game HiFi-GAN plays.
- `machine-learning/generative-models/generative-model-families.md` — autoregressive models next to GANs, variational autoencoders, flows and diffusion.
- `machine-learning/generative-models/diffusion-models.md` — another generative family, not covered here for audio.
- `machine-learning/deep-learning/convolutional-networks.md` — convolutions, strides and receptive fields, the building blocks of WaveNet, HiFi-GAN and codec encoders.
- `machine-learning/unsupervised-learning/k-means-clustering.md` — how the codebooks and AudioLM's semantic tokens are learned.
- `machine-learning/ml-systems/model-compression-and-quantization.md` — scalar int8 quantization of weights, the one-number cousin of vector quantization.
- `machine-learning/transformers/decoding-and-kv-cache.md` — sampling and caching when a language model generates audio tokens.
