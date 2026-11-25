---
schema: topic-index/v1
kind: subtopic
topic: machine-learning/transformers
last-updated: 2026-11-25
---

# Transformers and large language models

The architecture behind large language models and how they are built and used, in the order a model meets them: text becomes tokens; tokens flow through attention blocks; the model is pretrained on next-token or masked prediction at a scale set by scaling laws; it is fine-tuned (fully or with LoRA) and aligned to human preferences (RLHF, DPO); and it generates text one token at a time with a decoding rule and a KV cache. Beyond text and the standard block: vision transformers, sparse mixture-of-experts layers, efficient attention and state-space models for long sequences, in-context learning and prompting, and multimodal models that feed images to a language model. Every doc has a lab experiment on a tiny synthetic model (PyTorch 2.15.0, CPU) whose full script is included. Not covered: building agents on top of LLMs (see `ai-agents/`); the deep-learning basics these docs build on (see `machine-learning/deep-learning/`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [tokenization.md](tokenization.md) | concept | BPE, WordPiece, Unigram/SentencePiece and byte-level BPE; a BPE trainer run and why token counts differ by text and language | verified |
| [attention-and-the-transformer.md](attention-and-the-transformer.md) | concept | Scaled dot-product attention and why √d_k, multi-head, causal mask, positions incl. RoPE, Post-LN vs Pre-LN, a block's parameter count | verified |
| [pretraining-and-scaling-laws.md](pretraining-and-scaling-laws.md) | concept | Next-token and masked-LM objectives, perplexity, Kaplan power laws, Chinchilla compute-optimal training and `6·N·D` | verified |
| [fine-tuning-and-lora.md](fine-tuning-and-lora.md) | concept | Full fine-tuning, instruction tuning/SFT, LoRA rank, alpha and merging, QLoRA's 4-bit base | verified |
| [alignment-rlhf-and-dpo.md](alignment-rlhf-and-dpo.md) | concept | Bradley–Terry reward models, RLHF with PPO and a KL penalty, the closed-form optimum and DPO | verified |
| [decoding-and-kv-cache.md](decoding-and-kv-cache.md) | concept | Greedy, beam, temperature, top-k, top-p; the KV cache, its memory formula, GQA/MQA and the cached-mask trap | verified |
| [vision-transformers.md](vision-transformers.md) | concept | ViT patch embedding as a strided convolution, class token, position embeddings, why ViT needs more data than a CNN, the hybrid model, DeiT distillation, Swin's windowed attention | verified |
| [mixture-of-experts.md](mixture-of-experts.md) | concept | The sparse MoE layer and top-k gating, the load-balancing auxiliary loss, capacity factor and dropped tokens, total vs active parameters, expert parallelism | verified |
| [efficient-attention-and-state-space-models.md](efficient-attention-and-state-space-models.md) | concept | Quadratic attention cost, FlashAttention (tiling, online softmax), SDPA backends, sliding-window and linear attention, S4 and Mamba in recurrent vs parallel form | verified |
| [in-context-learning-and-prompting.md](in-context-learning-and-prompting.md) | concept | Few-shot prompting; what demonstrations contribute (labels vs format, task recognition vs learning); induction heads; in-context linear regression and one linear-attention layer = one GD step; chain-of-thought; prompt sensitivity and contextual calibration | verified |
| [multimodal-models.md](multimodal-models.md) | concept | Bridging a frozen image encoder and a language model: LLaVA's projection and two stages, Flamingo's tanh-gated cross-attention and resampler, BLIP-2's Q-Former; visual instruction tuning; hallucination from language priors and co-occurrence | verified |

## References
- [Attention Is All You Need](https://arxiv.org/html/1706.03762v7) — Vaswani et al., 2017. Backs: the transformer architecture every doc builds on.
- [Attention Mechanisms and Transformers (Dive into Deep Learning, chapter 11)](https://d2l.ai/chapter_attention-mechanisms-and-transformers/index.html) — Zhang, Lipton, Li, Smola, living. Backs: textbook treatment of the subtopic.
- [torch.nn.functional.scaled_dot_product_attention](https://docs.pytorch.org/docs/2.15/generated/torch.nn.functional.scaled_dot_product_attention.html) — PyTorch 2.15 docs. Backs: the attention API the experiments use.
- [LLM Course, chapter 6: the Tokenizers library](https://huggingface.co/learn/llm-course/chapter6/5) — Hugging Face, living. Backs: tokenizer algorithms.

## Related
- `machine-learning/learning-path.md` — where this subtopic sits in the reading order.
- `machine-learning/lab-setup.md` — the lab every experiment ran in.
- `machine-learning/deep-learning/neural-networks-and-backpropagation.md` — backpropagation and autograd, used by every training run here.
- `machine-learning/deep-learning/normalization-and-dropout.md` — layer normalization inside each block.
- `machine-learning/reinforcement-learning/policy-gradients-and-ppo.md` — the RL algorithm behind RLHF.
- `ai-agents/tokenizers-for-coding-agents.md` — vendor tokenizers and measured token counts.
