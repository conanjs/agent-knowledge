---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/privacy-preserving-ml
status: verified
applies-to: ["any"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, privacy, membership-inference, shadow-models, lira, overfitting, memorization, canary, exposure, training-data-extraction, differential-privacy, auditing]
---

# Membership inference and memorization: what a trained model leaks about its training data

## Summary
**TL;DR:** A membership-inference attack decides, from a model's outputs, whether one record was in its training set. The simplest one thresholds the loss (training records tend to have lower loss); shadow models and the likelihood-ratio attack (LiRA) calibrate that decision per example. Overfitting makes models vulnerable but is not required: models also memorize rare sequences, such as a canary inserted once, and large language models leak verbatim training text without overfitting. Judge an attack by its true-positive rate (TPR) at a low false-positive rate (FPR), not by the area under the ROC (receiver operating characteristic) curve (AUC). Differential privacy (DP) bounds every such attack, `TPR ≤ e^ε · FPR + δ` for one record in or out of the training set, but only per record: `k` copies of a secret are covered only at about `kε`, and in the lab 16 copies were memorized despite DP-SGD.
**Use this when:** you must estimate how much a model leaks about its training data, audit a model before release, choose between regularization and DP-SGD (differentially private stochastic gradient descent) as a defence, read a membership-inference result, or test whether a model memorized secrets (keys, PINs (personal identification numbers), personal data) in its training text.
**Not this doc:** the definition of `ε` and `δ` → `machine-learning/privacy-preserving-ml/differential-privacy.md`; how DP-SGD is trained and accounted → `machine-learning/privacy-preserving-ml/differentially-private-training.md`; inputs crafted to fool a model (a different attack) → `machine-learning/deep-learning/adversarial-robustness.md`.

## Problem
Publishing a model, or an API (application programming interface) that answers with its predictions, can publish facts about its training data. Knowing that a record was in a hospital's training set is itself sensitive, and Shokri et al. reached over 70 % attack accuracy on a hospital discharge dataset ✅[^1]. Good test accuracy is no defence: generalization is an average over the data, while privacy must hold for every person, outliers included ✅[^8]. Large language models (LLMs) trained for about one epoch on deduplicated data show little overfitting, which led many to assume they do not leak, yet hundreds of verbatim training sequences, including names, phone numbers and email addresses, were extracted from GPT-2 (Generative Pre-trained Transformer 2) ✅[^5]. An engineer needs to measure this leakage correctly and know which defences bound it.

## Mental model
**Analogy:** a student who crammed last year's exam. Shown a question, the student answers instantly and with total confidence if it was in the crammed set, and hesitates on new ones. An examiner who only watches the confidence can guess which questions the student saw (membership inference). Slip one invented fact into the textbook, such as "the secret code is 3719", and ask the student to complete "the secret code is …": if the student recites it, that is memorization, and the exposure test measures how far ahead of the 9,999 other codes it ranks.

**Artifact:** the loss-threshold attack on an overfit network and on the same network with weight decay, printed by the full script in the Worked example; lab run (`machine-learning/lab-setup.md`), 2026-11-25, PyTorch 2.15.0, scikit-learn 1.9.1 ✅[^9]:

```text
 overfit (300 epochs)       train 1.000 test 0.696 | AUC 0.744  TPR@1%FPR 0.000  max(TPR-FPR) 0.584
   mean loss members 0.000, non-members 4.099; loss exactly 0 in float32: 40 members, 16 non-members
 weight decay 0.05, 30 ep   train 0.796 test 0.754 | AUC 0.554  TPR@1%FPR 0.012  max(TPR-FPR) 0.098
```

The overfit model's training losses are essentially zero against 4.1 on fresh data, so the loss alone separates members (AUC 0.744); with weight decay the model is both more accurate on new data and close to chance (0.554).

## How it works
### The game
1. **Yeom et al.'s experiment:** train a model on a sample `S`; flip a coin `b`; draw a challenge record from `S` if `b = 0` or fresh from the data distribution if `b = 1`; the adversary sees the record and the model and guesses `b` ✅[^2].
2. **Membership advantage** = `Pr[guess member | member] − Pr[guess member | non-member]`, that is TPR − FPR with "member" as the positive class ✅[^2]. Example: TPR 0.6 at FPR 0.1 is an advantage of 0.5; random guessing scores 0.
3. **As a hypothesis test** (Carlini et al.): decide whether the model was drawn from models trained with the record (`Q_in`) or without it (`Q_out`); by the Neyman–Pearson lemma, thresholding the likelihood ratio between the two is the best test at a fixed FPR ✅[^3].
4. **How to score an attack:** report TPR at a low FPR (for example 0.1 % or 0.001 %) and the full ROC curve on log axes ✅[^3]. Balanced accuracy and AUC are average-case: an attack that perfectly identifies 0.1 % of members and guesses on the rest has an AUC of about 51 %, below a weak loss attack, though it breaches those members completely ✅[^3].

### Three attacks
1. **Loss threshold (the LOSS attack):** guess "member" when the record's loss is below a threshold `τ`; Yeom et al.'s version makes one query and needs only the average training loss ✅[^2]. A related bounded-loss adversary with the 0–1 loss (wrong or right) has advantage exactly equal to the generalization gap, training accuracy minus test accuracy ✅[^2].
2. **Shadow models (Shokri et al.):** train several "shadow" models that imitate the target, on data whose membership you know; label their outputs "in" and "out"; train an attack classifier, one per output class, on those labelled outputs; then apply it to the target's prediction vector plus the record's true label ✅[^1]. It works with black-box query access ✅[^1], at the cost of training many shadow models (hundreds, in Yeom et al.'s comparison) and knowing the input distribution and model type ✅[^2].
3. **LiRA (likelihood-ratio attack):** train shadow models on random halves of the data, so that each target record is in about half of them (IN) and out of the rest (OUT); fit a Gaussian to the logit-scaled confidence `φ(p) = log(p / (1 − p))` in each group (four numbers: two means, two variances), and threshold the likelihood ratio ✅[^3]. A global loss threshold implicitly assumes every record's loss is on the same scale; per-record calibration removes that assumption ✅[^3]. LiRA is 10× more powerful than prior attacks at low FPR ✅[^3].

### Overfitting, and memorization without it
- Overfitting is a sufficient condition for membership advantage but not a necessary one ✅[^2]; Shokri et al. call it a common reason but not the only one ✅[^1].
- **Canaries and exposure** (the secret sharer test) ✅[^4]:
  1. Insert a random sequence `s[r]`, `r` drawn from a randomness space `R` (here 4-digit PINs, `|R| = 10,000`), into the training data.
  2. Score every candidate by log-perplexity, `Px = −log₂ Pr(x₁…xₙ | model)`: the number of bits the model needs to encode it.
  3. **Rank** of the canary = its position among all `|R|` candidates sorted by log-perplexity (rank 1 = most likely).
  4. **Exposure** = `log₂|R| − log₂ rank`, between 0 and `log₂|R|`. Example: rank 1 of 10,000 gives 13.29 bits; rank 100 gives 6.64.
- Their findings: memorization happens early in training, not from overtraining; it persists across models and training strategies; early stopping and dropout do not prevent it; only differentially private training removed it ✅[^4].
- **Extraction at scale:** from 1,800 GPT-2 samples chosen as likely memorized, over 600 were verbatim training data, 67 % in the best configuration, some sequences present in a single training document; larger models were more vulnerable ✅[^5]. A string is `k`-eidetic memorized if the model can emit it although it appears in at most `k` training examples ✅[^5].

### How differential privacy bounds the attack
1. **Pure DP:** if training is ε-DP, any membership adversary's advantage is at most `e^ε − 1` ✅[^2]. Example: `ε = 0.1` caps it at 0.105; at `ε = 1` the cap is 1.72, which says nothing.
2. **Approximate DP as a test:** for neighbouring datasets, any decision rule's false-alarm and missed-detection probabilities satisfy `P_FA + e^ε·P_MD ≥ 1 − δ` and `e^ε·P_FA + P_MD ≥ 1 − δ` ✅[^6]. Treating "trained without the record" as the null hypothesis, `P_FA = FPR` and `P_MD = 1 − TPR`, so `TPR ≤ e^ε·FPR + δ`. Example: `ε = 2.49`, `δ = 10⁻⁵`, `FPR = 0.01` gives `TPR ≤ 0.121`.
3. **Per record only:** if two datasets differ in `k` rows, an ε-DP algorithm's probabilities differ by up to `e^(kε)` (group privacy); for `(ε, δ)`-DP the additive term grows too, to `δ·(e^(kε) − 1)/(e^ε − 1)` ✅[^7]. A secret copied into 16 records is protected at `16ε`.
4. **Mind the neighbour definition.** Yeom et al.'s DP changes the value of one record (substitution) ✅[^2], while the sampled-Gaussian accountant used for DP-SGD counts one record added or removed ✅[^10]. Comparing members with *other* records, as the lab does, is a substitution, which is one removal plus one addition; chaining the two steps as group privacy does turns an add-remove `(ε, δ)` into `TPR ≤ e^(2ε)·FPR + (1 + e^ε)·δ` ✅[^7]. Example: `ε = 2.49`, `FPR = 0.01` gives `e^4.98 · 0.01 = 1.45`, a vacuous bound; the `e^ε` form of step 2 holds for the same record in or out.
5. **Bound vs measurement:** DP gives an upper bound on any membership attack, and attacks give lower bounds on the real `ε` (auditing) ✅[^3] ✅[^7]. Measured leakage is often far below the bound: with DP training, canary exposure was negligible even at values of `ε` that promise nothing ✅[^4]. Attacks help interpret a guarantee but never replace it ✅[^8].

## Worked example
Part 1: digits (`load_digits`) with 20 % of labels replaced at random, 500 training records (members) and 500 held-out records (non-members); a 64-256-256-10 network trained with Adam, either 300 epochs (overfit), with weight decay 0.05 for 30 epochs, or stopped at 5 epochs; and DP-SGD on a 64-32-10 network (clip 1, Poisson lots, `δ = 10⁻⁵`). The attack scores each record by minus its loss. Part 2: a 3-token-context next-token network trained on 1,200 synthetic sentences ("call at d d d d w0" and word chains) plus `k` copies of "my pin is d d d d"; exposure over all 10,000 PINs, averaged over 5 random PINs. The core of each part:

```python
truth, score = np.r_[np.ones(500), np.zeros(500)], -np.r_[lm, ln]   # low loss -> "member"
fpr, tpr, _ = roc_curve(truth, score)
rank = int((logp >= logp[pin]).sum())                                # canary rank among 10^4 PINs
exposure = math.log2(10_000) - math.log2(rank)
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-25, PyTorch 2.15.0, scikit-learn 1.9.1, scipy 1.18.1, one CPU (central processing unit) thread, two runs identical ✅[^9]:

```text
== loss-threshold attack: 500 members vs 500 non-members ==
 overfit (300 epochs)       train 1.000 test 0.696 | AUC 0.744  TPR@1%FPR 0.000  max(TPR-FPR) 0.584
   mean loss members 0.000, non-members 4.099; loss exactly 0 in float32: 40 members, 16 non-members
 weight decay 0.05, 30 ep   train 0.796 test 0.754 | AUC 0.554  TPR@1%FPR 0.012  max(TPR-FPR) 0.098
 early stop (5 epochs)      train 0.796 test 0.758 | AUC 0.550  TPR@1%FPR 0.018  max(TPR-FPR) 0.082
 DP-SGD s=1.0 lot 50 30 ep  train 0.778 test 0.766 | AUC 0.550  TPR@1%FPR 0.010  max(TPR-FPR) 0.092  eps 15.27: TPR <= e^eps*0.01+1e-5 = 1.000
 DP-SGD s=2.0 lot 25 15 ep  train 0.430 test 0.394 | AUC 0.526  TPR@1%FPR 0.000  max(TPR-FPR) 0.054  eps  2.49: TPR <= e^eps*0.01+1e-5 = 0.121

== canary 'my pin is d d d d' inserted k times among 1200 sentences, 5 random pins [7195, 3269, 2345, 9872, 1760] ==
   exposure = log2(10^4) - log2(rank): 13.29 if ranked first, 1.44 on average for a uniformly random rank
 setting                          mean exposure  per pin                        epsilon  ordinary-sentence loss
 non-private, not inserted          2.89        [4.5, 0.8, 1.3, 2.7, 5.0]         inf   8.11
 non-private, k=1, 5 epochs         4.54        [3.3, 1.9, 1.9, 4.9, 10.7]        inf   9.31
 non-private, k=1, 60 epochs       13.29        [13.3, 13.3, 13.3, 13.3, 13.3]    inf   8.12
 non-private, k=4, 5 epochs        11.91        [13.3, 13.3, 11.7, 8.0, 13.3]     inf   9.31
 DP-SGD s=1, k=1, 60 epochs         2.66        [2.0, 6.3, 3.3, 0.4, 1.3]       15.10   10.13
 DP-SGD s=4, k=1, 30 epochs         2.11        [3.9, 1.3, 0.2, 3.5, 1.6]        1.63   18.34
 DP-SGD s=1, k=16, 60 epochs       13.29        [13.3, 13.3, 13.3, 13.3, 13.3]  14.98   10.34
```

<details><summary>Full script (prints the output above)</summary>

```python
# Membership inference by loss threshold (overfit vs regularized vs DP-SGD MLP on digits with 20 % label
# noise), and a canary memorized by a tiny next-token model, measured with the secret sharer's exposure.
import math
import numpy as np
import torch
from torch import nn
from torch.func import functional_call, grad, vmap
from scipy.special import gammaln, logsumexp
from sklearn.datasets import load_digits
from sklearn.metrics import roc_auc_score, roc_curve
from sklearn.preprocessing import StandardScaler
torch.set_num_threads(1)
rng = np.random.default_rng(0)

def eps_sgm(q, sigma, steps, delta, orders=np.arange(2, 257)):  # RDP of the sampled Gaussian, integer orders
    best = np.inf
    for a in orders:
        k = np.arange(a + 1)
        logA = logsumexp(gammaln(a + 1) - gammaln(k + 1) - gammaln(a - k + 1)
                         + (a - k) * np.log1p(-q) + k * np.log(q) + (k * k - k) / (2 * sigma**2))
        best = min(best, (steps * logA + np.log(1 / delta)) / (a - 1))
    return best

def dp_sgd(model, loss_one, data, sigma, C, lot, epochs, lr, opt_seed):
    torch.manual_seed(opt_seed)
    p = {k: v.detach().clone() for k, v in model.named_parameters()}
    pg = vmap(grad(loss_one), in_dims=(None, 0, 0))
    n, q = len(data[0]), lot / len(data[0])
    for _ in range(int(epochs / q)):
        idx = torch.nonzero(torch.rand(n) < q).squeeze(1)
        g = pg(p, data[0][idx], data[1][idx])
        norms = torch.sqrt(sum((v.reshape(len(idx), -1) ** 2).sum(1) for v in g.values()))
        f = torch.clamp(C / (norms + 1e-12), max=1.0)
        for k in p:
            s = (g[k] * f.view(-1, *[1] * (g[k].dim() - 1))).sum(0)
            p[k] = p[k] - lr * (s + sigma * C * torch.randn_like(p[k])) / lot
    for k, v in model.named_parameters():
        v.data.copy_(p[k])
    return eps_sgm(q, sigma, int(epochs / q), 1e-5)

# ---------------- Part 1: loss-threshold membership inference ----------------
X, y = load_digits(return_X_y=True)
y = y.copy(); flip = rng.random(len(y)) < 0.2
y[flip] = rng.integers(0, 10, flip.sum())                   # 20 % label noise: hard examples to memorize
idx = rng.permutation(len(y)); mem, non = idx[:500], idx[500:1000]
sc = StandardScaler().fit(X[mem])
Xm, Xn = (torch.tensor(sc.transform(X[i]), dtype=torch.float32) for i in (mem, non))
ym, yn = torch.tensor(y[mem]), torch.tensor(y[non])
def mlp(): torch.manual_seed(1); return nn.Sequential(nn.Linear(64, 256), nn.ReLU(), nn.Linear(256, 256), nn.ReLU(), nn.Linear(256, 10))
def adam_train(m, wd, epochs):
    opt = torch.optim.Adam(m.parameters(), lr=1e-3, weight_decay=wd)
    for _ in range(epochs):
        perm = torch.randperm(500)
        for s in range(0, 500, 50):
            b = perm[s:s + 50]; opt.zero_grad()
            nn.functional.cross_entropy(m(Xm[b]), ym[b]).backward(); opt.step()
def attack(m, name, eps=None):
    with torch.no_grad():
        lm = nn.functional.cross_entropy(m(Xm), ym, reduction="none").numpy()
        ln = nn.functional.cross_entropy(m(Xn), yn, reduction="none").numpy()
        acc_m = (m(Xm).argmax(1) == ym).float().mean().item(); acc_n = (m(Xn).argmax(1) == yn).float().mean().item()
    truth, score = np.r_[np.ones(500), np.zeros(500)], -np.r_[lm, ln]   # low loss -> "member"
    fpr, tpr, _ = roc_curve(truth, score)
    tpr1 = tpr[fpr <= 0.01].max()
    bound = "" if eps is None else f"  eps {eps:5.2f}: TPR <= e^eps*0.01+1e-5 = {min(1, math.exp(eps) * 0.01 + 1e-5):.3f}"
    print(f" {name:<26} train {acc_m:.3f} test {acc_n:.3f} | AUC {roc_auc_score(truth, score):.3f}"
          f"  TPR@1%FPR {tpr1:.3f}  max(TPR-FPR) {np.max(tpr - fpr):.3f}{bound}")
    return lm, ln

print("== loss-threshold attack: 500 members vs 500 non-members ==")
torch.manual_seed(2); m = mlp(); adam_train(m, 0.0, 300); lm, ln = attack(m, "overfit (300 epochs)")
print(f"   mean loss members {lm.mean():.3f}, non-members {ln.mean():.3f};"
      f" loss exactly 0 in float32: {(lm == 0).sum()} members, {(ln == 0).sum()} non-members")
torch.manual_seed(2); m = mlp(); adam_train(m, 0.05, 30); attack(m, "weight decay 0.05, 30 ep")
torch.manual_seed(2); m = mlp(); adam_train(m, 0.0, 5); attack(m, "early stop (5 epochs)")
def small(): torch.manual_seed(1); return nn.Sequential(nn.Linear(64, 32), nn.ReLU(), nn.Linear(32, 10))
def loss_mlp(model):
    return lambda p, x, t: nn.functional.cross_entropy(functional_call(model, p, (x.unsqueeze(0),)), t.unsqueeze(0))
for sigma, lot, ep in [(1.0, 50, 30), (2.0, 25, 15)]:                # DP rows use a 64-32-10 MLP (fewer parameters)
    m = small(); e = dp_sgd(m, loss_mlp(m), (Xm, ym), sigma, 1.0, lot, ep, 0.5 if sigma == 1.0 else 1.0, opt_seed=3)
    attack(m, f"DP-SGD s={sigma} lot {lot} {ep} ep", eps=e)

# ---------------- Part 2: a canary and its exposure ----------------
digits = [str(d) for d in range(10)]
words = [f"w{i}" for i in range(12)]
vocab = ["<s>"] + digits + words + ["call", "at", "my", "pin", "is"]
tok = {w: i for i, w in enumerate(vocab)}
CTX = 3
def corpus(n_insert, r, pin):
    sents = []
    for _ in range(600):                                       # "call at d d d d": digits in another context
        sents.append(["call", "at"] + [digits[r.integers(10)] for _ in range(4)] + ["w0"])
    for _ in range(600):                                       # word sentences from a fixed random chain
        w = [words[r.integers(12)]]
        while len(w) < 7:
            w.append(words[(words.index(w[-1]) * 5 + 1 + r.integers(2)) % 12])
        sents.append(w)
    sents += [["my", "pin", "is"] + list(f"{pin:04d}")] * n_insert   # the canary, k copies
    return torch.tensor([[tok[t] for t in s] for s in sents])
def contexts(S):                                               # (sentences, 7) -> (sentences, 7, CTX) windows
    pad = torch.cat([torch.zeros(len(S), CTX, dtype=torch.long), S], 1)
    return torch.stack([pad[:, i:i + CTX] for i in range(S.shape[1])], 1)
class TinyLM(nn.Module):
    def __init__(self):
        super().__init__(); torch.manual_seed(4)
        self.emb = nn.Embedding(len(vocab), 16); self.h = nn.Linear(16 * CTX, 64); self.out = nn.Linear(64, len(vocab))
    def forward(self, ctx):                                    # ctx (..., CTX) -> logits (..., V)
        return self.out(torch.tanh(self.h(self.emb(ctx).flatten(-2))))
def seq_loss(m, S):                                            # summed next-token loss per sentence
    logits = m(contexts(S))
    return nn.functional.cross_entropy(logits.transpose(1, 2), S, reduction="none").sum(1)
all_pins = torch.tensor([[tok["my"], tok["pin"], tok["is"]] + [tok[c] for c in f"{i:04d}"] for i in range(10_000)])
def exposure(m, pin):
    with torch.no_grad():
        logp = -seq_loss(m, all_pins) / math.log(2)             # log2-likelihood of each of the 10^4 candidates
    rank = int((logp >= logp[pin]).sum())                      # rank 1 = the most likely candidate
    return math.log2(10_000) - math.log2(rank)
def run(k, pin, private, sigma=1.0, epochs=60, lr=1e-2):
    S = corpus(k, np.random.default_rng(5), pin)
    m = TinyLM()
    if not private:
        opt = torch.optim.Adam(m.parameters(), lr=lr); torch.manual_seed(6)
        for _ in range(epochs):
            perm = torch.randperm(len(S))
            for s in range(0, len(S), 64):
                opt.zero_grad(); seq_loss(m, S[perm[s:s + 64]]).mean().backward(); opt.step()
        e = float("inf")
    else:
        one = lambda p, s, _: seq_loss(lambda c: functional_call(m, p, (c,)), s.unsqueeze(0))[0]
        e = dp_sgd(m, one, (S, torch.zeros(len(S))), sigma, 1.0, 64, epochs, lr, opt_seed=7)
    with torch.no_grad():
        util = seq_loss(m, S[:1200]).mean().item()           # loss on the ordinary sentences
    return exposure(m, pin), e, util

pins = [int(v) for v in np.random.default_rng(8).integers(0, 10_000, 5)]
print(f"\n== canary 'my pin is d d d d' inserted k times among 1200 sentences, 5 random pins {pins} ==")
rand_mean = np.mean(math.log2(10_000) - np.log2(np.arange(1, 10_001)))
print(f"   exposure = log2(10^4) - log2(rank): 13.29 if ranked first, {rand_mean:.2f} on average for a uniformly random rank")
print(" setting                          mean exposure  per pin                        epsilon  ordinary-sentence loss")
for name, k, kw in [("non-private, not inserted", 0, dict(private=False)),
                    ("non-private, k=1, 5 epochs", 1, dict(private=False, epochs=5)),
                    ("non-private, k=1, 60 epochs", 1, dict(private=False)),
                    ("non-private, k=4, 5 epochs", 4, dict(private=False, epochs=5)),
                    ("DP-SGD s=1, k=1, 60 epochs", 1, dict(private=True, sigma=1.0, lr=1.0)),
                    ("DP-SGD s=4, k=1, 30 epochs", 1, dict(private=True, sigma=4.0, epochs=30, lr=0.5)),
                    ("DP-SGD s=1, k=16, 60 epochs", 16, dict(private=True, sigma=1.0, lr=1.0))]:
    res = [run(k, pin, **kw) for pin in pins]
    ex = [r[0] for r in res]
    print(f" {name:<32} {np.mean(ex):6.2f}        {[round(v, 1) for v in ex]!s:<30} {res[0][1]:6.2f}   {np.mean([r[2] for r in res]):.2f}")
```

</details>

Reading it:
- **Overfit model:** maximum advantage 0.584, almost twice the 0–1-loss adversary's advantage, which equals the accuracy gap `1.000 − 0.696 = 0.304` ✅[^2]. Yet TPR at 1 % FPR is 0.000: in float32, 40 members and 16 non-members have a loss of exactly 0, so the most confident group already holds 16 non-members (3.2 % FPR) and no threshold reaches members alone. A global loss threshold cannot tell easy non-members from memorized members, the weakness LiRA's per-record calibration targets ✅[^3].
- **Regularized models:** weight decay and early stopping cut AUC to 0.554 and 0.550 while raising test accuracy (0.754, 0.758 against 0.696). Here privacy against this attack and accuracy improved together, but neither comes with a guarantee.
- **DP-SGD, `σ = 1`:** `ε = 15.3` with 500 records and lot 50 (`q = 0.1`), so the bound is vacuous (`TPR ≤ 1`), though the measured AUC is 0.550 and test accuracy the best of all (0.766).
- **DP-SGD, `σ = 2`, lot 25, 15 epochs:** `ε = 2.49` gives the printed `TPR ≤ 0.121` at 1 % FPR for a record in or out of training; for this lab's members-against-other-records comparison the substitution bound of step 4 is vacuous. The measurement is 0.000, but test accuracy falls to 0.394. With only 500 records, a meaningful `ε` costs most of the utility.
- **Canary baseline:** not inserted, the five PINs average 2.89 bits (0.8 to 5.0 each), against 1.44 expected for a uniformly random rank; five PINs is a small sample.
- **Memorization:** one copy and 60 epochs puts every PIN at rank 1 (13.29 bits). At 5 epochs, one copy reaches 4.54 bits and four copies 11.91: repetition speeds memorization.
- **DP per record:** DP-SGD at `σ = 1` brings one inserted copy back to the baseline (2.66 bits) although `ε = 15.1` is weak, as the secret sharer study observed ✅[^4]. With 16 copies, the same training memorizes all five PINs (13.29): the group bound is `16 × 15 = 240`, no protection ✅[^7]. The cost is utility: ordinary-sentence loss rises from 8.11 to 10.13 at `σ = 1` and 18.34 at `σ = 4`.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Attack reported only by AUC or accuracy | Looks weak (or strong) while it fully exposes a few records, or none | Average-case metrics hide the low-FPR regime ✅[^3]; lab AUC 0.744 with TPR 0 at 1 % FPR ✅[^9] |
| No train–test gap | Records can still be memorized and extracted | Overfitting is not necessary ✅[^2]; LLM extraction without overfitting ✅[^5] |
| A record repeated in the data | Memorized sooner; DP's per-record bound grows to `kε` | Lab 11.91 bits for 4 copies at 5 epochs ✅[^9]; group privacy ✅[^7]; deduplication helps but cannot prevent all attacks ✅[^5] |
| Outliers and rare examples | The most exposed records | Privacy must hold for everyone, outliers included ✅[^8]; per-record difficulty is why LiRA calibrates per example ✅[^3] |
| Model returns only top-`k` classes or only the label | Leaks less, but does not foil the attack; a label alone still leaks through how members and non-members are mislabeled | Shokri et al.'s mitigation results ✅[^1] |
| Early stopping or dropout against secrets | Not enough to stop canary memorization | Secret sharer results ✅[^4] |
| DP with a large `ε` | No meaningful bound, yet measured leakage can be small | Lab `ε = 15.1`, canary exposure 2.66 bits ✅[^9]; observed gap between measured and bounded loss ✅[^4] |
| Clipping without noise | Weakens LiRA significantly, but small clipping norms cost accuracy | Carlini et al.'s DP-SGD runs ✅[^3]; the guarantee also needs the noise (`machine-learning/privacy-preserving-ml/differentially-private-training.md`) |
| Attacker with many adaptive queries | The secret sharer's threat model; black-box access suffices | Exposure is estimated from model likelihoods alone ✅[^4] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Loss-threshold attack | One query plus the average training loss ✅[^2] | Weak at low FPR ✅[^3]; lab TPR 0 at 1 % FPR ✅[^9] |
| Shadow-model attack | Black-box; learns the target's behaviour ✅[^1] | Many shadow models and knowledge of the data and model type ✅[^2] |
| LiRA | 10× better at low FPR ✅[^3] | Many shadow models, half trained with each target record ✅[^3]; an offline variant needs only OUT models, at most 20 % lower TPR at 0.1 % FPR ✅[^3] |
| Regularization (weight decay, early stopping) | Lower attack success with better accuracy in the lab ✅[^9]; a mitigation in Shokri et al. ✅[^1] | No guarantee; does not stop canary memorization ✅[^4] |
| DP-SGD | A bound for every attack ✅[^2] ✅[^6]; removed canary memorization ✅[^4] | Accuracy (lab 0.394 at `ε = 2.49` on 500 records) ✅[^9]; slower training ✅[^4] |
| Deduplicating training data | Fewer repeated secrets, less memorization ✅[^5] | Does not prevent all attacks ✅[^5] |

## Takeaways
- Report membership attacks as TPR at a fixed low FPR (0.1 % or lower) with the ROC curve on log axes, never AUC alone. [rule-candidate]
- Before releasing a model trained on sensitive text, insert canaries and measure their exposure; repeated secrets need deduplication or a group-level budget. [rule-candidate]
- A small train–test gap is not evidence of privacy; only DP gives a bound, and only per record.
- Use attacks to audit a DP model, never as a substitute for its `ε`.

## Verification status
- Verified: 71 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [Membership Inference Attacks against Machine Learning Models](https://ar5iv.labs.arxiv.org/html/1610.05820) — Shokri, Stronati, Song, Shmatikov, 2017 (ar5iv HTML of arXiv:1610.05820). Backs: black-box attack, shadow models, per-class attack models, overfitting as a common but not the only cause, mitigations (top-k, precision, temperature, L2), hospital result. [^1]
- [Privacy Risk in Machine Learning: Analyzing the Connection to Overfitting](https://ar5iv.labs.arxiv.org/html/1709.01604) — Yeom, Giacomelli, Fredrikson, Jha, 2018 (ar5iv HTML of arXiv:1709.01604). Backs: the membership experiment, advantage, DP defined by changing one record, e^ε − 1 bound, advantage = generalization error, threshold attack needs only the average training loss, overfitting sufficient not necessary, shadow-model costs. [^2]
- [Membership Inference Attacks From First Principles](https://arxiv.org/html/2112.03570v2) — Carlini, Chien, Nasr, Song, Terzis, Tramèr, 2022 (arXiv HTML). Backs: TPR at low FPR, AUC and balanced-accuracy critique, hypothesis-test view, LiRA, logit scaling, per-example calibration, 10× improvement, DP as upper bound, clipping effect, shadow models on random halves, the offline variant. [^3]
- [The Secret Sharer: Evaluating and Testing Unintended Memorization in Neural Networks](https://ar5iv.labs.arxiv.org/html/1802.08232) — Carlini, Liu, Erlingsson, Kos, Song, 2019 (ar5iv HTML of arXiv:1802.08232). Backs: canaries, log-perplexity, rank, exposure, early memorization, regularization insufficient, DP removes it, measured vs bounded gap, threat model, slower DP training. [^4]
- [Extracting Training Data from Large Language Models](https://ar5iv.labs.arxiv.org/html/2012.07805) — Carlini et al., 2021 (ar5iv HTML of arXiv:2012.07805). Backs: GPT-2 extraction numbers, single-document sequences, larger models more vulnerable, k-eidetic memorization, little overfitting, deduplication and DP as mitigations. [^5]
- [The Composition Theorem for Differential Privacy](https://ar5iv.labs.arxiv.org/html/1311.0776) — Kairouz, Oh, Viswanath, 2015 (ar5iv HTML of arXiv:1311.0776). Backs: the false-alarm / missed-detection region of (ε, δ)-DP. [^6]
- [Auditing Differentially Private Machine Learning: How Private is Private SGD?](https://ar5iv.labs.arxiv.org/html/2006.07709) — Jagielski, Ullman, Oprea, 2020 (ar5iv HTML of arXiv:2006.07709). Backs: attacks as lower bounds on ε, group privacy e^(kε) and its δ term. [^7]
- [How to deploy machine learning with differential privacy](https://www.nist.gov/blogs/cybersecurity-insights/how-deploy-machine-learning-differential-privacy) — Papernot, Thakurta, NIST (National Institute of Standards and Technology), 2021. Backs: generalization is not privacy, attacks interpret but do not replace the guarantee. [^8]
- `machine-learning/lab-setup.md` — the lab where the loss-threshold attack and canary-exposure script ran on 2026-11-25. [^9]
- [Rényi Differential Privacy of the Sampled Gaussian Mechanism](https://ar5iv.labs.arxiv.org/html/1908.10530) — Mironov, Talwar, Zhang, 2019 (ar5iv HTML of arXiv:1908.10530). Backs: the accountant's neighbours differ by one added or removed record. [^10]

## Related
- `machine-learning/privacy-preserving-ml/differentially-private-training.md` — the DP-SGD used in the DP rows and its accountant.
- `machine-learning/privacy-preserving-ml/differential-privacy.md` — `ε`, `δ` and composition.
- `machine-learning/foundations/generalization-and-overfitting.md` — the train–test gap the LOSS attack exploits.
- `machine-learning/foundations/regularization.md` — weight decay and early stopping, the regularized rows.
- `machine-learning/evaluation/classification-metrics.md` — ROC curves, TPR and FPR.
- `machine-learning/transformers/pretraining-and-scaling-laws.md` — the language-model training where extraction was shown.
