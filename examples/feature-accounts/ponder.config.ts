import { createConfig } from "ponder";
import { http, createPublicClient } from "viem";

const latestBlockMainnet = await createPublicClient({
  transport: http(process.env.PONDER_RPC_URL_1),
}).getBlock();

export default createConfig({
  networks: {
    mainnet: {
      chainId: 1,
      transport: http(process.env.PONDER_RPC_URL_1),
    },
  },
  accounts: {
    BeaverBuilder: {
      network: "mainnet",
      startBlock: Number(latestBlockMainnet.number) - 100,
      address: "0x95222290DD7278Aa3Ddd389Cc1E1d165CC4BAfe5",
    },
  },
});
