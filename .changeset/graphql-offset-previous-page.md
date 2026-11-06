---
"ponder": patch
---

Fixed a bug that caused GraphQL queries with an `offset` argument to return `hasPreviousPage: true` when no rows matched the `where` filter.
