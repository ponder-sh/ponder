---
"ponder": patch
---

Fixed a bug causing events from sources with factories to be missed.

Any users that were affected by this bug can removed corrupted `ponder_sync` rows with the query:

```sql
DELETE FROM ponder_sync.intervals WHERE fragment_id like '%offset%' OR fragment_id like '%topic%';
```
