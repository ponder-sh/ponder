---
"ponder": patch
---

Fixed a bug that caused an invalid `ordering` in `ponder.config.ts`, such as `""`, to start the app without indexing any events. It now fails the build with `Invalid ordering: Expected 'omnichain', 'multichain', or 'experimental_isolated', got ''.`
