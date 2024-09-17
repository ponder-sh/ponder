---
"@ponder/core": patch
---

Fixed a bug introduced in `0.4.33` where the `--trace`, `--debug`, `-v`, and `-vv` CLI options and the `PONDER_LOG_LEVEL` env var did not correctly set the log level. (The `--log-level` option still worked).
