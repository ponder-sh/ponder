---
"ponder": patch
---

Fixed a bug that caused GraphQL queries with `orderDirection: "ASC"` (or any value other than `"asc"`) to sort in descending order. `orderDirection` is now case-insensitive, and invalid values return a validation error.
