---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/privacy-preserving-ml
status: verified
applies-to: ["any"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, privacy, secure-computation, homomorphic-encryption, paillier, fhe, bfv, ckks, secure-multi-party-computation, secret-sharing, beaver-triples, garbled-circuits, trusted-execution-environments]
---

# Secure computation: homomorphic encryption and secret sharing for machine learning

## Summary
**TL;DR:** Secure computation evaluates a function on inputs that no computing party sees, and reveals only the agreed output. Additively homomorphic encryption such as Paillier lets a server add ciphertexts and multiply them by plaintext constants, enough to score a linear model on encrypted features; fully homomorphic schemes (lattice-based, for integers or for approximate reals) also multiply ciphertexts, at a large cost. Secure MPC (multi-party computation) with additive secret sharing splits each value into random-looking shares that add up to it: additions are local and free, multiplications use a Beaver triple and one round of communication. Garbled circuits suit comparisons such as ReLU (rectified linear unit); trusted execution environments trade cryptography for trust in hardware. All of these hide the inputs; none limits what the output itself reveals, which is the job of differential privacy.
**Use this when:** someone proposes "encrypted inference", "privacy-preserving joint training" or "computing on encrypted data", you must choose between homomorphic encryption, MPC, a secure enclave, federated learning and differential privacy, or estimate what such a system costs.
**Not this doc:** pairwise-mask secure aggregation inside federated learning → `machine-learning/privacy-preserving-ml/federated-learning.md`; bounding what an output reveals → `machine-learning/privacy-preserving-ml/differential-privacy.md`; attacks that read training data out of a released model → `machine-learning/privacy-preserving-ml/membership-inference-and-memorization.md`.

## Problem
Ordinary encryption protects stored and transmitted data, but computing on it normally means decrypting it first; homomorphic encryption is the exception that computes on the ciphertexts directly ✅[^10]. Two common machine-learning settings cannot accept that. A hospital wants to sell predictions from a model trained on patient data without giving the model away, and a user wants a prediction without revealing the input; the hospital may not even want to see the input ✅[^9]. Medical institutions want to train one diagnostic model without sharing patient data, or social scientists want gender wage-gap statistics without companies sharing salaries ✅[^5]. Differential privacy alone needs a curator that holds the combined data, which can be breached; local differential privacy avoids the curator but costs accuracy ✅[^3]. Federated learning keeps data on the clients but the server still sees each update (`machine-learning/privacy-preserving-ml/federated-learning.md`).

## Mental model
**Analogy:** two tools. Homomorphic encryption is a locked glovebox: the worker reaches in through the gloves and rearranges what is inside, but only the owner holds the key that opens the lid. Secret sharing is writing a number as three random-looking numbers that add up to it and giving one to each of three clerks: each slip alone is noise, the clerks can add slips without talking, and multiplying needs a little help from a dealer who handed out matched random slips beforehand.

**Artifact:** toy Paillier with a 256-bit modulus `n`, printed by the full script in the Worked example; lab run (`machine-learning/lab-setup.md`), 2026-11-25, Python 3.13.7 ✅[^14]:

```text
 Enc(42), first time : 200142324895... (510 bits)
 Enc(42), second time: 215415213346... (510 bits)  decrypt both: 42 42
 Dec(Enc(42) * Enc(58) mod n^2) = 100  (42 + 58; not 42 x 58 = 2436)
 Dec(Enc(42) ^ 3 mod n^2)       = 126
```

The same plaintext gives two different ciphertexts, multiplying ciphertexts adds the plaintexts, and raising a ciphertext to a power multiplies its plaintext by that constant.

## How it works
### What "secure" means: the trusted-third-party ideal
1. **Goal:** secure MPC lets several, often mutually distrustful, parties compute a property of their joint inputs as if a trusted third party had computed it: inputs are not shared and outputs are correct ✅[^1]. Each party may also get a private output ✅[^2].
2. **Threat models:** a semi-honest (honest-but-curious) adversary follows the protocol but tries to extract more information from the data it receives ✅[^12]; a malicious one may deviate from the protocol undetectably ✅[^3]. CrypTen, for example, is secure against semi-honest parties only, because that is more efficient than malicious security ✅[^5].
3. **What it does not cover:** these tools restrict disclosure to the specified output; how much that output reveals about one person is what differential privacy bounds, and the two compose ✅[^3]. For a function `f` of everyone's data, Kairouz et al. separate how `f` is computed (the flow of intermediate results, where secure computation and enclaves help) from how much the result of `f` itself reveals (where differential privacy helps) ✅[^4].

### Additively homomorphic encryption: Paillier
**Two actors:**
- **Client** — its job: own the key pair, encrypt its features and decrypt the result, via the private key `p, q`.
- **Server** — its job: compute on ciphertexts with its plaintext model, via modular arithmetic modulo `n²`.

```text
[Client]                                    [Server]
Enc(x_1) … Enc(x_k) ══ network ════════════▶ c = Enc(b) · Π Enc(x_i)^(w_i)  mod n²
         ◀════════════ network ═══ c ──────  (never sees x; holds only the public key n)
Dec(c) = b + Σ w_i x_i
```

1. **Key generation (client):** pick two random primes `p`, `q` of half the key size each; the public key is `n = p · q`, and python-paillier fixes `g = n + 1` ✅[^7]. The scheme is based on integer factorization: whoever factors `n` into `p` and `q` holds the private key; python-paillier's default of 3072 bits is chosen to give at least 128 bits of security ✅[^7].
2. **Encryption (client):** for an integer `0 ≤ m < n`, draw a random `r < n` and compute `c = (1 + n·m) · rⁿ mod n²`; this uses the identity `(n + 1)^m = n·m + 1 (mod n²)` ✅[^7]. python-paillier draws `r` with `random.SystemRandom`, documented as cryptographically random ✅[^7]; the random `r` is why encrypting 42 twice gave two different ciphertexts in the lab ✅[^14].
3. **Homomorphic operations (server):** `Dec(Enc(a) · Enc(b)) = a + b` and `Dec(Enc(a)^b) = a · b`: adding two ciphertexts or a ciphertext and a scalar, and multiplying by a scalar, are supported; multiplying two ciphertexts raises an error ✅[^6]. So an encrypted dot product with plaintext weights works ✅[^6]. Why addition works: `(1 + 42n)(1 + 58n) = 1 + 100n + 2436n² ≡ 1 + 100n (mod n²)`, and the two `rⁿ` factors multiply into a new `rⁿ`; the lab decrypted 100, not `42 × 58 = 2436` ✅[^14].
4. **Re-randomize before sending:** a result computed from a ciphertext should be multiplied by a fresh `rⁿ` before an untrusted party sees it, or an eavesdropper can deduce relationships, such as recovering a scalar multiplier by brute force ✅[^6].
5. **Decryption (client):** with `L(x, p) = (x − 1) / p`, python-paillier decrypts modulo `p` and modulo `q` separately and combines the two with the Chinese remainder theorem ✅[^7].
6. **Encoding:** Paillier is defined only for non-negative integers below `n` ✅[^6]. python-paillier represents signed integers up to `max_int ≈ n/3` and reserves the range between `max_int` and `n − max_int` to detect overflow; floats become fixed-precision integers whose exponent is not encrypted and leaks their magnitude unless fixed by the protocol ✅[^6]. The library itself states it has not been audited by a cryptography expert ✅[^6].

The lab's toy uses this exact scheme, but its keys are 256–3072 bits from a seeded, non-cryptographic random generator: insecure at every size, and every size below 3072 bits is also below python-paillier's default ✅[^7] ✅[^14].

### Partially, leveled and fully homomorphic encryption (outline)
- **Partially homomorphic** schemes support a subset of functions, for example only additions (Paillier, an additively homomorphic encryption scheme, AHE); **leveled** ones (LHE, leveled homomorphic encryption), which Gazelle also counts as partially homomorphic, support arithmetic circuits of bounded depth, like the BGV (Brakerski–Gentry–Vaikuntanathan) family, and their cost grows dramatically with the number of multiplication levels ✅[^9]. **Fully** homomorphic encryption (FHE) evaluates any function on encrypted data without the secret key ✅[^1].
- **Three FHE types:** exact operations over bits, exact operations over large integers, and approximate computations over floats ✅[^1]. BFV (Brakerski/Fan–Vercauteren) and BGV do modular arithmetic on encrypted integers; CKKS (Cheon–Kim–Kim–Song) adds and multiplies encrypted real or complex numbers approximately, which the SEAL authors call by far the best choice for evaluating machine-learning models on encrypted data ✅[^10]. OpenFHE implements all three, CKKS with approximate bootstrapping, plus the FHEW (Ducas–Micciancio) and TFHE (Chillotti–Gama–Georgieva–Izabachène) schemes for Boolean circuits and lookup tables ✅[^11].
- **Noise:** in the lattice schemes Gazelle uses, a fresh ciphertext carries a small random noise that grows with every homomorphic operation, and decryption is correct only while the noise stays below a bound set by the parameters, which caps how much can be computed ✅[^9]. CKKS treats the noise as part of the approximation error and uses a rescaling step that truncates the ciphertext to a smaller modulus to manage the plaintext's magnitude; the bit size of its ciphertext modulus grows linearly with the circuit depth, where earlier schemes needed an exponentially large modulus or expensive bootstrapping ✅[^15].
- **Packing:** lattice schemes pack many integers into one ciphertext and process them in SIMD (single instruction, multiple data) fashion, with per-slot scalar multiplication and slot permutations; the one attempt Gazelle knew to pack Paillier lacks both ✅[^9].
- **Limits:** comparison, sorting or regular expressions are in most cases not feasible, a program cannot branch on encrypted data, ciphertexts are many times larger than the data, and with one secret key held by the data owner homomorphic encryption is probably not a reasonable solution for several data owners computing together ✅[^10]. Most homomorphic schemes give weaker security guarantees than traditional encryption ✅[^10].

### The cost
- **Size:** a Paillier ciphertext lives modulo `n²`, so it has twice the bits of `n`: one 32-bit value becomes 768 bytes at 3072 bits, 192 times larger, in the lab ✅[^14].
- **Compute:** a homomorphic addition is a modular multiplication with a roughly 2048-bit modulus and a scalar multiplication a modular exponentiation; lattice-based AHE far outperforms Paillier in computation and communication ✅[^9]. The lab's pure-Python encryption at 3072 bits took 433 ms and 396 ms in two runs, a homomorphic addition about 114 µs ✅[^14].
- **Encrypted inference:** CryptoNets evaluated a network on encrypted MNIST (Modified National Institute of Standards and Technology handwritten-digit) images with 99 % accuracy and about 59,000 predictions per hour on a single PC (personal computer) ✅[^8], but it had to retrain with square activations instead of ReLU, and on that MNIST network its end-to-end latency was 297.5 s with 372 MB of traffic per inference, against 30 ms and 0.05 MB of online traffic for Gazelle ✅[^9].
- **Mixing tools:** Gazelle uses homomorphic encryption for convolutions and fully connected layers (linear, multiplicative depth 0, circuits quadratic in the input) and garbled circuits for ReLU and max-pooling (linear-size Boolean circuits) ✅[^9]. It reports 20× and 30× lower online runtime than the two-party systems MiniONN and Chameleon, and three orders of magnitude faster online runtime than the fully homomorphic CryptoNets ✅[^9].

### Secure MPC with additive secret sharing
**Actors:** input owners, three compute parties `P0`, `P1`, `P2`, and a dealer (trusted third party) that supplies random triples.

1. **Encode:** a real `x_R` becomes the integer `x = round(B · x_R)` with `B = 2^L`; CrypTen uses `L = 16` fractional bits and the ring of integers modulo `Q = 2⁶⁴` ✅[^5]. Example: `0.2968 → round(0.2968 · 65536) = 19451` ✅[^14].
2. **Share:** party `p` holds `[x]_p`, and the shares add up to `x` modulo `Q`; CrypTen creates them from random numbers that sum to 0, to which the owner adds `x` ✅[^5]. Lab: `1345776272678050140 + 11508630658958237257 + 5592337142073283670 ≡ 19451 (mod 2⁶⁴)` ✅[^14].
3. **Add:** each party adds its own shares, `[z]_p = [x]_p + [y]_p`, with no communication ✅[^5].
4. **Multiply with a Beaver triple:** the dealer shares random `a`, `b` and `c = a·b`; the parties compute and open `ε = x − a` and `δ = y − b`, which reveal nothing because `a` and `b` mask them, then compute `[x·y] = [c] + ε[b] + [a]δ + εδ` ✅[^5]. Example with small numbers: `x = 3`, `y = 4`, `a = 5`, `b = 6`, `c = 30` give `ε = δ = −2` and `30 − 12 − 10 + 4 = 12 = 3 · 4`.
5. **Linear algebra:** dot products, matrix products and convolutions are combinations of private additions and multiplications ✅[^5]; a product of two fixed-point values carries the scale `B²` and must be rescaled (the lab rescales after revealing) ✅[^14].
6. **Non-linear functions:** exponentials, logarithms and reciprocals are approximated with additions and multiplications only; comparisons, and therefore ReLU, need a conversion to binary secret shares and back ✅[^5].
7. **Reveal:** to open a value, the parties publish their shares, whose sum is the value ✅[^5]. CrypTen's protocol is secure against a passive adversary that corrupts up to all but one of the parties ✅[^5].

The dealer is a trust assumption: CrypTen uses one for efficiency and lists additively homomorphic encryption or oblivious transfer as ways to generate triples without it ✅[^5]. Secure aggregation in federated learning is a special-purpose MPC for sums ✅[^13].

### Garbled circuits (outline)
Yao's garbled circuits compute `f(a, b)` between two parties in a constant number of rounds, with `f` written as a Boolean circuit of two-input gates ✅[^12]. The garbler gives each wire two random labels, typically 128 bits, for 0 and 1, encrypts each gate's output labels under its input labels into a four-row garbled table, and sends the tables with the labels of its own input ✅[^12]. The evaluator gets the labels of its input through oblivious transfer, where a receiver picks one of two messages without the sender learning which and without learning the other ✅[^12], then decrypts gate by gate ✅[^12]. Cost and communication grow with the number of AND gates, while the GMW (Goldreich–Micali–Wigderson) protocol needs one round per layer of AND gates ✅[^12]. Garbled circuits use cheap symmetric-key primitives, and their bottleneck is communication ✅[^9].

### Trusted execution environments (outline)
A TEE (trusted execution environment, or secure enclave) runs code on a remote machine whose owner you do not trust by limiting what any party, the administrator included, can do: it offers confidentiality, integrity and attestation of which binary runs ✅[^4]. Current enclaves have limited memory, run on CPUs (central processing units) only, and cannot fully exclude side-channel attacks; code inside should be data-oblivious, and attestation proves only which binary runs, not that it is private ✅[^4].

## Worked example
One pure-Python script (scipy only for the uniformity tests): toy Paillier with `|n|` (the bit length of `n`) = 256, an encrypted linear score, sizes and timings for key sizes 256–3072 bits; then 3-party additive secret sharing of two 8-element vectors, a secure sum, Beaver-triple products and a secure dot product, its communication, and party 2's view over 20,000 sharings. The core of the Beaver multiplication:

```python
a, b = rng.randrange(Q), rng.randrange(Q)                 # dealer: random triple c = a * b
sa, sb, sc = share(a), share(b), share(a * b % Q)
eps = sum((xi - ai) % Q for xi, ai in zip(sx, sa)) % Q    # opened: x - a
dlt = sum((yi - bi) % Q for yi, bi in zip(sy, sb)) % Q    # opened: y - b
z = [(sc[i] + eps * sb[i] + dlt * sa[i] + (eps * dlt if i == 0 else 0)) % Q for i in range(3)]
```

Lab run (`machine-learning/lab-setup.md`), 2026-11-25, Python 3.13.7, scipy 1.18.1, Apple M2; two runs identical except the five timing rows of section 2 (the key-size, ciphertext-bytes and expansion columns repeat, the timings do not); lines 2–5 are the Mental model artifact ✅[^14]:

```text
== 1. toy Paillier, |n| = 256 bits ==
 Enc(42), first time : 200142324895... (510 bits)
 Enc(42), second time: 215415213346... (510 bits)  decrypt both: 42 42
 Dec(Enc(42) * Enc(58) mod n^2) = 100  (42 + 58; not 42 x 58 = 2436)
 Dec(Enc(42) ^ 3 mod n^2)       = 126
 Dec(Enc(42) * Enc(-50))        = -8
 encrypted linear score, decrypted by the client: 23  plaintext w.x + b: 23

== 2. cost per key size (one 32-bit value); timings: best of 5, they vary run to run ==
  |n| bits  ciphertext bytes  expansion  keygen s  encrypt ms  add (1 mult) us  decrypt ms
       256                64        16x      0.00        0.48              1.4        0.13
       512               128        32x      0.02        2.52              6.2        0.98
      1024               256        64x      0.14       17.67             14.1        5.04
      2048               512       128x      4.47      139.29             53.8       35.47
      3072               768       192x     18.90      432.62            114.6      115.30

== 3. additive secret sharing, 3 parties, ring Z/2^64, fixed point with 16 fractional bits ==
 x = [0.2968, 1.8356, 2.4961, -1.3776, 3.6132, -2.9767, -2.0234, -3.889]
 w = [0.4289, 2.9756, 2.8627, -3.7925, 0.4955, -0.6789, 2.9643, 3.7396]
 party 0 holds for x[0]: 1345776272678050140  party 1: 11508630658958237257  party 2: 5592337142073283670
 secure x + w (revealed): [0.7257, 4.8112, 5.3588, -5.1701] ...
 plain  x + w           : [0.7257, 4.8112, 5.3588, -5.1701] ...
 opened (epsilon, delta) for element 0: (17559588345637251534, 10654326061904344339)
 secure dot product (revealed, / 2^32): 1.229325
 plain dot product                    : 1.229396
 revealed integer == dot product of the encoded integers: True
 communication: 1 round, each party broadcasts 16 ring elements to 2 others = 768 bytes in total; the dealer sends each party 24 ring elements

== 4. party 2's view (the share computed from the secret): 20000 sharings of 2.0 and of -1000.0 ==
 secret      2.0: mean share / 2^64 = 0.4988   chi-square p (16 equal bins) = 0.150
 secret  -1000.0: mean share / 2^64 = 0.5002   chi-square p (16 equal bins) = 0.987
 two-sample Kolmogorov-Smirnov p (party 2's shares, secret 2.0 vs -1000.0) = 0.963
 opened epsilons / 2^64: [0.952, 0.719, 0.804, 0.283, 0.818, 0.657, 0.272, 0.105]
```

<details><summary>Full script (prints the output above)</summary>

```python
# Computing on data nobody sees, in pure Python: toy Paillier (additively homomorphic encryption, the scheme as
# python-paillier implements it: g = n + 1, CRT decryption) and 3-party additive secret sharing over Z/2^64 with
# Beaver triples for multiplication. INSECURE BY DESIGN: toy key sizes, a SEEDED random generator (so the output
# repeats; real code draws from secrets / random.SystemRandom), no constant-time arithmetic, no audit.
import math, random, time
from scipy import stats

rng = random.Random(0)

def probable_prime(n, rounds=40):                          # Miller-Rabin
    if n < 2 or any(n % p == 0 for p in (2, 3, 5, 7, 11, 13)):
        return n in (2, 3, 5, 7, 11, 13)
    d, s = n - 1, 0
    while d % 2 == 0:
        d, s = d // 2, s + 1
    for _ in range(rounds):
        x = pow(rng.randrange(2, n - 1), d, n)
        if x not in (1, n - 1) and all((x := x * x % n) != n - 1 for _ in range(s - 1)):
            return False
    return True

def random_prime(bits):
    while True:
        c = rng.getrandbits(bits) | 1 << (bits - 1) | 1        # top bit set, odd
        if probable_prime(c):
            return c

def keygen(bits):                                          # n = p q with |n| = bits; public g = n + 1
    while True:
        p, q = random_prime(bits // 2), random_prime(bits // 2)
        if p != q and (p * q).bit_length() == bits:
            break
    p, q = min(p, q), max(p, q)
    L = lambda x, m: (x - 1) // m
    hp = pow(L(pow(p * q + 1, p - 1, p * p), p), -1, p)   # h(p), h(q) for CRT decryption
    hq = pow(L(pow(p * q + 1, q - 1, q * q), q), -1, q)
    return p * q, (p, q, hp, hq)

def encrypt(n, m):                                         # c = (1 + n m) r^n mod n^2, r random, gcd(r, n) = 1
    r = rng.randrange(1, n)
    while math.gcd(r, n) != 1:
        r = rng.randrange(1, n)
    return (1 + n * (m % n)) * pow(r, n, n * n) % (n * n)

def decrypt(n, sk, c):                                     # CRT: m mod p and m mod q, then combine
    p, q, hp, hq = sk
    mp = (pow(c, p - 1, p * p) - 1) // p * hp % p
    mq = (pow(c, q - 1, q * q) - 1) // q * hq % q
    m = mp + (mq - mp) * pow(p, -1, q) % q * p
    max_int = n // 3 - 1                                    # [n - max_int, n) encodes negative numbers
    return m - n if m >= n - max_int else m

add = lambda n, c1, c2: c1 * c2 % (n * n)                  # Enc(a) * Enc(b) = Enc(a + b)
scale = lambda n, c, k: pow(c, k % n, n * n)               # Enc(a) ^ k = Enc(k a)
short = lambda c: f"{str(c)[:12]}... ({c.bit_length()} bits)"

print("== 1. toy Paillier, |n| = 256 bits ==")
n, sk = keygen(256)
c1, c1b, c2 = encrypt(n, 42), encrypt(n, 42), encrypt(n, 58)
print(" Enc(42), first time :", short(c1))
print(" Enc(42), second time:", short(c1b), " decrypt both:", decrypt(n, sk, c1), decrypt(n, sk, c1b))
print(" Dec(Enc(42) * Enc(58) mod n^2) =", decrypt(n, sk, add(n, c1, c2)), " (42 + 58; not 42 x 58 = 2436)")
print(" Dec(Enc(42) ^ 3 mod n^2)       =", decrypt(n, sk, scale(n, c1, 3)))
print(" Dec(Enc(42) * Enc(-50))        =", decrypt(n, sk, add(n, c1, encrypt(n, -50))))
x, w, bias = [3, -1, 4, 1, 5], [2, 7, -1, 8, 2], 10           # client's features, server's model
enc_x = [encrypt(n, v) for v in x]                            # client -> server: ciphertexts only
enc_score = encrypt(n, bias)
for c, wi in zip(enc_x, w):
    enc_score = add(n, enc_score, scale(n, c, wi))             # server: Enc(b + sum w_i x_i), never sees x
print(" encrypted linear score, decrypted by the client:", decrypt(n, sk, enc_score),
      " plaintext w.x + b:", sum(a * b for a, b in zip(w, x)) + bias)

print("\n== 2. cost per key size (one 32-bit value); timings: best of 5, they vary run to run ==")
print("  |n| bits  ciphertext bytes  expansion  keygen s  encrypt ms  add (1 mult) us  decrypt ms")
for bits in [256, 512, 1024, 2048, 3072]:
    t = time.perf_counter(); n, sk = keygen(bits); tk = time.perf_counter() - t
    def best(f, k=5):
        out = []
        for _ in range(k):
            t = time.perf_counter(); f(); out.append(time.perf_counter() - t)
        return min(out)
    c = encrypt(n, 123456)
    te, ta, td = best(lambda: encrypt(n, 123456)), best(lambda: add(n, c, c)), best(lambda: decrypt(n, sk, c))
    nbytes = (2 * bits + 7) // 8
    print(f"  {bits:8d}  {nbytes:16d}  {nbytes // 4:8d}x  {tk:8.2f}  {1e3 * te:10.2f}  {1e6 * ta:15.1f}  {1e3 * td:10.2f}")

print("\n== 3. additive secret sharing, 3 parties, ring Z/2^64, fixed point with 16 fractional bits ==")
Q, B = 2 ** 64, 2 ** 16
share = lambda v: (lambda s: s + [(v - sum(s)) % Q])([rng.randrange(Q) for _ in range(2)])
reveal = lambda sh: (lambda v: v - Q if v >= Q // 2 else v)(sum(sh) % Q)
enc = lambda f: round(f * B) % Q
xs = [round(rng.uniform(-4, 4), 4) for _ in range(8)]       # party A's private vector
ws = [round(rng.uniform(-4, 4), 4) for _ in range(8)]       # party B's private vector
X = [share(enc(v)) for v in xs]; Wsh = [share(enc(v)) for v in ws]
print(" x =", xs)
print(" w =", ws)
print(" party 0 holds for x[0]:", X[0][0], " party 1:", X[0][1], " party 2:", X[0][2])
summed = [[(a + b) % Q for a, b in zip(sx, sw)] for sx, sw in zip(X, Wsh)]     # local additions only
print(" secure x + w (revealed):", [round(reveal(s) / B, 4) for s in summed][:4], "...")
print(" plain  x + w           :", [round(a + b, 4) for a, b in zip(xs, ws)][:4], "...")

def beaver_mul(sx, sy, opened):                            # one multiplication with a dealer's triple c = a b
    a, b = rng.randrange(Q), rng.randrange(Q)
    sa, sb, sc = share(a), share(b), share(a * b % Q)
    eps = sum((xi - ai) % Q for xi, ai in zip(sx, sa)) % Q  # every party broadcasts x_i - a_i, y_i - b_i
    dlt = sum((yi - bi) % Q for yi, bi in zip(sy, sb)) % Q
    opened.append((eps, dlt))
    return [(sc[i] + eps * sb[i] + dlt * sa[i] + (eps * dlt if i == 0 else 0)) % Q for i in range(3)]

opened = []
prods = [beaver_mul(sx, sw, opened) for sx, sw in zip(X, Wsh)]
dot = [sum(p[i] for p in prods) % Q for i in range(3)]       # local sum of the shared products
print(" opened (epsilon, delta) for element 0:", opened[0])
print(f" secure dot product (revealed, / 2^32): {reveal(dot) / B ** 2:.6f}")
print(f" plain dot product                    : {sum(a * b for a, b in zip(xs, ws)):.6f}")
print(" revealed integer == dot product of the encoded integers:",
      reveal(dot) == sum(round(a * B) * round(b * B) for a, b in zip(xs, ws)))
k = len(xs)
print(f" communication: 1 round, each party broadcasts {2 * k} ring elements to 2 others "
      f"= {3 * 2 * 2 * k * 8} bytes in total; the dealer sends each party {3 * k} ring elements")

print("\n== 4. party 2's view (the share computed from the secret): 20000 sharings of 2.0 and of -1000.0 ==")
views = {s: [share(enc(s))[2] for _ in range(20000)] for s in (2.0, -1000.0)}
for s, v in views.items():
    counts = [0] * 16
    for u in v:
        counts[u >> 60] += 1                               # top 4 bits -> 16 bins
    print(f" secret {s:8.1f}: mean share / 2^64 = {sum(v) / len(v) / Q:.4f}   chi-square p (16 equal bins) = "
          f"{stats.chisquare(counts).pvalue:.3f}")
print(f" two-sample Kolmogorov-Smirnov p (party 2's shares, secret 2.0 vs -1000.0) = "
      f"{stats.ks_2samp(views[2.0], views[-1000.0]).pvalue:.3f}")
print(" opened epsilons / 2^64:", [round(e / Q, 3) for e, _ in opened])
```

</details>

Reading it:
- **Paillier (section 1):** the server computed `Enc(10 + 2·3 + 7·(−1) − 1·4 + 8·1 + 2·5)` from ciphertexts and its plaintext weights, and the client decrypted 23, the plaintext answer; the negative weight became the exponent `−1 mod n`.
- **Cost (section 2):** size doubles with each doubling of `|n|`, to 192× at 3072 bits. In pure Python one encryption grew from about 0.5 ms at 256 bits to 433 ms at 3072 (396 ms in the second run), and key generation to 18.9 s (20.1 s); timings vary from run to run.
- **Sum (section 3):** added share by share, no message exchanged, and it equals the plain sum.
- **Dot product:** the revealed integer equals the dot product of the encoded integers exactly (`True`); the remaining gap to the float answer, 1.229325 vs 1.229396, is fixed-point rounding at 16 fractional bits. It cost one round and 768 bytes for 8 products, plus 24 triple shares per party from the dealer.
- **Views (section 4):** the share computed from the secret, `x − s0 − s1`, looks uniform for both secrets (mean 0.4988 and 0.5002 of `2⁶⁴`, chi-square p 0.150 and 0.987) and the two distributions are indistinguishable (Kolmogorov–Smirnov p 0.963). The opened `ε` values are spread over the ring too.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Ciphertext sent on after a scalar multiplication without re-randomizing | The scalar can be recovered by brute force | python-paillier's own eavesdropper example ✅[^6] |
| Paillier floats with free exponents | The magnitude of the value leaks | The exponent is not encrypted ✅[^6] |
| Value beyond `max_int ≈ n/3` | Lands in the range reserved for detecting overflow | Signed encoding uses only `±max_int` ✅[^6] |
| Fixed-point product or sum too large for `Q = 2⁶⁴` | Wrap-around errors no single party can detect | Shares sum past the ring size ✅[^5] |
| Embedding lookup in MPC | Done as a full matrix product | A sparse lookup would reveal the input ✅[^5] |
| Softmax and attention in MPC | Particularly high communication per sample | CrypTen's vision transformer repeats the softmax in every attention layer ✅[^5] |
| A party deviates from the protocol | No guarantee from a semi-honest protocol | Malicious security needs extra machinery, for example message authentication codes ✅[^5] |
| Several data owners, one homomorphic-encryption key | Whoever holds the single secret key could decrypt every contribution | Homomorphic encryption is probably not a reasonable solution there ✅[^10]; threshold keys spread the secret key ✅[^4] |
| Branching on an encrypted value | Not possible | Control flow cannot depend on encrypted data ✅[^10] |
| Too many multiplications in a lattice scheme | Decryption becomes wrong | Noise exceeds the bound ✅[^9] |
| Secure output released as is | Can still reveal individuals | Cryptography stops at the output; add differential privacy ✅[^3] ✅[^5] |
| Toy keys or a seeded generator | Not secure: the lab's keys and random values are reproducible from the seed | python-paillier uses 3072-bit keys for at least 128-bit security and a cryptographic generator ✅[^7] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Additively homomorphic encryption (Paillier) | Linear functions on ciphertexts by a party without the key ✅[^6] | Large ciphertexts (192× in the lab ✅[^14]), slow modular exponentiation ✅[^9] |
| Lattice FHE (BFV, BGV, CKKS) | Additions and multiplications, packing ✅[^10] ✅[^9] | Noise budget, depth-dependent cost ✅[^9]; comparisons mostly infeasible, no branching ✅[^10] |
| Secret-sharing MPC | Cheap additions, PyTorch-like API (CrypTen) ✅[^5] | 2.5–3 orders of magnitude slower than PyTorch in CrypTen's text and speech benchmarks, communication rounds, a dealer or extra protocol ✅[^5] |
| Garbled circuits | Constant rounds, symmetric-key speed ✅[^12] ✅[^9] | Communication grows with AND gates ✅[^12] |
| Trusted execution environment | Runs code on a machine whose owner is not trusted ✅[^4] | Trust in hardware, side channels, CPU only ✅[^4] |
| Federated learning + secure aggregation | Server sees only the sum of updates (`machine-learning/privacy-preserving-ml/federated-learning.md`) | The sum still leaks; no formal guarantee without differential privacy (same doc) |
| Differential privacy | Bounds what the output reveals ✅[^3] | Needs a trusted curator or loses accuracy locally ✅[^3] |

## Takeaways
- Name the threat model first (semi-honest or malicious, who may collude, who holds the key) before comparing techniques. [rule-candidate]
- Combine: secure computation for the inputs, differential privacy for the output. [rule-candidate]
- Keep encrypted or secret-shared computation linear where possible; comparisons, softmax and deep multiplicative depth dominate the cost.
- Never ship toy parameters or a seeded random generator: use an audited library and its default key sizes.

## Verification status
- Verified: 96 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [Privacy-Enhancing Cryptography (PEC)](https://csrc.nist.gov/projects/pec) and [Fully-Homomorphic Encryption (FHE)](https://csrc.nist.gov/projects/pec/fhe) — NIST (National Institute of Standards and Technology), PEC project, living. Backs: MPC as emulating a trusted third party, FHE definition, the three FHE types. [^1]
- [Multi-Party Computation (MPC) and Threshold schemes](https://csrc.nist.gov/projects/pec/threshold) — NIST PEC project, living. Backs: MPC with private inputs and optional private outputs. [^2]
- [Privacy-Enhancing Cryptography to Complement Differential Privacy](https://www.nist.gov/blogs/cybersecurity-insights/privacy-enhancing-cryptography-complement-differential-privacy) — Brandão, Peralta, NIST, 2021. Backs: disclosure limited to the specified output, DP as the complement, central vs local DP trade-off, the malicious model. [^3]
- [Advances and Open Problems in Federated Learning](https://ar5iv.labs.arxiv.org/html/1912.04977) — Kairouz, McMahan et al., 2019 (ar5iv HTML of arXiv:1912.04977), §4.2.1. Backs: how `f` is computed vs what `f` reveals, TEE properties and limits, homomorphic-encryption key ownership and threshold keys. [^4]
- [CrypTen: Secure Multi-Party Computation Meets Machine Learning](https://arxiv.org/html/2109.00984) — Knott, Venkataraman, Hannun, Sengupta, Ibrahim, van der Maaten, 2021 (arXiv:2109.00984). Backs: use cases, semi-honest threat model, fixed-point encoding and ring, sharing, private addition, Beaver triples, linear and non-linear functions, comparisons, security lemma, dealer alternatives, benchmarks, wrap-around, sparse lookups, softmax cost, malicious extensions. [^5]
- [python-paillier API documentation](https://python-paillier.readthedocs.io/en/latest/phe.html), [Usage](https://python-paillier.readthedocs.io/en/latest/usage.html) and [Security Caveats](https://python-paillier.readthedocs.io/en/latest/caveats.html) — N1 Analytics developers (data61/python-paillier), version 1.4.1 docs, living (library not installed in the lab). Backs: homomorphic properties, supported and unsupported operations, encrypted dot product, obfuscation, encoding and `max_int`, exponent leakage, no audit. [^6]
- [python-paillier `phe/paillier.py`, tag 1.5.1](https://github.com/data61/python-paillier/blob/1.5.1/phe/paillier.py) — data61/python-paillier contributors, 2022. Backs: key generation, factorization basis, `g = n + 1`, the encryption formula and identity, `r` from the system generator, CRT decryption with `L`, the 3072-bit default and its rationale. [^7]
- [CryptoNets: Applying Neural Networks to Encrypted Data with High Throughput and Accuracy](https://proceedings.mlr.press/v48/gilad-bachrach16.html) — Gilad-Bachrach, Dowlin, Laine, Lauter, Naehrig, Wernsing, ICML 2016 (PMLR abstract page). Backs: 99 % accuracy and about 59,000 predictions per hour on MNIST. [^8]
- [Gazelle: A Low Latency Framework for Secure Neural Network Inference](https://ar5iv.labs.arxiv.org/html/1801.05507) — Juvekar, Vaikuntanathan, Chandrakasan, 2018 (ar5iv HTML of arXiv:1801.05507). Backs: the hospital scenario, PHE/LHE/FHE, LHE cost, CryptoNets' square activations and costs, garbled-circuit trade-offs, noise growth and its bound, packing, Paillier vs lattice AHE, Gazelle's results. [^9]
- [Microsoft SEAL README, v4.1.2](https://github.com/microsoft/SEAL/blob/v4.1.2/README.md) — Microsoft Research, 2024. Backs: BFV/BGV vs CKKS, what homomorphic encryption cannot do, ciphertext size, single-key limitation, weaker security guarantees. [^10]
- [OpenFHE documentation](https://openfhe-development.readthedocs.io/en/latest/) — OpenFHE project, version 1.6.1 docs, living. Backs: BFV, BGV, CKKS with bootstrapping, FHEW/TFHE. [^11]
- [Chameleon: A Hybrid Secure Computation Framework for Machine Learning Applications](https://ar5iv.labs.arxiv.org/html/1801.03239) — Riazi, Weinert, Tkachenko, Songhori, Schneider, Koushanfar, 2018 (ar5iv HTML of arXiv:1801.03239). Backs: honest-but-curious definition, oblivious transfer, the garbled-circuit protocol and its cost, GMW rounds. [^12]
- [Practical Secure Aggregation for Federated Learning on User-Held Data](https://ar5iv.labs.arxiv.org/html/1611.04482) — Bonawitz et al., 2016 (ar5iv HTML of arXiv:1611.04482). Backs: secure aggregation as a class of MPC. [^13]
- `machine-learning/lab-setup.md` — the lab where the toy Paillier, secret-sharing and Beaver-triple script ran on 2026-11-25. [^14]
- [Homomorphic Encryption for Arithmetic of Approximate Numbers](https://eprint.iacr.org/2016/421) — Cheon, Kim, Kim, Song, ASIACRYPT 2017 (IACR ePrint abstract page). Backs: CKKS rescaling, noise as approximation error, modulus linear in depth. [^15]

## Related
- `machine-learning/privacy-preserving-ml/federated-learning.md` — pairwise-mask secure aggregation, the MPC that federated learning uses for sums.
- `machine-learning/privacy-preserving-ml/differential-privacy.md` — the mechanisms that bound what a securely computed output reveals.
- `machine-learning/privacy-preserving-ml/membership-inference-and-memorization.md` — what a released model leaks even when training inputs were protected.
- `machine-learning/supervised-learning/linear-regression.md` — the linear scoring that additively homomorphic encryption can evaluate.
- `machine-learning/ml-systems/model-compression-and-quantization.md` — integer quantization, a cousin of the fixed-point encoding used here.
