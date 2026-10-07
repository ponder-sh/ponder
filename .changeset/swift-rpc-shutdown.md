---
"ponder": patch
---

Fixed a bug that caused JSON-RPC requests to continue after shutdown. A shutdown during the backfill no longer waits for the backfill to fetch the remaining blocks.
