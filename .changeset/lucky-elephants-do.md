---
"@ponder/core": patch
---

Fixed bugs where the realtime sync would: incorrectly report reorgs with a very large depth, call `eth_getLogs` with `fromBlock > toBlock`, and skip events if the RPC returned logs out of order. Improved realtime sync debug logging.
