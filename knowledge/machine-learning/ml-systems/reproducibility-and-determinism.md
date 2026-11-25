---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/ml-systems
status: verified
applies-to: ["PyTorch 2.15", "scikit-learn 1.9.1", "NumPy 2.5"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [machine-learning, ml-systems, reproducibility, determinism, random-seed, random_state, use_deterministic_algorithms, floating-point, summation-order, versioning, model-persistence]
---

# Reproducibility and determinism in machine-learning training

## Summary
**TL;DR:** A training run is reproducible when the same code, data, configuration and environment give the same model. Three layers stand in the way. **Seeded randomness** (initial weights, shuffling, sampling, train/test splits) is fixed by seeding every generator separately: Python, NumPy, PyTorch and each scikit-learn `random_state`. **Unseeded nondeterminism** comes from the order in which parallel code adds floating-point numbers and from kernels without a deterministic implementation; `torch.use_deterministic_algorithms(True)` swaps in deterministic kernels or raises an error; in the lab, a fixed thread count also made a parallel `torch.sum` repeat exactly on one machine, but did not make a scatter-add repeat. **The environment** (library versions, hardware, CPU (central processing unit) versus GPU (graphics processing unit)) is outside both: PyTorch does not guarantee completely reproducible results across releases or platforms, so data snapshots, code and dependency versions must be recorded with every model.
**Use this when:** two runs of the same script disagree, a regression test on model output is flaky, you compare two model variants and need to know whether the difference is real, or you must reload or rebuild a model in a newer environment.
**Not this doc:** setting up the lab and its seeding checklist → `machine-learning/lab-setup.md`; why float addition depends on order → `floating-point/rounding-and-error.md`; cross-validation splitters → `machine-learning/evaluation/cross-validation-and-hyperparameter-search.md`.

## Problem
You add a feature, retrain, and accuracy moves by one point. Was it the feature, or the seed? In the lab, a random forest's test accuracy ranged from 0.959 to 0.977 over five seeds with nothing else changed ✅[^6], so a one-point "improvement" from one run proves nothing. For a fair experiment the datasets must be identical except for the change under test ✅[^7]. Without reproducibility you also cannot debug a one-off failure, keep an exact-output regression test stable, or rebuild a model whose library is upgraded.

## Mental model
**Analogy:** baking from a recipe. The code is the recipe, the data is the batch of ingredients, the library and hardware are the oven. A seed is writing down which eggs you took from the box, so the next bake uses the same ones. But even with the same eggs, two cooks who stir in a different order get a slightly different cake (floating-point addition order), and a different oven bakes differently (library version, CPU or GPU). Reproducibility means recording all three: the eggs, the order, and the oven.

**Artifact:** where variation enters a training run, and what controls it.

| Source | Example | Controlled by |
|---|---|---|
| Random initial weights, dropout | `torch.nn.Linear` init | `torch.manual_seed` (all devices) ✅[^1] |
| Library-internal randomness | Random forest feature subsets, `KFold(shuffle=True)` | An integer `random_state` per object ✅[^2] |
| Data order, data-loader workers | `DataLoader(num_workers=4)` | `worker_init_fn` + a seeded `generator` ✅[^1] |
| Floating-point reduction order | A parallel sum split across threads | Thread count, deterministic kernels (lab below) |
| Kernel choice | cuDNN (NVIDIA's CUDA Deep Neural Network library, used by PyTorch's CUDA convolutions; CUDA is NVIDIA's GPU computing platform) benchmarks several algorithms and keeps the fastest | `torch.backends.cudnn.benchmark = False` ✅[^1] |
| Library version, platform, CPU vs GPU | The same seed on another release | Not guaranteed ✅[^1]: record versions |
| Data and code version | The upstream table changed | Snapshots and version control ✅[^4] ✅[^5] |

## How it works

### 1. Seeded randomness: one generator per library
1. **PyTorch:** `torch.manual_seed(0)` seeds the generator for all devices. Some operations, such as `torch.svd_lowrank()`, draw random numbers internally, so back-to-back calls differ; with a constant seed at the start and no other nondeterminism, the same series of numbers comes out each run in the same environment ✅[^1].
2. **Python and NumPy:** custom operators may need `random.seed(0)`, and libraries using NumPy need `np.random.seed(0)` for the global generator, plus their own seeding for NumPy `Generator` objects ✅[^1].
3. **Data loading:** worker processes are reseeded; pass a `worker_init_fn` that seeds NumPy and `random` from `torch.initial_seed()`, and a seeded `torch.Generator` ✅[^1].
4. **scikit-learn `random_state`:** `None` (the default) uses NumPy's global random state, so repeated calls give different results; an integer creates a new generator seeded by that integer, so repeated calls give the same results; a `RandomState` instance is shared and consumed by each call ✅[^2]. For results that are constant across executions, remove every `random_state=None`; the recommended way is to create one `rng` at the top of the program and pass it to every object, and scikit-learn does not recommend `np.random.seed(0)` ✅[^3].
5. **Fixed order of creation:** initialize model components in a fixed order so each gets the same random numbers on every run ✅[^4]; the lab shows the second layer created after one seed gets different weights from the first ✅[^6].
6. **Deterministic splits:** to split or sample data by hashing, hash on stable keys, never on the current time or a random number ✅[^7].

### 2. Nondeterminism that seeds do not fix
1. **Addition order.** Floating-point rounding is not associative, so a different summation order gives a different result (`floating-point/rounding-and-error.md`). NumPy's `sum` often uses partial pairwise summation, but only along the fast axis in memory, and the exact precision may vary with other parameters ✅[^8]. In the lab, `torch.sum` of the same float32 tensor gave three different values with 1, 2 and 4 threads ✅[^6], consistent with each thread count adding up a different set of partial sums.
2. **Kernels without a deterministic implementation.** `torch.use_deterministic_algorithms(True)` makes operations use deterministic algorithms when available and raise a `RuntimeError` when only nondeterministic ones exist; `warn_only=True` turns the error into a warning ✅[^9]. Most listed operations are GPU ones (CUDA, or MPS: Metal Performance Shaders, Apple's GPU backend), but some are CPU ones: `index_put` with `accumulate=True` on a CPU tensor becomes deterministic, and `put_` with `accumulate=False` raises ✅[^9].
3. **What the flag adds.** With it on, `torch.utils.deterministic.fill_uninitialized_memory` (default `True`) fills uninitialized memory such as `torch.empty()`'s with a known value ✅[^1], and the deterministic mode of Inductor (PyTorch's kernel-generating compiler) is turned on too, which skips the on-device benchmarking and autotuning that affect numerics ✅[^9].
4. **What the flag does not cover.** Alone it is not always enough for a reproducible application ✅[^9]; it does not detect in-place operations on a tensor with internal memory overlap ✅[^9]; and completely reproducible results are still not guaranteed across PyTorch releases, commits or platforms, nor between CPU and GPU runs ✅[^1].
5. **Cost.** Deterministic operations are often slower than nondeterministic ones ✅[^1].

### 3. Versioning data, code and models
1. **Version everything you change:** use version control even for early iterations ✅[^4], track model performance by versions of code, model and data ✅[^7], and keep your own copy of upstream data (`machine-learning/ml-systems/hidden-technical-debt.md`).
2. **Average over seeds** when comparing models: the Machine Learning Crash Course (MLCC) suggests averaging several runs ✅[^4], and the scikit-learn glossary suggests checking that results are stable across several distinct seeds ✅[^2].
3. **Save metadata with every saved model.** scikit-learn supports no way to load a model trained with a different scikit-learn version; saved models should carry a reference to an immutable snapshot of the training data, the source code, the versions of scikit-learn and its dependencies, and the cross-validation score ✅[^5]. Loading with a different version raises `InconsistentVersionWarning` ✅[^5]. Pin transitive dependencies so training and production use the same versions ✅[^5].

## Worked example
One script, five checks on the reference CPU. Core lines:

```python
rf = lambda rs: RandomForestClassifier(n_estimators=50, random_state=rs).fit(Xtr, ytr)
np.cumsum(x)[-1]                       # strict left-to-right float32 sum
sum(c.sum() for c in np.split(x, 4))   # 4 partial sums, then added: like 4 threads
torch.set_num_threads(n); t.sum()      # the same tensor summed with 1, 2, 4 threads
torch.use_deterministic_algorithms(mode)
torch.zeros(10).index_put_((idx,), vals, accumulate=True)   # 1,000,000 adds into 10 slots
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-24, Apple M2, PyTorch 2.15.0 (CPU), numpy 2.5.5, scikit-learn 1.9.1; three runs identical ✅[^6]:

```text
1  numpy: two unseeded generators agree: False | two generators seeded 42 agree: True
2  sklearn: two fits identical with random_state=None: False | with random_state=0: True
   test accuracy for random_state 0..4: [0.965, 0.959, 0.977, 0.965, 0.971]
3  float32 sum of 1e6 values: exact=998.570663 | left-to-right=998.564270 | right-to-left=998.541443 | numpy pairwise=998.570557 | 4 chunks then add=998.570496
   torch.sum with 1 thread(s) = 998.570496
   torch.sum with 2 thread(s) = 998.570923
   torch.sum with 4 thread(s) = 998.570862
4  torch init equal after the same seed: True | next layer without reseeding: False
5  use_deterministic_algorithms(False): index_put_(accumulate=True) gave more than 1 result in 20 identical calls
5  use_deterministic_algorithms(True): index_put_(accumulate=True) gave 1 result in 20 identical calls
   put_ with determinism on -> put_ does not have a deterministic implementation
```

<details><summary>Full script (prints the output above)</summary>

```python
# Reproducibility on one CPU: seeds, float summation order, and torch.use_deterministic_algorithms.
import math
import numpy as np, torch
from sklearn.datasets import load_breast_cancer
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split

print("1  numpy: two unseeded generators agree:", np.random.default_rng().random() == np.random.default_rng().random(),
      "| two generators seeded 42 agree:", np.random.default_rng(42).random() == np.random.default_rng(42).random())

X, y = load_breast_cancer(return_X_y=True)
Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.3, random_state=0)
rf = lambda rs: RandomForestClassifier(n_estimators=50, random_state=rs).fit(Xtr, ytr)
print("2  sklearn: two fits identical with random_state=None:",
      np.array_equal(rf(None).feature_importances_, rf(None).feature_importances_),
      "| with random_state=0:", np.array_equal(rf(0).feature_importances_, rf(0).feature_importances_))
print("   test accuracy for random_state 0..4:", [round(rf(s).score(Xte, yte), 3) for s in range(5)])

x = np.random.default_rng(0).normal(size=1_000_000).astype(np.float32)
print(f"3  float32 sum of 1e6 values: exact={math.fsum(x.astype(np.float64)):.6f}"
      f" | left-to-right={np.cumsum(x)[-1]:.6f} | right-to-left={np.cumsum(x[::-1])[-1]:.6f}"
      f" | numpy pairwise={x.sum():.6f} | 4 chunks then add={sum(c.sum() for c in np.split(x, 4)):.6f}")
t = torch.from_numpy(x)
for n in (1, 2, 4):
    torch.set_num_threads(n)
    print(f"   torch.sum with {n} thread(s) = {t.sum().item():.6f}")

torch.manual_seed(0); a = torch.nn.Linear(4, 2).weight
torch.manual_seed(0); b = torch.nn.Linear(4, 2).weight
c = torch.nn.Linear(4, 2).weight
print("4  torch init equal after the same seed:", torch.equal(a, b), "| next layer without reseeding:", torch.equal(a, c))

g = torch.Generator().manual_seed(1)
idx, vals = torch.randint(0, 10, (1_000_000,), generator=g), torch.randn(1_000_000, generator=g)
def distinct_results(runs=20):                     # scatter-add with many duplicate indices, 4 threads
    return len({tuple(torch.zeros(10).index_put_((idx,), vals, accumulate=True).tolist()) for _ in range(runs)})
for mode in (False, True):
    torch.use_deterministic_algorithms(mode)
    print(f"5  use_deterministic_algorithms({mode}): index_put_(accumulate=True) gave "
          f"{'1 result' if distinct_results() == 1 else 'more than 1 result'} in 20 identical calls")
try:
    torch.zeros(5).put_(torch.tensor([0, 0]), torch.tensor([1.0, 2.0]))
except RuntimeError as e:
    print("   put_ with determinism on ->", str(e).split(",")[0])
```
</details>

Reading it line by line:
- **Check 1:** two unseeded NumPy generators draw different numbers; two seeded with 42 draw the same.
- **Check 2:** `random_state=None` gives a different forest on each fit; an integer gives the same one. The five seeds' accuracies spread over `0.977 − 0.959 = 0.018`: 1.8 points from the seed alone, on the same data and split.
- **Check 3:** the exact sum (`math.fsum` in float64) is 998.570663. Adding the same 1,000,000 float32 values left to right gives 998.564270 and right to left 998.541443: different orders, different digits (here from the second or third decimal on). NumPy's pairwise sum (998.570557) is much closer to exact. Four partial sums then added (998.570496) equals `torch.sum` on one thread, and 2 or 4 threads give two more values. Each value repeated exactly across the three runs: for this `torch.sum` on this machine, a fixed thread count gave a fixed result (check 5 shows an operation for which it did not).
- **Check 4:** reseeding before creating a layer reproduces its weights; the next layer created without reseeding gets new ones, which is why creation order matters.
- **Check 5:** with determinism off, 20 identical scatter-adds on 4 CPU threads gave more than one distinct result; with it on, exactly one. `put_` has no deterministic implementation, so it raised `RuntimeError` instead of running.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `torch.manual_seed` set, results still differ between back-to-back calls of `torch.svd_lowrank` | Expected | The op draws random numbers internally; reseed between calls to repeat it ✅[^1] |
| A library uses its own NumPy `Generator` | `np.random.seed` does not reach it | `Generator` objects need their own seeding ✅[^1] |
| Two estimators share one `RandomState` instance | Fitting one changes the other's results | The generator is shared and consumed; `clone` then gives only a statistical copy ✅[^3] |
| Integer `random_state` in a forest under cross-validation | Every fold uses the same random feature subsets | Same RNG (random number generator) per fit; pass an instance for robust CV (cross-validation) results ✅[^3] |
| Same script, different thread count | In the lab, the last digits of a sum changed | Reduction order changes; lab: 998.570496 / 998.570923 / 998.570862 ✅[^6] |
| Deterministic mode and an op without a deterministic kernel | `RuntimeError` (or a warning with `warn_only=True`) | ✅[^9]; lab: `put_` ✅[^6] |
| cuDNN benchmarking on | Different convolution algorithm per run, even on one machine | Benchmark noise; and the chosen algorithm may itself be nondeterministic unless the deterministic flag is set ✅[^1] |
| In-place op on a tensor with overlapping memory | Undefined write order, not caught | The flag does not detect it ✅[^9] |
| Same seed on CPU and on GPU | Results may differ | No guarantee across platforms or devices ✅[^1] |
| A pickled scikit-learn model loaded by a newer version | Unsupported; may give different results or crash | ✅[^5]; retrain from the saved recipe and data snapshot ✅[^5] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Integer `random_state` everywhere | Identical results on every call ✅[^2] | Constant estimator randomness across CV folds; less robust CV estimates ✅[^3] |
| One `rng` instance passed down | Reproducible script, varied randomness per fold ✅[^3] | Each call consumes the shared generator, so results depend on the order of calls ✅[^3] |
| `torch.use_deterministic_algorithms(True)` | Same output for the same input on the same software and hardware ✅[^9] | Slower operations ✅[^1]; some ops raise ✅[^9] |
| `cudnn.benchmark = True` | Possibly faster convolutions ✅[^1] | Algorithm choice can differ between runs ✅[^1] |
| Average several seeds | A difference you can trust ✅[^4] | Several times the training compute |

## Takeaways
- Seed every generator separately and pass one `rng` (or integer) to every scikit-learn object; never leave `random_state=None` in code whose results you report. [rule-candidate]
- Compare model variants over several seeds; a one-run difference smaller than the seed spread is noise. [rule-candidate]
- Turn on `torch.use_deterministic_algorithms(True)` and fix the thread count when you need bitwise-equal reruns on the same machine and versions for debugging or regression tests; check by running twice, since the flag alone is not always enough, and turn it off for speed once the test passes.
- Save the data snapshot reference, code version, library versions and validation score with every model; reproducibility across environments is never automatic. [rule-candidate]

## Verification status
- Verified: 57 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- [Reproducibility](https://docs.pytorch.org/docs/2.15/notes/randomness.html) — PyTorch Foundation, PyTorch 2.15 docs. Backs: no guarantee across releases, commits, platforms or CPU/GPU; `torch.manual_seed`; `svd_lowrank`; Python and NumPy seeding; `Generator` objects; cuDNN benchmarking and `cudnn.deterministic`; `fill_uninitialized_memory`; DataLoader `worker_init_fn`; deterministic ops are slower. [^1]
- [Glossary: random_state](https://scikit-learn.org/stable/glossary.html#term-random_state) — scikit-learn developers, scikit-learn 1.9.1. Backs: `None`, integer and `RandomState` instance behaviour; check stability across several seeds. [^2]
- [Common pitfalls and recommended practices: Controlling randomness](https://scikit-learn.org/stable/common_pitfalls.html) — scikit-learn developers, scikit-learn 1.9.1. Backs: remove `random_state=None` for reproducible executions; pass one `rng`; `np.random.seed` not recommended; shared instances and `clone`; integer vs instance in cross-validation. [^3]
- [Production ML systems: Deployment testing](https://developers.google.com/machine-learning/crash-course/production-ml-systems/deployment-testing?hl=en) — Google Machine Learning Crash Course, living. Backs: seed deterministically, fixed initialization order, average several runs, version control for early iterations; fair experiments. [^4]
- [Model persistence](https://scikit-learn.org/stable/model_persistence.html) — scikit-learn developers, scikit-learn 1.9.1. Backs: no supported loading across versions; metadata to save; `InconsistentVersionWarning`; pin dependencies; record the training recipe. [^5]
- `machine-learning/lab-setup.md` — the lab where the seed, summation-order, thread-count and deterministic-algorithms checks ran on 2026-11-24. [^6]
- [Production ML systems: Monitoring pipelines](https://developers.google.com/machine-learning/crash-course/production-ml-systems/monitoring?hl=en) — Google Machine Learning Crash Course, living. Backs: a fair experiment needs identical datasets except the change; invariant hash keys; track performance by code, model and data version. [^7]
- [numpy.sum](https://numpy.org/doc/stable/reference/generated/numpy.sum.html) — NumPy developers, NumPy 2.5 manual. Backs: partial pairwise summation, only along the fast axis, precision may vary. [^8]
- [torch.use_deterministic_algorithms](https://docs.pytorch.org/docs/2.15/generated/torch.use_deterministic_algorithms.html) — PyTorch Foundation, PyTorch 2.15 docs. Backs: deterministic algorithms or `RuntimeError`, `warn_only`, the CPU entries (`index_put`, `put_`), Inductor deterministic mode, not enough alone, memory-overlap caveat. [^9]

## Related
- `machine-learning/lab-setup.md` — the lab, its pinned versions and its seed checklist.
- `floating-point/rounding-and-error.md` — rounding, ulp and why summation order matters.
- `machine-learning/evaluation/cross-validation-and-hyperparameter-search.md` — splitters and their `random_state`.
- `machine-learning/ml-systems/hidden-technical-debt.md` — pipeline jungles, the opposite of a reproducible data pipeline.
- `machine-learning/ml-systems/data-drift-and-monitoring.md` — versioned data and models make a drift alert traceable.
