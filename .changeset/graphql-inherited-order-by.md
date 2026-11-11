---
"ponder": patch
---

Fixed a bug that caused GraphQL `orderBy` values that name built-in object properties, such as `"toString"` or `"__proto__"`, to fail with `Invalid input for string type` or `Cannot read properties of null`. They now fail with `Unknown column "toString" used in orderBy argument`.
