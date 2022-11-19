const { graphqlPlugin } = require("@ponder/graphql");

/**
 * @type {import('@ponder/core').PonderConfig}
 */
const ponderConfig = {
  plugins: [graphqlPlugin()],
  database: {
    kind: "sqlite",
    // kind: "postgres",
    // connectionString: process.env.POSTGRES_URL,
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
      name: "ArtGobblers",
      network: "mainnet",
      abi: "./abis/ArtGobblers.json",
      address: "0x60bb1e2aa1c9acafb4d34f71585d7e959f387769",
      startBlock: 15863321,
    },
  ],
};

module.exports = ponderConfig;
