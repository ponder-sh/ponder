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
      name: "FileStore",
      network: "mainnet",
      abi: "./abis/FileStore.json",
      address: "0x9746fD0A77829E12F8A9DBe70D7a322412325B91",
      startBlock: 0,
      blockLimit: 5,
    },
  ],
};

module.exports = ponderConfig;
