---
"@ponder/core": patch
---

Fixed a bug where child contract creation events that are also being indexed via a normal contract would sometimes not be processed. Also fixed a bug where indexing a factory contract without registering an indexing function for every event that it emits would throw an error.
