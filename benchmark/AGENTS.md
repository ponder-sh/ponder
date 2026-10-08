# Benchmark Guide

## Overview / Goal
- `benchmark` measures how long Ponder takes to start and index fixed historical workloads into Postgres.
- The runner drops the app's `benchmark` schema, preserves the `ponder_sync` schema, starts the app, waits for `/ready`, and prints the benchmark result as `[app id] took [milliseconds]ms`.
- A useful run indexes from a fully populated local `ponder_sync` cache. It measures Ponder startup, schema creation, cached event processing, and readiness rather than historical RPC provider performance.
- The suite is a performance harness, not a correctness test. It does not compare table contents, enforce a performance threshold, or store results.

## Prerequisites
- Use the repository toolchain from the root `AGENTS.md`: pnpm `12.10.1`, Node `>=22`, and Bun for this package's scripts.
- Install workspace dependencies from the repository root with `pnpm install --frozen-lockfile`.
- Build the publishable packages before benchmarking with `pnpm build`.
- Provide a Postgres server base URL in `DATABASE_URL`. It must omit the app database name and have no trailing slash because the scripts append `/benchmark_[app id]`, for example `postgresql://postgres@localhost:55432`.
- Set `PGDATABASE=postgres` when the base URL does not name a maintenance database.
- Provide the RPC variables required by the selected app. Copy `benchmark/.env.example` to `benchmark/.env.local`, reuse values from `simulation-test/.env.local`, or export them in the shell. Bun loads `benchmark/.env.local` automatically.
- Keep port `42069` available. Runs for the same database must be sequential because each run drops the same `benchmark` schema.

## Workloads
- `reth` indexes rETH `Transfer` and `Approval` events on Ethereum from block `18,600,000` through `23,200,000`. It requires `PONDER_RPC_URL_1`.
- `uniswap` indexes Uniswap v4 pool initialization and swap events with `ordering: "experimental_isolated"`. Its configured ranges cover Ethereum `21,700,000..22,500,000`, Unichain `0..15,500,000`, Optimism `131,000,000..136,000,000`, and Base `25,500,000..28,500,000`. It requires `PONDER_RPC_URL_1`, `PONDER_RPC_URL_130`, `PONDER_RPC_URL_10`, and `PONDER_RPC_URL_8453`.
- The available app IDs are the directories under `benchmark/apps/`.

## Database Setup
- Each app uses a database named `benchmark_[app id]`, such as `benchmark_reth`.
- `pnpm create:app [app id]` creates that database and runs the app to completion once. This populates both the output tables in `benchmark` and reusable historical data in `ponder_sync`.
- `pnpm create:app` is not idempotent: it fails if the app database already exists.
- Initial setup from live RPC can be very expensive. A fresh local `reth` setup estimated hours to fetch its 4.6-million-block range; `uniswap` covers four large ranges and is more expensive.
- A timed `pnpm benchmark` run requires the app database to exist. It drops and recreates only `benchmark`; it intentionally retains `ponder_sync` so indexing can be replayed without fetching historical RPC data again.
- For rough planning on the verified local setup, the `reth` benchmark took about 17 to 20 seconds with a complete cache. Without historical sync data, the initial `reth` sync was projected to take roughly two hours. Unsynced time depends heavily on RPC limits and latency and is database preparation, not a comparable benchmark result.

## Running
- Run commands from `benchmark`.
- Run a visible warmup first so logs confirm that all required historical data is cached:

```bash
pnpm benchmark reth --log-level info
```

- A valid cached run prints `Skipped fetching backfill JSON-RPC data (cache contains all required data)` and `cache_rate=100%` for every chain.
- Ponder calls the subsequent replay `backfill indexing`; this means it is indexing historical events from `ponder_sync`, not re-fetching them from RPC when the cache is complete.
- Use quieter logs for measured repetitions after confirming the cache is complete:

```bash
pnpm benchmark reth --log-level warn
```

- Pass Ponder CLI options directly after the app ID. Do not insert an extra `--`; Commander treats it as the end of options, so `pnpm benchmark reth -- --log-level warn` leaves the default info logging enabled.
- Run at least one warmup followed by three measured repetitions. For more stable comparisons, use five or more repetitions and report the median plus the minimum and maximum.
- Do not run workloads concurrently. Besides competing for CPU, memory, disk, and Postgres, runs of the same app mutate the same schema.

## Interpreting Results
- Use the runner's `[app id] took [milliseconds]ms` line as the benchmark result. It is measured from immediately before Ponder `start()` until `/ready` first returns HTTP 200, including startup, database and RPC connection setup, schema creation, cached indexing, and readiness polling. It excludes the shutdown that begins when `Killing app` is printed afterward.
- The runner still connects to each configured RPC even with a complete cache. RPC connection latency is included, but a synced run should not fetch historical RPC data.
- A zero exit and the timing line indicate the harness completed; they do not validate indexed row contents.
- Do not compare a run that logs `Started fetching backfill JSON-RPC data` or a cache rate below 100% with cached baseline results. Such a run includes provider latency and may mutate `ponder_sync` while it fills gaps.
- Compare results only across equivalent hardware, Postgres data snapshots/configuration, repository revisions, Node/Bun versions, and system load. Database page cache and filesystem cache make later runs faster, which is why the first run should be treated as warmup.
- Prefer distributions over one-off numbers. A regression is a repeatable shift in the median, not one slow sample; inspect individual indexing batch times and system/database load when variance grows.

## Troubleshooting
- `database "benchmark_[app id]" does not exist`: restore a populated database or run `pnpm create:app [app id]` before benchmarking.
- `database "benchmark_[app id]" already exists` from `create:app`: the command is not a refresh operation. Keep the existing database if its cache is complete, or explicitly replace only an isolated local copy.
- Low cache rate or a long RPC estimate: the local `ponder_sync` data is incomplete. Stop treating the run as a benchmark and restore a complete snapshot or finish the one-time sync.
- `ECONNREFUSED` for Postgres: start the local server and confirm that `DATABASE_URL` uses its exposed port.
- Repeated `/ready` polling or a port error: check that port `42069` is free and that another benchmark process is not running.
- Missing RPC configuration: check the selected workload's required variables. `uniswap` needs all four URLs even if some chain data was restored.
- If a process is interrupted, confirm it exited before rerunning. The next benchmark drops `benchmark`, but concurrent or orphaned processes can contend for the schema and port.

## Safety Notes
- Every `pnpm benchmark [app id]` run destroys and recreates the `benchmark` schema in `benchmark_[app id]`. Never use a database whose `benchmark` schema must be preserved.
- Preserve `ponder_sync`; it is the expensive historical cache that makes benchmark runs repeatable and fast.
- Do not benchmark directly against Railway unless explicitly asked. Dump remote data read-only and run against an isolated local restore.
- Do not commit `.env.local`, database URLs, RPC URLs, dumps, or credentials.

## Useful Files
- `src/index.ts`: timed runner, schema reset, `/ready` polling, and timing output.
- `src/create-app.ts`: one-time app database creation and historical sync population.
- `apps/reth/ponder.config.ts`: rETH chain, contract, and block range.
- `apps/reth/src/index.ts`: rETH indexing workload.
- `apps/uniswap/ponder.config.ts`: multichain Uniswap v4 ranges and ordering mode.
- `apps/uniswap/src/index.ts`: Uniswap v4 indexing workload.
- `.env.example`: required database and RPC variable names.
- `.github/workflows/bench.yml`: scheduled benchmark workflow.
