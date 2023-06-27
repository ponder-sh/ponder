---
"@ponder/core": patch
---

Updated Ponder's logging behavior. Stdout log lines will not include timestamps, log level, service name, and a message. Logs are also written to files located at `/.ponder/logs/{timestamp}.log` in JSON format. There are now more log levels: `"silent"`, `"fatal"`, `"error"`, `"warn"`, `"info"`, `"debug"`, and `"trace"`. These can be configured using the `PONDER_LOG_LEVEL` environment variable.
