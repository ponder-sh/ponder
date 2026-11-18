---
"ponder": patch
---

Reduced `eth_getLogs` requests during live indexing for contracts that use a factory. Logs are no longer requested for blocks whose `logsBloom` contains neither the factory event nor a known child address.
