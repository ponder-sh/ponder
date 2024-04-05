---
"@ponder/core": patch
---

Fixed a bug where GraphQL queries that include a many -> `p.one()` path with a limit greater than 50 would fail with the error: "Cannot return null for non-nullable field".
