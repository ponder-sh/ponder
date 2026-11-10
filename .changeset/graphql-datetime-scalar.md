---
"ponder": major
---

Updated the GraphQL representation of `timestamp` and `date` columns that use the default `mode: "date"`. `timestamp` columns now use the new `DateTime` scalar and return ISO 8601 strings in UTC (e.g. `"2024-01-01T00:00:00.000Z"`) instead of unix timestamps in milliseconds (e.g. `"1704067200000"`). `date({ mode: "date" })` columns now use the new `Date` scalar and return `YYYY-MM-DD` strings. Filters and singular query arguments on these columns accept the same formats, and still accept unix timestamps in milliseconds. The string filters, such as `_contains` and `_starts_with`, were removed for these columns. Columns with `mode: "string"` are unchanged.
