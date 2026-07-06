---
"ponder": patch
---

Fixed a scalability issue where apps with more than 100 tables failed schema validation. Live query notifications are now batched to stay below Postgres' `NOTIFY` payload size limit.
