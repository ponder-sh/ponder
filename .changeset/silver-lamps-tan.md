---
"@ponder/core": patch
---

Fixed a regression introduced in `0.5.9` that sometimes caused events to be skipped during indexing if any `startBlock` was set earlier than in a previous indexing run. This issue did not affect the database integrity, but affected apps should restart to ensure all events are indexed.
