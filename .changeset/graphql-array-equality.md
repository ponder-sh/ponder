---
"ponder": major
---

Updated GraphQL `{column}` and `{column}_not` filters on array columns to match only identical arrays. Previously, these filters compared arrays as sets, so `tags: ["a", "b"]` also matched `["b", "a"]` and `["a", "a", "b"]`. Use `{column}_has` to match arrays that contain a value regardless of order.
