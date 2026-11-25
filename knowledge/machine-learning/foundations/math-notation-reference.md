---
schema: knowledge-doc/v1
type: reference
topic: machine-learning/foundations
status: verified
applies-to: ["any", "numpy 2.5.5", "scipy 1.18.1", "PyTorch 2.15.0"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [machine-learning, basics, notation, linear-algebra, calculus, probability, dot-product, norm, gradient, expectation, variance, sigmoid, softmax, log-sum-exp]
---

# Math notation for machine learning

## Summary
**TL;DR:** The symbols the `machine-learning/` docs use, each with its meaning in words, one worked number and the numpy, SciPy or PyTorch call that computes it: vectors and matrices, the dot product, norms, `Σ`, gradients `∇`, `argmin`, expectation `E[·]` and variance, `log` and `exp`, the sigmoid, softmax and log-sum-exp. Formulas are written as plain text (`ŷ = w·x + b`), not LaTeX, so they read the same raw and rendered.
**Use this when:** a formula in another doc uses a symbol you do not know, you need a numeric sanity check for a formula, or you translate a formula into numpy.
**Not this doc:** what the formulas are for → the doc that uses them (start with `machine-learning/foundations/what-is-machine-learning.md`); floating-point formats and rounding behind `inf` and `nan` → `floating-point/special-values-and-exceptions.md`.

## Scope
Notation for linear algebra, calculus, probability and the elementary functions used in basic and intermediate machine learning (ML), following the conventions of the two textbooks the docs cite most, Dive into Deep Learning and the Deep Learning book ✅[^1] ✅[^2]. Every Example value that carries the lab footnote was computed in the lab (`machine-learning/lab-setup.md`, numpy 2.5.5, SciPy 1.18.1, PyTorch 2.15.0, 2026-11-24); the others are one-line hand calculations. The script and its output are under Lookup notes ✅[^13]. Plain-text conventions used here: a vector is written like a scalar (`x`, `w`) and the text says which it is; a matrix is an uppercase letter (`X`, `A`); a subscript is written `xᵢ` or `x_i`.

## Catalog

### Numbers, vectors and matrices
| Symbol | Read as | Meaning | Example | numpy |
|---|---|---|---|---|
| `x` | x | A scalar (one number) ✅[^1]; the textbooks print a vector in bold ✅[^1], these docs write it plain | `x = [1, 2, 3]` | `np.array([1., 2., 3.])` |
| `xᵢ`, `x_i` | x sub i | The `i`-th element of vector `x` ✅[^1]; math indexing starts at 1 ✅[^2] | `x₂ = 2` | `x[1]` (numpy starts at 0) |
| `x⁽ⁱ⁾`, `y⁽ⁱ⁾` | x superscript i | The `i`-th **example** of a dataset and its label, not an element ✅[^14] | row `i` of `X` | `X[i]` |
| `X`, `A` | matrix X | A matrix; `Aᵢⱼ` is the element in row `i`, column `j` ✅[^1] | `A = [[1, 2, 3], [4, 5, 6]]` | `A[i, j]` |
| `ℝⁿ`, `ℝ^(m×n)` | R n | Vectors of `n` real numbers; matrices with `m` rows and `n` columns ✅[^1] | `A ∈ ℝ^(2×3)` | `A.shape == (2, 3)` |
| `Aᵀ` | A transpose | Rows become columns ✅[^3] | shape `(2, 3)` → `(3, 2)` ✅[^13] | `A.T` |
| `w·x`, `wᵀx`, `⟨w, x⟩` | w dot x | Dot product: `Σᵢ wᵢ xᵢ` ✅[^3] | `[0.5, −1, 2]·[1, 2, 3] = 0.5 − 2 + 6 = 4.5` ✅[^13] | `w @ x` |
| `w·x + b` | w dot x plus b | A linear model's score, `b` the bias | `4.5 + 0.5 = 5.0` ✅[^13] | `w @ x + b` |
| `Ax` | A times x | Matrix–vector product: element `i` is row `i` of `A` dotted with `x`; `ℝ^(m×n)` times `ℝⁿ` gives `ℝᵐ` ✅[^3] | `[[1,2,3],[4,5,6]]·[1,2,3] = [14, 32]` ✅[^13] | `A @ x` |
| `AB` | A times B | Matrix product: element `ij` is row `i` of `A` dotted with column `j` of `B` ✅[^3] | `(2×3)(3×2)` → `(2×2)` | `A @ B` |
| `⊙` | Hadamard product | Element-wise product of same-shape arrays, not the matrix product ✅[^1] ✅[^3] | `[0.5, −1, 2] ⊙ [1, 2, 3] = [0.5, −2, 6]` ✅[^13] | `w * x` |
| `I` | identity | Square matrix, 1 on the diagonal, 0 elsewhere ✅[^1] | `I₂ = [[1, 0], [0, 1]]` | `np.eye(2)` |
| `A⁻¹` | A inverse | The inverse of a square matrix `A` ✅[^1] | — | `np.linalg.inv(A)` |

### Norms (sizes of vectors and matrices)
| Symbol | Meaning | Example (`u = [3, −4]`) | numpy |
|---|---|---|---|
| `‖x‖₂`, `‖x‖` | Euclidean length, `√(Σ xᵢ²)` ✅[^3]; `‖·‖` without a subscript is `ℓ₂` ✅[^1] | `√(9 + 16) = 5` ✅[^13] | `np.linalg.norm(u)` |
| `‖x‖₂²` | Squared length, `Σ xᵢ²` (the L2 penalty) | `25` ✅[^13] | `u @ u` |
| `‖x‖₁` | Sum of absolute values, `Σ \|xᵢ\|`; less sensitive to outliers than `ℓ₂` ✅[^3] | `3 + 4 = 7` ✅[^13] | `np.linalg.norm(u, 1)` |
| `‖x‖_p` | `(Σ \|xᵢ\|^p)^(1/p)`; `p = 1, 2` are special cases ✅[^3] | — | `np.linalg.norm(u, p)` |
| `‖A‖_F` | Frobenius norm: `√` of the sum of squares of all entries ✅[^3] | `A = [[1,2,3],[4,5,6]]`: `√91 = 9.5394` ✅[^13] | `np.linalg.norm(A)` (default for a matrix) ✅[^10] |

### Sums, products, functions and optimization
| Symbol | Meaning | Example | numpy |
|---|---|---|---|
| `Σᵢ xᵢ`, `Σ_{i=1}^{n}` | Sum over the elements ✅[^1] | `Σ [1, 2, 3] = 6`; mean `6/3 = 2` ✅[^13] | `x.sum()`, `x.mean()` |
| `Πᵢ pᵢ` | Product over the elements ✅[^1] | `Π [0.5, 0.2] = 0.1` ✅[^13] | `np.prod(p)` |
| `f: ℝⁿ → ℝ` | A function from `n`-vectors to a number ✅[^2] | a loss maps parameters to one value | — |
| `f(x; θ)` | A function of `x` with parameters `θ` (theta) ✅[^2] | a model's prediction | — |
| `ŷ` | y-hat: the model's prediction of `y` ✅[^14] | `ŷ = w·x + b = 5.0` | `model.predict(X)` |
| `min_x f(x)` | The smallest value of `f` | `min (x − 1.2)² + 0.5 = 0.5` ✅[^13] | `g.min()` |
| `argmin_x f(x)` | The input `x` at which `f` is smallest; best parameters are written `w* = argmin L(w)` ✅[^14] | `1.2` for the same `f` ✅[^13] | `grid[np.argmin(g)]` |
| `≝`, `:=` | Equal by definition ✅[^1] | `b := \|B\|` | — |
| `\|S\|` | Number of elements of a set `S` ✅[^1] | a mini-batch of 32 has `\|B\| = 32` | `len(S)` |
| `1(·)` | Indicator: 1 if the condition is true, else 0 ✅[^1] ✅[^2] | `1(3 > 2) = 1` | `(a > b).astype(int)` |

### Calculus
| Symbol | Meaning | Example (`f(v) = v₁² + 3·v₁·v₂` at `v = (1, 2)`) | Code |
|---|---|---|---|
| `df/dx` | Derivative: rate of change of `f` as `x` changes ✅[^1] | `d(x²)/dx = 2x` | — |
| `∂f/∂xᵢ` | Partial derivative: change `xᵢ` only, hold the rest fixed ✅[^4] | `∂f/∂v₁ = 2v₁ + 3v₂ = 8`, `∂f/∂v₂ = 3v₁ = 3` | finite difference `(f(v + h·e) − f(v − h·e)) / 2h` |
| `∇f`, `∇ₓf` | Gradient: the vector of all partial derivatives ✅[^4] | `∇f(1, 2) = [8, 3]`; numerically `[8, 3]` ✅[^13] | `torch.autograd` |
| `∇ₓ ‖x‖²` | A rule worth memorizing: `= 2x` ✅[^4] | `∇‖[3, −4]‖² = [6, −8]` | — |
| `∇²f`, `H` | Hessian: the matrix of second derivatives ✅[^2] | `H = [[2, 3], [3, 0]]` for the `f` above | — |
| Chain rule | `y = f(g(x))` ⇒ `dy/dx = (dy/du)·(du/dx)` with `u = g(x)` ✅[^4] | `d(3x)²/dx = 2·(3x)·3 = 18x` | backpropagation |

### Probability and statistics
| Symbol | Meaning | Example (returns 0, 2, 10 with probability 0.5, 0.4, 0.1) | Code |
|---|---|---|---|
| `X ~ P` | Random variable `X` follows distribution `P` ✅[^1] | `ε ~ N(0, σ²)`: Gaussian noise | `rng.normal(0, s)` |
| `P(X = x)`, `p(x)` | Probability of a value; `p` a density ✅[^1] | `P(X = 10) = 0.1` | — |
| `P(y \| x)` | Conditional probability of `y` given `x` ✅[^1] | a classifier's `predict_proba` | — |
| `E[X]` | Expectation: `Σₓ x · P(X = x)` ✅[^5] | `0.5·0 + 0.4·2 + 0.1·10 = 1.8` ✅[^5] ✅[^13] | `np.sum(vals * probs)` |
| `Var[X]` | Variance: `E[(X − E[X])²] = E[X²] − (E[X])²` ✅[^5] | `8.36` ✅[^5] ✅[^13] | `np.sum(probs * (vals - E)**2)` |
| `σ`, `σ²` | Standard deviation (same units as `X`) and variance ✅[^5] | `√8.36 = 2.8914` ✅[^13] | `np.sqrt(Var)` |
| `μ` | Mean, by convention when parametrizing a Gaussian ✅[^5] | `N(μ, σ²)` | — |
| `N(μ, σ²)` | Gaussian (normal) distribution, density `exp(−(x − μ)² / (2σ²)) / √(2πσ²)` ✅[^14] | `N(0, 1)` at `x = 0`: `1/√(2π) = 0.3989` ✅[^13] | `scipy.stats.norm.pdf(0)` |
| IID | Independent and identically distributed: examples drawn independently from the same distribution ✅[^15] | train and test from the same source | — |
| `D_KL(P ‖ Q)` | Kullback–Leibler divergence (relative entropy) from `Q` to `P`, `Σ pᵢ · log(pᵢ / qᵢ)` ✅[^1] ✅[^16] | `D_KL(P ‖ P) = 0` ✅[^13] | `scipy.stats.entropy(p, q)` ✅[^16] |

### Elementary functions used in ML
| Symbol | Meaning | Example | Code |
|---|---|---|---|
| `exp(x)`, `eˣ` | Exponential ✅[^1] | `exp(1) = 2.7183` ✅[^13] | `np.exp` |
| `log(x)` | **Natural** logarithm (base `e`); `log₂` is written explicitly ✅[^1] ✅[^2] | `log(e) = 1`, `log(0.5) = −0.6931`, `log(0) = −inf` ✅[^13] | `np.log` |
| `σ(z)` | Logistic sigmoid, `1 / (1 + exp(−z))`, which maps any number into `(0, 1)` ✅[^2] ✅[^9] | `σ([−2, 0, 2]) = [0.1192, 0.5, 0.8808]` ✅[^13] | `scipy.special.expit` |
| `softmax(o)ⱼ` | `exp(oⱼ) / Σₖ exp(oₖ)`: a vector of scores → probabilities that sum to 1 ✅[^8] | `softmax([2, 1, 0.1]) = [0.659, 0.2424, 0.0986]`, sum 1 ✅[^13] | `scipy.special.softmax` |
| `logsumexp(x)` | `log Σᵢ exp(xᵢ)`, computed stably as `m + log Σᵢ exp(xᵢ − m)` with `m = max x` ✅[^6] ✅[^7] | `logsumexp([1000, 999, 998]) = 1000.4076` ✅[^13] | `scipy.special.logsumexp` |
| `ζ(x)` | Softplus, `log(1 + exp(x))` ✅[^2] | `ζ(0) = log 2 = 0.6931` ✅[^13] | `np.logaddexp(0, x)` |
| `x⁺` | Positive part, `max(0, x)` ✅[^2] | `(−3)⁺ = 0`, `2⁺ = 2` ✅[^13] | `np.maximum(0, x)` |

### Greek letters and their usual roles in these docs
| Letter | Usual role | Where it is defined |
|---|---|---|
| `θ` theta | All parameters of a model ✅[^2] | `machine-learning/foundations/loss-functions-and-maximum-likelihood.md` |
| `η` eta | Learning rate ✅[^14] | `machine-learning/foundations/gradient-descent.md` |
| `λ` lambda, `α` alpha | Regularization strength ✅[^17]; scikit-learn calls it `alpha` ✅[^18] | `machine-learning/foundations/regularization.md` |
| `σ` sigma | Standard deviation, or the sigmoid function (context decides) ✅[^1] ✅[^2] | this doc |
| `μ` mu | Mean ✅[^5] | this doc |
| `ε` epsilon | Noise term, `y = w·x + b + ε` ✅[^14] | `machine-learning/foundations/loss-functions-and-maximum-likelihood.md` |
| `Σ` capital sigma | A sum; in probability also a covariance matrix ✅[^1] ✅[^5] | this doc |

## Lookup notes
- **`xᵢ` vs `x⁽ⁱ⁾`:** a subscript picks an element of one vector; a superscript in parentheses picks an example from the dataset ✅[^1] ✅[^14].
- **`σ` is overloaded:** standard deviation in statistics, the sigmoid in model formulas ✅[^1] ✅[^2].
- **`np.linalg.norm(A, 2)` on a matrix is not the Frobenius norm:** `ord=2` gives the largest singular value (9.508 for the `A` above); the default `ord=None` gives Frobenius (9.5394) ✅[^10] ✅[^13].
- **Variance defaults differ by library:** `np.var` divides by `N` (`ddof=0`, the "population variance") ✅[^11], while `torch.var` defaults to `correction=1`, dividing by `N − 1` ✅[^12]. On `[2, 4, 4, 4, 5, 5, 7, 9]` they give 4.0 and 4.5714 ✅[^13].
- **Never compute softmax or log-sum-exp naively:** `exp(1000)` overflows to `inf`, so the naive log-sum-exp of `[1000, 999, 998]` is `inf` and the naive softmax is `[nan, nan, nan]` ✅[^13]. Subtracting the maximum first leaves the result unchanged and avoids overflow ✅[^6]; SciPy's `softmax` and `logsumexp` do this for you ✅[^8] ✅[^7]. Softmax is the gradient of log-sum-exp ✅[^8].
- **Softmax ignores a constant shift:** `softmax(o + 100) = softmax(o)` ✅[^6] ✅[^13].
- **Taking `log` of a computed softmax** can still give `−∞` when a probability underflows to 0; use a log-softmax function ✅[^6].
- **The variance squares the deviations from the mean** because their plain average is always zero, `E[X − E[X]] = 0` ✅[^5].
- **Reproducing the examples:** lab run (`machine-learning/lab-setup.md`), 2026-11-24, Python 3.13.7, numpy 2.5.5, SciPy 1.18.1, PyTorch 2.15.0 (on the CPU, the central processing unit), two runs identical ✅[^13]:

```text
dot w.x             4.5 = 4.5
w.x + b             5.0
A x                 [14. 32.]  shape (2, 3) x (3,) -> (2,)
A^T shape           (3, 2)
elementwise w*x     [ 0.5 -2.   6. ]
||u||_2, ||u||_1    5.0 7.0  u.u 25.0
||A||_F, ord=2      9.5394 9.508 (ord=2 on a matrix = largest singular value)
sum_i x_i, mean     6.0 2.0  prod [0.5, 0.2] 0.1
grad f at (1,2)    analytic [8.0, 3.0] numeric [8. 3.]
argmin vs min       1.2 0.5
E[X], Var[X], sd    1.8 8.36 2.8914
np.var ddof=0 vs 1  4.0 4.5714  torch.var default 4.5714
exp(1), log(e), log(0.5) 2.7183 1.0 -0.6931
log(0)              -inf
sigmoid             [0.1192 0.5    0.8808] scipy [0.1192 0.5    0.8808]
softmax             [0.659  0.2424 0.0986] sum 1.0 scipy [0.659  0.2424 0.0986]
softmax(o + 100)    [0.659  0.2424 0.0986] (shift-invariant)
naive log-sum-exp   inf  naive softmax [nan nan nan]
stable log-sum-exp  1000.4076 scipy 1000.4076
stable softmax      [0.6652 0.2447 0.09  ]
softplus(0), max(0, [-3, 2]) 0.6931 [0. 2.]
N(0,1) density at 0 0.3989  KL(P||P) 0.0
```

<details><summary>Full script (prints the output above)</summary>

```python
# One numeric example per notation entry, checked against numpy / scipy.
import numpy as np
import torch
from scipy.special import expit, logsumexp, softmax
from scipy.stats import entropy, norm

x = np.array([1.0, 2.0, 3.0]); w = np.array([0.5, -1.0, 2.0]); b = 0.5
A = np.array([[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]])
print("dot w.x            ", w @ x, "=", sum(wi * xi for wi, xi in zip(w, x)))
print("w.x + b            ", w @ x + b)
print("A x                ", A @ x, " shape", A.shape, "x", x.shape, "->", (A @ x).shape)
print("A^T shape          ", A.T.shape)
print("elementwise w*x    ", w * x)
u = np.array([3.0, -4.0])
print("||u||_2, ||u||_1   ", np.linalg.norm(u), np.linalg.norm(u, 1), " u.u", u @ u)
print("||A||_F, ord=2     ", round(np.linalg.norm(A), 4), round(np.linalg.norm(A, 2), 4), "(ord=2 on a matrix = largest singular value)")
print("sum_i x_i, mean    ", x.sum(), x.mean(), " prod [0.5, 0.2]", np.prod([0.5, 0.2]))

f = lambda v: v[0] ** 2 + 3 * v[0] * v[1]                     # f(v) = v1^2 + 3 v1 v2
v = np.array([1.0, 2.0]); h = 1e-6
num_grad = [(f(v + h * e) - f(v - h * e)) / (2 * h) for e in np.eye(2)]
print("grad f at (1,2)    analytic", [float(2 * v[0] + 3 * v[1]), float(3 * v[0])], "numeric", np.round(num_grad, 6))
grid = np.linspace(-3, 3, 601); g = (grid - 1.2) ** 2 + 0.5
print("argmin vs min      ", round(grid[np.argmin(g)], 2), round(g.min(), 2))

vals = np.array([0.0, 2.0, 10.0]); probs = np.array([0.5, 0.4, 0.1])   # investment returns
E = np.sum(vals * probs); Var = np.sum(probs * (vals - E) ** 2)
print("E[X], Var[X], sd   ", round(E, 4), round(Var, 4), round(np.sqrt(Var), 4))
data = np.array([2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0])
print("np.var ddof=0 vs 1 ", np.var(data), round(np.var(data, ddof=1), 4), " torch.var default", round(torch.var(torch.tensor(data)).item(), 4))

print("exp(1), log(e), log(0.5)", round(np.exp(1), 4), np.log(np.e), round(np.log(0.5), 4))
with np.errstate(divide="ignore"):
    print("log(0)             ", np.log(0.0))
z = np.array([-2.0, 0.0, 2.0])
print("sigmoid            ", np.round(1 / (1 + np.exp(-z)), 4), "scipy", np.round(expit(z), 4))
o = np.array([2.0, 1.0, 0.1])
sm = np.exp(o) / np.exp(o).sum()
print("softmax            ", np.round(sm, 4), "sum", sm.sum().round(6), "scipy", np.round(softmax(o), 4))
print("softmax(o + 100)   ", np.round(softmax(o + 100), 4), "(shift-invariant)")
big = np.array([1000.0, 999.0, 998.0])
with np.errstate(over="ignore", invalid="ignore"):
    print("naive log-sum-exp  ", np.log(np.sum(np.exp(big))), " naive softmax", np.exp(big) / np.exp(big).sum())
m = big.max()
print("stable log-sum-exp ", round(m + np.log(np.sum(np.exp(big - m))), 4), "scipy", round(logsumexp(big), 4))
print("stable softmax     ", np.round(np.exp(big - m) / np.exp(big - m).sum(), 4))
print("softplus(0), max(0, [-3, 2])", round(np.logaddexp(0, 0.0), 4), np.maximum(0, [-3.0, 2.0]))
print("N(0,1) density at 0", round(norm.pdf(0), 4), " KL(P||P)", entropy([0.5, 0.5], [0.5, 0.5]))
```

</details>

## Takeaways
- When a formula is unclear, compute it on three small numbers in numpy before trusting your reading of it.
- Use library `softmax`, `logsumexp` and log-softmax functions instead of writing `exp` and `log` by hand. [rule-candidate]
- State the `ddof` or `correction` whenever you compute a variance, because numpy and PyTorch default differently. [rule-candidate]

## Verification status
- Verified: 119 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- [Dive into Deep Learning: Notation](https://d2l.ai/chapter_notation/index.html) — Aston Zhang, Zachary C. Lipton, Mu Li, Alexander J. Smola, living. Backs: scalars, vectors, matrices, elements, `ℝⁿ`, identity, inverse, Hadamard product, `ℓ_p` norms, `Σ`, `Π`, `≝`, `|S|`, indicator, natural `log`, `exp`, derivatives, distributions, conditional probability, expectation, `σ` as standard deviation, KL divergence. [^1]
- [Deep Learning: Notation](https://www.deeplearningbook.org/contents/notation.html) — Ian Goodfellow, Yoshua Bengio, Aaron Courville, 2016. Backs: `f: A → B`, `f(x; θ)`, Hessian, `log` as natural log, sigmoid `σ(x)`, softplus `ζ(x)`, positive part `x⁺`, indicator. [^2]
- [Dive into Deep Learning, 2.3 Linear Algebra](https://d2l.ai/chapter_preliminaries/linear-algebra.html) — Aston Zhang et al., living. Backs: transpose, dot product, matrix–vector and matrix–matrix products, Hadamard vs matrix product, `ℓ₂`, `ℓ₁`, `ℓ_p` and Frobenius norms, `ℓ₁` less sensitive to outliers. [^3]
- [Dive into Deep Learning, 2.4 Calculus](https://d2l.ai/chapter_preliminaries/calculus.html) — Aston Zhang et al., living. Backs: partial derivatives, the gradient, `∇‖x‖² = 2x`, the chain rule. [^4]
- [Dive into Deep Learning, 2.6 Probability and Statistics](https://d2l.ai/chapter_preliminaries/probability.html) — Aston Zhang et al., living. Backs: expectation and variance formulas, the investment example (1.8 and 8.36), standard deviation units, `μ` and `σ²` convention, `E[X − E[X]] = 0`, covariance matrix `Σ`. [^5]
- [Deep Learning, chapter 4: Numerical Computation](https://www.deeplearningbook.org/contents/numerical.html) — Ian Goodfellow, Yoshua Bengio, Aaron Courville, 2016. Backs: softmax overflow and underflow, subtracting the maximum leaves softmax unchanged, log-softmax needs its own stable function. [^6]
- [scipy.special.logsumexp](https://docs.scipy.org/doc/scipy/reference/generated/scipy.special.logsumexp.html) — SciPy developers, living (1.18). Backs: `log(sum(exp(a)))` computed in a numerically more stable way. [^7]
- [scipy.special.softmax](https://docs.scipy.org/doc/scipy/reference/generated/scipy.special.softmax.html) — SciPy developers, living (1.18). Backs: softmax formula, sums to 1, gradient of logsumexp, shifting to avoid overflow. [^8]
- [scipy.special.expit](https://docs.scipy.org/doc/scipy/reference/generated/scipy.special.expit.html) — SciPy developers, living (1.18). Backs: logistic sigmoid `1/(1+exp(−x))`. [^9]
- [numpy.linalg.norm](https://numpy.org/doc/stable/reference/generated/numpy.linalg.norm.html) — NumPy developers, living (2.5). Backs: default matrix norm is Frobenius; `ord=2` on a matrix is the largest singular value. [^10]
- [numpy.var](https://numpy.org/doc/stable/reference/generated/numpy.var.html) — NumPy developers, living (2.5). Backs: divisor `N − ddof`, default `ddof=0` ("population variance"), `ddof=1` for the sample variance. [^11]
- [torch.var](https://docs.pytorch.org/docs/2.15/generated/torch.var.html) — PyTorch Foundation, 2026 (2.15). Backs: default `correction=1`. [^12]
- `machine-learning/lab-setup.md` — the lab where every example value, the norm and variance defaults, and the naive vs stable softmax and log-sum-exp were computed on 2026-11-24. [^13]
- [Dive into Deep Learning, 3.1 Linear Regression](https://d2l.ai/chapter_linear-regression/linear-regression.html) — Aston Zhang et al., living. Backs: `x⁽ⁱ⁾`, `y⁽ⁱ⁾` for examples, `ŷ` for predictions, `argmin` for the best parameters, `η` learning rate, `ε` noise, the Gaussian density. [^14]
- [Dive into Deep Learning, 3.6 Generalization](https://d2l.ai/chapter_linear-regression/generalization.html) — Aston Zhang et al., living. Backs: the IID assumption. [^15]
- [scipy.stats.entropy](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.entropy.html) — SciPy developers, living (1.18). Backs: with `qk` given it computes the relative entropy `sum(pk * log(pk / qk))`, the Kullback–Leibler divergence. [^16]
- [Dive into Deep Learning, 3.7 Weight Decay](https://d2l.ai/chapter_linear-regression/weight-decay.html) — Aston Zhang et al., living. Backs: `λ` as the regularization constant. [^17]
- [Linear Models (User Guide 1.1)](https://scikit-learn.org/stable/modules/linear_model.html) — scikit-learn developers, living (1.9.1). Backs: the penalty strength is the parameter `alpha`. [^18]

## Related
- `machine-learning/foundations/what-is-machine-learning.md` — where to start if the symbols are new.
- `machine-learning/foundations/loss-functions-and-maximum-likelihood.md` — `log`, softmax and expectations at work.
- `machine-learning/foundations/gradient-descent.md` — `∇` and the Hessian's condition number at work.
- `machine-learning/foundations/regularization.md` — `‖w‖₁` and `‖w‖₂²` as penalties.
- `machine-learning/deep-learning/neural-networks-and-backpropagation.md` — the chain rule as an algorithm.
- `floating-point/special-values-and-exceptions.md` — where `inf` and `nan` come from.
- `machine-learning/foundations/information-theory.md` — entropy, cross-entropy, KL divergence and mutual information in full.
