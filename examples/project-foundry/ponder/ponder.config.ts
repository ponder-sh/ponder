import { createConfig } from "@ponder/core";
import { http, getAddress } from "viem";
import CounterDeployment from "../foundry/broadcast/Counter.s.sol/31337/run-latest.json";
import { counterABI } from "./codegen";

const address = getAddress(CounterDeployment.transactions[0]!.contractAddress);

export default createConfig({
  networks: {
    anvil: {
      chainId: 31_337,
      transport: http("http://localhost:8545"),
    },
  },
  contracts: {
    Counter: {
      network: "anvil",
      abi: counterABI,
      address,
    },
  },
});
