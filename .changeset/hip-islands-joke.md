---
"ponder": patch
---

Fixed a bug that caused `{column}: null` and `{column}_not: null` GraphQL filters on array columns to match no rows. They now match `NULL` and non-`NULL` values.
