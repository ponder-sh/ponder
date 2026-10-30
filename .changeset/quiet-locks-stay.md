---
"ponder": patch
---

Fixed a bug that caused a Ponder app that failed to acquire the lock on its schema to unlock the schema on shutdown, while another Ponder app was still using it.
