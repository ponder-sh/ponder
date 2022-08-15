module.exports = {
  rpcUrls: {
    31337: "http://127.0.0.1:8545",
  },
  sources: [
    {
      name: "EthPlaysV0",
      kind: "evm",
      chainId: 31337,
      abi: "./abis/EthPlaysV0.json",
      address: "0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0",
    },
    {
      name: "RegistryReceiverV0",
      kind: "evm",
      chainId: 31337,
      abi: "./abis/RegistryReceiverV0.json",
      address: "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512",
    },
  ],
};
