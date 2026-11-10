---
"ponder": major
---

Updated the arguments of GraphQL singular query fields for tables with a composite primary key to use the same types as the columns. Enum columns now use the GraphQL enum type instead of `String!`, and `integer` and `serial` columns now use `Int!` instead of `Float!`. Queries must pass enum values without quotes (e.g. `table(id: 1, kind: A)`) and declare variables with the matching type.
