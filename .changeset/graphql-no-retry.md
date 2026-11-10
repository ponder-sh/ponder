---
"ponder": patch
---

Fixed a bug that caused a failed GraphQL `totalCount` or `_meta` query, such as one that hit the statement timeout, to be retried up to 9 times before the request failed. GraphQL queries now fail on the first error.
