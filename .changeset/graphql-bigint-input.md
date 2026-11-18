---
"ponder": patch
---

Fixed a bug that caused the GraphQL `BigInt` scalar to accept `""` (which matched `0`), values with surrounding whitespace, and booleans, and the `Numeric` scalar to pass `""` and booleans to Postgres, which failed with `invalid input syntax for type numeric`. These values now fail validation.
