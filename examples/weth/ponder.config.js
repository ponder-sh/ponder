const { graphqlPlugin } = require("@ponder/graphql");

/**
 * @type {import('@ponder/core').PonderConfig}
 */
const ponderConfig = {
  plugins: [graphqlPlugin()],
  database: {
    kind: "sqlite",
    filename: process.env.DATABASE_FILE_PATH,
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
      name: "WETH",
      network: "mainnet",
      address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
      abi: "./abis/WETH.json",
      startBlock: Number(process.env.WETH_START_BLOCK),
    },
  ],
};

module.exports = ponderConfig;
