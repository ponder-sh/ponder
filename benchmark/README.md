# Benchmarks

Measures how long Ponder takes to index fixed workloads and how much memory it uses, both during backfill and during steady-state live indexing.

## Usage

### Setup environment

Create an `.env.local` file using `.env.example` as a template. The `DATABASE_URL` should not include a database (i.e. `postgres://kylescott@localhost:5432`).

Build the packages from the repository root. The runner imports the built `ponder` package, so rebuild after changing `packages/core`.

```pnpm build```

Create the database objects for a backfill app (not needed for live apps such as `weth`).

```pnpm create:app [app id]```

### Run benchmark

```pnpm benchmark [app id]```

The runner uses Node with `--expose-gc`, which matches production Ponder. `pnpm benchmark:bun [app id]` runs the same runner under Bun, but Bun memory numbers are not comparable with Node.

Ponder CLI flags are passed through without an extra `--`.

```pnpm benchmark reth --log-level warn```

Runner options:

- `-p, --port <PORT>`: Ponder server port (default: `$PORT` or `42069`).
- `--live-duration <SECONDS>`: keep indexing live after `/ready` and sample memory (default: `$LIVE_DURATION`, `600` for `weth`, `0` otherwise).
- `--gc-interval <SECONDS>`: seconds between post-GC readings in the live phase (default `30`).
- `--sample-interval <SECONDS>`: seconds between non-GC samples used for peak values (default `5`).

### Live benchmark

`weth` indexes WETH `Transfer`, `Approval`, `Deposit`, and `Withdrawal` events on Ethereum starting at `startBlock: "latest"`. The runner creates `benchmark_weth` if it is missing, waits for `/ready`, runs live for 10 minutes, then shuts down.

```PORT=42070 pnpm benchmark weth --log-level warn```

## Output

- `[app id] took [ms]ms`: time from Ponder `start()` until `/ready` first returns 200.
- `[memory] phase=ready|live ...`: post-GC readings (rss, heapUsed, heapTotal, heapLimit, external, arrayBuffers in MiB). One after `/ready`, then one every `--gc-interval` in the live phase.
- `[summary] {...}`: one JSON line for comparisons. Extract it with `sed -n 's/^\[summary\] //p'`.

| Field | Meaning |
| --- | --- |
| `app`, `mode`, `runtime` | App id, `backfill` or `live`, and the runtime that ran it. |
| `readyMs` | Duration until `/ready` (same as the `took` line). |
| `heapLimitMiB` | `v8.getHeapStatistics().heap_size_limit`. Ponder sizes its indexing cache from it, so compare only runs with the same limit. |
| `peakRssMiB` | Process high-water RSS (`process.resourceUsage().maxRSS` / `VmHWM`), including spikes between samples. `peakRssAtReadyMiB` is the same value at `/ready`. |
| `readyAfterGcMiB` | Memory after a forced full GC at `/ready`. |
| `peakSampleMiB` | Maximum of the non-GC samples taken every `--sample-interval`. |
| `live` | Live phase only: duration, number of post-GC readings, indexed events, and `min`/`median`/`max`/`last`/`slopeMiBPerHour` for post-GC `heapUsed` and `rss`. A sustained positive heap slope across runs suggests a leak. |
