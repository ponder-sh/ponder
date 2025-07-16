---
"ponder": patch
---

Improved retry behavior for `context.client.getBlock()`, `context.client.getTransaction()`, `context.client.getTransactionReceipt()`, and `context.client.getTransactionConfirmations()`. Now, the error `BlockNotFoundError: Block at number "[number]" could not be found` will be retried properly. This solves a common issue where RPCs return empty data for near-tip blocks.

To remove incorrect cached rpc respones, run the SQL statement: `DELETE FROM ponder_sync.rpc_request_results WHERE result = 'null'`;
