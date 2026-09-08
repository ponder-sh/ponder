---
"ponder": minor
---

Added a `ponder/sync` entrypoint that exposes the sync engine on its own. It exports `createHistoricalSync`, `createRealtimeSync`, `createRpc`, and the `SyncStore` type the engine reads and writes through, so an application can run Ponder's backfill, reorg handling, factory child-address discovery, and rpc cache against its own tables by implementing `SyncStore` and handling `RealtimeSyncEvent` directly. Importing `ponder/sync` does not load Drizzle, `pg`, PGlite, Hono, or the CLI.
