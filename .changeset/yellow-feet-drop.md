---
"ponder": patch
---

Fixed an issue where setting a network `maxRequestsPerSecond` value greater than ~256 could freeze the indexer and cause contention with other chains.
