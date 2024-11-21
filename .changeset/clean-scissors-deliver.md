---
"@ponder/core": patch
---

Fixed a bug where `one` relations were sometimes incorrectly marked as non-null in the GraphQL schema, which caused "Cannot return null for non-nullable field" errors when the related entity was not found.
