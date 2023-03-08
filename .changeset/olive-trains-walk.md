---
"@ponder/core": patch
---

**BREAKING** Migrated to [viem](https://viem.sh). Notes:

Ponder projects must now use **Node 18** or a fetch polyfill (see [viem docs](https://viem.sh/docs/compatibility.html)).

Many of the values in `event.block`, `event.transaction`, and `event.log` are now `bigint` instead of `ethers.BigNumber`. `context.contracts` objects will also have slightly different types.

Projects should remove `ethers` as a dependency, and will need to add dev dependencies on `viem`, `abitype`, and `typescript`.
