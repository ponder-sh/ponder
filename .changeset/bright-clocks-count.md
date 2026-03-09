---
"ponder": patch
---

Added `data_checkpoint` column to `_ponder_checkpoint` table. This monotonically increasing change sequence tracks data mutations per chain (including reorgs), enabling downstream systems to detect new data with a single O(1) query.
