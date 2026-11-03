---
"ponder": patch
---

Fixed a bug that caused GraphQL string filters such as `{column}_contains` and `{column}_starts_with` to treat `%` and `_` in the filter value as wildcards. These characters are now matched literally.
