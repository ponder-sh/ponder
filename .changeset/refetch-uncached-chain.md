---
"ponder": patch
---

Fixed a bug that caused the error `TypeError: undefined is not an object (evaluating 'event.event')` (or `Cannot read properties of undefined (reading 'event')`) during the backfill when a chain with `cacheRpcRequests: false` was indexed, and an indexing function read an event property for the first time.
