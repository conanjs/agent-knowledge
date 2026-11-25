---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/probabilistic-ml
status: verified
applies-to: ["scikit-learn 1.9.1"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [machine-learning, naive-bayes, conditional-independence, gaussian-nb, multinomial-nb, bernoulli-nb, laplace-smoothing, text-classification, calibration, scikit-learn]
---

# Naive Bayes: conditional independence, Gaussian, multinomial and Bernoulli variants, Laplace smoothing

## Summary
**TL;DR:** A naive Bayes classifier applies Bayes' rule to pick the class `y` with the largest `P(y) · Π_i P(x_i | y)`, after assuming that the features are independent of each other once the class is known. That assumption turns an impossible joint model into one small one-dimensional model per feature and class, so training is counting (or estimating a mean and variance) and is very fast. The variants differ only in the per-feature model: Gaussian for real values, multinomial for counts such as word counts, Bernoulli for yes/no features. Smoothing adds pseudo-counts so that a word never seen with a class does not make that class impossible. The class it picks is often right; the probability it reports is often far too confident.
**Use this when:** you need a fast baseline for text or count data, you train on very little data or on data that does not fit in memory, or a naive Bayes model's probabilities look suspiciously close to 0 and 1.
**Not this doc:** Bayes' rule, priors and pseudo-counts in general → `machine-learning/probabilistic-ml/bayesian-inference.md`; fixing over-confident probabilities → `machine-learning/evaluation/probability-calibration.md`.

## Problem
A classifier needs `P(y | x)` for every possible input `x`. With 30 yes/no features, such as "the word apple appears", there are `2^30`, over a billion, input combinations, and a model of the full joint distribution needs on the order of `2^d` parameters for `d` features ✅[^2]. Naive Bayes cuts this to a number linear in `d` ✅[^2], but pays with an assumption that is false in most real data: words, pixels and measurements depend on each other within a class. The visible symptoms are probabilities pushed towards 0 and 1 ✅[^3], and, without smoothing, a single word never seen with a class vetoing that class entirely (lab: `P(ham) = 7.7e-10` for a document that is otherwise typical ham) ✅[^5].

## Mental model
**Analogy:** a jury of witnesses who never talk to each other. Each witness reports how typical one clue is for each verdict, and the foreman multiplies their reports together with the base rate of each verdict. With independent witnesses this is a fair summary. If twenty witnesses are clones repeating the same story, the foreman counts that story twenty times: the verdict hardly changes, but the foreman becomes absurdly sure of it.

**Artifact:** each of two informative features copied `k` times, Gaussian naive Bayes against logistic regression on the same 2,000 test rows. Lab run (`machine-learning/lab-setup.md`), 2026-11-24, scikit-learn 1.9.1, two runs identical ✅[^5]:

```text
copies  model     accuracy  log loss  share of P>0.99 or P<0.01
    1   GaussNB   0.950     0.220     0.438
    1   LogReg    0.954     0.190     0.251
    5   GaussNB   0.950     0.736     0.964
    5   LogReg    0.954     0.189     0.268
   20   GaussNB   0.950     1.430     0.991
   20   LogReg    0.954     0.189     0.271
```

Accuracy does not move in this run ✅[^5]: copying a feature multiplies its log-likelihood ratio by `k`, which mostly changes the size of the log-odds, not their sign. Log loss (the average negative log-probability of the true class) grows from 0.220 to 1.430, and 99.1 % of naive Bayes probabilities end up beyond 0.99 or 0.01. Logistic regression, which fits the weights jointly, is unaffected. The scikit-learn calibration guide attributes the same push towards 0 and 1 to the independence assumption on data with redundant features ✅[^3].

<details><summary>Full script (prints the output above)</summary>

```python
import numpy as np
from sklearn.datasets import make_classification
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import log_loss
from sklearn.model_selection import train_test_split
from sklearn.naive_bayes import GaussianNB

# copy each feature k times: naive Bayes counts the same evidence k times
X, y = make_classification(n_samples=4000, n_features=2, n_informative=2, n_redundant=0,
                           n_clusters_per_class=1, flip_y=0.05, random_state=0)
Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.5, random_state=0)
print("copies  model     accuracy  log loss  share of P>0.99 or P<0.01")
for k in [1, 5, 20]:
    tr, te = np.repeat(Xtr, k, axis=1), np.repeat(Xte, k, axis=1)
    for name, m in [("GaussNB", GaussianNB()), ("LogReg ", LogisticRegression())]:
        p = m.fit(tr, ytr).predict_proba(te)[:, 1]
        extreme = ((p > 0.99) | (p < 0.01)).mean()
        print(f"{k:5d}   {name}   {m.score(te, yte):.3f}     {log_loss(yte, p):.3f}     {extreme:.3f}")
```
</details>

## How it works
1. **Bayes' rule for a class:** `P(y | x_1, …, x_n) = P(y) · P(x_1, …, x_n | y) / P(x_1, …, x_n)` ✅[^1]. The denominator does not depend on `y`, so the classifier compares numerators only and can recover normalized probabilities afterwards, because they must sum to 1 over the classes ✅[^1] ✅[^2].
2. **The naive assumption:** each feature is independent of the others given the class, `P(x_i | y, other features) = P(x_i | y)`, so the rule becomes `ŷ = argmax_y P(y) · Π_i P(x_i | y)` ✅[^1]. This takes the model from `O(2^d · n)` to `O(d · n)` parameters for `d` features and `n` classes ✅[^2].
3. **Training:** `P(y)` is the class's relative frequency in the training set ✅[^1], and each `P(x_i | y)` is estimated on its own as a one-dimensional distribution, which also eases the curse of dimensionality ✅[^1]. On binary images this means counting how often each pixel is on per class ✅[^2].
4. **Predicting in log space:** a product of hundreds of probabilities underflows; d2l shows `0.1^784` evaluating to `0.0` while `784 · log(0.1) = −1805.2` is an ordinary number, so implementations sum logarithms instead ✅[^2].
5. **Smoothing:** a zero count gives `P(x_i | y) = 0` and one zero wipes out the whole product. Adding a pseudo-count to every count fixes this; adding 1 is Laplace smoothing, which can be motivated from a Bayesian view as a Beta–binomial model ✅[^2] (see `machine-learning/probabilistic-ml/bayesian-inference.md`).

**The variants** differ only in the model of `P(x_i | y)` ✅[^1]:

| Variant | Feature type | `P(x_i | y)` | Notes |
|---|---|---|---|
| `GaussianNB` | Real values | Normal density with per-class mean `μ_y` and variance `σ²_y`, both estimated by maximum likelihood ✅[^1] | `var_smoothing` (default `1e-9`) adds that fraction of the largest feature variance to every variance, for numerical stability ✅[^4] |
| `MultinomialNB` | Counts (word counts; tf-idf (term frequency–inverse document frequency) also works in practice) | `θ_yi = (N_yi + α) / (N_y + α · n)` ✅[^1] | `N_yi`: count of feature `i` in class `y`; `N_y`: all counts in class `y`; `n`: number of features; `α = 1` is Laplace smoothing, `α < 1` Lidstone smoothing ✅[^1] |
| `BernoulliNB` | Binary (word present or not) | `P(x_i = 1 | y)` if present, `1 − P(x_i = 1 | y)` if absent ✅[^1] | Penalizes the absence of a feature that indicates the class, which the multinomial variant ignores; may binarize non-binary input (`binarize`) ✅[^1] |
| `ComplementNB` | Counts, imbalanced classes | Statistics from the complement of each class ✅[^1] | Its inventors report more stable estimates than multinomial naive Bayes and frequent wins on text classification ✅[^1] |
| `CategoricalNB` | Categories per feature | One categorical distribution per feature and class, smoothed like the multinomial ✅[^1] | |

**Out-of-core:** `MultinomialNB`, `BernoulliNB` and `GaussianNB` offer `partial_fit` for data that does not fit in memory; the first call must list all class labels ✅[^1].

## Worked example
Five tiny "emails" as word counts over the vocabulary `free, money, meeting, report` (three spam, two ham), and a new document "free report report report". The class scores are computed by hand as `log P(y) + Σ_i x_i · log θ_yi`, then normalized in log space, and compared with `MultinomialNB`; the same is done for a two-feature `GaussianNB`. Core lines:

```python
theta = (counts + alpha) / (counts.sum() + alpha * len(vocab))   # smoothed P(word | class)
log_score[c] = np.log(prior) + (doc[0] * np.log(theta)).sum()
by_hand = np.exp(s - np.logaddexp.reduce(s))                      # normalize in log space
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-24, scikit-learn 1.9.1, two runs identical ✅[^5]:

```text
ham  counts=[0, 1, 3, 3] theta=[0.0909, 0.1818, 0.3636, 0.3636] prior=0.4
spam counts=[4, 3, 0, 1] theta=[0.4167, 0.3333, 0.0833, 0.1667] prior=0.6
alpha=1: P(ham | doc) by hand=0.6017 sklearn=0.6017; P(spam | doc) by hand=0.3983 sklearn=0.3983
alpha=1e-10: P(ham | doc) by hand=7.677e-10 sklearn=7.677e-10; P(spam | doc) by hand=1 sklearn=1
GaussianNB by hand: [1.6e-05, 0.999984] sklearn: [1.6e-05, 0.999984]
```

Reading it:
- **Smoothed estimates:** ham never contains `free` (count 0), but with `α = 1` its estimate is `(0 + 1) / (7 + 4) = 0.0909`; spam's `free` is `(4 + 1) / (8 + 4) = 0.4167`.
- **The scores:** ham `log 0.4 + log 0.0909 + 3 · log 0.3636 = −6.349`; spam `log 0.6 + log 0.4167 + 3 · log 0.1667 = −6.762`. The difference 0.413 gives `P(ham) = 1 / (1 + e^(−0.413)) = 0.6017`: three `report`s outweigh one `free`.
- **Without smoothing** (`α = 1e-10`, essentially zero), ham's `free` estimate is about `1e-11`, and the same document becomes spam with probability 1 (`P(ham) = 7.7e-10`): one unseen word vetoes the class.
- **Gaussian variant:** the by-hand normal densities with maximum-likelihood means and variances plus `var_smoothing` match `GaussianNB` to six decimals.

<details><summary>Full script (prints the output above)</summary>

```python
import numpy as np
from sklearn.naive_bayes import GaussianNB, MultinomialNB

# multinomial naive Bayes by hand vs scikit-learn on a 5-document word-count table
vocab = ["free", "money", "meeting", "report"]
X = np.array([[2, 1, 0, 0],      # spam
              [1, 2, 0, 0],      # spam
              [1, 0, 0, 1],      # spam
              [0, 0, 2, 1],      # ham
              [0, 1, 1, 2]])     # ham
y = np.array(["spam", "spam", "spam", "ham", "ham"])
doc = np.array([[1, 0, 0, 3]])   # new document: "free report report report"
for alpha in [1.0, 1e-10]:
    log_score = {}
    for c in ["ham", "spam"]:
        counts = X[y == c].sum(axis=0)                          # N_ci per word
        theta = (counts + alpha) / (counts.sum() + alpha * len(vocab))
        prior = (y == c).mean()
        log_score[c] = np.log(prior) + (doc[0] * np.log(theta)).sum()
        if alpha == 1.0:
            print(f"{c:4s} counts={counts.tolist()} theta={theta.round(4).tolist()} prior={prior:.1f}")
    s = np.array([log_score["ham"], log_score["spam"]])
    by_hand = np.exp(s - np.logaddexp.reduce(s))                # normalize in log space
    sk = MultinomialNB(alpha=alpha).fit(X, y).predict_proba(doc)[0]
    print(f"alpha={alpha:g}: P(ham | doc) by hand={by_hand[0]:.4g} sklearn={sk[0]:.4g}; "
          f"P(spam | doc) by hand={by_hand[1]:.4g} sklearn={sk[1]:.4g}")

# Gaussian naive Bayes by hand vs scikit-learn
Xg = np.array([[1.0, 2.0], [1.2, 1.8], [0.8, 2.2], [3.0, 0.5], [3.3, 0.4], [2.9, 0.7]])
yg = np.array([0, 0, 0, 1, 1, 1])
xq = np.array([2.0, 1.0])
eps = 1e-9 * Xg.var(axis=0).max()                               # GaussianNB's var_smoothing
logp = []
for c in [0, 1]:
    mu, var = Xg[yg == c].mean(0), Xg[yg == c].var(0) + eps     # maximum-likelihood mean and variance
    logp.append(np.log(0.5) - 0.5 * (np.log(2 * np.pi * var) + (xq - mu) ** 2 / var).sum())
logp = np.array(logp)
print("GaussianNB by hand:", np.exp(logp - np.logaddexp.reduce(logp)).round(6).tolist(),
      "sklearn:", GaussianNB().fit(Xg, yg).predict_proba([xq])[0].round(6).tolist())
```
</details>

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Word never seen with a class, no smoothing | That class's probability collapses to about 0 (lab: `7.7e-10`) | One zero factor zeroes the product ✅[^2] ✅[^5]; `α` prevents zero probabilities ✅[^1] |
| Redundant or duplicated features | Same accuracy, probabilities pushed to 0 or 1 (lab: 99.1 % beyond 0.99 / 0.01 with 20 copies) | Evidence is counted once per copy ✅[^5]; independence assumption violated ✅[^3] |
| Using `predict_proba` as a risk score | Unreliable | Naive Bayes is a decent classifier but a bad estimator ✅[^1]; calibrate first |
| Binary MNIST (handwritten-digit dataset) pixels | 0.8427 accuracy in d2l, far behind deep networks | Pixels are not independent given the digit ✅[^2] |
| Hundreds of features multiplied as raw probabilities | Product underflows to `0.0` | Sum logs instead ✅[^2] |
| Feature with zero variance within a class (`GaussianNB`) | Division by a zero variance avoided | `var_smoothing` adds a fraction of the largest variance ✅[^4] |
| Count data given to `BernoulliNB` | Binarized, depending on `binarize` | The model expects binary features ✅[^1] |
| First `partial_fit` call without `classes` | Not allowed | The first call must receive every expected class label ✅[^1] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Naive Bayes | Needs little training data; can be extremely fast; each feature model estimated separately ✅[^1] | Wrong independence assumption costs accuracy on structured data ✅[^2]; over-confident probabilities ✅[^3] |
| Logistic regression | Fits weights jointly; more likely to return well-calibrated probabilities, as in the guide's example where the model is well specified and `C` is tuned ✅[^3] | Iterative optimization instead of counting |
| `MultinomialNB` vs `BernoulliNB` on text | Multinomial uses counts; Bernoulli also scores absent words and may do better on short documents ✅[^1] | Evaluate both when time permits ✅[^1] |

## Takeaways
- Use naive Bayes as a fast first baseline for text and count data; compare it against logistic regression before shipping. [rule-candidate]
- Always smooth (`α > 0`); `α = 1` is Laplace smoothing.
- Do not read naive Bayes probabilities as risks without calibration, especially with correlated features. [rule-candidate]
- Correlated or duplicated features do not hurt naive Bayes accuracy much here but destroy its probabilities.

## Verification status
- Verified: 46 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- [Naive Bayes (User Guide 1.9)](https://scikit-learn.org/stable/modules/naive_bayes.html) — scikit-learn developers, living (1.9.1). Backs: Bayes' rule and the naive assumption, MAP decision rule, class prior as relative frequency, separate one-dimensional estimates, "bad estimator", the Gaussian, multinomial (with smoothing formula), Bernoulli, complement and categorical variants, `partial_fit`. [^1]
- [Naive Bayes (Dive into Deep Learning, appendix 22.9)](https://d2l.ai/chapter_appendix-mathematics-for-deep-learning/naive-bayes.html) — Zhang, Lipton, Li, Smola, living. Backs: `2^30` combinations, `O(2^d n)` vs `O(dn)`, normalization, pixel counting, Laplace smoothing as a Beta–binomial pseudo-count, underflow and log space, MNIST accuracy 0.8427 and why. [^2]
- [Probability calibration (User Guide 1.16)](https://scikit-learn.org/stable/modules/calibration.html) — scikit-learn developers, living (1.9.1). Backs: `GaussianNB` pushes probabilities to 0 or 1 because of the independence assumption with redundant features; well-specified logistic regression is well calibrated. [^3]
- [GaussianNB (API reference)](https://scikit-learn.org/stable/modules/generated/sklearn.naive_bayes.GaussianNB.html) — scikit-learn developers, living (1.9.1). Backs: `var_smoothing` default and meaning. [^4]
- `machine-learning/lab-setup.md` — the lab where the duplicated-feature comparison and the by-hand multinomial and Gaussian naive Bayes checks ran on 2026-11-24. [^5]

## Related
- `machine-learning/probabilistic-ml/bayesian-inference.md` — Bayes' rule, priors and pseudo-counts.
- `machine-learning/evaluation/probability-calibration.md` — reliability curves and calibrating over-confident models.
- `machine-learning/supervised-learning/logistic-regression.md` — the discriminative counterpart.
- `machine-learning/evaluation/classification-metrics.md` — log loss and the metrics used above.
- `machine-learning/probabilistic-ml/probabilistic-graphical-models.md` — naive Bayes as the simplest Bayesian network.
- `machine-learning/supervised-learning/discriminant-analysis.md` — Gaussian class models with shared or separate covariances.
