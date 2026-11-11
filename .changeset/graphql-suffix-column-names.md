---
"ponder": patch
---

Fixed a bug that caused the GraphQL error `Invalid query: Where clause contains unknown column ...` when filtering on a column whose name ends with a filter suffix, such as `opt_in` or `token_not`.
