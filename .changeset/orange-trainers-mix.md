---
"@ponder/core": patch
---

Improved indexing performance by using a dynamic checkpoint range when querying raw events from the sync store. The checkpoint range adjusts based on the density of events in the previous batch. This eliminates performance issues when using databases that had >1M rows in the `ponder_sync.logs` table.
