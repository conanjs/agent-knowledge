---
schema: knowledge-doc/v1
type: reference
topic: javascript/best-practices
status: verified
applies-to: ["React 19 (react.dev docs, living, read 2026-11-25 and 2026-11-26)", "React Redux 8.1 and later (Hooks docs, living)", "React Compiler as the living react.dev page describes it (no version named)", "no lab run"]
last-verified: 2026-11-28
last-updated: 2026-11-28
tags: [javascript, best-practices, browser, react, redux, memoization, server-components, code-splitting]
ranked-sources: true
---

# JavaScript best practices: component frameworks

## Summary
**TL;DR:** Nine practices for component code: list keys, store and context subscriptions, memoization, data fetching, code splitting and the server/client boundary. The rules name React and Redux because their docs are the sources: random keys make React recreate every component and its DOM each time ✅[^react-lists], and a `useSelector` that returns a new object re-renders its component after every dispatched action ✅[^redux-hooks]. None was measured in the knowledge base's lab; costs are counts from the code.
**Use this when:** you write or review React components that render lists, subscribe to a Redux store, an external store or a context, memoize values, fetch data in effects, import heavy components, or carry a `'use client'` line.
**Not this doc:** code splitting for any bundle (`import()`) → `JB-L6` in [browser-loading-and-delivery.md](browser-loading-and-delivery.md); long tasks and input handlers → [browser-rendering-and-interaction.md](browser-rendering-and-interaction.md); starting async calls together in plain JavaScript → `JL-A3` in [async-and-promises.md](async-and-promises.md).

## Scope
The catalog covers rules `JB-F1` to `JB-F9`. The sources are the React 19 docs (react.dev, living) and the React Redux docs (8.1 and later), read 2026-11-25 and 2026-11-26. None was measured in the knowledge base's own lab; each Evidence line says what the docs state, and counts such as "40 re-renders instead of 0" are arithmetic from the code shape. The rules hold for React as its docs describe it; other component frameworks were not checked.

**How the timings were taken:** no lab timing is behind this doc; its evidence comes from the React and React Redux documentation, and its costs are counts from the code shape.

How to read the "Applies" column: `always` means the better form is as clear as the other, so it is the default; `hot path` means it matters only in code that runs per request, per frame or per element of a large collection, or that a profile points at; `large data` means only above the size the row gives; `startup` means only when start time matters; `check build` means the answer depends on the engine version or build; `no gain` means no useful difference is expected (here: React Compiler already does it), so there is no reason to write code for it.

Terms used below:
- **Re-render**: React calling a component again to compute its output, like a cook remaking a dish to check whether it changed.
- **Key**: a stable identity for a list item, used to match old and new items, like a name tag instead of a seat number.
- **Selector**: a function that picks a slice of a store's state, for example `(s) => s.user.name`.
- **`Object.is`**: the identity comparison React uses; two objects are equal only if they are the same object, so `{}` and `{}` differ.
- **Memoization** (`useMemo`, `useCallback`, `memo`): keeping a computed value, function or rendered output until its inputs change, like keeping a receipt instead of adding up the bill again.
- **Client boundary**: the `'use client'` line from which modules are sent to and run in the browser. **RSC** = React Server Components, components that run only on the server.

## Catalog
| Id | Situation in the code | Practice | Applies | Evidence |
|---|---|---|---|---|
| `JB-F1` | React `key={index}` on a list that reorders, inserts or deletes; `key={Math.random()}`; or no key | Use a stable ID from the data: `key={item.id}` | always | With no key React uses the index; random keys cause all components and DOM to be recreated every time ✅[^react-lists] |
| `JB-F2` | `useSelector(s => s)` or a selector returning a new object or array (`({a, b})`, `.filter`, `.map`) | One `useSelector` per field, `shallowEqual`, or a memoized `createSelector` | always | The selector runs on every dispatched action and results are compared with `===` ✅[^redux-hooks]. Count: 40 rows → 40 re-renders per unrelated action instead of 0 |
| `JB-F3` | A `useSyncExternalStore` `getSnapshot` that builds an object or array on each call | Return a cached snapshot, replaced only when the store changes | always | A different value by `Object.is` causes a re-render, and a new object on every call loops ✅[^react-usese] |
| `JB-F4` | One context holding a fast-changing value (pointer, timer) with slow ones; `value={{…}}` built inline | Give fast values their own context; wrap the provider value in `useMemo` | hot path: fast-changing values or large trees | Every consumer re-renders when the provider's value changes, and `memo` does not prevent it ✅[^react-usecontext] |
| `JB-F5` | Filter or sort in a component body that re-renders often; new objects or callbacks passed to a `memo` child | `useMemo` the calculation if it takes about 1 ms or more; `useCallback` props of `memo` children | hot path | `memo` compares props with `Object.is` ✅[^react-memo]; memoizing may make sense when a calculation logs, say, 1 ms or more ✅[^react-usememo] |
| `JB-F6` | React Compiler enabled in the build, and new code adding `useMemo`/`useCallback`/`memo` for speed | No manual memoization in new code; existing memoization stays | no gain: with React Compiler on | Components and hooks are memoized automatically; react.dev advises relying on it for new code ✅[^react-compiler] |
| `JB-F7` | A child that fetches in `useEffect` only after its parent's `useEffect` fetch finished | Start independent requests together (`Promise.all`, a loader above both components) | always | Fetching directly in effects makes it easy to create network waterfalls ✅[^react-useeffect]. Count: k chained requests = k round trips → about 1 |
| `JB-F8` | A heavy component imported at top level but shown only in a dialog or one route; `lazy()` inside a component | `const X = lazy(() => import('./X.js'))` at module top level, rendered inside `<Suspense>` | startup | `lazy` defers loading a component's code until it first renders, and must be declared at module top level ✅[^react-lazy] |
| `JB-F9` | `'use client'` at the top of a layout, page or widely imported module; render-only libraries in client components | Move `'use client'` to interactive leaves; render static parts as Server Components; `<Suspense>` around slow data | always: React 19 Server Components apps | Only client modules are bundled and evaluated by the client ✅[^react-useclient]; libraries used only to render static content in a Server Component are not in the bundle ✅[^react-rsc] |

## Lookup notes
### `JB-F1` Key list items by a stable ID from the data
Applies to any list that can reorder, insert or delete: `key={index}` on such a list, `key={Math.random()}` or `key={crypto.randomUUID()}` computed in render, or no `key`.
**Prefer:**
```jsx
{messages.map((m) => <Message key={m.id} message={m} />)}
```
**Avoid:**
```jsx
{messages.map((m, i) => <Message key={i} message={m} />)}
{messages.map((m) => <Message key={Math.random()} message={m} />)}
```
**Why:** React matches old and new items by key. With no key React uses the index, and the order of items changes when one is inserted, deleted or moved, so index keys often lead to subtle bugs ✅[^react-lists]. A key that changes on every render makes React recreate every component and its DOM (Document Object Model) nodes each time ✅[^react-lists].
**Evidence:** stated by react.dev ("Rendering Lists", React 19 docs, living), not measured here: index keys often lead to subtle bugs when items are inserted, deleted or reordered, and random keys cause all components and DOM to be recreated every time; react.dev frames index keys mainly as a bug source and random keys as the performance cost ✅[^react-lists]. Count: one item moved in a list of n → about 1 item updated with stable keys.
**Exceptions:** a list that never reorders, inserts or deletes: react.dev accepts the index for poem lines that never reorder ✅[^react-lists].
**Check it:** React DevTools Profiler: move one item to the top and count the components that commit.

### `JB-F2` Make a Redux selector return a primitive or a stored reference
Applies to every `useSelector` call: `useSelector(state => state)`, or a selector that returns `{ a: state.a, b: state.b }` or uses `.filter` / `.map`.
**Prefer:**
```js
const a = useSelector((s) => s.a);
const b = useSelector((s) => s.b);
const visible = useSelector(selectVisibleTodos); // createSelector(...) memoized
const pair = useSelector((s) => ({ a: s.a, b: s.b }), shallowEqual);
```
**Avoid:**
```js
const { a, b } = useSelector((s) => ({ a: s.a, b: s.b })); // new object every action
const done = useSelector((s) => s.todos.filter((t) => t.done)); // new array every action
```
**Why:** `useSelector` runs its selector after every dispatched action and compares the result with `===` ✅[^redux-hooks]. A new object or array is never `===` to the last one, so the component re-renders after every action, related or not.
**Evidence:** stated by the React Redux docs (Hooks, 8.1 and later, living), not measured here: from React Redux 8.1 a development check warns when a selector returns a different result for the same input, and another when it returns the whole root state ✅[^redux-hooks]. Count: k = 40 rows with such a selector → one unrelated action causes 40 re-renders instead of 0.
**Exceptions:** a selector that returns a primitive or a reference already stored in the state.
**Check it:** React DevTools Profiler: commits of the component on an unrelated action fall to 0 ✅[^react-profiler]; the React Redux development warnings are silent.

### `JB-F3` Return a cached snapshot from `useSyncExternalStore`'s `getSnapshot`
Applies to every `getSnapshot` written for `useSyncExternalStore`, for example `useSyncExternalStore(subscribe, () => ({ ...store.state }))`.
**Prefer:**
```js
let snap = store.state;                       // replaced only when the store changes
const getSnapshot = () => snap;
store.onChange(() => { snap = store.state; });
const state = useSyncExternalStore(store.subscribe, getSnapshot);
```
**Avoid:**
```js
const state = useSyncExternalStore(store.subscribe, () => ({ ...store.state }));
```
**Why:** React re-renders when `getSnapshot` returns a different value by `Object.is`; a new object on every call is always different, so the component re-renders without end ✅[^react-usese].
**Evidence:** stated by react.dev (`useSyncExternalStore`, React 19 docs, living), not measured here ✅[^react-usese].
**Exceptions:** a snapshot that is a primitive (number, string, boolean).
**Check it:** React DevTools Profiler: repeated commits of the component while the store does not change.

### `JB-F4` Put fast-changing values in their own context, and memoize the provider value
Applies to a context value that changes per frame, per pointer move or per timer tick, or a provider high in a large tree: one provider whose value holds a pointer position or a timer next to slow values (user, theme), or `value={{ user, setUser }}` built inline in render.
**Prefer:**
```jsx
const session = useMemo(() => ({ user, setUser }), [user]);
<SessionContext.Provider value={session}>
  <PointerContext.Provider value={pointer}>{children}</PointerContext.Provider>
</SessionContext.Provider>
```
**Avoid:**
```jsx
<AppContext.Provider value={{ user, setUser, pointer, now }}>{children}</AppContext.Provider>
```
**Why:** every consumer of a context re-renders when the provider's value changes by `Object.is`, and `memo` does not prevent it ✅[^react-usecontext]. A value object built in render is new each time; a fast value mixed with slow ones re-renders every consumer of the slow ones too.
**Evidence:** stated by react.dev (`useContext`, React 19 docs, living), not measured here: the fix for a value created on every render is `useMemo` and `useCallback` ✅[^react-usecontext].
**Exceptions:** react.dev says that re-rendering consumers because a new value object is created on each render is not a problem in smaller apps ✅[^react-usecontext].
**Check it:** React DevTools Profiler, "Highlight updates": consumers of the slow context do not flash on pointer moves.

### `JB-F5` Memoize a calculation in render only when it takes about 1 ms or more
Applies to filter, sort or derive work in a component body that re-renders often, for example `items.filter(...).sort(...)` over a large array in a component that re-renders on typing or on store updates, or a new object or callback passed to a `memo` child.
**Prefer:**
```jsx
const visible = useMemo(() => items.filter(match).sort(byDate), [items, match]);
const onPick = useCallback((id) => select(id), [select]);
return <MemoList items={visible} onPick={onPick} />;
```
**Avoid:**
```jsx
const visible = items.filter(match).sort(byDate);            // every render
return <MemoList items={visible} onPick={(id) => select(id)} />; // memo defeated
```
**Why:** `memo` compares props with `Object.is`, so a new array or function each render makes it re-render anyway ✅[^react-memo]. `useMemo` keeps the result until its inputs change.
**Evidence:** stated by react.dev (`memo` and `useMemo`, React 19 docs, living), not measured here: memoizing may make sense when a calculation logs, say, 1 ms or more ✅[^react-usememo].
**Exceptions:** cheap calculations under about 1 ms; projects that use React Compiler (`JB-F6`).
**Check it:** `console.time('filter'); …; console.timeEnd('filter')` in the body on a realistic data size; React DevTools Profiler `actualDuration` per commit ✅[^react-profiler].

### `JB-F6` With React Compiler on, manual `useMemo` or `useCallback` in new code brings no gain
Applies to projects built with React Compiler, where new code wraps values in `useMemo` / `useCallback` / `memo` for speed.
**Keep writing:** plain values and inline functions in new components; existing manual memoization stays in place.
**Why:** React Compiler memoizes components and hooks automatically ✅[^react-compiler].
**Evidence:** stated by react.dev ("Introduction to React Compiler", living), recorded 2026-11-25, not measured here: react.dev advises relying on it for new code and keeping existing manual memoization ✅[^react-compiler]. The source catalog names no React Compiler version; the page is the living React docs.
**Exceptions:** projects without React Compiler: `JB-F5` applies.
**Check it:** the build config shows whether React Compiler is on; React DevTools Profiler shows whether a component still re-renders on unrelated updates.

### `JB-F7` Start independent fetches together, not one effect after another
Applies to data loading in components: a parent that fetches in `useEffect` and renders a child only after the data arrives, where the child fetches in its own `useEffect`.
**Prefer:**
```jsx
// start both at once, above the components that need them (router loader, framework data API, or here)
const [user, orders] = await Promise.all([getUser(id), getOrders(id)]);
```
**Avoid:**
```jsx
function Page() { const user = useFetch(`/api/user/${id}`); return user && <Orders userId={user.id} />; }
function Orders({ userId }) { const orders = useFetch(`/api/orders?u=${userId}`); /* starts only now */ }
```
**Why:** each request that starts only after the previous component rendered adds a full round trip in sequence (a waterfall); fetching directly in effects makes it easy to create network waterfalls ✅[^react-useeffect].
**Evidence:** stated by react.dev (`useEffect`, React 19 docs, living), not measured here ✅[^react-useeffect]. Count: k chained requests cost k round trips in sequence; started together, about 1.
**Exceptions:** a request that needs the previous one's result (the second truly depends on the first).
**Check it:** Chrome DevTools, Network panel waterfall: the requests start at the same time after the fix.
**Related, not the same rule:** starting independent async calls together in plain JavaScript, with a cap on how many run at once, is `JL-A3` in [async-and-promises.md](async-and-promises.md); capping long tasks on a Node.js worker pool is `JN-E1` in [nodejs-event-loop-and-threads.md](nodejs-event-loop-and-threads.md). This rule is about request waterfalls created by component effects.

### `JB-F8` Load a heavy component with `lazy`, declared at module top level
Applies to a component only one route or one interaction shows: a top-level `import Editor from './Editor'` used only in a dialog or one route, or `lazy(...)` called inside a component body.
**Prefer:**
```jsx
const Editor = lazy(() => import('./Editor.js')); // module top level
function Page() {
  return open && <Suspense fallback={<Spinner />}><Editor /></Suspense>;
}
```
**Avoid:**
```jsx
function Page() {
  const Editor = lazy(() => import('./Editor.js')); // new component each render: state resets
  return <Editor />;
}
```
**Why:** `lazy` defers loading the component's code until it first renders, so it leaves the first bundle ✅[^react-lazy]. Declared inside a component, it creates a new component type each render, and React throws its state away ✅[^react-lazy].
**Evidence:** stated by react.dev (`lazy`, React 19 docs, living), not measured here ✅[^react-lazy]. No byte or time figure is in the sources.
**Exceptions:** a component the first screen shows: lazy-loading it only adds a round trip.
**Check it:** a bundle analyzer: the component's modules move from the entry chunk to their own chunk; the Network panel shows that chunk fetched on first use.
**Related, not the same rule:** `JB-L6` in [browser-loading-and-delivery.md](browser-loading-and-delivery.md) is the same idea for any code (dynamic `import()`); `JN-U7` in [nodejs-startup.md](nodejs-startup.md) is the Node.js form.

### `JB-F9` Put `'use client'` on the interactive leaves, not on a layout or page
Applies to apps that use React Server Components (React 19): `'use client'` at the top of a root layout, a page or a widely imported module; a markdown or syntax-highlighting library imported into a client component; a page with no `<Suspense>` around slow data.
**Prefer:**
```jsx
// page.jsx (Server Component): renders markdown on the server, library not shipped
import { marked } from 'marked';
export default async function Page() {
  const post = await getPost();
  // post.body must be trusted or sanitized before it goes into dangerouslySetInnerHTML
  return <article><div dangerouslySetInnerHTML={{ __html: marked(post.body) }} /><LikeButton /></article>;
}
// LikeButton.jsx starts with 'use client'
```
**Avoid:**
```jsx
'use client'; // top of layout.jsx: every module below is bundled for the browser
```
**Why:** `'use client'` marks a module and its transitive dependencies as client code, and only client modules are bundled and evaluated by the client ✅[^react-useclient]. Libraries used only to render static content in a Server Component stay out of the bundle ✅[^react-rsc]. With `<Suspense>` around slow sections, only components outside every boundary must finish before streaming starts ✅[^react-pipeable].
**Evidence:** stated by react.dev (`'use client'`, Server Components, `renderToPipeableStream`, React 19 docs, living), not measured here: RSC are stable in React 19 for app code, while the low-level APIs a bundler or framework builds on do not follow semver ✅[^react-rsc]; data fetched in an Effect does not suspend ✅[^react-pipeable]. The root-layout shape (for example `layout.tsx` in Next.js) comes from framework practice; react.dev names no framework.
**Exceptions:** a route that is interactive throughout (an editor, a canvas); an app that does not use Server Components (then a large bundle is `JB-F8` or [browser-loading-and-delivery.md](browser-loading-and-delivery.md)). No react.dev page read backs the claim that React hydrates `<Suspense>` boundaries independently or hydrates the clicked part first: the React 18 release post lists selective hydration as a changelog line only ✅[^react18], and the `hydrateRoot` page does not mention it ✅[^react-hydrateroot]; so that claim is not a basis for a design here.
**Check it:** a bundle analyzer: modules in the route's client chunk before and after; time to first HTML bytes with one data source slowed.

## Takeaways
- List keys come from the data, never from the index of a changing list or a random value ✅[^react-lists]. [rule-candidate]
- A store selector returns a primitive or a stored reference; a new object or array re-renders on every action ✅[^redux-hooks].
- Fast-changing context values get their own provider, and provider values are memoized ✅[^react-usecontext].
- Manual memoization pays off from about 1 ms of work per render ✅[^react-usememo], and not at all in new code under React Compiler ✅[^react-compiler].
- Independent requests start together; effects that fetch in sequence build waterfalls ✅[^react-useeffect].
- `lazy` is declared at module top level ✅[^react-lazy], and `'use client'` sits on interactive leaves only ✅[^react-useclient].

## Verification status
- Verified: 50 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-28

## References
- [Rendering Lists](https://react.dev/learn/rendering-lists) — React team, React 19 docs, living. Rank 1. Backs: Summary; Catalog, JB-F1; Lookup notes; Takeaways. [^react-lists]
- [Hooks (useSelector)](https://redux.js.org/react-redux/api/hooks) — Redux maintainers, React Redux 8.1 and later, living. Rank 1. Backs: Summary; Catalog, JB-F2; Lookup notes; Takeaways. [^redux-hooks]
- [useSyncExternalStore](https://react.dev/reference/react/useSyncExternalStore) — React team, React 19 docs, living. Rank 1. Backs: Catalog, JB-F3; Lookup notes. [^react-usese]
- [useContext](https://react.dev/reference/react/useContext) — React team, React 19 docs, living. Rank 1. Backs: Catalog, JB-F4; Lookup notes; Takeaways. [^react-usecontext]
- [Profiler](https://react.dev/reference/react/Profiler) — React team, React 19 docs, living. Rank 1. Backs: Lookup notes, JB-F2 and JB-F5 checks. [^react-profiler]
- [memo](https://react.dev/reference/react/memo) — React team, React 19 docs, living. Rank 1. Backs: Catalog, JB-F5; Lookup notes. [^react-memo]
- [useMemo](https://react.dev/reference/react/useMemo) — React team, React 19 docs, living. Rank 1. Backs: Catalog, JB-F5; Lookup notes; Takeaways. [^react-usememo]
- [Introduction to React Compiler](https://react.dev/learn/react-compiler/introduction) — React team, living. Rank 1. Backs: Catalog, JB-F6; Lookup notes; Takeaways. [^react-compiler]
- [useEffect](https://react.dev/reference/react/useEffect) — React team, React 19 docs, living. Rank 1. Backs: Catalog, JB-F7; Lookup notes; Takeaways. [^react-useeffect]
- [lazy](https://react.dev/reference/react/lazy) — React team, React 19 docs, living. Rank 1. Backs: Catalog, JB-F8; Lookup notes; Takeaways. [^react-lazy]
- ['use client'](https://react.dev/reference/rsc/use-client) — React team, React 19 docs, living. Rank 1. Backs: Catalog, JB-F9; Lookup notes; Takeaways. [^react-useclient]
- [Server Components](https://react.dev/reference/rsc/server-components) — React team, React 19. Rank 1. Backs: Catalog, JB-F9; Lookup notes. [^react-rsc]
- [renderToPipeableStream](https://react.dev/reference/react-dom/server/renderToPipeableStream) — React team, React 19 docs, living. Rank 1. Backs: Lookup notes, JB-F9. [^react-pipeable]
- [hydrateRoot](https://react.dev/reference/react-dom/client/hydrateRoot) — React team, React 19 docs, living. Rank 1. Backs: Lookup notes, JB-F9 (what the sources do not say). [^react-hydrateroot]
- [React v18.0](https://react.dev/blog/2022/03/29/react-v18) — React team, 2022. Rank 1. Backs: Lookup notes, JB-F9 (what the sources do not say). [^react18]

## Related
- [browser-loading-and-delivery.md](browser-loading-and-delivery.md) — `JB-L6`, code splitting with `import()` for any bundle.
- [browser-rendering-and-interaction.md](browser-rendering-and-interaction.md) — long lists, input handlers and long tasks (`JB-R`).
- [browser-network-requests.md](browser-network-requests.md) — the requests behind the components: caching, pagination, polling (`JB-N`).
- [async-and-promises.md](async-and-promises.md) — `JL-A3`, starting independent async calls together with a cap.
- [nodejs-startup.md](nodejs-startup.md) — `JN-U7`, loading modules on demand in Node.js.
- [../../performance/code-review/problem-classes-web-and-mobile-clients.md](../../performance/code-review/problem-classes-web-and-mobile-clients.md) — the client catalog: `unstable-list-identity`, `broad-store-subscription`, `client-boundary-too-high`.
- [../../performance/code-review/problem-classes.md](../../performance/code-review/problem-classes.md) — the first catalog: `frontend-rendering` and `page-load-delivery`.
