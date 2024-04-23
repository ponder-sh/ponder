---
"@ponder/core": patch
---

Added support for including transaction receipts (`event.transactionReceipt`). To enable transaction receipts for all events on a contract, set `includeTransactionReceipts: true` on the contract config. Receipts can be specified/overriden on a per-network basis. Note that including receipts may slow down the historical sync due to additional `eth_getTransactionReceipt` RPC requests.
