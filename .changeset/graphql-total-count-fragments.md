---
"ponder": patch
---

Fixed a bug that caused the GraphQL error `Cannot return null for non-nullable field <table>Page.totalCount.` when `totalCount` was selected through an inline fragment or fragment spread.
