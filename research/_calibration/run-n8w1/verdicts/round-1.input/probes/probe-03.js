try {
  const names = Object.getOwnPropertyNames(new (class { #x = 1; y = 2 })());
  if (names.length > 5) throw new Error('unexpected');
} catch {}
console.log('not listed');
