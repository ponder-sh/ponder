---
"ponder": patch
---

Fixed a bug that caused historical sync to request transaction receipts for logs with a zero transaction hash when `includeTransactionReceipts` was enabled.
