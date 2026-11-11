---
"ponder": patch
---

Fixed a bug that caused GraphQL queries with `where: null` to fail with `Cannot convert undefined or null to object`, and queries with `AND: null` or `OR: null` to fail with `Invalid query: Expected an array`. These values are now ignored.

Fixed a bug that caused `{column}: null` and `{column}_not: null` GraphQL filters on array columns to match no rows. They now match `NULL` and non-`NULL` values.

Fixed a bug that caused a `null` value for other GraphQL filter operators, such as `{column}_gt`, `{column}_in`, or `{column}_contains`, to fail with a SQL syntax error or match the wrong rows. These filters are now ignored.

Fixed a bug that caused GraphQL filter lists containing `null`, such as `{column}_in: [1, null]` or `OR: [null]`, to fail with `Cannot convert undefined or null to object` or match the wrong rows. These queries now return the error `Invalid query: {key} cannot contain null`.
