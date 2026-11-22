#!/usr/bin/env python3
"""Deterministic model of head-of-line (HoL) blocking: HTTP/2 over TLS over TCP vs HTTP/3 over QUIC.

This is a model, not a network measurement. It isolates one thing: *when received data may be handed
to the application*, given the ordering rule of each stack. Loss recovery is identical for both
stacks, so any difference in the output comes from the ordering rule alone.

Assumptions (same for both stacks):
- The sender paces one packet per SLOT_MS; packet k is sent at k * SLOT_MS.
- One-way delay ONE_WAY_MS, so the round-trip time (RTT) is 2 * ONE_WAY_MS; ACKs are immediate.
- A lost packet is detected when the ACK for the 3rd packet sent after it reaches the sender
  (QUIC: kPacketThreshold = 3, RFC 9002 section 6.1.1; TCP: 3 duplicate ACKs, RFC 5681 section 3.2).
  The retransmission is sent at that moment and is never lost.
- No congestion-window reduction after the loss (both stacks would slow down equally).

Ordering rules:
- TCP: one byte stream. A packet's data reaches the application only after every earlier packet's
  data has arrived (RFC 9293 section 2.2: "reliable, in-order, byte-stream service").
- TLS over TCP: a record is decrypted only once all of it has arrived in order (RFC 8446 section 5.2),
  so data reaches HTTP/2 at the time the *last* packet of its record is delivered by TCP.
- QUIC: ordering only within each stream (RFC 9000 section 2.2); each packet is protected on its own
  (RFC 9001 section 5), so there is no record-level wait.

Run: python3 -I hol_model.py   (standard library only)
"""

import random

ONE_WAY_MS = 25
RTT_MS = 2 * ONE_WAY_MS
SLOT_MS = 1
PKT_THRESHOLD = 3


def arrival_times(n_slots, lost):
    """Arrival time at the receiver of each packet slot (retransmission time for lost slots)."""
    out = []
    for k in range(n_slots):
        if k in lost:
            trigger_sent = (k + PKT_THRESHOLD) * SLOT_MS      # 3rd later packet
            retx_sent = trigger_sent + RTT_MS                  # its ACK reaches the sender
            out.append(retx_sent + ONE_WAY_MS)
        else:
            out.append(k * SLOT_MS + ONE_WAY_MS)
    return out


def deliver_tcp(slots, arr, record_slots=1):
    """Delivery time per slot for HTTP/2 over TLS over TCP."""
    n = len(slots)
    in_order = []
    running = 0
    for k in range(n):
        running = max(running, arr[k])
        in_order.append(running)
    out = []
    for k in range(n):
        last_of_record = min(n - 1, (k // record_slots + 1) * record_slots - 1)
        out.append(in_order[last_of_record])
    return out


def deliver_quic(slots, arr):
    """Delivery time per (slot, piece) for HTTP/3 over QUIC: in order within each stream only.

    A slot is a list of stream names; a slot holding two names carries frames of two streams.
    Returns a list (one entry per slot) of {stream: delivery_time}.
    """
    latest = {}
    out = []
    for k, pieces in enumerate(slots):
        d = {}
        for s in pieces:
            latest[s] = max(latest.get(s, 0), arr[k])
            d[s] = latest[s]
        out.append(d)
    return out


def per_stream(slots, arr, tcp_times, quic_times):
    rows = {}
    for k, pieces in enumerate(slots):
        for s in pieces:
            r = rows.setdefault(s, {"h2_first": None, "h2_done": 0, "h3_first": None, "h3_done": 0,
                                    "h2_wait": 0, "h3_wait": 0})
            t2, t3 = tcp_times[k], quic_times[k][s]
            r["h2_first"] = t2 if r["h2_first"] is None else min(r["h2_first"], t2)
            r["h3_first"] = t3 if r["h3_first"] is None else min(r["h3_first"], t3)
            r["h2_done"] = max(r["h2_done"], t2)
            r["h3_done"] = max(r["h3_done"], t3)
            # time this piece sat in a receive buffer after it had arrived (HoL wait)
            r["h2_wait"] += t2 - arr[k]
            r["h3_wait"] += t3 - arr[k]
    return rows


def show(title, slots, lost, record_slots=1, labels=None):
    arr = arrival_times(len(slots), lost)
    tcp = deliver_tcp(slots, arr, record_slots)
    quic = deliver_quic(slots, arr)
    rows = per_stream(slots, arr, tcp, quic)
    print(f"\n## {title}")
    print("slot order: " + " ".join("+".join(p) for p in (labels or slots)))
    print(f"lost slot(s): {sorted(lost)}; TLS record = {record_slots} packet(s); "
          f"RTT {RTT_MS} ms, one-way {ONE_WAY_MS} ms, 1 packet per {SLOT_MS} ms")
    print("| Stream | HTTP/2 first data (ms) | HTTP/2 done (ms) | HTTP/3 first data (ms) | HTTP/3 done (ms) "
          "| HTTP/2 HoL wait (packet-ms) | HTTP/3 HoL wait (packet-ms) |")
    print("|---|---|---|---|---|---|---|")
    for s, r in rows.items():
        print(f"| {s} | {r['h2_first']} | {r['h2_done']} | {r['h3_first']} | {r['h3_done']} "
              f"| {r['h2_wait']} | {r['h3_wait']} |")


def labelled(order, streams="ABC", n=4):
    if order == "round-robin":
        return [[s + str(i + 1)] for i in range(n) for s in streams]
    return [[s + str(i + 1)] for s in streams for i in range(n)]


def strip(slots):
    """Turn labels like 'B2' into stream names like 'B'."""
    return [[p[0] for p in pieces] for pieces in slots]


def scenario_tables():
    rr = labelled("round-robin")
    seq = labelled("sequential")
    show("S0 no loss, round-robin", strip(rr), set(), labels=rr)
    show("S1 round-robin, slot 4 (B2) lost", strip(rr), {4}, labels=rr)
    show("S2 sequential, slot 4 (B1) lost", strip(seq), {4}, labels=seq)
    show("S3 sequential, slot 1 (A2) lost", strip(seq), {1}, labels=seq)
    show("S4 round-robin, slot 4 lost, one 12-packet TLS record (~14 KB, under the 16 KB maximum)",
         strip(rr), {4}, record_slots=12, labels=rr)
    mixed = [["A"], ["B"], ["C"], ["A"], ["B", "C"], ["C"], ["A"], ["B"], ["C"], ["A"], ["B"], ["C"]]
    show("S5 round-robin, slot 4 carries frames of B and C and is lost", mixed, {4})


def qpack_case():
    """Header blocks for 4 requests. Slot 0 carries the dynamic-table insert of a shared header."""
    print("\n## Q1 header compression: 4 requests, slot 0 (carrying the table insert) lost")
    arr = arrival_times(4, {0})
    print(f"arrivals (ms): {arr}")
    # HPACK over TCP: slot 0 = req1 HEADERS with the insert; slots 1-3 = req2-4 referencing it.
    hpack = deliver_tcp([[0]] * 4, arr)
    # QPACK, SETTINGS_QPACK_BLOCKED_STREAMS > 0: slot 0 = encoder-stream insert + req1 HEADERS;
    # slots 1-3 = req2-4 HEADERS that reference the not-yet-acknowledged entry -> wait for slot 0.
    qpack_ref = [arr[0]] + [max(arr[k], arr[0]) for k in range(1, 4)]
    # QPACK, SETTINGS_QPACK_BLOCKED_STREAMS = 0: the encoder may not reference unacknowledged entries,
    # so req2-4 carry the header as a literal: larger, but decodable on arrival.
    qpack_lit = [arr[0]] + [arr[k] for k in range(1, 4)]
    print("| Request | HPACK over TCP decoded (ms) | QPACK, references allowed (ms) | QPACK, blocked streams = 0 (ms) |")
    print("|---|---|---|---|")
    for i in range(4):
        print(f"| req{i + 1} | {hpack[i]} | {qpack_ref[i]} | {qpack_lit[i]} |")


def sweep(trials=20000, n_streams=6, pkts=10, seed=7):
    """Random independent loss. Mean completion time over all streams, HTTP/2 vs HTTP/3."""
    print(f"\n## R1 random loss sweep: {n_streams} streams x {pkts} packets, {trials} trials per cell, seed {seed}")
    print("| Loss rate | Scheduling | HTTP/2 mean stream done (ms) | HTTP/3 mean stream done (ms) "
          "| Trials where HTTP/2 was slower for >= 1 stream |")
    print("|---|---|---|---|---|")
    rng = random.Random(seed)
    streams = [chr(ord("A") + i) for i in range(n_streams)]
    for p in (0.0001, 0.001, 0.01, 0.02, 0.05):
        for order in ("round-robin", "sequential"):
            slots = strip(labelled(order, streams, pkts))
            n = len(slots)
            sum2 = sum3 = 0.0
            worse = 0
            for _ in range(trials):
                lost = {k for k in range(n) if rng.random() < p}
                arr = arrival_times(n, lost)
                tcp = deliver_tcp(slots, arr)
                quic = deliver_quic(slots, arr)
                rows = per_stream(slots, arr, tcp, quic)
                d2 = [r["h2_done"] for r in rows.values()]
                d3 = [r["h3_done"] for r in rows.values()]
                sum2 += sum(d2) / len(d2)
                sum3 += sum(d3) / len(d3)
                worse += any(a > b for a, b in zip(d2, d3))
            print(f"| {p:.2%} | {order} | {sum2 / trials:.2f} | {sum3 / trials:.2f} | {worse / trials:.1%} |")


if __name__ == "__main__":
    scenario_tables()
    qpack_case()
    sweep()
