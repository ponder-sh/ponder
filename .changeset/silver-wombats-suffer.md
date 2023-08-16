---
"@ponder/core": patch
---

Fixed a bug where a `delete` executed after an `update` in the same event handler would not properly delete the entity.
