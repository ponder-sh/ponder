---
description: "Guide to custom filters"
---

# Custom log filters

By default, Ponder organizes event logs _by contract address_ via the [`contracts`](/api-reference/ponder-config#contracts) field in `ponder.config.ts`.

However, Ponder also supports filtering logs by event signature and indexed event argument values. For example, you can use this feature to handle all ERC20 `Transfer` events for an entire network, regardless of the contract that emitted them.

See the API of the [`filters`](/api-reference/ponder-config#filters) field in `ponder.config.ts` for more details.
