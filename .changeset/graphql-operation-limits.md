---
"ponder": minor
---

Added the `maxOperationRows` and `maxRequestBodySize` options to the `graphql()` middleware. An operation that can select more than `maxOperationRows` rows (default `100000`), counting nested plural fields as the product of their `limit` arguments, now fails with `Operation can select up to ... rows` before any query runs. Request bodies larger than `maxRequestBodySize` bytes (default 1 MiB) now return status code `413`. Previously, a small query with nested `many` relations could run millions of database queries.
