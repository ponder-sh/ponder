---
"@ponder/core": patch
---

Fixed a bug where child contract creation events that are also being indexed via a normal contract would not be processed. Also fixed a bug where factory contracts that also specify an event filter would not respeect the event filter.
