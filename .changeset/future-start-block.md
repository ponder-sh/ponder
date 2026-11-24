---
"ponder": patch
---

Fixed a bug that caused startup to retry requests for a future `startBlock`. Ponder now waits for the chain to reach that block during live sync.
