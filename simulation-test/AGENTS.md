# Simulation Test Guide

## Overview / Goal
- `simulation-test` is a long-running integration/fuzz harness for the `ponder` package.
- It runs real Ponder apps against Postgres and live chain RPCs, then verifies that the app's indexed tables match precomputed expected tables.
- The harness intentionally injects adverse conditions that normal tests do not cover: RPC errors, database errors, uncached sync gaps, realtime block delivery, reorgs, process restarts, and different event ordering modes.
- The goal is to catch regressions in sync, indexing, realtime, crash recovery, and database behavior before they reach users.

## Prerequisites
- Use the repository toolchain from the root `AGENTS.md`: pnpm `11.0.0`, Node `>=22`, and Bun for this package's scripts.
- Install workspace dependencies from the repository root with `pnpm install`.
- Build the publishable packages before running simulations with `pnpm build`; the simulation apps depend on the workspace `ponder` package.
- Provide a Postgres server connection in `DATABASE_URL`. The URL should omit the app/run database name because scripts append database names themselves, for example `postgresql://postgres@localhost:55432`.
- Provide RPC URLs used by the app under test. Current env names are `PONDER_RPC_URL_1`, `PONDER_RPC_URL_10`, `PONDER_RPC_URL_130`, and `PONDER_RPC_URL_8453`.
- Copy `simulation-test/.env.example` to `simulation-test/.env.local` for local runs, or export the variables in your shell.

## Local Postgres
- Prefer an isolated local Postgres instance for simulation-test work. Do not reuse unrelated local databases such as `ffca-postgres`.
- A known-good Docker setup is:

```bash
sudo docker run -d \
  --name simulation-test-postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_DB=postgres \
  -e POSTGRES_HOST_AUTH_METHOD=trust \
  -v simulation-test-postgres-data:/var/lib/postgresql/data \
  -p 127.0.0.1:55432:5432 \
  postgres:16
```

- Use `DATABASE_URL=postgresql://postgres@localhost:55432` with this container.
- If host Postgres client tools are unavailable, use the tools inside the container with `sudo docker exec simulation-test-postgres psql ...`, `pg_dump`, or `pg_restore`.
- Verify readiness with `sudo docker exec simulation-test-postgres pg_isready -U postgres -d postgres`.

## Database Setup
- `pnpm migrate` applies the root simulation-test migrations. These create shared `metadata` and `rpc_cache` tables on the base database connection.
- `pnpm create:app [app id]` creates a Postgres database named exactly `[app id]` and runs that app once with `DATABASE_SCHEMA=expected` to populate template data.
- `pnpm test [app id]` expects a template database named `[app id]` to already exist.
- Each test run creates a UUID database with `CREATE DATABASE "<uuid>" TEMPLATE "<app id>"`, runs the simulation there, then marks the root `metadata` row as successful if validation passes.
- `src/cleanup-database.ts` drops only successful UUID databases recorded in `metadata`. Failed run databases are left behind for debugging unless manually removed.
- `pnpm create:app [app id]` is not idempotent; do not run it against shared infrastructure unless you intend to create or replace that app template database.

## Populating Local Data
- Prefer copying data from the Railway Postgres instance instead of rebuilding templates and RPC cache from live RPC. Railway has a fully synced database, and dumping it avoids expensive and rate-limited RPC backfills.
- Treat Railway as production infrastructure. Use it read-only for `pg_dump`; do not drop databases, truncate tables, run cleanup scripts, or run simulation tests against it unless explicitly asked.
- To copy a template app locally, dump the Railway app database and restore it into the isolated local Postgres instance. Use the Railway connection string from secrets or the dashboard, but change only the database name.
- Example shape for `reference-erc20`:

```bash
export LOCAL_DATABASE_URL="postgresql://postgres@localhost:55432"
export RAILWAY_SERVER_URL="postgresql://postgres:<password>@<host>:<port>"

pg_dump "$RAILWAY_SERVER_URL/reference-erc20" --format=custom --file=/tmp/reference-erc20.dump
createdb "$LOCAL_DATABASE_URL/reference-erc20"
pg_restore --no-owner --dbname="$LOCAL_DATABASE_URL/reference-erc20" /tmp/reference-erc20.dump
```

- The shared root database also contains `rpc_cache`. Copying it locally is useful when debugging cache behavior or when app templates do not already include enough sync data.
- If Railway is unreachable, the fallback is to run `pnpm create:app [app id]` locally. This repopulates template data and cache just in time from live RPC as the app runs, but it should not be the default path for large apps or routine setup.
- Verified local fallback for `reference-erc20`:

```bash
set -a; source .env.local; set +a
export DATABASE_URL="postgresql://postgres@localhost:55432"
export PGDATABASE=postgres
export PGSSLMODE=disable
pnpm migrate
pnpm create:app reference-erc20
```

## Running
- From `simulation-test`, run one fuzz simulation with `pnpm test [app id]`.
- Reproduce a specific run with `SEED=[seed] pnpm test [app id]`.
- A fixed `SEED` must produce the same simulation parameters and the same test behavior every time. If a seed sometimes passes and sometimes fails with the same template data, treat that as a simulation harness bug unless there is a clear external cause.
- `UUID` only controls the temporary database name for a run. Set it when you need a predictable database name for inspection, but do not reuse a UUID until the old database has been dropped.
- Pass Ponder CLI logging flags after `--`, for example `pnpm test [app id] -- -v` or `pnpm test [app id] -- --log-level debug`.
- Run `pnpm benchmark [app id]` to clone the app template and time a normal app run without the validation/fault-injection harness.
- The available app IDs are the directories under `simulation-test/apps/`.
- `the-compact` and `basepaint` are treated as cached apps by the harness and skip uncached block deletion.
- `super-assessment` is special: its seeded config is generated dynamically, and its expected tables are built during the simulation run.
- Verified local smoke command for the isolated Docker database:

```bash
set -a; source .env.local; set +a
export DATABASE_URL="postgresql://postgres@localhost:55432"
export PGDATABASE=postgres
export PGSSLMODE=disable
export CI=true
SEED="reference-erc20-local-smoke" pnpm test reference-erc20 -- --log-level info
```

## Interpreting Results
- At startup, the runner prints the app, seed, UUID, and selected simulation parameters. Save the seed and UUID when investigating a failure.
- If a run fails validation, the runner prints a table comparing expected rows and actual rows for the first mismatches.
- A validation failure usually means Ponder indexed data differently from the known-good expected tables for that app template and seed.
- A simulated RPC or DB error is not automatically a test failure; Ponder is expected to recover from many injected transient failures.
- On non-zero exit, the runner prints a reproduction command in the form `SEED=[seed] pnpm test [app id]`.
- Successful runs set `metadata.success = true` and are eligible for cleanup. Failed runs usually remain in Postgres for inspection.

## Infra / Railway / Monitoring CI
- Scheduled CI is defined in `.github/workflows/simulation-test.yml`.
- The fuzz workflow currently runs four times per day with cron `0 0,6,12,18 * * *`.
- The scheduled matrix runs each configured app for three iterations. The `iteration` value is only a matrix label; it does not seed the test.
- The same workflow includes known-failure seeds, but that job only runs on manual `workflow_dispatch`.
- One-off reproductions in CI use `.github/workflows/simulation-test-single.yml`, which accepts an app and seed.
- CI runs on self-hosted runners and uses GitHub secrets for `DATABASE_URL` and RPC URLs. Current workflow env sets `PGDATABASE=railway`, indicating the shared Postgres service is Railway-backed.
- Simulation workflows call the shared `.github/actions/setup` action with `foundry: "false"`. These jobs do not need Foundry, and skipping it avoids self-hosted runner glibc/toolchain failures during setup.
- The cleanup job runs after the fuzz jobs and calls `bun run src/cleanup-database.ts` to delete successful UUID databases.
- Monitor failures in GitHub Actions first, then use the printed seed and UUID plus the `metadata` table and remaining run database for deeper inspection.
- If Railway is unreachable from an AWS/dev instance but works from a laptop, ask DevOps to check whether outbound TCP to the Railway Postgres proxy host and port is allowed from that instance.

## Safety Notes
- Treat shared simulation infrastructure as stateful. Template databases, RPC cache tables, metadata, and failed run databases may all be useful for debugging.
- Do not drop app template databases or failed UUID databases from shared infrastructure unless you know they are no longer needed.
- Avoid broad local runs against shared Railway infrastructure while debugging; prefer a single app and explicit seed.
- Do not commit `.env.local` or RPC/database credentials.

## Useful Files
- `src/index.ts`: main simulation runner and validation logic.
- `src/rpc-sim.ts`: RPC cache, RPC fault injection, realtime block, reorg, and restart simulation.
- `src/db-sim.ts`: database fault injection.
- `src/create-app.ts`: app template database creation.
- `src/cleanup-database.ts`: successful run database cleanup.
- `schema.ts`: shared metadata and RPC cache schema.
- `.github/workflows/simulation-test.yml`: scheduled fuzz workflow.
- `.github/workflows/simulation-test-single.yml`: manual single-seed workflow.
