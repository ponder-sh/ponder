---
"@ponder/core": patch
---

Added support for the `DATABASE_PRIVATE_URL` environment variable. Added info log on startup that includes which database is being used. Added warning for missing `.env.local` file during development. Improved ponder.config.ts validation for misspelled keys. 
