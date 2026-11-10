---
"ponder": patch
---

Removed GraphQL filter options that always failed with a database error: `{column}_has` and `{column}_not_has` for `p.bytes()` columns, and all filter options for arrays of `p.json()` columns.
