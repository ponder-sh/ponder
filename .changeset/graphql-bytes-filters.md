---
"ponder": patch
---

Removed the GraphQL filter options `{column}_has` and `{column}_not_has` for `p.bytes()` columns, which always failed with a database error.
