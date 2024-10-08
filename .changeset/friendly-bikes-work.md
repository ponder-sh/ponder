---
"@ponder/core": patch
---

Eliminated unnecessary `eth_getTransactionReceipt` requests in realtime when `includeTransactionReceipts` was set to `true`.
