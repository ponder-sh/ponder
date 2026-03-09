---
"ponder": patch
---

Added `event_count` column to `_ponder_checkpoint` table. This monotonically increasing counter tracks total events indexed per chain, enabling downstream systems to detect new data with a single O(1) query.
