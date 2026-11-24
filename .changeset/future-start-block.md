---
"ponder": patch
---

Fixed a bug that caused startup to retry requests for a future `startBlock`. Ponder now waits for the chain to reach that block during live sync.

Added a startup debug log for each source whose `startBlock` is ahead of its chain tip.
