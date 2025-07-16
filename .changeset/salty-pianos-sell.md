---
"ponder": patch
---

Improved retry behavior for `context.client.getBlock()`. This fixes the error: `BlockNotFoundError: Block at number "[number]" could not be found`.

To remove incorrect cached rpc respones, run the SQL statement: `DELETE FROM ponder_sync.rpc_request_results WHERE result = 'null'`;
