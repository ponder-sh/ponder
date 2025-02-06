import { createConfig } from "ponder";
import { http } from "viem";

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
      startBlock: "latest",
      address: "0x95222290DD7278Aa3Ddd389Cc1E1d165CC4BAfe5",
    },
  },
});
