import type { RpcBlock, RpcLog, RpcTransaction } from "viem";

import { getEvents } from "@/config/abi";
import type {
  ContractReadResult,
  LogFilterCachedRange,
} from "@/event-store/store";

if (!process.env.ANVIL_FORK_URL) {
  throw new Error('Missing environment variable "ANVIL_FORK_URL"');
}
export const FORK_URL = process.env.ANVIL_FORK_URL;

if (!process.env.ANVIL_BLOCK_NUMBER) {
  throw new Error('Missing environment variable "ANVIL_BLOCK_NUMBER"');
}
export const FORK_BLOCK_NUMBER = BigInt(Number(process.env.ANVIL_BLOCK_NUMBER));

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
  address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  abi: usdcContractAbi,
  events: getEvents({ abi: usdcContractAbi }),
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
    blockNumber: "0x10f2c",
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
    blockNumber: "0x10f2c",
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
    blockNumber: "0xe6e55f",
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
    blockNumber: "0xe6e55f",
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
  timestamp: "0x63198f70",
  transactions: [],
};

export const blockTwoTransactions: RpcTransaction[] = [
  {
    accessList: undefined,
    blockHash:
      "0xf123644804e4040c0a74c5a5bbbc6b46a71a5d4010fe0c92ebb2fdf4a43ea5dd",
    blockNumber: "0x10f2c",
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

export const contractReadResultOne: ContractReadResult = {
  address: "0x93d4c048f83bd7e37d49ea4c83a07267ec4203da",
  blockNumber: BigInt(16000010),
  data: "0x0000000000000000000000000000000000000000000000000000002b3b6fb3d0",
  result: "0x000000000000000000000000a00f99bc38b1ecda1fd70eaa1cd31d576a9f46b0",
  chainId: 1,
};

export const logFilterCachedRangeOne: LogFilterCachedRange = {
  filterKey: '1-0x93d4c048f83bd7e37d49ea4c83a07267ec4203da-["0x1",null,"0x3"]',
  startBlock: 16000010,
  endBlock: 16000090,
  endBlockTimestamp: 16000010,
};
