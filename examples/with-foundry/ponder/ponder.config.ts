import { createConfig } from "ponder";
import { http, getAddress, hexToNumber } from "viem";
import type { Hex } from "viem";
import { counterABI } from "../abis/CounterAbi";
import CounterDeploy from "../foundry/broadcast/Deploy.s.sol/31337/run-latest.json";

const address = getAddress(CounterDeploy.transactions[0]!.contractAddress);
const startBlock = hexToNumber(CounterDeploy.receipts[0]!.blockNumber as Hex);

export default createConfig({
  networks: {
    anvil: {
      chainId: 31337,
      transport: http("http://127.0.0.1:8545"),
      disableCache: true,
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
