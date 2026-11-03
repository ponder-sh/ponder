---
"ponder": patch
---

Improved backfill speed for block ranges with many blocks. Fetching block data slowed down quadratically with the number of blocks in a range, even when the blocks had no events.
