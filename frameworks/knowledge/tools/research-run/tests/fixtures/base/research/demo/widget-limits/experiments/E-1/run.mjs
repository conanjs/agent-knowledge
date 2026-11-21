// A stand-in widget with the documented limit of 64 items; the 65th add must throw a RangeError.
const items = [];
const add = (x) => {
  if (items.length >= 64) throw new RangeError('widget full');
  items.push(x);
};
const start = Date.now();
for (let i = 0; i < 64; i++) add(i);
try {
  add(64);
  console.log('no error');
} catch (e) {
  console.log(`${e.name}: ${e.message} at ${new Date().toISOString()} after ${Date.now() - start}ms`);
}
