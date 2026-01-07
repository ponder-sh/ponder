---
"ponder": patch
---

Fixed GraphQL filtering for `int8()` and `numeric()` column types. Previously these column types were using string filter conditions (contains, starts_with, ends_with), now they use numeric filter conditions (gt, gte, lt, lte).
