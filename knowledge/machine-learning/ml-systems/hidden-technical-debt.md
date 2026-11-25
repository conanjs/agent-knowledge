---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/ml-systems
status: verified
applies-to: ["any"]
last-verified: 2026-11-24
last-updated: 2026-11-25
tags: [machine-learning, ml-systems, technical-debt, cace, entanglement, glue-code, pipeline-jungles, feedback-loops, undeclared-consumers, data-dependencies, ml-test-score]
---

# Hidden technical debt in machine learning systems

## Summary
**TL;DR:** A machine learning (ML) model is cheap to build and expensive to keep: the maintenance cost builds up around the model code, in how features, data sources, other systems and the model's own outputs are tangled together. Features are entangled (CACE, "changing anything changes everything"), data comes from sources that change without notice, other teams quietly consume the model's outputs, and a model can shape its own future training data. These failures are silent: nothing crashes, quality just decays. The defence is to treat features, data dependencies and consumers as code that needs owners, tests and monitoring.
**Use this when:** you add or remove a model input, consume another team's data or model outputs, plan what to test before an ML launch, or wonder why a model degraded with no code change.
**Not this doc:** detecting a change in the data → `machine-learning/ml-systems/data-drift-and-monitoring.md`; making training repeatable → `machine-learning/ml-systems/reproducibility-and-determinism.md`; label information leaking into features → `machine-learning/evaluation/data-leakage.md`.

## Problem
A team ships a first model quickly and it scores well offline. A year later every change is slow and risky: adding one signal shifts how the model uses the others, an upstream table stopped updating months ago and nobody noticed, another service reads the model's scores and breaks when they change, and the model's own recommendations now fill its training data. Sculley et al. argue that it is dangerous to treat these quick wins as free, and that massive ongoing maintenance costs are common in real-world ML systems ✅[^1]. In one case reported in Google's Rules of ML, a table was stale for 6 months and refreshing it alone raised the install rate by 2% ✅[^3].

## Mental model
**Analogy:** a loan with hidden interest. Each shortcut (one more feature, one more data source read directly from another team's table, one more consumer allowed to read the scores) buys speed now. The interest is paid later, in places no code review sees: the features behave like sliders tied together with rubber bands, so moving one moves the others, and the people pulling on the bands (data owners, consumers) are not in the room.

**Artifact:** a debt register. Entanglement, data dependencies, undeclared consumers and hidden feedback loops are risk factors named in Sculley et al.'s abstract, which also points to "a variety of system-level anti-patterns" ✅[^1]; glue code and pipeline jungles are two such anti-patterns that Bogner et al.'s survey traces to Sculley et al. and other studies ✅[^2]. Each row gives the symptom and where its interest is paid.

| Debt item | What it looks like | Interest paid when |
|---|---|---|
| Entanglement (CACE) | Adding, removing or changing the distribution of one feature often affects the others ✅[^2] | Incremental improvement is hindered: any change can move everything ✅[^2] |
| Glue code | Generic packages joined by custom code for data transformation and I/O (input/output) ✅[^2] | The system is hard to oversee and can be tightly coupled to specific libraries ✅[^2] |
| Pipeline jungle | The same stitching, at the level of data-preparation pipelines ✅[^2] | The same costs as glue code, in the data preparation ✅[^2] |
| Unstable data dependency | A feature read from another system whose data changes over time ✅[^2] | Harmful effects that are hard to diagnose, with no change in the model's own code ✅[^2] |
| Undeclared consumer | Other systems silently use the model's output as their input ✅[^2] | Obscure side effects when the model evolves ✅[^2] |
| Hidden feedback loop | The model affects its own future training data ✅[^2] ✅[^4] | Wrong classifications and biased decisions, worst when the loop is hidden ✅[^2] |

## How it works

### Where the debt comes from
1. **Entanglement.** A learned model mixes its inputs: adding, removing or changing the distribution of one feature often affects the others, which hinders incremental improvement; Bogner et al.'s survey records that Sculley et al. described this as the CACE principle ✅[^2]. The worked example measures it.
2. **Epsilon and unused features.** Features that bring a negligible gain still cost maintenance ✅[^2]. Rules of ML: unused features create technical debt, so drop them ✅[^3]; the Machine Learning Crash Course (MLCC) asks whether a feature's usefulness justifies its maintenance cost ✅[^4].
3. **Glue code and pipeline jungles.** Systems built from many generic components joined by custom code are hard to oversee and can get tightly coupled to specific external libraries; pipeline jungles are the same at the data-pipeline level ✅[^2]. Wrapping black-box packages in your own API (application programming interface) can address glue code ✅[^2].
4. **Data dependencies.** Using another system's data as a model input speeds up development at first; if that data changes, the effects on the model are harmful and hard to diagnose ✅[^2]. MLCC suggests keeping your own copy of upstream data and moving to a new upstream version only when it is known to be safe ✅[^4].
5. **Silent failures.** When a joined table stops updating, the model adapts and its quality decays gradually instead of failing; a feature's coverage can drop from 90% to 60% of examples after an implementation change ✅[^3].
6. **Consumers and cascades.** Undeclared consumers are hidden coupling. In a correction cascade (a whole model reused and slightly altered), a change in the original may ripple into the "corrected" downstream models ✅[^2].
7. **Train/serve divergence.** Separate code paths for computing features in training and in production are one cause of training–serving skew ✅[^2]; Rules of ML says to reuse code between the two pipelines and avoid two programming languages, which makes sharing code nearly impossible ✅[^3]. Detection is in `machine-learning/ml-systems/data-drift-and-monitoring.md`.

### Feedback loops: who does what
**4 actors:**
- **Model** — its job: rank or score items, via its serving endpoint.
- **Users** — their job: react to what they are shown, via clicks or purchases.
- **Logging** — its job: record those reactions, via event logs.
- **Training pipeline** — its job: fit the next model, via the logged events as labels.

```text
Model v1 ──ranks──► Users see top items ──clicks──► Logs ──labels──► Training ──► Model v2
   ▲                                                                                 │
   └────────────── v2 favours what v1 showed, because only shown items got clicks ◄──┘
```
1. Model: shows its current favourites first (via the ranking it serves).
2. Users: click what is shown; an item placed in first position is clicked more often, which makes it look more clickable than it is ✅[^3].
3. Logging: stores clicks only for items that were shown (via the event log).
4. Training pipeline: learns from those clicks that the shown items are the good ones, so the next model shows them again. MLCC's example: a book recommender driven by purchase counts recommends the same books again because its recommendations drive the purchases ✅[^4].
Rules of ML adds that a ranking change large enough to show different results changes the data the next model will see ✅[^3]. The loop can also run through another model: in MLCC's example, model A's bad stock purchases raise a price that model B uses as a feature ✅[^4].

### Paying it down
- **Test the ML-specific parts.** The ML Test Score paper gives 28 specific tests and monitoring needs, because a model's prediction behaviour is hard to specify in advance ✅[^5]. Test-driven development is tricky in ML: you cannot test the loss before you know what loss is achievable ✅[^7].
- **Gate every new model** against the previous version (catches sudden degradation) and against a fixed threshold (catches slow degradation over many versions) ✅[^7].
- **Own each feature.** Give feature columns owners and documentation ✅[^3]; periodically check that every input is still needed, for example with leave-one-feature-out evaluations ✅[^2].

## Worked example
CACE on synthetic data. The true rule is `y = 1·x1 + 1·x2 + 0.5·x3 + noise`, where `x2 = 0.8·x1 + 0.6·noise` is correlated with `x1` (correlation 0.8, like "visits last week" and "visits last month") and `x3` is independent. A lightly regularized linear model (scikit-learn `Ridge`, L2 penalty `alpha = 100`, 15,000 training rows) is refitted after one change at a time; RMSE (root mean squared error) is measured on 5,000 held-out rows. Core lines:

```python
x2 = 0.8 * x1 + 0.6 * rng.normal(size=n)      # correlated with x1
x2_noisy = x2 + 1.0 * rng.normal(size=n)      # the upstream owner changes how x2 is computed
x4 = x1 + 0.1 * rng.normal(size=n)            # someone adds a near-copy of x1
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-24, numpy 2.5.5, scikit-learn 1.9.1, two runs identical ✅[^6]:

```text
1 baseline                         w1=+0.995  w2=+1.003  w3=+0.498            test RMSE=0.297
2 x2 removed, retrained            w1=+1.793  w3=+0.504                       test RMSE=0.686
3 x2 got noisier, retrained        w1=+1.579  w2=+0.273  w3=+0.501            test RMSE=0.602
4 near-copy x4 added, retrained    w1=+0.724  w2=+0.999  w3=+0.498  w4=+0.277 test RMSE=0.297
5 x2 got noisier, NOT retrained    w1=+0.995  w2=+1.003  w3=+0.498            test RMSE=1.043
```

<details><summary>Full script (prints the output above)</summary>

```python
# CACE ("changing anything changes everything"): one change to one input moves the weights of the others.
# Model: a lightly L2-regularized linear model (Ridge, alpha=100).
import numpy as np
from sklearn.linear_model import Ridge

rng = np.random.default_rng(0)
n = 20_000
x1 = rng.normal(size=n)                       # e.g. "visits last week"
x2 = 0.8 * x1 + 0.6 * rng.normal(size=n)      # "visits last month": correlated with x1 (r = 0.8)
x3 = rng.normal(size=n)                       # an independent signal
y = 1.0 * x1 + 1.0 * x2 + 0.5 * x3 + 0.3 * rng.normal(size=n)
tr, te = slice(0, 15_000), slice(15_000, n)

def fit(cols):
    X = np.column_stack(cols)
    return Ridge(alpha=100.0).fit(X[tr], y[tr]), X

def rmse(m, X):
    return np.sqrt(np.mean((m.predict(X[te]) - y[te]) ** 2))

def show(name, m, X, labels):
    w = "  ".join(f"{l}={c:+.3f}" for l, c in zip(labels, m.coef_))
    print(f"{name:<34} {w:<42} test RMSE={rmse(m, X):.3f}")

base, Xb = fit([x1, x2, x3]);              show("1 baseline", base, Xb, ["w1", "w2", "w3"])
m, X = fit([x1, x3]);                      show("2 x2 removed, retrained", m, X, ["w1", "w3"])
x2_noisy = x2 + 1.0 * rng.normal(size=n)   # upstream owner changes how x2 is computed
m, X = fit([x1, x2_noisy, x3]);            show("3 x2 got noisier, retrained", m, X, ["w1", "w2", "w3"])
x4 = x1 + 0.1 * rng.normal(size=n)         # a new, nearly duplicate feature is added
m, X = fit([x1, x2, x3, x4]);              show("4 near-copy x4 added, retrained", m, X, ["w1", "w2", "w3", "w4"])
show("5 x2 got noisier, NOT retrained", base, np.column_stack([x1, x2_noisy, x3]), ["w1", "w2", "w3"])
```
</details>

Reading it line by line:
- **Row 1** recovers the true weights (about 1, 1 and 0.5).
- **Row 2:** removing `x2` makes `w1` jump from 0.995 to 1.793. With `x2` gone, `x1` carries `x2`'s share through their correlation: `1 + 0.8 × 1 = 1.8`. Error more than doubles (0.297 → 0.686).
- **Row 3:** nothing about `x1` changed, yet its weight rose from 0.995 to 1.579, because the model moved trust away from the now noisier `x2` (1.003 → 0.273). Whoever owns `x1` sees "their" weight change.
- **Row 4:** a near-copy of `x1` splits its weight: `0.724 + 0.277 = 1.001`. Predictions are as good as before (RMSE 0.297), but the individual weights no longer mean what they meant.
- **Row 5** is the silent failure: the same upstream change, without retraining, raises RMSE from 0.297 to 1.043 (3.5 times) with no change at all in the model's own code.
- **`w3` stays at about 0.5 in every row:** in this run the entanglement followed correlation; the independent feature was untouched.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| A feature adds a tiny gain | Kept "for free", then costs maintenance and adds entanglement | Epsilon features bring negligible improvement at a maintenance cost ✅[^2]; MLCC weighs usefulness against cost ✅[^4] |
| Upstream table stops updating | Quality decays slowly; no error is raised | The model adapts to stale data ✅[^3]; lab row 5 shows the damage of an unnoticed input change ✅[^6] |
| Feature coverage drops (90% → 60% of examples) | Same silent decay | An implementation change upstream ✅[^3] |
| Another team reads your scores | Your next model breaks their service | Undeclared consumers are hidden coupling ✅[^2] |
| Model copied and "corrected" downstream | A change in the original may ripple into the copies | Correction cascade ✅[^2] |
| Two models interact through the world | One model's errors become the other's features | MLCC's stock-trading example ✅[^4] |
| Clicks depend on display position | Items shown first get more clicks and look more clickable than they are; trained on those clicks, the model keeps ranking them first | Rules #36: train with positional features, give every candidate the same default at serving (candidates are scored before their order is decided), and keep positional features separate from the rest of the model ✅[^3] |
| Experimental branches left in the code | Conditional paths pile up and are forgotten | Dead experimental codepaths ✅[^2] |
| Training in one language, serving in another | Feature code cannot be shared, so it diverges | Rules #32 ✅[^3]; multiple-language smell ✅[^2] |
| Feature is independent of all others | In the lab's linear model, changes elsewhere left its weight alone | Lab: `w3` ≈ 0.5 in all five rows ✅[^6] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Add a feature for a small offline gain | A little accuracy | Maintenance and one more entangled input ✅[^2] ✅[^4] |
| Read another team's table directly | Fast to build | Unstable dependency; their change becomes your outage ✅[^2] |
| Keep your own copy of upstream data | You choose when to move to a new version ✅[^4] | Storage, and the copy can go stale ✅[^3] |
| Log features at serving time and train on them | Train exactly as you serve ✅[^3] | Logging cost; only as good as the logged sample |
| Wrap black-box packages in your own API | Less glue-code coupling ✅[^2] | Up-front work |
| Hold back a small fraction of traffic from a filtering model (Rules #34) | Clean training data without sampling bias, and a measure of serving performance ✅[^3] | A small short-term loss in performance ✅[^3] |

## Takeaways
- Treat every model input as a dependency with an owner, a schema and a monitor; a feature without an owner is debt. [rule-candidate]
- Re-evaluate the whole model after any feature change, even one that "only touches" one input: weights of correlated inputs move too.
- Gate each new model against both the previous version and a fixed quality threshold before serving it. [rule-candidate]
- Before relying on a model's offline metrics, ask whether its outputs feed its own future training data.
- Delete features and experimental code paths that no longer earn their keep.

## Verification status
- Verified: 61 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- [Hidden Technical Debt in Machine Learning Systems (abstract)](https://papers.nips.cc/paper_files/paper/2015/hash/86df7dcfd896fcaf2674f757a2463eba-Abstract.html) — Sculley et al., NeurIPS (Conference on Neural Information Processing Systems) 2015. Backs: quick wins are not free, massive ongoing maintenance costs are common, the list of ML-specific risk factors. [^1]
- [Characterizing Technical Debt and Antipatterns in AI-Based Systems: A Systematic Mapping Study](https://arxiv.org/html/2103.09783v1) — Bogner, Verdecchia, Gerostathopoulos, 2021. Backs: definitions of feature entanglement and CACE, epsilon features, glue code, pipeline jungles, unstable data dependencies, undeclared consumers, correction cascades, direct feedback loops, dead experimental codepaths, multiple-language smell, train/serve skew from separate code paths; solutions (wrap black-box packages, remove unnecessary features with leave-one-feature-out checks). [^2]
- [Rules of Machine Learning](https://developers.google.com/machine-learning/guides/rules-of-ml) — Martin Zinkevich, Google for Developers, living. Backs: Rules #10 (silent failures, stale table, coverage drop), #11 (feature owners), #22 (unused features are debt), #29 (log features at serving), #32 (reuse code, one language), #34 (held-out traffic), #35 (ranking changes the future data), #36 (positional features). [^3]
- [Production ML systems: Questions to ask](https://developers.google.com/machine-learning/crash-course/production-ml-systems/questions?hl=en) — Google Machine Learning Crash Course, living. Backs: feature usefulness vs maintenance cost, unreliable data sources and keeping your own copy, feedback-loop examples (book recommender, two stock models). [^4]
- [The ML Test Score: A Rubric for ML Production Readiness and Technical Debt Reduction (abstract)](https://research.google/pubs/the-ml-test-score-a-rubric-for-ml-production-readiness-and-technical-debt-reduction/) — Breck, Cai, Nielsen, Salib, Sculley, IEEE Big Data 2017. Backs: 28 tests and monitoring needs; prediction behaviour is hard to specify a priori. [^5]
- `machine-learning/lab-setup.md` — the lab where the CACE experiment (Ridge weights under five feature changes) ran on 2026-11-24. [^6]
- [Production ML systems: Deployment testing](https://developers.google.com/machine-learning/crash-course/production-ml-systems/deployment-testing?hl=en) — Google Machine Learning Crash Course, living. Backs: test-driven development is tricky in ML; validate new models against the previous version and a fixed threshold. [^7]

## Related
- `machine-learning/ml-systems/data-drift-and-monitoring.md` — how to detect the data changes that make this debt come due.
- `machine-learning/ml-systems/reproducibility-and-determinism.md` — recreating training data and models, the cure for pipeline jungles.
- `machine-learning/evaluation/data-leakage.md` — features that only exist because the label leaked into them.
- `machine-learning/data-and-features/preprocessing-and-pipelines.md` — one pipeline object for training and serving transforms.
- `machine-learning/data-and-features/feature-importance-and-selection.md` — measuring whether a feature earns its place, and why correlated features confuse importance.
- `machine-learning/recommender-systems/feedback-loops-and-popularity-bias.md` — the feedback loop in a recommender, simulated: homogenized users, concentrated exposure and what helps.
