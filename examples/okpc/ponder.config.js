module.exports = {
  sources: [
    {
      kind: "evm",
      name: "OKPC",
      chainId: 1,
      rpcUrl: process.env.MAINNET_RPC_URL,
      abi: "./abis/OKPC.json",
      address: "0x7183209867489e1047f3a7c23ea1aed9c4e236e8",
      startBlock: 15320000,
    },
  ],
  apis: [
    {
      kind: "graphql",
      default: true,
      port: 42069,
    },
  ],
  stores: [
    {
      kind: "sqlite",
      filename: ":memory:",
    },
  ],
};
