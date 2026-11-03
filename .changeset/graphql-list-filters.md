---
"ponder": patch
---

Removed GraphQL filter options that always failed with a database error: `{column}_has` and `{column}_not_has` for `p.bytes()`, `vector`, and `geometry` columns, and all filter options for `geometry` columns and arrays of `json` columns.
