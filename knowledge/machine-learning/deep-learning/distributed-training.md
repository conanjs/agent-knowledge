---
schema: knowledge-doc/v1
type: concept
topic: machine-learning/deep-learning
status: verified
applies-to: ["PyTorch 2.15.0"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [machine-learning, deep-learning, distributed-training, data-parallelism, ddp, distributedsampler, zero, fsdp, tensor-parallelism, megatron, pipeline-parallelism, pipeline-bubble, sequence-parallelism, context-parallelism, expert-parallelism, all-reduce, all-gather, reduce-scatter, gloo, torchrun]
---

# Distributed training: data, sharded, tensor and pipeline parallelism

## Summary
**TL;DR:** Data parallelism copies the whole model to every device, gives each a different slice of the batch, and averages the gradients with an all-reduce so that all copies take the same step; `DistributedDataParallel` (DDP) does this in buckets that overlap with the backward pass. ZeRO and FSDP (Fully Sharded Data Parallel) keep data parallelism but split the optimizer state, gradients and parameters across devices, gathering parameters only while a layer runs. When one layer is too big, tensor parallelism splits its weight matrices (Megatron: the first by columns, the second by rows, one all-reduce); when the model is too deep, pipeline parallelism puts groups of layers on different devices and streams micro-batches through them, paying an idle "bubble" of `(p − 1)/m` of the ideal time for `p` stages and `m` micro-batches.
**Use this when:** a model or batch no longer fits on one device, you set up DDP or FSDP, gradients differ between ranks, you pick a tensor-, pipeline- or data-parallel degree, or you need to know what all-reduce, all-gather and reduce-scatter do.
**Not this doc:** the memory budget of one device (parameters, gradients, Adam state, activations), mixed precision and checkpointing → `machine-learning/deep-learning/mixed-precision-and-memory-saving.md`; how mixture-of-experts layers route tokens → `machine-learning/transformers/mixture-of-experts.md`; why parallel sums give slightly different last digits → `machine-learning/ml-systems/reproducibility-and-determinism.md`.

## Problem
A 7.5-billion-parameter model trained with mixed-precision Adam needs about 120 GB for model state alone, and plain data parallelism stores all of it on every device ✅[^6]. Splitting the work is easy to get subtly wrong: without a distributed sampler every process trains on the same data, because DDP does not shard the input itself ✅[^2]; batch norm needs its layers converted to `SyncBatchNorm` to compute statistics over all processes ✅[^15]; and each way of splitting the model adds communication in a different place. The choice of parallelism decides both whether the model fits and how much time is spent waiting on the network.

## Mental model
**Analogy:** a team of cooks making the same dish. Data parallelism gives each cook the full recipe and a share of the orders; at the end of each round they compare notes (all-reduce) so every recipe book gets the same correction. ZeRO/FSDP tears the recipe book into chapters, one per cook, and they pass pages around just before they need them. Tensor parallelism has two cooks chop halves of the same onion at once. Pipeline parallelism is an assembly line: one cook preps, the next cooks, the next plates, and the line is idle while the first plate travels down it (the bubble).

**Artifact:** the three collectives on two processes (gloo backend, CPU), printed by the full script in the Worked example; lab run (`machine-learning/lab-setup.md`), 2026-11-24, PyTorch 2.15.0 ✅[^13]:

```text
[rank 0] all_reduce [12.0, 14.0, 16.0, 18.0] | all_gather [1.0, 2.0, 3.0, 4.0, 11.0, 12.0, 13.0, 14.0] | reduce_scatter [12.0, 14.0]
[rank 1] all_reduce [12.0, 14.0, 16.0, 18.0] | all_gather [1.0, 2.0, 3.0, 4.0, 11.0, 12.0, 13.0, 14.0] | reduce_scatter [16.0, 18.0]
```

Rank 0 held `[1, 2, 3, 4]` and rank 1 `[11, 12, 13, 14]`. All-reduce: everyone gets the sum. All-gather: everyone gets every piece. Reduce-scatter: the sum, but each rank keeps only its chunk.

## How it works
### 1. Collectives: the vocabulary
1. **All-reduce** stores the reduced result in every rank's buffer; **reduce** only in the root's; **broadcast** copies a buffer from the root to all ranks ✅[^5].
2. **All-gather** collects `N` values from each of `k` ranks into a `k·N` buffer on every rank; **reduce-scatter** splits the reduced result into equal blocks, one per rank; **all-to-all** gives every rank a `k·N` buffer whose `i`-th chunk came from rank `i` ✅[^5].
3. **The identity used everywhere below:** reduce-scatter followed by all-gather equals all-reduce ✅[^5], so a standard data-parallel all-reduce moves about `2Ψ` elements for `Ψ` parameters ✅[^6].
4. **Backends:** use NCCL for CUDA GPUs and Gloo for CPU training ✅[^4]. Gloo supports `reduce_scatter` on CPU but not `all_to_all` ✅[^4], and `ReduceOp.AVG` is NCCL-only ✅[^4]. `torchrun` starts the workers and sets `RANK`, `LOCAL_RANK`, `WORLD_SIZE`, `MASTER_ADDR` and `MASTER_PORT` for each ✅[^14]; all of them but `LOCAL_RANK` are what `init_process_group`'s default `env://` method reads ✅[^4].

### 2. Data parallelism with DDP
1. **Same start:** the DDP constructor broadcasts the `state_dict()` from rank 0 to every other process ✅[^1]. In the lab each rank was seeded differently on purpose and still ended with identical parameters ✅[^13].
2. **Different data:** DDP does not shard the input; a `DistributedSampler` restricts each process to its own exclusive subset ✅[^2] ✅[^3]. It shuffles by default, so call `set_epoch()` at the start of every epoch, or every epoch uses the same order ✅[^3]. With the default `drop_last=False` it adds extra indices so the data divides evenly across replicas ✅[^3].
3. **Gradient averaging in buckets:** the `Reducer` registers one autograd hook per parameter and groups gradients into buckets, roughly in reverse order of `model.parameters()`, because that is about the order in which backward finishes them ✅[^1]. When a bucket is full of ready gradients, DDP starts an asynchronous all-reduce on it ✅[^1], overlapping communication with the rest of the backward pass, which is where DDP's speed comes from ✅[^1]. The default bucket size is 25 MiB (`bucket_cap_mb`) ✅[^2].
4. **Result:** the `.grad` of a parameter is the same on every process ✅[^1], so every optimizer takes the same step. Gradients are averaged, so with `N` processes each on `M` examples the gradient is `N` times smaller than a single process summing over `M·N` examples would give ✅[^2]; with a mean loss it equals the full-batch mean gradient (lab below).
5. **Buffers and batch norm:** buffers such as batch-norm running statistics are broadcast from rank 0 each iteration ✅[^2]; each process runs batch norm on its own batch, so the batch statistics are per process; `SyncBatchNorm` computes them over all mini-batches of the process group instead, once `SyncBatchNorm.convert_sync_batchnorm` has replaced the `BatchNorm*D` layers before DDP wraps the model ✅[^15]. `SyncBatchNorm` supports only DDP with a single GPU per process ✅[^15].
6. **Gradient accumulation:** `no_sync()` disables the all-reduce for the micro-batches inside it ✅[^2]; see `machine-learning/deep-learning/mixed-precision-and-memory-saving.md`.

### 3. Sharded data parallelism: ZeRO and FSDP
Per device, for `Ψ` parameters, `N_d` data-parallel devices and mixed-precision Adam ✅[^6]:

| Stage | What is split | Memory per device | 7.5B params, `N_d = 64` | Communication |
|---|---|---|---|---|
| Plain data parallel | nothing | `16Ψ` | 120 GB | `2Ψ` |
| ZeRO-1 (`P_os`) | optimizer state | `4Ψ + 12Ψ/N_d` (about 4× less) | 31.4 GB | `2Ψ` |
| ZeRO-2 (`P_os+g`) | + gradients | `2Ψ + 14Ψ/N_d` (about 8× less) | 16.6 GB | `2Ψ` |
| ZeRO-3 (`P_os+g+p`) | + parameters | `16Ψ/N_d` (linear in `N_d`) | 1.9 GB | `3Ψ` (1.5×) |

PyTorch's `fully_shard` (FSDP2) shards parameters, gradients and optimizer state across data-parallel workers, storing each parameter as a DTensor sharded on dimension 0 ✅[^7]. Before a module's forward and backward it all-gathers the parameters, frees them afterwards, and reduce-scatters the gradients after backward ✅[^7]. `reshard_after_forward=True` frees parameters after forward and all-gathers them again in backward; `False` keeps them, saving that all-gather at the cost of memory, and is usual for the root module ✅[^7]. The FSDP2 page does not name ZeRO stages; by the table above, its default behaviour shards the same three things as ZeRO-3.

### 4. Tensor parallelism (Megatron-style)
1. **MLP:** for `Y = GeLU(X·A)·B`, split `A` by columns: each device computes `GeLU(X·A_i)` with no communication, because GeLU is applied element-wise to its own columns ✅[^8]. Split `B` by rows, so each device's `GeLU(X·A_i)·B_i` is a partial sum of `Y` ✅[^8].
2. **Two operators:** `f` is the identity in forward and an all-reduce in backward; `g` is an all-reduce in forward and the identity in backward ✅[^8]. A transformer layer then needs two all-reduces in forward and two in backward ✅[^8].
3. **Attention:** heads are independent, so their parameters and work are split across devices by head ✅[^8].
4. **Why columns first:** splitting `A` by rows would make each device hold a partial sum of `X·A` before the GeLU, and `GeLU(a) + GeLU(b) ≠ GeLU(a + b)`. In the lab that version was off by up to `4.049`; the column-then-row version matched to `4.77e-07` ✅[^13].
5. **Placement:** tensor parallelism communicates inside every layer; Narayanan et al. use it up to the number of GPUs in one server and pipeline parallelism across servers ✅[^10]; Megatron's 8.3B runs used 8 GPUs per model-parallel group ✅[^8].

### 5. Pipeline parallelism
1. **Micro-batches:** GPipe splits each mini-batch into `M` equal micro-batches that flow through `K` devices, accumulates gradients over all of them and applies one synchronous update at the end of the mini-batch ✅[^9]. With re-materialization, it stores only partition-boundary activations and recomputes the rest in backward ✅[^9].
2. **The bubble:** with `p` stages and `m` micro-batches, the idle time is `(p − 1)/m` of the ideal compute time ✅[^10]; as a share of total time that is `(K − 1)/(M + K − 1)`, which GPipe states as an `O((K − 1)/(M + K − 1))` bubble ✅[^9]. GPipe's authors found it negligible when `M ≥ 4K` ✅[^9].
3. **1F1B (one forward, one backward):** the same bubble, but activations are stashed for at most `p` micro-batches instead of `m` ✅[^10].
4. **Interleaved stages:** giving each device `v` model chunks divides the bubble by `v`, `(1/v)·(p − 1)/m`, and multiplies communication by `v` ✅[^10].

### 6. Sequence, context and expert parallelism (briefly)
1. **Sequence parallelism** partitions the layer-norm and dropout regions along the sequence dimension next to tensor parallelism, replacing each all-reduce with a reduce-scatter and an all-gather at the same communication cost ✅[^11]; with selective recomputation it cut activation memory about 5 times ✅[^11].
2. **Context parallelism** splits long sequences across devices for attention itself: Ring Attention computes attention block by block, and each device sends its key-value blocks to the next device in a ring while it computes. The transfer adds no overhead as long as computing a block takes longer than sending one, which needs a block size of at least the device's FLOPS (floating-point operations per second) divided by its bandwidth; the sequence length then grows with the number of devices, up to device-count times longer than prior memory-efficient transformers ✅[^16].
3. **Expert parallelism** shards the experts of a mixture-of-experts layer across devices while the other layers are replicated, and moves tokens with all-to-all ✅[^12]; GShard's 600B-parameter model trained on 2,048 TPU v3 cores ✅[^12]. Routing is covered in `machine-learning/transformers/mixture-of-experts.md`.

## Worked example
Real DDP with the gloo backend on 2 CPU processes started by `torchrun`: the collectives, one DDP step compared with one single-process step on the full batch, and a 2-way tensor-parallel MLP. Lab run (`machine-learning/lab-setup.md`), 2026-11-24, PyTorch 2.15.0 (CPU), two runs identical, about 40 s each on this machine; launched with `GLOO_SOCKET_IFNAME=lo0` and an explicit `--master-addr=127.0.0.1`, because `--standalone` stalled on host-name lookup in this macOS sandbox ✅[^13]:

```text
== 1. Collectives on a 4-element tensor (rank r holds [r*10+1 .. r*10+4]) ==
[rank 0] all_reduce [12.0, 14.0, 16.0, 18.0] | all_gather [1.0, 2.0, 3.0, 4.0, 11.0, 12.0, 13.0, 14.0] | reduce_scatter [12.0, 14.0]
[rank 1] all_reduce [12.0, 14.0, 16.0, 18.0] | all_gather [1.0, 2.0, 3.0, 4.0, 11.0, 12.0, 13.0, 14.0] | reduce_scatter [16.0, 18.0]
== 2. DDP: each rank sees half the batch; gradients are all-reduced (averaged) ==
[rank 0] sampler indices [0, 2, 4, 6, 8, 10, 12, 14] | local batch (8, 10)
[rank 1] sampler indices [1, 3, 5, 7, 9, 11, 13, 15] | local batch (8, 10)
[rank 0] local loss 0.167396 | grad[:3] [-0.007736, 0.002019, -0.002767]
[rank 1] local loss 0.798367 | grad[:3] [-0.007736, 0.002019, -0.002767]
grads identical across ranks: True | params identical after step: True
single-process full-batch grad vs DDP grad: max diff 5.96e-08, allclose: True
== 3. Tensor parallel MLP: A split by columns, B split by rows, one all_reduce ==
[rank 0] local A (6, 4) B (4, 6) | max |split - full| 4.77e-07
[rank 1] local A (6, 4) B (4, 6) | max |split - full| 4.77e-07
```

<details><summary>Full DDP script (prints the output above)</summary>

```python
# Real DDP on CPU (gloo, 2 processes), the three collectives, and a Megatron-style split MLP.
# Run: GLOO_SOCKET_IFNAME=lo0 .venv/bin/torchrun --nnodes=1 --nproc-per-node=2 --master-addr=127.0.0.1 --master-port=29511 ddp_lab.py
import os, torch, torch.distributed as dist
from torch import nn
from torch.nn.parallel import DistributedDataParallel as DDP
from torch.utils.data import TensorDataset, DataLoader, DistributedSampler

dist.init_process_group("gloo")                      # torchrun sets RANK, WORLD_SIZE, MASTER_ADDR, MASTER_PORT
rank, world = dist.get_rank(), dist.get_world_size()
def say(*a):                                          # print in rank order
    for r in range(world):
        if r == rank: print(f"[rank {rank}]", *a, flush=True)
        dist.barrier()

torch.manual_seed(0)
X, Y = torch.randn(16, 10), torch.randn(16, 1)        # the same 16-example global batch on every rank
data = TensorDataset(X, Y)

if rank == 0: print("== 1. Collectives on a 4-element tensor (rank r holds [r*10+1 .. r*10+4]) ==", flush=True)
t = torch.arange(1.0, 5.0) + 10 * rank
a = t.clone(); dist.all_reduce(a)                                 # sum, everyone gets it
g = [torch.zeros(4) for _ in range(world)]; dist.all_gather(g, t) # everyone gets every piece
rs = torch.zeros(4 // world); dist.reduce_scatter(rs, list(t.chunk(world)))  # sum, each keeps one chunk
say("all_reduce", a.tolist(), "| all_gather", torch.cat(g).tolist(), "| reduce_scatter", rs.tolist())

if rank == 0: print("== 2. DDP: each rank sees half the batch; gradients are all-reduced (averaged) ==", flush=True)
torch.manual_seed(1 + rank)                           # different init per rank on purpose
model = DDP(nn.Sequential(nn.Linear(10, 8), nn.Tanh(), nn.Linear(8, 1)))  # constructor broadcasts rank 0's weights
sampler = DistributedSampler(data, num_replicas=world, rank=rank, shuffle=False)
loader = DataLoader(data, batch_size=8, sampler=sampler)
idx = list(sampler)
xb, yb = next(iter(loader))
say("sampler indices", idx, "| local batch", tuple(xb.shape))
opt = torch.optim.SGD(model.parameters(), lr=0.1)
loss = nn.functional.mse_loss(model(xb), yb); loss.backward()
grad = torch.cat([p.grad.flatten() for p in model.parameters()])
allg = [torch.zeros_like(grad) for _ in range(world)]; dist.all_gather(allg, grad)
opt.step()
params = torch.cat([p.detach().flatten() for p in model.parameters()])
allp = [torch.zeros_like(params) for _ in range(world)]; dist.all_gather(allp, params)
say("local loss", round(loss.item(), 6), "| grad[:3]", [round(v, 6) for v in grad[:3].tolist()])
if rank == 0:
    print("grads identical across ranks:", torch.equal(allg[0], allg[1]),
          "| params identical after step:", torch.equal(allp[0], allp[1]))
    ref = nn.Sequential(nn.Linear(10, 8), nn.Tanh(), nn.Linear(8, 1))
    ref.load_state_dict(model.module.state_dict())   # start from the same weights...
    with torch.no_grad():                             # ...undo the SGD step to get the pre-step weights
        for p, q in zip(ref.parameters(), model.module.parameters()): p.copy_(q + 0.1 * q.grad)
    nn.functional.mse_loss(ref(X), Y).backward()      # single process, full 16-example batch
    rg = torch.cat([p.grad.flatten() for p in ref.parameters()])
    print(f"single-process full-batch grad vs DDP grad: max diff {(rg - allg[0]).abs().max().item():.2e},",
          "allclose:", torch.allclose(rg, allg[0], atol=1e-6), flush=True)
dist.barrier()

if rank == 0: print("== 3. Tensor parallel MLP: A split by columns, B split by rows, one all_reduce ==", flush=True)
torch.manual_seed(2)
x, A, B = torch.randn(4, 6), torch.randn(6, 8), torch.randn(8, 6)   # same full tensors on every rank
full = torch.nn.functional.gelu(x @ A) @ B                          # unsplit layer
A_r = A.chunk(world, dim=1)[rank]                                   # columns 4r..4r+3 of A
B_r = B.chunk(world, dim=0)[rank]                                   # matching rows of B
partial = torch.nn.functional.gelu(x @ A_r) @ B_r                   # no communication until here
out = partial.clone(); dist.all_reduce(out)                         # g: sum the partial outputs
say("local A", tuple(A_r.shape), "B", tuple(B_r.shape), f"| max |split - full| {(out - full).abs().max().item():.2e}")
dist.destroy_process_group()
```

</details>

Reading it:
- **Sampler:** with `shuffle=False`, rank 0 got the even indices and rank 1 the odd ones; each trained on 8 of the 16 rows.
- **DDP:** the two local losses differ (`0.167` vs `0.798`, different data), yet the gradients are bit-identical after the all-reduce, and so are the parameters after `opt.step()`. They match a single process on all 16 rows to `5.96e-08`: the average of two 8-row mean gradients is the 16-row mean gradient.
- **Tensor parallel:** each rank held a 6 × 4 slice of `A` and a 4 × 6 slice of `B`; one all-reduce of the partial outputs rebuilt the unsplit layer to float32 rounding.

The same split done wrongly, and the bubble for a few settings (single process, two runs identical) ✅[^13]:

```text
column-then-row split: max diff 4.77e-07
row split of A, GeLU before summing: max diff 4.049
== Pipeline bubble: p stages, m micro-batches ==
 p   m  v | bubble/ideal (p-1)/(v*m) | idle share of total (p-1)/(v*m+p-1)
 4   4  1 |                   0.7500 | 0.4286
 4  16  1 |                   0.1875 | 0.1579
 4  32  1 |                   0.0938 | 0.0857
 8   8  1 |                   0.8750 | 0.4667
 8  32  1 |                   0.2188 | 0.1795
 8  32  2 |                   0.1094 | 0.0986
```

<details><summary>Script for the split check and the bubble table</summary>

```python
# Why the column split must come first, and the pipeline bubble for a few settings (single process).
import torch
torch.manual_seed(2)
x, A, B = torch.randn(4, 6), torch.randn(6, 8), torch.randn(8, 6)
gelu = torch.nn.functional.gelu
full = gelu(x @ A) @ B
A1, A2 = A.chunk(2, dim=1); B1, B2 = B.chunk(2, dim=0)
col_row = gelu(x @ A1) @ B1 + gelu(x @ A2) @ B2
Ar1, Ar2 = A.chunk(2, dim=0); x1, x2 = x.chunk(2, dim=1)
row_first = gelu(x1 @ Ar1) + gelu(x2 @ Ar2)          # GeLU of partial sums != GeLU of the sum
print(f"column-then-row split: max diff {(col_row - full).abs().max().item():.2e}")
print(f"row split of A, GeLU before summing: max diff {(row_first @ B - full).abs().max().item():.3f}")
print("== Pipeline bubble: p stages, m micro-batches ==")
print(" p   m  v | bubble/ideal (p-1)/(v*m) | idle share of total (p-1)/(v*m+p-1)")
for p, m, v in [(4, 4, 1), (4, 16, 1), (4, 32, 1), (8, 8, 1), (8, 32, 1), (8, 32, 2)]:
    r = (p - 1) / (v * m)
    print(f"{p:2d} {m:3d} {v:2d} | {r:24.4f} | {(p - 1) / (v * m + p - 1):.4f}")
```

</details>

Worked numbers: 4 stages with 4 micro-batches idle `3/4` of the ideal time, 43 % of the wall clock; 16 micro-batches (`M = 4K`) bring it to 16 %; 8 stages need 32 micro-batches for 18 %, and 2 interleaved chunks per device halve that ratio again. The last column is `r/(1 + r)` for the ratio `r` in the middle column.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| No `DistributedSampler` (or no other sharding) | Every rank trains on the same examples | DDP does not shard the input ✅[^2] |
| Forgetting `sampler.set_epoch(epoch)` | The same order every epoch | The shuffle order changes only through `set_epoch` ✅[^3] |
| Dataset size not divisible by the number of ranks | Some examples repeated in an epoch (default) or the tail dropped (`drop_last=True`) | Padding to an even split ✅[^3] |
| Different random init on each rank | Harmless with DDP | Rank 0's state is broadcast ✅[^1]; lab ✅[^13] |
| Some parameters unused in a forward pass | Their gradients never become ready on their own | `find_unused_parameters=True` finds and marks them ready, at extra overhead ✅[^1] |
| Batch norm under DDP | Batch statistics per process, running statistics from rank 0 | Buffers broadcast ✅[^2]; `SyncBatchNorm` to pool them ✅[^15] |
| `ReduceOp.AVG` with gloo | Not available | NCCL only ✅[^4] |
| Expert parallelism on gloo | No `all_to_all` | Not supported by Gloo ✅[^4] |
| `torchrun --standalone` on a host whose name does not resolve | Stalled with repeated IPv6 address warnings in the lab | Fixed by `--master-addr=127.0.0.1` and `GLOO_SOCKET_IFNAME=lo0` on this machine ✅[^13] |
| Few micro-batches in a pipeline | Devices mostly idle (75 % of ideal time at `p = m = 4`) | Bubble `(p − 1)/m` ✅[^10]; lab ✅[^13] |
| Tensor parallelism across servers | Slow | Communication in every layer; kept within a server ✅[^10] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| DDP | Simple; all-reduce overlaps backward ✅[^1] | Full model, gradients and optimizer state on every device ✅[^6] |
| ZeRO-1/2 | 4× / 8× less model-state memory at the same `2Ψ` communication ✅[^6] | Still a full parameter copy per device ✅[^6] |
| ZeRO-3 / FSDP | Memory falls linearly with devices ✅[^6]; parameters gathered only while needed ✅[^7] | 1.5× communication ✅[^6]; extra all-gathers in backward unless `reshard_after_forward=False` ✅[^7] |
| Tensor parallelism | Splits each layer's weights across devices, for models too big for one device ✅[^8] | Four all-reduces per transformer layer ✅[^8]; needs fast links ✅[^10] |
| Pipeline parallelism | Scales models across servers ✅[^10] | Bubble `(p − 1)/m` ✅[^10]; interleaving cuts it but multiplies communication ✅[^10] |
| Expert parallelism | Experts too large to replicate are sharded ✅[^12] | All-to-all traffic ✅[^12] |

## Takeaways
- Use `DistributedSampler` with every DDP data loader and call `set_epoch()` each epoch. [rule-candidate]
- Check a new DDP setup once: gradients equal across ranks after backward, and equal to a single-process full-batch gradient within float32 tolerance.
- Pick in this order: data parallelism while the model fits; FSDP/ZeRO when model state does not; tensor parallelism inside a server for layers that do not fit; pipeline across servers, with at least about 4 micro-batches per stage. [rule-candidate]
- Read communication cost as all-reduce = reduce-scatter + all-gather; ZeRO-3/FSDP pays about one extra all-gather of the parameters.

## Verification status
- Verified: 85 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- [Distributed Data Parallel](https://docs.pytorch.org/docs/2.15/notes/ddp.html) — PyTorch, 2026 (2.15), design notes. Backs: rank 0 broadcast, Reducer, buckets in reverse parameter order, one hook per parameter, asynchronous all-reduce per bucket, overlap with backward, identical `.grad`, `find_unused_parameters`. [^1]
- [DistributedDataParallel](https://docs.pytorch.org/docs/2.15/generated/torch.nn.parallel.DistributedDataParallel.html) — PyTorch, 2026 (2.15), `torch.nn.parallel.DistributedDataParallel`. Backs: averaged gradients, `M` times smaller gradient note, 25 MiB default bucket, input not sharded, `DistributedSampler`, `no_sync`, buffers broadcast from rank 0. [^2]
- [torch.utils.data](https://docs.pytorch.org/docs/2.15/data.html) — PyTorch, 2026 (2.15), the `DistributedSampler` section. Backs: exclusive subsets, shuffle default, `set_epoch`, padding vs `drop_last`. [^3]
- [Distributed communication package - torch.distributed](https://docs.pytorch.org/docs/2.15/distributed.html) — PyTorch, 2026 (2.15). Backs: NCCL for GPU and Gloo for CPU, Gloo support for `reduce_scatter` and not `all_to_all`, `AVG` NCCL-only, `env://` variables. [^4]
- [Collective Operations](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/usage/collectives.html) — NVIDIA, living, NCCL user guide. Backs: definitions of all-reduce, reduce, broadcast, all-gather, reduce-scatter, all-to-all; reduce-scatter + all-gather = all-reduce. [^5]
- [ZeRO: Memory Optimizations Toward Training Trillion Parameter Models](https://arxiv.org/abs/1910.02054) — Rajbhandari, Rasley, Ruwase, He, 2020 (full text read on ar5iv). Backs: 16 bytes per parameter, 120 GB at 7.5B, the three stages and their memory and communication, `2Ψ` all-reduce volume. [^6]
- [torch.distributed.fsdp.fully_shard](https://docs.pytorch.org/docs/2.15/distributed.fsdp.fully_shard.html) — PyTorch, 2026 (2.15). Backs: sharding parameters, gradients and optimizer state; DTensor on dim 0; all-gather before, free after, reduce-scatter of gradients; `reshard_after_forward`. [^7]
- [Megatron-LM: Training Multi-Billion Parameter Language Models Using Model Parallelism](https://arxiv.org/abs/1909.08053) — Shoeybi et al., 2019 (full text read on ar5iv). Backs: column then row split, `f` and `g`, two all-reduces each way per layer, head-wise attention split, 8 GPUs per group. [^8]
- [GPipe: Efficient Training of Giant Neural Networks using Pipeline Parallelism](https://arxiv.org/abs/1811.06965) — Huang et al., 2019 (full text read on ar5iv). Backs: micro-batches, synchronous update, re-materialization, `(K − 1)/(M + K − 1)`, negligible at `M ≥ 4K`. [^9]
- [Efficient Large-Scale Language Model Training on GPU Clusters Using Megatron-LM](https://arxiv.org/abs/2104.04473) — Narayanan et al., 2021 (full text read on ar5iv). Backs: bubble `(p − 1)/m`, 1F1B memory, interleaved `1/v`, tensor parallel within a server and pipeline across. [^10]
- [Reducing Activation Recomputation in Large Transformer Models](https://arxiv.org/abs/2205.05198) — Korthikanti et al., 2022 (full text read on ar5iv). Backs: sequence parallelism, same communication, about 5× less activation memory. [^11]
- [GShard: Scaling Giant Models with Conditional Computation and Automatic Sharding](https://arxiv.org/abs/2006.16668) — Lepikhin et al., 2020 (full text read on ar5iv). Backs: experts sharded and other layers replicated, all-to-all, 600B on 2,048 TPU v3 cores. [^12]
- `machine-learning/lab-setup.md` — the lab where the 2-process gloo DDP run, the tensor-parallel check and the bubble table ran on 2026-11-24. [^13]
- [torchrun (Elastic Launch)](https://docs.pytorch.org/docs/2.15/elastic/run.html) — PyTorch, 2026 (2.15). Backs: `--nproc-per-node`, the environment variables set for workers. [^14]
- [SyncBatchNorm](https://docs.pytorch.org/docs/2.15/generated/torch.nn.SyncBatchNorm.html) — PyTorch, 2026 (2.15), `torch.nn.SyncBatchNorm`. Backs: statistics over all mini-batches of the process group, `convert_sync_batchnorm` before wrapping in DDP, DDP with one GPU per process only. [^15]
- [Ring Attention with Blockwise Transformers for Near-Infinite Context](https://arxiv.org/abs/2310.01889) — Liu, Zaharia, Abbeel, 2023 (full text read on arXiv HTML, v4). Backs: block-wise attention across devices, key-value blocks passed around a ring and overlapped with computation, the block-size condition for no overhead, sequences up to device-count times longer than prior memory-efficient transformers. [^16]

## Related
- `machine-learning/deep-learning/mixed-precision-and-memory-saving.md` — what fills one device's memory, and accumulation with `no_sync`.
- `machine-learning/transformers/mixture-of-experts.md` — the expert layers that expert parallelism shards.
- `machine-learning/deep-learning/optimizers-and-learning-rate-schedules.md` — the optimizer state that ZeRO shards.
- `machine-learning/deep-learning/normalization-and-dropout.md` — batch statistics, which DDP keeps per process.
- `machine-learning/ml-systems/reproducibility-and-determinism.md` — reduction order and run-to-run differences.
- `machine-learning/transformers/pretraining-and-scaling-laws.md` — the compute budgets that need these methods.
- `performance/accelerator-data-and-cost.md` — measuring communication and time to quality.
