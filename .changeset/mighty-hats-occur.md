---
"@ponder/core": patch
---

Fixed a bug introduced in v0.5.9 that caused events to be missed in realtime when indexing multiple chains. This issue does not affect database integrity, but affected apps should restart to ensure all events are indexed.
