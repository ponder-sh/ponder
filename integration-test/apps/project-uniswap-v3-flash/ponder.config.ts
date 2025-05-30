import { createConfig, factory } from "ponder";
import { getAbiItem } from "viem";
import { UniswapV3FactoryAbi } from "./abis/UniswapV3FactoryAbi";
import { UniswapV3PoolAbi } from "./abis/UniswapV3PoolAbi";

export default createConfig({
  database: {
    kind: "postgres",
    connectionString: process.env.PONDER_DATABASE_URL,
    poolConfig: { max: 11 },
  },
  chains: {
    mainnet: { id: 1, rpc: process.env.PONDER_RPC_URL_1 },
  },
  contracts: {
    UniswapV3Pool: {
      chain: "mainnet",
      abi: UniswapV3PoolAbi,
      address: factory({
        address: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
        event: getAbiItem({ abi: UniswapV3FactoryAbi, name: "PoolCreated" }),
        parameter: "pool",
      }),
      startBlock: 20_369_000,
      endBlock: 20_372_000,
    },
  },
});
