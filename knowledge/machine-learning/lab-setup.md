---
schema: knowledge-doc/v1
type: how-to
topic: machine-learning
status: verified
applies-to: ["macOS or Linux with uv ≥ 0.12", "Python 3.13.7", "numpy 2.5.5, scipy 1.18.1, scikit-learn 1.9.1, PyTorch 2.15.0 (CPU), pandas 3.1.1"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [machine-learning, lab, python, uv, venv, scikit-learn, pytorch, numpy, reproducibility, practice]
---

# Build the machine-learning Python lab

## Summary
**TL;DR:** Create one Python virtual environment with `uv`, install pinned versions of numpy, scipy, scikit-learn, PyTorch (CPU-only, central processing unit) and pandas, and run every experiment script with that environment's interpreter. Scripts use only synthetic data or the small datasets bundled with scikit-learn, and fix every random seed, so the same script prints the same numbers on every run. Every "Lab run" output in the `machine-learning/` docs comes from this lab.
**Use this when:** you want to reproduce an experiment from a `machine-learning/` doc, try a variation of it, or check how a library version behaves.
**Not this doc:** what an experiment shows → the doc that quotes it; the reading order → `machine-learning/learning-path.md`; the Linux kernel lab → `linux/lab-setup.md`.

## Goal & prerequisites
**End state:** a folder `mllab/` with a virtual environment `mllab/.venv` whose interpreter imports the five libraries at the pinned versions, and a check script that prints identical output on two runs.

**Needs:**
- `uv`, the Python package and environment manager (the reference run used uv 0.12.16 from Homebrew) ✅[^1].
- Network access once, to download the packages from PyPI (the Python Package Index, about 120–150 MB in total, most of it PyTorch).
- No GPU (graphics processing unit): every experiment runs on the CPU. PyTorch on macOS needs macOS 10.15 or later ✅[^2].

**Reference machine:** Apple M2 (8 cores, PyTorch used 4 intra-op threads by default), macOS 26.1, arm64, on 2026-11-24 ✅[^1].

## Steps
1. **Create the folder and a virtual environment** pinned to Python 3.13. `uv venv` creates the environment at `.venv`, and `--python` picks the interpreter version ✅[^3]:
   ```console
   $ mkdir mllab && cd mllab
   $ uv venv --python 3.13 .venv
   Creating virtual environment at: .venv
   ```
   Current PyTorch needs Python 3.11 or later, and its install page recommends 3.10–3.14 on macOS ✅[^2]; scikit-learn 1.7 and later need Python 3.10 or newer ✅[^4].
2. **Install the pinned libraries into that environment.** `uv pip install --python <path>` installs into the environment that interpreter belongs to, and `pkg==x.y.z` pins an exact version ✅[^3] ✅[^5]:
   ```console
   $ uv pip install --python .venv/bin/python \
       numpy==2.5.5 scipy==1.18.1 scikit-learn==1.9.1 torch==2.15.0 pandas==3.1.1
   ```
   In the reference run the PyPI wheel also reported the Apple GPU backend, MPS (Metal Performance Shaders), as available (`torch.backends.mps.is_available()` → `True`) ✅[^1]; no experiment uses it, so every number comes from the CPU.
3. **Save the check script** `mllab/check_lab.py`:
   ```python
   import platform, sys
   import numpy as np, scipy, sklearn, torch
   from sklearn.datasets import load_iris
   from sklearn.linear_model import LogisticRegression
   from sklearn.model_selection import cross_val_score

   print("python", sys.version.split()[0], platform.machine())
   print("numpy", np.__version__, "| scipy", scipy.__version__,
         "| scikit-learn", sklearn.__version__, "| torch", torch.__version__)
   X, y = load_iris(return_X_y=True)          # bundled: no download
   acc = cross_val_score(LogisticRegression(max_iter=1000), X, y, cv=5).mean()
   print("iris 5-fold accuracy", round(acc, 4))
   torch.manual_seed(0)
   w = torch.randn(3, requires_grad=True)
   loss = (w ** 2).sum(); loss.backward()
   print("autograd d(sum w^2)/dw == 2w:", torch.allclose(w.grad, 2 * w))
   print("first random draw", round(np.random.default_rng(0).normal(), 6), round(torch.randn(1).item(), 6))
   ```
4. **Run experiments with the environment's interpreter**, never the system `python3`:
   ```console
   $ .venv/bin/python check_lab.py
   ```
5. **Write each experiment so that it is reproducible:**
   - data comes from `numpy.random.default_rng(<seed>)`, `sklearn.datasets.make_*`, or the bundled toy datasets (`load_iris`, `load_digits`, `load_breast_cancer`, `load_diabetes`, `load_wine`), which need no download ✅[^6]. The `fetch_*` loaders download data, so the docs never use them;
   - every source of randomness is seeded: `torch.manual_seed(...)` seeds PyTorch's generator on all devices, and NumPy and Python's `random` need their own seeds ✅[^7]; scikit-learn estimators get `random_state=<int>`;
   - run the script twice and compare the outputs before quoting them.
6. **Quote results as observations.** PyTorch states that fully reproducible results are not guaranteed across releases, commits or platforms, even with identical seeds ✅[^7], so a doc says "in the lab run, PyTorch 2.15.0, …", never "always".

## Verify
Run the check twice and compare (reference run, 2026-11-24) ✅[^1]:
```console
$ .venv/bin/python check_lab.py > run1.txt; .venv/bin/python check_lab.py > run2.txt
$ cat run1.txt
python 3.13.7 arm64
numpy 2.5.5 | scipy 1.18.1 | scikit-learn 1.9.1 | torch 2.15.0
iris 5-fold accuracy 0.9733
autograd d(sum w^2)/dw == 2w: True
first random draw 0.12573 0.568431
$ diff run1.txt run2.txt && echo IDENTICAL
IDENTICAL
```
The second line must show the pinned versions; `IDENTICAL` shows the seeds work.

## Troubleshooting
| Symptom | Cause | Fix |
|---|---|---|
| `ModuleNotFoundError: No module named 'sklearn'` | The script ran with the system `python3`, not the environment's | Run `.venv/bin/python script.py` (or `source .venv/bin/activate` first) ✅[^3] |
| `uv venv` cannot find Python 3.13 | No such interpreter installed | uv can download a managed Python for the requested version ✅[^3] |
| Two runs print different numbers | An unseeded generator (NumPy global state, Python `random`, an estimator without `random_state`) | Seed each one ✅[^7] |
| Different last digits than a doc shows | Another library version, platform or thread count | Expected: compare versions first ✅[^7]; `torch.set_num_threads` sets the CPU intra-op thread count ✅[^8] |
| A script tries to download a dataset | A `fetch_*` loader | Use a bundled `load_*` set or `make_*` synthetic data ✅[^6] |

## Rollback
Delete the folder: `rm -rf mllab`. Nothing is installed outside it (uv's package cache stays in uv's cache directory; `uv cache clean` empties it).

## Takeaways
- Pin library versions and print them at the top of every experiment; a machine-learning result without versions cannot be compared. [rule-candidate]
- Seed every random generator separately (NumPy, Python, PyTorch, each estimator's `random_state`), then run twice before trusting a number. [rule-candidate]

## Verification status
- Verified: 19 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- Lab run on the reference machine, 2026-11-24: `uv --version`, `torch.get_num_threads()`, the check script output above. [^1]
- [Start Locally](https://pytorch.org/get-started/locally/) — PyTorch Foundation, living. Backs: macOS 10.15 or later, Python ≥ 3.11 for the latest stable release, 3.10–3.14 recommended. [^2]
- [Using environments](https://docs.astral.sh/uv/pip/environments/) — Astral (uv docs), living. Backs: `uv venv`, `--python` version request and install target, activation, managed Python downloads. [^3]
- [Installing the latest release](https://scikit-learn.org/stable/install.html) — scikit-learn developers, living. Backs: scikit-learn 1.7+ requires Python 3.10 or newer. [^4]
- [Managing packages](https://docs.astral.sh/uv/pip/packages/) — Astral (uv docs), living. Backs: `uv pip install 'pkg==x.y.z'` pins a version. [^5]
- [Toy datasets](https://scikit-learn.org/stable/datasets/toy_dataset.html) — scikit-learn developers, living. Backs: the bundled datasets need no download. [^6]
- [Reproducibility](https://docs.pytorch.org/docs/2.15/notes/randomness.html) — PyTorch Foundation, 2026. Backs: no guarantee across releases and platforms; `torch.manual_seed`; NumPy and Python need their own seeds. [^7]
- [torch.set_num_threads](https://docs.pytorch.org/docs/2.15/generated/torch.set_num_threads.html) — PyTorch Foundation, 2026. Backs: sets intra-op CPU threads. [^8]

## Related
- `machine-learning/learning-path.md` — the order to read the docs whose experiments run here.
- `machine-learning/ml-systems/reproducibility-and-determinism.md` — seeds and nondeterminism in depth.
- `linux/lab-setup.md` — the Linux kernel lab used by other topics.
