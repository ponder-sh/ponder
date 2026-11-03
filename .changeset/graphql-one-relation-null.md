---
"ponder": patch
---

Fixed a bug that caused a GraphQL `one` relation field with a `null` reference value to return a row whose referenced column is `NULL`, instead of `null`.
