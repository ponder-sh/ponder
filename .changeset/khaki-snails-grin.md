---
"@ponder/core": patch
---

Fixed a regression introduced in `0.4.9` where `update` operations during historical indexing would fail with errors like `relation does not exist` or `column "columnName" of relation "TableName"` does not exist.
