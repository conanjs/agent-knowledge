---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/data-and-features
status: verified
applies-to: ["scikit-learn 1.9.1", "numpy 2.5.5", "Snorkel 0.9.7 (API docs read, not installed)"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, weak-supervision, labeling-functions, data-programming, snorkel, label-model, dawid-skene, expectation-maximization, majority-vote, probabilistic-labels, label-noise, noisy-labels]
---

# Weak supervision: labeling functions, label models and noisy labels

## Summary
**TL;DR:** Weak supervision replaces hand labels with labeling functions (LFs): small programs, such as a keyword rule, a database lookup or an older model, that vote a label or abstain on each unlabelled example. Each LF is wrong at its own unknown rate, and LFs overlap and conflict. A label model estimates every LF's accuracy from the pattern of agreements alone, with no true labels, and turns each example's votes into a probabilistic label; an end model trained on those probabilities can then generalize beyond the rules, provided it cannot simply recompute them: in the lab, an end model that could also read the rules' keywords re-learned the label model instead. A plain majority vote weighs a 52 %-accurate rule like a 91 %-accurate one, and duplicated rules fool both methods, because both assume LFs err independently.
**Use this when:** you have plenty of unlabelled data and domain heuristics but few labels, you combine noisy sources (rules, crowd workers, older models), you read the output of Snorkel's `LabelModel` or `LFAnalysis`, or you need to know how much label noise a model can absorb.
**Not this doc:** learning from unlabelled rows through the model's own predictions (self-training, label spreading) → `machine-learning/unsupervised-learning/semi-supervised-learning.md`; choosing which examples a human should label → `machine-learning/unsupervised-learning/active-learning.md`; EM (expectation–maximization) in general → `machine-learning/unsupervised-learning/gaussian-mixtures-and-em.md`; factor graphs and their inference → `machine-learning/probabilistic-ml/probabilistic-graphical-models.md`.

## Problem
Hand-labelled training sets often take person-months or years to build, and changing the labelling guidelines means labelling again ✅[^13]. Heuristics are cheap but have limited accuracy and coverage, and several of them overlap and disagree ✅[^1]. The obvious way to combine them, an unweighted majority vote, leaves tied examples without a label ✅[^1] ✅[^4] and gives every rule the same say. In the lab, seven keyword rules for a spam task have accuracies from 0.521 to 0.909; majority vote labels only 72.2 % of the documents, and 66.6 % of its labels say spam when the true share is 49.9 %, because the spam rules fire more often ✅[^12]. An end model trained on those labels (16,000 documents) still ranks test documents well (ROC AUC, the area under the receiver operating characteristic curve, 0.971) but classifies only 0.812 of them correctly ✅[^12]. Hand labels are noisy too: the share of corrupted labels in real-world datasets is reported between 8.0 % and 38.5 % ✅[^9], and the test sets of 10 widely used benchmarks hold on average at least 3.3 % label errors ✅[^10].

## Mental model
**Analogy:** an editor checking stories with seven tipsters of unknown reliability. Each tipster speaks up on some stories and stays silent on others. Counting hands treats the office gossip like the careful reporter. A better editor notices which tipsters tend to agree with the others when several speak on the same story, infers each one's reliability from that alone, and weighs their reports accordingly; the result is a confidence per story, not a verdict. The method assumes tipsters do not copy each other: four tipsters repeating one source look like four independent confirmations.

**Artifact:** one LF of the lab, and what the label model learned about all seven from 16,000 unlabelled documents without seeing a true label ("true acc" uses the hidden labels, for comparison); printed by the full script in the Worked example; lab run (`machine-learning/lab-setup.md`), 2026-11-25, numpy 2.5.5, scikit-learn 1.9.1 ✅[^12]:

```python
def lf(key):                         # lf("free"): vote SPAM if "free" occurs, else abstain
    return lambda doc: VOTE[key] if key in doc else ABSTAIN
```

```text
LF           coverage true acc model acc
lf_free         0.167    0.909     0.920
lf_meeting      0.172    0.884     0.867
lf_!!!          0.425    0.644     0.667
lf_thanks       0.324    0.691     0.669
lf_http         0.276    0.732     0.760
lf_attached     0.167    0.755     0.743
lf_hello        0.238    0.521     0.531
```

## How it works
Four actors, in this order:
- **Labeling functions** — their job: vote a class or abstain on each example, via code the user writes.
- **Label matrix** — its job: hold every vote, via an n × m array (n examples, m LFs).
- **Label model** — its job: estimate each LF's reliability and turn each row of votes into a class probability, via EM over a generative model of the votes.
- **End model** — its job: predict the class from the example's own features, via a loss weighted by those probabilities.

```text
unlabelled examples ──▶ LF_1 … LF_m ──▶ label matrix Λ (n × m, −1 = abstain)
                                                │  no true label is used
                                                ▼
                                label model: P(LF output | class), fitted by EM
                                                │
                                                ▼
                            probabilistic labels q_i = P(class_i = spam | Λ_i)
                                                │  rows without any vote dropped
                                                ▼
                 end model on the examples' features, loss = Σ_i E_{y ~ q_i}[loss(f(x_i), y)]
```

### 1. Labeling functions and the label matrix
- An LF is a black-box function that takes an example and outputs a label or abstains ✅[^1]; in Snorkel it is a Python function wrapped by `@labeling_function()` that returns a class index or −1 ✅[^7]. It can encode a pattern, a heuristic, an external knowledge base, crowd workers' labels or another classifier ✅[^1] ✅[^13], and it need not have perfect accuracy or recall ✅[^2].
- Applying m LFs to n examples gives the label matrix, an n × m array with values in {−1, 0, …, k−1} for k classes, −1 meaning abstain ✅[^3]. Snorkel's `LFAnalysis` summarizes it as coverage (the fraction of examples with at least one label), overlap (at least two) and conflict (disagreeing non-abstain labels) ✅[^5]. Label density is the mean number of non-abstain labels per example ✅[^1]: 1.77 in the lab ✅[^12].
- The baseline is a majority vote. Snorkel's `MajorityLabelVoter` returns −1 for a tie by default, and probabilities 0.5 and 0.5 for a tied row ✅[^4].

### 2. The label model
1. **Model the votes, not the features.** The true class is a hidden (latent) variable, and in the simplest model each LF is a noisy voter whose errors are independent of the other LFs' errors ✅[^1]. Data programming's independent model gives LF j a probability β_j of voting and α_j of voting correctly when it does ✅[^2]. Snorkel writes the model as a factor graph with a labelling-propensity and an accuracy factor per LF, plus an optional correlation factor per chosen pair of LFs ✅[^1]: an undirected graphical model, normalized by a constant `Z`.
2. **What a vote is worth.** In that independent model, a vote moves the log-odds of its class by `w_j = log(α_j / (1 − α_j))` (the ratio of LF j's chance of voting this way under the voted class to its chance under the other class, from the model's terms `β_j·α_j` and `β_j·(1 − α_j)` ✅[^2]). Snorkel's optimizer, which decides whether a label model is worth fitting at all, assumes by default that the true weights lie between 0.5 and 1.5, which it equates with accuracies of 62 % to 82 % ✅[^1]. Example with the lab's true accuracies ✅[^12]: `lf_!!!` (0.644, w = 0.59) and `lf_hello` (0.521, w = 0.08) vote spam and `lf_meeting` (0.884, w = 2.03) votes ham. Majority vote says spam, 2 to 1; the weighted log-odds of spam are 0.59 + 0.08 − 2.03 = −1.36, so P(spam) = 1 / (1 + e^1.36) = 0.20.
3. **Fitting without labels: Dawid–Skene and EM.** Dawid and Skene's crowdsourcing model gives each source a k × k confusion matrix, the probability that it answers class c for an item of class l, and estimates the matrices and the hidden labels together by maximizing the likelihood of the observed labels with EM ✅[^8]. The E-step computes each item's class posterior from the current matrices, and the M-step re-estimates each matrix from posterior-weighted counts ✅[^8]. The block below is the lab's version, which adds two things to Zhang et al.'s restatement: a class share `π_c` in the E-step, where theirs has no prior term, and abstain as one more output `o`, where their M-step normalizes over the labels a worker actually gave ✅[^8]:

   ```text
   E-step:  log q_i(c) = log π_c + Σ_j log θ_j[c, λ_ij] + constant        (then normalize over c)
   M-step:  θ_j[c, o] = Σ_i q_i(c)·1[λ_ij = o] / Σ_i q_i(c)        π_c = average over i of q_i(c)
   ```
   - `π_c`: share of class c; `θ_j[c, o]`: probability that LF j outputs o when the truth is c; `λ_ij`: LF j's output on example i; `q_i(c)`: current probability that example i is of class c; `1[·]`: 1 when the condition holds, else 0. The lab adds 0.01 to every count so that no probability is zero.
   - The lab model counts "abstain" as a third output o, so silence is evidence too: in the lab's generator, "free" occurs in 30 % of spam and 3 % of ham, so an abstaining `lf_free` points mildly towards ham ✅[^12]. Data programming's independent model instead makes silence carry no information: the chance of abstaining, `1 − β_j`, is the same for both classes ✅[^2].
   - The log-likelihood is not concave, so EM may stop at different stationary points from different starting values ✅[^8]; the lab starts from the majority vote.
   - The one-coin model keeps a single accuracy per source ✅[^8]. With abstentions treated as uninformative and LFs that each vote one class only, it collapsed in the lab: every document labelled spam, `lf_meeting` given an accuracy of 0.010, label accuracy 0.506 ✅[^12]. Declaring every spam vote right and every ham vote wrong explains one-sided votes better than any honest set of accuracies.
4. **In Snorkel.** The Snorkel paper fitted its factor graph by interleaving stochastic gradient descent steps with Gibbs sampling ✅[^1]. Snorkel 0.9.7's `LabelModel` learns `P(lf | Y)` for conditionally independent LFs with a matrix-completion approach over the inverse generalized covariance matrix of the junction tree of the LFs' dependency graph, from the paper "Training Complex Models with Multi-Task Weak Supervision" (AAAI 2019, the Association for the Advancement of Artificial Intelligence conference) ✅[^3].

### 3. When the label model beats majority vote
- Snorkel measures the modelling advantage: how often the accuracy-weighted vote is right where the unweighted vote is wrong, minus the reverse ✅[^1].
- **Low label density:** few examples have more than one vote, so even the best weighting rarely differs from majority vote; the optimal advantage is bounded by a term that grows with the square of the density ✅[^1].
- **High label density:** if the average LF accuracy is above 50 %, majority vote converges exponentially to the optimal answer as density grows ✅[^1].
- **Medium density:** where the Snorkel authors expect the largest gains. On Snorkel's applications the learned model's advantage ranged from 0.1 % (Chem, where its optimizer chose majority vote) to 7.0 % (Radiology), and learning the accuracies raised end predictive performance by 5.81 % over unweighted combination ✅[^1].
- **Lab (density 1.77):** on the examples majority vote labels, the label model is right 0.819 of the time against 0.809; it also labels the tied ones (88.6 % of examples against 72.2 %), and its spam share is 0.513 against the true 0.499 ✅[^12].

### 4. Correlated labeling functions
- Variations of one regular expression, rules on raw tokens and on their lemmas, or overlapping knowledge bases make LFs dependent; a model that assumes independence counts their shared vote several times ✅[^1]. Snorkel's Example 3.1: 5 perfectly correlated LFs of 50 % accuracy plus 5 independent ones of 99 % get maximum-likelihood estimates of 100 % and 50 % under the independent model ✅[^1].
- Snorkel picks the pairs to model from the label matrix alone with a pseudolikelihood estimator: 15 seconds for 100 LFs and 10,000 examples, against about 45 minutes to fit all pairwise correlations by maximum likelihood ✅[^1].
- Lab: three extra copies of `lf_!!!` raise its estimated accuracy from 0.667 to 1.000 (true 0.644), and drop label-model accuracy from 0.798 to 0.632 and majority vote from 0.809 to 0.727; dropping the six identical column pairs restores 0.798 ✅[^12].

### 5. Training the end model on probabilistic labels
- The end model minimizes each example's expected loss under its probabilistic label, a noise-aware loss ✅[^1] ✅[^2]: `loss_i = q_i·ℓ(f(x_i), spam) + (1 − q_i)·ℓ(f(x_i), ham)`, with `ℓ` the log loss and `f(x_i)` the model's predicted spam probability. Example: `q = 0.8` and a prediction of 0.6 cost `0.8 × 0.511 + 0.2 × 0.916 = 0.592`. A library that accepts sample weights does this with every row entered twice, once per class, weighted `q` and `1 − q` (the lab's `soft_fit`).
- Examples on which every LF abstains carry no vote; Snorkel's `filter_unlabeled_dataframe` removes them before training ✅[^6].
- The end model can generalize beyond the LFs: on a chemical–disease sentence where all 33 LFs abstained, a deep network trained on Snorkel's labels still found the relation ✅[^1]. Snorkel cites an analysis that, as unlabelled data grows, the end model's generalization error falls at the same asymptotic rate as supervised learning with more hand labels ✅[^1]; data programming proves this under assumptions that include a correctly specified label model and a class that is independent of the end model's features given the LF outputs ✅[^2]. The lab below breaks the second assumption on purpose: its background words carry class information the LFs do not. Snorkel reports 132 % average improvement over earlier heuristic approaches and results within an average 3.60 % of large hand-labelled training sets ✅[^1].
- Lab: an end model that reads only the 200 background words, not the keywords the LFs read, rises from 0.789 to 0.910 test accuracy as the unlabelled pool grows from 1,000 to 16,000 documents, against 0.762 for the LFs alone ✅[^12]. Given all words it stays at 0.762–0.770 ✅[^12]: the probabilistic labels are a function of the 7 keyword columns, and their log-odds are a sum of one term per keyword column (the E-step above), which logistic regression can represent exactly, so the best fit to them uses those columns and nothing else. Two views of the data that are independent given the class is also co-training's setting ✅[^2], and Snorkel's cross-modal tasks build it on purpose: LFs read one modality (text, crowd workers' answers) and the end model another (images, text) ✅[^1].

### 6. Noisy labels
- **Kinds of noise.** Label noise is usually described by a transition matrix, `T_ij = P(noisy label j | true label i)`. Symmetric noise of rate τ keeps `T_ii = 1 − τ` and spreads τ evenly over the other classes; asymmetric noise flips more often towards one class (a dog to a cat rather than to a fish); instance-dependent noise also depends on the input ✅[^9]. LF errors are instance-dependent: a rule errs on the inputs it misreads.
- **What symmetric noise does.** With two classes, T gives `P(noisy = 1 | x) = τ + (1 − 2τ)·P(y = 1 | x)`. At τ = 0.2 a clean posterior of 0.95 becomes 0.2 + 0.6 × 0.95 = 0.77; at τ = 0.4 every posterior lies in [0.4, 0.6]. The decision boundary stays where it was, but each label carries less signal. Lab: logistic regression's mean top probability falls 0.946 → 0.749 → 0.608 at 0, 20 and 40 % noise and its accuracy 0.940 → 0.906 → 0.738, while a 1-nearest-neighbour classifier, which copies the label of the closest training example, falls 0.754 → 0.684 → 0.544 ✅[^12].
- **Deep networks memorize.** A deep network can fit a whole training set with any share of corrupted labels, and standard regularizers (data augmentation, weight decay, dropout, batch normalization) do not remove the overfitting on their own ✅[^9]; the random-label experiment behind this, replicated on digits, is in `machine-learning/learning-theory/pac-learning-and-vc-dimension.md` and discussed in `machine-learning/deep-learning/loss-landscapes-and-generalization.md`, and a training loop's symptoms with shuffled labels are in `machine-learning/deep-learning/training-loop-and-debugging.md`. Networks tend to learn simple, general patterns first and overfit the noisy ones later, which is why many methods treat the low-loss examples as the clean ones (the small-loss trick) ✅[^9].
- **Remedies, by family** ✅[^9]: noise-robust losses (mean absolute error meets a noise-tolerance condition that cross-entropy does not), loss correction with an estimated T, sample selection (co-teaching: two networks pass each other their small-loss examples), and combinations with semi-supervised learning. Confident learning estimates the joint distribution of noisy and true labels from out-of-sample predicted probabilities and prunes the likely errors ✅[^11].
- **Test labels count too.** On ImageNet with corrected test labels, ResNet-18 outperforms ResNet-50 if the share of originally mislabelled test examples rises by just 6 % ✅[^10].

## Worked example
A synthetic spam task. Each document is a bag of words: 7 keywords whose class-conditional probabilities are set by hand (for example "free": 0.30 in spam, 0.03 in ham) and 200 background words with random class tilts, all independent given the class; 16,000 unlabelled training documents and 2,000 test documents, half spam. Each keyword has one LF that votes its class or abstains. The script fits the Dawid–Skene label model by EM, trains logistic regression on majority-vote labels, hard label-model labels, probabilistic labels and true labels, then duplicates an LF and adds symmetric noise. In the output, LM is the label model, "maj. vote" the majority vote, and 1-NN and 50-NN are nearest-neighbour classifiers that copy the label of the closest training document or take the majority of the 50 closest. Core lines:

```python
theta = np.einsum("ny,nmo->ymo", Q, O) + .01            # M-step: expected counts of each LF output per class
theta /= theta.sum(2, keepdims=True); prior = Q.mean(0)
q = posterior(L, theta, prior)                           # E-step: P(spam | this row of votes)
soft_fit(X[cov][:, BG], q[cov])                          # end model: rows twice, weights q and 1 - q
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-25, numpy 2.5.5, scikit-learn 1.9.1, two runs identical; the first 8 lines are the Mental model artifact ✅[^12]:

```text
LF           coverage true acc model acc
lf_free         0.167    0.909     0.920
lf_meeting      0.172    0.884     0.867
lf_!!!          0.425    0.644     0.667
lf_thanks       0.324    0.691     0.669
lf_http         0.276    0.732     0.760
lf_attached     0.167    0.755     0.743
lf_hello        0.238    0.521     0.531
label density 1.77, rows with >= 1 vote 0.886, true spam share 0.499
majority vote: labels 0.722 of rows, accuracy 0.809, spam share 0.666
label model:   labels 0.886 of rows, accuracy 0.798, spam share 0.513, same rows as majority vote 0.819
one-coin model: accuracy 0.506, spam share 1.000, accuracy it gives lf_meeting 0.010
== test accuracy on 2,000 documents; end model = logistic regression on the background words ==
LFs alone (label model applied to the test LFs): 0.762
unlabelled pool maj. vote  LM hard  LM soft  soft, all words  true labels
          1,000     0.765    0.770    0.789            0.770        0.904
          4,000     0.799    0.873    0.875            0.770        0.925
         16,000     0.812    0.913    0.910            0.762        0.935
hand labels only, background words: 100 -> 0.848, 400 -> 0.895, 1000 -> 0.904
ROC AUC at 16,000: majority vote 0.971, LM soft 0.976
== duplicated LF: lf_!!! copied 3 more times ==
majority vote accuracy 0.727, label model accuracy 0.632, model acc of lf_!!! 1.000 (alone: 0.667)
identical LF column pairs: 6; label model after dropping copies 0.798; end model 0.851 with copies, 0.910 without
== symmetric label noise on 4,000 true labels, all 207 words ==
noise 0%: logistic regression 0.940 (mean max probability 0.946), 1-NN 0.754, 50-NN 0.829
noise 20%: logistic regression 0.906 (mean max probability 0.749), 1-NN 0.684, 50-NN 0.799
noise 40%: logistic regression 0.738 (mean max probability 0.608), 1-NN 0.544, 50-NN 0.674
```

<details><summary>Full script (prints the output above)</summary>

```python
# Weak supervision on a synthetic spam task: keyword labeling functions (LFs), majority vote vs a
# Dawid-Skene label model fitted by EM, end models on hard, probabilistic and true labels, a duplicated
# LF, and symmetric label noise. numpy + scikit-learn only.
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.neighbors import KNeighborsClassifier

rng = np.random.default_rng(0)
SPAM, HAM, ABSTAIN = 1, 0, -1
# keyword: (P(word | spam), P(word | ham)); the LF on that keyword votes for the class it indicates
KEYS = {"free": (.30, .03), "meeting": (.04, .30), "!!!": (.55, .30), "thanks": (.20, .45),
        "http": (.40, .15), "attached": (.08, .25), "hello": (.25, .23)}
VOTE = {"free": SPAM, "meeting": HAM, "!!!": SPAM, "thanks": HAM, "http": SPAM, "attached": HAM, "hello": SPAM}
base = rng.uniform(.02, .10, 200); tilt = rng.normal(0, .8, 200)           # 200 background words
lg = np.log(base / (1 - base))
P_BG = {SPAM: 1 / (1 + np.exp(-(lg + tilt / 2))), HAM: 1 / (1 + np.exp(-(lg - tilt / 2)))}
WORDS = list(KEYS) + [f"w{i:03d}" for i in range(200)]

def make_docs(n):
    y = (rng.random(n) < .5).astype(int)
    p = np.array([[KEYS[k][0 if c == SPAM else 1] for k in KEYS] + list(P_BG[c]) for c in y])
    X = (rng.random(p.shape) < p).astype(float)                              # bag-of-words presence
    return [{w for w, v in zip(WORDS, row) if v} for row in X], X, y

def lf(key):                                                              # one keyword labeling function
    return lambda doc: VOTE[key] if key in doc else ABSTAIN
LFS = {f"lf_{k}": lf(k) for k in KEYS}
apply = lambda lfs, docs: np.array([[f(d) for f in lfs.values()] for d in docs])

def majority_vote(L):
    s = (L == SPAM).sum(1) - (L == HAM).sum(1)
    return np.where(s > 0, SPAM, np.where(s < 0, HAM, ABSTAIN))              # tie or no vote: abstain

def posterior(L, theta, prior):       # P(spam | LF outputs), LFs independent given the class
    logp = np.log(prior) + np.einsum("nmo,ymo->ny", np.eye(3)[L + 1], np.log(theta))
    return 1 / (1 + np.exp(logp[:, 0] - logp[:, 1]))
def label_model(L, iters=100):        # Dawid-Skene EM: per LF a table P(output | class), abstain included
    O = np.eye(3)[L + 1]                                                     # n x m x 3: abstain, ham, spam
    s = (L == SPAM).sum(1) - (L == HAM).sum(1); q = np.where(s > 0, .9, np.where(s < 0, .1, .5))
    for _ in range(iters):
        Q = np.c_[1 - q, q]
        theta = np.einsum("ny,nmo->ymo", Q, O) + .01                         # M-step: expected counts
        theta /= theta.sum(2, keepdims=True); prior = Q.mean(0)
        q = posterior(L, theta, prior)                                       # E-step
    out = np.array([1 + (L[:, j] == SPAM).any() for j in range(L.shape[1])])  # the output each LF emits
    j = range(len(out))
    acc = prior[out - 1] * theta[out - 1, j, out] / (prior[:, None] * theta[:, j, out]).sum(0)
    return q, acc, theta, prior                                              # acc = P(class = vote | vote)

def one_coin(L, iters=100):           # simpler model: one accuracy per LF, abstaining says nothing
    V = np.where(L == SPAM, 1., np.where(L == HAM, -1., 0.)); acc, prior = np.full(L.shape[1], .7), .5
    for _ in range(iters):
        q = 1 / (1 + np.exp(-(np.log(prior / (1 - prior)) + V @ np.log(acc / (1 - acc)))))
        right = (V == 1) * q[:, None] + (V == -1) * (1 - q[:, None])
        acc = (right.sum(0) / (V != 0).sum(0)).clip(.01, .99); prior = q.mean().clip(.01, .99)
    return q, acc

def end_model(X, y, w=None):
    return LogisticRegression(C=1.0, max_iter=5000).fit(X, y, sample_weight=w)
def soft_fit(X, q):                               # expected log loss: each row twice, weights q and 1-q
    return end_model(np.vstack([X, X]), np.r_[np.ones(len(X)), np.zeros(len(X))], np.r_[q, 1 - q])

docs, X, y = make_docs(16000); docs_te, Xte, yte = make_docs(2000)
L, Lte = apply(LFS, docs), apply(LFS, docs_te)
q, acc_hat, theta, prior = label_model(L)
print(f"{'LF':<12}{'coverage':>9}{'true acc':>9}{'model acc':>10}")
for j, name in enumerate(LFS):
    v = L[:, j] != ABSTAIN
    print(f"{name:<12}{v.mean():9.3f}{(L[v, j] == y[v]).mean():9.3f}{acc_hat[j]:10.3f}")
cov = (L != ABSTAIN).any(1); mv = majority_vote(L); lm = (q > .5).astype(int)
print(f"label density {(L != ABSTAIN).sum(1).mean():.2f}, rows with >= 1 vote {cov.mean():.3f}, true spam share {y.mean():.3f}")
print(f"majority vote: labels {(mv != ABSTAIN).mean():.3f} of rows, accuracy {(mv == y)[mv != ABSTAIN].mean():.3f},"
      f" spam share {(mv[mv != ABSTAIN] == SPAM).mean():.3f}")
print(f"label model:   labels {cov.mean():.3f} of rows, accuracy {(lm == y)[cov].mean():.3f},"
      f" spam share {lm[cov].mean():.3f}, same rows as majority vote {(lm == y)[mv != ABSTAIN].mean():.3f}")
q1, acc1 = one_coin(L)
print(f"one-coin model: accuracy {((q1 > .5) == y)[cov].mean():.3f}, spam share {(q1[cov] > .5).mean():.3f},"
      f" accuracy it gives lf_meeting {acc1[1]:.3f}")

BG = slice(len(KEYS), None)                       # the end model reads the 200 background words only
score = lambda m, cols=BG: m.score(Xte[:, cols], yte)
print("== test accuracy on 2,000 documents; end model = logistic regression on the background words ==")
print(f"LFs alone (label model applied to the test LFs): {((posterior(Lte, theta, prior) > .5) == yte).mean():.3f}")
print(f"{'unlabelled pool':>15} {'maj. vote':>9} {'LM hard':>8} {'LM soft':>8} {'soft, all words':>16} {'true labels':>12}")
for n in (1000, 4000, 16000):
    Ln, Xn = L[:n], X[:n]; qn = label_model(Ln)[0]; c = (Ln != ABSTAIN).any(1)
    mvn = majority_vote(Ln); m = mvn != ABSTAIN
    r = [score(end_model(Xn[m][:, BG], mvn[m])), score(end_model(Xn[c][:, BG], (qn[c] > .5).astype(int))),
         score(soft_fit(Xn[c][:, BG], qn[c])), score(soft_fit(Xn[c], qn[c]), slice(None)),
         score(end_model(Xn[:, BG], y[:n]))]
    print(f"{n:>15,} {r[0]:9.3f} {r[1]:8.3f} {r[2]:8.3f} {r[3]:16.3f} {r[4]:12.3f}")
print("hand labels only, background words:", ", ".join(
    f"{k} -> {score(end_model(X[:k, BG], y[:k])):.3f}" for k in (100, 400, 1000)))
auc = lambda m: roc_auc_score(yte, m.predict_proba(Xte[:, BG])[:, 1])
print(f"ROC AUC at 16,000: majority vote {auc(end_model(X[mv != ABSTAIN][:, BG], mv[mv != ABSTAIN])):.3f},"
      f" LM soft {auc(soft_fit(X[cov][:, BG], q[cov])):.3f}")

print("== duplicated LF: lf_!!! copied 3 more times ==")
L4 = np.hstack([L, np.repeat(L[:, [2]], 3, axis=1)])
q4, acc4, _, _ = label_model(L4); mv4 = majority_vote(L4)
print(f"majority vote accuracy {(mv4 == y)[mv4 != ABSTAIN].mean():.3f}, label model accuracy "
      f"{((q4 > .5) == y)[cov].mean():.3f}, model acc of lf_!!! {acc4[2]:.3f} (alone: {acc_hat[2]:.3f})")
same = [(i, j) for i in range(L4.shape[1]) for j in range(i) if (L4[:, i] == L4[:, j]).all()]
keep = [j for j in range(L4.shape[1]) if j not in {i for i, _ in same}]
qd = label_model(L4[:, keep])[0]
print(f"identical LF column pairs: {len(same)}; label model after dropping copies {((qd > .5) == y)[cov].mean():.3f};"
      f" end model {score(soft_fit(X[cov][:, BG], q4[cov])):.3f} with copies, {score(soft_fit(X[cov][:, BG], qd[cov])):.3f} without")

print("== symmetric label noise on 4,000 true labels, all 207 words ==")
for tau in (0., .2, .4):
    yn = np.where(rng.random(4000) < tau, 1 - y[:4000], y[:4000])
    lr = end_model(X[:4000], yn); conf = lr.predict_proba(Xte).max(1).mean()
    k1, k50 = (KNeighborsClassifier(k).fit(X[:4000], yn) for k in (1, 50))
    print(f"noise {tau:.0%}: logistic regression {score(lr, slice(None)):.3f} (mean max probability {conf:.3f}),"
          f" 1-NN {score(k1, slice(None)):.3f}, 50-NN {score(k50, slice(None)):.3f}")
```

</details>

Reading it:
- **Accuracies without labels.** The label model's estimate is within 0.03 of each LF's true accuracy, from 0.531 for the near-useless `lf_hello` to 0.920 for `lf_free`.
- **Label quality.** Majority vote leaves 16.4 % of the documents tied (72.2 % labelled against 88.6 % with a vote) and leans towards spam (0.666); the label model labels every covered document, is slightly more accurate on the same rows (0.819 against 0.809) and gets the class balance nearly right (0.513 against 0.499). The one-coin model collapses to "everything is spam".
- **End model.** On the background words, label-model labels take the end model from 0.789 to 0.910 as the pool grows, well past the LFs alone (0.762); majority-vote labels reach only 0.812 although their ROC AUC (0.971) is close to the label model's (0.976): the ranking is right, the 0.5 threshold is not. Probabilistic and hard labels end level (0.910 against 0.913); with 1,000 documents the probabilistic ones are ahead (0.789 against 0.770). 16,000 weakly labelled documents match about 1,000 hand labels (0.904); true labels on all 16,000 give 0.935.
- **Copies.** Four copies of one 64 %-accurate rule look perfectly reliable to the independent model (1.000), and its end model falls from 0.910 to 0.851.
- **Noise.** Logistic regression keeps most of its accuracy at 20 % symmetric noise (0.906) while its confidence drops to 0.749, near the formula's 0.2 + 0.6 × 0.946 = 0.768; 1-NN, which memorizes, loses more at every level, and 50-NN, which averages 50 noisy labels, sits in between (0.674 at 40 %).

## Edge cases
| Case | What happens | Why |
|---|---|---|
| LFs that each vote one class, one-coin label model | Degenerate fit: every document one class (lab: spam share 1.000) | Abstentions carry no information in that model, and "every spam vote is right" explains the votes best ✅[^12] |
| Duplicated or near-duplicate LFs | Inflated accuracy for the copies (lab 1.000 vs true 0.644), worse labels | Independence assumption counts one signal several times ✅[^1] ✅[^12] |
| One class's LFs fire more often | Majority vote leans towards it (lab 0.666 spam vs 0.499); the end model's threshold shifts while its ranking holds | Votes are counted, not weighted, and no class prior is estimated ✅[^12] |
| End model can also read the LFs' inputs (lab: keywords plus background words) | It re-learns the label model and does not improve with more data (lab 0.762–0.770) | Its targets are a function of those inputs ✅[^12] |
| Examples no LF covers | No vote to learn from; removed before training, yet still classified by the end model | `filter_unlabeled_dataframe` ✅[^6]; Snorkel's all-abstain example ✅[^1] |
| Low label density | Label model and majority vote nearly agree | Few examples with conflicting votes ✅[^1] |
| Many crowd workers, each labelling a few items | The regime crowdsourcing results focus on; data programming targets few LFs labelling much of the data | ✅[^2]; with many spammers and few experts majority vote is almost a random guess ✅[^8] |
| EM from a poor start | A different, worse stationary point | Non-concave likelihood ✅[^8] |
| Symmetric noise, linear model | Boundary kept, probabilities squeezed towards 0.5 (lab 0.608 at 40 %) | `τ + (1 − 2τ)·p`; lab ✅[^12] |
| Memorizing model (1-nearest-neighbour, large network) | Copies the noise | Lab 0.544 at 40 % ✅[^12]; networks fit any share of corrupted labels ✅[^9] |
| Asymmetric noise and the small-loss trick | Clean and noisy losses overlap, selection works poorly | Shown for 40 % asymmetric noise ✅[^9] |
| Errors in the test labels | The ranking of models can flip | ResNet-18 vs ResNet-50 ✅[^10] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Hand labels | Accurate; lab: 1,000 labels gave 0.904 ✅[^12] | Person-months; redone when the task changes ✅[^13] |
| Majority vote | Nothing to fit | Equal weights, tied rows unlabelled, class bias ✅[^1] ✅[^12] |
| Label model | Learned accuracies, a probability per example ✅[^1] | Assumes independent LFs unless dependencies are learned ✅[^1]; can degenerate ✅[^12] |
| Probabilistic labels in the loss | Keep the label model's uncertainty ✅[^1] | Lab: level with hard labels at 16,000 documents (0.910 vs 0.913) ✅[^12] |
| Noise-robust training | Handles noise left in the labels ✅[^9] | Sample selection discards examples and accumulates selection errors ✅[^9] |

## Takeaways
- Before fitting anything, print each LF's coverage, overlap and conflict, and check its accuracy on a small hand-labelled development set. [rule-candidate]
- Compare the label model with majority vote and with a model trained on the hand labels the same effort would buy.
- Give the end model features the LFs do not read; an end model that can compute the rules re-learns them.
- Remove duplicated or near-duplicate LFs, or model their dependency, before fitting the label model. [rule-candidate]
- Check the class balance of the weak labels against a known prior: a lean towards the class whose rules fire most moves the end model's threshold.

## Verification status
- Verified: 90 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [Snorkel: Rapid Training Data Creation with Weak Supervision](https://ar5iv.labs.arxiv.org/html/1711.10160) — Ratner, Bach, Ehrenberg, Fries, Wu, Ré, 2017 (ar5iv HTML of arXiv:1711.10160). Backs: LFs as black-box voters, limited accuracy and coverage, tie votes, the factor graph and its fitting, label density, the low-, medium- and high-density regimes, Table 1, the 62–82 % default range, 5.81 %, Example 3.1, structure-learning timings, noise-aware loss, the all-abstain example, the asymptotic-rate analysis, 132 % and 3.60 %, cross-modal tasks. [^1]
- [Data Programming: Creating Large Training Sets, Quickly](https://ar5iv.labs.arxiv.org/html/1605.07723) — Ratner, De Sa, Wu, Selsam, Ré, 2016 (ar5iv HTML of arXiv:1605.07723). Backs: LFs need not be accurate, the independent model with β and α, abstaining independent of the class, noise-aware empirical risk, the theorem's assumptions (correct model family, class independent of the features given the LF outputs), crowdsourcing vs LF regime, co-training's two views. [^2]
- [snorkel.labeling.model.label_model.LabelModel](https://snorkel.readthedocs.io/en/v0.9.7/packages/_autosummary/labeling/snorkel.labeling.model.label_model.LabelModel.html) — Snorkel team, 2021 (0.9.7). Backs: label-matrix values and −1 for abstain, `P(lf | Y)`, conditional independence, the matrix-completion method of the AAAI 2019 multi-task weak-supervision paper. [^3]
- [snorkel.labeling.model.baselines.MajorityLabelVoter](https://snorkel.readthedocs.io/en/v0.9.7/packages/_autosummary/labeling/snorkel.labeling.model.baselines.MajorityLabelVoter.html) — Snorkel team, 2021 (0.9.7). Backs: tie-break policy `abstain` by default, 0.5/0.5 probabilities for ties. [^4]
- [snorkel.labeling.LFAnalysis](https://snorkel.readthedocs.io/en/v0.9.7/packages/_autosummary/labeling/snorkel.labeling.LFAnalysis.html) — Snorkel team, 2021 (0.9.7). Backs: coverage, overlap and conflict. [^5]
- [snorkel.labeling.filter_unlabeled_dataframe](https://snorkel.readthedocs.io/en/v0.9.7/packages/_autosummary/labeling/snorkel.labeling.filter_unlabeled_dataframe.html) — Snorkel team, 2021 (0.9.7). Backs: removing examples no LF labels. [^6]
- [snorkel.labeling.labeling_function](https://snorkel.readthedocs.io/en/v0.9.7/packages/_autosummary/labeling/snorkel.labeling.labeling_function.html) — Snorkel team, 2021 (0.9.7). Backs: the decorator and the −1 return value. [^7]
- [Spectral Methods meet EM: A Provably Optimal Algorithm for Crowdsourcing](https://ar5iv.labs.arxiv.org/html/1406.3824) — Zhang, Chen, Zhou, Jordan, 2014 (ar5iv HTML of arXiv:1406.3824). Backs: the Dawid–Skene model (per-worker confusion matrix, latent true labels, maximum likelihood by EM), the E- and M-steps (no prior term, normalized over given labels), non-concavity and initialization, the one-coin model, majority vote with many spammers. [^8]
- [Learning from Noisy Labels with Deep Neural Networks: A Survey](https://ar5iv.labs.arxiv.org/html/2007.08199) — Song, Kim, Park, Shin, Lee, 2020 (ar5iv HTML of arXiv:2007.08199). Backs: 8.0–38.5 % real-world noise, the transition matrix and noise types, memorization and regularization, learning simple patterns first, the small-loss trick and its failure under asymmetric noise, the method families, MAE vs cross-entropy, sample selection's costs. [^9]
- [Pervasive Label Errors in Test Sets Destabilize Machine Learning Benchmarks](https://ar5iv.labs.arxiv.org/html/2103.14749) — Northcutt, Athalye, Mueller, 2021 (ar5iv HTML of arXiv:2103.14749). Backs: at least 3.3 % test-label errors across 10 datasets, ResNet-18 vs ResNet-50 at 6 %. [^10]
- [Confident Learning: Estimating Uncertainty in Dataset Labels](https://ar5iv.labs.arxiv.org/html/1911.00068) — Northcutt, Jiang, Chuang, 2021 (ar5iv HTML of arXiv:1911.00068). Backs: the joint distribution of noisy and true labels from out-of-sample probabilities, pruning. [^11]
- `machine-learning/lab-setup.md` — the lab where the labeling-function, label-model, end-model, duplicated-LF and label-noise script ran on 2026-11-25. [^12]
- [Weak Supervision: A New Programming Paradigm for Machine Learning](http://ai.stanford.edu/blog/weak-supervision/) — Ratner, Varma, Hancock, Ré, Stanford AI Lab Blog, 2019. Backs: the cost of hand labels and relabelling, LFs as code encoding patterns, heuristics, external resources, crowd labels and weak classifiers. [^13]

## Related
- `machine-learning/unsupervised-learning/semi-supervised-learning.md` — uses unlabelled data through the model's own pseudo-labels instead of rules.
- `machine-learning/unsupervised-learning/active-learning.md` — spends a labelling budget on the most useful examples; complements LFs.
- `machine-learning/probabilistic-ml/probabilistic-graphical-models.md` — the factor graph the label model is.
- `machine-learning/unsupervised-learning/gaussian-mixtures-and-em.md` — EM with latent variables, the same E- and M-steps on a different model.
- `machine-learning/deep-learning/training-loop-and-debugging.md` — what label noise and shuffled labels look like in a training loop.
- `machine-learning/learning-theory/pac-learning-and-vc-dimension.md` — a network fitting random labels in the lab, and why capacity bounds cannot explain it.
- `machine-learning/deep-learning/loss-landscapes-and-generalization.md` — networks that fit random labels yet generalize on real ones.
- `machine-learning/evaluation/metrics-catalog.md` — ROC AUC and accuracy used here.
- `machine-learning/evaluation/probability-calibration.md` — why squeezed probabilities matter downstream.
