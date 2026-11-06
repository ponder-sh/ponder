---
"ponder": patch
---

Fixed a bug that caused the GraphQL error `Unknown column "null" used in orderBy argument` when the `orderBy` argument was `null`, such as a variable set to `null`. A `null` `orderBy` now behaves like an omitted one.
