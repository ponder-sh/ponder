---
"ponder": patch
---

Added the warning log `Failed to execute GraphQL query` for GraphQL errors that a query didn't cause, such as database errors. Previously, these errors were only returned in the response, which is `Unexpected error.` when `NODE_ENV` is `production`.
