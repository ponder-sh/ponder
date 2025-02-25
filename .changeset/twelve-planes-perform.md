---
"ponder": patch
---

Fixed a bug introduced in `0.9.20` where the `ponder` entrypoint included Node.js-only imports like `"node:path"`, breaking some workflows that use `@ponder/client` in browser environments.
