---
"@ponder/core": patch
---

Made internal improvements to the real-time sync service to properly reflect the data that is fetched and cached during the real-time sync. Also added a new cleanup migration that removes the `finalized` column from all tables.
