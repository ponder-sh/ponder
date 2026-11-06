---
"ponder": patch
---

Fixed a bug that caused indexing to fail with `InvalidEventAccessError` when an indexing function read `gasPrice`, `accessList`, `maxFeePerGas`, or `maxPriorityFeePerGas` of a transaction with a type other than legacy, EIP-2930, EIP-1559, or deposit, such as a blob or EIP-7702 transaction. This affected live indexing and chains with `cacheRpcRequests: false`.
