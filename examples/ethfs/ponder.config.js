const { graphqlPlugin } = require("@ponder/graphql");

const isProduction = process.env.NODE_ENV === "production";

/**
 * @type {import('@ponder/core').PonderConfig}
 */
const ponderConfig = {
  plugins: [graphqlPlugin()],
  database: isProduction
    ? {
        kind: "postgres",
        connectionString: process.env.DATABASE_URL,
      }
    : {
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
      name: "FileStore",
      network: "mainnet",
      abi: "./abis/FileStore.json",
      address: "0x9746fD0A77829E12F8A9DBe70D7a322412325B91",
      startBlock: 15963553,
    },
    {
      kind: "evm",
      name: "FileStoreFrontend",
      network: "mainnet",
      address: "0xBc66C61BCF49Cc3fe4E321aeCEa307F61EC57C0b",
      abi: "./abis/FileStoreFrontend.json",
      startBlock: 15963553,
    },
  ],
};

module.exports = ponderConfig;
