import { createConfig, factory } from "ponder";
import { http, getAbiItem } from "viem";

import { UniswapV3FactoryAbi } from "./abis/UniswapV3FactoryAbi";
import { UniswapV3PoolAbi } from "./abis/UniswapV3PoolAbi";

export default createConfig({
  networks: {
    mainnet: {
      chainId: 1,
      transport: http(process.env.PONDER_RPC_URL_1),
    },
  },
  contracts: {
    UniswapV3Pool: {
      network: "mainnet",
      abi: UniswapV3PoolAbi,
      address: factory({
        address: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
        event: getAbiItem({ abi: UniswapV3FactoryAbi, name: "PoolCreated" }),
        parameter: "pool",
      }),
      startBlock: 12369621,
      filter: {
        event: "Flash",
      },
    },
  },
});
