---
"ponder": patch
---

Fixed a bug that caused GraphQL cursor pagination to stop early and skip rows when the `orderBy` column contained `NULL` values.
