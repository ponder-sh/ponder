---
"ponder": major
---

Updated `graphql` to `17.0.2` and `graphql-yoga` to `6.0.1`, which roughly doubles the throughput of the `graphql()` middleware for queries that return many rows. Ponder now requires Node `22.15` or later. Some GraphQL validation error messages changed, e.g. `Argument "where" has invalid value {amount_gt: 0.5}.` is now `Argument "Query.tables(where:)" has invalid value at .amount_gt: Int cannot represent non-integer value: 0.5`.
