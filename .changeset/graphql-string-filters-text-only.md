---
"ponder": patch
---

Removed the string filter options (such as `{column}_contains` and `{column}_starts_with`) from GraphQL filters for non-text columns, including `timestamp`, `date`, and `uuid` columns. These filters always failed with an error like `operator does not exist: timestamp without time zone ~~ unknown`.
