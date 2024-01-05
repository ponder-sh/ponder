---
"@ponder/core": patch
---

Added new runtime validations for `ponder.schema.ts`, `ponder.config.ts`, and the indexing function API. Fixed a bug where rapid config reloads caused a race condition that often broke the app during development.
