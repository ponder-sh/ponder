---
"@ponder/core": patch
---

Fixed a bug introduced in v0.6 that caused events to be skipped near the end of the historical backfill. This bug did not affect the sync cache and does not require the app to be resynced.
