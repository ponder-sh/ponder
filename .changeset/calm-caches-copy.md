---
"ponder": patch
---

Fixed a bug that caused rows returned by `context.db.find()`, `context.db.insert()`, and `context.db.update()` to be mutated by subsequent writes to the same row.
