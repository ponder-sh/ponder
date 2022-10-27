# Event handlers

[TODO]

Event handler functions receive two arguments - `event` and `context`.

```ts
// handlers/MyERC20Token.ts
const handleTransfer = async (event, context) => {
  const { Account } = context.entities;
  const { timestamp } = event.block
  const { to, from, amount } = event.params;

  /* add business logic here! */
};

export {
  Transfer: handleTransfer
}
```
