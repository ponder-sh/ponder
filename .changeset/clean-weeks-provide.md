---
"@ponder/core": patch
---

Fixed a bug where the `maxHealthcheckDuration` option in `ponder.config.ts` was not being used. Removed support for setting the max healthcheck duration using the `RAILWAY_HEALTHCHECK_TIMEOUT_SEC` environment variable (Railway no longer provides this variable).
