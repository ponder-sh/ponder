---
"@ponder/core": patch
---

Fixed a bug where contract calls within "setup" indexing functions did not use the correct block number. Now, they use the contract's `startBlock`.
