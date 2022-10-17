### `ponder.config.js`

Your project's `ponder.config.js` file contains contract addresses, paths to ABIs, RPC URLs for each of your sources (smart contracts). It's similar to a Graph Protocol `subgraph.yaml` file.

`ponder.config.js` also contains your GraphQL server and database configuration.

Here is the TypeScript type for `ponder.config.js`.

```ts
type PonderConfig = {
  networks: {
    name: string;
    chainId: number;
    rpcUrl: string;
  }[];

  sources: {
    name: string;
    network: string; // References networks.name field above
    abi: string;
    address: string;
    startBlock?: number; // default: 0
  }[];

  database:
    | {
        kind: "sqlite";
        filename?: string; // default: ./.ponder/cache.db
      }
    | {
        kind: "postgres";
        connectionString: string;
      };

  graphql?: {
    port?: number; // default: 42069
  };
};
```

[inset box] Avoid using new JavaScript features not available in your target Node.js version. `ponder.config.js` will not be parsed by TypeScript or ESBuild.
