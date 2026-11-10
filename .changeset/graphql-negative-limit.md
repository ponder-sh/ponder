---
"ponder": patch
---

Fixed a bug that caused a negative `limit` argument in GraphQL plural queries to return every matching row, bypassing the 1000-row maximum. Negative `limit` and `offset` values now return a validation error.
