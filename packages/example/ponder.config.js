module.exports = {
  rpcUrls: {
    137: process.env.POLYGON_RPC_URL,
    // 31337: "http://127.0.0.1:8545",
  },
  sources: [
    {
      kind: "evm",
      name: "EthPlaysV0",
      chainId: 137,
      rpcUrl: process.env.POLYGON_RPC_URL,
      abi: "./abis/EthPlaysV0.json",
      address: "0x74631b389147c25d17e7255c4e5b72a958aedf11",
    },
    // {
    //   kind: "evm",
    //   name: "EthPlaysV0",
    //   chainId: 31337,
    //   rpcUrl: "http://127.0.0.1:8545", // Local Anvil node
    //   abi: "./abis/EthPlaysV0.json",
    //   address: "0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0",
    // },
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
