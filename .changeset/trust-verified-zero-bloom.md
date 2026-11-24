---
"ponder": patch
---

Improved live indexing to skip the `eth_getLogs` request for a block whose `logsBloom` is zero when the block hash proves that bloom, such as a block whose transactions emit no logs.
