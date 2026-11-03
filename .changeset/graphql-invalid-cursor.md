---
"ponder": patch
---

Fixed a bug that caused GraphQL queries with a malformed `after` or `before` cursor to fail with an internal JSON parsing error, and queries with a cursor from a different `orderBy` argument to return incorrect results. These queries now return an `Invalid cursor.` error.
