---
"ponder": patch
---

Fixed a bug that caused GraphQL filters on `timestamp` and `date` columns to fail with the error `value.toISOString is not a function`. Filters on these columns now accept unix timestamps in milliseconds, matching the format these columns are returned in, as well as ISO 8601 strings.
