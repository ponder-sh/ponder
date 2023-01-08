// const { graphqlPlugin } = require("@ponder/graphql");

const ponderConfig = {
  database: {
    kind: "sqlite",
    filename: ":memory:",
  },
  networks: [
    {
      name: "mainnet",
      chainId: 1,
      rpcUrl: "rpc://test",
    },
  ],
  sources: [
    {
      name: "ArtGobblers",
      network: "mainnet",
      abi: "./abis/ArtGobblers.json",
      address: "0x60bb1e2aa1c9acafb4d34f71585d7e959f387769",
      startBlock: 16342200,
      blockLimit: 250,
    },
  ],
};

module.exports = ponderConfig;
