---
"ponder": patch
---

Fixed a bug that caused an empty filter object in a GraphQL `OR` filter, such as `OR: [{}, { age: 1 }]`, to be ignored instead of matching every row.
