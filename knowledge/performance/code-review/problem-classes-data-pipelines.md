---
schema: knowledge-doc/v1
type: reference
topic: performance/code-review
status: verified
applies-to: ["Batch and analytical data processing in SQL engines, pandas, Polars, DuckDB and Apache Spark", "pandas 3.1.1, Polars Python 2.2.0 docs, DuckDB 2.0, Apache Spark 4.3.0, PostgreSQL 19, Delta Lake 1.2.0 and 3.1.0 and later, Apache Iceberg 1.12.0, Apache Parquet docs of 2026-11-07, all read 2026-11-26"]
last-verified: 2026-11-26
last-updated: 2026-11-26
tags: [performance, code-review, data-pipelines, pandas, polars, duckdb, spark, parquet, window-functions, shuffle, sampling]
ranked-sources: true
---

# Performance problem classes for data pipelines

## Summary
**TL;DR:** Batch and analytical code has its own costly shapes: joins that multiply rows, whole files read for a few columns, thousands of tiny files, wide default column types, shuffles that move every value, exact distinct counts over huge inputs, and samples taken by sorting everything. Each has a named fix in pandas, Polars, DuckDB, Spark or SQL, and a cost a reviewer can state from the code.
**Use this when:** you review a pandas, Polars, DuckDB, Spark or SQL batch job, notebook or data model; you need the fix and the cost for a shape you spotted there.
**Not this doc:** the first catalog of 39 classes (N+1, indexes, `warehouse-query-cost`, `numeric-vectorization`, `sql-query-shape`, `full-rescan-incremental`, `top-k-selection`) → [problem-classes.md](problem-classes.md); how hash, merge and sort strategies behave when memory runs short → [../join-group-and-deduplicate-under-memory-pressure.md](../join-group-and-deduplicate-under-memory-pressure.md); query plans and database tuning → [../database-query-performance.md](../database-query-performance.md); skew, partitions and cost on clusters and accelerators → [../accelerator-data-and-cost.md](../accelerator-data-and-cost.md).

## Scope
The domain is code that reads a large dataset, transforms it and writes a result: DataFrame code (pandas, Polars), embedded analytical SQL (DuckDB), distributed jobs (Apache Spark) and SQL run in batch (PostgreSQL 19 and others). Covered: seven classes that pass the admission test of [problem-classes.md](problem-classes.md) and are not among its 39. Not covered: query cost in a cloud warehouse (`warehouse-query-cost`), Python loops over rows (`numeric-vectorization`), a lazy dataset computed again without `cache` or `persist` (the language-runtimes catalog), machine-learning training and inference (the machine-learning catalog), one request per small object in object storage (the network-and-delivery catalog).

**Notation**, each with one worked example:

| Symbol | Meaning | Worked example |
|---|---|---|
| n, m | Rows in the left and right input | `orders` has n = 10,000,000 rows, `payments` has m = 12,000,000 |
| d | Rows that share one join key on one side | Key `customer_id = 7` has d = 1,000 rows in each input, so that key alone yields 1,000 × 1,000 = 1,000,000 joined rows |
| c | Columns in a file; c' the columns the code uses | A CSV with c = 120 columns, of which the job uses c' = 4 |
| F | Files in a table or folder | 50,000 files of 2 MB each, against 800 files of 128 MB for the same 100 GB |
| K | Distinct keys | 1,000 distinct `country` values in 1,000,000,000 sales rows |
| P | Partitions (Spark tasks) on the map side of a shuffle | 2,000 input partitions; with K = 1,000 keys, partial sums per partition are at most 2,000 × 1,000 = 2,000,000 records |
| w | Rows in one window partition | One sensor with w = 10,000 readings: a self-join on `b.ts <= a.ts` makes 10,000 × 10,001 / 2 = 50,005,000 pairs |
| p | Sample fraction | p = 1 %: about 100,000 rows of a 10,000,000-row table |

**Terms:**

| Term | Plain meaning | Analogy | Concrete example |
|---|---|---|---|
| Shuffle | Moving rows between workers so that rows with the same key end up together | Sorting mail by postcode at a central depot before delivery | `groupByKey()` in Spark sends every `(key, value)` pair across the network |
| Combiner (map-side aggregation) | Pre-aggregating on each worker before the shuffle | Each shop counts its own sales before phoning one total to head office | `reduceByKey(add)` sums per partition first |
| Projection pushdown | Reading only the columns a query uses | Photocopying 4 columns of a ledger, not all 120 | `pl.scan_parquet(p).select("a", "b")` |
| Predicate pushdown | Applying a filter while reading, so skipped data is never loaded | Asking the archive for only the 2025 boxes | `pl.scan_parquet(p).filter(pl.col("year") == 2025)` |
| Row group | A horizontal slice of a Parquet file holding one chunk per column | A chapter of a book where each column is a separate section | A 1 GB file split into 8 row groups of about 128 MB |
| Compaction | Rewriting many small files into fewer large ones | Merging 50 half-empty folders into 2 full ones | Delta Lake `OPTIMIZE`, Iceberg `rewriteDataFiles` |
| Window function | A calculation over rows related to the current row that keeps every row | A running balance column on a bank statement | `sum(amount) OVER (PARTITION BY account ORDER BY ts)` |
| HyperLogLog | A small fixed-shape sketch that estimates how many distinct values were seen | Estimating a crowd from a sample of faces instead of listing every name | `approx_count_distinct(user_id)` |

## Catalog

**Joins and reads**

| Class | Signals in code | Fix | Before → after | Check |
|---|---|---|---|---|
| `join-row-explosion` | `merge` or `join` on a key that is not unique on either side; a join condition missing a key column; `FROM a, b` with the condition forgotten; `DISTINCT` or `drop_duplicates()` right after a join; row count after a join larger than the left input | Make the key unique first (aggregate or deduplicate the right side), join on the full key; assert cardinality with pandas `merge(validate="one_to_one"` / `"many_to_one")` or Polars `join(validate="m:1")`; drop the `DISTINCT` once the join is right | Output rows Σ over keys of d_left × d_right → at most n. Duplicate keys on both sides give the Cartesian product of the matching rows and can cause a memory overflow (pandas 3.1.1) ✅[^pandas-merging]; a missing condition is a cross join of N × M rows (PostgreSQL 19) ✅[^pg-tablexpr]; `validate` checks key uniqueness before the merge and raises `MergeError` (pandas 3.1.1) ✅[^pandas-merging]; `many_to_many` does no check ✅[^pandas-merge]; Polars defaults to `m:m` with no check ✅[^polars-join] | Row counts before and after the join; `indicator=True` adds a `_merge` column showing each row's source ✅[^pandas-merge]; count keys with more than one row on each side |
| `unpruned-file-read` | `read_csv` / `read_json` of a large file followed by `df[["a", "b"]]` or a filter; `pd.read_parquet(path)` with no `columns=`; Polars `read_*` where `scan_*` fits; a CSV or JSON kept as the storage format of a table read every run | A columnar format (Parquet) plus column and row pruning at read: pandas `columns=`, `usecols=`, `filters=`; Polars `scan_parquet` with `select` and `filter`; DuckDB `SELECT a, b FROM 'x.parquet' WHERE …` | Bytes read: all c columns of all rows → c' columns of the row groups that can match. Parquet is column-oriented ✅[^parquet-overview], and each row group holds one contiguous chunk per column ✅[^parquet-concepts]; DuckDB 2.0 reads only the columns a query needs, and can skip parts of a file with zonemaps when the file has them ✅[^duckdb-parquet]; Polars pushes projections and predicates to the scan level ✅[^polars-opt]; pandas 3.1.1: `columns` used about 1/10 of the memory in the page's example, and `read_csv` takes `usecols` ✅[^pandas-scale] | Bytes or row groups read per run; Polars `explain()` or DuckDB `EXPLAIN` shows the columns and filters inside the scan; equal results on a sample |
| `small-file-overhead` | a writer that appends one file per micro-batch, per task or per input file; `partitionBy` on a high-cardinality column; a table folder with tens of thousands of files of a few MB; no compaction job | Compact: Delta Lake `OPTIMIZE` (1.2.0 and later), auto compaction or optimized writes (3.1.0 and later), Iceberg `rewriteDataFiles`; size output with Spark `COALESCE`, `REPARTITION` or `REBALANCE` hints; partition on low-cardinality columns | File opens and metadata entries O(F) → O(total bytes / target file size). Iceberg 1.12.0: small files cause unnecessary metadata and less efficient queries from file open costs, and `rewriteDataFiles` combines them ✅[^iceberg-maint]; Delta Lake compaction coalesces small files to speed reads and changes no data ✅[^delta-opt]; Spark 4.3.0 estimates the cost of opening a file as 4 MB of scan time by default (`spark.sql.files.openCostInBytes`, used when packing files into partitions of file-based sources) ✅[^spark-tuning]; its coalesce hints reduce the number of output files ✅[^spark-tuning] | Count files and their median size per table or partition; files listed and opened in the scan's metrics |
| `dataframe-dtype-waste` | `memory_usage(deep=True)` dominated by text columns; low-cardinality strings in `object` dtype; 64-bit integers or floats for small ranges; `astype(object)`; pandas older than 3.0, or 3.x without PyArrow | `astype("category")` for low-cardinality text; `pd.to_numeric(..., downcast=…)`; the `str` dtype backed by PyArrow; set `dtype=` at read time | Bytes per value: one Python object per row → one small integer code per row plus each distinct value once. Default pandas types are not the most memory efficient, especially for low-cardinality text ✅[^pandas-scale]; a `Categorical` stores each value once with integer codes ✅[^pandas-scale]; its memory is proportional to the number and size of categories plus the length, while `object` is the object size times the length ✅[^pandas-cat]; pandas 3.0 makes a new string dtype the default and uses PyArrow when installed, falling back to object storage otherwise ✅[^pandas-migration] | `df.memory_usage(deep=True)` before and after ✅[^pandas-scale]; equal results of the job's aggregates |

**Aggregation and sampling**

| Class | Signals in code | Fix | Before → after | Check |
|---|---|---|---|---|
| `shuffle-heavy-aggregation` | `groupByKey()` followed by `mapValues(sum)` or `len`; collecting values per key to aggregate them; `repartition(n)` only to reduce partitions before a write | `reduceByKey`, `aggregateByKey` or the DataFrame `groupBy().agg()`; `coalesce(n)` to reduce partitions | Records shuffled: all n values → at most P × K partial results. Spark 4.3.0: for an aggregation per key, `reduceByKey` or `aggregateByKey` "will yield much better performance" ✅[^spark-rdd]; `reduceByKey` merges locally on each mapper before sending results, like a combiner ✅[^pyspark-rbk], while `groupByKey` gathers all values per key into one sequence ✅[^pyspark-gbk]; a shuffle involves disk I/O, serialization and network I/O ✅[^spark-rdd]; `repartition` always shuffles all data, `coalesce` decreases partitions ✅[^spark-rdd] | Shuffle write bytes and records for the stage in the Spark UI; equal aggregates |
| `exact-distinct-count` | `count(DISTINCT user_id)` or `nunique()` over billions of rows for a dashboard or a monitor; many exact distinct counts in one query; distinct counts recomputed per time bucket | `approx_count_distinct` (Spark, DuckDB), `APPROX_COUNT_DISTINCT` (BigQuery), mergeable HyperLogLog sketches stored per bucket | Memory O(K) for the set of seen values → a bounded sketch, with a stated error. Approximate aggregates suit streams "for which linear memory usage is impractical", and are less accurate than `COUNT(DISTINCT)` but perform better on very large input (BigQuery) ✅[^bq-approx]; Spark uses HyperLogLog++ with a maximum relative standard deviation, 0.05 by default ✅[^spark-agg]; DuckDB 2.0 uses HyperLogLog ✅[^duckdb-agg]; an Apache DataSketches HLL sketch at lgK = 14 has a relative standard error of 0.0065 ✅[^datasketches-hll] | Peak memory of the aggregate at two input sizes; relative error against the exact count on one day of data |
| `full-scan-sampling` | `ORDER BY random() LIMIT k`; `df.sample(frac=…)` right after loading the whole table; a sample taken by sorting on a hash | PostgreSQL `TABLESAMPLE SYSTEM (p)`; DuckDB `USING SAMPLE p%` (system) or a row-count sample (reservoir); sample at the source, before the load | Rows read: all n plus a random value per row → about p · n from p of the blocks. In PostgreSQL 19, `BERNOULLI` scans the whole table, while `SYSTEM` samples whole blocks and is significantly faster at small percentages ✅[^pg-select]; DuckDB 2.0 system sampling keeps each vector with the sampling probability, a form of cluster sampling, and is the default for a percentage ✅[^duckdb-samples]; sampling can significantly speed up queries at the expense of accuracy ✅[^duckdb-sample] | Rows or blocks read in the plan; the sample's distribution against the full table on the key columns |

## Lookup notes

**Not a problem when**

| Class | Not a problem when |
|---|---|
| `join-row-explosion` | The many-to-many result is the intended output (every order line against every promotion that applies); one side is known unique by a primary key or a constraint; `DISTINCT` removes true duplicates that come from the source, not from the join |
| `unpruned-file-read` | The file is small (a lookup CSV of a few MB); the job really uses every column; the file is read once to convert it to Parquet; the reader cannot prune that format anyway, and pandas states that not every format offers a column subset ✅[^pandas-scale] |
| `small-file-overhead` | The table has few files in total (hundreds); files are small because the table is small; a streaming sink that writes small files already has compaction scheduled; the engine merges small files at read time and the scan metrics show the open cost is minor |
| `dataframe-dtype-waste` | The frame is small; the column has nearly as many distinct values as rows, where a `Categorical` can use as much memory as `object` or more ✅[^pandas-cat]; pandas 3.x with PyArrow already stores text in the `str` dtype ✅[^pandas-migration]; downcasting would overflow future values |
| `shuffle-heavy-aggregation` | The job needs the full list of values per key (a median over all values, a per-key export); keys are almost all distinct, so a combiner saves little; the DataFrame or SQL API is used, whose `groupBy().agg()` the optimizer already plans |
| `exact-distinct-count` | The count is billed, audited or compared exactly (invoices, deduplication checks); K is small and bounded; the error bound is not acceptable for the decision the number feeds |
| `full-scan-sampling` | The table is small; DuckDB 2.0 says system sampling is not suitable for datasets with fewer than about 10k rows ✅[^duckdb-samples]; the sample must be as random as row-by-row sampling, and `SYSTEM` may return a less-random sample because of clustering effects ✅[^pg-select]; k rows are needed exactly and reproducibly |

**Belongs to an existing class**
- Sorting a whole dataset to take the top k rows or the first row per group: `top-k-selection` in [problem-classes.md](problem-classes.md). A sort is still needed for a window over an ordered partition.
- Loading data larger than memory in one piece (`pd.read_csv(path)` with no `chunksize`, Polars `read_*` with no `scan_*` and streaming): `allocation-gc` ("whole inputs held in memory; stream or chunk"). The data-pipeline signals are named here, the class adds no new cost shape. pandas 3.1.1 notes that peak memory is the largest chunk, that `read_csv` takes `chunksize`, and that `groupby` is much harder to do chunkwise ✅[^pandas-scale]; Polars' streaming engine (`collect(engine="streaming")`) processes data in batches for datasets that do not fit in memory ✅[^polars-streaming]. When the read is also unpruned, report `unpruned-file-read` first.
- Spark `collect()`, non-broadcast or skewed joins, Python row UDFs, BigQuery `SELECT *` and missing partition filters: `warehouse-query-cost`.
- pandas `iterrows`, `apply(axis=1)`, Polars `map_elements`, `concat` per row: `numeric-vectorization`.
- "Latest row per key" written as a correlated subquery per row, `NOT IN (SELECT …)`, `UNION` of disjoint branches: `sql-query-shape`.
- Reprocessing all history each run: `full-rescan-incremental`.
- A lazy Spark or Polars plan run twice without `cache` / `persist`: owned by the language-runtimes catalog.
- A running total, rank, moving average or "previous row" computed by joining a table to itself on `b.ts <= a.ts`, or by a correlated subquery per row → `sql-query-shape` (per-row subqueries; its fix names window functions), the SQL form of `range-query`. The fix is a window function: `sum(x) OVER (PARTITION BY k ORDER BY ts)`, `row_number()`, `rank()`, `lag()`; pandas `groupby().cumsum()`, `rank()`, `shift()`. Cost, by arithmetic: w(w + 1)/2 pairs per partition → w rows read once after a sort. Window functions keep every row ✅[^pg-tutorial-window]; with `ORDER BY` the default frame runs from the partition start to the current row and its peers, which is a running sum ✅[^pg-tutorial-window]; computing such aggregates with correlated subqueries gives quadratic complexity in most engines ✅[^leis-window]; DuckDB 2.0's `QUALIFY` filters window results with no subquery ✅[^duckdb-qualify]. Not a problem when partitions hold a few rows, or when the join is an equality join on a grouped maximum for the latest row per key (see the corrections below).
- **Boundaries with the first catalog.** `unpruned-file-read` is about files (their format and what the reader pushes down), not `SELECT *` on a database (`payload-overfetch`) or on a warehouse (`warehouse-query-cost`). `full-scan-sampling` reads fewer rows, where `top-k-selection` still reads every row. `exact-distinct-count` trades an exact answer for an estimate with a stated error, where `sql-query-shape` drops or estimates a row total.

**Corrections found while checking the sources (2026-11-26)**
- A self-join is not always slower than a window function. DuckDB's 2021 windowing post reports that for the last value per group, a join query was over 20 times faster than the window query on a user's own data set; the post gives no DuckDB version or data size, and one blog example is not a general ratio ✅[^duckdb-windowing]. The quadratic shape is the inequality self-join for running values, not the equality join on a grouped maximum.
- A window function is not automatically linear. Leis et al. (VLDB 2015) show the naive frame algorithm is quadratic for many queries, and the cumulative algorithm, which they say PostgreSQL uses (they tested PostgreSQL 9.4, not a current version), is quadratic for frames that both grow and shrink, such as `ROWS BETWEEN 5 PRECEDING AND 5 FOLLOWING`; a segment tree avoids it in all cases ✅[^leis-window]. The cumulative algorithm works well as long as the frame only grows, such as a running total from the partition start ✅[^leis-window]; this paper says nothing about PostgreSQL 19.
- The default frame with `ORDER BY` is `RANGE UNBOUNDED PRECEDING`, so peer rows with equal `ORDER BY` values are summed together; write `ROWS` to get a strictly row-by-row running total (PostgreSQL 19) ✅[^pg-syntax-window]. A rewrite from a `<=` self-join keeps the peers, one from `<` does not.
- `object` dtype for strings is no longer the pandas default: since pandas 3.0 the default is the `str` dtype, backed by PyArrow when installed ✅[^pandas-migration]. The `object` signal applies to pandas before 3.0, to frames without PyArrow, and to explicit `astype(object)`.
- pandas `read_parquet(filters=…)` filters rows only with `engine="pyarrow"`; other engines skip row groups and files only ✅[^pandas-readparquet].
- Polars `join(validate=…)` is not supported by the streaming engine ✅[^polars-join].
- The pandas scaling page says its dtype changes cut memory to 1/5, while the ratio it prints is 0.42 ✅[^pandas-scale]. The pandas categorical page warns that a `Categorical` can use as much memory as `object` when categories approach the length, but its own 2,000-unique-value example is still about three times smaller ✅[^pandas-cat].

**What the sources do not say**
- No official page read says what file size is ideal. Spark's `spark.sql.files.maxPartitionBytes` (128 MB in 4.3.0) is how many bytes one read partition packs, not a file-size target ✅[^spark-tuning]. Delta Lake's page gives a default target of 128 MB only for auto compaction ✅[^delta-opt]; the Iceberg page shows 500 MB only as an example value ✅[^iceberg-maint].
- The two Parquet pages cited here (overview, concepts) do not describe skipping by minimum and maximum statistics; the skipping claim here rests on DuckDB's zonemaps, which depend on the file containing them ✅[^duckdb-parquet].
- The Delta Lake page says compaction speeds reads; it does not say why small files are slow. The why (metadata and open cost) comes from the Iceberg page ✅[^iceberg-maint].
- The DataSketches HLL page says the sketch grows until the full HLL array is allocated, and states no byte size independent of the distinct count ✅[^datasketches-hll].
- The PostgreSQL 19 `EXPLAIN` pages read do not mention a bounded "top-N" sort for `ORDER BY … LIMIT`; whether `ORDER BY random() LIMIT k` sorts all rows or keeps k is not settled here. Either way every row is read and given a random value.

**Calibration state (2026-11-26).** None of these classes has a sample in the review-agent calibration, and the agent's index does not list them: see [perf-reviewer-calibration.md](perf-reviewer-calibration.md). Whether a reviewer, person or agent, finds them from this catalog has not been measured.

## Takeaways
- After every join on a key not proven unique, compare row counts before and after; a `DISTINCT` right after a join is a signal, not a fix. [rule-candidate]
- Read only the columns and rows the job needs, from a columnar format, and keep file counts bounded by compaction. [rule-candidate]
- Aggregate before moving data: a combiner (`reduceByKey`), a window function instead of an inequality self-join, a sketch instead of an exact distinct set when an error bound is acceptable.
- Each finding here still needs the sizes from the workload (d, w, F, K); with small or bounded sizes, the "Not a problem when" table applies.

## Verification status
- Verified: 58 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-26

## References
- [pandas.merge](https://pandas.pydata.org/docs/reference/api/pandas.merge.html) — pandas, 3.1.1. Rank 1. Backs: Catalog, join-row-explosion. [^pandas-merge]
- [Merge, join, concatenate and compare](https://pandas.pydata.org/docs/user_guide/merging.html) — pandas, 3.1.1. Rank 1. Backs: Catalog, join-row-explosion. [^pandas-merging]
- [polars.DataFrame.join](https://docs.pola.rs/api/python/stable/reference/dataframe/api/polars.DataFrame.join.html) — Polars, Python 2.2.0. Rank 1. Backs: Catalog, join-row-explosion; Lookup notes. [^polars-join]
- [Table Expressions (cross join)](https://www.postgresql.org/docs/current/queries-table-expressions.html) — PostgreSQL Global Development Group, 19. Rank 1. Backs: Catalog, join-row-explosion. [^pg-tablexpr]
- [Apache Parquet overview](https://parquet.apache.org/docs/overview/) — Apache Parquet, living (modified 2026-11-07). Rank 1. Backs: Catalog, unpruned-file-read. [^parquet-overview]
- [Parquet concepts](https://parquet.apache.org/docs/concepts/) — Apache Parquet, living (modified 2026-11-07). Rank 1. Backs: Catalog, unpruned-file-read. [^parquet-concepts]
- [Reading and writing Parquet files](https://duckdb.org/docs/2.0/data/parquet/overview.html) — DuckDB, 2.0. Rank 1. Backs: Catalog, unpruned-file-read; Lookup notes. [^duckdb-parquet]
- [Polars: Optimizations](https://docs.pola.rs/user-guide/lazy/optimizations/) — Polars user guide, living. Rank 1. Backs: Catalog, unpruned-file-read. [^polars-opt]
- [Polars: Streaming](https://docs.pola.rs/user-guide/concepts/streaming/) — Polars user guide, living. Rank 1. Backs: Lookup notes, allocation-gc. [^polars-streaming]
- [Scaling to large datasets](https://pandas.pydata.org/docs/user_guide/scale.html) — pandas, 3.1.1. Rank 1. Backs: Catalog, unpruned-file-read and dataframe-dtype-waste; Lookup notes. [^pandas-scale]
- [pandas.read_parquet](https://pandas.pydata.org/docs/reference/api/pandas.read_parquet.html) — pandas, 3.1.1. Rank 1. Backs: Lookup notes. [^pandas-readparquet]
- [Categorical data](https://pandas.pydata.org/docs/user_guide/categorical.html) — pandas, 3.1.1. Rank 1. Backs: Catalog, dataframe-dtype-waste; Lookup notes. [^pandas-cat]
- [Migration guide for the new string data type](https://pandas.pydata.org/docs/user_guide/migration.html) — pandas, 3.x (3.1.1 docs). Rank 1. Backs: Catalog, dataframe-dtype-waste; Lookup notes. [^pandas-migration]
- [Maintenance](https://iceberg.apache.org/docs/latest/maintenance/) — Apache Iceberg, 1.12.0. Rank 1. Backs: Catalog, small-file-overhead; Lookup notes. [^iceberg-maint]
- [Optimizations](https://docs.delta.io/latest/optimizations-oss.html) — Delta Lake, 1.2.0 and 3.1.0 and later. Rank 1. Backs: Catalog, small-file-overhead. [^delta-opt]
- [Spark SQL performance tuning](https://spark.apache.org/docs/latest/sql-performance-tuning.html) — Apache Spark, 4.3.0. Rank 1. Backs: Catalog, small-file-overhead; Lookup notes. [^spark-tuning]
- [RDD Programming Guide](https://spark.apache.org/docs/latest/rdd-programming-guide.html) — Apache Spark, 4.3.0. Rank 1. Backs: Catalog, shuffle-heavy-aggregation. [^spark-rdd]
- [pyspark.RDD.reduceByKey](https://spark.apache.org/docs/latest/api/python/reference/api/pyspark.RDD.reduceByKey.html) — Apache Spark, PySpark 4.3.0. Rank 1. Backs: Catalog, shuffle-heavy-aggregation. [^pyspark-rbk]
- [pyspark.RDD.groupByKey](https://spark.apache.org/docs/latest/api/python/reference/api/pyspark.RDD.groupByKey.html) — Apache Spark, PySpark 4.3.0. Rank 1. Backs: Catalog, shuffle-heavy-aggregation. [^pyspark-gbk]
- [Tutorial: Window Functions](https://www.postgresql.org/docs/current/tutorial-window.html) — PostgreSQL Global Development Group, 19. Rank 1. Backs: Lookup notes, the window-function sub-case of sql-query-shape. [^pg-tutorial-window]
- [Value Expressions: Window Function Calls](https://www.postgresql.org/docs/current/sql-expressions.html) — PostgreSQL Global Development Group, 19. Rank 1. Backs: Lookup notes. [^pg-syntax-window]
- [QUALIFY Clause](https://duckdb.org/docs/2.0/sql/query_syntax/qualify.html) — DuckDB, 2.0. Rank 1. Backs: Lookup notes, the window-function sub-case of sql-query-shape. [^duckdb-qualify]
- [Aggregate functions (approx_count_distinct)](https://spark.apache.org/docs/latest/api/sql/agg-functions/) — Apache Spark, function since 1.6.0. Rank 1. Backs: Catalog, exact-distinct-count. [^spark-agg]
- [Aggregate Functions](https://duckdb.org/docs/2.0/sql/functions/aggregates.html) — DuckDB, 2.0. Rank 1. Backs: Catalog, exact-distinct-count. [^duckdb-agg]
- [Approximate aggregate functions](https://docs.cloud.google.com/bigquery/docs/reference/standard-sql/approximate_aggregate_functions) — Google Cloud, BigQuery, living. Rank 1. Backs: Catalog, exact-distinct-count. [^bq-approx]
- [HyperLogLog Sketches Overview](https://datasketches.apache.org/docs/HLL/HllSketches.html) — Apache DataSketches, 2025. Rank 1. Backs: Catalog, exact-distinct-count; Lookup notes. [^datasketches-hll]
- [SELECT (TABLESAMPLE)](https://www.postgresql.org/docs/current/sql-select.html) — PostgreSQL Global Development Group, 19. Rank 1. Backs: Catalog, full-scan-sampling; Lookup notes. [^pg-select]
- [Samples](https://duckdb.org/docs/2.0/sql/query_syntax/samples.html) — DuckDB, 2.0. Rank 1. Backs: Catalog, full-scan-sampling; Lookup notes. [^duckdb-samples]
- [SAMPLE Clause](https://duckdb.org/docs/2.0/sql/query_syntax/sample) — DuckDB, 2.0. Rank 1. Backs: Catalog, full-scan-sampling. [^duckdb-sample]
- [Efficient Processing of Window Functions in Analytical SQL Queries](https://www.vldb.org/pvldb/vol8/p1058-leis.pdf) — Leis, Kundhikanjana, Kemper and Neumann, PVLDB 8(10), 2015. Rank 2. Backs: Lookup notes. [^leis-window]
- [Windowing in DuckDB](https://duckdb.org/2021/10/13/windowing.html) — Richard Wesley, DuckDB blog, 2021. Rank 4. Backs: Lookup notes, corrections. [^duckdb-windowing]

## Related
- [problem-classes.md](problem-classes.md) — the first catalog of 39 classes and the admission test these classes follow.
- [perf-reviewer-calibration.md](perf-reviewer-calibration.md) — the review agent built on the catalogs, and how it scored on known samples.
- [../join-group-and-deduplicate-under-memory-pressure.md](../join-group-and-deduplicate-under-memory-pressure.md) — hash, merge and sort strategies for joins and grouping when memory is short; duplicate-key output size.
- [../database-query-performance.md](../database-query-performance.md) — query plans, spills and database tuning.
- [../accelerator-data-and-cost.md](../accelerator-data-and-cost.md) — skew, partitions and scanned or shuffled bytes on clusters.
