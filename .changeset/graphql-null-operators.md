---
"ponder": patch
---

Fixed a bug that caused a `null` value for GraphQL filter operators other than `{column}` and `{column}_not`, such as `{column}_gt`, `{column}_in`, or `{column}_contains`, to fail with a SQL syntax error or match the wrong rows. These filters are now ignored.
