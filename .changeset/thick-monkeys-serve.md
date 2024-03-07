---
"@ponder/core": patch
---

Fixed a bug where `NaN` was an allowed value for `startBlock` and `endBlock`. Now, `NaN` values are coerced to `0` and `undefined` respectively.
