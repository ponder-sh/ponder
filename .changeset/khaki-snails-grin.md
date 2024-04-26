---
"@ponder/core": patch
---

Fixed a bug where `update` operations during historical indexing would fail with errors like `relation not found` or `column "columnName" of relation "TableName"` does not exist.
