---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/speech-and-audio
status: verified
applies-to: ["PyTorch 2.15.0", "numpy 2.5.5", "scipy 1.18.1", "librosa 0.11.0 (formulas only)"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, speech-and-audio, audio, sampling-rate, nyquist, aliasing, quantization, bit-depth, stft, spectrogram, window, mel-scale, mel-filterbank, log-mel, mfcc, specaugment]
---

# Audio signals and features: sampling, the STFT, mel spectrograms and MFCCs

## Summary
**TL;DR:** Digital audio is a list of amplitude samples taken `fs` times per second, each rounded to one of `2^bits` levels. Only frequencies below `fs/2` (the Nyquist limit) survive sampling: a higher one does not vanish but folds back as a false lower frequency (aliasing), and each bit of depth removed adds about 6 dB (decibels) of rounding noise. Speech models usually read a log-mel spectrogram instead of the raw samples: the STFT (short-time Fourier transform) cuts the signal into overlapping windowed frames, typically 25 ms long every 10 ms, and takes each frame's spectrum; a mel filterbank pools that spectrum into 40–80 bands that are narrow at low frequencies and wide at high ones; a logarithm compresses the range. A DCT (discrete cosine transform) of the log-mel gives MFCCs (mel-frequency cepstral coefficients), whose first few numbers keep the spectral envelope. SpecAugment masks random bands and time spans of the log-mel during training.
**Use this when:** you prepare audio for a speech model, pick a sampling rate, window, hop or number of mel bands, need to match a pretrained model's feature extractor, or read a line such as "80-channel log-mel, 25 ms windows, 10 ms stride".
**Not this doc:** turning these features into text → `machine-learning/speech-and-audio/speech-recognition.md`; turning them back into sound → `machine-learning/speech-and-audio/speech-synthesis-and-audio-generation.md`; augmentation for images and transfer learning → `machine-learning/deep-learning/data-augmentation-and-transfer-learning.md`.

## Problem
A speech model never hears sound; it sees numbers made by a chain of choices, and each choice can silently change them. Downsampling by throwing away every other sample creates distortions called aliases ✅[^2]. A 5-second clip is 80,000 values at 16 kHz but 40,000 at 8 kHz, and it is hard for a model to generalize between sampling rates ✅[^1]. Two "mel spectrograms" can differ in the mel formula (HTK or Slaney), in power versus amplitude, and in true decibels versus a plain log, so a model fed features computed the other way gets inputs it never saw in training ✅[^1]. And raw audio is long: 30 seconds at 16 kHz is 480,000 numbers, while Whisper's log-mel spectrogram of the same 30 seconds is an `(80, 3000)` array ✅[^3].

## Mental model
**Analogy:** a stenographer at a concert with a stopwatch. Every 10 ms she listens to the last 25 ms and writes down how loud each pitch was: one STFT frame. Her pitch keyboard has narrow keys in the bass and wide keys in the treble, because ears separate low pitches more finely: the mel filterbank. She writes loudness in decibels: the log. If a note changes faster than her stopwatch can follow, she writes down a wrong, slower note, like a film in which a fast-spinning wheel seems to turn slowly backwards: aliasing.

**Artifact:** a 7 kHz cosine sampled at 10 kHz is, sample for sample, a 3 kHz cosine; and each bit of depth buys about 6 dB of SNR (signal-to-noise ratio). Printed by the full script in the Worked example; lab run (`machine-learning/lab-setup.md`), 2026-11-25, numpy 2.5.5 ✅[^14]:

```text
== 1. aliasing: a 7 kHz cosine sampled at fs = 10 kHz ==
spectrum peak at 3000 Hz; max |x7 - x3| over 1000 samples = 9.9e-13
== 2. quantization noise vs bit depth (the vowel, uniform rounding) ==
 4 bits:     16 levels  SNR  20.3 dB
 8 bits:    256 levels  SNR  44.6 dB  (+6.08 dB per bit)
12 bits:   4096 levels  SNR  68.7 dB  (+6.01 dB per bit)
16 bits:  65536 levels  SNR  93.5 dB  (+6.20 dB per bit)
```

## How it works
### Sampling, Nyquist and aliasing
1. **Sampling** measures the signal at fixed time steps; the sampling rate `fs` counts samples per second, in hertz: 44,100 Hz for CD (compact disc) audio, 16,000 Hz commonly for training speech models ✅[^1].
2. **Nyquist limit:** the highest frequency a sampling rate can capture is exactly `fs/2`. The audible frequencies of speech are below 8 kHz, so 16 kHz is enough, and speech sampled at 8 kHz sounds muffled ✅[^1].
3. **Aliasing:** for sample index `n`, because `n·k` is a whole number, `cos(2π·f·n/fs) = cos(2π·(f − k·fs)·n/fs)` for every integer `k`, so a tone above `fs/2` produces exactly the samples of the tone at `|f − k·fs|` below it. With `f = 7000`, `fs = 10000`, `k = 1`: `|7000 − 10000| = 3000 Hz`; in the lab the two sample sequences differ by at most `9.9e-13` ✅[^14]. After sampling nothing can tell them apart, so the high frequency must go before sampling or downsampling: a resampler filters out everything above the new Nyquist limit before computing the new samples ✅[^2].
4. **Match the model's rate:** fine-tuning data should have the sampling rate the model was pretrained on ✅[^1], and most pretrained checkpoints were trained at 16 kHz ✅[^2].

### Quantization and bit depth
1. **Bit depth** sets how many amplitude steps a sample can take: 65,536 for 16-bit, 16,777,216 for 24-bit. Rounding to a step adds quantization noise that shrinks as the depth grows, and 16-bit noise is already small enough to be inaudible ✅[^1].
2. **About 6 dB per bit:** one more bit halves the step `Δ`. The rounding error spreads roughly evenly over `±Δ/2`, whose mean square is `Δ²/12`, so halving `Δ` divides the noise power by 4, and `10·log10(4) = 6.02 dB`. The lab measured +6.01 to +6.20 dB per bit on a synthetic vowel ✅[^14].
3. **Floating point:** 32-bit float audio has 24 bits of precision and is expected in `[-1.0, 1.0]`; models work on floats, so integer audio is converted before training ✅[^1].
4. **Decibels:** in digital audio 0 dB is the loudest possible amplitude, and every −6 dB halves the amplitude (`20·log10(0.5) = −6.02`) ✅[^1].

### Frames, windows and the STFT
1. **The formula:** PyTorch computes `X[ω, m] = Σ_{k=0}^{win_length−1} window[k] · input[m·hop_length + k] · exp(−j·2π·ω·k / n_fft)` ✅[^4], where `m` is the frame index, `hop_length` the step between frames in samples, `window` a taper of `win_length` samples, `ω` the frequency bin, `j` the imaginary unit and `n_fft` the transform size; bin `ω` sits at `ω·fs/n_fft` Hz. Example: `fs = 16000`, `n_fft = 400`, `hop_length = 160` gives 25 ms windows every 10 ms and bins 40 Hz apart.
2. **Output shape:** for real input only `n_fft//2 + 1` bins are returned, the rest being mirror images (conjugate symmetry), and with `center=True` there are `1 + L//hop_length` frames for `L` samples ✅[^4]: 201 bins × 101 frames for one second in the example ✅[^14].
3. **Padding:** `center=True`, the default, pads both ends (by reflection, by default) so that frame `t` is centred at `t × hop_length`; with `center=False` frame `t` starts there ✅[^4].
4. **Defaults to override:** `hop_length` defaults to `floor(n_fft/4)` and `win_length` to `n_fft`; with no `window` PyTorch uses all ones, a rectangular window that may cause artifacts, warns since version 2.1, and suggests a tapered window such as `torch.hann_window()` ✅[^4]. The Hann window is `w[n] = ½·[1 − cos(2πn/(N − 1))]`; with `periodic=True`, the default and the form meant for `torch.stft`, `N` is `window_length + 1` ✅[^5].
5. **By hand:** reflect-pad by `n_fft/2`, cut a frame every `hop` samples, multiply by the periodic Hann window and take each frame's `rfft`; in the lab this equals `torch.stft` to within `8.9e-15` ✅[^14].
6. **Magnitude and phase:** each bin is a complex number whose magnitude is the amplitude and whose angle is the phase, which machine learning usually discards; the power spectrum is the magnitude squared ✅[^1]. The inverse STFT needs the phase too, so a magnitude-only spectrogram needs a phase reconstruction algorithm such as Griffin-Lim, or a neural vocoder, to become audio again ✅[^1].
7. **Window length trades time detail for frequency detail:** a window of `N` samples spans `N/fs` seconds and its bins are `fs/N` Hz apart. On a chirp rising 4,000 Hz per second, the ridge at the half-maximum is 508 Hz wide with a 4 ms window, 77 Hz at 32 ms, and 256 Hz again at 128 ms, because the pitch moves during a long window ✅[^14]. librosa's default of 2048 samples is described as a good trade-off between frequency and time resolution ✅[^1].

### The mel scale and the mel filterbank
1. **Why:** hearing is more sensitive to changes at low frequencies than at high ones, and the mel scale is a perceptual scale that approximates this non-linear response ✅[^1]. It is quasi-logarithmic, built so that perceptually similar intervals such as octaves look equally wide, and because it rests on a finite number of listening experiments several formulas coexist ✅[^6].
2. **HTK formula** (HTK: the Hidden Markov Toolkit): `mel = 2595·log10(1 + f/700)` ✅[^6]; `f = 1000 Hz` gives `2595·log10(2.4286) = 1000.0` ✅[^14].
3. **Slaney formula,** librosa's default, which replicates Slaney's Auditory Toolbox, is linear below 1 kHz and logarithmic above ✅[^6]: `mel = f/(200/3)` below 1000 Hz and `15 + ln(f/1000)/(ln(6.4)/27)` above ✅[^7]. Examples: `60 Hz → 0.9`, `1000 Hz → 15` ✅[^7] ✅[^14].
4. **The filterbank:** place `n_mels + 2` points evenly on the mel axis between `fmin` and `fmax` (default `fs/2`), convert them back to hertz, and build triangle `i` rising from point `i` to point `i + 1` and falling to point `i + 2`; with `norm='slaney'` each triangle is multiplied by `2/(f_{i+2} − f_i)`, for roughly constant energy per channel ✅[^8]; since a triangle of height 1 over a base of `f_{i+2} − f_i` hertz has area `(f_{i+2} − f_i)/2`, this gives every filter an area of 1 (librosa's "area normalization"). The result is a matrix of shape `(n_mels, 1 + n_fft/2)` that multiplies each power spectrum ✅[^8]. Common values of `n_mels` are 40 and 80 ✅[^1].
5. **What the filters look like:** the hand-built points reproduce librosa's documented `mel_frequencies(n_mels=40)` values `85.317`, `170.635` and `1024.856` Hz ✅[^6] ✅[^14]. For 80 mels on a 400-point FFT (fast Fourier transform) at 16 kHz, centres start 37 Hz apart (37, 74, 112 Hz) and end 290 Hz apart (7409, 7699 Hz), and the narrowest filter covers one FFT bin ✅[^14]. librosa warns about empty filters and suggests a higher sampling rate (and `fmax`) or fewer mel bands ✅[^8].
6. **Lossy:** the filterbank discards detail, so turning a mel spectrogram back into a waveform means estimating what was thrown away, the job of a vocoder such as HiFi-GAN ✅[^1].

### Log-mel features and MFCCs
1. **Log-mel:** express the mel energies in decibels (`10·log10` of power), or simply take the log ✅[^1]. Two published recipes: Whisper, as its paper describes its models, resamples to 16 kHz and computes an 80-channel log-magnitude mel spectrogram on 25 ms windows with a 10 ms stride, then scales it globally to between −1 and 1 with about zero mean ✅[^11]; Tacotron 2 uses a 50 ms frame, a 12.5 ms hop, a Hann window and 80 channels from 125 Hz to 7.6 kHz, clipping magnitudes at 0.01 before the log ✅[^12].
2. **MFCC:** librosa's `mfcc` takes the log-power mel spectrogram and applies a DCT along the mel axis, type 2 and orthonormal by default, keeping the first `n_mfcc` coefficients (default 20) ✅[^9]. Coefficient `k` measures how much the log spectrum looks like a cosine with `k` half-periods across the mel axis: low `k` are slow shapes (the envelope), high `k` fast ripples.
3. **What 13 coefficients keep:** on the lab's vowel (120 Hz harmonics under bumps at 700, 1220 and 2600 Hz), the averaged log-mel has 19 local maxima, because the narrow low filters resolve single harmonics; rebuilt from 13 MFCCs it has peaks at 708, 1266 and 2528 Hz plus a ripple 36 dB below the top ✅[^14].
4. **History:** speech recognition traditionally used log mel-filterbank energies or MFCCs and was moving toward raw audio by 2016 ✅[^13]; wav2vec 2.0 and HuBERT read the waveform with a small CNN (convolutional neural network) feature encoder ✅[^3].

### SpecAugment
SpecAugment augments the log-mel spectrogram itself, treated like an image, and needs no extra data ✅[^10]:
1. **Time warping:** a random point on the time axis is moved left or right by up to `W` steps ✅[^10].
2. **Frequency masking:** draw `f` uniformly from 0 to `F`, draw `f0` from `[0, ν − f)` for `ν` mel channels, and mask channels `[f0, f0 + f)` ✅[^10].
3. **Time masking:** draw `t` from 0 to `T` and mask frames `[t0, t0 + t)`, but never more than `p` times the number of frames ✅[^10].
4. **Masked value:** the spectrograms are normalized to zero mean, so setting a cell to zero sets it to the mean ✅[^10].

The paper's policies: LB (LibriSpeech basic) is `W 80, F 27, mF 1, T 100, p 1.0, mT 1` (`mF`, `mT` = number of frequency and time masks); LD (LibriSpeech double) is LB with two masks of each kind; SM (Switchboard mild) is `W 40, F 15, mF 2, T 70, p 0.2, mT 2` ✅[^10]. On LibriSpeech 960h a LAS (Listen, Attend and Spell) network reached 6.8 % WER (word error rate) on test-other without a language model and 5.8 % with one ✅[^10]. Time warping helped least and cost most, so it is the first to drop on a budget ✅[^10]; the authors observe that augmentation "converts an over-fitting problem into an under-fitting problem" ✅[^10].

## Worked example
One second of a synthetic vowel at 16 kHz, made of 120 Hz harmonics shaped by three bumps (700, 1220, 2600 Hz), goes through the whole chain: quantization, the STFT by hand and with `torch.stft`, an 80-band mel filterbank built from the librosa formulas, log-mel, MFCCs and two SpecAugment policies; a chirp shows the window choice. The core lines:

```python
X = torch.stft(x, 400, hop_length=160, window=torch.hann_window(400), return_complex=True)  # 25 ms / 10 ms
logmel = 10 * np.log10(np.maximum(W @ np.abs(X) ** 2, 1e-10))   # W: (80, 201) mel filterbank
mfcc = dct(logmel, type=2, norm="ortho", axis=0)[:13]
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-25, numpy 2.5.5, scipy 1.18.1, PyTorch 2.15.0, two runs identical; the first seven lines are the Mental model artifact ✅[^14]:

```text
== 1. aliasing: a 7 kHz cosine sampled at fs = 10 kHz ==
spectrum peak at 3000 Hz; max |x7 - x3| over 1000 samples = 9.9e-13
== 2. quantization noise vs bit depth (the vowel, uniform rounding) ==
 4 bits:     16 levels  SNR  20.3 dB
 8 bits:    256 levels  SNR  44.6 dB  (+6.08 dB per bit)
12 bits:   4096 levels  SNR  68.7 dB  (+6.01 dB per bit)
16 bits:  65536 levels  SNR  93.5 dB  (+6.20 dB per bit)
== 3. STFT by hand (reflect-pad, frame, periodic Hann window, rfft) vs torch.stft ==
shape (201, 101) (n_fft//2+1 bins, 1+L//hop frames); bin spacing 40 Hz; max |hand - torch| = 8.9e-15
== 4. window length on a chirp (500 -> 4500 Hz in 1 s): width of the ridge at t = 0.5 s ==
window   64 =   4.0 ms  bin  250.0 Hz  ridge width (half max)  507.6 Hz
window  128 =   8.0 ms  bin  125.0 Hz  ridge width (half max)  251.7 Hz
window  256 =  16.0 ms  bin   62.5 Hz  ridge width (half max)  126.7 Hz
window  512 =  32.0 ms  bin   31.2 Hz  ridge width (half max)   77.4 Hz
window 1024 =  64.0 ms  bin   15.6 Hz  ridge width (half max)  127.2 Hz
window 2048 = 128.0 ms  bin    7.8 Hz  ridge width (half max)  255.6 Hz
== 5. mel scale and a Slaney-style mel filterbank, built by hand ==
1000 Hz -> HTK 1000.0 mel, Slaney 15.0; 60 Hz -> Slaney 0.9
Slaney mel_frequencies(n_mels=40, fmax=11025)[:3], [12], [-1]: [    0.       85.317   170.635  1024.856 11025.   ]
80 filters x 201 bins; centres (Hz) [37, 74, 112, 1006, 1045, 7409, 7699]; fewest bins in one filter: 1
== 6. log-mel and MFCC of the vowel ==
MFCC shape (13, 101); hand DCT == scipy dct(type=2, norm='ortho'): True
log-mel local maxima: 19; rebuilt from 13 MFCCs: 4, at (Hz, dB below the top) [(708, 1.5), (1266, 0.0), (2528, 5.5), (4856, 36.3)]
== 7. SpecAugment masks on the 80 x 101 log-mel (normalized to zero mean, so 0 = the mean) ==
policy LB {'F': 27, 'mF': 1, 'T': 100, 'p': 1.0, 'mT': 1}: masks ch[36,61) fr[2,91); cells set to the mean 91.8%
policy SM {'F': 15, 'mF': 2, 'T': 70, 'p': 0.2, 'mT': 2}: masks ch[64,76) ch[29,29) fr[9,22) fr[57,67); cells set to the mean 34.4%
```

<details><summary>Full script (prints the output above)</summary>

```python
# From a sound to model features: aliasing, quantization noise, the STFT by hand vs torch.stft,
# the window-length trade-off, a mel filterbank built by hand, log-mel and MFCCs, SpecAugment masks.
import numpy as np, torch
from scipy.fft import dct
rng = np.random.default_rng(0)

print("== 1. aliasing: a 7 kHz cosine sampled at fs = 10 kHz ==")
fs, n = 10_000, np.arange(1000)
x7, x3 = np.cos(2 * np.pi * 7000 * n / fs), np.cos(2 * np.pi * 3000 * n / fs)
peak = np.fft.rfftfreq(len(n), 1 / fs)[np.abs(np.fft.rfft(x7 * np.hanning(len(n)))).argmax()]
print(f"spectrum peak at {peak:.0f} Hz; max |x7 - x3| over 1000 samples = {np.abs(x7 - x3).max():.1e}")

sr = 16_000                                        # a synthetic vowel: 120 Hz harmonics shaped by 3 resonances
t = np.arange(sr) / sr
formants = [(700, 80), (1220, 90), (2600, 120)]   # (centre, width) in Hz
env = lambda f: sum(np.exp(-0.5 * ((f - F) / B) ** 2) for F, B in formants) + 0.01
vowel = sum(env(h) * np.cos(2 * np.pi * h * t + rng.uniform(0, 2 * np.pi)) for h in np.arange(120, 7900, 120))
vowel = 0.9 * vowel / np.abs(vowel).max()

print("== 2. quantization noise vs bit depth (the vowel, uniform rounding) ==")
def quantize(x, bits):                             # 2**bits levels spaced 2 / 2**bits apart on [-1, 1)
    step = 2.0 / 2 ** bits
    return np.clip(np.round(x / step) * step, -1, 1 - step)
prev = None
for b in (4, 8, 12, 16):
    e = quantize(vowel, b) - vowel
    snr = 10 * np.log10(np.mean(vowel ** 2) / np.mean(e ** 2))
    print(f"{b:2d} bits: {2 ** b:6d} levels  SNR {snr:5.1f} dB" + (f"  (+{(snr - prev) / 4:.2f} dB per bit)" if prev else ""))
    prev = snr

print("== 3. STFT by hand (reflect-pad, frame, periodic Hann window, rfft) vs torch.stft ==")
n_fft, hop = 400, 160                              # 25 ms windows, 10 ms hop at 16 kHz
X = torch.stft(torch.tensor(vowel), n_fft, hop_length=hop, window=torch.hann_window(n_fft, dtype=torch.float64),
               center=True, pad_mode="reflect", return_complex=True).numpy()
xp = np.pad(vowel, n_fft // 2, mode="reflect")
frames = np.stack([xp[m * hop: m * hop + n_fft] for m in range(1 + len(vowel) // hop)])
hann = 0.5 - 0.5 * np.cos(2 * np.pi * np.arange(n_fft) / n_fft)
X_hand = np.fft.rfft(frames * hann, axis=1).T
print(f"shape {X.shape} (n_fft//2+1 bins, 1+L//hop frames); bin spacing {sr / n_fft:.0f} Hz; "
      f"max |hand - torch| = {np.abs(X_hand - X).max():.1e}")

print("== 4. window length on a chirp (500 -> 4500 Hz in 1 s): width of the ridge at t = 0.5 s ==")
chirp = np.cos(2 * np.pi * (500 * t + 4000 * t ** 2 / 2))
for N in (64, 128, 256, 512, 1024, 2048):
    seg = chirp[sr // 2 - N // 2: sr // 2 + N // 2] * np.hanning(N)
    mag = np.abs(np.fft.rfft(seg, 65536)); f = np.fft.rfftfreq(65536, 1 / sr)
    width = np.ptp(f[mag >= mag.max() / 2])
    print(f"window {N:4d} = {1000 * N / sr:5.1f} ms  bin {sr / N:6.1f} Hz  ridge width (half max) {width:6.1f} Hz")

print("== 5. mel scale and a Slaney-style mel filterbank, built by hand ==")
htk = lambda f: 2595 * np.log10(1 + np.asarray(f, float) / 700)
def slaney(f):                                     # linear below 1 kHz, logarithmic above
    f = np.asarray(f, float)
    return np.where(f < 1000, f / (200 / 3), 15 + np.log(np.maximum(f, 1e-9) / 1000) / (np.log(6.4) / 27))
def slaney_inv(m):
    m = np.asarray(m, float)
    return np.where(m < 15, m * 200 / 3, 1000 * np.exp((m - 15) * np.log(6.4) / 27))
print(f"1000 Hz -> HTK {htk(1000):.1f} mel, Slaney {slaney(1000):.1f}; 60 Hz -> Slaney {slaney(60):.1f}")
print("Slaney mel_frequencies(n_mels=40, fmax=11025)[:3], [12], [-1]:",
      np.round(slaney_inv(np.linspace(0, slaney(11025), 40))[[0, 1, 2, 12, -1]], 3))
def mel_filterbank(sr, n_fft, n_mels, fmin, fmax):
    fft_f = np.linspace(0, sr / 2, n_fft // 2 + 1)
    edges = slaney_inv(np.linspace(slaney(fmin), slaney(fmax), n_mels + 2))   # n_mels + 2 edge points
    ramps = edges[:, None] - fft_f[None, :]
    lower, upper = -ramps[:-2] / np.diff(edges)[:-1, None], ramps[2:] / np.diff(edges)[1:, None]
    W = np.maximum(0, np.minimum(lower, upper))                                # triangles
    return W * (2.0 / (edges[2:] - edges[:-2]))[:, None], edges[1:-1]          # area ("slaney") norm
W, centres = mel_filterbank(sr, n_fft, 80, 0, 8000)
print(f"80 filters x {W.shape[1]} bins; centres (Hz) {np.round(centres[[0, 1, 2, 26, 27, 78, 79]]).astype(int).tolist()}; "
      f"fewest bins in one filter: {int((W > 0).sum(1).min())}")

print("== 6. log-mel and MFCC of the vowel ==")
logmel = 10 * np.log10(np.maximum(W @ np.abs(X) ** 2, 1e-10))       # (80 mel channels, frames), in dB
dct_m = np.array([[np.cos(np.pi * k * (2 * i + 1) / 160) for i in range(80)] for k in range(80)])
dct_m *= np.sqrt(2 / 80); dct_m[0] /= np.sqrt(2)                    # orthonormal DCT-II
mfcc = (dct_m @ logmel)[:13]
print(f"MFCC shape {mfcc.shape}; hand DCT == scipy dct(type=2, norm='ortho'): "
      f"{np.allclose(dct_m @ logmel, dct(logmel, type=2, norm='ortho', axis=0))}")
avg = logmel.mean(1); smooth = (dct_m[:13].T @ mfcc).mean(1)        # log-mel rebuilt from 13 MFCCs
peaks = lambda v: [i for i in range(1, 79) if v[i] > v[i - 1] and v[i] > v[i + 1]]
print(f"log-mel local maxima: {len(peaks(avg))}; rebuilt from 13 MFCCs: {len(peaks(smooth))}, at (Hz, dB below the top) "
      f"{[(int(round(centres[i])), round(float(smooth.max() - smooth[i]), 1)) for i in peaks(smooth)]}")

print("== 7. SpecAugment masks on the 80 x 101 log-mel (normalized to zero mean, so 0 = the mean) ==")
spec = (logmel - logmel.mean()) / logmel.std()
def spec_augment(x, F, mF, T, p, mT):              # frequency masks, then time masks no wider than p * frames
    x, tau, out = x.copy(), x.shape[1], []
    for _ in range(mF):
        f = rng.integers(0, F + 1); f0 = rng.integers(0, x.shape[0] - f); x[f0:f0 + f] = 0; out.append(f"ch[{f0},{f0 + f})")
    for _ in range(mT):
        t_ = rng.integers(0, min(T, int(p * tau)) + 1); t0 = rng.integers(0, tau - t_); x[:, t0:t0 + t_] = 0
        out.append(f"fr[{t0},{t0 + t_})")
    return x, out
for name, kw in (("LB", dict(F=27, mF=1, T=100, p=1.0, mT=1)), ("SM", dict(F=15, mF=2, T=70, p=0.2, mT=2))):
    aug, masks = spec_augment(spec, **kw)
    print(f"policy {name} {kw}: masks {' '.join(masks)}; cells set to the mean {np.mean(aug == 0):.1%}")
```

</details>

Reading it:
- **Bit depth:** 16 levels already give 20 dB, and every 4 more bits add about 24 dB; at 16 bits the rounding noise sits 93.5 dB below the vowel.
- **STFT:** 201 bins × 101 frames, as the shape rules predict, and the hand-made frames, window and `rfft` match `torch.stft` to rounding error, so `torch.stft` is "reflect-pad, frame, window, FFT" and nothing more.
- **Window:** the ridge width falls from 508 Hz to 77 Hz as the window grows from 4 to 32 ms, then rises to 256 Hz at 128 ms: a fixed tone would keep narrowing, but this pitch moves by 128 Hz during a 32 ms window and by 512 Hz during a 128 ms one.
- **Mel:** the HTK and Slaney scales both put 1000 Hz at a round number (1000 and 15 mel) but are different units; the filter centres are 37 Hz apart at the bottom and 290 Hz apart at the top, so one low filter holds a single 40 Hz FFT bin.
- **MFCC:** 13 coefficients per frame (13 × 101) replace 80 log-mel values; they smooth away the 120 Hz harmonic ripple (19 maxima) and keep three peaks near the vowel's 700, 1220 and 2600 Hz bumps.
- **SpecAugment:** policy LB masked 25 channels and frames 2–90, 91.8 % of this 1-second spectrogram, because `T = 100` frames is nearly the whole clip; policy SM's `p = 0.2` caps each time mask at 20 frames (34.4 % masked; one of its frequency masks drew width 0).

## Edge cases
| Case | What happens | Why |
|---|---|---|
| A tone above `fs/2` reaches the converter | It shows up as a false tone at `|f − k·fs|`: 7 kHz becomes 3 kHz at `fs = 10 kHz` | The two produce identical samples ✅[^14] |
| Downsampling by keeping every other sample | Aliases | Frequencies above the new Nyquist limit were not filtered out first ✅[^2] |
| 8 kHz audio into a model trained at 16 kHz | Half-length sequences and muffled speech; hard to generalize | Sequence length and bandwidth depend on `fs` ✅[^1] |
| `torch.stft` called without `window` | Rectangular window, possible artifacts, a warning since 2.1 | The default window is all ones ✅[^4] |
| `center=False` | `1 + (L − n_fft)//hop_length` frames, frame `t` starting at `t·hop_length` | No padding at the ends ✅[^4] |
| Features computed with another mel recipe | The model gets inputs unlike its training data | HTK vs Slaney, power vs amplitude, decibels vs log ✅[^1] |
| Many mel bands on a short FFT | Low filters hold one FFT bin or none (lab: one) | Low mel spacing (37 Hz) is below the bin spacing (40 Hz) ✅[^14]; librosa warns on empty filters ✅[^8] |
| Short clip with a `p = 1.0` time mask | One mask can hide most of the clip (lab: 89 of 101 frames) | `T = 100` frames is a large share of 1 second ✅[^14]; `p` caps the mask ✅[^10] |
| Hop much shorter than 10 ms in TTS (text-to-speech) | More frames to predict; Tacotron 2 saw more pronunciation issues with a 5 ms hop than with 12.5 ms | The higher temporal resolution ✅[^12]: 2.5 times as many frames per second |
| Quiet recording at low bit depth | SNR falls about 6 dB for each bit lost | Step size doubles per bit removed ✅[^14] |
| Mel spectrogram back to audio | Needs a vocoder | Phase and the pooled detail are gone ✅[^1] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Raw waveform input (wav2vec 2.0, HuBERT) | A learned CNN feature encoder instead of hand-made features ✅[^3] | Long sequences: 480,000 values for 30 s at 16 kHz ✅[^3] |
| Log-mel input (Whisper) | A much shorter sequence: `(80, 3000)` for 30 s ✅[^3] | Lossy; the phase is discarded ✅[^1] |
| 13–20 MFCCs | Compact; keep the envelope peaks (lab: 3 near the bumps) ✅[^14] | Drop the harmonic fine structure (lab: 19 maxima down to 4) ✅[^14] |
| Long window (64–128 ms) | Bins 15.6–7.8 Hz apart ✅[^14] | Smears change over time: chirp ridge 127–256 Hz ✅[^14] |
| Short window (4–8 ms) | Fine time detail | Bins 250–125 Hz apart; chirp ridge 508–252 Hz ✅[^14] |

## Takeaways
- Resample every clip to the rate the model was trained on with a library resampler that filters first; never by dropping samples. [rule-candidate]
- Copy the model's exact feature recipe (sampling rate, `n_fft`, hop, window, mel formula and normalization, log or decibels, scaling) from its paper or feature extractor: "mel spectrogram" is not one thing. [rule-candidate]
- Always pass a window to `torch.stft`, for example `torch.hann_window(n_fft)`, together with `return_complex=True`.
- Choose the window from what must be resolved: about 25 ms for speech frames, longer to separate close pitches, shorter for fast events.
- Check SpecAugment's time-mask limit `p` against your clip lengths.

## Verification status
- Verified: 81 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [Introduction to audio data (Audio Course, unit 1)](https://huggingface.co/learn/audio-course/chapter1/audio_data) — Hugging Face, living. Backs: sampling rate, Nyquist limit, 16 kHz for speech, rate mismatch, bit depth and quantization noise, float audio, decibels, magnitude and phase, power spectrum, inverse STFT and vocoders, librosa's 2048-sample trade-off, the mel scale, `n_mels` 40 or 80, log-mel variants, mel loss of information. [^1]
- [Preprocessing an audio dataset (Audio Course, unit 1)](https://huggingface.co/learn/audio-course/chapter1/preprocessing) — Hugging Face, living. Backs: resampling filters before downsampling, aliases from dropping samples, most checkpoints at 16 kHz. [^2]
- [Transformer architectures for audio (Audio Course, unit 3)](https://huggingface.co/learn/audio-course/chapter3/introduction) — Hugging Face, living. Backs: 480,000 samples for 30 s, Whisper's `(80, 3000)` log-mel, waveform models with a CNN feature encoder. [^3]
- [torch.stft](https://docs.pytorch.org/docs/2.15/generated/torch.stft.html) — PyTorch, 2026 (2.15). Backs: the STFT formula, defaults, rectangular-window warning, `center` and padding, one-sided bins, output shape and frame count. [^4]
- [torch.hann_window](https://docs.pytorch.org/docs/2.15/generated/torch.hann_window.html) — PyTorch, 2026 (2.15). Backs: the Hann formula and the periodic form for `torch.stft`. [^5]
- [librosa.mel_frequencies](https://librosa.org/doc/0.11.0/generated/librosa.mel_frequencies.html) — librosa development team, 2025 (0.11.0). Backs: quasi-logarithmic mel scale, several implementations, the HTK formula, Slaney as default, the 40-mel example values. [^6]
- [librosa/core/convert.py at 0.11.0](https://github.com/librosa/librosa/blob/0.11.0/librosa/core/convert.py) — librosa development team, 2025. Backs: the Slaney `hz_to_mel` formula and its `60 Hz → 0.9` example. [^7]
- [librosa/filters.py at 0.11.0](https://github.com/librosa/librosa/blob/0.11.0/librosa/filters.py) — librosa development team, 2025. Backs: the mel filterbank construction, Slaney area normalization, `fmax` default, matrix shape, the empty-filter warning. [^8]
- [librosa/feature/spectral.py at 0.11.0](https://github.com/librosa/librosa/blob/0.11.0/librosa/feature/spectral.py) — librosa development team, 2025. Backs: MFCC as a type-2 orthonormal DCT of the log-power mel spectrogram, `n_mfcc = 20`. [^9]
- [SpecAugment: A Simple Data Augmentation Method for Automatic Speech Recognition](https://ar5iv.labs.arxiv.org/html/1904.08779) — Park et al., 2019 (ar5iv HTML of arXiv:1904.08779). Backs: the three augmentations, the time-mask bound `p`, zero = mean, the LB/LD/SM policies, LibriSpeech results, dropping time warping first, the under-fitting quote. [^10]
- [Robust Speech Recognition via Large-Scale Weak Supervision](https://ar5iv.labs.arxiv.org/html/2212.04356) — Radford et al., 2022 (ar5iv HTML of arXiv:2212.04356). Backs: Whisper's 16 kHz, 80-channel log-mel, 25 ms windows, 10 ms stride, global scaling. [^11]
- [Natural TTS Synthesis by Conditioning WaveNet on Mel Spectrogram Predictions](https://ar5iv.labs.arxiv.org/html/1712.05884) — Shen et al., 2017 (ar5iv HTML of arXiv:1712.05884). Backs: Tacotron 2's mel recipe and the 5 ms hop experiment. [^12]
- [WaveNet: A Generative Model for Raw Audio](https://ar5iv.labs.arxiv.org/html/1609.03499) — van den Oord et al., 2016 (ar5iv HTML of arXiv:1609.03499). Backs: speech recognition's traditional log mel-filterbank and MFCC features. [^13]
- `machine-learning/lab-setup.md` — the lab where the aliasing, quantization, STFT, window, mel, MFCC and SpecAugment script ran on 2026-11-25. [^14]

## Related
- `machine-learning/speech-and-audio/speech-recognition.md` — models that turn these features into text, and how they are scored.
- `machine-learning/speech-and-audio/speech-synthesis-and-audio-generation.md` — models that predict mel spectrograms and turn them back into waveforms.
- `machine-learning/deep-learning/convolutional-networks.md` — the convolutions in waveform feature encoders and spectrogram front ends.
- `machine-learning/deep-learning/data-augmentation-and-transfer-learning.md` — augmentation and pretrained models outside audio.
- `floating-point/rounding-and-error.md` — rounding error in floating-point numbers, the other kind of quantization in the pipeline.
