---
"ponder": patch
---

Fixed a bug that caused `ponder dev` to log a failed build twice, the second time as `undefined`. A failed build of the API file now logs `Build failed` with `stage=api`.
