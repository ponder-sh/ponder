---
"ponder": patch
---

Fixed a bug that caused Postgres queries to hang or fail with `timeout exceeded when trying to connect` after a database restart or failover until Ponder was restarted.
