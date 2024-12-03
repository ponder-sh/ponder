---
"@ponder/core": patch
---

Fixed an issue where the database did not contain recent records when running `ponder dev`. Now, the indexing store flushes to the database every 5 seconds regardless of the size of the in-memory cache.
