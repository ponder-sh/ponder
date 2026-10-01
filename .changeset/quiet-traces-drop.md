---
"ponder": patch
---

Removed the `error` and `revertReason` properties from `event.trace`. Ponder does not index reverted traces, so these properties were always `undefined`.
