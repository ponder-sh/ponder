---
"@ponder/core": patch
---

Added support for update functions in the entity store `update` and `upsert` API methods. This allows you to update an entity based on its current state, and solves a common ergonomics issue where users were manually constructing this operation using a combination of `findUnique`, `create`, and `update`.

```ts filename="src/index.ts"
ponder.on("ERC20:Transfer", async ({ event, context }) => {
  const { Account } = context.entities;

  const recipient = await Account.update({
    id: event.params.to,
    data: ({ current }) => ({
      balance: current.balance + event.params.value,
    }),
  });
  // { id: "0x5D92..", balance: 11800000005n }
});
```
