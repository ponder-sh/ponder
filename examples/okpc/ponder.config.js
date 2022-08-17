module.exports = {
  sources: [
    {
      kind: "evm",
      name: "OKPC",
      chainId: 1,
      rpcUrl: process.env.MAINNET_RPC_URL,
      abi: "./abis/OKPC.json",
      address: "0x7183209867489e1047f3a7c23ea1aed9c4e236e8",
      startBlock: 15340000,
    },
  ],
  stores: [
    {
      kind: "sql",
      client: "sqlite3",
      connection: {
        filename: ":memory:",
      },
    },
  ],
  apis: [
    {
      kind: "graphql",
      default: true,
      port: 6969,
    },
  ],
};
