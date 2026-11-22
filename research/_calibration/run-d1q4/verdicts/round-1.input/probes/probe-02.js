class A { #x = 1; static has(o) { return #x in o; } }
console.log(A.has(structuredClone(new A())));
