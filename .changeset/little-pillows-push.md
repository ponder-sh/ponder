---
"ponder": patch
---

Added validations against updating primary key columns in `db.update().set()` and `db.insert().values().onConflictDoNothing()`.
