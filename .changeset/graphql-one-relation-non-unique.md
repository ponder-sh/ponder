---
"ponder": patch
---

Fixed a bug that caused GraphQL `one` relation fields referencing a non-unique column to return `null` for some rows, depending on which other rows were in the same query.
