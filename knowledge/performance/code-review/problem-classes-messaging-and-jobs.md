---
schema: knowledge-doc/v1
type: reference
topic: performance/code-review
status: verified
applies-to: ["Apache Kafka 4.4 (clients and broker docs)", "Amazon SQS developer guide, living, read 2026-11-26", "RabbitMQ 4.4", "Celery 5.7, Sidekiq wiki (living), BullMQ docs (living), Rails 8.1 guides", "Kubernetes CronJob docs and GitHub Actions docs, living, read 2026-11-26"]
last-verified: 2026-11-26
last-updated: 2026-11-26
tags: [performance, code-review, messaging, kafka, sqs, rabbitmq, background-jobs, batching, dead-letter-queue, claim-check]
ranked-sources: true
---

# Performance problem classes for messaging and background jobs

## Summary
**TL;DR:** Code that talks to a message broker or a job queue has its own set of costly shapes: one blocking call per message, payloads that belong in storage, leases shorter than the work, poison messages with no exit, and one key or one schedule that every message or job shares. Each shape has a named setting or pattern that fixes it, and its cost can be counted from the code as round trips, redeliveries or a parallelism ceiling.
**Use this when:** you review a producer, a consumer, a worker, a job class or a schedule definition; you need the fix and the before → after count for a messaging shape you have spotted.
**Not this doc:** the first catalog of 39 classes, including `inline-slow-work`, `polling-event-rate`, `distributed-calls`, `concurrency-backpressure` and `transaction-lock-scope` → [problem-classes.md](problem-classes.md); bounding load and coalescing duplicate work → [../overload-and-coalescing.md](../overload-and-coalescing.md); a hot-partition incident → [../case-hot-partition.md](../case-hot-partition.md).

## Scope
The domain is code that sends messages to a broker or stream (Apache Kafka, Amazon Simple Queue Service (SQS), RabbitMQ), code that consumes them, and background-job frameworks that run on a queue (Celery, Sidekiq, BullMQ), plus the schedules that start jobs (Kubernetes CronJob, GitHub Actions `schedule`). Covered: 9 classes in four groups. Not covered: broker cluster sizing, replication and disk tuning, exactly-once transactions, and stream-processing engines.

Analogy: a post office. A producer that waits at the counter for a receipt after every letter, a clerk who must come back after every parcel, or a parcel too big for the slot all cost trips that a bag of letters, one signature per bag, or a pickup slip would save.

**Notation**, each with one worked example:

| Symbol | Meaning | Worked example |
|---|---|---|
| n | messages or jobs handled in one run | a nightly export sends n = 50,000 messages |
| b | messages per batch (per request, per commit, per bulk call) | SQS allows b ≤ 10, so 50,000 messages need at least 5,000 batch calls |
| P | partitions of a Kafka topic | a topic with P = 6 partitions lets at most 6 consumers of one group read at once |
| c | consumers or worker processes | c = 10 consumers on P = 6 partitions: 4 of them get no partition |
| k | distinct ordering keys or message groups | k = 1 when every message uses the key `"orders"` |
| t | processing time of one message | t = 90 s for a video thumbnail job |
| T | lease length: visibility timeout, poll interval limit or lock duration | SQS default T = 30 s, so a t = 90 s job is delivered again before it ends |
| N | rows a batch job walks | N = 2,000,000 rows in `orders` |

**Terms**

| Term | Plain meaning | Analogy | Concrete example |
|---|---|---|---|
| Acknowledgement (ack) | The consumer tells the broker a message is done, so it is not delivered again | Signing for a parcel | RabbitMQ `channel.basicAck(tag, false)` |
| Offset commit | A Kafka consumer records the position of the next message to read | A bookmark | `consumer.commitSync()` |
| Prefetch | How many unacknowledged messages a broker hands one consumer at once | How many plates a waiter carries | RabbitMQ `channel.basicQos(250)` |
| Visibility timeout (lease) | Time a received message stays hidden before another consumer may take it | A library loan period | SQS `VisibilityTimeout=30` |
| Dead-letter queue (DLQ) | A side queue for messages that failed too many times | The dead-letter office for undeliverable mail | SQS redrive policy with `maxReceiveCount` |
| Partition | An ordered slice of a Kafka topic; the unit one group consumer reads | One checkout lane | topic `orders` with 6 partitions |
| Consumer group | Consumers that share a topic's partitions | Cashiers sharing the lanes | `group.id=billing` |
| Publisher confirm | The broker tells a RabbitMQ publisher that a message was accepted | A delivery receipt | `channel.confirmSelect()` then `waitForConfirmsOrDie()` |
| Claim check | Store the payload elsewhere and send only a reference | A coat-check ticket | message body `{"s3Key":"exports/42.json"}` |

## Catalog

**Producing and enqueueing**

| Class | Signals in code | Fix | Before → after | Check |
|---|---|---|---|---|
| `send-per-message` | `producer.send(r).get()` in a loop; `linger.ms=0` or `batch.size=0`; SQS `SendMessage` in a loop; RabbitMQ `waitForConfirmsOrDie()` after each `basicPublish`; Sidekiq `perform_async`, BullMQ `queue.add` once per item | Kafka: asynchronous `send` with a callback, `linger.ms` and `batch.size`; SQS `SendMessageBatch`; RabbitMQ confirms per batch or asynchronous; Sidekiq `perform_bulk` / `push_bulk`; BullMQ `addBulk` | n blocking round trips → about n/b requests. Kafka 4.4: `send()` is asynchronous and calling `get()` makes it blocking ✅[^kafka-producer-api]; the producer groups records arriving between transmissions into one request, `batch.size` defaults to 16384 bytes and 0 disables batching ✅[^kafka-producer]; `linger.ms` changed its default from 0 to 5 in Kafka 4.0 ✅[^kafka-producer-41]; the protocol groups messages to amortize the round trip ✅[^kafka-design]. SQS: up to 10 messages per batch action, to reduce costs ✅[^sqs-batch]. RabbitMQ publisher-confirms tutorial (no version stated on the page): confirming each message one at a time "won't deliver more than a few hundred published messages per second", while waiting for a batch drastically improves throughput ✅[^rmq-tutorial7]. Sidekiq: `push_bulk` cuts out the Redis round trip latency, at most about 1000 jobs per call advised, `perform_bulk` since 6.3.0 ✅[^sidekiq-bulk]. BullMQ: bulk adds reduce round trips to the backend ✅[^bullmq-bulk] | Count broker requests or API calls for n = 1,000 messages with a stub or client metrics: expect about 1,000/b, not 1,000 |
| `oversized-message-payload` | whole files, base64 blobs, rendered reports or full ORM objects serialized into a message body or job arguments; raising `message.max.bytes` or `max.request.size` to fit them | Claim check: write the payload to object storage or the database, send its key or row id; SQS Extended Client Library | Bytes through the broker per message: payload size → reference size. The claim-check pattern sends only a reference, since traditional messaging systems are optimized for a high volume of small messages ✅[^az-claimcheck]; Sidekiq advises saving simple identifiers, not state, and arguments must be simple JSON types ✅[^sidekiq-best]; SQS caps a message at 1,048,576 bytes (1 MiB), and its extended client stores up to 2 GB in Amazon S3 behind a reference ✅[^sqs-quotas]; Kafka 4.4 defaults: `max.request.size` 1048576 ✅[^kafka-producer], broker `message.max.bytes` 1048588 ✅[^kafka-broker] | Message size distribution (largest and 99th percentile) against the broker limit; bytes in per second before and after |

**Consuming and acknowledging**

| Class | Signals in code | Fix | Before → after | Check |
|---|---|---|---|---|
| `ack-per-message` | `consumer.commitSync()` inside the `for (record : records)` loop; `basicAck(tag, false)` per delivery; SQS `DeleteMessage` per message | Commit once per poll or per partition batch, or `commitAsync`; RabbitMQ `basicAck(tag, true)` (multiple); SQS `DeleteMessageBatch` | n blocking commits → n/b. Kafka 4.4: `commitSync` blocks until the commit succeeds or fails for good, `commitAsync` does not block ✅[^kafka-consumer-api]; with `enable.auto.commit=true` (the default) offsets are committed in the background every 5000 ms ✅[^kafka-consumer-cfg]. RabbitMQ 4.4: manual acks can be batched to reduce network traffic ✅[^rmq-confirms]. SQS: `DeleteMessageBatch` handles up to 10 messages per call ✅[^sqs-batch] | Commit or delete calls per 1,000 messages; consumer throughput at the same CPU |
| `prefetch-window-mismatch` | RabbitMQ `autoAck=true` or `basicQos(0)` with slow handlers; `basicQos(1)` with fast handlers; Celery long tasks with the default `worker_prefetch_multiplier` | RabbitMQ prefetch in the 100–300 range for fast handlers; Celery `worker_prefetch_multiplier=1` with `task_acks_late=True` for long tasks; separate workers for long and short tasks | Unacknowledged in flight: unbounded → at most the prefetch value; prefetch 1 → one wait per message. RabbitMQ 4.4: prefetch 0 means no limit, and unlimited prefetch should be used with care; 100 through 300 usually offers optimal throughput; 1 is the most conservative and significantly reduces throughput ✅[^rmq-confirms]; prefetch 0 is treated as infinite ✅[^rmq-prefetch]. Celery 5.7: a worker reserves `worker_prefetch_multiplier` × concurrency slots, and long tasks want a multiplier of one ✅[^celery-opt] | Unacked count per consumer in the broker's management view; consumer memory at peak; time a short task waits behind long ones |
| `lease-shorter-than-work` | SQS visibility timeout left at its default for jobs that can run minutes; no `ChangeMessageVisibility` heartbeat; Kafka loops whose `max.poll.records` × t can exceed `max.poll.interval.ms`; Celery on Redis with ETA or countdown longer than the visibility timeout | Lease ≥ the longest processing time; a heartbeat that extends it; smaller poll batches or processing on another thread; idempotent handlers | Each message processed once → processed again every T while t > T. SQS: default visibility timeout 30 s, maximum 12 hours ✅[^sqs-quotas]; a message not deleted before the timeout becomes visible again for another consumer; use a heartbeat to extend it, and extending does not reset the 12-hour cap ✅[^sqs-visibility]. Kafka 4.4: `max.poll.records` defaults to 500 and `max.poll.interval.ms` to 300000 ✅[^kafka-consumer-cfg]; a late poll makes the client leave the group, and `commitSync` may then throw `CommitFailedException`; move processing to another thread when its time varies ✅[^kafka-consumer-api]. Celery 5.7 on Redis: default visibility timeout 1 hour; an ETA task past it runs "again, and again in a loop" ✅[^celery-redis] | Receive count per message (SQS `ApproximateReceiveCount`), rebalance count, duplicate side effects in a test where t = 2·T |
| `poison-message-loop` | no redrive policy on an SQS queue; `basicNack(tag, false, true)` (requeue) on every exception (from RabbitMQ 4.3 this does not count toward `delivery-limit`); quorum queue `delivery-limit` disabled; a Kafka consumer that rethrows on a bad record and re-polls the same offset | DLQ with a bounded receive count (SQS `maxReceiveCount`, RabbitMQ `delivery-limit` plus a dead-letter exchange); catch, park and alert | Redeliveries of one bad message: unbounded → at most the limit. SQS: `maxReceiveCount` is how many times a message can be received before it moves to the DLQ; set it high enough for sufficient retries ✅[^sqs-dlq]. RabbitMQ: since 4.0 quorum queues default to a delivery limit of 20, after which the message is dropped unless dead-lettering is configured; disabling the limit is not recommended, since repeated requeues can threaten the stability of a queue or cluster ✅[^rmq-quorum]. Kafka 4.4 share groups count delivery attempts, which enables automated handling of unprocessable records ✅[^kafka-design]. RabbitMQ 4.4: since 4.3 a `basic.nack` with requeue does not increase the delivery count, so a consumer that relies on `delivery-limit` must use `basic.reject`, or a poison message can be redelivered indefinitely ✅[^rmq-quorum] | Inject one message that always fails: it lands in the DLQ after the limit, and the next messages keep flowing |

**Parallelism and ordering**

| Class | Signals in code | Fix | Before → after | Check |
|---|---|---|---|---|
| `single-key-ordering-ceiling` | a constant Kafka key (`"orders"`) or an explicit `partition=0`; a topic with fewer partitions than planned consumers; one SQS FIFO `MessageGroupId` for all messages; scaling consumers to fix lag | Key by the entity that needs order (customer id, order id); enough partitions for the target consumer count; many message groups; Kafka share groups where order is not needed | Parallel consumers: at most min(c, P) per group, and 1 for a single key → up to min(c, k, P). Kafka 4.4: the same key goes to the same partition, read in written order ✅[^kafka-intro]; each partition is consumed by exactly one consumer in a group ✅[^kafka-design], ✅[^kafka-consumer-api]. SQS FIFO: messages in one group are processed sequentially, and spreading across group ids gives more parallelism; without high-throughput mode each partition handles 300 transactions per second per action, or 3,000 messages with batches of 10 ✅[^sqs-quotas] | Kafka `records-lag-max` per partition ✅[^kafka-monitoring], expect lag concentrated on one partition while others are near zero; messages per key |

**Background jobs and schedules**

| Class | Signals in code | Fix | Before → after | Check |
|---|---|---|---|---|
| `unchunked-batch-job` | one job that runs `Model.all.each`, `SELECT *` over a whole table, or loops over every tenant, with no saved position; a job that holds all ids in its arguments | Batches with a cursor (`find_each`, `in_batches` with `start:`); Sidekiq Iterable jobs; fan out one job per chunk (`perform_bulk`) | Memory O(N) → O(batch); work redone after an interruption O(N) → O(one batch). Rails 8.1: `all.each` fetches the entire table in one pass and keeps it in memory; `find_each` uses batches of 1,000 by default, and `:start` resumes an interrupted process from a saved id ✅[^rails-batches]. Sidekiq 7.3+: Iterable jobs save their cursor on an error or every five seconds and resume at the next cursor value, not at 0; each iteration must stay under 25 seconds ✅[^sidekiq-iter]. SQS: for processing that needs more than the 12-hour limit, the page suggests AWS Step Functions or smaller steps ✅[^sqs-visibility] | Kill the worker halfway: the rerun starts from the checkpoint; peak memory flat as N grows |
| `synchronized-schedule-burst` | many cron entries on `0 * * * *`, `@hourly` or `@daily`; one job per tenant enqueued at the same instant; a CronJob with no `concurrencyPolicy` for a job that can outlast its interval | Offset or jitter the minute; spread per-tenant runs over the window; `concurrencyPolicy: Forbid` or a lock for runs that must not overlap; `startingDeadlineSeconds` | Load at one instant: k jobs at :00 → about k / window per minute; overlapping runs of one schedule: unbounded → 1. GitHub Actions: scheduled runs can be delayed at high load, which includes the start of every hour; pick another minute; at high enough load some queued jobs may be dropped ✅[^gh-schedule]. Kubernetes: `concurrencyPolicy` defaults to `Allow`; `Forbid` skips a run while the previous one is running; the policy applies only within one CronJob ✅[^k8s-cronjob] | Histogram of job start minutes; queue depth at :00; count of concurrent runs of one schedule |

## Lookup notes

**Not a problem when**

| Class | Not a problem when |
|---|---|
| `send-per-message` | the volume is a few messages per request; or the caller must know each message was stored before it answers (then send in parallel and wait once). Kafka 4.x already lingers 5 ms by default, so only code that blocks on each `get()` or sets `batch.size=0` defeats batching |
| `oversized-message-payload` | payloads stay well under the limit and latency matters more than broker load: the claim check adds network trips ✅[^az-claimcheck] |
| `ack-per-message` | each message has an expensive, non-idempotent side effect and a redelivery would be costly; a larger batch means up to b messages are processed again after a crash |
| `prefetch-window-mismatch` | handlers are fast and memory is bounded by message size × prefetch; a multiplier of one is what Celery advises for long-running tasks ✅[^celery-opt]; for RabbitMQ, prefetch 1 is the most conservative setting and reduces throughput, which is acceptable when fair spreading matters more |
| `lease-shorter-than-work` | the handler is idempotent and t is always well under T; a framework already sends heartbeats |
| `poison-message-loop` | the queue is FIFO and order must never break: SQS advises against a DLQ there ✅[^sqs-dlq]; then park the whole group and alert instead |
| `single-key-ordering-ceiling` | global order across all messages is a real requirement and the volume fits one lane |
| `unchunked-batch-job` | N is small and bounded (a config table); the job is a single SQL statement that the database runs set-based |
| `synchronized-schedule-burst` | there are few schedules and the shared resource has headroom; an overlap is harmless because the job is idempotent and cheap |

**Belongs to an existing class** (in [problem-classes.md](problem-classes.md))
- Short polling of an empty queue (SQS `WaitTimeSeconds=0`) → `polling-event-rate`.
- Outbound retries with no backoff or jitter from a consumer → `distributed-calls`.
- Work done before the response instead of in a job → `inline-slow-work`.
- Workers claiming rows from a database job table → `transaction-lock-scope`.
- An in-process queue or `Promise.all` over every received message → `concurrency-backpressure`.
- A Kafka producer or broker connection created per request → `connection-management`; Kafka 4.4 says one shared, thread-safe producer is generally faster than many ✅[^kafka-producer-api].
- Hot keys inside a datastore, not a stream → the datastores catalog and [../case-hot-partition.md](../case-hot-partition.md).
- **Boundaries with the first catalog.** `send-per-message` and `ack-per-message` are the broker forms of `io-batching-n-plus-one` (one round trip per item). They are classes of their own here because the fix is a broker setting or call (producer batching, a batch acknowledgement, a bulk enqueue), not a query rewrite. `oversized-message-payload` is about what a broker stores and copies for each message; `payload-overfetch` is about the fields a response returns.

**Corrections found while checking the sources (2026-11-26)**
- The SQS message size limit is 1 MiB (1,048,576 bytes) on the current quotas page: code or docs that assume a smaller cap are out of date ✅[^sqs-quotas].
- Kafka's `linger.ms` default is 5 ms since Kafka 4.0, not 0 ✅[^kafka-producer-41].
- "Retried forever" no longer holds for RabbitMQ quorum queues: since 4.0 they stop at 20 deliveries, and with no dead-letter exchange the message is dropped, so a missing DLX now loses data instead of looping ✅[^rmq-quorum].
- "More consumers than partitions sit idle" holds for Kafka consumer groups, not share groups: share-group consumers can exceed the partition count ✅[^kafka-design]. The design page does not say whether share groups are generally available or still a preview in 4.4; check the release notes of the version you run before recommending them.
- SQS standard queues with `maxReceiveCount` above 3 move a message received 3 or more times to the back of the queue ✅[^sqs-dlq].
- RabbitMQ global (per-channel) prefetch is deprecated and disabled by default from 4.3 ✅[^rmq-prefetch].

**What the sources do not say**
- The Kafka consumer javadoc states no cost per commit; the "round trip per commit" in `ack-per-message` rests on `commitSync` blocking, not on a stated number.
- The Kafka design page does not state a release status for share groups.
- The RabbitMQ consumer-prefetch page does not state the default prefetch value.
- The Kafka pages read do not say that a failing record blocks its partition; that follows from in-order reading per partition, not from a stated rule.
- The BullMQ page gives no round-trip count per SDK, and says a failed bulk call on Redis may have added some jobs.
- The Kubernetes CronJob page gives no advice on spreading schedules; the "start of the hour" evidence is from GitHub Actions only.
- RabbitMQ's "a few hundred messages per second" for per-message confirms is from its tutorial, with no hardware stated: use it as an order of magnitude only.

**Calibration state (2026-11-26).** None of these classes has a sample in the review-agent calibration, and the agent's index does not list them: see [perf-reviewer-calibration.md](perf-reviewer-calibration.md). Whether a reviewer, person or agent, finds them from this catalog has not been measured.

## Takeaways
- In a producer or consumer loop, look for the one call that waits (`get()`, `commitSync()`, `waitForConfirms`, `DeleteMessage`) and count it per message; the fix is a batch or an asynchronous call, at about n/b. [rule-candidate]
- Every queue a consumer reads needs a bounded receive count and a dead-letter target; every lease must be longer than the slowest handler or be extended by a heartbeat. [rule-candidate]
- Parallelism is capped by partitions and keys, not by consumers: compute min(c, k, P) before adding workers.

## Verification status
- Verified: 49 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-26

## References
- [Producer Configs](https://kafka.apache.org/44/configuration/producer-configs/) — Apache Kafka, 4.4. Rank 1. Backs: Catalog, send-per-message and oversized-message-payload. [^kafka-producer]
- [Producer Configs (linger.ms default change)](https://kafka.apache.org/41/configuration/producer-configs/) — Apache Kafka, 4.1. Rank 1. Backs: Catalog, send-per-message; Lookup notes. [^kafka-producer-41]
- [KafkaProducer](https://kafka.apache.org/44/javadoc/org/apache/kafka/clients/producer/KafkaProducer.html) — Apache Kafka, clients 4.4.0. Rank 1. Backs: Catalog, send-per-message; Lookup notes. [^kafka-producer-api]
- [Consumer Configs](https://kafka.apache.org/44/configuration/consumer-configs/) — Apache Kafka, 4.4. Rank 1. Backs: Catalog, ack-per-message and lease-shorter-than-work. [^kafka-consumer-cfg]
- [KafkaConsumer](https://kafka.apache.org/44/javadoc/org/apache/kafka/clients/consumer/KafkaConsumer.html) — Apache Kafka, clients 4.4.0. Rank 1. Backs: Catalog, ack-per-message, lease-shorter-than-work and single-key-ordering-ceiling. [^kafka-consumer-api]
- [Introduction](https://kafka.apache.org/44/getting-started/introduction/) — Apache Kafka, 4.4. Rank 1. Backs: Catalog, single-key-ordering-ceiling. [^kafka-intro]
- [Design](https://kafka.apache.org/44/design/design/) — Apache Kafka, 4.4. Rank 1. Backs: Catalog, send-per-message, poison-message-loop and single-key-ordering-ceiling; Lookup notes. [^kafka-design]
- [Broker Configs](https://kafka.apache.org/44/configuration/broker-configs/) — Apache Kafka, 4.4. Rank 1. Backs: Catalog, oversized-message-payload. [^kafka-broker]
- [Monitoring](https://kafka.apache.org/44/operations/monitoring/) — Apache Kafka, 4.4. Rank 1. Backs: Catalog, single-key-ordering-ceiling check. [^kafka-monitoring]
- [Amazon SQS message quotas](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/quotas-messages.html) — Amazon Web Services, living. Rank 1. Backs: Catalog, oversized-message-payload, lease-shorter-than-work and single-key-ordering-ceiling; Lookup notes. [^sqs-quotas]
- [Amazon SQS visibility timeout](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html) — Amazon Web Services, living. Rank 1. Backs: Catalog, lease-shorter-than-work and unchunked-batch-job. [^sqs-visibility]
- [Using dead-letter queues in Amazon SQS](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html) — Amazon Web Services, living. Rank 1. Backs: Catalog, poison-message-loop; Lookup notes. [^sqs-dlq]
- [Amazon SQS batch actions](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-batch-api-actions.html) — Amazon Web Services, living. Rank 1. Backs: Catalog, send-per-message and ack-per-message. [^sqs-batch]
- [Consumer Acknowledgements and Publisher Confirms](https://www.rabbitmq.com/docs/confirms) — RabbitMQ, 4.4. Rank 1. Backs: Catalog, ack-per-message and prefetch-window-mismatch. [^rmq-confirms]
- [Publisher Confirms (Java tutorial)](https://www.rabbitmq.com/tutorials/tutorial-seven-java) — RabbitMQ, living. Rank 1. Backs: Catalog, send-per-message. [^rmq-tutorial7]
- [Quorum Queues](https://www.rabbitmq.com/docs/quorum-queues) — RabbitMQ, 4.4. Rank 1. Backs: Catalog, poison-message-loop; Lookup notes. [^rmq-quorum]
- [Consumer Prefetch](https://www.rabbitmq.com/docs/consumer-prefetch) — RabbitMQ, 4.4. Rank 1. Backs: Catalog, prefetch-window-mismatch; Lookup notes. [^rmq-prefetch]
- [Optimizing](https://docs.celeryq.dev/en/stable/userguide/optimizing.html) — Celery, 5.7. Rank 1. Backs: Catalog, prefetch-window-mismatch; Lookup notes. [^celery-opt]
- [Using Redis](https://docs.celeryq.dev/en/stable/getting-started/backends-and-brokers/redis.html) — Celery, 5.7. Rank 1. Backs: Catalog, lease-shorter-than-work. [^celery-redis]
- [Best Practices](https://github.com/sidekiq/sidekiq/wiki/Best-Practices) — Sidekiq project wiki, living. Rank 1. Backs: Catalog, oversized-message-payload. [^sidekiq-best]
- [Bulk Queueing](https://github.com/sidekiq/sidekiq/wiki/Bulk-Queueing) — Sidekiq project wiki, living. Rank 1. Backs: Catalog, send-per-message. [^sidekiq-bulk]
- [Iteration](https://github.com/sidekiq/sidekiq/wiki/Iteration) — Sidekiq project wiki, living. Rank 1. Backs: Catalog, unchunked-batch-job. [^sidekiq-iter]
- [Adding jobs in bulk](https://docs.bullmq.io/guide/queues/adding-bulks) — BullMQ, living. Rank 1. Backs: Catalog, send-per-message. [^bullmq-bulk]
- [Active Record Query Interface, retrieving multiple records in batches](https://guides.rubyonrails.org/active_record_querying.html) — Ruby on Rails, 8.1. Rank 1. Backs: Catalog, unchunked-batch-job. [^rails-batches]
- [CronJob](https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/) — Kubernetes, living. Rank 1. Backs: Catalog, synchronized-schedule-burst. [^k8s-cronjob]
- [Events that trigger workflows, schedule](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows) — GitHub, living. Rank 1. Backs: Catalog, synchronized-schedule-burst. [^gh-schedule]
- [Claim Check pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/claim-check) — Microsoft, Azure Architecture Center, 2026. Rank 1. Backs: Catalog, oversized-message-payload; Lookup notes. [^az-claimcheck]

## Related
- [problem-classes.md](problem-classes.md) — the first catalog of 39 classes; messaging shapes that belong there are listed in Lookup notes.
- [perf-reviewer-calibration.md](perf-reviewer-calibration.md) — the review agent built on the catalogs, and how it scored on known samples.
- [../overload-and-coalescing.md](../overload-and-coalescing.md) — bounding load and coalescing duplicate work, behind prefetch and schedule bursts.
- [../case-hot-partition.md](../case-hot-partition.md) — a hot-partition case study, next to `single-key-ordering-ceiling`.
