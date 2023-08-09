---
"@ponder/core": patch
---

Fixed a bug where the GraphQL resolver for singular entities would return null for falsey (but valid) ID values like `0`.
