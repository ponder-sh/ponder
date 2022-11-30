### `ponder.config.js`

`ponder.config.js` contains smart contract addresses, paths to ABIs, RPC URLs for each network, and more. It's similar to a Graph Protocol `subgraph.yaml` file.

`ponder.config.js` is also used for database configuration and plugins.

```ts
type PonderConfig = {
  plugins: ResolvedPonderPlugin[];

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
};
```

**Note: Avoid using new JavaScript features not available in your target Node.js version. `ponder.config.js` will not be parsed by TypeScript or ESBuild.**
