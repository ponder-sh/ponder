---
"ponder": patch
---

Fixed a bug that caused a GraphQL `one` relation without `fields` and `references`, such as the other side of a one-to-one relation, to return the same arbitrary row for every parent. These relations now use the inverse `one` relation, and return `null` if there is none.
