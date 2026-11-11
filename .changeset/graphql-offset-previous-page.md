---
"ponder": patch
---

Fixed a bug that caused GraphQL queries with an `offset` argument to return `hasPreviousPage: true` when no rows matched the `where` filter. `hasPreviousPage` is now `false` whenever an `offset` page is empty, matching cursor pagination when the cursor row is missing.
