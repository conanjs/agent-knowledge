---
schema: knowledge-doc/v1
type: concept
topic: python/fundamentals
status: verified
applies-to: ["CPython 3.15", "Python language reference 3.15"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [python, functions, def, parameters, positional-only, keyword-only, args, kwargs, defaults, lambda, scope, legb, global, nonlocal, unboundlocalerror, closures, cells, late-binding]
ranked-sources: true
---

# Functions, scopes and closures

## Summary
**TL;DR:** `def` is a statement that runs: it builds a function object, evaluates the default values once, right then, and binds the name. A call fills the parameters by position, then by keyword, then from those stored defaults, so a mutable default is shared by every call. Inside a function, an assignment to a name anywhere in the body makes that name local for the whole body (hence `UnboundLocalError`); a read falls back through enclosing functions, then module globals, then builtins. A nested function reaches the variables of its enclosing function through cells and reads them when it runs, not when it was made, which is why callbacks created in a loop all see the last value.
**Use this when:** a default list keeps growing between calls, one added assignment broke a function with `UnboundLocalError`, callbacks made in a loop all return the same value, a signature needs `/`, `*`, `*args` or `**kwargs`, or a `TypeError` about arguments needs decoding.
**Not this doc:** decorators and `functools` → `python/iteration-and-functional/decorators-and-functools.md`; functions with `yield` → `python/iteration-and-functional/iterators-generators-and-itertools.md`; methods and `self` → `python/classes/classes-instances-and-inheritance.md`; type hints → `python/typing/type-hints-and-generics.md`; what to write in a docstring → `code-documentation/doc-comments.md`; how names bind to objects → `python/fundamentals/objects-names-and-types.md`.

## Problem
- `def append_to(item, bucket=[])` returns `[1]`, then `[1, 2]`: the "empty" default remembers earlier calls.
- A function that printed a global `counter` starts failing with `UnboundLocalError` as soon as `counter += 1` is added below the `print`.
- Five lambdas built in `for x in range(5)` all return `16`.
- `def foo(name, **kwds)` can never receive a keyword `name` inside `kwds`.
- Renaming a parameter breaks every caller that passed it by keyword.

## Mental model
**Analogy:** `def` prints a recipe card. Printing happens once, when the `def` line runs, and anything written on the card then, such as the default values, stays on that card for every cook who uses it. If a default is a bowl (a list), every cook puts ingredients into the same bowl. A recipe written inside another recipe (a nested function) does not copy the outer kitchen's ingredients: it gets a labelled shelf (a cell) and looks at the shelf each time it is cooked, so it sees whatever is on the shelf at that moment.

**Artifact** (measured in the lab ✅[^lab]):
```python
def append_to(item, bucket=[]):     # [] is built once, when def runs
    bucket.append(item)
    return bucket

append_to(1)                        # [1]
append_to(2)                        # [1, 2]    the same list as the first call
append_to.__defaults__              # ([1, 2],) the default lives on the function

def make_counter():
    count = 0
    def step():
        nonlocal count              # rebind the enclosing count
        count += 1
        return count
    return step

c = make_counter()
(c(), c(), c())                     # (1, 2, 3)
c.__code__.co_freevars              # ('count',)
c.__closure__[0].cell_contents      # 3   the shelf the closure reads
```

## How it works
### Defining and calling
1. **`def` is executable.** Running it binds the function name in the current local namespace to a function object, which wraps the compiled body and keeps a reference to the current global namespace; the body runs only when the function is called ✅[^compound]. A `def` inside an `if False:` block therefore never creates the function ✅[^lab]. Functions are first-class objects: other names can refer to the same function, and a `def` inside a function makes a local function that can be returned or passed around ✅[^compound]. Given `def fib(n): ...`, after `f = fib` the call `f(20)` runs `fib`, and `f.__name__` is still `'fib'` ✅[^lab].
2. **A call fills slots.** All argument expressions are evaluated before the call ✅[^expressions]. Positional arguments fill the first slots; each keyword argument fills the slot of the parameter with that name, and a slot filled twice raises `TypeError`; slots still empty take their default; an empty slot without a default raises `TypeError` ✅[^expressions]. Extra positional arguments go to a `*args` parameter and extra keyword arguments to a `**kwargs` parameter; without one, they raise `TypeError` ✅[^expressions].
3. **Return value.** `return` without an expression returns `None`, and so does falling off the end of the body ✅[^tut-controlflow]. A call always returns some value, possibly `None`, unless it raises an exception ✅[^expressions].
4. **Arguments are object references.** A parameter is bound to the object the caller passed, so if the callee mutates a passed list, the caller sees the change: the tutorial calls this "call by object reference" ✅[^tut-controlflow].

### Parameter kinds
5. **The layout** is `def f(pos1, pos2, /, pos_or_kwd, *, kwd1, kwd2):`, where `/` and `*` are optional ✅[^tut-controlflow]. The example signature below ran in the lab ✅[^lab].
   ```python
   def kinds(a, b=2, /, c=3, *args, d, e=5, **kwargs):
       return a, b, c, args, d, e, kwargs

   kinds(1, d=4)                          # (1, 2, 3, (), 4, 5, {})
   kinds(1, 20, 30, 40, 50, d=4, z=9)     # (1, 20, 30, (40, 50), 4, 5, {'z': 9})
   ```

   | Kind | Written | Passed | Lab message when misused |
   |---|---|---|---|
   | Positional-only | before `/` (added in 3.8 by PEP 570, a Python Enhancement Proposal) | by position only ✅[^compound] | `combined() got some positional-only arguments passed as keyword arguments: 'pos_only'` ✅[^lab] |
   | Positional-or-keyword | no marker | by position or keyword ✅[^tut-controlflow] | `function() got multiple values for argument 'a'` for `function(0, a=0)` ✅[^lab] |
   | Var-positional | `*args` | receives the excess positional arguments as a tuple, empty by default ✅[^compound] | — |
   | Keyword-only | after `*` or `*args` | by keyword only ✅[^compound] | `combined() takes 2 positional arguments but 3 were given` ✅[^lab] |
   | Var-keyword | `**kwargs` | receives the excess keyword arguments as a new ordered mapping, empty by default ✅[^compound] | `function() got an unexpected keyword argument 'b'` when it is absent ✅[^lab] |

   The `combined` used above is `def combined(pos_only, /, standard, *, kwd_only)` ✅[^tut-controlflow].
6. **Default ordering.** Once a parameter has a default, every following parameter up to the `*` needs one too, a rule the grammar does not express ✅[^compound]. Keyword-only parameters are exempt, so `def f(a=1, *, b):` compiles, while `def f(a=1, b):` fails with `SyntaxError: parameter without a default follows parameter with a default` ✅[^lab].
7. **Why positional-only.** It lets an author rename a parameter without breaking callers, fits parameters whose names mean nothing to callers, and frees the name for `**kwargs` ✅[^pep570]. With `def foo(name, **kwds)`, the call `foo(1, **{'name': 2})` raises `TypeError` because the keyword always binds to the first parameter; with `def foo(name, /, **kwds)`, the same call puts `'name'` into `kwds` ✅[^pep570]. Built-ins such as `divmod(x, y, /)` are positional-only ✅[^faq].

### Defaults are evaluated once
8. Default values are evaluated from left to right when the `def` runs, and the same object is used by every call that omits the argument ✅[^compound]. They live on the function: `__defaults__` is a tuple of the positional defaults (or `None`), `__kwdefaults__` a dictionary of keyword-only defaults ✅[^datamodel]. So a change one call makes to a mutable default is seen by later calls; the documented fix is a `None` default tested in the body ✅[^faq]. For the same reason, `i = 5`, `def f(arg=i)`, then `i = 6` still gives `f() == 5` ✅[^tut-controlflow]. The FAQ shows one deliberate use: a keyword-only `_cache={}` default as a memo of earlier results ✅[^faq].

### Unpacking arguments in a call
9. `f(*iterable)` spreads the items as extra positional arguments and `f(**mapping)` spreads the pairs as keyword arguments; since 3.5 (PEP 448) a call may hold any number of each ✅[^expressions]. Items from `*` are placed before any keyword argument, even one written earlier, so with `def f(a, b)`, `f(b=1, *(2,))` binds `a=2, b=1` ✅[^expressions]. The keys of a `**` mapping must be strings, but need not be valid identifiers ✅[^expressions]; `f(**{1: 2})` raises `TypeError: keywords must be strings` ✅[^lab].

### `lambda`, docstrings and annotations
10. `lambda params: expr` yields a function object that behaves like a `def` returning `expr`; it cannot contain statements or annotations ✅[^expressions]. Its `__name__` is `'<lambda>'` ✅[^lab]. Typical uses are returning a small function from a function and passing a `key=` function to `list.sort()` ✅[^tut-controlflow].
11. A string literal as the first statement of the body becomes the function's `__doc__`, its docstring ✅[^compound]; what to put in it is covered in `code-documentation/doc-comments.md`.
12. Annotations such as `def f(x: int) -> str:` do not change what the function does, unless some tool reads and acts on them ✅[^compound]. Since 3.14 they are evaluated lazily by default, only when something asks for them ✅[^compound]. A function annotated with an undefined name is created without error, and reading its `__annotations__` then raises `NameError` ✅[^lab]. What annotations mean to type checkers is in `python/typing/type-hints-and-generics.md`.

### Name resolution
13. **Blocks and local names.** A module, a function body and a class definition are blocks ✅[^execmodel]. A name bound anywhere in a block (assignment, `def`, a `for` target, `import`, a parameter, `:=`) is local to that block unless declared `global` or `nonlocal`; a name used in a block but not bound there is a free variable ✅[^execmodel]. The local names are found by scanning the whole block, so a binding also makes the uses before it local ✅[^execmodel].
14. **Lookup order.** A read looks in the local table, then in the tables of the enclosing functions, then in the module's global table, and finally in the built-in names ✅[^tut-controlflow]; this doc abbreviates that order as LEGB (local, enclosing, global, builtins). Free variables are looked up when the code runs, not when it is compiled: `i = 10`, `def f(): print(i)`, `i = 42`, `f()` prints `42` ✅[^execmodel].
15. **`UnboundLocalError`.** Reading a local variable before it is bound raises `UnboundLocalError`, a subclass of `NameError` ✅[^execmodel]. Adding `x += 1` below a `print(x)` makes `x` local to the whole function, so the `print` now fails ✅[^faq]. In the lab, even an assignment inside `if False:` has that effect ✅[^lab].
16. **`global` and `nonlocal`.** `global x` makes every use of `x` in the current scope refer to the module-level binding ✅[^simple]. `nonlocal x` makes it refer to the nearest enclosing function's binding, which must exist, or compilation raises `SyntaxError` ✅[^simple]. Both apply to the whole scope, and using the name before the declaration is a `SyntaxError` ✅[^simple]. A variable that a function only reads is implicitly global ✅[^faq]; calling a mutating method on it, such as `items.append(1)` on a module-level list, also needs no declaration ✅[^lab].
17. **Class bodies are not enclosing scopes.** A name defined in a class body is not visible from the class's methods, nor from comprehensions and generator expressions in that body ✅[^execmodel].

### Closures and cells
18. **Cells.** When a nested function reads a variable of its enclosing function, the enclosing function's code object lists that name in `co_cellvars` and the nested one lists it in `co_freevars` ✅[^datamodel]. The nested function's `__closure__` is a tuple of cells, one per name in `co_freevars`, or `None` when there are none ✅[^datamodel]. A cell's `cell_contents` attribute reads the current value and can also set it ✅[^datamodel]. Each call of the outer function makes new cells, so two counters from `make_counter()` count separately, while two functions created in the same call share one cell ✅[^lab].
19. **Late binding.** A closure reads the variable when it is called, not when it is defined: five lambdas made in `for x in range(5)` all return `16`, because `x` is `4` when they run ✅[^faq]. The fix is to copy the current value into a parameter default, `lambda n=x: n**2`, since defaults are evaluated at definition time; the same applies to `def` functions, not only lambdas ✅[^faq]. A factory function called once per value, `make_handler(k)`, also works, because each call makes a new cell ✅[^lab].

### Function attributes
20. The attributes below are the ones most useful when debugging. The values come from `inner2`, a function defined inside a function `outer2`, from a method `meth` of a class `K`, from `fib` and from `kinds` above, all measured in the lab ✅[^lab].

    | Attribute | Holds | Lab value |
    |---|---|---|
    | `__name__` | The function's name ✅[^datamodel] | `'inner2'` |
    | `__qualname__` | The qualified name ✅[^datamodel] | `'outer2.<locals>.inner2'`; a method gives `'K.meth'` |
    | `__defaults__` | Tuple of positional defaults, or `None` ✅[^datamodel] | `(2, 3)` |
    | `__kwdefaults__` | Dictionary of keyword-only defaults ✅[^datamodel] | `{'e': 5}` |
    | `__code__` | The code object of the compiled body ✅[^datamodel] | `co_argcount` 3, `co_posonlyargcount` 2, `co_kwonlyargcount` 2 |
    | `__closure__` | Tuple of cells, or `None` ✅[^datamodel] | `None` for a function with no free variables |
    | `__dict__` | Arbitrary attributes set with dot notation ✅[^datamodel] | `{'calls': 1}` after `fib.calls = 0; fib.calls += 1` |

    In CPython only user-defined functions accept arbitrary attributes, a CPython implementation detail ✅[^datamodel]. The code object's `co_varnames` lists the local names, parameters first ✅[^datamodel]. For `kinds` it is `('a', 'b', 'c', 'd', 'e', 'args', 'kwargs')` ✅[^lab].

## Worked example
A running average kept in a closure, with a keyword-only factory parameter and a positional-only call parameter. Every value below was measured in the lab ✅[^lab].

```python
def make_averager(*, start=()):
    total = sum(start)
    count = len(start)
    def averager(value, /):
        nonlocal total, count
        total += value
        count += 1
        return total / count
    return averager

avg = make_averager()
[avg(10), avg(20), avg(60)]                 # [10.0, 15.0, 30.0]
avg.__qualname__                            # 'make_averager.<locals>.averager'
avg.__code__.co_freevars                    # ('count', 'total')
[c.cell_contents for c in avg.__closure__]  # [3, 90]
make_averager.__kwdefaults__                # {'start': ()}
seeded = make_averager(start=(100, 200))
seeded(300), avg(10)                        # (200.0, 25.0)
avg(value=5)
# TypeError: make_averager.<locals>.averager() got some positional-only arguments
#            passed as keyword arguments: 'value'
```

| Step | What happens |
|---|---|
| `make_averager()` | `start` comes from `__kwdefaults__`; `total = 0`, `count = 0` are created as cells because `averager` uses them |
| `avg(10)`, `avg(20)`, `avg(60)` | `nonlocal` rebinds the cells: `total` 10, 30, 90 and `count` 1, 2, 3, so the averages are `10.0`, `15.0`, `30.0` |
| `avg.__closure__` | One cell per name in `co_freevars`, here in the order `count`, `total`: `[3, 90]` |
| `make_averager(start=(100, 200))` | A second call makes new cells: `seeded(300)` is `600 / 3 = 200.0`, and `avg` goes on from its own cells to `100 / 4 = 25.0` |
| `avg(value=5)` | `value` is positional-only; the 3.15.2 message names the function by its qualified name |
| Remove the `nonlocal` line | `total += value` makes `total` local to `averager`, and the first call raises `UnboundLocalError: cannot access local variable 'total' where it is not associated with a value`; `co_freevars` becomes `()`, `__closure__` `None`, and `co_varnames` `('value', 'total', 'count')` |

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `append_to(1)`, then `append_to(2)` with `bucket=[]` | `[1]`, then `[1, 2]` ✅[^lab] | The default is created once, when the function is defined ✅[^faq] |
| `print(counter)` then `counter += 1` in a function | `UnboundLocalError: cannot access local variable 'counter' where it is not associated with a value` ✅[^lab] | The assignment makes `counter` local for the whole body ✅[^faq] |
| `counter = 0` inside `if False:` before `return counter` | The same `UnboundLocalError` ✅[^lab] | Locals are found by scanning the block's text, not by running it ✅[^execmodel] |
| Lambdas built in `for x in range(5)` | All return `16`; after `x = 8`, `squares[2]()` returns `64` ✅[^lab] | `x` is read at call time ✅[^faq] |
| `def h(): return k` inside `for k in range(3)` in a function | `[2, 2, 2]`, and all three share one cell ✅[^lab] | Late binding applies to `def` too ✅[^faq] |
| `[lambda: k for k in range(3)]` | `[2, 2, 2]` ✅[^lab] | Same late binding: each lambda reads `k` when called ✅[^faq] |
| `squares[2](10)` after the `n=x` fix | `100` ✅[^lab] | The captured value is an ordinary parameter, so a caller can override it |
| `def foo(name, **kwds)`, call `foo(1, **{'name': 2})` | `TypeError: foo() got multiple values for argument 'name'` ✅[^lab] | The keyword always binds to the parameter ✅[^tut-controlflow]; add `/` |
| `def ab(a, b)`, call `ab(a=1, *(2,))` | `TypeError: ab() got multiple values for argument 'a'` ✅[^lab] | `*` items fill slots before keywords ✅[^expressions] |
| `nonlocal zz` with no enclosing `zz` | `SyntaxError: no binding for nonlocal 'zz' found` ✅[^lab] | `nonlocal` needs an existing enclosing binding ✅[^simple] |
| `print(gx)` then `global gx` | `SyntaxError: name 'gx' is used prior to global declaration` ✅[^lab] | The declaration must come first ✅[^simple] |
| `class A: a = 42; b = [a + i for i in range(3)]` | `NameError: name 'a' is not defined` ✅[^lab] | Class scope does not extend into comprehensions ✅[^execmodel] |
| A method reads a class attribute as a bare name | `NameError: name 'a' is not defined` ✅[^lab] | Class scope does not extend to methods; write `self.a` ✅[^execmodel] |
| `def f(a, *):` | `SyntaxError: named parameters must follow bare *` ✅[^lab] | A bare `*` must be followed by at least one parameter ✅[^compound] |
| `divmod(x=3, y=4)` | `TypeError: divmod() takes no keyword arguments` ✅[^lab] | Some C-implemented functions have unnamed parameters (CPython implementation detail) ✅[^expressions] |
| `len.x = 1` | `AttributeError: 'builtin_function_or_method' object has no attribute 'x' and no __dict__ for setting new attributes` ✅[^lab] | Only user-defined functions take attributes in CPython ✅[^datamodel] |
| `f.__defaults__ = [None]` | `TypeError: __defaults__ must be set to a tuple object` ✅[^lab] | Most writable function attributes check the type of the value ✅[^datamodel] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `None` default tested in the body | A fresh object on every call ✅[^faq] | Two extra lines; `None` can no longer mean something else |
| Mutable default as a memo (`_cache={}`) | A per-function cache in one line ✅[^faq] | Hidden shared state; a module-level dict does the same, a matter of taste ✅[^faq] |
| Positional-only `/` | Free to rename; the name stays usable in `**kwargs` ✅[^pep570] | Callers cannot name the argument for readability |
| Keyword-only `*` | Call sites state what each value means, and callers cannot rely on positions ✅[^tut-controlflow] | Longer calls |
| `global` / `nonlocal` | Rebinds outer state without passing it around | Requiring `global` for assignment exists as a guard against unintended side effects ✅[^faq]; every use widens who can change the value |
| Default-argument capture (`n=x`) | One-character fix for late binding ✅[^faq] | Adds a parameter a caller can override |
| Factory function per value | Clean signature; one cell per call | One more function |

## Takeaways
- Never use a mutable object as a default value; default to `None` and build the object in the body. [rule-candidate]
- To capture a loop value in a callback, bind it as a default (`lambda v=v: ...`) or create the callback in a factory function. [rule-candidate]
- An assignment anywhere in a function makes the name local everywhere in it; declare `nonlocal` or `global` only when the outer name must be rebound.
- Make parameters positional-only (`/`) when their names are not part of the API (application programming interface), keyword-only (`*`) when the names carry the meaning.
- Pass values in and return results instead of rebinding module globals from functions. [rule-candidate]
- When debugging, read a function's `__defaults__`, `__kwdefaults__`, `__closure__` and `__code__` to see the state it carries.

## Verification status
- Verified: 117 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `python/python-lab-setup.md` — the CPython 3.15.2 lab (macOS 26.1, arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- [8. Compound statements: Function definitions, Annotations](https://docs.python.org/3/reference/compound_stmts.html) — Python Software Foundation, living. Rank 1. Backs: `def` as an executable statement; first-class functions; parameter kinds and the default-ordering rule; defaults evaluated once; docstrings; lazy annotations. [^compound]
- [6. Expressions: Calls, Lambdas](https://docs.python.org/3/reference/expressions.html) — Python Software Foundation, living. Rank 1. Backs: the slot-filling algorithm; `*` and `**` in calls; return value of a call; unnamed parameters of C functions; `lambda`. [^expressions]
- [4. Execution model: Naming and binding](https://docs.python.org/3/reference/executionmodel.html) — Python Software Foundation, living. Rank 1. Backs: blocks, local and free variables, `UnboundLocalError`, run-time lookup of free variables, class scope. [^execmodel]
- [7. Simple statements: The global statement, The nonlocal statement](https://docs.python.org/3/reference/simple_stmts.html) — Python Software Foundation, living. Rank 1. Backs: `global` and `nonlocal` semantics and their `SyntaxError` cases. [^simple]
- [3. Data model: User-defined functions, Code objects](https://docs.python.org/3/reference/datamodel.html) — Python Software Foundation, living. Rank 1. Backs: function attributes, `__closure__` and `cell_contents`, `co_cellvars`, `co_freevars`, `co_varnames`. [^datamodel]
- [4. More Control Flow Tools: Defining Functions, More on Defining Functions](https://docs.python.org/3/tutorial/controlflow.html) — Python Software Foundation, living. Rank 1. Backs: implicit `return None`; call by object reference; the parameter layout and `combined`; default captured at definition; the LEGB lookup order; `lambda` uses. [^tut-controlflow]
- [Programming FAQ: Core language](https://docs.python.org/3/faq/programming.html) — Python Software Foundation, living. Rank 1. Backs: `UnboundLocalError`, local and global rules, lambdas in a loop, shared default values and memoizing, the `/` in `divmod`. [^faq]
- [PEP 570 – Python Positional-Only Parameters](https://peps.python.org/pep-0570/) — Larry Hastings, Pablo Galindo Salgado, Mario Corchero, Eric N. Vander Weele, 2018. Rank 1. Backs: why positional-only parameters exist; the `name`/`**kwds` corner case. [^pep570]

## Related
- `python/fundamentals/objects-names-and-types.md` — names, binding and mutability, which parameters and defaults rely on.
- `python/fundamentals/control-flow-and-pattern-matching.md` — the loops whose variables closures capture, and the scope of `:=`.
- `python/iteration-and-functional/decorators-and-functools.md` — functions that wrap functions, and `functools.partial`.
- `python/typing/type-hints-and-generics.md` — what annotations mean to type checkers.
- `code-documentation/doc-comments.md` — what to write in a docstring.
- `python/runtime/bytecode-and-the-interpreter.md` — code objects and bytecode in depth.
