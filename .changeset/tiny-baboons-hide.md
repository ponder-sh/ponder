---
"ponder": patch
---

Added `retryEmptyResponse` option to `context.client.readContract()`, `context.client.simulateContract()`, `context.client.multicall()`, `context.client.getBlock()`, `context.client.getTransaction()`, `context.client.getTransactionReceipt()`, and `context.client.getTransactionConfirmations()`. 

This option specifies whether to retry the action if the response is empty. Default to `true`.
