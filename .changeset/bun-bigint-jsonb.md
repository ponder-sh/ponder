---
"ponder": patch
---

Fixed a bug on Bun that caused inserting a BigInt into a `p.json()` or `p.jsonb()` column to throw `JSON.stringify cannot serialize BigInt.` instead of a `BigIntSerializationError` with a hint to use `replaceBigInts()`.
