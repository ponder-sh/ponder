---
"ponder": patch
---

Fixed a bug that caused the GraphQL `BigInt` and `Numeric` scalars to accept invalid values, such as `""` (which matched `0`), `" 0x10 "`, or `true`. Invalid values now fail validation with `Invalid BigInt value ...`. `BigInt` inputs also accept integer literals, such as `balance_gt: 100`.

Fixed a bug that caused `orderBy: "toString"` and other `Object.prototype` keys to bind a function as a SQL parameter instead of failing with `Unknown column "toString" used in orderBy argument`.
