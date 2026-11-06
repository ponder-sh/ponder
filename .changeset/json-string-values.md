---
"ponder": patch
---

Fixed a bug that caused a `p.json()` or `p.jsonb()` column value that is a string containing JSON, such as `"1"`, `"true"`, or `'{"a":1}'`, to be returned parsed by GraphQL, `@ponder/client`, and database reads, while the indexing cache returned the string.
