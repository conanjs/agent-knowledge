---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/foundations
status: verified
applies-to: ["any", "scikit-learn 1.9.1"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [machine-learning, basics, supervised-learning, unsupervised-learning, self-supervised-learning, reinforcement-learning, parameters, hyperparameters, training, inference, workflow]
---

# What machine learning is: learning from data instead of writing rules

## Summary
**TL;DR:** Machine learning (ML) means writing a flexible program whose behaviour is set by numbers called **parameters**, and letting an algorithm choose those numbers from examples, instead of writing the rules by hand. Mitchell's definition: a program learns from experience E for tasks T and a performance measure P if its performance at T, measured by P, improves with E. The four kinds differ in what the data tells the learner: the right answer (supervised), nothing (unsupervised), an answer cut out of the data itself (self-supervised), or a reward after acting (reinforcement). **Training** fits the parameters; **hyperparameters** are the settings you choose before training; **inference** is using the trained model on new inputs.
**Use this when:** you are new to ML and need the vocabulary every other `machine-learning/` doc uses, you are deciding whether a problem needs ML at all, or you confuse parameters with hyperparameters.
**Not this doc:** why a model that fits its training data can still fail → `machine-learning/foundations/generalization-and-overfitting.md`; what "how wrong" means as a number → `machine-learning/foundations/loss-functions-and-maximum-likelihood.md`; how the parameters are actually adjusted → `machine-learning/foundations/gradient-descent.md`.

## Problem
Most programs are rules a developer wrote: "if the cart is empty, refuse the purchase". That works when someone can spell out every case ✅[^2]. It fails for tasks like "does this audio clip contain the wake word?" or "who is in this photo?": a microphone delivers about 44,000 samples per second and nobody knows a rule that maps them to yes or no, even though people do the task without effort ✅[^2]. Some targets also change over time, so no fixed rule stays right ✅[^2]. An engineer who meets ML without its vocabulary also trips on words that sound familiar: in scikit-learn, "parameters" means the constructor settings, which statisticians call hyperparameters, while the learned numbers are stored as attributes ending in `_` ✅[^6].

## Mental model
**Analogy:** a mixing desk with hundreds of knobs. A rule-based program is a recording you engineer by hand, knob by knob, from a written plan. ML is a desk whose knobs (the **parameters**) start in random positions; an assistant plays example recordings (the **training data**), reads a meter that says how far the output is from the target sound (the **loss**), and nudges every knob a little to lower the meter, over and over (**training**). How many knobs the desk has and how hard the assistant turns them are **hyperparameters**: you set them before the session. When the session ends, the knobs are taped down and the desk is used live on new songs (**inference**).

**Artifact:** the same learning program given more and more labelled examples (experience E) of handwritten digits (task T), scored by accuracy on 500 images it never saw (performance P), next to a hand-written rule; lab run (`machine-learning/lab-setup.md`), 2026-11-24, scikit-learn 1.9.1 ✅[^7]:

```text
rule 'always 3': test accuracy 0.102
E =   10 labeled images -> P = test accuracy 0.448
E =  100 labeled images -> P = test accuracy 0.896
E = 1297 labeled images -> P = test accuracy 0.968
```

## How it works

### The definition: task, experience, performance
Mitchell (1997), as quoted in the Deep Learning book: "A computer program is said to learn from experience E with respect to some class of tasks T and performance measure P, if its performance at tasks in T, as measured by P, improves with experience E." ✅[^1] In the artifact, T is "name the digit in an 8×8 image", P is accuracy on held-out images, and E is the number of labelled images seen; P rose from 0.448 to 0.968 as E grew from 10 to 1,297 ✅[^7].

### The four components of every ML system
Dive into Deep Learning names four parts that every ML problem has ✅[^2]:
1. **Data** to learn from: a collection of **examples**; in supervised learning each example has **features** (the inputs) and a **label** (the answer to predict) ✅[^2] ✅[^4]. One example is like one row of a spreadsheet ✅[^4]; stacking the examples as rows and the features as columns gives the **design matrix** ✅[^1].
2. **A model**: a program whose behaviour depends on parameters, "knobs that we can turn"; once the parameters are fixed, the program is called a model, and all programs reachable by turning the knobs form a **model family** ✅[^2].
3. **An objective function** that scores how well or badly the model does; by convention lower is better, so it is usually called a **loss function** ✅[^2]. Example: squared error `(ŷ − y)²`, the square of the difference between prediction and truth ✅[^2], where `ŷ` ("y-hat") is the prediction and `y` the true label; predicting 23.1 when the truth is 24 gives `(24 − 23.1)² = 0.81` ✅[^9].
4. **An optimization algorithm** that adjusts the parameters to lower the loss; the popular ones for deep learning are based on gradient descent ✅[^2].
The "meta-program" that uses the data to choose the parameters is the **learning algorithm** ✅[^2].

### The kinds of learning
| Kind | What the data gives the learner | Typical goal | Example |
|---|---|---|---|
| Supervised | Examples with the correct answer (label) ✅[^3] | Predict the label of new examples: a number (**regression**) or a category (**classification**) ✅[^3] | Rain amount in mm (regression); spam or not (classification) ✅[^3] |
| Unsupervised | Examples with no label ✅[^1] ✅[^3] | Find structure: clusters, a few summarizing directions, the data's probability distribution ✅[^1] ✅[^2] | Group weather records into clusters you then name yourself ✅[^3] |
| Self-supervised | Unlabelled data from which a label is cut out ✅[^2] | Learn representations, later fine-tuned for a downstream task ✅[^2] | Predict masked words from the words around them ✅[^2] |
| Reinforcement | Rewards or penalties after actions in an environment, with a feedback loop between actions and later inputs ✅[^1] ✅[^3] | A **policy**: a function from observations to actions that earns the most reward ✅[^2] ✅[^3] | A program learning to play Go ✅[^3] |

The supervised/unsupervised split is a rough guide, not a formal definition: the lines blur, and one kind of problem can be rewritten as the other ✅[^1].

### Parameters, hyperparameters, training and inference
- **Parameters** are the values the model computes during training, such as weights and bias ✅[^5]; in scikit-learn they appear after `fit` as attributes ending in `_` (`coef_`, `intercept_`) ✅[^6].
- **Hyperparameters** are the values you control, such as the learning rate, the batch size and the number of epochs ✅[^5]; the learning algorithm does not adapt them itself ✅[^1]. Settings that control model capacity (for example a polynomial's degree) must not be learned on the training set, which would always pick the most complex option ✅[^1].
- **Training** compares predictions with labels, measures the difference as the loss, and gradually updates the model ✅[^4]. A typical loop: start from random parameters, take some data, tweak the parameters to do better on it, repeat ✅[^2].
- **Inference** is using the trained model to predict labels for unlabelled examples ✅[^4].

### The end-to-end workflow
1. **Frame the problem:** fix the inputs and outputs and choose a model family ✅[^2].
2. **Collect data:** examples with features (and labels, for supervised learning). Size and diversity both matter: a hundred years of July weather still predicts January badly ✅[^4].
3. **Split the data** into a training set, a validation set and a test set ✅[^8] (how and why: `machine-learning/foundations/generalization-and-overfitting.md`).
4. **Train** on the training set by minimizing the loss ✅[^2] (`machine-learning/foundations/gradient-descent.md`).
5. **Evaluate** on the validation set, giving the model only the features and comparing its predictions with the true labels ✅[^4] ✅[^8].
6. **Tweak** hyperparameters, features or the model and repeat steps 4–5; use the test set only to double-check the final choice ✅[^8].
7. **Deploy for inference** on new data, applying the same feature transformations used in training ✅[^8].

## Worked example
Task: classify the 1,797 8×8 grayscale digit images bundled with scikit-learn (64 pixel features, values 0–16, scaled to 0–1). 500 images are held out as the test set; the model, logistic regression (`machine-learning/supervised-learning/logistic-regression.md`), is trained on the first `n` of the remaining 1,297. Core lines:

```python
for n in [10, 30, 100, 300, 1000, len(y_pool)]:
    model = LogisticRegression(max_iter=2000)      # C=1.0 by default: a hyperparameter
    model.fit(X_pool[:n], y_pool[:n])              # training: estimates the parameters
    acc = model.score(X_test, y_test)              # evaluation on unseen images
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-24, Python 3.13.7, numpy 2.5.5, scikit-learn 1.9.1, two runs identical ✅[^7]:

```text
dataset: 1797 examples x 64 features; test set: 500
test images per digit 0..9: [50 51 49 51 50 51 50 50 48 50]
rule 'always 3': test accuracy 0.102
E =   10 labeled images -> P = test accuracy 0.448
E =   30 labeled images -> P = test accuracy 0.656
E =  100 labeled images -> P = test accuracy 0.896
E =  300 labeled images -> P = test accuracy 0.946
E = 1000 labeled images -> P = test accuracy 0.962
E = 1297 labeled images -> P = test accuracy 0.968
hyperparameters: {'C': 1.0, 'max_iter': 2000, 'solver': 'lbfgs'}
parameters: coef_ (10, 64) + intercept_ (10,) = 650 numbers
inference on one unseen image: predicted 4 true 4
same answer by hand (argmax of w.x + b): 4
```

<details><summary>Full script (prints the output above)</summary>

```python
# Mitchell's definition made concrete: task T = classify 8x8 digit images,
# performance P = accuracy on held-out images, experience E = labeled examples seen.
import numpy as np
from sklearn.datasets import load_digits
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split

X, y = load_digits(return_X_y=True)          # 1797 images, 64 pixel features (0..16)
X = X / 16.0                                  # scale pixels to 0..1
X_pool, X_test, y_pool, y_test = train_test_split(
    X, y, test_size=500, random_state=0, stratify=y)
print(f"dataset: {X.shape[0]} examples x {X.shape[1]} features; test set: {len(y_test)}")
print("test images per digit 0..9:", np.bincount(y_test))

# A hand-written rule, no learning: "predict the most common digit".
rule = np.bincount(y_pool).argmax()
print(f"rule 'always {rule}': test accuracy {np.mean(y_test == rule):.3f}")

# Learning: the same program, more experience E -> better P.
for n in [10, 30, 100, 300, 1000, len(y_pool)]:
    model = LogisticRegression(max_iter=2000)      # C=1.0 by default: a hyperparameter
    model.fit(X_pool[:n], y_pool[:n])              # training: estimates the parameters
    acc = model.score(X_test, y_test)              # evaluation on unseen images
    print(f"E = {n:4d} labeled images -> P = test accuracy {acc:.3f}")

# Parameters (learned by fit) vs hyperparameters (chosen before fit).
print("hyperparameters:", {k: model.get_params()[k] for k in ["C", "max_iter", "solver"]})
print("parameters: coef_", model.coef_.shape, "+ intercept_", model.intercept_.shape,
      "=", model.coef_.size + model.intercept_.size, "numbers")
# Inference: apply the fixed parameters to a new input.
x_new = X_test[:1]
print("inference on one unseen image: predicted", model.predict(x_new)[0], "true", y_test[0])
scores = x_new @ model.coef_.T + model.intercept_    # what predict() computes inside
print("same answer by hand (argmax of w.x + b):", int(np.argmax(scores)))
```

</details>

Reading it:
- **The rule line** is a program a developer could write without data: always answer the most common digit. It scores 0.102, which is 51 correct out of 500, because each digit makes up about a tenth of the test set (48 to 51 images each) ✅[^7].
- **The six `E =` lines** are Mitchell's definition in numbers: the program and its hyperparameters never change, only the experience grows, and P climbs from 0.448 to 0.968 ✅[^7]. The gains shrink as E grows: +0.448 accuracy from 10 to 100 images, +0.072 from 100 to 1,297 ✅[^7].
- **`hyperparameters:`** are what `get_params()` returns: chosen before `fit`, untouched by it ✅[^6] ✅[^7].
- **`parameters:`** 10 classes × 64 pixel weights + 10 biases = 650 numbers, all set by `fit` ✅[^7].
- **The last two lines** are inference: one dot product per class, `w·x + b` (`w` the class's 64 weights, `x` the 64 pixels, `b` its bias), and the largest score wins. Computing it by hand gives the same digit as `predict` ✅[^7], because the softmax that turns scores into probabilities never changes which score is largest ✅[^10].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| The rules can be written and work every time | ML adds cost without benefit | When a solution works 100 % of the time, ML is not the concern ✅[^2] |
| Very few examples | A learned model can still be poor: 0.448 with 10 images in the lab | Experience E is what improves P ✅[^7] |
| Large but narrow dataset | Poor predictions outside the range covered (July-only weather, January forecast) | A large dataset does not guarantee diversity ✅[^4] |
| The target changes over time | Yesterday's model drifts out of date | Some tasks have no fixed right answer ✅[^2]; see `machine-learning/ml-systems/data-drift-and-monitoring.md` |
| "Parameter" in scikit-learn | Means a constructor setting such as `max_depth`, which statistics calls a hyperparameter | scikit-learn's own glossary ✅[^6] |
| Clustering mistaken for classification | Groups come out with no names; you must interpret them | In clustering the categories are not defined by you ✅[^3] |
| Reinforcement learning without per-step answers | The learner gets only a reward, sometimes only at the end (win or lose), and must work out which actions earned it | The credit-assignment problem ✅[^2] |
| Supervised vs unsupervised label is unclear | Both views can apply to one problem | The terms are not formally defined ✅[^1] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Hand-written rules | Same behaviour every time, until a developer changes the code ✅[^2] | Cannot capture tasks nobody can describe as rules ✅[^2]; 0.102 on the digits ✅[^7] |
| A learned model | Improves with experience ✅[^2]; 0.968 on the digits ✅[^7] | Needs data with enough size and diversity ✅[^4]; needs held-out data to check it ✅[^8] |

## Takeaways
- Before reaching for ML, ask whether a rule can be written; if it can and always works, write the rule. [rule-candidate]
- State T, E and P for every ML task: what is predicted, from which data, scored how, on which held-out examples.
- Keep three words apart: parameters (learned by `fit`), hyperparameters (chosen by you), inference (using the fixed model).
- In scikit-learn, read "parameters" as hyperparameters and look for learned values in `_`-suffixed attributes.

## Verification status
- Verified: 75 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- [Deep Learning, chapter 5: Machine Learning Basics](https://www.deeplearningbook.org/contents/ml.html) — Ian Goodfellow, Yoshua Bengio, Aaron Courville, 2016. Backs: Mitchell's definition (quoted), supervised and unsupervised learning, the blurred line between them, reinforcement learning's feedback loop, design matrix, hyperparameters not adapted by the algorithm and not learned on the training set. [^1]
- [Dive into Deep Learning, chapter 1: Introduction](https://d2l.ai/chapter_introduction/index.html) — Aston Zhang, Zachary C. Lipton, Mu Li, Alexander J. Smola, living. Backs: rule-based programs vs learning, the wake-word example, parameters as knobs, model and model family, learning algorithm, training loop, the four components, loss convention, self-supervised learning, policies and credit assignment. [^2]
- [What is Machine Learning? (Intro to ML)](https://developers.google.com/machine-learning/intro-to-ml/what-is-ml?hl=en) — Google for Developers, living. Backs: types of ML systems, regression vs classification, clustering vs classification, reinforcement learning with rewards and a policy. [^3]
- [Supervised Learning (Intro to ML)](https://developers.google.com/machine-learning/intro-to-ml/supervised?hl=en) — Google for Developers, 2025. Backs: examples, features and labels, dataset size and diversity, training by loss, evaluating, inference. [^4]
- [Linear regression: Hyperparameters (Machine Learning Crash Course)](https://developers.google.com/machine-learning/crash-course/linear-regression/hyperparameters?hl=en) — Google for Developers, living. Backs: hyperparameters (learning rate, batch size, epochs) vs parameters (weights and bias). [^5]
- [Glossary of Common Terms and API Elements](https://scikit-learn.org/stable/glossary.html) — scikit-learn developers, living (1.9.1). Backs: "parameters" are constructor settings, statisticians' hyperparameters; learned attributes end in `_`; what `fit` does. [^6]
- `machine-learning/lab-setup.md` — the lab where the digits experiment (rule baseline, accuracy vs number of training images, parameters vs hyperparameters, inference by hand) ran on 2026-11-24. [^7]
- [Datasets: Dividing the original dataset (Machine Learning Crash Course)](https://developers.google.com/machine-learning/crash-course/overfitting/dividing-datasets?hl=en) — Google for Developers, living. Backs: training, validation and test sets; tweak on validation, double-check on test; same transformations at prediction time. [^8]
- [Linear regression: Loss (Machine Learning Crash Course)](https://developers.google.com/machine-learning/crash-course/linear-regression/loss?hl=en) — Google for Developers, 2026. Backs: the squared-error example (24 vs 23.1 gives 0.81). [^9]
- [Dive into Deep Learning, 4.1 Softmax Regression](https://d2l.ai/chapter_linear-classification/softmax-regression.html) — Aston Zhang et al., living. Backs: softmax preserves the order of the scores, so the arg max of the scores is the predicted class. [^10]

## Related
- `machine-learning/foundations/generalization-and-overfitting.md` — why the test set must be held out, and what the gap between training and test scores means.
- `machine-learning/foundations/loss-functions-and-maximum-likelihood.md` — the objective function in detail.
- `machine-learning/foundations/gradient-descent.md` — the optimization algorithm that turns the knobs.
- `machine-learning/foundations/math-notation-reference.md` — the symbols (`w·x`, `Σ`, `argmax`) used across these docs.
- `machine-learning/supervised-learning/logistic-regression.md` — the model in the worked example.
- `machine-learning/unsupervised-learning/k-means-clustering.md` — a first unsupervised algorithm.
- `machine-learning/reinforcement-learning/markov-decision-processes.md` — the formal setting of reinforcement learning.
- `machine-learning/transformers/pretraining-and-scaling-laws.md` — self-supervised next-token and masked-word training at scale.
- `machine-learning/learning-path.md` — the reading order for the whole topic.
