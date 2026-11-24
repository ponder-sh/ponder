---
"ponder": patch
---

Fixed a bug that caused live indexing to treat a block it had already processed, such as a `latest` block returned by a lagging or load-balanced RPC, as a reorg, reverting and reprocessing the blocks after it.
