---
schema: knowledge-doc/v1
type: concept
topic: go/standard-library
status: verified
applies-to: ["Go 1.27 (go1.27.4)", "sql.Null[T]: Go ≥ 1.22", "ConvertAssign, driver.RowsColumnScanner: Go ≥ 1.27", "lab driver: modernc.org/sqlite v1.63.0 (SQLite 3.54.1)"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [go, golang, database-sql, sql, connection-pool, dbstats, rows-close, transactions, prepared-statements, sql-null, sql-injection, sqlite, modernc]
ranked-sources: true
---

# Databases with database/sql

## Summary
**TL;DR:** An `*sql.DB` is a pool of database connections, not one connection: open it once, share it between goroutines, and it lends a connection to each query. `sql.Open` only checks its arguments; `PingContext` makes the first real connection. Every `*sql.Rows` keeps its connection until `rows.Close()` or the last `rows.Next()`, so a forgotten `Close` drains the pool, and once `SetMaxOpenConns` is reached the next query waits until its context ends. Pass values as placeholder arguments (`?`, or `$1` for some drivers), never with `fmt.Sprintf`, and scan nullable columns into `sql.Null[T]` (Go 1.22) or a `Null*` type.
**Use this when:** you write or review Go code that talks to a SQL (Structured Query Language) database, choose pool settings, read `db.Stats()`, see queries hang under load, get `sql: no rows in result set`, `converting NULL to string is unsupported` or `sql: transaction has already been committed or rolled back`, or check code for SQL injection.
**Not this doc:** query count, rows read and indexes → `performance/database-query-performance.md`; sizing a pool from request rate and latency → `performance/fundamentals/queueing-and-littles-law.md`; contexts and deadlines in general → `go/concurrency/context-and-cancellation.md`; blank imports and `init` order → `go/packages-modules/packages-and-initialization.md`.

## Problem
Code written in the style of other database libraries (open a connection, query, close it) misuses `database/sql` in quiet ways. A handle opened per request throws the pool away; a `rows` value returned early without `Close` keeps a connection busy; a `NULL` column makes `Scan` fail at run time; a query built with `fmt.Sprintf` lets the caller's input rewrite the SQL. Each mistake passes a one-request test. In the lab, two leaked `Rows` with `SetMaxOpenConns(2)` made the third query wait until its 200 ms deadline ✅[^1].

## Mental model
**Analogy:** `sql.DB` is the key desk of a building with meeting rooms (connections). You never keep a room yourself: you hand the desk a job, the desk lends a free room key (or builds a new room if the building allows more), and takes the key back when the job ends. A `Rows` value is a key still in your pocket: until you hand it back (`Close`, or reading the last row) nobody else can use that room. When the building has a room limit (`SetMaxOpenConns`) and every key is out, the next visitor waits at the desk, and only a watch (a context deadline) makes them give up.

**Artifact:** the handle's life in the lab, with the pool counters from `db.Stats()` after each line ✅[^1]:
```go
import (
	"database/sql"

	_ "modernc.org/sqlite" // its init function calls sql.Register("sqlite", ...)
)

db, err := sql.Open("sqlite", "/tmp/lab/app.db") // err == nil; Stats: open=0 idle=0
err = db.PingContext(ctx)                         // first connection; Stats: open=1 inUse=0 idle=1
defer db.Close()                                  // once, when the program ends
// pass db to every function and goroutine that needs the database
```

## How it works
**4 actors:**
- **Your code** — its job: ask for work, via `QueryContext`, `QueryRowContext`, `ExecContext`, `PrepareContext` and `BeginTx`, and hand connections back, via `rows.Close`, `Row.Scan`, `Commit`/`Rollback` and `Conn.Close`.
- **`database/sql`** — its job: lend, take back and retire connections, via its pool and the limits set with `SetMaxOpenConns`, `SetMaxIdleConns`, `SetConnMaxLifetime` and `SetConnMaxIdleTime`.
- **The driver** — its job: speak one database's protocol, via the `database/sql/driver` interfaces it registered under a name. Think of a travel plug adapter: `database/sql` is the same socket everywhere, and the driver fits it to one database.
- **The database** — its job: parse and run the SQL, via the driver's connection (for SQLite, a library inside the same process).

```
your code                        database/sql (pool)                      driver / database
─────────                        ───────────────────                      ─────────────────
import _ "modernc.org/sqlite" ─► Register("sqlite", d)          (at init, before main)
sql.Open("sqlite", dsn) ───────► check arguments, return *DB   (no connection yet)
db.QueryContext(ctx, q, args) ─► idle conn? ── yes ─► lend it
                                     │ no
                                     ├─ open < MaxOpen ─► d.Open(dsn) ───► open file / connect
                                     └─ open == MaxOpen ─► wait until a conn comes back or ctx ends
                                 SQL text + args sent separately ───────► prepare, bind, run
rows.Next / rows.Scan ◄──────────────────────────── one row at a time ◄─ result rows
rows.Close (or last Next) ─────► conn back to the idle list (≤ MaxIdle, default 2), else closed
```

1. **Driver (at program start):**
   - `import _ "modernc.org/sqlite"` imports the package only for its initialization ✅[^13] ✅[^14]; the guide uses this form when your code calls no function of the driver itself ✅[^5].
   - The driver's `init` function calls `sql.Register("sqlite", ...)` (line 56 of `sqlite.go` in v1.63.0) ✅[^1]. `Register` makes a driver available under a name and panics on a duplicate name or a nil driver ✅[^2]; `sql.Drivers()` printed `[sqlite]` ✅[^1]. `database/sql` must be used together with a database driver, which you import like any other Go package from the list the docs point to ✅[^2] ✅[^5].
2. **Your code → `database/sql`: open the handle.**
   - `sql.Open(driverName, dataSourceName)` may only validate its arguments without connecting; `Ping` or `PingContext` checks that a connection can be made ✅[^2] ✅[^5]. Lab: `sql.Open("sqlite", "/no/such/dir/app.db")` returned a nil error, and `PingContext` then failed with `unable to open database file (14)` ✅[^1].
   - The `*DB` is safe for concurrent use by many goroutines and keeps its own idle pool, so call `Open` once and rarely close the handle ✅[^2]. `sql.OpenDB(connector)` does the same from a driver's `driver.Connector` instead of a string ✅[^2] ✅[^5].
   - The data source name (DSN, the connection string) has a driver-specific format ✅[^5]. Keep credentials out of the source, for example in environment variables read with `os.Getenv` ✅[^5].
3. **`database/sql`: lend a connection.** A `Query` or `Exec` call takes a free connection from the pool or creates one, and puts it back when the work ends ✅[^11]. By default there is no limit on open connections (`MaxOpenConns` 0); past a limit set with `SetMaxOpenConns`, new operations wait for a connection to come back ✅[^2] ✅[^11].
4. **Driver → database: run the statement.** Placeholder syntax depends on the database and driver: the guide's examples use `?`, while the pq driver for PostgreSQL needs `$1` ✅[^6]. modernc.org/sqlite accepted `?`, `?1`, `$1` and `:cat` with `sql.Named("cat", "office")`, each query counting the same 2 rows ✅[^1]. The values travel apart from the SQL text (see SQL injection below).
5. **Your code → `database/sql`: hand the connection back.** `QueryRowContext(...).Scan` does it by itself (`InUse` was 0 right after it in the lab ✅[^1]); a `Rows` does it on `Close`, or once `Next` has returned false after the last result set, which closes the `Rows` automatically ✅[^2] ✅[^1]; a `Tx` on `Commit` or `Rollback` ✅[^2]; a dedicated `*sql.Conn` from `db.Conn(ctx)` on `Conn.Close` ✅[^2] ✅[^11].
6. **`database/sql`: keep or retire it.** Up to `MaxIdleConns` (default 2) returned connections stay idle for reuse ✅[^2]. Connections older than `SetConnMaxLifetime`, or idle longer than `SetConnMaxIdleTime`, are closed, possibly lazily before reuse ✅[^2].

### Reading rows
- **One row:** `QueryRowContext` always returns a non-nil `*Row` and keeps any error until `Scan`, which returns `sql.ErrNoRows` when nothing matched and uses only the first row when several did ✅[^2]. Lab: id 2 gave `stapler`; id 99 gave `sql: no rows in result set`, and `errors.Is(err, sql.ErrNoRows)` was true ✅[^1].
- **Many rows:** `for rows.Next() { rows.Scan(&a, &b) }`, then check `rows.Err()`: `Next` returns false both at the end and on an error, and `Err` tells the two apart ✅[^2] ✅[^6]. Every `Scan` must follow a `Next` ✅[^2]. Put `defer rows.Close()` right after the error check: reading to the end also closes `rows`, but `defer` covers every return path ✅[^6]; `Close` is idempotent ✅[^2].
- **Conversions:** `Scan` converts between string and number types when no information is lost and checks numbers for overflow ✅[^2]. Lab: `'42'` into an `int` gave 42; `300` into a `uint8` failed with `converting driver.Value type int64 ("300") to a uint8: value out of range` ✅[^1]. The number of destinations must equal the number of columns ✅[^2]; one destination for two columns gave `sql: expected 2 destination arguments in Scan, not 1` ✅[^1].

### Writing: `ExecContext` and `Result`
`ExecContext` runs a statement that returns no rows, such as `INSERT`, `UPDATE` or `DELETE` ✅[^7]. Its `sql.Result` has `LastInsertId` (typically from an auto-increment column; not every database supports it) and `RowsAffected` (not every database or driver supports it) ✅[^2]. Lab: three inserts returned ids 1, 2 and 3 with `rowsAffected=1` each, and `UPDATE product SET price = price * 0.9 WHERE category = ?` on the two office products returned `rowsAffected = 2` ✅[^1].

### Prepared statements
A prepared statement is SQL that the database parses and saves with placeholders and no values, then runs many times with different values ✅[^8]. Analogy: a printed form with blanks, filled in again for each customer. `PrepareContext` returns an `*sql.Stmt` whose `ExecContext`, `QueryContext` and `QueryRowContext` take only the values ✅[^8]. A `Stmt` is safe for concurrent use; one prepared on a `DB` prepares itself again on each new connection it needs, while one prepared on a `Tx` or `Conn` is bound to that one connection ✅[^2]. `tx.StmtContext(ctx, stmt)` gives a transaction its own copy of a `DB` statement ✅[^2] ✅[^8]. Close statements you no longer need ✅[^8]. Lab: one `Stmt` shared by 8 goroutines ran 800 lookups with no error and no report from `go run -race` ✅[^1].

### Transactions
A transaction groups several operations so that all of them succeed or none does, like a shopping basket paid in one go: either every item goes through the till (`Commit`) or the whole basket goes back on the shelf (`Rollback`).
- `BeginTx(ctx, opts)` returns an `*sql.Tx` bound to one connection; it ends with `Commit` or `Rollback`, and afterwards every operation on it fails with `sql.ErrTxDone` ✅[^2]. Statements prepared on the `Tx` close with it ✅[^2].
- Write `defer tx.Rollback()` right after `BeginTx`: after a successful `Commit` the deferred call changes nothing, and on any early return it undoes the work ✅[^9]. In the lab, an order for more stock than existed returned early, and the deferred `Rollback` undid its `UPDATE` and `INSERT`: stock stayed at 7 and the order table kept 1 row ✅[^1].
- If the context passed to `BeginTx` is cancelled, the package rolls the transaction back and `Commit` returns an error ✅[^2].
- Use these methods rather than `BEGIN` and `COMMIT` statements in SQL, and do not call `db` methods while a transaction is open: they run outside it and can deadlock ✅[^9].
- If `Commit` fails, discard every result the transaction's queries returned; after a failed `Rollback` the transaction is still neither valid nor committed ✅[^9].

### Cancellation
Each operation has a `...Context` form. A context with a timeout stops a long query, and a request context from `net/http` stops it when the client goes away ✅[^10]. Drivers that do not support context cancellation return only when the query is done ✅[^2]. Lab: a recursive common table expression (CTE, a query that refers to itself) counting to 300 million, run with a 100 ms timeout, returned after 100–102 ms (3 runs) with `context deadline exceeded`, and `Stats().InUse` was 0 right after ✅[^1].

### NULL values
SQL `NULL` means "no value", which a Go `string` or `int` cannot hold: `Scan` into a plain `string` failed with `converting NULL to string is unsupported` ✅[^1]. Scan nullable columns into a type that records validity:
- `sql.NullString`, `NullInt64`, `NullBool`, `NullFloat64`, `NullTime` and others each have a `Valid` field and a value field ✅[^2] ✅[^6].
- The generic `sql.Null[T]` (Go 1.22) has the fields `V` and `Valid`; `T` should be one of the types `driver.Value` accepts ✅[^2] ✅[^15].

Lab: a `NULL` phone and visit count scanned to `{String: Valid:false}` and `{V:0 Valid:false}`; a `*string` destination came back `nil`; passing `sql.NullString{}`, `sql.Null[int64]{}` or `nil` as an argument stored `NULL`; `COALESCE(phone, '')` in the SQL returned `""` ✅[^1].

### SQL injection
SQL injection is input that changes the meaning of the SQL itself. Placeholders prevent it because the `sql` package turns the statement into a prepared statement and sends the values separately; `fmt.Sprintf` instead pastes the value into the SQL text before the database sees it, so a caller can complete the statement in ways of their own ✅[^12]. Lab with the input `nobody' OR '1'='1` ✅[^1]:
```text
built with Sprintf: SELECT name FROM customer WHERE name = 'nobody' OR '1'='1'
  -> 3 rows                        (every customer)
placeholder ?, same input -> 0 rows
placeholder ?, DROP input -> 0 rows   (input: x'; DROP TABLE customer; --)
customers still there: 3
```

### Pool settings and `DBStats`
| Setting | Default | Effect | Lab (Go 1.27.4, modernc.org/sqlite v1.63.0) |
|---|---|---|---|
| `SetMaxOpenConns(n)` | 0, no limit ✅[^2] | Caps open connections; at the cap, operations wait as for a lock, so the program can deadlock waiting for a connection ✅[^11] | 50 leaked `Rows` with no cap left 50 open connections ✅[^1] |
| `SetMaxIdleConns(n)` | 2 ✅[^2] | Connections kept open after use; `n <= 0` keeps none; lowered to `MaxOpenConns` when that is smaller ✅[^2] | 5 connections released: 2 stayed idle, `MaxIdleClosed` = 3; `MaxIdle` 10 then `MaxOpen` 3: 3 idle ✅[^1] |
| `SetConnMaxIdleTime(d)` | off ✅[^11] | Closes connections idle longer than `d`, which releases a burst's extra connections later ✅[^11] | 200 ms: 5 idle connections gone 1.5 s later, `MaxIdleTimeClosed` = 5 ✅[^1] |
| `SetConnMaxLifetime(d)` | off ✅[^11] | Closes connections older than `d`; useful behind a load-balanced database server ✅[^11] | 300 ms: the one connection gone 1.5 s later, `MaxLifetimeClosed` = 1 ✅[^1] |

`db.Stats()` returns a `DBStats` with `OpenConnections`, `InUse`, `Idle`, `WaitCount`, `WaitDuration` and the three `...Closed` counters ✅[^2]. For this driver, the docs advise a bound: `database/sql` opens connections without limit by default, and each SQLite connection carries its own page cache ✅[^17].

### Go 1.27 driver-side additions
- `sql.ConvertAssign` gives drivers the conversions that `Rows.Scan` performs; it is meant for driver code ✅[^2] ✅[^16].
- A driver's rows may implement `driver.RowsColumnScanner` (`NextRow`, `ScanColumn`) to scan straight into the caller's variables; since Go 1.27 `database/sql` then no longer calls `Next` ✅[^3] ✅[^16]. modernc.org/sqlite v1.63.0 does not implement it (no `ScanColumn` in its source) ✅[^1].
- The Go 1.27.4 `Rows.Scan` docs list `*uuid.UUID` from the new `uuid` package as a destination, from a string or 16 bytes ✅[^2] ✅[^16]; a UUID (universally unique identifier) stored as TEXT scanned into a `uuid.UUID` in the lab ✅[^1].

## Worked example
A helper reads the first product name and returns, but never closes `rows`. The pool is capped at 2 connections (Go 1.27.4, modernc.org/sqlite v1.63.0, file database, 3 runs with the same output) ✅[^1]:
```go
func leaky(ctx context.Context, db *sql.DB) (string, error) {
	rows, err := db.QueryContext(ctx, "SELECT name FROM product ORDER BY id")
	if err != nil {
		return "", err
	}
	// BUG: no defer rows.Close()
	if !rows.Next() {
		return "", rows.Err()
	}
	var name string
	err = rows.Scan(&name)
	return name, err // returns with rows still open
}
```

| Step | Call | Result | `db.Stats()` after ✅[^1] |
|---|---|---|---|
| 0 | create and fill the table, `db.SetMaxOpenConns(2)` | — | open=1 inUse=0 idle=1 |
| 1 | `leaky(ctx, db)` | `pen <nil>` | open=1 inUse=1 idle=0 |
| 2 | `leaky(ctx, db)` | `pen <nil>` | open=2 inUse=2 idle=0 |
| 3 | `leaky` with a 200 ms context | `context deadline exceeded` after 200 ms | open=2 inUse=2 waitCount=1 |
| 4 | new handle, same query with `defer rows.Close()`, 3 calls | `pen <nil>` ×3 | open=1 inUse=0 idle=1 |
| 5 | `for rows.Next() {}` to the end, no `Close` | — | open=1 inUse=0 idle=1; a later `rows.Close()` returns `nil` |

Step 3 is the outage: both connections belong to `Rows` values nobody will close, so the third caller can only wait, and without a deadline it would wait forever. Without a cap the same bug shows the other way: every leak opens a new connection (50 after 50 leaks, Pool settings above). Either way `InUse` rising while traffic is flat is the signal.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `sql.Open` with a path in a missing folder | `err == nil`; the first `PingContext` fails with `unable to open database file (14)` ✅[^1] | `Open` may only validate its arguments ✅[^2] |
| Driver package not imported | `sql: unknown driver "postgres" (forgotten import?)` ✅[^1] | No driver registered that name ✅[^2] |
| `QueryRow` matches several rows | `Scan` uses the first and discards the rest | Documented `Row.Scan` behaviour ✅[^2] |
| `Commit` right after cancelling the `BeginTx` context | `context canceled` in 200 of 200 tries; 50 ms later the same call returned `sql: transaction has already been committed or rolled back`; the data stayed unchanged ✅[^1] | The package rolls back a transaction whose context is cancelled ✅[^2] |
| `db` query while a transaction holds the only connection (`SetMaxOpenConns(1)`) | Waits until its 300 ms deadline: `context deadline exceeded` ✅[^1] | The guide warns that `db` methods inside a transaction can deadlock ✅[^9] |
| `RawBytes` destination kept after the loop | The slice is valid only until the next `Next`, `Scan` or `Close` | It points to memory the database owns ✅[^2] |
| `PRAGMA`, temporary table or `ATTACH` run with `ExecContext` | The next caller that borrows that connection inherits it | Pooled connections keep their state; use DSN parameters, a connection hook or a held `sql.Conn` ✅[^17] |
| `_pragma` in a DSN from user input | Runs as SQL text, so `;` can start another statement | The driver runs each `_pragma` value with `PRAGMA` prepended; `StrictPragmas(true)` rejects more than one statement ✅[^17] |
| `Stmt` prepared on a `Tx`, used after `Commit` | Fails: it closed with the transaction | `Tx` statements are bound to its connection ✅[^2] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `QueryRowContext` | Built for one row, without the overhead of a `Rows` ✅[^4]; `ErrNoRows` for "not found" ✅[^2] | One row only; extra rows are dropped ✅[^2] |
| `PrepareContext` once, reuse | Parsed once; safe from many goroutines ✅[^2] ✅[^8] | Must be closed; re-prepared on each new connection ✅[^2] |
| Plain arguments on each call | Simplest code; still sent apart from the SQL ✅[^12] | No reuse across calls |
| `SetMaxOpenConns` set | Bounded load on the database | Callers wait at the cap; needs deadlines ✅[^11] |
| No cap (default) | Never waits for the pool | Leaks and bursts open unbounded connections ✅[^1] ✅[^17] |
| `sql.Null[T]` / `*T` / `COALESCE` | Exact NULL / short nil check / plain types ✅[^1] | `.V` and `.Valid` everywhere / nil checks / NULL and empty look the same |

## Takeaways
- Open one `*sql.DB` per database at start-up, share it, and check it with `PingContext` ✅[^2]. [rule-candidate]
- Write `defer rows.Close()` on the line after a successful `QueryContext`, and check `rows.Err()` after the loop ✅[^6]. [rule-candidate]
- Give every query a context with a deadline, so a drained pool fails fast instead of hanging ✅[^1]. [rule-candidate]
- Pass every value as a placeholder argument; never build SQL with `fmt.Sprintf` ✅[^12]. [rule-candidate]
- Start transactions with `BeginTx` followed by `defer tx.Rollback()`, and use only `tx` methods until `Commit` ✅[^9]. [rule-candidate]
- Scan nullable columns into `sql.Null[T]` (Go ≥ 1.22) or a `Null*` type ✅[^2].
- Export `db.Stats()` (`InUse`, `WaitCount`, `WaitDuration`) as metrics: a rising `InUse` with flat traffic is a leak.

## Verification status
- Verified: 124 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `go/lab-setup.md` — the Go 1.27.4 lab (`golang:1.27.4`) where every behaviour marked with this note ran on 2026-11-24, with modernc.org/sqlite v1.63.0 (modernc.org/libc v1.80.1, SQLite 3.54.1) fetched from `proxy.golang.org`: `Open` and `PingContext`, the driver's `init` registration, placeholders, `Scan` conversions, `ExecContext` results, the leaked-`Rows` run, pool settings and `DBStats`, transactions and cancellation, `NULL` handling, the injection test, a shared `Stmt` under `-race`, and a `uuid.UUID` scan. [^1]
- [database/sql package](https://pkg.go.dev/database/sql) — Go team, living. Rank 1. Backs: the package needs a database driver; `DB` is a pool safe for concurrent use; `Open`/`OpenDB` may not connect; `Ping`; `Register`, `Drivers`; `Row`, `Rows`, `Scan` conversions; `Result`; `Stmt` and `Tx` binding; `ErrNoRows`, `ErrTxDone`; `BeginTx` cancellation; `Null[T]` and `Null*`; `RawBytes`; pool setters and their defaults; `DBStats`; `ConvertAssign`; drivers without cancellation. [^2]
- [database/sql/driver package](https://pkg.go.dev/database/sql/driver) — Go team, living. Rank 1. Backs: `RowsColumnScanner` and that `database/sql` stops calling `Next` since Go 1.27. [^3]
- [Accessing relational databases](https://go.dev/doc/database/) — Go team, living. Rank 1. Backs: `QueryRow` is meant for one row and skips the overhead of a `Rows`. [^4]
- [Opening a database handle](https://go.dev/doc/database/open-handle) — Go team, living. Rank 1. Backs: locating a driver and importing it like another package; blank import of the driver; `Open` and `OpenDB`; DSN format is driver-specific; `Ping`; credentials in environment variables. [^5]
- [Querying for data](https://go.dev/doc/database/querying) — Go team, living. Rank 1. Backs: placeholders vary by driver (`$1` for pq); `defer rows.Close()`; `rows.Err()`; nullable-column types. [^6]
- [Executing SQL statements that don't return data](https://go.dev/doc/database/change-data) — Go team, living. Rank 1. Backs: `Exec` for `INSERT`, `UPDATE`, `DELETE`. [^7]
- [Using prepared statements](https://go.dev/doc/database/prepared-statements) — Go team, living. Rank 1. Backs: what a prepared statement is; `Stmt` methods take values only; `Tx.Stmt`; closing statements. [^8]
- [Executing transactions](https://go.dev/doc/database/execute-transactions) — Go team, living. Rank 1. Backs: `defer tx.Rollback()`; failed `Commit`/`Rollback`; no SQL `BEGIN`/`COMMIT`; no `db` calls inside a transaction. [^9]
- [Canceling in-progress operations](https://go.dev/doc/database/cancel-operations) — Go team, living. Rank 1. Backs: timeouts and request contexts passed to `QueryContext`. [^10]
- [Managing connections](https://go.dev/doc/database/manage-connections) — Go team, living. Rank 1. Backs: how the pool lends connections; `SetMaxOpenConns` waits and can deadlock; idle time and lifetime defaults and uses; `DB.Conn`. [^11]
- [Avoiding SQL injection risk](https://go.dev/doc/database/sql-injection) — Go team, living. Rank 1. Backs: placeholders send values apart from the statement; why `fmt.Sprintf` is unsafe. [^12]
- [The Go Programming Language Specification](https://go.dev/ref/spec) — Go team, living. Rank 1. Backs: §Import declarations (blank import for initialization side effects). [^13]
- [Effective Go](https://go.dev/doc/effective_go) — Go team, living. Rank 1. Backs: §Import for side effect. [^14]
- [Go 1.22 Release Notes](https://go.dev/doc/go1.22) — Go team, 2024. Rank 1. Backs: `Null[T]` is new in Go 1.22. [^15]
- [Go 1.27 Release Notes](https://go.dev/doc/go1.27) — Go team, 2026. Rank 1. Backs: `ConvertAssign`, `RowsColumnScanner`, the new `uuid` package. [^16]
- [modernc.org/sqlite v1.63.0](https://pkg.go.dev/modernc.org/sqlite@v1.63.0) — the modernc.org/sqlite project, 2026. Rank 1. Backs: driver name `sqlite`; unbounded pool and per-connection page cache; connection state outlives the borrower; `_pragma` runs as SQL and `StrictPragmas`. [^17]

## Related
- `go/concurrency/context-and-cancellation.md` — the deadlines and cancellation passed to every `...Context` call.
- `go/standard-library/net-http.md` — request contexts that cancel queries when a client leaves.
- `go/packages-modules/packages-and-initialization.md` — `init` functions and blank imports.
- `go/packages-modules/modules-and-dependencies.md` — adding a driver module at a pinned version.
- `go/standard-library/random-numbers-and-uuids.md` — the `uuid` package.
- `performance/database-query-performance.md` — query count, rows and indexes.
- `performance/fundamentals/queueing-and-littles-law.md` — sizing a connection pool.
- `performance/sqlite-covering-index-lab.md` — reading SQLite query plans.
- `go/learning-path.md`
