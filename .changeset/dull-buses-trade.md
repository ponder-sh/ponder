---
"@ponder/core": patch
---

Bumped `better-sqlite3` from `9.1.1` to `10.0.0` which added prebuilt binaries for Node.js 22. This fixes a bug where builds on Railway (using Nixpacks `>=1.22.0`) failed while attempting to build `better-sqlite3` from source.
