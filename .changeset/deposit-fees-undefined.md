---
"ponder": patch
---

Fixed a bug that caused `event.transaction.maxFeePerGas` and `event.transaction.maxPriorityFeePerGas` of a deposit transaction without fees to be `null` in the backfill and `undefined` in live indexing. They are now `undefined` in both.
