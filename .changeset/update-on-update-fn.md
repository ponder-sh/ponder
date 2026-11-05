---
"ponder": patch
---

Fixed a bug that caused `context.db.update()` and `onConflictDoUpdate()` to ignore columns defined with `.$onUpdateFn()`. These columns are now set to the value returned by the function when the update doesn't set them.
