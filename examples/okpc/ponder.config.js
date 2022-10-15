module.exports = {
  database: {
    kind: "sqlite",
  },
  graphql: {
    port: 42069,
  },
  sources: [
    {
      kind: "evm",
      name: "OKPC",
      chainId: 1,
      rpcUrl: process.env.PONDER_RPC_URL_1,
      abi: "./abis/OKPC.json",
      address: "0x7183209867489e1047f3a7c23ea1aed9c4e236e8",
      startBlock: 15755250,
    },
    {
      kind: "evm",
      name: "CanonicalTransactionChain",
      chainId: 1,
      rpcUrl: process.env.PONDER_RPC_URL_1,
      abi: "./abis/CanonicalTransactionChain.json",
      address: "0x5E4e65926BA27467555EB562121fac00D24E9dD2",
      startBlock: 15755250,
    },
  ],
};
