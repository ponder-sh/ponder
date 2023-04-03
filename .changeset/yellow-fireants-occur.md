---
"@ponder/core": patch
---

Added support for a "setup" event which is processed before all log events. The "setup" event handler argument only includes `context` (no `event` property). Example:

```ts
import { ponder } from "@/generated";

ponder.on("setup", async ({ context }) => {
  const { MyEntity } = context.entities;

  const setupData = await fetch("https://...");

  await MyEntity.create({
    id: setupData.id,
    data: { ...setupData }
  });
});
```
