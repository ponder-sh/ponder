import { createConfig } from "ponder";
import { OrderBookABI } from "./abis/OrderBookABI";

export default createConfig({
  chains: {
    monad: {
      id: 143,
      rpc: process.env.PONDER_RPC_URL_143,
    },
  },
  contracts: {
    KuruOrderBook: {
      chain: "monad",
      abi: OrderBookABI,
      address: "0x065C9d28E428A0db40191a54d33d5b7c71a9C394",
      startBlock: 1,
    },
  },
});
