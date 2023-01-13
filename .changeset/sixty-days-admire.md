---
"@ponder/core": patch
---

BREAKING! Updated ponder config to support typescript and to be called `ponder.ts` by default. `ponder.ts` must export a variable named `config` that is of the type `import { PonderConfig } from "@ponder/core"`. The `database` field in ponder config is now optional. By default, it uses `SQLite` with a filename of `./.ponder/cache.db`. If the environment variable `DATABASE_URL` is detected, it uses `Postgres` with that value as the `connectionString`.

New sample `ponder.ts` file:

```ts
// ponder.ts

import type { PonderConfig } from "@ponder/core";
import { graphqlPlugin } from "@ponder/graphql";

export const config: PonderConfig = {
  networks: [
    {
      name: "mainnet",
      chainId: 1,
      rpcUrl: process.env.PONDER_RPC_URL_1
    }
  ],
  sources: [
    {
      name: "ArtGobblers",
      network: "mainnet",
      abi: "./abis/ArtGobblers.json",
      address: "0x60bb1e2aa1c9acafb4d34f71585d7e959f387769",
      startBlock: 15863321
    }
  ],
  plugins: [graphqlPlugin()]
};
```

The exported value can also be a function, and it can return a Promise:

```ts
// ponder.ts

import type { PonderConfig } from "@ponder/core";

export const config: PonderConfig = async () => {
  return {
    networks: [
      /* ... */
    ],
    sources: [
      /* ... */
    ]
  };
};
```
