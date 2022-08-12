module.exports = {
  rpcUrls: {
    31337: "http://127.0.0.1:8545",
  },
  sources: [
    {
      type: "evm",
      chainId: 31337,
      abi: "../contracts/out/EthPlaysV0.sol/EthPlaysV0.abi.json",
      address: "0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0",
    },
  ],
};
