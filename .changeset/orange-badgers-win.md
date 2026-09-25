---
"ponder": patch
---

Fixed a bug that caused changes to a row returned by `context.db` to be lost when the row was passed back to `context.db.insert()` or `context.db.update()`. The original values were written instead.
