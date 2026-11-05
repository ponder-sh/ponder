---
"ponder": patch
---

Fixed a bug that caused some `context.db` and `context.client` calls to fail with `TypeError: Cannot read properties of undefined` in indexing functions of logs without a transaction, such as on ZKsync.
