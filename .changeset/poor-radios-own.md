---
"@ponder/core": patch
---

Fixes a bug where event handler was always using the minimum value for toTimestamp from all block timestamps, resulting in new events not being added for event handling.
