# Probe fixture

An illustration, not run:

```js
console.log('never run');
```

```js verify id=probe-01 runtime=node24 expect=stdout:{}
console.log(JSON.stringify(structuredClone(new (class { #x = 1 })())));
```

```js verify id=probe-02 runtime=node24 expect=throws:TypeError
structuredClone(new (class { #x = 1 })());
```

```js syntax-only id=probe-03 runtime=node24
export const f = (a) => a + 1;
```

```js lib id=greet runtime=node24
const greet = (n) => `hi ${n}`;
```

```js verify id=probe-04 runtime=node24 uses=greet expect="stdout:hi there"
console.log(greet('there'));
```

```c verify id=probe-05 runtime=c expect=exit:0
int main(void) { return 0; }
```
