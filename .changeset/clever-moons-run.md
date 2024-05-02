---
"@ponder/core": patch
---

Improved crash recovery mechanism. Now, when using `ponder start`, a restarted Ponder app (running the same code) will attempt to continue indexing where it previously left off.