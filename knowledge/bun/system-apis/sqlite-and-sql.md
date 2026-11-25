---
schema: knowledge-doc/v1
type: concept
topic: bun/system-apis
status: verified
applies-to: ["Bun 1.4.5", "PostgreSQL 18.3", "MySQL 8.4.13"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [bun, sqlite, bun-sqlite, bun-sql, sql-injection, prepared-statements, transactions, wal, bigint, postgres, mysql]
---

# Bun databases: `bun:sqlite` and `Bun.sql`

## Summary
**TL;DR:** `bun:sqlite` is a synchronous SQLite driver built into Bun: `new Database(path, options)`, then `db.query(sql)` (a cached prepared statement) or `db.prepare(sql)` (a fresh one), run with `.all()`, `.get()`, `.run()`, `.values()` or `.iterate()`. `strict: true` makes a missing parameter an error instead of `NULL`; `safeIntegers: true` returns integers as `bigint` so `2**53 + 1` survives. `db.transaction(fn)` commits when `fn` returns and rolls back when it throws. `Bun.sql` / `new SQL(url)` is a separate, promise-based client for PostgreSQL, MySQL/MariaDB and SQLite whose tagged templates (`` sql`… ${value}` ``) send every value as a bound parameter, never as SQL (Structured Query Language) text.
**Use this when:** storing data in SQLite from Bun, choosing between `bun:sqlite` and `Bun.sql`, writing queries that take user input, or handling 64-bit integers and transactions.
**Not this doc:** SQLite indexing and query plans → `performance/sqlite-covering-index-lab.md`; the `sqlite` import attribute among the other loaders → `bun/fundamentals/module-resolution-and-loaders.md`.

## Problem
Building SQL by string concatenation lets a value such as `x', 2); DROP TABLE users; --` end one statement and start another. SQLite stores 64-bit integers, but a JavaScript `number` holds only 53 bits, so an ID such as 9007199254740993 comes back as 9007199254740992 without any error. Transactions break silently when the function inside is `async`. And Bun offers two SQLite APIs with different shapes (synchronous `bun:sqlite`, promise-based `Bun.sql`), so code and advice for one does not fit the other.

## Mental model
**Analogy:** a prepared statement is a printed form with blank boxes. The wording of the form (the SQL) is fixed when it is printed (prepared); values are written into the boxes (bound) later. Whatever someone writes in a box, even `DROP TABLE`, stays text in that box and never becomes part of the form's wording. A tagged template in `Bun.sql` prints the form from the template's fixed parts and puts every `${…}` into a box.

**Artifact** (Bun 1.4.5, SQLite adapter, in the lab) ✅[^lab]:
```ts
import { SQL } from "bun";
const sql = new SQL(":memory:");
await sql`create table users (name text, age integer)`;
const evil = "x', 2); DROP TABLE users; --";
await sql`insert into users (name, age) values (${evil}, ${1})`;   // stored as text; table still exists
await sql.unsafe(`insert into users (name, age) values ('${evil}', 2)`);
// concatenated: SQLite ran the second statement — the users table is gone
```

## How it works
Three actors take part in a query:
- **Your code** — its job: write the SQL and supply values, via `db.query()` / `` sql`…` ``.
- **Bun's driver** — its job: prepare the statement and bind values to its parameters, via `bun:sqlite` or the `Bun.sql` adapter.
- **The database engine** — its job: run the compiled statement, via SQLite inside the Bun process (statically linked on Linux and Windows, Apple's system SQLite on macOS ✅[^1]; version 3.54.1 in the lab image, and Apple's 3.51.0 on macOS 26.1 ✅[^lab]), or a PostgreSQL/MySQL server over the network ✅[^2]. On Linux `ldd` listed no SQLite library for `bun`, and `Database.setCustomSQLite()` returned `false`, which the docs say it does where SQLite is statically linked ✅[^1] ✅[^lab]. On macOS, Apple's build listed 71 compile options, among them `OMIT_LOAD_EXTENSION`, so `db.loadExtension()` threw `This build of sqlite3 does not support dynamic extension loading`, as the docs warn ✅[^1] ✅[^lab]. There, `Database.setCustomSQLite(path)` with a vanilla SQLite 3.54.1 `.dylib` (the Homebrew build) before the first `Database` returned `true`, and `sqlite_version()` then reported `3.54.1` (rules in Edge cases) ✅[^1] ✅[^lab]. The Windows build was not run: the lab has no Windows machine.

```
your code                       Bun driver                              engine
db.query("… $name") ─────────▶ prepare once, cache by SQL text ───────▶ SQLite compiles to bytecode
stmt.get({ name: "Ann" }) ───▶ bind "Ann" to $name (never into text) ─▶ step → row
◀─────────────────────────────  { id: 1, name: "Ann" } ◀───────────────
sql`… ${v}` (Bun.sql) ───────▶ template parts → SQL, ${v} → parameter ─▶ SQLite (same process)
                                                                      ═══ network ═══▶ PostgreSQL / MySQL (pool)
```

### `bun:sqlite`
1. **Opening.** `new Database(path)` creates the file if it is missing; `":memory:"`, `""` or no argument open an in-memory database ✅[^1]. Observed ✅[^lab]:
   - a missing `/tmp/created.db` was created; `new Database("")` (filename `""`) and `new Database()` (filename `":memory:"`) wrote no file.
   - `{ create: false }` on a missing file → `Error` `SQLITE_CANTOPEN` (14) `unable to open database file`.
   - `{ readonly: true }` then an `INSERT` → `SQLITE_READONLY` (8) `attempt to write a readonly database`.
   - `{ readonly: true, create: true }` → `TypeError` (contradicting options) ✅[^1].
2. **`query` versus `prepare`.** Both compile SQL into a `Statement`; nothing runs yet ✅[^1]: an `insert` given to `query()` and another to `prepare()`, neither run, left the row count at 0 ✅[^lab]. `db.query(sql)` caches the compiled statement per SQL string (the 20 most recently used, `Database.MAX_QUERY_CACHE_SIZE` = `20` in the lab ✅[^lab]; text over 64 KB is not cached: a 65,536-character string came back as the same object, a 65,537-character one did not ✅[^lab]), so `db.query("select 1") === db.query("select 1")` is `true`; `db.prepare()` returns a new object every time (`false`) ✅[^1] ✅[^lab]. Use `prepare` for one-off generated SQL, so it does not push useful statements out of the cache ✅[^1].
3. **Running a statement** (lab table `users(id, name, age)`) ✅[^lab]:

   | Call | Returns |
   |---|---|
   | `.all(params)` | array of row objects: `[{ id: 1, name: "Ann", age: 30 }, …]` |
   | `.get(params)` | first row, or `null` when there is none |
   | `.run(params)` | `{ changes: 1, lastInsertRowid: 2 }` |
   | `.values(params)` | arrays: `[[1, "Ann"], [2, "Bob"]]` |
   | `.iterate(params)` / `for…of` | one row at a time, without building the whole array |
   | `.as(Class).get()` | an instance whose getters work (`u.label` → `#1 Ann`); the constructor was called 0 times |

   `.as()` assigns the prototype instead of calling `new` ✅[^1]. `db.run()` runs a string of several statements; `.query()` compiles only the first (`select 1 as a; select 2 as b` → `[{ a: 1 }]`) ✅[^1] ✅[^lab].
4. **Parameters.** Positional `?`, numbered `?1`, and named `$name`, `:name`, `@name` all bind; a key may carry the prefix or not (`{ $name: … }` or `{ name: … }`) ✅[^1] ✅[^lab].
5. **`strict: true`.** Without it, a missing named parameter binds `NULL`: `select $message` with `{ messag: "Hello" }` (typo) returned `[{ m: null }]`. With it, the same call threw `Error: Missing parameter "message"` ✅[^1] ✅[^lab]. When both `$k` and `k` are given, the prefixed key wins normally and the bare key wins under `strict` ✅[^1] ✅[^lab].
6. **64-bit integers.** SQLite integers are signed 64-bit; JavaScript numbers are exact only up to 2^53 ✅[^1]. Inserting `2n ** 53n + 1n` and reading it back ✅[^lab]:
   - default: `9007199254740992` (a `number`, off by one, no error), while `cast(v as text)` in SQL showed `9007199254740993` was stored;
   - `safeIntegers: true`: `9007199254740993n`, and every integer is a `bigint` (`select 1` → `1n`);
   - a `bigint` beyond 64 bits throws `RangeError: BigInt value '18446744073709551616' is out of range` under `safeIntegers`, and without it keeps the low 64 bits (`2n ** 64n - 1n` stored as `-1`) ✅[^1] ✅[^lab].
   - `stmt.safeIntegers(true)` switches one statement ✅[^1] ✅[^lab].
7. **Transactions.** `db.transaction(fn)` returns a wrapper; calling it runs `BEGIN`, then `fn`, then `COMMIT`, or `ROLLBACK` if `fn` throws (the error still reaches you) ✅[^1]. A transaction function called inside another one becomes a savepoint (a named point inside a transaction that can be rolled back alone) ✅[^1] ✅[^4]. `.deferred()`, `.immediate()` and `.exclusive()` use `BEGIN DEFERRED/IMMEDIATE/EXCLUSIVE` ✅[^1] ✅[^5]. In the lab ✅[^lab]:
   - inside each kind, a second connection to the same file (default journal, `busy_timeout` 0) could read and take the write lock under `deferred()`; could read but got `SQLITE_BUSY` on `BEGIN IMMEDIATE` under `immediate()`; and got `SQLITE_BUSY` even for a read under `exclusive()`;
   - a throw rolled back the insert and left `db.inTransaction` `false`;
   - an inner transaction that threw, caught in the outer one, lost only its own row (`outer` kept, `inner` gone);
   - an `async` function that inserted, awaited, inserted and then threw kept both rows: the commit ran at the first `await` ✅[^1].
8. **WAL mode.** WAL (write-ahead logging) writes changes to a separate `-wal` file first, so readers keep reading the main file while one writer appends, like a shop that writes new orders in a daybook and copies them into the ledger later ✅[^1] ✅[^3]. `db.query("PRAGMA journal_mode = WAL").get()` returned `{ journal_mode: "wal" }`; `-wal` and `-shm` files existed while open and were removed at `close()` on Linux ✅[^lab]. On macOS Bun uses Apple's system SQLite, which keeps them ✅[^1]: there `close()` checkpointed the 420,272-byte `-wal` into the database and left it at 0 bytes, and the 32,768-byte `-shm` stayed (2 runs) ✅[^lab]. Removing them took `db.fileControl(constants.SQLITE_FCNTL_PERSIST_WAL, 0)` before `close()` ✅[^1] ✅[^lab] (Edge cases).
9. **Moving a whole database.** `db.serialize()` returned a 24,576-byte `Buffer`; `Database.deserialize(bytes)` opened a copy with the same rows ✅[^1] ✅[^lab]. `import db from "./x.sqlite" with { type: "sqlite" }` gave a `Database` (same as `new Database("./x.sqlite")`) ✅[^1] ✅[^lab].
10. **Types.** `Uint8Array` ↔ `BLOB` (binary large object), `boolean` → `INTEGER` 1/0 (read back as `1`), `string` ↔ `TEXT` ✅[^1] ✅[^lab].

### `Bun.sql` and `new SQL()`
1. **Choosing the adapter.** `postgres://` URLs, URLs without a protocol and no URL at all select PostgreSQL; `mysql://` selects MySQL; `sqlite://…`, `file:…`, `:memory:` or a `filename` option select SQLite ✅[^2]. In the lab `new SQL(":memory:")` and `new SQL("sqlite://:memory:")` reported adapter `sqlite`, and the default `Bun.sql` reported `postgres` ✅[^lab]; `file:/tmp/f.db`, `sqlite:///tmp/s.db` and `{ filename }` → `sqlite`, `mysql://u:p@h:3306/db` → `mysql`, and `localhost:5432/db` (no protocol) and `postgres://…` → `postgres` ✅[^lab].
2. **Tagged templates bind.** Each `${value}` becomes a parameter ✅[^2]. The artifact's value was stored verbatim and the table survived; `` sql`select ${"O'Brien"} as v` `` returned `O'Brien` ✅[^lab].
3. **Helpers** (all ran on SQLite) ✅[^2] ✅[^lab]:
   - `` sql`insert into users ${sql({ name: "Ann", age: 30 })}` `` — columns from the keys; an array of objects inserts several rows;
   - `sql(obj, "name", "age")` — only those columns;
   - `` where id in ${sql([1, 2])} `` — a value list;
   - `sql("users")` — a quoted identifier (quoting stops injection but not access to other tables, so check names against an allow-list) ✅[^2];
   - nested `` sql`and age < ${45}` `` fragments for optional clauses;
   - `.values()` for arrays, `.raw()` for `Uint8Array` cells on SQLite.
4. **`sql.unsafe(text, params?)`** sends the text as written; only its `params` are bound (`:id` with `{ id: 1 }`, `?` with `[2]` worked) ✅[^2] ✅[^lab]. On SQLite, a parameter-free string may hold several statements, which is how the artifact's `DROP TABLE` ran ✅[^2] ✅[^lab].
5. **Queries are lazy.** A query runs when awaited or `.execute()`-d; an un-awaited insert left the count at 0, and awaiting it made it 1 ✅[^2] ✅[^lab].
6. **Results** are arrays with extra fields: an insert gave `count: 1`, `command: "INSERT"`, `lastInsertRowid: 1`, `affectedRows: 1` ✅[^2] ✅[^lab].
7. **Transactions.** `sql.begin(async tx => …)` commits when the callback resolves and rolls back when it rejects; `tx.savepoint(async sp => …)` rolls back only its part ✅[^2] ✅[^lab]. A `tx` query created inside the callback but awaited after it ended rejected with `ERR_SQLITE_INVALID_TRANSACTION_STATE` ✅[^2] ✅[^lab].
8. **Errors.** A duplicate key threw `SQL.SQLiteError` with `code` `SQLITE_CONSTRAINT_PRIMARYKEY`, `errno` `1555`, message `UNIQUE constraint failed: k.id`; a query after `sql.close()` threw `ERR_SQLITE_CONNECTION_CLOSED` ✅[^2] ✅[^lab].
9. **Pooling (PostgreSQL and MySQL only).** A pool keeps open connections for reuse, like a taxi rank instead of calling a new cab per trip. Options: `max` (connections), `idleTimeout`, `maxLifetime`, `connectionTimeout` (seconds); no connection opens before the first query; `sql.begin` and `sql.reserve()` take a connection of their own ✅[^2]. SQLite has no pool: one `SQL` instance is one connection, and a second `sql.begin` waits for the first ✅[^2]: of two concurrent `sql.begin` calls on `:memory:`, the first ran from 1 to 203 ms and the second started at 204 ms ✅[^lab]. When the first query finds no connection ready, Bun opens connections until the pool has `max` ✅[^2]. Lab, `max: 3, idleTimeout: 2`, against PostgreSQL 18.3 and MySQL 8.4.13 containers, two runs each ✅[^lab]:
   - before any query the server saw 0 connections from the pool; after one `select 1`, PostgreSQL saw 3;
   - 9 concurrent queries of 0.2 s each took 607–620 ms (three waves of three) on 3 distinct server connections;
   - 3.5 s after the last query, 0 connections were left;
   - `sql.reserve()` returned the same PostgreSQL backend for two queries in a row.

   Further PostgreSQL runs, one each ✅[^lab]: with `max: 1`, a plain query issued 30 ms into a 300 ms `sql.begin` finished at 310 ms, just after the transaction, because the transaction held the only connection; with `maxLifetime: 1`, `pg_backend_pid()` changed (113 → 114) across a 1.5 s pause, and without the option it stayed the same; `connectionTimeout: 1` to an unroutable address → `ERR_POSTGRES_CONNECTION_TIMEOUT Connection timeout after 1s` after 1,003 ms.
10. **On PostgreSQL and MySQL servers** (same containers ✅[^lab]):
   - A value of `x'); drop table users; --` was stored verbatim through `sql(object)`, and the table survived; `in ${sql([30, 40])}` and array inserts worked on both.
   - Errors: a duplicate key threw `SQL.PostgresError` with `code` `ERR_POSTGRES_SERVER_ERROR` and `errno` `"23505"` (the SQLSTATE, PostgreSQL's five-character standard error code), or `SQL.MySQLError` with `ERR_MYSQL_SERVER_ERROR` and `errno` `1062`; a query after `close()` threw `ERR_POSTGRES_CONNECTION_CLOSED` or `ERR_MYSQL_CONNECTION_CLOSED`.
   - An insert reported `count: 1, command: "INSERT"` on PostgreSQL, and `count: 1, command: null, lastInsertRowid: 1, affectedRows: 1` on MySQL.
   - `sql.begin` rolled back on a throw and `tx.savepoint` rolled back only its part, on both.
   - A `Date` parameter came back as a `Date` for the same instant; on PostgreSQL `sql.json({ a: 1 })` read back from a `jsonb` column as `{ a: 1 }`.
   - `sql.listen("orders", fn)` then `sql.notify("orders", '{"id":42}')` delivered `{"id":42}` to `fn` on PostgreSQL ✅[^2].

## Worked example
A small user store with `bun:sqlite`, run as one script (Bun 1.4.5, lab) ✅[^lab]:

| Step | Code | Observed |
|---|---|---|
| 1 | `const db = new Database(":memory:", { strict: true, safeIntegers: true })` | opened |
| 2 | `db.run("create table users (id integer primary key, name text, big integer)")` | — |
| 3 | `const add = db.query("insert into users (name, big) values ($name, $big)")` | cached `Statement` |
| 4 | `db.transaction(rows => { for (const r of rows) add.run(r); return rows.length })([{ name: "Ann", big: 2n ** 53n + 1n }])` | returns `1`; committed |
| 5 | `db.query("select big from users").get()` | `{ big: 9007199254740993n }` |
| 6 | `add.run({ name: "Bob" })` | throws `Missing parameter "big"` |
| 7 | `db.query("select count(*) as c from users").get()` | `{ c: 1n }` |

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `async` function in `db.transaction()` | Work after the first `await` is outside the transaction; a later throw rolls nothing back ✅[^lab] | The wrapper commits when the function returns, and an `async` function returns at its first `await` ✅[^1] |
| Default `safeIntegers: false` and an ID above 2^53 | Rounded silently (`…993` → `…992`) ✅[^lab] | `number` has 53 bits of precision ✅[^1] |
| Running the same `db.query()` statement inside its own `.iterate()` loop | The loop throws at its next row ✅[^1]: `This iterator was invalidated: its statement was run again. Use db.prepare() to get a statement with a cursor of its own.` ✅[^lab] | One cursor per `Statement`; use `db.prepare()` for the inner query |
| A plain object or `Date` as a `Bun.sql` SQLite parameter | `TypeError: Binding expected string, TypedArray, boolean, number, bigint or null` ✅[^lab] | Not supported on SQLite; pass `sql.json(value)` (stored as `{"a":1}`) or `date.toISOString()` ✅[^2] ✅[^lab] |
| `NOT IN ${sql([])}` on SQLite | Matches every row (`IN ()`): 2 of 2 rows in the lab, while `IN ${sql([])}` matched 0 ✅[^lab]; on PostgreSQL/MySQL it matches none (`IN (NULL)`) ✅[^2]: both `IN` and `NOT IN` matched 0 of 3 rows on both servers ✅[^lab] | Check for an empty list first |
| Multi-statement `sql.unsafe` that fails half-way | Statements before the failing one stay applied ✅[^2]: `insert c; insert into nope …; insert d` left `c` stored on SQLite and on MySQL, and nothing on PostgreSQL ✅[^lab] | Only PostgreSQL wraps it in one implicit transaction; use `sql.begin` |
| Changing a `Buffer` after building, before awaiting, a `Bun.sql` query | The changed bytes are stored ✅[^2]: `[1,2,3,4]` zero-filled before `await` was stored as `0,0,0,0` ✅[^lab] | Parameters are read when the query is sent |
| `-wal`/`-shm` files left next to the database on macOS | Normal there ✅[^1]. On macOS 26.1, after `close()`: no extra call → `-wal` 0 bytes and `-shm` 32 KiB stayed; `PRAGMA wal_checkpoint(TRUNCATE)` first → the same, both stayed; `db.fileControl(constants.SQLITE_FCNTL_PERSIST_WAL, 0)` first, with or without the checkpoint → both removed. Reading the setting with an `Int32Array` holding `-1` gave `1` on macOS and `0` on Linux (2 runs each) ✅[^lab] | Apple builds its SQLite with persistent WAL on ✅[^1]; the setting is per connection, so call `fileControl(SQLITE_FCNTL_PERSIST_WAL, 0)` on every connection before closing; a checkpoint alone does not remove the files |
| `Database.setCustomSQLite()` on macOS | Returned `true` before the first `Database`; the same path again, before or after loading and from a `Worker`, → `true`; another path after loading → `Error: SQLite already loaded`; a missing file → the `dlopen` error at once, and every later `new Database()` threw the same error instead of using Apple's SQLite ✅[^lab] | Only one SQLite library can be loaded per process ✅[^1]. The custom build had persistent WAL off (setting `0`), so its sidecar files went away at `close()`, and `loadExtension()` tried to load the file ✅[^lab] |
| PostgreSQL `int8` columns | Returned as strings unless `bigint: true` ✅[^2]: `5::int8` → `"5"`, and `count(*)` (an `int8`) → `"1"`; with `bigint: true`, `9007199254740993n` ✅[^lab] | On SQLite `bigint: true` equals `safeIntegers: true` ✅[^2] (`select 1` → `1n`) ✅[^lab] |
| MySQL `BIGINT` columns | The type depends on the value: outside the 32-bit range a string, inside it a number ✅[^2]. Lab: `5` → number, `9007199254740993` → string; with `bigint: true` the large one became a `bigint` and `5` stayed a number ✅[^lab] | One column can mix numbers and strings across rows; convert explicitly, or use `bigint: true` and handle both `number` and `bigint` |
| MySQL 8 account over plain TCP (no TLS, Transport Layer Security) | `ERR_MYSQL_PUBLIC_KEY_RETRIEVAL_NOT_ALLOWED` on the first query to a default `mysql:8.4` server ✅[^lab] | The default `caching_sha2_password` plugin needs the server's RSA public key to encrypt the password when there is no TLS, and Bun refuses to fetch it by default; connect with TLS, or set `allowPublicKeyRetrieval: true` only on a trusted network ✅[^2] (that made the lab connection work ✅[^lab]). On a freshly restarted server, `tls: true` connected over TLSv1.3 although the server's certificate is self-signed (`tls: true` asks for at least `sslmode=require` ✅[^2]), while `tls: { rejectUnauthorized: true }` failed with `SELF_SIGNED_CERT_IN_CHAIN`; after one TLS or key-retrieval login, plain connections worked until the next server restart, since MySQL keeps an in-memory cache of users who logged in before ✅[^6] ✅[^lab] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `bun:sqlite` | Synchronous, no promise overhead, user functions, hooks, `serialize` | SQLite only; blocks the thread on slow queries |
| `Bun.sql` with SQLite | Same code shape as PostgreSQL/MySQL; injection-safe templates; helpers | Promises around synchronous work; fewer SQLite extras |
| `Bun.sql` with PostgreSQL/MySQL | Pool, `LISTEN/NOTIFY`, `COPY`, no extra driver package | Needs a server; adapter differences (IDs, dates, empty `IN`) |
| `sql.unsafe` | Dynamic SQL and migrations | No escaping of the text; injection risk |

## Takeaways
- Pass every user value as a parameter (`${value}` in `Bun.sql`, `$name`/`?` in `bun:sqlite`); never build SQL text from input, and never pass input to `sql.unsafe`. [rule-candidate]
- Open `bun:sqlite` databases with `strict: true` so a misspelled parameter fails instead of writing `NULL`. [rule-candidate]
- Turn on `safeIntegers` (or `bigint: true`) whenever an integer column can exceed 2^53. [rule-candidate]
- On MySQL, never assume a `BIGINT` column comes back as one JavaScript type: convert it explicitly. [rule-candidate]
- Keep `db.transaction()` functions synchronous; do awaited work before and pass the results in. [rule-candidate]
- Run `PRAGMA journal_mode = WAL` once at start-up for file databases with concurrent readers.
- When the `-wal`/`-shm` files must not outlive the database on macOS, call `db.fileControl(constants.SQLITE_FCNTL_PERSIST_WAL, 0)` before `close()`; a checkpoint alone leaves them. [rule-candidate]

## Verification status
- Verified: 121 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- `linux/lab-setup.md` — the Bun 1.4.5 lab (`oven/bun:1.4.5` image, arm64, with `postgres:latest` = PostgreSQL 18.3 and `mysql:8.4` = MySQL 8.4.13 containers on one Docker network) where every ✅[^lab] behaviour ran on 2026-11-24; the macOS rows ran a Bun 1.4.5 binary cross-compiled with `bun build --compile --target=bun-darwin-arm64` and run as the full CLI (`BUN_BE_BUN=1`) with an isolated environment on macOS 26.1 (Apple M2), against Apple's system SQLite and a Homebrew SQLite 3.54.1 `.dylib` loaded read-only; the binary was deleted afterwards. [^lab]
- [SQLite (docs at bun-v1.4.5)](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/sqlite.mdx) — Bun documentation in the Bun repository (Oven), 2026. Backs: `Database` options, `query` cache, statement methods, parameters, `strict`, integers and `safeIntegers`, transactions and savepoints, WAL and sidecar files, `serialize`, import attribute, datatypes. [^1]
- [SQL (docs at bun-v1.4.5)](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/sql.mdx) — Bun documentation in the Bun repository (Oven), 2026. Backs: adapter selection, tagged templates, helpers, `sql.unsafe`, laziness, result metadata, `sql.begin`, savepoints, SQLite errors, pooling, parameter types, `bigint`. [^2]
- [Write-Ahead Logging](https://www.sqlite.org/wal.html) — SQLite project, living. Backs: what WAL mode does. [^3]
- [SAVEPOINT](https://www.sqlite.org/lang_savepoint.html) — SQLite project, living. Backs: savepoints inside transactions. [^4]
- [BEGIN TRANSACTION](https://www.sqlite.org/lang_transaction.html) — SQLite project, living. Backs: `DEFERRED`, `IMMEDIATE`, `EXCLUSIVE`. [^5]
- [Caching SHA-2 Pluggable Authentication](https://dev.mysql.com/doc/refman/8.4/en/caching-sha2-pluggable-authentication.html) — MySQL 8.4 Reference Manual (Oracle), 2026. Backs: secure connection or RSA key exchange required, the server's in-memory cache of earlier logins. [^6]

## Related
- `performance/sqlite-covering-index-lab.md` — indexes and query plans in SQLite.
- `bun/fundamentals/module-resolution-and-loaders.md` — the `sqlite` import attribute among the loaders.
- `bun/system-apis/workers-ffi-and-native-code.md` — moving slow synchronous queries off the main thread.
