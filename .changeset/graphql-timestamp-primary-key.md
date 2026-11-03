---
"ponder": patch
---

Fixed a bug that caused GraphQL singular queries on tables with a `timestamp` primary key column to always return `null`.
