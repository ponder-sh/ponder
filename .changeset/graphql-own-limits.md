---
"ponder": patch
---

Fixed a bug that caused the `maxOperationDepth` limit of the `graphql()` middleware to undercount the depth of a fragment spread at different depths. Operations over a limit now fail with messages like `Operation has a depth of 101, which is more than the maximum of 100.`
