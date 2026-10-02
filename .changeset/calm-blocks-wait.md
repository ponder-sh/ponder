---
"ponder": patch
---

Fixed a bug that caused backfill events in the last block of a range to be processed after events from other chains with `ordering: "omnichain"`, and to be skipped after crash recovery in rare cases.
