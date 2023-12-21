import {
  type RpcBlock,
  type RpcLog,
  type RpcTransaction,
  parseAbiItem,
} from "viem";

import { getEvents } from "@/config/abi.js";
import { buildFactoryCriteria } from "@/config/factories.js";

export const FORK_BLOCK_NUMBER = 16380000n;

export const accounts = [
  {
    address: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
    balance: 10000000000000000000000n,
    privateKey:
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  },
  {
    address: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
    balance: 10000000000000000000000n,
  },
  {
    address: "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc",
    balance: 10000000000000000000000n,
  },
  {
    address: "0x90f79bf6eb2c4f870365e785982e1f101e93b906",
    balance: 10000000000000000000000n,
  },
  {
    address: "0x15d34aaf54267db7d7c367839aaf71a00a2c6a65",
    balance: 10000000000000000000000n,
  },
  {
    address: "0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc",
    balance: 10000000000000000000000n,
  },
  {
    address: "0x976ea74026e726554db657fa54763abd0c3a0aa9",
    balance: 10000000000000000000000n,
  },
  {
    address: "0x14dc79964da2c08b23698b3d3cc7ca32193d9955",
    balance: 10000000000000000000000n,
  },
  {
    address: "0x23618e81e3f5cdf7f54c3d65f7fbc0abf5b21e8f",
    balance: 10000000000000000000000n,
  },
  {
    address: "0xa0ee7a142d267c1f36714e4a8f75612f20a79720",
    balance: 10000000000000000000000n,
  },
] as const;

export const vitalik = {
  address: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
  account: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
} as const;

const usdcContractAbi = [
  {
    type: "event",
    name: "Approval",
    inputs: [
      {
        indexed: true,
        name: "owner",
        type: "address",
      },
      {
        indexed: true,
        name: "spender",
        type: "address",
      },
      {
        indexed: false,
        name: "value",
        type: "uint256",
      },
    ],
  },
  {
    type: "event",
    name: "Transfer",
    inputs: [
      {
        indexed: true,
        name: "from",
        type: "address",
      },
      {
        indexed: true,
        name: "to",
        type: "address",
      },
      {
        indexed: false,
        name: "value",
        type: "uint256",
      },
    ],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      {
        name: "owner",
        type: "address",
      },
      {
        name: "spender",
        type: "address",
      },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "spender",
        type: "address",
      },
      {
        name: "amount",
        type: "uint256",
      },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [
      {
        name: "account",
        type: "address",
      },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "recipient",
        type: "address",
      },
      {
        name: "amount",
        type: "uint256",
      },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "transferFrom",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "sender",
        type: "address",
      },
      {
        name: "recipient",
        type: "address",
      },
      {
        name: "amount",
        type: "uint256",
      },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "increaseAllowance",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "spender",
        type: "address",
      },
      {
        name: "addedValue",
        type: "uint256",
      },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "decreaseAllowance",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "spender",
        type: "address",
      },
      {
        name: "subtractedValue",
        type: "uint256",
      },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

export const usdcContractConfig = {
  chainId: 1,
  address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  abi: usdcContractAbi,
  events: getEvents({ abi: usdcContractAbi }),
} as const;

const uniswapV3PoolAbi = [
  { inputs: [], stateMutability: "nonpayable", type: "constructor" },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "owner",
        type: "address",
      },
      {
        indexed: true,
        internalType: "int24",
        name: "tickLower",
        type: "int24",
      },
      {
        indexed: true,
        internalType: "int24",
        name: "tickUpper",
        type: "int24",
      },
      {
        indexed: false,
        internalType: "uint128",
        name: "amount",
        type: "uint128",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "amount0",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "amount1",
        type: "uint256",
      },
    ],
    name: "Burn",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "owner",
        type: "address",
      },
      {
        indexed: false,
        internalType: "address",
        name: "recipient",
        type: "address",
      },
      {
        indexed: true,
        internalType: "int24",
        name: "tickLower",
        type: "int24",
      },
      {
        indexed: true,
        internalType: "int24",
        name: "tickUpper",
        type: "int24",
      },
      {
        indexed: false,
        internalType: "uint128",
        name: "amount0",
        type: "uint128",
      },
      {
        indexed: false,
        internalType: "uint128",
        name: "amount1",
        type: "uint128",
      },
    ],
    name: "Collect",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "sender",
        type: "address",
      },
      {
        indexed: true,
        internalType: "address",
        name: "recipient",
        type: "address",
      },
      {
        indexed: false,
        internalType: "uint128",
        name: "amount0",
        type: "uint128",
      },
      {
        indexed: false,
        internalType: "uint128",
        name: "amount1",
        type: "uint128",
      },
    ],
    name: "CollectProtocol",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "sender",
        type: "address",
      },
      {
        indexed: true,
        internalType: "address",
        name: "recipient",
        type: "address",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "amount0",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "amount1",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "paid0",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "paid1",
        type: "uint256",
      },
    ],
    name: "Flash",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint16",
        name: "observationCardinalityNextOld",
        type: "uint16",
      },
      {
        indexed: false,
        internalType: "uint16",
        name: "observationCardinalityNextNew",
        type: "uint16",
      },
    ],
    name: "IncreaseObservationCardinalityNext",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint160",
        name: "sqrtPriceX96",
        type: "uint160",
      },
      { indexed: false, internalType: "int24", name: "tick", type: "int24" },
    ],
    name: "Initialize",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "address",
        name: "sender",
        type: "address",
      },
      {
        indexed: true,
        internalType: "address",
        name: "owner",
        type: "address",
      },
      {
        indexed: true,
        internalType: "int24",
        name: "tickLower",
        type: "int24",
      },
      {
        indexed: true,
        internalType: "int24",
        name: "tickUpper",
        type: "int24",
      },
      {
        indexed: false,
        internalType: "uint128",
        name: "amount",
        type: "uint128",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "amount0",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "amount1",
        type: "uint256",
      },
    ],
    name: "Mint",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint8",
        name: "feeProtocol0Old",
        type: "uint8",
      },
      {
        indexed: false,
        internalType: "uint8",
        name: "feeProtocol1Old",
        type: "uint8",
      },
      {
        indexed: false,
        internalType: "uint8",
        name: "feeProtocol0New",
        type: "uint8",
      },
      {
        indexed: false,
        internalType: "uint8",
        name: "feeProtocol1New",
        type: "uint8",
      },
    ],
    name: "SetFeeProtocol",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "sender",
        type: "address",
      },
      {
        indexed: true,
        internalType: "address",
        name: "recipient",
        type: "address",
      },
      {
        indexed: false,
        internalType: "int256",
        name: "amount0",
        type: "int256",
      },
      {
        indexed: false,
        internalType: "int256",
        name: "amount1",
        type: "int256",
      },
      {
        indexed: false,
        internalType: "uint160",
        name: "sqrtPriceX96",
        type: "uint160",
      },
      {
        indexed: false,
        internalType: "uint128",
        name: "liquidity",
        type: "uint128",
      },
      { indexed: false, internalType: "int24", name: "tick", type: "int24" },
    ],
    name: "Swap",
    type: "event",
  },
  {
    inputs: [
      { internalType: "int24", name: "tickLower", type: "int24" },
      { internalType: "int24", name: "tickUpper", type: "int24" },
      { internalType: "uint128", name: "amount", type: "uint128" },
    ],
    name: "burn",
    outputs: [
      { internalType: "uint256", name: "amount0", type: "uint256" },
      { internalType: "uint256", name: "amount1", type: "uint256" },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "recipient", type: "address" },
      { internalType: "int24", name: "tickLower", type: "int24" },
      { internalType: "int24", name: "tickUpper", type: "int24" },
      { internalType: "uint128", name: "amount0Requested", type: "uint128" },
      { internalType: "uint128", name: "amount1Requested", type: "uint128" },
    ],
    name: "collect",
    outputs: [
      { internalType: "uint128", name: "amount0", type: "uint128" },
      { internalType: "uint128", name: "amount1", type: "uint128" },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "recipient", type: "address" },
      { internalType: "uint128", name: "amount0Requested", type: "uint128" },
      { internalType: "uint128", name: "amount1Requested", type: "uint128" },
    ],
    name: "collectProtocol",
    outputs: [
      { internalType: "uint128", name: "amount0", type: "uint128" },
      { internalType: "uint128", name: "amount1", type: "uint128" },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "factory",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "fee",
    outputs: [{ internalType: "uint24", name: "", type: "uint24" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "feeGrowthGlobal0X128",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "feeGrowthGlobal1X128",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "recipient", type: "address" },
      { internalType: "uint256", name: "amount0", type: "uint256" },
      { internalType: "uint256", name: "amount1", type: "uint256" },
      { internalType: "bytes", name: "data", type: "bytes" },
    ],
    name: "flash",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint16",
        name: "observationCardinalityNext",
        type: "uint16",
      },
    ],
    name: "increaseObservationCardinalityNext",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint160", name: "sqrtPriceX96", type: "uint160" },
    ],
    name: "initialize",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "liquidity",
    outputs: [{ internalType: "uint128", name: "", type: "uint128" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "maxLiquidityPerTick",
    outputs: [{ internalType: "uint128", name: "", type: "uint128" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "recipient", type: "address" },
      { internalType: "int24", name: "tickLower", type: "int24" },
      { internalType: "int24", name: "tickUpper", type: "int24" },
      { internalType: "uint128", name: "amount", type: "uint128" },
      { internalType: "bytes", name: "data", type: "bytes" },
    ],
    name: "mint",
    outputs: [
      { internalType: "uint256", name: "amount0", type: "uint256" },
      { internalType: "uint256", name: "amount1", type: "uint256" },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    name: "observations",
    outputs: [
      { internalType: "uint32", name: "blockTimestamp", type: "uint32" },
      { internalType: "int56", name: "tickCumulative", type: "int56" },
      {
        internalType: "uint160",
        name: "secondsPerLiquidityCumulativeX128",
        type: "uint160",
      },
      { internalType: "bool", name: "initialized", type: "bool" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint32[]", name: "secondsAgos", type: "uint32[]" },
    ],
    name: "observe",
    outputs: [
      { internalType: "int56[]", name: "tickCumulatives", type: "int56[]" },
      {
        internalType: "uint160[]",
        name: "secondsPerLiquidityCumulativeX128s",
        type: "uint160[]",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "bytes32", name: "", type: "bytes32" }],
    name: "positions",
    outputs: [
      { internalType: "uint128", name: "liquidity", type: "uint128" },
      {
        internalType: "uint256",
        name: "feeGrowthInside0LastX128",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "feeGrowthInside1LastX128",
        type: "uint256",
      },
      { internalType: "uint128", name: "tokensOwed0", type: "uint128" },
      { internalType: "uint128", name: "tokensOwed1", type: "uint128" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "protocolFees",
    outputs: [
      { internalType: "uint128", name: "token0", type: "uint128" },
      { internalType: "uint128", name: "token1", type: "uint128" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint8", name: "feeProtocol0", type: "uint8" },
      { internalType: "uint8", name: "feeProtocol1", type: "uint8" },
    ],
    name: "setFeeProtocol",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "slot0",
    outputs: [
      { internalType: "uint160", name: "sqrtPriceX96", type: "uint160" },
      { internalType: "int24", name: "tick", type: "int24" },
      { internalType: "uint16", name: "observationIndex", type: "uint16" },
      {
        internalType: "uint16",
        name: "observationCardinality",
        type: "uint16",
      },
      {
        internalType: "uint16",
        name: "observationCardinalityNext",
        type: "uint16",
      },
      { internalType: "uint8", name: "feeProtocol", type: "uint8" },
      { internalType: "bool", name: "unlocked", type: "bool" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "int24", name: "tickLower", type: "int24" },
      { internalType: "int24", name: "tickUpper", type: "int24" },
    ],
    name: "snapshotCumulativesInside",
    outputs: [
      { internalType: "int56", name: "tickCumulativeInside", type: "int56" },
      {
        internalType: "uint160",
        name: "secondsPerLiquidityInsideX128",
        type: "uint160",
      },
      { internalType: "uint32", name: "secondsInside", type: "uint32" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "recipient", type: "address" },
      { internalType: "bool", name: "zeroForOne", type: "bool" },
      { internalType: "int256", name: "amountSpecified", type: "int256" },
      { internalType: "uint160", name: "sqrtPriceLimitX96", type: "uint160" },
      { internalType: "bytes", name: "data", type: "bytes" },
    ],
    name: "swap",
    outputs: [
      { internalType: "int256", name: "amount0", type: "int256" },
      { internalType: "int256", name: "amount1", type: "int256" },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "int16", name: "", type: "int16" }],
    name: "tickBitmap",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "tickSpacing",
    outputs: [{ internalType: "int24", name: "", type: "int24" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "int24", name: "", type: "int24" }],
    name: "ticks",
    outputs: [
      { internalType: "uint128", name: "liquidityGross", type: "uint128" },
      { internalType: "int128", name: "liquidityNet", type: "int128" },
      {
        internalType: "uint256",
        name: "feeGrowthOutside0X128",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "feeGrowthOutside1X128",
        type: "uint256",
      },
      { internalType: "int56", name: "tickCumulativeOutside", type: "int56" },
      {
        internalType: "uint160",
        name: "secondsPerLiquidityOutsideX128",
        type: "uint160",
      },
      { internalType: "uint32", name: "secondsOutside", type: "uint32" },
      { internalType: "bool", name: "initialized", type: "bool" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "token0",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "token1",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

export const uniswapV3PoolFactoryConfig = {
  chainId: 1,
  criteria: buildFactoryCriteria({
    address: "0x1f98431c8ad98523631ae4a59f267346ea31f984",
    event: parseAbiItem(
      "event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)",
    ),
    parameter: "pool",
  }),
  abi: uniswapV3PoolAbi,
  events: getEvents({ abi: uniswapV3PoolAbi }),
} as const;

export const blockOne: RpcBlock = {
  baseFeePerGas: "0x0",
  difficulty: "0x2d3a678cddba9b",
  extraData: "0x",
  gasLimit: "0x1c9c347",
  gasUsed: "0x0",
  hash: "0xebc3644804e4040c0a74c5a5bbbc6b46a71a5d4010fe0c92ebb2fdf4a43ea5dd",
  logsBloom:
    "0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
  miner: "0x0000000000000000000000000000000000000000",
  mixHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
  nonce: "0x0000000000000000",
  number: "0xec6fc6",
  parentHash:
    "0xe55516ad8029e53cd32087f14653d851401b05245abb1b2d6ed4ddcc597ac5a6",
  receiptsRoot:
    "0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421",
  sealFields: [
    "0x0000000000000000000000000000000000000000000000000000000000000000",
    "0x0000000000000000",
  ],
  sha3Uncles:
    "0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347",
  size: "0x208",
  stateRoot:
    "0x0000000000000000000000000000000000000000000000000000000000000000",
  timestamp: "0x63198f6f",
  totalDifficulty: "0xc70d815d562d3cfa955",
  transactions: [],
  transactionsRoot:
    "0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421",
  uncles: [],
};

export const blockOneTransactions: RpcTransaction[] = [
  // Legacy transaction.
  {
    accessList: undefined,
    blockHash:
      "0xebc3644804e4040c0a74c5a5bbbc6b46a71a5d4010fe0c92ebb2fdf4a43ea5dd",
    blockNumber: "0xec6fc6",
    chainId: "0x1",
    from: "0x1",
    gas: "0x4234584",
    gasPrice: "0x45",
    hash: "0xa4b1f606b66105fa45cb5db23d2f6597075701e7f0e2367f4e6a39d17a8cf98b",
    input: "0x1",
    nonce: "0x1",
    r: "0x1",
    s: "0x1",
    to: "0x1",
    transactionIndex: "0x1",
    type: "0x0",
    v: "0x1",
    value: "0x1",
  },
  // EIP-2930 transaction.
  {
    accessList: [
      {
        address: "0x1",
        storageKeys: ["0x1"],
      },
    ],
    blockHash:
      "0xebc3644804e4040c0a74c5a5bbbc6b46a71a5d4010fe0c92ebb2fdf4a43ea5dd",
    blockNumber: "0xec6fc6",
    chainId: "0x1",
    from: "0x1",
    gas: "0x4234584",
    gasPrice: "0x45",
    hash: "0xc3f1f606b66105fa45cb5db23d2f6597075701e7f0e2367f4e6a39d17a8cf98b",
    input: "0x1",
    maxFeePerGas: undefined,
    maxPriorityFeePerGas: undefined,
    nonce: "0x1",
    r: "0x1",
    s: "0x1",
    to: "0x1",
    transactionIndex: "0x1",
    type: "0x1",
    v: "0x1",
    value: "0x1",
  },
];

export const blockOneLogs: RpcLog[] = [
  {
    address: "0x15d4c048f83bd7e37d49ea4c83a07267ec4203da",
    blockHash:
      "0xebc3644804e4040c0a74c5a5bbbc6b46a71a5d4010fe0c92ebb2fdf4a43ea5dd",
    blockNumber: "0xec6fc6",
    data: "0x0000000000000000000000000000000000000000000000000000002b3b6fb3d0",
    logIndex: "0x6c",
    removed: false,
    topics: [
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
      "0x000000000000000000000000a00f99bc38b1ecda1fd70eaa1cd31d576a9f46b0",
      "0x000000000000000000000000f16e9b0d03470827a95cdfd0cb8a8a3b46969b91",
    ],
    transactionHash:
      "0xa4b1f606b66105fa45cb5db23d2f6597075701e7f0e2367f4e6a39d17a8cf98b",
    transactionIndex: "0x45",
  },
  {
    address: "0x72d4c048f83bd7e37d49ea4c83a07267ec4203da",
    blockHash:
      "0xebc3644804e4040c0a74c5a5bbbc6b46a71a5d4010fe0c92ebb2fdf4a43ea5dd",
    blockNumber: "0xec6fc6",
    data: "0x0000000000000000000000000000000000000000000000000000002b3b6fb3d0",
    logIndex: "0x6d",
    removed: false,
    topics: [],
    transactionHash:
      "0xc3f1f606b66105fa45cb5db23d2f6597075701e7f0e2367f4e6a39d17a8cf98b",
    transactionIndex: "0x46",
  },
];

export const blockTwo: RpcBlock = {
  ...blockOne,
  number: "0xec6fc7",
  hash: "0xf123644804e4040c0a74c5a5bbbc6b46a71a5d4010fe0c92ebb2fdf4a43ea5dd",
  parentHash:
    "0xebc3644804e4040c0a74c5a5bbbc6b46a71a5d4010fe0c92ebb2fdf4a43ea5dd",
  timestamp: "0x63198f70",
  transactions: [],
};

export const blockTwoTransactions: RpcTransaction[] = [
  {
    accessList: undefined,
    blockHash:
      "0xf123644804e4040c0a74c5a5bbbc6b46a71a5d4010fe0c92ebb2fdf4a43ea5dd",
    blockNumber: "0xec6fc7",
    chainId: "0x1",
    from: "0x1",
    gas: "0x4234584",
    gasPrice: "0x45",
    hash: "0xb5f1f606b66105fa45cb5db23d2f6597075701e7f0e2367f4e6a39d17a8cf98b",
    input: "0x1",
    nonce: "0x1",
    r: "0x1",
    s: "0x1",
    to: "0x1",
    transactionIndex: "0x1",
    type: "0x0",
    v: "0x1",
    value: "0x1",
  },
];

export const blockTwoLogs: RpcLog[] = [
  {
    address: "0x93d4c048f83bd7e37d49ea4c83a07267ec4203da",
    blockHash:
      "0xf123644804e4040c0a74c5a5bbbc6b46a71a5d4010fe0c92ebb2fdf4a43ea5dd",
    blockNumber: "0xec6fc7",
    data: "0x0000000000000000000000000000000000000000000000000000002b3b6fb3d0",
    logIndex: "0x6e",
    removed: false,
    topics: [
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
    ],
    transactionHash:
      "0xb5f1f606b66105fa45cb5db23d2f6597075701e7f0e2367f4e6a39d17a8cf98b",
    transactionIndex: "0x1",
  },
];

export const blockThree: RpcBlock = {
  ...blockTwo,
  number: "0xec6fc8",
  hash: "0xf9caf606b66105fa45cb5db23d2f6597075701e7f0e2367f4e6a39d17a8cf98b",
  parentHash:
    "0xf123644804e4040c0a74c5a5bbbc6b46a71a5d4010fe0c92ebb2fdf4a43ea5dd",
  timestamp: "0x63198f7c",
  transactions: [],
};

export const contractReadResultOne = {
  address: "0x93d4c048f83bd7e37d49ea4c83a07267ec4203da",
  blockNumber: BigInt(16000010),
  data: "0x0000000000000000000000000000000000000000000000000000002b3b6fb3d0",
  result: "0x000000000000000000000000a00f99bc38b1ecda1fd70eaa1cd31d576a9f46b0",
  chainId: 1,
} as const;
