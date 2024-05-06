---
"@ponder/core": patch
---

Fixed a regression introduced in 0.4.15 that caused apps using SQLite to encounter errors like `NOT NULL constraint failed: blocks.mixHash` when using chains that do not include all properties on the RPC block object.
