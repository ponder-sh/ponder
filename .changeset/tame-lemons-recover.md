---
"ponder": patch
---

Fixed a bug that caused restart to fail after an RPC pruned the configured `startBlock`. Startup now saves finalized diagnostic blocks in the RPC cache and reuses them on later runs when `cacheRpcRequests` is enabled.
