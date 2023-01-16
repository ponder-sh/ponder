---
"@ponder/core": patch
---

Fixed bug where handler functions would fail if an event was fetched but not present in the ABI. This means partial ABIs are now supported.
