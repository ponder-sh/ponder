---
"ponder": patch
---

Fixed a bug that caused GraphQL input errors, such as `Invalid limit. Got 2000, expected <=1000.` or `Cannot specify both before and after cursors.`, to be replaced with `Unexpected error.` when `NODE_ENV` is `production`.
