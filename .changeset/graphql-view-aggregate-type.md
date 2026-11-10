---
"ponder": major
---

Updated the GraphQL type of aliased SQL expressions in views, such as `count().as("count")`, to match their value instead of `JSON`. `count()` and other expressions mapped with `Number` use `Float`, `sum()` and `avg()` use `String`, `max()` and `min()` use the type of the column, and expressions mapped with `String`, `Boolean`, or `BigInt` use `String`, `Boolean`, or `BigInt`. Expressions without `.mapWith()` still use `JSON`.
