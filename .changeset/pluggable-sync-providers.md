---
"ponder": minor
---

Added `chain.sync` to plug in custom historical sync providers, and exposed the `ponder/sync` extension API. Setting `chain.sync.historical` streams a chain's historical backfill from a custom data source instead of JSON-RPC, without forking core. `ponder/sync` exports the full provider contract (`HistoricalSyncFactory`, the `Sync*` data types, `SyncStore`, filter/interval helpers) so a provider needs no deep imports. The default (no `chain.sync`) is unchanged; realtime and indexing-function reads still use `rpc`. `chain.sync.realtime` is reserved for a future realtime provider seam.
