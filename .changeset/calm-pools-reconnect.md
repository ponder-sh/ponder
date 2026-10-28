---
"ponder": patch
---

Fixed a bug where a Postgres connection that closed or timed out while connecting permanently took up a slot in the connection pool. After a database restart or failover, every query could fail with `timeout exceeded when trying to connect` until the process was restarted.
