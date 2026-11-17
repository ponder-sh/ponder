---
"ponder": patch
---

Fixed a bug with `ordering: "multichain"` that caused events of one chain to be indexed twice after a reorg of another chain, when the first reorged blocks didn't write to the database. With an `onchainTable` written by both chains, this caused duplicate key errors or wrong values, such as a counter incremented twice.
