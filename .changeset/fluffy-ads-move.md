---
"@ponder/core": patch
---

Fixed a bug where the type of the `id` argument to singular entity fields on `Query` was hardcoded to `ID` rather than using the user-provided type of the `id` field (e.g. `String` or `BigInt`).
