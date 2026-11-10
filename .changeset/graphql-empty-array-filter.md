---
"ponder": patch
---

Fixed a bug that caused the GraphQL error `arrayContains requires at least one value` when filtering an array column with an empty list, such as `{column}: []` or `{column}_not: []`.
