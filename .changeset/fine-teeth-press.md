---
"ponder": patch
---

Fixed a bug that caused GraphQL queries with `where: null` to fail with `Cannot convert undefined or null to object`, and queries with `AND: null` or `OR: null` to fail with `Invalid query: Expected an array`. These values are now ignored.
