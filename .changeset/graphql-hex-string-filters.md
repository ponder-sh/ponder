---
"ponder": patch
---

Fixed a bug that caused GraphQL string filters on `p.hex()` columns, such as `{column}_starts_with` and `{column}_contains`, to be case-sensitive. Values with uppercase characters, like checksummed addresses, now match.
