---
"@ponder/core": patch
---

Fixed a bug where SQLite raw tables were not prefixed with "_raw_". Note that upgrading to this version changes the SQLite database structure to be incompatible with prior versions.
