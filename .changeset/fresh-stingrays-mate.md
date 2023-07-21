---
"@ponder/core": patch
---

Added support for passing arguments to derived fields. This means you can paginate entities returned in a derived field. Also added support for time-travel queries via the `timestamp` argument to all GraphQL root query types. NOTE: There is currently a limitation where `timestamp` arguments are not automatically passed to derived fields. If you are using time-travel queries on entities with derived fields, be sure the pass the same `timestamp` as an argument to the derived field. This will be fixed in a future release.
