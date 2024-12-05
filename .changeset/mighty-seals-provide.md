---
"@ponder/core": patch
---

Fixed a bug where the GraphiQL explorer displayed "Loading..." as soon as React 19 was released. The fix pins the `react` and `react-dom` versions in the GraphiQL HTML to `18.3.1`.
