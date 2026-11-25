---
schema: topic-index/v1
kind: subtopic
topic: machine-learning/privacy-preserving-ml
last-updated: 2026-11-25
---

# Privacy-preserving machine learning

Training and releasing models without exposing the people in the data: differential privacy and its mechanisms (Laplace, Gaussian, randomized response) and budget accounting, differentially private training (DP-SGD, differentially private stochastic gradient descent, with per-example gradients from `torch.func` and a Rényi-DP accountant), federated learning with FedAvg, non-IID (not independent and identically distributed) clients and secure aggregation, secure computation on data nobody sees (additively homomorphic Paillier encryption, fully homomorphic schemes in outline, secure multi-party computation with additive secret sharing and Beaver triples, garbled circuits and trusted execution environments in outline), and the membership-inference and memorization attacks that show why it matters. Every doc checks its mechanism with an experiment in numpy, PyTorch 2.15.0 on CPU or pure Python, with the full script inline; no DP, federated or cryptography library is used, and the cryptography is a toy with insecure parameters. Read `differential-privacy.md` first, then `differentially-private-training.md`; `membership-inference-and-memorization.md` measures what the others protect. Not covered: synthetic-data release, zero-knowledge proofs and private set intersection.

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [differential-privacy.md](differential-privacy.md) | concept | The (ε, δ) definition and its promise, sensitivity and clipping, Laplace and Gaussian mechanisms (classic vs exact calibration), sequential, parallel, advanced and Rényi composition, post-processing, central vs local model and randomized response | verified |
| [differentially-private-training.md](differentially-private-training.md) | concept | DP-SGD: Poisson lots, per-example clipping, Gaussian noise; per-example gradients with `torch.func` (`vmap` + `grad`); the moments accountant and RDP of the sampled Gaussian mechanism, checked against Abadi et al.'s ε ≈ 1.26; accuracy vs noise multiplier | verified |
| [federated-learning.md](federated-learning.md) | concept | FedAvg vs FedSGD, client fraction, local epochs and batch size, label-skewed clients, communication cost, label leakage from one update, pairwise-mask secure aggregation, user-level DP, what FL does and does not protect | verified |
| [membership-inference-and-memorization.md](membership-inference-and-memorization.md) | concept | The membership game and advantage, loss-threshold, shadow-model and LiRA attacks, TPR at low FPR vs AUC, overfitting vs memorization, canaries and exposure, training-data extraction, how DP bounds the attack and group privacy | verified |
| [secure-computation.md](secure-computation.md) | concept | Toy Paillier encryption (add ciphertexts, multiply by constants, an encrypted linear score), BFV/BGV/CKKS and noise in outline, ciphertext and time costs; 3-party additive secret sharing, Beaver-triple multiplication and a secure dot product; garbled circuits and enclaves in outline; what each protects next to DP and federated learning | verified |

## References
- [Differential Privacy Blog Series](https://www.nist.gov/itl/applied-cybersecurity/privacy-engineering/collaboration-space/blog-series/differential-privacy) — NIST (National Institute of Standards and Technology), 2020–2022. Backs: topic scope; the series several docs cite.
- [Programming Differential Privacy](https://programming-dp.com/) — Near, Abuah, living. Backs: topic scope; the free textbook behind the mechanism and composition claims.
- [Additive Noise Mechanisms (OpenDP User Guide)](https://docs.opendp.org/en/stable/api/user-guide/measurements/additive-noise-mechanisms.html) — OpenDP, living. Backs: a vetted DP library's view of the Laplace and Gaussian mechanisms.
- [Privacy-Enhancing Cryptography (PEC)](https://csrc.nist.gov/projects/pec) — NIST, living. Backs: topic scope for secure computation (MPC, FHE and other privacy-enhancing cryptography tools).
- [Opacus](https://opacus.ai/) — Opacus, living. Backs: how DP-SGD is packaged in practice for PyTorch.

## Related
- `machine-learning/learning-path.md` — where this subtopic sits in the reading order.
- `machine-learning/lab-setup.md` — the lab every experiment ran in.
- `machine-learning/deep-learning/distributed-training.md` — distributed training in a data center, the non-private relative of federated learning.
- `machine-learning/foundations/generalization-and-overfitting.md` — the train–test gap that membership inference exploits.
