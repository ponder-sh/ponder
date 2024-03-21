---
"@ponder/core": patch
---

Fixed a bug where the process would sometimes not exit when it encountered a fatal error. Now, if there is a fatal error, the process will attempt a graceful shutdown and then exit. If the graceful shutdown does not finish within 5 seconds, the process will forcefully exit with code 1.
