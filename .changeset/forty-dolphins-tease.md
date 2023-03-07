---
"@ponder/core": patch
---

Added support for a path alias `@/generated` in Ponder project `src` files.

```ts
// src/SomeContract.ts
import { ponder } from "@/generated";

ponder.on(...)
```

```ts
// src/nested/AnotherContract.ts
import { ponder } from "@/generated";

ponder.on(...)

```
