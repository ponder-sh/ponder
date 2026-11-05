---
"ponder": patch
---

Fixed a bug that caused indexing to fail with `InvalidEventAccessError` when an indexing function read a property of `event.transaction` that belongs to another transaction type, such as `gasPrice` on an EIP-1559 transaction. This affected live indexing and chains with `cacheRpcRequests: false`. These properties are now `undefined`.
