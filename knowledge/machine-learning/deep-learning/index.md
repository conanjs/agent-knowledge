---
schema: topic-index/v1
kind: subtopic
topic: machine-learning/deep-learning
last-updated: 2026-11-25
---

# Deep learning

Neural networks and how they are trained, from the basics to advanced use: layers, backpropagation and PyTorch's autograd; the training loop and how to debug it; activations, initialization and vanishing or exploding gradients; optimizers, weight decay and learning-rate schedules; batch norm, layer norm and dropout, with their train and eval modes; data augmentation and transfer learning; convolutional networks, residual connections and the modern CNN lineage; recurrent networks, LSTM and GRU; embeddings and self-supervised (contrastive) learning; graph neural networks; training at scale with mixed precision, memory saving and distributed training; and understanding trained networks through attribution, adversarial robustness and loss landscapes. Each doc checks its mechanism with an experiment in PyTorch 2.15.0 on CPU, with the full script inline. Read `neural-networks-and-backpropagation.md` first, then `training-loop-and-debugging.md`; `machine-learning/learning-path.md` stage 6 gives the full order. Not covered: gradient descent, loss functions and L2 regularization in general (see `machine-learning/foundations/`), and attention, transformers, vision transformers and mixture-of-experts layers (see `machine-learning/transformers/`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [neural-networks-and-backpropagation.md](neural-networks-and-backpropagation.md) | concept | Layers and MLPs, why depth needs a nonlinearity (XOR), backpropagation as the chain rule in reverse, PyTorch autograd; hand gradients checked against autograd and finite differences | verified |
| [training-loop-and-debugging.md](training-loop-and-debugging.md) | concept | The PyTorch training loop (DataLoader, `zero_grad` → forward → loss → `backward` → `step`, `train()`/`eval()`/`no_grad`, checkpoints with optimizer state), reading loss curves, and a debugging playbook where each bug has a measured symptom | verified |
| [activations-and-initialization.md](activations-and-initialization.md) | concept | Sigmoid, tanh, ReLU and GELU; vanishing and exploding gradients; Xavier and He initialization and `calculate_gain`, measured through a 50-layer network | verified |
| [optimizers-and-learning-rate-schedules.md](optimizers-and-learning-rate-schedules.md) | concept | SGD, momentum, Nesterov, RMSprop, Adam; `Adam(weight_decay)` as L2 vs AdamW's decoupled decay; warmup and cosine decay with `lr_scheduler` | verified |
| [normalization-and-dropout.md](normalization-and-dropout.md) | concept | Batch norm with running statistics and its train vs eval outputs, layer norm, dropout's `1/(1 − p)` scaling | verified |
| [data-augmentation-and-transfer-learning.md](data-augmentation-and-transfer-learning.md) | concept | Label-preserving augmentation as a regularizer, mixup and CutMix, test-time augmentation; feature extraction vs fine-tuning, freezing, backbone learning rates, catastrophic forgetting and domain shift | verified |
| [convolutional-networks.md](convolutional-networks.md) | concept | Cross-correlation, the output-size formula, pooling, parameter sharing, receptive field, residual connections | verified |
| [modern-cnn-architectures.md](modern-cnn-architectures.md) | concept | LeNet → AlexNet → VGG → GoogLeNet → ResNet bottleneck → DenseNet → MobileNet (depthwise-separable) → EfficientNet (compound scaling) → ConvNeXt, with measured parameter and multiply-add counts | verified |
| [recurrent-networks.md](recurrent-networks.md) | concept | RNNs and backpropagation through time, vanishing and exploding gradients, LSTM and GRU gates, gradient-norm clipping, why attention replaced recurrence | verified |
| [embeddings-and-self-supervised-learning.md](embeddings-and-self-supervised-learning.md) | concept | `nn.Embedding` as a lookup table, cosine similarity, pretext tasks, InfoNCE and its temperature, SimCLR, CLIP, and representation collapse with how BYOL and SimSiam avoid it | verified |
| [graph-neural-networks.md](graph-neural-networks.md) | concept | Graphs as data, permutation equivariance, message passing; GCN normalization, GraphSAGE, GAT, readout; over-smoothing and the 1-WL (Weisfeiler–Lehman) limit and GIN | verified |
| [mixed-precision-and-memory-saving.md](mixed-precision-and-memory-saving.md) | concept | Where training memory goes, bf16/fp16 autocast, why fp16 gradients underflow and how `GradScaler` fixes it, gradient accumulation, activation checkpointing, `torch.compile` | verified |
| [distributed-training.md](distributed-training.md) | concept | DDP (bucketed all-reduce, `DistributedSampler`), ZeRO and FSDP2 sharding, Megatron tensor parallelism, the pipeline bubble, sequence/context/expert parallelism, collectives; real 2-process DDP lab | verified |
| [interpretability-and-attribution.md](interpretability-and-attribution.md) | concept | Gradient saliency, gradient×input, integrated gradients (completeness, baselines), SmoothGrad, Grad-CAM, randomization sanity checks, probes with controls, features, circuits, superposition and sparse autoencoders | verified |
| [adversarial-robustness.md](adversarial-robustness.md) | concept | Adversarial examples and the linearity explanation, threat models, FGSM, PGD, adversarial training, the robustness–accuracy trade-off, obfuscated gradients, randomized smoothing | verified |
| [loss-landscapes-and-generalization.md](loss-landscapes-and-generalization.md) | concept | Saddle points vs minima, flat vs sharp minima and batch size, the reparameterization critique, SGD noise scale, filter-normalized plots, mode connectivity, grokking, lottery tickets | verified |

## References
- [Dive into Deep Learning](https://d2l.ai/) — Zhang, Lipton, Li, Smola, living. Backs: topic scope; the textbook most docs here cite.
- [PyTorch 2.15 documentation](https://docs.pytorch.org/docs/2.15/) — PyTorch, 2026. Backs: the library behaviour every experiment checks.
- [Deep Learning](https://www.deeplearningbook.org/) — Goodfellow, Bengio, Courville, 2016. Backs: topic scope (feed-forward networks, backpropagation).

## Related
- `machine-learning/learning-path.md` — where this subtopic sits in the reading order.
- `machine-learning/lab-setup.md` — the lab every experiment ran in.
- `machine-learning/foundations/gradient-descent.md` — the optimization basics these docs build on.
- `machine-learning/transformers/attention-and-the-transformer.md` — the next step after recurrent and convolutional networks.
