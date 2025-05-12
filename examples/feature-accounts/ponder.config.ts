import { createConfig } from "ponder";

export default createConfig({
  chains: {
    mainnet: {
      id: 1,
      rpc: process.env.PONDER_RPC_URL_1!,
    },
  },
  accounts: {
    BeaverBuilder: {
      chain: "mainnet",
      startBlock: "latest",
      address: "0x95222290DD7278Aa3Ddd389Cc1E1d165CC4BAfe5",
    },
  },
});
