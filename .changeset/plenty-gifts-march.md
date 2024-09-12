---
"@ponder/core": minor
---

Replaced the `ponder_historical_start_timestamp` metric with a new `ponder_historical_duration` metric which improves the accuracy of sync duration estimates. Removed the `source` and `type` labels from `ponder_historical_total_blocks`, `ponder_historical_cached_blocks`, and `ponder_historical_completed_blocks`.