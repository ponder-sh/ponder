---
"@ponder/core": patch
---

Fixed a bug where the build service would watch for file changes and execute user code even when using `ponder start`, `ponder serve`, or `ponder codegen`.
