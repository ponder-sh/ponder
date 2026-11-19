---
"ponder": patch
---

Fixed indexing failures for transactions with nonces larger than a signed 32-bit integer, including Tempo expiring nonces. Updated `event.transaction.nonce` from `number` to `bigint` to preserve precision, and migrated the RPC cache while preserving existing cached data.
