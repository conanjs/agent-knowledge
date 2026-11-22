#!/usr/bin/env node
// hol-sim.mjs: a toy model of receiver-side head-of-line (HOL) blocking.
//
// It is a MODEL, not a real TCP or QUIC stack. It isolates one thing: the delivery-order rule.
//   - "tcp"  receiver: one ordered byte stream for the whole connection (RFC 9293 §2.2).
//            A packet's data reaches the application only after every earlier packet's data.
//   - "quic" receiver: one ordered byte stream per stream (RFC 9000 §2.2, RFC 9002 §4.2).
//            A frame's data reaches the application only after earlier data of the SAME stream.
// Both receivers see the same packets, the same losses and the same retransmission times.
// Not modelled: congestion control (a loss shrinks the sending rate for every stream in both
// protocols), flow control, handshakes, ACK delay, TLS records, retransmissions being lost again.
//
// Timing model:
//   - The sender emits one packet every GAP ms; one-way delay ONE_WAY ms (RTT = 2 * ONE_WAY).
//   - Loss detection: packet threshold 3 (RFC 5681 §3.2 fast retransmit, RFC 9002 §6.1.1). The sender
//     learns of the loss when the ACK of the first packet sent at least 3 later, and not itself
//     lost, comes back: sent(j) + RTT. With no such packet (a tail loss) it uses a probe-timeout
//     stand-in: sent + 1.5 * RTT.
//   - The retransmission is sent at detection time and arrives ONE_WAY later (never lost again).
//
// Usage: node hol-sim.mjs            (prints every scenario; deterministic, seeded)

const ONE_WAY = 25; // ms
const RTT = 2 * ONE_WAY;
const GAP = 1; // ms between packet sends
const THRESH = 3;

// ---- core --------------------------------------------------------------------------------------
// packets: [{ frames: [{ stream, idx, dependsOn? }] }] in send order. dependsOn = [stream, idx] of a
// frame on another stream that must be delivered first (used for QPACK dynamic-table references).
function simulate(packets, lost, mode) {
  const n = packets.length;
  const sent = packets.map((_, i) => i * GAP);
  const arrive = packets.map((_, i) => {
    if (!lost.has(i)) return sent[i] + ONE_WAY;
    // the first packet at least THRESH later that was NOT lost: its ACK reveals the loss
    let j = i + THRESH; while (j < n && lost.has(j)) j++;
    const detect = j < n ? sent[j] + RTT : sent[i] + 1.5 * RTT;
    return detect + ONE_WAY;
  });
  const delivered = new Map(); // "stream:idx" -> time the application can read it
  const lastOfStream = new Map(); // stream -> delivery time of its latest frame so far (quic)
  let lastAll = 0; // tcp: delivery time of the previous packet
  let holWait = 0; let waitedFrames = 0; let frames = 0;
  // Delivery must be computed in sequence order (tcp) or per-stream offset order (quic); both are
  // satisfied by walking packets in send order, because each stream's frames are sent in order.
  // A dependency on another stream is resolved in a second pass, below.
  const pending = [];
  for (let i = 0; i < n; i++) {
    let t;
    if (mode === 'tcp') { t = Math.max(arrive[i], lastAll); lastAll = t; }
    for (const f of packets[i].frames) {
      frames++;
      let ft = mode === 'tcp' ? t : Math.max(arrive[i], lastOfStream.get(f.stream) ?? 0);
      if (f.dependsOn) pending.push({ f, i });
      delivered.set(`${f.stream}:${f.idx}`, ft);
      if (mode === 'quic') lastOfStream.set(f.stream, ft);
    }
  }
  // Resolve cross-stream dependencies (QPACK): a header block cannot be decoded before the encoder
  // instruction it references; later frames of the same stream wait behind it (in-stream order).
  for (const { f } of pending) {
    const need = delivered.get(`${f.dependsOn[0]}:${f.dependsOn[1]}`);
    const key = `${f.stream}:${f.idx}`;
    if (need > delivered.get(key)) {
      delivered.set(key, need);
      for (const [k, v] of delivered) {
        const [s, idx] = k.split(':');
        if (s === f.stream && Number(idx) > f.idx && v < need) delivered.set(k, need);
      }
    }
  }
  for (let i = 0; i < n; i++) for (const f of packets[i].frames) {
    const w = delivered.get(`${f.stream}:${f.idx}`) - arrive[i];
    if (w > 0) { holWait += w; waitedFrames++; }
  }
  const complete = {};
  for (const [k, v] of delivered) { const s = k.split(':')[0]; complete[s] = Math.max(complete[s] ?? 0, v); }
  return { complete, holWait, waitedFrames, frames, arrive };
}

function sched(kind, streams, per) {
  const out = [];
  if (kind === 'sequential') for (const s of streams) for (let i = 0; i < per; i++) out.push({ frames: [{ stream: s, idx: i }] });
  else for (let i = 0; i < per; i++) for (const s of streams) out.push({ frames: [{ stream: s, idx: i }] });
  return out;
}
const label = (p) => p.frames.map((f) => `${f.stream}${f.idx}`).join('+');
const fmt = (o) => Object.entries(o).map(([k, v]) => `${k}=${v}`).join(' ');

// ---- scenario 1: one loss, 3 responses x 4 packets ---------------------------------------------
console.log(`Model: GAP=${GAP} ms between sends, one-way delay ${ONE_WAY} ms (RTT ${RTT} ms), loss detected after ${THRESH} later packets are ACKed.`);
console.log('Times are ms after the first packet is sent; "complete" = the last byte of that response is readable by the application.\n');
for (const kind of ['round-robin', 'sequential']) {
  const pk = sched(kind, ['A', 'B', 'C'], 4);
  const lost = new Set([1]); // the 2nd packet sent
  console.log(`Scenario 1 (${kind}): send order ${pk.map(label).join(' ')}; packet #2 (${label(pk[1])}) lost`);
  for (const mode of ['tcp', 'quic']) {
    const r = simulate(pk, lost, mode);
    console.log(`  ${mode.padEnd(4)} complete: ${fmt(r.complete)} | frames that arrived but had to wait: ${r.waitedFrames}/${r.frames}, total wait ${r.holWait} frame-ms`);
  }
  const noloss = simulate(pk, new Set(), 'tcp');
  console.log(`  no loss    complete: ${fmt(noloss.complete)}\n`);
}

// ---- scenario 2: one QUIC packet carries frames of two streams --------------------------------
{
  const pk = [
    { frames: [{ stream: 'A', idx: 0 }] }, { frames: [{ stream: 'A', idx: 1 }] },
    { frames: [{ stream: 'A', idx: 2 }, { stream: 'B', idx: 0 }] }, // coalesced: A's tail + B's head
    { frames: [{ stream: 'B', idx: 1 }] }, { frames: [{ stream: 'C', idx: 0 }] }, { frames: [{ stream: 'C', idx: 1 }] },
    { frames: [{ stream: 'C', idx: 2 }] }, { frames: [{ stream: 'C', idx: 3 }] },
  ];
  console.log(`Scenario 2 (shared packet): send order ${pk.map(label).join(' ')}; packet #3 (${label(pk[2])}) lost`);
  for (const mode of ['tcp', 'quic']) {
    const r = simulate(pk, new Set([2]), mode);
    console.log(`  ${mode.padEnd(4)} complete: ${fmt(r.complete)} | waited ${r.waitedFrames}/${r.frames}, total wait ${r.holWait} frame-ms`);
  }
  console.log('');
}

// ---- scenario 3: QPACK, a lost encoder-stream packet -------------------------------------------
// Packet 0 is the QPACK encoder stream (E): it inserts an entry into the dynamic table. Then the
// HEADERS of A, B, C (idx 0) and their bodies (idx 1). The encoder stream packet is lost.
//   risky  : SETTINGS_QPACK_BLOCKED_STREAMS >= 3, every header block references the new entry.
//   limit1 : SETTINGS_QPACK_BLOCKED_STREAMS = 1, only A may reference it; B and C use literals.
//   safe   : SETTINGS_QPACK_BLOCKED_STREAMS = 0 (the default), all use literals (bigger, ignored here).
{
  const base = (refs) => [
    { frames: [{ stream: 'E', idx: 0 }] },
    ...['A', 'B', 'C'].map((s) => ({ frames: [{ stream: s, idx: 0, ...(refs.includes(s) ? { dependsOn: ['E', 0] } : {}) }] })),
    ...['A', 'B', 'C'].map((s) => ({ frames: [{ stream: s, idx: 1 }] })),
    { frames: [{ stream: 'D', idx: 0 }] }, { frames: [{ stream: 'D', idx: 1 }] }, { frames: [{ stream: 'D', idx: 2 }] },
  ];
  console.log('Scenario 3 (QPACK, HTTP/3 only): packet #1 = encoder stream insert, lost; A,B,C = HEADERS then body; D = filler');
  for (const [name, refs] of [['risky (blocked_streams>=3)', ['A', 'B', 'C']], ['limit1 (blocked_streams=1)', ['A']], ['safe (blocked_streams=0)', []]]) {
    const r = simulate(base(refs), new Set([0]), 'quic');
    const { E, D, ...rest } = r.complete;
    console.log(`  ${name.padEnd(27)} complete: ${fmt(rest)} | waited ${r.waitedFrames}/${r.frames}`);
  }
  console.log('');
}

// ---- scenario 4: Monte Carlo, random vs bursty loss, sequential vs round-robin -----------------
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function lossSet(n, rate, burst, rand) {
  const s = new Set(); let i = 0;
  while (i < n) { if (rand() < rate / burst) { for (let k = 0; k < burst && i + k < n; k++) s.add(i + k); i += burst; } else i++; }
  return s;
}
{
  const R = 10, P = 10, TRIALS = 5000, RATE = 0.02;
  const streams = Array.from({ length: R }, (_, i) => `R${i}`);
  console.log(`Scenario 4 (Monte Carlo): ${R} responses x ${P} packets, ${TRIALS} trials per row, average loss rate ${RATE * 100}% (bursty = runs of 5 consecutive packets, same average rate), seed 42`);
  console.log('  columns: mean completion of a response | mean completion of the last response | mean time a frame sat in the receive buffer after arriving, averaged over all 100 frames (ms) | trials with at least one loss | mean packets lost per trial');
  for (const burst of [1, 5]) for (const kind of ['sequential', 'round-robin']) {
    const pk = sched(kind, streams, P);
    for (const mode of ['tcp', 'quic']) {
      const rand = rng(42); let meanC = 0, lastC = 0, wait = 0, lossy = 0, lostPk = 0;
      for (let t = 0; t < TRIALS; t++) {
        const lost = lossSet(pk.length, RATE, burst, rand); if (lost.size) lossy++; lostPk += lost.size;
        const r = simulate(pk, lost, mode); const c = Object.values(r.complete);
        meanC += c.reduce((a, b) => a + b, 0) / c.length; lastC += Math.max(...c); wait += r.holWait / r.frames;
      }
      console.log(`  ${(burst === 1 ? 'random' : 'bursty').padEnd(6)} ${kind.padEnd(11)} ${mode.padEnd(4)}  ${(meanC / TRIALS).toFixed(1).padStart(6)} | ${(lastC / TRIALS).toFixed(1).padStart(6)} | ${(wait / TRIALS).toFixed(2).padStart(5)} | ${lossy} | ${(lostPk / TRIALS).toFixed(2)}`);
    }
  }
  const nl = (kind) => { const r = simulate(sched(kind, streams, P), new Set(), 'tcp'); const c = Object.values(r.complete); return `${(c.reduce((a, b) => a + b, 0) / c.length).toFixed(1)} | ${Math.max(...c).toFixed(1)}`; };
  console.log(`  no loss sequential: ${nl('sequential')} ; no loss round-robin: ${nl('round-robin')}`);
}
