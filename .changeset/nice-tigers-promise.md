---
"ponder": patch
---

Added a new optional `ordering` field to `ponder.config.ts`, which specifies how events across multiple chains should be ordered. The options are `"omnichain"` (default, current behavior) and `"multichain"` (new strategy, opt-in). [Read more](https://ponder.sh/docs/api-reference/config#event-ordering).