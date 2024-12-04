---
"@ponder/core": patch
---

Added support for caching all available rpc methods. Several new client actions are available, including `context.client.simulateCall()`, `context.client.getTransactionCount()`, `context.client.getTransactionReceipt()`, and `context.client.getBlockTransactionCount()`. See [docs](https://ponder.sh/docs/indexing/read-contract-data#supported-actions) for all actions.
