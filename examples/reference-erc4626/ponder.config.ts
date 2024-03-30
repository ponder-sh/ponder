import { createConfig } from "@ponder/core";
import { http } from "viem";
import { mainnet } from "viem/chains";
import { erc4626ABI } from "./abis/erc4626ABI";

export default createConfig({
  networks: {
    mainnet: {
      chain: mainnet,
      transport: http(process.env.PONDER_RPC_URL_1),
    },
  },
  contracts: {
    ERC4626: {
      network: "mainnet",
      abi: erc4626ABI,
      address: "0xc21F107933612eCF5677894d45fc060767479A9b",
      startBlock: 15774471,
      endBlock: 18712028,
    },
  },
});
