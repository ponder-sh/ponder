---
"ponder": patch
---

Improved backfill sync performance by merging more compatible JSON-RPC `eth_getLogs` requests, including requests that only differ by `address` or an indexed topic.
