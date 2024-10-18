---
"@ponder/core": patch
---

Fixed a bug where two or more upserts that hit the insert path for the same ID during realtime indexing could cause a `UniqueConstraintError`.
