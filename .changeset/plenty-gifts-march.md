---
"@ponder/core": minor
---

BREAKING: Metrics changes. Replaced `ponder_historical_start_timestamp` with `ponder_historical_duration`, which improves the accuracy of sync duration estimates. Removed `ponder_indexing_function_error_total`. Removed the "network" label from `ponder_indexing_function_duration` and `ponder_indexing_completed_events`. Removed the `source` and `type` labels from `ponder_historical_total_blocks`, `ponder_historical_cached_blocks`, and `ponder_historical_completed_blocks`. Replaced `ponder_realtime_is_connected`, `ponder_realtime_latest_block_number`, and `ponder_realtime_latest_block_timestamp` with `ponder_sync_block`, `ponder_sync_is_realtime`, and `ponder_sync_is_complete`.