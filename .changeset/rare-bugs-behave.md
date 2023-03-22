---
"@ponder/core": patch
---

BREAKING. Updated entity store API to support `create`, `update`, `upsert`, `findUnique`, and `delete`. Moved `id` from the first positional argument to a field of the `options` object argument for all methods, and moved second positional argument to the `data` field of the `options` argument. See docs for new reference.
