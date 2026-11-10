---
"ponder": patch
---

Fixed a bug that caused a database error that can't succeed again, such as `division by zero` from `context.db.sql`, `@ponder/client`, or the `db` of the API, to retry for about a minute before failing.
