import { createConfig } from "ponder";
import { custom, http, parseAbi } from "viem";

const queryTransport = http(process.env.PONDER_RPC_URL_QUERY_143, {
  retryCount: 0,
})({});
const standardTransport = http(process.env.PONDER_RPC_URL_143, {
  retryCount: 0,
})({});

const monadTransport = custom({
  request(request) {
    const transport = request.method.startsWith("eth_query")
      ? queryTransport
      : standardTransport;

    return transport.request(request);
  },
});

export default createConfig({
  chains: {
    monad: {
      id: 143,
      rpc: monadTransport,
      experimental_rpcQuery: true,
    },
  },
  contracts: {
    USDC: {
      chain: "monad",
      abi: parseAbi([
        "event Transfer(address indexed from, address indexed to, uint256 amount)",
      ]),
      address: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
      startBlock: 92_270_922,
      includeCallTraces: true,
    },
  },
  accounts: {
    USDCMinter: {
      chain: "monad",
      address: "0xfd78ee919681417d192449715b2594ab58f5d002",
      startBlock: 92_270_922,
    },
  },
});
