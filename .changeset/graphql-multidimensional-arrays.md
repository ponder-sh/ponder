---
"ponder": patch
---

Fixed GraphQL filters for multidimensional array columns, such as `p.integer().array().array()`. `{column}` and `{column}_not` now accept a nested list, and `{column}_has` no longer fails with `value.map is not a function`.
