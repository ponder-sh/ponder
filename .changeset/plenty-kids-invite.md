---
"@ponder/core": patch
---

Fixed a bug where calling `update` or `upsert` with an empty update would throw a "RecordNotFound" store error instead of a no-op.
