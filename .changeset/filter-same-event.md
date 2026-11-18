---
"ponder": patch
---

Fixed a bug that caused all but the last `filter` entry for the same event to be ignored. For example, `filter: [{ event: "Transfer", args: { from } }, { event: "Transfer", args: { to } }]` only indexed transfers to `to`.
