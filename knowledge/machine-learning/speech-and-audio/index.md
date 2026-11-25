---
schema: topic-index/v1
kind: subtopic
topic: machine-learning/speech-and-audio
last-updated: 2026-11-25
---

# Speech and audio

Machine learning on sound: how audio is sampled and turned into spectrogram and mel features, how speech recognition aligns audio with text (CTC, attention encoder–decoders, self-supervised pretraining) and is scored, and how speech and audio are generated (text-to-speech, vocoders, neural audio codecs). Every doc has a CPU-sized lab run on synthetic signals (tones, chirps, a formant-like vowel), with the full script inline; no audio library beyond `torch.stft` and `torch.nn.CTCLoss` is needed. Not covered: music information retrieval and classical signal-processing theory beyond what the models need.

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [audio-signals-and-features.md](audio-signals-and-features.md) | concept | Sampling, Nyquist and aliasing, bit depth; the STFT by hand vs `torch.stft` and the window trade-off; the mel scale and filterbank; log-mel, MFCCs, SpecAugment | verified |
| [speech-recognition.md](speech-recognition.md) | concept | The ASR pipeline; CTC's blank, alignments, loss and decoding checked by brute force; Whisper-style encoder–decoders; wav2vec 2.0 pretraining; WER by edit distance; a tiny CTC recognizer | verified |
| [speech-synthesis-and-audio-generation.md](speech-synthesis-and-audio-generation.md) | concept | Text → mel → vocoder; WaveNet with μ-law and a tiny autoregressive run; HiFi-GAN's discriminators; residual vector quantization, codec bitrates and AudioLM tokens; MOS and MUSHRA | verified |

## References
- [PyTorch documentation (2.15)](https://docs.pytorch.org/docs/2.15/) — PyTorch Foundation, 2026. Backs: topic scope (the lab's STFT and CTC loss).
- [Hugging Face Audio Course](https://huggingface.co/learn/audio-course/) — Hugging Face, living. Backs: topic scope (audio data, ASR and TTS units).

## Related
- `machine-learning/learning-path.md` — where this subtopic sits in the reading order.
- `machine-learning/lab-setup.md` — the lab every experiment ran in.
- `machine-learning/transformers/attention-and-the-transformer.md` — the encoder and decoder blocks behind Whisper, wav2vec 2.0 and audio language models.
- `machine-learning/generative-models/generative-model-families.md` — the families that audio generators belong to.
