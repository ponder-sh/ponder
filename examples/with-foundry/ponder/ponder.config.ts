import { createConfig } from "@ponder/core";
import { http, getAddress, hexToNumber } from "viem";
import { Hex } from "viem";
import { counterABI } from "../abis/Counter";
import CounterDeploy from "../contracts/broadcast/Deploy.s.sol/31337/run-latest.json";

const address = getAddress(CounterDeploy.transactions[0]!.contractAddress);
const startBlock = hexToNumber(CounterDeploy.receipts[0]!.blockNumber as Hex);

export default createConfig({
  networks: {
    anvil: {
      chainId: 31337,
      transport: http("http://127.0.0.1:8545"),
      isDevnet: true,
    },
  },
  contracts: {
    Counter: {
      network: "anvil",
      abi: counterABI,
      address,
      startBlock,
    },
  },
});
