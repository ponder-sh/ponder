---
"ponder": patch
---

Fixed a bug that caused GraphQL queries with `orderBy` set to a `json` column to fail with the database error `could not identify an ordering operator for type json`. These queries now return a validation error. `jsonb` columns can still be used with `orderBy`.
