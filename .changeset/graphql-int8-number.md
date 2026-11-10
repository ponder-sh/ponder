---
"ponder": major
---

Fixed a bug that caused the GraphQL error `Int cannot represent non 32-bit signed integer value` when querying `int8({ mode: "number" })` columns with values outside the 32-bit range. These columns now use the GraphQL `Float` type. Queries that declare a variable as `Int` and pass it to a filter on one of these columns, such as `query ($min: Int) { ... where: { timestamp_gte: $min } }`, now fail with `Variable "$min" of type "Int" used in position expecting type "Float".` and must declare the variable as `Float`.
