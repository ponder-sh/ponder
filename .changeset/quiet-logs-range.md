---
"ponder": patch
---

Fixed a bug that caused the backfill to hang and run out of memory when the JSON-RPC provider rejected `eth_getLogs` requests for more than one block. Also fixed an off-by-one error that made `eth_getLogs` ranges one block smaller than the range suggested by the JSON-RPC provider.
