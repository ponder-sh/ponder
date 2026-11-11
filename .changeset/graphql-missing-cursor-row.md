---
"ponder": patch
---

Fixed a bug that caused GraphQL cursor pagination to skip rows or return an incorrect `hasNextPage` or `hasPreviousPage` when the row referenced by the `after` or `before` cursor had been deleted or no longer matched the `where` filter.
