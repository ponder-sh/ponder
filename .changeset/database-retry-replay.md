---
"ponder": patch
---

Fixed a bug that caused indexing to read stale cached rows after a database transaction failed to commit. A transaction that fails from a lost connection or a serialization failure now runs its statements again, without running the indexing functions again.
