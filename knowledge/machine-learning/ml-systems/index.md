---
schema: topic-index/v1
kind: subtopic
topic: machine-learning/ml-systems
last-updated: 2026-11-25
---

# Machine learning in production

What changes when a model leaves the notebook: the maintenance debt that builds up around a model (entangled features, unstable data dependencies, undeclared consumers, feedback loops), detecting covariate, label and concept shift and training–serving skew, correcting a known shift (domain adaptation), making training runs repeatable (seeds, nondeterministic kernels, versioning data and models), and making models smaller and cheaper (int8 quantization, pruning, distillation, fp16/bf16 mixed precision). Every doc has a lab experiment with its full script. Not covered: generic service operation (see `operations/`), the IEEE 754 formats themselves (see `floating-point/`), and evaluation metrics (see `machine-learning/evaluation/`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [hidden-technical-debt.md](hidden-technical-debt.md) | concept | Entangled features (CACE, "changing anything changes everything"), glue code, pipeline jungles, data dependencies, undeclared consumers and feedback loops; a lab run where one feature change moves the other weights | verified |
| [data-drift-and-monitoring.md](data-drift-and-monitoring.md) | concept | Covariate, label and concept shift, training–serving skew, per-feature Kolmogorov–Smirnov (KS) tests with Bonferroni correction and score tests; why concept shift needs labels | verified |
| [reproducibility-and-determinism.md](reproducibility-and-determinism.md) | concept | Seeds in Python, NumPy, PyTorch and scikit-learn, float summation order, `torch.use_deterministic_algorithms`, versioning data, code and models | verified |
| [model-compression-and-quantization.md](model-compression-and-quantization.md) | concept | Symmetric int8 by hand, per-tensor vs per-channel and outliers, post-training vs quantization-aware, torchao status, fp16 vs bf16 ranges and the loss-scaling recipe | verified |
| [pruning-and-knowledge-distillation.md](pruning-and-knowledge-distillation.md) | concept | Magnitude pruning with retraining, global vs per-layer sparsity, CSR storage and when sparsity speeds inference, the PyTorch prune API; distillation with temperature-softened soft targets and the `T²` factor | verified |
| [domain-adaptation.md](domain-adaptation.md) | concept | Importance weights from a domain classifier and clipping, importance-weighted validation, BBSE for label shift, gradient reversal (DANN) in outline, the Ben-David bound and when adaptation is impossible | verified |

## References
- [Hidden Technical Debt in Machine Learning Systems (abstract)](https://papers.nips.cc/paper_files/paper/2015/hash/86df7dcfd896fcaf2674f757a2463eba-Abstract.html) — Sculley et al., NeurIPS 2015. Backs: topic scope (ML-specific maintenance risks).
- [Rules of Machine Learning](https://developers.google.com/machine-learning/guides/rules-of-ml) — Martin Zinkevich, Google for Developers, living. Backs: monitoring and training–serving skew practice.
- [Reproducibility](https://docs.pytorch.org/docs/2.15/notes/randomness.html) — PyTorch Foundation, PyTorch 2.15 docs. Backs: determinism scope.
- [Automatic Mixed Precision package - torch.amp](https://docs.pytorch.org/docs/2.15/amp.html) — PyTorch Foundation, PyTorch 2.15 docs. Backs: mixed-precision scope.

## Related
- `machine-learning/learning-path.md` — where this subtopic sits in the reading order.
- `machine-learning/lab-setup.md` — the lab every experiment ran in.
- `machine-learning/evaluation/` — metrics, leakage and calibration, which monitoring relies on.
- `floating-point/` — the number formats behind fp16, fp32 and summation-order effects.
- `machine-learning/transformers/fine-tuning-and-lora.md` — QLoRA's 4-bit quantization for fine-tuning.
