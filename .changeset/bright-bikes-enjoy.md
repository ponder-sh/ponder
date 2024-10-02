---
"@ponder/core": patch
---

Fixed a bug introduced in v0.6 where extra transaction may be added to the database in the "realtime" sync when using factory contracts.

Any users that were affected by this bug and want to reduce the database size can do so with the query:
```sql
DELETE FROM ponder_sync.transactions WHERE 
  hash NOT IN (SELECT "transactionHash" FROM ponder_sync.logs) 
  AND 
  hash NOT IN (SELECT "transactionHash" FROM ponder_sync."callTraces");
```