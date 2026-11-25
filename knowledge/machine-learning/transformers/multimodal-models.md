---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/transformers
status: verified
applies-to: ["any", "PyTorch 2.15.0 (lab)"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, transformers, multimodal, vision-language-models, llava, flamingo, blip-2, q-former, perceiver-resampler, gated-cross-attention, visual-instruction-tuning, hallucination]
---

# Multimodal models: connecting an image encoder to a language model

## Summary
**TL;DR:** A vision-language model rarely starts from scratch. It reuses a pretrained image encoder and a pretrained language model, and trains a bridge between them. A joint embedding (CLIP-style, Contrastive Language–Image Pre-training) aligns two encoders for retrieval but writes no text. To make a language model talk about an image, there are three common bridges. LLaVA (Large Language and Vision Assistant) multiplies each image-patch feature by a matrix `W` and inserts the results into the prompt as extra tokens. Flamingo inserts new cross-attention layers between the frozen language-model layers, each scaled by `tanh(α)` with `α = 0` at the start, so the untrained model is exactly the text-only model. BLIP-2 (Bootstrapping Language-Image Pre-training) lets 32 learned queries read the image and hands their outputs to the frozen model as a soft prompt. Visual instruction tuning then fine-tunes on machine-written conversations about images. Such models inherit the language model's guesses: they describe what is likely given the text or what usually co-occurs, not only what is in the image.
**Use this when:** you choose or read the architecture of an image-to-text model, decide which parts to freeze and train, count the visual tokens an image adds to the context, or investigate a captioner or visual assistant that describes things that are not there.
**Not this doc:** contrastive image–text training (CLIP and its InfoNCE, information noise-contrastive estimation, loss) → `machine-learning/deep-learning/embeddings-and-self-supervised-learning.md`; how a ViT (vision transformer) turns an image into patch tokens → `machine-learning/transformers/vision-transformers.md`; attention and cross-attention themselves → `machine-learning/transformers/attention-and-the-transformer.md`; instruction tuning and LoRA (low-rank adaptation) in general → `machine-learning/transformers/fine-tuning-and-lora.md`; few-shot prompting → `machine-learning/transformers/in-context-learning-and-prompting.md`.

## Problem
A language model reads vectors from its word-embedding table; an image encoder outputs a grid of feature vectors in a different space, for example `257 × 1024` for a ViT-L/14 ✅[^3]. Training one model on images and text from scratch throws away two expensive pretrained models. Fine-tuning the language model on image–text pairs risks catastrophic forgetting of its language skills ✅[^3] ✅[^1]. Something must translate between the two spaces, and the choice decides what is trained, how many tokens each image costs and what can go wrong. A bridge can also look good for the wrong reason. In the lab, the toy bridges captioned images like their training data with 0.686 to 0.898 of captions exactly right. On images whose colour broke the usual shape–colour pairing, the shape was right at most 0.194 of the time ✅[^5].

## Mental model
**Analogy:** a photographer who only speaks "pixels" and a writer who only speaks "words". LLaVA hires a phrasebook translator: each photo region becomes a pseudo-word dropped into the writer's notes. Flamingo lets the writer peek through a window at the photographer's notes while writing each sentence; the window starts shut (gate 0) and opens as training shows it helps. BLIP-2 sends a reporter with a fixed list of 32 questions; only the 32 answers reach the writer. Hallucination is the writer filling gaps with habit: if photos of squares were nearly always red, a blue square risks being written up as whatever shape is usually blue.

**Artifact:** the three bridges built on the same frozen toy language model (70,551 parameters) and frozen image encoder, with their trainable parameters and the tokens each adds to the language model's input (`LM` in the output). Printed by the full script in the Worked example; lab run (`machine-learning/lab-setup.md`), 2026-11-25, PyTorch 2.15.0 ✅[^5]:

```text
Flamingo-style at initialization: max |logit difference| vs the text-only LM = 0.0e+00
LLaVA-style, stage 1: W only    trainable   4160  LM tokens +4 | common: exact 0.686 | rare: exact 0.000 shape 0.194 colour 0.496 | wrong shapes that usually have the seen colour 0.615
Flamingo-style gated x-attn     trainable  71108  LM tokens +0 | common: exact 0.893 | rare: exact 0.069 shape 0.155 colour 0.797 | wrong shapes that usually have the seen colour 0.792
BLIP-2-style Q-Former           trainable  75460  LM tokens +3 | common: exact 0.898 | rare: exact 0.079 shape 0.157 colour 0.830 | wrong shapes that usually have the seen colour 0.792
```

## How it works
Where each bridge connects (drawn by hand, not program output; LM is the language model, FC a fully connected layer):

```text
LLaVA:     image -> encoder -> patch features Z -> W·Z = visual tokens --+
                                                                        +-> [text tokens] -> LM (trained in stage 2)
Flamingo:  image -> encoder -> resampler -> 64 visual tokens ---------> keys/values of new gated cross-attention
                                                                         layers between frozen LM layers
BLIP-2:    image -> encoder -> Q-Former (32 learned queries) -> FC -> 32 soft prompt vectors -> frozen LM
```

### Joint embedding, for contrast
CLIP-style training gives an image encoder and a text encoder whose matching pairs score high; the mechanism is in `machine-learning/deep-learning/embeddings-and-self-supervised-learning.md`. Flamingo's authors note that their generative model lags contrastive models on classification, and that contrastive models directly optimize image–text retrieval, of which classification is a special case. In return their model handles a wider range of tasks, including open-ended ones: a contrastive model only scores image–text similarity and cannot generate language ✅[^1]. Both Flamingo and LLaVA start from a contrastively trained image encoder: an NFNet-F6 (Normalizer-Free ResNet) trained with CLIP's two-term loss, and the CLIP ViT-L/14 respectively ✅[^1] ✅[^2].

### Projection into token space (LLaVA)
1. **The bridge:** a trainable matrix `W` maps the grid features `Z_v` to visual tokens `H_v = W · Z_v` with the width of the language model's word embeddings ✅[^2]. Example: 4 patch features of width 64 and a 64-wide model need a `64 × 64` matrix plus bias, the 4,160 parameters in the artifact. Every feature vector it is given becomes one token in the context; a ViT-L/14 yields `257 × 1024` features per image in BLIP-2's setup ✅[^3].
2. **Stage 1, feature alignment:** CC3M (the Conceptual Captions 3M dataset) is filtered to 595K image–caption pairs. Both the encoder and the language model stay frozen and only `W` is trained, which the authors describe as training a compatible visual tokenizer for the frozen model ✅[^2].
3. **Stage 2, end to end:** the encoder stays frozen, and `W` and the language model are both updated ✅[^2]. On ScienceQA (a science question-answering benchmark), skipping stage 1 dropped accuracy from 90.92 % to 85.81 %. Features from the layer before CLIP's last scored 0.96 points above last-layer features ✅[^2].
4. **Why so simple:** the authors chose the lightweight projection to iterate quickly on data, and name Flamingo's gated cross-attention and BLIP-2's Q-Former as more sophisticated options ✅[^2].

### Gated cross-attention into a frozen model (Flamingo)
1. **Perceiver Resampler:** learned latent queries cross-attend to the variable number of image features and output a fixed 64 visual tokens. In the ablations it beat a plain transformer and an MLP (multilayer perceptron) given the same parameter budget ✅[^1].
2. **Gated xattn-dense layers:** new layers, trained from scratch, are inserted between the frozen language-model blocks. Their queries come from the text, their keys and values from the visual tokens, and a dense feed-forward layer follows ✅[^1].
3. **The gate:** each new layer's output is multiplied by `tanh(α)` before it joins the residual stream, `x ← x + tanh(α) · xattn(x, visual)`. Here `α` is one learnable scalar per layer, initialized to 0, so at initialization the model's output equals the pretrained language model's ✅[^1]. Example: `α = 0` adds nothing; `α = 0.5` adds `0.462` of the layer's output. Removing the gate cost 4.2 % of the overall score and made training unstable ✅[^1]. The lab check prints `0.0e+00` logit difference at initialization ✅[^5].
4. **How often:** a gated layer before every block for Flamingo-3B, every 4th for Flamingo-9B, every 7th for Flamingo-80B. Every 4th trained 66 % faster for a 1.9 % lower score ✅[^1]. Freezing the pretrained vision encoder and language model keeps almost 90 % of Flamingo-80B's weights fixed ✅[^1].
5. **Interleaved images:** each text token cross-attends only to the image just before it. That let a model trained with at most 5 images per sequence use up to 32 image–text examples at evaluation ✅[^1]. The interleaved web dataset M3W (MultiModal MassiveWeb) mattered: removing it cost more than 17 % ✅[^1].

### Learned queries (BLIP-2's Q-Former)
1. **The module:** the Q-Former (Querying Transformer) holds 32 learned query vectors of width 768. They interact through self-attention and read the frozen image features through cross-attention inserted every other block. In total it has 188M parameters, initialized from BERT-base (Bidirectional Encoder Representations from Transformers) ✅[^3]. Its output, `32 × 768`, is much smaller than the `257 × 1024` features it reads: a bottleneck ✅[^3].
2. **Stage 1, representation learning with a frozen image encoder:** three losses on image–text pairs. Contrastive alignment of queries and text (ITC, image–text contrastive learning); text generation conditioned on the queries (ITG, image-grounded text generation); and matched-or-not classification (ITM, image–text matching) ✅[^3].
3. **Stage 2, generative learning with a frozen LLM (large language model):** a fully connected layer projects the query outputs to the LLM's embedding width, and they are prepended to the text as soft visual prompts ✅[^3]. Without stage 1, zero-shot VQA (visual question answering) was much lower, and the OPT (Open Pre-trained Transformer) decoder suffered catastrophic forgetting ✅[^3].
4. **Result:** 8.7 % above Flamingo-80B on zero-shot VQAv2 (version 2 of the VQA benchmark) with 54× fewer trainable parameters ✅[^3].

### Visual instruction tuning
LLaVA wrote its training conversations with a text-only GPT-4 (Generative Pre-trained Transformer 4). GPT-4 never saw the images, only their captions and bounding boxes as text ✅[^2]. The few seed examples were the only human annotation. The result was 158K samples: 58K conversations, 23K detailed descriptions and 77K complex-reasoning answers ✅[^2]. The cheap alternative, wrapping each caption as `Human: <question> <image> Assistant: <caption>`, lacks diversity and in-depth reasoning ✅[^2]. Only the assistant's answers count in the loss ✅[^2]. Instruction tuning improved instruction following by over 50 points in their ablation ✅[^2].

### What these models get wrong
1. **Answers likely from text alone:** Flamingo sometimes answers what seems likely given the text only, guesses when the image cannot settle the question, and can be pushed into such answers by an irrelevant question. Its authors suspect the priors inherited from the frozen language model ✅[^1]. LLaVA likewise may generate outputs not grounded in its input ✅[^2].
2. **Co-occurring objects:** Li et al., who proposed POPE (Polling-based Object Probing Evaluation), found that the five large vision-language models they tested tend to hallucinate objects that are frequent in the visual-instruction data or that co-occur with the objects in the image. On MSCOCO (Microsoft Common Objects in Context), about half of each image's hallucinated objects were among the 10 most frequent objects, and more than half among the 10 objects that most often co-occur with those present ✅[^4]. POPE measures this with yes-or-no questions about objects that are or are not present ✅[^4].
3. **Bag of patches:** LLaVA answered yes to "strawberry-flavored yogurt?" for a fridge holding yogurt and strawberries separately ✅[^2].
4. **Inherited limits:** Flamingo's language model was trained on 2,048-token sequences, so long multi-image prompts (4,096–8,192 tokens for 32 shots of VisDial, a visual dialogue benchmark) were capped at 16 shots ✅[^1]. BLIP-2 inherits inaccurate knowledge and wrong reasoning paths from the LLM. It shows no in-context learning gain, which its authors attribute to training on one image–text pair per sample ✅[^3].

## Worked example
A toy world: 8 × 8 RGB (red, green, blue) images with one shape (square, plus, cross, bar) in one of four quadrants, coloured red, green, blue or yellow, plus noise. Captions read `square is red at top-left`. In the training images a shape has its usual colour (square–red, plus–green, cross–blue, bar–yellow) 85 % of the time.
1. A 2-layer language model (width 64) is pretrained on captions only, and on captions after a shuffled list of their own words, so it learns to copy words from its context. Then it is frozen.
2. The frozen image encoder is a fixed random ReLU (rectified linear unit) layer over each of the 4 quadrant patches, plus a fixed code per patch position.
3. Each bridge trains for 1,500 steps on 20,000 image–caption pairs and is scored by greedy decoding. "Common" test images have the usual colour, "rare" ones never.
4. Simplifications: the Flamingo-style bridge reads the 4 patch features directly, without a resampler; the Q-Former has 3 queries and skips BLIP-2's stage 1.
5. The last line retrains the Flamingo-style bridge on balanced images, where colour says nothing about shape.

The gate, as implemented:

```python
x = x + (torch.tanh(s.a1) * h if s.gated else h)      # h = cross-attention output; a1 starts at 0
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-25, PyTorch 2.15.0, two runs identical ✅[^5]:

```text
frozen LM 70551 parameters; frozen encoder 3136; training images with the shape's usual colour 0.846
text only (no image)            trainable      0  LM tokens +0 | common: exact 0.056 | rare: exact 0.000 shape 0.228 colour 0.261 | wrong shapes that usually have the seen colour 0.338
Flamingo-style at initialization: max |logit difference| vs the text-only LM = 0.0e+00
LLaVA-style, stage 1: W only    trainable   4160  LM tokens +4 | common: exact 0.686 | rare: exact 0.000 shape 0.194 colour 0.496 | wrong shapes that usually have the seen colour 0.615
LLaVA-style, stage 2: W + LM    trainable  74711  LM tokens +4 | common: exact 0.812 | rare: exact 0.000 shape 0.142 colour 0.636 | wrong shapes that usually have the seen colour 0.741
Flamingo-style gated x-attn     trainable  71108  LM tokens +0 | common: exact 0.893 | rare: exact 0.069 shape 0.155 colour 0.797 | wrong shapes that usually have the seen colour 0.792
  learned gates tanh(alpha): [-0.28, -0.17] [0.07, 0.25]
BLIP-2-style Q-Former           trainable  75460  LM tokens +3 | common: exact 0.898 | rare: exact 0.079 shape 0.157 colour 0.830 | wrong shapes that usually have the seen colour 0.792
Flamingo-style, balanced images trainable  71108  LM tokens +0 | common: exact 0.096 | rare: exact 0.180 shape 0.368 colour 0.525 | wrong shapes that usually have the seen colour 0.146
```

<details><summary>Full script (prints the output above)</summary>

```python
# Three ways to feed a frozen image encoder's features to a small pretrained language model (PyTorch, CPU):
# a linear projection into token space (LLaVA-style), gated cross-attention into a frozen LM (Flamingo-style),
# and learned queries that cross-attend to the image (BLIP-2-style Q-Former, without its first stage).
import torch, torch.nn as nn, torch.nn.functional as F
torch.manual_seed(0)
g = torch.Generator().manual_seed(0)
SHAPES, COLORS = ["square", "plus", "cross", "bar"], ["red", "green", "blue", "yellow"]
POS = ["top-left", "top-right", "bottom-left", "bottom-right"]
VOCAB = ["<pad>", "<bos>", "<sep>", "<eos>", "is", "at", "the"] + SHAPES + COLORS + POS
ID = {w: i for i, w in enumerate(VOCAB)}
PAT = torch.tensor([[[1, 1, 1], [1, 0, 1], [1, 1, 1]], [[0, 1, 0], [1, 1, 1], [0, 1, 0]],
                    [[1, 0, 1], [0, 1, 0], [1, 0, 1]], [[0, 0, 0], [1, 1, 1], [0, 0, 0]]]).float()
RGB = torch.tensor([[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0]]).float()

def attrs(B, mode):                               # "train": colour = the shape's usual colour 85 % of the time; "balanced": 25 %; "common", "rare"
    s, p = torch.randint(0, 4, (B,), generator=g), torch.randint(0, 4, (B,), generator=g)
    other = (s + torch.randint(1, 4, (B,), generator=g)) % 4         # any colour except the favourite (colour index = shape index)
    fav = torch.rand(B, generator=g) < {"train": 0.85, "balanced": 0.25}[mode] if mode in ("train", "balanced") \
        else torch.full((B,), mode == "common")
    return s, torch.where(fav, s, other), p
def render(s, c, p):                              # 3 x 8 x 8 image, shape in one quadrant with jitter, noise; -> 4 patches of 48 values
    img = 0.3 * torch.randn(len(s), 3, 8, 8, generator=g)
    jr, jc = torch.randint(0, 2, (2, len(s)), generator=g)
    for b in range(len(s)):
        r0, c0 = 4 * (p[b] // 2) + jr[b], 4 * (p[b] % 2) + jc[b]
        img[b, :, r0:r0 + 3, c0:c0 + 3] += PAT[s[b]] * RGB[c[b]][:, None, None]
    return img.reshape(-1, 3, 2, 4, 2, 4).permute(0, 2, 4, 1, 3, 5).reshape(-1, 4, 48)
def caption(s, c, p):                             # <sep> shape is colour at position <eos>
    w = lambda lst, i: torch.tensor([ID[lst[j]] for j in i])
    n = len(s)
    return torch.stack([torch.full((n,), ID["<sep>"]), w(SHAPES, s), torch.full((n,), ID["is"]), w(COLORS, c),
                        torch.full((n,), ID["at"]), w(POS, p), torch.full((n,), ID["<eos>"])], 1)
encoder = nn.Linear(48, 64)                       # frozen image encoder: random features + a fixed code per patch position
pos_code = torch.randn(4, 64, generator=g)
for q in encoder.parameters(): q.requires_grad_(False)
def encode(patches): return torch.relu(encoder(patches)) + pos_code

class Block(nn.Module):                           # pre-LN transformer block; gated=True gives Flamingo's tanh-gated version
    def __init__(s, cross=False, gated=False, d=64):
        super().__init__()
        s.cross, s.gated = cross, gated
        s.ln1, s.ln2, s.att = nn.LayerNorm(d), nn.LayerNorm(d), nn.MultiheadAttention(d, 4, batch_first=True)
        s.ff = nn.Sequential(nn.Linear(d, 128), nn.GELU(), nn.Linear(128, d))
        s.a1, s.a2 = nn.Parameter(torch.zeros(1)), nn.Parameter(torch.zeros(1))   # gates start at tanh(0) = 0
    def forward(s, x, kv=None, mask=None):
        h = s.ln1(x)
        h = s.att(h, kv, kv, need_weights=False)[0] if s.cross else s.att(h, h, h, attn_mask=mask, need_weights=False)[0]
        x = x + (torch.tanh(s.a1) * h if s.gated else h)
        h = s.ff(s.ln2(x))
        return x + (torch.tanh(s.a2) * h if s.gated else h)
class LM(nn.Module):
    def __init__(s, d=64):
        super().__init__()
        s.emb, s.pos = nn.Embedding(len(VOCAB), d), nn.Parameter(0.02 * torch.randn(16, d))
        s.blocks, s.lnf, s.out = nn.ModuleList([Block(), Block()]), nn.LayerNorm(d), nn.Linear(d, len(VOCAB))
    def forward(s, ids, prefix=None, xattn=None, vis=None):     # ids start with <bos>; prefix vectors go right after it
        e = s.emb(ids)
        if prefix is not None: e = torch.cat([e[:, :1], prefix, e[:, 1:]], 1)
        e = e + s.pos[:e.shape[1]]
        mask = torch.ones(e.shape[1], e.shape[1]).triu(1).bool()
        for i, b in enumerate(s.blocks):
            if xattn is not None: e = xattn[i](e, vis)
            e = b(e, mask=mask)
        return s.out(s.lnf(e))

# 1. Pretrain the language model on text only: plain captions, and captions after a context that lists their words
lm = LM(); opt = torch.optim.AdamW(lm.parameters(), lr=2e-3)
def text_batch(B):
    s, c, p = attrs(B, "train"); cap = caption(s, c, p)
    rows = []
    for b in range(B):
        ctx = []
        if b % 2:                                 # context: the 3 caption words plus 0-2 fillers, shuffled
            ctx = [cap[b, 1].item(), cap[b, 3].item(), cap[b, 5].item()] + [ID["the"]] * int(torch.randint(0, 3, (1,), generator=g))
            ctx = [ctx[i] for i in torch.randperm(len(ctx), generator=g)]
        rows.append(torch.tensor([ID["<bos>"]] + ctx + cap[b].tolist()))
    return nn.utils.rnn.pad_sequence(rows, batch_first=True, padding_value=ID["<pad>"])
for step in range(2000):
    x = text_batch(128)
    loss = F.cross_entropy(lm(x[:, :-1]).transpose(1, 2), x[:, 1:], ignore_index=ID["<pad>"])
    opt.zero_grad(); loss.backward(); opt.step()
for q in lm.parameters(): q.requires_grad_(False)

# 2. The bridges
class Projection(nn.Module):                      # LLaVA-style: H = W . Z, one visual token per patch
    def __init__(s): super().__init__(); s.W = nn.Linear(64, 64)
    def forward(s, ids, z): return lm(ids, prefix=s.W(z))
class GatedXAttn(nn.Module):                      # Flamingo-style: new gated cross-attention block before each frozen LM block
    def __init__(s): super().__init__(); s.kv, s.x = nn.Linear(64, 64), nn.ModuleList([Block(True, True), Block(True, True)])
    def forward(s, ids, z): return lm(ids, xattn=s.x, vis=s.kv(z))
class QFormer(nn.Module):                         # BLIP-2-style: 3 learned queries read the image, then a linear layer
    def __init__(s, n_q=3):
        super().__init__()
        s.q, s.kv = nn.Parameter(0.02 * torch.randn(n_q, 64)), nn.Linear(64, 64)
        s.self_blk, s.cross_blk, s.fc = Block(), Block(cross=True), nn.Linear(64, 64)
    def forward(s, ids, z):
        q = s.self_blk(s.q.expand(len(z), -1, -1))
        return lm(ids, prefix=s.fc(s.cross_blk(q, s.kv(z))))
def n_trainable(m): return sum(q.numel() for q in m.parameters() if q.requires_grad)

N_TRAIN = 20000
S, C, P = attrs(N_TRAIN, "train"); Z_TRAIN, CAP_TRAIN = encode(render(S, C, P)), caption(S, C, P)
def train(bridge, steps=1500, lr=1e-3, Z_TRAIN=Z_TRAIN, CAP_TRAIN=CAP_TRAIN):
    opt = torch.optim.AdamW([q for q in bridge.parameters() if q.requires_grad], lr=lr)
    for step in range(steps):
        i = torch.randint(0, N_TRAIN, (128,), generator=g)
        ids = torch.cat([torch.full((128, 1), ID["<bos>"]), CAP_TRAIN[i]], 1)
        logits = bridge(ids[:, :-1], Z_TRAIN[i])[:, -6:]          # predictions after <sep>: shape is colour at position <eos>
        loss = F.cross_entropy(logits.transpose(1, 2), ids[:, -6:])
        opt.zero_grad(); loss.backward(); opt.step()
TEST = {m: attrs(1000, m) for m in ("common", "rare")}
TEST_Z = {m: encode(render(*TEST[m])) for m in TEST}
def evaluate(bridge):                             # greedy decoding of 6 tokens after <sep>
    out = {}
    for m, (s, c, p) in TEST.items():
        ids = torch.tensor([[ID["<bos>"], ID["<sep>"]]] * 1000)
        with torch.no_grad():
            for _ in range(6):
                nxt = (bridge(ids, TEST_Z[m]) if bridge else lm(ids))[:, -1].argmax(-1)
                ids = torch.cat([ids, nxt[:, None]], 1)
        cap = caption(s, c, p)[:, 1:]
        shape_ok = ids[:, 2] == cap[:, 0]
        usual = (ids[:, 2] - ID["square"] == c) & ~shape_ok    # wrong shape = the shape that usually has this colour
        out[m] = ((ids[:, 2:8] == cap).all(1).float().mean().item(), shape_ok.float().mean().item(),
                  (ids[:, 4] == cap[:, 2]).float().mean().item(), (usual.sum() / (~shape_ok).sum()).item())
    return out
def report(name, bridge, trainable, extra_tokens):
    r = evaluate(bridge)
    print(f"{name:<31} trainable {trainable:6d}  LM tokens +{extra_tokens} | common: exact {r['common'][0]:.3f} | "
          f"rare: exact {r['rare'][0]:.3f} shape {r['rare'][1]:.3f} colour {r['rare'][2]:.3f} | "
          f"wrong shapes that usually have the seen colour {r['rare'][3]:.3f}")

N_LM = sum(q.numel() for q in lm.parameters())
print(f"frozen LM {N_LM} parameters; frozen encoder {sum(q.numel() for q in encoder.parameters())}; "
      f"training images with the shape's usual colour {(S == C).float().mean():.3f}")
report("text only (no image)", None, 0, 0)
fl = GatedXAttn()
ids = torch.cat([torch.full((1000, 1), ID["<bos>"]), caption(*TEST["common"])], 1)
with torch.no_grad():
    print(f"Flamingo-style at initialization: max |logit difference| vs the text-only LM = "
          f"{(fl(ids, TEST_Z['common']) - lm(ids)).abs().max().item():.1e}")
pj = Projection(); train(pj); report("LLaVA-style, stage 1: W only", pj, n_trainable(pj), 4)
for q in lm.parameters(): q.requires_grad_(True)
lm_backup = {k: v.clone() for k, v in lm.state_dict().items()}
train(pj, lr=3e-4); report("LLaVA-style, stage 2: W + LM", pj, n_trainable(pj) + N_LM, 4)
lm.load_state_dict(lm_backup)
for q in lm.parameters(): q.requires_grad_(False)
train(fl); report("Flamingo-style gated x-attn", fl, n_trainable(fl), 0)
print("  learned gates tanh(alpha):", [round(torch.tanh(b.a1).item(), 2) for b in fl.x], [round(torch.tanh(b.a2).item(), 2) for b in fl.x])
qf = QFormer(); train(qf); report("BLIP-2-style Q-Former", qf, n_trainable(qf), 3)
S2, C2, P2 = attrs(N_TRAIN, "balanced")
fl2 = GatedXAttn(); train(fl2, Z_TRAIN=encode(render(S2, C2, P2)), CAP_TRAIN=caption(S2, C2, P2))
report("Flamingo-style, balanced images", fl2, n_trainable(fl2), 0)
```

</details>

Reading it, line by line:
- **Text only:** without the image, greedy decoding always writes the same caption with the shape's usual colour. It is right only when a common image happens to have that shape and position, about `1/4 × 1/4 = 0.0625` (lab 0.056), and never on a rare image.
- **Gate:** at initialization the Flamingo-style model's logits equal the text-only model's to the last bit (`0.0e+00`). After training the gates sit at −0.28, −0.17, 0.07 and 0.25: the new layers have been switched on, as Flamingo observed ✅[^1].
- **LLaVA-style stages:** `W` alone, 4,160 parameters, reaches 0.686 on common images. Also training the language model (74,711 parameters) raises it to 0.812. That is the direction of LLaVA's two stages, although this toy's stage 2 reuses the captions instead of instruction data.
- **Flamingo- and BLIP-2-style:** about 71–75K trainable parameters each, with the language model frozen, reach about 0.89. The Flamingo-style bridge adds no tokens to the input; the Q-Former adds 3.
- **Rare images:** every bridge reads the colour reasonably (0.50–0.83) but gets the shape right only 0.14–0.19 of the time, below the 0.228 of the text-only model's fixed guess. Of the wrong shapes, 62–79 % are the shape that usually has the seen colour, against 34 % for the text-only model. The toy bridges learned "blue means cross", a small-scale analogue of the co-occurrence finding behind POPE ✅[^4].
- **Balanced control:** trained where colour carries no shape information, the same bridge stops naming the colour's usual shape (0.146, below the text-only 0.338), and its rare-image shape accuracy rises from 0.155 to 0.368. It is still poor overall in this budget (0.096 exact on common images): shape is the hard cue to read here. So the correlated bridges' 0.89 on common images rested mostly on colour, which the rare images expose.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Untrained gated cross-attention | Output identical to the text-only model (lab `0.0e+00`) | `tanh(0) = 0` ✅[^1]; lab ✅[^5] |
| Flamingo without the tanh gate | 4.2 % lower overall score, unstable training | Ablation ✅[^1] |
| Training the language model on image–text pairs | Can forget language skills | Catastrophic forgetting, why BLIP-2 and Flamingo freeze it ✅[^3] ✅[^1] |
| Q-Former without its first stage | Much lower zero-shot VQA; OPT forgets | The queries never learned text-relevant features ✅[^3] |
| LLaVA without stage 1 | ScienceQA 85.81 % instead of 90.92 % | Features were never aligned to word embeddings ✅[^2] |
| Large feature grid in a projection model | One context token per feature vector (ViT-L/14: 257 in BLIP-2's setup) | No resampling ✅[^2] ✅[^3] |
| Few-shot prompts with several images | Works for Flamingo (up to 32 shots), not for BLIP-2 | Interleaved training data vs one pair per sample ✅[^1] ✅[^3] |
| Prompt longer than the language model's training length | Fewer shots fit (VisDial capped at 16) | Inherited from the language model ✅[^1] |
| Object that usually co-occurs with what is shown | Named although absent | Co-occurrence hallucination ✅[^4]; lab 0.792 of wrong shapes ✅[^5] |
| Two objects that are separately present | Treated as one combined concept ("strawberry yogurt") | Bag-of-patches reading ✅[^2] |
| Classification benchmark | Lags a contrastive model | Contrastive training optimizes retrieval directly ✅[^1] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Joint embedding (CLIP-style) | Leads on classification, a retrieval-like task ✅[^1] | Only scores image–text similarity: cannot generate language, so less suited to captioning or VQA ✅[^1] |
| Linear projection (LLaVA) | Lightweight, fast to iterate ✅[^2]; lab: 4,160 parameters ✅[^5] | One context token per feature vector ✅[^2]; stage 2 trains the whole language model ✅[^2] |
| Gated cross-attention (Flamingo) | Language model frozen, identical at initialization; no extra input tokens; interleaved few-shot ✅[^1] | New layers are large (1.4B extra parameters in Flamingo-3B); frequency trades speed for score ✅[^1] |
| Q-Former (BLIP-2) | 54× fewer trainable parameters than Flamingo-80B and +8.7 % on zero-shot VQAv2; 32 tokens ✅[^3] | Two pretraining stages; no in-context gain ✅[^3] |

## Takeaways
- Evaluate a vision-language model on images that break the training co-occurrences, not only on images like the training set; accuracy on typical images can come from the language prior or from correlations. [rule-candidate]
- When you add new layers to a pretrained model, initialize them so the model's output is unchanged (a zero gate or zero-initialized output projection) and check it with a logit difference of 0. [rule-candidate]
- Count visual tokens per image before choosing a bridge: a projection costs one context token per feature vector; resamplers and Q-Formers cap it.
- Freeze the language model unless you also guard its text abilities; LLaVA's stage 2 updates it, Flamingo and BLIP-2 do not.

## Verification status
- Verified: 70 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [Flamingo: a Visual Language Model for Few-Shot Learning](https://arxiv.org/html/2204.14198v2) — Alayrac et al., 2022. Backs: contrastive models' lack of language generation, NFNet-F6 with a contrastive loss, the Perceiver Resampler and its 64 tokens, gated xattn-dense layers and the `tanh(α)` gate, the gate and frequency ablations, freezing, per-image masking and 32 shots, M3W, limitations (classification, hallucination, sequence length). [^1]
- [Visual Instruction Tuning](https://arxiv.org/html/2304.08485v2) — Liu, Li, Wu, Lee, 2023. Backs: CLIP ViT-L/14, `H_v = W · Z_v`, the two training stages and their data, the ScienceQA ablations, GPT-4-generated instruction data, the loss on answers, hallucination and the bag-of-patches failure. [^2]
- [BLIP-2: Bootstrapping Language-Image Pre-training with Frozen Image Encoders and Large Language Models](https://arxiv.org/html/2301.12597v3) — Li, Li, Savarese, Hoi, 2023. Backs: the Q-Former (32 × 768 queries, 188M parameters, BERT-base start), the `257 × 1024` features, the two stages and their losses, soft visual prompts, forgetting without stage 1, the VQAv2 comparison, limitations. [^3]
- [Evaluating Object Hallucination in Large Vision-Language Models](https://arxiv.org/html/2305.10355v3) — Li et al., 2023. Backs: object hallucination tied to frequent and co-occurring objects, the half-of-hallucinations statistic, the POPE polling method. [^4]
- `machine-learning/lab-setup.md` — the lab where the projection, gated cross-attention and Q-Former bridges and the co-occurrence test ran on 2026-11-25. [^5]

## Related
- `machine-learning/deep-learning/embeddings-and-self-supervised-learning.md` — CLIP's contrastive training, which produces the image encoders reused here.
- `machine-learning/transformers/vision-transformers.md` — how the image encoder turns patches into feature vectors.
- `machine-learning/transformers/attention-and-the-transformer.md` — self- and cross-attention inside every bridge.
- `machine-learning/transformers/fine-tuning-and-lora.md` — instruction tuning and parameter-efficient training of the language model.
- `machine-learning/transformers/in-context-learning-and-prompting.md` — the few-shot prompting Flamingo extends to images.
- `machine-learning/deep-learning/data-augmentation-and-transfer-learning.md` — reusing frozen pretrained networks in general.
