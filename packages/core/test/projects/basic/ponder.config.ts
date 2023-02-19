import EmptyAbi from "./Empty.abi.json";

export const config = {
  networks: [{ name: "mainnet", chainId: 1, rpcUrl: "rpc://url" }],
  contracts: [
    {
      name: "Empty",
      network: "mainnet",
      abi: EmptyAbi,
      address: "0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85",
      startBlock: 10,
    },
  ],
};
