---
"@ponder/core": patch
---

Fixed a time-travel query bug where nested fields in GraphQL queries would not respect the `timestamp` argument passed to the top-level field. Removed the `timestamp` argument from nested `p.many()` fields. Now, use the `timestamp` argument on the top-level field and all nested fields will respect it.
