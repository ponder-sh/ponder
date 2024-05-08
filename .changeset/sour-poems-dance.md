---
"@ponder/core": patch
---

Fixed a logger bug that caused a memory leak during historical indexing that could crash large apps when the sync is fully cached. Stopped writing logs to files in the `.ponder/logs` directory.
