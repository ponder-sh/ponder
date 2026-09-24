---
"ponder": patch
---

Fixed a bug that caused a callback passed to `.then()` on `context.db.insert()` to run twice.
