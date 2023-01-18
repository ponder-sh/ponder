---
"create-ponder": patch
"@ponder/core": patch
---

**BREAKING** Changed the way Ponder expects handlers to be registered.

1. Source files must be located in `src/` instead of `handlers/`
2. Handlers are registered using an `EventEmitter`-like pattern (see below)
3. Any `*.ts` file inside `src/` can register event handlers this way. Small projects might only need one file in `src` (e.g. `src/app.ts` or `src/{SourceName}.ts`)

```ts
import { ponder } from "../generated";

ponder.on("SourceName:EventName", async ({ event, context }) => {
  // same handler function body as before!
});

ponder.on("SourceName:EventName2", async ({ event, context }) => {
  // ...
});

ponder.on("AnotherSourceName:EventName", async ({ event, context }) => {
  // ...
});
```

Updated `create-ponder` to use this pattern for newly generated projects
