---
"@ponder/core": minor
---

Direct SQL. Public indexing tables (to be accessed directly) are created in the 'ponder' schema. Cached indexing tables are created in the 'ponder_cache' schema. Added migration script to move sync tables from 'public' to 'ponder_sync' schema. Private indexing tables use a numeric suffix like `ponder_instance_2' and are created/removed automatically. Please see the direct SQL docs for more information (https://ponder.sh/docs/guides/query-the-database).
