---
"ponder": patch
---

Fixed a bug where data inserted using raw SQL near the beginning of historical indexing was not found by subsequent `find`, `update`, or `delete` operations using the store/in-memory API.
