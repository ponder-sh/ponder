---
"@ponder/core": patch
---

BREAKING: This release includes a major update to Ponder's sync engine. Upgrading to this version will delete all cached sync progress and you will need to re-sync your app from scratch. If you're running a large Ponder app in production, please test this version on a branch + separate environment before upgrading on main.

Added support for factory contracts. Please see the [documentation](https://ponder.sh/docs/contracts#factory-contracts) for a complete guide & API reference.
