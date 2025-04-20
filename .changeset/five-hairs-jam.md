---
"ponder": patch
---

Fixed `Cannot convert undefined to a BigInt` error by allowing `block.size` to be `undefined`. Fixes indexing on some chains including Somnia network.
