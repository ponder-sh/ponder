---
"ponder": patch
---

Fixed a bug that caused a `ponder start` or `ponder dev` process that exited with `Failed to acquire lock on schema` to release the lock held by the running app. A later instance could then start on the same schema while the first one was still indexing.
