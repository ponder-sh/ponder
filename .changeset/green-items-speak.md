---
"@ponder/core": patch
---

Fixed hot reloading bugs. Now, the dev server shuts down the previous instance entirely before starting the new one. This should eliminate warnings and errors regarding use of stale database resources, and ensure that the dev server responds as expected to `SIGINT` (keyboard ctrl+c).
