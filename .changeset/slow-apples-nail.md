---
"ponder": patch
---

Fixed a bug that caused GraphQL filter lists containing `null`, such as `{column}_in: [1, null]` or `OR: [null]`, to fail with `Cannot convert undefined or null to object` or match the wrong rows. These queries now return the error `Invalid query: {key} cannot contain null`.
