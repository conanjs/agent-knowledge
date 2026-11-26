---
schema: knowledge-doc/v1
type: reference
topic: performance/code-review
status: verified
applies-to: ["Kubernetes documentation (current release v1.37), Linux kernel 7.4 docs (CFS bandwidth control, cgroup v2), Java SE 21 (and Java SE 10 for history), Go 1.25 and later, Node.js 24, Python 3.15, .NET 10, Gunicorn 26, Uvicorn (living docs), Docker build docs; all read 2026-11-26"]
last-verified: 2026-11-26
last-updated: 2026-11-26
tags: [performance, code-review, kubernetes, containers, cgroups, cpu-limits, throttling, gomaxprocs, jvm, heap, dns, ndots, probes, autoscaling, dockerfile]
ranked-sources: true
---

# Performance problem classes in container and runtime configuration

## Summary
**TL;DR:** Some slow services have no slow code: the cost sits in a manifest, a Dockerfile or a start command. A CPU limit stops all threads of the container for the rest of each period (100 ms by default) once the budget is spent; a pool sized from the host's CPU count runs many more workers than the limit can feed; a heap limit that ignores the container's memory limit either wastes memory or gets the container killed; `ndots:5` turns one external lookup into several; a pod with no readiness probe takes traffic before it is warm; an entrypoint that installs or migrates repeats build work on every start; and an autoscaler on the wrong signal reacts late or not at all. This catalog names seven such classes with the key to look for, the fix, the cost and the check.
**Use this when:** you review a Kubernetes manifest or Helm values file, a Dockerfile, an entrypoint script, or the runtime flags of a JVM, Go, Node.js, Python or .NET service.
**Not this doc:** code-level classes (pools per request, cold start in code, parallelism overhead) → `problem-classes.md`; how CPU limits and throttling work → `../../kubernetes/cpu-limits-and-throttling.md`; memory limits and OOM kills → `../../kubernetes/memory-limits-and-oom-kill.md`; the review agent built on these catalogs → `perf-reviewer-calibration.md`.

## Scope
The domain is deployment and runtime configuration that is checked into the repository and changes how fast the same code runs. Analogy: a car whose engine is fine, but the handbrake is half on, the tank is a quarter full, and the satnav asks four wrong addresses before the right one. Concrete example: `resources.limits.cpu: "1"` on a Java service with 16 request threads lets the threads spend the whole 100 ms budget in about 6 ms of wall time if all of them are busy, after which none of them runs for the rest of the period (arithmetic from the kernel's quota-per-period rule, not a measured figure).

Covered: seven classes in four groups (CPU, memory, network names, lifecycle and scaling). Not covered: node-level kubelet settings that a service repository does not hold (CPU manager policy, eviction thresholds), image size and pull time, security settings, and shapes already in other catalogs (see "Belongs to an existing class").

Notation (each symbol is read from the manifest, the start command or the node):

| Symbol | Meaning | Worked example |
|---|---|---|
| H | Logical CPUs of the node (the host) | A 64-vCPU node: H = 64 |
| L | CPU limit of the container, in CPUs (quota ÷ period) | `limits.cpu: "2"` → `cpu.max` = `200000 100000` → L = 2 |
| T | Threads (or processes) of the container that want CPU at the same time | A pool of 16 busy threads: T = 16 |
| M | Memory limit of the container | `limits.memory: 2Gi` → M = 2 GiB |
| d | Search domains in the pod's `resolv.conf` | `default.svc.cluster.local svc.cluster.local cluster.local` → d = 3 |
| r | Replicas of the workload | `replicas: 6` → r = 6 |

Terms:

| Term | Plain meaning | Analogy | Concrete example |
|---|---|---|---|
| CPU request | The CPU share the scheduler reserves and the weight under contention | A guaranteed seat on a shared bus | `requests.cpu: 500m` |
| CPU limit (CFS quota) | A hard budget of CPU time per period for all threads of the container together | A prepaid card refilled every 100 ms | `limits.cpu: "1"` = 100 ms of CPU time per 100 ms |
| Throttling | The kernel stops scheduling the group's threads until the next period | Everyone waits for the card refill | `nr_throttled` grows in `cpu.stat` |
| cgroup v2 | The kernel interface that holds a container's limits as files | A control panel per container | `/sys/fs/cgroup/cpu.max`, `memory.max` |
| Container awareness | A runtime reads the cgroup limits instead of the host totals when it sizes itself | Reading the room's seat count, not the building's | Go 1.25 sets `GOMAXPROCS` from `cpu.max` |
| Heap limit | The most memory a garbage-collected runtime lets its heap grow to | A budget for one expense line, not the whole household | `-XX:MaxRAMPercentage=75`, `--max-old-space-size=1536` |
| `ndots` | Dots a name needs before the resolver tries it as written first | How many street details an address needs before the post office stops guessing the town | `options ndots:5` |
| Readiness probe | A check that decides whether a pod receives Service traffic | The "open" sign on a shop door | `readinessProbe.httpGet.path: /ready` |
| HPA | HorizontalPodAutoscaler: changes the replica count from a metric | A shop manager opening more tills when queues grow | `metrics: - type: Resource, name: cpu` |

## Catalog

**CPU**

| Class | Signals in code | Fix | Before → after | Check |
|---|---|---|---|---|
| `cpu-quota-throttling` | `resources.limits.cpu` of `"1"` or less (`500m`) on a service with many busy threads (a JVM, a Go service, a thread or worker pool, a parallel build step); `docker run --cpus=1` or Compose `cpus:` on such a service; `limits.cpu` with no `requests.cpu`, or neither set; a limit far below the thread count T | Size the thread count to L (see `host-sized-pools`); raise the limit to the burst the service needs, or set an accurate `requests.cpu` and leave the limit out where the cluster's policy allows; for latency-sensitive services, a Guaranteed pod with an integer CPU request on nodes with the static CPU manager policy | With T busy threads and limit L, the period's budget is spent in L ÷ T of the period and all threads then wait for the rest of it: L = 1, T = 4 → about 25 ms of running and 75 ms of waiting per 100 ms period (arithmetic, not a sourced figure) → no throttling when T ≤ L. Facts: a group gets up to "quota" microseconds of CPU time in each period ✅[^kernel-bwc]; once all quota is assigned, any further request for quota throttles those threads ✅[^kernel-bwc]; the documented default period is 100 ms ✅[^kernel-bwc]; Kubernetes enforces CPU limits by throttling ✅[^k8s-res]; a limit with no request is copied as the request unless an admission default applies ✅[^k8s-res]; the request typically defines a weighting under contention ✅[^k8s-res]; only Guaranteed pods' containers with integer CPU requests get exclusive CPUs under the static policy ✅[^k8s-cpumgr] | Read `cpu.stat` in the container: `nr_periods`, `nr_throttled`, `throttled_usec` ✅[^kernel-cg2]; expect `nr_throttled ÷ nr_periods` near 0 after the fix under the same load; p99 latency at the same request rate before and after |
| `host-sized-pools` | a pool size computed from the host: Node.js `os.cpus().length`; Python `os.cpu_count()` or `multiprocessing.cpu_count()` in `gunicorn.conf.py` (`workers = cpu_count() * 2 + 1`); `nproc` in an entrypoint; Go `runtime.NumCPU()` for a worker count, or a `go.mod` with `go 1.24` or lower; JVM `-XX:-UseContainerSupport`; .NET `DOTNET_gcServer=1` on many small replicas | Read the container's share: Node.js `os.availableParallelism()`; Go 1.25 or later with a `go 1.25` (or later) line in `go.mod`, or an explicit `GOMAXPROCS`; Python: set `--workers` / `WEB_CONCURRENCY` from L in the manifest, or `PYTHON_CPU_COUNT` (Python 3.13 and later); JVM: keep container support on, or set `-XX:ActiveProcessorCount=L`; .NET: `Environment.ProcessorCount` already applies the limit | H workers → about L workers; with H = 64 and L = 2 a `2 × cores + 1` formula starts 129 processes instead of 5, each with its own memory (arithmetic). Facts: Node.js says `os.cpus().length` should not be used for parallelism and points to `os.availableParallelism()` (added in v19.4.0 and v18.14.0) ✅[^node-os], which wraps libuv's `uv_available_parallelism()` ✅[^node-os]; libuv's ChangeLog lists "fix uv_available_parallelism using cgroup" in 1.49.0 (2024-09-25) and a fix for `cpu.max` limits below the period in 1.52.0 (2026-02-11) ✅[^libuv-log]; before Go 1.25 `GOMAXPROCS` defaulted to `runtime.NumCPU`, and from 1.25 on Linux it defaults to a lower cgroup CPU bandwidth limit, ignoring CPU requests ✅[^go125]; a module that declares an older Go version gets the older defaults "as closely as possible", and the page lists `containermaxprocs` among the Go 1.25 settings ✅[^go-godebug]; Python's `os.cpu_count()` returns the CPUs in the system, and `process_cpu_count()` (3.13) "can be less" than it "depending on the CPU affinity", and the page mentions no cgroup or CPU quota ✅[^py-os]; Java SE 21 container support is Linux-only and on by default, and `ActiveProcessorCount` overrides the CPU count the VM uses to size thread pools such as those for garbage collection and ForkJoinPool ✅[^java21]; .NET `ProcessorCount` is the minimum of logical CPUs, affinity and the CPU limit rounded up ✅[^dotnet-proc]; server GC gives each logical CPU a heap and a GC thread ✅[^dotnet-gcflavor] | Print the computed size inside the container (`node -p "os.availableParallelism()"`, `GOMAXPROCS` at start, the Gunicorn worker count in its log); expect about L, not H; throughput at workers = L, 2L and H under the same limit |

**Memory**

| Class | Signals in code | Fix | Before → after | Check |
|---|---|---|---|---|
| `heap-limit-mismatch` | a fixed heap flag near or above `limits.memory`: `-Xmx4g` with `limits.memory: 2Gi`, `--max-old-space-size=4096` with a 2 GiB limit; or a heap left to a default that does not fit: a JVM with no `MaxRAMPercentage` (heap capped at a quarter of M), a Go service with no `GOMEMLIMIT` in a tight limit; or a heap percentage with no room for non-heap memory (threads, buffers, native libraries, several worker heaps) | Derive the heap from M and leave headroom: JVM `-XX:MaxRAMPercentage`; Node.js `--max-old-space-size` below M or `--max-old-space-size-percentage`; Go `GOMEMLIMIT` with 5-10% headroom; .NET: the container default, or `GCHeapHardLimitPercent`; then set `limits.memory` from the measured total, not the heap alone | Heap above M: an OOM kill and a restart (all in-flight work lost) → garbage collection inside the limit; heap default too small: frequent GC on a quarter of the memory paid for → the heap uses the memory the pod reserves. With M = 2 GiB, the JVM default gives a heap of about 512 MiB (arithmetic from the 25% default). Facts: the JVM's `MaxRAMPercentage` default is 25 percent of the amount set by `-XX:MaxRAM`, before ergonomics heuristics; `MaxRAM` defaults to the lower of the memory available to the JVM process and 128 GB, and that availability is the minimum of physical memory and environment constraints such as a container ✅[^java21]; Kubernetes memory limits are enforced reactively by OOM kills ✅[^k8s-res]; at `memory.max` with no reclaim, the OOM killer runs in the cgroup ✅[^kernel-cg2]; as V8's old space nears `--max-old-space-size`, it spends more time on GC, and the Node.js 24 docs suggest 1536 MiB on a 2 GiB machine to leave room ✅[^node-cli]; `--max-old-space-size-percentage` takes a percentage of available system memory ✅[^node-cli]; the Go guide recommends a memory limit for containers with fixed memory and 5-10% headroom, and calls the limit soft ✅[^go-gc]; in a container, the .NET heap hard limit defaults to the larger of 20 MB and 75% of the container limit ✅[^dotnet-gc] | `kubectl get pod` restarts and `OOMKilled` status; `memory.current` against `memory.max`; GC logs (`-Xlog:gc`, `--trace-gc`, `GODEBUG=gctrace=1`): GC frequency and heap size before and after |

**Network names**

| Class | Signals in code | Fix | Before → after | Check |
|---|---|---|---|---|
| `dns-search-expansion` | a pod on the default `dnsPolicy` (`ClusterFirst`) calling external hosts by names with fewer than five dots (`api.example.com`, `db.internal.corp`) in config or environment variables; no `dnsConfig.options` with `ndots`; many outbound calls per request with no DNS cache in the client | Use fully qualified names with a trailing dot (`api.example.com.`); lower `ndots` in `dnsConfig.options`; call in-cluster services by their short or full Service name | An external name with fewer than `ndots` dots: up to d + 1 names tried in turn, each possibly for both A and AAAA records: d = 3 → up to 4 names, 8 queries (arithmetic) → 1 name. Facts: the documented pod `resolv.conf` has three search domains and `options ndots:5` ✅[^k8s-dns]; with no `dnsPolicy`, `ClusterFirst` is used ✅[^k8s-dns]; the search list is tried component by component until a match, a process the man page says may be slow and generate a lot of network traffic if the servers for the listed domains are not local ✅[^resolv]; `dnsConfig.options` can set `ndots`, shown with the value `"2"` in the Kubernetes example ✅[^k8s-dns]; the lab in the KB's DNS doc shows the query sequence → `../../kubernetes/networking/pod-networking-and-dns.md` | CoreDNS query log (the `log` plugin) for one lookup: count queries per external name; expect 1 name (× record types) after the fix |

**Lifecycle and scaling**

| Class | Signals in code | Fix | Before → after | Check |
|---|---|---|---|---|
| `missing-readiness-gate` | a Deployment behind a Service with no `readinessProbe`; a readiness probe that returns 200 before caches, connections or the JIT are warm; a slow starter guarded only by a `livenessProbe` with a short `initialDelaySeconds`; no `startupProbe` | A `readinessProbe` that passes only when the instance can serve; a `startupProbe` with `failureThreshold × periodSeconds` above the slowest start; a liveness probe that checks the process, not its dependencies | Every request routed to a new pod during its warm-up window → none until it reports ready; a slow start killed and restarted by liveness → one start. Facts: with no probe the kubelet treats the result as `Success` ✅[^k8s-probes]; a failed readiness probe removes the pod's IP from the Services' EndpointSlices ✅[^k8s-probes]; the page says readiness probes are useful when waiting for slow initial tasks such as opening connections, loading files and warming caches ✅[^k8s-lifecycle]; with a startup probe, liveness and readiness probes do not run until it succeeds ✅[^k8s-probes]; incorrect liveness probes can lead to cascading failures ✅[^k8s-probes] | Error rate and p99 latency in the first minute after each new pod starts, during a rolling update; `kubectl get endpointslices` shows the pod only after it is ready |
| `start-time-build-work` | an entrypoint or `command:` that runs `npm install`, `npm ci`, `pip install -r requirements.txt`, `bundle install`, `apt-get install`, `tsc` or `go build` before the server; `python manage.py migrate && gunicorn …`, `prisma migrate deploy && node server.js` or a migration init container in every replica; a Dockerfile that copies the whole source before installing dependencies | Install and compile in `RUN` steps at build time, dependency manifests first, then the source; a multi-stage build that ships only the output; migrations once per release (a Kubernetes `Job` or a pipeline step), not per pod | Install, compile and migrate work per container start, times r replicas and every restart → once per image build (install, compile) or once per release (migration): r = 6 → 6 migration runs per rollout → 1 (arithmetic). Facts: Docker advises containers that can be replaced "with an absolute minimum set up and configuration" ✅[^docker-bp]; Docker's cache guide copies `package.json` and the lock file, installs, then copies the source ✅[^docker-cacheopt], because a changed layer invalidates all later layers ✅[^docker-cache]; init containers run to completion before the pod's app containers start ✅[^k8s-init]; Kubernetes suggests a startup probe for containers that load large data or run migrations at start ✅[^k8s-probes] | Time from container start to ready, before and after; count migration runs in the logs of one rollout: r before, 1 after; `docker build` twice with only a source change: dependency layers come from cache |
| `autoscale-signal-mismatch` | an HPA with `type: Resource`, `name: cpu`, `target.type: Utilization` while the target's containers have no `requests.cpu`; a CPU-target HPA on a queue consumer or an I/O-bound service whose CPU stays low while work piles up; an HPA and a CPU limit that throttles before utilization reaches the target | Set `requests.cpu` on every container the HPA measures; scale on the signal that measures the backlog: an `External` or `Object` metric such as queue depth with an `AverageValue` per replica | No scaling at all, or scaling only after the backlog has grown without bound → replicas grow with the backlog, so the backlog per replica stays bounded. Facts: desired replicas = ceil(current replicas × current metric ÷ target) ✅[^k8s-hpa]; utilization is a percentage of the containers' requests, and if some containers lack the request, the pod's CPU utilization is undefined and the autoscaler takes no action for that metric ✅[^k8s-hpa]; the controller runs every 15 seconds by default, and a scale-down takes the highest recommendation within a 300-second stabilization window ✅[^k8s-hpa]; the walkthrough's queue example asks for one worker per 30 outstanding tasks with an `External` metric ✅[^k8s-hpa-walk]; a pod's CPU usage is ignored during a 5-minute initialization period after it starts, unless the pod is ready and the sample was taken entirely while it was ready ✅[^k8s-hpa] | `kubectl describe hpa`: the current metric value is shown and changes with load; a load test that grows the queue: replicas follow the queue, and its depth per replica stays near the target |

## Lookup notes
- **Read the whole chain.** A class here is a finding when the manifest, the start command and the runtime version are read together: the same `limits.cpu: "2"` is fine for Go 1.25 with a `go 1.25` line and a problem for a Gunicorn config that multiplies `os.cpu_count()`.
- **Not a problem when.**

| Class | Not a problem when |
|---|---|
| `cpu-quota-throttling` | The service is single-threaded or T ≤ L (one Node.js event loop under `limits.cpu: "1"`); `cpu.stat` shows `nr_throttled` near 0 under peak load; the cluster's policy requires limits and the limit is set above the measured peak; the pod is Guaranteed with an integer CPU request on a static-policy node, which gives its containers exclusive CPUs ✅[^k8s-cpumgr] |
| `host-sized-pools` | The node is dedicated to the pod and no CPU limit is set; the count comes from `os.availableParallelism()` on Node.js 24 (measured in `../../js-runtime/worker-thread-pools.md`), Go 1.25 or later with a matching `go` line ✅[^go125][^go-godebug], or .NET `ProcessorCount` ✅[^dotnet-proc]; the pool is I/O-bound and sized from concurrency, not CPUs (then it is a `connection-management` or `concurrency-backpressure` question) |
| `heap-limit-mismatch` | The heap flag is a percentage with headroom measured against the real non-heap use; the process is the only one in the container and its total stays below `memory.max` in a load test; .NET, where the container default already ties the heap hard limit to the container limit ✅[^dotnet-gc] |
| `dns-search-expansion` | The service calls only in-cluster names, which the search list is for; names are already written with a trailing dot; the client or a node-local DNS cache answers repeat lookups, so the expansion happens once per cache lifetime, not per call |
| `missing-readiness-gate` | The pod serves no traffic through a Service (a batch Job, a queue worker with no Service); the app is ready the moment it listens, with nothing to load or warm |
| `start-time-build-work` | A development image or a one-off job where start time does not matter; the "install" is a no-op check against an already populated directory baked into the image; a single-replica service where a migration at start is the team's chosen release step and runs once |
| `autoscale-signal-mismatch` | The workload is CPU-bound and CPU utilization tracks its backlog; replicas are fixed on purpose (a singleton, a stateful leader); a different autoscaler that the repository configures (an event-driven scaler on the queue) already scales on the backlog |

- **Belongs to an existing class.**
  - A database or HTTP pool per replica whose total (pool size × r) exceeds the server's connection limit → `connection-management` in `problem-classes.md`.
  - Heavy work at module top level, or clients built in a handler, that slows start → `startup-cold-start` in `problem-classes.md`; `start-time-build-work` covers only work that belongs to the image build or the release, not to the process.
  - More worker threads than CPU-bound work can use, independent of containers → `parallelism-overhead` in `problem-classes.md`. Per-worker Node.js heap limits that add up past the container limit → `../../js-runtime/node-worker-default-heap-limit.md` (a sub-case of `heap-limit-mismatch`'s "no room for non-heap memory").
  - `UV_THREADPOOL_SIZE` and libuv thread-pool saturation → the Node.js runtime catalog written in the same round (`problem-classes-nodejs-runtime.md`).
  - Unbounded fan-out or queues inside the service, as opposed to the replica count → `concurrency-backpressure` in `problem-classes.md`.
- **Corrections found while checking the sources (2026-11-26).**
  - "The JVM ignores container limits" is out of date: container detection is documented in the Java SE 10 `java` page, then only on Linux x64 ✅[^java10], and is on by default on Linux in Java SE 21 ✅[^java21]. The current trap is the opposite: the default heap is only 25% of the container's memory ✅[^java21].
  - "Go reads the CPU limit" holds only from Go 1.25, and only for a module whose `go` line is 1.25 or later, since a module that declares an older Go version gets the older defaults as closely as possible ✅[^go125][^go-godebug]. Go 1.25 also does not consider the CPU request ✅[^go125], so a pod with a request and no limit still gets the default from the logical CPUs available (H).
  - Python 3.13's `os.process_cpu_count()` is not a container-aware count: the Python 3.15 page defines it by CPU affinity and mentions no cgroup or CPU quota ✅[^py-os]. The page names `PYTHON_CPU_COUNT` and `-X cpu_count` as the overrides for both functions ✅[^py-os].
  - Gunicorn's default is 1 worker, or `WEB_CONCURRENCY` when set; its guidance of 2-4 × the number of cores ✅[^gunicorn] is what people turn into `cpu_count()` formulas, and in a container that count is H. Uvicorn's `--workers` has the same default ✅[^uvicorn].
  - A limit without a request is not "no request": Kubernetes copies the limit as the request ✅[^k8s-res].
- **What the sources do not say.**
  - libuv's own documentation of `uv_available_parallelism()` mentions only the CPU affinity mask on Linux, not cgroups ✅[^libuv-doc]; the cgroup behaviour rests on its ChangeLog ✅[^libuv-log] and on the KB's measurement on Node.js 24.22.1 (`../../js-runtime/worker-thread-pools.md`).
  - No Node.js page read today states whether the main thread's default heap limit follows the cgroup memory limit; set `--max-old-space-size` explicitly rather than rely on it.
  - The kernel page gives no throttling cost in latency; the 25 ms / 75 ms split above is arithmetic. The Go guide calls 5-10% headroom "a good rule of thumb" ✅[^go-gc], not a guarantee.
  - The Oracle release notes for JDK 10 and JDK 19 and the OpenJDK bug tracker refused automated reading, so the JDK 8 backport of container support and the JDK 19 change that stopped CPU shares from setting the processor count are left unverified and out of the catalog.
  - The Kubernetes pages give `ndots:5` only in an example `resolv.conf` ✅[^k8s-dns]; they do not call 5 a fixed default for every cluster.
- **Weaker sources.** None cited.

**Calibration state (2026-11-26).** Each class of this catalog has one known-bad sample in round 3 of the review-agent calibration, and some of its "Not a problem when" rows have a trap sample. In that round (one run per arm) the agent with the skill filed all 96 planted problems of the thirteen domain catalogs under the right class id, and without the skill 86 of them. Results per catalog, and the limits of the round: [perf-reviewer-calibration.md](perf-reviewer-calibration.md) §6.5.

## Takeaways
- Read a CPU limit next to the thread count: when more threads want CPU than the limit allows, all of them stop for the rest of each period. [rule-candidate]
- Any pool or worker count derived from a CPU count is a finding unless the API reads the container's limit (`os.availableParallelism()`, Go 1.25 with a matching `go` line, .NET `ProcessorCount`); Python's `cpu_count()` and `process_cpu_count()` do not read a cgroup limit, according to the Python 3.15 page. [rule-candidate]
- A heap flag is correct only relative to `limits.memory`: too high is an OOM kill, too low (the JVM's 25% default) is wasted memory and extra GC. [rule-candidate]
- Work that is the same on every start (install, compile, migrate) belongs in the image build or the release, not in the entrypoint.

## Verification status
- Verified: 61 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-26

## References
- [Resource Management for Pods and Containers](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/) — Kubernetes project, living (v1.37). Rank 1. Backs: Catalog, cpu-quota-throttling and heap-limit-mismatch; Lookup notes. [^k8s-res]
- [Control CPU Management Policies on the Node](https://kubernetes.io/docs/tasks/administer-cluster/cpu-management-policies/) — Kubernetes project, living (stable since v1.26). Rank 1. Backs: Catalog, cpu-quota-throttling; Lookup notes. [^k8s-cpumgr]
- [CFS Bandwidth Control](https://docs.kernel.org/scheduler/sched-bwc.html) — Linux kernel documentation, 7.4.0-rc4. Rank 1. Backs: Catalog, cpu-quota-throttling. [^kernel-bwc]
- [Control Group v2](https://docs.kernel.org/admin-guide/cgroup-v2.html) — Linux kernel documentation, 7.4.0-rc4. Rank 1. Backs: Catalog, cpu-quota-throttling and heap-limit-mismatch. [^kernel-cg2]
- [Go 1.25 Release Notes](https://go.dev/doc/go1.25) — Go project, Go 1.25. Rank 1. Backs: Catalog, host-sized-pools; Lookup notes. [^go125]
- [Go, Backwards Compatibility, and GODEBUG](https://go.dev/doc/godebug) — Go project, living. Rank 1. Backs: Catalog, host-sized-pools; Lookup notes. [^go-godebug]
- [A Guide to the Go Garbage Collector](https://go.dev/doc/gc-guide) — Go project, living (describes Go 1.19 and later). Rank 1. Backs: Catalog, heap-limit-mismatch; Lookup notes. [^go-gc]
- [os: Miscellaneous operating system interfaces](https://docs.python.org/3/library/os.html) — Python Software Foundation, 3.15.2. Rank 1. Backs: Catalog, host-sized-pools; Lookup notes. [^py-os]
- [The java Command](https://docs.oracle.com/en/java/javase/21/docs/specs/man/java.html) — Oracle, Java SE 21. Rank 1. Backs: Catalog, host-sized-pools and heap-limit-mismatch; Lookup notes. [^java21]
- [java (Java SE 10 Tools Reference)](https://docs.oracle.com/javase/10/tools/java.htm) — Oracle, Java SE 10. Rank 1. Backs: Lookup notes, corrections. [^java10]
- [OS](https://nodejs.org/api/os.html) — Node.js project, v26.13.1 docs (the APIs date from v18.14.0 and v19.4.0). Rank 1. Backs: Catalog, host-sized-pools. [^node-os]
- [Command-line API](https://nodejs.org/docs/latest-v24.x/api/cli.html) — Node.js project, v24. Rank 1. Backs: Catalog, heap-limit-mismatch. [^node-cli]
- [libuv ChangeLog](https://raw.githubusercontent.com/libuv/libuv/v1.x/ChangeLog) — libuv project, v1.x branch. Rank 1. Backs: Catalog, host-sized-pools; Lookup notes. [^libuv-log]
- [libuv Miscellaneous utilities](https://docs.libuv.org/en/v1.x/misc.html) — libuv project, v1.x. Rank 1. Backs: Lookup notes. [^libuv-doc]
- [Environment.ProcessorCount Property](https://learn.microsoft.com/en-us/dotnet/api/system.environment.processorcount?view=net-10.0) — Microsoft Learn, .NET 10 (updated 2026-08-13). Rank 1. Backs: Catalog, host-sized-pools; Lookup notes. [^dotnet-proc]
- [Workstation vs. server garbage collection](https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/workstation-server-gc) — Microsoft Learn, 2023. Rank 1. Backs: Catalog, host-sized-pools. [^dotnet-gcflavor]
- [Garbage collector config settings](https://learn.microsoft.com/en-us/dotnet/core/runtime-config/garbage-collector) — Microsoft Learn, 2026-02-09. Rank 1. Backs: Catalog, heap-limit-mismatch; Lookup notes. [^dotnet-gc]
- [Settings](https://gunicorn.org/reference/settings/) — Gunicorn project, living (notes up to 26.3.0). Rank 1. Backs: Lookup notes, corrections. [^gunicorn]
- [Settings](https://uvicorn.dev/settings/) — Uvicorn project, living. Rank 1. Backs: Lookup notes, corrections. [^uvicorn]
- [DNS for Services and Pods](https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/) — Kubernetes project, living. Rank 1. Backs: Catalog, dns-search-expansion; Lookup notes. [^k8s-dns]
- [resolv.conf(5)](https://man7.org/linux/man-pages/man5/resolv.conf.5.html) — Linux man-pages via man7.org, living. Rank 1. Backs: Catalog, dns-search-expansion. [^resolv]
- [Liveness, Readiness, and Startup Probes](https://kubernetes.io/docs/concepts/configuration/liveness-readiness-startup-probes/) — Kubernetes project, living. Rank 1. Backs: Catalog, missing-readiness-gate and start-time-build-work. [^k8s-probes]
- [Pod Lifecycle](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/) — Kubernetes project, living. Rank 1. Backs: Catalog, missing-readiness-gate. [^k8s-lifecycle]
- [Init Containers](https://kubernetes.io/docs/concepts/workloads/pods/init-containers/) — Kubernetes project, living. Rank 1. Backs: Catalog, start-time-build-work. [^k8s-init]
- [Best practices (Dockerfile)](https://docs.docker.com/build/building/best-practices/) — Docker, living. Rank 1. Backs: Catalog, start-time-build-work. [^docker-bp]
- [Optimize cache usage in builds](https://docs.docker.com/build/cache/optimize/) — Docker, living. Rank 1. Backs: Catalog, start-time-build-work. [^docker-cacheopt]
- [Docker build cache](https://docs.docker.com/build/cache/) — Docker, living. Rank 1. Backs: Catalog, start-time-build-work. [^docker-cache]
- [Horizontal Pod Autoscaling](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/) — Kubernetes project, living. Rank 1. Backs: Catalog, autoscale-signal-mismatch. [^k8s-hpa]
- [HorizontalPodAutoscaler Walkthrough](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale-walkthrough/) — Kubernetes project, living. Rank 1. Backs: Catalog, autoscale-signal-mismatch. [^k8s-hpa-walk]

## Related
- [problem-classes.md](problem-classes.md) — the first catalog; `connection-management`, `parallelism-overhead`, `startup-cold-start` and `concurrency-backpressure` border these classes.
- [perf-reviewer-calibration.md](perf-reviewer-calibration.md) — the review agent built on these catalogs, and how it scored.
- [../../kubernetes/cpu-limits-and-throttling.md](../../kubernetes/cpu-limits-and-throttling.md) — the CPU budget per period, with measured throttling.
- [../../kubernetes/memory-limits-and-oom-kill.md](../../kubernetes/memory-limits-and-oom-kill.md) — how a memory limit ends in an OOM kill.
- [../../kubernetes/container-cpu-memory-limits-deep-dive.md](../../kubernetes/container-cpu-memory-limits-deep-dive.md) — every actor from the app to the kubelet.
- [../../linux/containers/cgroups-v2.md](../../linux/containers/cgroups-v2.md) — the cgroup v2 files behind the limits.
- [../../go/runtime/scheduler-and-goroutine-stacks.md](../../go/runtime/scheduler-and-goroutine-stacks.md) — `GOMAXPROCS` under Docker CPU limits, measured.
- [../../js-runtime/worker-thread-pools.md](../../js-runtime/worker-thread-pools.md) — `availableParallelism()` under a CPU limit, measured on Node.js 24.
- [../../js-runtime/node-worker-default-heap-limit.md](../../js-runtime/node-worker-default-heap-limit.md) — worker heap limits that add up past the container limit.
- [../../python/concurrency/threads-processes-and-the-gil.md](../../python/concurrency/threads-processes-and-the-gil.md) — processes against threads in Python.
- [../../kubernetes/networking/pod-networking-and-dns.md](../../kubernetes/networking/pod-networking-and-dns.md) — `ndots:5` and the query log of one lookup.
- [../../kubernetes/workloads/pod-lifecycle-and-probes.md](../../kubernetes/workloads/pod-lifecycle-and-probes.md) — startup, liveness and readiness probes.
- [../../kubernetes/operations/autoscaling.md](../../kubernetes/operations/autoscaling.md) — the HPA algorithm, stabilization and requests.
- [../../linux/containers/overlayfs-and-image-layers.md](../../linux/containers/overlayfs-and-image-layers.md) — image layers and why their order matters.
