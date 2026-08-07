---
"ponder": patch
---

Fixed `eth_getLogs` requests with large address arrays and empty address arrays, and sanitized trailing `null` log topics for RPC providers that reject them.
