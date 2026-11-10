---
"ponder": major
---

Updated `smallint` columns to use the GraphQL `Int` type instead of `Float`. Queries that pass a `Float` variable to a filter on one of these columns, such as `query ($min: Float) { ... where: { amount_gt: $min } }`, fail validation and must declare the variable as `Int`.
