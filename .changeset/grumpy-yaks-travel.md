---
"@ponder/core": patch
---

Added `CASCADE` to the `DROP VIEW` statements that run during the PostgreSQL view publish step. This fixes a bug where Ponder would crash during the publish step if there were database objects dependent on the Ponder-managed views.
