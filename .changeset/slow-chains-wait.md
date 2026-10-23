---
"ponder": patch
---

Added the `allowLateBlocks` chain option. With `"omnichain"` ordering, live indexing no longer waits on a chain with slow block times while its RPC confirms there is no newer block.
