module.exports = {
  database: {
    kind: "sqlite",
  },
  networks: [
    {
      kind: "evm",
      name: "mainnet",
      chainId: 1,
      rpcUrl: process.env.PONDER_RPC_URL_1,
    },
  ],
  sources: [
    {
      kind: "evm",
      name: "OKPC",
      network: "mainnet",
      abi: "./abis/OKPC.json",
      address: "0x7183209867489e1047f3a7c23ea1aed9c4e236e8",
      startBlock: 15762500,
    },
    {
      kind: "evm",
      name: "CanonicalTransactionChain",
      network: "mainnet",
      abi: "./abis/CanonicalTransactionChain.json",
      address: "0x5E4e65926BA27467555EB562121fac00D24E9dD2",
      startBlock: 15762300,
    },
  ],
};
